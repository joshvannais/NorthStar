'use strict';

class FieldEvidenceRepositoryError extends Error {
  constructor(status, code, message, cause) {
    super(message);
    this.name = 'FieldEvidenceRepositoryError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.cause = cause;
  }
}

function mapDatabaseError(error) {
  if (error instanceof FieldEvidenceRepositoryError) return error;
  const constraint = String(error && error.constraint || '');
  if (constraint.includes('upload_busy') || error && error.code === '40001' && /upload already in progress/i.test(String(error.message || ''))) return new FieldEvidenceRepositoryError(409, 'M23_FIELD_UPLOAD_IN_PROGRESS', 'This field-file upload is already in progress.', error);
  if (constraint.includes('idempotency')) return new FieldEvidenceRepositoryError(409, 'M23_FIELD_EVIDENCE_IDEMPOTENCY_CONFLICT', 'The Idempotency-Key was already used for different field evidence.', error);
  if (constraint.includes('stale') || error && ['40001', '40P01'].includes(error.code)) return new FieldEvidenceRepositoryError(409, 'M23_FIELD_EVIDENCE_STALE', 'Field evidence authority changed; refresh before trying again.', error);
  if (constraint.includes('not_found') || error && error.code === 'P0002') return new FieldEvidenceRepositoryError(404, 'NOT_FOUND', 'Field evidence was not found.', error);
  if (constraint.includes('limit')) return new FieldEvidenceRepositoryError(409, 'M23_FIELD_EVIDENCE_LIMIT', 'The bounded field evidence limit was reached.', error);
  if (error && error.code === '42501') return new FieldEvidenceRepositoryError(403, 'M23_FIELD_EVIDENCE_FORBIDDEN', 'Current field evidence authority is unavailable.', error);
  if (error && error.code === '22023') return new FieldEvidenceRepositoryError(400, 'INVALID_FIELD_EVIDENCE_REQUEST', 'Field evidence request is invalid.', error);
  return new FieldEvidenceRepositoryError(503, 'M23_FIELD_EVIDENCE_PERSISTENCE_UNAVAILABLE', 'Canonical field evidence persistence is unavailable.', error);
}

function result(row) {
  const value = row && row.result;
  if (!value || typeof value !== 'object') throw new FieldEvidenceRepositoryError(503, 'M23_FIELD_EVIDENCE_PERSISTENCE_UNAVAILABLE', 'Canonical field evidence persistence returned an invalid result.');
  return value;
}

async function transaction(pool, isolation, operation) {
  if (!pool || typeof pool.connect !== 'function') throw new FieldEvidenceRepositoryError(503, 'M23_FIELD_EVIDENCE_PERSISTENCE_UNAVAILABLE', 'Canonical field evidence persistence is unavailable.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (isolation === 'SERIALIZABLE' && error && error.code === '23505' &&
          error.constraint === 'canonical_field_evidence_file_upload_reservations_pkey' && attempt < 2) continue;
      if (isolation === 'SERIALIZABLE' && error && ['40001', '40P01'].includes(error.code) &&
          !/(stale|upload_busy)/.test(String(error.constraint || '')) && !/upload already in progress/i.test(String(error.message || '')) && attempt < 2) continue;
      throw mapDatabaseError(error);
    } finally { client.release(); }
  }
  throw new FieldEvidenceRepositoryError(409, 'M23_FIELD_EVIDENCE_STALE', 'Field evidence authority changed; refresh before trying again.');
}

async function mutateFieldEvidence(pool, input) {
  return transaction(pool, 'SERIALIZABLE', async client => result((await client.query(
    `SELECT public.canonical_field_evidence_mutate(
       $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,$8::uuid,
       $9::uuid,$10::bigint,$11::text,$12::bigint,$13::text,$14::bigint,$15::text,
       $16::jsonb,$17::text,$18::text,$19::text,$20::text
     ) AS result`,
    [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
      input.csrfToken, input.executionId, input.action, input.performerProfileId,
      input.subjectId, input.expectedSubjectRevision, input.expectedSubjectDigest,
      input.expectedExecutionRevision, input.expectedExecutionDigest,
      input.expectedAssignmentRevision, input.expectedAssignmentDigest,
      input.document, input.idempotencyKey, input.reason, input.requestCorrelationId,
      input.uploadClaimToken || null]
  )).rows[0]));
}

async function authorizeFileUpload(pool, input) {
  return transaction(pool, 'SERIALIZABLE', async client => result((await client.query(
    `SELECT public.canonical_field_file_upload_authorize(
       $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::jsonb,
       $9::bigint,$10::text,$11::bigint,$12::text,$13::text,$14::text,$15::text
     ) AS result`,
    [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
      input.csrfToken, input.executionId, input.performerProfileId, {
        displayName: input.displayName, extension: input.extension, contentType: input.contentType,
        contentLength: input.contentLength, expectedContentDigest: input.expectedContentDigest,
        privacyFlags: input.privacyFlags, privacyPolicy: input.privacy,
        retentionDays: input.retentionDays, accessibility: input.accessibility,
      },
      input.expectedExecutionRevision, input.expectedExecutionDigest,
      input.expectedAssignmentRevision, input.expectedAssignmentDigest,
      input.idempotencyKey, input.reason, input.requestCorrelationId]
  )).rows[0]));
}

async function readFieldEvidence(pool, input) {
  return transaction(pool, 'REPEATABLE READ READ ONLY', async client => result((await client.query(
    `SELECT public.canonical_field_evidence_read(
       $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,
       $7::timestamptz,$8::timestamptz,$9::uuid
     ) AS result`,
    [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
      input.executionId, input.limit, input.cursor && input.cursor.cutoff,
      input.cursor && input.cursor.lastTime, input.cursor && input.cursor.lastId]
  )).rows[0]));
}

async function authorizeFileRetrieval(pool, input) {
  return transaction(pool, 'SERIALIZABLE', async client => result((await client.query(
    `SELECT public.canonical_field_file_retrieve_authorize(
       $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::uuid
     ) AS result`,
    [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
      input.executionId, input.objectId]
  )).rows[0]));
}

module.exports = { FieldEvidenceRepositoryError, authorizeFileRetrieval, authorizeFileUpload, mapDatabaseError, mutateFieldEvidence, readFieldEvidence };
