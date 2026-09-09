'use strict';
const crypto = require('crypto');
const VERSION = 'm23-operational-intelligence-v1';
const RULE = 'm23-operational-review-rules-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const STATES = { not_started: 'Not started', in_progress: 'In progress', paused: 'Paused', completion_pending: 'Completion pending', completed: 'Completed', reopened: 'Reopened', cancelled: 'Cancelled' };

function intelligenceError(status = 503) {
  return Object.assign(new Error(status === 404 ? 'Operational intelligence is unavailable for this work.' : status === 409 ?
    'Your work details or access changed. Reload before reviewing intelligence.' : 'Operational intelligence is temporarily unavailable.'),
  { status, statusCode: status, code: 'OPERATIONAL_INTELLIGENCE_UNAVAILABLE' });
}
function requireValue(test) { if (!test) throw intelligenceError(); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
function pin(record) {
  requireValue(record && UUID.test(record.id) && Number.isSafeInteger(record.revision) && record.revision > 0 && DIGEST.test(record.digest));
  return { id: record.id, revision: record.revision, digest: record.digest };
}
function rows(value, key, total, truncated, executionId) {
  requireValue(value && Array.isArray(value[key]) && value[key].length <= 200 && Number.isSafeInteger(value[total]) &&
    value[total] >= value[key].length && typeof value[truncated] === 'boolean');
  requireValue(value[truncated] || value[total] === value[key].length);
  const seen = new Set();
  for (const item of value[key]) {
    pin(item); requireValue(!seen.has(item.id)); seen.add(item.id);
    if (item.executionId !== undefined) requireValue(item.executionId === executionId);
  }
  return { records: value[key], total: value[total], complete: !value[truncated] };
}
function leafRecords(records) {
  const superseded = new Set(records.map(record => record.previousRecordId || record.supersedesId).filter(Boolean));
  return records.filter(record => !superseded.has(record.id));
}

function buildIntelligence(sources, context, input) {
  requireValue(input && ['owner', 'admin', 'member'].includes(input.actorAccessRole));
  requireValue(Buffer.byteLength(JSON.stringify(sources)) <= 8000000);
  const completion = sources.completion;
  requireValue(completion?.success === true && completion.data?.authority === 'postgresql' && completion.data.completionInferred === false);
  const execution = completion.data.execution;
  requireValue(execution?.id === input.executionId && STATES[execution.lifecycleState] && context?.id === execution.assignmentId &&
    context.appointment_id === execution.appointmentId);
  pin(execution);
  const assignment = pin({ id: context.id, revision: Number(context.revision), digest: context.digest });
  const generatedAt = new Date(context.generated_at).toISOString();
  const unwrap = source => { requireValue(source?.status === 200 && source.body?.success === true); return source.body; };
  requireValue(sources.labor?.success === true && sources.labor.data.executionId === execution.id);
  requireValue(sources.materials?.success === true && sources.materials.data.executionId === execution.id);
  const domains = {
    completion: rows(completion.data, 'records', 'totalRecordCount', 'truncated', execution.id),
    labor: rows(sources.labor.data, 'intervals', 'totalIntervalCount', 'truncated', execution.id),
    materials: rows(sources.materials.data, 'movements', 'totalMovementCount', 'truncated', execution.id),
    progress: rows(unwrap(sources.progress), 'data', 'total', 'truncated', execution.id),
    fieldEvidence: rows(unwrap(sources.fieldEvidence), 'data', 'total', 'truncated', execution.id),
    equipment: rows(sources.equipment, 'events', 'total', 'truncated', execution.id),
  };
  const missingInputs = [], conflicts = [], recommendations = [], comparisons = [];
  const addMissing = (code, text) => missingInputs.push({ code, text });
  const addConflict = (code, text) => conflicts.push({ code, text });
  for (const [name, domain] of Object.entries(domains)) {
    if (!domain.complete) addMissing(name + '_bounded', `The visible ${name} history exceeds this summary's bound. Totals and current-leaf conclusions are withheld.`);
  }
  if (assignment.revision !== execution.sourceAssignmentRevision || assignment.digest !== execution.sourceAssignmentDigest) {
    addConflict('assignment_changed', 'The current assignment differs from the assignment pinned by this execution. A human must review the change.');
  }
  if (context.needs_review === true) addConflict('assignment_review', 'The current scheduling assignment retains needs-review inputs. Approval or dispatch does not remove that uncertainty.');
  const pending = completion.data.activeProposal;
  if (pending?.expired) addConflict('proposal_expired', 'The pending completion proposal has expired. It is not an approval.');
  const labor = domains.labor.complete ? domains.labor.records : [];
  const reviewedLabor = labor.filter(record => ['accepted', 'owner_confirmed', 'worker_acknowledged'].includes(record.reviewState));
  // Only reviewed, closed intervals contribute. Pending, rejected, and open
  // intervals are never silently added to accepted actuals.
  let reviewedSeconds = 0, reviewedClosed = 0;
  for (const record of reviewedLabor) {
    if (!record.observedEnd) continue;
    const seconds = (Date.parse(record.observedEnd) - Date.parse(record.observedStart)) / 1000;
    requireValue(Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 * 7);
    reviewedSeconds += Math.floor(seconds); reviewedClosed += 1;
  }
  if (labor.some(record => ['unreviewed', 'needs_review'].includes(record.reviewState))) addConflict('labor_review', 'Recorded labor includes intervals awaiting human review; they are excluded from reviewed actuals.');
  if (labor.some(record => !record.observedEnd && record.reviewState !== 'rejected')) addConflict('open_timer', 'A visible labor timer is still open. Elapsed time is not a completed labor fact.');
  if (!reviewedClosed) addMissing('reviewed_labor', 'No reviewed closed labor interval is available in this visible snapshot.');
  const latestProgress = domains.progress.complete ? leafRecords(domains.progress.records) : [];
  if (latestProgress.some(record => ['needs_review', 'disputed'].includes(record.document?.reviewState))) {
    addConflict('progress_review', 'Current progress or issue evidence needs review or is disputed. Reported quantities are not approved completion.');
  }
  const unresolved = latestProgress.filter(record => ['blocker', 'exception'].includes(record.document?.kind) && record.document.state !== 'resolved').length;
  if (unresolved) addConflict('unresolved_issues', `${unresolved} visible blocker or exception record${unresolved === 1 ? '' : 's'} remain unresolved.`);
  const targetBases = new Map();
  for (const record of latestProgress) {
    const document = record.document;
    if (!document?.quantity || typeof document.workKey !== 'string') continue;
    const key = String(record.performedByProfileId || '') + ':' + document.workKey;
    const basis = document.quantity.unit + ':' + document.quantity.total;
    if (targetBases.has(key) && targetBases.get(key) !== basis && !conflicts.some(item => item.code === 'quantity_basis_conflict')) {
      addConflict('quantity_basis_conflict', 'Visible records for the same reported work use different units or target quantities. Review the source basis; no combined result is calculated.');
    }
    targetBases.set(key, basis);
  }
  if (domains.materials.complete && domains.materials.records.some(record => record.reviewState === 'needs_review')) {
    addConflict('materials_review', 'Material evidence needs review. Recorded movements do not establish physical stock or cost.');
  }
  for (const name of ['materials', 'equipment', 'fieldEvidence']) if (domains[name].total === 0) {
    addMissing(name + '_missing', `No ${name === 'fieldEvidence' ? 'checklist, inspection, note or file' : name} evidence is visible. Absence is not proof that none was required or used.`);
  }
  const start = context.scheduled_start && Date.parse(context.scheduled_start), end = context.scheduled_end && Date.parse(context.scheduled_end);
  const plannedWindowSeconds = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.floor((end - start) / 1000) : null;
  comparisons.push({ code: 'schedule_and_labor', title: 'Scheduled window and recorded labor',
    plannedWindowSeconds, reviewedLaborSeconds: reviewedClosed ? reviewedSeconds : null,
    comparable: false, explanation: 'An appointment window is elapsed schedule time, not planned person-hours. Reviewed labor is person-time in the visible scope. No overrun, productivity, payroll or price is inferred.' });
  addMissing('planned_inputs', 'Planned person-hours, material quantities and equipment usage are not supplied by the scheduling authority. Cost, variance and productivity conclusions remain unavailable.');
  const quantities = latestProgress.filter(record => ['owner_confirmed', 'worker_acknowledged'].includes(record.document?.reviewState) &&
    record.document?.uncertainty === 'measured' && record.document?.quantity);
  for (const record of quantities.slice(0, 6)) {
    const q = record.document.quantity;
    requireValue(typeof q.completed === 'string' && /^\d{1,9}(\.\d{1,6})?$/.test(q.completed) &&
      typeof q.total === 'string' && /^\d{1,9}(\.\d{1,6})?$/.test(q.total) && ['ea', 'm', 'm2', 'm3', 'ft', 'ft2', 'ft3', 'yd3', 'kg', 'lb', 'l', 'gal'].includes(q.unit));
    comparisons.push({ code: 'reported_quantity', title: 'Measured progress against its reported target',
      source: pin(record), completed: q.completed, total: q.total, unit: q.unit,
      comparable: true, explanation: 'The recorded completed quantity and target share this record’s exact unit. This is a reported target, not an estimate or proof of completion. No unit conversion or cross-record aggregation is applied.' });
  }
  if (quantities.length > 6) addMissing('quantity_display_bound', 'Additional reviewed quantity comparisons are omitted from this minimized view.');
  if (!quantities.length) addMissing('reviewed_quantity', 'No complete, reviewed measured quantity/target pair is available.');
  if (conflicts.length) recommendations.push({ code: 'review_conflicts', text: 'Review the flagged source records with the responsible human before relying on this summary.' });
  if (missingInputs.length) recommendations.push({ code: 'confirm_inputs', text: 'Confirm which evidence and planned inputs are actually required. Record missing facts only through the existing authorized work forms.' });
  recommendations.push({ code: 'human_decision', text: 'Use the existing work or completion-review controls for any decision. This advice does not approve, complete, resume or change work.' });
  const evidence = Object.entries(domains).map(([domain, value]) => ({ domain, visibleTotal: value.total,
    returned: value.records.length, complete: value.complete, pins: value.records.map(pin),
    sourceSetDigest: digest(value.records.map(pin).sort((a, b) => a.id.localeCompare(b.id))) }));
  const projection = {
    version: VERSION, ruleVersion: RULE, authority: 'postgresql_sources', advisory: true, humanReviewRequired: true,
    capabilities: [], providerUsed: false, generatedAt, expiresAt: new Date(Date.parse(generatedAt) + 300000).toISOString(),
    audience: input.actorAccessRole === 'member' ? 'current_assigned_worker' : 'owner_admin',
    audienceDigest: digest([input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId]),
    execution: { ...pin(execution), lifecycleState: execution.lifecycleState }, assignment,
    summary: `${STATES[execution.lifecycleState]}. ${conflicts.length ? 'Source records need human review.' : 'No supported conflict was detected in the complete visible records.'} Missing inputs remain explicit.`,
    scope: input.actorAccessRole === 'member' ? 'Your current assignment, including your recorded time and material use. Other workers’ private details are not included.' : 'Work records available to company owners and administrators. Record counts do not verify physical conditions or professional qualifications.',
    confidence: { level: 'limited', basis: 'Based on the recorded work shown below. Missing information, unreviewed entries and incomplete history limit what can be concluded.' },
    uncertainty: 'This summary reflects the records available when it was prepared. Refresh before making a decision. It does not establish safety, legal compliance, a price or a financial result.',
    missingInputs, conflicts, comparisons, recommendations, evidence,
  };
  projection.snapshotDigest = digest(projection);
  requireValue(Buffer.byteLength(JSON.stringify(projection)) <= 500000);
  return projection;
}

module.exports = { VERSION, RULE, buildIntelligence, intelligenceError, canonical };
