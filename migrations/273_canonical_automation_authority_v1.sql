-- Mission 28 Part 2D: tenant-private PostgreSQL authority for the released
-- Part 2A policy, Part 2B immutable records and Part 2C lifecycle contracts.
-- This migration mounts no route, scheduler, worker, provider or effect.  All
-- application-role storage entry points remain revoked pending Part 3+
-- capability and approval authority.

CREATE FUNCTION public.canonical_automation_json_shape_v1(value JSONB, depth INTEGER DEFAULT 0)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind TEXT; member JSONB; pair RECORD; item_count INTEGER;
BEGIN
 IF depth>24 THEN RETURN FALSE; END IF;
 kind:=jsonb_typeof(value);
 IF kind IN('null','boolean') THEN RETURN TRUE;
 ELSIF kind='string' THEN RETURN octet_length(value#>>'{}')<=8192;
 ELSIF kind='number' THEN
  RETURN value::text~'^-?(0|[1-9][0-9]*)$'
   AND value::numeric BETWEEN -9007199254740991 AND 9007199254740991;
 ELSIF kind='array' THEN
  item_count:=jsonb_array_length(value);
  IF item_count>256 THEN RETURN FALSE; END IF;
  FOR member IN SELECT element FROM jsonb_array_elements(value) values(element) LOOP
   IF NOT public.canonical_automation_json_shape_v1(member,depth+1) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
 ELSIF kind='object' THEN
  SELECT count(*) INTO item_count FROM jsonb_each(value);
  IF item_count>128 THEN RETURN FALSE; END IF;
  FOR pair IN SELECT entry_key,entry_value FROM jsonb_each(value) entry(entry_key,entry_value) LOOP
   IF octet_length(pair.entry_key)>128 OR
      NOT public.canonical_automation_json_shape_v1(pair.entry_value,depth+1) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
 END IF;
 RETURN FALSE;
END $$;

CREATE FUNCTION public.canonical_automation_json_nodes_v1(value JSONB, depth INTEGER DEFAULT 0)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind TEXT; member JSONB; nodes INTEGER:=1; child_nodes INTEGER;
BEGIN
 IF depth>24 THEN RETURN 2049; END IF;
 kind:=jsonb_typeof(value);
 IF kind IN('null','boolean','string','number') THEN RETURN 1; END IF;
 IF kind NOT IN('array','object') THEN RETURN 2049; END IF;
 FOR member IN
  SELECT element FROM jsonb_array_elements(CASE WHEN kind='array' THEN value ELSE '[]'::jsonb END) values(element)
  UNION ALL
  SELECT element FROM jsonb_each(CASE WHEN kind='object' THEN value ELSE '{}'::jsonb END) values(key,element)
 LOOP
  child_nodes:=public.canonical_automation_json_nodes_v1(member,depth+1);
  nodes:=nodes+child_nodes;
  IF nodes>2048 THEN RETURN 2049; END IF;
 END LOOP;
 RETURN nodes;
END $$;

CREATE FUNCTION public.canonical_automation_json_v1(value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind TEXT; result TEXT;
BEGIN
 IF NOT public.canonical_automation_json_shape_v1(value,0) THEN
  RAISE EXCEPTION 'Mission 28 canonical JSON shape invalid' USING ERRCODE='22023';
 END IF;
 kind:=jsonb_typeof(value);
 IF kind IN('null','boolean','number','string') THEN RETURN value::text;
 ELSIF kind='array' THEN
  SELECT '['||COALESCE(string_agg(public.canonical_automation_json_v1(item),',' ORDER BY ordinal),'')||']'
   INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entries(item,ordinal);
  RETURN result;
 ELSIF kind='object' THEN
  SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||public.canonical_automation_json_v1(member),
   ',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) entries(key,member);
  RETURN result;
 END IF;
 RAISE EXCEPTION 'Mission 28 canonical JSON type invalid' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.canonical_automation_document_v1(canonical_text TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;
BEGIN
 IF octet_length(canonical_text) NOT BETWEEN 2 AND 65536 THEN
  RAISE EXCEPTION 'Mission 28 canonical document size invalid' USING ERRCODE='22023'; END IF;
 BEGIN value:=canonical_text::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Mission 28 canonical document syntax invalid' USING ERRCODE='22023'; END;
 IF jsonb_typeof(value)<>'object' OR NOT public.canonical_automation_json_shape_v1(value,0) OR
    public.canonical_automation_json_nodes_v1(value,0)>2048 OR
    public.canonical_automation_json_v1(value)<>canonical_text THEN
  RAISE EXCEPTION 'Mission 28 canonical document is not exact' USING ERRCODE='22023'; END IF;
 RETURN value;
END $$;

CREATE FUNCTION public.canonical_automation_digest_v1(namespace_value TEXT,value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF namespace_value IS NULL OR right(namespace_value,1)<>chr(10) OR octet_length(namespace_value)>128 THEN
  RAISE EXCEPTION 'Mission 28 canonical namespace invalid' USING ERRCODE='22023'; END IF;
 RETURN 'sha256:'||encode(sha256(convert_to(namespace_value||public.canonical_automation_json_v1(value),'UTF8')),'hex');
END $$;

CREATE FUNCTION public.canonical_automation_utc_v1(value TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

CREATE FUNCTION public.canonical_automation_clock_v1()
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE
SET search_path=pg_catalog,public,pg_temp AS $$ SELECT statement_timestamp() $$;

CREATE TABLE public.canonical_automation_retention_classes_v1 (
 retention_class TEXT PRIMARY KEY CHECK(retention_class IN(
  'policy_history','lifecycle_history','decision_history','effect_evidence_history',
  'source_snapshot_history','historical_run_binding','legacy_conversion_review')),
 disposition TEXT NOT NULL CHECK(disposition='retain_no_automatic_deletion_pending_review'),
 minimum_retention INTERVAL NULL,
 deletion_authority_available BOOLEAN NOT NULL CHECK(deletion_authority_available=FALSE),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT statement_timestamp(),
 CHECK(minimum_retention IS NULL)
);
INSERT INTO public.canonical_automation_retention_classes_v1(retention_class,disposition,deletion_authority_available)
VALUES ('policy_history','retain_no_automatic_deletion_pending_review',FALSE),
 ('lifecycle_history','retain_no_automatic_deletion_pending_review',FALSE),
 ('decision_history','retain_no_automatic_deletion_pending_review',FALSE),
 ('effect_evidence_history','retain_no_automatic_deletion_pending_review',FALSE),
 ('source_snapshot_history','retain_no_automatic_deletion_pending_review',FALSE),
 ('historical_run_binding','retain_no_automatic_deletion_pending_review',FALSE),
 ('legacy_conversion_review','retain_no_automatic_deletion_pending_review',FALSE);

CREATE TABLE public.canonical_automation_policy_versions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 policy_id UUID NOT NULL,
 version BIGINT NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 previous_version_digest TEXT NULL CHECK(previous_version_digest IS NULL OR previous_version_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 expires_at TIMESTAMPTZ(6) NOT NULL,
 source_origin TEXT NOT NULL CHECK(source_origin='mission28_native'),
 conversion_review_id UUID NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,policy_id,version),
 UNIQUE(organization_id,policy_id,canonical_digest),
 CHECK(retention_class='policy_history'),
 CHECK(conversion_review_id IS NULL),
 CHECK(document->>'tenantId'=organization_id::text),
 CHECK(document->>'policyId'=policy_id::text),
 CHECK((document->>'version')::bigint=version),
 CHECK(document->>'canonicalDigest'=canonical_digest),
 CHECK(document->>'previousVersionDigest' IS NOT DISTINCT FROM previous_version_digest)
);

CREATE TABLE public.canonical_automation_source_bindings_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_class_id TEXT NOT NULL,
 owner_mission TEXT NOT NULL,
 source_record_id UUID NOT NULL,
 source_version BIGINT NOT NULL CHECK(source_version BETWEEN 1 AND 9007199254740991),
 source_digest TEXT NOT NULL CHECK(source_digest~'^sha256:[0-9a-f]{64}$'),
 currentness_marker TEXT NOT NULL CHECK(currentness_marker IN(
  'captured_exact_current','captured_stale','captured_unavailable','contract_fixture_unverified')),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,source_class_id,source_record_id,source_version),
 UNIQUE(organization_id,source_class_id,source_record_id,source_digest),
 CHECK(retention_class='source_snapshot_history'),
 CHECK(document->>'tenantId'=organization_id::text),
 CHECK(document->>'sourceClassId'=source_class_id),
 CHECK(document->>'ownerMission'=owner_mission),
 CHECK(document->>'sourceRecordId'=source_record_id::text),
 CHECK((document->>'sourceVersion')::bigint=source_version),
 CHECK(document->>'sourceDigest'=source_digest),
 CHECK(document->>'currentnessMarker'=currentness_marker)
);

CREATE TABLE public.canonical_automation_source_sets_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 currentness_marker TEXT NOT NULL CHECK(currentness_marker IN(
  'exact_current_not_runtime_revalidated','stale_fail_closed','unavailable_fail_closed','contract_fixture_unverified')),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,source_set_digest),
 CHECK(retention_class='source_snapshot_history'),
 CHECK(document->>'tenantId'=organization_id::text),
 CHECK(document->>'sourceSetDigest'=source_set_digest),
 CHECK(document->>'currentnessMarker'=currentness_marker)
);

CREATE TABLE public.canonical_automation_lifecycle_events_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 lifecycle_event_id UUID NOT NULL,
 policy_id UUID NOT NULL,
 policy_version BIGINT NOT NULL,
 lifecycle_sequence BIGINT NOT NULL CHECK(lifecycle_sequence BETWEEN 1 AND 9007199254740991),
 operation TEXT NOT NULL CHECK(operation IN('draft_create','validate','preview','activate','pause','resume',
  'supersede','expire','retire','emergency_stop','bounded_rollback_draft')),
 from_state TEXT NULL,
 to_state TEXT NOT NULL CHECK(to_state IN('draft','validated','previewed','active','paused','superseded',
  'expired','retired','emergency_stopped')),
 predecessor_event_id UUID NULL,
 predecessor_event_digest TEXT NULL CHECK(predecessor_event_digest IS NULL OR predecessor_event_digest~'^sha256:[0-9a-f]{64}$'),
 idempotency_digest TEXT NOT NULL CHECK(idempotency_digest~'^sha256:[0-9a-f]{64}$'),
 payload_digest TEXT NOT NULL CHECK(payload_digest~'^sha256:[0-9a-f]{64}$'),
 event_digest TEXT NOT NULL CHECK(event_digest~'^sha256:[0-9a-f]{64}$'),
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 currentness_marker TEXT NOT NULL CHECK(currentness_marker IN('exact_current_not_runtime_revalidated',
  'stale_fail_closed','unavailable_fail_closed','contract_fixture_unverified')),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,lifecycle_event_id),
 UNIQUE(organization_id,policy_id,policy_version,lifecycle_sequence),
 UNIQUE(organization_id,policy_id,policy_version,idempotency_digest),
 UNIQUE(organization_id,policy_id,policy_version,event_digest),
 FOREIGN KEY(organization_id,policy_id,policy_version)
  REFERENCES public.canonical_automation_policy_versions_v1(organization_id,policy_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,predecessor_event_id)
  REFERENCES public.canonical_automation_lifecycle_events_v1(organization_id,lifecycle_event_id) ON DELETE RESTRICT,
 CHECK(retention_class='lifecycle_history')
);

