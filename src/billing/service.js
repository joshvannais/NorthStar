'use strict';

const crypto = require('crypto');
const { StripeProviderError, BillingWebhookError } = require('./stripeProvider');
const { BillingPersistenceError, BillingRepository } = require('./repository');

const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

class BillingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    this.code = code;
  }
}

function id(value, prefix) {
  return typeof value === 'string' && value.length <= 255 &&
    new RegExp('^' + prefix + '[A-Za-z0-9_]+$').test(value) ? value : null;
}

function uuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function exactMetadata(value, configuration) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const organizationId = uuid(source.northstar_organization_id);
  const planKey = typeof source.northstar_plan_key === 'string' &&
    configuration.plans[source.northstar_plan_key]
    ? source.northstar_plan_key
    : null;
  if (!organizationId || !planKey) throw new BillingError(400, 'billing_webhook_unsupported_schema', 'Billing webhook is unsupported');
  return { organizationId, planKey, plan: configuration.plans[planKey] };
}

function eventBase(event, rawBody) {
  return {
    eventId: event.id,
    eventType: event.type,
    eventCreated: event.created,
    payloadHash: crypto.createHash('sha256').update(rawBody).digest('hex'),
  };
}

function invoiceSubscription(object) {
  const direct = id(object.subscription, 'sub_');
  const details = object.parent && object.parent.subscription_details;
  const nested = details && id(details.subscription, 'sub_');
  if (direct && nested && direct !== nested) return null;
  return direct || nested;
}

function invoiceMetadata(object) {
  if (object.parent && object.parent.subscription_details && object.parent.subscription_details.metadata) {
    return object.parent.subscription_details.metadata;
  }
  return object.subscription_details && object.subscription_details.metadata;
}

function invoiceLine(object) {
  const data = object.lines && Array.isArray(object.lines.data) ? object.lines.data : [];
  if (data.length !== 1) return null;
  const line = data[0];
  if (!line || typeof line !== 'object') return null;
  const priceId = id(
    line.price && line.price.id ? line.price.id :
      line.pricing && line.pricing.price_details && line.pricing.price_details.price,
    'price_'
  );
  const period = line.period;
  if (!priceId || !Number.isSafeInteger(line.amount) || line.amount <= 0 ||
      String(line.currency || '').toLowerCase() !== 'usd' ||
      !period || !Number.isSafeInteger(period.start) || !Number.isSafeInteger(period.end) ||
      period.end <= period.start || period.end - period.start < 25 * 86400 ||
      period.end - period.start > 35 * 86400) return null;
  return {
    priceId,
    amountCents: line.amount,
    periodStart: period.start,
    periodEnd: period.end,
    quantity: line.quantity,
    proration: line.proration,
  };
}

function exactEmptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function exactPaidInvoiceEvidence(object, line, plan) {
  const amount = plan.monthlyAmountCents;
  return object.paid === true && object.status === 'paid' &&
    String(object.currency || '').toLowerCase() === 'usd' &&
    object.amount_paid === amount && object.amount_due === amount &&
    object.total === amount && object.subtotal === amount &&
    object.amount_remaining === 0 && object.starting_balance === 0 &&
    object.ending_balance === 0 && object.pre_payment_credit_notes_amount === 0 &&
    object.post_payment_credit_notes_amount === 0 &&
    exactEmptyArray(object.discounts) && exactEmptyArray(object.total_discount_amounts) &&
    exactEmptyArray(object.total_tax_amounts) &&
    line.quantity === 1 && line.proration === false;
}

function subscriptionItem(object) {
  const data = object.items && Array.isArray(object.items.data) ? object.items.data : [];
  if (data.length !== 1) return null;
  const item = data[0];
  const priceId = id(item && item.price && (item.price.id || item.price), 'price_');
  return priceId;
}

