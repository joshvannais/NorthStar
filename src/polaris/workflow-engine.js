/**
 * Polaris Workflow & Scheduling Intelligence Engine
 *
 * Transforms Polaris intelligence into actionable work by managing tasks,
 * follow-ups, appointments, reminders, and automated workflows across
 * the Polaris platform.
 *
 * Ownership Boundary:
 *   - Task lifecycle (create, update, complete, archive, restore)
 *   - Follow-up generation from communications and opportunities
 *   - Appointment scheduling and rescheduling
 *   - Reminder management
 *   - Task assignment and prioritization
 *   - Daily agenda, overdue, and upcoming task views
 *   - Workflow analytics (completion rates, times, utilization)
 *
 * NOT estimation, pricing, customer management, communication history,
 * opportunity management, learning, validation, or UI.
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence) — file-backed storage
 *   - customer-engine.js (customer context)
 *   - communications-engine.js (activity recording)
 *   - opportunity-engine.js (opportunity context)
 *   - engine.js (recommendations + learning)
 */

const store = require('./store');

// ── Workflow Type Constants ──
const WORKFLOW_TYPES = Object.freeze({
  task:        { id: 'task',        displayName: 'Task',         icon: 'check-square' },
  reminder:    { id: 'reminder',    displayName: 'Reminder',     icon: 'bell' },
  followUp:    { id: 'followUp',    displayName: 'Follow-up',    icon: 'message-circle' },
  appointment: { id: 'appointment', displayName: 'Appointment',  icon: 'calendar' },
  call:        { id: 'call',        displayName: 'Call',         icon: 'phone' },
  email:       { id: 'email',       displayName: 'Email',        icon: 'mail' },
  meeting:     { id: 'meeting',     displayName: 'Meeting',      icon: 'users' },
  siteVisit:   { id: 'siteVisit',   displayName: 'Site Visit',   icon: 'map-pin' },
  estimate:    { id: 'estimate',    displayName: 'Estimate',     icon: 'file-text' },
  inspection:  { id: 'inspection',  displayName: 'Inspection',   icon: 'search' },
  internal:    { id: 'internal',    displayName: 'Internal',     icon: 'briefcase' },
  custom:      { id: 'custom',      displayName: 'Custom',       icon: 'settings' },
});

const VALID_TYPES = new Set(Object.keys(WORKFLOW_TYPES));

// ── Priority Constants ──
const TASK_PRIORITIES = Object.freeze({
  critical: { id: 'critical', displayName: 'Critical', weight: 5 },
  high:     { id: 'high',     displayName: 'High',     weight: 4 },
  medium:   { id: 'medium',   displayName: 'Medium',   weight: 3 },
  low:      { id: 'low',      displayName: 'Low',      weight: 2 },
  none:     { id: 'none',     displayName: 'None',     weight: 1 },
});

const VALID_PRIORITIES = new Set(Object.keys(TASK_PRIORITIES));

// ── Task Status Constants ──
const TASK_STATUSES = Object.freeze({
  pending:    { id: 'pending',    displayName: 'Pending' },
  inProgress: { id: 'inProgress', displayName: 'In Progress' },
  completed:  { id: 'completed',  displayName: 'Completed' },
  cancelled:  { id: 'cancelled',  displayName: 'Cancelled' },
  archived:   { id: 'archived',   displayName: 'Archived' },
});

const VALID_STATUSES = new Set(Object.keys(TASK_STATUSES));

// ── In-memory store ──
const _tasks = {};
var _idCounter = 0;

function _genId() {
  _idCounter++;
  return 'wf_' + Date.now() + '_' + _idCounter;
}

function _now() {
  return new Date().toISOString();
}

// ── Persistence — Polaris Store Integration ──

function _persist(task) {
  try {
    store.addRecommendation({
      type: 'workflow',
      taskId: task.id,
      customerId: task.customerId,
      data: task,
      timestamp: task.updatedAt,
    });
  } catch (e) {
    // Non-critical: in-memory cache is primary.
  }
}

// ── Validation ──

