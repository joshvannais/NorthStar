/**
 * Polaris Crew & Resource Intelligence Engine
 *
 * Manages employees, crews, certifications, scheduling, availability,
 * labor allocation, workload balancing, productivity metrics, and
 * job assignments.
 *
 * Ownership Boundary:
 *   - Employee lifecycle (hire, update, archive, restore)
 *   - Crew lifecycle (create, update, archive)
 *   - Employee-to-crew assignment
 *   - Asset-to-crew assignment
 *   - Certifications and training records
 *   - Time tracking, availability, and shift scheduling
 *   - Absence management
 *   - Performance recording
 *   - Labor cost and utilization analytics
 *   - Crew efficiency and productivity metrics
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence)
 *   - communications-engine.js (activity recording)
 *   - workflow-engine.js (task context)
 *   - asset-engine.js (asset context)
 *   - financial-engine.js (cost context)
 */

const store = require('./store');

// ── Employee Role Constants ──
const EMPLOYEE_ROLES = Object.freeze({
  foreman:     { id: 'foreman',     displayName: 'Foreman' },
  climber:     { id: 'climber',     displayName: 'Climber' },
  groundWorker: { id: 'groundWorker', displayName: 'Ground Worker' },
  estimator:   { id: 'estimator',   displayName: 'Estimator' },
  salesperson: { id: 'salesperson', displayName: 'Salesperson' },
  admin:       { id: 'admin',       displayName: 'Administrative' },
  other:       { id: 'other',       displayName: 'Other' },
});

const VALID_ROLES = new Set(Object.keys(EMPLOYEE_ROLES));

// ── Employee Status Constants ──
const EMPLOYEE_STATUSES = Object.freeze({
  active:    { id: 'active',    displayName: 'Active' },
  onLeave:   { id: 'onLeave',   displayName: 'On Leave' },
  inactive:  { id: 'inactive',  displayName: 'Inactive' },
  archived:  { id: 'archived',  displayName: 'Archived' },
});

const VALID_EMP_STATUSES = new Set(Object.keys(EMPLOYEE_STATUSES));

// ── Crew Status Constants ──
const CREW_STATUSES = Object.freeze({
  active:    { id: 'active',    displayName: 'Active' },
  deployed:  { id: 'deployed',  displayName: 'Deployed' },
  idle:      { id: 'idle',      displayName: 'Idle' },
  archived:  { id: 'archived',  displayName: 'Archived' },
});

const VALID_CREW_STATUSES = new Set(Object.keys(CREW_STATUSES));

// ── In-memory stores ──
const _employees = {};
const _crews = {};
const _certifications = {};
const _timeEntries = {};
const _shifts = {};
var _idCounter = 0;

function _genId() {
  _idCounter++;
  return 'crew_' + Date.now() + '_' + _idCounter;
}

function _now() {
  return new Date().toISOString();
}

function _today() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function _persist(type, data) {
  try {
    store.addRecommendation({
      type: 'crew',
      crewType: type,
      crewId: data.id,
      data: data,
      timestamp: data.updatedAt || data.createdAt || _now(),
    });
  } catch (e) {}
}

function _recordActivity(action, description, metadata) {
  try {
    var comms = require('./communications-engine');
    comms.recordCommunication({
      customerId: 'internal',
      type: 'internal',
      direction: 'outbound',
      subject: 'Crew: ' + action,
      content: description,
      status: 'completed',
      author: 'System',
      metadata: metadata || {},
    });
  } catch (e) {}
}

// ── Validation ──

function _validateRole(role) {
  if (!VALID_ROLES.has(role)) return { valid: false, error: 'Invalid role: "' + role + '". Allowed: ' + Array.from(VALID_ROLES).join(', ') };
  return { valid: true };
}

function _validateEmpStatus(status) {
  if (!VALID_EMP_STATUSES.has(status)) return { valid: false, error: 'Invalid status: "' + status + '". Allowed: ' + Array.from(VALID_EMP_STATUSES).join(', ') };
  return { valid: true };
}

function _validateCrewStatus(status) {
  if (!VALID_CREW_STATUSES.has(status)) return { valid: false, error: 'Invalid crew status: "' + status + '". Allowed: ' + Array.from(VALID_CREW_STATUSES).join(', ') };
  return { valid: true };
}

