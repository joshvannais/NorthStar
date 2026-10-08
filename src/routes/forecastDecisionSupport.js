'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { projectForecastDrilldowns,
  sanitizeForecastDrilldowns } = require('./forecastDrilldowns');

const VERSION = 'm26-forecast-decision-support-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/;
const ROLES = new Set(['owner', 'admin']);
const REASONS = new Set(['same_run_manifest_not_available',
  'deterministic_baseline_not_current']);
const TARGET_KEYS = Object.freeze([
  'revenue','operating_cost','profit','margin','demand','capacity',
]);
const PREREQUISITES = Object.freeze([
  'accepted_immutable_run_and_revision',
  'versioned_current_alert_policy',
  'authenticated_complete_source_currentness',
  'reviewed_materiality_and_uncertainty_basis',
  'authorized_advisory_receiving_workflow',
  'authorized_minimized_point_in_time_export',
]);
const EXCLUDED_EXPORT_FIELDS = Object.freeze([
  'raw_transcripts','customer_contacts','worker_wages','secrets','unrelated_records',
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

function dense(value, expected) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== expected.length || Reflect.ownKeys(value).length !== expected.length + 1) {
    return false;
  }
  return value.every((item, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') &&
      item === expected[index];
  });
}

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function copy(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function validInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const milliseconds = Date.parse(value.slice(0, 23) + 'Z');
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 23) === value.slice(0, 23);
}

function validPeriod(value) {
  return exact(value, ['localStart','startsAt','endsAt','grain','timeZone',
    'calendarDigest','partialPeriod']) && MONTH.test(value.localStart || '') &&
    validInstant(value.startsAt) && validInstant(value.endsAt) &&
    value.startsAt < value.endsAt && value.grain === 'business_local_month' &&
    typeof value.timeZone === 'string' && value.timeZone.length > 0 &&
    value.timeZone.length <= 100 && value.calendarDigest === null &&
    value.partialPeriod === null;
}

function projectForecastDecisionSupport(input, viewer) {
  const drilldowns = sanitizeForecastDrilldowns(input);
  if (!drilldowns || !viewer || !UUID.test(viewer.userId || '') ||
      !ROLES.has(viewer.role)) return null;
  const stale = drilldowns.reason === 'deterministic_baseline_not_current';
  return {
    version: VERSION,
    state: 'unavailable',
    reason: drilldowns.reason,
    organizationId: drilldowns.organizationId,
    originId: drilldowns.originId,
    checkedAt: drilldowns.checkedAt,
    audience: {
      scope: 'owner_admin',
      viewerUserId: viewer.userId,
      viewerRole: viewer.role,
    },
    anchor: {
      period: copy(drilldowns.period),
      targetKeys: [...TARGET_KEYS],
      runId: null,
      runRevision: null,
      runOutputDigest: null,
      sourceSnapshotDigest: stale ? null :
        (drilldowns.bundle.anchor?.sourceSnapshotDigest || null),
      sourceReceiptDigest: stale ? null :
        (drilldowns.bundle.anchor?.sourceReceiptDigest || null),
      timelineDigest: drilldowns.digests.timeline,
      bundleDigest: drilldowns.digests.bundle,
      drilldownDigest: null,
    },
    alert: {
      state: 'unavailable',
      reason: stale ? 'source_currentness_not_available' :
        'accepted_run_and_versioned_alert_policy_not_available',
      items: [],
      labelKind: null,
      headline: null,
      direction: null,
      baseline: null,
      threshold: null,
      materiality: null,
      uncertaintyBasis: null,
      evaluationBasis: null,
      explanation: null,
      ownerVisibleAt: null,
      policy: { id: null, version: null, digest: null, current: false },
      event: { id: null, digest: null },
      dedupe: { key: null, runId: null, policyDigest: null, eventDigest: null },
    },
    advice: {
      state: 'unavailable',
      reason: 'authenticated_current_alert_not_available',
      items: [],
      supportingEvidence: [],
      expectedTradeoff: null,
      missingInformation: [...PREREQUISITES],
      receivingWorkflow: null,
      advisoryOnly: true,
      navigationIsApproval: false,
      receiverRecheckRequired: true,
      handoffAuthorized: false,
      automaticActionAuthorized: false,
    },
    export: {
      state: 'unavailable',
      reason: 'authorized_current_evidence_packet_not_available',
      packet: null,
      downloadUrl: null,
      shareUrl: null,
      pointInTime: true,
      fictional: false,
      retentionState: 'unknown',
      superseded: false,
      stale,
      includedFields: [],
      excludedFields: [...EXCLUDED_EXPORT_FIELDS],
    },
    prerequisites: [...PREREQUISITES],
    currentness: {
      anchorCurrent: drilldowns.currentness.anchorCurrent,
      acceptedRunCurrent: false,
      alertPolicyCurrent: false,
      exportAuthorityCurrent: false,
      refreshRequired: true,
      correctionOrRevocationApplied:
        drilldowns.currentness.correctionOrRevocationApplied,
    },
    digests: {
      decisionSupport: null,
      run: null,
      alertPolicy: null,
      alertEvent: null,
      advice: null,
      exportPacket: null,
      timeline: drilldowns.digests.timeline,
      bundle: drilldowns.digests.bundle,
      drilldown: null,
    },
    alertIssued: false,
    recommendationIssued: false,
    exportIssued: false,
    zeroEvidenceAccepted: false,
    probabilityOrConfidenceIssued: false,
    automaticActionAuthorized: false,
    outboundCommunicationAuthorized: false,
    reviewedHandoffAuthorized: false,
    researchOnly: true,
  };
}

