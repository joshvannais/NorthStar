'use strict';

const express = require('express');
const request = require('supertest');
const {
  applyFilters,
  correctionFor,
  decodeListCursor,
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
      .toEqual({ category: 'guidance', workflowStatus: 'review', sensitivity: null, source: null, applicability: 'voice_runtime' });
    expect(() => normalizeFilters({ sensitivity: 'secret' })).toThrow(/not supported/);
    expect(() => normalizeFilters({ applicability: 'customer%27 OR true' })).toThrow(/not supported/);
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
    const encoded = Buffer.from(JSON.stringify([
      'Label', 'organization.identity', ENTRY,
    ]), 'utf8').toString('base64url');
    expect(normalizePagination({ limit: '37', cursor: encoded })).toEqual({
      limit: 37,
      cursor: { label: 'Label', canonicalKey: 'organization.identity', entryId: ENTRY },
    });
    expect(decodeListCursor(encoded).entryId).toBe(ENTRY);
    expect(() => normalizePagination({ limit: 201 })).toThrow(/1 to 200/);
    expect(() => normalizePagination({ cursor: 'not-valid!' })).toThrow(/valid knowledge-list cursor/);
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
    const response = await request(appFor({ list })).get('/api/v1/knowledge-management?category=guidance&limit=25&cursor=opaque');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(list).toHaveBeenCalledWith({ marker: 'pool' }, expect.objectContaining({
      organizationId: ORG,
      actorUserId: USER,
      filters: expect.objectContaining({ category: 'guidance' }),
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
