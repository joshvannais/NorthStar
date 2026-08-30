'use strict';

const crypto = require('crypto');

const MAX_TITLE_BYTES = 512;
const MAX_TITLE_CHARACTERS = 120;
const MAX_DESCRIPTION_BYTES = 12000;
const MAX_DESCRIPTION_CHARACTERS = 8000;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

class SupportCaseError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'SupportCaseError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new SupportCaseError(status, code, message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requiredText(value, options) {
  const invalidControl = options.allowBodyWhitespace ? BODY_CONTROL : CONTROL;
  if (typeof value !== 'string' || invalidControl.test(value)) {
    fail(400, 'invalid_support_report', `${options.label} is invalid.`);
  }
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > options.maximumBytes ||
      Array.from(normalized).length > options.maximumCharacters) {
    fail(400, 'invalid_support_report', `${options.label} is required and must stay within its stated limit.`);
  }
  return normalized;
}

function validateAttachment(value) {
  if (value === null || value === undefined) return null;
  const digest = /^[0-9a-f]{64}$/;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.id !== 'string' ||
      typeof value.originalFilename !== 'string' ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(value.mediaType) ||
      !Number.isSafeInteger(value.originalSize) || value.originalSize < 1 ||
      !Number.isSafeInteger(value.storedSize) || value.storedSize < 1 ||
      !Number.isSafeInteger(value.width) || value.width < 1 ||
      !Number.isSafeInteger(value.height) || value.height < 1 ||
      !digest.test(value.originalSha256 || '') || !digest.test(value.storedSha256 || '') ||
      !Buffer.isBuffer(value.bytes) || value.bytes.length !== value.storedSize) {
    fail(400, 'invalid_support_screenshot', 'The screenshot is invalid.');
  }
  return value;
}

function normalizeSubmission(input = {}) {
  const body = input.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'invalid_support_report', 'A support report is required.');
  }
  const keys = Object.keys(body);
  if (keys.some(key => !['title', 'description'].includes(key))) {
    fail(400, 'invalid_support_report', 'The support report contains an unsupported field.');
  }
  if (typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey !== input.idempotencyKey.trim() ||
      !IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    fail(428, 'support_idempotency_required', 'A valid retry identity is required. Refresh and try again.');
  }
  const title = requiredText(body.title, {
    label: 'Title', maximumBytes: MAX_TITLE_BYTES, maximumCharacters: MAX_TITLE_CHARACTERS,
  });
  const description = requiredText(body.description, {
    label: 'Description', maximumBytes: MAX_DESCRIPTION_BYTES, maximumCharacters: MAX_DESCRIPTION_CHARACTERS,
    allowBodyWhitespace: true,
  });
  const attachment = validateAttachment(input.attachment);
  const idempotencyKeyHash = sha256(Buffer.from(input.idempotencyKey, 'utf8'));
  const requestDigest = sha256(Buffer.from(JSON.stringify({
    version: 'northstar-support-report-v1',
    title,
    description,
    attachment: attachment ? {
      originalFilename: attachment.originalFilename,
      mediaType: attachment.mediaType,
      originalSize: attachment.originalSize,
      storedSize: attachment.storedSize,
      originalSha256: attachment.originalSha256,
      storedSha256: attachment.storedSha256,
      width: attachment.width,
      height: attachment.height,
    } : null,
  }), 'utf8'));
  return Object.freeze({ title, description, attachment, idempotencyKeyHash, requestDigest });
}

module.exports = {
  IDEMPOTENCY_PATTERN,
  MAX_DESCRIPTION_BYTES,
  MAX_DESCRIPTION_CHARACTERS,
  MAX_TITLE_BYTES,
  MAX_TITLE_CHARACTERS,
  SupportCaseError,
  normalizeSubmission,
};
