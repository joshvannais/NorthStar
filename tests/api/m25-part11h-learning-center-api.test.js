'use strict';
const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

describe('Mission 25 Part 11H material Learning Center API', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 180000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 60000);

  test('projects native material permission and tenant-private material sources for owners and administrators', async () => {
    const before = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors.owner.session.headers);
    expect(before.status).toBe(200); expect(before.body.data.version).toBe('m25-learning-center-v5');
    expect(before.body.data.nativeMaterial).toBeTruthy(); expect(before.body.data.sources).toEqual([]);

    const grant = await request(fixture.app).post('/api/v1/learning/external-material-sources/materials.api/consent')
      .set(fixture.actors.owner.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({ action: 'grant', expectedRevision: 0,
        expectedDigest: 'none', reason: 'Owner added the reviewed material source for API acceptance.', confirmed: true,
        confirmationVersion: 'm25-external-material-import-consent-v1' });
    expect(grant.status).toBe(201);

    for (const actorName of ['owner','admin']) {
      const response = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors[actorName].session.headers);
      expect(response.status).toBe(200);
      expect(response.body.data.sources).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKind: 'material', sourceKey: 'materials.api' })]));
    }
    const other = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200); expect(other.body.data.sources).toEqual([]);
  });

  test('fails closed for non-owner roles and keeps target choices company-facing', async () => {
    for (const actorName of ['member','viewer']) {
      const response = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors[actorName].session.headers);
      expect(response.status).toBe(403);
    }
    const matches = await request(fixture.app).get('/api/v1/learning/external-material-sources/materials.api/matches').set(fixture.actors.owner.session.headers);
    expect(matches.status).toBe(200); expect(matches.body.data.activeConsent).toBe(true);
    expect(JSON.stringify(matches.body.data)).not.toMatch(/password|accessToken|clientSecret/i);
  });
});
