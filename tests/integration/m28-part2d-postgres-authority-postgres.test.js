'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const canonical = require('../../src/automation/canonicalJson');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const quote = value => `"${String(value).replace(/"/g, '""')}"`;
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000029';

function roleUrl(connectionString, role) {
  const url = new URL(connectionString);
  url.username = role;
  url.password = '';
  return url.toString();
}

function digest(namespace, value) {
  return canonical.digest(namespace, value);
}

const PREFERRED_PARENT = {
  proposed_action: 'eligibility_evaluation', approval: 'proposed_action', scheduled_run: 'approval',
  action_unit: 'scheduled_run', provider_attempt: 'action_unit', provider_acknowledgement: 'provider_attempt',
  delivery_state: 'provider_acknowledgement', reply_opt_out: 'delivery_state', internal_task: 'proposed_action',
  suppression: 'eligibility_evaluation', cancellation: 'action_unit', reconciliation: 'provider_attempt',
  terminal_outcome: 'action_unit',
};

function buildRecordLedger(model) {
  const records = [];
  for (let index = 0; index < model.recordDefinitions.length; index += 1) {
    const definition = model.recordDefinitions[index];
    const parentType = PREFERRED_PARENT[definition.recordType];
    const parent = parentType ? records.find(item => item.recordType === parentType) : null;
    const record = {
      schemaVersion: 'mission28.record.v1', tenantId: TENANT,
      recordId: `00000000-0000-4000-8000-${String(101 + index).padStart(12, '0')}`,
      runId: model.fixtureContract.runId, recordType: definition.recordType, causalOrdinal: index + 1,
      policyBinding: { tenantId: TENANT, policyId: model.fixtureContract.policyId,
        policyVersion: model.fixtureContract.policyVersion, policyDigest: model.fixtureContract.policyDigest },
      sourceBindings: [JSON.parse(JSON.stringify(model.fixtureContract.sourceBinding))],
      causalParents: parent ? [{ recordId: parent.recordId, recordType: parent.recordType,
        recordDigest: parent.recordDigest }] : [],
      classification: { authorityClass: definition.authorityClass, recordClass: definition.recordClass,
        effectClaim: definition.effectClaim },
      currentness: { policyState: 'contract_fixture_unverified', sourceState: 'contract_fixture_unverified',
        marker: 'contract_fixture_unverified' },
      payload: JSON.parse(JSON.stringify(definition.fixturePayload)), payloadDigest: '', recordDigest: '',
    };
    if (record.recordType === 'eligibility_evaluation')
      record.payload.sourceSetDigest = digest(model.canonicalization.sourceSetNamespace, record.sourceBindings);
    if (record.recordType === 'provider_acknowledgement') record.payload.providerAttemptDigest = parent.recordDigest;
    if (record.recordType === 'cancellation') record.payload.targetRecordId = parent.recordId;
    if (record.recordType === 'reconciliation') record.payload.reconciledRecordIds = record.causalParents.map(item => item.recordId);
    record.payloadDigest = digest(model.canonicalization.payloadNamespace, record.payload);
    const withoutDigest = { ...record }; delete withoutDigest.recordDigest;
    record.recordDigest = digest(model.canonicalization.recordNamespace, withoutDigest);
    records.push(record);
  }
  return records;
}

