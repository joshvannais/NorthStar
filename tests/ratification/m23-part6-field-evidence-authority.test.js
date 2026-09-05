'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE = 'dfc769520ea56fdb7fde44dda6fe0bd65202fcdb';
const MIGRATION_PATH = 'migrations/047_canonical_field_evidence_authority.sql';
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const migration = read(MIGRATION_PATH);

describe('Mission 23 Part 6 unified field evidence ratification contract', () => {
  test('seals one additive migration at its exact path, bytes, SHA-256, and Git blob', () => {
    expect(fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^047_.*\.sql$/.test(name)))
      .toEqual(['047_canonical_field_evidence_authority.sql']);
    const bytes = fs.readFileSync(path.join(ROOT, MIGRATION_PATH));
    expect(bytes.length).toBe(74729);
    expect(hash(bytes)).toBe('b9c08d267cbf373202e621b381f5821bb96c54fde3046be25fe08005d8f16048');
    expect(execFileSync('git', ['hash-object', MIGRATION_PATH], { cwd: ROOT, encoding: 'utf8' }).trim())
      .toBe('f8a94d64d20bc3076819b6f719ca02a1f2508318');
  });

  test('preserves every released migration byte from the exact full-history base', () => {
    const names = execFileSync('git', ['ls-tree', '-r', '--name-only', BASE, 'migrations'], {
      cwd: ROOT, encoding: 'utf8',
    }).trim().split('\n').filter(name => name.endsWith('.sql'));
    expect(names).toHaveLength(44);
    for (const name of names) {
      expect(hash(fs.readFileSync(path.join(ROOT, name))))
        .toBe(hash(execFileSync('git', ['show', `${BASE}:${name}`], { cwd: ROOT })));
    }
  });

  test('pins checklist versions and distinct non-professional observation semantics', () => {
    const contract = read('src/fieldEvidence/contract.js');
    for (const fragment of [
      "'entryId', 'versionId', 'versionNumber', 'digest', 'publicationId'",
      "['observation', 'measurement', 'pass', 'fail', 'unavailable', 'needs_review']",
      "['inspection', 'quality', 'field_observation']",
      'professionalConclusion: false',
    ]) expect(contract).toContain(fragment);
    expect(migration).toContain("document_value->>'resultType' NOT IN ('observation','measurement','pass','fail','unavailable','needs_review')");
    expect(migration).toContain("document_value->>'observationClass' NOT IN ('inspection','quality','field_observation')");
  });

  test('binds tenant, execution, assignment, actor, performer, session, revisions, digests, events and audit atomically', () => {
    for (const fragment of [
      'FOREIGN KEY(organization_id,execution_id)',
      'FOREIGN KEY(organization_id,assignment_id)',
      'FOREIGN KEY(organization_id,recorded_by_user_id)',
      'FOREIGN KEY(organization_id,performed_by_profile_id)',
      'FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id)',
      'source_execution_revision BIGINT NOT NULL',
      'source_assignment_revision BIGINT NOT NULL',
      'CREATE CONSTRAINT TRIGGER canonical_field_evidence_complete',
      'canonical_field_evidence_idempotency',
      'canonical_field_evidence_audit_events',
    ]) expect(migration).toContain(fragment);
    expect(migration).toContain("current_setting('transaction_isolation')<>'serializable'");
    expect(migration).toContain("current_setting('transaction_isolation')<>'repeatable read'");
  });

  test('reauthorizes current subscription, onboarding, assignment, crew, dispatch and non-demo transcript authority', () => {
    for (const fragment of [
      'canonical_field_execution_actor_authority',
      'canonical_field_execution_replay_authorized',
      "assignment.target_state='assigned'",
      "assignment.dispatch_state='dispatched'",
      'workforce_crew_members',
      'canonical_labor_transcript_source_normalized',
      "IN ('lead','retell','voice')",
    ]) expect(migration).toContain(fragment);
  });

  test('withholds tables and helpers while granting only four fixed-search-path entry points', () => {
    const authority = read('src/fieldEvidence/databaseAuthority.js');
    expect(authority).toContain("new Set(['canonical_field_evidence_mutate', 'canonical_field_evidence_read'");
    expect(authority).toContain("'canonical_field_file_upload_authorize', 'canonical_field_file_retrieve_authorize']");
    expect(authority).toContain('REVOKE ALL ON TABLE');
    expect(authority).toContain('REVOKE ALL ON FUNCTION');
    expect(migration.match(/SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp/g)).toHaveLength(6);
  });

  test('keeps storage unavailable until every required privacy and file capability is evidenced', () => {
    const storage = read('src/fieldEvidence/fileStorage.js');
    const contract = read('src/fieldEvidence/contract.js');
    for (const fragment of [
      "'durable', 'encryptionAtRest', 'quarantine', 'malwareScan', 'metadataStrip'",
      "'decompressionSafety', 'retentionCleanup', 'orphanCleanup', 'shortLivedRetrieval'",
      'released_after_clean_scan', 'stripExif: true', 'stripGeolocation: true',
      'scan.decompressionSafe !== true', 'scan.decodedPixelCount > 40000000',
      "contentDisposition: 'attachment'", "mediaType: 'application/octet-stream'",
      'consentOrComplianceConclusion: false', 'malwareClearanceClaim: false',
    ]) expect(storage).toContain(fragment);
    expect(contract).toContain("'image/jpeg'");
    expect(contract).toContain("'image/png'");
    expect(contract).toContain("'image/webp'");
    expect(contract).not.toContain("'image/svg+xml'");
  });

  test('reserves idempotency before storage mutation and binds immutable generations plus accessibility', () => {
    const storage = read('src/fieldEvidence/fileStorage.js');
    const contract = read('src/fieldEvidence/contract.js');
    expect(storage.indexOf('await authorizeUpload')).toBeLessThan(storage.indexOf('storage.beginQuarantine'));
    for (const fragment of ['immutableObjectCreate', 'generationScopedCleanup', 'deleteGeneration',
      'storageGenerationId', 'storageObjectVersion', 'expectedContentDigest']) expect(storage).toContain(fragment);
    expect(storage).not.toContain('deleteOrphan');
    expect(migration).toContain('canonical_field_evidence_file_upload_reservations');
    expect(migration).toContain("reservation.status='accepted'");
    expect(migration).toContain('claim_token_hash');
    expect(contract).toContain("['described', 'unavailable', 'needs_review']");
    expect(contract).toContain("'x-accessibility-state'");
    expect(migration).toContain("document_value->>'kind'='file_accessibility_correction'");
  });

  test('mounts only bounded Part 6 APIs and leaves the rendered Part 9 surface untouched', () => {
    const routes = read('src/routes/fieldExecutions.js');
    for (const pathFragment of [
      "'/:executionId/field-evidence-actions'", "'/:executionId/field-evidence'",
      "'/:executionId/files'", "'/:executionId/files/:objectId'",
    ]) expect(routes).toContain(pathFragment);
    const changed = execFileSync('git', ['diff', '--name-only', BASE, '--'], { cwd: ROOT, encoding: 'utf8' });
    expect(changed).not.toMatch(/(?:^|\n)public\//);
    expect(changed).not.toMatch(/(?:^|\n)tests\/browser\//);
    expect(migration).toContain('No Part 7+');
    expect(migration).not.toMatch(/CREATE (?:TABLE|FUNCTION) [^;]*(?:progress|blocker|change_order|completion|reopen|invoice|estimate)/i);
  });
});
