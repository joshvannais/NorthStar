-- Mission 25 Part 4: reviewed reconciliation of imported labor references.
-- Matches remain advisory lineage. They do not alter workforce, jobs, labor, estimates, payroll, schedules or policy.

CREATE TABLE public.canonical_external_labor_import_reference_matches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 consent_id UUID NOT NULL,
 consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),
 consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 reference_kind TEXT NOT NULL CHECK(reference_kind IN ('worker','job')),
 external_reference TEXT NOT NULL CHECK(char_length(external_reference) BETWEEN 1 AND 128 AND external_reference~'^[!-~]+$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('link','unlink')),
 target_id UUID,
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='array'),
 source_digest TEXT NOT NULL CHECK(source_digest='unavailable' OR source_digest~'^[0-9a-f]{64}$'),
 target_digest TEXT NOT NULL CHECK(target_digest='unavailable' OR target_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-labor-reference-match-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,reference_kind,external_reference,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,reference_kind,external_reference,id),
 FOREIGN KEY(organization_id,source_key,reference_kind,external_reference,previous_id)
  REFERENCES public.canonical_external_labor_import_reference_matches
   (organization_id,source_key,reference_kind,external_reference,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,consent_id)
  REFERENCES public.canonical_external_labor_import_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((action='link' AND target_id IS NOT NULL AND source_digest<>'unavailable' AND target_digest<>'unavailable')
   OR (action='unlink' AND target_id IS NULL AND target_digest='unavailable'))
);

CREATE INDEX canonical_external_labor_import_reference_matches_current_idx
 ON public.canonical_external_labor_import_reference_matches
 (organization_id,source_key,reference_kind,external_reference,revision DESC);

CREATE TRIGGER canonical_external_labor_import_reference_matches_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_labor_import_reference_matches FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_external_labor_reference_source_basis(org UUID,source_value TEXT,kind_value TEXT,reference_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE manifest JSONB; total BIGINT;
BEGIN
 WITH current_records AS (
  SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
   WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC
 ), selected AS (
  SELECT external_record_id,revision,external_version,rtrim(source_digest) source_digest
   FROM current_records WHERE state='active' AND
    CASE WHEN kind_value='worker' THEN worker_reference=reference_value ELSE job_reference=reference_value END
   ORDER BY external_record_id LIMIT 1001
 ) SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('externalRecordId',external_record_id,'revision',revision,
    'externalVersion',external_version,'sourceDigest',source_digest) ORDER BY external_record_id),'[]'::jsonb)
   INTO total,manifest FROM selected;
 IF total=0 OR total>1000 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('manifest',manifest,'digest',public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'sourceKey',source_value,'referenceKind',kind_value,'externalReference',reference_value,
  'records',manifest)),'recordCount',total);
END $$;

CREATE FUNCTION public.canonical_external_labor_reference_target_basis(org UUID,kind_value TEXT,target_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE basis JSONB;
BEGIN
 IF kind_value='worker' THEN
  SELECT jsonb_build_object('targetId',p.id,'membershipId',p.membership_id,'operationalRole',p.operational_role,
    'profileUpdatedAt',p.updated_at,'membershipStatus',m.status,'membershipUpdatedAt',m.updated_at)
   INTO basis FROM public.workforce_profiles p JOIN public.organization_memberships m
    ON m.organization_id=p.organization_id AND m.id=p.membership_id
   WHERE p.organization_id=org AND p.id=target_value AND m.status='active';
 ELSE
  SELECT jsonb_build_object('targetId',e.id,'operationId',e.operation_id,'graphId',e.graph_id,
    'opportunityId',e.opportunity_id,'snapshotDigest',rtrim(e.snapshot_digest),'createdAt',e.created_at)
   INTO basis FROM public.canonical_estimates e WHERE e.organization_id=org AND e.id=target_value;
 END IF;
 IF basis IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('basis',basis,'digest',public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'referenceKind',kind_value,'target',basis)));
END $$;

