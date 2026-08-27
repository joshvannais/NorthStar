'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../audit/client');
const {
  requireOnboardedInternal,
  requireTenantAccess,
  requireVerifiedExternalAction,
} = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { sha256, stableStringify, stableValue } = require('../services/businessProfileAdapter');
const { bindIntegrationOwner } = require('../services/organizationAuthority');
const { scheduleAuthority } = require('../scheduling/repository');
const {
  normalizeMutationApproval,
  normalizeMutationPreview,
} = require('../scheduling/approvalContract');
const {
  approveMutation,
  createMutationPreview,
} = require('../scheduling/approvalRepository');
const { requireApprovalBodyBoundary } = require('../scheduling/approvalHttpBoundary');
const {
  normalizeAvailabilityMutation,
  normalizeConflictEvaluation,
} = require('../scheduling/conflictContract');
const {
  evaluateScheduleConflicts,
  replaceAvailability,
} = require('../scheduling/conflictRepository');
const { normalizeRecommendationEvaluation } = require('../scheduling/recommendationContract');
const { recommendAppointmentCandidates } = require('../scheduling/recommendationRepository');
const { requireRecommendationBodyBoundary } = require('../scheduling/recommendationHttpBoundary');
const {
  actorInput,
  loadSchedulingOperatorDirectory,
} = require('../scheduling/operatorDirectory');
const {
  buildSchedulingOverviewPage,
} = require('../scheduling/overviewRepository');
const {
  encodeGraphCursor,
  validateGraphCursor,
} = require('../scheduling/graphCursor');
const schedulingTime = require('../../public/js/scheduling-time-contract');

const READ_MODEL_VERSION = 'm22-part1-read-v1';
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

function validateCustomerIdFilter(raw, keyPresent) {
  if (!keyPresent) return null;                             // absent — no filter
  if (typeof raw !== 'string') return failClosed();         // arrays, objects, numbers, booleans
  if (raw.length === 0) return failClosed();                // empty string
  if (raw !== raw.trim()) return failClosed();              // leading/trailing whitespace — not canonical
  if (UUID.test(raw) && raw.length === 36) return raw;      // valid, exact length, no coercion
  return failClosed();                                      // partial, overlong, anything else

  function failClosed() {
    const error = new Error('Invalid customerId filter value');
    error.code = 'INVALID_CUSTOMER_ID';
    error.statusCode = 400;
    throw error;
  }
}

function queryFilters(req) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
  return stableValue({
    limit,
    cursor: validateGraphCursor(req.query.cursor),
    status: typeof req.query.status === 'string' ? req.query.status : null,
    customerId: validateCustomerIdFilter(
      req.query.customerId,
      Object.prototype.hasOwnProperty.call(req.query, 'customerId')
    ),
  });
}

