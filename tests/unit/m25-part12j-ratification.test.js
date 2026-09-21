'use strict';
const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../..');const read=file=>fs.readFileSync(path.join(root,file),'utf8');

describe('Mission 25 Part 12J authority ratification',()=>{
 const migration=read('migrations/122_canonical_external_business_source_operations.sql');
 test('covers all four accepted source classes with bounded immutable lifecycle authority',()=>{
  expect(migration).toContain("source_class IN ('crm_field_service','project_change_order','communication','financial')");
  expect(migration).toContain("operation TEXT NOT NULL CHECK(operation IN ('retention','deletion'))");
  expect(migration).toContain('tombstoned_count BETWEEN 0 AND 100');expect(migration).toContain('canonical_external_business_cleanup_immutable');
 });
 test('serializes permission, import, hold and cleanup and blocks active deletion',()=>{
  expect(migration).toContain('canonical_external_business_lifecycle_lock');expect(migration).toContain('external_business_cleanup_active_hold');expect(migration).toContain('external_business_deletion_blocks_consent_grant');expect(migration).toContain('external_business_deletion_blocks_import');
  expect((migration.match(/EXECUTE FUNCTION public\.canonical_external_business_deletion_guard\(\)/g)||[]).length).toBe(8);
 });
 test('returns replays only while their source authority remains current',()=>{
  expect(migration).toContain('external_business_retired_operation_replay');expect(migration).toContain('external_business_retired_adapter_replay');expect(migration).toContain('external_business_retired_retention_replay');expect(migration).toContain('external_business_retired_hold_replay');expect(migration).toContain('external_business_retired_hold_consent_replay');expect(migration).toContain('source_consent_digest');expect(migration).toContain('source_consent_action');expect(migration).toContain('external_business_retired_cleanup_replay');
  for(const number of [113,114,115,116]){const source=read(`migrations/${fs.readdirSync(path.join(root,'migrations')).find(file=>file.startsWith(number+'_'))}`);expect(source).toContain('external_business_retired_consent_replay');expect(source).toContain('external_business_retired_import_replay');}
 });
 test('runs migration 122 inside the reviewed bounded timeout lane',()=>{
  const {reviewedMigrationTimeoutValues}=require('../../src/db');
  expect(reviewedMigrationTimeoutValues('122_canonical_external_business_source_operations.sql',{lock_timeout:'0',statement_timeout:'0'})).toEqual({lockTimeout:'5000ms',statementTimeout:'20000ms'});
  expect(reviewedMigrationTimeoutValues('122_canonical_external_business_source_operations.sql',{lock_timeout:'250',statement_timeout:'900'})).toEqual({lockTimeout:'250ms',statementTimeout:'900ms'});
  expect(reviewedMigrationTimeoutValues('123_unreviewed.sql',{lock_timeout:'0',statement_timeout:'0'})).toBeNull();
  const db=read('src/db.js');expect(db).toContain("[boundedTimeouts.lockTimeout, boundedTimeouts.statementTimeout]");
 });
 test('adds minimized tombstones to each exact source class',()=>{
  for(const table of ['crm_field_service','project_change_order','communication','financial'])expect(migration).toContain(`INSERT INTO public.canonical_external_${table}_import_records`);
  expect(migration).toContain("external_version+1,'tombstone'");
 });
 test('keeps runtime entry-only and no rendered path changes',()=>{
  const db=read('src/db.js');expect(db).toContain('external_business_operations_tables_withheld');expect(db).toContain('external_business_operations_entry_execute');expect(db).toContain('external_business_operations_helpers_withheld');
  const changedRuntime=['src/learning/externalBusinessOperationsContract.js','src/learning/externalBusinessOperationsRepository.js','src/routes/learning.js','src/db.js'];expect(changedRuntime.some(file=>file.startsWith('public/'))).toBe(false);
 });
 test('keeps exposed messages in plain business language',()=>{
  const copy=read('src/learning/externalBusinessOperationsContract.js')+'\n'+read('src/learning/externalBusinessOperationsRepository.js');const messages=[...copy.matchAll(/(?:message:\s*|new Error\()'([^']+)'/g)].map(match=>match[1]).join('\n');
  expect(messages).not.toMatch(/schema|idempotency|projection|digest|database revision/i);expect(messages).toContain('Source operation details are invalid.');
 });
});
