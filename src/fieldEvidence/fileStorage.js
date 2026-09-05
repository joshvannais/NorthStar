'use strict';

const crypto = require('crypto');
const { detectMagic, FILE_MEDIA, MAX_FILE_BYTES } = require('./contract');
const { authorizeFileUpload, mutateFieldEvidence } = require('./repository');

class FieldStorageError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'FieldStorageError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.cause = cause;
  }
}

function unavailable() {
  throw new FieldStorageError(503, 'M23_FIELD_STORAGE_UNAVAILABLE',
    'Durable encrypted field-file storage and malware scanning are not configured.');
}

function createUnavailableStorage() {
  return Object.freeze({
    capabilities: () => Object.freeze({ available: false }),
    beginQuarantine: unavailable,
    scanAndRelease: unavailable,
    deleteOrphan: async () => {},
    createAuthorizedRetrieval: unavailable,
  });
}

function requireCapabilities(storage) {
  const value = storage && typeof storage.capabilities === 'function' ? storage.capabilities() : null;
  const required = ['durable', 'encryptionAtRest', 'quarantine', 'malwareScan', 'metadataStrip',
    'decompressionSafety', 'retentionCleanup', 'orphanCleanup', 'shortLivedRetrieval'];
  if (!value || value.available !== true || required.some(field => value[field] !== true) ||
      typeof value.version !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value.version) ||
      typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest)) unavailable();
  return value;
}

function activeContent(buffer) {
  const lower = buffer.toString('latin1').toLowerCase();
  return /(?:<\s*(?:svg|html|script|iframe)|javascript:|data:text\/html|%pdf-|pk\x03\x04)/.test(lower);
}

