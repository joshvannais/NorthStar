'use strict';
const contract=require('../../src/learning/nativeEquipmentUtilizationContract');
const id='123e4567-e89b-42d3-a456-426614174000',digest='a'.repeat(64);
describe('Mission 25 native equipment utilization contract',()=>{
 test('normalizes explicit consent and observation',()=>{
  expect(contract.normalizeConsent({action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use explicit native checkout evidence.',confirmed:true,confirmationVersion:contract.CONSENT_VERSION}).action).toBe('grant');
  expect(contract.normalizeObservation(id,{expectedConsentRevision:1,expectedConsentDigest:digest,reason:'Compare the completed job.',confirmed:true,confirmationVersion:contract.OBSERVATION_VERSION}).estimateId).toBe(id);
 });
 test('rejects implicit consent, stale-shaped and extra inputs',()=>{
  expect(()=>contract.normalizeConsent({action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use evidence.',confirmed:false,confirmationVersion:contract.CONSENT_VERSION})).toThrow();
  expect(()=>contract.normalizeObservation(id,{expectedConsentRevision:1,expectedConsentDigest:digest,reason:'Compare.',confirmed:true,confirmationVersion:contract.OBSERVATION_VERSION,engineHours:'4'})).toThrow();
  expect(()=>contract.normalizeEstimateId('not-an-id')).toThrow();
 });
});
