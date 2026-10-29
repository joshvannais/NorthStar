'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {types:{isProxy}} = require('node:util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART8C_SHARED_DELIVERY_VERSION_IDEMPOTENCY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART8C_SHARED_DELIVERY_VERSION_IDEMPOTENCY_CONTRACT.md');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const FIELDS = contract.trustedMaterialEnvelope;
const copy = value => JSON.parse(JSON.stringify(value));
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const hash = value => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

function dataGate(value, seen = new WeakSet()) {
  if (value === null || ['string','number','boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || isProxy(value) || seen.has(value)) throw new Error('plain data');
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || Reflect.ownKeys(value).some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) ||
        Reflect.ownKeys(value).filter(key => key !== 'length').length !== value.length) throw new Error('dense array');
  } else if (proto !== Object.prototype) throw new Error('ordinary object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || key === 'toJSON') throw new Error('descriptor');
    if (key !== 'length') dataGate(descriptor.value, seen);
  }
}

function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || JSON.stringify(Reflect.ownKeys(value)) !== JSON.stringify(keys)) throw new Error('keys');
}

function materialOf(input) {
  const material = copy(input);
  delete material.deliveryRequestId; delete material.materialDigest; delete material.idempotencyKeyDigest; delete material.requestDigest;
  return material;
}

function requestOf(input) {
  const request = copy(input);
  delete request.materialDigest; delete request.idempotencyKeyDigest; delete request.requestDigest;
  return request;
}

function idempotencyMaterialOf(input) {
  const material = copy(input);
  delete material.deliveryRequestId; delete material.evaluatedAt; delete material.materialDigest; delete material.idempotencyKeyDigest; delete material.requestDigest;
  return material;
}

function seal(input) {
  input.materialDigest = hash(materialOf(input));
  input.idempotencyKeyDigest = hash({namespace:'mission28.part8c.delivery-idempotency.v1',material:idempotencyMaterialOf(input)});
  input.requestDigest = hash(requestOf(input));
  return input;
}

function fixture(mode = 'manual_quick_send') {
  const policy = mode === 'policy_driven' ? {policyId:'00000000-0000-4000-8000-000000000015',policyVersion:4,policyDigest:`sha256:${'15'.repeat(32)}`} : null;
  const authorizationKind = mode === 'policy_driven' ? 'standing_authorization' : 'per_run_approval';
  const requestedChannelId = mode === 'native_handoff' ? 'native_manual_handoff' : 'email';
  const channelResultState = mode === 'native_handoff' ? 'unavailable_manual_handoff_not_opened' : 'unavailable_external_channel';
  return seal({
    schemaVersion:'mission28.part8c.shared-delivery-material.v1',tenantId:'00000000-0000-4000-8000-000000000001',
    deliveryRequestId:'00000000-0000-4000-8000-000000000002',deliveryMode:mode,
    documentBinding:{documentClass:'mission24_estimate_quote',sourceResolutionId:'00000000-0000-4000-8000-000000000003',sourceResolutionDigest:`sha256:${'03'.repeat(32)}`,documentId:'00000000-0000-4000-8000-000000000004',documentVersionId:'00000000-0000-4000-8000-000000000005',documentRevision:7,documentVersionDigest:`sha256:${'05'.repeat(32)}`,customerSafeProjectionDigest:`sha256:${'06'.repeat(32)}`,currentnessState:'latest_exact_current'},
    previewBinding:{contentPreviewId:'00000000-0000-4000-8000-000000000007',contentPreviewDigest:`sha256:${'07'.repeat(32)}`},
    senderRecipientBinding:{senderRecipientResolutionId:'00000000-0000-4000-8000-000000000008',senderRecipientResolutionDigest:`sha256:${'08'.repeat(32)}`},
    permissionBinding:{permissionResolutionId:'00000000-0000-4000-8000-000000000009',permissionResolutionDigest:`sha256:${'09'.repeat(32)}`},
    channelBinding:{channelResolutionId:'00000000-0000-4000-8000-000000000010',channelResolutionDigest:`sha256:${'10'.repeat(32)}`,requestedChannelId,channelResultState},
    authorizationBinding:{authorizationId:'00000000-0000-4000-8000-000000000011',authorizationKind,authorizationRecordDigest:`sha256:${'11'.repeat(32)}`,authorizationMaterialBindingDigest:`sha256:${'12'.repeat(32)}`},
    policyBinding:policy,evaluatedAt:'2026-10-28T12:00:00.000000Z',materialDigest:'',idempotencyKeyDigest:'',requestDigest:''
  });
}

