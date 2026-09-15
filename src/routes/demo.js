'use strict';
const equipmentPlan=require('../estimating/equipmentPlanContract');
const demoEquipment=require('../commandCenter/demoEquipmentPlans');
const laborPlan=require('../estimating/laborPlanContract');
const laborPlanPolicy=require('../estimating/laborPlanPolicy');
const adoption = require('../estimating/materialAdoptionContract');
const adoptionPolicy = require('../estimating/materialAdoptionPolicy');
const {buildRevisionReview,selectDemoRevision,projectSelectedDemoDecisions,demoAdopt} = require('../estimating/estimateRevisionReview');


const crypto = require('crypto');
const {sha256}=require('../services/businessProfileAdapter');
const { buildEstimateReview } = require('../services/estimateReview');
const { buildCapellaReview } = require('../estimating/capellaReview');
const { buildMaterialReview } = require('../estimating/materialReview');
const {projectDecisions} = require('../estimating/decisionContract');
const decisionPolicy = require('../estimating/decisionPolicy');
const materialPlan=require('../estimating/materialPlanContract');
const materialPlanPolicy=require('../estimating/materialPlanPolicy');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { getProvisionedDemoOrganization } = require('../services/organizationAuthority');
const { readDemoLifecycle } = require('../services/demoVoiceLifecycle');
const {
  DemoCommandCenterError,
  DemoCommandCenterRepository,
} = require('../commandCenter/demoRepository');
const {
  buildDemoWorkspace,
  demoCanonicalItems,
  demoCalendarTimeZoneAuthority,
  DEMO_SERVICES,
} = require('../commandCenter/workspace');
const { DEFAULT_SELECTION, normalizeSelection } = require('../commandCenter/scenarioSpace');
const {
  SURFACES,
  compatibilityProjection,
  surfaceProjection,
} = require('./canonicalPolaris');
const scenarios = require('./simulation/scenario-catalog');

const router = express.Router();
const commandCenterRepository = new DemoCommandCenterRepository();
const DEMO_COOKIE = 'northstar_demo_workspace';
const DETAIL_IDENTIFIERS = Object.freeze({ customer: 'customer', lead: 'lead', work: 'work' });
const PRODUCTION_DEMO_ORIGINS = new Set([
  'https://northstar-os.ai',
  'https://www.northstar-os.ai',
]);

function configuredOrganizationId() {
  return process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
}

function cookieValue(req, name) {
  const source = String(req.headers.cookie || '').split(';');
  for (const part of source) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch (_error) { return ''; }
  }
  return '';
}

function commandCenterToken(req, res) {
  let token = commandCenterRepository.token(cookieValue(req, DEMO_COOKIE));
  if (token) return token;
  token = commandCenterRepository.issue();
  res.cookie(DEMO_COOKIE, token.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.secureCookies,
    path: '/',
    maxAge: Math.max(1, token.expiresAt.getTime() - Date.now()),
  });
  return token;
}

function demoWorkspace(record) {
  return buildDemoWorkspace({
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    state: record.state,
    revision: record.revision,
    simulationCount: record.simulationCount,
    persisted: record.persisted,
    expiresAt: record.expiresAt,
  });
}

function demoCanonicalContext(workspace) {
  return Object.freeze({
    organizationId: workspace.tenant.id,
    userId: workspace.viewer.id,
    sessionId: workspace.session.id,
    explicitSession: workspace.session.id,
  });
}

