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
    provenance: options.provenance || [{
      sourceType: options.sourceType || 'human_input', sourceRecordId: `part7:${key}`,
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

function relationshipBearingFields(data) {
  return {
    provenance: data.version.provenance,
    reviewAndSnapshot: {
      latestReviewEventId: data.workflow.latestReviewEventId,
      events: data.workflow.events,
      snapshot: data.workflow.snapshot,
    },
    comparison: data.comparison,
    publicationAndHistory: {
      publication: data.publication,
      history: data.history,
    },
    lifecycle: {
      parentVersionId: data.version.parentVersionId,
      parentVersionRestricted: data.version.parentVersionRestricted,
      rollbackTargetVersionId: data.version.rollbackTargetVersionId,
      rollbackTargetVersionRestricted: data.version.rollbackTargetVersionRestricted,
    },
    synchronization: data.synchronization,
  };
}

async function insertOverflowFillers(client, organizationId, actorUserId, first, last) {
  if (last < first) return;
  await client.query(
    `INSERT INTO canonical_knowledge_entries(id,organization_id,canonical_key,entry_type,created_by_user_id)
     SELECT (lpad(to_hex(i),8,'0') || '-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
            $1, 'overflow.filler.' || lpad(i::text,4,'0'), 'fact', $2
       FROM generate_series($3::integer,$4::integer) AS source(i)`,
    [organizationId, actorUserId, first, last]
  );
  await client.query(
    `WITH source AS (
       SELECT i,
              (lpad(to_hex(i),8,'0') || '-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid AS entry_id,
              ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid AS version_id,
              'overflow.filler.' || lpad(i::text,4,'0') AS canonical_key,
              'Overflow filler ' || lpad(i::text,4,'0') AS label
         FROM generate_series($3::integer,$4::integer) AS input(i)
     ), prepared AS (
       SELECT *, jsonb_build_object(
         'applicability','{}'::jsonb,'canonicalKey',canonical_key,
         'content',jsonb_build_object('facts',jsonb_build_object('value',canonical_key),'state','ready'),
         'entryType','fact','label',label,'origin','human','reviewRequirement','standard',
         'schemaVersion',1,'sensitivity','internal'
       ) AS document FROM source
     ), canonical AS (
       SELECT *, public.canonical_knowledge_render_jsonb(document) AS canonical_document FROM prepared
     )
     INSERT INTO canonical_knowledge_versions(
       id,organization_id,entry_id,version_number,schema_version,canonical_key,entry_type,
       content_origin,label,sensitivity,review_requirement,applicability,document,
       canonical_document,canonical_digest,parent_version_id,created_by_user_id,reason
     )
     SELECT version_id,$1,entry_id,1,1,canonical_key,'fact','human',label,'internal','standard',
            '{}'::jsonb,document,canonical_document,
            encode(sha256(convert_to(canonical_document,'UTF8')),'hex'),NULL,$2,'Create overflow filler.'
       FROM canonical`,
    [organizationId, actorUserId, first, last]
  );
  await client.query(
    `INSERT INTO canonical_knowledge_provenance(
       organization_id,version_id,ordinal,source_type,source_record_id,
       source_version,source_digest,json_pointer
     )
     SELECT $1, ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 1,
            'human_input', 'overflow:filler:' || i::text, '1',
            encode(sha256(convert_to('overflow:filler:' || i::text,'UTF8')),'hex'), ''
       FROM generate_series($2::integer,$3::integer) AS source(i)`,
    [organizationId, first, last]
  );
  await client.query(
    `INSERT INTO canonical_knowledge_audit_events(
       organization_id,entry_id,version_id,actor_user_id,action,reason,details
     )
     SELECT version.organization_id,version.entry_id,version.id,$2,'entry_draft_created',version.reason,
            jsonb_build_object('canonicalDigest',rtrim(version.canonical_digest),'versionNumber',1)
       FROM canonical_knowledge_versions version
      WHERE version.organization_id=$1
        AND version.id IN (
          SELECT ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid
            FROM generate_series($3::integer,$4::integer) AS source(i)
        )`,
    [organizationId, actorUserId, first, last]
  );
}

async function insertOverflowVersion(client, input) {
  await client.query(
    `INSERT INTO canonical_knowledge_entries(id,organization_id,canonical_key,entry_type,created_by_user_id)
     VALUES ($1,$2,$3,'fact',$4)`,
    [input.entryId, input.organizationId, input.key, input.actorUserId]
  );
  await client.query(
    `WITH prepared AS (
       SELECT jsonb_build_object(
         'applicability','{}'::jsonb,'canonicalKey',$4::text,
         'content',jsonb_build_object('facts',jsonb_build_object('value',$4::text),'state','ready'),
         'entryType','fact','label',$5::text,'origin','human','reviewRequirement',$7::text,
         'schemaVersion',1,'sensitivity',$6::text
       ) AS document
     ), canonical AS (
       SELECT document, public.canonical_knowledge_render_jsonb(document) AS canonical_document FROM prepared
     )
     INSERT INTO canonical_knowledge_versions(
       id,organization_id,entry_id,version_number,schema_version,canonical_key,entry_type,
       content_origin,label,sensitivity,review_requirement,applicability,document,
       canonical_document,canonical_digest,parent_version_id,created_by_user_id,reason
     )
     SELECT $1,$2,$3,1,1,$4,'fact','human',$5,$6,$7,'{}'::jsonb,document,canonical_document,
            encode(sha256(convert_to(canonical_document,'UTF8')),'hex'),NULL,$8,$9 FROM canonical`,
    [input.versionId, input.organizationId, input.entryId, input.key, input.label,
      input.sensitivity || 'internal', input.reviewRequirement || 'standard', input.actorUserId, input.reason]
  );
  const canonicalDigest = String((await client.query(
    'SELECT canonical_digest FROM canonical_knowledge_versions WHERE organization_id=$1 AND id=$2',
    [input.organizationId, input.versionId]
  )).rows[0].canonical_digest).trim();
  const source = typeof input.source === 'function' ? input.source(canonicalDigest) : input.source;
  await client.query(
    `INSERT INTO canonical_knowledge_provenance(
       organization_id,version_id,ordinal,source_type,source_record_id,source_version,source_digest,json_pointer
     ) VALUES ($1,$2,1,$3,$4,$5,$6,$7)`,
    [input.organizationId, input.versionId, source.sourceType, source.sourceRecordId,
      source.sourceVersion, source.sourceDigest, source.jsonPointer]
  );
  await client.query(
    `INSERT INTO canonical_knowledge_audit_events(
       organization_id,entry_id,version_id,actor_user_id,action,reason,details
     ) VALUES ($1,$2,$3,$4,'entry_draft_created',$5,
       jsonb_build_object('canonicalDigest',$6::text,'versionNumber',1))`,
    [input.organizationId, input.entryId, input.versionId, input.actorUserId, input.reason, canonicalDigest]
  );
  return { id: input.entryId, version: { id: input.versionId, number: 1, canonicalDigest } };
}

async function withTestTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* Preserve original failure. */ }
    throw error;
  } finally {
    client.release();
  }
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
      req.subscriptionAuthority = { state: 'active', safe: true, readOnly: false };
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
    expect(response.body.data.permissions).toEqual({
      canMutate: false,
      canReadProtected: false,
      mutationRestriction: 'role_read_only',
    });
    expect(response.body.data.counts.total).toBe(1);
    expect(response.body.data.items.map(item => item.entryId)).toEqual([identity.id]);
    expect(response.body.data.synchronization.targets[0]).toEqual(expect.objectContaining({
      desired: null, observed: null, lastKnownGood: null, relationshipsRestricted: true,
    }));
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
    expect(response.body.data.synchronization[0]).toEqual(expect.objectContaining({
      desired: null, observed: null, lastKnownGood: null, relationshipsRestricted: true,
    }));
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
      sourceType: null,
      sourceRecordId: null,
      sourceDigest: null,
      restricted: true,
    }));
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain(protectedDraft.version.id);
    expect(serialized).not.toContain(protectedDraft.version.canonicalDigest);
    expect(serialized).not.toContain(protectedPublication.id);

    const readableSubmitted = await knowledge.submitKnowledgeVersionForReview(
      pool, workflow(readableRevision, OWNER_A, 'Submit readable successor over restricted publication.')
    );
    const submittedMemberResponse = await request(app)
      .get(`/api/v1/knowledge-management/items/${readableRevision.id}`)
      .set('x-part7-actor', 'member');
    expect(submittedMemberResponse.status).toBe(200);
    const submittedMember = submittedMemberResponse.body.data;
    expect(submittedMember.workflow.snapshot).toEqual(expect.objectContaining({
      id: null,
      idRestricted: true,
      baseVersionId: null,
      baseVersionRestricted: true,
      diffDigest: null,
      diffRestricted: true,
    }));
    expect(submittedMember.workflow.events[0]).toEqual(expect.objectContaining({
      snapshotId: null,
      snapshotRestricted: true,
      details: expect.objectContaining({ diffDigest: null }),
    }));
    const readableApproved = await knowledge.approveKnowledgeVersion(
      pool, workflow(readableRevision, ADMIN_A, 'Approve readable successor over restricted publication.', {
        expectedReviewEventId: readableSubmitted.event.id,
      })
    );
    const readablePublication = await knowledge.publishKnowledgeVersion(
      pool, workflow(readableRevision, OWNER_A, 'Publish readable successor over restricted publication.', {
        expectedReviewEventId: readableApproved.event.id,
        expectedPublicationId: protectedPublication.id,
        expectedPublicationNumber: protectedPublication.number,
      })
    );
    const publishedMemberResponse = await request(app)
      .get(`/api/v1/knowledge-management/items/${readableRevision.id}`)
      .set('x-part7-actor', 'member');
    expect(publishedMemberResponse.status).toBe(200);
    const publishedMember = publishedMemberResponse.body.data;
    expect(publishedMember.publication.current).toEqual(expect.objectContaining({
      id: readablePublication.id,
      number: null,
      numberRestricted: true,
      previousPublicationId: null,
      previousPublicationRestricted: true,
    }));
    expect(publishedMember.publication.history).toHaveLength(1);
    const protectedRelationshipTokens = [
      secretMarker,
      protectedDraft.version.id,
      protectedDraft.version.canonicalDigest,
      protectedPublication.id,
      readableSubmitted.snapshot.id,
      readableSubmitted.snapshot.diffDigest,
    ];
    const publishedMemberSerialized = JSON.stringify(publishedMemberResponse.body);
    protectedRelationshipTokens.forEach(token => expect(publishedMemberSerialized).not.toContain(token));

    const ownerResponse = await request(app)
      .get(`/api/v1/knowledge-management/items/${readableRevision.id}`)
      .set('x-part7-actor', 'owner');
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.data.workflow.snapshot.baseVersionId).toBe(protectedDraft.version.id);
    expect(ownerResponse.body.data.workflow.snapshot.diffDigest).toBe(readableSubmitted.snapshot.diffDigest);
    expect(ownerResponse.body.data.publication.current.previousPublicationId).toBe(protectedPublication.id);
    expect(ownerResponse.body.data.publication.current.number).toBe(readablePublication.number);
  });

  test('cross-entry relationship authorization is transitive, tenant-bound and non-oracular', async () => {
    const protectedTarget = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.protected-target', {
        sensitivity: 'restricted', reviewRequirement: 'high_risk',
        content: { facts: { privateInstruction: 'CROSS-ENTRY-PROTECTED-BYTES' }, state: 'ready' },
      }
    ));
    const direct = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.direct-readable', {
        provenance: [{
          sourceType: 'system_generation', sourceRecordId: protectedTarget.version.id,
          sourceVersion: String(protectedTarget.version.number),
          sourceDigest: protectedTarget.version.canonicalDigest,
          jsonPointer: `/protected/${protectedTarget.version.id}`,
        }],
      }
    ));
    const transitive = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.transitive-readable', {
        provenance: [{
          sourceType: 'system_generation', sourceRecordId: direct.version.id,
          sourceVersion: String(direct.version.number), sourceDigest: direct.version.canonicalDigest,
          jsonPointer: `/direct/${direct.version.id}`,
        }],
      }
    ));
    const crossTenant = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.cross-tenant-readable', {
        provenance: [{
          sourceType: 'system_generation', sourceRecordId: otherTenant.version.id,
          sourceVersion: String(otherTenant.version.number), sourceDigest: otherTenant.version.canonicalDigest,
          jsonPointer: `/other/${otherTenant.version.id}`,
        }],
      }
    ));
    const missingId = '7f000000-0000-4000-8000-000000000001';
    const missing = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.missing-readable', {
        provenance: [{
          sourceType: 'system_generation', sourceRecordId: missingId, sourceVersion: '1',
          sourceDigest: '7'.repeat(64), jsonPointer: `/missing/${missingId}`,
        }],
      }
    ));
    const mismatched = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.mismatched-readable', {
        provenance: [{
          sourceType: 'system_generation', sourceRecordId: protectedTarget.version.id,
          sourceVersion: String(protectedTarget.version.number), sourceDigest: '8'.repeat(64),
          jsonPointer: `/mismatched/${protectedTarget.version.id}`,
        }],
      }
    ));
    const importedMissingId = '7f000000-0000-4000-8000-000000000002';
    const importedMissingDigest = '9'.repeat(64);
    const importedMissing = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.imported-missing-readable', {
        provenance: [{
          sourceType: 'imported_record', sourceRecordId: importedMissingId, sourceVersion: 'provider-v1',
          sourceDigest: importedMissingDigest, jsonPointer: '/provider/missing',
        }],
      }
    ));
    const importedCrossTenant = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.imported-cross-tenant-readable', {
        provenance: [{
          sourceType: 'imported_record', sourceRecordId: otherTenant.version.id,
          sourceVersion: String(otherTenant.version.number), sourceDigest: otherTenant.version.canonicalDigest,
          jsonPointer: `/provider/${otherTenant.version.id}/${otherTenant.version.canonicalDigest}`,
        }],
      }
    ));

    const restrictedMarker = [{
      ordinal: null, sourceType: null, sourceRecordId: null, sourceVersion: null,
      sourceDigest: null, jsonPointer: null, restricted: true,
    }];
    for (const entry of [
      direct, transitive, crossTenant, missing, mismatched, importedMissing, importedCrossTenant,
    ]) {
      const member = await request(app).get(`/api/v1/knowledge-management/items/${entry.id}`)
        .set('x-part7-actor', 'member');
      expect(member.status).toBe(200);
      expect(member.body.data.version.provenance).toEqual(restrictedMarker);
      const serialized = JSON.stringify(member.body);
      for (const token of [protectedTarget.version.id, protectedTarget.version.canonicalDigest,
        otherTenant.version.id, otherTenant.version.canonicalDigest, missingId, '7'.repeat(64), '8'.repeat(64),
        importedMissingId, importedMissingDigest]) {
        expect(serialized).not.toContain(token);
      }
    }

    const ownerDirect = await request(app).get(`/api/v1/knowledge-management/items/${direct.id}`)
      .set('x-part7-actor', 'owner');
    expect(ownerDirect.status).toBe(200);
    expect(ownerDirect.body.data.version.provenance).toEqual([expect.objectContaining({
      sourceRecordId: protectedTarget.version.id,
      sourceDigest: protectedTarget.version.canonicalDigest,
      jsonPointer: `/protected/${protectedTarget.version.id}`,
    })]);
    for (const actor of ['owner', 'admin']) {
      for (const [entry, protectedTokens] of [
        [crossTenant, [otherTenant.version.id, otherTenant.version.canonicalDigest]],
        [missing, [missingId, '7'.repeat(64)]],
        [mismatched, [protectedTarget.version.id, '8'.repeat(64)]],
        [importedMissing, [importedMissingId, importedMissingDigest]],
        [importedCrossTenant, [otherTenant.version.id, otherTenant.version.canonicalDigest]],
      ]) {
        const privileged = await request(app).get(`/api/v1/knowledge-management/items/${entry.id}`)
          .set('x-part7-actor', actor);
        expect(privileged.status).toBe(200);
        expect(privileged.body.data.version.provenance).toEqual(restrictedMarker);
        const relationshipFields = relationshipBearingFields(privileged.body.data);
        expect(relationshipFields).toEqual(expect.objectContaining({
          reviewAndSnapshot: { latestReviewEventId: null, events: [], snapshot: null },
          comparison: expect.objectContaining({ restricted: true }),
          lifecycle: {
            parentVersionId: null, parentVersionRestricted: true,
            rollbackTargetVersionId: null, rollbackTargetVersionRestricted: true,
          },
          synchronization: [],
        }));
        expect(relationshipFields.publicationAndHistory).toEqual({
          publication: expect.objectContaining({ selected: null, current: null, history: [] }),
          history: null,
        });
        const serializedRelationships = JSON.stringify(relationshipFields);
        protectedTokens.forEach(token => expect(serializedRelationships).not.toContain(token));
      }
    }
  });

  test('reachable relationship depth overflow redacts every relationship-bearing response field', async () => {
    let target = await knowledge.createInitialKnowledgeDraft(pool, draft(
      ORG_A, OWNER_A, 'relationship.overflow.terminal', {
        provenance: [{
          sourceType: 'imported_record', sourceRecordId: 'overflow-external-terminal',
          sourceVersion: 'provider-v1', sourceDigest: 'd'.repeat(64), jsonPointer: '/external/terminal',
        }],
      }
    ));
    const protectedTokens = [target.version.id, target.version.canonicalDigest];
    for (let depth = 0; depth < 34; depth += 1) {
      const child = target;
      target = await knowledge.createInitialKnowledgeDraft(pool, draft(
        ORG_A, OWNER_A, `relationship.overflow.depth-${String(depth).padStart(2, '0')}`, {
          provenance: [{
            sourceType: 'system_generation', sourceRecordId: child.version.id,
            sourceVersion: String(child.version.number), sourceDigest: child.version.canonicalDigest,
            jsonPointer: `/overflow/${child.version.id}`,
          }],
        }
      ));
      protectedTokens.push(child.version.id, child.version.canonicalDigest, `/overflow/${child.version.id}`);
    }
    for (const role of ['owner', 'member']) {
      const response = await request(app).get(`/api/v1/knowledge-management/items/${target.id}`)
        .set('x-part7-actor', role);
      expect(response.status).toBe(200);
      const relationshipFields = relationshipBearingFields(response.body.data);
      expect(relationshipFields.provenance).toEqual([{
        ordinal: null, sourceType: null, sourceRecordId: null, sourceVersion: null,
        sourceDigest: null, jsonPointer: null, restricted: true,
      }]);
      expect(relationshipFields.reviewAndSnapshot).toEqual({
        latestReviewEventId: null, events: [], snapshot: null,
      });
      expect(relationshipFields.comparison).toEqual(expect.objectContaining({ restricted: true }));
      expect(relationshipFields.publicationAndHistory).toEqual({
        publication: expect.objectContaining({ selected: null, current: null, history: [] }),
        history: null,
      });
      expect(relationshipFields.lifecycle).toEqual({
        parentVersionId: null, parentVersionRestricted: true,
        rollbackTargetVersionId: null, rollbackTargetVersionRestricted: true,
      });
      expect(relationshipFields.synchronization).toEqual([]);
      const serializedRelationships = JSON.stringify(relationshipFields);
      protectedTokens.forEach(token => expect(serializedRelationships).not.toContain(token));
    }
  });

  test('selected reachable evidence remains exact at 4096, 4097, and larger unrelated tenant histories', async () => {
    const organizationId = '73000000-0000-4000-8000-000000000001';
    const ownerUserId = '73100000-0000-4000-8000-000000000001';
    const adminUserId = '73100000-0000-4000-8000-000000000002';
    const memberUserId = '73100000-0000-4000-8000-000000000003';
    const targetEntryId = 'ee000000-0000-4000-8000-000000000101';
    const targetVersionId = 'ee100000-0000-4000-8000-000000000101';
    const selectedEntryId = 'ff000000-0000-4000-8000-000000000101';
    const selectedVersionId = 'ff100000-0000-4000-8000-000000000101';
    await seedActor(pool, organizationId, ownerUserId, 'owner', 'active', 'overflow-owner');
    await seedActor(pool, organizationId, adminUserId, 'admin', 'active', 'overflow-admin');
    await seedActor(pool, organizationId, memberUserId, 'member', 'active', 'overflow-member');
    const client = await pool.connect();
    let target;
    try {
      await client.query('BEGIN');
      // The rows remain invariant-complete (entry, version, provenance, and exact audit evidence),
      // but avoid queuing thousands of per-row deferred graph checks for this scale fixture.
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await insertOverflowFillers(client, organizationId, ownerUserId, 1, 4094);
      await client.query("SET LOCAL session_replication_role = 'origin'");
      target = await insertOverflowVersion(client, {
        organizationId, actorUserId: ownerUserId, entryId: targetEntryId, versionId: targetVersionId,
        key: 'overflow.protected.target', label: 'Overflow protected target',
        sensitivity: 'restricted', reviewRequirement: 'high_risk', reason: 'Create protected overflow target.',
        source: { sourceType: 'human_input', sourceRecordId: 'overflow:protected:target',
          sourceVersion: '1', sourceDigest: sha256('overflow:protected:target:1'), jsonPointer: '' },
      });
      await insertOverflowVersion(client, {
        organizationId, actorUserId: ownerUserId, entryId: selectedEntryId, versionId: selectedVersionId,
        key: 'overflow.readable.selected', label: 'Overflow readable selected',
        reason: 'Create readable overflow selection.',
        source: { sourceType: 'system_generation', sourceRecordId: targetVersionId, sourceVersion: '1',
          sourceDigest: target.version.canonicalDigest, jsonPointer: `/protected/${targetVersionId}` },
      });
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* Preserve original failure. */ }
      throw error;
    } finally {
      client.release();
    }
    const { getKnowledgeManagementItem } = require('../../src/knowledge/managementRepository');
    const restrictedMarker = [{
      ordinal: null, sourceType: null, sourceRecordId: null, sourceVersion: null,
      sourceDigest: null, jsonPointer: null, restricted: true,
    }];
    async function exactRead(actorUserId) {
      return getKnowledgeManagementItem(pool, { organizationId, actorUserId, entryId: selectedEntryId });
    }
    async function expectProtectedAtCount(expectedCount) {
      const count = Number((await pool.query(
        'SELECT count(*) FROM canonical_knowledge_versions WHERE organization_id=$1', [organizationId]
      )).rows[0].count);
      expect(count).toBe(expectedCount);
      const member = await exactRead(memberUserId);
      expect(member.version.provenance).toEqual(restrictedMarker);
      const serializedMember = JSON.stringify(member);
      expect(serializedMember).not.toContain(targetVersionId);
      expect(serializedMember).not.toContain(target.version.canonicalDigest);
      expect(serializedMember).not.toContain(`/protected/${targetVersionId}`);
      for (const actorUserId of [ownerUserId, adminUserId]) {
        const privileged = await exactRead(actorUserId);
        expect(privileged.version.provenance).toEqual([expect.objectContaining({
          sourceRecordId: targetVersionId,
          sourceVersion: '1',
          sourceDigest: target.version.canonicalDigest,
          jsonPointer: `/protected/${targetVersionId}`,
        })]);
      }
    }
    await expectProtectedAtCount(4096);
    await withTestTransaction(pool, client =>
      insertOverflowFillers(client, organizationId, ownerUserId, 4095, 4095));
    await expectProtectedAtCount(4097);
    await withTestTransaction(pool, client =>
      insertOverflowFillers(client, organizationId, ownerUserId, 4096, 4199));
    await expectProtectedAtCount(4201);

    const external = await withTestTransaction(pool, client => insertOverflowVersion(client, {
      organizationId, actorUserId: ownerUserId,
      entryId: 'fd000000-0000-4000-8000-000000000101',
      versionId: 'fd100000-0000-4000-8000-000000000101',
      key: 'overflow.external.selected', label: 'Overflow external selected',
      reason: 'Create valid external evidence.',
      source: { sourceType: 'imported_record', sourceRecordId: 'external-provider-record-101',
        sourceVersion: 'provider-v7', sourceDigest: '9'.repeat(64),
        jsonPointer: '/external/provider-record-101' },
    }));
    const externalMember = await getKnowledgeManagementItem(pool, {
      organizationId, actorUserId: memberUserId, entryId: external.id,
    });
    expect(externalMember.version.provenance).toEqual([expect.objectContaining({
      sourceType: 'imported_record',
      sourceRecordId: 'external-provider-record-101',
      sourceVersion: 'provider-v7',
      sourceDigest: '9'.repeat(64),
      jsonPointer: '/external/provider-record-101',
    })]);

    const readableTarget = await withTestTransaction(pool, client => insertOverflowVersion(client, {
      organizationId, actorUserId: ownerUserId,
      entryId: 'ec000000-0000-4000-8000-000000000101',
      versionId: 'ec100000-0000-4000-8000-000000000101',
      key: 'overflow.readable.target', label: 'Overflow readable target',
      reason: 'Create readable target in large tenant.',
      source: { sourceType: 'human_input', sourceRecordId: 'overflow:readable:target',
        sourceVersion: '1', sourceDigest: sha256('overflow:readable:target:1'), jsonPointer: '' },
    }));
    const readableSelected = await withTestTransaction(pool, client => insertOverflowVersion(client, {
      organizationId, actorUserId: ownerUserId,
      entryId: 'fe000000-0000-4000-8000-000000000101',
      versionId: 'fe100000-0000-4000-8000-000000000101',
      key: 'overflow.readable.graph', label: 'Overflow readable graph',
      reason: 'Create small readable graph in large tenant.',
      source: { sourceType: 'system_generation', sourceRecordId: readableTarget.version.id,
        sourceVersion: '1', sourceDigest: readableTarget.version.canonicalDigest,
        jsonPointer: `/readable/${readableTarget.version.id}` },
    }));
    const readableMember = await getKnowledgeManagementItem(pool, {
      organizationId, actorUserId: memberUserId, entryId: readableSelected.id,
    });
    expect(readableMember.version.provenance).toEqual([expect.objectContaining({
      sourceRecordId: readableTarget.version.id,
      sourceDigest: readableTarget.version.canonicalDigest,
    })]);
  }, 120000);

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

  test('authorization-aware SQL filters and deterministic cursors make every row beyond 200 reachable with truthful counts', async () => {
    const bulk = [];
    for (let index = 0; index < 205; index += 1) {
      const suffix = String(index).padStart(3, '0');
      const imported = index >= 200;
      bulk.push(await knowledge.createInitialKnowledgeDraft(pool, draft(
        ORG_A, OWNER_A, `pagination.bulk.${suffix}`, {
          label: index < 12 ? 'Pagination duplicated label'
            : `${imported ? 'ZZZ' : 'Pagination'} ${suffix} readable item`,
          entryType: imported ? 'faq' : 'fact',
          sourceType: imported ? 'imported_record' : 'human_input',
          applicability: { projection: { audiences: [imported ? 'integration_adapter' : 'customer'] } },
        }
      )));
    }
    const protectedEntries = [];
    for (const index of [25, 75, 125, 175]) {
      protectedEntries.push(await knowledge.createInitialKnowledgeDraft(pool, draft(
        ORG_A, OWNER_A, `pagination.protected.${index}`, {
          label: `Pagination ${String(index).padStart(3, '0')}.5 protected item`,
          sensitivity: 'restricted',
        }
      )));
    }

    const direct = (await pool.query(
      `SELECT entry.id
         FROM canonical_knowledge_entries entry
         JOIN LATERAL (
           SELECT version.* FROM canonical_knowledge_versions version
            WHERE version.organization_id = entry.organization_id AND version.entry_id = entry.id
            ORDER BY version.version_number DESC LIMIT 1
         ) latest ON TRUE
        WHERE entry.organization_id = $1
          AND latest.sensitivity IN ('public', 'internal')
          AND latest.review_requirement = 'standard'
        ORDER BY latest.label COLLATE "C", entry.canonical_key COLLATE "C", entry.id`,
      [ORG_A]
    )).rows.map(row => row.id);
    expect(direct.length).toBeGreaterThan(200);

    async function traverse(expectedIds, onFirstPage) {
      const ids = [];
      let cursor = null;
      let pageNumber = 0;
      do {
        const query = cursor ? `?limit=37&cursor=${encodeURIComponent(cursor)}` : '?limit=37';
        const response = await request(app).get(`/api/v1/knowledge-management${query}`)
          .set('x-part7-actor', 'member');
        expect(response.status).toBe(200);
        const data = response.body.data;
        expect(data.counts.total).toBe(expectedIds.length);
        expect(data.filteredCount).toBe(expectedIds.length);
        expect(data.items.length).toBeLessThanOrEqual(37);
        expect(data.pagination).toEqual(expect.objectContaining({
          limit: 37,
          returned: data.items.length,
          hasMore: Boolean(data.pagination.nextCursor),
          truncated: Boolean(data.pagination.nextCursor),
        }));
        ids.push(...data.items.map(item => item.entryId));
        if (pageNumber === 0 && onFirstPage) await onFirstPage();
        cursor = data.pagination.nextCursor;
        pageNumber += 1;
        expect(pageNumber).toBeLessThan(20);
      } while (cursor);
      expect(new Set(ids).size).toBe(ids.length);
      return ids;
    }

    let concurrentInsert;
    const firstTraversal = await traverse(direct, async () => {
      concurrentInsert = await knowledge.createInitialKnowledgeDraft(pool, draft(
        ORG_A, OWNER_A, 'pagination.concurrent.insert', { label: 'AAA concurrent insert' }
      ));
      const target = bulk[199];
      await knowledge.createKnowledgeRevision(pool, {
        organizationId: ORG_A, actorUserId: OWNER_A, entryId: target.id,
        expectedVersionId: target.version.id, expectedVersionNumber: target.version.number,
        expectedCanonicalDigest: target.version.canonicalDigest,
        canonicalKey: target.canonicalKey, entryType: target.entryType,
        label: 'AAA concurrent revised label', sensitivity: target.version.sensitivity,
        reviewRequirement: target.version.reviewRequirement, origin: 'human',
        applicability: target.version.applicability, content: target.version.document.content,
        reason: 'Exercise stable snapshot pagination.',
        provenance: [{
          sourceType: 'human_input', sourceRecordId: 'pagination-concurrent-revision', sourceVersion: '2',
          sourceDigest: sha256('pagination-concurrent-revision'), jsonPointer: '',
        }],
      });
    });
    expect(firstTraversal).toEqual(direct);
    expect(firstTraversal).not.toContain(concurrentInsert.id);
    protectedEntries.forEach(entry => expect(firstTraversal).not.toContain(entry.id));

    const afterChanges = (await pool.query(
      `SELECT entry.id
         FROM canonical_knowledge_entries entry
         JOIN LATERAL (
           SELECT version.* FROM canonical_knowledge_versions version
            WHERE version.organization_id = entry.organization_id AND version.entry_id = entry.id
            ORDER BY version.version_number DESC LIMIT 1
         ) latest ON TRUE
        WHERE entry.organization_id = $1
          AND latest.sensitivity IN ('public', 'internal')
          AND latest.review_requirement = 'standard'
        ORDER BY latest.label COLLATE "C", entry.canonical_key COLLATE "C", entry.id`,
      [ORG_A]
    )).rows.map(row => row.id);
    const secondTraversal = await traverse(afterChanges);
    expect(secondTraversal).toEqual(afterChanges);

    const importedResponse = await request(app)
      .get('/api/v1/knowledge-management?source=imported_record&applicability=integration_adapter&workflowStatus=draft&limit=3')
      .set('x-part7-actor', 'member');
    expect(importedResponse.status).toBe(200);
    expect(importedResponse.body.data.filteredCount).toBe(5);
    expect(importedResponse.body.data.items).toHaveLength(3);
    expect(importedResponse.body.data.pagination).toEqual(expect.objectContaining({
      hasMore: true,
      truncated: true,
    }));
    const importedSecond = await request(app)
      .get('/api/v1/knowledge-management?source=imported_record&applicability=integration_adapter&workflowStatus=draft&limit=3&cursor=' +
        encodeURIComponent(importedResponse.body.data.pagination.nextCursor))
      .set('x-part7-actor', 'member');
    expect(importedSecond.status).toBe(200);
    expect(importedSecond.body.data.filteredCount).toBe(5);
    expect(importedSecond.body.data.items).toHaveLength(2);
    expect(importedSecond.body.data.pagination.hasMore).toBe(false);
    expect(importedResponse.body.data.items.concat(importedSecond.body.data.items).map(item => item.entryId))
      .toEqual(bulk.slice(200).map(entry => entry.id));

    async function traverseFiltered(parameters, expectedSubset) {
      const ids = [];
      let cursor = null;
      let matching = null;
      do {
        const query = new URLSearchParams({ ...parameters, limit: '37' });
        if (cursor) query.set('cursor', cursor);
        const response = await request(app).get(`/api/v1/knowledge-management?${query.toString()}`)
          .set('x-part7-actor', 'member');
        expect(response.status).toBe(200);
        matching = response.body.data.filteredCount;
        ids.push(...response.body.data.items.map(item => item.entryId));
        cursor = response.body.data.pagination.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(matching);
      expect(new Set(ids).size).toBe(ids.length);
      expect(matching).toBeGreaterThan(200);
      expectedSubset.forEach(id => expect(ids).toContain(id));
    }
    const firstTwoHundred = bulk.slice(0, 200).map(entry => entry.id);
    const allBulk = bulk.map(entry => entry.id);
    await traverseFiltered({ category: 'fact' }, firstTwoHundred);
    await traverseFiltered({ workflowStatus: 'draft' }, allBulk);
    await traverseFiltered({ sensitivity: 'internal' }, allBulk);
    await traverseFiltered({ source: 'human_input' }, firstTwoHundred);
    await traverseFiltered({ applicability: 'customer' }, firstTwoHundred);
    await traverseFiltered({ search: 'pagination' }, allBulk.concat(concurrentInsert.id));
  }, 120000);

  test('signed cursors reject forgery and every cross-query or authorization context', async () => {
    const first = await request(app).get('/api/v1/knowledge-management?limit=3')
      .set('x-part7-actor', 'member');
    expect(first.status).toBe(200);
    const cursor = first.body.data.pagination.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    const variants = [
      ['member', `?limit=4&cursor=${encodeURIComponent(cursor)}`],
      ['member', `?limit=3&search=safety&cursor=${encodeURIComponent(cursor)}`],
      ['member', `?limit=3&category=fact&cursor=${encodeURIComponent(cursor)}`],
      ['member', `?limit=3&workflowStatus=draft&cursor=${encodeURIComponent(cursor)}`],
      ['member', `?limit=3&sensitivity=internal&cursor=${encodeURIComponent(cursor)}`],
      ['member', `?limit=3&source=human_input&cursor=${encodeURIComponent(cursor)}`],
      ['member', `?limit=3&applicability=customer&cursor=${encodeURIComponent(cursor)}`],
      ['owner', `?limit=3&cursor=${encodeURIComponent(cursor)}`],
      ['other', `?limit=3&cursor=${encodeURIComponent(cursor)}`],
    ];
    for (const [actor, query] of variants) {
      const response = await request(app).get(`/api/v1/knowledge-management${query}`)
        .set('x-part7-actor', actor);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('knowledge_management_invalid_pagination');
    }
    const forged = `${cursor.slice(0, -1)}${cursor.endsWith('0') ? '1' : '0'}`;
    const forgedResponse = await request(app)
      .get(`/api/v1/knowledge-management?limit=3&cursor=${encodeURIComponent(forged)}`)
      .set('x-part7-actor', 'member');
    expect(forgedResponse.status).toBe(400);
    expect(forgedResponse.body.error.code).toBe('knowledge_management_invalid_pagination');
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
