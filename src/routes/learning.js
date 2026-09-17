'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const contract = require('../learning/laborOutcomeContract');
const repository = require('../learning/laborOutcomeRepository');
const importContract = require('../learning/externalLaborImportContract');
const importRepository = require('../learning/externalLaborImportRepository');
const csvContract = require('../learning/externalLaborCsvContract');
const operationsContract = require('../learning/externalLaborOperationsContract');
const operationsRepository = require('../learning/externalLaborOperationsRepository');
const reconciliationContract = require('../learning/externalLaborReconciliationContract');
const reconciliationRepository = require('../learning/externalLaborReconciliationRepository');
const importedOutcomeContract = require('../learning/importedLaborOutcomeContract');
const importedOutcomeRepository = require('../learning/importedLaborOutcomeRepository');
const calibrationContract = require('../learning/importedLaborCalibrationContract');
const calibrationRepository = require('../learning/importedLaborCalibrationRepository');
const learningCenterRepository = require('../learning/learningCenterRepository');
const travelImportContract = require('../learning/externalTravelImportContract');
const travelImportRepository = require('../learning/externalTravelImportRepository');
const travelMatchContract = require('../learning/externalTravelReconciliationContract');
const travelMatchRepository = require('../learning/externalTravelReconciliationRepository');
const importedTravelOutcomeContract = require('../learning/importedTravelOutcomeContract');
const importedTravelOutcomeRepository = require('../learning/importedTravelOutcomeRepository');
const importedTravelCalibrationContract = require('../learning/importedTravelCalibrationContract');
const importedTravelCalibrationRepository = require('../learning/importedTravelCalibrationRepository');
const travelOperationsContract = require('../learning/externalTravelOperationsContract');
const travelOperationsRepository = require('../learning/externalTravelOperationsRepository');
const nativeEquipmentContract = require('../learning/nativeEquipmentUtilizationContract');
const nativeEquipmentRepository = require('../learning/nativeEquipmentUtilizationRepository');
const nativeMaterialContract = require('../learning/nativeMaterialOutcomeContract');
const nativeMaterialRepository = require('../learning/nativeMaterialOutcomeRepository');
const materialImportContract = require('../learning/externalMaterialImportContract');
const materialImportRepository = require('../learning/externalMaterialImportRepository');
const crmFieldServiceImportContract = require('../learning/externalCrmFieldServiceImportContract');
const crmFieldServiceImportRepository = require('../learning/externalCrmFieldServiceImportRepository');
const projectChangeOrderImportContract = require('../learning/externalProjectChangeOrderImportContract');
const projectChangeOrderImportRepository = require('../learning/externalProjectChangeOrderImportRepository');
const communicationImportContract = require('../learning/externalCommunicationImportContract');
const communicationImportRepository = require('../learning/externalCommunicationImportRepository');
const financialImportContract = require('../learning/externalFinancialImportContract');
const financialImportRepository = require('../learning/externalFinancialImportRepository');
const businessMatchContract = require('../learning/externalBusinessReconciliationContract');
const businessMatchRepository = require('../learning/externalBusinessReconciliationRepository');
const customerOutcomeContract = require('../learning/externalCustomerOutcomeContract');
const customerOutcomeRepository = require('../learning/externalCustomerOutcomeRepository');
const materialOperationsContract = require('../learning/externalMaterialOperationsContract');
const materialOperationsRepository = require('../learning/externalMaterialOperationsRepository');
const materialMatchContract = require('../learning/externalMaterialReconciliationContract');
const materialMatchRepository = require('../learning/externalMaterialReconciliationRepository');
const importedMaterialQuantityContract = require('../learning/importedMaterialQuantityContract');
const importedMaterialQuantityRepository = require('../learning/importedMaterialQuantityRepository');
const importedMaterialCostContract = require('../learning/importedMaterialCostContract');
const importedMaterialCostRepository = require('../learning/importedMaterialCostRepository');
const importedMaterialCalibrationContract = require('../learning/importedMaterialCalibrationContract');
const importedMaterialCalibrationRepository = require('../learning/importedMaterialCalibrationRepository');
const assetImportContract = require('../learning/externalAssetImportContract');
const assetImportRepository = require('../learning/externalAssetImportRepository');
const assetOperationsContract = require('../learning/externalAssetOperationsContract');
const assetOperationsRepository = require('../learning/externalAssetOperationsRepository');
const assetMatchContract = require('../learning/externalAssetReconciliationContract');
const assetMatchRepository = require('../learning/externalAssetReconciliationRepository');
const importedAssetOutcomeContract = require('../learning/importedAssetOutcomeContract');
const importedAssetOutcomeRepository = require('../learning/importedAssetOutcomeRepository');
const importedAssetHealthContract = require('../learning/importedAssetHealthContract');
const importedAssetHealthRepository = require('../learning/importedAssetHealthRepository');
const importedAssetCalibrationContract = require('../learning/importedAssetCalibrationContract');
const importedAssetCalibrationRepository = require('../learning/importedAssetCalibrationRepository');

