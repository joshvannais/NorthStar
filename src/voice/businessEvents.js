/**
 * Voice Business Events — Part 5
 *
 * Standardized business event definitions and EventBus pattern
 * for the voice call system.
 *
 * Events:
 *   call_started, customer_verified, estimate_requested, pricing_question,
 *   objection_detected, upsell_detected, competitor_mentioned,
 *   appointment_requested, technician_requested, payment_question,
 *   call_transferred, call_completed
 */

'use strict';

// ── Event Type Constants ───────────────────────────────────────

const EVENT_TYPES = {
  CALL_STARTED: 'call_started',
  CUSTOMER_VERIFIED: 'customer_verified',
  ESTIMATE_REQUESTED: 'estimate_requested',
  PRICING_QUESTION: 'pricing_question',
  OBJECTION_DETECTED: 'objection_detected',
  UPSELL_DETECTED: 'upsell_detected',
  COMPETITOR_MENTIONED: 'competitor_mentioned',
  APPOINTMENT_REQUESTED: 'appointment_requested',
  TECHNICIAN_REQUESTED: 'technician_requested',
  PAYMENT_QUESTION: 'payment_question',
  CALL_TRANSFERRED: 'call_transferred',
  CALL_COMPLETED: 'call_completed',
};

// ── Event Schema ───────────────────────────────────────────────

/**
 * Standard event shape:
 * {
 *   type: string,        // One of EVENT_TYPES
 *   sessionId: string,   // Call/session identifier
 *   timestamp: string,   // ISO 8601
 *   data: object,        // Event-specific payload
 *   source: string       // Origin of the event (e.g., 'retell', 'twilio', 'voice')
 * }
 */

/**
 * Create a new business event with defaults.
 *
 * @param {string} type - Event type from EVENT_TYPES
 * @param {Object} options
 * @param {string} options.sessionId - Active session ID
 * @param {Object} [options.data] - Event payload
 * @param {string} [options.source] - Event source (default: 'voice')
 * @param {string} [options.timestamp] - ISO timestamp (default: now)
 * @returns {Object} Standardized event object
 */
function createEvent(type, options = {}) {
  // Normalize: 'CALL_STARTED' → 'call_started'
  const normalizedType = EVENT_TYPES[type] || type;

  if (!Object.values(EVENT_TYPES).includes(normalizedType)) {
    throw new Error(`Unknown event type: ${type}`);
  }

  return {
    type: normalizedType,
    sessionId: options.sessionId || 'unknown',
    timestamp: options.timestamp || new Date().toISOString(),
    data: options.data || {},
    source: options.source || 'voice',
  };
}

// ── EventBus ───────────────────────────────────────────────────

class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
    /** @type {Array<Object>} */
    this._history = [];
    this._maxHistory = 1000;
  }

  /**
   * Subscribe to an event type.
   *
   * @param {string} eventType - Event type to listen for ('*' for all)
   * @param {Function} handler - Handler function (receives event object)
   * @returns {Function} Unsubscribe function
   */
  on(eventType, handler) {
    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, new Set());
    }
    this._handlers.get(eventType).add(handler);

    return () => this.off(eventType, handler);
  }

  /**
   * Unsubscribe a handler from an event type.
   *
   * @param {string} eventType
   * @param {Function} handler
   */
  off(eventType, handler) {
    const handlers = this._handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._handlers.delete(eventType);
      }
    }
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers are called asynchronously and in parallel.
   * Errors in handlers are caught and logged; they do not prevent
   * other handlers from running.
   *
   * @param {Object} event - Standardized event object
   * @returns {Promise<Object>} Result with handler counts
   */
  async emit(event) {
    // Record in history (circular)
    this._history.push({ ...event, _emittedAt: new Date().toISOString() });
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    console.log(`[EventBus] Emitting: ${event.type} (session: ${event.sessionId})`);

    // Collect all matching handlers: specific + wildcard
    const handlers = new Set();
    const specificHandlers = this._handlers.get(event.type);
    const wildcardHandlers = this._handlers.get('*');

    if (specificHandlers) {
      for (const h of specificHandlers) handlers.add(h);
    }
    if (wildcardHandlers) {
      for (const h of wildcardHandlers) handlers.add(h);
    }

    if (handlers.size === 0) {
      console.log(`[EventBus] No handlers for ${event.type}`);
      return { emitted: true, handlerCount: 0, errors: 0 };
    }

    // Fire all handlers in parallel, catch errors per-handler
    let errors = 0;
    const promises = Array.from(handlers).map(async (handler) => {
      try {
        await handler(event);
      } catch (err) {
        errors++;
        console.error(`[EventBus] Handler error for ${event.type}:`, err.message);
      }
    });

    await Promise.all(promises);

    return {
      emitted: true,
      handlerCount: handlers.size,
      errors,
    };
  }

  /**
   * Get recent event history.
   *
   * @param {number} [limit=50] - Max events to return
   * @returns {Array<Object>}
   */
  getHistory(limit = 50) {
    return this._history.slice(-limit);
  }

  /**
   * Clear all handlers and history.
   */
  reset() {
    this._handlers.clear();
    this._history = [];
  }

  /**
   * Return count of registered handler functions across all event types.
   *
   * @returns {number}
   */
  getHandlerCount() {
    let count = 0;
    for (const handlers of this._handlers.values()) {
      count += handlers.size;
    }
    return count;
  }
}

// ── Singleton Instance ─────────────────────────────────────────

const eventBus = new EventBus();

module.exports = {
  EVENT_TYPES,
  createEvent,
  EventBus,
  eventBus,
  emit: (event) => eventBus.emit(event),
  on: (eventType, handler) => eventBus.on(eventType, handler),
  off: (eventType, handler) => eventBus.off(eventType, handler),
};
