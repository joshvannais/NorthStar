/**
 * Polaris Job Execution Intelligence Engine
 *
 * Manages jobs, work orders, scheduling, execution status, milestones,
 * production tracking, field documentation, quality control, inspections,
 * and completion analytics.
 *
 * Ownership Boundary:
 *   - Job lifecycle (create, schedule, start, pause, resume, complete, cancel, archive)
 *   - Work order management
 *   - Crew, asset, customer, opportunity assignment
 *   - Production tracking and progress calculation
 *   - Quality control and inspection records
 *   - Issues and resolution tracking
 *   - Field documentation (photos, documents)
 *   - Material usage tracking
 *   - Weather, delay, and safety meeting recording
 *   - Job cost and profitability analytics
 *   - Schedule variance and job health metrics
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence)
 *   - communications-engine.js (activity recording)
 *   - crew-engine.js (crew context)
 *   - asset-engine.js (asset context)
 *   - customer-engine.js (customer context)
 *   - opportunity-engine.js (opportunity context)
 *   - workflow-engine.js (task context)
 *   - financial-engine.js (cost context)
 */

const store = require('./store');

// ── Job Status Constants ──
const JOB_STATUSES = Object.freeze({
  pending:    { id: 'pending',    displayName: 'Pending' },
  scheduled:  { id: 'scheduled',  displayName: 'Scheduled' },
  inProgress: { id: 'inProgress', displayName: 'In Progress' },
  paused:     { id: 'paused',     displayName: 'Paused' },
  completed:  { id: 'completed',  displayName: 'Completed' },
  cancelled:  { id: 'cancelled',  displayName: 'Cancelled' },
  archived:   { id: 'archived',   displayName: 'Archived' },
});

const VALID_JOB_STATUSES = new Set(Object.keys(JOB_STATUSES));

// ── Job Phase Constants ──
const JOB_PHASES = Object.freeze({
  setup:       { id: 'setup',       displayName: 'Setup' },
  mobilization:{ id: 'mobilization',displayName: 'Mobilization' },
  production:  { id: 'production',  displayName: 'Production' },
  qualityCheck:{ id: 'qualityCheck',displayName: 'Quality Check' },
  cleanup:     { id: 'cleanup',     displayName: 'Cleanup' },
  closeout:    { id: 'closeout',    displayName: 'Closeout' },
});

const VALID_JOB_PHASES = new Set(Object.keys(JOB_PHASES));

// ── Priority Constants ──
const JOB_PRIORITIES = Object.freeze({
  critical: { id: 'critical', displayName: 'Critical', weight: 5 },
  high:     { id: 'high',     displayName: 'High',     weight: 4 },
  medium:   { id: 'medium',   displayName: 'Medium',   weight: 3 },
  low:      { id: 'low',      displayName: 'Low',      weight: 2 },
});

const VALID_PRIORITIES = new Set(Object.keys(JOB_PRIORITIES));

// ── Issue Severity Constants ──
const ISSUE_SEVERITIES = Object.freeze({
  low:      { id: 'low',      displayName: 'Low' },
  medium:   { id: 'medium',   displayName: 'Medium' },
  high:     { id: 'high',     displayName: 'High' },
  critical: { id: 'critical', displayName: 'Critical' },
});

const VALID_SEVERITIES = new Set(Object.keys(ISSUE_SEVERITIES));

// ── In-memory stores ──
const _jobs = {};
const _workOrders = {};
const _inspections = {};
const _issues = {};
const _documents = [];
var _idCounter = 0;

function _genId() {
  _idCounter++;
  return 'job_' + Date.now() + '_' + _idCounter;
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
      type: 'job',
      jobType: type,
      jobId: data.id,
      data: data,
      timestamp: data.updatedAt || data.createdAt || _now(),
    });
  } catch (e) {}
}