function _validateType(type) {
  if (!VALID_TYPES.has(type)) {
    return { valid: false, error: 'Invalid workflow type: "' + type + '". Allowed: ' + Array.from(VALID_TYPES).join(', ') };
  }
  return { valid: true };
}

function _validatePriority(priority) {
  if (!VALID_PRIORITIES.has(priority)) {
    return { valid: false, error: 'Invalid priority: "' + priority + '". Allowed: ' + Array.from(VALID_PRIORITIES).join(', ') };
  }
  return { valid: true };
}

function _validateStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    return { valid: false, error: 'Invalid status: "' + status + '". Allowed: ' + Array.from(VALID_STATUSES).join(', ') };
  }
  return { valid: true };
}

// ── Helpers ──

function _todayStart() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function _todayEnd() {
  var d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/**
 * Initialize the Workflow Engine — load existing task records
 * from the Polaris store into the in-memory cache.
 *
 * Call once at server startup after opportunityEngine.init().
 *
 * @returns {object} { loaded: number }
 */
function init() {
  var loaded = 0;
  try {
    var recs = store.getAllRecommendations() || [];
    recs.forEach(function (r) {
      if (r && r.type === 'workflow' && r.data && r.data.id) {
        _tasks[r.data.id] = r.data;
        loaded++;
      }
    });
  } catch (e) {
    // Store may not be initialized yet.
  }
  return { loaded: loaded };
}

// ── Core Task CRUD ──

/**
 * Create a new task.
 *
 * @param {object} data - Task data
 * @param {string} data.title - Task title (required)
 * @param {string} [data.type='task'] - Workflow type
 * @param {string} [data.priority='medium'] - Priority level
 * @param {string} [data.customerId] - Related customer
 * @param {string} [data.opportunityId] - Related opportunity
 * @param {string} [data.description] - Description
 * @param {string} [data.owner] - Assigned owner
 * @param {string} [data.dueDate] - Due date (ISO string)
 * @param {string} [data.scheduledStart] - Scheduled start (ISO string)
 * @param {string} [data.scheduledEnd] - Scheduled end (ISO string)
 * @param {string[]} [data.tags] - Tags
 * @param {string} [data.notes] - Notes
 * @param {object} [data.metadata] - Additional metadata
 * @returns {object} Created task
 */
function createTask(data) {
  if (!data || !data.title) return { error: 'Task title is required' };

  var type = data.type || 'task';
  var typeCheck = _validateType(type);
  if (!typeCheck.valid) return { error: typeCheck.error };

  var priority = data.priority || 'medium';
  var priorityCheck = _validatePriority(priority);
  if (!priorityCheck.valid) return { error: priorityCheck.error };

  var id = _genId();
  var now = _now();

  var task = {
    id: id,
    title: data.title,
    description: data.description || null,
    type: type,
    typeDisplayName: WORKFLOW_TYPES[type].displayName,
    priority: priority,
    priorityDisplayName: TASK_PRIORITIES[priority].displayName,
    priorityWeight: TASK_PRIORITIES[priority].weight,
    status: 'pending',
    statusDisplayName: TASK_STATUSES.pending.displayName,
    owner: data.owner || null,
    customerId: data.customerId || null,
    opportunityId: data.opportunityId || null,
    dueDate: data.dueDate || null,
    scheduledStart: data.scheduledStart || null,
    scheduledEnd: data.scheduledEnd || null,
    completedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    tags: Array.isArray(data.tags) ? data.tags.slice() : [],
    notes: data.notes || null,
    metadata: data.metadata ? Object.assign({}, data.metadata) : {},
    archived: false,
  };

  _tasks[id] = task;
  _persist(task);

  // Record as a communication
  _recordActivity(task, 'created');

  return {
    id: task.id,
    title: task.title,
    type: task.type,
    typeDisplayName: task.typeDisplayName,
    priority: task.priority,
    status: task.status,
    owner: task.owner,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
  };
}

function _recordActivity(task, action) {
  try {
    var comms = require('./communications-engine');
    var subject = action.charAt(0).toUpperCase() + action.slice(1) + ': ' + task.title;
    comms.recordCommunication({
      customerId: task.customerId || 'internal',
      type: 'internal',
      direction: 'outbound',
      subject: subject,
      content: 'Task "' + task.title + '" (' + task.typeDisplayName + ') ' + action + ' with priority ' + task.priorityDisplayName,
      status: 'completed',
      author: task.owner || 'System',
      metadata: { taskId: task.id, type: task.type, status: task.status, action: action },
    });
  } catch (e) {
    // Non-critical.
  }
}

/**
 * Update a task's fields.
 *
 * @param {string} id - Task ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated task
 */
function updateTask(id, updates) {
  if (!id) return { error: 'Task ID is required' };
  var task = _tasks[id];
  if (!task) return { error: 'Task not found: ' + id };
  if (!updates) return { error: 'Updates object is required' };

  var now = _now();

  if (updates.title !== undefined) task.title = updates.title;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.notes !== undefined) task.notes = updates.notes;
  if (updates.owner !== undefined) task.owner = updates.owner;
  if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
  if (updates.scheduledStart !== undefined) task.scheduledStart = updates.scheduledStart;
  if (updates.scheduledEnd !== undefined) task.scheduledEnd = updates.scheduledEnd;
  if (updates.customerId !== undefined) task.customerId = updates.customerId;
  if (updates.opportunityId !== undefined) task.opportunityId = updates.opportunityId;

  if (updates.priority !== undefined) {
    var priorityCheck = _validatePriority(updates.priority);
    if (!priorityCheck.valid) return { error: priorityCheck.error };
    task.priority = updates.priority;
    task.priorityDisplayName = TASK_PRIORITIES[updates.priority].displayName;
    task.priorityWeight = TASK_PRIORITIES[updates.priority].weight;
  }

  if (updates.type !== undefined) {
    var typeCheck = _validateType(updates.type);
    if (!typeCheck.valid) return { error: typeCheck.error };
    task.type = updates.type;
    task.typeDisplayName = WORKFLOW_TYPES[updates.type].displayName;
  }

  if (updates.status !== undefined) {
    var statusCheck = _validateStatus(updates.status);
    if (!statusCheck.valid) return { error: statusCheck.error };
    task.status = updates.status;
    task.statusDisplayName = TASK_STATUSES[updates.status].displayName;
    if (updates.status === 'completed') task.completedAt = now;
    if (updates.status === 'cancelled') task.cancelledAt = now;
  }

  if (Array.isArray(updates.tags)) task.tags = updates.tags.slice();

  if (updates.metadata) {
    task.metadata = Object.assign(task.metadata, updates.metadata);
  }

  task.updatedAt = now;
  _persist(task);

  return {
    id: task.id,
    title: task.title,
    type: task.type,
    priority: task.priority,
    status: task.status,
    owner: task.owner,
    updatedAt: task.updatedAt,
  };
}

