'use strict';

const { normalizeInitialDraft, normalizeUuid } = require('./contract');
const { generateInitialKnowledgeDrafts } = require('./generator');
const {
  CAPABILITY_KEYS,
  buildKnowledgeProjection,
  normalizeProjectionRequest,
} = require('./projection');
const {
  buildTombstoneDocument,
  normalizeRevisionInput,
  normalizeRollbackInput,
  normalizeTombstoneInput,
} = require('./lifecycle');
const {
  approvalActionForRequirement,
  buildKnowledgeDiff,
  normalizeAttorneyReviewEvidence,
  normalizePublicationTarget,
  normalizeWorkflowTarget,
} = require('./workflow');

class KnowledgeRepositoryError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'KnowledgeRepositoryError';
    this.code = code;
    this.status = status;
  }
}

function authorizationError() {
  return new KnowledgeRepositoryError(
    'knowledge_authorization_required',
    'An active authorized organization membership is required',
    403
  );
}

async function requireMembership(client, organizationId, actorUserId, allowedRoles) {
  const result = await client.query(
    `SELECT role
       FROM organization_memberships
      WHERE organization_id = $1
        AND user_id = $2
        AND status = 'active'
      FOR SHARE`,
    [organizationId, actorUserId]
  );
  if (result.rowCount !== 1 || (allowedRoles && !allowedRoles.includes(result.rows[0].role))) {
    throw authorizationError();
  }
  return result.rows[0].role;
}

async function withTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('Knowledge repository requires a PostgreSQL pool');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // Preserve the original database or contract failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function withReadTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('Knowledge repository requires a PostgreSQL pool');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // Preserve the original database or contract failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function requireMembershipSnapshot(client, organizationId, actorUserId, allowedRoles) {
  const result = await client.query(
    `SELECT role
       FROM organization_memberships
      WHERE organization_id = $1
        AND user_id = $2
        AND status = 'active'`,
    [organizationId, actorUserId]
  );
  if (result.rowCount !== 1 || (allowedRoles && !allowedRoles.includes(result.rows[0].role))) {
    throw authorizationError();
  }
  return result.rows[0].role;
}

function mapVersion(entry, version, provenance) {
  return {
    id: entry.id,
    organizationId: entry.organization_id,
    canonicalKey: entry.canonical_key,
    entryType: entry.entry_type,
    createdByUserId: entry.created_by_user_id,
    createdAt: entry.created_at,
    version: {
      id: version.id,
      number: version.version_number,
      schemaVersion: version.schema_version,
      origin: version.content_origin,
      label: version.label,
      sensitivity: version.sensitivity,
      reviewRequirement: version.review_requirement,
      applicability: version.applicability,
      document: JSON.parse(version.canonical_document),
      canonicalDocument: version.canonical_document,
      canonicalDigest: String(version.canonical_digest).trim(),
      parentVersionId: version.parent_version_id,
      lifecycleAction: version.lifecycle_action ||
        (Number(version.version_number) === 1 ? 'initial' : null),
      rollbackTargetVersionId: version.rollback_target_version_id || null,
      createdByUserId: version.created_by_user_id,
      reason: version.reason,
      createdAt: version.created_at,
      provenance: provenance.map(row => ({
        ordinal: row.ordinal,
        sourceType: row.source_type,
        sourceRecordId: row.source_record_id,
        sourceVersion: row.source_version,
        sourceDigest: String(row.source_digest).trim(),
        jsonPointer: row.json_pointer,
      })),
    },
  };
}

async function insertInitialDraft(client, draft) {
  const entryResult = await client.query(
    `INSERT INTO canonical_knowledge_entries
       (organization_id, canonical_key, entry_type, created_by_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [draft.organizationId, draft.canonicalKey, draft.entryType, draft.actorUserId]
  );
  const entry = entryResult.rows[0];
  const versionResult = await client.query(
    `INSERT INTO canonical_knowledge_versions
       (organization_id, entry_id, version_number, schema_version, canonical_key,
        entry_type, content_origin, label, sensitivity, review_requirement,
        applicability, document, canonical_document, canonical_digest,
        parent_version_id, created_by_user_id, reason)
     VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8,
             $9::jsonb, $10::jsonb, $11, $12, NULL, $13, $14)
     RETURNING *`,
    [
      draft.organizationId, entry.id, draft.canonicalKey, draft.entryType,
      draft.origin, draft.label, draft.sensitivity, draft.reviewRequirement,
      JSON.stringify(draft.applicability), draft.canonicalDocument,
      draft.canonicalDocument, draft.canonicalDigest, draft.actorUserId, draft.reason,
    ]
  );
  const version = versionResult.rows[0];
  const provenance = [];
  for (const link of draft.provenance) {
    const stored = await client.query(
      `INSERT INTO canonical_knowledge_provenance
         (organization_id, version_id, ordinal, source_type, source_record_id,
          source_version, source_digest, json_pointer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        draft.organizationId, version.id, link.ordinal, link.sourceType,
        link.sourceRecordId, link.sourceVersion, link.sourceDigest, link.jsonPointer,
      ]
    );
    provenance.push(stored.rows[0]);
  }
  await client.query(
    `INSERT INTO canonical_knowledge_audit_events
     (organization_id, entry_id, version_id, actor_user_id, action, reason, details)
     VALUES ($1, $2, $3, $4, 'entry_draft_created', $5,
             jsonb_build_object('canonicalDigest', $6::text, 'versionNumber', 1))`,
    [
      draft.organizationId, entry.id, version.id, draft.actorUserId,
      draft.reason, draft.canonicalDigest,
    ]
  );
  return mapVersion(entry, version, provenance);
}