function normalizeWebhook(event, rawBody, configuration) {
  const base = eventBase(event, rawBody);
  if (!SUPPORTED_EVENTS.has(event.type)) return { ...base, kind: 'unsupported' };
  const object = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const metadata = exactMetadata(object.metadata, configuration);
    const reference = uuid(object.client_reference_id);
    if (!id(object.id, 'cs_') || object.mode !== 'subscription' || object.status !== 'complete' ||
        reference !== metadata.organizationId || !id(object.customer, 'cus_') ||
        !id(object.subscription, 'sub_')) {
      throw new BillingError(400, 'billing_webhook_unsupported_schema', 'Billing webhook is unsupported');
    }
    return {
      ...base,
      kind: 'checkout_completed',
      checkoutId: object.id,
      organizationId: metadata.organizationId,
      planKey: metadata.planKey,
      planName: metadata.plan.name,
      customerId: object.customer,
      subscriptionProviderId: object.subscription,
    };
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const metadata = exactMetadata(invoiceMetadata(object), configuration);
    const line = invoiceLine(object);
    const subscriptionProviderId = invoiceSubscription(object);
    const customerId = id(object.customer, 'cus_');
    const invoiceId = id(object.id, 'in_');
    const paid = event.type === 'invoice.paid';
    if (!line || !subscriptionProviderId || !customerId || !invoiceId ||
        line.priceId !== metadata.plan.priceId || line.amountCents !== metadata.plan.monthlyAmountCents ||
        String(object.currency || '').toLowerCase() !== 'usd' ||
        (!paid && (object.paid !== false || object.status !== 'open'))) {
      throw new BillingError(400, 'billing_webhook_unsupported_schema', 'Billing webhook is unsupported');
    }
    if (paid && !exactPaidInvoiceEvidence(object, line, metadata.plan)) {
      return {
        ...base,
        kind: 'invoice_payment_evidence_rejected',
        organizationId: metadata.organizationId,
      };
    }
    return {
      ...base,
      kind: paid ? 'invoice_paid' : 'invoice_payment_failed',
      invoiceId,
      organizationId: metadata.organizationId,
      planKey: metadata.planKey,
      planName: metadata.plan.name,
      customerId,
      subscriptionProviderId,
      amountCents: line.amountCents,
      periodStart: line.periodStart,
      periodEnd: line.periodEnd,
    };
  }

  const metadata = exactMetadata(object.metadata, configuration);
  const subscriptionProviderId = id(object.id, 'sub_');
  const customerId = id(object.customer, 'cus_');
  const priceId = subscriptionItem(object);
  if (!subscriptionProviderId || !customerId || priceId !== metadata.plan.priceId ||
      !Number.isSafeInteger(object.current_period_start) ||
      !Number.isSafeInteger(object.current_period_end) ||
      object.current_period_end <= object.current_period_start ||
      typeof object.cancel_at_period_end !== 'boolean') {
    throw new BillingError(400, 'billing_webhook_unsupported_schema', 'Billing webhook is unsupported');
  }
  if (event.type === 'customer.subscription.deleted') {
    if (object.status !== 'canceled') {
      throw new BillingError(400, 'billing_webhook_unsupported_schema', 'Billing webhook is unsupported');
    }
    return {
      ...base,
      kind: 'subscription_deleted',
      organizationId: metadata.organizationId,
      planKey: metadata.planKey,
      planName: metadata.plan.name,
      customerId,
      subscriptionProviderId,
      providerStatus: object.status,
      cancelAtPeriodEnd: false,
      periodStart: object.current_period_start,
      periodEnd: object.current_period_end,
    };
  }
  if (!['active', 'past_due'].includes(object.status)) {
    throw new BillingError(400, 'billing_webhook_unsupported_schema', 'Billing webhook is unsupported');
  }
  return {
    ...base,
    kind: 'subscription_updated',
    organizationId: metadata.organizationId,
    planKey: metadata.planKey,
    planName: metadata.plan.name,
    customerId,
    subscriptionProviderId,
    providerStatus: object.status,
    cancelAtPeriodEnd: object.cancel_at_period_end,
    periodStart: object.current_period_start,
    periodEnd: object.current_period_end,
  };
}

function semanticRejection(event, rawBody) {
  let rejectionCode = 'subscription_evidence_rejected';
  if (event.type === 'checkout.session.completed') rejectionCode = 'checkout_evidence_rejected';
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    rejectionCode = 'invoice_evidence_rejected';
  }
  return {
    ...eventBase(event, rawBody),
    kind: 'evidence_rejected',
    rejectionCode,
  };
}

