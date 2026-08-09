/**
 * Retell Voice Webhook Framework — Part 4
 *
 * Secure webhook handling for Retell AI call events.
 * Canonical signed voice webhook transport. The retired process-local Retell
 * webhook implementation has been removed.
 *
 * Security:
 * - HMAC-SHA256 signature validation
 * - Timestamp check (±5min replay protection)
 * - Event ID deduplication (24h window)
 * - 10s handler timeout
 */

'use strict';

const crypto = require('crypto');
const businessEvents = require('./businessEvents');
const transcriptStream = require('./transcriptStream');
const { ingestRetellPayload } = require('../services/canonicalRetellIngestion');

// ── Configuration ──────────────────────────────────────────────
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_REPLAY_ENTRIES = 10000;
const HANDLER_TIMEOUT_MS = 10000;

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
 * Get the webhook secret dynamically (supports runtime env changes).
 */
function getWebhookSecret() {
  return process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY || '';
}

// This bounded replay store is intentionally process-local. A process restart
// clears it; durable canonical idempotency remains the cross-process fallback.
const dedupStore = new Map();

// ── Deduplication ──────────────────────────────────────────────

function cleanReplayStore(now) {
  for (const [id, timestamp] of dedupStore.entries()) {
    if (now - timestamp > DEDUP_TTL_MS) dedupStore.delete(id);
  }
}

/**
 * Atomically check and claim one replay key before the handler yields.
 * Saturation fails closed instead of evicting a live claim.
 */
function claimReplay(replayKey) {
  if (!replayKey) return { claimed: false, reason: 'missing' };
  const now = Date.now();
  cleanReplayStore(now);
  if (dedupStore.has(replayKey)) return { claimed: false, reason: 'replayed' };
  if (dedupStore.size >= MAX_REPLAY_ENTRIES) return { claimed: false, reason: 'saturated' };
  dedupStore.set(replayKey, now);
  return { claimed: true, reason: null };
}

function releaseReplay(replayKey) {
  return replayKey ? dedupStore.delete(replayKey) : false;
}

/**
 * Check if an event_id has been processed within the dedup window.
 * Also cleans up expired entries.
 */
function isDuplicate(eventId) {
  if (!eventId) return false;
  return claimReplay(eventId).claimed === false;
}

// ── Signature Validation ───────────────────────────────────────

/**
 * Validate HMAC-SHA256 signature from Retell.
 * Retell signs the raw request body with the webhook secret.
 *
 * @param {string|Buffer} rawBody - Raw request body
 * @param {string} signature - Value of the X-Retell-Signature header
 * @returns {boolean}
 */
function validateSignature(rawBody, signature) {
  const secret = getWebhookSecret();
  if (!secret) {
    console.warn('[Voice:Webhook] Signature validation unavailable');
    return false;
  }

  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    console.warn('[Voice:Webhook] Missing X-Retell-Signature header');
    return false;
  }

  try {
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');

    return crypto.timingSafeEqual(sigBuffer, computedBuffer);
  } catch (err) {
    console.error('[Voice:Webhook] Signature validation error:', err.message);
    return false;
  }
}

// ── Timestamp Validation ───────────────────────────────────────

/**
 * Check that the webhook timestamp is within ±5 minutes of current time.
 *
 * @param {string|number} timestamp - Unix timestamp (seconds or ms) from Retell
 * @returns {boolean}
 */
function validateTimestamp(timestamp) {
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) {
    console.warn('[Voice:Webhook] Missing timestamp');
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || ts <= 0) return false;
  // Normalize to milliseconds (Retell may send seconds)
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  if (!Number.isSafeInteger(tsMs)) return false;
  const now = Date.now();
  const diff = Math.abs(now - tsMs);

  if (diff > MAX_AGE_MS) {
    console.warn(`[Voice:Webhook] Timestamp outside ±5min window: diff=${diff}ms`);
    return false;
  }

  return true;
}

// ── Event Routing ──────────────────────────────────────────────

/** Supported event types */
const SUPPORTED_EVENTS = ['call_started', 'call_ended', 'call_analyzed', 'transcript_ready', 'transcript', 'ping'];

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

  if (!event || !SUPPORTED_EVENTS.includes(event)) {
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

/**
 * Handle a signed Retell webhook without decoding JSON until HMAC, timestamp,
 * and the process-local replay claim have all passed.
 */
async function handleSignedWebhook(req, res, ingestionSource) {
  const startTime = Date.now();
  const rawBody = requestRawBody(req) || Buffer.alloc(0);
  const signature = req.headers['x-retell-signature'] || '';
  let replayKey = null;

  try {
    // 1. Validate the exact received bytes. Missing runtime validation material
    // intentionally returns the same response as any other invalid signature.
    if (!validateSignature(rawBody, signature)) {
      return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
    }

    // 2. Validate a strict header timestamp before decoding the body.
    if (!validateTimestamp(req.headers['x-retell-timestamp'])) {
      return res.status(400).json({ error: { code: 'INVALID_TIMESTAMP', message: 'Timestamp outside acceptable window' } });
    }

    // 3. A validated HMAC identifies the exact signed body without decoding it.
    // Check-and-claim is synchronous and atomic within this process.
    replayKey = 'hmac:' + signature.toLowerCase();
    const replayClaim = claimReplay(replayKey);
    if (!replayClaim.claimed) {
      if (replayClaim.reason === 'saturated') {
        return res.status(503).json({
          error: { code: 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE', message: 'Webhook replay protection is unavailable' },
        });
      }
      return res.status(409).json({ error: { code: 'WEBHOOK_REPLAYED', message: 'Webhook request was already received' } });
    }

    if (!supportedJsonContentType(req)) {
      return res.status(415).json({ error: { code: 'UNSUPPORTED_WEBHOOK_MEDIA_TYPE', message: 'Webhook body must be JSON' } });
    }

    let payload;
    try {
      payload = decodeWebhookBody(rawBody);
    } catch (_error) {
      return res.status(400).json({ error: { code: 'INVALID_WEBHOOK_BODY', message: 'Webhook body must be valid JSON' } });
    }
    req.body = payload;
    const eventId = payload.event_id || payload.call_id || 'unknown';
    console.log(`[Voice:Webhook] Received: ${payload.event || 'unknown'} (id: ${eventId})`);

    // 4. Preserve the path-specific canonical source while retaining the same
    // ownership, subscription, session pinning, and graph transaction.
    const canonical = await ingestRetellPayload(payload, { ingestionSource });
    if (canonical.status >= 500) releaseReplay(replayKey);

    const elapsed = Date.now() - startTime;
    console.log(`[Voice:Webhook] Completed: ${payload.event} (${elapsed}ms)`);
    return res.status(canonical.status).json(canonical.body);
  } catch (err) {
    releaseReplay(replayKey);
    console.error('[Voice:Webhook] Fatal signed webhook error:', err.message);
    return res.status(503).json({
      success: false,
      error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: 'Canonical PostgreSQL persistence is unavailable.' },
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
  validateSignature,
  validateTimestamp,
  isDuplicate,
  claimReplay,
  releaseReplay,
  routeEvent,
  cancelPendingEvent,
  start,
  shutdown,
  DEDUP_TTL_MS,
  MAX_REPLAY_ENTRIES,
};
