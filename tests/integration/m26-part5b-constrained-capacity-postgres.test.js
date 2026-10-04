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
  const waitForAdvisoryWaiters = async count => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const waiting = Number((await fixture.ownerPool.query(
        "SELECT count(*) count FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].count);
      if (waiting >= count) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Expected ${count} PostgreSQL advisory lock waiter(s)`);
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
    const key = `m26-p5b-availability-${uuid()}`;
    const body = { expectedRevision: Number(current.revision), expectedDigest: current.digest,
      expectedTimeZone: 'UTC', coverageStart: start.toISOString(), coverageEnd: end.toISOString(), intervals,
      reason: 'Owner revised the exact bounded availability for authenticated complete-zero evidence.' };
    const send = () => request(fixture.app).put(`/api/v1/canonical/availability/profiles/${profileId}`)
      .set(actor('owner').session.headers).set('Idempotency-Key', key).send(body);
    let response = await send();
    if (response.status === 503) response = await send();
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
    const current = await request(app).get('/api/v1/forecast/workload-capacity/reviews/current')
      .set('X-Test-Actor', 'owner').query({ kind, target: TARGET,
        subjectId: subjectId || 'none', role: kind === 'capacity_role_scope' ? 'none' : (role || 'none') });
    if (current.status !== 200) throw new Error(`Part5A current review failed: ${JSON.stringify({ kind,
      subjectId, role, status: current.status, body: current.body })}`);
    const token = current.body.data;
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

  async function rescheduleApprovedWork(work, start, label = 'Reschedule through the owning M22 authority.') {
    const scheduledStart = new Date(start); const scheduledEnd = new Date(scheduledStart.getTime() + 3600000);
    let receipt;
    for (const action of ['schedule', 'dispatch']) {
      const before = (await fixture.ownerPool.query(
        `SELECT revision,rtrim(canonical_digest) digest,appointment_status,workforce_profile_id,workforce_crew_id
           FROM canonical_schedule_assignments
          WHERE organization_id=$1 AND id=$2`, [fixture.org, work.assignment.id])).rows[0];
      const target = before.workforce_profile_id
        ? { kind: 'profile', id: before.workforce_profile_id }
        : { kind: 'crew', id: before.workforce_crew_id };
      const preview = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${work.appointment}/mutation-previews`)
        .set(actor('owner').session.headers).send({
          expectedRevision: Number(before.revision), expectedDigest: before.digest, expectedTimeZone: 'UTC',
          action, target, scheduledStart: scheduledStart.toISOString(), scheduledEnd: scheduledEnd.toISOString(),
          appointmentStatus: before.appointment_status, reason: label,
        });
      expect(preview.status).toBe(201);
      const approval = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${work.appointment}/mutation-approvals`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5b-reschedule-${uuid()}`)
        .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason: label });
      expect(approval.status).toBe(200); receipt = approval.body.data;
    }
    return { scheduledStart, scheduledEnd, receipt };
  }

  async function changeApprovedWorkTarget(work, action, target, label) {
    const before = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,appointment_status,scheduled_start,scheduled_end
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, work.assignment.id])).rows[0];
    const preview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${work.appointment}/mutation-previews`)
      .set(actor('owner').session.headers).send({
        expectedRevision: Number(before.revision), expectedDigest: before.digest, expectedTimeZone: 'UTC',
        action, target, scheduledStart: before.scheduled_start && new Date(before.scheduled_start).toISOString(),
        scheduledEnd: before.scheduled_end && new Date(before.scheduled_end).toISOString(),
        appointmentStatus: before.appointment_status, reason: label,
      });
    if (preview.status !== 201) throw new Error(
      `Scheduling ${action} preview failed: ${JSON.stringify(preview.body)}`);
    const approval = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${work.appointment}/mutation-approvals`)
      .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5b-target-${uuid()}`)
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason: label });
    if (approval.status !== 200) throw new Error(
      `Scheduling ${action} approval failed: ${JSON.stringify({ approval: approval.body, preview: preview.body.data })}`);
    return approval.body.data;
  }

  async function createApprovedWork({ start, locationId, label, target = null }) {
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
          action, target: target || { kind: 'profile', id: actor('member').actorUserId },
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
      if (approval.status !== 200) throw new Error(
        `Scheduling ${action} approval failed: ${JSON.stringify({ approval: approval.body, preview: preview.body.data })}`);
    }
    const assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, appointment])).rows[0];
    const owningClock = new Date((await fixture.ownerPool.query('SELECT clock_timestamp() value')).rows[0].value);
    if (owningClock.getTime() >= logicalNow.getTime()) await setClock(new Date(owningClock.getTime() + 1000));
    return { appointment, opportunity, assignment };
  }

  async function completeApprovedWork(work, finalAction = 'complete') {
    const operations = require('../../src/operations/repository');
    const { normalizeCompletionAction } = require('../../src/completion/contract');
    const { mutateCompletion } = require('../../src/completion/repository');
    const owner = actor('owner');
    const worker = actor('member');
    const assignment = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, work.assignment.id])).rows[0];
    let execution = (await operations.initializeFieldExecution(fixture.runtimePool, {
      organizationId: fixture.org, actorUserId: worker.actorUserId,
      actorAccessRole: worker.actorAccessRole, authSessionId: worker.authSessionId,
      csrfToken: worker.csrfToken,
      appointmentId: work.appointment, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, idempotencyKey: `m26-p5b-execution-${uuid()}`,
      reason: 'Initialize the exact approved work before its mounted completion.',
      requestCorrelationId: `m26-p5b-execution-${uuid()}`,
    })).body.data;
    execution = (await operations.transitionFieldExecution(fixture.runtimePool, {
      organizationId: fixture.org, actorUserId: worker.actorUserId,
      actorAccessRole: worker.actorAccessRole, authSessionId: worker.authSessionId,
      csrfToken: worker.csrfToken,
      executionId: execution.id, expectedRevision: Number(execution.revision),
      expectedDigest: execution.digest, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, action: 'start',
      idempotencyKey: `m26-p5b-execution-start-${uuid()}`,
      reason: 'Start the exact approved work before its mounted completion.',
      requestCorrelationId: `m26-p5b-execution-start-${uuid()}`,
    })).body.data;
    const mutate = async (action, extra = {}, selectedActor = owner) => {
      const normalized = normalizeCompletionAction({
        organizationId: fixture.org, actorUserId: selectedActor.actorUserId,
        actorAccessRole: selectedActor.actorAccessRole, authSessionId: selectedActor.authSessionId,
        executionId: execution.id, idempotencyKey: `m26-p5b-completion-${uuid()}`,
        body: { action, expectedExecutionRevision: Number(execution.revision),
          expectedExecutionDigest: execution.digest, expectedAssignmentRevision: Number(assignment.revision),
          expectedAssignmentDigest: assignment.digest,
          reason: `Record the exact ${action.replaceAll('_', ' ')} lifecycle evidence.`, ...extra },
      });
      const result = await mutateCompletion(fixture.runtimePool, { ...normalized,
        csrfToken: selectedActor.csrfToken, requestCorrelationId: `m26-p5b-completion-${uuid()}` });
      execution = result.body.data;
      return result.body.completionRecord;
    };
    if (finalAction === 'cancel') {
      const cancelled = await mutate('cancel_execution', { proposal: null });
      return { execution, completion: cancelled };
    }
    const proposed = await mutate('propose_completion', {
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      gateRequirements: { checklists: [], inspections: [], files: [] },
    }, worker);
    const approved = await mutate('approve_completion', { proposal: {
      id: proposed.id, revision: Number(proposed.revision), digest: proposed.digest,
    } });
    return { execution, completion: approved };
  }

  async function correctCompletedWork(work, completed) {
    const { normalizeCompletionAction } = require('../../src/completion/contract');
    const { mutateCompletion } = require('../../src/completion/repository');
    const selectedActor = actor('owner');
    const assignment = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, work.assignment.id])).rows[0];
    const normalized = normalizeCompletionAction({
      organizationId: fixture.org, actorUserId: selectedActor.actorUserId,
      actorAccessRole: selectedActor.actorAccessRole, authSessionId: selectedActor.authSessionId,
      executionId: completed.execution.id, idempotencyKey: `m26-p5b-completion-correction-${uuid()}`,
      body: { action: 'correct_completion', expectedExecutionRevision: Number(completed.execution.revision),
        expectedExecutionDigest: completed.execution.digest, expectedAssignmentRevision: Number(assignment.revision),
        expectedAssignmentDigest: assignment.digest,
        record: { id: completed.completion.id, revision: Number(completed.completion.revision),
          digest: completed.completion.digest },
        annotation: { note: 'Correct the immutable closeout annotation without rewriting its occurrence.',
          nextAction: null },
        reason: 'Append an explicit correction to the in-horizon completion evidence.' },
    });
    const result = await mutateCompletion(fixture.runtimePool, { ...normalized,
      csrfToken: selectedActor.csrfToken, requestCorrelationId: `m26-p5b-completion-correction-${uuid()}` });
    return { execution: result.body.data, completion: result.body.completionRecord };
  }

  async function saveAdoptedM24Bases(work) {
    const estimate = (await fixture.ownerPool.query(
      'SELECT id FROM canonical_estimates WHERE organization_id=$1 AND opportunity_id=$2',
      [fixture.org, work.opportunity])).rows[0];
    expect(estimate).toBeTruthy();
    const route = `/api/v1/canonical/estimates/${estimate.id}`;
    const read = async () => {
      const response = await request(fixture.app).get(`${route}/review`).set(actor('owner').session.headers);
      expect(response.status).toBe(200); return response.body.data;
    };
    const send = (path, body) => request(fixture.app).post(route + path)
      .set(actor('owner').session.headers).set('Idempotency-Key', uuid()).send(body);
    let review = await read();
    const equipment = require('../helpers/m24-equipment-input');
    const equipmentInputs = equipment.inputs();
    equipmentInputs.serviceKey = review.materialSourceContext.serviceKey;
    const equipmentBody = { action: 'save',
      expectedRevision: review.equipmentPlans.current?.revision || 0,
      expectedDigest: review.equipmentPlans.current?.digest || 'none',
      sourcePins: review.pins, expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: equipmentInputs,
      currency: review.currency, reason: 'Review adopted equipment evidence for constrained capacity.',
      confirmed: true, confirmationVersion: 'estimate-equipment-plan-v1' };
    let response = await send('/equipment-plan-preview', equipmentBody); expect(response.status).toBe(200);
    equipmentBody.inputs.assessment = { ...response.body.data.assessment, acknowledged: true };
    response = await send('/equipment-plans', equipmentBody); expect(response.status).toBe(201);
    review = await read();
    const readinessBody = require('../helpers/m24-readiness-input').body(review);
    response = await send('/equipment-readiness-preview', readinessBody); expect(response.status).toBe(200);
    readinessBody.inputs.assessment = { ...response.body.data.assessment, acknowledged: true };
    response = await send('/equipment-readiness-plans', readinessBody); expect(response.status).toBe(201);
    review = await read();
    const travelInputs = require('../helpers/m24-travel-input').fixture();
    travelInputs.serviceKey = review.travelPlans.serviceKey;
    const travelBody = { action: 'save',
      expectedRevision: review.travelPlans.current?.revision || 0,
      expectedDigest: review.travelPlans.current?.digest || 'none',
      sourcePins: review.pins, expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: travelInputs,
      currency: review.currency, reason: 'Review adopted travel evidence for constrained capacity.',
      confirmed: true, confirmationVersion: 'estimate-travel-plan-v1' };
    response = await send('/travel-plan-preview', travelBody); expect(response.status).toBe(200);
    travelBody.inputs.assessment = { ...response.body.data.assessment, acknowledged: true,
      explanation: 'Owner reviewed internal estimates; provider routes remain unavailable.' };
    response = await send('/travel-plans', travelBody); expect(response.status).toBe(201);
    review = await read();
    return {
      equipmentBasis: { kind: 'm24_adopted', receiptId: review.equipmentPlans.current.id,
        digest: review.equipmentPlans.current.digest },
      readinessBasis: { kind: 'm24_adopted', receiptId: review.equipmentReadiness.current.id,
        digest: review.equipmentReadiness.current.digest },
      travelBasis: { kind: 'm24_adopted', receiptId: review.travelPlans.current.id,
        digest: review.travelPlans.current.digest },
    };
  }

  async function withdrawAdoptedM24Basis(work, kind) {
    const estimate = (await fixture.ownerPool.query(
      'SELECT id FROM canonical_estimates WHERE organization_id=$1 AND opportunity_id=$2',
      [fixture.org, work.opportunity])).rows[0];
    const route = `/api/v1/canonical/estimates/${estimate.id}`;
    const reviewResponse = await request(fixture.app).get(`${route}/review`).set(actor('owner').session.headers);
    expect(reviewResponse.status).toBe(200);
    const review = reviewResponse.body.data;
    const contract = {
      equipment: { property: 'equipmentPlans', path: '/equipment-plans', version: 'estimate-equipment-plan-v1' },
      readiness: { property: 'equipmentReadiness', path: '/equipment-readiness-plans', version: 'estimate-equipment-readiness-v1' },
      travel: { property: 'travelPlans', path: '/travel-plans', version: 'estimate-travel-plan-v1' },
    }[kind];
    const current = review[contract.property].current;
    const response = await request(fixture.app).post(route + contract.path)
      .set(actor('owner').session.headers).set('Idempotency-Key', uuid()).send({
        action: 'withdraw', expectedRevision: Number(current.revision), expectedDigest: current.digest,
        sourcePins: review.pins, expectedDecisionRevision: review.decisions.writeBasis.revision,
        expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: null, currency: review.currency,
        reason: `Withdraw the adopted ${kind} basis without rewriting its immutable history.`,
        confirmed: true, confirmationVersion: contract.version,
      });
    expect(response.status).toBe(201);
    return response.body.data;
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
    const initialDispatcherProfile = await request(fixture.app)
      .put(`/api/workforce/profiles/${actor('dispatcher').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'dispatcher',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] });
    expect(profile.status).toBe(200); expect(initialDispatcherProfile.status).toBe(200);
    const crew = await request(fixture.app).post('/api/workforce/crews')
      .set(actor('owner').session.headers).send({ key: 'fixture-crew', name: 'Fixture crew',
        homeLocationId: 'headquarters', members: [
          { profileId: actor('member').actorUserId, role: 'lead' },
          { profileId: actor('dispatcher').actorUserId, role: 'member' },
        ] });
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
    const updateVehicleConfiguration = async (configuration, overrides = {}) => {
      const row = (await fixture.ownerPool.query(
        'SELECT version FROM tenant_assets WHERE organization_id=$1 AND id=$2',
        [fixture.org, vehicle.body.data.id])).rows[0];
      const changed = await request(fixture.app).put(`/api/assets/${vehicle.body.data.id}`)
        .set(actor('owner').session.headers).send({
          ...assetBody(overrides.category || 'vehicle', 'Fixture van', 'P5B-VAN'),
          version: Number(row.version), configuration,
          homeLocationId: Object.hasOwn(overrides, 'homeLocationId') ? overrides.homeLocationId : 'headquarters',
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
    await declareAvailability(actor('dispatcher').actorUserId, start,
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
    await refreshP5aReview('availability_basis', actor('dispatcher').actorUserId);
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
    const scopeDefinition = { scopeKey, alternativeKey: 'baseline', role: 'technician', applicability: { crew: true, skill: true,
      workingHours: true, location: true, travel: true, vehicle: true, equipment: true },
      crewIds: [crew.body.data.id], crewRoleRequirements: [
        { role: 'technician', count: 1 }, { role: 'dispatcher', count: 1 },
      ],
      crewAssignments: [{ profileId: actor('member').actorUserId, crewId: crew.body.data.id,
        role: 'technician' }, { profileId: actor('dispatcher').actorUserId, crewId: crew.body.data.id,
        role: 'dispatcher' }],
      skillIds: [skill.body.data.id], locationKey: 'site-one',
      travelPairs: [{ fromLocationKey: 'headquarters', toLocationKey: 'site-one', durationMinutes: 30, basis: 'estimated' },
        { fromLocationKey: 'site-one', toLocationKey: 'headquarters', durationMinutes: 30, basis: 'estimated' }],
      vehicleAssetIds: [vehicle.body.data.id], equipmentAssetIds: [equipment.body.data.id],
      assetAssignments: [
        { assetId: vehicle.body.data.id, crewId: crew.body.data.id, kind: 'vehicle',
          operatorProfileId: actor('member').actorUserId },
        { assetId: equipment.body.data.id, crewId: crew.body.data.id, kind: 'equipment',
          operatorProfileId: actor('dispatcher').actorUserId },
      ],
      assetRequirements: { vehiclePerSeat: 1, equipmentPerSeat: 1 },
      operatorProfileIds: [actor('member').actorUserId, actor('dispatcher').actorUserId],
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
      { ...scopeDefinition, assetAssignments: [{ ...scopeDefinition.assetAssignments[0],
        operatorProfileId: actor('dispatcher').actorUserId }, scopeDefinition.assetAssignments[1]] },
      { ...scopeDefinition, assetAssignments: [{ ...scopeDefinition.assetAssignments[0], kind: 'equipment' },
        scopeDefinition.assetAssignments[1]] },
    ]) expect((await post('/reviews', { kind: 'scope', scopeKey, subjectId: null, action: 'approve',
        expectedRevision: emptyScopeToken.expectedRevision, expectedDigest: emptyScopeToken.expectedDigest,
        definition: invalidDefinition, reason: 'Refuse duplicated route or asset interval evidence without a receipt.',
        confirmed: true, confirmationVersion: 'm26-constrained-capacity-review-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(scopeReviewCountBeforeDuplicateEvidence);
    await p5bReview('scope', scopeKey, null, scopeDefinition);

    const packageReview = async (definition, jobs, reviewScopeKey = scopeKey) => {
      await advance(1); await p5bEpoch(); await advance(1);
      const entries = [['method', null, methodDefinition], ['scope', null, definition],
        ...jobs.map(job => ['job', job.appointmentId, job.definition])];
      for (const [kind, subject, reviewedDefinition] of entries) {
        const token = (await get(`/reviews/current?kind=${kind}&scopeKey=${kind === 'method' ? 'none' : reviewScopeKey}&subjectId=${subject || 'none'}`)).body.data;
        await p5bReview(kind, kind === 'method' ? null : reviewScopeKey, subject, reviewedDefinition, token);
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
    let freeResult;
    try {
      freeResult = (await fixture.ownerPool.query(
        'SELECT canonical_forecast_constrained_capacity_v1_results($1,$2,$3,$2,$4) value',
        [fixture.org, logicalNow, new Date(logicalNow.getTime() + 30 * 86400000), freeInput])).rows[0].value;
    } catch (error) {
      throw new Error(`Constrained result failed: ${JSON.stringify({ message: error.message,
        where: error.where, detail: error.detail })}`);
    }
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
    const unscheduledJobDefinition = { scopeKey, alternativeKey: 'baseline', appointmentId: unscheduledWork.appointment,
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
    expect(stale.body.data.state).toBe('constrained_capacity_origin_current');

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
    const missingJobCensus = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_constrained_capacity_v1_work_census($1,$2) value',
      [fixture.org, logicalNow])).rows[0].value;
    if (Number(missingJobCensus.count) !== 1) {
      const sourceRows = (await fixture.ownerPool.query(
        `SELECT source_kind,subject_key,operation,observed_at,after_payload
           FROM canonical_forecast_constrained_capacity_source_events_v1
          WHERE organization_id=$1 AND source_kind LIKE 'canonical_schedule_%'
          ORDER BY source_order`, [fixture.org])).rows;
      throw new Error(`Historical approved-work census mismatch: ${JSON.stringify({ missingJobCensus, sourceRows })}`);
    }
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
    expect(sameCutoffStale.body.data.state).toBe('constrained_capacity_origin_current');

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
    if (committedOrigin.status !== 201) {
      let detail; const diagnostic = await fixture.ownerPool.connect();
      try {
        await diagnostic.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        detail = (await diagnostic.query(
          'SELECT canonical_forecast_constrained_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-commit-diagnostic-${uuid()}`,
            'Diagnose committed supply.', 'm26-constrained-capacity-origin-v1'])).rows[0].value;
      } catch (error) { detail = { message: error.message, code: error.code, where: error.where }; }
      finally { await diagnostic.query('ROLLBACK').catch(() => {}); diagnostic.release(); }
      throw new Error(`Committed origin failed: ${JSON.stringify({ body: committedOrigin.body, detail })}`);
    }
    expect(committedOrigin.status).toBe(201);
    const committedPrivate = await privateResults(committedOrigin.body.data.id);
    if (Number(committedPrivate[0].personMinutes) !== 5940) {
      const committedBase = (await fixture.ownerPool.query(
        "SELECT canonical_forecast_workload_capacity_v1_capacity_calculation($1,$2,$3,$2,'technician') value",
        [fixture.org, new Date(committedOrigin.body.data.predictionCutoffAt),
          new Date(committedOrigin.body.data.horizonEndsAt)])).rows[0].value;
      const segmentRows = [];
      for (const interval of intervals) segmentRows.push((await fixture.ownerPool.query(
        `SELECT canonical_forecast_constrained_capacity_v1_scope_segment($1,review_value,$2,$3,input_value) value
           FROM canonical_forecast_constrained_capacity_reviews_v1 review_value
           CROSS JOIN LATERAL (SELECT input_manifest->'jobs' input_value
             FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1 AND id=$4) input
          WHERE review_value.organization_id=$1 AND review_value.review_kind='scope'
            AND review_value.scope_key=$5 ORDER BY review_value.revision DESC LIMIT 1`,
        [fixture.org, interval.start, interval.end, committedOrigin.body.data.id, scopeKey])).rows[0].value);
      const assignmentRows = (await fixture.ownerPool.query(
        `SELECT revision_value.revision,revision_value.schedule_state,revision_value.scheduled_start,
                revision_value.scheduled_end,revision_value.approval_id,revision_value.human_approval_id,
                COALESCE(human_value.approved_at,approval_value.approved_at) decision_at
           FROM canonical_schedule_assignment_revisions revision_value
           LEFT JOIN canonical_schedule_human_approvals human_value
             ON human_value.organization_id=revision_value.organization_id AND human_value.id=revision_value.human_approval_id
           LEFT JOIN canonical_schedule_approvals approval_value
             ON approval_value.organization_id=revision_value.organization_id AND approval_value.id=revision_value.approval_id
          WHERE revision_value.organization_id=$1 AND revision_value.assignment_id=$2 ORDER BY revision_value.revision`,
        [fixture.org, committedWork.assignment.id])).rows;
      const scheduledStart = new Date(assignmentRows.at(-1).scheduled_start);
      const scheduledEnd = new Date(assignmentRows.at(-1).scheduled_end);
      const owningInterval = intervals.find(interval => new Date(interval.start) < scheduledEnd
        && new Date(interval.end) > scheduledStart);
      const exactSegments = [];
      for (const [segmentStart, segmentEnd] of [[owningInterval.start, scheduledStart],
        [scheduledStart, scheduledEnd], [scheduledEnd, owningInterval.end]]) {
        exactSegments.push((await fixture.ownerPool.query(
          `SELECT canonical_forecast_constrained_capacity_v1_scope_segment($1,review_value,$2,$3,input_value) value
             FROM canonical_forecast_constrained_capacity_reviews_v1 review_value
             CROSS JOIN LATERAL (SELECT input_manifest->'jobs' input_value
               FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1 AND id=$4) input
            WHERE review_value.organization_id=$1 AND review_value.review_kind='scope'
              AND review_value.scope_key=$5 ORDER BY review_value.revision DESC LIMIT 1`,
          [fixture.org, segmentStart, segmentEnd, committedOrigin.body.data.id, scopeKey])).rows[0].value);
      }
      throw new Error(`Committed arithmetic mismatch: ${JSON.stringify({ cutoff: committedOrigin.body.data.predictionCutoffAt,
        horizonEnd: committedOrigin.body.data.horizonEndsAt, committedPrivate, committedBase, segmentRows,
        assignmentRows, owningInterval, exactSegments })}`);
    }
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

    // An ordinary, explicitly reviewed asset-calendar commitment inside the
    // horizon is outcome evidence. It does not rewrite the immutable origin.
    // Its exact reviewed endpoints remove only the affected hour, and a later
    // review restores prospective availability without reviving the older
    // review generation.
    const ordinaryTransitionAt = new Date(new Date(travelOrigin.body.data.predictionCutoffAt).getTime()
      + 2 * 86400000 + 10 * 3600000);
    const ordinaryTransitionEnd = new Date(ordinaryTransitionAt.getTime() + 3600000);
    await setClock(ordinaryTransitionAt);
    const constrainedVehicleCalendar = travelScopeDefinition.assetCalendars.map(calendar =>
      calendar.assetId === vehicle.body.data.id
        ? { ...calendar, committedIntervals: [{ start: ordinaryTransitionAt.toISOString(),
          end: ordinaryTransitionEnd.toISOString() }] }
        : calendar);
    await p5bReview('scope', scopeKey, null,
      { ...travelScopeDefinition, assetCalendars: constrainedVehicleCalendar });
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');
    await setClock(ordinaryTransitionEnd);
    await p5bReview('scope', scopeKey, null, travelScopeDefinition);
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');

    // A separately reviewed M22 availability transition inside the horizon is
    // integrated over its owning half-hour interval. The later restoration is
    // a new prospective review: it does not make the already elapsed gap
    // available retroactively and it does not stale the immutable origin.
    const availabilityGapStart = new Date(new Date(travelOrigin.body.data.predictionCutoffAt).getTime()
      + 4 * 86400000 + 10 * 3600000);
    const availabilityGapEnd = new Date(availabilityGapStart.getTime() + 1800000);
    const gapInterval = intervals.find(interval => new Date(interval.start) < availabilityGapStart
      && new Date(interval.end) > availabilityGapEnd);
    const gapIntervals = intervals.filter(interval => interval !== gapInterval).concat([
      { kind: 'available', start: gapInterval.start, end: availabilityGapStart.toISOString() },
      { kind: 'available', start: availabilityGapEnd.toISOString(), end: gapInterval.end },
    ]).sort((left, right) => new Date(left.start) - new Date(right.start));
    await setClock(availabilityGapStart);
    await replaceAvailability(actor('member').actorUserId, start,
      new Date(horizonEnd.getTime() + 86400000), gapIntervals);
    await refreshP5aReview('availability_basis', actor('member').actorUserId);
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');
    await setClock(availabilityGapEnd);
    await replaceAvailability(actor('member').actorUserId, start,
      new Date(horizonEnd.getTime() + 86400000), intervals);
    await refreshP5aReview('availability_basis', actor('member').actorUserId);
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');

    // A genuine new approved commitment and its location arrive during the
    // horizon. Explicit scope and job rereviews add a second ordered route leg
    // prospectively; they do not rewrite the origin's earlier receipts.
    const evolvedScopeDefinition = { ...travelScopeDefinition, travelPairs: [
      travelScopeDefinition.travelPairs[0],
      travelScopeDefinition.travelPairs[1],
      { fromLocationKey: 'headquarters', toLocationKey: 'site-two', durationMinutes: 20, basis: 'estimated' },
      { fromLocationKey: 'site-two', toLocationKey: 'headquarters', durationMinutes: 30, basis: 'estimated' },
    ] };
    const laterWork = await createApprovedWork({ locationId: 'site-two', label: 'Later route evolution proof',
      start: new Date(new Date(travelOrigin.body.data.predictionCutoffAt).getTime()
        + 6 * 86400000 + 10 * 3600000).toISOString() });
    const laterJobDefinition = {
      ...committedJobDefinition, appointmentId: laterWork.appointment, assignmentId: laterWork.assignment.id,
      locationKey: 'site-two', previousLocationKey: 'headquarters', nextLocationKey: 'headquarters',
    };
    const cancelledWork = await createApprovedWork({ locationId: 'site-two',
      label: 'Cancelled in-horizon route proof', start: new Date(
        new Date(travelOrigin.body.data.predictionCutoffAt).getTime() + 8 * 86400000 + 10 * 3600000).toISOString() });
    const cancelledJobDefinition = { ...laterJobDefinition, appointmentId: cancelledWork.appointment,
      assignmentId: cancelledWork.assignment.id };
    await p5bReview('scope', scopeKey, null, evolvedScopeDefinition);
    await p5bReview('job', scopeKey, committedWork.appointment, committedJobDefinition);
    await p5bReview('job', scopeKey, laterWork.appointment, laterJobDefinition);
    await p5bReview('job', scopeKey, cancelledWork.appointment, cancelledJobDefinition);
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');

    // The owning M22 schedule is a half-open authority timeline. The first
    // commitment elapses, a guarded unschedule stops future consumption, and
    // a guarded reschedule creates a distinct later commitment. Neither human
    // decision can move or erase the earlier approved interval.
    const firstLaterSchedule = (await fixture.ownerPool.query(
      `SELECT scheduled_start,scheduled_end FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, laterWork.assignment.id])).rows[0];
    await setClock(new Date(new Date(firstLaterSchedule.scheduled_end).getTime() + 1000));
    await p5aUnschedule(laterWork);
    await p5bReview('job', scopeKey, laterWork.appointment, laterJobDefinition);
    await advance(1);
    await changeApprovedWorkTarget(laterWork, 'unassign', { kind: 'unassigned', id: null },
      'End the prior target authority without erasing its elapsed approved commitment.');
    await advance(1);
    await changeApprovedWorkTarget(laterWork, 'assign',
      { kind: 'profile', id: actor('member').actorUserId },
      'Begin a distinct later target authority before a new approved commitment.');
    await p5bReview('job', scopeKey, laterWork.appointment, laterJobDefinition);
    await advance(1);
    const secondLaterSchedule = await rescheduleApprovedWork(laterWork,
      new Date(new Date(firstLaterSchedule.scheduled_end).getTime() + 3 * 3600000),
      'Create a distinct later approved commitment without rewriting the elapsed interval.');
    await p5bReview('job', scopeKey, laterWork.appointment, laterJobDefinition);
    const scheduleTimeline = (await fixture.ownerPool.query(
      `SELECT canonical_forecast_constrained_capacity_v1_schedule_timeline($1,$2,$3,$4,$4,false) value`,
      [fixture.org, laterWork.assignment.id, travelOrigin.body.data.predictionCutoffAt,
        travelOrigin.body.data.horizonEndsAt])).rows[0].value;
    expect(scheduleTimeline.map(value => [value.targetState, value.scheduleState])).toEqual([
      ['assigned', 'scheduled'], ['assigned', 'unscheduled'], ['unassigned', 'unscheduled'],
      ['assigned', 'unscheduled'], ['assigned', 'scheduled'],
    ]);
    expect(scheduleTimeline.filter(value => value.commitmentStart !== null)).toHaveLength(2);
    expect(new Date(scheduleTimeline[0].commitmentEnd).getTime())
      .toBe(new Date(firstLaterSchedule.scheduled_end).getTime());
    expect(new Date(scheduleTimeline[4].commitmentStart).getTime())
      .toBe(secondLaterSchedule.scheduledStart.getTime());

    // The later-created work completes through the genuine M23 execution and
    // completion authority before the exclusive horizon end. Its scheduled
    // commitment and reviewed route remain period evidence; completion is
    // ordinary progress and cannot erase the already consumed interval.
    const laterAssignment = (await fixture.ownerPool.query(
      `SELECT scheduled_end FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND id=$2`, [fixture.org, laterWork.assignment.id])).rows[0];
    await setClock(new Date(new Date(laterAssignment.scheduled_end).getTime() + 1000));
    const completedLaterWork = await completeApprovedWork(laterWork);
    expect(completedLaterWork.completion.recordKind).toBe('approval');
    expect(completedLaterWork.execution.lifecycleState).toBe('completed');
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');
    await setClock(new Date(new Date(travelOrigin.body.data.predictionCutoffAt).getTime()
      + 7 * 86400000 + 10 * 3600000));
    const cancelledInHorizon = await completeApprovedWork(cancelledWork, 'cancel');
    expect(cancelledInHorizon.execution.lifecycleState).toBe('cancelled');
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');

    await setClock(travelOrigin.body.data.horizonEndsAt);
    await p5aUnschedule(committedWork);
    await changeApprovedWorkTarget(committedWork, 'unassign', { kind: 'unassigned', id: null },
      'Record an exclusive-end target change for the next capacity period only.');
    await setClock(new Date(new Date(travelOrigin.body.data.horizonEndsAt).getTime() + 1000));
    await changeApprovedWorkTarget(committedWork, 'assign',
      { kind: 'profile', id: actor('member').actorUserId },
      'Record a post-end reassignment without rewriting the ended capacity period.');
    const historicalWork = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_constrained_capacity_v1_work_census_period($1,$2,$3) value',
      [fixture.org, travelOrigin.body.data.predictionCutoffAt, travelOrigin.body.data.horizonEndsAt])).rows[0].value;
    expect(historicalWork.rows.map(value => value.appointmentId)).toEqual(expect.arrayContaining([
      laterWork.appointment, cancelledWork.appointment,
    ]));
    expect(historicalWork.rows.find(value => value.appointmentId === laterWork.appointment))
      .toMatchObject({ appointmentStatus: 'completed' });
    expect(historicalWork.rows.find(value => value.appointmentId === cancelledWork.appointment))
      .toMatchObject({ appointmentStatus: 'cancelled' });
    const committedHistory = historicalWork.rows.find(value => value.appointmentId === committedWork.appointment);
    const committedScheduledHistory = committedHistory.scheduleTimeline.find(value => value.scheduleState === 'scheduled'
      && value.commitmentStart !== null);
    expect(committedScheduledHistory).toBeDefined();
    expect(new Date(committedScheduledHistory.authorityStart).getTime())
      .toBe(new Date(travelOrigin.body.data.predictionCutoffAt).getTime());
    expect(committedHistory.scheduleTimeline.some(value => new Date(value.decisionAt).getTime()
      === new Date(travelOrigin.body.data.horizonEndsAt).getTime())).toBe(false);
    expect(committedHistory.scheduleTimeline.every(value => new Date(value.authorityStart).getTime()
      < new Date(travelOrigin.body.data.horizonEndsAt).getTime())).toBe(true);
    const outcomeKey = `m26-p5b-travel-outcome-${uuid()}`;
    const outcome = await post(`/origins/${travelOrigin.body.data.id}/outcomes`, {}, outcomeKey);
    if (outcome.status !== 201) {
      const diagnostic = await fixture.ownerPool.connect(); let detail;
      try {
        await diagnostic.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        detail = (await diagnostic.query(
          'SELECT canonical_forecast_constrained_capacity_v1_outcome_capture($1,$2,$3,$4,$5,$6,$7) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-outcome-diag-${uuid()}`,
            travelOrigin.body.data.id])).rows[0].value;
      } catch (error) { detail = { code: error.code, message: error.message, where: error.where }; }
      finally { await diagnostic.query('ROLLBACK').catch(() => {}); diagnostic.release(); }
      throw new Error(`Outcome capture failed: ${JSON.stringify({ body: outcome.body, detail })}`);
    }
    const outcomePrivate = (await fixture.ownerPool.query(
      'SELECT private_results FROM canonical_forecast_constrained_capacity_outcomes_v1 WHERE organization_id=$1 AND id=$2',
      [fixture.org, outcome.body.data.id])).rows[0].private_results;
    // 6,000 declared minutes minus four exact one-hour worker commitments,
    // one ordinary one-hour asset-calendar commitment, the reviewed 30-minute
    // availability gap and 160 reviewed travel minutes = 5,510. The elapsed
    // commitment survives its later unschedule/reschedule, while completed
    // and cancelled work both remain in the historical half-open census.
    if (Number(outcomePrivate[0].personMinutes) !== 5510 ||
      Number(outcomePrivate[0].travelPersonMinutes) !== 160) {
      const historicalInput = (await fixture.ownerPool.query(
        'SELECT canonical_forecast_constrained_capacity_v1_complete_input($1,$2,$3) value',
        [fixture.org, travelOrigin.body.data.horizonEndsAt, travelOrigin.body.data.predictionCutoffAt])).rows[0].value;
      const assignmentWindows = (await fixture.ownerPool.query(
        `SELECT assignment_id,scheduled_start,scheduled_end,schedule_state,revision FROM canonical_schedule_assignment_revisions
          WHERE organization_id=$1 AND assignment_id=ANY($2::uuid[]) ORDER BY assignment_id,revision`,
        [fixture.org, historicalInput.jobs.map(value => value.assignmentId)])).rows;
      const capacityAtEnd = (await fixture.ownerPool.query(
        'SELECT canonical_forecast_workload_capacity_v1_capacity_calculation($1,$2,$3,$3,$4) value',
        [fixture.org, travelOrigin.body.data.predictionCutoffAt,
          travelOrigin.body.data.horizonEndsAt, 'technician'])).rows[0].value;
      throw new Error(`Historical completion/cancellation arithmetic mismatch: ${JSON.stringify({
        outcomePrivate, historicalWork, jobs: historicalInput.jobs, assignmentWindows, capacityAtEnd })}`);
    }
    const evaluationKey = `m26-p5b-travel-evaluation-${uuid()}`;
    const evaluationBody = { outcomeId: outcome.body.data.id };
    const evaluation = await post(`/origins/${travelOrigin.body.data.id}/evaluations`, evaluationBody, evaluationKey);
    expect(evaluation.status).toBe(201);
    expect(evaluation.body.data).toMatchObject({ originId: travelOrigin.body.data.id,
      outcomeId: outcome.body.data.id, metricsWithheld: true, researchOnly: true,
      forecastIssued: false, paidNumericServing: false, automaticActionTaken: false });
    const missingOutcomeId = uuid(); const missingEvaluationId = uuid();
    expect((await get(`/origins/${travelOrigin.body.data.id}/outcomes/${missingOutcomeId}`)).status).toBe(404);
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${missingEvaluationId}`)).status).toBe(404);
    expect((await get(`/origins/${travelOrigin.body.data.id}/outcomes/${outcome.body.data.id}`, 'otherOwner')).status)
      .toBe(404);
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${evaluation.body.data.id}`, 'otherOwner')).status)
      .toBe(404);
    await advance(1);
    await rescheduleApprovedWork(committedWork,
      new Date(new Date(travelOrigin.body.data.horizonEndsAt).getTime() + 2 * 86400000),
      'Post-end ordinary schedule progress belongs only to the next period.');
    await p5bReview('job', scopeKey, committedWork.appointment, committedJobDefinition);
    expect((await get(`/origins/${travelOrigin.body.data.id}/outcomes/${outcome.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_outcome_current');
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${evaluation.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_evaluation_current');
    await advance(1);
    const correctedLaterWork = await correctCompletedWork(laterWork, completedLaterWork);
    expect(correctedLaterWork.completion).toMatchObject({ recordKind: 'correction',
      rootId: completedLaterWork.completion.id, previousRecordId: completedLaterWork.completion.id, revision: 2 });
    expect((await get(`/origins/${travelOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_current');
    expect((await get(`/origins/${travelOrigin.body.data.id}/outcomes/${outcome.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_outcome_stale');
    expect((await get(`/origins/${travelOrigin.body.data.id}/evaluations/${evaluation.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_evaluation_stale');
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
    // Human decisions made after the exclusive horizon end are ordinary future
    // authority. They cannot retroactively rewrite the pinned ended outcome or
    // make its exact-key replays stale.
    await p5bReview('scope', scopeKey, null, evolvedScopeDefinition);
    await p5bReview('job', scopeKey, laterWork.appointment, laterJobDefinition);
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
    await replaceAvailability(actor('dispatcher').actorUserId, zeroStart, zeroEnd, [{ kind: 'available',
      start: zeroAvailableStart.toISOString(), end: zeroAvailableEnd.toISOString() }]);
    await advance(1);
    expect((await p5aPost('/epochs', { reason: 'Begin exact installed-source coverage for zero supply.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' })).status).toBe(201);
    for (const [name, role] of [['owner', 'owner'], ['admin', 'administrator'], ['dispatcher', 'dispatcher'],
      ['member', 'technician'], ['viewer', 'employee']])
      await refreshP5aReview('role_qualification', actor(name).actorUserId, role);
    await refreshP5aReview('availability_basis', actor('member').actorUserId);
    await refreshP5aReview('availability_basis', actor('dispatcher').actorUserId);
    await refreshP5aReview('capacity_role_scope', null, 'technician');
    const zeroWork = await createApprovedWork({ locationId: 'site-one', label: 'Authenticated zero supply proof',
      start: zeroAvailableStart.toISOString() });
    const zeroJobDefinition = { ...unscheduledJobDefinition, appointmentId: zeroWork.appointment,
      assignmentId: zeroWork.assignment.id };
    const zeroJobs = [...jobs,
      { appointmentId: laterWork.appointment, definition: { ...committedJobDefinition,
        appointmentId: laterWork.appointment, assignmentId: laterWork.assignment.id,
        locationKey: 'site-two' } },
      { appointmentId: zeroWork.appointment, definition: zeroJobDefinition }];
    const zeroScopeDefinition = { ...travelScopeDefinition,
      travelPairs: travelScopeDefinition.travelPairs.map(pair => ({ ...pair, durationMinutes: 0 })),
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
    expect(Number(zeroPrivate[0].travelPersonMinutes)).toBe(0);

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

    // The same complete people/assets may support a distinct alternative, but
    // each alternative remains a separate, non-summed result manifest.
    const alternativeKey = 'alternative-two';
    const alternativeScopeDefinition = { ...sharedScopeDefinition, alternativeKey };
    await p5bReview('scope', sharedScopeKey, null, alternativeScopeDefinition);
    for (const job of zeroJobs) await p5bReview('job', sharedScopeKey, job.appointmentId, {
      ...job.definition, scopeKey: sharedScopeKey, alternativeKey,
    });
    const alternativeOrigin = await post('/origins', {
      reason: 'Save distinct alternatives without pooling their shared people or assets.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1',
    });
    if (alternativeOrigin.status !== 201) {
      const diagnostic = await fixture.ownerPool.connect(); let detail;
      try {
        await diagnostic.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        detail = (await diagnostic.query(
          'SELECT canonical_forecast_constrained_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-alt-diag-${uuid()}`,
            'Diagnose the distinct alternative capacity scope.',
            'm26-constrained-capacity-origin-v1'])).rows[0].value;
      } catch (error) { detail = { code: error.code, message: error.message, where: error.where }; }
      finally { await diagnostic.query('ROLLBACK').catch(() => {}); diagnostic.release(); }
      throw new Error(`Alternative origin failed: ${JSON.stringify({ body: alternativeOrigin.body, detail })}`);
    }
    const alternativePrivate = await privateResults(alternativeOrigin.body.data.id);
    expect(alternativePrivate).toHaveLength(2);
    expect(alternativePrivate.map(value => value.alternativeKey).sort()).toEqual(['alternative-two', 'baseline']);
    expect(alternativePrivate.every(value => Number(value.personMinutes) === 0)).toBe(true);

    // Competing compatibility proves exact server matching: the member and
    // dispatcher can serve crews X or Y, while the admin and owner can serve
    // only X. The first vehicle/tool pair can serve either crew and the second
    // pair only X. A reviewer-picked X allocation would undercount; the server
    // selects admin+owner for X and member+dispatcher for Y, yielding 200
    // target-role worker-hours without reusing a person, operator, or asset.
    await p5bReview('scope', scopeKey, null, zeroScopeDefinition, null, 'reject');
    await p5bReview('scope', sharedScopeKey, null, alternativeScopeDefinition, null, 'reject');
    await p5aUnschedule(committedWork);
    await p5aUnschedule(zeroWork);
    const adminProfile = await request(fixture.app).put(`/api/workforce/profiles/${actor('admin').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'technician',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] });
    const dispatcherProfile = await request(fixture.app).put(`/api/workforce/profiles/${actor('dispatcher').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'dispatcher',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] });
    const ownerProfile = await request(fixture.app).put(`/api/workforce/profiles/${actor('owner').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'dispatcher',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] });
    expect(adminProfile.status).toBe(200); expect(dispatcherProfile.status).toBe(200);
    expect(ownerProfile.status).toBe(200);
    const crewUpdated = await request(fixture.app).put(`/api/workforce/crews/${crew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew', homeLocationId: 'headquarters', members: [
        { profileId: actor('member').actorUserId, role: 'lead' },
        { profileId: actor('admin').actorUserId, role: 'member' },
        { profileId: actor('dispatcher').actorUserId, role: 'member' },
        { profileId: actor('owner').actorUserId, role: 'member' },
      ] });
    expect(crewUpdated.status).toBe(200);
    const secondCrew = await request(fixture.app).post('/api/workforce/crews')
      .set(actor('owner').session.headers).send({ key: 'fixture-crew-two', name: 'Fixture crew two',
        homeLocationId: 'headquarters', members: [
          { profileId: actor('member').actorUserId, role: 'lead' },
          { profileId: actor('dispatcher').actorUserId, role: 'member' },
        ] });
    expect(secondCrew.status).toBe(201);
    const secondVehicle = await request(fixture.app).post('/api/assets').set(actor('owner').session.headers)
      .send(assetBody('vehicle', 'Fixture second van', 'P5B-VAN-2'));
    const secondEquipment = await request(fixture.app).post('/api/assets').set(actor('owner').session.headers)
      .send(assetBody('equipment', 'Fixture second machine', 'P5B-MACHINE-2'));
    expect(secondVehicle.status).toBe(201); expect(secondEquipment.status).toBe(201);
    for (const asset of [secondVehicle.body.data, secondEquipment.body.data]) {
      if (asset.catalogueState !== 'active') {
        const activated = await request(fixture.app).patch(`/api/assets/${asset.id}/catalogue-state`)
          .set(actor('owner').session.headers).send({ version: asset.version, catalogueState: 'active' });
        expect(activated.status).toBe(200);
      }
    }
    await advance(1);
    const formationStart = new Date(logicalNow);
    const formationEnd = new Date(formationStart.getTime() + 31 * 86400000);
    const targetIntervals = Array.from({ length: 10 }, (_, index) => ({ kind: 'available',
      start: new Date(formationStart.getTime() + index * 86400000 + 9 * 3600000).toISOString(),
      end: new Date(formationStart.getTime() + index * 86400000 + 19 * 3600000).toISOString() }));
    const supportIntervals = targetIntervals;
    await replaceAvailability(actor('member').actorUserId, formationStart, formationEnd, targetIntervals);
    await declareAvailability(actor('admin').actorUserId, formationStart, formationEnd, targetIntervals);
    await replaceAvailability(actor('dispatcher').actorUserId, formationStart, formationEnd, supportIntervals);
    await declareAvailability(actor('owner').actorUserId, formationStart, formationEnd, supportIntervals);
    await advance(1);
    expect((await p5aPost('/epochs', { reason: 'Begin complete installed-source formation coverage.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' })).status).toBe(201);
    for (const [name, role] of [['owner', 'dispatcher'], ['admin', 'technician'], ['dispatcher', 'dispatcher'],
      ['member', 'technician'], ['viewer', 'employee']]) {
      if (name === 'admin' || name === 'owner') await p5aReview({ kind: 'role_qualification',
        subjectId: actor(name).actorUserId, role });
      else await refreshP5aReview('role_qualification', actor(name).actorUserId, role);
    }
    await refreshP5aReview('availability_basis', actor('member').actorUserId);
    await p5aReview({ kind: 'availability_basis', subjectId: actor('admin').actorUserId });
    await refreshP5aReview('availability_basis', actor('dispatcher').actorUserId);
    await p5aReview({ kind: 'availability_basis', subjectId: actor('owner').actorUserId });
    await refreshP5aReview('capacity_role_scope', null, 'technician');

    const formationScopeKey = 'formation-multirole-supply';
    const formationAlternative = 'formation-proof';
    const formationAssetCalendar = assetId => ({ assetId, availableIntervals: [{
      start: formationStart.toISOString(), end: formationEnd.toISOString() }], committedIntervals: [] });
    const formationScope = { ...scopeDefinition, scopeKey: formationScopeKey,
      alternativeKey: formationAlternative,
      travelPairs: scopeDefinition.travelPairs.map(pair => ({ ...pair, durationMinutes: 0 })),
      crewIds: [crew.body.data.id, secondCrew.body.data.id],
      crewRoleRequirements: [{ role: 'technician', count: 1 }, { role: 'dispatcher', count: 1 }],
      crewAssignments: [
        { profileId: actor('member').actorUserId, crewId: crew.body.data.id, role: 'technician' },
        { profileId: actor('member').actorUserId, crewId: secondCrew.body.data.id, role: 'technician' },
        { profileId: actor('admin').actorUserId, crewId: crew.body.data.id, role: 'technician' },
        { profileId: actor('dispatcher').actorUserId, crewId: crew.body.data.id, role: 'dispatcher' },
        { profileId: actor('dispatcher').actorUserId, crewId: secondCrew.body.data.id, role: 'dispatcher' },
        { profileId: actor('owner').actorUserId, crewId: crew.body.data.id, role: 'dispatcher' },
      ],
      vehicleAssetIds: [vehicle.body.data.id, secondVehicle.body.data.id],
      equipmentAssetIds: [equipment.body.data.id, secondEquipment.body.data.id],
      assetAssignments: [
        { assetId: vehicle.body.data.id, crewId: crew.body.data.id, kind: 'vehicle',
          operatorProfileId: actor('admin').actorUserId },
        { assetId: vehicle.body.data.id, crewId: secondCrew.body.data.id, kind: 'vehicle',
          operatorProfileId: actor('member').actorUserId },
        { assetId: equipment.body.data.id, crewId: crew.body.data.id, kind: 'equipment',
          operatorProfileId: actor('owner').actorUserId },
        { assetId: equipment.body.data.id, crewId: secondCrew.body.data.id, kind: 'equipment',
          operatorProfileId: actor('dispatcher').actorUserId },
        { assetId: secondVehicle.body.data.id, crewId: crew.body.data.id, kind: 'vehicle',
          operatorProfileId: actor('admin').actorUserId },
        { assetId: secondEquipment.body.data.id, crewId: crew.body.data.id, kind: 'equipment',
          operatorProfileId: actor('owner').actorUserId },
      ],
      operatorProfileIds: [actor('member').actorUserId, actor('admin').actorUserId,
        actor('dispatcher').actorUserId, actor('owner').actorUserId],
      assetCalendars: [vehicle.body.data.id, secondVehicle.body.data.id,
        equipment.body.data.id, secondEquipment.body.data.id].map(formationAssetCalendar) };
    const initiallyAdoptedM24 = await saveAdoptedM24Bases(unscheduledWork);
    // The three Mission24 authorities are append-only streams keyed by their
    // owning estimate and plan kind. A newer immutable receipt must invalidate
    // the older adoption even though it has a different UUID.
    await withdrawAdoptedM24Basis(unscheduledWork, 'equipment');
    const staleAdoptionToken = (await get(
      `/reviews/current?kind=job&scopeKey=${formationScopeKey}&subjectId=${unscheduledWork.appointment}`)).body.data;
    expect((await post('/reviews', { kind: 'job', scopeKey: formationScopeKey,
      subjectId: unscheduledWork.appointment, action: 'approve',
      expectedRevision: staleAdoptionToken.expectedRevision, expectedDigest: staleAdoptionToken.expectedDigest,
      definition: { ...unscheduledJobDefinition, scopeKey: formationScopeKey,
        alternativeKey: formationAlternative, appointmentId: unscheduledWork.appointment,
        assignmentId: unscheduledWork.assignment.id, vehicleAssetIds: formationScope.vehicleAssetIds,
        equipmentAssetIds: formationScope.equipmentAssetIds, ...initiallyAdoptedM24 },
      reason: 'Refuse a superseded Mission24 equipment-plan UUID before a Part5B origin.', confirmed: true,
      confirmationVersion: 'm26-constrained-capacity-review-v1' })).status).toBe(400);
    const adoptedM24 = await saveAdoptedM24Bases(unscheduledWork);
    const formationJobs = [unscheduledWork, committedWork, zeroWork, laterWork].map((work, index) => ({ appointmentId: work.appointment,
      definition: { ...unscheduledJobDefinition, scopeKey: formationScopeKey,
        alternativeKey: formationAlternative, appointmentId: work.appointment,
        assignmentId: work.assignment.id,
        ...(work === laterWork ? { locationKey: 'site-two' } : {}),
        vehicleAssetIds: formationScope.vehicleAssetIds,
        equipmentAssetIds: formationScope.equipmentAssetIds,
        ...(index === 0 ? adoptedM24 : {}) } }));
    await packageReview(formationScope, formationJobs, formationScopeKey);
    const formationOriginKey = `m26-p5b-formation-origin-${uuid()}`;
    const formationOriginBody = {
      reason: 'Save the complete multiworker multirole formation without person or asset reuse.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' };
    const formationOrigin = await post('/origins', formationOriginBody, formationOriginKey);
    if (formationOrigin.status !== 201) {
      const diagnostic = await fixture.ownerPool.connect(); let detail;
      try {
        await diagnostic.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        detail = (await diagnostic.query(
          'SELECT canonical_forecast_constrained_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-formation-diag-${uuid()}`,
            'Diagnose the complete multiworker multirole formation.',
            'm26-constrained-capacity-origin-v1'])).rows[0].value;
      } catch (error) { detail = { code: error.code, message: error.message, detail: error.detail,
        where: error.where }; }
      finally { await diagnostic.query('ROLLBACK').catch(() => {}); diagnostic.release(); }
      const census = (await fixture.ownerPool.query(
        'SELECT canonical_forecast_constrained_capacity_v1_work_census($1,$2) value',
        [fixture.org, logicalNow])).rows[0].value;
      const reviewed = (await fixture.ownerPool.query(
        `SELECT scope_key,subject_id,revision,action,definition->>'alternativeKey' alternative
           FROM canonical_forecast_constrained_capacity_reviews_v1
          WHERE organization_id=$1 AND review_kind='job' ORDER BY scope_key,subject_id,revision`,
        [fixture.org])).rows;
      throw new Error(`Formation origin failed: ${JSON.stringify({ body: formationOrigin.body, detail,
        census, reviewed })}`);
    }
    const formationPrivate = await privateResults(formationOrigin.body.data.id);
    expect(formationPrivate).toHaveLength(1);
    expect(formationPrivate[0]).toMatchObject({ alternativeKey: formationAlternative,
      scopeKey: formationScopeKey });
    expect(Number(formationPrivate[0].personMinutes)).toBe(12000);
    await withdrawAdoptedM24Basis(unscheduledWork, 'readiness');
    expect((await get(`/origins/${formationOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    expect((await post('/origins', formationOriginBody, formationOriginKey)).status).toBe(409);
    const refreshedM24 = await saveAdoptedM24Bases(unscheduledWork);
    const refreshedFormationJobs = formationJobs.map(job => job.appointmentId === unscheduledWork.appointment
      ? { ...job, definition: { ...job.definition, ...refreshedM24 } } : job);
    await packageReview(formationScope, refreshedFormationJobs, formationScopeKey);
    const recoveredFormationOrigin = await post('/origins', {
      reason: 'Save a new origin after explicit Mission24 rereview under current plan generations.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(recoveredFormationOrigin.status).toBe(201);

    // Crew formation is explicitly not applicable for this separate direct-
    // profile alternative. The same registered worker-hour target remains
    // measurable; empty crew and asset manifests are evidence, not omission.
    const directScopeKey = 'direct-profile-crew-na';
    const directAlternative = 'crew-not-applicable-proof';
    const directScope = { ...scopeDefinition, scopeKey: directScopeKey,
      alternativeKey: directAlternative,
      applicability: { crew: false, skill: true, workingHours: true, location: true,
        travel: false, vehicle: false, equipment: false },
      crewIds: [], crewRoleRequirements: [],
      crewAssignments: [
        { profileId: actor('member').actorUserId, crewId: null, role: 'technician' },
        { profileId: actor('admin').actorUserId, crewId: null, role: 'technician' },
      ],
      travelPairs: [], vehicleAssetIds: [], equipmentAssetIds: [], operatorProfileIds: [],
      assetAssignments: [], assetRequirements: { vehiclePerSeat: 0, equipmentPerSeat: 0 },
      assetCalendars: [] };
    const directJobs = [unscheduledWork, committedWork, zeroWork, laterWork].map(work => ({ appointmentId: work.appointment,
      definition: { ...unscheduledJobDefinition, scopeKey: directScopeKey,
        alternativeKey: directAlternative, appointmentId: work.appointment,
        assignmentId: work.assignment.id, crewApplicable: false, travelApplicable: false,
        ...(work === laterWork ? { locationKey: 'site-two' } : {}),
        vehicleApplicable: false, equipmentApplicable: false,
        vehicleAssetIds: [], equipmentAssetIds: [],
        equipmentBasis: { kind: 'not_applicable', receiptId: null, digest: null },
        readinessBasis: { kind: 'not_applicable', receiptId: null, digest: null },
        travelBasis: { kind: 'not_applicable', receiptId: null, digest: null } } }));
    await p5bReview('scope', formationScopeKey, null, formationScope, null, 'reject');
    await packageReview(directScope, directJobs, directScopeKey);
    const directOrigin = await post('/origins', {
      reason: 'Save an explicit crew-not-applicable direct-profile capacity alternative.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    if (directOrigin.status !== 201) {
      const diagnostic = await fixture.ownerPool.connect(); let detail;
      try { await diagnostic.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        detail = (await diagnostic.query(
          'SELECT canonical_forecast_constrained_capacity_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, `m26-p5b-direct-diag-${uuid()}`,
            'Diagnose the explicit crew-not-applicable direct-profile alternative.',
            'm26-constrained-capacity-origin-v1'])).rows[0].value;
      } catch (error) { detail = { code: error.code, message: error.message, where: error.where }; }
      finally { await diagnostic.query('ROLLBACK').catch(() => {}); diagnostic.release(); }
      throw new Error(`Direct-profile origin failed: ${JSON.stringify({ body: directOrigin.body, detail })}`);
    }
    const directPrivate = await privateResults(directOrigin.body.data.id);
    expect(directPrivate.some(value => value.alternativeKey === directAlternative &&
      value.scopeKey === directScopeKey && Number(value.personMinutes) >= 0)).toBe(true);

    // Effective people are unique within one alternative even when no crew,
    // operator or asset identity can trigger the other overlap guards.  Both
    // direct/direct and direct/crew reuse refuse atomically before an origin.
    const directDuplicateKey = 'direct-profile-person-only-overlap';
    const directDuplicate = { ...directScope, scopeKey: directDuplicateKey };
    await p5bReview('scope', directDuplicateKey, null, directDuplicate);
    const personOverlapCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    expect((await post('/origins', {
      reason: 'Refuse direct scopes that would reuse the same reviewed people.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(personOverlapCount);
    await p5bReview('scope', directDuplicateKey, null, directDuplicate, null, 'reject');

    const directCrewKey = 'direct-crew-person-only-overlap';
    const directCrewScope = { ...directScope, scopeKey: directCrewKey,
      applicability: { ...directScope.applicability, crew: true },
      crewIds: [crew.body.data.id],
      crewRoleRequirements: [{ role: 'technician', count: 1 }, { role: 'dispatcher', count: 1 }],
      crewAssignments: [
        { profileId: actor('member').actorUserId, crewId: crew.body.data.id, role: 'technician' },
        { profileId: actor('dispatcher').actorUserId, crewId: crew.body.data.id, role: 'dispatcher' },
      ] };
    await p5bReview('scope', directCrewKey, null, directCrewScope);
    expect((await post('/origins', {
      reason: 'Refuse direct and crew scopes that would reuse the same reviewed person.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(personOverlapCount);
    await p5bReview('scope', directCrewKey, null, directCrewScope, null, 'reject');

    // Two simultaneous crews retain separate routes and exact assignment
    // identities. A source-owned crew revision removes the earlier formation
    // support seats before these overlapping M22 commitments, so each person
    // and asset belongs to exactly one simultaneous route.
    const firstCrewForSeparateRoutes = await request(fixture.app)
      .put(`/api/workforce/crews/${crew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew', homeLocationId: 'headquarters',
        members: [{ profileId: actor('member').actorUserId, role: 'lead' },
          { profileId: actor('dispatcher').actorUserId, role: 'member' }] });
    expect(firstCrewForSeparateRoutes.status).toBe(200);
    const secondCrewUpdated = await request(fixture.app).put(`/api/workforce/crews/${secondCrew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew two', homeLocationId: 'headquarters', members: [
        { profileId: actor('admin').actorUserId, role: 'lead' },
        { profileId: actor('owner').actorUserId, role: 'member' },
      ] });
    expect(secondCrewUpdated.status).toBe(200);
    const crewWorkStart = new Date(logicalNow.getTime() + 86400000 + 11 * 3600000).toISOString();
    const crewOneWork = await createApprovedWork({ locationId: 'site-one', label: 'Crew one route proof',
      start: crewWorkStart, target: { kind: 'crew', id: crew.body.data.id } });
    const crewTwoWork = await createApprovedWork({ locationId: 'site-one', label: 'Crew two route proof',
      start: crewWorkStart, target: { kind: 'crew', id: secondCrew.body.data.id } });
    const multiScopeKey = 'simultaneous-multi-crew';
    const multiAlternative = 'multi-crew-proof';
    const multiScope = { ...formationScope, scopeKey: multiScopeKey, alternativeKey: multiAlternative,
      crewIds: [crew.body.data.id, secondCrew.body.data.id],
      crewRoleRequirements: [{ role: 'technician', count: 1 }, { role: 'dispatcher', count: 1 }],
      vehicleAssetIds: [vehicle.body.data.id, secondVehicle.body.data.id],
      equipmentAssetIds: [equipment.body.data.id, secondEquipment.body.data.id],
      crewAssignments: [
        { profileId: actor('member').actorUserId, crewId: crew.body.data.id, role: 'technician' },
        { profileId: actor('dispatcher').actorUserId, crewId: crew.body.data.id, role: 'dispatcher' },
        { profileId: actor('admin').actorUserId, crewId: secondCrew.body.data.id, role: 'technician' },
        { profileId: actor('owner').actorUserId, crewId: secondCrew.body.data.id, role: 'dispatcher' },
      ],
      assetAssignments: [
        { assetId: vehicle.body.data.id, crewId: crew.body.data.id, kind: 'vehicle',
          operatorProfileId: actor('member').actorUserId },
        { assetId: equipment.body.data.id, crewId: crew.body.data.id, kind: 'equipment',
          operatorProfileId: actor('dispatcher').actorUserId },
        { assetId: secondVehicle.body.data.id, crewId: secondCrew.body.data.id, kind: 'vehicle',
          operatorProfileId: actor('admin').actorUserId },
        { assetId: secondEquipment.body.data.id, crewId: secondCrew.body.data.id, kind: 'equipment',
          operatorProfileId: actor('owner').actorUserId },
      ], operatorProfileIds: [actor('member').actorUserId, actor('dispatcher').actorUserId,
        actor('admin').actorUserId, actor('owner').actorUserId] };
    const allMultiWorks = [unscheduledWork, committedWork, zeroWork, laterWork, crewOneWork, crewTwoWork];
    const multiJobs = allMultiWorks.map(work => ({ appointmentId: work.appointment, definition: {
      ...unscheduledJobDefinition, scopeKey: multiScopeKey, alternativeKey: multiAlternative,
      appointmentId: work.appointment, assignmentId: work.assignment.id,
      locationKey: work === laterWork ? 'site-two' : 'site-one',
      vehicleAssetIds: multiScope.vehicleAssetIds, equipmentAssetIds: multiScope.equipmentAssetIds,
    } }));
    await p5bReview('scope', directScopeKey, null, directScope, null, 'reject');
    const wrongScopeKey = 'wrong-crew-binding-proof';
    const wrongScope = { ...multiScope, scopeKey: wrongScopeKey, alternativeKey: 'wrong-crew-proof',
      crewIds: [crew.body.data.id], crewAssignments: multiScope.crewAssignments.slice(0, 2),
      vehicleAssetIds: [vehicle.body.data.id], equipmentAssetIds: [equipment.body.data.id],
      assetAssignments: multiScope.assetAssignments.slice(0, 2),
      operatorProfileIds: [actor('member').actorUserId, actor('dispatcher').actorUserId],
      assetCalendars: multiScope.assetCalendars.filter(calendar =>
        [vehicle.body.data.id, equipment.body.data.id].includes(calendar.assetId)) };
    await p5bReview('scope', wrongScopeKey, null, wrongScope);
    const wrongCrewToken = (await get(
      `/reviews/current?kind=job&scopeKey=${wrongScopeKey}&subjectId=${crewTwoWork.appointment}`)).body.data;
    expect((await post('/reviews', { kind: 'job', scopeKey: wrongScopeKey,
      subjectId: crewTwoWork.appointment, action: 'approve',
      expectedRevision: wrongCrewToken.expectedRevision, expectedDigest: wrongCrewToken.expectedDigest,
      definition: { ...multiJobs.at(-1).definition, scopeKey: wrongScopeKey, alternativeKey: 'wrong-crew-proof' },
      reason: 'Refuse a crew-two assignment under a crew-one-only reviewed scope.', confirmed: true,
      confirmationVersion: 'm26-constrained-capacity-review-v1' })).status).toBe(400);
    await p5bReview('scope', wrongScopeKey, null, wrongScope, null, 'reject');
    await packageReview(multiScope, multiJobs, multiScopeKey);
    const multiOrigin = await post('/origins', {
      reason: 'Save two simultaneous crew routes with disjoint reviewed people and assets.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(multiOrigin.status).toBe(201);
    const multiPrivate = await privateResults(multiOrigin.body.data.id);
    if (!multiPrivate.some(value => value.scopeKey === multiScopeKey && Number(value.personMinutes) === 11880)) {
      throw new Error(`Simultaneous multi-crew arithmetic mismatch: ${JSON.stringify(multiPrivate)}`);
    }

    // Complete the adopted-M24 lifecycle after all formation counterexamples
    // have run, so advancing the disposable chronology cannot shrink those
    // earlier future windows. Every currently approved work identity is
    // reviewed under this alternative before the later outcome is captured.
    await p5bReview('scope', multiScopeKey, null, multiScope, null, 'reject');
    const outcomeFormationScope = { ...multiScope, scopeKey: formationScopeKey,
      alternativeKey: formationAlternative,
      travelPairs: multiScope.travelPairs.map(pair => ({ ...pair, durationMinutes: 0 })) };
    const outcomeFormationJobs = allMultiWorks.map(work => ({ appointmentId: work.appointment,
      definition: { ...unscheduledJobDefinition, scopeKey: formationScopeKey,
        alternativeKey: formationAlternative, appointmentId: work.appointment,
        assignmentId: work.assignment.id, locationKey: work === laterWork ? 'site-two' : 'site-one',
        vehicleAssetIds: formationScope.vehicleAssetIds,
        equipmentAssetIds: formationScope.equipmentAssetIds,
        ...(work === unscheduledWork ? refreshedM24 : {}) } }));
    await packageReview(outcomeFormationScope, outcomeFormationJobs, formationScopeKey);
    const m24OutcomeOrigin = await post('/origins', {
      reason: 'Save the adopted-Mission24 formation before its distinct later outcome.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(m24OutcomeOrigin.status).toBe(201);
    await setClock(m24OutcomeOrigin.body.data.horizonEndsAt);
    const formationOutcome = await post(`/origins/${m24OutcomeOrigin.body.data.id}/outcomes`, {},
      `m26-p5b-formation-outcome-${uuid()}`);
    expect(formationOutcome.status).toBe(201);
    const formationEvaluation = await post(`/origins/${m24OutcomeOrigin.body.data.id}/evaluations`,
      { outcomeId: formationOutcome.body.data.id }, `m26-p5b-formation-evaluation-${uuid()}`);
    expect(formationEvaluation.status).toBe(201);
    await withdrawAdoptedM24Basis(unscheduledWork, 'travel');
    expect((await get(`/origins/${m24OutcomeOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    expect((await get(`/origins/${m24OutcomeOrigin.body.data.id}/outcomes/${formationOutcome.body.data.id}`))
      .body.data.state).toBe('constrained_capacity_outcome_stale');
    expect((await get(`/origins/${m24OutcomeOrigin.body.data.id}/evaluations/${formationEvaluation.body.data.id}`))
      .body.data.state).toBe('constrained_capacity_evaluation_stale');

    const postM24Start = new Date(logicalNow.getTime() + 1000);
    await setClock(postM24Start);
    const postM24End = new Date(postM24Start.getTime() + 31 * 86400000);
    const postM24Intervals = Array.from({ length: 10 }, (_, index) => ({ kind: 'available',
      start: new Date(postM24Start.getTime() + index * 86400000 + 9 * 3600000).toISOString(),
      end: new Date(postM24Start.getTime() + index * 86400000 + 19 * 3600000).toISOString() }));
    for (const name of ['member', 'admin', 'dispatcher', 'owner']) {
      await replaceAvailability(actor(name).actorUserId, postM24Start, postM24End, postM24Intervals);
    }
    await advance(1);
    expect((await p5aPost('/epochs', { reason: 'Begin new complete capacity coverage after Mission24 correction.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' })).status).toBe(201);
    for (const [name, role] of [['owner', 'dispatcher'], ['admin', 'technician'], ['dispatcher', 'dispatcher'],
      ['member', 'technician'], ['viewer', 'employee']]) {
      await refreshP5aReview('role_qualification', actor(name).actorUserId, role);
    }
    for (const name of ['member', 'admin', 'dispatcher', 'owner']) {
      await refreshP5aReview('availability_basis', actor(name).actorUserId);
    }
    await refreshP5aReview('capacity_role_scope', null, 'technician');
    const latestM24 = await saveAdoptedM24Bases(unscheduledWork);
    const latestFormationJobs = outcomeFormationJobs.map(job => job.appointmentId === unscheduledWork.appointment
      ? { ...job, definition: { ...job.definition, ...latestM24 } } : job);
    const postM24Scope = { ...outcomeFormationScope, assetCalendars: [vehicle.body.data.id,
      secondVehicle.body.data.id, equipment.body.data.id, secondEquipment.body.data.id]
      .map(assetId => ({ assetId, availableIntervals: [{ start: postM24Start.toISOString(),
        end: postM24End.toISOString() }], committedIntervals: [] })) };
    await packageReview(postM24Scope, latestFormationJobs, formationScopeKey);
    const postM24Origin = await post('/origins', {
      reason: 'Save a new future origin after full Mission24 and installed-source recovery.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(postM24Origin.status).toBe(201);

    // Scope uniqueness is a common interval invariant for the entire
    // alternative, not a final-cutoff comparison. Two initially disjoint
    // outputs are saved. A genuine crew update and explicit scope rereview
    // transiently make the crew scope share the direct scope's technician,
    // then a second human review restores the original population. The saved
    // origin remains permanently stale and cannot persist an outcome because
    // the elapsed overlap is immutable evidence.
    await p5bReview('scope', formationScopeKey, null, postM24Scope, null, 'reject');
    const isolatedCrewMembers = [
      { profileId: actor('owner').actorUserId, role: 'lead' },
      { profileId: actor('dispatcher').actorUserId, role: 'member' },
    ];
    expect((await request(fixture.app).put(`/api/workforce/crews/${crew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew', homeLocationId: 'headquarters',
        members: isolatedCrewMembers })).status).toBe(200);
    expect((await request(fixture.app).put(`/api/workforce/crews/${secondCrew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew two', homeLocationId: 'headquarters',
        members: isolatedCrewMembers })).status).toBe(200);
    await advance(1); await p5bEpoch(); await advance(1);
    await p5bReview('method', null, null, methodDefinition);
    const overlapAlternative = 'transient-overlap-proof';
    const overlapDirectKey = 'transient-direct-member';
    const overlapCrewKey = 'transient-dispatcher-crew';
    const overlapDirectScope = { ...directScope, scopeKey: overlapDirectKey,
      alternativeKey: overlapAlternative };
    const overlapCrewScope = { ...directScope, scopeKey: overlapCrewKey,
      alternativeKey: overlapAlternative, role: 'dispatcher',
      applicability: { ...directScope.applicability, crew: true, skill: false }, skillIds: [],
      crewIds: [crew.body.data.id, secondCrew.body.data.id],
      crewRoleRequirements: [{ role: 'dispatcher', count: 2 }],
      crewAssignments: [
        { profileId: actor('owner').actorUserId, crewId: crew.body.data.id, role: 'dispatcher' },
        { profileId: actor('dispatcher').actorUserId, crewId: crew.body.data.id, role: 'dispatcher' },
        { profileId: actor('owner').actorUserId, crewId: secondCrew.body.data.id, role: 'dispatcher' },
        { profileId: actor('dispatcher').actorUserId, crewId: secondCrew.body.data.id, role: 'dispatcher' },
      ] };
    await p5bReview('scope', overlapDirectKey, null, overlapDirectScope);
    await p5bReview('scope', overlapCrewKey, null, overlapCrewScope);
    const reviewOverlapJob = async (work, selectedScopeKey, selectedScope) => p5bReview('job',
      selectedScopeKey, work.appointment, {
        ...unscheduledJobDefinition, scopeKey: selectedScopeKey, alternativeKey: overlapAlternative,
        appointmentId: work.appointment, assignmentId: work.assignment.id,
        crewApplicable: selectedScope.applicability.crew, skillApplicable: selectedScope.applicability.skill,
        locationKey: work === laterWork ? 'site-two' : 'site-one', vehicleApplicable: false,
        equipmentApplicable: false, travelApplicable: false, vehicleAssetIds: [], equipmentAssetIds: [],
        equipmentBasis: { kind: 'not_applicable', receiptId: null, digest: null },
        readinessBasis: { kind: 'not_applicable', receiptId: null, digest: null },
        travelBasis: { kind: 'not_applicable', receiptId: null, digest: null },
      });
    for (const work of allMultiWorks) {
      const crewAssigned = work === crewOneWork || work === crewTwoWork;
      const selectedScopeKey = crewAssigned ? overlapCrewKey : overlapDirectKey;
      const selectedScope = crewAssigned ? overlapCrewScope : overlapDirectScope;
      await reviewOverlapJob(work, selectedScopeKey, selectedScope);
    }
    const transientOriginKey = `m26-p5b-transient-origin-${uuid()}`;
    const transientOriginBody = { reason: 'Save disjoint direct and crew outputs before prospective rereviews.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' };
    const transientOrigin = await post('/origins', transientOriginBody, transientOriginKey);
    expect(transientOrigin.status).toBe(201);
    const transientOutcomeCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_outcomes_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    await setClock(new Date(new Date(transientOrigin.body.data.predictionCutoffAt).getTime() + 86400000));
    expect((await request(fixture.app).put(`/api/workforce/crews/${secondCrew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew two', homeLocationId: 'headquarters',
        members: [...isolatedCrewMembers, { profileId: actor('member').actorUserId, role: 'member' }] })).status).toBe(200);
    await p5bReview('scope', overlapCrewKey, null, overlapCrewScope);
    await reviewOverlapJob(crewOneWork, overlapCrewKey, overlapCrewScope);
    await reviewOverlapJob(crewTwoWork, overlapCrewKey, overlapCrewScope);
    expect((await get(`/origins/${transientOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    await setClock(new Date(new Date(transientOrigin.body.data.predictionCutoffAt).getTime() + 2 * 86400000));
    expect((await request(fixture.app).put(`/api/workforce/crews/${secondCrew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew two', homeLocationId: 'headquarters',
        members: isolatedCrewMembers })).status).toBe(200);
    await p5bReview('scope', overlapCrewKey, null, overlapCrewScope);
    await reviewOverlapJob(crewOneWork, overlapCrewKey, overlapCrewScope);
    await reviewOverlapJob(crewTwoWork, overlapCrewKey, overlapCrewScope);
    expect((await get(`/origins/${transientOrigin.body.data.id}`)).body.data.state)
      .toBe('constrained_capacity_origin_stale');
    expect((await post('/origins', transientOriginBody, transientOriginKey)).status).toBe(409);
    await setClock(transientOrigin.body.data.horizonEndsAt);
    expect((await post(`/origins/${transientOrigin.body.data.id}/outcomes`, {},
      `m26-p5b-transient-outcome-${uuid()}`)).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_outcomes_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(transientOutcomeCount);

    const overlapRecoveryStart = new Date(logicalNow.getTime() + 1000);
    await setClock(overlapRecoveryStart);
    const overlapRecoveryEnd = new Date(overlapRecoveryStart.getTime() + 31 * 86400000);
    const overlapRecoveryIntervals = Array.from({ length: 10 }, (_, index) => ({ kind: 'available',
      start: new Date(overlapRecoveryStart.getTime() + index * 86400000 + 9 * 3600000).toISOString(),
      end: new Date(overlapRecoveryStart.getTime() + index * 86400000 + 19 * 3600000).toISOString() }));
    for (const name of ['member', 'admin', 'dispatcher', 'owner']) {
      await replaceAvailability(actor(name).actorUserId, overlapRecoveryStart, overlapRecoveryEnd,
        overlapRecoveryIntervals);
    }
    await advance(1);
    expect((await p5aPost('/epochs', { reason: 'Begin complete recovery coverage after the invalid scope interval.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' })).status).toBe(201);
    for (const [name, role] of [['owner', 'dispatcher'], ['admin', 'technician'], ['dispatcher', 'dispatcher'],
      ['member', 'technician'], ['viewer', 'employee']]) {
      await refreshP5aReview('role_qualification', actor(name).actorUserId, role);
    }
    for (const name of ['member', 'admin', 'dispatcher', 'owner']) {
      await refreshP5aReview('availability_basis', actor(name).actorUserId);
    }
    await refreshP5aReview('capacity_role_scope', null, 'technician');
    await advance(1); await p5bEpoch(); await advance(1);
    await p5bReview('method', null, null, methodDefinition);
    await p5bReview('scope', overlapDirectKey, null, overlapDirectScope);
    await p5bReview('scope', overlapCrewKey, null, overlapCrewScope);
    for (const work of allMultiWorks) {
      const crewAssigned = work === crewOneWork || work === crewTwoWork;
      const selectedScopeKey = crewAssigned ? overlapCrewKey : overlapDirectKey;
      const selectedScope = crewAssigned ? overlapCrewScope : overlapDirectScope;
      await reviewOverlapJob(work, selectedScopeKey, selectedScope);
    }
    const overlapRecoveryOrigin = await post('/origins', {
      reason: 'Save a new origin only after a new prospective epoch and current disjoint reviews.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(overlapRecoveryOrigin.status).toBe(201);
    expect((await request(fixture.app).put(`/api/workforce/crews/${crew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew', homeLocationId: 'headquarters',
        members: [{ profileId: actor('member').actorUserId, role: 'lead' },
          { profileId: actor('dispatcher').actorUserId, role: 'member' }] })).status).toBe(200);
    expect((await request(fixture.app).put(`/api/workforce/crews/${secondCrew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew two', homeLocationId: 'headquarters',
        members: [{ profileId: actor('admin').actorUserId, role: 'lead' },
          { profileId: actor('owner').actorUserId, role: 'member' }] })).status).toBe(200);

    // The exact M24 estimate population is part of every reviewed job source,
    // even when a job uses the narrow Part5B owner-reviewed bases. A second
    // immutable estimate for one opportunity is an ambiguous owning-source
    // population. The guarded read waits for the genuine estimate writer,
    // then reports the old origin stale; its exact-key replay cannot revive it
    // and the failed replay inserts no partial receipt. Canonical estimate
    // rows are immutable, so recovery honestly requires source reconciliation
    // outside this forecast authority followed by new job reviews and origin.
    const estimateWriter = await fixture.ownerPool.connect();
    const estimateReadCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    try {
      const operationId = uuid(); const graphId = uuid(); const estimateId = uuid();
      const estimateFingerprint = crypto.createHash('sha256').update(uuid()).digest('hex');
      await estimateWriter.query('BEGIN');
      await estimateWriter.query(
        `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
           payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
         VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
        [operationId, fixture.org, graphId, estimateFingerprint]);
      await estimateWriter.query(
        `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,
           calculation_version,normalized_input_fingerprint,business_profile_version,business_profile_hash,
           currency,customer_price,line_items,calculation_output,snapshot_digest)
         VALUES($1,$2,$3,$4,$5,'mounted-ambiguous-v1',$6,'org-profile-v1',$6,'USD',100,'[]','{}',$6)`,
        [estimateId, fixture.org, operationId, graphId, zeroWork.opportunity, estimateFingerprint]);
      const blockedFormationRead = get(`/origins/${formationOrigin.body.data.id}`).then(value => value);
      await waitForAdvisoryWaiters(1);
      await estimateWriter.query('COMMIT');
      expect((await blockedFormationRead).body.data.state).toBe('constrained_capacity_origin_stale');
    } catch (error) {
      await estimateWriter.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { estimateWriter.release(); }
    expect((await post('/origins', formationOriginBody, formationOriginKey)).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(estimateReadCount);

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
