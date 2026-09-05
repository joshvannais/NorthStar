'use strict';

const express = require('express');
const db = require('../db');
const { requireOnboardedInternal, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { rateLimit } = require('../middleware/rateLimit');
const { requireBody } = require('../equipment/httpBoundary');
const { EquipmentRepository } = require('../equipment/repository');
const contract = require('../equipment/contract');

function actor(req) {
  return { organizationId: req.tenantContext.organizationId, userId: req.tenantContext.userId,
    role: req.userRole, sessionId: req.authSession && req.authSession.id, csrfToken: req.get('X-CSRF-Token') };
}
function presentDraft(value) {
  if (!value || !value.document) return value;
  const fields = value.document.identifiers;
  const generic = /^(unknown|truck|trailer|equipment|machine|vehicle)$/i;
  return { ...value, question: contract.nextQuestion(fields), canConfirm: Boolean(fields.manufacturer && fields.model && !generic.test(fields.manufacturer) && !generic.test(fields.model)) };
}
function createEquipmentRouter(options = {}) {
  const router = express.Router();
  const poolProvider = options.poolProvider || (() => db.getPool());
  const repository = () => new EquipmentRepository(poolProvider());
  const throttle = rateLimit('internal-api', req => `equipment:${req.tenantContext.organizationId}:${req.tenantContext.userId}`);
  const read = [requireTenantAccess, throttle, requirePermission('assets', 'read')];
  const write = [requireBody, requireOnboardedInternal, throttle];
  const endpoint = work => async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
      const result = await work(req);
      if (result && result.replayed) res.set('Idempotency-Replayed', 'true');
      return res.json({ success: true, data: result && Object.hasOwn(result, 'data') ? presentDraft(result.data) : result });
    } catch (cause) {
      const failure = cause && cause.status ? cause : contract.error(503, 'EQUIPMENT_UNAVAILABLE', 'Equipment authority is temporarily unavailable.');
      return res.status(failure.status).json({ success: false, error: { code: failure.code, message: failure.message } });
    }
  };
  function key(req) {
    const value = req.get('Idempotency-Key');
    if (typeof value !== 'string' || !/^[!-~]{16,128}$/.test(value)) throw contract.error(400, 'EQUIPMENT_KEY_REQUIRED', 'An idempotency key is required.');
    return value;
  }
  router.get('/catalogue', ...read, endpoint(req => {
    if (Object.keys(req.query).length) throw contract.error(400, 'EQUIPMENT_QUERY_INVALID', 'Equipment catalogue derives its scope from your account.');
    return repository().read(actor(req));
  }));
  router.get('/drafts/:id', ...read, endpoint(async req => ({ data: await repository().read(actor(req), contract.uuid(req.params.id)) })));
  router.post('/drafts', ...write, requirePermission('assets', 'create'), endpoint(async req => {
    const input = contract.normalizeDraft(req.body); const idempotencyKey = key(req);
    // Initial identifiers may be extracted only from literal user input; neither
    // the model nor this route can import or approve universal knowledge.
    const admission = await repository().mutate(actor(req), null, idempotencyKey, input, false, {}, true);
    if (!admission.admitted) return admission;
    const extractor = options.extractIdentifiers;
    let extracted = {};
    if (input.message && extractor) {
      try {
        extracted = await extractor({ actor: actor(req), message: input.message, requestId: idempotencyKey,
          plan: req.accountAuthority && req.accountAuthority.plan_type });
      } catch (_) { extracted = {}; }
    }
    // Re-authorize after the bounded provider wait. Literal draft identifiers
    // enter the same immutable receipt as manual input; the complete draft still
    // needs explicit authorized review before any tenant asset mutation.
    return repository().mutate(actor(req), null, idempotencyKey, input, false, extracted);
  }));
  router.post('/drafts/:id/actions', ...write, requirePermission('assets', 'create'), endpoint(req =>
    repository().mutate(actor(req), contract.uuid(req.params.id), key(req), contract.normalizeDraftAction(req.body))));
  router.post('/executions/:id/actions', ...write, requirePermission('operations', 'update'), endpoint(req =>
    repository().mutate(actor(req), contract.uuid(req.params.id), key(req), contract.normalizeOperation(req.body), true)));
  router.get('/executions/:id', requireTenantAccess, throttle, requirePermission('operations', 'read'), endpoint(req =>
    repository().read(actor(req), null, contract.uuid(req.params.id))));
  return router;
}
module.exports = { createEquipmentRouter, presentDraft };
