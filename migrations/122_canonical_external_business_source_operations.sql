-- Mission 25 Part 12J: lifecycle, retention, holds and bounded cleanup for
-- provider-neutral CRM/field-service, project/change-order, communication and
-- external financial evidence. This authority stores no provider credentials,
-- connects to no provider and never changes operational or financial truth.

CREATE TABLE public.canonical_external_business_adapter_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_class TEXT NOT NULL CHECK(source_class IN ('crm_field_service','project_change_order','communication','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('connect','pause','resume','disconnect')),
 adapter_kind TEXT NOT NULL CHECK(adapter_kind IN ('file_import','provider_api')), cadence TEXT NOT NULL CHECK(cadence IN ('manual','hourly','daily')),
 source_consent_id UUID NOT NULL, source_consent_revision BIGINT NOT NULL CHECK(source_consent_revision BETWEEN 1 AND 10000),
 source_consent_digest CHAR(64) NOT NULL CHECK(source_consent_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_class,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,source_class,source_key,previous_id) REFERENCES public.canonical_external_business_adapter_revisions(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_business_retention_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_class TEXT NOT NULL CHECK(source_class IN ('crm_field_service','project_change_order','communication','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('set','disable')), retention_days INTEGER CHECK(retention_days BETWEEN 30 AND 3650),
 source_consent_id UUID NOT NULL, source_consent_revision BIGINT NOT NULL CHECK(source_consent_revision BETWEEN 1 AND 10000),
 source_consent_digest CHAR(64) NOT NULL CHECK(source_consent_digest~'^[0-9a-f]{64}$'), source_consent_action TEXT NOT NULL CHECK(source_consent_action IN ('grant','revoke')),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_class,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,source_class,source_key,previous_id) REFERENCES public.canonical_external_business_retention_revisions(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 CHECK((action='set' AND retention_days IS NOT NULL) OR (action='disable' AND retention_days IS NULL)),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_business_deletion_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_class TEXT NOT NULL CHECK(source_class IN ('crm_field_service','project_change_order','communication','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('request','cancel')), actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_class,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,source_class,source_key,previous_id) REFERENCES public.canonical_external_business_deletion_revisions(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_business_hold_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_class TEXT NOT NULL CHECK(source_class IN ('crm_field_service','project_change_order','communication','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('place','release')), hold_kind TEXT NOT NULL CHECK(hold_kind IN ('legal','audit')),
 source_consent_id UUID NOT NULL, source_consent_revision BIGINT NOT NULL CHECK(source_consent_revision BETWEEN 1 AND 10000),
 source_consent_digest CHAR(64) NOT NULL CHECK(source_consent_digest~'^[0-9a-f]{64}$'), source_consent_action TEXT NOT NULL CHECK(source_consent_action IN ('grant','revoke')),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_class,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,source_class,source_key,previous_id) REFERENCES public.canonical_external_business_hold_revisions(organization_id,source_class,source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_business_lifecycle_gates (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_class TEXT NOT NULL CHECK(source_class IN ('crm_field_service','project_change_order','communication','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), epoch BIGINT NOT NULL CHECK(epoch>0),
 touched_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(), PRIMARY KEY(organization_id,source_class,source_key)
);

CREATE TABLE public.canonical_external_business_request_keys (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT, actor_user_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 operation TEXT NOT NULL CHECK(operation~'^(adapter|retention|deletion|hold|cleanup:(retention|deletion))$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,actor_user_id,request_key_hash)
);

CREATE TABLE public.canonical_external_business_cleanup_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_class TEXT NOT NULL CHECK(source_class IN ('crm_field_service','project_change_order','communication','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), operation TEXT NOT NULL CHECK(operation IN ('retention','deletion')),
 sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000), previous_run_id UUID,
 authority_revision BIGINT NOT NULL CHECK(authority_revision BETWEEN 1 AND 10000), authority_digest CHAR(64) NOT NULL CHECK(authority_digest~'^[0-9a-f]{64}$'),
 cursor_before TEXT, cursor_after TEXT, complete BOOLEAN NOT NULL, tombstoned_count INTEGER NOT NULL CHECK(tombstoned_count BETWEEN 0 AND 100),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_class,source_key,operation,sequence), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(id),
 FOREIGN KEY(previous_run_id) REFERENCES public.canonical_external_business_cleanup_runs(id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 CHECK((sequence=1 AND previous_run_id IS NULL) OR (sequence>1 AND previous_run_id IS NOT NULL)), CHECK((complete AND cursor_after IS NULL) OR (NOT complete AND cursor_after IS NOT NULL))
);

ALTER TABLE public.canonical_external_crm_field_service_import_records ADD COLUMN cleanup_run_id UUID REFERENCES public.canonical_external_business_cleanup_runs(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.canonical_external_project_change_order_import_records ADD COLUMN cleanup_run_id UUID REFERENCES public.canonical_external_business_cleanup_runs(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.canonical_external_communication_import_records ADD COLUMN cleanup_run_id UUID REFERENCES public.canonical_external_business_cleanup_runs(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.canonical_external_financial_import_records ADD COLUMN cleanup_run_id UUID REFERENCES public.canonical_external_business_cleanup_runs(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER canonical_external_business_adapter_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_business_adapter_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_business_retention_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_business_retention_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_business_deletion_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_business_deletion_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_business_hold_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_business_hold_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_business_cleanup_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_business_cleanup_runs FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_business_request_keys_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_business_request_keys FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_external_business_source_prefix(class_value TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT CASE class_value WHEN 'crm_field_service' THEN 'canonical_external_crm_field_service' WHEN 'project_change_order' THEN 'canonical_external_project_change_order' WHEN 'communication' THEN 'canonical_external_communication' WHEN 'financial' THEN 'canonical_external_financial' END
$$;

CREATE FUNCTION public.canonical_external_business_lifecycle_lock(org UUID,class_value TEXT,source_value TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE import_lock TEXT;
BEGIN
 IF class_value NOT IN ('crm_field_service','project_change_order','communication','financial') THEN RAISE EXCEPTION 'Source class invalid' USING ERRCODE='22023'; END IF;
 import_lock:=CASE class_value WHEN 'crm_field_service' THEN 'external-crm-field-service-import:' WHEN 'project_change_order' THEN 'external-project-change-order-import:' WHEN 'communication' THEN 'external-communication-import:' ELSE 'external-financial-import:' END;
 -- Match the accepted import lock first, then use one lifecycle lock for every hold,
 -- deletion, cleanup, consent and import mutation on this source.
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||import_lock||source_value,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-business-lifecycle:'||class_value||':'||source_value,0));
 INSERT INTO public.canonical_external_business_lifecycle_gates(organization_id,source_class,source_key,epoch)
 VALUES(org,class_value,source_value,1) ON CONFLICT(organization_id,source_class,source_key) DO UPDATE
 SET epoch=canonical_external_business_lifecycle_gates.epoch+1,touched_at=transaction_timestamp();
END $$;

CREATE FUNCTION public.canonical_external_business_request_claim(org UUID,actor UUID,key_hash TEXT,request_hash TEXT,operation_value TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE existing public.canonical_external_business_request_keys%ROWTYPE;
BEGIN
 SELECT * INTO existing FROM public.canonical_external_business_request_keys WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(existing.request_digest)<>request_hash OR existing.operation<>operation_value THEN RAISE EXCEPTION 'Source operation key conflict' USING ERRCODE='23505'; END IF;
  RETURN;
 END IF;
 INSERT INTO public.canonical_external_business_request_keys(organization_id,actor_user_id,request_key_hash,request_digest,operation) VALUES(org,actor,key_hash,request_hash,operation_value);
END $$;

CREATE FUNCTION public.canonical_external_business_operation_projection(kind TEXT,value JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('kind',kind,'id',value->>'id','revision',(value->>'revision')::bigint,'action',value->>'action',
  'adapterKind',value->>'adapter_kind','cadence',value->>'cadence','holdKind',value->>'hold_kind',
  'retentionDays',(value->>'retention_days')::integer,'digest',rtrim(value->>'canonical_digest'),'createdAt',value->>'created_at'))
$$;

CREATE FUNCTION public.canonical_external_business_cleanup_projection(value public.canonical_external_business_cleanup_runs) RETURNS JSONB LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',value.id,'operation',value.operation,'sequence',value.sequence,'cursorAfter',value.cursor_after,
  'complete',value.complete,'tombstonedCount',value.tombstoned_count,'digest',rtrim(value.canonical_digest))
$$;

CREATE FUNCTION public.canonical_external_business_source_exists(org UUID,class_value TEXT,source_value TEXT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE found_value BOOLEAN; prefix_value TEXT:=public.canonical_external_business_source_prefix(class_value);
BEGIN
 IF prefix_value IS NULL THEN RETURN FALSE; END IF;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I_import_consents WHERE organization_id=$1 AND source_key=$2)',prefix_value) INTO found_value USING org,source_value;
 RETURN found_value;
END $$;

CREATE FUNCTION public.canonical_external_business_operation_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,class_value TEXT,source_value TEXT,kind TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_value JSONB; replay_value JSONB; previous UUID; next_revision BIGINT; key_hash TEXT; request_hash TEXT; digest_value TEXT; inserted JSONB;
 prefix_value TEXT; scope_value JSONB; consent_version_value TEXT; consent_row JSONB; revoke_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Source operations restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); prefix_value:=public.canonical_external_business_source_prefix(class_value);
 IF prefix_value IS NULL OR source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR kind NOT IN ('adapter','retention','deletion') OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$'
  OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none')) THEN RAISE EXCEPTION 'Source operation invalid' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_external_business_lifecycle_lock(org,class_value,source_value);
 IF public.canonical_external_business_source_exists(org,class_value,source_value) IS NOT TRUE THEN RAISE EXCEPTION 'Source operation requires a recorded source' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'kind',kind,'body',body));
 PERFORM public.canonical_external_business_request_claim(org,actor,key_hash,request_hash,kind);
 IF kind IN ('adapter','retention') THEN EXECUTE format('SELECT to_jsonb(x) FROM (SELECT * FROM public.%I_import_consents WHERE organization_id=$1 AND source_key=$2 ORDER BY revision DESC LIMIT 1 FOR UPDATE)x',prefix_value) INTO consent_row USING org,source_value; END IF;
 IF kind='adapter' THEN SELECT to_jsonb(x) INTO replay_value FROM (SELECT * FROM public.canonical_external_business_adapter_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) x;
 ELSIF kind='retention' THEN SELECT to_jsonb(x) INTO replay_value FROM (SELECT * FROM public.canonical_external_business_retention_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) x;
 ELSE SELECT to_jsonb(x) INTO replay_value FROM (SELECT * FROM public.canonical_external_business_deletion_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash) x; END IF;
 IF kind='adapter' THEN SELECT to_jsonb(x) INTO current_value FROM (SELECT * FROM public.canonical_external_business_adapter_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) x;
 ELSIF kind='retention' THEN SELECT to_jsonb(x) INTO current_value FROM (SELECT * FROM public.canonical_external_business_retention_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) x;
 ELSE SELECT to_jsonb(x) INTO current_value FROM (SELECT * FROM public.canonical_external_business_deletion_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE) x; END IF;
 IF replay_value IS NOT NULL THEN
  IF rtrim(replay_value->>'request_digest')<>request_hash THEN RAISE EXCEPTION 'Source operation key conflict' USING ERRCODE='23505'; END IF;
  IF current_value->>'id' IS DISTINCT FROM replay_value->>'id' THEN RAISE EXCEPTION 'Source operation changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_operation_replay'; END IF;
  IF kind='adapter' AND (replay_value->>'source_consent_id' IS DISTINCT FROM consent_row->>'id' OR (replay_value->>'source_consent_revision')::bigint IS DISTINCT FROM (consent_row->>'revision')::bigint OR rtrim(replay_value->>'source_consent_digest') IS DISTINCT FROM rtrim(consent_row->>'canonical_digest')) THEN RAISE EXCEPTION 'Source permission changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_adapter_replay'; END IF;
  IF kind='retention' AND (replay_value->>'source_consent_id' IS DISTINCT FROM consent_row->>'id' OR (replay_value->>'source_consent_revision')::bigint IS DISTINCT FROM (consent_row->>'revision')::bigint OR rtrim(replay_value->>'source_consent_digest') IS DISTINCT FROM rtrim(consent_row->>'canonical_digest') OR replay_value->>'source_consent_action' IS DISTINCT FROM consent_row->>'action') THEN RAISE EXCEPTION 'Source permission changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_retention_replay'; END IF;
  IF kind='adapter' AND body->>'action' IN ('connect','resume') AND (SELECT action FROM public.canonical_external_business_deletion_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1)='request' THEN RAISE EXCEPTION 'Cancel source deletion before reconnecting' USING ERRCODE='40001',CONSTRAINT='external_business_deletion_blocks_adapter'; END IF;
  RETURN jsonb_build_object(kind,public.canonical_external_business_operation_projection(kind,replay_value),'replayed',TRUE);
 END IF;
 IF (body->>'expectedRevision')::bigint<>COALESCE((current_value->>'revision')::bigint,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_value->>'canonical_digest'),'none') THEN RAISE EXCEPTION 'Source operation changed' USING ERRCODE='40001'; END IF;
 previous:=(current_value->>'id')::uuid; next_revision:=COALESCE((current_value->>'revision')::bigint,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'kind',kind,'revision',next_revision,'previousId',previous,'sourceConsentId',CASE WHEN kind IN ('adapter','retention') THEN consent_row->>'id' END,'sourceConsentRevision',CASE WHEN kind IN ('adapter','retention') THEN (consent_row->>'revision')::bigint END,'sourceConsentDigest',CASE WHEN kind IN ('adapter','retention') THEN rtrim(consent_row->>'canonical_digest') END,'sourceConsentAction',CASE WHEN kind='retention' THEN consent_row->>'action' END,'actorUserId',actor,'body',body,'requestDigest',request_hash));
 IF kind='adapter' THEN
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','adapterKind','cadence','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE OR body->>'action' NOT IN ('connect','pause','resume','disconnect') OR body->>'adapterKind' NOT IN ('file_import','provider_api') OR body->>'cadence' NOT IN ('manual','hourly','daily') THEN RAISE EXCEPTION 'Adapter operation invalid' USING ERRCODE='22023'; END IF;
  IF body->>'action' IN ('connect','resume') AND (SELECT action FROM public.canonical_external_business_deletion_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1)='request' THEN RAISE EXCEPTION 'Cancel source deletion before reconnecting' USING ERRCODE='40001',CONSTRAINT='external_business_deletion_blocks_adapter'; END IF;
  IF body->>'action' IN ('connect','resume') AND consent_row->>'action' IS DISTINCT FROM 'grant' THEN RAISE EXCEPTION 'Current source permission is required before connecting' USING ERRCODE='40001',CONSTRAINT='external_business_consent_blocks_adapter'; END IF;
  IF (body->>'action'='connect' AND current_value->>'action' IS NOT NULL AND current_value->>'action'<>'disconnect') OR (body->>'action'='pause' AND current_value->>'action' NOT IN ('connect','resume')) OR (body->>'action'='resume' AND current_value->>'action'<>'pause') OR (body->>'action'='disconnect' AND current_value->>'action' NOT IN ('connect','pause','resume')) THEN RAISE EXCEPTION 'Adapter transition invalid' USING ERRCODE='22023'; END IF;
  IF body->>'action'<>'connect' AND (body->>'adapterKind' IS DISTINCT FROM current_value->>'adapter_kind' OR body->>'cadence' IS DISTINCT FROM current_value->>'cadence') THEN RAISE EXCEPTION 'Adapter settings changed during lifecycle transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_business_adapter_revisions(organization_id,source_class,source_key,revision,previous_id,action,adapter_kind,cadence,source_consent_id,source_consent_revision,source_consent_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,class_value,source_value,next_revision,previous,body->>'action',body->>'adapterKind',body->>'cadence',(consent_row->>'id')::uuid,(consent_row->>'revision')::bigint,rtrim(consent_row->>'canonical_digest'),actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_business_adapter_revisions.*) INTO inserted;
 ELSIF kind='retention' THEN
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','retentionDays','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE OR body->>'action' NOT IN ('set','disable') OR (body->>'action'='set' AND (jsonb_typeof(body->'retentionDays') IS DISTINCT FROM 'number' OR (body->>'retentionDays')!~'^[0-9]+$' OR (body->>'retentionDays')::integer NOT BETWEEN 30 AND 3650)) OR (body->>'action'='disable' AND body->'retentionDays' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'Retention operation invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_business_retention_revisions(organization_id,source_class,source_key,revision,previous_id,action,retention_days,source_consent_id,source_consent_revision,source_consent_digest,source_consent_action,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,class_value,source_value,next_revision,previous,body->>'action',CASE WHEN body->>'action'='set' THEN (body->>'retentionDays')::integer END,(consent_row->>'id')::uuid,(consent_row->>'revision')::bigint,rtrim(consent_row->>'canonical_digest'),consent_row->>'action',actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_business_retention_revisions.*) INTO inserted;
 ELSE
  IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE OR body->>'action' NOT IN ('request','cancel') OR (body->>'action'='request' AND current_value->>'action'='request') OR (body->>'action'='cancel' AND current_value->>'action' IS DISTINCT FROM 'request') THEN RAISE EXCEPTION 'Deletion operation invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_external_business_deletion_revisions(organization_id,source_class,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
  VALUES(org,class_value,source_value,next_revision,previous,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING to_jsonb(canonical_external_business_deletion_revisions.*) INTO inserted;
  IF body->>'action'='request' THEN
   EXECUTE format('SELECT to_jsonb(x) FROM (SELECT * FROM public.%I_import_consents WHERE organization_id=$1 AND source_key=$2 ORDER BY revision DESC LIMIT 1 FOR UPDATE) x',prefix_value) INTO consent_row USING org,source_value;
   IF consent_row->>'action'='grant' THEN
    scope_value:=CASE class_value WHEN 'crm_field_service' THEN '["external_crm_field_service_normalized_v1"]'::jsonb WHEN 'project_change_order' THEN '["external_project_change_order_normalized_v1"]'::jsonb WHEN 'communication' THEN '["external_communication_normalized_v1"]'::jsonb ELSE '["external_financial_normalized_v1"]'::jsonb END;
    consent_version_value:=CASE class_value WHEN 'crm_field_service' THEN 'm25-external-crm-field-service-import-consent-v1' WHEN 'project_change_order' THEN 'm25-external-project-change-order-import-consent-v1' WHEN 'communication' THEN 'm25-external-communication-import-consent-v1' ELSE 'm25-external-financial-import-consent-v1' END;
    revoke_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'revision',(consent_row->>'revision')::bigint+1,'previousId',(consent_row->>'id')::uuid,'action','revoke','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,'consentVersion',consent_version_value,'reason','Source deletion requested; imports and related learning are blocked.','requestDigest',request_hash));
    EXECUTE format('INSERT INTO public.%I_import_consents(organization_id,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest) VALUES($1,$2,$3,$4,''revoke'',$5,$6,$7,$8,$9,$10,$11,$12,$13)',prefix_value)
     USING org,source_value,(consent_row->>'revision')::bigint+1,(consent_row->>'id')::uuid,actor,(authority->>'membershipId')::uuid,session_value,scope_value,consent_version_value,'Source deletion requested; imports and related learning are blocked.',encode(sha256(convert_to(key_value||':consent-revoke','UTF8')),'hex'),request_hash,revoke_digest;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object(kind,public.canonical_external_business_operation_projection(kind,inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_business_adapter_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,class_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_external_business_operation_mutate(org,actor,role_value,session_value,csrf,key_value,class_value,source_value,'adapter',body) $$;
CREATE FUNCTION public.canonical_external_business_retention_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,class_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_external_business_operation_mutate(org,actor,role_value,session_value,csrf,key_value,class_value,source_value,'retention',body) $$;
CREATE FUNCTION public.canonical_external_business_deletion_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,class_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_external_business_operation_mutate(org,actor,role_value,session_value,csrf,key_value,class_value,source_value,'deletion',body) $$;

CREATE FUNCTION public.canonical_external_business_hold_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,class_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_external_business_hold_revisions%ROWTYPE; replay_row public.canonical_external_business_hold_revisions%ROWTYPE; inserted public.canonical_external_business_hold_revisions%ROWTYPE; consent_row JSONB; prefix_value TEXT; key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Source holds restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 prefix_value:=public.canonical_external_business_source_prefix(class_value);
 IF prefix_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','holdKind','expectedRevision','expectedDigest','confirmed']) IS NOT TRUE OR body->>'action' NOT IN ('place','release') OR body->>'holdKind' NOT IN ('legal','audit') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,3}|10000)$' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$' OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none')) OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Source hold invalid' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_external_business_lifecycle_lock(org,class_value,source_value); IF public.canonical_external_business_source_exists(org,class_value,source_value) IS NOT TRUE THEN RAISE EXCEPTION 'Source hold requires a recorded source' USING ERRCODE='22023'; END IF;
 EXECUTE format('SELECT to_jsonb(x) FROM (SELECT * FROM public.%I_import_consents WHERE organization_id=$1 AND source_key=$2 ORDER BY revision DESC LIMIT 1 FOR UPDATE)x',prefix_value) INTO consent_row USING org,source_value;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'body',body));
 PERFORM public.canonical_external_business_request_claim(org,actor,key_hash,request_hash,'hold');
 SELECT * INTO current_row FROM public.canonical_external_business_hold_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 SELECT * INTO replay_row FROM public.canonical_external_business_hold_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Source hold key conflict' USING ERRCODE='23505'; END IF;
  IF current_row.id IS DISTINCT FROM replay_row.id THEN RAISE EXCEPTION 'Source hold changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_hold_replay'; END IF;
  IF replay_row.source_consent_id IS DISTINCT FROM (consent_row->>'id')::uuid OR replay_row.source_consent_revision IS DISTINCT FROM (consent_row->>'revision')::bigint OR rtrim(replay_row.source_consent_digest) IS DISTINCT FROM rtrim(consent_row->>'canonical_digest') OR replay_row.source_consent_action IS DISTINCT FROM consent_row->>'action' THEN RAISE EXCEPTION 'Source permission changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_hold_consent_replay'; END IF;
  RETURN jsonb_build_object('hold',public.canonical_external_business_operation_projection('hold',to_jsonb(replay_row)),'replayed',TRUE);
 END IF;
 IF COALESCE(current_row.revision,0)<>(body->>'expectedRevision')::bigint OR COALESCE(rtrim(current_row.canonical_digest),'none') IS DISTINCT FROM body->>'expectedDigest' THEN RAISE EXCEPTION 'Source hold changed' USING ERRCODE='40001'; END IF;
 IF (body->>'action'='place' AND current_row.action='place') OR (body->>'action'='release' AND (current_row.action IS DISTINCT FROM 'place' OR current_row.hold_kind IS DISTINCT FROM body->>'holdKind')) THEN RAISE EXCEPTION 'Source hold transition invalid' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'revision',next_revision,'previousId',current_row.id,'action',body->>'action','holdKind',body->>'holdKind','sourceConsentId',consent_row->>'id','sourceConsentRevision',(consent_row->>'revision')::bigint,'sourceConsentDigest',rtrim(consent_row->>'canonical_digest'),'sourceConsentAction',consent_row->>'action','actorUserId',actor,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_business_hold_revisions(organization_id,source_class,source_key,revision,previous_id,action,hold_kind,source_consent_id,source_consent_revision,source_consent_digest,source_consent_action,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(org,class_value,source_value,next_revision,current_row.id,body->>'action',body->>'holdKind',(consent_row->>'id')::uuid,(consent_row->>'revision')::bigint,rtrim(consent_row->>'canonical_digest'),consent_row->>'action',actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('hold',public.canonical_external_business_operation_projection('hold',to_jsonb(inserted)),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_business_operations_read(org UUID,actor UUID,role_value TEXT,session_value UUID,class_value TEXT,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adapter JSONB; retention JSONB; deletion JSONB; hold_value JSONB; checkpoints JSONB; active_total BIGINT:=0; retention_total BIGINT:=0; prefix_value TEXT; import_checkpoints JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Source operations restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE); prefix_value:=public.canonical_external_business_source_prefix(class_value);
 IF prefix_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'Source invalid' USING ERRCODE='22023'; END IF;
 SELECT public.canonical_external_business_operation_projection('adapter',to_jsonb(x)) INTO adapter FROM (SELECT * FROM public.canonical_external_business_adapter_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1) x;
 SELECT public.canonical_external_business_operation_projection('retention',to_jsonb(x)) INTO retention FROM (SELECT * FROM public.canonical_external_business_retention_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1) x;
 SELECT public.canonical_external_business_operation_projection('deletion',to_jsonb(x)) INTO deletion FROM (SELECT * FROM public.canonical_external_business_deletion_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1) x;
 SELECT public.canonical_external_business_operation_projection('hold',to_jsonb(x)) INTO hold_value FROM (SELECT * FROM public.canonical_external_business_hold_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1) x;
 EXECUTE format('SELECT COALESCE(jsonb_agg(jsonb_build_object(''mode'',mode,''sequence'',sequence,''cursorAfter'',cursor_after,''complete'',complete,''createdAt'',created_at) ORDER BY mode),''[]''::jsonb) FROM (SELECT DISTINCT ON(mode) mode,sequence,cursor_after,complete,created_at FROM public.%I_import_runs WHERE organization_id=$1 AND source_key=$2 ORDER BY mode,sequence DESC)x',prefix_value) INTO import_checkpoints USING org,source_value;
 SELECT COALESCE(jsonb_agg(public.canonical_external_business_cleanup_projection(x) ORDER BY operation),'[]'::jsonb) INTO checkpoints FROM (SELECT DISTINCT ON(operation) * FROM public.canonical_external_business_cleanup_runs WHERE organization_id=org AND source_class=class_value AND source_key=source_value AND ((operation='retention' AND authority_revision=COALESCE((retention->>'revision')::bigint,0) AND rtrim(authority_digest)=retention->>'digest') OR (operation='deletion' AND authority_revision=COALESCE((deletion->>'revision')::bigint,0) AND rtrim(authority_digest)=deletion->>'digest')) ORDER BY operation,sequence DESC)x;
 EXECUTE format('WITH current_records AS (SELECT DISTINCT ON(consent_id,external_record_id) * FROM public.%I_import_records WHERE organization_id=$1 AND source_key=$2 ORDER BY consent_id,external_record_id,revision DESC) SELECT count(*) FROM current_records WHERE state=''active''',prefix_value) INTO active_total USING org,source_value;
 IF retention->>'action'='set' THEN EXECUTE format('WITH current_records AS (SELECT DISTINCT ON(consent_id,external_record_id) * FROM public.%I_import_records WHERE organization_id=$1 AND source_key=$2 ORDER BY consent_id,external_record_id,revision DESC) SELECT count(*) FROM current_records WHERE state=''active'' AND source_updated_at<transaction_timestamp()-make_interval(days=>$3)',prefix_value) INTO retention_total USING org,source_value,(retention->>'retentionDays')::integer; END IF;
 RETURN jsonb_build_object('sourceClass',class_value,'sourceKey',source_value,'adapter',adapter,'retention',retention,'deletion',deletion,'hold',hold_value,'cleanupAllowed',COALESCE(hold_value->>'action','release')<>'place','checkpoints',jsonb_build_object('imports',import_checkpoints,'cleanup',checkpoints),'activeRecordTotal',active_total,'retentionEligibleTotal',retention_total,'deletionComplete',deletion->>'action'='request' AND active_total=0,'boundary','Cleanup removes imported detail by adding minimized deletion records. An active legal or audit hold pauses cleanup. No customer, job, estimate, schedule, invoice, payment, accounting record or company policy is changed.');
END $$;

CREATE FUNCTION public.canonical_external_business_cleanup_execute(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,class_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; authority_value JSONB; previous_run public.canonical_external_business_cleanup_runs%ROWTYPE; replay_run public.canonical_external_business_cleanup_runs%ROWTYPE; current_hold public.canonical_external_business_hold_revisions%ROWTYPE;
 prefix_value TEXT; key_hash TEXT; request_hash TEXT; run_id UUID:=gen_random_uuid(); digest_value TEXT; sequence_value BIGINT; selected_count INTEGER; has_more BOOLEAN; next_cursor TEXT; record_row RECORD; record_digest TEXT; operation_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Cleanup restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); operation_value:=body->>'operation'; prefix_value:=public.canonical_external_business_source_prefix(class_value);
 IF prefix_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['operation','expectedRevision','expectedDigest','cursorBefore','limit','confirmed']) IS NOT TRUE OR operation_value NOT IN ('retention','deletion') OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^([1-9][0-9]{0,3}|10000)$' OR body->>'expectedDigest'!~'^[0-9a-f]{64}$' OR NOT(body->'cursorBefore'='null'::jsonb OR (jsonb_typeof(body->'cursorBefore')='string' AND char_length(body->>'cursorBefore') BETWEEN 1 AND 128 AND body->>'cursorBefore'~'^[!-~]+$')) OR jsonb_typeof(body->'limit') IS DISTINCT FROM 'number' OR (body->>'limit')!~'^[0-9]+$' OR (body->>'limit')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Cleanup invalid' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_external_business_lifecycle_lock(org,class_value,source_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'body',body));
 PERFORM public.canonical_external_business_request_claim(org,actor,key_hash,request_hash,'cleanup:'||operation_value);
 IF operation_value='retention' THEN SELECT to_jsonb(x) INTO authority_value FROM (SELECT * FROM public.canonical_external_business_retention_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE)x; ELSE SELECT to_jsonb(x) INTO authority_value FROM (SELECT * FROM public.canonical_external_business_deletion_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE)x; END IF;
 IF COALESCE((authority_value->>'revision')::bigint,0)<>(body->>'expectedRevision')::bigint OR COALESCE(rtrim(authority_value->>'canonical_digest'),'none') IS DISTINCT FROM body->>'expectedDigest' OR (operation_value='retention' AND authority_value->>'action'<>'set') OR (operation_value='deletion' AND authority_value->>'action'<>'request') THEN RAISE EXCEPTION 'Cleanup authority changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO previous_run FROM public.canonical_external_business_cleanup_runs WHERE organization_id=org AND source_class=class_value AND source_key=source_value AND operation=operation_value AND authority_revision=(authority_value->>'revision')::bigint AND rtrim(authority_digest)=rtrim(authority_value->>'canonical_digest') ORDER BY sequence DESC LIMIT 1 FOR UPDATE;
 SELECT * INTO current_hold FROM public.canonical_external_business_hold_revisions WHERE organization_id=org AND source_class=class_value AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF current_hold.action='place' THEN RAISE EXCEPTION 'Source cleanup is paused by an active hold' USING ERRCODE='40001',CONSTRAINT='external_business_cleanup_active_hold'; END IF;
 SELECT * INTO replay_run FROM public.canonical_external_business_cleanup_runs WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_run.request_digest)<>request_hash THEN RAISE EXCEPTION 'Cleanup key conflict' USING ERRCODE='23505'; END IF;
  IF previous_run.id IS DISTINCT FROM replay_run.id THEN RAISE EXCEPTION 'Cleanup authority changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_cleanup_replay'; END IF;
  RETURN jsonb_build_object('run',public.canonical_external_business_cleanup_projection(replay_run),'replayed',TRUE);
 END IF;
 IF previous_run.id IS NOT NULL AND NOT previous_run.complete AND previous_run.cursor_after IS DISTINCT FROM body->>'cursorBefore' THEN RAISE EXCEPTION 'Cleanup cursor changed' USING ERRCODE='40001'; END IF;
 IF (previous_run.id IS NULL OR previous_run.complete) AND body->'cursorBefore'<>'null'::jsonb THEN RAISE EXCEPTION 'Cleanup cursor changed' USING ERRCODE='40001'; END IF;
 CREATE TEMP TABLE selected_business_cleanup_records(cleanup_cursor TEXT,external_record_id TEXT,revision BIGINT,id UUID,consent_id UUID,external_version BIGINT,import_run_id UUID,source_updated_at TIMESTAMPTZ) ON COMMIT DROP;
 EXECUTE format('INSERT INTO selected_business_cleanup_records SELECT ''cur_''||encode(sha256(convert_to(consent_id::text||'':''||external_record_id,''UTF8'')),''hex''),external_record_id,revision,id,consent_id,external_version,import_run_id,source_updated_at FROM (SELECT DISTINCT ON(consent_id,external_record_id) * FROM public.%I_import_records WHERE organization_id=$1 AND source_key=$2 ORDER BY consent_id,external_record_id,revision DESC)x WHERE state=''active'' AND ($3::text IS NULL OR ''cur_''||encode(sha256(convert_to(consent_id::text||'':''||external_record_id,''UTF8'')),''hex'')>$3) AND ($4=''deletion'' OR source_updated_at<transaction_timestamp()-make_interval(days=>$5)) ORDER BY 1 LIMIT $6+1',prefix_value)
  USING org,source_value,body->>'cursorBefore',operation_value,COALESCE((authority_value->>'retention_days')::integer,30),(body->>'limit')::integer;
 SELECT count(*) INTO selected_count FROM selected_business_cleanup_records; has_more:=selected_count>(body->>'limit')::integer;
 IF has_more THEN DELETE FROM selected_business_cleanup_records WHERE cleanup_cursor=(SELECT max(cleanup_cursor) FROM selected_business_cleanup_records); END IF;
 SELECT count(*),max(cleanup_cursor) INTO selected_count,next_cursor FROM selected_business_cleanup_records; IF NOT has_more THEN next_cursor:=NULL; END IF;
 SELECT COALESCE(max(sequence),0)+1 INTO sequence_value FROM public.canonical_external_business_cleanup_runs WHERE organization_id=org AND source_class=class_value AND source_key=source_value AND operation=operation_value;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('id',run_id,'organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'operation',operation_value,'sequence',sequence_value,'previousRunId',previous_run.id,'authorityRevision',(authority_value->>'revision')::bigint,'authorityDigest',rtrim(authority_value->>'canonical_digest'),'cursorBefore',body->>'cursorBefore','cursorAfter',next_cursor,'complete',NOT has_more,'tombstonedCount',selected_count,'actorUserId',actor,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_business_cleanup_runs(id,organization_id,source_class,source_key,operation,sequence,previous_run_id,authority_revision,authority_digest,cursor_before,cursor_after,complete,tombstoned_count,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(run_id,org,class_value,source_value,operation_value,sequence_value,previous_run.id,(authority_value->>'revision')::bigint,rtrim(authority_value->>'canonical_digest'),body->>'cursorBefore',next_cursor,NOT has_more,selected_count,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value);
 FOR record_row IN SELECT * FROM selected_business_cleanup_records ORDER BY cleanup_cursor LOOP
  record_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'externalRecordId',record_row.external_record_id,'externalVersion',record_row.external_version+1,'state','tombstone','sourceUpdatedAt',transaction_timestamp(),'cleanupRunId',run_id));
  IF class_value='crm_field_service' THEN
   INSERT INTO public.canonical_external_crm_field_service_import_records(organization_id,source_key,external_record_id,revision,previous_id,consent_id,external_version,state,source_updated_at,source_digest,import_run_id,cleanup_run_id) VALUES(org,source_value,record_row.external_record_id,record_row.revision+1,record_row.id,record_row.consent_id,record_row.external_version+1,'tombstone',transaction_timestamp(),record_digest,record_row.import_run_id,run_id);
  ELSIF class_value='project_change_order' THEN
   INSERT INTO public.canonical_external_project_change_order_import_records(organization_id,source_key,external_record_id,revision,previous_id,consent_id,external_version,state,source_updated_at,source_digest,import_run_id,cleanup_run_id) VALUES(org,source_value,record_row.external_record_id,record_row.revision+1,record_row.id,record_row.consent_id,record_row.external_version+1,'tombstone',transaction_timestamp(),record_digest,record_row.import_run_id,run_id);
  ELSIF class_value='communication' THEN
   INSERT INTO public.canonical_external_communication_import_records(organization_id,source_key,external_record_id,revision,previous_id,consent_id,external_version,state,source_updated_at,source_digest,import_run_id,cleanup_run_id) VALUES(org,source_value,record_row.external_record_id,record_row.revision+1,record_row.id,record_row.consent_id,record_row.external_version+1,'tombstone',transaction_timestamp(),record_digest,record_row.import_run_id,run_id);
  ELSE
   INSERT INTO public.canonical_external_financial_import_records(organization_id,source_key,external_record_id,revision,previous_id,consent_id,external_version,state,source_updated_at,source_digest,import_run_id,cleanup_run_id) VALUES(org,source_value,record_row.external_record_id,record_row.revision+1,record_row.id,record_row.consent_id,record_row.external_version+1,'tombstone',transaction_timestamp(),record_digest,record_row.import_run_id,run_id);
  END IF;
 END LOOP;
 SELECT * INTO replay_run FROM public.canonical_external_business_cleanup_runs WHERE id=run_id;
 RETURN jsonb_build_object('run',public.canonical_external_business_cleanup_projection(replay_run),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_business_deletion_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE class_value TEXT; action_value TEXT;
BEGIN
 class_value:=CASE WHEN TG_TABLE_NAME LIKE '%crm_field_service%' THEN 'crm_field_service' WHEN TG_TABLE_NAME LIKE '%project_change_order%' THEN 'project_change_order' WHEN TG_TABLE_NAME LIKE '%communication%' THEN 'communication' WHEN TG_TABLE_NAME LIKE '%financial%' THEN 'financial' END;
 PERFORM public.canonical_external_business_lifecycle_lock(NEW.organization_id,class_value,NEW.source_key);
 SELECT action INTO action_value FROM public.canonical_external_business_deletion_revisions WHERE organization_id=NEW.organization_id AND source_class=class_value AND source_key=NEW.source_key ORDER BY revision DESC LIMIT 1;
 IF TG_TABLE_NAME LIKE '%import_consents' AND to_jsonb(NEW)->>'action'='grant' AND action_value='request' THEN RAISE EXCEPTION 'Cancel source deletion before starting a new permission period' USING ERRCODE='40001',CONSTRAINT='external_business_deletion_blocks_consent_grant'; END IF;
 IF TG_TABLE_NAME LIKE '%import_runs' AND action_value='request' THEN RAISE EXCEPTION 'Source deletion blocks imports' USING ERRCODE='40001',CONSTRAINT='external_business_deletion_blocks_import'; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER crm_business_consent_deletion_guard BEFORE INSERT ON public.canonical_external_crm_field_service_import_consents FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();
CREATE TRIGGER crm_business_import_deletion_guard BEFORE INSERT ON public.canonical_external_crm_field_service_import_runs FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();
CREATE TRIGGER project_business_consent_deletion_guard BEFORE INSERT ON public.canonical_external_project_change_order_import_consents FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();
CREATE TRIGGER project_business_import_deletion_guard BEFORE INSERT ON public.canonical_external_project_change_order_import_runs FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();
CREATE TRIGGER communication_business_consent_deletion_guard BEFORE INSERT ON public.canonical_external_communication_import_consents FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();
CREATE TRIGGER communication_business_import_deletion_guard BEFORE INSERT ON public.canonical_external_communication_import_runs FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();
CREATE TRIGGER financial_business_consent_deletion_guard BEFORE INSERT ON public.canonical_external_financial_import_consents FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();
CREATE TRIGGER financial_business_import_deletion_guard BEFORE INSERT ON public.canonical_external_financial_import_runs FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_deletion_guard();

REVOKE ALL ON TABLE public.canonical_external_business_adapter_revisions,public.canonical_external_business_retention_revisions,public.canonical_external_business_deletion_revisions,public.canonical_external_business_hold_revisions,public.canonical_external_business_lifecycle_gates,public.canonical_external_business_request_keys,public.canonical_external_business_cleanup_runs FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_source_prefix(TEXT),public.canonical_external_business_lifecycle_lock(UUID,TEXT,TEXT),public.canonical_external_business_request_claim(UUID,UUID,TEXT,TEXT,TEXT),public.canonical_external_business_operation_projection(TEXT,JSONB),public.canonical_external_business_cleanup_projection(public.canonical_external_business_cleanup_runs),public.canonical_external_business_source_exists(UUID,TEXT,TEXT),public.canonical_external_business_operation_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB),public.canonical_external_business_adapter_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB),public.canonical_external_business_retention_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB),public.canonical_external_business_deletion_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB),public.canonical_external_business_hold_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB),public.canonical_external_business_operations_read(UUID,UUID,TEXT,UUID,TEXT,TEXT),public.canonical_external_business_cleanup_execute(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB),public.canonical_external_business_deletion_guard() FROM PUBLIC;
