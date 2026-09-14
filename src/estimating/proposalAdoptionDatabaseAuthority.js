'use strict';
const ENTRIES=new Set(['canonical_proposal_adoption_read','canonical_proposal_adoption_mutate']);
async function grantAndVerify(client,runtimeRole){
 const role='"'+runtimeRole.replace(/"/g,'""')+'"';
 await client.query('REVOKE ALL ON TABLE public.canonical_estimate_proposal_adoptions FROM PUBLIC, '+role);
 if((await client.query("SELECT has_table_privilege($1,'public.canonical_estimate_proposal_adoptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') permitted",[runtimeRole])).rows[0].permitted)throw new Error('Aggregate ledger privileges not withheld');
 const functions=(await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_proposal_adoption_%'")).rows;
 for(const fn of functions){await client.query('REVOKE ALL ON FUNCTION '+fn.identity+' FROM PUBLIC, '+role);if(ENTRIES.has(fn.proname))await client.query('GRANT EXECUTE ON FUNCTION '+fn.identity+' TO '+role);if((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') permitted",[runtimeRole,fn.oid])).rows[0].permitted!==ENTRIES.has(fn.proname))throw new Error('Aggregate function privileges invalid');}
 if(functions.length!==5||functions.filter(f=>ENTRIES.has(f.proname)).length!==2)throw new Error('Aggregate function inventory changed');
}
module.exports={grantAndVerify};
