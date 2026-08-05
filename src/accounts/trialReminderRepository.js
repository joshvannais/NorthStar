'use strict';

const crypto = require('crypto');
const db = require('../db');

const THRESHOLDS = Object.freeze([7, 3, 1]);
const MAX_ATTEMPTS = 4;
const LEASE_SECONDS = 120;

function row(result) {
  return result && Array.isArray(result.rows) ? result.rows[0] || null : null;
}

function recipientHash(recipient) {
  return crypto.createHash('sha256').update(recipient, 'utf8').digest('hex');
}

function safeCode(value, fallback = 'delivery_failed') {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : fallback;
}

class TrialReminderRepository {
  constructor(pool, options = {}) {
    this.pool = pool || db.getPool();
    this.testClock = typeof options.testClock === 'function' ? options.testClock : null;
  }

  requirePool() {
    if (!this.pool) throw new Error('PostgreSQL trial reminder authority is unavailable');
    return this.pool;
  }

  currentTimeOverride() {
    if (!this.testClock) return null;
    const value = this.testClock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid trial reminder test clock');
    return date.toISOString();
  }

  async transaction(work) {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* preserve original */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileAuthorities(normalizeRecipient) {
    if (typeof normalizeRecipient !== 'function') throw new TypeError('Recipient normalizer is required');
    const now = this.currentTimeOverride();
    return this.transaction(async client => {
      const current = 'COALESCE($1::timestamptz, clock_timestamp())';
      const canceled = await client.query(
        `UPDATE trial_reminder_outbox reminder
            SET status = 'canceled',
                canceled_at = ${current},
                terminal_code = CASE
                  WHEN reminder.trial_ends_at <= ${current} THEN 'trial_expired'
                  ELSE 'subscription_authority_changed'
                END,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = ${current}
          WHERE (reminder.status = 'pending'
                 OR (reminder.status = 'leased' AND reminder.lease_expires_at <= ${current}))
            AND (
              reminder.trial_ends_at <= ${current}
              OR NOT EXISTS (
                SELECT 1 FROM subscriptions subscription
                 WHERE subscription.id = reminder.subscription_id
                   AND subscription.organization_id = reminder.organization_id
                   AND subscription.status = 'trialing'
                   AND subscription.trial_ends_at = reminder.trial_ends_at
                   AND subscription.trial_started_at IS NOT NULL
                   AND subscription.trial_ends_at = subscription.trial_started_at + INTERVAL '14 days'
              )
            )`,
        [now]
      );

      const authorities = await client.query(
        `SELECT subscription.id AS subscription_id,
                subscription.organization_id,
                subscription.trial_ends_at,
                preference.notification_email,
                count(*) FILTER (
                  WHERE membership.role = 'owner'
                    AND membership.status = 'active'
                    AND member.role = 'owner'
                    AND member.status = 'active'
                )::int AS active_verified_owner_count
           FROM subscriptions subscription
           LEFT JOIN notification_preferences preference
             ON preference.organization_id = subscription.organization_id
           LEFT JOIN organization_memberships membership
             ON membership.organization_id = subscription.organization_id
           LEFT JOIN users member
             ON member.id = membership.user_id
            AND member.organization_id = membership.organization_id
          WHERE subscription.status = 'trialing'
            AND subscription.trial_started_at IS NOT NULL
            AND subscription.trial_ends_at = subscription.trial_started_at + INTERVAL '14 days'
            AND subscription.trial_ends_at > ${current}
          GROUP BY subscription.id, subscription.organization_id,
                   subscription.trial_ends_at, preference.notification_email`,
        [now]
      );

      let scheduled = 0;
      let invalid = 0;
      for (const authority of authorities.rows) {
        let recipient = null;
        try { recipient = normalizeRecipient(authority.notification_email); } catch (_error) { recipient = null; }
        if (!recipient || authority.active_verified_owner_count !== 1) {
          const reason = !recipient ? 'destination_invalid' : 'owner_authority_invalid';
          const result = await client.query(
            `UPDATE trial_reminder_outbox
                SET status = 'canceled', canceled_at = ${current}, terminal_code = $5,
                    lease_token = NULL, lease_expires_at = NULL, updated_at = ${current}
              WHERE organization_id = $2 AND subscription_id = $3 AND trial_ends_at = $4
                AND (status = 'pending' OR (status = 'leased' AND lease_expires_at <= ${current}))`,
            [now, authority.organization_id, authority.subscription_id, authority.trial_ends_at, reason]
          );
          invalid += result.rowCount;
          continue;
        }

        const digest = recipientHash(recipient);
        await client.query(
          `UPDATE trial_reminder_outbox
              SET status = 'canceled', canceled_at = ${current}, terminal_code = 'destination_changed',
                  lease_token = NULL, lease_expires_at = NULL, updated_at = ${current}
            WHERE organization_id = $2 AND subscription_id = $3 AND trial_ends_at = $4
              AND recipient_sha256 <> $5
              AND (status = 'pending' OR (status = 'leased' AND lease_expires_at <= ${current}))`,
          [now, authority.organization_id, authority.subscription_id, authority.trial_ends_at, digest]
        );
        for (const threshold of THRESHOLDS) {
          const inserted = await client.query(
            `INSERT INTO trial_reminder_outbox (
               organization_id, subscription_id, trial_ends_at, threshold_days,
               scheduled_for, recipient_sha256, next_attempt_at
             ) VALUES (
               $1, $2, $3, $4::smallint,
               $3::timestamptz - (($4::smallint * 24) * INTERVAL '1 hour'), $5,
               $3::timestamptz - (($4::smallint * 24) * INTERVAL '1 hour')
             )
             ON CONFLICT (organization_id, subscription_id, trial_ends_at, threshold_days)
             DO NOTHING`,
            [authority.organization_id, authority.subscription_id, authority.trial_ends_at, threshold, digest]
          );
          scheduled += inserted.rowCount;
        }
      }

      const noBurst = await client.query(
        `WITH latest_due AS (
           SELECT organization_id, subscription_id, trial_ends_at,
                  min(threshold_days) AS threshold_days
             FROM trial_reminder_outbox
            WHERE scheduled_for <= ${current}
              AND status IN ('pending', 'leased', 'sent')
            GROUP BY organization_id, subscription_id, trial_ends_at
         )
         UPDATE trial_reminder_outbox reminder
            SET status = 'canceled', canceled_at = ${current}, terminal_code = 'superseded_threshold',
                lease_token = NULL, lease_expires_at = NULL, updated_at = ${current}
           FROM latest_due
          WHERE reminder.organization_id = latest_due.organization_id
            AND reminder.subscription_id = latest_due.subscription_id
            AND reminder.trial_ends_at = latest_due.trial_ends_at
            AND reminder.threshold_days > latest_due.threshold_days
            AND reminder.scheduled_for <= ${current}
            AND (reminder.status = 'pending'
                 OR (reminder.status = 'leased' AND reminder.lease_expires_at <= ${current}))`,
        [now]
      );
      return { canceled: canceled.rowCount + invalid + noBurst.rowCount, scheduled };
    });
  }

  async claimNext() {
    const now = this.currentTimeOverride();
    return this.transaction(async client => {
      await client.query(
        `UPDATE trial_reminder_outbox
            SET status = CASE WHEN attempt_count >= $2 THEN 'failed' ELSE 'pending' END,
                failed_at = CASE WHEN attempt_count >= $2 THEN COALESCE($1::timestamptz, clock_timestamp()) END,
                terminal_code = CASE WHEN attempt_count >= $2 THEN 'lease_recovery_exhausted' END,
                lease_token = NULL,
                lease_expires_at = NULL,
                next_attempt_at = COALESCE($1::timestamptz, clock_timestamp()),
                updated_at = COALESCE($1::timestamptz, clock_timestamp())
          WHERE status = 'leased'
            AND lease_expires_at <= COALESCE($1::timestamptz, clock_timestamp())`,
        [now, MAX_ATTEMPTS]
      );

      const result = await client.query(
        `WITH candidate AS (
           SELECT reminder.id
             FROM trial_reminder_outbox reminder
             JOIN subscriptions subscription
               ON subscription.id = reminder.subscription_id
              AND subscription.organization_id = reminder.organization_id
              AND subscription.status = 'trialing'
              AND subscription.trial_ends_at = reminder.trial_ends_at
              AND subscription.trial_started_at IS NOT NULL
              AND subscription.trial_ends_at = subscription.trial_started_at + INTERVAL '14 days'
            WHERE reminder.status = 'pending'
              AND reminder.attempt_count < $2
              AND reminder.scheduled_for <= COALESCE($1::timestamptz, clock_timestamp())
              AND reminder.next_attempt_at <= COALESCE($1::timestamptz, clock_timestamp())
              AND reminder.trial_ends_at > COALESCE($1::timestamptz, clock_timestamp())
            ORDER BY reminder.scheduled_for, reminder.id
            FOR UPDATE OF reminder SKIP LOCKED
            LIMIT 1
         )
         UPDATE trial_reminder_outbox reminder
            SET status = 'leased',
                attempt_count = reminder.attempt_count + 1,
                lease_token = gen_random_uuid(),
                lease_expires_at = COALESCE($1::timestamptz, clock_timestamp()) + ($3 * INTERVAL '1 second'),
                updated_at = COALESCE($1::timestamptz, clock_timestamp())
           FROM candidate
          WHERE reminder.id = candidate.id
          RETURNING reminder.*`,
        [now, MAX_ATTEMPTS, LEASE_SECONDS]
      );
      return row(result);
    });
  }

  async validateLease(id, leaseToken) {
    const now = this.currentTimeOverride();
    const result = await this.requirePool().query(
      `SELECT reminder.id, reminder.organization_id, reminder.subscription_id,
              reminder.trial_ends_at, reminder.threshold_days, reminder.recipient_sha256,
              reminder.lease_token, preference.notification_email,
              count(*) FILTER (
                WHERE membership.role = 'owner' AND membership.status = 'active'
                  AND member.role = 'owner' AND member.status = 'active'
              )::int AS active_verified_owner_count
         FROM trial_reminder_outbox reminder
         JOIN subscriptions subscription
           ON subscription.id = reminder.subscription_id
          AND subscription.organization_id = reminder.organization_id
          AND subscription.status = 'trialing'
          AND subscription.trial_ends_at = reminder.trial_ends_at
          AND subscription.trial_started_at IS NOT NULL
          AND subscription.trial_ends_at = subscription.trial_started_at + INTERVAL '14 days'
         LEFT JOIN notification_preferences preference
           ON preference.organization_id = reminder.organization_id
         LEFT JOIN organization_memberships membership
           ON membership.organization_id = reminder.organization_id
         LEFT JOIN users member
           ON member.id = membership.user_id AND member.organization_id = membership.organization_id
        WHERE reminder.id = $2 AND reminder.lease_token = $3 AND reminder.status = 'leased'
          AND reminder.lease_expires_at > COALESCE($1::timestamptz, clock_timestamp())
          AND reminder.trial_ends_at > COALESCE($1::timestamptz, clock_timestamp())
        GROUP BY reminder.id, preference.notification_email`,
      [now, id, leaseToken]
    );
    return row(result);
  }

  async cancelLease(id, leaseToken, code) {
    const now = this.currentTimeOverride();
    const result = await this.requirePool().query(
      `UPDATE trial_reminder_outbox
          SET status = 'canceled', canceled_at = COALESCE($1::timestamptz, clock_timestamp()),
              terminal_code = $4, lease_token = NULL, lease_expires_at = NULL,
              updated_at = COALESCE($1::timestamptz, clock_timestamp())
        WHERE id = $2 AND lease_token = $3 AND status = 'leased'`,
      [now, id, leaseToken, safeCode(code, 'authority_invalid')]
    );
    return result.rowCount === 1;
  }

  async markSent(id, leaseToken, providerMessageId) {
    const now = this.currentTimeOverride();
    const safeProviderId = typeof providerMessageId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(providerMessageId)
      ? providerMessageId
      : null;
    if (!safeProviderId) throw new Error('Trial reminder provider acceptance is invalid');
    const result = await this.requirePool().query(
      `UPDATE trial_reminder_outbox
          SET status = 'sent', sent_at = COALESCE($1::timestamptz, clock_timestamp()),
              terminal_code = 'accepted', provider_message_id = $4,
              lease_token = NULL, lease_expires_at = NULL,
              updated_at = COALESCE($1::timestamptz, clock_timestamp())
        WHERE id = $2 AND lease_token = $3 AND status = 'leased'`,
      [now, id, leaseToken, safeProviderId]
    );
    return result.rowCount === 1;
  }

  async markFailure(id, leaseToken, failureCode) {
    const now = this.currentTimeOverride();
    const code = safeCode(failureCode);
    const result = await this.requirePool().query(
      `UPDATE trial_reminder_outbox
          SET status = CASE
                WHEN attempt_count >= $4
                  OR COALESCE($1::timestamptz, clock_timestamp()) +
                     (LEAST(3600, 300 * power(2, GREATEST(0, attempt_count - 1))) * INTERVAL '1 second')
                     >= trial_ends_at
                THEN 'failed' ELSE 'pending' END,
              failed_at = CASE
                WHEN attempt_count >= $4
                  OR COALESCE($1::timestamptz, clock_timestamp()) +
                     (LEAST(3600, 300 * power(2, GREATEST(0, attempt_count - 1))) * INTERVAL '1 second')
                     >= trial_ends_at
                THEN COALESCE($1::timestamptz, clock_timestamp()) END,
              terminal_code = CASE
                WHEN attempt_count >= $4
                  OR COALESCE($1::timestamptz, clock_timestamp()) +
                     (LEAST(3600, 300 * power(2, GREATEST(0, attempt_count - 1))) * INTERVAL '1 second')
                     >= trial_ends_at
                THEN $5 END,
              next_attempt_at = COALESCE($1::timestamptz, clock_timestamp()) +
                (LEAST(3600, 300 * power(2, GREATEST(0, attempt_count - 1))) * INTERVAL '1 second'),
              lease_token = NULL, lease_expires_at = NULL,
              updated_at = COALESCE($1::timestamptz, clock_timestamp())
        WHERE id = $2 AND lease_token = $3 AND status = 'leased'
        RETURNING status`,
      [now, id, leaseToken, MAX_ATTEMPTS, code]
    );
    return row(result);
  }
}

module.exports = {
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  THRESHOLDS,
  TrialReminderRepository,
  recipientHash,
  safeCode,
};