/**
 * Mark a task as completed.
 *
 * @param {string} id - Task ID
 * @returns {object} Updated task
 */
function completeTask(id) {
  return updateTask(id, { status: 'completed' });
}

/**
 * Archive a task.
 *
 * @param {string} id - Task ID
 * @returns {object} { id, archived: true }
 */
function archiveTask(id) {
  if (!id) return { error: 'Task ID is required' };
  var task = _tasks[id];
  if (!task) return { error: 'Task not found: ' + id };

  task.archived = true;
  task.status = 'archived';
  task.statusDisplayName = TASK_STATUSES.archived.displayName;
  task.updatedAt = _now();
  _persist(task);

  return { id: task.id, archived: true, updatedAt: task.updatedAt };
}

/**
 * Restore an archived task.
 *
 * @param {string} id - Task ID
 * @returns {object} Updated task
 */
function restoreTask(id) {
  if (!id) return { error: 'Task ID is required' };
  var task = _tasks[id];
  if (!task) return { error: 'Task not found: ' + id };
  if (!task.archived) return { error: 'Task is not archived' };

  task.archived = false;
  task.status = 'pending';
  task.statusDisplayName = TASK_STATUSES.pending.displayName;
  task.updatedAt = _now();
  _persist(task);

  return { id: task.id, archived: false, status: 'pending', updatedAt: task.updatedAt };
}

/**
 * Get a single task by ID.
 *
 * @param {string} id - Task ID
 * @returns {object} Task record
 */
