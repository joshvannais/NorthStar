'use strict';

const express = require('express');
const { requireAccountMutation, requireRole, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const {
  WorkforceError,
  WorkforcePersistenceError,
  WorkforceService,
} = require('../workforce/service');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function context(req) {
  return {
    organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId,
    requestIp: req.ip || 'unknown',
    requestId: requestId(req),
  };
}

function service(req) {
  const injected = req.app && req.app.locals && req.app.locals.workforceService;
  return injected && typeof injected.snapshot === 'function' ? injected : new WorkforceService();
}

function failure(req, res, error, event) {
  if (error instanceof WorkforceError ||
      (error && Number.isInteger(error.status) && typeof error.code === 'string')) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      requestId: requestId(req),
    });
  }
  if (error instanceof WorkforcePersistenceError ||
      (error && error.name === 'WorkforcePersistenceError')) {
    console.warn('[Workforce] PostgreSQL authority unavailable:', { event, requestId: requestId(req) });
    return res.status(503).json({
      success: false,
      error: { code: 'workforce_authority_unavailable', message: 'Workforce authority is temporarily unavailable' },
      requestId: requestId(req),
    });
  }
  const diagnostic = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(value)
    ? value : 'unexpected';
  console.error('[Workforce] Request failed:', {
    event,
    requestId: requestId(req),
    code: diagnostic(error && error.code),
    constraint: diagnostic(error && error.constraint),
  });
  return res.status(500).json({
    success: false,
    error: { code: 'workforce_request_failed', message: 'Workforce request failed' },
    requestId: requestId(req),
  });
}

function createWorkforceRouter() {
  const router = express.Router();

  router.post('/invitations/accept', async (req, res) => {
    try {
      const accepted = await service(req).acceptInvitation(req.body || {}, {
        requestIp: req.ip || 'unknown',
        requestId: requestId(req),
      });
      return res.json({ success: true, data: accepted, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'invitation_accept_failed');
    }
  });

  router.get('/', requireTenantAccess, requirePermission('team', 'read'), async (req, res) => {
    try {
      return res.json({ success: true, data: await service(req).snapshot(req.tenantContext.organizationId), requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'workforce_read_failed');
    }
  });

  router.post('/invitations', requireAccountMutation, requirePermission('team', 'create'), requireRole('owner'), async (req, res) => {
    try {
      const invited = await service(req).invite(req.body || {}, context(req));
      return res.status(202).json({ success: true, data: invited, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'workforce_invite_failed');
    }
  });

  router.post('/members/:membershipId/resend-invitation', requireAccountMutation,
    requirePermission('team', 'create'), requireRole('owner'), async (req, res) => {
      try {
        const invited = await service(req).resendInvitation(req.params.membershipId, context(req));
        return res.status(202).json({ success: true, data: invited, requestId: requestId(req) });
      } catch (error) {
        return failure(req, res, error, 'workforce_invitation_resend_failed');
      }
    });

  router.patch('/members/:membershipId/access', requireAccountMutation,
    requirePermission('team', 'update'), requireRole('owner'), async (req, res) => {
      try {
        const updated = await service(req).updateAccess(req.params.membershipId, req.body || {}, context(req));
        return res.json({ success: true, data: updated, requestId: requestId(req) });
      } catch (error) {
        return failure(req, res, error, 'workforce_access_update_failed');
      }
    });

  router.put('/profiles/:profileId', requireAccountMutation, requirePermission('team', 'update'), async (req, res) => {
    try {
      const updated = await service(req).updateProfile(req.params.profileId, req.body || {}, context(req));
      return res.json({ success: true, data: updated, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'workforce_profile_update_failed');
    }
  });

  router.post('/skills', requireAccountMutation, requirePermission('team', 'create'), async (req, res) => {
    try {
      const created = await service(req).createSkill(req.body || {}, context(req));
      return res.status(201).json({ success: true, data: created, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'workforce_skill_create_failed');
    }
  });

  router.put('/skills/:skillId', requireAccountMutation, requirePermission('team', 'update'), async (req, res) => {
    try {
      const updated = await service(req).updateSkill(req.params.skillId, req.body || {}, context(req));
      return res.json({ success: true, data: updated, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'workforce_skill_update_failed');
    }
  });

  router.post('/crews', requireAccountMutation, requirePermission('team', 'create'), async (req, res) => {
    try {
      const created = await service(req).createCrew(req.body || {}, context(req));
      return res.status(201).json({ success: true, data: created, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'workforce_crew_create_failed');
    }
  });

  router.put('/crews/:crewId', requireAccountMutation, requirePermission('team', 'update'), async (req, res) => {
    try {
      const updated = await service(req).updateCrew(req.params.crewId, req.body || {}, context(req));
      return res.json({ success: true, data: updated, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'workforce_crew_update_failed');
    }
  });

  return router;
}

module.exports = { createWorkforceRouter };
