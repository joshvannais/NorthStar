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
    verifyCallAuthority: jest.fn(() => ({ callId: 'call_1' })),
    purge: jest.fn(async () => ({ providerDeletionVerified: true, northstarPurged: true, retainedContent: false })),
  };
  const admission = options.admission || {
    admit: jest.fn(async hash => { calls.push(hash); }),
    admitProjection: jest.fn(async hash => { calls.push(hash); }),
    admitPurge: jest.fn(async hash => { calls.push(hash); }),
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
    const projected = await mutation(request(app), 'post', '/api/demo/homepage/polaris/call_1', 'calculate-homepage-polaris', {
      callDurationSeconds: 30,
      industry: 'Roofing',
      purgeToken: 'purge',
      transcript,
    }).expect(200);
    expect(projected.body.data.contract).toBe('NorthStarHomepageCanonicalPolaris/v1');
    expect(admission.admitProjection).toHaveBeenCalledWith('a'.repeat(64));
    expect(service.projectPolaris).toHaveBeenCalledWith('call_1', 'purge', 'Roofing', transcript, 30);

    const deleted = await mutation(request(app), 'delete', '/api/demo/homepage/web-call/call_1', 'delete-homepage-web-call', {
      purgeToken: 'purge',
    }).expect(200);
    expect(deleted.body.data).toEqual({ providerDeletionVerified: true, northstarPurged: true, retainedContent: false });
    expect(service.verifyCallAuthority).toHaveBeenCalledWith('call_1', 'purge');
    expect(admission.admitPurge).toHaveBeenCalledWith('a'.repeat(64));
    expect(service.purge).toHaveBeenCalledWith('call_1', 'purge');
  });

  test('deletion rejects invalid origin and body before purge admission', async () => {
    const { app, service, admission } = build();
    await request(app).delete('/api/demo/homepage/web-call/call_1')
      .set('Host', 'northstar.test')
      .set('X-NorthStar-Demo-Intent', 'delete-homepage-web-call')
      .send({ purgeToken: 'purge' })
      .expect(403);
    await mutation(request(app), 'delete', '/api/demo/homepage/web-call/call_1', 'delete-homepage-web-call', {
      purgeToken: 'purge',
      extra: true,
    }).expect(422);
    expect(service.verifyCallAuthority).not.toHaveBeenCalled();
    expect(admission.admitPurge).not.toHaveBeenCalled();
    expect(service.purge).not.toHaveBeenCalled();
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
      { purgeToken: 'invalid' }
    ).expect(403);
    expect(response.body.error.code).toBe('homepage_purge_authority_invalid');
    expect(admission.admitPurge).not.toHaveBeenCalled();
    expect(service.purge).not.toHaveBeenCalled();
  });
});
