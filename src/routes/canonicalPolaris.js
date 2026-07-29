'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../audit/client');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { bindIntegrationOwner } = require('../services/organizationAuthority');

const READ_MODEL_VERSION = 'm19-part3-read-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SURFACES = new Set([
  'customer-detail', 'leads', 'communications', 'calendar',
  'command-center', 'polaris', 'executive', 'estimates',
]);

function resolvePool(poolProvider) {
  const pool = poolProvider();
  if (!pool || typeof pool.query !== 'function') {
    const error = new Error('Canonical PostgreSQL persistence is unavailable');
    error.code = 'CANONICAL_PERSISTENCE_UNAVAILABLE';
    throw error;
  }
  return pool;
}

function requestContext(req) {
  const tenant = req.tenantContext || {};
  if (!tenant.organizationId || !tenant.userId) return null;
  const explicitSession = req.get('X-NorthStar-Session-ID') || req.get('X-Session-ID');
  const authorizationDigest = sha256(req.get('Authorization') || 'authenticated-session').slice(0, 32);
  return {
    organizationId: String(tenant.organizationId),
    userId: String(tenant.userId),
    sessionId: explicitSession ? String(explicitSession) : 'auth-' + authorizationDigest,
    explicitSession: explicitSession ? String(explicitSession) : null,
  };
}

function validateCustomerIdFilter(raw) {
  if (raw === undefined || raw === null) return null;       // absent — no filter
  if (raw === '') return null;                              // empty — treat as absent
  const str = String(raw);
  if (UUID.test(str)) return str;                           // valid UUID
  // Malformed — fail closed
  const error = new Error('Invalid customerId filter value');
  error.code = 'INVALID_CUSTOMER_ID';
  error.statusCode = 400;
  throw error;
}

function queryFilters(req) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
  return stableValue({
    limit,
    status: typeof req.query.status === 'string' ? req.query.status : null,
    customerId: validateCustomerIdFilter(req.query.customerId),
  });
}

const GRAPH_SELECT = `
  SELECT o.id AS operation_id, o.graph_id, o.state AS operation_state,
         c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
         c.phone AS customer_phone, c.address AS customer_address,
         t.id AS transcript_id, t.source, t.source_version, t.external_call_id,
         t.external_transcript_id, t.transcript_text, t.occurred_at,
         cm.id AS communication_id, cm.channel, cm.direction, cm.subject,
         cm.duration_seconds,
         op.id AS opportunity_id, op.status AS opportunity_status,
         op.service_type, op.job_scope, op.appointment_preference,
         e.id AS estimate_id, e.currency, e.customer_price, e.line_items,
         a.id AS appointment_id, a.preference, a.scheduled_start, a.scheduled_end,
         a.status AS appointment_status,
         ps.id AS polaris_snapshot_id, ps.calculation_version,
         ps.normalized_input_fingerprint, ps.business_profile_id, ps.business_profile_version,
         ps.business_profile_hash, ps.supporting_fact_ids, ps.snapshot,
         ps.snapshot_digest, ps.created_at AS snapshot_created_at
    FROM canonical_operations o
    JOIN canonical_transcripts t
      ON t.organization_id = o.organization_id AND t.operation_id = o.id
    JOIN canonical_communications cm
      ON cm.organization_id = o.organization_id AND cm.operation_id = o.id
    JOIN canonical_opportunities op
      ON op.organization_id = o.organization_id AND op.operation_id = o.id
    JOIN canonical_customers c
      ON c.organization_id = o.organization_id AND c.id = op.customer_id
    JOIN canonical_estimates e
      ON e.organization_id = o.organization_id AND e.operation_id = o.id
    JOIN canonical_appointments a
      ON a.organization_id = o.organization_id AND a.operation_id = o.id
    JOIN canonical_polaris_snapshots ps
      ON ps.organization_id = o.organization_id AND ps.operation_id = o.id`;

