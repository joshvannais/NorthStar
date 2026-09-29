-- Mission 26 Part 3D: append-only tenant/context algorithm staging.
-- A staged choice affects no paid numeric forecast, customer communication,
-- existing run or source authority. It is not empirical model promotion.
CREATE TABLE public.canonical_forecast_price_flow_staged_algorithms (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 context_digest TEXT NOT NULL CHECK(context_digest~'^[a-f0-9]{64}$'),
 revision INTEGER NOT NULL CHECK(revision>0),
 research_event_id UUID NOT NULL REFERENCES public.canonical_forecast_price_flow_research_selections(id),
 reviewed_anchor_run_id UUID NOT NULL,
 algorithm_version TEXT NOT NULL REFERENCES public.canonical_forecast_price_flow_algorithms(algorithm_version),
 implementation_digest TEXT NOT NULL CHECK(implementation_digest~'^[a-f0-9]{64}$'),
 research_comparison_digest TEXT NOT NULL
  CHECK(research_comparison_digest~'^[a-f0-9]{64}$'),
 fixed_comparison_digest TEXT NOT NULL
  CHECK(fixed_comparison_digest~'^[a-f0-9]{64}$'),
 policy_version TEXT NOT NULL CHECK(policy_version='m26_fixed_supported_m24_staging_v1'),
 action TEXT NOT NULL CHECK(action IN ('stage_candidate','rollback')),
 previous_event_id UUID REFERENCES public.canonical_forecast_price_flow_staged_algorithms(id),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 16 AND 1000),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 staged_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 forecast_serving_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT forecast_serving_enabled),
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
CREATE INDEX canonical_forecast_price_flow_staged_latest
 ON public.canonical_forecast_price_flow_staged_algorithms
 (organization_id,context_digest,revision DESC);
