/**
 * Audit Log Client
 * V3-19: Append-only audit log storage for security-relevant actions.
 * 
 * Logs every create, update, delete operation with actor, target, before/after state.
 * Stored in-memory with best-effort PostgreSQL persistence.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// In-memory log store
const auditLog = [];
const MAX_MEMORY_LOGS = 10000;

/**
 * Record an audit log entry.
 * 
 * @param {Object} entry - { actorId, actorRole, action, entityType, entityId, beforeState, afterState, ipAddress, userAgent }
 */
async function record(entry) {
  const logEntry = {
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

  // Persist to PostgreSQL if available
  if (db.isAvailable()) {
    try {
      const details = {
        actorLabel: logEntry.actorLabel,
        role: logEntry.actorRole,
        requestId: logEntry.correlationId,
        correlationId: logEntry.correlationId,
        userAgent: logEntry.userAgent,
        beforeState: logEntry.beforeState,
        afterState: logEntry.afterState,
      };
      await db.query(
        `INSERT INTO audit_logs
          (organization_id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [logEntry.organizationId, logEntry.userId, logEntry.action,
         logEntry.entityType, logEntry.entityId || '', JSON.stringify(details),
         logEntry.ipAddress || '', logEntry.createdAt]
      );
    } catch (_err) {
      console.warn('[Audit] Persistence warning:', {
        requestId: logEntry.correlationId || 'unavailable',
        event: 'audit_persistence_failed',
      });
    }
  }

  // Also keep in memory for fast access
  auditLog.unshift(logEntry);
  if (auditLog.length > MAX_MEMORY_LOGS) auditLog.pop();
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
      console.warn('[Audit] Schema verification warning:', {
        event: 'audit_schema_incompatible',
        missingColumns: missing,
      });
      return false;
    }
    return true;
  } catch (_err) {
    console.warn('[Audit] Schema verification warning:', {
      event: 'audit_schema_unavailable',
    });
    return false;
  }
}

module.exports = { record, query, ensureTable };
