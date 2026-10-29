'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = 'docs/architecture/MISSION_28_PART5D_COLLISION_SUPPRESSION_DRY_RUN_CONTRACT.json';
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT_PATH), 'utf8'));
const PART1D = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json'), 'utf8'));
const PART5A = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.json'), 'utf8'));
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER = '00000000-0000-4000-8000-000000000029';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9_]*$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const copy = value => JSON.parse(JSON.stringify(value));

function normalizedLfSha256(relative) {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');
  if (text.includes('\r')) throw new Error('lone CR');
  return crypto.createHash('sha256').update(text).digest('hex').toUpperCase();
}

function ownPlain(value, label = 'value', seen = new Set()) {
  if (value === null || ['string','number','boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || util.types.isProxy(value) || seen.has(value)) throw new Error(`${label} plain`);
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length + 1) throw new Error(`${label} dense`);
    for (let index = 0; index < value.length; index += 1) descriptor(value, String(index), `${label}[${index}]`, seen);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} prototype`);
  for (const key of keys) {
    if (typeof key !== 'string' || key === 'toJSON') throw new Error(`${label} key`);
    descriptor(value, key, `${label}.${key}`, seen);
  }
}

function descriptor(object, key, label, seen) {
  const item = Object.getOwnPropertyDescriptor(object, key);
  if (!item || !item.enumerable || !item.configurable || !item.writable ||
      !Object.hasOwn(item, 'value') || item.get || item.set) throw new Error(`${label} descriptor`);
  ownPlain(item.value, label, seen);
}

function exact(value, keys, label) {
  if (!value || Array.isArray(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} shape`);
  }
}