CREATE TABLE public.canonical_automation_records_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 record_id UUID NOT NULL,
 run_id UUID NOT NULL,
 record_type TEXT NOT NULL CHECK(record_type IN('eligibility_evaluation','proposed_action','approval','scheduled_run',
  'action_unit','provider_attempt','provider_acknowledgement','delivery_state','reply_opt_out','internal_task',
  'suppression','cancellation','reconciliation','terminal_outcome')),
 causal_ordinal BIGINT NOT NULL CHECK(causal_ordinal BETWEEN 1 AND 9007199254740991),
 policy_id UUID NOT NULL,
 policy_version BIGINT NOT NULL,
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 currentness_marker TEXT NOT NULL CHECK(currentness_marker IN('captured_exact_current','captured_stale',
  'captured_unavailable','captured_not_runtime_revalidated','captured_runtime_revalidation_required',
  'captured_stale_fail_closed','captured_unavailable_fail_closed','contract_fixture_unverified')),
 authority_class TEXT NOT NULL CHECK(authority_class IN('automation_decision','external_effect','effect_evidence')),
 payload_digest TEXT NOT NULL CHECK(payload_digest~'^sha256:[0-9a-f]{64}$'),
 record_digest TEXT NOT NULL CHECK(record_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,record_id),
 UNIQUE(organization_id,run_id,causal_ordinal),
 UNIQUE(organization_id,run_id,record_digest),
 FOREIGN KEY(organization_id,policy_id,policy_version)
  REFERENCES public.canonical_automation_policy_versions_v1(organization_id,policy_id,version) ON DELETE RESTRICT,
 CHECK(retention_class=CASE authority_class WHEN 'effect_evidence' THEN 'effect_evidence_history'
  ELSE 'decision_history' END)
);

CREATE TABLE public.canonical_automation_historical_run_bindings_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 run_id UUID NOT NULL,
 policy_id UUID NOT NULL,
 policy_version BIGINT NOT NULL,
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 lifecycle_event_id UUID NOT NULL,
 lifecycle_event_digest TEXT NOT NULL CHECK(lifecycle_event_digest~'^sha256:[0-9a-f]{64}$'),
 binding_digest TEXT NOT NULL CHECK(binding_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,run_id),
 UNIQUE(organization_id,binding_digest),
 FOREIGN KEY(organization_id,policy_id,policy_version)
  REFERENCES public.canonical_automation_policy_versions_v1(organization_id,policy_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,lifecycle_event_id)
  REFERENCES public.canonical_automation_lifecycle_events_v1(organization_id,lifecycle_event_id) ON DELETE RESTRICT,
 CHECK(retention_class='historical_run_binding')
);

CREATE TABLE public.canonical_automation_legacy_conversion_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 review_id UUID NOT NULL,
 legacy_source_class TEXT NOT NULL CHECK(octet_length(legacy_source_class) BETWEEN 1 AND 128),
 legacy_source_digest TEXT NOT NULL CHECK(legacy_source_digest~'^sha256:[0-9a-f]{64}$'),
 review_state TEXT NOT NULL CHECK(review_state='unavailable_pending_reviewed_conversion_slice'),
 converted_policy_id UUID NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,review_id),
 CHECK(converted_policy_id IS NULL),
 CHECK(retention_class='legacy_conversion_review')
);

CREATE INDEX canonical_automation_policy_versions_v1_latest
 ON public.canonical_automation_policy_versions_v1(organization_id,policy_id,version DESC);
CREATE INDEX canonical_automation_policy_versions_v1_expiry
 ON public.canonical_automation_policy_versions_v1(organization_id,expires_at);
CREATE INDEX canonical_automation_source_bindings_v1_currentness
 ON public.canonical_automation_source_bindings_v1(organization_id,currentness_marker,source_class_id,source_record_id);
CREATE INDEX canonical_automation_source_sets_v1_currentness
 ON public.canonical_automation_source_sets_v1(organization_id,currentness_marker,recorded_at);
CREATE INDEX canonical_automation_lifecycle_events_v1_order
 ON public.canonical_automation_lifecycle_events_v1(organization_id,policy_id,policy_version,lifecycle_sequence);
CREATE INDEX canonical_automation_lifecycle_events_v1_currentness
 ON public.canonical_automation_lifecycle_events_v1(organization_id,currentness_marker,recorded_at);
CREATE INDEX canonical_automation_records_v1_run
 ON public.canonical_automation_records_v1(organization_id,run_id,causal_ordinal);
CREATE INDEX canonical_automation_records_v1_type
 ON public.canonical_automation_records_v1(organization_id,record_type,recorded_at);
CREATE INDEX canonical_automation_records_v1_retention
 ON public.canonical_automation_records_v1(retention_class,recorded_at);
CREATE INDEX canonical_automation_historical_run_bindings_v1_policy
 ON public.canonical_automation_historical_run_bindings_v1(organization_id,policy_id,policy_version);

CREATE FUNCTION public.canonical_automation_immutable_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Mission 28 automation authority is append-only' USING ERRCODE='55000'; END $$;

DO $immutability$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_automation_retention_classes_v1','canonical_automation_policy_versions_v1',
  'canonical_automation_source_bindings_v1','canonical_automation_source_sets_v1',
  'canonical_automation_lifecycle_events_v1','canonical_automation_records_v1',
  'canonical_automation_historical_run_bindings_v1','canonical_automation_legacy_conversion_reviews_v1'] LOOP
  EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1()',table_name,table_name);
 END LOOP;
END $immutability$;

DO $rls$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_automation_policy_versions_v1','canonical_automation_lifecycle_events_v1',
  'canonical_automation_source_bindings_v1','canonical_automation_source_sets_v1',
  'canonical_automation_records_v1','canonical_automation_historical_run_bindings_v1',
  'canonical_automation_legacy_conversion_reviews_v1'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format($policy$CREATE POLICY %I ON public.%I
   USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass))
    AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
   WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass))
    AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))$policy$,
   table_name||'_tenant_owner_only',table_name,'public.'||table_name,'public.'||table_name);
 END LOOP;
END $rls$;

CREATE FUNCTION public.canonical_automation_enter_tenant_v1(org UUID)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE trusted_now TIMESTAMPTZ;
BEGIN
 IF org IS NULL OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=org) THEN
  RAISE EXCEPTION 'Mission 28 tenant authority unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.set_config('northstar.automation_tenant_id',org::text,TRUE);
 PERFORM pg_catalog.set_config('TimeZone','UTC',TRUE);
 trusted_now:=public.canonical_automation_clock_v1();
 RETURN trusted_now;
END $$;

CREATE FUNCTION public.canonical_automation_store_policy_v1(canonical_text_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE doc JSONB; org UUID; policy UUID; version_value BIGINT; digest_value TEXT; previous_digest TEXT;
 expires_value TIMESTAMPTZ; now_value TIMESTAMPTZ; prior RECORD; existing RECORD;
BEGIN
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF (SELECT count(*) FROM jsonb_object_keys(doc))<>16 OR NOT doc ?& ARRAY['schemaVersion','tenantId','policyId','version',
  'previousVersionDigest','trigger','action','recipient','channel','schedule','limits','approval','suppressions',
  'expiresAt','rolloutState','canonicalDigest'] OR doc->>'schemaVersion'<>'mission28.policy.version.v1' THEN
  RAISE EXCEPTION 'Mission 28 policy fields invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; policy:=(doc->>'policyId')::uuid; version_value:=(doc->>'version')::bigint;
 digest_value:=doc->>'canonicalDigest'; previous_digest:=doc->>'previousVersionDigest';
 IF version_value NOT BETWEEN 1 AND 9007199254740991 OR COALESCE(digest_value,'')!~'^sha256:[0-9a-f]{64}$' OR
    digest_value<>public.canonical_automation_digest_v1('mission28.policy.version.v1'||chr(10),doc-'canonicalDigest') OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'trigger'))<>3 OR
    NOT doc->'trigger' ?& ARRAY['kind','sourceClassId','condition'] OR
    (SELECT count(*) FROM jsonb_object_keys(doc#>'{trigger,condition}'))<>2 OR
    NOT doc#>'{trigger,condition}' ?& ARRAY['operator','expected'] OR
    doc#>>'{trigger,kind}'<>'exact_current_source' OR
    doc#>>'{trigger,sourceClassId}' NOT IN('mission20_business_contact_preferences','mission21_knowledge_reference',
      'mission22_appointment_dispatch','mission23_work_execution','mission24_estimate_quote','mission25_26_advisory',
      'mission27_financial_collection') OR doc#>>'{trigger,condition,operator}'<>'source_available_and_current' OR
    doc#>>'{trigger,condition,expected}'<>'true' OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'action'))<>4 OR
    NOT doc->'action' ?& ARRAY['familyId','kind','capabilityId','riskClass'] OR
    doc#>>'{action,familyId}' NOT IN('internal_read_digest_task','owner_approval_request','collection_escalation') OR
    doc#>>'{action,kind}'<>'prepare_internal_item_only' OR
    doc#>>'{action,capabilityId}'<>'automation_internal_action_prepare' OR
    doc#>>'{action,riskClass}'<>'internal_sensitive' OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'recipient'))<>2 OR
    NOT doc->'recipient' ?& ARRAY['classId','binding'] OR
    doc#>>'{recipient,classId}' NOT IN('tenant_owner','tenant_admin','assigned_staff') OR
    doc#>>'{recipient,binding}'<>'exact_tenant_private_internal_identity' OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'channel'))<>2 OR
    NOT doc->'channel' ?& ARRAY['channelId','providerMode'] OR doc#>>'{channel,channelId}'<>'in_app_passive' OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'schedule'))<>4 OR
    NOT doc->'schedule' ?& ARRAY['mode','timeZone','notBefore','quietHoursMode'] OR
    doc#>>'{schedule,mode}'<>'evaluation_only_no_scheduler' OR doc#>'{schedule,timeZone}'<>'null'::jsonb OR
    doc#>'{schedule,notBefore}'<>'null'::jsonb OR doc#>>'{schedule,quietHoursMode}'<>'not_applicable_internal' OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'limits'))<>9 OR
    NOT doc->'limits' ?& ARRAY['maxSourceSnapshots','maxActions','maxInternalRecipients','maxExternalRecipients',
      'maxExternalMessages','maxProviderAttempts','maxUpstreamMutations','maxMoneyEffects','maxCanonicalInputBytes'] OR
    doc#>>'{limits,maxSourceSnapshots}' IS DISTINCT FROM '1' OR doc#>>'{limits,maxActions}' IS DISTINCT FROM '1' OR
    doc#>>'{limits,maxInternalRecipients}' IS DISTINCT FROM '1' OR doc#>>'{limits,maxCanonicalInputBytes}' IS DISTINCT FROM '65536' OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'approval'))<>2 OR
    NOT doc->'approval' ?& ARRAY['mode','authorityGranted'] OR
    doc#>>'{approval,mode}'<>'part3_per_run_or_standing_authority_required' OR
    doc->>'rolloutState'<>'disabled_contract_only' OR doc#>>'{approval,authorityGranted}'<>'false' OR
    doc#>>'{channel,providerMode}'<>'provider_disabled' OR
    doc#>>'{limits,maxExternalRecipients}' IS DISTINCT FROM '0' OR
    doc#>>'{limits,maxExternalMessages}' IS DISTINCT FROM '0' OR
    doc#>>'{limits,maxProviderAttempts}' IS DISTINCT FROM '0' OR
    doc#>>'{limits,maxUpstreamMutations}' IS DISTINCT FROM '0' OR
    doc#>>'{limits,maxMoneyEffects}' IS DISTINCT FROM '0' OR
    doc->'suppressions'<>jsonb_build_array('global_stop','tenant_pause','source_changed_stale_corrected_or_unavailable',
      'manual_activity_or_owner_action','prior_effect_unknown_or_unreconciled','recipient_permission_or_channel_unavailable',
      'limit_exceeded','expired_or_rollout_disabled') OR
    doc->>'expiresAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' THEN
  RAISE EXCEPTION 'Mission 28 policy authority invalid' USING ERRCODE='22023'; END IF;
 expires_value:=(doc->>'expiresAt')::timestamptz;
 IF public.canonical_automation_utc_v1(expires_value)<>left(doc->>'expiresAt',19)||'.000000Z' THEN
  RAISE EXCEPTION 'Mission 28 policy expiry invalid' USING ERRCODE='22023'; END IF;
 now_value:=public.canonical_automation_enter_tenant_v1(org);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-policy:'||policy::text,0));
 SELECT * INTO existing FROM public.canonical_automation_policy_versions_v1
  WHERE organization_id=org AND policy_id=policy AND version=version_value FOR SHARE;
 IF existing.policy_id IS NOT NULL THEN
  IF existing.canonical_digest=digest_value AND existing.canonical_text=canonical_text_value THEN
   RETURN jsonb_build_object('state','stored','replayed',TRUE,'recordedAt',public.canonical_automation_utc_v1(existing.recorded_at),
    'canonicalDigest',digest_value); END IF;
  RAISE EXCEPTION 'Mission 28 policy version conflict' USING ERRCODE='23505';
 END IF;
 SELECT version,canonical_digest INTO prior FROM public.canonical_automation_policy_versions_v1
  WHERE organization_id=org AND policy_id=policy ORDER BY version DESC LIMIT 1 FOR SHARE;
 IF (prior.version IS NULL AND (version_value<>1 OR previous_digest IS NOT NULL)) OR
    (prior.version IS NOT NULL AND (version_value<>prior.version+1 OR previous_digest IS DISTINCT FROM prior.canonical_digest)) THEN
  RAISE EXCEPTION 'Mission 28 policy predecessor invalid' USING ERRCODE='40001'; END IF;
 INSERT INTO public.canonical_automation_policy_versions_v1 VALUES(
  org,policy,version_value,previous_digest,digest_value,canonical_text_value,doc,expires_value,
  'mission28_native',NULL,'policy_history','postgresql_statement_timestamp_v1','UTC',now_value);
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'recordedAt',public.canonical_automation_utc_v1(now_value),
  'canonicalDigest',digest_value);