function demoCanonicalFilters(items, query) {
  let result = items;
  if (query.status) {
    result = result.filter(function (item) { return item.opportunity.status === query.status; });
  }
  if (query.customerId) {
    result = result.filter(function (item) { return item.ids.customer === query.customerId; });
  }
  const parsedLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isSafeInteger(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 100;
  return result.slice(0, limit);
}

async function demoCanonicalProjection(req, res, compatibility) {
  res.set('Cache-Control', 'no-store');
  res.vary('Cookie');
  if (!SURFACES.has(req.params.surface)) {
    return res.status(404).json({
      success: false,
      error: { code: 'demo_surface_not_found', message: 'Demo surface not found.' },
    });
  }
  try {
    const token = commandCenterToken(req, res);
    const record = await commandCenterRepository.read(token);
    const workspace = demoWorkspace(record);
    const items = demoCanonicalFilters(demoCanonicalItems(workspace), req.query || {});
    const context = demoCanonicalContext(workspace);
    const calendarTimeZoneAuthority = req.params.surface === 'calendar'
      ? demoCalendarTimeZoneAuthority(workspace) : null;
    let data = compatibility
      ? compatibilityProjection(req.params.surface, items, context, calendarTimeZoneAuthority)
      : surfaceProjection(req.params.surface, items, context);
    if(req.params.surface==='calendar')data={...data,schedulingOperator:workspace.schedulingOperator,schedulingOverview:workspace.schedulingOverview,digest:sha256({projection:data.digest,operator:workspace.schedulingOperator.digest,overview:workspace.schedulingOverview.digest})};
    return res.json({ success: true, data });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
}

function commandCenterFailure(req, res, error) {
  const known = error instanceof DemoCommandCenterError ||
    (error && Number.isInteger(error.status) && typeof error.code === 'string');
  const status = known ? error.status : 503;
  return res.status(status).json({
    success: false,
    requestId: req.requestId || req.correlationId || 'unavailable',
    error: {
      code: known ? String(error.code).toLowerCase() : 'demo_command_center_unavailable',
      message: known && status < 500 ? error.message : 'The isolated account-free demo is temporarily unavailable.',
    },
  });
}

function exactBody(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function mutationBoundary(req, res, intent) {
  const origin = req.get('Origin');
  const expectedOrigin = req.protocol + '://' + req.get('host');
  const fetchSite = req.get('Sec-Fetch-Site');
  const recognizedProductionOrigin = config.auth.secureCookies && PRODUCTION_DEMO_ORIGINS.has(origin);
  if (!origin || (!recognizedProductionOrigin && origin !== expectedOrigin) ||
      (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
    res.status(403).json({
      success: false,
      error: { code: 'demo_same_origin_required', message: 'Demo actions require the same NorthStar origin.' },
    });
    return false;
  }
  if (req.get('X-NorthStar-Demo-Intent') !== intent) {
    res.status(403).json({
      success: false,
      error: { code: 'demo_intent_required', message: 'The explicit demo action intent is required.' },
    });
    return false;
  }
  return true;
}

function scenarioSelection(body) {
  if (exactBody(body, ['expectedRevision', 'scenario'])) {
    return normalizeSelection(body.scenario);
  }
  // One-release compatibility for a cached pre-restoration demo client. The
  // old service-only request maps to the new contract defaults and remains
  // subject to the same origin, intent, CAS, idempotency, and admission gates.
  if (exactBody(body, ['expectedRevision', 'service']) &&
      Object.prototype.hasOwnProperty.call(DEMO_SERVICES, body.service)) {
    return normalizeSelection({ ...DEFAULT_SELECTION, service: body.service });
  }
  return null;
}

function durableSourceHash(req) {
  const secret = config.auth.accessSecret;
  const source = typeof req.ip === 'string' ? req.ip.trim() : '';
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 ||
      !source || Buffer.byteLength(source, 'utf8') > 128) {
    throw new DemoCommandCenterError(
      503, 'DEMO_ADMISSION_UNAVAILABLE', 'The isolated demo admission authority is unavailable.'
    );
  }
  return crypto.createHmac('sha256', secret)
    .update('northstar-demo-command-center-admission-v1\0', 'utf8')
    .update(source, 'utf8')
    .digest('hex');
}

function errorResponse(res, error) {
  if (error && error.code === 'DEMO_SESSION_NOT_FOUND') {
    return res.status(404).json({ success: false, error: { code: 'demo_session_not_found', message: 'Demo session not found.' } });
  }
  if (error && ['DEMO_UNAVAILABLE', 'CANONICAL_PERSISTENCE_UNAVAILABLE',
    'CANONICAL_BUSINESS_PROFILE_REQUIRED', 'INTEGRATION_OWNERSHIP_UNKNOWN'].includes(error.code)) {
    return res.status(503).json({ success: false, error: { code: 'demo_unavailable', message: 'The public demo is unavailable.' } });
  }
  const status = error && error.status ? error.status : 503;
  return res.status(status).json({
    success: false,
    error: {
      code: error && error.code ? String(error.code).toLowerCase() : 'demo_unavailable',
      message: status >= 500 ? 'The public demo is temporarily unavailable.' : error.message,
    },
    demoSessionId: error && error.canonicalSessionId ? error.canonicalSessionId : undefined,
  });
}

function statusBody(lifecycle) {
  const session = lifecycle.session;
  const callStatus = lifecycle.lifecycle === 'pending' ? 'live' : lifecycle.lifecycle;
  return {
    success: true,
    sessionId: session.externalSessionId,
    callId: session.externalSessionId,
    callStatus,
    canonicalStatus: session.status,
    lifecycle: lifecycle.lifecycle,
    persistence: 'postgresql',
    profile: session.profile,
    estimate: lifecycle.estimate,
    polarisEstimate: lifecycle.estimate.status === 'ready' ? lifecycle.estimate.snapshot : null,
    polarisState: lifecycle.estimate.status,
    transcriptLineCount: lifecycle.transcript.length,
    providerFailure: session.status === 'failed'
      ? lifecycle.entries.find(function (entry) { return entry.event === 'provider_creation_failed'; }) || null
      : null,
  };
}

router.get('/status', async function (_req, res) {
  try {
    await getProvisionedDemoOrganization(db.getPool(), configuredOrganizationId());
    return res.json({
      status: 'ok',
      available: true,
      persistence: 'postgresql',
      canonicalLifecycle: true,
      outboundCalls: false,
      guidedPreview: false,
      browserWebCall: true,
    });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/industries', function (_req, res) {
  return res.json({
    industries: Object.keys(scenarios).map(function (key) {
      return { id: key, name: scenarios[key].displayName };
    }),
  });
});

router.get('/command-center', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.vary('Cookie');
  try {
    const token = commandCenterToken(req, res);
    const record = await commandCenterRepository.read(token);
    return res.json({ success: true, data: demoWorkspace(record) });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.get('/command-center/operator-targets',async function(req,res){
 res.set('Cache-Control','no-store');res.vary('Cookie');
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res));const workspace=demoWorkspace(record);const workforce=require('../commandCenter/demoWorkforce');return res.json({success:true,data:workforce.page(workforce.read(record.state),workspace.tenant.id,req.query)});}
 catch(error){return res.status(error.status||503).json({success:false,error:{message:'Team search is unavailable. Refresh and search again.'}});}
});

function operationsFailure(req,res,error) {
 const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
 const known=typeof error.code==='string'&&/^DEMO_(?:WORK_|OPERATIONS_|COMPLETION_|PROGRESS_|EVIDENCE_|CHECKLIST_|SESSION_|REVISION_|IDEMPOTENCY_)/.test(error.code);
 const fallback={400:'Check the required work details.',403:'These work controls are unavailable for this session.',404:'That saved work is unavailable. Choose a job from Operations.',409:'The saved work changed. Refresh and review your action again.',410:'This session or completion request expired. Refresh to review the saved work.',429:'This demo reached its action limit. Saved work remains available.',503:'Work updates are unavailable. Refresh to check the saved work before trying again.'};
 const limitKind=status===429?(error.code==='DEMO_SESSION_LIMIT'?'session':error.code==='DEMO_WORK_CAPACITY'?'saved_work':'temporary'):null;
 return res.status(status).json({success:false,error:{message:known?error.message:fallback[status]||'Work details are temporarily unavailable.',...(limitKind?{limitKind}: {})}});
}
for (const [path,select] of [
 ['/command-center/operations',()=>({})],
 ['/command-center/operations/overview',req=>({overview:true,filter:req.query.state||'active'})],
 ['/command-center/operations/appointments/:appointmentId',req=>({appointmentId:req.params.appointmentId})],
 ['/command-center/operations/executions/:executionId/completion-review',req=>({executionId:req.params.executionId,review:true})],
]) router.get(path,async function(req,res){
 res.set('Cache-Control','no-store');res.vary('Cookie');
 try{const value=await commandCenterRepository.readOperations(commandCenterToken(req,res),select(req));return res.json(value.review?{success:true,data:value.review,demoWorkspaceRevision:value.demoWorkspaceRevision}:{success:true,data:value});}
 catch(error){return operationsFailure(req,res,error);}
});
router.post('/command-center/operations/appointments/:appointmentId/actions',express.json({limit:'32kb'}),async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'owner-operations'))return;
 try{
  const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'work_action',appointmentId:req.params.appointmentId,
   operations:req.body,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});
  return res.status(result.replayed?200:201).json({...result.operationsResponse,replayed:result.replayed,demoWorkspaceRevision:result.record.revision});
 }catch(error){return operationsFailure(req,res,error);}
});