// ── Init ──

function init() {
  var loaded = 0;
  try {
    var recs = store.getAllRecommendations() || [];
    recs.forEach(function (r) {
      if (r && r.type === 'crew' && r.data && r.data.id) {
        if (r.crewType === 'employee') _employees[r.data.id] = r.data;
        else if (r.crewType === 'crew') _crews[r.data.id] = r.data;
        else if (r.crewType === 'certification') _certifications[r.data.id] = r.data;
        else if (r.crewType === 'timeEntry') _timeEntries[r.data.id] = r.data;
        else if (r.crewType === 'shift') _shifts[r.data.id] = r.data;
        loaded++;
      }
    });
  } catch (e) {}
  return { loaded: loaded };
}

// ── Employee CRUD ──

function createEmployee(data) {
  if (!data || !data.name) return { error: 'Employee name is required' };

  var role = data.role || 'other';
  var roleCheck = _validateRole(role);
  if (!roleCheck.valid) return { error: roleCheck.error };

  var status = data.status || 'active';
  var statusCheck = _validateEmpStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  var id = _genId();
  var now = _now();

  var emp = {
    id: id,
    name: data.name,
    email: data.email || null,
    phone: data.phone || null,
    role: role,
    roleDisplayName: EMPLOYEE_ROLES[role].displayName,
    status: status,
    statusDisplayName: EMPLOYEE_STATUSES[status].displayName,
    crewId: null,
    hourlyRate: data.hourlyRate || 0,
    overtimeRate: data.overtimeRate || (data.hourlyRate ? data.hourlyRate * 1.5 : 0),
    hireDate: data.hireDate || now,
    certifications: [],
    skills: Array.isArray(data.skills) ? data.skills.slice() : [],
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  _employees[id] = emp;
  _persist('employee', emp);
  _recordActivity('Employee Created: ' + data.name, 'Employee "' + data.name + '" (' + EMPLOYEE_ROLES[role].displayName + ') hired');

  return { id: emp.id, name: emp.name, role: emp.role, status: emp.status, hourlyRate: emp.hourlyRate };
}

function updateEmployee(id, updates) {
  if (!id) return { error: 'Employee ID is required' };
  var emp = _employees[id];
  if (!emp) return { error: 'Employee not found: ' + id };
  if (!updates) return { error: 'Updates required' };

  if (updates.name !== undefined) emp.name = updates.name;
  if (updates.email !== undefined) emp.email = updates.email;
  if (updates.phone !== undefined) emp.phone = updates.phone;
  if (updates.hourlyRate !== undefined) emp.hourlyRate = updates.hourlyRate;
  if (updates.overtimeRate !== undefined) emp.overtimeRate = updates.overtimeRate;
  if (updates.notes !== undefined) emp.notes = updates.notes;
  if (Array.isArray(updates.skills)) emp.skills = updates.skills.slice();

  if (updates.role !== undefined) {
    var roleCheck = _validateRole(updates.role);
    if (!roleCheck.valid) return { error: roleCheck.error };
    emp.role = updates.role;
    emp.roleDisplayName = EMPLOYEE_ROLES[updates.role].displayName;
  }

  if (updates.status !== undefined) {
    var statusCheck = _validateEmpStatus(updates.status);
    if (!statusCheck.valid) return { error: statusCheck.error };
    emp.status = updates.status;
    emp.statusDisplayName = EMPLOYEE_STATUSES[updates.status].displayName;
  }

  emp.updatedAt = _now();
  _persist('employee', emp);
  return { id: emp.id, name: emp.name, role: emp.role, status: emp.status, hourlyRate: emp.hourlyRate, updatedAt: emp.updatedAt };
}

function archiveEmployee(id) { return updateEmployee(id, { status: 'archived' }); }

function restoreEmployee(id) {
  if (!id) return { error: 'Employee ID is required' };
  var emp = _employees[id];
  if (!emp) return { error: 'Employee not found: ' + id };
  if (emp.status !== 'archived') return { error: 'Employee is not archived' };
  return updateEmployee(id, { status: 'active' });
}

function getEmployee(id) {
  if (!id) return { error: 'Employee ID is required' };
  var emp = _employees[id];
  if (!emp) return { error: 'Employee not found: ' + id };
  return Object.assign({}, emp);
}

function listEmployees(filters) {
  var results = [];
  Object.keys(_employees).forEach(function (k) {
    var e = _employees[k];
    if (filters) {
      if (filters.role && e.role !== filters.role) return;
      if (filters.status && e.status !== filters.status) return;
      if (filters.crewId && e.crewId !== filters.crewId) return;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (e.name.toLowerCase().indexOf(q) === -1 && (e.email || '').toLowerCase().indexOf(q) === -1) return;
      }
    }
    if (e.status === 'archived' && !filters) return;
    results.push(e);
  });
  results.sort(function (a, b) { return a.name.localeCompare(b.name); });
  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) results = results.slice(0, filters.limit);
  return { employees: results.map(function (e) { return Object.assign({}, e); }), total: total };
}