function _recordActivity(action, description, metadata) {
  try {
    var comms = require('./communications-engine');
    comms.recordCommunication({
      customerId: (metadata && metadata.customerId) || 'internal',
      type: 'internal',
      direction: 'outbound',
      subject: 'Job: ' + action,
      content: description,
      status: 'completed',
      author: 'System',
      metadata: metadata || {},
    });
  } catch (e) {}
}

// ── Validation ──

function _validateJobStatus(s) { if (!VALID_JOB_STATUSES.has(s)) return { valid: false, error: 'Invalid status: "' + s + '". Allowed: ' + Array.from(VALID_JOB_STATUSES).join(', ') }; return { valid: true }; }
function _validateJobPhase(p) { if (!VALID_JOB_PHASES.has(p)) return { valid: false, error: 'Invalid phase: "' + p + '". Allowed: ' + Array.from(VALID_JOB_PHASES).join(', ') }; return { valid: true }; }
function _validatePriority(p) { if (!VALID_PRIORITIES.has(p)) return { valid: false, error: 'Invalid priority: "' + p + '". Allowed: ' + Array.from(VALID_PRIORITIES).join(', ') }; return { valid: true }; }
function _validateSeverity(s) { if (!VALID_SEVERITIES.has(s)) return { valid: false, error: 'Invalid severity: "' + s + '". Allowed: ' + Array.from(VALID_SEVERITIES).join(', ') }; return { valid: true }; }

// ── Init ──

function init() {
  var loaded = 0;
  try {
    var recs = store.getAllRecommendations() || [];
    recs.forEach(function (r) {
      if (r && r.type === 'job' && r.data && r.data.id) {
        if (r.jobType === 'job') _jobs[r.data.id] = r.data;
        else if (r.jobType === 'workorder') _workOrders[r.data.id] = r.data;
        else if (r.jobType === 'inspection') _inspections[r.data.id] = r.data;
        loaded++;
      }
    });
  } catch (e) {}
  return { loaded: loaded };
}

// ── Job CRUD ──

function createJob(data) {
  if (!data || !data.title) return { error: 'Job title is required' };
  if (!data.customerId) return { error: 'Customer ID is required' };

  var id = _genId();
  var now = _now();

  var job = {
    id: id,
    title: data.title,
    description: data.description || null,
    customerId: data.customerId,
    opportunityId: data.opportunityId || null,
    status: 'pending',
    statusDisplayName: JOB_STATUSES.pending.displayName,
    phase: 'setup',
    phaseDisplayName: JOB_PHASES.setup.displayName,
    priority: data.priority || 'medium',
    priorityWeight: JOB_PRIORITIES[data.priority] ? JOB_PRIORITIES[data.priority].weight : 3,
    crewIds: [],
    assetIds: [],
    scheduledStart: data.scheduledStart || null,
    scheduledEnd: data.scheduledEnd || null,
    actualStart: null,
    actualEnd: null,
    durationDays: 0,
    production: {
      unitsCompleted: 0,
      totalUnits: data.totalUnits || 0,
    },
    costs: {
      estimatedCost: data.estimatedCost || 0,
      actualCost: 0,
      laborCost: 0,
      materialCost: 0,
      equipmentCost: 0,
    },
    issues: [],
    location: data.location || null,
    notes: data.notes || null,
    tags: Array.isArray(data.tags) ? data.tags.slice() : [],
    createdAt: now,
    updatedAt: now,
  };

  _jobs[id] = job;
  _persist('job', job);
  _recordActivity('Job Created: ' + data.title, 'Job "' + data.title + '" created for customer ' + data.customerId, { jobId: id, customerId: data.customerId });

  return { id: job.id, title: job.title, customerId: job.customerId, status: job.status, createdAt: job.createdAt };
}

