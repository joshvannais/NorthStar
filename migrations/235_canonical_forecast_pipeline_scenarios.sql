-- Mission 26 Part 6B: immutable, owner-reviewed scenario assumptions over the
-- bounded migration-222 authoritative current-open-risk cohort. Values and
-- member identities stay private. This is research-only scenario arithmetic, not calibrated
-- probability, a paid forecast, earned revenue, collected cash, or authority
-- for an automatic commercial action.

-- Drain pre-install estimate writers, then install a complete identity fence.
-- The AFTER INSERT trigger covers every estimate committed after this fence.
LOCK TABLE public.canonical_estimates IN SHARE ROW EXCLUSIVE MODE;

CREATE SEQUENCE public.canonical_forecast_pipeline_estimate_source_sequence AS BIGINT;

CREATE TABLE public.canonical_forecast_pipeline_estimate_sources (
 organization_id UUID NOT NULL,
 estimate_id UUID NOT NULL,
 source_order BIGINT NOT NULL CHECK(source_order>0),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('migration_backfill','post_install_insert')),
 observed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,estimate_id),
 UNIQUE(organization_id,source_order),
 FOREIGN KEY(organization_id,estimate_id)
  REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_pipeline_estimate_sources_recent
 ON public.canonical_forecast_pipeline_estimate_sources(organization_id,source_order DESC);

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Forecast pipeline scenario evidence is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_pipeline_estimate_sources_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_pipeline_estimate_sources
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_pipeline_scenario_immutable();

-- Migration 004 already makes estimate rows immutable. This exact statement
-- trigger extends that accepted rule to TRUNCATE and gives startup a Part 6B
-- binding to verify without replacing the sealed migration 004 trigger.
CREATE TRIGGER canonical_forecast_pipeline_estimate_update_guard
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_estimates
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_pipeline_scenario_immutable();

INSERT INTO public.canonical_forecast_pipeline_estimate_sources(
 organization_id,estimate_id,source_order,source_kind,observed_at)
SELECT estimate.organization_id,estimate.id,
 nextval('public.canonical_forecast_pipeline_estimate_source_sequence'),
 'migration_backfill',clock_timestamp()
FROM public.canonical_estimates estimate
ORDER BY estimate.organization_id,estimate.id;

CREATE FUNCTION public.canonical_forecast_pipeline_estimate_source_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:pipeline-scenario-source:'||NEW.organization_id::text,0));
 INSERT INTO public.canonical_forecast_pipeline_estimate_sources(
  organization_id,estimate_id,source_order,source_kind,observed_at)
 VALUES(NEW.organization_id,NEW.id,
  nextval('public.canonical_forecast_pipeline_estimate_source_sequence'),
  'post_install_insert',clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_pipeline_estimate_source_insert
 AFTER INSERT ON public.canonical_estimates FOR EACH ROW
 EXECUTE FUNCTION public.canonical_forecast_pipeline_estimate_source_insert();

-- A private clock seam makes the genuine-future and post-horizon paths
-- provable without granting runtime a way to move time.
CREATE TABLE public.canonical_forecast_pipeline_scenario_test_clock (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 current_at TIMESTAMPTZ NOT NULL
);
CREATE FUNCTION public.canonical_forecast_pipeline_scenario_clock()
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE((SELECT current_at
  FROM public.canonical_forecast_pipeline_scenario_test_clock WHERE singleton),
  clock_timestamp())
$$;
CREATE FUNCTION public.canonical_forecast_pipeline_scenario_test_clock_set(value TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');
BEGIN
 IF current_setting('northstar.m26_part6b_disposable_clock',TRUE) IS DISTINCT FROM 'enabled'
   OR NOT pg_has_role(session_user,'pg_database_owner','MEMBER')
   OR (runtime_role IS NOT NULL AND (session_user::text=runtime_role OR
        NULLIF(current_setting('role',TRUE),'none')=runtime_role)) THEN
  RAISE EXCEPTION 'Disposable pipeline scenario clock unavailable' USING ERRCODE='42501';
 END IF;
 DELETE FROM public.canonical_forecast_pipeline_scenario_test_clock;
 IF value IS NOT NULL THEN
  INSERT INTO public.canonical_forecast_pipeline_scenario_test_clock(singleton,current_at)
  VALUES(TRUE,value);
 END IF;
END $$;

-- A genuine booking review is written only after the matching schedule
-- approval. Disposable lifecycle databases therefore need that immutable
-- review receipt to share the same guarded future instant as the Part 5A
-- schedule approval clock. Production has no Part 6B clock row, so this
-- trigger leaves the owning Part 6A writer's wall clock unchanged.
CREATE FUNCTION public.canonical_forecast_pipeline_scenario_booking_review_clock()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value TIMESTAMPTZ;
BEGIN
 SELECT current_at INTO value
 FROM public.canonical_forecast_pipeline_scenario_test_clock WHERE singleton;
 IF FOUND THEN NEW.reviewed_at:=value;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_m26_part6b_disposable_booking_review_clock
 BEFORE INSERT ON public.canonical_forecast_commercial_booking_reviews
 FOR EACH ROW EXECUTE FUNCTION
 public.canonical_forecast_pipeline_scenario_booking_review_clock();

-- The server selects this method. A tenant review supplies only explicit
-- scenario assumptions for it; neither a caller nor a review can alter the
-- categories, horizon, arithmetic, applicability, or bounded source rules.
CREATE TABLE public.canonical_forecast_pipeline_scenario_method_registration (
 version TEXT PRIMARY KEY CHECK(
  version='m26_pipeline_open_value_scenario_bounded_v1'),
 target_key TEXT NOT NULL CHECK(target_key='pipeline.open_value_scenario'),
 target_version TEXT NOT NULL CHECK(target_version='v1'),
 evaluation_measurement_key TEXT NOT NULL CHECK(
  evaluation_measurement_key='research.pipeline_cutoff_cohort_booked_work_value'),
 evaluation_measurement_version TEXT NOT NULL CHECK(
  evaluation_measurement_version='v1'),
 calculation_version TEXT NOT NULL CHECK(
  calculation_version='m26-pipeline-scenario-v1'),
 category_rule_version TEXT NOT NULL CHECK(
  category_rule_version='m26-open-pipeline-category-v1'),
 horizon_rule_version TEXT NOT NULL CHECK(
  horizon_rule_version='next-complete-tenant-local-month-v1'),
 arithmetic_rule TEXT NOT NULL CHECK(
  arithmetic_rule='sum_integer_cents_times_ppm_then_half_up_six_decimal_dollars'),
 maximum_members INTEGER NOT NULL CHECK(maximum_members=256),
 maximum_price_cents NUMERIC(14,0) NOT NULL CHECK(
  maximum_price_cents=99999999999999),
 dependency_closure_digest CHAR(64) NOT NULL CHECK(
  dependency_closure_digest~'^[0-9a-f]{64}$'),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER canonical_forecast_pipeline_scenario_method_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_pipeline_scenario_method_registration
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_pipeline_scenario_immutable();

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_method_closure_digest()
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Pipeline scenario method closure is not installed'
  USING ERRCODE='23514';
END $$;

CREATE TABLE public.canonical_forecast_pipeline_scenario_policy_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('approve','reject')),
 method_version TEXT NOT NULL,
 method_closure_digest CHAR(64) NOT NULL CHECK(
  method_closure_digest~'^[0-9a-f]{64}$'),
 preliminary_lower_ppm INTEGER,
 preliminary_central_ppm INTEGER,
 preliminary_upper_ppm INTEGER,
 approved_lower_ppm INTEGER,
 approved_central_ppm INTEGER,
 approved_upper_ppm INTEGER,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,revision),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_pipeline_scenario_policy_reviews(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(method_version)
  REFERENCES public.canonical_forecast_pipeline_scenario_method_registration(version)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((action='reject' AND preliminary_lower_ppm IS NULL AND
   preliminary_central_ppm IS NULL AND preliminary_upper_ppm IS NULL AND
   approved_lower_ppm IS NULL AND approved_central_ppm IS NULL AND
   approved_upper_ppm IS NULL) OR
  (action='approve' AND num_nulls(
   preliminary_lower_ppm,preliminary_central_ppm,preliminary_upper_ppm,
   approved_lower_ppm,approved_central_ppm,approved_upper_ppm)=0 AND
   preliminary_lower_ppm BETWEEN 0 AND 1000000 AND
   preliminary_central_ppm BETWEEN 0 AND 1000000 AND
   preliminary_upper_ppm BETWEEN 0 AND 1000000 AND
   approved_lower_ppm BETWEEN 0 AND 1000000 AND
   approved_central_ppm BETWEEN 0 AND 1000000 AND
   approved_upper_ppm BETWEEN 0 AND 1000000 AND
   preliminary_lower_ppm<=preliminary_central_ppm AND
   preliminary_central_ppm<=preliminary_upper_ppm AND
   approved_lower_ppm<=approved_central_ppm AND
   approved_central_ppm<=approved_upper_ppm))
);
CREATE INDEX canonical_forecast_pipeline_scenario_policy_recent
 ON public.canonical_forecast_pipeline_scenario_policy_reviews(
  organization_id,revision DESC,id DESC);
CREATE TRIGGER canonical_forecast_pipeline_scenario_policy_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_pipeline_scenario_policy_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_pipeline_scenario_immutable();

CREATE TABLE public.canonical_forecast_pipeline_scenario_origins (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 captured_at TIMESTAMPTZ NOT NULL,
 horizon_starts_at TIMESTAMPTZ NOT NULL,
 horizon_ends_at TIMESTAMPTZ NOT NULL,
 currency CHAR(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 method_version TEXT NOT NULL,
 method_closure_digest CHAR(64) NOT NULL CHECK(
  method_closure_digest~'^[0-9a-f]{64}$'),
 policy_review_id UUID NOT NULL,
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest~'^[0-9a-f]{64}$'),
 profile_anchor_id UUID NOT NULL,
 profile_hash CHAR(64) NOT NULL CHECK(profile_hash~'^[0-9a-f]{64}$'),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=262144),
 evidence_digest CHAR(64) NOT NULL CHECK(evidence_digest~'^[0-9a-f]{64}$'),
 private_output JSONB NOT NULL CHECK(jsonb_typeof(private_output)='object' AND octet_length(private_output::text)<=16384),
 output_digest CHAR(64) NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,policy_review_id)
  REFERENCES public.canonical_forecast_pipeline_scenario_policy_reviews(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(method_version)
  REFERENCES public.canonical_forecast_pipeline_scenario_method_registration(version)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(horizon_starts_at>captured_at AND horizon_ends_at>horizon_starts_at),
 CHECK(evidence->>'targetKey'='pipeline.open_value_scenario'),
 CHECK(evidence->>'targetVersion'='v1'),
 CHECK(evidence->'postCutoffEntrantsExcluded'='true'::jsonb),
 CHECK(private_output->'probabilityCalibrated'='false'::jsonb),
 CHECK(private_output->'forecastIssued'='false'::jsonb)
);
CREATE INDEX canonical_forecast_pipeline_scenario_origins_recent
 ON public.canonical_forecast_pipeline_scenario_origins(
  organization_id,captured_at DESC,id DESC);
CREATE TRIGGER canonical_forecast_pipeline_scenario_origins_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_pipeline_scenario_origins
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_pipeline_scenario_immutable();

CREATE TABLE public.canonical_forecast_pipeline_scenario_evaluations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 origin_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 evaluated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 outcome_evidence JSONB NOT NULL CHECK(jsonb_typeof(outcome_evidence)='object' AND octet_length(outcome_evidence::text)<=262144),
 outcome_digest CHAR(64) NOT NULL CHECK(outcome_digest~'^[0-9a-f]{64}$'),
 private_metrics JSONB NOT NULL CHECK(jsonb_typeof(private_metrics)='object' AND octet_length(private_metrics::text)<=16384),
 metrics_digest CHAR(64) NOT NULL CHECK(metrics_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,origin_id,revision),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,origin_id)
  REFERENCES public.canonical_forecast_pipeline_scenario_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_pipeline_scenario_evaluations(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(outcome_evidence->>'measurementKey'=
  'research.pipeline_cutoff_cohort_booked_work_value'),
 CHECK(outcome_evidence->>'measurementVersion'='v1'),
 CHECK(private_metrics->'earnedRevenueMeasured'='false'::jsonb),
 CHECK(private_metrics->'collectedCashMeasured'='false'::jsonb),
 CHECK(private_metrics->'forecastIssued'='false'::jsonb)
);
CREATE INDEX canonical_forecast_pipeline_scenario_evaluations_recent
 ON public.canonical_forecast_pipeline_scenario_evaluations(
  organization_id,origin_id,revision DESC,id DESC);
