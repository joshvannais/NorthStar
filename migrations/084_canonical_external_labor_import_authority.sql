-- Mission 25 Part 3: provider-neutral external labor/time import authority.
-- Normalized source evidence is staged with exact consent, cursor and version lineage.
-- It does not alter operational labor, estimates, payroll, schedules or policy.

CREATE TABLE public.canonical_external_labor_import_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["external_labor_time_normalized_v1"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-external-labor-import-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_labor_import_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_labor_import_runs (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 mode TEXT NOT NULL CHECK(mode IN ('historical_backfill','continuous_update')),
 sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000),
 previous_run_id UUID,
 consent_id UUID NOT NULL,
 consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),
 consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 schema_version TEXT NOT NULL CHECK(schema_version='m25-external-labor-time-v1'),
 cursor_before TEXT CHECK(cursor_before IS NULL OR (char_length(cursor_before) BETWEEN 1 AND 512 AND cursor_before~'^[!-~]+$')),
 cursor_after TEXT CHECK(cursor_after IS NULL OR (char_length(cursor_after) BETWEEN 1 AND 512 AND cursor_after~'^[!-~]+$')),
 complete BOOLEAN NOT NULL,
 record_count INTEGER NOT NULL CHECK(record_count BETWEEN 1 AND 100),
 inserted_count INTEGER NOT NULL CHECK(inserted_count BETWEEN 0 AND record_count),
 corrected_count INTEGER NOT NULL CHECK(corrected_count BETWEEN 0 AND record_count),
 duplicate_count INTEGER NOT NULL CHECK(duplicate_count BETWEEN 0 AND record_count),
 tombstoned_count INTEGER NOT NULL CHECK(tombstoned_count BETWEEN 0 AND record_count),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-labor-import-batch-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,mode,sequence),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_run_id)
  REFERENCES public.canonical_external_labor_import_runs(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,consent_id)
  REFERENCES public.canonical_external_labor_import_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((sequence=1 AND previous_run_id IS NULL) OR (sequence>1 AND previous_run_id IS NOT NULL)),
 CHECK(inserted_count+corrected_count+duplicate_count+tombstoned_count=record_count),
 CHECK((mode='continuous_update' AND complete=FALSE AND cursor_after IS NOT NULL)
   OR (mode='historical_backfill' AND ((complete AND cursor_after IS NULL) OR (NOT complete AND cursor_after IS NOT NULL))))
);

CREATE TABLE public.canonical_external_labor_import_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 external_record_id TEXT NOT NULL CHECK(char_length(external_record_id) BETWEEN 1 AND 128 AND external_record_id~'^[!-~]+$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),
 previous_id UUID,
 external_version BIGINT NOT NULL CHECK(external_version BETWEEN 1 AND 1000000000),
 state TEXT NOT NULL CHECK(state IN ('active','tombstone')),
 worker_reference TEXT CHECK(worker_reference IS NULL OR (char_length(worker_reference) BETWEEN 1 AND 128 AND worker_reference~'^[!-~]+$')),
 job_reference TEXT CHECK(job_reference IS NULL OR (char_length(job_reference) BETWEEN 1 AND 128 AND job_reference~'^[!-~]+$')),
 category TEXT CHECK(category IS NULL OR category IN ('setup','production','cleanup','travel','other')),
 observed_start TIMESTAMPTZ,
 observed_end TIMESTAMPTZ,
 source_updated_at TIMESTAMPTZ NOT NULL,
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 import_run_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,external_record_id,revision),
 UNIQUE(organization_id,source_key,external_record_id,external_version),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_labor_import_records(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,import_run_id)
  REFERENCES public.canonical_external_labor_import_runs(organization_id,source_key,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((state='active' AND worker_reference IS NOT NULL AND job_reference IS NOT NULL AND category IS NOT NULL
    AND observed_start IS NOT NULL AND observed_end IS NOT NULL AND observed_end>observed_start
    AND observed_end-observed_start<=INTERVAL '168 hours')
   OR (state='tombstone' AND worker_reference IS NULL AND job_reference IS NULL AND category IS NULL
    AND observed_start IS NULL AND observed_end IS NULL))
);