function updateJob(id, updates) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (!updates) return { error: 'Updates required' };

  var now = _now();

  if (updates.title !== undefined) job.title = updates.title;
  if (updates.description !== undefined) job.description = updates.description;
  if (updates.notes !== undefined) job.notes = updates.notes;
  if (updates.location !== undefined) job.location = updates.location;
  if (updates.scheduledStart !== undefined) job.scheduledStart = updates.scheduledStart;
  if (updates.scheduledEnd !== undefined) job.scheduledEnd = updates.scheduledEnd;
  if (updates.tags !== undefined) job.tags = updates.tags.slice();
  if (updates.estimatedCost !== undefined) job.costs.estimatedCost = updates.estimatedCost;
  if (updates.totalUnits !== undefined) job.production.totalUnits = updates.totalUnits;

  if (updates.priority !== undefined) {
    var pc = _validatePriority(updates.priority);
    if (!pc.valid) return { error: pc.error };
    job.priority = updates.priority;
    job.priorityWeight = JOB_PRIORITIES[updates.priority].weight;
  }

  job.updatedAt = now;
  _persist('job', job);
  return { id: job.id, title: job.title, status: job.status, updatedAt: job.updatedAt };
}

function archiveJob(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  job.status = 'archived';
  job.statusDisplayName = JOB_STATUSES.archived.displayName;
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, archived: true };
}

function restoreJob(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (job.status !== 'archived') return { error: 'Job is not archived' };
  job.status = 'pending';
  job.statusDisplayName = JOB_STATUSES.pending.displayName;
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, status: 'pending' };
}

function getJob(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  return Object.assign({}, job);
}

function listJobs(filters) {
  var results = [];
  Object.keys(_jobs).forEach(function (k) {
    var j = _jobs[k];
    if (filters) {
      if (filters.status && j.status !== filters.status) return;
      if (filters.customerId && j.customerId !== filters.customerId) return;
      if (filters.opportunityId && j.opportunityId !== filters.opportunityId) return;
      if (filters.priority && j.priority !== filters.priority) return;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (j.title.toLowerCase().indexOf(q) === -1 && (j.description || '').toLowerCase().indexOf(q) === -1) return;
      }
    }
    if (j.status === 'archived' && !filters) return;
    results.push(j);
  });
  results.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) results = results.slice(0, filters.limit);
  return { jobs: results.map(function (j) { return Object.assign({}, j); }), total: total };
}

function searchJobs(query, filters) {
  return listJobs(Object.assign({}, filters || {}, { search: query }));
}

// ── Scheduling & Execution ──

function scheduleJob(id, scheduledStart, scheduledEnd) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  if (scheduledStart) job.scheduledStart = scheduledStart;
  if (scheduledEnd) job.scheduledEnd = scheduledEnd;

  if (job.scheduledStart && job.scheduledEnd) {
    job.durationDays = Math.round((new Date(job.scheduledEnd).getTime() - new Date(job.scheduledStart).getTime()) / 86400000);
    if (job.durationDays < 1) job.durationDays = 1;
  }

  job.status = 'scheduled';
  job.statusDisplayName = JOB_STATUSES.scheduled.displayName;
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, title: job.title, status: 'scheduled', scheduledStart: job.scheduledStart, scheduledEnd: job.scheduledEnd, durationDays: job.durationDays };
}

function startJob(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  job.status = 'inProgress';
  job.statusDisplayName = JOB_STATUSES.inProgress.displayName;
  job.actualStart = job.actualStart || _now();
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, title: job.title, status: 'inProgress', actualStart: job.actualStart };
}

function pauseJob(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  job.status = 'paused';
  job.statusDisplayName = JOB_STATUSES.paused.displayName;
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, title: job.title, status: 'paused' };
}

function resumeJob(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  job.status = 'inProgress';
  job.statusDisplayName = JOB_STATUSES.inProgress.displayName;
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, title: job.title, status: 'inProgress' };
}

function completeJob(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  job.status = 'completed';
  job.statusDisplayName = JOB_STATUSES.completed.displayName;
  job.actualEnd = _now();
  job.phase = 'closeout';
  job.phaseDisplayName = JOB_PHASES.closeout.displayName;

  if (data) {
    if (data.notes) job.notes = (job.notes ? job.notes + '\n' : '') + data.notes;
    if (data.actualCost) job.costs.actualCost = data.actualCost;
  }

  job.updatedAt = _now();
  _persist('job', job);
  _recordActivity('Job Completed: ' + job.title, 'Job "' + job.title + '" completed', { jobId: id, customerId: job.customerId });
  return { id: job.id, title: job.title, status: 'completed', actualEnd: job.actualEnd };
}

