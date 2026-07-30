'use strict';

const express = require('express');
const config = require('../config');
const credentials = require('../auth/credentials');
const { requireSession } = require('../auth/middleware');
const { AccountError, AccountService, accountView } = require('../accounts/service');
const { AccountPersistenceError } = require('../accounts/repository');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function failure(req, res, status, code, message) {
  return res.status(status).json({ error: message, code, requestId: requestId(req) });
}

function handleError(req, res, error, event) {
  if (error instanceof AccountError) {
    return failure(req, res, error.status, error.code, error.message);
  }
  if (error instanceof AccountPersistenceError || (error && error.name === 'AccountPersistenceError')) {
    console.warn('[Auth] PostgreSQL account authority unavailable:', { requestId: requestId(req), event });
    return failure(req, res, 503, 'account_authority_unavailable', 'Account service is temporarily unavailable');
  }
  console.error('[Auth] Request failed:', { requestId: requestId(req), event });
  return failure(req, res, 500, 'auth_request_failed', 'Authentication request failed');
}

function createAuthRouter(options = {}) {
  const router = express.Router();
  const service = options.service || new AccountService();

  router.post('/signup', async (req, res) => {
    if (!config.auth.signupEnabled) {
      return failure(req, res, 503, 'signup_disabled', 'Account signup is not currently available');
    }
    try {
      const result = await service.signup(req.body || {}, req.ip || 'unknown');
      credentials.issueCookies(res, result.material);
      return res.status(201).json({ success: true, account: result.account, requestId: requestId(req) });
    } catch (error) {
      return handleError(req, res, error, 'signup_failed');
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const result = await service.login(req.body || {}, req.ip || 'unknown');
      credentials.issueCookies(res, result.material);
      return res.json({ success: true, account: result.account, requestId: requestId(req) });
    } catch (error) {
      return handleError(req, res, error, 'login_failed');
    }
  });

  router.post('/refresh', async (req, res) => {
    const cookies = credentials.parseCookies(req.headers.cookie);
    try {
      const result = await service.refresh(
        cookies[credentials.REFRESH_COOKIE],
        req.headers['x-csrf-token'],
        cookies[credentials.CSRF_COOKIE]
      );
      credentials.issueCookies(res, result.material);
      return res.json({ success: true, requestId: requestId(req) });
    } catch (error) {
      if (error instanceof AccountError && error.code !== 'csrf_invalid') credentials.clearCookies(res);
      return handleError(req, res, error, 'refresh_failed');
    }
  });

  router.post('/logout', async (req, res) => {
    const cookies = credentials.parseCookies(req.headers.cookie);
    try {
      await service.logout(
        cookies[credentials.REFRESH_COOKIE],
        req.headers['x-csrf-token'],
        cookies[credentials.CSRF_COOKIE]
      );
      credentials.clearCookies(res);
      return res.json({ success: true, requestId: requestId(req) });
    } catch (error) {
      return handleError(req, res, error, 'logout_failed');
    }
  });

  router.get('/me', requireSession, (req, res) => {
    const cookies = credentials.parseCookies(req.headers.cookie);
    return res.json({
      account: accountView(req.accountAuthority),
      csrfToken: cookies[credentials.CSRF_COOKIE] || null,
      requestId: requestId(req),
    });
  });

  router.get('/verification/status', requireSession, (req, res) => {
    return res.json({
      status: req.user.status,
      onboarding: req.user.onboardingStatus,
      requestId: requestId(req),
    });
  });

  router.post('/demo', (req, res) => {
    return failure(req, res, 410, 'demo_auth_retired', 'Legacy demo authentication is retired');
  });
  router.post('/forgot-password', (req, res) => {
    return failure(req, res, 503, 'recovery_unavailable', 'Password recovery will be enabled in Account Lifecycle PR B');
  });
  router.post('/reset-password', (req, res) => {
    return failure(req, res, 503, 'recovery_unavailable', 'Password recovery will be enabled in Account Lifecycle PR B');
  });

  return router;
}

module.exports = { createAuthRouter };
