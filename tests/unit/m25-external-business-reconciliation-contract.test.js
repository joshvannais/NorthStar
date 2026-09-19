'use strict';
const { normalizeMatch, TARGETS } = require('../../src/learning/externalBusinessReconciliationContract');
const digest='a'.repeat(64),token='ref_'+'b'.repeat(64),targetId='00000000-0000-4000-8000-000000000001';
const valid={action:'link',referenceKind:'customer',externalReference:token,targetKind:'customer',targetId,expectedRevision:0,expectedDigest:'none',expectedSourceDigest:digest,expectedTargetDigest:digest,reason:'Link this exact reviewed reference.',confirmed:true,confirmationVersion:'m25-external-business-reference-match-v1'};
describe('external business reconciliation contract',()=>{
 test('enforces exact source-class reference and target mappings',()=>{
  const cases={crm_field_service:['customer','job','estimate'],project_change_order:['customer','job','estimate','project','change_order'],communication:['customer','job','estimate','project'],financial:['customer','job','estimate','execution','project','change_order','invoice','payment','collection','accounting_entry']};
  for(const[sourceClass,kinds]of Object.entries(cases))for(const referenceKind of kinds)expect(normalizeMatch(sourceClass,'source.reviewed',{...valid,referenceKind,targetKind:TARGETS[referenceKind]}).targetKind).toBe(TARGETS[referenceKind]);
 });
 test('accepts exact unlink and rejects fuzzy, cross-class and malformed links',()=>{
  expect(normalizeMatch('financial','source.reviewed',{...valid,action:'unlink',targetKind:null,targetId:null,expectedTargetDigest:'unavailable'}).action).toBe('unlink');
  for(const input of [["financial",{...valid,externalReference:'invoice 42'}],["crm_field_service",{...valid,referenceKind:'payment',targetKind:'estimate'}],["financial",{...valid,referenceKind:'execution',targetKind:'estimate'}],["financial",{...valid,extra:true}]])expect(()=>normalizeMatch(input[0],'source.reviewed',input[1])).toThrow(/invalid/i);
 });
});