function searchEmployees(query, filters) {
  return listEmployees(Object.assign({}, filters || {}, { search: query }));
}

// ── Crew CRUD ──

function createCrew(data) {
  if (!data || !data.name) return { error: 'Crew name is required' };

  var status = data.status || 'active';
  var statusCheck = _validateCrewStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  var id = _genId();
  var now = _now();

  var crew = {
    id: id,
    name: data.name,
    description: data.description || null,
    status: status,
    statusDisplayName: CREW_STATUSES[status].displayName,
    foremanId: data.foremanId || null,
    memberIds: [],
    assetIds: [],
    assignedWorkflowId: data.assignedWorkflowId || null,
    assignedOpportunityId: data.assignedOpportunityId || null,
    assignedCustomerId: data.assignedCustomerId || null,
    createdAt: now,
    updatedAt: now,
  };

  _crews[id] = crew;
  _persist('crew', crew);
  _recordActivity('Crew Created: ' + data.name, 'Crew "' + data.name + '" created');

  return { id: crew.id, name: crew.name, status: crew.status, memberCount: 0 };
}

function updateCrew(id, updates) {
  if (!id) return { error: 'Crew ID is required' };
  var crew = _crews[id];
  if (!crew) return { error: 'Crew not found: ' + id };
  if (!updates) return { error: 'Updates required' };

  if (updates.name !== undefined) crew.name = updates.name;
  if (updates.description !== undefined) crew.description = updates.description;
  if (updates.foremanId !== undefined) crew.foremanId = updates.foremanId;
  if (updates.assignedWorkflowId !== undefined) crew.assignedWorkflowId = updates.assignedWorkflowId;
  if (updates.assignedOpportunityId !== undefined) crew.assignedOpportunityId = updates.assignedOpportunityId;
  if (updates.assignedCustomerId !== undefined) crew.assignedCustomerId = updates.assignedCustomerId;

  if (updates.status !== undefined) {
    var sc = _validateCrewStatus(updates.status);
    if (!sc.valid) return { error: sc.error };
    crew.status = updates.status;
    crew.statusDisplayName = CREW_STATUSES[updates.status].displayName;
  }

  crew.updatedAt = _now();
  _persist('crew', crew);
  return { id: crew.id, name: crew.name, status: crew.status, updatedAt: crew.updatedAt };
}

function archiveCrew(id) {
  if (!id) return { error: 'Crew ID is required' };
  var crew = _crews[id];
  if (!crew) return { error: 'Crew not found: ' + id };
  return updateCrew(id, { status: 'archived' });
}

function getCrew(id) {
  if (!id) return { error: 'Crew ID is required' };
  var crew = _crews[id];
  if (!crew) return { error: 'Crew not found: ' + id };
  return Object.assign({}, crew);
}

function listCrews(filters) {
  var results = [];
  Object.keys(_crews).forEach(function (k) {
    var c = _crews[k];
    if (filters) {
      if (filters.status && c.status !== filters.status) return;
      if (filters.search && c.name.toLowerCase().indexOf(filters.search.toLowerCase()) === -1) return;
    }
    if (c.status === 'archived' && !filters) return;
    results.push(c);
  });
  results.sort(function (a, b) { return a.name.localeCompare(b.name); });
  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) results = results.slice(0, filters.limit);
  return { crews: results.map(function (c) { return Object.assign({}, c); }), total: total };
}

