/**
 * Audit Log Client
 * V3-19: Append-only audit log storage for security-relevant actions.
 * 
 * Logs every create, update, delete operation with actor, target, before/after state.
 * Stored in-memory with best-effort PostgreSQL persistence.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const safeLogger = require('../observability/safeLogger');

// In-memory log store
const auditLog = [];
const MAX_MEMORY_LOGS = 10000;
const ANONYMOUS_NOT_FOUND_EVENT = 'anonymous_api_not_found';
const ANONYMOUS_NOT_FOUND_COUNT_CAP = 1000;

/**
 * Record an audit log entry.
 * 
 * @param {Object} entry - { actorId, actorRole, action, entityType, entityId, beforeState, afterState, ipAddress, userAgent }
 */
function createEntry(entry) {
  return {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    organizationId: entry.organizationId || null,
    userId: entry.userId || null,
    actorLabel: entry.actorLabel || (entry.userId ? 'authenticated' : 'system'),
    actorRole: entry.actorRole || 'system',
    action: entry.action || 'unknown',
    entityType: entry.entityType || 'unknown',
    entityId: entry.entityId || null,
    beforeState: entry.beforeState || null,
    afterState: entry.afterState || null,
    ipAddress: entry.ipAddress || null,
    userAgent: entry.userAgent || null,
    correlationId: entry.correlationId || null
  };
}

function detailsFor(logEntry) {
  return {
    actorLabel: logEntry.actorLabel,
    role: logEntry.actorRole,
    requestId: logEntry.correlationId,
    correlationId: logEntry.correlationId,
    userAgent: logEntry.userAgent,
    beforeState: logEntry.beforeState,
    afterState: logEntry.afterState,
  };
}

