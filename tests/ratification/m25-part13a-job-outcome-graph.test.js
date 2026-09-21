'use strict';
const fs=require('node:fs'),path=require('node:path');const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
describe('Mission 25 Part 13A canonical job outcome graph',()=>{
 const migration=read('migrations/124_canonical_job_outcome_graph.sql');
 test('supports every accepted per-job outcome authority without copying result values',()=>{
  for(const kind of['native_labor','imported_labor','imported_travel','native_equipment','imported_asset','native_material','imported_material_quantity','imported_material_cost','external_customer','external_project','external_financial'])expect(migration).toContain(`'${kind}'`);
  expect(migration).toContain("'observationDigest'");expect(migration).toContain("'sourceDigest'");expect(migration).not.toContain("'outcomes',current_value->'outcomes'");
 });
 test('requires two domains, exact current observations and a current estimate basis',()=>{
  expect(migration).toContain('domain_count<2');expect(migration).toContain("current_value->'fresh' IS DISTINCT FROM 'true'::jsonb");expect(migration).toContain("canonical_external_business_reference_target_basis(org,'estimate',estimate_value)");
 });
 test('is separately consented, immutable, bounded and cannot revive after a new consent period',()=>{
  expect(migration).toContain('canonical_job_outcome_graph_consents');expect(migration).toContain('canonical_job_outcome_graphs_immutable');expect(migration).toContain('jsonb_array_length(nodes_value) NOT BETWEEN 2 AND 100');expect(migration).toContain('replay.consent_id<>consent_value.id');expect(migration).toContain('AND consent_id=consent_value.id');
 });
 test('withholds tables and helpers while granting only four guarded runtime entries',()=>{
  expect(migration).toContain('REVOKE ALL ON TABLE public.canonical_job_outcome_graph_consents,public.canonical_job_outcome_graphs FROM PUBLIC');
  expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_graph_read');expect(migration).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE) ON/);
  const db=read('src/db.js');expect(db).toContain('job_outcome_graph_tables_withheld');expect(db).toContain('job_outcome_graph_helpers_withheld');expect(db).toContain('REVOKE ALL PRIVILEGES ON TABLE public.canonical_job_outcome_graph_consents, public.canonical_job_outcome_graphs');
 });
 test('adds no rendered path and preserves the advisory and Mission 27 boundaries',()=>{
  const changed=[migration,read('src/learning/jobOutcomeGraphContract.js'),read('src/learning/jobOutcomeGraphRepository.js'),read('src/routes/learning.js')].join('\n');
  expect(changed).not.toMatch(/public\/(?:html|css|js\/components)/);expect(migration).toContain('This graph records evidence connections only. It does not change company records or apply a recommendation.');
  expect(migration).not.toMatch(/UPDATE public\.(canonical_estimates|canonical_external_financial_import_records|canonical_external_business_reference_matches)/);
 });
 test('runs migration 124 under the bounded migration timeout policy',()=>{expect(read('src/db.js')).toContain("'124_canonical_job_outcome_graph.sql'");});
});
