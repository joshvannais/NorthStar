-- Mission 26 Part 2B: prove the first ordered-price receipt committed before
-- an observation period begins. The receipt's insert clock is not commit time.
CREATE TABLE public.canonical_forecast_price_anchor_activations (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 first_receipt_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 FOREIGN KEY(organization_id,first_receipt_id)
  REFERENCES public.canonical_forecast_price_ordered_receipts(organization_id,id)
   ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
   ON DELETE RESTRICT,
 FOREIGN KEY(auth_session_id) REFERENCES public.auth_sessions(id) ON DELETE RESTRICT
);
CREATE TRIGGER canonical_forecast_price_anchor_activations_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_anchor_activations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_profile_effective_immutable();

CREATE FUNCTION public.canonical_forecast_price_anchor_activate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_row public.canonical_forecast_price_ordered_anchors%ROWTYPE;
 prior public.canonical_forecast_price_anchor_activations%ROWTYPE;
 source_xid XID8; observed TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Price anchor activation requires READ COMMITTED' USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO anchor_row FROM public.canonical_forecast_price_ordered_anchors
  WHERE organization_id=org;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_anchor_activation_unavailable',
   'reason','price_anchor_missing','sourceCoverageVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_price_anchor_activations
  WHERE organization_id=org;
 IF FOUND THEN
  IF prior.first_receipt_id<>anchor_row.first_receipt_id THEN
   RAISE EXCEPTION 'Price anchor identity changed' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('state','price_anchor_activation_recorded',
   'firstReceiptId',prior.first_receipt_id,
   'observedAt',public.canonical_forecast_utc_instant(prior.observed_at),
   'replayed',TRUE,'sourceCoverageVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO source_xid
  FROM public.canonical_forecast_price_ordered_receipts
  WHERE organization_id=org AND id=anchor_row.first_receipt_id;
 IF source_xid IS NULL OR pg_xact_status(source_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','price_anchor_activation_unavailable',
   'reason','price_anchor_commit_unverified','sourceCoverageVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 observed:=clock_timestamp();
 INSERT INTO public.canonical_forecast_price_anchor_activations(
  organization_id,first_receipt_id,observed_at,actor_user_id,auth_session_id)
 VALUES(org,anchor_row.first_receipt_id,observed,actor,session_value)
 ON CONFLICT ON CONSTRAINT canonical_forecast_price_anchor_activations_pkey
 DO NOTHING;
 SELECT * INTO prior FROM public.canonical_forecast_price_anchor_activations
  WHERE organization_id=org;
 IF NOT FOUND OR prior.first_receipt_id<>anchor_row.first_receipt_id THEN
  RAISE EXCEPTION 'Price anchor activation unavailable' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('state','price_anchor_activation_recorded',
  'firstReceiptId',prior.first_receipt_id,
  'observedAt',public.canonical_forecast_utc_instant(prior.observed_at),
  'replayed',prior.observed_at<>observed,
  'sourceCoverageVerified',FALSE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_anchor_activation_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_price_anchor_activations%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO prior FROM public.canonical_forecast_price_anchor_activations
  WHERE organization_id=org;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_anchor_activation_unavailable',
   'reason','not_activated','sourceCoverageVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','price_anchor_activation_recorded',
  'firstReceiptId',prior.first_receipt_id,
  'observedAt',public.canonical_forecast_utc_instant(prior.observed_at),
  'sourceCoverageVerified',FALSE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_anchor_activations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_anchor_activate(
 UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_anchor_activation_read(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_anchor_activations
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_anchor_activate(
  UUID,UUID,TEXT,UUID,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_anchor_activation_read(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
