-- Mission 26 Part 4B: purpose-fixed, four-target transition research origins.
-- This authority composes only the authenticated NorthStar sources introduced
-- by migrations 203-206. It never certifies provider/off-platform history,
-- calibration, production forecast eligibility, or paid numeric serving.

CREATE TABLE public.canonical_forecast_transition_coverage_epochs_v2 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 target_key TEXT NOT NULL,
 installed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 baseline_source_order BIGINT NOT NULL,
 baseline_secondary_order BIGINT NOT NULL DEFAULT 0,
 source_authority TEXT NOT NULL,
 epoch_digest CHAR(64) NOT NULL,
 PRIMARY KEY(organization_id,target_key),
 CHECK(target_key IN ('demand.qualification_transition.v1',
  'demand.estimate_request_transition.v1','demand.booking_transition.v1',
  'demand.booking_cancellation.v1')),
 CHECK(baseline_source_order>=0 AND baseline_secondary_order>=0),
 CHECK(epoch_digest~'^[0-9a-f]{64}$')
);

CREATE TABLE public.canonical_forecast_transition_methods_v2 (
 id UUID PRIMARY KEY,
 version TEXT NOT NULL UNIQUE,
 calculation_version TEXT NOT NULL,
 review_version TEXT NOT NULL,
 target_keys JSONB NOT NULL,
 method_digest CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 CHECK(target_keys='["demand.qualification_transition.v1",
  "demand.estimate_request_transition.v1","demand.booking_transition.v1",
  "demand.booking_cancellation.v1"]'::jsonb),
 CHECK(method_digest~'^[0-9a-f]{64}$')
);

INSERT INTO public.canonical_forecast_transition_methods_v2(
 id,version,calculation_version,review_version,target_keys,method_digest)
SELECT '00000000-0000-4000-8000-0000000004b2',
 'm26-transition-four-target-research-v2',
 'm26-two-complete-local-month-weighted-rate-v2',
 'm26-source-finalization-human-review-v2',targets,
 public.canonical_completion_digest(jsonb_build_object(
  'version','m26-transition-four-target-research-v2',
  'calculationVersion','m26-two-complete-local-month-weighted-rate-v2',
  'reviewVersion','m26-source-finalization-human-review-v2','targets',targets))
FROM (SELECT '["demand.qualification_transition.v1",
 "demand.estimate_request_transition.v1","demand.booking_transition.v1",
 "demand.booking_cancellation.v1"]'::jsonb targets) fixed;

-- A registered deterministic method is only a candidate. A tenant owner or
-- administrator must append an explicit review before that method can be used.
-- Reviews are immutable and bind the exact four-target method identity.
CREATE TABLE public.canonical_forecast_transition_method_reviews_v2 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision>0),
 previous_id UUID,
 method_id UUID NOT NULL REFERENCES public.canonical_forecast_transition_methods_v2(id),
 method_digest CHAR(64) NOT NULL CHECK(method_digest~'^[0-9a-f]{64}$'),
 action TEXT NOT NULL CHECK(action IN ('approve','reject')),
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND
  octet_length(reason)<=4000),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 review_digest CHAR(64) NOT NULL CHECK(review_digest~'^[0-9a-f]{64}$'),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_transition_method_reviews_v2(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_forecast_transition_future_origins_v2 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 as_of TIMESTAMPTZ NOT NULL,
 prediction_cutoff_at TIMESTAMPTZ NOT NULL,
 horizon_ends_at TIMESTAMPTZ NOT NULL,
 time_zone TEXT NOT NULL,
 profile_anchor_id UUID NOT NULL,
 profile_source_order BIGINT NOT NULL CHECK(profile_source_order>=0),
 business_profile_id UUID NOT NULL,
 business_profile_version INTEGER NOT NULL,
 business_profile_hash CHAR(64) NOT NULL,
 method_id UUID NOT NULL REFERENCES public.canonical_forecast_transition_methods_v2(id),
 method_digest CHAR(64) NOT NULL,
 method_review_id UUID NOT NULL,
 method_review_revision INTEGER NOT NULL CHECK(method_review_revision>0),
 method_review_digest CHAR(64) NOT NULL CHECK(method_review_digest~'^[0-9a-f]{64}$'),
 evidence JSONB NOT NULL,
 evidence_digest CHAR(64) NOT NULL,
 private_output JSONB NOT NULL,
 output_digest CHAR(64) NOT NULL,
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL,
 request_digest CHAR(64) NOT NULL,
 canonical_digest CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,business_profile_id)
  REFERENCES public.canonical_business_profiles(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,profile_anchor_id)
  REFERENCES public.canonical_forecast_profile_effective_anchors(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,method_review_id)
  REFERENCES public.canonical_forecast_transition_method_reviews_v2(organization_id,id)
  ON DELETE RESTRICT,
 CHECK(horizon_ends_at>prediction_cutoff_at AND as_of<prediction_cutoff_at),
 CHECK(business_profile_version>0),
 CHECK(business_profile_hash~'^[0-9a-f]{64}$' AND method_digest~'^[0-9a-f]{64}$' AND
  evidence_digest~'^[0-9a-f]{64}$' AND output_digest~'^[0-9a-f]{64}$' AND
  request_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$' AND
  canonical_digest~'^[0-9a-f]{64}$'),
 CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=262144),
 CHECK(jsonb_typeof(private_output)='object' AND octet_length(private_output::text)<=262144)
);

CREATE TABLE public.canonical_forecast_transition_evaluations_v2 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 origin_id UUID NOT NULL,
 revision INTEGER NOT NULL,
 previous_id UUID,
 outcome_evidence JSONB NOT NULL,
 outcome_evidence_digest CHAR(64) NOT NULL,
 private_metrics JSONB NOT NULL,
 metrics_digest CHAR(64) NOT NULL,
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL,
 request_digest CHAR(64) NOT NULL,
 canonical_digest CHAR(64) NOT NULL,
 evaluated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,origin_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,origin_id)
  REFERENCES public.canonical_forecast_transition_future_origins_v2(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_transition_evaluations_v2(organization_id,id)
  ON DELETE RESTRICT,
 CHECK(revision>0),
 CHECK(outcome_evidence_digest~'^[0-9a-f]{64}$' AND metrics_digest~'^[0-9a-f]{64}$' AND
  request_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$' AND
  canonical_digest~'^[0-9a-f]{64}$'),
 CHECK(jsonb_typeof(outcome_evidence)='object' AND
  octet_length(outcome_evidence::text)<=262144),
 CHECK(jsonb_typeof(private_metrics)='object' AND
  octet_length(private_metrics::text)<=262144)
);

CREATE FUNCTION public.canonical_forecast_transition_v2_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Transition research evidence is immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER canonical_forecast_transition_epochs_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_transition_coverage_epochs_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_transition_methods_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_transition_methods_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_transition_method_reviews_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_transition_method_reviews_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_transition_origins_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_transition_future_origins_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_transition_evaluations_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_transition_evaluations_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();

