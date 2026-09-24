-- Mission 26 Part 3C: fixed trailing sixty UTC-day registered-M24 saved-origin
-- inventory. The latest completed saved origin selects the context; callers
-- cannot choose favorable run IDs or truncate the window. This inventories
-- NorthStar saved origins only, not missing/off-platform business sources.
CREATE INDEX canonical_forecast_price_flow_origins_horizon
 ON public.canonical_forecast_price_flow_saved_origins
 (organization_id,horizon_start DESC,id DESC);

CREATE FUNCTION public.canonical_forecast_price_flow_complete_window(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 item public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 window_start TIMESTAMPTZ; window_end TIMESTAMPTZ;
 origin_rows JSONB:='[]'::jsonb;
 total_count INTEGER:=0; matching_count INTEGER:=0;
 context_matches BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Price-flow evaluation window requires read committed'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO anchor FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND
   output->'target'->>'key'='revenue.approved_price_flow' AND
   output->>'calculationVersion'='m26_price_flow_carry_forward_v1' AND
   horizon_end<=clock_timestamp()
  ORDER BY horizon_start DESC,id DESC LIMIT 1;
 IF anchor.id IS NULL THEN
  RETURN jsonb_build_object('state','complete_window_unavailable',
   'reason','no_completed_saved_origin');
 END IF;
 window_end:=anchor.horizon_end;
 window_start:=window_end-INTERVAL '60 days';
 FOR item IN
  SELECT * FROM public.canonical_forecast_price_flow_saved_origins
   WHERE organization_id=org AND horizon_start>=window_start AND
    horizon_start<window_end
   ORDER BY horizon_start,id LIMIT 101
 LOOP
  total_count:=total_count+1;
  IF total_count>100 THEN
   RETURN jsonb_build_object('state','complete_window_unavailable',
    'reason','bounded_origin_limit_exceeded');
  END IF;
  context_matches:=item.output->'target'=anchor.output->'target' AND
   item.output->'unit'=anchor.output->'unit' AND
   item.output->'applicability'=anchor.output->'applicability' AND
   item.output->>'calculationVersion'=
    anchor.output->>'calculationVersion';
  IF context_matches THEN matching_count:=matching_count+1; END IF;
  origin_rows:=origin_rows||jsonb_build_array(jsonb_build_object(
   'runId',item.id,'horizonStart',
    public.canonical_forecast_utc_instant(item.horizon_start),
   'horizonEnd',public.canonical_forecast_utc_instant(item.horizon_end),
   'eligibility',CASE WHEN context_matches THEN 'matching_context'
    ELSE 'excluded_context' END));
 END LOOP;
 RETURN jsonb_build_object('state','complete_saved_origin_window_observed',
  'scope','northstar_m24_registered_saved_origins_only',
  'anchorRunId',anchor.id,
  'windowStart',public.canonical_forecast_utc_instant(window_start),
  'windowEnd',public.canonical_forecast_utc_instant(window_end),
  'expectedUtcDays',60,'storedOriginCount',total_count,
  'matchingContextCount',matching_count,
  'excludedContextCount',total_count-matching_count,
  'unsavedOriginCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,
  'origins',origin_rows);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_complete_window(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_complete_window(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF; END $$;
