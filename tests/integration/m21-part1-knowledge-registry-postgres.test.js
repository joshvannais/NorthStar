'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const KNOWLEDGE_MIGRATION = '025_provider_agnostic_knowledge_registry.sql';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

const ORG_A = '93000000-0000-4000-8000-000000000001';
const OWNER_A = '94000000-0000-4000-8000-000000000001';
const MEMBER_A = '94000000-0000-4000-8000-000000000002';
const ORG_B = '93000000-0000-4000-8000-000000000002';
const OWNER_B = '94000000-0000-4000-8000-000000000003';

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
    [organizationId, `Knowledge ${suffix}`, `knowledge-${suffix}@example.test`]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'not-used', $5, 'active')`,
    [userId, organizationId, `Actor ${suffix}`, `actor-${suffix}@example.test`, role]
  );
  await pool.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $1, $3, 'active')`,
    [userId, organizationId, role]
  );
}

function initialDraft(organizationId, actorUserId, overrides = {}) {
  return {
    organizationId,
    actorUserId,
    canonicalKey: 'policies.estimates.deposit-disclosure',
    entryType: 'policy',
    label: 'Estimate deposit disclosure',
    sensitivity: 'internal',
    reviewRequirement: 'high_risk',
    origin: 'human',
    applicability: { serviceIds: ['roof-replacement'] },
    content: { statement: 'Deposit terms require authorized review before customer use.' },
    reason: 'Establish a reviewable canonical draft.',
    provenance: [{
      sourceType: 'human_input',
      sourceRecordId: actorUserId,
      sourceVersion: '1',
      sourceDigest: digest(`human:${actorUserId}:1`),
      jsonPointer: '',
    }],
    ...overrides,
  };
}

