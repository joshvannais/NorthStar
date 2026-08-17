'use strict';

const express = require('express');
const request = require('supertest');
const { createHomepageDemoRouter } = require('../../src/routes/homepageDemo');

const ORIGIN = 'http://northstar.test';

function build(options = {}) {
  const calls = [];
  const service = options.service || {
    availability: () => ({ available: true, storageRequirement: 'basic_attributes_only', retentionRequirementDays: 1 }),
    create: jest.fn(async industry => ({ callId: 'call_1', accessToken: 'token', purgeToken: 'purge', industry })),
    projectPolaris: jest.fn(() => ({ contract: 'NorthStarHomepageCanonicalPolaris/v1' })),
    verifyPolarisAuthority: jest.fn(() => ({
      callId: 'call_1',
      capabilityHash: 'b'.repeat(64),
      verifiedPurge: {
        verifiedAt: Date.parse('2026-08-16T12:05:00.000Z'),
        expiresAt: Date.parse('2026-08-16T12:07:00.000Z'),
      },
    })),
    verifyCallAuthority: jest.fn(() => ({
      callId: 'call_1',
      capabilityHash: 'b'.repeat(64),
      expiresAt: Date.parse('2026-08-16T12:15:00.000Z'),
    })),
    verifiedPurgeReceipt: jest.fn((_callId, _purgeToken, _verifiedAt, projectionPermitted) => Object.assign({
      providerDeletionVerified: true,
      northstarPurged: true,
      retainedContent: false,
    }, projectionPermitted === true ? { verifiedPurgeReceipt: 'verified-purge-receipt' } : {})),
    purge: jest.fn(async () => ({ providerDeletionVerified: true, northstarPurged: true, retainedContent: false })),
  };
  const admission = options.admission || {
    admit: jest.fn(async hash => { calls.push(hash); }),
    admitProjection: jest.fn(async hash => { calls.push(hash); }),
    consumeVerifiedPurgeProjection: jest.fn(async hash => { calls.push(hash); }),
    beginVerifiedPurgeProjection: jest.fn(async hash => { calls.push(hash); }),
    canIssueVerifiedPurgeReceipt: jest.fn(async () => true),
    beginPurge: jest.fn(async (hash, _capability, _expiresAt, projectionRequested) => {
      calls.push(hash);
      return {
        execute: true,
        verified: false,
        attemptCount: 1,
        projectionPermitted: projectionRequested === true,
      };
    }),
    completePurge: jest.fn(async () => ({
      verified: true,
      consumed: false,
      verifiedAt: Date.parse('2026-08-16T12:05:00.000Z'),
      projectionPermitted: true,
    })),
    releasePurge: jest.fn(async () => true),
  };
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/demo/homepage', createHomepageDemoRouter({
    service,
    admission,
    sourceHash: () => 'a'.repeat(64),
  }));
  return { app, service, admission, calls };
}

function mutation(agent, method, path, intent, body) {
  return agent[method](path)
    .set('Host', 'northstar.test')
    .set('Origin', ORIGIN)
    .set('Sec-Fetch-Site', 'same-origin')
    .set('X-NorthStar-Demo-Intent', intent)
    .send(body);
}

