'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const receivableAging = require('../../src/customerFinancial/receivableAging');
const reporting = require('../../src/customerFinancial/invoiceReceivableReporting');
const repository = require('../../src/customerFinancial/invoiceReceivableReportingRepository');
const { createCustomerFinancialReportingRouter } =
  require('../../src/routes/customerFinancialReporting');

const ROOT = path.resolve(__dirname,'../..');
const read = relative => fs.readFileSync(path.join(ROOT,relative),'utf8');
const source = { organizationId:'11111111-1111-4111-8111-111111111111',
  actorUserId:'22222222-2222-4222-8222-222222222222',actorAccessRole:'owner',
  authSessionId:'33333333-3333-4333-8333-333333333333' };

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function primitiveLeaves(value,pathParts=[],result=[]) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) value.forEach((item,index) =>
      primitiveLeaves(item,[...pathParts,index],result));
    else Object.keys(value).forEach(key =>
      primitiveLeaves(value[key],[...pathParts,key],result));
  } else result.push(pathParts);
  return result;
}
function mutateLeaf(value,pathParts) {
  let target=value;
  for (let index=0;index<pathParts.length-1;index+=1) target=target[pathParts[index]];
  const key=pathParts.at(-1); const current=target[key];
  if (typeof current === 'boolean') target[key]=!current;
  else if (typeof current === 'number') target[key]=current+1;
  else if (typeof current === 'string') target[key]=`${current}__forged`;
  else if (current === null) target[key]='__forged_null__';
  else throw new Error(`Unsupported reporting leaf ${pathParts.join('.')}`);
}