CREATE FUNCTION public.canonical_external_labor_reference_match_projection(
 value public.canonical_external_labor_import_reference_matches,current_source JSONB,current_target JSONB,current_consent JSONB)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'referenceKind',value.reference_kind,
  'externalReference',value.external_reference,'revision',value.revision,'previousId',value.previous_id,
  'consentId',value.consent_id,'consentRevision',value.consent_revision,'consentDigest',rtrim(value.consent_digest),
  'action',value.action,'targetId',value.target_id,'sourceManifest',value.source_manifest,
  'sourceDigest',value.source_digest,'targetDigest',value.target_digest,'reason',value.reason,
  'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,'digest',rtrim(value.canonical_digest),
  'status',CASE WHEN value.action='unlink' THEN 'unmatched'
    WHEN current_consent->>'id' IS DISTINCT FROM value.consent_id::text
      OR current_consent->>'digest' IS DISTINCT FROM rtrim(value.consent_digest) THEN 'stale'
    WHEN current_source IS NULL OR current_target IS NULL THEN 'stale'
    WHEN current_source->>'digest'=value.source_digest AND current_target->>'digest'=value.target_digest THEN 'matched'
    ELSE 'stale' END,'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_external_labor_reference_matches_read(org UUID,actor UUID,role_value TEXT,
 session_value UUID,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_labor_import_consents%ROWTYPE; reference_rows JSONB; worker_targets JSONB; job_targets JSONB;
 reference_total BIGINT; worker_target_total BIGINT; job_target_total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External labor reconciliation is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External labor source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO consent_row FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF consent_row.id IS NULL OR consent_row.action<>'grant' THEN
  RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',FALSE,'references','[]'::jsonb,
   'referenceTotal',0,'referencesTruncated',FALSE,'workerTargets','[]'::jsonb,'workerTargetTotal',0,
   'workerTargetsTruncated',FALSE,'jobTargets','[]'::jsonb,'jobTargetTotal',0,'jobTargetsTruncated',FALSE,
   'consumptionBoundary','Reference matches are unavailable while source consent is inactive.');
 END IF;
 WITH current_records AS (
  SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
   WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC
 ), refs AS (
  SELECT DISTINCT 'worker'::text kind,worker_reference reference FROM current_records WHERE state='active'
  UNION SELECT DISTINCT 'job'::text,job_reference FROM current_records WHERE state='active'
 ), latest AS (
  SELECT DISTINCT ON (reference_kind,external_reference) * FROM public.canonical_external_labor_import_reference_matches
   WHERE organization_id=org AND source_key=source_value ORDER BY reference_kind,external_reference,revision DESC
 ), all_refs AS (
  SELECT kind,reference FROM refs UNION SELECT reference_kind,external_reference FROM latest
 ) SELECT count(*) INTO reference_total FROM all_refs;
 WITH current_records AS (
  SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
   WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC
 ), refs AS (
  SELECT DISTINCT 'worker'::text kind,worker_reference reference FROM current_records WHERE state='active'
  UNION SELECT DISTINCT 'job'::text,job_reference FROM current_records WHERE state='active'
 ), latest AS (
  SELECT DISTINCT ON (reference_kind,external_reference) * FROM public.canonical_external_labor_import_reference_matches
   WHERE organization_id=org AND source_key=source_value ORDER BY reference_kind,external_reference,revision DESC
 ), visible_refs AS (
  SELECT kind,reference FROM refs
  UNION SELECT reference_kind,external_reference FROM latest
 ), selected_refs AS (
  SELECT * FROM visible_refs ORDER BY kind,reference LIMIT 100
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('referenceKind',r.kind,'externalReference',r.reference,
   'sourceRecordCount',(sb.source_basis->>'recordCount')::bigint,'sourceDigest',sb.source_basis->>'digest',
   'match',CASE WHEN m.id IS NULL THEN NULL ELSE public.canonical_external_labor_reference_match_projection(m,sb.source_basis,tb.target_basis,
    public.canonical_external_labor_import_consent_projection(consent_row)) END)
   ORDER BY r.kind,r.reference),'[]'::jsonb) INTO reference_rows
 FROM selected_refs r
 CROSS JOIN LATERAL (SELECT public.canonical_external_labor_reference_source_basis(org,source_value,r.kind,r.reference) source_basis) sb
 LEFT JOIN latest m ON m.reference_kind=r.kind AND m.external_reference=r.reference
 LEFT JOIN LATERAL (SELECT public.canonical_external_labor_reference_target_basis(org,r.kind,m.target_id) target_basis) tb ON m.target_id IS NOT NULL;
 SELECT count(*) INTO worker_target_total FROM public.workforce_profiles p JOIN public.organization_memberships m
  ON m.organization_id=p.organization_id AND m.id=p.membership_id
  WHERE p.organization_id=org AND m.status='active';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId',p.id,'operationalRole',p.operational_role,
   'digest',b.target_basis->>'digest') ORDER BY p.operational_role,p.id),'[]'::jsonb) INTO worker_targets
 FROM (SELECT p.* FROM public.workforce_profiles p JOIN public.organization_memberships m
   ON m.organization_id=p.organization_id AND m.id=p.membership_id
   WHERE p.organization_id=org AND m.status='active' ORDER BY p.operational_role,p.id LIMIT 100) p
 CROSS JOIN LATERAL (SELECT public.canonical_external_labor_reference_target_basis(org,'worker',p.id) target_basis) b;
 SELECT count(*) INTO job_target_total FROM public.canonical_estimates WHERE organization_id=org;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId',e.id,'opportunityId',e.opportunity_id,
   'digest',b.target_basis->>'digest') ORDER BY e.created_at DESC,e.id DESC),'[]'::jsonb) INTO job_targets
 FROM (SELECT * FROM public.canonical_estimates WHERE organization_id=org ORDER BY created_at DESC,id DESC LIMIT 100) e
 CROSS JOIN LATERAL (SELECT public.canonical_external_labor_reference_target_basis(org,'job',e.id) target_basis) b;
 RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,'references',reference_rows,
  'referenceTotal',reference_total,'referencesTruncated',reference_total>100,
  'workerTargets',worker_targets,'workerTargetTotal',worker_target_total,'workerTargetsTruncated',worker_target_total>100,
  'jobTargets',job_targets,'jobTargetTotal',job_target_total,'jobTargetsTruncated',job_target_total>100,
  'consumptionBoundary','Only current reviewed matches may support a later tenant-private observation. No operational record is changed.');
