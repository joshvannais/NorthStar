'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const AUDIT_MIGRATION = '027_canonical_knowledge_audit_graph_authority.sql';
const LIFECYCLE_MIGRATION = '028_canonical_knowledge_immutable_lifecycle.sql';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

const ORG_A = 'a5100000-0000-4000-8000-000000000001';
const OWNER_A = 'b5100000-0000-4000-8000-000000000001';
const ADMIN_A = 'b5100000-0000-4000-8000-000000000002';
const MEMBER_A = 'b5100000-0000-4000-8000-000000000003';
const SUSPENDED_A = 'b5100000-0000-4000-8000-000000000004';
const ORG_B = 'a5100000-0000-4000-8000-000000000002';
const OWNER_B = 'b5100000-0000-4000-8000-000000000005';
const ORG_C = 'a5100000-0000-4000-8000-000000000003';
const OWNER_C = 'b5100000-0000-4000-8000-000000000006';
const ADMIN_C = 'b5100000-0000-4000-8000-000000000007';
const ORG_D = 'a5100000-0000-4000-8000-000000000004';
const OWNER_D = 'b5100000-0000-4000-8000-000000000008';
const ADMIN_D = 'b5100000-0000-4000-8000-000000000009';
const ORG_U = 'a5100000-0000-4000-8000-000000000005';
const OWNER_U = 'b5100000-0000-4000-8000-000000000010';
const ADMIN_U = 'b5100000-0000-4000-8000-000000000011';

const DEFINITIONS = Object.freeze({
  customer_guidance: ['organization.customer-guidance', 'policy', 'high_risk', 'internal'],
  identity: ['organization.identity', 'fact', 'standard', 'internal'],
  services: ['organization.services', 'generated_knowledge', 'standard', 'internal'],
  voice_guidance: ['organization.voice-guidance', 'guidance', 'high_risk', 'internal'],
});

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
    [organizationId, `Projection ${suffix}`, `projection-${suffix}@example.test`]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'not-used', $5, 'active')`,
    [userId, organizationId, `Projection ${suffix}`, `actor-projection-${suffix}@example.test`, role]
  );
  await pool.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $1, $3, 'active')`,
    [userId, organizationId, role]
  );
}

function initialDraft(organizationId, actorUserId, capability, content, overrides = {}) {
  const definition = DEFINITIONS[capability];
  return {
    organizationId,
    actorUserId,
    canonicalKey: definition[0],
    entryType: definition[1],
    label: `Projection fixture ${capability}`,
    sensitivity: definition[3],
    reviewRequirement: definition[2],
    origin: 'human',
    applicability: {},
    content,
    reason: `Create projection fixture ${capability}.`,
    provenance: [{
      sourceType: 'human_input',
      sourceRecordId: `${organizationId}:${capability}`,
      sourceVersion: '1',
      sourceDigest: digest(`${organizationId}:${capability}:1`),
      jsonPointer: '/content',
    }],
    ...overrides,
  };
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

async function approveAndPublish(repository, pool, created, actors, priorPublication = null) {
  const submitted = await repository.submitKnowledgeVersionForReview(
    pool,
    workflowTarget(created, actors.owner, `Submit version ${created.version.number}.`)
  );
  const approved = await repository.approveKnowledgeVersion(
    pool,
    workflowTarget(created, actors.admin, `Approve version ${created.version.number}.`, {
      expectedReviewEventId: submitted.event.id,
    })
  );
  return repository.publishKnowledgeVersion(
    pool,
    workflowTarget(created, actors.owner, `Publish version ${created.version.number}.`, {
      expectedReviewEventId: approved.event.id,
      expectedPublicationId: priorPublication ? priorPublication.id : null,
      expectedPublicationNumber: priorPublication ? priorPublication.number : 0,
    })
  );
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

function revisionInput(created, actorUserId, content, suffix) {
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
      sourceRecordId: `projection-revision-${suffix}`,
      sourceVersion: '1',
      sourceDigest: digest(`projection-revision:${suffix}`),
      jsonPointer: '/content',
    }],
  });
}

function previewInput(organizationId, actorUserId, overrides = {}) {
  return {
    organizationId,
    actorUserId,
    consumer: 'northstar_search',
    audience: 'internal',
    capabilities: ['identity'],
    ...overrides,
  };
}

function pin(publication, created) {
  return {
    canonicalDigest: publication.canonicalDigest,
    entryId: publication.entryId,
    publicationId: publication.id,
    publicationNumber: publication.number,
    versionId: publication.versionId,
    versionNumber: created.version.number,
  };
}