function searchCrews(query, filters) {
  return listCrews(Object.assign({}, filters || {}, { search: query }));
}

// ── Assignments ──

function assignCrew(id, assignment) {
  if (!id) return { error: 'Crew ID is required' };
  var crew = _crews[id];
  if (!crew) return { error: 'Crew not found: ' + id };
  if (!assignment) return { error: 'Assignment data required' };

  if (assignment.assignedWorkflowId !== undefined) crew.assignedWorkflowId = assignment.assignedWorkflowId;
  if (assignment.assignedOpportunityId !== undefined) crew.assignedOpportunityId = assignment.assignedOpportunityId;
  if (assignment.assignedCustomerId !== undefined) crew.assignedCustomerId = assignment.assignedCustomerId;
  crew.status = 'deployed';
  crew.statusDisplayName = CREW_STATUSES.deployed.displayName;
  crew.updatedAt = _now();
  _persist('crew', crew);
  return { id: crew.id, name: crew.name, status: 'deployed' };
}

function removeCrewAssignment(id) {
  if (!id) return { error: 'Crew ID is required' };
  var crew = _crews[id];
  if (!crew) return { error: 'Crew not found: ' + id };
  crew.assignedWorkflowId = null;
  crew.assignedOpportunityId = null;
  crew.assignedCustomerId = null;
  crew.status = 'idle';
  crew.statusDisplayName = CREW_STATUSES.idle.displayName;
  crew.updatedAt = _now();
  _persist('crew', crew);
  return { id: crew.id, name: crew.name, status: 'idle' };
}

function assignEmployee(employeeId, crewId) {
  if (!employeeId) return { error: 'Employee ID is required' };
  if (!crewId) return { error: 'Crew ID is required' };
  var emp = _employees[employeeId];
  if (!emp) return { error: 'Employee not found' };
  var crew = _crews[crewId];
  if (!crew) return { error: 'Crew not found' };

  // Remove from previous crew
  if (emp.crewId && emp.crewId !== crewId && _crews[emp.crewId]) {
    var prevCrew = _crews[emp.crewId];
    prevCrew.memberIds = prevCrew.memberIds.filter(function (id) { return id !== employeeId; });
    _persist('crew', prevCrew);
  }

  emp.crewId = crewId;
  emp.updatedAt = _now();
  _persist('employee', emp);

  if (crew.memberIds.indexOf(employeeId) === -1) {
    crew.memberIds.push(employeeId);
  }
  crew.updatedAt = _now();
  _persist('crew', crew);

  return { employeeId: employeeId, crewId: crewId, employeeName: emp.name, crewName: crew.name };
}

function removeEmployee(employeeId) {
  if (!employeeId) return { error: 'Employee ID is required' };
  var emp = _employees[employeeId];
  if (!emp) return { error: 'Employee not found' };

  if (emp.crewId && _crews[emp.crewId]) {
    var crew = _crews[emp.crewId];
    crew.memberIds = crew.memberIds.filter(function (id) { return id !== employeeId; });
    crew.updatedAt = _now();
    _persist('crew', crew);
  }

  emp.crewId = null;
  emp.updatedAt = _now();
  _persist('employee', emp);

  return { employeeId: employeeId, removed: true };
}

function assignAsset(crewId, assetId) {
  if (!crewId) return { error: 'Crew ID is required' };
  if (!assetId) return { error: 'Asset ID is required' };
  var crew = _crews[crewId];
  if (!crew) return { error: 'Crew not found' };

  if (crew.assetIds.indexOf(assetId) === -1) {
    crew.assetIds.push(assetId);
  }
  crew.updatedAt = _now();
  _persist('crew', crew);

  try {
    var assetEngine = require('./asset-engine');
    assetEngine.assignAsset(assetId, { assignedTo: crew.name });
  } catch (e) {}

  return { crewId: crewId, assetId: assetId, crewName: crew.name };
}