function projectRow(row) {
  const projection = {
    readModelVersion: READ_MODEL_VERSION,
    legacy: false,
    ids: {
      operation: row.operation_id,
      graph: row.graph_id,
      customer: row.customer_id,
      transcript: row.transcript_id,
      communication: row.communication_id,
      opportunity: row.opportunity_id,
      estimate: row.estimate_id,
      appointment: row.appointment_id,
      polarisSnapshot: row.polaris_snapshot_id,
    },
    source: {
      type: row.source,
      version: row.source_version,
      externalCallId: row.external_call_id,
      externalTranscriptId: row.external_transcript_id,
    },
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
      address: row.customer_address,
    },
    transcript: {
      id: row.transcript_id,
      text: row.transcript_text,
      occurredAt: row.occurred_at,
      durationSeconds: row.duration_seconds,
    },
    communication: {
      id: row.communication_id,
      channel: row.channel,
      direction: row.direction,
      subject: row.subject,
    },
    opportunity: {
      id: row.opportunity_id,
      status: row.opportunity_status,
      serviceType: row.service_type,
      scope: row.job_scope,
      appointmentPreference: row.appointment_preference,
    },
    estimate: {
      id: row.estimate_id,
      currency: row.currency,
      customerPrice: row.customer_price === null ? null : Number(row.customer_price),
      lineItems: row.line_items,
    },
    appointment: {
      id: row.appointment_id,
      preference: row.preference,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      status: row.appointment_status,
    },
    calculationVersion: row.calculation_version,
    normalizedInputFingerprint: row.normalized_input_fingerprint,
    businessProfileInputVersion: row.business_profile_version,
    businessProfileInputHash: row.business_profile_hash,
    businessProfileAuthorityId: row.business_profile_id,
    supportingTranscriptFactIds: row.supporting_fact_ids,
    snapshotDigest: row.snapshot_digest,
    snapshot: row.snapshot,
    snapshotCreatedAt: row.snapshot_created_at,
  };
  projection.projectionDigest = sha256({
    readModelVersion: projection.readModelVersion,
    ids: projection.ids,
    snapshotDigest: projection.snapshotDigest,
  });
  return projection;
}

async function listCanonicalGraphs(pool, context, filters) {
  const values = [context.organizationId, context.explicitSession, filters.limit];
  let where = `
    WHERE o.organization_id = $1 AND o.state = 'completed'
      AND (t.source NOT IN ('simulation', 'demo')
        OR ($2::text IS NOT NULL AND t.external_call_id = $2 || ':call'))`;
  if (filters.status) {
    values.push(filters.status);
    where += ` AND op.status = $${values.length}`;
  }
  if (filters.customerId) {
    values.push(filters.customerId);
    where += ` AND c.id = $${values.length}`;
  }
  const result = await pool.query(GRAPH_SELECT + where + ` ORDER BY ps.created_at DESC, o.id ASC LIMIT $3`, values);
  return result.rows.map(projectRow);
}

