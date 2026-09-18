'use strict';

const { v5: uuidv5 } = require('uuid');
const { sha256, stableValue } = require('../services/businessProfileAdapter');

const VERSION = 'm25-part14b-demo-learning-v1';
const ACTIONS = new Set(['grant_graph', 'grant_proposal', 'prepare', 'preview', 'save', 'adoption_preview', 'adopt', 'rollback']);
const PHASES = new Set(['first_use', 'ready', 'prepared', 'previewed', 'saved', 'adopted', 'rolled_back']);

function failure(status, code, message) {
  const error = new Error(message); error.status = status; error.code = code; throw error;
}

function initial() {
  return stableValue({ version: VERSION, graphAllowed: false, proposalAllowed: false, phase: 'first_use', sequence: 0 });
}

function validate(value) {
  const candidate = value || initial();
  const keys = Object.keys(candidate).sort();
  const allowedKeys = ['graphAllowed', 'phase', 'proposalAllowed', 'selectedSummaryIds', 'sequence', 'version'];
  if (!candidate || candidate.version !== VERSION || typeof candidate.graphAllowed !== 'boolean' ||
      typeof candidate.proposalAllowed !== 'boolean' || !PHASES.has(candidate.phase) ||
      !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 0 || candidate.sequence > 16 ||
      keys.some(key => !allowedKeys.includes(key)) ||
      (candidate.selectedSummaryIds !== undefined && (!Array.isArray(candidate.selectedSummaryIds) ||
        candidate.selectedSummaryIds.length < 5 || candidate.selectedSummaryIds.length > 8 ||
        new Set(candidate.selectedSummaryIds).size !== candidate.selectedSummaryIds.length ||
        candidate.selectedSummaryIds.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))))) {
    failure(503, 'DEMO_LEARNING_STATE_INVALID', 'The fictional learning journey is unavailable. Reset the demo and try again.');
  }
  if ((!candidate.graphAllowed || !candidate.proposalAllowed) && candidate.phase !== 'first_use') {
    failure(503, 'DEMO_LEARNING_STATE_INVALID', 'The fictional learning journey is unavailable. Reset the demo and try again.');
  }
  if (candidate.phase !== 'first_use' && candidate.phase !== 'ready' && !candidate.selectedSummaryIds) {
    failure(503, 'DEMO_LEARNING_STATE_INVALID', 'The fictional learning journey is unavailable. Reset the demo and try again.');
  }
  return stableValue(candidate);
}

function normalizeAction(value) {
  const details = value && value.details;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !ACTIONS.has(value.action) ||
      Object.keys(value).some(key => !['action', 'details'].includes(key)) ||
      !details || typeof details !== 'object' || Array.isArray(details) ||
      Object.keys(details).some(key => !['path', 'summaryIds'].includes(key)) ||
      typeof details.path !== 'string' || details.path.length < 1 || details.path.length > 256 ||
      (value.action === 'prepare' ? (!Array.isArray(details.summaryIds) || details.summaryIds.length < 5 || details.summaryIds.length > 8 ||
        new Set(details.summaryIds).size !== details.summaryIds.length || details.summaryIds.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)))
        : details.summaryIds !== undefined) || Buffer.byteLength(JSON.stringify(details)) > 32768) {
    failure(400, 'DEMO_LEARNING_ACTION_INVALID', 'Choose a supported fictional learning step.');
  }
  return stableValue({ action: value.action, details });
}

function requirePhase(journey, phases, message) {
  if (!phases.includes(journey.phase)) failure(409, 'DEMO_LEARNING_STEP_CHANGED', message);
}