async function persistWith(queryable, logEntry) {
  await queryable.query(
    `INSERT INTO audit_logs
      (organization_id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [logEntry.organizationId, logEntry.userId, logEntry.action,
      logEntry.entityType, logEntry.entityId || '', JSON.stringify(detailsFor(logEntry)),
      logEntry.ipAddress || '', logEntry.createdAt]
  );
}

function remember(logEntry) {
  auditLog.unshift(logEntry);
  if (auditLog.length > MAX_MEMORY_LOGS) auditLog.pop();
  return logEntry;
}

async function recordInTransaction(client, entry) {
  if (!client || typeof client.query !== 'function') throw new TypeError('audit transaction client is required');
  const logEntry = createEntry(entry);
  await persistWith(client, logEntry);
  return logEntry;
}

async function record(entry) {
  const logEntry = createEntry(entry);

  // Persist to PostgreSQL if available
  if (db.isAvailable()) {
    try {
      await persistWith({ query: db.query }, logEntry);
    } catch (_err) {
      safeLogger.warn('audit', 'audit_persistence_failed', {
        requestId: logEntry.correlationId || 'unavailable',
      });
    }
  }

  // Also keep in memory for fast access
  remember(logEntry);
}

function anonymousNotFoundWindow(observedAt) {
  const value = observedAt instanceof Date ? new Date(observedAt.getTime()) : new Date();
  if (!Number.isFinite(value.getTime())) throw new TypeError('anonymous not-found observation time is invalid');
  const bucketStartedAt = new Date(value.getTime());
  bucketStartedAt.setUTCMinutes(0, 0, 0);
  return {
    bucketSlot: bucketStartedAt.getUTCHours(),
    bucketStartedAt: bucketStartedAt.toISOString(),
    lastSeenAt: value.toISOString(),
  };
}

/**
 * Aggregate an unauthenticated API 404 into a fixed 8-method x 24-hour ring.
 * No path, address, user agent, correlation, tenant, or customer value crosses
 * this persistence boundary. Each window saturates at 1,000 observations with
 * a no-update fast path, and this signal never enters the audit memory log.
 */
async function recordAnonymousNotFound(options = {}) {
  if (!db.isAvailable()) {
    safeLogger.warn('audit', 'anonymous_not_found_aggregation_unavailable', {
      requestId: 'unavailable',
    });
    return false;
  }

  const method = safeLogger.methodClass(options.method);
  const window = anonymousNotFoundWindow(options.observedAt);
  try {
    const result = await db.query(
      `INSERT INTO api_observability_hourly AS aggregate
        (event_key, method_class, bucket_slot, bucket_started_at, request_count, last_seen_at)
       VALUES ($1, $2, $3, $4::timestamptz, 1, $5::timestamptz)
       ON CONFLICT (event_key, method_class, bucket_slot) DO UPDATE
         SET bucket_started_at = GREATEST(aggregate.bucket_started_at, EXCLUDED.bucket_started_at),
             request_count = CASE
               WHEN EXCLUDED.bucket_started_at > aggregate.bucket_started_at THEN 1
               WHEN EXCLUDED.bucket_started_at = aggregate.bucket_started_at
                 THEN aggregate.request_count + 1
               ELSE aggregate.request_count
             END,
             last_seen_at = CASE
               WHEN EXCLUDED.bucket_started_at > aggregate.bucket_started_at THEN EXCLUDED.last_seen_at
               WHEN EXCLUDED.bucket_started_at = aggregate.bucket_started_at
                 THEN GREATEST(aggregate.last_seen_at, EXCLUDED.last_seen_at)
               ELSE aggregate.last_seen_at
             END
       WHERE EXCLUDED.bucket_started_at > aggregate.bucket_started_at
          OR (
            EXCLUDED.bucket_started_at = aggregate.bucket_started_at
            AND aggregate.request_count < ${ANONYMOUS_NOT_FOUND_COUNT_CAP}
          )`,
      [ANONYMOUS_NOT_FOUND_EVENT, method, window.bucketSlot, window.bucketStartedAt, window.lastSeenAt]
    );
    if (!result || ![0, 1].includes(result.rowCount)) {
      throw new Error('anonymous_not_found_aggregate_not_written');
    }
    return true;
  } catch (_error) {
    safeLogger.warn('audit', 'anonymous_not_found_aggregation_failed', {
      requestId: 'unavailable',
    });
    return false;
  }
}

/**
 * Query audit logs with filters.
 */
async function query(filters = {}) {
  const { actorId, entityType, action, from, to, ip, page = 1, limit = 50 } = filters;

  let results = [...auditLog];

  if (actorId) results = results.filter(e => e.userId === actorId || e.actorLabel === actorId);
  if (entityType) results = results.filter(e => e.entityType === entityType);
  if (action) results = results.filter(e => e.action === action);
  if (ip) results = results.filter(e => e.ipAddress === ip);
  if (from) results = results.filter(e => new Date(e.createdAt) >= new Date(from));
  if (to) results = results.filter(e => new Date(e.createdAt) <= new Date(to));

  const total = results.length;
  const start = (page - 1) * limit;
  const items = results.slice(start, start + limit);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Verify the migrated audit_logs table contract without creating a competing
 * runtime schema or optional indexes.
 */
async function ensureTable() {
  if (!db.isAvailable()) return;
  try {
    const result = await db.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'audit_logs'`
    );
    const actual = new Set((result && result.rows || []).map(row => row.column_name));
    const required = ['organization_id', 'user_id', 'action', 'entity_type', 'entity_id', 'details', 'ip_address', 'created_at'];
    const missing = required.filter(column => !actual.has(column));
    if (missing.length) {
      safeLogger.warn('audit', 'audit_schema_incompatible');
      return false;
    }
    return true;
  } catch (_err) {
    safeLogger.warn('audit', 'audit_schema_unavailable');
    return false;
  }
}

module.exports = {
  createEntry,
  ensureTable,
  query,
  record,
  recordAnonymousNotFound,
  recordInTransaction,
  remember,
};
