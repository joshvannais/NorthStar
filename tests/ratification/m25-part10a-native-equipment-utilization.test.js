'use strict';
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
describe('Mission 25 Part 10 Slice A native equipment utilization',()=>{
 const migration=read('migrations/096_canonical_native_equipment_utilization.sql');
 test('pins exact native plan, asset, event, execution and completion lineage',()=>{
  for(const value of ['canonical_equipment_learning_consents','canonical_native_equipment_utilization_observations',
   'canonical_native_equipment_utilization_basis','canonical_equipment_events','canonical_equipment_asset_versions',
   'canonical_equipment_cost_plans','canonical_equipment_plans','canonical_completion_records']) expect(migration).toContain(value);
  expect(migration).toContain("event_row.document->>'kind' IN ('check_out','use','check_in')");
  expect(migration).toContain('newer.supersedes_id=event_value.id');
  expect(migration).toContain("purpose='native_equipment_checkout_variance_v1'");
  expect(migration).toContain('IF event_count>500');
 });
 test('states the narrow evidence and non-mutation boundaries',()=>{
  for(const value of ['do not prove engine-on time','operating cost','maintenance cost','No estimate, price, schedule, asset record, cost allocation or business policy was changed']) expect(migration).toContain(value);
 });
 test('withholds tables and helpers while mounting guarded entries',()=>{
  const db=read('src/db.js');
  expect(migration).toContain('REVOKE ALL ON TABLE public.canonical_equipment_learning_consents,public.canonical_native_equipment_utilization_observations FROM PUBLIC');
  for(const value of ['native_equipment_learning_tables_withheld','native_equipment_learning_entry_execute','native_equipment_learning_helpers_withheld']) expect(db).toContain(value);
 });
 test('mounts owner-only HTTP contracts',()=>{
  const routes=read('src/routes/learning.js');
  expect(routes).toContain("'/native-equipment-utilization-consent'");
  expect(routes).toContain("'/estimates/:estimateId/native-equipment-utilization-outcomes'");
  expect(routes).toContain('nativeEquipmentContract.normalizeObservation');
 });
});
