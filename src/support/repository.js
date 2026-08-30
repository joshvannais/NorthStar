'use strict';

const crypto = require('crypto');
const db = require('../db');
const { SupportCaseError } = require('./contract');

const MAX_CASES_PER_ACTOR_HOUR = 10;
const STATUS_LABELS = Object.freeze({
  received: 'Received', investigating: 'Investigating', fix_prepared: 'Fix Prepared',
  resolved: 'Resolved', closed: 'Closed',
});

class SupportCasePersistenceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'SupportCasePersistenceError';
    this.cause = cause;
  }
}

function known(error) {
  return error instanceof SupportCaseError ||
    Boolean(error && Number.isInteger(error.status) && typeof error.code === 'string');
}

function forwardingState(value) {
  if (value === 'delivered') return 'delivered';
  if (value === 'retry') return 'retry';
  if (value === 'unavailable' || value === 'dead') return 'unavailable';
  return 'pending';
}

function attachmentView(row, caseId) {
  if (!row || !row.attachment_id) return null;
  return {
    id: row.attachment_id,
    filename: row.original_filename,
    mediaType: row.media_type,
    size: Number(row.stored_size),
    width: Number(row.image_width),
    height: Number(row.image_height),
    url: `/api/v1/support/bug-reports/${caseId}/attachments/${row.attachment_id}`,
  };
}

function eventView(row) {
  return {
    id: row.id,
    type: row.event_type,
    state: row.customer_state,
    stateLabel: STATUS_LABELS[row.customer_state],
    message: row.customer_message,
    createdAt: row.created_at,
  };
}

function caseView(row, events, replayed = false) {
  return {
    id: row.id,
    reference: row.case_number,
    title: row.title,
    description: row.description,
    state: row.status,
    stateLabel: STATUS_LABELS[row.status],
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
    forwarding: {
      state: forwardingState(row.outbox_state),
      attempts: Number(row.attempt_count || 0),
    },
    attachment: attachmentView(row, row.id),
    history: events.map(eventView),
    replayed,
  };
}

class SupportCaseRepository {
  constructor(pool) {
    this.explicitPool = Boolean(pool);
    this.pool = pool || db.getPool();
  }

  requirePool() {
    const pool = this.explicitPool ? this.pool : db.getPool();
    if (!pool || (!this.explicitPool && !db.isAvailable())) {
      throw new SupportCasePersistenceError('PostgreSQL support-case authority is unavailable');
    }
    this.pool = pool;
    return pool;
  }

