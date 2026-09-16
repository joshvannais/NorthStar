-- Mission 25 Part 5: tenant-private imported labor-duration outcome observations.
-- Current reviewed source matches may produce an advisory comparison. No operating authority is changed.

CREATE TABLE public.canonical_external_labor_import_learning_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 purpose TEXT NOT NULL CHECK(purpose='imported_labor_duration_variance_v1'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 source_consent_id UUID NOT NULL,
 source_consent_revision BIGINT NOT NULL CHECK(source_consent_revision BETWEEN 1 AND 10000),
 source_consent_digest CHAR(64) NOT NULL CHECK(source_consent_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["canonical_estimates","canonical_estimate_revisions","canonical_external_labor_import_records","canonical_external_labor_import_reference_matches","canonical_labor_plans"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-imported-labor-duration-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,purpose,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_labor_import_learning_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,source_consent_id)
  REFERENCES public.canonical_external_labor_import_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_external_labor_import_outcome_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 estimate_id UUID NOT NULL,
 external_job_reference TEXT NOT NULL CHECK(char_length(external_job_reference) BETWEEN 1 AND 128 AND external_job_reference~'^[!-~]+$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 consent_id UUID NOT NULL,
 consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),
 consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='object' AND octet_length(source_manifest::text)<=1048576),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 planned_worker_hours NUMERIC(14,4) NOT NULL CHECK(planned_worker_hours>0),
 recorded_worker_hours NUMERIC(14,4) NOT NULL CHECK(recorded_worker_hours>0),
 variance_worker_hours NUMERIC(14,4) NOT NULL,
 variance_percent NUMERIC(12,2) NOT NULL,
 advisory_code TEXT NOT NULL CHECK(advisory_code IN ('within_expected_range','actual_above_plan','actual_below_plan')),
 advisory_message TEXT NOT NULL CHECK(public.canonical_learning_text_valid(advisory_message,500)),
 scope_note TEXT NOT NULL CHECK(public.canonical_learning_text_valid(scope_note,1000)),
 adoption_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(adoption_boundary,1000)),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-imported-labor-duration-observation-v1'),
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-imported-labor-duration-variance-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,estimate_id,external_job_reference,revision),
 UNIQUE(organization_id,source_key,estimate_id,external_job_reference,source_digest,consent_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,estimate_id)
  REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_labor_import_outcome_observations(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,consent_id)
  REFERENCES public.canonical_external_labor_import_learning_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(public.canonical_field_evidence_object_keys_exact(source_manifest,
  ARRAY['estimate','estimateRevision','laborPlan','sourceConsent','jobMatch','workerMatches','importedRecords'])),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(source_manifest)),
 CHECK(recorded_worker_hours-planned_worker_hours=variance_worker_hours),
 CHECK(variance_percent=round((variance_worker_hours/planned_worker_hours)*100,2)),
 CHECK(advisory_code=CASE WHEN abs(variance_percent)<=5 THEN 'within_expected_range'
  WHEN variance_percent>0 THEN 'actual_above_plan' ELSE 'actual_below_plan' END)
);

