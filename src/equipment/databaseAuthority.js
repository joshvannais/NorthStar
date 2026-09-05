'use strict';

const ENTRIES = new Set(['equipment_draft_mutate', 'equipment_operation_mutate', 'equipment_read']);
const quote = name => '"' + name.replace(/"/g, '""') + '"';
async function grantAndVerify(client, runtimeRole) {
  const exists = await client.query("SELECT to_regclass('public.canonical_equipment_drafts') IS NOT NULL AS present");
  if (!exists.rows[0].present) return;
  const tables = await client.query("SELECT oid,oid::regclass::text AS identity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'canonical_equipment_%'");
  const functions = await client.query("SELECT oid,proname,oid::regprocedure::text AS identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'equipment_%'");
  const role = quote(runtimeRole);
  for (const row of tables.rows) {
    await client.query(`REVOKE ALL ON TABLE ${row.identity} FROM PUBLIC, ${role}`);
    const privileges = await client.query("SELECT has_table_privilege($1,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS permitted", [runtimeRole, row.oid]);
    if (privileges.rows[0].permitted) throw new Error('Equipment table authority was not withheld');
  }
  for (const row of functions.rows) {
    await client.query(`REVOKE ALL ON FUNCTION ${row.identity} FROM PUBLIC, ${role}`);
    if (ENTRIES.has(row.proname)) await client.query(`GRANT EXECUTE ON FUNCTION ${row.identity} TO ${role}`);
    const privileges = await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS permitted", [runtimeRole, row.oid]);
    if (privileges.rows[0].permitted !== ENTRIES.has(row.proname)) throw new Error('Equipment function authority was not verified');
  }
  if (functions.rows.filter(row => ENTRIES.has(row.proname)).length !== 3) throw new Error('Equipment entry authority is incomplete');
}
module.exports = { grantAndVerify };