function cancelJob(id, reason) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  job.status = 'cancelled';
  job.statusDisplayName = JOB_STATUSES.cancelled.displayName;
  job.notes = (job.notes ? job.notes + '\n' : '') + 'Cancelled: ' + (reason || 'No reason given');
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, title: job.title, status: 'cancelled' };
}

// ── Work Orders ──

function createWorkOrder(data) {
  if (!data || !data.jobId) return { error: 'Job ID is required' };
  if (!data.title) return { error: 'Work order title is required' };
  var job = _jobs[data.jobId];
  if (!job) return { error: 'Job not found: ' + data.jobId };

  var id = _genId();
  var now = _now();

  var wo = {
    id: id,
    jobId: data.jobId,
    title: data.title,
    description: data.description || null,
    assignedTo: data.assignedTo || null,
    status: 'pending',
    priority: data.priority || 'medium',
    dueDate: data.dueDate || null,
    createdAt: now,
    updatedAt: now,
  };

  _workOrders[id] = wo;
  _persist('workorder', wo);
  return { id: wo.id, jobId: wo.jobId, title: wo.title, status: wo.status };
}

function updateWorkOrder(id, updates) {
  if (!id) return { error: 'Work order ID is required' };
  var wo = _workOrders[id];
  if (!wo) return { error: 'Work order not found: ' + id };
  if (updates.title !== undefined) wo.title = updates.title;
  if (updates.description !== undefined) wo.description = updates.description;
  if (updates.assignedTo !== undefined) wo.assignedTo = updates.assignedTo;
  if (updates.status !== undefined) wo.status = updates.status;
  if (updates.dueDate !== undefined) wo.dueDate = updates.dueDate;
  wo.updatedAt = _now();
  _persist('workorder', wo);
  return { id: wo.id, title: wo.title, status: wo.status, updatedAt: wo.updatedAt };
}

// ── Assignments ──

function assignCrew(id, crewId) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (job.crewIds.indexOf(crewId) === -1) job.crewIds.push(crewId);
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, crewIds: job.crewIds };
}

function assignAssets(id, assetIds) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (Array.isArray(assetIds)) {
    assetIds.forEach(function (aid) {
      if (job.assetIds.indexOf(aid) === -1) job.assetIds.push(aid);
    });
  }
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, assetIds: job.assetIds };
}

function assignCustomer(id, customerId) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  job.customerId = customerId;
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, customerId: job.customerId };
}

function assignOpportunity(id, opportunityId) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  job.opportunityId = opportunityId;
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, opportunityId: job.opportunityId };
}

// ── Production & Field Recording ──

function recordProduction(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (!data || !data.units) return { error: 'Units completed is required' };

  job.production.unitsCompleted += data.units;
  if (data.phase && _validateJobPhase(data.phase).valid) {
    job.phase = data.phase;
    job.phaseDisplayName = JOB_PHASES[data.phase].displayName;
  }
  job.updatedAt = _now();
  _persist('job', job);
  return { id: job.id, unitsCompleted: job.production.unitsCompleted, totalUnits: job.production.totalUnits, phase: job.phase };
}

function recordInspection(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var inspId = _genId();
  var now = _now();
  var insp = {
    id: inspId,
    jobId: id,
    inspector: data.inspector || null,
    type: data.type || 'quality',
    result: data.result || 'pass',
    notes: data.notes || null,
    createdAt: now,
  };

  _inspections[inspId] = insp;
  _persist('inspection', insp);
  return { id: insp.id, jobId: insp.jobId, result: insp.result, inspector: insp.inspector };
}

