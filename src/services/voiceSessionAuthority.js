'use strict';

const crypto = require('crypto');
const repository = require('../persistence/v2/repository');
const { stableValue } = require('./businessProfileAdapter');
const { authorityError } = require('./organizationAuthority');

const RUNTIME_OWNER_ID = process.pid + ':' + crypto.randomUUID();
const runtimeHandles = new Map();
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw authorityError('CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.', 503);
  }
  return pool;
}

function runtimeKey(organizationId, externalSessionId) {
  return String(organizationId) + ':' + String(externalSessionId);
}

function projectSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    externalSessionId: row.external_session_id,
    callId: row.external_session_id,
    providerSessionId: row.provider_session_id || null,
    provider: row.provider,
    status: row.status,
    direction: row.direction,
    fromNumber: row.from_number || '',
    toNumber: row.to_number || '',
    runtimeOwnerId: row.runtime_owner_id,
    profile: {
      id: row.business_profile_id,
      version: row.business_profile_version,
      hash: row.business_profile_hash,
    },
    metadata: row.metadata || {},
    summary: row.summary || null,
    canonicalOperationId: row.canonical_operation_id || null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    eventCount: row.event_count === undefined ? undefined : Number(row.event_count),
  };
}

const SELECT_SESSION = `SELECT s.*,
  (SELECT COUNT(*)::int FROM canonical_voice_session_events e
    WHERE e.organization_id = s.organization_id AND e.voice_session_id = s.id) AS event_count
  FROM canonical_voice_sessions s`;

async function createSession(pool, input) {
  const source = requirePool(pool);
  const externalSessionId = String(input.externalSessionId || '').trim();
  if (!externalSessionId) throw authorityError('VOICE_SESSION_ID_REQUIRED', 'Voice session identifier is required.', 400);
  const result = await source.query(
    `INSERT INTO canonical_voice_sessions
      (organization_id, external_session_id, provider, provider_session_id, integration_ownership_id,
       business_profile_id, business_profile_version, business_profile_hash,
       status, direction, from_number, to_number, runtime_owner_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     ON CONFLICT (organization_id, external_session_id) DO NOTHING
     RETURNING *`,
    [input.organizationId, externalSessionId, input.provider || 'voice', input.providerSessionId || null,
      input.integrationOwnershipId,
      input.profileId, input.profileVersion, input.profileHash, input.status || 'active',
      input.direction || 'inbound', input.fromNumber || null, input.toNumber || null,
      input.runtimeOwned ? RUNTIME_OWNER_ID : null, JSON.stringify(stableValue(input.metadata || {}))]
  );
  if (result.rows.length === 1) return projectSession(result.rows[0]);
  return getSession(source, input.organizationId, externalSessionId);
}

async function assignProviderIdentity(pool, input) {
  const providerSessionId = String(input.providerSessionId || '').trim();
  if (!providerSessionId) {
    throw authorityError('VOICE_PROVIDER_SESSION_REQUIRED', 'The voice provider did not return a session identifier.', 502);
  }
  return repository.withTransaction(requirePool(pool), async function (client) {
    const current = await client.query(
      `SELECT id FROM canonical_voice_sessions
        WHERE organization_id = $1 AND external_session_id = $2 FOR UPDATE`,
      [input.organizationId, String(input.externalSessionId)]
    );
    if (current.rows.length !== 1) {
      throw authorityError('VOICE_SESSION_NOT_FOUND', 'Voice session not found.', 404);
    }
    try {
      const updated = await client.query(
        `UPDATE canonical_voice_sessions
            SET external_session_id = $3,
                provider_session_id = $3,
                metadata = metadata || $4::jsonb,
                updated_at = NOW()
          WHERE organization_id = $1 AND external_session_id = $2
          RETURNING *`,
        [input.organizationId, String(input.externalSessionId), providerSessionId,
          JSON.stringify(stableValue({ providerSessionId }))]
      );
      return projectSession(updated.rows[0]);
    } catch (error) {
      if (error && error.code === '23505') {
        throw authorityError('VOICE_PROVIDER_SESSION_CONFLICT', 'The provider session identity is already bound.', 409);
      }
      throw error;
    }
  });
}

