-- Mission 25 Part 2: tenant-private labor-duration outcome observation.
-- This package records exact authorized evidence and a deterministic advisory.
-- It does not change estimates, rates, schedules, payroll, or business policy.

CREATE FUNCTION public.canonical_learning_text_valid(value TEXT, maximum INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value IS NOT NULL AND value=btrim(value) AND value=normalize(value,NFC)
  AND char_length(value) BETWEEN 1 AND maximum AND octet_length(value)<=maximum*4
  AND value!~U&'[\0001-\0008\000B\000C\000E-\001F\007F]'
$$;

CREATE TABLE public.canonical_learning_purpose_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose='labor_duration_variance_v1'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["canonical_completion_records","canonical_estimate_revisions","canonical_estimates","canonical_field_executions","canonical_labor_intervals","canonical_labor_plans"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-labor-duration-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,purpose,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_learning_purpose_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE FUNCTION public.canonical_learning_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Canonical learning history is immutable'
 USING ERRCODE='23514',CONSTRAINT='canonical_learning_history_immutable'; END $$;
CREATE TRIGGER canonical_learning_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_learning_purpose_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_learning_consent_projection(value public.canonical_learning_purpose_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'purpose',value.purpose,'revision',value.revision,
  'previousId',value.previous_id,'action',value.action,'sourceScope',value.source_scope,
  'consentVersion',value.consent_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_learning_consent_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_learning_purpose_consents%ROWTYPE; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO current_row FROM public.canonical_learning_purpose_consents
  WHERE organization_id=org AND purpose='labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_learning_purpose_consents
  WHERE organization_id=org AND purpose='labor_duration_variance_v1';
 SELECT COALESCE(jsonb_agg(public.canonical_learning_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_learning_purpose_consents
   WHERE organization_id=org AND purpose='labor_duration_variance_v1' ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_learning_consent_projection(current_row) END,
  'active',COALESCE(current_row.action='grant',FALSE),'history',history,'total',total,'truncated',total>20);
END $$;

CREATE FUNCTION public.canonical_learning_consent_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_learning_purpose_consents%ROWTYPE;
 old public.canonical_learning_purpose_consents%ROWTYPE; inserted public.canonical_learning_purpose_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; digest_value TEXT;
 scope_value JSONB:='["canonical_completion_records","canonical_estimate_revisions","canonical_estimates","canonical_field_executions","canonical_labor_intervals","canonical_labor_plans"]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string'
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-labor-duration-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Learning consent input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':labor-learning-consent',0));
 SELECT * INTO old FROM public.canonical_learning_purpose_consents
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'Learning consent key conflict' USING ERRCODE='23505'; END IF;
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('consent',public.canonical_learning_consent_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_learning_purpose_consents
  WHERE organization_id=org AND purpose='labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Learning consent changed' USING ERRCODE='40001',CONSTRAINT='learning_consent_stale'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN
  RAISE EXCEPTION 'No active learning consent' USING ERRCODE='22023'; END IF;
 IF body->>'action'='grant' AND current_row.action='grant' THEN
  RAISE EXCEPTION 'Learning consent is already active' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'purpose','labor_duration_variance_v1',
  'revision',next_revision,'previousId',current_row.id,'action',body->>'action','actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,
  'consentVersion','m25-labor-duration-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_learning_purpose_consents(organization_id,purpose,revision,previous_id,action,
  actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,'labor_duration_variance_v1',next_revision,current_row.id,body->>'action',actor,
  (authority->>'membershipId')::uuid,session_value,scope_value,'m25-labor-duration-consent-v1',body->>'reason',
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_learning_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_labor_plan_worker_hours(inputs JSONB)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE line JSONB; total NUMERIC:=0;
BEGIN
 PERFORM public.canonical_labor_plan_validate(inputs);
 FOR line IN SELECT value FROM jsonb_array_elements(inputs->'lines') LOOP
  total:=total+CASE line->>'basis'
   WHEN 'worker_hours' THEN (line->>'workerHours')::numeric
   WHEN 'people_time' THEN (line->>'people')::numeric*(line->>'elapsedHours')::numeric
   ELSE (line->>'quantity')::numeric*(line->>'hoursPerUnit')::numeric END;
 END LOOP;
 RETURN round(total,4);
END $$;

CREATE FUNCTION public.canonical_labor_learning_basis(org UUID,estimate UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE estimate_row public.canonical_estimates%ROWTYPE; revision_row public.canonical_estimate_revisions%ROWTYPE;
 plan_row public.canonical_labor_plans%ROWTYPE; execution_row public.canonical_field_executions%ROWTYPE;
 completion_row public.canonical_completion_records%ROWTYPE; interval_manifest JSONB; interval_total BIGINT;
 planned NUMERIC; actual NUMERIC; source_value JSONB; source_digest TEXT; variance NUMERIC; variance_percent NUMERIC;
 code TEXT; message TEXT;
BEGIN
 SELECT * INTO estimate_row FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO revision_row FROM public.canonical_estimate_revisions
  WHERE organization_id=org AND estimate_id=estimate AND labor_plan_id IS NOT NULL ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted labor plan is required' USING ERRCODE='P0002',CONSTRAINT='learning_labor_plan_unavailable'; END IF;
 SELECT * INTO plan_row FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate
  AND id=revision_row.labor_plan_id AND action='save';
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted labor plan is required' USING ERRCODE='P0002',CONSTRAINT='learning_labor_plan_unavailable'; END IF;
 SELECT * INTO execution_row FROM public.canonical_field_executions WHERE organization_id=org
  AND opportunity_id=estimate_row.opportunity_id ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND OR execution_row.lifecycle_state<>'completed' THEN
  RAISE EXCEPTION 'Completed work is required' USING ERRCODE='P0002',CONSTRAINT='learning_completion_unavailable'; END IF;
 SELECT * INTO completion_row FROM public.canonical_completion_records WHERE organization_id=org
  AND execution_id=execution_row.id AND lifecycle_after='completed' ORDER BY decided_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completed work is required' USING ERRCODE='P0002',CONSTRAINT='learning_completion_unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_labor_intervals interval_value WHERE interval_value.organization_id=org
   AND interval_value.execution_id=execution_row.id AND interval_value.review_state<>'rejected'
   AND (interval_value.observed_end IS NULL OR interval_value.review_state<>'accepted')) THEN
  RAISE EXCEPTION 'Labor records need review' USING ERRCODE='P0002',CONSTRAINT='learning_labor_review_incomplete'; END IF;
 SELECT count(*) FILTER(WHERE interval_value.review_state='accepted' AND interval_value.category_code<>'break'),
   COALESCE(jsonb_agg(jsonb_build_object('id',interval_value.id,'revision',interval_value.revision,
   'digest',rtrim(interval_value.canonical_digest),'category',interval_value.category_code,
   'reviewState',interval_value.review_state,
   'includedInWorkerHours',interval_value.review_state='accepted' AND interval_value.category_code<>'break',
   'exclusionReason',CASE WHEN interval_value.review_state='rejected' THEN 'rejected'
     WHEN interval_value.category_code='break' THEN 'break' ELSE NULL END,
   'observedStart',interval_value.observed_start,'observedEnd',interval_value.observed_end,
   'durationSeconds',floor(extract(epoch FROM interval_value.observed_end-interval_value.observed_start))::bigint)
   ORDER BY interval_value.id),'[]'::jsonb),
   round(COALESCE(sum(extract(epoch FROM interval_value.observed_end-interval_value.observed_start)) FILTER
    (WHERE interval_value.review_state='accepted' AND interval_value.category_code<>'break'),0)::numeric/3600,4)
  INTO interval_total,interval_manifest,actual
 FROM public.canonical_labor_intervals interval_value WHERE interval_value.organization_id=org
  AND interval_value.execution_id=execution_row.id;
 IF interval_total=0 OR actual<=0 THEN RAISE EXCEPTION 'Accepted non-break labor records are required'
  USING ERRCODE='P0002',CONSTRAINT='learning_labor_outcome_unavailable'; END IF;
 planned:=public.canonical_labor_plan_worker_hours(plan_row.inputs);
 IF planned<=0 THEN RAISE EXCEPTION 'Planned labor hours are required'
  USING ERRCODE='P0002',CONSTRAINT='learning_labor_plan_unavailable'; END IF;
 variance:=round(actual-planned,4); variance_percent:=round((variance/planned)*100,2);
 IF abs(variance_percent)<=5 THEN code:='within_expected_range';message:='Recorded worker hours were within 5% of the adopted labor plan.';
 ELSIF variance_percent>0 THEN code:='actual_above_plan';message:='Recorded worker hours were higher than the adopted labor plan.';
 ELSE code:='actual_below_plan';message:='Recorded worker hours were lower than the adopted labor plan.'; END IF;
 source_value:=jsonb_build_object(
  'estimate',jsonb_build_object('id',estimate_row.id,'digest',rtrim(estimate_row.snapshot_digest)),
  'estimateRevision',jsonb_build_object('id',revision_row.id,'revision',revision_row.revision,'digest',revision_row.digest),
  'laborPlan',jsonb_build_object('id',plan_row.id,'revision',plan_row.revision,'digest',plan_row.digest),
  'execution',jsonb_build_object('id',execution_row.id,'revision',execution_row.revision,'digest',rtrim(execution_row.canonical_digest)),
  'completion',jsonb_build_object('id',completion_row.id,'revision',completion_row.revision,'digest',rtrim(completion_row.canonical_digest)),
  'laborIntervals',interval_manifest);
 source_digest:=public.canonical_completion_digest(source_value);
 RETURN jsonb_build_object('sourceManifest',source_value,'sourceDigest',source_digest,
  'plannedWorkerHours',planned::text,'recordedWorkerHoursExcludingBreaks',actual::text,
  'varianceWorkerHours',variance::text,'variancePercent',variance_percent::text,
  'advisoryCode',code,'advisoryMessage',message,
  'scopeNote','Recorded worker hours include accepted setup, production, cleanup, travel and other work intervals. Break intervals are excluded.',
  'adoptionBoundary','Review this evidence before changing future labor assumptions. No rate, estimate, schedule or policy was changed.');
END $$;

CREATE TABLE public.canonical_labor_outcome_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 consent_id UUID NOT NULL,
 consent_revision BIGINT NOT NULL,
 consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='object' AND octet_length(source_manifest::text)<=131072),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 planned_worker_hours NUMERIC(14,4) NOT NULL CHECK(planned_worker_hours>0),
 recorded_worker_hours NUMERIC(14,4) NOT NULL CHECK(recorded_worker_hours>=0),
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
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-labor-duration-variance-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,estimate_id,source_digest),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_labor_outcome_observations(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,consent_id) REFERENCES public.canonical_learning_purpose_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(public.canonical_field_evidence_object_keys_exact(source_manifest,
   ARRAY['estimate','estimateRevision','laborPlan','execution','completion','laborIntervals'])),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(source_manifest)),
 CHECK(recorded_worker_hours-planned_worker_hours=variance_worker_hours),
 CHECK(variance_percent=round((variance_worker_hours/planned_worker_hours)*100,2)),
 CHECK(advisory_code=CASE WHEN abs(variance_percent)<=5 THEN 'within_expected_range'
   WHEN variance_percent>0 THEN 'actual_above_plan' ELSE 'actual_below_plan' END)
);
CREATE TRIGGER canonical_labor_outcomes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_labor_outcome_observations FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_labor_outcome_projection(value public.canonical_labor_outcome_observations)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'estimateId',value.estimate_id,'revision',value.revision,
  'previousId',value.previous_id,'consent',jsonb_build_object('id',value.consent_id,'revision',value.consent_revision,'digest',rtrim(value.consent_digest)),
  'sourceManifest',value.source_manifest,'sourceDigest',rtrim(value.source_digest),
  'plannedWorkerHours',value.planned_worker_hours::text,'recordedWorkerHoursExcludingBreaks',value.recorded_worker_hours::text,
  'varianceWorkerHours',value.variance_worker_hours::text,'variancePercent',value.variance_percent::text,
  'advisoryCode',value.advisory_code,'advisoryMessage',value.advisory_message,
  'scopeNote',value.scope_note,'adoptionBoundary',value.adoption_boundary,
  'calculationVersion',value.calculation_version,'reason',value.reason,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_labor_outcome_observe(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,estimate UUID,expected_consent_revision BIGINT,expected_consent_digest TEXT,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_learning_purpose_consents%ROWTYPE;
 current_row public.canonical_labor_outcome_observations%ROWTYPE; old public.canonical_labor_outcome_observations%ROWTYPE;
 inserted public.canonical_labor_outcome_observations%ROWTYPE; basis JSONB; next_revision BIGINT;
 key_hash TEXT; request_hash TEXT; digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Learning review is restricted' USING ERRCODE='42501'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE THEN
  RAISE EXCEPTION 'Learning observation input invalid' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':labor-learning-observation:'||estimate::text,0));
 SELECT * INTO consent_row FROM public.canonical_learning_purpose_consents
  WHERE organization_id=org AND purpose='labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF NOT FOUND OR consent_row.action<>'grant' OR consent_row.revision<>expected_consent_revision
  OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM expected_consent_digest THEN
  RAISE EXCEPTION 'Active learning consent changed' USING ERRCODE='40001',CONSTRAINT='learning_consent_stale'; END IF;
 basis:=public.canonical_labor_learning_basis(org,estimate);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'estimateId',estimate,'consentRevision',expected_consent_revision,'consentDigest',expected_consent_digest,
  'reason',reason_value,'sourceDigest',basis->>'sourceDigest'));
 SELECT * INTO old FROM public.canonical_labor_outcome_observations
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'Learning observation key conflict' USING ERRCODE='23505'; END IF;
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('observation',public.canonical_labor_outcome_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO old FROM public.canonical_labor_outcome_observations WHERE organization_id=org
  AND estimate_id=estimate AND source_digest=(basis->>'sourceDigest')::char(64);
 IF FOUND THEN RAISE EXCEPTION 'The current labor outcome was already observed'
  USING ERRCODE='22023',CONSTRAINT='learning_labor_outcome_already_current'; END IF;
 SELECT * INTO current_row FROM public.canonical_labor_outcome_observations
  WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'estimateId',estimate,
  'revision',next_revision,'previousId',current_row.id,'consentId',consent_row.id,'consentRevision',consent_row.revision,
  'consentDigest',rtrim(consent_row.canonical_digest),'sourceDigest',basis->>'sourceDigest',
  'plannedWorkerHours',basis->>'plannedWorkerHours','recordedWorkerHours',basis->>'recordedWorkerHoursExcludingBreaks',
  'varianceWorkerHours',basis->>'varianceWorkerHours','variancePercent',basis->>'variancePercent',
  'advisoryCode',basis->>'advisoryCode','actorUserId',actor,'requestDigest',request_hash));
 INSERT INTO public.canonical_labor_outcome_observations(organization_id,estimate_id,revision,previous_id,
  consent_id,consent_revision,consent_digest,source_manifest,source_digest,planned_worker_hours,recorded_worker_hours,
  variance_worker_hours,variance_percent,advisory_code,advisory_message,scope_note,adoption_boundary,
  actor_user_id,membership_id,auth_session_id,reason,calculation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,estimate,next_revision,current_row.id,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),
  basis->'sourceManifest',basis->>'sourceDigest',(basis->>'plannedWorkerHours')::numeric,
  (basis->>'recordedWorkerHoursExcludingBreaks')::numeric,(basis->>'varianceWorkerHours')::numeric,
  (basis->>'variancePercent')::numeric,basis->>'advisoryCode',basis->>'advisoryMessage',basis->>'scopeNote',
  basis->>'adoptionBoundary',actor,(authority->>'membershipId')::uuid,session_value,reason_value,
  'm25-labor-duration-variance-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('observation',public.canonical_labor_outcome_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_labor_outcome_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_learning_purpose_consents%ROWTYPE;
 current_row public.canonical_labor_outcome_observations%ROWTYPE; basis JSONB; fresh BOOLEAN; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO consent_row FROM public.canonical_learning_purpose_consents WHERE organization_id=org
  AND purpose='labor_duration_variance_v1' ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR consent_row.action<>'grant' THEN RETURN jsonb_build_object('activeConsent',FALSE,'current',NULL,
  'history','[]'::jsonb,'total',0,'truncated',FALSE,'blockedReason','Learning consent is not active.'); END IF;
 SELECT * INTO current_row FROM public.canonical_labor_outcome_observations WHERE organization_id=org
  AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('activeConsent',TRUE,'consent',public.canonical_learning_consent_projection(consent_row),
  'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'refreshRequired',TRUE); END IF;
 BEGIN basis:=public.canonical_labor_learning_basis(org,estimate);
  fresh:=rtrim(current_row.source_digest)=basis->>'sourceDigest' AND current_row.consent_id=consent_row.id;
 EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;fresh:=FALSE; END;
 SELECT count(*) INTO total FROM public.canonical_labor_outcome_observations WHERE organization_id=org AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(public.canonical_labor_outcome_projection(item)||jsonb_build_object('fresh',
   rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_labor_outcome_observations WHERE organization_id=org
   AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('activeConsent',TRUE,'consent',public.canonical_learning_consent_projection(consent_row),
  'current',public.canonical_labor_outcome_projection(current_row)||jsonb_build_object('fresh',fresh,
    'advisoryAvailable',fresh,'advisoryMessage',CASE WHEN fresh THEN current_row.advisory_message ELSE NULL END),
  'history',history,'total',total,'truncated',total>20,'refreshRequired',NOT fresh);
END $$;

REVOKE ALL ON TABLE public.canonical_learning_purpose_consents,public.canonical_labor_outcome_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_text_valid(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_consent_projection(public.canonical_learning_purpose_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_worker_hours(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_learning_basis(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_outcome_projection(public.canonical_labor_outcome_observations) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_consent_read(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_consent_mutate(uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_outcome_observe(uuid,uuid,text,uuid,text,text,uuid,bigint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_outcome_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
