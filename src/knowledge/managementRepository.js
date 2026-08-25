'use strict';

const crypto = require('crypto');
const credentials = require('../auth/credentials');
const {
  ENTRY_TYPES,
  SENSITIVITIES,
  SOURCE_TYPES,
  canonicalStringify,
  normalizeUuid,
} = require('./contract');
const { APPROVAL_ACTIONS, buildKnowledgeDiff } = require('./workflow');

const WORKFLOW_STATES = Object.freeze(['draft', 'review', 'approved', 'published']);
const SYNC_PRESENTATION = Object.freeze({
  blocked: 'reconciliation_needed',
  dead: 'dead',
  drift: 'drifted',
  in_sync: 'current',
  pending: 'pending',
  retry: 'retrying',
  stale: 'stale',
  suspended: 'suspended',
});
const MAX_ITEMS = 200;
const DEFAULT_PAGE_SIZE = MAX_ITEMS;
const CURSOR_VERSION = 1;
const CURSOR_ORDER = 'label-c-key-c-entry-id-v1';
const CURSOR_DOMAIN = 'knowledge_management_list_cursor_v1';
const CURSOR_TTL_MS = 15 * 60 * 1000;
const MAX_CURSOR_BYTES = 4096;
const MAX_CURSOR_PAYLOAD_BYTES = 3072;
const MAX_SNAPSHOT_BYTES = 2048;
const MAX_RELATIONSHIP_NODES = 4096;
const MAX_RELATIONSHIP_DEPTH = 32;
const SAFE_FILTER = /^[a-z][a-z0-9_:-]{0,63}$/;
const SAFE_CURSOR = /^[A-Za-z0-9_-]{1,4096}\.[0-9a-f]{64}$/;
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
const SAFE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig;
const DIGEST_TOKEN = /[0-9a-f]{64}/ig;
const SAFE_SNAPSHOT = /^\d+:\d+:(?:\d+(?:,\d+)*)?$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

class KnowledgeManagementError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'KnowledgeManagementError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status, details) {
  throw new KnowledgeManagementError(code, message, status, details);
}

function normalizeOptionalFilter(value, allowed, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SAFE_FILTER.test(normalized) || (allowed && !allowed.includes(normalized))) {
    fail('knowledge_management_invalid_filter', `${field} filter is not supported`);
  }
  return normalized;
}

function normalizeSearch(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' ? value.normalize('NFC').trim().toLowerCase() : '';
  if (!normalized || normalized.length > 128 || Buffer.byteLength(normalized, 'utf8') > 512 ||
      CONTROL_OR_FORMAT.test(normalized)) {
    fail('knowledge_management_invalid_filter', 'search filter is not supported');
  }
  return normalized;
}

function normalizeFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('knowledge_management_invalid_filter', 'Knowledge filters must be an object');
  }
  return Object.freeze({
    search: normalizeSearch(input.search),
    category: normalizeOptionalFilter(input.category, ENTRY_TYPES, 'category'),
    workflowStatus: normalizeOptionalFilter(input.workflowStatus, WORKFLOW_STATES, 'workflowStatus'),
    sensitivity: normalizeOptionalFilter(input.sensitivity, SENSITIVITIES, 'sensitivity'),
    source: normalizeOptionalFilter(input.source, SOURCE_TYPES, 'source'),
    applicability: normalizeOptionalFilter(input.applicability, null, 'applicability'),
  });
}

function normalizePageLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_PAGE_SIZE;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ITEMS) {
    fail('knowledge_management_invalid_pagination', `limit must be an integer from 1 to ${MAX_ITEMS}`);
  }
  return limit;
}

function invalidListCursor() {
  fail('knowledge_management_invalid_pagination', 'cursor is not a valid knowledge-list cursor');
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = expected.slice().sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function decodeListCursor(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_CURSOR_BYTES || !SAFE_CURSOR.test(value)) {
    invalidListCursor();
  }
  let bytes;
  let decoded;
  try {
    const separator = value.indexOf('.');
    const encoded = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    const expected = credentials.rateLimitKey(CURSOR_DOMAIN, encoded);
    if (!credentials.safeEqual(signature, expected)) throw new Error('invalid cursor');
    bytes = Buffer.from(encoded, 'base64url');
    if (!bytes.length || bytes.length > MAX_CURSOR_PAYLOAD_BYTES || bytes.toString('base64url') !== encoded) {
      throw new Error('invalid cursor');
    }
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    invalidListCursor();
  }
  if (!exactObjectKeys(decoded, ['v', 'contextDigest', 'issuedAt', 'snapshot', 'position']) ||
      decoded.v !== CURSOR_VERSION || !SAFE_DIGEST.test(decoded.contextDigest) ||
      !Number.isSafeInteger(decoded.issuedAt) || decoded.issuedAt > now + 60000 ||
      now - decoded.issuedAt > CURSOR_TTL_MS || typeof decoded.snapshot !== 'string' ||
      Buffer.byteLength(decoded.snapshot, 'utf8') > MAX_SNAPSHOT_BYTES || !SAFE_SNAPSHOT.test(decoded.snapshot) ||
      !Array.isArray(decoded.position) || decoded.position.length !== 3 ||
      typeof decoded.position[0] !== 'string' || Buffer.byteLength(decoded.position[0], 'utf8') > 512 ||
      typeof decoded.position[1] !== 'string' || Buffer.byteLength(decoded.position[1], 'utf8') > 512) {
    invalidListCursor();
  }
  let entryId;
  try {
    entryId = normalizeUuid(decoded.position[2], 'cursor.entryId');
  } catch (_error) {
    invalidListCursor();
  }
  return Object.freeze({
    contextDigest: decoded.contextDigest,
    issuedAt: decoded.issuedAt,
    snapshot: decoded.snapshot,
    label: decoded.position[0],
    canonicalKey: decoded.position[1],
    entryId,
  });
}

function encodeListCursor(row, state) {
  const encoded = Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    contextDigest: state.contextDigest,
    issuedAt: state.issuedAt,
    snapshot: state.snapshot,
    position: [row.label, row.canonical_key, row.entry_id],
  }), 'utf8').toString('base64url');
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CURSOR_PAYLOAD_BYTES) invalidListCursor();
  return `${encoded}.${credentials.rateLimitKey(CURSOR_DOMAIN, encoded)}`;
}

function cursorContextDigest(input) {
  return crypto.createHash('sha256').update(canonicalStringify({
    contract: CURSOR_VERSION,
    order: CURSOR_ORDER,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    membershipId: input.membershipId,
    role: input.role,
    sensitivityView: input.canReadProtected ? 'protected' : 'standard',
    filters: input.filters,
    limit: input.limit,
  }), 'utf8').digest('hex');
}

