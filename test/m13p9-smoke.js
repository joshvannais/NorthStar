/**
 * M13-P9: Job Execution Intelligence Engine — Smoke Tests
 */
const store = require('../src/polaris/store');
const job = require('../src/polaris/job-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

var initResult = job.init();
c('init returns object', typeof initResult === 'object');

// ── Job Creation ──

var j1 = job.createJob({
  title: 'HVAC Replacement - 123 Main St',
  customerId: 'cust_job_test_1',
  opportunityId: 'opp_job_test_1',
  priority: 'high',
  estimatedCost: 15000,
  totalUnits: 10,
  location: '123 Main St, Anytown',
  tags: ['hvac', 'residential'],
});
c('create job id', !!j1.id);
c('create job title', j1.title.indexOf('HVAC') !== -1);
c('create job status pending', j1.status === 'pending');
var jobId1 = j1.id;

var j2 = job.createJob({
  title: 'AC Tune-Up - 456 Oak Ave',
  customerId: 'cust_job_test_1',
  priority: 'medium',
  estimatedCost: 2500,
  totalUnits: 5,
});
c('create job 2', !!j2.id);
var jobId2 = j2.id;

// ── Get Job ──

var g = job.getJob(jobId1);
c('get job title', g.title.indexOf('HVAC') !== -1);
c('get job tags', Array.isArray(g.tags) && g.tags.length === 2);

// ── Update Job ──

var u = job.updateJob(jobId1, { title: 'HVAC Replacement - Updated', notes: 'Customer approved' });
c('update job', u.title.indexOf('Updated') !== -1);

// ── Schedule Job ──

var s = job.scheduleJob(jobId1,
  new Date(Date.now() + 3 * 86400000).toISOString(),
  new Date(Date.now() + 10 * 86400000).toISOString()
);
c('schedule status', s.status === 'scheduled');
c('schedule durationDays', s.durationDays >= 1);

// ── Start Job ──

var st = job.startJob(jobId1);
c('start status', st.status === 'inProgress');
c('start actualStart', typeof st.actualStart === 'string');

// ── Pause / Resume ──

var p = job.pauseJob(jobId1);
c('pause', p.status === 'paused');
var rs = job.resumeJob(jobId1);
c('resume', rs.status === 'inProgress');

// ── Complete Job ──

var comp = job.completeJob(jobId1, { notes: 'All work completed', actualCost: 14250 });
c('complete status', comp.status === 'completed');
c('complete actualEnd', typeof comp.actualEnd === 'string');

// ── Cancel Job ──

var can = job.cancelJob(jobId2, 'Customer cancelled');
c('cancel status', can.status === 'cancelled');

// ── Archive / Restore ──

var arch = job.archiveJob(jobId2);
c('archive', arch.archived === true);
var rest = job.restoreJob(jobId2);
c('restore', rest.status === 'pending');

// ── List Jobs ──

var list = job.listJobs();
c('list jobs', Array.isArray(list.jobs));
c('list total >= 2', list.total >= 2);

var custJobs = job.listJobs({ customerId: 'cust_job_test_1' });
c('filter by customer', custJobs.total >= 1);

// ── Search ──

var search = job.searchJobs('HVAC');
c('search', search.total >= 1);

// ── Work Orders ──

var wo = job.createWorkOrder({ jobId: jobId1, title: 'Install AC Unit', assignedTo: 'Mike (Tech)' });
c('work order id', !!wo.id);
c('work order status', wo.status === 'pending');

var wo2 = job.updateWorkOrder(wo.id, { status: 'completed' });
c('work order update', wo2.status === 'completed');

// ── Assignments ──

var ac = job.assignCrew(jobId1, 'crew_test_1');
c('assign crew', ac.crewIds.indexOf('crew_test_1') !== -1);

var aa = job.assignAssets(jobId1, ['ast_test_1', 'ast_test_2']);
c('assign assets', aa.assetIds.length === 2);

var ac2 = job.assignCustomer(jobId1, 'cust_job_test_2');
c('assign customer', ac2.customerId === 'cust_job_test_2');

var ao = job.assignOpportunity(jobId1, 'opp_job_test_2');
c('assign opportunity', ao.opportunityId === 'opp_job_test_2');

// ── Production ──

var prod = job.recordProduction(jobId1, { units: 5, phase: 'production' });
c('production units', prod.unitsCompleted === 5);
c('production phase', prod.phase === 'production');

var prod2 = job.recordProduction(jobId1, { units: 5 });
c('production total', prod2.unitsCompleted === 10);

// ── Inspections ──

var insp = job.recordInspection(jobId1, { inspector: 'QC Officer', result: 'pass', notes: 'All clear' });
c('inspection id', !!insp.id);
c('inspection result', insp.result === 'pass');

var qc = job.recordQualityCheck(jobId1, { inspector: 'Safety Officer', result: 'pass' });
c('quality check', !!qc.id);

// ── Issues ──

var iss = job.recordIssue(jobId1, { description: 'Unit not level', severity: 'medium', assignedTo: 'Mike (Tech)' });
c('issue id', !!iss.id);
c('issue severity', iss.severity === 'medium');

var res = job.resolveIssue(jobId1, iss.id);
c('resolve issue', res.status === 'resolved');

// ── Photos & Documents ──

var photo = job.recordPhoto(jobId1, { caption: 'Installation complete', takenBy: 'Mike' });
c('photo', photo.type === 'photo');

var doc = job.recordDocument(jobId1, { name: 'Permit.pdf', uploadedBy: 'Admin' });
c('document', doc.type === 'document');

// ── Material Usage ──

var mat = job.recordMaterialUsage(jobId1, { material: 'Copper tubing', quantity: 50, unitCost: 2.5 });
c('material recorded', mat.material === 'Copper tubing');

// ── Weather, Delay, Safety ──

var wx = job.recordWeather(jobId1, { condition: 'Sunny', temperature: 75 });
c('weather recorded', wx.condition === 'Sunny');

var dl = job.recordDelay(jobId1, { reason: 'Material delivery delayed', durationHours: 3 });
c('delay recorded', dl.reason === 'Material delivery delayed');

var sm = job.recordSafetyMeeting(jobId1, { topic: 'Ladder Safety', conductedBy: 'Foreman', attendees: 4 });
c('safety meeting', sm.topic === 'Ladder Safety');

// ── Analytics ──

var prog = job.calculateProgress(jobId1);
c('progress percent', prog.completionPercent === 100);
c('progress display', prog.completionDisplay === '100%');

var rate = job.calculateProductionRate(jobId1);
c('production rate', typeof rate.productionRate === 'number');

var cost = job.calculateJobCost(jobId1);
c('job cost', typeof cost.totalCost === 'number');

var prof = job.calculateProfitability(jobId1);
c('profitability margin', typeof prof.profitMargin === 'number');

var sv = job.calculateScheduleVariance(jobId1);
c('schedule variance', typeof sv.variance === 'number');

// ── Upcoming Jobs ──

var up = job.getUpcomingJobs(30);
c('upcoming jobs', Array.isArray(up.jobs));

// ── Job Metrics ──

var metrics = job.getJobMetrics();
c('metrics totalJobs', metrics.totalJobs >= 2);
c('metrics totalIssues', typeof metrics.totalIssues === 'number');
c('metrics openIssues', typeof metrics.openIssues === 'number');
c('metrics totalCost', typeof metrics.totalCost === 'number');

// ── Error Cases ──

c('create without title', job.createJob({}).error !== undefined);
c('create without customer', job.createJob({title:'Test'}).error !== undefined);
c('get nonexistent', job.getJob('nonexistent').error !== undefined);
c('schedule nonexistent', job.scheduleJob('nonexistent').error !== undefined);
c('start nonexistent', job.startJob('nonexistent').error !== undefined);
c('complete nonexistent', job.completeJob('nonexistent').error !== undefined);
c('record issue no description', job.recordIssue(jobId1, {}).error !== undefined);
c('work order without jobId', job.createWorkOrder({title:'Test'}).error !== undefined);
c('delay without reason', job.recordDelay(jobId1, {}).error !== undefined);
c('safety meeting no topic', job.recordSafetyMeeting(jobId1, {}).error !== undefined);

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');