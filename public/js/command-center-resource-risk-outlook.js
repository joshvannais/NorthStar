(function (global) {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/;
  var INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var NUMBER = /^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;
  var MATERIAL_UNITS = ['ea', 'm', 'm2', 'm3', 'ft', 'ft2', 'ft3', 'yd3', 'kg', 'lb', 'l', 'gal'];
  var MATERIAL_REASONS = ['business_calendar_unavailable', 'complete_source_coverage_unavailable',
    'approved_timing_attribution_unavailable', 'current_owner_confirmed_booking_unavailable',
    'duplicate_current_job_material_source', 'current_adopted_material_composition_unavailable',
    'compatible_m25_outcome_unavailable'];
  var ASSET_REASONS = ['business_calendar_unavailable', 'complete_source_coverage_unavailable',
    'approved_timing_attribution_unavailable', 'current_owner_confirmed_booking_unavailable',
    'duplicate_current_job_equipment_source', 'current_adopted_equipment_composition_unavailable',
    'current_adopted_readiness_unavailable', 'exact_asset_identity_unavailable',
    'current_readiness_evidence_unavailable', 'compatible_m25_outcome_unavailable'];
  var ROUTE_REASONS = ['business_calendar_unavailable', 'complete_source_coverage_unavailable',
    'approved_timing_attribution_unavailable', 'long_job_phase_attribution_unavailable',
    'current_owner_confirmed_booking_unavailable', 'duplicate_current_job_travel_source',
    'current_adopted_travel_composition_unavailable', 'current_adopted_route_coverage_unavailable',
    'compatible_m25_outcome_unavailable'];

  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var own = Reflect.ownKeys(value);
    return own.length === keys.length && own.every(function (key) {
      var descriptor = typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key);
      return keys.indexOf(key) >= 0 && descriptor && descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  }
  function dense(value, maximum) {
    if (!Array.isArray(value) || value.length > maximum ||
        Reflect.ownKeys(value).length !== value.length + 1) return false;
    return value.every(function (_item, index) {
      var descriptor = Object.getOwnPropertyDescriptor(value, index);
      return descriptor && descriptor.enumerable &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  }
  function instant(value) {
    return typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value));
  }
  function text(value, maximum) {
    return typeof value === 'string' && value === value.trim() && value.length > 0 &&
      value.length <= (maximum || 160) && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  }
  function number(value) { return typeof value === 'string' && NUMBER.test(value); }
  function micro(value) {
    if (!number(value)) return null;
    var pieces = value.split('.');
    return BigInt(pieces[0]) * 1000000n + BigInt((pieces[1] || '').padEnd(6, '0'));
  }
  function integer(value, maximum) {
    return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  }
  function uuid(value) { return typeof value === 'string' && UUID.test(value); }
  function digest(value) { return typeof value === 'string' && DIGEST.test(value); }

  function validHorizon(value, checkedAt, state) {
    return exact(value, ['kind', 'timeZone', 'startsAt', 'endsAt', 'startsOn', 'endsOnExclusive']) &&
      value.kind === 'next_30_elapsed_days' && value.startsAt === checkedAt &&
      (text(value.timeZone, 100) || (state === 'unavailable' && value.timeZone === null)) &&
      instant(value.startsAt) && instant(value.endsAt) && DATE.test(value.startsOn || '') &&
      DATE.test(value.endsOnExclusive || '') &&
      Date.parse(value.endsAt) - Date.parse(value.startsAt) === 2592000000;
  }
  function validScope(value) {
    return exact(value, ['label', 'wholeBusinessCoverageVerified', 'offPlatformCoverageVerified']) &&
      value.label === 'Authenticated owner-confirmed scheduled backlog' &&
      value.wholeBusinessCoverageVerified === false && value.offPlatformCoverageVerified === false;
  }
  function validRun(value, calculationVersion, current) {
    return exact(value, ['calculationVersion', 'sourceDigest', 'digest']) &&
      value.calculationVersion === calculationVersion &&
      (current ? digest(value.sourceDigest) && digest(value.digest) :
        value.sourceDigest === null && value.digest === null);
  }
  function unavailablePosition(value, reason) {
    return exact(value, ['state', 'value', 'unit', 'reason']) && value.state === 'unavailable' &&
      value.value === null && value.unit === null && value.reason === reason;
  }
  function learned(value, state, count, reason) {
    return exact(value, ['state', 'applicableValueCount', 'applied', 'reason']) &&
      value.state === state && value.applicableValueCount === count &&
      value.applied === false && value.reason === reason;
  }
  function unavailableCoverage(value, keys, reason) {
    return exact(value, keys) && value.state === 'unavailable' && value.completeAsOf === false &&
      value.hasMore === null && value.reason === reason && Object.keys(value).every(function (key) {
        return ['state', 'completeAsOf', 'hasMore', 'reason'].includes(key) || value[key] === null;
      });
  }
  function validPlannedWindow(value, withAuthority, horizon) {
    if (!value || !instant(value.startsAt) || !instant(value.endsAt) || value.startsAt >= value.endsAt) {
      return false;
    }
    if (!withAuthority) return exact(value, ['startsAt', 'endsAt']);
    return exact(value, ['startsAt', 'endsAt', 'timeZone', 'assignmentRevision',
      'assignmentDigest', 'approvalId', 'timeZoneAuthority', 'timeEvidenceDigest']) &&
      text(value.timeZone, 100) && (!horizon || value.timeZone === horizon.timeZone) &&
      Number.isSafeInteger(value.assignmentRevision) &&
      value.assignmentRevision >= 2 && digest(value.assignmentDigest) && uuid(value.approvalId) &&
      digest(value.timeEvidenceDigest) && exact(value.timeZoneAuthority,
        ['profileHash', 'profileId', 'profileVersion', 'timeZone', 'evaluatedAt']) &&
      digest(value.timeZoneAuthority.profileHash) && uuid(value.timeZoneAuthority.profileId) &&
      Number.isSafeInteger(value.timeZoneAuthority.profileVersion) &&
      value.timeZoneAuthority.profileVersion >= 1 &&
      value.timeZoneAuthority.timeZone === value.timeZone && instant(value.timeZoneAuthority.evaluatedAt);
  }
  function validJob(value, withAuthority, horizon) {
    return exact(value, ['appointmentId', 'assignmentId', 'bookingReviewId',
      'bookingConfirmationId', 'issuedVersionId', 'plannedWindow']) &&
      [value.appointmentId, value.assignmentId, value.bookingReviewId,
        value.bookingConfirmationId, value.issuedVersionId].every(uuid) &&
      validPlannedWindow(value.plannedWindow, withAuthority, horizon);
  }
  function validEstimate(value) {
    return exact(value, ['id', 'revisionId', 'revision', 'digest']) && uuid(value.id) &&
      uuid(value.revisionId) && Number.isSafeInteger(value.revision) && value.revision >= 1 &&
      digest(value.digest);
  }
  function validComposition(value, kind) {
    var keys = kind === 'route' ? ['id', 'revision', 'digest', 'calculationVersion',
      'manifestDigest', 'coverageDigest'] : ['id', 'revision', 'digest', 'calculationVersion',
      'componentManifest', 'coverageAssessment'];
    return exact(value, keys) && uuid(value.id) && Number.isSafeInteger(value.revision) &&
      value.revision >= 1 && digest(value.digest) &&
      value.calculationVersion === 'estimate-cost-adoption-v3' &&
      (kind === 'route' ? (digest(value.manifestDigest) && digest(value.coverageDigest)) :
        value.componentManifest && typeof value.componentManifest === 'object' &&
        !Array.isArray(value.componentManifest) && value.coverageAssessment &&
        typeof value.coverageAssessment === 'object' && !Array.isArray(value.coverageAssessment));
  }
  function validSourceCommon(value, index, withAuthority, kind, horizon) {
    return value.sourceIndex === index && validJob(value.job, withAuthority, horizon) &&
      validEstimate(value.estimate) && validComposition(value.composition, kind);
  }

  function materialSource(value, index) {
    return exact(value, ['sourceIndex', 'job', 'estimate', 'composition', 'materialPlan']) &&
      validSourceCommon(value, index, false, 'material') &&
      exact(value.materialPlan, ['id', 'revision', 'digest', 'calculationVersion']) &&
      uuid(value.materialPlan.id) && Number.isSafeInteger(value.materialPlan.revision) &&
      value.materialPlan.revision >= 1 && digest(value.materialPlan.digest) &&
      value.materialPlan.calculationVersion === 'estimate-material-plan-v4';
  }
  function materialBoundary(value) {
    return exact(value.inventory, ['state', 'onHand', 'compatibleStockIdentityVerified',
      'transactionCoverageVerified', 'receiptSemanticsVerified', 'm23UsageApplied', 'reason']) &&
      value.inventory.state === 'unavailable' && value.inventory.onHand === null &&
      value.inventory.compatibleStockIdentityVerified === false &&
      value.inventory.transactionCoverageVerified === false &&
      value.inventory.receiptSemanticsVerified === false && value.inventory.m23UsageApplied === false &&
      value.inventory.reason === 'source_owned_inventory_ledger_unavailable' &&
      exact(value.futureReceipts, ['state', 'quantity', 'receiptDatesVerified', 'reason']) &&
      value.futureReceipts.state === 'unavailable' && value.futureReceipts.quantity === null &&
      value.futureReceipts.receiptDatesVerified === false &&
      value.futureReceipts.reason === 'future_receipts_unavailable' &&
      exact(value.replenishment, ['state', 'leadTimeDays', 'cutoffAt', 'leadTimePolicyVerified',
        'cutoffPolicyVerified', 'supplierAvailabilityVerified', 'purchaseAuthorityVerified', 'reason']) &&
      value.replenishment.state === 'unavailable' && value.replenishment.leadTimeDays === null &&
      value.replenishment.cutoffAt === null && value.replenishment.leadTimePolicyVerified === false &&
      value.replenishment.cutoffPolicyVerified === false &&
      value.replenishment.supplierAvailabilityVerified === false &&
      value.replenishment.purchaseAuthorityVerified === false &&
      value.replenishment.reason === 'replenishment_policy_unavailable' &&
      exact(value.reorder, ['state', 'reorderAt', 'reason']) && value.reorder.state === 'unavailable' &&
      value.reorder.reorderAt === null &&
      value.reorder.reason === 'inventory_receipts_and_replenishment_unavailable' &&
      exact(value.stockoutRisk, ['state', 'risk', 'shortageQuantity', 'reason']) &&
      value.stockoutRisk.state === 'unavailable' && value.stockoutRisk.risk === null &&
      value.stockoutRisk.shortageQuantity === null &&
      value.stockoutRisk.reason === 'inventory_receipts_and_replenishment_unavailable' &&
      exact(value.purchasingRisk, ['state', 'risk', 'reason']) &&
      value.purchasingRisk.state === 'unavailable' && value.purchasingRisk.risk === null &&
      value.purchasingRisk.reason === 'supplier_and_purchase_authority_unavailable';
  }
  function materialGroup(value, sources, seen) {
    if (!exact(value, ['identity', 'unit', 'plannedWindow', 'baseQuantity', 'wasteQuantity',
      'plannedQuantity', 'components']) ||
        !exact(value.identity, ['materialLabel', 'materialSpecification', 'procurementLocation']) ||
        !text(value.identity.materialLabel) || !text(value.identity.materialSpecification) ||
        !text(value.identity.procurementLocation) || MATERIAL_UNITS.indexOf(value.unit) < 0 ||
        !validPlannedWindow(value.plannedWindow, false) || !dense(value.components, 10000) ||
        value.components.length < 1) return false;
    var base = 0n; var waste = 0n; var planned = 0n;
    for (var index = 0; index < value.components.length; index += 1) {
      var item = value.components[index];
      if (!exact(item, ['sourceIndex', 'lineId', 'baseQuantity', 'wasteQuantity',
        'plannedQuantity']) || !integer(item.sourceIndex, 499) || item.sourceIndex >= sources.length ||
          !uuid(item.lineId) || seen.has(item.sourceIndex + ':' + item.lineId.toLowerCase())) return false;
      var itemBase = micro(item.baseQuantity); var itemWaste = micro(item.wasteQuantity);
      var itemPlanned = micro(item.plannedQuantity);
      if (itemBase === null || itemWaste === null || itemPlanned === null || itemBase <= 0n ||
          itemBase + itemWaste !== itemPlanned ||
          sources[item.sourceIndex].job.plannedWindow.startsAt !== value.plannedWindow.startsAt ||
          sources[item.sourceIndex].job.plannedWindow.endsAt !== value.plannedWindow.endsAt) return false;
      seen.add(item.sourceIndex + ':' + item.lineId.toLowerCase());
      base += itemBase; waste += itemWaste; planned += itemPlanned;
    }
    return micro(value.baseQuantity) === base && micro(value.wasteQuantity) === waste &&
      micro(value.plannedQuantity) === planned && (value.unit !== 'ea' || planned % 1000000n === 0n);
  }
  function validateMaterial(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'sourceAsOf', 'horizon',
      'scope', 'sourceCoverage', 'sources', 'demand', 'inventory', 'futureReceipts',
      'replenishment', 'reorder', 'stockoutRisk', 'purchasingRisk', 'learnedOutcomes', 'evidence',
      'run', 'forecastIssued', 'demandForecastIssued', 'reorderForecastIssued',
      'stockoutForecastIssued', 'purchasingRiskForecastIssued', 'calibratedRangeIssued',
      'probabilityIssued', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-material-demand-risk-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || !instant(value.sourceAsOf) ||
        !validHorizon(value.horizon, value.checkedAt, value.state) || !validScope(value.scope) ||
        !materialBoundary(value) ||
        !exact(value.learnedOutcomes, ['state', 'applicableValueCount', 'applied', 'reason']) ||
        value.learnedOutcomes.applied !== false ||
        !exact(value.evidence, ['sourceAuthenticatedDemand', 'currentAdoptedCompositionVerified',
          'currentnessVerified', 'compatibleUnitsVerified', 'periodAttributionVerified',
          'inventoryVerified', 'futureReceiptsVerified', 'replenishmentPolicyVerified',
          'supplierAvailabilityVerified', 'purchaseAuthorityVerified', 'm25AdjustmentApplied']) ||
        [value.evidence.inventoryVerified, value.evidence.futureReceiptsVerified,
          value.evidence.replenishmentPolicyVerified, value.evidence.supplierAvailabilityVerified,
          value.evidence.purchaseAuthorityVerified, value.evidence.m25AdjustmentApplied]
          .some(function (flag) { return flag !== false; }) ||
        value.reorderForecastIssued !== false || value.stockoutForecastIssued !== false ||
        value.purchasingRiskForecastIssued !== false || value.calibratedRangeIssued !== false ||
        value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return MATERIAL_REASONS.indexOf(value.reason) >= 0 && value.sources === null &&
        unavailableCoverage(value.sourceCoverage,
          ['state', 'completeAsOf', 'hasMore', 'currentBookedPositionCount', 'scheduledJobCount',
            'unscheduledJobCount', 'outsideWindowCount', 'materialRevisionCount',
            'componentLineCount', 'reason'], value.reason) &&
        exact(value.demand, ['state', 'groupCount', 'componentCount', 'groups', 'reason']) &&
        value.demand.state === 'unavailable' && value.demand.groupCount === null &&
        value.demand.componentCount === null && value.demand.groups === null &&
        value.demand.reason === value.reason &&
        learned(value.learnedOutcomes, 'unavailable', null, value.reason) &&
        Object.values(value.evidence).every(function (flag) { return flag === false; }) &&
        value.forecastIssued === false &&
        value.demandForecastIssued === false && validRun(value.run,
          'm26-material-demand-risk-calculation-v1', false) ? value : null;
    }
    if (value.reason !== null || !dense(value.sources, 500) ||
        !value.sources.every(materialSource) || !exact(value.sourceCoverage,
          ['state', 'completeAsOf', 'hasMore', 'currentBookedPositionCount', 'scheduledJobCount',
            'unscheduledJobCount', 'outsideWindowCount', 'materialRevisionCount',
            'componentLineCount', 'reason']) || value.sourceCoverage.state !== 'complete_as_of' ||
        value.sourceCoverage.completeAsOf !== true || value.sourceCoverage.hasMore !== false ||
        ![value.sourceCoverage.currentBookedPositionCount, value.sourceCoverage.scheduledJobCount,
          value.sourceCoverage.unscheduledJobCount, value.sourceCoverage.outsideWindowCount,
          value.sourceCoverage.materialRevisionCount, value.sourceCoverage.componentLineCount]
          .every(function (count) { return integer(count, 10000); }) ||
        value.sourceCoverage.currentBookedPositionCount !==
          value.sourceCoverage.scheduledJobCount + value.sourceCoverage.outsideWindowCount ||
        value.sourceCoverage.unscheduledJobCount !== 0 || value.sourceCoverage.reason !== null ||
        value.sourceCoverage.scheduledJobCount !== value.sources.length ||
        value.sourceCoverage.materialRevisionCount !== value.sources.length ||
        !exact(value.demand, ['state', 'groupCount', 'componentCount', 'groups', 'reason']) ||
        value.demand.state !== 'current' || value.demand.reason !== null ||
        !dense(value.demand.groups, 10000) || value.demand.groupCount !== value.demand.groups.length ||
        value.demand.componentCount !== value.sourceCoverage.componentLineCount ||
        !learned(value.learnedOutcomes, 'none_current', 0,
          'no_compatible_current_owner_adopted_material_value') ||
        [value.evidence.sourceAuthenticatedDemand, value.evidence.currentAdoptedCompositionVerified,
          value.evidence.currentnessVerified, value.evidence.compatibleUnitsVerified,
          value.evidence.periodAttributionVerified].some(function (flag) { return flag !== true; }) ||
        !validRun(value.run, 'm26-material-demand-risk-calculation-v1', true) ||
        value.forecastIssued !== true || value.demandForecastIssued !== true) return null;
    var seen = new Set();
    return value.demand.groups.every(function (group) { return materialGroup(group, value.sources, seen); }) &&
      seen.size === value.demand.componentCount ? value : null;
  }

  function assetSource(value, index, horizon) {
    if (!exact(value, ['sourceIndex', 'job', 'estimate', 'composition', 'equipmentCostPlan',
      'equipmentPlan', 'readinessPlan']) ||
        !validSourceCommon(value, index, true, 'asset', horizon)) return false;
    var versions = { equipmentCostPlan: 'estimate-equipment-cost-plan-v1',
      equipmentPlan: 'estimate-equipment-plan-v1', readinessPlan: 'estimate-equipment-readiness-v1' };
    return ['equipmentCostPlan', 'equipmentPlan', 'readinessPlan'].every(function (key) {
      var plan = value[key]; var keys = key === 'readinessPlan' ?
        ['id', 'revision', 'digest', 'calculationVersion', 'evidenceDigest'] :
        ['id', 'revision', 'digest', 'calculationVersion'];
      return exact(plan, keys) && uuid(plan.id) && Number.isSafeInteger(plan.revision) &&
        plan.revision >= 1 && digest(plan.digest) && plan.calculationVersion === versions[key] &&
        (key !== 'readinessPlan' || digest(plan.evidenceDigest));
    });
  }
  function unavailableAssetPosition(value, keys, reason) {
    return exact(value, keys) && value.state === 'unavailable' && value.reason === reason;
  }
  function assetItem(value, sources, sourceAsOf, seenAssets, seenUses) {
    if (!exact(value, ['asset', 'plannedUtilization', 'meter', 'serviceInterval', 'maintenanceDue',
      'serviceTiming', 'currentReadiness', 'rentalLease', 'downtimeRisk']) ||
        !exact(value.asset, ['id', 'version', 'digest', 'category', 'accessType', 'planAccessBasis']) ||
        !uuid(value.asset.id) || seenAssets.has(value.asset.id.toLowerCase()) ||
        !Number.isSafeInteger(value.asset.version) || value.asset.version < 1 || !digest(value.asset.digest) ||
        !['vehicle', 'equipment', 'tool', 'trailer', 'attachment', 'other'].includes(value.asset.category) ||
        !['owned', 'leased', 'rented', 'borrowed', 'unknown'].includes(value.asset.accessType) ||
        !['unknown', 'owned', 'rented', 'financed'].includes(value.asset.planAccessBasis)) return false;
    seenAssets.add(value.asset.id.toLowerCase());
    var plan = value.plannedUtilization;
    if (!exact(plan, ['state', 'claimedOperatingHours', 'useCount', 'uses',
      'operatingTimeVerified', 'checkoutDurationUsed', 'reason']) ||
        !integer(plan.useCount, 10000) || plan.useCount < 1 || !dense(plan.uses, 10000) ||
        plan.useCount !== plan.uses.length || plan.operatingTimeVerified !== false ||
        plan.checkoutDurationUsed !== false) return false;
    var total = 0n;
    for (var useIndex = 0; useIndex < plan.uses.length; useIndex += 1) {
      var planUse = plan.uses[useIndex];
      if (!exact(planUse, ['sourceIndex', 'lineId', 'plannedWindow', 'claimedOperatingHours']) ||
          !integer(planUse.sourceIndex, 499) || planUse.sourceIndex >= sources.length ||
          !uuid(planUse.lineId) || !validPlannedWindow(planUse.plannedWindow, false) ||
          sources[planUse.sourceIndex].job.plannedWindow.startsAt !== planUse.plannedWindow.startsAt ||
          sources[planUse.sourceIndex].job.plannedWindow.endsAt !== planUse.plannedWindow.endsAt ||
          !number(planUse.claimedOperatingHours) || micro(planUse.claimedOperatingHours) <= 0n ||
          seenUses.has(planUse.sourceIndex + ':' + planUse.lineId.toLowerCase())) return false;
      seenUses.add(planUse.sourceIndex + ':' + planUse.lineId.toLowerCase());
      total += micro(planUse.claimedOperatingHours);
    }
    if (plan.state === 'current_claimed_plan_only') {
      if (!number(plan.claimedOperatingHours) || plan.reason !== null ||
          micro(plan.claimedOperatingHours) !== total) return false;
    } else if (plan.state !== 'unavailable' || plan.claimedOperatingHours !== null ||
        !['non_overlapping_planned_utilization_unavailable',
          'rental_or_lease_provider_evidence_unavailable'].includes(plan.reason)) return false;
    var meter = value.meter;
    if (!exact(meter, ['state', 'meterKey', 'unit', 'reading', 'observedAt', 'eventId',
      'eventRevision', 'eventDigest', 'ledgerRevision', 'ledgerDigest', 'resetApplied',
      'correctionApplied', 'historyComplete', 'reason']) ||
        !['current_as_of_source', 'unavailable'].includes(meter.state)) return false;
    if (meter.state === 'current_as_of_source') {
      if (!text(meter.meterKey, 80) || meter.unit !== 'hours' || !number(meter.reading) ||
          !instant(meter.observedAt) || meter.observedAt > sourceAsOf || !uuid(meter.eventId) ||
          !Number.isSafeInteger(meter.eventRevision) ||
          meter.eventRevision < 1 || !digest(meter.eventDigest) ||
          !Number.isSafeInteger(meter.ledgerRevision) || meter.ledgerRevision < meter.eventRevision ||
          !digest(meter.ledgerDigest) || typeof meter.resetApplied !== 'boolean' ||
          typeof meter.correctionApplied !== 'boolean' || meter.historyComplete !== true ||
          meter.reason !== null) return false;
    } else if (!((meter.meterKey === null || text(meter.meterKey, 80)) &&
        (meter.unit === null || text(meter.unit, 40))) || meter.reading !== null ||
        meter.observedAt !== null || meter.eventId !== null || meter.eventRevision !== null ||
        meter.eventDigest !== null ||
        !(meter.ledgerRevision === null || Number.isSafeInteger(meter.ledgerRevision) && meter.ledgerRevision >= 1) ||
        !(meter.ledgerDigest === null || digest(meter.ledgerDigest)) ||
        (meter.ledgerRevision === null) !== (meter.ledgerDigest === null) ||
        meter.resetApplied !== null || meter.correctionApplied !== null ||
        meter.historyComplete !== false || !text(meter.reason)) return false;
    var service = value.serviceInterval;
    if (!exact(service, ['state', 'meterKey', 'unit', 'threshold', 'thresholdReference',
      'currentReading', 'projectedReading', 'hoursRemainingAtStart', 'thresholdReachedNow',
      'thresholdReachedByClaimedPlan', 'verifiedServiceDate', 'reason']) ||
        !['current_claimed_plan_position', 'unavailable'].includes(service.state) ||
        service.verifiedServiceDate !== null) return false;
    if (service.state === 'current_claimed_plan_position') {
      var current = micro(service.currentReading); var projected = micro(service.projectedReading);
      var threshold = micro(service.threshold); var remaining = micro(service.hoursRemainingAtStart);
      if (meter.state !== 'current_as_of_source' || service.meterKey !== meter.meterKey ||
          service.unit !== 'hours' || !text(service.thresholdReference) ||
          [current, projected, threshold, remaining].some(function (item) { return item === null; }) ||
          current !== micro(meter.reading) || projected !== current + total ||
          remaining !== (threshold > current ? threshold - current : 0n) ||
          service.thresholdReachedNow !== (current >= threshold) ||
          service.thresholdReachedByClaimedPlan !== (projected >= threshold) || service.reason !== null) {
        return false;
      }
    } else if ([service.threshold, service.thresholdReference, service.currentReading,
      service.projectedReading, service.hoursRemainingAtStart, service.thresholdReachedNow,
      service.thresholdReachedByClaimedPlan].some(function (item) { return item !== null; }) ||
        !text(service.reason)) return false;
    if (!exact(value.maintenanceDue, ['state', 'dueAt', 'dueWithinHorizon', 'dueByRecordedMeter',
      'dueByClaimedPlanEnd', 'maintenanceScheduleVerified', 'maintenanceWorkAuthorized', 'reason']) ||
        value.maintenanceDue.state !== 'unavailable' || value.maintenanceDue.dueAt !== null ||
        value.maintenanceDue.dueWithinHorizon !== null || value.maintenanceDue.dueByRecordedMeter !== null ||
        value.maintenanceDue.dueByClaimedPlanEnd !== null ||
        value.maintenanceDue.maintenanceScheduleVerified !== false ||
        value.maintenanceDue.maintenanceWorkAuthorized !== false ||
        value.maintenanceDue.reason !== 'maintenance_schedule_unavailable' ||
        !exact(value.serviceTiming, ['state', 'serviceAt', 'reason']) ||
        value.serviceTiming.state !== 'unavailable' || value.serviceTiming.serviceAt !== null ||
        value.serviceTiming.reason !== 'operating_hour_timing_unavailable' ||
        !exact(value.currentReadiness, ['state', 'recordedDowntime', 'recordedFault',
          'sourceCondition', 'reason']) ||
        !['current_as_of_source', 'unavailable'].includes(value.currentReadiness.state) ||
        (value.currentReadiness.state === 'current_as_of_source' ?
          typeof value.currentReadiness.recordedDowntime !== 'boolean' ||
          typeof value.currentReadiness.recordedFault !== 'boolean' ||
          !['unknown', 'reported_no_problem', 'problem_reported', 'out_of_service']
            .includes(value.currentReadiness.sourceCondition) || value.currentReadiness.reason !== null :
          [value.currentReadiness.recordedDowntime, value.currentReadiness.recordedFault,
            value.currentReadiness.sourceCondition].some(function (item) { return item !== null; }) ||
          value.currentReadiness.reason !== 'complete_equipment_history_unavailable') ||
        !exact(value.rentalLease, ['state', 'assetAccessType', 'planAccessBasis',
          'providerAvailabilityVerified', 'providerMaintenanceVerified', 'reason']) ||
        !['owned_current', 'provider_semantics_unavailable'].includes(value.rentalLease.state) ||
        value.rentalLease.assetAccessType !== value.asset.accessType ||
        value.rentalLease.planAccessBasis !== value.asset.planAccessBasis ||
        value.rentalLease.providerAvailabilityVerified !== false ||
        value.rentalLease.providerMaintenanceVerified !== false ||
        (value.rentalLease.state === 'owned_current' ?
          value.asset.accessType !== 'owned' || value.asset.planAccessBasis !== 'owned' ||
          value.rentalLease.reason !== null :
          value.asset.accessType === 'owned' && value.asset.planAccessBasis === 'owned' ||
          value.rentalLease.reason !== 'rental_or_lease_provider_evidence_unavailable') ||
        !exact(value.downtimeRisk, ['state', 'risk', 'probability', 'reason']) ||
        value.downtimeRisk.state !== 'unavailable' || value.downtimeRisk.risk !== null ||
        value.downtimeRisk.probability !== null ||
        value.downtimeRisk.reason !== 'evaluated_downtime_risk_evidence_unavailable') return false;
    if (value.rentalLease.state === 'provider_semantics_unavailable' &&
        (plan.state !== 'unavailable' || service.state !== 'unavailable' ||
          plan.reason !== 'rental_or_lease_provider_evidence_unavailable' ||
          service.reason !== 'rental_or_lease_provider_evidence_unavailable')) return false;
    return true;
  }
  function validateAsset(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'sourceAsOf', 'horizon',
      'scope', 'sourceCoverage', 'sources', 'assets', 'utilization', 'learnedOutcomes', 'evidence',
      'run', 'forecastIssued', 'utilizationForecastIssued', 'serviceIntervalForecastIssued',
      'maintenanceDueForecastIssued', 'serviceTimingForecastIssued', 'downtimeRiskForecastIssued',
      'calibratedRangeIssued', 'probabilityIssued', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-asset-utilization-risk-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || !instant(value.sourceAsOf) ||
        !validHorizon(value.horizon, value.checkedAt, value.state) || !validScope(value.scope) ||
        !exact(value.evidence, ['sourceAuthenticatedUtilization', 'currentAdoptedEquipmentVerified',
          'currentReadinessVerified', 'currentnessVerified', 'compatibleUnitsVerified',
          'periodAttributionVerified', 'meterHistoryVerified', 'serviceThresholdPolicyVerified',
          'maintenanceScheduleVerified', 'rentalLeaseProviderEvidenceVerified', 'm25AdjustmentApplied',
          'evaluatedDowntimeRiskVerified']) || value.evidence.maintenanceScheduleVerified !== false ||
        !exact(value.learnedOutcomes, ['state', 'applicableValueCount', 'applied', 'reason']) ||
        value.learnedOutcomes.applied !== false ||
        value.evidence.rentalLeaseProviderEvidenceVerified !== false ||
        value.evidence.m25AdjustmentApplied !== false || value.evidence.evaluatedDowntimeRiskVerified !== false ||
        value.maintenanceDueForecastIssued !== false || value.serviceTimingForecastIssued !== false ||
        value.downtimeRiskForecastIssued !== false || value.calibratedRangeIssued !== false ||
        value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return ASSET_REASONS.indexOf(value.reason) >= 0 && value.sources === null && value.assets === null &&
        unavailableCoverage(value.sourceCoverage,
          ['state', 'completeAsOf', 'hasMore', 'currentBookedPositionCount', 'scheduledJobCount',
            'unscheduledJobCount', 'outsideWindowCount', 'equipmentRevisionCount',
            'readinessRevisionCount', 'plannedUseCount', 'assetCount', 'reason'], value.reason) &&
        exact(value.utilization, ['state', 'assetCount', 'useCount', 'claimedOperatingHours',
          'operatingTimeVerified', 'checkoutDurationUsed', 'reason']) &&
        value.utilization.state === 'unavailable' && value.utilization.assetCount === null &&
        value.utilization.useCount === null && value.utilization.claimedOperatingHours === null &&
        value.utilization.operatingTimeVerified === false &&
        value.utilization.checkoutDurationUsed === false && value.utilization.reason === value.reason &&
        learned(value.learnedOutcomes, 'unavailable', null, value.reason) &&
        Object.values(value.evidence).every(function (flag) { return flag === false; }) &&
        value.forecastIssued === false && value.utilizationForecastIssued === false &&
        value.serviceIntervalForecastIssued === false && validRun(value.run,
          'm26-asset-utilization-risk-calculation-v1', false) ? value : null;
    }
    if (value.reason !== null || !dense(value.sources, 500) || !dense(value.assets, 10000) ||
        !value.sources.every(function (source, index) { return assetSource(source, index, value.horizon); }) ||
        !exact(value.sourceCoverage,
          ['state', 'completeAsOf', 'hasMore', 'currentBookedPositionCount', 'scheduledJobCount',
            'unscheduledJobCount', 'outsideWindowCount', 'equipmentRevisionCount',
            'readinessRevisionCount', 'plannedUseCount', 'assetCount', 'reason']) ||
        value.sourceCoverage.state !== 'complete_as_of' || value.sourceCoverage.completeAsOf !== true ||
        value.sourceCoverage.hasMore !== false || value.sourceCoverage.unscheduledJobCount !== 0 ||
        ![value.sourceCoverage.currentBookedPositionCount, value.sourceCoverage.scheduledJobCount,
          value.sourceCoverage.unscheduledJobCount, value.sourceCoverage.outsideWindowCount,
          value.sourceCoverage.equipmentRevisionCount, value.sourceCoverage.readinessRevisionCount,
          value.sourceCoverage.plannedUseCount, value.sourceCoverage.assetCount]
          .every(function (count) { return integer(count, 10000); }) ||
        value.sourceCoverage.currentBookedPositionCount !==
          value.sourceCoverage.scheduledJobCount + value.sourceCoverage.outsideWindowCount ||
        value.sourceCoverage.reason !== null || value.sourceCoverage.scheduledJobCount !== value.sources.length ||
        value.sourceCoverage.equipmentRevisionCount !== value.sources.length ||
        value.sourceCoverage.readinessRevisionCount !== value.sources.length ||
        value.sourceCoverage.assetCount !== value.assets.length ||
        !learned(value.learnedOutcomes, 'none_current', 0,
          'no_compatible_current_owner_adopted_operating_hour_value') ||
        !exact(value.utilization, ['state', 'assetCount', 'useCount', 'claimedOperatingHours',
          'operatingTimeVerified', 'checkoutDurationUsed', 'reason']) ||
        value.utilization.assetCount !== value.assets.length || value.utilization.operatingTimeVerified !== false ||
        value.utilization.checkoutDurationUsed !== false ||
        [value.evidence.sourceAuthenticatedUtilization, value.evidence.currentAdoptedEquipmentVerified,
          value.evidence.currentReadinessVerified, value.evidence.currentnessVerified,
          value.evidence.compatibleUnitsVerified, value.evidence.periodAttributionVerified]
          .some(function (flag) { return flag !== true; }) ||
        !validRun(value.run, 'm26-asset-utilization-risk-calculation-v1', true)) return null;
    var seenAssets = new Set(); var seenUses = new Set();
    if (!value.assets.every(function (asset) {
      return assetItem(asset, value.sources, value.sourceAsOf, seenAssets, seenUses);
    }) ||
        value.sourceCoverage.plannedUseCount !== seenUses.size || value.utilization.useCount !== seenUses.size) return null;
    var utilizationTotal = value.assets.reduce(function (sum, asset) {
      return sum + asset.plannedUtilization.uses.reduce(function (nested, use) {
        return nested + micro(use.claimedOperatingHours);
      }, 0n);
    }, 0n);
    var issued = value.assets.every(function (asset) {
      return asset.plannedUtilization.state === 'current_claimed_plan_only';
    });
    if (issued && (value.utilization.state !== 'current_claimed_plan_only' ||
        !number(value.utilization.claimedOperatingHours) ||
        micro(value.utilization.claimedOperatingHours) !== utilizationTotal ||
        value.utilization.reason !== null ||
        value.forecastIssued !== true || value.utilizationForecastIssued !== true)) return null;
    if (!issued && (value.utilization.state !== 'unavailable' ||
        value.utilization.claimedOperatingHours !== null || value.forecastIssued !== false ||
        value.utilizationForecastIssued !== false)) return null;
    var allService = value.assets.length > 0 && value.assets.every(function (asset) {
      return asset.serviceInterval.state === 'current_claimed_plan_position';
    });
    return value.serviceIntervalForecastIssued === allService &&
      value.maintenanceDueForecastIssued === false &&
      value.evidence.meterHistoryVerified === allService &&
      value.evidence.serviceThresholdPolicyVerified === allService ? value : null;
  }

  function routeSource(value, index, horizon) {
    return exact(value, ['sourceIndex', 'job', 'estimate', 'composition', 'travelPlan']) &&
      validSourceCommon(value, index, true, 'route', horizon) &&
      exact(value.travelPlan, ['id', 'revision', 'digest', 'calculationVersion', 'sourceDigest',
        'assessmentDigest', 'assessedThrough']) && uuid(value.travelPlan.id) &&
      Number.isSafeInteger(value.travelPlan.revision) && value.travelPlan.revision >= 1 &&
      digest(value.travelPlan.digest) && digest(value.travelPlan.sourceDigest) &&
      digest(value.travelPlan.assessmentDigest) && DATE.test(value.travelPlan.assessedThrough || '') &&
      value.travelPlan.calculationVersion === 'estimate-travel-plan-v1';
  }
  function routeItem(value, sources, seen) {
    if (!exact(value, ['sourceIndex', 'tripId', 'route', 'movement', 'resource', 'declaredDistance',
      'verifiedRoadMileage', 'routeTiming', 'fuelEnergy', 'capacity']) ||
        !integer(value.sourceIndex, 499) || value.sourceIndex >= sources.length || !uuid(value.tripId) ||
        seen.has(value.sourceIndex + ':' + value.tripId.toLowerCase()) ||
        !exact(value.route, ['originDigest', 'destinationDigest', 'direction', 'returnIncluded']) ||
        !digest(value.route.originDigest) || !digest(value.route.destinationDigest) ||
        value.route.direction !== 'origin_to_destination' ||
        typeof value.route.returnIncluded !== 'boolean' ||
        !exact(value.movement, ['state', 'class', 'roadTransportationVerified',
          'onsiteEquipmentMovementVerified', 'reason']) || value.movement.state !== 'unavailable' ||
        value.movement.class !== null || value.movement.roadTransportationVerified !== false ||
        value.movement.onsiteEquipmentMovementVerified !== false ||
        value.movement.reason !== 'movement_class_unavailable' ||
        !exact(value.resource, ['state', 'assetId', 'kind', 'accessType',
          'providerSemanticsVerified', 'reason']) || value.resource.state !== 'unavailable' ||
        value.resource.assetId !== null || value.resource.kind !== null || value.resource.accessType !== null ||
        value.resource.providerSemanticsVerified !== false ||
        value.resource.reason !== 'resource_identity_unavailable' ||
        !exact(value.declaredDistance, ['state', 'oneWayQuantity', 'unit', 'basis', 'tripCount',
          'vehicleCount', 'tripLegs', 'vehicleLegs', 'totalVehicleLegDistance',
          'sourceAuthenticated', 'reason']) ||
        value.declaredDistance.state !== 'current_claimed_plan_only' ||
        !number(value.declaredDistance.oneWayQuantity) || !['mi', 'km'].includes(value.declaredDistance.unit) ||
        !['estimated', 'reported'].includes(value.declaredDistance.basis) ||
        !integer(value.declaredDistance.tripCount, 6000) || value.declaredDistance.tripCount < 1 ||
        !integer(value.declaredDistance.vehicleCount, 6000) || value.declaredDistance.vehicleCount < 1 ||
        !integer(value.declaredDistance.tripLegs, 24000) || value.declaredDistance.tripLegs < 1 ||
        !integer(value.declaredDistance.vehicleLegs, 24000) || value.declaredDistance.vehicleLegs < 1 ||
        value.declaredDistance.tripLegs !== value.declaredDistance.tripCount *
          (value.route.returnIncluded ? 2 : 1) ||
        value.declaredDistance.vehicleLegs !== value.declaredDistance.tripLegs *
          value.declaredDistance.vehicleCount ||
        !number(value.declaredDistance.totalVehicleLegDistance) ||
        micro(value.declaredDistance.totalVehicleLegDistance) !==
          micro(value.declaredDistance.oneWayQuantity) * BigInt(value.declaredDistance.vehicleLegs) ||
        value.declaredDistance.sourceAuthenticated !== true || value.declaredDistance.reason !== null ||
        !unavailablePosition(value.verifiedRoadMileage, 'verified_road_route_unavailable') ||
        !unavailablePosition(value.routeTiming, 'verified_route_timing_unavailable') ||
        !unavailablePosition(value.fuelEnergy, 'independent_consumption_evidence_unavailable') ||
        !unavailablePosition(value.capacity, 'resource_capacity_and_load_evidence_unavailable')) return false;
    seen.add(value.sourceIndex + ':' + value.tripId.toLowerCase()); return true;
  }
  function validateRoute(value) {
    var keys = ['version', 'state', 'reason', 'fictional', 'checkedAt', 'sourceAsOf', 'horizon',
      'scope', 'sourceCoverage', 'sources', 'routes', 'declaredRouteLoad', 'verifiedRoadMileage',
      'routeTiming', 'fuelEnergy', 'logisticsCapacityRisk', 'learnedOutcomes', 'evidence', 'run',
      'forecastIssued', 'declaredRouteLoadForecastIssued', 'roadMileageForecastIssued',
      'routeTimingForecastIssued', 'fuelEnergyForecastIssued', 'logisticsCapacityRiskForecastIssued',
      'calibratedRangeIssued', 'probabilityIssued', 'automaticActionAuthorized'];
    if (!exact(value, keys) || value.version !== 'm26-route-load-risk-forecast-v1' ||
        ['current', 'unavailable'].indexOf(value.state) < 0 || typeof value.fictional !== 'boolean' ||
        !instant(value.checkedAt) || !instant(value.sourceAsOf) ||
        !validHorizon(value.horizon, value.checkedAt, value.state) || !validScope(value.scope) ||
        !exact(value.evidence, ['sourceAuthenticatedDeclaredDistance', 'currentAdoptedTravelVerified',
          'currentnessVerified', 'compatibleUnitsVerified', 'periodAttributionVerified',
          'movementClassVerified', 'verifiedRoadRouting', 'resourceIdentityVerified',
          'independentConsumptionEvidenceVerified', 'capacityLoadEvidenceVerified',
          'rentalLeaseProviderEvidenceVerified', 'm25AdjustmentApplied']) ||
        !exact(value.learnedOutcomes, ['state', 'applicableValueCount', 'applied', 'reason']) ||
        value.learnedOutcomes.applied !== false ||
        [value.evidence.movementClassVerified, value.evidence.verifiedRoadRouting,
          value.evidence.resourceIdentityVerified, value.evidence.independentConsumptionEvidenceVerified,
          value.evidence.capacityLoadEvidenceVerified, value.evidence.rentalLeaseProviderEvidenceVerified,
          value.evidence.m25AdjustmentApplied].some(function (flag) { return flag !== false; }) ||
        value.roadMileageForecastIssued !== false || value.routeTimingForecastIssued !== false ||
        value.fuelEnergyForecastIssued !== false || value.logisticsCapacityRiskForecastIssued !== false ||
        value.calibratedRangeIssued !== false || value.probabilityIssued !== false ||
        value.automaticActionAuthorized !== false) return null;
    if (value.state === 'unavailable') {
      return ROUTE_REASONS.indexOf(value.reason) >= 0 && value.sources === null && value.routes === null &&
        unavailableCoverage(value.sourceCoverage,
          ['state', 'completeAsOf', 'hasMore', 'currentBookedPositionCount', 'scheduledJobCount',
            'unscheduledJobCount', 'outsideWindowCount', 'travelRevisionCount',
            'routeLineCount', 'reason'], value.reason) &&
        exact(value.declaredRouteLoad, ['state', 'routeLineCount', 'tripLegs', 'vehicleLegs',
          'declaredVehicleMiles', 'declaredVehicleKilometres', 'reason']) &&
        value.declaredRouteLoad.state === 'unavailable' && value.declaredRouteLoad.reason === value.reason &&
        Object.keys(value.declaredRouteLoad).every(function (key) {
          return ['state', 'reason'].includes(key) || value.declaredRouteLoad[key] === null;
        }) && unavailablePosition(value.verifiedRoadMileage, value.reason) &&
        unavailablePosition(value.routeTiming, value.reason) &&
        unavailablePosition(value.fuelEnergy, value.reason) &&
        unavailablePosition(value.logisticsCapacityRisk, value.reason) &&
        learned(value.learnedOutcomes, 'unavailable', null, value.reason) &&
        Object.values(value.evidence).every(function (flag) { return flag === false; }) &&
        value.forecastIssued === false && value.declaredRouteLoadForecastIssued === false &&
        validRun(value.run, 'm26-route-load-risk-calculation-v1', false) ? value : null;
    }
    if (value.reason !== null || !dense(value.sources, 500) || !dense(value.routes, 6000) ||
        !value.sources.every(function (source, index) { return routeSource(source, index, value.horizon); }) ||
        !exact(value.sourceCoverage,
          ['state', 'completeAsOf', 'hasMore', 'currentBookedPositionCount', 'scheduledJobCount',
            'unscheduledJobCount', 'outsideWindowCount', 'travelRevisionCount', 'routeLineCount', 'reason']) ||
        value.sourceCoverage.state !== 'complete_as_of' || value.sourceCoverage.completeAsOf !== true ||
        value.sourceCoverage.hasMore !== false || value.sourceCoverage.unscheduledJobCount !== 0 ||
        ![value.sourceCoverage.currentBookedPositionCount, value.sourceCoverage.scheduledJobCount,
          value.sourceCoverage.unscheduledJobCount, value.sourceCoverage.outsideWindowCount,
          value.sourceCoverage.travelRevisionCount, value.sourceCoverage.routeLineCount]
          .every(function (count) { return integer(count, 6000); }) ||
        value.sourceCoverage.currentBookedPositionCount !==
          value.sourceCoverage.scheduledJobCount + value.sourceCoverage.outsideWindowCount ||
        value.sourceCoverage.reason !== null || value.sourceCoverage.scheduledJobCount !== value.sources.length ||
        value.sourceCoverage.travelRevisionCount !== value.sources.length ||
        value.sourceCoverage.routeLineCount !== value.routes.length ||
        new Set(value.sources.map(function (source) { return source.estimate.id.toLowerCase(); })).size !==
          value.sources.length ||
        !exact(value.declaredRouteLoad, ['state', 'routeLineCount', 'tripLegs', 'vehicleLegs',
          'declaredVehicleMiles', 'declaredVehicleKilometres', 'reason']) ||
        value.declaredRouteLoad.state !== 'current_claimed_plan_only' ||
        value.declaredRouteLoad.routeLineCount !== value.routes.length ||
        !integer(value.declaredRouteLoad.tripLegs, 24000) ||
        !integer(value.declaredRouteLoad.vehicleLegs, 24000) ||
        !number(value.declaredRouteLoad.declaredVehicleMiles) ||
        !number(value.declaredRouteLoad.declaredVehicleKilometres) ||
        value.declaredRouteLoad.reason !== null ||
        !unavailablePosition(value.verifiedRoadMileage, 'verified_road_route_unavailable') ||
        !unavailablePosition(value.routeTiming, 'verified_route_timing_unavailable') ||
        !unavailablePosition(value.fuelEnergy, 'independent_consumption_evidence_unavailable') ||
        !unavailablePosition(value.logisticsCapacityRisk,
          'resource_capacity_and_load_evidence_unavailable') ||
        !learned(value.learnedOutcomes, 'none_current', 0,
          'no_compatible_current_owner_adopted_route_value') ||
        [value.evidence.sourceAuthenticatedDeclaredDistance, value.evidence.currentAdoptedTravelVerified,
          value.evidence.currentnessVerified, value.evidence.compatibleUnitsVerified,
          value.evidence.periodAttributionVerified].some(function (flag) { return flag !== true; }) ||
        !validRun(value.run, 'm26-route-load-risk-calculation-v1', true) ||
        value.forecastIssued !== true || value.declaredRouteLoadForecastIssued !== true) return null;
    var seen = new Set();
    if (!value.routes.every(function (route) { return routeItem(route, value.sources, seen); })) return null;
    var miles = 0n; var kilometres = 0n; var tripLegs = 0; var vehicleLegs = 0;
    value.routes.forEach(function (route) {
      tripLegs += route.declaredDistance.tripLegs; vehicleLegs += route.declaredDistance.vehicleLegs;
      if (route.declaredDistance.unit === 'mi') miles += micro(route.declaredDistance.totalVehicleLegDistance);
      else kilometres += micro(route.declaredDistance.totalVehicleLegDistance);
    });
    return micro(value.declaredRouteLoad.declaredVehicleMiles) === miles &&
      micro(value.declaredRouteLoad.declaredVehicleKilometres) === kilometres &&
      value.declaredRouteLoad.tripLegs === tripLegs &&
      value.declaredRouteLoad.vehicleLegs === vehicleLegs ? value : null;
  }

  function fixedUuid(index) {
    return '10000000-0000-4000-8000-' + String(index).padStart(12, '0');
  }
  function unavailablePositionValue(reason) {
    return { state: 'unavailable', value: null, unit: null, reason: reason };
  }
  function demoBundle() {
    var checkedAt = '2026-10-08T12:00:00.000Z';
    var horizon = { kind: 'next_30_elapsed_days', timeZone: 'America/New_York', startsAt: checkedAt,
      endsAt: '2026-11-07T12:00:00.000Z', startsOn: '2026-10-08', endsOnExclusive: '2026-11-07' };
    var plannedWindow = { startsAt: '2026-10-10T13:00:00.000Z',
      endsAt: '2026-10-10T17:00:00.000Z' };
    var material = {
      version: 'm26-material-demand-risk-forecast-v1', state: 'current', reason: null,
      fictional: true, checkedAt: checkedAt, sourceAsOf: '2026-10-08T12:00:01.000Z',
      horizon: Object.assign({}, horizon), scope: { label: 'Authenticated owner-confirmed scheduled backlog',
        wholeBusinessCoverageVerified: false, offPlatformCoverageVerified: false },
      sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
        currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
        outsideWindowCount: 0, materialRevisionCount: 1, componentLineCount: 2, reason: null },
      sources: [{ sourceIndex: 0, job: { appointmentId: fixedUuid(1), assignmentId: fixedUuid(2),
        bookingReviewId: fixedUuid(3), bookingConfirmationId: fixedUuid(4),
        issuedVersionId: fixedUuid(5), plannedWindow: Object.assign({}, plannedWindow) },
      estimate: { id: fixedUuid(6), revisionId: fixedUuid(7), revision: 7, digest: 'a'.repeat(64) },
      composition: { id: fixedUuid(8), revision: 3, digest: 'b'.repeat(64),
        calculationVersion: 'estimate-cost-adoption-v3', componentManifest: {}, coverageAssessment: {} },
      materialPlan: { id: fixedUuid(9), revision: 2, digest: 'c'.repeat(64),
        calculationVersion: 'estimate-material-plan-v4' } }],
      demand: { state: 'current', groupCount: 2, componentCount: 2, groups: [
        { identity: { materialLabel: 'Cedar boards', materialSpecification: 'cedar',
          procurementLocation: 'Fictional yard' }, unit: 'ft', plannedWindow: Object.assign({}, plannedWindow),
        baseQuantity: '100', wasteQuantity: '10', plannedQuantity: '110', components: [
          { sourceIndex: 0, lineId: fixedUuid(10), baseQuantity: '100', wasteQuantity: '10',
            plannedQuantity: '110' }] },
        { identity: { materialLabel: 'Exterior fasteners', materialSpecification: 'stainless',
          procurementLocation: 'Fictional yard' }, unit: 'ea', plannedWindow: Object.assign({}, plannedWindow),
        baseQuantity: '24', wasteQuantity: '0', plannedQuantity: '24', components: [
          { sourceIndex: 0, lineId: fixedUuid(11), baseQuantity: '24', wasteQuantity: '0',
            plannedQuantity: '24' }] }], reason: null },
      inventory: { state: 'unavailable', onHand: null, compatibleStockIdentityVerified: false,
        transactionCoverageVerified: false, receiptSemanticsVerified: false, m23UsageApplied: false,
        reason: 'source_owned_inventory_ledger_unavailable' },
      futureReceipts: { state: 'unavailable', quantity: null, receiptDatesVerified: false,
        reason: 'future_receipts_unavailable' },
      replenishment: { state: 'unavailable', leadTimeDays: null, cutoffAt: null,
        leadTimePolicyVerified: false, cutoffPolicyVerified: false,
        supplierAvailabilityVerified: false, purchaseAuthorityVerified: false,
        reason: 'replenishment_policy_unavailable' },
      reorder: { state: 'unavailable', reorderAt: null,
        reason: 'inventory_receipts_and_replenishment_unavailable' },
      stockoutRisk: { state: 'unavailable', risk: null, shortageQuantity: null,
        reason: 'inventory_receipts_and_replenishment_unavailable' },
      purchasingRisk: { state: 'unavailable', risk: null,
        reason: 'supplier_and_purchase_authority_unavailable' },
      learnedOutcomes: { state: 'none_current', applicableValueCount: 0, applied: false,
        reason: 'no_compatible_current_owner_adopted_material_value' },
      evidence: { sourceAuthenticatedDemand: true, currentAdoptedCompositionVerified: true,
        currentnessVerified: true, compatibleUnitsVerified: true, periodAttributionVerified: true,
        inventoryVerified: false, futureReceiptsVerified: false, replenishmentPolicyVerified: false,
        supplierAvailabilityVerified: false, purchaseAuthorityVerified: false, m25AdjustmentApplied: false },
      run: { calculationVersion: 'm26-material-demand-risk-calculation-v1',
        sourceDigest: 'd'.repeat(64), digest: 'e'.repeat(64) },
      forecastIssued: true, demandForecastIssued: true, reorderForecastIssued: false,
      stockoutForecastIssued: false, purchasingRiskForecastIssued: false,
      calibratedRangeIssued: false, probabilityIssued: false, automaticActionAuthorized: false,
    };
    var authorityWindow = Object.assign({}, plannedWindow, { timeZone: 'America/New_York',
      assignmentRevision: 3, assignmentDigest: 'f'.repeat(64), approvalId: fixedUuid(12),
      timeZoneAuthority: { profileHash: '1'.repeat(64), profileId: fixedUuid(13),
        profileVersion: 2, timeZone: 'America/New_York', evaluatedAt: '2026-10-08T11:59:00.000Z' },
      timeEvidenceDigest: '2'.repeat(64) });
    var asset = {
      version: 'm26-asset-utilization-risk-forecast-v1', state: 'current', reason: null,
      fictional: true, checkedAt: checkedAt, sourceAsOf: '2026-10-08T12:00:02.000Z',
      horizon: Object.assign({}, horizon), scope: Object.assign({}, material.scope),
      sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
        currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
        outsideWindowCount: 0, equipmentRevisionCount: 1, readinessRevisionCount: 1,
        plannedUseCount: 1, assetCount: 1, reason: null },
      sources: [{ sourceIndex: 0, job: { appointmentId: fixedUuid(14), assignmentId: fixedUuid(15),
        bookingReviewId: fixedUuid(16), bookingConfirmationId: fixedUuid(17),
        issuedVersionId: fixedUuid(18), plannedWindow: authorityWindow },
      estimate: { id: fixedUuid(19), revisionId: fixedUuid(20), revision: 4, digest: '3'.repeat(64) },
      composition: { id: fixedUuid(21), revision: 2, digest: '4'.repeat(64),
        calculationVersion: 'estimate-cost-adoption-v3', componentManifest: {}, coverageAssessment: {} },
      equipmentCostPlan: { id: fixedUuid(22), revision: 2, digest: '5'.repeat(64),
        calculationVersion: 'estimate-equipment-cost-plan-v1' },
      equipmentPlan: { id: fixedUuid(23), revision: 2, digest: '6'.repeat(64),
        calculationVersion: 'estimate-equipment-plan-v1' },
      readinessPlan: { id: fixedUuid(24), revision: 1, digest: '7'.repeat(64),
        calculationVersion: 'estimate-equipment-readiness-v1', evidenceDigest: '8'.repeat(64) } }],
      assets: [{ asset: { id: fixedUuid(25), version: 1, digest: '9'.repeat(64),
        category: 'equipment', accessType: 'owned', planAccessBasis: 'owned' },
      plannedUtilization: { state: 'current_claimed_plan_only', claimedOperatingHours: '2',
        useCount: 1, uses: [{ sourceIndex: 0, lineId: fixedUuid(26),
          plannedWindow: Object.assign({}, plannedWindow), claimedOperatingHours: '2' }],
        operatingTimeVerified: false, checkoutDurationUsed: false, reason: null },
      meter: { state: 'current_as_of_source', meterKey: 'engine-hours', unit: 'hours',
        reading: '100', observedAt: '2026-10-08T11:00:00.000Z', eventId: fixedUuid(27),
        eventRevision: 2, eventDigest: 'a'.repeat(64), ledgerRevision: 2,
        ledgerDigest: 'b'.repeat(64), resetApplied: true, correctionApplied: false,
        historyComplete: true, reason: null },
      serviceInterval: { state: 'current_claimed_plan_position', meterKey: 'engine-hours', unit: 'hours',
        threshold: '101', thresholdReference: 'Fictional owner review', currentReading: '100',
        projectedReading: '102', hoursRemainingAtStart: '1', thresholdReachedNow: false,
        thresholdReachedByClaimedPlan: true, verifiedServiceDate: null, reason: null },
      maintenanceDue: { state: 'unavailable', dueAt: null, dueWithinHorizon: null,
        dueByRecordedMeter: null, dueByClaimedPlanEnd: null, maintenanceScheduleVerified: false,
        maintenanceWorkAuthorized: false, reason: 'maintenance_schedule_unavailable' },
      serviceTiming: { state: 'unavailable', serviceAt: null,
        reason: 'operating_hour_timing_unavailable' },
      currentReadiness: { state: 'current_as_of_source', recordedDowntime: false,
        recordedFault: false, sourceCondition: 'reported_no_problem', reason: null },
      rentalLease: { state: 'owned_current', assetAccessType: 'owned', planAccessBasis: 'owned',
        providerAvailabilityVerified: false, providerMaintenanceVerified: false, reason: null },
      downtimeRisk: { state: 'unavailable', risk: null, probability: null,
        reason: 'evaluated_downtime_risk_evidence_unavailable' } }],
      utilization: { state: 'current_claimed_plan_only', assetCount: 1, useCount: 1,
        claimedOperatingHours: '2', operatingTimeVerified: false, checkoutDurationUsed: false, reason: null },
      learnedOutcomes: { state: 'none_current', applicableValueCount: 0, applied: false,
        reason: 'no_compatible_current_owner_adopted_operating_hour_value' },
      evidence: { sourceAuthenticatedUtilization: true, currentAdoptedEquipmentVerified: true,
        currentReadinessVerified: true, currentnessVerified: true, compatibleUnitsVerified: true,
        periodAttributionVerified: true, meterHistoryVerified: true,
        serviceThresholdPolicyVerified: true, maintenanceScheduleVerified: false,
        rentalLeaseProviderEvidenceVerified: false, m25AdjustmentApplied: false,
        evaluatedDowntimeRiskVerified: false },
      run: { calculationVersion: 'm26-asset-utilization-risk-calculation-v1',
        sourceDigest: 'c'.repeat(64), digest: 'd'.repeat(64) },
      forecastIssued: true, utilizationForecastIssued: true, serviceIntervalForecastIssued: true,
      maintenanceDueForecastIssued: false, serviceTimingForecastIssued: false,
      downtimeRiskForecastIssued: false, calibratedRangeIssued: false, probabilityIssued: false,
      automaticActionAuthorized: false,
    };
    var route = {
      version: 'm26-route-load-risk-forecast-v1', state: 'current', reason: null,
      fictional: true, checkedAt: checkedAt, sourceAsOf: '2026-10-08T12:00:03.000Z',
      horizon: Object.assign({}, horizon), scope: Object.assign({}, material.scope),
      sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
        currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
        outsideWindowCount: 0, travelRevisionCount: 1, routeLineCount: 1, reason: null },
      sources: [{ sourceIndex: 0, job: { appointmentId: fixedUuid(28), assignmentId: fixedUuid(29),
        bookingReviewId: fixedUuid(30), bookingConfirmationId: fixedUuid(31),
        issuedVersionId: fixedUuid(32), plannedWindow: authorityWindow },
      estimate: { id: fixedUuid(33), revisionId: fixedUuid(34), revision: 5, digest: 'e'.repeat(64) },
      composition: { id: fixedUuid(35), revision: 2, digest: 'f'.repeat(64),
        calculationVersion: 'estimate-cost-adoption-v3', manifestDigest: '1'.repeat(64),
        coverageDigest: '2'.repeat(64) },
      travelPlan: { id: fixedUuid(36), revision: 2, digest: '3'.repeat(64),
        calculationVersion: 'estimate-travel-plan-v1', sourceDigest: '4'.repeat(64),
        assessmentDigest: '5'.repeat(64), assessedThrough: '2026-11-07' } }],
      routes: [{ sourceIndex: 0, tripId: fixedUuid(37),
        route: { originDigest: '6'.repeat(64), destinationDigest: '7'.repeat(64),
          direction: 'origin_to_destination', returnIncluded: true },
        movement: { state: 'unavailable', class: null, roadTransportationVerified: false,
          onsiteEquipmentMovementVerified: false, reason: 'movement_class_unavailable' },
        resource: { state: 'unavailable', assetId: null, kind: null, accessType: null,
          providerSemanticsVerified: false, reason: 'resource_identity_unavailable' },
        declaredDistance: { state: 'current_claimed_plan_only', oneWayQuantity: '10', unit: 'mi',
          basis: 'reported', tripCount: 2, vehicleCount: 1, tripLegs: 4, vehicleLegs: 4,
          totalVehicleLegDistance: '40', sourceAuthenticated: true, reason: null },
        verifiedRoadMileage: unavailablePositionValue('verified_road_route_unavailable'),
        routeTiming: unavailablePositionValue('verified_route_timing_unavailable'),
        fuelEnergy: unavailablePositionValue('independent_consumption_evidence_unavailable'),
        capacity: unavailablePositionValue('resource_capacity_and_load_evidence_unavailable') }],
      declaredRouteLoad: { state: 'current_claimed_plan_only', routeLineCount: 1,
        tripLegs: 4, vehicleLegs: 4, declaredVehicleMiles: '40',
        declaredVehicleKilometres: '0', reason: null },
      verifiedRoadMileage: unavailablePositionValue('verified_road_route_unavailable'),
      routeTiming: unavailablePositionValue('verified_route_timing_unavailable'),
      fuelEnergy: unavailablePositionValue('independent_consumption_evidence_unavailable'),
      logisticsCapacityRisk: unavailablePositionValue('resource_capacity_and_load_evidence_unavailable'),
      learnedOutcomes: { state: 'none_current', applicableValueCount: 0, applied: false,
        reason: 'no_compatible_current_owner_adopted_route_value' },
      evidence: { sourceAuthenticatedDeclaredDistance: true, currentAdoptedTravelVerified: true,
        currentnessVerified: true, compatibleUnitsVerified: true, periodAttributionVerified: true,
        movementClassVerified: false, verifiedRoadRouting: false, resourceIdentityVerified: false,
        independentConsumptionEvidenceVerified: false, capacityLoadEvidenceVerified: false,
        rentalLeaseProviderEvidenceVerified: false, m25AdjustmentApplied: false },
      run: { calculationVersion: 'm26-route-load-risk-calculation-v1',
        sourceDigest: '8'.repeat(64), digest: '9'.repeat(64) },
      forecastIssued: true, declaredRouteLoadForecastIssued: true,
      roadMileageForecastIssued: false, routeTimingForecastIssued: false,
      fuelEnergyForecastIssued: false, logisticsCapacityRiskForecastIssued: false,
      calibratedRangeIssued: false, probabilityIssued: false, automaticActionAuthorized: false,
    };
    return { material: material, asset: asset, route: route };
  }

  function create(options) {
    var document = options.document; var generation = 0; var authority = null;
    function id(name) { return document.getElementById(name); }
    function element(tag, className, content) {
      var node = document.createElement(tag); if (className) node.className = className;
      if (content !== undefined) node.textContent = String(content); return node;
    }
    function shown(value) {
      if (value === null || value === undefined) return 'Unavailable';
      if (value === true) return 'Yes';
      if (value === false) return 'No';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }
    function label(value) {
      return String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ').replace(/^./, function (letter) { return letter.toUpperCase(); });
    }
    function metadata(title, rows) {
      var section = element('section', 'command-center-resource-metadata');
      section.appendChild(element('h4', null, title));
      var list = element('dl');
      rows.forEach(function (row) {
        list.append(element('dt', null, row[0]), element('dd', null, shown(row[1])));
      });
      section.appendChild(list); return section;
    }
    function objectRows(prefix, value) {
      return Object.keys(value).map(function (key) { return [prefix + ' ' + label(key), value[key]]; });
    }
    function validAuthority(value) {
      return exact(value, ['tenantId', 'role', 'mode', 'fictional']) && text(value.tenantId, 160) &&
        text(value.role, 64) && value.mode === options.mode &&
        value.fictional === (options.mode === 'demo');
    }
    function authorityRows() {
      return [['Authenticated tenant', authority.tenantId], ['Authenticated role', authority.role],
        ['Workspace mode', authority.mode], ['Fictional isolated data', authority.fictional]];
    }
    function commonRows(value) {
      return authorityRows().concat([
        ['Payload contract', value.version], ['Payload state', value.state],
        ['Exact unavailable reason', value.reason], ['Checked at', value.checkedAt],
        ['Source as of', value.sourceAsOf], ['Horizon kind', value.horizon.kind],
        ['Horizon starts at', value.horizon.startsAt], ['Horizon ends at', value.horizon.endsAt],
        ['Horizon starts on', value.horizon.startsOn],
        ['Horizon ends on exclusive', value.horizon.endsOnExclusive],
        ['Business time zone', value.horizon.timeZone], ['Scope', value.scope.label],
        ['Whole business coverage verified', value.scope.wholeBusinessCoverageVerified],
        ['Off platform coverage verified', value.scope.offPlatformCoverageVerified],
      ]).concat(objectRows('Coverage', value.sourceCoverage),
        objectRows('Evidence', value.evidence), objectRows('Calculation', value.run),
        objectRows('Learned outcome', value.learnedOutcomes));
    }
    function compositionRows(composition) {
      var rows = [['Composition id', composition.id], ['Composition revision', composition.revision],
        ['Composition digest', composition.digest],
        ['Composition calculation version', composition.calculationVersion]];
      if (Object.prototype.hasOwnProperty.call(composition, 'manifestDigest')) {
        rows.push(['Composition manifest digest', composition.manifestDigest],
          ['Composition coverage digest', composition.coverageDigest]);
      } else {
        rows.push(['Composition component manifest fields', Object.keys(composition.componentManifest).length],
          ['Composition coverage assessment fields', Object.keys(composition.coverageAssessment).length]);
      }
      return rows;
    }
    function sourceRows(source, planKeys, timeZone) {
      var windowValue = source.job.plannedWindow;
      var rows = [['Source index', source.sourceIndex], ['Appointment id', source.job.appointmentId],
        ['Assignment id', source.job.assignmentId], ['Booking review id', source.job.bookingReviewId],
        ['Booking confirmation id', source.job.bookingConfirmationId],
        ['Issued version id', source.job.issuedVersionId], ['Planned window starts at', windowValue.startsAt],
        ['Planned window ends at', windowValue.endsAt],
        ['Planned window time zone', windowValue.timeZone || timeZone],
        ['Estimate id', source.estimate.id], ['Estimate revision id', source.estimate.revisionId],
        ['Estimate revision', source.estimate.revision], ['Estimate digest', source.estimate.digest]];
      if (Object.prototype.hasOwnProperty.call(windowValue, 'assignmentRevision')) {
        rows = rows.concat([['Assignment revision', windowValue.assignmentRevision],
          ['Assignment digest', windowValue.assignmentDigest], ['Approval id', windowValue.approvalId],
          ['Time evidence digest', windowValue.timeEvidenceDigest],
          ['Time zone profile id', windowValue.timeZoneAuthority.profileId],
          ['Time zone profile version', windowValue.timeZoneAuthority.profileVersion],
          ['Time zone profile hash', windowValue.timeZoneAuthority.profileHash],
          ['Time zone evaluated at', windowValue.timeZoneAuthority.evaluatedAt]]);
      }
      rows = rows.concat(compositionRows(source.composition));
      planKeys.forEach(function (planKey) {
        rows = rows.concat(objectRows(label(planKey), source[planKey]));
      });
      return rows;
    }
    function setState(label, state) {
      id('commandCenterResourceState').textContent = label;
      id('commandCenterResourceState').dataset.state = state;
    }
    function clearGraph(message) {
      id('commandCenterResourceGraphBars').replaceChildren();
      id('commandCenterResourceGraphDescription').textContent = message;
    }
    function clearMetric(name, message) {
      id('commandCenterResource' + name + 'State').textContent = 'Unavailable';
      id('commandCenterResource' + name + 'State').dataset.state = 'unavailable';
      id('commandCenterResource' + name + 'Value').textContent = 'Not available';
      id('commandCenterResource' + name + 'Context').textContent = message;
      id('commandCenterResource' + name + 'Details').replaceChildren();
      id('commandCenterResource' + name + 'Details').appendChild(element('p', null,
        'No current issued position is shown.'));
    }
    function clearAll(message) {
      clearMetric('Material', 'Demand, reorder, stockout, and purchasing risk are not available.');
      clearMetric('Asset', 'Utilization, service timing, maintenance, and downtime risk are not available.');
      clearMetric('Route', 'Route load, verified mileage, fuel or energy, and capacity are not available.');
      clearGraph(message || 'No resource positions are shown.');
    }
    function clearAuthority(message) {
      var target = id('commandCenterResourceAuthority'); target.replaceChildren();
      target.appendChild(element('p', null, message));
    }
    function renderAuthority() {
      var target = id('commandCenterResourceAuthority'); target.replaceChildren();
      target.appendChild(metadata('Current authenticated boundary', authorityRows()));
    }
    function announce(message) {
      if (id('commandCenterResourceStatus').textContent !== message) {
        id('commandCenterResourceStatus').textContent = message;
      }
    }
    function loading() {
      id('commandCenterResourceOutlook').setAttribute('aria-busy', 'true');
      setState('Loading', 'loading'); clearAll('Resource positions are loading. Previous values were cleared.');
      clearAuthority('Authenticated tenant and role context is loading. Previous context was cleared.');
      id('commandCenterResourceExplanation').textContent =
        'Checking current material, asset and travel positions from the released resource forecast contracts.';
      id('commandCenterResourceBoundary').textContent =
        'No shortage, maintenance, downtime, fuel, capacity, probability, recommendation or action is shown while loading.';
      announce('Resource outlook is loading. Previous values were cleared.');
    }
    function renderUnavailable(name, value, message, rows) {
      id('commandCenterResource' + name + 'State').textContent = 'Unavailable · ' + value.reason;
      id('commandCenterResource' + name + 'State').dataset.state = 'unavailable';
      id('commandCenterResource' + name + 'Value').textContent = 'Not available';
      id('commandCenterResource' + name + 'Context').textContent =
        message + ' Exact source reason: ' + value.reason + '.';
      var target = id('commandCenterResource' + name + 'Details'); target.replaceChildren();
      target.append(element('p', null, 'This authenticated response did not issue a forecast value.'),
        metadata(name + ' response evidence', commonRows(value)),
        metadata(name + ' unavailable boundaries', rows));
      return null;
    }
    function materialBoundaryRows(value) {
      return objectRows('Demand', value.demand).concat(objectRows('Inventory', value.inventory),
        objectRows('Future receipts', value.futureReceipts),
        objectRows('Replenishment', value.replenishment), objectRows('Reorder', value.reorder),
        objectRows('Stockout risk', value.stockoutRisk),
        objectRows('Purchasing risk', value.purchasingRisk));
    }
    function assetBoundaryRows(value) {
      return objectRows('Utilization', value.utilization).concat([
        ['Utilization forecast issued', value.utilizationForecastIssued],
        ['Service interval forecast issued', value.serviceIntervalForecastIssued],
        ['Maintenance due forecast issued', value.maintenanceDueForecastIssued],
        ['Service timing forecast issued', value.serviceTimingForecastIssued],
        ['Downtime risk forecast issued', value.downtimeRiskForecastIssued],
      ]);
    }
    function routeBoundaryRows(value) {
      return objectRows('Declared route load', value.declaredRouteLoad)
        .concat(objectRows('Verified road mileage', value.verifiedRoadMileage),
          objectRows('Route timing', value.routeTiming), objectRows('Fuel or energy', value.fuelEnergy),
          objectRows('Logistics capacity risk', value.logisticsCapacityRisk));
    }
    function renderMaterial(value) {
      var safe = validateMaterial(value);
      if (!safe || safe.fictional !== (options.mode === 'demo')) { clearMetric('Material',
        'Authenticated complete-as-of demand is missing. Reorder, stockout, and purchasing risk stay unavailable.'); return null; }
      if (safe.state === 'unavailable') return renderUnavailable('Material', safe,
        'Demand, reorder, stockout, and purchasing risk stay unavailable.', materialBoundaryRows(safe));
      if (!safe.demandForecastIssued) { clearMetric('Material',
        'Authenticated complete-as-of demand is missing. Reorder, stockout, and purchasing risk stay unavailable.'); return null; }
      id('commandCenterResourceMaterialState').textContent = safe.fictional ? 'Fictional position' : 'Current position';
      id('commandCenterResourceMaterialState').dataset.state = 'current';
      id('commandCenterResourceMaterialValue').textContent = safe.demand.groupCount +
        (safe.demand.groupCount === 1 ? ' material group' : ' material groups');
      id('commandCenterResourceMaterialContext').textContent =
        'Demand quantities are current. Inventory, receipts, reorder timing, stockout and purchasing risk are not available.';
      var target = id('commandCenterResourceMaterialDetails'); target.replaceChildren();
      var groups = element('ul', 'command-center-resource-position-list');
      safe.demand.groups.forEach(function (group) {
        groups.appendChild(element('li', null, group.identity.materialLabel + ' · ' +
          group.plannedQuantity + ' ' + group.unit + ' · ' + group.identity.procurementLocation +
          ' · ' + group.plannedWindow.startsAt + ' to ' + group.plannedWindow.endsAt));
      });
      target.append(element('p', null, 'Exact units stay separate; no inventory amount or shortage is inferred.'),
        groups, metadata('Material response evidence', commonRows(safe)),
        metadata('Material risk boundaries', materialBoundaryRows(safe)));
      safe.sources.forEach(function (source) {
        target.appendChild(metadata('Material source ' + (source.sourceIndex + 1),
          sourceRows(source, ['materialPlan'], safe.horizon.timeZone)));
      });
      safe.demand.groups.forEach(function (group, index) {
        var rows = [['Material label', group.identity.materialLabel],
          ['Material specification', group.identity.materialSpecification],
          ['Procurement location', group.identity.procurementLocation], ['Exact unit', group.unit],
          ['Planned window starts at', group.plannedWindow.startsAt],
          ['Planned window ends at', group.plannedWindow.endsAt],
          ['Base quantity', group.baseQuantity], ['Waste quantity', group.wasteQuantity],
          ['Planned quantity', group.plannedQuantity]];
        group.components.forEach(function (component, componentIndex) {
          rows = rows.concat([['Component ' + (componentIndex + 1) + ' source index', component.sourceIndex],
            ['Component ' + (componentIndex + 1) + ' line id', component.lineId],
            ['Component ' + (componentIndex + 1) + ' base quantity', component.baseQuantity],
            ['Component ' + (componentIndex + 1) + ' waste quantity', component.wasteQuantity],
            ['Component ' + (componentIndex + 1) + ' planned quantity', component.plannedQuantity]]);
        });
        target.appendChild(metadata('Material group ' + (index + 1), rows));
      });
      return { label: 'Material groups', count: safe.demand.groupCount, horizon: safe.horizon,
        sourceAsOf: safe.sourceAsOf };
    }
    function renderAsset(value) {
      var safe = validateAsset(value);
      if (!safe || safe.fictional !== (options.mode === 'demo')) { clearMetric('Asset',
        'Complete provider-neutral utilization evidence is missing. Service timing, maintenance and downtime risk stay unavailable.'); return null; }
      if (safe.state === 'unavailable') return renderUnavailable('Asset', safe,
        'Utilization, service timing, maintenance, and downtime risk stay unavailable.', assetBoundaryRows(safe));
      if (!safe.utilizationForecastIssued) { clearMetric('Asset',
        'Complete provider-neutral utilization evidence is missing. Service timing, maintenance and downtime risk stay unavailable.'); return null; }
      id('commandCenterResourceAssetState').textContent = safe.fictional ? 'Fictional position' : 'Current position';
      id('commandCenterResourceAssetState').dataset.state = 'current';
      id('commandCenterResourceAssetValue').textContent = safe.utilization.assetCount +
        (safe.utilization.assetCount === 1 ? ' asset · ' : ' assets · ') +
        safe.utilization.claimedOperatingHours + ' claimed h';
      id('commandCenterResourceAssetContext').textContent =
        'Claimed planned operating hours are not actual meter time. Maintenance dates and downtime risk are not available.';
      var target = id('commandCenterResourceAssetDetails'); target.replaceChildren();
      var assets = element('ul', 'command-center-resource-position-list');
      safe.assets.forEach(function (item) {
        var interval = item.serviceInterval.state === 'current_claimed_plan_position' ?
          'meter ' + item.serviceInterval.currentReading + ' → ' + item.serviceInterval.projectedReading +
          ' ' + item.serviceInterval.unit + '; threshold ' + item.serviceInterval.threshold +
          '; verified service date not available' : 'service interval position not available';
        assets.appendChild(element('li', null, 'Asset ' + item.asset.id + ' · ' +
          item.plannedUtilization.claimedOperatingHours + ' claimed h · ' + interval));
      });
      target.append(element('p', null, 'Checkout duration is excluded; no maintenance work or reassignment is authorized.'),
        assets, metadata('Asset response evidence', commonRows(safe)),
        metadata('Asset forecast boundaries', assetBoundaryRows(safe)));
      safe.sources.forEach(function (source) {
        target.appendChild(metadata('Asset source ' + (source.sourceIndex + 1),
          sourceRows(source, ['equipmentCostPlan', 'equipmentPlan', 'readinessPlan'],
            safe.horizon.timeZone)));
      });
      safe.assets.forEach(function (item, index) {
        var rows = objectRows('Asset', item.asset).concat([
          ['Planned utilization state', item.plannedUtilization.state],
          ['Claimed operating hours', item.plannedUtilization.claimedOperatingHours],
          ['Claimed operating hours exact unit', 'hours'],
          ['Planned use count', item.plannedUtilization.useCount],
          ['Operating time verified', item.plannedUtilization.operatingTimeVerified],
          ['Checkout duration used', item.plannedUtilization.checkoutDurationUsed],
          ['Planned utilization reason', item.plannedUtilization.reason],
        ]);
        item.plannedUtilization.uses.forEach(function (use, useIndex) {
          rows = rows.concat([['Use ' + (useIndex + 1) + ' source index', use.sourceIndex],
            ['Use ' + (useIndex + 1) + ' line id', use.lineId],
            ['Use ' + (useIndex + 1) + ' window starts at', use.plannedWindow.startsAt],
            ['Use ' + (useIndex + 1) + ' window ends at', use.plannedWindow.endsAt],
            ['Use ' + (useIndex + 1) + ' claimed operating hours', use.claimedOperatingHours],
            ['Use ' + (useIndex + 1) + ' exact unit', 'hours']]);
        });
        rows = rows.concat(objectRows('Meter', item.meter),
          objectRows('Service interval', item.serviceInterval),
          objectRows('Maintenance due', item.maintenanceDue),
          objectRows('Service timing', item.serviceTiming),
          objectRows('Current readiness', item.currentReadiness),
          objectRows('Rental or lease', item.rentalLease),
          objectRows('Downtime risk', item.downtimeRisk));
        target.appendChild(metadata('Asset position ' + (index + 1), rows));
      });
      return { label: 'Assets', count: safe.utilization.assetCount, horizon: safe.horizon,
        sourceAsOf: safe.sourceAsOf };
    }
    function renderRoute(value) {
      var safe = validateRoute(value);
      if (!safe || safe.fictional !== (options.mode === 'demo')) { clearMetric('Route',
        'Authenticated complete-as-of route coverage is missing. Mileage, fuel or energy, and capacity stay unavailable.'); return null; }
      if (safe.state === 'unavailable') return renderUnavailable('Route', safe,
        'Route load, mileage, fuel or energy, and logistics capacity stay unavailable.', routeBoundaryRows(safe));
      if (!safe.declaredRouteLoadForecastIssued) { clearMetric('Route',
        'Authenticated complete-as-of route coverage is missing. Mileage, fuel or energy, and capacity stay unavailable.'); return null; }
      id('commandCenterResourceRouteState').textContent = safe.fictional ? 'Fictional position' : 'Current position';
      id('commandCenterResourceRouteState').dataset.state = 'current';
      id('commandCenterResourceRouteValue').textContent = safe.declaredRouteLoad.routeLineCount +
        (safe.declaredRouteLoad.routeLineCount === 1 ? ' route line' : ' route lines');
      id('commandCenterResourceRouteContext').textContent =
        'Declared vehicle-leg distance is not verified road mileage. Fuel or energy use and logistics capacity are not available.';
      var target = id('commandCenterResourceRouteDetails'); target.replaceChildren();
      var routes = element('ul', 'command-center-resource-position-list');
      safe.routes.forEach(function (item) {
        routes.appendChild(element('li', null, item.declaredDistance.totalVehicleLegDistance + ' ' +
          item.declaredDistance.unit + ' declared vehicle-leg distance · ' + item.route.direction +
          (item.route.returnIncluded ? ' · recorded return included' : ' · no recorded return')));
      });
      target.append(element('p', null,
        'Road transportation and onsite equipment movement remain unclassified and are never combined.'),
      routes, metadata('Route response evidence', commonRows(safe)),
      metadata('Route forecast boundaries', routeBoundaryRows(safe)));
      safe.sources.forEach(function (source) {
        target.appendChild(metadata('Route source ' + (source.sourceIndex + 1),
          sourceRows(source, ['travelPlan'], safe.horizon.timeZone)));
      });
      safe.routes.forEach(function (item, index) {
        var rows = [['Source index', item.sourceIndex], ['Trip id', item.tripId]]
          .concat(objectRows('Route', item.route), objectRows('Movement', item.movement),
            objectRows('Resource', item.resource), objectRows('Declared distance', item.declaredDistance),
            objectRows('Verified road mileage', item.verifiedRoadMileage),
            objectRows('Route timing', item.routeTiming), objectRows('Fuel or energy', item.fuelEnergy),
            objectRows('Capacity', item.capacity));
        target.appendChild(metadata('Route line ' + (index + 1), rows));
      });
      return { label: 'Route lines', count: safe.declaredRouteLoad.routeLineCount,
        horizon: safe.horizon, sourceAsOf: safe.sourceAsOf };
    }
    function sameHorizon(items) {
      if (!items.length) return false;
      var first = items[0].horizon;
      return items.every(function (item) { return item.horizon.timeZone === first.timeZone &&
        item.horizon.startsOn === first.startsOn && item.horizon.endsOnExclusive === first.endsOnExclusive; });
    }
    function renderGraph(items) {
      if (!sameHorizon(items)) {
        clearGraph(items.length ? 'Coverage graph unavailable because current positions do not share one business horizon.' :
          'No current issued resource positions are shown.'); return;
      }
      var target = id('commandCenterResourceGraphBars'); target.replaceChildren();
      var maximum = Math.max.apply(Math, items.map(function (item) { return item.count; }).concat([1]));
      items.forEach(function (item) {
        var row = element('div', 'command-center-resource-graph-row');
        var label = element('span', null, item.label);
        var track = element('span', 'command-center-resource-graph-track');
        var bar = element('span', 'command-center-resource-graph-bar');
        bar.style.width = String((item.count / maximum) * 100) + '%'; track.appendChild(bar);
        row.append(label, track, element('strong', null, String(item.count))); target.appendChild(row);
      });
      id('commandCenterResourceGraphDescription').textContent = items.map(function (item) {
        return item.label + ': ' + item.count + '.';
      }).join(' ') + ' Separate record counts; no combined resource total. Horizon ' +
        items[0].horizon.startsOn + ' through ' + items[0].horizon.endsOnExclusive +
        ' in ' + items[0].horizon.timeZone + '.';
    }
    function renderBundle(bundle) {
      renderAuthority();
      var items = [renderMaterial(bundle && bundle.material), renderAsset(bundle && bundle.asset),
        renderRoute(bundle && bundle.route)].filter(Boolean);
      renderGraph(items);
      id('commandCenterResourceOutlook').setAttribute('aria-busy', 'false');
      if (items.length === 3) {
        setState(options.mode === 'demo' ? 'Fictional example' : 'Current', 'current');
      } else if (items.length > 0) setState('Partial', 'partial');
      else setState('Unavailable', 'unavailable');
      id('commandCenterResourceExplanation').textContent = items.length ?
        'Current issued planning positions are shown separately below. Unsupported operational risks stay unavailable.' :
        'Current authenticated complete-as-of material, asset and route positions are unavailable.';
      id('commandCenterResourceBoundary').textContent =
        'Demand is not inventory. Planned hours are not actual meter time. Declared distance is not verified mileage. No shortage, reorder, service date, downtime, fuel, capacity, probability, recommendation or automatic action is inferred.';
      announce('Resource outlook ' + (items.length === 3 ? 'current' : items.length ? 'partially available' :
        'unavailable') + '. ' + items.map(function (item) { return item.label + ' ' + item.count; }).join('. ') +
        '. Unsupported risks remain unavailable.');
    }
    function fetchDomain(url, validator, run) {
      return options.fetcher(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' } }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (payload) {
          if (run !== generation || !response.ok || !payload || payload.success !== true) return null;
          return validator(payload.data);
        });
      }).catch(function () { return null; });
    }
    function load(nextAuthority) {
      var run = ++generation; loading();
      authority = validAuthority(nextAuthority) ? nextAuthority : null;
      if (!authority) {
        id('commandCenterResourceOutlook').setAttribute('aria-busy', 'false');
        setState('Workspace unavailable', 'unavailable');
        clearAll('No resource positions are shown without current tenant and role authority.');
        clearAuthority('Current authenticated tenant and role context is unavailable.');
        id('commandCenterResourceExplanation').textContent =
          'Current authenticated tenant and role context is required before resource positions can load.';
        id('commandCenterResourceBoundary').textContent =
          'No resource position or risk is shown without current tenant and role authority.';
        announce('Resource outlook is unavailable. Authenticated tenant and role context is missing.');
        return Promise.resolve();
      }
      if (options.mode === 'demo') { renderBundle(demoBundle()); return Promise.resolve(); }
      return Promise.all([
        fetchDomain('/api/v1/forecast/material-demand-risk/current', validateMaterial, run),
        fetchDomain('/api/v1/forecast/asset-utilization-risk/current', validateAsset, run),
        fetchDomain('/api/v1/forecast/route-load-risk/current', validateRoute, run),
      ]).then(function (values) {
        if (run !== generation) return;
        renderBundle({ material: values[0], asset: values[1], route: values[2] });
      });
    }
    return { workspaceReady: load, workspaceUnavailable: function () {
      generation += 1; authority = null;
      id('commandCenterResourceOutlook').setAttribute('aria-busy', 'false');
      setState('Workspace unavailable', 'unavailable'); clearAll('No resource positions are shown.');
      clearAuthority('Current authenticated tenant and role context is unavailable.');
      id('commandCenterResourceExplanation').textContent =
        'The workspace could not load. Refresh to retry loading current resource positions.';
      id('commandCenterResourceBoundary').textContent =
        'No resource position or risk is shown while workspace data is unavailable.';
      announce('Resource outlook is unavailable. Previous values were cleared.');
    } };
  }

  global.NorthStarResourceRiskOutlook = { create: create, demoBundle: demoBundle,
    validateMaterial: validateMaterial, validateAsset: validateAsset, validateRoute: validateRoute };
})(window);
