-- Mission 23 Part 11: internal, inert, immutable reference handoffs.
-- Additive only. No source updates, transport, worker, consumer or financial action.
CREATE TABLE public.canonical_handoff_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 execution_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,
 actor_access_role TEXT NOT NULL CHECK(actor_access_role IN ('owner','admin')),
 auth_session_id UUID NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('prepare','revoke')),
 mission INTEGER NOT NULL CHECK(mission BETWEEN 24 AND 32 AND mission<>31),
 audience TEXT NOT NULL CHECK(audience='tenant_owner_admin_review'),
 consent_version TEXT NOT NULL CHECK(consent_version='m23-internal-reference-consent-v1'),
 source_snapshot JSONB NOT NULL CHECK(jsonb_typeof(source_snapshot)='object' AND octet_length(source_snapshot::text)<=262144),
 source_digest TEXT NOT NULL CHECK(source_digest=public.canonical_completion_digest(source_snapshot)),
 target_id UUID,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,execution_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id),
 FOREIGN KEY(organization_id,execution_id,target_id) REFERENCES public.canonical_handoff_receipts(organization_id,execution_id,id),
 CHECK((action='prepare' AND target_id IS NULL) OR (action='revoke' AND target_id IS NOT NULL))
);
CREATE UNIQUE INDEX canonical_handoff_one_revocation ON public.canonical_handoff_receipts(organization_id,target_id) WHERE action='revoke';
CREATE INDEX canonical_handoff_execution_history ON public.canonical_handoff_receipts(organization_id,execution_id,created_at,id);

CREATE FUNCTION public.canonical_handoff_immutable() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Handoff receipts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_handoff_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_handoff_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_handoff_immutable();

-- Source references are complete within a hard bound, never a silently partial set.
-- No note, document, file URL/content, transcript, worker identity or cost is copied.
CREATE FUNCTION public.canonical_handoff_authorize(org UUID,actor UUID,role_value TEXT,session_value UUID,work UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE completion JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Owner or administrator access required' USING ERRCODE='42501'; END IF;
 completion:=public.canonical_completion_read(org,actor,role_value,session_value,work);
 IF NOT EXISTS(SELECT 1 FROM public.organization_onboarding o JOIN public.subscriptions s ON s.organization_id=o.organization_id
  WHERE o.organization_id=org AND o.status='complete' AND (s.status='active' OR
   (s.status='trialing' AND s.trial_started_at IS NOT NULL AND s.trial_ends_at=s.trial_started_at+INTERVAL '14 days' AND s.trial_ends_at>clock_timestamp()))) THEN
  RAISE EXCEPTION 'Current subscription and onboarding required' USING ERRCODE='42501'; END IF;
 RETURN completion;
END $$;

CREATE FUNCTION public.canonical_handoff_snapshot(org UUID,actor UUID,role_value TEXT,session_value UUID,work UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE completion JSONB; result JSONB; pins JSONB; domain TEXT; relation_name TEXT;
 assignment_value JSONB; total INTEGER;
BEGIN
 completion:=public.canonical_handoff_authorize(org,actor,role_value,session_value,work);
 SELECT jsonb_build_object('id',a.id,'revision',a.revision,'digest',rtrim(a.canonical_digest)) INTO assignment_value
 FROM public.canonical_field_executions e JOIN public.canonical_schedule_assignments a ON a.organization_id=e.organization_id AND a.id=e.assignment_id
 WHERE e.organization_id=org AND e.id=work;
 result:=jsonb_build_object('version','m23-source-references-v1','execution',jsonb_build_object(
  'id',completion#>'{data,execution,id}','revision',completion#>'{data,execution,revision}',
  'digest',completion#>'{data,execution,digest}','lifecycleState',completion#>'{data,execution,lifecycleState}'),
  'assignment',assignment_value,'factsIncluded',FALSE,'completionInferred',FALSE);
 FOR domain,relation_name IN SELECT * FROM (VALUES
  ('labor','canonical_labor_intervals'),('materials','canonical_material_movements'),
  ('progress','canonical_progress_records'),('fieldEvidence','canonical_field_evidence_records'),
  ('completion','canonical_completion_records')) AS domains(domain,relation_name) LOOP
  EXECUTE format('SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''revision'',revision,''digest'',rtrim(canonical_digest)) ORDER BY id),''[]''::jsonb),count(*) FROM (SELECT id,revision,canonical_digest FROM public.%I WHERE organization_id=$1 AND execution_id=$2 ORDER BY id LIMIT 1001) records',relation_name)
   INTO pins,total USING org,work;
  IF total>1000 THEN RAISE EXCEPTION 'Source reference bound exceeded' USING ERRCODE='54000'; END IF;
  result:=result||jsonb_build_object(domain,jsonb_build_object('pins',pins,'count',total,'digest',public.canonical_completion_digest(pins)));
 END LOOP;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'digest',rtrim(digest)) ORDER BY id),'[]'::jsonb),count(*)
 INTO pins,total FROM (SELECT id,revision,digest FROM public.canonical_equipment_events WHERE organization_id=org AND execution_id=work ORDER BY id LIMIT 1001) e;
 IF total>1000 THEN RAISE EXCEPTION 'Source reference bound exceeded' USING ERRCODE='54000'; END IF;
 result:=result||jsonb_build_object('equipment',jsonb_build_object('pins',pins,'count',total,'digest',public.canonical_completion_digest(pins)));
 IF octet_length(result::text)>262144 THEN RAISE EXCEPTION 'Source reference bound exceeded' USING ERRCODE='54000'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.canonical_handoff_projection(item public.canonical_handoff_receipts)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',item.id,'executionId',item.execution_id,'action',item.action,'mission',item.mission,
 'audience',item.audience,'consentVersion',item.consent_version,'sourceDigest',item.source_digest,
 'targetId',item.target_id,'digest',item.digest,'createdAt',item.created_at,
 'delivery','unavailable','consumptionAuthorized',FALSE,'financialConsequence',FALSE,'customerConsequence',FALSE);