function recordQualityCheck(id, data) {
  return recordInspection(id, Object.assign({}, data || {}, { type: 'quality' }));
}

function recordIssue(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (!data || !data.description) return { error: 'Issue description is required' };

  var sev = data.severity || 'medium';
  var sevCheck = _validateSeverity(sev);
  if (!sevCheck.valid) return { error: sevCheck.error };

  var issId = _genId();
  var now = _now();
  var issue = {
    id: issId,
    jobId: id,
    description: data.description,
    severity: sev,
    severityDisplayName: ISSUE_SEVERITIES[sev].displayName,
    status: 'open',
    assignedTo: data.assignedTo || null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  if (!job.issues) job.issues = [];
  job.issues.push(issue);
  job.updatedAt = now;
  _persist('job', job);
  return { id: issue.id, description: issue.description, severity: issue.severity, status: 'open' };
}

function resolveIssue(id, issueId) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var found = false;
  if (job.issues) {
    job.issues.forEach(function (iss) {
      if (iss.id === issueId) {
        iss.status = 'resolved';
        iss.resolvedAt = _now();
        iss.updatedAt = _now();
        found = true;
      }
    });
  }
  if (!found) return { error: 'Issue not found: ' + issueId };
  job.updatedAt = _now();
  _persist('job', job);
  return { id: issueId, status: 'resolved' };
}

function recordPhoto(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var docId = _genId();
  var doc = {
    id: docId,
    jobId: id,
    type: 'photo',
    caption: (data && data.caption) || null,
    url: (data && data.url) || null,
    takenBy: (data && data.takenBy) || null,
    createdAt: _now(),
  };

  if (!job.documents) job.documents = [];
  job.documents.push(doc);
  job.updatedAt = _now();
  _persist('job', job);
  return { id: docId, type: 'photo' };
}

function recordDocument(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var docId = _genId();
  var doc = {
    id: docId,
    jobId: id,
    type: 'document',
    name: (data && data.name) || 'Document',
    url: (data && data.url) || null,
    uploadedBy: (data && data.uploadedBy) || null,
    createdAt: _now(),
  };

  if (!job.documents) job.documents = [];
  job.documents.push(doc);
  job.updatedAt = _now();
  _persist('job', job);
  return { id: docId, type: 'document' };
}

function recordMaterialUsage(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (!data || !data.material) return { error: 'Material name is required' };

  if (!job.materials) job.materials = [];
  job.materials.push({
    material: data.material,
    quantity: data.quantity || 1,
    unitCost: data.unitCost || 0,
    totalCost: data.quantity ? Math.round((data.quantity * (data.unitCost || 0)) * 100) / 100 : 0,
    usedAt: _now(),
  });

  var matCost = job.materials.reduce(function (s, m) { return s + (m.totalCost || 0); }, 0);
  job.costs.materialCost = Math.round(matCost * 100) / 100;
  job.costs.actualCost = Math.round((job.costs.laborCost + job.costs.materialCost + job.costs.equipmentCost) * 100) / 100;
  job.updatedAt = _now();
  _persist('job', job);
  return { material: data.material, quantity: data.quantity, totalCost: 0 };
}

function recordWeather(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  if (!job.weatherLog) job.weatherLog = [];
  job.weatherLog.push({
    date: _today(),
    condition: (data && data.condition) || 'Unknown',
    temperature: (data && data.temperature) || null,
    windSpeed: (data && data.windSpeed) || null,
    recordedAt: _now(),
  });
  job.updatedAt = _now();
  _persist('job', job);
  return { condition: (data && data.condition) || 'Unknown', date: _today() };
}

function recordDelay(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (!data || !data.reason) return { error: 'Delay reason is required' };

  if (!job.delays) job.delays = [];
  job.delays.push({
    reason: data.reason,
    durationHours: data.durationHours || 0,
    date: _today(),
    notes: data.notes || null,
    recordedAt: _now(),
  });
  job.updatedAt = _now();
  _persist('job', job);
  return { reason: data.reason, durationHours: data.durationHours || 0 };
}

