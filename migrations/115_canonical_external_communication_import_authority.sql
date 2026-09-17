-- Mission 25 Part 12C: provider-neutral, tenant-private communication evidence.
-- This stages normalized evidence only. It does not call providers, reconcile opaque references,
-- calculate an outcome, or change customers, leads, jobs, appointments, estimates, invoices,
-- payments, dispatch, schedules, costs, provider state or company policy.
-- Every external ID/reference is the exact shared ref_<64 lowercase hex> representation of a
-- source-scoped, non-reversible adapter token. Import cursors use cur_<64 lowercase hex>.
-- Raw provider identifiers, contact details, names and message-like content fail closed.

CREATE TABLE public.canonical_external_communication_import_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('grant','revoke')), actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 source_scope JSONB NOT NULL CHECK(source_scope='["external_communication_normalized_v1"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-external-communication-import-consent-v1'), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,source_key,previous_id) REFERENCES public.canonical_external_communication_import_consents(organization_id,source_key,id)
);

CREATE TABLE public.canonical_external_communication_import_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id), source_key TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('historical_backfill','continuous_update')), sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000), previous_run_id UUID,
 consent_id UUID NOT NULL, consent_revision BIGINT NOT NULL, consent_digest TEXT NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 schema_version TEXT NOT NULL CHECK(schema_version='m25-external-communication-evidence-v1'),
 cursor_before TEXT CHECK(cursor_before IS NULL OR cursor_before~'^cur_[0-9a-f]{64}$'),
 cursor_after TEXT CHECK(cursor_after IS NULL OR cursor_after~'^cur_[0-9a-f]{64}$'), complete BOOLEAN NOT NULL,
 record_count INTEGER NOT NULL CHECK(record_count BETWEEN 1 AND 100), inserted_count INTEGER NOT NULL, corrected_count INTEGER NOT NULL,
 duplicate_count INTEGER NOT NULL, tombstoned_count INTEGER NOT NULL, actor_user_id UUID NOT NULL, membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000), confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-communication-import-batch-v1'), request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'), canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_key,mode,sequence), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id), UNIQUE(organization_id,source_key,consent_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,source_key,consent_id) REFERENCES public.canonical_external_communication_import_consents(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_run_id) REFERENCES public.canonical_external_communication_import_runs(organization_id,source_key,id),
 CHECK(inserted_count>=0 AND corrected_count>=0 AND duplicate_count>=0 AND tombstoned_count>=0
  AND inserted_count+corrected_count+duplicate_count+tombstoned_count=record_count),
 CHECK((mode='continuous_update' AND complete=FALSE AND cursor_after IS NOT NULL) OR (mode='historical_backfill' AND ((complete AND cursor_after IS NULL) OR (NOT complete AND cursor_after IS NOT NULL))))
);
CREATE INDEX canonical_external_communication_run_period_idx ON public.canonical_external_communication_import_runs(organization_id,source_key,consent_id,mode,sequence DESC);

-- Freeze the PostgreSQL 17 time-zone catalog available when this unreleased authority is
-- installed. The guarded import checks the same catalog, and the foreign key below prevents
-- migration-owner/direct-table writes from bypassing that validation.
CREATE TABLE public.canonical_external_communication_time_zones (
 name TEXT PRIMARY KEY CHECK(name~'^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$')
);
INSERT INTO public.canonical_external_communication_time_zones(name)
SELECT DISTINCT name FROM pg_catalog.pg_timezone_names
WHERE name~'^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$';

