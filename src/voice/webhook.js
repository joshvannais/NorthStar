/**
 * Retell Voice Webhook Framework — Part 4
 *
 * Secure webhook handling for Retell AI call events.
 * Canonical signed voice webhook transport with provider-global replay state.
 *
 * Security:
 * - HMAC-SHA256 signature validation
 * - Embedded millisecond timestamp check (±5min)
 * - Durable PostgreSQL replay protection (24h window)
 * - 10s handler timeout
 */

'use strict';

const crypto = require('crypto');
const businessEvents = require('./businessEvents');
const transcriptStream = require('./transcriptStream');
const audit = require('../audit/client');
const { requestAuditEntry } = require('../middleware/auditLog');
const {
  callIdentifier,
  ingestRetellPayload,
  providerEventIdentity,
} = require('../services/canonicalRetellIngestion');
const replayAuthority = require('../retell/webhookReplayAuthority');

// ── Configuration ──────────────────────────────────────────────
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const HANDLER_TIMEOUT_MS = 10000;
const OFFICIAL_SIGNATURE = /^v=(\d+),d=([0-9a-f]{64})$/;

// Each in-flight business-event handler owns exactly one timeout. Entries are
// keyed by Retell event ID so replacement, cancellation, and shutdown can
// retire obsolete callbacks before they can fire.
const pendingHandlerTimeouts = new Map();
let anonymousHandlerSequence = 0;
let acceptingEvents = true;

function createLifecycleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function handlerKey(payload) {
  if (payload.event_id) return payload.event_id;
  if (payload.call_id) return (payload.event || 'event') + ':' + payload.call_id;
  anonymousHandlerSequence += 1;
  return (payload.event || 'event') + ':anonymous:' + anonymousHandlerSequence;
}

function beginHandlerTimeout(key) {
  const previous = pendingHandlerTimeouts.get(key);
  if (previous) {
    previous.cancel('HANDLER_REPLACED', 'Handler replaced by a newer event');
  }

  let settled = false;
  let timer = null;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });

  const entry = {
    key,
    deadline,
    complete() {
      if (settled) return false;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (pendingHandlerTimeouts.get(key) === entry) {
        pendingHandlerTimeouts.delete(key);
      }
      return true;
    },
    cancel(code, message) {
      if (settled) return false;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (pendingHandlerTimeouts.get(key) === entry) {
        pendingHandlerTimeouts.delete(key);
      }
      rejectDeadline(createLifecycleError(code, message));
      return true;
    },
  };

  timer = setTimeout(() => {
    if (settled || pendingHandlerTimeouts.get(key) !== entry) return;
    settled = true;
    timer = null;
    pendingHandlerTimeouts.delete(key);
    rejectDeadline(createLifecycleError('HANDLER_TIMEOUT', 'Handler timeout'));
  }, HANDLER_TIMEOUT_MS);

  pendingHandlerTimeouts.set(key, entry);
  return entry;
}

function cancelPendingEvent(eventId) {
  const entry = pendingHandlerTimeouts.get(eventId);
  if (!entry) return false;
  return entry.cancel('HANDLER_CANCELLED', 'Handler cancelled');
}

function cancelAllPendingHandlers(code, message) {
  const entries = Array.from(pendingHandlerTimeouts.values());
  entries.forEach((entry) => entry.cancel(code, message));
  return entries.length;
}

function start() {
  const cancelled = cancelAllPendingHandlers('HANDLER_REPLACED', 'Webhook lifecycle restarted');
  acceptingEvents = true;
  return cancelled;
}

function shutdown() {
  acceptingEvents = false;
  return cancelAllPendingHandlers('WEBHOOK_SHUTDOWN', 'Webhook shutdown');
}

/**
 * Retell designates one API key for webhook signing. Availability of the live
 * provider-side designation is an external configuration gate.
 */
function getWebhookApiKey() {
  return process.env.RETELL_API_KEY || '';
}

// ── Deduplication ──────────────────────────────────────────────

// ── Signature Validation ───────────────────────────────────────

/**
 * Parse the complete official Retell signature header. The timestamp is part
 * of this header and is never accepted from another header or the body.
 *
 * @param {string} signature - Value of the X-Retell-Signature header
 * @returns {{timestamp:string,digest:string}|null}
 */
function parseSignature(signature) {
  if (typeof signature !== 'string') return null;
  const match = signature.match(OFFICIAL_SIGNATURE);
  if (!match) return null;
  return { timestamp: match[1], digest: match[2] };
}