function removeAsset(crewId, assetId) {
  if (!crewId) return { error: 'Crew ID is required' };
  if (!assetId) return { error: 'Asset ID is required' };
  var crew = _crews[crewId];
  if (!crew) return { error: 'Crew not found' };

  crew.assetIds = crew.assetIds.filter(function (id) { return id !== assetId; });
  crew.updatedAt = _now();
  _persist('crew', crew);
  return { crewId: crewId, assetId: assetId, removed: true };
}

// ── Certifications ──

function recordCertification(data) {
  if (!data || !data.employeeId) return { error: 'Employee ID is required' };
  if (!data.name) return { error: 'Certification name is required' };

  var emp = _employees[data.employeeId];
  if (!emp) return { error: 'Employee not found' };

  var id = _genId();
  var now = _now();
  var cert = {
    id: id,
    employeeId: data.employeeId,
    name: data.name,
    issuingBody: data.issuingBody || null,
    issuedDate: data.issuedDate || now,
    expiryDate: data.expiryDate || null,
    status: 'active',
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  _certifications[id] = cert;
  _persist('certification', cert);

  if (!emp.certifications) emp.certifications = [];
  emp.certifications.push(cert.name);
  emp.updatedAt = now;
  _persist('employee', emp);

  return { id: cert.id, employeeId: cert.employeeId, name: cert.name, status: cert.status };
}

function renewCertification(id, newExpiry) {
  if (!id) return { error: 'Certification ID is required' };
  var cert = _certifications[id];
  if (!cert) return { error: 'Certification not found' };
  cert.status = 'active';
  cert.expiryDate = newExpiry || null;
  cert.updatedAt = _now();
  _persist('certification', cert);
  return { id: cert.id, name: cert.name, status: 'active', expiryDate: cert.expiryDate };
}

function expireCertification(id) {
  if (!id) return { error: 'Certification ID is required' };
  var cert = _certifications[id];
  if (!cert) return { error: 'Certification not found' };
  cert.status = 'expired';
  cert.updatedAt = _now();
  _persist('certification', cert);
  return { id: cert.id, name: cert.name, status: 'expired' };
}

function recordTraining(data) {
  if (!data || !data.employeeId) return { error: 'Employee ID is required' };
  return recordCertification({
    employeeId: data.employeeId,
    name: data.name || 'Training',
    issuingBody: data.provider || null,
    issuedDate: data.completedDate || _now(),
    expiryDate: data.expiryDate || null,
    notes: data.notes || null,
  });
}

// ── Time & Scheduling ──

function recordTimeEntry(data) {
  if (!data || !data.employeeId) return { error: 'Employee ID is required' };
  if (!data.hours || data.hours <= 0) return { error: 'Hours must be greater than 0' };

  var emp = _employees[data.employeeId];
  if (!emp) return { error: 'Employee not found' };

  var id = _genId();
  var now = _now();

  var entry = {
    id: id,
    employeeId: data.employeeId,
    date: data.date || _today(),
    hours: data.hours,
    type: data.type || 'regular',
    description: data.description || null,
    workflowId: data.workflowId || null,
    createdAt: now,
    updatedAt: now,
  };

  _timeEntries[id] = entry;
  _persist('timeEntry', entry);
  return { id: entry.id, employeeId: entry.employeeId, hours: entry.hours, date: entry.date };
}

function recordAvailability(data) {
  if (!data || !data.employeeId) return { error: 'Employee ID is required' };
  if (!data.date) return { error: 'Date is required' };

  var emp = _employees[data.employeeId];
  if (!emp) return { error: 'Employee not found' };

  var id = _genId();
  var now = _now();

  var av = {
    id: id,
    employeeId: data.employeeId,
    date: data.date,
    available: data.available !== false,
    startTime: data.startTime || null,
    endTime: data.endTime || null,
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  _timeEntries[id] = av;
  _persist('timeEntry', av);
  return { id: av.id, employeeId: av.employeeId, date: av.date, available: av.available };
}

function scheduleShift(data) {
  if (!data || !data.employeeId) return { error: 'Employee ID is required' };
  if (!data.date) return { error: 'Shift date is required' };

  var emp = _employees[data.employeeId];
  if (!emp) return { error: 'Employee not found' };

  var id = _genId();
  var now = _now();

  var shift = {
    id: id,
    employeeId: data.employeeId,
    date: data.date,
    startTime: data.startTime || '08:00',
    endTime: data.endTime || '17:00',
    status: 'scheduled',
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  _shifts[id] = shift;
  _persist('shift', shift);
  return { id: shift.id, employeeId: shift.employeeId, date: shift.date, startTime: shift.startTime, endTime: shift.endTime };
}

function recordAbsence(data) {
  if (!data || !data.employeeId) return { error: 'Employee ID is required' };
  if (!data.date) return { error: 'Absence date is required' };

  var emp = _employees[data.employeeId];
  if (!emp) return { error: 'Employee not found' };

  var id = _genId();
  var now = _now();

  var absence = {
    id: id,
    employeeId: data.employeeId,
    date: data.date,
    type: data.type || 'sick',
    reason: data.reason || null,
    createdAt: now,
    updatedAt: now,
  };

  _timeEntries[id] = absence;
  _persist('timeEntry', absence);
  return { id: absence.id, employeeId: absence.employeeId, date: absence.date, type: absence.type };
}

function recordPerformance(data) {
  if (!data || !data.employeeId) return { error: 'Employee ID is required' };

  var emp = _employees[data.employeeId];
  if (!emp) return { error: 'Employee not found' };

  if (!emp.performance) emp.performance = [];
  emp.performance.push({
    date: data.date || _today(),
    rating: data.rating || 3,
    notes: data.notes || null,
    reviewer: data.reviewer || null,
  });
  emp.updatedAt = _now();
  _persist('employee', emp);

  return { employeeId: data.employeeId, rating: data.rating || 3, date: data.date || _today() };
}

// ── Analytics ──

function calculateLaborCost(employeeId) {
  if (!employeeId) return { error: 'Employee ID is required' };
  var emp = _employees[employeeId];
  if (!emp) return { error: 'Employee not found' };

  var totalHours = 0;
  var totalOvertime = 0;
  Object.keys(_timeEntries).forEach(function (k) {
    var e = _timeEntries[k];
    if (e.employeeId === employeeId && e.hours) {
      if (e.type === 'overtime') totalOvertime += e.hours;
      else if (e.hours > 0) totalHours += e.hours;
    }
  });

  var regularCost = totalHours * emp.hourlyRate;
  var overtimeCost = totalOvertime * emp.overtimeRate;
  var totalCost = regularCost + overtimeCost;

  return {
    employeeId: employeeId,
    employeeName: emp.name,
    regularHours: Math.round(totalHours * 100) / 100,
    overtimeHours: Math.round(totalOvertime * 100) / 100,
    hourlyRate: emp.hourlyRate,
    overtimeRate: emp.overtimeRate,
    regularCost: Math.round(regularCost * 100) / 100,
    overtimeCost: Math.round(overtimeCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

function calculateCrewUtilization(crewId) {
  if (!crewId) return { error: 'Crew ID is required' };
  var crew = _crews[crewId];
  if (!crew) return { error: 'Crew not found' };

  var activeMembers = 0;
  var totalMembers = crew.memberIds.length;
  crew.memberIds.forEach(function (mid) {
    var emp = _employees[mid];
    if (emp && emp.status === 'active') activeMembers++;
  });

  var utilization = totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 0;

  return {
    crewId: crewId,
    crewName: crew.name,
    totalMembers: totalMembers,
    activeMembers: activeMembers,
    utilizationRate: utilization,
    utilizationDisplay: utilization + '%',
    status: crew.status,
  };
}

function calculateEmployeeProductivity(employeeId) {
  if (!employeeId) return { error: 'Employee ID is required' };
  var emp = _employees[employeeId];
  if (!emp) return { error: 'Employee not found' };

  var totalHours = 0;
  var totalEntries = 0;
  Object.keys(_timeEntries).forEach(function (k) {
    var e = _timeEntries[k];
    if (e.employeeId === employeeId && e.hours) {
      totalHours += e.hours;
      totalEntries++;
    }
  });

  var avgHoursPerDay = totalEntries > 0 ? Math.round((totalHours / totalEntries) * 100) / 100 : 0;

  return {
    employeeId: employeeId,
    employeeName: emp.name,
    role: emp.roleDisplayName,
    status: emp.status,
    totalHoursLogged: Math.round(totalHours * 100) / 100,
    totalEntries: totalEntries,
    avgHoursPerDay: avgHoursPerDay,
  };
}

function calculateCrewEfficiency(crewId) {
  if (!crewId) return { error: 'Crew ID is required' };
  var crew = _crews[crewId];
  if (!crew) return { error: 'Crew not found' };

  var totalCrewHours = 0;
  crew.memberIds.forEach(function (mid) {
    Object.keys(_timeEntries).forEach(function (k) {
      var e = _timeEntries[k];
      if (e.employeeId === mid && e.hours) totalCrewHours += e.hours;
    });
  });

  var efficiency = crew.memberIds.length > 0 ? Math.round((totalCrewHours / (crew.memberIds.length * 40)) * 100) : 0;

  return {
    crewId: crewId,
    crewName: crew.name,
    memberCount: crew.memberIds.length,
    totalHoursLogged: Math.round(totalCrewHours * 100) / 100,
    efficiency: Math.min(100, efficiency),
    efficiencyDisplay: Math.min(100, efficiency) + '%',
  };
}

function calculateAvailability(employeeId, date) {
  if (!employeeId) return { error: 'Employee ID is required' };
  var emp = _employees[employeeId];
  if (!emp) return { error: 'Employee not found' };

  var d = date || _today();

  if (emp.status === 'onLeave' || emp.status === 'inactive' || emp.status === 'archived') {
    return { employeeId: employeeId, employeeName: emp.name, date: d, available: false, reason: 'Employee status: ' + emp.statusDisplayName };
  }

  // Check for scheduled shift
  var hasShift = false;
  Object.keys(_shifts).forEach(function (k) {
    var s = _shifts[k];
    if (s.employeeId === employeeId && s.date === d) hasShift = true;
  });

  return {
    employeeId: employeeId,
    employeeName: emp.name,
    date: d,
    available: emp.status === 'active' || hasShift,
    hasShift: hasShift,
  };
}

function calculateOvertime(employeeId, periodDays) {
  periodDays = periodDays || 7;
  if (!employeeId) return { error: 'Employee ID is required' };
  var emp = _employees[employeeId];
  if (!emp) return { error: 'Employee not found' };

  var startDate = new Date(Date.now() - periodDays * 86400000).toISOString();
  var totalHours = 0;
  var overtimeHours = 0;

  Object.keys(_timeEntries).forEach(function (k) {
    var e = _timeEntries[k];
    if (e.employeeId === employeeId && e.hours && e.date >= startDate) {
      if (e.type === 'overtime') overtimeHours += e.hours;
      else totalHours += e.hours;
    }
  });

  // Standard: > 40h/week is overtime
  var standardHours = Math.max(0, 40 - overtimeHours);
  var calculatedOvertime = Math.max(0, totalHours - standardHours) + overtimeHours;

  return {
    employeeId: employeeId,
    employeeName: emp.name,
    periodDays: periodDays,
    totalHoursLogged: Math.round((totalHours + overtimeHours) * 100) / 100,
    regularHours: Math.round(totalHours * 100) / 100,
    overtimeHours: Math.round(calculatedOvertime * 100) / 100,
    overtimeCost: Math.round(calculatedOvertime * emp.overtimeRate * 100) / 100,
  };
}

function getCrewSchedule(crewId, date) {
  if (!crewId) return { error: 'Crew ID is required' };
  var crew = _crews[crewId];
  if (!crew) return { error: 'Crew not found' };
  var d = date || _today();

  var schedule = [];
  crew.memberIds.forEach(function (mid) {
    var emp = _employees[mid];
    var shifts = [];
    Object.keys(_shifts).forEach(function (k) {
      var s = _shifts[k];
      if (s.employeeId === mid && s.date === d) shifts.push(s);
    });
    if (emp) {
      schedule.push({
        employeeId: mid,
        employeeName: emp.name,
        role: emp.roleDisplayName,
        shifts: shifts,
      });
    }
  });

  return { crewId: crewId, crewName: crew.name, date: d, schedule: schedule, totalMembers: schedule.length };
}

function getUpcomingAssignments(crewId, days) {
  days = days || 7;
  if (!crewId) return { error: 'Crew ID is required' };
  var crew = _crews[crewId];
  if (!crew) return { error: 'Crew not found' };

  var assignments = [];
  if (crew.assignedOpportunityId) {
    assignments.push({
      type: 'opportunity',
      id: crew.assignedOpportunityId,
      customerId: crew.assignedCustomerId,
    });
  }
  if (crew.assignedWorkflowId) {
    assignments.push({
      type: 'workflow',
      id: crew.assignedWorkflowId,
      customerId: crew.assignedCustomerId,
    });
  }

  return { crewId: crewId, crewName: crew.name, assignments: assignments, total: assignments.length };
}

function getCrewMetrics() {
  var allEmp = listEmployees();
  var activeEmp = listEmployees({ status: 'active' });
  var onLeave = listEmployees({ status: 'onLeave' });
  var allCrews = listCrews();
  var deployed = listCrews({ status: 'deployed' });

  var totalLaborCost = 0;
  Object.keys(_employees).forEach(function (k) {
    var cost = calculateLaborCost(k);
    if (cost && cost.totalCost) totalLaborCost += cost.totalCost;
  });

  var totalOvertime = 0;
  Object.keys(_employees).forEach(function (k) {
    var ot = calculateOvertime(k, 30);
    if (ot && ot.overtimeHours) totalOvertime += ot.overtimeHours;
  });

  var certCount = 0;
  var expiredCerts = 0;
  Object.keys(_certifications).forEach(function (k) {
    certCount++;
    if (_certifications[k].status === 'expired') expiredCerts++;
  });

  return {
    totalEmployees: allEmp.total,
    activeEmployees: activeEmp.total,
    onLeaveEmployees: onLeave.total,
    totalCrews: allCrews.total,
    deployedCrews: deployed.total,
    totalCertifications: certCount,
    expiredCertifications: expiredCerts,
    totalLaborCost: Math.round(totalLaborCost * 100) / 100,
    totalOvertimeHours: Math.round(totalOvertime * 100) / 100,
    calculatedAt: _now(),
  };
}

// ── Module Exports ──

module.exports = {
  init: init,

  // Employees
  createEmployee: createEmployee,
  updateEmployee: updateEmployee,
  archiveEmployee: archiveEmployee,
  restoreEmployee: restoreEmployee,
  getEmployee: getEmployee,
  listEmployees: listEmployees,
  searchEmployees: searchEmployees,

  // Crews
  createCrew: createCrew,
  updateCrew: updateCrew,
  archiveCrew: archiveCrew,
  getCrew: getCrew,
  listCrews: listCrews,
  searchCrews: searchCrews,

  // Assignments
  assignCrew: assignCrew,
  removeCrewAssignment: removeCrewAssignment,
  assignEmployee: assignEmployee,
  removeEmployee: removeEmployee,
  assignAsset: assignAsset,
  removeAsset: removeAsset,

  // Certifications
  recordCertification: recordCertification,
  renewCertification: renewCertification,
  expireCertification: expireCertification,
  recordTraining: recordTraining,

  // Time & Scheduling
  recordTimeEntry: recordTimeEntry,
  recordAvailability: recordAvailability,
  scheduleShift: scheduleShift,
  recordAbsence: recordAbsence,
  recordPerformance: recordPerformance,

  // Analytics
  calculateLaborCost: calculateLaborCost,
  calculateCrewUtilization: calculateCrewUtilization,
  calculateEmployeeProductivity: calculateEmployeeProductivity,
  calculateCrewEfficiency: calculateCrewEfficiency,
  calculateAvailability: calculateAvailability,
  calculateOvertime: calculateOvertime,
  getCrewSchedule: getCrewSchedule,
  getUpcomingAssignments: getUpcomingAssignments,
  getCrewMetrics: getCrewMetrics,

  // Constants
  EMPLOYEE_ROLES: EMPLOYEE_ROLES,
  EMPLOYEE_STATUSES: EMPLOYEE_STATUSES,
  CREW_STATUSES: CREW_STATUSES,
};