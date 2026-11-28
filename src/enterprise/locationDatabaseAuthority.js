'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PREFIX = 'canonical_enterprise_location_v1_';
const TABLE = 'public.canonical_enterprise_location_revisions_v1';
const ENTRIES = new Set(['read', 'preview', 'commit'].map(name => PREFIX + name));
const SIGNATURES = {
  keys: 'jsonb,text[]', uuid: 'text', text: 'jsonb,integer,boolean', pin: 'jsonb,boolean', digest: 'jsonb', immutable: '',
  authority: 'uuid,uuid,text,uuid,text,boolean', projection: 'canonical_enterprise_location_revisions_v1',
  plan: 'uuid,jsonb,jsonb', read: 'uuid,uuid,text,uuid,uuid,text,integer',
  preview: 'uuid,uuid,text,uuid,text,jsonb', commit: 'uuid,uuid,text,uuid,text,uuid,jsonb',
};
const COLUMNS = [
  ['organization_id', 'uuid', true], ['location_id', 'uuid', true], ['revision', 'integer', true],
  ['organization_revision', 'integer', true], ['id', 'uuid', true],
  ['previous_id', 'uuid', false], ['previous_digest', 'text', false], ['action', 'text', true], ['name', 'text', true],
  ['address', 'text', false], ['state', 'text', true], ['corrected_id', 'uuid', false], ['transfer_location_id', 'uuid', false],
  ['transfer_revision_id', 'uuid', false], ['transfer_revision', 'integer', false], ['transfer_digest', 'text', false],
  ['reason', 'text', true], ['request_key', 'uuid', true], ['request_digest', 'text', true], ['request_document', 'jsonb', true],
  ['review_digest', 'text', true], ['profile_pin', 'jsonb', true], ['actor_user_id', 'uuid', true], ['actor_session_id', 'uuid', true],
  ['recorded_at', 'timestamp with time zone', true], ['digest', 'text', true],
];
// Exact reviewed CHECK expressions as rendered by PostgreSQL; these are source
// expectations, never learned from the database being checked at startup.
const CHECKS = [
  "(((length(name) >= 1) AND (length(name) <= 160)) AND (btrim(name) = name) AND (name !~ '[[:cntrl:]]'::text))",
  "(((length(reason) >= 1) AND (length(reason) <= 2000)) AND (btrim(reason) = reason) AND (reason !~ '[[:cntrl:]]'::text))",
  "(((revision = 1) AND (action = 'create'::text) AND (previous_id IS NULL) AND (previous_digest IS NULL) AND (state = 'inactive'::text)) OR ((revision > 1) AND (action <> 'create'::text) AND (previous_id IS NOT NULL) AND (previous_digest IS NOT NULL) AND (length(previous_digest) = 64) AND (previous_digest ~ '^[0-9a-f]{64}$'::text)))",
  "(((state = 'transferred'::text) AND (transfer_location_id IS NOT NULL) AND (transfer_location_id <> location_id) AND (transfer_revision_id IS NOT NULL) AND (transfer_revision IS NOT NULL) AND (transfer_digest IS NOT NULL) AND (transfer_revision > 0) AND (length(transfer_digest) = 64) AND (transfer_digest ~ '^[0-9a-f]{64}$'::text)) OR ((state <> 'transferred'::text) AND (transfer_location_id IS NULL) AND (transfer_revision_id IS NULL) AND (transfer_revision IS NULL) AND (transfer_digest IS NULL)))",
  "((action = 'correct'::text) = (corrected_id IS NOT NULL))",
  "((address IS NULL) OR (((length(address) >= 1) AND (length(address) <= 500)) AND (btrim(address) = address) AND (address !~ '[[:cntrl:]]'::text)))",
  "((length(digest) = 64) AND (digest ~ '^[0-9a-f]{64}$'::text))",
  "((length(request_digest) = 64) AND (request_digest ~ '^[0-9a-f]{64}$'::text))",
  "((length(review_digest) = 64) AND (review_digest ~ '^[0-9a-f]{64}$'::text))",
  "(action = ANY (ARRAY['create'::text, 'activate'::text, 'deactivate'::text, 'rename'::text, 'correct'::text, 'relocate'::text, 'transfer'::text]))",
  '(revision > 0)',
  '(organization_revision > 0)',
  "(state = ANY (ARRAY['inactive'::text, 'active'::text, 'transferred'::text]))",
];
const SORTED = rows => rows.map(row => JSON.stringify(row)).sort();
const quote = value => '"' + value.replace(/"/g, '""') + '"';
function sourceBodies() {
  const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/290_enterprise_location_lifecycle_v1.sql'), 'utf8');
  const text = bytes.replace(/\r\n/g, '\n');
  if (text.includes('\r')) throw new Error('Location migration source line endings are invalid');
  const result = new Map();
  for (const match of text.matchAll(/CREATE FUNCTION public\.(canonical_enterprise_location_v1_\w+)\([\s\S]*?\bAS \$\$([\s\S]*?)\$\$;/g)) {
    if (result.has(match[1])) throw new Error('Duplicate location function source');
    result.set(match[1], match[2]);
  }
  if (result.size !== Object.keys(SIGNATURES).length) throw new Error('Location function source manifest is incomplete');
  return result;
}
async function grantAndVerify(client, runtimeRole) {
  const present = (await client.query(`SELECT to_regclass('${TABLE}') AS relation,
    EXISTS(SELECT 1 FROM public._migrations WHERE filename='290_enterprise_location_lifecycle_v1.sql') AS applied`)).rows[0];
  if (!present.relation && !present.applied) return;
  if (!present.relation || !present.applied) throw new Error('Location migration authority is incomplete');
  const role = quote(runtimeRole), bodies = sourceBodies();
  const table = (await client.query(`SELECT c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relkind,c.relpersistence,
    pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.oid='${TABLE}'::regclass`)).rows[0];
  const currentRole = (await client.query('SELECT current_user AS identity')).rows[0].identity;
  if (!table || table.owner !== currentRole || table.owner === runtimeRole || !table.relrowsecurity || !table.relforcerowsecurity || table.relkind !== 'r' || table.relpersistence !== 'p') {
    throw new Error('Location table owner/RLS authority is invalid');
  }
  const columns = (await client.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='${TABLE}'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
  if (JSON.stringify(columns.map(row => [row.attname, row.type, row.attnotnull])) !== JSON.stringify(COLUMNS)) throw new Error('Location schema differs from its contract');
  if (columns.some(row => row.default_expression !== (row.attname === 'id' ? 'gen_random_uuid()' : row.attname === 'recorded_at' ? 'clock_timestamp()' : null))) {
    throw new Error('Location column defaults differ from their contract');
  }
  const policies = (await client.query(`SELECT polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid) AS using_expression,
    pg_get_expr(polwithcheck,polrelid) AS check_expression FROM pg_policy WHERE polrelid='${TABLE}'::regclass`)).rows;
  const expression = "((organization_id)::text = current_setting('northstar.enterprise_company_id'::text, true))";
  if (policies.length !== 1 || policies[0].polcmd !== '*' || !policies[0].polpermissive ||
      String(policies[0].polroles) !== '0' || policies[0].using_expression !== expression || policies[0].check_expression !== expression) {
    throw new Error('Location tenant policy differs from its contract');
  }
  const indexes = (await client.query(`SELECT i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indisprimary,
    i.indnkeyatts,i.indnatts,i.indnullsnotdistinct,i.indoption::SMALLINT[] AS options,
    pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_expr(i.indexprs,i.indrelid) AS expressions,am.amname,
    (SELECT bool_and(n=0) FROM unnest(i.indcollation) AS t(n)) AS default_collations,
    ARRAY(SELECT opc.opcname::TEXT FROM unnest(i.indclass) WITH ORDINALITY k(n,ordinal)
      JOIN pg_opclass opc ON opc.oid=k.n ORDER BY k.ordinal) AS classes,
    ARRAY(SELECT a.attname::TEXT FROM unnest(i.indkey) WITH ORDINALITY k(n,ordinal)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.n ORDER BY k.ordinal) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
    WHERE i.indrelid='${TABLE}'::regclass`)).rows;
  const indexDefinition = row => [row.columns,row.indisunique,row.indisprimary,row.indnkeyatts,row.indnatts,
    row.indnullsnotdistinct,row.options,row.predicate,row.expressions,row.amname,row.classes,row.default_collations];
  const index = (columns, unique, primary, options, classes) => [columns,unique,primary,columns.length,columns.length,false,options,null,null,'btree',classes,true];
  const expectedIndexes = [
    index(['organization_id','location_id','revision'],true,true,[0,0,0],['uuid_ops','uuid_ops','int4_ops']),
    index(['organization_id','id'],true,false,[0,0],['uuid_ops','uuid_ops']),
    index(['organization_id','location_id','id'],true,false,[0,0,0],['uuid_ops','uuid_ops','uuid_ops']),
    index(['organization_id','request_key'],true,false,[0,0],['uuid_ops','uuid_ops']),
    index(['organization_id','organization_revision'],true,false,[0,0],['uuid_ops','int4_ops']),
    index(['organization_id','location_id','revision'],false,false,[0,0,3],['uuid_ops','uuid_ops','int4_ops']),
  ];
  if (indexes.some(row => !row.indisvalid || !row.indisready || !row.indislive) ||
      JSON.stringify(SORTED(indexes.map(indexDefinition))) !== JSON.stringify(SORTED(expectedIndexes))) {
    throw new Error('Location revision/request uniqueness is invalid');
  }
  const constraints = (await client.query(`SELECT c.contype,c.convalidated,c.condeferrable,c.condeferred,
    pg_get_expr(c.conbin,c.conrelid) AS expression,c.confupdtype,c.confdeltype,c.confmatchtype,
    CASE WHEN c.contype='f' THEN c.confrelid::regclass::TEXT ELSE NULL END AS target,
    ARRAY(SELECT a.attname::TEXT FROM unnest(c.conkey) WITH ORDINALITY k(n,ordinal)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ordinal) AS columns,
    ARRAY(SELECT a.attname::TEXT FROM unnest(c.confkey) WITH ORDINALITY k(n,ordinal)
      JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ordinal) AS target_columns
    FROM pg_constraint c WHERE c.conrelid='${TABLE}'::regclass`)).rows;
  if (constraints.filter(row => row.contype === 'f').length !== 4 || constraints.filter(row => row.contype === 'p').length !== 1 ||
      constraints.some(row => !row.convalidated || row.condeferrable)) throw new Error('Location scope constraints are invalid');
  const foreignKey = row => [row.columns,row.target,row.target_columns,row.confupdtype,row.confdeltype,row.confmatchtype,row.condeferred];
  const expectedForeignKeys = [
    [['organization_id'],'organizations',['id'],'a','r','s',false],
    [['organization_id','location_id','previous_id'],'canonical_enterprise_location_revisions_v1',['organization_id','location_id','id'],'a','a','s',false],
    [['organization_id','location_id','corrected_id'],'canonical_enterprise_location_revisions_v1',['organization_id','location_id','id'],'a','a','s',false],
    [['organization_id','transfer_location_id','transfer_revision_id'],'canonical_enterprise_location_revisions_v1',['organization_id','location_id','id'],'a','a','s',false],
  ];
  if (JSON.stringify(SORTED(constraints.filter(row => row.contype === 'f').map(foreignKey))) !== JSON.stringify(SORTED(expectedForeignKeys)) ||
      JSON.stringify(constraints.filter(row => row.contype === 'c').map(row => row.expression).sort()) !== JSON.stringify([...CHECKS].sort())) {
    throw new Error('Location scoped FK/CHECK definitions differ from their contract');
  }
  const functions = (await client.query(`SELECT p.oid,p.proname,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.pronargdefaults,
    oidvectortypes(p.proargtypes) AS arguments,format_type(p.prorettype,NULL) AS return_type,
    pg_get_userbyid(p.proowner) AS owner,p.oid::regprocedure::text AS identity
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'canonical_enterprise_location_v1_%'`)).rows;
  if (functions.length !== bodies.size) throw new Error('Location function inventory is incomplete');
  for (const row of functions) {
    const name = row.proname.slice(PREFIX.length), security = ENTRIES.has(row.proname) || name === 'authority';
    const volatile = ['keys', 'uuid', 'text', 'pin', 'digest'].includes(name) ? 'i' : name === 'projection' ? 's' : 'v';
    const returned = ['keys', 'uuid', 'text', 'pin'].includes(name) ? 'boolean' : name === 'digest' ? 'text' : name === 'immutable' ? 'trigger' : 'jsonb';
    if (!bodies.has(row.proname) || row.prosrc.replace(/\r\n/g, '\n') !== bodies.get(row.proname) || row.owner !== table.owner ||
        row.arguments.replace(/\s/g, '') !== SIGNATURES[name] || row.return_type !== returned || row.prosecdef !== security ||
        row.provolatile !== volatile || row.pronargdefaults !== 0 || JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, public, pg_temp'])) {
      throw new Error('Location function definition differs from reviewed source');
    }
    await client.query(`REVOKE ALL ON FUNCTION ${row.identity} FROM PUBLIC, ${role}`);
    if (ENTRIES.has(row.proname)) await client.query(`GRANT EXECUTE ON FUNCTION ${row.identity} TO ${role}`);
    const acl = (await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS runtime,has_function_privilege('public',$2::oid,'EXECUTE') AS public", [runtimeRole,row.oid])).rows[0];
    if (acl.runtime !== ENTRIES.has(row.proname) || acl.public) throw new Error('Location function grants are invalid');
  }
  const triggers = (await client.query(`SELECT tgtype,tgenabled,tgfoid::regproc::text AS function,tgnargs,tgqual,
    tgdeferrable,tginitdeferred,tgoldtable,tgnewtable FROM pg_trigger
    WHERE tgrelid='${TABLE}'::regclass AND NOT tgisinternal`)).rows;
  if (triggers.length !== 1 || triggers[0].tgtype !== 58 || triggers[0].tgenabled !== 'O' ||
      triggers[0].function !== PREFIX + 'immutable' || triggers[0].tgnargs !== 0 || triggers[0].tgqual !== null ||
      triggers[0].tgdeferrable || triggers[0].tginitdeferred || triggers[0].tgoldtable !== null || triggers[0].tgnewtable !== null) {
    throw new Error('Location immutable-history trigger is invalid');
  }
  await client.query(`REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC, ${role}`);
  const acl = (await client.query(`SELECT has_table_privilege($1,'${TABLE}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS runtime,
    has_table_privilege('public','${TABLE}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS public`, [runtimeRole])).rows[0];
  if (acl.runtime || acl.public) throw new Error('Location storage grants are not withheld');
}

module.exports = { grantAndVerify };