function mapWriteError(error) {
  if (error && error.code === '23505' && error.constraint === 'canonical_knowledge_entries_key_unique') {
    return new KnowledgeRepositoryError(
      'knowledge_key_conflict', 'A knowledge entry already uses this canonical key', 409
    );
  }
  if (error && error.code === '40001') {
    return new KnowledgeRepositoryError(
      'knowledge_generation_conflict',
      'Authoritative inputs changed during knowledge generation; retry from a fresh snapshot',
      409
    );
  }
  return error;
}

function lifecycleError(code, message, status = 409) {
  return new KnowledgeRepositoryError(code, message, status);
}

function lifecycleSource(version, ordinal) {
  return {
    ordinal,
    sourceType: 'system_generation',
    sourceRecordId: version.id,
    sourceVersion: String(version.version_number),
    sourceDigest: normalizeStoredDigest(version.canonical_digest),
    jsonPointer: '',
  };
}

function provenanceIdentity(link) {
  return [
    link.sourceType, link.sourceRecordId, link.sourceVersion,
    link.sourceDigest, link.jsonPointer,
  ].join('\u0000');
}

function combineLifecycleProvenance(parent, supplied) {
  const parentLink = lifecycleSource(parent, 1);
  const links = [parentLink, ...supplied.map((link, index) => ({ ...link, ordinal: index + 2 }))];
  const identities = new Set();
  for (const link of links) {
    const identity = provenanceIdentity(link);
    if (identities.has(identity)) {
      throw lifecycleError(
        'knowledge_lifecycle_duplicate_provenance',
        'Lifecycle provenance duplicates its exact parent evidence',
        400
      );
    }
    identities.add(identity);
  }
  return links;
}

async function lockLifecycleTarget(client, target) {
  await requireMembership(client, target.organizationId, target.actorUserId, ['owner', 'admin']);
  const entryResult = await client.query(
    `SELECT *
       FROM canonical_knowledge_entries
      WHERE organization_id = $1 AND id = $2
      FOR UPDATE`,
    [target.organizationId, target.entryId]
  );
  if (entryResult.rowCount !== 1) {
    throw lifecycleError('knowledge_not_found', 'Knowledge entry was not found', 404);
  }
  const versionResult = await client.query(
    `SELECT *
       FROM canonical_knowledge_versions
      WHERE organization_id = $1 AND entry_id = $2
      ORDER BY version_number DESC
      LIMIT 1
      FOR SHARE`,
    [target.organizationId, target.entryId]
  );
  if (versionResult.rowCount !== 1) {
    throw lifecycleError('knowledge_not_found', 'Knowledge version was not found', 404);
  }
  const version = versionResult.rows[0];
  if (version.id !== target.expectedVersionId ||
      Number(version.version_number) !== target.expectedVersionNumber ||
      normalizeStoredDigest(version.canonical_digest) !== target.expectedCanonicalDigest) {
    throw lifecycleError(
      'knowledge_version_conflict',
      'The knowledge version changed; reload the exact latest version before continuing'
    );
  }
  return { entry: entryResult.rows[0], version };
}

