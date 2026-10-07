-- Mission 26 Part 8A: authenticated material demand and fail-closed resource risk.
-- Demand is derived only from current owner-confirmed booked work and the exact
-- adopted Mission 24 v3 composition. Mission 23 movements are usage evidence,
-- and Mission 25 imports are observations; neither is promoted to an on-hand
-- ledger, future receipt, replenishment policy, supplier promise, or order authority.

CREATE FUNCTION public.canonical_forecast_material_quantity_v1(value NUMERIC)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT regexp_replace(regexp_replace(
  to_char(round(value,6),'FM999999999999990.000000'),'0+$',''),'\.$','')
$$;

CREATE FUNCTION public.canonical_forecast_material_demand_risk_v1_unavailable(
 reason_value TEXT,cutoff_value TIMESTAMPTZ,source_as_of_value TIMESTAMPTZ,zone_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE horizon_value TIMESTAMPTZ:=cutoff_value+INTERVAL '2592000 seconds';
 start_day DATE:=(cutoff_value AT TIME ZONE COALESCE(zone_value,'UTC'))::date;
 end_day DATE:=(horizon_value AT TIME ZONE COALESCE(zone_value,'UTC'))::date;
BEGIN RETURN jsonb_build_object(
 'version','m26-material-demand-risk-forecast-v1','state','unavailable','reason',reason_value,
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
  'unscheduledJobCount',NULL,'outsideWindowCount',NULL,'materialRevisionCount',NULL,
  'componentLineCount',NULL,'reason',reason_value),
 'sources',NULL,
 'demand',jsonb_build_object('state','unavailable','groupCount',NULL,'componentCount',NULL,
  'groups',NULL,'reason',reason_value),
 'inventory',jsonb_build_object('state','unavailable','onHand',NULL,
  'compatibleStockIdentityVerified',FALSE,'transactionCoverageVerified',FALSE,
  'receiptSemanticsVerified',FALSE,'m23UsageApplied',FALSE,
  'reason','source_owned_inventory_ledger_unavailable'),
 'futureReceipts',jsonb_build_object('state','unavailable','quantity',NULL,
  'receiptDatesVerified',FALSE,'reason','future_receipts_unavailable'),
 'replenishment',jsonb_build_object('state','unavailable','leadTimeDays',NULL,
  'cutoffAt',NULL,'leadTimePolicyVerified',FALSE,'cutoffPolicyVerified',FALSE,
  'supplierAvailabilityVerified',FALSE,'purchaseAuthorityVerified',FALSE,
  'reason','replenishment_policy_unavailable'),
 'reorder',jsonb_build_object('state','unavailable','reorderAt',NULL,
  'reason','inventory_receipts_and_replenishment_unavailable'),
 'stockoutRisk',jsonb_build_object('state','unavailable','risk',NULL,
  'shortageQuantity',NULL,'reason','inventory_receipts_and_replenishment_unavailable'),
 'purchasingRisk',jsonb_build_object('state','unavailable','risk',NULL,
  'reason','supplier_and_purchase_authority_unavailable'),
 'learnedOutcomes',jsonb_build_object('state','unavailable','applicableValueCount',NULL,
  'applied',FALSE,'reason',reason_value),
 'evidence',jsonb_build_object('sourceAuthenticatedDemand',FALSE,
  'currentAdoptedCompositionVerified',FALSE,'currentnessVerified',FALSE,
  'compatibleUnitsVerified',FALSE,'periodAttributionVerified',FALSE,
  'inventoryVerified',FALSE,'futureReceiptsVerified',FALSE,
  'replenishmentPolicyVerified',FALSE,'supplierAvailabilityVerified',FALSE,
  'purchaseAuthorityVerified',FALSE,'m25AdjustmentApplied',FALSE),
 'run',jsonb_build_object('calculationVersion','m26-material-demand-risk-calculation-v1',
  'sourceDigest',NULL,'digest',NULL),
 'forecastIssued',FALSE,'demandForecastIssued',FALSE,'reorderForecastIssued',FALSE,
 'stockoutForecastIssued',FALSE,'purchasingRiskForecastIssued',FALSE,
 'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_material_demand_risk_v1_lock_sources(org UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cohort_before UUID[];cohort_after UUID[];
BEGIN
 -- Discover a bounded candidate cohort without retaining a conflicting table
 -- lock. Delivery, issued-version and all M24 writers acquire the estimate row
 -- before writing their dependent relation, so those rows must be first.
 WITH positions AS(
  SELECT value.appointment_id
  FROM public.canonical_forecast_current_backlog_booking_positions value
  WHERE value.organization_id=org AND value.active
  ORDER BY value.appointment_id LIMIT 501),
 cohort AS(
  SELECT DISTINCT version.estimate_id
  FROM positions
  JOIN LATERAL(
   SELECT review.*
   FROM public.canonical_forecast_commercial_booking_reviews review
   WHERE review.organization_id=org
    AND review.appointment_id=positions.appointment_id
   ORDER BY review.review_order DESC,review.id DESC LIMIT 1) latest ON TRUE
  JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=latest.organization_id
    AND confirmation.review_id=latest.id
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=latest.organization_id
    AND version.id=latest.issued_version_id
  WHERE latest.action<>'booking_cancelled')
 SELECT COALESCE(array_agg(estimate_id ORDER BY estimate_id),ARRAY[]::UUID[])
 INTO cohort_before FROM cohort;
 PERFORM estimate_value.id FROM public.canonical_estimates estimate_value
 WHERE estimate_value.organization_id=org
  AND estimate_value.id=ANY(cohort_before)
 ORDER BY estimate_value.id FOR SHARE OF estimate_value;
 -- Now drain the released schedule/current-position fence in its established
 -- order. A writer already holding a relevant estimate row can finish before
 -- this transaction owns any dependent-table lock that writer still needs.
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 -- Keep dependent commercial tables in their real writer order: delivery
 -- events precede commercial orders; booking orders precede reviews and
 -- confirmations. Estimate-version, M24 and M25 writers all follow the row
 -- fence above.
 LOCK TABLE public.canonical_business_profiles,
  public.canonical_customer_estimate_delivery_events,
  public.canonical_forecast_commercial_booking_orders,
  public.canonical_customer_estimate_versions,
  public.canonical_forecast_booking_approval_orders,
  public.canonical_forecast_commercial_booking_reviews,
  public.canonical_forecast_booked_work_confirmations,
  public.canonical_estimate_proposal_adoptions,
  public.canonical_material_plans,
  public.canonical_polaris_snapshots,
  public.canonical_job_outcome_planning_value_versions IN SHARE MODE;
 -- Nested currentness readers use this established order. Try-lock only after
 -- row and table drainage, so a writer holding an estimate row can never wait
 -- behind a lock held by the reader that is waiting for that same row.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Material-demand commercial source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Material-demand profile source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Material-demand price source is busy' USING ERRCODE='55P03';
 END IF;
 -- Cohort discovery was intentionally optimistic. Under the complete writer
 -- fence, derive it again and reject any newly eligible, removed or remapped
 -- estimate rather than reading a source row that was not locked above.
 WITH positions AS(
  SELECT value.appointment_id
  FROM public.canonical_forecast_current_backlog_booking_positions value
  WHERE value.organization_id=org AND value.active
  ORDER BY value.appointment_id LIMIT 501),
 cohort AS(
  SELECT DISTINCT version.estimate_id
  FROM positions
  JOIN LATERAL(
   SELECT review.*
   FROM public.canonical_forecast_commercial_booking_reviews review
   WHERE review.organization_id=org
    AND review.appointment_id=positions.appointment_id
   ORDER BY review.review_order DESC,review.id DESC LIMIT 1) latest ON TRUE
  JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=latest.organization_id
    AND confirmation.review_id=latest.id
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=latest.organization_id
    AND version.id=latest.issued_version_id
  WHERE latest.action<>'booking_cancelled')
 SELECT COALESCE(array_agg(estimate_id ORDER BY estimate_id),ARRAY[]::UUID[])
 INTO cohort_after FROM cohort;
 IF cohort_after IS DISTINCT FROM cohort_before THEN
  RAISE EXCEPTION 'Material-demand source cohort changed' USING ERRCODE='40001';
 END IF;
END $$;

CREATE FUNCTION public.canonical_forecast_material_demand_risk_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;cutoff_value TIMESTAMPTZ;source_as_of_value TIMESTAMPTZ;
 horizon_value TIMESTAMPTZ;zone_value TEXT;position_count INTEGER:=0;
 scheduled_count INTEGER:=0;unscheduled_count INTEGER:=0;outside_count INTEGER:=0;
 source_index INTEGER:=0;line_count INTEGER:=0;active_learning_count INTEGER:=0;
 profile public.canonical_business_profiles%ROWTYPE;candidate RECORD;booked RECORD;
 revision_value public.canonical_estimate_revisions%ROWTYPE;
 adoption public.canonical_estimate_proposal_adoptions%ROWTYPE;
 plan_value public.canonical_material_plans%ROWTYPE;booking_state JSONB;plan_result JSONB;
 line_value JSONB;service_value TEXT;base_quantity NUMERIC;waste_percent NUMERIC;
 planned_quantity NUMERIC;waste_quantity NUMERIC;sources JSONB:='[]'::jsonb;
 line_rows JSONB:='[]'::jsonb;groups JSONB:='[]'::jsonb;source_manifest JSONB;
 source_digest TEXT;run_payload JSONB;run_digest TEXT;seen_estimates UUID[]:=ARRAY[]::uuid[];
 start_day DATE;end_day DATE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for material-demand forecast' USING ERRCODE='25001';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
 horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 PERFORM public.canonical_forecast_material_demand_risk_v1_lock_sources(org);
 -- statement_timestamp() predates any lock wait. Capture the wall clock only
 -- after the complete writer fence is held so every included revision is no
 -- later than the advertised source boundary.
 source_as_of_value:=clock_timestamp();
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO profile FROM public.canonical_business_profiles value
 WHERE value.organization_id=org AND value.is_active=TRUE
 ORDER BY value.version_number DESC,value.id DESC LIMIT 1 FOR SHARE;
 zone_value:=profile.raw_profile#>>'{company,timeZone}';
 IF profile.id IS NULL OR zone_value IS NULL OR NOT EXISTS(
    SELECT 1 FROM pg_timezone_names WHERE name=zone_value) THEN
  RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
   'business_calendar_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 start_day:=(cutoff_value AT TIME ZONE zone_value)::date;
 end_day:=(horizon_value AT TIME ZONE zone_value)::date;
 SELECT count(*)::integer INTO position_count
 FROM public.canonical_forecast_current_backlog_booking_positions value
 WHERE value.organization_id=org AND value.active;
 IF position_count>500 THEN
  RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
   'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
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
  IF candidate.scheduled_start IS NULL OR candidate.scheduled_end IS NULL OR
     candidate.scheduled_end<=candidate.scheduled_start OR
     (candidate.scheduled_start<cutoff_value AND candidate.scheduled_end>cutoff_value) OR
     (candidate.scheduled_start<horizon_value AND candidate.scheduled_end>horizon_value) THEN
   RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
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
   RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  booking_state:=public.canonical_forecast_booked_work_confirmation_currentness(
   org,actor,role_value,session_value,booked.confirmation_id);
  IF booking_state->>'state'<>'owner_confirmed_booked_work_current' OR
     booking_state->'bookedWorkVerified' IS DISTINCT FROM 'true'::jsonb THEN
   RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
    'current_owner_confirmed_booking_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  IF booked.estimate_id=ANY(seen_estimates) THEN
   RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
    'duplicate_current_job_material_source',cutoff_value,source_as_of_value,zone_value);
  END IF;
  seen_estimates:=array_append(seen_estimates,booked.estimate_id);
  revision_value:=NULL;adoption:=NULL;plan_value:=NULL;
  SELECT * INTO revision_value FROM public.canonical_estimate_revisions value
  WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
  ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  SELECT * INTO adoption FROM public.canonical_estimate_proposal_adoptions value
  WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
  ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF revision_value.id IS NOT NULL THEN
   SELECT * INTO plan_value FROM public.canonical_material_plans value
   WHERE value.organization_id=org AND value.estimate_id=booked.estimate_id
    AND value.id=revision_value.material_plan_id;
  END IF;
  IF revision_value.id IS NULL OR revision_value.calculation_version<>'estimate-cost-adoption-v3' OR
     adoption.id IS NULL OR adoption.child_id<>revision_value.id OR
     adoption.component_manifest IS DISTINCT FROM revision_value.component_manifest OR
     adoption.material_plan_id IS DISTINCT FROM revision_value.material_plan_id OR
     plan_value.id IS NULL OR plan_value.action<>'save' OR
     plan_value.calculation_version<>'estimate-material-plan-v4' OR
     EXISTS(SELECT 1 FROM public.canonical_material_plans newer
      WHERE newer.organization_id=org AND newer.estimate_id=booked.estimate_id
       AND (newer.revision>plan_value.revision OR
        (newer.revision=plan_value.revision AND newer.id>plan_value.id))) THEN
   RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
    'current_adopted_material_composition_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  SELECT snapshot.snapshot#>>'{service,key}' INTO service_value
  FROM public.canonical_polaris_snapshots snapshot
  WHERE snapshot.organization_id=org AND snapshot.estimate_id=booked.estimate_id
  ORDER BY snapshot.created_at DESC,snapshot.id DESC LIMIT 1;
  plan_result:=public.canonical_forecast_material_cost_v1_plan_result(
   plan_value.inputs,plan_value.currency,service_value,cutoff_value,
   candidate.scheduled_start,candidate.scheduled_end);
  IF plan_result->>'state'<>'current' THEN
   RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
    'current_adopted_material_composition_unavailable',cutoff_value,source_as_of_value,zone_value);
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
   RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
    'compatible_m25_outcome_unavailable',cutoff_value,source_as_of_value,zone_value);
  END IF;
  sources:=sources||jsonb_build_array(jsonb_build_object(
   'sourceIndex',source_index,
   'job',jsonb_build_object('appointmentId',candidate.appointment_id,
    'assignmentId',candidate.assignment_id,'bookingReviewId',booked.id,
    'bookingConfirmationId',booked.confirmation_id,'issuedVersionId',booked.issued_version_id,
    'plannedWindow',jsonb_build_object(
     'startsAt',public.canonical_forecast_utc_instant(candidate.scheduled_start),
     'endsAt',public.canonical_forecast_utc_instant(candidate.scheduled_end))),
   'estimate',jsonb_build_object('id',booked.estimate_id,
    'revisionId',revision_value.id,'revision',revision_value.revision,
    'digest',rtrim(revision_value.digest)),
   'composition',jsonb_build_object('id',adoption.id,'revision',adoption.revision,
    'digest',rtrim(adoption.digest),'calculationVersion',revision_value.calculation_version,
    'componentManifest',adoption.component_manifest,
    'coverageAssessment',revision_value.coverage_assessment),
   'materialPlan',jsonb_build_object('id',plan_value.id,'revision',plan_value.revision,
    'digest',rtrim(plan_value.digest),'calculationVersion',plan_value.calculation_version)));
  FOR line_value IN SELECT value FROM jsonb_array_elements(plan_value.inputs->'lines')
  LOOP
   IF line_value->>'lineId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      line_value->>'material' IS NULL OR line_value#>>'{evidence,materialSpecification}' IS NULL OR
      line_value#>>'{availability,location}' IS NULL OR
      line_value->>'unit' NOT IN('ea','m','m2','m3','ft','ft2','ft3','yd3','kg','lb','l','gal') OR
      line_value->>'quantity'!~'^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' OR
      line_value->>'wastePercent'!~'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$' THEN
    RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
     'current_adopted_material_composition_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   base_quantity:=(line_value->>'quantity')::numeric;
   waste_percent:=(line_value->>'wastePercent')::numeric;
   planned_quantity:=CASE WHEN line_value->>'unit'='ea'
    THEN ceil(base_quantity*(1+waste_percent/100))
    ELSE ceil(base_quantity*(1+waste_percent/100)*1000000)/1000000 END;
   waste_quantity:=planned_quantity-base_quantity;
   IF base_quantity<=0 OR planned_quantity>999999999999999.999999 THEN
    RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
     'current_adopted_material_composition_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
   line_rows:=line_rows||jsonb_build_array(jsonb_build_object(
    'materialLabel',line_value->>'material',
    'materialSpecification',line_value#>>'{evidence,materialSpecification}',
    'procurementLocation',line_value#>>'{availability,location}',
    'unit',line_value->>'unit',
    'startsAt',public.canonical_forecast_utc_instant(candidate.scheduled_start),
    'endsAt',public.canonical_forecast_utc_instant(candidate.scheduled_end),
    'baseQuantity',public.canonical_forecast_material_quantity_v1(base_quantity),
    'wasteQuantity',public.canonical_forecast_material_quantity_v1(waste_quantity),
    'plannedQuantity',public.canonical_forecast_material_quantity_v1(planned_quantity),
    'component',jsonb_build_object('sourceIndex',source_index,
     'lineId',line_value->>'lineId',
     'baseQuantity',public.canonical_forecast_material_quantity_v1(base_quantity),
     'wasteQuantity',public.canonical_forecast_material_quantity_v1(waste_quantity),
     'plannedQuantity',public.canonical_forecast_material_quantity_v1(planned_quantity))));
   line_count:=line_count+1;
   IF line_count>10000 THEN
    RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
     'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
   END IF;
  END LOOP;
  source_index:=source_index+1;
 END LOOP;
 IF scheduled_count+unscheduled_count+outside_count<>position_count THEN
  RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
   'complete_source_coverage_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 IF unscheduled_count>0 THEN
  RETURN public.canonical_forecast_material_demand_risk_v1_unavailable(
   'approved_timing_attribution_unavailable',cutoff_value,source_as_of_value,zone_value);
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'identity',jsonb_build_object('materialLabel',grouped.material_label,
   'materialSpecification',grouped.material_specification,
   'procurementLocation',grouped.procurement_location),
  'unit',grouped.unit_value,
  'plannedWindow',jsonb_build_object('startsAt',grouped.starts_at,'endsAt',grouped.ends_at),
  'baseQuantity',public.canonical_forecast_material_quantity_v1(grouped.base_quantity),
  'wasteQuantity',public.canonical_forecast_material_quantity_v1(grouped.waste_quantity),
  'plannedQuantity',public.canonical_forecast_material_quantity_v1(grouped.planned_quantity),
  'components',grouped.components)
  ORDER BY grouped.starts_at,grouped.ends_at,grouped.material_specification,
   grouped.procurement_location,grouped.unit_value,grouped.material_label),'[]'::jsonb)
 INTO groups FROM(
  SELECT row_value->>'materialLabel' material_label,
   row_value->>'materialSpecification' material_specification,
   row_value->>'procurementLocation' procurement_location,
   row_value->>'unit' unit_value,row_value->>'startsAt' starts_at,row_value->>'endsAt' ends_at,
   sum((row_value->>'baseQuantity')::numeric) base_quantity,
   sum((row_value->>'wasteQuantity')::numeric) waste_quantity,
   sum((row_value->>'plannedQuantity')::numeric) planned_quantity,
   jsonb_agg(row_value->'component' ORDER BY
    (row_value#>>'{component,sourceIndex}')::integer,row_value#>>'{component,lineId}') components
  FROM jsonb_array_elements(line_rows) row_source(row_value)
  GROUP BY row_value->>'materialLabel',row_value->>'materialSpecification',
   row_value->>'procurementLocation',row_value->>'unit',
   row_value->>'startsAt',row_value->>'endsAt') grouped;
 source_manifest:=jsonb_build_object(
  'sourceAsOf',public.canonical_forecast_utc_instant(source_as_of_value),
  'horizon',jsonb_build_object('startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'timeZone',zone_value,
   'startsOn',start_day::text,'endsOnExclusive',end_day::text),
  'coverage',jsonb_build_object('currentBookedPositionCount',position_count,
   'scheduledJobCount',scheduled_count,'unscheduledJobCount',unscheduled_count,
   'outsideWindowCount',outside_count,'hasMore',FALSE),
  'sources',sources);
 source_digest:=public.canonical_completion_digest(source_manifest);
 run_payload:=jsonb_build_object('version','m26-material-demand-risk-calculation-v1',
  'sourceDigest',source_digest,'groups',groups);
 run_digest:=public.canonical_completion_digest(run_payload);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-material-demand-risk-forecast-v1','state','current','reason',NULL,
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
   'outsideWindowCount',outside_count,'materialRevisionCount',source_index,
   'componentLineCount',line_count,'reason',NULL),
  'sources',sources,
  'demand',jsonb_build_object('state','current','groupCount',jsonb_array_length(groups),
   'componentCount',line_count,'groups',groups,'reason',NULL),
  'inventory',jsonb_build_object('state','unavailable','onHand',NULL,
   'compatibleStockIdentityVerified',FALSE,'transactionCoverageVerified',FALSE,
   'receiptSemanticsVerified',FALSE,'m23UsageApplied',FALSE,
   'reason','source_owned_inventory_ledger_unavailable'),
  'futureReceipts',jsonb_build_object('state','unavailable','quantity',NULL,
   'receiptDatesVerified',FALSE,'reason','future_receipts_unavailable'),
  'replenishment',jsonb_build_object('state','unavailable','leadTimeDays',NULL,
   'cutoffAt',NULL,'leadTimePolicyVerified',FALSE,'cutoffPolicyVerified',FALSE,
   'supplierAvailabilityVerified',FALSE,'purchaseAuthorityVerified',FALSE,
   'reason','replenishment_policy_unavailable'),
  'reorder',jsonb_build_object('state','unavailable','reorderAt',NULL,
   'reason','inventory_receipts_and_replenishment_unavailable'),
  'stockoutRisk',jsonb_build_object('state','unavailable','risk',NULL,
   'shortageQuantity',NULL,'reason','inventory_receipts_and_replenishment_unavailable'),
  'purchasingRisk',jsonb_build_object('state','unavailable','risk',NULL,
   'reason','supplier_and_purchase_authority_unavailable'),
  'learnedOutcomes',jsonb_build_object('state','none_current','applicableValueCount',0,
   'applied',FALSE,'reason','no_compatible_current_owner_adopted_material_value'),
  'evidence',jsonb_build_object('sourceAuthenticatedDemand',TRUE,
   'currentAdoptedCompositionVerified',TRUE,'currentnessVerified',TRUE,
   'compatibleUnitsVerified',TRUE,'periodAttributionVerified',TRUE,
   'inventoryVerified',FALSE,'futureReceiptsVerified',FALSE,
   'replenishmentPolicyVerified',FALSE,'supplierAvailabilityVerified',FALSE,
   'purchaseAuthorityVerified',FALSE,'m25AdjustmentApplied',FALSE),
  'run',jsonb_build_object('calculationVersion','m26-material-demand-risk-calculation-v1',
   'sourceDigest',source_digest,'digest',run_digest),
  'forecastIssued',TRUE,'demandForecastIssued',TRUE,'reorderForecastIssued',FALSE,
  'stockoutForecastIssued',FALSE,'purchasingRiskForecastIssued',FALSE,
  'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_material_quantity_v1(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_material_demand_risk_v1_unavailable(
 TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_material_demand_risk_v1_lock_sources(
 UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_material_demand_risk_v1_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_material_demand_risk_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
 END IF;
END $$;