CREATE TRIGGER canonical_forecast_pipeline_scenario_evaluations_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_pipeline_scenario_evaluations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_pipeline_scenario_immutable();

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_policy_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,reason_value TEXT,expected_revision INTEGER,
 preliminary_lower INTEGER,preliminary_central INTEGER,preliminary_upper INTEGER,
 approved_lower INTEGER,approved_central INTEGER,approved_upper INTEGER,
 confirmed_value BOOLEAN,version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_row public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 replay public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 inserted public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
 new_revision INTEGER;key_hash TEXT;request_hash TEXT;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   action_value IS NULL OR action_value NOT IN ('approve','reject') OR reason_value IS NULL OR
   length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
   octet_length(reason_value)>4000 OR expected_revision IS NULL OR
   expected_revision NOT BETWEEN 0 AND 10000 OR
   key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   confirmed_value IS DISTINCT FROM TRUE OR
   version_value IS DISTINCT FROM 'pipeline-scenario-policy-v1' OR
   (action_value='reject' AND (preliminary_lower IS NOT NULL OR
    preliminary_central IS NOT NULL OR preliminary_upper IS NOT NULL OR
    approved_lower IS NOT NULL OR approved_central IS NOT NULL OR
    approved_upper IS NOT NULL)) OR
   (action_value='approve' AND (num_nulls(
    preliminary_lower,preliminary_central,preliminary_upper,
    approved_lower,approved_central,approved_upper)>0 OR NOT(
    preliminary_lower BETWEEN 0 AND 1000000 AND
    preliminary_central BETWEEN 0 AND 1000000 AND
    preliminary_upper BETWEEN 0 AND 1000000 AND
    approved_lower BETWEEN 0 AND 1000000 AND
    approved_central BETWEEN 0 AND 1000000 AND
    approved_upper BETWEEN 0 AND 1000000 AND
    preliminary_lower<=preliminary_central AND
    preliminary_central<=preliminary_upper AND
    approved_lower<=approved_central AND approved_central<=approved_upper))) THEN
  RAISE EXCEPTION 'Pipeline scenario policy input invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO method_row
 FROM public.canonical_forecast_pipeline_scenario_method_registration
 WHERE version='m26_pipeline_open_value_scenario_bounded_v1';
 IF method_row.version IS NULL OR rtrim(method_row.dependency_closure_digest)<>
    public.canonical_forecast_pipeline_scenario_method_closure_digest() THEN
  RAISE EXCEPTION 'Pipeline scenario method registration invalid' USING ERRCODE='23514';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:pipeline-scenario-policy:'||org::text,0)) THEN
  RAISE EXCEPTION 'Pipeline scenario policy is busy' USING ERRCODE='55P03';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version',version_value,'organizationId',org,'actorUserId',actor,
  'action',action_value,'reason',btrim(reason_value),
  'expectedRevision',expected_revision,'methodVersion',method_row.version,
  'methodClosureDigest',rtrim(method_row.dependency_closure_digest),
  'preliminaryWeightsPpm',CASE WHEN action_value='approve' THEN jsonb_build_object(
   'lower',preliminary_lower,'central',preliminary_central,'upper',preliminary_upper) ELSE NULL END,
  'approvedWeightsPpm',CASE WHEN action_value='approve' THEN jsonb_build_object(
   'lower',approved_lower,'central',approved_central,'upper',approved_upper) ELSE NULL END,
  'confirmed',confirmed_value));
 SELECT * INTO replay FROM public.canonical_forecast_pipeline_scenario_policy_reviews
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF replay.method_version IS DISTINCT FROM method_row.version OR
    rtrim(replay.method_closure_digest) IS DISTINCT FROM
     rtrim(method_row.dependency_closure_digest) OR
    rtrim(replay.policy_digest) IS DISTINCT FROM public.canonical_completion_digest(
     jsonb_build_object('version','m26-pipeline-scenario-policy-v1',
      'organizationId',replay.organization_id,'revision',replay.revision,
      'previousId',replay.previous_id,'action',replay.action,
      'methodVersion',replay.method_version,
      'methodClosureDigest',rtrim(replay.method_closure_digest),
      'preliminaryWeightsPpm',CASE WHEN replay.action='approve' THEN jsonb_build_object(
       'lower',replay.preliminary_lower_ppm,'central',replay.preliminary_central_ppm,
       'upper',replay.preliminary_upper_ppm) ELSE NULL END,
      'approvedWeightsPpm',CASE WHEN replay.action='approve' THEN jsonb_build_object(
       'lower',replay.approved_lower_ppm,'central',replay.approved_central_ppm,
       'upper',replay.approved_upper_ppm) ELSE NULL END,
      'reason',btrim(replay.reason))) THEN
   RAISE EXCEPTION 'Pipeline scenario policy integrity invalid' USING ERRCODE='23514';
  END IF;
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Pipeline scenario policy request reused' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('state','pipeline_scenario_policy_reviewed','id',replay.id,
   'revision',replay.revision,'action',replay.action,'replayed',TRUE,
   'weightsWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
   'probabilityCalibrated',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_pipeline_scenario_policy_reviews
 WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
 IF current_row.id IS NOT NULL AND (
   current_row.method_version IS DISTINCT FROM method_row.version OR
   rtrim(current_row.method_closure_digest) IS DISTINCT FROM
    rtrim(method_row.dependency_closure_digest) OR
   rtrim(current_row.policy_digest) IS DISTINCT FROM public.canonical_completion_digest(
    jsonb_build_object('version','m26-pipeline-scenario-policy-v1',
     'organizationId',current_row.organization_id,'revision',current_row.revision,
     'previousId',current_row.previous_id,'action',current_row.action,
     'methodVersion',current_row.method_version,
     'methodClosureDigest',rtrim(current_row.method_closure_digest),
     'preliminaryWeightsPpm',CASE WHEN current_row.action='approve' THEN jsonb_build_object(
      'lower',current_row.preliminary_lower_ppm,'central',current_row.preliminary_central_ppm,
      'upper',current_row.preliminary_upper_ppm) ELSE NULL END,
     'approvedWeightsPpm',CASE WHEN current_row.action='approve' THEN jsonb_build_object(
      'lower',current_row.approved_lower_ppm,'central',current_row.approved_central_ppm,
      'upper',current_row.approved_upper_ppm) ELSE NULL END,
     'reason',btrim(current_row.reason)))) THEN
  RAISE EXCEPTION 'Pipeline scenario policy integrity invalid' USING ERRCODE='23514';
 END IF;
 IF COALESCE(current_row.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Pipeline scenario policy changed' USING ERRCODE='40001';END IF;
 new_revision:=expected_revision+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-scenario-policy-v1','organizationId',org,
  'revision',new_revision,'previousId',current_row.id,'action',action_value,
  'methodVersion',method_row.version,
  'methodClosureDigest',rtrim(method_row.dependency_closure_digest),
  'preliminaryWeightsPpm',CASE WHEN action_value='approve' THEN jsonb_build_object(
   'lower',preliminary_lower,'central',preliminary_central,'upper',preliminary_upper) ELSE NULL END,
  'approvedWeightsPpm',CASE WHEN action_value='approve' THEN jsonb_build_object(
   'lower',approved_lower,'central',approved_central,'upper',approved_upper) ELSE NULL END,
  'reason',btrim(reason_value)));
 INSERT INTO public.canonical_forecast_pipeline_scenario_policy_reviews(
  organization_id,revision,previous_id,action,method_version,method_closure_digest,
  preliminary_lower_ppm,preliminary_central_ppm,preliminary_upper_ppm,
  approved_lower_ppm,approved_central_ppm,approved_upper_ppm,reason,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,policy_digest)
 VALUES(org,new_revision,current_row.id,action_value,method_row.version,
  method_row.dependency_closure_digest,
  preliminary_lower,preliminary_central,preliminary_upper,
  approved_lower,approved_central,approved_upper,btrim(reason_value),actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','pipeline_scenario_policy_reviewed','id',inserted.id,
  'revision',inserted.revision,'action',inserted.action,'replayed',FALSE,
  'weightsWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
  'probabilityCalibrated',FALSE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_policy_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:pipeline-scenario-policy:'||org::text,0)) THEN
  RAISE EXCEPTION 'Pipeline scenario policy is busy' USING ERRCODE='55P03';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO selected FROM public.canonical_forecast_pipeline_scenario_policy_reviews
 WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
 IF selected.id IS NULL THEN
  RETURN jsonb_build_object('state','pipeline_scenario_policy_unavailable',
   'reason','no_review','weightsWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
   'probabilityCalibrated',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO method_row
 FROM public.canonical_forecast_pipeline_scenario_method_registration
 WHERE version=selected.method_version;
 IF method_row.version IS NULL OR
   rtrim(selected.method_closure_digest) IS DISTINCT FROM
    rtrim(method_row.dependency_closure_digest) OR
   rtrim(method_row.dependency_closure_digest) IS DISTINCT FROM
    public.canonical_forecast_pipeline_scenario_method_closure_digest() OR
   rtrim(selected.policy_digest) IS DISTINCT FROM public.canonical_completion_digest(
    jsonb_build_object('version','m26-pipeline-scenario-policy-v1',
     'organizationId',selected.organization_id,'revision',selected.revision,
     'previousId',selected.previous_id,'action',selected.action,
     'methodVersion',selected.method_version,
     'methodClosureDigest',rtrim(selected.method_closure_digest),
     'preliminaryWeightsPpm',CASE WHEN selected.action='approve' THEN jsonb_build_object(
      'lower',selected.preliminary_lower_ppm,'central',selected.preliminary_central_ppm,
      'upper',selected.preliminary_upper_ppm) ELSE NULL END,
     'approvedWeightsPpm',CASE WHEN selected.action='approve' THEN jsonb_build_object(
      'lower',selected.approved_lower_ppm,'central',selected.approved_central_ppm,
      'upper',selected.approved_upper_ppm) ELSE NULL END,
     'reason',btrim(selected.reason))) THEN
  RAISE EXCEPTION 'Pipeline scenario policy integrity invalid' USING ERRCODE='23514';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'state','pipeline_scenario_policy_current','id',selected.id,
  'revision',selected.revision,'action',selected.action,'weightsWithheld',TRUE,
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'forecastIssued',FALSE);
END $$;

-- Exact parity with the accepted unmounted diagnostic: parse two-decimal
-- money into integer cents, sum cents*PPM before one half-up rounding to
-- integer micro-dollars, and fail closed at the reviewed 256-member and
-- 12-integer-digit price bounds. PostgreSQL NUMERIC prevents machine overflow;
-- the explicit product bound prevents an unreviewed domain expansion.
CREATE FUNCTION public.canonical_forecast_pipeline_scenario_weighted_micro(
 members JSONB,category_value TEXT,weight_ppm INTEGER)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE member JSONB;member_count INTEGER;price_cents NUMERIC;
 weighted_sum NUMERIC:=0;maximum_product CONSTANT NUMERIC:=25599999999999744000000;
BEGIN
 IF members IS NULL OR jsonb_typeof(members) IS DISTINCT FROM 'array' OR
   category_value IS NULL OR
   category_value NOT IN ('preliminary_estimate','approved_unbooked') OR
   weight_ppm IS NULL OR weight_ppm NOT BETWEEN 0 AND 1000000 THEN
  RAISE EXCEPTION 'Pipeline scenario arithmetic input invalid' USING ERRCODE='22023';
 END IF;
 member_count:=jsonb_array_length(members);
 IF member_count>256 THEN
  RAISE EXCEPTION 'Pipeline scenario member bound exceeded' USING ERRCODE='54000';
 END IF;
 FOR member IN SELECT value FROM jsonb_array_elements(members) value LOOP
  IF member->>'category' IS NULL OR
    member->>'category' NOT IN ('preliminary_estimate','approved_unbooked') OR
    member->>'priceBeforeTax' IS NULL OR
    member->>'priceBeforeTax' !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN
   RAISE EXCEPTION 'Pipeline scenario money source invalid' USING ERRCODE='23514';
  END IF;
  IF member->>'category'=category_value THEN
   price_cents:=replace(member->>'priceBeforeTax','.','')::numeric;
   IF price_cents>99999999999999 THEN
    RAISE EXCEPTION 'Pipeline scenario price bound exceeded' USING ERRCODE='54000';
   END IF;
   weighted_sum:=weighted_sum+(price_cents*weight_ppm);
   IF weighted_sum>maximum_product THEN
    RAISE EXCEPTION 'Pipeline scenario arithmetic bound exceeded' USING ERRCODE='54000';
   END IF;
  END IF;
 END LOOP;
 -- Values are nonnegative, so trunc((x+50)/100) is exact half-up rounding.
 RETURN trunc((weighted_sum+50)/100);
END $$;

-- Totals have their own exact path because adding two already-rounded category
-- values can overstate the scenario. Sum every cents*PPM product across both
-- categories, then perform the single registered half-up rounding once.
CREATE FUNCTION public.canonical_forecast_pipeline_scenario_total_weighted_micro(
 members JSONB,preliminary_weight_ppm INTEGER,approved_weight_ppm INTEGER)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE member JSONB;member_count INTEGER;price_cents NUMERIC;selected_weight INTEGER;
 weighted_sum NUMERIC:=0;maximum_product CONSTANT NUMERIC:=25599999999999744000000;
BEGIN
 IF members IS NULL OR jsonb_typeof(members) IS DISTINCT FROM 'array' OR
   preliminary_weight_ppm IS NULL OR
   preliminary_weight_ppm NOT BETWEEN 0 AND 1000000 OR
   approved_weight_ppm IS NULL OR
   approved_weight_ppm NOT BETWEEN 0 AND 1000000 THEN
  RAISE EXCEPTION 'Pipeline scenario total arithmetic input invalid' USING ERRCODE='22023';
 END IF;
 member_count:=jsonb_array_length(members);
 IF member_count>256 THEN
  RAISE EXCEPTION 'Pipeline scenario member bound exceeded' USING ERRCODE='54000';
 END IF;
 FOR member IN SELECT value FROM jsonb_array_elements(members) value LOOP
  IF member->>'category' IS NULL OR
    member->>'category' NOT IN ('preliminary_estimate','approved_unbooked') OR
    member->>'priceBeforeTax' IS NULL OR
    member->>'priceBeforeTax' !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN
   RAISE EXCEPTION 'Pipeline scenario money source invalid' USING ERRCODE='23514';
  END IF;
  price_cents:=replace(member->>'priceBeforeTax','.','')::numeric;
  IF price_cents>99999999999999 THEN
   RAISE EXCEPTION 'Pipeline scenario price bound exceeded' USING ERRCODE='54000';
  END IF;
  selected_weight:=CASE member->>'category'
   WHEN 'preliminary_estimate' THEN preliminary_weight_ppm ELSE approved_weight_ppm END;
  weighted_sum:=weighted_sum+(price_cents*selected_weight);
  IF weighted_sum>maximum_product THEN
   RAISE EXCEPTION 'Pipeline scenario arithmetic bound exceeded' USING ERRCODE='54000';
  END IF;
 END LOOP;
 RETURN trunc((weighted_sum+50)/100);
END $$;

-- Build the private scenario cohort only from migration 222's authenticated
-- current-open risk set. Estimate existence and raw opportunity status are not
-- open-pipeline authority. The broader manifest proves why non-members are
-- excluded and makes each named category mutually exclusive.
CREATE FUNCTION public.canonical_forecast_pipeline_scenario_sources(
 org UUID,actor UUID,role_value TEXT,session_value UUID,currency_hint TEXT,
 cutoff_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE integrated JSONB;risk JSONB;risk_member JSONB;member_value JSONB;
 epoch public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;estimate RECORD;
 manifest JSONB:='[]'::jsonb;members JSONB:='[]'::jsonb;
 risk_set JSONB:='{}'::jsonb;opportunity_set JSONB:='{}'::jsonb;
 status_value TEXT;price_value TEXT;is_open BOOLEAN;
 estimate_count INTEGER:=0;member_count INTEGER:=0;risk_estimate_count INTEGER:=0;
 preliminary_count INTEGER:=0;approved_count INTEGER:=0;
 withdrawn_count INTEGER:=0;reviewed_unconfirmed_count INTEGER:=0;
 booked_count INTEGER:=0;corrected_count INTEGER:=0;cancelled_count INTEGER:=0;
 outside_count INTEGER:=0;
 high_water BIGINT:=0;source_hash TEXT;current_decision_id UUID;
 decision_revision BIGINT;decision_action TEXT;decision_digest TEXT;
 decision_recorded_at TIMESTAMPTZ;decision_source_order BIGINT;
 decision_price TEXT;decision_currency TEXT;
 issued_version_id UUID;issued_decision_id UUID;issued_revision BIGINT;
 issued_document_digest TEXT;issued_price TEXT;issued_currency TEXT;
 current_review_action TEXT;current_review_id UUID;current_confirmation_id UUID;
 any_first_booking BOOLEAN;any_confirmation BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   currency_hint IS NULL OR currency_hint!~'^[A-Z]{3}$' OR cutoff_at IS NULL THEN
  RAISE EXCEPTION 'Pipeline scenario source input invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 -- This helper is private. Its only runtime caller, origin_capture, already
 -- holds the complete ordered source-lock set. Do not reacquire transaction
 -- advisory locks here: repeated acquisition can hide lock-count mistakes.
 integrated:=public.canonical_forecast_integrated_commercial_sources(
  org,actor,role_value,session_value,currency_hint);
 IF integrated->>'state'<>'current_integrated_commercial_sources' OR
   integrated->'sourceCohortsCompleteAtRead' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
   'reason',COALESCE(integrated->>'reason','commercial_sources_unavailable'),
   'sourceCoverageComplete',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO epoch
 FROM public.canonical_forecast_demand_schedule_epochs_v1
 WHERE organization_id=org AND purpose='pipeline_first_booking'
 ORDER BY revision DESC,id DESC LIMIT 1;
 IF epoch.id IS NULL OR epoch.installed_at>=cutoff_at THEN
  RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
   'reason','prospective_pipeline_epoch_unavailable',
   'sourceCoverageComplete',FALSE,'forecastIssued',FALSE);
 END IF;
 risk:=public.canonical_forecast_pipeline_risk_v1(org,epoch.installed_at,cutoff_at);
 IF risk->>'state'<>'complete' THEN
  RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
   'reason',COALESCE(risk->>'reason','authoritative_open_pipeline_unavailable'),
   'sourceCoverageComplete',FALSE,'forecastIssued',FALSE);
 END IF;
 IF (risk->>'eligibleCount')::integer>256 THEN
  RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
   'reason','open_pipeline_member_limit','sourceCoverageComplete',FALSE,
   'forecastIssued',FALSE);
 END IF;
 FOR risk_member IN SELECT value FROM jsonb_array_elements(risk->'members') value LOOP
  IF risk_member->>'opportunityId' IS NULL OR
    risk_set ? (risk_member->>'opportunityId') THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','authoritative_open_pipeline_invalid','sourceCoverageComplete',FALSE,
    'forecastIssued',FALSE);
  END IF;
  risk_set:=risk_set||jsonb_build_object(risk_member->>'opportunityId',risk_member);
 END LOOP;
 FOR estimate IN
  SELECT value.id,value.opportunity_id,value.currency,value.customer_price,
   rtrim(value.snapshot_digest) snapshot_digest,value.created_at,
   sidecar.source_order,sidecar.source_kind,sidecar.observed_at,
   fence.generation source_generation,
   count(*) OVER(PARTITION BY value.opportunity_id) opportunity_estimate_count,
   row_number() OVER(PARTITION BY value.opportunity_id
    ORDER BY sidecar.source_order DESC NULLS LAST,value.id DESC) estimate_rank
  FROM public.canonical_estimates value
  LEFT JOIN public.canonical_forecast_pipeline_estimate_sources sidecar
   ON sidecar.organization_id=value.organization_id AND sidecar.estimate_id=value.id
  LEFT JOIN public.canonical_forecast_estimate_source_fences fence
   ON fence.organization_id=value.organization_id AND fence.estimate_id=value.id
  WHERE value.organization_id=org
  ORDER BY value.opportunity_id,sidecar.source_order DESC NULLS LAST,value.id DESC
  LIMIT 1001
 LOOP
  estimate_count:=estimate_count+1;
  IF estimate_count>1000 THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','estimate_source_limit','sourceCoverageComplete',FALSE,
    'forecastIssued',FALSE);END IF;
  IF estimate.source_order IS NULL OR estimate.source_generation IS NULL OR
    estimate.snapshot_digest!~'^[0-9a-f]{64}$' THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason',CASE WHEN estimate.source_order IS NULL OR
                      estimate.source_generation IS NULL THEN 'estimate_source_gap'
      ELSE 'estimate_source_invalid' END,
    'sourceCoverageComplete',FALSE,'forecastIssued',FALSE);END IF;
  high_water:=GREATEST(high_water,estimate.source_order);
  is_open:=risk_set ? estimate.opportunity_id::text;
  IF is_open AND estimate.opportunity_estimate_count<>1 THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','open_pipeline_estimate_identity_ambiguous',
    'sourceCoverageComplete',FALSE,'forecastIssued',FALSE);
  END IF;
  IF estimate.estimate_rank>1 THEN
   status_value:='corrected_excluded';corrected_count:=corrected_count+1;
   manifest:=manifest||jsonb_build_array(jsonb_build_object(
    'estimateId',estimate.id,'opportunityId',estimate.opportunity_id,
    'estimateSourceOrder',estimate.source_order,'estimateSourceKind',estimate.source_kind,
    'estimateSourceGeneration',estimate.source_generation,
    'estimateSnapshotDigest',estimate.snapshot_digest,'status',status_value));
   CONTINUE;
  END IF;
  current_decision_id:=NULL;decision_revision:=NULL;decision_action:=NULL;
  decision_digest:=NULL;decision_recorded_at:=NULL;decision_source_order:=NULL;
  decision_price:=NULL;decision_currency:=NULL;current_review_action:=NULL;
  current_review_id:=NULL;current_confirmation_id:=NULL;
  issued_version_id:=NULL;issued_decision_id:=NULL;issued_revision:=NULL;
  issued_document_digest:=NULL;issued_price:=NULL;issued_currency:=NULL;
  any_first_booking:=FALSE;any_confirmation:=FALSE;
  risk_member:=risk_set->estimate.opportunity_id::text;
  IF is_open AND estimate.currency<>currency_hint THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','mixed_currency','sourceCoverageComplete',FALSE,'forecastIssued',FALSE);
  END IF;
  SELECT source.decision_id,source.revision,source.action,rtrim(source.digest),
   source.recorded_at,source.source_order,ledger.price_before_tax,ledger.currency
  INTO current_decision_id,decision_revision,decision_action,decision_digest,
   decision_recorded_at,decision_source_order,decision_price,decision_currency
  FROM public.canonical_forecast_approved_estimate_v2_current_sources source
  JOIN public.canonical_estimate_decisions ledger
   ON ledger.organization_id=source.organization_id
    AND ledger.estimate_id=source.estimate_id AND ledger.id=source.decision_id
  WHERE source.organization_id=org AND source.estimate_id=estimate.id;
  IF current_decision_id IS NULL AND EXISTS(
   SELECT 1 FROM public.canonical_estimate_decisions history
   WHERE history.organization_id=org AND history.estimate_id=estimate.id) THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','decision_currentness_gap','sourceCoverageComplete',FALSE,
    'forecastIssued',FALSE);END IF;
  SELECT version.id,version.decision_id,version.revision,
   rtrim(version.document_digest),version.document->>'subtotal',
   version.document->>'currency'
  INTO issued_version_id,issued_decision_id,issued_revision,
   issued_document_digest,issued_price,issued_currency
  FROM public.canonical_customer_estimate_versions version
  WHERE version.organization_id=org AND version.estimate_id=estimate.id
  ORDER BY version.revision DESC,version.id DESC LIMIT 1;
  SELECT current_review.action,current_review.id,confirmation.id
  INTO current_review_action,current_review_id,current_confirmation_id
  FROM (SELECT review.*
    FROM public.canonical_forecast_commercial_booking_reviews review
    WHERE review.organization_id=org AND review.opportunity_id=estimate.opportunity_id
    ORDER BY review.review_order DESC,review.id DESC LIMIT 1) current_review
  LEFT JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=current_review.organization_id
    AND confirmation.review_id=current_review.id
  LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews review
    WHERE review.organization_id=org AND review.opportunity_id=estimate.opportunity_id
     AND review.action='first_booking_reviewed'),
   EXISTS(SELECT 1 FROM public.canonical_forecast_booked_work_confirmations confirmation
    JOIN public.canonical_forecast_commercial_booking_reviews review
     ON review.organization_id=confirmation.organization_id
      AND review.id=confirmation.review_id
    WHERE review.organization_id=org AND review.opportunity_id=estimate.opportunity_id)
  INTO any_first_booking,any_confirmation;
  price_value:=NULL;
  IF is_open AND any_first_booking THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','authoritative_open_pipeline_booking_mismatch',
    'sourceCoverageComplete',FALSE,'forecastIssued',FALSE);
  ELSIF is_open AND current_decision_id IS NULL THEN
   IF estimate.customer_price IS NULL OR estimate.customer_price<0 OR
      estimate.customer_price>999999999999.99 THEN
    RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
     'reason','preliminary_price_missing','sourceCoverageComplete',FALSE,
     'forecastIssued',FALSE);END IF;
   status_value:='preliminary_estimate';
   price_value:=estimate.customer_price::numeric(14,2)::text;
   preliminary_count:=preliminary_count+1;
  ELSIF is_open AND decision_action='withdraw' THEN
   status_value:='withdrawn_excluded';withdrawn_count:=withdrawn_count+1;
  ELSIF is_open AND decision_action='approve' AND decision_price~
    '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' AND decision_currency=currency_hint AND
    issued_version_id IS NOT NULL AND issued_decision_id=current_decision_id AND
    issued_price=decision_price AND issued_currency=currency_hint AND
    issued_document_digest~'^[0-9a-f]{64}$' THEN
   status_value:='approved_unbooked';price_value:=decision_price;
   approved_count:=approved_count+1;
  ELSIF is_open THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','decision_source_invalid','sourceCoverageComplete',FALSE,
    'forecastIssued',FALSE);
  ELSIF any_first_booking AND current_review_action='booking_cancelled' THEN
   status_value:='cancelled_excluded';cancelled_count:=cancelled_count+1;
  ELSIF any_first_booking AND current_review_action='booking_corrected' THEN
   status_value:='corrected_excluded';corrected_count:=corrected_count+1;
  ELSIF any_first_booking AND any_confirmation THEN
   status_value:='confirmed_booked_excluded';booked_count:=booked_count+1;
  ELSIF any_first_booking THEN
   status_value:='reviewed_unconfirmed_excluded';
   reviewed_unconfirmed_count:=reviewed_unconfirmed_count+1;
  ELSIF current_review_id IS NOT NULL THEN
   RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
    'reason','ambiguous_commercial_status','sourceCoverageComplete',FALSE,
    'forecastIssued',FALSE);
  ELSE
   status_value:='outside_authoritative_open_risk_excluded';outside_count:=outside_count+1;
  END IF;
  IF is_open THEN risk_estimate_count:=risk_estimate_count+1;END IF;
  IF status_value IN ('preliminary_estimate','approved_unbooked') THEN
   IF opportunity_set ? estimate.opportunity_id::text THEN
    RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
     'reason','duplicate_open_opportunity','sourceCoverageComplete',FALSE,
     'forecastIssued',FALSE);END IF;
   opportunity_set:=opportunity_set||jsonb_build_object(estimate.opportunity_id::text,TRUE);
   member_value:=jsonb_build_object(
    'estimateId',estimate.id,'opportunityId',estimate.opportunity_id,
    'category',status_value,'priceBeforeTax',price_value,'currency',currency_hint,
    'decisionId',current_decision_id,'decisionRevision',decision_revision,
    'decisionDigest',decision_digest,
    'decisionRecordedAt',CASE WHEN decision_recorded_at IS NULL THEN NULL
      ELSE public.canonical_forecast_utc_instant(decision_recorded_at) END,
    'decisionSourceOrder',decision_source_order,
    'estimateSourceOrder',estimate.source_order,
    'issuedVersionId',issued_version_id,'issuedVersionRevision',issued_revision,
    'issuedDocumentDigest',issued_document_digest,
    'estimateSourceGeneration',estimate.source_generation,
    'estimateSnapshotDigest',estimate.snapshot_digest,
    'eligibilitySourceEventId',risk_member->>'opportunitySourceEventId',
    'eligibilitySourceOrder',risk_member->'opportunitySourceOrder',
    'eligibilitySourceDigest',risk_member->>'opportunitySourceDigest',
    'eligibilityObservationDigest',risk_member->>'opportunityObservationDigest',
    'eligibleAt',risk_member->>'eligibleAt',
    'eligibilityObservedAt',risk_member->>'eligibilityObservedAt');
   members:=members||jsonb_build_array(member_value);
   member_count:=member_count+1;
  END IF;
  manifest:=manifest||jsonb_build_array(jsonb_build_object(
   'estimateId',estimate.id,'opportunityId',estimate.opportunity_id,
   'estimateSourceOrder',estimate.source_order,'estimateSourceKind',estimate.source_kind,
   'estimateSourceGeneration',estimate.source_generation,
   'estimateSnapshotDigest',estimate.snapshot_digest,'status',status_value,
   'authoritativeOpenRiskMember',is_open,
   'decisionId',current_decision_id,'decisionRevision',decision_revision,
   'decisionDigest',decision_digest,'issuedVersionId',issued_version_id,
   'issuedVersionRevision',issued_revision,'issuedDocumentDigest',issued_document_digest,
   'reviewId',current_review_id,
   'confirmationId',current_confirmation_id));
 END LOOP;
 IF (SELECT count(*) FROM public.canonical_forecast_pipeline_estimate_sources value
   WHERE value.organization_id=org)<>estimate_count OR
   risk_estimate_count<>(risk->>'eligibleCount')::integer OR
   octet_length(manifest::text)>262144 OR octet_length(members::text)>262144 THEN
  RETURN jsonb_build_object('state','pipeline_scenario_sources_unavailable',
   'reason',CASE WHEN risk_estimate_count<>(risk->>'eligibleCount')::integer
      THEN 'open_pipeline_estimate_unavailable' ELSE 'estimate_source_manifest_invalid' END,
   'sourceCoverageComplete',FALSE,'forecastIssued',FALSE);END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-scenario-sources-v2','organizationId',org,
  'currency',currency_hint,'cutoffAt',public.canonical_forecast_utc_instant(cutoff_at),
  'estimateHighWaterOrder',high_water,'openRiskDigest',risk->>'digest',
  'pipelineEpochId',epoch.id,'pipelineEpochDigest',rtrim(epoch.epoch_digest),
  'integratedCommercialSourceDigest',integrated->>'sourceDigest',
  'estimateManifest',manifest));
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','current_pipeline_scenario_sources',
  'currency',currency_hint,'members',members,'estimateManifest',manifest,
  'sourceDigest',source_hash,'estimateHighWaterOrder',high_water,
  'cutoffAt',public.canonical_forecast_utc_instant(cutoff_at),
  'pipelineEpochId',epoch.id,'pipelineEpochDigest',rtrim(epoch.epoch_digest),
  'openRiskDigest',risk->>'digest','openRiskEligibleCount',risk->'eligibleCount',
  'integratedCommercialSourceDigest',integrated->>'sourceDigest',
  'statuses',jsonb_build_object('estimateCount',estimate_count,
   'authoritativeOpenRiskCount',(risk->>'eligibleCount')::integer,
   'scenarioMemberCount',member_count,
   'preliminaryEstimateCount',preliminary_count,
   'approvedUnbookedCount',approved_count,'withdrawnExcludedCount',withdrawn_count,
   'reviewedUnconfirmedExcludedCount',reviewed_unconfirmed_count,
   'confirmedBookedExcludedCount',booked_count,'correctedExcludedCount',corrected_count,
   'cancelledExcludedCount',cancelled_count,
   'outsideAuthoritativeOpenRiskExcludedCount',outside_count),
  'sourceCoverageComplete',TRUE,'sourceAuthenticated',TRUE,
  'wholeBusinessCoverageVerified',FALSE,'forecastIssued',FALSE);
