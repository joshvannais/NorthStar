/**
 * M13-P8: Crew & Resource Intelligence Engine — Smoke Tests
 */
const store = require('../src/polaris/store');
const crew = require('../src/polaris/crew-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

var initResult = crew.init();
c('init returns object', typeof initResult === 'object');

// ── Employee Creation ──

var e1 = crew.createEmployee({ name: 'Mike Johnson', role: 'foreman', hourlyRate: 35, skills: ['HVAC', 'Leadership'] });
c('create employee id', !!e1.id);
c('create employee name', e1.name === 'Mike Johnson');
c('create employee role', e1.role === 'foreman');
c('create employee hourlyRate', e1.hourlyRate === 35);
var empId1 = e1.id;

var e2 = crew.createEmployee({ name: 'Sarah Williams', role: 'climber', hourlyRate: 28, skills: ['Tree Work', 'Rigging'] });
c('create employee 2', !!e2.id);
var empId2 = e2.id;

var e3 = crew.createEmployee({ name: 'Tom Brown', role: 'groundWorker', hourlyRate: 22 });
c('create employee 3', !!e3.id);
var empId3 = e3.id;

var e4 = crew.createEmployee({ name: 'Lisa Davis', role: 'estimator', hourlyRate: 32 });
c('create employee 4', !!e4.id);

// ── Get Employee ──

var g = crew.getEmployee(empId1);
c('get employee name', g.name === 'Mike Johnson');
c('get employee skills', Array.isArray(g.skills) && g.skills.length === 2);

// ── Update Employee ──

var u = crew.updateEmployee(empId1, { hourlyRate: 38, notes: 'Promoted to senior foreman' });
c('update hourlyRate', u.hourlyRate === 38);

// ── Archive / Restore ──

var arch = crew.archiveEmployee(empId3);
c('archive employee', arch.status === 'archived');
var rest = crew.restoreEmployee(empId3);
c('restore employee', rest.status === 'active');

// ── List Employees ──

var list = crew.listEmployees();
c('list employees', list.total >= 3);

var foremen = crew.listEmployees({ role: 'foreman' });
c('filter by role', foremen.total === 1);

// ── Crew Creation ──

var c1 = crew.createCrew({ name: 'Alpha Team', description: 'Primary residential crew', foremanId: empId1 });
c('create crew id', !!c1.id);
c('create crew name', c1.name === 'Alpha Team');
c('create crew memberCount', c1.memberCount === 0);
var crewId1 = c1.id;

var c2 = crew.createCrew({ name: 'Beta Team', description: 'Commercial crew' });
c('create crew 2', !!c2.id);
var crewId2 = c2.id;

// ── Get Crew ──

var gc = crew.getCrew(crewId1);
c('get crew name', gc.name === 'Alpha Team');

// ── Assign Employee to Crew ──

var ae = crew.assignEmployee(empId1, crewId1);
c('assign emp1 to crew', ae.crewId === crewId1);
c('assign emp1 crewName', ae.crewName === 'Alpha Team');

crew.assignEmployee(empId2, crewId1);
crew.assignEmployee(empId3, crewId1);

var gc2 = crew.getCrew(crewId1);
c('crew member count', gc2.memberIds.length === 3);

// ── Remove Employee from Crew ──

var re = crew.removeEmployee(empId3);
c('remove employee from crew', re.removed === true);
var gc3 = crew.getCrew(crewId1);
c('crew member count after remove', gc3.memberIds.length === 2);

crew.assignEmployee(empId3, crewId1);

// ── Assign Crew ──

var ac = crew.assignCrew(crewId1, { assignedWorkflowId: 'wf_test_1', assignedCustomerId: 'cust_test_1' });
c('assign crew deployed', ac.status === 'deployed');

var rc = crew.removeCrewAssignment(crewId1);
c('remove crew assignment', rc.status === 'idle');

// ── List Crews ──

var lc = crew.listCrews();
c('list crews', lc.total === 2);

// ── Search ──

var se = crew.searchEmployees('Mike');
c('search employees', se.total >= 1);

var sc = crew.searchCrews('Alpha');
c('search crews', sc.total === 1);

// ── Asset Assignment ──

var aa = crew.assignAsset(crewId1, 'ast_test_1');
c('assign asset to crew', aa.crewId === crewId1);

var ra = crew.removeAsset(crewId1, 'ast_test_1');
c('remove asset from crew', ra.removed === true);

// ── Certifications ──

var cert = crew.recordCertification({ employeeId: empId1, name: 'HVAC Master License', issuingBody: 'State Board', expiryDate: '2027-06-01T00:00:00.000Z' });
c('certification id', !!cert.id);
c('certification name', cert.name === 'HVAC Master License');

var renew = crew.renewCertification(cert.id, '2028-06-01T00:00:00.000Z');
c('renew certification', renew.status === 'active');

var expire = crew.expireCertification(cert.id);
c('expire certification', expire.status === 'expired');

var training = crew.recordTraining({ employeeId: empId2, name: 'Safety Training Level 2', provider: 'OSHA', completedDate: _now() });
c('training id', !!training.id);

function _now() { return new Date().toISOString(); }

// ── Time Entry ──

var te = crew.recordTimeEntry({ employeeId: empId1, hours: 8, date: new Date().toISOString().split('T')[0], description: 'HVAC installation' });
c('time entry id', !!te.id);
c('time entry hours', te.hours === 8);

crew.recordTimeEntry({ employeeId: empId1, hours: 2, type: 'overtime' });
crew.recordTimeEntry({ employeeId: empId2, hours: 8 });

// ── Availability ──

var av = crew.recordAvailability({ employeeId: empId1, date: new Date(Date.now() + 1 * 86400000).toISOString().split('T')[0], available: true, startTime: '08:00', endTime: '17:00' });
c('availability recorded', !!av.id);
c('availability', av.available === true);

// ── Schedule Shift ──

var ss = crew.scheduleShift({ employeeId: empId1, date: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0], startTime: '07:00', endTime: '15:00' });
c('shift scheduled', !!ss.id);
c('shift start', ss.startTime === '07:00');

