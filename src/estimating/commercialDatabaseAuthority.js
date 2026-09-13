'use strict';
const ENTRIES=new Set(['canonical_commercial_tax_claim','canonical_commercial_tax_finish','canonical_commercial_tax_backfill','canonical_commercial_sources','canonical_commercial_read','canonical_commercial_mutate','canonical_commercial_approve','canonical_commercial_tax_read','canonical_commercial_tax_mutate']);
async function grantAndVerify(client,runtimeRole){
 const role='"'+runtimeRole.replace(/"/g,'""')+'"';
 const tables=(await client.query("SELECT oid,relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND (relname LIKE 'canonical_tax_%' OR relname LIKE 'canonical_commercial_%')")).rows;
 for(const t of tables){const name='public."'+t.relname.replace(/"/g,'""')+'"';await client.query('REVOKE ALL ON TABLE '+name+' FROM PUBLIC, '+role);if((await client.query("SELECT has_table_privilege($1,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",[runtimeRole,t.oid])).rows[0].allowed)throw new Error('Commercial direct ledger authority not withheld');}
 const functions=(await client.query("SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_commercial_%'")).rows;
 for(const f of functions){await client.query('REVOKE ALL ON FUNCTION '+f.identity+' FROM PUBLIC, '+role);if(ENTRIES.has(f.proname))await client.query('GRANT EXECUTE ON FUNCTION '+f.identity+' TO '+role);if((await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') allowed",[runtimeRole,f.oid])).rows[0].allowed!==ENTRIES.has(f.proname))throw new Error('Commercial function authority invalid');}
 if(functions.filter(f=>ENTRIES.has(f.proname)).length!==ENTRIES.size)throw new Error('Commercial entry authority unavailable');
}
module.exports={grantAndVerify,ENTRIES};