function same(left, right) { return canonical.canonicalize(left) === canonical.canonicalize(right); }
function digest(namespace, value, omit) {
  const material = copy(value);
  if (omit) delete material[omit];
  return canonical.digest(namespace, material);
}
function uuid(value, label) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} UUID`); }
function hash(value, label) { if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} digest`); }
function token(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > CONTRACT.bounds.maximumTokenBytes || !TOKEN.test(value)) {
    throw new Error(`${label} token`);
  }
}
function utc(value, label) {
  if (typeof value !== 'string' || !UTC.test(value) || new Date(value).toISOString() !== value) throw new Error(`${label} UTC`);
}
function fixtureUuid(number) { return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`; }
function fixtureDigest(byte) { return `sha256:${byte.toString(16).padStart(2, '0').repeat(32)}`; }

function candidate(number = 1, priorityRank = 10, collisionScopeDigest = fixtureDigest(40)) {
  const template = PART5A.approvedActionTemplates.find(item => item.templateId === 'internal_fact_digest_v1');
  const value = {
    candidateId: fixtureUuid(600 + number), tenantId: TENANT,
    policyId: fixtureUuid(620 + number), policyVersion: 3, policyDigest: fixtureDigest(1 + number),
    evaluationId: fixtureUuid(640 + number), evaluationOutputDigest: fixtureDigest(10 + number), evaluationResult: 'eligible',
    previewId: fixtureUuid(660 + number), previewDigest: fixtureDigest(20 + number), previewDisplayState: 'eligible',
    previewEffectAuthorityState: 'no_effect_authority', actionFamilyId: template.actionFamilyId,
    actionTemplateId: template.templateId, actionTemplateDigest: template.templateDigest,
    authorizationDigest: fixtureDigest(30 + number), sourceSetDigest: fixtureDigest(50 + number),
    recipientSetDigest: fixtureDigest(60 + number), channelId: template.channelId, providerModeId: template.providerMode,
    effectClass: template.effectClass, actionMaterialDigest: fixtureDigest(70 + number), collisionScopeDigest,
    priorityRank, customerId: fixtureUuid(700), customerDigest: fixtureDigest(80), documentId: fixtureUuid(701),
    documentVersion: 2, documentDigest: fixtureDigest(81), preparedAt: '2026-11-09T15:00:00.000Z', candidateDigest: ''
  };
  value.candidateDigest = digest(CONTRACT.candidateEnvelope.candidateDigestNamespace, value, 'candidateDigest');
  return value;
}

function controlScopeDigest(item, kind) {
  const common = { kind, tenantId: item.tenantId };
  const material = (() => {
    switch (kind) {
      case 'global_pause': return { kind };
      case 'tenant_pause': return common;
      case 'customer_pause':
      case 'active_conversation': return { ...common, customerId: item.customerId, customerDigest: item.customerDigest };
      case 'document_pause': return { ...common, documentId: item.documentId, documentVersion: item.documentVersion, documentDigest: item.documentDigest };
      case 'recipient_opt_out': return { ...common, recipientSetDigest: item.recipientSetDigest, customerId: item.customerId, customerDigest: item.customerDigest };
      case 'provider_uncertainty': return { ...common, channelId: item.channelId, providerModeId: item.providerModeId };
      case 'source_change': return { ...common, sourceSetDigest: item.sourceSetDigest };
      case 'recent_manual_activity': return { ...common, customerId: item.customerId, customerDigest: item.customerDigest, recipientSetDigest: item.recipientSetDigest, actionFamilyId: item.actionFamilyId };
      case 'duplicate_content': return { ...common, recipientSetDigest: item.recipientSetDigest, actionMaterialDigest: item.actionMaterialDigest, channelId: item.channelId, actionFamilyId: item.actionFamilyId };
      case 'higher_priority_action': return { ...common, collisionScopeDigest: item.collisionScopeDigest };
      default: throw new Error('control kind');
    }
  })();
  return canonical.digest(CONTRACT.controlEnvelope.scopeDigestNamespace, material);
}

function controlsFor(item, matchedKind = null, unavailableKind = null) {
  return CONTRACT.controlEnvelope.controlOrder.map((kind, index) => {
    const state = kind === unavailableKind ? 'unavailable' : kind === matchedKind ? 'exact_current_matched' : 'exact_current_clear';
    const unavailable = state === 'unavailable';
    const value = {candidateId:item.candidateId,tenantId:TENANT,kind,state,scopeDigest:controlScopeDigest(item,kind),
      evidenceId:unavailable ? null : fixtureUuid(1000 + Number(item.candidateId.slice(-3)) * 20 + index),
      evidenceDigest:unavailable ? null : fixtureDigest(100 + index), observedAt:unavailable ? null : '2026-11-09T13:00:00.000Z',
      acceptedAt:unavailable ? null : '2026-11-09T14:00:00.000Z', expiresAt:state === 'exact_current_matched' ? '2026-11-11T15:00:00.000Z' : null,
      resolutionDigest:''};
    value.resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,value,'resolutionDigest');
    return value;
  });
}

function analysis(candidates = [candidate()], controls = null, mode = 'dry_run') {
  const orderedCandidates = copy(candidates).sort((left,right)=>left.candidateId.localeCompare(right.candidateId));
  const value = {schemaVersion:CONTRACT.analysisEnvelope.schemaVersion,tenantId:TENANT,analysisId:fixtureUuid(900),mode,
    asOf:'2026-11-10T15:00:00.000Z',windowStartedAt:mode === 'dry_run' ? '2026-11-01T15:00:00.000Z' : '2026-01-01T15:00:00.000Z',
    candidates:orderedCandidates,controls:controls ? copy(controls) : orderedCandidates.flatMap(item=>controlsFor(item)),inputDigest:''};
  value.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,value,'inputDigest');
  return value;
}

function validateCandidate(value, asOf) {
  exact(value, CONTRACT.candidateEnvelope.exactFields, 'candidate');
  [value.candidateId,value.tenantId,value.policyId,value.evaluationId,value.previewId].forEach((item,index)=>uuid(item,`candidate${index}`));
  [value.policyDigest,value.evaluationOutputDigest,value.previewDigest,value.actionTemplateDigest,value.authorizationDigest,
    value.sourceSetDigest,value.recipientSetDigest,value.actionMaterialDigest,value.collisionScopeDigest,
    value.candidateDigest].forEach((item,index)=>hash(item,`candidate${index}`));
  if ((value.customerId===null)!==(value.customerDigest===null) || (value.documentId===null)!==(value.documentDigest===null) ||
      (value.documentId===null)!==(value.documentVersion===null)) throw new Error('candidate nullable scope');
  if(value.customerId!==null){uuid(value.customerId,'customer');hash(value.customerDigest,'customer');}
  if(value.documentId!==null){uuid(value.documentId,'document');hash(value.documentDigest,'document');}
  if (value.tenantId !== TENANT || !Number.isSafeInteger(value.policyVersion) || value.policyVersion < 1 ||
      (value.documentVersion!==null && (!Number.isSafeInteger(value.documentVersion) || value.documentVersion < 1)) ||
      !Number.isSafeInteger(value.priorityRank) || value.priorityRank < CONTRACT.bounds.priorityRankMinimum ||
      value.priorityRank > CONTRACT.bounds.priorityRankMaximum) throw new Error('candidate bound');
  [value.evaluationResult,value.previewDisplayState,value.previewEffectAuthorityState,value.actionFamilyId,value.actionTemplateId,
    value.channelId,value.providerModeId,value.effectClass].forEach((item,index)=>token(item,`candidate${index}`));
  if (value.evaluationResult !== 'eligible' || value.previewDisplayState !== 'eligible' ||
      value.previewEffectAuthorityState !== 'no_effect_authority') throw new Error('candidate no-effect eligibility');
  const template=PART5A.approvedActionTemplates.find(item=>item.templateId===value.actionTemplateId);
  const launch=PART1D.launchCells.find(item=>item.actionFamily===value.actionFamilyId);
  if (!template || template.templateDigest!==value.actionTemplateDigest || template.actionFamilyId!==value.actionFamilyId ||
      template.channelId!==value.channelId || template.providerMode!==value.providerModeId || template.effectClass!==value.effectClass ||
      !launch || launch.firstLaunchState!=='conditional_first_launch_not_implemented' ||
      !launch.channelIds.includes(value.channelId) || !launch.providerModeIds.includes(value.providerModeId)) throw new Error('candidate launch binding');
  utc(value.preparedAt,'preparedAt'); if(value.preparedAt>asOf) throw new Error('candidate future');
  if (digest(CONTRACT.candidateEnvelope.candidateDigestNamespace,value,'candidateDigest')!==value.candidateDigest) throw new Error('candidate digest');
}

function controlApplicable(kind, item) {
  if (['customer_pause','recipient_opt_out','active_conversation'].includes(kind)) return item.customerId !== null;
  if (kind === 'document_pause') return item.documentId !== null;
  return true;
}

function validateControl(value, item, asOf) {
  exact(value, CONTRACT.controlEnvelope.exactFields, 'control');
  uuid(value.candidateId,'control candidate'); uuid(value.tenantId,'control tenant'); token(value.kind,'control kind');
  hash(value.scopeDigest,'control scope'); hash(value.resolutionDigest,'control resolution');
  if (value.candidateId!==item.candidateId || value.tenantId!==item.tenantId || value.scopeDigest!==controlScopeDigest(item,value.kind) ||
      !CONTRACT.controlEnvelope.controlOrder.includes(value.kind) || !CONTRACT.controlEnvelope.states.includes(value.state)) throw new Error('control binding');
  const applicable=controlApplicable(value.kind,item);
  if (!applicable) {
    if (value.state!=='not_applicable' || [value.evidenceId,value.evidenceDigest,value.observedAt,value.acceptedAt,value.expiresAt].some(field=>field!==null)) throw new Error('control applicability');
  } else if (value.state === 'unavailable') {
    if ([value.evidenceId,value.evidenceDigest,value.observedAt,value.acceptedAt,value.expiresAt].some(field=>field!==null)) throw new Error('unavailable evidence');
  } else {
    if (value.state==='not_applicable') throw new Error('control required');
    uuid(value.evidenceId,'evidence'); hash(value.evidenceDigest,'evidence'); utc(value.observedAt,'observedAt'); utc(value.acceptedAt,'acceptedAt');
    if (value.observedAt>value.acceptedAt || value.acceptedAt>asOf) throw new Error('future evidence');
    if (value.state==='exact_current_clear' && value.expiresAt!==null) throw new Error('clear expiry');
    if (value.expiresAt!==null) {utc(value.expiresAt,'expiresAt'); if(value.expiresAt<=asOf) throw new Error('expired match');}
  }
  if(digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,value,'resolutionDigest')!==value.resolutionDigest) throw new Error('control digest');
}

function validateAnalysis(candidateValue, trusted) {
  ownPlain(candidateValue,'candidate analysis'); ownPlain(trusted,'trusted analysis');
  if (!same(candidateValue,trusted)) throw new Error('candidate cannot establish trusted analysis');
  exact(candidateValue,CONTRACT.analysisEnvelope.exactFields,'analysis');
  if(candidateValue.schemaVersion!==CONTRACT.analysisEnvelope.schemaVersion || candidateValue.tenantId!==TENANT ||
      !CONTRACT.analysisEnvelope.modes.includes(candidateValue.mode)) throw new Error('analysis authority');
  uuid(candidateValue.tenantId,'tenant'); uuid(candidateValue.analysisId,'analysis'); utc(candidateValue.asOf,'asOf'); utc(candidateValue.windowStartedAt,'window');
  if(candidateValue.windowStartedAt>candidateValue.asOf || !Array.isArray(candidateValue.candidates) ||
      candidateValue.candidates.length<1 || candidateValue.candidates.length>CONTRACT.bounds.maximumCandidates) throw new Error('analysis bound');
  const maximumDays=candidateValue.mode==='dry_run'?CONTRACT.bounds.maximumAnalysisWindowDays:CONTRACT.bounds.maximumHistoricalAgeDays;
  if((new Date(candidateValue.asOf)-new Date(candidateValue.windowStartedAt))/86400000>maximumDays) throw new Error('analysis window');
  let prior=''; const candidateIds=new Set();
  for(const item of candidateValue.candidates){validateCandidate(item,candidateValue.asOf);if(item.candidateId<=prior||candidateIds.has(item.candidateId))throw new Error('candidate order');prior=item.candidateId;candidateIds.add(item.candidateId);}
  if(!Array.isArray(candidateValue.controls)||candidateValue.controls.length!==candidateValue.candidates.length*CONTRACT.bounds.controlsPerCandidate)throw new Error('control cardinality');
  const evidenceIds=new Set();
  for(let candidateIndex=0;candidateIndex<candidateValue.candidates.length;candidateIndex+=1){
    const item=candidateValue.candidates[candidateIndex];
    for(let controlIndex=0;controlIndex<CONTRACT.controlEnvelope.controlOrder.length;controlIndex+=1){
      const control=candidateValue.controls[candidateIndex*CONTRACT.bounds.controlsPerCandidate+controlIndex];
      if(control.candidateId!==item.candidateId||control.kind!==CONTRACT.controlEnvelope.controlOrder[controlIndex])throw new Error('control order');
      validateControl(control,item,candidateValue.asOf);
      if(control.evidenceId!==null){if(evidenceIds.has(control.evidenceId))throw new Error('evidence reuse');evidenceIds.add(control.evidenceId);}
    }
  }
  if(digest(CONTRACT.analysisEnvelope.inputDigestNamespace,candidateValue,'inputDigest')!==candidateValue.inputDigest)throw new Error('analysis digest');
}

function preliminaryDecision(item, controls) {
  const unavailable=controls.find(control=>control.state==='unavailable');
  if(unavailable)return {result:'unavailable',reasonCode:'required_evidence_unavailable',blockingEvidenceIds:[],dominantCandidateId:null};
  const mapped=[
    ['source_change','source_material_changed','unavailable'],['provider_uncertainty','provider_outcome_uncertain','unavailable'],
    ['global_pause','global_pause_active','suppressed'],['tenant_pause','tenant_pause_active','suppressed'],
    ['customer_pause','customer_pause_active','suppressed'],['document_pause','document_pause_active','suppressed'],
    ['recipient_opt_out','recipient_opt_out_active','suppressed'],['active_conversation','active_conversation_present','suppressed'],
    ['recent_manual_activity','recent_manual_activity_present','suppressed'],['duplicate_content','duplicate_content_recent','suppressed'],
    ['higher_priority_action','higher_priority_action_active','superseded']
  ];
  for(const [kind,reasonCode,result] of mapped){const control=controls.find(value=>value.kind===kind);if(control.state==='exact_current_matched')return {result,reasonCode,blockingEvidenceIds:[control.evidenceId],dominantCandidateId:null};}
  return {result:null,reasonCode:null,blockingEvidenceIds:[],dominantCandidateId:null,item};
}

function analyze(candidateValue, trusted) {
  validateAnalysis(candidateValue,trusted);
  const decisions=new Map(); const clearByScope=new Map();
  for(let index=0;index<candidateValue.candidates.length;index+=1){const item=candidateValue.candidates[index];
    const controls=candidateValue.controls.slice(index*CONTRACT.bounds.controlsPerCandidate,(index+1)*CONTRACT.bounds.controlsPerCandidate);
    const decision=preliminaryDecision(item,controls);
    if(decision.result)decisions.set(item.candidateId,decision);else{const group=clearByScope.get(item.collisionScopeDigest)||[];group.push(item);clearByScope.set(item.collisionScopeDigest,group);}}
  for(const group of clearByScope.values()){
    const minimum=Math.min(...group.map(item=>item.priorityRank)); const winners=group.filter(item=>item.priorityRank===minimum);
    if(winners.length!==1){for(const item of group)decisions.set(item.candidateId,{result:'unavailable',reasonCode:'ambiguous_equal_priority_overlap',blockingEvidenceIds:[],dominantCandidateId:null});continue;}
    const winner=winners[0]; decisions.set(winner.candidateId,{result:'selected_no_effect',reasonCode:'selected_no_effect',blockingEvidenceIds:[],dominantCandidateId:null});
    for(const item of group)if(item!==winner)decisions.set(item.candidateId,{result:'superseded',reasonCode:'higher_priority_policy_overlap',blockingEvidenceIds:[],dominantCandidateId:winner.candidateId});
  }
  const output={schemaVersion:CONTRACT.outputEnvelope.schemaVersion,tenantId:candidateValue.tenantId,analysisId:candidateValue.analysisId,
    mode:candidateValue.mode,asOf:candidateValue.asOf,inputDigest:candidateValue.inputDigest,decisions:candidateValue.candidates.map(item=>{
      const value={candidateId:item.candidateId,...decisions.get(item.candidateId),decisionDigest:''};
      value.decisionDigest=digest(CONTRACT.outputEnvelope.decisionDigestNamespace,value,'decisionDigest');return value;}),
    effectCount:0,providerProofState:CONTRACT.outputEnvelope.providerProofState,outcomeProofState:CONTRACT.outputEnvelope.outcomeProofState,outputDigest:''};
  output.outputDigest=digest(CONTRACT.outputEnvelope.outputDigestNamespace,output,'outputDigest');return output;
}

function withControlState(value, candidateId, kind, state) {
  const next=copy(value); const control=next.controls.find(item=>item.candidateId===candidateId&&item.kind===kind);control.state=state;
  if (state === 'unavailable' || state === 'not_applicable') {
    control.evidenceId=null;control.evidenceDigest=null;control.observedAt=null;control.acceptedAt=null;control.expiresAt=null;
  } else {
    const item=next.candidates.find(candidateItem=>candidateItem.candidateId===candidateId);
    const index=CONTRACT.controlEnvelope.controlOrder.indexOf(kind);
    control.evidenceId=fixtureUuid(1000 + Number(item.candidateId.slice(-3)) * 20 + index);
    control.evidenceDigest=fixtureDigest(100 + index);control.observedAt='2026-11-09T13:00:00.000Z';control.acceptedAt='2026-11-09T14:00:00.000Z';
    control.expiresAt=state==='exact_current_matched'?'2026-11-11T15:00:00.000Z':null;
  }
  control.resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,control,'resolutionDigest');
  next.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,next,'inputDigest');return next;
}

describe('Mission 28 Part 5D collision, suppression and no-effect analysis',()=>{
  test('freezes Part5C release, exact inputs, precedence and zero-effect boundaries',()=>{
    expect(CONTRACT.authority).toEqual(expect.objectContaining({part:'5D',state:'implementation_candidate_only',baselineCommit:'cff573851f853e3e729fdd6a964c8b031352c00b'}));
    expect(CONTRACT.part5CRelease).toEqual(expect.objectContaining({acceptedSourceHead:'4533cc9be115ecd4195193d2ec7a2e196defe729',pullRequest:567,mergedMain:'cff573851f853e3e729fdd6a964c8b031352c00b',deployment:'08ee5c3c-1bf8-497d-b90e-96111210b8df',deploymentState:'SUCCESS_RUNNING'}));
    for(const item of CONTRACT.frozenInputs)expect(normalizedLfSha256(item.path)).toBe(item.normalizedLfSha256);
    expect(CONTRACT.trustedResolutionContract).toEqual(expect.objectContaining({
      candidateMayNotSupplyReplaceRetargetOrSelfAttestTrustedAnalysis:true,
      candidateMaterialMustEqualTheExactAcceptedPart5BOutputAndPart5CPreview:true,
      everyControlMustResolveIndependentlyForItsExactKindAndDerivedScope:true,
      currentRuntimeResolverAvailable:false
    }));
    expect(CONTRACT.controlEnvelope.controlOrder).toHaveLength(11);
    expect(CONTRACT.decisionContract.precedence.map(item=>item.reasonCode)).toEqual([
      'required_evidence_unavailable','source_material_changed','provider_outcome_uncertain','global_pause_active','tenant_pause_active',
      'customer_pause_active','document_pause_active','recipient_opt_out_active','active_conversation_present','recent_manual_activity_present',
      'duplicate_content_recent','higher_priority_action_active','ambiguous_equal_priority_overlap','higher_priority_policy_overlap','selected_no_effect']);
    expect(CONTRACT.outputEnvelope).toEqual(expect.objectContaining({effectCount:0,providerProofState:'not_provider_proof',outcomeProofState:'not_outcome_proof'}));
  });

  test('selects one clear candidate as deterministic no-effect counterfactual evidence',()=>{
    const input=analysis();const output=analyze(copy(input),input);
    expect(output.decisions).toEqual([expect.objectContaining({result:'selected_no_effect',reasonCode:'selected_no_effect',dominantCandidateId:null})]);
    expect(output).toEqual(expect.objectContaining({effectCount:0,providerProofState:'not_provider_proof',outcomeProofState:'not_outcome_proof'}));
    expect(output.outputDigest).toMatch(DIGEST);expect(analyze(copy(input),input)).toEqual(output);
  });

  test.each([
    ['source_change','source_material_changed','unavailable'],['provider_uncertainty','provider_outcome_uncertain','unavailable'],
    ['global_pause','global_pause_active','suppressed'],['tenant_pause','tenant_pause_active','suppressed'],
    ['customer_pause','customer_pause_active','suppressed'],['document_pause','document_pause_active','suppressed'],
    ['recipient_opt_out','recipient_opt_out_active','suppressed'],['active_conversation','active_conversation_present','suppressed'],
    ['recent_manual_activity','recent_manual_activity_present','suppressed'],['duplicate_content','duplicate_content_recent','suppressed'],
    ['higher_priority_action','higher_priority_action_active','superseded']
  ])('applies exact %s precedence', (kind,reasonCode,result)=>{
    const base=analysis();const input=withControlState(base,base.candidates[0].candidateId,kind,'exact_current_matched');
    expect(analyze(copy(input),input).decisions[0]).toEqual(expect.objectContaining({result,reasonCode}));
  });

  test('unavailable evidence dominates every matched lower control',()=>{
    let input=analysis();const id=input.candidates[0].candidateId;
    input=withControlState(input,id,'source_change','exact_current_matched');input=withControlState(input,id,'global_pause','unavailable');
    expect(analyze(copy(input),input).decisions[0]).toEqual(expect.objectContaining({result:'unavailable',reasonCode:'required_evidence_unavailable'}));
  });

  test('selects the unique higher-priority overlap and fails closed on equal priority',()=>{
    const scope=fixtureDigest(200);const high=candidate(1,5,scope);const low=candidate(2,20,scope);
    const unique=analysis([high,low]);const output=analyze(copy(unique),unique);
    expect(output.decisions.find(item=>item.candidateId===high.candidateId)).toEqual(expect.objectContaining({result:'selected_no_effect'}));
    expect(output.decisions.find(item=>item.candidateId===low.candidateId)).toEqual(expect.objectContaining({result:'superseded',dominantCandidateId:high.candidateId}));
    const tie=analysis([candidate(1,5,scope),candidate(2,5,scope)]);expect(analyze(copy(tie),tie).decisions.every(item=>item.result==='unavailable'&&item.reasonCode==='ambiguous_equal_priority_overlap')).toBe(true);
  });

  test('historical backtest rejects future evidence and remains no-effect non-proof',()=>{
    const input=analysis([candidate()],null,'historical_backtest');const output=analyze(copy(input),input);
    expect(output).toEqual(expect.objectContaining({mode:'historical_backtest',effectCount:0,providerProofState:'not_provider_proof',outcomeProofState:'not_outcome_proof'}));
    const future=copy(input);future.controls[0].acceptedAt='2026-11-11T15:00:00.000Z';future.controls[0].resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,future.controls[0],'resolutionDigest');future.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,future,'inputDigest');
    expect(()=>analyze(future,future)).toThrow('future evidence');
  });

  test('rejects cross-tenant, retargeted trusted material, reorder, duplicate and digest repair attacks',()=>{
    const base=analysis();const attacks=[];
    const tenant=copy(base);tenant.candidates[0].tenantId=OTHER;tenant.candidates[0].candidateDigest=digest(CONTRACT.candidateEnvelope.candidateDigestNamespace,tenant.candidates[0],'candidateDigest');tenant.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,tenant,'inputDigest');attacks.push(tenant);
    const reordered=analysis([candidate(1),candidate(2,20,fixtureDigest(201))]);reordered.candidates.reverse();reordered.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,reordered,'inputDigest');attacks.push(reordered);
    const duplicate=copy(base);duplicate.controls[1].evidenceId=duplicate.controls[0].evidenceId;duplicate.controls[1].resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,duplicate.controls[1],'resolutionDigest');duplicate.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,duplicate,'inputDigest');attacks.push(duplicate);
    for(const attacked of attacks)expect(()=>analyze(attacked,attacked)).toThrow();
    const retargeted=copy(base);retargeted.candidates[0].priorityRank=1;retargeted.candidates[0].candidateDigest=digest(CONTRACT.candidateEnvelope.candidateDigestNamespace,retargeted.candidates[0],'candidateDigest');retargeted.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,retargeted,'inputDigest');
    expect(()=>analyze(retargeted,base)).toThrow('candidate cannot establish trusted analysis');
  });

  test('rejects unknown, inapplicable, expired and malformed controls before decision lookup',()=>{
    const base=analysis();const id=base.candidates[0].candidateId;
    const unknown=copy(base);unknown.controls[0].state='clear';unknown.controls[0].resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,unknown.controls[0],'resolutionDigest');unknown.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,unknown,'inputDigest');
    const expired=withControlState(base,id,'global_pause','exact_current_matched');const row=expired.controls.find(item=>item.kind==='global_pause');row.expiresAt='2026-11-09T15:00:00.000Z';row.resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,row,'resolutionDigest');expired.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,expired,'inputDigest');
    const inapplicable=withControlState(base,id,'global_pause','not_applicable');
    for(const attacked of [unknown,expired,inapplicable])expect(()=>analyze(attacked,attacked)).toThrow();
  });

  test('binds each control to its exact derived scope and state-specific evidence shape',()=>{
    const base=analysis();
    const wrongScope=copy(base);wrongScope.controls[0].scopeDigest=wrongScope.controls[1].scopeDigest;
    wrongScope.controls[0].resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,wrongScope.controls[0],'resolutionDigest');
    wrongScope.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,wrongScope,'inputDigest');
    expect(()=>analyze(wrongScope,wrongScope)).toThrow('control binding');
    const unavailable=withControlState(base,base.candidates[0].candidateId,'provider_uncertainty','unavailable');
    expect(analyze(copy(unavailable),unavailable).decisions[0]).toEqual(expect.objectContaining({
      result:'unavailable',reasonCode:'required_evidence_unavailable',blockingEvidenceIds:[]
    }));
    const fabricated=copy(unavailable);const row=fabricated.controls.find(control=>control.kind==='provider_uncertainty');
    row.evidenceId=fixtureUuid(1998);row.evidenceDigest=fixtureDigest(198);row.observedAt='2026-11-09T13:00:00.000Z';row.acceptedAt='2026-11-09T14:00:00.000Z';
    row.resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,row,'resolutionDigest');
    fabricated.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,fabricated,'inputDigest');
    expect(()=>analyze(fabricated,fabricated)).toThrow('unavailable evidence');
  });

  test('requires exact applicability when customer or document scope is absent',()=>{
    const item=candidate();item.customerId=null;item.customerDigest=null;item.documentId=null;item.documentVersion=null;item.documentDigest=null;item.candidateDigest=digest(CONTRACT.candidateEnvelope.candidateDigestNamespace,item,'candidateDigest');
    const rows=controlsFor(item);for(const row of rows.filter(control=>['customer_pause','recipient_opt_out','active_conversation','document_pause'].includes(control.kind))){row.state='not_applicable';row.evidenceId=null;row.evidenceDigest=null;row.observedAt=null;row.acceptedAt=null;row.expiresAt=null;row.resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,row,'resolutionDigest');}
    const input=analysis([item],rows);expect(analyze(copy(input),input).decisions[0].result).toBe('selected_no_effect');
    const attacked=copy(input);const customer=attacked.controls.find(row=>row.kind==='customer_pause');customer.state='exact_current_clear';customer.evidenceId=fixtureUuid(1888);customer.evidenceDigest=fixtureDigest(188);customer.observedAt='2026-11-09T13:00:00.000Z';customer.acceptedAt='2026-11-09T14:00:00.000Z';customer.resolutionDigest=digest(CONTRACT.controlEnvelope.resolutionDigestNamespace,customer,'resolutionDigest');attacked.inputDigest=digest(CONTRACT.analysisEnvelope.inputDigestNamespace,attacked,'inputDigest');
    expect(()=>analyze(attacked,attacked)).toThrow('control applicability');
  });

  test('rejects nonplain, accessor, symbol, proxy, sparse, extra and missing input before hooks',()=>{
    const base=analysis();let calls=0;const accessor=copy(base);Object.defineProperty(accessor.candidates[0],'priorityRank',{enumerable:true,configurable:true,get(){calls+=1;return 10;}});
    expect(()=>analyze(accessor,base)).toThrow();expect(calls).toBe(0);
    const attacks=[copy(base),copy(base),copy(base),copy(base)];attacks[0].unexpected=true;delete attacks[1].schemaVersion;Object.setPrototypeOf(attacks[2].controls[0],{polluted:true});Object.defineProperty(attacks[3],Symbol('hidden'),{enumerable:true,value:true});
    for(const attacked of attacks)expect(()=>analyze(attacked,base)).toThrow();
    expect(()=>analyze(new Proxy(copy(base),{}),base)).toThrow();
  });

  test('records Part5C released, only Part5D candidate, later slices planned and migration274/no275',()=>{
    const roadmap=fs.readFileSync(path.join(ROOT,'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md'),'utf8');
    const ledger=fs.readFileSync(path.join(ROOT,'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'),'utf8');
    for(const document of [roadmap,ledger]){expect(document).toContain('Parts 1A–10D are released. Part 11A is the sole implementation candidate.');expect(document).toContain('Parts 11B–14G remain planned and unimplemented.');expect(document).toContain('4533cc9be115ecd4195193d2ec7a2e196defe729');expect(document).toContain('08ee5c3c-1bf8-497d-b90e-96111210b8df');}
    expect(ledger).toContain('| 19 | 5C | Owner-readable no-effect preview | **Released** |');expect(ledger).toContain('| 20 | 5D | Collision/suppression engine and no-effect dry run | **Released** |');
  expect((ledger.match(/\*\*Implementation candidate\*\*/g)||[])).toHaveLength(1);expect((ledger.match(/Planned \/ unimplemented/g)||[])).toHaveLength(21);
    const migrations=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');expect(migrations.some(name=>name.startsWith('288_'))).toBe(false);
  });
});