describe('Mission 27 Part 12A source-backed invoice and receivable reporting',() => {
  test('projects five ordered value-free facts with complete-coverage indicators',() => {
    const sourceValue=receivableAging.unavailable();
    const value=reporting.unavailable(sourceValue);
    expect(reporting.project(clone(value),sourceValue)).toEqual(value);
    expect(value).toMatchObject({ contractVersion:'m27-invoice-receivable-reporting-v1',
      policyVersion:'mission27.launch.v1',state:'incomplete',
      reason:'invoice_receivable_reporting_coverage_incomplete',value:null,
      exactSourceRevalidatedBeforeAndAfterProjection:true,reportRowCount:0,
      browserDerivedValueCount:0,providerCallCount:0,providerMutationCount:0,
      receiverMutationCount:0,accountingMutationCount:0,
      downstreamReaderMutationCount:0,liveMoneyMovementCount:0 });
    expect(value.factOrder).toEqual(['issued_amount','outstanding_amount','aging',
      'disputed_amount','invoice_lifecycle_counts']);
    expect(value.facts.map(item=>item.fact)).toEqual(value.factOrder);
    expect(value.facts.every(item => item.state === 'unavailable' && item.value === null &&
      item.currency === null && item.coverage.state === 'incomplete' &&
      item.coverage.complete === false && item.coverage.completenessProven === false &&
      item.coverage.missingRecordsOrValuesMayBecomeZero === false)).toBe(true);
    expect(value.facts.map(item=>item.coverage)).toEqual(
      value.facts.map(()=>value.facts[0].coverage));
    expect(value.sourceWitness).toEqual({ contractVersion:'m27-receivable-aging-v1',
      state:'incomplete',reason:'receivable_population_incomplete',
      digest:providerBoundary.digest(sourceValue),
      requestContextCurrentnessRevalidated:true,
      receivableProjectionCurrentnessRevalidated:false });
  });

  test('preserves exact money, aging, dispute, lifecycle and coverage meanings',() => {
    const value=reporting.unavailable();
    expect(value.amountContract).toEqual({ supportedCurrency:'USD',
      integerMinorUnitsRequired:true,oneMatchingCurrencyRequired:true,
      issuedOutstandingAndDisputedRemainSeparate:true,
      disputedAmountMayRewriteIssuedOrOutstandingAmount:false,
      missingAmountMayBecomeZero:false,partialCoverageAmountMayBePresentedAsComplete:false,
      browserArithmeticAllowed:false });
    expect(value.agingContract.exactBuckets).toEqual(receivableAging.AGING_BUCKETS);
    expect(value.agingContract).toMatchObject({
      issuedDueDateAndTrustedServerClockRequired:true,
      missingDueDateOrBalanceMayEnterBucket:false,
      overdueStateMayAuthorizeReminderFeeCollectionOrCharge:false,
      counts:null,outstandingMinorUnits:null });
    expect(value.lifecycleCountContract.exactOrthogonalAxes).toEqual([
      'documentRevision','delivery','paymentBalance','dueAging','disputeRefund',
      'settlement','accountingHandoff']);
    expect(value.lifecycleCountContract).toMatchObject({
      completeIssuedInvoicePopulationRequired:true,everyAxisRetained:true,
      oneDisplayStatusMayReplaceOrthogonalAxes:false,missingCountMayBecomeZero:false,
      counts:null });
    expect(value.coverageSummary).toEqual({ state:'incomplete',
      reason:'issued_receivable_population_unavailable',requiredFactCount:5,
      completeFactCount:0,incompleteFactCount:5,allFactsComplete:false,sourceAsOf:null,
      reportCurrency:null,reportMayBePresentedAsComplete:false,
      partialFactsMayBeSummedOrCompared:false,unknownOrMissingFactMayBecomeZero:false });
  });

  test('rejects every semantic leaf and structural source/fact forgery',() => {
    const sourceValue=receivableAging.unavailable();
    const canonical=reporting.unavailable(sourceValue);
    const failures=[];
    const leaves=primitiveLeaves(canonical);
    expect(leaves.length).toBeGreaterThan(150);
    for (const leaf of leaves) {
      const changed=clone(canonical); mutateLeaf(changed,leaf);
      try { reporting.project(changed,sourceValue); failures.push(leaf.join('.')); }
      catch (error) { expect(error.message).toBe('Invoice and receivable reporting boundary invalid'); }
    }
    const structural=[
      value=>{delete value.sourceWitness;},
      value=>{value.sourceWitness.extra='forged';},
      value=>{value.facts.reverse();},
      value=>{value.factOrder.reverse();},
      value=>{value.facts[0]=clone(value.facts[1]);},
      value=>{value.facts[0].fact='renamed';},
      value=>{value.facts.pop();},
      value=>{value.facts.push(clone(value.facts[0]));},
      value=>{value.facts[0].coverage.complete=true;},
      value=>{value.facts[0].coverage.sourceDigest='f'.repeat(64);},
    ];
    for (const mutate of structural) {
      const changed=clone(canonical);mutate(changed);
      expect(()=>reporting.project(changed,sourceValue)).toThrow(
        'Invoice and receivable reporting boundary invalid');
    }
    const forgedSource=clone(sourceValue);forgedSource.coverage.complete=true;
    const forgedReport=clone(canonical);
    forgedReport.sourceWitness.digest=providerBoundary.digest(forgedSource);
    forgedReport.facts.forEach(item=>{item.coverage.sourceDigest=forgedReport.sourceWitness.digest;});
    expect(()=>reporting.project(forgedReport,forgedSource)).toThrow(
      'Receivable-aging boundary invalid');
    expect(failures).toEqual([]);
  });

  test('revalidates the exact source before and after projection',async () => {
    const canonical=receivableAging.unavailable();
    const readReceivables=jest.fn().mockResolvedValue(canonical);
    await expect(repository.read(source,{readReceivables}))
      .resolves.toEqual(reporting.unavailable(canonical));
    expect(readReceivables).toHaveBeenCalledTimes(2);
    const changed=clone(canonical);changed.projection.projectionDigest='f'.repeat(64);
    readReceivables.mockReset().mockResolvedValueOnce(canonical).mockResolvedValueOnce(changed);
    await expect(repository.read(source,{readReceivables})).rejects.toThrow(
      'Receivable-aging boundary invalid');
    for (const invalid of [null,{}, {...source,actorAccessRole:'member'},
      {...source,organizationId:'victim'}, {...source,extra:'widened'}]) {
      await expect(repository.read(invalid,{readReceivables})).rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_REPORTING_RESTRICTED',status:403 });
    }
  });

  test('mounts an exact private GET and rejects queries and methods before source access',async () => {
    const repositoryRead=jest.fn().mockResolvedValue(reporting.unavailable());
    const app=express();
    app.use((req,_res,next)=>{req.tenantContext={organizationId:source.organizationId,
      userId:source.actorUserId};req.userRole='owner';
      req.authSession={id:source.authSessionId};next();});
    app.use('/api/v1/customer-financial/reporting',
      createCustomerFinancialReportingRouter({read:repositoryRead,
        auth:(_req,_res,next)=>next(),role:(_req,_res,next)=>next(),
        throttle:(_req,_res,next)=>next()}));
    const pathName='/api/v1/customer-financial/reporting/invoice-receivables';
    const widened=await request(app).get(pathName)
      .query({tenantId:'victim',issuedMinorUnits:'0',lifecycleState:'paid'});
    expect(widened.status).toBe(400);expect(repositoryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|paid|issuedMinorUnits/);
    const head=await request(app).head(pathName);
    const options=await request(app).options(pathName);
    const post=await request(app).post(pathName).send({amountMinorUnits:'0'});
    expect([head.status,options.status,post.status]).toEqual([405,405,405]);
    expect(options.headers.allow).toBeUndefined();
    expect(repositoryRead).not.toHaveBeenCalled();
    const response=await request(app).get(pathName);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Cookie');
    expect(response.body.data).toEqual(reporting.unavailable());
    expect(repositoryRead).toHaveBeenCalledTimes(1);
  });

  test('adds no mutation, demo surface, transport, table or migration 273',() => {
    const sourceCode=[read('src/customerFinancial/invoiceReceivableReporting.js'),
      read('src/customerFinancial/invoiceReceivableReportingRepository.js'),
      read('src/routes/customerFinancialReporting.js')].join('\n');
    expect(sourceCode).not.toMatch(/INSERT|UPDATE|DELETE|https\.request|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('invoice-receivables');
    expect(read('src/server.js')).toContain(
      "app.use('/api/v1/customer-financial/reporting'");
    expect(read('src/middleware/security.js')).toContain(
      "'/api/v1/customer-financial/reporting/invoice-receivables'");
    const migrations=fs.readdirSync(path.join(ROOT,'migrations'))
      .filter(name=>name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name=>/^273_/.test(name))).toBe(false);
  });
});
