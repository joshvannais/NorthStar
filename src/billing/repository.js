'use strict';

const db = require('../db');
const { safeCheckoutRedirectUrl } = require('./config');

const PERMANENT_WEBHOOK_REJECTIONS = new Set([
  'billing_event_unsupported_schema',
  'billing_invoice_identity_conflict',
  'billing_ownership_conflict',
  'billing_ownership_unavailable',
  'billing_plan_conflict',
]);

class BillingPersistenceError extends Error {
  constructor(code, cause) {
    super('Billing persistence authority failed');
    this.name = 'BillingPersistenceError';
    this.code = code;
    this.cause = cause;
  }
}

function one(result) {
  return result && Array.isArray(result.rows) ? result.rows[0] || null : null;
}

function validateCheckoutResult(value) {
  const checkoutId = value && typeof value.id === 'string' && value.id.length <= 255 &&
    /^cs_[A-Za-z0-9_]+$/.test(value.id) ? value.id : null;
  const url = safeCheckoutRedirectUrl(value && value.url);
  if (!checkoutId || !url) {
    throw new BillingPersistenceError('billing_checkout_result_unavailable');
  }
  return Object.freeze({ providerObjectId: checkoutId, providerRedirectUrl: url });
}

function decodeCheckoutResult(providerObjectId, providerRedirectUrl, expiresAt) {
  const checkoutId = typeof providerObjectId === 'string' ? providerObjectId : '';
  const url = safeCheckoutRedirectUrl(providerRedirectUrl);
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (!/^cs_[A-Za-z0-9_]+$/.test(checkoutId) || checkoutId.length > 255 ||
      !url || !Number.isFinite(expiry.getTime())) return null;
  return Object.freeze({ url, expiresAt: expiry.toISOString() });
}

class BillingRepository {
  constructor(pool, options = {}) {
    this.explicitPool = Boolean(pool);
    this.pool = pool || db.getPool();
    this.testClock = typeof options.testClock === 'function' ? options.testClock : null;
    this.testFailure = typeof options.testFailure === 'function' ? options.testFailure : null;
  }

  requirePool() {
    if (!this.pool || (!this.explicitPool && !db.isAvailable())) {
      throw new BillingPersistenceError('billing_persistence_unavailable');
    }
    return this.pool;
  }

  nowOverride() {
    if (!this.testClock) return null;
    const value = this.testClock();
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BillingPersistenceError('billing_persistence_unavailable');
    return date.toISOString();
  }

