-- Mission 26 Part 7A: bounded next-30-day planned labor-cost forecast.
-- This read composes the released authenticated booking/person-plan and
-- declared-capacity authorities. It never claims payroll, realized attendance,
-- whole-business coverage, probability, a calibrated range, or automatic action.

CREATE FUNCTION public.canonical_forecast_labor_cost_v1_unavailable(
 reason_value TEXT,cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m26-labor-cost-forecast-v1','state','unavailable','reason',reason_value,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
  'currency',NULL,'horizon',jsonb_build_object(
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object(
   'label','Next 30 days of authenticated NorthStar scheduled backlog',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'work',jsonb_build_object('state','unavailable','scheduledCount',NULL,
   'unscheduledCount',NULL,'outsideWindowCount',NULL),
  'plannedLabor',jsonb_build_object('state','unavailable','coveredCount',NULL,
   'personHours',NULL,'cost',NULL,'reason',reason_value),
  'rateAuthority',jsonb_build_object('state','unavailable',
   'basis','owner_saved_m24_labor_plan_rates','payrollVerified',FALSE,
   'reason',reason_value),
  'capacity',jsonb_build_object('state','unavailable','declaredRole',NULL,
   'realizedAttendanceVerified',FALSE,
   'jobSpecificConstraintCompositionAvailable',FALSE,'reason',reason_value),
  'learnedOutcomes',jsonb_build_object('state','unavailable',
   'applicableServiceCount',NULL,'applied',FALSE,'reason',reason_value),
  'forecastIssued',FALSE,'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,
  'automaticActionAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_labor_cost_v1_plan_result(
 inputs_value JSONB,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE line_value JSONB;source_value JSONB;source_name TEXT;
 hours_value NUMERIC;rate_value NUMERIC;burden_value NUMERIC;
 total_hours NUMERIC:=0;total_cost NUMERIC:=0;line_cost NUMERIC;
 last_day DATE:=(end_value-INTERVAL '1 microsecond')::date;
BEGIN
 PERFORM public.canonical_labor_plan_validate(inputs_value);
 IF end_value<=start_value THEN
  RETURN jsonb_build_object('state','unavailable','reason','period_attribution_unavailable');
 END IF;
 FOR line_value IN SELECT value FROM jsonb_array_elements(inputs_value->'lines') LOOP
  IF line_value->>'basis'='worker_hours' THEN
   hours_value:=(line_value->>'workerHours')::numeric;
  ELSIF line_value->>'basis'='people_time' THEN
   hours_value:=(line_value->>'elapsedHours')::numeric*(line_value->>'people')::numeric;
  ELSE
   hours_value:=(line_value->>'quantity')::numeric*(line_value->>'hoursPerUnit')::numeric;
  END IF;
  IF line_value->'hourlyCost'='null'::jsonb OR
     (line_value->>'rateMode'='base_burden' AND line_value->'burdenPercent'='null'::jsonb) THEN
   RETURN jsonb_build_object('state','unavailable','reason','authorized_rate_or_burden_unavailable');
  END IF;
  FOREACH source_name IN ARRAY ARRAY['quantitySource','rateSource'] LOOP
   source_value:=line_value->source_name;
   IF source_value->>'effectiveOn' IS NULL OR source_value->>'endsOn' IS NULL OR
      btrim(COALESCE(source_value->>'geography',''))='' OR
      (source_value->>'effectiveOn')::date>start_value::date OR
      (source_value->>'endsOn')::date<last_day THEN
    RETURN jsonb_build_object('state','unavailable','reason','rate_or_work_source_applicability_unavailable');
   END IF;
  END LOOP;
  rate_value:=(line_value->>'hourlyCost')::numeric;
  burden_value:=CASE WHEN line_value->>'rateMode'='all_in' THEN 0
   ELSE (line_value->>'burdenPercent')::numeric END;
  line_cost:=round(hours_value*rate_value*(1+burden_value/100),2);
  total_hours:=total_hours+hours_value;total_cost:=total_cost+line_cost;
  IF total_hours>99999999999999.999999 OR total_cost>999999999999999.99 THEN
   RAISE EXCEPTION 'Labor forecast amount exceeds bound' USING ERRCODE='22023';
  END IF;
 END LOOP;
 RETURN jsonb_build_object('state','current','reason',NULL,
  'personMinutes',round(total_hours*60,6),
  'personHours',to_char(round(total_hours,6),'FM999999999999990.000000'),
  'cost',to_char(total_cost,'FM999999999999990.00'));
END $$;

CREATE FUNCTION public.canonical_forecast_labor_cost_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;cutoff_value TIMESTAMPTZ;horizon_value TIMESTAMPTZ;
 currency_value TEXT;capacity_value JSONB;position_count INTEGER;
 scheduled_count INTEGER:=0;unscheduled_count INTEGER:=0;outside_count INTEGER:=0;
 covered_count INTEGER:=0;applicable_service_count INTEGER:=0;
 total_minutes NUMERIC:=0;total_cost NUMERIC:=0;commitment_minutes NUMERIC;
 candidate RECORD;review_value public.canonical_forecast_current_backlog_person_plan_reviews%ROWTYPE;
 plan_value public.canonical_labor_plans%ROWTYPE;plan_result JSONB;learning_state TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for labor-cost forecast' USING ERRCODE='25001';
 END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(
  org,actor,role_value,session_value,NULL,FALSE);
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
 horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Labor-cost forecast is busy' USING ERRCODE='55P03';
 END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT profile.raw_profile#>>'{company,currency}' INTO currency_value
 FROM public.canonical_business_profiles profile
 WHERE profile.organization_id=org AND profile.is_active=TRUE
 ORDER BY profile.version_number DESC,profile.id DESC LIMIT 1 FOR SHARE;
 IF currency_value IS NULL OR currency_value!~'^[A-Z]{3}$' THEN
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
   org,actor,role_value,session_value,NULL,FALSE);
  RETURN public.canonical_forecast_labor_cost_v1_unavailable(
   'reporting_currency_unavailable',cutoff_value,horizon_value);
 END IF;
 SELECT count(*)::integer INTO position_count
 FROM public.canonical_forecast_current_backlog_booking_positions position_value
 WHERE position_value.organization_id=org AND position_value.active;
 IF position_count>500 THEN
  RAISE EXCEPTION 'Scheduled backlog exceeds bound' USING ERRCODE='54000';
 END IF;
 BEGIN
  capacity_value:=public.canonical_forecast_workload_capacity_v1_capacity_evidence(
   org,cutoff_value,horizon_value,cutoff_value);
 EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
   org,actor,role_value,session_value,NULL,FALSE);
  RETURN public.canonical_forecast_labor_cost_v1_unavailable(
   'declared_capacity_evidence_unavailable',cutoff_value,horizon_value);
 END;
 FOR candidate IN
  SELECT position_value.appointment_id,assignment.id assignment_id,
   assignment.schedule_state,assignment.scheduled_start,assignment.scheduled_end
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=position_value.organization_id
    AND assignment.id=position_value.assignment_id
    AND assignment.appointment_id=position_value.appointment_id
  WHERE position_value.organization_id=org AND position_value.active
  ORDER BY position_value.appointment_id
 LOOP
  IF candidate.schedule_state='unscheduled' THEN
   unscheduled_count:=unscheduled_count+1;CONTINUE;
  END IF;
  IF (candidate.scheduled_start<cutoff_value AND candidate.scheduled_end>cutoff_value) OR
     (candidate.scheduled_start<horizon_value AND candidate.scheduled_end>horizon_value) THEN
   authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_labor_cost_v1_unavailable(
    'period_attribution_unavailable',cutoff_value,horizon_value);
  END IF;
  IF candidate.scheduled_start<cutoff_value OR candidate.scheduled_end>horizon_value THEN
   outside_count:=outside_count+1;CONTINUE;
  END IF;
  scheduled_count:=scheduled_count+1;
  SELECT * INTO review_value
  FROM public.canonical_forecast_current_backlog_person_plan_reviews value
  WHERE value.organization_id=org AND value.appointment_id=candidate.appointment_id
  ORDER BY value.revision DESC LIMIT 1;
  IF review_value.id IS NULL OR review_value.action<>'approve' OR
     public.canonical_forecast_backlog_person_plan_stale(review_value) THEN
   authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_labor_cost_v1_unavailable(
    'current_adopted_labor_plan_unavailable',cutoff_value,horizon_value);
  END IF;
  SELECT * INTO plan_value FROM public.canonical_labor_plans value
  WHERE value.organization_id=org AND value.estimate_id=review_value.estimate_id
   AND value.id=review_value.labor_plan_id;
  IF plan_value.id IS NULL OR plan_value.action<>'save' OR
     plan_value.currency<>currency_value THEN
   authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_labor_cost_v1_unavailable(
    'current_adopted_labor_plan_unavailable',cutoff_value,horizon_value);
  END IF;
  plan_result:=public.canonical_forecast_labor_cost_v1_plan_result(
   plan_value.inputs,candidate.scheduled_start,candidate.scheduled_end);
  IF plan_result->>'state'<>'current' OR
     (plan_result->>'personMinutes')::numeric<>review_value.planned_person_minutes THEN
   authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_labor_cost_v1_unavailable(
    COALESCE(plan_result->>'reason','current_adopted_labor_plan_unavailable'),
    cutoff_value,horizon_value);
  END IF;
  SELECT COALESCE(sum(EXTRACT(EPOCH FROM((commitment->>'end')::timestamptz-
    (commitment->>'start')::timestamptz))/60),0)
  INTO commitment_minutes
  FROM jsonb_array_elements(capacity_value->'rows') capacity_row
  CROSS JOIN LATERAL jsonb_array_elements(capacity_row->'commitments') commitment
  WHERE (commitment->>'assignmentId')::uuid=candidate.assignment_id;
  IF commitment_minutes IS NULL OR commitment_minutes<(plan_result->>'personMinutes')::numeric THEN
   authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_labor_cost_v1_unavailable(
    'planned_person_time_exceeds_declared_capacity_commitment',cutoff_value,horizon_value);
  END IF;
  learning_state:=NULL;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||
   ':job-outcome-planning:'||lower(plan_value.inputs->>'serviceKey')||
   ':labor_planning:worker_hours:NorthStar worker hours',0));
  SELECT latest.value_state INTO learning_state FROM (
   SELECT DISTINCT ON(service_key,planning_area,metric_key,basis)
    service_key,planning_area,metric_key,basis,value_state,multiplier,revision
   FROM public.canonical_job_outcome_planning_value_versions
   WHERE organization_id=org
    AND lower(service_key)=lower(plan_value.inputs->>'serviceKey')
    AND planning_area='labor_planning' AND metric_key='worker_hours'
    AND basis='NorthStar worker hours'
   ORDER BY service_key,planning_area,metric_key,basis,revision DESC,id DESC) latest;
  IF learning_state='active' THEN
   applicable_service_count:=applicable_service_count+1;
   authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_labor_cost_v1_unavailable(
    'learned_adjustment_compatibility_unverified',cutoff_value,horizon_value);
  END IF;
  total_minutes:=total_minutes+(plan_result->>'personMinutes')::numeric;
  total_cost:=total_cost+(plan_result->>'cost')::numeric;covered_count:=covered_count+1;
 END LOOP;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-labor-cost-forecast-v1','state','current','reason',NULL,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
  'currency',currency_value,'horizon',jsonb_build_object(
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object(
   'label','Next 30 days of authenticated NorthStar scheduled backlog',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'work',jsonb_build_object('state','current','scheduledCount',scheduled_count,
   'unscheduledCount',unscheduled_count,'outsideWindowCount',outside_count),
  'plannedLabor',jsonb_build_object('state','current','coveredCount',covered_count,
   'personHours',to_char(round(total_minutes/60,6),'FM999999999999990.000000'),
   'cost',to_char(total_cost,'FM999999999999990.00'),'reason',NULL),
  'rateAuthority',jsonb_build_object('state','current',
   'basis','owner_saved_m24_labor_plan_rates','payrollVerified',FALSE,'reason',NULL),
  'capacity',jsonb_build_object('state','declared_role_capacity_verified',
   'declaredRole',capacity_value->>'declaredRole','realizedAttendanceVerified',FALSE,
   'jobSpecificConstraintCompositionAvailable',FALSE,'reason',NULL),
  'learnedOutcomes',jsonb_build_object('state','none_current',
   'applicableServiceCount',applicable_service_count,'applied',FALSE,
   'reason','no_current_applicable_owner_adopted_multiplier'),
  'forecastIssued',TRUE,'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,
  'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_labor_cost_v1_unavailable(
 TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_labor_cost_v1_plan_result(
 JSONB,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_labor_cost_v1_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ DECLARE runtime_role TEXT:='northstar_app_runtime'; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format(
   'GRANT EXECUTE ON FUNCTION public.canonical_forecast_labor_cost_v1_current(uuid,uuid,text,uuid) TO %I',
   runtime_role);
 END IF;
END $$;
