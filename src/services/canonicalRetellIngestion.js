'use strict';

const db = require('../db');
const { ingestRetell, ingestVoice } = require('./canonicalGraphService');
const { getActiveBusinessProfile, resolveIntegrationOwner } = require('./organizationAuthority');
const voiceSessions = require('./voiceSessionAuthority');
const { AccountRepository } = require('../accounts/repository');
const { canPerformExternal, projectSubscription } = require('../accounts/subscriptionPolicy');

const TERMINAL_EVENTS = new Set(['call_ended', 'call_analyzed']);
const KNOWN_SERVICES = ['fence', 'roofing', 'hvac', 'plumbing', 'electrical', 'concrete'];

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function callFrom(payload) {
  return payload && payload.call && typeof payload.call === 'object' ? payload.call : (payload || {});
}

function agentIdentifier(payload) {
  const call = callFrom(payload);
  return text(call.agent_id) || text(payload && payload.agent_id);
}

function callIdentifier(payload) {
  const call = callFrom(payload);
  return text(call.call_id) || text(payload && payload.call_id);
}

function transcriptTurns(payload) {
  const call = callFrom(payload);
  const structured = Array.isArray(call.transcript_object) ? call.transcript_object
    : (Array.isArray(payload && payload.transcript_object) ? payload.transcript_object : null);
  if (structured && structured.length) {
    return structured.map(function (turn, index) {
      const role = String(turn.role || turn.speaker || '').toLowerCase();
      return {
        turnId: 'retell-' + (index + 1),
        speaker: role === 'agent' || role === 'assistant' ? 'agent' : 'customer',
        text: String(turn.words || turn.text || turn.content || '').trim(),
      };
    }).filter(function (turn) { return turn.text; });
  }
  const raw = text(call.transcript) || text(payload && payload.transcript)
    || text(call.call_analysis && call.call_analysis.transcript)
    || text(payload && payload.call_analysis && payload.call_analysis.transcript);
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).map(function (line, index) {
    const match = line.match(/^\s*(agent|assistant|user|customer|caller)\s*:\s*(.*)$/i);
    return {
      turnId: 'retell-' + (index + 1),
      speaker: match && /agent|assistant/i.test(match[1]) ? 'agent' : 'customer',
      text: String(match ? match[2] : line).trim(),
    };
  }).filter(function (turn) { return turn.text; });
  return lines;
}

function analysisFrom(payload) {
  const call = callFrom(payload);
  const analysis = call.call_analysis || (payload && payload.call_analysis) || {};
  const custom = analysis.custom_data || analysis.custom_analysis_data || {};
  return { ...custom, ...analysis };
}

function serviceKey(payload, turns) {
  const analysis = analysisFrom(payload);
  const candidate = [analysis.service_key, analysis.service_type, analysis.service_requested,
    analysis.service, turns.map(function (turn) { return turn.text; }).join(' ')].filter(Boolean).join(' ').toLowerCase();
  return KNOWN_SERVICES.find(function (key) { return candidate.includes(key); }) || 'general';
}

function graphRequest(payload, ownership, voiceSession) {
  const call = callFrom(payload);
  const analysis = analysisFrom(payload);
  const turns = transcriptTurns(payload);
  const callId = callIdentifier(payload);
  return {
    tenantContext: { organizationId: ownership.organizationId, trusted: true },
    idempotencyKey: 'retell-call:' + callId,
    sourceVersion: 'retell-webhook-canonical-v1',
    external: {
      callId,
      transcriptId: callId + ':transcript',
      communicationId: callId + ':communication',
      appointmentId: text(call.appointment_id) || null,
    },
    customer: {
      name: text(analysis.customer_name) || text(call.caller_name) || 'Unknown caller',
      email: text(analysis.customer_email) || text(call.customer_email),
      phone: text(call.from_number) || text(payload && payload.from_number) || text(analysis.customer_phone),
      address: analysis.customer_address || null,
    },
    transcript: turns,
    facts: [],
    service: {
      key: serviceKey(payload, turns),
      scope: analysis.job_scope && typeof analysis.job_scope === 'object' ? analysis.job_scope : {},
    },
    appointmentPreference: analysis.appointment_preference || null,
    scheduledAppointment: analysis.scheduled_appointment || null,
    callDurationSeconds: call.duration_ms !== undefined
      ? Math.max(0, Math.round(Number(call.duration_ms) / 1000))
      : (payload && payload.duration_ms !== undefined ? Math.max(0, Math.round(Number(payload.duration_ms) / 1000)) : null),
    occurredAt: text(call.start_timestamp) || text(call.start_time) || null,
    businessProfileAuthorityId: voiceSession && voiceSession.profile.id,
    businessProfileAuthorityVersion: voiceSession && voiceSession.profile.version,
    businessProfileAuthorityHash: voiceSession && voiceSession.profile.hash,
  };
}

