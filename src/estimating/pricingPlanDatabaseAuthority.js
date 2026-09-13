'use strict';
const ENTRIES=new Set(['canonical_pricing_plan_read','canonical_pricing_plan_mutate','canonical_pricing_sources']);
async function grantAndVerify(client,runtimeRole){
 const role='"'+runtimeRole.replace(/"/g,'""')+'"';
 await client.query('REVOKE ALL ON TABLE public.canonical_pricing_plans FROM PUBLIC, '+role);
 if((await client.query("SELECT has_table_privilege($1,'public.canonical_pricing_plans','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') permitted",[runtimeRole])).rows[0].permitted)throw new Error('Pricing ledger authority not withheld');
 const functions=(await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_pricing_%'")).rows;
 for(const fn of functions){await client.query('REVOKE ALL ON FUNCTION '+fn.identity+' FROM PUBLIC, '+role);if(ENTRIES.has(fn.proname))await client.query('GRANT EXECUTE ON FUNCTION '+fn.identity+' TO '+role);if((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') permitted",[runtimeRole,fn.oid])).rows[0].permitted!==ENTRIES.has(fn.proname))throw new Error('Pricing grants invalid');}
 if(functions.filter(fn=>ENTRIES.has(fn.proname)).length!==3)throw new Error('Pricing entries unavailable');
}
module.exports={grantAndVerify};
