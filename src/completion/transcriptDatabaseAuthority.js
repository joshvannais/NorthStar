'use strict';

const quote = name => '"' + name.replace(/"/g, '""') + '"';

async function grantAndVerify(client, runtimeRole) {
  const exists = await client.query(
    "SELECT to_regprocedure('public.canonical_completion_mutate_v049(uuid,uuid,text,uuid,text,uuid,text,bigint,text,bigint,text,jsonb,text,text,text)') IS NOT NULL AS present"
  );
  if (!exists.rows[0].present) return;
  const columns = (await client.query(
    "SELECT attname FROM pg_attribute WHERE attrelid='public.canonical_transcripts'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum"
  )).rows.map(row => row.attname);
  const role = quote(runtimeRole);
  await client.query(`REVOKE UPDATE, DELETE ON TABLE public.canonical_transcripts FROM PUBLIC, ${role}`);
  await client.query(`REVOKE UPDATE (${columns.map(quote).join(',')}) ON TABLE public.canonical_transcripts FROM PUBLIC, ${role}`);
  // Existing scheduling FOR SHARE needs an UPDATE column privilege. Text is
  // not provenance: all identity, source, version, external and fingerprint
  // columns remain unwritable. No production transcript UPDATE is introduced.
  await client.query(`GRANT UPDATE (transcript_text) ON TABLE public.canonical_transcripts TO ${role}`);
  const privileges = await client.query(
    `SELECT has_table_privilege($1,'public.canonical_transcripts','SELECT') AS readable,
      has_table_privilege($1,'public.canonical_transcripts','INSERT') AS insertable,
      has_table_privilege($1,'public.canonical_transcripts','UPDATE,DELETE,TRUNCATE,TRIGGER') AS writable,
      ARRAY(SELECT attname::text FROM pg_attribute
        WHERE attrelid='public.canonical_transcripts'::regclass AND attnum>0 AND NOT attisdropped
        AND has_column_privilege($1,attrelid,attnum,'UPDATE') ORDER BY attname) AS updatable`,
    [runtimeRole]
  );
  const value = privileges.rows[0];
  if (!value.readable || !value.insertable || value.writable ||
      value.updatable.length !== 1 || value.updatable[0] !== 'transcript_text') {
    throw new Error('Transcript provenance authority was not withheld');
  }
}

module.exports = { grantAndVerify };
