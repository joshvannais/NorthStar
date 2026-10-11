'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const repository = require('../../src/customerFinancial/numberingPolicyRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function insertGrant(client, source, options = {}) {
  const grantId = options.grantId || crypto.randomUUID();
  const revision = options.revision || 1;
  await client.query(
    `INSERT INTO canonical_customer_financial_numbering_capability_grants_v1(
      organization_id,id,revision,actor_user_id,membership_id,capability,target_class,
      business_purpose,policy_version,template_version,active,valid_from,expires_at,issued_at)
     VALUES($1,$2,$3,$4,$4,$5,'tenant_document_numbering_policy',
      'customer_financial.document_numbering',
      'mission27.launch.v1','m27.owner.v1',$6,clock_timestamp()-INTERVAL '1 minute',
      clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
    [source.organizationId, grantId, revision, source.actorUserId,
      repository.CAPABILITY, options.active === undefined ? true : options.active]);
  return { grantId, revision };
}

async function authorize(fixture, source, options = {}) {
  const grant = await insertGrant(fixture.ownerPool, source, options);
  return {
    organizationId: source.organizationId,
    actorUserId: source.actorUserId,
    actorAccessRole: source.actorAccessRole,
    authSessionId: source.authSessionId,
    capabilityGrantId: grant.grantId,
    capabilityGrantRevision: grant.revision,
    businessPurpose: repository.BUSINESS_PURPOSE,
    policyVersion: repository.POLICY_VERSION,
    csrfToken: source.csrfToken,
  };
}

function readActor(value) {
  const { csrfToken: _csrfToken, idempotencyKey: _idempotencyKey, ...actor } = value;
  return actor;
}

const mutationActor = (value, idempotencyKey = crypto.randomUUID()) => ({
  ...value, idempotencyKey,
});

async function reviewPolicy(fixture, actor, key = crypto.randomUUID()) {
  const candidate = await repository.candidate(fixture.runtimePool, readActor(actor));
  const result = await repository.review(fixture.runtimePool, mutationActor(actor, key), {
    expectedPolicyDigest: candidate.policyDigest,
    reason: 'Review the exact tenant-global document numbering policy.',
  });
  return { candidate, result, key };
}

async function reserve(pool, organizationId, documentClass, key, request = null) {
  const keyDigest = hash(key);
  const requestDigest = request || hash(`reserve:${documentClass}:${key}`);
  const value = (await pool.query(
    'SELECT public.canonical_customer_financial_numbering_v1_reserve($1,$2,$3,$4) value',
    [organizationId, documentClass, keyDigest, requestDigest])).rows[0].value;
  return { value, keyDigest, requestDigest };
}

async function transition(pool, organizationId, reservation, expectedState, newState, options = {}) {
  const documentId = options.documentId === undefined ? null : options.documentId;
  const documentDigest = options.documentDigest === undefined ? null : options.documentDigest;
  const eventKey = options.eventKey || crypto.randomUUID();
  const eventRequestDigest = hash(options.request ||
    `transition:${reservation.reservationId}:${expectedState}:${newState}:${documentId || ''}`);
  const reasonDigest = hash(options.reason || `Synthetic ${newState} authority decision.`);
  return (await pool.query(
    `SELECT public.canonical_customer_financial_numbering_v1_transition(
      $1,$2,$3,$4,$5,$6,$7,$8,$9) value`,
    [organizationId, reservation.reservationId, expectedState, newState,
      documentId, documentDigest, hash(eventKey), eventRequestDigest, reasonDigest])).rows[0].value;
}

async function waitingOnAdvisory(fixture, pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = (await fixture.ownerPool.query(
      `SELECT EXISTS(SELECT 1 FROM pg_locks
        WHERE pid=$1 AND locktype='advisory' AND NOT granted) waiting`, [pid])).rows[0].waiting;
    if (waiting) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Backend ${pid} did not wait on the document-numbering grant fence`);
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded the deadlock bound`)), 10000);
    })]);
  } finally { clearTimeout(timer); }
}

realPostgres('Mission 27 Part 2C exact money and numbering PostgreSQL authority', () => {
  let fixture;
  let reviewedOwner;

  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('reviews the fixed tenant policy with exact owner authority and idempotency', async () => {
    reviewedOwner = await authorize(fixture, fixture.actors.owner);
    const key = crypto.randomUUID();
    const accepted = await reviewPolicy(fixture, reviewedOwner, key);
    expect(accepted.candidate).toMatchObject({ state: 'review_required', current: true,
      reviewState: 'unreviewed', numberReservationAvailable: false,
      value: { ownerReviewRequired: true } });
    expect(accepted.result).toMatchObject({ status: 201, replayed: false,
      body: { state: 'reviewed_current', current: true, reviewState: 'reviewed',
        numberReservationAvailable: true,
        value: { contract: { currency: { code: 'USD', minorUnitExponent: 2 },
          location: { scope: 'tenant_global', locationId: null }, reuseAllowed: false,
          gapsAllowed: true, yearResetAllowed: false, serverAssigned: true,
          statutorySufficiencyClaimed: false } } } });
    const replay = await repository.review(
      fixture.runtimePool, mutationActor(reviewedOwner, key), {
        expectedPolicyDigest: accepted.candidate.policyDigest,
        reason: 'Review the exact tenant-global document numbering policy.',
      });
    expect(replay).toEqual({ status: 200, replayed: true, body: accepted.result.body });
    expect(await repository.read(fixture.runtimePool, readActor(reviewedOwner)))
      .toEqual(accepted.result.body);
    await expect(repository.review(fixture.runtimePool, mutationActor(reviewedOwner, key), {
      expectedPolicyDigest: accepted.candidate.policyDigest,
      reason: 'Changed reuse must conflict without changing the reviewed policy.',
    })).rejects.toMatchObject({ code: '23505' });
    await expect(repository.candidate(fixture.runtimePool, {
      ...readActor(reviewedOwner), actorAccessRole: 'admin',
    })).rejects.toMatchObject({ code: 'CUSTOMER_FINANCIAL_NUMBERING_POLICY_RESTRICTED' });
    expect((await fixture.ownerPool.query(
      "SELECT filename FROM _migrations WHERE filename LIKE '262\_%' ESCAPE '\\'"
    )).rows.map(row => row.filename)).toEqual([
      '262_customer_financial_exact_money_numbering_v1.sql',
    ]);
  }, 120000);

  test('normalizes cents and zero identically in PostgreSQL while rejecting rounding and FX', async () => {
    const values = await fixture.ownerPool.query(
      `SELECT public.canonical_customer_financial_numbering_v1_exact_money('1097142','USD') cents,
              public.canonical_customer_financial_numbering_v1_exact_money('0','USD') zero,
              public.canonical_customer_financial_numbering_v1_exact_money('-28140','USD') negative`);
    expect(values.rows[0]).toEqual({
      cents: { version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
        minorUnits: '1097142', decimal: '10971.42', exactZero: false },
      zero: { version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
        minorUnits: '0', decimal: '0.00', exactZero: true },
      negative: { version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
        minorUnits: '-28140', decimal: '-281.40', exactZero: false },
    });
    await expect(fixture.ownerPool.query(
      "SELECT public.canonical_customer_financial_numbering_v1_exact_money('100','CAD')"))
      .rejects.toMatchObject({ code: '22023' });
    await expect(fixture.ownerPool.query(
      "SELECT public.canonical_customer_financial_numbering_v1_exact_money('1.5','USD')"))
      .rejects.toMatchObject({ code: '22023' });
  }, 120000);

  test('reserves atomically, never reuses numbers and recovers only the exact request', async () => {
    const invoice1Key = crypto.randomUUID();
    const invoice1 = await reserve(fixture.ownerPool, fixture.org, 'invoice', invoice1Key);
    expect(invoice1.value).toMatchObject({ documentClass: 'invoice', sequence: '1',
      documentNumber: 'INV-0000000001', state: 'reserved', reuseAllowed: false,
      recoveryBoundedToRequest: true });
    const exactReplay = await reserve(fixture.ownerPool, fixture.org, 'invoice',
      'repeat-this-exact-key', hash('repeat-this-exact-request'));
    const exactReplayAgain = await reserve(fixture.ownerPool, fixture.org, 'invoice',
      'repeat-this-exact-key', hash('repeat-this-exact-request'));
    expect(exactReplayAgain.value).toEqual(exactReplay.value);
    await expect(reserve(fixture.ownerPool, fixture.org, 'invoice',
      'repeat-this-exact-key', hash('changed-request'))).rejects.toMatchObject({ code: '23505' });

    const documentId = crypto.randomUUID(); const documentDigest = hash('synthetic invoice body');
    const issuedEventKey = crypto.randomUUID();
    const issuedRequest = `issue:${invoice1.value.reservationId}:${documentId}`;
    const issuedReason = 'Synthetic issued authority decision.';
    const issued = await transition(fixture.ownerPool, fixture.org, invoice1.value,
      'reserved', 'issued', { documentId, documentDigest, eventKey: issuedEventKey,
        request: issuedRequest, reason: issuedReason });
    expect(issued).toMatchObject({ documentNumber: 'INV-0000000001', state: 'issued',
      documentId, documentDigest });
    const voided = await transition(fixture.ownerPool, fixture.org, issued,
      'issued', 'void', { documentId, documentDigest });
    expect(voided).toMatchObject({ documentNumber: 'INV-0000000001', state: 'void',
      documentId, documentDigest });
    const reservationReplayAfterVoid = await reserve(fixture.ownerPool, fixture.org, 'invoice',
      invoice1Key, invoice1.requestDigest);
    expect(reservationReplayAfterVoid.value).toMatchObject({
      documentNumber: 'INV-0000000001', state: 'reserved', documentId: null,
      documentDigest: null,
    });
    const issuedReplayAfterVoid = await transition(fixture.ownerPool, fixture.org, invoice1.value,
      'reserved', 'issued', { documentId, documentDigest, eventKey: issuedEventKey,
        request: issuedRequest, reason: issuedReason });
    expect(issuedReplayAfterVoid).toMatchObject({ documentNumber: 'INV-0000000001',
      state: 'issued', documentId, documentDigest });
    await expect(transition(fixture.ownerPool, fixture.org, exactReplay.value,
      'reserved', 'void', { documentId: crypto.randomUUID(), documentDigest: hash('wrong') }))
      .rejects.toMatchObject({ code: '22023' });
    const reservedVoid = await transition(fixture.ownerPool, fixture.org, exactReplay.value,
      'reserved', 'void');
    expect(reservedVoid).toMatchObject({ documentNumber: 'INV-0000000002', state: 'void',
      documentId: null, documentDigest: null });
    const invoice3 = await reserve(fixture.ownerPool, fixture.org, 'invoice', crypto.randomUUID());
    const credit1 = await reserve(fixture.ownerPool, fixture.org, 'credit', crypto.randomUUID());
    const receipt1 = await reserve(fixture.ownerPool, fixture.org, 'receipt', crypto.randomUUID());
    expect(invoice3.value.documentNumber).toBe('INV-0000000003');
    expect(credit1.value.documentNumber).toBe('CR-0000000001');
    expect(receipt1.value.documentNumber).toBe('RCT-0000000001');
    expect((await fixture.ownerPool.query(
      'SELECT public.canonical_customer_financial_numbering_v1_recover($1,$2) value',
      [fixture.org, invoice1.keyDigest])).rows[0].value)
      .toMatchObject({ available: true, reason: null,
        value: { documentNumber: 'INV-0000000001', state: 'void' } });
    expect((await fixture.ownerPool.query(
      'SELECT public.canonical_customer_financial_numbering_v1_recover($1,$2) value',
      [fixture.org, hash('never-reserved')])).rows[0].value)
      .toEqual({ version: 'm27-document-number-reservation-v1', available: false,
        value: null, reason: 'source_authority_unavailable' });
    expect((await fixture.ownerPool.query(
      'SELECT public.canonical_customer_financial_numbering_v1_recover($1,$2) value',
      [fixture.otherOrg, invoice1.keyDigest])).rows[0].value)
      .toEqual({ version: 'm27-document-number-reservation-v1', available: false,
        value: null, reason: 'source_authority_unavailable' });

    const concurrent = await Promise.all(Array.from({ length: 6 }, () =>
      reserve(fixture.ownerPool, fixture.org, 'invoice', crypto.randomUUID())));
    expect(new Set(concurrent.map(result => result.value.documentNumber)).size).toBe(6);
    const duplicateKey = crypto.randomUUID();
    const duplicate = await Promise.all([
      reserve(fixture.ownerPool, fixture.org, 'receipt', duplicateKey),
      reserve(fixture.ownerPool, fixture.org, 'receipt', duplicateKey),
    ]);
    expect(duplicate[0].value).toEqual(duplicate[1].value);
  }, 120000);

  test('fails closed across tenant, subscription, grant-race, runtime and restart boundaries', async () => {
    await expect(reserve(fixture.ownerPool, fixture.otherOrg, 'invoice', crypto.randomUUID()))
      .rejects.toMatchObject({ code: '55000' });

    const originalStatus = (await fixture.ownerPool.query(
      'SELECT status FROM subscriptions WHERE organization_id=$1', [fixture.org])).rows[0].status;
    const cancellationActor = await authorize(fixture, fixture.actors.owner);
    const cancellationCandidate = await repository.candidate(
      fixture.runtimePool, readActor(cancellationActor));
    const requestsBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customer_financial_numbering_policy_requests_v1'))
      .rows[0].count);
    const cancellation = await fixture.ownerPool.connect();
    try {
      await cancellation.query('BEGIN');
      await cancellation.query("UPDATE subscriptions SET status='canceled' WHERE organization_id=$1",
        [fixture.org]);
      let settled = false;
      const attempt = repository.review(fixture.runtimePool, mutationActor(cancellationActor), {
        expectedPolicyDigest: cancellationCandidate.policyDigest,
        reason: 'Reconfirm numbering only while the entitlement remains current.',
      });
      attempt.then(() => { settled = true; }, () => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(settled).toBe(false);
      await cancellation.query('COMMIT');
      await expect(attempt).rejects.toMatchObject({ code: expect.stringMatching(/^(40001|42501)$/) });
    } finally {
      await cancellation.query('ROLLBACK').catch(() => {}); cancellation.release();
      await fixture.ownerPool.query('UPDATE subscriptions SET status=$2 WHERE organization_id=$1',
        [fixture.org, originalStatus]);
    }
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customer_financial_numbering_policy_requests_v1'))
      .rows[0].count)).toBe(requestsBefore);

    const staleActor = await authorize(fixture, fixture.actors.owner);
    const staleCandidate = await repository.candidate(fixture.runtimePool, readActor(staleActor));
    const grantRaceRequestsBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customer_financial_numbering_policy_requests_v1'))
      .rows[0].count);
    const lockKey = `${fixture.org}:numbering-capability-grant:${staleActor.capabilityGrantId}`;
    const blocker = await fixture.ownerPool.connect();
    const issuer = await fixture.ownerPool.connect();
    const supersededEffectClient = await fixture.runtimePool.connect();
    let supersession; let rejectedEffect; let effectStarted = false;
    try {
      const issuerPid = (await issuer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const effectPid = (await supersededEffectClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
      supersession = (async () => {
        await issuer.query('BEGIN');
        try {
          await insertGrant(issuer, fixture.actors.owner,
            { grantId: staleActor.capabilityGrantId, revision: 2 });
          await issuer.query('COMMIT');
        } catch (error) { await issuer.query('ROLLBACK').catch(() => {}); throw error; }
      })();
      await waitingOnAdvisory(fixture, issuerPid);
      effectStarted = true;
      rejectedEffect = repository.review({ connect: async () => supersededEffectClient },
        mutationActor(staleActor), {
          expectedPolicyDigest: staleCandidate.policyDigest,
          reason: 'Reject review if the exact capability revision is superseded.',
        });
      await waitingOnAdvisory(fixture, effectPid);
      await blocker.query('COMMIT');
      await bounded(supersession, 'numbering grant supersession');
      await expect(bounded(rejectedEffect, 'superseded numbering review'))
        .rejects.toMatchObject({ code: expect.stringMatching(/^(40001|42501)$/) });
    } finally {
      await blocker.query('ROLLBACK').catch(() => {}); blocker.release();
      await issuer.query('ROLLBACK').catch(() => {}); issuer.release();
      if (!effectStarted) supersededEffectClient.release();
      if (supersession) await supersession.catch(() => {});
      if (rejectedEffect) await rejectedEffect.catch(() => {});
    }
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customer_financial_numbering_policy_requests_v1'))
      .rows[0].count)).toBe(grantRaceRequestsBefore);

    const effectActor = await authorize(fixture, fixture.actors.owner);
    const effectCandidate = await repository.candidate(fixture.runtimePool, readActor(effectActor));
    const effectLockKey = `${fixture.org}:numbering-capability-grant:${effectActor.capabilityGrantId}`;
    const effectBlocker = await fixture.ownerPool.connect();
    const authorizedEffectClient = await fixture.runtimePool.connect();
    const delayedIssuer = await fixture.ownerPool.connect();
    let authorizedEffect; let delayedSupersession;
    try {
      const effectPid = (await authorizedEffectClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const issuerPid = (await delayedIssuer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await effectBlocker.query('BEGIN');
      await effectBlocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [effectLockKey]);
      authorizedEffect = repository.review({ connect: async () => authorizedEffectClient },
        mutationActor(effectActor), {
          expectedPolicyDigest: effectCandidate.policyDigest,
          reason: 'Allow this exact review to win before capability supersession.',
        });
      await waitingOnAdvisory(fixture, effectPid);
      delayedSupersession = (async () => {
        await delayedIssuer.query('BEGIN');
        try {
          await insertGrant(delayedIssuer, fixture.actors.owner,
            { grantId: effectActor.capabilityGrantId, revision: 2 });
          await delayedIssuer.query('COMMIT');
        } catch (error) { await delayedIssuer.query('ROLLBACK').catch(() => {}); throw error; }
      })();
      await waitingOnAdvisory(fixture, issuerPid);
      await effectBlocker.query('COMMIT');
      expect(await bounded(authorizedEffect, 'authorized numbering review'))
        .toMatchObject({ status: 200, replayed: false,
          body: { state: 'reviewed_current', numberReservationAvailable: true } });
      await bounded(delayedSupersession, 'delayed numbering grant supersession');
    } finally {
      await effectBlocker.query('ROLLBACK').catch(() => {}); effectBlocker.release();
      await delayedIssuer.query('ROLLBACK').catch(() => {}); delayedIssuer.release();
      if (authorizedEffect) await authorizedEffect.catch(() => {});
      if (delayedSupersession) await delayedSupersession.catch(() => {});
    }
    expect(await repository.read(fixture.runtimePool, readActor({
      ...effectActor, capabilityGrantRevision: 2,
    }))).toMatchObject({ state: 'reviewed_current', numberReservationAvailable: true });

    const rollbackActor = await authorize(fixture, fixture.actors.owner);
    const rollbackCandidate = await repository.candidate(
      fixture.runtimePool, readActor(rollbackActor));
    const rolledBackIssuer = await fixture.ownerPool.connect();
    const rollbackEffectClient = await fixture.runtimePool.connect();
    let rollbackEffect;
    try {
      await rolledBackIssuer.query('BEGIN');
      await insertGrant(rolledBackIssuer, fixture.actors.owner,
        { grantId: rollbackActor.capabilityGrantId, revision: 2 });
      const effectPid = (await rollbackEffectClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      rollbackEffect = repository.review({ connect: async () => rollbackEffectClient },
        mutationActor(rollbackActor), {
          expectedPolicyDigest: rollbackCandidate.policyDigest,
          reason: 'Continue only after a rolled-back supersession leaves revision one current.',
        });
      await waitingOnAdvisory(fixture, effectPid);
      await rolledBackIssuer.query('ROLLBACK');
      expect(await bounded(rollbackEffect, 'numbering review after rolled-back supersession'))
        .toMatchObject({ status: 200, replayed: false,
          body: { state: 'reviewed_current', numberReservationAvailable: true } });
    } finally {
      await rolledBackIssuer.query('ROLLBACK').catch(() => {}); rolledBackIssuer.release();
      if (rollbackEffect) await rollbackEffect.catch(() => {});
    }
    expect((await fixture.ownerPool.query(
      `SELECT latest_revision FROM canonical_customer_financial_numbering_capability_heads_v1
       WHERE organization_id=$1 AND capability_grant_id=$2`,
      [fixture.org, rollbackActor.capabilityGrantId])).rows[0].latest_revision).toBe('1');
    expect((await fixture.ownerPool.query(
      `SELECT count(*)::int count FROM canonical_customer_financial_numbering_capability_grants_v1
       WHERE organization_id=$1 AND id=$2 AND revision=2`,
      [fixture.org, rollbackActor.capabilityGrantId])).rows[0].count).toBe(0);

    for (const table of [
      'canonical_customer_financial_numbering_policies_v1',
      'canonical_customer_financial_numbering_sequences_v1',
      'canonical_customer_financial_numbering_reservations_v1',
      'canonical_customer_financial_numbering_events_v1',
    ]) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
        expect((await fixture.ownerPool.query(
          'SELECT has_table_privilege($1,$2,$3) allowed',
          [fixture.roles.runtime, table, privilege])).rows[0].allowed).toBe(false);
      }
    }
    expect((await fixture.ownerPool.query(
      "SELECT has_function_privilege($1,'public.canonical_customer_financial_numbering_v1_reserve(uuid,text,text,text)','EXECUTE') allowed",
      [fixture.roles.runtime])).rows[0].allowed).toBe(false);
    expect((await fixture.ownerPool.query(
      "SELECT has_function_privilege($1,'public.canonical_customer_financial_numbering_v1_review(uuid,uuid,text,uuid,uuid,bigint,text,text,text,text,text,text)','EXECUTE') allowed",
      [fixture.roles.runtime])).rows[0].allowed).toBe(true);
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_customer_financial_numbering_policies_v1 SET reviewed_at=reviewed_at'))
      .rejects.toMatchObject({ code: '55000' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_customer_financial_numbering_policy_requests_v1 SET created_at=created_at'))
      .rejects.toMatchObject({ code: '55000' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_customer_financial_numbering_reservations_v1 SET reserved_at=reserved_at'))
      .rejects.toMatchObject({ code: '55000' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_customer_financial_numbering_events_v1 SET occurred_at=occurred_at'))
      .rejects.toMatchObject({ code: '55000' });
    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    expect(fixture.db.readiness()).toEqual({ ready: true, failure: null });
    expect(await repository.read(fixture.runtimePool, readActor(reviewedOwner)))
      .toMatchObject({ state: 'reviewed_current', numberReservationAvailable: true });
  }, 120000);
});