function buildLifecycle(model, operation, previous, prior, sourceSnapshotBinding, options = {}) {
  const rule = model.operationDefinitions.find(item => item.operation === operation);
  const validation = [...prior].reverse().find(item => item.operation === 'validate');
  const preview = [...prior].reverse().find(item => item.operation === 'preview');
  const event = {
    schemaVersion: 'mission28.policy.lifecycle.event.v1', tenantId: TENANT,
    lifecycleEventId: `00000000-0000-4000-8000-${String((options.eventIdBase || 300) + prior.length + 1).padStart(12, '0')}`,
    policyBinding: JSON.parse(JSON.stringify(options.policyBinding || { tenantId: TENANT,
      policyId: model.fixtureContract.policyId, policyVersion: model.fixtureContract.policyVersion,
      policyDigest: model.fixtureContract.policyDigest })),
    lifecycleSequence: prior.length + 1, operation, eventClass: rule.eventClass,
    fromState: previous ? previous.toState : null, toState: rule.toState,
    predecessorBinding: previous ? { lifecycleEventId: previous.lifecycleEventId,
      eventDigest: previous.eventDigest, operation: previous.operation, toState: previous.toState } : null,
    idempotencyDigest: '',
    sourceSnapshotBinding: JSON.parse(JSON.stringify(sourceSnapshotBinding)),
    requirementBindings: {
      validationEventDigest: rule.requiresValidation ? validation?.eventDigest || null : null,
      previewEventDigest: rule.requiresPreview ? preview?.eventDigest || null : null,
      authorityEvidenceDigest: rule.requiresAuthority ? model.fixtureContract.grammarAuthorityEvidenceDigest : null,
      trustedTimeEvidenceDigest: rule.requiresTrustedTime ? model.fixtureContract.grammarTrustedTimeEvidenceDigest : null,
    },
    relatedPolicyBinding: options.relatedPolicyBinding ? JSON.parse(JSON.stringify(options.relatedPolicyBinding)) : null,
    rollbackPredecessorBinding: options.rollbackPredecessorBinding
      ? JSON.parse(JSON.stringify(options.rollbackPredecessorBinding)) : null,
    currentness: { policyState: 'contract_fixture_unverified', sourceState: 'contract_fixture_unverified',
      marker: 'contract_fixture_unverified' },
    payload: { reasonCode: `${operation}_contract_fixture`, grammarFixtureOnly: true, externalEffects: 0 },
    payloadDigest: '', eventDigest: '',
  };
  event.idempotencyDigest = digest(model.canonicalization.idempotencyNamespace, {
    tenantId: event.tenantId, policyBinding: event.policyBinding,
    lifecycleSequence: event.lifecycleSequence, operation: event.operation,
    predecessorEventDigest: event.predecessorBinding?.eventDigest || null,
    relatedPolicyBinding: event.relatedPolicyBinding,
    rollbackPredecessorBinding: event.rollbackPredecessorBinding,
  });
  event.payloadDigest = digest(model.canonicalization.payloadNamespace, event.payload);
  const withoutDigest = { ...event }; delete withoutDigest.eventDigest;
  event.eventDigest = digest(model.canonicalization.eventNamespace, withoutDigest);
  return event;
}

function policyBinding(policy) {
  return { tenantId: policy.tenantId, policyId: policy.policyId,
    policyVersion: policy.version, policyDigest: policy.canonicalDigest };
}

function redigestLifecycle(event, model) {
  event.idempotencyDigest = digest(model.canonicalization.idempotencyNamespace, {
    tenantId: event.tenantId, policyBinding: event.policyBinding,
    lifecycleSequence: event.lifecycleSequence, operation: event.operation,
    predecessorEventDigest: event.predecessorBinding?.eventDigest || null,
    relatedPolicyBinding: event.relatedPolicyBinding,
    rollbackPredecessorBinding: event.rollbackPredecessorBinding,
  });
  event.payloadDigest = digest(model.canonicalization.payloadNamespace, event.payload);
  const withoutDigest = { ...event }; delete withoutDigest.eventDigest;
  event.eventDigest = digest(model.canonicalization.eventNamespace, withoutDigest);
  return event;
}

