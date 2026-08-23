'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const WORKFLOW_MIGRATION = '026_canonical_knowledge_review_publication.sql';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

const ORG_A = 'b7000000-0000-4000-8000-000000000001';
const OWNER_A = 'b8000000-0000-4000-8000-000000000001';
const ADMIN_A = 'b8000000-0000-4000-8000-000000000002';
const MEMBER_A = 'b8000000-0000-4000-8000-000000000003';
const ORG_B = 'b7000000-0000-4000-8000-000000000002';
const OWNER_B = 'b8000000-0000-4000-8000-000000000004';

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
    [organizationId, `Workflow ${suffix}`, `workflow-${suffix}@example.test`]
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

function initialDraft(key, reviewRequirement = 'standard', overrides = {}) {
  return {
    organizationId: ORG_A,
    actorUserId: OWNER_A,
    canonicalKey: key,
    entryType: reviewRequirement === 'attorney_gated' ? 'disclosure' : 'policy',
    label: `Review fixture ${key}`,
    sensitivity: reviewRequirement === 'attorney_gated' ? 'legal' : 'internal',
    reviewRequirement,
    origin: 'human',
    applicability: {},
    content: { statement: `Exact content for ${key}.`, state: 'ready_for_review' },
    reason: `Create ${key} for review.`,
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

realPostgres('Mission 21 Part 3 knowledge review and publication', () => {
  let freshDatabase;
  let upgradeDatabase;
  let freshPool;
  let upgradePool;
  let preWorkflowDirectory;
  let part3Directory;
  let db;

  beforeAll(async () => {
    freshDatabase = await createSuiteDatabase('m21-p3-workflow-fresh');
    upgradeDatabase = await createSuiteDatabase('m21-p3-workflow-upgrade');
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 8 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 4 });
    preWorkflowDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p3-pre026-'));
    part3Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p3-through026-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name < WORKFLOW_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preWorkflowDirectory, filename));
    }
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name <= WORKFLOW_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(part3Directory, filename));
    }
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.runMigrations({
      pool: upgradePool, migrationsDirectory: preWorkflowDirectory,
    })).toBe(true);
    expect((await upgradePool.query(
      "SELECT to_regclass('public.canonical_knowledge_publications') AS publications"
    )).rows).toEqual([{ publications: null }]);
    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: part3Directory })).toBe(true);
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: part3Directory })).toBe(true);

    await seedActor(freshPool, ORG_A, OWNER_A, 'owner', 'owner-a');
    await seedActor(freshPool, ORG_A, ADMIN_A, 'admin', 'admin-a');
    await seedActor(freshPool, ORG_A, MEMBER_A, 'member', 'member-a');
    await seedActor(freshPool, ORG_B, OWNER_B, 'owner', 'owner-b');
  }, 120000);

  afterAll(async () => {
    try {
      if (freshPool) await freshPool.end();
      if (upgradePool) await upgradePool.end();
    } finally {
      if (preWorkflowDirectory && path.resolve(preWorkflowDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preWorkflowDirectory, { recursive: true, force: true });
      }
      if (part3Directory && path.resolve(part3Directory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(part3Directory, { recursive: true, force: true });
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
    }
  }, 120000);

  test('fresh and upgraded databases contain empty append-only Part 3 authorities', async () => {
    for (const pool of [freshPool, upgradePool]) {
      expect((await pool.query(
        `SELECT
           to_regclass('public.canonical_knowledge_review_snapshots') AS snapshots,
           to_regclass('public.canonical_knowledge_review_events') AS events,
           to_regclass('public.canonical_knowledge_attorney_review_evidence') AS attorney_evidence,
           to_regclass('public.canonical_knowledge_publications') AS publications,
           to_regclass('public.canonical_knowledge_provider_mappings') AS provider_mappings,
           to_regclass('public.canonical_knowledge_sync_outbox') AS sync_outbox`
      )).rows).toEqual([{
        snapshots: 'canonical_knowledge_review_snapshots',
        events: 'canonical_knowledge_review_events',
        attorney_evidence: 'canonical_knowledge_attorney_review_evidence',
        publications: 'canonical_knowledge_publications',
        provider_mappings: null,
        sync_outbox: null,
      }]);
      expect((await pool.query(
        `SELECT
           (SELECT count(*)::int FROM canonical_knowledge_review_snapshots) AS snapshots,
           (SELECT count(*)::int FROM canonical_knowledge_review_events) AS events,
           (SELECT count(*)::int FROM canonical_knowledge_attorney_review_evidence) AS attorney_evidence,
           (SELECT count(*)::int FROM canonical_knowledge_publications) AS publications`
      )).rows).toEqual([{ snapshots: 0, events: 0, attorney_evidence: 0, publications: 0 }]);
      expect((await pool.query(
        `SELECT count(*)::int AS count FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace
            AND conname LIKE 'canonical_knowledge_%' AND NOT convalidated`
      )).rows).toEqual([{ count: 0 }]);
    }
  });

  test('submits, distinctly approves, and atomically publishes one exact standard version', async () => {
    const repository = require('../../src/knowledge/repository');
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.standard')
    );
    await expect(repository.submitKnowledgeVersionForReview(freshPool, workflowTarget(
      created, OWNER_A, 'Reject a stale digest.', { canonicalDigest: 'f'.repeat(64) }
    ))).rejects.toMatchObject({ code: 'knowledge_stale_version', status: 409 });

    const submitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(created, OWNER_A, 'Submit the exact standard version.')
    );
    expect(submitted.snapshot).toMatchObject({
      versionId: created.version.id,
      baseVersionId: null,
      versionDigest: created.version.canonicalDigest,
      diff: {
        schemaVersion: 1,
        operations: [{ op: 'add', path: '', value: created.version.document }],
      },
    });
    expect(submitted.snapshot.diffDigest).toBe(digest(submitted.snapshot.canonicalDiff));
    expect(submitted.event).toMatchObject({ action: 'review_submitted', sequence: 1 });

    const approved = await repository.approveKnowledgeVersion(freshPool, workflowTarget(
      created, ADMIN_A, 'Approve the exact standard version.', {
        expectedReviewEventId: submitted.event.id,
      }
    ));
    expect(approved.event).toMatchObject({ action: 'standard_approved', sequence: 2 });
    expect(approved.attorneyReview).toBeNull();

    const published = await repository.publishKnowledgeVersion(freshPool, workflowTarget(
      created, OWNER_A, 'Publish the exact approved standard version.', {
        expectedReviewEventId: approved.event.id,
        expectedPublicationId: null,
        expectedPublicationNumber: 0,
      }
    ));
    expect(published).toMatchObject({
      versionId: created.version.id,
      number: 1,
      canonicalDigest: created.version.canonicalDigest,
      reviewEventId: approved.event.id,
      previousPublicationId: null,
    });
    const state = await repository.getKnowledgeWorkflowState(freshPool, {
      organizationId: ORG_A, actorUserId: OWNER_A, entryId: created.id,
    });
    expect(state.events.map(event => event.action)).toEqual([
      'review_submitted', 'standard_approved',
    ]);
    expect(state.publications).toEqual([published]);
    expect((await freshPool.query(
      `SELECT action FROM canonical_knowledge_audit_events
        WHERE organization_id = $1 AND entry_id = $2 ORDER BY created_at, id`,
      [ORG_A, created.id]
    )).rows.map(row => row.action)).toEqual([
      'entry_draft_created', 'review_submitted', 'standard_approved', 'version_published',
    ]);
    await expect(repository.publishKnowledgeVersion(freshPool, workflowTarget(
      created, OWNER_A, 'Reject a repeated publication.', {
        expectedReviewEventId: approved.event.id,
        expectedPublicationId: null,
        expectedPublicationNumber: 0,
      }
    ))).rejects.toMatchObject({ code: 'knowledge_stale_publication', status: 409 });
  });

  test('enforces individual roles, tenant isolation, stale events and terminal change requests', async () => {
    const repository = require('../../src/knowledge/repository');
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.changes', 'high_risk')
    );
    await expect(repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(created, MEMBER_A, 'Member cannot submit.')
    )).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_review_snapshots WHERE entry_id = $1',
      [created.id]
    )).rows).toEqual([{ count: 0 }]);

    const submitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(created, OWNER_A, 'Submit high-risk content.')
    );
    await expect(repository.approveKnowledgeVersion(freshPool, workflowTarget(
      created, ADMIN_A, 'Use a stale review event.', { expectedReviewEventId: null }
    ))).rejects.toMatchObject({ code: 'knowledge_stale_review', status: 409 });
    const changes = await repository.requestKnowledgeChanges(freshPool, workflowTarget(
      created, ADMIN_A, 'Request a corrected immutable version.', {
        expectedReviewEventId: submitted.event.id,
      }
    ));
    expect(changes.event.action).toBe('changes_requested');
    await expect(repository.approveKnowledgeVersion(freshPool, workflowTarget(
      created, OWNER_A, 'Cannot approve a terminal review.', {
        expectedReviewEventId: changes.event.id,
      }
    ))).rejects.toMatchObject({ code: 'knowledge_review_state_invalid', status: 409 });
    await expect(repository.getKnowledgeWorkflowState(freshPool, {
      organizationId: ORG_A, actorUserId: MEMBER_A, entryId: created.id,
    })).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    await expect(repository.getKnowledgeWorkflowState(freshPool, {
      organizationId: ORG_B, actorUserId: OWNER_B, entryId: created.id,
    })).rejects.toMatchObject({ code: 'knowledge_not_found', status: 404 });
  });

  test('serializes high-risk approval and concurrent publication without partial state', async () => {
    const repository = require('../../src/knowledge/repository');
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.high-risk', 'high_risk')
    );
    const submitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(created, OWNER_A, 'Submit the high-risk version.')
    );
    const approved = await repository.approveKnowledgeVersion(freshPool, workflowTarget(
      created, ADMIN_A, 'Explicitly approve high-risk content.', {
        expectedReviewEventId: submitted.event.id,
      }
    ));
    expect(approved.event.action).toBe('high_risk_approved');
    const publishInput = workflowTarget(
      created, OWNER_A, 'Publish high-risk content once.', {
        expectedReviewEventId: approved.event.id,
        expectedPublicationId: null,
        expectedPublicationNumber: 0,
      }
    );
    const outcomes = await Promise.allSettled([
      repository.publishKnowledgeVersion(freshPool, publishInput),
      repository.publishKnowledgeVersion(freshPool, publishInput),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(['knowledge_stale_publication', 'knowledge_workflow_conflict']).toContain(
      outcomes.find(outcome => outcome.status === 'rejected').reason.code
    );
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_publications WHERE entry_id = $1',
      [created.id]
    )).rows).toEqual([{ count: 1 }]);
    expect((await freshPool.query(
      `SELECT count(*)::int AS count FROM canonical_knowledge_audit_events
        WHERE entry_id = $1 AND action = 'version_published'`,
      [created.id]
    )).rows).toEqual([{ count: 1 }]);
  });

  test('records digest-only attorney evidence and blocks unresolved or unevidenced approval', async () => {
    const repository = require('../../src/knowledge/repository');
    const legal = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('disclosures.workflow.legal', 'attorney_gated')
    );
    const legalSubmitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(legal, OWNER_A, 'Submit attorney-gated content.')
    );
    await expect(repository.approveKnowledgeVersion(freshPool, workflowTarget(
      legal, ADMIN_A, 'Reject missing attorney evidence.', {
        expectedReviewEventId: legalSubmitted.event.id,
      }
    ))).rejects.toMatchObject({ code: 'knowledge_attorney_review_required', status: 409 });
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_attorney_review_evidence WHERE entry_id = $1',
      [legal.id]
    )).rows).toEqual([{ count: 0 }]);

    const evidenceDigest = digest('external-attorney-review-document');
    const legalApproved = await repository.approveKnowledgeVersion(freshPool, workflowTarget(
      legal, ADMIN_A, 'Record external review and approve the exact legal draft.', {
        expectedReviewEventId: legalSubmitted.event.id,
        attorneyReview: {
          reviewReference: 'counsel-matter-21',
          evidenceDigest,
          reviewedAt: '2026-08-23T12:00:00.000Z',
        },
      }
    ));
    expect(legalApproved.event.action).toBe('attorney_gated_approved');
    expect(legalApproved.attorneyReview).toMatchObject({
      reviewReference: 'counsel-matter-21', evidenceDigest,
    });
    expect(JSON.stringify(legalApproved.attorneyReview)).not.toContain('external-attorney-review-document');
    const legalPublished = await repository.publishKnowledgeVersion(freshPool, workflowTarget(
      legal, OWNER_A, 'Publish the exact attorney-reviewed version.', {
        expectedReviewEventId: legalApproved.event.id,
        expectedPublicationId: null,
        expectedPublicationNumber: 0,
      }
    ));
    expect(legalPublished).toMatchObject({
      canonicalDigest: legal.version.canonicalDigest,
      reviewEventId: legalApproved.event.id,
      number: 1,
    });
    await expect(freshPool.query(
      'UPDATE canonical_knowledge_attorney_review_evidence SET review_reference = review_reference WHERE id = $1',
      [legalApproved.attorneyReview.id]
    )).rejects.toMatchObject({ code: '55000' });
    await expect(freshPool.query(
      'DELETE FROM canonical_knowledge_publications WHERE id = $1',
      [legalPublished.id]
    )).rejects.toMatchObject({ code: '55000' });

    const futureLegal = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('disclosures.workflow.future-evidence', 'attorney_gated')
    );
    const futureSubmitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(futureLegal, OWNER_A, 'Submit future-evidence guard.')
    );
    await expect(repository.approveKnowledgeVersion(freshPool, workflowTarget(
      futureLegal, ADMIN_A, 'Reject future-dated attorney evidence.', {
        expectedReviewEventId: futureSubmitted.event.id,
        attorneyReview: {
          reviewReference: 'future-counsel-matter',
          evidenceDigest: digest('future-evidence'),
          reviewedAt: '2099-01-01T00:00:00.000Z',
        },
      }
    ))).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_attorney_evidence_time_check',
    });
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_attorney_review_evidence WHERE entry_id = $1',
      [futureLegal.id]
    )).rows).toEqual([{ count: 0 }]);

    const directLegal = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('disclosures.workflow.direct-evidence-boundary', 'attorney_gated')
    );
    const directSubmitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(directLegal, OWNER_A, 'Submit direct evidence boundary guard.')
    );
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_attorney_review_evidence
         (organization_id, entry_id, version_id, snapshot_id, recorded_by_user_id,
          review_reference, evidence_digest, reviewed_at, recorded_at)
       VALUES ($1, $2, $3, $4, $5, 'future-direct-evidence', $6,
               '2099-01-01T00:00:00.000Z'::timestamptz,
               '2099-01-01T00:00:00.000Z'::timestamptz)`,
      [ORG_A, directLegal.id, directLegal.version.id, directSubmitted.snapshot.id,
        ADMIN_A, digest('future-direct-evidence')]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_attorney_evidence_time_check',
    });
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_attorney_review_evidence
         (organization_id, entry_id, version_id, snapshot_id, recorded_by_user_id,
          review_reference, evidence_digest, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())`,
      [ORG_A, directLegal.id, directLegal.version.id, directSubmitted.snapshot.id,
        ADMIN_A, 'counsel\u200bmatter', digest('format-character-evidence')]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_attorney_evidence_reference_check',
    });
    const directClient = await freshPool.connect();
    try {
      await directClient.query('BEGIN');
      const normalizedDirect = await directClient.query(
        `INSERT INTO canonical_knowledge_attorney_review_evidence
           (organization_id, entry_id, version_id, snapshot_id, recorded_by_user_id,
            review_reference, evidence_digest, reviewed_at, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(),
                 '2099-01-01T00:00:00.000Z'::timestamptz)
         RETURNING review_reference, recorded_at,
                   abs(extract(epoch FROM (clock_timestamp() - recorded_at))) < 5 AS database_timed`,
        [ORG_A, directLegal.id, directLegal.version.id, directSubmitted.snapshot.id,
          ADMIN_A, '\uFEFF\u00a0Cafe\u0301\u3000', digest('normalized-direct-evidence')]
      );
      expect(normalizedDirect.rows).toEqual([expect.objectContaining({
        review_reference: 'Caf\u00e9', database_timed: true,
      })]);
    } finally {
      await directClient.query('ROLLBACK').catch(() => {});
      directClient.release();
    }
    expect((await freshPool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_knowledge_attorney_review_evidence
           WHERE entry_id = $1) AS evidence,
         (SELECT count(*)::int FROM canonical_knowledge_review_events
           WHERE entry_id = $1 AND action = 'attorney_gated_approved') AS approvals,
         (SELECT count(*)::int FROM canonical_knowledge_publications
           WHERE entry_id = $1) AS publications`,
      [directLegal.id]
    )).rows).toEqual([{ evidence: 0, approvals: 0, publications: 0 }]);

    const unresolved = await repository.createInitialKnowledgeDraft(freshPool, initialDraft(
      'policies.workflow.unresolved', 'high_risk', {
        content: {
          state: 'needs_review', facts: {},
          needsReview: [{ code: 'missing_authoritative_section', path: '/rawProfile/policies' }],
        },
      }
    ));
    const unresolvedSubmitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(unresolved, OWNER_A, 'Submit unresolved evidence for review.')
    );
    await expect(repository.approveKnowledgeVersion(freshPool, workflowTarget(
      unresolved, OWNER_A, 'Do not approve unresolved evidence.', {
        expectedReviewEventId: unresolvedSubmitted.event.id,
      }
    ))).rejects.toMatchObject({ code: 'knowledge_unresolved_evidence', status: 409 });
    expect((await freshPool.query(
      `SELECT action FROM canonical_knowledge_review_events
        WHERE entry_id = $1 ORDER BY event_sequence`,
      [unresolved.id]
    )).rows).toEqual([{ action: 'review_submitted' }]);
  });

  test('database constraints reject bypasses and every workflow authority is immutable', async () => {
    const repository = require('../../src/knowledge/repository');
    const { buildKnowledgeDiff } = require('../../src/knowledge/workflow');
    const base = { keep: 'Cafe\u0301', nested: { old: 1 }, remove: true };
    const target = { keep: 'Caf\u00e9', nested: { next: 2 }, 'a/b~c': true };
    const nodeDiff = buildKnowledgeDiff(base, target);
    expect((await freshPool.query(
      `SELECT jsonb_build_object(
                'operations', public.canonical_knowledge_diff_operations(
                  $1::jsonb, $2::jsonb, '', TRUE
                ),
                'schemaVersion', 1
              ) AS diff`,
      [JSON.stringify(base), JSON.stringify(target)]
    )).rows).toEqual([{ diff: nodeDiff.document }]);

    await expect(freshPool.query(
      `SELECT public.canonical_knowledge_diff_operations(
         '{}'::jsonb, $1::jsonb, '', TRUE
       )`,
      [JSON.stringify({ 'Cafe\u0301': true, 'Caf\u00e9': false })]
    )).rejects.toMatchObject({ code: '22023' });

    const misleading = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.misleading-diff')
    );
    const falseDiff = JSON.stringify({
      operations: [{ op: 'add', path: '', value: { falseClaim: true } }],
      schemaVersion: 1,
    });
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_review_snapshots
         (organization_id, entry_id, version_id, base_version_id, version_digest,
          diff, canonical_diff, diff_digest, submitted_by_user_id, reason)
       VALUES ($1, $2, $3, NULL, $4, $5::text::jsonb, $5::text,
               encode(sha256(convert_to($5::text, 'UTF8')), 'hex'), $6,
               'Reject a misleading but well-hashed diff.')`,
      [ORG_A, misleading.id, misleading.version.id, misleading.version.canonicalDigest,
        falseDiff, OWNER_A]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_review_snapshot_exact_diff',
    });
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_review_snapshots WHERE entry_id = $1',
      [misleading.id]
    )).rows).toEqual([{ count: 0 }]);

    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.database-guard')
    );
    const submitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(created, OWNER_A, 'Submit the database guard fixture.')
    );
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_review_snapshots
         (organization_id, entry_id, version_id, base_version_id, version_digest,
          diff, canonical_diff, diff_digest, submitted_by_user_id, reason)
       SELECT organization_id, entry_id, version_id, base_version_id, version_digest,
              diff, canonical_diff, diff_digest, $2,
              'Reject a direct member workflow write.'
         FROM canonical_knowledge_review_snapshots WHERE id = $1`,
      [submitted.snapshot.id, MEMBER_A]
    )).rejects.toMatchObject({ code: '42501' });
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_publications
         (organization_id, entry_id, version_id, publication_number,
          canonical_digest, review_event_id, previous_publication_id,
          published_by_user_id, reason)
       VALUES ($1, $2, $3, 1, $4, $5, NULL, $6,
               'Reject publication without an exact approval.')`,
      [ORG_A, created.id, created.version.id, created.version.canonicalDigest,
        submitted.event.id, OWNER_A]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_publication_approval_match',
    });
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_review_events
         (organization_id, entry_id, version_id, snapshot_id, event_sequence,
          actor_user_id, action, version_digest, reason, details)
       VALUES ($1, $2, $3, $4, 2, $5, 'high_risk_approved', $6,
               'Reject the wrong approval class.', '{}'::jsonb)`,
      [ORG_A, created.id, created.version.id, submitted.snapshot.id, OWNER_A,
        created.version.canonicalDigest]
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_review_event_approval_class',
    });

    const client = await freshPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO canonical_knowledge_review_events
           (organization_id, entry_id, version_id, snapshot_id, event_sequence,
            actor_user_id, action, version_digest, reason, details)
         VALUES ($1, $2, $3, $4, 2, $5, 'standard_approved', $6,
                 'Reject approval without canonical audit evidence.', '{}'::jsonb)`,
        [ORG_A, created.id, created.version.id, submitted.snapshot.id, OWNER_A,
          created.version.canonicalDigest]
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_knowledge_review_event_audit_required',
      });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    expect((await freshPool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_review_events WHERE entry_id = $1',
      [created.id]
    )).rows).toEqual([{ count: 1 }]);

    for (const statement of [
      `UPDATE canonical_knowledge_review_snapshots SET reason = reason WHERE id = '${submitted.snapshot.id}'`,
      `DELETE FROM canonical_knowledge_review_events WHERE id = '${submitted.event.id}'`,
    ]) {
      await expect(freshPool.query(statement)).rejects.toMatchObject({ code: '55000' });
    }
  });

  test('rejects an orphan direct review snapshot without poisoning normal submission', async () => {
    const repository = require('../../src/knowledge/repository');
    const { buildKnowledgeDiff } = require('../../src/knowledge/workflow');
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.orphan-snapshot')
    );
    const diff = buildKnowledgeDiff(null, created.version.document);
    await expect(freshPool.query(
      `INSERT INTO canonical_knowledge_review_snapshots
         (organization_id, entry_id, version_id, base_version_id, version_digest,
          diff, canonical_diff, diff_digest, submitted_by_user_id, reason)
       VALUES ($1, $2, $3, NULL, $4, $5::text::jsonb, $5::text, $6, $7, $8)`,
      [ORG_A, created.id, created.version.id, created.version.canonicalDigest,
        diff.canonicalDiff, diff.diffDigest, OWNER_A,
        'Do not allow an orphan direct review snapshot.']
    )).rejects.toMatchObject({
      code: '23514', constraint: 'canonical_knowledge_review_snapshot_submission_required',
    });
    expect((await freshPool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_knowledge_review_snapshots
           WHERE entry_id = $1) AS snapshots,
         (SELECT count(*)::int FROM canonical_knowledge_review_events
           WHERE entry_id = $1) AS events`,
      [created.id]
    )).rows).toEqual([{ snapshots: 0, events: 0 }]);

    const submitted = await repository.submitKnowledgeVersionForReview(
      freshPool, workflowTarget(created, OWNER_A, 'Submit after rejecting the orphan snapshot.')
    );
    expect(submitted.event).toMatchObject({ action: 'review_submitted', sequence: 1 });
  });

  test('rejects incomplete and mismatched direct review-submission graphs atomically', async () => {
    const repository = require('../../src/knowledge/repository');
    const { buildKnowledgeDiff } = require('../../src/knowledge/workflow');
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.incomplete-submission')
    );
    const diff = buildKnowledgeDiff(null, created.version.document);
    const snapshotReason = 'Require an exact direct review-submission graph.';

    const incomplete = await freshPool.connect();
    try {
      await incomplete.query('BEGIN');
      const snapshot = (await incomplete.query(
        `INSERT INTO canonical_knowledge_review_snapshots
           (organization_id, entry_id, version_id, base_version_id, version_digest,
            diff, canonical_diff, diff_digest, submitted_by_user_id, reason)
         VALUES ($1, $2, $3, NULL, $4, $5::text::jsonb, $5::text, $6, $7, $8)
         RETURNING id`,
        [ORG_A, created.id, created.version.id, created.version.canonicalDigest,
          diff.canonicalDiff, diff.diffDigest, OWNER_A, snapshotReason]
      )).rows[0];
      await incomplete.query(
        `INSERT INTO canonical_knowledge_review_events
           (organization_id, entry_id, version_id, snapshot_id, event_sequence,
            actor_user_id, action, version_digest, reason, details)
         VALUES ($1, $2, $3, $4, 1, $5, 'review_submitted', $6, $7, $8::jsonb)`,
        [ORG_A, created.id, created.version.id, snapshot.id, OWNER_A,
          created.version.canonicalDigest, snapshotReason, JSON.stringify({
            diffDigest: diff.diffDigest, reviewRequirement: 'standard',
          })]
      );
      await expect(incomplete.query('COMMIT')).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_knowledge_review_snapshot_submission_required',
      });
    } finally {
      await incomplete.query('ROLLBACK').catch(() => {});
      incomplete.release();
    }
    expect((await freshPool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_knowledge_review_snapshots
           WHERE entry_id = $1) AS snapshots,
         (SELECT count(*)::int FROM canonical_knowledge_review_events
           WHERE entry_id = $1) AS events`,
      [created.id]
    )).rows).toEqual([{ snapshots: 0, events: 0 }]);

    const mismatched = await freshPool.connect();
    try {
      await mismatched.query('BEGIN');
      const snapshot = (await mismatched.query(
        `INSERT INTO canonical_knowledge_review_snapshots
           (organization_id, entry_id, version_id, base_version_id, version_digest,
            diff, canonical_diff, diff_digest, submitted_by_user_id, reason)
         VALUES ($1, $2, $3, NULL, $4, $5::text::jsonb, $5::text, $6, $7, $8)
         RETURNING id`,
        [ORG_A, created.id, created.version.id, created.version.canonicalDigest,
          diff.canonicalDiff, diff.diffDigest, OWNER_A, snapshotReason]
      )).rows[0];
      const eventReason = 'A different authorized actor and reason must not bind the snapshot.';
      const event = (await mismatched.query(
        `INSERT INTO canonical_knowledge_review_events
           (organization_id, entry_id, version_id, snapshot_id, event_sequence,
            actor_user_id, action, version_digest, reason, details)
         VALUES ($1, $2, $3, $4, 1, $5, 'review_submitted', $6, $7, $8::jsonb)
         RETURNING id`,
        [ORG_A, created.id, created.version.id, snapshot.id, ADMIN_A,
          created.version.canonicalDigest, eventReason, JSON.stringify({
            diffDigest: diff.diffDigest, reviewRequirement: 'standard',
          })]
      )).rows[0];
      await mismatched.query(
        `INSERT INTO canonical_knowledge_audit_events
           (organization_id, entry_id, version_id, actor_user_id, action, reason, details)
         VALUES ($1, $2, $3, $4, 'review_submitted', $5, $6::jsonb)`,
        [ORG_A, created.id, created.version.id, ADMIN_A, eventReason, JSON.stringify({
          canonicalDigest: created.version.canonicalDigest,
          diffDigest: diff.diffDigest,
          reviewEventId: event.id,
          reviewRequirement: 'standard',
          snapshotId: snapshot.id,
        })]
      );
      await expect(mismatched.query('COMMIT')).rejects.toMatchObject({
        code: '23514', constraint: 'canonical_knowledge_review_snapshot_submission_required',
      });
    } finally {
      await mismatched.query('ROLLBACK').catch(() => {});
      mismatched.release();
    }
    expect((await freshPool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_knowledge_review_snapshots
           WHERE entry_id = $1) AS snapshots,
         (SELECT count(*)::int FROM canonical_knowledge_review_events
           WHERE entry_id = $1) AS events,
         (SELECT count(*)::int FROM canonical_knowledge_audit_events
           WHERE entry_id = $1 AND action = 'review_submitted') AS audits`,
      [created.id]
    )).rows).toEqual([{ snapshots: 0, events: 0, audits: 0 }]);
  });

  test('overwrites direct future workflow and audit times with one database transaction time', async () => {
    const repository = require('../../src/knowledge/repository');
    const { buildKnowledgeDiff } = require('../../src/knowledge/workflow');
    const created = await repository.createInitialKnowledgeDraft(
      freshPool, initialDraft('policies.workflow.database-time')
    );
    const diff = buildKnowledgeDiff(null, created.version.document);
    const future = '2099-12-31T23:59:00.000Z';
    const submissionReason = 'Pin direct workflow time to the database transaction.';
    let snapshotId;
    let submissionEventId;

    const submission = await freshPool.connect();
    try {
      await submission.query('BEGIN');
      snapshotId = (await submission.query(
        `INSERT INTO canonical_knowledge_review_snapshots
           (organization_id, entry_id, version_id, base_version_id, version_digest,
            diff, canonical_diff, diff_digest, submitted_by_user_id, reason, created_at)
         VALUES ($1, $2, $3, NULL, $4, $5::text::jsonb, $5::text, $6, $7, $8,
                 $9::timestamptz)
         RETURNING id`,
        [ORG_A, created.id, created.version.id, created.version.canonicalDigest,
          diff.canonicalDiff, diff.diffDigest, OWNER_A, submissionReason, future]
      )).rows[0].id;
      submissionEventId = (await submission.query(
        `INSERT INTO canonical_knowledge_review_events
           (organization_id, entry_id, version_id, snapshot_id, event_sequence,
            actor_user_id, action, version_digest, reason, details, created_at)
         VALUES ($1, $2, $3, $4, 1, $5, 'review_submitted', $6, $7, $8::jsonb,
                 $9::timestamptz)
         RETURNING id`,
        [ORG_A, created.id, created.version.id, snapshotId, OWNER_A,
          created.version.canonicalDigest, submissionReason, JSON.stringify({
            diffDigest: diff.diffDigest, reviewRequirement: 'standard',
          }), future]
      )).rows[0].id;
      await submission.query(
        `INSERT INTO canonical_knowledge_audit_events
           (organization_id, entry_id, version_id, actor_user_id, action, reason,
            details, created_at)
         VALUES ($1, $2, $3, $4, 'review_submitted', $5, $6::jsonb,
                 $7::timestamptz)`,
        [ORG_A, created.id, created.version.id, OWNER_A, submissionReason, JSON.stringify({
          canonicalDigest: created.version.canonicalDigest,
          diffDigest: diff.diffDigest,
          reviewEventId: submissionEventId,
          reviewRequirement: 'standard',
          snapshotId,
        }), future]
      );
      await submission.query('COMMIT');
    } finally {
      await submission.query('ROLLBACK').catch(() => {});
      submission.release();
    }

    expect((await freshPool.query(
      `SELECT snapshot.created_at = review_event.created_at AS snapshot_event_equal,
              review_event.created_at = audit_event.created_at AS event_audit_equal,
              snapshot.created_at <> $2::timestamptz AS caller_time_rejected,
              abs(extract(epoch FROM (clock_timestamp() - snapshot.created_at))) < 30
                AS database_current
         FROM canonical_knowledge_review_snapshots snapshot
         JOIN canonical_knowledge_review_events review_event
           ON review_event.snapshot_id = snapshot.id AND review_event.event_sequence = 1
         JOIN canonical_knowledge_audit_events audit_event
           ON audit_event.details->>'reviewEventId' = review_event.id::text
        WHERE snapshot.id = $1`,
      [snapshotId, future]
    )).rows).toEqual([{
      snapshot_event_equal: true,
      event_audit_equal: true,
      caller_time_rejected: true,
      database_current: true,
    }]);

    const approved = await repository.approveKnowledgeVersion(freshPool, workflowTarget(
      created, ADMIN_A, 'Approve the database-time fixture.', {
        expectedReviewEventId: submissionEventId,
      }
    ));
    const publicationReason = 'Pin direct publication time to the database transaction.';
    let publicationId;
    const publication = await freshPool.connect();
    try {
      await publication.query('BEGIN');
      publicationId = (await publication.query(
        `INSERT INTO canonical_knowledge_publications
           (organization_id, entry_id, version_id, publication_number,
            canonical_digest, review_event_id, previous_publication_id,
            published_by_user_id, reason, published_at)
         VALUES ($1, $2, $3, 1, $4, $5, NULL, $6, $7, $8::timestamptz)
         RETURNING id`,
        [ORG_A, created.id, created.version.id, created.version.canonicalDigest,
          approved.event.id, OWNER_A, publicationReason, future]
      )).rows[0].id;
      await publication.query(
        `INSERT INTO canonical_knowledge_audit_events
           (organization_id, entry_id, version_id, actor_user_id, action, reason,
            details, created_at)
         VALUES ($1, $2, $3, $4, 'version_published', $5, $6::jsonb,
                 $7::timestamptz)`,
        [ORG_A, created.id, created.version.id, OWNER_A, publicationReason, JSON.stringify({
          canonicalDigest: created.version.canonicalDigest,
          publicationId,
          publicationNumber: 1,
          reviewEventId: approved.event.id,
        }), future]
      );
      await publication.query('COMMIT');
    } finally {
      await publication.query('ROLLBACK').catch(() => {});
      publication.release();
    }
    expect((await freshPool.query(
      `SELECT publication.published_at = audit_event.created_at AS publication_audit_equal,
              publication.published_at <> $2::timestamptz AS caller_time_rejected,
              abs(extract(epoch FROM (clock_timestamp() - publication.published_at))) < 30
                AS database_current
         FROM canonical_knowledge_publications publication
         JOIN canonical_knowledge_audit_events audit_event
           ON audit_event.details->>'publicationId' = publication.id::text
        WHERE publication.id = $1`,
      [publicationId, future]
    )).rows).toEqual([{
      publication_audit_equal: true,
      caller_time_rejected: true,
      database_current: true,
    }]);
  });

  test('migration bytes are LF canonical, checksum-recorded and idempotent', async () => {
    const bytes = fs.readFileSync(path.join(MIGRATIONS, WORKFLOW_MIGRATION));
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes.at(-1)).toBe(0x0a);
    const migration = db.loadMigrations(MIGRATIONS).find(item => item.file === WORKFLOW_MIGRATION);
    expect(digest(bytes.toString('utf8'))).toBe(migration.digest);
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: part3Directory })).toBe(true);
    expect((await freshPool.query(
      'SELECT trim(checksum) AS checksum FROM _migrations WHERE filename = $1',
      [WORKFLOW_MIGRATION]
    )).rows).toEqual([{ checksum: migration.digest }]);
  });
});
