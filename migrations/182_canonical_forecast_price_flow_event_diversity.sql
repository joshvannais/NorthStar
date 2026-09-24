-- Mission 26 Part 3C: a capture instant is not an independent M24 event.
-- Count only distinct UTC days with an attributable first approval in each
-- saved origin's selected prior-day source receipt. The receipt was committed
-- before the saved origin; the origin's later activation observes that commit
-- before its horizon. Source event timestamps do not prove calendar day-end.
CREATE FUNCTION public.canonical_forecast_price_flow_event_diversity(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 expected_anchor UUID,expected_origins JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE window_value JSONB; item JSONB;
 saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 receipt public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 activation public.canonical_forecast_price_flow_origin_activations%ROWTYPE;
 prior_start TIMESTAMPTZ; prior_end TIMESTAMPTZ;
 source_days DATE[]:=ARRAY[]::DATE[];
 eligible_count INTEGER:=0; source_day DATE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for price-flow event diversity'
   USING ERRCODE='25001';
 END IF;
 -- Re-read the guarded inventory, then bind the entire ordered run list to
 -- the caller's first inventory. Midnight may change the anchor between
 -- READ COMMITTED statements even without a writer.
 window_value:=public.canonical_forecast_price_flow_complete_window(
  org,actor,role_value,session_value);
 IF window_value->>'state'<>'complete_saved_origin_window_observed' OR
    window_value->>'anchorRunId' IS DISTINCT FROM expected_anchor::text OR
    window_value->'origins' IS DISTINCT FROM expected_origins THEN
  RETURN jsonb_build_object('state','source_event_diversity_unavailable',
   'sourceEventDiversityVerified',FALSE,'distinctSourceEventCount',0);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(window_value->'origins') LOOP
  IF item->>'eligibility'<>'matching_context' THEN CONTINUE; END IF;
  eligible_count:=eligible_count+1;
  SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
   WHERE organization_id=org AND id=(item->>'runId')::uuid;
  SELECT * INTO receipt FROM public.canonical_forecast_price_ordered_receipts
   WHERE organization_id=org AND id=saved.source_receipt_id;
  SELECT * INTO activation
   FROM public.canonical_forecast_price_flow_origin_activations
   WHERE organization_id=org AND run_id=saved.id;
  prior_start:=saved.horizon_start-INTERVAL '2 days';
  prior_end:=saved.horizon_start-INTERVAL '1 day';
  IF receipt.id IS NULL OR
     activation.run_id IS NULL OR
     activation.observed_at>=saved.horizon_start OR
     activation.proof->>'savedReceiptDigest' IS DISTINCT FROM
      saved.receipt_digest OR
     receipt.captured_at>saved.saved_at OR
     pg_xact_status(receipt.xmin::text::xid8) IS DISTINCT FROM 'committed' OR
     saved.output->>'sourceSnapshotDigest' IS DISTINCT FROM
      rtrim(receipt.snapshot_digest) OR
     jsonb_typeof(receipt.decision_events)<>'array' OR
     jsonb_array_length(receipt.decision_events)>1000 THEN
   CONTINUE;
  END IF;
  -- A repeated snapshot of unchanged decisions cannot add another day.
  -- Require an immutable receipt event joined back to its source decision,
  -- pinned to a source receipt known committed before the saved origin.
  IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(receipt.decision_events) event
   JOIN public.canonical_forecast_price_decision_orders source
    ON source.organization_id=org AND
       source.decision_id::text=event->>'decisionId'
   JOIN public.canonical_estimate_decisions decision
    ON decision.organization_id=org AND decision.id=source.decision_id
   WHERE event->>'action'='approve' AND event->>'revision'='1'
    AND decision.action='approve' AND decision.revision=1
    AND event->>'digest'=decision.digest
    AND source.ordered_at=(event->>'sourceObservedAt')::timestamptz
    AND source.ordered_at>=prior_start AND source.ordered_at<prior_end
    AND pg_xact_status(source.xmin::text::xid8)='committed'
  ) THEN
   source_day:=(prior_start AT TIME ZONE 'UTC')::date;
   IF NOT source_day=ANY(source_days) THEN
    source_days:=array_append(source_days,source_day);
   END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('state','source_event_diversity_observed',
  'sourceEventDiversityVerified',eligible_count=60 AND
   cardinality(source_days)=60,
  'distinctSourceEventCount',cardinality(source_days));
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_event_diversity(
 UUID,UUID,TEXT,UUID,UUID,JSONB) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_event_diversity(
  UUID,UUID,TEXT,UUID,UUID,JSONB) TO northstar_app_runtime;
END IF; END $$;