/**
 * Validate HMAC-SHA256 signature from Retell. Retell signs the exact raw body
 * string concatenated with the exact embedded Unix-millisecond timestamp.
 *
 * @param {string|Buffer} rawBody - Raw request body
 * @param {string} signature - Value of the X-Retell-Signature header
 * @returns {boolean}
 */
function validateSignature(rawBody, signature) {
  const apiKey = getWebhookApiKey();
  const parsed = parseSignature(signature);
  if (!apiKey) {
    console.warn('[Voice:Webhook] Signature validation unavailable');
    return false;
  }

  if (!parsed) {
    console.warn('[Voice:Webhook] Missing X-Retell-Signature header');
    return false;
  }

  try {
    const computed = crypto
      .createHmac('sha256', apiKey)
      .update(rawBody)
      .update(parsed.timestamp, 'ascii')
      .digest();

    // Both buffers are fixed-size before the constant-time comparison.
    const received = Buffer.from(parsed.digest, 'hex');
    return received.length === computed.length && crypto.timingSafeEqual(received, computed);
  } catch (err) {
    console.error('[Voice:Webhook] Signature validation error:', err.message);
    return false;
  }
}

// ── Timestamp Validation ───────────────────────────────────────

/**
 * Check that the webhook timestamp is within ±5 minutes of current time.
 *
 * @param {string} timestamp - Unix timestamp in milliseconds from the signature
 * @returns {boolean}
 */
function validateTimestamp(timestamp) {
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) {
    console.warn('[Voice:Webhook] Missing timestamp');
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || ts <= 0) return false;
  const now = Date.now();
  const diff = Math.abs(now - ts);

  if (diff > MAX_AGE_MS) {
    console.warn(`[Voice:Webhook] Timestamp outside ±5min window: diff=${diff}ms`);
    return false;
  }

  return true;
}

// ── Event Routing ──────────────────────────────────────────────

/** Supported event types */
const SUPPORTED_EVENTS = Object.freeze(['call_started', 'call_ended', 'call_analyzed', 'transcript_ready', 'transcript', 'ping']);

function isSupportedEvent(event) {
  return typeof event === 'string' && SUPPORTED_EVENTS.includes(event);
}

/**
 * Map Retell raw event names to our standardized business event types.
 */
const EVENT_TYPE_MAP = {
  call_started: 'call_started',
  call_ended: 'call_completed',
  call_analyzed: 'call_completed',
  transcript_ready: null,  // Handled separately via transcriptStream
  transcript: null,        // Handled separately via transcriptStream
  ping: null,              // No business event for ping
};

/**
 * Route a Retell event to the appropriate handler.
 * Handlers are given a 10s timeout.
 *
 * @param {Object} payload - Parsed webhook body
 * @returns {Promise<Object>} Result summary
 */
