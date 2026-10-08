-- Mission 26 Part 8C: authenticated declared vehicle-leg distance.
-- This projection preserves the exact adopted M24 travel plan while keeping
-- verified road mileage, route timing, fuel/energy use and logistics capacity
-- unavailable until their independent operational sources exist.

CREATE FUNCTION public.canonical_forecast_route_quantity_v1(value NUMERIC)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT regexp_replace(regexp_replace(
  to_char(round(value,6),'FM999999999999999990.000000'),'0+$',''),'\.$','')
$$;

CREATE FUNCTION public.canonical_forecast_route_load_risk_v1_unavailable(
 reason_value TEXT,cutoff_value TIMESTAMPTZ,source_as_of_value TIMESTAMPTZ,zone_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE horizon_value TIMESTAMPTZ:=cutoff_value+INTERVAL '2592000 seconds';
 start_day DATE:=(cutoff_value AT TIME ZONE COALESCE(zone_value,'UTC'))::date;
 end_day DATE:=(horizon_value AT TIME ZONE COALESCE(zone_value,'UTC'))::date;
 unavailable_value JSONB:=jsonb_build_object('state','unavailable','value',NULL,'unit',NULL,
  'reason',reason_value);
BEGIN RETURN jsonb_build_object(
 'version','m26-route-load-risk-forecast-v1','state','unavailable','reason',reason_value,
 'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
 'sourceAsOf',public.canonical_forecast_utc_instant(source_as_of_value),
 'horizon',jsonb_build_object('kind','next_30_elapsed_days','timeZone',zone_value,
  'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
  'endsAt',public.canonical_forecast_utc_instant(horizon_value),
  'startsOn',start_day::text,'endsOnExclusive',end_day::text),
 'scope',jsonb_build_object('label','Authenticated owner-confirmed scheduled backlog',
  'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
 'sourceCoverage',jsonb_build_object('state','unavailable','completeAsOf',FALSE,
  'hasMore',NULL,'currentBookedPositionCount',NULL,'scheduledJobCount',NULL,
  'unscheduledJobCount',NULL,'outsideWindowCount',NULL,'travelRevisionCount',NULL,
  'routeLineCount',NULL,'reason',reason_value),
 'sources',NULL,'routes',NULL,
 'declaredRouteLoad',jsonb_build_object('state','unavailable','routeLineCount',NULL,
  'tripLegs',NULL,'vehicleLegs',NULL,'declaredVehicleMiles',NULL,
  'declaredVehicleKilometres',NULL,'reason',reason_value),
 'verifiedRoadMileage',unavailable_value,'routeTiming',unavailable_value,
 'fuelEnergy',unavailable_value,'logisticsCapacityRisk',unavailable_value,
 'learnedOutcomes',jsonb_build_object('state','unavailable','applicableValueCount',NULL,
  'applied',FALSE,'reason',reason_value),
 'evidence',jsonb_build_object('sourceAuthenticatedDeclaredDistance',FALSE,
  'currentAdoptedTravelVerified',FALSE,'currentnessVerified',FALSE,
  'compatibleUnitsVerified',FALSE,'periodAttributionVerified',FALSE,
  'movementClassVerified',FALSE,'verifiedRoadRouting',FALSE,
  'resourceIdentityVerified',FALSE,'independentConsumptionEvidenceVerified',FALSE,
  'capacityLoadEvidenceVerified',FALSE,'rentalLeaseProviderEvidenceVerified',FALSE,
  'm25AdjustmentApplied',FALSE),
 'run',jsonb_build_object('calculationVersion','m26-route-load-risk-calculation-v1',
  'sourceDigest',NULL,'digest',NULL),
 'forecastIssued',FALSE,'declaredRouteLoadForecastIssued',FALSE,
 'roadMileageForecastIssued',FALSE,'routeTimingForecastIssued',FALSE,
 'fuelEnergyForecastIssued',FALSE,'logisticsCapacityRiskForecastIssued',FALSE,
 'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,
 'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_route_load_risk_v1_lock_sources(org UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- Part 8B preserves the established estimate-row, schedule, commercial,
 -- M24 and M25 writer order before this dependent source is locked.
 PERFORM public.canonical_forecast_asset_utilization_risk_v1_lock_sources(org);
 LOCK TABLE public.canonical_travel_plans IN SHARE MODE;
END $$;

CREATE FUNCTION public.canonical_forecast_route_load_risk_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;cutoff_value TIMESTAMPTZ;source_as_of_value TIMESTAMPTZ;
 horizon_value TIMESTAMPTZ;zone_value TEXT;position_count INTEGER:=0;
 scheduled_count INTEGER:=0;unscheduled_count INTEGER:=0;outside_count INTEGER:=0;
 source_index INTEGER:=0;line_count INTEGER:=0;active_learning_count INTEGER:=0;
 trip_legs INTEGER:=0;vehicle_legs INTEGER:=0;distance_value NUMERIC;
 route_distance NUMERIC;declared_miles NUMERIC:=0;declared_kilometres NUMERIC:=0;
 profile public.canonical_business_profiles%ROWTYPE;candidate RECORD;booked RECORD;
 revision_value public.canonical_estimate_revisions%ROWTYPE;
 adoption public.canonical_estimate_proposal_adoptions%ROWTYPE;
 travel_value public.canonical_travel_plans%ROWTYPE;
 booking_state JSONB;service_value TEXT;line_value JSONB;trip_value JSONB;
 travel_assessment JSONB;assessment_date DATE;
 sources JSONB:='[]'::jsonb;routes JSONB:='[]'::jsonb;
 source_manifest JSONB;source_digest TEXT;run_payload JSONB;run_digest TEXT;
 seen_estimates UUID[]:=ARRAY[]::uuid[];start_day DATE;end_day DATE;
 unavailable_road JSONB:=jsonb_build_object('state','unavailable','value',NULL,'unit',NULL,
  'reason','verified_road_route_unavailable');
 unavailable_timing JSONB:=jsonb_build_object('state','unavailable','value',NULL,'unit',NULL,
  'reason','verified_route_timing_unavailable');
 unavailable_consumption JSONB:=jsonb_build_object('state','unavailable','value',NULL,'unit',NULL,
  'reason','independent_consumption_evidence_unavailable');
 unavailable_capacity JSONB:=jsonb_build_object('state','unavailable','value',NULL,'unit',NULL,
  'reason','resource_capacity_and_load_evidence_unavailable');
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for route-load forecast' USING ERRCODE='25001';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
 horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 PERFORM public.canonical_forecast_route_load_risk_v1_lock_sources(org);
 source_as_of_value:=clock_timestamp();
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO profile FROM public.canonical_business_profiles value
 WHERE value.organization_id=org AND value.is_active=TRUE
 ORDER BY value.version_number DESC,value.id DESC LIMIT 1 FOR SHARE;
 zone_value:=profile.raw_profile#>>'{company,timeZone}';
 IF profile.id IS NULL OR zone_value IS NULL OR NOT EXISTS(
    SELECT 1 FROM pg_timezone_names WHERE name=zone_value) THEN
  RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
   'business_calendar_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 start_day:=(cutoff_value AT TIME ZONE zone_value)::date;
 end_day:=(horizon_value AT TIME ZONE zone_value)::date;
 assessment_date:=((horizon_value-INTERVAL '1 microsecond') AT TIME ZONE zone_value)::date;
 SELECT count(*)::integer INTO position_count
 FROM public.canonical_forecast_current_backlog_booking_positions value
 WHERE value.organization_id=org AND value.active;
 IF position_count>500 THEN
  RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
   'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;

 FOR candidate IN
  SELECT position_value.appointment_id,assignment.id assignment_id,
   assignment.schedule_state,assignment.scheduled_start,assignment.scheduled_end,
   assignment.revision assignment_revision,rtrim(assignment.canonical_digest) assignment_digest,
   assignment.last_human_approval_id approval_id,approval.time_zone_authority,
   approval.submitted_schedule,rtrim(approval.time_evidence_digest) time_evidence_digest,
   approval.applied_revision approval_revision,rtrim(approval.applied_digest) approval_digest,
   approval.approved_scheduled_start,approval.approved_scheduled_end
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=position_value.organization_id
    AND assignment.id=position_value.assignment_id
    AND assignment.appointment_id=position_value.appointment_id
  LEFT JOIN public.canonical_schedule_human_approvals approval
   ON approval.organization_id=assignment.organization_id
    AND approval.id=assignment.last_human_approval_id
    AND approval.assignment_id=assignment.id
  WHERE position_value.organization_id=org AND position_value.active
  ORDER BY position_value.appointment_id
 LOOP
  IF candidate.schedule_state='unscheduled' THEN
   unscheduled_count:=unscheduled_count+1;CONTINUE;
  END IF;
  IF candidate.scheduled_start IS NULL OR candidate.scheduled_end IS NULL OR
     candidate.scheduled_end<=candidate.scheduled_start OR
     (candidate.scheduled_start<cutoff_value AND candidate.scheduled_end>cutoff_value) OR
     (candidate.scheduled_start<horizon_value AND candidate.scheduled_end>horizon_value) THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'approved_timing_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF candidate.approval_id IS NULL OR candidate.approval_revision<>candidate.assignment_revision OR
     candidate.approval_digest IS DISTINCT FROM candidate.assignment_digest OR
     candidate.approved_scheduled_start IS DISTINCT FROM candidate.scheduled_start OR
     candidate.approved_scheduled_end IS DISTINCT FROM candidate.scheduled_end OR
     candidate.time_evidence_digest IS NULL OR
     candidate.time_evidence_digest!~'^[0-9a-f]{64}$' OR
     candidate.time_zone_authority IS NULL OR
     (SELECT count(*) FROM jsonb_object_keys(candidate.time_zone_authority))<>5 OR
     candidate.time_zone_authority->>'profileHash' IS DISTINCT FROM rtrim(profile.normalized_profile_hash) OR
     candidate.time_zone_authority->>'profileId' IS DISTINCT FROM profile.id::text OR
     COALESCE((candidate.time_zone_authority->>'profileVersion')::bigint,-1)<>profile.version_number OR
     candidate.time_zone_authority->>'timeZone' IS DISTINCT FROM zone_value OR
     candidate.time_zone_authority->>'evaluatedAt' IS NULL OR
     candidate.time_evidence_digest<>public.canonical_schedule_time_evidence_digest(
      2::smallint,candidate.submitted_schedule,candidate.time_zone_authority) THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'approved_timing_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF candidate.scheduled_start<cutoff_value OR candidate.scheduled_end>horizon_value THEN
   outside_count:=outside_count+1;CONTINUE;
  END IF;
  -- The current M24 route plan has no phase-to-trip binding. Never place a
  -- multi-day route claim into one period without that authority.
  IF candidate.scheduled_end-candidate.scheduled_start>INTERVAL '24 hours' THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'long_job_phase_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  scheduled_count:=scheduled_count+1;
  SELECT latest.*,confirmation.id confirmation_id,version.id issued_version_id,
   version.estimate_id INTO booked
  FROM (SELECT review.* FROM public.canonical_forecast_commercial_booking_reviews review
        WHERE review.organization_id=org AND review.appointment_id=candidate.appointment_id
        ORDER BY review.review_order DESC,review.id DESC LIMIT 1) latest
  JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=latest.organization_id AND confirmation.review_id=latest.id
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=latest.organization_id AND version.id=latest.issued_version_id
  WHERE latest.action<>'booking_cancelled';
  IF booked.confirmation_id IS NULL THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  booking_state:=public.canonical_forecast_booked_work_confirmation_currentness(
   org,actor,role_value,session_value,booked.confirmation_id);
  IF booking_state->>'state'<>'owner_confirmed_booked_work_current' OR
     booking_state->'bookedWorkVerified' IS DISTINCT FROM 'true'::jsonb THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF booked.estimate_id=ANY(seen_estimates) THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'duplicate_current_job_travel_source',cutoff_value,source_as_of_value,zone_value);
  END IF;
  seen_estimates:=array_append(seen_estimates,booked.estimate_id);
  revision_value:=NULL;adoption:=NULL;travel_value:=NULL;
  SELECT * INTO revision_value FROM public.canonical_estimate_revisions value
  WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
  ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  SELECT * INTO adoption FROM public.canonical_estimate_proposal_adoptions value
  WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
  ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF revision_value.id IS NOT NULL THEN
   SELECT * INTO travel_value FROM public.canonical_travel_plans value
   WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
    AND value.id=revision_value.travel_plan_id;
  END IF;
  IF revision_value.id IS NULL OR revision_value.calculation_version<>'estimate-cost-adoption-v3' OR
     adoption.id IS NULL OR adoption.child_id<>revision_value.id OR
     adoption.component_manifest IS DISTINCT FROM revision_value.component_manifest OR
     adoption.travel_plan_id IS DISTINCT FROM revision_value.travel_plan_id OR
     travel_value.id IS NULL OR travel_value.action<>'save' OR
     travel_value.calculation_version<>'estimate-travel-plan-v1' OR
     travel_value.inputs IS NULL OR travel_value.evidence IS NULL OR
     travel_value.evidence->>'digest' IS NULL OR
     travel_value.evidence->>'digest'!~'^[0-9a-f]{64}$' OR
     travel_value.inputs#>>'{assessment,sourcesDigest}' IS DISTINCT FROM travel_value.evidence->>'digest' OR
     jsonb_typeof(travel_value.inputs->'trips')<>'array' OR
     jsonb_array_length(travel_value.inputs->'trips')<1 OR
     jsonb_array_length(travel_value.inputs->'trips')>12 OR
     EXISTS(SELECT 1 FROM public.canonical_travel_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>travel_value.revision OR
        (newer.revision=travel_value.revision AND newer.id>travel_value.id))) THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'current_adopted_travel_composition_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF public.canonical_travel_load_bindings(travel_value.inputs->'hauls',
      travel_value.inputs->'loadBindings',travel_value.inputs->'trips') IS NOT TRUE THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'current_adopted_route_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  travel_assessment:=public.canonical_travel_plan_assess(
   travel_value.inputs,assessment_date);
  IF jsonb_typeof(travel_assessment->'cautions')<>'array' OR
     jsonb_array_length(travel_assessment->'cautions')<>0 THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'current_adopted_route_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
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
    AND planning_area='travel_planning'
   ORDER BY service_key,planning_area,metric_key,basis,revision DESC,id DESC) latest
  WHERE latest.value_state='active';
  IF active_learning_count>0 THEN
   RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
    'compatible_m25_outcome_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  sources:=sources||jsonb_build_array(jsonb_build_object(
   'sourceIndex',source_index,
   'job',jsonb_build_object('appointmentId',candidate.appointment_id,
    'assignmentId',candidate.assignment_id,'bookingReviewId',booked.id,
    'bookingConfirmationId',booked.confirmation_id,'issuedVersionId',booked.issued_version_id,
    'plannedWindow',jsonb_build_object(
     'startsAt',public.canonical_forecast_utc_instant(candidate.scheduled_start),
     'endsAt',public.canonical_forecast_utc_instant(candidate.scheduled_end),
     'timeZone',zone_value,'assignmentRevision',candidate.assignment_revision,
     'assignmentDigest',candidate.assignment_digest,'approvalId',candidate.approval_id,
     'timeZoneAuthority',candidate.time_zone_authority,
     'timeEvidenceDigest',candidate.time_evidence_digest)),
   'estimate',jsonb_build_object('id',booked.estimate_id,
    'revisionId',revision_value.id,'revision',revision_value.revision,
    'digest',rtrim(revision_value.digest)),
   'composition',jsonb_build_object('id',adoption.id,'revision',adoption.revision,
    'digest',rtrim(adoption.digest),'calculationVersion',revision_value.calculation_version,
    'manifestDigest',public.canonical_completion_digest(revision_value.component_manifest),
    'coverageDigest',public.canonical_completion_digest(revision_value.coverage_assessment)),
   'travelPlan',jsonb_build_object('id',travel_value.id,'revision',travel_value.revision,
    'digest',rtrim(travel_value.digest),'calculationVersion',travel_value.calculation_version,
    'sourceDigest',travel_value.evidence->>'digest',
    'assessmentDigest',public.canonical_completion_digest(travel_assessment),
    'assessedThrough',assessment_date::text)));
  FOR line_value IN SELECT value FROM jsonb_array_elements(travel_value.inputs->'trips') LOOP
   trip_value:=public.canonical_travel_trip(line_value);
   distance_value:=public.canonical_travel_measure(line_value->'distance',ARRAY['mi','km']);
   IF line_value->>'lineId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      distance_value IS NULL OR distance_value<0 OR
      line_value#>>'{distance,basis}'='straight_line' OR
      line_value#>>'{distance,unit}' NOT IN('mi','km') OR
      (trip_value->>'tripLegs')::numeric<>trunc((trip_value->>'tripLegs')::numeric) OR
      (trip_value->>'vehicleLegs')::numeric<>trunc((trip_value->>'vehicleLegs')::numeric) OR
      (trip_value->>'tripLegs')::numeric<1 OR (trip_value->>'vehicleLegs')::numeric<1 THEN
    RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
     'current_adopted_route_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   route_distance:=distance_value*(trip_value->>'vehicleLegs')::numeric;
   IF route_distance>999999999999999999 THEN
    RAISE EXCEPTION 'Route-load distance exceeds bound' USING ERRCODE='22023';
   END IF;
   IF line_value#>>'{distance,unit}'='mi' THEN
    declared_miles:=declared_miles+route_distance;
   ELSE declared_kilometres:=declared_kilometres+route_distance;END IF;
   trip_legs:=trip_legs+(trip_value->>'tripLegs')::integer;
   vehicle_legs:=vehicle_legs+(trip_value->>'vehicleLegs')::integer;
   line_count:=line_count+1;
   IF line_count>6000 THEN
    RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
     'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   routes:=routes||jsonb_build_array(jsonb_build_object(
    'sourceIndex',source_index,'tripId',line_value->>'lineId',
    'route',jsonb_build_object(
     'originDigest',public.canonical_completion_digest(line_value->'origin'),
     'destinationDigest',public.canonical_completion_digest(line_value->'destination'),
     'direction','origin_to_destination','returnIncluded',(line_value->>'returnIncluded')::boolean),
    'movement',jsonb_build_object('state','unavailable','class',NULL,
     'roadTransportationVerified',FALSE,'onsiteEquipmentMovementVerified',FALSE,
     'reason','movement_class_unavailable'),
    'resource',jsonb_build_object('state','unavailable','assetId',NULL,'kind',NULL,
     'accessType',NULL,'providerSemanticsVerified',FALSE,'reason','resource_identity_unavailable'),
    'declaredDistance',jsonb_build_object('state','current_claimed_plan_only',
     'oneWayQuantity',public.canonical_forecast_route_quantity_v1(distance_value),
     'unit',line_value#>>'{distance,unit}','basis',line_value#>>'{distance,basis}',
     'tripCount',(line_value->>'trips')::integer,'vehicleCount',(line_value->>'vehicles')::integer,
     'tripLegs',(trip_value->>'tripLegs')::integer,
     'vehicleLegs',(trip_value->>'vehicleLegs')::integer,
     'totalVehicleLegDistance',public.canonical_forecast_route_quantity_v1(route_distance),
     'sourceAuthenticated',TRUE,'reason',NULL),
    'verifiedRoadMileage',unavailable_road,'routeTiming',unavailable_timing,
    'fuelEnergy',unavailable_consumption,'capacity',unavailable_capacity));
  END LOOP;
  source_index:=source_index+1;
 END LOOP;
 IF scheduled_count+unscheduled_count+outside_count<>position_count THEN
  RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
   'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 IF unscheduled_count>0 THEN
  RETURN public.canonical_forecast_route_load_risk_v1_unavailable(
   'approved_timing_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 source_manifest:=jsonb_build_object(
  'sourceAsOf',public.canonical_forecast_utc_instant(source_as_of_value),
  'horizon',jsonb_build_object('startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'timeZone',zone_value,
   'startsOn',start_day::text,'endsOnExclusive',end_day::text),
  'coverage',jsonb_build_object('currentBookedPositionCount',position_count,
   'scheduledJobCount',scheduled_count,'unscheduledJobCount',unscheduled_count,
   'outsideWindowCount',outside_count,'hasMore',FALSE),
  'sources',sources,'routes',routes);
 source_digest:=public.canonical_completion_digest(source_manifest);
 run_payload:=jsonb_build_object('version','m26-route-load-risk-calculation-v1',
  'sourceDigest',source_digest,'routes',routes,
  'declaredMiles',public.canonical_forecast_route_quantity_v1(declared_miles),
  'declaredKilometres',public.canonical_forecast_route_quantity_v1(declared_kilometres));
 run_digest:=public.canonical_completion_digest(run_payload);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-route-load-risk-forecast-v1','state','current','reason',NULL,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
  'sourceAsOf',public.canonical_forecast_utc_instant(source_as_of_value),
  'horizon',jsonb_build_object('kind','next_30_elapsed_days','timeZone',zone_value,
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),
   'startsOn',start_day::text,'endsOnExclusive',end_day::text),
  'scope',jsonb_build_object('label','Authenticated owner-confirmed scheduled backlog',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'sourceCoverage',jsonb_build_object('state','complete_as_of','completeAsOf',TRUE,
   'hasMore',FALSE,'currentBookedPositionCount',position_count,
   'scheduledJobCount',scheduled_count,'unscheduledJobCount',unscheduled_count,
   'outsideWindowCount',outside_count,'travelRevisionCount',source_index,
   'routeLineCount',line_count,'reason',NULL),
  'sources',sources,'routes',routes,
  'declaredRouteLoad',jsonb_build_object('state','current_claimed_plan_only',
   'routeLineCount',line_count,'tripLegs',trip_legs,'vehicleLegs',vehicle_legs,
   'declaredVehicleMiles',public.canonical_forecast_route_quantity_v1(declared_miles),
   'declaredVehicleKilometres',public.canonical_forecast_route_quantity_v1(declared_kilometres),
   'reason',NULL),
  'verifiedRoadMileage',unavailable_road,'routeTiming',unavailable_timing,
  'fuelEnergy',unavailable_consumption,'logisticsCapacityRisk',unavailable_capacity,
  'learnedOutcomes',jsonb_build_object('state','none_current','applicableValueCount',0,
   'applied',FALSE,'reason','no_compatible_current_owner_adopted_route_value'),
  'evidence',jsonb_build_object('sourceAuthenticatedDeclaredDistance',TRUE,
   'currentAdoptedTravelVerified',TRUE,'currentnessVerified',TRUE,
   'compatibleUnitsVerified',TRUE,'periodAttributionVerified',TRUE,
   'movementClassVerified',FALSE,'verifiedRoadRouting',FALSE,
   'resourceIdentityVerified',FALSE,'independentConsumptionEvidenceVerified',FALSE,
   'capacityLoadEvidenceVerified',FALSE,'rentalLeaseProviderEvidenceVerified',FALSE,
   'm25AdjustmentApplied',FALSE),
  'run',jsonb_build_object('calculationVersion','m26-route-load-risk-calculation-v1',
   'sourceDigest',source_digest,'digest',run_digest),
  'forecastIssued',TRUE,'declaredRouteLoadForecastIssued',TRUE,
  'roadMileageForecastIssued',FALSE,'routeTimingForecastIssued',FALSE,
  'fuelEnergyForecastIssued',FALSE,'logisticsCapacityRiskForecastIssued',FALSE,
  'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,
  'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_route_quantity_v1(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_route_load_risk_v1_unavailable(
 TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_route_load_risk_v1_lock_sources(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_route_load_risk_v1_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_route_load_risk_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
 END IF;
END $$;
