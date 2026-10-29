'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART8A_ESTIMATE_QUOTE_SENDING_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART8A_ESTIMATE_QUOTE_SENDING_CONTRACT.md');
const MIGRATION = path.join(ROOT, 'migrations/287_canonical_automation_estimate_quote_resolution_v1.sql');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = character => `sha256:${character.repeat(64)}`;

function assertPlainData(value, seen = new Set()) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('scalar');
    return;
  }
  if (types.isProxy(value) || typeof value !== 'object' || seen.has(value)) throw new Error('plain');
  seen.add(value);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw new Error('prototype');
  if (array && Object.keys(value).length !== value.length) throw new Error('sparse');
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('descriptor');
    assertPlainData(descriptor.value, seen);
  }
  seen.delete(value);
}
function exactKeys(value, keys) {
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('shape');
}

const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const MISSION24_ESTIMATE_ID = new RegExp(contract.identityGrammar.mission24EstimateIdPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);
const PROFILE = contract.currentLaunchProfile;

function candidate(suffix = 1) {
  const value = {
    schemaVersion: 'mission28.estimate-quote-resolution.v1', tenantId: uuid(28),
    estimateQuoteResolutionId: uuid(980000 + suffix), transactionId: uuid(600001), unitId: uuid(600002),
    estimateBinding: { estimateId: uuid(810001), customerEstimateVersionId: uuid(810002), revision: 1,
      customerEstimateVersionDigest: hash('1'), documentDigest: hash('2'), commercialApprovalId: uuid(810003),
      commercialApprovalDigest: hash('3'), termsId: uuid(810004), termsDigest: hash('4'), decisionId: uuid(810005), decisionDigest: hash('5') },
    authorizationBinding: { authorizationId: uuid(440001), authorizationKind: 'per_run_approval',
      authorizationRecordDigest: hash('6'), authorizationMaterialBindingDigest: hash('7') },
    requestedChannelId: 'email', requestedProfileId: PROFILE.profileId,
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: 'owner' },
    evaluatedAt: '2026-10-28T12:00:00.000000Z', requestDigest: ''
  };
  value.requestDigest = canonical.digest('mission28.estimate-quote-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function trusted(value) {
  return Object.fromEntries(['tenantId','transactionId','unitId','estimateBinding','authorizationBinding','requestedChannelId','requestedProfileId','actorBinding','evaluatedAt'].map(key => [key, copy(value[key])]));
}
function authority(value) {
  return { tenantId: value.tenantId, transactionId: value.transactionId, unitId: value.unitId, runId: uuid(600003),
    estimateBinding: copy(value.estimateBinding), authorizationBinding: copy(value.authorizationBinding),
    customerId: uuid(810006), customerIdentityDigest: hash('8'), versionLatest: true, commercialCurrent: true,
    documentRecomputedExact: true, customerCurrent: true, legacyDeliveryLinkCount: 0,
    unitActionFamilyId: 'owner_approval_request', unitActionTemplateId: 'owner_approval_request_v1',
    unitChannelId: 'in_app_passive', providerMode: 'provider_disabled', effectClass: 'internal_record_only',
    actorBinding: copy(value.actorBinding) };
}
function validate(value, separatelyTrusted, server, indexes = null) {
  assertPlainData(value);
  if (separatelyTrusted === undefined) separatelyTrusted = trusted(value);
  if (server === undefined) server = authority(value);
  assertPlainData(separatelyTrusted); assertPlainData(server);
  exactKeys(value, contract.resolutionEnvelope.exactFields);
  exactKeys(value.estimateBinding, contract.resolutionEnvelope.estimateBindingExactFields);
  exactKeys(value.authorizationBinding, contract.resolutionEnvelope.authorizationBindingExactFields);
  exactKeys(value.actorBinding, contract.resolutionEnvelope.actorBindingExactFields);
  const identities = [value.tenantId,value.estimateQuoteResolutionId,value.transactionId,value.unitId,
    value.estimateBinding.customerEstimateVersionId,value.estimateBinding.commercialApprovalId,
    value.estimateBinding.termsId,value.estimateBinding.decisionId,value.authorizationBinding.authorizationId,
    value.actorBinding.actorId,value.actorBinding.sessionId,value.actorBinding.membershipId];
  const digests = [value.estimateBinding.customerEstimateVersionDigest,value.estimateBinding.documentDigest,
    value.estimateBinding.commercialApprovalDigest,value.estimateBinding.termsDigest,value.estimateBinding.decisionDigest,
    value.authorizationBinding.authorizationRecordDigest,value.authorizationBinding.authorizationMaterialBindingDigest,value.requestDigest];
  if (value.schemaVersion !== 'mission28.estimate-quote-resolution.v1' || !identities.every(item => UUID.test(item)) ||
      !MISSION24_ESTIMATE_ID.test(value.estimateBinding.estimateId) ||
      !digests.every(item => DIGEST.test(item)) || !Number.isSafeInteger(value.estimateBinding.revision) ||
      value.estimateBinding.revision < 1 || value.estimateBinding.revision > 10000 ||
      !contract.resolutionEnvelope.requestedChannelIds.includes(value.requestedChannelId) ||
      !contract.resolutionEnvelope.authorizationKinds.includes(value.authorizationBinding.authorizationKind) ||
      value.requestedProfileId !== PROFILE.profileId || value.actorBinding.membershipRole !== 'owner' || !UTC.test(value.evaluatedAt)) throw new Error('shape');
  const requestDigest = canonical.digest('mission28.estimate-quote-resolution.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  if (value.requestDigest !== requestDigest || canonical.canonicalize(separatelyTrusted) !== canonical.canonicalize(trusted(value))) throw new Error('trust');
  for (const key of ['tenantId','transactionId','unitId']) if (server[key] !== value[key]) throw new Error('authority');
  if (canonical.canonicalize(server.estimateBinding) !== canonical.canonicalize(value.estimateBinding) ||
      canonical.canonicalize(server.authorizationBinding) !== canonical.canonicalize(value.authorizationBinding) ||
      canonical.canonicalize(server.actorBinding) !== canonical.canonicalize(value.actorBinding) ||
      !UUID.test(server.customerId) || !DIGEST.test(server.customerIdentityDigest) || !server.versionLatest || !server.commercialCurrent ||
      !server.documentRecomputedExact || !server.customerCurrent || server.legacyDeliveryLinkCount !== 0 ||
      server.unitActionFamilyId !== 'owner_approval_request' || server.unitActionTemplateId !== 'owner_approval_request_v1' ||
      server.unitChannelId !== 'in_app_passive' || server.providerMode !== 'provider_disabled' || server.effectClass !== 'internal_record_only') throw new Error('currentness');
  const materialDigest = canonical.digest('mission28.estimate-quote-resolution-material.v1\n', separatelyTrusted);
  if (indexes) {
    const byId = indexes.byId.get(value.estimateQuoteResolutionId); const byMaterial = indexes.byMaterial.get(materialDigest);
    if (byId && byId.requestDigest !== value.requestDigest) throw new Error('replay conflict');
    if (byMaterial && byMaterial.estimateQuoteResolutionId !== value.estimateQuoteResolutionId) throw new Error('clone');
    if (byId) return { ...copy(byId.output), replayed: true };
  }
  const evidence = { tenantId:value.tenantId,estimateQuoteResolutionId:value.estimateQuoteResolutionId,transactionId:value.transactionId,
    unitId:value.unitId,runId:server.runId,estimateBinding:value.estimateBinding,customerId:server.customerId,
    customerIdentityDigest:server.customerIdentityDigest,authorizationBinding:value.authorizationBinding,
    requestedChannelId:value.requestedChannelId,requestedProfileId:value.requestedProfileId,...Object.fromEntries(Object.entries(PROFILE).filter(([key]) => key !== 'profileId')),
    evaluatedAt:value.evaluatedAt };
  const output = { ...evidence, estimateQuoteResolutionDigest:canonical.digest('mission28.estimate-quote-resolution-evidence.v1\n',evidence),
    messageCreated:false,accessGrantCreated:false,providerAttempted:false,customerResponseCreated:false,
    priceOrScopeMutated:false,effectCreated:false,replayed:false };
  if (indexes) { const row={estimateQuoteResolutionId:value.estimateQuoteResolutionId,requestDigest:value.requestDigest,output:copy(output)};
    indexes.byId.set(value.estimateQuoteResolutionId,row); indexes.byMaterial.set(materialDigest,row); }
  return output;
}

describe('Mission 28 Part 8A estimate, proposal and quote sending authority', () => {
  test('binds the released Part7F baseline and exact frozen inputs', () => {
    expect(contract.authority).toMatchObject({baselineCommit:'577f70aea18a541e16b2463ea8d5cb30ff008bc8',baselineTree:'042797584ec519ab20e766752f6db8568bd29a3e'});
    expect(contract.part7FRelease).toMatchObject({acceptedSourceHead:'7ecaa43ac31f1f37bb9b93d88f7b1b93e76592b7',pullRequest:580,
      mergedMain:'577f70aea18a541e16b2463ea8d5cb30ff008bc8',deployment:'49fc78b1-2dc4-4466-a6d8-957e43ca50fc',deploymentState:'SUCCESS_RUNNING'});
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test('projects exact document and customer identity truth while every external state and effect stays unavailable', () => {
    const result=validate(candidate());
    expect(result).toMatchObject({documentState:'exact_current_approved_customer_safe_version',
      recipientPreviewState:'exact_current_customer_identity_preview_no_send_authority',
      messagePreviewState:'unavailable_no_accepted_external_customer_estimate_template',
      channelPreviewState:'unavailable_no_accepted_external_customer_channel',expirationState:'not_created_no_access_grant',
      customerResponseState:'unavailable_no_access_or_authenticated_response',deliveryState:'unavailable_no_message_or_access',
      priceMutationState:'forbidden_none',scopeMutationState:'forbidden_none',resultState:'exact_document_bound_external_delivery_unavailable',
      messageCreated:false,accessGrantCreated:false,providerAttempted:false,customerResponseCreated:false,priceOrScopeMutated:false,effectCreated:false});
    expect(Object.values(contract.privacyAndEffects).every(value=>value===0)).toBe(true);
  });

  test('accepts the exact Mission24 deterministic UUIDv5 estimate identity while denying other UUID versions', () => {
    const value=candidate(); value.estimateBinding.estimateId='ae356a2b-9f63-56a5-bf75-71819d657a3f';
    value.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestDigest')));
    expect(validate(value,trusted(value),authority(value))).toMatchObject({estimateBinding:{estimateId:value.estimateBinding.estimateId}});
    const invalid=copy(value); invalid.estimateBinding.estimateId='ae356a2b-9f63-66a5-bf75-71819d657a3f';
    invalid.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(invalid).filter(([key])=>key!=='requestDigest')));
    expect(()=>validate(invalid,trusted(invalid),authority(invalid))).toThrow(/shape/);
  });

  test('rejects missing extra malformed coercible and candidate-supplied contact document message link response or effect material', () => {
    for (const mutate of [value=>{delete value.estimateBinding.documentDigest;},value=>{value.extra='customer@example.test';},
      value=>{value.estimateBinding.revision='1';},value=>{value.estimateBinding.documentDigest='not-digest';},
      value=>{value.requestedChannelId='provider_live';},value=>{value.authorizationBinding.authorizationKind='self_approved';},
      value=>{value.customerEmail='customer@example.test';},value=>{value.document={total:'999999'};},
      value=>{value.message='Send this';},value=>{value.accessToken='secret';},value=>{value.customerResponse='accepted';},value=>{value.effectCreated=true;}]) {
      const value=candidate(); mutate(value); value.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestDigest')));
      expect(()=>validate(value,trusted(value))).toThrow();
    }
  });

  test('rejects accessors symbols toJSON proxies aliases custom prototypes and sparse arrays before authority use', () => {
    let calls=0; const accessor=candidate(); Object.defineProperty(accessor.estimateBinding,'documentDigest',{enumerable:true,get(){calls+=1;return hash('2');}});
    expect(()=>validate(accessor)).toThrow(); expect(calls).toBe(0);
    const symbol=candidate(); symbol.estimateBinding[Symbol('secret')]=true; expect(()=>validate(symbol)).toThrow();
    const toJSON=candidate(); Object.defineProperty(toJSON,'toJSON',{value(){throw new Error('hook');}}); expect(()=>validate(toJSON)).toThrow();
    expect(()=>validate(new Proxy(candidate(),{}))).toThrow(); const custom=candidate(); Object.setPrototypeOf(custom,{customerResponse:'accepted'}); expect(()=>validate(custom)).toThrow();
    const alias=candidate(); alias.estimateBinding=alias; expect(()=>validate(alias)).toThrow();
    const sparse=candidate(); sparse.authorizationBinding=[copy(sparse.authorizationBinding),,]; expect(()=>validate(sparse)).toThrow();
  });

  test('rejects separately trusted, tenant, run, document, customer, authorization and legacy-link retargeting', () => {
    const value=candidate(); const wrong=trusted(value); wrong.estimateBinding.documentDigest=hash('9'); expect(()=>validate(value,wrong)).toThrow(/trust/);
    for (const mutate of [server=>{server.tenantId=uuid(29);},server=>{server.unitId=uuid(99);},
      server=>{server.estimateBinding.documentDigest=hash('9');},server=>{server.authorizationBinding.authorizationId=uuid(99);},
      server=>{server.customerId='not-a-uuid';},server=>{server.versionLatest=false;},server=>{server.commercialCurrent=false;},
      server=>{server.documentRecomputedExact=false;},server=>{server.customerCurrent=false;},server=>{server.legacyDeliveryLinkCount=1;},
      server=>{server.providerMode='live';},server=>{server.effectClass='external_message';},server=>{server.unitActionFamilyId='collection_escalation';}]) {
      const server=authority(value); mutate(server); expect(()=>validate(value,trusted(value),server)).toThrow();
    }
  });

  test('allows both canonical authorization kinds but never treats either as external channel authority', () => {
    for (const authorizationKind of contract.resolutionEnvelope.authorizationKinds) {
      const value=candidate(); value.authorizationBinding.authorizationKind=authorizationKind;
      value.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestDigest')));
      const result=validate(value,trusted(value),authority(value)); expect(result.channelPreviewState).toBe('unavailable_no_accepted_external_customer_channel');
    }
  });

  test('enforces immutable exact replay and rejects same-ID conflict and cross-ID material clone', () => {
    const indexes={byId:new Map(),byMaterial:new Map()}; const value=candidate(10); const first=validate(value,trusted(value),authority(value),indexes);
    expect(first.replayed).toBe(false); expect(validate(copy(value),trusted(value),authority(value),indexes)).toMatchObject({estimateQuoteResolutionDigest:first.estimateQuoteResolutionDigest,replayed:true});
    const conflict=copy(value); conflict.requestedChannelId='sms'; conflict.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(conflict).filter(([key])=>key!=='requestDigest')));
    expect(()=>validate(conflict,trusted(conflict),authority(conflict),indexes)).toThrow(/replay conflict/);
    const clone=copy(value); clone.estimateQuoteResolutionId=uuid(980099); clone.requestDigest=canonical.digest('mission28.estimate-quote-resolution.v1\n',Object.fromEntries(Object.entries(clone).filter(([key])=>key!=='requestDigest')));
    expect(()=>validate(clone,trusted(clone),authority(clone),indexes)).toThrow(/clone/);
  });

  test('migration287 is additive immutable forced-RLS owner-only and has no contact document price message token or response payload', () => {
    const sql=fs.readFileSync(MIGRATION,'utf8');
    for (const fragment of ['CREATE TABLE public.canonical_automation_estimate_quote_resolutions_v1','FORCE ROW LEVEL SECURITY',
      'canonical_automation_estimate_quote_resolutions_v1_immutable','canonical_automation_record_estimate_quote_resolution_v1',
      'REVOKE ALL ON FUNCTION public.canonical_automation_record_estimate_quote_resolution_v1(TEXT,JSONB) FROM PUBLIC',
      "'messageCreated',FALSE","'accessGrantCreated',FALSE","'providerAttempted',FALSE","'customerResponseCreated',FALSE","'priceOrScopeMutated',FALSE","'effectCreated',FALSE"])
      expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/\b(customer_name|customer_email|customer_phone|customer_address|document_body|price_value|scope_value|message_body|access_token|link_url|response_body|provider_metadata)\b\s+(?:TEXT|BYTEA|JSONB)/i);
  });

  test('roadmap and ledger preserve the released Part8A while Part8B alone is candidate', () => {
    const roadmap=fs.readFileSync(ROADMAP,'utf8'); const ledger=fs.readFileSync(LEDGER,'utf8'); const markdown=fs.readFileSync(CONTRACT_MD,'utf8');
    expect(roadmap).toContain('Parts 1A–10B are released. Part 10C is the sole implementation candidate.');
    expect(ledger).toContain('| 32 | 7F | Delivery corrections, replies, opt-outs and minimized provider evidence | **Released** |');
    expect(ledger).toContain('| 33 | 8A | Mission 24 estimate/proposal/quote sending | **Released** |');
    expect(ledger).toContain('| 34 | 8B | Mission 27 financial-document delivery without financial mutation | **Released** |');
    expect(ledger).toContain('Released migration source is byte-identical to the previously verified Part 9B deployment at 283 migrations through exact `287_canonical_automation_estimate_quote_resolution_v1.sql` with no 288');
    expect(markdown).toContain('It does not send anything.');
  });
});
