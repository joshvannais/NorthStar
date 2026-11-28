'use strict';

const express = require('express');
const { requireSession, requireVerifiedAccount, requireOnboardedInternal, requireRole } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { EnterpriseLocationRepository, failure } = require('../enterprise/locationRepository');
const { EnterpriseLocationError, uuid } = require('../enterprise/locationContract');
const { requireLocationBody } = require('../enterprise/locationHttpBoundary');

function createEnterpriseLocationsRouter(options = {}) {
  const router = express.Router(), repository = options.repository || new EnterpriseLocationRepository();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.vary('Cookie'); next(); });
  router.use(requireSession, requireVerifiedAccount, requireRole('owner', 'admin'));
  function actor(req) {
    return { organizationId: req.tenantContext.organizationId, actorUserId: req.tenantContext.userId,
      actorAccessRole: req.tenantContext.role, authSessionId: req.authSession.id, csrfToken: req.headers['x-csrf-token'] };
  }
  function fail(req, res, error) {
    const safe = failure(error);
    return res.status(safe.status).json({ success: false, error: { code: safe.code, message: safe.message }, requestId: req.requestId || 'unavailable' });
  }
  router.get('/', requirePermission('settings', 'read'), async (req, res) => {
    try {
      if (req.originalUrl.includes('?')) throw new EnterpriseLocationError(400);
      return res.json({ success: true, data: await repository.read(actor(req)), requestId: req.requestId || 'unavailable' });
    } catch (error) { return fail(req, res, error); }
  });
  router.get('/:locationId/history', requirePermission('settings', 'read'), async (req, res) => {
    try {
      const locationId = uuid(req.params.locationId), parameters = new URL(req.originalUrl, 'http://local.invalid').searchParams;
      const keys = [...parameters.keys()], cursor = parameters.get('beforeRevision');
      if (keys.some(key => key !== 'beforeRevision') || keys.length > 1 ||
          (keys.length && (!/^[1-9][0-9]{0,9}$/.test(cursor) || Number(cursor) > 2147483647))) {
        throw new EnterpriseLocationError(400);
      }
      const before = keys.length ? Number(cursor) : null;
      return res.json({ success: true, data: await repository.read(actor(req), locationId, 'history', before), requestId: req.requestId || 'unavailable' });
    } catch (error) { return fail(req, res, error); }
  });
  router.post('/preview', requireLocationBody, requireOnboardedInternal, requirePermission('settings', 'update'), async (req, res) => {
    try {
      if (req.originalUrl.includes('?')) throw new EnterpriseLocationError(400);
      return res.json({ success: true, data: await repository.preview(actor(req), req.body), requestId: req.requestId || 'unavailable' });
    } catch (error) { return fail(req, res, error); }
  });
  router.post('/commit', requireLocationBody, requireOnboardedInternal, requirePermission('settings', 'update'), async (req, res) => {
    try {
      if (req.originalUrl.includes('?')) throw new EnterpriseLocationError(400);
      let keys = 0; for (let index = 0; index < req.rawHeaders.length; index += 2) if (req.rawHeaders[index].toLowerCase() === 'idempotency-key') keys++;
      if (keys !== 1) throw new EnterpriseLocationError(400);
      const value = await repository.commit(actor(req), req.body, req.headers['idempotency-key']);
      return res.status(value.replayed ? 200 : 201).json({ success: true, data: value, requestId: req.requestId || 'unavailable' });
    } catch (error) { return fail(req, res, error); }
  });
  return router;
}

module.exports = { createEnterpriseLocationsRouter };