function recordSafetyMeeting(id, data) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (!data || !data.topic) return { error: 'Safety meeting topic is required' };

  if (!job.safetyMeetings) job.safetyMeetings = [];
  job.safetyMeetings.push({
    topic: data.topic,
    date: _today(),
    conductedBy: data.conductedBy || null,
    attendees: data.attendees || 0,
    notes: data.notes || null,
    recordedAt: _now(),
  });
  job.updatedAt = _now();
  _persist('job', job);
  return { topic: data.topic, date: _today() };
}

// ── Analytics ──

function calculateProgress(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var completionPercent = 0;
  if (job.status === 'completed') completionPercent = 100;
  else if (job.status === 'cancelled') completionPercent = 0;
  else if (job.production.totalUnits > 0) {
    completionPercent = Math.min(100, Math.round((job.production.unitsCompleted / job.production.totalUnits) * 100));
  } else if (job.status === 'inProgress') completionPercent = 50;
  else if (job.status === 'scheduled') completionPercent = 10;

  return {
    id: id,
    title: job.title,
    status: job.status,
    phase: job.phase,
    phaseDisplayName: job.phaseDisplayName,
    unitsCompleted: job.production.unitsCompleted,
    totalUnits: job.production.totalUnits,
    completionPercent: completionPercent,
    completionDisplay: completionPercent + '%',
  };
}

function calculateProductionRate(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var daysWorked = 0;
  if (job.actualStart) {
    var end = job.actualEnd ? new Date(job.actualEnd) : new Date();
    daysWorked = Math.round((end.getTime() - new Date(job.actualStart).getTime()) / 86400000);
    if (daysWorked < 1) daysWorked = 1;
  } else {
    daysWorked = 1;
  }

  var rate = daysWorked > 0 ? Math.round((job.production.unitsCompleted / daysWorked) * 100) / 100 : 0;
  return { id: id, title: job.title, unitsCompleted: job.production.unitsCompleted, daysWorked: daysWorked, productionRate: rate, rateDisplay: rate + ' units/day' };
}

function calculateJobCost(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var totalCost = job.costs.laborCost + job.costs.materialCost + job.costs.equipmentCost;
  return {
    id: id,
    title: job.title,
    estimatedCost: job.costs.estimatedCost,
    actualCost: job.costs.actualCost,
    laborCost: job.costs.laborCost,
    materialCost: job.costs.materialCost,
    equipmentCost: job.costs.equipmentCost,
    totalCost: totalCost,
    costVariance: Math.round((job.costs.estimatedCost - totalCost) * 100) / 100,
  };
}

function calculateProfitability(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };

  var totalCost = job.costs.laborCost + job.costs.materialCost + job.costs.equipmentCost;
  var revenue = job.costs.estimatedCost; // proxy: estimate as revenue
  var profit = revenue - totalCost;
  var margin = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0;

  return {
    id: id,
    title: job.title,
    revenue: revenue,
    totalCost: totalCost,
    profit: Math.round(profit * 100) / 100,
    profitMargin: margin,
    profitMarginDisplay: margin + '%',
    status: job.status,
  };
}

function calculateScheduleVariance(id) {
  if (!id) return { error: 'Job ID is required' };
  var job = _jobs[id];
  if (!job) return { error: 'Job not found: ' + id };
  if (!job.scheduledEnd) return { id: id, title: job.title, variance: 0, varianceDisplay: 'No schedule set', status: job.status };

  var variance = 0;
  if (job.actualEnd) {
    variance = Math.round((new Date(job.actualEnd).getTime() - new Date(job.scheduledEnd).getTime()) / 86400000);
  } else if (job.status === 'inProgress') {
    variance = Math.round((Date.now() - new Date(job.scheduledEnd).getTime()) / 86400000);
  }

  var label = 'On Schedule';
  if (variance > 0) label = variance + ' day(s) Behind';
  else if (variance < 0) label = Math.abs(variance) + ' day(s) Ahead';

  return { id: id, title: job.title, variance: variance, varianceDisplay: label, scheduledEnd: job.scheduledEnd, actualEnd: job.actualEnd };
}

