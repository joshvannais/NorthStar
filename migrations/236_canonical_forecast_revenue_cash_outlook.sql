-- Mission 26 founder Part 3: minimized revenue and cash outlook read.
-- This migration creates no invoice, payment, collection or accounting authority.

CREATE FUNCTION public.canonical_forecast_revenue_cash_outlook_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE newest UUID; newest_after UUID; baseline JSONB; policy JSONB;
 newest_origin UUID;origin_read JSONB;
 saved_origin public.canonical_forecast_pipeline_scenario_origins%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
 planning_value JSONB;approved_count INTEGER;preliminary_count INTEGER;
 approved_amount TEXT;preliminary_amount TEXT;snapshot_mode TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for revenue and cash outlook'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 -- Preserve the complete Part 6B lock order before choosing the newest Part 6A
 -- position. Re-entrant calls below retain the same transaction-scoped locks.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-policy:'||org::text,0)) THEN
  RAISE EXCEPTION 'Revenue and cash outlook is busy' USING ERRCODE='55P03';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);

 SELECT id INTO newest
 FROM public.canonical_forecast_integrated_commercial_positions
 WHERE organization_id=org ORDER BY captured_at DESC,id DESC LIMIT 1;
 IF newest IS NULL THEN
  PERFORM public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,NULL,FALSE);
  RETURN jsonb_build_object(
   'version','m26-revenue-cash-outlook-v1','state','unavailable',
   'reason','commercial_baseline_unavailable','fictional',FALSE,
   'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
   'currency',NULL,'scope',jsonb_build_object(
    'label','Current supported NorthStar commercial records',
    'wholeBusinessCoverageVerified',FALSE),
   'authorizedEstimate',jsonb_build_object('state','unavailable','amountBeforeTax',NULL),
   'approvedPrice',jsonb_build_object('state','unavailable','amountBeforeTax',NULL),
   'bookedWork',jsonb_build_object('state','unavailable','amountBeforeTax',NULL,'classification','committed'),
   'planning',jsonb_build_object('state','unavailable',
    'reason','current_pipeline_snapshot_unavailable','snapshotMode',NULL,
    'capturedAt',NULL,'horizonStartsAt',NULL,'horizonEndsAt',NULL,
    'approvedNotBooked',jsonb_build_object('state','unavailable','count',NULL,
     'amountBeforeTax',NULL,'committed',FALSE),
    'preliminaryEstimate',jsonb_build_object('state','unavailable','count',NULL,
     'amountBeforeTax',NULL,'committed',FALSE),
    'weightsWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
    'probability',jsonb_build_object('state','unavailable',
     'reason','calibrated_probability_authority_unavailable'),
    'forecastIssued',FALSE),
   'earnedRevenue',jsonb_build_object('state','unavailable','amount',NULL,
    'reason','recognition_authority_unavailable'),
   'cashTiming',jsonb_build_object('state','unavailable','amount',NULL,
    'reason','financial_period_coverage_unavailable'),
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 END IF;

 baseline:=public.canonical_forecast_integrated_commercial_position_read(
  org,actor,role_value,session_value,newest);
 SELECT id INTO newest_after
 FROM public.canonical_forecast_integrated_commercial_positions
 WHERE organization_id=org ORDER BY captured_at DESC,id DESC LIMIT 1;
 IF newest_after IS DISTINCT FROM newest OR
   baseline->>'state' IS DISTINCT FROM 'northstar_integrated_commercial_baseline' OR
   baseline->'sourceCurrent' IS DISTINCT FROM 'true'::jsonb OR
   baseline->'currentAtRead' IS DISTINCT FROM 'true'::jsonb THEN
  PERFORM public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,NULL,FALSE);
  RETURN jsonb_build_object(
   'version','m26-revenue-cash-outlook-v1','state','unavailable',
   'reason','commercial_baseline_not_current','fictional',FALSE,
   'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
   'currency',NULL,'scope',jsonb_build_object(
    'label','Current supported NorthStar commercial records',
    'wholeBusinessCoverageVerified',FALSE),
   'authorizedEstimate',jsonb_build_object('state','unavailable','amountBeforeTax',NULL),
   'approvedPrice',jsonb_build_object('state','unavailable','amountBeforeTax',NULL),
   'bookedWork',jsonb_build_object('state','unavailable','amountBeforeTax',NULL,'classification','committed'),
   'planning',jsonb_build_object('state','unavailable',
    'reason','current_pipeline_snapshot_unavailable','snapshotMode',NULL,
    'capturedAt',NULL,'horizonStartsAt',NULL,'horizonEndsAt',NULL,
    'approvedNotBooked',jsonb_build_object('state','unavailable','count',NULL,
     'amountBeforeTax',NULL,'committed',FALSE),
    'preliminaryEstimate',jsonb_build_object('state','unavailable','count',NULL,
     'amountBeforeTax',NULL,'committed',FALSE),
    'weightsWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
    'probability',jsonb_build_object('state','unavailable',
     'reason','calibrated_probability_authority_unavailable'),
    'forecastIssued',FALSE),
   'earnedRevenue',jsonb_build_object('state','unavailable','amount',NULL,
    'reason','recognition_authority_unavailable'),
   'cashTiming',jsonb_build_object('state','unavailable','amount',NULL,
    'reason','financial_period_coverage_unavailable'),
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 IF (baseline->>'currency'~'^[A-Z]{3}$') IS NOT TRUE OR
   (baseline->>'asOf'~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$') IS NOT TRUE OR
   (baseline->>'authorizedEstimateBeforeTax'~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$') IS NOT TRUE OR
   (baseline->>'approvedPriceBeforeTax'~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$') IS NOT TRUE OR
   (baseline->>'bookedWorkBeforeTax'~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$') IS NOT TRUE THEN
  RAISE EXCEPTION 'Integrated commercial baseline projection invalid'
   USING ERRCODE='23514';
 END IF;

 policy:=public.canonical_forecast_pipeline_scenario_policy_read(
  org,actor,role_value,session_value);
 planning_value:=jsonb_build_object('state','unavailable',
  'reason','current_pipeline_snapshot_unavailable','snapshotMode',NULL,
  'capturedAt',NULL,'horizonStartsAt',NULL,'horizonEndsAt',NULL,
  'approvedNotBooked',jsonb_build_object('state','unavailable','count',NULL,
   'amountBeforeTax',NULL,'committed',FALSE),
  'preliminaryEstimate',jsonb_build_object('state','unavailable','count',NULL,
   'amountBeforeTax',NULL,'committed',FALSE),
  'weightsWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
  'probability',jsonb_build_object('state','unavailable',
   'reason','calibrated_probability_authority_unavailable'),
  'forecastIssued',FALSE);
 IF policy->>'state'='pipeline_scenario_policy_current' AND
   policy->>'action'='approve' THEN
  SELECT id INTO newest_origin
  FROM public.canonical_forecast_pipeline_scenario_origins
  WHERE organization_id=org ORDER BY captured_at DESC,id DESC LIMIT 1;
  IF newest_origin IS NOT NULL THEN
   origin_read:=public.canonical_forecast_pipeline_scenario_origin_read(
    org,actor,role_value,session_value,newest_origin);
   SELECT * INTO saved_origin
   FROM public.canonical_forecast_pipeline_scenario_origins
   WHERE organization_id=org AND id=newest_origin;
   SELECT * INTO method_row
   FROM public.canonical_forecast_pipeline_scenario_method_registration
   WHERE version=saved_origin.method_version;
   IF origin_read->>'state'='pipeline_scenario_origin_current' AND
     saved_origin.id IS NOT NULL AND
     saved_origin.currency IS NOT DISTINCT FROM baseline->>'currency' AND
     rtrim(saved_origin.evidence_digest)=
      public.canonical_completion_digest(saved_origin.evidence) AND
     rtrim(saved_origin.output_digest)=
      public.canonical_completion_digest(saved_origin.private_output) AND
     rtrim(saved_origin.canonical_digest)=public.canonical_completion_digest(
      jsonb_build_object('evidence',saved_origin.evidence,
       'privateOutput',saved_origin.private_output)) AND
     method_row.version IS NOT NULL AND
     rtrim(saved_origin.method_closure_digest)=
      rtrim(method_row.dependency_closure_digest) AND
     rtrim(method_row.dependency_closure_digest)=
      public.canonical_forecast_pipeline_scenario_method_closure_digest() AND
     jsonb_typeof(saved_origin.evidence->'members')='array' AND
     jsonb_array_length(saved_origin.evidence->'members')<=256 AND
     public.canonical_forecast_pipeline_scenario_origin_input_current(
      org,saved_origin) THEN
    SELECT count(*) FILTER(WHERE member->>'category'='approved_unbooked'),
     count(*) FILTER(WHERE member->>'category'='preliminary_estimate'),
     to_char(COALESCE(sum((member->>'priceBeforeTax')::numeric)
      FILTER(WHERE member->>'category'='approved_unbooked'),0),
      'FM999999999999999990.00'),
     to_char(COALESCE(sum((member->>'priceBeforeTax')::numeric)
      FILTER(WHERE member->>'category'='preliminary_estimate'),0),
      'FM999999999999999990.00')
    INTO approved_count,preliminary_count,approved_amount,preliminary_amount
    FROM jsonb_array_elements(saved_origin.evidence->'members') member
    WHERE member->>'category' IN ('approved_unbooked','preliminary_estimate')
     AND member->>'priceBeforeTax'~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$';
    IF approved_count+preliminary_count=
       jsonb_array_length(saved_origin.evidence->'members') THEN
     snapshot_mode:=CASE WHEN origin_read->'captureInputsCurrentAtRead'='true'::jsonb
      THEN 'current_at_read' ELSE 'frozen_at_capture' END;
     planning_value:=jsonb_build_object('state','current','reason',NULL,
      'snapshotMode',snapshot_mode,
      'capturedAt',public.canonical_forecast_utc_instant(saved_origin.captured_at),
      'horizonStartsAt',public.canonical_forecast_utc_instant(saved_origin.horizon_starts_at),
      'horizonEndsAt',public.canonical_forecast_utc_instant(saved_origin.horizon_ends_at),
      'approvedNotBooked',jsonb_build_object('state','current','count',approved_count,
       'amountBeforeTax',approved_amount,'committed',FALSE),
      'preliminaryEstimate',jsonb_build_object('state','current','count',preliminary_count,
       'amountBeforeTax',preliminary_amount,'committed',FALSE),
      'weightsWithheld',TRUE,'weightsAreScenarioAssumptions',TRUE,
      'probability',jsonb_build_object('state','unavailable',
       'reason','calibrated_probability_authority_unavailable'),
      'forecastIssued',FALSE);
    END IF;
   END IF;
  END IF;
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-revenue-cash-outlook-v1','state','current','reason',NULL,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
  'currency',baseline->>'currency',
  'scope',jsonb_build_object(
   'label','Current supported NorthStar commercial records',
   'wholeBusinessCoverageVerified',FALSE),
  'authorizedEstimate',jsonb_build_object('state','current',
   'amountBeforeTax',baseline->>'authorizedEstimateBeforeTax'),
  'approvedPrice',jsonb_build_object('state','current',
   'amountBeforeTax',baseline->>'approvedPriceBeforeTax'),
  'bookedWork',jsonb_build_object('state','current',
   'amountBeforeTax',baseline->>'bookedWorkBeforeTax','classification','committed'),
  'planning',planning_value,
  'earnedRevenue',jsonb_build_object('state','unavailable','amount',NULL,
   'reason','recognition_authority_unavailable'),
  'cashTiming',jsonb_build_object('state','unavailable','amount',NULL,
   'reason','financial_period_coverage_unavailable'),
  'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_revenue_cash_outlook_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ DECLARE runtime_role TEXT:='northstar_app_runtime'; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format(
   'GRANT EXECUTE ON FUNCTION public.canonical_forecast_revenue_cash_outlook_current(uuid,uuid,text,uuid) TO %I',
   runtime_role);
 END IF;
END $$;
