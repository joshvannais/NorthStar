-- Mission 26 original Part 7C: bounded next-30-day equipment and travel-cost forecast.
-- The projection reuses the exact adopted M24 v3 allocation, including its
-- non-reusing overlap deduction. It does not predict utilization, readiness,
-- maintenance events, downtime, financing, provider truth, or probability.

CREATE FUNCTION public.canonical_forecast_equipment_travel_cost_v1_unavailable(
 reason_value TEXT,cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m26-equipment-travel-cost-forecast-v1','state','unavailable',
  'reason',reason_value,'fictional',FALSE,
  'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),'currency',NULL,
  'horizon',jsonb_build_object(
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object(
   'label','Next 30 days of authenticated NorthStar scheduled backlog',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'work',jsonb_build_object('state','unavailable','scheduledCount',NULL,
   'unscheduledCount',NULL,'outsideWindowCount',NULL),
  'plannedEquipmentTravel',jsonb_build_object('state','unavailable',
   'coveredCount',NULL,'equipmentLineCount',NULL,'tripCount',NULL,
   'logisticsLineCount',NULL,'equipmentCost',NULL,'grossTravelCost',NULL,
   'overlapDeduction',NULL,'netTravelCost',NULL,'combinedCost',NULL,
   'reason',reason_value),
  'allocation',jsonb_build_object('state','unavailable',
   'basis','owner_adopted_m24_cost_allocation_v3','v3AllocationReviewed',FALSE,
   'crossForecastLaborOverlapReviewed',FALSE,'reason',reason_value),
  'operations',jsonb_build_object('state','unavailable',
   'fuelOrEnergyLineCount',NULL,'maintenanceLineCount',NULL,
   'futureUtilizationVerified',FALSE,'assetReadinessVerified',FALSE,
   'maintenanceScheduleVerified',FALSE,'downtimeCostVerified',FALSE,
   'providerAuthenticated',FALSE,'reason',reason_value),
  'learnedOutcomes',jsonb_build_object('state','unavailable',
   'applicableServiceCount',NULL,'applied',FALSE,'reason',reason_value),
  'forecastIssued',FALSE,'completeOperatingCostForecastIssued',FALSE,
  'downtimeForecastIssued',FALSE,'calibratedRangeIssued',FALSE,
  'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_equipment_travel_cost_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;cutoff_value TIMESTAMPTZ;horizon_value TIMESTAMPTZ;
 currency_value TEXT;position_count INTEGER;scheduled_count INTEGER:=0;
 unscheduled_count INTEGER:=0;outside_count INTEGER:=0;covered_count INTEGER:=0;
 equipment_line_count INTEGER:=0;trip_count INTEGER:=0;logistics_line_count INTEGER:=0;
 fuel_count INTEGER:=0;maintenance_count INTEGER:=0;active_learning_count INTEGER:=0;
 equipment_cents NUMERIC:=0;gross_travel_cents NUMERIC:=0;
 overlap_cents NUMERIC:=0;net_travel_cents NUMERIC:=0;combined_cents NUMERIC:=0;
 candidate RECORD;booked RECORD;revision_value public.canonical_estimate_revisions%ROWTYPE;
 equipment_cost_value public.canonical_equipment_cost_plans%ROWTYPE;
 equipment_plan_value public.canonical_equipment_plans%ROWTYPE;
 travel_value public.canonical_travel_plans%ROWTYPE;
 labor_value public.canonical_labor_plans%ROWTYPE;
  booking_state JSONB;service_value TEXT;snapshot_value JSONB;
 equipment_assessment JSONB;travel_assessment JSONB;equipment_capacity JSONB;
 travel_calculation JSONB;job_equipment_cents NUMERIC;job_gross_travel_cents NUMERIC;
 job_overlap_cents NUMERIC;job_net_travel_cents NUMERIC;line_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for equipment and travel forecast'
   USING ERRCODE='25001';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
 horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Equipment and travel forecast is busy' USING ERRCODE='55P03';
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
  RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
   'reporting_currency_unavailable',cutoff_value,horizon_value);
 END IF;
 SELECT count(*)::integer INTO position_count
 FROM public.canonical_forecast_current_backlog_booking_positions position_value
 WHERE position_value.organization_id=org AND position_value.active;
 IF position_count>500 THEN
  RAISE EXCEPTION 'Scheduled backlog exceeds bound' USING ERRCODE='54000';
 END IF;
 -- M24 component/adoption writers take these estimate rows FOR UPDATE.
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
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'period_attribution_unavailable',cutoff_value,horizon_value);
  END IF;
  IF candidate.scheduled_start<cutoff_value OR candidate.scheduled_end>horizon_value THEN
   outside_count:=outside_count+1;CONTINUE;
  END IF;
  scheduled_count:=scheduled_count+1;
  SELECT latest.*,confirmation.id confirmation_id,version.estimate_id INTO booked
  FROM (SELECT review.* FROM public.canonical_forecast_commercial_booking_reviews review
        WHERE review.organization_id=org AND review.appointment_id=candidate.appointment_id
        ORDER BY review.review_order DESC,review.id DESC LIMIT 1) latest
  JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=latest.organization_id AND confirmation.review_id=latest.id
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=latest.organization_id AND version.id=latest.issued_version_id
  WHERE latest.action<>'booking_cancelled';
  IF booked.confirmation_id IS NULL THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,horizon_value);
  END IF;
  booking_state:=public.canonical_forecast_booked_work_confirmation_currentness(
   org,actor,role_value,session_value,booked.confirmation_id);
  IF booking_state->>'bookedWorkVerified'<>'true' THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,horizon_value);
  END IF;
  revision_value:=NULL;equipment_cost_value:=NULL;equipment_plan_value:=NULL;
  travel_value:=NULL;labor_value:=NULL;snapshot_value:=NULL;
  SELECT * INTO revision_value FROM public.canonical_estimate_revisions revision
  WHERE revision.organization_id=org AND revision.estimate_id=booked.estimate_id
  ORDER BY revision.revision DESC,revision.id DESC LIMIT 1;
  IF revision_value.id IS NOT NULL THEN
   SELECT * INTO equipment_cost_value FROM public.canonical_equipment_cost_plans plan
   WHERE plan.organization_id=org AND plan.estimate_id=booked.estimate_id
    AND plan.id=revision_value.equipment_cost_plan_id;
   SELECT * INTO travel_value FROM public.canonical_travel_plans plan
   WHERE plan.organization_id=org AND plan.estimate_id=booked.estimate_id
    AND plan.id=revision_value.travel_plan_id;
   SELECT * INTO labor_value FROM public.canonical_labor_plans plan
   WHERE plan.organization_id=org AND plan.estimate_id=booked.estimate_id
    AND plan.id=revision_value.labor_plan_id;
  END IF;
  IF equipment_cost_value.id IS NOT NULL THEN
   SELECT * INTO equipment_plan_value FROM public.canonical_equipment_plans plan
   WHERE plan.organization_id=org AND plan.estimate_id=booked.estimate_id
    AND plan.id=equipment_cost_value.equipment_plan_id;
  END IF;
  IF revision_value.id IS NULL OR revision_value.calculation_version<>'estimate-cost-adoption-v3' OR
     revision_value.equipment_cost_plan_id IS NULL OR revision_value.travel_plan_id IS NULL OR
     revision_value.coverage_assessment IS NULL OR
     equipment_cost_value.id IS NULL OR equipment_cost_value.action<>'save' OR
     equipment_cost_value.currency<>currency_value OR
     travel_value.id IS NULL OR travel_value.action<>'save' OR
     travel_value.currency<>currency_value OR
     equipment_plan_value.id IS NULL OR equipment_plan_value.action<>'save' OR
     equipment_cost_value.inputs#>>'{equipmentBasis,revision}' IS DISTINCT FROM equipment_plan_value.revision::text OR
     equipment_cost_value.inputs#>>'{equipmentBasis,digest}' IS DISTINCT FROM equipment_plan_value.digest OR
     equipment_cost_value.inputs#>'{equipmentBasis,sourcePins}' IS DISTINCT FROM equipment_plan_value.source_pins OR
     EXISTS(SELECT 1 FROM public.canonical_equipment_cost_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>equipment_cost_value.revision OR
        (newer.revision=equipment_cost_value.revision AND newer.id>equipment_cost_value.id))) OR
     EXISTS(SELECT 1 FROM public.canonical_travel_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>travel_value.revision OR
        (newer.revision=travel_value.revision AND newer.id>travel_value.id))) OR
     EXISTS(SELECT 1 FROM public.canonical_equipment_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>equipment_plan_value.revision OR
        (newer.revision=equipment_plan_value.revision AND newer.id>equipment_plan_value.id))) THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'current_adopted_equipment_travel_plan_unavailable',cutoff_value,horizon_value);
  END IF;
  equipment_assessment:=public.canonical_equipment_cost_source_assess(
   equipment_cost_value.inputs,((horizon_value-INTERVAL '1 microsecond') AT TIME ZONE 'UTC')::date);
  travel_assessment:=public.canonical_travel_plan_assess(
   travel_value.inputs,((horizon_value-INTERVAL '1 microsecond') AT TIME ZONE 'UTC')::date);
  IF jsonb_array_length(equipment_assessment->'cautions')<>0 OR
     jsonb_array_length(travel_assessment->'cautions')<>0 THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'current_equipment_travel_source_unavailable',cutoff_value,horizon_value);
  END IF;
  equipment_capacity:=public.canonical_travel_equipment_capacities(equipment_cost_value.inputs);
  IF EXISTS(SELECT 1 FROM jsonb_each(equipment_capacity)
    WHERE value->'complete' IS DISTINCT FROM 'true'::jsonb) THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'current_adopted_equipment_travel_plan_unavailable',cutoff_value,horizon_value);
  END IF;
  travel_calculation:=public.canonical_travel_plan_calculate(travel_value.inputs);
  IF travel_calculation->'complete' IS DISTINCT FROM 'true'::jsonb THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'current_adopted_equipment_travel_plan_unavailable',cutoff_value,horizon_value);
  END IF;
  SELECT snapshot.snapshot INTO snapshot_value FROM public.canonical_polaris_snapshots snapshot
  WHERE snapshot.organization_id=org AND snapshot.estimate_id=booked.estimate_id
  ORDER BY snapshot.created_at DESC,snapshot.id DESC LIMIT 1;
  IF snapshot_value IS NULL THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'current_adopted_equipment_travel_plan_unavailable',cutoff_value,horizon_value);
  END IF;
  job_overlap_cents:=public.canonical_travel_coverage_require(
   revision_value.component_manifest,
   CASE WHEN labor_value.id IS NULL THEN NULL ELSE public.canonical_labor_plan_projection(labor_value) END,
   public.canonical_equipment_cost_projection(equipment_cost_value),
   public.canonical_travel_plan_projection(travel_value),snapshot_value,
   revision_value.coverage_assessment);
  job_equipment_cents:=public.canonical_equipment_cost_known_cents(equipment_cost_value.inputs);
  job_gross_travel_cents:=(travel_calculation->>'totalCents')::numeric;
  job_net_travel_cents:=job_gross_travel_cents-job_overlap_cents;
  IF job_equipment_cents IS NULL OR job_gross_travel_cents IS NULL OR
     job_net_travel_cents<0 OR job_equipment_cents+job_net_travel_cents>99999999999999999 THEN
   RAISE EXCEPTION 'Equipment and travel forecast amount exceeds bound' USING ERRCODE='22023';
  END IF;
  SELECT snapshot.snapshot#>>'{service,key}' INTO service_value
  FROM public.canonical_polaris_snapshots snapshot
  WHERE snapshot.organization_id=org AND snapshot.estimate_id=booked.estimate_id
  ORDER BY snapshot.created_at DESC,snapshot.id DESC LIMIT 1;
  SELECT count(*)::integer INTO active_learning_count FROM(
   SELECT DISTINCT ON(service_key,planning_area,metric_key,basis)
    service_key,planning_area,metric_key,basis,value_state
   FROM public.canonical_job_outcome_planning_value_versions
   WHERE organization_id=org AND lower(service_key)=lower(service_value)
    AND planning_area IN('travel_planning','equipment_planning')
   ORDER BY service_key,planning_area,metric_key,basis,revision DESC,id DESC) latest
  WHERE latest.value_state='active';
  IF active_learning_count>0 THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,NULL,FALSE);
   RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
    'learned_adjustment_compatibility_unverified',cutoff_value,horizon_value);
  END IF;
  equipment_line_count:=equipment_line_count+jsonb_array_length(equipment_cost_value.inputs->'lines');
  trip_count:=trip_count+jsonb_array_length(travel_value.inputs->'trips');
  logistics_line_count:=logistics_line_count+jsonb_array_length(travel_value.inputs->'logistics');
  FOR line_value IN SELECT value FROM jsonb_array_elements(equipment_cost_value.inputs->'lines') LOOP
   IF line_value#>>'{operating,mode}'='separate' AND
      line_value#>>'{operating,fuelEnergy,status}'='known' THEN fuel_count:=fuel_count+1;END IF;
   IF line_value#>>'{operating,mode}'='separate' AND
      line_value#>>'{operating,maintenance,status}'='known' THEN maintenance_count:=maintenance_count+1;END IF;
  END LOOP;
  FOR line_value IN SELECT value FROM jsonb_array_elements(travel_value.inputs->'trips') LOOP
   IF line_value#>>'{vehicle,method}'='consumption' OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(line_value#>'{vehicle,rates}','[]'::jsonb)) rate
       WHERE rate->>'category'='fuel_energy' AND rate->'applicable'='true'::jsonb)
      THEN fuel_count:=fuel_count+1;END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(line_value#>'{vehicle,rates}','[]'::jsonb)) rate
       WHERE rate->>'category'='maintenance' AND rate->'applicable'='true'::jsonb)
      THEN maintenance_count:=maintenance_count+1;END IF;
  END LOOP;
  equipment_cents:=equipment_cents+job_equipment_cents;
  gross_travel_cents:=gross_travel_cents+job_gross_travel_cents;
  overlap_cents:=overlap_cents+job_overlap_cents;
  net_travel_cents:=net_travel_cents+job_net_travel_cents;
  combined_cents:=combined_cents+job_equipment_cents+job_net_travel_cents;
  covered_count:=covered_count+1;
 END LOOP;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-equipment-travel-cost-forecast-v1','state','current','reason',NULL,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
  'currency',currency_value,'horizon',jsonb_build_object(
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object(
   'label','Next 30 days of authenticated NorthStar scheduled backlog',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'work',jsonb_build_object('state','current','scheduledCount',scheduled_count,
   'unscheduledCount',unscheduled_count,'outsideWindowCount',outside_count),
  'plannedEquipmentTravel',jsonb_build_object('state','current',
   'coveredCount',covered_count,'equipmentLineCount',equipment_line_count,
   'tripCount',trip_count,'logisticsLineCount',logistics_line_count,
   'equipmentCost',to_char(equipment_cents/100,'FM999999999999990.00'),
   'grossTravelCost',to_char(gross_travel_cents/100,'FM999999999999990.00'),
   'overlapDeduction',to_char(overlap_cents/100,'FM999999999999990.00'),
   'netTravelCost',to_char(net_travel_cents/100,'FM999999999999990.00'),
   'combinedCost',to_char(combined_cents/100,'FM999999999999990.00'),'reason',NULL),
  'allocation',jsonb_build_object('state','reviewed_v3_allocation',
   'basis','owner_adopted_m24_cost_allocation_v3','v3AllocationReviewed',TRUE,
   'crossForecastLaborOverlapReviewed',TRUE,'reason','reviewed_allocation_applied'),
  'operations',jsonb_build_object('state','plan_cost_only',
   'fuelOrEnergyLineCount',fuel_count,'maintenanceLineCount',maintenance_count,
   'futureUtilizationVerified',FALSE,'assetReadinessVerified',FALSE,
   'maintenanceScheduleVerified',FALSE,'downtimeCostVerified',FALSE,
   'providerAuthenticated',FALSE,'reason','future_operations_evidence_unavailable'),
  'learnedOutcomes',jsonb_build_object('state','none_current',
   'applicableServiceCount',0,'applied',FALSE,
   'reason','no_current_applicable_owner_adopted_multiplier'),
  'forecastIssued',TRUE,'completeOperatingCostForecastIssued',FALSE,
  'downtimeForecastIssued',FALSE,'calibratedRangeIssued',FALSE,
  'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);
EXCEPTION WHEN SQLSTATE '22023' THEN
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_equipment_travel_cost_v1_unavailable(
  'current_adopted_equipment_travel_plan_unavailable',cutoff_value,horizon_value);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_equipment_travel_cost_v1_unavailable(
 TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_equipment_travel_cost_v1_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ DECLARE runtime_role TEXT:='northstar_app_runtime'; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format(
   'GRANT EXECUTE ON FUNCTION public.canonical_forecast_equipment_travel_cost_v1_current(uuid,uuid,text,uuid) TO %I',
   runtime_role);
 END IF;
END $$;
