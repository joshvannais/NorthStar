-- Mission 23 Part 8 third correction: no runtime transcript UPDATE capability.
-- No data rewrite or transcript correction product capability is introduced.
-- The runner reasserts these ACLs after its broad grants, including zero-op
-- startups. Migrations 001-051 remain unchanged.
DO $transcript_insert_only$
DECLARE
 runtime_role TEXT := nullif(current_setting('northstar.runtime_role',true),'');
 column_list TEXT;
BEGIN
 SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO column_list
  FROM pg_catalog.pg_attribute
  WHERE attrelid='public.canonical_transcripts'::regclass AND attnum>0 AND NOT attisdropped;
 REVOKE UPDATE,DELETE ON TABLE public.canonical_transcripts FROM PUBLIC;
 EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.canonical_transcripts FROM PUBLIC',column_list);
 IF runtime_role IS NOT NULL THEN
  EXECUTE format('REVOKE UPDATE,DELETE ON TABLE public.canonical_transcripts FROM %I',runtime_role);
  EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.canonical_transcripts FROM %I',column_list,runtime_role);
 END IF;
END $transcript_insert_only$;