function normalizePagination(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('knowledge_management_invalid_pagination', 'Knowledge pagination must be an object');
  }
  return Object.freeze({
    limit: normalizePageLimit(input.limit),
    cursor: decodeListCursor(input.cursor),
  });
}

function normalizeVersionNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail('knowledge_management_invalid_version', 'versionNumber must be a positive integer');
  }
  return number;
}

function storedJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function digest(value) {
  return value === null || value === undefined ? null : String(value).trim();
}

function exactValuePresent(value, expected) {
  if (typeof value === 'string') return value.toLowerCase() === expected;
  if (Array.isArray(value)) return value.some(item => exactValuePresent(item, expected));
  if (value && typeof value === 'object') {
    return Object.keys(value).some(key => exactValuePresent(value[key], expected));
  }
  return false;
}

function workflowState(row) {
  if (row.publication_version_id === row.version_id) return 'published';
  if (Object.values(APPROVAL_ACTIONS).includes(row.review_action)) return 'approved';
  if (row.review_action === 'review_submitted') return 'review';
  return 'draft';
}

function correctionFor(canonicalKey, sources) {
  const key = String(canonicalKey || '');
  const sourceSet = new Set(sources || []);
  let section = 'company';
  let focus = 'company-name';
  if (key.includes('availability') || key.includes('hours')) {
    section = 'hours';
    focus = 'hoursContainer';
  } else if (key.includes('service')) {
    section = 'services';
    focus = 'servicesContainer';
  } else if (key.includes('financial') || key.includes('pricing') || key.includes('cost')) {
    section = 'financial';
    focus = 'financialConfigurationHeading';
  } else if (key.includes('voice')) {
    section = 'retell';
    focus = 'voice-assistant-configuration';
  } else if (key.includes('guidance') || key.includes('policy')) {
    section = 'policies';
    focus = 'policiesContainer';
  } else if (key.includes('operational') || sourceSet.has('workforce')) {
    section = 'crew';
    focus = 'section-crew';
  } else if (sourceSet.has('asset_catalogue')) {
    section = 'vehicles';
    focus = 'assetCatalogueAuthority';
  }
  return Object.freeze({
    label: `Correct this in Business Profile: ${section.replace(/([A-Z])/g, ' $1')}`,
    section,
    focus,
    url: `/dashboard/business-profile?section=${encodeURIComponent(section)}#${encodeURIComponent(focus)}`,
  });
}

function mapListRow(row) {
  const sources = Array.isArray(row.sources) ? row.sources : [];
  const applicability = storedJson(row.applicability) || {};
  const state = workflowState(row);
  const content = storedJson(row.document) && storedJson(row.document).content;
  return {
    entryId: row.entry_id,
    canonicalKey: row.canonical_key,
    category: row.entry_type,
    version: {
      id: row.version_id,
      number: Number(row.version_number),
      digest: digest(row.canonical_digest),
      label: row.label,
      origin: row.content_origin,
      sensitivity: row.sensitivity,
      reviewRequirement: row.review_requirement,
      applicability,
      contentState: content && content.state ? content.state : 'ready',
      lifecycleAction: row.lifecycle_action || (Number(row.version_number) === 1 ? 'initial' : null),
      actorUserId: row.version_actor_user_id,
      createdAt: row.version_created_at,
    },
    workflowStatus: state,
    latestReviewEventId: row.review_event_id || null,
    publication: row.publication_id ? {
      id: row.publication_id,
      number: row.publication_number_restricted ? null : Number(row.publication_number),
      numberRestricted: Boolean(row.publication_number_restricted),
      versionId: row.publication_version_id,
      digest: digest(row.publication_digest),
      actorUserId: row.published_by_user_id,
      publishedAt: row.published_at,
    } : null,
    sources,
    sourceCorrection: correctionFor(row.canonical_key, sources),
  };
}

function increment(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}

function countsFor(items) {
  const result = {
    total: items.length,
    category: {},
    workflowStatus: {},
    sensitivity: {},
    source: {},
  };
  for (const item of items) {
    increment(result.category, item.category);
    increment(result.workflowStatus, item.workflowStatus);
    increment(result.sensitivity, item.version.sensitivity);
    for (const source of item.sources) increment(result.source, source);
  }
  return result;
}

function applyFilters(items, filters) {
  return items.filter(item => {
    if (filters.search) {
      const searchable = `${item.version.label}\n${item.canonicalKey}`.normalize('NFC').toLowerCase();
      if (!searchable.includes(filters.search)) return false;
    }
    if (filters.category && item.category !== filters.category) return false;
    if (filters.workflowStatus && item.workflowStatus !== filters.workflowStatus) return false;
    if (filters.sensitivity && item.version.sensitivity !== filters.sensitivity) return false;
    if (filters.source && !item.sources.includes(filters.source)) return false;
    if (filters.applicability && !exactValuePresent(item.version.applicability, filters.applicability)) return false;
    return true;
  });
}

function syncPresentation(status) {
  return SYNC_PRESENTATION[status] || 'reconciliation_needed';
}

function mapSyncRow(row) {
  const sourcePins = storedJson(row.source_pins) || [];
  return {
    targetId: row.target_id,
    providerKey: row.provider_key,
    consumer: row.consumer,
    audience: row.audience,
    capabilities: storedJson(row.capabilities) || [],
    targetRevision: Number(row.target_revision),
    configurationDigest: digest(row.configuration_digest),
    targetStatus: row.target_status,
    status: syncPresentation(row.sync_status),
    canonicalStatus: row.sync_status,
    diagnosticCategory: row.diagnostic_category,
    desired: row.desired_event_id ? {
      eventId: row.desired_event_id,
      sequence: Number(row.desired_sequence),
      projectionDigest: digest(row.desired_projection_digest),
      sourcePins,
      state: row.outbox_state,
      attemptCount: Number(row.attempt_count || 0),
      availableAt: row.available_at,
    } : null,
    observed: row.observed_event_id ? {
      eventId: row.observed_event_id,
      sequence: Number(row.observed_sequence),
      projectionDigest: digest(row.observed_projection_digest),
      observedAt: row.last_observed_at,
    } : null,
    lastKnownGood: row.last_known_good_event_id ? {
      eventId: row.last_known_good_event_id,
      sequence: Number(row.last_known_good_sequence),
      projectionDigest: digest(row.last_known_good_projection_digest),
    } : null,
    driftDetectedAt: row.drift_detected_at,
    updatedAt: row.sync_updated_at,
  };
}