async function getCanonicalGraph(pool, context, identifier) {
  if (!UUID.test(String(identifier || ''))) return null;
  const result = await pool.query(
    GRAPH_SELECT + `
      WHERE o.organization_id = $1 AND o.state = 'completed'
        AND (t.source NOT IN ('simulation', 'demo')
          OR ($2::text IS NOT NULL AND t.external_call_id = $2 || ':call'))
        AND ($3::uuid IN (o.id, o.graph_id, c.id, t.id, cm.id, op.id, e.id, a.id, ps.id))
      LIMIT 1`,
    [context.organizationId, context.explicitSession, identifier]
  );
  return result.rows.length ? projectRow(result.rows[0]) : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundedSum(values) {
  return Math.round(values.reduce(function (sum, value) { return sum + value; }, 0) * 100) / 100;
}

function projectionState(items) {
  return {
    status: items.length ? 'available' : 'no_canonical_data',
    canonicalGraphCount: items.length,
  };
}

function sourceGraph(item) {
  return {
    graphId: item.ids.graph,
    operationId: item.ids.operation,
    snapshotId: item.ids.polarisSnapshot,
    snapshotDigest: item.snapshotDigest,
    snapshotCreatedAt: item.snapshotCreatedAt,
    calculationVersion: item.calculationVersion,
    businessProfile: {
      id: item.businessProfileAuthorityId,
      version: item.businessProfileInputVersion,
      hash: item.businessProfileInputHash,
    },
    notCalculated: Array.isArray(item.snapshot && item.snapshot.notCalculated)
      ? item.snapshot.notCalculated : [],
  };
}

function aggregate(items) {
  const values = items.map(function (item) { return item.snapshot; });
  const revenue = values.map(function (value) {
    return finiteNumber(value && value.estimatedRevenue);
  }).filter(function (value) { return value !== null; });
  const knownGrossProfit = values.map(function (value) {
    return finiteNumber(value && value.grossProfit);
  }).filter(function (value) { return value !== null; });
  return {
    dataState: projectionState(items),
    graphCount: items.length,
    customerCount: new Set(items.map(function (item) { return item.ids.customer; })).size,
    estimatedRevenue: revenue.length ? roundedSum(revenue) : null,
    pricedGraphCount: revenue.length,
    unpricedGraphCount: items.length - revenue.length,
    knownGrossProfit: knownGrossProfit.length
      ? roundedSum(knownGrossProfit)
      : null,
    appointmentCount: items.filter(function (item) { return item.ids.appointment; }).length,
    snapshotDigests: items.map(function (item) { return item.snapshotDigest; }),
  };
}

function authorityProjection(context) {
  if (!context) return null;
  return {
    organizationId: context.organizationId,
    userId: context.userId,
    sessionId: context.sessionId,
    explicitSession: context.explicitSession,
  };
}

function surfaceProjection(surface, items, context) {
  return {
    surface,
    authority: authorityProjection(context),
    readModelVersion: READ_MODEL_VERSION,
    digest: sha256(items.map(function (item) { return item.projectionDigest; })),
    items: items.map(function (item) {
      return {
        ids: item.ids,
        calculationVersion: item.calculationVersion,
        snapshotDigest: item.snapshotDigest,
        projectionDigest: item.projectionDigest,
        snapshotCreatedAt: item.snapshotCreatedAt,
        businessProfile: {
          id: item.businessProfileAuthorityId,
          version: item.businessProfileInputVersion,
          hash: item.businessProfileInputHash,
        },
        values: item.snapshot,
      };
    }),
  };
}

function pipelineStageProjection(items) {
  const stages = {};
  for (const item of items) {
    const key = String(item.opportunity.status || 'unavailable');
    if (!stages[key]) stages[key] = { count: 0, graphIds: [], snapshotDigests: [] };
    stages[key].count += 1;
    stages[key].graphIds.push(item.ids.graph);
    stages[key].snapshotDigests.push(item.snapshotDigest);
  }
  return {
    stages: Object.keys(stages).sort().reduce(function (ordered, key) {
      ordered[key] = stages[key];
      return ordered;
    }, {}),
    projection: projectionState(items),
  };
}

function alertProjection(items) {
  const alerts = items.filter(function (item) {
    return Boolean(item.snapshot && item.snapshot.risk && item.snapshot.risk.emergency);
  }).map(function (item) {
    return {
      type: 'canonical_emergency_risk',
      severity: 'high',
      message: 'Canonical intelligence identifies an emergency service risk.',
      sourceGraph: sourceGraph(item),
    };
  });
  return { alerts, projection: projectionState(items) };
}

function trendProjection(items) {
  const buckets = new Map();
  for (const item of items) {
    const timestamp = new Date(item.snapshotCreatedAt);
    const date = Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString().slice(0, 10);
    if (!date) continue;
    if (!buckets.has(date)) buckets.set(date, []);
    buckets.get(date).push(item);
  }
  const trend = Array.from(buckets.keys()).sort().map(function (date) {
    const dateItems = buckets.get(date);
    const metrics = aggregate(dateItems);
    return {
      date,
      graphCount: metrics.graphCount,
      estimatedRevenue: metrics.estimatedRevenue,
      pricedGraphCount: metrics.pricedGraphCount,
      unpricedGraphCount: metrics.unpricedGraphCount,
      knownGrossProfit: metrics.knownGrossProfit,
      sourceGraphs: dateItems.map(sourceGraph),
    };
  });
  return {
    trend,
    projection: items.length && !trend.length
      ? { status: 'unavailable', reason: 'canonical_snapshot_timestamp_unavailable', canonicalGraphCount: items.length }
      : projectionState(items),
  };
}

function serviceAnalyticsProjection(items) {
  const groups = new Map();
  for (const item of items) {
    const snapshotService = item.snapshot && item.snapshot.service;
    const key = snapshotService && typeof snapshotService.key === 'string' && snapshotService.key.trim()
      ? snapshotService.key.trim().toLowerCase() : null;
    const groupKey = key || '__unavailable__';
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(item);
  }
  const services = Array.from(groups.keys()).sort(function (left, right) {
    if (left === '__unavailable__') return 1;
    if (right === '__unavailable__') return -1;
    return left.localeCompare(right);
  }).map(function (groupKey) {
    const serviceItems = groups.get(groupKey);
    const metrics = aggregate(serviceItems);
    const snapshotService = serviceItems[0].snapshot && serviceItems[0].snapshot.service;
    return {
      serviceKey: groupKey === '__unavailable__' ? null : groupKey,
      serviceLabel: snapshotService && snapshotService.label ? snapshotService.label : null,
      serviceIdentity: groupKey === '__unavailable__'
        ? { status: 'unavailable', reason: 'canonical_service_identity_unavailable' }
        : { status: 'available' },
      graphCount: metrics.graphCount,
      estimatedRevenue: metrics.estimatedRevenue,
      pricedGraphCount: metrics.pricedGraphCount,
      unpricedGraphCount: metrics.unpricedGraphCount,
      knownGrossProfit: metrics.knownGrossProfit,
      sourceGraphs: serviceItems.map(sourceGraph),
    };
  });
  return { services, projection: projectionState(items) };
}

function recommendationProjection(items) {
  const byAction = new Map();
  for (const item of items) {
    const actions = Array.isArray(item.snapshot && item.snapshot.recommendedActions)
      ? item.snapshot.recommendedActions : [];
    for (const rawAction of actions) {
      if (rawAction === null || rawAction === undefined) continue;
      const recommendation = typeof rawAction === 'string' ? rawAction.trim() : stableValue(rawAction);
      if (recommendation === '') continue;
      const key = sha256(recommendation);
      if (!byAction.has(key)) byAction.set(key, { recommendation, sourceGraphs: [] });
      byAction.get(key).sourceGraphs.push(sourceGraph(item));
    }
  }
  const recommendationDetails = Array.from(byAction.values());
  return {
    recommendations: recommendationDetails.map(function (entry) { return entry.recommendation; }),
    recommendationDetails,
    projection: projectionState(items),
  };
}

function compatibilityProjection(surface, items, context) {
  const common = surfaceProjection(surface, items, context);
  const records = items.map(function (item) {
    if (surface === 'customer-detail') return { ...item.customer, canonical: common.items.find(value => value.ids.graph === item.ids.graph) };
    if (surface === 'leads') return { ...item.opportunity, customer: item.customer, canonical: common.items.find(value => value.ids.graph === item.ids.graph) };
    if (surface === 'communications') return { ...item.communication, transcript: item.transcript, customer: item.customer, canonical: common.items.find(value => value.ids.graph === item.ids.graph) };
    if (surface === 'calendar') return { ...item.appointment, customer: item.customer, opportunity: item.opportunity, canonical: common.items.find(value => value.ids.graph === item.ids.graph) };
    if (surface === 'estimates') return { ...item.estimate, canonical: common.items.find(value => value.ids.graph === item.ids.graph) };
    return common.items.find(value => value.ids.graph === item.ids.graph);
  });
  return { ...common, records, metrics: aggregate(items) };
}

function createDependencies(options) {
  const supplied = options || {};
  return {
    poolProvider: supplied.poolProvider || function () { return db.getPool(); },
    auth: supplied.auth || requireAuth,
    permission: supplied.permission || requirePermission,
    audit: supplied.audit || audit,
  };
}

function sendPersistenceUnavailable(res) {
  return res.status(503).json({
    success: false,
    error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: 'Canonical PostgreSQL persistence is unavailable.' },
  });
}