function apply(state, input) {
  const journey = validate(state.learningJourney);
  const normalized = normalizeAction(input.learningAction), action = normalized.action;
  let next = { ...journey, sequence: journey.sequence + 1 };
  if (action === 'grant_graph') {
    if (journey.graphAllowed) failure(409, 'DEMO_LEARNING_STEP_CHANGED', 'Completed job comparisons are already allowed in this demo.');
    next.graphAllowed = true;
  } else if (action === 'grant_proposal') {
    if (journey.proposalAllowed) failure(409, 'DEMO_LEARNING_STEP_CHANGED', 'Planning suggestions are already allowed in this demo.');
    next.proposalAllowed = true;
  } else {
    if (!journey.graphAllowed || !journey.proposalAllowed) failure(409, 'DEMO_LEARNING_PERMISSION_REQUIRED', 'Allow both fictional record uses before continuing the demo journey.');
    if (action === 'prepare') {
      requirePhase(journey, ['first_use', 'ready'], 'Refresh and select the current fictional jobs before preparing a suggestion.');
      const available = new Set(identities(state).summaries), selected = normalized.details.summaryIds.slice().sort();
      if (selected.some(id => !available.has(id))) failure(409, 'DEMO_LEARNING_SELECTION_CHANGED', 'The fictional job selection changed. Refresh and choose the current jobs again.');
      next.phase = 'prepared'; next.selectedSummaryIds = selected;
    }
    if (action === 'preview') { requirePhase(journey, ['prepared'], 'Prepare the fictional suggestion before reviewing its planning impact.'); next.phase = 'previewed'; }
    if (action === 'save') { requirePhase(journey, ['previewed'], 'Review the fictional planning impact before saving it.'); next.phase = 'saved'; }
    if (action === 'adoption_preview') { requirePhase(journey, ['saved'], 'Save the fictional review before considering a planning value.'); next.phase = 'saved'; }
    if (action === 'adopt') { requirePhase(journey, ['saved'], 'Review the current fictional planning value before adopting it.'); next.phase = 'adopted'; }
    if (action === 'rollback') { requirePhase(journey, ['adopted'], 'Only the active fictional planning value can be removed.'); next.phase = 'rolled_back'; }
  }
  if (next.graphAllowed && next.proposalAllowed && next.phase === 'first_use') next.phase = 'ready';
  next = validate(next);
  return stableValue({ ...state, learningJourney: next });
}