for(const [suffix,operation] of [['mutation-previews','schedule_preview'],['mutation-approvals','schedule_approve']]) {
 router.post('/command-center/appointments/:appointmentId/'+suffix,express.json({limit:'64kb'}),async function(req,res){
  res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'schedule-times'))return;
  try {
   const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation,appointmentId:req.params.appointmentId,scheduleBody:req.body,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});
   return res.status(result.replayed?200:201).json({success:true,data:result.schedulingResponse,replayed:result.replayed});
  }catch(error){
   const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
   const messages={400:'Check the appointment, start and end times, reason and acknowledgements.',403:'This demo cannot change that appointment.',404:'That demo appointment is unavailable.',409:'The demo changed. Refresh and review the appointment again.',410:'This session or preview expired. Refresh and review again.',428:'Refresh the appointment before reviewing a change.',429:'This demo reached its action limit. Saved schedules remain available.',503:'Scheduling changes are unavailable. Refresh to check the saved appointment.'};
   return res.status(status).json({success:false,error:{message:messages[status]||'The scheduling request could not be completed.',...(status===503&&error.code==='DEMO_SCHEDULE_PAUSED'?{code:'DEMO_SCHEDULE_PAUSED'}:{})}});
  }
 });
}

router.post('/command-center/simulations/leads', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  if (!mutationBoundary(req, res, 'simulate-lead')) return undefined;
  const selectedScenario = scenarioSelection(req.body);
  if (!selectedScenario) {
    return res.status(422).json({
      success: false,
      error: { code: 'demo_scenario_invalid', message: 'Choose one supported fictional demo scenario.' },
    });
  }
  try {
    const token = commandCenterToken(req, res);
    const result = await commandCenterRepository.mutate(token, {
      operation: 'simulate_lead',
      expectedRevision: req.body.expectedRevision,
      scenarioSelection: selectedScenario,
      idempotencyKey: req.get('Idempotency-Key'),
    }, { sourceHash: durableSourceHash(req) });
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      replayed: result.replayed,
      data: demoWorkspace(result.record),
    });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.post('/command-center/reset', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  if (!mutationBoundary(req, res, 'reset')) return undefined;
  if (!exactBody(req.body, ['expectedRevision'])) {
    return res.status(400).json({
      success: false,
      error: { code: 'demo_reset_invalid', message: 'Refresh the demo before resetting it.' },
    });
  }
  try {
    const token = commandCenterToken(req, res);
    const result = await commandCenterRepository.mutate(token, {
      operation: 'reset',
      expectedRevision: req.body.expectedRevision,
      idempotencyKey: req.get('Idempotency-Key'),
    }, { sourceHash: durableSourceHash(req) });
    return res.json({ success: true, replayed: result.replayed, data: demoWorkspace(result.record) });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.get('/command-center/canonical/compat/:surface', function (req, res) {
  return demoCanonicalProjection(req, res, true);
});

router.get('/command-center/canonical/surfaces/:surface', function (req, res) {
  return demoCanonicalProjection(req, res, false);
});

router.post('/command-center/estimates/:estimateId/equipment-readiness-plans',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'equipment-readiness'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the equipment readiness entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'equipment_ready',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='EQUIPMENT_READINESS_PAUSED'?'equipment_readiness_paused':e.category,message:e.status?e.message:'Demo equipment readiness is unavailable. Refresh to check saved history.'}});}
});
router.post('/command-center/estimates/:estimateId/equipment-readiness-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'equipment-readiness'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the equipment readiness entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const c=require('../estimating/equipmentReadinessContract'),d=require('../commandCenter/demoEquipmentReadiness'),review=buildRevisionReview(item,selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);
 const body=c.normalize({...req.body,confirmed:true}),current=record.state.equipmentReadinessPlans?.[item.ids.estimate]?.[0];if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter equipment readiness to review.'}});c.checkBasis(body,review,current);d.replacementCheck(record.state,item,body.inputs);
 const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now,result=c.evaluate(body.inputs,d.rawSources(record.state,item,body.inputs,now),now);
 return res.json({success:true,data:{result,assessment:c.assessment(result),sourcePins:review.pins,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{category:e.category,message:e.status?e.message:'Demo equipment readiness is unavailable. Refresh and try again.'}});}
});
for(const [suffix,operation]of [['commercial-terms','commercial_terms'],['commercial-approvals','commercial_ok']]){
 router.post('/command-center/estimates/:estimateId/'+suffix,async function(req,res){res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'commercial-terms'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the commercial entries.'}});
  try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation,estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='COMMERCIAL_PAUSED'?'commercial_paused':e.code==='COMMERCIAL_HISTORY_LIMIT'?'commercial_history_limit':undefined,message:e.status?e.message:'Demo commercial terms are unavailable. Refresh to check saved history.'}});}
 });
}
router.post('/command-center/estimates/:estimateId/commercial-preview',async function(req,res){res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'commercial-terms'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the commercial entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),now=new Date((await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now);if(new Date(record.expiresAt)<=now)return res.status(410).json({success:false,error:{message:'This demo session expired. Refresh to start again.'}});
 const c=require('../estimating/commercialContract'),x=require('../commandCenter/demoCommercial').context(demoWorkspace(record),record.state,req.params.estimateId,now),body=c.normalize({...req.body,confirmed:true});if(!require('../estimating/commercialWritePolicy').mutationsEnabled)return res.status(503).json({success:false,error:{category:'commercial_paused',message:'New commercial terms and approvals are paused. Refresh to check saved history.'}});if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter commercial terms to calculate.'}});c.checkBasis(body,x.review,record.state.commercialTerms?.[req.params.estimateId]?.[0]);if(body.evidenceDigest!==x.sources.digest)c.changed();return res.json({success:true,data:c.preview(body.inputs,body.currency,x.sources,now)});
 }catch(e){return res.status(e.status||503).json({success:false,error:{message:e.status?e.message:'Commercial terms are unavailable. Refresh to check saved history.'}});}
});
router.get('/command-center/tax-preparation',async function(req,res){res.set('Cache-Control','no-store');try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),now=new Date((await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now);if(new Date(record.expiresAt)<=now)return res.status(410).json({success:false,error:{message:'This demo session expired. Refresh to start again.'}});return res.json({success:true,data:{...require('../commandCenter/demoTaxPreparation').read(record.state,now),demoWorkspaceRevision:record.revision,mutationsPaused:!require('../estimating/commercialWritePolicy').mutationsEnabled||!require('../estimating/commercialWritePolicy').preparationEnabled}});}catch(e){return res.status(e.status||503).json({success:false,error:{message:e.status?e.message:'Tax preparation is unavailable. Refresh to check saved setup.'}});}});
router.post('/command-center/tax-preparation',async function(req,res){res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'tax-preparation'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the tax setup entries.'}});try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'tax_profile',expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='COMMERCIAL_PAUSED'?'commercial_paused':e.code==='COMMERCIAL_HISTORY_LIMIT'?'commercial_history_limit':undefined,message:e.status?e.message:'Tax setup is unavailable. Refresh to check saved history.'}});}});
router.post('/command-center/estimates/:estimateId/pricing-policies',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'pricing-policy'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the pricing entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'pricing_policy',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='PRICING_POLICY_PAUSED'?'pricing_policy_paused':e.code==='PRICING_POLICY_OVERLAP'?'cost_overlap':e.code==='PRICING_POLICY_HISTORY_LIMIT'?'pricing_policy_history_limit':undefined,message:e.status?e.message:'Demo pricing policies are unavailable. Refresh to check saved history.'}});}
});
router.post('/command-center/estimates/:estimateId/pricing-policy-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'pricing-policy'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the pricing entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const c=require('../estimating/pricingPolicyContract'),d=require('../estimating/pricingPolicySources'),selection=selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),review=buildRevisionReview(item,selection,{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);
 const body=c.normalize({...req.body,confirmed:true}),current=record.state.pricingPolicies?.[item.ids.estimate]?.[0]||null;if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter a pricing policy to calculate.'}});c.checkBasis(body,review,current);
 if(!require('../estimating/pricingPolicyWritePolicy').mutationsEnabled)return res.status(503).json({success:false,error:{category:'pricing_policy_paused',message:'New pricing policies are paused. Refresh to check saved history.'}});
 const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;
 if(new Date(record.expiresAt)<=new Date(now))return res.status(410).json({success:false,error:{message:'This demo session expired. Refresh to start again.'}});return res.json({success:true,data:{...c.preview(body.inputs,body.currency,d.demo(record.state,item,review,new Date(now)),now),sourcePins:review.pins,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='PRICING_POLICY_OVERLAP'?'cost_overlap':undefined,message:e.status?e.message:'Demo pricing policies are unavailable. Refresh and try again.'}});}
});
router.post('/command-center/estimates/:estimateId/pricing-plans',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'pricing-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the pricing entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'pricing_plan',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='PRICING_PLAN_PAUSED'?'pricing_paused':e.code==='PRICING_PLAN_OVERLAP'?'cost_overlap':e.code==='PRICING_HISTORY_LIMIT'?'pricing_history_limit':undefined,message:e.status?e.message:'Demo pricing plans are unavailable. Refresh to check saved history.'}});}
});
router.post('/command-center/estimates/:estimateId/pricing-plan-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'pricing-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the pricing entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const c=require('../estimating/pricingPlanContract'),d=require('../estimating/pricingSourceBasis'),selection=selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),review=buildRevisionReview(item,selection,{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);
 const body=c.normalize({...req.body,confirmed:true}),current=record.state.pricingPlans?.[item.ids.estimate]?.[0]||null;if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter proposed charges to calculate.'}});c.checkBasis(body,review,current);
 if(!require('../estimating/pricingPlanPolicy').mutationsEnabled)return res.status(503).json({success:false,error:{category:'pricing_paused',message:'New pricing plans are paused. Refresh to check saved history.'}});
 const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;
 if(new Date(record.expiresAt)<=new Date(now))return res.status(410).json({success:false,error:{message:'This demo session expired. Refresh to start again.'}});return res.json({success:true,data:{...c.preview(body.inputs,body.currency,d.demo(record.state,item,review,new Date(now)),now),sourcePins:review.pins,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='PRICING_PLAN_OVERLAP'?'cost_overlap':undefined,message:e.status?e.message:'Demo pricing plans are unavailable. Refresh and try again.'}});}
});
router.post('/command-center/estimates/:estimateId/travel-plans',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'travel-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the travel entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'travel_plan',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='TRAVEL_PLAN_PAUSED'?'travel_paused':e.code==='TRAVEL_PLAN_OVERLAP'?'cost_overlap':e.code==='TRAVEL_HISTORY_LIMIT'?'travel_history_limit':undefined,message:e.status?e.message:'Demo travel costs are unavailable. Refresh to check saved history.'}});}
});
router.post('/command-center/estimates/:estimateId/travel-plan-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'travel-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the travel entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const c=require('../estimating/travelPlanContract'),d=require('../commandCenter/demoTravel'),selection=selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),review=buildRevisionReview(item,selection,{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);
 const body=c.normalize({...req.body,confirmed:true}),current=record.state.travelPlans?.[item.ids.estimate]?.[0]||null;if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter travel costs to calculate.'}});c.checkBasis(body,review,current);
 if(!require('../estimating/travelPlanPolicy').mutationsEnabled)return res.status(503).json({success:false,error:{category:'travel_paused',message:'New travel plans are paused. Refresh to check saved history.'}});
 const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;
 return res.json({success:true,data:{result:{...c.calculate(body.inputs,body.currency),resourceReview:require('../estimating/travelResourceBasis').review(body.inputs,d.sources(record.state,item))},assessment:c.assess(body.inputs,d.sources(record.state,item),now),sourcePins:review.pins,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='TRAVEL_PLAN_OVERLAP'?'cost_overlap':undefined,message:e.status?e.message:'Demo travel costs are unavailable. Refresh and try again.'}});}
});
router.post('/command-center/estimates/:estimateId/equipment-cost-plans',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'equipment-cost'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the equipment cost entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'equipment_cost',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='EQUIPMENT_COST_PAUSED'?'equipment_cost_paused':e.code==='EQUIPMENT_COST_OVERLAP'?'cost_overlap':undefined,message:e.status?e.message:'Demo equipment costs are unavailable. Refresh to check saved history.'}});}
});
router.post('/command-center/estimates/:estimateId/equipment-cost-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'equipment-cost'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the equipment cost entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const c=require('../estimating/equipmentCostPlanContract'),composition=require('../estimating/equipmentCostComposition'),selection=selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),review=buildRevisionReview(item,selection,{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);
 const body=c.normalize({...req.body,confirmed:true}),current=record.state.equipmentCostPlans?.[item.ids.estimate]?.[0]||null,plan=record.state.equipmentPlans?.[item.ids.estimate]?.[0];if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter equipment costs to calculate.'}});c.checkBasis(body,review,current);
 const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now,equipmentResult=c.checkEquipmentBasis(body.inputs,plan,demoEquipment.sources(record.state,item,plan?.inputs),now),outsideBasis=composition.outsideBasis(selection,{...item,sourcePins:selection.originalPins});c.checkCoverage(body.inputs,outsideBasis);
 return res.json({success:true,data:{result:c.calculate(body.inputs,body.currency),assessment:c.assess(body.inputs,equipmentResult,now),sourcePins:review.pins,decisionBasis:review.decisions.writeBasis,outsideBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{category:e.code==='EQUIPMENT_COST_OVERLAP'?'cost_overlap':undefined,message:e.status?e.message:'Demo equipment costs are unavailable. Refresh and try again.'}});}
});
router.post('/command-center/estimates/:estimateId/equipment-plans',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'equipment-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the equipment plan entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'equipment_plan',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.status===503&&e.code==='EQUIPMENT_PLAN_PAUSED'?'equipment_paused':undefined,message:e.status?e.message:'Demo equipment plans are unavailable.'}});}
});
router.post('/command-center/estimates/:estimateId/equipment-plan-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'equipment-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the equipment plan entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res));const item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const review=buildRevisionReview(item,selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);const current=(record.state.equipmentPlans?.[item.ids.estimate]||[])[0]||null;const body=equipmentPlan.normalize({...req.body,confirmed:true});if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter a equipment plan to calculate.'}});equipmentPlan.checkBasis(body,review,current);const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;const result=equipmentPlan.evaluate(body.inputs,demoEquipment.sources(record.state,item,body.inputs),now);return res.json({success:true,data:{result,assessment:equipmentPlan.assessment(result),sourcePins:review.pins,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{message:e.status?e.message:'Demo equipment planning is unavailable.'}});}
});