function validate(input, trusted) {
  dataGate(input); dataGate(trusted);
  exactKeys(input, FIELDS.exactFields);
  exactKeys(input.documentBinding, FIELDS.documentBindingExactFields);
  exactKeys(input.previewBinding, FIELDS.previewBindingExactFields);
  exactKeys(input.senderRecipientBinding, FIELDS.senderRecipientBindingExactFields);
  exactKeys(input.permissionBinding, FIELDS.permissionBindingExactFields);
  exactKeys(input.channelBinding, FIELDS.channelBindingExactFields);
  exactKeys(input.authorizationBinding, FIELDS.authorizationBindingExactFields);
  for (const value of [input.tenantId,input.deliveryRequestId,input.documentBinding.sourceResolutionId,input.documentBinding.documentId,
    input.documentBinding.documentVersionId,input.previewBinding.contentPreviewId,input.senderRecipientBinding.senderRecipientResolutionId,
    input.permissionBinding.permissionResolutionId,input.channelBinding.channelResolutionId,input.authorizationBinding.authorizationId]) if (!UUID.test(value)) throw new Error('uuid');
  for (const value of [input.documentBinding.sourceResolutionDigest,input.documentBinding.documentVersionDigest,input.documentBinding.customerSafeProjectionDigest,
    input.previewBinding.contentPreviewDigest,input.senderRecipientBinding.senderRecipientResolutionDigest,input.permissionBinding.permissionResolutionDigest,
    input.channelBinding.channelResolutionDigest,input.authorizationBinding.authorizationRecordDigest,input.authorizationBinding.authorizationMaterialBindingDigest,
    input.materialDigest,input.idempotencyKeyDigest,input.requestDigest]) if (!DIGEST.test(value)) throw new Error('digest');
  if (!Number.isSafeInteger(input.documentBinding.documentRevision) || input.documentBinding.documentRevision < 1 || !UTC.test(input.evaluatedAt)) throw new Error('primitive');
  if (JSON.stringify(input) !== JSON.stringify(trusted)) throw new Error('trusted material');
  const source = contract.documentSourceCatalog.find(item => item.documentClass === input.documentBinding.documentClass);
  if (!source || !source.intentMaterialMayBeValidated || input.documentBinding.currentnessState !== FIELDS.currentnessState) throw new Error('source unavailable');
  const mode = contract.deliveryModes.find(item => item.deliveryMode === input.deliveryMode);
  if (!mode || input.authorizationBinding.authorizationKind !== mode.requiredAuthorizationKind) throw new Error('mode authorization');
  if (mode.policyBinding === 'must_be_null') {
    if (input.policyBinding !== null || !['email','sms'].includes(input.channelBinding.requestedChannelId) && input.deliveryMode !== 'native_handoff') throw new Error('manual policy');
  } else {
    exactKeys(input.policyBinding, FIELDS.policyBindingExactFieldsWhenPresent);
    if (!UUID.test(input.policyBinding.policyId) || !Number.isSafeInteger(input.policyBinding.policyVersion) || input.policyBinding.policyVersion < 1 || !DIGEST.test(input.policyBinding.policyDigest)) throw new Error('policy');
  }
  if (input.deliveryMode === 'native_handoff' && (input.channelBinding.requestedChannelId !== 'native_manual_handoff' || input.channelBinding.channelResultState !== 'unavailable_manual_handoff_not_opened')) throw new Error('native channel');
  if (input.deliveryMode !== 'native_handoff' && (!['email','sms'].includes(input.channelBinding.requestedChannelId) || input.channelBinding.channelResultState !== 'unavailable_external_channel')) throw new Error('external channel');
  if (input.materialDigest !== hash(materialOf(input)) || input.idempotencyKeyDigest !== hash({namespace:'mission28.part8c.delivery-idempotency.v1',material:idempotencyMaterialOf(input)}) || input.requestDigest !== hash(requestOf(input))) throw new Error('canonical digest');
  return Object.freeze({deliveryRequestId:input.deliveryRequestId,materialDigest:input.materialDigest,idempotencyKeyDigest:input.idempotencyKeyDigest,
    resultState:mode.currentResult,intentCreated:false,providerRequestIdentityCreated:false,messageCreated:false,externalEffectCreated:false});
}