function sendInvalidCustomerId(res) {
  return res.status(400).json({
    success: false,
    error: { code: 'INVALID_CUSTOMER_ID', message: 'Invalid customerId filter value.' },
  });
}

function handleEndpointError(res, _error) {
  if (_error && _error.code === 'INVALID_CUSTOMER_ID') return sendInvalidCustomerId(res);
  return sendPersistenceUnavailable(res);
}

async function authoritativeItems(req, dependencies, endpoint) {
  const context = requestContext(req);
  const filters = queryFilters(req);
  void endpoint;
  const pool = resolvePool(dependencies.poolProvider);
  return listCanonicalGraphs(pool, context, filters);
}

function createCanonicalRouter(options) {
  const dependencies = createDependencies(options);
  const router = express.Router();
  function requireCanonicalContext(req, res, next) {
    if (!requestContext(req)) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    }
    return next();
  }

  router.get('/status', dependencies.auth, requireCanonicalContext, async function (req, res) {
    const context = requestContext(req);
    if (!context) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    try {
      const pool = resolvePool(dependencies.poolProvider);
      const result = await pool.query(
        `SELECT COUNT(*)::int AS completed_graphs FROM canonical_operations
          WHERE organization_id = $1 AND state = 'completed'`,
        [context.organizationId]
      );
      return res.json({
        success: true,
        data: {
          status: 'operational',
          readModelVersion: READ_MODEL_VERSION,
          completedGraphs: result.rows[0].completed_graphs,
          postgresAuthoritative: true,
          redisRequired: false,
          canonicalResponseCaching: false,
        },
      });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  router.get('/graphs', dependencies.auth, requireCanonicalContext, async function (req, res) {
    if (!requestContext(req)) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    try {
      const items = await authoritativeItems(req, dependencies, 'canonical.graphs');
      return res.json({ success: true, data: { items, count: items.length, readModelVersion: READ_MODEL_VERSION, digest: sha256(items.map(item => item.projectionDigest)) } });
    } catch (_error) {
      return handleEndpointError(res, _error);
    }
  });

  for (const endpoint of ['dashboard', 'analytics']) {
    router.get('/' + endpoint, dependencies.auth, requireCanonicalContext, async function (req, res) {
      if (!requestContext(req)) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
      try {
        const items = await authoritativeItems(req, dependencies, 'canonical.' + endpoint);
        return res.json({ success: true, data: { ...aggregate(items), digest: sha256(items.map(item => item.projectionDigest)), readModelVersion: READ_MODEL_VERSION } });
      } catch (_error) {
        return handleEndpointError(res, _error);
      }
    });
  }

  router.get('/surfaces/:surface', dependencies.auth, requireCanonicalContext, async function (req, res) {
    if (!SURFACES.has(req.params.surface)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Surface not found.' } });
    try {
      const items = await authoritativeItems(req, dependencies, 'canonical.surface.' + req.params.surface);
      return res.json({ success: true, data: surfaceProjection(req.params.surface, items, requestContext(req)) });
    } catch (_error) {
      return handleEndpointError(res, _error);
    }
  });

  router.get('/compat/:surface', dependencies.auth, requireCanonicalContext, async function (req, res) {
    if (!SURFACES.has(req.params.surface)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Compatibility projection not found.' } });
    try {
      const items = await authoritativeItems(req, dependencies, 'canonical.compat.' + req.params.surface);
      return res.json({ success: true, data: compatibilityProjection(req.params.surface, items, requestContext(req)) });
    } catch (_error) {
      return handleEndpointError(res, _error);
    }
  });

  router.patch('/appointments/:id', dependencies.auth, requireCanonicalContext, dependencies.permission('calendar', 'update'), express.json(), async function (req, res) {
    const context = requestContext(req);
    if (!UUID.test(req.params.id)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
    try {
      const pool = resolvePool(dependencies.poolProvider);
      const before = await pool.query(
        `SELECT a.* FROM canonical_appointments a
          JOIN canonical_transcripts t
            ON t.organization_id = a.organization_id AND t.operation_id = a.operation_id
         WHERE a.organization_id = $1 AND a.id = $2
           AND (t.source NOT IN ('simulation', 'demo')
             OR ($3::text IS NOT NULL AND t.external_call_id = $3 || ':call'))`,
        [context.organizationId, req.params.id, context.explicitSession]
      );
      if (!before.rows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
      const allowedStatus = ['preferred', 'scheduled', 'cancelled', 'completed'];
      const status = req.body.status === undefined ? before.rows[0].status : String(req.body.status);
      if (!allowedStatus.includes(status)) return res.status(400).json({ success: false, error: { code: 'INVALID_APPOINTMENT_STATUS', message: 'Appointment status is invalid.' } });
      const start = req.body.scheduledStart === undefined ? before.rows[0].scheduled_start : req.body.scheduledStart;
      const end = req.body.scheduledEnd === undefined ? before.rows[0].scheduled_end : req.body.scheduledEnd;
      const updated = await pool.query(
        `UPDATE canonical_appointments
            SET scheduled_start = $3, scheduled_end = $4, status = $5, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2
          RETURNING *`,
        [context.organizationId, req.params.id, start, end, status]
      );
      try {
        await dependencies.audit.record({
        organizationId: context.organizationId,
        userId: context.userId,
        actorLabel: 'authenticated',
        actorRole: req.userRole || req.tenantContext.role,
        action: 'PATCH 200',
        entityType: 'canonical_appointment',
        entityId: req.params.id,
        beforeState: before.rows[0],
        afterState: updated.rows[0],
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
          correlationId: req.requestId,
        });
      } catch (_auditError) {
        console.warn('[Audit] Persistence warning:', {
          requestId: req.requestId || 'unavailable',
          event: 'audit_persistence_failed',
        });
      }
      return res.json({ success: true, data: updated.rows[0] });
    } catch (error) {
      if (error && error.code === '23514') return res.status(400).json({ success: false, error: { code: 'INVALID_APPOINTMENT_SCHEDULE', message: 'Appointment schedule is invalid.' } });
      return sendPersistenceUnavailable(res);
    }
  });

  router.put('/integrations/:provider', dependencies.auth, requireCanonicalContext, dependencies.permission('integrations', 'update'), express.json(), async function (req, res) {
    const context = requestContext(req);
    const provider = String(req.params.provider || '').toLowerCase();
    if (!['retell', 'voice'].includes(provider)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INTEGRATION_PROVIDER', message: 'Integration provider is invalid.' } });
    }
    try {
      const bound = await bindIntegrationOwner(resolvePool(dependencies.poolProvider), {
        organizationId: context.organizationId,
        userId: context.userId,
        provider,
        externalIntegrationId: req.body && (req.body.agentId || req.body.externalIntegrationId),
        status: req.body && req.body.status,
        metadata: req.body && req.body.metadata,
      });
      return res.json({ success: true, data: bound });
    } catch (error) {
      if (error && error.status) {
        return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      }
      return sendPersistenceUnavailable(res);
    }
  });

  router.get('/graphs/:id', dependencies.auth, requireCanonicalContext, async function (req, res) {
    const context = requestContext(req);
    try {
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), context, req.params.id);
      if (!item) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Canonical graph not found.' } });
      return res.json({ success: true, data: item });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  router.get('/snapshots/:id', dependencies.auth, requireCanonicalContext, async function (req, res) {
    const context = requestContext(req);
    try {
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), context, req.params.id);
      if (!item || item.ids.polarisSnapshot !== req.params.id) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Polaris snapshot not found.' } });
      }
      return res.json({ success: true, data: { id: item.ids.polarisSnapshot, calculationVersion: item.calculationVersion, snapshotDigest: item.snapshotDigest, snapshot: item.snapshot } });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  return router;
}

function createCompatibilityRouter(options) {
  const dependencies = createDependencies(options);
  const router = express.Router();
  function requireContext(req, res, next) {
    if (!requestContext(req)) {
      return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    }
    return next();
  }
  function ownedGet(path, ...handlers) {
    router.get(path, dependencies.auth, requireContext, ...handlers);
  }
  function ownedPost(path, ...handlers) {
    router.post(path, dependencies.auth, requireContext, ...handlers);
  }
  function ownedPut(path, ...handlers) {
    router.put(path, dependencies.auth, requireContext, ...handlers);
  }
  function ownedPatch(path, ...handlers) {
    router.patch(path, dependencies.auth, requireContext, ...handlers);
  }
  function ownedDelete(path, ...handlers) {
    router.delete(path, dependencies.auth, requireContext, ...handlers);
  }

  function handle(surface, shape) {
    return async function (req, res) {
      try {
        const items = await authoritativeItems(req, dependencies, 'compat.' + surface + '.' + req.path);
        const projection = compatibilityProjection(surface, items, requestContext(req));
        return res.json(shape(projection, items));
      } catch (_error) {
        return sendPersistenceUnavailable(res);
      }
    };
  }

  ownedGet('/customers', handle('customer-detail', function (projection) { return { customers: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/communications', handle('communications', function (projection) { return { communications: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/opportunities/pipeline', handle('leads', function (projection, items) { return { ...pipelineStageProjection(items), opportunities: projection.records, canonicalDigest: projection.digest }; }));
  ownedGet('/opportunities', handle('leads', function (projection) { return { opportunities: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/financial/estimates', handle('estimates', function (projection) { return { estimates: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/analytics/executive', handle('executive', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));
  ownedGet('/analytics/kpis', handle('executive', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));
  ownedGet('/analytics/dashboard', handle('command-center', function (projection) { return { ...projection.metrics, items: projection.records, canonicalDigest: projection.digest }; }));
  ownedGet('/analytics/alerts', handle('executive', function (projection, items) { return { ...alertProjection(items), canonicalDigest: projection.digest }; }));
  ownedGet('/analytics/trends', handle('executive', function (projection, items) { return { data: { ...projection.metrics, ...trendProjection(items), canonicalDigest: projection.digest } }; }));
  ownedGet('/analytics/pipeline', handle('leads', function (projection) { return { data: { opportunities: projection.records, ...projection.metrics, canonicalDigest: projection.digest } }; }));
  ownedGet('/analytics/by-service', handle('executive', function (projection, items) { return { data: { ...serviceAnalyticsProjection(items), ...projection.metrics, canonicalDigest: projection.digest } }; }));
  ownedGet('/workflows/agenda/today', handle('calendar', function (projection) { return { tasks: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/leads', handle('leads', function (projection) { return { leads: projection.records, items: projection.records, total: projection.records.length, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/calls', handle('communications', function (projection) { return { calls: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/appointments', handle('calendar', function (projection) { return { appointments: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/dashboard/overview', handle('command-center', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));
  for (const dashboardEndpoint of ['summary', 'revenue', 'brief', 'coach', 'kpis', 'trends', 'revenue-trends']) {
    ownedGet('/dashboard/' + dashboardEndpoint, handle('executive', function (projection) {
      return { data: { ...projection.metrics, items: projection.records, canonicalDigest: projection.digest } };
    }));
  }
  ownedGet('/dashboard/status', async function (req, res) {
    try {
      const context = requestContext(req);
      const result = await resolvePool(dependencies.poolProvider).query(
        `SELECT COUNT(*)::int AS completed_graphs FROM canonical_operations
          WHERE organization_id = $1 AND state = 'completed'`,
        [context.organizationId]
      );
      return res.json({
        status: 'operational',
        readModelVersion: READ_MODEL_VERSION,
        completedGraphs: result.rows[0].completed_graphs,
        postgresAuthoritative: true,
        redisRequired: false,
      });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });
  ownedGet('/calendar/events', handle('calendar', function (projection) { return { events: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/calendar/upcoming', handle('calendar', function (projection) { return { events: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/financial/metrics', handle('estimates', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));
  ownedGet('/polaris/intelligence', handle('polaris', function (projection) { return { ...projection.metrics, items: projection.records, canonicalDigest: projection.digest }; }));
  ownedGet('/polaris/estimates', handle('estimates', function (projection) { return { estimates: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/polaris/recommendations', handle('polaris', function (projection, items) { return { ...recommendationProjection(items), sourceGraphs: projection.records, canonicalDigest: projection.digest }; }));
  ownedGet('/polaris/learning', handle('polaris', function (projection) { return { snapshots: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  ownedGet('/polaris/pipeline', handle('leads', function (projection) { return { opportunities: projection.records, ...projection.metrics, canonicalDigest: projection.digest }; }));
  ownedGet('/polaris/retell-context', handle('calendar', function (projection) { return { appointments: projection.records, canonicalDigest: projection.digest }; }));
  ownedGet('/polaris/business-context', handle('executive', function (projection) { return { success: true, context: { ...projection.metrics, canonicalDigest: projection.digest } }; }));
  ownedGet('/polaris/unified-context', handle('executive', function (projection) { return { success: true, context: { ...projection.metrics, items: projection.records, canonicalDigest: projection.digest } }; }));
  ownedGet('/stats', handle('executive', function (projection) { return { totalCalls: projection.metrics.graphCount, totalRevenue: projection.metrics.estimatedRevenue, appointmentsBooked: projection.metrics.appointmentCount, canonicalDigest: projection.digest }; }));
  ownedGet('/leads/intelligence/dashboard', handle('executive', function (projection) { return { success: true, data: { ...projection.metrics, items: projection.records, canonicalDigest: projection.digest } }; }));

  function legacyWriteBlocked(_req, res) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'LEGACY_AUTHORITY_READ_ONLY',
        message: 'This legacy mutation is read-only; use an organization-scoped canonical operation.',
      },
    });
  }

  // These static legacy mutations are deliberately intercepted before the
  // older parameter routes. They cannot become a second file/browser writer.
  ownedPost('/leads/simulate', dependencies.permission('leads', 'create'), legacyWriteBlocked);
  ownedPost('/analytics/seed', legacyWriteBlocked);
  ownedPost('/calendar/events', dependencies.permission('calendar', 'create'), legacyWriteBlocked);
  ownedPut('/calendar/events/:id', dependencies.permission('calendar', 'update'), legacyWriteBlocked);
  ownedDelete('/calendar/events/:id', dependencies.permission('calendar', 'delete'), legacyWriteBlocked);
  ownedPost('/calls/:id/mark-known', dependencies.permission('calls', 'update'), legacyWriteBlocked);
  ownedPost('/calls/record', dependencies.permission('calls', 'create'), legacyWriteBlocked);
  ownedPost('/calendar/schedule', dependencies.permission('calendar', 'create'), legacyWriteBlocked);
  ownedPost('/customers', dependencies.permission('leads', 'create'), legacyWriteBlocked);
  ownedPut('/customers/:id', dependencies.permission('leads', 'update'), legacyWriteBlocked);
  ownedDelete('/customers/:id', dependencies.permission('leads', 'delete'), legacyWriteBlocked);
  ownedPost('/customers/:id/restore', dependencies.permission('leads', 'update'), legacyWriteBlocked);
  ownedPost('/communications', dependencies.permission('calls', 'create'), legacyWriteBlocked);
  ownedPut('/communications/:id/status', dependencies.permission('calls', 'update'), legacyWriteBlocked);
  ownedPost('/opportunities', dependencies.permission('leads', 'create'), legacyWriteBlocked);
  ownedPut('/opportunities/:id', dependencies.permission('leads', 'update'), legacyWriteBlocked);
  ownedPut('/opportunities/:id/stage', dependencies.permission('leads', 'update'), legacyWriteBlocked);
  ownedDelete('/opportunities/:id', dependencies.permission('leads', 'delete'), legacyWriteBlocked);
  ownedPost('/workflows', dependencies.permission('calendar', 'create'), legacyWriteBlocked);
  ownedPut('/workflows/:id', dependencies.permission('calendar', 'update'), legacyWriteBlocked);
  ownedPost('/workflows/:id/complete', dependencies.permission('calendar', 'update'), legacyWriteBlocked);
  ownedPost('/financial/estimates', dependencies.permission('leads', 'create'), legacyWriteBlocked);
  ownedPatch('/leads/:id/status', dependencies.permission('leads', 'update'), legacyWriteBlocked);
  ownedPost('/calendar/import/ics', dependencies.permission('calendar', 'create'), legacyWriteBlocked);
  ownedPost('/polaris/estimate', dependencies.permission('leads', 'create'), legacyWriteBlocked);
  ownedPost('/polaris/complete', legacyWriteBlocked);
  ownedPost('/polaris/recommendations/generate', legacyWriteBlocked);
  ownedPut('/polaris/recommendations/:id/resolve', legacyWriteBlocked);
  ownedPost('/polaris/pipeline', legacyWriteBlocked);
  ownedPost('/polaris/config', legacyWriteBlocked);

  ownedGet('/customers/:id', async function (req, res) {
    try {
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), requestContext(req), req.params.id);
      if (!item || item.ids.customer !== req.params.id) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found.' } });
      return res.json({ ...item.customer, canonical: surfaceProjection('customer-detail', [item]).items[0] });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  async function canonicalDetail(req, res, identifierKey, notFoundMessage, shape) {
    try {
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), requestContext(req), req.params.id);
      if (!item || item.ids[identifierKey] !== req.params.id) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: notFoundMessage } });
      }
      return res.json(shape(item));
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  }

  ownedGet('/communications/:id', function (req, res) {
    return canonicalDetail(req, res, 'communication', 'Communication not found.', function (item) {
      return { ...item.communication, transcript: item.transcript, customer: item.customer, canonical: surfaceProjection('communications', [item]).items[0] };
    });
  });
  ownedGet('/opportunities/:id', function (req, res) {
    return canonicalDetail(req, res, 'opportunity', 'Opportunity not found.', function (item) {
      return { ...item.opportunity, customer: item.customer, canonical: surfaceProjection('leads', [item]).items[0] };
    });
  });
  ownedGet('/financial/estimates/:id', function (req, res) {
    return canonicalDetail(req, res, 'estimate', 'Estimate not found.', function (item) {
      return { ...item.estimate, canonical: surfaceProjection('estimates', [item]).items[0] };
    });
  });
  ownedGet('/leads/:id/intelligence', function (req, res) {
    return canonicalDetail(req, res, 'opportunity', 'Lead not found.', function (item) {
      return { success: true, data: { values: item.snapshot, facts: item.facts, calculationVersion: item.calculationVersion, snapshotDigest: item.snapshotDigest } };
    });
  });

  ownedGet('/leads/:id', async function (req, res) {
    try {
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), requestContext(req), req.params.id);
      if (!item || item.ids.opportunity !== req.params.id) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found.' } });
      return res.json({ ...item.opportunity, customer: item.customer, canonical: surfaceProjection('leads', [item]).items[0] });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  return router;
}

module.exports = {
  READ_MODEL_VERSION,
  SURFACES,
  aggregate,
  alertProjection,
  compatibilityProjection,
  createCanonicalRouter,
  createCompatibilityRouter,
  getCanonicalGraph,
  listCanonicalGraphs,
  pipelineStageProjection,
  projectRow,
  recommendationProjection,
  requestContext,
  serviceAnalyticsProjection,
  surfaceProjection,
  trendProjection,
};