const GRAPH_SELECT = `
  SELECT o.id AS operation_id, o.graph_id, o.state AS operation_state,
         o.payload_fingerprint AS operation_payload_fingerprint,
         o.claimed_at AS operation_claimed_at, o.completed_at AS operation_completed_at,
         o.created_at AS operation_created_at, o.updated_at AS operation_updated_at,
         c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
         c.phone AS customer_phone, c.address AS customer_address,
         c.external_customer_id, c.created_at AS customer_created_at,
         c.updated_at AS customer_updated_at,
         t.id AS transcript_id, t.source, t.source_version, t.external_call_id,
         t.external_transcript_id, t.transcript_text,
         t.normalized_fingerprint AS transcript_fingerprint,
         t.occurred_at AS transcript_occurred_at, t.created_at AS transcript_created_at,
         cm.id AS communication_id, cm.channel, cm.direction, cm.subject,
         cm.external_communication_id, cm.duration_seconds,
         cm.occurred_at AS communication_occurred_at,
         cm.created_at AS communication_created_at,
         op.id AS opportunity_id, op.status AS opportunity_status,
         op.service_type, op.job_scope, op.appointment_preference,
         op.created_at AS opportunity_created_at, op.updated_at AS opportunity_updated_at,
         e.id AS estimate_id, e.currency, e.customer_price, e.line_items,
         e.calculation_version AS estimate_calculation_version,
         e.normalized_input_fingerprint AS estimate_normalized_input_fingerprint,
         e.business_profile_id AS estimate_business_profile_id,
         e.business_profile_version AS estimate_business_profile_version,
         e.business_profile_hash AS estimate_business_profile_hash,
         e.calculation_output AS estimate_calculation_output,
         e.snapshot_digest AS estimate_snapshot_digest,
         e.created_at AS estimate_created_at,
         a.id AS appointment_id, a.external_appointment_id, a.preference,
         a.scheduled_start, a.scheduled_end, a.status AS appointment_status,
         a.created_at AS appointment_created_at, a.updated_at AS appointment_updated_at,
         sa.id AS assignment_id, sa.target_state, sa.workforce_profile_id,
         sa.workforce_crew_id, sa.schedule_state, sa.dispatch_state,
         sa.scheduled_start AS assignment_scheduled_start,
         sa.scheduled_end AS assignment_scheduled_end,
         sa.appointment_status AS assignment_appointment_status,
         sa.needs_review, sa.review_reasons, sa.revision,
         sa.canonical_digest, sa.last_action_code, sa.last_reason,
         sa.updated_at AS assignment_updated_at,
         ps.id AS polaris_snapshot_id, ps.calculation_version,
         ps.normalized_input_fingerprint, ps.business_profile_id, ps.business_profile_version,
         ps.business_profile_hash, ps.supporting_fact_ids, ps.snapshot,
         ps.snapshot_digest, ps.created_at AS snapshot_created_at,
         to_char(ps.created_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_cursor_created_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', f.id,
             'ordinal', f.ordinal,
             'variable', f.fact_type,
             'status', f.value ->> 'status',
             'normalizedValue', f.value -> 'value',
             'clientFactId', f.value ->> 'clientFactId',
             'evidenceText', f.evidence_text,
             'speaker', f.speaker,
             'confidence', f.confidence,
             'sourceStart', f.source_start,
             'sourceEnd', f.source_end,
             'factFingerprint', f.fact_fingerprint,
             'createdAt', f.created_at
           ) ORDER BY f.ordinal)
             FROM public.canonical_facts f
            WHERE f.organization_id = o.organization_id
              AND f.operation_id = o.id
         ), '[]'::jsonb) AS facts
    FROM public.canonical_operations o
    JOIN public.canonical_transcripts t
      ON t.organization_id = o.organization_id AND t.operation_id = o.id
    JOIN public.canonical_communications cm
      ON cm.organization_id = o.organization_id AND cm.operation_id = o.id
    JOIN public.canonical_opportunities op
      ON op.organization_id = o.organization_id AND op.operation_id = o.id
    JOIN public.canonical_customers c
      ON c.organization_id = o.organization_id AND c.id = op.customer_id
    JOIN public.canonical_estimates e
      ON e.organization_id = o.organization_id AND e.operation_id = o.id
    JOIN public.canonical_appointments a
      ON a.organization_id = o.organization_id AND a.operation_id = o.id
    JOIN public.canonical_schedule_assignments sa
      ON sa.organization_id = a.organization_id AND sa.appointment_id = a.id
    JOIN public.canonical_polaris_snapshots ps
      ON ps.organization_id = o.organization_id AND ps.operation_id = o.id`;

function timestamp(value, field) {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    const error = new Error('Canonical ' + field + ' is not a valid timestamp.');
    error.code = 'CANONICAL_PROJECTION_CONTRADICTION';
    throw error;
  }
  return parsed.toISOString();
}

function persistedFacts(row) {
  return (Array.isArray(row.facts) ? row.facts : []).map(function (fact) {
    return {
      id: fact.id,
      ordinal: Number(fact.ordinal),
      variable: fact.variable,
      status: fact.status,
      normalizedValue: fact.normalizedValue,
      clientFactId: fact.clientFactId || null,
      evidenceText: fact.evidenceText,
      speaker: fact.speaker,
      confidence: fact.confidence === null || fact.confidence === undefined ? null : Number(fact.confidence),
      sourceStart: fact.sourceStart === null || fact.sourceStart === undefined ? null : Number(fact.sourceStart),
      sourceEnd: fact.sourceEnd === null || fact.sourceEnd === undefined ? null : Number(fact.sourceEnd),
      factFingerprint: fact.factFingerprint,
      createdAt: timestamp(fact.createdAt, 'fact createdAt'),
    };
  });
}

