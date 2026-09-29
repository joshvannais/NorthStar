-- Mission 26 Part 3D: append-only human active choice for future selected-M24
-- internal execution. It cannot enable paid numeric serving or a real forecast.
CREATE TABLE public.canonical_forecast_price_flow_active_algorithms (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 context_digest TEXT NOT NULL CHECK(context_digest~'^[a-f0-9]{64}$'),
 revision INTEGER NOT NULL CHECK(revision>0),
 action TEXT NOT NULL CHECK(action IN ('promote','rollback')),
 algorithm_version TEXT NOT NULL REFERENCES public.canonical_forecast_price_flow_algorithms(algorithm_version),
 implementation_digest TEXT NOT NULL CHECK(implementation_digest~'^[a-f0-9]{64}$'),
 policy_version TEXT NOT NULL CHECK(policy_version='m26_selected_m24_promotion_policy_v1'),
 comparison_digest TEXT NOT NULL CHECK(comparison_digest~'^[a-f0-9]{64}$'),
 review_digest TEXT NOT NULL CHECK(review_digest~'^[a-f0-9]{64}$'),
 reviewed_anchor_run_id UUID NOT NULL,
 previous_event_id UUID REFERENCES public.canonical_forecast_price_flow_active_algorithms(id),
 reversed_event_id UUID REFERENCES public.canonical_forecast_price_flow_active_algorithms(id),
 actor_user_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 16 AND 1000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 selected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 future_internal_execution BOOLEAN NOT NULL DEFAULT TRUE CHECK(future_internal_execution),
 paid_numeric_serving BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT paid_numeric_serving),
 UNIQUE(organization_id,context_digest,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,reviewed_anchor_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT,
 FOREIGN KEY(auth_session_id) REFERENCES public.auth_sessions(id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_price_flow_active_latest
 ON public.canonical_forecast_price_flow_active_algorithms
 (organization_id,context_digest,revision DESC);
CREATE TRIGGER canonical_forecast_price_flow_active_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_active_algorithms
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_price_flow_active_challenge(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 anchor_run_value UUID,expected_revision INTEGER,action_value TEXT,
 algorithm_value TEXT,reverses_value UUID,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 latest public.canonical_forecast_price_flow_active_algorithms%ROWTYPE;
 reviewed JSONB; context_value TEXT; secret BYTEA; challenge TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') OR anchor_run_value IS NULL OR
    expected_revision IS NULL OR expected_revision<0 OR
    action_value NOT IN ('promote','rollback') OR
    algorithm_value NOT IN ('m26_price_flow_zero_baseline_v1',
      'm26_price_flow_carry_forward_v1') OR
    reason_value IS NULL OR length(reason_value) NOT BETWEEN 16 AND 1000 THEN
  RAISE EXCEPTION 'Active algorithm challenge invalid' USING ERRCODE='22023';
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
  RETURN jsonb_build_object('state','active_challenge_unavailable',
   'reason','review_anchor_unavailable','paidNumericServing',FALSE);
 END IF;
 context_value:=public.canonical_completion_digest(jsonb_build_object(
  'target',anchor.output->'target','unit',anchor.output->'unit',
  'applicability',anchor.output->'applicability',
  'sourceScope','northstar_m24_approved_price_decisions',
  'horizonGrain','day','outputKind','point','intervalPolicy','unavailable'));
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_active_algorithms
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF COALESCE(latest.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Active algorithm revision changed' USING ERRCODE='23505';
 END IF;
 IF (action_value='promote' AND
     (reverses_value IS NOT NULL OR
      algorithm_value<>'m26_price_flow_zero_baseline_v1' OR
      (latest.id IS NULL AND expected_revision<>0) OR
      (latest.id IS NOT NULL AND latest.action<>'rollback'))) OR
    (action_value='rollback' AND
     (latest.id IS NULL OR latest.action<>'promote' OR
      reverses_value IS DISTINCT FROM latest.id OR
      algorithm_value<>'m26_price_flow_carry_forward_v1')) THEN
  RAISE EXCEPTION 'Active algorithm transition invalid' USING ERRCODE='22023';
 END IF;
 reviewed:=public.canonical_forecast_price_flow_promotion_review(
  org,actor,role_value,session_value,anchor_run_value);
 IF reviewed->>'state' IS DISTINCT FROM 'promotion_review_ready' THEN
  RETURN jsonb_build_object('state','active_challenge_unavailable',
   'reason','promotion_evidence_unavailable','paidNumericServing',FALSE);
 END IF;
 SELECT key_bytes INTO secret
  FROM public.canonical_forecast_price_flow_research_key WHERE singleton=TRUE;
 IF secret IS NULL THEN
  RAISE EXCEPTION 'Active challenge key unavailable' USING ERRCODE='23514';
 END IF;
 challenge:=public.canonical_forecast_price_flow_research_mac(
  jsonb_build_object('version','m26-selected-m24-active-challenge-v1',
   'organizationId',org,'actorUserId',actor,'sessionId',session_value,
   'anchorRunId',anchor_run_value,'expectedRevision',expected_revision,
   'action',action_value,'algorithmVersion',algorithm_value,
   'reversesEventId',reverses_value,'reason',reason_value,
   'reviewDigest',reviewed->>'reviewDigest')::text,secret);
 RETURN jsonb_build_object('state','active_challenge_ready',
  'reviewToken',challenge,'currentRevision',expected_revision,
  'policyVersion',reviewed->>'policyVersion',
  'referenceDirection',reviewed->>'referenceDirection',
  'laterDirection',reviewed->>'laterDirection',
  'candidateWorseDays',reviewed->'candidateWorseDays',
  'paidNumericServing',FALSE,'realForecastEligible',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_active_select(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,anchor_run_value UUID,expected_revision INTEGER,
 action_value TEXT,algorithm_value TEXT,reverses_value UUID,
 reason_value TEXT,review_token_value TEXT,confirmed_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 latest public.canonical_forecast_price_flow_active_algorithms%ROWTYPE;
 prior public.canonical_forecast_price_flow_active_algorithms%ROWTYPE;
 saved public.canonical_forecast_price_flow_active_algorithms%ROWTYPE;
 registry public.canonical_forecast_price_flow_algorithms%ROWTYPE;
 reviewed JSONB; challenged JSONB; context_value TEXT;
 key_hash TEXT; request_hash TEXT; installed TEXT; function_identity REGPROCEDURE;
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
  RAISE EXCEPTION 'Active algorithm request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'anchorRunId',anchor_run_value,'expectedRevision',expected_revision,
  'action',action_value,'algorithmVersion',algorithm_value,
  'reversesEventId',reverses_value,'reason',reason_value,
  'reviewToken',review_token_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':'||actor::text||':active-algorithm:'||key_hash,0));
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_active_algorithms
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Active algorithm replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','active_algorithm_recorded',
   'eventId',prior.id,'revision',prior.revision,
   'algorithmVersion',prior.algorithm_version,'replayed',TRUE,
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
  RETURN jsonb_build_object('state','active_algorithm_unavailable',
   'reason','review_anchor_unavailable','paidNumericServing',FALSE);
 END IF;
 context_value:=public.canonical_completion_digest(jsonb_build_object(
  'target',anchor.output->'target','unit',anchor.output->'unit',
  'applicability',anchor.output->'applicability',
  'sourceScope','northstar_m24_approved_price_decisions',
  'horizonGrain','day','outputKind','point','intervalPolicy','unavailable'));
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_active_algorithms
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF COALESCE(latest.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Active algorithm revision changed' USING ERRCODE='23505';
 END IF;
 IF (action_value='promote' AND
     (reverses_value IS NOT NULL OR
      algorithm_value<>'m26_price_flow_zero_baseline_v1' OR
      (latest.id IS NULL AND expected_revision<>0) OR
      (latest.id IS NOT NULL AND latest.action<>'rollback'))) OR
    (action_value='rollback' AND
     (latest.id IS NULL OR latest.action<>'promote' OR
      reverses_value IS DISTINCT FROM latest.id OR
      algorithm_value<>'m26_price_flow_carry_forward_v1')) THEN
  RAISE EXCEPTION 'Active algorithm transition invalid' USING ERRCODE='22023';
 END IF;
 reviewed:=public.canonical_forecast_price_flow_promotion_review(
  org,actor,role_value,session_value,anchor_run_value);
 challenged:=public.canonical_forecast_price_flow_active_challenge(
  org,actor,role_value,session_value,csrf,anchor_run_value,
  expected_revision,action_value,algorithm_value,reverses_value,reason_value);
 IF reviewed->>'state' IS DISTINCT FROM 'promotion_review_ready' OR
    challenged->>'state' IS DISTINCT FROM 'active_challenge_ready' OR
    challenged->>'reviewToken' IS DISTINCT FROM review_token_value THEN
  RETURN jsonb_build_object('state','active_algorithm_unavailable',
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
  RETURN jsonb_build_object('state','active_algorithm_unavailable',
   'reason','algorithm_identity_unavailable','paidNumericServing',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_price_flow_active_algorithms(
  organization_id,context_digest,revision,action,algorithm_version,
  implementation_digest,policy_version,comparison_digest,review_digest,
  reviewed_anchor_run_id,previous_event_id,reversed_event_id,
  actor_user_id,auth_session_id,reason,request_key_hash,request_digest)
 VALUES(org,context_value,expected_revision+1,action_value,algorithm_value,
  installed,reviewed->>'policyVersion',reviewed->>'comparisonDigest',
  reviewed->>'reviewDigest',anchor_run_value,latest.id,reverses_value,
  actor,session_value,reason_value,key_hash,request_hash)
 RETURNING * INTO saved;
 RETURN jsonb_build_object('state','active_algorithm_recorded',
  'eventId',saved.id,'revision',saved.revision,
  'algorithmVersion',saved.algorithm_version,'replayed',FALSE,
  'paidNumericServing',FALSE,'realForecastEligible',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_active_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,context_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context_run public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 latest public.canonical_forecast_price_flow_active_algorithms%ROWTYPE;
 registry public.canonical_forecast_price_flow_algorithms%ROWTYPE;
 reviewed JSONB; context_value TEXT; installed TEXT; function_identity REGPROCEDURE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    context_run_value IS NULL THEN
  RAISE EXCEPTION 'Active algorithm read invalid' USING ERRCODE='22023';
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
  RETURN jsonb_build_object('state','active_algorithm_unavailable',
   'reason','context_run_unavailable','paidNumericServing',FALSE);
 END IF;
 context_value:=public.canonical_completion_digest(jsonb_build_object(
  'target',context_run.output->'target','unit',context_run.output->'unit',
  'applicability',context_run.output->'applicability',
  'sourceScope','northstar_m24_approved_price_decisions',
  'horizonGrain','day','outputKind','point','intervalPolicy','unavailable'));
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_active_algorithms
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF latest.id IS NULL THEN
  RETURN jsonb_build_object('state','active_algorithm_unavailable',
   'reason','no_human_active_choice','paidNumericServing',FALSE);
 END IF;
 reviewed:=public.canonical_forecast_price_flow_promotion_review(
  org,actor,role_value,session_value,latest.reviewed_anchor_run_id);
 SELECT * INTO registry FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version=latest.algorithm_version;
 IF latest.algorithm_version='m26_price_flow_zero_baseline_v1' THEN
  function_identity:=
   'public.canonical_forecast_capture_price_flow_zero_baseline(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure;
 ELSIF latest.algorithm_version='m26_price_flow_carry_forward_v1' THEN
  function_identity:=
   'public.canonical_forecast_capture_price_flow_origin(uuid,uuid,text,uuid,text,text,uuid,text,timestamptz,timestamptz)'::regprocedure;
 ELSE
  RETURN jsonb_build_object('state','active_algorithm_unavailable',
   'reason','algorithm_unregistered','paidNumericServing',FALSE);
 END IF;
 installed:=encode(sha256(convert_to(pg_get_functiondef(function_identity),
  'UTF8')),'hex');
 IF reviewed->>'state' IS DISTINCT FROM 'promotion_review_ready' OR
    reviewed->>'reviewDigest' IS DISTINCT FROM latest.review_digest OR
    registry.implementation_digest IS DISTINCT FROM latest.implementation_digest OR
    installed IS DISTINCT FROM latest.implementation_digest OR
    latest.context_digest IS DISTINCT FROM context_value OR
    latest.policy_version IS DISTINCT FROM reviewed->>'policyVersion' THEN
  RETURN jsonb_build_object('state','active_algorithm_unavailable',
   'reason','active_evidence_changed','revision',latest.revision,
   'paidNumericServing',FALSE);
 END IF;
 RETURN jsonb_build_object('state','active_algorithm_current',
  'eventId',latest.id,'revision',latest.revision,
  'algorithmVersion',latest.algorithm_version,
  'policyVersion',latest.policy_version,
  'futureInternalExecution',TRUE,'paidNumericServing',FALSE,
  'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_active_algorithms FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_active_challenge(
 UUID,UUID,TEXT,UUID,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_active_select(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_active_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_active_algorithms
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_active_challenge(
  UUID,UUID,TEXT,UUID,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_active_select(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,BOOLEAN)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_active_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
