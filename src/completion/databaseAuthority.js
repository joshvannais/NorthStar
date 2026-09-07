'use strict';

const ENTRIES = new Set(['canonical_completion_mutate', 'canonical_completion_read']);
const quote = name => '"' + name.replace(/"/g, '""') + '"';

async function grantAndVerify(client, runtimeRole) {
  const exists = await client.query(
    "SELECT to_regclass('public.canonical_completion_records') IS NOT NULL AS present"
  );
  if (!exists.rows[0].present) return;
  const tables = await client.query(
    "SELECT oid,oid::regclass::text AS identity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relname LIKE 'canonical_completion_%'"
  );
  const functions = await client.query(
    "SELECT oid,proname,oid::regprocedure::text AS identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_completion_%'"
  );
  const role = quote(runtimeRole);
  for (const row of tables.rows) {
    await client.query(`REVOKE ALL ON TABLE ${row.identity} FROM PUBLIC, ${role}`);
    const privilege = await client.query(
      "SELECT has_table_privilege($1,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS permitted",
      [runtimeRole, row.oid]
    );
    if (privilege.rows[0].permitted) throw new Error('Completion table authority was not withheld');
  }
  for (const row of functions.rows) {
    await client.query(`REVOKE ALL ON FUNCTION ${row.identity} FROM PUBLIC, ${role}`);
    if (ENTRIES.has(row.proname)) await client.query(`GRANT EXECUTE ON FUNCTION ${row.identity} TO ${role}`);
    const privilege = await client.query(
      "SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS permitted", [runtimeRole, row.oid]
    );
    if (privilege.rows[0].permitted !== ENTRIES.has(row.proname)) {
      throw new Error('Completion function authority was not verified');
    }
  }
  if (functions.rows.filter(row => ENTRIES.has(row.proname)).length !== ENTRIES.size) {
    throw new Error('Completion entry authority is incomplete');
  }
}

module.exports = { grantAndVerify };
