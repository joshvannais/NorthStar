-- Mission 26 Part 3D: a policy-gated human choice within the selected-M24
-- internal experiment. It never enables production promotion, paid numeric
-- serving, or real forecast eligibility.
CREATE TABLE public.canonical_forecast_price_flow_supported_selections (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 context_digest TEXT NOT NULL CHECK(context_digest~'^[a-f0-9]{64}$'),
 revision INTEGER NOT NULL CHECK(revision>0),
 action TEXT NOT NULL CHECK(action IN ('promote','rollback')),
 algorithm_version TEXT NOT NULL REFERENCES public.canonical_forecast_price_flow_algorithms(algorithm_version),
 implementation_digest TEXT NOT NULL CHECK(implementation_digest~'^[a-f0-9]{64}$'),
 method_registration_version TEXT NOT NULL
  CHECK(method_registration_version='m26_selected_m24_deterministic_closure_v1'),
 method_closure_digest TEXT NOT NULL CHECK(method_closure_digest~'^[a-f0-9]{64}$'),
 policy_version TEXT NOT NULL CHECK(policy_version IN (
  'm26_selected_m24_two_window_internal_experiment_v1',
  'm26_selected_m24_internal_restore_compatibility_v1')),
 policy_digest TEXT NOT NULL CHECK(policy_digest~'^[a-f0-9]{64}$'),
 comparison_digest TEXT NOT NULL CHECK(comparison_digest~'^[a-f0-9]{64}$'),
 reviewed_anchor_run_id UUID NOT NULL,
 previous_event_id UUID,
 reversed_event_id UUID,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 16 AND 1000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 selected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 internal_experiment_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(internal_experiment_only),
 production_promotion_eligible BOOLEAN NOT NULL DEFAULT FALSE
  CHECK(NOT production_promotion_eligible),
 paid_numeric_serving BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT paid_numeric_serving),
 real_forecast_eligible BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT real_forecast_eligible),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,context_digest,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,reviewed_anchor_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_event_id)
  REFERENCES public.canonical_forecast_price_flow_supported_selections(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,reversed_event_id)
  REFERENCES public.canonical_forecast_price_flow_supported_selections(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_price_flow_supported_latest
 ON public.canonical_forecast_price_flow_supported_selections
 (organization_id,context_digest,revision DESC);
CREATE TRIGGER canonical_forecast_price_flow_supported_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_flow_supported_selections
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_price_flow_supported_context(
 run_value JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_completion_digest(jsonb_build_object(
  'target',run_value->'target','unit',run_value->'unit',
  'applicability',run_value->'applicability',
  'sourceScope','northstar_m24_approved_price_decisions',
  'horizonGrain','day','outputKind','point','intervalPolicy','unavailable'))
$$;

-- A rollback reviews current matched source/outcome compatibility, but never
-- requires the rejected candidate to still dominate the prior version.
CREATE FUNCTION public.canonical_forecast_price_flow_supported_decision_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 anchor_run_value UUID,action_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE compared JSONB; version_value TEXT;
BEGIN
 IF action_value='promote' THEN
  RETURN public.canonical_forecast_price_flow_supported_experiment_review(
   org,actor,role_value,session_value,anchor_run_value);
 ELSIF action_value<>'rollback' OR action_value IS NULL THEN
  RAISE EXCEPTION 'Supported decision action invalid' USING ERRCODE='22023';
 END IF;
 compared:=public.canonical_forecast_price_flow_promotion_review(
  org,actor,role_value,session_value,anchor_run_value);
 IF compared->>'state' IS DISTINCT FROM 'promotion_review_ready' THEN
  RETURN jsonb_build_object('state','internal_experiment_restore_unavailable',
   'reason','matched_source_or_outcome_unavailable',
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'paidNumericServing',FALSE,'realForecastEligible',FALSE);
 END IF;
 version_value:='m26_selected_m24_internal_restore_compatibility_v1';
 RETURN jsonb_build_object('state','internal_experiment_restore_ready',
  'policyVersion',version_value,'anchorRunId',anchor_run_value,
  'comparisonDigest',compared->>'comparisonDigest',
  'policyDigest',public.canonical_completion_digest(jsonb_build_object(
   'policyVersion',version_value,
   'comparisonDigest',compared->>'comparisonDigest',
   'internalReviewDigest',compared->>'reviewDigest')),
  'referenceDirection',compared->>'referenceDirection',
  'laterDirection',compared->>'laterDirection',
  'candidateWorseDays',compared->'candidateWorseDays',
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'paidNumericServing',FALSE,'realForecastEligible',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_supported_challenge(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 anchor_run_value UUID,expected_revision INTEGER,action_value TEXT,
 algorithm_value TEXT,reverses_value UUID,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 latest public.canonical_forecast_price_flow_supported_selections%ROWTYPE;
 reviewed JSONB; context_value TEXT; secret BYTEA; challenge TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') OR anchor_run_value IS NULL OR
    expected_revision IS NULL OR expected_revision<0 OR
    action_value NOT IN ('promote','rollback') OR
    algorithm_value NOT IN ('m26_price_flow_zero_baseline_v1',
      'm26_price_flow_carry_forward_v1') OR
    reason_value IS NULL OR length(reason_value) NOT BETWEEN 16 AND 1000 THEN
  RAISE EXCEPTION 'Supported selection challenge invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO anchor FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=anchor_run_value AND
   output->>'calculationVersion'='m26_price_flow_carry_forward_v1';
 IF anchor.id IS NULL THEN
  RETURN jsonb_build_object('state','supported_challenge_unavailable',
   'reason','review_anchor_unavailable','paidNumericServing',FALSE);
 END IF;
 context_value:=public.canonical_forecast_price_flow_supported_context(anchor.output);
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_supported_selections
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF COALESCE(latest.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Supported selection revision changed' USING ERRCODE='23505';
 END IF;
 IF (action_value='promote' AND
     (algorithm_value<>'m26_price_flow_zero_baseline_v1' OR
      reverses_value IS NOT NULL OR
      (latest.id IS NOT NULL AND latest.action<>'rollback'))) OR
    (action_value='rollback' AND
     (algorithm_value<>'m26_price_flow_carry_forward_v1' OR
      latest.id IS NULL OR latest.action<>'promote' OR
      reverses_value IS DISTINCT FROM latest.id)) THEN
  RAISE EXCEPTION 'Supported selection transition invalid' USING ERRCODE='22023';
 END IF;
 reviewed:=public.canonical_forecast_price_flow_supported_decision_review(
  org,actor,role_value,session_value,anchor_run_value,action_value);
 IF (action_value='promote' AND
     reviewed->>'state' IS DISTINCT FROM 'internal_experiment_support_ready') OR
    (action_value='rollback' AND
     reviewed->>'state' IS DISTINCT FROM 'internal_experiment_restore_ready') THEN
  RETURN jsonb_build_object('state','supported_challenge_unavailable',
   'reason','internal_experiment_evidence_unavailable',
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'paidNumericServing',FALSE);
 END IF;
 SELECT key_bytes INTO secret
  FROM public.canonical_forecast_price_flow_research_key WHERE singleton=TRUE;
 IF secret IS NULL THEN
  RAISE EXCEPTION 'Supported selection key unavailable' USING ERRCODE='23514';
 END IF;
 challenge:=public.canonical_forecast_price_flow_research_mac(
  jsonb_build_object('version','m26-selected-m24-supported-challenge-v1',
   'organizationId',org,'actorUserId',actor,'sessionId',session_value,
   'anchorRunId',anchor_run_value,'expectedRevision',expected_revision,
   'action',action_value,'algorithmVersion',algorithm_value,
   'reversesEventId',reverses_value,'reason',reason_value,
   'policyDigest',reviewed->>'policyDigest')::text,secret);
 RETURN jsonb_build_object('state','supported_challenge_ready',
  'reviewToken',challenge,'currentRevision',expected_revision,
  'policyVersion',reviewed->>'policyVersion',
  'referenceDirection',reviewed->>'referenceDirection',
  'laterDirection',reviewed->>'laterDirection',
  'candidateWorseDays',reviewed->'candidateWorseDays',
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'paidNumericServing',FALSE,'realForecastEligible',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_supported_select(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,anchor_run_value UUID,expected_revision INTEGER,
 action_value TEXT,algorithm_value TEXT,reverses_value UUID,
 reason_value TEXT,review_token_value TEXT,confirmed_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 latest public.canonical_forecast_price_flow_supported_selections%ROWTYPE;
 prior public.canonical_forecast_price_flow_supported_selections%ROWTYPE;
 saved public.canonical_forecast_price_flow_supported_selections%ROWTYPE;
 registry public.canonical_forecast_price_flow_algorithms%ROWTYPE;
 reviewed JSONB; challenged JSONB; context_value TEXT;
 key_hash TEXT; request_hash TEXT; installed TEXT; function_identity REGPROCEDURE;
 registered_closure TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    expected_revision IS NULL OR expected_revision<0 OR
    action_value NOT IN ('promote','rollback') OR
    algorithm_value NOT IN ('m26_price_flow_zero_baseline_v1',
      'm26_price_flow_carry_forward_v1') OR
    anchor_run_value IS NULL OR
    reason_value IS NULL OR length(reason_value) NOT BETWEEN 16 AND 1000 OR
    review_token_value IS NULL OR review_token_value!~'^[a-f0-9]{64}$' OR
    confirmed_value IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Supported selection request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'anchorRunId',anchor_run_value,'expectedRevision',expected_revision,
  'action',action_value,'algorithmVersion',algorithm_value,
  'reversesEventId',reverses_value,'reason',reason_value,
  'reviewToken',review_token_value));
 PERFORM set_config('lock_timeout','28000ms',TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':'||actor::text||':supported-selection:'||key_hash,0));
 PERFORM set_config('lock_timeout','2000ms',TRUE);
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_supported_selections
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Supported selection replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','supported_selection_recorded',
   'eventId',prior.id,'revision',prior.revision,
   'algorithmVersion',prior.algorithm_version,'replayed',TRUE,
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'paidNumericServing',FALSE,'realForecastEligible',FALSE);
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO anchor FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=anchor_run_value AND
   output->>'calculationVersion'='m26_price_flow_carry_forward_v1';
 IF anchor.id IS NULL THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','review_anchor_unavailable','paidNumericServing',FALSE);
 END IF;
 context_value:=public.canonical_forecast_price_flow_supported_context(anchor.output);
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_supported_selections
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF COALESCE(latest.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Supported selection revision changed' USING ERRCODE='23505';
 END IF;
 IF (action_value='promote' AND
     (algorithm_value<>'m26_price_flow_zero_baseline_v1' OR
      reverses_value IS NOT NULL OR
      (latest.id IS NOT NULL AND latest.action<>'rollback'))) OR
    (action_value='rollback' AND
     (algorithm_value<>'m26_price_flow_carry_forward_v1' OR
      latest.id IS NULL OR latest.action<>'promote' OR
      reverses_value IS DISTINCT FROM latest.id)) THEN
  RAISE EXCEPTION 'Supported selection transition invalid' USING ERRCODE='22023';
 END IF;
 reviewed:=public.canonical_forecast_price_flow_supported_decision_review(
  org,actor,role_value,session_value,anchor_run_value,action_value);
 challenged:=public.canonical_forecast_price_flow_supported_challenge(
  org,actor,role_value,session_value,csrf,anchor_run_value,
  expected_revision,action_value,algorithm_value,reverses_value,reason_value);
 IF (action_value='promote' AND
     reviewed->>'state' IS DISTINCT FROM 'internal_experiment_support_ready') OR
    (action_value='rollback' AND
     reviewed->>'state' IS DISTINCT FROM 'internal_experiment_restore_ready') OR
    challenged->>'state' IS DISTINCT FROM 'supported_challenge_ready' OR
    challenged->>'reviewToken' IS DISTINCT FROM review_token_value THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','review_evidence_changed','paidNumericServing',FALSE);
 END IF;
 SELECT * INTO registry FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version=algorithm_value;
 IF algorithm_value='m26_price_flow_zero_baseline_v1' THEN
  function_identity:=
   'public.canonical_forecast_capture_price_flow_zero_baseline(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure;
 ELSE
  function_identity:=
   'public.canonical_forecast_capture_price_flow_origin(uuid,uuid,text,uuid,text,text,uuid,text,timestamptz,timestamptz)'::regprocedure;
 END IF;
 installed:=encode(sha256(convert_to(pg_get_functiondef(function_identity),
  'UTF8')),'hex');
 IF registry.algorithm_version IS NULL OR
    registry.implementation_digest IS DISTINCT FROM installed OR
    registry.target_key IS DISTINCT FROM anchor.output->'target'->>'key' OR
    registry.target_version IS DISTINCT FROM
      anchor.output->'target'->>'definitionVersion' THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','algorithm_identity_unavailable','paidNumericServing',FALSE);
 END IF;
 IF NOT public.canonical_forecast_price_flow_method_closure_current() THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','reviewed_implementation_changed','paidNumericServing',FALSE);
 END IF;
 SELECT dependency_closure_digest INTO registered_closure
 FROM public.canonical_forecast_price_flow_method_registration
 WHERE version='m26_selected_m24_deterministic_closure_v1';
 IF registered_closure IS NULL THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','method_registration_unavailable','paidNumericServing',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_price_flow_supported_selections(
  organization_id,context_digest,revision,action,algorithm_version,
  implementation_digest,method_registration_version,method_closure_digest,
  policy_version,policy_digest,comparison_digest,
  reviewed_anchor_run_id,previous_event_id,reversed_event_id,
  actor_user_id,auth_session_id,reason,request_key_hash,request_digest)
 VALUES(org,context_value,expected_revision+1,action_value,algorithm_value,
  installed,'m26_selected_m24_deterministic_closure_v1',registered_closure,
  reviewed->>'policyVersion',reviewed->>'policyDigest',
  reviewed->>'comparisonDigest',anchor_run_value,latest.id,reverses_value,
  actor,session_value,reason_value,key_hash,request_hash)
 RETURNING * INTO saved;
 RETURN jsonb_build_object('state','supported_selection_recorded',
  'eventId',saved.id,'revision',saved.revision,
  'algorithmVersion',saved.algorithm_version,'replayed',FALSE,
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'paidNumericServing',FALSE,'realForecastEligible',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_supported_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,context_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context_run public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 latest public.canonical_forecast_price_flow_supported_selections%ROWTYPE;
 registry public.canonical_forecast_price_flow_algorithms%ROWTYPE;
 reviewed JSONB; context_value TEXT; installed TEXT; function_identity REGPROCEDURE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    context_run_value IS NULL THEN
  RAISE EXCEPTION 'Supported selection read invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO context_run FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=context_run_value AND
   output->>'calculationVersion'='m26_price_flow_carry_forward_v1';
 IF context_run.id IS NULL THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','context_run_unavailable','paidNumericServing',FALSE);
 END IF;
 context_value:=public.canonical_forecast_price_flow_supported_context(context_run.output);
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_supported_selections
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF latest.id IS NULL THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','no_human_supported_choice','paidNumericServing',FALSE);
 END IF;
 reviewed:=public.canonical_forecast_price_flow_supported_decision_review(
  org,actor,role_value,session_value,latest.reviewed_anchor_run_id,
  latest.action);
 SELECT * INTO registry FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version=latest.algorithm_version;
 IF latest.algorithm_version='m26_price_flow_zero_baseline_v1' THEN
  function_identity:=
   'public.canonical_forecast_capture_price_flow_zero_baseline(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure;
 ELSIF latest.algorithm_version='m26_price_flow_carry_forward_v1' THEN
  function_identity:=
   'public.canonical_forecast_capture_price_flow_origin(uuid,uuid,text,uuid,text,text,uuid,text,timestamptz,timestamptz)'::regprocedure;
 ELSE
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','algorithm_unregistered','paidNumericServing',FALSE);
 END IF;
 installed:=encode(sha256(convert_to(pg_get_functiondef(function_identity),
  'UTF8')),'hex');
 IF (latest.action='promote' AND
     reviewed->>'state' IS DISTINCT FROM 'internal_experiment_support_ready') OR
    (latest.action='rollback' AND
     reviewed->>'state' IS DISTINCT FROM 'internal_experiment_restore_ready') OR
    reviewed->>'policyDigest' IS DISTINCT FROM latest.policy_digest OR
    reviewed->>'comparisonDigest' IS DISTINCT FROM latest.comparison_digest OR
    registry.implementation_digest IS DISTINCT FROM latest.implementation_digest OR
    installed IS DISTINCT FROM latest.implementation_digest OR
    latest.context_digest IS DISTINCT FROM context_value OR
    latest.policy_version IS DISTINCT FROM reviewed->>'policyVersion' OR
    latest.method_registration_version IS DISTINCT FROM
      'm26_selected_m24_deterministic_closure_v1' OR
    NOT public.canonical_forecast_price_flow_method_closure_current() OR
    latest.method_closure_digest IS DISTINCT FROM
      (SELECT dependency_closure_digest FROM
       public.canonical_forecast_price_flow_method_registration
       WHERE version='m26_selected_m24_deterministic_closure_v1') THEN
  RETURN jsonb_build_object('state','supported_selection_unavailable',
   'reason','selection_evidence_changed','revision',latest.revision,
   'paidNumericServing',FALSE);
 END IF;
 RETURN jsonb_build_object('state','supported_selection_current',
  'eventId',latest.id,'revision',latest.revision,
  'algorithmVersion',latest.algorithm_version,
  'policyVersion',latest.policy_version,
  'internalExperimentCandidateSelected',latest.action='promote',
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'rollbackCurrent',latest.action='rollback',
  'paidNumericServing',FALSE,'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_supported_selections FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_supported_context(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_supported_decision_review(
 UUID,UUID,TEXT,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_supported_challenge(
 UUID,UUID,TEXT,UUID,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_supported_select(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_supported_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_supported_selections
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_supported_context(JSONB)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_supported_decision_review(
  UUID,UUID,TEXT,UUID,UUID,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_supported_challenge(
  UUID,UUID,TEXT,UUID,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_supported_select(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,BOOLEAN)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_supported_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