router.post('/command-center/estimates/:estimateId/labor-plans',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'labor-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the labor plan entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'labor_plan',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.status===503&&e.code==='LABOR_PLAN_PAUSED'?'labor_paused':undefined,message:e.status?e.message:'Demo labor plans are unavailable.'}});}
});
router.post('/command-center/estimates/:estimateId/labor-plan-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'labor-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the labor plan entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res));const item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const review=buildRevisionReview(item,selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);const current=(record.state.laborPlans?.[item.ids.estimate]||[])[0]||null;const body=laborPlan.normalize({...req.body,confirmed:true});if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter a labor plan to calculate.'}});laborPlan.checkBasis(body,review,current);const result=laborPlan.calculate(body.inputs,body.currency,body.confirmationVersion);const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;result.assessment=laborPlan.assess(body.inputs,now);return res.json({success:true,data:{result,sourcePins:review.pins,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{message:e.status?e.message:'Demo labor planning is unavailable.'}});}
});

router.post('/command-center/estimates/:estimateId/material-plans',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'material-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the material plan entries.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'material_plan',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{message:e.status?e.message:'Demo material plans are unavailable.'}});}
});
router.post('/command-center/estimates/:estimateId/material-plan-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'material-plan'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the material plan entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res));const item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const review=buildRevisionReview(item,selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);const current=(record.state.materialPlans?.[item.ids.estimate]||[])[0]||null;const body=materialPlan.normalize({...req.body,confirmed:true});if(body.action!=='save')return res.status(400).json({success:false,error:{message:'Enter a material plan to calculate.'}});materialPlan.checkBasis(body,review,current);const result=materialPlan.calculate(body.inputs,body.currency,body.confirmationVersion);if([materialPlan.V3,materialPlan.V4].includes(body.confirmationVersion)){const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;result.sourceAssessment=require('../estimating/materialSourceContract').assess(body.inputs,body.currency,{now,serviceKey:review.materialSourceContext.serviceKey});if(body.confirmationVersion===materialPlan.V4)result.availabilityAssessment=require('../estimating/materialAvailabilityContract').assess(body.inputs,result,{now});}return res.json({success:true,data:{result,sourcePins:review.pins,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{message:e.status?e.message:'Demo material planning is unavailable.'}});}
});

