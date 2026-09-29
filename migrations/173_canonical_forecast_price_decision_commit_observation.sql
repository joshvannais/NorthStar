-- Mission 26 Part 3B: a separate transaction witnesses one M24 price
-- decision's commit. The source-order timestamp alone is not commit time.
CREATE TABLE public.canonical_forecast_price_decision_commit_observations (
 organization_id UUID NOT NULL,
 decision_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 PRIMARY KEY(organization_id,decision_id),
 FOREIGN KEY(organization_id,decision_id)
  REFERENCES public.canonical_forecast_price_decision_orders(organization_id,decision_id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_price_decision_commit_by_time
 ON public.canonical_forecast_price_decision_commit_observations
 (organization_id,observed_at,decision_id);
CREATE TRIGGER canonical_forecast_price_decision_commit_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_decision_commit_observations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_observe_price_decision_commit(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 decision_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source public.canonical_forecast_price_decision_orders%ROWTYPE;
 prior public.canonical_forecast_price_decision_commit_observations%ROWTYPE;
 source_xid XID8; observed TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for price-decision commit observation'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF decision_value IS NULL THEN
  RAISE EXCEPTION 'Price decision identity required' USING ERRCODE='22023';
 END IF;
 -- Same source lock as the M24 decision writer. A held writer cannot be
 -- witnessed before it commits, and no other tenant is serialized here.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Price decision source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO source FROM public.canonical_forecast_price_decision_orders
  WHERE organization_id=org AND decision_id=decision_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_decision_commit_unavailable',
   'reason','decision_not_found','sourceFinalized',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_price_decision_commit_observations
  WHERE organization_id=org AND decision_id=decision_value;
 IF FOUND THEN
  RETURN jsonb_build_object('state','price_decision_commit_observed',
   'decisionId',decision_value,
   'sourceObservedAt',public.canonical_forecast_utc_instant(source.ordered_at),
   'commitObservedAt',public.canonical_forecast_utc_instant(prior.observed_at),
   'replayed',TRUE,'sourceFinalized',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO source_xid
  FROM public.canonical_forecast_price_decision_orders
  WHERE organization_id=org AND decision_id=decision_value;
 IF pg_xact_status(source_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','price_decision_commit_unavailable',
   'reason','decision_commit_not_observed','sourceFinalized',FALSE);
 END IF;
 observed:=clock_timestamp();
 INSERT INTO public.canonical_forecast_price_decision_commit_observations(
  organization_id,decision_id,observed_at,actor_user_id,auth_session_id)
 VALUES(org,decision_value,observed,actor,session_value)
 ON CONFLICT ON CONSTRAINT canonical_forecast_price_decision_commit_observations_pkey
 DO NOTHING;
 SELECT * INTO prior FROM public.canonical_forecast_price_decision_commit_observations
  WHERE organization_id=org AND decision_id=decision_value;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Price-decision commit observation unavailable'
   USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('state','price_decision_commit_observed',
  'decisionId',decision_value,
  'sourceObservedAt',public.canonical_forecast_utc_instant(source.ordered_at),
  'commitObservedAt',public.canonical_forecast_utc_instant(prior.observed_at),
  'replayed',prior.observed_at<>observed,'sourceFinalized',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_decision_commit_observations
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_observe_price_decision_commit(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_decision_commit_observations
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_observe_price_decision_commit(
  UUID,UUID,TEXT,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
