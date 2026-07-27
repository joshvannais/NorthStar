/**
 * Canonical simulation ingestion.
 *
 * Synthetic transcript generation is deterministic per tenant/idempotency key.
 * The route has no file or browser business-authority writes: a 201 is returned
 * only after the complete PostgreSQL graph and replay result commit together.
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const db = require('../db');
const { sha256 } = require('../services/businessProfileAdapter');
const { ingestSimulation } = require('../services/canonicalGraphService');
const pipeline = require('./simulation/pipeline');

const router = express.Router();

function idempotencyKey(req) {
  return req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || '';
}

function buildFacts(scope, evidence) {
  return Object.keys(scope).filter(function (field) {
    return evidence[field];
  }).sort().map(function (field) {
    return {
      id: 'simulation-' + field,
      variable: field,
      status: 'collected',
      normalizedValue: scope[field],
      evidenceText: evidence[field],
      speaker: 'customer',
      confidence: 1,
    };
  });
}

router.post('/simulations/leads', requireAuth, requirePermission('leads', 'create'), async function (req, res) {
  const key = idempotencyKey(req);
  if (!key) {
    return res.status(400).json({
      success: false,
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required for canonical writes.' },
    });
  }
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({
      success: false,
      error: { code: 'CUSTOMER_NAME_REQUIRED', message: 'Customer name is required.' },
    });
  }

  const organizationId = req.tenantContext.organizationId;
  const requestedService = String(req.body.service || 'general').toLowerCase();
  const seed = sha256({ organizationId, key });
  let prepared;
  try {
    prepared = pipeline.withDeterministicSeed(seed, function () {
      const scenario = pipeline.generateScenario(requestedService, name);
      if (!scenario) return null;
      if (req.body.phone) scenario.customer.phone = String(req.body.phone);
      if (req.body.email) scenario.customer.email = String(req.body.email);
      const service = pipeline.CATALOG[scenario.serviceKey];
      const transcript = pipeline.generateTranscript(scenario, service);
      const extracted = pipeline.extractScope(transcript, scenario);
      return { scenario, transcript, extracted };
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_SIMULATION_INPUT', message: 'The simulation input could not be normalized.' },
    });
  }
  if (!prepared) {
    return res.status(400).json({
      success: false,
      error: { code: 'UNSUPPORTED_SERVICE', message: 'The requested service is not supported.' },
    });
  }

  const sessionId = req.body.sessionId
    ? String(req.body.sessionId)
    : 'sim_' + seed.slice(0, 24);
  const graphRequest = {
    tenantContext: req.tenantContext,
    idempotencyKey: key,
    sourceVersion: 'simulation-pipeline-v1',
    external: {
      customerId: sessionId + ':customer',
      callId: sessionId + ':call',
      transcriptId: sessionId + ':transcript',
      communicationId: sessionId + ':communication',
      appointmentId: sessionId + ':appointment',
    },
    customer: prepared.scenario.customer,
    transcript: prepared.transcript,
    facts: buildFacts(prepared.extracted.extracted, prepared.extracted.evidence),
    service: {
      key: prepared.scenario.serviceKey,
      scope: prepared.extracted.extracted,
    },
    appointmentPreference: prepared.extracted.extracted.schedulingPreference
      ? { text: prepared.extracted.extracted.schedulingPreference }
      : null,
  };

  const result = await ingestSimulation(db.getPool(), graphRequest);
  if (result.status !== 201) return res.status(result.status).json(result.body);

  const response = {
    ...result.body,
    sessionId,
    summary: {
      name: prepared.scenario.customer.name,
      service: result.body.snapshot.service.label,
      estimatedValue: result.body.snapshot.customerFacingPrice,
    },
    transcript: prepared.transcript,
    polaris: result.body.snapshot,
  };
  console.log('[Simulations] Canonical graph committed:', JSON.stringify({
    operationId: result.body.operationId,
    service: result.body.snapshot.service.key,
    replayed: result.replayed,
  }));
  return res.status(201).json(response);
});

module.exports = router;