router.post(['/command-center/estimates/:estimateId/material-adoptions','/command-center/estimates/:estimateId/cost-adoptions'],async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'material-adoption'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check this estimate and material plan.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'estimate_adopt',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),adoption:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});}catch(e){return res.status(e.status||503).json({success:false,error:{category:e.status===503&&e.code==='ESTIMATE_ADOPTION_PAUSED'?'adoption_paused':undefined,message:e.status?e.message:'Demo estimate changes are unavailable.'}});}
});
router.post('/command-center/estimates/:estimateId/cost-adoption-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'material-adoption'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check this estimate and material plan.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res));const item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
      if(!adoptionPolicy.mutationsEnabled)throw Object.assign(new Error('New estimate changes are paused. Refresh to check saved history.'),{status:503,code:'ESTIMATE_ADOPTION_PAUSED'});
 const selection=selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),review=buildRevisionReview(item,selection,{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);
 const composition=req.body?.confirmationVersion==='estimate-cost-adoption-v3'?require('../estimating/travelCostComposition'):req.body?.confirmationVersion==='estimate-cost-adoption-v2'?require('../estimating/equipmentCostComposition'):require('../estimating/costAdoptionContract'),body=composition.normalize({...req.body,confirmed:true}),plan=(body.changedComponent==='travel'?record.state.travelPlans:body.changedComponent==='equipment'?record.state.equipmentCostPlans:body.changedComponent==='labor'?record.state.laborPlans:record.state.materialPlans)?.[item.ids.estimate]?.[0];composition.checkBasis(body,review,selection,plan);const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;if(body.changedComponent==='equipment'){const saved=record.state.equipmentPlans?.[item.ids.estimate]?.[0];require('../estimating/equipmentCostPlanContract').checkEquipmentBasis(plan.inputs,saved,demoEquipment.sources(record.state,item,saved?.inputs),now);}if(body.changedComponent==='travel'&&plan.evidence?.digest!==require('../commandCenter/demoTravel').sources(record.state,item).digest)throw Object.assign(new Error('Travel sources changed. Refresh and review the saved plan.'),{status:409});return res.json({success:true,data:composition.preview(item,selection,review,plan,body.changedComponent,now,body.coverage)});
 }catch(e){return res.status(e.status||503).json({success:false,error:{category:e.status===503&&e.code==='ESTIMATE_ADOPTION_PAUSED'?'adoption_paused':undefined,message:e.status?e.message:'Demo estimate changes are unavailable.'}});}
});