END $$;

-- A captured cutoff cohort never follows later lifecycle state. Its immutable
-- source pins remain verifiable for the full origin lifetime, while late
-- observations whose effective time belongs at or before the cutoff fail
-- closed. Before the horizon starts, current policy/profile changes and a true
-- rewrite of a frozen source also require a new origin. A later decision on the
-- same immutable estimate is outcome progress, including approve or withdraw.
CREATE FUNCTION public.canonical_forecast_pipeline_scenario_origin_input_current(
 org UUID,saved public.canonical_forecast_pipeline_scenario_origins)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE member JSONB;manifest_member JSONB;
 captured_policy public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 current_policy public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
 profile JSONB;anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 estimate_row public.canonical_estimates%ROWTYPE;
 source_row public.canonical_forecast_pipeline_estimate_sources%ROWTYPE;
 fence_row public.canonical_forecast_estimate_source_fences%ROWTYPE;
 current_source public.canonical_forecast_approved_estimate_v2_current_sources%ROWTYPE;
 captured_decision public.canonical_estimate_decisions%ROWTYPE;
 current_decision public.canonical_estimate_decisions%ROWTYPE;
 captured_issued RECORD;current_issued RECORD;captured_source_order BIGINT;
 manifest_estimate RECORD;manifest_decision RECORD;manifest_issued RECORD;
 expected_source_digest TEXT;expected_policy_digest TEXT;before_horizon BOOLEAN;
