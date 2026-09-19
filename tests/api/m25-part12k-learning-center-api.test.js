'use strict';
const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const contract = require('../../public/js/learning-center-contract');

describe('Mission 25 Part 12K business-system Learning Center API', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 180000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 60000);

  test('lists all four tenant-private business source classes for owners and administrators', async () => {
    const sources = [
      ['crm-field-service','crm_field_service','crm.api','m25-external-crm-field-service-import-consent-v1'],
      ['project-change-order','project_change_order','projects.api','m25-external-project-change-order-import-consent-v1'],
      ['communication','communication','conversations.api','m25-external-communication-import-consent-v1'],
      ['financial','financial','accounting.api','m25-external-financial-import-consent-v1'],
    ];
    for (const [route, kind, key, version] of sources) {
      const response = await request(fixture.app).post(`/api/v1/learning/external-${route}-sources/${key}/consent`)
        .set(fixture.actors.owner.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({ action:'grant', expectedRevision:0,
          expectedDigest:'none', reason:'Owner added a reviewed business source for Learning Center acceptance.', confirmed:true, confirmationVersion:version });
      expect(response.status).toBe(201);
      const center = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors.owner.session.headers);
      expect(center.body.data.sources).toEqual(expect.arrayContaining([expect.objectContaining({ sourceKind:kind, sourceKey:key })]));
    }
    for (const actorName of ['owner','admin']) {
      const response = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors[actorName].session.headers);
      expect(response.status).toBe(200); expect(response.body.data.version).toBe('m25-learning-center-v6'); expect(response.body.data.sourceTotal).toBe(4);
    }
    const pairRoot = '/api/v1/learning/external-customer-outcome-sources/crm.api/conversations.api';
    let pairConsent = await request(fixture.app).get(`${pairRoot}/consent`).set(fixture.actors.owner.session.headers);
    expect(pairConsent.status).toBe(200); expect(pairConsent.body.data).toEqual(expect.objectContaining({ current:null, sourcePermissionsAvailable:true }));
    expect(contract.consent(pairConsent.body.data)).toEqual(expect.objectContaining({ active:false, history:[], total:0, truncated:false }));
    pairConsent = await request(fixture.app).post(`${pairRoot}/consent`).set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', crypto.randomUUID()).send({ action:'grant', expectedRevision:0, expectedDigest:'none',
        reason:'Owner enabled the exact reviewed customer source pair.', confirmed:true, confirmationVersion:'m25-external-customer-outcome-consent-v1' });
    expect(pairConsent.status).toBe(201);
    const calibrationConsent = await request(fixture.app).get('/api/v1/learning/external-business-calibration/customer/crm.api/consent')
      .query({ secondarySourceKey:'conversations.api' }).set(fixture.actors.owner.session.headers);
    expect(calibrationConsent.status).toBe(200); expect(contract.consent(calibrationConsent.body.data)).toEqual(expect.objectContaining({ active:false }));
    const other = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200); expect(other.body.data.sources).toEqual([]);
    for (const [endpoint, validator] of [
      ['/api/v1/learning/external-financial-sources/accounting.api', contract.source],
      ['/api/v1/learning/external-financial-sources/accounting.api/consent', contract.consent],
      ['/api/v1/learning/external-business-sources/financial/accounting.api/matches', contract.matches],
      ['/api/v1/learning/external-business-sources/financial/accounting.api/operations', contract.operations],
      ['/api/v1/learning/external-financial-outcome-sources/accounting.api/consent', contract.consent],
      ['/api/v1/learning/external-business-calibration/financial/accounting.api/consent', contract.consent],
    ]) {
      const detail = await request(fixture.app).get(endpoint).set(fixture.actors.owner.session.headers);
      expect(detail.status).toBe(200); expect(() => validator(detail.body.data)).not.toThrow();
    }
  });

  test('fails closed for non-owner roles and withholds the renamed projection helper', async () => {
    for (const actorName of ['member','viewer']) expect((await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors[actorName].session.headers)).status).toBe(403);
    const denied = await fixture.runtimePool.query("SELECT has_function_privilege(current_user,'public.canonical_learning_center_part11_read(uuid,uuid,text,uuid)','EXECUTE') allowed");
    expect(denied.rows[0].allowed).toBe(false);
    const text = JSON.stringify((await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors.owner.session.headers)).body.data);
    expect(text).not.toMatch(/password|accessToken|clientSecret/i);
  });
});