function validAlert(value, stale) {
  if (!exact(value, ['state','reason','items','labelKind','headline','direction','baseline',
    'threshold','materiality','uncertaintyBasis','evaluationBasis','explanation',
    'ownerVisibleAt','policy','event','dedupe']) || value.state !== 'unavailable' ||
      value.reason !== (stale ? 'source_currentness_not_available' :
        'accepted_run_and_versioned_alert_policy_not_available') ||
      !dense(value.items, []) || !['labelKind','headline','direction','baseline','threshold',
        'materiality','uncertaintyBasis','evaluationBasis','explanation','ownerVisibleAt']
        .every(key => value[key] === null)) return false;
  return exact(value.policy, ['id','version','digest','current']) &&
    value.policy.id === null && value.policy.version === null &&
    value.policy.digest === null && value.policy.current === false &&
    exact(value.event, ['id','digest']) && value.event.id === null &&
    value.event.digest === null &&
    exact(value.dedupe, ['key','runId','policyDigest','eventDigest']) &&
    Object.values(value.dedupe).every(item => item === null);
}

function validAdvice(value) {
  return exact(value, ['state','reason','items','supportingEvidence','expectedTradeoff',
    'missingInformation','receivingWorkflow','advisoryOnly','navigationIsApproval',
    'receiverRecheckRequired','handoffAuthorized','automaticActionAuthorized']) &&
    value.state === 'unavailable' &&
    value.reason === 'authenticated_current_alert_not_available' &&
    dense(value.items, []) && dense(value.supportingEvidence, []) &&
    value.expectedTradeoff === null && dense(value.missingInformation, PREREQUISITES) &&
    value.receivingWorkflow === null && value.advisoryOnly === true &&
    value.navigationIsApproval === false && value.receiverRecheckRequired === true &&
    value.handoffAuthorized === false && value.automaticActionAuthorized === false;
}

function validExport(value, stale, fictional) {
  return exact(value, ['state','reason','packet','downloadUrl','shareUrl','pointInTime',
    'fictional','retentionState','superseded','stale','includedFields','excludedFields']) &&
    value.state === 'unavailable' &&
    value.reason === 'authorized_current_evidence_packet_not_available' &&
    value.packet === null && value.downloadUrl === null && value.shareUrl === null &&
    value.pointInTime === true && value.fictional === fictional &&
    value.retentionState === 'unknown' && value.superseded === false &&
    value.stale === stale && dense(value.includedFields, []) &&
    dense(value.excludedFields, EXCLUDED_EXPORT_FIELDS);
}