function getTask(id) {
  if (!id) return { error: 'Task ID is required' };
  var task = _tasks[id];
  if (!task) return { error: 'Task not found: ' + id };
  return Object.assign({}, task);
}

/**
 * List tasks with optional filters.
 *
 * @param {object} [filters] - Optional filters
 * @param {string} [filters.type] - Filter by workflow type
 * @param {string} [filters.priority] - Filter by priority
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.owner] - Filter by owner
 * @param {string} [filters.customerId] - Filter by customer
 * @param {string} [filters.opportunityId] - Filter by opportunity
 * @param {string} [filters.search] - Search in title/description
 * @param {number} [filters.limit] - Max results
 * @param {boolean} [filters.includeArchived] - Include archived
 * @returns {object} { tasks, total }
 */
function listTasks(filters) {
  var results = [];

  Object.keys(_tasks).forEach(function (k) {
    var task = _tasks[k];

    if (filters) {
      if (filters.type && task.type !== filters.type) return;
      if (filters.priority && task.priority !== filters.priority) return;
      if (filters.status && task.status !== filters.status) return;
      if (filters.owner && task.owner !== filters.owner) return;
      if (filters.customerId && task.customerId !== filters.customerId) return;
      if (filters.opportunityId && task.opportunityId !== filters.opportunityId) return;
      if (!filters.includeArchived && task.archived) return;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        var titleMatch = task.title && task.title.toLowerCase().indexOf(q) !== -1;
        var descMatch = task.description && task.description.toLowerCase().indexOf(q) !== -1;
        if (!titleMatch && !descMatch) return;
      }
    } else {
      if (task.archived) return;
    }

    results.push(task);
  });

  results.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) {
    results = results.slice(0, filters.limit);
  }

  return {
    tasks: results.map(function (t) { return Object.assign({}, t); }),
    total: total,
  };
}

/**
 * Search tasks by keyword.
 *
 * @param {string} query - Search query
 * @param {object} [filters] - Additional filters
 * @returns {object} { tasks, total }
 */
function searchTasks(query, filters) {
  return listTasks(Object.assign({}, filters || {}, { search: query }));
}

// ── Scheduling ──

/**
 * Schedule a reminder.
 *
 * @param {object} data - Reminder data
 * @param {string} data.title - Reminder title (required)
 * @param {string} data.dueDate - When to remind (required)
 * @param {string} [data.customerId] - Related customer
 * @param {string} [data.owner] - Owner
 * @returns {object} Created task
 */
function scheduleReminder(data) {
  if (!data || !data.title) return { error: 'Reminder title is required' };
  if (!data.dueDate) return { error: 'Reminder dueDate is required' };

  return createTask({
    title: data.title,
    type: 'reminder',
    priority: data.priority || 'medium',
    customerId: data.customerId || null,
    owner: data.owner || null,
    dueDate: data.dueDate,
    description: data.description || null,
    tags: data.tags || null,
    notes: data.notes || null,
    metadata: data.metadata || null,
  });
}

/**
 * Schedule an appointment.
 *
 * @param {object} data - Appointment data
 * @param {string} data.title - Appointment title (required)
 * @param {string} data.scheduledStart - Start time (required)
 * @param {string} data.scheduledEnd - End time (required)
 * @param {string} [data.customerId] - Related customer
 * @param {string} [data.owner] - Owner
 * @returns {object} Created task
 */
function scheduleAppointment(data) {
  if (!data || !data.title) return { error: 'Appointment title is required' };
  if (!data.scheduledStart) return { error: 'Scheduled start time is required' };
  if (!data.scheduledEnd) return { error: 'Scheduled end time is required' };

  return createTask({
    title: data.title,
    type: 'appointment',
    priority: data.priority || 'medium',
    customerId: data.customerId || null,
    owner: data.owner || null,
    scheduledStart: data.scheduledStart,
    scheduledEnd: data.scheduledEnd,
    dueDate: data.scheduledEnd,
    description: data.description || null,
    tags: data.tags || null,
    notes: data.notes || null,
    metadata: data.metadata || null,
  });
}