CREATE TABLE public.canonical_external_communication_import_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id), source_key TEXT NOT NULL,
 external_record_id TEXT NOT NULL CHECK(external_record_id~'^ref_[0-9a-f]{64}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),
 previous_id UUID, consent_id UUID NOT NULL, external_version BIGINT NOT NULL CHECK(external_version BETWEEN 1 AND 1000000000), state TEXT NOT NULL CHECK(state IN ('active','tombstone')),
 record_type TEXT, customer_reference TEXT, lead_reference TEXT, job_reference TEXT, appointment_reference TEXT,
 estimate_reference TEXT, project_reference TEXT, communication_reference TEXT, channel TEXT, direction TEXT,
 intent_claim JSONB, delivery_state TEXT, satisfaction_claim JSONB, occurred_at TIMESTAMPTZ, time_zone TEXT,
 evidence_class TEXT, provider_evidence_digest TEXT, source_updated_at TIMESTAMPTZ NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'), import_run_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_key,consent_id,external_record_id,revision), UNIQUE(organization_id,source_key,consent_id,external_record_id,external_version),
 UNIQUE(organization_id,source_key,id), UNIQUE(organization_id,source_key,consent_id,id),
 FOREIGN KEY(organization_id,source_key,consent_id,previous_id) REFERENCES public.canonical_external_communication_import_records(organization_id,source_key,consent_id,id),
 FOREIGN KEY(organization_id,source_key,consent_id) REFERENCES public.canonical_external_communication_import_consents(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,consent_id,import_run_id) REFERENCES public.canonical_external_communication_import_runs(organization_id,source_key,consent_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(time_zone) REFERENCES public.canonical_external_communication_time_zones(name),
 CHECK((state='tombstone' AND record_type IS NULL AND customer_reference IS NULL AND lead_reference IS NULL
  AND job_reference IS NULL AND appointment_reference IS NULL AND estimate_reference IS NULL AND project_reference IS NULL
  AND communication_reference IS NULL AND channel IS NULL AND direction IS NULL AND intent_claim IS NULL
  AND delivery_state IS NULL AND satisfaction_claim IS NULL AND occurred_at IS NULL AND time_zone IS NULL
  AND evidence_class IS NULL AND provider_evidence_digest IS NULL)
 OR (state='active' AND record_type IN ('communication','delivery','satisfaction')
  AND communication_reference IS NOT NULL AND occurred_at IS NOT NULL AND source_updated_at>=occurred_at AND time_zone IS NOT NULL
  AND evidence_class IN ('provider_recorded','documented','owner_confirmed')
  AND provider_evidence_digest~'^[0-9a-f]{64}$')),
 CHECK((customer_reference IS NULL OR customer_reference~'^ref_[0-9a-f]{64}$')
  AND (lead_reference IS NULL OR lead_reference~'^ref_[0-9a-f]{64}$')
  AND (job_reference IS NULL OR job_reference~'^ref_[0-9a-f]{64}$')
  AND (appointment_reference IS NULL OR appointment_reference~'^ref_[0-9a-f]{64}$')
  AND (estimate_reference IS NULL OR estimate_reference~'^ref_[0-9a-f]{64}$')
  AND (project_reference IS NULL OR project_reference~'^ref_[0-9a-f]{64}$')
  AND (communication_reference IS NULL OR communication_reference~'^ref_[0-9a-f]{64}$')),
 CHECK(state='tombstone' OR
  (record_type='communication' AND channel IN ('phone','sms','email','chat','portal','other','unknown')
   AND direction IN ('inbound','outbound','internal','unknown') AND intent_claim IS NOT NULL
   AND delivery_state IS NULL AND satisfaction_claim IS NULL) OR
  (record_type='delivery' AND channel IS NULL AND direction IS NULL AND intent_claim IS NULL
   AND delivery_state IN ('queued','sent','delivered','failed','bounced','read','unknown') AND satisfaction_claim IS NULL) OR
  (record_type='satisfaction' AND channel IS NULL AND direction IS NULL AND intent_claim IS NULL
   AND delivery_state IS NULL AND satisfaction_claim IS NOT NULL)),
 CHECK(intent_claim IS NULL OR (jsonb_typeof(intent_claim)='object'
  AND intent_claim?&ARRAY['status','value','basis'] AND intent_claim-ARRAY['status','value','basis']='{}'::jsonb
  AND jsonb_typeof(intent_claim->'status')='string' AND (
   (intent_claim->>'status'='unavailable' AND intent_claim->'value'='null'::jsonb AND intent_claim->'basis'='null'::jsonb) OR
   (intent_claim->>'status'='recorded' AND jsonb_typeof(intent_claim->'value')='string'
    AND intent_claim->>'value' IN ('request_estimate','schedule','reschedule','cancel','question','status_request','complaint','compliment','other','unknown')
    AND jsonb_typeof(intent_claim->'basis')='string'
    AND intent_claim->>'basis' IN ('customer_explicit','human_reviewed','provider_classified'))))),
 CHECK(satisfaction_claim IS NULL OR (jsonb_typeof(satisfaction_claim)='object'
  AND satisfaction_claim?&ARRAY['status','value','basis'] AND satisfaction_claim-ARRAY['status','value','basis']='{}'::jsonb
  AND jsonb_typeof(satisfaction_claim->'status')='string' AND (
   (satisfaction_claim->>'status'='unavailable' AND satisfaction_claim->'value'='null'::jsonb AND satisfaction_claim->'basis'='null'::jsonb) OR
   (satisfaction_claim->>'status'='recorded' AND jsonb_typeof(satisfaction_claim->'value')='string'
    AND satisfaction_claim->>'value' IN ('satisfied','neutral','dissatisfied','unknown')
    AND jsonb_typeof(satisfaction_claim->'basis')='string'
    AND satisfaction_claim->>'basis' IN ('explicit_customer_feedback','human_reviewed_explicit_feedback')))))
);

CREATE FUNCTION public.canonical_external_communication_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Communication evidence history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_external_communication_consent_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_communication_import_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_communication_immutable();
CREATE TRIGGER canonical_external_communication_run_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_communication_import_runs FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_communication_immutable();
CREATE TRIGGER canonical_external_communication_record_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_communication_import_records FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_communication_immutable();
CREATE TRIGGER canonical_external_communication_time_zone_immutable BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_communication_time_zones FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_communication_immutable();

CREATE FUNCTION public.canonical_external_communication_consent_projection(v public.canonical_external_communication_import_consents) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',v.id,'sourceKey',v.source_key,'revision',v.revision,'previousId',v.previous_id,'action',v.action,'sourceScope',v.source_scope,'consentVersion',v.consent_version,'reason',v.reason,'digest',rtrim(v.canonical_digest),'createdAt',v.created_at) $$;
CREATE FUNCTION public.canonical_external_communication_run_projection(v public.canonical_external_communication_import_runs) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',v.id,'sourceKey',v.source_key,'mode',v.mode,'sequence',v.sequence,'previousRunId',v.previous_run_id,'consentId',v.consent_id,'consentRevision',v.consent_revision,'consentDigest',rtrim(v.consent_digest),'schemaVersion',v.schema_version,'cursorBefore',v.cursor_before,'cursorAfter',v.cursor_after,'complete',v.complete,'recordCount',v.record_count,'insertedCount',v.inserted_count,'correctedCount',v.corrected_count,'duplicateCount',v.duplicate_count,'tombstonedCount',v.tombstoned_count,'digest',rtrim(v.canonical_digest),'createdAt',v.created_at) $$;
CREATE FUNCTION public.canonical_external_communication_record_projection(v public.canonical_external_communication_import_records) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',v.id,'externalRecordId',v.external_record_id,'revision',v.revision,'previousId',v.previous_id,'consentId',v.consent_id,
  'externalVersion',v.external_version,'state',v.state,'recordType',v.record_type,'customerReference',v.customer_reference,
  'leadReference',v.lead_reference,'jobReference',v.job_reference,'appointmentReference',v.appointment_reference,
  'estimateReference',v.estimate_reference,'projectReference',v.project_reference,'communicationReference',v.communication_reference,
  'channel',v.channel,'direction',v.direction,'intentClaim',v.intent_claim,'deliveryState',v.delivery_state,
  'satisfactionClaim',v.satisfaction_claim,'occurredAt',v.occurred_at,
  'timeZone',v.time_zone,'evidenceClass',v.evidence_class,'reconciliationStatus',CASE WHEN v.state='active' THEN 'unmatched' ELSE 'unavailable' END,
  'providerEvidenceDigest',v.provider_evidence_digest,'sourceUpdatedAt',v.source_updated_at,'sourceDigest',rtrim(v.source_digest),
  'importRunId',v.import_run_id,'createdAt',v.created_at) $$;

