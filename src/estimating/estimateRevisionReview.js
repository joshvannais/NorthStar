'use strict';
const { buildEstimateReview } = require('../services/estimateReview');
const { stableValue, sha256 } = require('../services/businessProfileAdapter');
const adoption = require('./materialAdoptionContract');
const composition=require('./costAdoptionContract');
const equipmentComposition=require('./equipmentCostComposition');
const { projectDecisions } = require('./decisionContract');

function buildRevisionReview(item, selection, options = {}) {
  const original = buildEstimateReview(item, options);
  const selected = selection.selected;
  const review = { ...original, selectedRevision: selection.selectedRevision,
    currentRevision: selection.currentRevision, isCurrent: selection.isCurrent,
    revisionHistory: selection.history, adoptedMaterialPlan: null };
  if (!selected) return review;
  if (![...adoption.VERSIONS,composition.VERSION,equipmentComposition.VERSION].includes(selected.calculationVersion) || sha256(selected.originalSourcePins) !== sha256(original.pins) ||
      selected.revision !== selection.selectedRevision || selected.pins?.revision?.id !== selected.id ||
      selected.pins?.revision?.digest !== selected.digest) {
    throw Object.assign(new Error('This saved estimate could not be verified. Refresh and try again.'), { status: 503 });
  }
  const composed=[composition.VERSION,equipmentComposition.VERSION].includes(selected.calculationVersion),threeComponents=selected.calculationVersion===equipmentComposition.VERSION,composer=threeComponents?equipmentComposition:composition;
  const pair={material:selected.materialPlan,labor:selected.laborPlan,equipment:selected.equipmentCostPlan};
  if(composed&&sha256(selected.componentManifest)!==sha256(composer.manifest(pair)))throw Object.assign(new Error('Saved cost sources could not be verified. Refresh and try again.'),{status:503});
  const costs = composed?composer.calculate(item,pair):adoption.calculate(item, selected.materialPlan, selected.calculationVersion);
  const costRows = [ ['Recorded material cost', 'knownDirectMaterialCost'], ['Recorded labor cost', 'knownInternalLaborCost'],
    ['Recorded equipment cost', 'knownEquipmentCost'], ['Recorded direct costs', 'knownDirectCosts'],
    ['Recorded travel cost', 'knownTravelInternalCost'] ].map(([label, key]) => {
      const kind={knownDirectMaterialCost:'material',knownInternalLaborCost:'labor',knownEquipmentCost:'equipment',knownTravelInternalCost:'travel'}[key];
      const inactive=kind && costs.applicability[kind]===false;
      return {label,amount:inactive?null:costs[key],sourceState:inactive?'not_applicable':costs[key]===null?'unavailable':'recorded'};
    });
  return stableValue({ ...review, pins: selected.pins, recordedAt: selected.createdAt,
    rows: [...original.rows.slice(0, 3).map(row => ({ ...row, label: 'Original estimate: ' + row.label.toLowerCase(), recordedAt: original.recordedAt })), ...costRows],
    basisMessage: threeComponents?'Included material, labor and equipment costs use the saved sources shown below. Travel retains its original basis. Original price and tax have not been recalculated.':composed?'Included material and labor costs use the sources shown below. Equipment and travel retain their original basis. Original price and tax have not been recalculated.':'Material costs use the saved plan below. Other direct costs use the original estimate. The original price and tax have not been recalculated.',
    ...(threeComponents?{adoptedEquipmentCostPlan:selected.equipmentCostPlan?{...selected.equipmentCostPlan,result:costs.equipment,currentSourceAssessment:require('./equipmentCostPlanContract').sourceAssessment(selected.equipmentCostPlan.inputs)}:null}:{}),
    missing: costs.changedEquipmentCoverage?.length?['The labor or travel basis changed. Review where the equipment bundle’s outside costs are covered before relying on the combined total.']:costs.knownDirectCosts === null ? ['Some applicable direct costs are unavailable. Review the missing costs before relying on a comparison.'] : [],
    adoptedMaterialPlan: selected.materialPlan?{...selected.materialPlan,...(['estimate-material-plan-v3','estimate-material-plan-v4'].includes(selected.materialPlan.calculationVersion)?{currentSourceAssessment:require('./materialSourceContract').assess(selected.materialPlan.inputs,selected.materialPlan.currency,{serviceKey:original.materialSourceContext.serviceKey}),...(selected.materialPlan.calculationVersion==='estimate-material-plan-v4'?{currentAvailabilityAssessment:require('./materialAvailabilityContract').assess(selected.materialPlan.inputs,costs.material)}:{})}:{})}:null, ...(composed?{adoptedLaborPlan:selected.laborPlan?{...selected.laborPlan,result:costs.labor,currentAssessment:require('./laborPlanContract').assess(selected.laborPlan.inputs)}:null,componentManifest:selected.componentManifest,changedComponent:selected.changedComponent}:{}), financialCosts: costs,
    originalRecordedAt: original.recordedAt, ...(composed&&!selected.materialPlan?{materialReview:{...original.materialReview,sourcePins:selected.pins}}:{}) });
}
function selectDemoRevision(item, revisions = [], requested = null) {
  const latest = revisions[0]?.revision || 1;
  const selectedRevision = requested === null ? latest : requested;
  const selected = selectedRevision === 1 ? null : revisions.find(row => row.revision === selectedRevision);
  if (!Number.isSafeInteger(selectedRevision) || selectedRevision < 1 || selectedRevision > latest || selectedRevision > 1 && !selected) {
    throw Object.assign(new Error('That estimate is unavailable.'), { status: 404 });
  }
  return { currentRevision: latest, selectedRevision, selected, isCurrent: selectedRevision === latest,
    history: revisions.map(({ revision, createdAt, actorName }) => ({ revision, createdAt, actorName })),
    originalPins: buildEstimateReview(item).pins };
}
function projectSelectedDemoDecisions(history, review, enabled) {
  const selected = history.filter(event => sha256(event.sourcePins) === sha256(review.pins));
  const result=projectDecisions({ current: selected[0] || null, history: selected.slice(0, 20), total: selected.length,
    truncated: selected.length > 20, writeBasis: { revision: history[0]?.revision || 0, digest: history[0]?.digest || 'none' } }, enabled && review.isCurrent, true);
  if(!review.isCurrent)result.recoveryMessage='Earlier estimates are read-only. Select the current estimate to review its scope and price.';
  return result;
}
function demoAdopt(item, revisions, decisions, plan, raw, key, now, laborPlan=null, equipmentCostPlan=null) {
  const body = adoption.normalize(raw), requestDigest = sha256(body);
  const replay = revisions.find(event => event.requestKey === key);
  if (replay) {
    if (replay.requestDigest !== requestDigest) throw Object.assign(new Error('That save attempt was used for different details.'), { status: 409 });
    return { receipt: replay, replayed: true };
  }
  const selection = selectDemoRevision(item, revisions);
  const review = buildRevisionReview(item, selection, { simulated: true });
  review.decisions = projectSelectedDemoDecisions(decisions, review, true);
  if(body.confirmationVersion===equipmentComposition.VERSION){
    const chosen=body.changedComponent==='equipment'?equipmentCostPlan:body.changedComponent==='labor'?laborPlan:plan;
    const preview=equipmentComposition.checkEvidence(item,selection,review,body,chosen,now);
    if(revisions.length>=20)throw Object.assign(new Error('Estimate changes are limited. Review saved history.'),{status:429});
    const pair=equipmentComposition.compose(selection,body.changedComponent,chosen),id=require('node:crypto').randomUUID(),revision=selection.currentRevision+1;
    const inputFingerprint=sha256({original:selection.originalPins,parent:review.pins,components:preview.componentManifest,calculationVersion:equipmentComposition.VERSION});
    const digest=sha256({id,revision,body,inputFingerprint,previous:revisions[0]?.id||null});
    return{replayed:false,receipt:{id,revision,digest,previousId:revisions[0]?.id||null,materialPlanId:pair.material?.id||null,materialPlan:pair.material,laborPlanId:pair.labor?.id||null,laborPlan:pair.labor,equipmentCostPlanId:pair.equipment?.id||null,equipmentCostPlan:pair.equipment,changedComponent:body.changedComponent,componentManifest:preview.componentManifest,sourcePins:review.pins,originalSourcePins:selection.originalPins,calculationVersion:equipmentComposition.VERSION,inputFingerprint,expectedDecisionRevision:body.expectedDecisionRevision,expectedDecisionDigest:body.expectedDecisionDigest,reason:body.reason,confirmationVersion:equipmentComposition.VERSION,createdAt:now.toISOString(),actorName:'Demo Reviewer',requestKey:key,requestDigest,pins:{...selection.originalPins,revision:{id,number:revision,digest,calculationVersion:equipmentComposition.VERSION,inputFingerprint}}}};
  }
  if(selection.selected?.calculationVersion===equipmentComposition.VERSION)throw Object.assign(new Error('Refresh to use the current cost review.'),{status:409});
  if(body.confirmationVersion===composition.VERSION){
    const chosen=body.changedComponent==='labor'?laborPlan:plan;
    const preview=composition.checkEvidence(item,selection,review,body,chosen,now);
    if(revisions.length>=20)throw Object.assign(new Error('Estimate changes are limited. Review saved history.'),{status:429});
    const pair=composition.compose(selection,body.changedComponent,chosen),id=require('node:crypto').randomUUID(),revision=selection.currentRevision+1;
    const inputFingerprint=sha256({original:selection.originalPins,parent:review.pins,components:preview.componentManifest,calculationVersion:composition.VERSION});
    const digest=sha256({id,revision,body,inputFingerprint,previous:revisions[0]?.id||null});
    return {replayed:false,receipt:{id,revision,digest,previousId:revisions[0]?.id||null,materialPlanId:pair.material?.id||null,materialPlan:pair.material,laborPlanId:pair.labor?.id||null,laborPlan:pair.labor,changedComponent:body.changedComponent,componentManifest:preview.componentManifest,sourcePins:review.pins,originalSourcePins:selection.originalPins,calculationVersion:composition.VERSION,inputFingerprint,expectedDecisionRevision:body.expectedDecisionRevision,expectedDecisionDigest:body.expectedDecisionDigest,reason:body.reason,confirmationVersion:composition.VERSION,createdAt:now.toISOString(),actorName:'Demo reviewer',requestKey:key,requestDigest,pins:{...selection.originalPins,revision:{id,number:revision,digest,calculationVersion:composition.VERSION,inputFingerprint}}}};
  }
  if(selection.selected?.calculationVersion===composition.VERSION)throw Object.assign(new Error('Refresh to use the current cost review.'),{status:409});
  adoption.checkBasis(body, review, plan); if(['estimate-material-plan-v3','estimate-material-plan-v4'].includes(plan.calculationVersion))require('./materialPlanContract').checkEvidence(plan.inputs,plan.currency,plan.calculationVersion,{now,serviceKey:review.materialSourceContext?.serviceKey||null},true); adoption.calculate(item, plan, body.confirmationVersion);
  if (revisions.length >= 20) throw Object.assign(new Error('This demo has reached its estimate-change limit. Reset the demo to start again.'), { status: 429 });
  if (revisions.some(event => event.materialPlanId === plan.id)) throw Object.assign(new Error('This material plan is already included. Review the current estimate.'), { status: 409 });
  const id = require('node:crypto').randomUUID(), revision = selection.currentRevision + 1;
  const inputFingerprint = sha256({ original: selection.originalPins, parent: review.pins, materialPlan: plan, calculationVersion: body.confirmationVersion });
  const digest = sha256({ id, revision, body, inputFingerprint, previous: revisions[0]?.id || null });
  const receipt = { id, revision, digest, previousId: revisions[0]?.id || null, materialPlanId: plan.id,
    materialPlan: stableValue(plan), sourcePins: review.pins, originalSourcePins: selection.originalPins,
    calculationVersion: body.confirmationVersion, inputFingerprint, expectedDecisionRevision: body.expectedDecisionRevision,
    expectedDecisionDigest: body.expectedDecisionDigest, reason: body.reason, confirmationVersion: body.confirmationVersion,
    createdAt: now.toISOString(), actorName: 'Demo reviewer', requestKey: key, requestDigest,
    pins: { ...selection.originalPins, revision: { id, number: revision, digest, calculationVersion: body.confirmationVersion, inputFingerprint } } };
  return { receipt, replayed: false };
}
module.exports = { buildRevisionReview, selectDemoRevision, projectSelectedDemoDecisions, demoAdopt };