function opaqueObjectId(metadata) {
  const bytes = crypto.createHash('sha256').update([
    metadata.organizationId, metadata.authSessionId, metadata.idempotencyKey,
  ].join(':'), 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function ingestFileEvidence(options) {
  const { pool, storage, stream, metadata, csrfToken, requestCorrelationId } = options;
  const mutate = typeof options.mutate === 'function' ? options.mutate : mutateFieldEvidence;
  const authorizeUpload = typeof options.authorizeUpload === 'function' ? options.authorizeUpload : authorizeFileUpload;
  if (String(options.contentEncoding || 'identity').toLowerCase() !== 'identity') {
    throw new FieldStorageError(415, 'M23_FIELD_FILE_ENCODING_UNSUPPORTED', 'Compressed field-file uploads are not supported.');
  }
  const capabilities = requireCapabilities(storage);
  const objectId = opaqueObjectId(metadata);
  await authorizeUpload(pool, { ...metadata, objectId, csrfToken, requestCorrelationId });
  const writer = await storage.beginQuarantine({
    objectId, organizationId: metadata.organizationId, executionId: metadata.executionId,
    maximumBytes: MAX_FILE_BYTES, contentType: metadata.contentType,
    idempotencyDigest: crypto.createHash('sha256').update(metadata.idempotencyKey, 'utf8').digest('hex'),
  });
  if (!writer || typeof writer.write !== 'function' || typeof writer.finish !== 'function' || typeof writer.abort !== 'function') unavailable();
  const hash = crypto.createHash('sha256');
  let count = 0;
  let leading = Buffer.alloc(0);
  let activeWindow = Buffer.alloc(0);
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      count += chunk.length;
      if (count > MAX_FILE_BYTES || count > metadata.contentLength) throw new FieldStorageError(413, 'M23_FIELD_FILE_SIZE_INVALID', 'Field file exceeded its declared or maximum byte length.');
      hash.update(chunk);
      if (leading.length < 512) leading = Buffer.concat([leading, chunk]).subarray(0, 512);
      activeWindow = Buffer.concat([activeWindow, chunk]);
      if (activeContent(activeWindow)) throw new FieldStorageError(415, 'M23_FIELD_FILE_ACTIVE_CONTENT', 'Active or polyglot content is not accepted as field evidence.');
      activeWindow = activeWindow.subarray(Math.max(0, activeWindow.length - 96));
      await writer.write(chunk);
    }
    if (count !== metadata.contentLength) throw new FieldStorageError(400, 'M23_FIELD_FILE_LENGTH_MISMATCH', 'Field file byte length did not match Content-Length.');
    const magic = detectMagic(leading);
    if (!magic || FILE_MEDIA[metadata.contentType].magic !== magic) throw new FieldStorageError(415, 'M23_FIELD_FILE_SIGNATURE_MISMATCH', 'Field file extension, media type, and magic bytes must agree.');
    await writer.finish();
    const contentDigest = hash.digest('hex');
    const scan = await storage.scanAndRelease({
      objectId, organizationId: metadata.organizationId, executionId: metadata.executionId,
      contentDigest, byteCount: count, mediaType: metadata.contentType,
      stripExif: true, stripGeolocation: true,
    });
    if (!scan || scan.disposition !== 'released_after_clean_scan' || scan.malwareDetected !== false ||
        scan.exifPresent !== false || scan.geolocationPresent !== false ||
        scan.decompressionSafe !== true || !Number.isSafeInteger(scan.decodedPixelCount) ||
        scan.decodedPixelCount < 1 || scan.decodedPixelCount > 40000000 ||
        scan.releasedObjectId !== objectId || scan.releasedMediaType !== metadata.contentType ||
        !Number.isSafeInteger(scan.releasedByteCount) || scan.releasedByteCount < 1 || scan.releasedByteCount > MAX_FILE_BYTES ||
        !/^[0-9a-f]{64}$/.test(String(scan.releasedContentDigest || '')) ||
        !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(scan.scannerVersion || '')) ||
        !/^[0-9a-f]{64}$/.test(String(scan.scannerEvidenceDigest || '')) ||
        !/^[0-9a-f]{64}$/.test(String(scan.metadataRemovalDigest || ''))) {
      throw new FieldStorageError(422, 'M23_FIELD_FILE_QUARANTINED', 'Field file was not released by the required scan and sensitive-metadata controls.');
    }
    const document = Object.freeze({
      kind: 'file', objectId, displayName: metadata.displayName, extension: metadata.extension,
      mediaType: scan.releasedMediaType, byteCount: scan.releasedByteCount, contentDigest: scan.releasedContentDigest,
      quarantineDisposition: scan.disposition, scannerVersion: scan.scannerVersion,
      scannerEvidenceDigest: scan.scannerEvidenceDigest, metadataRemovalDigest: scan.metadataRemovalDigest,
      storageCapabilityVersion: capabilities.version, storageCapabilityDigest: capabilities.digest,
      encryptionAtRest: true, decompressionSafe: true, decodedPixelCount: scan.decodedPixelCount,
      activeContentInline: false, privacyFlags: metadata.privacyFlags,
      privacyPolicy: metadata.privacy, retentionDays: metadata.retentionDays,
      consentOrComplianceConclusion: false, malwareClearanceClaim: false,
    });
    const mutation = await mutate(pool, {
      ...metadata, action: 'register_file', subjectId: null, expectedSubjectRevision: null,
      expectedSubjectDigest: null, document, csrfToken, requestCorrelationId,
    });
    const acceptedObjectId = mutation && mutation.body && mutation.body.data && mutation.body.data.document && mutation.body.data.document.objectId;
    if (acceptedObjectId !== objectId) await storage.deleteOrphan({ objectId, reason: 'idempotent_replay' });
    return mutation;
  } catch (error) {
    await writer.abort().catch(() => {});
    await storage.deleteOrphan({ objectId, reason: 'upload_not_committed' }).catch(() => {});
    throw error;
  }
}

async function createAuthorizedRetrieval(storage, authorization) {
  requireCapabilities(storage);
  const retrieval = await storage.createAuthorizedRetrieval({
    objectId: authorization.objectId, organizationId: authorization.organizationId,
    executionId: authorization.executionId, expiresInSeconds: 300,
    contentDigest: authorization.contentDigest,
    contentDisposition: 'attachment', mediaType: 'application/octet-stream',
  });
  if (!retrieval || typeof retrieval.url !== 'string' || !/^https:\/\//.test(retrieval.url) ||
      retrieval.objectId !== authorization.objectId || retrieval.contentDigest !== authorization.contentDigest ||
      retrieval.contentDisposition !== 'attachment' || retrieval.mediaType !== 'application/octet-stream' ||
      !Number.isSafeInteger(retrieval.expiresInSeconds) || retrieval.expiresInSeconds < 1 || retrieval.expiresInSeconds > 300) unavailable();
  return Object.freeze({ url: retrieval.url, expiresInSeconds: retrieval.expiresInSeconds, disposition: 'attachment' });
}

module.exports = { FieldStorageError, createAuthorizedRetrieval, createUnavailableStorage, ingestFileEvidence, opaqueObjectId, requireCapabilities };
