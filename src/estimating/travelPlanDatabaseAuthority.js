'use strict';
const ENTRIES=new Set(['canonical_travel_plan_read','canonical_travel_plan_mutate','canonical_travel_plan_sources','canonical_travel_schedule_read','canonical_travel_write_authority']);
async function grantAndVerify(client,runtimeRole){
 if(!(await client.query("SELECT to_regclass('public.canonical_travel_plans') IS NOT NULL AS present")).rows[0].present)throw new Error('Travel authority is missing');
 const role='"'+runtimeRole.replace(/"/g,'""')+'"';
 await client.query('REVOKE ALL ON TABLE public.canonical_travel_plans, public.canonical_travel_fences FROM PUBLIC, '+role);
 if((await client.query("SELECT has_table_privilege($1,'public.canonical_travel_plans','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') permitted",[runtimeRole])).rows[0].permitted)throw new Error('Travel table authority not withheld');
 if((await client.query("SELECT has_table_privilege($1,'public.canonical_travel_fences','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') permitted",[runtimeRole])).rows[0].permitted)throw new Error('Travel fence authority not withheld');
 const functions=(await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_travel_%'")).rows;
 for(const fn of functions){await client.query('REVOKE ALL ON FUNCTION '+fn.identity+' FROM PUBLIC, '+role);if(ENTRIES.has(fn.proname))await client.query('GRANT EXECUTE ON FUNCTION '+fn.identity+' TO '+role);if((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') permitted",[runtimeRole,fn.oid])).rows[0].permitted!==ENTRIES.has(fn.proname))throw new Error('Travel grants invalid');}
 if(functions.filter(fn=>ENTRIES.has(fn.proname)).length!==5)throw new Error('Travel entry points missing');
}
module.exports={grantAndVerify};
