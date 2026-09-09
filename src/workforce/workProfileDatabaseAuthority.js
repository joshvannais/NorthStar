'use strict';
const ENTRIES = new Set(['canonical_work_profile_read','canonical_work_profile_directory','canonical_work_profile_mutate']);
const quote = name => '"' + name.replace(/"/g, '""') + '"';
async function grantAndVerify(client, runtimeRole) {
  if (!(await client.query("SELECT to_regclass('public.canonical_work_profile_events') IS NOT NULL AS present")).rows[0].present) return;
  const role = quote(runtimeRole);
  await client.query('REVOKE ALL ON TABLE public.canonical_work_profile_events FROM PUBLIC, ' + role);
  if ((await client.query("SELECT has_table_privilege($1,'public.canonical_work_profile_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS permitted", [runtimeRole])).rows[0].permitted) throw new Error('Work profile table authority not withheld');
  const functions = (await client.query("SELECT oid,proname,oid::regprocedure::text AS identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_work_profile_%'")).rows;
  for (const row of functions) {
    await client.query('REVOKE ALL ON FUNCTION ' + row.identity + ' FROM PUBLIC, ' + role);
    if (ENTRIES.has(row.proname)) await client.query('GRANT EXECUTE ON FUNCTION ' + row.identity + ' TO ' + role);
    if ((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS permitted", [runtimeRole,row.oid])).rows[0].permitted !== ENTRIES.has(row.proname)) throw new Error('Work profile entry authority not verified');
  }
  if (functions.filter(row => ENTRIES.has(row.proname)).length !== ENTRIES.size) throw new Error('Work profile authority incomplete');
}
module.exports = { grantAndVerify };
