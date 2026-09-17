-- Mission 25 Part 11G: material, inventory, purchasing and vendor-cost source adapter and cleanup operations.
-- Source operations remain tenant private, resumable and advisory. They do not
-- apply learned values to estimates, schedules, payroll or company policy.

CREATE TABLE public.canonical_external_material_adapter_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('connect','pause','resume','disconnect')),
 adapter_kind TEXT NOT NULL CHECK(adapter_kind IN ('csv','provider_api')), cadence TEXT NOT NULL CHECK(cadence IN ('manual','hourly','daily')),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id) REFERENCES public.canonical_external_material_adapter_revisions(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_material_retention_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('set','disable')), retention_days INTEGER CHECK(retention_days BETWEEN 30 AND 3650),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id) REFERENCES public.canonical_external_material_retention_revisions(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((action='set' AND retention_days IS NOT NULL) OR (action='disable' AND retention_days IS NULL)),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_material_deletion_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('request','cancel')), actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id) REFERENCES public.canonical_external_material_deletion_revisions(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_material_hold_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('place','release')), hold_kind TEXT NOT NULL CHECK(hold_kind IN ('legal','audit')),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id) REFERENCES public.canonical_external_material_hold_revisions(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

-- This row is coordination state, not evidence authority. Every lifecycle write updates it
-- after taking the same advisory lock so a waiter with an older SERIALIZABLE snapshot
-- fails and retries instead of acting on authority committed while it waited.
CREATE TABLE public.canonical_external_material_lifecycle_gates (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 epoch BIGINT NOT NULL CHECK(epoch BETWEEN 1 AND 9223372036854775807),
 touched_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,source_key)
);

CREATE TABLE public.canonical_external_material_cleanup_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), operation TEXT NOT NULL CHECK(operation IN ('retention','deletion')),
 sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000), previous_run_id UUID, authority_revision BIGINT NOT NULL CHECK(authority_revision BETWEEN 1 AND 10000),
 authority_digest CHAR(64) NOT NULL CHECK(authority_digest~'^[0-9a-f]{64}$'), cursor_before TEXT, cursor_after TEXT,
 complete BOOLEAN NOT NULL, tombstoned_count INTEGER NOT NULL CHECK(tombstoned_count BETWEEN 0 AND 100),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,operation,sequence), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_run_id) REFERENCES public.canonical_external_material_cleanup_runs(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((sequence=1 AND previous_run_id IS NULL) OR sequence>1),
 CHECK((complete AND cursor_after IS NULL) OR (NOT complete AND cursor_after IS NOT NULL))
);

ALTER TABLE public.canonical_external_material_import_records ADD COLUMN cleanup_run_id UUID;
ALTER TABLE public.canonical_external_material_import_records ADD CONSTRAINT canonical_external_material_import_record_cleanup_fk
 FOREIGN KEY(organization_id,source_key,cleanup_run_id) REFERENCES public.canonical_external_material_cleanup_runs(organization_id,source_key,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER canonical_external_material_adapter_revisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_material_adapter_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_material_retention_revisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_material_retention_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_material_deletion_revisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_material_deletion_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_material_hold_revisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_material_hold_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_material_cleanup_runs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_material_cleanup_runs FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_external_material_operation_projection(kind TEXT,value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('kind',kind,'id',value->>'id','revision',(value->>'revision')::bigint,
  'action',value->>'action','adapterKind',value->>'adapter_kind','cadence',value->>'cadence',
  'holdKind',value->>'hold_kind',
  'retentionDays',(value->>'retention_days')::integer,
  'digest',rtrim(value->>'canonical_digest'),'createdAt',value->>'created_at'))
$$;

CREATE FUNCTION public.canonical_external_material_cleanup_projection(value public.canonical_external_material_cleanup_runs)
RETURNS JSONB LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'operation',value.operation,'sequence',value.sequence,
  'cursorAfter',value.cursor_after,'complete',value.complete,'tombstonedCount',value.tombstoned_count,
  'digest',rtrim(value.canonical_digest))
$$;