async function attachProviderIdentity(pool, input) {
  const providerSessionId = String(input.providerSessionId || '').trim();
  if (!providerSessionId) {
    throw authorityError('VOICE_PROVIDER_SESSION_REQUIRED', 'The voice provider did not return a session identifier.', 502);
  }
  try {
    const updated = await requirePool(pool).query(
      `UPDATE canonical_voice_sessions
          SET provider_session_id = $3,
              metadata = metadata || $4::jsonb,
              updated_at = NOW()
        WHERE organization_id = $1 AND external_session_id = $2
        RETURNING *`,
      [input.organizationId, String(input.externalSessionId), providerSessionId,
        JSON.stringify(stableValue({ providerSessionId }))]
    );
    if (updated.rows.length !== 1) {
      throw authorityError('VOICE_SESSION_NOT_FOUND', 'Voice session not found.', 404);
    }
    return projectSession(updated.rows[0]);
  } catch (error) {
    if (error && error.code === '23505') {
      throw authorityError('VOICE_PROVIDER_SESSION_CONFLICT', 'The provider session identity is already bound.', 409);
    }
    throw error;
  }
}

async function findSessionByProviderIdentity(pool, provider, providerSessionId) {
  const identifier = String(providerSessionId || '').trim();
  if (!identifier) return null;
  const result = await requirePool(pool).query(
    SELECT_SESSION + ' WHERE s.provider = $1 AND s.provider_session_id = $2',
    [String(provider), identifier]
  );
  if (result.rows.length > 1) {
    throw authorityError('VOICE_PROVIDER_SESSION_CONFLICT', 'The provider session identity is ambiguous.', 409);
  }
  return result.rows.length === 1 ? projectSession(result.rows[0]) : null;
}

async function getSession(pool, organizationId, externalSessionId) {
  const result = await requirePool(pool).query(
    SELECT_SESSION + ' WHERE s.organization_id = $1 AND s.external_session_id = $2',
    [organizationId, String(externalSessionId)]
  );
  if (result.rows.length !== 1) throw authorityError('VOICE_SESSION_NOT_FOUND', 'Voice session not found.', 404);
  return projectSession(result.rows[0]);
}

async function listSessions(pool, organizationId, includeCompleted) {
  const values = [organizationId];
  const terminalFilter = includeCompleted ? '' : " AND s.status IN ('active', 'escalating')";
  const result = await requirePool(pool).query(
    SELECT_SESSION + ' WHERE s.organization_id = $1' + terminalFilter + ' ORDER BY s.started_at DESC, s.id',
    values
  );
  return result.rows.map(projectSession);
}

