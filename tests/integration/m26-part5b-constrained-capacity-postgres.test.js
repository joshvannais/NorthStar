'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastConstrainedCapacityRouter } = require('../../src/routes/forecastConstrainedCapacity');
const { createForecastWorkloadCapacityRouter } = require('../../src/routes/forecastWorkloadCapacity');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const TARGET = 'capacity.available_role_hours.v1';

realPostgres('Mission 26 Part 5B constrained role-capacity lifecycle', () => {
  let fixture;
  let app;
  let endpoint;
  let logicalNow;

  const actor = name => fixture.actors[name];
  const setClock = async value => {
    logicalNow = new Date(value);
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [logicalNow]);
  };
  const advance = async seconds => setClock(new Date(logicalNow.getTime() + seconds * 1000));
  const post = (path, body, key = `m26-p5b-${uuid()}`, name = 'owner') => request(app)
    .post(endpoint + path).set('X-Test-Actor', name).set('X-CSRF-Token', actor(name).csrfToken)
    .set('Idempotency-Key', key).send(body);
  const get = (path, name = 'owner') => request(app).get(endpoint + path).set('X-Test-Actor', name);
  const waitForBackendLock = async backendPid => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if ((await fixture.ownerPool.query(
        'SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted LIMIT 1', [backendPid])).rowCount === 1) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Expected PostgreSQL lock wait for backend ${backendPid}`);
  };
  const waitForRelationWaiters = async (relation, count) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const waiting = Number((await fixture.ownerPool.query(
        `SELECT count(*) count FROM pg_locks
          WHERE relation=$1::regclass AND NOT granted`, [relation])).rows[0].count);
      if (waiting >= count) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Expected ${count} PostgreSQL lock waiter(s) for ${relation}`);
  };

  async function approveWorkProfile(name) {
    const member = actor(name); const reviewer = actor('owner');
    let current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
    expect(current.status).toBe(200);
    const submitted = await request(fixture.app).post('/api/work-profiles/me')
      .set(member.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'submit', expectedRevision: current.body.data.profile.revision,
        profile: { title: 'Service technician', summary: 'Mounted Part5B source chronology.',
          skills: ['Fixture repair'], certifications: [{ id: 'safety', name: 'Safety training',
            issuer: 'Example Training', expiresOn: '2099-09-09', documentReference: 'P5B-SAFETY' }] },
      });
    expect(submitted.status).toBe(200);
    current = await request(fixture.app).get('/api/work-profiles/me').set(member.session.headers);
    const approved = await request(fixture.app).post(`/api/work-profiles/reviews/${member.actorUserId}`)
      .set(reviewer.session.headers).set('Idempotency-Key', uuid()).send({
        action: 'approve', expectedRevision: current.body.data.profile.revision,
        reason: 'Owner reviewed the mounted operational profile.', verifiedCertificationIds: ['safety'],
      });
    expect(approved.status).toBe(200);
  }

  async function declareAvailability(profileId, start, end, intervals) {
    const response = await request(fixture.app).put(`/api/v1/canonical/availability/profiles/${profileId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5b-availability-${uuid()}`)
      .send({ expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC',
        coverageStart: start.toISOString(), coverageEnd: end.toISOString(), intervals,
        reason: 'Owner declared the exact bounded future availability used by Part5B.' });
    expect(response.status).toBe(200);
  }

  async function replaceAvailability(profileId, start, end, intervals) {
    const current = (await fixture.ownerPool.query(
      `SELECT revision.revision,rtrim(revision.canonical_digest) digest
         FROM canonical_workforce_availability_authorities authority
         JOIN LATERAL (SELECT value.* FROM canonical_workforce_availability_revisions value
           WHERE value.organization_id=authority.organization_id
            AND value.availability_id=authority.id ORDER BY value.revision DESC LIMIT 1) revision ON TRUE
        WHERE authority.organization_id=$1 AND authority.workforce_profile_id=$2`,
      [fixture.org, profileId])).rows[0];
    const response = await request(fixture.app).put(`/api/v1/canonical/availability/profiles/${profileId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5b-availability-${uuid()}`)
      .send({ expectedRevision: Number(current.revision), expectedDigest: current.digest,
        expectedTimeZone: 'UTC', coverageStart: start.toISOString(), coverageEnd: end.toISOString(), intervals,
        reason: 'Owner revised the exact bounded availability for authenticated complete-zero evidence.' });
    expect(response.status).toBe(200);
  }

  async function p5aPost(path, body, key = `m26-p5b-p5a-${uuid()}`) {
    return request(app).post('/api/v1/forecast/workload-capacity' + path)
      .set('X-Test-Actor', 'owner').set('X-CSRF-Token', actor('owner').csrfToken)
      .set('Idempotency-Key', key).send(body);
  }

  async function p5aReview(body, token = null) {
    const response = await p5aPost('/reviews', {
      kind: body.kind, target: TARGET, subjectId: body.subjectId ?? null, role: body.role ?? null,
      action: 'approve', expectedRevision: token?.expectedRevision ?? 0,
      expectedDigest: token?.expectedDigest ?? 'none', remainingPersonMinutes: null,
      reason: 'Owner explicitly reviewed this installed-source capacity basis.', confirmed: true,
      confirmationVersion: 'm26-workload-capacity-review-v1',
    });
    if (response.status !== 201) throw new Error(`Part5A review failed: ${JSON.stringify(response.body)}`);
  }

  async function refreshP5aReview(kind, subjectId = null, role = null) {
    const token = (await request(app).get('/api/v1/forecast/workload-capacity/reviews/current')
      .set('X-Test-Actor', 'owner').query({ kind, target: TARGET,
        subjectId: subjectId || 'none', role: kind === 'capacity_role_scope' ? 'none' : (role || 'none') })).body.data;
    if (token.sourceCurrent) return token;
    await p5aReview({ kind, subjectId, role: token.role ?? role }, token);
    return token;
  }

  async function p5aUnschedule(work) {
    const current = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, work.assignment.id])).rows[0];
    const response = await p5aPost(`/backlog-items/${work.appointment}/unschedule`, {
      expectedRevision: Number(current.revision), expectedDigest: current.digest,
      reason: 'Return this approved work to the explicit unscheduled queue without consuming capacity.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-unschedule-v1',
    });
    if (response.status !== 201) throw new Error(`Part5A unschedule failed: ${JSON.stringify(response.body)}`);
    return response.body.data;
  }

  async function createApprovedWork({ start, locationId, label }) {
    const created = await request(fixture.app).post('/api/leads')
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5b-lead-${uuid()}`)
      .send({ customerName: label, serviceKey: 'plumbing', summary: 'Mounted constrained-capacity work.',
        scope: { locationId } });
    expect(created.status).toBe(201);
    const appointment = created.body.ids.appointment;
    const opportunity = created.body.ids.opportunity;
    const scheduledStart = new Date(start);
    const scheduledEnd = new Date(scheduledStart.getTime() + 3600000);
    for (const action of ['assign', 'schedule', 'dispatch']) {
      const before = (await fixture.ownerPool.query(
        `SELECT revision,rtrim(canonical_digest) digest,appointment_status
           FROM canonical_schedule_assignments
          WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, appointment])).rows[0];
      const preview = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
        .set(actor('owner').session.headers).send({
          expectedRevision: Number(before.revision), expectedDigest: before.digest, expectedTimeZone: 'UTC',
          action, target: { kind: 'profile', id: actor('member').actorUserId },
          scheduledStart: action === 'assign' ? null : scheduledStart.toISOString(),
          scheduledEnd: action === 'assign' ? null : scheduledEnd.toISOString(),
          appointmentStatus: before.appointment_status,
          reason: 'Explicit mounted constrained-capacity scheduling decision',
        });
      if (preview.status !== 201) throw new Error(
        `Scheduling ${action} preview failed: ${JSON.stringify(preview.body)}`);
      const approval = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5b-schedule-${uuid()}`)
        .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
          reason: 'Explicit mounted constrained-capacity scheduling decision' });
      expect(approval.status).toBe(200);
    }
    const assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, appointment])).rows[0];
    return { appointment, opportunity, assignment };
  }

  async function p5bReview(kind, scopeKey, subjectId, definition, token = null, action = 'approve') {
    const current = token || (await get(`/reviews/current?kind=${kind}&scopeKey=${scopeKey || 'none'}&subjectId=${subjectId || 'none'}`)).body.data;
    const response = await post('/reviews', { kind, scopeKey, subjectId, action,
      expectedRevision: current.expectedRevision, expectedDigest: current.expectedDigest, definition,
      reason: 'Owner explicitly reviewed the exact seven-dimension research authority.', confirmed: true,
      confirmationVersion: 'm26-constrained-capacity-review-v1' });
    if (response.status !== 201) {
      const valid = (await fixture.ownerPool.query(
        'SELECT canonical_forecast_constrained_capacity_v1_definition_valid($1,$2) valid',
        [kind, definition])).rows[0].valid;
      const intervalChecks = definition.assetCalendars ? await Promise.all(definition.assetCalendars.flatMap(calendar => [
        fixture.ownerPool.query('SELECT canonical_forecast_constrained_capacity_v1_intervals($1) valid',
          [JSON.stringify(calendar.availableIntervals)]),
        fixture.ownerPool.query('SELECT canonical_forecast_constrained_capacity_v1_intervals($1) valid',
          [JSON.stringify(calendar.committedIntervals)]),
      ])) : [];
      const duplicateChecks = definition.travelPairs ? (await fixture.ownerPool.query(
        `SELECT EXISTS(SELECT 1 FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY left_rows(left_item,left_index)
          JOIN jsonb_array_elements($1::jsonb) WITH ORDINALITY right_rows(right_item,right_index)
           ON left_index<right_index
          WHERE left_item->>'fromLocationKey'=right_item->>'fromLocationKey'
           AND left_item->>'toLocationKey'=right_item->>'toLocationKey') travel,
         EXISTS(SELECT 1 FROM jsonb_array_elements($2::jsonb) AS entries(item)
          GROUP BY item->>'role' HAVING count(*)>1) crew`,
         [JSON.stringify(definition.travelPairs), JSON.stringify(definition.crewRoleRequirements)])).rows[0] : {};
      throw new Error(`Part5B ${kind} review failed: ${JSON.stringify(response.body)} valid=${valid} intervalChecks=${JSON.stringify(intervalChecks.map(result => result.rows[0].valid))} duplicateChecks=${JSON.stringify(duplicateChecks)} definition=${JSON.stringify(definition)}`);
    }
    return response.body.data;
  }

  async function p5bEpoch() {
    const response = await post('/epochs', { reason: 'Begin exact prospective constrained-capacity coverage.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-epoch-v1' });
    expect(response.status).toBe(201);
    return response.body.data;
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    endpoint = '/api/v1/forecast/constrained-capacity';
    app = express(); app.use(express.json());
    const bypass = (_req, _res, next) => next();
    const auth = (req, _res, next) => {
      const selected = actor(req.get('X-Test-Actor') || 'owner');
      req.user = { id: selected.actorUserId }; req.orgId = selected.organizationId;
      req.tenantContext = { organizationId: selected.organizationId, userId: selected.actorUserId };
      req.userRole = selected.actorAccessRole; req.authSession = { id: selected.authSessionId }; next();
    };
    app.use(endpoint, createForecastConstrainedCapacityRouter({ auth, throttle: bypass,
      writeThrottle: bypass, poolProvider: () => fixture.runtimePool }));
    app.use('/api/v1/forecast/workload-capacity', createForecastWorkloadCapacityRouter({ auth,
      throttle: bypass, writeThrottle: bypass, poolProvider: () => fixture.runtimePool }));
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 60000);

  test('guarded seven-dimension origin, later outcome and evaluation preserve role-worker-hour supply', async () => {
    const start = new Date((await fixture.ownerPool.query("SELECT date_trunc('second',clock_timestamp()) - interval '120 seconds' value")).rows[0].value);
    await setClock(start);
    await approveWorkProfile('dispatcher');
    await approveWorkProfile('member');

    const skill = await request(fixture.app).post('/api/workforce/skills')
      .set(actor('owner').session.headers).send({ key: 'fixture-repair', name: 'Fixture repair',
        description: 'Mounted internal skill declaration.', serviceId: 'plumbing' });
    expect(skill.status).toBe(201);
    const profile = await request(fixture.app).put(`/api/workforce/profiles/${actor('member').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'technician',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] });
    expect(profile.status).toBe(200);
    const crew = await request(fixture.app).post('/api/workforce/crews')
      .set(actor('owner').session.headers).send({ key: 'fixture-crew', name: 'Fixture crew',
        homeLocationId: 'headquarters', members: [{ profileId: actor('member').actorUserId, role: 'lead' }] });
    expect(crew.status).toBe(201);

    const assetBody = (category, name, reference) => ({ category, name, internalReference: reference,
      manufacturer: 'Example', model: `${category}-one`, modelYear: 2026,
      configuration: 'Mounted source-owned configuration', serialNumber: `${reference}-SERIAL`, vin: null,
      homeLocationId: 'headquarters', serviceIds: ['plumbing'] });
    const vehicle = await request(fixture.app).post('/api/assets').set(actor('owner').session.headers)
      .send(assetBody('vehicle', 'Fixture van', 'P5B-VAN'));
    const equipment = await request(fixture.app).post('/api/assets').set(actor('owner').session.headers)
      .send(assetBody('equipment', 'Fixture machine', 'P5B-MACHINE'));
    expect(vehicle.status).toBe(201); expect(equipment.status).toBe(201);
    for (const asset of [vehicle.body.data, equipment.body.data]) {
      if (asset.catalogueState !== 'active') {
        const activated = await request(fixture.app).patch(`/api/assets/${asset.id}/catalogue-state`)
          .set(actor('owner').session.headers).send({ version: asset.version, catalogueState: 'active' });
        expect(activated.status).toBe(200);
      }
    }
    const updateVehicleConfiguration = async configuration => {
      const row = (await fixture.ownerPool.query(
        'SELECT version FROM tenant_assets WHERE organization_id=$1 AND id=$2',
        [fixture.org, vehicle.body.data.id])).rows[0];
      const changed = await request(fixture.app).put(`/api/assets/${vehicle.body.data.id}`)
        .set(actor('owner').session.headers).send({
          ...assetBody('vehicle', 'Fixture van', 'P5B-VAN'), version: Number(row.version), configuration,
        });
      if (changed.status !== 200) {
        throw new Error(`Vehicle configuration update failed: ${JSON.stringify(changed.body)}`);
      }
      return changed.body.data;
    };

    const horizonEnd = new Date(start.getTime() + 30 * 86400000);
    const intervals = Array.from({ length: 10 }, (_, index) => ({ kind: 'available',
      start: new Date(start.getTime() + index * 86400000 + 9 * 3600000).toISOString(),
      end: new Date(start.getTime() + index * 86400000 + 19 * 3600000).toISOString() }));
    await declareAvailability(actor('member').actorUserId, start,
      new Date(horizonEnd.getTime() + 86400000), intervals);
    await advance(1);
    const epoch = await p5aPost('/epochs', { reason: 'Begin mounted prospective Part5A source coverage.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' });
    expect(epoch.status).toBe(201);
    await advance(1);
    for (const [name, role] of [['owner', 'owner'], ['admin', 'administrator'], ['dispatcher', 'dispatcher'],
      ['member', 'technician'], ['viewer', 'employee']]) await p5aReview({ kind: 'role_qualification',
        subjectId: actor(name).actorUserId, role });
    await p5aReview({ kind: 'availability_basis', subjectId: actor('member').actorUserId });
    await p5aReview({ kind: 'capacity_role_scope', role: 'technician' });

    await advance(1); await p5bEpoch(); await advance(1);
    const methodDefinition = { methodVersion: 'm26-constrained-declared-role-supply-v1' };
    await p5bReview('method', null, null, methodDefinition);
    const reviewCountBeforeMalformedSql = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const malformedSql = await fixture.runtimePool.connect();
    try {
      await malformedSql.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await expect(malformedSql.query(
        `SELECT canonical_forecast_constrained_capacity_v1_review_mutate(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-null-digest-${uuid()}`,
          'method', null, null, 'approve', 1, null, methodDefinition,
          'Refuse a malformed privileged review token at the SQL boundary.',
          'm26-constrained-capacity-review-v1'])).rejects.toMatchObject({ code: '22023' });
      await malformedSql.query('ROLLBACK');
    } finally { await malformedSql.query('ROLLBACK').catch(() => {}); malformedSql.release(); }
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(reviewCountBeforeMalformedSql);
    const scopeKey = 'fixture-technician-supply';
    const assetCalendar = assetId => ({ assetId, availableIntervals: [{ start: logicalNow.toISOString(),
      end: new Date(logicalNow.getTime() + 32 * 86400000).toISOString() }], committedIntervals: [] });
    const scopeDefinition = { scopeKey, role: 'technician', applicability: { crew: true, skill: true,
      workingHours: true, location: true, travel: true, vehicle: true, equipment: true },
      crewIds: [crew.body.data.id], crewRoleRequirements: [{ role: 'technician', count: 1 }],
      skillIds: [skill.body.data.id], locationKey: 'site-one',
      travelPairs: [{ fromLocationKey: 'headquarters', toLocationKey: 'site-one', durationMinutes: 30, basis: 'estimated' },
        { fromLocationKey: 'site-one', toLocationKey: 'headquarters', durationMinutes: 30, basis: 'estimated' }],
      vehicleAssetIds: [vehicle.body.data.id], equipmentAssetIds: [equipment.body.data.id],
      operatorProfileIds: [actor('member').actorUserId],
      assetCalendars: [assetCalendar(vehicle.body.data.id), assetCalendar(equipment.body.data.id)] };
    const scopeReviewCountBeforeDuplicateEvidence = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const emptyScopeToken = (await get(
      `/reviews/current?kind=scope&scopeKey=${scopeKey}&subjectId=none`)).body.data;
    for (const invalidDefinition of [
      { ...scopeDefinition, travelPairs: [scopeDefinition.travelPairs[0],
        scopeDefinition.travelPairs[0], scopeDefinition.travelPairs[1]] },
      { ...scopeDefinition, assetCalendars: [{ ...scopeDefinition.assetCalendars[0],
        availableIntervals: [scopeDefinition.assetCalendars[0].availableIntervals[0],
          scopeDefinition.assetCalendars[0].availableIntervals[0]] }, scopeDefinition.assetCalendars[1]] },
    ]) expect((await post('/reviews', { kind: 'scope', scopeKey, subjectId: null, action: 'approve',
        expectedRevision: emptyScopeToken.expectedRevision, expectedDigest: emptyScopeToken.expectedDigest,
        definition: invalidDefinition, reason: 'Refuse duplicated route or asset interval evidence without a receipt.',
        confirmed: true, confirmationVersion: 'm26-constrained-capacity-review-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(scopeReviewCountBeforeDuplicateEvidence);
    await p5bReview('scope', scopeKey, null, scopeDefinition);

    const packageReview = async (definition, jobs) => {
      await advance(1); await p5bEpoch(); await advance(1);
      const entries = [['method', null, methodDefinition], ['scope', null, definition],
        ...jobs.map(job => ['job', job.appointmentId, job.definition])];
      for (const [kind, subject, reviewedDefinition] of entries) {
        const token = (await get(`/reviews/current?kind=${kind}&scopeKey=${kind === 'method' ? 'none' : scopeKey}&subjectId=${subject || 'none'}`)).body.data;
        await p5bReview(kind, kind === 'method' ? null : scopeKey, subject, reviewedDefinition, token);
      }
    };
    const privateResults = async originId => (await fixture.ownerPool.query(
      'SELECT private_results FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1 AND id=$2',
      [fixture.org, originId])).rows[0].private_results;

    const freeInput = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_constrained_capacity_v1_complete_input($1,$2) value', [fixture.org, logicalNow])).rows[0].value;
    const baseCapacity = (await fixture.ownerPool.query(
      "SELECT canonical_forecast_workload_capacity_v1_capacity_calculation($1,$2,$3,$2,'technician') value",
      [fixture.org, logicalNow, new Date(logicalNow.getTime() + 30 * 86400000)])).rows[0].value;
    if (!baseCapacity.classificationComplete || !baseCapacity.availabilityComplete || baseCapacity.overlap) {
      throw new Error(`Mounted base capacity incomplete: ${JSON.stringify(baseCapacity)}`);
    }
    const freeResult = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_constrained_capacity_v1_results($1,$2,$3,$2,$4) value',
      [fixture.org, logicalNow, new Date(logicalNow.getTime() + 30 * 86400000), freeInput])).rows[0].value;
    expect(Number(freeResult[0].personMinutes)).toBe(6000);

    const firstKey = `m26-p5b-first-origin-${uuid()}`;
    const firstBody = { reason: 'Save the exact declared seven-dimension compatible role supply.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' };
    await fixture.ownerPool.query('DELETE FROM canonical_forecast_workload_capacity_test_clock_v1');
    const productionClockBefore = new Date((await fixture.ownerPool.query('SELECT clock_timestamp() value')).rows[0].value);
    const firstOrigin = await post('/origins', firstBody, firstKey);
    const productionClockAfter = new Date((await fixture.ownerPool.query('SELECT clock_timestamp() value')).rows[0].value);
    expect(firstOrigin.status).toBe(201);
    const productionCutoff = new Date(firstOrigin.body.data.predictionCutoffAt);
    expect(productionCutoff.getTime()).toBeGreaterThanOrEqual(productionClockBefore.getTime());
    expect(productionCutoff.getTime()).toBeLessThanOrEqual(productionClockAfter.getTime());
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_workload_capacity_test_clock_v1')).rows[0].count)).toBe(0);
    await setClock(productionCutoff);
    await advance(1); await p5bEpoch();
    expect((await get(`/origins/${firstOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    expect((await post('/origins', firstBody, firstKey)).status).toBe(409);
    await packageReview(scopeDefinition, []);
    const recoveredAfterEpoch = await post('/origins', {
      reason: 'Save a new future origin after explicit reviews under the newer no-mutation epoch.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(recoveredAfterEpoch.status).toBe(201);

    await advance(1);
    const unscheduledWork = await createApprovedWork({ locationId: 'site-one', label: 'Unscheduled supply proof',
      start: new Date(logicalNow.getTime() + 86400000 + 10 * 3600000).toISOString() });
    await p5aUnschedule(unscheduledWork);
    await advance(1);
    const unscheduledJobDefinition = { scopeKey, appointmentId: unscheduledWork.appointment,
      assignmentId: unscheduledWork.assignment.id,
      crewApplicable: true, skillApplicable: true, workingHoursApplicable: true, locationApplicable: true,
      travelApplicable: true, vehicleApplicable: true, equipmentApplicable: true,
      locationKey: 'site-one', previousLocationKey: 'headquarters', nextLocationKey: 'headquarters',
      vehicleAssetIds: [vehicle.body.data.id], equipmentAssetIds: [equipment.body.data.id],
      equipmentBasis: { kind: 'part5b_owner_reviewed', receiptId: null, digest: null },
      readinessBasis: { kind: 'part5b_owner_reviewed', receiptId: null, digest: null },
      travelBasis: { kind: 'part5b_owner_reviewed', receiptId: null, digest: null } };
    const stale = await get(`/origins/${recoveredAfterEpoch.body.data.id}`);
    if (stale.status !== 200) {
      let detail;
      try {
        detail = (await fixture.ownerPool.query(
          'SELECT canonical_forecast_constrained_capacity_v1_origin_read($1,$2,$3,$4,$5) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, firstOrigin.body.data.id])).rows[0].value;
      } catch (error) { detail = { error: error.message, code: error.code }; }
      throw new Error(`Part5B stale read failed: ${JSON.stringify({ body: stale.body, detail })}`);
    }
    expect(stale.body.data.state).toBe('constrained_capacity_origin_stale');

    const unscheduledScopeDefinition = { ...scopeDefinition,
      assetCalendars: [assetCalendar(vehicle.body.data.id), assetCalendar(equipment.body.data.id)] };
    const jobReviewCountBeforeUnsupportedAdoption = Number((await fixture.ownerPool.query(
      "SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1 AND review_kind='job'",
      [fixture.org])).rows[0].count);
    const unsupportedAdoption = { ...unscheduledJobDefinition,
      equipmentBasis: { kind: 'm24_adopted', receiptId: uuid(), digest: 'a'.repeat(64) } };
    const unsupportedToken = (await get(`/reviews/current?kind=job&scopeKey=${scopeKey}&subjectId=${unscheduledWork.appointment}`)).body.data;
    expect((await post('/reviews', { kind: 'job', scopeKey, subjectId: unscheduledWork.appointment,
      action: 'approve', expectedRevision: unsupportedToken.expectedRevision,
      expectedDigest: unsupportedToken.expectedDigest, definition: unsupportedAdoption,
      reason: 'Refuse a claimed Mission24 adoption without its exact current owning receipt.', confirmed: true,
      confirmationVersion: 'm26-constrained-capacity-review-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      "SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1 AND review_kind='job'",
      [fixture.org])).rows[0].count)).toBe(jobReviewCountBeforeUnsupportedAdoption);
    await packageReview(unscheduledScopeDefinition, []);
    const missingJobCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const missingJob = await post('/origins', {
      reason: 'Refuse the complete approved-work population until every job has exact reviewed constraints.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(missingJob.status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(missingJobCount);
    await packageReview(unscheduledScopeDefinition, [{ appointmentId: unscheduledWork.appointment,
      definition: unscheduledJobDefinition }]);
    const unscheduledOrigin = await post('/origins', {
      reason: 'Prove approved unscheduled noncommitment work does not consume role supply.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    if (unscheduledOrigin.status !== 201) {
      let detail; const diagnostic = await fixture.ownerPool.connect();
      try {
        await diagnostic.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        detail = (await diagnostic.query(
          'SELECT canonical_forecast_constrained_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-diagnostic-${uuid()}`,
            'Diagnose unscheduled supply.', 'm26-constrained-capacity-origin-v1'])).rows[0].value;
      } catch (error) { detail = { code: error.code, message: error.message }; }
      finally { await diagnostic.query('ROLLBACK').catch(() => {}); diagnostic.release(); }
      throw new Error(`Unscheduled origin failed: ${JSON.stringify({ body: unscheduledOrigin.body, detail })}`);
    }
    expect(unscheduledOrigin.status).toBe(201);
    const unscheduledPrivate = await privateResults(unscheduledOrigin.body.data.id);
    expect(Number(unscheduledPrivate[0].personMinutes)).toBe(6000);
    expect(Number(unscheduledPrivate[0].travelPersonMinutes)).toBe(0);
    const sourceRaceBlocker = await fixture.ownerPool.connect();
    const beforeBlockedOrigin = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    let guardedUpdate; let blockedCapture; let captureResolved = false;
    try {
      await sourceRaceBlocker.query('BEGIN');
      await sourceRaceBlocker.query(
        'LOCK TABLE canonical_forecast_constrained_capacity_source_events_v1 IN ACCESS EXCLUSIVE MODE');
      guardedUpdate = updateVehicleConfiguration('Same-cutoff guarded source correction').then(value => value);
      await waitForRelationWaiters('canonical_forecast_constrained_capacity_source_events_v1', 1);
      blockedCapture = post('/origins', {
        reason: 'Refuse capture after a queued genuine source writer commits its correction.',
        confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' })
        .then(value => { captureResolved = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(captureResolved).toBe(false);
      await sourceRaceBlocker.query('COMMIT');
      await guardedUpdate;
      const racedScope = (await get(
        `/reviews/current?kind=scope&scopeKey=${scopeKey}&subjectId=none`)).body.data;
      expect(racedScope.sourceCurrent).toBe(false);
      expect((await blockedCapture).status).toBe(409);
    } catch (error) {
      await sourceRaceBlocker.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { sourceRaceBlocker.release(); }
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(beforeBlockedOrigin);
    const sameCutoffStale = await get(`/origins/${unscheduledOrigin.body.data.id}`);
    expect(sameCutoffStale.status).toBe(200);
    expect(sameCutoffStale.body.data.state).toBe('constrained_capacity_origin_stale');

    await advance(1);
    const committedWork = await createApprovedWork({ locationId: 'site-one', label: 'Committed supply proof',
      start: new Date(logicalNow.getTime() + 86400000 + 10 * 3600000).toISOString() });
    const committedJobDefinition = { ...unscheduledJobDefinition, appointmentId: committedWork.appointment,
      assignmentId: committedWork.assignment.id };
    const jobs = [{ appointmentId: unscheduledWork.appointment, definition: unscheduledJobDefinition },
      { appointmentId: committedWork.appointment, definition: committedJobDefinition }];

    const noTravelScopeDefinition = { ...scopeDefinition, travelPairs: scopeDefinition.travelPairs.map(pair => ({
      ...pair, durationMinutes: 0 })),
    assetCalendars: [assetCalendar(vehicle.body.data.id), assetCalendar(equipment.body.data.id)] };
    const misorderedCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    await packageReview(noTravelScopeDefinition, [jobs[0], { appointmentId: committedWork.appointment,
      definition: { ...committedJobDefinition, previousLocationKey: 'unreviewed-prior-location' } }]);
    expect((await post('/origins', {
      reason: 'Refuse a scheduled commitment whose declared predecessor is not the exact crew home or prior job.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(misorderedCount);
    await packageReview(noTravelScopeDefinition, jobs);
    const committedOrigin = await post('/origins', {
      reason: 'Prove an exact one-hour approved worker commitment reduces 100 hours to 99 without travel.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(committedOrigin.status).toBe(201);
    const committedPrivate = await privateResults(committedOrigin.body.data.id);
    expect(Number(committedPrivate[0].personMinutes)).toBe(5940);
    expect(Number(committedPrivate[0].travelPersonMinutes)).toBe(0);

    const travelScopeDefinition = { ...scopeDefinition,
      assetCalendars: [assetCalendar(vehicle.body.data.id), assetCalendar(equipment.body.data.id)] };
    await packageReview(travelScopeDefinition, jobs);
    const travelKey = `m26-p5b-travel-origin-${uuid()}`;
    const travelBody = {
      reason: 'Prove the separately reviewed one-hour travel deduction after the worker commitment.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' };
    const travelOrigin = await post('/origins', travelBody, travelKey);
    expect(travelOrigin.status).toBe(201);
    const travelPrivate = await privateResults(travelOrigin.body.data.id);
    expect(Number(travelPrivate[0].personMinutes)).toBe(5880);
    expect(Number(travelPrivate[0].travelPersonMinutes)).toBe(60);
    const travelReplay = await post('/origins', travelBody, travelKey);
    expect(travelReplay.status).toBe(200);
    expect(travelReplay.headers['idempotency-replayed']).toBe('true');
    expect(travelReplay.body.data).toMatchObject({ id: travelOrigin.body.data.id, replayed: true });
    expect((await post('/origins', { ...travelBody, reason: `${travelBody.reason} Changed.` }, travelKey)).status)
      .toBe(409);
    expect((await post('/origins', travelBody, `m26-p5b-member-${uuid()}`, 'member')).status).toBe(403);
    expect((await request(app).post(endpoint + '/origins').set('X-Test-Actor', 'owner')
      .set('Idempotency-Key', `m26-p5b-no-csrf-${uuid()}`).send(travelBody)).status).toBe(403);
    expect((await get(`/origins/${travelOrigin.body.data.id}`, 'otherOwner')).status).toBe(404);

    await setClock(travelOrigin.body.data.horizonEndsAt);
    const outcomeKey = `m26-p5b-travel-outcome-${uuid()}`;
    const outcome = await post(`/origins/${travelOrigin.body.data.id}/outcomes`, {}, outcomeKey);
    expect(outcome.status).toBe(201);
    const evaluationKey = `m26-p5b-travel-evaluation-${uuid()}`;
    const evaluationBody = { outcomeId: outcome.body.data.id };
    const evaluation = await post(`/origins/${travelOrigin.body.data.id}/evaluations`, evaluationBody, evaluationKey);
    expect(evaluation.status).toBe(201);
    expect(evaluation.body.data).toMatchObject({ originId: travelOrigin.body.data.id,
      outcomeId: outcome.body.data.id, metricsWithheld: true, researchOnly: true,
      forecastIssued: false, paidNumericServing: false, automaticActionTaken: false });
    const revisedOutcomeKey = `m26-p5b-travel-outcome-revision-${uuid()}`;
    const revisedOutcome = await post(`/origins/${travelOrigin.body.data.id}/outcomes`, {}, revisedOutcomeKey);
    expect(revisedOutcome.status).toBe(201);
    expect(revisedOutcome.body.data.revision).toBe(2);
    expect((await get(`/origins/${travelOrigin.body.data.id}/outcomes/${outcome.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_outcome_stale');
    const revisedEvaluationKey = `m26-p5b-travel-evaluation-revision-${uuid()}`;
    const revisedEvaluationBody = { outcomeId: revisedOutcome.body.data.id };
    const revisedEvaluation = await post(`/origins/${travelOrigin.body.data.id}/evaluations`,
      revisedEvaluationBody, revisedEvaluationKey);
    expect(revisedEvaluation.status).toBe(201);
    expect(revisedEvaluation.body.data.revision).toBe(2);
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${evaluation.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_evaluation_stale');
    await updateVehicleConfiguration('Exclusive-end ordinary source progress');
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${revisedEvaluation.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_evaluation_current');
    expect((await post(`/origins/${travelOrigin.body.data.id}/outcomes`, {}, revisedOutcomeKey)).status).toBe(200);
    expect((await post(`/origins/${travelOrigin.body.data.id}/evaluations`,
      revisedEvaluationBody, revisedEvaluationKey)).status).toBe(200);

    // A new prospective coverage epoch permanently retires every receipt in
    // the older lineage. Exact-key origin/outcome/evaluation replays cannot
    // revive that lineage, and a further no-mutation epoch cannot reset the
    // retirement. Recovery below requires current human reviews and a new
    // origin under the newer epoch.
    await advance(1);
    const retirementEpochKey = `m26-p5b-retirement-epoch-${uuid()}`;
    const retirementEpochBody = { reason: 'Retire the prior constrained-capacity receipt lineage.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-epoch-v1' };
    expect((await post('/epochs', retirementEpochBody, retirementEpochKey)).status).toBe(201);
    expect((await post('/epochs', retirementEpochBody, retirementEpochKey)).status).toBe(200);
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    expect((await get(`/origins/${travelOrigin.body.data.id}/outcomes/${outcome.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_outcome_stale');
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${revisedEvaluation.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_evaluation_stale');
    expect((await post('/origins', travelBody, travelKey)).status).toBe(409);
    expect((await post(`/origins/${travelOrigin.body.data.id}/outcomes`, {}, revisedOutcomeKey)).status).toBe(409);
    expect((await post(`/origins/${travelOrigin.body.data.id}/evaluations`,
      revisedEvaluationBody, revisedEvaluationKey)).status)
      .toBe(409);
    await advance(1);
    await p5bEpoch();
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    expect((await get(`/origins/${travelOrigin.body.data.id}/outcomes/${outcome.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_outcome_stale');
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${revisedEvaluation.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_evaluation_stale');

    // One exact reviewed declared hour consumed by one exact approved
    // commitment is authenticated zero for the role and horizon. It is not
    // missing evidence and remains distinct from the refusal above.
    await advance(1);
    const zeroStart = new Date(logicalNow);
    const zeroEnd = new Date(zeroStart.getTime() + 31 * 86400000);
    const zeroAvailableStart = new Date(zeroStart.getTime() + 3600000);
    const zeroAvailableEnd = new Date(zeroAvailableStart.getTime() + 3600000);
    await replaceAvailability(actor('member').actorUserId, zeroStart, zeroEnd, [{ kind: 'available',
      start: zeroAvailableStart.toISOString(), end: zeroAvailableEnd.toISOString() }]);
    await advance(1);
    expect((await p5aPost('/epochs', { reason: 'Begin exact installed-source coverage for zero supply.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' })).status).toBe(201);
    for (const [name, role] of [['owner', 'owner'], ['admin', 'administrator'], ['dispatcher', 'dispatcher'],
      ['member', 'technician'], ['viewer', 'employee']])
      await refreshP5aReview('role_qualification', actor(name).actorUserId, role);
    await refreshP5aReview('availability_basis', actor('member').actorUserId);
    await refreshP5aReview('capacity_role_scope', null, 'technician');
    const zeroWork = await createApprovedWork({ locationId: 'site-one', label: 'Authenticated zero supply proof',
      start: zeroAvailableStart.toISOString() });
    const zeroJobDefinition = { ...unscheduledJobDefinition, appointmentId: zeroWork.appointment,
      assignmentId: zeroWork.assignment.id };
    const zeroJobs = [...jobs, { appointmentId: zeroWork.appointment, definition: zeroJobDefinition }];
    const zeroScopeDefinition = { ...travelScopeDefinition,
      assetCalendars: [assetCalendar(vehicle.body.data.id), assetCalendar(equipment.body.data.id)] };
    await packageReview(zeroScopeDefinition, zeroJobs);
    const zeroBase = (await fixture.ownerPool.query(
      "SELECT canonical_forecast_workload_capacity_v1_capacity_calculation($1,$2,$3,$2,'technician') value",
      [fixture.org, logicalNow, new Date(logicalNow.getTime() + 30 * 86400000)])).rows[0].value;
    if (!zeroBase.classificationComplete || !zeroBase.availabilityComplete || zeroBase.overlap)
      throw new Error(`Authenticated zero base incomplete: ${JSON.stringify(zeroBase)}`);
    const zeroOrigin = await post('/origins', {
      reason: 'Save authenticated complete-zero constrained role supply for the exact future horizon.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    if (zeroOrigin.status !== 201) {
      const diagnostic = await fixture.ownerPool.connect(); let detail;
      try {
        await diagnostic.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        detail = (await diagnostic.query(
          'SELECT canonical_forecast_constrained_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-zero-diagnostic-${uuid()}`,
            'Diagnose the complete-zero constrained role supply.', 'm26-constrained-capacity-origin-v1'])).rows[0].value;
      } catch (error) { detail = { code: error.code, message: error.message }; }
      finally { await diagnostic.query('ROLLBACK').catch(() => {}); diagnostic.release(); }
      throw new Error(`Authenticated zero origin failed: ${JSON.stringify({ body: zeroOrigin.body, detail })}`);
    }
    expect(zeroOrigin.status).toBe(201);
    const zeroPrivate = await privateResults(zeroOrigin.body.data.id);
    expect(Number(zeroPrivate[0].personMinutes)).toBe(0);
    expect(Number(zeroPrivate[0].travelPersonMinutes)).toBe(60);

    const sharedScopeKey = 'shared-technician-supply';
    const sharedScopeDefinition = { ...zeroScopeDefinition, scopeKey: sharedScopeKey };
    await p5bReview('scope', sharedScopeKey, null, sharedScopeDefinition);
    const sharedCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    expect((await post('/origins', {
      reason: 'Refuse two declared scopes that would double count the same person and exact assets.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(sharedCount);
    const sharedReviewToken = (await get(
      `/reviews/current?kind=scope&scopeKey=${sharedScopeKey}&subjectId=none`)).body.data;
    const sharedRejectKey = `m26-p5b-review-reject-${uuid()}`;
    const sharedRejectBody = { kind: 'scope', scopeKey: sharedScopeKey, subjectId: null, action: 'reject',
      expectedRevision: sharedReviewToken.expectedRevision, expectedDigest: sharedReviewToken.expectedDigest,
      definition: sharedScopeDefinition, reason: 'Owner rejects the overlapping capacity scope without erasing history.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-review-v1' };
    const sharedRejected = await post('/reviews', sharedRejectBody, sharedRejectKey);
    expect(sharedRejected.status).toBe(201);
    const sharedRejectReplay = await post('/reviews', sharedRejectBody, sharedRejectKey);
    expect(sharedRejectReplay.status).toBe(200);
    expect(sharedRejectReplay.body.data).toMatchObject({ id: sharedRejected.body.data.id,
      action: 'reject', replayed: true });

    await p5bReview('method', null, null, methodDefinition, null, 'reject');
    expect((await get(`/origins/${zeroOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    await p5bReview('method', null, null, methodDefinition);
    expect((await get(`/origins/${zeroOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');

    const originCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    for (let index = 0; index < 20; index += 1) {
      const extraScopeKey = `bounded-scope-${String(index).padStart(2, '0')}`;
      await p5bReview('scope', extraScopeKey, null, { ...travelScopeDefinition, scopeKey: extraScopeKey });
    }
    const oversized = await post('/origins', { reason: 'Refuse the complete scope population above its exact bound.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(oversized.status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(originCount);

    const sourceBlocker = await fixture.ownerPool.connect();
    const accessReader = await fixture.runtimePool.connect();
    const subscriptionWriter = await fixture.ownerPool.connect();
    try {
      await sourceBlocker.query('BEGIN');
      await sourceBlocker.query('LOCK TABLE tenant_assets IN ROW EXCLUSIVE MODE');
      await accessReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const backendPid = Number((await accessReader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const waiting = accessReader.query(
        'SELECT canonical_forecast_constrained_capacity_v1_prerequisites($1,$2,$3,$4) value',
        [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
          actor('owner').authSessionId]);
      await waitForBackendLock(backendPid);
      await subscriptionWriter.query('BEGIN');
      let revoked = false;
      const revoke = subscriptionWriter.query(
        "UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org])
        .then(() => { revoked = true; });
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(revoked).toBe(false);
      await sourceBlocker.query('COMMIT');
      expect((await waiting).rows[0].value.state).toBe('constrained_capacity_prerequisites_current');
      await accessReader.query('COMMIT');
      await revoke; await subscriptionWriter.query('COMMIT');
      expect((await get('/prerequisites/current')).status).toBe(403);
    } catch (error) {
      await sourceBlocker.query('ROLLBACK').catch(() => {});
      await accessReader.query('ROLLBACK').catch(() => {});
      await subscriptionWriter.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      sourceBlocker.release(); accessReader.release(); subscriptionWriter.release();
    }
    await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]);
    const publicBody = JSON.stringify({ first: firstOrigin.body.data, unscheduled: unscheduledOrigin.body.data,
      committed: committedOrigin.body.data, travel: travelOrigin.body.data,
      outcome: outcome.body.data, evaluation: evaluation.body.data });
    expect(publicBody).not.toMatch(/"(?:personMinutes|outputDigest|privateResults|metrics)":/i);
  }, 300000);
});
