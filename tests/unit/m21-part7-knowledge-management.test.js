'use strict';

const express = require('express');
const request = require('supertest');
const {
  applyFilters,
  buildRelationshipGraphPolicy,
  correctionFor,
  cursorContextDigest,
  decodeListCursor,
  encodeListCursor,
  normalizeFilters,
  normalizePagination,
  syncPresentation,
  workflowState,
} = require('../../src/knowledge/managementRepository');
const { createKnowledgeManagementRouter, exactBody } = require('../../src/routes/knowledgeManagement');

const ORG = '10000000-0000-4000-8000-000000000001';
const USER = '20000000-0000-4000-8000-000000000001';
const ENTRY = '30000000-0000-4000-8000-000000000001';
const VERSION = '40000000-0000-4000-8000-000000000001';
const REVIEW = '50000000-0000-4000-8000-000000000001';
const TARGET = '60000000-0000-4000-8000-000000000001';
const DIGEST = 'a'.repeat(64);

function passContext(req, _res, next) {
  req.tenantContext = { organizationId: ORG, userId: USER, role: 'owner' };
  req.user = { id: USER };
  req.userRole = 'owner';
  req.orgId = ORG;
  next();
}

function appFor(options) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/knowledge-management', createKnowledgeManagementRouter({
    tenantAccess: passContext,
    accountMutation: passContext,
    settingsRead: (_req, _res, next) => next(),
    settingsWrite: (_req, _res, next) => next(),
    poolProvider: () => ({ marker: 'pool' }),
    ...options,
  }));
  return app;
}

