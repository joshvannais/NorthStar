'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { createKnowledgeManagementRouter } = require('../../src/routes/knowledgeManagement');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '71000000-0000-4000-8000-000000000001';
const OWNER_A = '72000000-0000-4000-8000-000000000001';
const ADMIN_A = '72000000-0000-4000-8000-000000000002';
const MEMBER_A = '72000000-0000-4000-8000-000000000003';
const INACTIVE_A = '72000000-0000-4000-8000-000000000004';
const ORG_B = '71000000-0000-4000-8000-000000000002';
const OWNER_B = '72000000-0000-4000-8000-000000000005';
const HOSTILE = '</script><img src=x onerror=globalThis.compromised=true>\u202eNorthStar';

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function seedActor(pool, organizationId, userId, role, status, suffix) {
  await pool.query(
    `INSERT INTO organizations(id, name, email) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [organizationId, `Part 7 ${suffix}`, `part7-${suffix}@example.test`]
  );
  await pool.query(
    `INSERT INTO users(id, organization_id, name, email, password_hash, role, status)
     VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
    [userId, organizationId, `Part 7 ${suffix}`, `part7-${suffix}-${userId}@example.test`, role]
  );
  await pool.query(
    `INSERT INTO organization_memberships(id, organization_id, user_id, role, status)
     VALUES ($1,$2,$1,$3,$4)`,
    [userId, organizationId, role, status]
  );
}

function draft(organizationId, actorUserId, key, options = {}) {
  return {
    organizationId,
    actorUserId,
    canonicalKey: key,
    entryType: options.entryType || 'fact',
    label: options.label || `Part 7 ${key}`,
    sensitivity: options.sensitivity || 'internal',
    reviewRequirement: options.reviewRequirement || 'standard',
    origin: options.origin || 'human',
    applicability: options.applicability || { projection: { audiences: ['customer'] } },
    content: options.content || { facts: { businessDescription: 'Mounted Part 7 tenant.', company: { name: 'Part 7 Company' } }, state: 'ready' },
    reason: `Create mounted Part 7 ${key}.`,
    provenance: [{
      sourceType: 'human_input', sourceRecordId: `part7:${key}`,
      sourceVersion: '1', sourceDigest: sha256(`part7:${key}:1`), jsonPointer: '',
    }],
  };
}

function workflow(created, actorUserId, reason, overrides = {}) {
  return {
    organizationId: created.organizationId, actorUserId, entryId: created.id,
    versionId: created.version.id, versionNumber: created.version.number,
    canonicalDigest: created.version.canonicalDigest, expectedReviewEventId: null,
    reason, ...overrides,
  };
}