END $$;

CREATE FUNCTION public.canonical_automation_store_source_binding_v1(canonical_text_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE doc JSONB; org UUID; source_record UUID; source_version_value BIGINT; now_value TIMESTAMPTZ;
 source_class TEXT; owner_value TEXT; digest_value TEXT; marker_value TEXT; stored RECORD;
BEGIN
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF (SELECT count(*) FROM jsonb_object_keys(doc))<>7 OR
    NOT doc ?& ARRAY['tenantId','sourceClassId','ownerMission','sourceRecordId','sourceVersion','sourceDigest','currentnessMarker'] THEN
  RAISE EXCEPTION 'Mission 28 source binding fields invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; source_record:=(doc->>'sourceRecordId')::uuid;
 source_version_value:=(doc->>'sourceVersion')::bigint; source_class:=doc->>'sourceClassId';
 owner_value:=doc->>'ownerMission'; digest_value:=doc->>'sourceDigest'; marker_value:=doc->>'currentnessMarker';
 IF source_version_value NOT BETWEEN 1 AND 9007199254740991 OR
    COALESCE(digest_value,'')!~'^sha256:[0-9a-f]{64}$' OR
    marker_value NOT IN('captured_exact_current','captured_stale','captured_unavailable','contract_fixture_unverified') OR
    owner_value IS DISTINCT FROM (CASE source_class
      WHEN 'mission20_business_contact_preferences' THEN 'Mission 20'
      WHEN 'mission21_knowledge_reference' THEN 'Mission 21'
      WHEN 'mission22_appointment_dispatch' THEN 'Mission 22'
      WHEN 'mission23_work_execution' THEN 'Mission 23'
      WHEN 'mission24_estimate_quote' THEN 'Mission 24'
      WHEN 'mission25_26_advisory' THEN 'Missions 25 and 26'
      WHEN 'mission27_financial_collection' THEN 'Mission 27' ELSE NULL END) THEN
  RAISE EXCEPTION 'Mission 28 source binding authority invalid' USING ERRCODE='22023'; END IF;
 now_value:=public.canonical_automation_enter_tenant_v1(org);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source:'||source_class||':'||source_record::text,0));
 SELECT * INTO stored FROM public.canonical_automation_source_bindings_v1 WHERE organization_id=org
  AND source_class_id=source_class AND source_record_id=source_record AND source_version=source_version_value FOR SHARE;
 IF stored.source_record_id IS NOT NULL THEN
  IF stored.source_digest=digest_value AND stored.canonical_text=canonical_text_value THEN
   RETURN jsonb_build_object('state','stored','replayed',TRUE,'sourceDigest',digest_value); END IF;
  RAISE EXCEPTION 'Mission 28 source binding conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_automation_source_bindings_v1 VALUES(org,source_class,owner_value,source_record,
  source_version_value,digest_value,marker_value,canonical_text_value,doc,'source_snapshot_history',
  'postgresql_statement_timestamp_v1','UTC',now_value);
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'sourceDigest',digest_value);
END $$;

CREATE FUNCTION public.canonical_automation_store_source_set_v1(canonical_text_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE doc JSONB; org UUID; digest_value TEXT; marker_value TEXT; expected_marker TEXT;
 source_binding JSONB; source_count INTEGER; distinct_count INTEGER; fixture_count INTEGER;
 stale_count INTEGER; unavailable_count INTEGER; now_value TIMESTAMPTZ; stored RECORD;
BEGIN
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF (SELECT count(*) FROM jsonb_object_keys(doc))<>4 OR
    NOT doc ?& ARRAY['tenantId','sourceBindings','currentnessMarker','sourceSetDigest'] OR
    jsonb_typeof(doc->'sourceBindings')<>'array' OR jsonb_array_length(doc->'sourceBindings') NOT BETWEEN 1 AND 16 THEN
  RAISE EXCEPTION 'Mission 28 source set fields invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; digest_value:=doc->>'sourceSetDigest'; marker_value:=doc->>'currentnessMarker';
 IF digest_value<>public.canonical_automation_digest_v1('mission28.record.source-set.v1'||chr(10),doc->'sourceBindings') THEN
  RAISE EXCEPTION 'Mission 28 source set digest invalid' USING ERRCODE='22023'; END IF;
 now_value:=public.canonical_automation_enter_tenant_v1(org);
 FOR source_binding IN SELECT value FROM jsonb_array_elements(doc->'sourceBindings') LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(source_binding))<>7 OR
     NOT source_binding ?& ARRAY['tenantId','sourceClassId','ownerMission','sourceRecordId','sourceVersion','sourceDigest','currentnessMarker'] OR
     source_binding->>'tenantId'<>org::text OR
     NOT EXISTS(SELECT 1 FROM public.canonical_automation_source_bindings_v1 source_row
      WHERE source_row.organization_id=org AND source_row.source_class_id=source_binding->>'sourceClassId'
       AND source_row.owner_mission=source_binding->>'ownerMission'
       AND source_row.source_record_id=(source_binding->>'sourceRecordId')::uuid
       AND source_row.source_version=(source_binding->>'sourceVersion')::bigint
       AND source_row.source_digest=source_binding->>'sourceDigest'
       AND source_row.currentness_marker=source_binding->>'currentnessMarker') THEN
   RAISE EXCEPTION 'Mission 28 source set authority invalid' USING ERRCODE='40001'; END IF;
 END LOOP;
 SELECT count(*),count(DISTINCT ((source->>'sourceClassId')||':'||(source->>'sourceRecordId'))),
  count(*) FILTER(WHERE (source->>'currentnessMarker')='contract_fixture_unverified'),
  count(*) FILTER(WHERE (source->>'currentnessMarker')='captured_stale'),
  count(*) FILTER(WHERE (source->>'currentnessMarker')='captured_unavailable')
 INTO source_count,distinct_count,fixture_count,stale_count,unavailable_count
 FROM jsonb_array_elements(doc->'sourceBindings') sources(source);
 IF source_count<>distinct_count THEN
  RAISE EXCEPTION 'Mission 28 duplicate source set member denied' USING ERRCODE='22023'; END IF;
 expected_marker:=CASE WHEN fixture_count=source_count THEN 'contract_fixture_unverified'
  WHEN fixture_count>0 THEN NULL WHEN unavailable_count>0 THEN 'unavailable_fail_closed'
  WHEN stale_count>0 THEN 'stale_fail_closed' ELSE 'exact_current_not_runtime_revalidated' END;
 IF marker_value IS DISTINCT FROM expected_marker THEN
  RAISE EXCEPTION 'Mission 28 source set currentness invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-set:'||digest_value,0));
 SELECT * INTO stored FROM public.canonical_automation_source_sets_v1
  WHERE organization_id=org AND source_set_digest=digest_value FOR SHARE;
 IF stored.source_set_digest IS NOT NULL THEN
  IF stored.currentness_marker=marker_value AND stored.canonical_text=canonical_text_value THEN
   RETURN jsonb_build_object('state','stored','replayed',TRUE,'sourceSetDigest',digest_value); END IF;
  RAISE EXCEPTION 'Mission 28 source set conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_automation_source_sets_v1 VALUES(org,digest_value,marker_value,canonical_text_value,
  doc,'source_snapshot_history','postgresql_statement_timestamp_v1','UTC',now_value);
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'sourceSetDigest',digest_value);
END $$;