async function insertLifecycleVersion(client, input) {
  const nextNumber = Number(input.parent.version_number) + 1;
  const result = await client.query(
    `INSERT INTO canonical_knowledge_versions
       (organization_id, entry_id, version_number, schema_version, canonical_key,
        entry_type, content_origin, label, sensitivity, review_requirement,
        applicability, document, canonical_document, canonical_digest,
        parent_version_id, lifecycle_action, rollback_target_version_id,
        created_by_user_id, reason)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9,
             $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      input.organizationId, input.entry.id, nextNumber,
      input.entry.canonical_key, input.entry.entry_type, input.origin, input.label,
      input.sensitivity, input.reviewRequirement, JSON.stringify(input.applicability),
      input.canonicalDocument, input.canonicalDocument, input.canonicalDigest,
      input.parent.id, input.lifecycleAction, input.rollbackTargetVersionId,
      input.actorUserId, input.reason,
    ]
  );
  const version = result.rows[0];
  const provenance = [];
  for (const link of input.provenance) {
    const stored = await client.query(
      `INSERT INTO canonical_knowledge_provenance
         (organization_id, version_id, ordinal, source_type, source_record_id,
          source_version, source_digest, json_pointer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.organizationId, version.id, link.ordinal, link.sourceType,
        link.sourceRecordId, link.sourceVersion, link.sourceDigest, link.jsonPointer,
      ]
    );
    provenance.push(stored.rows[0]);
  }
  const action = {
    revision: 'version_revised',
    tombstone: 'version_tombstoned',
    rollback: 'version_rollback_created',
  }[input.lifecycleAction];
  const details = {
    canonicalDigest: input.canonicalDigest,
    parentVersionId: input.parent.id,
    versionNumber: nextNumber,
  };
  if (input.lifecycleAction === 'tombstone') details.tombstone = true;
  if (input.rollbackTargetVersionId) {
    details.rollbackTargetVersionId = input.rollbackTargetVersionId;
  }
  await client.query(
    `INSERT INTO canonical_knowledge_audit_events
       (organization_id, entry_id, version_id, actor_user_id, action, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.organizationId, input.entry.id, version.id, input.actorUserId,
      action, input.reason, JSON.stringify(details),
    ]
  );
  return mapVersion(input.entry, version, provenance);
}

function mapLifecycleWriteError(error) {
  if (error instanceof KnowledgeRepositoryError) return error;
  if (error && error.code === '42501') return authorizationError();
  if (error && (error.code === '40001' ||
      (error.code === '23505' &&
       error.constraint === 'canonical_knowledge_versions_number_unique') ||
      (error.code === '23514' && [
        'canonical_knowledge_version_latest_parent',
        'canonical_knowledge_version_parent_sequence',
      ].includes(error.constraint)))) {
    return lifecycleError(
      'knowledge_version_conflict',
      'The knowledge version changed concurrently; reload it before continuing'
    );
  }
  return error;
}

async function createKnowledgeRevision(pool, input) {
  const target = normalizeRevisionInput(input);
  try {
    return await withTransaction(pool, async client => {
      const { entry, version: parent } = await lockLifecycleTarget(client, target);
      if (target.draft.canonicalKey !== entry.canonical_key ||
          target.draft.entryType !== entry.entry_type) {
        throw lifecycleError(
          'knowledge_lifecycle_identity_mismatch',
          'Revision identity must match the existing knowledge entry',
          400
        );
      }
      if (parent.lifecycle_action === 'tombstone') {
        throw lifecycleError(
          'knowledge_tombstone_requires_rollback',
          'A tombstoned entry must be restored through an exact rollback'
        );
      }
      if (target.draft.content.state === 'tombstoned') {
        throw lifecycleError(
          'knowledge_revision_invalid_state',
          'Use the tombstone lifecycle operation for tombstoned content',
          400
        );
      }
      if (target.draft.canonicalDigest === normalizeStoredDigest(parent.canonical_digest)) {
        throw lifecycleError('knowledge_revision_no_change', 'Revision must change the canonical document');
      }
      return insertLifecycleVersion(client, {
        organizationId: target.organizationId,
        actorUserId: target.actorUserId,
        entry,
        parent,
        lifecycleAction: 'revision',
        rollbackTargetVersionId: null,
        origin: target.draft.origin,
        label: target.draft.label,
        sensitivity: target.draft.sensitivity,
        reviewRequirement: target.draft.reviewRequirement,
        applicability: target.draft.applicability,
        canonicalDocument: target.draft.canonicalDocument,
        canonicalDigest: target.draft.canonicalDigest,
        reason: target.reason,
        provenance: combineLifecycleProvenance(parent, target.draft.provenance),
      });
    });
  } catch (error) {
    throw mapLifecycleWriteError(error);
  }
}

async function createKnowledgeTombstone(pool, input) {
  const target = normalizeTombstoneInput(input);
  try {
    return await withTransaction(pool, async client => {
      const { entry, version: parent } = await lockLifecycleTarget(client, target);
      if (parent.lifecycle_action === 'tombstone') {
        throw lifecycleError('knowledge_already_tombstoned', 'The latest version is already a tombstone');
      }
      const tombstone = buildTombstoneDocument(entry, parent);
      return insertLifecycleVersion(client, {
        organizationId: target.organizationId,
        actorUserId: target.actorUserId,
        entry,
        parent,
        lifecycleAction: 'tombstone',
        rollbackTargetVersionId: null,
        origin: 'human',
        label: parent.label,
        sensitivity: parent.sensitivity,
        reviewRequirement: parent.review_requirement,
        applicability: parent.applicability,
        canonicalDocument: tombstone.canonicalDocument,
        canonicalDigest: tombstone.canonicalDigest,
        reason: target.reason,
        provenance: [lifecycleSource(parent, 1)],
      });
    });
  } catch (error) {
    throw mapLifecycleWriteError(error);
  }
}

async function createKnowledgeRollback(pool, input) {
  const target = normalizeRollbackInput(input);
  try {
    return await withTransaction(pool, async client => {
      const { entry, version: parent } = await lockLifecycleTarget(client, target);
      const rollbackResult = await client.query(
        `SELECT *
           FROM canonical_knowledge_versions
          WHERE organization_id = $1 AND entry_id = $2 AND id = $3
            AND version_number = $4 AND canonical_digest = $5
          FOR SHARE`,
        [
          target.organizationId, target.entryId, target.rollbackVersionId,
          target.rollbackVersionNumber, target.rollbackCanonicalDigest,
        ]
      );
      if (rollbackResult.rowCount !== 1) {
        throw lifecycleError(
          'knowledge_rollback_target_not_found',
          'The exact rollback target was not found',
          404
        );
      }
      const rollback = rollbackResult.rows[0];
      if (Number(rollback.version_number) >= Number(parent.version_number) ||
          rollback.lifecycle_action === 'tombstone') {
        throw lifecycleError(
          'knowledge_rollback_target_invalid',
          'Rollback requires an earlier non-tombstone version',
          400
        );
      }
      if (normalizeStoredDigest(rollback.canonical_digest) ===
          normalizeStoredDigest(parent.canonical_digest)) {
        throw lifecycleError('knowledge_rollback_no_change', 'Rollback must change the canonical document');
      }
      return insertLifecycleVersion(client, {
        organizationId: target.organizationId,
        actorUserId: target.actorUserId,
        entry,
        parent,
        lifecycleAction: 'rollback',
        rollbackTargetVersionId: rollback.id,
        origin: rollback.content_origin,
        label: rollback.label,
        sensitivity: rollback.sensitivity,
        reviewRequirement: rollback.review_requirement,
        applicability: rollback.applicability,
        canonicalDocument: rollback.canonical_document,
        canonicalDigest: normalizeStoredDigest(rollback.canonical_digest),
        reason: target.reason,
        provenance: [lifecycleSource(parent, 1), lifecycleSource(rollback, 2)],
      });
    });
  } catch (error) {
    throw mapLifecycleWriteError(error);
  }
}

async function createInitialKnowledgeDraft(pool, input) {
  const draft = normalizeInitialDraft(input);
  try {
    return await withTransaction(pool, async client => {
      await requireMembership(client, draft.organizationId, draft.actorUserId, ['owner', 'admin']);
      return insertInitialDraft(client, draft);
    });
  } catch (error) {
    throw mapWriteError(error);
  }
}

async function loadGenerationAuthorities(client, organizationId) {
  const organization = await client.query(
    'SELECT id FROM organizations WHERE id = $1 FOR SHARE',
    [organizationId]
  );
  if (organization.rowCount !== 1) {
    throw new KnowledgeRepositoryError('knowledge_organization_not_found', 'Organization was not found', 404);
  }
  const profileResult = await client.query(
    `SELECT id, organization_id, version_number, version_label, raw_profile,
            normalized_profile, normalized_profile_hash
       FROM canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE
      FOR SHARE`,
    [organizationId]
  );
  if (profileResult.rowCount !== 1) {
    throw new KnowledgeRepositoryError(
      'knowledge_business_profile_required',
      'Exactly one active canonical Business Profile is required',
      409
    );
  }
  const profile = profileResult.rows[0];
  const skills = (await client.query(
    `SELECT id, skill_key AS "skillKey", name, description, service_id AS "serviceId"
       FROM workforce_skills
      WHERE organization_id = $1
      FOR SHARE`,
    [organizationId]
  )).rows;
  const crews = (await client.query(
    `SELECT id, crew_key AS "crewKey", name, home_location_id AS "homeLocationId"
       FROM workforce_crews
      WHERE organization_id = $1
      FOR SHARE`,
    [organizationId]
  )).rows;
  const crewMembers = (await client.query(
    `SELECT crew_id AS "crewId", profile_id AS "profileId", crew_role AS "crewRole"
       FROM workforce_crew_members
      WHERE organization_id = $1
      FOR SHARE`,
    [organizationId]
  )).rows;
  const items = (await client.query(
    `SELECT id, category, name, internal_reference AS "internalReference",
            manufacturer, model, model_year AS "modelYear", configuration,
            home_location_id AS "homeLocationId", catalogue_state AS "catalogueState",
            version
       FROM tenant_assets
      WHERE organization_id = $1
      FOR SHARE`,
    [organizationId]
  )).rows.map(row => ({ ...row, version: Number(row.version) }));
  const capabilities = (await client.query(
    `SELECT asset_id AS "assetId", service_id AS "serviceId"
       FROM tenant_asset_service_capabilities
      WHERE organization_id = $1
      FOR SHARE`,
    [organizationId]
  )).rows;
  return {
    profile: {
      id: profile.id,
      organizationId: profile.organization_id,
      versionNumber: Number(profile.version_number),
      versionLabel: profile.version_label,
      profileHash: String(profile.normalized_profile_hash).trim(),
      rawProfile: profile.raw_profile,
      normalizedProfile: profile.normalized_profile,
    },
    workforce: { skills, crews, crewMembers },
    assets: { items, capabilities },
  };
}

async function generateInitialKnowledgeFromAuthorities(pool, input) {
  const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
  try {
    return await withTransaction(pool, async client => {
      await requireMembership(client, organizationId, actorUserId, ['owner', 'admin']);
      const authorities = await loadGenerationAuthorities(client, organizationId);
      const generation = generateInitialKnowledgeDrafts({
        organizationId,
        actorUserId,
        authorities,
      });
      const entries = [];
      for (const draft of generation.drafts) entries.push(await insertInitialDraft(client, draft));
      return {
        authority: generation.authority,
        entries,
      };
    });
  } catch (error) {
    throw mapWriteError(error);
  }
}

function workflowError(code, message, status = 409) {
  return new KnowledgeRepositoryError(code, message, status);
}

function normalizeStoredDigest(value) {
  return String(value || '').trim().toLowerCase();
}

function mapReviewSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    entryId: row.entry_id,
    versionId: row.version_id,
    baseVersionId: row.base_version_id,
    versionDigest: normalizeStoredDigest(row.version_digest),
    diff: JSON.parse(row.canonical_diff),
    canonicalDiff: row.canonical_diff,
    diffDigest: normalizeStoredDigest(row.diff_digest),
    submittedByUserId: row.submitted_by_user_id,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapReviewEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    entryId: row.entry_id,
    versionId: row.version_id,
    snapshotId: row.snapshot_id,
    sequence: row.event_sequence,
    actorUserId: row.actor_user_id,
    action: row.action,
    versionDigest: normalizeStoredDigest(row.version_digest),
    reason: row.reason,
    details: row.details,
    createdAt: row.created_at,
  };
}

function mapAttorneyEvidence(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    entryId: row.entry_id,
    versionId: row.version_id,
    snapshotId: row.snapshot_id,
    recordedByUserId: row.recorded_by_user_id,
    reviewReference: row.review_reference,
    evidenceDigest: normalizeStoredDigest(row.evidence_digest),
    reviewedAt: row.reviewed_at,
    recordedAt: row.recorded_at,
  };
}

function mapPublication(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    entryId: row.entry_id,
    versionId: row.version_id,
    number: row.publication_number,
    canonicalDigest: normalizeStoredDigest(row.canonical_digest),
    reviewEventId: row.review_event_id,
    previousPublicationId: row.previous_publication_id,
    publishedByUserId: row.published_by_user_id,
    reason: row.reason,
    publishedAt: row.published_at,
  };
}

async function lockWorkflowTarget(client, target) {
  await requireMembership(client, target.organizationId, target.actorUserId, ['owner', 'admin']);
  const entryResult = await client.query(
    `SELECT *
       FROM canonical_knowledge_entries
      WHERE organization_id = $1 AND id = $2
      FOR UPDATE`,
    [target.organizationId, target.entryId]
  );
  if (entryResult.rowCount !== 1) {
    throw workflowError('knowledge_not_found', 'Knowledge entry was not found', 404);
  }
  const versionResult = await client.query(
    `SELECT *
       FROM canonical_knowledge_versions
      WHERE organization_id = $1 AND entry_id = $2
      ORDER BY version_number DESC
      LIMIT 1
      FOR SHARE`,
    [target.organizationId, target.entryId]
  );
  if (versionResult.rowCount !== 1) {
    throw workflowError('knowledge_not_found', 'Knowledge version was not found', 404);
  }
  const version = versionResult.rows[0];
  if (version.id !== target.versionId || Number(version.version_number) !== target.versionNumber ||
      normalizeStoredDigest(version.canonical_digest) !== target.canonicalDigest) {
    throw workflowError(
      'knowledge_stale_version',
      'The knowledge version changed; reload the exact latest version before continuing'
    );
  }
  return { entry: entryResult.rows[0], version };
}

async function latestReviewEvent(client, organizationId, entryId, versionId) {
  const result = await client.query(
    `SELECT *
       FROM canonical_knowledge_review_events
      WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3
      ORDER BY event_sequence DESC
      LIMIT 1`,
    [organizationId, entryId, versionId]
  );
  return result.rows[0] || null;
}

async function latestPublication(client, organizationId, entryId) {
  const result = await client.query(
    `SELECT *
       FROM canonical_knowledge_publications
      WHERE organization_id = $1 AND entry_id = $2
      ORDER BY publication_number DESC
      LIMIT 1`,
    [organizationId, entryId]
  );
  return result.rows[0] || null;
}

function requireExpectedReviewEvent(actual, expected) {
  const actualId = actual ? actual.id : null;
  if (actualId !== expected) {
    throw workflowError(
      'knowledge_stale_review',
      'The knowledge review state changed; reload it before continuing'
    );
  }
}

async function loadReviewSnapshot(client, target) {
  const result = await client.query(
    `SELECT *
       FROM canonical_knowledge_review_snapshots
      WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3`,
    [target.organizationId, target.entryId, target.versionId]
  );
  if (result.rowCount !== 1) {
    throw workflowError('knowledge_review_required', 'Submit the exact version for review first');
  }
  return result.rows[0];
}

async function insertWorkflowAudit(client, target, action, versionId, details) {
  await client.query(
    `INSERT INTO canonical_knowledge_audit_events
       (organization_id, entry_id, version_id, actor_user_id, action, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      target.organizationId, target.entryId, versionId, target.actorUserId,
      action, target.reason, JSON.stringify(details),
    ]
  );
}