function sanitizeForecastDecisionSupport(value, options = {}) {
  const keys = ['version','state','reason','organizationId','originId','checkedAt','audience',
    'anchor','alert','advice','export','prerequisites','currentness','digests','alertIssued',
    'recommendationIssued','exportIssued','zeroEvidenceAccepted',
    'probabilityOrConfidenceIssued','automaticActionAuthorized',
    'outboundCommunicationAuthorized','reviewedHandoffAuthorized','researchOnly'];
  const fictional = options.fictional === true;
  if (!exact(value, keys) || value.version !== VERSION || value.state !== 'unavailable' ||
      !REASONS.has(value.reason) || !UUID.test(value.organizationId || '') ||
      !UUID.test(value.originId || '') || !validInstant(value.checkedAt) ||
      !exact(value.audience, ['scope','viewerUserId','viewerRole']) ||
      value.audience.scope !== (fictional ? 'isolated_fictional_demo' : 'owner_admin') ||
      !UUID.test(value.audience.viewerUserId || '') ||
      (fictional ? value.audience.viewerRole !== 'viewer' :
        !ROLES.has(value.audience.viewerRole))) return null;
  const stale = value.reason === 'deterministic_baseline_not_current';
  if (!exact(value.anchor, ['period','targetKeys','runId','runRevision','runOutputDigest',
    'sourceSnapshotDigest','sourceReceiptDigest','timelineDigest','bundleDigest',
    'drilldownDigest']) || !dense(value.anchor.targetKeys, TARGET_KEYS) ||
      value.anchor.runId !== null || value.anchor.runRevision !== null ||
      value.anchor.runOutputDigest !== null || value.anchor.drilldownDigest !== null ||
      (stale && ['period','sourceSnapshotDigest','sourceReceiptDigest','timelineDigest',
        'bundleDigest'].some(key => value.anchor[key] !== null)) ||
      (!stale && (!validPeriod(value.anchor.period) ||
        !DIGEST.test(value.anchor.sourceSnapshotDigest || '') ||
        !DIGEST.test(value.anchor.sourceReceiptDigest || '') ||
        !DIGEST.test(value.anchor.timelineDigest || '') ||
        !DIGEST.test(value.anchor.bundleDigest || '')))) return null;
  if (!validAlert(value.alert, stale) || !validAdvice(value.advice) ||
      !validExport(value.export, stale, fictional) ||
      !dense(value.prerequisites, PREREQUISITES) ||
      !exact(value.currentness, ['anchorCurrent','acceptedRunCurrent','alertPolicyCurrent',
        'exportAuthorityCurrent','refreshRequired','correctionOrRevocationApplied']) ||
      value.currentness.anchorCurrent !== !stale ||
      value.currentness.acceptedRunCurrent !== false ||
      value.currentness.alertPolicyCurrent !== false ||
      value.currentness.exportAuthorityCurrent !== false ||
      value.currentness.refreshRequired !== true ||
      value.currentness.correctionOrRevocationApplied !== stale ||
      !exact(value.digests, ['decisionSupport','run','alertPolicy','alertEvent','advice',
        'exportPacket','timeline','bundle','drilldown']) ||
      ['decisionSupport','run','alertPolicy','alertEvent','advice','exportPacket','drilldown']
        .some(key => value.digests[key] !== null) ||
      value.digests.timeline !== value.anchor.timelineDigest ||
      value.digests.bundle !== value.anchor.bundleDigest ||
      value.alertIssued !== false || value.recommendationIssued !== false ||
      value.exportIssued !== false || value.zeroEvidenceAccepted !== false ||
      value.probabilityOrConfidenceIssued !== false ||
      value.automaticActionAuthorized !== false ||
      value.outboundCommunicationAuthorized !== false ||
      value.reviewedHandoffAuthorized !== false || value.researchOnly !== true) return null;
  return value;
}

function failure(res, error) {
  const status = error?.code === '42501' ? 403 : error?.code === '22023' ? 400 :
    error?.code === '40001' ? 409 : 503;
  return res.status(status).json({ success: false, error: {
    category: status === 403 ? 'FORECAST_DECISION_SUPPORT_RESTRICTED' :
      status === 400 ? 'FORECAST_DECISION_SUPPORT_REQUEST_INVALID' :
        status === 409 ? 'FORECAST_DECISION_SUPPORT_CHANGED' :
          'FORECAST_DECISION_SUPPORT_UNAVAILABLE',
    message: status === 403 ?
      'Forecast alerts, advice and exports are limited to current owners and administrators.' :
      status === 400 ? 'Check the forecast decision-support request and try again.' :
        status === 409 ? 'The forecast evidence changed. Refresh and try again.' :
          'Forecast decision support is temporarily unavailable.',
  } });
}

function createForecastDecisionSupportRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const auth = options.auth || requireOnboardedInternal;
  const permission = options.permission || requirePermission('forecast', 'read');
  const ownerAdmin = options.ownerAdmin || ((req, res, next) =>
    ROLES.has(req.userRole) ? next() : failure(res, { code: '42501' }));
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `forecast-decision-support:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Cookie');
    next();
  });
  router.get('/:originId', auth, permission, ownerAdmin, throttle, async (req, res) => {
    if (!UUID.test(req.params.originId || '') || !exact(req.query, [])) {
      return failure(res, { code: '22023' });
    }
    let client;
    try {
      client = await poolProvider().connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const raw = (await client.query(
        `SELECT public.canonical_forecast_monthly_kpis_v1_read(
         $1,$2,$3,$4,$5) value`, [req.tenantContext.organizationId,
          req.tenantContext.userId, req.userRole, req.authSession.id,
          req.params.originId])).rows[0]?.value;
      if (raw === null || raw === undefined) {
        await client.query('COMMIT');
        return res.status(404).json({ success: false, error: {
          category: 'FORECAST_DECISION_SUPPORT_NOT_FOUND',
          message: 'This forecast decision-support anchor was not found.',
        } });
      }
      const drilldowns = projectForecastDrilldowns(raw);
      const value = sanitizeForecastDecisionSupport(projectForecastDecisionSupport(
        drilldowns, { userId: req.tenantContext.userId, role: req.userRole }));
      if (!value) throw new Error('Invalid guarded forecast decision-support projection');
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: value });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return failure(res, error);
    } finally { if (client) client.release(); }
  });
  return router;
}

module.exports = { VERSION, TARGET_KEYS, PREREQUISITES, EXCLUDED_EXPORT_FIELDS,
  createForecastDecisionSupportRouter, projectForecastDecisionSupport,
  sanitizeForecastDecisionSupport };