function getUpcomingJobs(days) {
  days = days || 7;
  var future = new Date(Date.now() + days * 86400000).toISOString();
  var results = [];

  Object.keys(_jobs).forEach(function (k) {
    var j = _jobs[k];
    if (j.status === 'archived' || j.status === 'completed' || j.status === 'cancelled') return;
    if (j.scheduledStart && j.scheduledStart <= future) {
      results.push(j);
    }
  });

  results.sort(function (a, b) { return (a.scheduledStart || '').localeCompare(b.scheduledStart || ''); });
  return { jobs: results.map(function (j) { return Object.assign({}, j); }), total: results.length };
}

function getJobMetrics() {
  var all = listJobs();
  var pending = listJobs({ status: 'pending' });
  var scheduled = listJobs({ status: 'scheduled' });
  var inProgress = listJobs({ status: 'inProgress' });
  var completed = listJobs({ status: 'completed' });
  var cancelled = listJobs({ status: 'cancelled' });

  var totalIssues = 0;
  var openIssues = 0;
  all.jobs.forEach(function (j) {
    if (j.issues) {
      totalIssues += j.issues.length;
      j.issues.forEach(function (iss) { if (iss.status === 'open') openIssues++; });
    }
  });

  var totalCost = 0;
  var totalEstimatedCost = 0;
  all.jobs.forEach(function (j) {
    totalCost += j.costs.laborCost + j.costs.materialCost + j.costs.equipmentCost;
    totalEstimatedCost += j.costs.estimatedCost;
  });

  return {
    totalJobs: all.total,
    pendingJobs: pending.total,
    scheduledJobs: scheduled.total,
    inProgressJobs: inProgress.total,
    completedJobs: completed.total,
    cancelledJobs: cancelled.total,
    totalIssues: totalIssues,
    openIssues: openIssues,
    totalCost: Math.round(totalCost * 100) / 100,
    totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
    calculatedAt: _now(),
  };
}

// ── Module Exports ──

module.exports = {
  init: init,

  // Job lifecycle
  createJob: createJob,
  updateJob: updateJob,
  archiveJob: archiveJob,
  restoreJob: restoreJob,
  getJob: getJob,
  listJobs: listJobs,
  searchJobs: searchJobs,

  // Work orders
  createWorkOrder: createWorkOrder,
  updateWorkOrder: updateWorkOrder,

  // Assignments
  assignCrew: assignCrew,
  assignAssets: assignAssets,
  assignCustomer: assignCustomer,
  assignOpportunity: assignOpportunity,

  // Scheduling & Execution
  scheduleJob: scheduleJob,
  startJob: startJob,
  pauseJob: pauseJob,
  resumeJob: resumeJob,
  completeJob: completeJob,
  cancelJob: cancelJob,

  // Production & Field
  recordProduction: recordProduction,
  recordInspection: recordInspection,
  recordQualityCheck: recordQualityCheck,
  recordIssue: recordIssue,
  resolveIssue: resolveIssue,
  recordPhoto: recordPhoto,
  recordDocument: recordDocument,
  recordMaterialUsage: recordMaterialUsage,
  recordWeather: recordWeather,
  recordDelay: recordDelay,
  recordSafetyMeeting: recordSafetyMeeting,

  // Analytics
  calculateProgress: calculateProgress,
  calculateProductionRate: calculateProductionRate,
  calculateJobCost: calculateJobCost,
  calculateProfitability: calculateProfitability,
  calculateScheduleVariance: calculateScheduleVariance,
  getUpcomingJobs: getUpcomingJobs,
  getJobMetrics: getJobMetrics,

  // Constants
  JOB_STATUSES: JOB_STATUSES,
  JOB_PHASES: JOB_PHASES,
  ISSUE_SEVERITIES: ISSUE_SEVERITIES,
};