async function insertReviewEvent(client, target, snapshot, sequence, action, details) {
  const result = await client.query(
    `INSERT INTO canonical_knowledge_review_events
       (organization_id, entry_id, version_id, snapshot_id, event_sequence,
        actor_user_id, action, version_digest, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [
      target.organizationId, target.entryId, target.versionId, snapshot.id, sequence,
      target.actorUserId, action, target.canonicalDigest, target.reason, JSON.stringify(details),
    ]
  );
  const event = result.rows[0];
  await insertWorkflowAudit(client, target, action, target.versionId, {
    ...details,
    canonicalDigest: target.canonicalDigest,
    reviewEventId: event.id,
    snapshotId: snapshot.id,
  });
  return event;
}

function mapWorkflowWriteError(error) {
  if (error && error.code === '40001') {
    return workflowError(
      'knowledge_workflow_conflict',
      'The knowledge workflow changed concurrently; reload it before continuing'
    );
  }
  if (error && error.code === '42501') return authorizationError();
  if (error && error.code === '23505' &&
      error.constraint === 'canonical_knowledge_review_snapshots_version_unique') {
    return workflowError('knowledge_review_already_submitted', 'This exact version is already in review');
  }
  if (error && error.code === '23505' &&
      error.constraint === 'canonical_knowledge_publications_version_unique') {
    return workflowError('knowledge_already_published', 'This exact version is already published');
  }
  return error;
}

async function submitKnowledgeVersionForReview(pool, input) {
  const target = normalizeWorkflowTarget(input);
  try {
    return await withTransaction(pool, async client => {
      const { version } = await lockWorkflowTarget(client, target);
      const latestEvent = await latestReviewEvent(
        client, target.organizationId, target.entryId, target.versionId
      );
      requireExpectedReviewEvent(latestEvent, target.expectedReviewEventId);
      if (latestEvent) {
        throw workflowError('knowledge_review_already_submitted', 'This exact version is already in review');
      }
      const publication = await latestPublication(client, target.organizationId, target.entryId);
      let baseDocument = null;
      if (publication) {
        const baseResult = await client.query(
          `SELECT canonical_document
             FROM canonical_knowledge_versions
            WHERE organization_id = $1 AND entry_id = $2 AND id = $3`,
          [target.organizationId, target.entryId, publication.version_id]
        );
        if (baseResult.rowCount !== 1) {
          throw workflowError('knowledge_publication_invalid', 'Published review base is unavailable', 503);
        }
        baseDocument = JSON.parse(baseResult.rows[0].canonical_document);
      }
      const diff = buildKnowledgeDiff(baseDocument, JSON.parse(version.canonical_document));
      const snapshotResult = await client.query(
        `INSERT INTO canonical_knowledge_review_snapshots
           (organization_id, entry_id, version_id, base_version_id, version_digest,
            diff, canonical_diff, diff_digest, submitted_by_user_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         RETURNING *`,
        [
          target.organizationId, target.entryId, target.versionId,
          publication ? publication.version_id : null, target.canonicalDigest,
          diff.canonicalDiff, diff.canonicalDiff, diff.diffDigest,
          target.actorUserId, target.reason,
        ]
      );
      const snapshot = snapshotResult.rows[0];
      const event = await insertReviewEvent(client, target, snapshot, 1, 'review_submitted', {
        diffDigest: diff.diffDigest,
        reviewRequirement: version.review_requirement,
      });
      return { snapshot: mapReviewSnapshot(snapshot), event: mapReviewEvent(event) };
    });
  } catch (error) {
    throw mapWorkflowWriteError(error);
  }
}

async function requestKnowledgeChanges(pool, input) {
  const target = normalizeWorkflowTarget(input);
  try {
    return await withTransaction(pool, async client => {
      await lockWorkflowTarget(client, target);
      const latestEvent = await latestReviewEvent(
        client, target.organizationId, target.entryId, target.versionId
      );
      requireExpectedReviewEvent(latestEvent, target.expectedReviewEventId);
      if (!latestEvent || latestEvent.action !== 'review_submitted') {
        throw workflowError('knowledge_review_state_invalid', 'Only a submitted version can request changes');
      }
      const snapshot = await loadReviewSnapshot(client, target);
      const event = await insertReviewEvent(
        client, target, snapshot, Number(latestEvent.event_sequence) + 1,
        'changes_requested', { priorReviewEventId: latestEvent.id }
      );
      return { snapshot: mapReviewSnapshot(snapshot), event: mapReviewEvent(event) };
    });
  } catch (error) {
    throw mapWorkflowWriteError(error);
  }
}

async function approveKnowledgeVersion(pool, input) {
  const target = normalizeWorkflowTarget(input);
  try {
    return await withTransaction(pool, async client => {
      const { version } = await lockWorkflowTarget(client, target);
      const latestEvent = await latestReviewEvent(
        client, target.organizationId, target.entryId, target.versionId
      );
      requireExpectedReviewEvent(latestEvent, target.expectedReviewEventId);
      if (!latestEvent || latestEvent.action !== 'review_submitted') {
        throw workflowError('knowledge_review_state_invalid', 'Only a submitted version can be approved');
      }
      const document = JSON.parse(version.canonical_document);
      if (document.content && document.content.state === 'needs_review') {
        throw workflowError(
          'knowledge_unresolved_evidence',
          'Resolve missing or conflicting authority before approval'
        );
      }
      const snapshot = await loadReviewSnapshot(client, target);
      const approvalAction = approvalActionForRequirement(version.review_requirement);
      let evidence = null;
      if (version.review_requirement === 'attorney_gated') {
        const normalizedEvidence = normalizeAttorneyReviewEvidence(input && input.attorneyReview);
        const evidenceResult = await client.query(
          `INSERT INTO canonical_knowledge_attorney_review_evidence
             (organization_id, entry_id, version_id, snapshot_id, recorded_by_user_id,
              review_reference, evidence_digest, reviewed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
           RETURNING *`,
          [
            target.organizationId, target.entryId, target.versionId, snapshot.id,
            target.actorUserId, normalizedEvidence.reviewReference,
            normalizedEvidence.evidenceDigest, normalizedEvidence.reviewedAt,
          ]
        );
        evidence = evidenceResult.rows[0];
        await insertWorkflowAudit(
          client, target, 'attorney_review_evidence_recorded', target.versionId,
          {
            attorneyEvidenceId: evidence.id,
            evidenceDigest: normalizedEvidence.evidenceDigest,
            snapshotId: snapshot.id,
          }
        );
      } else if (input && input.attorneyReview !== undefined) {
        throw workflowError(
          'knowledge_attorney_review_unexpected',
          'Attorney-review evidence is accepted only for attorney-gated content',
          400
        );
      }
      const details = {
        priorReviewEventId: latestEvent.id,
        reviewRequirement: version.review_requirement,
      };
      if (evidence) details.attorneyEvidenceId = evidence.id;
      const event = await insertReviewEvent(
        client, target, snapshot, Number(latestEvent.event_sequence) + 1,
        approvalAction, details
      );
      return {
        snapshot: mapReviewSnapshot(snapshot),
        event: mapReviewEvent(event),
        attorneyReview: mapAttorneyEvidence(evidence),
      };
    });
  } catch (error) {
    throw mapWorkflowWriteError(error);
  }
}

async function publishKnowledgeVersion(pool, input) {
  const target = normalizePublicationTarget(input);
  try {
    return await withTransaction(pool, async client => {
      const { version } = await lockWorkflowTarget(client, target);
      const latestEvent = await latestReviewEvent(
        client, target.organizationId, target.entryId, target.versionId
      );
      requireExpectedReviewEvent(latestEvent, target.expectedReviewEventId);
      const expectedApproval = approvalActionForRequirement(version.review_requirement);
      if (!latestEvent || latestEvent.action !== expectedApproval) {
        throw workflowError('knowledge_approval_required', 'The exact latest version is not approved');
      }
      const publication = await latestPublication(client, target.organizationId, target.entryId);
      const actualPublicationId = publication ? publication.id : null;
      const actualPublicationNumber = publication ? Number(publication.publication_number) : 0;
      if (actualPublicationId !== target.expectedPublicationId ||
          actualPublicationNumber !== target.expectedPublicationNumber) {
        throw workflowError(
          'knowledge_stale_publication',
          'The published version changed; reload it before publishing'
        );
      }
      const result = await client.query(
        `INSERT INTO canonical_knowledge_publications
           (organization_id, entry_id, version_id, publication_number,
            canonical_digest, review_event_id, previous_publication_id,
            published_by_user_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          target.organizationId, target.entryId, target.versionId,
          actualPublicationNumber + 1, target.canonicalDigest, latestEvent.id,
          actualPublicationId, target.actorUserId, target.reason,
        ]
      );
      const stored = result.rows[0];
      await insertWorkflowAudit(client, target, 'version_published', target.versionId, {
        canonicalDigest: target.canonicalDigest,
        publicationId: stored.id,
        publicationNumber: Number(stored.publication_number),
        reviewEventId: latestEvent.id,
      });
      return mapPublication(stored);
    });
  } catch (error) {
    throw mapWorkflowWriteError(error);
  }
}

