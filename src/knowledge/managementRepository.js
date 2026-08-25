'use strict';

const crypto = require('crypto');
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
const MAX_CURSOR_BYTES = 1024;
const SAFE_FILTER = /^[a-z][a-z0-9_:-]{0,63}$/;
const SAFE_CURSOR = /^[A-Za-z0-9_-]{1,1366}$/;

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

function normalizeFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('knowledge_management_invalid_filter', 'Knowledge filters must be an object');
  }
  return Object.freeze({
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

function decodeListCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !SAFE_CURSOR.test(value)) {
    fail('knowledge_management_invalid_pagination', 'cursor is not a valid knowledge-list cursor');
  }
  let bytes;
  let decoded;
  try {
    bytes = Buffer.from(value, 'base64url');
    if (!bytes.length || bytes.length > MAX_CURSOR_BYTES || bytes.toString('base64url') !== value) throw new Error('invalid cursor');
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    fail('knowledge_management_invalid_pagination', 'cursor is not a valid knowledge-list cursor');
  }
  if (!Array.isArray(decoded) || decoded.length !== 3 ||
      typeof decoded[0] !== 'string' || Buffer.byteLength(decoded[0], 'utf8') > 512 ||
      typeof decoded[1] !== 'string' || Buffer.byteLength(decoded[1], 'utf8') > 512) {
    fail('knowledge_management_invalid_pagination', 'cursor is not a valid knowledge-list cursor');
  }
  let entryId;
  try {
    entryId = normalizeUuid(decoded[2], 'cursor.entryId');
  } catch (_error) {
    fail('knowledge_management_invalid_pagination', 'cursor is not a valid knowledge-list cursor');
  }
  return Object.freeze({ label: decoded[0], canonicalKey: decoded[1], entryId });
}

function encodeListCursor(row) {
  return Buffer.from(JSON.stringify([row.label, row.canonical_key, row.entry_id]), 'utf8').toString('base64url');
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
    `SELECT role
       FROM organization_memberships
      WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
    [organizationId, actorUserId]
  );
  if (result.rowCount !== 1) {
    fail('knowledge_management_authorization_required', 'Active organization membership is required', 403);
  }
  return result.rows[0].role;
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
  if (!row.desired) return row;
  return {
    ...row,
    desired: {
      ...row.desired,
      sourcePins: [],
    },
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
        ORDER BY candidate.version_number DESC LIMIT 1
     ) version ON TRUE
     LEFT JOIN LATERAL (
       SELECT id, action FROM canonical_knowledge_review_events candidate
        WHERE candidate.organization_id = entry.organization_id
          AND candidate.entry_id = entry.id AND candidate.version_id = version.id
        ORDER BY candidate.event_sequence DESC LIMIT 1
     ) review ON TRUE
     LEFT JOIN LATERAL (
       SELECT candidate.*
         FROM (
           SELECT latest.* FROM canonical_knowledge_publications latest
            WHERE latest.organization_id = entry.organization_id
              AND latest.entry_id = entry.id
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
     ) provenance ON TRUE
    WHERE entry.organization_id = $1
      AND ($2::boolean OR (
        version.sensitivity IN ('public', 'internal')
        AND version.review_requirement = 'standard'
      ))`;

const KNOWLEDGE_LIST_FILTER_SQL = `
  ($3::text IS NULL OR authorized.entry_type = $3)
  AND ($4::text IS NULL OR authorized.workflow_status = $4)
  AND ($5::text IS NULL OR authorized.sensitivity = $5)
  AND ($6::text IS NULL OR $6 = ANY(authorized.sources))
  AND ($7::text IS NULL OR EXISTS (
    SELECT 1
      FROM jsonb_path_query(
        COALESCE(authorized.applicability, '{}'::jsonb),
        '$.** ? (@.type() == "string")'
      ) AS applicability_tokens(value)
     WHERE lower(applicability_tokens.value #>> '{}') = $7
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
    const role = await membership(client, organizationId, actorUserId);
    const canReadProtected = role === 'owner' || role === 'admin';
    const parameters = [
      organizationId,
      canReadProtected,
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
      parameters.slice(0, 2)
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
        WHERE ($8::text IS NULL
          OR label COLLATE "C" > $8::text COLLATE "C"
          OR (label = $8 AND canonical_key COLLATE "C" > $9::text COLLATE "C")
          OR (label = $8 AND canonical_key = $9 AND entry_id > $10::uuid))
        ORDER BY label COLLATE "C", canonical_key COLLATE "C", entry_id
        LIMIT $11`,
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
        nextCursor: hasMore && pageRows.length ? encodeListCursor(pageRows[pageRows.length - 1]) : null,
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

function createRelationshipPolicy(canReadProtected, restrictedVersionRows, publicationRows, snapshotRow) {
  const restrictedVersionIds = new Set();
  const restrictedPublicationIds = new Set();
  const restrictedPublicationNumbers = new Set();
  const restrictedSnapshotIds = new Set();
  const restrictedIds = new Set();
  const restrictedDigests = new Set();
  if (!canReadProtected) {
    for (const row of restrictedVersionRows) {
      restrictedVersionIds.add(row.id);
      restrictedIds.add(row.id);
      if (digest(row.canonical_digest)) restrictedDigests.add(digest(row.canonical_digest));
    }
    for (const row of publicationRows) {
      if (publicationReadable(row)) continue;
      restrictedPublicationIds.add(row.id);
      restrictedPublicationNumbers.add(Number(row.publication_number));
      restrictedIds.add(row.id);
      if (digest(row.canonical_digest)) restrictedDigests.add(digest(row.canonical_digest));
    }
    if (snapshotRow && restrictedVersionIds.has(snapshotRow.base_version_id)) {
      restrictedSnapshotIds.add(snapshotRow.id);
      restrictedIds.add(snapshotRow.id);
      if (digest(snapshotRow.diff_digest)) restrictedDigests.add(digest(snapshotRow.diff_digest));
    }
  }
  return {
    restrictedVersionIds,
    restrictedPublicationIds,
    restrictedPublicationNumbers,
    restrictedSnapshotIds,
    restrictedIds,
    restrictedDigests,
  };
}

function redactRelationshipValue(value, policy) {
  if (typeof value === 'string' &&
      (policy.restrictedIds.has(value) || policy.restrictedDigests.has(digest(value)))) return null;
  if (Array.isArray(value)) return value.map(item => redactRelationshipValue(item, policy));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactRelationshipValue(item, policy)]));
  }
  return value;
}

