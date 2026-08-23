'use strict';

const { normalizeInitialDraft, normalizeUuid } = require('./contract');

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
      FOR KEY SHARE`,
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

async function createInitialKnowledgeDraft(pool, input) {
  const draft = normalizeInitialDraft(input);
  try {
    return await withTransaction(pool, async client => {
      await requireMembership(client, draft.organizationId, draft.actorUserId, ['owner', 'admin']);
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
    });
  } catch (error) {
    if (error && error.code === '23505' && error.constraint === 'canonical_knowledge_entries_key_unique') {
      throw new KnowledgeRepositoryError(
        'knowledge_key_conflict', 'A knowledge entry already uses this canonical key', 409
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
    await requireMembership(client, organizationId, actorUserId, null);
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
          AND version.version_number = $3`,
      [organizationId, entryId, versionNumber]
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
  createInitialKnowledgeDraft,
  getKnowledgeVersion,
};