router.post('/command-center/estimates/:estimateId/material-adoption-preview',async function(req,res){
 res.set('Cache-Control','no-store');if(!mutationBoundary(req,res,'material-adoption'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check this estimate and material plan.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res));const item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
      if(!adoptionPolicy.mutationsEnabled)throw Object.assign(new Error('New estimate changes are paused. Refresh to check saved history.'),{status:503,code:'ESTIMATE_ADOPTION_PAUSED'});
 const review=buildRevisionReview(item,selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[]),{simulated:true});review.decisions=projectSelectedDemoDecisions(record.state.estimateDecisions?.[item.ids.estimate]||[],review,true);
 const plan=record.state.materialPlans?.[item.ids.estimate]?.[0],body=adoption.normalize({...req.body,confirmed:true});adoption.checkBasis(body,review,plan);if([materialPlan.V3,materialPlan.V4].includes(plan.calculationVersion)){const now=(await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now;materialPlan.checkEvidence(plan.inputs,plan.currency,plan.calculationVersion,{now,serviceKey:review.materialSourceContext.serviceKey},true);}
 return res.json({success:true,data:{result:adoption.calculate(item,plan,body.confirmationVersion),sourcePins:review.pins,planId:plan.id,planDigest:plan.digest,decisionBasis:review.decisions.writeBasis}});
 }catch(e){return res.status(e.status||503).json({success:false,error:{category:e.status===503&&e.code==='ESTIMATE_ADOPTION_PAUSED'?'adoption_paused':undefined,message:e.status?e.message:'Demo estimate changes are unavailable.'}});}
});

router.post('/command-center/estimates/:estimateId/decisions', async function(req,res) {
  res.set('Cache-Control','no-store');
  if(!mutationBoundary(req,res,'estimate-decision'))return;
  if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'This review could not be read. Check your entries.'}});
  try {
    const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'estimate_review',estimateId:req.params.estimateId,
      expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),decision:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});
    return res.status(result.replayed?200:201).json({success:true,data:{replayed:result.replayed}});
  }catch(error){return commandCenterFailure(req,res,error);}
});

async function assembleDemoCapellaReview(record,item,req){
    const selected=req.query.revision===undefined?null:Number(req.query.revision);
    const review=buildRevisionReview(item,selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[],selected),{simulated:true});
    const history=record.state.estimateDecisions?.[req.params.estimateId] || [];
    review.decisions=projectSelectedDemoDecisions(history,review,decisionPolicy.mutationsEnabled);
    review.approval=review.decisions.status;review.approvalMessage=review.decisions.message;review.demoWorkspaceRevision=record.revision;
    review.riskReview=buildCapellaReview(review, item.snapshot);
    review.materialReview = buildMaterialReview(review, item.snapshot);
    const labor=record.state.laborPlans?.[item.ids.estimate]||[];review.costComponents=require('../estimating/costAdoptionContract').components(selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[],selected));
    review.equipmentPlans=await demoEquipment.project(record.state,item,review);
    review.equipmentReadiness=await require('../commandCenter/demoEquipmentReadiness').project(record.state,item,review);
    {const c=require('../estimating/pricingPlanContract'),p=require('../estimating/pricingPlanPolicy'),history=record.state.pricingPlans?.[item.ids.estimate]||[];review.pricingPlans=c.project({current:history[0]||null,history,total:history.length},review,require('../estimating/pricingSourceBasis').demo(record.state,item,review),p.mutationsEnabled,true,!p.mutationsEnabled,new Date());}
    {const c=require('../estimating/pricingPolicyContract'),p=require('../estimating/pricingPolicyWritePolicy'),history=record.state.pricingPolicies?.[item.ids.estimate]||[];review.pricingPolicies=c.project({current:history[0]||null,history,total:history.length},review,require('../estimating/pricingPolicySources').demo(record.state,item,review),p.mutationsEnabled,true,!p.mutationsEnabled,new Date());}
    review.pricingPolicyCheck=require('../estimating/pricingPolicyContract').policyCheck(review.pricingPolicies);
    {const p=require('../estimating/commercialWritePolicy'),c=require('../estimating/commercialSources'),history=record.state.commercialTerms?.[item.ids.estimate]||[];review.commercialTerms=c.project({current:history[0]||null,history,total:history.length,binding:record.state.commercialApprovals?.[item.ids.estimate]?.[0]||null},review,c.demo(record.state,item,review),{},p.mutationsEnabled,true,!p.mutationsEnabled);c.applyCommercialPolicy(review);}

    review.travelPlans=require('../commandCenter/demoTravel').project(record.state,item,review);
    const costSelection=selectDemoRevision(item,record.state.estimateRevisions?.[item.ids.estimate]||[],selected);review.equipmentCostComponents=require('../estimating/equipmentCostComposition').components(costSelection);if(costSelection.selected?.calculationVersion==='estimate-cost-adoption-v2')review.costComponents=review.equipmentCostComponents;
    const equipmentCosts=record.state.equipmentCostPlans?.[item.ids.estimate]||[],costPolicy=require('../estimating/equipmentCostPlanPolicy');review.equipmentCostPlans=require('../estimating/equipmentCostPlanContract').project({current:equipmentCosts[0]||null,history:equipmentCosts,total:equipmentCosts.length},review,review.isCurrent&&costPolicy.mutationsEnabled,true,!costPolicy.mutationsEnabled);
    review.equipmentOutsideBasis=require('../estimating/equipmentCostComposition').outsideBasis(costSelection,{...item,sourcePins:costSelection.originalPins});
    review.travelCostComponents=require('../estimating/travelCostComposition').components(costSelection);if(costSelection.selected?.calculationVersion==='estimate-cost-adoption-v3')review.costComponents=review.travelCostComponents;
    review.laborPlans=laborPlan.project({current:labor[0]||null,history:labor,total:labor.length},review,review.isCurrent&&laborPlanPolicy.mutationsEnabled,true,!laborPlanPolicy.mutationsEnabled);
    const plans=record.state.materialPlans?.[item.ids.estimate]||[];review.materialPlans=materialPlan.project({current:plans[0]||null,history:plans,total:plans.length},review,review.isCurrent&&materialPlanPolicy.mutationsEnabled,true,!materialPlanPolicy.mutationsEnabled);
    review.travelCoverageChoices=require('../estimating/travelCostComposition').coverageChoices(review);
    review.canAdopt=review.isCurrent&&adoptionPolicy.mutationsEnabled;review.adoptionPaused=!adoptionPolicy.mutationsEnabled;
    const candidates=demoCanonicalItems(demoWorkspace(record)).sort((a,b)=>Date.parse(b.snapshotCreatedAt)-Date.parse(a.snapshotCreatedAt)||a.ids.estimate.localeCompare(b.ids.estimate));
    review.groundedRecommendations=require('../polaris/groundedRecommendations').build(review,item,{candidates:candidates.slice(0,50),hasMore:candidates.length>50});
    review.capellaScenarios=require('../estimating/capellaScenarios').basis(review,item);
    return review;
}
router.post('/command-center/polaris/messages-v2', require('../polaris/demoGrounded').createHandler({
 boundary:mutationBoundary,getToken:commandCenterToken,repository:commandCenterRepository,getPool:()=>db.getPool(),sourceHash:durableSourceHash,
 loadContext:async(record,request)=>{
  const workspace=demoWorkspace(record),item=demoCanonicalItems(workspace).find(x=>require('../polaris/assistantContract').selectedMatchesItem(x,request.selected));
  if(!item)throw Object.assign(new Error('That demo record is unavailable. Refresh and select another record.'),{statusCode:404,code:'POLARIS_SELECTED_RECORD_NOT_FOUND'});
  const review=await assembleDemoCapellaReview(record,item,{params:{estimateId:item.ids.estimate},query:request.selectedRevision===null?{}:{revision:request.selectedRevision}});
  const card=require('../polaris/assistantContract').buildCustomerIntelligenceCard(item,request.selected),authority={organizationId:workspace.tenant.id,userId:workspace.viewer.id,role:'owner',sessionId:record.sessionId,revision:record.revision,expiresAt:record.expiresAt};
  const build=require('../polaris/groundedContext'),groundedContext=build.build({message:request.message,authority,card,review});groundedContext.reviewTarget={customerId:item.ids.customer,estimateId:item.ids.estimate,selectedRevision:review.selectedRevision,sourcePins:review.pins,handoffBasis:build.handoffBasis(review)};return build.stableBasis({authority,card,review,groundedContext});
 }
}));

