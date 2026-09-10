'use strict';
const adoption = require('../../src/estimating/materialAdoptionContract');
const material = require('../../src/estimating/materialPlanContract');
function fixture() {
  return { item: { calculationVersion: adoption.BASE_VERSION, estimate: { currency: 'USD' },
    snapshot: { service: { supported: true }, materialsCharge: 500, knownDirectMaterialCost: 500,
      laborCharge: 200, knownInternalLaborCost: 100, equipmentCharge: 75, knownEquipmentCost: 50,
      travel: { distanceMiles: null, knownInternalCost: null }, knownDirectCosts: 650,
      overhead: 65, grossProfit: 350, netProfit: 285 } },
    plan: { action: 'save', calculationVersion: material.VERSION, currency: 'USD',
      inputs: { material: 'Boards', quantity: '10', unit: 'ea', wastePercent: '10',
        unitPrice: '32.50', sourceType: 'entered_price', sourceNote: 'Written supplier estimate', priceDate: '2026-09-10' } } };
}
test('replaces only material, sums applicable components once and preserves source bytes', () => {
  const { item, plan } = fixture(), before = JSON.stringify({ item, plan });
  const result = adoption.calculate(item, plan);
  expect(result.knownDirectMaterialCost).toBe('357.50');
  expect(result.knownDirectCosts).toBe('507.50');
  expect(result.overhead).toBeNull(); expect(result.grossProfit).toBeNull(); expect(result.netProfit).toBeNull();
  expect(JSON.stringify({ item, plan })).toBe(before);
});
test.each([null, undefined, -1, 1.001, '100.00'])('missing or unsupported applicable labor %s stays unavailable', value => {
  const { item, plan } = fixture(); item.snapshot.knownInternalLaborCost = value;
  expect(adoption.calculate(item, plan).knownDirectCosts).toBeNull();
});
test('zero material is distinct from missing and explicit adoption applies despite original zero charge', () => {
  const { item, plan } = fixture(); item.snapshot.materialsCharge = 0;
  expect(adoption.calculate(item, plan).knownDirectCosts).toBe('507.50');
  plan.inputs.unitPrice = '0.00'; expect(adoption.calculate(item, plan).knownDirectCosts).toBe('150.00');
});
test('inapplicable labor does not require or add its recorded cost', () => {
  const { item, plan } = fixture(); item.snapshot.laborCharge = 0;
  expect(adoption.calculate(item, plan).knownDirectCosts).toBe('407.50');
});
test('travel missingness and unsupported applicability do not become zero', () => {
  const { item, plan } = fixture(); item.snapshot.travel.distanceMiles = 0;
  expect(adoption.calculate(item, plan).knownDirectCosts).toBeNull();
  item.snapshot.travel.knownInternalCost = 0; expect(adoption.calculate(item, plan).knownDirectCosts).toBe('507.50');
  delete item.snapshot.travel.distanceMiles; expect(adoption.calculate(item, plan).knownDirectCosts).toBeNull();
});
test('unknown original pricing applicability keeps aggregate unavailable', () => {
  const { item, plan } = fixture(); item.snapshot.service.supported = false;
  expect(adoption.calculate(item, plan).knownDirectCosts).toBeNull();
});
test('combined overflow rejects instead of rounding or returning an unsafe amount', () => {
  const { item, plan } = fixture(); plan.inputs.quantity = '1'; plan.inputs.wastePercent = '0';
  plan.inputs.unitPrice = '999999999999.99';
  expect(() => adoption.calculate(item, plan)).toThrow('combined costs');
});
test.each(['currency', 'version', 'withdrawn'])('unsupported %s cannot create an adoption', kind => {
  const { item, plan } = fixture();
  if (kind === 'currency') plan.currency = 'CAD';
  if (kind === 'version') item.calculationVersion = 'unknown';
  if (kind === 'withdrawn') plan.action = 'withdraw';
  expect(() => adoption.calculate(item, plan)).toThrow('cannot be used');
});
test('selected review without a decision uses global write basis without inheriting approval', () => {
  const pins = { estimateId: 'root', revision: { number: 2 } };
  const plan = { id: 'plan', revision: 2, digest: 'plan-digest', action: 'save', sourcePins: pins, currency: 'USD' };
  const review = { pins, currency: 'USD', decisions: { current: null, writeBasis: { revision: 3, digest: 'prior' } } };
  const body = { sourcePins: pins, expectedPlanId: plan.id, expectedPlanRevision: 2, expectedPlanDigest: plan.digest,
    expectedDecisionRevision: 3, expectedDecisionDigest: 'prior' };
  expect(() => adoption.checkBasis(body, review, plan)).not.toThrow();
  expect(review.decisions.current).toBeNull();
  expect(() => adoption.checkBasis({ ...body, expectedDecisionRevision: 0 }, review, plan)).toThrow('changed');
  expect(() => adoption.checkBasis(body, review, { ...plan, sourcePins: { estimateId: 'root' } })).toThrow('changed');
});
test('shared demo lifecycle preserves adopted source across edits, history selection and a second adoption', () => {
  const { buildRevisionReview, selectDemoRevision, projectSelectedDemoDecisions, demoAdopt } = require('../../src/estimating/estimateRevisionReview');
  const { demoDecision } = require('../../src/estimating/decisionContract');
  const { item, plan: template } = fixture(), now = new Date('2026-09-10T20:00:00Z');
  Object.assign(item,{ids:{estimate:'root',graph:'graph',customer:'customer',operation:'operation',opportunity:'opportunity',polarisSnapshot:'snapshot'},snapshotDigest:'a'.repeat(64),normalizedInputFingerprint:'b'.repeat(64),businessProfileAuthorityId:'profile',businessProfileInputVersion:1,businessProfileInputHash:'c'.repeat(64),snapshotCreatedAt:now.toISOString()});
  let revisions=[],decisions=[],plans=[];
  function read(selected=null){const review=buildRevisionReview(item,selectDemoRevision(item,revisions,selected),{simulated:true});review.decisions=projectSelectedDemoDecisions(decisions,review,true);return review;}
  function price(review){const b={action:'approve',expectedRevision:review.decisions.writeBasis.revision,expectedDigest:review.decisions.writeBasis.digest,sourcePins:review.pins,scopeSummary:'Synthetic scope',priceBeforeTax:'700.00',currency:'USD',reason:'Review this estimate',confirmed:true,confirmationVersion:'estimate-quote-preparation-v1'};decisions=demoDecision(decisions,review,b,require('node:crypto').randomUUID(),'Demo reviewer',now).history;}
  function savePlan(review,unitPrice){const b={action:'save',expectedRevision:plans[0]?.revision||0,expectedDigest:plans[0]?.digest||'none',sourcePins:review.pins,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,inputs:{...template.inputs,unitPrice},currency:'USD',reason:'Plan these quantities',confirmed:true,confirmationVersion:material.VERSION};plans.unshift(material.demoPlan(plans,review,b,require('node:crypto').randomUUID(),now).receipt);}
  function adopt(review){const body={sourcePins:review.pins,expectedPlanId:plans[0].id,expectedPlanRevision:plans[0].revision,expectedPlanDigest:plans[0].digest,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,reason:'Use this plan',confirmed:true,confirmationVersion:adoption.VERSION};revisions.unshift(demoAdopt(item,revisions,decisions,plans[0],body,require('node:crypto').randomUUID(),now).receipt);}
  price(read());savePlan(read(),'32.50');adopt(read());let review=read();
  expect(review.selectedRevision).toBe(2);expect(review.decisions.current).toBeNull();expect(review.decisions.writeBasis.revision).toBe(1);
  expect(review.financialCosts.knownDirectCosts).toBe('507.50');expect(read(1).decisions.current.priceBeforeTax).toBe('700.00');
  price(review);savePlan(read(),'40.00');expect(read().adoptedMaterialPlan.inputs.unitPrice).toBe('32.50');adopt(read());
  expect(read().selectedRevision).toBe(3);expect(read().financialCosts.knownDirectCosts).toBe('590.00');expect(read().decisions.current).toBeNull();expect(read().decisions.writeBasis.revision).toBe(2);
  expect(read(2).financialCosts.knownDirectCosts).toBe('507.50');expect(read(2).decisions.canApprove).toBe(false);expect(read(2).decisions.current.revision).toBe(2);
});
