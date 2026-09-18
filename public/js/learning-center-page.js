(function (global) {
  'use strict';

  var contract = global.NorthStarLearningCenterContract;
  var session = global.NorthStarAccountSession;
  var demo = global.location.pathname.indexOf('/demo/') === 0;
  if (global.history && 'scrollRestoration' in global.history) global.history.scrollRestoration = 'manual';
  var state = { center: null, sourceKind: null, sourceKey: null, partnerSourceKey: null, detail: null, consents: {}, matches: null, calibration: null, health: null, healthReference: null, operations: null, loadGeneration: 0, selectionGeneration: 0, calibrationGeneration: 0, healthGeneration: 0 };
  var el = function (id) { return document.getElementById(id); };

  function node(tag, className, text) {
    var value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function clear(target) { while (target.firstChild) target.removeChild(target.firstChild); }
  function status(message, tone) { el('learningStatus').textContent = message; el('learningStatus').dataset.tone = tone || ''; }
  function integer(value) { return Number.isSafeInteger(value) ? value : 0; }
  function currentPair(consent) {
    return consent && consent.current ? { revision: consent.current.revision, digest: consent.current.digest } : { revision: 0, digest: 'none' };
  }
  function idempotency() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'learning-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }
  function api(path, options) {
    return session.json('/api/v1/learning' + path, options || { method: 'GET', cache: 'no-store' }).then(function (body) { return body.data; });
  }
  function mutate(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency() }, body: JSON.stringify(body) });
  }
  function consentBody(consent, action, version, reason) {
    var pair = currentPair(consent);
    return { action: action, expectedRevision: pair.revision, expectedDigest: pair.digest, reason: reason,
      confirmed: true, confirmationVersion: version };
  }
  function setPill(target, active, review) {
    target.textContent = review ? 'Needs review' : (active ? 'Active' : 'Inactive');
    target.dataset.state = review ? 'review' : (active ? 'active' : 'inactive');
  }
  function button(label, handler, primary) {
    var value = node('button', 'btn ' + (primary ? 'btn-primary' : 'btn-secondary'), label);
    value.type = 'button'; value.addEventListener('click', handler); return value;
  }
  function selectedSource() {
    return state.center && state.center.sources.filter(function (item) {
      return item.sourceKind === state.sourceKind && item.sourceKey === state.sourceKey;
    })[0];
  }
  function sourceBase(kind, key) {
    var roots = { crm_field_service: 'crm-field-service', project_change_order: 'project-change-order', communication: 'communication', financial: 'financial' };
    return '/external-' + (roots[kind] || kind) + '-sources/' + encodeURIComponent(key);
  }
  function isBusinessKind(kind) { return ['crm_field_service', 'project_change_order', 'communication', 'financial'].indexOf(kind || state.sourceKind) >= 0; }
  function operationBase(kind, key) { return isBusinessKind(kind) ? '/external-business-sources/' + encodeURIComponent(kind) + '/' + encodeURIComponent(key) : sourceBase(kind, key); }
  function sourceTitle(kind) { return ({ crm_field_service: 'CRM and field service', project_change_order: 'Projects and change orders', communication: 'Customer communications', financial: 'External financial records' })[kind] || contract.label(kind, 'Operating'); }
  function importConsentVersion(kind) { return ({ crm_field_service: 'm25-external-crm-field-service-import-consent-v1', project_change_order: 'm25-external-project-change-order-import-consent-v1', communication: 'm25-external-communication-import-consent-v1', financial: 'm25-external-financial-import-consent-v1' })[kind]; }
  function businessPartnerCandidates(kind) {
    var partner = kind === 'communication' ? 'crm_field_service' : 'communication';
    return state.center.sources.filter(function (source) { return source.sourceKind === partner; });
  }
  function businessPartner(kind) {
    var candidates = businessPartnerCandidates(kind);
    if (candidates.length === 1) return candidates[0];
    return candidates.filter(function (source) { return source.sourceKey === state.partnerSourceKey; })[0] || null;
  }
  function businessOutcomeKind() { return state.sourceKind === 'project_change_order' ? 'project' : (state.sourceKind === 'financial' ? 'financial' : 'customer'); }
  function businessOutcomeBase() {
    if (state.sourceKind === 'project_change_order') return '/external-project-outcome-sources/' + encodeURIComponent(state.sourceKey);
    if (state.sourceKind === 'financial') return '/external-financial-outcome-sources/' + encodeURIComponent(state.sourceKey);
    var partner = businessPartner(state.sourceKind); if (!partner) return null;
    var crm = state.sourceKind === 'crm_field_service' ? state.sourceKey : partner.sourceKey;
    var communication = state.sourceKind === 'communication' ? state.sourceKey : partner.sourceKey;
    return '/external-customer-outcome-sources/' + encodeURIComponent(crm) + '/' + encodeURIComponent(communication);
  }
  function businessCalibrationBase(serviceKey, proposal) {
    var kind = businessOutcomeKind(), partner = businessPartner(state.sourceKind);
    var sourceKey = state.sourceKind === 'communication' && partner ? partner.sourceKey : state.sourceKey;
    var query = kind === 'customer' && partner ? '?secondarySourceKey=' + encodeURIComponent(state.sourceKind === 'communication' ? state.sourceKey : partner.sourceKey) : '';
    return '/external-business-calibration/' + kind + '/' + encodeURIComponent(sourceKey) + (serviceKey ? '/services/' + encodeURIComponent(serviceKey) + (proposal ? '/proposals' : '') : '/consent') + query;
  }
  function isTravel() { return state.sourceKind === 'travel'; }
  function isAsset() { return state.sourceKind === 'asset'; }
  function isMaterial() { return state.sourceKind === 'material'; }

  function demoModel(kind) {
    var digest = 'a'.repeat(64), now = new Date().toISOString();
    var consent = { active: true, current: { revision: 1, digest: digest, action: 'grant' }, history: [], total: 1, truncated: false };
    var travel = kind === 'travel', asset = kind === 'asset', material = kind === 'material';
    var model = {
      center: { version: 'm25-learning-center-v5', authority: 'isolated_demo_postgresql', evaluatedAt: now,
        nativeLabor: consent, nativeEquipment: consent, nativeMaterial: consent, sourceTotal: 8, sourcesTruncated: false,
        sources: [
          { sourceKind: 'labor', sourceKey: 'crewclock.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'travel', sourceKey: 'fleet.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'asset', sourceKey: 'equipment.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'material', sourceKey: 'materials.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'crm_field_service', sourceKey: 'customers.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'project_change_order', sourceKey: 'projects.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'communication', sourceKey: 'conversations.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false },
          { sourceKind: 'financial', sourceKey: 'accounting.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false }
        ],
        learningBoundary: 'Demo records are isolated and illustrative. Learning remains advisory and changes no operating record.' },
      source: { sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo'), activeConsent: true, runs: [{ sequence: 4 }], runTotal: 4, runsTruncated: false,
        currentRecords: [{ externalRecordId: asset ? 'chipper-042' : (travel ? 'route-042' : 'tree-crew-042'), sourceUpdatedAt: now }], recordTotal: asset ? 41 : (travel ? 34 : 28), recordsTruncated: false, latestSourceUpdatedAt: now },
      sourceConsent: Object.assign({ sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo') }, consent), outcomeConsent: Object.assign({ sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo') }, consent),
      healthConsent: Object.assign({ sourceKey: 'equipment.demo' }, consent), calibrationConsent: Object.assign({ sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo') }, consent),
      operations: { sourceKey: asset ? 'equipment.demo' : (travel ? 'fleet.demo' : 'crewclock.demo'), adapter: { revision: 2, digest: digest, action: 'resume', adapterKind: 'provider_api', cadence: 'daily' },
        retention: { revision: 1, digest: digest, action: 'set', retentionDays: 365 }, deletion: null,
        checkpoints: [{ mode: 'historical_backfill', sequence: 3, cursorAfter: null, complete: true }, { mode: 'continuous_update', sequence: 4, cursorAfter: 'demo-004', complete: false }],
        activeRecordTotal: asset ? 41 : (travel ? 34 : 28), retentionEligibleTotal: 2, deletionComplete: false,
        boundary: 'Demo cleanup is read-only. Paid cleanup removes source details in bounded batches and makes dependent suggestions unavailable.' },
      matches: asset ? { sourceKey: 'equipment.demo', activeConsent: true, referenceTotal: 3,
        references: [
          { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 8, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'vehicle', externalReference: 'chip-truck-2', sourceRecordCount: 5, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '44444444-4444-4444-8444-444444444444', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'equipment', externalReference: 'tracked-chipper-1', sourceRecordCount: 11, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '55555555-5555-4555-8555-555555555555', targetDigest: digest, action: 'link', status: 'matched' } }
        ],
        vehicleTargets: [{ targetId: '44444444-4444-4444-8444-444444444444', displayLabel: 'Chip Truck 2 · Ford F-550', name: 'Chip truck 2', manufacturer: 'Ford', model: 'F-550', digest: digest }],
        equipmentTargets: [{ targetId: '55555555-5555-4555-8555-555555555555', displayLabel: 'Tracked Chipper 1 · Bandit 21XP', name: 'Tracked chipper 1', manufacturer: 'Bandit', model: '21XP', digest: digest }],
        jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', opportunityId: '33333333-3333-4333-8333-333333333333', displayLabel: 'Tree Service Job', digest: digest }] } : travel ? { sourceKey: 'fleet.demo', activeConsent: true, referenceTotal: 2,
        references: [
          { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 6, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'vehicle', externalReference: 'chip-truck-2', sourceRecordCount: 6, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '44444444-4444-4444-8444-444444444444', targetDigest: digest, action: 'link', status: 'matched' } }
        ],
        vehicleTargets: [{ targetId: '44444444-4444-4444-8444-444444444444', displayLabel: 'Chip Truck 2 · Ford F-550', name: 'Chip truck 2', manufacturer: 'Ford', model: 'F-550', digest: digest }],
        jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', opportunityId: '33333333-3333-4333-8333-333333333333', displayLabel: 'Tree Service Job', digest: digest }] } :
      { sourceKey: 'crewclock.demo', activeConsent: true, referenceTotal: 3, references: [
          { referenceKind: 'worker', externalReference: 'crew-lead-7', sourceRecordCount: 12, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '11111111-1111-4111-8111-111111111111', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 9, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } },
          { referenceKind: 'worker', externalReference: 'climber-12', sourceRecordCount: 7, sourceDigest: digest, match: null }
        ],
        workerTargets: [{ targetId: '11111111-1111-4111-8111-111111111111', displayLabel: 'Jordan Lee · Crew Lead', operationalRole: 'Crew lead', digest: digest }],
        jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', opportunityId: '33333333-3333-4333-8333-333333333333', displayLabel: 'Tree Service Job', digest: digest }] },
      health: { sourceKey: 'equipment.demo', activeConsent: true, history: [], total: 1, truncated: false,
        current: { fresh: true, advisoryAvailable: true, outcomes: {
          maintenance: { status: 'recorded', recordCount: 3, completedCount: 2, deferredCount: 1, cancelledCount: 0 },
          downtime: { status: 'recorded', recordCount: 2, durationHours: '6.500000', scheduledCount: 1, unscheduledCount: 1 },
          condition: { status: 'unavailable', unavailableReason: 'No current condition observation was recorded. Maintenance and downtime do not establish condition.' },
          availability: { status: 'unavailable', unavailableReason: 'No complete availability observation window was recorded. Downtime alone does not establish availability.' }
        } } },
      calibration: asset ? { sourceKey: 'equipment.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false,
        refreshRequired: false, current: { fresh: true, advisoryAvailable: true, sampleSize: 7, staleExcludedCount: 1,
          metrics: {
            utilization: { status: 'compared', label: 'Machine-hour use', unit: 'machine_hour', medianActualToPlannedRatio: '1.1200', lowerQuartileRatio: '0.9800', upperQuartileRatio: '1.2600', proposedMultiplier: '1.1200', advisoryMessage: 'Reviewed machine-hour use averaged about 12% above plan.', unavailableReason: null },
            operatingCost: { status: 'compared', label: 'Job operating cost', unit: 'USD', medianActualToPlannedRatio: '1.0700', lowerQuartileRatio: '0.9500', upperQuartileRatio: '1.1800', proposedMultiplier: '1.0700', advisoryMessage: 'Reviewed same-currency job operating cost averaged about 7% above plan.', unavailableReason: null }
          } } } : travel ? { sourceKey: 'fleet.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false,
        refreshRequired: false, current: { fresh: true, advisoryAvailable: true, sampleSize: 8, staleExcludedCount: 1,
          metrics: {
            routeDuration: { status: 'compared', label: 'Route duration', unit: 'vehicle_minute', medianActualToPlannedRatio: '1.0800', lowerQuartileRatio: '0.9600', upperQuartileRatio: '1.1700', proposedMultiplier: '1.0800', advisoryMessage: 'Reviewed routes averaged about 8% longer than planned.', unavailableReason: null },
            distance: { status: 'compared', label: 'Driving distance', unit: 'mi', medianActualToPlannedRatio: '1.0300', lowerQuartileRatio: '0.9800', upperQuartileRatio: '1.0900', proposedMultiplier: '1.0300', advisoryMessage: 'Reviewed driving distance averaged about 3% above plan.', unavailableReason: null },
            fuelQuantity: { status: 'unavailable', label: 'Fuel or energy quantity', unit: null, medianActualToPlannedRatio: null, proposedMultiplier: null, advisoryMessage: null, unavailableReason: 'At least five current outcomes with this comparable dimension are required.' },
            fuelCost: { status: 'compared', label: 'Fuel cost', unit: 'USD', medianActualToPlannedRatio: '1.0600', lowerQuartileRatio: '0.9700', upperQuartileRatio: '1.1400', proposedMultiplier: '1.0600', advisoryMessage: 'Reviewed fuel cost averaged about 6% above plan.', unavailableReason: null }
          } } } :
      { sourceKey: 'crewclock.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false,
        refreshRequired: false, current: { fresh: true, advisoryAvailable: true, sampleSize: 8, staleExcludedCount: 1,
          medianActualToPlannedRatio: '1.0800', lowerQuartileRatio: '0.9600', upperQuartileRatio: '1.1700',
          proposedPlannedHoursMultiplier: '1.0800', advisoryMessage: 'Recent reviewed tree-service jobs averaged about 8% more labor time than their adopted plans.' } }
    };
    if (material) {
      model.source = { sourceKey: 'materials.demo', activeConsent: true, runs: [{ sequence: 4 }], runTotal: 4, runsTruncated: false,
        currentRecords: [{ externalRecordId: 'material-use-042', sourceUpdatedAt: now }], recordTotal: 36, recordsTruncated: false, latestSourceUpdatedAt: now };
      model.sourceConsent = Object.assign({ sourceKey: 'materials.demo' }, consent);
      model.outcomeConsent = Object.assign({ sourceKey: 'materials.demo' }, consent);
      model.costConsent = Object.assign({ sourceKey: 'materials.demo' }, consent);
      model.calibrationConsent = Object.assign({ sourceKey: 'materials.demo' }, consent);
      model.operations = { sourceKey: 'materials.demo', adapter: { revision: 2, digest: digest, action: 'resume', adapterKind: 'provider_api', cadence: 'daily' }, retention: { revision: 1, digest: digest, action: 'set', retentionDays: 365 }, deletion: null, hold: null, cleanupAllowed: true,
        checkpoints: [{ mode: 'historical_backfill', sequence: 3, cursorAfter: null, complete: true }, { mode: 'continuous_update', sequence: 4, cursorAfter: 'demo-004', complete: false }], activeRecordTotal: 36, retentionEligibleTotal: 2, deletionComplete: false,
        boundary: 'Demo cleanup is read-only. Paid cleanup removes source details in bounded batches and makes dependent suggestions unavailable.' };
      model.matches = { sourceKey: 'materials.demo', activeConsent: true, referenceTotal: 4, references: [
        { referenceKind: 'job', externalReference: 'tree-job-042', sourceRecordCount: 9, sourceDigest: digest, match: null },
        { referenceKind: 'material', externalReference: 'chain-oil', sourceRecordCount: 7, sourceDigest: digest, match: null },
        { referenceKind: 'vendor', externalReference: 'local-supply', sourceRecordCount: 5, sourceDigest: digest, match: null },
        { referenceKind: 'inventory_location', externalReference: 'main-shop', sourceRecordCount: 12, sourceDigest: digest, match: null }
      ], jobTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', displayLabel: 'Taylor Sample · Tree Service', digest: digest }],
        materialTargets: [{ targetId: 'chain-oil', displayLabel: 'Chainsaw Bar And Chain Oil', digest: digest }], vendorTargets: [{ targetId: 'local-supply', displayLabel: 'Local Arborist Supply', digest: digest }], inventoryLocationTargets: [{ targetId: 'main-shop', displayLabel: 'Main Shop', digest: digest }] };
      model.calibration = { sourceKey: 'materials.demo', serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false, refreshRequired: false,
        current: { fresh: true, advisoryAvailable: true, sampleSize: 6, staleExcludedCount: 1, metrics: {
          totalUse: { status: 'compared', label: 'Total material use', basis: 'same recorded units', proposedMultiplier: '1.0800', medianActualToPlannedRatio: '1.0800', advisoryMessage: 'Reviewed jobs used about 8% more material than planned.' },
          waste: { status: 'unavailable', label: 'Material waste', proposedMultiplier: null, unavailableReason: 'Five current jobs with comparable planned and recorded waste are required.' },
          unitCost: { status: 'compared', label: 'Material unit cost', basis: 'USD and same recorded units', proposedMultiplier: '1.0400', medianActualToPlannedRatio: '1.0400', advisoryMessage: 'Reviewed unit costs were about 4% above plan.' },
          purchaseQuantity: { status: 'compared', label: 'Purchased quantity', basis: 'same recorded units', proposedMultiplier: '1.0500', medianActualToPlannedRatio: '1.0500', advisoryMessage: 'Reviewed purchases were about 5% above planned quantity.' },
          purchaseCost: { status: 'compared', label: 'Material purchase cost', basis: 'USD', proposedMultiplier: '1.0600', medianActualToPlannedRatio: '1.0600', advisoryMessage: 'Reviewed purchase costs were about 6% above plan.' }
        } } };
    }
    if (isBusinessKind(kind)) {
      var businessKeys = { crm_field_service: 'customers.demo', project_change_order: 'projects.demo', communication: 'conversations.demo', financial: 'accounting.demo' };
      var businessKey = businessKeys[kind], referenceKind = kind === 'project_change_order' ? 'project' : (kind === 'financial' ? 'accounting_entry' : 'customer');
      model.source = { sourceKey: businessKey, activeConsent: true, runs: [{ sequence: 4 }], runTotal: 4, runsTruncated: false, currentRecords: [{ externalRecordId: 'private-source-record', sourceUpdatedAt: now }], recordTotal: 32, recordsTruncated: false, latestSourceUpdatedAt: now };
      model.sourceConsent = Object.assign({ sourceKey: businessKey }, consent); model.outcomeConsent = Object.assign({ sourceKey: businessKey }, consent); model.calibrationConsent = Object.assign({ sourceKey: businessKey }, consent);
      model.operations = { sourceKey: businessKey, adapter: { revision: 2, digest: digest, action: 'resume', adapterKind: 'provider_api', cadence: 'daily' }, retention: { revision: 1, digest: digest, action: 'set', retentionDays: 365 }, deletion: null, hold: null, checkpoints: [{ mode: 'historical_backfill', sequence: 3, cursorAfter: null, complete: true }, { mode: 'continuous_update', sequence: 4, cursorAfter: 'demo-004', complete: false }], activeRecordTotal: 32, retentionEligibleTotal: 2, deletionComplete: false, boundary: 'Demo cleanup is read-only. Paid cleanup removes source details in bounded batches and makes dependent suggestions unavailable.' };
      model.matches = { sourceKey: businessKey, activeConsent: true, referenceTotal: 2, references: [{ referenceKind: referenceKind, externalReference: 'private-reference', sourceRecordCount: 6, sourceDigest: digest, match: null }, { referenceKind: 'job', externalReference: 'tree-job', sourceRecordCount: 8, sourceDigest: digest, match: { revision: 1, digest: digest, targetId: '22222222-2222-4222-8222-222222222222', targetDigest: digest, action: 'link', status: 'matched' } }], customerTargets: [{ targetId: '11111111-1111-4111-8111-111111111111', displayLabel: 'Taylor Sample · Tree Service', digest: digest }], estimateTargets: [{ targetId: '22222222-2222-4222-8222-222222222222', displayLabel: 'Taylor Sample · Tree Service Estimate', digest: digest }], executionTargets: [{ targetId: '33333333-3333-4333-8333-333333333333', displayLabel: 'Taylor Sample · Tree Service Visit', digest: digest }] };
      var dimensions = kind === 'project_change_order' ? { contractChange: { status: 'compared', label: 'Contract change', median: '250.000000', lowerQuartile: '100.000000', upperQuartile: '400.000000', unit: 'currency amount' }, changeOrderValue: { status: 'compared', label: 'Change-order value', median: '325.000000', lowerQuartile: '150.000000', upperQuartile: '500.000000', unit: 'currency amount' }, deliveryDuration: { status: 'compared', label: 'Project duration', median: '172800.000000', lowerQuartile: '86400.000000', upperQuartile: '259200.000000', unit: 'seconds' }, deliveryState: { status: 'compared', label: 'Project delivery state', mode: 'completed', sampleSize: 6 } } : (kind === 'financial' ? { revenue: { status: 'compared', label: 'Recorded revenue', median: '2850.000000', lowerQuartile: '2400.000000', upperQuartile: '3200.000000', unit: 'currency amount' }, collection: { status: 'compared', label: 'Recorded collections', median: '2700.000000', lowerQuartile: '2300.000000', upperQuartile: '3100.000000', unit: 'currency amount' }, realizedCost: { status: 'compared', label: 'Recorded realized cost', median: '1825.000000', lowerQuartile: '1600.000000', upperQuartile: '2050.000000', unit: 'currency amount' }, margin: { status: 'compared', label: 'Recorded margin', median: '35.960000', lowerQuartile: '31.000000', upperQuartile: '39.000000', unit: 'percent' } } : { lead: { status: 'compared', label: 'Lead outcome', mode: 'qualified', sampleSize: 7 }, appointment: { status: 'compared', label: 'Appointment outcome', mode: 'completed', sampleSize: 7 }, issuedEstimate: { status: 'compared', label: 'Issued estimate outcome', mode: 'accepted', sampleSize: 6 }, customerResponse: { status: 'unavailable', label: 'Customer response', unavailableReason: 'Five current reviewed customer responses are required.' } });
      model.calibration = { sourceKey: kind === 'communication' ? 'customers.demo' : businessKey, serviceKey: 'tree-service', activeConsent: true, history: [], total: 1, truncated: false, refreshRequired: false, current: { fresh: true, advisoryAvailable: true, sampleSize: 7, staleExcludedCount: 1, metrics: dimensions } };
    }
    return model;
  }

  function renderSummary() {
    var references = state.matches ? state.matches.references : [];
    var review = references.filter(function (item) { return !item.match || item.match.status !== 'matched'; }).length;
    el('learningSummary').hidden = false;
    el('learningSourceCount').textContent = integer(state.center.sourceTotal).toLocaleString();
    el('learningRecordCount').textContent = state.detail ? integer(state.detail.recordTotal).toLocaleString() : '—';
    el('learningReviewCount').textContent = state.matches ? review.toLocaleString() : '—';
    el('learningCalibrationCount').textContent = state.calibration && state.calibration.current && state.calibration.current.fresh ? '1' : '0';
  }
  function renderNative() {
    var consent = state.center.nativeLabor, active = consent.active === true;
    setPill(el('nativeLearningState'), active, false);
    var control = el('nativeLearningAction');
    control.disabled = demo; control.textContent = demo ? 'Demo preview' : (active ? 'Pause comparisons' : 'Allow comparisons');
    control.onclick = demo ? null : function () {
      control.disabled = true; status('Saving completed-job comparison permission.');
      mutate('/labor-duration-consent', consentBody(consent, active ? 'revoke' : 'grant', 'm25-labor-duration-consent-v1',
        active ? 'Owner paused completed-job labor comparisons from the Learning Center.' : 'Owner enabled completed-job labor comparisons from the Learning Center.'))
        .then(load).catch(fail);
    };
    var equipmentConsent = state.center.nativeEquipment, equipmentActive = equipmentConsent.active === true;
    setPill(el('nativeEquipmentLearningState'), equipmentActive, false);
    var equipmentControl = el('nativeEquipmentLearningAction');
    equipmentControl.disabled = demo; equipmentControl.textContent = demo ? 'Demo preview' : (equipmentActive ? 'Pause comparisons' : 'Allow comparisons');
    equipmentControl.onclick = demo ? null : function () {
      equipmentControl.disabled = true; status('Saving vehicle and equipment comparison permission.');
      mutate('/native-equipment-utilization-consent', consentBody(equipmentConsent, equipmentActive ? 'revoke' : 'grant', 'm25-native-equipment-utilization-consent-v1',
        equipmentActive ? 'Owner paused completed-job vehicle and equipment comparisons from the Learning Center.' : 'Owner enabled completed-job vehicle and equipment comparisons from the Learning Center.'))
        .then(load).catch(fail);
    };
    var materialConsent = state.center.nativeMaterial, materialActive = materialConsent && materialConsent.active === true;
    setPill(el('nativeMaterialLearningState'), materialActive, false);
    var materialControl = el('nativeMaterialLearningAction');
    materialControl.disabled = demo; materialControl.textContent = demo ? 'Demo preview' : (materialActive ? 'Pause comparisons' : 'Allow comparisons');
    materialControl.onclick = demo ? null : function () {
      materialControl.disabled = true; status('Saving material comparison permission.');
      mutate('/native-material-outcome-consent', consentBody(materialConsent, materialActive ? 'revoke' : 'grant', 'm25-native-material-outcome-consent-v1',
        materialActive ? 'Owner paused completed-job material comparisons from the Learning Center.' : 'Owner enabled completed-job material comparisons from the Learning Center.'))
        .then(load).catch(fail);
    };
  }
  function renderSources() {
    var root = el('learningSources'); clear(root);
    el('sourcesDescription').textContent = state.center.sources.length ?
      'Select an operating or business-system source to review its permission, evidence, links and planning suggestions.' :
      'No external source has been recorded yet. Add the first company source to begin a reviewed connection.';
    state.center.sources.forEach(function (source) {
      var card = node('button', 'learning-source-card'); card.type = 'button';
      card.setAttribute('aria-pressed', String(source.sourceKind === state.sourceKind && source.sourceKey === state.sourceKey));
      card.setAttribute('aria-label', contract.label(source.sourceKey, 'Company source') + ', ' + sourceTitle(source.sourceKind) + ' source');
      var kind = node('span', 'learning-source-kind', isBusinessKind(source.sourceKind) ? sourceTitle(source.sourceKind) : (source.sourceKind === 'material' ? 'Materials · inventory · purchasing' : (source.sourceKind === 'asset' ? 'Vehicles · equipment' : (source.sourceKind === 'travel' ? 'Travel · mileage · fuel' : 'Labor · time'))));
      card.appendChild(kind);
      card.appendChild(node('strong', '', contract.label(source.sourceKey, 'Company source')));
      card.appendChild(node('span', '', source.serviceTotal + ' service ' + (source.serviceTotal === 1 ? 'group' : 'groups') + ' recorded'));
      card.addEventListener('click', function () { selectSource(source.sourceKind, source.sourceKey); }); root.appendChild(card);
    });
  }
  function consentCard(title, description, consent, endpoint, version, blockedText) {
    var card = node('article', 'learning-consent-card'); card.appendChild(node('h3', '', title));
    card.appendChild(node('p', '', description)); var pill = node('span', 'learning-pill'); setPill(pill, consent.active, false); card.appendChild(pill);
    var action = button(demo ? 'Demo preview' : (blockedText || (consent.active ? 'Pause' : 'Allow')), function () {
      action.disabled = true; status('Saving ' + title.toLowerCase() + ' permission.');
      mutate(endpoint, consentBody(consent, consent.active ? 'revoke' : 'grant', version,
        'Owner ' + (consent.active ? 'paused' : 'enabled') + ' ' + title.toLowerCase() + ' from the Learning Center.'))
        .then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(fail);
    }, false); action.disabled = demo || Boolean(blockedText);
    if (blockedText) card.appendChild(node('small', '', blockedText === 'Cancel deletion first' ? 'Cancel the active deletion request before allowing this source again.' : (blockedText === 'Choose paired source first' ? 'Choose the company source that belongs with this customer history.' : 'Record the paired CRM or customer communication source before allowing these comparisons.')));
    card.appendChild(node('div', 'learning-actions')).appendChild(action); return card;
  }
  function renderConsentCards() {
    var root = el('learningConsentCards'); clear(root);
    var base = sourceBase(state.sourceKind, state.sourceKey);
    var deletionBlocksGrant = state.operations && state.operations.deletion && state.operations.deletion.action === 'request' && !state.consents.source.active;
    root.appendChild(consentCard('Source import', 'Controls whether records from this named source may be imported.', state.consents.source,
      base + '/consent', isBusinessKind() ? importConsentVersion(state.sourceKind) : (isMaterial() ? 'm25-external-material-import-consent-v1' : (isAsset() ? 'm25-external-asset-import-consent-v1' : (isTravel() ? 'm25-external-travel-import-consent-v1' : 'm25-external-labor-import-consent-v1'))), deletionBlocksGrant ? 'Cancel deletion first' : null));
    if (isBusinessKind()) {
      var customerKind = state.sourceKind === 'crm_field_service' || state.sourceKind === 'communication';
      var partnerCandidates = customerKind ? businessPartnerCandidates(state.sourceKind) : [];
      var partner = customerKind ? businessPartner(state.sourceKind) : null;
      if (customerKind && partnerCandidates.length > 1) {
        var pairCard = node('article', 'learning-consent-card'); pairCard.appendChild(node('h3', '', 'Paired customer source'));
        pairCard.appendChild(node('p', '', 'Choose the exact CRM and customer communication sources that describe the same customer history.'));
        var pairLabel = node('label', '', state.sourceKind === 'communication' ? 'CRM source' : 'Customer communication source');
        var pairSelect = node('select'); pairSelect.setAttribute('aria-label', pairLabel.textContent); pairSelect.appendChild(node('option', '', 'Choose a company source')); pairSelect.firstChild.value = '';
        partnerCandidates.forEach(function (candidate) { var option = node('option', '', contract.label(candidate.sourceKey, 'Company source')); option.value = candidate.sourceKey; option.selected = candidate.sourceKey === state.partnerSourceKey; pairSelect.appendChild(option); });
        pairSelect.addEventListener('change', function () { state.partnerSourceKey = pairSelect.value || null; selectSource(state.sourceKind, state.sourceKey, true); });
        pairLabel.appendChild(pairSelect); pairCard.appendChild(pairLabel); root.appendChild(pairCard);
      }
      var partnerMissing = customerKind && !partner;
      var partnerBlockedText = partnerCandidates.length > 1 ? 'Choose paired source first' : 'Add paired source first';
      var outcomeTitle = state.sourceKind === 'project_change_order' ? 'Project outcome comparisons' : (state.sourceKind === 'financial' ? 'Financial outcome comparisons' : 'Customer outcome comparisons');
      root.appendChild(consentCard(outcomeTitle, state.sourceKind === 'project_change_order' ? 'Controls private comparisons of contract changes, change orders and project delivery.' : (state.sourceKind === 'financial' ? 'Controls private comparisons of recorded revenue, collections, realized cost and margin.' : 'Controls private comparisons of lead, appointment, issued-estimate and customer-response outcomes.'), state.consents.outcome, businessOutcomeBase() + '/consent', state.sourceKind === 'project_change_order' ? 'm25-external-project-outcome-consent-v1' : (state.sourceKind === 'financial' ? 'm25-external-financial-outcome-consent-v1' : 'm25-external-customer-outcome-consent-v1'), partnerMissing ? partnerBlockedText : null));
      root.appendChild(consentCard('Planning suggestions', 'Controls service-level summaries built only from current reviewed outcome comparisons.', state.consents.calibration, businessCalibrationBase(), 'm25-external-business-calibration-consent-v1', partnerMissing ? partnerBlockedText : null));
      return;
    }
    if (isMaterial()) {
      root.appendChild(consentCard('Quantity and waste comparisons', 'Controls exact-job comparisons between recorded material use, waste and the adopted material plan.', state.consents.outcome,
        base + '/imported-material-quantity-consent', 'm25-imported-material-quantity-consent-v1'));
      root.appendChild(consentCard('Cost and purchasing comparisons', 'Controls exact-job comparisons for compatible unit costs, purchase quantities and purchase costs.', state.consents.cost,
        base + '/imported-material-cost-consent', 'm25-imported-material-cost-consent-v1'));
      root.appendChild(consentCard('Planning suggestions', 'Controls private service-level summaries from current reviewed material comparisons.', state.consents.calibration,
        base + '/imported-material-calibration-consent', 'm25-imported-material-calibration-consent-v1'));
      return;
    }
    root.appendChild(consentCard('Outcome comparisons', isAsset() ? 'Controls comparisons between matched machine hours, job costs and adopted equipment plans.' : (isTravel() ? 'Controls comparisons between matched route evidence and adopted travel plans.' : 'Controls comparisons between matched imported jobs and adopted labor plans.'), state.consents.outcome,
      base + (isAsset() ? '/imported-utilization-cost-consent' : (isTravel() ? '/imported-travel-variance-consent' : '/imported-labor-duration-consent')), isAsset() ? 'm25-imported-asset-utilization-cost-consent-v1' : (isTravel() ? 'm25-imported-travel-variance-consent-v1' : 'm25-imported-labor-duration-consent-v1')));
    if (isAsset()) root.appendChild(consentCard('Asset health summaries', 'Controls summaries of current maintenance and downtime records for an exact reviewed asset.', state.consents.health,
      base + '/imported-asset-health-consent', 'm25-imported-asset-health-consent-v1'));
    root.appendChild(consentCard('Planning suggestions', 'Controls service-level summaries built from current reviewed comparisons.', state.consents.calibration,
      base + (isAsset() ? '/imported-asset-calibration-consent' : (isTravel() ? '/imported-travel-calibration-consent' : '/imported-labor-calibration-consent')), isAsset() ? 'm25-imported-asset-calibration-consent-v1' : (isTravel() ? 'm25-imported-travel-calibration-consent-v1' : 'm25-imported-labor-calibration-consent-v1')));
  }
  function operationPair(value) { return value ? { expectedRevision: value.revision, expectedDigest: value.digest } : { expectedRevision: 0, expectedDigest: 'none' }; }
  function operationCard(title, description) { var card = node('article', 'learning-operation-card'); card.appendChild(node('h4', '', title)); card.appendChild(node('p', '', description)); return card; }
  function checkpoint(mode) { var value = state.operations.checkpoints || []; if (!Array.isArray(value)) value = mode.indexOf('cleanup') >= 0 ? (value.cleanup || []) : (value.imports || []); var normalized = mode === 'retention_cleanup' ? 'retention' : (mode === 'deletion_cleanup' ? 'deletion' : mode); return value.filter(function (item) { return item.mode === normalized || item.operation === normalized; })[0] || null; }
  function saveOperation(path, body, message) {
    status(message); return mutate(operationBase(state.sourceKind, state.sourceKey) + path, body)
      .then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(function (error) {
        fail(error);
        renderOperations();
      });
  }
  function renderOperations() {
    var root = el('learningOperations'); clear(root);
    if (!state.operations) { root.appendChild(node('p', 'learning-empty', 'Loading source operations.')); return; }
    var grid = node('div', 'learning-operation-grid'), backfill = checkpoint('historical_backfill');
    if (state.sourceKind === 'labor') {
      var csv = operationCard('Earlier CSV records', backfill && backfill.complete ? 'Earlier records are complete. Current source corrections can continue through the saved connection.' : 'Upload one reviewed NorthStar labor CSV page with no more than 100 records.');
      var file = node('input', 'learning-file'); file.type = 'file'; file.accept = '.csv,text/csv'; file.setAttribute('aria-label', 'Reviewed labor CSV'); file.disabled = demo || !state.consents.source.active || Boolean(backfill && backfill.complete); csv.appendChild(file);
      var pageLabel = node('label', '', 'Earlier record progress'); pageLabel.htmlFor = 'learningCsvPageState'; var pageState = node('select'); pageState.id = 'learningCsvPageState';
      [['complete', 'This file is the final page'], ['more', 'More CSV pages follow']].forEach(function (choice) { var option = node('option', '', choice[1]); option.value = choice[0]; pageState.appendChild(option); });
      pageState.disabled = demo || Boolean(backfill && backfill.complete); csv.appendChild(pageLabel); csv.appendChild(pageState);
      var cursorLabel = node('label', '', 'Resume marker after this page'); cursorLabel.htmlFor = 'learningCsvCursorAfter'; var cursorAfter = node('input'); cursorAfter.id = 'learningCsvCursorAfter'; cursorAfter.type = 'text'; cursorAfter.maxLength = 200; cursorAfter.autocomplete = 'off'; cursorAfter.placeholder = 'Example: payroll-page-002'; cursorAfter.disabled = true; csv.appendChild(cursorLabel); csv.appendChild(cursorAfter);
      pageState.addEventListener('change', function () { cursorAfter.disabled = demo || pageState.value !== 'more'; if (!cursorAfter.disabled) cursorAfter.focus(); });
      var importButton = button(demo ? 'Demo preview' : (backfill && backfill.complete ? 'Earlier records complete' : 'Import CSV'), function () {
        if (!file.files || !file.files[0]) { status('Choose a CSV file before importing.', 'error'); return; }
        var complete = pageState.value === 'complete', nextCursor = complete ? null : cursorAfter.value.trim();
        if (!complete && !/^[!-~]{1,200}$/.test(nextCursor)) { status('Enter a 1 to 200 character checkpoint with no spaces for the next page.', 'error'); cursorAfter.focus(); return; }
        importButton.disabled = true; status('Reading and validating the reviewed CSV.');
        file.files[0].text().then(function (text) { return mutate(sourceBase('labor', state.sourceKey) + '/csv-backfill', {
          cursorBefore: backfill && !backfill.complete ? backfill.cursorAfter : null, cursorAfter: nextCursor, complete: complete, csvText: text
        }); }).then(function () { return selectSource('labor', state.sourceKey, true); }).catch(function (error) { importButton.disabled = false; fail(error); });
      }, true); importButton.disabled = demo || !state.consents.source.active || Boolean(backfill && backfill.complete); csv.appendChild(node('div', 'learning-actions')).appendChild(importButton); csv.appendChild(node('small', '', backfill && !backfill.complete ? 'Continue the previous import. Required columns are checked before records are saved for review.' : 'Required columns are checked before records are saved for review.')); grid.appendChild(csv);
    } else {
      var continuous = checkpoint('continuous_update');
       var checkpointCard = operationCard('Import progress', isBusinessKind() ? 'Authorized connections submit reviewed business records in pages of no more than 100. Progress is saved so a later import can continue safely.' : (isMaterial() ? 'Authorized connections submit reviewed material, inventory and purchasing records in pages of no more than 100. Progress is saved so a later import can continue safely.' : (isAsset() ? 'Authorized connections submit reviewed vehicle and equipment records in pages of no more than 100. Progress is saved so a later import can continue safely.' : 'Authorized connections submit reviewed route, mileage and fuel records in pages of no more than 100. Progress is saved so a later import can continue safely.')));
      var checkpointMetrics = node('div', 'learning-compact-metrics');
      checkpointMetrics.appendChild(metric('Earlier records', backfill ? (backfill.complete ? 'Complete' : 'In progress') : 'Not started'));
      checkpointMetrics.appendChild(metric('Continuous updates', continuous ? ('Run ' + integer(continuous.sequence)) : 'Not started'));
      checkpointCard.appendChild(checkpointMetrics);
       checkpointCard.appendChild(node('small', '', isBusinessKind() ? 'Recorded status, time, quantity and money details keep their source meaning. Missing details remain unavailable.' : (isMaterial() ? 'Quantities, units, currency, supplier evidence and inventory locations stay as recorded. Missing details remain unavailable.' : (isAsset() ? 'Machine use, cost, maintenance and downtime retain their source units and evidence basis. Missing dimensions remain unavailable.' : 'Distance and fuel retain their source units and evidence basis. Missing dimensions remain unavailable.'))));
      grid.appendChild(checkpointCard);
    }

    var adapter = state.operations.adapter, adapterState = adapter && adapter.action === 'resume' ? 'Running' : (adapter && adapter.action === 'pause' ? 'Paused' : (adapter ? contract.label(adapter.action) : null));
    var adapterCard = operationCard('Continuous updates', adapter ? 'Current state: ' + adapterState + '. Connections are managed outside this page.' : 'Choose how an authorized connection may submit future updates.');
    var canConfigure = !adapter || adapter.action === 'disconnect';
    var kindLabel = node('label', '', 'Connection method'); kindLabel.htmlFor = 'learningAdapterKind'; var kindSelect = node('select'); kindSelect.id = 'learningAdapterKind';
    [['provider_api', 'Connected service'], [isBusinessKind() ? 'file_import' : 'csv', 'File import']].forEach(function (choice) { var option = node('option', '', choice[1]); option.value = choice[0]; kindSelect.appendChild(option); }); kindSelect.value = adapter ? adapter.adapterKind : 'provider_api'; kindSelect.disabled = demo || !canConfigure; adapterCard.appendChild(kindLabel); adapterCard.appendChild(kindSelect);
    var cadenceLabel = node('label', '', 'Update schedule'); cadenceLabel.htmlFor = 'learningAdapterCadence'; var cadenceSelect = node('select'); cadenceSelect.id = 'learningAdapterCadence';
    [['hourly', 'Hourly'], ['daily', 'Daily'], ['manual', 'Manual']].forEach(function (choice) { var option = node('option', '', choice[1]); option.value = choice[0]; cadenceSelect.appendChild(option); }); cadenceSelect.value = adapter ? adapter.cadence : 'daily'; cadenceSelect.disabled = demo || !canConfigure; adapterCard.appendChild(cadenceLabel); adapterCard.appendChild(cadenceSelect);
    var adapterAction = !adapter || adapter.action === 'disconnect' ? 'connect' : (adapter.action === 'pause' ? 'resume' : 'pause');
    var adapterButton = button(demo ? 'Demo preview' : (adapterAction === 'connect' ? 'Connect updates' : (adapterAction === 'resume' ? 'Resume updates' : 'Pause updates')), function () {
      var pair = operationPair(adapter); adapterButton.disabled = true;
      saveOperation('/adapter', { action: adapterAction, adapterKind: canConfigure ? kindSelect.value : adapter.adapterKind, cadence: canConfigure ? cadenceSelect.value : adapter.cadence,
        expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, 'Saving the continuous update setting.');
    }); adapterButton.disabled = demo || !state.consents.source.active;
    var adapterActions = node('div', 'learning-actions'); adapterActions.appendChild(adapterButton);
    if (adapter && adapter.action !== 'disconnect') { var disconnectButton = button('Stop updates', function () { var pair = operationPair(adapter); disconnectButton.disabled = true; saveOperation('/adapter', { action: 'disconnect', adapterKind: adapter.adapterKind, cadence: adapter.cadence, expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, 'Stopping continuous updates.'); }); disconnectButton.disabled = demo; adapterActions.appendChild(disconnectButton); }
    adapterCard.appendChild(adapterActions); grid.appendChild(adapterCard);

    var hold = state.operations.hold, holdActive = Boolean((isMaterial() || isBusinessKind()) && hold && hold.action === 'place');
    if (isMaterial() || isBusinessKind()) {
      var holdCard = operationCard('Legal and audit hold', holdActive ? 'Cleanup is paused by the active ' + contract.label(hold.holdKind, 'company') + ' hold.' : 'Place a hold when source records must remain available for a legal or audit review.');
      var holdKindLabel = node('label', '', 'Hold type'); holdKindLabel.htmlFor = 'learningHoldKind'; var holdKind = node('select'); holdKind.id = 'learningHoldKind';
      [['legal', 'Legal hold'], ['audit', 'Audit hold']].forEach(function (choice) { holdKind.appendChild(new Option(choice[1], choice[0])); }); holdKind.value = holdActive ? hold.holdKind : 'legal'; holdKind.disabled = demo || holdActive; holdCard.appendChild(holdKindLabel); holdCard.appendChild(holdKind);
      var holdAction = button(demo ? 'Demo preview' : (holdActive ? 'Release hold' : 'Place hold'), function () { var pair = operationPair(hold); holdAction.disabled = true; saveOperation('/hold', { action: holdActive ? 'release' : 'place', holdKind: holdActive ? hold.holdKind : holdKind.value, expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, holdActive ? 'Releasing the source hold.' : 'Placing the source hold.'); });
      holdAction.disabled = demo; holdCard.appendChild(node('div', 'learning-actions')).appendChild(holdAction); grid.appendChild(holdCard);
    }

    var retention = state.operations.retention, retentionCard = operationCard('Record retention', integer(state.operations.retentionEligibleTotal) + ' current records are eligible under the saved retention period.');
    var daysLabel = node('label', '', 'Keep source records for days'); daysLabel.htmlFor = 'learningRetentionDays'; var days = node('input'); days.id = 'learningRetentionDays'; days.type = 'number'; days.min = '30'; days.max = '3650'; days.step = '1'; days.value = retention && retention.action === 'set' ? retention.retentionDays : 365; days.disabled = demo; retentionCard.appendChild(daysLabel); retentionCard.appendChild(days);
    var saveRetention = button(demo ? 'Demo preview' : 'Save retention', function () { var pair = operationPair(retention); saveRetention.disabled = true; saveOperation('/retention', { action: 'set', retentionDays: Number(days.value), expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, 'Saving the retention policy.'); }); saveRetention.disabled = demo;
    var retentionCheckpoint = checkpoint('retention_cleanup');
    var runRetention = button('Process eligible records', function () { var pair = operationPair(retention); runRetention.disabled = true; saveOperation('/cleanup', { operation: 'retention', expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, cursorBefore: retentionCheckpoint && !retentionCheckpoint.complete ? retentionCheckpoint.cursorAfter : null, limit: 100, confirmed: true }, 'Processing the next retention batch.'); }); runRetention.disabled = demo || holdActive || !retention || retention.action !== 'set' || state.operations.retentionEligibleTotal < 1;
    if (holdActive) retentionCard.appendChild(node('small', '', 'Release the active hold before processing retained records.'));
    var retentionActions = node('div', 'learning-actions'); retentionActions.appendChild(saveRetention); retentionActions.appendChild(runRetention); retentionCard.appendChild(retentionActions); grid.appendChild(retentionCard);

    var deletion = state.operations.deletion, deletionRequested = deletion && deletion.action === 'request'; var deletionCard = operationCard('Delete imported source records', deletionRequested ? (state.operations.deletionComplete ? 'Deletion is complete. Audit receipts retain no work details.' : integer(state.operations.activeRecordTotal) + ' current records remain to be removed from active use.') : 'A deletion request immediately pauses source use and hides dependent learning suggestions.'); deletionCard.classList.add('learning-danger');
    var deletionAction = button(demo ? 'Demo preview' : (deletionRequested ? 'Cancel request' : 'Request deletion'), function () { var pair = operationPair(deletion); deletionAction.disabled = true; saveOperation('/deletion', { action: deletionRequested ? 'cancel' : 'request', expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, confirmed: true }, deletionRequested ? 'Cancelling the source deletion request.' : 'Requesting source deletion and blocking new use.'); }); deletionAction.disabled = demo;
    var deletionCheckpoint = checkpoint('deletion_cleanup');
    var confirmation = node('label', 'learning-confirmation'); var confirmationBox = node('input'); confirmationBox.type = 'checkbox'; confirmationBox.disabled = demo || !deletionRequested || holdActive || state.operations.deletionComplete; confirmation.appendChild(confirmationBox); confirmation.appendChild(node('span', '', 'I understand this cleanup removes the next batch of source details and makes dependent suggestions unavailable. This step cannot be undone.')); deletionCard.appendChild(confirmation);
    var runDeletion = button('Process next 100', function () { if (!confirmationBox.checked) { status('Confirm the cleanup consequence before continuing.', 'error'); confirmationBox.focus(); return; } var pair = operationPair(deletion); runDeletion.disabled = true; saveOperation('/cleanup', { operation: 'deletion', expectedRevision: pair.expectedRevision, expectedDigest: pair.expectedDigest, cursorBefore: deletionCheckpoint && !deletionCheckpoint.complete ? deletionCheckpoint.cursorAfter : null, limit: 100, confirmed: true }, 'Processing the next deletion batch.'); }); runDeletion.disabled = true;
    confirmationBox.addEventListener('change', function () { runDeletion.disabled = demo || !deletionRequested || holdActive || state.operations.deletionComplete || !confirmationBox.checked; });
    if (holdActive) deletionCard.appendChild(node('small', '', 'Release the active hold before deleting source records.'));
    var deletionActions = node('div', 'learning-actions'); deletionActions.appendChild(deletionAction); deletionActions.appendChild(runDeletion); deletionCard.appendChild(deletionActions); grid.appendChild(deletionCard);
    root.appendChild(grid); root.appendChild(node('p', 'learning-empty', isMaterial() ? 'Cleanup works in reviewable batches, keeps only minimized audit receipts, and makes dependent suggestions unavailable. Holds block cleanup. It never changes estimates, inventory, purchases or policy.' : state.operations.boundary));
  }
  function metric(label, value) { var item = node('div', 'learning-metric'); item.appendChild(node('span', '', label)); item.appendChild(node('strong', '', value)); return item; }
  function renderEvidence() {
    el('evidenceSummary').textContent = state.detail.activeConsent ? (isBusinessKind() ? 'Current reviewed ' + sourceTitle(state.sourceKind).toLowerCase() + ' evidence. These records remain separate from company operating records.' : (isMaterial() ? 'Current reviewed material, inventory and purchasing evidence. These records do not change jobs, estimates, inventory or purchases.' : (isAsset() ? 'Current reviewed vehicle and equipment evidence. These records do not change jobs, assets or costs.' : (isTravel() ? 'Current reviewed route, mileage and fuel evidence. Records remain separate from operating data.' : 'Current reviewed labor evidence. Records remain separate from operating data.')))) : 'Source permission is inactive.';
    var root = el('evidenceMetrics'); clear(root);
    root.appendChild(metric('Import batches', integer(state.detail.runTotal).toLocaleString()));
    root.appendChild(metric('Current records', integer(state.detail.recordTotal).toLocaleString()));
    root.appendChild(metric('References', integer(state.matches.referenceTotal).toLocaleString()));
    root.appendChild(metric('Last source update', state.detail.latestSourceUpdatedAt ? new Date(state.detail.latestSourceUpdatedAt).toLocaleString() : 'None'));
  }
  function targetLabel(kind, target) {
    return contract.safeLabel(target.displayLabel || target.label);
  }
  function referenceLabel(reference, index) {
    if (isBusinessKind()) return 'Imported ' + contract.label(reference.referenceKind, 'record') + (Number.isInteger(index) ? ' ' + (index + 1) : '');
    return contract.label(reference.externalReference, 'Imported ' + contract.label(reference.referenceKind, 'record'));
  }
  function renderMatches() {
    var root = el('learningMatches'); clear(root); var references = state.matches.references || [];
    el('matchesSummary').textContent = references.length ? 'Link imported identities to the current company record they describe. Links that no longer match current records need review.' : (isBusinessKind() ? 'No imported customer, job, estimate, project or financial references are available.' : (isMaterial() ? 'No imported job, material, vendor or inventory location references are available.' : (isAsset() ? 'No imported vehicle, equipment or job references are available.' : (isTravel() ? 'No imported vehicle or job references are available.' : 'No imported worker or job references are available.'))));
    if (!references.length) { root.appendChild(node('p', 'learning-empty', 'No references to review.')); renderAssetHealth(); return; }
    var wrap = node('div', 'learning-table-wrap'), table = node('table', 'learning-table'), head = node('thead'), row = node('tr');
    table.appendChild(node('caption', 'learning-visually-hidden', 'Imported reference review for ' + contract.label(state.sourceKey, 'company source')));
    ['Type', 'External reference', 'Evidence', 'Status', 'Company record'].forEach(function (label) { var th = node('th', '', label); th.scope = 'col'; row.appendChild(th); }); head.appendChild(row); table.appendChild(head);
    var body = node('tbody');
    references.forEach(function (reference, index) {
      var safeReference = referenceLabel(reference, index); var tr = node('tr'); tr.appendChild(node('td', '', contract.label(reference.referenceKind, 'Record'))); tr.appendChild(node('td', '', safeReference));
      tr.appendChild(node('td', '', integer(reference.sourceRecordCount) + ' records'));
      var match = reference.match, matchState = match ? match.status : 'unmatched'; var pill = node('span', 'learning-pill', contract.label(matchState)); pill.dataset.state = matchState === 'matched' ? 'current' : (matchState === 'stale' ? 'stale' : 'review'); tr.appendChild(node('td')).appendChild(pill);
      var cell = node('td'), select = node('select'); select.setAttribute('aria-label', 'Company record for ' + safeReference);
      select.appendChild(new Option('Not linked', ''));
      var targets = reference.referenceKind === 'worker' ? state.matches.workerTargets : (reference.referenceKind === 'vehicle' ? state.matches.vehicleTargets : (reference.referenceKind === 'equipment' ? state.matches.equipmentTargets : (reference.referenceKind === 'material' ? state.matches.materialTargets : (reference.referenceKind === 'vendor' ? state.matches.vendorTargets : (reference.referenceKind === 'inventory_location' ? state.matches.inventoryLocationTargets : (isBusinessKind() ? (reference.referenceKind === 'customer' ? state.matches.customerTargets : (reference.referenceKind === 'execution' ? state.matches.executionTargets : state.matches.estimateTargets)) : state.matches.jobTargets))))));
      (targets || []).forEach(function (target) { var label = targetLabel(reference.referenceKind, target); if (!label) return; var identity = target.targetId || target.targetReference; var option = new Option(label, identity); option.dataset.digest = target.digest; select.appendChild(option); });
      select.value = match && match.action === 'link' ? (match.targetId || match.targetReference) : ''; select.disabled = demo;
      select.addEventListener('change', function () { saveMatch(reference, select); }); cell.appendChild(select); tr.appendChild(cell); body.appendChild(tr);
    }); table.appendChild(body); wrap.appendChild(table); root.appendChild(wrap); renderAssetHealth();
  }
  function saveMatch(reference, select) {
    var match = reference.match, link = Boolean(select.value), selected = select.options[select.selectedIndex]; select.disabled = true;
    status('Saving the reviewed reference match.');
    var body = {
      referenceKind: reference.referenceKind, externalReference: reference.externalReference, action: link ? 'link' : 'unlink',
      expectedRevision: match ? match.revision : 0, expectedDigest: match ? match.digest : 'none', expectedSourceDigest: reference.sourceDigest || 'unavailable',
      expectedTargetDigest: link ? selected.dataset.digest : 'unavailable', reason: 'Owner reviewed this imported reference in the Learning Center.', confirmed: true,
      confirmationVersion: isBusinessKind() ? 'm25-external-business-reference-match-v1' : (isMaterial() ? 'm25-external-material-reference-match-v1' : (isAsset() ? 'm25-external-asset-reference-match-v1' : (isTravel() ? 'm25-external-travel-reference-match-v1' : 'm25-external-labor-reference-match-v1')))
    };
    if (isMaterial()) body.targetReference = link ? select.value : null; else { body.targetId = link ? select.value : null; if (isBusinessKind()) body.targetKind = link ? (reference.referenceKind === 'customer' ? 'customer' : (reference.referenceKind === 'execution' ? 'execution' : 'estimate')) : null; }
    mutate(operationBase(state.sourceKind, state.sourceKey) + '/matches', body).then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(fail);
  }
  function assetHealthReferences() {
    return state.matches && isAsset() ? state.matches.references.filter(function (reference) {
      return (reference.referenceKind === 'vehicle' || reference.referenceKind === 'equipment') && reference.match && reference.match.status === 'matched';
    }) : [];
  }
  function healthMetric(label, value, detail) {
    var item = node('section', 'learning-dimension-card'); var heading = node('div', 'learning-dimension-heading');
    heading.appendChild(node('h5', '', label)); var available = value && value.status === 'recorded';
    var pill = node('span', 'learning-pill', available ? 'Recorded' : 'Unavailable'); pill.dataset.state = available ? 'current' : 'inactive'; heading.appendChild(pill); item.appendChild(heading);
    item.appendChild(node('strong', 'learning-dimension-value', available ? detail(value) : 'Not established'));
    item.appendChild(node('small', '', available ? (value.recordCount + ' current source ' + (value.recordCount === 1 ? 'record' : 'records')) : ((value && value.unavailableReason) || 'Current comparable evidence is unavailable.'))); return item;
  }
  function renderAssetHealth() {
    var panel = el('assetHealthPanel'), root = el('learningAssetHealth'); clear(root); panel.hidden = !isAsset();
    if (!isAsset()) return;
    var references = assetHealthReferences();
    if (!references.length) { root.appendChild(node('p', 'learning-empty', 'Review and link a vehicle or equipment reference before preparing a health summary.')); return; }
    var selected = state.healthReference || references[0];
    if (!references.some(function (item) { return item.referenceKind === selected.referenceKind && item.externalReference === selected.externalReference; })) selected = references[0];
    state.healthReference = selected;
    var controls = node('div', 'learning-inline'), label = node('label', '', 'Reviewed asset'), select = node('select'); label.htmlFor = 'learningHealthAsset'; select.id = 'learningHealthAsset';
    references.forEach(function (reference, index) { select.appendChild(new Option(contract.label(reference.referenceKind, 'Asset') + ' · ' + referenceLabel(reference), String(index))); });
    select.value = String(references.indexOf(selected)); select.addEventListener('change', function () { state.healthReference = references[Number(select.value)]; state.health = null; renderAssetHealth(); loadAssetHealth(state.healthReference); }); controls.appendChild(label); controls.appendChild(select); root.appendChild(controls);
    if (!state.health) { root.appendChild(node('p', 'learning-empty', 'Loading the current maintenance and downtime summary.')); return; }
    var card = node('article', 'learning-calibration-card'), current = state.health.current; card.appendChild(node('h4', '', referenceLabel(selected)));
    if (!current) card.appendChild(node('p', '', state.consents.health && state.consents.health.active ? 'No summary has been prepared for this reviewed asset.' : 'Allow asset health summaries before preparing one.'));
    else {
      card.appendChild(node('p', '', current.fresh ? 'Current source-backed summary. Every dimension remains separate.' : 'This summary is stale. Refresh current evidence before using it.'));
      var outcomes = current.outcomes || {}, grid = node('div', 'learning-travel-calibration-grid');
      grid.appendChild(healthMetric('Maintenance', outcomes.maintenance, function (value) { return value.completedCount + ' completed'; }));
      grid.appendChild(healthMetric('Downtime', outcomes.downtime, function (value) { return value.durationHours + ' hours'; }));
      grid.appendChild(healthMetric('Condition', outcomes.condition, function () { return 'Recorded'; }));
      grid.appendChild(healthMetric('Availability', outcomes.availability, function (value) { return value.percent + '%'; })); card.appendChild(grid);
    }
    var currentAndFresh = Boolean(current && current.fresh === true); var action = button(demo ? 'Demo preview' : (currentAndFresh ? 'Summary current' : (current ? 'Refresh summary' : 'Prepare summary')), function () {
      var consent = state.consents.health; if (!consent || !consent.active || !consent.current) { status('Allow asset health summaries before preparing one.', 'error'); return; }
      action.disabled = true; status('Preparing the current maintenance and downtime summary.');
      mutate(sourceBase('asset', state.sourceKey) + '/imported-asset-health-outcomes', { assetCategory: selected.referenceKind, externalAssetReference: selected.externalReference,
        expectedConsentRevision: consent.current.revision, expectedConsentDigest: consent.current.digest,
        reason: 'Owner requested a current reviewed asset health summary from the Learning Center.', confirmed: true, confirmationVersion: 'm25-imported-asset-health-observation-v1' })
        .then(function () { return loadAssetHealth(selected); }).catch(function (error) { action.disabled = false; fail(error); });
    }, true); action.disabled = demo || !state.consents.health || !state.consents.health.active || currentAndFresh; card.appendChild(node('div', 'learning-actions')).appendChild(action); root.appendChild(card);
  }
  function loadAssetHealth(reference) {
    if (!reference || !isAsset()) return Promise.resolve();
    if (demo) { state.healthReference = reference; state.health = demoModel('asset').health; renderAssetHealth(); return Promise.resolve(); }
    var selectionGeneration = state.selectionGeneration, healthGeneration = ++state.healthGeneration;
    return api(sourceBase('asset', state.sourceKey) + '/imported-asset-health-outcomes?assetCategory=' + encodeURIComponent(reference.referenceKind) + '&externalAssetReference=' + encodeURIComponent(reference.externalReference))
      .then(function (value) { if (selectionGeneration !== state.selectionGeneration || healthGeneration !== state.healthGeneration) return; state.healthReference = reference; state.health = contract.health(value); renderAssetHealth(); })
      .catch(function (error) { if (selectionGeneration === state.selectionGeneration && healthGeneration === state.healthGeneration) fail(error); });
  }
  function renderCalibration() {
    var root = el('learningCalibration'); clear(root); var source = selectedSource();
    el('calibrationTitle').textContent = isBusinessKind() ? 'What Polaris has learned from ' + sourceTitle(state.sourceKind).toLowerCase() : (isMaterial() ? 'What Polaris has learned about materials' : (isAsset() ? 'What Polaris has learned about vehicles and equipment' : (isTravel() ? 'What Polaris has learned about travel' : 'What Polaris has learned about labor')));
    el('calibrationDescription').textContent = isBusinessKind() ? 'Review each recorded outcome separately. Unavailable measures remain unavailable, and saving a suggestion does not apply it.' : (isMaterial() ? 'Review material use, waste, unit cost, purchasing quantity and purchasing cost separately. Supplier identity and inventory balance do not establish current availability. Saving a suggestion does not apply it.' : (isAsset() ? 'Review machine-hour use and same-currency job operating cost independently. Maintenance, downtime, condition and availability remain separate. Saving a suggestion does not apply it.' : (isTravel() ? 'Review route duration, driving distance, fuel quantity and fuel cost independently. Saving a suggestion does not apply it.' : 'Review a service-level labor summary. Saving a suggestion does not apply it.')));
    if (!source || !source.serviceKeys.length) { root.appendChild(node('p', 'learning-empty', 'No service group has enough reviewed imported outcome history yet.')); return; }
    var controls = node('div', 'learning-inline'), label = node('label', '', 'Service group'), select = node('select'); label.htmlFor = 'learningService'; select.id = 'learningService';
    source.serviceKeys.forEach(function (key) { select.appendChild(new Option(contract.label(key), key)); });
    select.value = state.calibration ? state.calibration.serviceKey : source.serviceKeys[0]; select.addEventListener('change', function () { loadCalibration(select.value); }); controls.appendChild(label); controls.appendChild(select); root.appendChild(controls);
    if (!state.calibration) { root.appendChild(node('p', 'learning-empty', 'Loading the planning review.')); return; }
    var card = node('article', 'learning-calibration-card'), current = state.calibration.current;
    card.appendChild(node('h4', '', contract.label(state.calibration.serviceKey)));
    if (!current) card.appendChild(node('p', '', state.calibration.activeConsent ? 'No suggestion has been prepared. At least five current reviewed jobs are required.' : 'Planning suggestion permission is inactive.'));
    else if (isBusinessKind()) {
      card.appendChild(node('p', '', current.fresh ? 'Current reviewed outcome summary. Each measure remains separate.' : 'This saved summary no longer matches current evidence and must be refreshed.'));
      var businessGrid = node('div', 'learning-travel-calibration-grid');
      Object.keys(current.metrics || {}).forEach(function (key) { var value = current.metrics[key] || { status: 'unavailable' }, available = value.status === 'compared'; var item = node('section', 'learning-dimension-card'), title = node('div', 'learning-dimension-heading'); title.appendChild(node('h5', '', value.label || contract.label(key))); var dimensionPill = node('span', 'learning-pill', available ? 'Compared' : 'Unavailable'); dimensionPill.dataset.state = available ? 'current' : 'inactive'; title.appendChild(dimensionPill); item.appendChild(title); item.appendChild(node('strong', 'learning-dimension-value', available ? (value.mode ? contract.label(value.mode) : (value.median ? value.median + (value.unit === 'percent' ? '%' : '') : integer(value.sampleSize) + ' reviewed')) : 'Not established')); item.appendChild(node('small', '', available ? (value.mode ? integer(value.sampleSize) + ' current reviewed outcomes' : 'Typical recorded value · middle half ' + (value.lowerQuartile || '—') + ' to ' + (value.upperQuartile || '—') + (value.unit ? ' · ' + contract.label(value.unit) : '')) : (value.unavailableReason || 'Comparable current evidence is unavailable.'))); businessGrid.appendChild(item); });
      card.appendChild(businessGrid);
    } else if (isTravel() || isAsset() || isMaterial()) {
      card.appendChild(node('p', '', current.fresh ? (isMaterial() ? 'Current reviewed material planning suggestion. Each measure remains separate.' : (isAsset() ? 'Current reviewed vehicle and equipment planning suggestion. Each measure remains separate.' : 'Current reviewed travel planning suggestion. Each measure remains separate.')) : (isMaterial() ? 'The saved material suggestion no longer matches current evidence and must be refreshed.' : (isAsset() ? 'The saved vehicle and equipment suggestion no longer matches current evidence and must be refreshed.' : 'The saved travel suggestion no longer matches current evidence and must be refreshed.'))));
      var travelGrid = node('div', 'learning-travel-calibration-grid');
      (isMaterial() ? ['totalUse', 'waste', 'unitCost', 'purchaseQuantity', 'purchaseCost'] : (isAsset() ? ['utilization', 'operatingCost'] : ['routeDuration', 'distance', 'fuelQuantity', 'fuelCost'])).forEach(function (key) {
        var value = current.metrics && current.metrics[key] ? current.metrics[key] : { status: 'unavailable' };
        var item = node('section', 'learning-dimension-card');
        var title = node('div', 'learning-dimension-heading'); title.appendChild(node('h5', '', value.label || contract.label(key)));
        var dimensionPill = node('span', 'learning-pill', value.status === 'compared' ? 'Compared' : 'Unavailable'); dimensionPill.dataset.state = value.status === 'compared' ? 'current' : 'inactive'; title.appendChild(dimensionPill); item.appendChild(title);
        item.appendChild(node('strong', 'learning-dimension-value', value.proposedMultiplier ? value.proposedMultiplier + '×' : 'No multiplier'));
        item.appendChild(node('small', '', value.status === 'compared' ? ('Typical recorded-to-plan comparison · ' + value.medianActualToPlannedRatio + (value.unit ? ' · ' + contract.label(value.unit) : '') + (value.basis ? ' · ' + value.basis : '')) : (value.unavailableReason || 'Comparable current evidence is unavailable.')));
        if (value.advisoryMessage) item.appendChild(node('p', '', value.advisoryMessage)); travelGrid.appendChild(item);
      });
      card.appendChild(travelGrid);
    } else {
      card.appendChild(node('p', '', current.fresh ? (current.advisoryMessage || 'Current reviewed proposal.') : 'The saved proposal is stale and must be refreshed before use.'));
      var grid = node('div', 'learning-calibration-grid'); grid.appendChild(metric('Reviewed jobs', String(integer(current.sampleSize))));
      grid.appendChild(metric('Median ratio', current.medianActualToPlannedRatio || 'Unavailable')); grid.appendChild(metric('Planning multiplier', current.proposedPlannedHoursMultiplier || 'Needs refresh')); card.appendChild(grid);
    }
    var currentAndFresh = Boolean(current && current.fresh === true);
    var action = button(demo ? 'Demo preview' : (currentAndFresh ? 'Suggestion current' : (current ? 'Refresh suggestion' : 'Prepare suggestion')), function () {
      var consent = state.consents.calibration; if (!consent.active || !consent.current) { status('Allow planning suggestions before preparing one.', 'error'); return; }
      action.disabled = true; status('Preparing a reviewed planning suggestion.');
       mutate(isBusinessKind() ? businessCalibrationBase(state.calibration.serviceKey, true) : sourceBase(state.sourceKind, state.sourceKey) + (isMaterial() ? '/imported-material-calibrations/' : (isAsset() ? '/imported-asset-calibrations/' : (isTravel() ? '/imported-travel-calibrations/' : '/imported-labor-calibrations/'))) + encodeURIComponent(state.calibration.serviceKey), {
        expectedConsentRevision: consent.current.revision, expectedConsentDigest: consent.current.digest,
         reason: isBusinessKind() ? 'Owner requested a current service-level business outcome summary from the Learning Center.' : (isMaterial() ? 'Owner requested a current service-level material planning suggestion from the Learning Center.' : (isAsset() ? 'Owner requested a current service-level vehicle and equipment planning suggestion from the Learning Center.' : (isTravel() ? 'Owner requested a current service-level travel planning suggestion from the Learning Center.' : 'Owner requested a current service-level labor planning suggestion from the Learning Center.'))), confirmed: true,
         confirmationVersion: isBusinessKind() ? 'm25-external-business-calibration-proposal-v1' : (isMaterial() ? 'm25-imported-material-calibration-proposal-v1' : (isAsset() ? 'm25-imported-asset-calibration-proposal-v1' : (isTravel() ? 'm25-imported-travel-calibration-proposal-v1' : 'm25-imported-labor-calibration-proposal-v1')))
      }).then(function () { return selectSource(state.sourceKind, state.sourceKey, true); }).catch(function (error) { action.disabled = false; fail(error); });
    }, true); action.disabled = demo || !state.consents.calibration.active || currentAndFresh; card.appendChild(node('div', 'learning-actions')).appendChild(action); root.appendChild(card);
  }

  function loadCalibration(serviceKey) {
    if (demo) { state.calibration = demoModel(state.sourceKind).calibration; state.calibration.serviceKey = serviceKey; renderCalibration(); renderSummary(); return Promise.resolve(); }
    var selectionGeneration = state.selectionGeneration, calibrationGeneration = ++state.calibrationGeneration;
    var base = sourceBase(state.sourceKind, state.sourceKey), travel = isTravel(), asset = isAsset(), material = isMaterial(), business = isBusinessKind();
    state.calibration = null; renderCalibration();
    return api(business ? businessCalibrationBase(serviceKey) : base + (material ? '/imported-material-calibrations/' : (asset ? '/imported-asset-calibrations/' : (travel ? '/imported-travel-calibrations/' : '/imported-labor-calibrations/'))) + encodeURIComponent(serviceKey))
      .then(function (value) {
        if (selectionGeneration !== state.selectionGeneration || calibrationGeneration !== state.calibrationGeneration) return;
        state.calibration = contract.calibration(value); renderCalibration(); renderSummary();
      }).catch(function (error) {
        if (selectionGeneration === state.selectionGeneration && calibrationGeneration === state.calibrationGeneration) fail(error);
      });
  }
  function selectSource(sourceKind, sourceKey, refresh) {
    var generation = ++state.selectionGeneration, travel = sourceKind === 'travel', asset = sourceKind === 'asset', material = sourceKind === 'material', business = isBusinessKind(sourceKind); ++state.calibrationGeneration; ++state.healthGeneration;
    if (sourceKind !== state.sourceKind || sourceKey !== state.sourceKey) state.partnerSourceKey = null;
    state.sourceKind = sourceKind; state.sourceKey = sourceKey; state.detail = null; state.matches = null; state.calibration = null; state.health = null; state.healthReference = null; state.operations = null;
    renderSources(); el('learningDetail').hidden = true; status('Loading ' + contract.label(sourceKey, 'company source') + '.'); el('learningMain').setAttribute('aria-busy', 'true');
    if (demo) {
      var model = demoModel(sourceKind); state.detail = model.source; state.consents = { source: model.sourceConsent, outcome: model.outcomeConsent, cost: model.costConsent || null, health: model.healthConsent, calibration: model.calibrationConsent };
      state.matches = model.matches; state.calibration = model.calibration; state.health = asset ? model.health : null; state.healthReference = asset ? assetHealthReferences()[0] : null; state.operations = model.operations; finishDetail(generation); return Promise.resolve();
    }
    var base = sourceBase(sourceKind, sourceKey);
    var outcomeConsentPath = material ? '/imported-material-quantity-consent' : (asset ? '/imported-utilization-cost-consent' : (travel ? '/imported-travel-variance-consent' : '/imported-labor-duration-consent'));
    var costConsentRequest = material ? api(base + '/imported-material-cost-consent') : Promise.resolve(null);
    var calibrationConsentPath = material ? '/imported-material-calibration-consent' : (asset ? '/imported-asset-calibration-consent' : (travel ? '/imported-travel-calibration-consent' : '/imported-labor-calibration-consent'));
    var healthConsentRequest = asset ? api(base + '/imported-asset-health-consent') : Promise.resolve(null);
    var inactiveConsent = { active: false, current: null, history: [], total: 0, truncated: false };
    var partnerReady = !business || (sourceKind !== 'crm_field_service' && sourceKind !== 'communication') || Boolean(businessPartner(sourceKind));
    var outcomeConsentRequest = business ? (partnerReady ? api(businessOutcomeBase() + '/consent') : Promise.resolve(inactiveConsent)) : api(base + outcomeConsentPath);
    var calibrationConsentRequest = business ? (partnerReady ? api(businessCalibrationBase()) : Promise.resolve(inactiveConsent)) : api(base + calibrationConsentPath);
    return Promise.all([api(base), api(base + '/consent'), api(operationBase(sourceKind, sourceKey) + '/matches'), outcomeConsentRequest, calibrationConsentRequest, api(operationBase(sourceKind, sourceKey) + '/operations'), healthConsentRequest, costConsentRequest])
      .then(function (values) {
        if (generation !== state.selectionGeneration) return null;
        state.detail = contract.source(values[0]); state.consents = { source: contract.consent(values[1]), outcome: contract.consent(values[3]), cost: material ? contract.consent(values[7]) : null, health: asset ? contract.consent(values[6]) : null, calibration: contract.consent(values[4]) };
        state.matches = contract.matches(values[2]); state.operations = contract.operations(values[5]); var source = selectedSource();
        var requests = [];
        if (source && source.serviceKeys.length && partnerReady) requests.push(api(business ? businessCalibrationBase(source.serviceKeys[0]) : base + (material ? '/imported-material-calibrations/' : (asset ? '/imported-asset-calibrations/' : (travel ? '/imported-travel-calibrations/' : '/imported-labor-calibrations/'))) + encodeURIComponent(source.serviceKeys[0])).then(function (value) {
          if (generation === state.selectionGeneration) state.calibration = contract.calibration(value);
        })); else state.calibration = null;
        if (asset) { var healthReference = assetHealthReferences()[0]; if (healthReference) requests.push(api(base + '/imported-asset-health-outcomes?assetCategory=' + encodeURIComponent(healthReference.referenceKind) + '&externalAssetReference=' + encodeURIComponent(healthReference.externalReference)).then(function (value) {
              if (generation === state.selectionGeneration) { state.healthReference = healthReference; state.health = contract.health(value); }
        })); }
        return Promise.all(requests);
      }).then(function () { if (generation === state.selectionGeneration) finishDetail(generation); }).catch(function (error) {
        if (generation === state.selectionGeneration) fail(error);
      });
  }
  function finishDetail(generation) {
    if (generation !== state.selectionGeneration || !state.detail || !state.matches || !state.operations) return;
    el('learningDetail').hidden = false; el('learningDetailTitle').textContent = contract.label(state.sourceKey, 'Company source') + ' · ' + sourceTitle(state.sourceKind);
    setPill(el('learningDetailState'), state.detail.activeConsent, !state.detail.activeConsent); renderConsentCards(); renderOperations(); renderEvidence(); renderMatches(); renderCalibration(); renderSummary();
    status(demo ? 'Showing isolated demo records. Controls are read-only.' : 'Learning Center is current.', 'success'); el('learningMain').setAttribute('aria-busy', 'false');
  }
  function load(preferredKind, preferredKey) {
    if (typeof preferredKind !== 'string' || typeof preferredKey !== 'string') { preferredKind = null; preferredKey = null; }
    var generation = ++state.loadGeneration, entryLoad = state.center === null; ++state.selectionGeneration; ++state.calibrationGeneration; ++state.healthGeneration;
    if (entryLoad) global.scrollTo(0, 0);
    status('Loading your company learning controls.'); el('learningRefresh').disabled = true; el('learningMain').setAttribute('aria-busy', 'true');
    var promise = demo ? Promise.resolve(demoModel('labor').center) : api('/center');
    return promise.then(function (value) {
      if (generation !== state.loadGeneration) return;
      state.center = contract.center(value); state.sourceKind = null; state.sourceKey = null; state.partnerSourceKey = null; state.detail = null; state.matches = null; state.calibration = null; state.health = null; state.healthReference = null; state.operations = null;
      el('learningBoundary').textContent = state.center.learningBoundary; renderNative(); renderSources(); renderSummary();
      if (state.center.sources.length) {
        var preferred = state.center.sources.filter(function (source) { return source.sourceKind === preferredKind && source.sourceKey === preferredKey; })[0] || state.center.sources[0];
        return selectSource(preferred.sourceKind, preferred.sourceKey);
      }
      el('learningDetail').hidden = true; status('Learning Center is ready. No external source has been recorded.', 'success');
    }).catch(function (error) {
      if (generation === state.loadGeneration) fail(error);
    }).finally(function () {
      if (generation !== state.loadGeneration) return;
      el('learningRefresh').disabled = false;
      el('learningMain').setAttribute('aria-busy', 'false');
      if (entryLoad) { global.scrollTo(0, 0); global.requestAnimationFrame(function () { global.scrollTo(0, 0); }); }
    });
  }
  function fail(error) {
    var message = 'Learning Center could not complete that request. Refresh and try again.';
    if (error && error.status === 401) message = 'Your session ended. Sign in again to continue.';
    else if (error && error.status === 403) message = 'You do not have permission to change this company record.';
    else if (error && error.status === 409) message = 'This company record changed. Refresh the Learning Center and try again.';
    else if (error && Number(error.status) >= 500) message = 'Learning Center is temporarily unavailable. Refresh and try again.';
    status(message, 'error');
    el('learningRefresh').disabled = false; el('learningMain').setAttribute('aria-busy', 'false');
  }

  el('learningRefresh').addEventListener('click', load);
  el('learningSourceForm').addEventListener('submit', function (event) {
    event.preventDefault(); if (demo) return;
    var input = el('learningSourceKey'), sourceKind = el('learningSourceKind').value, sourceKey = input.value.trim().toLowerCase();
    if (!contract.KEY.test(sourceKey)) { status('Use 2 to 64 lowercase letters, numbers, dots, dashes or underscores.', 'error'); input.focus(); return; }
    el('learningSourceAdd').disabled = true; status('Adding the company source.');
    mutate(sourceBase(sourceKind, sourceKey) + '/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Owner added this company source in the Learning Center.', confirmed: true, confirmationVersion: isBusinessKind(sourceKind) ? importConsentVersion(sourceKind) : (sourceKind === 'material' ? 'm25-external-material-import-consent-v1' : (sourceKind === 'asset' ? 'm25-external-asset-import-consent-v1' : (sourceKind === 'travel' ? 'm25-external-travel-import-consent-v1' : 'm25-external-labor-import-consent-v1'))) })
      .then(function () { input.value = ''; return load(sourceKind, sourceKey); }).catch(fail).finally(function () { el('learningSourceAdd').disabled = false; });
  });
  if (demo) { el('learningSourceKind').disabled = true; el('learningSourceKey').disabled = true; el('learningSourceAdd').disabled = true; }
  if (demo) load(); else session.guard().then(function (account) {
    if (account && account.user) load();
  });
})(window);