async function appendEventWithClient(client, input) {
  const source = requirePool(client);
  const eventType = String(input.eventType);
  const eventPayload = stableValue(input.payload || {});
  const eventPayloadJson = JSON.stringify(eventPayload);
  const session = await source.query(
    'SELECT id FROM canonical_voice_sessions WHERE organization_id = $1 AND external_session_id = $2 FOR UPDATE',
    [input.organizationId, String(input.externalSessionId)]
  );
  if (session.rows.length !== 1) throw authorityError('VOICE_SESSION_NOT_FOUND', 'Voice session not found.', 404);
  const inserted = await source.query(
    `INSERT INTO canonical_voice_session_events
      (organization_id, voice_session_id, external_event_id, event_type, payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,COALESCE($6::timestamptz,NOW()))
     ON CONFLICT (organization_id, voice_session_id, external_event_id)
       WHERE external_event_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [input.organizationId, session.rows[0].id, input.externalEventId || null,
      eventType, eventPayloadJson, input.occurredAt || null]
  );
  if (inserted.rows.length === 0 && input.requireSemanticMatch && input.externalEventId) {
    const existing = await source.query(
      `SELECT event_type, payload
         FROM canonical_voice_session_events
        WHERE organization_id = $1 AND voice_session_id = $2 AND external_event_id = $3
        FOR UPDATE`,
      [input.organizationId, session.rows[0].id, input.externalEventId]
    );
    const matches = existing.rows.length === 1 &&
      existing.rows[0].event_type === eventType &&
      JSON.stringify(stableValue(existing.rows[0].payload || {})) === eventPayloadJson;
    if (!matches) {
      throw authorityError(
        'VOICE_EVENT_IDENTITY_CONFLICT',
        'The provider event identity was already used for different event data.',
        409
      );
    }
  }
  if (input.status && inserted.rows.length === 1) {
    const terminal = TERMINAL_STATUSES.has(input.status);
    await source.query(
      `UPDATE canonical_voice_sessions
          SET status = $3, summary = COALESCE($4::jsonb, summary),
              canonical_operation_id = COALESCE($5::uuid, canonical_operation_id),
              completed_at = CASE WHEN $6 THEN COALESCE(completed_at, NOW()) ELSE NULL END,
              updated_at = NOW()
        WHERE organization_id = $1 AND external_session_id = $2`,
      [input.organizationId, String(input.externalSessionId), input.status,
        input.summary === undefined ? null : JSON.stringify(stableValue(input.summary)),
        input.canonicalOperationId || null, terminal]
    );
  }
  return { inserted: inserted.rows.length === 1, session: await getSession(source, input.organizationId, input.externalSessionId) };
}

async function appendEvent(pool, input) {
  return repository.withTransaction(requirePool(pool), client => appendEventWithClient(client, input));
}

async function timeline(pool, organizationId, externalSessionId) {
  const session = await getSession(pool, organizationId, externalSessionId);
  const result = await requirePool(pool).query(
    `SELECT external_event_id, event_type, payload, occurred_at
       FROM canonical_voice_session_events
      WHERE organization_id = $1 AND voice_session_id = $2
      ORDER BY occurred_at, created_at, id`,
    [organizationId, session.id]
  );
  return result.rows.map(function (row) {
    return { eventId: row.external_event_id, event: row.event_type, payload: row.payload || {}, occurredAt: row.occurred_at };
  });
}

function registerRuntimeHandle(organizationId, externalSessionId, handle) {
  if (!handle || typeof handle !== 'object') throw new TypeError('runtime handle is required');
  runtimeHandles.set(runtimeKey(organizationId, externalSessionId), handle);
}

function unregisterRuntimeHandle(organizationId, externalSessionId) {
  runtimeHandles.delete(runtimeKey(organizationId, externalSessionId));
}

async function requireRuntimeHandle(pool, organizationId, externalSessionId) {
  const session = await getSession(pool, organizationId, externalSessionId);
  const handle = runtimeHandles.get(runtimeKey(organizationId, externalSessionId));
  if (session.runtimeOwnerId !== RUNTIME_OWNER_ID || !handle) {
    throw authorityError('VOICE_RUNTIME_UNAVAILABLE', 'The live voice runtime is temporarily unavailable.', 503);
  }
  return { session, handle };
}

async function performRuntimeAction(pool, input) {
  const runtime = await requireRuntimeHandle(pool, input.organizationId, input.externalSessionId);
  const action = String(input.action);
  if (typeof runtime.handle[action] !== 'function') {
    throw authorityError('VOICE_RUNTIME_UNAVAILABLE', 'The live voice runtime is temporarily unavailable.', 503);
  }
  await runtime.handle[action](input.reason || null);
  const status = action === 'cancel' ? 'cancelled' : 'escalating';
  return appendEvent(pool, {
    organizationId: input.organizationId,
    externalSessionId: input.externalSessionId,
    externalEventId: input.eventId || null,
    eventType: action === 'cancel' ? 'call_cancelled' : 'human_handoff',
    payload: { reason: input.reason || null, requestedBy: input.userId || null },
    status,
  });
}

function clearRuntimeHandlesForTests() {
  runtimeHandles.clear();
}

module.exports = {
  RUNTIME_OWNER_ID,
  attachProviderIdentity,
  assignProviderIdentity,
  appendEvent,
  appendEventWithClient,
  clearRuntimeHandlesForTests,
  createSession,
  findSessionByProviderIdentity,
  getSession,
  listSessions,
  performRuntimeAction,
  registerRuntimeHandle,
  requireRuntimeHandle,
  timeline,
  unregisterRuntimeHandle,
};
