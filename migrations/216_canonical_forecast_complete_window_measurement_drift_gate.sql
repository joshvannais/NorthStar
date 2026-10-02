-- Mission 26 Part 3C additive drift-action gate correction.
-- Actionable descriptive drift is emitted only when the same evidence cohort
-- also satisfies every sample-sufficiency prerequisite. Migration 215 remains
-- immutable; this purpose-fixed replacement preserves its contract otherwise.
CREATE OR REPLACE FUNCTION public.canonical_forecast_complete_window_measurement_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value JSONB; saved public.canonical_forecast_complete_window_evaluations_v2%ROWTYPE;
 origin JSONB; run_row public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 actual_row public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 window_value JSONB; diversity JSONB; result JSONB; unsigned JSONB;
 predicted NUMERIC; actual NUMERIC; error_value NUMERIC;
 total_abs NUMERIC:=0; total_signed NUMERIC:=0; paired_count INTEGER:=0;
 reference_abs NUMERIC:=0; later_abs NUMERIC:=0;
 reference_count INTEGER:=0; later_count INTEGER:=0;
 day_counts INTEGER[]:=array_fill(0,ARRAY[60]); day_index INTEGER;
 missing_days INTEGER:=0; duplicate_days INTEGER:=0;
 max_lag INTERVAL:=INTERVAL '0'; lag_value INTERVAL;
 prediction_at TIMESTAMPTZ; source_at TIMESTAMPTZ;
 earliest_prediction_at TIMESTAMPTZ; latest_prediction_at TIMESTAMPTZ;
 earliest_source_at TIMESTAMPTZ; latest_source_at TIMESTAMPTZ;
 first_output JSONB; currency_value TEXT; sample_reason TEXT;
 sample_value JSONB; drift_value JSONB; applicability_value JSONB;
 observation_lag_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    evaluation_value IS NULL THEN
  RAISE EXCEPTION 'Complete-window measurement request invalid' USING ERRCODE='22023';
 END IF;
 current_value:=public.canonical_forecast_complete_window_evaluation_v2_read(
  org,actor,role_value,session_value,evaluation_value);
 IF current_value->>'state'='complete_window_evaluation_stale' THEN
  RETURN jsonb_build_object('state','complete_window_measurement_stale',
   'evaluationId',evaluation_value,'reason',current_value->>'reason',
   'restartRequired',TRUE,'realAccuracyAvailable',FALSE,
   'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
 END IF;
 IF current_value->>'state'<>'complete_window_evaluation_available' THEN
  RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
   'reason',COALESCE(current_value->>'reason','evaluation_not_found'),
   'realAccuracyAvailable',FALSE,'calibrationAvailable',FALSE,
   'realForecastEligible',FALSE);
 END IF;
 SELECT * INTO saved FROM public.canonical_forecast_complete_window_evaluations_v2
  WHERE organization_id=org AND id=evaluation_value;
 IF saved.id IS NULL OR saved.evidence_digest IS DISTINCT FROM
    public.canonical_completion_digest(saved.evidence) OR
    saved.evidence->>'version' IS DISTINCT FROM
     'm26-complete-window-evaluation-v2' OR
    saved.evidence->>'algorithmVersion' IS DISTINCT FROM
     'm26-rolling-backtest-v1' OR
    jsonb_typeof(saved.evidence->'origins') IS DISTINCT FROM 'array' OR
    jsonb_array_length(saved.evidence->'origins') NOT BETWEEN 1 AND 100 THEN
  RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
   'reason','evaluation_receipt_invalid','realAccuracyAvailable',FALSE,
   'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
 END IF;
 window_value:=public.canonical_forecast_price_flow_complete_window(
  org,actor,role_value,session_value);
 IF window_value->>'state'<>'complete_saved_origin_window_observed' OR
    window_value->>'anchorRunId' IS DISTINCT FROM saved.anchor_run_id::text OR
    public.canonical_completion_digest(window_value) IS DISTINCT FROM
     saved.evidence->>'originInventoryDigest' THEN
  RETURN jsonb_build_object('state','complete_window_measurement_stale',
   'evaluationId',saved.id,'reason','origin_inventory_changed',
   'restartRequired',TRUE,'realAccuracyAvailable',FALSE,
   'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
 END IF;
 diversity:=public.canonical_forecast_price_flow_event_diversity(
  org,actor,role_value,session_value,saved.anchor_run_id,window_value->'origins');
 FOR origin IN SELECT value FROM jsonb_array_elements(saved.evidence->'origins') LOOP
  IF origin->>'eligibility'='matching_context' THEN
   day_index:=floor(extract(epoch FROM
    ((origin->>'horizonStart')::timestamptz-saved.window_start))/86400)::integer+1;
   IF day_index NOT BETWEEN 1 AND 60 THEN
    RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
     'reason','evaluation_horizon_invalid','realAccuracyAvailable',FALSE,
     'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
   END IF;
   day_counts[day_index]:=day_counts[day_index]+1;
   SELECT * INTO run_row FROM public.canonical_forecast_price_flow_saved_origins
    WHERE organization_id=org AND id=(origin->>'runId')::uuid;
   IF run_row.id IS NULL OR
      public.canonical_completion_digest(run_row.output) IS DISTINCT FROM
       origin->>'forecastOutputDigest' OR
      run_row.output->'target' IS DISTINCT FROM origin->'target' OR
      run_row.output->'unit' IS DISTINCT FROM origin->'unit' OR
      run_row.output->'applicability' IS DISTINCT FROM origin->'applicability' OR
      run_row.output->>'calculationVersion' IS DISTINCT FROM
       origin->>'calculationVersion' THEN
    RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
     'reason','forecast_context_invalid','realAccuracyAvailable',FALSE,
     'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
   END IF;
   IF run_row.output->'target' IS DISTINCT FROM jsonb_build_object(
      'key','revenue.approved_price_flow','definitionVersion','v1') OR
      jsonb_typeof(run_row.output->'unit') IS DISTINCT FROM 'object' OR
      run_row.output->'unit' IS DISTINCT FROM jsonb_build_object(
       'key','money','currency',run_row.output->'unit'->>'currency') OR
      run_row.output->'unit'->>'key' IS DISTINCT FROM 'money' OR
      jsonb_typeof(run_row.output->'unit'->'currency') IS DISTINCT FROM
       'string' OR
      btrim(run_row.output->'unit'->>'currency')='' OR
      run_row.output->'applicability' IS DISTINCT FROM jsonb_build_object(
       'serviceKey',NULL,'areaKey',NULL,'limits',jsonb_build_array(
        'northstar_m24_only','uncalibrated_carry_forward')) OR
      jsonb_typeof(run_row.output->'horizon') IS DISTINCT FROM 'object' OR
      run_row.output->'horizon' IS DISTINCT FROM jsonb_build_object(
       'startsAt',run_row.output->'horizon'->>'startsAt','endsAt',
       run_row.output->'horizon'->>'endsAt','grain','day') OR
      jsonb_typeof(run_row.output->'horizon'->'startsAt') IS DISTINCT FROM
       'string' OR
      jsonb_typeof(run_row.output->'horizon'->'endsAt') IS DISTINCT FROM
       'string' OR
      run_row.output->'horizon'->>'grain' IS DISTINCT FROM 'day' OR
      run_row.output->>'calculationVersion' IS DISTINCT FROM
       'm26_price_flow_carry_forward_v1' OR
      jsonb_typeof(origin->'predictionAsOf') IS DISTINCT FROM 'string' OR
      jsonb_typeof(origin->'sourceSnapshotAsOf') IS DISTINCT FROM 'string' THEN
    RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
     'reason','forecast_context_invalid','realAccuracyAvailable',FALSE,
     'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
   END IF;
   IF
      (run_row.output->'horizon'->>'startsAt')::timestamptz IS DISTINCT FROM
       (origin->>'horizonStart')::timestamptz OR
      (run_row.output->'horizon'->>'endsAt')::timestamptz IS DISTINCT FROM
       (origin->>'horizonEnd')::timestamptz THEN
    RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
     'reason','forecast_context_invalid','realAccuracyAvailable',FALSE,
     'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
   END IF;
   IF first_output IS NULL THEN
    first_output:=run_row.output;
    currency_value:=run_row.output->'unit'->>'currency';
   ELSIF run_row.output->'target' IS DISTINCT FROM first_output->'target' OR
         run_row.output->'unit' IS DISTINCT FROM first_output->'unit' OR
         run_row.output->'applicability' IS DISTINCT FROM
          first_output->'applicability' OR
         run_row.output->'horizon'->>'grain' IS DISTINCT FROM
          first_output->'horizon'->>'grain' OR
         run_row.output->>'calculationVersion' IS DISTINCT FROM
          first_output->>'calculationVersion' THEN
    RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
     'reason','evaluation_context_changed','realAccuracyAvailable',FALSE,
     'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
   END IF;
   prediction_at:=(origin->>'predictionAsOf')::timestamptz;
   source_at:=(origin->>'sourceSnapshotAsOf')::timestamptz;
   earliest_prediction_at:=LEAST(earliest_prediction_at,prediction_at);
   latest_prediction_at:=GREATEST(latest_prediction_at,prediction_at);
   earliest_source_at:=LEAST(earliest_source_at,source_at);
   latest_source_at:=GREATEST(latest_source_at,source_at);
  END IF;
  IF origin->>'state'<>'paired' THEN CONTINUE; END IF;
  SELECT * INTO actual_row FROM public.canonical_forecast_price_flow_actual_receipts
   WHERE organization_id=org AND id=(origin->>'outcomeReceiptId')::uuid
    AND run_id=(origin->>'runId')::uuid;
  IF actual_row.id IS NULL OR actual_row.state<>'known' OR
     actual_row.receipt_digest IS DISTINCT FROM origin->>'outcomeReceiptDigest' OR
     run_row.output->'value'->>'kind'<>'point' OR
     run_row.output->'value'->>'amount' IS NULL THEN
   RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
    'reason','paired_evidence_invalid','realAccuracyAvailable',FALSE,
    'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
  END IF;
  predicted:=(run_row.output->'value'->>'amount')::numeric;
  actual:=actual_row.amount;
  IF predicted IS NULL OR actual IS NULL THEN
   RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
    'reason','paired_value_unavailable','realAccuracyAvailable',FALSE,
    'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
  END IF;
  error_value:=predicted-actual;
  total_abs:=total_abs+abs(error_value);
  total_signed:=total_signed+error_value;
  paired_count:=paired_count+1;
  lag_value:=actual_row.observed_through-(origin->>'horizonEnd')::timestamptz;
  IF lag_value<INTERVAL '0' THEN
   RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
    'reason','outcome_cutoff_invalid','realAccuracyAvailable',FALSE,
    'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
  END IF;
  IF lag_value>max_lag THEN max_lag:=lag_value; END IF;
  IF (origin->>'horizonStart')::timestamptz<saved.window_start+INTERVAL '30 days' THEN
   reference_abs:=reference_abs+abs(error_value); reference_count:=reference_count+1;
  ELSE
   later_abs:=later_abs+abs(error_value); later_count:=later_count+1;
  END IF;
 END LOOP;
 FOR day_index IN 1..60 LOOP
  IF day_counts[day_index]=0 THEN missing_days:=missing_days+1; END IF;
  IF day_counts[day_index]>1 THEN duplicate_days:=duplicate_days+1; END IF;
 END LOOP;
 sample_reason:=CASE
  WHEN missing_days>0 THEN 'saved_origin_days_missing'
  WHEN duplicate_days>0 THEN 'duplicate_daily_origins'
  WHEN (saved.evidence->>'excludedContextCount')::integer>0 THEN 'source_context_changed'
  WHEN paired_count<>60 THEN 'finalized_outcomes_incomplete'
  WHEN diversity->>'sourceEventDiversityVerified'<>'true' OR
       (diversity->>'distinctSourceEventCount')::integer<>60 THEN
       'source_event_diversity_unverified'
  WHEN max_lag>INTERVAL '60 days' THEN 'source_observation_lag_unverified'
  ELSE NULL END;
 sample_value:=CASE WHEN sample_reason IS NULL THEN jsonb_build_object(
  'state','supported_source_descriptive_only',
  'policyVersion','m26-selected-m24-daily-source-review-v2',
  'distinctSourceEventDays',60,'realAccuracyAvailable',FALSE)
 ELSE jsonb_build_object('state','unavailable','reason',sample_reason,
  'policyVersion','m26-selected-m24-daily-source-review-v2') END;
 drift_value:=CASE
  WHEN sample_reason IS NULL AND reference_count=30 AND later_count=30 THEN
   jsonb_build_object(
    'state','descriptive_only','direction',CASE
     WHEN later_abs/later_count>reference_abs/reference_count THEN 'higher_error'
     WHEN later_abs/later_count<reference_abs/reference_count THEN 'lower_error'
     ELSE 'unchanged_error' END,
    'reviewedRule','any_later_absolute_error_increase',
    'reviewAction',CASE WHEN later_abs/later_count>reference_abs/reference_count
     THEN 'human_review_required' ELSE 'no_change_required' END,
    'empiricalDriftVerdictAvailable',FALSE)
  WHEN sample_reason IS NOT NULL THEN jsonb_build_object(
   'state','unavailable','reason',sample_reason,
   'empiricalDriftVerdictAvailable',FALSE)
  ELSE jsonb_build_object('state','unavailable',
   'reason','comparable_reference_and_later_windows_incomplete',
   'empiricalDriftVerdictAvailable',FALSE) END;
 applicability_value:=CASE WHEN first_output IS NULL THEN jsonb_build_object(
  'state','unavailable','reason','no_matching_forecast_context',
  'wholeBusinessCoverageVerified',FALSE)
 ELSE jsonb_build_object('state','supported_source_only',
  'target',first_output->'target','unit',first_output->'unit',
  'sourceApplicability',first_output->'applicability',
  'algorithmVersion',saved.evidence->>'algorithmVersion',
  'calculationVersion',first_output->>'calculationVersion',
  'horizon',jsonb_build_object('grain',first_output->'horizon'->>'grain',
   'windowStart',public.canonical_forecast_utc_instant(saved.window_start),
   'windowEnd',public.canonical_forecast_utc_instant(saved.window_end),
   'expectedUtcDays',60),
  'dataRecency',jsonb_build_object('state','descriptive_only',
   'earliestPredictionAsOf',public.canonical_forecast_utc_instant(
    earliest_prediction_at),
   'latestPredictionAsOf',public.canonical_forecast_utc_instant(
    latest_prediction_at),
   'earliestSourceSnapshotAsOf',public.canonical_forecast_utc_instant(
    earliest_source_at),
   'latestSourceSnapshotAsOf',public.canonical_forecast_utc_instant(
    latest_source_at)),
  'excludedConditions',jsonb_build_object('contextChangedCount',
   (saved.evidence->>'excludedContextCount')::integer,'missingOutcomeCount',
   (saved.evidence->>'missingCount')::integer,'revokedOutcomeCount',
   (saved.evidence->>'revokedCount')::integer,'excludedOutcomeCount',
   (saved.evidence->>'excludedCount')::integer,
   'unsavedOriginCoverageVerified',FALSE,'providerCoverageVerified',FALSE,
   'wholeBusinessCoverageVerified',FALSE)) END;
 observation_lag_value:=CASE WHEN paired_count=0 THEN jsonb_build_object(
  'state','unavailable','reason','no_paired_actuals',
  'actualCommitLagVerified',FALSE)
 ELSE jsonb_build_object('state','descriptive_only','policyMaxUtcDays',60,
  'maximumObservedUtcDays',ceil(extract(epoch FROM max_lag)/86400)::integer,
  'actualCommitLagVerified',FALSE) END;
 unsigned:=jsonb_build_object('version','m26-complete-window-measurement-v2',
  'evaluationId',saved.id,'evaluationRevision',saved.revision,
  'evaluationDigest',saved.evidence_digest,
  'scope','northstar_m24_registered_saved_origins_only',
  'applicability',applicability_value,
  'denominator',jsonb_build_object('storedOriginCount',
   (saved.evidence->>'storedOriginCount')::integer,'matchingContextCount',
   (saved.evidence->>'matchingContextCount')::integer,'excludedContextCount',
   (saved.evidence->>'excludedContextCount')::integer,'pairedCount',paired_count,
   'missingCount',(saved.evidence->>'missingCount')::integer,'revokedCount',
   (saved.evidence->>'revokedCount')::integer,'excludedCount',
   (saved.evidence->>'excludedCount')::integer,'unsavedOriginCoverageVerified',FALSE),
  'descriptiveError',CASE WHEN paired_count=0 THEN jsonb_build_object(
   'state','unavailable','reason','no_paired_actuals','pairedCount',0,
   'totalAbsolute',NULL,'meanAbsolute',NULL,'meanSigned',NULL)
  ELSE jsonb_build_object('state','descriptive_only','reason',NULL,
   'pairedCount',paired_count,'unit','money','currency',currency_value,
   'totalAbsolute',total_abs::text,'meanAbsolute',round(total_abs/paired_count,6)::text,
   'meanSigned',round(total_signed/paired_count,6)::text) END,
  'intervalCoverage',jsonb_build_object('state','not_applicable',
   'reason','point_only_target','calibratedIntervalCount',0),
  'observationLag',observation_lag_value,
  'sampleSufficiency',sample_value,'calibration',jsonb_build_object(
   'state','unavailable','reason','point_only_no_nominal_interval'),
  'drift',drift_value,'realAccuracyAvailable',FALSE,
  'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
 result:=unsigned||jsonb_build_object('digest',public.canonical_completion_digest(unsigned));
 RETURN jsonb_build_object('state','complete_window_measurement_available',
  'measurement',result);
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation OR
               division_by_zero THEN
 RETURN jsonb_build_object('state','complete_window_measurement_unavailable',
  'reason','measurement_value_invalid','realAccuracyAvailable',FALSE,
  'calibrationAvailable',FALSE,'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_measurement_v2(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_measurement_v2(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
