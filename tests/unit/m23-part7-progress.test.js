'use strict';
const { normalizeProgressAction, normalizeProgressRead, UNIT_VERSION } = require('../../src/progress/contract');
const id = 'f1000000-0000-4000-8000-000000000001';
const pin = { id, revision: 1, digest: 'a'.repeat(64) };
const zone = { businessProfileId: id, version: 1, hash: 'a'.repeat(64), timeZone: 'UTC' };
const observation = { observedAt: '2026-09-01T12:00:00Z', timeZoneAuthority: zone, evidence: [] };
const progress = () => ({ kind: 'progress', workKey: 'paving', description: 'Measured paving.', ...observation,
 quantity: { completed: '2.5', total: '10', unit: 'm2' }, milestone: null, uncertainty: 'measured', uncertaintyReason: null });
const input = document => ({ organizationId: id, actorUserId: id, actorAccessRole: 'owner', authSessionId: id,
 executionId: id, idempotencyKey: 'progress-test-key-001', body: { action: 'record_progress', performerProfileId: id,
 expectedExecutionRevision: 2, expectedExecutionDigest: 'b'.repeat(64),
 expectedAssignmentRevision: 4, expectedAssignmentDigest: 'c'.repeat(64), reason: 'Observed work.', document } });
describe('Mission 23 Part 7 strict operational fact contract', () => {
 test('records exact decimal quantities with explicit versioned units and no calculated percent', () => {
  const result = normalizeProgressAction(input(progress()));
  expect(result.document.quantity).toEqual({ completed: '2.5', total: '10', unit: 'm2', contractVersion: UNIT_VERSION });
  expect(result.document.reviewState).toBe('needs_review');
  expect(result.document).not.toHaveProperty('percentComplete');
 });
 test.each(['toString','constructor','__proto__'])('rejects inherited vocabulary name %s as a typed client error',kind=>{
  try{normalizeProgressAction(input({...progress(),kind}));throw new Error('Unexpected acceptance');}
  catch(error){expect(error.status).toBe(400);expect(error.code).toBe('INVALID_PROGRESS_REQUEST');}
 });
 test.each(['0', '0.000001', '2.5', '10'])('accepts bounded explicit quantity %s', completed => {
  expect(normalizeProgressAction(input({ ...progress(), quantity: { completed, total: '10', unit: 'm2' } })).document.quantity.completed).toBe(completed);
 });
 test.each(['-1','NaN','Infinity','01','1e2','1.0000001','10.000001',null,2])('rejects invalid completed quantity %s', completed => {
  expect(() => normalizeProgressAction(input({ ...progress(), quantity: { completed, total: '10', unit: 'm2' } }))).toThrow();
 });
 test('accepts milestone with exact checklist evidence and distinct uncertainty', () => {
  const result = normalizeProgressAction(input({ ...progress(), quantity: null, milestone: { key: 'prep', state: 'done', checklist: pin } }));
  expect(result.document.milestone.checklist).toEqual(pin);
 });
 test('unknown progress cannot invent quantity or a done milestone', () => {
  expect(() => normalizeProgressAction(input({ ...progress(), uncertainty: 'unknown', uncertaintyReason: 'No measurement.' }))).toThrow();
  expect(normalizeProgressAction(input({ ...progress(), quantity: null, milestone: { key: 'prep', state: 'unavailable', checklist: null },
   uncertainty: 'unknown', uncertaintyReason: 'No measurement.' })).document.quantity).toBeNull();
 });
 test.each(['price','quoteApproval','changeOrderApproval','customerAcceptance','invoice','purchase','contactCustomer','authorizationToContinue','scheduledStart','percentComplete'])('rejects extra authority %s recursively', key => {
  expect(() => normalizeProgressAction(input({ ...progress(), [key]: true }))).toThrow();
  const value = input(progress()); value.body[key] = true; expect(() => normalizeProgressAction(value)).toThrow();
 });
 test.each(['<b>Active</b>','https://example.test','safe\u202Etext','a\u200Bb','e\u0301','x\u{e0001}'])('rejects non-inert text %s', description => {
  expect(() => normalizeProgressAction(input({ ...progress(), description }))).toThrow();
 });
 test.each(['Mesuré à Montréal.','作業を記録しました。','تم تسجيل العمل.','Trabajo medido 🧱.'])('accepts ordinary NFC international text %s', description => {
  expect(normalizeProgressAction(input({ ...progress(), description })).document.description).toBe(description);
 });
 test.each(['expectedExecutionRevision','expectedExecutionDigest','expectedAssignmentRevision','expectedAssignmentDigest'])('requires explicit non-null pin %s', key => {
  const value = input(progress()); delete value.body[key]; expect(() => normalizeProgressAction(value)).toThrow();
  value.body[key] = null; expect(() => normalizeProgressAction(value)).toThrow();
 });
 test('issue resolution requires explicit same-work evidence references', () => {
  const value = input({ state: 'resolved', resolution: { description: 'Recorded clearance.', observedAt: observation.observedAt, evidence: [] } });
  Object.assign(value.body, { action: 'issue_state', recordId: id, expectedRecordRevision: 1, expectedRecordDigest: pin.digest });
  expect(() => normalizeProgressAction(value)).toThrow();
  value.body.document.resolution.evidence = [pin];
  expect(normalizeProgressAction(value).document.resolution.evidence).toEqual([pin]);
 });
 test.each(['review','issue_state'])('%s cannot supply replacement profile authority or select historical mode',action=>{
  const value=input(action==='review'?{outcome:'owner_confirmed'}:{state:'investigating',resolution:null});
  Object.assign(value.body,{action,recordId:id,expectedRecordRevision:1,expectedRecordDigest:pin.digest});
  expect(normalizeProgressAction(value).action).toBe(action);
  for(const patch of [{timeZoneAuthority:zone},{require_current_profile:false},{requireCurrentProfile:false}]){
   expect(()=>normalizeProgressAction({...value,body:{...value.body,document:{...value.body.document,...patch}}})).toThrow();
  }
 });
 test('cursor binds execution and immutable high-water identity; bounds are strict', () => {
  expect(normalizeProgressRead({})).toEqual({ limit: 50, cursor: null });
  for (const query of [{ limit: '0' }, { limit: '201' }, { limit: '01' }, { cursor: 'bad' }, { actor: id }]) {
   expect(() => normalizeProgressRead(query)).toThrow();
  }
 });
 test('quantity ordering property holds without floating point or inferred conversion',()=>{
  for(let total=1;total<=25;total+=1)for(let completed=0;completed<=total+1;completed+=1){
   const value=input({...progress(),quantity:{completed:String(completed),total:String(total),unit:'ea'}});
   if(completed<=total)expect(normalizeProgressAction(value).document.quantity.completed).toBe(String(completed));
   else expect(()=>normalizeProgressAction(value)).toThrow();
  }
 });
});
