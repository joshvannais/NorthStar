-- Mission 26 Part 3D: complete registered selected-M24 current/candidate
-- saved-origin inventory for one fixed trailing 60 UTC-day window. This
-- inventories stored NorthStar runs only, never unsaved/off-platform work.
CREATE INDEX canonical_forecast_price_flow_zero_request_lookup
 ON public.canonical_forecast_price_flow_saved_origins
 (organization_id,request_digest,id)
 WHERE output->>'calculationVersion'='m26_price_flow_zero_baseline_v1';

CREATE FUNCTION public.canonical_forecast_price_flow_matched_population(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 base public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 candidate public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 source_receipt public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 origin_activation public.canonical_forecast_price_flow_origin_activations%ROWTYPE;
 paired JSONB; items JSONB:='[]'::jsonb;
 window_start TIMESTAMPTZ; window_end TIMESTAMPTZ;
 days INTEGER[]:=array_fill(0,ARRAY[60]); day_index INTEGER;
 stored_count INTEGER:=0; matching_count INTEGER:=0;
 excluded_count INTEGER:=0; candidate_count INTEGER:=0;
 candidate_missing INTEGER:=0; candidate_duplicate INTEGER:=0;
 paired_count INTEGER:=0; partial_count INTEGER:=0;
 missing_actual_count INTEGER:=0; unavailable_count INTEGER:=0;
 missing_days INTEGER:=0; duplicate_days INTEGER:=0;
 candidate_request TEXT; selected_candidates UUID[]:=ARRAY[]::UUID[];
 source_days DATE[]:=ARRAY[]::DATE[];
 prior_start TIMESTAMPTZ; prior_end TIMESTAMPTZ; source_day DATE;
 other_count INTEGER:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Matched algorithm population requires read committed'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO anchor FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND
   output->>'calculationVersion'='m26_price_flow_carry_forward_v1' AND
   horizon_end<=clock_timestamp()
  ORDER BY horizon_start DESC,id DESC LIMIT 1;
 IF anchor.id IS NULL THEN
  RETURN jsonb_build_object('state','matched_population_unavailable',
   'reason','no_completed_saved_origin');
 END IF;
 window_end:=anchor.horizon_end;
 window_start:=window_end-INTERVAL '60 days';
 FOR base IN
  SELECT * FROM public.canonical_forecast_price_flow_saved_origins
   WHERE organization_id=org AND horizon_start>=window_start AND
    horizon_start<window_end AND
    output->>'calculationVersion'='m26_price_flow_carry_forward_v1'
   ORDER BY horizon_start,id LIMIT 101
 LOOP
  stored_count:=stored_count+1;
  IF stored_count>100 THEN
   RETURN jsonb_build_object('state','matched_population_unavailable',
    'reason','bounded_origin_limit_exceeded');
  END IF;
  IF base.output->'target' IS DISTINCT FROM anchor.output->'target' OR
   base.output->'unit' IS DISTINCT FROM anchor.output->'unit' OR
   base.output->'applicability' IS DISTINCT FROM
    anchor.output->'applicability' THEN
   excluded_count:=excluded_count+1;
   CONTINUE;
  END IF;
  matching_count:=matching_count+1;
  day_index:=floor(extract(epoch FROM
   (base.horizon_start-window_start))/86400)::integer+1;
  IF day_index<1 OR day_index>60 OR
    base.horizon_start<>window_start+(day_index-1)*INTERVAL '1 day' THEN
   RETURN jsonb_build_object('state','matched_population_unavailable',
    'reason','horizon_alignment_unverified');
  END IF;
  days[day_index]:=days[day_index]+1;
  -- Count a distinct prior-day source event only when the frozen receipt
  -- resolves to its committed M24 first approval and the origin's separate
  -- activation observed a committed capture before the horizon. Repeated
  -- captures of unchanged source state do not create independent event days.
  SELECT * INTO source_receipt
   FROM public.canonical_forecast_price_ordered_receipts
   WHERE organization_id=org AND id=base.source_receipt_id;
  SELECT * INTO origin_activation
   FROM public.canonical_forecast_price_flow_origin_activations
   WHERE organization_id=org AND run_id=base.id;
  prior_start:=base.horizon_start-INTERVAL '2 days';
  prior_end:=base.horizon_start-INTERVAL '1 day';
  IF source_receipt.id IS NOT NULL AND origin_activation.run_id IS NOT NULL AND
     origin_activation.observed_at<base.horizon_start AND
     origin_activation.proof->>'savedReceiptDigest' IS NOT DISTINCT FROM
       base.receipt_digest AND
     source_receipt.captured_at<=base.saved_at AND
     pg_xact_status(source_receipt.xmin::text::xid8)='committed' AND
     base.output->>'sourceSnapshotDigest' IS NOT DISTINCT FROM
       rtrim(source_receipt.snapshot_digest) AND
     jsonb_typeof(source_receipt.decision_events)='array' AND
     jsonb_array_length(source_receipt.decision_events)<=1000 THEN
   IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(source_receipt.decision_events) event
    JOIN public.canonical_forecast_price_decision_orders source
     ON source.organization_id=org AND
        source.decision_id::text=event->>'decisionId'
    JOIN public.canonical_estimate_decisions decision
     ON decision.organization_id=org AND decision.id=source.decision_id
    WHERE event->>'action'='approve' AND event->>'revision'='1' AND
     decision.action='approve' AND decision.revision=1 AND
     event->>'digest'=decision.digest AND
     source.ordered_at=(event->>'sourceObservedAt')::timestamptz AND
     source.ordered_at>=prior_start AND source.ordered_at<prior_end AND
     pg_xact_status(source.xmin::text::xid8)='committed') THEN
    source_day:=(prior_start AT TIME ZONE 'UTC')::date;
    IF NOT source_day=ANY(source_days) THEN
     source_days:=array_append(source_days,source_day);
    END IF;
   END IF;
  END IF;
  candidate_request:=public.canonical_completion_digest(jsonb_build_object(
   'baseRunId',base.id,'algorithmVersion',
   'm26_price_flow_zero_baseline_v1'));
  candidate_count:=0;
  FOR candidate IN
   SELECT * FROM public.canonical_forecast_price_flow_saved_origins
    WHERE organization_id=org AND request_digest=candidate_request AND
     output->>'calculationVersion'='m26_price_flow_zero_baseline_v1'
    ORDER BY id LIMIT 2
  LOOP
   candidate_count:=candidate_count+1;
  END LOOP;
  IF candidate_count=0 THEN
   candidate_missing:=candidate_missing+1;
   items:=items||jsonb_build_array(jsonb_build_object(
    'baseRunId',base.id,'state','candidate_missing',
    'horizonStart',public.canonical_forecast_utc_instant(base.horizon_start)));
   CONTINUE;
  ELSIF candidate_count>1 THEN
   candidate_duplicate:=candidate_duplicate+1;
   items:=items||jsonb_build_array(jsonb_build_object(
    'baseRunId',base.id,'state','candidate_duplicate',
    'horizonStart',public.canonical_forecast_utc_instant(base.horizon_start)));
   CONTINUE;
  END IF;
  selected_candidates:=array_append(selected_candidates,candidate.id);
  paired:=public.canonical_forecast_price_flow_matched_algorithms(
   org,actor,role_value,session_value,base.id,candidate.id);
  IF paired->>'state' IS DISTINCT FROM 'matched_algorithms_observed' THEN
   unavailable_count:=unavailable_count+1;
  ELSIF paired->>'actualPairStatus'='paired' THEN
   paired_count:=paired_count+1;
  ELSIF paired->>'actualPairStatus'='partial' THEN
   partial_count:=partial_count+1;
  ELSIF paired->>'actualPairStatus'='missing' THEN
   missing_actual_count:=missing_actual_count+1;
  ELSE
   unavailable_count:=unavailable_count+1;
  END IF;
  items:=items||jsonb_build_array(paired);
 END LOOP;
 FOR day_index IN 1..60 LOOP
  IF days[day_index]=0 THEN missing_days:=missing_days+1; END IF;
  IF days[day_index]>1 THEN duplicate_days:=duplicate_days+1; END IF;
 END LOOP;
 -- A candidate in this window that was not selected by the exact base-run
 -- request binding cannot be silently omitted from the policy population.
 SELECT count(*) INTO other_count FROM (
  SELECT id FROM public.canonical_forecast_price_flow_saved_origins
   WHERE organization_id=org AND horizon_start>=window_start AND
    horizon_start<window_end AND
    output->>'calculationVersion'='m26_price_flow_zero_baseline_v1' AND
    NOT(id=ANY(selected_candidates))
   LIMIT 101) excess;
 IF other_count>100 THEN
  RETURN jsonb_build_object('state','matched_population_unavailable',
   'reason','bounded_candidate_limit_exceeded');
 END IF;
 RETURN jsonb_build_object('state','matched_population_observed',
  'scope','northstar_m24_registered_saved_algorithms_only',
  'windowStart',public.canonical_forecast_utc_instant(window_start),
  'windowEnd',public.canonical_forecast_utc_instant(window_end),
  'anchorRunId',anchor.id,'expectedUtcDays',60,
  'storedBaseCount',stored_count,'matchingBaseCount',matching_count,
  'excludedBaseCount',excluded_count,
  'candidateMissingCount',candidate_missing,
  'candidateDuplicateCount',candidate_duplicate,
  'orphanCandidateCount',other_count,
  'missingSavedOriginDays',missing_days,
  'duplicateSavedOriginDays',duplicate_days,
  'pairedCount',paired_count,'partialCount',partial_count,
  'missingActualCount',missing_actual_count,
  'unavailableCount',unavailable_count,
  'distinctSourceEventDays',cardinality(source_days),
  'sourceEventDiversityVerified',matching_count=60 AND
    cardinality(source_days)=60,
  'completeRegisteredPopulation',stored_count=60 AND matching_count=60 AND
   excluded_count=0 AND candidate_missing=0 AND candidate_duplicate=0 AND
   other_count=0 AND missing_days=0 AND duplicate_days=0 AND
   paired_count=60 AND unavailable_count=0,
  'unsavedOriginCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,
  'items',items);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_matched_population(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_matched_population(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
