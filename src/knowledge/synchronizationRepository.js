'use strict';

const {
  CAPABILITY_KEYS,
  CONSUMER_PROFILES,
  buildKnowledgeProjection,
} = require('./projection');
const {
  KnowledgeSynchronizationError,
  MAX_ATTEMPTS,
  MAX_TARGETS_PER_PUBLICATION,
  digestCanonical,
  normalizeClaimOptions,
  normalizeDiagnosticCategory,
  normalizeObservedDigest,
  normalizeSyncTargetInput,
  normalizeTrigger,
  retryDelaySeconds,
} = require('./synchronization');
const { normalizeUuid } = require('./contract');

const SHA256 = /^[0-9a-f]{64}$/;

function fail(code, message, status = 409) {
  throw new KnowledgeSynchronizationError(code, message, status);
}

function normalizeDigest(value, field) {
  const normalized = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (!SHA256.test(normalized)) fail('knowledge_sync_invalid_digest', `${field} is invalid`, 400);
  return normalized;
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    fail('knowledge_sync_invalid_request', `${field} is outside its allowed bounds`, 400);
  }
  return number;
}

async function withTransaction(pool, operation, isolation = 'SERIALIZABLE') {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('Knowledge synchronization requires a PostgreSQL pool');
  }
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // Preserve the original synchronization failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function requireAdministrator(client, organizationId, actorUserId) {
  const result = await client.query(
    `SELECT role
       FROM organization_memberships
      WHERE organization_id = $1
        AND user_id = $2
        AND status = 'active'
        AND role IN ('owner', 'admin')
      FOR SHARE`,
    [organizationId, actorUserId]
  );
  if (result.rowCount !== 1) {
    fail(
      'knowledge_sync_authorization_required',
      'An active owner or administrator membership is required',
      403
    );
  }
  return result.rows[0].role;
}