router.post('/command-center/estimates/:estimateId/proposal-adoption-preview',async(req,res)=>{
 res.set('Cache-Control','no-store');res.vary('Cookie');if(!mutationBoundary(req,res,'proposal-adoption'))return;
 if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the prepared estimate entries.'}});
 try{const body=require('../estimating/proposalAdoptionContract').normalize(req.body,{preview:true}),record=await commandCenterRepository.read(commandCenterToken(req,res)),workspace=demoWorkspace(record),item=demoCanonicalItems(workspace).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
 const now=new Date((await commandCenterRepository.pool().query('SELECT clock_timestamp() now')).rows[0].now),prepared=await require('../commandCenter/demoProposalAdoption').prepare(record,item,body,workspace,now);return res.json({success:true,data:prepared.review});
 }catch(e){const error=require('../estimating/proposalAdoptionRepository').failure(e);return res.status(error.status).json({success:false,error:{message:error.message,category:error.code}});}
});
router.post('/command-center/estimates/:estimateId/proposal-adoptions',async(req,res)=>{
 res.set('Cache-Control','no-store');res.vary('Cookie');if(!mutationBoundary(req,res,'proposal-adoption'))return;
 if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the prepared estimate confirmation.'}});
 try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'proposal_adopt',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)});const rows=result.record.state.proposalAdoptions?.[req.params.estimateId]||[],receipt=rows.find(r=>r.requestKey===require('../services/businessProfileAdapter').sha256(req.get('Idempotency-Key'))&&r.requestDigest===require('../estimating/proposalAdoptionContract').requestDigest(req.body));return res.status(result.replayed?200:201).json({success:true,data:{receipt:require('../commandCenter/demoProposalAdoption').publicReceipt(receipt),replayed:result.replayed,demoWorkspaceRevision:result.record.revision}});
 }catch(e){const error=require('../estimating/proposalAdoptionRepository').failure(e);return res.status(error.status).json({success:false,error:{message:error.message,category:error.code}});}
});
router.get('/command-center/estimates/:estimateId/proposal-adoptions',async(req,res)=>{
 res.set('Cache-Control','no-store');res.vary('Cookie');try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),item=demoCanonicalItems(demoWorkspace(record)).find(i=>i.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});const history=record.state.proposalAdoptions?.[item.ids.estimate]||[],expose=require('../commandCenter/demoProposalAdoption').publicReceipt;return res.json({success:true,data:{current:expose(history[0]),history:history.slice(0,20).map(expose),total:history.length,truncated:history.length>20}});}catch(e){return commandCenterFailure(req,res,e);}
});

