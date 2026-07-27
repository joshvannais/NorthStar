'use strict';

const { randomUUID } = require('crypto');
const { v5: uuidv5 } = require('uuid');
const db = require('../db');
const repository = require('../persistence/v2/repository');
const { sha256, stableValue } = require('./businessProfileAdapter');
const { CALCULATION_VERSION, calculateCanonicalPolaris } = require('./canonicalPolarisCalculation');
const { getActiveBusinessProfile, getBusinessProfileById } = require('./organizationAuthority');

const SOURCES = new Set(['simulation', 'demo', 'retell', 'voice', 'lead']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH_STAGES = Object.freeze([
  'customer', 'transcript', 'facts', 'communication', 'opportunity',
  'estimate', 'appointment', 'polarisSnapshot', 'operationCompletion',
]);

function safeError(status, code, message, extra) {
  return {
    status,
    body: {
      success: false,
      error: { code, message },
      ...(extra || {}),
    },
  };
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_GRAPH_REQUEST';
  error.status = 400;
  return error;
}

function requireText(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw validationError(field + ' is required');
  return normalized;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTurns(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const normalized = turns.map(function (turn, index) {
    const speaker = String(turn && (turn.speaker || turn.role || turn.from) || '').trim().toLowerCase();
    const text = String(turn && (turn.text !== undefined ? turn.text : turn.utterance) || '').trim();
    return {
      turnId: turn && turn.turnId ? String(turn.turnId) : 'turn-' + (index + 1),
      speaker,
      text,
    };
  }).filter(function (turn) { return turn.text; });
  if (!normalized.length) throw validationError('transcript must contain at least one non-empty turn');
  return normalized;
}

function normalizeFacts(facts) {
  return (Array.isArray(facts) ? facts : []).map(function (fact, index) {
    const evidence = fact && fact.evidence && typeof fact.evidence === 'object' ? fact.evidence : {};
    const evidenceText = optionalText(fact && (fact.evidenceText || evidence.exactSpan || evidence.utterance));
    const speaker = String(fact && (fact.speaker || evidence.speaker) || '').trim().toLowerCase();
    if (!evidenceText || !speaker) {
      throw validationError('facts[' + index + '] requires evidenceText and speaker');
    }
    const confidenceValue = fact && fact.confidence !== undefined ? fact.confidence : fact && fact.extractionConfidence;
    const confidence = confidenceValue === undefined || confidenceValue === null ? null : Number(confidenceValue);
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw validationError('facts[' + index + '].confidence must be between 0 and 1');
    }
    return {
      clientFactId: optionalText(fact && (fact.id || fact.factId)),
      variable: requireText(fact && (fact.variable || fact.factType), 'facts[' + index + '].variable'),
      status: optionalText(fact && fact.status) || 'collected',
      normalizedValue: stableValue(fact && fact.normalizedValue !== undefined ? fact.normalizedValue
        : (fact && fact.value !== undefined ? fact.value : null)),
      evidenceText,
      speaker,
      evidenceTurnId: optionalText(fact && (fact.evidenceTurnId || evidence.turnId)),
      confidence,
      sourceStart: Number.isInteger(fact && fact.sourceStart) ? fact.sourceStart : null,
      sourceEnd: Number.isInteger(fact && fact.sourceEnd) ? fact.sourceEnd : null,
    };
  });
}

function normalizeRequest(source) {
  const request = source && typeof source === 'object' ? source : {};
  const tenant = request.tenantContext && typeof request.tenantContext === 'object' ? request.tenantContext : {};
  const organizationId = requireText(tenant.organizationId, 'trusted tenantContext.organizationId');
  if (!UUID.test(organizationId)) throw validationError('trusted tenantContext.organizationId must be a UUID');
  const idempotencyKey = requireText(request.idempotencyKey, 'idempotencyKey');
  if (idempotencyKey.length > 512) throw validationError('idempotencyKey is too long');
  const ingestionSource = requireText(request.source, 'source').toLowerCase();
  if (!SOURCES.has(ingestionSource)) throw validationError('source must be simulation, demo, retell, voice, or lead');
  const service = request.service && typeof request.service === 'object' ? request.service : {};
  const customer = request.customer && typeof request.customer === 'object' ? request.customer : {};
  const normalized = {
    organizationId,
    source: ingestionSource,
    sourceVersion: optionalText(request.sourceVersion) || 'v1',
    external: {
      customerId: optionalText(request.external && request.external.customerId),
      callId: optionalText(request.external && request.external.callId),
      transcriptId: optionalText(request.external && request.external.transcriptId),
      communicationId: optionalText(request.external && request.external.communicationId),
      appointmentId: optionalText(request.external && request.external.appointmentId),
    },
    customer: {
      name: requireText(customer.name, 'customer.name'),
      email: optionalText(customer.email),
      phone: optionalText(customer.phone),
      address: customer.address === undefined ? null : stableValue(customer.address),
    },
    transcript: normalizeTurns(request.transcript),
    facts: normalizeFacts(request.facts),
    service: {
      key: requireText(service.key, 'service.key').toLowerCase(),
      scope: stableValue(service.scope || {}),
    },
    appointmentPreference: request.appointmentPreference ? stableValue(request.appointmentPreference) : null,
    scheduledAppointment: request.scheduledAppointment ? stableValue(request.scheduledAppointment) : null,
    travel: request.travel ? stableValue(request.travel) : null,
    pricingSettings: request.pricingSettings ? stableValue(request.pricingSettings) : null,
    costSettings: request.costSettings ? stableValue(request.costSettings) : null,
    actualCrewAssignment: request.actualCrewAssignment ? stableValue(request.actualCrewAssignment) : null,
    callDurationSeconds: request.callDurationSeconds === undefined ? null : request.callDurationSeconds,
    occurredAt: optionalText(request.occurredAt),
    calculationVersion: optionalText(request.calculationVersion) || CALCULATION_VERSION,
    businessProfileAuthorityId: optionalText(request.businessProfileAuthorityId),
    businessProfileAuthorityVersion: optionalText(request.businessProfileAuthorityVersion),
    businessProfileAuthorityHash: optionalText(request.businessProfileAuthorityHash),
  };
  if (normalized.businessProfileAuthorityId && !UUID.test(normalized.businessProfileAuthorityId)) {
    throw validationError('businessProfileAuthorityId must be a UUID');
  }
  if (normalized.businessProfileAuthorityHash && !/^[0-9a-f]{64}$/.test(normalized.businessProfileAuthorityHash)) {
    throw validationError('businessProfileAuthorityHash must be a SHA-256 digest');
  }
  return { normalized, idempotencyKey };
}

function normalizeEmail(value) {
  const normalized = optionalText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizePhone(value) {
  const normalized = optionalText(value);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

function identityConflict() {
  const error = new Error('Strong customer identifiers resolve to different canonical customers.');
  error.code = 'CANONICAL_CUSTOMER_IDENTITY_CONFLICT';
  error.safeCode = 'customer_identity_conflict';
  error.retryable = false;
  return error;
}

async function resolveCanonicalCustomer(client, request, proposedCustomerId, common) {
  const normalizedEmail = normalizeEmail(request.customer.email);
  const normalizedPhone = normalizePhone(request.customer.phone);
  const externalCustomerId = request.external.customerId;
  const lockKeys = [
    normalizedEmail ? 'email:' + normalizedEmail : null,
    normalizedPhone ? 'phone:' + normalizedPhone : null,
    externalCustomerId ? 'external:' + externalCustomerId : null,
  ].filter(Boolean).map(function (value) {
    return request.organizationId + ':' + value;
  }).sort();

  for (const lockKey of lockKeys) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
  }

  const candidates = new Set();
  if (normalizedEmail || normalizedPhone) {
    const identities = await client.query(
      `SELECT customer_id
         FROM canonical_customer_identities
        WHERE organization_id = $1
          AND ((identity_type = 'email' AND normalized_value = $2)
            OR (identity_type = 'phone' AND normalized_value = $3))`,
      [request.organizationId, normalizedEmail || '', normalizedPhone || '']
    );
    identities.rows.forEach(function (row) { candidates.add(row.customer_id); });
  }
  if (externalCustomerId) {
    const external = await client.query(
      `SELECT id FROM canonical_customers
        WHERE organization_id = $1 AND external_customer_id = $2`,
      [request.organizationId, externalCustomerId]
    );
    external.rows.forEach(function (row) { candidates.add(row.id); });
  }
  if (candidates.size > 1) throw identityConflict();

  let customerId = candidates.size === 1 ? Array.from(candidates)[0] : null;
  if (!customerId) {
    await client.query(
      `INSERT INTO canonical_customers
        (id, organization_id, operation_id, graph_id, external_customer_id, name, email, phone, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [proposedCustomerId, ...common, externalCustomerId, request.customer.name, request.customer.email,
        request.customer.phone, JSON.stringify(request.customer.address)]
    );
    customerId = proposedCustomerId;
  } else {
    const updated = await client.query(
      `UPDATE canonical_customers
          SET name = CASE WHEN name IS NULL OR btrim(name) = '' THEN $3 ELSE name END,
              email = COALESCE(email, $4), phone = COALESCE(phone, $5),
              address = COALESCE(address, $6::jsonb),
              external_customer_id = COALESCE(external_customer_id, $7),
              updated_at = NOW()
        WHERE organization_id = $1 AND id = $2
        RETURNING id`,
      [request.organizationId, customerId, request.customer.name, request.customer.email,
        request.customer.phone, JSON.stringify(request.customer.address), externalCustomerId]
    );
    if (updated.rows.length !== 1) throw identityConflict();
  }

  const identitiesToBind = [
    normalizedEmail ? ['email', normalizedEmail] : null,
    normalizedPhone ? ['phone', normalizedPhone] : null,
  ].filter(Boolean);
  for (const identity of identitiesToBind) {
    const bound = await client.query(
      `INSERT INTO canonical_customer_identities
        (organization_id, identity_type, normalized_value, customer_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id, identity_type, normalized_value) DO UPDATE
         SET customer_id = canonical_customer_identities.customer_id
       RETURNING customer_id`,
      [request.organizationId, identity[0], identity[1], customerId]
    );
    if (bound.rows[0].customer_id !== customerId) throw identityConflict();
  }
  return customerId;
}

function artifactIds(graphId, factCount) {
  const ids = {
    customer: uuidv5('canonical-customer', graphId),
    transcript: uuidv5('canonical-transcript', graphId),
    communication: uuidv5('canonical-communication', graphId),
    opportunity: uuidv5('canonical-opportunity', graphId),
    estimate: uuidv5('canonical-estimate', graphId),
    appointment: uuidv5('canonical-appointment', graphId),
    polarisSnapshot: uuidv5('canonical-polaris-snapshot', graphId),
  };
  ids.facts = Array.from({ length: factCount }, function (_, index) {
    return uuidv5('canonical-fact-' + index, graphId);
  });
  return ids;
}

function transcriptText(turns) {
  return turns.map(function (turn) { return turn.speaker + ': ' + turn.text; }).join('\n');
}

function stageFailure(options, stage) {
  if (options && options.failAfterStage === stage) {
    const error = new Error('Injected canonical graph failure');
    error.code = 'INJECTED_GRAPH_FAILURE';
    error.safeCode = 'injected_' + stage;
    error.retryable = options.retryableFailure !== false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
}

async function claimOrReplay(pool, claimInput, options) {
  const waitMs = Number(options.waitMs || 25);
  const maxWaitMs = Number(options.maxWaitMs || 10000);
  const deadline = Date.now() + maxWaitMs;
  let claim = await repository.claimOperation(pool, claimInput);
  while (claim.kind === 'active') {
    const operation = await repository.getOperation(pool, claimInput.organizationId, claim.operation.id);
    if (!operation) throw Object.assign(new Error('Operation unavailable while waiting'), { code: 'persistence_unavailable' });
    if (operation.state === repository.OPERATION_STATES.COMPLETED) return { kind: 'replay', operation };
    if (operation.state === repository.OPERATION_STATES.PERMANENT_FAILED) return { kind: 'permanent_failure', operation };
    if (new Date(operation.lease_expires_at).getTime() <= Date.now()) {
      claim = await repository.claimOperation(pool, { ...claimInput, now: new Date() });
      continue;
    }
    if (Date.now() >= deadline) return { kind: 'active_timeout', operation };
    await delay(Math.min(waitMs, Math.max(1, deadline - Date.now())));
  }
  return claim;
}

async function insertGraph(client, operation, leaseOwner, request, options) {
  const ids = artifactIds(operation.graph_id, request.facts.length);
  const persistedFacts = request.facts.map(function (fact, index) {
    return { ...fact, id: ids.facts[index] };
  });
  const text = transcriptText(request.transcript);
  const transcriptFingerprint = sha256(request.transcript);
  const common = [request.organizationId, operation.id, operation.graph_id];

  ids.customer = await resolveCanonicalCustomer(client, request, ids.customer, common);
  stageFailure(options, 'customer');

  const calculation = calculateCanonicalPolaris({
    organizationId: request.organizationId,
    customerId: ids.customer,
    opportunityId: ids.opportunity,
    calculationVersion: request.calculationVersion,
    service: request.service,
    transcript: request.transcript,
    facts: persistedFacts.map(function (fact) {
      return {
        id: fact.id,
        variable: fact.variable,
        status: fact.status,
        normalizedValue: fact.normalizedValue,
        evidenceTurnId: fact.evidenceTurnId,
      };
    }),
    businessProfile: request.businessProfile,
    appointmentPreference: request.appointmentPreference,
    travel: request.travel,
    pricingSettings: request.pricingSettings,
    costSettings: request.costSettings,
    actualCrewAssignment: request.actualCrewAssignment,
    callDurationSeconds: request.callDurationSeconds,
  });
  const snapshotDigest = sha256(calculation);

  await client.query(
    `INSERT INTO canonical_transcripts
      (id, organization_id, operation_id, graph_id, customer_id, source, source_version,
       external_call_id, external_transcript_id, transcript_text, normalized_fingerprint, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [ids.transcript, ...common, ids.customer, request.source, request.sourceVersion, request.external.callId,
      request.external.transcriptId, text, transcriptFingerprint, request.occurredAt]
  );
  stageFailure(options, 'transcript');

  for (let index = 0; index < persistedFacts.length; index += 1) {
    const fact = persistedFacts[index];
    const factValue = { status: fact.status, value: fact.normalizedValue, clientFactId: fact.clientFactId };
    await client.query(
      `INSERT INTO canonical_facts
        (id, organization_id, operation_id, graph_id, transcript_id, ordinal, fact_type, value,
         evidence_text, speaker, confidence, source_start, source_end, fact_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
      [fact.id, ...common, ids.transcript, index, fact.variable, JSON.stringify(factValue), fact.evidenceText,
        fact.speaker, fact.confidence, fact.sourceStart, fact.sourceEnd, sha256({ index, fact })]
    );
  }
  stageFailure(options, 'facts');

  await client.query(
    `INSERT INTO canonical_communications
      (id, organization_id, operation_id, graph_id, customer_id, transcript_id,
       external_communication_id, channel, direction, subject, body, duration_seconds, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [ids.communication, ...common, ids.customer, ids.transcript, request.external.communicationId,
      request.source === 'demo' || request.source === 'simulation' ? 'demo_call' : 'voice_call',
      'inbound', request.service.key + ' inquiry', text, request.callDurationSeconds, request.occurredAt]
  );
  stageFailure(options, 'communication');

  await client.query(
    `INSERT INTO canonical_opportunities
      (id, organization_id, operation_id, graph_id, customer_id, status, service_type, job_scope, appointment_preference)
     VALUES ($1,$2,$3,$4,$5,'lead',$6,$7::jsonb,$8::jsonb)`,
    [ids.opportunity, ...common, ids.customer, request.service.key, JSON.stringify(request.service.scope),
      JSON.stringify(request.appointmentPreference)]
  );
  stageFailure(options, 'opportunity');

  await client.query(
    `INSERT INTO canonical_estimates
      (id, organization_id, operation_id, graph_id, opportunity_id, calculation_version,
        normalized_input_fingerprint, business_profile_version, business_profile_hash, currency,
       customer_price, line_items, calculation_output, snapshot_digest, business_profile_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)`,
    [ids.estimate, ...common, ids.opportunity, calculation.calculationVersion,
      calculation.normalizedInputFingerprint, calculation.businessProfileInputVersion,
      calculation.businessProfileInputHash, request.businessProfile.currency || 'USD', calculation.customerFacingPrice,
      JSON.stringify(calculation.pricingLineItems), JSON.stringify(calculation), snapshotDigest,
      request.businessProfileAuthority.id]
  );
  stageFailure(options, 'estimate');

  const scheduled = request.scheduledAppointment || {};
  await client.query(
    `INSERT INTO canonical_appointments
      (id, organization_id, operation_id, graph_id, opportunity_id, external_appointment_id,
       preference, scheduled_start, scheduled_end, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
    [ids.appointment, ...common, ids.opportunity, request.external.appointmentId,
      JSON.stringify(request.appointmentPreference), scheduled.start || null, scheduled.end || null,
      scheduled.status || 'preferred']
  );
  stageFailure(options, 'appointment');

  await client.query(
    `INSERT INTO canonical_polaris_snapshots
      (id, organization_id, operation_id, graph_id, customer_id, transcript_id, opportunity_id,
       estimate_id, calculation_version, normalized_input_fingerprint, business_profile_version,
       business_profile_hash, supporting_fact_ids, snapshot, snapshot_digest, business_profile_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[],$14::jsonb,$15,$16)`,
    [ids.polarisSnapshot, ...common, ids.customer, ids.transcript, ids.opportunity, ids.estimate,
      calculation.calculationVersion, calculation.normalizedInputFingerprint,
      calculation.businessProfileInputVersion, calculation.businessProfileInputHash,
      ids.facts, JSON.stringify(calculation), snapshotDigest, request.businessProfileAuthority.id]
  );
  stageFailure(options, 'polarisSnapshot');

  const resultBody = {
    success: true,
    operationId: operation.id,
    graphId: operation.graph_id,
    ids,
    calculationVersion: calculation.calculationVersion,
    normalizedInputFingerprint: calculation.normalizedInputFingerprint,
    businessProfile: {
      id: request.businessProfileAuthority.id,
      version: request.businessProfileAuthority.versionLabel,
      hash: request.businessProfileAuthority.profileHash,
    },
    snapshotDigest,
    snapshot: calculation,
  };
  stageFailure(options, 'operationCompletion');
  await repository.completeOperation(client, {
    organizationId: request.organizationId,
    operationId: operation.id,
    leaseOwner,
    resultStatus: 201,
    resultBody,
  });
  return { status: 201, body: resultBody, replayed: false };
}

async function executeCanonicalGraph(pool, source, options) {
  let parsed;
  try {
    parsed = normalizeRequest(source);
  } catch (error) {
    return safeError(error.status || 400, error.code || 'INVALID_GRAPH_REQUEST', error.message);
  }
  const request = parsed.normalized;
  const resolvedPool = pool || db.getPool();
  if (!resolvedPool || typeof resolvedPool.query !== 'function') {
    return safeError(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  const keyHash = sha256({ organizationId: request.organizationId, idempotencyKey: parsed.idempotencyKey });
  const payloadFingerprint = sha256(request);
  const leaseOwner = options && options.leaseOwner ? options.leaseOwner : randomUUID();
  const claimInput = {
    organizationId: request.organizationId,
    keyHash,
    payloadFingerprint,
    leaseOwner,
    leaseMs: options && options.leaseMs ? options.leaseMs : 30000,
  };

  let claim;
  try {
    claim = await claimOrReplay(resolvedPool, claimInput, options || {});
  } catch (error) {
    return safeError(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
  }
  if (claim.kind === 'conflict') {
    return safeError(409, 'IDEMPOTENCY_FINGERPRINT_CONFLICT', 'The idempotency key was already used for different input.');
  }
  if (claim.kind === 'replay') {
    return { status: claim.operation.result_status, body: claim.operation.result_body, replayed: true };
  }
  if (claim.kind === 'permanent_failure') {
    if (claim.operation.safe_error_code === 'customer_identity_conflict') {
      return safeError(409, 'CANONICAL_CUSTOMER_IDENTITY_CONFLICT', 'Strong customer identifiers conflict.');
    }
    return safeError(422, claim.operation.safe_error_code || 'PERMANENT_OPERATION_FAILURE', 'The canonical operation cannot be retried.');
  }
  if (claim.kind === 'active_timeout') {
    return safeError(409, 'OPERATION_IN_PROGRESS', 'The matching canonical operation is still in progress.');
  }

  if (options && options.crashAfterClaim) {
    const crash = new Error('Injected crash after claim');
    crash.code = 'INJECTED_CRASH_AFTER_CLAIM';
    throw crash;
  }

  try {
    const authority = request.businessProfileAuthorityId
      ? await getBusinessProfileById(resolvedPool, request.organizationId, request.businessProfileAuthorityId)
      : await getActiveBusinessProfile(resolvedPool, request.organizationId);
    if ((request.businessProfileAuthorityVersion && request.businessProfileAuthorityVersion !== authority.versionLabel) ||
        (request.businessProfileAuthorityHash && request.businessProfileAuthorityHash !== authority.profileHash)) {
      const mismatch = new Error('Pinned Business Profile provenance does not match persisted authority.');
      mismatch.code = 'CANONICAL_BUSINESS_PROFILE_REQUIRED';
      throw mismatch;
    }
    request.businessProfile = authority.normalizedProfile;
    request.businessProfileAuthority = authority;
  } catch (error) {
    try {
      await repository.failOperation(resolvedPool, {
        organizationId: request.organizationId,
        operationId: claim.operation.id,
        leaseOwner,
        retryable: true,
        safeErrorCode: error.code === 'CANONICAL_BUSINESS_PROFILE_REQUIRED'
          ? 'canonical_business_profile_required' : 'profile_authority_unavailable',
      });
    } catch (_failureError) {
      // The response remains fail-closed even if failure-state persistence is unavailable.
    }
    return safeError(503,
      error.code === 'CANONICAL_BUSINESS_PROFILE_REQUIRED'
        ? 'CANONICAL_BUSINESS_PROFILE_REQUIRED' : 'CANONICAL_PERSISTENCE_UNAVAILABLE',
      error.code === 'CANONICAL_BUSINESS_PROFILE_REQUIRED'
        ? 'An active organization Business Profile is required.' : 'Canonical PostgreSQL persistence is unavailable.');
  }

  let result;
  try {
    result = await repository.withTransaction(resolvedPool, function (client) {
      return insertGraph(client, claim.operation, leaseOwner, request, options || {});
    });
  } catch (error) {
    try {
      await repository.failOperation(resolvedPool, {
        organizationId: request.organizationId,
        operationId: claim.operation.id,
        leaseOwner,
        retryable: error.retryable !== false,
        safeErrorCode: error.safeCode || (error.code === 'INVALID_CANONICAL_INPUT' ? 'invalid_canonical_input' : 'graph_creation_failed'),
      });
    } catch (failureError) {
      return safeError(503, 'CANONICAL_PERSISTENCE_UNAVAILABLE', 'Canonical PostgreSQL persistence is unavailable.');
    }
    return safeError(error.code === 'CANONICAL_CUSTOMER_IDENTITY_CONFLICT' ? 409 : (error.retryable === false ? 422 : 503),
      error.code === 'CANONICAL_CUSTOMER_IDENTITY_CONFLICT'
        ? 'CANONICAL_CUSTOMER_IDENTITY_CONFLICT'
        : (error.retryable === false ? 'PERMANENT_GRAPH_FAILURE' : 'RETRYABLE_GRAPH_FAILURE'),
      error.retryable === false ? 'The canonical graph request cannot be completed.' : 'The canonical graph was not created; retry is safe.');
  }

  if (options && options.crashAfterCommitBeforeResponse) {
    const crash = new Error('Injected crash after commit before response');
    crash.code = 'INJECTED_CRASH_AFTER_COMMIT';
    throw crash;
  }
  return result;
}

function ingestSimulation(pool, source, options) {
  return executeCanonicalGraph(pool, { ...source, source: 'simulation' }, options);
}

function ingestDemo(pool, source, options) {
  return executeCanonicalGraph(pool, { ...source, source: 'demo' }, options);
}

function ingestRetell(pool, source, options) {
  return executeCanonicalGraph(pool, { ...source, source: 'retell' }, options);
}

function ingestVoice(pool, source, options) {
  return executeCanonicalGraph(pool, { ...source, source: 'voice' }, options);
}

function ingestLead(pool, source, options) {
  return executeCanonicalGraph(pool, { ...source, source: 'lead' }, options);
}

module.exports = {
  GRAPH_STAGES,
  artifactIds,
  executeCanonicalGraph,
  ingestDemo,
  ingestLead,
  ingestRetell,
  ingestSimulation,
  ingestVoice,
  normalizeRequest,
  normalizeEmail,
  normalizePhone,
  resolveCanonicalCustomer,
};