CREATE TRIGGER canonical_forecast_price_flow_staged_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_staged_algorithms
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_price_flow_stage_algorithm(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,expected_revision INTEGER,research_event_value UUID,
 anchor_run_value UUID,reason_value TEXT,confirmed_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 choice public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 latest_choice public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 registry public.canonical_forecast_price_flow_algorithms%ROWTYPE;
 prior public.canonical_forecast_price_flow_staged_algorithms%ROWTYPE;
 latest public.canonical_forecast_price_flow_staged_algorithms%ROWTYPE;
 saved public.canonical_forecast_price_flow_staged_algorithms%ROWTYPE;
 reviewed JSONB; selected_review JSONB; rolling_population JSONB;
 context_value TEXT; key_hash TEXT; prior_lock_timeout TEXT;
 request_hash TEXT;
 action_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    expected_revision IS NULL OR expected_revision<0 OR
    research_event_value IS NULL OR anchor_run_value IS NULL OR
    reason_value IS NULL OR length(reason_value) NOT BETWEEN 16 AND 1000 OR
    confirmed_value IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Algorithm staging request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'expectedRevision',expected_revision,'researchEventId',research_event_value,
  'anchorRunId',anchor_run_value,'reason',reason_value));
 -- Serialize identical actor/request keys before the tenant try-lock. A
 -- concurrent duplicate waits, then observes the committed receipt as a
 -- replay instead of spuriously returning source-busy.
 prior_lock_timeout:=current_setting('lock_timeout');
 PERFORM set_config('lock_timeout','0',TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:algorithm-stage-request:'||org::text||':'||actor::text||':'||key_hash,0));
 PERFORM set_config('lock_timeout',prior_lock_timeout,TRUE);
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_staged_algorithms
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Algorithm staging replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','algorithm_staged',
   'eventId',prior.id,'revision',prior.revision,
   'algorithmVersion',prior.algorithm_version,'replayed',TRUE,
   'forecastServingEnabled',FALSE,'realForecastEligible',FALSE);
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO anchor FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=anchor_run_value;
 IF anchor.id IS NULL OR anchor.output->>'calculationVersion' IS DISTINCT FROM
    'm26_price_flow_carry_forward_v1' THEN
  RETURN jsonb_build_object('state','algorithm_staging_unavailable',
   'reason','review_anchor_unavailable','forecastServingEnabled',FALSE);
 END IF;
 context_value:=public.canonical_completion_digest(jsonb_build_object(
  'target',anchor.output->'target','unit',anchor.output->'unit',
  'applicability',anchor.output->'applicability',
  'sourceScope','northstar_m24_approved_price_decisions',
  'horizonGrain','day','outputKind','point','intervalPolicy','unavailable'));
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_staged_algorithms
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF COALESCE(latest.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Algorithm staging revision changed' USING ERRCODE='23505';
 END IF;
 SELECT * INTO latest_choice FROM public.canonical_forecast_price_flow_research_selections
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT * INTO choice FROM public.canonical_forecast_price_flow_research_selections
  WHERE organization_id=org AND id=research_event_value;
 IF choice.id IS NULL OR choice.id IS DISTINCT FROM latest_choice.id THEN
  RETURN jsonb_build_object('state','algorithm_staging_unavailable',
   'reason','review_choice_changed','forecastServingEnabled',FALSE);
 END IF;
 IF choice.action='select_candidate' THEN
  action_value:='stage_candidate';
  IF choice.algorithm_version IS DISTINCT FROM
      'm26_price_flow_zero_baseline_v1' OR
     choice.previous_algorithm_version IS DISTINCT FROM
      'm26_price_flow_carry_forward_v1' OR
     (latest.id IS NOT NULL AND NOT(
       latest.action='rollback' AND latest.algorithm_version=
        'm26_price_flow_carry_forward_v1')) THEN
   RAISE EXCEPTION 'Candidate staging invalid' USING ERRCODE='22023';
  END IF;
 ELSIF choice.action='rollback' THEN
  action_value:='rollback';
  IF choice.algorithm_version IS DISTINCT FROM
      'm26_price_flow_carry_forward_v1' OR latest.id IS NULL OR
    latest.action IS DISTINCT FROM 'stage_candidate' OR
    latest.algorithm_version IS DISTINCT FROM
      'm26_price_flow_zero_baseline_v1' OR
    choice.reversed_event_id IS DISTINCT FROM latest.research_event_id THEN
   RAISE EXCEPTION 'Algorithm rollback invalid' USING ERRCODE='22023';
  END IF;
 ELSE
  RAISE EXCEPTION 'Algorithm choice action invalid' USING ERRCODE='22023';
 END IF;
 selected_review:=public.canonical_forecast_price_flow_research_review(
  org,actor,role_value,session_value);
 rolling_population:=public.canonical_forecast_price_flow_matched_population(
  org,actor,role_value,session_value,TRUE);
 IF selected_review->>'state' IS DISTINCT FROM 'research_review_ready' OR
    selected_review->>'comparisonDigest' IS DISTINCT FROM
      choice.comparison_digest OR
    rolling_population->>'state' IS DISTINCT FROM
      'matched_population_observed' OR
    rolling_population->>'anchorRunId' IS DISTINCT FROM
      anchor_run_value::text OR
    public.canonical_completion_digest(rolling_population) IS DISTINCT FROM
      choice.comparison_digest THEN
  RETURN jsonb_build_object('state','algorithm_staging_unavailable',
   'reason','review_choice_cohort_changed','forecastServingEnabled',FALSE);
 END IF;
 reviewed:=public.canonical_forecast_price_flow_fixed_research_review(
  org,actor,role_value,session_value,anchor_run_value);
 IF reviewed->>'state' IS DISTINCT FROM 'fixed_research_review_ready' THEN
  RETURN jsonb_build_object('state','algorithm_staging_unavailable',
   'reason','review_evidence_changed','forecastServingEnabled',FALSE);
 END IF;
 SELECT * INTO registry FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version=choice.algorithm_version;
 IF registry.algorithm_version IS NULL OR
    registry.target_key IS DISTINCT FROM anchor.output->'target'->>'key' OR
    registry.target_version IS DISTINCT FROM
      anchor.output->'target'->>'definitionVersion' OR
    registry.output_kind<>'point' OR registry.interval_policy<>'unavailable' THEN
  RETURN jsonb_build_object('state','algorithm_staging_unavailable',
   'reason','algorithm_identity_unavailable','forecastServingEnabled',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_price_flow_staged_algorithms(
  organization_id,context_digest,revision,research_event_id,
  reviewed_anchor_run_id,algorithm_version,implementation_digest,
  research_comparison_digest,fixed_comparison_digest,policy_version,
  action,previous_event_id,reason,
  actor_user_id,auth_session_id,request_key_hash,request_digest)
 VALUES(org,context_value,expected_revision+1,choice.id,
  anchor_run_value,choice.algorithm_version,registry.implementation_digest,
  choice.comparison_digest,reviewed->>'comparisonDigest',
  'm26_fixed_supported_m24_staging_v1',
  action_value,latest.id,reason_value,actor,session_value,key_hash,request_hash)
 RETURNING * INTO saved;
 RETURN jsonb_build_object('state','algorithm_staged',
  'eventId',saved.id,'revision',saved.revision,
  'algorithmVersion',saved.algorithm_version,'replayed',FALSE,
  'forecastServingEnabled',FALSE,'realForecastEligible',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_staged_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 context_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context_run public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 latest public.canonical_forecast_price_flow_staged_algorithms%ROWTYPE;
 latest_choice public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 registry public.canonical_forecast_price_flow_algorithms%ROWTYPE;
 reviewed JSONB; selected_review JSONB; rolling_population JSONB;
 context_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    context_run_value IS NULL THEN
  RAISE EXCEPTION 'Algorithm staging read invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO context_run FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=context_run_value;
 IF context_run.id IS NULL OR
    context_run.output->>'calculationVersion' IS DISTINCT FROM
      'm26_price_flow_carry_forward_v1' THEN
  RETURN jsonb_build_object('state','staged_algorithm_unavailable',
   'reason','context_run_unavailable','forecastServingEnabled',FALSE);
 END IF;
 context_value:=public.canonical_completion_digest(jsonb_build_object(
  'target',context_run.output->'target','unit',context_run.output->'unit',
  'applicability',context_run.output->'applicability',
  'sourceScope','northstar_m24_approved_price_decisions',
  'horizonGrain','day','outputKind','point','intervalPolicy','unavailable'));
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_staged_algorithms
  WHERE organization_id=org AND context_digest=context_value
  ORDER BY revision DESC LIMIT 1;
 IF latest.id IS NULL THEN
  RETURN jsonb_build_object('state','staged_algorithm_unavailable',
   'reason','no_reviewed_staging','forecastServingEnabled',FALSE);
 END IF;
 SELECT * INTO latest_choice FROM public.canonical_forecast_price_flow_research_selections
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF latest_choice.id IS DISTINCT FROM latest.research_event_id THEN
  RETURN jsonb_build_object('state','staged_algorithm_unavailable',
   'reason','review_choice_changed','revision',latest.revision,
   'forecastServingEnabled',FALSE);
 END IF;
 reviewed:=public.canonical_forecast_price_flow_fixed_research_review(
  org,actor,role_value,session_value,latest.reviewed_anchor_run_id);
 selected_review:=public.canonical_forecast_price_flow_research_review(
  org,actor,role_value,session_value);
 rolling_population:=public.canonical_forecast_price_flow_matched_population(
  org,actor,role_value,session_value,TRUE);
 SELECT * INTO registry FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version=latest.algorithm_version;
 IF reviewed->>'state' IS DISTINCT FROM 'fixed_research_review_ready' OR
    reviewed->>'comparisonDigest' IS DISTINCT FROM
      latest.fixed_comparison_digest OR
    selected_review->>'state' IS DISTINCT FROM 'research_review_ready' OR
    selected_review->>'comparisonDigest' IS DISTINCT FROM
      latest.research_comparison_digest OR
    selected_review->>'comparisonDigest' IS DISTINCT FROM
      latest_choice.comparison_digest OR
    rolling_population->>'state' IS DISTINCT FROM
      'matched_population_observed' OR
    rolling_population->>'anchorRunId' IS DISTINCT FROM
      latest.reviewed_anchor_run_id::text OR
    public.canonical_completion_digest(rolling_population) IS DISTINCT FROM
      latest.research_comparison_digest OR
    registry.implementation_digest IS DISTINCT FROM
      latest.implementation_digest THEN
  RETURN jsonb_build_object('state','staged_algorithm_unavailable',
   'reason','staged_evidence_changed','revision',latest.revision,
   'forecastServingEnabled',FALSE);
 END IF;
 RETURN jsonb_build_object('state','staged_algorithm_current',
  'eventId',latest.id,'revision',latest.revision,
  'algorithmVersion',latest.algorithm_version,
  'policyVersion',latest.policy_version,
  'researchOnly',TRUE,'forecastServingEnabled',FALSE,
  'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_staged_algorithms FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_stage_algorithm(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,INTEGER,UUID,UUID,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_staged_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_staged_algorithms
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_stage_algorithm(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,INTEGER,UUID,UUID,TEXT,BOOLEAN)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_staged_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
