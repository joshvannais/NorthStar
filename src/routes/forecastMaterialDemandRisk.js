'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUANTITY = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$/;
const UNITS = new Set(['ea','m','m2','m3','ft','ft2','ft3','yd3','kg','lb','l','gal']);
const REASONS = new Set([
  'business_calendar_unavailable', 'complete_source_coverage_unavailable',
  'approved_timing_attribution_unavailable',
  'current_owner_confirmed_booking_unavailable',
  'duplicate_current_job_material_source',
  'current_adopted_material_composition_unavailable',
  'compatible_m25_outcome_unavailable',
]);

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function dense(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function plainJson(value, budget, depth = 0) {
  if (++budget.nodes > 120000 || depth > 12) return false;
  if (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 131072)) return true;
  if (Array.isArray(value)) {
    if (!dense(value, 200) || value.length > 200) return false;
    return value.every(item => plainJson(item, budget, depth + 1));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 100) return false;
  return keys.every(key => typeof key === 'string' && key.length <= 160 &&
    !['__proto__','prototype','constructor'].includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value') &&
    plainJson(Object.getOwnPropertyDescriptor(value, key).value, budget, depth + 1));
}

function validInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value) || /T24:|:60(?:\.|Z)/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

function text(value, maximum = 160) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function quantity(value) {
  if (typeof value !== 'string' || !QUANTITY.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}

function validHorizon(value, checkedAt, state) {
  return exact(value, ['kind','timeZone','startsAt','endsAt','startsOn','endsOnExclusive']) &&
    value.kind === 'next_30_elapsed_days' &&
    (text(value.timeZone, 100) || (state === 'unavailable' && value.timeZone === null)) &&
    validInstant(value.startsAt) && validInstant(value.endsAt) &&
    value.startsAt === checkedAt && DATE.test(value.startsOn) && DATE.test(value.endsOnExclusive) &&
    new Date(value.endsAt).getTime() - new Date(value.startsAt).getTime() === 2592000000;
}

function unavailableBoundary(value) {
  return exact(value.inventory, ['state','onHand','compatibleStockIdentityVerified',
    'transactionCoverageVerified','receiptSemanticsVerified','m23UsageApplied','reason']) &&
    value.inventory.state === 'unavailable' && value.inventory.onHand === null &&
    value.inventory.compatibleStockIdentityVerified === false &&
    value.inventory.transactionCoverageVerified === false &&
    value.inventory.receiptSemanticsVerified === false && value.inventory.m23UsageApplied === false &&
    value.inventory.reason === 'source_owned_inventory_ledger_unavailable' &&
    exact(value.futureReceipts, ['state','quantity','receiptDatesVerified','reason']) &&
    value.futureReceipts.state === 'unavailable' && value.futureReceipts.quantity === null &&
    value.futureReceipts.receiptDatesVerified === false &&
    value.futureReceipts.reason === 'future_receipts_unavailable' &&
    exact(value.replenishment, ['state','leadTimeDays','cutoffAt','leadTimePolicyVerified',
      'cutoffPolicyVerified','supplierAvailabilityVerified','purchaseAuthorityVerified','reason']) &&
    value.replenishment.state === 'unavailable' && value.replenishment.leadTimeDays === null &&
    value.replenishment.cutoffAt === null && value.replenishment.leadTimePolicyVerified === false &&
    value.replenishment.cutoffPolicyVerified === false &&
    value.replenishment.supplierAvailabilityVerified === false &&
    value.replenishment.purchaseAuthorityVerified === false &&
    value.replenishment.reason === 'replenishment_policy_unavailable' &&
    exact(value.reorder, ['state','reorderAt','reason']) &&
    value.reorder.state === 'unavailable' && value.reorder.reorderAt === null &&
    value.reorder.reason === 'inventory_receipts_and_replenishment_unavailable' &&
    exact(value.stockoutRisk, ['state','risk','shortageQuantity','reason']) &&
    value.stockoutRisk.state === 'unavailable' && value.stockoutRisk.risk === null &&
    value.stockoutRisk.shortageQuantity === null &&
    value.stockoutRisk.reason === 'inventory_receipts_and_replenishment_unavailable' &&
    exact(value.purchasingRisk, ['state','risk','reason']) &&
    value.purchasingRisk.state === 'unavailable' && value.purchasingRisk.risk === null &&
    value.purchasingRisk.reason === 'supplier_and_purchase_authority_unavailable';
}

function validSource(value, index, budget) {
  if (!exact(value, ['sourceIndex','job','estimate','composition','materialPlan']) ||
      value.sourceIndex !== index ||
      !exact(value.job, ['appointmentId','assignmentId','bookingReviewId',
        'bookingConfirmationId','issuedVersionId','plannedWindow']) ||
      ![value.job.appointmentId,value.job.assignmentId,value.job.bookingReviewId,
        value.job.bookingConfirmationId,value.job.issuedVersionId].every(id => UUID.test(id || '')) ||
      !exact(value.job.plannedWindow, ['startsAt','endsAt']) ||
      !validInstant(value.job.plannedWindow.startsAt) || !validInstant(value.job.plannedWindow.endsAt) ||
      value.job.plannedWindow.startsAt >= value.job.plannedWindow.endsAt ||
      !exact(value.estimate, ['id','revisionId','revision','digest']) ||
      !UUID.test(value.estimate.id || '') || !UUID.test(value.estimate.revisionId || '') ||
      !Number.isSafeInteger(value.estimate.revision) || value.estimate.revision < 1 ||
      !DIGEST.test(value.estimate.digest || '') ||
      !exact(value.composition, ['id','revision','digest','calculationVersion',
        'componentManifest','coverageAssessment']) || !UUID.test(value.composition.id || '') ||
      !Number.isSafeInteger(value.composition.revision) || value.composition.revision < 1 ||
      !DIGEST.test(value.composition.digest || '') ||
      value.composition.calculationVersion !== 'estimate-cost-adoption-v3' ||
      !plainJson(value.composition.componentManifest, budget) ||
      !plainJson(value.composition.coverageAssessment, budget) ||
      !exact(value.materialPlan, ['id','revision','digest','calculationVersion']) ||
      !UUID.test(value.materialPlan.id || '') ||
      !Number.isSafeInteger(value.materialPlan.revision) || value.materialPlan.revision < 1 ||
      !DIGEST.test(value.materialPlan.digest || '') ||
      value.materialPlan.calculationVersion !== 'estimate-material-plan-v4') return false;
  return true;
}

function validGroups(groups, sources) {
  if (!dense(groups, 10000)) return false;
  const seenLines = new Set();
  for (const group of groups) {
    if (!exact(group, ['identity','unit','plannedWindow','baseQuantity','wasteQuantity',
      'plannedQuantity','components']) ||
        !exact(group.identity, ['materialLabel','materialSpecification','procurementLocation']) ||
        !text(group.identity.materialLabel) || !text(group.identity.materialSpecification) ||
        !text(group.identity.procurementLocation) || !UNITS.has(group.unit) ||
        !exact(group.plannedWindow, ['startsAt','endsAt']) ||
        !validInstant(group.plannedWindow.startsAt) || !validInstant(group.plannedWindow.endsAt) ||
        group.plannedWindow.startsAt >= group.plannedWindow.endsAt || !dense(group.components, 10000)) return false;
    const totals = { base: 0n, waste: 0n, planned: 0n };
    for (const component of group.components) {
      if (!exact(component, ['sourceIndex','lineId','baseQuantity','wasteQuantity','plannedQuantity']) ||
          !Number.isSafeInteger(component.sourceIndex) || component.sourceIndex < 0 ||
          component.sourceIndex >= sources.length || !UUID.test(component.lineId || '')) return false;
      const key = `${component.sourceIndex}:${component.lineId.toLowerCase()}`;
      if (seenLines.has(key)) return false;
      seenLines.add(key);
      const base = quantity(component.baseQuantity), waste = quantity(component.wasteQuantity),
        planned = quantity(component.plannedQuantity);
      if (base === null || waste === null || planned === null || base <= 0n || base + waste !== planned ||
          (group.unit === 'ea' && planned % 1000000n !== 0n)) return false;
      const sourceWindow = sources[component.sourceIndex].job.plannedWindow;
      if (sourceWindow.startsAt !== group.plannedWindow.startsAt ||
          sourceWindow.endsAt !== group.plannedWindow.endsAt) return false;
      totals.base += base; totals.waste += waste; totals.planned += planned;
    }
    if (group.components.length < 1 || quantity(group.baseQuantity) !== totals.base ||
        quantity(group.wasteQuantity) !== totals.waste ||
        quantity(group.plannedQuantity) !== totals.planned) return false;
  }
  return seenLines.size;
}

function sanitizeForecast(value) {
  const keys = ['version','state','reason','fictional','checkedAt','sourceAsOf','horizon','scope',
    'sourceCoverage','sources','demand','inventory','futureReceipts','replenishment','reorder',
    'stockoutRisk','purchasingRisk','learnedOutcomes','evidence','run','forecastIssued',
    'demandForecastIssued','reorderForecastIssued','stockoutForecastIssued',
    'purchasingRiskForecastIssued','calibratedRangeIssued','probabilityIssued',
    'automaticActionAuthorized'];
  if (!exact(value, keys) || value.version !== 'm26-material-demand-risk-forecast-v1' ||
      !['current','unavailable'].includes(value.state) || value.fictional !== false ||
      !validInstant(value.checkedAt) || !validInstant(value.sourceAsOf) ||
      !validHorizon(value.horizon, value.checkedAt, value.state) ||
      !exact(value.scope, ['label','wholeBusinessCoverageVerified','offPlatformCoverageVerified']) ||
      value.scope.label !== 'Authenticated owner-confirmed scheduled backlog' ||
      value.scope.wholeBusinessCoverageVerified !== false ||
      value.scope.offPlatformCoverageVerified !== false || !unavailableBoundary(value) ||
      !exact(value.learnedOutcomes, ['state','applicableValueCount','applied','reason']) ||
      value.learnedOutcomes.applied !== false ||
      !exact(value.evidence, ['sourceAuthenticatedDemand','currentAdoptedCompositionVerified',
        'currentnessVerified','compatibleUnitsVerified','periodAttributionVerified',
        'inventoryVerified','futureReceiptsVerified','replenishmentPolicyVerified',
        'supplierAvailabilityVerified','purchaseAuthorityVerified','m25AdjustmentApplied']) ||
      [value.evidence.inventoryVerified,value.evidence.futureReceiptsVerified,
        value.evidence.replenishmentPolicyVerified,value.evidence.supplierAvailabilityVerified,
        value.evidence.purchaseAuthorityVerified,value.evidence.m25AdjustmentApplied]
        .some(flag => flag !== false) ||
      !exact(value.run, ['calculationVersion','sourceDigest','digest']) ||
      value.run.calculationVersion !== 'm26-material-demand-risk-calculation-v1' ||
      value.reorderForecastIssued !== false || value.stockoutForecastIssued !== false ||
      value.purchasingRiskForecastIssued !== false || value.calibratedRangeIssued !== false ||
      value.probabilityIssued !== false || value.automaticActionAuthorized !== false) return null;
  if (value.state === 'unavailable') {
    if (!REASONS.has(value.reason) || value.sources !== null ||
        !exact(value.sourceCoverage, ['state','completeAsOf','hasMore',
          'currentBookedPositionCount','scheduledJobCount','unscheduledJobCount',
          'outsideWindowCount','materialRevisionCount','componentLineCount','reason']) ||
        value.sourceCoverage.state !== 'unavailable' || value.sourceCoverage.completeAsOf !== false ||
        value.sourceCoverage.hasMore !== null || value.sourceCoverage.reason !== value.reason ||
        [value.sourceCoverage.currentBookedPositionCount,value.sourceCoverage.scheduledJobCount,
          value.sourceCoverage.unscheduledJobCount,value.sourceCoverage.outsideWindowCount,
          value.sourceCoverage.materialRevisionCount,value.sourceCoverage.componentLineCount]
          .some(item => item !== null) ||
        !exact(value.demand, ['state','groupCount','componentCount','groups','reason']) ||
        value.demand.state !== 'unavailable' || value.demand.groupCount !== null ||
        value.demand.componentCount !== null || value.demand.groups !== null ||
        value.demand.reason !== value.reason || value.learnedOutcomes.state !== 'unavailable' ||
        value.learnedOutcomes.applicableValueCount !== null ||
        value.learnedOutcomes.reason !== value.reason ||
        [value.evidence.sourceAuthenticatedDemand,value.evidence.currentAdoptedCompositionVerified,
          value.evidence.currentnessVerified,value.evidence.compatibleUnitsVerified,
          value.evidence.periodAttributionVerified].some(flag => flag !== false) ||
        value.run.sourceDigest !== null || value.run.digest !== null ||
        value.forecastIssued !== false || value.demandForecastIssued !== false) return null;
    return value;
  }
  if (value.reason !== null || !dense(value.sources, 500) ||
      !exact(value.sourceCoverage, ['state','completeAsOf','hasMore',
        'currentBookedPositionCount','scheduledJobCount','unscheduledJobCount',
        'outsideWindowCount','materialRevisionCount','componentLineCount','reason']) ||
      value.sourceCoverage.state !== 'complete_as_of' || value.sourceCoverage.completeAsOf !== true ||
      value.sourceCoverage.hasMore !== false || value.sourceCoverage.reason !== null ||
      ![value.sourceCoverage.currentBookedPositionCount,value.sourceCoverage.scheduledJobCount,
        value.sourceCoverage.unscheduledJobCount,value.sourceCoverage.outsideWindowCount,
        value.sourceCoverage.materialRevisionCount,value.sourceCoverage.componentLineCount]
        .every(count => Number.isSafeInteger(count) && count >= 0 && count <= 10000) ||
      value.sourceCoverage.currentBookedPositionCount !==
        value.sourceCoverage.scheduledJobCount + value.sourceCoverage.outsideWindowCount ||
      value.sourceCoverage.unscheduledJobCount !== 0 ||
      value.sourceCoverage.materialRevisionCount !== value.sources.length ||
      value.sourceCoverage.scheduledJobCount !== value.sources.length ||
      !exact(value.demand, ['state','groupCount','componentCount','groups','reason']) ||
      value.demand.state !== 'current' || value.demand.reason !== null ||
      !dense(value.demand.groups, 10000) || value.demand.groupCount !== value.demand.groups.length ||
      value.demand.componentCount !== value.sourceCoverage.componentLineCount ||
      value.learnedOutcomes.state !== 'none_current' ||
      value.learnedOutcomes.applicableValueCount !== 0 ||
      value.learnedOutcomes.reason !== 'no_compatible_current_owner_adopted_material_value' ||
      [value.evidence.sourceAuthenticatedDemand,value.evidence.currentAdoptedCompositionVerified,
        value.evidence.currentnessVerified,value.evidence.compatibleUnitsVerified,
        value.evidence.periodAttributionVerified].some(flag => flag !== true) ||
      !DIGEST.test(value.run.sourceDigest || '') || !DIGEST.test(value.run.digest || '') ||
      value.forecastIssued !== true || value.demandForecastIssued !== true) return null;
  const budget = { nodes: 0 };
  if (!value.sources.every((source, index) => validSource(source, index, budget))) return null;
  const componentCount = validGroups(value.demand.groups, value.sources);
  if (componentCount === false || componentCount !== value.demand.componentCount) return null;
  return value;
}

function failure(res, error) {
  const code = error?.code;
  const status = code === '42501' ? 403 : code === '22023' || code === '22P02' ? 400 :
    ['40001','40P01','55P03'].includes(code) ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'MATERIAL_DEMAND_RISK_RESTRICTED' :
      status === 400 ? 'MATERIAL_DEMAND_RISK_REQUEST_INVALID' :
        status === 409 ? 'MATERIAL_DEMAND_RISK_CHANGED' : 'MATERIAL_DEMAND_RISK_UNAVAILABLE',
    message: status === 403 ? 'You cannot view this resource forecast.' :
      status === 400 ? 'Check the request and try again.' :
        status === 409 ? 'The resource forecast changed. Refresh and try again.' :
          'The resource forecast is temporarily unavailable.',
  } });
}

function createForecastMaterialDemandRiskRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-material-demand-risk:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.vary('Cookie');
    next();
  });
  router.get('/current', auth, permission, throttle, async (req, res) => {
    if (!exact(req.query, [])) return failure(res, { code: '22023' });
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const identity = [req.tenantContext.organizationId, req.tenantContext.userId,
        req.userRole, req.authSession.id];
      const raw = (await client.query(
        'SELECT public.canonical_forecast_material_demand_risk_v1_current($1,$2,$3,$4) value',
        identity)).rows[0]?.value;
      const value = sanitizeForecast(raw);
      if (!value) throw new Error('Invalid material-demand risk projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { createForecastMaterialDemandRiskRouter, sanitizeForecast };
