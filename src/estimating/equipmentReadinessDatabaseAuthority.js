'use strict';
const ENTRIES=new Set(['canonical_equipment_readiness_read','canonical_equipment_readiness_mutate','canonical_equipment_readiness_sources','canonical_equipment_readiness_schedule_read']);
async function grantAndVerify(client,runtimeRole){
 if(!(await client.query("SELECT to_regclass('public.canonical_equipment_readiness_plans') IS NOT NULL AS present")).rows[0].present)throw new Error('Equipment readiness authority is missing');
 const role='"'+runtimeRole.replace(/"/g,'""')+'"';
 await client.query('REVOKE ALL ON TABLE public.canonical_equipment_readiness_plans, public.canonical_equipment_readiness_fences FROM PUBLIC, '+role);
 if((await client.query("SELECT (has_table_privilege($1,'public.canonical_equipment_readiness_plans','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege($1,'public.canonical_equipment_readiness_fences','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) permitted",[runtimeRole])).rows[0].permitted)throw new Error('Equipment readiness table authority not withheld');
 const functions=(await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'canonical_equipment_readiness_%')")).rows;
 for(const fn of functions){await client.query('REVOKE ALL ON FUNCTION '+fn.identity+' FROM PUBLIC, '+role);if(ENTRIES.has(fn.proname))await client.query('GRANT EXECUTE ON FUNCTION '+fn.identity+' TO '+role);if((await client.query('SELECT has_function_privilege($1,$2::oid,\'EXECUTE\') permitted',[runtimeRole,fn.oid])).rows[0].permitted!==ENTRIES.has(fn.proname))throw new Error('Equipment readiness grants invalid');}
 if(functions.filter(fn=>ENTRIES.has(fn.proname)).length!==4)throw new Error('Equipment readiness entry points missing');
}
module.exports={grantAndVerify};
