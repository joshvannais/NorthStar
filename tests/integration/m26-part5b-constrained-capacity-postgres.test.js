'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastConstrainedCapacityRouter } = require('../../src/routes/forecastConstrainedCapacity');
const { createForecastWorkloadCapacityRouter } = require('../../src/routes/forecastWorkloadCapacity');
const { createForecastCapacityAdvisoryRouter } = require('../../src/routes/forecastCapacityAdvisory');
const { CapacityAdvisoryContinuationWorker } = require('../../src/services/capacityAdvisoryContinuationWorker');
const { ingestLead } = require('../../src/services/canonicalGraphService');

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
    if (response.status !== 200) throw new Error(
      `Availability replacement failed: ${JSON.stringify({ status: response.status, body: response.body,
        profileId, start, end, intervalCount: intervals.length })}`);
  }

  async function p5aPost(path, body, key = `m26-p5b-p5a-${uuid()}`) {
    return request(app).post('/api/v1/forecast/workload-capacity' + path)
      .set('X-Test-Actor', 'owner').set('X-CSRF-Token', actor('owner').csrfToken)
      .set('Idempotency-Key', key).send(body);
  }

  async function p5aReview(body, token = null) {
    const response = await p5aPost('/reviews', {
      kind: body.kind, target: body.target || TARGET, subjectId: body.subjectId ?? null, role: body.role ?? null,
      action: 'approve', expectedRevision: token?.expectedRevision ?? 0,
      expectedDigest: token?.expectedDigest ?? 'none', remainingPersonMinutes: body.remainingPersonMinutes ?? null,
      reason: 'Owner explicitly reviewed this installed-source capacity basis.', confirmed: true,
      confirmationVersion: 'm26-workload-capacity-review-v1',
    });
    if (response.status !== 201) throw new Error(`Part5A review failed: ${JSON.stringify({ body: response.body,
      request: body, token })}`);
  }

  async function refreshP5aReview(kind, subjectId = null, role = null, target = TARGET,
    remainingPersonMinutes = null) {
    const current = await request(app).get('/api/v1/forecast/workload-capacity/reviews/current')
      .set('X-Test-Actor', 'owner').query({ kind, target,
        subjectId: subjectId || 'none', role: kind === 'capacity_role_scope' ? 'none' : (role || 'none') });
    if (current.status !== 200) throw new Error(`Part5A current review failed: ${JSON.stringify({ kind,
      subjectId, role, status: current.status, body: current.body })}`);
    const token = current.body.data;
    if (token.sourceCurrent) return token;
    await p5aReview({ kind, target, subjectId, role: token.role ?? role, remainingPersonMinutes }, token);
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
      if (preview.status !== 201) throw new Error(
        `Reschedule ${action} preview failed: ${JSON.stringify({ status: preview.status,
          body: preview.body, before, scheduledStart, scheduledEnd })}`);
      const approval = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${work.appointment}/mutation-approvals`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5b-reschedule-${uuid()}`)
        .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason: label });
      if (approval.status !== 200) throw new Error(
        `Reschedule ${action} approval failed: ${JSON.stringify({ status: approval.status,
          body: approval.body, preview: preview.body.data })}`);
      receipt = approval.body.data;
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

  async function createAcceptedApprovedWork({ start, locationId, label, target = null }) {
    const graphKey = `m26-p5c-canonical-graph-${uuid()}`;
    const scheduledStart = new Date(start);
    const scheduledEnd = new Date(scheduledStart.getTime() + 3600000);
    const activeProfile = (await fixture.ownerPool.query(
      `SELECT id,version_label,rtrim(normalized_profile_hash) profile_hash
         FROM canonical_business_profiles
        WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org])).rows[0];
    expect(activeProfile).toBeTruthy();
    const ingested = await ingestLead(fixture.runtimePool, {
      tenantContext: { organizationId: fixture.org, trusted: true },
      idempotencyKey: graphKey,
      sourceVersion: 'm26-capacity-advisory-canonical-lead-v1',
      businessProfileAuthorityId: activeProfile.id,
      businessProfileAuthorityVersion: activeProfile.version_label,
      businessProfileAuthorityHash: activeProfile.profile_hash,
      external: { customerId: graphKey, callId: graphKey, transcriptId: graphKey,
        communicationId: graphKey, appointmentId: graphKey },
      customer: { name: label, phone: `+1555${crypto.randomInt(1000000, 9999999)}`,
        email: `${graphKey}@example.test`,
        address: { line1: '1 Mounted Evidence Way', city: 'Boston', state: 'MA', postalCode: '02108' } },
      transcript: [{ turnId: 'scope', speaker: 'customer',
        text: 'Please schedule this exact synthetic installed-source service visit.' }],
      facts: [{ variable: 'serviceLocation', normalizedValue: locationId,
        evidenceText: 'this exact synthetic installed-source service visit', speaker: 'customer',
        evidenceTurnId: 'scope', confidence: 1 }],
      service: { key: 'plumbing', scope: { locationId, sourcePurpose: 'm26-part5c-mounted-evidence' } },
      scheduledAppointment: { start: scheduledStart.toISOString(), end: scheduledEnd.toISOString(),
        status: 'scheduled' },
    });
    if (ingested.status !== 201) throw new Error(
      `Part5C canonical lead ingestion failed: ${JSON.stringify(ingested)}`);
    const appointment = ingested.body.ids.appointment;
    const opportunity = ingested.body.ids.opportunity;
    for (const action of ['assign', 'dispatch']) {
      const before = (await fixture.ownerPool.query(
        `SELECT revision,rtrim(canonical_digest) digest,appointment_status,scheduled_start,scheduled_end
           FROM canonical_schedule_assignments
          WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, appointment])).rows[0];
      const preview = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
        .set(actor('owner').session.headers).send({
          expectedRevision: Number(before.revision), expectedDigest: before.digest, expectedTimeZone: 'UTC',
          action, target: target || { kind: 'profile', id: actor('member').actorUserId },
          scheduledStart: new Date(before.scheduled_start).toISOString(),
          scheduledEnd: new Date(before.scheduled_end).toISOString(),
          appointmentStatus: before.appointment_status,
          reason: 'Explicit guarded scheduling action for accepted Part5C demand evidence.',
        });
      if (preview.status !== 201) throw new Error(
        `Part5C accepted work ${action} preview failed: ${JSON.stringify(preview.body)}`);
      const approval = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5c-schedule-${uuid()}`)
        .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
          reason: 'Explicit guarded scheduling action for accepted Part5C demand evidence.' });
      if (approval.status !== 200) throw new Error(
        `Part5C accepted work ${action} approval failed: ${JSON.stringify(approval.body)}`);
    }
    const assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest
         FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, appointment])).rows[0];
    const owningClock = new Date((await fixture.ownerPool.query('SELECT clock_timestamp() value')).rows[0].value);
    if (owningClock.getTime() >= logicalNow.getTime()) await setClock(new Date(owningClock.getTime() + 1000));
    return { appointment, opportunity, assignment };
  }

  async function completeApprovedWork(work, finalAction = 'complete', workerName = 'member') {
    const operations = require('../../src/operations/repository');
    const { normalizeCompletionAction } = require('../../src/completion/contract');
    const { mutateCompletion } = require('../../src/completion/repository');
    const owner = actor('owner');
    const worker = actor(workerName);
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

  async function saveLaborAndApprovePersonPlan(work, workerHours = '70') {
    const estimate = (await fixture.ownerPool.query(
      'SELECT id FROM canonical_estimates WHERE organization_id=$1 AND opportunity_id=$2',
      [fixture.org, work.opportunity])).rows[0];
    expect(estimate).toBeTruthy();
    const route = `/api/v1/canonical/estimates/${estimate.id}`;
    const read = async () => {
      const response = await request(fixture.app).get(`${route}/review`).set(actor('owner').session.headers);
      expect(response.status).toBe(200); return response.body.data;
    };
    let review = await read();
    if (Number(review.decisions.writeBasis.revision) === 0) {
      const decision = await request(fixture.app).post(`${route}/decisions`)
        .set(actor('owner').session.headers).set('Idempotency-Key', `m26-p5c-estimate-${uuid()}`).send({
          action: 'approve', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
          scopeSummary: 'Owner-reviewed exact synthetic capacity-advice workload.',
          priceBeforeTax: '500.00', currency: review.currency,
          reason: 'Owner approves this exact synthetic estimate before accepting booked work.',
          confirmed: true, confirmationVersion: 'estimate-quote-preparation-v1' });
      if (decision.status !== 201) throw new Error(
        `Part5C estimate decision failed: ${JSON.stringify({ status: decision.status, body: decision.body })}`);
      review = await read();
    }
    const labor = require('../helpers/m24-labor-input');
    const laborInputs = labor.inputs([labor.line({ task: 'Exact advisory workload basis', basis: 'worker_hours',
      workerHours, people: null, elapsedHours: null })]);
    laborInputs.serviceKey = review.materialSourceContext.serviceKey;
    const body = { action: 'save', expectedRevision: review.laborPlans.current?.revision || 0,
      expectedDigest: review.laborPlans.current?.digest || 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: laborInputs,
      currency: review.currency, reason: 'Review the exact internal worker-hour plan for capacity advice.',
      confirmed: true, confirmationVersion: 'estimate-labor-plan-v1' };
    let response = await request(fixture.app).post(`${route}/labor-plan-preview`)
      .set(actor('owner').session.headers).send(body);
    expect(response.status).toBe(200);
    body.inputs.assessment = { ...response.body.data.result.assessment, acknowledged: true,
      explanation: 'Owner reviewed exact internal worker-hour assumptions for this synthetic installed-source proof.' };
    response = await request(fixture.app).post(`${route}/labor-plans`)
      .set(actor('owner').session.headers).set('Idempotency-Key', uuid()).send(body);
    if (response.status !== 201) throw new Error(
      `Part5C labor plan failed: ${JSON.stringify({ status: response.status, body: response.body,
        preview: body.inputs.assessment })}`);
    review = await read();
    const assignment = (await fixture.ownerPool.query(
      `SELECT id,revision,rtrim(canonical_digest) digest FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, work.appointment])).rows[0];
    const currentPersonPlan = (await fixture.ownerPool.query(
      `SELECT id,rtrim(digest) digest
         FROM canonical_forecast_current_backlog_person_plan_reviews
        WHERE organization_id=$1 AND appointment_id=$2 ORDER BY revision DESC LIMIT 1`,
      [fixture.org, work.appointment])).rows[0] || null;
    const personPlanBody = {
      action: 'approve', expectedCurrentReviewId: currentPersonPlan?.id || null,
      expectedCurrentReviewDigest: currentPersonPlan?.digest || 'none',
      assignmentId: assignment.id, expectedAssignmentRevision: Number(assignment.revision),
      expectedAssignmentDigest: assignment.digest, estimateId: estimate.id,
      laborPlanId: review.laborPlans.current.id,
      expectedLaborPlanRevision: Number(review.laborPlans.current.revision),
      expectedLaborPlanDigest: review.laborPlans.current.digest,
      reason: 'Owner reviewed this exact work identity and worker-hour plan for Part5C.', confirmed: true,
      confirmationVersion: 'm26-current-backlog-person-plan-v1' };
    const personPlanKey = `m26-p5c-person-plan-${uuid()}`;
    response = await request(fixture.app)
      .post(`/api/v1/forecast/current-backlog/person-plan-sources/${work.appointment}/reviews`)
      .set(actor('owner').session.headers).set('Idempotency-Key', personPlanKey).send(personPlanBody);
    if (response.status !== 201) {
      let diagnostic = null; const client = await fixture.runtimePool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query(
          'SELECT canonical_forecast_backlog_person_plan_mutate($1,$2,$3,$4,$5,$6,$7,$8)',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, personPlanKey,
            work.appointment, personPlanBody]);
      } catch (error) {
        diagnostic = { code: error.code, message: error.message, detail: error.detail,
          hint: error.hint, where: error.where };
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      throw new Error(
        `Part5C person-plan review failed: ${JSON.stringify({ status: response.status, body: response.body,
          assignment, estimateId: estimate.id, laborPlan: review.laborPlans.current, diagnostic })}`);
    }
    return { estimateId: estimate.id, laborPlan: review.laborPlans.current, assignment };
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

  const p5cPost = (path, body, key = `m26-p5c-${uuid()}`, name = 'owner') => request(app)
    .post('/api/v1/forecast/capacity-advice' + path).set('X-Test-Actor', name)
    .set('X-CSRF-Token', actor(name).csrfToken).set('Idempotency-Key', key).send(body);
  const p5cGet = (path, name = 'owner') => request(app)
    .get('/api/v1/forecast/capacity-advice' + path).set('X-Test-Actor', name);

  async function p5cReview(kind, { alternativeKey = null, scopeKey = null, role = null,
    subjectId = null, definition = {}, action = 'approve', continuationId = null,
    correctionOfReviewId = null, key = `m26-p5c-${uuid()}` } = {}) {
    const query = { kind, alternativeKey: alternativeKey || 'none', scopeKey: scopeKey || 'none',
      role: role || 'none', subjectId: subjectId || 'none' };
    const current = await p5cGet('/reviews/current?' + new URLSearchParams(query).toString());
    expect(current.status).toBe(200);
    const token = current.body.data;
    const body = { kind, alternativeKey, scopeKey, role, subjectId,
      action, expectedRevision: token.expectedRevision, expectedDigest: token.expectedDigest, definition,
      reason: `Owner explicitly reviewed the exact ${kind.replaceAll('_', ' ')} advisory authority.`,
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-review-v1' };
    if (continuationId || correctionOfReviewId) Object.assign(body, { continuationId, correctionOfReviewId });
    const response = await p5cPost('/reviews', body, key);
    if (response.status !== 201) throw new Error(
      `Part5C ${kind} review failed: ${JSON.stringify({ status: response.status, body: response.body, definition })}`);
    return response.body.data;
  }

  const p5cDefinition = async (alternativeKey, originId = null) => {
    const instant = logicalNow;
    const workload = originId
      ? (await fixture.ownerPool.query(
        `SELECT window_value.evidence->'backlog'->'rows' rows
           FROM canonical_forecast_capacity_advisory_origins_v1 advice
           JOIN canonical_forecast_workload_capacity_evaluations_v1 evaluation_value
             ON evaluation_value.organization_id=advice.organization_id
            AND evaluation_value.origin_id=(advice.input_manifest#>>'{workloadOrigin,id}')::uuid
           JOIN canonical_forecast_workload_capacity_windows_v1 window_value
             ON window_value.organization_id=evaluation_value.organization_id
            AND window_value.id=evaluation_value.outcome_window_id
          WHERE advice.organization_id=$1 AND advice.id=$2
          ORDER BY evaluation_value.revision DESC LIMIT 1`, [fixture.org, originId])).rows[0]?.rows
      : (await fixture.ownerPool.query(
        `SELECT public.canonical_forecast_workload_capacity_v1_backlog_evidence($1,$2)->'rows' rows`,
        [fixture.org, instant])).rows[0]?.rows;
    const periodStart = originId ? (await fixture.ownerPool.query(
      'SELECT prediction_cutoff_at FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1 AND id=$2',
      [fixture.org, originId])).rows[0].prediction_cutoff_at : null;
    let constraint;
    try {
      constraint = await fixture.ownerPool.query(
        `SELECT public.canonical_forecast_constrained_capacity_v1_complete_input($1,$2,$3) value`,
        [fixture.org, instant, periodStart]);
    } catch (error) {
      const diagnostic = (await fixture.ownerPool.query(
        `WITH census AS (SELECT public.canonical_forecast_constrained_capacity_v1_work_census($1,$2) value),
         scopes AS (SELECT jsonb_agg(jsonb_build_object('scopeKey',scope_key,'action',action,'revision',revision)
           ORDER BY scope_key) value FROM (SELECT DISTINCT ON(scope_key) scope_key,action,revision
            FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1 AND review_kind='scope'
            ORDER BY scope_key,revision DESC) current_scopes),
         jobs AS (SELECT jsonb_agg(jsonb_build_object('subjectId',subject_id,'scopeKey',scope_key,'action',action,
           'revision',revision,'covers',canonical_forecast_constrained_capacity_v1_job_review_covers($1,value,$2))
           ORDER BY subject_id,scope_key) value FROM (SELECT DISTINCT ON(scope_key,subject_id) *
            FROM canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=$1 AND review_kind='job'
            ORDER BY scope_key,subject_id,revision DESC) value)
         SELECT jsonb_build_object('census',(SELECT value FROM census),'scopes',(SELECT value FROM scopes),
           'jobs',(SELECT value FROM jobs)) value`, [fixture.org, instant])).rows[0].value;
      throw new Error(`Part5C constraint input unavailable: ${JSON.stringify({
        code: error.code, message: error.message, instant, periodStart, diagnostic })}`);
    }
    const input = constraint.rows[0].value;
    const scopes = input.scopes.filter(item => item.alternativeKey === alternativeKey);
    const jobs = input.jobs.filter(item => item.alternativeKey === alternativeKey);
    const allocations = workload.filter(item => Number(item.personMinutes) > 0).map(item => {
      const job = jobs.find(candidate => candidate.appointmentId === item.appointmentId &&
        candidate.assignmentId === item.assignmentId);
      if (!job) throw new Error(`Missing exact Part5B job mapping for ${item.appointmentId}/${item.assignmentId}`);
      return { appointmentId: item.appointmentId, assignmentId: item.assignmentId,
        scopeKey: job.scopeKey, role: job.assignedRole, personMinutes: Number(item.personMinutes) };
    });
    const scopeApplicability = [];
    for (const item of scopes) {
      const review = (await fixture.ownerPool.query(
        `SELECT definition FROM canonical_forecast_constrained_capacity_reviews_v1
          WHERE organization_id=$1 AND id=$2`, [fixture.org, item.reviewId])).rows[0];
      if (!review) throw new Error(`Missing exact Part5B scope review ${item.reviewId}`);
      const definition = review.definition;
      scopeApplicability.push({ scopeKey: item.scopeKey, targetRole: definition.role,
        targetSeats: Number(definition.crewRoleRequirements.find(row => row.role === definition.role)?.count || 1),
        supportRoles: definition.crewRoleRequirements.filter(row => row.role !== definition.role)
          .map(row => ({ role: row.role, count: Number(row.count) })),
        operatorRoles: [...new Set(definition.crewAssignments
          .filter(row => definition.operatorProfileIds.includes(row.profileId))
          .map(row => row.role))].sort() });
    }
    return { methodVersion: 'm26-capacity-advisory-demand-allocation-v1', alternativeKey,
      allocations, scopeApplicability };
  };

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
    app.use('/api/v1/forecast/capacity-advice', createForecastCapacityAdvisoryRouter({ auth,
      throttle: bypass, writeThrottle: bypass, poolProvider: () => fixture.runtimePool }));
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 60000);

  test('guarded seven-dimension origin, later outcome and evaluation preserve role-worker-hour supply', async () => {
    // Keep every genuine owning-source observation before the first modeled
    // interval. The disposable clock remains future-only and owner controlled;
    // it does not backdate any source receipt or alter production clock paths.
    const start = new Date((await fixture.ownerPool.query(
      "SELECT date_trunc('second',clock_timestamp()) value")).rows[0].value);
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
    const firstAvailabilityDay = new Date(start.getTime() + 86400000); firstAvailabilityDay.setUTCHours(0, 0, 0, 0);
    let intervals = Array.from({ length: 10 }, (_, index) => ({ kind: 'available',
      start: new Date(firstAvailabilityDay.getTime() + index * 86400000 + 12 * 3600000).toISOString(),
      end: new Date(firstAvailabilityDay.getTime() + index * 86400000 + 22 * 3600000).toISOString() }));
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
    if (Number(freeResult[0].personMinutes) !== 6000) {
      const supportCapacity = (await fixture.ownerPool.query(
        "SELECT canonical_forecast_workload_capacity_v1_capacity_calculation($1,$2,$3,$2,'dispatcher') value",
        [fixture.org, logicalNow, new Date(logicalNow.getTime() + 30 * 86400000)])).rows[0].value;
      const intervalSegments = [];
      for (const interval of intervals) intervalSegments.push((await fixture.ownerPool.query(
        `SELECT canonical_forecast_constrained_capacity_v1_scope_segment($1,review_value,$2,$3,'[]'::jsonb) value
           FROM canonical_forecast_constrained_capacity_reviews_v1 review_value
          WHERE review_value.organization_id=$1 AND review_value.review_kind='scope'
            AND review_value.scope_key=$4 ORDER BY review_value.revision DESC LIMIT 1`,
        [fixture.org, interval.start, interval.end, scopeKey])).rows[0].value);
      throw new Error(`Free-capacity arithmetic mismatch: ${JSON.stringify({ start, logicalNow,
        result: freeResult[0], baseCapacity, supportCapacity, intervalSegments, freeInput })}`);
    }

    const firstKey = `m26-p5b-first-origin-${uuid()}`;
    const firstBody = { reason: 'Save the exact declared seven-dimension compatible role supply.',
      confirmed: true, confirmationVersion: 'm26-constrained-capacity-origin-v1' };
    // The production-clock proof must issue after every genuine prospective
    // source/review decision. Wait for wall time to pass the disposable logical
    // clock instead of backdating evidence or carrying a test clock into capture.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const wallNow = new Date((await fixture.ownerPool.query('SELECT clock_timestamp() value')).rows[0].value);
      if (wallNow.getTime() > logicalNow.getTime()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (attempt === 99) throw new Error('Production clock did not pass the prospective source decisions');
    }
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
    // Keep the remaining mounted chronology independent of the wall-clock
    // hour at which Jest happens to run. The genuine no-clock-row origin above
    // remains bounded by production time; subsequent owner-only disposable
    // evidence advances to the next 05:00 UTC so every +10-hour commitment and
    // return leg falls inside the already-declared 12:00-22:00 UTC intervals.
    const stableScenarioStart = new Date(productionCutoff);
    stableScenarioStart.setUTCDate(stableScenarioStart.getUTCDate() + 1);
    stableScenarioStart.setUTCHours(5, 0, 0, 0);
    await setClock(stableScenarioStart);
    const stableAvailabilityDay = new Date(stableScenarioStart);
    stableAvailabilityDay.setUTCHours(0, 0, 0, 0);
    intervals = Array.from({ length: 10 }, (_, index) => ({ kind: 'available',
      start: new Date(stableAvailabilityDay.getTime() + index * 86400000 + 12 * 3600000).toISOString(),
      end: new Date(stableAvailabilityDay.getTime() + index * 86400000 + 22 * 3600000).toISOString() }));
    await replaceAvailability(actor('member').actorUserId, start,
      new Date(horizonEnd.getTime() + 86400000), intervals);
    await replaceAvailability(actor('dispatcher').actorUserId, start,
      new Date(horizonEnd.getTime() + 86400000), intervals);
    await refreshP5aReview('availability_basis', actor('member').actorUserId);
    await refreshP5aReview('availability_basis', actor('dispatcher').actorUserId);
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
    const formationOwningClock = new Date((await fixture.ownerPool.query(
      'SELECT clock_timestamp() value')).rows[0].value);
    if (formationOwningClock.getTime() >= logicalNow.getTime())
      await setClock(new Date(formationOwningClock.getTime() + 1000));
    const formationStart = new Date(logicalNow);
    const formationEnd = new Date(formationStart.getTime() + 31 * 86400000);
    const formationAvailabilityDay = new Date(formationStart);
    formationAvailabilityDay.setUTCHours(0, 0, 0, 0);
    const targetIntervals = Array.from({ length: 10 }, (_, index) => ({ kind: 'available',
      start: new Date(formationAvailabilityDay.getTime() + index * 86400000 + 12 * 3600000).toISOString(),
      end: new Date(formationAvailabilityDay.getTime() + index * 86400000 + 22 * 3600000).toISOString() }));
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

    // Part 5C composes the accepted Part 5A forecast package and Part 5B
    // constrained role supply without changing either authority.  Start from
    // an exact complete installed-source population: remove prior mounted work
    // through its owning completion authority, then prospectively establish a
    // 60-day Part 5A history and a fresh Part 5B scope.
    for (const [cleanupIndex, work] of [unscheduledWork, committedWork, zeroWork, crewOneWork, crewTwoWork].entries()) {
      const state = (await fixture.ownerPool.query(
        `SELECT appointment_status FROM canonical_schedule_assignments
          WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, work.appointment])).rows[0];
      if (state && !['completed', 'cancelled'].includes(state.appointment_status)) {
        try {
          await completeApprovedWork(work, 'cancel', work === crewTwoWork ? 'admin' : 'member');
        } catch (error) {
          if (error.code !== 'M23_EXECUTION_DISPATCH_REQUIRED') throw error;
          await rescheduleApprovedWork(work,
            new Date(logicalNow.getTime() + (400 + cleanupIndex) * 86400000 + 3600000),
            'Restore a current dispatch only to close this earlier mounted fixture through its owning authority.');
          await completeApprovedWork(work, 'cancel', work === crewTwoWork ? 'admin' : 'member');
        }
      }
    }
    const activeScopes = (await fixture.ownerPool.query(
      `SELECT DISTINCT ON(scope_key) scope_key,definition,action
         FROM canonical_forecast_constrained_capacity_reviews_v1
        WHERE organization_id=$1 AND review_kind='scope'
        ORDER BY scope_key,revision DESC`, [fixture.org])).rows.filter(value => value.action === 'approve');
    for (const value of activeScopes) {
      for (const crewId of value.definition.crewIds || []) {
        const crewRow = (await fixture.ownerPool.query(
          'SELECT name,home_location_id FROM workforce_crews WHERE organization_id=$1 AND id=$2',
          [fixture.org, crewId])).rows[0];
        const assignments = (value.definition.crewAssignments || [])
          .filter(item => item.crewId === crewId);
        if (crewRow && assignments.length > 0) {
          const members = assignments.map((item, index) => ({ profileId: item.profileId,
            role: index === 0 ? 'lead' : 'member' }));
          const response = await request(fixture.app).put(`/api/workforce/crews/${crewId}`)
            .set(actor('owner').session.headers).send({ name: crewRow.name,
              homeLocationId: crewRow.home_location_id, members });
          expect(response.status).toBe(200);
        }
      }
      await p5bReview('scope', value.scope_key, null, value.definition, null, 'reject');
    }

    const advisoryCoverageStart = new Date(logicalNow.getTime() + 1000);
    await setClock(advisoryCoverageStart);
    expect((await request(fixture.app).put(`/api/workforce/profiles/${actor('admin').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'administrator',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] })).status).toBe(200);
    expect((await request(fixture.app).put(`/api/workforce/profiles/${actor('owner').actorUserId}`)
      .set(actor('owner').session.headers).send({ operationalRole: 'owner',
        homeLocationId: 'headquarters', skillIds: [skill.body.data.id] })).status).toBe(200);
    const advisoryCoverageEnd = new Date(advisoryCoverageStart.getTime() + 260 * 86400000);
    const advisoryAvailabilityDays = [5, 25, 65, 66, 95, 115, 125, 145, 185, 205];
    const advisoryIntervals = advisoryAvailabilityDays.map(day => ({ kind: 'available',
      start: new Date(advisoryCoverageStart.getTime() + day * 86400000 + 8 * 3600000)
        .toISOString(),
      end: new Date(advisoryCoverageStart.getTime() + day * 86400000 + 18 * 3600000)
        .toISOString() }));
    for (const name of ['member', 'admin', 'dispatcher']) {
      await replaceAvailability(actor(name).actorUserId, advisoryCoverageStart, advisoryCoverageEnd,
        advisoryIntervals);
    }
    expect((await request(fixture.app).put(`/api/workforce/crews/${crew.body.data.id}`)
      .set(actor('owner').session.headers).send({ name: 'Fixture crew', homeLocationId: 'headquarters',
        members: [{ profileId: actor('member').actorUserId, role: 'lead' },
          { profileId: actor('dispatcher').actorUserId, role: 'member' }] })).status).toBe(200);
    const advisoryWorks = [];
    for (let index = 0; index < 2; index += 1) {
      const work = await createAcceptedApprovedWork({ locationId: 'site-one',
        label: `Part5C demand ${index + 1}`,
        start: new Date(advisoryCoverageStart.getTime() + (index + 65) * 86400000 + 10 * 3600000)
          .toISOString() });
      await saveLaborAndApprovePersonPlan(work, '70');
      await refreshP5aReview('remaining_work', work.appointment, null,
        'workload.end_backlog_hours.v1', 4200);
      advisoryWorks.push({ work });
    }
    await advance(1);
    expect((await p5aPost('/epochs', { reason: 'Begin prospective accepted Part5A history for capacity advice.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-epoch-v1' })).status).toBe(201);
    for (const target of ['workload.accepted_person_hours.v1', 'workload.end_backlog_hours.v1',
      'capacity.available_role_hours.v1']) await refreshP5aReview('method', null, null, target);
    for (const [name, role] of [['owner', 'owner'], ['admin', 'administrator'], ['dispatcher', 'dispatcher'],
      ['member', 'technician'], ['viewer', 'employee']]) {
      await refreshP5aReview('role_qualification', actor(name).actorUserId, role);
    }
    await refreshP5aReview('availability_basis', actor('member').actorUserId);
    await refreshP5aReview('availability_basis', actor('admin').actorUserId);
    await refreshP5aReview('availability_basis', actor('dispatcher').actorUserId);
    await refreshP5aReview('capacity_role_scope', null, 'technician');
    await setClock(new Date(advisoryCoverageStart.getTime() + 61 * 86400000));

    const advisoryAssetCalendar = assetId => ({ assetId, availableIntervals: [{
      start: logicalNow.toISOString(), end: new Date(logicalNow.getTime() + 200 * 86400000).toISOString(),
    }], committedIntervals: [] });
    const advisoryScope = { ...scopeDefinition,
      assetCalendars: [advisoryAssetCalendar(vehicle.body.data.id),
        advisoryAssetCalendar(equipment.body.data.id)] };
    await p5bEpoch(); await advance(1);
    await p5bReview('method', null, null, methodDefinition);
    await p5bReview('scope', scopeKey, null, advisoryScope);
    for (const entry of advisoryWorks) {
      entry.jobDefinition = { ...committedJobDefinition, appointmentId: entry.work.appointment,
        assignmentId: entry.work.assignment.id };
      await p5bReview('job', scopeKey, entry.work.appointment, entry.jobDefinition);
    }
    // All accepted source authorities use strict cutoff visibility.  Move the
    // private disposable evidence clock forward only after every guarded
    // decision is durable so the future origin cannot include same-instant
    // rows retroactively.
    await advance(1);

    const advisoryAlternative = 'baseline';
    const policyDefinition = { methodVersion: 'm26-capacity-advisory-five-category-v1',
      alternativeKey: advisoryAlternative, scopeKey, role: 'technician', backlogThresholdMinutes: 1,
      bottleneckGapThresholdMinutes: 1, overtimeReviewEnabled: true, overtimeGapThresholdMinutes: 1,
      contractorReviewEnabled: true, contractorGapThresholdMinutes: 1,
      hiringReviewEnabled: true, hiringGapThresholdMinutes: 1, hiringConsecutivePeriods: 2 };
    await p5cReview('method', { definition: { methodVersion: 'm26-capacity-advisory-five-category-v1' } });
    await p5cReview('policy', { alternativeKey: advisoryAlternative, scopeKey, role: 'technician',
      definition: policyDefinition });
    const demandDefinition = await p5cDefinition(advisoryAlternative);
    const initialDemandReview = await p5cReview('demand', {
      alternativeKey: advisoryAlternative, definition: demandDefinition });
    let currentDemandReview = initialDemandReview;
    const advisoryEpochBody = {
      reason: 'Begin exact prospective five-category capacity advice under current human reviews.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-epoch-v1' };
    const advisoryEpochKey = `m26-p5c-epoch-${uuid()}`;
    const advisoryEpoch = await p5cPost('/epochs', advisoryEpochBody, advisoryEpochKey);
    expect(advisoryEpoch.status).toBe(201);
    const advisoryOriginKey = `m26-p5c-origin-${uuid()}`;
    const advisoryOriginBody = { reason: 'Save the exact private five-category advice research origin.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-origin-v1' };
    const advisoryOrigin = await p5cPost('/origins', advisoryOriginBody, advisoryOriginKey);
    if (advisoryOrigin.status !== 201) {
      let diagnostic = null; const client = await fixture.runtimePool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query(
          'SELECT public.canonical_forecast_capacity_advisory_v1_origin_capture($1,$2,$3,$4,$5,$6,$7,$8)',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, actor('owner').csrfToken, advisoryOriginKey,
            advisoryOriginBody.reason, advisoryOriginBody.confirmationVersion]);
      } catch (error) {
        diagnostic = { code: error.code, message: error.message, detail: error.detail,
          hint: error.hint, where: error.where };
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      throw new Error(`Part5C origin failed: ${JSON.stringify({ response: advisoryOrigin.body, diagnostic })}`);
    }
    expect(advisoryOrigin.body.data).toMatchObject({ state: 'capacity_advisory_origin_saved', scopeCount: 1,
      categoryCount: 5, decisionAction: null, categories: null, valuesWithheld: true,
      thresholdsWithheld: true, outputDigestsWithheld: true, researchOnly: true,
      forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false,
      automaticActionTaken: false, replayed: false });
    expect(JSON.stringify(advisoryOrigin.body)).not.toMatch(
      /"(?:personMinutes|demandMinutes|constrainedMinutes|gapMinutes|outputDigest)"\s*:/i);
    // One current canonical generation owns an exact epoch/cutoff/horizon.
    // A different key cannot create an unapproved sibling that would make
    // consecutive hiring history depend on an arbitrary PostgreSQL row.
    const samePeriodCounts = (await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1) advisory,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1) workload`,
      [fixture.org])).rows[0];
    expect((await p5cPost('/origins', advisoryOriginBody, `m26-p5c-same-period-${uuid()}`)).status).toBe(409);
    expect((await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1) advisory,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1) workload`,
      [fixture.org])).rows[0]).toEqual(samePeriodCounts);
    const decision = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/decisions`, {
      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Approve this exact private research receipt for later non-action evaluation.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-decision-v1' });
    expect(decision.status).toBe(201);
    const currentAdvice = await p5cGet(`/origins/${advisoryOrigin.body.data.id}`);
    if (currentAdvice.status !== 200) {
      let diagnostic; try {
        diagnostic = (await fixture.ownerPool.query(
          'SELECT public.canonical_forecast_capacity_advisory_v1_origin_read($1,$2,$3,$4,$5) value',
          [fixture.org, actor('owner').actorUserId, actor('owner').actorAccessRole,
            actor('owner').authSessionId, advisoryOrigin.body.data.id])).rows[0].value;
      } catch (error) { diagnostic = { code: error.code, message: error.message, where: error.where }; }
      throw new Error(`Part5C current origin projection failed: ${JSON.stringify({
        status: currentAdvice.status, body: currentAdvice.body, diagnostic })}`);
    }
    expect(currentAdvice.body.data.categories[0].categories).toEqual({
      bottleneck: { state: 'attention' }, backlog: { state: 'attention' },
      overtime: { state: 'attention' }, contractor: { state: 'attention' },
      hiring_need: { state: 'insufficient_history' } });
    const adviceReplay = await p5cPost('/origins', advisoryOriginBody, advisoryOriginKey);
    expect(adviceReplay.status).toBe(200);
    expect(adviceReplay.headers['idempotency-replayed']).toBe('true');
    expect((await p5cPost('/origins', { ...advisoryOriginBody, reason: `${advisoryOriginBody.reason} changed` },
      advisoryOriginKey)).status).toBe(409);
    expect((await p5cPost('/origins', advisoryOriginBody, `m26-p5c-member-${uuid()}`, 'member')).status).toBe(403);
    expect((await request(app).post('/api/v1/forecast/capacity-advice/origins').set('X-Test-Actor', 'owner')
      .set('Idempotency-Key', `m26-p5c-no-csrf-${uuid()}`).send(advisoryOriginBody)).status).toBe(403);
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}`, 'otherOwner')).status).toBe(404);
    expect((await p5cPost(`/origins/${advisoryOrigin.body.data.id}/outcome-preparations`, {})).status)
      .toBe(400);

    // The owner prospectively reserves the next exact server-owned period.
    // Neither this request nor the later worker supplies a cutoff or horizon.
    const continuationBody = {
      reason: 'Reserve the next exact gap-free private advisory period before the current horizon ends.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-continuation-v1' };
    const continuationKey = `m26-p5c-continuation-${uuid()}`;
    const continuation = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/continuations`,
      continuationBody, continuationKey);
    expect(continuation.status).toBe(201);
    expect(continuation.body.data).toMatchObject({ state: 'capacity_advisory_continuation_pending',
      predecessorOriginId: advisoryOrigin.body.data.id, periodStart: advisoryOrigin.body.data.horizonEndsAt,
      originId: null, replayed: false });
    expect((await p5cPost(`/origins/${advisoryOrigin.body.data.id}/continuations`,
      continuationBody, continuationKey)).headers['idempotency-replayed']).toBe('true');
    expect((await p5cPost(`/origins/${advisoryOrigin.body.data.id}/continuations`,
      { ...continuationBody, reason: `${continuationBody.reason} changed` }, continuationKey)).status).toBe(409);
    const beforeBoundaryWorker = new CapacityAdvisoryContinuationWorker({ getPool: () => fixture.runtimePool });
    expect(await beforeBoundaryWorker.drainOnce()).toEqual({ due: 0, attempted: 0 });
    beforeBoundaryWorker.stop();

    // The later outcome is built only after the accepted Part5A outcome and
    // evaluation are prepared for the same immutable period.  The separate
    // historical allocation review pins the exact end-period population.
    await setClock(advisoryOrigin.body.data.horizonEndsAt);
    const prepared = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/outcome-preparations`, {});
    expect(prepared.status).toBe(201);
    const outcomeDemand = await p5cDefinition(advisoryAlternative, advisoryOrigin.body.data.id);
    outcomeDemand.methodVersion = 'm26-capacity-advisory-outcome-allocation-v1';
    outcomeDemand.originId = advisoryOrigin.body.data.id;
    let currentOutcomeDemandReview = await p5cReview('outcome_demand', { alternativeKey: advisoryAlternative,
      subjectId: advisoryOrigin.body.data.id, definition: outcomeDemand });
    const advisoryOutcomeKey = `m26-p5c-outcome-${uuid()}`;
    const advisoryOutcome = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/outcomes`, {},
      advisoryOutcomeKey);
    if (advisoryOutcome.status !== 201) {
      throw new Error(`Part5C outcome failed: ${JSON.stringify(advisoryOutcome.body)}`);
    }
    expect(advisoryOutcome.body.data).toMatchObject({ originId: advisoryOrigin.body.data.id,
      state: 'capacity_advisory_outcome_saved', revision: 1, valuesWithheld: true,
      outputDigestsWithheld: true, automaticActionTaken: false });
    const outcomeReplay = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/outcomes`, {},
      advisoryOutcomeKey);
    expect(outcomeReplay.status).toBe(200);
    expect(outcomeReplay.headers['idempotency-replayed']).toBe('true');
    const advisoryEvaluationKey = `m26-p5c-evaluation-${uuid()}`;
    const advisoryEvaluation = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/evaluations`, {
      outcomeId: advisoryOutcome.body.data.id }, advisoryEvaluationKey);
    expect(advisoryEvaluation.status).toBe(201);
    expect(advisoryEvaluation.body.data).toMatchObject({ originId: advisoryOrigin.body.data.id,
      outcomeId: advisoryOutcome.body.data.id, state: 'capacity_advisory_evaluation_saved',
      revision: 1, metricsWithheld: true, automaticActionTaken: false });
    expect((await p5cPost(`/origins/${advisoryOrigin.body.data.id}/evaluations`, {
      outcomeId: advisoryOutcome.body.data.id }, advisoryEvaluationKey)).headers['idempotency-replayed'])
      .toBe('true');
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/outcomes/${uuid()}`)).status).toBe(404);
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/evaluations/${uuid()}`)).status).toBe(404);
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/outcomes/${advisoryOutcome.body.data.id}`,
      'otherOwner')).status).toBe(404);
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/evaluations/${advisoryEvaluation.body.data.id}`,
      'otherOwner')).status).toBe(404);

    // A corrected historical allocation is append-only. It stales the prior
    // outcome/evaluation without rewriting the immutable origin, then requires
    // explicit recapture and reevaluation under the same original period.
    currentOutcomeDemandReview = await p5cReview('outcome_demand', { alternativeKey: advisoryAlternative,
      subjectId: advisoryOrigin.body.data.id, definition: outcomeDemand,
      correctionOfReviewId: currentOutcomeDemandReview.id });
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/outcomes/${advisoryOutcome.body.data.id}`))
      .body.data.state).toBe('capacity_advisory_outcome_stale');
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/evaluations/${advisoryEvaluation.body.data.id}`))
      .body.data.state).toBe('capacity_advisory_evaluation_stale');
    const correctedOutcome = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/outcomes`, {});
    expect(correctedOutcome.status).toBe(201);
    expect(correctedOutcome.body.data).toMatchObject({ revision: 2,
      state: 'capacity_advisory_outcome_saved' });
    const correctedEvaluation = await p5cPost(`/origins/${advisoryOrigin.body.data.id}/evaluations`, {
      outcomeId: correctedOutcome.body.data.id });
    expect(correctedEvaluation.status).toBe(201);
    expect(correctedEvaluation.body.data).toMatchObject({ revision: 2,
      state: 'capacity_advisory_evaluation_saved' });

    // A new period receives a new current allocation review. The earlier
    // immutable period remains current because its exact cutoff source still
    // recomputes, and the explicit two-period owner policy can now produce a
    // positive hiring-attention state from consecutive evaluated receipts.
    const secondDemand = await p5cDefinition(advisoryAlternative);
    const secondDemandReview = await p5cReview('demand', { alternativeKey: advisoryAlternative,
      definition: secondDemand, continuationId: continuation.body.data.id });
    currentDemandReview = secondDemandReview;
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_origin_current');
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/evaluations/${correctedEvaluation.body.data.id}`))
      .body.data.state).toBe('capacity_advisory_evaluation_current');
    // A genuine guarded Part 5B job rereview at the exact owning boundary is
    // visible to the <= cutoff constraint census after the human allocation
    // review while leaving the Part 5C epoch/policy identity intact.
    // The worker must compare the human-pinned basis with that fresh source
    // before creating either accepted Part 5A/Part 5C child or activation row.
    const continuationChildrenBeforeCorrection = (await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1) workload_origins,
        (SELECT count(*)::integer FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1) advisory_origins,
        (SELECT count(*)::integer FROM canonical_forecast_capacity_advisory_continuation_events_v1 WHERE organization_id=$1) events`,
      [fixture.org])).rows[0];
    await p5bReview('job', scopeKey, advisoryWorks[0].work.appointment,
      advisoryWorks[0].jobDefinition);
    const continuationWorker = new CapacityAdvisoryContinuationWorker({ getPool: () => fixture.runtimePool });
    expect(await continuationWorker.drainOnce()).toEqual({ due: 1, attempted: 1 });
    expect((await p5cGet(`/continuations/${continuation.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_continuation_pending');
    expect((await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1) workload_origins,
        (SELECT count(*)::integer FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1) advisory_origins,
        (SELECT count(*)::integer FROM canonical_forecast_capacity_advisory_continuation_events_v1 WHERE organization_id=$1) events`,
      [fixture.org])).rows[0]).toEqual(continuationChildrenBeforeCorrection);
    let secondCurrentDemandReview = await p5cReview('demand', { alternativeKey: advisoryAlternative,
      definition: await p5cDefinition(advisoryAlternative),
      correctionOfReviewId: secondDemandReview.id });
    currentDemandReview = secondCurrentDemandReview;
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(await continuationWorker.drainOnce()).toEqual({ due: 1, attempted: 1 });
    const activatedContinuation = await p5cGet(`/continuations/${continuation.body.data.id}`);
    if (activatedContinuation.status !== 200 ||
      activatedContinuation.body?.data?.state !== 'capacity_advisory_continuation_activated') {
      const diagnostic = (await fixture.ownerPool.query(
        `SELECT event_value.event_kind,event_value.origin_id,
                canonical_forecast_capacity_advisory_v1_continuation_current($1,value) continuation_current,
                canonical_forecast_capacity_advisory_v1_continuation_projection(value,false) projection,
                CASE WHEN origin_value.id IS NULL THEN NULL
                  ELSE canonical_forecast_capacity_advisory_v1_origin_current($1,origin_value) END origin_current
           FROM canonical_forecast_capacity_advisory_continuations_v1 value
           LEFT JOIN canonical_forecast_capacity_advisory_continuation_events_v1 event_value
             ON event_value.organization_id=value.organization_id AND event_value.continuation_id=value.id
           LEFT JOIN canonical_forecast_capacity_advisory_origins_v1 origin_value
             ON origin_value.organization_id=event_value.organization_id AND origin_value.id=event_value.origin_id
          WHERE value.organization_id=$1 AND value.id=$2`, [fixture.org, continuation.body.data.id])).rows[0];
      throw new Error(`Part5C continuation projection failed: ${JSON.stringify({
        response: activatedContinuation.body, diagnostic })}`);
    }
    expect(activatedContinuation.body.data).toMatchObject({ state: 'capacity_advisory_continuation_activated',
      predecessorOriginId: advisoryOrigin.body.data.id, periodStart: advisoryOrigin.body.data.horizonEndsAt,
      replayed: false });
    const secondOrigin = { status: 201, body: { data: (await p5cGet(
      `/origins/${activatedContinuation.body.data.originId}`)).body.data } };
    expect(secondOrigin.body.data.id).toBe(activatedContinuation.body.data.originId);
    const secondDecision = await p5cPost(`/origins/${secondOrigin.body.data.id}/decisions`, {
      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Approve the second exact private period for the owner-reviewed consecutive criterion.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-decision-v1' });
    expect(secondDecision.status).toBe(201);
    const secondCurrent = await p5cGet(`/origins/${secondOrigin.body.data.id}`);
    expect(secondCurrent.status).toBe(200);
    if (secondCurrent.body.data.categories[0].categories.hiring_need.state !== 'attention') {
      const historyDiagnostic = (await fixture.ownerPool.query(
        `SELECT jsonb_build_object(
          'priorOriginId',prior.id,'priorEpochId',prior.epoch_id,'latestEpochId',(SELECT id FROM canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=$1 ORDER BY revision DESC LIMIT 1),
          'priorEvaluationId',evaluation_value.id,'priorEvaluationCurrent',canonical_forecast_capacity_advisory_v1_evaluation_current($1,evaluation_value),
          'priorOutcomeId',outcome_value.id,'priorOutcomeCurrent',canonical_forecast_capacity_advisory_v1_outcome_current($1,outcome_value),
          'priorWorkloadEvaluationId',outcome_value.source_manifest->>'workloadEvaluationId',
          'priorWorkloadEvaluationCurrent',canonical_forecast_workload_capacity_v1_evaluation_current($1,workload_evaluation),
          'priorResults',outcome_value.private_results,'secondResults',second.private_results) value
         FROM canonical_forecast_capacity_advisory_origins_v1 second
         LEFT JOIN canonical_forecast_capacity_advisory_origins_v1 prior ON prior.organization_id=second.organization_id AND prior.horizon_ends_at=second.prediction_cutoff_at
         LEFT JOIN LATERAL (SELECT * FROM canonical_forecast_capacity_advisory_evaluations_v1 value WHERE value.organization_id=prior.organization_id AND value.origin_id=prior.id ORDER BY revision DESC LIMIT 1) evaluation_value ON TRUE
         LEFT JOIN canonical_forecast_capacity_advisory_outcomes_v1 outcome_value ON outcome_value.organization_id=evaluation_value.organization_id AND outcome_value.id=evaluation_value.outcome_id
         LEFT JOIN canonical_forecast_workload_capacity_evaluations_v1 workload_evaluation ON workload_evaluation.organization_id=outcome_value.organization_id AND workload_evaluation.id=(outcome_value.source_manifest->>'workloadEvaluationId')::uuid
         WHERE second.organization_id=$1 AND second.id=$2`, [fixture.org, secondOrigin.body.data.id])).rows[0].value;
      throw new Error(`Part5C consecutive history unavailable: ${JSON.stringify(historyDiagnostic)}`);
    }

    // Human control remains explicit after a saved origin. Rejection hides the
    // advice and prevents downstream evidence; explicit rereview restores only
    // this immutable origin under the same exact method/source identity.
    const secondRejected = await p5cPost(`/origins/${secondOrigin.body.data.id}/decisions`, {
      action: 'reject', expectedRevision: secondDecision.body.data.revision,
      expectedDigest: secondDecision.body.data.digest,
      reason: 'Reject this exact research receipt without taking an operational action.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-decision-v1' });
    expect(secondRejected.status).toBe(201);
    expect((await p5cGet(`/origins/${secondOrigin.body.data.id}`)).body.data).toMatchObject({
      decisionAction: 'reject', categories: null });
    expect((await p5cPost(`/origins/${secondOrigin.body.data.id}/outcomes`, {})).status).toBe(400);
    const secondReapproved = await p5cPost(`/origins/${secondOrigin.body.data.id}/decisions`, {
      action: 'approve', expectedRevision: secondRejected.body.data.revision,
      expectedDigest: secondRejected.body.data.digest,
      reason: 'Explicitly reapprove this unchanged private research receipt for later evaluation.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-decision-v1' });
    expect(secondReapproved.status).toBe(201);

    // A genuinely later correction explicitly targets the immutable first
    // period rather than borrowing the review wall clock. It immediately
    // retires the origin and its already-saved outcome/evaluation before any
    // successor generation exists; equal restored bytes cannot revive them.
    const firstPeriodCorrectedDemand = await p5cDefinition(advisoryAlternative, advisoryOrigin.body.data.id);
    firstPeriodCorrectedDemand.methodVersion = 'm26-capacity-advisory-demand-allocation-v1';
    delete firstPeriodCorrectedDemand.originId;
    currentDemandReview = await p5cReview('demand', { alternativeKey: advisoryAlternative,
      definition: firstPeriodCorrectedDemand, correctionOfReviewId: initialDemandReview.id });
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_origin_stale');
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/outcomes/${correctedOutcome.body.data.id}`))
      .body.data.state).toBe('capacity_advisory_outcome_stale');
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/evaluations/${correctedEvaluation.body.data.id}`))
      .body.data.state).toBe('capacity_advisory_evaluation_stale');
    const beforeInputCorrectionChildren = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_evaluations_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    expect((await p5cPost(`/origins/${advisoryOrigin.body.data.id}/evaluations`, {
      outcomeId: correctedOutcome.body.data.id })).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_evaluations_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(beforeInputCorrectionChildren);
    const correctedFirstOrigin = await p5cPost('/origins', {
      ...advisoryOriginBody, correctionOriginId: advisoryOrigin.body.data.id });
    if (correctedFirstOrigin.status !== 201) {
      const targetRow = (await fixture.ownerPool.query(
        `SELECT canonical_forecast_capacity_advisory_v1_origin_non_demand_current($1,value) non_demand,
                canonical_forecast_capacity_advisory_v1_origin_input_demand_current($1,value) input_demand,
                canonical_forecast_capacity_advisory_v1_origin_current($1,value) full_current
           FROM canonical_forecast_capacity_advisory_origins_v1 value
          WHERE organization_id=$1 AND id=$2`, [fixture.org, advisoryOrigin.body.data.id])).rows[0];
      throw new Error(`Part5C corrected origin failed: ${JSON.stringify({
        response: correctedFirstOrigin.body, targetRow })}`);
    }
    currentDemandReview = await p5cReview('demand', { alternativeKey: advisoryAlternative,
      definition: secondDemand, correctionOfReviewId: secondCurrentDemandReview.id });
    secondCurrentDemandReview = currentDemandReview;

    // A new Part 5C epoch permanently retires every older Part 5C receipt even
    // when no upstream value changed. Old exact-key replay cannot revive it;
    // a new explicit origin starts with insufficient history in the new epoch.
    const retiredOriginCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const replacementEpochBody = {
      reason: 'Explicitly begin a new advice coverage epoch without inheriting prior hiring history.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-epoch-v1' };
    const replacementEpochKey = `m26-p5c-replacement-epoch-${uuid()}`;
    const replacementEpoch = await p5cPost('/epochs', replacementEpochBody, replacementEpochKey);
    expect(replacementEpoch.status).toBe(201);
    expect((await p5cPost('/epochs', replacementEpochBody, replacementEpochKey)).status).toBe(200);
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_origin_stale');
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/outcomes/${correctedOutcome.body.data.id}`))
      .body.data.state).toBe('capacity_advisory_outcome_stale');
    expect((await p5cGet(`/origins/${advisoryOrigin.body.data.id}/evaluations/${correctedEvaluation.body.data.id}`))
      .body.data.state).toBe('capacity_advisory_evaluation_stale');
    const retiredPreparationCounts = (await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0];
    const retiredPreparationKey = `m26-p5c-retired-preparation-${uuid()}`;
    expect((await p5cPost(`/origins/${advisoryOrigin.body.data.id}/outcome-preparations`, {},
      retiredPreparationKey)).status).toBe(409);
    expect((await p5cPost(`/origins/${advisoryOrigin.body.data.id}/outcome-preparations`, {},
      retiredPreparationKey)).status).toBe(409);
    expect((await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0]).toEqual(retiredPreparationCounts);
    expect((await p5cPost('/origins', advisoryOriginBody, advisoryOriginKey)).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(retiredOriginCount);
    const recoveredOrigin = await p5cPost('/origins', advisoryOriginBody);
    expect(recoveredOrigin.status).toBe(201);
    const recoveredDecision = await p5cPost(`/origins/${recoveredOrigin.body.data.id}/decisions`, {
      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Approve only the new-epoch private research receipt after explicit recapture.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-decision-v1' });
    if (recoveredDecision.status !== 201) {
      const currentDiagnostic = (await fixture.ownerPool.query(
        `SELECT canonical_forecast_capacity_advisory_v1_origin_non_demand_current($1,value) non_demand,
                canonical_forecast_capacity_advisory_v1_origin_input_demand_current($1,value) input_demand,
                canonical_forecast_capacity_advisory_v1_origin_current($1,value) full_current
           FROM canonical_forecast_capacity_advisory_origins_v1 value
          WHERE organization_id=$1 AND id=$2`, [fixture.org, recoveredOrigin.body.data.id])).rows[0];
      throw new Error(`Recovered Part5C decision failed: ${JSON.stringify({
        response: recoveredDecision.body, origin: recoveredOrigin.body.data, currentDiagnostic })}`);
    }
    expect((await p5cGet(`/origins/${recoveredOrigin.body.data.id}`)).body.data.categories[0]
      .categories.hiring_need.state).toBe('insufficient_history');

    // A same-cutoff demand rereview is a correction, not ordinary next-period
    // progress. Restoring identical bytes cannot revive the pinned generation;
    // explicit recapture under the current review is required.
    const correctedDemand = await p5cDefinition(advisoryAlternative);
    currentDemandReview = await p5cReview('demand', { alternativeKey: advisoryAlternative,
      definition: correctedDemand, correctionOfReviewId: currentDemandReview.id });
    expect((await p5cGet(`/origins/${recoveredOrigin.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_origin_stale');
    const correctedDemandChildCounts = (await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0];
    const correctedDemandPreparationKey = `m26-p5c-corrected-demand-preparation-${uuid()}`;
    expect((await p5cPost(`/origins/${recoveredOrigin.body.data.id}/outcome-preparations`, {},
      correctedDemandPreparationKey)).status).toBe(409);
    expect((await p5cPost(`/origins/${recoveredOrigin.body.data.id}/outcome-preparations`, {},
      correctedDemandPreparationKey)).status).toBe(409);
    expect((await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0]).toEqual(correctedDemandChildCounts);
    const demandRetiredCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const demandRecoveredOrigin = await p5cPost('/origins', {
      ...advisoryOriginBody, correctionOriginId: recoveredOrigin.body.data.id });
    expect(demandRecoveredOrigin.status).toBe(201);
    const demandGenerations = (await fixture.ownerPool.query(
      `SELECT id,generation,previous_id FROM canonical_forecast_capacity_advisory_origins_v1
        WHERE organization_id=$1 AND epoch_id=(SELECT epoch_id FROM canonical_forecast_capacity_advisory_origins_v1
          WHERE organization_id=$1 AND id=$2)
         AND prediction_cutoff_at=(SELECT prediction_cutoff_at FROM canonical_forecast_capacity_advisory_origins_v1
          WHERE organization_id=$1 AND id=$2)
         AND horizon_ends_at=(SELECT horizon_ends_at FROM canonical_forecast_capacity_advisory_origins_v1
          WHERE organization_id=$1 AND id=$2)
        ORDER BY generation`, [fixture.org, recoveredOrigin.body.data.id])).rows;
    expect(demandGenerations.slice(-2)).toEqual([
      expect.objectContaining({ id: recoveredOrigin.body.data.id, generation: '1', previous_id: null }),
      expect.objectContaining({ id: demandRecoveredOrigin.body.data.id, generation: '2',
        previous_id: recoveredOrigin.body.data.id }),
    ]);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(demandRetiredCount + 1);

    // A policy rereview also retires its epoch. Even a byte-identical restored
    // policy is a new human authority generation and cannot revive old advice.
    await p5cReview('policy', { alternativeKey: advisoryAlternative, scopeKey, role: 'technician',
      definition: policyDefinition });
    expect((await p5cGet(`/origins/${demandRecoveredOrigin.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_origin_stale');
    const stalePolicyEpochCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    expect((await p5cPost('/epochs', replacementEpochBody, replacementEpochKey)).status).toBe(409);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(stalePolicyEpochCount);
    expect((await p5cPost('/origins', advisoryOriginBody)).status).toBe(400);
    const policyEpochBody = {
      reason: 'Explicitly bind a new advice epoch to the current restored policy generation.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-epoch-v1' };
    const policyEpochKey = `m26-p5c-policy-epoch-${uuid()}`;
    const policyEpoch = await p5cPost('/epochs', policyEpochBody, policyEpochKey);
    expect(policyEpoch.status).toBe(201);
    const policyRecoveredOrigin = await p5cPost('/origins', advisoryOriginBody);
    expect(policyRecoveredOrigin.status).toBe(201);
    expect((await p5cGet(`/origins/${demandRecoveredOrigin.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_origin_stale');

    // A newer accepted Part 5B epoch retires the still-latest Part 5C epoch.
    // Exact epoch replay and both fresh/exact-key outcome preparation refuse
    // before either accepted Part 5A child receipt can persist.
    const stalePreparationCounts = (await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0];
    const upstreamStaleEpochCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    await advance(1); await p5bEpoch();
    // The new upstream epoch first makes the policy/source prerequisites
    // unavailable, so the exact old key refuses as an invalid stale request
    // before replay lookup. Policy-only staleness above reaches the explicit
    // epoch-current replay conflict. Neither path may return the old success.
    expect((await p5cPost('/epochs', policyEpochBody, policyEpochKey)).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(upstreamStaleEpochCount);
    const stalePreparationKey = `m26-p5c-stale-preparation-${uuid()}`;
    expect((await p5cPost(`/origins/${policyRecoveredOrigin.body.data.id}/outcome-preparations`, {},
      stalePreparationKey)).status).toBe(409);
    expect((await p5cPost(`/origins/${policyRecoveredOrigin.body.data.id}/outcome-preparations`, {},
      stalePreparationKey)).status).toBe(409);
    expect((await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0]).toEqual(stalePreparationCounts);
    await packageReview(advisoryScope, advisoryWorks.map(entry => ({
      appointmentId: entry.work.appointment, definition: entry.jobDefinition,
    })));
    await p5cReview('policy', { alternativeKey: advisoryAlternative, scopeKey, role: 'technician',
      definition: policyDefinition });
    await p5cReview('demand', { alternativeKey: advisoryAlternative,
      definition: await p5cDefinition(advisoryAlternative) });
    const upstreamEpoch = await p5cPost('/epochs', {
      reason: 'Explicitly bind advice to the new accepted constrained-capacity source epoch.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-epoch-v1' });
    expect(upstreamEpoch.status).toBe(201);
    const upstreamRecoveredOrigin = await p5cPost('/origins', advisoryOriginBody);
    expect(upstreamRecoveredOrigin.status).toBe(201);

    // A genuine accepted Part 5B source rereview also retires a dependent
    // Part 5C origin. Both fresh and exact-key preparation refuse before any
    // accepted Part 5A child row, and recovery requires new upstream and
    // Part 5C epochs plus a new immutable origin.
    const sourceCorrectionCounts = (await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0];
    await p5bReview('scope', scopeKey, null, advisoryScope);
    expect((await p5cGet(`/origins/${upstreamRecoveredOrigin.body.data.id}`)).body.data.state)
      .toBe('capacity_advisory_origin_stale');
    const sourceCorrectionPreparationKey = `m26-p5c-source-correction-preparation-${uuid()}`;
    expect((await p5cPost(`/origins/${upstreamRecoveredOrigin.body.data.id}/outcome-preparations`, {},
      sourceCorrectionPreparationKey)).status).toBe(409);
    expect((await p5cPost(`/origins/${upstreamRecoveredOrigin.body.data.id}/outcome-preparations`, {},
      sourceCorrectionPreparationKey)).status).toBe(409);
    expect((await fixture.ownerPool.query(
      `SELECT
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_windows_v1 WHERE organization_id=$1) windows,
        (SELECT count(*)::integer FROM canonical_forecast_workload_capacity_evaluations_v1 WHERE organization_id=$1) evaluations`,
      [fixture.org])).rows[0]).toEqual(sourceCorrectionCounts);
    await packageReview(advisoryScope, advisoryWorks.map(entry => ({
      appointmentId: entry.work.appointment, definition: entry.jobDefinition,
    })));
    await p5cReview('policy', { alternativeKey: advisoryAlternative, scopeKey, role: 'technician',
      definition: policyDefinition });
    await p5cReview('demand', { alternativeKey: advisoryAlternative,
      definition: await p5cDefinition(advisoryAlternative) });
    expect((await p5cPost('/epochs', {
      reason: 'Bind advice to the explicitly rereviewed constrained-capacity source generation.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-epoch-v1' })).status).toBe(201);
    const sourceRecoveredOrigin = await p5cPost('/origins', advisoryOriginBody);
    expect(sourceRecoveredOrigin.status).toBe(201);

    // Genuine post-cutoff completion is authorized future progress, not an
    // input correction. It leaves the saved origin current, while a later
    // origin sees the exact authenticated zero backlog through the owning 5A
    // receipt and never conflates it with missing demand evidence.
    await advance(1);
    for (const entry of advisoryWorks) await completeApprovedWork(entry.work, 'complete', 'member');
    const postCompletionOrigin = await p5cGet(`/origins/${sourceRecoveredOrigin.body.data.id}`);
    if (postCompletionOrigin.body.data.state !== 'capacity_advisory_origin_current') {
      const diagnostic = (await fixture.ownerPool.query(
        `SELECT canonical_forecast_capacity_advisory_v1_epoch_current($1,epoch_value) epoch_current,
                canonical_forecast_workload_capacity_v1_origin_current($1,workload_value) workload_current,
                canonical_forecast_capacity_advisory_v1_workload_origin_historical_current($1,workload_value) workload_historical_current,
                origin_value.input_manifest->>'constraintDigest' saved_constraint_digest,
                canonical_completion_digest(canonical_forecast_constrained_capacity_v1_complete_input(
                  $1,origin_value.prediction_cutoff_at)) current_constraint_digest,
                origin_value.input_manifest->>'policyDigest' saved_policy_digest,
                canonical_completion_digest(canonical_forecast_capacity_advisory_v1_policy_manifest(
                  $1,origin_value.prediction_cutoff_at)) current_policy_digest,
                canonical_forecast_capacity_advisory_v1_origin_current($1,origin_value) advisory_current
           FROM canonical_forecast_capacity_advisory_origins_v1 origin_value
           JOIN canonical_forecast_capacity_advisory_epochs_v1 epoch_value
             ON epoch_value.organization_id=origin_value.organization_id AND epoch_value.id=origin_value.epoch_id
           JOIN canonical_forecast_workload_capacity_origins_v1 workload_value
             ON workload_value.organization_id=origin_value.organization_id
            AND workload_value.id=(origin_value.input_manifest#>>'{workloadOrigin,id}')::uuid
          WHERE origin_value.organization_id=$1 AND origin_value.id=$2`,
        [fixture.org, sourceRecoveredOrigin.body.data.id])).rows[0];
      throw new Error(`Post-completion origin unexpectedly stale: ${JSON.stringify({
        projection: postCompletionOrigin.body.data, diagnostic })}`);
    }
    await advance(1);
    const zeroDemand = await p5cDefinition(advisoryAlternative);
    expect(zeroDemand.allocations).toEqual([]);
    await p5cReview('demand', { alternativeKey: advisoryAlternative, definition: zeroDemand });
    const advisoryZeroOrigin = await p5cPost('/origins', advisoryOriginBody);
    expect(advisoryZeroOrigin.status).toBe(201);
    const advisoryZeroDecision = await p5cPost(`/origins/${advisoryZeroOrigin.body.data.id}/decisions`, {
      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Approve the authenticated complete-zero research receipt for explicit review.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-decision-v1' });
    expect(advisoryZeroDecision.status).toBe(201);
    expect((await p5cGet(`/origins/${advisoryZeroOrigin.body.data.id}`)).body.data.categories[0].categories)
      .toEqual({ bottleneck: { state: 'clear' }, backlog: { state: 'clear' },
        overtime: { state: 'clear' }, contractor: { state: 'clear' }, hiring_need: { state: 'clear' } });

    // Invalid or oversized crosswalks fail before any append-only review row.
    // Authenticated complete zero remains distinct from an invented allocation.
    const advisoryReviewCount = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    const malformedOutcomeDemand = { ...outcomeDemand, originId: '-'.repeat(36) };
    expect((await fixture.ownerPool.query(
      "SELECT canonical_forecast_capacity_advisory_v1_demand_valid($1,'outcome_demand') valid",
      [malformedOutcomeDemand])).rows[0].valid).toBe(false);
    const outcomeToken = (await p5cGet('/reviews/current?' + new URLSearchParams({
      kind: 'outcome_demand', alternativeKey: advisoryAlternative, scopeKey: 'none', role: 'none',
      subjectId: advisoryOrigin.body.data.id }).toString())).body.data;
    expect((await p5cPost('/reviews', { kind: 'outcome_demand', alternativeKey: advisoryAlternative,
      scopeKey: null, role: null, subjectId: advisoryOrigin.body.data.id, action: 'approve',
      expectedRevision: outcomeToken.expectedRevision, expectedDigest: outcomeToken.expectedDigest,
      definition: malformedOutcomeDemand,
      reason: 'Reject a malformed nested origin identity without reaching a UUID cast.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-review-v1' })).status).toBe(400);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(advisoryReviewCount);
    const demandToken = (await p5cGet('/reviews/current?' + new URLSearchParams({ kind: 'demand',
      alternativeKey: advisoryAlternative, scopeKey: 'none', role: 'none', subjectId: 'none' }).toString())).body.data;
    const invalidAllocation = { ...zeroDemand, allocations: [{ appointmentId: uuid(), assignmentId: uuid(),
      scopeKey, role: 'technician', personMinutes: 1 }] };
    const demandReviewBody = definition => ({ kind: 'demand', alternativeKey: advisoryAlternative,
      scopeKey: null, role: null, subjectId: null, action: 'approve',
      expectedRevision: demandToken.expectedRevision, expectedDigest: demandToken.expectedDigest, definition,
      reason: 'Refuse an incomplete or oversized private demand allocation without partial evidence.',
      confirmed: true, confirmationVersion: 'm26-capacity-advisory-review-v1' });
    expect((await p5cPost('/reviews', demandReviewBody(invalidAllocation))).status).toBe(400);
    const oversizedAllocation = { ...zeroDemand, allocations: Array.from({ length: 1001 }, (_, index) => ({
      appointmentId: uuid(), assignmentId: uuid(), scopeKey, role: 'technician', personMinutes: index + 1 })) };
    // Express rejects this bounded public body before a database transaction;
    // the SQL validator independently retains the exact 1,000-row ceiling.
    expect((await p5cPost('/reviews', demandReviewBody(oversizedAllocation))).status).toBe(413);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(advisoryReviewCount);

    // A reserved boundary that is not activated within the fixed server
    // deadline becomes immutable unavailable evidence. Restarting the worker
    // cannot backdate the missed cutoff or create a partial origin.
    const missedContinuation = await p5cPost(`/origins/${advisoryZeroOrigin.body.data.id}/continuations`,
      continuationBody);
    expect(missedContinuation.status).toBe(201);
    const originCountBeforeMiss = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count);
    await setClock(new Date(new Date(missedContinuation.body.data.activationDeadline).getTime() + 1000));
    const restartedWorker = new CapacityAdvisoryContinuationWorker({ getPool: () => fixture.runtimePool });
    expect(await restartedWorker.drainOnce()).toEqual({ due: 1, attempted: 1 });
    expect((await p5cGet(`/continuations/${missedContinuation.body.data.id}`)).body.data)
      .toMatchObject({ state: 'capacity_advisory_continuation_missed', originId: null, refreshRequired: true });
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=$1',
      [fixture.org])).rows[0].count)).toBe(originCountBeforeMiss);

	    // Each worker first commits a private retry lease, then activates in its
	    // own transaction. A revoked first actor cannot starve a later valid
	    // reservation, and concurrent workers use SKIP LOCKED plus the lease
	    // rather than repeatedly selecting the same poison row. The failed
	    // immutable reservation remains pending and activates after its exact
	    // session authority is restored and the bounded retry delay elapses.
	    // Move prospectively into the already-reviewed installed-source interval
	    // that contains declared target/support availability. No source row is
	    // backdated or rewritten; a fresh human demand review binds this period.
	    await setClock(new Date(advisoryCoverageStart.getTime() + 175 * 86400000));
	    currentDemandReview = await p5cReview('demand', { alternativeKey: advisoryAlternative,
	      definition: await p5cDefinition(advisoryAlternative) });
	    const poisonOrigin = await p5cPost('/origins', advisoryOriginBody, `m26-p5c-worker-poison-origin-${uuid()}`);
	    expect(poisonOrigin.status).toBe(201);
	    expect((await p5cPost(`/origins/${poisonOrigin.body.data.id}/decisions`, {
	      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
	      reason: 'Approve the exact first worker isolation receipt.', confirmed: true,
	      confirmationVersion: 'm26-capacity-advisory-decision-v1' })).status).toBe(201);
	    const poisonContinuation = await p5cPost(`/origins/${poisonOrigin.body.data.id}/continuations`,
	      continuationBody, `m26-p5c-worker-poison-continuation-${uuid()}`);
	    expect(poisonContinuation.status).toBe(201);
	    await advance(1);
	    const validOrigin = await p5cPost('/origins', advisoryOriginBody,
	      `m26-p5c-worker-valid-origin-${uuid()}`, 'admin');
	    expect(validOrigin.status).toBe(201);
	    expect((await p5cPost(`/origins/${validOrigin.body.data.id}/decisions`, {
	      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
	      reason: 'Approve the exact later worker isolation receipt.', confirmed: true,
	      confirmationVersion: 'm26-capacity-advisory-decision-v1' }, `m26-p5c-worker-valid-decision-${uuid()}`,
	    'admin')).status).toBe(201);
	    const validContinuation = await p5cPost(`/origins/${validOrigin.body.data.id}/continuations`,
	      continuationBody, `m26-p5c-worker-valid-continuation-${uuid()}`, 'admin');
	    expect(validContinuation.status).toBe(201);
	    await setClock(validContinuation.body.data.periodStart);
	    const prepareWorkerPredecessor = async (origin, name) => {
	      expect((await p5cPost(`/origins/${origin.body.data.id}/outcome-preparations`, {},
	        `m26-p5c-worker-preparation-${uuid()}`, name)).status).toBe(201);
	      const definition = await p5cDefinition(advisoryAlternative, origin.body.data.id);
	      definition.methodVersion = 'm26-capacity-advisory-outcome-allocation-v1';
	      definition.originId = origin.body.data.id;
	      await p5cReview('outcome_demand', { alternativeKey: advisoryAlternative,
	        subjectId: origin.body.data.id, definition });
	      const outcome = await p5cPost(`/origins/${origin.body.data.id}/outcomes`, {},
	        `m26-p5c-worker-outcome-${uuid()}`, name);
	      expect(outcome.status).toBe(201);
	      expect((await p5cPost(`/origins/${origin.body.data.id}/evaluations`, {
	        outcomeId: outcome.body.data.id }, `m26-p5c-worker-evaluation-${uuid()}`, name)).status).toBe(201);
	    };
	    await prepareWorkerPredecessor(poisonOrigin, 'owner');
	    await prepareWorkerPredecessor(validOrigin, 'admin');
	    const poisonDemand = await p5cDefinition(advisoryAlternative);
	    await p5cReview('demand', { alternativeKey: advisoryAlternative, definition: poisonDemand,
	      continuationId: poisonContinuation.body.data.id });
	    await p5cReview('demand', { alternativeKey: advisoryAlternative, definition: poisonDemand,
	      continuationId: validContinuation.body.data.id });
	    await fixture.ownerPool.query(
	      "UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='m26_p5c_worker_isolation' WHERE id=$1",
	      [actor('owner').authSessionId]);
	    const isolationWorkers = [new CapacityAdvisoryContinuationWorker({ getPool: () => fixture.runtimePool, batchSize: 1 }),
	      new CapacityAdvisoryContinuationWorker({ getPool: () => fixture.runtimePool, batchSize: 1 })];
	    const isolationResults = await Promise.all(isolationWorkers.map(worker => worker.drainOnce()));
	    expect(isolationResults.reduce((sum, result) => sum + result.attempted, 0)).toBe(2);
	    // A source-lock serialization loser stays retryable. After the first
	    // server-owned lease, one serial recovery drain skips/retries the poison
	    // item and still activates the later valid reservation before deadline.
	    await new Promise(resolve => setTimeout(resolve, 1100));
	    const isolationRecovery = new CapacityAdvisoryContinuationWorker({
	      getPool: () => fixture.runtimePool, batchSize: 2 });
	    expect((await isolationRecovery.drainOnce()).attempted).toBeGreaterThanOrEqual(1);
	    const validContinuationRead = await p5cGet(`/continuations/${validContinuation.body.data.id}`, 'admin');
	    if (validContinuationRead.body.data.state !== 'capacity_advisory_continuation_activated') {
	      const validDiagnostic = (await fixture.ownerPool.query(
	        `SELECT canonical_forecast_capacity_advisory_v1_continuation_authority_current($1,value) authority_current,
	                canonical_forecast_capacity_advisory_v1_continuation_current($1,value) continuation_current,
	                (SELECT count(*)::integer FROM canonical_forecast_capacity_advisory_evaluations_v1 evaluation_value
	                  WHERE evaluation_value.organization_id=value.organization_id
	                    AND evaluation_value.origin_id=value.predecessor_origin_id) predecessor_evaluations,
	                (SELECT jsonb_agg(jsonb_build_object('id',review_value.id,'revision',review_value.revision,
	                  'action',review_value.action,'source',review_value.source_identity) ORDER BY review_value.revision)
	                   FROM canonical_forecast_capacity_advisory_reviews_v1 review_value
	                  WHERE review_value.organization_id=value.organization_id
	                    AND review_value.review_kind='demand') demand_reviews
	           FROM canonical_forecast_capacity_advisory_continuations_v1 value
	          WHERE value.organization_id=$1 AND value.id=$2`,
	        [fixture.org, validContinuation.body.data.id])).rows[0];
	      let demandDiagnostic;
	      try {
	        demandDiagnostic = (await fixture.ownerPool.query(
	          `SELECT canonical_forecast_capacity_advisory_v1_demand_manifest_period($1,'demand',NULL,$2,
	             canonical_forecast_workload_capacity_v1_origin_input($1,value.period_start,value.period_end)#>'{backlog,rows}',
	             canonical_forecast_constrained_capacity_v1_complete_input($1,value.period_start)) value
	             FROM canonical_forecast_capacity_advisory_continuations_v1 value
	            WHERE value.organization_id=$1 AND value.id=$2`,
	          [fixture.org, validContinuation.body.data.id])).rows[0]?.value;
	      } catch (error) { demandDiagnostic = { code: error.code, message: error.message }; }
	      let workloadCaptureDiagnostic;
	      let activationDiagnostic;
	      const diagnosticClient = await fixture.ownerPool.connect();
	      try {
	        await diagnosticClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
	        workloadCaptureDiagnostic = (await diagnosticClient.query(
	          `SELECT (canonical_forecast_capacity_advisory_v1_continuation_workload_capture($1,value)).id id
	             FROM canonical_forecast_capacity_advisory_continuations_v1 value
	            WHERE value.organization_id=$1 AND value.id=$2`,
	          [fixture.org, validContinuation.body.data.id])).rows[0];
	        workloadCaptureDiagnostic.results = (await diagnosticClient.query(
	          `SELECT canonical_forecast_capacity_advisory_v1_results($1,value.period_start,value.period_end,
	             value.period_start,canonical_forecast_constrained_capacity_v1_complete_input($1,value.period_start),
	             canonical_forecast_capacity_advisory_v1_policy_manifest($1,value.period_start),
	             canonical_forecast_capacity_advisory_v1_demand_manifest_period($1,'demand',NULL,value.id,
	               workload.input_evidence#>'{backlog,rows}',
	               canonical_forecast_constrained_capacity_v1_complete_input($1,value.period_start)),
	             workload.private_results) value
	             FROM canonical_forecast_capacity_advisory_continuations_v1 value
	             JOIN canonical_forecast_workload_capacity_origins_v1 workload
	               ON workload.organization_id=value.organization_id AND workload.id=$3
	            WHERE value.organization_id=$1 AND value.id=$2`,
	          [fixture.org, validContinuation.body.data.id, workloadCaptureDiagnostic.id])).rows[0]?.value;
	        await diagnosticClient.query('ROLLBACK');
	      } catch (error) {
	        await diagnosticClient.query('ROLLBACK').catch(() => {});
	        workloadCaptureDiagnostic = { code: error.code, message: error.message };
	      } finally { diagnosticClient.release(); }
	      const activationClient = await fixture.ownerPool.connect();
	      try {
	        await activationClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
	        activationDiagnostic = (await activationClient.query(
	          'SELECT canonical_forecast_capacity_advisory_v1_continuation_activate($1,$2) value',
	          [fixture.org, validContinuation.body.data.id])).rows[0]?.value;
	        await activationClient.query('ROLLBACK');
	      } catch (error) {
	        await activationClient.query('ROLLBACK').catch(() => {});
	        activationDiagnostic = { code: error.code, message: error.message };
	      } finally { activationClient.release(); }
	      throw new Error(`Valid isolated continuation did not activate: ${JSON.stringify({
	        validContinuationRead: validContinuationRead.body.data, validDiagnostic, demandDiagnostic,
	        workloadCaptureDiagnostic, activationDiagnostic })}`);
	    }
	    expect((await p5cGet(`/continuations/${poisonContinuation.body.data.id}`, 'admin')).body.data.state)
	      .toBe('capacity_advisory_continuation_pending');
	    await fixture.ownerPool.query(
	      "UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",
	      [actor('owner').authSessionId]);
	    await new Promise(resolve => setTimeout(resolve, 2200));
	    const restartedIsolationWorker = new CapacityAdvisoryContinuationWorker({
	      getPool: () => fixture.runtimePool, batchSize: 1 });
	    expect(await restartedIsolationWorker.drainOnce()).toEqual({ due: 1, attempted: 1 });
	    expect((await p5cGet(`/continuations/${poisonContinuation.body.data.id}`)).body.data.state)
	      .toBe('capacity_advisory_continuation_activated');

    // Exact replay belongs to the latest exact human revision for every
    // action. Obsolete reject and withdraw receipts cannot be reported as
    // restored after a later decision, and conflicts append no rows.
    const methodQuery = '/reviews/current?' + new URLSearchParams({ kind: 'method', alternativeKey: 'none',
      scopeKey: 'none', role: 'none', subjectId: 'none' }).toString();
    const staleReplay = async action => {
      const token = (await p5cGet(methodQuery)).body.data;
      const key = `m26-p5c-stale-${action}-${uuid()}`;
      const body = { kind: 'method', alternativeKey: null, scopeKey: null, role: null, subjectId: null,
        action, expectedRevision: token.expectedRevision, expectedDigest: token.expectedDigest,
        definition: { methodVersion: 'm26-capacity-advisory-five-category-v1' },
        reason: `Record the explicit ${action} decision for stale replay evidence.`, confirmed: true,
        confirmationVersion: 'm26-capacity-advisory-review-v1' };
      expect((await p5cPost('/reviews', body, key)).status).toBe(201);
      const after = (await p5cGet(methodQuery)).body.data;
      const restore = { ...body, action: 'approve', expectedRevision: after.expectedRevision,
        expectedDigest: after.expectedDigest,
        reason: `Restore the exact method after the explicit ${action} evidence.` };
      expect((await p5cPost('/reviews', restore)).status).toBe(201);
      const rows = Number((await fixture.ownerPool.query(
        'SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=$1',
        [fixture.org])).rows[0].count);
      expect((await p5cPost('/reviews', body, key)).status).toBe(409);
      expect((await p5cPost('/reviews', { ...body, reason: `${body.reason} changed` }, key)).status).toBe(409);
      expect(Number((await fixture.ownerPool.query(
        'SELECT count(*) count FROM canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=$1',
        [fixture.org])).rows[0].count)).toBe(rows);
    };
    await staleReplay('reject');
    await staleReplay('withdraw');

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
        'SELECT canonical_forecast_capacity_advisory_v1_prerequisites($1,$2,$3,$4) value',
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
      expect((await waiting).rows[0].value.state).toBe('capacity_advisory_prerequisites_current');
      await accessReader.query('COMMIT');
      await revoke; await subscriptionWriter.query('COMMIT');
      expect((await p5cGet('/prerequisites/current')).status).toBe(403);
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
