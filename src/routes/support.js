'use strict';

const express = require('express');
const multer = require('multer');
const { requireVerifiedAccount } = require('../auth/middleware');
const { MAX_SCREENSHOT_BYTES } = require('../support/attachment');
const { SupportCaseError } = require('../support/contract');
const { SupportCasePersistenceError } = require('../support/repository');
const { SupportCaseService } = require('../support/service');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function context(req) {
  return {
    organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId,
  };
}

function failure(req, res, error) {
  if (error instanceof SupportCaseError ||
      (error && Number.isInteger(error.status) && typeof error.code === 'string')) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      requestId: requestId(req),
    });
  }
  if (error instanceof SupportCasePersistenceError || error && error.name === 'SupportCasePersistenceError') {
    console.warn('[Support] PostgreSQL authority unavailable:', {
      event: 'support_case_authority_unavailable', requestId: requestId(req),
    });
    return res.status(503).json({
      success: false,
      error: { code: 'support_case_authority_unavailable', message: 'Support cases are temporarily unavailable.' },
      requestId: requestId(req),
    });
  }
  console.error('[Support] Request failed:', {
    event: 'support_case_request_failed', requestId: requestId(req),
  });
  return res.status(500).json({
    success: false,
    error: { code: 'support_case_request_failed', message: 'The support request could not be completed.' },
    requestId: requestId(req),
  });
}

function createUploadBoundary() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      // Leave one byte of parser headroom so the contract layer, not Multer's
      // truncation boundary, decides whether an exact-limit image is valid.
      fileSize: MAX_SCREENSHOT_BYTES + 1,
      files: 1,
      fields: 2,
      // Busboy emits partsLimit when the configured value is reached, so four
      // is the exact fence for two fields plus one optional file.
      parts: 4,
      fieldNameSize: 64,
      // Likewise, preserve the full value through the parser and enforce the
      // documented 12,000-byte description bound in normalizeSubmission.
      fieldSize: 12001,
    },
  }).single('screenshot');
  return function uploadBoundary(req, res, next) {
    upload(req, res, error => {
      if (!error) return next();
      const tooLarge = error && error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        error: {
          code: tooLarge ? 'support_screenshot_too_large' : 'invalid_support_screenshot',
          message: tooLarge
            ? `The screenshot must be no larger than ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB.`
            : 'Submit at most one PNG, JPEG, or WebP screenshot.',
        },
        requestId: requestId(req),
      });
    });
  };
}

function createSupportRouter(options = {}) {
  const router = express.Router();
  const uploadBoundary = createUploadBoundary();
  const serviceProvider = typeof options.serviceProvider === 'function'
    ? options.serviceProvider : () => new SupportCaseService();

  router.get('/bug-reports', requireVerifiedAccount, async (req, res) => {
    try {
      const reports = await serviceProvider(req).list(context(req));
      return res.json({ success: true, data: reports, requestId: requestId(req) });
    } catch (error) { return failure(req, res, error); }
  });

  router.get('/bug-reports/:caseId', requireVerifiedAccount, async (req, res) => {
    try {
      const report = await serviceProvider(req).read(req.params.caseId, context(req));
      return res.json({ success: true, data: report, requestId: requestId(req) });
    } catch (error) { return failure(req, res, error); }
  });

  router.get('/bug-reports/:caseId/attachments/:attachmentId', requireVerifiedAccount, async (req, res) => {
    try {
      const attachment = await serviceProvider(req).attachment(
        req.params.caseId, req.params.attachmentId, context(req)
      );
      res.set({
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Type': attachment.mediaType,
        'Content-Length': String(attachment.bytes.length),
        'Content-Disposition': `inline; filename="support-screenshot.${attachment.mediaType.split('/')[1] === 'jpeg' ? 'jpg' : attachment.mediaType.split('/')[1]}"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        ETag: `"sha256-${attachment.digest}"`,
      });
      return res.status(200).send(attachment.bytes);
    } catch (error) { return failure(req, res, error); }
  });

  router.post('/bug-reports', requireVerifiedAccount, uploadBoundary, async (req, res) => {
    try {
      const report = await serviceProvider(req).create({
        body: req.body || {},
        file: req.file || null,
        idempotencyKey: req.get('Idempotency-Key'),
      }, context(req));
      res.set('Idempotency-Replayed', report.replayed ? 'true' : 'false');
      return res.status(report.replayed ? 200 : 201).json({
        success: true, data: report, requestId: requestId(req),
      });
    } catch (error) { return failure(req, res, error); }
  });

  return router;
}

module.exports = { createSupportRouter };