  async transaction(work, readOnly = false) {
    let client = null;
    try {
      client = await this.requirePool().connect();
      await client.query(readOnly
        ? 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
        : 'BEGIN');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '2000ms'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* Preserve original failure. */ }
      }
      if (known(error)) throw error;
      throw new SupportCasePersistenceError('PostgreSQL support-case operation failed', error);
    } finally {
      if (client) client.release();
    }
  }

  async requireActor(client, organizationId, actorUserId, lock = false) {
    const result = await client.query(
      `SELECT role, status FROM public.organization_memberships
        WHERE organization_id = $1 AND user_id = $2${lock ? ' FOR SHARE' : ''}`,
      [organizationId, actorUserId]
    );
    if (result.rowCount !== 1 || result.rows[0].status !== 'active') {
      throw new SupportCaseError(403, 'support_access_required', 'Active organization access is required.');
    }
  }

  async events(client, organizationId, caseId) {
    const result = await client.query(
      `SELECT id, event_type, customer_state, customer_message, created_at
         FROM public.support_case_events
        WHERE organization_id = $1 AND case_id = $2
        ORDER BY created_at, id`,
      [organizationId, caseId]
    );
    return result.rows;
  }

  async caseRow(client, organizationId, caseId) {
    const result = await client.query(
      `SELECT report.id, report.case_number, report.title, report.description,
              report.status, report.created_at, report.updated_at,
              attachment.id AS attachment_id, attachment.original_filename,
              attachment.media_type, attachment.stored_size,
              attachment.image_width, attachment.image_height,
              forwarding.state AS outbox_state, forwarding.attempt_count
         FROM public.support_cases report
         LEFT JOIN public.support_case_attachments attachment
           ON attachment.organization_id = report.organization_id AND attachment.case_id = report.id
         JOIN public.support_case_email_outbox forwarding
           ON forwarding.organization_id = report.organization_id AND forwarding.case_id = report.id
        WHERE report.organization_id = $1 AND report.id = $2`,
      [organizationId, caseId]
    );
    return result.rows[0] || null;
  }

  async create(input) {
    return this.transaction(async client => {
      await this.requireActor(client, input.organizationId, input.actorUserId, true);
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`support-rate:${input.organizationId}:${input.actorUserId}`]
      );
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`support-case:${input.organizationId}:${input.actorUserId}:${input.idempotencyKeyHash}`]
      );
      const replay = await client.query(
        `SELECT id, request_digest FROM public.support_cases
          WHERE organization_id = $1 AND created_by_user_id = $2 AND idempotency_key_hash = $3`,
        [input.organizationId, input.actorUserId, input.idempotencyKeyHash]
      );
      if (replay.rowCount === 1) {
        if (replay.rows[0].request_digest.trim() !== input.requestDigest) {
          throw new SupportCaseError(
            409, 'support_idempotency_conflict',
            'That retry identity was already used for different report content. Refresh and try again.'
          );
        }
        const row = await this.caseRow(client, input.organizationId, replay.rows[0].id);
        return caseView(row, await this.events(client, input.organizationId, row.id), true);
      }
      const rate = await client.query(
        `SELECT count(*)::int AS count FROM public.support_cases
          WHERE organization_id = $1 AND created_by_user_id = $2
            AND created_at > clock_timestamp() - INTERVAL '1 hour'`,
        [input.organizationId, input.actorUserId]
      );
      if (rate.rows[0].count >= MAX_CASES_PER_ACTOR_HOUR) {
        throw new SupportCaseError(429, 'support_rate_limited', 'Too many reports were submitted. Try again later.');
      }
      await client.query(
        `INSERT INTO public.support_cases
          (id, organization_id, created_by_user_id, case_number, title, description,
           idempotency_key_hash, request_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.caseId, input.organizationId, input.actorUserId, input.caseNumber,
          input.title, input.description, input.idempotencyKeyHash, input.requestDigest]
      );
      if (input.attachment) {
        const value = input.attachment;
        await client.query(
          `INSERT INTO public.support_case_attachments
            (id, organization_id, case_id, uploaded_by_user_id, original_filename,
             media_type, original_size, stored_size, original_sha256, stored_sha256,
             image_width, image_height, image_bytes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [value.id, input.organizationId, input.caseId, input.actorUserId,
            value.originalFilename, value.mediaType, value.originalSize, value.storedSize,
            value.originalSha256, value.storedSha256, value.width, value.height, value.bytes]
        );
      }
      await client.query(
        `INSERT INTO public.support_case_events
          (id, organization_id, case_id, actor_user_id, event_type, customer_state, customer_message)
         VALUES ($1,$2,$3,$4,'case_received','received',$5)`,
        [crypto.randomUUID(), input.organizationId, input.caseId, input.actorUserId,
          'Your report was received and preserved. Keep its reference and use organization history for status updates; no response time is promised.']
      );
      await client.query(
        `INSERT INTO public.support_case_email_outbox (id, organization_id, case_id)
         VALUES ($1,$2,$3)`,
        [crypto.randomUUID(), input.organizationId, input.caseId]
      );
      const row = await this.caseRow(client, input.organizationId, input.caseId);
      return caseView(row, await this.events(client, input.organizationId, input.caseId));
    });
  }

  async list(organizationId, actorUserId) {
    return this.transaction(async client => {
      await this.requireActor(client, organizationId, actorUserId);
      const result = await client.query(
        `SELECT report.id, report.case_number, report.title, report.description,
                report.status, report.created_at, report.updated_at,
                attachment.id AS attachment_id, attachment.original_filename,
                attachment.media_type, attachment.stored_size,
                attachment.image_width, attachment.image_height,
                forwarding.state AS outbox_state, forwarding.attempt_count
           FROM public.support_cases report
           LEFT JOIN public.support_case_attachments attachment
             ON attachment.organization_id = report.organization_id AND attachment.case_id = report.id
           JOIN public.support_case_email_outbox forwarding
             ON forwarding.organization_id = report.organization_id AND forwarding.case_id = report.id
          WHERE report.organization_id = $1
          ORDER BY report.created_at DESC, report.id DESC
          LIMIT 50`,
        [organizationId]
      );
      const projected = [];
      for (const row of result.rows) {
        projected.push(caseView(row, await this.events(client, organizationId, row.id)));
      }
      return projected;
    }, true);
  }

  async read(organizationId, actorUserId, caseId) {
    return this.transaction(async client => {
      await this.requireActor(client, organizationId, actorUserId);
      const row = await this.caseRow(client, organizationId, caseId);
      if (!row) throw new SupportCaseError(404, 'support_case_not_found', 'Support case not found.');
      return caseView(row, await this.events(client, organizationId, caseId));
    }, true);
  }

  async attachment(organizationId, actorUserId, caseId, attachmentId) {
    return this.transaction(async client => {
      await this.requireActor(client, organizationId, actorUserId);
      const result = await client.query(
        `SELECT original_filename, media_type, stored_size, stored_sha256, image_bytes
           FROM public.support_case_attachments
          WHERE organization_id = $1 AND case_id = $2 AND id = $3`,
        [organizationId, caseId, attachmentId]
      );
      if (result.rowCount !== 1) {
        throw new SupportCaseError(404, 'support_attachment_not_found', 'Support screenshot not found.');
      }
      const row = result.rows[0];
      if (!Buffer.isBuffer(row.image_bytes) || row.image_bytes.length !== Number(row.stored_size) ||
          crypto.createHash('sha256').update(row.image_bytes).digest('hex') !== row.stored_sha256.trim()) {
        throw new SupportCasePersistenceError('Stored support screenshot integrity check failed');
      }
      return {
        filename: row.original_filename,
        mediaType: row.media_type,
        bytes: row.image_bytes,
        digest: row.stored_sha256.trim(),
      };
    }, true);
  }

  async markForwardingUnavailable(batchSize = 25) {
    return this.transaction(async client => {
      const result = await client.query(
        `WITH candidates AS (
         SELECT id FROM public.support_case_email_outbox
          WHERE state IN ('pending','retry','unavailable') AND available_at <= clock_timestamp()
          ORDER BY available_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE public.support_case_email_outbox forwarding
          SET state='unavailable', available_at=clock_timestamp()+INTERVAL '5 minutes',
              last_error_category='configuration_unavailable', updated_at=clock_timestamp()
         FROM candidates WHERE forwarding.id=candidates.id`,
        [Math.min(Math.max(Number(batchSize) || 1, 1), 25)]
      );
      return result.rowCount;
    });
  }

  async claimForwardingJobs(options = {}) {
    const batchSize = Math.min(Math.max(Number(options.batchSize) || 1, 1), 25);
    const leaseSeconds = Math.min(Math.max(Number(options.leaseSeconds) || 30, 5), 300);
    return this.transaction(async client => {
      await client.query(
        `UPDATE public.support_case_email_outbox
            SET state = CASE WHEN attempt_count >= 5 THEN 'dead' ELSE 'retry' END,
                claimed_at=NULL, claim_token=NULL, lease_expires_at=NULL,
                dead_at=CASE WHEN attempt_count >= 5 THEN clock_timestamp() ELSE NULL END,
                available_at=clock_timestamp(), last_error_category='lease_expired',
                updated_at=clock_timestamp()
          WHERE state='claimed' AND lease_expires_at <= clock_timestamp()`
      );
      const result = await client.query(
        `WITH candidates AS (
           SELECT id FROM public.support_case_email_outbox
            WHERE state IN ('pending','retry','unavailable')
              AND available_at <= clock_timestamp() AND attempt_count < 5
            ORDER BY available_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT $1
         )
         UPDATE public.support_case_email_outbox forwarding
            SET state='claimed', attempt_count=attempt_count+1,
                claimed_at=clock_timestamp(), claim_token=gen_random_uuid(),
                lease_expires_at=clock_timestamp()+($2::text||' seconds')::interval,
                last_error_category=NULL, updated_at=clock_timestamp()
           FROM candidates WHERE forwarding.id=candidates.id
         RETURNING forwarding.id, forwarding.organization_id, forwarding.case_id,
                   forwarding.claim_token, forwarding.attempt_count`,
        [batchSize, leaseSeconds]
      );
      const jobs = [];
      for (const row of result.rows) {
        const report = await client.query(
          `SELECT case_number, title, description, created_at FROM public.support_cases
            WHERE organization_id=$1 AND id=$2`,
          [row.organization_id, row.case_id]
        );
        if (report.rowCount !== 1) throw new Error('support forwarding case authority missing');
        jobs.push({ ...row, ...report.rows[0] });
      }
      return jobs;
    });
  }

  async renewForwardingLease(input) {
    return this.transaction(async client => {
      const result = await client.query(
        `UPDATE public.support_case_email_outbox
          SET lease_expires_at=clock_timestamp()+($3::text||' seconds')::interval,
              updated_at=clock_timestamp()
        WHERE id=$1 AND claim_token=$2 AND state='claimed' AND lease_expires_at>clock_timestamp()
        RETURNING id`,
        [input.id, input.claimToken, Math.min(Math.max(Number(input.leaseSeconds) || 30, 5), 300)]
      );
      return result.rowCount === 1;
    });
  }

  async finalizeForwarding(input) {
    const category = typeof input.errorCategory === 'string' && /^[a-z0-9_]{1,64}$/.test(input.errorCategory)
      ? input.errorCategory : 'delivery_failed';
    const retrySeconds = Math.min(3600, 30 * (2 ** Math.max(0, Number(input.attemptCount || 1) - 1)));
    return this.transaction(async client => {
      const result = await client.query(
        `UPDATE public.support_case_email_outbox
          SET state=CASE WHEN $3::boolean THEN 'delivered'
                         WHEN attempt_count>=5 THEN 'dead' ELSE 'retry' END,
              claimed_at=NULL, claim_token=NULL, lease_expires_at=NULL,
              delivered_at=CASE WHEN $3::boolean THEN clock_timestamp() ELSE NULL END,
              dead_at=CASE WHEN NOT $3::boolean AND attempt_count>=5 THEN clock_timestamp() ELSE NULL END,
              available_at=CASE WHEN $3::boolean OR attempt_count>=5 THEN available_at
                                ELSE clock_timestamp()+($5::text||' seconds')::interval END,
              last_error_category=CASE WHEN $3::boolean THEN NULL ELSE $4 END,
              updated_at=clock_timestamp()
        WHERE id=$1 AND claim_token=$2 AND state='claimed' AND lease_expires_at>clock_timestamp()
        RETURNING state`,
        [input.id, input.claimToken, Boolean(input.delivered), category, retrySeconds]
      );
      return result.rows[0] || null;
    });
  }
}

module.exports = {
  MAX_CASES_PER_ACTOR_HOUR,
  STATUS_LABELS,
  SupportCasePersistenceError,
  SupportCaseRepository,
  forwardingState,
};