async function routeEvent(payload) {
  const event = payload.event;
  const eventId = payload.event_id || payload.call_id || '';

  if (!isSupportedEvent(event)) {
    console.warn(`[Voice:Webhook] Unknown or missing event type: ${event}`);
    return { received: true, routed: false, reason: 'unknown_event' };
  }

  if (!acceptingEvents) {
    return { received: true, routed: false, reason: 'webhook_shutdown', event, eventId };
  }

  console.log(`[Voice:Webhook] Routing event: ${event} (id: ${eventId})`);

  // ── Handle transcript events (streamed during call) ──
  if (event === 'transcript_ready' || event === 'transcript') {
    try {
      const sessionId = payload.call_id || eventId;
      const segments = payload.transcript || payload.transcript_segments || [];

      if (event === 'transcript_ready' && Array.isArray(segments)) {
        // Batch of transcript segments from Retell
        for (const seg of segments) {
          transcriptStream.addSegment(sessionId, {
            text: seg.text || seg.content || '',
            speaker: seg.speaker || seg.role || 'unknown',
            timestamp: seg.timestamp || new Date().toISOString(),
          });
        }
        console.log(`[Voice:Webhook] Processed ${segments.length} transcript segments for session ${sessionId}`);
      } else if (event === 'transcript') {
        // Full/partial transcript update — update last segment
        const text = payload.transcript || payload.text || '';
        const speaker = payload.speaker || payload.role || 'unknown';
        if (text) {
          transcriptStream.updateLastSegment(sessionId, {
            text,
            speaker,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error(`[Voice:Webhook] Transcript handling error for ${event}:`, err.message);
    }

    // Transcript events are acked immediately — no business event needed
    return { received: true, routed: true, event, eventId, handler: 'transcript' };
  }

  // Emit business event for supported types
  const businessEventType = EVENT_TYPE_MAP[event];
  if (businessEventType) {
    let handlerTimeout = null;
    try {
      const bizEvent = {
        type: businessEventType,
        sessionId: payload.call_id || eventId,
        timestamp: new Date().toISOString(),
        data: {
          retellEvent: event,
          callId: payload.call_id,
          transcript: payload.transcript || null,
          analysis: payload.call_analysis || null,
          duration: payload.duration_ms || 0,
          fromNumber: payload.from_number || '',
          toNumber: payload.to_number || '',
          direction: payload.direction || 'inbound',
        },
        source: 'retell',
      };

      // Emit with timeout
      handlerTimeout = beginHandlerTimeout(handlerKey(payload));
      const emitPromise = Promise.resolve().then(() => businessEvents.emit(bizEvent));
      await Promise.race([emitPromise, handlerTimeout.deadline]);
    } catch (err) {
      const expectedCancellation = err && (
        err.code === 'HANDLER_REPLACED' ||
        err.code === 'HANDLER_CANCELLED' ||
        err.code === 'WEBHOOK_SHUTDOWN'
      );
      if (!expectedCancellation) {
        console.error(`[Voice:Webhook] Event handler error for ${event}:`, err.message);
      }
      // Don't fail the webhook response — Retell will retry if we 500
    } finally {
      if (handlerTimeout) handlerTimeout.complete();
    }
  }

  return { received: true, routed: true, event, eventId };
}

// ── Main Handler ───────────────────────────────────────────────

function requestRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  return null;
}

function supportedJsonContentType(req) {
  const contentType = String(req.headers && req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return contentType === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(contentType);
}

function decodeWebhookBody(rawBody) {
  if (!rawBody || rawBody.length === 0) throw new Error('empty');
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
  const payload = JSON.parse(decoded);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('shape');
  return payload;
}

function acceptedWebhookAuditEntry(req, canonical, ingestionSource, duration) {
  const context = canonical && canonical.auditContext;
  if (!context || !context.organizationId || !context.voiceSessionId || context.source !== ingestionSource) {
    const error = new Error('Canonical webhook audit attribution is unavailable');
    error.code = 'webhook_audit_attribution_unavailable';
    throw error;
  }
  const entry = requestAuditEntry(req, canonical.status, duration);
  return {
    ...entry,
    organizationId: context.organizationId,
    userId: null,
    actorLabel: 'provider',
    actorRole: 'system',
    action: 'retell_webhook.accepted',
    entityType: 'canonical_voice_session',
    entityId: context.voiceSessionId,
    afterState: {
      ...entry.afterState,
      provider: 'retell',
      source: context.source,
      accepted: true,
    },
  };
}

/**
 * Handle a signed Retell webhook without decoding JSON until the official
 * HMAC/timestamp contract and durable cross-process replay claim have passed.
 */
async function handleSignedWebhook(req, res, ingestionSource) {
  const startTime = Date.now();
  const rawBody = requestRawBody(req) || Buffer.alloc(0);
  const signature = req.headers['x-retell-signature'] || '';
  const fingerprint = replayAuthority.requestFingerprint(rawBody);
  let replayClaim = null;

  async function releaseClaim() {
    if (!replayClaim) return;
    const released = await replayAuthority.releaseWebhookDelivery({
      requestFingerprint: fingerprint,
      claimToken: replayClaim.claimToken,
    });
    if (!released) throw new Error('Retell webhook replay claim release failed');
    replayClaim = null;
  }

  try {
    // 1. Parse the exact official composite header. Missing runtime validation
    // material intentionally returns the same response as a bad digest.
    const parsedSignature = parseSignature(signature);
    if (!parsedSignature) {
      return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
    }

    // 2. Retell embeds a strict Unix-millisecond timestamp in the signature.
    if (!validateTimestamp(parsedSignature.timestamp)) {
      return res.status(400).json({ error: { code: 'INVALID_TIMESTAMP', message: 'Timestamp outside acceptable window' } });
    }

    if (!validateSignature(rawBody, signature)) {
      return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
    }

    // 3. The provider-global PostgreSQL claim is visible to every application
    // process before content-type checks, JSON decoding, or canonical ingestion.
    const claimResult = await replayAuthority.claimWebhookDelivery({ requestFingerprint: fingerprint });
    if (claimResult.kind !== 'claimed') {
      if (claimResult.kind === 'saturated') {
        return res.status(503).json({
          error: { code: 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE', message: 'Webhook replay protection is unavailable' },
        });
      }
      return res.status(409).json({ error: { code: 'WEBHOOK_REPLAYED', message: 'Webhook request was already received' } });
    }
    replayClaim = claimResult;

    if (!supportedJsonContentType(req)) {
      await releaseClaim();
      return res.status(415).json({ error: { code: 'UNSUPPORTED_WEBHOOK_MEDIA_TYPE', message: 'Webhook body must be JSON' } });
    }

    let payload;
    try {
      payload = decodeWebhookBody(rawBody);
    } catch (_error) {
      await releaseClaim();
      return res.status(400).json({ error: { code: 'INVALID_WEBHOOK_BODY', message: 'Webhook body must be valid JSON' } });
    }
    req.body = payload;
    if (!isSupportedEvent(payload.event)) {
      await releaseClaim();
      return res.status(400).json({
        error: { code: 'UNSUPPORTED_WEBHOOK_EVENT', message: 'Webhook event type is not supported' },
      });
    }
    console.log(`[Voice:Webhook] Received supported event: ${payload.event}`);

    // 4. Canonical session/event/graph state, one accepted audit row, and the
    // token-owned replay transition share one recoverable PostgreSQL outcome.
    const outcome = await replayAuthority.finalizeWebhookDelivery({
      requestFingerprint: fingerprint,
      claimToken: replayClaim.claimToken,
    }, async client => {
      const canonical = await ingestRetellPayload(payload, {
        ingestionSource,
        transactionClient: client,
      });
      if (canonical.status < 200 || canonical.status >= 300) {
        return { accepted: false, canonical };
      }
      const auditEntry = await audit.recordInTransaction(
        client,
        acceptedWebhookAuditEntry(req, canonical, ingestionSource, Date.now() - startTime)
      );
      return { accepted: true, auditEntry, canonical };
    });
    replayClaim = null;
    try { audit.remember(outcome.auditEntry); } catch (_memoryError) { /* PostgreSQL is authoritative. */ }
    const canonical = outcome.canonical;

    const elapsed = Date.now() - startTime;
    console.log(`[Voice:Webhook] Completed: ${payload.event} (${elapsed}ms)`);
    return res.status(canonical.status).json(canonical.body);
  } catch (err) {
    if (replayClaim) {
      try { await releaseClaim(); } catch (_releaseError) { /* The fail-closed 503 remains authoritative. */ }
    }
    if (err instanceof replayAuthority.WebhookDeliveryRejected &&
        err.outcome && err.outcome.canonical) {
      return res.status(err.outcome.canonical.status).json(err.outcome.canonical.body);
    }
    console.error('[Voice:Webhook] Fatal signed webhook error:', err.message);
    const replayUnavailable = err && (
      err.code === 'webhook_replay_persistence_unavailable' ||
      err.code === 'webhook_replay_claim_ownership_mismatch'
    );
    return res.status(503).json({
      success: false,
      error: replayUnavailable
        ? { code: 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE', message: 'Webhook replay protection is unavailable' }
        : { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: 'Canonical PostgreSQL persistence is unavailable.' },
    });
  }
}

function handleWebhook(req, res) {
  return handleSignedWebhook(req, res, 'voice');
}

function handleRetellWebhook(req, res) {
  return handleSignedWebhook(req, res, 'retell');
}

/**
 * Create Express middleware for raw body capture (needed for HMAC validation).
 * Must be applied before express.json() on the webhook route.
 *
 * Usage:
 *   router.post('/webhook', rawBodyCapture, express.json(), handleWebhook)
 */
function rawBodyCapture(req, res, next) {
  if (typeof req.rawBody === 'string') return next();
  if (req.readableEnded) {
    req.rawBody = JSON.stringify(req.body || {});
    return next();
  }
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
}

module.exports = {
  handleWebhook,
  handleRetellWebhook,
  rawBodyCapture,
  parseSignature,
  providerEventIdentity,
  isSupportedEvent,
  SUPPORTED_EVENTS,
  validateSignature,
  validateTimestamp,
  routeEvent,
  cancelPendingEvent,
  start,
  shutdown,
  MAX_AGE_MS,
};