// ── Absence ──

var ab = crew.recordAbsence({ employeeId: empId2, date: new Date(Date.now() + 1 * 86400000).toISOString().split('T')[0], type: 'sick', reason: 'Flu' });
c('absence recorded', !!ab.id);
c('absence type', ab.type === 'sick');

// ── Performance ──

var perf = crew.recordPerformance({ employeeId: empId1, rating: 5, notes: 'Excellent work on HVAC install', reviewer: 'Manager' });
c('performance recorded', perf.rating === 5);

// ── Labor Cost ──

var lc2 = crew.calculateLaborCost(empId1);
c('labor cost total', typeof lc2.totalCost === 'number');
c('labor cost regularHours', lc2.regularHours >= 8);

// ── Crew Utilization ──

var cu = crew.calculateCrewUtilization(crewId1);
c('crew utilization rate', typeof cu.utilizationRate === 'number');
c('crew utilization display', typeof cu.utilizationDisplay === 'string');

// ── Employee Productivity ──

var ep = crew.calculateEmployeeProductivity(empId1);
c('productivity totalHours', typeof ep.totalHoursLogged === 'number');
c('productivity avgHoursPerDay', typeof ep.avgHoursPerDay === 'number');

// ── Crew Efficiency ──

var ce = crew.calculateCrewEfficiency(crewId1);
c('efficiency rate', typeof ce.efficiency === 'number');
c('efficiency display', typeof ce.efficiencyDisplay === 'string');

// ── Availability Check ──

var ac2 = crew.calculateAvailability(empId1);
c('availability check', typeof ac2.available === 'boolean');

// ── Overtime ──

var ot = crew.calculateOvertime(empId1, 7);
c('overtime hours', typeof ot.overtimeHours === 'number');
c('overtime cost', typeof ot.overtimeCost === 'number');

// ── Crew Schedule ──

var cs = crew.getCrewSchedule(crewId1);
c('crew schedule has members', cs.schedule.length >= 1);

// ── Upcoming Assignments ──

var ua = crew.getUpcomingAssignments(crewId1);
c('upcoming assignments', Array.isArray(ua.assignments));

// ── Crew Metrics ──

var cm = crew.getCrewMetrics();
c('metrics totalEmployees', cm.totalEmployees >= 3);
c('metrics totalCrews', cm.totalCrews >= 2);
c('metrics totalCertifications', cm.totalCertifications >= 1);
c('metrics totalLaborCost', typeof cm.totalLaborCost === 'number');

// ── Error Cases ──

c('create employee without name', crew.createEmployee({}).error !== undefined);
c('get nonexistent', crew.getEmployee('nonexistent').error !== undefined);
c('update nonexistent', crew.updateEmployee('nonexistent', {}).error !== undefined);
c('archive nonexistent', crew.archiveEmployee('nonexistent').error !== undefined);
c('get crew nonexistent', crew.getCrew('nonexistent').error !== undefined);
c('assign employee nonexistent', crew.assignEmployee('nonexistent', crewId1).error !== undefined);
c('invalid role', crew.createEmployee({name:'Test', role:'invalid'}).error !== undefined);
c('invalid employee status', crew.createEmployee({name:'Test', status:'invalid'}).error !== undefined);
c('time entry no hours', crew.recordTimeEntry({employeeId: empId1}).error !== undefined);
c('absence no date', crew.recordAbsence({employeeId: empId1}).error !== undefined);
c('shift no date', crew.scheduleShift({employeeId: empId1}).error !== undefined);

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');