CREATE FUNCTION public.canonical_automation_store_lifecycle_event_v1(canonical_text_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE doc JSONB; org UUID; policy UUID; version_value BIGINT; sequence_value BIGINT; event_value UUID;
 operation_value TEXT; from_value TEXT; to_value TEXT; event_digest_value TEXT; prior RECORD; stored RECORD;
 now_value TIMESTAMPTZ; expected_event_class TEXT; expected_to TEXT; allowed_from TEXT[];
 expected_idempotency TEXT; validation_digest TEXT; preview_digest TEXT;
 policy_digest_value TEXT; policy_previous_digest TEXT; policy_expires_at TIMESTAMPTZ;
 related_policy_id UUID; related_policy_version BIGINT; related_policy_digest TEXT;
 related_stored_digest TEXT; related_activation_digest TEXT; related_terminal_digest TEXT;
 related_latest_digest TEXT; related_latest_operation TEXT; related_latest_state TEXT;
 rollback_predecessor_version BIGINT; rollback_predecessor_digest TEXT; rollback_stored_digest TEXT;
BEGIN
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF (SELECT count(*) FROM jsonb_object_keys(doc))<>19 OR NOT doc ?& ARRAY['schemaVersion','tenantId','lifecycleEventId','policyBinding',
  'lifecycleSequence','operation','eventClass','fromState','toState','predecessorBinding','idempotencyDigest',
  'sourceSnapshotBinding','requirementBindings','relatedPolicyBinding','rollbackPredecessorBinding','currentness',
  'payload','payloadDigest','eventDigest'] OR doc->>'schemaVersion'<>'mission28.policy.lifecycle.event.v1' THEN
  RAISE EXCEPTION 'Mission 28 lifecycle fields invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; event_value:=(doc->>'lifecycleEventId')::uuid;
 policy:=(doc#>>'{policyBinding,policyId}')::uuid; version_value:=(doc#>>'{policyBinding,policyVersion}')::bigint;
 sequence_value:=(doc->>'lifecycleSequence')::bigint; operation_value:=doc->>'operation';
 from_value:=doc->>'fromState'; to_value:=doc->>'toState'; event_digest_value:=doc->>'eventDigest';
 expected_idempotency:=public.canonical_automation_digest_v1('mission28.policy.lifecycle.idempotency.v1'||chr(10),
  jsonb_build_object('tenantId',doc->'tenantId','policyBinding',doc->'policyBinding',
   'lifecycleSequence',doc->'lifecycleSequence','operation',doc->'operation',
   'predecessorEventDigest',CASE WHEN doc->'predecessorBinding'='null'::jsonb THEN 'null'::jsonb
    ELSE doc#>'{predecessorBinding,eventDigest}' END,
   'relatedPolicyBinding',doc->'relatedPolicyBinding',
   'rollbackPredecessorBinding',doc->'rollbackPredecessorBinding'));
 SELECT event_class,to_state,from_states INTO expected_event_class,expected_to,allowed_from FROM (VALUES
  ('draft_create','lifecycle_decision','draft',ARRAY[NULL]::TEXT[]),
  ('validate','lifecycle_evidence','validated',ARRAY['draft']::TEXT[]),
  ('preview','lifecycle_evidence','previewed',ARRAY['validated']::TEXT[]),
  ('activate','lifecycle_decision','active',ARRAY['previewed']::TEXT[]),
  ('pause','lifecycle_decision','paused',ARRAY['active']::TEXT[]),
  ('resume','lifecycle_decision','active',ARRAY['paused']::TEXT[]),
  ('supersede','lifecycle_decision','superseded',ARRAY['active','paused']::TEXT[]),
  ('expire','lifecycle_evidence','expired',ARRAY['draft','validated','previewed','active','paused']::TEXT[]),
  ('retire','lifecycle_decision','retired',ARRAY['draft','validated','previewed','active','paused']::TEXT[]),
  ('emergency_stop','lifecycle_decision','emergency_stopped',ARRAY['active','paused']::TEXT[]),
  ('bounded_rollback_draft','lifecycle_decision','draft',ARRAY[NULL]::TEXT[])
 ) rules(operation,event_class,to_state,from_states) WHERE operation=operation_value;
 IF expected_to IS NULL OR doc->>'eventClass'<>expected_event_class OR to_value<>expected_to OR
    NOT (from_value=ANY(allowed_from) OR (from_value IS NULL AND array_position(allowed_from,NULL) IS NOT NULL)) OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'policyBinding'))<>4 OR
    NOT doc->'policyBinding' ?& ARRAY['tenantId','policyId','policyVersion','policyDigest'] OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'sourceSnapshotBinding'))<>3 OR
    NOT doc->'sourceSnapshotBinding' ?& ARRAY['tenantId','sourceSetDigest','currentnessMarker'] OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'requirementBindings'))<>4 OR
    NOT doc->'requirementBindings' ?& ARRAY['validationEventDigest','previewEventDigest','authorityEvidenceDigest','trustedTimeEvidenceDigest'] OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'currentness'))<>3 OR
    NOT doc->'currentness' ?& ARRAY['policyState','sourceState','marker'] OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['reasonCode','grammarFixtureOnly','externalEffects'] OR
    doc#>>'{policyBinding,tenantId}'<>org::text OR doc#>>'{sourceSnapshotBinding,tenantId}'<>org::text OR
    COALESCE(doc#>>'{policyBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{sourceSnapshotBinding,sourceSetDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    doc#>>'{sourceSnapshotBinding,currentnessMarker}'<>doc#>>'{currentness,marker}' OR
    doc->>'idempotencyDigest'<>expected_idempotency OR
    jsonb_typeof(doc#>'{payload,grammarFixtureOnly}')<>'boolean' OR
    doc#>>'{payload,externalEffects}' IS DISTINCT FROM '0' OR
    doc->>'payloadDigest'<>public.canonical_automation_digest_v1('mission28.policy.lifecycle.payload.v1'||chr(10),doc->'payload') OR
    event_digest_value<>public.canonical_automation_digest_v1('mission28.policy.lifecycle.event.v1'||chr(10),doc-'eventDigest') THEN
  RAISE EXCEPTION 'Mission 28 lifecycle authority invalid' USING ERRCODE='22023'; END IF;
 IF (doc#>>'{currentness,policyState}'='unavailable' OR doc#>>'{currentness,sourceState}'='unavailable') THEN
  IF doc#>>'{currentness,marker}'<>'unavailable_fail_closed' THEN RAISE EXCEPTION 'Mission 28 lifecycle currentness invalid' USING ERRCODE='22023'; END IF;
 ELSIF (doc#>>'{currentness,policyState}'='stale' OR doc#>>'{currentness,sourceState}'='stale') THEN
  IF doc#>>'{currentness,marker}'<>'stale_fail_closed' THEN RAISE EXCEPTION 'Mission 28 lifecycle currentness invalid' USING ERRCODE='22023'; END IF;
 ELSIF doc#>>'{currentness,policyState}'='exact_current' AND doc#>>'{currentness,sourceState}'='exact_current' THEN
  IF doc#>>'{currentness,marker}'<>'exact_current_not_runtime_revalidated' THEN RAISE EXCEPTION 'Mission 28 lifecycle currentness invalid' USING ERRCODE='22023'; END IF;
 ELSIF doc#>>'{currentness,policyState}'='contract_fixture_unverified' AND
       doc#>>'{currentness,sourceState}'='contract_fixture_unverified' THEN
  IF doc#>>'{currentness,marker}'<>'contract_fixture_unverified' OR doc#>>'{payload,grammarFixtureOnly}'<>'true' THEN
   RAISE EXCEPTION 'Mission 28 lifecycle fixture invalid' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Mission 28 lifecycle currentness invalid' USING ERRCODE='22023'; END IF;
 IF doc#>>'{currentness,marker}'='contract_fixture_unverified' AND doc#>>'{payload,grammarFixtureOnly}'<>'true' THEN
  RAISE EXCEPTION 'Mission 28 lifecycle fixture invalid' USING ERRCODE='22023'; END IF;
 IF operation_value IN('draft_create','validate','preview','activate','resume','supersede','bounded_rollback_draft') AND
    doc#>>'{currentness,marker}' NOT IN('exact_current_not_runtime_revalidated','contract_fixture_unverified') THEN
  RAISE EXCEPTION 'Mission 28 lifecycle active authority is not current' USING ERRCODE='40001'; END IF;
 now_value:=public.canonical_automation_enter_tenant_v1(org);
 -- One lock serializes every lifecycle version for this tenant/policy before any
 -- current or related-version read. A successor cannot become terminal between
 -- supersession validation and append.
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy::text,0));
 SELECT * INTO stored FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND lifecycle_event_id=event_value FOR SHARE;
 IF stored.lifecycle_event_id IS NOT NULL THEN
  IF stored.event_digest=event_digest_value AND stored.canonical_text=canonical_text_value THEN
   RETURN jsonb_build_object('state','stored','replayed',TRUE,'eventDigest',event_digest_value,
    'recordedAt',public.canonical_automation_utc_v1(stored.recorded_at)); END IF;
  RAISE EXCEPTION 'Mission 28 lifecycle event conflict' USING ERRCODE='23505';
 END IF;
 SELECT canonical_digest,previous_version_digest,expires_at
  INTO policy_digest_value,policy_previous_digest,policy_expires_at
  FROM public.canonical_automation_policy_versions_v1 WHERE organization_id=org
   AND policy_id=policy AND version=version_value;
 IF NOT FOUND OR policy_digest_value<>doc#>>'{policyBinding,policyDigest}' THEN
  RAISE EXCEPTION 'Mission 28 lifecycle policy unavailable' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_automation_source_sets_v1 WHERE organization_id=org
   AND source_set_digest=doc#>>'{sourceSnapshotBinding,sourceSetDigest}'
   AND currentness_marker=doc#>>'{sourceSnapshotBinding,currentnessMarker}') THEN
  RAISE EXCEPTION 'Mission 28 lifecycle source authority unavailable' USING ERRCODE='40001'; END IF;
 IF operation_value NOT IN('supersede','bounded_rollback_draft') THEN
  IF doc->'relatedPolicyBinding'<>'null'::jsonb OR doc->'rollbackPredecessorBinding'<>'null'::jsonb THEN
   RAISE EXCEPTION 'Mission 28 unrelated lifecycle binding denied' USING ERRCODE='22023'; END IF;
 ELSIF operation_value='supersede' THEN
  IF jsonb_typeof(doc->'relatedPolicyBinding')<>'object' OR
     (SELECT count(*) FROM jsonb_object_keys(doc->'relatedPolicyBinding'))<>4 OR
     NOT doc->'relatedPolicyBinding' ?& ARRAY['relation','policyBinding','activationEventDigest','terminalEventDigest'] OR
     doc#>>'{relatedPolicyBinding,relation}'<>'successor' OR
     jsonb_typeof(doc#>'{relatedPolicyBinding,policyBinding}')<>'object' OR
     (SELECT count(*) FROM jsonb_object_keys(doc#>'{relatedPolicyBinding,policyBinding}'))<>4 OR
     NOT doc#>'{relatedPolicyBinding,policyBinding}' ?& ARRAY['tenantId','policyId','policyVersion','policyDigest'] OR
     doc#>>'{relatedPolicyBinding,policyBinding,tenantId}'<>org::text OR
     doc#>>'{relatedPolicyBinding,policyBinding,policyId}'<>policy::text OR
     (doc#>>'{relatedPolicyBinding,policyBinding,policyVersion}')::bigint<>version_value+1 OR
     doc#>>'{relatedPolicyBinding,policyBinding,policyDigest}'=policy_digest_value OR
     COALESCE(doc#>>'{relatedPolicyBinding,activationEventDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
     doc#>'{relatedPolicyBinding,terminalEventDigest}'<>'null'::jsonb OR
     doc->'rollbackPredecessorBinding'<>'null'::jsonb THEN
   RAISE EXCEPTION 'Mission 28 lifecycle successor binding invalid' USING ERRCODE='22023'; END IF;
  related_policy_id:=(doc#>>'{relatedPolicyBinding,policyBinding,policyId}')::uuid;
  related_policy_version:=(doc#>>'{relatedPolicyBinding,policyBinding,policyVersion}')::bigint;
  related_policy_digest:=doc#>>'{relatedPolicyBinding,policyBinding,policyDigest}';
  SELECT canonical_digest INTO related_stored_digest FROM public.canonical_automation_policy_versions_v1
   WHERE organization_id=org AND policy_id=related_policy_id AND version=related_policy_version;
  SELECT event_digest INTO related_activation_digest FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=related_policy_id AND policy_version=related_policy_version
    AND operation='activate' AND to_state='active'
   ORDER BY lifecycle_sequence DESC LIMIT 1;
  SELECT event_digest,operation,to_state
   INTO related_latest_digest,related_latest_operation,related_latest_state
   FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=related_policy_id AND policy_version=related_policy_version
   ORDER BY lifecycle_sequence DESC LIMIT 1;
  SELECT event_digest INTO related_terminal_digest FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=related_policy_id AND policy_version=related_policy_version
    AND operation IN('supersede','expire','retire','emergency_stop')
    AND to_state IN('superseded','expired','retired','emergency_stopped')
   ORDER BY lifecycle_sequence DESC LIMIT 1;
  IF related_stored_digest IS DISTINCT FROM related_policy_digest OR
     related_activation_digest IS DISTINCT FROM doc#>>'{relatedPolicyBinding,activationEventDigest}' OR
     related_latest_digest IS NULL OR related_latest_state IS DISTINCT FROM 'active' OR
     related_latest_operation NOT IN('activate','resume') OR related_terminal_digest IS NOT NULL THEN
   RAISE EXCEPTION 'Mission 28 lifecycle successor authority unavailable' USING ERRCODE='40001'; END IF;
 ELSE
  IF jsonb_typeof(doc->'relatedPolicyBinding')<>'object' OR
     (SELECT count(*) FROM jsonb_object_keys(doc->'relatedPolicyBinding'))<>4 OR
     NOT doc->'relatedPolicyBinding' ?& ARRAY['relation','policyBinding','activationEventDigest','terminalEventDigest'] OR
     doc#>>'{relatedPolicyBinding,relation}'<>'rollback_source' OR
     jsonb_typeof(doc#>'{relatedPolicyBinding,policyBinding}')<>'object' OR
     (SELECT count(*) FROM jsonb_object_keys(doc#>'{relatedPolicyBinding,policyBinding}'))<>4 OR
     NOT doc#>'{relatedPolicyBinding,policyBinding}' ?& ARRAY['tenantId','policyId','policyVersion','policyDigest'] OR
     doc#>>'{relatedPolicyBinding,policyBinding,tenantId}'<>org::text OR
     doc#>>'{relatedPolicyBinding,policyBinding,policyId}'<>policy::text OR
     (doc#>>'{relatedPolicyBinding,policyBinding,policyVersion}')::bigint>=version_value OR
     COALESCE(doc#>>'{relatedPolicyBinding,activationEventDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
     COALESCE(doc#>>'{relatedPolicyBinding,terminalEventDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
     jsonb_typeof(doc->'rollbackPredecessorBinding')<>'object' OR
     (SELECT count(*) FROM jsonb_object_keys(doc->'rollbackPredecessorBinding'))<>2 OR
     NOT doc->'rollbackPredecessorBinding' ?& ARRAY['immediatePredecessorPolicyBinding','targetPreviousVersionDigest'] OR
     jsonb_typeof(doc#>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding}')<>'object' OR
     (SELECT count(*) FROM jsonb_object_keys(doc#>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding}'))<>4 OR
     NOT doc#>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding}' ?& ARRAY['tenantId','policyId','policyVersion','policyDigest'] OR
     doc#>>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding,tenantId}'<>org::text OR
     doc#>>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding,policyId}'<>policy::text OR
     (doc#>>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding,policyVersion}')::bigint<>version_value-1 OR
     doc#>>'{rollbackPredecessorBinding,targetPreviousVersionDigest}'<>
      doc#>>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding,policyDigest}' OR
     policy_previous_digest IS DISTINCT FROM doc#>>'{rollbackPredecessorBinding,targetPreviousVersionDigest}' THEN
   RAISE EXCEPTION 'Mission 28 lifecycle rollback binding invalid' USING ERRCODE='22023'; END IF;
  related_policy_id:=(doc#>>'{relatedPolicyBinding,policyBinding,policyId}')::uuid;
  related_policy_version:=(doc#>>'{relatedPolicyBinding,policyBinding,policyVersion}')::bigint;
  related_policy_digest:=doc#>>'{relatedPolicyBinding,policyBinding,policyDigest}';
  rollback_predecessor_version:=(doc#>>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding,policyVersion}')::bigint;
  rollback_predecessor_digest:=doc#>>'{rollbackPredecessorBinding,immediatePredecessorPolicyBinding,policyDigest}';
  SELECT canonical_digest INTO related_stored_digest FROM public.canonical_automation_policy_versions_v1
   WHERE organization_id=org AND policy_id=related_policy_id AND version=related_policy_version;
  SELECT canonical_digest INTO rollback_stored_digest FROM public.canonical_automation_policy_versions_v1
   WHERE organization_id=org AND policy_id=policy AND version=rollback_predecessor_version;
  SELECT event_digest INTO related_activation_digest FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=related_policy_id AND policy_version=related_policy_version
    AND operation='activate' AND to_state='active'
   ORDER BY lifecycle_sequence DESC LIMIT 1;
  SELECT event_digest INTO related_terminal_digest FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=related_policy_id AND policy_version=related_policy_version
    AND operation IN('supersede','expire','retire','emergency_stop')
    AND to_state IN('superseded','expired','retired','emergency_stopped')
   ORDER BY lifecycle_sequence DESC LIMIT 1;
  IF related_stored_digest IS DISTINCT FROM related_policy_digest OR
     rollback_stored_digest IS DISTINCT FROM rollback_predecessor_digest OR
     related_activation_digest IS DISTINCT FROM doc#>>'{relatedPolicyBinding,activationEventDigest}' OR
     related_terminal_digest IS DISTINCT FROM doc#>>'{relatedPolicyBinding,terminalEventDigest}' THEN
   RAISE EXCEPTION 'Mission 28 lifecycle rollback authority unavailable' USING ERRCODE='40001'; END IF;
 END IF;
 IF operation_value IN('activate','resume') AND policy_expires_at<=now_value THEN
  RAISE EXCEPTION 'Mission 28 expired policy active authority denied' USING ERRCODE='40001'; END IF;
 IF operation_value='expire' AND policy_expires_at>now_value THEN
  RAISE EXCEPTION 'Mission 28 policy expiry is not due' USING ERRCODE='40001'; END IF;
 SELECT lifecycle_event_id,event_digest,operation,to_state,lifecycle_sequence INTO prior
  FROM public.canonical_automation_lifecycle_events_v1 WHERE organization_id=org AND policy_id=policy
   AND policy_version=version_value ORDER BY lifecycle_sequence DESC LIMIT 1 FOR SHARE;
 IF (prior.lifecycle_event_id IS NULL AND (sequence_value<>1 OR doc->'predecessorBinding'<>'null'::jsonb)) OR
    (prior.lifecycle_event_id IS NOT NULL AND (sequence_value<>prior.lifecycle_sequence+1 OR
     doc#>>'{predecessorBinding,lifecycleEventId}'<>prior.lifecycle_event_id::text OR
     doc#>>'{predecessorBinding,eventDigest}'<>prior.event_digest OR
     doc#>>'{predecessorBinding,operation}'<>prior.operation OR
     doc#>>'{predecessorBinding,toState}'<>prior.to_state OR from_value IS DISTINCT FROM prior.to_state)) THEN
  RAISE EXCEPTION 'Mission 28 lifecycle predecessor invalid' USING ERRCODE='40001'; END IF;
 SELECT event_digest INTO validation_digest FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND policy_id=policy AND policy_version=version_value AND operation='validate'
  ORDER BY lifecycle_sequence DESC LIMIT 1;
 SELECT event_digest INTO preview_digest FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND policy_id=policy AND policy_version=version_value AND operation='preview'
  ORDER BY lifecycle_sequence DESC LIMIT 1;
 IF (operation_value IN('preview','activate','resume') AND
      doc#>>'{requirementBindings,validationEventDigest}' IS DISTINCT FROM validation_digest) OR
    (operation_value IN('activate','resume') AND
      doc#>>'{requirementBindings,previewEventDigest}' IS DISTINCT FROM preview_digest) OR
    (operation_value NOT IN('preview','activate','resume') AND
      (doc#>>'{requirementBindings,validationEventDigest}' IS NOT NULL OR
       doc#>>'{requirementBindings,previewEventDigest}' IS NOT NULL)) OR
    (operation_value IN('activate','pause','resume','supersede','retire','emergency_stop','bounded_rollback_draft') AND
      COALESCE(doc#>>'{requirementBindings,authorityEvidenceDigest}','')!~'^sha256:[0-9a-f]{64}$') OR
    (operation_value NOT IN('activate','pause','resume','supersede','retire','emergency_stop','bounded_rollback_draft') AND
      doc#>>'{requirementBindings,authorityEvidenceDigest}' IS NOT NULL) OR
    (operation_value='expire' AND COALESCE(doc#>>'{requirementBindings,trustedTimeEvidenceDigest}','')!~'^sha256:[0-9a-f]{64}$') OR
    (operation_value<>'expire' AND doc#>>'{requirementBindings,trustedTimeEvidenceDigest}' IS NOT NULL) THEN
  RAISE EXCEPTION 'Mission 28 lifecycle requirements invalid' USING ERRCODE='40001'; END IF;
 INSERT INTO public.canonical_automation_lifecycle_events_v1 VALUES(org,event_value,policy,version_value,
  sequence_value,operation_value,from_value,to_value,NULLIF(doc#>>'{predecessorBinding,lifecycleEventId}','')::uuid,
  doc#>>'{predecessorBinding,eventDigest}',doc->>'idempotencyDigest',doc->>'payloadDigest',event_digest_value,
  doc#>>'{sourceSnapshotBinding,sourceSetDigest}',doc#>>'{currentness,marker}',canonical_text_value,doc,
  'lifecycle_history','postgresql_statement_timestamp_v1','UTC',now_value);
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'eventDigest',event_digest_value,
  'recordedAt',public.canonical_automation_utc_v1(now_value));
END $$;

CREATE FUNCTION public.canonical_automation_store_record_v1(canonical_text_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE doc JSONB; org UUID; record_value UUID; run_value UUID; policy UUID; version_value BIGINT;
 ordinal_value BIGINT; type_value TEXT; authority_value TEXT; source_digest_value TEXT; retention_value TEXT;
 payload_digest_value TEXT; record_digest_value TEXT; parent JSONB; parent_row RECORD; parent_count INTEGER:=0;
 now_value TIMESTAMPTZ; stored RECORD; historical_row RECORD; source_binding JSONB; marker_value TEXT;
 expected_authority TEXT; expected_record_class TEXT; expected_effect_claim TEXT; allowed_parent_types TEXT[];
 expected_minimum INTEGER; expected_maximum INTEGER; source_key_count INTEGER; source_distinct_count INTEGER;
 source_fixture_count INTEGER; source_stale_count INTEGER; source_unavailable_count INTEGER;
 parent_ids UUID[]:=ARRAY[]::UUID[]; unresolved_id UUID; reconciliation_ids UUID[];
 unresolved_ids UUID[]; ordered_unresolved_ids UUID[]; current_max_ordinal BIGINT; source_set_marker TEXT;
 expected_source_state TEXT; expected_source_set_marker TEXT; expected_record_marker TEXT;
 policy_state_value TEXT; source_state_value TEXT;
BEGIN
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF (SELECT count(*) FROM jsonb_object_keys(doc))<>14 OR NOT doc ?& ARRAY['schemaVersion','tenantId','recordId','runId','recordType',
  'causalOrdinal','policyBinding','sourceBindings','causalParents','classification','currentness','payload',
  'payloadDigest','recordDigest'] OR doc->>'schemaVersion'<>'mission28.record.v1' THEN
  RAISE EXCEPTION 'Mission 28 record fields invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; record_value:=(doc->>'recordId')::uuid; run_value:=(doc->>'runId')::uuid;
 policy:=(doc#>>'{policyBinding,policyId}')::uuid; version_value:=(doc#>>'{policyBinding,policyVersion}')::bigint;
 ordinal_value:=(doc->>'causalOrdinal')::bigint; type_value:=doc->>'recordType';
 authority_value:=doc#>>'{classification,authorityClass}'; marker_value:=doc#>>'{currentness,marker}';
 payload_digest_value:=doc->>'payloadDigest'; record_digest_value:=doc->>'recordDigest';
 SELECT authority_class,record_class,effect_claim,parent_types,minimum_parents,maximum_parents
  INTO expected_authority,expected_record_class,expected_effect_claim,allowed_parent_types,expected_minimum,expected_maximum
 FROM (VALUES
  ('eligibility_evaluation','automation_decision','eligibility','none_internal_only',ARRAY[]::TEXT[],0,0),
  ('proposed_action','automation_decision','proposal','none_internal_only',ARRAY['eligibility_evaluation'],1,1),
  ('approval','automation_decision','approval_authority','none_internal_only',ARRAY['proposed_action'],1,1),
  ('scheduled_run','automation_decision','schedule_intent','none_internal_only',ARRAY['approval'],1,1),
  ('action_unit','automation_decision','bounded_action_intent','none_internal_only',ARRAY['scheduled_run'],1,1),
  ('provider_attempt','external_effect','provider_attempt','attempt_only_not_acknowledgement',ARRAY['action_unit'],1,1),
  ('provider_acknowledgement','effect_evidence','provider_acknowledgement','bounded_evidence_only_not_business_outcome',ARRAY['provider_attempt'],1,1),
  ('delivery_state','effect_evidence','delivery_evidence','bounded_evidence_only_not_business_outcome',ARRAY['provider_acknowledgement'],1,1),
  ('reply_opt_out','effect_evidence','recipient_response_evidence','bounded_evidence_only_not_business_outcome',ARRAY['delivery_state'],1,1),
  ('internal_task','automation_decision','internal_task','none_internal_only',ARRAY['proposed_action','approval','action_unit'],1,1),
  ('suppression','automation_decision','suppression','none_internal_only',ARRAY['eligibility_evaluation','proposed_action','scheduled_run','action_unit','provider_attempt','reply_opt_out'],1,1),
  ('cancellation','automation_decision','cancellation','none_internal_only',ARRAY['scheduled_run','action_unit','provider_attempt','internal_task'],1,1),
  ('reconciliation','effect_evidence','reconciliation','bounded_evidence_only_not_business_outcome',ARRAY['provider_attempt','provider_acknowledgement','delivery_state','reply_opt_out','cancellation'],1,8),
  ('terminal_outcome','effect_evidence','automation_terminal_outcome','bounded_evidence_only_not_business_outcome',ARRAY['action_unit','internal_task','suppression','cancellation','reconciliation'],1,8)
 ) rules(record_type,authority_class,record_class,effect_claim,parent_types,minimum_parents,maximum_parents)
 WHERE record_type=type_value;
 IF expected_authority IS NULL OR (SELECT count(*) FROM jsonb_object_keys(doc->'policyBinding'))<>4 OR
    NOT doc->'policyBinding' ?& ARRAY['tenantId','policyId','policyVersion','policyDigest'] OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'classification'))<>3 OR
    NOT doc->'classification' ?& ARRAY['authorityClass','recordClass','effectClaim'] OR
    (SELECT count(*) FROM jsonb_object_keys(doc->'currentness'))<>3 OR
    NOT doc->'currentness' ?& ARRAY['policyState','sourceState','marker'] OR
    authority_value<>expected_authority OR doc#>>'{classification,recordClass}'<>expected_record_class OR
    doc#>>'{classification,effectClaim}'<>expected_effect_claim OR
    doc#>>'{policyBinding,tenantId}'<>org::text OR jsonb_typeof(doc->'sourceBindings')<>'array' OR
    jsonb_array_length(doc->'sourceBindings') NOT BETWEEN 1 AND 16 OR jsonb_typeof(doc->'causalParents')<>'array' OR
    jsonb_array_length(doc->'causalParents')>8 OR
    payload_digest_value<>public.canonical_automation_digest_v1('mission28.record.payload.v1'||chr(10),doc->'payload') OR
    record_digest_value<>public.canonical_automation_digest_v1('mission28.record.v1'||chr(10),doc-'recordDigest') THEN
  RAISE EXCEPTION 'Mission 28 record authority invalid' USING ERRCODE='22023'; END IF;
 now_value:=public.canonical_automation_enter_tenant_v1(org);
 source_digest_value:=public.canonical_automation_digest_v1('mission28.record.source-set.v1'||chr(10),doc->'sourceBindings');
 policy_state_value:=doc#>>'{currentness,policyState}';
 source_state_value:=doc#>>'{currentness,sourceState}';
 FOR source_binding IN SELECT value FROM jsonb_array_elements(doc->'sourceBindings') LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(source_binding))<>7 OR
     NOT source_binding ?& ARRAY['tenantId','sourceClassId','ownerMission','sourceRecordId','sourceVersion','sourceDigest','currentnessMarker'] OR
     source_binding->>'tenantId'<>org::text OR COALESCE(source_binding->>'sourceDigest','')!~'^sha256:[0-9a-f]{64}$' OR
     NOT EXISTS(SELECT 1 FROM public.canonical_automation_source_bindings_v1 source_row
       WHERE source_row.organization_id=org AND source_row.source_class_id=source_binding->>'sourceClassId'
        AND source_row.owner_mission=source_binding->>'ownerMission'
        AND source_row.source_record_id=(source_binding->>'sourceRecordId')::uuid
        AND source_row.source_version=(source_binding->>'sourceVersion')::bigint
        AND source_row.source_digest=source_binding->>'sourceDigest'
        AND source_row.currentness_marker=source_binding->>'currentnessMarker') THEN
   RAISE EXCEPTION 'Mission 28 record source binding invalid' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT count(*),count(DISTINCT ((source->>'sourceClassId')||':'||(source->>'sourceRecordId'))),
  count(*) FILTER(WHERE source->>'currentnessMarker'='contract_fixture_unverified'),
  count(*) FILTER(WHERE source->>'currentnessMarker'='captured_stale'),
  count(*) FILTER(WHERE source->>'currentnessMarker'='captured_unavailable')
 INTO source_key_count,source_distinct_count,source_fixture_count,source_stale_count,source_unavailable_count
 FROM jsonb_array_elements(doc->'sourceBindings') sources(source);
 IF source_key_count<>source_distinct_count THEN RAISE EXCEPTION 'Mission 28 duplicate source binding denied' USING ERRCODE='22023'; END IF;
 IF source_fixture_count=source_key_count THEN
  expected_source_state:='contract_fixture_unverified'; expected_source_set_marker:='contract_fixture_unverified';
 ELSIF source_fixture_count>0 THEN
  RAISE EXCEPTION 'Mission 28 record currentness invalid' USING ERRCODE='22023';
 ELSIF source_unavailable_count=source_key_count THEN
  expected_source_state:='unavailable'; expected_source_set_marker:='unavailable_fail_closed';
 ELSIF source_unavailable_count>0 THEN
  expected_source_state:='mixed'; expected_source_set_marker:='unavailable_fail_closed';
 ELSIF source_stale_count=source_key_count THEN
  expected_source_state:='stale'; expected_source_set_marker:='stale_fail_closed';
 ELSIF source_stale_count>0 THEN
  expected_source_state:='mixed'; expected_source_set_marker:='stale_fail_closed';
 ELSE
  expected_source_state:='exact_bound'; expected_source_set_marker:='exact_current_not_runtime_revalidated';
 END IF;
 IF policy_state_value NOT IN('exact_bound','stale','unavailable','contract_fixture_unverified') OR
    (policy_state_value='contract_fixture_unverified')<>(expected_source_state='contract_fixture_unverified') THEN
  RAISE EXCEPTION 'Mission 28 record currentness invalid' USING ERRCODE='22023';
 END IF;
 SELECT currentness_marker INTO source_set_marker FROM public.canonical_automation_source_sets_v1
  WHERE organization_id=org AND source_set_digest=source_digest_value;
 IF source_set_marker IS NULL OR source_set_marker IS DISTINCT FROM expected_source_set_marker THEN
  RAISE EXCEPTION 'Mission 28 record source set unavailable' USING ERRCODE='40001'; END IF;
 IF policy_state_value='contract_fixture_unverified' AND expected_source_state='contract_fixture_unverified' THEN
  expected_record_marker:='contract_fixture_unverified';
 ELSIF policy_state_value='unavailable' OR source_unavailable_count>0 THEN
  expected_record_marker:='captured_unavailable_fail_closed';
 ELSIF policy_state_value='stale' OR source_stale_count>0 THEN
  expected_record_marker:='captured_stale_fail_closed';
 ELSIF policy_state_value='exact_bound' AND expected_source_state='exact_bound' THEN
  IF marker_value NOT IN('captured_not_runtime_revalidated','captured_runtime_revalidation_required') THEN
   RAISE EXCEPTION 'Mission 28 record currentness invalid' USING ERRCODE='22023'; END IF;
  expected_record_marker:=marker_value;
 ELSE
  RAISE EXCEPTION 'Mission 28 record currentness invalid' USING ERRCODE='22023';
 END IF;
 IF source_state_value IS DISTINCT FROM expected_source_state OR marker_value IS DISTINCT FROM expected_record_marker THEN
  RAISE EXCEPTION 'Mission 28 record currentness invalid' USING ERRCODE='22023';
 END IF;
 IF type_value='eligibility_evaluation' AND doc#>>'{payload,sourceSetDigest}'<>source_digest_value THEN
  RAISE EXCEPTION 'Mission 28 record source digest invalid' USING ERRCODE='22023'; END IF;
 IF (CASE type_value
   WHEN 'eligibility_evaluation' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['resultState','reasonCode','sourceSetDigest'] OR
    doc#>>'{payload,resultState}' NOT IN('eligible','ineligible','suppressed','unavailable','approval_required') OR
    doc#>>'{payload,reasonCode}' NOT IN('contract_fixture','exact_match','source_stale','authority_missing','suppressed')
   WHEN 'proposed_action' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>4 OR
    NOT doc->'payload' ?& ARRAY['actionFamily','recipientClassId','channelId','proposalState'] OR
    doc#>>'{payload,actionFamily}' NOT IN('internal_read_digest_task','owner_approval_request','collection_escalation') OR
    doc#>>'{payload,recipientClassId}' NOT IN('tenant_owner','tenant_admin','assigned_staff') OR
    doc#>>'{payload,channelId}'<>'in_app_passive' OR doc#>>'{payload,proposalState}'<>'proposed_not_authorized'
   WHEN 'approval' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>4 OR
    NOT doc->'payload' ?& ARRAY['approvalClass','authorityState','actorBindingDigest','previewDigest'] OR
    doc#>>'{payload,approvalClass}' NOT IN('per_run','standing') OR
    doc#>>'{payload,authorityState}' NOT IN('unavailable_pending_part3','approved','denied','expired','revoked') OR
    COALESCE(doc#>>'{payload,actorBindingDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{payload,previewDigest}','')!~'^sha256:[0-9a-f]{64}$'
   WHEN 'scheduled_run' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['scheduleState','scheduleBindingDigest','trustedClockState'] OR
    doc#>>'{payload,scheduleState}' NOT IN('unavailable_contract_only','scheduled','due','expired') OR
    COALESCE(doc#>>'{payload,scheduleBindingDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    doc#>>'{payload,trustedClockState}' NOT IN('unavailable_pending_part2d','trusted')
   WHEN 'action_unit' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['unitState','idempotencyKeyDigest','effectClass'] OR
    doc#>>'{payload,unitState}' NOT IN('unavailable_contract_only','ready','blocked','cancelled') OR
    COALESCE(doc#>>'{payload,idempotencyKeyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    doc#>>'{payload,effectClass}' NOT IN('internal_only','external_provider')
   WHEN 'provider_attempt' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>4 OR
    NOT doc->'payload' ?& ARRAY['attemptState','providerMode','providerRequestIdentityDigest','effectOccurred'] OR
    COALESCE(doc#>>'{payload,providerRequestIdentityDigest}','')!~'^sha256:[0-9a-f]{64}$'
   WHEN 'provider_acknowledgement' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>4 OR
    NOT doc->'payload' ?& ARRAY['ackState','authenticated','providerAttemptDigest','strongerEffectProven'] OR
    COALESCE(doc#>>'{payload,providerAttemptDigest}','')!~'^sha256:[0-9a-f]{64}$'
   WHEN 'delivery_state' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['deliveryState','evidenceSource','strongestClaim']
   WHEN 'reply_opt_out' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['responseState','authenticated','suppressionRequired']
   WHEN 'internal_task' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['taskState','assigneeClass','externalEffect'] OR
    doc#>>'{payload,taskState}' NOT IN('unavailable_contract_only','open','completed','cancelled') OR
    doc#>>'{payload,assigneeClass}' NOT IN('tenant_owner','tenant_admin','assigned_staff')
   WHEN 'suppression' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['suppressionCode','scope','blocksEffect'] OR
    doc#>>'{payload,suppressionCode}' NOT IN('global_stop','tenant_pause','source_changed_stale_corrected_or_unavailable',
      'manual_activity_or_owner_action','prior_effect_unknown_or_unreconciled','recipient_permission_or_channel_unavailable',
      'limit_exceeded','expired_or_rollout_disabled') OR
    doc#>>'{payload,scope}' NOT IN('global','tenant','source','action','recipient')
   WHEN 'cancellation' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['cancellationState','targetRecordId','effectReversalClaim'] OR
    doc#>>'{payload,cancellationState}' NOT IN('requested','accepted','too_late','unavailable')
   WHEN 'reconciliation' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['reconciliationState','reconciledRecordIds','strongestClaim'] OR
    jsonb_typeof(doc#>'{payload,reconciledRecordIds}')<>'array'
   WHEN 'terminal_outcome' THEN (SELECT count(*) FROM jsonb_object_keys(doc->'payload'))<>3 OR
    NOT doc->'payload' ?& ARRAY['terminalState','businessOutcomeClaimed','unresolvedRecordIds'] OR
    jsonb_typeof(doc#>'{payload,unresolvedRecordIds}')<>'array' OR
    doc#>>'{payload,terminalState}' NOT IN('completed_internal','suppressed','cancelled','failed','unavailable','uncertain')
   ELSE TRUE END) THEN
  RAISE EXCEPTION 'Mission 28 record payload invalid' USING ERRCODE='22023'; END IF;
 IF (type_value='provider_attempt' AND jsonb_typeof(doc#>'{payload,effectOccurred}')<>'boolean') OR
    (type_value='provider_acknowledgement' AND
      (jsonb_typeof(doc#>'{payload,authenticated}')<>'boolean' OR jsonb_typeof(doc#>'{payload,strongerEffectProven}')<>'boolean')) OR
    (type_value='reply_opt_out' AND
      (jsonb_typeof(doc#>'{payload,authenticated}')<>'boolean' OR jsonb_typeof(doc#>'{payload,suppressionRequired}')<>'boolean')) OR
    (type_value='internal_task' AND jsonb_typeof(doc#>'{payload,externalEffect}')<>'boolean') OR
    (type_value='suppression' AND jsonb_typeof(doc#>'{payload,blocksEffect}')<>'boolean') OR
    (type_value='cancellation' AND jsonb_typeof(doc#>'{payload,effectReversalClaim}')<>'boolean') OR
    (type_value='terminal_outcome' AND jsonb_typeof(doc#>'{payload,businessOutcomeClaimed}')<>'boolean') THEN
  RAISE EXCEPTION 'Mission 28 record payload boolean invalid' USING ERRCODE='22023'; END IF;
 IF (type_value='approval' AND doc#>>'{payload,authorityState}'<>'unavailable_pending_part3') OR
    (type_value='scheduled_run' AND doc#>>'{payload,scheduleState}'<>'unavailable_contract_only') OR
    (type_value='action_unit' AND doc#>>'{payload,unitState}'<>'unavailable_contract_only') OR
    (type_value='internal_task' AND doc#>>'{payload,taskState}'<>'unavailable_contract_only') OR
    (type_value='cancellation' AND doc#>>'{payload,cancellationState}'<>'unavailable') THEN
  RAISE EXCEPTION 'Mission 28 later runtime authority unavailable' USING ERRCODE='42501'; END IF;
 IF type_value='provider_attempt' AND (doc#>>'{payload,providerMode}'<>'provider_disabled' OR
  doc#>>'{payload,attemptState}'<>'not_attempted_contract_fixture' OR doc#>>'{payload,effectOccurred}'<>'false') THEN
  RAISE EXCEPTION 'Mission 28 provider attempt authority unavailable' USING ERRCODE='42501'; END IF;
 IF type_value IN('provider_acknowledgement','delivery_state','reply_opt_out','reconciliation') AND
    authority_value<>'effect_evidence' THEN RAISE EXCEPTION 'Mission 28 evidence classification invalid' USING ERRCODE='22023'; END IF;
 IF type_value='provider_attempt' AND authority_value<>'external_effect' THEN
  RAISE EXCEPTION 'Mission 28 attempt classification invalid' USING ERRCODE='22023'; END IF;
 IF type_value NOT IN('provider_attempt','provider_acknowledgement','delivery_state','reply_opt_out','reconciliation','terminal_outcome')
    AND authority_value<>'automation_decision' THEN
  RAISE EXCEPTION 'Mission 28 decision classification invalid' USING ERRCODE='22023'; END IF;
 IF (type_value='provider_acknowledgement' AND (doc#>>'{payload,ackState}'<>'unavailable_contract_fixture' OR
     doc#>>'{payload,authenticated}'<>'false' OR doc#>>'{payload,strongerEffectProven}'<>'false')) OR
    (type_value='delivery_state' AND (doc#>>'{payload,deliveryState}'<>'unavailable_contract_fixture' OR
     doc#>>'{payload,evidenceSource}'<>'contract_fixture' OR doc#>>'{payload,strongestClaim}'<>'none')) OR
    (type_value='reply_opt_out' AND (doc#>>'{payload,responseState}'<>'unavailable_contract_fixture' OR
     doc#>>'{payload,authenticated}'<>'false')) OR
    (type_value='internal_task' AND doc#>>'{payload,externalEffect}'<>'false') OR
    (type_value='cancellation' AND doc#>>'{payload,effectReversalClaim}'<>'false') OR
    (type_value='reconciliation' AND (doc#>>'{payload,reconciliationState}'<>'unavailable_contract_fixture' OR
     doc#>>'{payload,strongestClaim}'<>'none')) OR
    (type_value='terminal_outcome' AND doc#>>'{payload,businessOutcomeClaimed}'<>'false') THEN
  RAISE EXCEPTION 'Mission 28 effect authority unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1 WHERE organization_id=org
  AND policy_id=policy AND version=version_value AND canonical_digest=doc#>>'{policyBinding,policyDigest}') THEN
  RAISE EXCEPTION 'Mission 28 record policy unavailable' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-run:'||run_value::text,0));
 SELECT * INTO stored FROM public.canonical_automation_records_v1 WHERE organization_id=org AND record_id=record_value FOR SHARE;
 IF stored.record_id IS NOT NULL THEN
  IF stored.record_digest=record_digest_value AND stored.canonical_text=canonical_text_value THEN
   RETURN jsonb_build_object('state','stored','replayed',TRUE,'recordDigest',record_digest_value,
    'recordedAt',public.canonical_automation_utc_v1(stored.recorded_at)); END IF;
  RAISE EXCEPTION 'Mission 28 record conflict' USING ERRCODE='23505'; END IF;
 SELECT policy_id,policy_version,source_set_digest INTO historical_row
  FROM public.canonical_automation_historical_run_bindings_v1
  WHERE organization_id=org AND run_id=run_value FOR SHARE;
 IF historical_row.policy_id IS NOT NULL AND
    (historical_row.policy_id<>policy OR historical_row.policy_version<>version_value OR
     historical_row.source_set_digest<>source_digest_value) THEN
  RAISE EXCEPTION 'Mission 28 historical run binding mismatch' USING ERRCODE='40001';
 END IF;
 SELECT max(causal_ordinal) INTO current_max_ordinal
  FROM public.canonical_automation_records_v1 WHERE organization_id=org AND run_id=run_value;
 IF current_max_ordinal IS NOT NULL AND ordinal_value<=current_max_ordinal THEN
  RAISE EXCEPTION 'Mission 28 causal ordinal must strictly append' USING ERRCODE='40001';
 END IF;
 FOR parent IN SELECT value FROM jsonb_array_elements(doc->'causalParents') LOOP
  parent_count:=parent_count+1;
  IF (SELECT count(*) FROM jsonb_object_keys(parent))<>3 OR
     NOT parent ?& ARRAY['recordId','recordType','recordDigest'] OR
     COALESCE(parent->>'recordDigest','')!~'^sha256:[0-9a-f]{64}$' OR
     (parent->>'recordType')<>ALL(allowed_parent_types) THEN
   RAISE EXCEPTION 'Mission 28 record parent shape invalid' USING ERRCODE='22023'; END IF;
  IF (parent->>'recordId')::uuid=ANY(parent_ids) THEN
   RAISE EXCEPTION 'Mission 28 duplicate parent denied' USING ERRCODE='22023'; END IF;
  parent_ids:=array_append(parent_ids,(parent->>'recordId')::uuid);
  SELECT record_id,record_type,record_digest,causal_ordinal INTO parent_row
   FROM public.canonical_automation_records_v1 WHERE organization_id=org AND run_id=run_value
    AND policy_id=policy AND policy_version=version_value
    AND record_id=(parent->>'recordId')::uuid FOR SHARE;
  IF parent_row.record_id IS NULL OR parent_row.record_type<>parent->>'recordType' OR
     parent_row.record_digest<>parent->>'recordDigest' OR parent_row.causal_ordinal>=ordinal_value THEN
   RAISE EXCEPTION 'Mission 28 record parent invalid' USING ERRCODE='40001'; END IF;
 END LOOP;
 IF parent_count NOT BETWEEN expected_minimum AND expected_maximum THEN
  RAISE EXCEPTION 'Mission 28 record parent count invalid' USING ERRCODE='22023'; END IF;
 IF type_value='provider_acknowledgement' THEN
  IF doc#>>'{payload,providerAttemptDigest}'<>parent_row.record_digest THEN
   RAISE EXCEPTION 'Mission 28 acknowledgement subject invalid' USING ERRCODE='22023'; END IF;
 END IF;
 IF type_value='cancellation' THEN
  IF doc#>>'{payload,targetRecordId}'<>parent_row.record_id::text THEN
   RAISE EXCEPTION 'Mission 28 cancellation subject invalid' USING ERRCODE='22023'; END IF;
 END IF;
 IF type_value='reconciliation' THEN
  SELECT array_agg(value::uuid ORDER BY ordinal) INTO reconciliation_ids
   FROM jsonb_array_elements_text(doc#>'{payload,reconciledRecordIds}') WITH ORDINALITY values(value,ordinal);
  IF reconciliation_ids IS DISTINCT FROM parent_ids THEN
   RAISE EXCEPTION 'Mission 28 reconciliation subjects invalid' USING ERRCODE='22023'; END IF;
 END IF;
 IF type_value='terminal_outcome' THEN
  SELECT COALESCE(array_agg(value::uuid ORDER BY ordinal),ARRAY[]::UUID[]) INTO unresolved_ids
   FROM jsonb_array_elements_text(doc#>'{payload,unresolvedRecordIds}')
    WITH ORDINALITY values(value,ordinal);
  FOR unresolved_id IN SELECT value::uuid FROM jsonb_array_elements_text(doc#>'{payload,unresolvedRecordIds}') values(value) LOOP
   IF NOT unresolved_id=ANY(parent_ids) THEN
    RAISE EXCEPTION 'Mission 28 terminal unresolved subject invalid' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements_text(doc#>'{payload,unresolvedRecordIds}'))<>
     (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(doc#>'{payload,unresolvedRecordIds}') values(value)) THEN
   RAISE EXCEPTION 'Mission 28 duplicate unresolved subject denied' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(array_agg(parent_id ORDER BY ordinal),ARRAY[]::UUID[]) INTO ordered_unresolved_ids
   FROM unnest(parent_ids) WITH ORDINALITY parents(parent_id,ordinal)
   WHERE parent_id=ANY(unresolved_ids);
  IF ordered_unresolved_ids IS DISTINCT FROM unresolved_ids THEN
   RAISE EXCEPTION 'Mission 28 terminal unresolved order invalid' USING ERRCODE='22023'; END IF;
 END IF;
 retention_value:=CASE authority_value WHEN 'effect_evidence' THEN 'effect_evidence_history' ELSE 'decision_history' END;
 INSERT INTO public.canonical_automation_records_v1 VALUES(org,record_value,run_value,type_value,ordinal_value,
  policy,version_value,source_digest_value,marker_value,authority_value,payload_digest_value,record_digest_value,
  canonical_text_value,doc,retention_value,'postgresql_statement_timestamp_v1','UTC',now_value);
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'recordDigest',record_digest_value,
  'recordedAt',public.canonical_automation_utc_v1(now_value));
END $$;

CREATE FUNCTION public.canonical_automation_store_historical_run_binding_v1(canonical_text_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE doc JSONB; org UUID; run_value UUID; policy UUID; version_value BIGINT; event_value UUID;
 digest_value TEXT; now_value TIMESTAMPTZ; event_row RECORD; latest_event_row RECORD; stored RECORD;
 first_record_at TIMESTAMPTZ; run_record_count INTEGER;
BEGIN
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF (SELECT count(*) FROM jsonb_object_keys(doc))<>8 OR NOT doc ?& ARRAY['tenantId','runId','policyBinding','sourceSnapshotBinding',
  'createdByLifecycleEventBinding','lifecycleStateAtCreation','immutable','bindingDigest'] OR
  (SELECT count(*) FROM jsonb_object_keys(doc->'policyBinding'))<>4 OR
  NOT doc->'policyBinding' ?& ARRAY['tenantId','policyId','policyVersion','policyDigest'] OR
  (SELECT count(*) FROM jsonb_object_keys(doc->'sourceSnapshotBinding'))<>3 OR
  NOT doc->'sourceSnapshotBinding' ?& ARRAY['tenantId','sourceSetDigest','currentnessMarker'] OR
  (SELECT count(*) FROM jsonb_object_keys(doc->'createdByLifecycleEventBinding'))<>4 OR
  NOT doc->'createdByLifecycleEventBinding' ?& ARRAY['lifecycleEventId','eventDigest','operation','toState'] OR
  doc->>'lifecycleStateAtCreation'<>'active' OR doc->>'immutable'<>'true' THEN
  RAISE EXCEPTION 'Mission 28 historical binding invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; run_value:=(doc->>'runId')::uuid; policy:=(doc#>>'{policyBinding,policyId}')::uuid;
 version_value:=(doc#>>'{policyBinding,policyVersion}')::bigint;
 event_value:=(doc#>>'{createdByLifecycleEventBinding,lifecycleEventId}')::uuid; digest_value:=doc->>'bindingDigest';
 IF doc#>>'{policyBinding,tenantId}'<>org::text OR doc#>>'{sourceSnapshotBinding,tenantId}'<>org::text OR
    COALESCE(doc#>>'{policyBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{sourceSnapshotBinding,sourceSetDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    doc#>>'{sourceSnapshotBinding,currentnessMarker}' NOT IN('exact_current_not_runtime_revalidated','contract_fixture_unverified') OR
    digest_value<>public.canonical_automation_digest_v1('mission28.policy.lifecycle.historical-run.v1'||chr(10),doc-'bindingDigest') THEN
  RAISE EXCEPTION 'Mission 28 historical binding digest invalid' USING ERRCODE='22023'; END IF;
 now_value:=public.canonical_automation_enter_tenant_v1(org);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-run:'||run_value::text,0));
 SELECT count(*)::integer,min(recorded_at) INTO run_record_count,first_record_at
  FROM public.canonical_automation_records_v1 WHERE organization_id=org AND run_id=run_value;
 SELECT lifecycle_event_id,event_digest,operation,to_state,source_set_digest,currentness_marker,
  lifecycle_sequence,recorded_at INTO event_row
  FROM public.canonical_automation_lifecycle_events_v1 WHERE organization_id=org AND lifecycle_event_id=event_value
   AND policy_id=policy AND policy_version=version_value FOR SHARE;
 SELECT lifecycle_event_id,event_digest,operation,to_state,lifecycle_sequence INTO latest_event_row
  FROM public.canonical_automation_lifecycle_events_v1 WHERE organization_id=org AND policy_id=policy
   AND policy_version=version_value AND recorded_at<=first_record_at
  ORDER BY lifecycle_sequence DESC LIMIT 1 FOR SHARE;
 IF event_row.lifecycle_event_id IS NULL OR event_row.event_digest<>doc#>>'{createdByLifecycleEventBinding,eventDigest}' OR
     event_row.operation<>doc#>>'{createdByLifecycleEventBinding,operation}' OR
     event_row.operation NOT IN('activate','resume') OR event_row.to_state<>'active' OR
    doc#>>'{createdByLifecycleEventBinding,toState}'<>'active' OR
     event_row.source_set_digest<>doc#>>'{sourceSnapshotBinding,sourceSetDigest}' OR
     event_row.currentness_marker<>doc#>>'{sourceSnapshotBinding,currentnessMarker}' OR
     run_record_count=0 OR event_row.recorded_at>=first_record_at OR
     latest_event_row.lifecycle_event_id IS DISTINCT FROM event_row.lifecycle_event_id OR
     latest_event_row.event_digest IS DISTINCT FROM event_row.event_digest OR
     latest_event_row.operation IS DISTINCT FROM event_row.operation OR latest_event_row.to_state IS DISTINCT FROM 'active' OR
    NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1 WHERE organization_id=org
      AND policy_id=policy AND version=version_value AND canonical_digest=doc#>>'{policyBinding,policyDigest}') OR
     EXISTS(SELECT 1 FROM public.canonical_automation_records_v1 WHERE organization_id=org AND run_id=run_value
      AND (policy_id<>policy OR policy_version<>version_value OR
       source_set_digest<>doc#>>'{sourceSnapshotBinding,sourceSetDigest}')) THEN
  RAISE EXCEPTION 'Mission 28 historical authority unavailable' USING ERRCODE='40001'; END IF;
 SELECT * INTO stored FROM public.canonical_automation_historical_run_bindings_v1
  WHERE organization_id=org AND run_id=run_value FOR SHARE;
 IF stored.run_id IS NOT NULL THEN
  IF stored.binding_digest=digest_value AND stored.canonical_text=canonical_text_value THEN
   RETURN jsonb_build_object('state','stored','replayed',TRUE,'bindingDigest',digest_value); END IF;
  RAISE EXCEPTION 'Mission 28 historical run rebind denied' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_automation_historical_run_bindings_v1 VALUES(org,run_value,policy,version_value,
  doc#>>'{sourceSnapshotBinding,sourceSetDigest}',event_value,doc#>>'{createdByLifecycleEventBinding,eventDigest}',
  digest_value,canonical_text_value,doc,'historical_run_binding','postgresql_statement_timestamp_v1','UTC',now_value);
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'bindingDigest',digest_value);
END $$;

CREATE FUNCTION public.canonical_automation_storage_snapshot_v1(org UUID,policy UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ignored TIMESTAMPTZ;
BEGIN
 ignored:=public.canonical_automation_enter_tenant_v1(org);
 RETURN jsonb_build_object('contractVersion','mission28.postgresql.authority.v1','tenantId',org,
  'policyId',policy,'trustedClockContract','postgresql_statement_timestamp_v1','recordedTimeZone','UTC',
  'policies',COALESCE((SELECT jsonb_agg(document ORDER BY version) FROM public.canonical_automation_policy_versions_v1
   WHERE organization_id=org AND policy_id=policy),'[]'::jsonb),
  'sourceBindings',COALESCE((SELECT jsonb_agg(document ORDER BY source_class_id,source_record_id,source_version)
   FROM public.canonical_automation_source_bindings_v1 WHERE organization_id=org),'[]'::jsonb),
  'sourceSets',COALESCE((SELECT jsonb_agg(document ORDER BY source_set_digest)
   FROM public.canonical_automation_source_sets_v1 WHERE organization_id=org),'[]'::jsonb),
  'lifecycleEvents',COALESCE((SELECT jsonb_agg(document ORDER BY policy_version,lifecycle_sequence)
   FROM public.canonical_automation_lifecycle_events_v1 WHERE organization_id=org AND policy_id=policy),'[]'::jsonb),
  'records',COALESCE((SELECT jsonb_agg(document ORDER BY run_id,causal_ordinal)
   FROM public.canonical_automation_records_v1 WHERE organization_id=org AND policy_id=policy),'[]'::jsonb),
  'historicalRunBindings',COALESCE((SELECT jsonb_agg(document ORDER BY run_id)
   FROM public.canonical_automation_historical_run_bindings_v1 WHERE organization_id=org AND policy_id=policy),'[]'::jsonb),
  'legacyConversionReviewCount',(SELECT count(*) FROM public.canonical_automation_legacy_conversion_reviews_v1
   WHERE organization_id=org),'runtimeWriteAuthorityAvailable',FALSE,'providerCalls',0,'externalEffects',0,
  'upstreamMutations',0,'moneyEffects',0);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_retention_classes_v1,
 public.canonical_automation_policy_versions_v1,public.canonical_automation_source_bindings_v1,
 public.canonical_automation_source_sets_v1,
 public.canonical_automation_lifecycle_events_v1,
 public.canonical_automation_records_v1,public.canonical_automation_historical_run_bindings_v1,
 public.canonical_automation_legacy_conversion_reviews_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_json_shape_v1(JSONB,INTEGER),
 public.canonical_automation_json_nodes_v1(JSONB,INTEGER),
 public.canonical_automation_json_v1(JSONB),public.canonical_automation_document_v1(TEXT),
 public.canonical_automation_digest_v1(TEXT,JSONB),public.canonical_automation_utc_v1(TIMESTAMPTZ),
 public.canonical_automation_clock_v1(),public.canonical_automation_immutable_v1(),
 public.canonical_automation_enter_tenant_v1(UUID),public.canonical_automation_store_policy_v1(TEXT),
 public.canonical_automation_store_source_binding_v1(TEXT),
  public.canonical_automation_store_source_set_v1(TEXT),
 public.canonical_automation_store_lifecycle_event_v1(TEXT),public.canonical_automation_store_record_v1(TEXT),
 public.canonical_automation_store_historical_run_binding_v1(TEXT),
 public.canonical_automation_storage_snapshot_v1(UUID,UUID) FROM PUBLIC;