async function getKnowledgeWorkflowState(pool, input) {
  const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
  const entryId = normalizeUuid(input && input.entryId, 'entryId');
  return withTransaction(pool, async client => {
    await requireMembership(client, organizationId, actorUserId, ['owner', 'admin']);
    const entryResult = await client.query(
      `SELECT * FROM canonical_knowledge_entries
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, entryId]
    );
    if (entryResult.rowCount !== 1) {
      throw workflowError('knowledge_not_found', 'Knowledge entry was not found', 404);
    }
    const versionResult = await client.query(
      `SELECT * FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND entry_id = $2
        ORDER BY version_number DESC LIMIT 1`,
      [organizationId, entryId]
    );
    const version = versionResult.rows[0];
    if (!version) throw workflowError('knowledge_not_found', 'Knowledge version was not found', 404);
    const snapshotResult = await client.query(
      `SELECT * FROM canonical_knowledge_review_snapshots
        WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3`,
      [organizationId, entryId, version.id]
    );
    const eventsResult = await client.query(
      `SELECT * FROM canonical_knowledge_review_events
        WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3
        ORDER BY event_sequence`,
      [organizationId, entryId, version.id]
    );
    const evidenceResult = await client.query(
      `SELECT * FROM canonical_knowledge_attorney_review_evidence
        WHERE organization_id = $1 AND entry_id = $2 AND version_id = $3`,
      [organizationId, entryId, version.id]
    );
    const publicationsResult = await client.query(
      `SELECT * FROM canonical_knowledge_publications
        WHERE organization_id = $1 AND entry_id = $2
        ORDER BY publication_number`,
      [organizationId, entryId]
    );
    return {
      organizationId,
      entryId,
      version: {
        id: version.id,
        number: Number(version.version_number),
        canonicalDigest: normalizeStoredDigest(version.canonical_digest),
        parentVersionId: version.parent_version_id,
        lifecycleAction: version.lifecycle_action ||
          (Number(version.version_number) === 1 ? 'initial' : null),
        rollbackTargetVersionId: version.rollback_target_version_id || null,
        reviewRequirement: version.review_requirement,
        sensitivity: version.sensitivity,
      },
      snapshot: mapReviewSnapshot(snapshotResult.rows[0]),
      events: eventsResult.rows.map(mapReviewEvent),
      attorneyReview: mapAttorneyEvidence(evidenceResult.rows[0]),
      publications: publicationsResult.rows.map(mapPublication),
    };
  });
}

async function getKnowledgeLifecycleHistory(pool, input) {
  const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
  const entryId = normalizeUuid(input && input.entryId, 'entryId');
  return withTransaction(pool, async client => {
    await requireMembership(client, organizationId, actorUserId, ['owner', 'admin']);
    const entryResult = await client.query(
      `SELECT * FROM canonical_knowledge_entries
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, entryId]
    );
    if (entryResult.rowCount !== 1) {
      throw lifecycleError('knowledge_not_found', 'Knowledge entry was not found', 404);
    }
    const versions = (await client.query(
      `SELECT * FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND entry_id = $2
        ORDER BY version_number`,
      [organizationId, entryId]
    )).rows;
    const versionIds = versions.map(version => version.id);
    const provenance = versionIds.length === 0 ? [] : (await client.query(
      `SELECT * FROM canonical_knowledge_provenance
        WHERE organization_id = $1 AND version_id = ANY($2::uuid[])
        ORDER BY version_id, ordinal`,
      [organizationId, versionIds]
    )).rows;
    const evidenceByVersion = new Map();
    for (const row of provenance) {
      if (!evidenceByVersion.has(row.version_id)) evidenceByVersion.set(row.version_id, []);
      evidenceByVersion.get(row.version_id).push(row);
    }
    const audits = (await client.query(
      `SELECT id, version_id, actor_user_id, action, reason, details, created_at
         FROM canonical_knowledge_audit_events
        WHERE organization_id = $1 AND entry_id = $2
          AND action IN (
            'entry_draft_created', 'version_revised',
            'version_tombstoned', 'version_rollback_created'
          )
        ORDER BY created_at, id`,
      [organizationId, entryId]
    )).rows.map(row => ({
      id: row.id,
      versionId: row.version_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      reason: row.reason,
      details: row.details,
      createdAt: row.created_at,
    }));
    return {
      organizationId,
      entryId,
      canonicalKey: entryResult.rows[0].canonical_key,
      entryType: entryResult.rows[0].entry_type,
      versions: versions.map(version =>
        mapVersion(entryResult.rows[0], version, evidenceByVersion.get(version.id) || []).version
      ),
      audits,
    };
  });
}