CREATE FUNCTION public.canonical_external_communication_import_consent_read(org UUID,actor UUID,role_value TEXT,session_value UUID,source_value TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_external_communication_import_consents%ROWTYPE; history JSONB; total BIGINT;
BEGIN IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External communication evidence restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External communication source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value;
 SELECT COALESCE(jsonb_agg(public.canonical_external_communication_consent_projection(x) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM (SELECT * FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 20)x;
 RETURN jsonb_build_object('sourceKey',source_value,'current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_external_communication_consent_projection(current_row) END,'history',history,'total',total,'truncated',total>20); END $$;

CREATE FUNCTION public.canonical_external_communication_import_consent_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_external_communication_import_consents%ROWTYPE; replay public.canonical_external_communication_import_consents%ROWTYPE; inserted public.canonical_external_communication_import_consents%ROWTYPE; key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT;
BEGIN IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External communication evidence restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR body->>'action' IS NULL OR body->>'action' NOT IN ('grant','revoke')
  OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$' OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none'))
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(body->'confirmationVersion') IS DISTINCT FROM 'string' OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-communication-import-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE THEN RAISE EXCEPTION 'External communication consent invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-communication-import:'||source_value,0));
 SELECT * INTO replay FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Communication consent key conflict' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object('consent',public.canonical_external_communication_consent_projection(replay),'replayed',TRUE); END IF;
 SELECT * INTO current_row FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN RAISE EXCEPTION 'Communication consent changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') OR body->>'action'='grant' AND current_row.action='grant' THEN RAISE EXCEPTION 'Communication consent action invalid' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'revision',next_revision,'previousId',current_row.id,'action',body->>'action','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope','["external_communication_normalized_v1"]'::jsonb,'consentVersion','m25-external-communication-import-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_communication_import_consents(organization_id,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,'["external_communication_normalized_v1"]'::jsonb,'m25-external-communication-import-consent-v1',body->>'reason',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_external_communication_consent_projection(inserted),'replayed',FALSE); END $$;

