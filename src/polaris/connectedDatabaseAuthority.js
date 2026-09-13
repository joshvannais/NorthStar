'use strict';
const ENTRIES = new Set(['canonical_call_provider_reserve','canonical_call_provider_reconcile','canonical_call_provider_retire','demo_polaris_provider_reserve', 'demo_polaris_provider_reconcile',
  'connected_reasoning_retire', 'canonical_tax_research_status', 'canonical_tax_research_enqueue', 'canonical_tax_research_claim', 'canonical_tax_research_finish']);
async function grantAndVerify(client, runtimeRole) {
  const role = '"' + runtimeRole.replace(/"/g, '""') + '"';
  const tables = (await client.query("SELECT oid,relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND (relname LIKE 'demo_polaris_provider_%' OR relname LIKE 'canonical_tax_research_%' OR relname LIKE 'canonical_call_provider_%')")).rows;
  if (!tables.length) return;
  for (const table of tables) {
    const name = 'public."' + table.relname.replace(/"/g, '""') + '"';
    await client.query('REVOKE ALL ON TABLE ' + name + ' FROM PUBLIC, ' + role);
    if ((await client.query("SELECT has_table_privilege($1,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed", [runtimeRole, table.oid])).rows[0].allowed) throw new Error('Connected source direct ledger authority not withheld');
  }
  const functions = (await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'demo_polaris_provider_%' OR proname LIKE 'canonical_tax_research_%' OR proname='connected_reasoning_retire' OR proname LIKE 'canonical_call_provider_%')")).rows;
  for (const f of functions) {
    await client.query('REVOKE ALL ON FUNCTION ' + f.identity + ' FROM PUBLIC, ' + role);
    if (ENTRIES.has(f.proname)) await client.query('GRANT EXECUTE ON FUNCTION ' + f.identity + ' TO ' + role);
    if ((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') allowed", [runtimeRole, f.oid])).rows[0].allowed !== ENTRIES.has(f.proname)) throw new Error('Connected source function authority invalid');
  }
  if (functions.filter(f => ENTRIES.has(f.proname)).length !== ENTRIES.size) throw new Error('Connected source entry authority unavailable');
}
module.exports = { ENTRIES, grantAndVerify };