function assertPersistedSnapshotAgreement(row) {
  const persistedPrice = row.customer_price === null || row.customer_price === undefined
    ? null
    : Number(row.customer_price);
  const snapshotPriceValue = row.snapshot && row.snapshot.customerFacingPrice;
  const snapshotPrice = snapshotPriceValue === null || snapshotPriceValue === undefined
    ? null
    : Number(snapshotPriceValue);
  const matches = row.snapshot_digest === row.estimate_snapshot_digest &&
    sha256(row.snapshot) === row.snapshot_digest &&
    stableStringify(row.snapshot) === stableStringify(row.estimate_calculation_output) &&
    row.calculation_version === row.estimate_calculation_version &&
    row.normalized_input_fingerprint === row.estimate_normalized_input_fingerprint &&
    row.business_profile_id === row.estimate_business_profile_id &&
    row.business_profile_version === row.estimate_business_profile_version &&
    row.business_profile_hash === row.estimate_business_profile_hash &&
    stableStringify(row.line_items) === stableStringify(row.snapshot && row.snapshot.pricingLineItems) &&
    persistedPrice === snapshotPrice;
  if (!matches) {
    const error = new Error('Persisted canonical estimate and Polaris snapshot disagree.');
    error.code = 'CANONICAL_PROJECTION_CONTRADICTION';
    throw error;
  }
}

function assertScheduleAgreement(row) {
  const matches = row.assignment_id &&
    timestamp(row.scheduled_start, 'appointment scheduledStart') ===
      timestamp(row.assignment_scheduled_start, 'assignment scheduledStart') &&
    timestamp(row.scheduled_end, 'appointment scheduledEnd') ===
      timestamp(row.assignment_scheduled_end, 'assignment scheduledEnd') &&
    row.appointment_status === row.assignment_appointment_status;
  if (!matches) {
    const error = new Error('Persisted appointment and canonical schedule authority disagree.');
    error.code = 'CANONICAL_PROJECTION_CONTRADICTION';
    throw error;
  }
}

function projectRow(row) {
  assertPersistedSnapshotAgreement(row);
  assertScheduleAgreement(row);
  const facts = persistedFacts(row);
  const timestamps = {
    operationClaimedAt: timestamp(row.operation_claimed_at, 'operation claimedAt'),
    operationCreatedAt: timestamp(row.operation_created_at, 'operation createdAt'),
    operationCompletedAt: timestamp(row.operation_completed_at, 'operation completedAt'),
    operationUpdatedAt: timestamp(row.operation_updated_at, 'operation updatedAt'),
    customerCreatedAt: timestamp(row.customer_created_at, 'customer createdAt'),
    customerUpdatedAt: timestamp(row.customer_updated_at, 'customer updatedAt'),
    transcriptOccurredAt: timestamp(row.transcript_occurred_at, 'transcript occurredAt'),
    transcriptCreatedAt: timestamp(row.transcript_created_at, 'transcript createdAt'),
    communicationOccurredAt: timestamp(row.communication_occurred_at, 'communication occurredAt'),
    communicationCreatedAt: timestamp(row.communication_created_at, 'communication createdAt'),
    opportunityCreatedAt: timestamp(row.opportunity_created_at, 'opportunity createdAt'),
    opportunityUpdatedAt: timestamp(row.opportunity_updated_at, 'opportunity updatedAt'),
    estimateCreatedAt: timestamp(row.estimate_created_at, 'estimate createdAt'),
    appointmentCreatedAt: timestamp(row.appointment_created_at, 'appointment createdAt'),
    appointmentUpdatedAt: timestamp(row.appointment_updated_at, 'appointment updatedAt'),
    snapshotCreatedAt: timestamp(row.snapshot_created_at, 'snapshot createdAt'),
  };
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
      scheduleAssignment: row.assignment_id,
      polarisSnapshot: row.polaris_snapshot_id,
      facts: facts.map(function (fact) { return fact.id; }),
    },
    source: {
      type: row.source,
      version: row.source_version,
      externalCustomerId: row.external_customer_id,
      externalCallId: row.external_call_id,
      externalTranscriptId: row.external_transcript_id,
      externalCommunicationId: row.external_communication_id,
      externalAppointmentId: row.external_appointment_id,
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
      occurredAt: timestamps.transcriptOccurredAt,
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
      scheduledStart: timestamp(row.assignment_scheduled_start, 'assignment scheduledStart'),
      scheduledEnd: timestamp(row.assignment_scheduled_end, 'assignment scheduledEnd'),
      status: row.assignment_appointment_status,
      scheduleAuthority: scheduleAuthority({
        ...row,
        scheduled_start: row.assignment_scheduled_start,
        scheduled_end: row.assignment_scheduled_end,
        appointment_status: row.assignment_appointment_status,
      }),
    },
    facts,
    calculationVersion: row.calculation_version,
    normalizedInputFingerprint: row.normalized_input_fingerprint,
    businessProfileInputVersion: row.business_profile_version,
    businessProfileInputHash: row.business_profile_hash,
    businessProfileAuthorityId: row.business_profile_id,
    supportingTranscriptFactIds: row.supporting_fact_ids,
    snapshotDigest: row.snapshot_digest,
    snapshot: row.snapshot,
    snapshotCreatedAt: timestamps.snapshotCreatedAt,
    timestamps,
    metadata: {
      operationState: row.operation_state,
      operationPayloadFingerprint: row.operation_payload_fingerprint,
      transcriptFingerprint: row.transcript_fingerprint,
    },
  };
  projection.projectionDigest = sha256({
    readModelVersion: projection.readModelVersion,
    ids: projection.ids,
    source: projection.source,
    facts: projection.facts,
    normalizedInputFingerprint: projection.normalizedInputFingerprint,
    supportingTranscriptFactIds: projection.supportingTranscriptFactIds,
    calculationVersion: projection.calculationVersion,
    snapshotDigest: projection.snapshotDigest,
    scheduleAuthority: projection.appointment.scheduleAuthority,
    timestamps: projection.timestamps,
    metadata: projection.metadata,
    businessProfile: {
      id: projection.businessProfileAuthorityId,
      version: projection.businessProfileInputVersion,
      hash: projection.businessProfileInputHash,
    },
  });
  // PostgreSQL stores microseconds while JavaScript Date retains milliseconds.
  // Keep the exact trusted UTC ordering value private to server pagination so a
  // keyset cursor cannot omit rows that share a JavaScript millisecond.
  Object.defineProperty(projection, '_paginationCreatedAt', {
    value: row.snapshot_cursor_created_at,
    enumerable: false,
    writable: false,
  });
  return projection;
}

