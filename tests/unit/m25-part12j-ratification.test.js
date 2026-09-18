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
