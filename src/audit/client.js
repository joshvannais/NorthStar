/**
 * Audit Log Client
 * V3-19: Append-only audit log storage for security-relevant actions.
 * 
 * Logs every create, update, delete operation with actor, target, before/after state.
 * Stored in-memory with optional PostgreSQL persistence.
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
    timestamp: new Date().toISOString(),
    actorId: entry.actorId || 'system',
    actorRole: entry.actorRole || 'system',
    action: entry.action || 'unknown',
    entityType: entry.entityType || 'unknown',
    entityId: entry.entityId || null,
    beforeState: entry.beforeState ? JSON.stringify(entry.beforeState) : null,
    afterState: entry.afterState ? JSON.stringify(entry.afterState) : null,
    ipAddress: entry.ipAddress || null,
    userAgent: entry.userAgent || null,
    correlationId: entry.correlationId || null
  };

  // Persist to PostgreSQL if available
  if (db.isAvailable()) {
    try {
      await db.query(
        `INSERT INTO audit_logs (id, actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, ip_address, user_agent, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [logEntry.id, logEntry.actorId, logEntry.actorRole, logEntry.action,
         logEntry.entityType, logEntry.entityId, logEntry.beforeState, logEntry.afterState,
         logEntry.ipAddress, logEntry.userAgent, logEntry.correlationId]
      );
    } catch (err) {
      console.warn('[Audit] DB insert failed:', err.message);
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

  if (actorId) results = results.filter(e => e.actorId === actorId);
  if (entityType) results = results.filter(e => e.entityType === entityType);
  if (action) results = results.filter(e => e.action === action);
  if (ip) results = results.filter(e => e.ipAddress === ip);
  if (from) results = results.filter(e => new Date(e.timestamp) >= new Date(from));
  if (to) results = results.filter(e => new Date(e.timestamp) <= new Date(to));

  const total = results.length;
  const start = (page - 1) * limit;
  const items = results.slice(start, start + limit);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Ensure the audit_logs table exists in PostgreSQL.
 */
async function ensureTable() {
  if (!db.isAvailable()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT NOW(),
        actor_id VARCHAR(255) NOT NULL,
        actor_role VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(255),
        before_state JSONB,
        after_state JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        correlation_id VARCHAR(255)
      );
    `);
    // Add index for common queries
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)`);
  } catch (err) {
    console.warn('[Audit] Table creation warning:', err.message);
  }
}

module.exports = { record, query, ensureTable };