describe('Mission 21 Part 7 knowledge-management contract helpers', () => {
  test('normalizes exact supported filters and rejects unknown or malformed values', () => {
    expect(normalizeFilters({ category: 'GUIDANCE', workflowStatus: 'review', applicability: 'voice_runtime' }))
      .toEqual({ search: null, category: 'guidance', workflowStatus: 'review', sensitivity: null,
        source: null, applicability: 'voice_runtime' });
    expect(normalizeFilters({ search: '  SAFETY Guide  ' }).search).toBe('safety guide');
    expect(() => normalizeFilters({ sensitivity: 'secret' })).toThrow(/not supported/);
    expect(() => normalizeFilters({ applicability: 'customer%27 OR true' })).toThrow(/not supported/);
    expect(() => normalizeFilters({ search: 'x'.repeat(129) })).toThrow(/not supported/);
  });

  test('filters applicability by exact recursively stored token and never by substring', () => {
    const items = [{
      category: 'guidance', workflowStatus: 'published', sources: ['business_profile'],
      version: { sensitivity: 'internal', applicability: { projection: { audiences: ['customer_support'] } } },
    }, {
      category: 'guidance', workflowStatus: 'published', sources: ['business_profile'],
      version: { sensitivity: 'internal', applicability: { projection: { audiences: ['customer'] } } },
    }];
    expect(applyFilters(items, normalizeFilters({ applicability: 'customer' }))).toEqual([items[1]]);
  });

  test('normalizes a bounded opaque list cursor and rejects forged or oversized pagination', () => {
    const issuedAt = Date.now();
    const contextDigest = 'b'.repeat(64);
    const encoded = encodeListCursor({ label: 'Label', canonical_key: 'organization.identity', entry_id: ENTRY }, {
      contextDigest, issuedAt, snapshot: '100:200:150',
    });
    expect(normalizePagination({ limit: '37', cursor: encoded })).toEqual({
      limit: 37,
      cursor: { contextDigest, issuedAt, snapshot: '100:200:150',
        label: 'Label', canonicalKey: 'organization.identity', entryId: ENTRY },
    });
    expect(decodeListCursor(encoded).entryId).toBe(ENTRY);
    const forged = `${encoded.slice(0, -1)}${encoded.endsWith('0') ? '1' : '0'}`;
    expect(() => normalizePagination({ limit: 201 })).toThrow(/1 to 200/);
    expect(() => normalizePagination({ cursor: 'not-valid!' })).toThrow(/valid knowledge-list cursor/);
    expect(() => normalizePagination({ cursor: forged })).toThrow(/valid knowledge-list cursor/);
    expect(() => normalizePagination({ cursor: `${'a'.repeat(4097)}.${'b'.repeat(64)}` }))
      .toThrow(/valid knowledge-list cursor/);
  });

  test('binds cursor context to tenant actor membership role filters ordering and limit', () => {
    const input = {
      organizationId: ORG, actorUserId: USER, membershipId: '70000000-0000-4000-8000-000000000001',
      role: 'member', canReadProtected: false, filters: normalizeFilters({ search: 'safety', category: 'guidance' }),
      limit: 50,
    };
    const baseline = cursorContextDigest(input);
    for (const changed of [
      { organizationId: '10000000-0000-4000-8000-000000000002' },
      { actorUserId: '20000000-0000-4000-8000-000000000002' },
      { membershipId: '70000000-0000-4000-8000-000000000002' },
      { role: 'admin', canReadProtected: true },
      { filters: normalizeFilters({ search: 'safety', category: 'fact' }) },
      { limit: 51 },
    ]) expect(cursorContextDigest({ ...input, ...changed })).not.toBe(baseline);
  });

  test('relationship graph fails closed for protected, transitive, cyclic, missing and mismatched targets', () => {
    const readable = { organization_id: ORG, id: VERSION, version_number: 1,
      canonical_digest: '1'.repeat(64), sensitivity: 'internal', review_requirement: 'standard' };
    const protectedTarget = { organization_id: ORG, id: '41000000-0000-4000-8000-000000000001', version_number: 2,
      canonical_digest: '2'.repeat(64), sensitivity: 'restricted', review_requirement: 'high_risk' };
    const source = (versionId, ordinal, target, overrides = {}) => ({
      version_id: versionId, ordinal, source_type: 'knowledge_version', source_record_id: target.id,
      source_version: String(target.version_number), source_digest: target.canonical_digest,
      json_pointer: `/versions/${target.id}`, ...overrides,
    });
    const direct = source(readable.id, 1, protectedTarget);
    const missing = source(readable.id, 2, { ...protectedTarget, id: '42000000-0000-4000-8000-000000000001' });
    const mismatch = source(readable.id, 3, protectedTarget, { source_digest: '3'.repeat(64) });
    const transitiveTarget = { ...readable, id: '43000000-0000-4000-8000-000000000001',
      canonical_digest: '4'.repeat(64) };
    const transitive = source(readable.id, 4, transitiveTarget);
    const transitiveChild = source(transitiveTarget.id, 1, protectedTarget);
    const cycleA = { ...readable, id: '44000000-0000-4000-8000-000000000001', canonical_digest: '5'.repeat(64) };
    const cycleB = { ...readable, id: '45000000-0000-4000-8000-000000000001', canonical_digest: '6'.repeat(64) };
    const cycleRoot = source(readable.id, 5, cycleA);
    const cycleForward = source(cycleA.id, 1, cycleB);
    const cycleBack = source(cycleB.id, 1, cycleA);
    const graph = buildRelationshipGraphPolicy({
      organizationId: ORG, canReadProtected: false,
      versionRows: [readable, protectedTarget, transitiveTarget, cycleA, cycleB],
      candidateRows: [readable, protectedTarget, transitiveTarget, cycleA, cycleB],
      provenanceRows: [direct, missing, mismatch, transitive, transitiveChild, cycleRoot, cycleForward, cycleBack],
    });
    expect(graph.restrictedProvenanceKeys).toEqual(new Set([
      `${readable.id}:1`, `${readable.id}:2`, `${readable.id}:3`, `${readable.id}:4`,
      `${transitiveTarget.id}:1`, `${readable.id}:5`, `${cycleA.id}:1`, `${cycleB.id}:1`,
    ]));
    const owner = buildRelationshipGraphPolicy({
      organizationId: ORG, canReadProtected: true, versionRows: [readable, protectedTarget],
      candidateRows: [readable, protectedTarget], provenanceRows: [direct, missing],
    });
    expect(owner.restrictedProvenanceKeys).toEqual(new Set([`${readable.id}:2`]));
  });

  test.each([
    ['in_sync', 'current'], ['pending', 'pending'], ['stale', 'stale'], ['drift', 'drifted'],
    ['retry', 'retrying'], ['dead', 'dead'], ['suspended', 'suspended'], ['blocked', 'reconciliation_needed'],
  ])('maps canonical synchronization %s truth to non-ambiguous %s presentation', (canonical, presentation) => {
    expect(syncPresentation(canonical)).toBe(presentation);
  });

  test('workflow state pins latest exact publication then approval then review', () => {
    expect(workflowState({ version_id: VERSION, publication_version_id: VERSION })).toBe('published');
    expect(workflowState({ version_id: VERSION, publication_version_id: null, review_action: 'high_risk_approved' })).toBe('approved');
    expect(workflowState({ version_id: VERSION, publication_version_id: null, review_action: 'review_submitted' })).toBe('review');
    expect(workflowState({ version_id: VERSION, publication_version_id: null, review_action: 'changes_requested' })).toBe('draft');
  });

  test('source corrections deep-link to existing Business Profile authority sections', () => {
    expect(correctionFor('generated.financial_constraints', ['business_profile']).url)
      .toBe('/dashboard/business-profile?section=financial#financialConfigurationHeading');
    expect(correctionFor('generated.operational_capabilities', ['asset_catalogue']).url)
      .toBe('/dashboard/business-profile?section=crew#section-crew');
    expect(correctionFor('generated.voice_guidance', ['business_profile']).url)
      .toBe('/dashboard/business-profile?section=retell#voice-assistant-configuration');
  });

  test('exactBody rejects missing and unexpected mutation authority', () => {
    expect(exactBody({ reason: 'review' }, ['reason'])).toBe(true);
    expect(exactBody({ reason: 'review', organizationId: ORG }, ['reason'])).toBe(false);
    expect(exactBody({}, ['reason'])).toBe(false);
  });
});

