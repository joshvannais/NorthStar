/**
 * M13-P5: Workflow & Scheduling Intelligence Engine — Smoke Tests
 *
 * Tests all 22+ public API exports across the full task lifecycle:
 * creation, scheduling, follow-ups, reminders, agenda views, and analytics.
 */

const store = require('../src/polaris/store');
const wf = require('../src/polaris/workflow-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

// 1. Init
var initResult = wf.init();
c('init returns object', typeof initResult === 'object');
c('init has loaded count', typeof initResult.loaded === 'number');

// ── Task Creation ──

var t1 = wf.createTask({
  title: 'Complete HVAC inspection for Johnson residence',
  type: 'inspection',
  priority: 'high',
  customerId: 'cust_wf_test_1',
  owner: 'Mike (Tech)',
  description: 'Full HVAC system inspection at 123 Main St',
  dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
  tags: ['inspection', 'residential'],
  notes: 'Call before arrival',
});

c('create returns id', !!t1.id);
c('create returns title', t1.title.indexOf('HVAC') !== -1);
c('create returns type', t1.type === 'inspection');
c('create returns priority', t1.priority === 'high');
c('create returns status', t1.status === 'pending');
c('create returns owner', t1.owner === 'Mike (Tech)');
var taskId1 = t1.id;

var t2 = wf.createTask({
  title: 'Send quote for commercial AC repair',
  type: 'email',
  priority: 'medium',
  customerId: 'cust_wf_test_1',
  owner: 'Sarah (Sales)',
  dueDate: new Date(Date.now() + 1 * 86400000).toISOString(),
});

c('create task2', !!t2.id);
var taskId2 = t2.id;

var t3 = wf.createTask({
  title: 'Site visit for new construction project',
  type: 'siteVisit',
  priority: 'critical',
  customerId: 'cust_wf_test_2',
  owner: 'Mike (Tech)',
  scheduledStart: new Date(Date.now() + 2 * 86400000).toISOString(),
  scheduledEnd: new Date(Date.now() + 2 * 86400000 + 2 * 3600000).toISOString(),
  dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
});

c('create task3', !!t3.id);
var taskId3 = t3.id;

// ── Get Task ──

var g = wf.getTask(taskId1);
c('get returns title', g.title.indexOf('HVAC') !== -1);
c('get returns description', g.description.indexOf('123 Main') !== -1);
c('get returns tags', Array.isArray(g.tags) && g.tags.length === 2);
c('get returns immutable copy', g.id === taskId1);
c('get returns typeDisplayName', typeof g.typeDisplayName === 'string');

// ── Update Task ──

var u = wf.updateTask(taskId1, {
  title: 'Complete HVAC inspection for Johnson residence - UPDATED',
  priority: 'critical',
  notes: 'Updated: call 2 hours before arrival',
});

c('update title', u.title.indexOf('UPDATED') !== -1);
c('update priority', u.priority === 'critical');

// ── Complete Task ──

var ct = wf.completeTask(taskId2);
c('complete status', ct.status === 'completed');
c('complete has updatedAt', typeof ct.updatedAt === 'string');

var g2 = wf.getTask(taskId2);
c('completed task has completedAt', g2.completedAt !== null);

// ── Archive / Restore ──

var arch = wf.archiveTask(taskId3);
c('archive returns true', arch.archived === true);

var afterArch = wf.listTasks();
c('after archive, list has fewer', afterArch.total === 2);

var rest = wf.restoreTask(taskId3);
c('restore returns false', rest.archived === false);
c('restore status pending', rest.status === 'pending');

var afterRest = wf.listTasks();
c('after restore, list back to 3', afterRest.total === 3);

// ── List Tasks ──

var list = wf.listTasks();
c('list returns array', Array.isArray(list.tasks));
c('list has 3 tasks', list.total === 3);

// Filter by type
var inspections = wf.listTasks({ type: 'inspection' });
c('filter by type inspection', inspections.total === 1);

// Filter by owner
var mikeTasks = wf.listTasks({ owner: 'Mike (Tech)' });
c('filter by owner', mikeTasks.total === 2);

// Filter by customer
var custTasks = wf.listTasks({ customerId: 'cust_wf_test_1' });
c('filter by customer', custTasks.total === 2);

// Filter by status
var pendingTasks = wf.listTasks({ status: 'pending' });
c('filter by status pending', pendingTasks.total >= 1);

// ── Search ──

var search = wf.searchTasks('HVAC');
c('search finds HVAC', search.total >= 1);

var search2 = wf.searchTasks('quote');
c('search finds quote', search2.total >= 1);

var search3 = wf.searchTasks('nonexistent');
c('search nonexistent', search3.total === 0);

// ── Schedule Reminder ──

var r = wf.scheduleReminder({
  title: 'Call Johnson about inspection results',
  customerId: 'cust_wf_test_1',
  owner: 'Mike (Tech)',
  dueDate: new Date(Date.now() + 1 * 86400000).toISOString(),
  priority: 'high',
});

c('reminder returns id', !!r.id);
c('reminder type is reminder', r.type === 'reminder');
c('reminder priority high', r.priority === 'high');
c('reminder status pending', r.status === 'pending');

// ── Schedule Appointment ──

var app = wf.scheduleAppointment({
  title: 'Johnson residence - HVAC system walkthrough',
  customerId: 'cust_wf_test_1',
  owner: 'Mike (Tech)',
  scheduledStart: new Date(Date.now() + 5 * 86400000).toISOString(),
  scheduledEnd: new Date(Date.now() + 5 * 86400000 + 1 * 3600000).toISOString(),
  priority: 'high',
  description: 'Walkthrough with homeowner',
});

c('appointment returns id', !!app.id);
c('appointment type', app.type === 'appointment');
c('appointment status pending', app.status === 'pending');
var appId = app.id;

// ── Reschedule Appointment ──

var res = wf.rescheduleAppointment(appId,
  new Date(Date.now() + 6 * 86400000).toISOString(),
  new Date(Date.now() + 6 * 86400000 + 2 * 3600000).toISOString()
);
c('reschedule', res.status === 'pending');

// ── Cancel Appointment ──

var can = wf.cancelAppointment(appId);
c('cancel', can.status === 'cancelled');

// ── Create Follow-up ──

var fu = wf.createFollowUp({
  title: 'Follow up on HVAC inspection results',
  customerId: 'cust_wf_test_1',
  owner: 'Sarah (Sales)',
  priority: 'medium',
});

c('follow-up returns id', !!fu.id);
c('follow-up type', fu.type === 'followUp');

// ── Assign Task ──

var as = wf.assignTask(taskId1, 'John (Tech)');
c('assign task', as.owner === 'John (Tech)');

// ── Prioritize Tasks ──

var pt = wf.prioritizeTasks();
c('prioritize returns array', Array.isArray(pt.tasks));
c('prioritize has scores', pt.tasks.length > 0 && typeof pt.tasks[0].priorityScore === 'number');
c('prioritize has factors', typeof pt.tasks[0].factors === 'object');

// ── Today Agenda ──

var today = wf.getTodayAgenda();
c('today agenda returns array', Array.isArray(today.tasks));
c('today agenda total', typeof today.total === 'number');

// ── Overdue Tasks ──

// Create an overdue task
var pastDate = new Date(Date.now() - 5 * 86400000).toISOString();
wf.createTask({
  title: 'Overdue inspection report',
  type: 'task',
  priority: 'high',
  customerId: 'cust_wf_test_1',
  owner: 'Mike (Tech)',
  dueDate: pastDate,
});

var overdue = wf.getOverdueTasks();
c('overdue returns array', Array.isArray(overdue.tasks));
c('overdue has at least 1', overdue.total >= 1);

// ── Upcoming Tasks ──

var upcoming = wf.getUpcomingTasks(14);
c('upcoming returns array', Array.isArray(upcoming.tasks));
c('upcoming total', typeof upcoming.total === 'number');

// ── Workflow Metrics ──

var metrics = wf.getWorkflowMetrics();
c('metrics totalTasks', typeof metrics.totalTasks === 'number');
c('metrics totalTasks > 0', metrics.totalTasks > 0);
c('metrics activeTasks', typeof metrics.activeTasks === 'number');
c('metrics completedTasks', typeof metrics.completedTasks === 'number');
c('metrics completionRate', typeof metrics.completionRate === 'number');
c('metrics completionRateDisplay', typeof metrics.completionRateDisplay === 'string');
c('metrics overdueTasks', typeof metrics.overdueTasks === 'number');
c('metrics avgCompletionTimeHours', typeof metrics.avgCompletionTimeHours === 'number');
c('metrics followUpCompliance', typeof metrics.followUpCompliance === 'number');
c('metrics byType', typeof metrics.byType === 'object');
c('metrics byOwner', typeof metrics.byOwner === 'object');
c('metrics has inspection type', metrics.byType.inspection !== undefined);
c('metrics has followUp type', metrics.byType.followUp !== undefined);

// ── Task Timeline ──

var tl = wf.getTaskTimeline('cust_wf_test_1');
c('timeline returns array', Array.isArray(tl.tasks));
c('timeline customer has tasks', tl.total >= 2);

// ── Workflow Types ──

var types = wf.getWorkflowTypes();
c('12 workflow types', types.length === 12);
c('has task type', types[0].id === 'task');
c('has siteVisit type', types.some(function(t) { return t.id === 'siteVisit'; }));

// ── Error Cases ──

c('create without title', wf.createTask({}).error !== undefined);
c('get nonexistent', wf.getTask('nonexistent').error !== undefined);
c('update nonexistent', wf.updateTask('nonexistent', {}).error !== undefined);
c('archive nonexistent', wf.archiveTask('nonexistent').error !== undefined);
c('restore not archived', wf.restoreTask(taskId1).error !== undefined);
c('invalid type', wf.createTask({title: 'Test', type: 'invalid'}).error !== undefined);
c('invalid priority', wf.createTask({title: 'Test', priority: 'invalid'}).error !== undefined);
c('reminder without dueDate', wf.scheduleReminder({title: 'Test'}).error !== undefined);
c('appointment without start', wf.scheduleAppointment({title: 'Test'}).error !== undefined);
c('assign without owner', wf.assignTask(taskId1, '').error !== undefined);
c('follow-up without title', wf.createFollowUp({}).error !== undefined);

// ── Final Summary ──

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');