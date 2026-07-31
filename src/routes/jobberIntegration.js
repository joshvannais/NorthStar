'use strict';

const express = require('express');
const jobber = require('../integrations/jobber');
const oauthAuthorizationState = require('../integrations/oauthAuthorizationState');
const { requireVerifiedExternalAction } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');

const UNAVAILABLE_RESPONSE = Object.freeze({
  error: 'Jobber integration is unavailable',
  code: 'jobber_unavailable',
});

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function failure(req, res, status, code, error) {
  return res.status(status).json({ error, code, requestId: requestId(req) });
}

function createJobberIntegrationRouter(options = {}) {
  const router = express.Router();
  // This source-owned boundary requires the real durable state authority plus
  // explicit connection-persistence/status/disconnect implementations. Production
  // deliberately supplies none until canonical token persistence is reviewed;
  // no boolean, environment value, request field, or later module-cache
  // mutation can enable a router already constructed.
  const suppliedCapability = options.connectionCapability;
  const connectionCapability = suppliedCapability &&
    suppliedCapability.stateAuthority === oauthAuthorizationState &&
    typeof suppliedCapability.stateAuthority.issueAuthorizationState === 'function' &&
    typeof suppliedCapability.stateAuthority.consumeAuthorizationState === 'function' &&
    typeof suppliedCapability.persistConnection === 'function' &&
    typeof suppliedCapability.readConnectionStatus === 'function' &&
    typeof suppliedCapability.disconnectConnection === 'function'
    ? Object.freeze({
      stateAuthority: suppliedCapability.stateAuthority,
      persistConnection: suppliedCapability.persistConnection,
      readConnectionStatus: suppliedCapability.readConnectionStatus,
      disconnectConnection: suppliedCapability.disconnectConnection,
    })
    : null;
  const requireJobberCapability = (_req, res, next) => {
    if (connectionCapability) return next();
    return failure(_req, res, 503, UNAVAILABLE_RESPONSE.code, UNAVAILABLE_RESPONSE.error);
  };

  router.get(
    '/status',
    requireVerifiedExternalAction,
    requirePermission('integrations', 'read'),
    async (req, res) => {
      if (!connectionCapability || !jobber.isConfigured()) {
        return res.json({
          available: false,
          configured: false,
          connected: false,
          requestId: requestId(req),
        });
      }
      try {
        const status = await connectionCapability.readConnectionStatus({
          provider: 'jobber',
          organizationId: req.tenantContext.organizationId,
          userId: req.tenantContext.userId,
        });
        return res.json({
          available: true,
          configured: true,
          connected: Boolean(status && status.connected),
          requestId: requestId(req),
        });
      } catch (_error) {
        return failure(
          req,
          res,
          503,
          'jobber_status_unavailable',
          'Jobber connection status is temporarily unavailable'
        );
      }
    }
  );

  router.get(
    '/auth',
    requireVerifiedExternalAction,
    requirePermission('integrations', 'update'),
    requireJobberCapability,
    async (req, res) => {
      if (!jobber.isConfigured()) {
        return failure(req, res, 503, UNAVAILABLE_RESPONSE.code, UNAVAILABLE_RESPONSE.error);
      }
      try {
        const state = await connectionCapability.stateAuthority.issueAuthorizationState({
          provider: 'jobber',
          organizationId: req.tenantContext.organizationId,
          userId: req.tenantContext.userId,
          sessionId: req.authSession.id,
        });
        if (!state) {
          return failure(
            req,
            res,
            403,
            'integration_state_invalid',
            'Integration authorization state is invalid'
          );
        }
        const authUrl = jobber.getAuthUrl(state, `${req.protocol}://${req.get('host')}`);
        if (!authUrl) {
          return failure(req, res, 503, UNAVAILABLE_RESPONSE.code, UNAVAILABLE_RESPONSE.error);
        }
        return res.redirect(authUrl);
      } catch (error) {
        if (error instanceof oauthAuthorizationState.OAuthStatePersistenceError) {
          return failure(
            req,
            res,
            503,
            'integration_state_unavailable',
            'Integration authorization is temporarily unavailable'
          );
        }
        console.error('[Jobber] OAuth authorization failed');
        return failure(
          req,
          res,
          500,
          'jobber_authorization_failed',
          'Failed to begin Jobber authorization'
        );
      }
    }
  );

  router.get(
    '/callback',
    requireVerifiedExternalAction,
    requirePermission('integrations', 'update'),
    requireJobberCapability,
    async (req, res) => {
      const { code, state } = req.query;
      if (!code || !state) {
        return failure(
          req,
          res,
          400,
          'integration_callback_invalid',
          'Integration callback parameters are invalid'
        );
      }

      let callback;
      try {
        try {
          callback = await connectionCapability.stateAuthority.consumeAuthorizationState({
            provider: 'jobber',
            rawState: state,
            organizationId: req.tenantContext.organizationId,
            userId: req.tenantContext.userId,
            sessionId: req.authSession.id,
          });
        } catch (error) {
          if (error instanceof oauthAuthorizationState.OAuthStatePersistenceError) {
            return failure(
              req,
              res,
              503,
              'integration_state_unavailable',
              'Integration authorization is temporarily unavailable'
            );
          }
          throw error;
        }
        if (!callback) {
          return failure(
            req,
            res,
            403,
            'integration_state_invalid',
            'Integration authorization state is invalid'
          );
        }
        const tokens = await jobber.exchangeCode(code, `${req.protocol}://${req.get('host')}`);
        if (!tokens || typeof tokens.access_token !== 'string' ||
            tokens.access_token.trim().length === 0) {
          return failure(req, res, 502, 'jobber_connection_failed', 'Failed to connect Jobber');
        }
        const persisted = await connectionCapability.persistConnection({
          provider: 'jobber',
          organizationId: callback.organizationId,
          userId: callback.userId,
          sessionId: callback.sessionId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
        });
        if (persisted !== true) {
          return failure(
            req,
            res,
            503,
            'jobber_connection_unavailable',
            'Jobber connection could not be confirmed'
          );
        }

        return res.redirect('/dashboard/integrations?jobber=connected');
      } catch (_error) {
        console.error('[Jobber] OAuth callback failed');
        return failure(
          req,
          res,
          500,
          'jobber_connection_failed',
          'Failed to connect Jobber'
        );
      }
    }
  );

  router.post(
    '/disconnect',
    requireVerifiedExternalAction,
    requirePermission('integrations', 'update'),
    requireJobberCapability,
    async (req, res) => {
      try {
        const disconnected = await connectionCapability.disconnectConnection({
          provider: 'jobber',
          organizationId: req.tenantContext.organizationId,
          userId: req.tenantContext.userId,
          sessionId: req.authSession.id,
        });
        if (disconnected !== true) {
          return failure(req, res, 503, UNAVAILABLE_RESPONSE.code, UNAVAILABLE_RESPONSE.error);
        }
        return res.json({ success: true, requestId: requestId(req) });
      } catch (_error) {
        return failure(req, res, 503, UNAVAILABLE_RESPONSE.code, UNAVAILABLE_RESPONSE.error);
      }
    }
  );

  return router;
}

module.exports = {
  createJobberIntegrationRouter,
};
