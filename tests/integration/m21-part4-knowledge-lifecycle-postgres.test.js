'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const {
  buildCanonicalKnowledgeDocument,
  normalizeInitialDraft,
} = require('../../src/knowledge/contract');
const { buildKnowledgeDiff } = require('../../src/knowledge/workflow');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const AUDIT_MIGRATION = '027_canonical_knowledge_audit_graph_authority.sql';
const LIFECYCLE_MIGRATION = '028_canonical_knowledge_immutable_lifecycle.sql';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

const ORG_A = 'c7000000-0000-4000-8000-000000000001';
const OWNER_A = 'c8000000-0000-4000-8000-000000000001';
const ADMIN_A = 'c8000000-0000-4000-8000-000000000002';
const MEMBER_A = 'c8000000-0000-4000-8000-000000000003';
const SUSPENDED_OWNER_A = 'c8000000-0000-4000-8000-000000000004';
const ORG_B = 'c7000000-0000-4000-8000-000000000002';
const OWNER_B = 'c8000000-0000-4000-8000-000000000005';

function migrationFiles(directory) {
  return fs.readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function seedActor(pool, organizationId, userId, role, suffix) {
  await pool.query(
    `INSERT INTO organizations (id, name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [organizationId, `Lifecycle ${suffix}`, `lifecycle-${suffix}@example.test`]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'not-used', $5, 'active')`,
    [userId, organizationId, `Actor ${suffix}`, `actor-lifecycle-${suffix}@example.test`, role]
  );
  await pool.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $1, $3, 'active')`,
    [userId, organizationId, role]
  );
}

function initialDraft(key, overrides = {}) {
  return {
    organizationId: ORG_A,
    actorUserId: OWNER_A,
    canonicalKey: key,
    entryType: 'policy',
    label: `Lifecycle fixture ${key}`,
    sensitivity: 'internal',
    reviewRequirement: 'standard',
    origin: 'human',
    applicability: { scope: 'all' },
    content: { state: 'ready', statement: `Initial content for ${key}.` },
    reason: `Create ${key}.`,
    provenance: [{
      sourceType: 'human_input',
      sourceRecordId: OWNER_A,
      sourceVersion: '1',
      sourceDigest: digest(`source:${key}:1`),
      jsonPointer: '',
    }],
    ...overrides,
  };
}

function lifecycleTarget(created, actorUserId, reason, overrides = {}) {
  return {
    organizationId: created.organizationId,
    actorUserId,
    entryId: created.id,
    expectedVersionId: created.version.id,
    expectedVersionNumber: created.version.number,
    expectedCanonicalDigest: created.version.canonicalDigest,
    reason,
    ...overrides,
  };
}

function revisionInput(created, actorUserId, content, suffix, overrides = {}) {
  return lifecycleTarget(created, actorUserId, `Create revision ${suffix}.`, {
    canonicalKey: created.canonicalKey,
    entryType: created.entryType,
    label: created.version.label,
    sensitivity: created.version.sensitivity,
    reviewRequirement: created.version.reviewRequirement,
    origin: 'human',
    applicability: created.version.applicability,
    content,
    provenance: [{
      sourceType: 'human_input',
      sourceRecordId: `revision-${suffix}`,
      sourceVersion: '1',
      sourceDigest: digest(`revision-source:${suffix}`),
      jsonPointer: '/content',
    }],
    ...overrides,
  });
}

function workflowTarget(created, actorUserId, reason, overrides = {}) {
  return {
    organizationId: created.organizationId,
    actorUserId,
    entryId: created.id,
    versionId: created.version.id,
    versionNumber: created.version.number,
    canonicalDigest: created.version.canonicalDigest,
    expectedReviewEventId: null,
    reason,
    ...overrides,
  };
}

async function reviewApprovePublish(repository, pool, created, priorPublication = null) {
  const submitted = await repository.submitKnowledgeVersionForReview(
    pool,
    workflowTarget(created, OWNER_A, `Submit version ${created.version.number}.`)
  );
  const approved = await repository.approveKnowledgeVersion(
    pool,
    workflowTarget(created, ADMIN_A, `Approve version ${created.version.number}.`, {
      expectedReviewEventId: submitted.event.id,
    })
  );
  const publication = await repository.publishKnowledgeVersion(
    pool,
    workflowTarget(created, OWNER_A, `Publish version ${created.version.number}.`, {
      expectedReviewEventId: approved.event.id,
      expectedPublicationId: priorPublication ? priorPublication.id : null,
      expectedPublicationNumber: priorPublication ? priorPublication.number : 0,
    })
  );
  return { submitted, approved, publication };
}

async function insertDirectRevision(pool, created, actorUserId, suffix, options = {}) {
  const draft = normalizeInitialDraft(revisionInput(
    created,
    actorUserId,
    { state: 'ready', statement: `Direct revision ${suffix}.` },
    suffix
  ));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const parent = (await client.query(
      `SELECT * FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND entry_id = $2 AND id = $3`,
      [created.organizationId, created.id, created.version.id]
    )).rows[0];
    const version = (await client.query(
      `INSERT INTO canonical_knowledge_versions
         (organization_id, entry_id, version_number, schema_version, canonical_key,
          entry_type, content_origin, label, sensitivity, review_requirement,
          applicability, document, canonical_document, canonical_digest,
          parent_version_id, lifecycle_action, rollback_target_version_id,
          created_by_user_id, reason, created_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9,
               $10::jsonb, $11::jsonb, $12, $13, $14, 'revision', NULL,
               $15, $16, '2001-01-01T00:00:00Z')
       RETURNING *`,
      [
        created.organizationId, created.id,
        options.versionNumber || Number(parent.version_number) + 1,
        created.canonicalKey, created.entryType, draft.origin, draft.label,
        draft.sensitivity, draft.reviewRequirement, JSON.stringify(draft.applicability),
        draft.canonicalDocument, draft.canonicalDocument, draft.canonicalDigest,
        options.parentVersionId || parent.id, actorUserId, draft.reason,
      ]
    )).rows[0];
    if (!options.omitProvenance) {
      const changeSource = options.duplicateParentSource ? {
        sourceType: 'system_generation',
        sourceRecordId: parent.id,
        sourceVersion: String(parent.version_number),
        sourceDigest: String(parent.canonical_digest).trim(),
        jsonPointer: '',
      } : {
        sourceType: 'human_input',
        sourceRecordId: `direct-${suffix}`,
        sourceVersion: '1',
        sourceDigest: digest(`direct:${suffix}`),
        jsonPointer: '/content',
      };
      await client.query(
        `INSERT INTO canonical_knowledge_provenance
           (organization_id, version_id, ordinal, source_type, source_record_id,
            source_version, source_digest, json_pointer)
         VALUES
           ($1, $2, 1, 'system_generation', $3, $4, $5, ''),
           ($1, $2, 2, $6, $7, $8, $9, $10)`,
        [
          created.organizationId, version.id, parent.id, String(parent.version_number),
          String(parent.canonical_digest).trim(), changeSource.sourceType,
          changeSource.sourceRecordId, changeSource.sourceVersion,
          changeSource.sourceDigest, changeSource.jsonPointer,
        ]
      );
    }
    if (!options.omitAudit) {
      const details = options.auditDetails || {
        canonicalDigest: draft.canonicalDigest,
        parentVersionId: parent.id,
        versionNumber: Number(version.version_number),
      };
      await client.query(
        `INSERT INTO canonical_knowledge_audit_events
           (organization_id, entry_id, version_id, actor_user_id, action, reason, details)
         VALUES ($1, $2, $3, $4, 'version_revised', $5, $6::jsonb)`,
        [
          created.organizationId, created.id, version.id, actorUserId,
          draft.reason, JSON.stringify(details),
        ]
      );
    }
    await client.query('COMMIT');
    return { entry: created, version: {
      id: version.id,
      number: Number(version.version_number),
      canonicalDigest: String(version.canonical_digest).trim(),
      canonicalDocument: version.canonical_document,
      document: JSON.parse(version.canonical_document),
      label: version.label,
      sensitivity: version.sensitivity,
      reviewRequirement: version.review_requirement,
      applicability: version.applicability,
      lifecycleAction: version.lifecycle_action,
      parentVersionId: version.parent_version_id,
      createdAt: version.created_at,
    } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertDirectInitialTombstone(pool, key) {
  const canonical = buildCanonicalKnowledgeDocument({
    applicability: { scope: 'all' },
    canonicalKey: key,
    content: { state: 'tombstoned' },
    entryType: 'policy',
    label: `Lifecycle fixture ${key}`,
    origin: 'human',
    reviewRequirement: 'standard',
    sensitivity: 'internal',
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = (await client.query(
      `INSERT INTO canonical_knowledge_entries
         (organization_id, canonical_key, entry_type, created_by_user_id)
       VALUES ($1, $2, 'policy', $3)
       RETURNING id`,
      [ORG_A, key, OWNER_A]
    )).rows[0];
    await client.query(
      `INSERT INTO canonical_knowledge_versions
         (organization_id, entry_id, version_number, schema_version, canonical_key,
          entry_type, content_origin, label, sensitivity, review_requirement,
          applicability, document, canonical_document, canonical_digest,
          parent_version_id, lifecycle_action, rollback_target_version_id,
          created_by_user_id, reason)
       VALUES ($1, $2, 1, 1, $3, 'policy', 'human', $4, 'internal', 'standard',
               $5::jsonb, $6::jsonb, $7, $8, NULL, 'initial', NULL, $9, $10)`,
      [
        ORG_A, entry.id, key, `Lifecycle fixture ${key}`,
        JSON.stringify({ scope: 'all' }), canonical.canonicalDocument,
        canonical.canonicalDocument, canonical.canonicalDigest, OWNER_A,
        `Create ${key}.`,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

realPostgres('Mission 21 Part 4 immutable knowledge lifecycle', () => {
  let freshDatabase;
  let upgradeDatabase;
  let freshPool;
  let upgradePool;
  let throughAuditDirectory;
  let throughLifecycleDirectory;
  let db;
  let repository;
  let upgradedInitial;

  beforeAll(async () => {
    freshDatabase = await createSuiteDatabase('m21-p4-lifecycle-fresh');
    upgradeDatabase = await createSuiteDatabase('m21-p4-lifecycle-upgrade');
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 8 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 4 });
    throughAuditDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p4-through027-'));
    throughLifecycleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p4-through028-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name <= AUDIT_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(throughAuditDirectory, filename));
    }
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name <= LIFECYCLE_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(throughLifecycleDirectory, filename));
    }
    jest.resetModules();
    db = require('../../src/db');
    repository = require('../../src/knowledge/repository');

    expect(await db.runMigrations({
      pool: upgradePool, migrationsDirectory: throughAuditDirectory,
    })).toBe(true);
    await seedActor(upgradePool, ORG_A, OWNER_A, 'owner', 'upgrade-owner');
    await seedActor(upgradePool, ORG_A, ADMIN_A, 'admin', 'upgrade-admin');
    upgradedInitial = await repository.createInitialKnowledgeDraft(
      upgradePool, initialDraft('policies.upgrade-lifecycle')
    );
    expect(await db.runMigrations({
      pool: upgradePool, migrationsDirectory: throughLifecycleDirectory,
    })).toBe(true);

    expect(await db.runMigrations({
      pool: freshPool, migrationsDirectory: throughLifecycleDirectory,
    })).toBe(true);
    await seedActor(freshPool, ORG_A, OWNER_A, 'owner', 'owner-a');
    await seedActor(freshPool, ORG_A, ADMIN_A, 'admin', 'admin-a');
    await seedActor(freshPool, ORG_A, MEMBER_A, 'member', 'member-a');
    await seedActor(freshPool, ORG_A, SUSPENDED_OWNER_A, 'owner', 'suspended-owner-a');
    await freshPool.query(
      "UPDATE organization_memberships SET status = 'suspended' WHERE user_id = $1",
      [SUSPENDED_OWNER_A]
    );
    await seedActor(freshPool, ORG_B, OWNER_B, 'owner', 'owner-b');
  }, 120000);

  afterAll(async () => {
    try {
      if (freshPool) await freshPool.end();
      if (upgradePool) await upgradePool.end();
    } finally {
      for (const directory of [throughAuditDirectory, throughLifecycleDirectory]) {
        if (directory && path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
    }
  }, 120000);

  test('fresh and upgraded PostgreSQL authorities seal initial history and migration bytes once', async () => {
    const migrationBytes = fs.readFileSync(path.join(MIGRATIONS, LIFECYCLE_MIGRATION));
    const migrationDigest = crypto.createHash('sha256').update(migrationBytes).digest('hex');
    expect(migrationBytes.at(-1)).toBe(0x0a);
    expect(migrationBytes.includes(Buffer.from('\r'))).toBe(false);
    for (const pool of [freshPool, upgradePool]) {
      const columns = (await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'canonical_knowledge_versions'
            AND column_name IN ('lifecycle_action', 'rollback_target_version_id')
          ORDER BY column_name`
      )).rows.map(row => row.column_name);
      expect(columns).toEqual(['lifecycle_action', 'rollback_target_version_id']);
      expect((await pool.query(
        `SELECT count(*)::int AS count
           FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace
            AND conname LIKE 'canonical_knowledge_%'
            AND NOT convalidated`
      )).rows).toEqual([{ count: 0 }]);
      expect((await pool.query(
        `SELECT count(*)::int AS count, min(checksum) AS checksum
           FROM _migrations WHERE filename = $1`,
        [LIFECYCLE_MIGRATION]
      )).rows).toEqual([{ count: 1, checksum: migrationDigest }]);
    }
    const history = await repository.getKnowledgeLifecycleHistory(upgradePool, {
      organizationId: ORG_A,
      actorUserId: OWNER_A,
      entryId: upgradedInitial.id,
    });
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0]).toMatchObject({
      number: 1,
      lifecycleAction: 'initial',
      parentVersionId: null,
      rollbackTargetVersionId: null,
    });
    expect((await db.runMigrations({
      pool: upgradePool, migrationsDirectory: throughLifecycleDirectory,
    }))).toBe(true);
  });

  test('serializes concurrent revisions and preserves exact role, tenant, and stale-write isolation', async () => {
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.concurrent-lifecycle')
    );
    const attempts = await Promise.allSettled([
      repository.createKnowledgeRevision(freshPool, revisionInput(
        created, OWNER_A, { state: 'ready', statement: 'Concurrent revision A.' }, 'race-a'
      )),
      repository.createKnowledgeRevision(freshPool, revisionInput(
        created, ADMIN_A, { state: 'ready', statement: 'Concurrent revision B.' }, 'race-b'
      )),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected').reason).toMatchObject({
      code: 'knowledge_version_conflict', status: 409,
    });
    const winner = attempts.find(result => result.status === 'fulfilled').value;
    expect(winner.version).toMatchObject({
      number: 2,
      parentVersionId: created.version.id,
      lifecycleAction: 'revision',
      rollbackTargetVersionId: null,
    });
    expect(winner.version.provenance).toHaveLength(2);
    expect(winner.version.provenance[0]).toMatchObject({
      ordinal: 1,
      sourceType: 'system_generation',
      sourceRecordId: created.version.id,
      sourceVersion: '1',
      sourceDigest: created.version.canonicalDigest,
    });
    await expect(repository.createKnowledgeRevision(
      freshPool,
      revisionInput(created, OWNER_A, { state: 'ready', statement: 'Stale.' }, 'stale')
    )).rejects.toMatchObject({ code: 'knowledge_version_conflict', status: 409 });
    await expect(repository.createKnowledgeRevision(
      freshPool,
      revisionInput(winner, MEMBER_A, { state: 'ready', statement: 'Member.' }, 'member')
    )).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    await expect(repository.createKnowledgeRevision(
      freshPool,
      revisionInput(winner, SUSPENDED_OWNER_A, { state: 'ready', statement: 'Suspended.' }, 'suspended')
    )).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    await expect(repository.getKnowledgeLifecycleHistory(freshPool, {
      organizationId: ORG_B, actorUserId: OWNER_B, entryId: created.id,
    })).rejects.toMatchObject({ code: 'knowledge_not_found', status: 404 });
    await expect(repository.getKnowledgeLifecycleHistory(freshPool, {
      organizationId: ORG_A, actorUserId: MEMBER_A, entryId: created.id,
    })).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    const history = await repository.getKnowledgeLifecycleHistory(freshPool, {
      organizationId: ORG_A, actorUserId: OWNER_A, entryId: created.id,
    });
    expect(history.versions.map(version => version.number)).toEqual([1, 2]);
    expect(history.audits.map(event => event.action)).toEqual([
      'entry_draft_created', 'version_revised',
    ]);
    expect(history.audits[1]).toMatchObject({
      versionId: winner.version.id,
      details: {
        canonicalDigest: winner.version.canonicalDigest,
        parentVersionId: created.version.id,
        versionNumber: 2,
      },
    });
    expect(new Date(history.audits[1].createdAt).getTime())
      .toBe(new Date(winner.version.createdAt).getTime());
  });

  test('keeps a later revision draft until exact diff review and atomic publication', async () => {
    const created = await repository.createInitialKnowledgeDraft(freshPool, initialDraft(
      'policies.numeric-diff',
      { content: { 2: 'old two', 10: 'old ten', z: 'old z' } }
    ));
    const first = await reviewApprovePublish(repository, freshPool, created);
    const revised = await repository.createKnowledgeRevision(freshPool, revisionInput(
      created,
      OWNER_A,
      { 2: 'new two', 10: 'new ten', z: 'new z' },
      'numeric-diff'
    ));
    expect((await freshPool.query(
      `SELECT version_id FROM canonical_knowledge_publications
        WHERE organization_id = $1 AND entry_id = $2
        ORDER BY publication_number DESC LIMIT 1`,
      [ORG_A, created.id]
    )).rows).toEqual([{ version_id: created.version.id }]);
    const submitted = await repository.submitKnowledgeVersionForReview(
      freshPool,
      workflowTarget(revised, OWNER_A, 'Review byte-ordered diff.')
    );
    expect(submitted.snapshot.baseVersionId).toBe(created.version.id);
    expect(submitted.snapshot.diff.operations.map(operation => operation.path)).toEqual([
      '/content/10', '/content/2', '/content/z',
    ]);
    const approved = await repository.approveKnowledgeVersion(
      freshPool,
      workflowTarget(revised, ADMIN_A, 'Approve byte-ordered diff.', {
        expectedReviewEventId: submitted.event.id,
      })
    );
    const second = await repository.publishKnowledgeVersion(
      freshPool,
      workflowTarget(revised, OWNER_A, 'Publish exact revision.', {
        expectedReviewEventId: approved.event.id,
        expectedPublicationId: first.publication.id,
        expectedPublicationNumber: first.publication.number,
      })
    );
    expect(second).toMatchObject({
      number: 2,
      versionId: revised.version.id,
      previousPublicationId: first.publication.id,
    });
  });

  test('tombstones non-destructively and restores only through rollback-as-new-version', async () => {
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.tombstone-rollback')
    );
    const first = await reviewApprovePublish(repository, freshPool, created);
    const tombstone = await repository.createKnowledgeTombstone(
      freshPool,
      lifecycleTarget(created, OWNER_A, 'Retire this exact policy.')
    );
    expect(tombstone.version).toMatchObject({
      number: 2,
      lifecycleAction: 'tombstone',
      parentVersionId: created.version.id,
      rollbackTargetVersionId: null,
      document: expect.objectContaining({ content: { state: 'tombstoned' } }),
    });
    expect(tombstone.version.provenance).toHaveLength(1);
    await expect(repository.createKnowledgeTombstone(
      freshPool,
      lifecycleTarget(tombstone, OWNER_A, 'Duplicate tombstone.')
    )).rejects.toMatchObject({ code: 'knowledge_already_tombstoned' });
    await expect(repository.createKnowledgeRevision(
      freshPool,
      revisionInput(tombstone, OWNER_A, { state: 'ready', statement: 'Bypass.' }, 'bypass')
    )).rejects.toMatchObject({ code: 'knowledge_tombstone_requires_rollback' });
    const second = await reviewApprovePublish(repository, freshPool, tombstone, first.publication);
    const rollback = await repository.createKnowledgeRollback(freshPool, lifecycleTarget(
      tombstone,
      ADMIN_A,
      'Restore the exact previously published policy.',
      {
        rollbackVersionId: created.version.id,
        rollbackVersionNumber: created.version.number,
        rollbackCanonicalDigest: created.version.canonicalDigest,
      }
    ));
    expect(rollback.version).toMatchObject({
      number: 3,
      lifecycleAction: 'rollback',
      parentVersionId: tombstone.version.id,
      rollbackTargetVersionId: created.version.id,
      canonicalDigest: created.version.canonicalDigest,
      canonicalDocument: created.version.canonicalDocument,
      document: created.version.document,
    });
    expect(rollback.version.provenance.map(link => link.sourceRecordId)).toEqual([
      tombstone.version.id, created.version.id,
    ]);
    await expect(repository.createKnowledgeRollback(freshPool, lifecycleTarget(
      rollback,
      OWNER_A,
      'Reject tombstone target.',
      {
        rollbackVersionId: tombstone.version.id,
        rollbackVersionNumber: tombstone.version.number,
        rollbackCanonicalDigest: tombstone.version.canonicalDigest,
      }
    ))).rejects.toMatchObject({ code: 'knowledge_rollback_target_invalid', status: 400 });
    await expect(repository.createKnowledgeRollback(freshPool, lifecycleTarget(
      rollback,
      OWNER_A,
      'Reject no-op rollback.',
      {
        rollbackVersionId: created.version.id,
        rollbackVersionNumber: created.version.number,
        rollbackCanonicalDigest: created.version.canonicalDigest,
      }
    ))).rejects.toMatchObject({ code: 'knowledge_rollback_no_change' });
    const third = await reviewApprovePublish(repository, freshPool, rollback, second.publication);
    expect(third.publication).toMatchObject({
      number: 3,
      versionId: rollback.version.id,
      previousPublicationId: second.publication.id,
    });
    expect((await freshPool.query(
      `SELECT version_number, lifecycle_action, rollback_target_version_id
         FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND entry_id = $2
        ORDER BY version_number`,
      [ORG_A, created.id]
    )).rows).toEqual([
      { version_number: 1, lifecycle_action: 'initial', rollback_target_version_id: null },
      { version_number: 2, lifecycle_action: 'tombstone', rollback_target_version_id: null },
      {
        version_number: 3,
        lifecycle_action: 'rollback',
        rollback_target_version_id: created.version.id,
      },
    ]);
  });

  test('direct SQL requires active actor, exact parent, provenance, audit, and database time', async () => {
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.direct-lifecycle')
    );
    await expect(repository.createInitialKnowledgeDraft(
      freshPool,
      initialDraft('policies.initial-tombstone-repository', {
        content: { state: 'tombstoned' },
      })
    )).rejects.toMatchObject({ code: 'knowledge_initial_tombstone_invalid' });
    await expect(insertDirectInitialTombstone(
      freshPool, 'policies.initial-tombstone-database'
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_version_initial_lifecycle',
    });
    await expect(insertDirectRevision(
      freshPool, created, MEMBER_A, 'member'
    )).rejects.toMatchObject({ code: '42501' });
    await expect(insertDirectRevision(
      freshPool, created, OWNER_A, 'missing-audit', { omitAudit: true }
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_versions_evidence_required',
    });
    await expect(insertDirectRevision(
      freshPool, created, OWNER_A, 'missing-provenance', { omitProvenance: true }
    )).rejects.toMatchObject({ code: '23514' });
    await expect(insertDirectRevision(
      freshPool, created, OWNER_A, 'bad-parent', {
        parentVersionId: 'c9000000-0000-4000-8000-000000000001',
      }
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_version_latest_parent',
    });
    await expect(insertDirectRevision(
      freshPool, created, OWNER_A, 'bad-audit', {
        auditDetails: {
          canonicalDigest: 'f'.repeat(64),
          parentVersionId: created.version.id,
          versionNumber: 2,
        },
      }
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_versions_evidence_required',
    });
    await expect(insertDirectRevision(
      freshPool, created, OWNER_A, 'duplicate-parent-source', {
        duplicateParentSource: true,
      }
    )).rejects.toMatchObject({
      code: '23505', constraint: 'canonical_knowledge_provenance_source_identity_unique',
    });
    const direct = await insertDirectRevision(freshPool, created, OWNER_A, 'valid');
    expect(direct.version).toMatchObject({
      number: 2,
      lifecycleAction: 'revision',
      parentVersionId: created.version.id,
    });
    expect(new Date(direct.version.createdAt).getUTCFullYear()).not.toBe(2001);
    const evidence = (await freshPool.query(
      `SELECT version.created_at AS version_time, audit.created_at AS audit_time,
              public.canonical_knowledge_lifecycle_audit_graph_matches(audit.id) AS graph_matches
         FROM canonical_knowledge_versions version
         JOIN canonical_knowledge_audit_events audit
           ON audit.organization_id = version.organization_id
          AND audit.version_id = version.id
        WHERE version.organization_id = $1 AND version.id = $2`,
      [ORG_A, direct.version.id]
    )).rows[0];
    expect(new Date(evidence.version_time).getTime()).toBe(new Date(evidence.audit_time).getTime());
    expect(evidence.graph_matches).toBe(true);
    await expect(freshPool.query(
      `UPDATE canonical_knowledge_versions SET reason = 'mutated'
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, direct.version.id]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(freshPool.query(
      `DELETE FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, direct.version.id]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_provenance
         (organization_id, version_id, ordinal, source_type, source_record_id,
          source_version, source_digest, json_pointer)
       VALUES ($1, $2, 3, 'human_input', 'late-evidence', '1', $3, '/late')`,
      [ORG_A, direct.version.id, digest('late-evidence')]
    )).rejects.toMatchObject({
      code: '55000', constraint: 'canonical_knowledge_provenance_sealed',
    });
    expect((await freshPool.query(
      `SELECT count(*)::int AS versions,
              (SELECT count(*)::int FROM canonical_knowledge_audit_events
                WHERE organization_id = $1 AND entry_id = $2
                  AND action = 'version_revised') AS revisions
         FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND entry_id = $2`,
      [ORG_A, created.id]
    )).rows).toEqual([{ versions: 2, revisions: 1 }]);
  });

  test('serializes direct workflow inserts with lifecycle head changes', async () => {
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow-lifecycle-lock')
    );
    const triggerTables = (await freshPool.query(
      `SELECT class.relname
         FROM pg_trigger trigger
         JOIN pg_class class ON class.oid = trigger.tgrelid
         JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND trigger.tgname = 'canonical_knowledge_00_entry_lock'
          AND NOT trigger.tgisinternal
        ORDER BY class.relname`
    )).rows.map(row => row.relname);
    expect(triggerTables).toEqual([
      'canonical_knowledge_attorney_review_evidence',
      'canonical_knowledge_publications',
      'canonical_knowledge_review_events',
      'canonical_knowledge_review_snapshots',
      'canonical_knowledge_versions',
    ]);

    const snapshotClient = await freshPool.connect();
    const versionClient = await freshPool.connect();
    try {
      await snapshotClient.query('BEGIN');
      const reviewDiff = buildKnowledgeDiff(null, created.version.document);
      await snapshotClient.query(
        `INSERT INTO canonical_knowledge_review_snapshots
           (organization_id, entry_id, version_id, base_version_id, version_digest,
            diff, canonical_diff, diff_digest, submitted_by_user_id, reason)
         VALUES ($1, $2, $3, NULL, $4, $5::jsonb, $6, $7, $8, $9)`,
        [
          ORG_A, created.id, created.version.id, created.version.canonicalDigest,
          JSON.stringify(reviewDiff.document), reviewDiff.canonicalDiff,
          reviewDiff.diffDigest, OWNER_A, 'Hold the exact direct review lock.',
        ]
      );

      const draft = normalizeInitialDraft(revisionInput(
        created,
        OWNER_A,
        { state: 'ready', statement: 'Blocked until direct review releases the entry.' },
        'workflow-lock'
      ));
      await versionClient.query('BEGIN');
      await versionClient.query("SET LOCAL lock_timeout = '250ms'");
      await expect(versionClient.query(
        `INSERT INTO canonical_knowledge_versions
           (organization_id, entry_id, version_number, schema_version, canonical_key,
            entry_type, content_origin, label, sensitivity, review_requirement,
            applicability, document, canonical_document, canonical_digest,
            parent_version_id, lifecycle_action, rollback_target_version_id,
            created_by_user_id, reason)
         VALUES ($1, $2, 2, 1, $3, $4, $5, $6, $7, $8,
                 $9::jsonb, $10::jsonb, $11, $12, $13, 'revision', NULL, $14, $15)`,
        [
          ORG_A, created.id, created.canonicalKey, created.entryType, draft.origin,
          draft.label, draft.sensitivity, draft.reviewRequirement,
          JSON.stringify(draft.applicability), draft.canonicalDocument,
          draft.canonicalDocument, draft.canonicalDigest, created.version.id,
          OWNER_A, draft.reason,
        ]
      )).rejects.toMatchObject({ code: '55P03' });
      await versionClient.query('ROLLBACK');
      await snapshotClient.query('ROLLBACK');
    } finally {
      await versionClient.query('ROLLBACK').catch(() => {});
      await snapshotClient.query('ROLLBACK').catch(() => {});
      versionClient.release();
      snapshotClient.release();
    }
  });

  test('leaves retrieval, providers, routes, tools, scheduling, and pricing outside Part 4', async () => {
    expect((await freshPool.query(
      `SELECT
         to_regclass('public.canonical_knowledge_provider_mappings') AS provider_mappings,
         to_regclass('public.canonical_knowledge_sync_outbox') AS sync_outbox,
         to_regclass('public.canonical_knowledge_retrieval_index') AS retrieval_index`
    )).rows).toEqual([{
      provider_mappings: null,
      sync_outbox: null,
      retrieval_index: null,
    }]);
  });
});