async function withReadTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') {
    fail('knowledge_management_unavailable', 'Canonical knowledge authority is unavailable', 503);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function membership(client, organizationId, actorUserId) {
  const result = await client.query(
    `SELECT id, role
       FROM organization_memberships
      WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
    [organizationId, actorUserId]
  );
  if (result.rowCount !== 1) {
    fail('knowledge_management_authorization_required', 'Active organization membership is required', 403);
  }
  return Object.freeze({ id: result.rows[0].id, role: result.rows[0].role });
}

async function loadSyncRows(client, organizationId) {
  return (await client.query(
    `SELECT target.id AS target_id, target.provider_key, target.consumer, target.audience,
            target.capabilities, target.target_revision, target.configuration_digest,
            target.status AS target_status, state.status AS sync_status,
            state.diagnostic_category, state.desired_event_id, state.desired_sequence,
            state.desired_projection_digest, state.observed_event_id, state.observed_sequence,
            state.observed_projection_digest, state.last_known_good_event_id,
            state.last_known_good_sequence, state.last_known_good_projection_digest,
            state.drift_detected_at, state.last_observed_at, state.updated_at AS sync_updated_at,
            desired.source_pins, desired.state AS outbox_state, desired.attempt_count,
            desired.available_at
       FROM canonical_knowledge_sync_targets target
       JOIN canonical_knowledge_sync_states state
         ON state.organization_id = target.organization_id AND state.target_id = target.id
       LEFT JOIN canonical_knowledge_sync_outbox desired
         ON desired.organization_id = state.organization_id
        AND desired.target_id = state.target_id AND desired.id = state.desired_event_id
      WHERE target.organization_id = $1
      ORDER BY target.provider_key, target.consumer, target.audience, target.id`,
    [organizationId]
  )).rows.map(mapSyncRow);
}

function syncCounts(rows) {
  const counts = {};
  for (const row of rows) increment(counts, row.status);
  return counts;
}

function redactSynchronizationPins(row) {
  return {
    ...row,
    diagnosticCategory: null,
    desired: null,
    observed: null,
    lastKnownGood: null,
    driftDetectedAt: null,
    lastObservedAt: null,
    updatedAt: null,
    relationshipsRestricted: true,
  };
}

const KNOWLEDGE_LIST_BASE_SQL = `
  SELECT entry.id AS entry_id, entry.canonical_key, entry.entry_type,
          version.id AS version_id, version.version_number, version.content_origin,
          version.label, version.sensitivity, version.review_requirement,
          version.applicability, version.document, version.canonical_digest,
          version.lifecycle_action, version.created_by_user_id AS version_actor_user_id,
          version.created_at AS version_created_at,
          review.id AS review_event_id, review.action AS review_action,
          publication.id AS publication_id, publication.publication_number,
          publication.version_id AS publication_version_id,
          publication.canonical_digest AS publication_digest,
          publication.published_by_user_id, publication.published_at,
          COALESCE(publication_visibility.number_restricted, FALSE) AS publication_number_restricted,
          COALESCE(provenance.sources, ARRAY[]::text[]) AS sources,
          CASE
            WHEN publication.version_id = version.id THEN 'published'
            WHEN review.action IN ('standard_approved', 'high_risk_approved', 'attorney_gated_approved') THEN 'approved'
            WHEN review.action = 'review_submitted' THEN 'review'
            ELSE 'draft'
          END AS workflow_status
     FROM canonical_knowledge_entries entry
     JOIN LATERAL (
       SELECT * FROM canonical_knowledge_versions candidate
        WHERE candidate.organization_id = entry.organization_id
          AND candidate.entry_id = entry.id
          AND pg_visible_in_snapshot(candidate.xmin::text::xid8, $3::pg_snapshot)
        ORDER BY candidate.version_number DESC LIMIT 1
     ) version ON TRUE
     LEFT JOIN LATERAL (
       SELECT id, action FROM canonical_knowledge_review_events candidate
        WHERE candidate.organization_id = entry.organization_id
          AND candidate.entry_id = entry.id AND candidate.version_id = version.id
          AND pg_visible_in_snapshot(candidate.xmin::text::xid8, $3::pg_snapshot)
        ORDER BY candidate.event_sequence DESC LIMIT 1
     ) review ON TRUE
     LEFT JOIN LATERAL (
       SELECT candidate.*
         FROM (
           SELECT latest.* FROM canonical_knowledge_publications latest
            WHERE latest.organization_id = entry.organization_id
              AND latest.entry_id = entry.id
              AND pg_visible_in_snapshot(latest.xmin::text::xid8, $3::pg_snapshot)
            ORDER BY latest.publication_number DESC LIMIT 1
         ) candidate
         JOIN canonical_knowledge_versions published_version
           ON published_version.organization_id = candidate.organization_id
          AND published_version.entry_id = candidate.entry_id
          AND published_version.id = candidate.version_id
        WHERE ($2::boolean OR (
            published_version.sensitivity IN ('public', 'internal')
            AND published_version.review_requirement = 'standard'
          ))
     ) publication ON TRUE
     LEFT JOIN LATERAL (
       SELECT EXISTS (
         SELECT 1
           FROM canonical_knowledge_publications predecessor
           JOIN canonical_knowledge_versions predecessor_version
             ON predecessor_version.organization_id = predecessor.organization_id
            AND predecessor_version.entry_id = predecessor.entry_id
            AND predecessor_version.id = predecessor.version_id
          WHERE predecessor.organization_id = entry.organization_id
            AND predecessor.entry_id = entry.id
            AND predecessor.publication_number < publication.publication_number
            AND pg_visible_in_snapshot(predecessor.xmin::text::xid8, $3::pg_snapshot)
            AND NOT (
              predecessor_version.sensitivity IN ('public', 'internal')
              AND predecessor_version.review_requirement = 'standard'
            )
       ) AS number_restricted
     ) publication_visibility ON publication.id IS NOT NULL AND NOT $2::boolean
     LEFT JOIN LATERAL (
       SELECT array_agg(DISTINCT source.source_type ORDER BY source.source_type) AS sources
         FROM canonical_knowledge_provenance source
        WHERE source.organization_id = entry.organization_id
          AND source.version_id = version.id
          AND pg_visible_in_snapshot(source.xmin::text::xid8, $3::pg_snapshot)
     ) provenance ON TRUE
    WHERE entry.organization_id = $1
      AND pg_visible_in_snapshot(entry.xmin::text::xid8, $3::pg_snapshot)
      AND ($2::boolean OR (
        version.sensitivity IN ('public', 'internal')
        AND version.review_requirement = 'standard'
      ))`;

const KNOWLEDGE_LIST_FILTER_SQL = `
  ($4::text IS NULL OR POSITION($4::text IN lower(authorized.label)) > 0
    OR POSITION($4::text IN lower(authorized.canonical_key)) > 0)
  AND ($5::text IS NULL OR authorized.entry_type = $5)
  AND ($6::text IS NULL OR authorized.workflow_status = $6)
  AND ($7::text IS NULL OR authorized.sensitivity = $7)
  AND ($8::text IS NULL OR $8 = ANY(authorized.sources))
  AND ($9::text IS NULL OR EXISTS (
    SELECT 1
      FROM jsonb_path_query(
        COALESCE(authorized.applicability, '{}'::jsonb),
        '$.** ? (@.type() == "string")'
      ) AS applicability_tokens(value)
     WHERE lower(applicability_tokens.value #>> '{}') = $9
  ))`;

function emptyCounts() {
  return { total: 0, category: {}, workflowStatus: {}, sensitivity: {}, source: {} };
}

function countsFromRows(rows) {
  const counts = emptyCounts();
  const dimensions = {
    category: counts.category,
    workflowStatus: counts.workflowStatus,
    sensitivity: counts.sensitivity,
    source: counts.source,
  };
  for (const row of rows) {
    const value = Number(row.value);
    if (row.dimension === 'total') counts.total = value;
    else if (dimensions[row.dimension]) dimensions[row.dimension][row.bucket_key] = value;
  }
  return counts;
}

async function listKnowledgeManagement(pool, input) {
  const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
  const filters = normalizeFilters(input && input.filters);
  const pagination = normalizePagination(input && input.pagination);
  return withReadTransaction(pool, async client => {
    const activeMembership = await membership(client, organizationId, actorUserId);
    const role = activeMembership.role;
    const canReadProtected = role === 'owner' || role === 'admin';
    const contextDigest = cursorContextDigest({
      organizationId,
      actorUserId,
      membershipId: activeMembership.id,
      role,
      canReadProtected,
      filters,
      limit: pagination.limit,
    });
    if (pagination.cursor && !credentials.safeEqual(pagination.cursor.contextDigest, contextDigest)) {
      invalidListCursor();
    }
    const snapshot = pagination.cursor ? pagination.cursor.snapshot
      : String((await client.query('SELECT pg_current_snapshot()::text AS snapshot')).rows[0].snapshot);
    if (Buffer.byteLength(snapshot, 'utf8') > MAX_SNAPSHOT_BYTES || !SAFE_SNAPSHOT.test(snapshot)) {
      fail('knowledge_management_unavailable', 'Canonical knowledge authority is unavailable', 503);
    }
    const issuedAt = pagination.cursor ? pagination.cursor.issuedAt : Date.now();
    const parameters = [
      organizationId,
      canReadProtected,
      snapshot,
      filters.search,
      filters.category,
      filters.workflowStatus,
      filters.sensitivity,
      filters.source,
      filters.applicability,
    ];
    const countRows = (await client.query(
      `WITH authorized AS (${KNOWLEDGE_LIST_BASE_SQL})
       SELECT dimension, bucket_key, value
         FROM (
           SELECT 'total'::text AS dimension, 'total'::text AS bucket_key, COUNT(*)::bigint AS value
             FROM authorized
           UNION ALL
           SELECT 'category', entry_type, COUNT(*)::bigint FROM authorized GROUP BY entry_type
           UNION ALL
           SELECT 'workflowStatus', workflow_status, COUNT(*)::bigint FROM authorized GROUP BY workflow_status
           UNION ALL
           SELECT 'sensitivity', sensitivity, COUNT(*)::bigint FROM authorized GROUP BY sensitivity
           UNION ALL
           SELECT 'source', source_type, COUNT(*)::bigint
             FROM authorized CROSS JOIN LATERAL unnest(sources) AS source_type
            GROUP BY source_type
         ) dimensions
        ORDER BY dimension, bucket_key`,
      parameters.slice(0, 3)
    )).rows;
    const matchingCount = Number((await client.query(
      `WITH authorized AS (${KNOWLEDGE_LIST_BASE_SQL})
       SELECT COUNT(*)::bigint AS value FROM authorized WHERE ${KNOWLEDGE_LIST_FILTER_SQL}`,
      parameters
    )).rows[0].value);
    const cursor = pagination.cursor;
    const rows = (await client.query(
      `WITH authorized AS (${KNOWLEDGE_LIST_BASE_SQL}),
            filtered AS (
              SELECT * FROM authorized WHERE ${KNOWLEDGE_LIST_FILTER_SQL}
            )
       SELECT * FROM filtered
        WHERE ($10::text IS NULL
          OR label COLLATE "C" > $10::text COLLATE "C"
          OR (label COLLATE "C" = $10::text COLLATE "C"
            AND canonical_key COLLATE "C" > $11::text COLLATE "C")
          OR (label COLLATE "C" = $10::text COLLATE "C"
            AND canonical_key COLLATE "C" = $11::text COLLATE "C" AND entry_id > $12::uuid))
        ORDER BY label COLLATE "C", canonical_key COLLATE "C", entry_id
        LIMIT $13`,
      parameters.concat([
        cursor && cursor.label,
        cursor && cursor.canonicalKey,
        cursor && cursor.entryId,
        pagination.limit + 1,
      ])
    )).rows;
    const hasMore = rows.length > pagination.limit;
    const pageRows = hasMore ? rows.slice(0, pagination.limit) : rows;
    const items = pageRows.map(mapListRow);
    const synchronizationRows = await loadSyncRows(client, organizationId);
    const synchronization = canReadProtected
      ? synchronizationRows : synchronizationRows.map(redactSynchronizationPins);
    return {
      authority: 'canonical_knowledge_management_v1',
      role,
      permissions: {
        canMutate: role === 'owner' || role === 'admin',
        canReadProtected,
      },
      filters,
      counts: countsFromRows(countRows),
      filteredCount: matchingCount,
      items,
      pagination: {
        limit: pagination.limit,
        returned: items.length,
        hasMore,
        nextCursor: hasMore && pageRows.length ? encodeListCursor(pageRows[pageRows.length - 1], {
          contextDigest,
          issuedAt,
          snapshot,
        }) : null,
        truncated: hasMore,
      },
      synchronization: {
        counts: syncCounts(synchronization),
        targets: synchronization,
      },
    };
  });
}

function publicationReadable(row) {
  return Boolean(row && ['public', 'internal'].includes(row.version_sensitivity) &&
    row.version_review_requirement === 'standard');
}

function createRelationshipPolicy(canReadProtected, options = {}) {
  const restrictedVersionIds = new Set();
  const restrictedPublicationIds = new Set();
  const restrictedPublicationNumbers = new Set();
  const restrictedSnapshotIds = new Set();
  const restrictedIds = new Set();
  const restrictedDigests = new Set();
  const restrictedProvenanceKeys = new Set();
  if (!canReadProtected) {
    for (const row of options.restrictedVersionRows || []) {
      restrictedVersionIds.add(row.id);
      restrictedIds.add(row.id);
      if (digest(row.canonical_digest)) restrictedDigests.add(digest(row.canonical_digest));
    }
    for (const row of options.publicationRows || []) {
      if (publicationReadable(row)) continue;
      restrictedPublicationIds.add(row.id);
      restrictedPublicationNumbers.add(Number(row.publication_number));
      restrictedIds.add(row.id);
      if (digest(row.canonical_digest)) restrictedDigests.add(digest(row.canonical_digest));
    }
    for (const row of options.protectedRelationshipRows || []) {
      restrictedIds.add(row.id);
      if (row.kind === 'publication') restrictedPublicationIds.add(row.id);
      if (row.kind === 'snapshot') restrictedSnapshotIds.add(row.id);
      if (digest(row.relationship_digest)) restrictedDigests.add(digest(row.relationship_digest));
    }
    const snapshotRow = options.snapshotRow;
    if (snapshotRow && restrictedVersionIds.has(snapshotRow.base_version_id)) {
      restrictedSnapshotIds.add(snapshotRow.id);
      restrictedIds.add(snapshotRow.id);
      if (digest(snapshotRow.diff_digest)) restrictedDigests.add(digest(snapshotRow.diff_digest));
    }
  }
  for (const key of options.restrictedProvenanceKeys || []) restrictedProvenanceKeys.add(key);
  return {
    restrictedVersionIds,
    restrictedPublicationIds,
    restrictedPublicationNumbers,
    restrictedSnapshotIds,
    restrictedIds,
    restrictedDigests,
    restrictedProvenanceKeys,
  };
}

function provenanceKey(row) {
  return `${row.version_id}:${Number(row.ordinal)}`;
}

function protectedVersion(row) {
  return !row || !['public', 'internal'].includes(row.sensitivity) || row.review_requirement !== 'standard';
}

function buildRelationshipGraphPolicy(input) {
  const versionRows = input.versionRows || [];
  const provenanceRows = input.provenanceRows || [];
  const candidateRows = input.candidateRows || [];
  const overflow = Boolean(input.overflow);
  const candidatesById = new Map();
  const candidatesByDigest = new Map();
  const provenanceByVersion = new Map();
  for (const row of candidateRows) {
    const id = String(row.id).toLowerCase();
    const rowDigest = digest(row.canonical_digest);
    if (!candidatesById.has(id)) candidatesById.set(id, []);
    candidatesById.get(id).push(row);
    if (rowDigest) {
      if (!candidatesByDigest.has(rowDigest)) candidatesByDigest.set(rowDigest, []);
      candidatesByDigest.get(rowDigest).push(row);
    }
  }
  for (const row of provenanceRows) {
    if (!provenanceByVersion.has(row.version_id)) provenanceByVersion.set(row.version_id, []);
    provenanceByVersion.get(row.version_id).push(row);
  }
  const restrictedProvenanceKeys = new Set();
  const targetRestrictionMemo = new Map();
  const visitingTargets = new Set();
  let visitedRelationships = 0;

  function resolve(row, depth) {
    if (overflow || depth > MAX_RELATIONSHIP_DEPTH || visitedRelationships >= MAX_RELATIONSHIP_NODES) return true;
    visitedRelationships += 1;
    const recordId = String(row.source_record_id || '').trim().toLowerCase();
    const sourceDigest = digest(row.source_digest);
    const idMatches = candidatesById.get(recordId) || [];
    const digestMatches = candidatesByDigest.get(sourceDigest) || [];
    UUID_TOKEN.lastIndex = 0;
    DIGEST_TOKEN.lastIndex = 0;
    const pointer = String(row.json_pointer || '');
    const knowledgeLike = SAFE_UUID.test(recordId) || idMatches.length > 0 || digestMatches.length > 0 ||
      UUID_TOKEN.test(pointer) || DIGEST_TOKEN.test(pointer);
    if (!knowledgeLike) return false;
    const exact = idMatches.filter(candidate =>
      digest(candidate.canonical_digest) === sourceDigest &&
      String(Number(candidate.version_number)) === String(row.source_version || '').trim()
    );
    if (exact.length !== 1 || exact[0].organization_id !== input.organizationId) return true;
    const target = exact[0];
    if (!input.canReadProtected && protectedVersion(target)) return true;
    if (visitingTargets.has(target.id)) return true;
    if (targetRestrictionMemo.has(target.id)) return targetRestrictionMemo.get(target.id);
    visitingTargets.add(target.id);
    let restricted = false;
    for (const child of provenanceByVersion.get(target.id) || []) {
      if (resolve(child, depth + 1)) {
        restricted = true;
        break;
      }
    }
    visitingTargets.delete(target.id);
    targetRestrictionMemo.set(target.id, restricted);
    return restricted;
  }

  for (const row of provenanceRows) {
    const restricted = resolve(row, 0);
    if (!restricted) continue;
    restrictedProvenanceKeys.add(provenanceKey(row));
  }
  return {
    restrictedProvenanceKeys,
    restrictedVersionRows: versionRows.filter(protectedVersion),
  };
}

async function loadRelationshipPolicy(client, organizationId, canReadProtected, publicationRows, snapshotRow) {
  const versionRows = (await client.query(
    `SELECT organization_id, id, version_number, canonical_digest, sensitivity, review_requirement
       FROM canonical_knowledge_versions
      WHERE organization_id = $1
      ORDER BY id LIMIT $2`,
    [organizationId, MAX_RELATIONSHIP_NODES + 1]
  )).rows;
  const provenanceRows = (await client.query(
    `SELECT organization_id, version_id, ordinal, source_type, source_record_id,
            source_version, source_digest, json_pointer
       FROM canonical_knowledge_provenance
      WHERE organization_id = $1
      ORDER BY version_id, ordinal LIMIT $2`,
    [organizationId, MAX_RELATIONSHIP_NODES + 1]
  )).rows;
  const candidateIds = Array.from(new Set(provenanceRows
    .map(row => String(row.source_record_id || '').trim().toLowerCase())
    .filter(value => SAFE_UUID.test(value))));
  const candidateDigests = Array.from(new Set(provenanceRows
    .map(row => digest(row.source_digest)).filter(value => SAFE_DIGEST.test(value))));
  const candidateRows = (await client.query(
    `SELECT organization_id, id, version_number, canonical_digest, sensitivity, review_requirement
       FROM canonical_knowledge_versions
      WHERE organization_id = $1
        AND (id = ANY($2::uuid[]) OR rtrim(canonical_digest) = ANY($3::text[]))
      ORDER BY id LIMIT $4`,
    [organizationId, candidateIds, candidateDigests, MAX_RELATIONSHIP_NODES + 1]
  )).rows;
  const protectedRelationshipRows = (await client.query(
    `SELECT 'publication'::text AS kind, publication.id,
            publication.canonical_digest AS relationship_digest
       FROM canonical_knowledge_publications publication
       JOIN canonical_knowledge_versions version
         ON version.organization_id = publication.organization_id
        AND version.entry_id = publication.entry_id AND version.id = publication.version_id
      WHERE publication.organization_id = $1
        AND NOT (version.sensitivity IN ('public', 'internal') AND version.review_requirement = 'standard')
      UNION ALL
     SELECT 'snapshot', snapshot.id, snapshot.diff_digest
       FROM canonical_knowledge_review_snapshots snapshot
       JOIN canonical_knowledge_versions version
         ON version.organization_id = snapshot.organization_id
        AND version.entry_id = snapshot.entry_id
        AND version.id IN (snapshot.version_id, snapshot.base_version_id)
      WHERE snapshot.organization_id = $1
        AND NOT (version.sensitivity IN ('public', 'internal') AND version.review_requirement = 'standard')
      ORDER BY kind, id LIMIT $2`,
    [organizationId, MAX_RELATIONSHIP_NODES + 1]
  )).rows;
  const graph = buildRelationshipGraphPolicy({
    organizationId,
    canReadProtected,
    versionRows: versionRows.slice(0, MAX_RELATIONSHIP_NODES),
    provenanceRows: provenanceRows.slice(0, MAX_RELATIONSHIP_NODES),
    candidateRows: candidateRows.slice(0, MAX_RELATIONSHIP_NODES),
    overflow: versionRows.length > MAX_RELATIONSHIP_NODES || provenanceRows.length > MAX_RELATIONSHIP_NODES ||
      candidateRows.length > MAX_RELATIONSHIP_NODES || protectedRelationshipRows.length > MAX_RELATIONSHIP_NODES,
  });
  return createRelationshipPolicy(canReadProtected, {
    ...graph,
    publicationRows,
    snapshotRow,
    protectedRelationshipRows: protectedRelationshipRows.slice(0, MAX_RELATIONSHIP_NODES),
  });
}

function containsRestrictedToken(value, policy) {
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  if (policy.restrictedIds.has(normalized) || policy.restrictedDigests.has(normalized)) return true;
  UUID_TOKEN.lastIndex = 0;
  let match;
  while ((match = UUID_TOKEN.exec(normalized))) {
    if (policy.restrictedIds.has(match[0])) return true;
  }
  DIGEST_TOKEN.lastIndex = 0;
  while ((match = DIGEST_TOKEN.exec(normalized))) {
    if (policy.restrictedDigests.has(match[0])) return true;
  }
  return false;
}

function redactRelationshipValue(value, policy) {
  if (containsRestrictedToken(value, policy)) return null;
  if (Array.isArray(value)) return value.map(item => redactRelationshipValue(item, policy));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactRelationshipValue(item, policy)]));
  }
  return value;
}

function mapProvenance(row, relationshipPolicy) {
  const policy = relationshipPolicy || createRelationshipPolicy(true);
  const mapped = {
    ordinal: Number(row.ordinal),
    sourceType: row.source_type,
    sourceRecordId: row.source_record_id,
    sourceVersion: row.source_version,
    sourceDigest: digest(row.source_digest),
    jsonPointer: row.json_pointer,
  };
  const restricted = policy.restrictedProvenanceKeys.has(provenanceKey(row)) ||
    policy.restrictedIds.has(row.source_record_id) ||
    policy.restrictedDigests.has(digest(row.source_digest)) ||
    [mapped.sourceRecordId, mapped.sourceDigest, mapped.jsonPointer]
      .some(value => containsRestrictedToken(value, policy));
  if (!restricted) return redactRelationshipValue(mapped, policy);
  return {
    ...mapped,
    sourceRecordId: null,
    sourceVersion: null,
    sourceDigest: null,
    jsonPointer: null,
    restricted: true,
  };
}

function mapProvenanceRows(rows, relationshipPolicy) {
  const mapped = [];
  let restricted = false;
  for (const row of rows) {
    const item = mapProvenance(row, relationshipPolicy);
    if (item.restricted) {
      restricted = true;
      continue;
    }
    mapped.push(item);
  }
  if (restricted) {
    mapped.push({
      ordinal: null,
      sourceType: null,
      sourceRecordId: null,
      sourceVersion: null,
      sourceDigest: null,
      jsonPointer: null,
      restricted: true,
    });
  }
  return mapped;
}

function mapPublication(row, relationshipPolicy) {
  if (!row) return null;
  const policy = relationshipPolicy || createRelationshipPolicy(true);
  const previousRestricted = policy.restrictedPublicationIds.has(row.previous_publication_id);
  const numberRestricted = Array.from(policy.restrictedPublicationNumbers)
    .some(number => number < Number(row.publication_number));
  return redactRelationshipValue({
    id: row.id,
    versionId: row.version_id,
    number: numberRestricted ? null : Number(row.publication_number),
    numberRestricted,
    digest: digest(row.canonical_digest),
    reviewEventId: row.review_event_id,
    previousPublicationId: previousRestricted ? null : row.previous_publication_id,
    previousPublicationRestricted: previousRestricted,
    actorUserId: row.published_by_user_id,
    reason: row.reason,
    publishedAt: row.published_at,
  }, policy);
}

function mapReviewEvent(row, relationshipPolicy) {
  const policy = relationshipPolicy || createRelationshipPolicy(true);
  const snapshotRestricted = policy.restrictedSnapshotIds.has(row.snapshot_id);
  return redactRelationshipValue({
    id: row.id,
    snapshotId: snapshotRestricted ? null : row.snapshot_id,
    snapshotRestricted,
    sequence: Number(row.event_sequence),
    actorUserId: row.actor_user_id,
    action: row.action,
    versionDigest: digest(row.version_digest),
    reason: row.reason,
    details: redactRelationshipValue(storedJson(row.details) || {}, policy),
    createdAt: row.created_at,
  }, policy);
}

function emptyDiff() {
  const document = { operations: [], schemaVersion: 1 };
  const canonicalDiff = canonicalStringify(document);
  return {
    document,
    canonicalDiff,
    diffDigest: crypto.createHash('sha256').update(canonicalDiff, 'utf8').digest('hex'),
    unchangedFromPublished: true,
  };
}

async function getKnowledgeManagementItem(pool, input) {
  const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
  const entryId = normalizeUuid(input && input.entryId, 'entryId');
  const requestedVersion = normalizeVersionNumber(input && input.versionNumber);
  return withReadTransaction(pool, async client => {
    const activeMembership = await membership(client, organizationId, actorUserId);
    const role = activeMembership.role;
    const canMutate = role === 'owner' || role === 'admin';
    const selected = await client.query(
      `SELECT entry.id AS entry_id, entry.canonical_key, entry.entry_type,
              version.id AS version_id, version.version_number, version.schema_version,
              version.content_origin, version.label, version.sensitivity,
              version.review_requirement, version.applicability, version.document,
              version.canonical_document, version.canonical_digest,
              version.parent_version_id, version.lifecycle_action,
              version.rollback_target_version_id, version.created_by_user_id,
              version.reason, version.created_at
         FROM canonical_knowledge_entries entry
         JOIN canonical_knowledge_versions version
           ON version.organization_id = entry.organization_id AND version.entry_id = entry.id
        WHERE entry.organization_id = $1 AND entry.id = $2
          AND ($3::integer IS NULL OR version.version_number = $3)
          AND ($4::boolean OR (
            version.sensitivity IN ('public', 'internal')
            AND version.review_requirement = 'standard'
          ))
        ORDER BY version.version_number DESC LIMIT 1`,
      [organizationId, entryId, requestedVersion, canMutate]
    );
    if (selected.rowCount !== 1) {
      fail('knowledge_management_not_found', 'Knowledge item was not found', 404);
    }
    const row = selected.rows[0];
    const provenanceRows = (await client.query(
      `SELECT * FROM canonical_knowledge_provenance
        WHERE organization_id = $1 AND version_id = $2 ORDER BY ordinal`,
      [organizationId, row.version_id]
    )).rows;
    const reviewRows = (await client.query(
      `SELECT * FROM canonical_knowledge_review_events
        WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3
        ORDER BY event_sequence`,
      [organizationId, entryId, row.version_id]
    )).rows;
    const snapshotRow = (await client.query(
      `SELECT * FROM canonical_knowledge_review_snapshots
        WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3`,
      [organizationId, entryId, row.version_id]
    )).rows[0] || null;
    const evidenceRow = canMutate ? (await client.query(
      `SELECT * FROM canonical_knowledge_attorney_review_evidence
        WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3`,
      [organizationId, entryId, row.version_id]
    )).rows[0] || null : null;
    const allPublicationRows = (await client.query(
      `SELECT publication.*, version.sensitivity AS version_sensitivity,
              version.review_requirement AS version_review_requirement
         FROM canonical_knowledge_publications publication
         JOIN canonical_knowledge_versions version
           ON version.organization_id = publication.organization_id
          AND version.entry_id = publication.entry_id
          AND version.id = publication.version_id
        WHERE publication.organization_id = $1 AND publication.entry_id = $2
        ORDER BY publication.publication_number`,
      [organizationId, entryId]
    )).rows;
    const actualCurrentPublicationRow = allPublicationRows[allPublicationRows.length - 1] || null;
    const relationshipPolicy = await loadRelationshipPolicy(
      client, organizationId, canMutate, allPublicationRows, snapshotRow
    );
    const { restrictedVersionIds } = relationshipPolicy;
    const restrictedCurrentPublication = !canMutate && actualCurrentPublicationRow &&
      !publicationReadable(actualCurrentPublicationRow);
    const publicationRows = canMutate ? allPublicationRows : allPublicationRows.filter(publicationReadable);
    const currentPublicationRow = publicationRows[publicationRows.length - 1] || null;
    const selectedPublicationRow = publicationRows.find(item => item.version_id === row.version_id) || null;
    let comparison;
    if (restrictedCurrentPublication) {
      comparison = {
        document: null,
        canonicalDiff: null,
        diffDigest: null,
        baseVersionId: null,
        unchangedFromPublished: false,
        restricted: true,
        unavailableReason: 'The current publication has restricted sensitivity. Its identifier, digest, and content are not available to this role.',
      };
    } else if (snapshotRow && (
      (!actualCurrentPublicationRow && !snapshotRow.base_version_id) ||
      (actualCurrentPublicationRow && snapshotRow.base_version_id === actualCurrentPublicationRow.version_id)
    )) {
      comparison = {
        document: storedJson(snapshotRow.diff),
        canonicalDiff: snapshotRow.canonical_diff,
        diffDigest: digest(snapshotRow.diff_digest),
        baseVersionId: snapshotRow.base_version_id,
        snapshotId: snapshotRow.id,
        unchangedFromPublished: false,
      };
    } else if (currentPublicationRow && currentPublicationRow.version_id === row.version_id) {
      comparison = emptyDiff();
      comparison.baseVersionId = row.version_id;
    } else {
      let baseDocument = null;
      if (currentPublicationRow) {
        const base = await client.query(
          `SELECT document FROM canonical_knowledge_versions
            WHERE organization_id = $1 AND entry_id = $2 AND id = $3`,
          [organizationId, entryId, currentPublicationRow.version_id]
        );
        if (base.rowCount !== 1) {
          fail('knowledge_management_integrity_failure', 'Published comparison base is unavailable', 503);
        }
        baseDocument = storedJson(base.rows[0].document);
      }
      const selectedDocument = storedJson(row.document);
      if (currentPublicationRow && canonicalStringify(baseDocument) === canonicalStringify(selectedDocument)) {
        comparison = emptyDiff();
        comparison.baseVersionId = currentPublicationRow.version_id;
      } else {
        comparison = { ...buildKnowledgeDiff(baseDocument, selectedDocument),
          baseVersionId: currentPublicationRow && currentPublicationRow.version_id,
          unchangedFromPublished: false };
      }
    }
    const historyRows = canMutate ? (await client.query(
      `SELECT version.id, version.version_number, version.canonical_digest,
              version.parent_version_id, version.lifecycle_action,
              version.rollback_target_version_id, version.content_origin,
              version.sensitivity, version.review_requirement, version.created_by_user_id,
              version.reason, version.created_at,
              publication.id AS publication_id, publication.publication_number,
              audit.id AS audit_id, audit.action AS audit_action,
              audit.actor_user_id AS audit_actor_user_id, audit.reason AS audit_reason,
              audit.created_at AS audit_created_at
         FROM canonical_knowledge_versions version
         LEFT JOIN canonical_knowledge_publications publication
           ON publication.organization_id = version.organization_id
          AND publication.entry_id = version.entry_id AND publication.version_id = version.id
         LEFT JOIN LATERAL (
           SELECT event.id, event.action, event.actor_user_id, event.reason, event.created_at
             FROM canonical_knowledge_audit_events event
            WHERE event.organization_id = version.organization_id
              AND event.entry_id = version.entry_id AND event.version_id = version.id
              AND event.action IN ('entry_draft_created', 'version_revised',
                'version_tombstoned', 'version_rollback_created')
            ORDER BY event.created_at DESC, event.id DESC LIMIT 1
         ) audit ON TRUE
        WHERE version.organization_id = $1 AND version.entry_id = $2
        ORDER BY version.version_number`,
      [organizationId, entryId]
    )).rows : [];
    const sources = provenanceRows.map(item => item.source_type);
    let synchronization = (await loadSyncRows(client, organizationId)).filter(target =>
      target.desired && target.desired.sourcePins.some(pin => pin && pin.entryId === entryId)
    );
    if (!canMutate) synchronization = synchronization.map(redactSynchronizationPins);
    const latestReview = reviewRows[reviewRows.length - 1] || null;
    const currentDocument = storedJson(row.document);
    return {
      authority: 'canonical_knowledge_management_v1',
      role,
      permissions: {
        canMutate,
        canReviseDirectly: canMutate && ['human', 'imported'].includes(row.content_origin),
        canReadHistory: canMutate,
      },
      entry: {
        id: entryId,
        canonicalKey: row.canonical_key,
        category: row.entry_type,
      },
      version: {
        id: row.version_id,
        number: Number(row.version_number),
        schemaVersion: Number(row.schema_version),
        origin: row.content_origin,
        label: row.label,
        sensitivity: row.sensitivity,
        reviewRequirement: row.review_requirement,
        applicability: storedJson(row.applicability),
        document: currentDocument,
        canonicalDocument: row.canonical_document,
        canonicalDigest: digest(row.canonical_digest),
        parentVersionId: restrictedVersionIds.has(row.parent_version_id) ? null : row.parent_version_id,
        parentVersionRestricted: restrictedVersionIds.has(row.parent_version_id),
        lifecycleAction: row.lifecycle_action || (Number(row.version_number) === 1 ? 'initial' : null),
        rollbackTargetVersionId: restrictedVersionIds.has(row.rollback_target_version_id) ? null : row.rollback_target_version_id,
        rollbackTargetVersionRestricted: restrictedVersionIds.has(row.rollback_target_version_id),
        actorUserId: row.created_by_user_id,
        reason: row.reason,
        createdAt: row.created_at,
        provenance: mapProvenanceRows(provenanceRows, relationshipPolicy),
      },
      workflow: {
        status: selectedPublicationRow ? 'published'
          : latestReview && Object.values(APPROVAL_ACTIONS).includes(latestReview.action) ? 'approved'
            : latestReview && latestReview.action === 'review_submitted' ? 'review' : 'draft',
        latestReviewEventId: latestReview && latestReview.id,
        events: reviewRows.map(item => mapReviewEvent(item, relationshipPolicy)),
        snapshot: snapshotRow ? {
          id: relationshipPolicy.restrictedSnapshotIds.has(snapshotRow.id) ? null : snapshotRow.id,
          idRestricted: relationshipPolicy.restrictedSnapshotIds.has(snapshotRow.id),
          baseVersionId: restrictedVersionIds.has(snapshotRow.base_version_id) ? null : snapshotRow.base_version_id,
          baseVersionRestricted: restrictedVersionIds.has(snapshotRow.base_version_id),
          versionDigest: digest(snapshotRow.version_digest),
          diffDigest: relationshipPolicy.restrictedDigests.has(digest(snapshotRow.diff_digest))
            ? null : digest(snapshotRow.diff_digest),
          diffRestricted: relationshipPolicy.restrictedDigests.has(digest(snapshotRow.diff_digest)),
          actorUserId: snapshotRow.submitted_by_user_id,
          reason: snapshotRow.reason,
          createdAt: snapshotRow.created_at,
        } : null,
        attorneyReviewEvidence: evidenceRow ? {
          id: evidenceRow.id,
          reference: evidenceRow.review_reference,
          digest: digest(evidenceRow.evidence_digest),
          reviewedAt: evidenceRow.reviewed_at,
          recordedAt: evidenceRow.recorded_at,
          actorUserId: evidenceRow.recorded_by_user_id,
        } : null,
        approvalEvidenceStatus: row.review_requirement === 'attorney_gated'
          ? evidenceRow ? 'recorded_external_evidence' : 'external_evidence_required'
          : latestReview && Object.values(APPROVAL_ACTIONS).includes(latestReview.action)
            ? 'approved' : 'not_approved',
      },
      comparison: redactRelationshipValue(comparison, relationshipPolicy),
      publication: {
        selected: mapPublication(selectedPublicationRow, relationshipPolicy),
        current: restrictedCurrentPublication ? null : mapPublication(currentPublicationRow, relationshipPolicy),
        currentRestricted: Boolean(restrictedCurrentPublication),
        history: publicationRows.map(item => mapPublication(item, relationshipPolicy)),
      },
      history: canMutate ? historyRows.map(item => ({
        versionId: item.id,
        versionNumber: Number(item.version_number),
        canonicalDigest: digest(item.canonical_digest),
        parentVersionId: item.parent_version_id,
        lifecycleAction: item.lifecycle_action || (Number(item.version_number) === 1 ? 'initial' : null),
        rollbackTargetVersionId: item.rollback_target_version_id,
        origin: item.content_origin,
        sensitivity: item.sensitivity,
        reviewRequirement: item.review_requirement,
        actorUserId: item.created_by_user_id,
        reason: item.reason,
        createdAt: item.created_at,
        publicationId: item.publication_id,
        publicationNumber: item.publication_number === null ? null : Number(item.publication_number),
        audit: item.audit_id ? {
          id: item.audit_id,
          action: item.audit_action,
          actorUserId: item.audit_actor_user_id,
          reason: item.audit_reason,
          createdAt: item.audit_created_at,
        } : null,
      })) : null,
      synchronization,
      sourceCorrection: correctionFor(row.canonical_key, sources),
    };
  });
}

module.exports = {
  KnowledgeManagementError,
  SYNC_PRESENTATION,
  WORKFLOW_STATES,
  applyFilters,
  buildRelationshipGraphPolicy,
  correctionFor,
  cursorContextDigest,
  decodeListCursor,
  encodeListCursor,
  getKnowledgeManagementItem,
  listKnowledgeManagement,
  normalizeFilters,
  normalizePagination,
  syncPresentation,
  workflowState,
};
