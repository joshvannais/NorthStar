'use strict';
const ENTRIES=new Set(['canonical_estimate_revision_read','canonical_estimate_revision_decisions','canonical_estimate_revision_mutate']);
async function grantAndVerify(client,runtimeRole){
 if(!(await client.query("SELECT to_regclass('public.canonical_estimate_revisions') IS NOT NULL AS present")).rows[0].present)throw new Error('Estimate revision authority is missing');
 const role='"'+runtimeRole.replace(/"/g,'""')+'"';
 await client.query('REVOKE ALL ON TABLE public.canonical_estimate_revisions FROM PUBLIC, '+role);
 if((await client.query("SELECT has_table_privilege($1,'public.canonical_estimate_revisions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') permitted",[runtimeRole])).rows[0].permitted)throw new Error('Estimate revision table authority not withheld');
 const functions=(await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_estimate_revision_%'")).rows;
 for(const fn of functions){await client.query('REVOKE ALL ON FUNCTION '+fn.identity+' FROM PUBLIC, '+role);if(ENTRIES.has(fn.proname))await client.query('GRANT EXECUTE ON FUNCTION '+fn.identity+' TO '+role);if((await client.query('SELECT has_function_privilege($1,$2::oid,\'EXECUTE\') permitted',[runtimeRole,fn.oid])).rows[0].permitted!==ENTRIES.has(fn.proname))throw new Error('Estimate revision grants invalid');}
 if(functions.filter(fn=>ENTRIES.has(fn.proname)).length!==3)throw new Error('Estimate revision entry points missing');
}
module.exports={grantAndVerify};