CREATE INDEX canonical_external_labor_import_records_current_idx
 ON public.canonical_external_labor_import_records(organization_id,source_key,external_record_id,revision DESC);

CREATE TRIGGER canonical_external_labor_import_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_labor_import_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_labor_import_runs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_labor_import_runs FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_labor_import_records_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_labor_import_records FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_external_labor_import_consent_projection(value public.canonical_external_labor_import_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'revision',value.revision,
  'previousId',value.previous_id,'action',value.action,'sourceScope',value.source_scope,
  'consentVersion',value.consent_version,'reason',value.reason,'digest',rtrim(value.canonical_digest),
  'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_external_labor_import_run_projection(value public.canonical_external_labor_import_runs)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'mode',value.mode,'sequence',value.sequence,
  'previousRunId',value.previous_run_id,'consentId',value.consent_id,'consentRevision',value.consent_revision,
  'consentDigest',rtrim(value.consent_digest),'schemaVersion',value.schema_version,
  'cursorBefore',value.cursor_before,'cursorAfter',value.cursor_after,'complete',value.complete,
  'recordCount',value.record_count,'insertedCount',value.inserted_count,'correctedCount',value.corrected_count,
  'duplicateCount',value.duplicate_count,'tombstonedCount',value.tombstoned_count,
  'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_external_labor_import_record_projection(value public.canonical_external_labor_import_records)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'externalRecordId',value.external_record_id,
  'revision',value.revision,'previousId',value.previous_id,'externalVersion',value.external_version,'state',value.state,
  'workerReference',CASE WHEN value.state='active' THEN value.worker_reference ELSE NULL END,
  'jobReference',CASE WHEN value.state='active' THEN value.job_reference ELSE NULL END,
  'category',CASE WHEN value.state='active' THEN value.category ELSE NULL END,
  'observedStart',CASE WHEN value.state='active' THEN value.observed_start ELSE NULL END,
  'observedEnd',CASE WHEN value.state='active' THEN value.observed_end ELSE NULL END,
  'sourceUpdatedAt',value.source_updated_at,'sourceDigest',rtrim(value.source_digest),'importRunId',value.import_run_id,
  'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_external_labor_import_consent_read(org UUID,actor UUID,role_value TEXT,
 session_value UUID,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_external_labor_import_consents%ROWTYPE; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'External labor imports are restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN
  RAISE EXCEPTION 'External labor source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND source_key=source_value;
 SELECT COALESCE(jsonb_agg(public.canonical_external_labor_import_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_external_labor_import_consents
   WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'current',CASE WHEN current_row.id IS NULL THEN NULL
   ELSE public.canonical_external_labor_import_consent_projection(current_row) END,
  'active',COALESCE(current_row.action='grant',FALSE),'history',history,'total',total,'truncated',total>20);
END $$;

CREATE FUNCTION public.canonical_external_labor_import_consent_mutate(org UUID,actor UUID,role_value TEXT,
 session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_external_labor_import_consents%ROWTYPE;
 old public.canonical_external_labor_import_consents%ROWTYPE; inserted public.canonical_external_labor_import_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External labor imports are restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string'
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-labor-import-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'External labor import consent invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-labor-consent:'||source_value,0));
 SELECT * INTO old FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'External labor consent key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('consent',public.canonical_external_labor_import_consent_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'External labor consent changed' USING ERRCODE='40001',CONSTRAINT='learning_import_consent_stale'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN
  RAISE EXCEPTION 'No active external labor consent' USING ERRCODE='22023'; END IF;
 IF body->>'action'='grant' AND current_row.action='grant' THEN
  RAISE EXCEPTION 'External labor consent is already active' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'revision',next_revision,'previousId',current_row.id,'action',body->>'action','actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,
  'sourceScope','["external_labor_time_normalized_v1"]'::jsonb,
  'consentVersion','m25-external-labor-import-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_labor_import_consents(organization_id,source_key,revision,previous_id,action,
  actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,
  session_value,'["external_labor_time_normalized_v1"]'::jsonb,'m25-external-labor-import-consent-v1',body->>'reason',
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_external_labor_import_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_labor_import_batch(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_external_labor_import_consents%ROWTYPE;
 previous_run public.canonical_external_labor_import_runs%ROWTYPE; replay_run public.canonical_external_labor_import_runs%ROWTYPE;
 existing_version public.canonical_external_labor_import_records%ROWTYPE; current_record public.canonical_external_labor_import_records%ROWTYPE;
 inserted_run public.canonical_external_labor_import_runs%ROWTYPE; record_value JSONB; record_digest TEXT;
 key_hash TEXT; request_hash TEXT; run_digest TEXT; run_id UUID:=gen_random_uuid(); next_sequence BIGINT;
 inserted_count INTEGER:=0; corrected_count INTEGER:=0; duplicate_count INTEGER:=0; tombstoned_count INTEGER:=0;
 record_count INTEGER; record_state TEXT; external_id TEXT; external_version_value BIGINT; next_revision BIGINT;
 start_value TIMESTAMPTZ; end_value TIMESTAMPTZ; updated_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External labor imports are restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>524288
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore','cursorAfter','complete','records','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'schemaVersion' IS DISTINCT FROM 'm25-external-labor-time-v1'
  OR body->>'mode' NOT IN ('historical_backfill','continuous_update')
  OR jsonb_typeof(body->'expectedConsentRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedConsentRevision')!~'^([1-9][0-9]{0,3}|10000)$'
  OR body->>'expectedConsentDigest'!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(body->'complete') IS DISTINCT FROM 'boolean' OR jsonb_typeof(body->'records') IS DISTINCT FROM 'array'
  OR jsonb_array_length(body->'records') NOT BETWEEN 1 AND 100 OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-labor-import-batch-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
  OR (body->'cursorBefore'<>'null'::jsonb AND (jsonb_typeof(body->'cursorBefore') IS DISTINCT FROM 'string'
    OR char_length(body->>'cursorBefore') NOT BETWEEN 1 AND 512 OR body->>'cursorBefore'!~'^[!-~]+$'))
  OR (body->'cursorAfter'<>'null'::jsonb AND (jsonb_typeof(body->'cursorAfter') IS DISTINCT FROM 'string'
    OR char_length(body->>'cursorAfter') NOT BETWEEN 1 AND 512 OR body->>'cursorAfter'!~'^[!-~]+$'))
  OR (body->>'mode'='continuous_update' AND ((body->>'complete')::boolean OR body->'cursorAfter'='null'::jsonb))
  OR (body->>'mode'='historical_backfill' AND (((body->>'complete')::boolean AND body->'cursorAfter'<>'null'::jsonb)
    OR (NOT (body->>'complete')::boolean AND body->'cursorAfter'='null'::jsonb)))
 THEN RAISE EXCEPTION 'External labor import batch invalid' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM (SELECT item->>'externalRecordId' FROM jsonb_array_elements(body->'records') item
   GROUP BY item->>'externalRecordId') unique_records)<>jsonb_array_length(body->'records') THEN
  RAISE EXCEPTION 'External labor batch duplicate identity' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
 'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-labor-import:'||source_value,0));
 SELECT * INTO consent_row FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF consent_row.id IS NULL OR consent_row.action<>'grant'
  OR consent_row.revision<>(body->>'expectedConsentRevision')::bigint
  OR rtrim(consent_row.canonical_digest)<>body->>'expectedConsentDigest' THEN
  RAISE EXCEPTION 'External labor import consent changed' USING ERRCODE='40001',CONSTRAINT='learning_import_consent_stale'; END IF;
 SELECT * INTO replay_run FROM public.canonical_external_labor_import_runs
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_run.request_digest)<>request_hash THEN RAISE EXCEPTION 'External labor import key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('run',public.canonical_external_labor_import_run_projection(replay_run),'replayed',TRUE);
 END IF;
 SELECT * INTO previous_run FROM public.canonical_external_labor_import_runs
  WHERE organization_id=org AND source_key=source_value AND mode=body->>'mode' ORDER BY sequence DESC LIMIT 1 FOR UPDATE;
 IF previous_run.id IS NULL THEN
  IF body->'cursorBefore'<>'null'::jsonb THEN RAISE EXCEPTION 'External labor cursor changed'
   USING ERRCODE='40001',CONSTRAINT='learning_import_cursor_stale'; END IF;
 ELSE
  IF previous_run.cursor_after IS DISTINCT FROM body->>'cursorBefore' THEN RAISE EXCEPTION 'External labor cursor changed'
   USING ERRCODE='40001',CONSTRAINT='learning_import_cursor_stale'; END IF;
  IF previous_run.mode='historical_backfill' AND previous_run.complete THEN
   RAISE EXCEPTION 'External labor backfill is complete' USING ERRCODE='22023'; END IF;
 END IF;
 next_sequence:=COALESCE(previous_run.sequence,0)+1; record_count:=jsonb_array_length(body->'records');
 FOR record_value IN SELECT value FROM jsonb_array_elements(body->'records') LOOP
  IF public.canonical_field_evidence_object_keys_exact(record_value,ARRAY['externalRecordId','externalVersion','state','workerReference','jobReference','category','observedStart','observedEnd','sourceUpdatedAt']) IS NOT TRUE
   OR jsonb_typeof(record_value->'externalRecordId') IS DISTINCT FROM 'string'
   OR char_length(record_value->>'externalRecordId') NOT BETWEEN 1 AND 128 OR record_value->>'externalRecordId'!~'^[!-~]+$'
   OR jsonb_typeof(record_value->'externalVersion') IS DISTINCT FROM 'number'
   OR (record_value->>'externalVersion')!~'^([1-9][0-9]{0,8}|1000000000)$' OR record_value->>'state' NOT IN ('active','tombstone')
  OR jsonb_typeof(record_value->'sourceUpdatedAt') IS DISTINCT FROM 'string'
  OR record_value->>'sourceUpdatedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   OR NOT pg_input_is_valid(record_value->>'sourceUpdatedAt','timestamp with time zone')
  THEN RAISE EXCEPTION 'External labor record invalid' USING ERRCODE='22023'; END IF;
  external_id:=record_value->>'externalRecordId'; external_version_value:=(record_value->>'externalVersion')::bigint;
  record_state:=record_value->>'state'; updated_value:=(record_value->>'sourceUpdatedAt')::timestamptz;
  IF updated_value>clock_timestamp()+INTERVAL '5 minutes' THEN RAISE EXCEPTION 'External labor source time invalid' USING ERRCODE='22023'; END IF;
  IF record_state='active' THEN
   IF jsonb_typeof(record_value->'workerReference') IS DISTINCT FROM 'string'
    OR char_length(record_value->>'workerReference') NOT BETWEEN 1 AND 128 OR record_value->>'workerReference'!~'^[!-~]+$'
    OR jsonb_typeof(record_value->'jobReference') IS DISTINCT FROM 'string'
    OR char_length(record_value->>'jobReference') NOT BETWEEN 1 AND 128 OR record_value->>'jobReference'!~'^[!-~]+$'
    OR record_value->>'category' NOT IN ('setup','production','cleanup','travel','other')
    OR record_value->>'observedStart'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    OR record_value->>'observedEnd'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    OR NOT pg_input_is_valid(record_value->>'observedStart','timestamp with time zone')
    OR NOT pg_input_is_valid(record_value->>'observedEnd','timestamp with time zone')
   THEN RAISE EXCEPTION 'External labor record invalid' USING ERRCODE='22023'; END IF;
   start_value:=(record_value->>'observedStart')::timestamptz; end_value:=(record_value->>'observedEnd')::timestamptz;
   IF end_value<=start_value OR end_value-start_value>INTERVAL '168 hours' THEN
    RAISE EXCEPTION 'External labor record duration invalid' USING ERRCODE='22023'; END IF;
  ELSE
   IF record_value->'workerReference'<>'null'::jsonb OR record_value->'jobReference'<>'null'::jsonb
    OR record_value->'category'<>'null'::jsonb OR record_value->'observedStart'<>'null'::jsonb
    OR record_value->'observedEnd'<>'null'::jsonb THEN
    RAISE EXCEPTION 'External labor tombstone retained details' USING ERRCODE='22023'; END IF;
   start_value:=NULL;end_value:=NULL;
  END IF;
  record_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
   'externalRecordId',external_id,'externalVersion',external_version_value,'state',record_state,
   'workerReference',record_value->>'workerReference','jobReference',record_value->>'jobReference',
   'category',record_value->>'category','observedStart',start_value,'observedEnd',end_value,'sourceUpdatedAt',updated_value));
  SELECT * INTO existing_version FROM public.canonical_external_labor_import_records WHERE organization_id=org
   AND source_key=source_value AND external_record_id=external_id AND external_version=external_version_value;
  IF FOUND THEN
   IF rtrim(existing_version.source_digest)<>record_digest THEN RAISE EXCEPTION 'External labor record version conflict'
    USING ERRCODE='40001',CONSTRAINT='learning_import_record_conflict'; END IF;
   duplicate_count:=duplicate_count+1; CONTINUE;
  END IF;
  SELECT * INTO current_record FROM public.canonical_external_labor_import_records WHERE organization_id=org
   AND source_key=source_value AND external_record_id=external_id ORDER BY revision DESC LIMIT 1 FOR UPDATE;
  IF current_record.id IS NOT NULL AND external_version_value<=current_record.external_version THEN
   RAISE EXCEPTION 'External labor record version changed' USING ERRCODE='40001',CONSTRAINT='learning_import_record_conflict'; END IF;
  next_revision:=COALESCE(current_record.revision,0)+1;
  INSERT INTO public.canonical_external_labor_import_records(organization_id,source_key,external_record_id,revision,
   previous_id,external_version,state,worker_reference,job_reference,category,observed_start,observed_end,
   source_updated_at,source_digest,import_run_id)
  VALUES(org,source_value,external_id,next_revision,current_record.id,external_version_value,record_state,
   CASE WHEN record_state='active' THEN record_value->>'workerReference' ELSE NULL END,
   CASE WHEN record_state='active' THEN record_value->>'jobReference' ELSE NULL END,
   CASE WHEN record_state='active' THEN record_value->>'category' ELSE NULL END,start_value,end_value,
   updated_value,record_digest,run_id);
  IF record_state='tombstone' THEN tombstoned_count:=tombstoned_count+1;
  ELSIF current_record.id IS NULL THEN inserted_count:=inserted_count+1;
  ELSE corrected_count:=corrected_count+1; END IF;
 END LOOP;
 run_digest:=public.canonical_completion_digest(jsonb_build_object('id',run_id,'organizationId',org,'sourceKey',source_value,
  'mode',body->>'mode','sequence',next_sequence,'previousRunId',previous_run.id,'consentId',consent_row.id,
  'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),
  'schemaVersion','m25-external-labor-time-v1','cursorBefore',body->>'cursorBefore','cursorAfter',body->>'cursorAfter',
  'complete',(body->>'complete')::boolean,'recordCount',record_count,'insertedCount',inserted_count,
  'correctedCount',corrected_count,'duplicateCount',duplicate_count,'tombstonedCount',tombstoned_count,
  'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,
  'reason',body->>'reason','confirmed',TRUE,'confirmationVersion','m25-external-labor-import-batch-v1',
  'requestDigest',request_hash));
 INSERT INTO public.canonical_external_labor_import_runs(id,organization_id,source_key,mode,sequence,previous_run_id,
  consent_id,consent_revision,consent_digest,schema_version,cursor_before,cursor_after,complete,record_count,
  inserted_count,corrected_count,duplicate_count,tombstoned_count,actor_user_id,membership_id,auth_session_id,
  reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(run_id,org,source_value,body->>'mode',next_sequence,previous_run.id,consent_row.id,consent_row.revision,
  rtrim(consent_row.canonical_digest),'m25-external-labor-time-v1',body->>'cursorBefore',body->>'cursorAfter',
  (body->>'complete')::boolean,record_count,inserted_count,corrected_count,duplicate_count,tombstoned_count,
  actor,(authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,'m25-external-labor-import-batch-v1',
  key_hash,request_hash,run_digest) RETURNING * INTO inserted_run;
 RETURN jsonb_build_object('run',public.canonical_external_labor_import_run_projection(inserted_run),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_labor_import_read(org UUID,actor UUID,role_value TEXT,session_value UUID,
 source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_labor_import_consents%ROWTYPE; runs JSONB; records JSONB;
 run_total BIGINT; record_total BIGINT; latest_source TIMESTAMPTZ;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External labor imports are restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External labor source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO consent_row FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF consent_row.id IS NULL OR consent_row.action<>'grant' THEN
  RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',FALSE,'runs','[]'::jsonb,'runTotal',0,
   'runsTruncated',FALSE,'currentRecords','[]'::jsonb,'recordTotal',0,'recordsTruncated',FALSE,
   'latestSourceUpdatedAt',NULL,'consumptionBoundary','No imported record is available while source consent is inactive.');
 END IF;
 SELECT count(*) INTO run_total FROM public.canonical_external_labor_import_runs
  WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id;
 SELECT COALESCE(jsonb_agg(public.canonical_external_labor_import_run_projection(item) ORDER BY created_at DESC,id DESC),'[]'::jsonb)
  INTO runs FROM (SELECT * FROM public.canonical_external_labor_import_runs WHERE organization_id=org
   AND source_key=source_value AND consent_id=consent_row.id ORDER BY created_at DESC,id DESC LIMIT 20) item;
 WITH current_records AS (SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
  WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC)
 SELECT count(*),max(source_updated_at) INTO record_total,latest_source FROM current_records;
 WITH current_records AS (SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
  WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC),
 selected AS (SELECT * FROM current_records ORDER BY external_record_id LIMIT 100)
 SELECT COALESCE(jsonb_agg(public.canonical_external_labor_import_record_projection(item) ORDER BY external_record_id),'[]'::jsonb)
  INTO records FROM selected item;
 RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,
  'consent',public.canonical_external_labor_import_consent_projection(consent_row),'runs',runs,'runTotal',run_total,
  'runsTruncated',run_total>20,'currentRecords',records,'recordTotal',record_total,'recordsTruncated',record_total>100,
  'latestSourceUpdatedAt',latest_source,
  'consumptionBoundary','Imported records remain staged evidence. They do not change operational labor, estimates, payroll, schedules or policy.');
END $$;

REVOKE ALL ON TABLE public.canonical_external_labor_import_consents,
 public.canonical_external_labor_import_runs, public.canonical_external_labor_import_records FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_import_consent_projection(public.canonical_external_labor_import_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_import_run_projection(public.canonical_external_labor_import_runs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_import_record_projection(public.canonical_external_labor_import_records) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_import_consent_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_import_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_import_batch(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_import_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