async function listCanonicalGraphPage(pool, context, filters) {
  const limit = Math.max(1, Math.min(100, Number(filters && filters.limit) || 50));
  const suppliedCursor = filters && filters.cursor && typeof filters.cursor === 'object'
    ? filters.cursor.raw : filters && filters.cursor;
  const cursor = validateGraphCursor(suppliedCursor);
  const values = [context.organizationId, context.explicitSession];
  let where = `
    WHERE o.organization_id = $1 AND o.state = 'completed'
      AND (t.source NOT IN ('simulation', 'demo')
        OR ($2::text IS NOT NULL AND t.external_call_id = $2 || ':call'))`;
  if (filters && filters.status) {
    values.push(filters.status);
    where += ` AND op.status = $${values.length}`;
  }
  if (filters && filters.customerId) {
    values.push(filters.customerId);
    where += ` AND c.id = $${values.length}`;
  }
  if (cursor) {
    values.push(cursor.createdAt, cursor.operationId);
    where += ` AND (ps.created_at < $${values.length - 1}::timestamptz
      OR (ps.created_at = $${values.length - 1}::timestamptz AND o.id > $${values.length}::uuid))`;
  }
  values.push(limit + 1);
  const result = await pool.query(GRAPH_SELECT + where +
    ` ORDER BY ps.created_at DESC, o.id ASC LIMIT $${values.length}`, values);
  const projected = result.rows.map(projectRow);
  const items = projected.slice(0, limit);
  return Object.freeze({
    items,
    cursor: cursor && cursor.raw || null,
    nextCursor: projected.length > limit && items.length ? encodeGraphCursor(items[items.length - 1]) : null,
    pageSize: limit,
    shown: items.length,
    hasMore: projected.length > limit,
  });
}

