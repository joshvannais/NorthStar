'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm24-estimate-access-correction-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];

const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const composition = require('../helpers/m24-cost-composition-input');
const equipment = require('../helpers/m24-equipment-input');
const equipmentCost = require('../helpers/m24-equipment-cost-input');
const travel = require('../helpers/m24-travel-input');
const pricing = require('../helpers/m24-pricing-input');
const policy = require('../helpers/m24-policy-input');
const commercialInput = require('../helpers/m24-commercial-input');
const commercialContract = require('../../src/estimating/commercialContract');
const travelComposition = require('../../src/estimating/travelCostComposition');

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output));

function cents(value) {
  assert.match(value, /^-?(0|[1-9][0-9]*)\.[0-9]{2}$/);
  const negative = value.startsWith('-');
  const [whole, fraction] = value.replace('-', '').split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction);
  return negative ? -result : result;
}

function demoIntent(path) {
  if (path.startsWith('/material-plan')) return 'material-plan';
  if (path.startsWith('/labor-')) return 'labor-plan';
  if (path.startsWith('/equipment-cost')) return 'equipment-cost';
  if (path.startsWith('/equipment-')) return 'equipment-plan';
  if (path.startsWith('/travel-')) return 'travel-plan';
  if (path.startsWith('/pricing-policy') || path.startsWith('/pricing-polic')) return 'pricing-policy';
  if (path.startsWith('/pricing-')) return 'pricing-plan';
  if (path === '/cost-adoption-preview' || path === '/cost-adoptions') return 'material-adoption';
  if (path === '/commercial-preview' || path === '/commercial-terms' || path === '/commercial-approvals') return 'commercial-terms';
  if (path === '/capella-scenarios') return 'capella-scenarios';
  if (path === '/customer-estimate-versions') return 'customer-estimate-issue';
  if (path === '/decisions') return 'estimate-decision';
  throw new Error('No demo intent for ' + path);
}