router.post('/command-center/estimates/:estimateId/proposal-preview',async function(req,res){
 res.set('Cache-Control','no-store');res.vary('Cookie');if(!mutationBoundary(req,res,'proposal-preview'))return;
 if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the prepared estimate entries.'}});
 try{const body=require('../estimating/estimateProposal').normalize(req.body),record=await commandCenterRepository.read(commandCenterToken(req,res));
  const item=demoCanonicalItems(demoWorkspace(record)).find(x=>x.ids.estimate===req.params.estimateId);
  if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});
  const selectedReq=Object.assign(Object.create(req),{query:body.selectedRevision===null?{}:{revision:body.selectedRevision}});
  const review=await assembleDemoCapellaReview(record,item,selectedReq);
  const data=require('../estimating/estimateProposalRepository').demo(record,review,item,body,new Date(),demoWorkspace(record));
  return res.json({success:true,data});
 }catch(e){const status=[400,401,403,404,409,410,413,429,503].includes(e.status)?e.status:503;return res.status(status).json({success:false,error:{message:e.code?.startsWith('PROPOSAL_')||e.code==='ESTIMATE_PROPOSAL_INVALID'?e.message:'This prepared estimate is unavailable. Refresh and try again.'}});}
});
router.post('/command-center/estimates/:estimateId/capella-scenarios',async function(req,res){
 res.set('Cache-Control','no-store');res.vary('Cookie');if(!mutationBoundary(req,res,'capella-scenarios'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Check the scenario entries.'}});
 try{const record=await commandCenterRepository.read(commandCenterToken(req,res));const item=demoCanonicalItems(demoWorkspace(record)).find(x=>x.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});const review=await assembleDemoCapellaReview(record,item,req);return res.json({success:true,data:require('../estimating/capellaScenarios').calculate(review.capellaScenarios,req.body)});}catch(e){const status=[400,401,403,404,409,410,413,429,503].includes(e.status)?e.status:503;return res.status(status).json({success:false,error:{message:e.code&&e.code.startsWith('CAPELLA_')?e.message:status===400?'Check the scenario amounts, source and date range.':'Scenario analysis could not be loaded. Refresh and try again.'}});}
});
router.get('/command-center/estimates/:estimateId/review', async function (req, res) {
  res.set('Cache-Control', 'no-store'); res.vary('Cookie');
  try {
    const token = commandCenterToken(req, res);
    const record = await commandCenterRepository.read(token);
    const item = demoCanonicalItems(demoWorkspace(record)).find(value => value.ids.estimate === req.params.estimateId);
    if (!item) return res.status(404).json({ success: false, error: { message: 'That demo estimate is unavailable.' } });
    const review=await assembleDemoCapellaReview(record,item,req);
    return res.json({ success: true, data: review });
  } catch (_error) {
    return res.status(_error.status===404?404:503).json({ success: false, error: { message: _error.status===404?'That demo estimate is unavailable.':'Demo estimate review could not be loaded. Try again.' } });
  }
});

router.get('/command-center/estimates/:estimateId/customer-estimate-preview', async function (req, res) {
  res.set('Cache-Control', 'no-store'); res.vary('Cookie');
  try {
    const record = await commandCenterRepository.read(commandCenterToken(req, res));
    const workspace = demoWorkspace(record);
    const item = demoCanonicalItems(workspace).find(value => value.ids.estimate === req.params.estimateId);
    if (!item) return res.status(404).json({success:false,error:{code:'CUSTOMER_ESTIMATE_UNAVAILABLE',message:'That demo estimate is unavailable.'}});
    const review = await assembleDemoCapellaReview(record, item, req);
    const data = require('../estimating/customerEstimateProjection').createCustomerEstimatePreview({
      review, item, profile:workspace.configuration.businessProfile, simulated:true,
    });
    return res.json({success:true,data});
  } catch (error) {
    const status = [404,409,410].includes(error && error.status) ? error.status : 503;
    const message = status === 410 ? 'This demo session expired. Refresh to start again.' :
      status === 404 ? 'That demo estimate is unavailable.' :
      error && error.code === 'CUSTOMER_ESTIMATE_NOT_READY' ? error.message :
      'The demo customer estimate is unavailable. Refresh the saved estimate and try again.';
    return res.status(status).json({success:false,error:{code:error && error.code || 'CUSTOMER_ESTIMATE_UNAVAILABLE',message}});
  }
});

router.get('/command-center/estimates/:estimateId/customer-estimate-versions',async function(req,res){
  res.set('Cache-Control','no-store');res.vary('Cookie');
  try{const record=await commandCenterRepository.read(commandCenterToken(req,res)),item=demoCanonicalItems(demoWorkspace(record)).find(value=>value.ids.estimate===req.params.estimateId);if(!item)return res.status(404).json({success:false,error:{message:'That demo estimate is unavailable.'}});const history=record.state.customerEstimateVersions?.[req.params.estimateId]||[];return res.json({success:true,data:{current:history[0]||null,history:history.slice(0,50),total:history.length,truncated:history.length>50}});}
  catch(error){return res.status(error.status===410?410:503).json({success:false,error:{message:error.status===410?'This demo session expired. Refresh to start again.':'Issued demo estimates are unavailable. Refresh and try again.'}});}
});
router.post('/command-center/estimates/:estimateId/customer-estimate-versions',async function(req,res){
  res.set('Cache-Control','no-store');res.vary('Cookie');if(!mutationBoundary(req,res,'customer-estimate-issue'))return;if(!req.estimateDecisionBodyValidated)return res.status(400).json({success:false,error:{message:'Review and confirm this customer estimate before issuing it.'}});
  try{const result=await commandCenterRepository.mutate(commandCenterToken(req,res),{operation:'customer_estimate_issue',estimateId:req.params.estimateId,expectedRevision:Number(req.get('X-NorthStar-Demo-Revision')),plan:req.body,idempotencyKey:req.get('Idempotency-Key')},{sourceHash:durableSourceHash(req)}),history=result.record.state.customerEstimateVersions?.[req.params.estimateId]||[],receipt=history.find(value=>value.requestKey===sha256(req.get('Idempotency-Key')))||history[0];return res.status(result.replayed?200:201).json({success:true,data:{receipt,replayed:result.replayed,demoWorkspaceRevision:result.record.revision}});}
  catch(error){const status=[400,403,404,409,410,413,429,503].includes(error.status)?error.status:503;return res.status(status).json({success:false,error:{category:error.code,message:error.status?error.message:'The demo estimate could not be issued. Refresh to check saved history.'}});}
});

router.get('/command-center/polaris/:kind/:id', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  const idKey = DETAIL_IDENTIFIERS[req.params.kind];
  if (!idKey) return res.status(404).json({ success: false, error: { code: 'demo_detail_not_found', message: 'Demo detail not found.' } });
  try {
    const token = commandCenterToken(req, res);
    const record = await commandCenterRepository.read(token);
    const graph = record.state.graphs.find(item => item && item.ids && item.ids[idKey] === req.params.id);
    if (!graph) return res.status(404).json({ success: false, error: { code: 'demo_detail_not_found', message: 'Demo detail not found.' } });
    return res.json({ success: true, data: graph, integrity: demoWorkspace(record).integrity });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.post('/call', function (_req, res) {
  return res.status(410).json({
    success: false,
    error: {
      code: 'demo_external_action_retired',
      message: 'Public demo outbound calls are unavailable.',
    },
  });
});

async function lifecycle(req, res, project) {
  try {
    const current = await readDemoLifecycle(db.getPool(), configuredOrganizationId(), req.params.id);
    return res.json(project(current));
  } catch (error) {
    return errorResponse(res, error);
  }
}

router.get('/:id/status', function (req, res) {
  return lifecycle(req, res, statusBody);
});

router.get('/:id/transcript', function (req, res) {
  return lifecycle(req, res, function (current) {
    return {
      success: true,
      sessionId: current.session.externalSessionId,
      callStatus: statusBody(current).callStatus,
      lifecycle: current.lifecycle,
      lines: current.transcript,
      count: current.transcript.length,
    };
  });
});

router.get('/:id/timeline', function (req, res) {
  return lifecycle(req, res, function (current) {
    return {
      success: true,
      sessionId: current.session.externalSessionId,
      entries: current.entries,
      count: current.entries.length,
    };
  });
});

router.get('/:id/polaris-estimate', function (req, res) {
  return lifecycle(req, res, function (current) {
    return {
      success: true,
      sessionId: current.session.externalSessionId,
      lifecycle: current.lifecycle,
      estimate: current.estimate,
      polarisEstimate: current.estimate.status === 'ready' ? current.estimate.snapshot : null,
    };
  });
});

router.get('/:id/events', async function (req, res) {
  try {
    const current = await readDemoLifecycle(db.getPool(), configuredOrganizationId(), req.params.id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: connected\ndata: ' + JSON.stringify(statusBody(current)) + '\n\n');
    const heartbeat = setInterval(function () {
      res.write('event: heartbeat\ndata: ' + JSON.stringify({ timestamp: new Date().toISOString() }) + '\n\n');
    }, 15000);
    req.on('close', function () { clearInterval(heartbeat); });
  } catch (error) {
    return errorResponse(res, error);
  }
});

function retiredMutation(_req, res) {
  return res.status(410).json({
    success: false,
    error: { code: 'demo_lifecycle_canonical', message: 'Demo lifecycle is controlled by canonical provider events.' },
  });
}

router.post('/:id/simulate', retiredMutation);
router.post('/:id/advance', retiredMutation);
router.post('/:id/complete', retiredMutation);
router.post('/:id/cancel', retiredMutation);

module.exports = router;
