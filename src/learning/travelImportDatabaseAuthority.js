'use strict';
const ENTRIES = new Set(['canonical_external_travel_import_consent_read', 'canonical_external_travel_import_consent_mutate', 'canonical_external_travel_import_batch', 'canonical_external_travel_import_read', 'canonical_external_travel_reference_matches_read', 'canonical_external_travel_reference_match_mutate', 'canonical_imported_travel_learning_consent_read', 'canonical_imported_travel_learning_consent_mutate', 'canonical_imported_travel_outcome_observe', 'canonical_imported_travel_outcome_read']);
async function grantAndVerify(client, runtimeRole) {
  if (!(await client.query("SELECT to_regclass('public.canonical_external_travel_import_runs') IS NOT NULL present")).rows[0].present) return;
  if (!/^[A-Za-z_][A-Za-z0-9_$-]*$/.test(runtimeRole)) throw new Error('Runtime role identity is invalid');
  const role = '"' + runtimeRole.replace(/"/g, '""') + '"';
  const tables = (await client.query("SELECT oid,relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname=ANY($1)", [[
    'canonical_external_travel_import_consents', 'canonical_external_travel_import_runs', 'canonical_external_travel_import_records', 'canonical_external_travel_reference_matches', 'canonical_external_travel_import_learning_consents', 'canonical_external_travel_outcome_observations']])).rows;
  for (const table of tables) {
    await client.query(`REVOKE ALL ON TABLE public."${table.relname.replace(/"/g, '""')}" FROM PUBLIC, ${role}`);
    if ((await client.query("SELECT has_table_privilege($1,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed", [runtimeRole, table.oid])).rows[0].allowed) throw new Error('Travel import direct table authority not withheld');
  }
  const functions = (await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'canonical_external_travel_%' OR proname LIKE 'canonical_imported_travel_%')")).rows;
  for (const fn of functions) {
    await client.query(`REVOKE ALL ON FUNCTION ${fn.identity} FROM PUBLIC, ${role}`);
    if (ENTRIES.has(fn.proname)) await client.query(`GRANT EXECUTE ON FUNCTION ${fn.identity} TO ${role}`);
    if ((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') allowed", [runtimeRole, fn.oid])).rows[0].allowed !== ENTRIES.has(fn.proname)) throw new Error('Travel import function authority invalid');
  }
  if (tables.length !== 6 || functions.filter(fn => ENTRIES.has(fn.proname)).length !== ENTRIES.size) throw new Error('Travel import authority unavailable');
}
module.exports = { grantAndVerify };