async function completedCall(pool, organizationId, callId) {
  const result = await pool.query(
    `SELECT o.result_status, o.result_body
       FROM canonical_operations o
       JOIN canonical_transcripts t
         ON t.organization_id = o.organization_id AND t.operation_id = o.id
      WHERE o.organization_id = $1 AND t.external_call_id = $2 AND o.state = 'completed'
      LIMIT 1`,
    [organizationId, callId]
  );
  return result.rows[0] || null;
}

async function ingestRetellPayload(payload, options) {
  const pool = (options && options.pool) || db.getPool();
  if (!pool || typeof pool.query !== 'function') {
    return { status: 503, body: { success: false, error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: 'Canonical PostgreSQL persistence is unavailable.' } } };
  }
  const event = text(payload && payload.event);
  try {
    const ownership = await resolveIntegrationOwner(pool, 'retell', agentIdentifier(payload));
    const callId = callIdentifier(payload);
    if (!callId) {
      return { status: 400, body: { success: false, error: { code: 'RETELL_CALL_ID_REQUIRED', message: 'Retell call identifier is required.' } } };
    }
    const subscription = projectSubscription(
      await new AccountRepository(pool).expireAndReadSubscription(ownership.organizationId)
    );
    if (!canPerformExternal(subscription)) {
      throw Object.assign(new Error('Organization subscription access is read-only.'), {
        code: 'SUBSCRIPTION_READ_ONLY', status: 403,
      });
    }
    const call = callFrom(payload);
    let voiceSession = await voiceSessions.findSessionByProviderIdentity(pool, 'retell', callId);
    if (voiceSession && voiceSession.organizationId !== ownership.organizationId) {
      throw Object.assign(new Error('Integration ownership conflicts with the persisted voice session.'), {
        code: 'INTEGRATION_OWNERSHIP_CONFLICT', status: 409,
      });
    }
    if (!voiceSession) {
      const profile = await getActiveBusinessProfile(pool, ownership.organizationId);
      voiceSession = await voiceSessions.createSession(pool, {
        organizationId: ownership.organizationId,
        externalSessionId: callId,
        provider: 'retell',
        providerSessionId: callId,
        integrationOwnershipId: ownership.id,
        profileId: profile.id,
        profileVersion: profile.versionLabel,
        profileHash: profile.profileHash,
        direction: text(call.direction) === 'outbound' ? 'outbound' : 'inbound',
        fromNumber: text(call.from_number),
        toNumber: text(call.to_number),
        metadata: { source: options && options.ingestionSource === 'voice' ? 'voice-webhook' : 'retell-webhook' },
      });
    }
    const authoritySessionId = voiceSession.externalSessionId;
    await voiceSessions.appendEvent(pool, {
      organizationId: ownership.organizationId,
      externalSessionId: authoritySessionId,
      externalEventId: text(payload && payload.event_id),
      eventType: event || 'unknown',
      payload: {
        transcript: transcriptTurns(payload),
        analysis: analysisFrom(payload),
      },
    });
    if (!TERMINAL_EVENTS.has(event)) {
      return { status: 202, body: { received: true, processed: false, canonical: true } };
    }
    const existing = await completedCall(pool, ownership.organizationId, callId);
    if (existing) {
      await voiceSessions.appendEvent(pool, {
        organizationId: ownership.organizationId,
        externalSessionId: authoritySessionId,
        externalEventId: text(payload && payload.event_id),
        eventType: event,
        payload: { replayed: true },
        status: 'completed',
        summary: existing.result_body,
        canonicalOperationId: existing.result_body && existing.result_body.operationId,
      });
      return { status: existing.result_status, body: { ...existing.result_body, received: true, replayed: true }, replayed: true };
    }
    const request = graphRequest(payload, ownership, voiceSession);
    if (!request.transcript.length) {
      return { status: 400, body: { success: false, error: { code: 'RETELL_TRANSCRIPT_REQUIRED', message: 'A completed Retell call requires a transcript.' } } };
    }
    const ingest = options && options.ingestionSource === 'voice' ? ingestVoice : ingestRetell;
    const result = await ingest(pool, request, options);
    await voiceSessions.appendEvent(pool, {
      organizationId: ownership.organizationId,
      externalSessionId: authoritySessionId,
      externalEventId: text(payload && payload.event_id),
      eventType: event,
      payload: { graphStatus: result.status },
      status: result.status === 201 ? 'completed' : 'failed',
      summary: result.body,
      canonicalOperationId: result.body && result.body.operationId,
    });
    return { ...result, body: { ...result.body, received: result.status === 201 } };
  } catch (error) {
    const status = error && error.status ? error.status : 503;
    const code = error && error.code ? error.code : 'CANONICAL_PERSISTENCE_UNAVAILABLE';
    return {
      status,
      body: {
        success: false,
        error: {
          code,
          message: status === 503 ? 'Canonical PostgreSQL persistence is unavailable.' : error.message,
        },
      },
    };
  }
}

async function handleCanonicalRetellWebhook(req, res) {
  const result = await ingestRetellPayload(req.body || {});
  return res.status(result.status).json(result.body);
}

module.exports = {
  agentIdentifier,
  callIdentifier,
  graphRequest,
  handleCanonicalRetellWebhook,
  ingestRetellPayload,
  transcriptTurns,
};
