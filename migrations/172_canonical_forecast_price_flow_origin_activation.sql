-- A distinct committed transaction observes that the immutable prediction
-- origin committed before its future horizon. Insertion time alone cannot.
CREATE TABLE public.canonical_forecast_price_flow_origin_activations (
 organization_id UUID NOT NULL,
 run_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 proof JSONB NOT NULL,
 proof_digest TEXT NOT NULL CHECK(proof_digest~'^[a-f0-9]{64}$'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 PRIMARY KEY(organization_id,run_id),
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CHECK(proof->>'state'='price_flow_origin_activated'),
 CHECK(proof->'preHorizonCommitVerified'='true'::jsonb),
 CHECK(proof_digest=public.canonical_completion_digest(proof))
);
CREATE TRIGGER canonical_forecast_price_flow_activation_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_origin_activations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_activate_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 prior public.canonical_forecast_price_flow_origin_activations%ROWTYPE;
 capture_xid XID8; observed TIMESTAMPTZ; proof_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for price-flow origin activation'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','run_not_found','preHorizonCommitVerified',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_origin_activations
  WHERE organization_id=org AND run_id=run_value;
 IF FOUND THEN
  RETURN prior.proof||jsonb_build_object('proofDigest',prior.proof_digest,
   'replayed',TRUE);
 END IF;
 SELECT xmin::text::xid8 INTO capture_xid
  FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 IF pg_xact_status(capture_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','capture_commit_not_observed',
   'preHorizonCommitVerified',FALSE);
 END IF;
 observed:=clock_timestamp();
 IF observed>=saved.horizon_start THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','capture_commit_not_observed_before_horizon',
   'preHorizonCommitVerified',FALSE);
 END IF;
 proof_value:=jsonb_build_object('state','price_flow_origin_activated',
  'runId',saved.id,'savedReceiptDigest',saved.receipt_digest,
  'captureCommitObservedAt',public.canonical_forecast_utc_instant(observed),
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_start),
  'preHorizonCommitVerified',TRUE,'realForecastEligible',FALSE);
 INSERT INTO public.canonical_forecast_price_flow_origin_activations(
  organization_id,run_id,observed_at,proof,proof_digest,
  actor_user_id,auth_session_id)
 VALUES(org,run_value,observed,proof_value,
  public.canonical_completion_digest(proof_value),actor,session_value)
 ON CONFLICT ON CONSTRAINT canonical_forecast_price_flow_origin_activations_pkey
 DO NOTHING;
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_origin_activations
  WHERE organization_id=org AND run_id=run_value;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Price-flow origin activation unavailable'
   USING ERRCODE='40001';
 END IF;
 RETURN prior.proof||jsonb_build_object('proofDigest',prior.proof_digest,
  'replayed',prior.observed_at<>observed);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_origin_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 activation public.canonical_forecast_price_flow_origin_activations%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','run_not_found','preHorizonCommitVerified',FALSE);
 END IF;
 SELECT * INTO activation
  FROM public.canonical_forecast_price_flow_origin_activations
  WHERE organization_id=org AND run_id=run_value;
 RETURN jsonb_build_object('state','saved_price_flow_origin',
  'runId',saved.id,'savedAt',to_char(
   date_trunc('milliseconds',saved.saved_at) AT TIME ZONE 'UTC',
   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'sourceReceiptId',saved.source_receipt_id,'output',saved.output,
  'receiptDigest',saved.receipt_digest,
  'originProofDigest',activation.proof_digest,
  'captureCommitObservedAt',activation.proof->>'captureCommitObservedAt',
  'preHorizonCommitVerified',activation.run_id IS NOT NULL,
  'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_origin_activations
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_activate_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_origin_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_origin_activations
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_activate_price_flow_origin(
  UUID,UUID,TEXT,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_origin_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
