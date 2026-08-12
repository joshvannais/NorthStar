'use strict';

const express = require('express');
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
  const signup = typeof options.signup === 'function'
    ? options.signup
    : service.signup.bind(service);

  router.post('/signup', async (req, res) => {
    try {
      await signup(req.body || {}, req.ip || 'unknown', { requestId: requestId(req) });
      return res.status(202).json({
        success: true,
        code: 'verification_required',
        message: 'If signup was accepted, check your email for a verification link.',
        requestId: requestId(req),
      });
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
    return res.json({
      account: accountView(req.accountAuthority),
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

  router.post('/verify-email', async (req, res) => {
    try {
      const result = await service.verifyEmail(req.body && req.body.token);
      return res.json({
        success: true,
        code: 'email_verified',
        trialStartedAt: result.trialStartedAt,
        trialEndsAt: result.trialEndsAt,
        requestId: requestId(req),
      });
    } catch (error) {
      return handleError(req, res, error, 'verification_failed');
    }
  });

  router.post('/resend-verification', requireSession, async (req, res) => {
    try {
      await service.resendVerification(
        req.accountAuthority,
        req.ip || 'unknown',
        { requestId: requestId(req) }
      );
      return res.json({
        success: true,
        code: 'verification_requested',
        message: 'If verification is still required, a new link was sent.',
        requestId: requestId(req),
      });
    } catch (error) {
      return handleError(req, res, error, 'verification_resend_failed');
    }
  });

  router.post('/demo', (req, res) => {
    return failure(req, res, 410, 'demo_auth_retired', 'Legacy demo authentication is retired');
  });
  router.post('/forgot-password', async (req, res) => {
    try {
      await service.forgotPassword(
        req.body || {},
        req.ip || 'unknown',
        { requestId: requestId(req) }
      );
      return res.status(202).json({
        success: true,
        code: 'recovery_requested',
        message: 'If the account is eligible and delivery succeeds, a reset link will be sent.',
        requestId: requestId(req),
      });
    } catch (error) {
      return handleError(req, res, error, 'recovery_request_failed');
    }
  });
  router.post('/reset-password', async (req, res) => {
    try {
      await service.resetPassword(req.body || {}, req.ip || 'unknown');
      credentials.clearCookies(res);
      return res.json({
        success: true,
        code: 'password_reset',
        redirect: '/login',
        requestId: requestId(req),
      });
    } catch (error) {
      return handleError(req, res, error, 'password_reset_failed');
    }
  });

  return router;
}

module.exports = { createAuthRouter };
