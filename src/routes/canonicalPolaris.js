'use strict';

const express = require('express');
const db = require('../db');
const cache = require('../cache/client');
const audit = require('../audit/client');
const { requireAuth } = require('../auth/middleware');
const { sha256, stableValue } = require('../services/businessProfileAdapter');

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

function queryFilters(req) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
  return stableValue({
    limit,
    status: typeof req.query.status === 'string' ? req.query.status : null,
    customerId: UUID.test(String(req.query.customerId || '')) ? String(req.query.customerId) : null,
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
         ps.normalized_input_fingerprint, ps.business_profile_version,
         ps.business_profile_hash, ps.supporting_fact_ids, ps.snapshot,
         ps.snapshot_digest, ps.created_at AS snapshot_created_at
    FROM canonical_operations o
    JOIN canonical_customers c
      ON c.organization_id = o.organization_id AND c.operation_id = o.id
    JOIN canonical_transcripts t
      ON t.organization_id = o.organization_id AND t.operation_id = o.id
    JOIN canonical_communications cm
      ON cm.organization_id = o.organization_id AND cm.operation_id = o.id
    JOIN canonical_opportunities op
      ON op.organization_id = o.organization_id AND op.operation_id = o.id
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
  const result = await pool.query(GRAPH_SELECT + where + ` ORDER BY ps.created_at DESC LIMIT $3`, values);
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

function aggregate(items) {
  const values = items.map(function (item) { return item.snapshot; });
  const revenue = values.reduce(function (sum, value) {
    return sum + (Number(value && value.estimatedRevenue) || 0);
  }, 0);
  const knownGrossProfit = values.filter(function (value) { return value && value.grossProfit !== null; });
  return {
    graphCount: items.length,
    customerCount: new Set(items.map(function (item) { return item.ids.customer; })).size,
    estimatedRevenue: Math.round(revenue * 100) / 100,
    knownGrossProfit: knownGrossProfit.length
      ? Math.round(knownGrossProfit.reduce(function (sum, value) { return sum + Number(value.grossProfit); }, 0) * 100) / 100
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
        values: item.snapshot,
      };
    }),
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
    cache: supplied.cache || cache,
    audit: supplied.audit || audit,
  };
}

function sendPersistenceUnavailable(res) {
  return res.status(503).json({
    success: false,
    error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: 'Canonical PostgreSQL persistence is unavailable.' },
  });
}

async function authoritativeItems(req, dependencies, endpoint) {
  const context = requestContext(req);
  const filters = queryFilters(req);
  const identity = {
    ...context,
    endpoint,
    filters,
    readModelVersion: READ_MODEL_VERSION,
  };
  const fetchAuthoritative = async function () {
    const pool = resolvePool(dependencies.poolProvider);
    return listCanonicalGraphs(pool, context, filters);
  };
  try {
    return await dependencies.cache.wrapCanonical(identity, fetchAuthoritative, 30);
  } catch (_cacheError) {
    return fetchAuthoritative();
  }
}