realPostgres('Mission 21 Part 1 canonical knowledge registry', () => {
  let freshDatabase;
  let upgradeDatabase;
  let freshPool;
  let upgradePool;
  let preKnowledgeDirectory;
  let db;

  beforeAll(async () => {
    freshDatabase = await createSuiteDatabase('m21-p1-knowledge-fresh');
    upgradeDatabase = await createSuiteDatabase('m21-p1-knowledge-upgrade');
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 6 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 4 });
    preKnowledgeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p1-pre025-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name !== KNOWLEDGE_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preKnowledgeDirectory, filename));
    }
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: preKnowledgeDirectory })).toBe(true);
    expect((await upgradePool.query(
      "SELECT to_regclass('public.canonical_knowledge_entries') AS entries"
    )).rows).toEqual([{ entries: null }]);
    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: MIGRATIONS })).toBe(true);

    await seedActor(freshPool, ORG_A, OWNER_A, 'owner', 'owner-a');
    await seedActor(freshPool, ORG_A, MEMBER_A, 'member', 'member-a');
    await seedActor(freshPool, ORG_B, OWNER_B, 'owner', 'owner-b');
  }, 90000);

  afterAll(async () => {
    try {
      if (freshPool) await freshPool.end();
      if (upgradePool) await upgradePool.end();
    } finally {
      if (preKnowledgeDirectory && path.resolve(preKnowledgeDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preKnowledgeDirectory, { recursive: true, force: true });
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
    }
  }, 90000);

  test('fresh and upgraded databases contain only empty provider-neutral Part 1 authorities', async () => {
    for (const pool of [freshPool, upgradePool]) {
      const relations = await pool.query(
        `SELECT to_regclass('public.canonical_knowledge_entries') AS entries,
                to_regclass('public.canonical_knowledge_versions') AS versions,
                to_regclass('public.canonical_knowledge_provenance') AS provenance,
                to_regclass('public.canonical_knowledge_audit_events') AS audit_events,
                to_regclass('public.canonical_knowledge_publications') AS publications,
                to_regclass('public.canonical_knowledge_provider_mappings') AS provider_mappings,
                to_regclass('public.canonical_knowledge_sync_outbox') AS sync_outbox`
      );
      expect(relations.rows).toEqual([{
        entries: 'canonical_knowledge_entries',
        versions: 'canonical_knowledge_versions',
        provenance: 'canonical_knowledge_provenance',
        audit_events: 'canonical_knowledge_audit_events',
        publications: null,
        provider_mappings: null,
        sync_outbox: null,
      }]);
      expect((await pool.query(
        `SELECT
           (SELECT count(*)::int FROM canonical_knowledge_entries) AS entries,
           (SELECT count(*)::int FROM canonical_knowledge_versions) AS versions,
           (SELECT count(*)::int FROM canonical_knowledge_provenance) AS provenance,
           (SELECT count(*)::int FROM canonical_knowledge_audit_events) AS audit_events`
      )).rows).toEqual([{ entries: 0, versions: 0, provenance: 0, audit_events: 0 }]);
      expect((await pool.query(
        `SELECT count(*)::int AS count FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace
            AND conname LIKE 'canonical_knowledge_%' AND NOT convalidated`
      )).rows).toEqual([{ count: 0 }]);
    }
  });

  test('atomically creates one tenant-scoped immutable draft with exact provenance and audit', async () => {
    const { createInitialKnowledgeDraft, getKnowledgeVersion } = require('../../src/knowledge/repository');
    const created = await createInitialKnowledgeDraft(freshPool, initialDraft(ORG_A, OWNER_A));
    expect(created).toMatchObject({
      organizationId: ORG_A,
      canonicalKey: 'policies.estimates.deposit-disclosure',
      entryType: 'policy',
      version: {
        number: 1,
        label: 'Estimate deposit disclosure',
        sensitivity: 'internal',
        reviewRequirement: 'high_risk',
        parentVersionId: null,
        provenance: [{ sourceType: 'human_input', sourceRecordId: OWNER_A, ordinal: 1 }],
      },
    });
    expect(created.version.canonicalDigest).toBe(digest(created.version.canonicalDocument));
    expect(JSON.parse(created.version.canonicalDocument)).toEqual(created.version.document);

    expect((await freshPool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_knowledge_entries WHERE organization_id = $1) AS entries,
         (SELECT count(*)::int FROM canonical_knowledge_versions WHERE organization_id = $1) AS versions,
         (SELECT count(*)::int FROM canonical_knowledge_provenance WHERE organization_id = $1) AS provenance,
         (SELECT count(*)::int FROM canonical_knowledge_audit_events WHERE organization_id = $1) AS audit_events`,
      [ORG_A]
    )).rows).toEqual([{ entries: 1, versions: 1, provenance: 1, audit_events: 1 }]);
    expect((await freshPool.query(
      `SELECT action, reason, details FROM canonical_knowledge_audit_events
        WHERE organization_id = $1 AND entry_id = $2`,
      [ORG_A, created.id]
    )).rows).toEqual([{
      action: 'entry_draft_created',
      reason: 'Establish a reviewable canonical draft.',
      details: { canonicalDigest: created.version.canonicalDigest, versionNumber: 1 },
    }]);

    const ownerRead = await getKnowledgeVersion(freshPool, {
      organizationId: ORG_A, actorUserId: OWNER_A, entryId: created.id, versionNumber: 1,
    });
    expect(ownerRead).toEqual(created);
    await expect(getKnowledgeVersion(freshPool, {
      organizationId: ORG_A, actorUserId: MEMBER_A, entryId: created.id, versionNumber: 1,
    })).rejects.toMatchObject({ code: 'knowledge_not_found', status: 404 });

    const legal = await createInitialKnowledgeDraft(freshPool, initialDraft(ORG_A, OWNER_A, {
      canonicalKey: 'disclosures.attorney-only',
      entryType: 'disclosure',
      label: 'Attorney-approved disclosure draft',
      sensitivity: 'legal',
      reviewRequirement: 'attorney_gated',
      content: { statement: 'Protected legal review content.' },
    }));
    await expect(getKnowledgeVersion(freshPool, {
      organizationId: ORG_A, actorUserId: MEMBER_A, entryId: legal.id, versionNumber: 1,
    })).rejects.toMatchObject({ code: 'knowledge_not_found', status: 404 });
    expect(await getKnowledgeVersion(freshPool, {
      organizationId: ORG_A, actorUserId: OWNER_A, entryId: legal.id, versionNumber: 1,
    })).toEqual(legal);

    const standardInternal = await createInitialKnowledgeDraft(freshPool, initialDraft(ORG_A, OWNER_A, {
      canonicalKey: 'facts.member-readable',
      entryType: 'fact',
      label: 'Member-readable internal fact',
      reviewRequirement: 'standard',
    }));
    expect(await getKnowledgeVersion(freshPool, {
      organizationId: ORG_A, actorUserId: MEMBER_A, entryId: standardInternal.id, versionNumber: 1,
    })).toEqual(standardInternal);

    const canonicalEdge = await createInitialKnowledgeDraft(freshPool, initialDraft(ORG_A, OWNER_A, {
      canonicalKey: 'facts.canonical-byte-order',
      entryType: 'fact',
      label: 'Canonical byte-order fixture',
      reviewRequirement: 'standard',
      content: {
        '\ufffd': 2,
        '\ud83d\ude00': 1,
        10: 'ten',
        2: 'two',
        tiny: 1e-7,
        huge: 1e21,
      },
    }));
    expect(canonicalEdge.version.canonicalDocument).toContain(
      '"10":"ten","2":"two","huge":1000000000000000000000,"tiny":0.0000001,"�":2,"😀":1'
    );
    expect((await freshPool.query(
      `SELECT canonical_document = public.canonical_knowledge_render_jsonb(document) AS canonical
         FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, canonicalEdge.version.id]
    )).rows).toEqual([{ canonical: true }]);

    await expect(getKnowledgeVersion(freshPool, {
      organizationId: ORG_B, actorUserId: OWNER_B, entryId: created.id, versionNumber: 1,
    })).rejects.toMatchObject({ code: 'knowledge_not_found', status: 404 });
  });

  test('enforces author roles, tenant-unique keys, cross-tenant independence and atomic failure', async () => {
    const { createInitialKnowledgeDraft } = require('../../src/knowledge/repository');
    await expect(createInitialKnowledgeDraft(
      freshPool,
      initialDraft(ORG_A, MEMBER_A, { canonicalKey: 'facts.member-forbidden' })
    )).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    expect((await freshPool.query(
      "SELECT count(*)::int AS count FROM canonical_knowledge_entries WHERE canonical_key = 'facts.member-forbidden'"
    )).rows).toEqual([{ count: 0 }]);

    await expect(createInitialKnowledgeDraft(freshPool, initialDraft(ORG_A, OWNER_A)))
      .rejects.toMatchObject({ code: 'knowledge_key_conflict', status: 409 });
    const tenantB = await createInitialKnowledgeDraft(freshPool, initialDraft(ORG_B, OWNER_B));
    expect(tenantB.organizationId).toBe(ORG_B);
    expect((await freshPool.query(
      "SELECT count(*)::int AS count FROM canonical_knowledge_entries WHERE canonical_key = 'policies.estimates.deposit-disclosure'"
    )).rows).toEqual([{ count: 2 }]);
  });

  test('database authority rejects malformed bytes, false digests, orphan versions and every mutation', async () => {
    const { createInitialKnowledgeDraft } = require('../../src/knowledge/repository');
    await createInitialKnowledgeDraft(freshPool, initialDraft(ORG_A, OWNER_A, {
      canonicalKey: 'facts.audit-pair',
      entryType: 'fact',
      label: 'Audit pair integrity fixture',
    }));
    const entry = (await freshPool.query(
      `SELECT id, organization_id FROM canonical_knowledge_entries
        WHERE organization_id = $1 AND canonical_key = 'policies.estimates.deposit-disclosure'`,
      [ORG_A]
    )).rows[0];
    const version = (await freshPool.query(
      'SELECT id FROM canonical_knowledge_versions WHERE organization_id = $1 AND entry_id = $2',
      [ORG_A, entry.id]
    )).rows[0];

    await expect(freshPool.query(
      'UPDATE canonical_knowledge_entries SET canonical_key = canonical_key WHERE organization_id = $1 AND id = $2',
      [ORG_A, entry.id]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(freshPool.query(
      'UPDATE canonical_knowledge_versions SET label = label WHERE organization_id = $1 AND id = $2',
      [ORG_A, version.id]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(freshPool.query(
      'DELETE FROM canonical_knowledge_provenance WHERE organization_id = $1 AND version_id = $2',
      [ORG_A, version.id]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(freshPool.query(
      'DELETE FROM canonical_knowledge_audit_events WHERE organization_id = $1 AND version_id = $2',
      [ORG_A, version.id]
    )).rejects.toMatchObject({ code: '55000' });

    const badDocument = JSON.stringify({
      applicability: {}, canonicalKey: 'facts.bad', content: {}, entryType: 'fact',
      label: 'Wrong label', origin: 'human', reviewRequirement: 'standard',
      schemaVersion: 1, sensitivity: 'internal',
    });
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_versions
         (organization_id, entry_id, version_number, schema_version, canonical_key,
          entry_type, content_origin, label, sensitivity, review_requirement,
          applicability, document, canonical_document, canonical_digest,
          created_by_user_id, reason)
       VALUES ($1, $2, 2, 1, 'policies.estimates.deposit-disclosure', 'policy',
               'human', 'Different column label', 'internal', 'standard', '{}',
               $3::jsonb, public.canonical_knowledge_render_jsonb($3::jsonb),
               encode(sha256(convert_to(public.canonical_knowledge_render_jsonb($3::jsonb), 'UTF8')), 'hex'),
               $4, 'Invalid direct write')`,
      [ORG_A, entry.id, badDocument, OWNER_A]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_knowledge_versions_document_check' });

    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_versions
         (organization_id, entry_id, version_number, schema_version, canonical_key,
          entry_type, content_origin, label, sensitivity, review_requirement,
          applicability, document, canonical_document, canonical_digest,
          created_by_user_id, reason)
       VALUES ($1, $2, 2, 1, 'policies.estimates.deposit-disclosure', 'policy',
               'human', 'Different column label', 'internal', 'standard', '{}',
               '{}'::jsonb, '{}',
               encode(sha256(convert_to('{}', 'UTF8')), 'hex'),
               $3, 'Reject empty document')`,
      [ORG_A, entry.id, OWNER_A]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_knowledge_versions_document_check' });

    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_versions
         (organization_id, entry_id, version_number, schema_version, canonical_key,
          entry_type, content_origin, label, sensitivity, review_requirement,
          applicability, document, canonical_document, canonical_digest,
          parent_version_id, created_by_user_id, reason)
       SELECT organization_id, entry_id, 2, schema_version, canonical_key,
              entry_type, content_origin, label, sensitivity, review_requirement,
              applicability, document, canonical_document, repeat('1', 64),
              id, created_by_user_id, 'Reject false digest'
         FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, version.id]
    )).rejects.toMatchObject({ code: '23514', constraint: 'canonical_knowledge_versions_digest_check' });

    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_versions
         (organization_id, entry_id, version_number, schema_version, canonical_key,
          entry_type, content_origin, label, sensitivity, review_requirement,
          applicability, document, canonical_document, canonical_digest,
          parent_version_id, created_by_user_id, reason)
       SELECT organization_id, entry_id, 2, schema_version, canonical_key,
              entry_type, content_origin, label, sensitivity, review_requirement,
              applicability, document, jsonb_pretty(document),
              encode(sha256(convert_to(jsonb_pretty(document), 'UTF8')), 'hex'),
              id, created_by_user_id, 'Reject alternate equivalent JSON bytes'
         FROM canonical_knowledge_versions
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, version.id]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_versions_canonical_check',
    });

    const orphanClient = await freshPool.connect();
    try {
      await orphanClient.query('BEGIN');
      await orphanClient.query(
        `INSERT INTO canonical_knowledge_versions
           (organization_id, entry_id, version_number, schema_version, canonical_key,
            entry_type, content_origin, label, sensitivity, review_requirement,
            applicability, document, canonical_document, canonical_digest,
            parent_version_id, created_by_user_id, reason)
         SELECT organization_id, entry_id, 2, schema_version, canonical_key,
                entry_type, content_origin, label, sensitivity, review_requirement,
                applicability, document, canonical_document, canonical_digest,
                id, created_by_user_id, 'Reject missing evidence'
           FROM canonical_knowledge_versions
          WHERE organization_id = $1 AND id = $2`,
        [ORG_A, version.id]
      );
      await expect(orphanClient.query('COMMIT')).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_knowledge_versions_evidence_required',
      });
    } finally {
      await orphanClient.query('ROLLBACK').catch(() => {});
      orphanClient.release();
    }
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_versions WHERE organization_id = $1 AND entry_id = $2',
      [ORG_A, entry.id]
    )).rows).toEqual([{ count: 1 }]);

    const { normalizeInitialDraft } = require('../../src/knowledge/contract');
    const misleadingDraft = normalizeInitialDraft(initialDraft(ORG_A, OWNER_A, {
      canonicalKey: 'facts.misleading-audit-evidence',
      entryType: 'fact',
      label: 'Misleading audit evidence fixture',
      reviewRequirement: 'standard',
    }));
    const misleadingClient = await freshPool.connect();
    try {
      await misleadingClient.query('BEGIN');
      const misleadingEntry = (await misleadingClient.query(
        `INSERT INTO canonical_knowledge_entries
           (organization_id, canonical_key, entry_type, created_by_user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [ORG_A, misleadingDraft.canonicalKey, misleadingDraft.entryType, OWNER_A]
      )).rows[0];
      const misleadingVersion = (await misleadingClient.query(
        `INSERT INTO canonical_knowledge_versions
           (organization_id, entry_id, version_number, schema_version, canonical_key,
            entry_type, content_origin, label, sensitivity, review_requirement,
            applicability, document, canonical_document, canonical_digest,
            created_by_user_id, reason)
         VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
                 $11, $12, $13, $14)
         RETURNING id`,
        [
          ORG_A, misleadingEntry.id, misleadingDraft.canonicalKey, misleadingDraft.entryType,
          misleadingDraft.origin, misleadingDraft.label, misleadingDraft.sensitivity,
          misleadingDraft.reviewRequirement, JSON.stringify(misleadingDraft.applicability),
          misleadingDraft.canonicalDocument, misleadingDraft.canonicalDocument,
          misleadingDraft.canonicalDigest, OWNER_A, misleadingDraft.reason,
        ]
      )).rows[0];
      const source = misleadingDraft.provenance[0];
      await misleadingClient.query(
        `INSERT INTO canonical_knowledge_provenance
           (organization_id, version_id, ordinal, source_type, source_record_id,
            source_version, source_digest, json_pointer)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
        [ORG_A, misleadingVersion.id, source.sourceType, source.sourceRecordId,
          source.sourceVersion, source.sourceDigest, source.jsonPointer]
      );
      await misleadingClient.query(
        `INSERT INTO canonical_knowledge_audit_events
           (organization_id, entry_id, version_id, actor_user_id, action, reason, details)
         VALUES ($1, $2, $3, $4, 'knowledge_viewed', $5, '{}'::jsonb)`,
        [ORG_A, misleadingEntry.id, misleadingVersion.id, OWNER_A, misleadingDraft.reason]
      );
      await expect(misleadingClient.query('COMMIT')).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_knowledge_versions_evidence_required',
      });
    } finally {
      await misleadingClient.query('ROLLBACK').catch(() => {});
      misleadingClient.release();
    }
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_entries WHERE organization_id = $1 AND canonical_key = $2',
      [ORG_A, misleadingDraft.canonicalKey]
    )).rows).toEqual([{ count: 0 }]);

    const otherEntry = (await freshPool.query(
      `SELECT id FROM canonical_knowledge_entries
        WHERE organization_id = $1 AND id <> $2 LIMIT 1`,
      [ORG_A, entry.id]
    )).rows[0];
    expect(otherEntry).toBeDefined();
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_audit_events
         (organization_id, entry_id, version_id, actor_user_id, action, reason)
       VALUES ($1, $2, $3, $4, 'invalid_cross_entry_version', 'Reject mismatched authority')`,
      [ORG_A, otherEntry.id, version.id, OWNER_A]
    )).rejects.toMatchObject({
      code: '23503', constraint: 'canonical_knowledge_audit_events_version_fk',
    });
  });

  test('migration bytes are LF canonical, checksum-recorded, and idempotent', async () => {
    const bytes = fs.readFileSync(path.join(MIGRATIONS, KNOWLEDGE_MIGRATION));
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes.at(-1)).toBe(0x0a);
    const migration = db.loadMigrations(MIGRATIONS).find(item => item.file === KNOWLEDGE_MIGRATION);
    expect(digest(bytes.toString('utf8'))).toBe(migration.digest);
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect((await freshPool.query(
      'SELECT trim(checksum) AS checksum FROM _migrations WHERE filename = $1',
      [KNOWLEDGE_MIGRATION]
    )).rows).toEqual([{ checksum: migration.digest }]);
  });
});