BEGIN
 before_horizon:=public.canonical_forecast_pipeline_scenario_clock()<saved.horizon_starts_at;
 IF jsonb_typeof(saved.evidence->'estimateManifest') IS DISTINCT FROM 'array' OR
   jsonb_typeof(saved.evidence->'members') IS DISTINCT FROM 'array' OR
   jsonb_typeof(saved.evidence->'statuses') IS DISTINCT FROM 'object' OR
   saved.evidence->>'sourceDigest' IS DISTINCT FROM rtrim(saved.source_digest) OR
   saved.evidence->>'integratedCommercialSourceDigest' IS NULL THEN
  RETURN FALSE;
 END IF;
 expected_source_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-scenario-sources-v2','organizationId',org,
  'currency',saved.currency,'cutoffAt',saved.evidence->>'capturedAt',
  'estimateHighWaterOrder',saved.evidence->'estimateHighWaterOrder',
  'openRiskDigest',saved.evidence->>'openRiskDigest',
  'pipelineEpochId',saved.evidence->>'pipelineEpochId',
  'pipelineEpochDigest',saved.evidence->>'pipelineEpochDigest',
  'integratedCommercialSourceDigest',saved.evidence->>'integratedCommercialSourceDigest',
  'estimateManifest',saved.evidence->'estimateManifest'));
 IF expected_source_digest IS DISTINCT FROM rtrim(saved.source_digest) OR
   jsonb_array_length(saved.evidence->'estimateManifest') IS DISTINCT FROM
    (saved.evidence#>>'{statuses,estimateCount}')::integer OR
   (SELECT count(*) FROM public.canonical_forecast_pipeline_estimate_sources source
     WHERE source.organization_id=org AND source.source_order<=
      (saved.evidence->>'estimateHighWaterOrder')::bigint) IS DISTINCT FROM
    jsonb_array_length(saved.evidence->'estimateManifest') OR
   EXISTS(SELECT 1
    FROM jsonb_array_elements(saved.evidence->'estimateManifest') item
    GROUP BY item->>'estimateId' HAVING count(*)<>1) OR
   EXISTS(SELECT 1
    FROM public.canonical_forecast_pipeline_estimate_sources source
    JOIN public.canonical_estimates estimate
      ON estimate.organization_id=source.organization_id
     AND estimate.id=source.estimate_id
    WHERE source.organization_id=org
     AND source.source_order>(saved.evidence->>'estimateHighWaterOrder')::bigint
     AND estimate.created_at<=saved.captured_at) THEN
  RETURN FALSE;
 END IF;
 -- Reauthenticate every captured member and exclusion row. Later rows are
 -- legitimate lifecycle progress; a row that was in the frozen census must
 -- retain its exact immutable estimate/sidecar/fence and optional commercial
 -- evidence pins for the full origin lifetime.
 FOR manifest_member IN SELECT value
   FROM jsonb_array_elements(saved.evidence->'estimateManifest') value LOOP
  manifest_estimate:=NULL;
  SELECT estimate.id,estimate.opportunity_id,rtrim(estimate.snapshot_digest) snapshot_digest,
    source.source_order,source.source_kind,fence.generation source_generation
  INTO manifest_estimate
  FROM public.canonical_estimates estimate
  JOIN public.canonical_forecast_pipeline_estimate_sources source
    ON source.organization_id=estimate.organization_id AND source.estimate_id=estimate.id
  JOIN public.canonical_forecast_estimate_source_fences fence
    ON fence.organization_id=estimate.organization_id AND fence.estimate_id=estimate.id
  WHERE estimate.organization_id=org
   AND estimate.id=(manifest_member->>'estimateId')::uuid
   AND estimate.opportunity_id=(manifest_member->>'opportunityId')::uuid
  FOR SHARE OF fence;
  IF manifest_estimate.id IS NULL OR
    manifest_estimate.snapshot_digest IS DISTINCT FROM
      manifest_member->>'estimateSnapshotDigest' OR
    manifest_estimate.source_order IS DISTINCT FROM
      (manifest_member->>'estimateSourceOrder')::bigint OR
    manifest_estimate.source_kind IS DISTINCT FROM
      manifest_member->>'estimateSourceKind' OR
    manifest_estimate.source_generation<
      (manifest_member->>'estimateSourceGeneration')::bigint OR
    manifest_estimate.source_generation-
      (manifest_member->>'estimateSourceGeneration')::bigint IS DISTINCT FROM
      ((SELECT count(*) FROM public.canonical_estimate_decisions decision
         WHERE decision.organization_id=org
          AND decision.estimate_id=manifest_estimate.id
          AND decision.created_at>saved.captured_at)+
       (SELECT count(*) FROM public.canonical_labor_plans plan
         WHERE plan.organization_id=org
          AND plan.estimate_id=manifest_estimate.id
          AND plan.created_at>saved.captured_at)+
       (SELECT count(*) FROM public.canonical_estimate_revisions revision
         WHERE revision.organization_id=org
          AND revision.estimate_id=manifest_estimate.id
          AND revision.created_at>saved.captured_at)) THEN
   RETURN FALSE;
  END IF;
  IF manifest_member->>'decisionId' IS NOT NULL THEN
   manifest_decision:=NULL;
   SELECT decision.id,decision.revision,rtrim(decision.digest) digest
   INTO manifest_decision FROM public.canonical_estimate_decisions decision
   WHERE decision.organization_id=org AND decision.estimate_id=manifest_estimate.id
    AND decision.id=(manifest_member->>'decisionId')::uuid;
   IF manifest_decision.id IS NULL OR manifest_decision.revision IS DISTINCT FROM
      (manifest_member->>'decisionRevision')::bigint OR
      manifest_decision.digest IS DISTINCT FROM manifest_member->>'decisionDigest' THEN
    RETURN FALSE;
   END IF;
  END IF;
  IF manifest_member->>'issuedVersionId' IS NOT NULL THEN
   manifest_issued:=NULL;
   SELECT version.id,version.revision,rtrim(version.document_digest) document_digest
   INTO manifest_issued FROM public.canonical_customer_estimate_versions version
   WHERE version.organization_id=org AND version.estimate_id=manifest_estimate.id
    AND version.id=(manifest_member->>'issuedVersionId')::uuid;
   IF manifest_issued.id IS NULL OR manifest_issued.revision IS DISTINCT FROM
      (manifest_member->>'issuedVersionRevision')::bigint OR
      manifest_issued.document_digest IS DISTINCT FROM
       manifest_member->>'issuedDocumentDigest' THEN
    RETURN FALSE;
   END IF;
  END IF;
  IF manifest_member->>'reviewId' IS NOT NULL AND NOT EXISTS(SELECT 1
    FROM public.canonical_forecast_commercial_booking_reviews review
    WHERE review.organization_id=org
     AND review.opportunity_id=manifest_estimate.opportunity_id
     AND review.id=(manifest_member->>'reviewId')::uuid) THEN
   RETURN FALSE;
  END IF;
  IF manifest_member->>'confirmationId' IS NOT NULL AND NOT EXISTS(SELECT 1
    FROM public.canonical_forecast_booked_work_confirmations confirmation
    WHERE confirmation.organization_id=org
     AND confirmation.id=(manifest_member->>'confirmationId')::uuid
     AND confirmation.review_id=(manifest_member->>'reviewId')::uuid) THEN
   RETURN FALSE;
  END IF;
 END LOOP;
 SELECT * INTO method_row
 FROM public.canonical_forecast_pipeline_scenario_method_registration
 WHERE version=saved.method_version;
 IF method_row.version IS NULL OR
   rtrim(method_row.dependency_closure_digest)<>rtrim(saved.method_closure_digest) OR
   rtrim(method_row.dependency_closure_digest)<>
    public.canonical_forecast_pipeline_scenario_method_closure_digest() THEN
  RETURN FALSE;
 END IF;
 SELECT * INTO captured_policy
 FROM public.canonical_forecast_pipeline_scenario_policy_reviews
 WHERE organization_id=org AND id=saved.policy_review_id;
 expected_policy_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-scenario-policy-v1',
  'organizationId',captured_policy.organization_id,'revision',captured_policy.revision,
  'previousId',captured_policy.previous_id,'action',captured_policy.action,
  'methodVersion',captured_policy.method_version,
  'methodClosureDigest',rtrim(captured_policy.method_closure_digest),
  'preliminaryWeightsPpm',CASE WHEN captured_policy.action='approve' THEN jsonb_build_object(
   'lower',captured_policy.preliminary_lower_ppm,
   'central',captured_policy.preliminary_central_ppm,
   'upper',captured_policy.preliminary_upper_ppm) ELSE NULL END,
  'approvedWeightsPpm',CASE WHEN captured_policy.action='approve' THEN jsonb_build_object(
   'lower',captured_policy.approved_lower_ppm,
   'central',captured_policy.approved_central_ppm,
   'upper',captured_policy.approved_upper_ppm) ELSE NULL END,
  'reason',btrim(captured_policy.reason)));
 SELECT * INTO anchor_row
 FROM public.canonical_forecast_profile_effective_anchors
 WHERE organization_id=org AND id=saved.profile_anchor_id;
 IF captured_policy.id IS NULL OR captured_policy.action<>'approve' OR
   captured_policy.method_version<>saved.method_version OR
   rtrim(captured_policy.method_closure_digest)<>rtrim(saved.method_closure_digest) OR
   expected_policy_digest IS DISTINCT FROM rtrim(captured_policy.policy_digest) OR
   rtrim(captured_policy.policy_digest)<>rtrim(saved.policy_digest) OR
   anchor_row.id IS NULL OR
   rtrim(anchor_row.business_profile_hash)<>rtrim(saved.profile_hash) OR
   EXISTS(SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps gap
    WHERE gap.organization_id=org AND gap.uncertain_from_at<=saved.captured_at) OR
   EXISTS(SELECT 1 FROM public.canonical_forecast_pipeline_eligibility_visibility_v1 late
    WHERE late.organization_id=org AND late.source_visible_at<=saved.captured_at
     AND late.observed_at>saved.captured_at) OR
   EXISTS(SELECT 1 FROM public.canonical_forecast_pipeline_booking_visibility_v1 late
    WHERE late.organization_id=org AND late.source_occurred_at<=saved.captured_at
     AND late.observed_at>saved.captured_at) OR
   NOT EXISTS(SELECT 1 FROM public.canonical_forecast_demand_schedule_epochs_v1 epoch
    WHERE epoch.organization_id=org AND epoch.purpose='pipeline_first_booking'
     AND epoch.id=(saved.evidence->>'pipelineEpochId')::uuid
     AND rtrim(epoch.epoch_digest)=saved.evidence->>'pipelineEpochDigest') THEN
  RETURN FALSE;
 END IF;
 IF before_horizon THEN
  SELECT * INTO current_policy
  FROM public.canonical_forecast_pipeline_scenario_policy_reviews
  WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
  profile:=public.canonical_forecast_transition_profile_v2(org);
  IF current_policy.id IS DISTINCT FROM saved.policy_review_id OR
    profile IS NULL OR profile->>'anchorId' IS DISTINCT FROM saved.profile_anchor_id::text OR
    profile->>'hash' IS DISTINCT FROM rtrim(saved.profile_hash) OR
    NOT EXISTS(SELECT 1 FROM public.canonical_forecast_demand_schedule_epochs_v1 epoch
     WHERE epoch.organization_id=org AND epoch.purpose='pipeline_first_booking'
      AND epoch.id=(saved.evidence->>'pipelineEpochId')::uuid
      AND epoch.id=(SELECT current_epoch.id
       FROM public.canonical_forecast_demand_schedule_epochs_v1 current_epoch
       WHERE current_epoch.organization_id=org
        AND current_epoch.purpose='pipeline_first_booking'
       ORDER BY current_epoch.revision DESC,current_epoch.id DESC LIMIT 1)) THEN
   RETURN FALSE;
  END IF;
 END IF;
 FOR member IN SELECT value FROM jsonb_array_elements(saved.evidence->'members') value LOOP
  SELECT * INTO estimate_row FROM public.canonical_estimates value
   WHERE value.organization_id=org AND value.id=(member->>'estimateId')::uuid
    AND value.opportunity_id=(member->>'opportunityId')::uuid
    AND value.currency=saved.currency
    AND rtrim(value.snapshot_digest)=member->>'estimateSnapshotDigest';
  IF estimate_row.id IS NULL OR (SELECT count(*) FROM public.canonical_estimates value
      JOIN public.canonical_forecast_pipeline_estimate_sources frozen_source
       ON frozen_source.organization_id=value.organization_id
        AND frozen_source.estimate_id=value.id
      WHERE value.organization_id=org
       AND value.opportunity_id=(member->>'opportunityId')::uuid
       AND frozen_source.source_order<=
        (saved.evidence->>'estimateHighWaterOrder')::bigint)<>1 THEN
   RETURN FALSE;
  END IF;
  SELECT * INTO source_row FROM public.canonical_forecast_pipeline_estimate_sources source
   WHERE source.organization_id=org AND source.estimate_id=estimate_row.id;
  SELECT * INTO fence_row FROM public.canonical_forecast_estimate_source_fences fence
   WHERE fence.organization_id=org AND fence.estimate_id=estimate_row.id;
  IF source_row.source_order IS DISTINCT FROM (member->>'estimateSourceOrder')::bigint OR
    fence_row.estimate_id IS NULL OR
    (member->>'estimateSourceGeneration')::bigint IS DISTINCT FROM
      COALESCE((SELECT (item->>'estimateSourceGeneration')::bigint
        FROM jsonb_array_elements(saved.evidence->'estimateManifest') item
        WHERE item->>'estimateId'=member->>'estimateId'),-1) OR
    NOT EXISTS(SELECT 1 FROM public.canonical_forecast_pipeline_eligibility_visibility_v1 pin
     WHERE pin.organization_id=org
      AND pin.source_event_id=(member->>'eligibilitySourceEventId')::uuid
      AND pin.opportunity_id=(member->>'opportunityId')::uuid
      AND pin.source_order=(member->>'eligibilitySourceOrder')::bigint
      AND rtrim(pin.source_digest)=member->>'eligibilitySourceDigest'
      AND rtrim(pin.observation_digest)=member->>'eligibilityObservationDigest') THEN
   RETURN FALSE;
  END IF;
  captured_decision:=NULL;captured_source_order:=NULL;
  IF member->>'category'='approved_unbooked' THEN
   SELECT decision.*
   INTO captured_decision
   FROM public.canonical_estimate_decisions decision
   WHERE decision.organization_id=org AND decision.estimate_id=estimate_row.id
    AND decision.id=(member->>'decisionId')::uuid;
   SELECT COALESCE((SELECT source_order.source_order
     FROM public.canonical_forecast_price_decision_orders source_order
     WHERE source_order.organization_id=org AND source_order.estimate_id=estimate_row.id
      AND source_order.decision_id=captured_decision.id),0)
   INTO captured_source_order;
   SELECT version.id,version.decision_id,version.revision,
    rtrim(version.document_digest) document_digest,
    version.document->>'subtotal' subtotal,version.document->>'currency' currency
   INTO captured_issued FROM public.canonical_customer_estimate_versions version
   WHERE version.organization_id=org AND version.estimate_id=estimate_row.id
    AND version.id=(member->>'issuedVersionId')::uuid;
   IF captured_decision.id IS NULL OR captured_decision.action<>'approve' OR
     captured_decision.revision IS DISTINCT FROM (member->>'decisionRevision')::bigint OR
     rtrim(captured_decision.digest) IS DISTINCT FROM member->>'decisionDigest' OR
     public.canonical_forecast_utc_instant(captured_decision.created_at)
       IS DISTINCT FROM member->>'decisionRecordedAt' OR
     captured_source_order IS DISTINCT FROM (member->>'decisionSourceOrder')::bigint OR
     captured_decision.price_before_tax IS DISTINCT FROM member->>'priceBeforeTax' OR
     captured_decision.currency IS DISTINCT FROM saved.currency OR
     captured_issued.id IS NULL OR
     captured_issued.decision_id IS DISTINCT FROM captured_decision.id OR
     captured_issued.revision IS DISTINCT FROM (member->>'issuedVersionRevision')::bigint OR
     captured_issued.document_digest IS DISTINCT FROM member->>'issuedDocumentDigest' OR
     captured_issued.subtotal IS DISTINCT FROM member->>'priceBeforeTax' OR
     captured_issued.currency IS DISTINCT FROM saved.currency OR
     EXISTS(SELECT 1 FROM public.canonical_estimate_decisions late_decision
      WHERE late_decision.organization_id=org
       AND late_decision.estimate_id=estimate_row.id
       AND late_decision.revision>captured_decision.revision
       AND late_decision.created_at<=saved.captured_at) OR
     EXISTS(SELECT 1 FROM public.canonical_customer_estimate_versions late_version
      WHERE late_version.organization_id=org
       AND late_version.estimate_id=estimate_row.id
       AND late_version.revision>captured_issued.revision
       AND late_version.created_at<=saved.captured_at) THEN
     RETURN FALSE;
    END IF;
  ELSIF member->>'category'='preliminary_estimate' THEN
   IF member->>'decisionId' IS NOT NULL OR member->>'issuedVersionId' IS NOT NULL OR
     estimate_row.customer_price::numeric(14,2)::text IS DISTINCT FROM member->>'priceBeforeTax' OR
     EXISTS(SELECT 1 FROM public.canonical_estimate_decisions history
      WHERE history.organization_id=org AND history.estimate_id=estimate_row.id
       AND history.created_at<=saved.captured_at) THEN
    RETURN FALSE;
   END IF;
   captured_source_order:=0;
  ELSE
   RETURN FALSE;
  END IF;
  IF NOT before_horizon THEN CONTINUE;END IF;
  SELECT * INTO current_source
  FROM public.canonical_forecast_approved_estimate_v2_current_sources source
  WHERE source.organization_id=org AND source.estimate_id=estimate_row.id;
  current_decision:=NULL;
  IF current_source.decision_id IS NOT NULL THEN
   SELECT * INTO current_decision FROM public.canonical_estimate_decisions value
   WHERE value.organization_id=org AND value.estimate_id=estimate_row.id
    AND value.id=current_source.decision_id;
  END IF;
  IF current_source.decision_id IS NULL THEN
   IF member->>'category'<>'preliminary_estimate' OR
     EXISTS(SELECT 1 FROM public.canonical_estimate_decisions history
      WHERE history.organization_id=org AND history.estimate_id=estimate_row.id) THEN
    RETURN FALSE;
   END IF;
   CONTINUE;
  END IF;
  IF member->>'category'='approved_unbooked' AND
    current_source.decision_id=(member->>'decisionId')::uuid THEN CONTINUE;END IF;
  IF current_source.recorded_at<=saved.captured_at OR
    current_source.source_order<=captured_source_order OR
    current_decision.action NOT IN ('approve','withdraw') THEN
   RETURN FALSE;
  END IF;
  IF current_decision.action='approve' THEN
   IF current_decision.currency<>saved.currency OR current_decision.price_before_tax!~
      '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN RETURN FALSE;END IF;
   SELECT version.id,version.decision_id,version.revision,
    rtrim(version.document_digest) document_digest,
    version.document->>'subtotal' subtotal,version.document->>'currency' currency
   INTO current_issued FROM public.canonical_customer_estimate_versions version
   WHERE version.organization_id=org AND version.estimate_id=estimate_row.id
   ORDER BY version.revision DESC,version.id DESC LIMIT 1;
   IF current_issued.id IS NULL OR
     current_issued.decision_id IS DISTINCT FROM current_decision.id OR
     current_issued.subtotal IS DISTINCT FROM current_decision.price_before_tax OR
     current_issued.currency IS DISTINCT FROM saved.currency OR
     current_issued.document_digest!~'^[0-9a-f]{64}$' THEN
    RETURN FALSE;
   END IF;
  END IF;
 END LOOP;
 RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_origin_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 reason_value TEXT,confirmed_value BOOLEAN,version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;policy public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
 prior public.canonical_forecast_pipeline_scenario_origins%ROWTYPE;
 inserted public.canonical_forecast_pipeline_scenario_origins%ROWTYPE;
 profile JSONB;profile_row public.canonical_business_profiles%ROWTYPE;sources JSONB;
 now_value TIMESTAMPTZ;horizon_start TIMESTAMPTZ;horizon_end TIMESTAMPTZ;
 key_hash TEXT;request_hash TEXT;evidence_value JSONB;private_value JSONB;
 policy_digest_value TEXT;
 preliminary_lower_micro NUMERIC;preliminary_central_micro NUMERIC;preliminary_upper_micro NUMERIC;
 approved_lower_micro NUMERIC;approved_central_micro NUMERIC;approved_upper_micro NUMERIC;
 total_lower_micro NUMERIC;total_central_micro NUMERIC;total_upper_micro NUMERIC;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
   octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE OR
   version_value IS DISTINCT FROM 'pipeline-open-value-scenario-v1' THEN
  RAISE EXCEPTION 'Pipeline scenario origin input invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:pipeline-scenario-source:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-policy:'||org::text,0)) THEN
  RAISE EXCEPTION 'Pipeline scenario origin is busy' USING ERRCODE='55P03';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version',version_value,'organizationId',org,'actorUserId',actor,
  'reason',btrim(reason_value),'confirmed',confirmed_value));
 SELECT * INTO prior FROM public.canonical_forecast_pipeline_scenario_origins
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Pipeline scenario origin request reused' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_pipeline_scenario_origin_input_current(org,prior) THEN
   RETURN jsonb_build_object('state','pipeline_scenario_origin_unavailable',
    'reason','prior_origin_stale_new_request_required','valuesWithheld',TRUE,
    'probabilityCalibrated',FALSE,'researchOnly',TRUE,
    'realForecastEligible',FALSE,'forecastIssued',FALSE,
    'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
  END IF;
  authority:=public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','pipeline_scenario_origin_saved','id',prior.id,
   'horizonStartsAt',public.canonical_forecast_utc_instant(prior.horizon_starts_at),
   'horizonEndsAt',public.canonical_forecast_utc_instant(prior.horizon_ends_at),
   'replayed',TRUE,'targetKey','pipeline.open_value_scenario','targetVersion','v1',
   'evaluationMeasurementKey','research.pipeline_cutoff_cohort_booked_work_value',
   'formalBookedWorkValueTargetClaimed',FALSE,
   'postCutoffEntrantsExcluded',TRUE,'valuesWithheld',TRUE,
   'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
   'researchOnly',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,
   'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 SELECT * INTO policy FROM public.canonical_forecast_pipeline_scenario_policy_reviews
 WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
 SELECT * INTO method_row
 FROM public.canonical_forecast_pipeline_scenario_method_registration
 WHERE version='m26_pipeline_open_value_scenario_bounded_v1';
 IF method_row.version IS NULL OR rtrim(method_row.dependency_closure_digest)<>
    public.canonical_forecast_pipeline_scenario_method_closure_digest() THEN
  RAISE EXCEPTION 'Pipeline scenario method registration invalid' USING ERRCODE='23514';
 END IF;
 policy_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-scenario-policy-v1','organizationId',policy.organization_id,
  'revision',policy.revision,'previousId',policy.previous_id,'action',policy.action,
  'methodVersion',policy.method_version,
  'methodClosureDigest',rtrim(policy.method_closure_digest),
  'preliminaryWeightsPpm',CASE WHEN policy.action='approve' THEN jsonb_build_object(
   'lower',policy.preliminary_lower_ppm,'central',policy.preliminary_central_ppm,
   'upper',policy.preliminary_upper_ppm) ELSE NULL END,
  'approvedWeightsPpm',CASE WHEN policy.action='approve' THEN jsonb_build_object(
   'lower',policy.approved_lower_ppm,'central',policy.approved_central_ppm,
   'upper',policy.approved_upper_ppm) ELSE NULL END,
  'reason',btrim(policy.reason)));
 IF policy.id IS NULL OR policy.action<>'approve' OR
   policy.method_version<>method_row.version OR
   rtrim(policy.method_closure_digest)<>rtrim(method_row.dependency_closure_digest) OR
   policy_digest_value IS DISTINCT FROM rtrim(policy.policy_digest) THEN
  RETURN jsonb_build_object('state','pipeline_scenario_origin_unavailable',
   'reason','approved_scenario_policy_unavailable','valuesWithheld',TRUE,
   'probabilityCalibrated',FALSE,'researchOnly',TRUE,
   'realForecastEligible',FALSE,'forecastIssued',FALSE,
   'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 profile:=public.canonical_forecast_transition_profile_v2(org);
 IF profile IS NULL THEN
  RETURN jsonb_build_object('state','pipeline_scenario_origin_unavailable',
   'reason','current_profile_unavailable','valuesWithheld',TRUE,
   'probabilityCalibrated',FALSE,'researchOnly',TRUE,
   'realForecastEligible',FALSE,'forecastIssued',FALSE,
   'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
 WHERE organization_id=org AND id=(profile->>'id')::uuid;
 IF profile_row.id IS NULL OR profile_row.raw_profile#>>'{company,currency}' !~ '^[A-Z]{3}$' THEN
  RETURN jsonb_build_object('state','pipeline_scenario_origin_unavailable',
   'reason','currency_authority_unavailable','valuesWithheld',TRUE,
   'probabilityCalibrated',FALSE,'researchOnly',TRUE,
   'realForecastEligible',FALSE,'forecastIssued',FALSE,
   'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 now_value:=public.canonical_forecast_pipeline_scenario_clock();
 sources:=public.canonical_forecast_pipeline_scenario_sources(
  org,actor,role_value,session_value,profile_row.raw_profile#>>'{company,currency}',
  now_value);
 IF sources->>'state'<>'current_pipeline_scenario_sources' OR
   sources->'sourceCoverageComplete' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('state','pipeline_scenario_origin_unavailable',
   'reason',COALESCE(sources->>'reason','pipeline_sources_unavailable'),
   'valuesWithheld',TRUE,'probabilityCalibrated',FALSE,'forecastIssued',FALSE,
   'researchOnly',TRUE,'realForecastEligible',FALSE,
   'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 horizon_start:=(date_trunc('month',now_value AT TIME ZONE (profile->>'timeZone'))+
  INTERVAL '1 month') AT TIME ZONE (profile->>'timeZone');
 horizon_end:=(date_trunc('month',now_value AT TIME ZONE (profile->>'timeZone'))+
  INTERVAL '2 months') AT TIME ZONE (profile->>'timeZone');
 IF horizon_start<=now_value OR horizon_end<=horizon_start THEN
  RAISE EXCEPTION 'Pipeline scenario future horizon invalid' USING ERRCODE='23514';END IF;
 preliminary_lower_micro:=public.canonical_forecast_pipeline_scenario_weighted_micro(
  sources->'members','preliminary_estimate',policy.preliminary_lower_ppm);
 preliminary_central_micro:=public.canonical_forecast_pipeline_scenario_weighted_micro(
  sources->'members','preliminary_estimate',policy.preliminary_central_ppm);
 preliminary_upper_micro:=public.canonical_forecast_pipeline_scenario_weighted_micro(
  sources->'members','preliminary_estimate',policy.preliminary_upper_ppm);
 approved_lower_micro:=public.canonical_forecast_pipeline_scenario_weighted_micro(
  sources->'members','approved_unbooked',policy.approved_lower_ppm);
 approved_central_micro:=public.canonical_forecast_pipeline_scenario_weighted_micro(
  sources->'members','approved_unbooked',policy.approved_central_ppm);
 approved_upper_micro:=public.canonical_forecast_pipeline_scenario_weighted_micro(
  sources->'members','approved_unbooked',policy.approved_upper_ppm);
 total_lower_micro:=public.canonical_forecast_pipeline_scenario_total_weighted_micro(
  sources->'members',policy.preliminary_lower_ppm,policy.approved_lower_ppm);
 total_central_micro:=public.canonical_forecast_pipeline_scenario_total_weighted_micro(
  sources->'members',policy.preliminary_central_ppm,policy.approved_central_ppm);
 total_upper_micro:=public.canonical_forecast_pipeline_scenario_total_weighted_micro(
  sources->'members',policy.preliminary_upper_ppm,policy.approved_upper_ppm);
 evidence_value:=jsonb_build_object(
  'version','m26-pipeline-open-value-scenario-evidence-v1',
  'targetKey','pipeline.open_value_scenario','targetVersion','v1',
  'formalBookedWorkValueTargetClaimed',FALSE,
  'evaluationMeasurementKey','research.pipeline_cutoff_cohort_booked_work_value',
  'evaluationMeasurementVersion','v1','organizationId',org,
  'capturedAt',public.canonical_forecast_utc_instant(now_value),
  'horizonStartsAt',public.canonical_forecast_utc_instant(horizon_start),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_end),
  'upperBoundary','exclusive','timeZone',profile->>'timeZone',
  'profileId',profile->>'id','profileVersion',profile->'version',
  'profileHash',profile->>'hash','profileAnchorId',profile->>'anchorId',
  'policyReviewId',policy.id,'policyRevision',policy.revision,
  'policyDigest',rtrim(policy.policy_digest),'sourceDigest',sources->>'sourceDigest',
  'methodVersion',method_row.version,
  'methodClosureDigest',rtrim(method_row.dependency_closure_digest),
  'calculationVersion',method_row.calculation_version,
  'categoryRuleVersion',method_row.category_rule_version,
  'horizonRuleVersion',method_row.horizon_rule_version,
  'arithmeticRule',method_row.arithmetic_rule,
  'maximumMembers',method_row.maximum_members,
  'estimateHighWaterOrder',sources->'estimateHighWaterOrder',
  'pipelineEpochId',sources->>'pipelineEpochId',
  'pipelineEpochDigest',sources->>'pipelineEpochDigest',
  'openRiskDigest',sources->>'openRiskDigest',
  'openRiskEligibleCount',sources->'openRiskEligibleCount',
  'integratedCommercialSourceDigest',sources->>'integratedCommercialSourceDigest',
  'statuses',sources->'statuses','members',sources->'members',
  'estimateManifest',sources->'estimateManifest',
  'sourceCoverageComplete',TRUE,'sourceAuthenticated',TRUE,
  'postCutoffEntrantsExcluded',TRUE,'wholeBusinessCoverageVerified',FALSE);
 private_value:=jsonb_build_object(
  'version','m26-pipeline-open-value-scenario-private-v1',
  'currency',sources->>'currency',
  'scenarioWeightsPpm',jsonb_build_object(
   'preliminaryEstimate',jsonb_build_object('lower',policy.preliminary_lower_ppm,
    'central',policy.preliminary_central_ppm,'upper',policy.preliminary_upper_ppm),
   'approvedUnbooked',jsonb_build_object('lower',policy.approved_lower_ppm,
    'central',policy.approved_central_ppm,'upper',policy.approved_upper_ppm)),
  'categoryValuesMicro',jsonb_build_object(
   'preliminaryEstimate',jsonb_build_object('lower',preliminary_lower_micro,
    'central',preliminary_central_micro,'upper',preliminary_upper_micro),
   'approvedUnbooked',jsonb_build_object('lower',approved_lower_micro,
    'central',approved_central_micro,'upper',approved_upper_micro)),
  'totalRangeMicro',jsonb_build_object(
   'lower',total_lower_micro,'central',total_central_micro,'upper',total_upper_micro),
  'unit','currency_micro_units','rounding','half_up_after_sum',
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,
  'cashMeasured',FALSE,'forecastIssued',FALSE);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF public.canonical_forecast_pipeline_scenario_clock()>=horizon_start THEN
  RETURN jsonb_build_object('state','pipeline_scenario_origin_unavailable',
   'reason','future_horizon_elapsed_before_capture','valuesWithheld',TRUE,
   'probabilityCalibrated',FALSE,'researchOnly',TRUE,
   'realForecastEligible',FALSE,'forecastIssued',FALSE,
   'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_pipeline_scenario_origins(
  organization_id,captured_at,horizon_starts_at,horizon_ends_at,currency,
  method_version,method_closure_digest,
  policy_review_id,policy_digest,profile_anchor_id,profile_hash,source_digest,
  evidence,evidence_digest,private_output,output_digest,actor_user_id,
  membership_id,auth_session_id,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,now_value,horizon_start,horizon_end,sources->>'currency',
  method_row.version,method_row.dependency_closure_digest,policy.id,
  policy.policy_digest,(profile->>'anchorId')::uuid,profile->>'hash',sources->>'sourceDigest',
  evidence_value,public.canonical_completion_digest(evidence_value),private_value,
  public.canonical_completion_digest(private_value),actor,
  (authority->>'membershipId')::uuid,session_value,btrim(reason_value),key_hash,request_hash,
  public.canonical_completion_digest(jsonb_build_object('evidence',evidence_value,
   'privateOutput',private_value))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','pipeline_scenario_origin_saved','id',inserted.id,
  'horizonStartsAt',public.canonical_forecast_utc_instant(horizon_start),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_end),
  'replayed',FALSE,'targetKey','pipeline.open_value_scenario','targetVersion','v1',
  'evaluationMeasurementKey','research.pipeline_cutoff_cohort_booked_work_value',
  'formalBookedWorkValueTargetClaimed',FALSE,'postCutoffEntrantsExcluded',TRUE,
  'valuesWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
  'probabilityCalibrated',FALSE,'researchOnly',TRUE,'realForecastEligible',FALSE,
  'forecastIssued',FALSE,'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_origin_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_pipeline_scenario_origins%ROWTYPE;
 before_horizon BOOLEAN;input_current BOOLEAN;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-policy:'||org::text,0)) THEN
  RAISE EXCEPTION 'Pipeline scenario origin read is busy' USING ERRCODE='55P03';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_pipeline_scenario_origins
 WHERE organization_id=org AND id=origin_value;
 IF saved.id IS NULL THEN RETURN NULL;END IF;
 IF rtrim(saved.evidence_digest)<>public.canonical_completion_digest(saved.evidence) OR
   rtrim(saved.output_digest)<>public.canonical_completion_digest(saved.private_output) OR
   rtrim(saved.canonical_digest)<>public.canonical_completion_digest(jsonb_build_object(
    'evidence',saved.evidence,'privateOutput',saved.private_output)) THEN
  RAISE EXCEPTION 'Pipeline scenario origin integrity invalid' USING ERRCODE='23514';END IF;
 before_horizon:=public.canonical_forecast_pipeline_scenario_clock()<saved.horizon_starts_at;
 input_current:=public.canonical_forecast_pipeline_scenario_origin_input_current(org,saved);
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT input_current THEN
  RETURN jsonb_build_object('state','pipeline_scenario_origin_stale','id',saved.id,
   'refreshRequired',TRUE,'valuesWithheld',TRUE,'researchOnly',TRUE,
   'forecastIssued',FALSE,'paidNumericServing',FALSE);
 END IF;
 RETURN jsonb_build_object('state','pipeline_scenario_origin_current','id',saved.id,
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'captureInputsCurrentAtRead',before_horizon,'captureInputsFrozen',NOT before_horizon,
  'targetKey','pipeline.open_value_scenario','targetVersion','v1',
  'evaluationMeasurementKey','research.pipeline_cutoff_cohort_booked_work_value',
  'formalBookedWorkValueTargetClaimed',FALSE,'postCutoffEntrantsExcluded',TRUE,
  'valuesWithheld',TRUE,'sourceCoverageCompleteAtCapture',TRUE,
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'researchOnly',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_outcome(
 org UUID,saved public.canonical_forecast_pipeline_scenario_origins)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE member JSONB;booking RECORD;reviewed RECORD;epoch RECORD;event_row RECORD;
 receipts JSONB:='[]'::jsonb;review_history JSONB;coverage_manifest JSONB:='[]'::jsonb;
 actual_micro NUMERIC:=0;price_cents NUMERIC;
 member_count INTEGER:=0;booked_member_count INTEGER:=0;unresolved_count INTEGER:=0;
 review_history_count INTEGER:=0;
 accepted_event_count INTEGER:=0;visibility_event_count INTEGER:=0;
 horizon_source_high_water BIGINT:=0;tenant_source_high_water BIGINT:=0;
 tenant_visibility_high_water BIGINT:=0;coverage_digest TEXT;
 maximum_actual_micro CONSTANT NUMERIC:=255999999999997440000;
BEGIN
 IF public.canonical_forecast_pipeline_scenario_clock()<saved.horizon_ends_at THEN
  RETURN jsonb_build_object('state','unavailable','reason','horizon_not_ended');END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps gap
  WHERE gap.organization_id=org AND gap.uncertain_from_at<saved.horizon_ends_at) THEN
  RETURN jsonb_build_object('state','unavailable','reason','schedule_lineage_gap');END IF;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
 WHERE organization_id=org;
 IF epoch.organization_id IS NULL OR epoch.coverage_state<>'complete' THEN
  RETURN jsonb_build_object('state','unavailable','reason','approved_price_epoch_unavailable');END IF;
 -- Under the schedule writer lock, authenticate every accepted source event to
 -- its migration222 visibility row. The tenant-wide matching high water makes
 -- zero horizon events an affirmative complete result instead of missing data.
 FOR event_row IN
 SELECT event_value.id,event_value.source_order,event_value.assignment_id,
   event_value.appointment_id,event_value.source_revision_id,event_value.source_revision,
   event_value.source_kind,event_value.schedule_state,event_value.appointment_status,
   event_value.transition_kind,
   event_value.occurred_at,rtrim(event_value.source_digest) event_source_digest,
   rtrim(event_value.event_digest) event_digest,appointment.opportunity_id,
   revision.id revision_id,revision.assignment_id revision_assignment_id,
   revision.source_kind revision_source_kind,
   revision.human_approval_id revision_human_approval_id,
   revision.approval_id revision_approval_id,
   rtrim(revision.canonical_digest) revision_digest,
   rtrim(revision.request_digest) revision_request_digest,
   preview_approval.id preview_approval_id,
   preview_approval.assignment_id preview_approval_assignment_id,
   preview_approval.appointment_id preview_approval_appointment_id,
   preview_approval.applied_revision preview_approval_applied_revision,
   rtrim(preview_approval.applied_digest) preview_approval_applied_digest,
   rtrim(preview_approval.request_digest) preview_approval_request_digest,
   preview_approval.approved_at preview_approval_approved_at,
   visibility.source_event_id visibility_id,
   visibility.source_order visibility_order,
   visibility.opportunity_id visibility_opportunity_id,
   visibility.assignment_id visibility_assignment_id,
   visibility.appointment_id visibility_appointment_id,
   visibility.source_occurred_at visibility_occurred_at,
   rtrim(visibility.source_digest) visibility_source_digest,
   rtrim(visibility.observation_digest) visibility_observation_digest,
   visibility.observed_at
  FROM public.canonical_forecast_schedule_booking_events event_value
  JOIN public.canonical_appointments appointment
   ON appointment.organization_id=event_value.organization_id
    AND appointment.id=event_value.appointment_id
  LEFT JOIN public.canonical_schedule_assignment_revisions revision
   ON revision.organization_id=event_value.organization_id
    AND revision.id=event_value.source_revision_id
  LEFT JOIN public.canonical_schedule_human_approvals preview_approval
   ON preview_approval.organization_id=revision.organization_id
    AND preview_approval.id=revision.human_approval_id
  LEFT JOIN public.canonical_forecast_pipeline_booking_visibility_v1 visibility
   ON visibility.organization_id=event_value.organization_id
    AND visibility.source_event_id=event_value.id
  WHERE event_value.organization_id=org
   AND event_value.transition_kind='accepted_booking'
   AND event_value.occurred_at>=saved.horizon_starts_at
   AND event_value.occurred_at<saved.horizon_ends_at
  ORDER BY event_value.occurred_at,event_value.source_order,event_value.id
  LIMIT 1001
 LOOP
  accepted_event_count:=accepted_event_count+1;
  IF accepted_event_count>1000 OR event_row.visibility_id IS NULL OR
    event_row.revision_id IS NULL OR
    event_row.source_kind<>'human_preview_approved' OR
    event_row.revision_assignment_id IS DISTINCT FROM event_row.assignment_id OR
    event_row.revision_source_kind IS DISTINCT FROM event_row.source_kind OR
    event_row.revision_digest IS DISTINCT FROM event_row.event_source_digest OR
    event_row.revision_human_approval_id IS NULL OR
    event_row.revision_approval_id IS NOT NULL OR
    event_row.preview_approval_id IS DISTINCT FROM event_row.revision_human_approval_id OR
    event_row.preview_approval_assignment_id IS DISTINCT FROM event_row.assignment_id OR
    event_row.preview_approval_appointment_id IS DISTINCT FROM event_row.appointment_id OR
    event_row.preview_approval_applied_revision IS DISTINCT FROM event_row.source_revision OR
    event_row.preview_approval_applied_digest IS DISTINCT FROM event_row.revision_digest OR
    event_row.preview_approval_request_digest IS DISTINCT FROM event_row.revision_request_digest OR
    event_row.preview_approval_approved_at IS DISTINCT FROM event_row.occurred_at OR
    event_row.event_digest IS DISTINCT FROM public.canonical_completion_digest(jsonb_build_object(
     'organizationId',org,'assignmentId',event_row.assignment_id,
     'appointmentId',event_row.appointment_id,'sourceRevisionId',event_row.source_revision_id,
     'sourceRevision',event_row.source_revision,'sourceKind',event_row.source_kind,
     'scheduleState',event_row.schedule_state,
     'appointmentStatus',event_row.appointment_status,
     'transitionKind',event_row.transition_kind,
     'occurredAt',public.canonical_forecast_utc_instant(event_row.occurred_at),
     'sourceDigest',event_row.revision_digest)) OR
    event_row.visibility_order IS DISTINCT FROM event_row.source_order OR
    event_row.visibility_opportunity_id IS DISTINCT FROM event_row.opportunity_id OR
    event_row.visibility_assignment_id IS DISTINCT FROM event_row.assignment_id OR
    event_row.visibility_appointment_id IS DISTINCT FROM event_row.appointment_id OR
    event_row.visibility_occurred_at IS DISTINCT FROM event_row.occurred_at OR
    event_row.visibility_source_digest IS DISTINCT FROM event_row.event_digest OR
    event_row.visibility_observation_digest!~'^[0-9a-f]{64}$' THEN
   RETURN jsonb_build_object('state','unavailable',
    'reason','complete_outcome_unavailable');
  END IF;
  horizon_source_high_water:=GREATEST(horizon_source_high_water,event_row.source_order);
  coverage_manifest:=coverage_manifest||jsonb_build_array(jsonb_build_object(
   'acceptedEventId',event_row.id,'sourceOrder',event_row.source_order,
   'opportunityId',event_row.opportunity_id,'assignmentId',event_row.assignment_id,
   'appointmentId',event_row.appointment_id,
   'sourceRevisionId',event_row.source_revision_id,
   'sourceKind',event_row.source_kind,
   'humanApprovalId',event_row.revision_human_approval_id,
   'legacyApprovalId',event_row.revision_approval_id,
   'humanApprovalAppliedRevision',event_row.preview_approval_applied_revision,
   'humanApprovalAppliedDigest',event_row.preview_approval_applied_digest,
   'humanApprovalRequestDigest',event_row.preview_approval_request_digest,
   'revisionDigest',event_row.revision_digest,
   'sourceOccurredAt',public.canonical_forecast_utc_instant(event_row.occurred_at),
   'sourceDigest',event_row.event_digest,
   'visibilityObservationDigest',event_row.visibility_observation_digest,
   'visibilityObservedAt',public.canonical_forecast_utc_instant(event_row.observed_at)));
 END LOOP;
 SELECT count(*)::integer INTO visibility_event_count
 FROM public.canonical_forecast_pipeline_booking_visibility_v1 visibility
 WHERE visibility.organization_id=org
  AND visibility.source_occurred_at>=saved.horizon_starts_at
  AND visibility.source_occurred_at<saved.horizon_ends_at;
 SELECT COALESCE(max(source_order),0) INTO tenant_source_high_water
 FROM public.canonical_forecast_schedule_booking_events
 WHERE organization_id=org AND transition_kind='accepted_booking';
 SELECT COALESCE(max(source_order),0) INTO tenant_visibility_high_water
 FROM public.canonical_forecast_pipeline_booking_visibility_v1
 WHERE organization_id=org;
 IF visibility_event_count<>accepted_event_count OR
   tenant_visibility_high_water<>tenant_source_high_water OR
   EXISTS(SELECT 1 FROM public.canonical_forecast_pipeline_booking_visibility_v1 visibility
    LEFT JOIN public.canonical_forecast_schedule_booking_events event_value
     ON event_value.organization_id=visibility.organization_id
      AND event_value.id=visibility.source_event_id
      AND event_value.transition_kind='accepted_booking'
    LEFT JOIN public.canonical_appointments appointment
     ON appointment.organization_id=event_value.organization_id
      AND appointment.id=event_value.appointment_id
    WHERE visibility.organization_id=org AND (
     event_value.id IS NULL OR appointment.opportunity_id IS DISTINCT FROM visibility.opportunity_id OR
     event_value.source_order IS DISTINCT FROM visibility.source_order OR
     event_value.assignment_id IS DISTINCT FROM visibility.assignment_id OR
     event_value.appointment_id IS DISTINCT FROM visibility.appointment_id OR
     event_value.occurred_at IS DISTINCT FROM visibility.source_occurred_at OR
     rtrim(event_value.event_digest) IS DISTINCT FROM rtrim(visibility.source_digest))) OR
   octet_length(coverage_manifest::text)>262144 THEN
  RETURN jsonb_build_object('state','unavailable','reason','complete_outcome_unavailable');
 END IF;
 coverage_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-horizon-accepted-event-coverage-v1','organizationId',org,
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'acceptedEventCount',accepted_event_count,
  'horizonSourceHighWaterOrder',horizon_source_high_water,
  'tenantSourceHighWaterOrder',tenant_source_high_water,
  'tenantVisibilityHighWaterOrder',tenant_visibility_high_water,
  'events',coverage_manifest));
 FOR member IN SELECT value FROM jsonb_array_elements(saved.evidence->'members') value LOOP
  member_count:=member_count+1;booking:=NULL;reviewed:=NULL;review_history:='[]'::jsonb;
  IF member_count>256 THEN
   RAISE EXCEPTION 'Pipeline scenario outcome member bound exceeded' USING ERRCODE='54000';
  END IF;
  SELECT visibility.source_event_id,visibility.source_order,
   visibility.opportunity_id,visibility.assignment_id,visibility.appointment_id,
   visibility.source_occurred_at,visibility.observed_at,
   rtrim(visibility.source_digest) source_digest,
   rtrim(visibility.observation_digest) observation_digest,
   event.source_revision_id,event.source_revision,event.source_kind,
   revision.human_approval_id,revision.approval_id,
   rtrim(revision.canonical_digest) revision_digest,
   rtrim(revision.request_digest) revision_request_digest
  INTO booking
  FROM public.canonical_forecast_pipeline_booking_visibility_v1 visibility
  JOIN public.canonical_forecast_schedule_booking_events event
   ON event.organization_id=visibility.organization_id
    AND event.id=visibility.source_event_id
    AND event.transition_kind='accepted_booking'
  JOIN public.canonical_schedule_assignment_revisions revision
   ON revision.organization_id=event.organization_id
    AND revision.id=event.source_revision_id
    AND revision.assignment_id=event.assignment_id
    AND revision.source_kind=event.source_kind
    AND rtrim(revision.canonical_digest)=rtrim(event.source_digest)
  WHERE visibility.organization_id=org AND
   visibility.opportunity_id=(member->>'opportunityId')::uuid AND
   visibility.source_occurred_at>=saved.horizon_starts_at AND
   visibility.source_occurred_at<saved.horizon_ends_at
  ORDER BY visibility.source_occurred_at,visibility.source_order,
   visibility.source_event_id LIMIT 1;
  IF booking.source_event_id IS NULL THEN
   receipts:=receipts||jsonb_build_array(jsonb_build_object(
    'opportunityId',member->>'opportunityId','estimateId',member->>'estimateId',
    'frozenCategory',member->>'category',
    'frozenEstimateSourceOrder',member->'estimateSourceOrder',
    'frozenEligibilitySourceEventId',member->>'eligibilitySourceEventId',
    'state','no_accepted_booking','acceptedEventId',NULL,
    'bookingSourceOrder',NULL,'bookingSourceRevisionId',NULL,
    'bookingSourceRevision',NULL,'bookingSourceKind',NULL,
    'assignmentId',NULL,'appointmentId',NULL,
    'sourceOccurredAt',NULL,'observedAt',NULL,'bookingDigest',NULL,
    'bookingObservationDigest',NULL,'scheduleHumanApprovalId',NULL,
    'humanApprovalAppliedRevision',NULL,'humanApprovalAppliedDigest',NULL,
    'humanApprovalRequestDigest',NULL,'approvalSourceOrder',NULL,
    'approvalObservedAt',NULL,'reviewId',NULL,'reviewOrder',NULL,
    'reviewedAt',NULL,'approvalId',NULL,'acceptanceId',NULL,
    'acceptanceSourceOrder',NULL,'acceptanceObservedAt',NULL,
    'acceptanceDigest',NULL,'acceptanceRequestDigest',NULL,
    'issuedVersionId',NULL,'issuedVersionRevision',NULL,
    'issuedDocumentDigest',NULL,'issuedVersionDigest',NULL,
    'approvedDecisionId',NULL,'approvedDecisionRevision',NULL,
    'approvedDecisionSourceOrder',NULL,'approvedDecisionOrderedAt',NULL,
    'approvedDecisionDigest',NULL,'reviewedPriceBeforeTax',NULL,
    'currency',NULL,'reviewRequestDigest',NULL,'reviewDigest',NULL,
    'priceEffectiveNoLaterThanBooking',NULL,'reviewHistory','[]'::jsonb));
   CONTINUE;
  END IF;
  SELECT review.id review_id,review.estimate_id,review.approval_id,
   review.acceptance_id,review.issued_version_id,review.approved_decision_id,
   rtrim(review.approved_decision_digest) review_approved_decision_digest,
   review.reviewed_price_before_tax,review.currency review_currency,
   review.review_order,review.reviewed_at,review.reason review_reason,
   rtrim(review.request_digest) review_request_digest,
   approval.applied_revision approval_applied_revision,
   rtrim(approval.applied_digest) approval_applied_digest,
   rtrim(approval.request_digest) approval_request_digest,
   approval.approved_at approval_approved_at,
   approval_order.source_order approval_source_order,
   approval_order.observed_at approval_observed_at,
   acceptance_order.source_order acceptance_source_order,
   acceptance_order.observed_at acceptance_observed_at,
   decision.price_before_tax decision_price,decision.currency decision_currency,
   decision.revision decision_revision,decision.created_at decision_created_at,
   rtrim(decision.digest) decision_digest,
   source_order.source_order decision_source_order,source_order.ordered_at,
   issued.decision_id issued_decision_id,issued.revision issued_revision,
   rtrim(issued.document_digest) issued_document_digest,
   rtrim(issued.digest) issued_digest,issued.document issued_document,
   issued.document->>'subtotal' issued_price,issued.document->>'currency' issued_currency,
   acceptance.kind acceptance_kind,acceptance.estimate_id acceptance_estimate_id,
   acceptance.version_id acceptance_version_id,acceptance.link_id acceptance_link_id,
   acceptance.body acceptance_body,
   acceptance.created_at acceptance_created_at,
   rtrim(acceptance.request_digest) acceptance_request_digest,
   rtrim(acceptance.digest) acceptance_digest,
   public.canonical_completion_digest(jsonb_build_object(
    'version','m26-pipeline-event-time-booking-review-v1','reviewId',review.id,
    'reviewOrder',review.review_order,'reviewedAt',
     public.canonical_forecast_utc_instant(review.reviewed_at),
    'approvalId',review.approval_id,'acceptanceId',review.acceptance_id,
    'estimateId',review.estimate_id,'issuedVersionId',review.issued_version_id,
    'approvedDecisionId',review.approved_decision_id,
    'approvedDecisionDigest',rtrim(review.approved_decision_digest),
    'reviewedPriceBeforeTax',review.reviewed_price_before_tax,
    'currency',review.currency,'requestDigest',rtrim(review.request_digest))) review_digest
  INTO reviewed
  FROM public.canonical_forecast_commercial_booking_reviews review
  JOIN public.canonical_schedule_human_approvals approval
   ON approval.organization_id=review.organization_id
    AND approval.id=review.approval_id
    AND approval.assignment_id=booking.assignment_id
    AND approval.appointment_id=booking.appointment_id
    AND approval.applied_revision=booking.source_revision
    AND rtrim(approval.applied_digest)=booking.revision_digest
    AND rtrim(approval.request_digest)=booking.revision_request_digest
    AND approval.approved_at=booking.source_occurred_at
  JOIN public.canonical_estimate_decisions decision
   ON decision.organization_id=review.organization_id
    AND decision.estimate_id=review.estimate_id AND decision.id=review.approved_decision_id
  JOIN public.canonical_customer_estimate_versions issued
   ON issued.organization_id=review.organization_id
    AND issued.estimate_id=review.estimate_id AND issued.id=review.issued_version_id
  JOIN public.canonical_customer_estimate_delivery_events acceptance
   ON acceptance.organization_id=review.organization_id
    AND acceptance.id=review.acceptance_id
  JOIN public.canonical_forecast_commercial_booking_orders approval_order
   ON approval_order.organization_id=review.organization_id
    AND approval_order.source_kind='schedule_approval'
    AND approval_order.approval_id=review.approval_id
  JOIN public.canonical_forecast_commercial_booking_orders acceptance_order
   ON acceptance_order.organization_id=review.organization_id
    AND acceptance_order.source_kind='customer_estimate_acceptance'
    AND acceptance_order.delivery_event_id=review.acceptance_id
  LEFT JOIN public.canonical_forecast_price_decision_orders source_order
   ON source_order.organization_id=decision.organization_id
    AND source_order.estimate_id=decision.estimate_id AND source_order.decision_id=decision.id
  WHERE review.organization_id=org AND review.opportunity_id=booking.opportunity_id
   AND review.appointment_id=booking.appointment_id
   AND review.estimate_id=(member->>'estimateId')::uuid
   AND booking.source_kind='human_preview_approved'
   AND booking.human_approval_id IS NOT NULL AND booking.approval_id IS NULL
   AND review.approval_id=booking.human_approval_id
   AND review.action='first_booking_reviewed' AND decision.action='approve'
  ORDER BY review.review_order,review.id LIMIT 1;
  SELECT count(*)::integer INTO review_history_count FROM (
   SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews history
   WHERE history.organization_id=org AND history.appointment_id=booking.appointment_id
   LIMIT 1001
  ) bounded_history;
  IF review_history_count>1000 THEN
   RETURN jsonb_build_object('state','unavailable','reason','complete_outcome_unavailable');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'reviewId',history.id,'reviewOrder',history.review_order,'action',history.action,
    'estimateId',history.estimate_id,'previousReviewId',history.previous_review_id,
    'approvalId',history.approval_id,'acceptanceId',history.acceptance_id,
    'issuedVersionId',history.issued_version_id,
    'approvedDecisionId',history.approved_decision_id,
    'approvedDecisionDigest',rtrim(history.approved_decision_digest),
    'reviewedPriceBeforeTax',history.reviewed_price_before_tax,
    'currency',history.currency,'reviewedAt',
     public.canonical_forecast_utc_instant(history.reviewed_at),
    'requestDigest',rtrim(history.request_digest),
    'reviewDigest',public.canonical_completion_digest(jsonb_build_object(
     'version','m26-pipeline-event-time-booking-review-v1','reviewId',history.id,
     'reviewOrder',history.review_order,'reviewedAt',
      public.canonical_forecast_utc_instant(history.reviewed_at),
     'approvalId',history.approval_id,'acceptanceId',history.acceptance_id,
     'estimateId',history.estimate_id,'issuedVersionId',history.issued_version_id,
     'approvedDecisionId',history.approved_decision_id,
     'approvedDecisionDigest',rtrim(history.approved_decision_digest),
     'reviewedPriceBeforeTax',history.reviewed_price_before_tax,
     'currency',history.currency,'requestDigest',rtrim(history.request_digest))))
    ORDER BY history.review_order,history.id),
   '[]'::jsonb) INTO review_history
  FROM (SELECT history_row.*
    FROM public.canonical_forecast_commercial_booking_reviews history_row
    WHERE history_row.organization_id=org
     AND history_row.appointment_id=booking.appointment_id
    ORDER BY history_row.review_order,history_row.id LIMIT 1000) history;
  IF octet_length(review_history::text)>262144 THEN
   RETURN jsonb_build_object('state','unavailable','reason','complete_outcome_unavailable');
  END IF;
  IF reviewed.review_id IS NULL OR booking.source_kind<>'human_preview_approved' OR
    reviewed.reviewed_price_before_tax!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR
    reviewed.review_currency<>saved.currency OR
    reviewed.approval_applied_revision IS DISTINCT FROM booking.source_revision OR
    reviewed.approval_applied_digest IS DISTINCT FROM booking.revision_digest OR
    reviewed.approval_request_digest IS DISTINCT FROM booking.revision_request_digest OR
    reviewed.approval_approved_at IS DISTINCT FROM booking.source_occurred_at OR
    reviewed.acceptance_source_order>=reviewed.approval_source_order OR
    reviewed.reviewed_at<booking.source_occurred_at OR
    reviewed.review_request_digest IS DISTINCT FROM encode(sha256(convert_to(
     jsonb_build_object('approvalId',reviewed.approval_id,
      'reason',btrim(reviewed.review_reason))::text,'UTF8')),'hex') OR
    reviewed.review_approved_decision_digest IS DISTINCT FROM reviewed.decision_digest OR
    reviewed.decision_digest!~'^[0-9a-f]{64}$' OR
    reviewed.reviewed_price_before_tax IS DISTINCT FROM reviewed.decision_price OR
    reviewed.review_currency IS DISTINCT FROM reviewed.decision_currency OR
    reviewed.issued_decision_id IS DISTINCT FROM reviewed.approved_decision_id OR
    reviewed.issued_price IS DISTINCT FROM reviewed.reviewed_price_before_tax OR
    reviewed.issued_currency IS DISTINCT FROM reviewed.review_currency OR
    reviewed.issued_document_digest!~'^[0-9a-f]{64}$' OR
    reviewed.issued_document_digest IS DISTINCT FROM
     public.canonical_completion_digest(reviewed.issued_document) OR
    reviewed.issued_digest!~'^[0-9a-f]{64}$' OR
    reviewed.acceptance_kind<>'accepted' OR
    reviewed.acceptance_estimate_id IS DISTINCT FROM reviewed.estimate_id OR
    reviewed.acceptance_version_id IS DISTINCT FROM reviewed.issued_version_id OR
    reviewed.acceptance_request_digest!~'^[0-9a-f]{64}$' OR
    reviewed.acceptance_digest IS DISTINCT FROM public.canonical_completion_digest(
     jsonb_build_object('link',reviewed.acceptance_link_id,
      'version',reviewed.acceptance_version_id,'kind',reviewed.acceptance_kind,
      'body',reviewed.acceptance_body)) OR
    reviewed.acceptance_created_at>booking.source_occurred_at OR
    NOT((reviewed.decision_source_order IS NOT NULL AND
          reviewed.ordered_at<=booking.source_occurred_at) OR
        (reviewed.decision_source_order IS NULL AND
          reviewed.decision_created_at<=epoch.coverage_starts_at AND
          epoch.coverage_starts_at<=booking.source_occurred_at)) THEN
   unresolved_count:=unresolved_count+1;
   receipts:=receipts||jsonb_build_array(jsonb_build_object(
    'opportunityId',booking.opportunity_id,'estimateId',member->>'estimateId',
    'frozenCategory',member->>'category',
    'state','accepted_booking_price_unavailable',
    'acceptedEventId',booking.source_event_id,
    'bookingSourceOrder',booking.source_order,
    'bookingSourceRevisionId',booking.source_revision_id,
    'bookingSourceRevision',booking.source_revision,
    'bookingSourceKind',booking.source_kind,
    'assignmentId',booking.assignment_id,'appointmentId',booking.appointment_id,
    'sourceOccurredAt',public.canonical_forecast_utc_instant(booking.source_occurred_at),
    'observedAt',public.canonical_forecast_utc_instant(booking.observed_at),
    'bookingDigest',booking.source_digest,
    'bookingObservationDigest',booking.observation_digest,
    'scheduleHumanApprovalId',booking.human_approval_id,
    'humanApprovalAppliedRevision',reviewed.approval_applied_revision,
    'humanApprovalAppliedDigest',reviewed.approval_applied_digest,
    'humanApprovalRequestDigest',reviewed.approval_request_digest,
    'approvalSourceOrder',reviewed.approval_source_order,
    'approvalObservedAt',public.canonical_forecast_utc_instant(reviewed.approval_observed_at),
    'reviewId',reviewed.review_id,'reviewOrder',reviewed.review_order,
    'reviewedAt',public.canonical_forecast_utc_instant(reviewed.reviewed_at),
    'approvalId',reviewed.approval_id,'acceptanceId',reviewed.acceptance_id,
    'acceptanceSourceOrder',reviewed.acceptance_source_order,
    'acceptanceObservedAt',public.canonical_forecast_utc_instant(reviewed.acceptance_observed_at),
    'issuedVersionId',reviewed.issued_version_id,
    'issuedVersionRevision',reviewed.issued_revision,
    'issuedDocumentDigest',reviewed.issued_document_digest,
    'issuedVersionDigest',reviewed.issued_digest,
    'acceptanceDigest',reviewed.acceptance_digest,
    'acceptanceRequestDigest',reviewed.acceptance_request_digest,
    'approvedDecisionId',reviewed.approved_decision_id,
    'approvedDecisionRevision',reviewed.decision_revision,
    'approvedDecisionSourceOrder',reviewed.decision_source_order,
    'approvedDecisionOrderedAt',public.canonical_forecast_utc_instant(reviewed.ordered_at),
    'approvedDecisionDigest',reviewed.review_approved_decision_digest,
    'reviewedPriceBeforeTax',reviewed.reviewed_price_before_tax,
    'currency',reviewed.review_currency,
    'reviewRequestDigest',reviewed.review_request_digest,
    'reviewDigest',reviewed.review_digest,'reviewHistory',review_history));
   CONTINUE;
  END IF;
  price_cents:=replace(reviewed.reviewed_price_before_tax,'.','')::numeric;
  IF price_cents>99999999999999 THEN
   RAISE EXCEPTION 'Pipeline scenario outcome price bound exceeded' USING ERRCODE='54000';
  END IF;
  actual_micro:=actual_micro+(price_cents*10000);
  IF actual_micro>maximum_actual_micro THEN
   RAISE EXCEPTION 'Pipeline scenario outcome arithmetic bound exceeded' USING ERRCODE='54000';
  END IF;
  booked_member_count:=booked_member_count+1;
  receipts:=receipts||jsonb_build_array(jsonb_build_object(
   'opportunityId',booking.opportunity_id,'state','first_accepted_booking_priced',
   'frozenCategory',member->>'category',
   'acceptedEventId',booking.source_event_id,'bookingSourceOrder',booking.source_order,
   'bookingSourceRevisionId',booking.source_revision_id,
   'bookingSourceRevision',booking.source_revision,
   'bookingSourceKind',booking.source_kind,'assignmentId',booking.assignment_id,
   'appointmentId',booking.appointment_id,
   'sourceOccurredAt',public.canonical_forecast_utc_instant(booking.source_occurred_at),
   'observedAt',public.canonical_forecast_utc_instant(booking.observed_at),
   'bookingDigest',booking.source_digest,'bookingObservationDigest',booking.observation_digest,
   'scheduleHumanApprovalId',booking.human_approval_id,
   'humanApprovalAppliedRevision',reviewed.approval_applied_revision,
   'humanApprovalAppliedDigest',reviewed.approval_applied_digest,
   'humanApprovalRequestDigest',reviewed.approval_request_digest,
   'approvalSourceOrder',reviewed.approval_source_order,
   'approvalObservedAt',public.canonical_forecast_utc_instant(reviewed.approval_observed_at),
   'reviewId',reviewed.review_id,'reviewOrder',reviewed.review_order,
   'reviewedAt',public.canonical_forecast_utc_instant(reviewed.reviewed_at),
   'estimateId',reviewed.estimate_id,
   'approvalId',reviewed.approval_id,'acceptanceId',reviewed.acceptance_id,
   'acceptanceSourceOrder',reviewed.acceptance_source_order,
   'acceptanceObservedAt',public.canonical_forecast_utc_instant(reviewed.acceptance_observed_at),
   'issuedVersionId',reviewed.issued_version_id,
   'issuedVersionRevision',reviewed.issued_revision,
   'issuedDocumentDigest',reviewed.issued_document_digest,
   'issuedVersionDigest',reviewed.issued_digest,
   'acceptanceDigest',reviewed.acceptance_digest,
   'acceptanceRequestDigest',reviewed.acceptance_request_digest,
   'approvedDecisionId',reviewed.approved_decision_id,
   'approvedDecisionRevision',reviewed.decision_revision,
   'approvedDecisionSourceOrder',reviewed.decision_source_order,
   'approvedDecisionOrderedAt',public.canonical_forecast_utc_instant(reviewed.ordered_at),
   'approvedDecisionDigest',reviewed.review_approved_decision_digest,
   'reviewedPriceBeforeTax',reviewed.reviewed_price_before_tax,
   'currency',reviewed.review_currency,
   'reviewRequestDigest',reviewed.review_request_digest,
   'reviewDigest',reviewed.review_digest,
   'priceEffectiveNoLaterThanBooking',TRUE,'reviewHistory',review_history));
 END LOOP;
 IF jsonb_array_length(receipts)<>member_count OR octet_length(receipts::text)>262144 THEN
  RAISE EXCEPTION 'Pipeline scenario outcome exceeds bounded size' USING ERRCODE='54000';END IF;
 IF unresolved_count>0 THEN
  RETURN jsonb_build_object('state','unavailable',
   'reason','event_time_approved_price_unavailable',
   'unresolvedMemberCount',unresolved_count,'coverageDigest',coverage_digest,
   'receipts',receipts);
 END IF;
 RETURN jsonb_build_object('state','complete','memberCount',member_count,
  'bookedMemberCount',booked_member_count,
  'actualBookedWorkValueMicro',actual_micro,
  'unit','currency_micro_units','currency',saved.currency,
  'acceptedEventCount',accepted_event_count,
  'horizonSourceHighWaterOrder',horizon_source_high_water,
  'tenantSourceHighWaterOrder',tenant_source_high_water,
  'tenantVisibilityHighWaterOrder',tenant_visibility_high_water,
  'coverageDigest',coverage_digest,
  'completedThrough',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'postCutoffEntrantsExcluded',TRUE,'receipts',receipts,
  'digest',public.canonical_completion_digest(jsonb_build_object(
   'version','m26-pipeline-cutoff-cohort-booked-work-value-outcome-v2',
   'originId',saved.id,'horizonStartsAt',
    public.canonical_forecast_utc_instant(saved.horizon_starts_at),
   'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
   'postCutoffEntrantsExcluded',TRUE,'coverageDigest',coverage_digest,
   'receipts',receipts)));
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_evaluation_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 origin_value UUID,reason_value TEXT,confirmed_value BOOLEAN,version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;saved public.canonical_forecast_pipeline_scenario_origins%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
 outcome JSONB;replay public.canonical_forecast_pipeline_scenario_evaluations%ROWTYPE;
 prior public.canonical_forecast_pipeline_scenario_evaluations%ROWTYPE;
 inserted public.canonical_forecast_pipeline_scenario_evaluations%ROWTYPE;
 key_hash TEXT;request_hash TEXT;new_revision INTEGER;state_value TEXT;
 evidence_value JSONB;metrics_value JSONB;actual_value NUMERIC;
 lower_value NUMERIC;upper_value NUMERIC;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   origin_value IS NULL OR reason_value IS NULL OR
   length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
   octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE OR
   version_value IS DISTINCT FROM 'pipeline-cutoff-cohort-evaluation-v1' THEN
  RAISE EXCEPTION 'Pipeline scenario evaluation input invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:pipeline-scenario-source:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:opportunity-eligibility:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-policy:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-evaluation:'||org::text||':'||origin_value::text,0)) THEN
  RAISE EXCEPTION 'Pipeline scenario evaluation is busy' USING ERRCODE='55P03';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO saved FROM public.canonical_forecast_pipeline_scenario_origins
 WHERE organization_id=org AND id=origin_value;
 IF saved.id IS NULL THEN RETURN NULL;END IF;
 IF rtrim(saved.evidence_digest)<>public.canonical_completion_digest(saved.evidence) OR
   rtrim(saved.output_digest)<>public.canonical_completion_digest(saved.private_output) OR
   rtrim(saved.canonical_digest)<>public.canonical_completion_digest(jsonb_build_object(
   'evidence',saved.evidence,'privateOutput',saved.private_output)) THEN
  RAISE EXCEPTION 'Pipeline scenario origin integrity invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO method_row
 FROM public.canonical_forecast_pipeline_scenario_method_registration
 WHERE version=saved.method_version;
 IF method_row.version IS NULL OR
   rtrim(method_row.dependency_closure_digest)<>rtrim(saved.method_closure_digest) OR
   rtrim(method_row.dependency_closure_digest)<>
    public.canonical_forecast_pipeline_scenario_method_closure_digest() OR
   NOT public.canonical_forecast_pipeline_scenario_origin_input_current(org,saved) THEN
  RETURN jsonb_build_object('state','pipeline_scenario_evaluation_unavailable',
   'reason','frozen_origin_evidence_unavailable','metricsWithheld',TRUE,
   'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE);
 END IF;
 outcome:=public.canonical_forecast_pipeline_scenario_outcome(org,saved);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF outcome->>'state'<>'complete' THEN
  RETURN jsonb_build_object('state','pipeline_scenario_evaluation_unavailable',
   'reason',COALESCE(outcome->>'reason','complete_outcome_unavailable'),
   'metricsWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version',version_value,'organizationId',org,'actorUserId',actor,
  'originId',origin_value,'reason',btrim(reason_value),'confirmed',confirmed_value));
 SELECT * INTO replay FROM public.canonical_forecast_pipeline_scenario_evaluations
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash OR
    replay.outcome_evidence->>'outcomeDigest' IS DISTINCT FROM rtrim(replay.outcome_digest) OR
    rtrim(replay.metrics_digest)<>public.canonical_completion_digest(replay.private_metrics) OR
    rtrim(replay.canonical_digest)<>public.canonical_completion_digest(jsonb_build_object(
     'outcomeEvidence',replay.outcome_evidence,'privateMetrics',replay.private_metrics)) THEN
   RAISE EXCEPTION 'Pipeline scenario evaluation request reused' USING ERRCODE='23505';END IF;
  authority:=public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,csrf,TRUE);
  IF rtrim(replay.outcome_digest)<>outcome->>'digest' THEN
   RETURN jsonb_build_object('state','pipeline_scenario_evaluation_unavailable',
    'reason','prior_evaluation_stale_new_request_required','metricsWithheld',TRUE,
    'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE);END IF;
  RETURN jsonb_build_object('state','pipeline_scenario_evaluation_saved',
   'id',replay.id,'originId',replay.origin_id,'revision',replay.revision,
   'replayed',TRUE,'measurementKey',
    'research.pipeline_cutoff_cohort_booked_work_value','formalTargetClaimed',FALSE,
   'postCutoffEntrantsExcluded',TRUE,'metricsWithheld',TRUE,'researchOnly',TRUE,
   'calibrationClaimed',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
   'automaticActionTaken',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_pipeline_scenario_evaluations
 WHERE organization_id=org AND origin_id=origin_value
 ORDER BY revision DESC,id DESC LIMIT 1;
 new_revision:=COALESCE(prior.revision,0)+1;
 actual_value:=(outcome->>'actualBookedWorkValueMicro')::numeric;
 lower_value:=(saved.private_output#>>'{totalRangeMicro,lower}')::numeric;
 upper_value:=(saved.private_output#>>'{totalRangeMicro,upper}')::numeric;
 state_value:=CASE WHEN actual_value<lower_value THEN 'below_scenario_range'
   WHEN actual_value>upper_value THEN 'above_scenario_range'
   ELSE 'inside_scenario_range' END;
 evidence_value:=jsonb_build_object(
  'version','m26-pipeline-cutoff-cohort-evaluation-evidence-v1',
  'originId',origin_value,
  'measurementKey','research.pipeline_cutoff_cohort_booked_work_value',
  'measurementVersion','v1','formalTargetClaimed',FALSE,
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'upperBoundary','exclusive','postCutoffEntrantsExcluded',TRUE,
  'outcomeDigest',outcome->>'digest',
  'coverageDigest',outcome->>'coverageDigest',
  'acceptedEventCount',outcome->'acceptedEventCount',
  'horizonSourceHighWaterOrder',outcome->'horizonSourceHighWaterOrder',
  'tenantSourceHighWaterOrder',outcome->'tenantSourceHighWaterOrder',
  'tenantVisibilityHighWaterOrder',outcome->'tenantVisibilityHighWaterOrder',
  'receipts',outcome->'receipts');
 metrics_value:=jsonb_build_object(
  'version','m26-pipeline-cutoff-cohort-private-metrics-v1',
  'currency',saved.currency,'unit','currency_micro_units',
  'actualBookedWorkValueMicro',actual_value,
  'scenarioRangeMicro',saved.private_output->'totalRangeMicro','comparison',state_value,
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,
  'cashMeasured',FALSE,'forecastIssued',FALSE);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_pipeline_scenario_evaluations(
  organization_id,origin_id,revision,previous_id,outcome_evidence,outcome_digest,
  private_metrics,metrics_digest,actor_user_id,membership_id,auth_session_id,
  reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,origin_value,new_revision,prior.id,evidence_value,outcome->>'digest',
  metrics_value,public.canonical_completion_digest(metrics_value),actor,
  (authority->>'membershipId')::uuid,session_value,btrim(reason_value),key_hash,
  request_hash,public.canonical_completion_digest(jsonb_build_object(
   'outcomeEvidence',evidence_value,'privateMetrics',metrics_value)))
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','pipeline_scenario_evaluation_saved',
  'id',inserted.id,'originId',origin_value,'revision',inserted.revision,
  'replayed',FALSE,'measurementKey',
   'research.pipeline_cutoff_cohort_booked_work_value','formalTargetClaimed',FALSE,
  'postCutoffEntrantsExcluded',TRUE,'metricsWithheld',TRUE,'researchOnly',TRUE,
  'calibrationClaimed',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'automaticActionTaken',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_scenario_evaluation_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_pipeline_scenario_evaluations%ROWTYPE;
 origin_row public.canonical_forecast_pipeline_scenario_origins%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
 outcome JSONB;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||org::text,0)) OR
  NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-policy:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-evaluation-read:'||org::text||':'||evaluation_value::text,0)) THEN
  RAISE EXCEPTION 'Pipeline scenario evaluation read is busy' USING ERRCODE='55P03';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO selected FROM public.canonical_forecast_pipeline_scenario_evaluations
 WHERE organization_id=org AND id=evaluation_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO origin_row FROM public.canonical_forecast_pipeline_scenario_origins
 WHERE organization_id=org AND id=selected.origin_id;
 IF origin_row.id IS NULL OR
   rtrim(origin_row.evidence_digest)<>public.canonical_completion_digest(origin_row.evidence) OR
   rtrim(origin_row.output_digest)<>public.canonical_completion_digest(origin_row.private_output) OR
   rtrim(origin_row.canonical_digest)<>public.canonical_completion_digest(jsonb_build_object(
    'evidence',origin_row.evidence,'privateOutput',origin_row.private_output)) OR
   selected.outcome_evidence->>'outcomeDigest' IS DISTINCT FROM rtrim(selected.outcome_digest) OR
   rtrim(selected.metrics_digest)<>public.canonical_completion_digest(selected.private_metrics) OR
   rtrim(selected.canonical_digest)<>public.canonical_completion_digest(jsonb_build_object(
   'outcomeEvidence',selected.outcome_evidence,
   'privateMetrics',selected.private_metrics)) THEN
  RAISE EXCEPTION 'Pipeline scenario evaluation integrity invalid' USING ERRCODE='23514';END IF;
 SELECT * INTO method_row
 FROM public.canonical_forecast_pipeline_scenario_method_registration
 WHERE version=origin_row.method_version;
 IF method_row.version IS NULL OR
   rtrim(method_row.dependency_closure_digest)<>rtrim(origin_row.method_closure_digest) OR
   rtrim(method_row.dependency_closure_digest)<>
    public.canonical_forecast_pipeline_scenario_method_closure_digest() OR
   NOT public.canonical_forecast_pipeline_scenario_origin_input_current(org,origin_row) THEN
  RETURN jsonb_build_object('state','pipeline_scenario_evaluation_stale',
   'id',selected.id,'originId',selected.origin_id,'revision',selected.revision,
   'refreshRequired',TRUE,'metricsWithheld',TRUE,'researchOnly',TRUE,
   'forecastIssued',FALSE,'paidNumericServing',FALSE);
 END IF;
 outcome:=public.canonical_forecast_pipeline_scenario_outcome(org,origin_row);
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF outcome->>'state'<>'complete' OR outcome->>'digest'<>rtrim(selected.outcome_digest) THEN
  RETURN jsonb_build_object('state','pipeline_scenario_evaluation_stale',
   'id',selected.id,'originId',selected.origin_id,'revision',selected.revision,
   'refreshRequired',TRUE,'metricsWithheld',TRUE,'researchOnly',TRUE,
   'forecastIssued',FALSE,'paidNumericServing',FALSE);
 END IF;
 RETURN jsonb_build_object('state','pipeline_scenario_evaluation_current',
  'id',selected.id,'originId',selected.origin_id,'revision',selected.revision,
  'evaluatedAt',public.canonical_forecast_utc_instant(selected.evaluated_at),
  'measurementKey','research.pipeline_cutoff_cohort_booked_work_value',
  'formalTargetClaimed',FALSE,'postCutoffEntrantsExcluded',TRUE,
  'metricsWithheld',TRUE,'researchOnly',TRUE,'calibrationClaimed',FALSE,
  'forecastIssued',FALSE,'paidNumericServing',FALSE,'automaticActionTaken',FALSE);
END $$;

-- Register the exact server-selected research method only after every
-- executable body and trigger binding exists. The closure includes the sealed
-- Part 6A closure, the bounded Part 6B routines, the trigger topology, and a
-- normative semantic statement for categories, horizon, assumptions,
-- arithmetic, rounding, applicability, and excluded formal targets.
CREATE OR REPLACE FUNCTION public.canonical_forecast_pipeline_scenario_method_closure_digest()
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pending OID[]:=ARRAY[
 'public.canonical_forecast_pipeline_scenario_immutable()'::regprocedure::oid,
 'public.canonical_forecast_pipeline_estimate_source_insert()'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_clock()'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_weighted_micro(jsonb,text,integer)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_total_weighted_micro(jsonb,integer,integer)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_sources(uuid,uuid,text,uuid,text,timestamptz)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_origin_input_current(uuid,public.canonical_forecast_pipeline_scenario_origins)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_policy_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,integer,integer,integer,integer,integer,integer,boolean,text)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_policy_read(uuid,uuid,text,uuid)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_origin_capture(uuid,uuid,text,uuid,text,text,text,boolean,text)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_origin_read(uuid,uuid,text,uuid,uuid)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_outcome(uuid,public.canonical_forecast_pipeline_scenario_origins)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid,text,boolean,text)'::regprocedure::oid,
 'public.canonical_forecast_pipeline_scenario_evaluation_read(uuid,uuid,text,uuid,uuid)'::regprocedure::oid
 ];
 visited OID[]:=ARRAY[]::oid[];entries TEXT[]:=ARRAY[]::text[];
 current_oid OID;body TEXT;matched TEXT[];child OID;joined TEXT;
 attached RECORD;trigger_count INTEGER:=0;
BEGIN
 entries:=array_append(entries,'PART6A_CLOSURE:'||
  public.canonical_forecast_integrated_commercial_closure_digest());
 entries:=array_append(entries,
  'METHOD:m26_pipeline_open_value_scenario_bounded_v1:'||
  'authoritative_m222_open_risk_at_cutoff;categories=preliminary_estimate,'||
  'approved_unbooked,withdrawn_excluded,reviewed_unconfirmed_excluded,'||
  'confirmed_booked_excluded,cancelled_excluded,corrected_excluded;'||
  'horizon=next_complete_tenant_local_month_[start,end);'||
  'weights=owner_reviewed_scenario_assumptions_not_calibrated_probabilities;'||
  'formula=sum_integer_cents_times_ppm_divide_100;'||
  'rounding=single_nonnegative_half_up_to_currency_micro_units;'||
  'bounds=256_members_12_integer_price_digits;'||
  'applicability=private_research_only_same_cutoff_cohort;'||
  'excludes=post_cutoff_entrants,formal_revenue.booked_work_value.v1,'||
  'issued_or_paid_numeric_forecasts,earned_revenue,collected_cash,automatic_action');
 FOR attached IN SELECT trigger_value.tgrelid,trigger_value.tgname,
    trigger_value.tgfoid,trigger_value.tgenabled,
    pg_get_triggerdef(trigger_value.oid) definition
   FROM pg_trigger trigger_value
   WHERE NOT trigger_value.tgisinternal AND (
    (trigger_value.tgrelid='public.canonical_forecast_pipeline_estimate_sources'::regclass AND
     trigger_value.tgname='canonical_forecast_pipeline_estimate_sources_immutable') OR
    (trigger_value.tgrelid='public.canonical_estimates'::regclass AND
     trigger_value.tgname='canonical_forecast_pipeline_estimate_update_guard') OR
    (trigger_value.tgrelid='public.canonical_estimates'::regclass AND
     trigger_value.tgname='canonical_forecast_pipeline_estimate_source_insert') OR
    (trigger_value.tgrelid='public.canonical_forecast_pipeline_scenario_method_registration'::regclass AND
     trigger_value.tgname='canonical_forecast_pipeline_scenario_method_immutable') OR
    (trigger_value.tgrelid='public.canonical_forecast_pipeline_scenario_policy_reviews'::regclass AND
     trigger_value.tgname='canonical_forecast_pipeline_scenario_policy_immutable') OR
     (trigger_value.tgrelid='public.canonical_forecast_pipeline_scenario_origins'::regclass AND
      trigger_value.tgname='canonical_forecast_pipeline_scenario_origins_immutable') OR
     (trigger_value.tgrelid='public.canonical_forecast_pipeline_scenario_evaluations'::regclass AND
      trigger_value.tgname='canonical_forecast_pipeline_scenario_evaluations_immutable') OR
     (trigger_value.tgrelid='public.canonical_operations'::regclass AND
      trigger_value.tgname='a_canonical_forecast_opportunity_eligibility_lock') OR
     (trigger_value.tgrelid='public.canonical_operations'::regclass AND
      trigger_value.tgname='canonical_forecast_opportunity_eligibility_capture') OR
     (trigger_value.tgrelid='public.canonical_forecast_opportunity_eligibility_events'::regclass AND
      trigger_value.tgname='canonical_forecast_opportunity_eligibility_event_immutable') OR
     (trigger_value.tgrelid='public.canonical_forecast_opportunity_eligibility_events'::regclass AND
      trigger_value.tgname='z_canonical_forecast_pipeline_eligibility_visibility_v1_capture') OR
     (trigger_value.tgrelid='public.canonical_forecast_pipeline_eligibility_visibility_v1'::regclass AND
      trigger_value.tgname='canonical_forecast_pipeline_eligibility_visibility_v1_immutable') OR
     (trigger_value.tgrelid='public.canonical_schedule_assignment_revisions'::regclass AND
      trigger_value.tgname='a_canonical_forecast_schedule_booking_event_lock') OR
     (trigger_value.tgrelid='public.canonical_schedule_assignment_revisions'::regclass AND
      trigger_value.tgname='canonical_forecast_schedule_booking_event_capture') OR
     (trigger_value.tgrelid='public.canonical_forecast_schedule_booking_events'::regclass AND
      trigger_value.tgname='canonical_forecast_schedule_booking_event_immutable') OR
     (trigger_value.tgrelid='public.canonical_forecast_schedule_booking_events'::regclass AND
      trigger_value.tgname='z_canonical_forecast_pipeline_booking_visibility_v1_capture') OR
     (trigger_value.tgrelid='public.canonical_forecast_pipeline_booking_visibility_v1'::regclass AND
      trigger_value.tgname='canonical_forecast_pipeline_booking_visibility_v1_immutable') OR
     (trigger_value.tgrelid='public.canonical_forecast_schedule_booking_lineage_gaps'::regclass AND
      trigger_value.tgname='canonical_forecast_schedule_booking_lineage_gap_immutable') OR
     (trigger_value.tgrelid='public.canonical_forecast_commercial_booking_reviews'::regclass AND
      trigger_value.tgname='z_m26_part6b_disposable_booking_review_clock'))
   ORDER BY trigger_value.tgrelid::regclass::text,trigger_value.tgname LOOP
  entries:=array_append(entries,'TRIGGER:'||attached.tgrelid::regclass::text||':'||
   attached.tgname||':'||attached.tgenabled::text||':'||attached.definition);
  pending:=array_append(pending,attached.tgfoid);trigger_count:=trigger_count+1;
 END LOOP;
 IF trigger_count<>19 THEN
  RAISE EXCEPTION 'Pipeline scenario closure trigger topology is incomplete'
   USING ERRCODE='23514';
 END IF;
 WHILE cardinality(pending)>0 LOOP
  current_oid:=pending[1];pending:=pending[2:cardinality(pending)];
  IF current_oid=ANY(visited) THEN CONTINUE;END IF;
  visited:=array_append(visited,current_oid);
  IF cardinality(visited)>768 THEN
   RAISE EXCEPTION 'Pipeline scenario dependency closure exceeds reviewed bound'
    USING ERRCODE='23514';
  END IF;
  body:=pg_get_functiondef(current_oid);
  IF body IS NULL THEN
   RAISE EXCEPTION 'Pipeline scenario dependency is missing' USING ERRCODE='23514';
  END IF;
  entries:=array_append(entries,'FUNCTION:'||current_oid::regprocedure::text||':'||
   encode(sha256(convert_to(body,'UTF8')),'hex'));
  FOR matched IN SELECT regexp_matches(body,
    'public\.([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*\(', 'g') LOOP
   FOR child IN SELECT oid FROM pg_proc
     WHERE pronamespace='public'::regnamespace AND proname=matched[1]
     ORDER BY oid LOOP
    IF NOT child=ANY(visited) THEN pending:=array_append(pending,child);END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 SELECT string_agg(item,E'\n' ORDER BY item) INTO joined FROM unnest(entries) item;
 RETURN encode(sha256(convert_to(joined,'UTF8')),'hex');
END $$;

INSERT INTO public.canonical_forecast_pipeline_scenario_method_registration(
 version,target_key,target_version,evaluation_measurement_key,
 evaluation_measurement_version,calculation_version,category_rule_version,
 horizon_rule_version,arithmetic_rule,maximum_members,maximum_price_cents,
 dependency_closure_digest)
VALUES('m26_pipeline_open_value_scenario_bounded_v1',
 'pipeline.open_value_scenario','v1',
 'research.pipeline_cutoff_cohort_booked_work_value','v1',
 'm26-pipeline-scenario-v1','m26-open-pipeline-category-v1',
 'next-complete-tenant-local-month-v1',
 'sum_integer_cents_times_ppm_then_half_up_six_decimal_dollars',256,
 99999999999999,
 public.canonical_forecast_pipeline_scenario_method_closure_digest());
DO $$
DECLARE registered TEXT;live TEXT;sealed_part6a TEXT;
BEGIN
 SELECT rtrim(dependency_closure_digest) INTO registered
 FROM public.canonical_forecast_pipeline_scenario_method_registration
 WHERE version='m26_pipeline_open_value_scenario_bounded_v1';
 live:=public.canonical_forecast_pipeline_scenario_method_closure_digest();
 SELECT rtrim(dependency_closure_digest) INTO sealed_part6a
 FROM public.canonical_forecast_integrated_method_registration
 WHERE version='m26_integrated_commercial_price_closure_v1';
 IF registered IS DISTINCT FROM live OR sealed_part6a IS NULL OR
   sealed_part6a IS DISTINCT FROM
    public.canonical_forecast_integrated_commercial_closure_digest() THEN
  RAISE EXCEPTION 'Pipeline scenario method registration is incomplete'
   USING ERRCODE='23514';
 END IF;
END $$;

REVOKE ALL ON SEQUENCE public.canonical_forecast_pipeline_estimate_source_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_pipeline_estimate_sources,
 public.canonical_forecast_pipeline_scenario_test_clock,
 public.canonical_forecast_pipeline_scenario_method_registration,
 public.canonical_forecast_pipeline_scenario_policy_reviews,
 public.canonical_forecast_pipeline_scenario_origins,
 public.canonical_forecast_pipeline_scenario_evaluations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_pipeline_scenario_immutable(),
 public.canonical_forecast_pipeline_estimate_source_insert(),
 public.canonical_forecast_pipeline_scenario_clock(),
 public.canonical_forecast_pipeline_scenario_test_clock_set(TIMESTAMPTZ),
 public.canonical_forecast_pipeline_scenario_booking_review_clock(),
 public.canonical_forecast_pipeline_scenario_method_closure_digest(),
 public.canonical_forecast_pipeline_scenario_weighted_micro(JSONB,TEXT,INTEGER),
 public.canonical_forecast_pipeline_scenario_total_weighted_micro(JSONB,INTEGER,INTEGER),
 public.canonical_forecast_pipeline_scenario_sources(
  UUID,UUID,TEXT,UUID,TEXT,TIMESTAMPTZ),
 public.canonical_forecast_pipeline_scenario_origin_input_current(
  UUID,public.canonical_forecast_pipeline_scenario_origins),
 public.canonical_forecast_pipeline_scenario_outcome(
  UUID,public.canonical_forecast_pipeline_scenario_origins) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_pipeline_scenario_policy_mutate(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,
 INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,BOOLEAN,TEXT),
 public.canonical_forecast_pipeline_scenario_policy_read(UUID,UUID,TEXT,UUID),
 public.canonical_forecast_pipeline_scenario_origin_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN,TEXT),
 public.canonical_forecast_pipeline_scenario_origin_read(UUID,UUID,TEXT,UUID,UUID),
 public.canonical_forecast_pipeline_scenario_evaluation_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT),
 public.canonical_forecast_pipeline_scenario_evaluation_read(
  UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$
DECLARE runtime_role TEXT:='northstar_app_runtime';
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_pipeline_estimate_sources,public.canonical_forecast_pipeline_scenario_test_clock,public.canonical_forecast_pipeline_scenario_method_registration,public.canonical_forecast_pipeline_scenario_policy_reviews,public.canonical_forecast_pipeline_scenario_origins,public.canonical_forecast_pipeline_scenario_evaluations FROM %I',runtime_role);
  EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE public.canonical_forecast_pipeline_estimate_source_sequence FROM %I',runtime_role);
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.canonical_forecast_pipeline_scenario_immutable(),public.canonical_forecast_pipeline_estimate_source_insert(),public.canonical_forecast_pipeline_scenario_clock(),public.canonical_forecast_pipeline_scenario_test_clock_set(timestamptz),public.canonical_forecast_pipeline_scenario_booking_review_clock(),public.canonical_forecast_pipeline_scenario_method_closure_digest(),public.canonical_forecast_pipeline_scenario_weighted_micro(jsonb,text,integer),public.canonical_forecast_pipeline_scenario_total_weighted_micro(jsonb,integer,integer),public.canonical_forecast_pipeline_scenario_sources(uuid,uuid,text,uuid,text,timestamptz),public.canonical_forecast_pipeline_scenario_origin_input_current(uuid,public.canonical_forecast_pipeline_scenario_origins),public.canonical_forecast_pipeline_scenario_outcome(uuid,public.canonical_forecast_pipeline_scenario_origins) FROM %I',runtime_role);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_pipeline_scenario_policy_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,integer,integer,integer,integer,integer,integer,boolean,text),public.canonical_forecast_pipeline_scenario_policy_read(uuid,uuid,text,uuid),public.canonical_forecast_pipeline_scenario_origin_capture(uuid,uuid,text,uuid,text,text,text,boolean,text),public.canonical_forecast_pipeline_scenario_origin_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_pipeline_scenario_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid,text,boolean,text),public.canonical_forecast_pipeline_scenario_evaluation_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
