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
    if (!domain.complete) addMissing(name + '_bounded', `The ${({completion:'completion',labor:'work time',materials:'materials',progress:'progress',fieldEvidence:'field evidence',equipment:'equipment'})[name]} history is too large to review completely here. Totals and conclusions about its latest records are unavailable.`);
  }
  if (assignment.revision !== execution.sourceAssignmentRevision || assignment.digest !== execution.sourceAssignmentDigest) {
    addConflict('assignment_changed', 'The assignment changed after this work was recorded. Review the change before relying on the work details.');
  }
  if (context.needs_review === true) addConflict('assignment_review', 'Some details of this assignment still need review, even though the work may have been approved or dispatched.');
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
  if (labor.some(record => ['unreviewed', 'needs_review'].includes(record.reviewState))) addConflict('labor_review', 'Some recorded work time still needs review and is excluded from the reviewed total.');
  if (labor.some(record => !record.observedEnd && record.reviewState !== 'rejected')) addConflict('open_timer', 'A work timer is still running. Its time is not included in the finished work total.');
  if (!reviewedClosed) addMissing('reviewed_labor', 'No finished and reviewed work time is available for this summary.');
  const latestProgress = domains.progress.complete ? leafRecords(domains.progress.records) : [];
  if (latestProgress.some(record => ['needs_review', 'disputed'].includes(record.document?.reviewState))) {
    addConflict('progress_review', 'Current progress or issue evidence needs review or is disputed. Reported quantities are not approved completion.');
  }
  const unresolved = latestProgress.filter(record => ['blocker', 'exception'].includes(record.document?.kind) && record.document.state !== 'resolved').length;
  if (unresolved) addConflict('unresolved_issues', `${unresolved} recorded blocker or exception${unresolved === 1 ? '' : 's'} remain unresolved.`);
  const targetBases = new Map();
  for (const record of latestProgress) {
    const document = record.document;
    if (!document?.quantity || typeof document.workKey !== 'string') continue;
    const key = String(record.performedByProfileId || '') + ':' + document.workKey;
    const basis = document.quantity.unit + ':' + document.quantity.total;
    if (targetBases.has(key) && targetBases.get(key) !== basis && !conflicts.some(item => item.code === 'quantity_basis_conflict')) {
      addConflict('quantity_basis_conflict', 'Records for the same work use different units or target quantities. Review those differences before comparing them. No combined result is calculated.');
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
    comparable: false, explanation: 'The scheduled window measures the length of the appointment. Reviewed work time counts each worker’s time separately. These are different measures, so this summary cannot determine whether the job ran over its planned person-hours, calculate productivity or pay, or set a price.' });
  addMissing('planned_inputs', 'The schedule does not include planned person-hours, material quantities or equipment use. Those plans are needed before comparing actual use, costs or productivity.');
  const quantities = latestProgress.filter(record => ['owner_confirmed', 'worker_acknowledged'].includes(record.document?.reviewState) &&
    record.document?.uncertainty === 'measured' && record.document?.quantity);
  for (const record of quantities.slice(0, 6)) {
    const q = record.document.quantity;
    requireValue(typeof q.completed === 'string' && /^\d{1,9}(\.\d{1,6})?$/.test(q.completed) &&
      typeof q.total === 'string' && /^\d{1,9}(\.\d{1,6})?$/.test(q.total) && ['ea', 'm', 'm2', 'm3', 'ft', 'ft2', 'ft3', 'yd3', 'kg', 'lb', 'l', 'gal'].includes(q.unit));
    comparisons.push({ code: 'reported_quantity', title: 'Measured progress against its reported target',
      source: pin(record), completed: q.completed, total: q.total, unit: q.unit,
      comparable: true, explanation: 'The completed quantity and reported target use the same unit. This comparison uses this record only; it does not combine other records or convert units. Reaching a reported target does not approve completion or establish an estimate.' });
  }
  if (quantities.length > 6) addMissing('quantity_display_bound', 'More reviewed quantity comparisons exist than this summary can show.');
  if (!quantities.length) addMissing('reviewed_quantity', 'No reviewed measurement includes both a completed quantity and a target.');
  if (conflicts.length) recommendations.push({ code: 'review_conflicts', text: 'Review the flagged work records with the person responsible before relying on this summary.' });
  if (missingInputs.length) recommendations.push({ code: 'confirm_inputs', text: 'Confirm which work records and plans are needed. Add missing information using the work forms available to your account.' });
  recommendations.push({ code: 'human_decision', text: 'Open the work details or completion review to make a decision. This advice does not approve, complete, resume or change work.' });
  const evidence = Object.entries(domains).map(([domain, value]) => ({ domain, visibleTotal: value.total,
    returned: value.records.length, complete: value.complete, pins: value.records.map(pin),
    sourceSetDigest: digest(value.records.map(pin).sort((a, b) => a.id.localeCompare(b.id))) }));
  const projection = {
    version: VERSION, ruleVersion: RULE, authority: 'postgresql_sources', advisory: true, humanReviewRequired: true,
    capabilities: [], providerUsed: false, generatedAt, expiresAt: new Date(Date.parse(generatedAt) + 300000).toISOString(),
    audience: input.actorAccessRole === 'member' ? 'current_assigned_worker' : 'owner_admin',
    audienceDigest: digest([input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId]),
    execution: { ...pin(execution), lifecycleState: execution.lifecycleState }, assignment,
    summary: `${STATES[execution.lifecycleState]}. ${conflicts.length ? 'Work records need review.' : 'No conflict was detected in the records checked. Incomplete or unreviewed records may still contain conflicts.'} Review any missing information below.`,
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