function createCanonicalRouter(options) {
  const dependencies = createDependencies(options);
  const router = express.Router();
  router.use(dependencies.auth);
  router.use(function (req, res, next) {
    if (!requestContext(req)) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    }
    return next();
  });

  router.get('/status', async function (req, res) {
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
          cacheEnabled: dependencies.cache.isAvailable(),
        },
      });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  router.get('/graphs', async function (req, res) {
    if (!requestContext(req)) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    try {
      const items = await authoritativeItems(req, dependencies, 'canonical.graphs');
      return res.json({ success: true, data: { items, count: items.length, readModelVersion: READ_MODEL_VERSION, digest: sha256(items.map(item => item.projectionDigest)) } });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  for (const endpoint of ['dashboard', 'analytics']) {
    router.get('/' + endpoint, async function (req, res) {
      if (!requestContext(req)) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
      try {
        const items = await authoritativeItems(req, dependencies, 'canonical.' + endpoint);
        return res.json({ success: true, data: { ...aggregate(items), digest: sha256(items.map(item => item.projectionDigest)), readModelVersion: READ_MODEL_VERSION } });
      } catch (_error) {
        return sendPersistenceUnavailable(res);
      }
    });
  }

  router.get('/surfaces/:surface', async function (req, res) {
    if (!SURFACES.has(req.params.surface)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Surface not found.' } });
    try {
      const items = await authoritativeItems(req, dependencies, 'canonical.surface.' + req.params.surface);
      return res.json({ success: true, data: surfaceProjection(req.params.surface, items, requestContext(req)) });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  router.get('/compat/:surface', async function (req, res) {
    if (!SURFACES.has(req.params.surface)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Compatibility projection not found.' } });
    try {
      const items = await authoritativeItems(req, dependencies, 'canonical.compat.' + req.params.surface);
      return res.json({ success: true, data: compatibilityProjection(req.params.surface, items, requestContext(req)) });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  router.patch('/appointments/:id', express.json(), async function (req, res) {
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
        await dependencies.cache.invalidateOrg(context.organizationId);
      } catch (_cacheError) {
        // PostgreSQL has already committed the authoritative mutation.
      }
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

  router.get('/graphs/:id', async function (req, res) {
    const context = requestContext(req);
    try {
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), context, req.params.id);
      if (!item) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Canonical graph not found.' } });
      return res.json({ success: true, data: item });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  router.get('/snapshots/:id', async function (req, res) {
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
  router.use(dependencies.auth);
  router.use(function (req, res, next) {
    if (!requestContext(req)) {
      return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    }
    return next();
  });

  function handle(surface, shape) {
    return async function (req, res) {
      try {
        const items = await authoritativeItems(req, dependencies, 'compat.' + surface + '.' + req.path);
        const projection = compatibilityProjection(surface, items);
        return res.json(shape(projection, items));
      } catch (_error) {
        return sendPersistenceUnavailable(res);
      }
    };
  }

  router.get('/customers', handle('customer-detail', function (projection) { return { customers: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/communications', handle('communications', function (projection) { return { communications: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/opportunities/pipeline', handle('leads', function (projection) { return { stages: {}, opportunities: projection.records, canonicalDigest: projection.digest }; }));
  router.get('/opportunities', handle('leads', function (projection) { return { opportunities: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/financial/estimates', handle('estimates', function (projection) { return { estimates: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/analytics/executive', handle('executive', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));
  router.get('/analytics/kpis', handle('executive', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));
  router.get('/analytics/dashboard', handle('command-center', function (projection) { return { ...projection.metrics, items: projection.records, canonicalDigest: projection.digest }; }));
  router.get('/analytics/alerts', handle('executive', function (projection) { return { alerts: [], canonicalDigest: projection.digest }; }));
  router.get('/workflows/agenda/today', handle('calendar', function (projection) { return { tasks: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/leads', handle('leads', function (projection) { return { leads: projection.records, items: projection.records, total: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/calls', handle('communications', function (projection) { return { calls: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/appointments', handle('calendar', function (projection) { return { appointments: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/dashboard/overview', handle('command-center', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));
  router.get('/dashboard/status', async function (req, res) {
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
  router.get('/calendar/events', handle('calendar', function (projection) { return { events: projection.records, count: projection.records.length, canonicalDigest: projection.digest }; }));
  router.get('/financial/metrics', handle('estimates', function (projection) { return { ...projection.metrics, canonicalDigest: projection.digest }; }));

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
  router.post('/leads/simulate', legacyWriteBlocked);
  router.post('/analytics/seed', legacyWriteBlocked);
  router.post('/calendar/events', legacyWriteBlocked);
  router.put('/calendar/events/:id', legacyWriteBlocked);
  router.delete('/calendar/events/:id', legacyWriteBlocked);
  router.post('/calls/:id/mark-known', legacyWriteBlocked);

  router.get('/customers/:id', async function (req, res) {
    try {
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), requestContext(req), req.params.id);
      if (!item || item.ids.customer !== req.params.id) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found.' } });
      return res.json({ ...item.customer, canonical: surfaceProjection('customer-detail', [item]).items[0] });
    } catch (_error) {
      return sendPersistenceUnavailable(res);
    }
  });

  router.get('/leads/:id', async function (req, res) {
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
  compatibilityProjection,
  createCanonicalRouter,
  createCompatibilityRouter,
  getCanonicalGraph,
  listCanonicalGraphs,
  projectRow,
  requestContext,
  surfaceProjection,
};