async function listCanonicalGraphs(pool, context, filters) {
  return (await listCanonicalGraphPage(pool, context, filters)).items;
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

async function currentCalendarTimeZoneAuthority(pool, context) {
  const result = await pool.query(
    `SELECT id, version_number, normalized_profile_hash,
            raw_profile #>> '{company,timeZone}' AS time_zone
       FROM public.canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE
      ORDER BY version_number DESC, id`,
    [context.organizationId]
  );
  const profile = result.rowCount === 1 ? result.rows[0] : null;
  if (!profile || !UUID.test(String(profile.id || '')) ||
      !Number.isSafeInteger(Number(profile.version_number)) || Number(profile.version_number) < 1 ||
      !/^[0-9a-f]{64}$/.test(String(profile.normalized_profile_hash || '')) ||
      !schedulingTime.isValidTimeZone(profile.time_zone)) {
    const error = new Error('A current authoritative tenant IANA time zone is required before scheduling.');
    error.code = 'M22_TIME_ZONE_AUTHORITY_REQUIRED';
    error.statusCode = 409;
    throw error;
  }
  return Object.freeze({
    profileId: String(profile.id),
    profileVersion: Number(profile.version_number),
    profileHash: String(profile.normalized_profile_hash),
    timeZone: profile.time_zone,
  });
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
        source: item.source,
        facts: item.facts,
        normalizedInputFingerprint: item.normalizedInputFingerprint,
        supportingTranscriptFactIds: item.supportingTranscriptFactIds,
        calculationVersion: item.calculationVersion,
        snapshotDigest: item.snapshotDigest,
        projectionDigest: item.projectionDigest,
        snapshotCreatedAt: item.snapshotCreatedAt,
        timestamps: item.timestamps,
        metadata: item.metadata,
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

function compatibilityProjection(surface, items, context, calendarTimeZoneAuthority) {
  let common = surfaceProjection(surface, items, context);
  if (surface === 'calendar') {
    if (!calendarTimeZoneAuthority || !schedulingTime.isValidTimeZone(calendarTimeZoneAuthority.timeZone)) {
      const error = new Error('A current authoritative tenant IANA time zone is required before scheduling.');
      error.code = 'M22_TIME_ZONE_AUTHORITY_REQUIRED';
      error.statusCode = 409;
      throw error;
    }
    common = {
      ...common,
      digest: sha256({
        graphs: items.map(function (item) { return item.projectionDigest; }),
        timeZoneAuthority: calendarTimeZoneAuthority,
      }),
      timeZoneAuthority: stableValue(calendarTimeZoneAuthority),
    };
  }
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
    auth: supplied.auth || requireTenantAccess,
    onboardedAuth: supplied.onboardedAuth || supplied.auth || requireOnboardedInternal,
    externalAuth: supplied.externalAuth || supplied.auth || requireVerifiedExternalAction,
    permission: supplied.permission || requirePermission,
    audit: supplied.audit || audit,
    operatorDirectory: supplied.operatorDirectory || loadSchedulingOperatorDirectory,
  };
}

function sendPersistenceUnavailable(res, req) {
  return res.status(503).json({
    success: false,
    requestId: (req && req.requestId) || undefined,
    error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE', message: 'Canonical PostgreSQL persistence is unavailable.' },
  });
}

function sendInvalidCustomerId(res, req) {
  return res.status(400).json({
    success: false,
    requestId: (req && req.requestId) || undefined,
    error: { code: 'INVALID_CUSTOMER_ID', message: 'Invalid customerId filter value.' },
  });
}

function handleEndpointError(res, _error, req) {
  if (_error && _error.code === 'INVALID_CUSTOMER_ID') return sendInvalidCustomerId(res, req);
  if (_error && Number.isInteger(_error.statusCode) && _error.code) {
    return res.status(_error.statusCode).json({
      success: false,
      requestId: req && req.requestId || undefined,
      error: { code: _error.code, message: _error.message },
    });
  }
  return sendPersistenceUnavailable(res, req);
}

async function authoritativeItems(req, dependencies, endpoint) {
  const context = requestContext(req);
  const filters = queryFilters(req);
  void endpoint;
  const pool = resolvePool(dependencies.poolProvider);
  return listCanonicalGraphs(pool, context, filters);
}

async function requireBroadSchedulingRead(req, dependencies, denial) {
  const pool = resolvePool(dependencies.poolProvider);
  const schedulingOperator = await dependencies.operatorDirectory(pool, actorInput(req));
  if (schedulingOperator.canRead !== true) {
    const error = new Error(denial && denial.message ||
      'Broad canonical customer and scheduling data is limited to current owners, admins, and active dispatchers.');
    error.code = denial && denial.code || 'M22_BROAD_SCHEDULING_READ_FORBIDDEN';
    error.status = 403;
    error.statusCode = 403;
    throw error;
  }
  return schedulingOperator;
}

async function canonicalStatus(req, dependencies) {
  try {
    await requireBroadSchedulingRead(req, dependencies);
  } catch (error) {
    if (!error || error.code !== 'M22_BROAD_SCHEDULING_READ_FORBIDDEN') throw error;
    return {
      status: 'operational',
      readModelVersion: READ_MODEL_VERSION,
      postgresAuthoritative: true,
      redisRequired: false,
      canonicalResponseCaching: false,
      broadSchedulingRead: false,
    };
  }
  const context = requestContext(req);
  const result = await resolvePool(dependencies.poolProvider).query(
    `SELECT COUNT(*)::int AS completed_graphs FROM public.canonical_operations
      WHERE organization_id = $1 AND state = 'completed'`,
    [context.organizationId]
  );
  return {
    status: 'operational',
    readModelVersion: READ_MODEL_VERSION,
    completedGraphs: result.rows[0].completed_graphs,
    postgresAuthoritative: true,
    redisRequired: false,
    canonicalResponseCaching: false,
    broadSchedulingRead: true,
  };
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
      return res.json({
        success: true,
        data: await canonicalStatus(req, dependencies),
      });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
    }
  });

  router.get('/graphs', dependencies.auth, requireCanonicalContext, async function (req, res) {
    if (!requestContext(req)) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    try {
      queryFilters(req);
      await requireBroadSchedulingRead(req, dependencies);
      const items = await authoritativeItems(req, dependencies, 'canonical.graphs');
      return res.json({ success: true, data: { items, count: items.length, readModelVersion: READ_MODEL_VERSION, digest: sha256(items.map(item => item.projectionDigest)) } });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
    }
  });

  for (const endpoint of ['dashboard', 'analytics']) {
    router.get('/' + endpoint, dependencies.auth, requireCanonicalContext, async function (req, res) {
      if (!requestContext(req)) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
      try {
        queryFilters(req);
        await requireBroadSchedulingRead(req, dependencies);
        const items = await authoritativeItems(req, dependencies, 'canonical.' + endpoint);
        return res.json({ success: true, data: { ...aggregate(items), digest: sha256(items.map(item => item.projectionDigest)), readModelVersion: READ_MODEL_VERSION } });
      } catch (_error) {
        return handleEndpointError(res, _error, req);
      }
    });
  }

  router.get('/surfaces/:surface', dependencies.auth, requireCanonicalContext, async function (req, res) {
    if (!SURFACES.has(req.params.surface)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Surface not found.' } });
    try {
      queryFilters(req);
      await requireBroadSchedulingRead(req, dependencies);
      const items = await authoritativeItems(req, dependencies, 'canonical.surface.' + req.params.surface);
      return res.json({ success: true, data: surfaceProjection(req.params.surface, items, requestContext(req)) });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
    }
  });

  router.get('/compat/:surface', dependencies.auth, requireCanonicalContext, async function (req, res) {
    if (!SURFACES.has(req.params.surface)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Compatibility projection not found.' } });
    try {
      const filters = queryFilters(req);
      const context = requestContext(req);
      const pool = resolvePool(dependencies.poolProvider);
      const schedulingOperator = await requireBroadSchedulingRead(req, dependencies,
        req.params.surface === 'calendar' ? {
          code: 'CALENDAR_OPERATOR_REQUIRED',
          message: 'The broad scheduling Calendar is limited to current owners, admins, and active dispatchers.',
        } : null);
      let schedulingOverview = null;
      let items;
      if (req.params.surface === 'calendar') {
        const evaluated = await buildSchedulingOverviewPage(pool, {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          actorAccessRole: req.userRole,
          authSessionId: req.authSession && req.authSession.id,
          cursor: filters.cursor && filters.cursor.raw || null,
          loadPage: (client, page) => listCanonicalGraphPage(client, context, {
            limit: page.limit, cursor: page.cursor, status: null, customerId: null,
          }),
        });
        schedulingOverview = evaluated.overview;
        items = evaluated.pageItems;
      } else {
        items = await listCanonicalGraphs(pool, context, filters);
      }
      const timeZoneAuthority = req.params.surface === 'calendar'
        ? await currentCalendarTimeZoneAuthority(pool, context)
        : null;
      let projection = compatibilityProjection(req.params.surface, items, context, timeZoneAuthority);
      if (req.params.surface === 'calendar') {
        projection = {
          ...projection,
          digest: sha256({
            compatibilityDigest: projection.digest,
            schedulingOperatorDigest: schedulingOperator.digest,
            schedulingOverviewDigest: schedulingOverview && schedulingOverview.digest,
          }),
          schedulingOperator,
          schedulingOverview,
        };
      }
      return res.json({ success: true, data: projection });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
    }
  });

  router.put('/availability/profiles/:id', dependencies.onboardedAuth, requireCanonicalContext,
    dependencies.permission('calendar', 'update'), express.json(), async function (req, res) {
      const context = requestContext(req);
      try {
        const mutation = normalizeAvailabilityMutation({
          body: req.body,
          profileId: req.params.id,
          idempotencyKey: req.get('Idempotency-Key'),
        });
        const updated = await replaceAvailability(resolvePool(dependencies.poolProvider), {
          ...mutation,
          organizationId: context.organizationId,
          actorUserId: context.userId,
          actorAccessRole: req.userRole || req.tenantContext.role,
          authSessionId: req.authSession && req.authSession.id,
        });
        if (updated.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(updated.status).json(updated.body);
      } catch (error) {
        if (error && Number.isInteger(error.status) && error.code) {
          return res.status(error.status).json({
            success: false,
            error: { code: error.code, message: error.message },
          });
        }
        return sendPersistenceUnavailable(res, req);
      }
    });

  router.post('/appointments/:id/conflicts', dependencies.onboardedAuth, requireCanonicalContext,
    dependencies.permission('calendar', 'read'), express.json(), async function (req, res) {
      const context = requestContext(req);
      try {
        const evaluation = normalizeConflictEvaluation({ body: req.body, appointmentId: req.params.id });
        const response = await evaluateScheduleConflicts(resolvePool(dependencies.poolProvider), {
          ...evaluation,
          organizationId: context.organizationId,
          actorUserId: context.userId,
          actorAccessRole: req.userRole || req.tenantContext.role,
          authSessionId: req.authSession && req.authSession.id,
          explicitSession: context.explicitSession,
        });
        return res.json(response);
      } catch (error) {
        if (error && Number.isInteger(error.status) && error.code) {
          return res.status(error.status).json({
            success: false,
            error: { code: error.code, message: error.message },
          });
        }
        return sendPersistenceUnavailable(res, req);
      }
    });

  router.post('/appointments/:id/recommendations', requireRecommendationBodyBoundary,
    dependencies.onboardedAuth, requireCanonicalContext,
    dependencies.permission('calendar', 'read'), async function (req, res) {
      const context = requestContext(req);
      try {
        const evaluation = normalizeRecommendationEvaluation({ body: req.body, appointmentId: req.params.id });
        const response = await recommendAppointmentCandidates(resolvePool(dependencies.poolProvider), {
          ...evaluation,
          organizationId: context.organizationId,
          actorUserId: context.userId,
          actorAccessRole: req.userRole || req.tenantContext.role,
          authSessionId: req.authSession && req.authSession.id,
        });
        return res.json(response);
      } catch (error) {
        if (error && Number.isInteger(error.status) && error.code) {
          return res.status(error.status).json({
            success: false,
            error: { code: error.code, message: error.message },
          });
        }
        return sendPersistenceUnavailable(res, req);
      }
    });

  router.post('/appointments/:id/mutation-previews', requireApprovalBodyBoundary,
    dependencies.onboardedAuth, requireCanonicalContext,
    dependencies.permission('calendar', 'update'), async function (req, res) {
    const context = requestContext(req);
    if (!UUID.test(req.params.id)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
    try {
      const pool = resolvePool(dependencies.poolProvider);
      const mutation = normalizeMutationPreview({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        actorAccessRole: req.userRole || req.tenantContext.role,
        authSessionId: req.authSession && req.authSession.id,
        appointmentId: req.params.id,
        body: req.body,
      });
      const preview = await createMutationPreview(pool, {
        ...mutation,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        actorAccessRole: req.userRole || req.tenantContext.role,
        authSessionId: req.authSession && req.authSession.id,
        csrfToken: req.get('X-CSRF-Token'),
      });
      return res.status(preview.status).json(preview.body);
    } catch (error) {
      if (error && error.status) {
        return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
      }
      return sendPersistenceUnavailable(res, req);
    }
  });

  router.post('/appointments/:id/mutation-approvals', requireApprovalBodyBoundary,
    dependencies.onboardedAuth, requireCanonicalContext,
    dependencies.permission('calendar', 'update'), async function (req, res) {
      const context = requestContext(req);
      if (!UUID.test(req.params.id)) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
      try {
        const mutation = normalizeMutationApproval({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          actorAccessRole: req.userRole || req.tenantContext.role,
          authSessionId: req.authSession && req.authSession.id,
          appointmentId: req.params.id,
          idempotencyKey: req.get('Idempotency-Key'),
          body: req.body,
        });
        const approved = await approveMutation(resolvePool(dependencies.poolProvider), {
          ...mutation,
          organizationId: context.organizationId,
          actorUserId: context.userId,
          actorAccessRole: req.userRole || req.tenantContext.role,
          authSessionId: req.authSession && req.authSession.id,
          csrfToken: req.get('X-CSRF-Token'),
        });
        if (approved.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(approved.status).json(approved.body);
      } catch (error) {
        if (error && error.status) {
          return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
        }
        return sendPersistenceUnavailable(res, req);
      }
    });

  router.patch('/appointments/:id', dependencies.onboardedAuth, requireCanonicalContext,
    dependencies.permission('calendar', 'update'), function (_req, res) {
      return res.status(428).json({
        success: false,
        error: {
          code: 'M22_PREVIEW_REQUIRED',
          message: 'Schedule and dispatch mutations require a current 15-minute human preview and separate approval.',
        },
      });
    });

  router.put('/integrations/:provider', dependencies.externalAuth, requireCanonicalContext, dependencies.permission('integrations', 'update'), express.json(), async function (req, res) {
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
      await requireBroadSchedulingRead(req, dependencies);
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), context, req.params.id);
      if (!item) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Canonical graph not found.' } });
      return res.json({ success: true, data: item });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
    }
  });

  router.get('/snapshots/:id', dependencies.auth, requireCanonicalContext, async function (req, res) {
    const context = requestContext(req);
    try {
      await requireBroadSchedulingRead(req, dependencies);
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), context, req.params.id);
      if (!item || item.ids.polarisSnapshot !== req.params.id) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Polaris snapshot not found.' } });
      }
      return res.json({ success: true, data: { id: item.ids.polarisSnapshot, calculationVersion: item.calculationVersion, snapshotDigest: item.snapshotDigest, snapshot: item.snapshot } });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
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
        queryFilters(req);
        await requireBroadSchedulingRead(req, dependencies);
        const items = await authoritativeItems(req, dependencies, 'compat.' + surface + '.' + req.path);
        const context = requestContext(req);
        const timeZoneAuthority = surface === 'calendar'
          ? await currentCalendarTimeZoneAuthority(resolvePool(dependencies.poolProvider), context)
          : null;
        const projection = compatibilityProjection(surface, items, context, timeZoneAuthority);
        return res.json(shape(projection, items));
      } catch (_error) {
        return handleEndpointError(res, _error, req);
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
      return res.json(await canonicalStatus(req, dependencies));
    } catch (_error) {
      return handleEndpointError(res, _error, req);
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
      await requireBroadSchedulingRead(req, dependencies);
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), requestContext(req), req.params.id);
      if (!item || item.ids.customer !== req.params.id) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found.' } });
      return res.json({ ...item.customer, canonical: surfaceProjection('customer-detail', [item]).items[0] });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
    }
  });

  async function canonicalDetail(req, res, identifierKey, notFoundMessage, shape) {
    try {
      await requireBroadSchedulingRead(req, dependencies);
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), requestContext(req), req.params.id);
      if (!item || item.ids[identifierKey] !== req.params.id) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: notFoundMessage } });
      }
      return res.json(shape(item));
    } catch (_error) {
      return handleEndpointError(res, _error, req);
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
      await requireBroadSchedulingRead(req, dependencies);
      const item = await getCanonicalGraph(resolvePool(dependencies.poolProvider), requestContext(req), req.params.id);
      if (!item || item.ids.opportunity !== req.params.id) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found.' } });
      return res.json({ ...item.opportunity, customer: item.customer, canonical: surfaceProjection('leads', [item]).items[0] });
    } catch (_error) {
      return handleEndpointError(res, _error, req);
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
  currentCalendarTimeZoneAuthority,
  getCanonicalGraph,
  listCanonicalGraphPage,
  listCanonicalGraphs,
  pipelineStageProjection,
  projectRow,
  recommendationProjection,
  requestContext,
  serviceAnalyticsProjection,
  surfaceProjection,
  trendProjection,
  validateGraphCursor,
};