describe('Mission 21 Part 7 mounted HTTP controller', () => {
  test('list binds organization and actor from trusted session context', async () => {
    const list = jest.fn().mockResolvedValue({ items: [], counts: { total: 0 }, filteredCount: 0 });
    const response = await request(appFor({ list }))
      .get('/api/v1/knowledge-management?search=safety&category=guidance&limit=25&cursor=opaque');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(list).toHaveBeenCalledWith({ marker: 'pool' }, expect.objectContaining({
      organizationId: ORG,
      actorUserId: USER,
      filters: expect.objectContaining({ search: 'safety', category: 'guidance' }),
      pagination: { cursor: 'opaque', limit: '25' },
    }));
  });

  test('detail binds exact route entry and optional version', async () => {
    const item = jest.fn().mockResolvedValue({ entry: { id: ENTRY }, version: { id: VERSION, number: 2 } });
    const response = await request(appFor({ item }))
      .get(`/api/v1/knowledge-management/items/${ENTRY}?versionNumber=2`);
    expect(response.status).toBe(200);
    expect(item).toHaveBeenCalledWith({ marker: 'pool' }, {
      organizationId: ORG, actorUserId: USER, entryId: ENTRY, versionNumber: '2',
    });
  });

  test('review mutation ignores no request identity and carries every exact stale-write pin', async () => {
    const review = jest.fn().mockResolvedValue({ event: { id: REVIEW } });
    const body = {
      versionId: VERSION, versionNumber: 2, canonicalDigest: DIGEST,
      expectedReviewEventId: null, reason: 'Review exact generated evidence.',
    };
    const response = await request(appFor({ review }))
      .post(`/api/v1/knowledge-management/items/${ENTRY}/review`).send(body);
    expect(response.status).toBe(201);
    expect(review).toHaveBeenCalledWith({ marker: 'pool' }, {
      ...body, organizationId: ORG, actorUserId: USER, entryId: ENTRY,
    });
  });

  test('publish requires the exact publication base and rejects smuggled tenant identity', async () => {
    const publish = jest.fn();
    const body = {
      versionId: VERSION, versionNumber: 2, canonicalDigest: DIGEST,
      expectedReviewEventId: REVIEW, expectedPublicationId: null,
      expectedPublicationNumber: 0, reason: 'Publish exact approved evidence.', organizationId: ORG,
    };
    const response = await request(appFor({ publish }))
      .post(`/api/v1/knowledge-management/items/${ENTRY}/publish`).send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('knowledge_management_invalid_request');
    expect(publish).not.toHaveBeenCalled();
  });

  test('generated revisions fail closed with an authoritative Business Profile correction', async () => {
    const revise = jest.fn();
    const item = jest.fn().mockResolvedValue({
      version: { id: VERSION, number: 2, canonicalDigest: DIGEST },
      permissions: { canReviseDirectly: false },
      sourceCorrection: { url: '/dashboard/business-profile?section=retell#voice-assistant-configuration' },
    });
    const response = await request(appFor({ revise, item }))
      .post(`/api/v1/knowledge-management/items/${ENTRY}/revise`).send({
        expectedVersionId: VERSION, expectedVersionNumber: 2, expectedCanonicalDigest: DIGEST,
        reason: 'Attempt correction.', canonicalKey: 'generated.voice_guidance', entryType: 'guidance',
        label: 'Voice guidance', sensitivity: 'internal', reviewRequirement: 'standard',
        applicability: {}, content: { state: 'ready' }, provenance: [{ sourceType: 'human_input' }], origin: 'human',
      });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('knowledge_source_correction_required');
    expect(response.body.error.details.correction.url).toContain('/dashboard/business-profile');
    expect(revise).not.toHaveBeenCalled();
  });

  test.each(['reconcile', 'retry'])('%s pins exact synchronization target authority without transport', async action => {
    const reconcileTarget = jest.fn().mockResolvedValue({ id: 'event' });
    const response = await request(appFor({ synchronizationFactory: () => ({ reconcileTarget }) }))
      .post(`/api/v1/knowledge-management/synchronization/${TARGET}/${action}`)
      .send({ expectedTargetRevision: 4, expectedConfigurationDigest: DIGEST });
    expect(response.status).toBe(201);
    expect(reconcileTarget).toHaveBeenCalledWith({
      organizationId: ORG, actorUserId: USER, targetId: TARGET,
      expectedTargetRevision: 4, expectedConfigurationDigest: DIGEST,
    });
  });
});