class History {
  constructor() { this.byId=new Map(); this.byMaterial=new Map(); }
  record(input, trusted) {
    const result=validate(input,trusted); const prior=this.byId.get(input.deliveryRequestId);
    if (prior) { if (prior.requestDigest!==input.requestDigest) throw new Error('identity conflict'); return {...prior,replayed:true}; }
    if (this.byMaterial.has(input.materialDigest) || [...this.byId.values()].some(item=>item.idempotencyKeyDigest===input.idempotencyKeyDigest)) throw new Error('clone');
    const stored=Object.freeze({...result,requestDigest:input.requestDigest,replayed:false}); this.byId.set(input.deliveryRequestId,stored); this.byMaterial.set(input.materialDigest,input.deliveryRequestId); return stored;
  }
}

describe('Mission 28 Part 8C shared delivery version and idempotency authority', () => {
  test('binds exact Part8B release provenance and frozen contract hashes', () => {
    expect(contract.authority).toMatchObject({baselineCommit:'f7cd90ad9dbd99bc78cfc92709dd9d3612744328',baselineTree:'1372a378bc2360f68b64340cf0e8a158fc4ee66c',state:'implementation_candidate_only'});
    expect(contract.part8BRelease).toMatchObject({acceptedSourceHead:'fec8cd7f20480b3df74e1f2fd0b9390c04ea81c4',pullRequest:582,mergedMain:'f7cd90ad9dbd99bc78cfc92709dd9d3612744328',deployment:'fdbf9223-1b69-4b97-9bfc-cd60ad1adad0',runningInstance:'c99c5c58-dac6-4d99-be5c-e3b19239b716',imageSha256:'07fd8a6422e3713ed768fb335942c7a68cf766f6d68f3a6059b786c951ef0c26',productionMigration:'283_of_283_through_287_no_288'});
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test.each(['manual_quick_send','native_handoff','policy_driven'])('validates exact %s material but creates no intent or effect', mode => {
    const input=fixture(mode); expect(validate(input,copy(input))).toMatchObject({resultState:contract.deliveryModes.find(item=>item.deliveryMode===mode).currentResult,intentCreated:false,providerRequestIdentityCreated:false,messageCreated:false,externalEffectCreated:false});
  });

  test('keeps canonical Part3B authorization kinds and exact mode-specific policy binding', () => {
    for (const mutation of [
      value=>{value.authorizationBinding.authorizationKind='standing_authorization';}, value=>{value.policyBinding={policyId:'00000000-0000-4000-8000-000000000015',policyVersion:1,policyDigest:`sha256:${'15'.repeat(32)}`};},
      value=>{value.deliveryMode='policy_driven';}, value=>{value.deliveryMode='third_authorization_kind';}
    ]) { const input=fixture(); mutation(input); seal(input); expect(()=>validate(input,copy(input))).toThrow(); }
    const standing=fixture('policy_driven'); standing.authorizationBinding.authorizationMaterialBindingDigest=`sha256:${'99'.repeat(32)}`; seal(standing);
    expect(()=>validate(standing,fixture('policy_driven'))).toThrow('trusted material');
  });

  test('fails closed on cross-tenant, stale, substituted or unavailable document authority', () => {
    for (const mutation of [
      value=>{value.tenantId='00000000-0000-4000-8000-000000000099';}, value=>{value.documentBinding.currentnessState='stale';},
      value=>{value.documentBinding.documentClass='mission27_financial_document';}, value=>{value.documentBinding.documentRevision=0;},
      value=>{value.channelBinding.requestedChannelId='native_manual_handoff';}, value=>{value.authorizationBinding.authorizationRecordDigest=`sha256:${'99'.repeat(32)}`;}
    ]) { const input=fixture(); mutation(input); seal(input); expect(()=>validate(input,fixture())).toThrow(); }
  });

  test('enforces exact replay while denying same identity changes, clone identity and cross-mode reuse', () => {
    const history=new History(); const first=fixture(); expect(history.record(first,copy(first)).replayed).toBe(false); expect(history.record(copy(first),copy(first)).replayed).toBe(true);
    const changed=copy(first); changed.previewBinding.contentPreviewDigest=`sha256:${'33'.repeat(32)}`; seal(changed); expect(()=>history.record(changed,copy(changed))).toThrow('identity conflict');
    const clone=copy(first); clone.deliveryRequestId='00000000-0000-4000-8000-000000000099'; seal(clone); expect(()=>history.record(clone,copy(clone))).toThrow('clone');
    const relabel=copy(first); relabel.deliveryRequestId='00000000-0000-4000-8000-000000000098'; relabel.deliveryMode='native_handoff'; relabel.channelBinding.requestedChannelId='native_manual_handoff'; relabel.channelBinding.channelResultState='unavailable_manual_handoff_not_opened'; seal(relabel); expect(relabel.materialDigest).not.toBe(first.materialDigest); expect(()=>validate(relabel,copy(relabel))).not.toThrow();
    const sameIdentityRelabel=copy(first); sameIdentityRelabel.deliveryMode='native_handoff'; sameIdentityRelabel.channelBinding.requestedChannelId='native_manual_handoff'; sameIdentityRelabel.channelBinding.channelResultState='unavailable_manual_handoff_not_opened'; seal(sameIdentityRelabel); expect(()=>history.record(sameIdentityRelabel,copy(sameIdentityRelabel))).toThrow('identity conflict');
  });

  test('keeps idempotency stable across request identity and evaluation time while material and request digests remain truthful', () => {
    const history=new History(); const first=fixture(); history.record(first,copy(first));
    const later=copy(first); later.deliveryRequestId='00000000-0000-4000-8000-000000000097'; later.evaluatedAt='2026-10-28T12:05:00.000000Z'; seal(later);
    expect(later.materialDigest).not.toBe(first.materialDigest); expect(later.requestDigest).not.toBe(first.requestDigest); expect(later.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest);
    expect(()=>history.record(later,copy(later))).toThrow('clone');
    const sameIdentityLater=copy(first); sameIdentityLater.evaluatedAt='2026-10-28T12:05:00.000000Z'; seal(sameIdentityLater);
    expect(sameIdentityLater.idempotencyKeyDigest).toBe(first.idempotencyKeyDigest); expect(()=>history.record(sameIdentityLater,copy(sameIdentityLater))).toThrow('identity conflict');
  });

  test('requires a new preview, authorization material and idempotency key for a new document revision', () => {
    const old=fixture(); const revision=copy(old); revision.deliveryRequestId='00000000-0000-4000-8000-000000000020'; revision.documentBinding.documentVersionId='00000000-0000-4000-8000-000000000021'; revision.documentBinding.documentRevision=8; revision.documentBinding.documentVersionDigest=`sha256:${'21'.repeat(32)}`; revision.previewBinding.contentPreviewId='00000000-0000-4000-8000-000000000022'; revision.previewBinding.contentPreviewDigest=`sha256:${'22'.repeat(32)}`; revision.authorizationBinding.authorizationId='00000000-0000-4000-8000-000000000023'; revision.authorizationBinding.authorizationRecordDigest=`sha256:${'23'.repeat(32)}`; revision.authorizationBinding.authorizationMaterialBindingDigest=`sha256:${'24'.repeat(32)}`;
    seal(revision); expect(()=>validate(revision,copy(revision))).not.toThrow();
    expect(revision.materialDigest).not.toBe(old.materialDigest); expect(revision.idempotencyKeyDigest).not.toBe(old.idempotencyKeyDigest);
    const reused=copy(revision); reused.previewBinding=copy(old.previewBinding); reused.authorizationBinding=copy(old.authorizationBinding); seal(reused);
    expect(reused.previewBinding).toEqual(old.previewBinding); expect(contract.sharedVersionCurrentnessAndIdempotencyContract.revisionRule).toMatch(/new_content_preview_and_new_per_run_approval/);
    expect(()=>validate(reused,copy(revision))).toThrow('trusted material');
  });

  test('rejects extra, missing, accessor, symbol, proxy, toJSON, custom-prototype and alias inputs before hooks', () => {
    for (const mutation of [value=>{value.extra='customer@example.test';},value=>{delete value.requestDigest;},value=>{value.documentBinding.toJSON=()=>({});},value=>{Object.setPrototypeOf(value.documentBinding,{})},value=>{value.previewBinding=value.documentBinding;}]) {
      const input=fixture(); mutation(input); expect(()=>validate(input,copy(fixture()))).toThrow();
    }
    let getter=0; const accessor=fixture(); Object.defineProperty(accessor.documentBinding,'documentId',{enumerable:true,get(){getter+=1; return 'x';}}); expect(()=>validate(accessor,fixture())).toThrow(); expect(getter).toBe(0);
    const symbol=fixture(); symbol[Symbol('secret')]='provider-token'; expect(()=>validate(symbol,fixture())).toThrow();
    let traps=0; const proxy=new Proxy(fixture(),{get(){traps+=1; throw new Error('trap');},ownKeys(){traps+=1; throw new Error('trap');}}); expect(()=>validate(proxy,fixture())).toThrow(); expect(traps).toBe(0);
  });

  test('freezes zero-effect privacy and no-runtime boundaries with migration287 latest and no288', () => {
    expect(Object.values(contract.privacyAndEffects).every(value=>value===0)).toBe(true);
    expect(contract.runtimeBoundary).toMatchObject({newMigration:false,newTableFunctionRouteOrUi:false,mountedSchedulerWorkerQueueOrPolicyExecutor:false,providerAdapterCallbackOrOperatingSystemHandoff:false,recipientMessageDeliveryOrCustomerResponse:false,nextMigrationAbsent:'288'});
    const migrations=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>/^\d+_/.test(name)).sort(); expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(migrations.some(name=>name.startsWith('288_'))).toBe(false);
  });

  test('roadmap and ledger preserve released Part8C while Part8D is the sole candidate', () => {
    const roadmap=fs.readFileSync(ROADMAP,'utf8'); const ledger=fs.readFileSync(LEDGER,'utf8'); const markdown=fs.readFileSync(CONTRACT_MD,'utf8');
    for (const document of [roadmap,ledger]) { expect(document).toContain('Parts 1A–8D are released. Part 9A is the sole implementation candidate.'); expect(document).toContain('Parts 9B–14G remain planned and unimplemented.'); expect(document).toContain('fdbf9223-1b69-4b97-9bfc-cd60ad1adad0'); expect(document).toContain('sha256:07fd8a6422e3713ed768fb335942c7a68cf766f6d68f3a6059b786c951ef0c26'); }
    expect(ledger).toContain('| 34 | 8B | Mission 27 financial-document delivery without financial mutation | **Released** |'); expect(ledger).toContain('| 35 | 8C | Shared quick-send/native/policy version and idempotency contract | **Released** |'); expect(ledger).toContain('| 36 | 8D | Delivery acknowledgement, revoke/resend/recovery and exact labels | **Released** |'); expect(markdown).toContain('no migration 288');
  });
});
