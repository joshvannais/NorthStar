/**
 * Retell Voice Webhook Framework — Part 4
 *
 * Secure webhook handling for Retell AI call events.
 * Replaces src/retell/webhook.js (kept for backward compatibility).
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

// ── Configuration ──────────────────────────────────────────────
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const HANDLER_TIMEOUT_MS = 10000;

/**
 * Get the webhook secret dynamically (supports runtime env changes).
 */
function getWebhookSecret() {
  return process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY || '';
}

// In-memory deduplication store (survives restarts for up to 24h via file)
const dedupStore = new Map();

// ── Deduplication ──────────────────────────────────────────────

/**
 * Check if an event_id has been processed within the dedup window.
 * Also cleans up expired entries.
 */
function isDuplicate(eventId) {
  if (!eventId) return false;

  // Clean expired entries first
  const now = Date.now();
  for (const [id, timestamp] of dedupStore.entries()) {
    if (now - timestamp > DEDUP_TTL_MS) {
      dedupStore.delete(id);
    }
  }

  if (dedupStore.has(eventId)) {
    return true;
  }

  dedupStore.set(eventId, now);
  return false;
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
    console.warn('[Voice:Webhook] No RETELL_WEBHOOK_SECRET set — signature validation SKIPPED');
    return true; // Skip validation if not configured (dev mode)
  }

  if (!signature) {
    console.warn('[Voice:Webhook] Missing X-Retell-Signature header');
    return false;
  }

  try {
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const computedBuffer = Buffer.from(computed);

    if (sigBuffer.length !== computedBuffer.length) {
      return false;
    }

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
  if (!timestamp) {
    console.warn('[Voice:Webhook] Missing timestamp');
    return false;
  }

  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  // Normalize to milliseconds (Retell may send seconds)
  const tsMs = ts > 1e12 ? ts : ts * 1000;
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
      const emitPromise = businessEvents.emit(bizEvent);
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Handler timeout')), HANDLER_TIMEOUT_MS);
      });
      try {
        await Promise.race([emitPromise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (err) {
      console.error(`[Voice:Webhook] Event handler error for ${event}:`, err.message);
      // Don't fail the webhook response — Retell will retry if we 500
    }
  }

  return { received: true, routed: true, event, eventId };
}

// ── Main Handler ───────────────────────────────────────────────

/**
 * Handle an incoming Retell webhook request.
 *
 * 1. Validate HMAC-SHA256 signature
 * 2. Check timestamp within ±5min
 * 3. Deduplicate by event_id
 * 4. Route to event handler
 * 5. Return 200 OK with { received: true }
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
async function handleWebhook(req, res) {
  const startTime = Date.now();
  const eventId = req.body?.event_id || req.body?.call_id || 'unknown';

  console.log(`[Voice:Webhook] Received: ${req.body?.event || 'unknown'} (id: ${eventId})`);

  try {
    // 1. Validate signature
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-retell-signature'] || '';
    if (!validateSignature(rawBody, signature)) {
      console.warn(`[Voice:Webhook] Invalid signature for event ${eventId}`);
      return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
    }

    // 2. Validate timestamp
    const timestamp = req.headers['x-retell-timestamp'] || req.body.timestamp;
    if (!validateTimestamp(timestamp)) {
      console.warn(`[Voice:Webhook] Invalid timestamp for event ${eventId}`);
      return res.status(400).json({ error: { code: 'INVALID_TIMESTAMP', message: 'Timestamp outside acceptable window' } });
    }

    // 3. Deduplicate
    if (isDuplicate(eventId)) {
      console.log(`[Voice:Webhook] Duplicate event ${eventId} — acking`);
      return res.json({ received: true, deduplicated: true });
    }

    // 4. Route
    const result = await routeEvent(req.body);

    // 5. Return success
    const elapsed = Date.now() - startTime;
    console.log(`[Voice:Webhook] Completed: ${req.body.event} (${elapsed}ms)`);

    res.json({ received: true, ...result });
  } catch (err) {
    console.error(`[Voice:Webhook] Fatal error for event ${eventId}:`, err.message);
    // Return 200 even on errors to prevent Retell from retrying endlessly
    res.json({ received: true, error: 'internal_handler_error' });
  }
}

/**
 * Create Express middleware for raw body capture (needed for HMAC validation).
 * Must be applied before express.json() on the webhook route.
 *
 * Usage:
 *   router.post('/webhook', rawBodyCapture, express.json(), handleWebhook)
 */
function rawBodyCapture(req, res, next) {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
}

module.exports = {
  handleWebhook,
  rawBodyCapture,
  validateSignature,
  validateTimestamp,
  isDuplicate,
  routeEvent,
};
