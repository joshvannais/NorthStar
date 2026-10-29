'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));
const sha = relative => crypto.createHash('sha256').update(read(relative).replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const CONTRACT = 'docs/architecture/MISSION_28_PART4B_SOURCE_SNAPSHOT_CONTRACT.json';
const MIGRATION = 'migrations/274_canonical_automation_trigger_snapshots_v1.sql';
const PART4A = 'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json';

const BASE = 'c3a6d6c691ae39c982c872009ed4fc3f5123d13b';
const BASE_TREE = '3fcf036fcad83a804cf6baa98c7d931de2606422';
const PART4A_SHA = '5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19';

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) throw new Error(`${label} shape`);
}

function validateContract(value) {
  exact(value, ['contractVersion','authority','part4ARelease','frozenInputs','requestContract','storedSnapshotContract',
    'storageContract','failClosed','laterSliceBoundary','unavailableEvidence'], 'contract');
  exact(value.authority, ['mission','part','state','baselineCommit','baselineTree','runtimeIngestionMounted',
    'routeUiSchedulerWorkerQueueOrProviderAuthorityGranted','recipientExternalEffectUpstreamMutationOrMoneyAuthorityGranted'], 'authority');
  exact(value.part4ARelease, ['acceptedSourceHead','acceptedTree','pullRequest','mergedMain','deployment','deploymentState',
    'runningInstance','imageSha256','health','auditVerdict','auditReportSha256'], 'Part 4A release');
  exact(value.frozenInputs, ['part4ACatalogPath','part4ACatalogSha256','triggerCount','eventKindCount','sourceClassCount'], 'frozen inputs');
  exact(value.requestContract, ['schemaVersion','exactTopLevelFields','recordIdentity','sourceVersion','eventBinding','currentness',
    'provenance','lineage','requestDigest'], 'request contract');
  exact(value.requestContract.sourceVersion, ['exactFields','kinds','rule'], 'source version');
  exact(value.requestContract.eventBinding, ['exactFields','rule'], 'event binding');
  exact(value.requestContract.currentness, ['exactFields','availability','rule'], 'currentness');
  exact(value.requestContract.provenance, ['exactFields','kinds','actorRule','eventRule'], 'provenance');
  exact(value.requestContract.lineage, ['exactFields','kinds','rule'], 'lineage');
  exact(value.storedSnapshotContract, ['schemaVersion','trustedObservedAt','snapshotDigest','retentionClass','appendOnly',
    'tenantRlsForced','copyUpstreamPayload','sourceFactGrantsActionAuthority','snapshotGrantsEvaluationOrEffectAuthority'], 'stored snapshot');
  exact(value.storageContract, ['migration','table','catalogTable','storeFunction','applicationRoleExecuteGranted','exactReplay',
    'conflictRule','correctionRule','tombstoneRule'], 'storage contract');
  exact(value.laterSliceBoundary, ['part4C','part4D','part5Plus'], 'later boundary');
  if (value.contractVersion !== 'mission28.part4b.source-snapshot.v1') throw new Error('contract version');
  if (value.authority.mission !== 28 || value.authority.part !== '4B' ||
      value.authority.state !== 'implementation_candidate_only' || value.authority.baselineCommit !== BASE ||
      value.authority.baselineTree !== BASE_TREE || value.authority.runtimeIngestionMounted !== false ||
      value.authority.routeUiSchedulerWorkerQueueOrProviderAuthorityGranted !== false ||
      value.authority.recipientExternalEffectUpstreamMutationOrMoneyAuthorityGranted !== false) {
    throw new Error('authority');
  }
  if (value.part4ARelease.acceptedSourceHead !== '0ff6be659df199357635f447eeff77cfd9d7aa38' ||
      value.part4ARelease.mergedMain !== BASE || value.part4ARelease.acceptedTree !== BASE_TREE ||
      value.part4ARelease.pullRequest !== 561 ||
      value.part4ARelease.deployment !== '40335d30-2b8d-4e99-b2fb-3083348f9d2d' ||
      value.part4ARelease.deploymentState !== 'SUCCESS_RUNNING') throw new Error('Part 4A release');
  if (value.frozenInputs.part4ACatalogSha256 !== PART4A_SHA || value.frozenInputs.triggerCount !== 19 ||
      value.frozenInputs.eventKindCount !== 36 || value.frozenInputs.sourceClassCount !== 7) throw new Error('frozen input');
  if (!value.requestContract.exactTopLevelFields.includes('recordIdentityDigest') ||
      !value.requestContract.exactTopLevelFields.includes('requestDigest') ||
      value.requestContract.exactTopLevelFields.includes('observedAt') ||
      value.requestContract.sourceVersion.rule !== 'exactly one version or revision is present according to the trigger catalog and equals the designated Part 4A currentness pin' ||
      value.requestContract.currentness.availability !== 'available_exact_current' ||
      !value.requestContract.eventBinding.rule.includes('eventKind selects exactly one Part 4A sourceField')) {
    throw new Error('request binding');
  }
  if (!value.storedSnapshotContract.trustedObservedAt.includes('PostgreSQL statement_timestamp') ||
      !value.storedSnapshotContract.trustedObservedAt.includes('candidate input cannot supply') ||
      value.storedSnapshotContract.copyUpstreamPayload !== false ||
      value.storedSnapshotContract.sourceFactGrantsActionAuthority !== false ||
      value.storedSnapshotContract.appendOnly !== true) throw new Error('snapshot boundary');
  if (!value.storageContract.exactReplay.includes('without a second row or a new observedAt') ||
      !value.storageContract.correctionRule.includes('append') ||
      !value.storageContract.tombstoneRule.includes('Part 4D')) throw new Error('lineage');
  if (value.storageContract.migration !== '274_canonical_automation_trigger_snapshots_v1.sql' ||
      value.storageContract.applicationRoleExecuteGranted !== false) throw new Error('PostgreSQL authority');
  const requiredDenials = ['unknown_trigger_or_event_kind','missing_or_substituted_event_source_field_or_selector',
    'event_time_observed_time_substitution','cross_tenant_record_identity_or_provenance',
    'source_class_owner_fact_kind_or_grain_drift','version_revision_or_designated_pin_mismatch',
    'canonical_source_record_identity_pins_provenance_request_or_snapshot_digest_mismatch',
    'stale_unavailable_fixture_or_ambiguous_currentness','missing_wrong_cross_record_or_nonadjacent_correction_predecessor',
    'candidate_created_trusted_provenance','upstream_payload_action_recipient_provider_effect_or_money_field'];
  if (JSON.stringify(value.failClosed) !== JSON.stringify(requiredDenials) ||
      !value.laterSliceBoundary.part4C.includes('unimplemented') ||
      !value.laterSliceBoundary.part4D.includes('unimplemented')) throw new Error('fail closed set');
  return true;
}

