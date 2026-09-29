-- Mission 26 Part 3C: preserve a durable, tenant-scoped observation that an
-- immutable actual receipt committed. PostgreSQL need not retain the receipt
-- row's transaction status for the full evaluation window.
CREATE TABLE public.canonical_forecast_price_flow_actual_commit_observations (
 organization_id UUID NOT NULL,
 receipt_id UUID NOT NULL,
 run_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 PRIMARY KEY(organization_id,receipt_id),
 FOREIGN KEY(organization_id,receipt_id)
  REFERENCES public.canonical_forecast_price_flow_actual_receipts(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_price_flow_actual_commit_by_run
 ON public.canonical_forecast_price_flow_actual_commit_observations
 (organization_id,run_id,observed_at,receipt_id);
CREATE TRIGGER canonical_forecast_price_flow_actual_commit_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_actual_commit_observations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

-- Rows visible to this later migration transaction were committed before the
-- migration snapshot. Backfill them once so older retained actuals do not
-- depend on pg_xact_status retention.
INSERT INTO public.canonical_forecast_price_flow_actual_commit_observations(
 organization_id,receipt_id,run_id,observed_at,actor_user_id,auth_session_id)
SELECT organization_id,id,run_id,clock_timestamp(),actor_user_id,auth_session_id
FROM public.canonical_forecast_price_flow_actual_receipts
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.canonical_forecast_observe_price_flow_actual_commit(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 receipt_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 prior public.canonical_forecast_price_flow_actual_commit_observations%ROWTYPE;
 source_xid XID8; current_xid XID8; observed TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  receipt_value IS NULL THEN
  RAISE EXCEPTION 'Price-flow actual commit observation request invalid'
   USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO source FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND id=receipt_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_flow_actual_commit_unavailable',
   'reason','actual_receipt_not_found');
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-flow-actual:'||org::text||':'||source.run_id::text,0)) THEN
  RAISE EXCEPTION 'Price-flow actual commit observation is busy'
   USING ERRCODE='55P03';
 END IF;
 SELECT * INTO prior
  FROM public.canonical_forecast_price_flow_actual_commit_observations
  WHERE organization_id=org AND receipt_id=source.id;
 IF FOUND THEN
  RETURN jsonb_build_object('state','price_flow_actual_commit_observed',
   'receiptId',source.id,'runId',source.run_id,'revision',source.revision,
   'commitObservedAt',public.canonical_forecast_utc_instant(prior.observed_at),
   'replayed',TRUE);
 END IF;
 SELECT xmin::text::xid8 INTO source_xid
  FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND id=source.id;
 current_xid:=pg_current_xact_id_if_assigned();
 -- A normal READ COMMITTED snapshot only exposes another transaction's row
 -- after commit. Refuse the sole exception: a receipt written by this same,
 -- still-open transaction.
 IF current_xid IS NOT NULL AND source_xid=current_xid THEN
  RETURN jsonb_build_object('state','price_flow_actual_commit_unavailable',
   'reason','actual_commit_not_observed');
 END IF;
 observed:=clock_timestamp();
 INSERT INTO public.canonical_forecast_price_flow_actual_commit_observations(
  organization_id,receipt_id,run_id,observed_at,actor_user_id,auth_session_id)
 VALUES(org,source.id,source.run_id,observed,actor,session_value)
 ON CONFLICT ON CONSTRAINT canonical_forecast_price_flow_actual_commit_observations_pkey
 DO NOTHING;
 SELECT * INTO prior
  FROM public.canonical_forecast_price_flow_actual_commit_observations
  WHERE organization_id=org AND receipt_id=source.id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Price-flow actual commit observation unavailable'
   USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('state','price_flow_actual_commit_observed',
  'receiptId',source.id,'runId',source.run_id,'revision',source.revision,
  'commitObservedAt',public.canonical_forecast_utc_instant(prior.observed_at),
  'replayed',prior.observed_at<>observed);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_price_flow_actual_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 witness public.canonical_forecast_price_flow_actual_commit_observations%ROWTYPE;
 source JSONB;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND run_id=run_value
  ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','no_saved_actual','outcomeFinalized',FALSE);
 END IF;
 SELECT * INTO witness
  FROM public.canonical_forecast_price_flow_actual_commit_observations
  WHERE organization_id=org AND receipt_id=latest.id AND run_id=latest.run_id;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','actual_commit_unverified','receiptId',latest.id,
   'revision',latest.revision,'outcomeFinalized',FALSE);
 END IF;
 source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,latest.source_receipt_id);
 IF source IS NULL OR source->>'state'<>'current' OR
  source->'snapshot'->>'sourceSnapshotDigest' IS DISTINCT FROM
   latest.source_snapshot_digest THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','source_changed','receiptId',latest.id,
   'revision',latest.revision,'outcomeFinalized',FALSE);
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN latest.state='known' THEN
   'price_flow_actual_finalized' ELSE 'price_flow_actual_revoked' END,
  'receiptId',latest.id,'revision',latest.revision,
  'previousId',latest.previous_id,'runId',latest.run_id,
  'sourceReceiptId',latest.source_receipt_id,
  'sourceSnapshotDigest',latest.source_snapshot_digest,
  'receiptDigest',latest.receipt_digest,
  'commitObservedAt',public.canonical_forecast_utc_instant(witness.observed_at),
  'observedThrough',public.canonical_forecast_utc_instant(latest.observed_through),
  'capturedAt',public.canonical_forecast_utc_instant(latest.captured_at),
  'amount',latest.amount,'firstApprovalCount',latest.first_approval_count,
  'currency',latest.currency,
  'outcomeFinalized',latest.state='known',
  'wholeBusinessCoverageVerified',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_actual_commit_observations
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_observe_price_flow_actual_commit(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_actual_commit_observations
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_observe_price_flow_actual_commit(
  UUID,UUID,TEXT,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
