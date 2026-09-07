'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Model, realm, run, source, scripts } = require('./investor-model-harness.cjs');
const receipts = [];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message || ''}: ${actual} != ${expected}`);
const noChurn = { baseMonthlyVoluntaryChurn: 0, earlyTenureMultiplier: 1, matureMultiplier: 1 };
const noAuto = { automaticPlan: { enabled: false } };
const noAcq = { direct: { enabled: false } };
function checked(id, input = {}) {
  // Isolate the original arithmetic boundaries from the new, separately tested
  // attorney earmark. The default case intentionally exercises genuine defaults.
  if (id !== 'default' && !id.startsWith('legal_')) input = {...input, cash:{legalReviewReserve:0,...input.cash}};
  const result = run(input);
  const differences = { operating: 0, cash: 0, customers: 0, owners: 0, ledger: 0 };
  for (const row of result.rows) {
    const sums = {
      operating: row.totalRevenue - row.variableOperatingCosts - row.fixedCommittedOperatingCosts - row.operatingProfit,
      cash: row.beginningCash + row.cashCollections + row.additionalFunding - row.directProviderCosts -
        Object.values(row.opex).reduce((a,b) => a+b, 0) - row.capitalExpenditures - row.actualTaxPayments - row.totalDistributionPool - row.endingCash,
      customers: row.beginningCustomers + row.newPayingCustomers + row.reactivations - row.churnedCustomers - row.activeCustomers,
      owners: row.investorDistribution + row.otherOwnerDistributions - row.totalDistributionPool,
      ledger: row.expenseLedger.reduce((a,b) => a+b.amount, 0) - row.directProviderCosts - row.totalOperatingExpense
    };
    for (const [key, value] of Object.entries(sums)) { near(value, 0, `${id} month${row.month} ${key}`); differences[key] = Math.max(differences[key], Math.abs(value)); }
    assert.equal(new Set(row.expenseLedger.map(entry => entry.id)).size, row.expenseLedger.length);
    for (const entry of row.expenseLedger) assert.ok(entry.source && entry.driver && entry.accountingTreatment && entry.serviceMonth === row.month && entry.cashMonth === row.month);
  }
  receipts.push({ id, input, rows: result.rows.length, summary: result.summary, maximumIndependentDifferences: differences,
    firstMonth: result.rows[0], lastMonth: result.rows.at(-1) });
  return result;
}
const periodic = { distributionPolicy: 'periodic', distributionEveryMonths: 3, distributionStartMonth: 3,
  distributionPayoutRatio: 1, provisionalDistributionsWithoutTaxEstimate: true, reserveWindowMonths: 0 };
test('default120: no non-payroll acquisition, no distributions; all ledgers and annual totals reconcile', () => {
  const r = checked('default'); assert.equal(r.rows.length,120);
  for (const row of r.rows) { near(row.nonPayrollAcquisitionCash,0); near(row.paidMediaSpend,0); near(row.totalDistributionPool,0); }
  assert.equal(r.summary.distributionPolicyConfigured,false); assert.equal(r.summary.taxPlanningConfigured,false); assert.equal(r.summary.recoveryMonth,null);
  for (const year of r.annualSummary) for (const [annual,monthly] of [['netRevenue','totalRevenue'],['operatingProfit','operatingProfit'],['variableOperatingCosts','variableOperatingCosts'],['fixedCommittedOperatingCosts','fixedCommittedOperatingCosts']]) {
    near(year[annual],r.rows.slice((year.year-1)*12,year.year*12).reduce((a,row)=>a+row[monthly],0));
  }
  assert.ok(r.rows.some(row=>row.cashAcquisitionIncludingPaidLabor > 0), 'Paid sales payroll still costs cash');
});
test('zero customers: independent $10k minus120*$300; month34 negative', () => {
  const r=checked('zero_customers',{investmentAmount:10000,acquisition:noAcq}); near(r.summary.endingCash,10000-120*300); assert.equal(r.summary.fundingGapMonth,34);
  for(const row of r.rows) {near(row.endingCash,10000-row.month*300); assert.equal(row.totalCashAcquisitionCac,null);}
});
test('two Starter full160 minutes: independent approved unit economics -62.128', () => {
  const r=checked('two_starter',{forecastMonths:3,startingCustomers:{starter:2},acquisition:noAcq,retention:noChurn,organization:noAuto});
  const expected=2*149 -2*160*0.14 -2*2 -(298*(0.029+0.007)+2*0.30)-300;
  near(expected,-62.128);for(const row of r.rows){near(row.totalRevenue,298);near(row.operatingProfit,expected);near(row.retellCost,44.8);}
});
test('flat additions with churn maintain100 paying businesses', () => {
  const r=checked('flat_churn',{forecastMonths:12,startingCustomers:{starter:100},acquisition:{planningMode:'channels',direct:{method:'override',payingCustomersPerMonth:10,planMix:{starter:1,growth:0,complete:0}}},retention:{...noChurn,baseMonthlyVoluntaryChurn:.1},organization:{...noAuto,capacityEnforcement:'warning_only'}});
  r.rows.forEach(row=>near(row.activeCustomers,100));
});
test('assisted close share survives market adjustment:12*.25/12=.25FTE', () => {
  const r=checked('sales_assistance_25pct',{forecastMonths:1,acquisition:{direct:{milestone:{first90DayCustomers:72,humanAssistedShare:.25}}},organization:noAuto});
  near(r.rows[0].plannedOrganization.requiredSalesFte,12*.25/12);near(r.rows[0].newPayingCustomers,12);
});
test('already-employed team continues payroll below150 after customer decline', () => {
  const r=checked('employed_team_decline',{forecastMonths:6,startingCustomers:{starter:200},acquisition:noAcq,retention:{...noChurn,baseMonthlyVoluntaryChurn:.1},organization:{...noAuto,headcountSchedule:[{role:'Support',approvalMonth:1,recruitingLeadMonths:0,startMonth:1,fteCount:1,monthlyBaseCompensation:4000,payrollBenefitsBurdenRate:.25,oneTimeHiringEquipmentCost:0}]}});
  near(r.rows[2].activeCustomers,145.8);r.rows.forEach(row=>near(row.employeePayroll,5000));
});
test('first employment below150 remains ineligible', () => {
  assert.throws(()=>run({forecastMonths:1,acquisition:noAcq,organization:{...noAuto,headcountSchedule:[{role:'Support',approvalMonth:1,recruitingLeadMonths:0,startMonth:1,fteCount:1,monthlyBaseCompensation:4000}]}}),/First employment/);
});
test('150 eligibility does not mandate a hire with no workload need', () => {
  const r=checked('150_not_automatic',{forecastMonths:3,startingCustomers:{starter:150},acquisition:noAcq,retention:noChurn,organization:{support:{contactsPerCustomerMonth:0}}});
  assert.equal(r.dynamicHeadcountSchedule.length,0);
});
test('approval plus lead time; full payroll at start; productivity50/75/100%', () => {
  const r=checked('dated_hire',{forecastMonths:5,startingCustomers:{starter:200},retention:noChurn,acquisition:noAcq,organization:{...noAuto,headcountSchedule:[{role:'Support',approvalMonth:1,recruitingLeadMonths:2,startMonth:2,fteCount:1,monthlyBaseCompensation:4000,payrollBenefitsBurdenRate:.25,oneTimeHiringEquipmentCost:4500}]}});
  near(r.rows[1].employeePayroll,0);[2,3,4].forEach((i)=>near(r.rows[i].employeePayroll,5000));
  [0.5,0.75,1].forEach((v,i)=>near(r.rows[i+2].headcount.byFunction.support,v));near(r.rows[2].headcount.oneTime,4500);near(r.rows[3].headcount.oneTime,0);near(r.rows[2].employeeSoftwareExpense,132);
});
test('explicit employment end date stops payroll and capacity, not revenue threshold', () => {
  const r=checked('hire_end',{forecastMonths:4,startingCustomers:{starter:200},retention:noChurn,acquisition:noAcq,organization:{...noAuto,headcountSchedule:[{role:'Support',approvalMonth:1,recruitingLeadMonths:0,startMonth:1,endMonth:2,fteCount:1,monthlyBaseCompensation:4000}]}});
  near(r.rows[2].employeePayroll,0);near(r.rows[2].headcount.byFunction.support,0);
});
test('zero founder management allocation does not grant free line management', () => {
  const r=checked('management_hours',{forecastMonths:1,startingCustomers:{starter:200},acquisition:noAcq,organization:{...noAuto,headcountSchedule:[{role:'Support',approvalMonth:1,recruitingLeadMonths:0,startMonth:1,fteCount:1,monthlyBaseCompensation:4000}]}});
  near(r.rows[0].organization.founderLineManagerCapacity,0);
});
test('unauthorized/invalid ownership and units fail closed; zero safely undefined', () => {
  for(const ownership of [-.01,1.01,'NaN','Infinity']) assert.throws(()=>run({investorOwnership:ownership}));
  for(const input of [{investmentAmount:0},{investorOwnership:0}]) {const r=checked('undefined_deal',{...input,forecastMonths:1});assert.equal(r.config.deal.impliedPostMoney,null);}
  assert.throws(()=>run({investmentAmount:-1}));assert.throws(()=>run({forecastMonths:0}));
});
test('founder-proposed25k1% derives2.5M post and2.475M pre;50k fixed ownership changes valuation', () => {
  const a=checked('deal25k',{forecastMonths:1}),b=checked('deal50k',{forecastMonths:1,investmentAmount:50000});
  near(a.config.investorOwnership,.01);near(a.config.deal.impliedPostMoney,2500000);near(a.config.deal.impliedPreMoney,2475000);near(b.config.deal.impliedPostMoney,5000000);
});
test('saved3.3 explicit10% and50% monthly policy survive migration; reset uses new defaults', () => {
  const saved=Model.createDefaultConfig(realm({version:'3.3.0',investorOwnership:.10,cash:{distributionPayoutRatio:.50,distributionStartMonth:1}}));
  near(saved.investorOwnership,.1);near(saved.cash.distributionPayoutRatio,.5);assert.equal(saved.cash.distributionEveryMonths,1);assert.equal(saved.cash.distributionPolicy,'periodic');assert.ok(saved._migrationNotice);
  const reset=Model.createDefaultConfig();near(reset.investorOwnership,.01);assert.equal(reset.cash.distributionPolicy,'unconfigured');
});
test('configured campaign starts only chosen month; unset date disables spend', () => {
  const r=checked('future_campaign',{forecastMonths:6,acquisition:{...noAcq,paid:{enabled:true,startMonth:4,spendPerMonth:1000,cac:100}},organization:noAuto});
  r.rows.forEach(row=>near(row.paidMediaSpend,row.month<4?0:1000));
  const unset=checked('undated_campaign',{forecastMonths:1,acquisition:{...noAcq,paid:{enabled:true,spendPerMonth:1000,cac:100}},organization:noAuto});near(unset.rows[0].paidMediaSpend,0);
});
test('$1000 marketing plus$200 support are present once in reconciled cost groups', () => {
  const r=checked('cost_group_omission',{forecastMonths:1,acquisition:{...noAcq,paid:{enabled:true,startMonth:1,spendPerMonth:1000,cac:100}},operatingCosts:{customerSuccessSupportCash:200},organization:noAuto});
  near(r.rows[0].fixedCommittedOperatingCosts,1500);near(r.rows[0].totalOperatingExpense,1500);
});
test('market pack opens opportunity but does not multiply10 target customers', () => {
  const r=checked('industry_pack',{forecastMonths:1,acquisition:{direct:{milestone:{first90DayCustomers:60}}},market:{segments:[{enabled:true,name:'Test pack',launchMonth:1,addressableAccounts:10000,maximumPenetration:1,acquisitionMultiplier:1}]},organization:{...noAuto,capacityEnforcement:'warning_only'}});
  near(r.rows[0].newPayingCustomers,10);near(Object.values(r.rows[0].marketSegmentAttribution).reduce((a,b)=>a+b,0),10);
});
test('aggregate target allocates channels; bottom-up channels add distinct pipelines', () => {
  const input={forecastMonths:1,acquisition:{direct:{milestone:{first90DayCustomers:60}},organic:{enabled:true,qualifiedLeadsMonth1:100,leadToPaidRate:.1}},organization:{...noAuto,capacityEnforcement:'warning_only'}};
  near(checked('target_channels',input).rows[0].newPayingCustomers,10);
  near(checked('bottom_up_channels',{...input,acquisition:{...input.acquisition,planningMode:'channels'}}).rows[0].newPayingCustomers,20);
});
test('9400 trials are940 potential payers at10%;9400 demand is a distinct scenario; loss not backlog', () => {
  for(const conversionRate of [.1,1]){
    const r=checked('trial_demand_'+conversionRate,{forecastMonths:3,acquisition:{...noAcq,events:[{month:1,incrementalLeads:9400,conversionRate,durationMonths:1}]}});
    near(r.rows[0].plannedNewPayingCustomers,9400*conversionRate);assert.ok(r.rows[0].blockedUnservedDemand>0);near(r.rows[1].newPayingCustomers,0);
    near(r.rows[0].selfServiceActivated+r.rows[0].assistedActivated,r.rows[0].newPayingCustomers);
  }
});
test('self-service survives assisted onboarding shortage but shared support remains binding', () => {
  const input={forecastMonths:1,acquisition:{...noAcq,events:[{month:1,incrementalLeads:100,conversionRate:1}]},organization:{...noAuto,founder:{onboardingHoursPerWeek:0},support:{contactsPerCustomerMonth:0}}};
  const r=checked('self_service_activation',input);assert.ok(r.rows[0].newPayingCustomers>0);near(r.rows[0].assistedActivated,0);assert.ok(r.rows[0].newPayingCustomers<100);
  near(r.rows[0].acquisition.eventDetails.reduce((sum,event)=>sum+event.customers,0),r.rows[0].newPayingCustomers);
  const constrained=checked('shared_support_activation',{...input,organization:{...input.organization,support:{contactsPerCustomerMonth:20}}});assert.ok(constrained.rows[0].newPayingCustomers<r.rows[0].newPayingCustomers);
});
test('pre150 capacity trap shows unmet demand without inventing early hires', () => {
  const r=checked('capacity_trap',{forecastMonths:36,acquisition:{direct:{method:'override',payingCustomersPerMonth:20}},organization:{support:{contactsPerCustomerMonth:2}}});
  assert.ok(r.rows.at(-1).activeCustomers<150);assert.ok(r.rows.at(-1).blockedUnservedDemand>0);assert.equal(r.dynamicHeadcountSchedule.length,0);
});
test('gradual5000/month target is allowed later, not default or immediate proven demand', () => {
  const r=checked('5000_later',{acquisition:{direct:{milestone:{peakMonthlyAdds:5000,peakMonth:120}}}});
  near(r.rows[0].plannedNewPayingCustomers,1.5);near(r.rows.at(-1).plannedNewPayingCustomers,5000);assert.ok(r.rows.at(-1).blockedUnservedDemand>0 || r.rows.at(-1).employeePayroll>0);
});
test('explicit$10k company-wide distribution pays100 investor9900 founder and10000 total', () => {
  const r=checked('10000_pro_rata',{forecastMonths:1,investmentAmount:100000,startingCustomers:{starter:200},acquisition:noAcq,retention:noChurn,organization:noAuto,cash:{...periodic,distributionPolicy:'dated',distributionRequests:[{month:1,amount:10000}]}});
  const row=r.rows[0];near(row.totalDistributionPool,10000);near(row.investorDistribution,100);near(row.otherOwnerDistributions,9900);near(row.cashBeforeDistribution-row.endingCash,10000);
});
test('bank100k minus20k tax earmark30k reserve10k contingency gives40k capacity without payment', () => {
  const input={forecastMonths:1,investmentAmount:100000,acquisition:noAcq,operatingCosts:{basePlatform:0},organization:noAuto,cash:{initialTaxEarmark:20000,minimumCashReserve:30000,reserveWindowMonths:0,contingencyProtection:10000}};
  const a=checked('cash_earmarks',input).rows[0];near(a.endingCash,100000);near(a.distributionCashCapacity,40000);
  const b=checked('provided_tax_payment',{...input,cash:{...input.cash,taxPayments:[{month:1,amount:5000}]}}).rows[0];near(b.endingCash,95000);near(b.taxEarmark,15000);near(b.distributionCashCapacity,40000);near(b.earningsEligibilityBalance,a.earningsEligibilityBalance);
});
test('restricted company cash stays in bank; no distribution of initial investment as earnings', () => {
  const r=checked('restricted_investment',{forecastMonths:1,investmentAmount:100000,restrictedFunds:10000,acquisition:noAcq,operatingCosts:{basePlatform:0},organization:noAuto,cash:{...periodic,distributionPolicy:'dated',distributionRequests:[{month:1,amount:50000}]}});
  near(r.rows[0].endingCash,100000);near(r.rows[0].restrictedCash,10000);near(r.rows[0].totalDistributionPool,0);near(r.summary.startingOperatingCash,90000);
});
test('accumulated eligible earnings include prior losses; periodic distribution not limited to current profit', () => {
  const r=checked('accumulated_earnings',{forecastMonths:3,startingCustomers:{starter:10},acquisition:noAcq,retention:noChurn,organization:noAuto,cash:periodic});
  near(r.rows[0].totalDistributionPool,0);near(r.rows[1].totalDistributionPool,0);near(r.rows[2].totalDistributionPool,3*r.rows[0].operatingProfit);near(r.rows[2].earningsEligibilityBalance,0);
  const loss=checked('prior_loss',{forecastMonths:3,acquisition:{...noAcq,events:[{month:2,incrementalLeads:10,conversionRate:1,durationMonths:1}]},retention:noChurn,organization:noAuto,cash:periodic});
  near(loss.rows[2].totalDistributionPool,loss.rows.reduce((a,row)=>a+row.operatingProfit,0));
});
test('unconfigured taxes prohibit distribution projection unless explicitly opted provisional', () => {
  const r=checked('taxes_unknown',{forecastMonths:3,startingCustomers:{starter:200},acquisition:noAcq,organization:noAuto,cash:{...periodic,provisionalDistributionsWithoutTaxEstimate:false}});
  near(r.summary.cumulativeInvestorDistributions,0);assert.equal(r.summary.recoveryMonth,null);assert.equal(r.summary.distributionProjectionAvailable,false);
});
test('tax provision is an earmark not cash payment; distributions reduce earnings once', () => {
  const r=checked('tax_provision',{forecastMonths:3,startingCustomers:{starter:10},acquisition:noAcq,retention:noChurn,organization:noAuto,operatingCosts:{taxReserveEnabled:true,taxReserveRate:.2},cash:{...periodic,provisionalDistributionsWithoutTaxEstimate:false}});
  near(r.rows[0].endingCash,25000+r.rows[0].operatingProfit);near(r.rows[0].taxEarmark,r.rows[0].operatingProfit*.2);
  near(r.rows[2].totalDistributionPool,r.rows.reduce((a,row)=>a+row.operatingProfit*.8,0));
});
test('low cash constrains distributions by gross forward reserve', () => {
  const r=checked('low_cash',{forecastMonths:3,investmentAmount:100,startingCustomers:{starter:10},retention:noChurn,acquisition:noAcq,organization:noAuto,cash:{...periodic,distributionStartMonth:1,distributionEveryMonths:1,reserveWindowMonths:3}});
  near(r.rows[0].endingCash,989.36);near(r.rows[0].totalDistributionPool,0);near(r.rows[0].forwardReserve,1801.92);
});
test('post-gap recovery remains unfinanceable and cannot distribute without resolved financing', () => {
  const r=checked('unfunded_recovery',{forecastMonths:12,investmentAmount:0,acquisition:{direct:{milestone:{first90DayCustomers:0,month12Target:100,peakMonthlyAdds:100,peakMonth:12}}},organization:noAuto,cash:{...periodic,distributionEveryMonths:1,distributionStartMonth:1}});
  assert.equal(r.summary.fundingGapMonth,1);assert.ok(r.rows.at(-1).endingCash>0);assert.ok(r.rows.every(row=>row.unfundedContinuation));near(r.summary.cumulativeInvestorDistributions,0);
});
test('investor distributions continue after cash recovery', () => {
  const r=checked('continued_investor_cash',{forecastMonths:12,investmentAmount:100,investorOwnership:.5,startingCustomers:{starter:200},retention:noChurn,acquisition:noAcq,organization:noAuto,cash:{...periodic,distributionStartMonth:1,distributionEveryMonths:1}});
  assert.equal(r.summary.recoveryMonth,1);assert.ok(r.rows.at(-1).investorDistribution>0);assert.ok(r.rows.at(-1).investorCashProfitAfterRecovery>0);
});
test('month120 reserve includes explicit month121+ commitments', () => {
  const r=checked('reserve_tail',{acquisition:noAcq,organization:{...noAuto,advisorSchedule:[{type:'Future project',startMonth:121,monthlyRetainer:1000,oneTimeProjectCost:2000}]}});
  near(r.rows.at(-1).forwardReserve,3*300+3*1000+2000);
});
test('unaffordable upcoming hires show funding requirement and reserve rather than fictional bridge', () => {
  const r=checked('unaffordable_hiring',{forecastMonths:5,investmentAmount:1000,startingCustomers:{starter:150},retention:noChurn,acquisition:noAcq,organization:{...noAuto,headcountSchedule:[{role:'Engineering',approvalMonth:1,recruitingLeadMonths:2,startMonth:3,fteCount:5,monthlyBaseCompensation:10000,payrollBenefitsBurdenRate:.25,oneTimeHiringEquipmentCost:4500}]}});
  assert.ok(r.rows[0].forwardReserve>100000);assert.ok(r.summary.fundingRequirement>0);assert.equal(r.summary.cumulativeAdditionalFunding,0);
});
test('annual prepay preserves monthly revenue134.1 and collections1609.2 only at renewal', () => {
  const r=checked('annual_prepaid',{forecastMonths:14,acquisition:{...noAcq,events:[{month:1,incrementalLeads:1,conversionRate:1,durationMonths:1}]},planMix:{starter:1,growth:0,complete:0},retention:noChurn,billing:{annualPrepaidRate:1,annualDiscountRate:.1,annualCancellationPolicy:'service_through_term'},organization:noAuto});
  [0,12].forEach(i=>near(r.rows[i].cashCollections,149*12*.9));near(r.rows[1].cashCollections,0);r.rows.forEach(row=>near(row.totalRevenue,149*.9));
  assert.throws(()=>run({billing:{annualPrepaidRate:1}}),/annual|Annual/);
});
test('CSV precise fields match canonical monthly result with no rounded-cell totals', () => {
  const r=checked('csv_parity',{forecastMonths:12});const lines=Model.exportMonthlyCsv(r).trim().split(/\r?\n/);const head=lines[0].split(',');assert.equal(lines.length,13);
  const parse=line=>line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g).slice(0,-1).map(v=>v.replace(/,$/,'').replace(/^"|"$/g,''));
  for(let i=1;i<lines.length;i++) for(const field of ['totalRevenue','operatingProfit','endingCash','variableOperatingCosts','fixedCommittedOperatingCosts','actualTaxPayments','taxEarmark']) near(Number(parse(lines[i])[head.indexOf(field)]),r.rows[i-1][field]);
});
test('seeded simulation reproduces and active acquisition/support-cost multipliers change results', () => {
  const fixed=Object.fromEntries(Object.keys(Model.AUTHORITY.defaults.uncertainty.assumptions).map(key=>[key,{low:1,base:1,high:1}]));
  const sample=(key,value,horizon)=>Model.runMonteCarlo(Model.createDefaultConfig(realm({forecastMonths:horizon,uncertainty:{assumptions:{...fixed,[key]:{low:value,base:value,high:value}}}})),realm({iterations:1,seed:13}));
  const a=sample('acquisitionVolumeMultiplier',.5,12),b=sample('acquisitionVolumeMultiplier',2,12);assert.notEqual(a.ranges.activeCustomers.p50,b.ranges.activeCustomers.p50);
  const c=sample('supportCostMultiplier',.5,120),d=sample('supportCostMultiplier',2,120);assert.notEqual(c.ranges.cash.p50,d.ranges.cash.p50);
  const config=Model.createDefaultConfig(realm({forecastMonths:12}));const first=Model.runMonteCarlo(config,realm({iterations:4,seed:32}));const second=Model.runMonteCarlo(config,realm({iterations:4,seed:32}));assert.equal(JSON.stringify(first),JSON.stringify(second));
  receipts.push({id:'simulation_bindings',acquisitionLow:a.ranges.activeCustomers,acquisitionHigh:b.ranges.activeCustomers,supportCostLow:c.ranges.cash,supportCostHigh:d.ranges.cash,seedReproduced:true});
});
test('offline worker contains exact canonical inline engine and distribution eligibility', () => {
  const worker=Buffer.from(source.match(/<template id="monteCarloWorkerSource">([\s\S]*?)<\/template>/)[1],'base64').toString();assert.ok(worker.startsWith(scripts[0]));assert.ok(worker.includes('earningsEligibilityBalance'));assert.ok(!source.includes('Cumulative 10% pro-rata share'));
});
test('20k tax payment consumes20k unprovided earnings, or releases prior20k provision without second deduction', () => {
  const base={forecastMonths:1,investmentAmount:80000,startingCustomers:{starter:200},retention:noChurn,acquisition:noAcq,
    organization:{...noAuto,founder:{compensationPolicy:'manual',manualMonthlyCompensation:0}},
    operatingCosts:{basePlatform:3787.2},cash:{...periodic,distributionPolicy:'dated',distributionRequests:[{month:1,amount:20000}],taxPayments:[{month:1,amount:20000}]}};
  for(const provisioned of [false,true]){
    const r=checked('tax_earnings_'+provisioned,{...base,operatingCosts:{...base.operatingCosts,taxReserveEnabled:provisioned,taxReserveRate:provisioned?1:0}}).rows[0];
    near(r.operatingProfit,20000);near(r.actualTaxPayments,20000);near(r.endingCash,80000);near(r.taxEarmark,0);near(r.earningsEligibilityBalance,0);near(r.totalDistributionPool,0);
  }
});
test('actual-month financial and customer locks survive changed future target; unsupported earnings history stays unavailable', () => {
  const original=run({forecastMonths:3,organization:noAuto});
  const actuals=original.rows.map(row=>({month:row.month,endingCustomers:row.activeCustomers,newPayingCustomers:row.newPayingCustomers,reactivations:row.reactivations,churnedCustomers:row.churnedCustomers,
    planCustomers:row.planEnding,mrr:row.mrr,revenue:row.totalRevenue,providerCost:row.directProviderCosts,opex:row.totalOperatingExpense,cashCollections:row.cashCollections,
    beginningCash:row.beginningCash,endingCash:row.endingCash,additionalFunding:0,investorDistribution:0,otherCashOutflows:0}));
  const changed=run({forecastMonths:6,actuals,organization:noAuto,acquisition:{direct:{milestone:{first90DayCustomers:180}}},cash:periodic});
  for(let i=0;i<3;i++){assert.equal(changed.rows[i].status,'ACTUAL');near(changed.rows[i].activeCustomers,original.rows[i].activeCustomers);near(changed.rows[i].endingCash,original.rows[i].endingCash);near(changed.rows[i].totalRevenue,original.rows[i].totalRevenue);}
  assert.equal(changed.summary.distributionProjectionAvailable,false);
  receipts.push({id:'actual_locks',actuals,changedSummary:changed.summary});
});
test('referrals use lagged businesses, not same-month recursive new payers, and rewards are variable once', () => {
  const r=checked('referral_lag',{forecastMonths:2,retention:noChurn,organization:{...noAuto,capacityEnforcement:'warning_only'},acquisition:{planningMode:'channels',direct:{method:'override',payingCustomersPerMonth:10},referral:{enabled:true,advocateRate:1,referralsPerAdvocate:1,qualifiedRate:1,paidConversionRate:.1,delayMonths:1,incentiveCostPerPaid:2}}});
  near(r.rows[0].acquisition.newReferral,0);near(r.rows[1].acquisition.newReferral,1);near(r.rows[1].expenseLedger.find(e=>e.id==='acquisition_referral').amount,2);near(r.rows[1].activeCustomers,21);
});
test('surge9400 paying demand records purchased capacity and immediate cash assumptions', () => {
  const r=checked('surge9400',{forecastMonths:3,investmentAmount:10000,acquisition:{...noAcq,events:[{month:1,incrementalLeads:9400,conversionRate:1,durationMonths:1}]},organization:{capacityEnforcement:'emergency_scale'}});
  near(r.rows[0].newPayingCustomers,9400);assert.ok(r.rows[0].expenseLedger.find(e=>e.id==='surge_purchased_work').amount>0);assert.ok(r.rows[0].organization.emergencyScale);
});
test('new attorney planning earmark protects15k within25k bank cash without an expense', () => {
  const r=checked('legal_default',{forecastMonths:1,acquisition:noAcq});
  near(r.summary.startingCompanyCash,25000);near(r.summary.openingLegalEarmark,15000);near(r.summary.startingOperatingCash,10000);
  near(r.rows[0].endingCash,24700);near(r.rows[0].legalReviewEarmark,15000);near(r.rows[0].opex.legalReviewPayment,0);near(r.rows[0].unearmarkedOperatingCash,9700);
});
test('attorney earmark may exceed funding: warn, retain bank identity, do not silently clip', () => {
  const r=checked('legal_underfunded',{investmentAmount:10000,acquisition:noAcq});
  near(r.summary.openingLegalEarmark,15000);near(r.summary.startingOperatingCash,-5000);near(r.summary.endingCash,-26000);
  assert.equal(r.summary.bankCashNegativeMonth,34);assert.ok(r.rows[0].unfundedContinuation);near(r.rows[0].legalReviewEarmark,15000);
});
test('opening attorney expense consumes cash and reserve once and remains an earnings loss', () => {
  const r=checked('legal_opening',{forecastMonths:1,investmentAmount:25000,actualLegalReadinessCost:15000,startingCustomers:{starter:100},retention:noChurn,acquisition:noAcq,
    organization:{...noAuto,founder:{compensationPolicy:'manual',manualMonthlyCompensation:0}},operatingCosts:{basePlatform:1893.6},
    cash:{...periodic,distributionPolicy:'dated',distributionRequests:[{month:1,amount:10000}]}});
  near(r.summary.startingCompanyCash,10000);near(r.summary.openingLegalEarmark,0);near(r.rows[0].operatingProfit,10000);
  near(r.rows[0].endingCash,20000);near(r.rows[0].earningsEligibilityBalance,-5000);near(r.rows[0].totalDistributionPool,0);
});
test('dated attorney invoice is one-time operating expense and releases matching earmark once', () => {
  const r=checked('legal_invoice',{forecastMonths:3,acquisition:noAcq,cash:{legalReviewPayments:[{month:2,amount:5000}]}});
  near(r.rows[0].endingCash,24700);near(r.rows[1].endingCash,19400);near(r.rows[2].endingCash,19100);
  near(r.rows[1].operatingProfit,-5300);near(r.rows[1].legalReviewEarmark,10000);near(r.rows[2].opex.legalReviewPayment,0);
  near(r.rows[0].grossForwardOperatingReserve,5900);near(r.rows[0].legalReserveOverlapCredit,5000);near(r.rows[0].forwardReserve,900);
  near(r.rows[1].expenseLedger.find(e=>e.id==='attorney_review_payment').amount,5000);
});
test('attorney commitments beyond120 remain protected without duplicate forward protection', () => {
  const r=checked('legal_tail',{investmentAmount:100000,acquisition:noAcq,cash:{legalReviewPayments:[{month:121,amount:5000}]}});
  near(r.rows.at(-1).grossForwardOperatingReserve,5900);near(r.rows.at(-1).forwardReserve,900);near(r.rows.at(-1).legalReviewEarmark,15000);
});
test('saved attorney values are preserved and absent legacy reserve is not silently added', () => {
  const absent=Model.createDefaultConfig(realm({version:'3.3.0',cash:{distributionPayoutRatio:.5}}));near(absent.cash.legalReviewReserve,0);
  const explicit=Model.createDefaultConfig(realm({version:'3.3.0',cash:{legalReviewReserve:12500}}));near(explicit.cash.legalReviewReserve,12500);
  near(Model.createDefaultConfig().cash.legalReviewReserve,15000);
});
test.after(() => {
  const out=path.resolve(__dirname,'../../outputs/investor-revision');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'numerical-results.json'),JSON.stringify({generatedAt:new Date().toISOString(),cases:receipts,qualification:'Implementation checks only. No independent review, founder visual approval, tax/legal approval or real-world validation.'},null,2));
});
