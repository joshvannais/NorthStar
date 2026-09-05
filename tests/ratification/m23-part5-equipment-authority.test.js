'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const migration = read('migrations/046_reviewed_equipment_operations.sql');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const BASE = 'eccc8e901b20ae3cc65a68c9fb2b068a4ceb9375';
describe('Mission 23 Part 5 unified equipment ratification contract', () => {
  test('seals the exact frozen additive migration bytes and Git blob', () => {
    const bytes = fs.readFileSync(path.join(ROOT, 'migrations/046_reviewed_equipment_operations.sql'));
    expect(bytes.length).toBe(57208); expect(hash(bytes)).toBe('86284c861a014b462e3456e87ec7be703f299e19d23cc7b1650bcd87cb47513f');
    expect(execFileSync('git', ['hash-object', 'migrations/046_reviewed_equipment_operations.sql'], { cwd: ROOT, encoding: 'utf8' }).trim()).toBe('5b9d294954fb27857299be0b9ef15873ba07cc45');
  });
  test('preserves every released migration byte from the exact full-history released base', () => {
    const names = execFileSync('git', ['ls-tree','-r','--name-only',BASE,'migrations'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(name => name.endsWith('.sql'));
    expect(names).toHaveLength(43);
    for (const name of names) expect(hash(fs.readFileSync(path.join(ROOT, name)))).toBe(hash(execFileSync('git', ['show', `${BASE}:${name}`], { cwd: ROOT })));
  });
  test('keeps universal publication behind NorthStar offline import authority and private tables inaccessible', () => {
    expect(migration).toContain("IF session_user<>(SELECT pg_get_userbyid(datdba)");
    const authority = read('src/equipment/databaseAuthority.js');
    expect(authority).toContain("new Set(['equipment_draft_mutate', 'equipment_operation_mutate', 'equipment_read'])");
    expect(authority).toContain('REVOKE ALL ON TABLE'); expect(authority).toContain('REVOKE ALL ON FUNCTION');
    expect(authority).not.toContain("'equipment_import_reviewed'");
    expect(migration).toContain("RAISE EXCEPTION 'Equipment evidence is append-only'");
  });
  test('binds exact tenant asset, universal version, execution, performer, correction and complete immutable audit evidence', () => {
    for (const fragment of ['asset_snapshot JSONB NOT NULL','FOREIGN KEY(knowledge_version_id,knowledge_digest)',
      'FOREIGN KEY(organization_id,asset_id,asset_version,asset_digest)','FOREIGN KEY(organization_id,performer_profile_id)',
      'UNIQUE(organization_id,supersedes_id)','CREATE CONSTRAINT TRIGGER equipment_draft_complete','CREATE CONSTRAINT TRIGGER equipment_ledger_complete']) expect(migration).toContain(fragment);
    expect(migration).toContain("'attachment_configuration_unreviewed'");
    expect(migration).toContain("current_setting('transaction_isolation')<>'serializable'");
    expect(read('src/equipment/repository.js')).toContain('pg_advisory_lock_shared(230004,4)');
  });
  test('uses one bounded reviewed pipeline from both existing surfaces with no browser key or markup sink', () => {
    expect(read('public/dashboard/business-profile.html')).toContain("NorthStarEquipment.open({ entryPath: 'business_profile'");
    expect(read('public/dashboard/polaris.html')).toContain("entryPath: 'polaris'");
    const client = read('public/js/equipment.js');
    expect(client).toContain("'/api/equipment/drafts'"); expect(client).toContain("confirmation: 'save_reviewed_asset'");
    expect(client).not.toMatch(/innerHTML|insertAdjacentHTML|OPENAI_API_KEY|localStorage|sessionStorage/);
    expect(read('src/equipment/httpBoundary.js')).toContain('parseUnambiguousJson');
    expect(read('src/equipment/provider.js')).toContain('usageLedger.reserve');
    expect(read('src/polaris/openaiRuntime.js')).toContain('northstar_equipment_literal_identifiers_v1');
  });
  test('keeps Part 5 a writer candidate and preserves every excluded later authority', () => {
    const roadmap = read('docs/roadmap/MISSION_23_OPERATIONS.md');
    expect(roadmap).toContain('**Part 5: implementation writer candidate; independent audit and release');
    expect(roadmap).toContain('**Parts 6–12: not implemented.**');
    const contract = read('docs/operations/EQUIPMENT_AUTHORITY.md');
    for (const boundary of ['No merge, deployment, live research','platform admin UI','physical Safari/devices','founder personal visual','Part 9']) expect(contract).toContain(boundary);
  });
});