$$;

CREATE FUNCTION public.canonical_handoff_read(org UUID,actor UUID,role_value TEXT,session_value UUID,work UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot JSONB; current_digest TEXT; receipts JSONB;
BEGIN
 PERFORM public.canonical_handoff_authorize(org,actor,role_value,session_value,work);
 BEGIN
  snapshot:=public.canonical_handoff_snapshot(org,actor,role_value,session_value,work);
 EXCEPTION WHEN program_limit_exceeded THEN snapshot:=NULL;
 END;
 current_digest:=public.canonical_completion_digest(snapshot);
 SELECT COALESCE(jsonb_agg(public.canonical_handoff_projection(r)||jsonb_build_object('status',CASE
  WHEN r.action='revoke' THEN 'revocation'
  WHEN EXISTS(SELECT 1 FROM public.canonical_handoff_receipts revoked WHERE revoked.organization_id=org AND revoked.target_id=r.id) THEN 'revoked'
  WHEN snapshot IS NULL THEN 'source_unavailable'
  WHEN r.source_digest<>current_digest THEN 'source_changed' ELSE 'prepared' END) ORDER BY r.created_at DESC,r.id DESC),'[]'::jsonb)
 INTO receipts FROM public.canonical_handoff_receipts r WHERE r.organization_id=org AND r.execution_id=work;
 RETURN jsonb_build_object('version','m23-downstream-handoffs-v1','executionId',work,'sourceSnapshot',snapshot,
  'sourceDigest',current_digest,'sourceAvailable',snapshot IS NOT NULL,'receipts',receipts,'audience','tenant_owner_admin_review',
  'consentVersion','m23-internal-reference-consent-v1','delivery','unavailable','consumptionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_handoff_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,work UUID,
 csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot JSONB; current_digest TEXT; key_hash TEXT; request_hash TEXT; action_value TEXT;
 old public.canonical_handoff_receipts%ROWTYPE; target public.canonical_handoff_receipts%ROWTYPE;
 inserted public.canonical_handoff_receipts%ROWTYPE; mission_value INTEGER; target_value UUID;
 receipt_id UUID:=gen_random_uuid(); stamp TIMESTAMPTZ:=transaction_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable transaction required' USING ERRCODE='25001'; END IF;
 PERFORM public.canonical_completion_work_lock(org,work,TRUE);
 -- The existing completion read independently requires the shared work lock.
 -- Acquire it only after verifying the stronger ordered exclusive writer lock.
 PERFORM pg_advisory_xact_lock_shared(230007,hashtext(org::text||':'||work::text));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_handoff_authorize(org,actor,role_value,session_value,work);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','mission','audience','consentVersion','consentConfirmed','sourceDigest','targetId']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('prepare','revoke') OR
  jsonb_typeof(body->'mission') IS DISTINCT FROM 'number' OR (body->>'mission')!~'^(24|25|26|27|28|29|30|32)$' OR
  body->>'audience' IS DISTINCT FROM 'tenant_owner_admin_review' OR
  body->>'consentVersion' IS DISTINCT FROM 'm23-internal-reference-consent-v1' OR
  body->'consentConfirmed' IS DISTINCT FROM 'true'::jsonb OR
  body->>'sourceDigest' IS NULL OR (body->>'sourceDigest')!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Handoff input or explicit consent invalid' USING ERRCODE='22023'; END IF;
 action_value:=body->>'action'; mission_value:=(body->>'mission')::integer;
 IF (action_value='prepare' AND body->'targetId' IS DISTINCT FROM 'null'::jsonb) OR
  (action_value='revoke' AND public.canonical_field_evidence_uuid_valid(body->>'targetId') IS NOT TRUE) THEN
  RAISE EXCEPTION 'Handoff target invalid' USING ERRCODE='22023'; END IF;
 target_value:=(body->>'targetId')::uuid;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('work',work,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':handoff:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_handoff_receipts WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE='23505'; END IF;
  -- Current actor and record gates ran before replay. This confirms a historical
  -- receipt only; a revoked or stale preparation never becomes consumption authority.
  RETURN jsonb_build_object('receipt',public.canonical_handoff_projection(old),'replayed',TRUE);
 END IF;
 IF action_value='prepare' THEN
  snapshot:=public.canonical_handoff_snapshot(org,actor,role_value,session_value,work);
  current_digest:=public.canonical_completion_digest(snapshot);
  IF body->>'sourceDigest'<>current_digest THEN RAISE EXCEPTION 'Source references changed' USING ERRCODE='40001',CONSTRAINT='canonical_handoff_source_stale'; END IF;
  IF (SELECT count(*) FROM public.canonical_handoff_receipts WHERE organization_id=org AND execution_id=work AND action='prepare')>=50 THEN
   RAISE EXCEPTION 'Handoff receipt bound reached' USING ERRCODE='54000'; END IF;
 ELSE
  SELECT * INTO target FROM public.canonical_handoff_receipts WHERE organization_id=org AND execution_id=work AND id=target_value AND action='prepare';
  IF NOT FOUND THEN RAISE EXCEPTION 'Handoff not found' USING ERRCODE='P0002'; END IF;
  IF target.mission<>mission_value OR target.source_digest<>body->>'sourceDigest' THEN RAISE EXCEPTION 'Handoff reference changed' USING ERRCODE='22023'; END IF;
  snapshot:=target.source_snapshot; current_digest:=target.source_digest;
 END IF;
 INSERT INTO public.canonical_handoff_receipts(id,organization_id,execution_id,actor_user_id,actor_access_role,auth_session_id,
 action,mission,audience,consent_version,source_snapshot,source_digest,target_id,request_key_hash,request_digest,created_at,digest)
 VALUES(receipt_id,org,work,actor,role_value,session_value,action_value,mission_value,body->>'audience',body->>'consentVersion',
 snapshot,current_digest,target_value,key_hash,request_hash,stamp,public.canonical_completion_digest(jsonb_build_object(
 'id',receipt_id,'organizationId',org,'executionId',work,'actor',actor,'role',role_value,'session',session_value,
 'body',body,'sourceSnapshot',snapshot,'sourceDigest',current_digest,'requestDigest',request_hash,'createdAt',stamp))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_handoff_projection(inserted),'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_handoff_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_handoff_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_handoff_authorize(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_handoff_snapshot(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_handoff_projection(public.canonical_handoff_receipts) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_handoff_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_handoff_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