async function previewPublishedKnowledgeProjection(pool, input) {
  const request = normalizeProjectionRequest(input);
  const requestedKeys = request.capabilities.map(capability => CAPABILITY_KEYS[capability]);
  try {
    return await withReadTransaction(pool, async client => {
      const allowedRoles = request.profile.requiresAdministrator ? ['owner', 'admin'] : null;
      const role = await requireMembershipSnapshot(
        client,
        request.organizationId,
        request.actorUserId,
        allowedRoles
      );
      const canReadProtected = role === 'owner' || role === 'admin';
      let result;
      if (request.selection === 'exact_pins') {
        result = await client.query(
          `SELECT entry.id AS entry_id,
                  entry.canonical_key,
                  entry.entry_type,
                  version.id AS version_id,
                  version.version_number,
                  version.sensitivity,
                  version.review_requirement,
                  version.canonical_document,
                  version.canonical_digest,
                  publication.id AS publication_id,
                  publication.publication_number,
                  publication.canonical_digest AS publication_digest
             FROM canonical_knowledge_publications publication
             JOIN canonical_knowledge_entries entry
               ON entry.organization_id = publication.organization_id
              AND entry.id = publication.entry_id
             JOIN canonical_knowledge_versions version
               ON version.organization_id = publication.organization_id
              AND version.entry_id = publication.entry_id
              AND version.id = publication.version_id
            WHERE publication.organization_id = $1
              AND publication.id = ANY($2::uuid[])
              AND (
                $3::boolean
                OR (
                  version.sensitivity IN ('public', 'internal')
                  AND version.review_requirement = 'standard'
                )
              )`,
          [
            request.organizationId,
            request.exactSourcePins.map(pin => pin.publicationId),
            canReadProtected,
          ]
        );
      } else {
        result = await client.query(
          `WITH latest_publications AS (
             SELECT DISTINCT ON (publication.entry_id) publication.*
               FROM canonical_knowledge_publications publication
              WHERE publication.organization_id = $1
              ORDER BY publication.entry_id, publication.publication_number DESC, publication.id
           )
           SELECT entry.id AS entry_id,
                  entry.canonical_key,
                  entry.entry_type,
                  version.id AS version_id,
                  version.version_number,
                  version.sensitivity,
                  version.review_requirement,
                  version.canonical_document,
                  version.canonical_digest,
                  publication.id AS publication_id,
                  publication.publication_number,
                  publication.canonical_digest AS publication_digest
             FROM latest_publications publication
             JOIN canonical_knowledge_entries entry
               ON entry.organization_id = publication.organization_id
              AND entry.id = publication.entry_id
             JOIN canonical_knowledge_versions version
               ON version.organization_id = publication.organization_id
              AND version.entry_id = publication.entry_id
              AND version.id = publication.version_id
            WHERE (
                entry.canonical_key = ANY($2::text[])
                OR (
                  $4::boolean
                  AND
                  jsonb_typeof(version.applicability->'projection'->'capabilities') = 'array'
                  AND (version.applicability->'projection'->'capabilities') ?| $3::text[]
                  AND (
                    version.applicability->'projection'->'consumers' IS NULL
                    OR (
                      jsonb_typeof(version.applicability->'projection'->'consumers') = 'array'
                      AND (version.applicability->'projection'->'consumers') ? $5::text
                    )
                  )
                  AND (
                    version.applicability->'projection'->'audiences' IS NULL
                    OR (
                      jsonb_typeof(version.applicability->'projection'->'audiences') = 'array'
                      AND (version.applicability->'projection'->'audiences') ? $6::text
                    )
                  )
                )
              )
              AND (
                $7::boolean
                OR (
                  version.sensitivity IN ('public', 'internal')
                  AND version.review_requirement = 'standard'
                )
              )
            ORDER BY entry.canonical_key, publication.id
            LIMIT $8`,
          [
            request.organizationId,
            requestedKeys,
            request.capabilities,
            request.audience !== 'customer',
            request.consumer,
            request.audience,
            canReadProtected,
            request.profile.maximumCandidates + 1,
          ]
        );
      }
      if (request.selection === 'latest_published' &&
          result.rowCount > request.profile.maximumCandidates) {
        throw new KnowledgeRepositoryError(
          'knowledge_projection_candidate_limit_exceeded',
          'The authorized projection candidate set exceeds its bounded limit',
          413
        );
      }
      return buildKnowledgeProjection(request, result.rows);
    });
  } catch (error) {
    if (error && error.code === '40001') {
      throw new KnowledgeRepositoryError(
        'knowledge_projection_conflict',
        'Published knowledge changed concurrently; retry from a fresh snapshot',
        409
      );
    }
    throw error;
  }
}