/**
 * Reschedule an existing appointment.
 *
 * @param {string} id - Task ID
 * @param {string} newStart - New start time
 * @param {string} newEnd - New end time
 * @returns {object} Updated task
 */
function rescheduleAppointment(id, newStart, newEnd) {
  return updateTask(id, { scheduledStart: newStart, scheduledEnd: newEnd, dueDate: newEnd });
}

/**
 * Cancel an appointment.
 *
 * @param {string} id - Task ID
 * @returns {object} Updated task
 */
function cancelAppointment(id) {
  return updateTask(id, { status: 'cancelled' });
}

// ── Follow-ups ──

/**
 * Create a follow-up task, optionally linked to a customer or opportunity.
 * Automatically generates recommended follow-up timing based on context.
 *
 * @param {object} data - Follow-up data
 * @param {string} data.title - Follow-up title (required)
 * @param {string} [data.customerId] - Related customer
 * @param {string} [data.opportunityId] - Related opportunity
 * @param {string} [data.owner] - Owner
 * @param {string} [data.dueDate] - Due date (auto-calculated if not provided)
 * @returns {object} Created task
 */
function createFollowUp(data) {
  if (!data || !data.title) return { error: 'Follow-up title is required' };

  var dueDate = data.dueDate;

  if (!dueDate && data.opportunityId) {
    try {
      var opps = require('./opportunity-engine');
      var opp = opps.getOpportunity(data.opportunityId);
      if (opp && opp.expectedCloseDate) {
        var closeDate = new Date(opp.expectedCloseDate);
        // 3 days before expected close
        dueDate = new Date(closeDate.getTime() - 3 * 86400000).toISOString();
      }
    } catch (e) {
      // Fall through to default.
    }
  }

  if (!dueDate) {
    // Default: 7 days from now
    dueDate = new Date(Date.now() + 7 * 86400000).toISOString();
  }

  return createTask({
    title: data.title,
    type: 'followUp',
    priority: data.priority || 'medium',
    customerId: data.customerId || null,
    opportunityId: data.opportunityId || null,
    owner: data.owner || null,
    dueDate: dueDate,
    description: data.description || null,
    tags: data.tags || null,
    notes: data.notes || null,
    metadata: data.metadata || null,
  });
}

// ── Assignment ──

/**
 * Assign a task to an owner.
 *
 * @param {string} id - Task ID
 * @param {string} owner - Owner name
 * @returns {object} Updated task
 */
function assignTask(id, owner) {
  if (!id) return { error: 'Task ID is required' };
  if (!owner) return { error: 'Owner is required' };
  return updateTask(id, { owner: owner });
}

// ── Prioritization ──

/**
 * Prioritize tasks by recalculating priority based on due date proximity.
 * Tasks due sooner get higher priority.
 *
 * @param {object} [filters] - Optional filters
 * @returns {object} Prioritized task list
 */
function prioritizeTasks(filters) {
  var all = listTasks(Object.assign({}, filters || {}, { includeArchived: false, status: 'pending' }));

  var scored = all.tasks.map(function (task) {
    var score = 0;

    // Due date proximity
    if (task.dueDate) {
      var msUntilDue = new Date(task.dueDate).getTime() - Date.now();
      var daysUntilDue = msUntilDue / 86400000;
      if (daysUntilDue < 0) score += 100; // Overdue
      else if (daysUntilDue < 1) score += 80; // Due today
      else if (daysUntilDue < 3) score += 60; // Due this week
      else if (daysUntilDue < 7) score += 40;
      else if (daysUntilDue < 14) score += 20;
    }

    // Priority weight
    score += task.priorityWeight * 10;

    // Type weight
    if (task.type === 'appointment' || task.type === 'meeting') score += 15;

    return {
      id: task.id,
      title: task.title,
      type: task.type,
      typeDisplayName: task.typeDisplayName,
      priority: task.priority,
      priorityWeight: task.priorityWeight,
      status: task.status,
      owner: task.owner,
      dueDate: task.dueDate,
      customerId: task.customerId,
      opportunityId: task.opportunityId,
      priorityScore: score,
      factors: {
        dueProximity: Math.min(100, Math.max(0, score - task.priorityWeight * 10 - (task.type === 'appointment' || task.type === 'meeting' ? 15 : 0))),
        priorityWeight: task.priorityWeight * 10,
        typeWeight: (task.type === 'appointment' || task.type === 'meeting') ? 15 : 0,
      },
    };
  });

  scored.sort(function (a, b) { return b.priorityScore - a.priorityScore; });

  return {
    tasks: scored,
    total: scored.length,
  };
}

