'use strict';

const { normalizeInitialDraft, normalizeUuid } = require('./contract');
const { generateInitialKnowledgeDrafts } = require('./generator');
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
              version.parent_version_id, version.created_by_user_id AS version_created_by,
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
  generateInitialKnowledgeFromAuthorities,
  getKnowledgeWorkflowState,
  getKnowledgeVersion,
  publishKnowledgeVersion,
  requestKnowledgeChanges,
  submitKnowledgeVersionForReview,
};
