-- Mission 26 Part 8B: authenticated planned asset utilization and fail-closed
-- meter, service-interval, maintenance and downtime-risk positions.
-- Planned hours are owner-adopted claims. They are never converted from
-- checkout duration and never establish engine-on time or a service date.

CREATE FUNCTION public.canonical_forecast_asset_hours_v1(value NUMERIC)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT regexp_replace(regexp_replace(
  to_char(round(value,6),'FM999999999999990.000000'),'0+$',''),'\.$','')
$$;

CREATE FUNCTION public.canonical_forecast_asset_utilization_risk_v1_unavailable(
 reason_value TEXT,cutoff_value TIMESTAMPTZ,source_as_of_value TIMESTAMPTZ,zone_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE horizon_value TIMESTAMPTZ:=cutoff_value+INTERVAL '2592000 seconds';
 start_day DATE:=(cutoff_value AT TIME ZONE COALESCE(zone_value,'UTC'))::date;
 end_day DATE:=(horizon_value AT TIME ZONE COALESCE(zone_value,'UTC'))::date;
BEGIN RETURN jsonb_build_object(
 'version','m26-asset-utilization-risk-forecast-v1','state','unavailable','reason',reason_value,
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
  'unscheduledJobCount',NULL,'outsideWindowCount',NULL,'equipmentRevisionCount',NULL,
  'readinessRevisionCount',NULL,'plannedUseCount',NULL,'assetCount',NULL,'reason',reason_value),
 'sources',NULL,'assets',NULL,
 'utilization',jsonb_build_object('state','unavailable','assetCount',NULL,
  'useCount',NULL,'claimedOperatingHours',NULL,'operatingTimeVerified',FALSE,
  'checkoutDurationUsed',FALSE,'reason',reason_value),
 'learnedOutcomes',jsonb_build_object('state','unavailable','applicableValueCount',NULL,
  'applied',FALSE,'reason',reason_value),
 'evidence',jsonb_build_object('sourceAuthenticatedUtilization',FALSE,
  'currentAdoptedEquipmentVerified',FALSE,'currentReadinessVerified',FALSE,
  'currentnessVerified',FALSE,'compatibleUnitsVerified',FALSE,
  'periodAttributionVerified',FALSE,'meterHistoryVerified',FALSE,
  'serviceThresholdPolicyVerified',FALSE,'maintenanceScheduleVerified',FALSE,
  'rentalLeaseProviderEvidenceVerified',FALSE,'m25AdjustmentApplied',FALSE,
  'evaluatedDowntimeRiskVerified',FALSE),
 'run',jsonb_build_object('calculationVersion','m26-asset-utilization-risk-calculation-v1',
  'sourceDigest',NULL,'digest',NULL),
 'forecastIssued',FALSE,'utilizationForecastIssued',FALSE,
 'serviceIntervalForecastIssued',FALSE,'maintenanceDueForecastIssued',FALSE,
 'serviceTimingForecastIssued',FALSE,'downtimeRiskForecastIssued',FALSE,
 'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,
 'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_asset_utilization_risk_v1_lock_sources(org UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- Reuse the released booking/estimate/M24/M25 source order, including the
 -- estimate-row cohort fence and commercial advisory locks.
 PERFORM public.canonical_forecast_material_demand_risk_v1_lock_sources(org);
 -- M23 equipment writers lock the asset, ledger and append-only event stream.
 -- M24 writers lock the estimate first (already fenced above), then these
 -- asset/equipment sources before appending their plan revision.
 LOCK TABLE public.tenant_assets,
  public.canonical_equipment_asset_versions,
  public.canonical_equipment_ledgers,
  public.canonical_equipment_events,
  public.canonical_equipment_plans,
  public.canonical_equipment_cost_plans,
  public.canonical_equipment_readiness_plans IN SHARE MODE;
END $$;

CREATE FUNCTION public.canonical_forecast_asset_utilization_risk_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;cutoff_value TIMESTAMPTZ;source_as_of_value TIMESTAMPTZ;
 horizon_value TIMESTAMPTZ;zone_value TEXT;position_count INTEGER:=0;
 scheduled_count INTEGER:=0;unscheduled_count INTEGER:=0;outside_count INTEGER:=0;
 source_index INTEGER:=0;line_count INTEGER:=0;asset_count INTEGER:=0;
 active_learning_count INTEGER:=0;unavailable_utilization_count INTEGER:=0;
 unavailable_service_count INTEGER:=0;
 provider_unavailable_count INTEGER:=0;
 profile public.canonical_business_profiles%ROWTYPE;candidate RECORD;booked RECORD;
 revision_value public.canonical_estimate_revisions%ROWTYPE;
 adoption public.canonical_estimate_proposal_adoptions%ROWTYPE;
 cost_value public.canonical_equipment_cost_plans%ROWTYPE;
 plan_value public.canonical_equipment_plans%ROWTYPE;
 readiness_value public.canonical_equipment_readiness_plans%ROWTYPE;
 asset_value public.tenant_assets%ROWTYPE;pin_value public.canonical_equipment_asset_versions%ROWTYPE;
 ledger_value public.canonical_equipment_ledgers%ROWTYPE;meter_event RECORD;asset_row RECORD;
 plan_line JSONB;cost_line JSONB;readiness_line JSONB;readiness_evidence_line JSONB;booking_state JSONB;
 service_value TEXT;planned_hours NUMERIC;claimed_hours NUMERIC;projected_reading NUMERIC;
 current_reading NUMERIC;threshold_value NUMERIC;
 event_count INTEGER;effective_count INTEGER;policy_count INTEGER;use_count INTEGER;
 meter_key_value TEXT;meter_unit_value TEXT;threshold_reference TEXT;
 access_basis_value TEXT;asset_access_type TEXT;source_condition_value TEXT;
 access_basis_count INTEGER;
 reset_applied BOOLEAN;correction_applied BOOLEAN;overlap_value BOOLEAN;
 ledger_complete BOOLEAN;meter_current BOOLEAN;service_current BOOLEAN;
 sources JSONB:='[]'::jsonb;use_rows JSONB:='[]'::jsonb;assets JSONB:='[]'::jsonb;
 uses_value JSONB;meter_value JSONB;service_interval JSONB;maintenance_due JSONB;
 source_manifest JSONB;source_digest TEXT;run_payload JSONB;run_digest TEXT;
 seen_estimates UUID[]:=ARRAY[]::uuid[];start_day DATE;end_day DATE;
 utilization_hours NUMERIC:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for asset-utilization forecast' USING ERRCODE='25001';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
 horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 PERFORM public.canonical_forecast_asset_utilization_risk_v1_lock_sources(org);
 source_as_of_value:=clock_timestamp();
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO profile FROM public.canonical_business_profiles value
 WHERE value.organization_id=org AND value.is_active=TRUE
 ORDER BY value.version_number DESC,value.id DESC LIMIT 1 FOR SHARE;
 zone_value:=profile.raw_profile#>>'{company,timeZone}';
 IF profile.id IS NULL OR zone_value IS NULL OR NOT EXISTS(
    SELECT 1 FROM pg_timezone_names WHERE name=zone_value) THEN
  RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
   'business_calendar_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 start_day:=(cutoff_value AT TIME ZONE zone_value)::date;
 end_day:=(horizon_value AT TIME ZONE zone_value)::date;
 SELECT count(*)::integer INTO position_count
 FROM public.canonical_forecast_current_backlog_booking_positions value
 WHERE value.organization_id=org AND value.active;
 IF position_count>500 THEN
  RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
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
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
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
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
    'approved_timing_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF candidate.scheduled_start<cutoff_value OR candidate.scheduled_end>horizon_value THEN
   outside_count:=outside_count+1;CONTINUE;
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
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  booking_state:=public.canonical_forecast_booked_work_confirmation_currentness(
   org,actor,role_value,session_value,booked.confirmation_id);
  IF booking_state->>'state'<>'owner_confirmed_booked_work_current' OR
     booking_state->'bookedWorkVerified' IS DISTINCT FROM 'true'::jsonb THEN
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF booked.estimate_id=ANY(seen_estimates) THEN
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
    'duplicate_current_job_equipment_source',cutoff_value,source_as_of_value,zone_value);
  END IF;
  seen_estimates:=array_append(seen_estimates,booked.estimate_id);
  revision_value:=NULL;adoption:=NULL;cost_value:=NULL;plan_value:=NULL;readiness_value:=NULL;
  SELECT * INTO revision_value FROM public.canonical_estimate_revisions value
  WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
  ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  SELECT * INTO adoption FROM public.canonical_estimate_proposal_adoptions value
  WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
  ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF revision_value.id IS NOT NULL THEN
   SELECT * INTO cost_value FROM public.canonical_equipment_cost_plans value
   WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
    AND value.id=revision_value.equipment_cost_plan_id;
  END IF;
  IF cost_value.id IS NOT NULL THEN
   SELECT * INTO plan_value FROM public.canonical_equipment_plans value
   WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
    AND value.id=cost_value.equipment_plan_id;
  END IF;
  IF plan_value.id IS NOT NULL THEN
   SELECT * INTO readiness_value FROM public.canonical_equipment_readiness_plans value
   WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  END IF;
  IF revision_value.id IS NULL OR revision_value.calculation_version<>'estimate-cost-adoption-v3' OR
     adoption.id IS NULL OR adoption.child_id<>revision_value.id OR
     adoption.component_manifest IS DISTINCT FROM revision_value.component_manifest OR
     adoption.equipment_cost_plan_id IS DISTINCT FROM revision_value.equipment_cost_plan_id OR
     cost_value.id IS NULL OR cost_value.action<>'save' OR
     cost_value.calculation_version<>'estimate-equipment-cost-plan-v1' OR
     plan_value.id IS NULL OR plan_value.action<>'save' OR
     plan_value.calculation_version<>'estimate-equipment-plan-v1' OR
     EXISTS(SELECT 1 FROM public.canonical_equipment_cost_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>cost_value.revision OR
        (newer.revision=cost_value.revision AND newer.id>cost_value.id))) OR
     EXISTS(SELECT 1 FROM public.canonical_equipment_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>plan_value.revision OR
        (newer.revision=plan_value.revision AND newer.id>plan_value.id))) THEN
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
    'current_adopted_equipment_composition_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF readiness_value.id IS NULL OR readiness_value.action<>'save' OR
     readiness_value.calculation_version<>'estimate-equipment-readiness-v1' OR
     readiness_value.inputs->'equipmentBasis' IS DISTINCT FROM jsonb_build_object(
      'planId',plan_value.id,'revision',plan_value.revision,'digest',rtrim(plan_value.digest)) OR
     jsonb_array_length(plan_value.inputs->'lines')<>jsonb_array_length(cost_value.inputs->'lines') OR
     jsonb_array_length(plan_value.inputs->'lines')<>jsonb_array_length(readiness_value.inputs->'lines') THEN
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
    'current_adopted_readiness_unavailable',cutoff_value,source_as_of_value,zone_value);
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
    AND planning_area='equipment_planning'
   ORDER BY service_key,planning_area,metric_key,basis,revision DESC,id DESC) latest
  WHERE latest.value_state='active';
  IF active_learning_count>0 THEN
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
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
    'componentManifest',adoption.component_manifest,
    'coverageAssessment',revision_value.coverage_assessment),
   'equipmentCostPlan',jsonb_build_object('id',cost_value.id,'revision',cost_value.revision,
    'digest',rtrim(cost_value.digest),'calculationVersion',cost_value.calculation_version),
   'equipmentPlan',jsonb_build_object('id',plan_value.id,'revision',plan_value.revision,
    'digest',rtrim(plan_value.digest),'calculationVersion',plan_value.calculation_version),
   'readinessPlan',jsonb_build_object('id',readiness_value.id,'revision',readiness_value.revision,
    'digest',rtrim(readiness_value.digest),'calculationVersion',readiness_value.calculation_version,
    'evidenceDigest',readiness_value.evidence->>'digest')));

  FOR plan_line IN SELECT value FROM jsonb_array_elements(plan_value.inputs->'lines')
  LOOP
   SELECT value INTO cost_line FROM jsonb_array_elements(cost_value.inputs->'lines') value
   WHERE value->>'lineId'=plan_line->>'lineId';
   SELECT value INTO readiness_line FROM jsonb_array_elements(readiness_value.inputs->'lines') value
   WHERE value->>'lineId'=plan_line->>'lineId';
   SELECT value INTO readiness_evidence_line
   FROM jsonb_array_elements(COALESCE(readiness_value.evidence->'lines','[]'::jsonb)) value
   WHERE value->>'lineId'=plan_line->>'lineId';
   IF plan_line->>'lineId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      plan_line->>'assetId' IS NULL OR cost_line IS NULL OR readiness_line IS NULL OR
      readiness_evidence_line IS NULL OR readiness_value.evidence->>'digest' IS NULL OR
      readiness_value.evidence->>'digest'<>public.canonical_completion_digest(readiness_value.evidence-'digest') OR
      readiness_value.evidence->'equipmentBasis' IS DISTINCT FROM jsonb_build_object(
       'planId',plan_value.id,'revision',plan_value.revision,'digest',rtrim(plan_value.digest)) OR
      cost_line->>'access' IS DISTINCT FROM plan_line->>'accessBasis' OR
      cost_line->>'plannedHours'!~'^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' OR
      (cost_line->>'plannedHours')::numeric<=0 OR
      readiness_line->'required' IS DISTINCT FROM 'true'::jsonb OR
      readiness_line->>'start' IS NULL OR readiness_line->>'end' IS NULL OR
      readiness_line->>'timeZone' IS DISTINCT FROM zone_value OR
      (readiness_line->>'start')::timestamptz<>candidate.scheduled_start OR
      (readiness_line->>'end')::timestamptz<>candidate.scheduled_end OR
      readiness_line#>>'{source,observedAt}' IS NULL OR
      readiness_line#>>'{source,validUntil}' IS NULL OR
      (readiness_line#>>'{source,observedAt}')::timestamptz>cutoff_value OR
      (readiness_line#>>'{source,validUntil}')::timestamptz<=cutoff_value OR
      (readiness_line#>>'{source,validUntil}')::timestamptz<candidate.scheduled_end OR
      readiness_line#>>'{source,start}' IS NULL OR readiness_line#>>'{source,end}' IS NULL OR
      (readiness_line#>>'{source,start}')::timestamptz<>candidate.scheduled_start OR
      (readiness_line#>>'{source,end}')::timestamptz<>candidate.scheduled_end OR
      COALESCE((readiness_line#>>'{source,quantity}')::integer,0)<1 THEN
    RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
     'current_adopted_readiness_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   planned_hours:=(cost_line->>'plannedHours')::numeric;
   IF planned_hours*INTERVAL '1 hour'>candidate.scheduled_end-candidate.scheduled_start THEN
    RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
     'approved_timing_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   asset_value:=NULL;pin_value:=NULL;
   SELECT * INTO asset_value FROM public.tenant_assets value
   WHERE value.organization_id=org AND value.id=(plan_line->>'assetId')::uuid;
   IF asset_value.id IS NOT NULL THEN
    SELECT * INTO pin_value FROM public.canonical_equipment_asset_versions value
    WHERE value.organization_id=org AND value.asset_id=asset_value.id
     AND value.asset_version=asset_value.version;
   END IF;
   IF asset_value.id IS NULL OR asset_value.catalogue_state<>'active' OR pin_value.asset_id IS NULL OR
      pin_value.review_state<>'reviewed' OR
      rtrim(pin_value.asset_digest)<>public.equipment_digest(to_jsonb(asset_value)) OR
      (SELECT jsonb_object_agg(identity_key,pin_value.private_configuration->identity_key)
       FROM unnest(ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments']) identity_key)
       IS DISTINCT FROM plan_line->'identity' THEN
    RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
     'exact_asset_identity_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   SELECT * INTO ledger_value FROM public.canonical_equipment_ledgers value
   WHERE value.organization_id=org AND value.asset_id=asset_value.id;
   SELECT count(*)::integer,count(*) FILTER(WHERE NOT EXISTS(
    SELECT 1 FROM public.canonical_equipment_events successor
    WHERE successor.organization_id=event.organization_id AND successor.supersedes_id=event.id))::integer
   INTO event_count,effective_count FROM public.canonical_equipment_events event
   WHERE event.organization_id=org AND event.asset_id=asset_value.id;
   ledger_complete:=ledger_value.asset_id IS NOT NULL AND event_count=ledger_value.revision AND
    (ledger_value.state->>'revision')::integer=ledger_value.revision AND
    (ledger_value.state->>'effectiveFactCount')::integer=effective_count AND
    rtrim(ledger_value.digest)=public.equipment_digest(ledger_value.state);
   IF NOT ledger_complete OR readiness_evidence_line->'complete' IS DISTINCT FROM 'true'::jsonb OR
      readiness_evidence_line->'sourceCurrent' IS DISTINCT FROM 'true'::jsonb OR
      readiness_evidence_line->>'assetId' IS DISTINCT FROM asset_value.id::text OR
      COALESCE((readiness_evidence_line->>'ledgerRevision')::integer,-1)<>ledger_value.revision OR
      rtrim(readiness_evidence_line->>'ledgerDigest') IS DISTINCT FROM rtrim(ledger_value.digest) OR
      readiness_evidence_line->'state' IS DISTINCT FROM ledger_value.state THEN
    RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
     'current_readiness_evidence_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   asset_access_type:=COALESCE(pin_value.private_configuration->>'accessType','unknown');
   use_rows:=use_rows||jsonb_build_array(jsonb_build_object(
    'sourceIndex',source_index,'assetId',asset_value.id,'assetVersion',asset_value.version,
    'assetDigest',rtrim(pin_value.asset_digest),'category',asset_value.category,
    'assetAccessType',asset_access_type,'planAccessBasis',plan_line->>'accessBasis',
    'lineId',plan_line->>'lineId','startsAt',public.canonical_forecast_utc_instant(candidate.scheduled_start),
    'endsAt',public.canonical_forecast_utc_instant(candidate.scheduled_end),
    'claimedOperatingHours',public.canonical_forecast_asset_hours_v1(planned_hours),
    'sourceCondition',readiness_line#>>'{source,condition}',
    'meterKey',readiness_line#>>'{maintenance,meterKey}',
    'threshold',readiness_line#>>'{maintenance,threshold}',
    'unit',readiness_line#>>'{maintenance,unit}',
    'thresholdReference',readiness_line#>>'{maintenance,reference}'));
   line_count:=line_count+1;
   IF line_count>10000 THEN
    RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
     'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
  END LOOP;
  source_index:=source_index+1;
 END LOOP;
 IF scheduled_count+unscheduled_count+outside_count<>position_count THEN
  RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
   'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 IF unscheduled_count>0 THEN
  RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
   'approved_timing_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;

 FOR asset_row IN
  SELECT DISTINCT (value->>'assetId')::uuid asset_id
  FROM jsonb_array_elements(use_rows) value ORDER BY asset_id
 LOOP
  SELECT count(*)::integer,sum((value->>'claimedOperatingHours')::numeric),
   count(DISTINCT jsonb_build_object('meterKey',value->>'meterKey','threshold',value->>'threshold',
    'unit',value->>'unit','reference',value->>'thresholdReference'))::integer,
   min(value->>'meterKey'),min(value->>'unit'),min(value->>'thresholdReference'),
   min(value->>'planAccessBasis'),min(value->>'assetAccessType'),
   CASE max(CASE value->>'sourceCondition' WHEN 'out_of_service' THEN 3
    WHEN 'problem_reported' THEN 2 WHEN 'unknown' THEN 1
    WHEN 'reported_no_problem' THEN 0 ELSE 4 END)
    WHEN 3 THEN 'out_of_service' WHEN 2 THEN 'problem_reported'
    WHEN 1 THEN 'unknown' WHEN 0 THEN 'reported_no_problem' ELSE NULL END,
   count(DISTINCT value->>'planAccessBasis')::integer
  INTO use_count,claimed_hours,policy_count,meter_key_value,meter_unit_value,
   threshold_reference,access_basis_value,asset_access_type,source_condition_value,
   access_basis_count
  FROM jsonb_array_elements(use_rows) value
  WHERE (value->>'assetId')::uuid=asset_row.asset_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceIndex',(value->>'sourceIndex')::integer,
   'lineId',value->>'lineId','plannedWindow',jsonb_build_object('startsAt',value->>'startsAt',
   'endsAt',value->>'endsAt'),'claimedOperatingHours',value->>'claimedOperatingHours')
   ORDER BY (value->>'sourceIndex')::integer,value->>'lineId'),'[]'::jsonb)
  INTO uses_value FROM jsonb_array_elements(use_rows) value
  WHERE (value->>'assetId')::uuid=asset_row.asset_id;
  SELECT EXISTS(
   SELECT 1 FROM jsonb_array_elements(use_rows) left_use
   JOIN jsonb_array_elements(use_rows) right_use ON
    (left_use->>'assetId')::uuid=(right_use->>'assetId')::uuid AND
    ((left_use->>'sourceIndex')::integer<(right_use->>'sourceIndex')::integer OR
     (left_use->>'sourceIndex')::integer=(right_use->>'sourceIndex')::integer AND
      left_use->>'lineId'<right_use->>'lineId') AND
    (left_use->>'startsAt')::timestamptz<(right_use->>'endsAt')::timestamptz AND
    (right_use->>'startsAt')::timestamptz<(left_use->>'endsAt')::timestamptz
   WHERE (left_use->>'assetId')::uuid=asset_row.asset_id) INTO overlap_value;
  IF access_basis_count<>1 OR source_condition_value IS NULL THEN
   RETURN public.canonical_forecast_asset_utilization_risk_v1_unavailable(
    'current_adopted_readiness_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  SELECT * INTO asset_value FROM public.tenant_assets value
  WHERE value.organization_id=org AND value.id=asset_row.asset_id;
  SELECT * INTO pin_value FROM public.canonical_equipment_asset_versions value
  WHERE value.organization_id=org AND value.asset_id=asset_row.asset_id
   AND value.asset_version=asset_value.version;
  SELECT * INTO ledger_value FROM public.canonical_equipment_ledgers value
  WHERE value.organization_id=org AND value.asset_id=asset_row.asset_id;
  SELECT count(*)::integer,count(*) FILTER(WHERE NOT EXISTS(
   SELECT 1 FROM public.canonical_equipment_events successor
   WHERE successor.organization_id=event.organization_id AND successor.supersedes_id=event.id))::integer
  INTO event_count,effective_count FROM public.canonical_equipment_events event
  WHERE event.organization_id=org AND event.asset_id=asset_row.asset_id;
  ledger_complete:=ledger_value.asset_id IS NOT NULL AND event_count=ledger_value.revision AND
   (ledger_value.state->>'revision')::integer=ledger_value.revision AND
   (ledger_value.state->>'effectiveFactCount')::integer=effective_count AND
   rtrim(ledger_value.digest)=public.equipment_digest(ledger_value.state);
  meter_event:=NULL;meter_current:=FALSE;reset_applied:=FALSE;correction_applied:=FALSE;
  IF policy_count=1 AND meter_key_value IS NOT NULL AND meter_unit_value='hours' AND
     threshold_reference IS NOT NULL AND length(btrim(threshold_reference))>0 AND
     ledger_complete THEN
   SELECT event.id,event.revision,event.digest,event.supersedes_id,event.document,event.recorded_at
   INTO meter_event FROM public.canonical_equipment_events event
   WHERE event.organization_id=org AND event.asset_id=asset_row.asset_id
    AND event.document->>'meterKey'=meter_key_value AND event.document->>'reading' IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events successor
     WHERE successor.organization_id=event.organization_id AND successor.supersedes_id=event.id)
   ORDER BY event.revision DESC,event.id DESC LIMIT 1;
   IF meter_event.id IS NOT NULL AND meter_event.document->>'unit'='hours' AND
      (meter_event.document->>'observedAt')::timestamptz<=source_as_of_value AND
      ledger_value.state#>>ARRAY['readings',meter_key_value,'unit']='hours' AND
      ledger_value.state#>>ARRAY['readings',meter_key_value,'reading']=meter_event.document->>'reading' THEN
    meter_current:=TRUE;current_reading:=(meter_event.document->>'reading')::numeric;
    correction_applied:=meter_event.supersedes_id IS NOT NULL;
    SELECT EXISTS(SELECT 1 FROM public.canonical_equipment_events event
     WHERE event.organization_id=org AND event.asset_id=asset_row.asset_id
      AND event.document->>'meterKey'=meter_key_value AND event.document->>'kind'='meter_reset'
      AND event.revision<=meter_event.revision
      AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events successor
       WHERE successor.organization_id=event.organization_id AND successor.supersedes_id=event.id))
    INTO reset_applied;
   END IF;
  END IF;
  meter_value:=CASE WHEN meter_current THEN jsonb_build_object('state','current_as_of_source',
   'meterKey',meter_key_value,'unit','hours',
   'reading',public.canonical_forecast_asset_hours_v1(current_reading),
   'observedAt',public.canonical_forecast_utc_instant((meter_event.document->>'observedAt')::timestamptz),
   'eventId',meter_event.id,'eventRevision',meter_event.revision,'eventDigest',rtrim(meter_event.digest),
   'ledgerRevision',ledger_value.revision,'ledgerDigest',rtrim(ledger_value.digest),
   'resetApplied',reset_applied,'correctionApplied',correction_applied,
   'historyComplete',TRUE,'reason',NULL)
  ELSE jsonb_build_object('state','unavailable','meterKey',meter_key_value,'unit',meter_unit_value,
   'reading',NULL,'observedAt',NULL,'eventId',NULL,'eventRevision',NULL,'eventDigest',NULL,
   'ledgerRevision',CASE WHEN ledger_value.asset_id IS NULL THEN NULL ELSE ledger_value.revision END,
   'ledgerDigest',CASE WHEN ledger_value.asset_id IS NULL THEN NULL ELSE rtrim(ledger_value.digest) END,
   'resetApplied',NULL,'correctionApplied',NULL,'historyComplete',FALSE,
   'reason',CASE WHEN policy_count<>1 OR meter_key_value IS NULL THEN 'maintenance_threshold_policy_unavailable'
    WHEN meter_unit_value<>'hours' THEN 'compatible_current_hours_meter_unavailable'
    WHEN NOT ledger_complete THEN 'complete_meter_history_unavailable'
    ELSE 'compatible_current_hours_meter_unavailable' END) END;
  threshold_value:=NULL;service_current:=FALSE;
   IF asset_access_type='owned' AND access_basis_value='owned' AND
      meter_current AND NOT overlap_value THEN
   SELECT min((value->>'threshold')::numeric) INTO threshold_value
   FROM jsonb_array_elements(use_rows) value
   WHERE (value->>'assetId')::uuid=asset_row.asset_id AND value->>'threshold' IS NOT NULL;
   service_current:=threshold_value IS NOT NULL AND threshold_value>0;
  END IF;
  IF service_current THEN
   projected_reading:=current_reading+claimed_hours;
   service_interval:=jsonb_build_object('state','current_claimed_plan_position',
    'meterKey',meter_key_value,'unit','hours',
    'threshold',public.canonical_forecast_asset_hours_v1(threshold_value),
    'thresholdReference',threshold_reference,
    'currentReading',public.canonical_forecast_asset_hours_v1(current_reading),
    'projectedReading',public.canonical_forecast_asset_hours_v1(projected_reading),
    'hoursRemainingAtStart',public.canonical_forecast_asset_hours_v1(
     greatest(threshold_value-current_reading,0)),
    'thresholdReachedNow',current_reading>=threshold_value,
    'thresholdReachedByClaimedPlan',projected_reading>=threshold_value,
    'verifiedServiceDate',NULL,'reason',NULL);
   ELSE
   service_interval:=jsonb_build_object('state','unavailable','meterKey',meter_key_value,
    'unit',meter_unit_value,'threshold',NULL,'thresholdReference',NULL,'currentReading',NULL,
    'projectedReading',NULL,'hoursRemainingAtStart',NULL,'thresholdReachedNow',NULL,
    'thresholdReachedByClaimedPlan',NULL,'verifiedServiceDate',NULL,
     'reason',CASE WHEN asset_access_type<>'owned' OR access_basis_value<>'owned'
      THEN 'rental_or_lease_provider_evidence_unavailable'
      WHEN overlap_value THEN 'non_overlapping_planned_utilization_unavailable'
      WHEN NOT meter_current THEN meter_value->>'reason' ELSE 'maintenance_threshold_policy_unavailable' END);
   END IF;
   maintenance_due:=jsonb_build_object('state','unavailable','dueAt',NULL,
    'dueWithinHorizon',NULL,'dueByRecordedMeter',NULL,'dueByClaimedPlanEnd',NULL,
    'maintenanceScheduleVerified',FALSE,'maintenanceWorkAuthorized',FALSE,
    'reason','maintenance_schedule_unavailable');
   IF asset_access_type<>'owned' OR access_basis_value<>'owned' THEN
    provider_unavailable_count:=provider_unavailable_count+1;
   END IF;
   IF overlap_value OR asset_access_type<>'owned' OR access_basis_value<>'owned' THEN
    unavailable_utilization_count:=unavailable_utilization_count+1;
   ELSE utilization_hours:=utilization_hours+claimed_hours;END IF;
   IF NOT service_current THEN
    unavailable_service_count:=unavailable_service_count+1;
   END IF;
  assets:=assets||jsonb_build_array(jsonb_build_object(
   'asset',jsonb_build_object('id',asset_value.id,'version',asset_value.version,
    'digest',rtrim(pin_value.asset_digest),'category',asset_value.category,
    'accessType',asset_access_type,'planAccessBasis',access_basis_value),
    'plannedUtilization',CASE WHEN asset_access_type<>'owned' OR access_basis_value<>'owned'
     THEN jsonb_build_object('state','unavailable','claimedOperatingHours',NULL,
     'useCount',use_count,'uses',uses_value,'operatingTimeVerified',FALSE,
     'checkoutDurationUsed',FALSE,'reason','rental_or_lease_provider_evidence_unavailable')
     WHEN overlap_value THEN jsonb_build_object('state','unavailable',
    'claimedOperatingHours',NULL,'useCount',use_count,'uses',uses_value,
    'operatingTimeVerified',FALSE,'checkoutDurationUsed',FALSE,
    'reason','non_overlapping_planned_utilization_unavailable')
    ELSE jsonb_build_object('state','current_claimed_plan_only',
    'claimedOperatingHours',public.canonical_forecast_asset_hours_v1(claimed_hours),
    'useCount',use_count,'uses',uses_value,'operatingTimeVerified',FALSE,
    'checkoutDurationUsed',FALSE,'reason',NULL) END,
   'meter',meter_value,'serviceInterval',service_interval,'maintenanceDue',maintenance_due,
   'serviceTiming',jsonb_build_object('state','unavailable','serviceAt',NULL,
    'reason','operating_hour_timing_unavailable'),
   'currentReadiness',CASE WHEN ledger_complete THEN jsonb_build_object('state','current_as_of_source',
    'recordedDowntime',(ledger_value.state->>'downtime')::boolean,
    'recordedFault',(ledger_value.state->>'recordedFault')::boolean,
    'sourceCondition',source_condition_value,'reason',NULL)
    ELSE jsonb_build_object('state','unavailable','recordedDowntime',NULL,
    'recordedFault',NULL,'sourceCondition',NULL,'reason','complete_equipment_history_unavailable') END,
   'rentalLease',CASE WHEN asset_access_type='owned' AND access_basis_value='owned'
    THEN jsonb_build_object('state','owned_current','assetAccessType',asset_access_type,
     'planAccessBasis',access_basis_value,'providerAvailabilityVerified',FALSE,
     'providerMaintenanceVerified',FALSE,'reason',NULL)
    ELSE jsonb_build_object('state','provider_semantics_unavailable',
     'assetAccessType',asset_access_type,'planAccessBasis',access_basis_value,
     'providerAvailabilityVerified',FALSE,'providerMaintenanceVerified',FALSE,
     'reason','rental_or_lease_provider_evidence_unavailable') END,
   'downtimeRisk',jsonb_build_object('state','unavailable','risk',NULL,'probability',NULL,
    'reason','evaluated_downtime_risk_evidence_unavailable')));
  asset_count:=asset_count+1;
 END LOOP;
 source_manifest:=jsonb_build_object(
  'sourceAsOf',public.canonical_forecast_utc_instant(source_as_of_value),
  'horizon',jsonb_build_object('startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'timeZone',zone_value,
   'startsOn',start_day::text,'endsOnExclusive',end_day::text),
  'coverage',jsonb_build_object('currentBookedPositionCount',position_count,
   'scheduledJobCount',scheduled_count,'unscheduledJobCount',unscheduled_count,
   'outsideWindowCount',outside_count,'hasMore',FALSE),
  'sources',sources,'uses',use_rows,
  'meterSources',assets);
 source_digest:=public.canonical_completion_digest(source_manifest);
 run_payload:=jsonb_build_object('version','m26-asset-utilization-risk-calculation-v1',
  'sourceDigest',source_digest,'assets',assets);
 run_digest:=public.canonical_completion_digest(run_payload);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-asset-utilization-risk-forecast-v1','state','current','reason',NULL,
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
   'outsideWindowCount',outside_count,'equipmentRevisionCount',source_index,
   'readinessRevisionCount',source_index,'plannedUseCount',line_count,
   'assetCount',asset_count,'reason',NULL),
  'sources',sources,'assets',assets,
   'utilization',CASE WHEN unavailable_utilization_count=0 THEN jsonb_build_object(
    'state','current_claimed_plan_only','assetCount',asset_count,'useCount',line_count,
    'claimedOperatingHours',public.canonical_forecast_asset_hours_v1(utilization_hours),
    'operatingTimeVerified',FALSE,'checkoutDurationUsed',FALSE,'reason',NULL)
   ELSE jsonb_build_object('state','unavailable','assetCount',asset_count,'useCount',line_count,
    'claimedOperatingHours',NULL,'operatingTimeVerified',FALSE,'checkoutDurationUsed',FALSE,
     'reason',CASE WHEN provider_unavailable_count>0
      THEN 'rental_or_lease_provider_evidence_unavailable'
      ELSE 'non_overlapping_planned_utilization_unavailable' END) END,
  'learnedOutcomes',jsonb_build_object('state','none_current','applicableValueCount',0,
   'applied',FALSE,'reason','no_compatible_current_owner_adopted_operating_hour_value'),
  'evidence',jsonb_build_object('sourceAuthenticatedUtilization',TRUE,
   'currentAdoptedEquipmentVerified',TRUE,'currentReadinessVerified',TRUE,
   'currentnessVerified',TRUE,'compatibleUnitsVerified',TRUE,
   'periodAttributionVerified',TRUE,
   'meterHistoryVerified',asset_count>0 AND unavailable_service_count=0,
   'serviceThresholdPolicyVerified',asset_count>0 AND unavailable_service_count=0,
   'maintenanceScheduleVerified',FALSE,
   'rentalLeaseProviderEvidenceVerified',FALSE,'m25AdjustmentApplied',FALSE,
   'evaluatedDowntimeRiskVerified',FALSE),
  'run',jsonb_build_object('calculationVersion','m26-asset-utilization-risk-calculation-v1',
   'sourceDigest',source_digest,'digest',run_digest),
   'forecastIssued',unavailable_utilization_count=0 AND provider_unavailable_count=0,
   'utilizationForecastIssued',unavailable_utilization_count=0 AND provider_unavailable_count=0,
   'serviceIntervalForecastIssued',asset_count>0 AND unavailable_service_count=0
    AND provider_unavailable_count=0,
   'maintenanceDueForecastIssued',FALSE,
  'serviceTimingForecastIssued',FALSE,'downtimeRiskForecastIssued',FALSE,
  'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,
  'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_asset_hours_v1(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_asset_utilization_risk_v1_unavailable(
 TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_asset_utilization_risk_v1_lock_sources(
 UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_asset_utilization_risk_v1_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_asset_utilization_risk_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
 END IF;
END $$;