realPostgres('Mission 28 Part 2D PostgreSQL authority through migration 273', () => {
  let database; let ownerPool; let runtimePool; let roles; let migrations; let storedFixture;
  const db = require('../../src/db');
  const policyModel = readJson('docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json');
  const recordModel = readJson('docs/architecture/MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.json');
  const lifecycleModel = readJson('docs/architecture/MISSION_28_PART2C_POLICY_LIFECYCLE.json');

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p2d-authority');
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    roles = { owner: `m28p2d_owner_${suffix}`, runtime: `m28p2d_runtime_${suffix}` };
    const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
    await admin.connect();
    try {
      for (const role of Object.values(roles))
        await admin.query(`CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await admin.query(`ALTER DATABASE ${quote(database.databaseName)} OWNER TO ${quote(roles.owner)}`);
    } finally { await admin.end(); }
    ownerPool = new Pool({ connectionString: roleUrl(database.connectionString, roles.owner), max: 3 });
    runtimePool = new Pool({ connectionString: roleUrl(database.connectionString, roles.runtime), max: 2 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p2d-through272-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 272))
      fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    await db.runMigrations({ pool: ownerPool, runtimePool, migrationsDirectory: migrations });
    await ownerPool.query(`INSERT INTO public.organizations(id,name,email) VALUES
      ($1,'Mission 28 Part 2D tenant','m28-part2d@example.test'),
      ($2,'Mission 28 Part 2D other','m28-part2d-other@example.test')`, [TENANT, OTHER_TENANT]);
  }, 240000);

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (ownerPool) await ownerPool.end();
    if (database) await database.cleanup();
    if (roles) {
      const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
      await admin.connect();
      try { for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS ${quote(role)}`); }
      finally { await admin.end(); }
    }
    if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('upgrades additively from 272, replays once and exposes no runtime authority', async () => {
    expect((await ownerPool.query('SELECT max(substring(filename,1,3)::integer) latest FROM public._migrations')).rows[0].latest)
      .toBe(272);
    expect((await ownerPool.query("SELECT to_regclass('public.canonical_automation_policy_versions_v1') authority")).rows[0].authority)
      .toBeNull();
    fs.copyFileSync(path.join(ROOT, 'migrations', '273_canonical_automation_authority_v1.sql'),
      path.join(migrations, '273_canonical_automation_authority_v1.sql'));
    await expect(db.runMigrations({ pool: ownerPool, runtimePool, migrationsDirectory: migrations })).resolves.toBe(true);
    const applied = (await ownerPool.query("SELECT filename,checksum FROM public._migrations WHERE filename LIKE '273_%'")).rows;
    expect(applied).toHaveLength(1);
    await expect(db.runMigrations({ pool: ownerPool, runtimePool, migrationsDirectory: migrations })).resolves.toBe(true);
    expect((await ownerPool.query("SELECT filename,checksum FROM public._migrations WHERE filename LIKE '273_%'")).rows)
      .toEqual(applied);
    expect((await ownerPool.query(`SELECT
      has_table_privilege($1,'public.canonical_automation_policy_versions_v1','SELECT') table_read,
      has_table_privilege($1,'public.canonical_automation_source_bindings_v1','INSERT') source_write,
      has_table_privilege($1,'public.canonical_automation_source_sets_v1','INSERT') source_set_write,
      has_function_privilege($1,'public.canonical_automation_store_policy_v1(text)','EXECUTE') policy_write,
      has_function_privilege('public','public.canonical_automation_storage_snapshot_v1(uuid,uuid)','EXECUTE') public_read`,
    [roles.runtime])).rows[0]).toEqual({ table_read: false, source_write: false, source_set_write: false,
      policy_write: false, public_read: false });
  }, 240000);

  test('stores exact policy, source, lifecycle, record and historical authority and survives a new connection', async () => {
    const policyV1 = policyModel.canonicalExamples[0];
    const policyV2 = policyModel.canonicalExamples[1];
    for (const policy of [policyV1, policyV2]) {
      const result = (await ownerPool.query('SELECT public.canonical_automation_store_policy_v1($1) result',
        [canonical.canonicalize(policy)])).rows[0].result;
      expect(result).toMatchObject({ state: 'stored', replayed: false, canonicalDigest: policy.canonicalDigest });
    }
    const source = recordModel.fixtureContract.sourceBinding;
    expect((await ownerPool.query('SELECT public.canonical_automation_store_source_binding_v1($1) result',
      [canonical.canonicalize(source)])).rows[0].result).toMatchObject({ state: 'stored', replayed: false });
    const sourceSet = { tenantId: TENANT, sourceBindings: [source], currentnessMarker: 'contract_fixture_unverified',
      sourceSetDigest: digest(recordModel.canonicalization.sourceSetNamespace, [source]) };
    expect((await ownerPool.query('SELECT public.canonical_automation_store_source_set_v1($1) result',
      [canonical.canonicalize(sourceSet)])).rows[0].result).toMatchObject({ state: 'stored', replayed: false });

    const events = [];
    for (const operation of ['draft_create', 'validate', 'preview', 'activate']) {
      const event = buildLifecycle(lifecycleModel, operation, events.at(-1), events, {
        tenantId: TENANT, sourceSetDigest: sourceSet.sourceSetDigest,
        currentnessMarker: sourceSet.currentnessMarker,
      });
      events.push(event);
      expect((await ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1) result',
        [canonical.canonicalize(event)])).rows[0].result).toMatchObject({ state: 'stored', replayed: false });
    }

    const records = buildRecordLedger(recordModel);
    for (const recordItem of records) {
      expect((await ownerPool.query('SELECT public.canonical_automation_store_record_v1($1) result',
        [canonical.canonicalize(recordItem)])).rows[0].result).toMatchObject({ state: 'stored', replayed: false });
    }
    const record = records[0];

    const active = events.at(-1);
    const binding = {
      tenantId: TENANT, runId: record.runId, policyBinding: record.policyBinding,
      sourceSnapshotBinding: { tenantId: TENANT, sourceSetDigest: record.payload.sourceSetDigest,
        currentnessMarker: 'contract_fixture_unverified' },
      createdByLifecycleEventBinding: { lifecycleEventId: active.lifecycleEventId, eventDigest: active.eventDigest,
        operation: active.operation, toState: active.toState },
      lifecycleStateAtCreation: 'active', immutable: true, bindingDigest: '',
    };
    const bindingWithoutDigest = { ...binding }; delete bindingWithoutDigest.bindingDigest;
    binding.bindingDigest = digest(lifecycleModel.canonicalization.historicalRunNamespace, bindingWithoutDigest);
    expect((await ownerPool.query('SELECT public.canonical_automation_store_historical_run_binding_v1($1) result',
      [canonical.canonicalize(binding)])).rows[0].result).toMatchObject({ state: 'stored', replayed: false });
    storedFixture = { source, sourceSet, events, records, binding };

    const restarted = new Pool({ connectionString: roleUrl(database.connectionString, roles.owner), max: 1 });
    try {
      const snapshot = (await restarted.query('SELECT public.canonical_automation_storage_snapshot_v1($1,$2) snapshot',
        [TENANT, record.policyBinding.policyId])).rows[0].snapshot;
      expect(snapshot).toMatchObject({ contractVersion: 'mission28.postgresql.authority.v1', tenantId: TENANT,
        policyId: record.policyBinding.policyId, runtimeWriteAuthorityAvailable: false,
        providerCalls: 0, externalEffects: 0, upstreamMutations: 0, moneyEffects: 0,
        legacyConversionReviewCount: 0 });
      expect(snapshot.policies).toHaveLength(2);
      expect(snapshot.sourceBindings).toEqual([source]);
      expect(snapshot.sourceSets).toEqual([sourceSet]);
      expect(snapshot.lifecycleEvents).toHaveLength(4);
      expect(snapshot.records).toEqual(records);
      expect(snapshot.historicalRunBindings).toEqual([binding]);
    } finally { await restarted.end(); }
  }, 120000);

  test('resolves supersession and bounded rollback against exact stored policies and lifecycle evidence', async () => {
    const sourceSnapshot = { tenantId: TENANT, sourceSetDigest: storedFixture.sourceSet.sourceSetDigest,
      currentnessMarker: storedFixture.sourceSet.currentnessMarker };
    const policyV1 = policyModel.canonicalExamples[0];
    const policyV2 = policyModel.canonicalExamples[1];
    const v1Events = [];
    for (const operation of ['draft_create', 'validate', 'preview', 'activate', 'retire']) {
      const event = buildLifecycle(lifecycleModel, operation, v1Events.at(-1), v1Events, sourceSnapshot,
        { eventIdBase: 400, policyBinding: policyBinding(policyV1) });
      v1Events.push(event);
      await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
        [canonical.canonicalize(event)])).resolves.toBeDefined();
    }

    const policyV3 = JSON.parse(JSON.stringify(policyV2));
    policyV3.version = 3;
    policyV3.previousVersionDigest = policyV2.canonicalDigest;
    const v3WithoutDigest = { ...policyV3 }; delete v3WithoutDigest.canonicalDigest;
    policyV3.canonicalDigest = digest(policyModel.canonicalization.namespace, v3WithoutDigest);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_policy_v1($1)',
      [canonical.canonicalize(policyV3)])).resolves.toBeDefined();

    const rollbackRelated = {
      relation: 'rollback_source', policyBinding: policyBinding(policyV1),
      activationEventDigest: v1Events.find(event => event.operation === 'activate').eventDigest,
      terminalEventDigest: v1Events.find(event => event.operation === 'retire').eventDigest,
    };
    const rollbackPredecessor = {
      immediatePredecessorPolicyBinding: policyBinding(policyV2),
      targetPreviousVersionDigest: policyV2.canonicalDigest,
    };
    const rollbackEvents = [];
    const rollbackDraft = buildLifecycle(lifecycleModel, 'bounded_rollback_draft', null, rollbackEvents,
      sourceSnapshot, { eventIdBase: 500, policyBinding: policyBinding(policyV3),
        relatedPolicyBinding: rollbackRelated, rollbackPredecessorBinding: rollbackPredecessor });

    const wrongPredecessor = JSON.parse(JSON.stringify(rollbackDraft));
    wrongPredecessor.lifecycleEventId = '00000000-0000-4000-8000-000000000599';
    wrongPredecessor.rollbackPredecessorBinding.targetPreviousVersionDigest = `sha256:${'9'.repeat(64)}`;
    redigestLifecycle(wrongPredecessor, lifecycleModel);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
      [canonical.canonicalize(wrongPredecessor)])).rejects.toThrow(/rollback binding invalid/);

    const wrongEvidence = JSON.parse(JSON.stringify(rollbackDraft));
    wrongEvidence.lifecycleEventId = '00000000-0000-4000-8000-000000000598';
    wrongEvidence.relatedPolicyBinding.activationEventDigest = `sha256:${'8'.repeat(64)}`;
    redigestLifecycle(wrongEvidence, lifecycleModel);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
      [canonical.canonicalize(wrongEvidence)])).rejects.toThrow(/rollback authority unavailable/);

    rollbackEvents.push(rollbackDraft);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
      [canonical.canonicalize(rollbackDraft)])).resolves.toBeDefined();
    for (const operation of ['validate', 'preview', 'activate']) {
      const event = buildLifecycle(lifecycleModel, operation, rollbackEvents.at(-1), rollbackEvents,
        sourceSnapshot, { eventIdBase: 500, policyBinding: policyBinding(policyV3) });
      rollbackEvents.push(event);
      await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
        [canonical.canonicalize(event)])).resolves.toBeDefined();
    }

    const successor = {
      relation: 'successor', policyBinding: policyBinding(policyV3),
      activationEventDigest: rollbackEvents.find(event => event.operation === 'activate').eventDigest,
      terminalEventDigest: null,
    };
    const supersede = buildLifecycle(lifecycleModel, 'supersede', storedFixture.events.at(-1),
      storedFixture.events, sourceSnapshot, { eventIdBase: 300, policyBinding: policyBinding(policyV2),
        relatedPolicyBinding: successor });
    const forgedSuccessor = JSON.parse(JSON.stringify(supersede));
    forgedSuccessor.lifecycleEventId = '00000000-0000-4000-8000-000000000397';
    forgedSuccessor.relatedPolicyBinding.activationEventDigest = `sha256:${'7'.repeat(64)}`;
    redigestLifecycle(forgedSuccessor, lifecycleModel);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
      [canonical.canonicalize(forgedSuccessor)])).rejects.toThrow(/successor authority unavailable/);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
      [canonical.canonicalize(supersede)])).resolves.toBeDefined();

    const unrelated = JSON.parse(JSON.stringify(storedFixture.events[0]));
    unrelated.lifecycleEventId = '00000000-0000-4000-8000-000000000396';
    unrelated.relatedPolicyBinding = successor;
    redigestLifecycle(unrelated, lifecycleModel);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
      [canonical.canonicalize(unrelated)])).rejects.toThrow(/unrelated lifecycle binding denied/);
  }, 120000);

  test('denies coherent source-set, lifecycle, record, history and tenant rebinding attacks', async () => {
    const missingSource = { ...storedFixture.source,
      sourceRecordId: '00000000-0000-4000-8000-000000000099' };
    const missingSet = { tenantId: TENANT, sourceBindings: [missingSource],
      currentnessMarker: 'contract_fixture_unverified',
      sourceSetDigest: digest(recordModel.canonicalization.sourceSetNamespace, [missingSource]) };
    await expect(ownerPool.query('SELECT public.canonical_automation_store_source_set_v1($1)',
      [canonical.canonicalize(missingSet)])).rejects.toThrow(/source set authority invalid/);

    const contradictorySet = JSON.parse(JSON.stringify(storedFixture.sourceSet));
    contradictorySet.currentnessMarker = 'exact_current_not_runtime_revalidated';
    await expect(ownerPool.query('SELECT public.canonical_automation_store_source_set_v1($1)',
      [canonical.canonicalize(contradictorySet)])).rejects.toThrow(/source set currentness invalid/);

    const missingLifecycle = JSON.parse(JSON.stringify(storedFixture.events[0]));
    missingLifecycle.lifecycleEventId = '00000000-0000-4000-8000-000000000399';
    missingLifecycle.sourceSnapshotBinding.sourceSetDigest = `sha256:${'9'.repeat(64)}`;
    redigestLifecycle(missingLifecycle, lifecycleModel);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_lifecycle_event_v1($1)',
      [canonical.canonicalize(missingLifecycle)])).rejects.toThrow(/lifecycle source authority unavailable/);

    const secondSource = { ...storedFixture.source,
      sourceRecordId: '00000000-0000-4000-8000-000000000098', sourceDigest: `sha256:${'8'.repeat(64)}` };
    await expect(ownerPool.query('SELECT public.canonical_automation_store_source_binding_v1($1)',
      [canonical.canonicalize(secondSource)])).resolves.toBeDefined();
    const unregisteredRecord = JSON.parse(JSON.stringify(storedFixture.records[0]));
    unregisteredRecord.recordId = '00000000-0000-4000-8000-000000000198';
    unregisteredRecord.runId = '00000000-0000-4000-8000-000000000198';
    unregisteredRecord.sourceBindings = [secondSource];
    unregisteredRecord.payload.sourceSetDigest = digest(recordModel.canonicalization.sourceSetNamespace, [secondSource]);
    unregisteredRecord.payloadDigest = digest(recordModel.canonicalization.payloadNamespace, unregisteredRecord.payload);
    const recordWithoutDigest = { ...unregisteredRecord }; delete recordWithoutDigest.recordDigest;
    unregisteredRecord.recordDigest = digest(recordModel.canonicalization.recordNamespace, recordWithoutDigest);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_record_v1($1)',
      [canonical.canonicalize(unregisteredRecord)])).rejects.toThrow(/record source set unavailable/);

    const rebound = JSON.parse(JSON.stringify(storedFixture.binding));
    rebound.runId = '00000000-0000-4000-8000-000000000197';
    rebound.sourceSnapshotBinding.sourceSetDigest = `sha256:${'9'.repeat(64)}`;
    const reboundWithoutDigest = { ...rebound }; delete reboundWithoutDigest.bindingDigest;
    rebound.bindingDigest = digest(lifecycleModel.canonicalization.historicalRunNamespace, reboundWithoutDigest);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_historical_run_binding_v1($1)',
      [canonical.canonicalize(rebound)])).rejects.toThrow(/historical authority unavailable/);

    const client = await ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('northstar.automation_tenant_id',$1,TRUE)", [TENANT]);
      expect((await client.query('SELECT count(*)::int count FROM public.canonical_automation_source_bindings_v1 WHERE organization_id=$1',
        [OTHER_TENANT])).rows[0].count).toBe(0);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  }, 120000);

  test('fails closed on noncanonical, tampered, noncurrent, cross-tenant and mutable inputs', async () => {
    const policy = policyModel.canonicalExamples[1];
    await expect(ownerPool.query('SELECT public.canonical_automation_store_policy_v1($1)',
      [JSON.stringify(policy)])).rejects.toThrow(/canonical document is not exact/);
    const tampered = JSON.parse(JSON.stringify(policy)); tampered.limits.maxMoneyEffects = 1;
    const withoutDigest = JSON.parse(JSON.stringify(tampered)); delete withoutDigest.canonicalDigest;
    tampered.canonicalDigest = digest(policyModel.canonicalization.namespace, withoutDigest);
    await expect(ownerPool.query('SELECT public.canonical_automation_store_policy_v1($1)',
      [canonical.canonicalize(tampered)])).rejects.toThrow(/policy authority invalid/);
    await expect(runtimePool.query('SELECT * FROM public.canonical_automation_policy_versions_v1'))
      .rejects.toThrow(/permission denied/);
    await expect(ownerPool.query('UPDATE public.canonical_automation_policy_versions_v1 SET source_origin=source_origin'))
      .rejects.toThrow(/append-only/);
    const crossTenantSource = { ...recordModel.fixtureContract.sourceBinding, tenantId: OTHER_TENANT };
    await expect(ownerPool.query('SELECT public.canonical_automation_store_source_binding_v1($1)',
      [canonical.canonicalize(crossTenantSource)])).resolves.toBeDefined();
    const otherSnapshot = (await ownerPool.query('SELECT public.canonical_automation_storage_snapshot_v1($1,$2) snapshot',
      [OTHER_TENANT, recordModel.fixtureContract.policyId])).rows[0].snapshot;
    expect(otherSnapshot.policies).toEqual([]);
    expect(otherSnapshot.records).toEqual([]);
    expect(otherSnapshot.sourceBindings).toEqual([crossTenantSource]);
  }, 120000);

  test('enforces forced RLS, exact bounds, UTC trusted time, indexes, retention and zero conversion', async () => {
    const metadata = (await ownerPool.query(`SELECT relname,relrowsecurity,relforcerowsecurity
      FROM pg_class WHERE relname LIKE 'canonical_automation_%_v1' AND relkind='r' ORDER BY relname`)).rows;
    expect(metadata.filter(row => row.relname !== 'canonical_automation_retention_classes_v1')
      .every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await ownerPool.query(`SELECT count(*)::int count FROM public.canonical_automation_retention_classes_v1
      WHERE disposition='retain_no_automatic_deletion_pending_review' AND deletion_authority_available=FALSE`)).rows[0].count)
      .toBe(7);
    expect((await ownerPool.query('SELECT count(*)::int count FROM public.canonical_automation_legacy_conversion_reviews_v1')).rows[0].count)
      .toBe(0);
    expect((await ownerPool.query(`SELECT count(*)::int count FROM pg_indexes
      WHERE schemaname='public' AND indexname LIKE 'canonical_automation_%'`)).rows[0].count).toBeGreaterThanOrEqual(10);
    const utc = (await ownerPool.query("SET TIME ZONE 'Pacific/Honolulu'; SELECT public.canonical_automation_utc_v1(statement_timestamp()) value")).at(-1).rows[0].value;
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const tooManyNodes = JSON.stringify({ values: Array.from({ length: 256 }, (_, i) =>
      Array.from({ length: 9 }, () => i)) });
    await expect(ownerPool.query('SELECT public.canonical_automation_document_v1($1)', [tooManyNodes]))
      .rejects.toThrow(/not exact/);
    const unicodeCanonical = canonical.canonicalize({ '\u{10000}': 2, '\uE000': 1 });
    expect(unicodeCanonical).toBe('{"\uE000":1,"\u{10000}":2}');
    expect((await ownerPool.query('SELECT public.canonical_automation_json_v1($1::jsonb) value',
      [unicodeCanonical])).rows[0].value).toBe(unicodeCanonical);
  }, 120000);
});