function requestId(req) {
  const value = String(req.requestId || req.correlationId || 'unavailable');
  return /^[ -~]{1,128}$/.test(value) ? value : 'unavailable';
}

function actor(req) {
  const authority = req.accountAuthority || {};
  const tenant = req.tenantContext || {};
  return {
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    actorAccessRole: req.userRole,
    authSessionId: req.authSession && req.authSession.id,
    membershipId: authority.membership_id || null,
  };
}

function replyError(req, res, error) {
  const status = Number.isInteger(error && (error.status || error.statusCode)) ? (error.status || error.statusCode) : 503;
  const code = error && error.code || 'M25_LEARNING_UNAVAILABLE';
  const unavailable = code.startsWith('M25_EXTERNAL_CUSTOMER_OUTCOME_') ? 'Customer outcome learning is temporarily unavailable.' :
    code.startsWith('M25_FINANCIAL_IMPORT_') ? 'External financial evidence is temporarily unavailable.' :
    code.startsWith('M25_BUSINESS_MATCH_') ? 'External business reference review is temporarily unavailable.' :
    code.startsWith('M25_COMMUNICATION_IMPORT_') ? 'External communication evidence is temporarily unavailable.' :
    code.startsWith('M25_PROJECT_CHANGE_ORDER_IMPORT_') ? 'External project and change-order evidence is temporarily unavailable.' :
    code.startsWith('M25_CRM_FIELD_SERVICE_IMPORT_') ? 'External CRM and field-service evidence is temporarily unavailable.' :
    code.startsWith('M25_MATERIAL_MATCH_') ? 'Material reference review is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_MATERIAL_OUTCOME_') ? 'Imported material outcome learning is temporarily unavailable.' :
    code.startsWith('M25_MATERIAL_IMPORT_OPERATIONS_') ? 'Material source operations are temporarily unavailable.' :
    code.startsWith('M25_MATERIAL_IMPORT_') ? 'External material evidence is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_ASSET_CALIBRATION_') ? 'Vehicle and equipment calibration is temporarily unavailable.' :
    code.startsWith('M25_NATIVE_MATERIAL_') ? 'Material outcome learning is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_ASSET_OUTCOME_') ? 'Imported vehicle and equipment outcome learning is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_ASSET_HEALTH_') ? 'Imported asset health learning is temporarily unavailable.' :
    code.startsWith('M25_NATIVE_EQUIPMENT_') ? 'Native equipment utilization learning is temporarily unavailable.' :
    code.startsWith('M25_ASSET_MATCH_') ? 'Vehicle and equipment reconciliation is temporarily unavailable.' :
    code.startsWith('M25_ASSET_IMPORT_OPERATIONS_') ? 'Vehicle and equipment source operations are temporarily unavailable.' :
    code.startsWith('M25_ASSET_IMPORT_') ? 'External vehicle and equipment evidence is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_TRAVEL_CALIBRATION_') ? 'Imported travel calibration is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_CALIBRATION_') ? 'Imported labor calibration is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_TRAVEL_OUTCOME_') ? 'Imported travel outcome learning is temporarily unavailable.' :
    code.startsWith('M25_TRAVEL_MATCH_') ? 'External travel reconciliation is temporarily unavailable.' :
    code.startsWith('M25_TRAVEL_IMPORT_') ? 'External travel evidence is temporarily unavailable.' :
    code.startsWith('M25_IMPORTED_OUTCOME_') ? 'Imported labor outcome learning is temporarily unavailable.' :
    code.startsWith('M25_MATCH_') ? 'External labor reconciliation is temporarily unavailable.' :
    code.startsWith('M25_IMPORT_') ? 'External labor imports are temporarily unavailable.' :
      'Labor outcome learning is temporarily unavailable.';
  return res.status(status).json({ success: false, requestId: requestId(req), error: {
    code,
    message: status === 503 ? unavailable : error.message,
  } });
}

