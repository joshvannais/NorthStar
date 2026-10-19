'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const demoPart12 = require('./demoReportingPart12Acceptance');
const contract = require('./fictionalDemoJourneyAcceptance');
const { buildDemoWorkspace, demoCanonicalItems } = require('../commandCenter/workspace');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASELINE_KEYS = Object.freeze(['createdAt','equipmentBasis','equipmentReadinessBasis',
  'generation','graphs','operationsSchedulingBasis','schedulingWorkforce','schemaVersion','seed',
  'taxPreparationBasis','travelExamples','workspace']);

function unavailable() {
  return Object.assign(new Error('That fictional financial journey is unavailable.'), {
    code: 'DEMO_FINANCIAL_JOURNEY_UNAVAILABLE', status: 404,
  });
}

function changed(cause) {
  const error = Object.assign(new Error(
    'The fictional financial journey changed. Reload its current evidence.'), {
    code: 'DEMO_FINANCIAL_JOURNEY_CHANGED', status: 409,
  });
  if (cause) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

function recordContext(record, estimateId) {
  if (!record || typeof record !== 'object' || !UUID.test(record.tenantId) ||
      !UUID.test(record.sessionId) || !UUID.test(estimateId) ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 ||
      !Number.isSafeInteger(record.simulationCount) || record.simulationCount < 0 ||
      !record.state || typeof record.state !== 'object' || Array.isArray(record.state) ||
      !Number.isSafeInteger(record.state.generation) || record.state.generation < 1 ||
      !/^[0-9a-f]{64}$/.test(record.state.seed || '')) throw unavailable();
  const keys = Object.keys(record.state);
  const currentMutationKeyCount = keys.filter(key => !BASELINE_KEYS.includes(key)).length;
  const canonicalBaseline = currentMutationKeyCount === 0 && record.simulationCount === 0 &&
    Array.isArray(record.state.graphs) && record.state.graphs.length === 3;
  return {
    tenantId: record.tenantId, sessionId: record.sessionId, estimateId,
    workspaceRevision: record.revision, workspaceGeneration: record.state.generation,
    workspaceSeedDigest: record.state.seed,
    workspaceStateDigest: providerBoundary.digest(record.state), canonicalBaseline,
    currentMutationKeyCount, simulationCount: record.simulationCount,
  };
}

async function read(record, estimateId, options = {}) {
  const readBundle = options.readBundle || demoPart12.bundle;
  try {
    const context = recordContext(record, estimateId);
    const workspace = buildDemoWorkspace({ tenantId: record.tenantId,
      sessionId: record.sessionId, state: record.state, revision: record.revision,
      simulationCount: record.simulationCount, persisted: Boolean(record.persisted),
      expiresAt: record.expiresAt });
    const item = demoCanonicalItems(workspace)
      .find(candidate => candidate.ids.estimate === estimateId);
    if (!item) throw unavailable();
    const sourceSnapshot = providerBoundary.digest({ context, item });
    const before = await readBundle(item, record.revision);
    let after = before;
    if (options.readBundle) {
      after = await readBundle(item, record.revision);
    } else {
      const afterContext = recordContext(record, estimateId);
      const afterWorkspace = buildDemoWorkspace({ tenantId: record.tenantId,
        sessionId: record.sessionId, state: record.state, revision: record.revision,
        simulationCount: record.simulationCount, persisted: Boolean(record.persisted),
        expiresAt: record.expiresAt });
      const afterItem = demoCanonicalItems(afterWorkspace)
        .find(candidate => candidate.ids.estimate === estimateId);
      if (!afterItem || sourceSnapshot !== providerBoundary.digest({
        context: afterContext, item: afterItem,
      })) throw changed();
    }
    if (providerBoundary.digest(before) !== providerBoundary.digest(after)) throw changed();
    const projected = contract.bundle(before, context);
    contract.project(projected, after, context);
    return projected;
  } catch (error) {
    if (error?.code === 'DEMO_FINANCIAL_JOURNEY_UNAVAILABLE' ||
        error?.code === 'DEMO_FINANCIAL_JOURNEY_CHANGED') throw error;
    throw changed(error);
  }
}

async function serializeResponse(data) {
  return JSON.stringify({ success: true, data });
}

module.exports = { BASELINE_KEYS, recordContext, read, serializeResponse };