describe('Homepage demo route contract', () => {
  test('status is no-store and reports browser-memory-only result semantics', async () => {
    const { app } = build();
    const response = await request(app).get('/api/demo/homepage/status').set('Host', 'northstar.test').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      transcriptPersistence: 'none',
      resultPersistence: 'browser-memory-only',
      providerActivationChanged: false,
    }));
  });

  test('create requires exact same-origin intent and checked consent before admission', async () => {
    const { app, service, admission } = build();
    await request(app).post('/api/demo/homepage/web-call')
      .set('Host', 'northstar.test')
      .set('X-NorthStar-Demo-Intent', 'start-homepage-web-call')
      .send({ consentAcknowledged: true, industry: 'Roofing' })
      .expect(403);
    expect(admission.admit).not.toHaveBeenCalled();

    await mutation(request(app), 'post', '/api/demo/homepage/web-call', 'start-homepage-web-call', {
      consentAcknowledged: false,
      industry: 'Roofing',
    }).expect(422);
    expect(admission.admit).not.toHaveBeenCalled();

    const created = await mutation(request(app), 'post', '/api/demo/homepage/web-call', 'start-homepage-web-call', {
      consentAcknowledged: true,
      industry: 'Roofing',
    }).expect(201);
    expect(created.body.data).toEqual(expect.objectContaining({ callId: 'call_1', accessToken: 'token' }));
    expect(admission.admit).toHaveBeenCalledWith('a'.repeat(64));
    expect(service.create).toHaveBeenCalledWith('Roofing');
  });

  test('exact bodies reject browser business identity and other unexpected content', async () => {
    const { app, service, admission } = build();
    await mutation(request(app), 'post', '/api/demo/homepage/web-call', 'start-homepage-web-call', {
      consentAcknowledged: true,
      industry: 'Roofing',
      businessName: 'Must stay in browser',
    }).expect(422);
    expect(service.create).not.toHaveBeenCalled();
  });

  test('Polaris projection and verified deletion use signed temporary authority', async () => {
    const { app, service, admission } = build();
    const transcript = [{ speaker: 'customer', text: 'A fictional 2000 square foot roof.' }];
    const deleted = await mutation(request(app), 'delete', '/api/demo/homepage/web-call/call_1', 'delete-homepage-web-call', {
      projectionRequested: true,
      purgeToken: 'purge',
    }).expect(200);
    expect(deleted.body.data).toEqual({
      providerDeletionVerified: true,
      northstarPurged: true,
      retainedContent: false,
      verifiedPurgeReceipt: 'verified-purge-receipt',
    });
    expect(service.verifyCallAuthority).toHaveBeenCalledWith('call_1', 'purge');
    expect(admission.beginPurge).toHaveBeenCalledWith(
      'a'.repeat(64),
      'b'.repeat(64),
      Date.parse('2026-08-16T12:15:00.000Z'),
      true
    );
    expect(service.purge).toHaveBeenCalledWith('call_1', 'purge');
    expect(admission.completePurge).toHaveBeenCalledWith('b'.repeat(64), 1);
    expect(admission.canIssueVerifiedPurgeReceipt).toHaveBeenCalledWith(
      'b'.repeat(64),
      Date.parse('2026-08-16T12:05:00.000Z')
    );
    expect(service.verifyCallAuthority.mock.invocationCallOrder.at(-1))
      .toBeLessThan(admission.beginPurge.mock.invocationCallOrder[0]);
    expect(admission.beginPurge.mock.invocationCallOrder[0])
      .toBeLessThan(service.purge.mock.invocationCallOrder[0]);
    expect(service.purge.mock.invocationCallOrder[0])
      .toBeLessThan(admission.completePurge.mock.invocationCallOrder[0]);

    const projected = await mutation(request(app), 'post', '/api/demo/homepage/polaris/call_1', 'calculate-homepage-polaris', {
      callDurationSeconds: 30,
      industry: 'Roofing',
      purgeToken: 'purge',
      transcript,
      verifiedPurgeReceipt: deleted.body.data.verifiedPurgeReceipt,
    }).expect(200);
    expect(projected.body.data.contract).toBe('NorthStarHomepageCanonicalPolaris/v1');
    expect(service.verifyPolarisAuthority).toHaveBeenCalledWith(
      'call_1', 'purge', 'verified-purge-receipt'
    );
    expect(admission.consumeVerifiedPurgeProjection).toHaveBeenCalledWith(
      'a'.repeat(64),
      'b'.repeat(64),
      Date.parse('2026-08-16T12:05:00.000Z'),
      Date.parse('2026-08-16T12:07:00.000Z')
    );
    expect(admission.beginVerifiedPurgeProjection).toHaveBeenCalledWith(
      'b'.repeat(64),
      Date.parse('2026-08-16T12:05:00.000Z'),
      Date.parse('2026-08-16T12:07:00.000Z')
    );
    expect(service.projectPolaris).toHaveBeenCalledWith(
      'call_1', 'purge', 'verified-purge-receipt', 'Roofing', transcript, 30
    );
    expect(admission.completePurge.mock.invocationCallOrder[0])
      .toBeLessThan(service.verifyPolarisAuthority.mock.invocationCallOrder[0]);
    expect(admission.consumeVerifiedPurgeProjection.mock.invocationCallOrder[0])
      .toBeLessThan(admission.beginVerifiedPurgeProjection.mock.invocationCallOrder[0]);
    expect(admission.beginVerifiedPurgeProjection.mock.invocationCallOrder[0])
      .toBeLessThan(service.projectPolaris.mock.invocationCallOrder[0]);
  });

  test('Polaris fails closed when cancellation wins after receipt consumption', async () => {
    const cancellationWon = Object.assign(new Error('Verified deletion is required.'), {
      status: 403,
      code: 'homepage_verified_purge_required',
    });
    const { app, service, admission } = build();
    admission.beginVerifiedPurgeProjection.mockRejectedValueOnce(cancellationWon);
    const response = await mutation(
      request(app),
      'post',
      '/api/demo/homepage/polaris/call_1',
      'calculate-homepage-polaris',
      {
        callDurationSeconds: 30,
        industry: 'Roofing',
        purgeToken: 'purge',
        transcript: [{ speaker: 'customer', text: 'A fictional roof.' }],
        verifiedPurgeReceipt: 'verified-purge-receipt',
      }
    ).expect(403);
    expect(response.body.error.code).toBe('homepage_verified_purge_required');
    expect(admission.consumeVerifiedPurgeProjection).toHaveBeenCalledTimes(1);
    expect(admission.beginVerifiedPurgeProjection).toHaveBeenCalledTimes(1);
    expect(service.projectPolaris).not.toHaveBeenCalled();
  });

  test('verified deletion replay returns the cached receipt without quota or provider work', async () => {
    const admission = {
      admit: jest.fn(),
      admitProjection: jest.fn(),
      beginPurge: jest.fn(async () => ({
        execute: false,
        verified: true,
        consumed: false,
        attemptCount: 1,
        verifiedAt: Date.parse('2026-08-16T12:05:00.000Z'),
        projectionPermitted: true,
      })),
      canIssueVerifiedPurgeReceipt: jest.fn(async () => true),
      completePurge: jest.fn(),
      releasePurge: jest.fn(),
    };
    const { app, service } = build({ admission });
    const deleted = await mutation(
      request(app),
      'delete',
      '/api/demo/homepage/web-call/call_1',
      'delete-homepage-web-call',
      { projectionRequested: true, purgeToken: 'purge' }
    ).expect(200);
    expect(deleted.body.data).toEqual({
      providerDeletionVerified: true,
      northstarPurged: true,
      retainedContent: false,
      verifiedPurgeReceipt: 'verified-purge-receipt',
    });
    expect(service.verifiedPurgeReceipt).toHaveBeenCalledTimes(1);
    expect(service.purge).not.toHaveBeenCalled();
    expect(admission.completePurge).not.toHaveBeenCalled();
    expect(admission.releasePurge).not.toHaveBeenCalled();
  });

  test('receipt issuance rechecks durable cancellation after purge completion', async () => {
    const admission = {
      admit: jest.fn(),
      consumeVerifiedPurgeProjection: jest.fn(),
      beginPurge: jest.fn(async () => ({
        execute: true,
        verified: false,
        attemptCount: 1,
        projectionPermitted: true,
      })),
      completePurge: jest.fn(async () => ({
        verified: true,
        consumed: false,
        verifiedAt: Date.parse('2026-08-16T12:05:00.000Z'),
        projectionPermitted: true,
      })),
      canIssueVerifiedPurgeReceipt: jest.fn(async () => false),
      releasePurge: jest.fn(),
    };
    const { app, service } = build({ admission });
    const deleted = await mutation(
      request(app),
      'delete',
      '/api/demo/homepage/web-call/call_1',
      'delete-homepage-web-call',
      { projectionRequested: true, purgeToken: 'purge' }
    ).expect(200);
    expect(deleted.body.data).toEqual({
      providerDeletionVerified: true,
      northstarPurged: true,
      retainedContent: false,
    });
    expect(admission.canIssueVerifiedPurgeReceipt).toHaveBeenCalledWith(
      'b'.repeat(64),
      Date.parse('2026-08-16T12:05:00.000Z')
    );
    expect(service.verifiedPurgeReceipt).toHaveBeenCalledWith(
      'call_1',
      'purge',
      Date.parse('2026-08-16T12:05:00.000Z'),
      false
    );
    expect(admission.completePurge.mock.invocationCallOrder[0])
      .toBeLessThan(admission.canIssueVerifiedPurgeReceipt.mock.invocationCallOrder[0]);
    expect(admission.canIssueVerifiedPurgeReceipt.mock.invocationCallOrder[0])
      .toBeLessThan(service.verifiedPurgeReceipt.mock.invocationCallOrder[0]);
  });

  test('failed provider deletion releases only its durable capability lease for bounded retry', async () => {
    const providerError = Object.assign(new Error('provider deletion unavailable'), {
      status: 503,
      code: 'homepage_provider_deletion_unverified',
    });
    const { app, service, admission } = build();
    service.purge.mockRejectedValueOnce(providerError);
    const response = await mutation(
      request(app),
      'delete',
      '/api/demo/homepage/web-call/call_1',
      'delete-homepage-web-call',
      { projectionRequested: true, purgeToken: 'purge' }
    ).expect(503);
    expect(response.body.error.code).toBe('homepage_provider_deletion_unverified');
    expect(admission.releasePurge).toHaveBeenCalledWith('b'.repeat(64), 1);
    expect(admission.completePurge).not.toHaveBeenCalled();
  });

  test('failed durable completion is fail-closed and releases the capability lease', async () => {
    const completionError = Object.assign(new Error('completion unavailable'), {
      status: 503,
      code: 'homepage_admission_unavailable',
    });
    const { app, admission } = build();
    admission.completePurge.mockRejectedValueOnce(completionError);
    const response = await mutation(
      request(app),
      'delete',
      '/api/demo/homepage/web-call/call_1',
      'delete-homepage-web-call',
      { projectionRequested: true, purgeToken: 'purge' }
    ).expect(503);
    expect(response.body.error.code).toBe('homepage_admission_unavailable');
    expect(admission.releasePurge).toHaveBeenCalledWith('b'.repeat(64), 1);
  });

  test('deletion rejects invalid origin and body before purge admission', async () => {
    const { app, service, admission } = build();
    await request(app).delete('/api/demo/homepage/web-call/call_1')
      .set('Host', 'northstar.test')
      .set('X-NorthStar-Demo-Intent', 'delete-homepage-web-call')
      .send({ projectionRequested: false, purgeToken: 'purge' })
      .expect(403);
    await mutation(request(app), 'delete', '/api/demo/homepage/web-call/call_1', 'delete-homepage-web-call', {
      projectionRequested: false,
      purgeToken: 'purge',
      extra: true,
    }).expect(422);
    expect(service.verifyCallAuthority).not.toHaveBeenCalled();
    expect(admission.beginPurge).not.toHaveBeenCalled();
    expect(service.purge).not.toHaveBeenCalled();
  });

  test('invalid signed projection authority is rejected before projection admission', async () => {
    const verificationError = Object.assign(new Error('The temporary projection authority is invalid.'), {
      status: 403,
      code: 'homepage_purge_authority_invalid',
    });
    const service = {
      availability: () => ({ available: true }),
      verifyPolarisAuthority: jest.fn(() => { throw verificationError; }),
      projectPolaris: jest.fn(),
      purge: jest.fn(),
    };
    const { app, admission } = build({ service });
    const response = await mutation(
      request(app),
      'post',
      '/api/demo/homepage/polaris/call_1',
      'calculate-homepage-polaris',
      {
        callDurationSeconds: 30,
        industry: 'Roofing',
        purgeToken: 'invalid',
        transcript: [{ speaker: 'customer', text: 'A fictional roof.' }],
        verifiedPurgeReceipt: 'invalid-receipt',
      }
    ).expect(403);
    expect(response.body.error.code).toBe('homepage_purge_authority_invalid');
    expect(admission.consumeVerifiedPurgeProjection).not.toHaveBeenCalled();
    expect(service.projectPolaris).not.toHaveBeenCalled();
  });

  test('Polaris fails closed before verified deletion and never reaches calculation', async () => {
    const missingDeletion = Object.assign(new Error('Verified deletion is required.'), {
      status: 403,
      code: 'homepage_verified_purge_required',
    });
    const admission = {
      admit: jest.fn(),
      admitProjection: jest.fn(),
      consumeVerifiedPurgeProjection: jest.fn(async () => { throw missingDeletion; }),
      beginPurge: jest.fn(),
      completePurge: jest.fn(),
      releasePurge: jest.fn(),
    };
    const { app, service } = build({ admission });
    const response = await mutation(
      request(app),
      'post',
      '/api/demo/homepage/polaris/call_1',
      'calculate-homepage-polaris',
      {
        callDurationSeconds: 30,
        industry: 'Roofing',
        purgeToken: 'purge',
        transcript: [{ speaker: 'customer', text: 'A fictional roof.' }],
        verifiedPurgeReceipt: 'signed-but-not-durably-verified',
      }
    ).expect(403);
    expect(response.body.error.code).toBe('homepage_verified_purge_required');
    expect(admission.consumeVerifiedPurgeProjection).toHaveBeenCalledTimes(1);
    expect(service.projectPolaris).not.toHaveBeenCalled();
  });

  test('invalid signed deletion authority is rejected before purge admission', async () => {
    const verificationError = Object.assign(new Error('The temporary deletion authority is invalid.'), {
      status: 403,
      code: 'homepage_purge_authority_invalid',
    });
    const service = {
      availability: () => ({ available: true }),
      verifyCallAuthority: jest.fn(() => { throw verificationError; }),
      purge: jest.fn(),
    };
    const { app, admission } = build({ service });
    const response = await mutation(
      request(app),
      'delete',
      '/api/demo/homepage/web-call/call_1',
      'delete-homepage-web-call',
      { projectionRequested: false, purgeToken: 'invalid' }
    ).expect(403);
    expect(response.body.error.code).toBe('homepage_purge_authority_invalid');
    expect(admission.beginPurge).not.toHaveBeenCalled();
    expect(service.purge).not.toHaveBeenCalled();
  });
});