END $$;

CREATE FUNCTION public.canonical_external_labor_reference_match_mutate(org UUID,actor UUID,role_value TEXT,
 session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_external_labor_import_consents%ROWTYPE;
 current_row public.canonical_external_labor_import_reference_matches%ROWTYPE;
 replay_row public.canonical_external_labor_import_reference_matches%ROWTYPE;
 inserted public.canonical_external_labor_import_reference_matches%ROWTYPE;
 source_basis JSONB; target_basis JSONB; key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External labor reconciliation is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['referenceKind','externalReference','action','targetId','expectedRevision','expectedDigest','expectedSourceDigest','expectedTargetDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'referenceKind' NOT IN ('worker','job') OR jsonb_typeof(body->'externalReference') IS DISTINCT FROM 'string'
  OR char_length(body->>'externalReference') NOT BETWEEN 1 AND 128 OR body->>'externalReference'!~'^[!-~]+$'
  OR body->>'action' NOT IN ('link','unlink') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedRevision')!~'^([0-9]{1,3}|[1-9][0-9]{3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string'
  OR (body->>'expectedDigest' IS DISTINCT FROM 'none' AND body->>'expectedDigest'!~'^[0-9a-f]{64}$')
  OR jsonb_typeof(body->'expectedSourceDigest') IS DISTINCT FROM 'string'
  OR (body->>'expectedSourceDigest' IS DISTINCT FROM 'unavailable' AND body->>'expectedSourceDigest'!~'^[0-9a-f]{64}$')
  OR jsonb_typeof(body->'expectedTargetDigest') IS DISTINCT FROM 'string'
  OR (body->>'expectedTargetDigest' IS DISTINCT FROM 'unavailable' AND body->>'expectedTargetDigest'!~'^[0-9a-f]{64}$')
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-labor-reference-match-v1'
  OR (body->>'action'='link' AND (jsonb_typeof(body->'targetId') IS DISTINCT FROM 'string' OR NOT pg_input_is_valid(body->>'targetId','uuid')))
  OR (body->>'action'='unlink' AND body->'targetId'<>'null'::jsonb)
 THEN RAISE EXCEPTION 'External labor reference match invalid' USING ERRCODE='22023'; END IF;
 IF ((body->>'expectedRevision')::bigint=0) IS DISTINCT FROM (body->>'expectedDigest'='none') THEN
  RAISE EXCEPTION 'External labor reference match invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-labor-match:'||source_value||':'||
  (body->>'referenceKind')||':'||(body->>'externalReference'),0));
 SELECT * INTO consent_row FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF consent_row.id IS NULL OR consent_row.action<>'grant' THEN RAISE EXCEPTION 'External labor source consent inactive' USING ERRCODE='40001',CONSTRAINT='learning_match_source_changed'; END IF;
 SELECT * INTO replay_row FROM public.canonical_external_labor_import_reference_matches WHERE organization_id=org
  AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'External labor match key conflict' USING ERRCODE='23505'; END IF;
  source_basis:=public.canonical_external_labor_reference_source_basis(org,source_value,replay_row.reference_kind,replay_row.external_reference);
  target_basis:=public.canonical_external_labor_reference_target_basis(org,replay_row.reference_kind,replay_row.target_id);
  RETURN jsonb_build_object('match',public.canonical_external_labor_reference_match_projection(replay_row,source_basis,target_basis,
   public.canonical_external_labor_import_consent_projection(consent_row)),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_external_labor_import_reference_matches WHERE organization_id=org
  AND source_key=source_value AND reference_kind=body->>'referenceKind' AND external_reference=body->>'externalReference'
  ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'External labor reference match changed' USING ERRCODE='40001',CONSTRAINT='learning_match_stale'; END IF;
 source_basis:=public.canonical_external_labor_reference_source_basis(org,source_value,body->>'referenceKind',body->>'externalReference');
 IF body->>'expectedSourceDigest' IS DISTINCT FROM COALESCE(source_basis->>'digest','unavailable') THEN
  RAISE EXCEPTION 'External labor reference source changed' USING ERRCODE='40001',CONSTRAINT='learning_match_source_changed'; END IF;
 IF body->>'action'='link' THEN
  IF source_basis IS NULL THEN RAISE EXCEPTION 'External labor reference unavailable' USING ERRCODE='22023'; END IF;
  target_basis:=public.canonical_external_labor_reference_target_basis(org,body->>'referenceKind',(body->>'targetId')::uuid);
  IF target_basis IS NULL THEN RAISE EXCEPTION 'External labor match target unavailable' USING ERRCODE='22023'; END IF;
  IF body->>'expectedTargetDigest' IS DISTINCT FROM target_basis->>'digest' THEN
   RAISE EXCEPTION 'External labor match target changed' USING ERRCODE='40001',CONSTRAINT='learning_match_target_changed'; END IF;
 ELSE
  target_basis:=NULL;
  IF current_row.id IS NULL OR current_row.action<>'link' OR body->>'expectedTargetDigest' IS DISTINCT FROM 'unavailable' THEN
   RAISE EXCEPTION 'External labor reference match invalid' USING ERRCODE='22023'; END IF;
 END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'referenceKind',body->>'referenceKind','externalReference',body->>'externalReference','revision',next_revision,
  'previousId',current_row.id,'action',body->>'action','targetId',body->>'targetId','consentId',consent_row.id,
  'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),
  'sourceDigest',COALESCE(source_basis->>'digest','unavailable'),'targetDigest',COALESCE(target_basis->>'digest','unavailable'),
  'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,
  'reason',body->>'reason','confirmationVersion','m25-external-labor-reference-match-v1','requestDigest',request_hash));
 INSERT INTO public.canonical_external_labor_import_reference_matches(organization_id,source_key,consent_id,consent_revision,consent_digest,reference_kind,
  external_reference,revision,previous_id,action,target_id,source_manifest,source_digest,target_digest,actor_user_id,
  membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),body->>'referenceKind',body->>'externalReference',next_revision,current_row.id,body->>'action',
  CASE WHEN body->>'action'='link' THEN (body->>'targetId')::uuid ELSE NULL END,COALESCE(source_basis->'manifest','[]'::jsonb),
  COALESCE(source_basis->>'digest','unavailable'),COALESCE(target_basis->>'digest','unavailable'),actor,
  (authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,'m25-external-labor-reference-match-v1',
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('match',public.canonical_external_labor_reference_match_projection(inserted,source_basis,target_basis,
  public.canonical_external_labor_import_consent_projection(consent_row)),'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_external_labor_import_reference_matches FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_reference_source_basis(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_reference_target_basis(UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_reference_match_projection(public.canonical_external_labor_import_reference_matches,JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_reference_matches_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_labor_reference_match_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
