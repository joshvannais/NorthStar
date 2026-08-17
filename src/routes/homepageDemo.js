'use strict';

const express = require('express');
const { HomepageWebCallError, HomepageWebCallService } = require('../services/homepageWebCall');
const {
  HomepageDemoAdmissionRepository,
  configuredSourceHash,
} = require('../services/homepageDemoAdmission');

function exactBody(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every(function (key, index) {
    return key === expected[index];
  });
}

function sameOriginIntent(req, res, intent) {
  const origin = req.get('Origin');
  const expectedOrigin = req.protocol + '://' + req.get('host');
  const fetchSite = req.get('Sec-Fetch-Site');
  if (!origin || origin !== expectedOrigin || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
    res.status(403).json({
      success: false,
      error: { code: 'homepage_same_origin_required', message: 'The Web Call requires the same NorthStar origin.' },
    });
    return false;
  }
  if (req.get('X-NorthStar-Demo-Intent') !== intent) {
    res.status(403).json({
      success: false,
      error: { code: 'homepage_intent_required', message: 'The explicit Web Call action is required.' },
    });
    return false;
  }
  return true;
}

function sendError(req, res, error) {
  const known = error instanceof HomepageWebCallError ||
    (error && Number.isInteger(error.status) && typeof error.code === 'string');
  const status = known ? error.status : 503;
  return res.status(status).json({
    success: false,
    requestId: req.requestId || req.correlationId || 'unavailable',
    error: {
      code: known ? String(error.code).toLowerCase() : 'homepage_web_call_unavailable',
      message: known ? error.message : 'The browser Web Call is temporarily unavailable.',
    },
  });
}

function createHomepageDemoRouter(options = {}) {
  const router = express.Router();
  const service = options.service || new HomepageWebCallService();
  const admission = options.admission || new HomepageDemoAdmissionRepository();
  const hashSource = options.sourceHash || configuredSourceHash;

  router.use(function (_req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/status', function (_req, res) {
    return res.json({
      success: true,
      webCall: service.availability(),
      transcriptPersistence: 'none',
      resultPersistence: 'browser-memory-only',
      providerActivationChanged: false,
    });
  });

  router.post('/web-call', async function (req, res) {
    if (!sameOriginIntent(req, res, 'start-homepage-web-call')) return undefined;
    if (!exactBody(req.body, ['consentAcknowledged', 'industry']) || req.body.consentAcknowledged !== true) {
      return res.status(422).json({
        success: false,
        error: { code: 'homepage_consent_required', message: 'Review and accept the microphone and temporary-processing notice first.' },
      });
    }
    try {
      await admission.admit(hashSource(req.ip));
      const result = await service.create(req.body.industry);
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.post('/polaris/:callId', async function (req, res) {
    if (!sameOriginIntent(req, res, 'calculate-homepage-polaris')) return undefined;
    if (!exactBody(req.body, [
      'callDurationSeconds', 'industry', 'purgeToken', 'transcript', 'verifiedPurgeReceipt',
    ])) {
      return res.status(422).json({
        success: false,
        error: { code: 'homepage_polaris_request_invalid', message: 'The temporary Polaris request is invalid.' },
      });
    }
    try {
      const authority = service.verifyPolarisAuthority(
        req.params.callId,
        req.body.purgeToken,
        req.body.verifiedPurgeReceipt
      );
      await admission.consumeVerifiedPurgeProjection(
        hashSource(req.ip),
        authority.capabilityHash,
        authority.verifiedPurge.verifiedAt,
        authority.verifiedPurge.expiresAt
      );
      const result = service.projectPolaris(
        req.params.callId,
        req.body.purgeToken,
        req.body.verifiedPurgeReceipt,
        req.body.industry,
        req.body.transcript,
        req.body.callDurationSeconds
      );
      return res.json({ success: true, data: result });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.delete('/web-call/:callId', async function (req, res) {
    if (!sameOriginIntent(req, res, 'delete-homepage-web-call')) return undefined;
    if (!exactBody(req.body, ['projectionRequested', 'purgeToken']) ||
        typeof req.body.projectionRequested !== 'boolean') {
      return res.status(422).json({
        success: false,
        error: { code: 'homepage_purge_request_invalid', message: 'The temporary-call purge request is invalid.' },
      });
    }
    try {
      const authority = service.verifyCallAuthority(req.params.callId, req.body.purgeToken);
      const claim = await admission.beginPurge(
        hashSource(req.ip),
        authority.capabilityHash,
        authority.expiresAt,
        req.body.projectionRequested
      );
      if (claim && claim.verified === true && claim.execute === false) {
        return res.json({
          success: true,
          data: service.verifiedPurgeReceipt(
            req.params.callId,
            req.body.purgeToken,
            claim.verifiedAt,
            claim.projectionPermitted === true && claim.consumed !== true
          ),
        });
      }
      if (!claim || claim.execute !== true || claim.verified !== false) {
        throw new HomepageWebCallError(
          503,
          'homepage_admission_unavailable',
          'The verified deletion authority is unavailable.'
        );
      }
      try {
        await service.purge(req.params.callId, req.body.purgeToken);
        const completed = await admission.completePurge(authority.capabilityHash, claim.attemptCount);
        return res.json({
          success: true,
          data: service.verifiedPurgeReceipt(
            req.params.callId,
            req.body.purgeToken,
            completed.verifiedAt,
            completed.projectionPermitted === true && completed.consumed !== true
          ),
        });
      } catch (error) {
        try {
          await admission.releasePurge(authority.capabilityHash, claim.attemptCount);
        } catch (_releaseError) {}
        throw error;
      }
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  return router;
}

module.exports = {
  createHomepageDemoRouter,
  exactBody,
  sameOriginIntent,
  sendError,
};