function providerFailure(error) {
  if (!(error instanceof StripeProviderError)) return null;
  return new BillingError(503, error.code, 'Billing provider is temporarily unavailable');
}

class BillingService {
  constructor(options = {}) {
    if (!options.provider || !options.configuration) throw new TypeError('Billing provider configuration is required');
    this.provider = options.provider;
    this.configuration = options.configuration;
    this.repository = options.repository || new BillingRepository();
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
  }

  async checkout(input) {
    const planKey = input && input.planKey;
    if (!this.configuration.plans[planKey]) {
      throw new BillingError(400, 'billing_plan_invalid', 'Billing plan is invalid');
    }
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new BillingError(503, 'billing_unavailable', 'Billing is temporarily unavailable');
    }
    const operationId = crypto.randomUUID();
    const fingerprint = crypto.createHash('sha256')
      .update(['checkout', input.organizationId, input.userId, planKey].join('|'))
      .digest('hex');
    const idempotencyKey = 'northstar-b2-' + crypto.createHash('sha256')
      .update('checkout|' + operationId)
      .digest('hex');
    let acquired;
    try {
      acquired = await this.repository.acquireCheckout({
        operationId,
        organizationId: input.organizationId,
        userId: input.userId,
        fingerprint,
        idempotencyKey,
        expiresAt: new Date(now.getTime() + 31 * 60000).toISOString(),
      });
    } catch (error) {
      if (error instanceof BillingPersistenceError) {
        throw new BillingError(503, error.code, 'Billing authority is temporarily unavailable');
      }
      throw error;
    }
    if (acquired.disposition === 'authority_unavailable') {
      throw new BillingError(403, 'billing_owner_required', 'Active owner membership is required');
    }
    if (acquired.disposition === 'checkout_unavailable') {
      throw new BillingError(409, 'billing_checkout_unavailable', 'Checkout is unavailable for this subscription');
    }
    if (acquired.disposition === 'different_checkout_pending') {
      throw new BillingError(409, 'billing_checkout_pending', 'A different Checkout session is already pending');
    }
    if (acquired.disposition === 'checkout_in_progress') {
      throw new BillingError(409, 'billing_checkout_in_progress', 'Checkout creation is already in progress');
    }
    if (acquired.disposition === 'checkout_indeterminate') {
      throw new BillingError(
        409,
        'billing_checkout_indeterminate',
        'Checkout status is indeterminate until the recovery window expires'
      );
    }
    if (acquired.disposition === 'checkout_replay_unavailable') {
      throw new BillingError(
        409,
        'billing_checkout_replay_unavailable',
        'Checkout is accepted but its safe replay result is unavailable until the recovery window expires'
      );
    }
    if (acquired.disposition === 'replay') {
      return Object.freeze({
        checkout: acquired.checkout,
        activationPendingWebhook: true,
      });
    }
    const operation = acquired.operation;
    try {
      const checkout = await this.provider.createCheckout({
        organizationId: input.organizationId,
        email: acquired.authority.owner_email,
        customerId: acquired.authority.stripe_customer_id || null,
        planKey,
        idempotencyKey: operation.idempotency_key,
        expiresAt: operation.expires_at,
      });
      const durableCheckout = await this.repository.finishCheckoutOperation(
        operation.id,
        'accepted',
        checkout,
        null
      );
      return Object.freeze({
        checkout: durableCheckout,
        activationPendingWebhook: true,
      });
    } catch (error) {
      if (error instanceof BillingPersistenceError) {
        if (error.code === 'billing_checkout_result_unavailable') {
          try {
            await this.repository.finishCheckoutOperation(
              operation.id,
              'indeterminate',
              null,
              error.code
            );
          } catch (_persistenceError) {
            throw new BillingError(503, 'billing_persistence_unavailable', 'Billing authority is temporarily unavailable');
          }
        }
        throw new BillingError(503, error.code, 'Billing authority is temporarily unavailable');
      }
      const mapped = providerFailure(error);
      if (!mapped) throw error;
      try {
        await this.repository.finishCheckoutOperation(
          operation.id,
          error.indeterminate ? 'indeterminate' : 'rejected',
          null,
          error.code
        );
      } catch (_persistenceError) {
        throw new BillingError(503, 'billing_persistence_unavailable', 'Billing authority is temporarily unavailable');
      }
      throw mapped;
    }
  }

  async portal(input) {
    let authority;
    try { authority = await this.repository.ownerAuthority(input.organizationId, input.userId); }
    catch (error) {
      throw new BillingError(503, error.code || 'billing_persistence_unavailable', 'Billing authority is temporarily unavailable');
    }
    if (!authority) throw new BillingError(403, 'billing_owner_required', 'Active owner membership is required');
    if (!authority.stripe_customer_id) {
      throw new BillingError(409, 'billing_portal_unavailable', 'Billing portal is unavailable for this subscription');
    }
    const idempotencyKey = 'northstar-b2-' + crypto.randomBytes(32).toString('hex');
    try {
      const portal = await this.provider.createPortal({
        customerId: authority.stripe_customer_id,
        idempotencyKey,
      });
      return Object.freeze({ portal: Object.freeze({ url: portal.url }) });
    } catch (error) {
      throw providerFailure(error) || error;
    }
  }

  async cancel(input) {
    let authority;
    try { authority = await this.repository.ownerAuthority(input.organizationId, input.userId); }
    catch (error) {
      throw new BillingError(503, error.code || 'billing_persistence_unavailable', 'Billing authority is temporarily unavailable');
    }
    if (!authority) throw new BillingError(403, 'billing_owner_required', 'Active owner membership is required');
    if (authority.cancel_at_period_end === true || authority.subscription_status === 'canceled') {
      return Object.freeze({ cancellation: {
        requested: false,
        alreadyScheduled: true,
        accessThrough: authority.current_period_end ? new Date(authority.current_period_end).toISOString() : null,
        confirmationPendingWebhook: false,
      } });
    }
    if (authority.billing_authority_verified !== true ||
        !['active', 'past_due'].includes(authority.subscription_status) ||
        !authority.stripe_subscription_id || !authority.current_period_end) {
      throw new BillingError(409, 'billing_cancellation_unavailable', 'Cancellation is unavailable for this subscription');
    }
    const idempotencyKey = 'northstar-b2-' + crypto.createHash('sha256')
      .update(['cancel', authority.organization_id, authority.stripe_subscription_id,
        new Date(authority.current_period_end).toISOString()].join('|'))
      .digest('hex');
    try {
      await this.provider.cancelAtPeriodEnd({
        subscriptionId: authority.stripe_subscription_id,
        idempotencyKey,
      });
    } catch (error) {
      throw providerFailure(error) || error;
    }
    return Object.freeze({ cancellation: {
      requested: true,
      alreadyScheduled: false,
      accessThrough: new Date(authority.current_period_end).toISOString(),
      confirmationPendingWebhook: true,
    } });
  }

  async webhook(rawBody, signatureHeader, nowSeconds) {
    let event;
    const clock = this.now();
    const signatureNow = nowSeconds === undefined && clock instanceof Date && Number.isFinite(clock.getTime())
      ? Math.floor(clock.getTime() / 1000)
      : nowSeconds;
    try { event = this.provider.parseWebhook(rawBody, signatureHeader, signatureNow); }
    catch (error) {
      if (error instanceof BillingWebhookError) {
        throw new BillingError(400, error.code, 'Billing webhook is invalid');
      }
      throw error;
    }
    let normalized;
    try {
      normalized = normalizeWebhook(event, rawBody, this.configuration);
    } catch (error) {
      if (!(error instanceof BillingError) || error.code !== 'billing_webhook_unsupported_schema' ||
          !SUPPORTED_EVENTS.has(event.type)) throw error;
      normalized = semanticRejection(event, rawBody);
    }
    try { return await this.repository.applyWebhook(normalized); }
    catch (error) {
      if (!(error instanceof BillingPersistenceError)) throw error;
      const conflict = /conflict|ownership|plan/.test(error.code);
      throw new BillingError(
        conflict ? 409 : 503,
        error.code,
        conflict ? 'Billing authority conflicts with provider evidence' : 'Billing authority is temporarily unavailable'
      );
    }
  }
}

module.exports = { BillingError, BillingService, normalizeWebhook };
