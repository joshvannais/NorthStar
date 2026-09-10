'use strict';
// One real disposable job. Only upstream account/lead/profile provisioning and
// explicitly synthetic reviewed equipment research use owner fixture SQL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const contracts = require('../../src/operations/contract');
const pin = row => ({ id: row.id, revision: Number(row.revision), digest: row.digest });

async function createJourney(ledger) {
  const f = await require('./m23-part9b-overview-fixture').createDatabaseFixture({ operationalSchedule: true });
  const steps = ledger.steps = [];
  const call = async (method, url, body, actor = 'owner', expected = null) => {
    let req = request(f.app)[method](url).set(f.actors[actor].session.headers);
    if (body) req = req.set('X-CSRF-Token', f.actors[actor].csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(body);
    const result = await req;
    assert.ok(expected ? result.status === expected : result.status >= 200 && result.status < 300,
      method + ' ' + url + ' ' + result.status + ' ' + JSON.stringify(result.body));
    steps.push({ method, url, actor, status: result.status, request: body || null, response: result.body });
    return result.body;
  };
  try {
    const skill = crypto.randomUUID();
    await f.ownerPool.query("UPDATE workforce_profiles SET home_location_id='headquarters' WHERE organization_id=$1", [f.org]);
    await f.ownerPool.query("INSERT INTO workforce_skills(id,organization_id,skill_key,name,service_id,created_by_user_id,updated_by_user_id) VALUES($1,$2,'plumbing','Plumbing','plumbing',$3,$3)", [skill,f.org,f.actors.owner.actorUserId]);
    await f.ownerPool.query('INSERT INTO workforce_profile_skills(organization_id,profile_id,skill_id,created_by_user_id) VALUES($1,$2,$3,$4)', [f.org,f.actors.member.actorUserId,skill,f.actors.owner.actorUserId]);
    const coverageStart = new Date(Date.now() - 86400000).toISOString(), coverageEnd = new Date(Date.now() + 86400000).toISOString();
    await call('put', '/api/v1/canonical/availability/profiles/' + f.actors.member.actorUserId, {
      expectedRevision: 0, expectedDigest: null, expectedTimeZone: 'UTC', coverageStart, coverageEnd,
      intervals: [{ kind: 'available', start: coverageStart, end: coverageEnd }], reason: 'Explicit synthetic availability declaration' });
    const work = await f.createExecution({ approvedScheduling: true, stopAfterScheduling: true,
      serviceType: 'plumbing', locationId: 'headquarters',
      title: 'Synthetic acceptance: kitchen sink repair', start: new Date(Date.now() + 60000).toISOString(),
      onSchedulingStep: step => steps.push({ boundary: 'mounted approved scheduling HTTP', ...step }) });
    const assignmentPins = { expectedAssignmentRevision: Number(work.assignment.revision), expectedAssignmentDigest: work.assignment.digest };
    work.execution = (await call('post', '/api/v1/field-executions/appointments/' + work.appointment,
      { ...assignmentPins, reason: 'Initialize exact synthetic acceptance job' }, 'member')).data;
    const base = '/api/v1/field-executions/' + work.execution.id;
    work.execution = (await call('post', base + '/transitions', { ...assignmentPins, action: 'start',
      expectedRevision: work.execution.revision, expectedDigest: work.execution.digest, reason: 'Assigned worker starts observed work' }, 'member')).data;
    const common = () => ({ ...assignmentPins, expectedExecutionRevision: work.execution.revision,
      expectedExecutionDigest: work.execution.digest, reason: 'Attributable synthetic acceptance evidence' });
    const performed = () => ({ ...common(), performerProfileId: f.actors.member.actorUserId });
    const profile = f.profiles[f.org];
    const laborCommon = () => ({ ...performed(), categoryContractVersion: contracts.LABOR_CATEGORY_CONTRACT_VERSION,
      categoryContractDigest: contracts.LABOR_CATEGORY_CONTRACT_DIGEST, businessProfileId: profile.businessProfileId,
      businessProfileVersion: profile.version, businessProfileHash: profile.hash, timeZone: profile.timeZone });
    const labor = (await call('post', base + '/labor-actions', { ...laborCommon(), action: 'record_manual', category: 'production',
      observedStart: new Date(Date.now() - 3600000).toISOString(), observedEnd: new Date(Date.now() - 1800000).toISOString() }, 'member')).data;
    await call('post', base + '/labor-actions', { ...laborCommon(), action: 'review', intervalId: labor.id,
      expectedIntervalRevision: labor.revision, expectedIntervalDigest: labor.digest, reviewOutcome: 'accepted' });
    const materialCommon = () => ({ ...performed(), unitContractVersion: contracts.MATERIAL_UNIT_CONTRACT_VERSION,
      unitContractDigest: contracts.MATERIAL_UNIT_CONTRACT_DIGEST });
    for (const movementKind of ['adjustment', 'consumed']) {
      const movement = (await call('post', base + '/material-actions', { ...materialCommon(), action: 'record', movementKind,
        itemKey: 'sink-seal', description: 'Recorded synthetic seal', quantity: movementKind === 'adjustment' ? '2' : '1', unitCode: 'ea',
        locationKey: 'van-01', ...(movementKind === 'adjustment' ? { adjustmentDirection: 'increase' } : {}) })).data.material;
      await call('post', base + '/material-actions', { ...materialCommon(), action: 'review', movementId: movement.id,
        expectedMovementRevision: movement.revision, expectedMovementDigest: movement.digest, reviewOutcome: 'accepted' });
    }
    const identity = { manufacturer: 'Example Manufacturer', model: 'Exact Test 350', modelYear: '2024', series: 'Test Series',
      engine: 'Test Engine', configuration: 'Test Configuration' };
    const now = new Date();
    const research = { schemaVersion: 1, identity, category: 'vehicle', categoryLabel: 'Trucks', specifications: [],
      sources: [{ url: 'https://manufacturer.example/manual', title: 'Synthetic acceptance fixture; no actual research', publisher: 'Example Manufacturer',
        sourceVersion: 'part12-fixture-v1', documentDigest: 'a'.repeat(64), accessedAt: now.toISOString() }],
      confidence: 'high', reviewedAt: now.toISOString(), freshUntil: new Date(+now + 86400000).toISOString(), state: 'approved' };
    await f.ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4)', [research, 'Synthetic fixture reviewer', 'b'.repeat(64), 'Fixture only; not external knowledge verification']);
    const draft = (await call('post', '/api/equipment/drafts', { entryPath: 'business_profile', message: '',
      identifiers: { ...identity, attachments: 'none', accessType: 'owned' }, useContext: 'Synthetic repair transport' })).data;
    await call('post', '/api/equipment/drafts/' + draft.id + '/actions', { action: 'confirm', expectedRevision: draft.revision,
      expectedDigest: draft.digest, confirmation: 'save_reviewed_asset' });
    for (const kind of ['check_out', 'use', 'check_in']) {
      const catalogue = await call('get', '/api/equipment/catalogue');
      const asset = catalogue.data.assets[0];
      await call('post', '/api/equipment/executions/' + work.execution.id + '/actions', { ...performed(), action: 'record',
        assetId: asset.id, assetVersion: asset.version, assetDigest: asset.assetDigest,
        knowledgeVersionId: asset.knowledgeVersionId, knowledgeDigest: asset.knowledgeDigest,
        expectedAssetRevision: asset.operationRevision, expectedAssetDigest: asset.operationDigest, kind,
        observedAt: new Date().toISOString(), meterKey: kind === 'use' ? 'engine' : null, reading: kind === 'use' ? '1' : null,
        unit: kind === 'use' ? 'hours' : null, description: 'Observed synthetic transport', correctsEventId: null });
    }
    const note = (await call('post', base + '/field-evidence-actions', { ...performed(), action: 'record_note',
      note: 'Replacement seal installed; observed dry under ordinary water flow.', caption: null }, 'member')).data;
    const checklist = (await call('post', base + '/field-evidence-actions', { ...performed(), action: 'create_checklist', template: null,
      items: [{ key: 'seal', prompt: 'Record observed seal condition', required: true }] })).data;
    await call('post', base + '/field-evidence-actions', { ...performed(), action: 'respond_item', checklistId: checklist.id,
      expectedChecklistRevision: checklist.revision, expectedChecklistDigest: checklist.digest, itemKey: 'seal', resultType: 'pass',
      observation: 'No drip observed.', measurement: null, exception: null, supportingEvidenceIds: [note.id] }, 'member');
    const inspection = (await call('post', base + '/field-evidence-actions', { ...performed(), action: 'record_observation',
      observationClass: 'inspection', resultType: 'pass', observation: 'Ordinary water flow observed without dripping.',
      measurement: null, exception: null, supportingEvidenceIds: [note.id] }, 'member')).data;
    const observation = { observedAt: new Date().toISOString(), timeZoneAuthority: profile, evidence: [pin(note)] };
    const progress = (await call('post', base + '/progress-actions', { ...performed(), action: 'record_progress', document: {
      kind: 'progress', workKey: 'sink-seal', description: 'One seal replaced.', ...observation,
      quantity: { completed: '1', total: '1', unit: 'ea' }, milestone: null, uncertainty: 'measured', uncertaintyReason: null } }, 'member')).data;
    const change = (await call('post', base + '/progress-actions', { ...performed(), action: 'record_change', document: {
      kind: 'field_change', description: 'Customer reported an adjacent drip.', ...observation, difference: 'requested',
      initiator: { source: 'customer_reported', description: 'Reported by assigned worker.' }, affectedWork: 'Adjacent connection',
      scheduleImplications: 'Separate human scheduling review required.', resourceImplications: 'Not priced or authorized.' } }, 'member')).data;
    for (const record of [progress, change]) await call('post', base + '/progress-actions', { ...performed(), action: 'review',
      recordId: record.id, expectedRecordRevision: record.revision, expectedRecordDigest: record.digest, document: { outcome: 'owner_confirmed' } });
    const sources = {};
    for (const domain of ['labor', 'materials', 'field-evidence', 'progress', 'intelligence', 'handoffs']) sources[domain] = await call('get', base + '/' + domain);
    assert.equal(sources.intelligence.data.providerUsed, false);
    assert.deepEqual(sources.intelligence.data.capabilities, []);
    assert.equal(sources.handoffs.data.consumptionAuthorized, false);
    const requirements = { checklists: [pin(checklist)], inspections: [pin(inspection)], files: [] };
    work.execution = (await call('post', base + '/completion-actions', { ...common(), action: 'propose_completion',
      expiresAt: new Date(Date.now() + 1800000).toISOString(), gateRequirements: requirements }, 'member')).data;
    ledger.identity = { organizationId: f.org, appointmentId: work.appointment, assignment: work.assignment, executionId: work.execution.id };
    ledger.provisioningBoundary = 'Synthetic account/profile/lead seed and reviewed equipment fixture only; actual assign/dispatch approval and all execution/evidence actions through mounted HTTP. No disabled authority triggers.';
    return { f, work, call, base, common, sources };
  } catch (error) { await f.cleanup(); throw error; }
}
module.exports = { createJourney, pin };