(async () => {
  let fixture;
  const result = { pass:false, cases:[], traces:{}, unavailableEvidence:[] };
  try {
    fixture = await createEstimateReviewFixture({ recordedLaborHours:8 });
    const demoAgent = request.agent(fixture.app);
    const demoEntry = await demoAgent.get('/api/demo/command-center').set('Host', 'localhost');
    assert.equal(demoEntry.status, 200, JSON.stringify(demoEntry.body));
    const demoCookie = demoEntry.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
    const contexts = [
      {
        name:'paid',
        requester:request(fixture.app),
        route:'/api/v1/canonical/estimates/' + fixture.estimateGraphs[0].ids.estimate,
        headers:fixture.actors.owner.session.headers,
      },
      {
        name:'demo',
        requester:demoAgent,
        route:'/api/demo/command-center/estimates/' + demoEntry.body.data.graphs[0].ids.estimate,
        headers:{ Cookie:demoCookie, Origin:'http://localhost', Host:'localhost' },
      },
    ];

    async function journey(context) {
      let review;
      const trace = { mutations:[], evidence:{} };
      async function read(suffix='/review') {
        const response = await context.requester.get(context.route + suffix).set(context.headers);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        if (suffix === '/review') review = response.body.data;
        return response.body.data;
      }
      async function post(path, body, expected=201, key=crypto.randomUUID()) {
        const headers = { ...context.headers, 'Idempotency-Key':key };
        if (context.name === 'demo') {
          headers['X-NorthStar-Demo-Intent'] = demoIntent(path);
          headers['X-NorthStar-Demo-Revision'] = String(review.demoWorkspaceRevision);
        }
        const response = await context.requester.post(context.route + path).set(headers).send(body);
        assert.equal(response.status, expected, JSON.stringify({ path, status:response.status, body:response.body }));
        trace.mutations.push({ path, status:response.status });
        return response.body.data;
      }

      await read();
      trace.initial = { pins:review.pins, selectedRevision:review.selectedRevision, financialCosts:review.financialCosts };
      assert.equal(review.decisions.current, null);

      for (const kind of ['material', 'labor']) {
        let body = composition.planBody(review, kind, kind === 'material' ? '60.00' : '50.00');
        const preview = await post('/' + kind + '-plan-preview', body, 200);
        composition.acceptPlanPreview(body, preview);
        await post('/' + kind + '-plans', body);
        await read();
        body = composition.adoptionBody(review, kind);
        const adoption = await post('/cost-adoption-preview', body, 200);
        body.assessment = adoption.assessment;
        await post('/cost-adoptions', body);
        await read();
      }

      let body = {
        ...composition.common(review, review.equipmentPlans.current),
        inputs:equipment.inputs(),
        confirmationVersion:'estimate-equipment-plan-v1',
      };
      body.inputs.serviceKey = review.equipmentPlans.sources.serviceKey;
      let preview = await post('/equipment-plan-preview', body, 200);
      body.inputs.assessment = { ...preview.assessment, acknowledged:true };
      await post('/equipment-plans', body);
      await read();

      body = equipmentCost.body(review);
      preview = await post('/equipment-cost-preview', body, 200);
      body.inputs.assessment = { ...preview.assessment, acknowledged:true, explanation:'Reviewed task equipment allocation; source dates remain unknown.' };
      await post('/equipment-cost-plans', body);
      await read();
      let plan = review.equipmentCostPlans.current;
      body = {
        sourcePins:review.pins,
        expectedPlanId:plan.id,
        expectedPlanRevision:plan.revision,
        expectedPlanDigest:plan.digest,
        expectedDecisionRevision:review.decisions.writeBasis.revision,
        expectedDecisionDigest:review.decisions.writeBasis.digest,
        reason:'Apply reviewed equipment cost',
        confirmed:true,
        confirmationVersion:'estimate-cost-adoption-v2',
        changedComponent:'equipment',
        expectedComponents:review.equipmentCostComponents,
        assessment:{},
      };
      preview = await post('/cost-adoption-preview', body, 200);
      body.assessment = preview.assessment;
      await post('/cost-adoptions', body);
      await read();

      body = {
        ...composition.common(review, review.travelPlans.current),
        inputs:travel.fixture(),
        confirmationVersion:'estimate-travel-plan-v1',
      };
      body.inputs.serviceKey = review.travelPlans.serviceKey;
      preview = await post('/travel-plan-preview', body, 200);
      body.inputs.assessment = { ...preview.assessment, acknowledged:true, explanation:'Reviewed declared local travel assumptions.' };
      await post('/travel-plans', body);
      await read();
      plan = review.travelPlans.current;
      body = {
        sourcePins:review.pins,
        expectedPlanId:plan.id,
        expectedPlanRevision:plan.revision,
        expectedPlanDigest:plan.digest,
        expectedDecisionRevision:review.decisions.writeBasis.revision,
        expectedDecisionDigest:review.decisions.writeBasis.digest,
        reason:'Apply reviewed travel cost',
        confirmed:true,
        confirmationVersion:'estimate-cost-adoption-v3',
        changedComponent:'travel',
        expectedComponents:review.travelCostComponents,
        assessment:{},
        coverage:{
          componentManifest:travelComposition.manifest({
            material:review.adoptedMaterialPlan,
            labor:review.adoptedLaborPlan,
            equipment:review.adoptedEquipmentCostPlan,
            travel:plan,
          }),
          overlaps:[], equipmentOutside:[], confirmed:true,
          reason:'Travel is separately allocated from the reviewed material, labor, and equipment costs.',
        },
      };
      preview = await post('/cost-adoption-preview', body, 200);
      body.assessment = preview.assessment;
      await post('/cost-adoptions', body);
      await read();

      const financial = review.financialCosts;
      assert.equal(financial.knownDirectMaterialCost, '600.00');
      assert.equal(financial.knownInternalLaborCost, '960.00');
      assert.equal(financial.knownEquipmentCost, '160.00');
      assert.equal(financial.knownTravelInternalCost, '109.00');
      assert.equal(financial.knownDirectCosts, '1829.00');
      assert.equal(
        cents(financial.knownDirectMaterialCost) + cents(financial.knownInternalLaborCost) + cents(financial.knownEquipmentCost) + cents(financial.knownTravelInternalCost),
        cents(financial.knownDirectCosts),
      );
      assert.equal(review.pricingPlans.sources.basis.directCosts, financial.knownDirectCosts);
      trace.evidence.costArithmetic = {
        material:financial.knownDirectMaterialCost,
        labor:financial.knownInternalLaborCost,
        equipment:financial.knownEquipmentCost,
        travel:financial.knownTravelInternalCost,
        total:financial.knownDirectCosts,
      };

      const p = review.pricingPlans;
      body = {
        action:'save', expectedRevision:p.current?.revision || 0, expectedDigest:p.current?.digest || 'none',
        sourcePins:review.pins, expectedDecisionRevision:p.decisionBasis.revision, expectedDecisionDigest:p.decisionBasis.digest,
        inputs:pricing.fixture(p.serviceKey), currency:review.currency, reason:'Owner reviewed the customer price and office allocation.',
        confirmed:true, confirmationVersion:p.contract, evidenceDigest:p.sources.digest,
      };
      preview = await post('/pricing-plan-preview', body, 200);
      assert.equal(preview.result.directCosts, '1829.00');
      assert.equal(preview.result.costWithOverhead, '1929.00');
      assert.equal(preview.result.proposedBeforeTax, '1500.00');
      await post('/pricing-plans', body);
      await read();

      const pol = review.pricingPolicies;
      body = {
        action:'save', expectedRevision:pol.current?.revision || 0, expectedDigest:pol.current?.digest || 'none',
        sourcePins:review.pins, expectedDecisionRevision:pol.decisionBasis.revision, expectedDecisionDigest:pol.decisionBasis.digest,
        inputs:policy.fixture(pol.serviceKey), currency:review.currency, reason:'Owner reviewed the margin and minimum policy.',
        confirmed:true, confirmationVersion:pol.contract, evidenceDigest:pol.sources.digest, pricingPin:pol.sources.pricingPin,
      };
      preview = await post('/pricing-policy-preview', body, 200);
      assert.equal(preview.result.threshold, '2436.25');
      assert.equal(preview.result.proposed.status, 'below');
      await post('/pricing-policies', body);
      await read();

      const c = review.commercialTerms;
      const terms = commercialInput.fixture().value;
      terms.version = c.contract;
      terms.jobApplicability = {
        serviceOperation:'fence_installation', propertyUse:'residential', workContext:'new_construction', customerExemption:'none',
        evidenceRef:{ serviceOperation:'Recorded customer scope', propertyUse:'Recorded property', workContext:'Owner review', customerExemption:'Customer statement' },
      };
      terms.transactionDate = c.sources.asOfDate;
      terms.taxGroups = [commercialInput.group(['installation'])];
      terms.taxGroups[0].source.serviceKey = c.sources.serviceKey;
      const taxSource = terms.taxGroups[0].source;
      taxSource.legalEffectiveOn = taxSource.effectiveOn;
      taxSource.legalEndsOn = null;
      taxSource.reviewedOn = c.sources.asOfDate;
      taxSource.reviewValidThrough = c.sources.asOfDate;
      delete taxSource.effectiveOn;
      delete taxSource.endsOn;
      body = {
        action:'save', expectedRevision:c.current?.revision || 0, expectedDigest:c.current?.digest || 'none',
        sourcePins:review.pins, expectedDecisionRevision:c.decisionBasis.revision, expectedDecisionDigest:c.decisionBasis.digest,
        inputs:terms, currency:review.currency, reason:'Owner reviewed customer terms and tax treatment.',
        confirmed:true, confirmationVersion:c.contract, evidenceDigest:c.sources.digest,
      };
      preview = await post('/commercial-preview', body, 200);
      assert.equal(preview.result.netBeforeTax, '1500.00');
      assert.equal(preview.result.tax, '150.00');
      assert.equal(preview.result.total, '1650.00');
      await post('/commercial-terms', body);
      await read();

      const current = review.commercialTerms;
      body = {
        termsPin:commercialContract.pin(current.current), evidenceDigest:current.sources.digest,
        expectedDecisionRevision:current.decisionBasis.revision, expectedDecisionDigest:current.decisionBasis.digest,
        scopeSummary:'Replace the recorded 100-foot cedar fence and complete the reviewed site work.',
        reason:'Owner approved the complete customer scope, price, tax, and payment schedule.', confirmed:true,
        confirmationVersion:current.contract,
        exceptions:{ policyReason:'Owner approved the reviewed customer price below the saved policy threshold.', policyUnknownAcknowledged:true, ownerRecordedTaxAcknowledged:true },
      };
      await post('/commercial-approvals', body);
      await read();
      assert.equal(review.commercialTerms.approvalState, 'commercial_approved');
      const summary = review.commercialTerms.customerSummary;
      assert.equal(cents(summary.netBeforeTax) + cents(summary.tax), cents(summary.total));
      assert.equal(summary.total, '1650.00');
      assert.equal(review.decisions.current.priceBeforeTax, '1500.00');

      const scenario = await post('/capella-scenarios', {
        basisDigest:review.capellaScenarios.digest,
        priceBasis:'proposed',
        scenarios:[{ kind:'adverse', directChange:'25.00', overheadChange:'0.00', priceChange:'0.00', overheadSeparate:true, source:pricing.source() }],
      }, 200);
      assert.equal(scenario.base.directCosts, '1829.00');
      assert.equal(scenario.base.incrementalOverhead, '100.00');
      assert.equal(scenario.base.modeledCosts, '1929.00');
      assert.equal(cents(scenario.base.directCosts) + cents(scenario.base.incrementalOverhead), cents(scenario.base.modeledCosts));
      assert.equal(cents(scenario.base.netBeforeTax) - cents(scenario.base.modeledCosts), cents(scenario.base.remaining));
      trace.evidence.riskArithmetic = scenario;

      const customerPreview = await read('/customer-estimate-preview');
      assert.equal(customerPreview.state, 'preview');
      assert.equal(customerPreview.total, '1650.00');
      assert.deepEqual(customerPreview.capabilities, { downloadPdf:true, downloadImage:true, accept:false, askQuestion:false });
      const serialized = JSON.stringify(customerPreview);
      for (const privateKey of ['knownDirectCosts', 'financialCosts', 'capellaScenarios', 'riskReview', 'pricingPolicies', 'componentManifest']) {
        assert.equal(serialized.includes(privateKey), false, privateKey + ' leaked into customer output');
      }
      body = { reason:'Owner approved this customer-facing estimate.', confirmed:true, confirmationVersion:'customer-estimate-issue-v1' };
      const issue = await post('/customer-estimate-versions', body);
      assert.equal(issue.receipt.document.state, 'issued');
      assert.equal(issue.receipt.document.reference, customerPreview.reference);
      assert.equal(issue.receipt.document.total, customerPreview.total);
      const history = await read('/customer-estimate-versions');
      assert.equal(history.total, 1);
      assert.equal(history.current.id, issue.receipt.id);
      trace.evidence.customerDocument = { reference:customerPreview.reference, total:customerPreview.total, privateFieldsExcluded:true, immutableRevision:issue.receipt.revision, versionId:issue.receipt.id };
      trace.final = { pins:review.pins, selectedRevision:review.selectedRevision, financialCosts:review.financialCosts, customerSummary:summary };
      result.cases.push(context.name + ' traced inputs through costs, price, policy, approval, risk, preview, and immutable issue');
      return trace;
    }

    for (const context of contexts) result.traces[context.name] = await journey(context);
    const paid = result.traces.paid.evidence;
    const demo = result.traces.demo.evidence;
    assert.deepEqual(demo.costArithmetic, paid.costArithmetic);
    assert.equal(demo.riskArithmetic.base.modeledCosts, paid.riskArithmetic.base.modeledCosts);
    assert.equal(demo.riskArithmetic.base.remaining, paid.riskArithmetic.base.remaining);
    assert.equal(demo.customerDocument.total, paid.customerDocument.total);
    result.cases.push('paid and isolated demo produce the same arithmetic and customer-safe output boundaries');

    for (const context of contexts) {
      const evidence=result.traces[context.name].evidence.customerDocument,key=crypto.randomUUID(),linkHeaders={...context.headers,'Idempotency-Key':key};
      if(context.name==='demo')linkHeaders['X-NorthStar-Demo-Intent']='customer-estimate-delivery';
      let response=await context.requester.post(context.route+'/customer-estimate-links').set(linkHeaders).send({versionId:evidence.versionId,expiresInDays:context.name==='demo'?1:14,confirmed:true,confirmationVersion:'customer-estimate-delivery-v1'});
      assert.equal(response.status,201,JSON.stringify(response.body));const originalPath=response.body.data.urlPath;await new Promise(resolve=>setTimeout(resolve,40));response=await context.requester.post(context.route+'/customer-estimate-links').set(linkHeaders).send({versionId:evidence.versionId,expiresInDays:context.name==='demo'?1:14,confirmed:true,confirmationVersion:'customer-estimate-delivery-v1'});assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.data.replayed,true);assert.equal(response.body.data.urlPath,originalPath);const token=decodeURIComponent(originalPath.split('/').pop());
      response=await request(fixture.app).get('/api/public/customer-estimates/'+token).set('Host','localhost');assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.data.document.reference,evidence.reference);
      const publicHeaders={Host:'localhost',Origin:'http://localhost','Idempotency-Key':crypto.randomUUID()};response=await request(fixture.app).post('/api/public/customer-estimates/'+token+'/accept').set(publicHeaders).send({customerName:'Demo Customer',confirmed:true,confirmationVersion:'customer-estimate-accept-v1'});assert.equal(response.status,201,JSON.stringify(response.body));
      publicHeaders['Idempotency-Key']=crypto.randomUUID();response=await request(fixture.app).post('/api/public/customer-estimates/'+token+'/questions').set(publicHeaders).send({customerName:'Demo Customer',replyTo:'customer@example.test',message:'Please confirm the proposed start date.',confirmed:true,confirmationVersion:'customer-estimate-question-v1'});assert.equal(response.status,201,JSON.stringify(response.body));
      response=await context.requester.get(context.route+'/customer-estimate-links').set(context.headers);assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.data.links[0].status,'accepted');assert.equal(response.body.data.links[0].questionCount,1);
      const revokeHeaders={...context.headers,'Idempotency-Key':crypto.randomUUID()};if(context.name==='demo')revokeHeaders['X-NorthStar-Demo-Intent']='customer-estimate-delivery';response=await context.requester.post(context.route+'/customer-estimate-links/'+response.body.data.links[0].id+'/revoke').set(revokeHeaders).send({});assert.ok([200,201].includes(response.status),JSON.stringify(response.body));assert.equal((await request(fixture.app).get('/api/public/customer-estimates/'+token).set('Host','localhost')).status,410);
      result.cases.push(context.name+' customer link, acceptance, question handoff, owner status and revocation work end to end');
    }

    const demoLedger = await fixture.ownerPool.query(
      "SELECT operation FROM demo_command_center_mutations WHERE operation='customer_estimate_issue' ORDER BY created_at DESC LIMIT 1"
    );
    const operationColumn = await fixture.ownerPool.query(
      "SELECT character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name='demo_command_center_mutations' AND column_name='operation'"
    );
    assert.equal(demoLedger.rows[0]?.operation, 'customer_estimate_issue');
    assert.equal(operationColumn.rows[0]?.character_maximum_length, 32);
    result.cases.push('demo issuance is durably recorded without truncating its bounded operation name');

    const memberRoute = contexts[0].route + '/customer-estimate-preview';
    const forbidden = await request(fixture.app).get(memberRoute).set(fixture.actors.member.session.headers);
    assert.equal(forbidden.status, 403);
    result.cases.push('non-owner customer estimate access remains denied');

    result.unavailableEvidence = [
      'Physical Safari and physical mobile devices were not available in this local run.',
      'Private authenticated production data was not used.',
      'No live supplier, tax, mapping, communications, payment, or delivery provider was called.',
      'Founder visual approval remains a separate verdict.',
    ];
    result.pass = true;
  } catch (error) {
    result.error = { message:error.message, code:error.code, stack:error.stack };
    process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag:'wx' });
    console.log(JSON.stringify({ pass:result.pass, cases:result.cases.length, error:result.error?.message }));
  }
})();
