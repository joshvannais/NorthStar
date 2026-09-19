-- Mission 25 Part 14C: preserve exact labor-source replay authority across permission periods.
-- PostgreSQL 17/18 compatible; no provider state or operational business truth is mutated.

CREATE OR REPLACE FUNCTION public.canonical_external_labor_import_consent_mutate(org UUID,actor UUID,role_value TEXT,
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
 SELECT * INTO current_row FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 SELECT * INTO old FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'External labor consent key conflict' USING ERRCODE='23505'; END IF;
  IF current_row.id IS DISTINCT FROM old.id THEN
   RAISE EXCEPTION 'External labor permission changed' USING ERRCODE='40001',CONSTRAINT='external_labor_retired_consent_replay';
  END IF;
  RETURN jsonb_build_object('consent',public.canonical_external_labor_import_consent_projection(old),'replayed',TRUE);
 END IF;
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

CREATE OR REPLACE FUNCTION public.canonical_external_labor_operation_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,source_value TEXT,kind TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_value JSONB; replay_value JSONB; previous UUID; revision_value BIGINT; key_hash TEXT; request_hash TEXT; digest_value TEXT; inserted JSONB;
 consent_row public.canonical_external_labor_import_consents%ROWTYPE; revoke_digest TEXT; replay_consent_id UUID;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Source operations restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR kind NOT IN ('adapter','retention','deletion') OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Source operation invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-labor-operation:'||source_value||':'||kind,0));
 IF NOT EXISTS(SELECT 1 FROM public.canonical_external_labor_import_consents WHERE organization_id=org AND source_key=source_value) THEN RAISE EXCEPTION 'Source operation requires a recorded source' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'kind',kind,'body',body));
 SELECT * INTO consent_row FROM public.canonical_external_labor_import_consents
  WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF kind='adapter' THEN SELECT to_jsonb(item) INTO replay_value FROM (SELECT * FROM public.canonical_external_labor_adapter_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) item;
 ELSIF kind='retention' THEN SELECT to_jsonb(item) INTO replay_value FROM (SELECT * FROM public.canonical_external_labor_retention_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) item;
 ELSE SELECT to_jsonb(item) INTO replay_value FROM (SELECT * FROM public.canonical_external_labor_deletion_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) item; END IF;
 IF replay_value IS NOT NULL THEN
  IF rtrim(replay_value->>'request_digest')<>request_hash THEN RAISE EXCEPTION 'Source operation key conflict' USING ERRCODE='23505'; END IF;
  IF kind IN ('adapter','retention') THEN
   SELECT consent.id INTO replay_consent_id FROM public.canonical_external_labor_import_consents consent
    WHERE consent.organization_id=org AND consent.source_key=source_value AND consent.created_at<=(replay_value->>'created_at')::timestamptz
    ORDER BY consent.revision DESC LIMIT 1;
   IF replay_consent_id IS NULL OR replay_consent_id IS DISTINCT FROM consent_row.id THEN
    RAISE EXCEPTION 'Source permission changed' USING ERRCODE='40001',CONSTRAINT='external_labor_retired_operation_replay';
   END IF;
  END IF;
  RETURN jsonb_build_object(kind,public.canonical_external_labor_operation_projection(kind,replay_value),'replayed',TRUE);
 END IF;
 IF kind='adapter' THEN SELECT to_jsonb(item) INTO current_value FROM (SELECT * FROM public.canonical_external_labor_adapter_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item;
 ELSIF kind='retention' THEN SELECT to_jsonb(item) INTO current_value FROM (SELECT * FROM public.canonical_external_labor_retention_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item;
 ELSE SELECT to_jsonb(item) INTO current_value FROM (SELECT * FROM public.canonical_external_labor_deletion_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item; END IF;
 IF COALESCE((body->>'expectedRevision')::bigint,0)<>COALESCE((current_value->>'revision')::bigint,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_value->>'canonical_digest'),'none') THEN RAISE EXCEPTION 'Source operation changed' USING ERRCODE='40001'; END IF;
 previous:=(current_value->>'id')::uuid; revision_value:=COALESCE((current_value->>'revision')::bigint,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'kind',kind,'revision',revision_value,'previousId',previous,'actorUserId',actor,'body',body,'requestDigest',request_hash));
 IF kind='adapter' THEN
  IF body->>'action' IN ('connect','resume') AND consent_row.action IS DISTINCT FROM 'grant' THEN
   RAISE EXCEPTION 'Current source permission is required before connecting' USING ERRCODE='40001',CONSTRAINT='external_labor_consent_blocks_adapter';
  END IF;
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','adapterKind','cadence','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE
   OR body->>'action' NOT IN ('connect','pause','resume','disconnect') OR body->>'adapterKind' NOT IN ('csv','provider_api') OR body->>'cadence' NOT IN ('manual','hourly','daily')
   THEN RAISE EXCEPTION 'Adapter operation invalid' USING ERRCODE='22023'; END IF;
  IF (body->>'action'='connect' AND current_value->>'action' IS NOT NULL AND current_value->>'action'<>'disconnect') OR (body->>'action'='pause' AND current_value->>'action' NOT IN ('connect','resume')) OR (body->>'action'='resume' AND current_value->>'action'<>'pause') OR (body->>'action'='disconnect' AND current_value->>'action' NOT IN ('connect','pause','resume')) THEN RAISE EXCEPTION 'Adapter transition invalid' USING ERRCODE='22023'; END IF;
  IF body->>'action'<>'connect' AND (body->>'adapterKind' IS DISTINCT FROM current_value->>'adapter_kind' OR body->>'cadence' IS DISTINCT FROM current_value->>'cadence') THEN RAISE EXCEPTION 'Adapter identity changed during lifecycle transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_labor_adapter_revisions(organization_id,source_key,revision,previous_id,action,adapter_kind,cadence,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,source_value,revision_value,previous,body->>'action',body->>'adapterKind',body->>'cadence',actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_labor_adapter_revisions.*) INTO inserted;
 ELSIF kind='retention' THEN
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','retentionDays','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE OR body->>'action' NOT IN ('set','disable') OR (body->>'action'='set' AND ((body->>'retentionDays')!~'^[0-9]+$' OR (body->>'retentionDays')::integer NOT BETWEEN 30 AND 3650)) OR (body->>'action'='disable' AND body->'retentionDays'<>'null'::jsonb) THEN RAISE EXCEPTION 'Retention operation invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_labor_retention_revisions(organization_id,source_key,revision,previous_id,action,retention_days,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,source_value,revision_value,previous,body->>'action',CASE WHEN body->>'action'='set' THEN (body->>'retentionDays')::integer END,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_labor_retention_revisions.*) INTO inserted;
 ELSE
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE OR body->>'action' NOT IN ('request','cancel') OR (body->>'action'='request' AND current_value->>'action'='request') OR (body->>'action'='cancel' AND current_value->>'action' IS DISTINCT FROM 'request') THEN RAISE EXCEPTION 'Deletion operation invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_labor_deletion_revisions(organization_id,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,source_value,revision_value,previous,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_labor_deletion_revisions.*) INTO inserted;
  IF body->>'action'='request' THEN
   SELECT * INTO consent_row FROM public.canonical_external_labor_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
   IF consent_row.id IS NOT NULL AND consent_row.action='grant' THEN
    revoke_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'revision',consent_row.revision+1,'previousId',consent_row.id,'action','revoke','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope','["external_labor_time_normalized_v1"]'::jsonb,'consentVersion','m25-external-labor-import-consent-v1','reason','Source deletion requested; new imports and derived reads are blocked.','requestDigest',request_hash));
    INSERT INTO public.canonical_external_labor_import_consents(organization_id,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
    VALUES(org,source_value,consent_row.revision+1,consent_row.id,'revoke',actor,(authority->>'membershipId')::uuid,session_value,'["external_labor_time_normalized_v1"]'::jsonb,'m25-external-labor-import-consent-v1','Source deletion requested; new imports and derived reads are blocked.',encode(sha256(convert_to(key_value||':consent-revoke','UTF8')),'hex'),request_hash,revoke_digest);
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object(kind,public.canonical_external_labor_operation_projection(kind,inserted),'replayed',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_external_labor_import_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_operation_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