async function getKnowledgeVersion(pool, input) {
  const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
  const entryId = normalizeUuid(input && input.entryId, 'entryId');
  const versionNumber = input && Number(input.versionNumber);
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw new KnowledgeRepositoryError('knowledge_invalid_version', 'versionNumber must be positive', 400);
  }
  return withTransaction(pool, async client => {
    const role = await requireMembership(client, organizationId, actorUserId, null);
    const canReadProtected = role === 'owner' || role === 'admin';
    const result = await client.query(
      `SELECT entry.*, version.id AS version_id, version.version_number,
              version.schema_version, version.content_origin, version.label,
              version.sensitivity, version.review_requirement, version.applicability,
               version.canonical_document, version.canonical_digest,
               version.parent_version_id,
               to_jsonb(version)->>'lifecycle_action' AS lifecycle_action,
               to_jsonb(version)->>'rollback_target_version_id' AS rollback_target_version_id,
               version.created_by_user_id AS version_created_by,
              version.reason, version.created_at AS version_created_at
         FROM canonical_knowledge_entries entry
         JOIN canonical_knowledge_versions version
           ON version.organization_id = entry.organization_id
          AND version.entry_id = entry.id
        WHERE entry.organization_id = $1
          AND entry.id = $2
          AND version.version_number = $3
          AND (
            $4::boolean
            OR (
              version.sensitivity IN ('public', 'internal')
              AND version.review_requirement = 'standard'
            )
          )`,
      [organizationId, entryId, versionNumber, canReadProtected]
    );
    if (result.rowCount !== 1) {
      throw new KnowledgeRepositoryError('knowledge_not_found', 'Knowledge version was not found', 404);
    }
    const row = result.rows[0];
    const provenance = (await client.query(
      `SELECT * FROM canonical_knowledge_provenance
        WHERE organization_id = $1 AND version_id = $2 ORDER BY ordinal`,
      [organizationId, row.version_id]
    )).rows;
    return mapVersion(
      {
        id: row.id,
        organization_id: row.organization_id,
        canonical_key: row.canonical_key,
        entry_type: row.entry_type,
        created_by_user_id: row.created_by_user_id,
        created_at: row.created_at,
      },
      {
        id: row.version_id,
        version_number: row.version_number,
        schema_version: row.schema_version,
        content_origin: row.content_origin,
        label: row.label,
        sensitivity: row.sensitivity,
        review_requirement: row.review_requirement,
        applicability: row.applicability,
        canonical_document: row.canonical_document,
         canonical_digest: row.canonical_digest,
         parent_version_id: row.parent_version_id,
         lifecycle_action: row.lifecycle_action,
         rollback_target_version_id: row.rollback_target_version_id,
         created_by_user_id: row.version_created_by,
        reason: row.reason,
        created_at: row.version_created_at,
      },
      provenance
    );
  });
}

module.exports = {
  KnowledgeRepositoryError,
  approveKnowledgeVersion,
  createInitialKnowledgeDraft,
  createKnowledgeRevision,
  createKnowledgeRollback,
  createKnowledgeTombstone,
  generateInitialKnowledgeFromAuthorities,
  getKnowledgeLifecycleHistory,
  previewPublishedKnowledgeProjection,
  getKnowledgeWorkflowState,
  getKnowledgeVersion,
  publishKnowledgeVersion,
  requestKnowledgeChanges,
  submitKnowledgeVersionForReview,
};