// ── Agenda & Views ──

/**
 * Get today's agenda — all tasks scheduled or due today.
 *
 * @returns {object} { tasks, total }
 */
function getTodayAgenda() {
  var start = _todayStart();
  var end = _todayEnd();

  var results = [];
  Object.keys(_tasks).forEach(function (k) {
    var task = _tasks[k];
    if (task.archived) return;

    var isDueToday = task.dueDate && task.dueDate >= start && task.dueDate <= end;
    var isScheduledToday = task.scheduledStart && task.scheduledStart >= start && task.scheduledStart <= end;

    if (isDueToday || isScheduledToday) {
      results.push(task);
    }
  });

  results.sort(function (a, b) {
    // Scheduled items first, then by due date
    if (a.scheduledStart && b.scheduledStart) return new Date(a.scheduledStart) - new Date(b.scheduledStart);
    if (a.scheduledStart) return -1;
    if (b.scheduledStart) return 1;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    return 0;
  });

  return {
    tasks: results.map(function (t) { return Object.assign({}, t); }),
    total: results.length,
  };
}

/**
 * Get overdue tasks — pending tasks past their due date.
 *
 * @returns {object} { tasks, total }
 */
function getOverdueTasks() {
  var now = _now();
  var results = [];

  Object.keys(_tasks).forEach(function (k) {
    var task = _tasks[k];
    if (task.archived) return;
    if (task.status === 'completed' || task.status === 'cancelled') return;
    if (!task.dueDate) return;
    if (task.dueDate < now) {
      results.push(task);
    }
  });

  results.sort(function (a, b) {
    // Most overdue first
    return new Date(a.dueDate) - new Date(b.dueDate);
  });

  return {
    tasks: results.map(function (t) { return Object.assign({}, t); }),
    total: results.length,
  };
}

/**
 * Get upcoming tasks — pending tasks due within a number of days.
 *
 * @param {number} [days=7] - Number of days ahead
 * @returns {object} { tasks, total }
 */
function getUpcomingTasks(days) {
  days = days || 7;
  var now = _now();
  var future = new Date(Date.now() + days * 86400000).toISOString();
  var results = [];

  Object.keys(_tasks).forEach(function (k) {
    var task = _tasks[k];
    if (task.archived) return;
    if (task.status === 'completed' || task.status === 'cancelled') return;
    if (!task.dueDate) return;
    if (task.dueDate >= now && task.dueDate <= future) {
      results.push(task);
    }
  });

  results.sort(function (a, b) {
    return new Date(a.dueDate) - new Date(b.dueDate);
  });

  return {
    tasks: results.map(function (t) { return Object.assign({}, t); }),
    total: results.length,
  };
}

// ── Analytics ──

/**
 * Get workflow metrics and KPIs.
 *
 * @returns {object} Workflow metrics
 */