CREATE TRIGGER canonical_external_labor_import_learning_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_labor_import_learning_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_labor_import_outcomes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_labor_import_outcome_observations FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_imported_labor_learning_consent_projection(
 value public.canonical_external_labor_import_learning_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'purpose',value.purpose,'revision',value.revision,
  'previousId',value.previous_id,'action',value.action,'sourceConsent',jsonb_build_object('id',value.source_consent_id,
   'revision',value.source_consent_revision,'digest',rtrim(value.source_consent_digest)),
  'sourceScope',value.source_scope,'consentVersion',value.consent_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_imported_labor_learning_consent_read(org UUID,actor UUID,role_value TEXT,
 session_value UUID,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_labor_import_consents%ROWTYPE;
 current_row public.canonical_external_labor_import_learning_consents%ROWTYPE; history JSONB; total BIGINT; active_value BOOLEAN;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External labor source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO source_consent FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO current_row FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1;
 active_value:=source_consent.id IS NOT NULL AND source_consent.action='grant' AND current_row.id IS NOT NULL
  AND current_row.action='grant' AND current_row.source_consent_id=source_consent.id
  AND rtrim(current_row.source_consent_digest)=rtrim(source_consent.canonical_digest);
 SELECT count(*) INTO total FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_labor_duration_variance_v1';
 SELECT COALESCE(jsonb_agg(public.canonical_imported_labor_learning_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
   AND source_key=source_value AND purpose='imported_labor_duration_variance_v1' ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'active',active_value,'current',CASE WHEN current_row.id IS NULL THEN NULL
  ELSE public.canonical_imported_labor_learning_consent_projection(current_row) END,'history',history,'total',total,
  'truncated',total>20,'blockedReason',CASE WHEN active_value THEN NULL WHEN source_consent.id IS NULL OR source_consent.action<>'grant'
   THEN 'External labor source consent is not active.' WHEN current_row.id IS NOT NULL AND current_row.action='grant'
   THEN 'Imported labor learning consent must be renewed for the current source consent.' ELSE 'Imported labor learning consent is not active.' END);
END $$;

CREATE FUNCTION public.canonical_imported_labor_learning_consent_mutate(org UUID,actor UUID,role_value TEXT,
 session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_consent public.canonical_external_labor_import_consents%ROWTYPE;
 current_row public.canonical_external_labor_import_learning_consents%ROWTYPE;
 replay_row public.canonical_external_labor_import_learning_consents%ROWTYPE;
 inserted public.canonical_external_labor_import_learning_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT; currently_active BOOLEAN;
 scope_value JSONB:='["canonical_estimates","canonical_estimate_revisions","canonical_external_labor_import_records","canonical_external_labor_import_reference_matches","canonical_labor_plans"]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string'
  OR (body->>'expectedDigest' IS DISTINCT FROM 'none' AND body->>'expectedDigest'!~'^[0-9a-f]{64}$')
  OR (((body->>'expectedRevision')::bigint=0) IS DISTINCT FROM (body->>'expectedDigest'='none'))
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-imported-labor-duration-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Imported learning consent input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-labor-learning-consent:'||source_value,0));
 SELECT * INTO replay_row FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported learning consent key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('consent',public.canonical_imported_labor_learning_consent_projection(replay_row),'replayed',TRUE);
 END IF;
 SELECT * INTO source_consent FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF source_consent.id IS NULL THEN RAISE EXCEPTION 'External labor source consent unavailable' USING ERRCODE='40001',CONSTRAINT='imported_learning_source_consent_stale'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Imported learning consent changed' USING ERRCODE='40001',CONSTRAINT='imported_learning_consent_stale'; END IF;
 currently_active:=current_row.id IS NOT NULL AND current_row.action='grant' AND source_consent.action='grant'
  AND current_row.source_consent_id=source_consent.id AND rtrim(current_row.source_consent_digest)=rtrim(source_consent.canonical_digest);
 IF body->>'action'='grant' AND source_consent.action<>'grant' THEN
  RAISE EXCEPTION 'External labor source consent inactive' USING ERRCODE='40001',CONSTRAINT='imported_learning_source_consent_stale'; END IF;
 IF body->>'action'='grant' AND currently_active THEN RAISE EXCEPTION 'Imported learning consent is already active' USING ERRCODE='22023'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN
  RAISE EXCEPTION 'No imported learning consent' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'purpose','imported_labor_duration_variance_v1','revision',next_revision,'previousId',current_row.id,
  'action',body->>'action','sourceConsentId',source_consent.id,'sourceConsentRevision',source_consent.revision,
  'sourceConsentDigest',rtrim(source_consent.canonical_digest),'actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,
  'consentVersion','m25-imported-labor-duration-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_labor_import_learning_consents(organization_id,source_key,purpose,revision,
  previous_id,action,source_consent_id,source_consent_revision,source_consent_digest,actor_user_id,membership_id,
  auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,'imported_labor_duration_variance_v1',next_revision,current_row.id,body->>'action',
  source_consent.id,source_consent.revision,rtrim(source_consent.canonical_digest),actor,(authority->>'membershipId')::uuid,
  session_value,scope_value,'m25-imported-labor-duration-consent-v1',body->>'reason',key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_imported_labor_learning_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_imported_labor_learning_basis(org UUID,source_value TEXT,estimate UUID,job_reference_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE estimate_row public.canonical_estimates%ROWTYPE; revision_row public.canonical_estimate_revisions%ROWTYPE;
 plan_row public.canonical_labor_plans%ROWTYPE; source_consent public.canonical_external_labor_import_consents%ROWTYPE;
 job_match public.canonical_external_labor_import_reference_matches%ROWTYPE; job_source JSONB; job_target JSONB; job_projection JSONB;
 worker_matches JSONB; imported_records JSONB; record_total BIGINT; worker_total BIGINT; invalid_workers BIGINT;
 planned NUMERIC; actual NUMERIC; variance NUMERIC; variance_percent NUMERIC; code TEXT; message TEXT;
 source_manifest JSONB; source_digest_value TEXT;
BEGIN
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR job_reference_value IS NULL
  OR char_length(job_reference_value) NOT BETWEEN 1 AND 128 OR job_reference_value!~'^[!-~]+$' THEN
  RAISE EXCEPTION 'Imported labor source identity invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO estimate_row FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO revision_row FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate
  AND labor_plan_id IS NOT NULL ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted labor plan is required' USING ERRCODE='P0002',CONSTRAINT='imported_learning_labor_plan_unavailable'; END IF;
 SELECT * INTO plan_row FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate
  AND id=revision_row.labor_plan_id AND action='save';
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted labor plan is required' USING ERRCODE='P0002',CONSTRAINT='imported_learning_labor_plan_unavailable'; END IF;
 SELECT * INTO source_consent FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' THEN
  RAISE EXCEPTION 'External labor source consent inactive' USING ERRCODE='P0002',CONSTRAINT='imported_learning_source_consent_unavailable'; END IF;
 SELECT * INTO job_match FROM public.canonical_external_labor_import_reference_matches WHERE organization_id=org
  AND source_key=source_value AND reference_kind='job' AND external_reference=job_reference_value ORDER BY revision DESC LIMIT 1;
 job_source:=public.canonical_external_labor_reference_source_basis(org,source_value,'job',job_reference_value);
 job_target:=public.canonical_external_labor_reference_target_basis(org,'job',job_match.target_id);
 IF job_match.id IS NULL THEN RAISE EXCEPTION 'Reviewed job match is required' USING ERRCODE='P0002',CONSTRAINT='imported_learning_match_unavailable'; END IF;
 job_projection:=public.canonical_external_labor_reference_match_projection(job_match,job_source,job_target,
  public.canonical_external_labor_import_consent_projection(source_consent));
 IF job_projection->>'status'<>'matched' OR job_match.target_id<>estimate THEN
  RAISE EXCEPTION 'Current reviewed job match is required' USING ERRCODE='P0002',CONSTRAINT='imported_learning_match_stale'; END IF;
 WITH current_records AS (
  SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
   WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC
 ), job_records AS (
  SELECT * FROM current_records WHERE state='active' AND job_reference=job_reference_value
 ) SELECT count(*),round(COALESCE(sum(extract(epoch FROM observed_end-observed_start)),0)::numeric/3600,4)
 INTO record_total,actual FROM job_records;
 IF record_total=0 OR record_total>1000 OR actual<=0 THEN
  RAISE EXCEPTION 'Imported labor records are unavailable' USING ERRCODE='P0002',CONSTRAINT='imported_learning_records_unavailable'; END IF;
 IF EXISTS(WITH current_records AS (
   SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
    WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC
  ), job_records AS (SELECT * FROM current_records WHERE state='active' AND job_reference=job_reference_value)
  SELECT 1 FROM job_records a JOIN job_records b ON a.worker_reference=b.worker_reference AND a.id<b.id
   AND tstzrange(a.observed_start,a.observed_end,'[)') && tstzrange(b.observed_start,b.observed_end,'[)')) THEN
  RAISE EXCEPTION 'Imported labor intervals overlap' USING ERRCODE='P0002',CONSTRAINT='imported_learning_records_overlap'; END IF;
 WITH current_records AS (
  SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
   WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC
 ), refs AS (SELECT DISTINCT worker_reference FROM current_records WHERE state='active' AND job_reference=job_reference_value),
 latest AS (SELECT DISTINCT ON (external_reference) * FROM public.canonical_external_labor_import_reference_matches
  WHERE organization_id=org AND source_key=source_value AND reference_kind='worker' ORDER BY external_reference,revision DESC),
 evaluated AS (SELECT r.worker_reference,m.*,
  public.canonical_external_labor_reference_match_projection(m,
   public.canonical_external_labor_reference_source_basis(org,source_value,'worker',r.worker_reference),
   public.canonical_external_labor_reference_target_basis(org,'worker',m.target_id),
   public.canonical_external_labor_import_consent_projection(source_consent)) projection
  FROM refs r LEFT JOIN latest m ON m.external_reference=r.worker_reference)
 SELECT count(*),count(*) FILTER(WHERE id IS NULL OR projection->>'status'<>'matched'),
  COALESCE(jsonb_agg(jsonb_build_object('externalWorkerReference',worker_reference,'matchId',id,'matchRevision',revision,
   'matchDigest',CASE WHEN id IS NULL THEN NULL ELSE rtrim(canonical_digest) END,'workforceProfileId',target_id,
   'status',COALESCE(projection->>'status','unmatched')) ORDER BY worker_reference),'[]'::jsonb)
 INTO worker_total,invalid_workers,worker_matches FROM evaluated;
 IF worker_total=0 OR invalid_workers>0 THEN RAISE EXCEPTION 'Current reviewed worker matches are required'
  USING ERRCODE='P0002',CONSTRAINT='imported_learning_match_stale'; END IF;
 WITH current_records AS (
  SELECT DISTINCT ON (external_record_id) * FROM public.canonical_external_labor_import_records
   WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC
 ), job_records AS (SELECT * FROM current_records WHERE state='active' AND job_reference=job_reference_value)
 SELECT jsonb_agg(jsonb_build_object('id',id,'externalRecordId',external_record_id,'revision',revision,
  'externalVersion',external_version,'sourceDigest',rtrim(source_digest),'workerReference',worker_reference,
  'category',category,'observedStart',observed_start,'observedEnd',observed_end,
  'durationSeconds',floor(extract(epoch FROM observed_end-observed_start))::bigint) ORDER BY external_record_id)
 INTO imported_records FROM job_records;
 planned:=public.canonical_labor_plan_worker_hours(plan_row.inputs);
 IF planned<=0 THEN RAISE EXCEPTION 'Planned labor hours are required' USING ERRCODE='P0002',CONSTRAINT='imported_learning_labor_plan_unavailable'; END IF;
 variance:=round(actual-planned,4);variance_percent:=round((variance/planned)*100,2);
 IF abs(variance_percent)<=5 THEN code:='within_expected_range';message:='Imported worker hours were within 5% of the adopted labor plan.';
 ELSIF variance_percent>0 THEN code:='actual_above_plan';message:='Imported worker hours were higher than the adopted labor plan.';
 ELSE code:='actual_below_plan';message:='Imported worker hours were lower than the adopted labor plan.'; END IF;
 source_manifest:=jsonb_build_object(
  'estimate',jsonb_build_object('id',estimate_row.id,'digest',rtrim(estimate_row.snapshot_digest)),
  'estimateRevision',jsonb_build_object('id',revision_row.id,'revision',revision_row.revision,'digest',revision_row.digest),
  'laborPlan',jsonb_build_object('id',plan_row.id,'revision',plan_row.revision,'digest',plan_row.digest),
  'sourceConsent',jsonb_build_object('id',source_consent.id,'revision',source_consent.revision,'digest',rtrim(source_consent.canonical_digest)),
  'jobMatch',jsonb_build_object('id',job_match.id,'revision',job_match.revision,'digest',rtrim(job_match.canonical_digest),
   'externalJobReference',job_reference_value,'estimateId',job_match.target_id),
  'workerMatches',worker_matches,'importedRecords',imported_records);
 source_digest_value:=public.canonical_completion_digest(source_manifest);
 RETURN jsonb_build_object('sourceManifest',source_manifest,'sourceDigest',source_digest_value,
  'plannedWorkerHours',planned::text,'recordedWorkerHours',actual::text,'varianceWorkerHours',variance::text,
  'variancePercent',variance_percent::text,'advisoryCode',code,'advisoryMessage',message,
  'scopeNote','Imported worker hours include current setup, production, cleanup, travel and other work intervals. Overlapping intervals fail review.',
  'adoptionBoundary','Review this imported evidence before changing future labor assumptions. No rate, estimate, schedule or policy was changed.');
END $$;

CREATE FUNCTION public.canonical_imported_labor_outcome_projection(value public.canonical_external_labor_import_outcome_observations)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'estimateId',value.estimate_id,
  'externalJobReference',value.external_job_reference,'revision',value.revision,'previousId',value.previous_id,
  'consent',jsonb_build_object('id',value.consent_id,'revision',value.consent_revision,'digest',rtrim(value.consent_digest)),
  'sourceManifest',value.source_manifest,'sourceDigest',rtrim(value.source_digest),
  'plannedWorkerHours',value.planned_worker_hours::text,'recordedWorkerHours',value.recorded_worker_hours::text,
  'varianceWorkerHours',value.variance_worker_hours::text,'variancePercent',value.variance_percent::text,
  'advisoryCode',value.advisory_code,'advisoryMessage',value.advisory_message,'scopeNote',value.scope_note,
  'adoptionBoundary',value.adoption_boundary,'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,
  'calculationVersion',value.calculation_version,'reason',value.reason,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_imported_labor_outcome_observe(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,source_value TEXT,estimate UUID,job_reference TEXT,expected_consent_revision BIGINT,
 expected_consent_digest TEXT,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_consent public.canonical_external_labor_import_consents%ROWTYPE;
 consent_row public.canonical_external_labor_import_learning_consents%ROWTYPE;
 current_row public.canonical_external_labor_import_outcome_observations%ROWTYPE;
 replay_row public.canonical_external_labor_import_outcome_observations%ROWTYPE;
 inserted public.canonical_external_labor_import_outcome_observations%ROWTYPE;
 basis JSONB; next_revision BIGINT; key_hash TEXT; request_hash TEXT; digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported learning review is restricted' USING ERRCODE='42501'; END IF;
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR job_reference IS NULL
  OR char_length(job_reference) NOT BETWEEN 1 AND 128 OR job_reference!~'^[!-~]+$'
  OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR expected_consent_revision IS NULL OR expected_consent_revision NOT BETWEEN 1 AND 10000
  OR expected_consent_digest IS NULL OR expected_consent_digest!~'^[0-9a-f]{64}$'
  OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE
  OR confirmation_version_value IS DISTINCT FROM 'm25-imported-labor-duration-observation-v1' THEN
  RAISE EXCEPTION 'Imported labor observation input invalid' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-labor-outcome:'||source_value||':'||estimate::text||':'||job_reference,0));
 SELECT * INTO source_consent FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO consent_row FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant'
  OR consent_row.source_consent_id<>source_consent.id OR rtrim(consent_row.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR consent_row.revision<>expected_consent_revision OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM expected_consent_digest THEN
  RAISE EXCEPTION 'Active imported learning consent changed' USING ERRCODE='40001',CONSTRAINT='imported_learning_consent_stale'; END IF;
 basis:=public.canonical_imported_labor_learning_basis(org,source_value,estimate,job_reference);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'sourceKey',source_value,'estimateId',estimate,'externalJobReference',job_reference,
  'consentRevision',expected_consent_revision,'consentDigest',expected_consent_digest,'reason',reason_value,
  'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value,'sourceDigest',basis->>'sourceDigest'));
 SELECT * INTO replay_row FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported labor observation key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('observation',public.canonical_imported_labor_outcome_projection(replay_row),'replayed',TRUE);
 END IF;
 SELECT * INTO replay_row FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  AND source_key=source_value AND estimate_id=estimate AND external_job_reference=job_reference
  AND source_digest=(basis->>'sourceDigest')::char(64) AND consent_id=consent_row.id;
 IF FOUND THEN RAISE EXCEPTION 'The current imported labor outcome was already observed'
  USING ERRCODE='22023',CONSTRAINT='imported_learning_outcome_already_current'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  AND source_key=source_value AND estimate_id=estimate AND external_job_reference=job_reference ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'estimateId',estimate,'externalJobReference',job_reference,'revision',next_revision,'previousId',current_row.id,
  'consentId',consent_row.id,'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),
  'sourceDigest',basis->>'sourceDigest','plannedWorkerHours',basis->>'plannedWorkerHours',
  'recordedWorkerHours',basis->>'recordedWorkerHours','varianceWorkerHours',basis->>'varianceWorkerHours',
  'variancePercent',basis->>'variancePercent','advisoryCode',basis->>'advisoryCode','actorUserId',actor,
  'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_labor_import_outcome_observations(organization_id,source_key,estimate_id,
  external_job_reference,revision,previous_id,consent_id,consent_revision,consent_digest,source_manifest,source_digest,
  planned_worker_hours,recorded_worker_hours,variance_worker_hours,variance_percent,advisory_code,advisory_message,
  scope_note,adoption_boundary,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,
  calculation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,estimate,job_reference,next_revision,current_row.id,consent_row.id,consent_row.revision,
  rtrim(consent_row.canonical_digest),basis->'sourceManifest',basis->>'sourceDigest',(basis->>'plannedWorkerHours')::numeric,
  (basis->>'recordedWorkerHours')::numeric,(basis->>'varianceWorkerHours')::numeric,(basis->>'variancePercent')::numeric,
  basis->>'advisoryCode',basis->>'advisoryMessage',basis->>'scopeNote',basis->>'adoptionBoundary',actor,
  (authority->>'membershipId')::uuid,session_value,reason_value,confirmed_value,confirmation_version_value,
  'm25-imported-labor-duration-variance-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('observation',public.canonical_imported_labor_outcome_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_imported_labor_outcome_read(org UUID,actor UUID,role_value TEXT,session_value UUID,
 source_value TEXT,estimate UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_labor_import_consents%ROWTYPE;
 consent_row public.canonical_external_labor_import_learning_consents%ROWTYPE;
 current_row public.canonical_external_labor_import_outcome_observations%ROWTYPE;
 basis JSONB; fresh BOOLEAN; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External labor source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO source_consent FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO consent_row FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant'
  OR consent_row.source_consent_id<>source_consent.id OR rtrim(consent_row.source_consent_digest)<>rtrim(source_consent.canonical_digest) THEN
  RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,
   'total',0,'truncated',FALSE,'blockedReason','Current source and imported labor learning consent are required.'); END IF;
 SELECT * INTO current_row FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  AND source_key=source_value AND estimate_id=estimate ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,
  'consent',public.canonical_imported_labor_learning_consent_projection(consent_row),'current',NULL,'history','[]'::jsonb,
  'total',0,'truncated',FALSE,'refreshRequired',TRUE); END IF;
 BEGIN basis:=public.canonical_imported_labor_learning_basis(org,source_value,estimate,current_row.external_job_reference);
  fresh:=rtrim(current_row.source_digest)=basis->>'sourceDigest' AND current_row.consent_id=consent_row.id;
 EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;fresh:=FALSE; END;
 SELECT count(*) INTO total FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  AND source_key=source_value AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(public.canonical_imported_labor_outcome_projection(item)||jsonb_build_object(
  'fresh',rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id,
  'advisoryAvailable',rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id,
  'advisoryCode',CASE WHEN rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id THEN item.advisory_code ELSE NULL END,
  'advisoryMessage',CASE WHEN rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id THEN item.advisory_message ELSE NULL END)
  ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  AND source_key=source_value AND estimate_id=estimate ORDER BY created_at DESC,id DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,
  'consent',public.canonical_imported_labor_learning_consent_projection(consent_row),
  'current',public.canonical_imported_labor_outcome_projection(current_row)||jsonb_build_object('fresh',fresh,
   'advisoryAvailable',fresh,'advisoryCode',CASE WHEN fresh THEN current_row.advisory_code ELSE NULL END,
   'advisoryMessage',CASE WHEN fresh THEN current_row.advisory_message ELSE NULL END),
  'history',history,'total',total,'truncated',total>20,'refreshRequired',NOT fresh);
END $$;

REVOKE ALL ON TABLE public.canonical_external_labor_import_learning_consents,
 public.canonical_external_labor_import_outcome_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_labor_learning_consent_projection(public.canonical_external_labor_import_learning_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_labor_learning_basis(UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_labor_outcome_projection(public.canonical_external_labor_import_outcome_observations) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_labor_learning_consent_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_labor_learning_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_labor_outcome_observe(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID,TEXT,BIGINT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_labor_outcome_read(UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
