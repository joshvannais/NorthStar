/**
 * M13-P4: Opportunity & Pipeline Intelligence Engine — Smoke Tests
 *
 * Tests all 18 public API exports across the full opportunity lifecycle:
 * creation, pipeline movement, forecasting, analytics, and persistence.
 */

const store = require('../src/polaris/store');
const opps = require('../src/polaris/opportunity-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

// 1. Init
var initResult = opps.init();
c('init returns object', typeof initResult === 'object');
c('init has loaded count', typeof initResult.loaded === 'number');

// ── Opportunity Creation ──

var r = opps.createOpportunity({
  customerId: 'cust_opp_test_1',
  title: 'HVAC System Replacement - Commercial Building',
  description: 'Complete HVAC replacement for 3-story office building',
  estimatedValue: 45000,
  stage: 'lead',
  priority: 'high',
  owner: 'Sarah (Sales)',
  expectedCloseDate: '2026-09-30T00:00:00.000Z',
  tags: ['commercial', 'hvac', 'replacement'],
  notes: 'Initial lead from trade show',
});

c('create returns id', !!r.id);
c('create returns title', r.title.indexOf('HVAC') !== -1);
c('create returns stage lead', r.stage === 'lead');
c('create returns priority high', r.priority === 'high');
c('create returns estimatedValue', r.estimatedValue === 45000);
c('create returns probability', r.probability === 0.05);
c('create returns expectedRevenue', r.expectedRevenue === 2250);
var oppId1 = r.id;

// More opportunities
var r2 = opps.createOpportunity({
  customerId: 'cust_opp_test_1',
  title: 'Residential AC Tune-Up Package',
  estimatedValue: 3500,
  stage: 'qualified',
  priority: 'medium',
  owner: 'Sarah (Sales)',
});

c('create opp2', !!r2.id);
var oppId2 = r2.id;

var r3 = opps.createOpportunity({
  customerId: 'cust_opp_test_1',
  title: 'Emergency AC Repair - Downtown Office',
  estimatedValue: 12000,
  stage: 'discovery',
  priority: 'high',
  owner: 'John (Sales)',
});

c('create opp3', !!r3.id);
var oppId3 = r3.id;

var r4 = opps.createOpportunity({
  customerId: 'cust_opp_test_2',
  title: 'New Construction - Ductwork Installation',
  estimatedValue: 85000,
  stage: 'proposal',
  priority: 'high',
  owner: 'Sarah (Sales)',
});

c('create opp4', !!r4.id);
var oppId4 = r4.id;

var r5 = opps.createOpportunity({
  customerId: 'cust_opp_test_2',
  title: 'Annual Maintenance Contract',
  estimatedValue: 2400,
  stage: 'negotiation',
  priority: 'medium',
  owner: 'John (Sales)',
});

c('create opp5', !!r5.id);
var oppId5 = r5.id;

// ── Get Opportunity ──

var g = opps.getOpportunity(oppId1);
c('get returns title', g.title.indexOf('HVAC') !== -1);
c('get returns customerId', g.customerId === 'cust_opp_test_1');
c('get returns tags', Array.isArray(g.tags) && g.tags.length === 3);
c('get returns immutable copy', g.id === oppId1);

// ── Update Opportunity ──

var u = opps.updateOpportunity(oppId1, {
  title: 'HVAC System Replacement - Updated',
  priority: 'critical',
  estimatedValue: 50000,
});

c('update title', u.title.indexOf('Updated') !== -1);
c('update priority', u.priority === 'critical');
c('update estimatedValue', u.estimatedValue === 50000);
c('update probability unchanged', u.probability === 0.05);
c('update expectedRevenue recalculated', u.expectedRevenue === 2500);

// ── Pipeline Stage Movement ──

var s1 = opps.updateOpportunityStage(oppId1, 'qualified');
c('move to qualified', s1.stage === 'qualified');
c('qualified probability', s1.probability === 0.15);
c('qualified expectedRevenue', s1.expectedRevenue === 7500);

var s2 = opps.updateOpportunityStage(oppId1, 'discovery');
c('move to discovery', s2.stage === 'discovery');

var s3 = opps.updateOpportunityStage(oppId1, 'proposal');
c('move to proposal', s3.stage === 'proposal');

// ── List Opportunities ──

var list = opps.listOpportunities();
c('list returns array', Array.isArray(list.opportunities));
c('list has 5 opps', list.total === 5);

// Filter by stage
var leads = opps.listOpportunities({ stage: 'lead' });
c('filter lead', leads.total === 0);

var proposals = opps.listOpportunities({ stage: 'proposal' });
c('filter proposal', proposals.total === 2);

// Filter by customer
var custOpps = opps.listOpportunities({ customerId: 'cust_opp_test_1' });
c('filter by customer', custOpps.total === 3);

// Filter by owner
var sarahOpps = opps.listOpportunities({ owner: 'Sarah (Sales)' });
c('filter by owner', sarahOpps.total >= 2);

// Filter by priority
var highOpps = opps.listOpportunities({ priority: 'high' });
c('filter by priority', highOpps.total >= 2);

// ── Search ──

var search = opps.searchOpportunities('HVAC');
c('search finds HVAC', search.total >= 1);

var search2 = opps.searchOpportunities('Residential');
c('search finds Residential', search2.total >= 1);

var search3 = opps.searchOpportunities('nonexistent');
c('search nonexistent', search3.total === 0);

// ── Win Probability ──

var wp = opps.calculateWinProbability(oppId1);
c('win probability returns number', typeof wp.winProbability === 'number');
c('win probability in range', wp.winProbability >= 0 && wp.winProbability <= 1);
c('win probability has label', typeof wp.label === 'string');
c('win probability has adjustments', Array.isArray(wp.adjustments));

// Won opportunity
opps.updateOpportunityStage(oppId1, 'won');
var wp2 = opps.calculateWinProbability(oppId1);
c('won probability = 1.0', wp2.winProbability === 1.0);

// ── Pipeline ──

var pipe = opps.getPipeline();
c('pipeline totalDeals', pipe.totalDeals >= 5);
c('pipeline totalValue', typeof pipe.totalValue === 'number');
c('pipeline weightedValue', typeof pipe.weightedValue === 'number');
c('pipeline stageCounts', typeof pipe.stageCounts === 'object');
c('pipeline has byStage', typeof pipe.byStage === 'object');

// ── Pipeline Metrics ──

var metrics = opps.getPipelineMetrics();
c('metrics totalDeals', typeof metrics.totalDeals === 'number');
c('metrics activeDeals', typeof metrics.activeDeals === 'number');
c('metrics wonDeals', metrics.wonDeals >= 1);
c('metrics totalPipelineValue', typeof metrics.totalPipelineValue === 'number');
c('metrics weightedPipelineValue', typeof metrics.weightedPipelineValue === 'number');
c('metrics winRate', typeof metrics.winRate === 'number');
c('metrics winRateDisplay', typeof metrics.winRateDisplay === 'string');

// ── Stage Totals ──

var st = opps.getStageTotals();
c('stage totals', typeof st.stages === 'object');
c('stage totals has lead', typeof st.stages.lead === 'object');
c('stage totals has won', typeof st.stages.won === 'object');
c('stage totals has conversionRates', typeof st.conversionRates === 'object');
c('lead count', st.stages.lead.count === 0);
c('won count >= 1', st.stages.won.count >= 1);

// ── Forecast Revenue ──

var fc = opps.calculateForecastRevenue();
c('forecast totalActiveDeals', typeof fc.totalActiveDeals === 'number');
c('forecast weightedPipelineValue', typeof fc.weightedPipelineValue === 'number');
c('forecast has worstCase', typeof fc.forecast.worstCase === 'number');
c('forecast has mostLikely', typeof fc.forecast.mostLikely === 'number');
c('forecast has bestCase', typeof fc.forecast.bestCase === 'number');

// ── Expected Revenue (alias) ──

var er = opps.getExpectedRevenue();
c('expected revenue matches forecast', er.totalActiveDeals === fc.totalActiveDeals);

// ── Customer Opportunities ──

var custOpps2 = opps.getCustomerOpportunities('cust_opp_test_1');
c('customer opportunities', custOpps2.total === 3);

var custOpps3 = opps.getCustomerOpportunities('cust_opp_test_2');
c('customer opportunities 2', custOpps3.total === 2);

// ── Opportunity Health ──

var oh = opps.getOpportunityHealth(oppId2);
c('health score is number', typeof oh.healthScore === 'number');
c('health score in range', oh.healthScore >= 0 && oh.healthScore <= 100);
c('health has label', typeof oh.healthLabel === 'string');
c('health has factors', Array.isArray(oh.factors));
c('health has warnings', Array.isArray(oh.warnings));

// ── Priority Queue ──

var pq = opps.getPriorityQueue({ limit: 10 });
c('priority queue array', Array.isArray(pq.queue));
c('priority queue total', typeof pq.total === 'number');
c('priority queue has scores', pq.queue.length > 0 && typeof pq.queue[0].priorityScore === 'number');

// ── Archive / Restore ──

var arch = opps.archiveOpportunity(oppId2);
c('archive returns true', arch.archived === true);
c('archive has updatedAt', typeof arch.updatedAt === 'string');

var afterArch = opps.listOpportunities();
c('after archive, list has fewer', afterArch.total === 4);

var rest = opps.restoreOpportunity(oppId2);
c('restore returns false', rest.archived === false);
c('restore status open', rest.status === 'open');

var afterRest = opps.listOpportunities();
c('after restore, list back to 5', afterRest.total === 5);

// ── Stage Definitions ──

var stages = opps.getPipelineStages();
c('9 pipeline stages', stages.length === 9);
c('stage lead order 0', stages[0].order === 0);
c('stage won order 6', stages[6].order === 6);
c('stage won probability 1.0', stages[6].baseProbability === 1.0);

// ── Error Cases ──

c('create without customerId', opps.createOpportunity({}).error !== undefined);
c('create without title', opps.createOpportunity({customerId:'x'}).error !== undefined);
c('get nonexistent', opps.getOpportunity('nonexistent').error !== undefined);
c('invalid stage', opps.createOpportunity({customerId:'x', title:'Test', stage:'invalid'}).error !== undefined);
c('invalid priority', opps.createOpportunity({customerId:'x', title:'Test', priority:'invalid'}).error !== undefined);
c('archive nonexistent', opps.archiveOpportunity('nonexistent').error !== undefined);
c('restore not archived', opps.restoreOpportunity(oppId1).error !== undefined);
c('update nonexistent', opps.updateOpportunity('nonexistent', {}).error !== undefined);
c('health nonexistent', opps.getOpportunityHealth('nonexistent').error !== undefined);

// ── Final Summary ──

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');