CREATE FUNCTION public.canonical_external_communication_import_batch(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_external_communication_import_consents%ROWTYPE; previous_run public.canonical_external_communication_import_runs%ROWTYPE; replay public.canonical_external_communication_import_runs%ROWTYPE; inserted_run public.canonical_external_communication_import_runs%ROWTYPE; existing public.canonical_external_communication_import_records%ROWTYPE; current_row public.canonical_external_communication_import_records%ROWTYPE;
 item JSONB; key_hash TEXT; request_hash TEXT; source_hash TEXT; run_hash TEXT; run_id UUID:=gen_random_uuid(); next_sequence BIGINT; next_revision BIGINT; record_count INTEGER; inserted_count INTEGER:=0; corrected_count INTEGER:=0; duplicate_count INTEGER:=0; tombstoned_count INTEGER:=0; occurred TIMESTAMPTZ; updated TIMESTAMPTZ; state_value TEXT; external_id TEXT; external_version_value BIGINT;
BEGIN IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External communication evidence restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>524288
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore','cursorAfter','complete','records','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR jsonb_typeof(body->'schemaVersion') IS DISTINCT FROM 'string' OR body->>'schemaVersion' IS DISTINCT FROM 'm25-external-communication-evidence-v1'
  OR jsonb_typeof(body->'mode') IS DISTINCT FROM 'string' OR body->>'mode' IS NULL OR body->>'mode' NOT IN ('historical_backfill','continuous_update')
  OR jsonb_typeof(body->'expectedConsentRevision') IS DISTINCT FROM 'number' OR (body->>'expectedConsentRevision')!~'^([1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedConsentDigest') IS DISTINCT FROM 'string' OR body->>'expectedConsentDigest'!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(body->'complete') IS DISTINCT FROM 'boolean' OR jsonb_typeof(body->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'records') NOT BETWEEN 1 AND 100 OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(body->'confirmationVersion') IS DISTINCT FROM 'string' OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-communication-import-batch-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
  OR (body->'cursorBefore'<>'null'::jsonb AND (jsonb_typeof(body->'cursorBefore')<>'string' OR body->>'cursorBefore'!~'^cur_[0-9a-f]{64}$'))
  OR (body->'cursorAfter'<>'null'::jsonb AND (jsonb_typeof(body->'cursorAfter')<>'string' OR body->>'cursorAfter'!~'^cur_[0-9a-f]{64}$'))
  OR (body->>'mode'='continuous_update' AND ((body->>'complete')::boolean OR body->'cursorAfter'='null'::jsonb))
  OR (body->>'mode'='historical_backfill' AND (((body->>'complete')::boolean AND body->'cursorAfter'<>'null'::jsonb) OR (NOT (body->>'complete')::boolean AND body->'cursorAfter'='null'::jsonb))) THEN RAISE EXCEPTION 'External communication batch invalid' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM (SELECT x->>'externalRecordId' FROM jsonb_array_elements(body->'records')x GROUP BY x->>'externalRecordId')u)<>jsonb_array_length(body->'records') THEN RAISE EXCEPTION 'Duplicate communication identity' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-communication-import:'||source_value,0));
 SELECT * INTO replay FROM public.canonical_external_communication_import_runs WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Communication batch key conflict' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object('run',public.canonical_external_communication_run_projection(replay),'replayed',TRUE); END IF;
 SELECT * INTO consent_row FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF consent_row.id IS NULL OR consent_row.action IS DISTINCT FROM 'grant' OR consent_row.revision IS DISTINCT FROM (body->>'expectedConsentRevision')::bigint OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM body->>'expectedConsentDigest' THEN RAISE EXCEPTION 'Communication consent changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(
  SELECT 1 FROM (
   SELECT DISTINCT item_value->>'timeZone' AS name
   FROM jsonb_array_elements(body->'records') AS record(item_value)
   WHERE item_value->>'state'='active'
  ) requested_zone
  LEFT JOIN pg_catalog.pg_timezone_names known_zone ON known_zone.name=requested_zone.name
  WHERE requested_zone.name IS NULL OR known_zone.name IS NULL
 ) THEN RAISE EXCEPTION 'External communication time zone invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous_run FROM public.canonical_external_communication_import_runs WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id AND mode=body->>'mode' ORDER BY sequence DESC LIMIT 1 FOR UPDATE;
 IF previous_run.id IS NULL AND body->'cursorBefore'<>'null'::jsonb OR previous_run.id IS NOT NULL AND previous_run.cursor_after IS DISTINCT FROM body->>'cursorBefore' THEN RAISE EXCEPTION 'Communication cursor changed' USING ERRCODE='40001'; END IF;
 IF previous_run.mode='historical_backfill' AND previous_run.complete THEN RAISE EXCEPTION 'Communication backfill complete' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.canonical_external_communication_import_runs WHERE organization_id=org AND source_key=source_value AND mode=body->>'mode';record_count:=jsonb_array_length(body->'records');
 FOR item IN SELECT value FROM jsonb_array_elements(body->'records') LOOP
  IF public.canonical_field_evidence_object_keys_exact(item,ARRAY['externalRecordId','externalVersion','state','recordType','customerReference','leadReference','jobReference','appointmentReference','estimateReference','projectReference','communicationReference','channel','direction','intentClaim','deliveryState','satisfactionClaim','occurredAt','timeZone','evidenceClass','providerEvidenceDigest','sourceUpdatedAt']) IS NOT TRUE
   OR jsonb_typeof(item->'externalRecordId') IS DISTINCT FROM 'string' OR item->>'externalRecordId'!~'^ref_[0-9a-f]{64}$'
   OR jsonb_typeof(item->'externalVersion') IS DISTINCT FROM 'number' OR (item->>'externalVersion')!~'^([1-9][0-9]{0,8}|1000000000)$'
   OR jsonb_typeof(item->'state') IS DISTINCT FROM 'string' OR item->>'state' IS NULL OR item->>'state' NOT IN ('active','tombstone')
   OR jsonb_typeof(item->'sourceUpdatedAt') IS DISTINCT FROM 'string' OR item->>'sourceUpdatedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR NOT pg_input_is_valid(item->>'sourceUpdatedAt','timestamp with time zone') THEN RAISE EXCEPTION 'External communication record invalid' USING ERRCODE='22023'; END IF;
  external_id:=item->>'externalRecordId';external_version_value:=(item->>'externalVersion')::bigint;state_value:=item->>'state';updated:=(item->>'sourceUpdatedAt')::timestamptz;
  IF updated>clock_timestamp()+INTERVAL '5 minutes' THEN RAISE EXCEPTION 'Communication source time invalid' USING ERRCODE='22023'; END IF;
  IF state_value='tombstone' THEN
   IF EXISTS(SELECT 1 FROM jsonb_each(item) p WHERE p.key NOT IN ('externalRecordId','externalVersion','state','sourceUpdatedAt') AND p.value<>'null'::jsonb) THEN RAISE EXCEPTION 'Communication tombstone retained details' USING ERRCODE='22023'; END IF; occurred:=NULL;
  ELSE
   IF jsonb_typeof(item->'recordType') IS DISTINCT FROM 'string' OR item->>'recordType' NOT IN ('communication','delivery','satisfaction')
    OR EXISTS(SELECT 1 FROM jsonb_each(item) p WHERE p.key IN ('customerReference','leadReference','jobReference','appointmentReference','estimateReference','projectReference','communicationReference') AND NOT(p.value='null'::jsonb OR (jsonb_typeof(p.value)='string' AND (p.value#>>'{}')~'^ref_[0-9a-f]{64}$')))
    OR item->'communicationReference'='null'::jsonb
    OR item->>'occurredAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR NOT pg_input_is_valid(item->>'occurredAt','timestamp with time zone')
    OR jsonb_typeof(item->'timeZone') IS DISTINCT FROM 'string' OR item->>'timeZone'!~'^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'
    OR jsonb_typeof(item->'evidenceClass') IS DISTINCT FROM 'string' OR item->>'evidenceClass' NOT IN ('provider_recorded','documented','owner_confirmed')
    OR jsonb_typeof(item->'providerEvidenceDigest') IS DISTINCT FROM 'string' OR item->>'providerEvidenceDigest'!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'External communication record invalid' USING ERRCODE='22023'; END IF;
   occurred:=(item->>'occurredAt')::timestamptz;
   IF occurred>updated THEN RAISE EXCEPTION 'Communication event time invalid' USING ERRCODE='22023'; END IF;
   IF item->>'recordType'='communication' THEN
    IF jsonb_typeof(item->'channel')<>'string' OR item->>'channel' NOT IN ('phone','sms','email','chat','portal','other','unknown')
     OR jsonb_typeof(item->'direction')<>'string' OR item->>'direction' NOT IN ('inbound','outbound','internal','unknown')
     OR item->'deliveryState'<>'null'::jsonb OR item->'satisfactionClaim'<>'null'::jsonb
     OR item->'intentClaim'='null'::jsonb OR jsonb_typeof(item->'intentClaim')<>'object'
     OR public.canonical_field_evidence_object_keys_exact(item->'intentClaim',ARRAY['status','value','basis']) IS NOT TRUE
     OR jsonb_typeof(item->'intentClaim'->'status')<>'string' OR item->'intentClaim'->>'status' NOT IN ('recorded','unavailable')
     OR (item->'intentClaim'->>'status'='unavailable' AND (item->'intentClaim'->'value'<>'null'::jsonb OR item->'intentClaim'->'basis'<>'null'::jsonb))
     OR (item->'intentClaim'->>'status'='recorded' AND (jsonb_typeof(item->'intentClaim'->'value')<>'string'
      OR item->'intentClaim'->>'value' NOT IN ('request_estimate','schedule','reschedule','cancel','question','status_request','complaint','compliment','other','unknown')
      OR jsonb_typeof(item->'intentClaim'->'basis')<>'string' OR item->'intentClaim'->>'basis' NOT IN ('customer_explicit','human_reviewed','provider_classified'))) THEN RAISE EXCEPTION 'Communication intent evidence invalid' USING ERRCODE='22023'; END IF;
   ELSIF item->>'recordType'='delivery' THEN
    IF item->'channel'<>'null'::jsonb OR item->'direction'<>'null'::jsonb OR item->'intentClaim'<>'null'::jsonb
     OR jsonb_typeof(item->'deliveryState')<>'string' OR item->>'deliveryState' NOT IN ('queued','sent','delivered','failed','bounced','read','unknown') OR item->'satisfactionClaim'<>'null'::jsonb THEN RAISE EXCEPTION 'Communication delivery evidence invalid' USING ERRCODE='22023'; END IF;
   ELSE
    IF item->'channel'<>'null'::jsonb OR item->'direction'<>'null'::jsonb OR item->'intentClaim'<>'null'::jsonb OR item->'deliveryState'<>'null'::jsonb
     OR item->'satisfactionClaim'='null'::jsonb OR jsonb_typeof(item->'satisfactionClaim')<>'object'
     OR public.canonical_field_evidence_object_keys_exact(item->'satisfactionClaim',ARRAY['status','value','basis']) IS NOT TRUE
     OR jsonb_typeof(item->'satisfactionClaim'->'status')<>'string' OR item->'satisfactionClaim'->>'status' NOT IN ('recorded','unavailable')
     OR (item->'satisfactionClaim'->>'status'='unavailable' AND (item->'satisfactionClaim'->'value'<>'null'::jsonb OR item->'satisfactionClaim'->'basis'<>'null'::jsonb))
     OR (item->'satisfactionClaim'->>'status'='recorded' AND (jsonb_typeof(item->'satisfactionClaim'->'value')<>'string'
      OR item->'satisfactionClaim'->>'value' NOT IN ('satisfied','neutral','dissatisfied','unknown')
      OR jsonb_typeof(item->'satisfactionClaim'->'basis')<>'string' OR item->'satisfactionClaim'->>'basis' NOT IN ('explicit_customer_feedback','human_reviewed_explicit_feedback'))) THEN RAISE EXCEPTION 'Customer satisfaction evidence invalid' USING ERRCODE='22023'; END IF;
   END IF;
  END IF;
  source_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'consentId',consent_row.id,'externalRecordId',external_id,'externalVersion',external_version_value,'state',state_value,'payload',item));
  SELECT * INTO existing FROM public.canonical_external_communication_import_records WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id AND external_record_id=external_id AND external_version=external_version_value;
  IF FOUND THEN IF rtrim(existing.source_digest)<>source_hash THEN RAISE EXCEPTION 'Communication record conflict' USING ERRCODE='40001',CONSTRAINT='communication_import_record_conflict'; END IF; duplicate_count:=duplicate_count+1;CONTINUE; END IF;
  SELECT * INTO current_row FROM public.canonical_external_communication_import_records WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id AND external_record_id=external_id ORDER BY revision DESC LIMIT 1 FOR UPDATE;
  IF current_row.id IS NOT NULL AND external_version_value<=current_row.external_version THEN RAISE EXCEPTION 'Communication record version conflict' USING ERRCODE='40001',CONSTRAINT='communication_import_record_conflict'; END IF;
  next_revision:=COALESCE(current_row.revision,0)+1;
  INSERT INTO public.canonical_external_communication_import_records(organization_id,source_key,external_record_id,revision,previous_id,consent_id,external_version,state,record_type,customer_reference,lead_reference,job_reference,appointment_reference,estimate_reference,project_reference,communication_reference,channel,direction,intent_claim,delivery_state,satisfaction_claim,occurred_at,time_zone,evidence_class,provider_evidence_digest,source_updated_at,source_digest,import_run_id)
  VALUES(org,source_value,external_id,next_revision,current_row.id,consent_row.id,external_version_value,state_value,CASE WHEN state_value='active' THEN item->>'recordType' END,CASE WHEN state_value='active' THEN item->>'customerReference' END,CASE WHEN state_value='active' THEN item->>'leadReference' END,CASE WHEN state_value='active' THEN item->>'jobReference' END,CASE WHEN state_value='active' THEN item->>'appointmentReference' END,CASE WHEN state_value='active' THEN item->>'estimateReference' END,CASE WHEN state_value='active' THEN item->>'projectReference' END,CASE WHEN state_value='active' THEN item->>'communicationReference' END,CASE WHEN state_value='active' THEN item->>'channel' END,CASE WHEN state_value='active' THEN item->>'direction' END,CASE WHEN state_value='active' AND item->'intentClaim'<>'null'::jsonb THEN item->'intentClaim' END,CASE WHEN state_value='active' THEN item->>'deliveryState' END,CASE WHEN state_value='active' AND item->'satisfactionClaim'<>'null'::jsonb THEN item->'satisfactionClaim' END,occurred,CASE WHEN state_value='active' THEN item->>'timeZone' END,CASE WHEN state_value='active' THEN item->>'evidenceClass' END,CASE WHEN state_value='active' THEN item->>'providerEvidenceDigest' END,updated,source_hash,run_id);
  IF state_value='tombstone' THEN tombstoned_count:=tombstoned_count+1; ELSIF current_row.id IS NULL THEN inserted_count:=inserted_count+1; ELSE corrected_count:=corrected_count+1; END IF;
 END LOOP;
 run_hash:=public.canonical_completion_digest(jsonb_build_object('id',run_id,'organizationId',org,'sourceKey',source_value,'mode',body->>'mode','sequence',next_sequence,'previousRunId',previous_run.id,'consentId',consent_row.id,'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),'schemaVersion','m25-external-communication-evidence-v1','cursorBefore',body->>'cursorBefore','cursorAfter',body->>'cursorAfter','complete',(body->>'complete')::boolean,'recordCount',record_count,'insertedCount',inserted_count,'correctedCount',corrected_count,'duplicateCount',duplicate_count,'tombstonedCount',tombstoned_count,'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_communication_import_runs(id,organization_id,source_key,mode,sequence,previous_run_id,consent_id,consent_revision,consent_digest,schema_version,cursor_before,cursor_after,complete,record_count,inserted_count,corrected_count,duplicate_count,tombstoned_count,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(run_id,org,source_value,body->>'mode',next_sequence,previous_run.id,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),'m25-external-communication-evidence-v1',body->>'cursorBefore',body->>'cursorAfter',(body->>'complete')::boolean,record_count,inserted_count,corrected_count,duplicate_count,tombstoned_count,actor,(authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,'m25-external-communication-import-batch-v1',key_hash,request_hash,run_hash) RETURNING * INTO inserted_run;
 RETURN jsonb_build_object('run',public.canonical_external_communication_run_projection(inserted_run),'replayed',FALSE); END $$;

CREATE FUNCTION public.canonical_external_communication_import_read(org UUID,actor UUID,role_value TEXT,session_value UUID,source_value TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_communication_import_consents%ROWTYPE;runs JSONB;records JSONB;run_total BIGINT;record_total BIGINT;latest_source TIMESTAMPTZ;
BEGIN IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External communication evidence restricted' USING ERRCODE='42501'; END IF;PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External communication source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO consent_row FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF consent_row.id IS NULL OR consent_row.action<>'grant' THEN RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',FALSE,'runs','[]'::jsonb,'runTotal',0,'runsTruncated',FALSE,'currentRecords','[]'::jsonb,'recordTotal',0,'recordsTruncated',FALSE,'latestSourceUpdatedAt',NULL,'consumptionBoundary','No external communication evidence is available while source permission is inactive.'); END IF;
 SELECT count(*) INTO run_total FROM public.canonical_external_communication_import_runs WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id;
 SELECT COALESCE(jsonb_agg(public.canonical_external_communication_run_projection(x) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO runs FROM (SELECT * FROM public.canonical_external_communication_import_runs WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id ORDER BY created_at DESC,id DESC LIMIT 20)x;
 WITH current_records AS(SELECT DISTINCT ON(r.external_record_id) r.* FROM public.canonical_external_communication_import_records r JOIN public.canonical_external_communication_import_runs run ON run.organization_id=r.organization_id AND run.source_key=r.source_key AND run.id=r.import_run_id WHERE r.organization_id=org AND r.source_key=source_value AND run.consent_id=consent_row.id ORDER BY r.external_record_id,r.revision DESC) SELECT count(*),max(source_updated_at) INTO record_total,latest_source FROM current_records;
 WITH current_records AS(SELECT DISTINCT ON(r.external_record_id) r.* FROM public.canonical_external_communication_import_records r JOIN public.canonical_external_communication_import_runs run ON run.organization_id=r.organization_id AND run.source_key=r.source_key AND run.id=r.import_run_id WHERE r.organization_id=org AND r.source_key=source_value AND run.consent_id=consent_row.id ORDER BY r.external_record_id,r.revision DESC),selected AS(SELECT * FROM current_records ORDER BY external_record_id LIMIT 100) SELECT COALESCE(jsonb_agg(public.canonical_external_communication_record_projection(x) ORDER BY external_record_id),'[]'::jsonb) INTO records FROM selected x;
 RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,'consent',public.canonical_external_communication_consent_projection(consent_row),'runs',runs,'runTotal',run_total,'runsTruncated',run_total>20,'currentRecords',records,'recordTotal',record_total,'recordsTruncated',record_total>100,'latestSourceUpdatedAt',latest_source,'consumptionBoundary','Staged communication evidence cannot change customers, leads, jobs, appointments, estimates, dispatch, schedules, invoices, payments, provider records or company policy. Every record remains unmatched until it is separately reviewed.'); END $$;

REVOKE ALL ON TABLE public.canonical_external_communication_import_consents,public.canonical_external_communication_import_runs,public.canonical_external_communication_import_records,public.canonical_external_communication_time_zones FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_consent_projection(public.canonical_external_communication_import_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_run_projection(public.canonical_external_communication_import_runs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_record_projection(public.canonical_external_communication_import_records) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_import_consent_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_import_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_import_batch(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_communication_import_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