CREATE FUNCTION public.canonical_external_material_lifecycle_lock(org UUID,source_value TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-material-lifecycle:'||source_value,0));
 INSERT INTO public.canonical_external_material_lifecycle_gates(organization_id,source_key,epoch)
 VALUES(org,source_value,1)
 ON CONFLICT(organization_id,source_key) DO UPDATE
 SET epoch=canonical_external_material_lifecycle_gates.epoch+1,touched_at=transaction_timestamp();
END
$$;

CREATE FUNCTION public.canonical_external_material_operation_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,source_value TEXT,kind TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_value JSONB; replay_value JSONB; previous UUID; revision_value BIGINT; key_hash TEXT; request_hash TEXT; digest_value TEXT; inserted JSONB;
 consent_row public.canonical_external_material_import_consents%ROWTYPE; revoke_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Source operations restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR kind NOT IN ('adapter','retention','deletion') OR jsonb_typeof(body) IS DISTINCT FROM 'object'
  OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$'
  OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none'))
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Source operation invalid' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_external_material_lifecycle_lock(org,source_value);
 IF NOT EXISTS(SELECT 1 FROM public.canonical_external_material_import_consents WHERE organization_id=org AND source_key=source_value) THEN RAISE EXCEPTION 'Source operation requires a recorded source' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'kind',kind,'body',body));
 IF kind='adapter' THEN SELECT to_jsonb(item) INTO replay_value FROM (SELECT * FROM public.canonical_external_material_adapter_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) item;
 ELSIF kind='retention' THEN SELECT to_jsonb(item) INTO replay_value FROM (SELECT * FROM public.canonical_external_material_retention_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) item;
 ELSE SELECT to_jsonb(item) INTO replay_value FROM (SELECT * FROM public.canonical_external_material_deletion_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) item; END IF;
 IF replay_value IS NOT NULL THEN IF rtrim(replay_value->>'request_digest')<>request_hash THEN RAISE EXCEPTION 'Source operation key conflict' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object(kind,public.canonical_external_material_operation_projection(kind,replay_value),'replayed',TRUE); END IF;
 IF kind='adapter' THEN SELECT to_jsonb(item) INTO current_value FROM (SELECT * FROM public.canonical_external_material_adapter_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item;
 ELSIF kind='retention' THEN SELECT to_jsonb(item) INTO current_value FROM (SELECT * FROM public.canonical_external_material_retention_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item;
 ELSE SELECT to_jsonb(item) INTO current_value FROM (SELECT * FROM public.canonical_external_material_deletion_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item; END IF;
 IF COALESCE((body->>'expectedRevision')::bigint,0)<>COALESCE((current_value->>'revision')::bigint,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_value->>'canonical_digest'),'none') THEN RAISE EXCEPTION 'Source operation changed' USING ERRCODE='40001'; END IF;
 previous:=(current_value->>'id')::uuid; revision_value:=COALESCE((current_value->>'revision')::bigint,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'kind',kind,'revision',revision_value,'previousId',previous,'actorUserId',actor,'body',body,'requestDigest',request_hash));
 IF kind='adapter' THEN
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','adapterKind','cadence','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE
   OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR NOT (body->>'action'=ANY(ARRAY['connect','pause','resume','disconnect']))
   OR jsonb_typeof(body->'adapterKind') IS DISTINCT FROM 'string' OR NOT (body->>'adapterKind'=ANY(ARRAY['csv','provider_api']))
   OR jsonb_typeof(body->'cadence') IS DISTINCT FROM 'string' OR NOT (body->>'cadence'=ANY(ARRAY['manual','hourly','daily']))
   THEN RAISE EXCEPTION 'Adapter operation invalid' USING ERRCODE='22023'; END IF;
  IF (body->>'action'='connect' AND current_value->>'action' IS NOT NULL AND current_value->>'action'<>'disconnect') OR (body->>'action'='pause' AND current_value->>'action' NOT IN ('connect','resume')) OR (body->>'action'='resume' AND current_value->>'action'<>'pause') OR (body->>'action'='disconnect' AND current_value->>'action' NOT IN ('connect','pause','resume')) THEN RAISE EXCEPTION 'Adapter transition invalid' USING ERRCODE='22023'; END IF;
  IF body->>'action'<>'connect' AND (body->>'adapterKind' IS DISTINCT FROM current_value->>'adapter_kind' OR body->>'cadence' IS DISTINCT FROM current_value->>'cadence') THEN RAISE EXCEPTION 'Adapter identity changed during lifecycle transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_material_adapter_revisions(organization_id,source_key,revision,previous_id,action,adapter_kind,cadence,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,source_value,revision_value,previous,body->>'action',body->>'adapterKind',body->>'cadence',actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_material_adapter_revisions.*) INTO inserted;
 ELSIF kind='retention' THEN
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','retentionDays','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE
   OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR NOT (body->>'action'=ANY(ARRAY['set','disable']))
   OR (body->>'action'='set' AND (jsonb_typeof(body->'retentionDays') IS DISTINCT FROM 'number' OR (body->>'retentionDays')!~'^[0-9]+$' OR (body->>'retentionDays')::integer NOT BETWEEN 30 AND 3650))
   OR (body->>'action'='disable' AND body->'retentionDays' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'Retention operation invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_material_retention_revisions(organization_id,source_key,revision,previous_id,action,retention_days,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,source_value,revision_value,previous,body->>'action',CASE WHEN body->>'action'='set' THEN (body->>'retentionDays')::integer END,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_material_retention_revisions.*) INTO inserted;
 ELSE
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE
   OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR NOT (body->>'action'=ANY(ARRAY['request','cancel']))
   OR (body->>'action'='request' AND current_value->>'action'='request') OR (body->>'action'='cancel' AND current_value->>'action' IS DISTINCT FROM 'request') THEN RAISE EXCEPTION 'Deletion operation invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_material_deletion_revisions(organization_id,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,source_value,revision_value,previous,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_material_deletion_revisions.*) INTO inserted;
  IF body->>'action'='request' THEN
   SELECT * INTO consent_row FROM public.canonical_external_material_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
   IF consent_row.id IS NOT NULL AND consent_row.action='grant' THEN
    revoke_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'revision',consent_row.revision+1,'previousId',consent_row.id,'action','revoke','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope','["external_material_actual_normalized_v1"]'::jsonb,'consentVersion','m25-external-material-import-consent-v1','reason','Source deletion requested; new imports and derived reads are blocked.','requestDigest',request_hash));
    INSERT INTO public.canonical_external_material_import_consents(organization_id,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
    VALUES(org,source_value,consent_row.revision+1,consent_row.id,'revoke',actor,(authority->>'membershipId')::uuid,session_value,'["external_material_actual_normalized_v1"]'::jsonb,'m25-external-material-import-consent-v1','Source deletion requested; new imports and derived reads are blocked.',encode(sha256(convert_to(key_value||':consent-revoke','UTF8')),'hex'),request_hash,revoke_digest);
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object(kind,public.canonical_external_material_operation_projection(kind,inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_material_adapter_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_external_material_operation_mutate(org,actor,role_value,session_value,csrf,key_value,source_value,'adapter',body) $$;
CREATE FUNCTION public.canonical_external_material_retention_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_external_material_operation_mutate(org,actor,role_value,session_value,csrf,key_value,source_value,'retention',body) $$;
CREATE FUNCTION public.canonical_external_material_deletion_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_external_material_operation_mutate(org,actor,role_value,session_value,csrf,key_value,source_value,'deletion',body) $$;

CREATE FUNCTION public.canonical_external_material_hold_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_external_material_hold_revisions%ROWTYPE;
 replay_row public.canonical_external_material_hold_revisions%ROWTYPE; key_hash TEXT; request_hash TEXT;
 digest_value TEXT; next_revision BIGINT; inserted public.canonical_external_material_hold_revisions%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Source holds restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','holdKind','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE
  OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR body->>'action' NOT IN ('place','release')
  OR jsonb_typeof(body->'holdKind') IS DISTINCT FROM 'string' OR body->>'holdKind' NOT IN ('legal','audit')
  OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$'
  OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none')) OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'Source hold invalid' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_external_material_import_consents WHERE organization_id=org AND source_key=source_value)
 THEN RAISE EXCEPTION 'Source hold requires a recorded source' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_external_material_lifecycle_lock(org,source_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'body',body));
 SELECT * INTO replay_row FROM public.canonical_external_material_hold_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Source hold key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('hold',public.canonical_external_material_operation_projection('hold',to_jsonb(replay_row)),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_external_material_hold_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF COALESCE(current_row.revision,0)<>(body->>'expectedRevision')::bigint OR COALESCE(rtrim(current_row.canonical_digest),'none') IS DISTINCT FROM body->>'expectedDigest'
 THEN RAISE EXCEPTION 'Source hold changed' USING ERRCODE='40001'; END IF;
 IF (body->>'action'='place' AND current_row.action='place') OR (body->>'action'='release' AND (current_row.action IS DISTINCT FROM 'place' OR current_row.hold_kind IS DISTINCT FROM body->>'holdKind'))
 THEN RAISE EXCEPTION 'Source hold transition invalid' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'revision',next_revision,
  'previousId',current_row.id,'action',body->>'action','holdKind',body->>'holdKind','actorUserId',actor,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_material_hold_revisions(organization_id,source_key,revision,previous_id,action,hold_kind,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,next_revision,current_row.id,body->>'action',body->>'holdKind',actor,(authority->>'membershipId')::uuid,
  session_value,key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('hold',public.canonical_external_material_operation_projection('hold',to_jsonb(inserted)),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_material_operations_read(org UUID,actor UUID,role_value TEXT,session_value UUID,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adapter JSONB; retention JSONB; deletion JSONB; hold_value JSONB; checkpoints JSONB; active_total BIGINT; retention_total BIGINT:=0;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Source operations restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'Source invalid' USING ERRCODE='22023'; END IF;
 SELECT public.canonical_external_material_operation_projection('adapter',to_jsonb(item)) INTO adapter FROM (SELECT * FROM public.canonical_external_material_adapter_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1) item;
 SELECT public.canonical_external_material_operation_projection('retention',to_jsonb(item)) INTO retention FROM (SELECT * FROM public.canonical_external_material_retention_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1) item;
 SELECT public.canonical_external_material_operation_projection('deletion',to_jsonb(item)) INTO deletion FROM (SELECT * FROM public.canonical_external_material_deletion_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1) item;
 SELECT public.canonical_external_material_operation_projection('hold',to_jsonb(item)) INTO hold_value FROM (SELECT * FROM public.canonical_external_material_hold_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1) item;
 WITH imported AS (
  SELECT DISTINCT ON (mode) mode,sequence,cursor_after,complete,created_at FROM public.canonical_external_material_import_runs WHERE organization_id=org AND source_key=source_value ORDER BY mode,sequence DESC
 ), cleanup AS (
  SELECT DISTINCT ON (operation) operation||'_cleanup' mode,sequence,cursor_after,complete,created_at
  FROM public.canonical_external_material_cleanup_runs
  WHERE organization_id=org AND source_key=source_value AND (
   (operation='retention' AND authority_revision=(retention->>'revision')::bigint AND rtrim(authority_digest)=retention->>'digest') OR
   (operation='deletion' AND authority_revision=(deletion->>'revision')::bigint AND rtrim(authority_digest)=deletion->>'digest'))
  ORDER BY operation,sequence DESC
 ), combined AS (SELECT * FROM imported UNION ALL SELECT * FROM cleanup)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('mode',mode,'sequence',sequence,'cursorAfter',cursor_after,'complete',complete,'createdAt',created_at) ORDER BY mode),'[]'::jsonb) INTO checkpoints FROM combined;
 WITH current_records AS (SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_material_import_records WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC) SELECT count(*) INTO active_total FROM current_records WHERE state='active';
 IF retention->>'action'='set' THEN WITH current_records AS (SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_material_import_records WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC) SELECT count(*) INTO retention_total FROM current_records WHERE state='active' AND source_updated_at<transaction_timestamp()-make_interval(days=>(retention->>'retentionDays')::integer); END IF;
 RETURN jsonb_build_object('sourceKey',source_value,'adapter',adapter,'retention',retention,'deletion',deletion,'hold',hold_value,
  'cleanupAllowed',COALESCE(hold_value->>'action','release')<>'place','checkpoints',checkpoints,'activeRecordTotal',active_total,
  'retentionEligibleTotal',retention_total,'deletionComplete',deletion->>'action'='request' AND active_total=0,
  'boundary','Cleanup appends minimized tombstones and invalidates dependent advice. An active legal or audit hold blocks cleanup. It does not rewrite historical estimates or apply policy.');
END $$;

CREATE FUNCTION public.canonical_external_material_cleanup_execute(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; authority_value JSONB; previous_run public.canonical_external_material_cleanup_runs%ROWTYPE; replay_run public.canonical_external_material_cleanup_runs%ROWTYPE;
 current_hold public.canonical_external_material_hold_revisions%ROWTYPE; key_hash TEXT; request_hash TEXT; run_id UUID:=gen_random_uuid(); digest_value TEXT; sequence_value BIGINT; selected_count INTEGER; has_more BOOLEAN; next_cursor TEXT; record_row public.canonical_external_material_import_records%ROWTYPE; record_digest TEXT; operation_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Cleanup restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); operation_value:=body->>'operation';
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR jsonb_typeof(body->'operation') IS DISTINCT FROM 'string'
  OR NOT (operation_value=ANY(ARRAY['retention','deletion']))
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['operation','expectedRevision','expectedDigest','cursorBefore','limit','confirmed']) IS NOT TRUE
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^([1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR body->>'expectedDigest'!~'^[0-9a-f]{64}$'
  OR NOT (body->'cursorBefore'='null'::jsonb OR (jsonb_typeof(body->'cursorBefore')='string' AND char_length(body->>'cursorBefore') BETWEEN 1 AND 128 AND body->>'cursorBefore'~'^[!-~]+$'))
  OR jsonb_typeof(body->'limit') IS DISTINCT FROM 'number' OR (body->>'limit')!~'^[0-9]+$' OR (body->>'limit')::integer NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Cleanup invalid' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_external_material_lifecycle_lock(org,source_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'body',body));
 SELECT * INTO replay_run FROM public.canonical_external_material_cleanup_runs WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF rtrim(replay_run.request_digest)<>request_hash THEN RAISE EXCEPTION 'Cleanup key conflict' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object('run',public.canonical_external_material_cleanup_projection(replay_run),'replayed',TRUE); END IF;
 IF operation_value='retention' THEN SELECT to_jsonb(item) INTO authority_value FROM (SELECT * FROM public.canonical_external_material_retention_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item; ELSE SELECT to_jsonb(item) INTO authority_value FROM (SELECT * FROM public.canonical_external_material_deletion_revisions WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) item; END IF;
 IF COALESCE((authority_value->>'revision')::bigint,0)<>(body->>'expectedRevision')::bigint OR COALESCE(rtrim(authority_value->>'canonical_digest'),'none') IS DISTINCT FROM body->>'expectedDigest' OR (operation_value='retention' AND authority_value->>'action'<>'set') OR (operation_value='deletion' AND authority_value->>'action'<>'request') THEN RAISE EXCEPTION 'Cleanup authority changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO previous_run FROM public.canonical_external_material_cleanup_runs WHERE organization_id=org AND source_key=source_value AND operation=operation_value
  AND authority_revision=(authority_value->>'revision')::bigint AND rtrim(authority_digest)=rtrim(authority_value->>'canonical_digest') ORDER BY sequence DESC LIMIT 1 FOR UPDATE;
 IF previous_run.id IS NOT NULL AND NOT previous_run.complete AND previous_run.cursor_after IS DISTINCT FROM body->>'cursorBefore' THEN RAISE EXCEPTION 'Cleanup cursor changed' USING ERRCODE='40001'; END IF;
 IF (previous_run.id IS NULL OR previous_run.complete) AND body->'cursorBefore'<>'null'::jsonb THEN RAISE EXCEPTION 'Cleanup cursor changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO current_hold FROM public.canonical_external_material_hold_revisions
  WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF current_hold.action='place'
 THEN RAISE EXCEPTION 'Source cleanup is blocked by an active hold' USING ERRCODE='40001',CONSTRAINT='external_material_cleanup_active_hold'; END IF;
 CREATE TEMP TABLE selected_cleanup_records ON COMMIT DROP AS WITH current_records AS (SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_material_import_records WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC) SELECT * FROM current_records WHERE state='active' AND (body->'cursorBefore'='null'::jsonb OR external_record_id>body->>'cursorBefore') AND (operation_value='deletion' OR source_updated_at<transaction_timestamp()-make_interval(days=>(authority_value->>'retention_days')::integer)) ORDER BY external_record_id LIMIT (body->>'limit')::integer+1;
 SELECT count(*) INTO selected_count FROM selected_cleanup_records; has_more:=selected_count>(body->>'limit')::integer;
 DELETE FROM selected_cleanup_records WHERE external_record_id=(SELECT max(external_record_id) FROM selected_cleanup_records) AND has_more; SELECT count(*),max(external_record_id) INTO selected_count,next_cursor FROM selected_cleanup_records; IF NOT has_more THEN next_cursor:=NULL; END IF;
 SELECT COALESCE(max(sequence),0)+1 INTO sequence_value FROM public.canonical_external_material_cleanup_runs WHERE organization_id=org AND source_key=source_value AND operation=operation_value;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('id',run_id,'organizationId',org,'sourceKey',source_value,'operation',operation_value,'sequence',sequence_value,'previousRunId',previous_run.id,'authorityRevision',(authority_value->>'revision')::bigint,'authorityDigest',rtrim(authority_value->>'canonical_digest'),'cursorBefore',body->>'cursorBefore','cursorAfter',next_cursor,'complete',NOT has_more,'tombstonedCount',selected_count,'actorUserId',actor,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_material_cleanup_runs(id,organization_id,source_key,operation,sequence,previous_run_id,authority_revision,authority_digest,cursor_before,cursor_after,complete,tombstoned_count,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest) VALUES(run_id,org,source_value,operation_value,sequence_value,previous_run.id,(authority_value->>'revision')::bigint,rtrim(authority_value->>'canonical_digest'),body->>'cursorBefore',next_cursor,NOT has_more,selected_count,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value);
 FOR record_row IN SELECT * FROM selected_cleanup_records ORDER BY external_record_id LOOP
 record_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
   'externalRecordId',record_row.external_record_id,'externalVersion',record_row.external_version+1,'state','tombstone',
   'recordType',NULL,'jobReference',NULL,'materialReference',NULL,'vendorReference',NULL,'locationReference',NULL,
   'occurredAt',NULL,'timeZone',NULL,'movementKind',NULL,'normalizedEvidence',NULL,'evidenceClass',NULL,
   'providerEvidenceDigest',NULL,'sourceUpdatedAt',transaction_timestamp(),'cleanupRunId',run_id));
  INSERT INTO public.canonical_external_material_import_records(organization_id,source_key,external_record_id,revision,
   previous_id,external_version,state,record_type,job_reference,material_reference,vendor_reference,location_reference,occurred_at,
   time_zone,movement_kind,normalized_evidence,evidence_class,provider_evidence_digest,source_updated_at,
   source_digest,import_run_id,cleanup_run_id)
  VALUES(org,source_value,record_row.external_record_id,record_row.revision+1,record_row.id,
   record_row.external_version+1,'tombstone',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
   transaction_timestamp(),record_digest,record_row.import_run_id,run_id);
 END LOOP;
 SELECT * INTO replay_run FROM public.canonical_external_material_cleanup_runs WHERE id=run_id;
 RETURN jsonb_build_object('run',public.canonical_external_material_cleanup_projection(replay_run),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_material_import_deletion_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE action_value TEXT;
BEGIN SELECT action INTO action_value FROM public.canonical_external_material_deletion_revisions WHERE organization_id=NEW.organization_id AND source_key=NEW.source_key ORDER BY revision DESC LIMIT 1; IF action_value='request' THEN RAISE EXCEPTION 'Source deletion blocks imports' USING ERRCODE='40001'; END IF; RETURN NEW; END $$;
CREATE TRIGGER canonical_external_material_import_deletion_guard BEFORE INSERT ON public.canonical_external_material_import_runs FOR EACH ROW EXECUTE FUNCTION public.canonical_external_material_import_deletion_guard();

CREATE FUNCTION public.canonical_external_material_consent_deletion_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE action_value TEXT;
BEGIN
 IF NEW.action='grant' THEN
  SELECT action INTO action_value FROM public.canonical_external_material_deletion_revisions
   WHERE organization_id=NEW.organization_id AND source_key=NEW.source_key ORDER BY revision DESC LIMIT 1;
  IF action_value='request' THEN
   RAISE EXCEPTION 'Cancel source deletion before starting a new consent period'
    USING ERRCODE='40001',CONSTRAINT='external_material_deletion_blocks_consent_grant';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_external_material_consent_deletion_guard BEFORE INSERT ON public.canonical_external_material_import_consents
 FOR EACH ROW EXECUTE FUNCTION public.canonical_external_material_consent_deletion_guard();

REVOKE ALL ON TABLE public.canonical_external_material_adapter_revisions,public.canonical_external_material_retention_revisions,public.canonical_external_material_deletion_revisions,public.canonical_external_material_hold_revisions,public.canonical_external_material_lifecycle_gates,public.canonical_external_material_cleanup_runs FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_operation_projection(TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_cleanup_projection(public.canonical_external_material_cleanup_runs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_lifecycle_lock(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_operation_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_adapter_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_retention_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_deletion_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_hold_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_operations_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_cleanup_execute(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_import_deletion_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_material_consent_deletion_guard() FROM PUBLIC;
