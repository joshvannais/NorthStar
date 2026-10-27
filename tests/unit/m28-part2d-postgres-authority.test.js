'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const canonical = require('../../src/automation/canonicalJson');

const MODEL_PATH = 'docs/architecture/MISSION_28_PART2D_POSTGRES_AUTHORITY.json';
const NARRATIVE_PATH = 'docs/architecture/MISSION_28_PART2D_POSTGRES_AUTHORITY.md';
const MIGRATION_PATH = 'migrations/273_canonical_automation_authority_v1.sql';
const ROADMAP_PATH = 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md';
const LEDGER_PATH = 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md';
const PART2C_MAIN = '1d52b675d8d2bbe9065c220ff3719460bd530f38';

function normalizedLfSha256(relative) {
  const normalized = read(relative).replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('lone CR denied');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toUpperCase();
}

describe('Mission 28 Part 2D PostgreSQL authority', () => {
  test('binds the released Part 2C baseline and every frozen input exactly', () => {
    const model = parse(MODEL_PATH);
    expect(model.contractVersion).toBe('mission28.part2d.postgresql.authority.v1');
    expect(model.authority).toMatchObject({
      mission: 28, part: '2D', state: 'implementation_candidate_only',
      baselineCommit: PART2C_MAIN, databaseAuthorityGranted: true,
      runtimeStorageCapabilityGranted: false, policyActivationGranted: false,
      providerAuthorityGranted: false, externalEffectAuthorityGranted: false,
    });
    expect(model.part2CRelease).toMatchObject({
      acceptedSourceHead: '69d4a375a4971ab98310872b9382cba92f5a67c0', pullRequest: 555,
      mergedMain: PART2C_MAIN, deployment: '036663b4-a364-4c3a-9842-5e1686164be0',
      deploymentState: 'SUCCESS_RUNNING', auditVerdict: 'P0=0 P1=0 P2=0 P3=0',
    });
    for (const input of model.frozenInputs) expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
  });

  test('defines the complete bounded authority without a runtime or effect grant', () => {
    const model = parse(MODEL_PATH);
    expect(model.migration).toMatchObject({ number: 273, additiveOnly: true, preMigrationLatest: 272,
      destructiveDataChange: false, legacyDiscoveryOrAdoption: false,
      applicationRouteWorkerOrProviderMount: false });
    expect(model.tables.map(item => item.name)).toEqual([
      'canonical_automation_policy_versions_v1', 'canonical_automation_source_bindings_v1',
      'canonical_automation_source_sets_v1',
      'canonical_automation_lifecycle_events_v1',
      'canonical_automation_records_v1', 'canonical_automation_historical_run_bindings_v1',
      'canonical_automation_legacy_conversion_reviews_v1', 'canonical_automation_retention_classes_v1',
    ]);
    expect(model.tenantRls).toMatchObject({ enabledAndForced: true, tenantKey: 'organization_id',
      runtimeDirectTablePrivileges: 'none',
      runtimeFunctionPrivileges: 'none_until_later_capability_and_approval_authority' });
    expect(model.availability).toEqual({
      databaseSchemaAndOwnerOnlyContractStorage: true,
      runtimePolicyWriteReadOrActivation: false,
      routesUiDemoSchedulerWorkerQueueOrProvider: false,
      providerCallsAllowed: 0, externalRecipientsOrMessagesAllowed: 0,
      externalEffectsAllowed: 0, upstreamMutationsAllowed: 0,
      accountingEffectsAllowed: 0, moneyEffectsAllowed: 0,
    });
    expect(model.retention.automaticDeletionAvailable).toBe(false);
    expect(model.digestAndCurrentness).toMatchObject({
      lifecycleSourceSetMustResolveFromStoredAuthority: true,
      causalParentScope: 'exact_same_tenant_run_policy_id_and_policy_version',
      historicalRunCausality: 'policy_and_run_locked_bound_active_event_strictly_precedes_every_run_record_and_is_latest_lifecycle_state_at_first_record',
      historicalRunScope: 'every_run_record_has_exact_policy_id_policy_version_and_source_set_digest',
      historicalRunProspectiveRule: 'existing_binding_permanently_rejects_later_record_policy_or_source_rebinding_under_run_lock_exact_record_replay_preserved',
      recordLedgerOrderingRule: 'new_record_causal_ordinal_strictly_exceeds_current_run_maximum_under_run_lock_exact_record_replay_preserved',
      terminalUnresolvedRule: 'ordered_unique_subset_of_direct_terminal_parent_record_ids',
      sourceStateAggregation: 'source_state_and_source_set_marker_derive_only_from_exact_source_bindings',
      recordMarkerAggregation: 'record_marker_derives_from_policy_state_plus_independently_derived_source_state',
      exactJsonGrammarRule: 'all_required_top_and_nested_values_use_exact_json_types_null_safe_comparison_and_exact_key_sets_before_cast_or_authority_resolution',
      lifecyclePredecessorRule: 'sequence_one_only_draft_create_or_bounded_rollback_draft_with_null_predecessor_every_later_event_requires_exact_non_null_immediate_predecessor',
      lifecycleSerialization: 'one_tenant_policy_lock_before_current_or_related_version_lifecycle_reads',
      lifecycleReplayRule: 'same_event_id_digest_and_canonical_text_replays_before_later_expiry_or_related_policy_state_revalidation_conflicting_identity_denied',
      unrelatedLifecycleBindings: 'deny',
      nonCurrentMayGrantActiveAuthority: false,
    });
    expect(model.digestAndCurrentness.supersessionRule).toContain('latest_state_active_and_no_terminal_event');
    expect(model.digestAndCurrentness.boundedRollbackRule).toContain('exact_stored_immediate_predecessor');
    expect(model.digestAndCurrentness.trustedExpiryRule).toContain('database_statement_time');
    expect(model.legacyConversion).toMatchObject({ automaticDiscovery: 'deny', automaticImport: 'deny',
      legacyRowCountAfterMigration: 0, reviewedConversionWritePath: 'unavailable' });
  });

  test('production canonicalizer matches every released namespace fixture', () => {
    const policy = parse('docs/architecture/MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json');
    for (const version of policy.canonicalExamples) {
      const withoutDigest = { ...version };
      delete withoutDigest.canonicalDigest;
      expect(canonical.digest(policy.canonicalization.namespace, withoutDigest)).toBe(version.canonicalDigest);
      expect(canonical.parseCanonical(canonical.canonicalize(version))).toEqual(version);
    }
    expect(canonical.limits).toEqual({ maxBytes: 65536, maxDepth: 24, maxNodes: 2048,
      maxObjectKeys: 128, maxArrayItems: 256, maxKeyBytes: 128, maxStringBytes: 8192 });
  });

  test('canonicalizer rejects non-data, aliases, bounds and noncanonical text before hashing', () => {
    const cases = [];
    const getter = {};
    Object.defineProperty(getter, 'value', { enumerable: true, get() { throw new Error('getter ran'); } });
    cases.push(getter, Object.create({ inherited: true }), Object.create(null), new String('value'),
      { value: -0 }, { value: 1.5 }, { value: Number.MAX_SAFE_INTEGER + 1 }, { value: Symbol('x') });
    const symbol = { value: 1 }; symbol[Symbol('hidden')] = true; cases.push(symbol);
    const alias = {}; cases.push({ left: alias, right: alias });
    const cycle = {}; cycle.self = cycle; cases.push(cycle);
    const sparse = []; sparse[1] = 'value'; cases.push(sparse);
    const proxied = new Proxy({ value: 1 }, { ownKeys() { throw new Error('proxy trap ran'); } }); cases.push(proxied);
    for (const value of cases) expect(() => canonical.canonicalize(value)).toThrow();
    expect(() => canonical.parseCanonical('{"b":1,"a":2}')).toThrow();
    expect(() => canonical.parseCanonical('{"a":1, "b":2}')).toThrow();
    expect(() => canonical.parseCanonical('{"a":1,"a":1}')).toThrow();
    expect(() => canonical.parseCanonical('{"a":-0}')).toThrow();
    expect(() => canonical.canonicalize({ a: 'x'.repeat(8193) })).toThrow();
    expect(() => canonical.canonicalize(Array.from({ length: 257 }, () => 0))).toThrow();
    expect(canonical.canonicalize({ '\u{10000}': 2, '\uE000': 1 })).toBe('{"\uE000":1,"\u{10000}":2}');
    for (const invalidUnicode of ['\u0000', '\uD800', '\uDC00'])
      expect(() => canonical.canonicalize({ value: invalidUnicode })).toThrow();
  });

  test('migration establishes exact trusted-time, RLS, immutability, indexes and zero conversion', () => {
    const sql = read(MIGRATION_PATH);
    for (const table of [
      'canonical_automation_policy_versions_v1', 'canonical_automation_source_bindings_v1',
      'canonical_automation_source_sets_v1',
      'canonical_automation_lifecycle_events_v1',
      'canonical_automation_records_v1', 'canonical_automation_historical_run_bindings_v1',
      'canonical_automation_legacy_conversion_reviews_v1', 'canonical_automation_retention_classes_v1',
    ]) expect(sql).toContain(table);
    expect((sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain("northstar.automation_tenant_id");
    expect(sql).toContain('statement_timestamp()');
    expect(sql).toContain("pg_catalog.set_config('TimeZone','UTC',TRUE)");
    expect(sql).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE');
    expect(sql).toContain("source_origin='mission28_native'");
    expect(sql).toContain('converted_policy_id IS NULL');
    expect(sql).toContain('Mission 28 lifecycle successor authority unavailable');
    expect(sql).toContain("':m28-lifecycle-policy:'||policy::text");
    expect(sql).toContain("related_latest_state IS DISTINCT FROM 'active'");
    expect(sql).toContain('related_terminal_digest IS NOT NULL');
    expect(sql).toContain('Mission 28 lifecycle rollback authority unavailable');
    expect(sql).toContain('Mission 28 policy expiry is not due');
    expect(sql).toContain('source_state_value IS DISTINCT FROM expected_source_state');
    expect(sql).toContain('source_set_marker IS DISTINCT FROM expected_source_set_marker');
    expect(sql).toContain('AND policy_id=policy AND policy_version=version_value');
    expect(sql).toContain('event_row.recorded_at>=first_record_at');
    expect(sql).toContain('latest_event_row.lifecycle_event_id IS DISTINCT FROM event_row.lifecycle_event_id');
    expect(sql).toContain('Mission 28 historical run binding mismatch');
    expect(sql).toContain('Mission 28 causal ordinal must strictly append');
    expect(sql).toContain('Mission 28 terminal unresolved order invalid');
    expect(sql).toContain('Mission 28 lifecycle predecessor shape invalid');
    expect(sql).toContain("jsonb_typeof(doc#>'{payload,grammarFixtureOnly}') IS DISTINCT FROM 'boolean'");
    expect(sql).toContain("jsonb_typeof(doc->'immutable') IS DISTINCT FROM 'boolean'");
    expect(sql).toContain('Mission 28 record payload null denied');
    expect(sql).not.toContain('<>');
    const replayIndex = sql.indexOf('SELECT * INTO stored FROM public.canonical_automation_lifecycle_events_v1');
    expect(replayIndex).toBeGreaterThan(0);
    expect(replayIndex).toBeLessThan(sql.indexOf('SELECT canonical_digest,previous_version_digest,expires_at', replayIndex));
    expect(replayIndex).toBeLessThan(sql.indexOf("IF operation_value IN('activate','resume') AND policy_expires_at", replayIndex));
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|ALTER\s+COLUMN\s+.*TYPE|DELETE\s+FROM|UPDATE\s+public\./i);
  });

  test('runtime bootstrap revokes every new table and owner-only function', () => {
    const db = read('src/db.js');
    const protectedNames = [
      'canonical_automation_retention_classes_v1', 'canonical_automation_policy_versions_v1',
      'canonical_automation_source_bindings_v1',
      'canonical_automation_lifecycle_events_v1', 'canonical_automation_records_v1',
      'canonical_automation_historical_run_bindings_v1', 'canonical_automation_legacy_conversion_reviews_v1',
      'canonical_automation_store_policy_v1', 'canonical_automation_store_lifecycle_event_v1',
      'canonical_automation_store_source_binding_v1',
      'canonical_automation_store_source_set_v1',
      'canonical_automation_store_record_v1', 'canonical_automation_store_historical_run_binding_v1',
      'canonical_automation_storage_snapshot_v1',
    ];
    for (const name of protectedNames) expect(db).toContain(name);
    expect(db).toContain('REVOKE ALL ON TABLE public.canonical_automation_retention_classes_v1');
    expect(db).toContain('REVOKE ALL ON FUNCTION ');
  });

  test('roadmap and ledger retain released Part 2D truth while advancing only Part 3A', () => {
    const roadmap = read(ROADMAP_PATH);
    const ledger = read(LEDGER_PATH);
    expect(roadmap).toContain('Parts 1A–2D released; Part 3A implementation candidate only.');
    expect(ledger).toContain('Parts 1A–2D released; Part 3A implementation candidate only.');
    expect(ledger).toContain('| 07 | 2C | Policy lifecycle and historical binding | **Released** |');
    expect(ledger).toContain('| 08 | 2D | PostgreSQL authority, canonicalization, retention and restart contract | **Released** |');
    expect(ledger).toContain('| 09 | 3A | Fixed action capability matrix | **Implementation candidate** |');
    expect(ledger).toContain('| 10 | 3B | Per-run approval versus standing authorization | Planned / unimplemented | None |');
    expect(roadmap).toContain('production migrations reconciled 269/269 through exact 273/no274');
  });

  test('narrative preserves every unavailable boundary', () => {
    const narrative = read(NARRATIVE_PATH);
    for (const phrase of [
      'grants no application-role storage capability', 'statement_timestamp()',
      'No duration or deletion authority is invented', 'never scans, imports or converts legacy data',
      'No production migration or restart evidence is claimed', 'founder visual approval remain unavailable',
    ]) expect(narrative).toContain(phrase);
  });
});
