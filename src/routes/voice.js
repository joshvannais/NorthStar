/**
 * Voice Routes — Parts 5+6: M17 Phase 3
 *
 * - GET /sessions/:id/timeline — Live customer timeline
 * - GET /dashboard — Live dashboard KPIs for active calls
 *
 * Auth-protected via requireAuth (enforced in server.js mount).
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const liveTimeline = require('../voice/liveTimeline');

// All voice routes require authentication
router.use(requireAuth);

/**
 * GET /sessions/:id/timeline
 * Returns live timeline entries for an active voice session.
 */
router.get('/sessions/:id/timeline', (req, res) => {
  try {
    const sessionId = req.params.id;
    if (!sessionId) {
      return res.status(400).json({ error: { code: 'MISSING_ID', message: 'Session ID is required' } });
    }

    const entries = liveTimeline.getTimeline(sessionId);
    res.json({
      sessionId,
      entries,
      count: entries.length,
    });
  } catch (err) {
    console.error('[Voice] Timeline error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve timeline' } });
  }
});

/**
 * GET /dashboard
 * Returns live dashboard KPIs for active voice calls.
 * Derived from active sessions and timeline state.
 */
router.get('/dashboard', (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const activeSessionIds = liveTimeline.getActiveSessionIds();
    const store = liveTimeline.getStore();

    let callsCompletedToday = 0;
    let aiSpeaking = false;
    let customerSpeaking = false;
    const activeCallDurations = [];

    for (const sessionId of activeSessionIds) {
      const entries = liveTimeline.getTimeline(sessionId);

      // Count completed calls today
      const completedEntry = entries.find(e => e.event === 'call_completed');
      if (completedEntry && completedEntry.timestamp.slice(0, 10) === today) {
        callsCompletedToday++;
      }

      // Check for active (not completed) calls
      if (!completedEntry) {
        // Calculate duration from call_started
        const startEntry = entries.find(e => e.event === 'call_started');
        if (startEntry) {
          const startedAt = new Date(startEntry.timestamp).getTime();
          const durationMs = now.getTime() - startedAt;
          activeCallDurations.push(Math.floor(durationMs / 1000));
        }

        // Determine speaking state from most recent entries
        const recentEntries = entries.slice(-5);
        for (const e of recentEntries) {
          if (e.speaker === 'customer') customerSpeaking = true;
          if (e.speaker === 'ai') aiSpeaking = true;
        }
      }
    }

    // Calculate booking probability from timeline signals
    let bookingProbability = 0;
    let liveLeadQualification = null;

    if (activeSessionIds.length > 0) {
      // Simple heuristic based on timeline events
      let score = 0;
      for (const sessionId of activeSessionIds) {
        const entries = liveTimeline.getTimeline(sessionId);
        if (entries.some(e => e.event === 'appointment_requested')) score += 0.4;
        if (entries.some(e => e.event === 'address_collected')) score += 0.2;
        if (entries.some(e => e.event === 'service_discussed')) score += 0.2;
        if (entries.some(e => e.event === 'objection_raised')) score -= 0.15;
        if (entries.some(e => e.event === 'emergency_mentioned')) score += 0.15;
        if (entries.some(e => e.event === 'pricing_question')) score += 0.1;
      }
      bookingProbability = Math.min(1, Math.max(0, score / activeSessionIds.length));

      if (bookingProbability >= 0.7) liveLeadQualification = 'Hot';
      else if (bookingProbability >= 0.4) liveLeadQualification = 'Warm';
      else liveLeadQualification = 'Cold';
    }

    const activeCalls = activeSessionIds.filter(id => {
      const entries = liveTimeline.getTimeline(id);
      return !entries.some(e => e.event === 'call_completed');
    }).length;

    res.json({
      activeCalls,
      aiSpeaking,
      customerSpeaking,
      callsWaiting: 0, // Not yet tracked separately
      callsCompletedToday,
      activeCallDurations,
      liveLeadQualification,
      responseTime: activeCalls > 0 ? Math.floor(Math.random() * 3) + 1 : 0, // Simulated
      bookingProbability: Math.round(bookingProbability * 100) / 100,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.error('[Voice] Dashboard error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve dashboard data' } });
  }
});

module.exports = router;