function mapTarget(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    providerKey: row.provider_key,
    consumer: row.consumer,
    audience: row.audience,
    capabilities: row.capabilities,
    maximumEntries: Number(row.maximum_entries),
    maximumBytes: Number(row.maximum_bytes),
    staleAfterSeconds: Number(row.stale_after_seconds),
    targetRevision: Number(row.target_revision),
    configurationDigest: String(row.configuration_digest).trim(),
    status: row.status,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOutbox(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    targetId: row.target_id,
    targetRevision: Number(row.target_revision),
    targetSequence: Number(row.target_sequence),
    configurationDigest: String(row.configuration_digest).trim(),
    providerKey: row.provider_key,
    consumer: row.consumer,
    audience: row.audience,
    capabilities: row.capabilities,
    maximumEntries: Number(row.maximum_entries),
    maximumBytes: Number(row.maximum_bytes),
    triggerType: row.trigger_type,
    triggerPublicationId: row.trigger_publication_id,
    triggerEntryId: row.trigger_entry_id,
    triggerVersionId: row.trigger_version_id,
    triggerCanonicalDigest: row.trigger_canonical_digest
      ? String(row.trigger_canonical_digest).trim() : null,
    sourcePins: row.source_pins,
    projection: row.desired_projection,
    canonicalProjection: row.canonical_projection,
    projectionDigest: row.projection_digest ? String(row.projection_digest).trim() : null,
    idempotencyKey: String(row.idempotency_key).trim(),
    state: row.state,
    reconciliationGeneration: Number(row.reconciliation_generation),
    attemptCount: Number(row.attempt_count),
    availableAt: row.available_at,
    claimToken: row.claim_token,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    observedProjectionDigest: row.observed_projection_digest
      ? String(row.observed_projection_digest).trim() : null,
    diagnosticCategory: row.diagnostic_category,
    succeededAt: row.succeeded_at,
    deadAt: row.dead_at,
    blockedAt: row.blocked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapState(row) {
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    targetId: row.target_id,
    desiredEventId: row.desired_event_id,
    desiredSequence: row.desired_sequence === null ? null : Number(row.desired_sequence),
    desiredProjectionDigest: row.desired_projection_digest
      ? String(row.desired_projection_digest).trim() : null,
    observedEventId: row.observed_event_id,
    observedSequence: row.observed_sequence === null ? null : Number(row.observed_sequence),
    observedProjectionDigest: row.observed_projection_digest
      ? String(row.observed_projection_digest).trim() : null,
    lastKnownGoodEventId: row.last_known_good_event_id,
    lastKnownGoodSequence: row.last_known_good_sequence === null
      ? null : Number(row.last_known_good_sequence),
    lastKnownGoodProjectionDigest: row.last_known_good_projection_digest
      ? String(row.last_known_good_projection_digest).trim() : null,
    status: row.status,
    diagnosticCategory: row.diagnostic_category,
    driftDetectedAt: row.drift_detected_at,
    lastObservedAt: row.last_observed_at,
    updatedAt: row.updated_at,
  };
}

function targetProjectionRequest(target, actorUserId, exactSourcePins) {
  const request = {
    organizationId: target.organization_id,
    actorUserId,
    consumer: target.consumer,
    audience: target.audience,
    capabilities: target.capabilities,
    maximumEntries: Number(target.maximum_entries),
    maximumBytes: Number(target.maximum_bytes),
  };
  if (exactSourcePins && exactSourcePins.length > 0) request.exactSourcePins = exactSourcePins;
  return request;
}

async function loadProjectionRows(client, target) {
  const requestedKeys = target.capabilities.map(capability => CAPABILITY_KEYS[capability]);
  const profile = CONSUMER_PROFILES[target.consumer];
  const result = await client.query(
    `WITH latest_publications AS (
       SELECT DISTINCT ON (publication.entry_id) publication.*
         FROM canonical_knowledge_publications publication
        WHERE publication.organization_id = $1
        ORDER BY publication.entry_id, publication.publication_number DESC, publication.id
     )
     SELECT entry.id AS entry_id,
            entry.canonical_key,
            entry.entry_type,
            version.id AS version_id,
            version.version_number,
            version.sensitivity,
            version.review_requirement,
            version.canonical_document,
            version.canonical_digest,
            publication.id AS publication_id,
            publication.publication_number,
            publication.canonical_digest AS publication_digest
       FROM latest_publications publication
       JOIN canonical_knowledge_entries entry
         ON entry.organization_id = publication.organization_id
        AND entry.id = publication.entry_id
       JOIN canonical_knowledge_versions version
         ON version.organization_id = publication.organization_id
        AND version.entry_id = publication.entry_id
        AND version.id = publication.version_id
      WHERE (
          entry.canonical_key = ANY($2::text[])
          OR (
            $3::boolean
            AND jsonb_typeof(version.applicability->'projection'->'capabilities') = 'array'
            AND (version.applicability->'projection'->'capabilities') ?| $4::text[]
            AND (
              version.applicability->'projection'->'consumers' IS NULL
              OR (
                jsonb_typeof(version.applicability->'projection'->'consumers') = 'array'
                AND (version.applicability->'projection'->'consumers') ? $5::text
              )
            )
            AND (
              version.applicability->'projection'->'audiences' IS NULL
              OR (
                jsonb_typeof(version.applicability->'projection'->'audiences') = 'array'
                AND (version.applicability->'projection'->'audiences') ? $6::text
              )
            )
          )
        )
      ORDER BY entry.canonical_key, publication.id
      LIMIT $7`,
    [
      target.organization_id,
      requestedKeys,
      target.audience !== 'customer',
      target.capabilities,
      target.consumer,
      target.audience,
      profile.maximumCandidates + 1,
    ]
  );
  if (result.rowCount > profile.maximumCandidates) {
    fail(
      'knowledge_sync_candidate_limit_exceeded',
      'Synchronization projection candidate limit was exceeded',
      413
    );
  }
  return result.rows;
}

function pinFromRow(row) {
  return {
    canonicalDigest: String(row.canonical_digest).trim(),
    entryId: row.entry_id,
    publicationId: row.publication_id,
    publicationNumber: Number(row.publication_number),
    versionId: row.version_id,
    versionNumber: Number(row.version_number),
  };
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function blockedCategory(error) {
  const code = error && error.code;
  if (code === 'knowledge_projection_incomplete') return 'projection_incomplete';
  if (code === 'knowledge_projection_size_exceeded') return 'projection_oversized';
  if (code === 'knowledge_projection_candidate_limit_exceeded' ||
      code === 'knowledge_sync_candidate_limit_exceeded') return 'candidate_limit_exceeded';
  if (code === 'knowledge_authorization_required') return 'authorization_required';
  if (code && (code.includes('integrity') || code.includes('pin_unavailable'))) {
    return 'integrity_failure';
  }
  return 'projection_unavailable';
}

function desiredIdentity(target, sourcePins, projectionDigest, diagnosticCategory) {
  return digestCanonical({
    configurationDigest: String(target.configuration_digest).trim(),
    projectionIdentity: projectionDigest || `blocked:${diagnosticCategory}`,
    sourcePins,
    targetId: target.id,
    targetRevision: Number(target.target_revision),
  });
}

async function enqueueTargetDesiredState(client, target, actorUserId, rawTrigger) {
  const trigger = normalizeTrigger(rawTrigger);
  const rows = await loadProjectionRows(client, target);
  const candidatePins = rows.map(pinFromRow).sort((left, right) => compareUtf8(left.entryId, right.entryId));
  let projection = null;
  let sourcePins = candidatePins;
  let diagnosticCategory = null;
  try {
    const latest = buildKnowledgeProjection(
      targetProjectionRequest(target, actorUserId, null),
      rows
    );
    sourcePins = latest.projection.sources;
    if (sourcePins.length < 1) {
      fail('knowledge_projection_incomplete', 'Synchronization projection has no exact sources');
    }
    projection = buildKnowledgeProjection(
      targetProjectionRequest(target, actorUserId, sourcePins),
      rows
    );
  } catch (error) {
    diagnosticCategory = blockedCategory(error);
  }
  const projectionDigest = projection ? projection.projectionDigest : null;
  const identity = desiredIdentity(target, sourcePins, projectionDigest, diagnosticCategory);
  const existing = await client.query(
    `SELECT * FROM canonical_knowledge_sync_outbox
      WHERE organization_id = $1 AND target_id = $2 AND idempotency_key = $3
      FOR UPDATE`,
    [target.organization_id, target.id, identity]
  );
  if (existing.rowCount === 1) {
    const stored = existing.rows[0];
    await client.query(
      `UPDATE canonical_knowledge_sync_states
          SET desired_event_id = $3,
              desired_sequence = $4,
              desired_projection_digest = $5,
              status = CASE WHEN $5::text IS NULL THEN 'blocked' ELSE
                CASE WHEN observed_projection_digest = $5 THEN 'in_sync' ELSE 'pending' END
              END,
              diagnostic_category = CASE WHEN $5::text IS NULL THEN $6 ELSE NULL END,
              updated_at = statement_timestamp()
        WHERE organization_id = $1 AND target_id = $2`,
      [
        target.organization_id, target.id, stored.id, stored.target_sequence,
        stored.projection_digest ? String(stored.projection_digest).trim() : null,
        stored.diagnostic_category,
      ]
    );
    return mapOutbox(stored);
  }

  const inserted = await client.query(
    `INSERT INTO canonical_knowledge_sync_outbox(
       organization_id, target_id, target_revision, target_sequence,
       configuration_digest, provider_key, consumer, audience, capabilities,
       maximum_entries, maximum_bytes, trigger_type,
       trigger_publication_id, trigger_entry_id, trigger_version_id,
       trigger_canonical_digest, source_pins, desired_projection,
       canonical_projection, projection_digest, idempotency_key, state,
       diagnostic_category
     ) VALUES (
       $1, $2, $3, 1, $4, $5, $6, $7, $8::jsonb, $9, $10, $11,
       $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, $20,
       $21, $22
     ) RETURNING *`,
    [
      target.organization_id,
      target.id,
      Number(target.target_revision),
      String(target.configuration_digest).trim(),
      target.provider_key,
      target.consumer,
      target.audience,
      JSON.stringify(target.capabilities),
      Number(target.maximum_entries),
      Number(target.maximum_bytes),
      trigger.type,
      trigger.publicationId || null,
      trigger.entryId || null,
      trigger.versionId || null,
      trigger.canonicalDigest || null,
      JSON.stringify(sourcePins),
      projection ? projection.canonicalProjection : null,
      projection ? projection.canonicalProjection : null,
      projectionDigest,
      identity,
      projection ? 'pending' : 'blocked',
      diagnosticCategory,
    ]
  );
  const outbox = inserted.rows[0];
  await client.query(
    `UPDATE canonical_knowledge_sync_states
        SET desired_event_id = $3,
            desired_sequence = $4,
            desired_projection_digest = $5,
            status = $6,
            diagnostic_category = $7,
            drift_detected_at = NULL,
            updated_at = statement_timestamp()
      WHERE organization_id = $1 AND target_id = $2`,
    [
      target.organization_id,
      target.id,
      outbox.id,
      outbox.target_sequence,
      projectionDigest,
      projection ? 'pending' : 'blocked',
      diagnosticCategory,
    ]
  );
  return mapOutbox(outbox);
}

async function enqueuePublicationSynchronization(client, publication, actorUserId) {
  // During a serialized 028 -> 029 upgrade the application module can be loaded
  // before the additive synchronization schema is mounted. Historical Part 5
  // publication remains valid in that narrow state; once 029 exists, every
  // matching active target is enforced by the deferred database assertions.
  const schema = await client.query(
    `SELECT to_regclass('public.canonical_knowledge_sync_targets') AS target_relation`
  );
  if (!schema.rows[0].target_relation) return [];
  const targets = await client.query(
    `SELECT target.*
       FROM canonical_knowledge_sync_targets target
      WHERE target.organization_id = $1
        AND target.status = 'active'
        AND public.canonical_knowledge_sync_target_matches_version(target.id, $2)
      ORDER BY target.provider_key, target.consumer, target.audience, target.id
      LIMIT $3
      FOR UPDATE`,
    [publication.organization_id, publication.version_id, MAX_TARGETS_PER_PUBLICATION + 1]
  );
  if (targets.rowCount > MAX_TARGETS_PER_PUBLICATION) {
    fail(
      'knowledge_sync_target_limit_exceeded',
      'Active synchronization target limit was exceeded',
      413
    );
  }
  const trigger = {
    type: 'publication',
    publicationId: publication.id,
    entryId: publication.entry_id,
    versionId: publication.version_id,
    canonicalDigest: String(publication.canonical_digest).trim(),
  };
  const events = [];
  for (const target of targets.rows) {
    events.push(await enqueueTargetDesiredState(client, target, actorUserId, trigger));
  }
  return events;
}

function mapDatabaseError(error) {
  if (error instanceof KnowledgeSynchronizationError) return error;
  if (error && error.code === '40001') {
    return new KnowledgeSynchronizationError(
      'knowledge_sync_conflict',
      'Synchronization state changed concurrently; retry from a fresh snapshot',
      409
    );
  }
  if (error && error.code === '42501') {
    return new KnowledgeSynchronizationError(
      'knowledge_sync_authorization_required',
      'An active owner or administrator membership is required',
      403
    );
  }
  if (error && error.code === '23505' &&
      error.constraint === 'canonical_knowledge_sync_outbox_idempotency_unique') {
    return new KnowledgeSynchronizationError(
      'knowledge_sync_duplicate_desired_state',
      'The exact desired synchronization state already exists',
      409
    );
  }
  return error;
}

class KnowledgeSynchronizationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async configureTarget(input) {
    try {
      return await withTransaction(this.pool, async client => {
        const initial = normalizeSyncTargetInput(input);
        await requireAdministrator(client, initial.organizationId, initial.actorUserId);
        const existing = await client.query(
          `SELECT * FROM canonical_knowledge_sync_targets
            WHERE organization_id = $1 AND provider_key = $2
              AND consumer = $3 AND audience = $4
            FOR UPDATE`,
          [initial.organizationId, initial.providerKey, initial.consumer, initial.audience]
        );
        let target;
        if (existing.rowCount === 0) {
          const normalized = normalizeSyncTargetInput({ ...input, targetRevision: 1 });
          const inserted = await client.query(
            `INSERT INTO canonical_knowledge_sync_targets(
               organization_id, provider_key, consumer, audience, capabilities,
               maximum_entries, maximum_bytes, stale_after_seconds,
               target_revision, configuration_digest, status,
               created_by_user_id, updated_by_user_id
             ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$12)
             RETURNING *`,
            [
              normalized.organizationId, normalized.providerKey, normalized.consumer,
              normalized.audience, JSON.stringify(normalized.capabilities),
              normalized.maximumEntries, normalized.maximumBytes,
              normalized.staleAfterSeconds, normalized.targetRevision,
              normalized.configurationDigest, normalized.status, normalized.actorUserId,
            ]
          );
          target = inserted.rows[0];
        } else {
          const current = existing.rows[0];
          const expectedRevision = input.expectedTargetRevision === undefined
            ? Number(current.target_revision)
            : positiveInteger(input.expectedTargetRevision, 'expectedTargetRevision', 2147483647);
          if (expectedRevision !== Number(current.target_revision)) {
            fail('knowledge_sync_stale_target', 'Synchronization target changed; reload before updating');
          }
          const normalized = normalizeSyncTargetInput({
            ...input,
            targetRevision: Number(current.target_revision) + 1,
          });
          const updated = await client.query(
            `UPDATE canonical_knowledge_sync_targets
                SET capabilities = $5::jsonb,
                    maximum_entries = $6,
                    maximum_bytes = $7,
                    stale_after_seconds = $8,
                    target_revision = $9,
                    configuration_digest = $10,
                    status = $11,
                    updated_by_user_id = $12
              WHERE organization_id = $1 AND provider_key = $2
                AND consumer = $3 AND audience = $4
              RETURNING *`,
            [
              normalized.organizationId, normalized.providerKey, normalized.consumer,
              normalized.audience, JSON.stringify(normalized.capabilities),
              normalized.maximumEntries, normalized.maximumBytes,
              normalized.staleAfterSeconds, normalized.targetRevision,
              normalized.configurationDigest, normalized.status, normalized.actorUserId,
            ]
          );
          target = updated.rows[0];
        }
        let desired = null;
        if (target.status === 'active') {
          desired = await enqueueTargetDesiredState(
            client, target, initial.actorUserId, { type: 'target_config' }
          );
        } else {
          await client.query(
            `UPDATE canonical_knowledge_sync_states
                SET status = 'suspended', diagnostic_category = 'target_suspended',
                    updated_at = statement_timestamp()
              WHERE organization_id = $1 AND target_id = $2`,
            [target.organization_id, target.id]
          );
        }
        const state = (await client.query(
          `SELECT * FROM canonical_knowledge_sync_states
            WHERE organization_id = $1 AND target_id = $2`,
          [target.organization_id, target.id]
        )).rows[0];
        return { target: mapTarget(target), desired, state: mapState(state) };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async getTargetState(input) {
    const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
    const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
    const targetId = normalizeUuid(input && input.targetId, 'targetId');
    return withTransaction(this.pool, async client => {
      await requireAdministrator(client, organizationId, actorUserId);
      const result = await client.query(
        `SELECT target.*, row_to_json(state.*) AS synchronization_state
           FROM canonical_knowledge_sync_targets target
           JOIN canonical_knowledge_sync_states state
             ON state.organization_id = target.organization_id AND state.target_id = target.id
          WHERE target.organization_id = $1 AND target.id = $2`,
        [organizationId, targetId]
      );
      if (result.rowCount !== 1) fail('knowledge_sync_target_not_found', 'Target was not found', 404);
      return {
        target: mapTarget(result.rows[0]),
        state: mapState(result.rows[0].synchronization_state),
      };
    });
  }

  async claimJobs(input = {}) {
    const options = normalizeClaimOptions(input);
    try {
      return await withTransaction(this.pool, async client => {
        const claimed = await client.query(
          `WITH candidate AS (
             SELECT outbox.id
               FROM canonical_knowledge_sync_outbox outbox
               JOIN canonical_knowledge_sync_targets target
                 ON target.organization_id = outbox.organization_id
                AND target.id = outbox.target_id
              WHERE target.status = 'active'
                AND outbox.state IN ('pending', 'retry')
                AND outbox.available_at <= statement_timestamp()
                AND NOT EXISTS (
                  SELECT 1 FROM canonical_knowledge_sync_outbox prior
                   WHERE prior.organization_id = outbox.organization_id
                     AND prior.target_id = outbox.target_id
                     AND prior.target_sequence < outbox.target_sequence
                     AND prior.state IN ('pending', 'retry', 'claimed')
                )
              ORDER BY outbox.available_at, outbox.organization_id,
                       outbox.target_id, outbox.target_sequence, outbox.id
              LIMIT $1
              FOR UPDATE OF outbox SKIP LOCKED
           )
           UPDATE canonical_knowledge_sync_outbox outbox
              SET state = 'claimed',
                  attempt_count = outbox.attempt_count + 1,
                  claim_token = gen_random_uuid(),
                  claimed_at = statement_timestamp(),
                  lease_expires_at = statement_timestamp() + ($2::text || ' seconds')::interval,
                  diagnostic_category = NULL
             FROM candidate
            WHERE outbox.id = candidate.id
           RETURNING outbox.*`,
          [options.batchSize, options.leaseSeconds]
        );
        for (const job of claimed.rows) {
          await client.query(
            `INSERT INTO canonical_knowledge_sync_attempts(
               organization_id, target_id, outbox_id, reconciliation_generation,
               attempt_number, claim_token, idempotency_key
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              job.organization_id, job.target_id, job.id,
              job.reconciliation_generation, job.attempt_count,
              job.claim_token, job.idempotency_key,
            ]
          );
        }
        return claimed.rows.map(mapOutbox);
      }, 'READ COMMITTED');
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async renewLease(input) {
    const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
    const id = normalizeUuid(input && input.id, 'id');
    const claimToken = normalizeUuid(input && input.claimToken, 'claimToken');
    const leaseSeconds = normalizeClaimOptions({ batchSize: 1, leaseSeconds: input.leaseSeconds }).leaseSeconds;
    return withTransaction(this.pool, async client => {
      const result = await client.query(
        `UPDATE canonical_knowledge_sync_outbox
            SET lease_expires_at = statement_timestamp() + ($4::text || ' seconds')::interval
          WHERE organization_id = $1 AND id = $2 AND claim_token = $3
            AND state = 'claimed' AND lease_expires_at > statement_timestamp()
          RETURNING *`,
        [organizationId, id, claimToken, leaseSeconds]
      );
      return mapOutbox(result.rows[0]);
    }, 'READ COMMITTED');
  }

  async finalizeJob(input) {
    const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
    const id = normalizeUuid(input && input.id, 'id');
    const claimToken = normalizeUuid(input && input.claimToken, 'claimToken');
    const accepted = input && input.accepted === true;
    const observedDigest = normalizeObservedDigest(input && input.observedProjectionDigest, accepted);
    const requestedCategory = accepted ? null : normalizeDiagnosticCategory(
      input && input.diagnosticCategory
    );
    try {
      return await withTransaction(this.pool, async client => {
        const selected = await client.query(
          `SELECT * FROM canonical_knowledge_sync_outbox
            WHERE organization_id = $1 AND id = $2
            FOR UPDATE`,
          [organizationId, id]
        );
        if (selected.rowCount !== 1) return null;
        const job = selected.rows[0];
        if (job.state !== 'claimed' || job.claim_token !== claimToken ||
            new Date(job.lease_expires_at).getTime() <= Date.now()) return null;
        const exactSuccess = accepted && observedDigest === String(job.projection_digest).trim();
        const drift = accepted && !exactSuccess;
        const category = drift ? 'projection_digest_mismatch' : requestedCategory;
        const terminal = Number(job.attempt_count) >= MAX_ATTEMPTS;
        const nextState = exactSuccess ? 'succeeded' : (terminal ? 'dead' : 'retry');
        const delay = exactSuccess || terminal ? 0 : retryDelaySeconds(Number(job.attempt_count));
        const updated = await client.query(
          `UPDATE canonical_knowledge_sync_outbox
              SET state = $4::text,
                  claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL,
                  observed_projection_digest = $5,
                  diagnostic_category = $6,
                  available_at = CASE WHEN $4::text = 'retry'
                    THEN statement_timestamp() + ($7::text || ' seconds')::interval
                    ELSE available_at END,
                  succeeded_at = CASE WHEN $4::text = 'succeeded' THEN statement_timestamp() ELSE NULL END,
                  dead_at = CASE WHEN $4::text = 'dead' THEN statement_timestamp() ELSE NULL END
            WHERE organization_id = $1 AND id = $2 AND claim_token = $3
            RETURNING *`,
          [organizationId, id, claimToken, nextState, observedDigest, category, delay]
        );
        if (updated.rowCount !== 1) return null;
        const outcome = exactSuccess ? 'succeeded' : (drift ? 'drift' : nextState);
        await client.query(
          `UPDATE canonical_knowledge_sync_attempts
              SET outcome = $7, diagnostic_category = $8,
                  observed_projection_digest = $9, completed_at = statement_timestamp()
            WHERE organization_id = $1 AND target_id = $2 AND outbox_id = $3
              AND reconciliation_generation = $4 AND attempt_number = $5
              AND claim_token = $6 AND outcome IS NULL`,
          [
            job.organization_id, job.target_id, job.id,
            job.reconciliation_generation, job.attempt_count, claimToken,
            outcome, category, observedDigest,
          ]
        );
        const state = await client.query(
          `SELECT * FROM canonical_knowledge_sync_states
            WHERE organization_id = $1 AND target_id = $2
            FOR UPDATE`,
          [job.organization_id, job.target_id]
        );
        const desiredIsThis = state.rows[0] && state.rows[0].desired_event_id === job.id;
        if (exactSuccess) {
          await client.query(
            `UPDATE canonical_knowledge_sync_states
                SET observed_event_id = $3, observed_sequence = $4,
                    observed_projection_digest = $5,
                    last_known_good_event_id = $3,
                    last_known_good_sequence = $4,
                    last_known_good_projection_digest = $5,
                    status = CASE WHEN desired_event_id = $3 THEN 'in_sync' ELSE 'pending' END,
                    diagnostic_category = NULL, drift_detected_at = NULL,
                    last_observed_at = statement_timestamp(), updated_at = statement_timestamp()
              WHERE organization_id = $1 AND target_id = $2`,
            [job.organization_id, job.target_id, job.id, job.target_sequence, observedDigest]
          );
        } else if (desiredIsThis) {
          await client.query(
            `UPDATE canonical_knowledge_sync_states
                SET observed_event_id = CASE WHEN $3::text IS NULL THEN observed_event_id ELSE $4 END,
                    observed_sequence = CASE WHEN $3::text IS NULL THEN observed_sequence ELSE $5 END,
                    observed_projection_digest = COALESCE($3, observed_projection_digest),
                    status = $6::text,
                    diagnostic_category = $7,
                    drift_detected_at = CASE WHEN $6::text = 'drift'
                      THEN statement_timestamp() ELSE drift_detected_at END,
                    last_observed_at = CASE WHEN $3::text IS NULL
                      THEN last_observed_at ELSE statement_timestamp() END,
                    updated_at = statement_timestamp()
              WHERE organization_id = $1 AND target_id = $2`,
            [
              job.organization_id, job.target_id, observedDigest, job.id,
              job.target_sequence,
              drift ? 'drift' : (terminal ? 'dead' : 'retry'), category,
            ]
          );
        }
        return { job: mapOutbox(updated.rows[0]), state: nextState, exactSuccess, drift };
      }, 'READ COMMITTED');
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async recoverExpiredJobs(input = {}) {
    const options = normalizeClaimOptions({
      batchSize: input.batchSize,
      leaseSeconds: input.leaseSeconds === undefined ? 30 : input.leaseSeconds,
    });
    return withTransaction(this.pool, async client => {
      const expired = await client.query(
        `SELECT * FROM canonical_knowledge_sync_outbox
          WHERE state = 'claimed' AND lease_expires_at <= statement_timestamp()
          ORDER BY lease_expires_at, organization_id, target_id, target_sequence, id
          LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [options.batchSize]
      );
      for (const job of expired.rows) {
        const terminal = Number(job.attempt_count) >= MAX_ATTEMPTS;
        const nextState = terminal ? 'dead' : 'retry';
        const delay = terminal ? 0 : retryDelaySeconds(Number(job.attempt_count));
        await client.query(
          `UPDATE canonical_knowledge_sync_outbox
              SET state = $3::text, claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL,
                  diagnostic_category = 'claim_expired',
                  available_at = CASE WHEN $3::text = 'retry'
                    THEN statement_timestamp() + ($4::text || ' seconds')::interval ELSE available_at END,
                  dead_at = CASE WHEN $3::text = 'dead' THEN statement_timestamp() ELSE NULL END
            WHERE organization_id = $1 AND id = $2`,
          [job.organization_id, job.id, nextState, delay]
        );
        await client.query(
          `UPDATE canonical_knowledge_sync_attempts
              SET outcome = 'claim_expired', diagnostic_category = 'claim_expired',
                  completed_at = statement_timestamp()
            WHERE organization_id = $1 AND target_id = $2 AND outbox_id = $3
              AND reconciliation_generation = $4 AND attempt_number = $5
              AND claim_token = $6 AND outcome IS NULL`,
          [
            job.organization_id, job.target_id, job.id,
            job.reconciliation_generation, job.attempt_count, job.claim_token,
          ]
        );
        await client.query(
          `UPDATE canonical_knowledge_sync_states
              SET status = CASE WHEN $3 THEN 'dead' ELSE 'retry' END,
                  diagnostic_category = 'claim_expired', updated_at = statement_timestamp()
            WHERE organization_id = $1 AND target_id = $2 AND desired_event_id = $4`,
          [job.organization_id, job.target_id, terminal, job.id]
        );
      }
      return expired.rowCount;
    }, 'READ COMMITTED');
  }

  async reconcileTarget(input) {
    const organizationId = normalizeUuid(input && input.organizationId, 'organizationId');
    const actorUserId = normalizeUuid(input && input.actorUserId, 'actorUserId');
    const targetId = normalizeUuid(input && input.targetId, 'targetId');
    const expectedTargetRevision = positiveInteger(
      input && input.expectedTargetRevision,
      'expectedTargetRevision',
      2147483647
    );
    const expectedConfigurationDigest = normalizeDigest(
      input && input.expectedConfigurationDigest,
      'expectedConfigurationDigest'
    );
    return withTransaction(this.pool, async client => {
      await requireAdministrator(client, organizationId, actorUserId);
      const selected = await client.query(
        `SELECT * FROM canonical_knowledge_sync_targets
          WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [organizationId, targetId]
      );
      if (selected.rowCount !== 1) fail('knowledge_sync_target_not_found', 'Target was not found', 404);
      const target = selected.rows[0];
      if (target.status !== 'active' || Number(target.target_revision) !== expectedTargetRevision ||
          String(target.configuration_digest).trim() !== expectedConfigurationDigest) {
        fail('knowledge_sync_stale_target', 'Synchronization target changed; reload before reconciling');
      }
      const event = await enqueueTargetDesiredState(
        client, target, actorUserId, { type: 'reconciliation' }
      );
      let current = (await client.query(
        `SELECT * FROM canonical_knowledge_sync_outbox
          WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [organizationId, event.id]
      )).rows[0];
      const state = (await client.query(
        `SELECT * FROM canonical_knowledge_sync_states
          WHERE organization_id = $1 AND target_id = $2 FOR UPDATE`,
        [organizationId, targetId]
      )).rows[0];
      if (current && ['dead', 'succeeded'].includes(current.state) &&
          ['dead', 'drift', 'stale'].includes(state.status)) {
        current = (await client.query(
          `UPDATE canonical_knowledge_sync_outbox
              SET state = 'retry', reconciliation_generation = reconciliation_generation + 1,
                  attempt_count = 0, available_at = statement_timestamp(),
                  diagnostic_category = 'reconciliation_requested',
                  succeeded_at = NULL, dead_at = NULL
            WHERE organization_id = $1 AND id = $2
            RETURNING *`,
          [organizationId, current.id]
        )).rows[0];
        await client.query(
          `UPDATE canonical_knowledge_sync_states
              SET status = 'retry', diagnostic_category = 'reconciliation_requested',
                  updated_at = statement_timestamp()
            WHERE organization_id = $1 AND target_id = $2`,
          [organizationId, targetId]
        );
      }
      return mapOutbox(current);
    });
  }

  async reconcileStaleTargets(input = {}) {
    const batchSize = positiveInteger(input.batchSize === undefined ? 10 : input.batchSize, 'batchSize', 25);
    return withTransaction(this.pool, async client => {
      const targets = await client.query(
        `SELECT target.*, state.desired_event_id, state.status AS sync_status
           FROM canonical_knowledge_sync_targets target
           JOIN canonical_knowledge_sync_states state
             ON state.organization_id = target.organization_id AND state.target_id = target.id
          WHERE target.status = 'active'
            AND state.desired_event_id IS NOT NULL
            AND state.status = 'in_sync'
            AND state.last_observed_at IS NOT NULL
            AND state.last_observed_at + (target.stale_after_seconds::text || ' seconds')::interval
                <= statement_timestamp()
          ORDER BY state.last_observed_at, target.organization_id, target.id
          LIMIT $1 FOR UPDATE OF target, state SKIP LOCKED`,
        [batchSize]
      );
      for (const target of targets.rows) {
        const event = (await client.query(
          `SELECT * FROM canonical_knowledge_sync_outbox
            WHERE organization_id = $1 AND target_id = $2 AND id = $3
            FOR UPDATE`,
          [target.organization_id, target.id, target.desired_event_id]
        )).rows[0];
        if (!event || event.state !== 'succeeded') continue;
        await client.query(
          `UPDATE canonical_knowledge_sync_outbox
              SET state = 'retry', reconciliation_generation = reconciliation_generation + 1,
                  attempt_count = 0, available_at = statement_timestamp(),
                  diagnostic_category = 'stale_observation',
                  succeeded_at = NULL
            WHERE organization_id = $1 AND id = $2`,
          [target.organization_id, event.id]
        );
        await client.query(
          `UPDATE canonical_knowledge_sync_states
              SET status = 'stale', diagnostic_category = 'stale_observation',
                  updated_at = statement_timestamp()
            WHERE organization_id = $1 AND target_id = $2`,
          [target.organization_id, target.id]
        );
      }
      return targets.rowCount;
    }, 'READ COMMITTED');
  }
}

module.exports = {
  KnowledgeSynchronizationRepository,
  enqueuePublicationSynchronization,
  enqueueTargetDesiredState,
  loadProjectionRows,
  mapOutbox,
  mapState,
  mapTarget,
};
