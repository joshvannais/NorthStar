-- Mission 26 Part 3D: two executable, point-only selected-M24 definitions.
-- Registration proves the installed SQL body, not empirical fitness or real
-- forecast eligibility. The zero baseline is a deliberately weak comparator.
CREATE TABLE public.canonical_forecast_price_flow_algorithms (
 algorithm_version TEXT PRIMARY KEY,
 target_key TEXT NOT NULL CHECK(target_key='revenue.approved_price_flow'),
 target_version TEXT NOT NULL CHECK(target_version='v1'),
 source_scope TEXT NOT NULL CHECK(source_scope='northstar_m24_approved_price_decisions'),
 horizon_grain TEXT NOT NULL CHECK(horizon_grain='day'),
 output_kind TEXT NOT NULL CHECK(output_kind='point'),
 interval_policy TEXT NOT NULL CHECK(interval_policy='unavailable'),
 implementation_digest TEXT NOT NULL CHECK(implementation_digest~'^[a-f0-9]{64}$'),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(algorithm_version IN ('m26_price_flow_carry_forward_v1',
  'm26_price_flow_zero_baseline_v1'))
);
CREATE TRIGGER canonical_forecast_price_flow_algorithms_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_flow_algorithms
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_capture_price_flow_zero_baseline(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,base_run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 prior public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 registry public.canonical_forecast_price_flow_algorithms%ROWTYPE;
 source_state JSONB; current_source JSONB; zero_output JSONB;
 key_hash TEXT; request_hash TEXT; saved TIMESTAMPTZ;
 installed_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  base_run_value IS NULL THEN
  RAISE EXCEPTION 'Zero baseline request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'baseRunId',base_run_value,'algorithmVersion',
  'm26_price_flow_zero_baseline_v1'));
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF prior.request_digest<>request_hash OR
   prior.output->>'calculationVersion'<>'m26_price_flow_zero_baseline_v1' THEN
   RAISE EXCEPTION 'Zero baseline replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','saved_price_flow_origin',
   'runId',prior.id,'output',prior.output,'receiptDigest',prior.receipt_digest,
   'replayed',TRUE,'preHorizonCommitVerified',FALSE);
 END IF;
 SELECT * INTO registry FROM public.canonical_forecast_price_flow_algorithms
  WHERE algorithm_version='m26_price_flow_zero_baseline_v1';
 installed_digest:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_capture_price_flow_zero_baseline(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure),
  'UTF8')),'hex');
 IF registry.algorithm_version IS NULL OR
  registry.implementation_digest<>installed_digest THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','algorithm_registration_unverified','forecastIssued',FALSE);
 END IF;
 SELECT * INTO base FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=base_run_value;
 IF base.id IS NULL OR
  base.output->>'calculationVersion'<>'m26_price_flow_carry_forward_v1' OR
  base.receipt_digest<>public.canonical_completion_digest(base.output) THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','base_origin_unavailable','forecastIssued',FALSE);
 END IF;
 source_state:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,base_run_value);
 current_source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,base.source_receipt_id);
 IF source_state->>'state' IS DISTINCT FROM 'pair_source_verified' OR
  current_source->>'state' IS DISTINCT FROM 'current' OR
  source_state->>'sourceReceiptDigest' IS DISTINCT FROM base.receipt_digest THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','base_source_unavailable','forecastIssued',FALSE);
 END IF;
 saved:=clock_timestamp();
 IF saved>=base.horizon_start OR saved<base.saved_at THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','origin_window_not_eligible','forecastIssued',FALSE);
 END IF;
 zero_output:=jsonb_set(base.output,'{value,amount}','"0.00"'::jsonb);
 zero_output:=jsonb_set(zero_output,'{calculationVersion}',
  '"m26_price_flow_zero_baseline_v1"'::jsonb);
 zero_output:=jsonb_set(zero_output,'{uncertainty,drivers}',
  '["deterministic_zero_baseline"]'::jsonb);
 zero_output:=jsonb_set(zero_output,'{applicability,limits}',
  '["northstar_m24_only","uncalibrated_zero_baseline"]'::jsonb);
 INSERT INTO public.canonical_forecast_price_flow_saved_origins(
  organization_id,saved_at,horizon_start,horizon_end,source_receipt_id,
  output,receipt_digest,actor_user_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,saved,base.horizon_start,base.horizon_end,base.source_receipt_id,
  zero_output,public.canonical_completion_digest(zero_output),actor,
  session_value,key_hash,request_hash) RETURNING * INTO prior;
 RETURN jsonb_build_object('state','saved_price_flow_origin',
  'runId',prior.id,'output',prior.output,'receiptDigest',prior.receipt_digest,
  'replayed',FALSE,'preHorizonCommitVerified',FALSE);
END $$;

INSERT INTO public.canonical_forecast_price_flow_algorithms(
 algorithm_version,target_key,target_version,source_scope,horizon_grain,
 output_kind,interval_policy,implementation_digest)
VALUES
 ('m26_price_flow_carry_forward_v1','revenue.approved_price_flow','v1',
  'northstar_m24_approved_price_decisions','day','point','unavailable',
  encode(sha256(convert_to(pg_get_functiondef(
   'public.canonical_forecast_capture_price_flow_origin(uuid,uuid,text,uuid,text,text,uuid,text,timestamptz,timestamptz)'::regprocedure),
   'UTF8')),'hex')),
 ('m26_price_flow_zero_baseline_v1','revenue.approved_price_flow','v1',
  'northstar_m24_approved_price_decisions','day','point','unavailable',
  encode(sha256(convert_to(pg_get_functiondef(
   'public.canonical_forecast_capture_price_flow_zero_baseline(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure),
   'UTF8')),'hex'));

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_algorithms FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_price_flow_zero_baseline(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_algorithms
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_price_flow_zero_baseline(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
