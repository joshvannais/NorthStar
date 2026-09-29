-- Mission 26 Part 3B: a guarded later M24 approved-price-flow actual for one
-- saved origin. This returns a current source candidate, not an immutable
-- paired backtest or a real-world forecast accuracy claim.
CREATE FUNCTION public.canonical_forecast_price_flow_actual_candidate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 run_value UUID,receipt_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 proof public.canonical_forecast_price_flow_origin_activations%ROWTYPE;
 source JSONB; anchor JSONB; events JSONB; source_xid XID8;
 captured TIMESTAMPTZ; start_value TIMESTAMPTZ; end_value TIMESTAMPTZ;
 amount_value NUMERIC(18,2); count_value INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for price-flow actual'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','run_not_found','outcomeFinalized',FALSE);
 END IF;
 SELECT * INTO proof FROM public.canonical_forecast_price_flow_origin_activations
  WHERE organization_id=org AND run_id=run_value;
 IF NOT FOUND OR proof.observed_at>=saved.horizon_start OR
  proof.proof->>'savedReceiptDigest' IS DISTINCT FROM saved.receipt_digest OR
  saved.output->'horizon'->>'startsAt' IS DISTINCT FROM
    to_char(saved.horizon_start AT TIME ZONE 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') OR
  saved.output->'horizon'->>'endsAt' IS DISTINCT FROM
    to_char(saved.horizon_end AT TIME ZONE 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','pre_horizon_origin_unverified','outcomeFinalized',FALSE);
 END IF;
 start_value:=saved.horizon_start;
 end_value:=saved.horizon_end;
 IF clock_timestamp()<end_value THEN
  RETURN jsonb_build_object('state','price_flow_actual_pending',
   'reason','horizon_open','outcomeFinalized',FALSE);
 END IF;
 -- ordered_read takes the writer's tenant price lock and refuses a stale
 -- source receipt. A capture made during a held writer cannot claim zero.
 source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,receipt_value);
 anchor:=public.canonical_forecast_price_anchor_activation_read(
  org,actor,role_value,session_value);
 IF source IS NULL OR source->>'state'<>'current' OR
  anchor->>'state'<>'price_anchor_activation_recorded' OR
  source->>'firstReceiptId' IS DISTINCT FROM anchor->>'firstReceiptId' OR
  (source->>'coverageStartsAt')::timestamptz>start_value OR
  (anchor->>'observedAt')::timestamptz>=start_value OR
  source->'snapshot'->>'scope' IS DISTINCT FROM
   'northstar_m24_approved_price_decisions' THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','supported_source_coverage_unavailable',
   'outcomeFinalized',FALSE);
 END IF;
 captured:=(source->'snapshot'->>'capturedAt')::timestamptz;
 IF captured<end_value THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','source_not_observed_through_horizon',
   'outcomeFinalized',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO source_xid
  FROM public.canonical_forecast_price_ordered_receipts
  WHERE organization_id=org AND id=receipt_value;
 IF pg_xact_status(source_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','source_receipt_commit_unverified',
   'outcomeFinalized',FALSE);
 END IF;
 events:=source->'snapshot'->'events';
 IF jsonb_typeof(events)<>'array' OR jsonb_array_length(events)>1000 THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','source_limit_exceeded','outcomeFinalized',FALSE);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(events) event
  WHERE ((event->>'recordedAt')::timestamptz>=start_value AND
    (event->>'recordedAt')::timestamptz<end_value) IS DISTINCT FROM
   ((event->>'sourceObservedAt')::timestamptz>=start_value AND
    (event->>'sourceObservedAt')::timestamptz<end_value)) THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','decision_boundary_ambiguous','outcomeFinalized',FALSE);
 END IF;
 -- Every included pre-end source event needs a separate committed witness
 -- before its relevant boundary. An insert-time stamp never stands in for
 -- a before-boundary commit, including for a zero result.
 IF EXISTS(
  SELECT 1 FROM jsonb_array_elements(events) event
  LEFT JOIN public.canonical_forecast_price_decision_commit_observations witness
   ON witness.organization_id=org
    AND witness.decision_id=(event->>'decisionId')::uuid
  WHERE (event->>'sourceObservedAt')::timestamptz<end_value
    AND (witness.decision_id IS NULL OR
     witness.observed_at<(event->>'sourceObservedAt')::timestamptz OR
     witness.observed_at>=CASE
      WHEN (event->>'sourceObservedAt')::timestamptz<start_value
       THEN start_value ELSE end_value END)
 ) THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','event_commit_boundary_unverified',
   'outcomeFinalized',FALSE);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(events) event
  WHERE (event->>'sourceObservedAt')::timestamptz>=start_value
   AND (event->>'sourceObservedAt')::timestamptz<end_value
   AND event->>'action'='approve'
   AND (event->>'revision')::integer=1
   AND event->>'currency' IS DISTINCT FROM saved.output->'unit'->>'currency') THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','currency_conflict','outcomeFinalized',FALSE);
 END IF;
 -- Any later decision for an in-window first approval requires reviewed
 -- correction policy and a new evaluation revision; do not silently retain
 -- the first calculated amount as a finalized actual.
 IF EXISTS(
  SELECT 1 FROM jsonb_array_elements(events) first_event
  JOIN jsonb_array_elements(events) later_event
   ON later_event->>'estimateId'=first_event->>'estimateId'
    AND later_event->>'decisionId'<>first_event->>'decisionId'
  WHERE first_event->>'action'='approve'
   AND (first_event->>'revision')::integer=1
   AND (first_event->>'sourceObservedAt')::timestamptz>=start_value
   AND (first_event->>'sourceObservedAt')::timestamptz<end_value
 ) THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','approval_amended_or_withdrawn',
   'outcomeFinalized',FALSE);
 END IF;
 SELECT count(*)::integer,
  COALESCE(sum((event->>'priceBeforeTax')::numeric(18,2)),0)::numeric(18,2)
 INTO count_value,amount_value FROM jsonb_array_elements(events) event
 WHERE event->>'action'='approve' AND (event->>'revision')::integer=1
  AND (event->>'sourceObservedAt')::timestamptz>=start_value
  AND (event->>'sourceObservedAt')::timestamptz<end_value;
 RETURN jsonb_build_object('state','price_flow_actual_candidate',
  'runId',saved.id,'sourceReceiptId',receipt_value,
  'sourceSnapshotDigest',source->'snapshot'->>'sourceSnapshotDigest',
  'originProofDigest',proof.proof_digest,
  'observedThrough',public.canonical_forecast_utc_instant(captured),
  'firstApprovalCount',count_value,'amount',amount_value::text,
  'currency',saved.output->'unit'->>'currency',
  'selectedSourceFinalizedAtCapture',TRUE,
  'wholeBusinessCoverageVerified',FALSE,
  'outcomeFinalized',FALSE,'realForecastEligible',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_actual_candidate(
 UUID,UUID,TEXT,UUID,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_actual_candidate(
  UUID,UUID,TEXT,UUID,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