-- Production uses the database statement clock. This private purpose-fixed
-- function also permits deterministic prospective lifecycle evidence without
-- rewriting an immutable saved origin.
CREATE FUNCTION public.canonical_forecast_transition_clock_v2()
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT statement_timestamp()
$$;

CREATE FUNCTION public.canonical_forecast_transition_profile_v2(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN profile.id IS NULL OR anchor.id IS NULL OR activation.anchor_id IS NULL OR
   zone.name IS NULL OR anchor.source_order<>current_source.source_order THEN NULL
  ELSE jsonb_build_object(
   'id',profile.id,'version',profile.version_number,
   'hash',rtrim(profile.normalized_profile_hash),
   'timeZone',profile.raw_profile#>>'{company,timeZone}',
   'anchorId',anchor.id,'profileSourceOrder',anchor.source_order,
   'activationObservedAt',public.canonical_forecast_utc_instant(activation.observed_at)) END
 FROM (SELECT 1) seed
 LEFT JOIN LATERAL (SELECT value.* FROM public.canonical_business_profiles value
  WHERE value.organization_id=org AND value.is_active
  ORDER BY value.version_number DESC LIMIT 1) profile ON TRUE
 LEFT JOIN LATERAL (SELECT value.*
  FROM public.canonical_forecast_profile_effective_anchors value
  WHERE value.organization_id=org AND value.business_profile_id=profile.id
   AND value.business_profile_version=profile.version_number
   AND value.business_profile_hash=profile.normalized_profile_hash
   AND value.raw_profile_digest=public.canonical_completion_digest(profile.raw_profile)
  ORDER BY value.source_order DESC,value.captured_at DESC,value.id DESC LIMIT 1) anchor ON TRUE
 LEFT JOIN public.canonical_forecast_profile_effective_activations activation
  ON activation.organization_id=org AND activation.anchor_id=anchor.id
 LEFT JOIN LATERAL (SELECT COALESCE(max(source_order),0) source_order
  FROM public.canonical_forecast_profile_change_events value
  WHERE value.organization_id=org) current_source ON TRUE
 LEFT JOIN pg_catalog.pg_timezone_names zone
  ON zone.name=profile.raw_profile#>>'{company,timeZone}'
$$;

CREATE FUNCTION public.canonical_forecast_transition_child_key_v2(
 parent_key TEXT,child_discriminator TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT 'm26p4b:'||public.canonical_completion_digest(jsonb_build_object(
  'version','m26-transition-child-idempotency-v2',
  'parentKey',parent_key,'child',child_discriminator))
$$;

CREATE FUNCTION public.canonical_forecast_transition_method_review_v2_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,reason_value TEXT,expected_revision INTEGER,expected_digest TEXT,
 confirmed_value BOOLEAN,confirmation_version TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;method_row public.canonical_forecast_transition_methods_v2%ROWTYPE;
 current_review public.canonical_forecast_transition_method_reviews_v2%ROWTYPE;
 replay public.canonical_forecast_transition_method_reviews_v2%ROWTYPE;
 new_id UUID:=gen_random_uuid();new_revision INTEGER;reviewed TIMESTAMPTZ;
 key_hash TEXT;request_hash TEXT;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    action_value IS NULL OR action_value NOT IN ('approve','reject') OR
    reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
    octet_length(reason_value)>4000 OR expected_revision IS NULL OR
    expected_revision NOT BETWEEN 0 AND 10000 OR
    expected_digest IS NULL OR NOT (expected_digest='none' OR
     expected_digest~'^[0-9a-f]{64}$') OR confirmed_value IS DISTINCT FROM TRUE OR
    ((expected_revision=0)<>(expected_digest='none')) OR
    confirmation_version<>'m26-transition-method-review-v2' THEN
  RAISE EXCEPTION 'Transition method review request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:transition-method-review-v2:'||org::text,0));
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-transition-method-review-v2','action',action_value,
  'reason',btrim(reason_value),'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'confirmed',confirmed_value,
  'confirmationVersion',confirmation_version));
 SELECT * INTO replay FROM public.canonical_forecast_transition_method_reviews_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Transition method review request key conflict' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('state','transition_method_review_recorded','id',replay.id,
   'revision',replay.revision,'action',replay.action,
   'reviewDigest',rtrim(replay.review_digest),'methodId',replay.method_id,
   'methodDigest',rtrim(replay.method_digest),'replayed',TRUE,'researchOnly',TRUE,
   'automaticSelection',FALSE,'automaticActionTaken',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 SELECT * INTO method_row FROM public.canonical_forecast_transition_methods_v2
  ORDER BY created_at DESC,id DESC LIMIT 1;
 IF method_row.id IS NULL THEN
  RAISE EXCEPTION 'Transition method unavailable' USING ERRCODE='55000';END IF;
 SELECT * INTO current_review FROM public.canonical_forecast_transition_method_reviews_v2
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF COALESCE(current_review.revision,0)<>expected_revision OR
    COALESCE(rtrim(current_review.review_digest),'none')<>expected_digest THEN
  RAISE EXCEPTION 'Transition method review changed' USING ERRCODE='40001';END IF;
 new_revision:=expected_revision+1;reviewed:=clock_timestamp();
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-transition-method-review-v2','id',new_id,'organizationId',org,
  'revision',new_revision,'previousId',current_review.id,'methodId',method_row.id,
  'methodDigest',rtrim(method_row.method_digest),'methodVersion',method_row.version,
  'calculationVersion',method_row.calculation_version,'reviewVersion',method_row.review_version,
  'targetKeys',method_row.target_keys,'action',action_value,'reason',btrim(reason_value),
  'actorUserId',actor,'membershipId',authority->>'membershipId',
  'reviewedAt',public.canonical_forecast_utc_instant(reviewed)));
 INSERT INTO public.canonical_forecast_transition_method_reviews_v2(
  id,organization_id,revision,previous_id,method_id,method_digest,action,reason,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,
  review_digest,reviewed_at)
 VALUES(new_id,org,new_revision,current_review.id,method_row.id,method_row.method_digest,
  action_value,btrim(reason_value),actor,(authority->>'membershipId')::uuid,session_value,
  key_hash,request_hash,digest_value,reviewed);
 RETURN jsonb_build_object('state','transition_method_review_recorded','id',new_id,
  'revision',new_revision,'action',action_value,'reviewDigest',digest_value,
  'methodId',method_row.id,'methodDigest',rtrim(method_row.method_digest),
  'replayed',FALSE,'researchOnly',TRUE,'automaticSelection',FALSE,
  'automaticActionTaken',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_transition_method_review_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_review public.canonical_forecast_transition_method_reviews_v2%ROWTYPE;
 method_row public.canonical_forecast_transition_methods_v2%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Transition method review access restricted' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:transition-method-review-v2:'||org::text,0)) THEN
  RAISE EXCEPTION 'Transition method review busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO current_review FROM public.canonical_forecast_transition_method_reviews_v2
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF current_review.id IS NULL THEN RETURN jsonb_build_object(
  'state','transition_method_review_unavailable','reason','review_missing',
  'expectedRevision',0,'expectedDigest','none','approved',FALSE,'researchOnly',TRUE,
  'automaticSelection',FALSE,'automaticActionTaken',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 SELECT * INTO method_row FROM public.canonical_forecast_transition_methods_v2
  WHERE id=current_review.method_id;
 RETURN jsonb_build_object('state','transition_method_review_current','id',current_review.id,
  'revision',current_review.revision,'action',current_review.action,
  'approved',current_review.action='approve','reviewDigest',rtrim(current_review.review_digest),
  'methodId',current_review.method_id,'methodDigest',rtrim(current_review.method_digest),
  'methodVersion',method_row.version,'calculationVersion',method_row.calculation_version,
  'reviewVersion',method_row.review_version,'targets',method_row.target_keys,
  'reviewedAt',public.canonical_forecast_utc_instant(current_review.reviewed_at),
  'researchOnly',TRUE,'automaticSelection',FALSE,'automaticActionTaken',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_transition_epoch_ensure_v2(org UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE inserted_count INTEGER:=0;lead_order BIGINT;request_order BIGINT;
 schedule_order BIGINT;opportunity_order BIGINT;epoch_time TIMESTAMPTZ:=statement_timestamp();
BEGIN
 SELECT COALESCE(max(review_order),0) INTO lead_order
  FROM public.canonical_lead_state_reviews WHERE organization_id=org;
 SELECT COALESCE(max(review_order),0) INTO request_order
  FROM public.canonical_estimate_request_state_reviews WHERE organization_id=org;
 SELECT COALESCE(max(source_order),0) INTO schedule_order
  FROM public.canonical_forecast_schedule_booking_events WHERE organization_id=org;
 SELECT COALESCE(max(source_order),0) INTO opportunity_order
  FROM public.canonical_forecast_opportunity_eligibility_activations WHERE organization_id=org;
 INSERT INTO public.canonical_forecast_transition_coverage_epochs_v2(
  organization_id,target_key,installed_at,baseline_source_order,baseline_secondary_order,
  source_authority,epoch_digest)
 SELECT org,value.target_key,epoch_time,value.primary_order,value.secondary_order,value.authority,
  public.canonical_completion_digest(jsonb_build_object(
   'version','m26-transition-coverage-epoch-v2','organizationId',org,
   'installedAt',public.canonical_forecast_utc_instant(epoch_time),
   'targetKey',value.target_key,'baselineSourceOrder',value.primary_order,
   'baselineSecondaryOrder',value.secondary_order,'sourceAuthority',value.authority))
 FROM (VALUES
  ('demand.qualification_transition.v1',lead_order,0::bigint,
   'northstar_human_reviewed_lead_state'),
  ('demand.estimate_request_transition.v1',request_order,0::bigint,
   'northstar_human_reviewed_estimate_request_state'),
  ('demand.booking_transition.v1',schedule_order,opportunity_order,
   'northstar_canonical_opportunity_and_human_approved_schedule_history'),
  ('demand.booking_cancellation.v1',schedule_order,0::bigint,
   'northstar_human_approved_schedule_history'))
  value(target_key,primary_order,secondary_order,authority)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;
 RETURN inserted_count>0;
END $$;

CREATE FUNCTION public.canonical_forecast_transition_cohort_capture_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 target_value TEXT,cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result_value JSONB;cohort JSONB;outcome_key TEXT;
BEGIN
 CASE target_value
  WHEN 'demand.qualification_transition.v1' THEN
   result_value:=public.canonical_forecast_lead_qualification_cohort_capture(
    org,actor,role_value,session_value,csrf,key_value,cutoff_value,horizon_value);
   outcome_key:='qualifiedCount';
  WHEN 'demand.estimate_request_transition.v1' THEN
   result_value:=public.canonical_forecast_estimate_request_cohort_capture(
    org,actor,role_value,session_value,csrf,key_value,cutoff_value,horizon_value);
   outcome_key:='requestedCount';
  WHEN 'demand.booking_transition.v1' THEN
   result_value:=public.canonical_forecast_schedule_booking_transition_cohort_capture(
    org,actor,role_value,session_value,csrf,key_value,cutoff_value,horizon_value);
   outcome_key:='bookedCount';
  WHEN 'demand.booking_cancellation.v1' THEN
   result_value:=public.canonical_forecast_schedule_booking_cancellation_cohort_capture(
    org,actor,role_value,session_value,csrf,key_value,cutoff_value,horizon_value);
   outcome_key:='cancelledCount';
  ELSE RAISE EXCEPTION 'Transition target invalid' USING ERRCODE='22023';
 END CASE;
 cohort:=result_value->'cohort';
 IF cohort->>'state'<>'descriptive_only' OR
    (cohort->>'eligibleCount')::integer NOT BETWEEN 1 AND 500 OR
    (cohort->>outcome_key)::integer NOT BETWEEN 0 AND (cohort->>'eligibleCount')::integer OR
    cohort->>'sourceDigest' IS NULL OR cohort->>'cohortDigest' IS NULL THEN
  RAISE EXCEPTION 'Transition comparable window unavailable' USING ERRCODE='P0002';
 END IF;
 RETURN jsonb_build_object('targetKey',target_value,'cohortId',cohort->>'id',
  'cohortDigest',cohort->>'cohortDigest','sourceDigest',cohort->>'sourceDigest',
  'sourceAuthority',cohort->>'sourceAuthority','cutoffAt',cohort->>'cutoffAt',
  'horizonEndsAt',cohort->>'horizonEndsAt',
  'eligibleCount',(cohort->>'eligibleCount')::integer,
  'outcomeCount',(cohort->>outcome_key)::integer,
  'researchOnly',TRUE,'probabilityWithheld',TRUE,'outputDigestWithheld',TRUE,
  'providerCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'naturalProductionHistoryVerified',FALSE,
  'empiricalCalibrationVerified',FALSE,'empiricalDriftVerified',FALSE,
  'realForecastEligible',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_transition_cohort_read_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,target_value TEXT,cohort_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 CASE target_value
  WHEN 'demand.qualification_transition.v1' THEN
   RETURN public.canonical_forecast_lead_qualification_cohort_read(
    org,actor,role_value,session_value,cohort_value);
  WHEN 'demand.estimate_request_transition.v1' THEN
   RETURN public.canonical_forecast_estimate_request_cohort_read(
    org,actor,role_value,session_value,cohort_value);
  WHEN 'demand.booking_transition.v1' THEN
   RETURN public.canonical_forecast_schedule_booking_transition_cohort_read(
    org,actor,role_value,session_value,cohort_value);
  WHEN 'demand.booking_cancellation.v1' THEN
   RETURN public.canonical_forecast_schedule_booking_cancellation_cohort_read(
    org,actor,role_value,session_value,cohort_value);
  ELSE RAISE EXCEPTION 'Transition target invalid' USING ERRCODE='22023';
 END CASE;
END $$;

CREATE FUNCTION public.canonical_forecast_transition_generation_v2(org UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE generation JSONB;
BEGIN
 generation:=jsonb_build_object(
  'version','m26-transition-source-generation-v2',
  'qualificationFinalization',(SELECT jsonb_build_object(
    'id',id,'revision',revision,'recordedThrough',
    public.canonical_forecast_utc_instant(recorded_through),
    'sourceHighWaterOrder',source_high_water_order,
    'digest',rtrim(canonical_digest))
   FROM public.canonical_lead_state_finalizations WHERE organization_id=org
   ORDER BY revision DESC LIMIT 1),
  'qualificationReviewHighWater',(SELECT COALESCE(max(review_order),0)
   FROM public.canonical_lead_state_reviews WHERE organization_id=org),
  'estimateRequestFinalization',(SELECT jsonb_build_object(
    'id',id,'revision',revision,'recordedThrough',
    public.canonical_forecast_utc_instant(recorded_through),
    'sourceHighWaterOrder',source_high_water_order,
    'digest',rtrim(canonical_digest))
   FROM public.canonical_estimate_request_state_finalizations WHERE organization_id=org
   ORDER BY revision DESC LIMIT 1),
  'estimateRequestReviewHighWater',(SELECT COALESCE(max(review_order),0)
   FROM public.canonical_estimate_request_state_reviews WHERE organization_id=org),
  'scheduleEventHighWater',(SELECT COALESCE(max(source_order),0)
   FROM public.canonical_forecast_schedule_booking_events WHERE organization_id=org),
  'scheduleEventCount',(SELECT count(*) FROM public.canonical_forecast_schedule_booking_events
   WHERE organization_id=org),
  'opportunityActivationHighWater',(SELECT COALESCE(max(source_order),0)
   FROM public.canonical_forecast_opportunity_eligibility_activations WHERE organization_id=org),
  'opportunityActivationCount',(SELECT count(*)
   FROM public.canonical_forecast_opportunity_eligibility_activations WHERE organization_id=org),
  'scheduleLineageGapCount',(SELECT count(*)
   FROM public.canonical_forecast_schedule_booking_lineage_gaps WHERE organization_id=org));
 RETURN generation||jsonb_build_object(
  'generationDigest',public.canonical_completion_digest(generation));
END $$;

CREATE FUNCTION public.canonical_forecast_transition_origin_current_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_transition_future_origins_v2%ROWTYPE;
 profile JSONB;item JSONB;current_cohort JSONB;
 current_input_cohorts JSONB:='[]'::jsonb;current_input_generation JSONB;
 first_profile_proof JSONB;second_profile_proof JSONB;
 method_row public.canonical_forecast_transition_methods_v2%ROWTYPE;
 review_row public.canonical_forecast_transition_method_reviews_v2%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Transition origin access restricted' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:lead-state:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended('m26:estimate-request-state:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended(
      'm26:transition-method-review-v2:'||org::text,0)) THEN
  RAISE EXCEPTION 'Transition source busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO saved FROM public.canonical_forecast_transition_future_origins_v2
  WHERE organization_id=org AND id=origin_value;
 IF saved.id IS NULL THEN RETURN NULL;END IF;
 profile:=public.canonical_forecast_transition_profile_v2(org);
 IF profile IS NULL OR profile->>'id'<>saved.business_profile_id::text OR
    (profile->>'version')::integer<>saved.business_profile_version OR
    profile->>'hash'<>rtrim(saved.business_profile_hash) OR
    profile->>'timeZone'<>saved.time_zone OR
    profile->>'anchorId'<>saved.profile_anchor_id::text OR
    (profile->>'profileSourceOrder')::bigint<>saved.profile_source_order THEN
   RETURN jsonb_build_object('state','transition_origin_stale','id',saved.id,
    'reason','profile_or_context_changed','refreshRequired',TRUE);END IF;
 first_profile_proof:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,saved.profile_anchor_id,
  (saved.evidence->>'firstWindowStartsAt')::timestamptz,
  (saved.evidence->>'firstWindowEndsAt')::timestamptz);
 second_profile_proof:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,saved.profile_anchor_id,
  (saved.evidence->>'secondWindowStartsAt')::timestamptz,
  (saved.evidence->>'secondWindowEndsAt')::timestamptz);
 IF first_profile_proof->>'state'<>'profile_effective_window_verified' OR
    second_profile_proof->>'state'<>'profile_effective_window_verified' THEN
  RETURN jsonb_build_object('state','transition_origin_stale','id',saved.id,
   'reason','profile_historical_applicability_changed','refreshRequired',TRUE);END IF;
 SELECT * INTO method_row FROM public.canonical_forecast_transition_methods_v2
  ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO review_row FROM public.canonical_forecast_transition_method_reviews_v2
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF method_row.id IS NULL OR rtrim(method_row.method_digest)<>rtrim(saved.method_digest) OR
    review_row.id IS NULL OR review_row.action<>'approve' OR
    review_row.id<>saved.method_review_id OR
    review_row.revision<>saved.method_review_revision OR
    rtrim(review_row.review_digest)<>rtrim(saved.method_review_digest) OR
    review_row.method_id<>saved.method_id OR
    rtrim(review_row.method_digest)<>rtrim(saved.method_digest) THEN
  RETURN jsonb_build_object('state','transition_origin_stale','id',saved.id,
   'reason','method_or_review_changed','refreshRequired',TRUE);END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(saved.evidence->'cohorts') value LOOP
  current_cohort:=public.canonical_forecast_transition_cohort_read_v2(
   org,actor,role_value,session_value,item->>'targetKey',(item->>'cohortId')::uuid);
  IF current_cohort IS NULL OR current_cohort->>'state'<>'descriptive_only' OR
     current_cohort->>'cohortDigest'<>item->>'cohortDigest' OR
     current_cohort->>'sourceDigest'<>item->>'sourceDigest' THEN
   RETURN jsonb_build_object('state','transition_origin_stale','id',saved.id,
    'reason','source_changed','refreshRequired',TRUE);END IF;
  current_input_cohorts:=current_input_cohorts||jsonb_build_array(jsonb_build_object(
   'targetKey',item->>'targetKey','cohortId',item->>'cohortId',
   'cohortDigest',current_cohort->>'cohortDigest',
   'sourceDigest',current_cohort->>'sourceDigest'));
 END LOOP;
 current_input_generation:=jsonb_build_object(
  'version','m26-transition-prediction-input-generation-v2',
  'cohorts',current_input_cohorts);
 current_input_generation:=current_input_generation||jsonb_build_object(
  'generationDigest',public.canonical_completion_digest(current_input_generation));
 IF current_input_generation->>'generationDigest' IS DISTINCT FROM
    saved.evidence#>>'{predictionInputGeneration,generationDigest}' THEN
  RETURN jsonb_build_object('state','transition_origin_stale','id',saved.id,
   'reason','prediction_input_generation_changed','refreshRequired',TRUE);END IF;
 RETURN jsonb_build_object('state','transition_origin_current','id',saved.id,
  'asOf',public.canonical_forecast_utc_instant(saved.as_of),
  'predictionCutoffAt',public.canonical_forecast_utc_instant(saved.prediction_cutoff_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
   'timeZone',saved.time_zone,'profileId',saved.business_profile_id,
   'methodVersion',method_row.version,'calculationVersion',method_row.calculation_version,
   'reviewVersion',method_row.review_version,'methodReviewRevision',review_row.revision,
  'targets',method_row.target_keys,'sourceCoverageComplete',TRUE,
  'sourceCoverageScope','post_installation_northstar_selected_sources_only',
  'uncertaintyState','unavailable_insufficient_natural_calibration',
  'researchOnly',TRUE,'probabilityWithheld',TRUE,'outputDigestWithheld',TRUE,
  'providerCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'naturalProductionHistoryVerified',FALSE,
  'empiricalCalibrationVerified',FALSE,'empiricalDriftVerified',FALSE,
  'realForecastEligible',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_transition_origin_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;profile JSONB;method_row public.canonical_forecast_transition_methods_v2%ROWTYPE;
 review_row public.canonical_forecast_transition_method_reviews_v2%ROWTYPE;
 prior public.canonical_forecast_transition_future_origins_v2%ROWTYPE;
 epoch_created BOOLEAN;epoch_count INTEGER;legacy_count INTEGER;invalid_epoch_count INTEGER;zone TEXT;
 current_month DATE;window1_start TIMESTAMPTZ;window1_end TIMESTAMPTZ;
 window2_start TIMESTAMPTZ;window2_end TIMESTAMPTZ;future_start TIMESTAMPTZ;future_end TIMESTAMPTZ;
 targets TEXT[]:=ARRAY['demand.qualification_transition.v1',
  'demand.estimate_request_transition.v1','demand.booking_transition.v1',
  'demand.booking_cancellation.v1'];target_value TEXT;window_value INTEGER;
 cutoff_value TIMESTAMPTZ;end_value TIMESTAMPTZ;item JSONB;cohorts JSONB:='[]'::jsonb;
 evidence_value JSONB;output_value JSONB;outputs JSONB:='[]'::jsonb;
 epochs JSONB;source_generation JSONB;prediction_input_cohorts JSONB;
 prediction_input_generation JSONB;captured_at TIMESTAMPTZ;
 first_profile_proof JSONB;second_profile_proof JSONB;
 eligible_total BIGINT;outcome_total BIGINT;amount_value TEXT;
 key_hash TEXT;request_hash TEXT;evidence_hash TEXT;output_hash TEXT;canonical_hash TEXT;
 new_id UUID:=gen_random_uuid();current_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') OR key_value IS NULL OR
    key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Transition origin request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:transition-future-v2:'||org::text,0));
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:lead-state:'||org::text,0)) OR
    NOT pg_try_advisory_xact_lock(hashtextextended('m26:estimate-request-state:'||org::text,0)) OR
    NOT pg_try_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org::text,0)) OR
     NOT pg_try_advisory_xact_lock(hashtextextended(
      'm26:transition-method-review-v2:'||org::text,0)) THEN
  RAISE EXCEPTION 'Transition source busy' USING ERRCODE='55P03';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-transition-four-target-origin-v2','serverSelected',TRUE));
 SELECT * INTO prior FROM public.canonical_forecast_transition_future_origins_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Transition origin request key conflict' USING ERRCODE='23505';END IF;
  current_value:=public.canonical_forecast_transition_origin_current_v2(
   org,actor,role_value,session_value,prior.id);
  IF current_value->>'state'<>'transition_origin_current' THEN
   RETURN jsonb_build_object('state','transition_origin_stale','id',prior.id,
    'reason','source_changed_refresh_required','refreshRequired',TRUE,
    'researchOnly',TRUE,'probabilityWithheld',TRUE,'outputDigestWithheld',TRUE,
    'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
  RETURN current_value||jsonb_build_object('state','transition_origin_saved','replayed',TRUE);
 END IF;
 profile:=public.canonical_forecast_transition_profile_v2(org);
 IF profile IS NULL THEN RETURN jsonb_build_object('state','transition_origin_unavailable',
  'reason','current_profile_unavailable','researchOnly',TRUE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 zone:=profile->>'timeZone';
 current_month:=date_trunc('month',
  public.canonical_forecast_transition_clock_v2() AT TIME ZONE zone)::date;
 window1_start:=(current_month-INTERVAL '2 months')::timestamp AT TIME ZONE zone;
 window1_end:=(current_month-INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 window2_start:=(current_month-INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 window2_end:=current_month::timestamp AT TIME ZONE zone;
 future_start:=(current_month+INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 future_end:=(current_month+INTERVAL '2 months')::timestamp AT TIME ZONE zone;
 first_profile_proof:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,(profile->>'anchorId')::uuid,window1_start,window1_end);
 second_profile_proof:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,(profile->>'anchorId')::uuid,window2_start,window2_end);
 IF first_profile_proof->>'state'<>'profile_effective_window_verified' OR
    second_profile_proof->>'state'<>'profile_effective_window_verified' THEN
  RETURN jsonb_build_object('state','transition_origin_unavailable',
   'reason','profile_historical_applicability_unavailable','researchOnly',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 epoch_created:=public.canonical_forecast_transition_epoch_ensure_v2(org);
 IF epoch_created THEN RETURN jsonb_build_object('state','transition_origin_unavailable',
  'reason','coverage_epoch_started','researchOnly',TRUE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 SELECT count(*),count(*) FILTER(WHERE baseline_source_order<>0 OR baseline_secondary_order<>0),
  count(*) FILTER(WHERE installed_at>window1_start)
 INTO epoch_count,legacy_count,invalid_epoch_count
 FROM public.canonical_forecast_transition_coverage_epochs_v2
 WHERE organization_id=org;
 IF epoch_count<>4 OR legacy_count<>0 OR invalid_epoch_count<>0 THEN RETURN jsonb_build_object(
  'state','transition_origin_unavailable','reason','pre_epoch_history_unavailable',
  'researchOnly',TRUE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 SELECT jsonb_agg(jsonb_build_object(
  'targetKey',target_key,'installedAt',public.canonical_forecast_utc_instant(installed_at),
  'baselineSourceOrder',baseline_source_order,
  'baselineSecondaryOrder',baseline_secondary_order,
  'sourceAuthority',source_authority,'epochDigest',rtrim(epoch_digest))
  ORDER BY target_key) INTO epochs
 FROM public.canonical_forecast_transition_coverage_epochs_v2
 WHERE organization_id=org;
 SELECT * INTO method_row FROM public.canonical_forecast_transition_methods_v2
  ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO review_row FROM public.canonical_forecast_transition_method_reviews_v2
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF review_row.id IS NULL OR review_row.action<>'approve' OR
    review_row.method_id<>method_row.id OR
    rtrim(review_row.method_digest)<>rtrim(method_row.method_digest) THEN
  RETURN jsonb_build_object('state','transition_origin_unavailable',
   'reason','approved_method_review_unavailable','researchOnly',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 BEGIN
  FOREACH target_value IN ARRAY targets LOOP
   FOR window_value IN 1..2 LOOP
    cutoff_value:=CASE window_value WHEN 1 THEN window1_start ELSE window2_start END;
    end_value:=CASE window_value WHEN 1 THEN window1_end ELSE window2_end END;
    item:=public.canonical_forecast_transition_cohort_capture_v2(
     org,actor,role_value,session_value,csrf,
     public.canonical_forecast_transition_child_key_v2(key_value,
      'origin:'||array_position(targets,target_value)||':'||window_value),
     target_value,cutoff_value,end_value);
    cohorts:=cohorts||jsonb_build_array(item||jsonb_build_object('windowOrdinal',window_value));
   END LOOP;
  END LOOP;
  FOREACH target_value IN ARRAY targets LOOP
   SELECT sum((value->>'eligibleCount')::bigint),sum((value->>'outcomeCount')::bigint)
    INTO eligible_total,outcome_total FROM jsonb_array_elements(cohorts) value
    WHERE value->>'targetKey'=target_value;
   IF eligible_total<=0 THEN RAISE EXCEPTION 'Transition denominator unavailable' USING ERRCODE='P0002';END IF;
   amount_value:=trim(trailing '.' FROM trim(trailing '0' FROM
    to_char(round(outcome_total::numeric/eligible_total::numeric,6),'FM0.000000')));
   outputs:=outputs||jsonb_build_array(jsonb_build_object(
    'targetKey',target_value,'eligibleCount',eligible_total,'outcomeCount',outcome_total,
    'probability',amount_value,'uncertaintyState','unavailable_insufficient_natural_calibration'));
  END LOOP;
 EXCEPTION WHEN SQLSTATE 'P0002' THEN
  RETURN jsonb_build_object('state','transition_origin_unavailable',
   'reason','complete_comparable_windows_unavailable','researchOnly',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END;
 SELECT jsonb_agg(jsonb_build_object(
  'targetKey',value->>'targetKey','cohortId',value->>'cohortId',
  'cohortDigest',value->>'cohortDigest','sourceDigest',value->>'sourceDigest')
  ORDER BY ordinal) INTO prediction_input_cohorts
 FROM jsonb_array_elements(cohorts) WITH ORDINALITY rows(value,ordinal);
 prediction_input_generation:=jsonb_build_object(
  'version','m26-transition-prediction-input-generation-v2',
  'cohorts',prediction_input_cohorts);
 prediction_input_generation:=prediction_input_generation||jsonb_build_object(
  'generationDigest',public.canonical_completion_digest(prediction_input_generation));
 source_generation:=public.canonical_forecast_transition_generation_v2(org);
 captured_at:=public.canonical_forecast_transition_clock_v2();
 evidence_value:=jsonb_build_object('version','m26-transition-four-target-evidence-v2',
  'organizationId',org,'profileId',profile->>'id','profileVersion',(profile->>'version')::integer,
  'profileHash',profile->>'hash','profileAnchorId',profile->>'anchorId',
  'profileSourceOrder',(profile->>'profileSourceOrder')::bigint,
  'profileActivationObservedAt',profile->>'activationObservedAt','timeZone',zone,
  'firstWindowStartsAt',public.canonical_forecast_utc_instant(window1_start),
  'firstWindowEndsAt',public.canonical_forecast_utc_instant(window1_end),
  'secondWindowStartsAt',public.canonical_forecast_utc_instant(window2_start),
  'secondWindowEndsAt',public.canonical_forecast_utc_instant(window2_end),
  'methodId',method_row.id,'methodDigest',rtrim(method_row.method_digest),
  'methodReviewId',review_row.id,'methodReviewRevision',review_row.revision,
  'methodReviewDigest',rtrim(review_row.review_digest),
  'calculationVersion',method_row.calculation_version,'reviewVersion',method_row.review_version,
  'sourceCoverageScope','post_installation_northstar_selected_sources_only',
   'coverageEpochs',epochs,'predictionInputGeneration',prediction_input_generation,
   'sourceGenerationObservedAtCapture',source_generation,
  'windowCount',2,'cohorts',cohorts,'predictionCutoffAt',
  public.canonical_forecast_utc_instant(future_start),'horizonEndsAt',
  public.canonical_forecast_utc_instant(future_end));
 output_value:=jsonb_build_object('version','m26-transition-four-target-output-v2',
  'targets',outputs,'researchOnly',TRUE,'realForecastEligible',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 evidence_hash:=public.canonical_completion_digest(evidence_value);
 output_hash:=public.canonical_completion_digest(output_value);
 canonical_hash:=public.canonical_completion_digest(jsonb_build_object(
  'id',new_id,'organizationId',org,'evidenceDigest',evidence_hash,
  'outputDigest',output_hash,'actorUserId',actor,'membershipId',authority->>'membershipId'));
 INSERT INTO public.canonical_forecast_transition_future_origins_v2(
  id,organization_id,as_of,prediction_cutoff_at,horizon_ends_at,time_zone,
  profile_anchor_id,profile_source_order,business_profile_id,business_profile_version,
  business_profile_hash,method_id,method_digest,method_review_id,method_review_revision,
  method_review_digest,evidence,evidence_digest,private_output,output_digest,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,captured_at,future_start,future_end,zone,
  (profile->>'anchorId')::uuid,(profile->>'profileSourceOrder')::bigint,
  (profile->>'id')::uuid,(profile->>'version')::integer,profile->>'hash',method_row.id,
  rtrim(method_row.method_digest),review_row.id,review_row.revision,
  rtrim(review_row.review_digest),evidence_value,evidence_hash,output_value,output_hash,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state','transition_origin_saved','id',new_id,
  'asOf',public.canonical_forecast_utc_instant(captured_at),
  'predictionCutoffAt',public.canonical_forecast_utc_instant(future_start),
  'horizonEndsAt',public.canonical_forecast_utc_instant(future_end),'targets',method_row.target_keys,
  'sourceCoverageComplete',TRUE,
  'sourceCoverageScope','post_installation_northstar_selected_sources_only',
  'uncertaintyState','unavailable_insufficient_natural_calibration',
  'replayed',FALSE,'researchOnly',TRUE,'probabilityWithheld',TRUE,
  'outputDigestWithheld',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_transition_origin_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR origin_value IS NULL THEN
  RAISE EXCEPTION 'Transition origin read invalid' USING ERRCODE='22023';END IF;
 RETURN public.canonical_forecast_transition_origin_current_v2(
  org,actor,role_value,session_value,origin_value);
END $$;

CREATE FUNCTION public.canonical_forecast_transition_evaluation_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;saved public.canonical_forecast_transition_future_origins_v2%ROWTYPE;
 prior public.canonical_forecast_transition_evaluations_v2%ROWTYPE;
 replay public.canonical_forecast_transition_evaluations_v2%ROWTYPE;
 current_value JSONB;targets TEXT[];target_value TEXT;item JSONB;cohorts JSONB:='[]'::jsonb;
 replay_item JSONB;replay_cohort JSONB;replay_cohorts JSONB:='[]'::jsonb;
 replay_generation JSONB;
 outcome_generation JSONB;source_generation JSONB;
 metrics JSONB:='[]'::jsonb;output_item JSONB;eligible_value BIGINT;outcome_value BIGINT;
 actual_value NUMERIC;predicted_value NUMERIC;key_hash TEXT;request_hash TEXT;
 evidence_value JSONB;evidence_hash TEXT;metrics_hash TEXT;canonical_hash TEXT;
 new_id UUID:=gen_random_uuid();new_revision INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR origin_value IS NULL OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') OR key_value IS NULL OR
    key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Transition evaluation request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:transition-evaluation-v2:'||org::text,0));
 SELECT * INTO saved FROM public.canonical_forecast_transition_future_origins_v2
  WHERE organization_id=org AND id=origin_value;
 IF saved.id IS NULL THEN RETURN NULL;END IF;
 IF saved.horizon_ends_at>public.canonical_forecast_transition_clock_v2() THEN
  RETURN jsonb_build_object(
  'state','transition_evaluation_unavailable','reason','horizon_not_ended',
  'researchOnly',TRUE,'metricsWithheld',TRUE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 current_value:=public.canonical_forecast_transition_origin_current_v2(
  org,actor,role_value,session_value,origin_value);
 IF current_value->>'state'<>'transition_origin_current' THEN RETURN jsonb_build_object(
  'state','transition_evaluation_unavailable','reason','origin_stale',
  'researchOnly',TRUE,'metricsWithheld',TRUE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-transition-evaluation-v2','originId',origin_value));
 SELECT * INTO replay FROM public.canonical_forecast_transition_evaluations_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Transition evaluation request key conflict' USING ERRCODE='23505';END IF;
  FOR replay_item IN SELECT value
   FROM jsonb_array_elements(replay.outcome_evidence->'cohorts') value LOOP
   replay_cohort:=public.canonical_forecast_transition_cohort_read_v2(
    org,actor,role_value,session_value,replay_item->>'targetKey',
    (replay_item->>'cohortId')::uuid);
   IF replay_cohort IS NULL OR replay_cohort->>'state'<>'descriptive_only' OR
      replay_cohort->>'cohortDigest'<>replay_item->>'cohortDigest' OR
      replay_cohort->>'sourceDigest'<>replay_item->>'sourceDigest' THEN
    RETURN jsonb_build_object('state','transition_evaluation_unavailable',
     'reason','prior_evaluation_stale_new_request_required','researchOnly',TRUE,
     'metricsWithheld',TRUE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
   replay_cohorts:=replay_cohorts||jsonb_build_array(jsonb_build_object(
    'targetKey',replay_item->>'targetKey','cohortId',replay_item->>'cohortId',
    'cohortDigest',replay_cohort->>'cohortDigest',
    'sourceDigest',replay_cohort->>'sourceDigest'));
  END LOOP;
  replay_generation:=jsonb_build_object(
   'version','m26-transition-outcome-generation-v2','cohorts',replay_cohorts);
  replay_generation:=replay_generation||jsonb_build_object(
   'generationDigest',public.canonical_completion_digest(replay_generation));
  IF replay_generation->>'generationDigest' IS DISTINCT FROM
     replay.outcome_evidence#>>'{outcomeGeneration,generationDigest}' THEN
   RETURN jsonb_build_object('state','transition_evaluation_unavailable',
    'reason','prior_evaluation_stale_new_request_required','researchOnly',TRUE,
    'metricsWithheld',TRUE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
  RETURN jsonb_build_object('state','transition_evaluation_saved','id',replay.id,
   'originId',origin_value,'revision',replay.revision,'replayed',TRUE,
   'researchOnly',TRUE,'metricsWithheld',TRUE,'calibrationClaimed',FALSE,
   'driftVerdictIssued',FALSE,'automaticActionTaken',FALSE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 -- Use the exact four target keys pinned by the method; callers cannot supply them.
 targets:=ARRAY['demand.qualification_transition.v1',
  'demand.estimate_request_transition.v1','demand.booking_transition.v1',
  'demand.booking_cancellation.v1'];
 BEGIN
  FOREACH target_value IN ARRAY targets LOOP
   item:=public.canonical_forecast_transition_cohort_capture_v2(
    org,actor,role_value,session_value,csrf,
    public.canonical_forecast_transition_child_key_v2(key_value,
     'evaluation:'||array_position(targets,target_value)),
    target_value,saved.prediction_cutoff_at,saved.horizon_ends_at);
   cohorts:=cohorts||jsonb_build_array(item);
   eligible_value:=(item->>'eligibleCount')::bigint;
   outcome_value:=(item->>'outcomeCount')::bigint;
   actual_value:=round(outcome_value::numeric/eligible_value::numeric,6);
   SELECT (value->>'probability')::numeric INTO predicted_value
    FROM jsonb_array_elements(saved.private_output->'targets') value
    WHERE value->>'targetKey'=target_value;
   metrics:=metrics||jsonb_build_array(jsonb_build_object('targetKey',target_value,
    'predictedProbability',predicted_value,'actualProbability',actual_value,
    'absoluteError',abs(predicted_value-actual_value),'eligibleCount',eligible_value,
    'outcomeCount',outcome_value));
  END LOOP;
 EXCEPTION WHEN SQLSTATE 'P0002' THEN
  RETURN jsonb_build_object('state','transition_evaluation_unavailable',
   'reason','complete_outcome_window_unavailable','researchOnly',TRUE,'metricsWithheld',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END;
 SELECT * INTO prior FROM public.canonical_forecast_transition_evaluations_v2
  WHERE organization_id=org AND origin_id=origin_value ORDER BY revision DESC LIMIT 1;
 new_revision:=COALESCE(prior.revision,0)+1;
 outcome_generation:=jsonb_build_object(
  'version','m26-transition-outcome-generation-v2',
  'cohorts',(SELECT jsonb_agg(jsonb_build_object(
    'targetKey',value->>'targetKey','cohortId',value->>'cohortId',
    'cohortDigest',value->>'cohortDigest','sourceDigest',value->>'sourceDigest')
    ORDER BY ordinal)
   FROM jsonb_array_elements(cohorts) WITH ORDINALITY rows(value,ordinal)));
 outcome_generation:=outcome_generation||jsonb_build_object(
  'generationDigest',public.canonical_completion_digest(outcome_generation));
 source_generation:=public.canonical_forecast_transition_generation_v2(org);
 evidence_value:=jsonb_build_object('version','m26-transition-evaluation-evidence-v2',
  'originId',origin_value,'predictionCutoffAt',
  public.canonical_forecast_utc_instant(saved.prediction_cutoff_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'cohorts',cohorts,'outcomeGeneration',outcome_generation,
  'sourceGenerationObservedAtEvaluation',source_generation);
 evidence_hash:=public.canonical_completion_digest(evidence_value);
 metrics_hash:=public.canonical_completion_digest(metrics);
 canonical_hash:=public.canonical_completion_digest(jsonb_build_object(
  'id',new_id,'originId',origin_value,'revision',new_revision,
  'previousId',prior.id,'evidenceDigest',evidence_hash,'metricsDigest',metrics_hash,
  'actorUserId',actor,'membershipId',authority->>'membershipId'));
 INSERT INTO public.canonical_forecast_transition_evaluations_v2(
  id,organization_id,origin_id,revision,previous_id,outcome_evidence,
  outcome_evidence_digest,private_metrics,metrics_digest,actor_user_id,membership_id,
  auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,origin_value,new_revision,prior.id,evidence_value,evidence_hash,
  jsonb_build_object('version','m26-transition-private-evaluation-v2','targets',metrics),
  metrics_hash,actor,(authority->>'membershipId')::uuid,session_value,key_hash,
  request_hash,canonical_hash);
 RETURN jsonb_build_object('state','transition_evaluation_saved','id',new_id,
  'originId',origin_value,'revision',new_revision,'replayed',FALSE,
  'researchOnly',TRUE,'metricsWithheld',TRUE,'calibrationClaimed',FALSE,
  'driftVerdictIssued',FALSE,'automaticActionTaken',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_transition_evaluation_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_transition_evaluations_v2%ROWTYPE;
 origin_state JSONB;item JSONB;current_cohort JSONB;
 current_outcome_cohorts JSONB:='[]'::jsonb;current_outcome_generation JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR evaluation_value IS NULL THEN
  RAISE EXCEPTION 'Transition evaluation read invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Transition evaluation access restricted' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM public.canonical_forecast_transition_evaluations_v2
  WHERE organization_id=org AND id=evaluation_value;
 IF saved.id IS NULL THEN RETURN NULL;END IF;
 origin_state:=public.canonical_forecast_transition_origin_current_v2(
  org,actor,role_value,session_value,saved.origin_id);
 IF origin_state->>'state'<>'transition_origin_current' THEN RETURN jsonb_build_object(
  'state','transition_evaluation_stale','id',saved.id,'originId',saved.origin_id,
  'reason','origin_stale','refreshRequired',TRUE,'researchOnly',TRUE,'metricsWithheld',TRUE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(saved.outcome_evidence->'cohorts') value LOOP
  current_cohort:=public.canonical_forecast_transition_cohort_read_v2(
   org,actor,role_value,session_value,item->>'targetKey',(item->>'cohortId')::uuid);
  IF current_cohort IS NULL OR current_cohort->>'state'<>'descriptive_only' OR
     current_cohort->>'cohortDigest'<>item->>'cohortDigest' OR
     current_cohort->>'sourceDigest'<>item->>'sourceDigest' THEN
   RETURN jsonb_build_object('state','transition_evaluation_stale','id',saved.id,
    'originId',saved.origin_id,'reason','outcome_source_changed','refreshRequired',TRUE,
    'researchOnly',TRUE,'metricsWithheld',TRUE,
    'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
  current_outcome_cohorts:=current_outcome_cohorts||jsonb_build_array(jsonb_build_object(
   'targetKey',item->>'targetKey','cohortId',item->>'cohortId',
   'cohortDigest',current_cohort->>'cohortDigest',
   'sourceDigest',current_cohort->>'sourceDigest'));
 END LOOP;
 current_outcome_generation:=jsonb_build_object(
  'version','m26-transition-outcome-generation-v2',
  'cohorts',current_outcome_cohorts);
 current_outcome_generation:=current_outcome_generation||jsonb_build_object(
  'generationDigest',public.canonical_completion_digest(current_outcome_generation));
 IF current_outcome_generation->>'generationDigest' IS DISTINCT FROM
    saved.outcome_evidence#>>'{outcomeGeneration,generationDigest}' THEN
  RETURN jsonb_build_object('state','transition_evaluation_stale','id',saved.id,
   'originId',saved.origin_id,'reason','outcome_generation_changed',
   'refreshRequired',TRUE,'researchOnly',TRUE,'metricsWithheld',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 RETURN jsonb_build_object('state','transition_evaluation_current','id',saved.id,
  'originId',saved.origin_id,'revision',saved.revision,
  'evaluatedAt',public.canonical_forecast_utc_instant(saved.evaluated_at),
  'researchOnly',TRUE,'metricsWithheld',TRUE,'calibrationClaimed',FALSE,
  'driftVerdictIssued',FALSE,'automaticActionTaken',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_transition_coverage_epochs_v2,
 public.canonical_forecast_transition_methods_v2,
 public.canonical_forecast_transition_method_reviews_v2,
 public.canonical_forecast_transition_future_origins_v2,
 public.canonical_forecast_transition_evaluations_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_v2_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_clock_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_profile_v2(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_child_key_v2(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_method_review_v2_mutate(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_method_review_v2_read(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_epoch_ensure_v2(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_cohort_capture_v2(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_cohort_read_v2(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_generation_v2(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_origin_current_v2(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_origin_v2_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_origin_v2_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_evaluation_v2_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_transition_evaluation_v2_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_transition_coverage_epochs_v2,
  public.canonical_forecast_transition_methods_v2,
  public.canonical_forecast_transition_method_reviews_v2,
  public.canonical_forecast_transition_future_origins_v2,
   public.canonical_forecast_transition_evaluations_v2 FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_clock_v2()
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_profile_v2(UUID)
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_child_key_v2(TEXT,TEXT)
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_epoch_ensure_v2(UUID)
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_cohort_capture_v2(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_cohort_read_v2(
  UUID,UUID,TEXT,UUID,TEXT,UUID) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_generation_v2(UUID)
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_transition_origin_current_v2(
  UUID,UUID,TEXT,UUID,UUID) FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_transition_method_review_v2_mutate(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,BOOLEAN,TEXT)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_transition_method_review_v2_read(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_transition_origin_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_transition_origin_v2_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_transition_evaluation_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_transition_evaluation_v2_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