function createLearningRouter(options = {}) {
  const router = express.Router();
  const poolProvider = typeof options.poolProvider === 'function' ? options.poolProvider : () => db.getPool();
  const tenantAuth = options.tenantAuth || requireTenantAccess;
  const mutationAuth = options.mutationAuth || requireOnboardedInternal;
  const permission = options.permission || requirePermission;
  const throttle = options.throttle || rateLimit('internal-api', req =>
    `learning:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const headers = (_req, res, next) => { res.set('Cache-Control', 'no-store, private'); res.vary('Cookie'); next(); };
  const ownerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('Labor outcome learning is restricted to current owners and administrators.'),
      { code: 'M25_LEARNING_FORBIDDEN', status: 403 }));
  const importOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External labor imports are restricted to current owners and administrators.'),
      { code: 'M25_IMPORT_FORBIDDEN', status: 403 }));
  const travelOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External travel evidence is restricted to current owners and administrators.'),
      { code: 'M25_TRAVEL_IMPORT_FORBIDDEN', status: 403 }));
  const assetOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External vehicle and equipment evidence is restricted to current owners and administrators.'),
      { code: 'M25_ASSET_IMPORT_FORBIDDEN', status: 403 }));
  const materialImportOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External material evidence is restricted to current owners and administrators.'),
      { code: 'M25_MATERIAL_IMPORT_FORBIDDEN', status: 403 }));
  const crmFieldServiceImportOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External CRM and field-service evidence is restricted to current owners and administrators.'),
      { code: 'M25_CRM_FIELD_SERVICE_IMPORT_FORBIDDEN', status: 403 }));
  const projectChangeOrderImportOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External project and change-order evidence is restricted to current owners and administrators.'),
      { code: 'M25_PROJECT_CHANGE_ORDER_IMPORT_FORBIDDEN', status: 403 }));
  const communicationImportOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External communication evidence is restricted to current owners and administrators.'),
      { code: 'M25_COMMUNICATION_IMPORT_FORBIDDEN', status: 403 }));
  const financialImportOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External financial evidence is restricted to current owners and administrators.'),
      { code: 'M25_FINANCIAL_IMPORT_FORBIDDEN', status: 403 }));
  const businessMatchOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('External business reference review is restricted to current owners and administrators.'),
      { code: 'M25_BUSINESS_MATCH_FORBIDDEN', status: 403 }));
  const customerOutcomeOwnerOnly = (req, res, next) => ['owner', 'admin'].includes(req.userRole) ? next() : replyError(req, res,
    Object.assign(new Error('Customer outcome learning is restricted to current owners and administrators.'),
      { code: 'M25_EXTERNAL_CUSTOMER_OUTCOME_FORBIDDEN', status: 403 }));

  router.get('/external-customer-outcome-sources/:crmSourceKey/:communicationSourceKey/consent', headers, tenantAuth, customerOutcomeOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const normalized = customerOutcomeContract.normalizeSources(req.params.crmSourceKey, req.params.communicationSourceKey);
        const data = await customerOutcomeRepository.readConsent(poolProvider(), { ...actor(req), ...normalized });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-customer-outcome-sources/:crmSourceKey/:communicationSourceKey/consent', headers, mutationAuth, customerOutcomeOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = customerOutcomeContract.normalizeConsent(req.params.crmSourceKey, req.params.communicationSourceKey, req.body);
        const { crmSourceKey, communicationSourceKey, ...body } = normalized;
        const data = await customerOutcomeRepository.mutateConsent(poolProvider(), { ...actor(req), crmSourceKey, communicationSourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-customer-outcome-sources/:crmSourceKey/:communicationSourceKey/outcomes/:estimateId', headers, tenantAuth, customerOutcomeOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const normalized = customerOutcomeContract.normalizeRead(req.params.crmSourceKey, req.params.communicationSourceKey, req.params.estimateId,
          req.query.crmEstimateReference, req.query.communicationEstimateReference);
        const data = await customerOutcomeRepository.readOutcome(poolProvider(), { ...actor(req), ...normalized });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-customer-outcome-sources/:crmSourceKey/:communicationSourceKey/outcomes', headers, mutationAuth, customerOutcomeOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = customerOutcomeContract.normalizeObservation(req.params.crmSourceKey, req.params.communicationSourceKey, req.body);
        const { crmSourceKey, communicationSourceKey, ...input } = normalized;
        const data = await customerOutcomeRepository.observe(poolProvider(), { ...actor(req), crmSourceKey, communicationSourceKey, ...input,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-business-sources/:sourceClass/:sourceKey/matches', headers, tenantAuth, businessMatchOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceClass = businessMatchContract.normalizeSourceClass(req.params.sourceClass);
        const sourceKey = businessMatchContract.normalizeSourceKey(req.params.sourceKey);
        const data = await businessMatchRepository.readMatches(poolProvider(), { ...actor(req), sourceClass, sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-business-sources/:sourceClass/:sourceKey/matches', headers, mutationAuth, businessMatchOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = businessMatchContract.normalizeMatch(req.params.sourceClass, req.params.sourceKey, req.body);
        const { sourceClass, sourceKey, ...body } = normalized;
        const data = await businessMatchRepository.mutateMatch(poolProvider(), { ...actor(req), sourceClass, sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-financial-sources/:sourceKey/consent', headers, tenantAuth, financialImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = financialImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await financialImportRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-financial-sources/:sourceKey/consent', headers, mutationAuth, financialImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = financialImportContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await financialImportRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-financial-sources/:sourceKey/batches', headers, mutationAuth, financialImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = financialImportContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await financialImportRepository.importBatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-financial-sources/:sourceKey', headers, tenantAuth, financialImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = financialImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await financialImportRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-communication-sources/:sourceKey/consent', headers, tenantAuth, communicationImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = communicationImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await communicationImportRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-communication-sources/:sourceKey/consent', headers, mutationAuth, communicationImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = communicationImportContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await communicationImportRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-communication-sources/:sourceKey/batches', headers, mutationAuth, communicationImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = communicationImportContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await communicationImportRepository.importBatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-communication-sources/:sourceKey', headers, tenantAuth, communicationImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = communicationImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await communicationImportRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-project-change-order-sources/:sourceKey/consent', headers, tenantAuth, projectChangeOrderImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = projectChangeOrderImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await projectChangeOrderImportRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-project-change-order-sources/:sourceKey/consent', headers, mutationAuth, projectChangeOrderImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = projectChangeOrderImportContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await projectChangeOrderImportRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-project-change-order-sources/:sourceKey/batches', headers, mutationAuth, projectChangeOrderImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = projectChangeOrderImportContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await projectChangeOrderImportRepository.importBatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-project-change-order-sources/:sourceKey', headers, tenantAuth, projectChangeOrderImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = projectChangeOrderImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await projectChangeOrderImportRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-crm-field-service-sources/:sourceKey/consent', headers, tenantAuth, crmFieldServiceImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = crmFieldServiceImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await crmFieldServiceImportRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-crm-field-service-sources/:sourceKey/consent', headers, mutationAuth, crmFieldServiceImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = crmFieldServiceImportContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await crmFieldServiceImportRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-crm-field-service-sources/:sourceKey/batches', headers, mutationAuth, crmFieldServiceImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = crmFieldServiceImportContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await crmFieldServiceImportRepository.importBatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-crm-field-service-sources/:sourceKey', headers, tenantAuth, crmFieldServiceImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = crmFieldServiceImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await crmFieldServiceImportRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/native-equipment-utilization-consent', headers, tenantAuth, ownerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const data = await nativeEquipmentRepository.readConsent(poolProvider(), actor(req));
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/native-equipment-utilization-consent', headers, mutationAuth, ownerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const body = nativeEquipmentContract.normalizeConsent(req.body);
        const data = await nativeEquipmentRepository.mutateConsent(poolProvider(), { ...actor(req), body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/estimates/:estimateId/native-equipment-utilization-outcomes', headers, tenantAuth, ownerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const estimateId = nativeEquipmentContract.normalizeEstimateId(req.params.estimateId);
        const data = await nativeEquipmentRepository.readOutcome(poolProvider(), { ...actor(req), estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/estimates/:estimateId/native-equipment-utilization-outcomes', headers, mutationAuth, ownerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = nativeEquipmentContract.normalizeObservation(req.params.estimateId, req.body);
        const data = await nativeEquipmentRepository.observe(poolProvider(), { ...actor(req), ...normalized,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/native-material-outcome-consent', headers, tenantAuth, ownerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const data = await nativeMaterialRepository.readConsent(poolProvider(), actor(req));
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/native-material-outcome-consent', headers, mutationAuth, ownerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const body = nativeMaterialContract.normalizeConsent(req.body);
        const data = await nativeMaterialRepository.mutateConsent(poolProvider(), { ...actor(req), body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/estimates/:estimateId/executions/:executionId/native-material-outcomes', headers, tenantAuth, ownerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const ids = nativeMaterialContract.normalizeIds(req.params.estimateId, req.params.executionId);
        const data = await nativeMaterialRepository.readOutcome(poolProvider(), { ...actor(req), ...ids });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/estimates/:estimateId/executions/:executionId/native-material-outcomes', headers, mutationAuth, ownerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = nativeMaterialContract.normalizeObservation(req.params.estimateId, req.params.executionId, req.body);
        const data = await nativeMaterialRepository.observe(poolProvider(), { ...actor(req), ...normalized,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-material-sources/:sourceKey/consent', headers, tenantAuth, materialImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await materialImportRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/consent', headers, mutationAuth, materialImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = materialImportContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await materialImportRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/batches', headers, mutationAuth, materialImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = materialImportContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await materialImportRepository.importBatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-material-sources/:sourceKey', headers, tenantAuth, materialImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await materialImportRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-material-sources/:sourceKey/operations', headers, tenantAuth, materialImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try { const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await materialOperationsRepository.read(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  const materialOperationMutation = (path, normalize, mutate) => router.post(path, headers, mutationAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try { const normalized = normalize(req.params.sourceKey, req.body); const { sourceKey, ...body } = normalized;
        const data = await mutate(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  materialOperationMutation('/external-material-sources/:sourceKey/adapter', materialOperationsContract.normalizeAdapter, materialOperationsRepository.mutateAdapter);
  materialOperationMutation('/external-material-sources/:sourceKey/retention', materialOperationsContract.normalizeRetention, materialOperationsRepository.mutateRetention);
  materialOperationMutation('/external-material-sources/:sourceKey/deletion', materialOperationsContract.normalizeDeletion, materialOperationsRepository.mutateDeletion);
  materialOperationMutation('/external-material-sources/:sourceKey/hold', materialOperationsContract.normalizeHold, materialOperationsRepository.mutateHold);
  materialOperationMutation('/external-material-sources/:sourceKey/cleanup', materialOperationsContract.normalizeCleanup, materialOperationsRepository.executeCleanup);

  router.get('/external-material-sources/:sourceKey/matches', headers, tenantAuth, materialImportOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await materialMatchRepository.readMatches(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/matches', headers, mutationAuth, materialImportOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = materialMatchContract.normalizeMatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await materialMatchRepository.mutateMatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-material-sources/:sourceKey/imported-material-quantity-consent', headers, tenantAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try { const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedMaterialQuantityRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/imported-material-quantity-consent', headers, mutationAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try { const normalized = importedMaterialQuantityContract.normalizeConsent(req.params.sourceKey, req.body); const { sourceKey, ...body } = normalized;
        const data = await importedMaterialQuantityRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true'); return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-material-sources/:sourceKey/estimates/:estimateId/imported-material-quantity-outcomes', headers,
    tenantAuth, materialImportOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try { const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey); const estimateId = importedMaterialQuantityContract.normalizeEstimateId(req.params.estimateId);
        const data = await importedMaterialQuantityRepository.readOutcome(poolProvider(), { ...actor(req), sourceKey, estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/estimates/:estimateId/imported-material-quantity-outcomes', headers,
    mutationAuth, materialImportOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try { const normalized = importedMaterialQuantityContract.normalizeObservation(req.params.sourceKey, req.params.estimateId, req.body);
        const data = await importedMaterialQuantityRepository.observe(poolProvider(), { ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true'); return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-material-sources/:sourceKey/imported-material-cost-consent', headers, tenantAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try { const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey); const data = await importedMaterialCostRepository.readConsent(poolProvider(), { ...actor(req), sourceKey }); return res.json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/imported-material-cost-consent', headers, mutationAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try { const normalized = importedMaterialCostContract.normalizeConsent(req.params.sourceKey, req.body); const { sourceKey, ...body } = normalized; const data = await importedMaterialCostRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') }); if (data.replayed) res.set('Idempotency-Replayed', 'true'); return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-material-sources/:sourceKey/estimates/:estimateId/imported-material-cost-observations', headers,
    tenantAuth, materialImportOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try { const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey); const estimateId = importedMaterialCostContract.normalizeEstimateId(req.params.estimateId); const data = await importedMaterialCostRepository.readOutcome(poolProvider(), { ...actor(req), sourceKey, estimateId }); return res.json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/estimates/:estimateId/imported-material-cost-observations', headers,
    mutationAuth, materialImportOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try { const normalized = importedMaterialCostContract.normalizeObservation(req.params.sourceKey, req.params.estimateId, req.body); const data = await importedMaterialCostRepository.observe(poolProvider(), { ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') }); if (data.replayed) res.set('Idempotency-Replayed', 'true'); return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-material-sources/:sourceKey/imported-material-calibration-consent', headers, tenantAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'read'),
    async (req, res) => {
      try { const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey); const data = await importedMaterialCalibrationRepository.readConsent(poolProvider(), { ...actor(req), sourceKey }); return res.json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/imported-material-calibration-consent', headers, mutationAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'update'),
    async (req, res) => {
      try { const normalized = importedMaterialCalibrationContract.normalizeConsent(req.params.sourceKey, req.body); const { sourceKey, ...body } = normalized; const data = await importedMaterialCalibrationRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') }); if (data.replayed) res.set('Idempotency-Replayed', 'true'); return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-material-sources/:sourceKey/imported-material-calibrations/:serviceKey', headers, tenantAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'read'),
    async (req, res) => {
      try { const sourceKey = materialImportContract.normalizeSourceKey(req.params.sourceKey); const serviceKey = importedMaterialCalibrationContract.normalizeServiceKey(req.params.serviceKey); const data = await importedMaterialCalibrationRepository.read(poolProvider(), { ...actor(req), sourceKey, serviceKey }); return res.json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-material-sources/:sourceKey/imported-material-calibrations/:serviceKey', headers, mutationAuth,
    materialImportOwnerOnly, throttle, permission('operations', 'update'),
    async (req, res) => {
      try { const normalized = importedMaterialCalibrationContract.normalizeProposal(req.params.sourceKey, req.params.serviceKey, req.body); const data = await importedMaterialCalibrationRepository.propose(poolProvider(), { ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') }); if (data.replayed) res.set('Idempotency-Replayed', 'true'); return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) }); } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-asset-sources/:sourceKey/consent', headers, tenantAuth, assetOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await assetImportRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-asset-sources/:sourceKey/consent', headers, mutationAuth, assetOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = assetImportContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await assetImportRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-asset-sources/:sourceKey/batches', headers, mutationAuth, assetOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = assetImportContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await assetImportRepository.importBatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-asset-sources/:sourceKey', headers, tenantAuth, assetOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await assetImportRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-asset-sources/:sourceKey/operations', headers, tenantAuth, assetOwnerOnly, throttle,
    permission('learning', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await assetOperationsRepository.read(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  const assetOperationMutation = (path, normalizer, method) => router.post(path, headers, mutationAuth,
    assetOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = normalizer(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await method(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  assetOperationMutation('/external-asset-sources/:sourceKey/adapter', assetOperationsContract.normalizeAdapter,
    assetOperationsRepository.mutateAdapter);
  assetOperationMutation('/external-asset-sources/:sourceKey/retention', assetOperationsContract.normalizeRetention,
    assetOperationsRepository.mutateRetention);
  assetOperationMutation('/external-asset-sources/:sourceKey/deletion', assetOperationsContract.normalizeDeletion,
    assetOperationsRepository.mutateDeletion);
  assetOperationMutation('/external-asset-sources/:sourceKey/cleanup', assetOperationsContract.normalizeCleanup,
    assetOperationsRepository.executeCleanup);

  router.get('/external-asset-sources/:sourceKey/matches', headers, tenantAuth, assetOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await assetMatchRepository.readMatches(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-asset-sources/:sourceKey/matches', headers, mutationAuth, assetOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = assetMatchContract.normalizeMatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await assetMatchRepository.mutateMatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-asset-sources/:sourceKey/imported-utilization-cost-consent', headers, tenantAuth,
    assetOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedAssetOutcomeRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-asset-sources/:sourceKey/imported-utilization-cost-consent', headers, mutationAuth,
    assetOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedAssetOutcomeContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importedAssetOutcomeRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-asset-sources/:sourceKey/estimates/:estimateId/imported-utilization-cost-outcomes', headers,
    tenantAuth, assetOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const estimateId = importedAssetOutcomeContract.normalizeEstimateId(req.params.estimateId);
        const data = await importedAssetOutcomeRepository.readOutcome(poolProvider(), { ...actor(req), sourceKey, estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-asset-sources/:sourceKey/estimates/:estimateId/imported-utilization-cost-outcomes', headers,
    mutationAuth, assetOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedAssetOutcomeContract.normalizeObservation(req.params.sourceKey, req.params.estimateId, req.body);
        const data = await importedAssetOutcomeRepository.observe(poolProvider(), { ...actor(req), ...normalized,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-asset-sources/:sourceKey/imported-asset-health-consent', headers, tenantAuth,
    assetOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedAssetHealthRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-asset-sources/:sourceKey/imported-asset-health-consent', headers, mutationAuth,
    assetOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedAssetHealthContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importedAssetHealthRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.get('/external-asset-sources/:sourceKey/imported-asset-health-outcomes', headers, tenantAuth,
    assetOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const normalized = importedAssetHealthContract.normalizeAsset(req.params.sourceKey, req.query.assetCategory, req.query.externalAssetReference);
        const data = await importedAssetHealthRepository.readOutcome(poolProvider(), { ...actor(req), ...normalized });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });
  router.post('/external-asset-sources/:sourceKey/imported-asset-health-outcomes', headers, mutationAuth,
    assetOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedAssetHealthContract.normalizeObservation(req.params.sourceKey, req.body);
        const data = await importedAssetHealthRepository.observe(poolProvider(), { ...actor(req), ...normalized,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-asset-sources/:sourceKey/imported-asset-calibration-consent', headers, tenantAuth,
    assetOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedAssetCalibrationRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-asset-sources/:sourceKey/imported-asset-calibration-consent', headers, mutationAuth,
    assetOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedAssetCalibrationContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importedAssetCalibrationRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-asset-sources/:sourceKey/imported-asset-calibrations/:serviceKey', headers, tenantAuth,
    assetOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = assetImportContract.normalizeSourceKey(req.params.sourceKey);
        const serviceKey = importedAssetCalibrationContract.normalizeServiceKey(req.params.serviceKey);
        const data = await importedAssetCalibrationRepository.read(poolProvider(), { ...actor(req), sourceKey, serviceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-asset-sources/:sourceKey/imported-asset-calibrations/:serviceKey', headers, mutationAuth,
    assetOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedAssetCalibrationContract.normalizeProposal(req.params.sourceKey, req.params.serviceKey, req.body);
        const data = await importedAssetCalibrationRepository.propose(poolProvider(), { ...actor(req), ...normalized,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-travel-sources/:sourceKey/consent', headers, tenantAuth, travelOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await travelImportRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-travel-sources/:sourceKey/consent', headers, mutationAuth, travelOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = travelImportContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await travelImportRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-travel-sources/:sourceKey/batches', headers, mutationAuth, travelOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = travelImportContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await travelImportRepository.importBatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-travel-sources/:sourceKey', headers, tenantAuth, travelOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await travelImportRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-travel-sources/:sourceKey/operations', headers, tenantAuth, travelOwnerOnly, throttle,
    permission('learning', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await travelOperationsRepository.read(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  const travelOperationMutation = (path, normalizer, method) => router.post(path, headers, mutationAuth,
    travelOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = normalizer(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await method(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  travelOperationMutation('/external-travel-sources/:sourceKey/adapter', travelOperationsContract.normalizeAdapter,
    travelOperationsRepository.mutateAdapter);
  travelOperationMutation('/external-travel-sources/:sourceKey/retention', travelOperationsContract.normalizeRetention,
    travelOperationsRepository.mutateRetention);
  travelOperationMutation('/external-travel-sources/:sourceKey/deletion', travelOperationsContract.normalizeDeletion,
    travelOperationsRepository.mutateDeletion);
  travelOperationMutation('/external-travel-sources/:sourceKey/cleanup', travelOperationsContract.normalizeCleanup,
    travelOperationsRepository.executeCleanup);

  router.get('/external-travel-sources/:sourceKey/matches', headers, tenantAuth, travelOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await travelMatchRepository.readMatches(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-travel-sources/:sourceKey/matches', headers, mutationAuth, travelOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = travelMatchContract.normalizeMatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await travelMatchRepository.mutateMatch(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-travel-sources/:sourceKey/imported-travel-variance-consent', headers, tenantAuth,
    travelOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedTravelOutcomeRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-travel-sources/:sourceKey/imported-travel-variance-consent', headers, mutationAuth,
    travelOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedTravelOutcomeContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importedTravelOutcomeRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-travel-sources/:sourceKey/estimates/:estimateId/imported-travel-outcomes', headers,
    tenantAuth, travelOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const estimateId = importedTravelOutcomeContract.normalizeEstimateId(req.params.estimateId);
        const data = await importedTravelOutcomeRepository.readOutcome(poolProvider(), { ...actor(req), sourceKey, estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-travel-sources/:sourceKey/estimates/:estimateId/imported-travel-outcomes', headers,
    mutationAuth, travelOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedTravelOutcomeContract.normalizeObservation(req.params.sourceKey, req.params.estimateId, req.body);
        const data = await importedTravelOutcomeRepository.observe(poolProvider(), { ...actor(req), ...normalized,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-travel-sources/:sourceKey/imported-travel-calibration-consent', headers, tenantAuth,
    travelOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedTravelCalibrationRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-travel-sources/:sourceKey/imported-travel-calibration-consent', headers, mutationAuth,
    travelOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedTravelCalibrationContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importedTravelCalibrationRepository.mutateConsent(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-travel-sources/:sourceKey/imported-travel-calibrations/:serviceKey', headers, tenantAuth,
    travelOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = travelImportContract.normalizeSourceKey(req.params.sourceKey);
        const serviceKey = importedTravelCalibrationContract.normalizeServiceKey(req.params.serviceKey);
        const data = await importedTravelCalibrationRepository.read(poolProvider(), { ...actor(req), sourceKey, serviceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-travel-sources/:sourceKey/imported-travel-calibrations/:serviceKey', headers, mutationAuth,
    travelOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedTravelCalibrationContract.normalizeProposal(req.params.sourceKey, req.params.serviceKey, req.body);
        const data = await importedTravelCalibrationRepository.propose(poolProvider(), { ...actor(req), ...normalized,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/center', headers, tenantAuth, ownerOnly, throttle, permission('learning', 'read'), async (req, res) => {
    try {
      const data = await learningCenterRepository.read(poolProvider(), actor(req));
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) { return replyError(req, res, error); }
  });

  router.get('/labor-duration-consent', headers, tenantAuth, ownerOnly, throttle, permission('operations', 'read'), async (req, res) => {
    try {
      const data = await repository.readConsent(poolProvider(), actor(req));
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) { return replyError(req, res, error); }
  });

  router.post('/labor-duration-consent', headers, mutationAuth, ownerOnly, throttle, permission('operations', 'update'), async (req, res) => {
    try {
      const body = contract.normalizeConsent(req.body);
      const data = await repository.mutateConsent(poolProvider(), {
        ...actor(req), csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
      }, body);
      if (data.replayed) res.set('Idempotency-Replayed', 'true');
      return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
    } catch (error) { return replyError(req, res, error); }
  });

  router.get('/estimates/:estimateId/labor-duration-outcomes', headers, tenantAuth, ownerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const estimateId = contract.normalizeEstimateId(req.params.estimateId);
        const data = await repository.readOutcome(poolProvider(), { ...actor(req), estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/estimates/:estimateId/labor-duration-outcomes', headers, mutationAuth, ownerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = contract.normalizeObservation(req.params.estimateId, req.body);
        const data = await repository.observe(poolProvider(), {
          ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/consent', headers, tenantAuth, importOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/consent', headers, mutationAuth, importOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importRepository.mutateConsent(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'),
          idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/batches', headers, mutationAuth, importOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importContract.normalizeBatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importRepository.importBatch(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'),
          idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/csv-backfill', headers, mutationAuth, importOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const consent = await importRepository.readConsent(poolProvider(), {
          ...actor(req), sourceKey: importContract.normalizeSourceKey(req.params.sourceKey),
        });
        const current = consent && consent.current;
        const normalized = csvContract.normalizeCsvBackfill(req.params.sourceKey, {
          ...req.body,
          expectedConsentRevision: current ? current.revision : 0,
          expectedConsentDigest: current ? current.digest : 'none',
        });
        const { sourceKey, ...body } = normalized;
        const data = await importRepository.importBatch(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'),
          idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey', headers, tenantAuth, importOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importRepository.readSource(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/operations', headers, tenantAuth, importOwnerOnly, throttle,
    permission('learning', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await operationsRepository.read(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  const operationMutation = (path, normalizer, method) => router.post(path, headers, mutationAuth,
    importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = normalizer(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await method(poolProvider(), { ...actor(req), sourceKey, body,
          csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key') });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  operationMutation('/external-labor-sources/:sourceKey/adapter', operationsContract.normalizeAdapter,
    operationsRepository.mutateAdapter);
  operationMutation('/external-labor-sources/:sourceKey/retention', operationsContract.normalizeRetention,
    operationsRepository.mutateRetention);
  operationMutation('/external-labor-sources/:sourceKey/deletion', operationsContract.normalizeDeletion,
    operationsRepository.mutateDeletion);
  operationMutation('/external-labor-sources/:sourceKey/cleanup', operationsContract.normalizeCleanup,
    operationsRepository.executeCleanup);

  router.get('/external-labor-sources/:sourceKey/matches', headers, tenantAuth, importOwnerOnly, throttle,
    permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await reconciliationRepository.readMatches(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/matches', headers, mutationAuth, importOwnerOnly, throttle,
    permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = reconciliationContract.normalizeMatch(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await reconciliationRepository.mutateMatch(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'),
          idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/imported-labor-duration-consent', headers, tenantAuth,
    importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await importedOutcomeRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/imported-labor-duration-consent', headers, mutationAuth,
    importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedOutcomeContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await importedOutcomeRepository.mutateConsent(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/estimates/:estimateId/imported-labor-duration-outcomes',
    headers, tenantAuth, importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const estimateId = importedOutcomeContract.normalizeEstimateId(req.params.estimateId);
        const data = await importedOutcomeRepository.readOutcome(poolProvider(), { ...actor(req), sourceKey, estimateId });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/estimates/:estimateId/imported-labor-duration-outcomes',
    headers, mutationAuth, importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = importedOutcomeContract.normalizeObservation(req.params.sourceKey, req.params.estimateId, req.body);
        const data = await importedOutcomeRepository.observe(poolProvider(), {
          ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/imported-labor-calibration-consent', headers, tenantAuth,
    importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const data = await calibrationRepository.readConsent(poolProvider(), { ...actor(req), sourceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/imported-labor-calibration-consent', headers, mutationAuth,
    importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = calibrationContract.normalizeConsent(req.params.sourceKey, req.body);
        const { sourceKey, ...body } = normalized;
        const data = await calibrationRepository.mutateConsent(poolProvider(), {
          ...actor(req), sourceKey, body, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.get('/external-labor-sources/:sourceKey/imported-labor-calibrations/:serviceKey', headers, tenantAuth,
    importOwnerOnly, throttle, permission('operations', 'read'), async (req, res) => {
      try {
        const sourceKey = importContract.normalizeSourceKey(req.params.sourceKey);
        const serviceKey = calibrationContract.normalizeServiceKey(req.params.serviceKey);
        const data = await calibrationRepository.read(poolProvider(), { ...actor(req), sourceKey, serviceKey });
        return res.json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  router.post('/external-labor-sources/:sourceKey/imported-labor-calibrations/:serviceKey', headers, mutationAuth,
    importOwnerOnly, throttle, permission('operations', 'update'), async (req, res) => {
      try {
        const normalized = calibrationContract.normalizeProposal(req.params.sourceKey, req.params.serviceKey, req.body);
        const data = await calibrationRepository.propose(poolProvider(), {
          ...actor(req), ...normalized, csrfToken: req.get('X-CSRF-Token'), idempotencyKey: req.get('Idempotency-Key'),
        });
        if (data.replayed) res.set('Idempotency-Replayed', 'true');
        return res.status(data.replayed ? 200 : 201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) { return replyError(req, res, error); }
    });

  return router;
}

module.exports = { createLearningRouter };