realPostgres('Mission 21 Part 7 mounted knowledge management', () => {
  let database;
  let pool;
  let knowledge;
  let identity;
  let identityPublication;
  let latestIdentity;
  let legal;
  let otherTenant;
  let syncTarget;
  let app;

  beforeAll(async () => {
    database = await createSuiteDatabase('m21-p7-management');
    pool = new Pool({ connectionString: database.connectionString, max: 8 });
    jest.resetModules();
    const db = require('../../src/db');
    expect(await db.runMigrations({ pool })).toBe(true);
    knowledge = require('../../src/knowledge/repository');

    await seedActor(pool, ORG_A, OWNER_A, 'owner', 'active', 'owner-a');
    await seedActor(pool, ORG_A, ADMIN_A, 'admin', 'active', 'admin-a');
    await seedActor(pool, ORG_A, MEMBER_A, 'member', 'active', 'member-a');
    await seedActor(pool, ORG_A, INACTIVE_A, 'owner', 'suspended', 'inactive-a');
    await seedActor(pool, ORG_B, OWNER_B, 'owner', 'active', 'owner-b');

    identity = await knowledge.createInitialKnowledgeDraft(pool, draft(ORG_A, OWNER_A, 'organization.identity'));
    const submitted = await knowledge.submitKnowledgeVersionForReview(
      pool, workflow(identity, OWNER_A, 'Submit exact Part 7 identity.')
    );
    const approved = await knowledge.approveKnowledgeVersion(
      pool, workflow(identity, ADMIN_A, 'Approve exact Part 7 identity.', { expectedReviewEventId: submitted.event.id })
    );
    identityPublication = await knowledge.publishKnowledgeVersion(
      pool, workflow(identity, OWNER_A, 'Publish exact Part 7 identity.', {
        expectedReviewEventId: approved.event.id,
        expectedPublicationId: null,
        expectedPublicationNumber: 0,
      })
    );
    const { KnowledgeSynchronizationRepository } = require('../../src/knowledge/synchronizationRepository');
    const syncRepository = new KnowledgeSynchronizationRepository(pool);
    syncTarget = await syncRepository.configureTarget({
      organizationId: ORG_A, actorUserId: OWNER_A, providerKey: 'intercepted.part7-preview',
      consumer: 'integration_adapter', audience: 'customer', capabilities: ['identity'],
      maximumEntries: 8, maximumBytes: 32768, staleAfterSeconds: 300,
    });
    const syncJob = (await syncRepository.claimJobs({ batchSize: 1, leaseSeconds: 30 }))[0];
    await syncRepository.finalizeJob({
      organizationId: ORG_A,
      id: syncJob.id,
      claimToken: syncJob.claimToken,
      accepted: true,
      observedProjectionDigest: 'f'.repeat(64),
    });
    latestIdentity = await knowledge.createKnowledgeRevision(pool, {
      organizationId: ORG_A, actorUserId: OWNER_A, entryId: identity.id,
      expectedVersionId: identity.version.id, expectedVersionNumber: identity.version.number,
      expectedCanonicalDigest: identity.version.canonicalDigest,
      canonicalKey: identity.canonicalKey, entryType: identity.entryType,
      label: identity.version.label, sensitivity: identity.version.sensitivity,
      reviewRequirement: identity.version.reviewRequirement, origin: 'human',
      applicability: identity.version.applicability,
      content: { facts: { businessDescription: `Mounted ${HOSTILE}`, company: { name: 'Part 7 Company' } }, state: 'ready' },
      reason: 'Create hostile inert-content revision for Part 7.',
      provenance: [{
        sourceType: 'human_input', sourceRecordId: 'part7:identity:revision',
        sourceVersion: '2', sourceDigest: sha256('part7:identity:revision:2'), jsonPointer: '/content',
      }],
    });
    legal = await knowledge.createInitialKnowledgeDraft(pool, draft(ORG_A, OWNER_A, 'organization.legal-disclosure', {
      entryType: 'disclosure', sensitivity: 'legal', reviewRequirement: 'attorney_gated',
      applicability: {}, content: { statement: 'Restricted legal content.', state: 'ready' },
    }));
    otherTenant = await knowledge.createInitialKnowledgeDraft(pool, draft(ORG_B, OWNER_B, 'organization.other-tenant'));

    const actors = {
      owner: { organizationId: ORG_A, userId: OWNER_A, role: 'owner' },
      admin: { organizationId: ORG_A, userId: ADMIN_A, role: 'admin' },
      member: { organizationId: ORG_A, userId: MEMBER_A, role: 'member' },
      inactive: { organizationId: ORG_A, userId: INACTIVE_A, role: 'owner' },
      other: { organizationId: ORG_B, userId: OWNER_B, role: 'owner' },
    };
    function testAuthority(req, res, next) {
      const actor = actors[req.headers['x-part7-actor']];
      if (!actor) return res.status(401).json({ code: 'test_session_missing' });
      req.tenantContext = actor;
      req.user = { id: actor.userId };
      req.userRole = actor.role;
      req.orgId = actor.organizationId;
      next();
    }
    app = express();
    app.use(express.json());
    app.use('/api/v1/knowledge-management', createKnowledgeManagementRouter({
      poolProvider: () => pool,
      tenantAccess: testAuthority,
      accountMutation: testAuthority,
      settingsRead: (_req, _res, next) => next(),
      settingsWrite: (_req, _res, next) => next(),
    }));
  }, 120000);

  afterAll(async () => {
    try { if (pool) await pool.end(); } finally { if (database) await database.cleanup(); }
  }, 60000);

  test('active member list filters protected bytes before rows and counts', async () => {
    const response = await request(app).get('/api/v1/knowledge-management').set('x-part7-actor', 'member');
    expect(response.status).toBe(200);
    expect(response.body.data.permissions).toEqual({ canMutate: false, canReadProtected: false });
    expect(response.body.data.counts.total).toBe(1);
    expect(response.body.data.items.map(item => item.entryId)).toEqual([identity.id]);
    expect(response.body.data.synchronization.targets[0].desired.sourcePins).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(legal.id);
    expect(JSON.stringify(response.body)).not.toContain('Restricted legal content');
  });

  test('owner list receives protected tenant data and honest filters/counts', async () => {
    const response = await request(app)
      .get('/api/v1/knowledge-management?sensitivity=legal&source=human_input')
      .set('x-part7-actor', 'owner');
    expect(response.status).toBe(200);
    expect(response.body.data.counts.total).toBe(2);
    expect(response.body.data.filteredCount).toBe(1);
    expect(response.body.data.items[0].entryId).toBe(legal.id);
    expect(response.body.data.permissions.canMutate).toBe(true);
  });

  test('inactive individual membership fails even with owner-shaped request context', async () => {
    const response = await request(app).get('/api/v1/knowledge-management').set('x-part7-actor', 'inactive');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('knowledge_management_authorization_required');
  });

  test('cross-tenant immutable identifiers return not found without bytes', async () => {
    const response = await request(app)
      .get(`/api/v1/knowledge-management/items/${otherTenant.id}`)
      .set('x-part7-actor', 'owner');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('knowledge_management_not_found');
    expect(JSON.stringify(response.body)).not.toContain('organization.other-tenant');
  });

  test('exact detail exposes inert content, deterministic diff, provenance, history, publication, and sync pins', async () => {
    const response = await request(app)
      .get(`/api/v1/knowledge-management/items/${identity.id}`)
      .set('x-part7-actor', 'owner');
    expect(response.status).toBe(200);
    const detail = response.body.data;
    expect(detail.version).toEqual(expect.objectContaining({
      id: latestIdentity.version.id,
      number: 2,
      canonicalDigest: latestIdentity.version.canonicalDigest,
    }));
    expect(detail.version.document.content.facts.businessDescription).toContain(HOSTILE);
    expect(detail.comparison.baseVersionId).toBe(identity.version.id);
    expect(detail.comparison.document.operations.length).toBeGreaterThan(0);
    expect(detail.version.provenance.map(item => item.sourceDigest)).toContain(sha256('part7:identity:revision:2'));
    expect(detail.publication.current.id).toBe(identityPublication.id);
    expect(detail.history.map(item => item.versionId)).toEqual([identity.version.id, latestIdentity.version.id]);
    expect(detail.synchronization).toHaveLength(1);
    expect(detail.synchronization[0].status).toBe('drifted');
    expect(detail.synchronization[0].desired.sourcePins[0]).toEqual(expect.objectContaining({ entryId: identity.id }));
    expect(detail.sourceCorrection.url).toContain('/dashboard/business-profile?section=company');
  });

  test('member exact detail remains readable but lifecycle evidence is restricted', async () => {
    const response = await request(app)
      .get(`/api/v1/knowledge-management/items/${identity.id}`)
      .set('x-part7-actor', 'member');
    expect(response.status).toBe(200);
    expect(response.body.data.history).toBeNull();
    expect(response.body.data.permissions.canMutate).toBe(false);
    expect(response.body.data.synchronization[0].desired.sourcePins).toEqual([]);
    const legalResponse = await request(app)
      .get(`/api/v1/knowledge-management/items/${legal.id}`)
      .set('x-part7-actor', 'member');
    expect(legalResponse.status).toBe(404);
  });

  test('readable revision never leaks a restricted current publication through comparison metadata or bytes', async () => {
    const secretMarker = 'PART7-RESTRICTED-PUBLICATION-BYTES-MUST-NOT-LEAK';
    const protectedDraft = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'organization.restricted-comparison-base', {
        sensitivity: 'restricted',
        content: { facts: { privateInstruction: secretMarker }, state: 'ready' },
      }
    ));
    const submitted = await knowledge.submitKnowledgeVersionForReview(
      pool, workflow(protectedDraft, OWNER_A, 'Submit restricted comparison base.')
    );
    const approved = await knowledge.approveKnowledgeVersion(
      pool, workflow(protectedDraft, ADMIN_A, 'Approve restricted comparison base.', {
        expectedReviewEventId: submitted.event.id,
      })
    );
    const protectedPublication = await knowledge.publishKnowledgeVersion(
      pool, workflow(protectedDraft, OWNER_A, 'Publish restricted comparison base.', {
        expectedReviewEventId: approved.event.id,
        expectedPublicationId: null,
        expectedPublicationNumber: 0,
      })
    );
    const readableRevision = await knowledge.createKnowledgeRevision(pool, {
      organizationId: ORG_A,
      actorUserId: OWNER_A,
      entryId: protectedDraft.id,
      expectedVersionId: protectedDraft.version.id,
      expectedVersionNumber: protectedDraft.version.number,
      expectedCanonicalDigest: protectedDraft.version.canonicalDigest,
      canonicalKey: protectedDraft.canonicalKey,
      entryType: protectedDraft.entryType,
      label: protectedDraft.version.label,
      sensitivity: 'internal',
      reviewRequirement: 'standard',
      origin: 'human',
      applicability: protectedDraft.version.applicability,
      content: { facts: { businessDescription: 'Readable replacement.' }, state: 'ready' },
      reason: 'Replace restricted comparison base with readable knowledge.',
      provenance: [{
        sourceType: 'human_input',
        sourceRecordId: 'part7:restricted-comparison-base:readable',
        sourceVersion: '2',
        sourceDigest: sha256('part7:restricted-comparison-base:readable:2'),
        jsonPointer: '/content',
      }],
    });

    const response = await request(app)
      .get(`/api/v1/knowledge-management/items/${readableRevision.id}`)
      .set('x-part7-actor', 'member');
    expect(response.status).toBe(200);
    expect(response.body.data.version.id).toBe(readableRevision.version.id);
    expect(response.body.data.comparison).toEqual(expect.objectContaining({
      restricted: true,
      document: null,
      canonicalDiff: null,
      diffDigest: null,
      baseVersionId: null,
    }));
    expect(response.body.data.publication.current).toBeNull();
    expect(response.body.data.publication.currentRestricted).toBe(true);
    expect(response.body.data.version.parentVersionId).toBeNull();
    expect(response.body.data.version.parentVersionRestricted).toBe(true);
    expect(response.body.data.version.provenance).toContainEqual(expect.objectContaining({
      sourceType: 'system_generation',
      sourceRecordId: null,
      sourceDigest: null,
      restricted: true,
    }));
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain(protectedDraft.version.id);
    expect(serialized).not.toContain(protectedDraft.version.canonicalDigest);
    expect(serialized).not.toContain(protectedPublication.id);
  });

  test('mounted stale workflow request fails closed with no review residue', async () => {
    const response = await request(app)
      .post(`/api/v1/knowledge-management/items/${identity.id}/review`)
      .set('x-part7-actor', 'owner')
      .send({
        versionId: identity.version.id,
        versionNumber: identity.version.number,
        canonicalDigest: identity.version.canonicalDigest,
        expectedReviewEventId: null,
        reason: 'Stale review must fail.',
      });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('knowledge_stale_version');
    const residue = await pool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_review_snapshots WHERE version_id = $1',
      [latestIdentity.version.id]
    );
    expect(residue.rows[0].count).toBe(0);
  });

  test('mounted reconcile and retry preserve the exact Part 6 target authority', async () => {
    for (const action of ['reconcile', 'retry']) {
      const response = await request(app)
        .post(`/api/v1/knowledge-management/synchronization/${syncTarget.target.id}/${action}`)
        .set('x-part7-actor', 'owner')
        .send({
          expectedTargetRevision: syncTarget.target.targetRevision,
          expectedConfigurationDigest: syncTarget.target.configurationDigest,
        });
      expect(response.status).toBe(201);
      expect(response.body.data).toEqual(expect.objectContaining({
        organizationId: ORG_A,
        targetId: syncTarget.target.id,
        targetRevision: syncTarget.target.targetRevision,
        configurationDigest: syncTarget.target.configurationDigest,
      }));
    }
  });

  test('rollback-as-new-version detail returns an honest empty comparison when content matches the publication', async () => {
    const rollback = await knowledge.createKnowledgeRollback(pool, {
      organizationId: ORG_A,
      actorUserId: OWNER_A,
      entryId: identity.id,
      expectedVersionId: latestIdentity.version.id,
      expectedVersionNumber: latestIdentity.version.number,
      expectedCanonicalDigest: latestIdentity.version.canonicalDigest,
      rollbackVersionId: identity.version.id,
      rollbackVersionNumber: identity.version.number,
      rollbackCanonicalDigest: identity.version.canonicalDigest,
      reason: 'Restore the published content as a new immutable version.',
    });
    const response = await request(app)
      .get(`/api/v1/knowledge-management/items/${identity.id}`)
      .set('x-part7-actor', 'owner');
    expect(response.status).toBe(200);
    expect(response.body.data.version.id).toBe(rollback.version.id);
    expect(response.body.data.version.lifecycleAction).toBe('rollback');
    expect(response.body.data.comparison).toEqual(expect.objectContaining({
      baseVersionId: identity.version.id,
      unchangedFromPublished: true,
      document: { operations: [], schemaVersion: 1 },
    }));
  });

  test('direct SQL cannot mutate prior immutable knowledge bytes', async () => {
    await expect(pool.query(
      `UPDATE canonical_knowledge_versions SET label = 'tampered' WHERE id = $1`,
      [identity.version.id]
    )).rejects.toThrow();
    const exact = await pool.query('SELECT label, canonical_digest FROM canonical_knowledge_versions WHERE id = $1', [identity.version.id]);
    expect(exact.rows[0]).toEqual({ label: identity.version.label, canonical_digest: identity.version.canonicalDigest });
  });
});