async function knowledgeCounts(pool, organizationId) {
  const tables = [
    'canonical_knowledge_entries', 'canonical_knowledge_versions',
    'canonical_knowledge_provenance', 'canonical_knowledge_audit_events',
    'canonical_knowledge_review_snapshots', 'canonical_knowledge_review_events',
    'canonical_knowledge_publications',
  ];
  const output = {};
  for (const table of tables) {
    output[table] = Number((await pool.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
      [organizationId]
    )).rows[0].count);
  }
  return output;
}

realPostgres('Mission 21 Part 5 mounted published knowledge projection', () => {
  let db;
  let repository;
  let freshDatabase;
  let upgradeDatabase;
  let freshPool;
  let upgradePool;
  let throughAuditDirectory;
  let throughLifecycleDirectory;
  let baseIdentity;
  let baseIdentityPublication;
  let baseGuidance;
  let baseVoice;
  let upgradeIdentity;
  let upgradePublication;

  beforeAll(async () => {
    freshDatabase = await createSuiteDatabase('m21-p5-projection-fresh');
    upgradeDatabase = await createSuiteDatabase('m21-p5-projection-upgrade');
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 10 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 5 });
    throughAuditDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p5-through027-'));
    throughLifecycleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p5-through028-'));
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
    await seedActor(upgradePool, ORG_U, OWNER_U, 'owner', 'upgrade-owner');
    await seedActor(upgradePool, ORG_U, ADMIN_U, 'admin', 'upgrade-admin');
    upgradeIdentity = await repository.createInitialKnowledgeDraft(
      upgradePool,
      initialDraft(ORG_U, OWNER_U, 'identity', {
        facts: { company: { name: 'Upgrade identity version one' } }, state: 'ready',
      })
    );
    upgradePublication = await approveAndPublish(
      repository, upgradePool, upgradeIdentity, { owner: OWNER_U, admin: ADMIN_U }
    );
    expect(await db.runMigrations({
      pool: upgradePool, migrationsDirectory: throughLifecycleDirectory,
    })).toBe(true);

    expect(await db.runMigrations({
      pool: freshPool, migrationsDirectory: throughLifecycleDirectory,
    })).toBe(true);
    for (const [organizationId, userId, role, suffix] of [
      [ORG_A, OWNER_A, 'owner', 'a-owner'], [ORG_A, ADMIN_A, 'admin', 'a-admin'],
      [ORG_A, MEMBER_A, 'member', 'a-member'], [ORG_A, SUSPENDED_A, 'owner', 'a-suspended'],
      [ORG_B, OWNER_B, 'owner', 'b-owner'], [ORG_C, OWNER_C, 'owner', 'c-owner'],
      [ORG_C, ADMIN_C, 'admin', 'c-admin'], [ORG_D, OWNER_D, 'owner', 'd-owner'],
      [ORG_D, ADMIN_D, 'admin', 'd-admin'],
    ]) await seedActor(freshPool, organizationId, userId, role, suffix);
    await freshPool.query(
      "UPDATE organization_memberships SET status = 'suspended' WHERE user_id = $1",
      [SUSPENDED_A]
    );

    baseIdentity = await repository.createInitialKnowledgeDraft(
      freshPool,
      initialDraft(ORG_A, OWNER_A, 'identity', {
        facts: {
          businessDescription: 'Visible description',
          company: {
            email: 'private@example.test', name: 'Visible Company', taxId: 'hidden-ranking-token',
          },
          headquarters: { street: '1 Private Way' },
        },
        state: 'ready',
      })
    );
    baseIdentityPublication = await approveAndPublish(
      repository, freshPool, baseIdentity, { owner: OWNER_A, admin: ADMIN_A }
    );
    baseGuidance = await repository.createInitialKnowledgeDraft(
      freshPool,
      initialDraft(ORG_A, OWNER_A, 'customer_guidance', {
        facts: { emergencyPolicy: 'protected-omegaquasar' }, state: 'ready',
      })
    );
    await approveAndPublish(repository, freshPool, baseGuidance, { owner: OWNER_A, admin: ADMIN_A });
    baseVoice = await repository.createInitialKnowledgeDraft(
      freshPool,
      initialDraft(ORG_A, OWNER_A, 'voice_guidance', {
        facts: { voiceAssistant: {
          escalationRules: { rules: [{ action: 'private-transfer-action' }] },
          greeting: 'Thank you for calling Visible Company.',
          name: 'NorthStar Guide',
        } },
        state: 'ready',
      })
    );
    await approveAndPublish(repository, freshPool, baseVoice, { owner: OWNER_A, admin: ADMIN_A });
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

  test('retrieves only exact latest published versions from fresh and upgraded databases', async () => {
    const fresh = await repository.previewPublishedKnowledgeProjection(
      freshPool, previewInput(ORG_A, OWNER_A)
    );
    expect(fresh.projection.sources).toEqual([pin(baseIdentityPublication, baseIdentity)]);
    expect(fresh.projection.items[0].content.facts.company.name).toBe('Visible Company');

    const unpublished = await repository.createKnowledgeRevision(
      upgradePool,
      revisionInput(upgradeIdentity, OWNER_U, {
        facts: { company: { name: 'Unpublished upgrade identity version two' } }, state: 'ready',
      }, 'upgrade-unpublished')
    );
    expect(unpublished.version.number).toBe(2);
    const upgraded = await repository.previewPublishedKnowledgeProjection(
      upgradePool, previewInput(ORG_U, OWNER_U)
    );
    expect(upgraded.projection.sources).toEqual([pin(upgradePublication, upgradeIdentity)]);
    expect(upgraded.canonicalProjection).toContain('Upgrade identity version one');
    expect(upgraded.canonicalProjection).not.toContain('Unpublished upgrade identity version two');
  });

  test('authorizes active tenant membership before retrieval and filters protected content before ranking', async () => {
    const member = await repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_A, MEMBER_A, {
        capabilities: ['customer_guidance', 'identity'],
        query: 'omegaquasar',
      })
    );
    expect(member.projection.items).toEqual([]);
    expect(member.projection.missingCapabilities).toEqual(['customer_guidance']);
    expect(member.canonicalProjection).not.toContain('omegaquasar');

    for (const input of [
      previewInput(ORG_A, SUSPENDED_A),
      previewInput(ORG_A, OWNER_B),
      previewInput(ORG_A, MEMBER_A, {
        audience: 'customer', consumer: 'voice_runtime',
      }),
    ]) {
      await expect(repository.previewPublishedKnowledgeProjection(freshPool, input))
        .rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    }
  });

  test('applies customer minimization before ranking without mutating canonical state', async () => {
    const before = await knowledgeCounts(freshPool, ORG_A);
    const customer = await repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_A, OWNER_A, { audience: 'customer' })
    );
    expect(customer.canonicalProjection).toContain('Visible Company');
    expect(customer.canonicalProjection).not.toContain('private@example.test');
    expect(customer.canonicalProjection).not.toContain('hidden-ranking-token');
    expect(customer.canonicalProjection).not.toContain('Private Way');
    expect(await knowledgeCounts(freshPool, ORG_A)).toEqual(before);

    const excludedQuery = await repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_A, OWNER_A, { audience: 'customer', query: 'hidden-ranking-token' })
    );
    expect(excludedQuery.projection.items).toEqual([]);
    expect(excludedQuery.projection.sources).toEqual([]);

    const voicePreview = await repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_A, OWNER_A, {
        audience: 'customer',
        capabilities: ['identity', 'voice_guidance'],
        consumer: 'voice_runtime',
      })
    );
    expect(voicePreview.canonicalProjection).toContain('Thank you for calling Visible Company.');
    expect(voicePreview.canonicalProjection).not.toContain('private-transfer-action');
    expect(voicePreview.projection.missingCapabilities).toEqual([]);
  });

  test('retrieves explicitly capability-mapped custom publications and keeps customer schemas fail closed', async () => {
    const custom = await repository.createInitialKnowledgeDraft(
      freshPool,
      initialDraft(ORG_A, OWNER_A, 'identity', {
        state: 'ready', statement: 'Mounted custom service safety guidance.',
      }, {
        applicability: { projection: {
          audiences: ['internal', 'workforce'],
          capabilities: ['services'],
          consumers: ['northstar_search'],
        } },
        canonicalKey: 'services.mounted-safety-note',
        entryType: 'guidance',
        label: 'Mounted service safety note',
      })
    );
    const publication = await approveAndPublish(
      repository, freshPool, custom, { owner: OWNER_A, admin: ADMIN_A }
    );
    const internal = await repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_A, OWNER_A, { capabilities: ['services'] })
    );
    expect(internal.projection.items).toEqual([expect.objectContaining({
      canonicalKey: 'services.mounted-safety-note', capability: 'services',
    })]);
    expect(internal.projection.sources).toEqual([pin(publication, custom)]);

    const customer = await repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_A, OWNER_A, { audience: 'customer', capabilities: ['services'] })
    );
    expect(customer.projection.items).toEqual([]);
    expect(customer.projection.missingCapabilities).toEqual(['services']);
  });

  test('replays exact historical pins and reconciles tombstone then rollback publications', async () => {
    const initial = await repository.createInitialKnowledgeDraft(
      freshPool,
      initialDraft(ORG_C, OWNER_C, 'identity', {
        facts: { company: { name: 'Lifecycle version one' } }, state: 'ready',
      })
    );
    const publicationOne = await approveAndPublish(
      repository, freshPool, initial, { owner: OWNER_C, admin: ADMIN_C }
    );
    const revision = await repository.createKnowledgeRevision(
      freshPool,
      revisionInput(initial, OWNER_C, {
        facts: { company: { name: 'Lifecycle version two' } }, state: 'ready',
      }, 'lifecycle-two')
    );
    const publicationTwo = await approveAndPublish(
      repository, freshPool, revision, { owner: OWNER_C, admin: ADMIN_C }, publicationOne
    );

    const oldProjection = await repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_C, OWNER_C, { exactSourcePins: [pin(publicationOne, initial)] })
    );
    expect(oldProjection.canonicalProjection).toContain('Lifecycle version one');
    expect(oldProjection.canonicalProjection).not.toContain('Lifecycle version two');
    await expect(repository.previewPublishedKnowledgeProjection(
      freshPool,
      previewInput(ORG_C, OWNER_C, {
        exactSourcePins: [{ ...pin(publicationOne, initial), canonicalDigest: 'f'.repeat(64) }],
      })
    )).rejects.toMatchObject({ code: 'knowledge_projection_pin_unavailable' });

    const tombstone = await repository.createKnowledgeTombstone(
      freshPool,
      lifecycleTarget(revision, OWNER_C, 'Withdraw the published identity.')
    );
    const tombstonePublication = await approveAndPublish(
      repository, freshPool, tombstone, { owner: OWNER_C, admin: ADMIN_C }, publicationTwo
    );
    const removed = await repository.previewPublishedKnowledgeProjection(
      freshPool, previewInput(ORG_C, OWNER_C)
    );
    expect(removed.projection.items[0]).toMatchObject({ state: 'tombstoned' });
    expect(removed.canonicalProjection).not.toContain('Lifecycle version two');

    const rollback = await repository.createKnowledgeRollback(
      freshPool,
      lifecycleTarget(tombstone, OWNER_C, 'Restore the exact approved second version.', {
        rollbackVersionId: revision.version.id,
        rollbackVersionNumber: revision.version.number,
        rollbackCanonicalDigest: revision.version.canonicalDigest,
      })
    );
    await approveAndPublish(
      repository, freshPool, rollback, { owner: OWNER_C, admin: ADMIN_C }, tombstonePublication
    );
    const restored = await repository.previewPublishedKnowledgeProjection(
      freshPool, previewInput(ORG_C, OWNER_C)
    );
    expect(restored.projection.items[0]).toMatchObject({ state: 'published' });
    expect(restored.canonicalProjection).toContain('Lifecycle version two');
  });

  test('keeps one serializable read snapshot while a later publication commits concurrently', async () => {
    const initial = await repository.createInitialKnowledgeDraft(
      freshPool,
      initialDraft(ORG_D, OWNER_D, 'identity', {
        facts: { company: { name: 'Snapshot version one' } }, state: 'ready',
      })
    );
    const publicationOne = await approveAndPublish(
      repository, freshPool, initial, { owner: OWNER_D, admin: ADMIN_D }
    );
    let releaseSnapshot;
    let snapshotEstablished;
    const waitForRelease = new Promise(resolve => { releaseSnapshot = resolve; });
    const snapshotReady = new Promise(resolve => { snapshotEstablished = resolve; });
    let gated = false;
    const gatedPool = {
      async connect() {
        const client = await freshPool.connect();
        return {
          async query(...args) {
            const result = await client.query(...args);
            const sql = String(args[0]);
            if (!gated && /FROM organization_memberships/.test(sql)) {
              gated = true;
              snapshotEstablished();
              await waitForRelease;
            }
            return result;
          },
          release() { client.release(); },
        };
      },
    };
    const inFlight = repository.previewPublishedKnowledgeProjection(
      gatedPool, previewInput(ORG_D, OWNER_D)
    );
    await snapshotReady;
    const revision = await repository.createKnowledgeRevision(
      freshPool,
      revisionInput(initial, OWNER_D, {
        facts: { company: { name: 'Snapshot version two' } }, state: 'ready',
      }, 'snapshot-two')
    );
    await approveAndPublish(
      repository, freshPool, revision, { owner: OWNER_D, admin: ADMIN_D }, publicationOne
    );
    releaseSnapshot();
    const snapshot = await inFlight;
    expect(snapshot.canonicalProjection).toContain('Snapshot version one');
    expect(snapshot.canonicalProjection).not.toContain('Snapshot version two');

    const after = await repository.previewPublishedKnowledgeProjection(
      freshPool, previewInput(ORG_D, OWNER_D)
    );
    expect(after.canonicalProjection).toContain('Snapshot version two');
  }, 30000);
});