function getWorkflowMetrics() {
  var all = listTasks({ includeArchived: false });
  var pending = listTasks({ status: 'pending', includeArchived: false });
  var inProgress = listTasks({ status: 'inProgress', includeArchived: false });
  var completed = listTasks({ status: 'completed', includeArchived: false });
  var cancelled = listTasks({ status: 'cancelled', includeArchived: false });

  var overdue = getOverdueTasks();
  var today = getTodayAgenda();

  var completionRate = all.total > 0 ? Math.round((completed.total / all.total) * 10000) / 100 : 0;

  // Average completion time (in hours) for completed tasks
  var totalCompletionTime = 0;
  var completedWithTime = 0;
  completed.tasks.forEach(function (t) {
    if (t.completedAt && t.createdAt) {
      var ms = new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime();
      totalCompletionTime += ms / 3600000; // hours
      completedWithTime++;
    }
  });
  var avgCompletionTime = completedWithTime > 0 ? Math.round((totalCompletionTime / completedWithTime) * 100) / 100 : 0;

  // Follow-up compliance
  var followUps = listTasks({ type: 'followUp', includeArchived: false });
  var completedFollowUps = listTasks({ type: 'followUp', status: 'completed', includeArchived: false });
  var followUpCompliance = followUps.total > 0 ? Math.round((completedFollowUps.total / followUps.total) * 10000) / 100 : 0;

  // By type
  var byType = {};
  Object.keys(WORKFLOW_TYPES).forEach(function (k) {
    var typeTasks = listTasks({ type: k, includeArchived: false });
    byType[k] = {
      type: k,
      displayName: WORKFLOW_TYPES[k].displayName,
      total: typeTasks.total,
      active: typeTasks.tasks.filter(function (t) { return t.status === 'pending' || t.status === 'inProgress'; }).length,
    };
  });

  // Workload by owner
  var byOwner = {};
  all.tasks.forEach(function (t) {
    var owner = t.owner || 'Unassigned';
    if (!byOwner[owner]) byOwner[owner] = { owner: owner, total: 0, pending: 0, completed: 0, overdue: 0 };
    byOwner[owner].total++;
    if (t.status === 'pending' || t.status === 'inProgress') byOwner[owner].pending++;
    if (t.status === 'completed') byOwner[owner].completed++;
    if (t.dueDate && t.dueDate < _now() && t.status !== 'completed' && t.status !== 'cancelled') byOwner[owner].overdue++;
  });

  return {
    totalTasks: all.total,
    activeTasks: pending.total + inProgress.total,
    pendingTasks: pending.total,
    inProgressTasks: inProgress.total,
    completedTasks: completed.total,
    cancelledTasks: cancelled.total,
    overdueTasks: overdue.total,
    todayTasks: today.total,
    completionRate: completionRate,
    completionRateDisplay: completionRate + '%',
    avgCompletionTimeHours: avgCompletionTime,
    followUpCompliance: followUpCompliance,
    followUpComplianceDisplay: followUpCompliance + '%',
    byType: byType,
    byOwner: byOwner,
    calculatedAt: _now(),
  };
}

/**
 * Get the chronological timeline of all task activity for a customer.
 *
 * @param {string} customerId - Customer ID
 * @returns {object} { tasks, total }
 */
function getTaskTimeline(customerId) {
  return listTasks({ customerId: customerId, includeArchived: false });
}

// ── Workflow Type Definitions ──

/**
 * Get all workflow type definitions.
 *
 * @returns {object[]}
 */
function getWorkflowTypes() {
  return Object.keys(WORKFLOW_TYPES).map(function (k) {
    return { id: WORKFLOW_TYPES[k].id, displayName: WORKFLOW_TYPES[k].displayName, icon: WORKFLOW_TYPES[k].icon };
  });
}

// ── Module Exports ──

module.exports = {
  // Lifecycle
  init: init,

  // Core CRUD
  createTask: createTask,
  updateTask: updateTask,
  completeTask: completeTask,
  archiveTask: archiveTask,
  restoreTask: restoreTask,
  getTask: getTask,
  listTasks: listTasks,
  searchTasks: searchTasks,

  // Scheduling
  createFollowUp: createFollowUp,
  scheduleReminder: scheduleReminder,
  scheduleAppointment: scheduleAppointment,
  rescheduleAppointment: rescheduleAppointment,
  cancelAppointment: cancelAppointment,

  // Assignment & Prioritization
  assignTask: assignTask,
  prioritizeTasks: prioritizeTasks,

  // Agenda & Views
  getTodayAgenda: getTodayAgenda,
  getOverdueTasks: getOverdueTasks,
  getUpcomingTasks: getUpcomingTasks,

  // Analytics
  getWorkflowMetrics: getWorkflowMetrics,

  // Timeline
  getTaskTimeline: getTaskTimeline,

  // Type definitions
  getWorkflowTypes: getWorkflowTypes,

  // Constants
  WORKFLOW_TYPES: WORKFLOW_TYPES,
  TASK_PRIORITIES: TASK_PRIORITIES,
  TASK_STATUSES: TASK_STATUSES,
};