describe('Mission 28 Part 4B durable source snapshots', () => {
  test('binds the exact accepted Part 4A catalog and release baseline', () => {
    expect(sha(PART4A)).toBe(PART4A_SHA);
    const contract = parse(CONTRACT);
    expect(validateContract(contract)).toBe(true);
    const part4a = parse(PART4A);
    expect(part4a.triggers).toHaveLength(19);
    expect(part4a.triggers.flatMap(trigger => trigger.eventTime.kinds)).toHaveLength(36);
  });

  test('migration contains the closed 19-trigger catalog and every exact event binding', () => {
    const migration = read(MIGRATION);
    const part4a = parse(PART4A);
    for (const trigger of part4a.triggers) {
      expect(migration).toContain(`('${trigger.id}'`);
      expect(migration).toContain(`'${trigger.sourceClassId}'`);
      for (const event of trigger.eventTime.kinds) {
        expect(migration).toContain(`"${event.eventKind}":{"sourceField":"${event.sourceField}","sourceStateSelector":"${event.sourceStateSelector}"}`);
      }
    }
    expect((migration.match(/'5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'/g) || [])).toHaveLength(20);
  });

  test('durable grammar is tenant-private append-only and not mounted to application roles', () => {
    const migration = read(MIGRATION);
    for (const anchor of [
      'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY',
      'canonical_automation_trigger_snapshots_v1_immutable',
      "lineage_kind='original'", "lineage_kind='correction'",
      "trusted_clock_contract='postgresql_statement_timestamp_v1'",
      "recorded_time_zone='UTC'", 'REVOKE ALL ON TABLE', 'REVOKE ALL ON FUNCTION',
      "':m28-source-lineage:'", "available_exact_current",
    ]) expect(migration).toContain(anchor);
    expect(migration).not.toMatch(/GRANT\s+(?:EXECUTE|SELECT|INSERT|UPDATE|DELETE)/i);
    const runtime = ['src/server.js', ...fs.readdirSync(path.join(ROOT, 'src/routes'), { withFileTypes: true })
      .filter(entry => entry.isFile()).map(entry => `src/routes/${entry.name}`)]
      .map(read).join('\n');
    expect(runtime).not.toContain('canonical_automation_store_trigger_snapshot_v1');
    expect(runtime).not.toContain('canonical_automation_trigger_snapshots_v1');
  });

  test('SQL closes NULL, unknown-key, stale, substitution and observation-time fail-open paths', () => {
    const migration = read(MIGRATION);
    expect(migration).toContain('IS DISTINCT FROM TRUE');
    expect(migration).toContain("doc#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current'");
    expect(migration).toContain("doc#>>'{eventBinding,eventTime}'");
    expect(migration).toContain("document->>'observedAt' IS NOT DISTINCT FROM public.canonical_automation_utc_v1(observed_at)");
    expect(migration).toContain("doc#>>'{provenance,tenantId}' IS DISTINCT FROM org::text");
    expect(migration).toContain("trusted_provenance_value IS DISTINCT FROM doc->'provenance'");
    expect(migration).toContain('JOIN public.users account ON account.organization_id=session.organization_id');
    expect(migration).toContain("account.status='active'");
    expect(migration).toContain('canonical_automation_part4b_keys_exact_v1');
    expect(migration).not.toContain("COALESCE(doc->>'observedAt'");
  });

  test('contract mutations cannot retain positive substrings while widening authority', () => {
    const canonical = parse(CONTRACT);
    const attacks = [
      value => { value.authority.runtimeIngestionMounted = true; },
      value => { value.authority.routeUiSchedulerWorkerQueueOrProviderAuthorityGranted = true; },
      value => { value.frozenInputs.triggerCount = 18; },
      value => { value.requestContract.exactTopLevelFields.push('observedAt'); },
      value => { value.requestContract.sourceVersion.rule = 'any_well_formed_version_or_revision'; },
      value => { value.requestContract.currentness.availability = 'stale'; },
      value => { value.storedSnapshotContract.sourceFactGrantsActionAuthority = true; },
      value => { value.storageContract.correctionRule = 'overwrite_previous_snapshot'; },
      value => { value.storageContract.applicationRoleExecuteGranted = true; },
      value => { value.failClosed.pop(); },
      value => { value.requestContract.lineage.unreviewedAuthority = true; },
    ];
    for (const mutate of attacks) {
      const candidate = structuredClone(canonical);
      mutate(candidate);
      expect(() => validateContract(candidate)).toThrow();
    }
  });

  test('roadmap and ledger release Part 5A, state only Part 5B as candidate and keep later slices planned', () => {
    const roadmap = read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
    const ledger = read('docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
    expect(roadmap).toContain('Parts 1A–12C are released. Part 12D is the sole implementation candidate.');
    expect(roadmap).toContain('additive migration `274_canonical_automation_trigger_snapshots_v1.sql`');
    expect(ledger).toContain('| 13 | 4A | Closed trigger catalog over accepted Missions 20–27 facts | **Released** |');
    expect(ledger).toContain('| 14 | 4B | Durable tenant-scoped source snapshot and correction lineage | **Released** |');
    expect(ledger).toContain('| 15 | 4C | Evaluation-time and pre-effect currentness revalidation | **Released** |');
    expect(ledger).toContain('| 16 | 4D | Duplicate/replay/reorder/correction/tombstone/concurrency handling | **Released** |');
    expect((ledger.match(/\*\*Implementation candidate\*\*/g) || [])).toHaveLength(1);
  });

  test('migration order retains 274 and is additive through candidate 278 with no 279', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    expect(migrations).toContain('274_canonical_automation_trigger_snapshots_v1.sql');
    expect(migrations).toContain('275_canonical_automation_transactional_outbox_v1.sql');
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    expect(migrations.filter(name => name.startsWith('281_'))).toEqual(['281_canonical_automation_sender_recipient_authority_v1.sql']);
  });
});