function mapProvenance(row, relationshipPolicy) {
  const policy = relationshipPolicy || createRelationshipPolicy(true, [], [], null);
  const mapped = {
    ordinal: Number(row.ordinal),
    sourceType: row.source_type,
    sourceRecordId: row.source_record_id,
    sourceVersion: row.source_version,
    sourceDigest: digest(row.source_digest),
    jsonPointer: row.json_pointer,
  };
  const restricted = policy.restrictedIds.has(row.source_record_id) ||
    policy.restrictedDigests.has(digest(row.source_digest));
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

function mapPublication(row, relationshipPolicy) {
  if (!row) return null;
  const policy = relationshipPolicy || createRelationshipPolicy(true, [], [], null);
  const previousRestricted = policy.restrictedPublicationIds.has(row.previous_publication_id);
  const numberRestricted = Array.from(policy.restrictedPublicationNumbers)
    .some(number => number < Number(row.publication_number));
  return {
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
  };
}

function mapReviewEvent(row, relationshipPolicy) {
  const policy = relationshipPolicy || createRelationshipPolicy(true, [], [], null);
  const snapshotRestricted = policy.restrictedSnapshotIds.has(row.snapshot_id);
  return {
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
  };
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
    const role = await membership(client, organizationId, actorUserId);
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
    const restrictedVersionRows = canMutate ? [] : (await client.query(
      `SELECT id, canonical_digest FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND entry_id = $2
          AND NOT (sensitivity IN ('public', 'internal') AND review_requirement = 'standard')`,
      [organizationId, entryId]
    )).rows;
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
    const relationshipPolicy = createRelationshipPolicy(
      canMutate, restrictedVersionRows, allPublicationRows, snapshotRow
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
        provenance: provenanceRows.map(item => mapProvenance(item, relationshipPolicy)),
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
      comparison,
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
  correctionFor,
  decodeListCursor,
  getKnowledgeManagementItem,
  listKnowledgeManagement,
  normalizeFilters,
  normalizePagination,
  syncPresentation,
  workflowState,
};