function identities(state) {
  const seed = String(state.seed || sha256('northstar-demo-learning'));
  const namespace = uuidv5('northstar-demo-learning-journey', '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  const id = label => uuidv5(seed + ':' + label, namespace);
  return { proposal: id('proposal'), registry: id('registry'), planning: id('planning'), summaries: Array.from({ length: 8 }, (_, index) => id('summary-' + index)) };
}

function consent(active, key) {
  const digest = sha256({ version: VERSION, consent: key, active });
  return active ? { active: true, current: { revision: 1, digest, action: 'grant' }, history: [], total: 1, truncated: false }
    : { active: false, current: null, history: [], total: 0, truncated: false };
}

function metric(key, label, basis, median, lower, upper, sampleSize) {
  return { metricKey: key, label, kind: 'multiplier', basis, sampleSize, cohortSize: sampleSize, coveragePercent: '100.00', median, lowerQuartile: lower, upperQuartile: upper, interquartileRange: (Number(upper) - Number(lower)).toFixed(6), advisoryAvailable: true, proposedValue: median, unavailableReason: null };
}

function preview(ids, selectedSummaryIds) {
  const sampleSize = selectedSummaryIds.length;
  const proposalDigest = sha256({ version: VERSION, kind: 'proposal', selectedSummaryIds });
  return { version: 'm25-job-outcome-proposal-registry-preview-v1', serviceKey: 'tree-service', cohortSize: sampleSize, status: 'review_available', availableImpactCount: 3, unavailableImpactCount: 3,
    areas: [
      { area: 'labor', label: 'Labor', status: 'review_available', message: 'Comparable labor evidence is available.', measures: [{ metric: metric('worker_hours', 'Worker hours', 'NorthStar worker hours', '1.080000', '0.960000', '1.170000', sampleSize), impact: { status: 'relative_review', planningArea: 'labor_planning', direction: 'increase', changePercent: '8.00', statement: 'Future worker-hour planning would be reviewed at 8 percent higher.', absoluteValueStatus: 'unavailable' } }] },
      { area: 'travel', label: 'Travel', status: 'review_available', message: 'Comparable travel evidence is available.', measures: [{ metric: metric('distance', 'Travel distance', 'Connected travel|mile', '1.020000', '0.970000', '1.090000', sampleSize), impact: { status: 'relative_review', planningArea: 'travel_planning', direction: 'keep', changePercent: '2.00', statement: 'Future travel planning remains inside the five percent keep range.', absoluteValueStatus: 'unavailable' } }] },
      { area: 'equipment', label: 'Vehicles And Equipment', status: 'review_available', message: 'Comparable equipment evidence is available.', measures: [{ metric: metric('equipment_hours', 'Equipment hours', 'NorthStar equipment|machine_hour', '0.940000', '0.900000', '1.030000', sampleSize), impact: { status: 'relative_review', planningArea: 'equipment_planning', direction: 'decrease', changePercent: '-6.00', statement: 'Future equipment-hour planning would be reviewed at 6 percent lower.', absoluteValueStatus: 'unavailable' } }] },
      { area: 'materials', label: 'Materials', status: 'unavailable', message: 'Five compatible current material outcomes are not available.', measures: [] },
      { area: 'scope', label: 'Scope', status: 'unavailable', message: 'Current scope evidence does not establish one reusable planning value.', measures: [] },
      { area: 'financial', label: 'Financial Results', status: 'unavailable', message: 'Compatible financial evidence is not available.', measures: [] }
    ], uncertaintyBoundary: 'The sample and range describe only the selected completed jobs. They are not a forecast or promise.', evidenceBoundary: 'Only current same-service completed jobs are compared. Missing or incompatible evidence remains unavailable and is never treated as zero.', valueBoundary: 'Relative suggestions do not establish an absolute company value. Financial percentages remain reference-only until compatible NorthStar financial records exist.', adoptionBoundary: 'Saving this review does not change a business profile, planning value, estimate, price, schedule, job or financial record.', proposalPin: { id: ids.proposal, digest: proposalDigest }, previewDigest: sha256({ version: VERSION, kind: 'preview', proposalDigest }) };
}

function selectedSummaries(state, journey, ids) {
  const selected = journey.selectedSummaryIds ? journey.selectedSummaryIds.slice().sort() : [];
  const available = new Set(ids.summaries);
  if (selected.some(id => !available.has(id))) failure(503, 'DEMO_LEARNING_STATE_INVALID', 'The fictional learning journey is unavailable. Reset the demo and try again.');
  return selected;
}

function center(state, revision) {
  const ids = identities(state), journey = validate(state.learningJourney), grant = consent(true, 'native');
  return { version: 'm25-learning-center-v6', authority: 'isolated_demo_postgresql', evaluatedAt: state.createdAt,
    outcomeServiceKeys: ['tree-service'], outcomeServiceTotal: 1, outcomeServicesTruncated: false,
    outcomeServices: [{ serviceKey: 'tree-service', eligibleSummaryTotal: 8, selectableSummaryTotal: 8, ambiguousSummaryTotal: 0, summariesTruncated: false,
      summaries: ids.summaries.map((summaryId, index) => ({ summaryId, displayLabel: 'Demo Customer ' + (index + 1) + ' · Tree Service · Removal ' + (index + 1) })) }],
    nativeLabor: grant, nativeEquipment: grant, nativeMaterial: grant, sourceTotal: 8, sourcesTruncated: false,
    sources: [
      ['labor', 'crewclock.demo'], ['travel', 'fleet.demo'], ['asset', 'equipment.demo'], ['material', 'materials.demo'],
      ['crm_field_service', 'customers.demo'], ['project_change_order', 'projects.demo'], ['communication', 'conversations.demo'], ['financial', 'accounting.demo']
    ].map(value => ({ sourceKind: value[0], sourceKey: value[1], serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false })),
    learningBoundary: 'Fictional demo records stay in this demo. Suggestions remain advisory and change no company record.', demoWorkspaceRevision: revision, demoJourneyStage: journey.phase };
}

function project(state, revision) {
  const journey = validate(state.learningJourney), ids = identities(state), selected = selectedSummaries(state, journey, ids), sampleSize = selected.length, p = preview(ids, selected), prepared = ['prepared', 'previewed', 'saved', 'adopted', 'rolled_back'].includes(journey.phase), saved = ['saved', 'adopted', 'rolled_back'].includes(journey.phase), adopted = journey.phase === 'adopted', rolledBack = journey.phase === 'rolled_back';
  const proposalDigest = p.proposalPin.digest, registryDigest = sha256({ version: VERSION, kind: 'registry', previewDigest: p.previewDigest }), planningDigest = sha256({ version: VERSION, kind: 'planning', registryDigest });
  const proposal = prepared ? { activeConsent: true, current: { id: ids.proposal, digest: proposalDigest, fresh: true, available: true, cohortSize: sampleSize, proposal: { cohortSize: sampleSize, domains: [], uncertaintyBoundary: p.uncertaintyBoundary, evidenceBoundary: p.evidenceBoundary, adoptionBoundary: p.adoptionBoundary }, statusMessage: 'Advice from the selected comparable jobs is ready for review.' }, total: 1 } : { activeConsent: journey.proposalAllowed, current: null, history: [], total: 0 };
  const registry = saved ? { activeConsent: true, current: { id: ids.registry, digest: registryDigest, previewDigest: p.previewDigest, fresh: true, available: true, preview: p, statusMessage: 'This saved fictional review is ready for an owner decision.' }, history: [], total: 1 } : { activeConsent: journey.proposalAllowed, current: null, history: [], total: 0 };
  const planningRecord = { id: ids.planning, revision: rolledBack ? 2 : 1, digest: planningDigest, state: adopted ? 'active' : 'rolled_back', planningArea: 'labor_planning', metricKey: 'worker_hours', basis: 'NorthStar worker hours', multiplier: '1.080000', statusMessage: adopted ? 'This fictional owner planning value is current in this demo only.' : 'This fictional planning value was removed from the demo.', lineage: { status: adopted ? 'current' : 'not_set', requiresOwnerReview: false, planningValueInEffect: adopted } };
  return { version: VERSION, demoWorkspaceRevision: revision, demoJourneyStage: journey.phase,
    graphConsent: consent(journey.graphAllowed, 'graph'), proposalConsent: consent(journey.proposalAllowed, 'proposal'), serviceKey: 'tree-service',
    proposal, registry, planning: { serviceKey: 'tree-service', current: adopted ? [planningRecord] : [], history: rolledBack ? [planningRecord] : [], total: adopted || rolledBack ? 1 : 0 }, preview: journey.phase === 'previewed' ? { preview: p, proposalPin: p.proposalPin, previewDigest: p.previewDigest } : null, error: null };
}

function resultFor(state, action) {
  const journey = validate(state.learningJourney), ids = identities(state), selected = selectedSummaries(state, journey, ids), p = preview(ids, selected);
  if (action === 'preview') return { preview: p, proposalPin: p.proposalPin, previewDigest: p.previewDigest };
  if (action === 'adoption_preview') return { registryVersionId: ids.registry, planningArea: 'labor_planning', metricKey: 'worker_hours', basis: 'NorthStar worker hours', multiplier: '1.080000', selectionDigest: sha256({ version: VERSION, kind: 'selection', previewDigest: p.previewDigest }) };
  return null;
}

module.exports = { ACTIONS, VERSION, apply, center, initial, normalizeAction, project, resultFor, validate };
