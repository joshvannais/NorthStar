-- Mission 26 Part 7B: bounded next-30-day planned material-cost forecast.
-- This read uses current scheduled backlog, owner-confirmed booked work, and
-- the latest adopted M24 material plan. It does not claim a purchase order,
-- reserved inventory, supplier authentication, tax, delivery, probability,
-- a calibrated range, or automatic action.

CREATE FUNCTION public.canonical_forecast_material_cost_v1_unavailable(
 reason_value TEXT,cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m26-material-cost-forecast-v1','state','unavailable','reason',reason_value,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
  'currency',NULL,'horizon',jsonb_build_object(
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object(
   'label','Next 30 days of authenticated NorthStar scheduled backlog',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'work',jsonb_build_object('state','unavailable','scheduledCount',NULL,
   'unscheduledCount',NULL,'outsideWindowCount',NULL),
  'plannedMaterials',jsonb_build_object('state','unavailable','coveredCount',NULL,
   'lineCount',NULL,'baseCost',NULL,'wasteCost',NULL,'lineCost',NULL,
   'reason',reason_value),
  'purchasing',jsonb_build_object('state','unavailable',
   'basis','owner_adopted_m24_material_plan','purchaseOrdersVerified',FALSE,
   'deliveryFeesIncluded',FALSE,'taxTreatmentVerified',FALSE,
   'transportIncluded',FALSE,'reason',reason_value),
  'availability',jsonb_build_object('state','unavailable',
   'reportedSufficientLineCount',NULL,'inventoryVerified',FALSE,
   'reservationVerified',FALSE,'supplierAuthenticated',FALSE,'reason',reason_value),
  'inventoryValuation',jsonb_build_object('state','unavailable','amount',NULL,
   'reason','inventory_records_unavailable'),
  'learnedOutcomes',jsonb_build_object('state','unavailable',
   'applicableServiceCount',NULL,'applied',FALSE,'reason',reason_value),
  'forecastIssued',FALSE,'completePurchasingForecastIssued',FALSE,
  'inventoryForecastIssued',FALSE,'calibratedRangeIssued',FALSE,
  'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_material_cost_v1_plan_result(
 inputs_value JSONB,currency_value TEXT,service_value TEXT,cutoff_value TIMESTAMPTZ,
 start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE line_value JSONB;source_value JSONB;supply_value JSONB;
 source_assessment JSONB;supply_assessment JSONB;
 quantity_value NUMERIC;waste_value NUMERIC;price_value NUMERIC;planned_value NUMERIC;
 base_line NUMERIC;total_line NUMERIC;base_total NUMERIC:=0;line_total NUMERIC:=0;
 line_count INTEGER:=0;
 cutoff_day DATE:=(cutoff_value AT TIME ZONE 'UTC')::date;
 start_day DATE:=(start_value AT TIME ZONE 'UTC')::date;
 last_day DATE:=((end_value-INTERVAL '1 microsecond') AT TIME ZONE 'UTC')::date;
BEGIN
 IF end_value<=start_value OR cutoff_value>start_value THEN
  RETURN jsonb_build_object('state','unavailable','reason','period_attribution_unavailable');
 END IF;
 source_assessment:=public.canonical_material_source_assess(
  public.canonical_material_availability_cost_inputs(inputs_value),
  currency_value,service_value,cutoff_day);
 supply_assessment:=public.canonical_material_availability_assess(
  inputs_value,currency_value,service_value,cutoff_day);
 FOR line_value IN SELECT value FROM jsonb_array_elements(inputs_value->'lines') LOOP
  SELECT value INTO source_value FROM jsonb_array_elements(source_assessment->'lines')
   WHERE value->>'lineId'=line_value->>'lineId';
  SELECT value INTO supply_value FROM jsonb_array_elements(supply_assessment->'lines')
   WHERE value->>'lineId'=line_value->>'lineId';
  IF source_value IS NULL OR supply_value IS NULL OR
     jsonb_array_length(source_value->'flags')<>0 OR
     line_value#>>'{evidence,effectiveOn}' IS NULL OR
     line_value#>>'{evidence,validThrough}' IS NULL OR
     (line_value#>>'{evidence,effectiveOn}')::date>start_day OR
     (line_value#>>'{evidence,validThrough}')::date<last_day THEN
   RETURN jsonb_build_object('state','unavailable','reason','current_material_price_unavailable');
  END IF;
  IF supply_value->>'currentStatus'<>'reported_sufficient' OR
     line_value#>>'{availability,observedOn}' IS NULL OR
     line_value#>>'{availability,validThrough}' IS NULL OR
     (line_value#>>'{availability,observedOn}')::date>cutoff_day OR
     (line_value#>>'{availability,validThrough}')::date<last_day THEN
   RETURN jsonb_build_object('state','unavailable','reason','reported_material_availability_unavailable');
  END IF;
  quantity_value:=(line_value->>'quantity')::numeric;
  waste_value:=(line_value->>'wastePercent')::numeric;
  price_value:=(line_value->>'unitPrice')::numeric;
  planned_value:=quantity_value*(1+waste_value/100);
  planned_value:=CASE WHEN line_value->>'unit'='ea' THEN ceil(planned_value)
   ELSE ceil(planned_value*1000000)/1000000 END;
  base_line:=round(quantity_value*price_value,2);
  total_line:=round(planned_value*price_value,2);
  base_total:=base_total+base_line;line_total:=line_total+total_line;
  line_count:=line_count+1;
  IF base_total>999999999999999.99 OR line_total>999999999999999.99 THEN
   RAISE EXCEPTION 'Material forecast amount exceeds bound' USING ERRCODE='22023';
  END IF;
 END LOOP;
 RETURN jsonb_build_object('state','current','reason',NULL,'lineCount',line_count,
  'reportedSufficientLineCount',line_count,
  'baseCost',to_char(base_total,'FM999999999999990.00'),
  'wasteCost',to_char(line_total-base_total,'FM999999999999990.00'),
  'lineCost',to_char(line_total,'FM999999999999990.00'));
EXCEPTION WHEN SQLSTATE '22023' THEN
 RETURN jsonb_build_object('state','unavailable','reason','current_adopted_material_plan_unavailable');
END $$;

CREATE FUNCTION public.canonical_forecast_material_cost_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;cutoff_value TIMESTAMPTZ;horizon_value TIMESTAMPTZ;
 currency_value TEXT;position_count INTEGER;scheduled_count INTEGER:=0;
 unscheduled_count INTEGER:=0;outside_count INTEGER:=0;covered_count INTEGER:=0;
 total_lines INTEGER:=0;reported_lines INTEGER:=0;active_learning_count INTEGER:=0;
 base_total NUMERIC:=0;waste_total NUMERIC:=0;line_total NUMERIC:=0;
 candidate RECORD;booked RECORD;revision_value public.canonical_estimate_revisions%ROWTYPE;
 plan_value public.canonical_material_plans%ROWTYPE;plan_result JSONB;
 booking_state JSONB;service_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for material-cost forecast' USING ERRCODE='25001';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
 horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Material-cost forecast is busy' USING ERRCODE='55P03';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT profile.raw_profile#>>'{company,currency}' INTO currency_value
 FROM public.canonical_business_profiles profile
 WHERE profile.organization_id=org AND profile.is_active=TRUE
 ORDER BY profile.version_number DESC,profile.id DESC LIMIT 1 FOR SHARE;
 IF currency_value IS NULL OR currency_value!~'^[A-Z]{3}$' THEN
  authority:=public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,NULL,FALSE);
  RETURN public.canonical_forecast_material_cost_v1_unavailable(
   'reporting_currency_unavailable',cutoff_value,horizon_value);
 END IF;
 SELECT count(*)::integer INTO position_count
 FROM public.canonical_forecast_current_backlog_booking_positions position_value
 WHERE position_value.organization_id=org AND position_value.active;
 IF position_count>500 THEN
  RAISE EXCEPTION 'Scheduled backlog exceeds bound' USING ERRCODE='54000';
 END IF;
 -- M24 material-plan and adoption writers take the estimate row FOR UPDATE.
 PERFORM estimate_value.id FROM public.canonical_estimates estimate_value
 WHERE estimate_value.organization_id=org AND estimate_value.id IN(
  SELECT version.estimate_id
  FROM (SELECT DISTINCT ON(review.appointment_id) review.*
        FROM public.canonical_forecast_commercial_booking_reviews review
        WHERE review.organization_id=org
        ORDER BY review.appointment_id,review.review_order DESC,review.id DESC LIMIT 501) latest
  JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=latest.organization_id AND confirmation.review_id=latest.id
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=latest.organization_id AND version.id=latest.issued_version_id
  WHERE latest.action<>'booking_cancelled')
 ORDER BY estimate_value.id FOR SHARE OF estimate_value;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':job-outcome-proposal-consent',0));
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
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_material_cost_v1_unavailable(
    'period_attribution_unavailable',cutoff_value,horizon_value);
  END IF;
  IF candidate.scheduled_start<cutoff_value OR candidate.scheduled_end>horizon_value THEN
   outside_count:=outside_count+1;CONTINUE;
  END IF;
  scheduled_count:=scheduled_count+1;
  SELECT latest.*,confirmation.id confirmation_id,version.estimate_id INTO booked
  FROM (SELECT review.* FROM public.canonical_forecast_commercial_booking_reviews review
        WHERE review.organization_id=org
         AND review.appointment_id=candidate.appointment_id
        ORDER BY review.review_order DESC,review.id DESC LIMIT 1) latest
  JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=latest.organization_id AND confirmation.review_id=latest.id
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=latest.organization_id AND version.id=latest.issued_version_id
  WHERE latest.action<>'booking_cancelled';
  IF booked.confirmation_id IS NULL THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_material_cost_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,horizon_value);
  END IF;
  booking_state:=public.canonical_forecast_booked_work_confirmation_currentness(
   org,actor,role_value,session_value,booked.confirmation_id);
  IF booking_state->>'bookedWorkVerified'<>'true' THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_material_cost_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,horizon_value);
  END IF;
  revision_value:=NULL;plan_value:=NULL;
  SELECT * INTO revision_value FROM public.canonical_estimate_revisions revision
  WHERE revision.organization_id=org AND revision.estimate_id=booked.estimate_id
  ORDER BY revision.revision DESC,revision.id DESC LIMIT 1;
  IF revision_value.id IS NOT NULL THEN
   SELECT * INTO plan_value FROM public.canonical_material_plans plan
   WHERE plan.organization_id=org AND plan.estimate_id=booked.estimate_id
    AND plan.id=revision_value.material_plan_id;
  END IF;
  IF plan_value.id IS NULL OR plan_value.action<>'save' OR
     plan_value.calculation_version<>'estimate-material-plan-v4' OR
     plan_value.currency<>currency_value OR
     EXISTS(SELECT 1 FROM public.canonical_material_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>plan_value.revision OR
        (newer.revision=plan_value.revision AND newer.id>plan_value.id))) THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_material_cost_v1_unavailable(
    'current_adopted_material_plan_unavailable',cutoff_value,horizon_value);
  END IF;
  SELECT snapshot.snapshot#>>'{service,key}' INTO service_value
  FROM public.canonical_polaris_snapshots snapshot
  WHERE snapshot.organization_id=org AND snapshot.estimate_id=booked.estimate_id
  ORDER BY snapshot.created_at DESC,snapshot.id DESC LIMIT 1;
  plan_result:=public.canonical_forecast_material_cost_v1_plan_result(
   plan_value.inputs,currency_value,service_value,cutoff_value,
   candidate.scheduled_start,candidate.scheduled_end);
  IF plan_result->>'state'<>'current' THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_material_cost_v1_unavailable(
    COALESCE(plan_result->>'reason','current_adopted_material_plan_unavailable'),
    cutoff_value,horizon_value);
  END IF;
  SELECT count(*)::integer INTO active_learning_count FROM(
   SELECT DISTINCT ON(service_key,planning_area,metric_key,basis)
    service_key,planning_area,metric_key,basis,value_state
   FROM public.canonical_job_outcome_planning_value_versions
   WHERE organization_id=org AND lower(service_key)=lower(service_value)
    AND planning_area='material_planning'
   ORDER BY service_key,planning_area,metric_key,basis,revision DESC,id DESC) latest
  WHERE latest.value_state='active';
  IF active_learning_count>0 THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_material_cost_v1_unavailable(
    'learned_adjustment_compatibility_unverified',cutoff_value,horizon_value);
  END IF;
  base_total:=base_total+(plan_result->>'baseCost')::numeric;
  waste_total:=waste_total+(plan_result->>'wasteCost')::numeric;
  line_total:=line_total+(plan_result->>'lineCost')::numeric;
  total_lines:=total_lines+(plan_result->>'lineCount')::integer;
  reported_lines:=reported_lines+(plan_result->>'reportedSufficientLineCount')::integer;
  covered_count:=covered_count+1;
 END LOOP;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-material-cost-forecast-v1','state','current','reason',NULL,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
  'currency',currency_value,'horizon',jsonb_build_object(
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object(
   'label','Next 30 days of authenticated NorthStar scheduled backlog',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'work',jsonb_build_object('state','current','scheduledCount',scheduled_count,
   'unscheduledCount',unscheduled_count,'outsideWindowCount',outside_count),
  'plannedMaterials',jsonb_build_object('state','current','coveredCount',covered_count,
   'lineCount',total_lines,'baseCost',to_char(base_total,'FM999999999999990.00'),
   'wasteCost',to_char(waste_total,'FM999999999999990.00'),
   'lineCost',to_char(line_total,'FM999999999999990.00'),'reason',NULL),
  'purchasing',jsonb_build_object('state','plan_cost_only',
   'basis','owner_adopted_m24_material_plan','purchaseOrdersVerified',FALSE,
   'deliveryFeesIncluded',FALSE,'taxTreatmentVerified',FALSE,
   'transportIncluded',FALSE,'reason','purchase_terms_unavailable'),
  'availability',jsonb_build_object('state','owner_recorded_reported_sufficient',
   'reportedSufficientLineCount',reported_lines,'inventoryVerified',FALSE,
   'reservationVerified',FALSE,'supplierAuthenticated',FALSE,
   'reason','reported_availability_is_not_reserved_inventory'),
  'inventoryValuation',jsonb_build_object('state','unavailable','amount',NULL,
   'reason','inventory_records_unavailable'),
  'learnedOutcomes',jsonb_build_object('state','none_current',
   'applicableServiceCount',0,'applied',FALSE,
   'reason','no_current_applicable_owner_adopted_multiplier'),
  'forecastIssued',TRUE,'completePurchasingForecastIssued',FALSE,
  'inventoryForecastIssued',FALSE,'calibratedRangeIssued',FALSE,
  'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_material_cost_v1_unavailable(
 TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_material_cost_v1_plan_result(
 JSONB,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_material_cost_v1_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ DECLARE runtime_role TEXT:='northstar_app_runtime'; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format(
   'GRANT EXECUTE ON FUNCTION public.canonical_forecast_material_cost_v1_current(uuid,uuid,text,uuid) TO %I',
   runtime_role);
 END IF;
END $$;