  async transaction(work) {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      if (this.testFailure) await this.testFailure(client, value);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* original failure owns classification */ }
      if (error instanceof BillingPersistenceError) throw error;
      throw new BillingPersistenceError('billing_persistence_unavailable', error);
    } finally {
      client.release();
    }
  }

  async ownerAuthority(organizationId, userId, client) {
    const executor = client || this.requirePool();
    const result = await executor.query(
      `SELECT subscription.id AS subscription_id,
              subscription.organization_id,
              subscription.status AS subscription_status,
              subscription.plan_type,
              subscription.billing_plan_key,
              subscription.billing_authority_verified,
              subscription.stripe_customer_id,
              subscription.stripe_subscription_id,
              subscription.current_period_start,
              subscription.current_period_end,
              subscription.cancel_at_period_end,
              subscription.updated_at,
              organization.name AS organization_name,
              owner.email AS owner_email
         FROM organization_memberships membership
         JOIN users owner
           ON owner.id = membership.user_id
          AND owner.organization_id = membership.organization_id
         JOIN organizations organization ON organization.id = membership.organization_id
         JOIN subscriptions subscription ON subscription.organization_id = membership.organization_id
        WHERE membership.organization_id = $1
          AND membership.user_id = $2
          AND membership.role = 'owner'
          AND membership.status = 'active'
          AND owner.status = 'active'` + (client ? '\n        FOR UPDATE OF membership, owner, subscription' : ''),
      [organizationId, userId]
    );
    return one(result);
  }

  async acquireCheckout(input) {
    return this.transaction(async client => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [input.organizationId]
      );
      const authority = await this.ownerAuthority(input.organizationId, input.userId, client);
      if (!authority) return { disposition: 'authority_unavailable' };
      if (!['trialing', 'expired'].includes(authority.subscription_status) ||
          authority.billing_authority_verified === true || authority.stripe_subscription_id) {
        return { disposition: 'checkout_unavailable', authority };
      }
      const now = this.nowOverride();
      await client.query(
        `UPDATE billing_provider_operations
            SET status = 'expired', updated_at = COALESCE($2::timestamptz, clock_timestamp())
          WHERE organization_id = $1 AND operation_type = 'checkout'
            AND status IN ('requested', 'accepted', 'indeterminate')
            AND expires_at <= COALESCE($2::timestamptz, clock_timestamp())`,
        [input.organizationId, now]
      );
      const current = one(await client.query(
        `SELECT id, request_fingerprint, idempotency_key, status,
                provider_object_id, provider_redirect_url, expires_at
           FROM billing_provider_operations
          WHERE organization_id = $1 AND operation_type = 'checkout'
            AND status IN ('requested', 'accepted', 'indeterminate')
          FOR UPDATE`,
        [input.organizationId]
      ));
      if (current) {
        if (current.request_fingerprint !== input.fingerprint) {
          return { disposition: 'different_checkout_pending', authority };
        }
        if (current.status === 'requested') return { disposition: 'checkout_in_progress', authority };
        if (current.status === 'indeterminate') {
          return { disposition: 'checkout_indeterminate', authority, operation: current };
        }
        const checkout = decodeCheckoutResult(
          current.provider_object_id,
          current.provider_redirect_url,
          current.expires_at
        );
        if (!checkout) return { disposition: 'checkout_replay_unavailable', authority, operation: current };
        return { disposition: 'replay', authority, operation: current, checkout };
      }
      const operation = one(await client.query(
        `INSERT INTO billing_provider_operations (
           id, organization_id, actor_user_id, operation_type, request_fingerprint,
           idempotency_key, status, expires_at, created_at, updated_at
         ) VALUES ($1, $2, $3, 'checkout', $4, $5, 'requested', $6,
                   COALESCE($7::timestamptz, clock_timestamp()),
                   COALESCE($7::timestamptz, clock_timestamp()))
         RETURNING id, request_fingerprint, idempotency_key, status,
                   provider_object_id, provider_redirect_url, expires_at`,
        [
          input.operationId,
          input.organizationId,
          input.userId,
          input.fingerprint,
          input.idempotencyKey,
          input.expiresAt,
          now,
        ]
      ));
      return { disposition: 'created', authority, operation };
    });
  }

  async finishCheckoutOperation(operationId, status, providerResult, failureCode) {
    const storedResult = status === 'accepted'
      ? validateCheckoutResult(providerResult)
      : { providerObjectId: null, providerRedirectUrl: null };
    let result;
    try {
      result = await this.requirePool().query(
        `UPDATE billing_provider_operations
            SET status = $2,
                provider_object_id = $3,
                provider_redirect_url = $4,
                failure_code = $5,
                updated_at = clock_timestamp()
          WHERE id = $1 AND operation_type = 'checkout'
            AND status IN ('requested', 'accepted', 'indeterminate')
        RETURNING id, status, provider_object_id, provider_redirect_url, expires_at`,
        [
          operationId,
          status,
          storedResult.providerObjectId,
          storedResult.providerRedirectUrl,
          failureCode || null,
        ]
      );
    } catch (error) {
      if (error instanceof BillingPersistenceError) throw error;
      throw new BillingPersistenceError('billing_persistence_unavailable', error);
    }
    if (result.rowCount !== 1) throw new BillingPersistenceError('billing_operation_conflict');
    if (status !== 'accepted') return null;
    const checkout = decodeCheckoutResult(
      result.rows[0].provider_object_id,
      result.rows[0].provider_redirect_url,
      result.rows[0].expires_at
    );
    if (!checkout) throw new BillingPersistenceError('billing_checkout_result_unavailable');
    return checkout;
  }

  async applyWebhook(input) {
    return this.transaction(async client => {
      const inserted = await client.query(
        `INSERT INTO billing_webhook_events (
           provider_event_id, event_type, event_created_at, payload_sha256,
           processing_status, result_code
         ) VALUES ($1, $2, to_timestamp($3), $4, 'processing', 'processing')
         ON CONFLICT (provider_event_id) DO NOTHING`,
        [input.eventId, input.eventType, input.eventCreated, input.payloadHash]
      );
      if (inserted.rowCount === 0) {
        const existing = one(await client.query(
          `SELECT event_type, payload_sha256, processing_status, result_code
             FROM billing_webhook_events WHERE provider_event_id = $1`,
          [input.eventId]
        ));
        if (!existing || existing.event_type !== input.eventType || existing.payload_sha256 !== input.payloadHash) {
          throw new BillingPersistenceError('billing_event_identity_conflict');
        }
        return { result: 'duplicate', code: existing.result_code };
      }

      await client.query('SAVEPOINT billing_webhook_effects');
      let outcome;
      try {
        if (input.kind === 'unsupported') outcome = { result: 'ignored', code: 'unsupported_event', organizationId: null };
        else if (input.kind === 'evidence_rejected') {
          outcome = { result: 'ignored', code: input.rejectionCode, organizationId: null };
        } else if (input.kind === 'invoice_payment_evidence_rejected') {
          outcome = {
            result: 'ignored',
            code: 'invoice_payment_evidence_rejected',
            organizationId: input.organizationId,
          };
        }
        else if (input.kind === 'checkout_completed') outcome = await this.applyCheckoutCompleted(client, input);
        else if (input.kind === 'invoice_paid' || input.kind === 'invoice_payment_failed') {
          outcome = await this.applyInvoice(client, input);
        } else if (input.kind === 'subscription_updated' || input.kind === 'subscription_deleted') {
          outcome = await this.applySubscription(client, input);
        } else {
          throw new BillingPersistenceError('billing_event_unsupported_schema');
        }
      } catch (error) {
        if (!(error instanceof BillingPersistenceError) || !PERMANENT_WEBHOOK_REJECTIONS.has(error.code)) {
          throw error;
        }
        await client.query('ROLLBACK TO SAVEPOINT billing_webhook_effects');
        outcome = { result: 'ignored', code: error.code, organizationId: null };
      }
      await client.query('RELEASE SAVEPOINT billing_webhook_effects');

      await client.query(
        `UPDATE billing_webhook_events
            SET processing_status = $2, result_code = $3, organization_id = $4,
                processed_at = clock_timestamp()
          WHERE provider_event_id = $1`,
        [
          input.eventId,
          outcome.result === 'processed' ? 'processed' : 'ignored',
          outcome.code,
          outcome.organizationId || null,
        ]
      );
      return outcome;
    });
  }

  async subscriptionForEvent(client, input) {
    let result;
    if (input.organizationId) {
      result = await client.query(
        `SELECT * FROM subscriptions WHERE organization_id = $1 FOR UPDATE`,
        [input.organizationId]
      );
    } else {
      result = await client.query(
        `SELECT * FROM subscriptions
          WHERE stripe_customer_id = $1 AND stripe_subscription_id = $2
          FOR UPDATE`,
        [input.customerId, input.subscriptionProviderId]
      );
    }
    if (result.rowCount !== 1) throw new BillingPersistenceError('billing_ownership_unavailable');
    const row = result.rows[0];
    if ((row.stripe_customer_id && row.stripe_customer_id !== input.customerId) ||
        (row.stripe_subscription_id && row.stripe_subscription_id !== input.subscriptionProviderId)) {
      throw new BillingPersistenceError('billing_ownership_conflict');
    }
    const collision = await client.query(
      `SELECT organization_id FROM subscriptions
        WHERE organization_id <> $1
          AND (stripe_customer_id = $2 OR stripe_subscription_id = $3)
        LIMIT 1`,
      [row.organization_id, input.customerId, input.subscriptionProviderId]
    );
    if (collision.rowCount) throw new BillingPersistenceError('billing_ownership_conflict');
    return row;
  }

  async applyCheckoutCompleted(client, input) {
    const row = await this.subscriptionForEvent(client, input);
    if (row.billing_plan_key && row.billing_plan_key !== input.planKey) {
      throw new BillingPersistenceError('billing_plan_conflict');
    }
    if (row.last_checkout_event_created_at &&
        new Date(row.last_checkout_event_created_at).getTime() > input.eventCreated * 1000) {
      return { result: 'ignored', code: 'out_of_order_event', organizationId: row.organization_id };
    }
    await client.query(
      `UPDATE subscriptions
          SET stripe_customer_id = $2,
              stripe_subscription_id = $3,
              billing_plan_key = $4,
              plan_type = $5,
              last_checkout_event_created_at = to_timestamp($6),
              last_provider_event_id = $7,
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [
        row.id,
        input.customerId,
        input.subscriptionProviderId,
        input.planKey,
        input.planName,
        input.eventCreated,
        input.eventId,
      ]
    );
    await client.query(
        `UPDATE billing_provider_operations
          SET status = 'completed', updated_at = clock_timestamp()
        WHERE organization_id = $1 AND operation_type = 'checkout'
          AND provider_object_id = $2
          AND status IN ('accepted', 'indeterminate')`,
      [row.organization_id, input.checkoutId]
    );
    return { result: 'processed', code: 'checkout_bound_pending_payment', organizationId: row.organization_id };
  }

  async applyInvoice(client, input) {
    const row = await this.subscriptionForEvent(client, input);
    if (row.billing_plan_key && row.billing_plan_key !== input.planKey) {
      throw new BillingPersistenceError('billing_plan_conflict');
    }
    const prior = one(await client.query(
      `SELECT organization_id, subscription_id, provider_customer_id,
              provider_subscription_id, billing_plan_key, currency,
              base_amount_cents, period_start, period_end,
              payment_status, last_event_created_at, last_provider_event_id
         FROM billing_invoice_reconciliation
        WHERE provider_invoice_id = $1
        FOR UPDATE`,
      [input.invoiceId]
    ));
    const eventMillis = input.eventCreated * 1000;
    if (prior) {
      if (prior.organization_id !== row.organization_id || prior.subscription_id !== row.id ||
          prior.provider_customer_id !== input.customerId ||
          prior.provider_subscription_id !== input.subscriptionProviderId ||
          prior.billing_plan_key !== input.planKey || prior.currency !== 'usd' ||
          Number(prior.base_amount_cents) !== input.amountCents ||
          new Date(prior.period_start).getTime() !== input.periodStart * 1000 ||
          new Date(prior.period_end).getTime() !== input.periodEnd * 1000) {
        throw new BillingPersistenceError('billing_invoice_identity_conflict');
      }
      const priorMillis = new Date(prior.last_event_created_at).getTime();
      if (priorMillis > eventMillis ||
          (priorMillis === eventMillis && prior.payment_status === 'paid' && input.kind !== 'invoice_paid')) {
        return { result: 'ignored', code: 'out_of_order_event', organizationId: row.organization_id };
      }
    }
    const paymentStatus = input.kind === 'invoice_paid' ? 'paid' : 'payment_failed';
    await client.query(
      `INSERT INTO billing_invoice_reconciliation (
         provider_invoice_id, organization_id, subscription_id,
         provider_customer_id, provider_subscription_id, billing_plan_key,
         payment_status, currency, base_amount_cents, period_start, period_end,
         last_event_created_at, last_provider_event_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'usd', $8,
                 to_timestamp($9), to_timestamp($10), to_timestamp($11), $12)
       ON CONFLICT (provider_invoice_id) DO UPDATE
         SET payment_status = EXCLUDED.payment_status,
             last_event_created_at = EXCLUDED.last_event_created_at,
             last_provider_event_id = EXCLUDED.last_provider_event_id,
             updated_at = clock_timestamp()`,
      [
        input.invoiceId,
        row.organization_id,
        row.id,
        input.customerId,
        input.subscriptionProviderId,
        input.planKey,
        paymentStatus,
        input.amountCents,
        input.periodStart,
        input.periodEnd,
        input.eventCreated,
        input.eventId,
      ]
    );

    if (input.kind === 'invoice_paid') {
      const currentPaidThrough = row.current_period_end ? new Date(row.current_period_end).getTime() : 0;
      if (!row.billing_authority_verified || input.periodEnd * 1000 >= currentPaidThrough) {
        await client.query(
          `UPDATE subscriptions
              SET stripe_customer_id = $2,
                  stripe_subscription_id = $3,
                  billing_plan_key = $4,
                  plan_type = $5,
                  billing_authority_verified = TRUE,
                  status = 'active',
                  current_period_start = to_timestamp($6),
                  current_period_end = to_timestamp($7),
                  last_invoice_event_created_at = to_timestamp($8),
                  last_provider_event_id = $9,
                  updated_at = clock_timestamp()
            WHERE id = $1`,
          [
            row.id,
            input.customerId,
            input.subscriptionProviderId,
            input.planKey,
            input.planName,
            input.periodStart,
            input.periodEnd,
            input.eventCreated,
            input.eventId,
          ]
        );
        return { result: 'processed', code: 'paid_activation_reconciled', organizationId: row.organization_id };
      }
      return { result: 'ignored', code: 'out_of_order_paid_period', organizationId: row.organization_id };
    }

    if (!row.billing_authority_verified) {
      return { result: 'ignored', code: 'unpaid_checkout_not_activated', organizationId: row.organization_id };
    }
    const storedInvoiceClock = row.last_invoice_event_created_at
      ? new Date(row.last_invoice_event_created_at).getTime()
      : 0;
    if (eventMillis < storedInvoiceClock) {
      return { result: 'ignored', code: 'out_of_order_event', organizationId: row.organization_id };
    }
    await client.query(
      `UPDATE subscriptions
          SET status = 'past_due',
              last_invoice_event_created_at = to_timestamp($2),
              last_provider_event_id = $3,
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [row.id, input.eventCreated, input.eventId]
    );
    return { result: 'processed', code: 'payment_failure_reconciled', organizationId: row.organization_id };
  }

  async applySubscription(client, input) {
    const row = await this.subscriptionForEvent(client, input);
    if (row.billing_plan_key && row.billing_plan_key !== input.planKey) {
      throw new BillingPersistenceError('billing_plan_conflict');
    }
    const lastMillis = row.last_subscription_event_created_at
      ? new Date(row.last_subscription_event_created_at).getTime()
      : 0;
    if (input.eventCreated * 1000 < lastMillis) {
      return { result: 'ignored', code: 'out_of_order_event', organizationId: row.organization_id };
    }
    if (!row.billing_authority_verified) {
      return { result: 'ignored', code: 'subscription_not_paid', organizationId: row.organization_id };
    }
    if (input.kind === 'subscription_deleted') {
      await client.query(
        `UPDATE subscriptions
            SET status = 'canceled', cancel_at_period_end = FALSE,
                canceled_at = to_timestamp($2),
                last_subscription_event_created_at = to_timestamp($2),
                last_provider_event_id = $3,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [row.id, input.eventCreated, input.eventId]
      );
      return { result: 'processed', code: 'cancellation_reconciled', organizationId: row.organization_id };
    }

    const status = input.providerStatus === 'past_due' ? 'past_due' : row.status;
    await client.query(
      `UPDATE subscriptions
          SET status = $2,
              cancel_at_period_end = $3,
              last_subscription_event_created_at = to_timestamp($4),
              last_provider_event_id = $5,
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [row.id, status, input.cancelAtPeriodEnd, input.eventCreated, input.eventId]
    );
    return {
      result: 'processed',
      code: input.cancelAtPeriodEnd ? 'cancellation_scheduled' :
        (status === 'past_due' ? 'past_due_reconciled' : 'subscription_reconciled'),
      organizationId: row.organization_id,
    };
  }
}

module.exports = { BillingPersistenceError, BillingRepository };
