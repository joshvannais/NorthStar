-- Mission 26 Part 10B: mount the same-run monthly KPI boundary.
-- Part 10A authenticates one current deterministic demand origin, but the
-- repository still has no Part 11 immutable multi-target run manifest.  This
-- read therefore preserves the exact current anchor while withholding all six
-- KPI values, their graph points and every run identity.

CREATE FUNCTION public.canonical_forecast_monthly_kpis_v1_slots(reason_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_array(
  jsonb_build_object(
   'key','revenue','label','Revenue','state','unavailable','reason',reason_value,
   'target',jsonb_build_object('key','revenue.earned_value','definitionVersion','v1',
    'status','cataloged','componentTargets','[]'::jsonb),
   'unit',jsonb_build_object('key','money','currency',NULL),
   'scope',jsonb_build_object('sourceScope','authorized_earned_value',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKind','none',
    'dimensionValue',NULL,'dimensionDigest',NULL),
   'manifestEntryState','unknown_manifest_unavailable','value',NULL,
   'outputDigest',NULL,'sourceSnapshotDigest',NULL,'coverageDigest',NULL,
   'currentnessDigest',NULL),
  jsonb_build_object(
   'key','operating_cost','label','Operating cost','state','unavailable','reason',reason_value,
   'target',jsonb_build_object('key',NULL,'definitionVersion',NULL,
    'status','derived_display_metric_not_registered','componentTargets',jsonb_build_array(
     'cost.accepted_labor.v1','cost.accepted_material.v1',
     'cost.accepted_asset_travel.v1','cost.accepted_overhead.v1')),
   'unit',jsonb_build_object('key','money','currency',NULL),
   'scope',jsonb_build_object('sourceScope','complete_non_overlapping_operating_cost_categories',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKind','none',
    'dimensionValue',NULL,'dimensionDigest',NULL),
   'manifestEntryState','unknown_manifest_unavailable','value',NULL,
   'outputDigest',NULL,'sourceSnapshotDigest',NULL,'coverageDigest',NULL,
   'currentnessDigest',NULL),
  jsonb_build_object(
   'key','profit','label','Profit','state','unavailable','reason',reason_value,
   'target',jsonb_build_object('key',NULL,'definitionVersion',NULL,
    'status','derived_display_metric_not_registered','componentTargets',jsonb_build_array(
     'revenue.earned_value.v1','cost.accepted_labor.v1','cost.accepted_material.v1',
     'cost.accepted_asset_travel.v1','cost.accepted_overhead.v1')),
   'unit',jsonb_build_object('key','money','currency',NULL),
   'scope',jsonb_build_object('sourceScope','compatible_earned_revenue_less_operating_cost',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKind','none',
    'dimensionValue',NULL,'dimensionDigest',NULL),
   'manifestEntryState','unknown_manifest_unavailable','value',NULL,
   'outputDigest',NULL,'sourceSnapshotDigest',NULL,'coverageDigest',NULL,
   'currentnessDigest',NULL),
  jsonb_build_object(
   'key','margin','label','Margin','state','unavailable','reason',reason_value,
   'target',jsonb_build_object('key','profit.operating_margin','definitionVersion','v1',
    'status','cataloged','componentTargets',jsonb_build_array(
     'revenue.earned_value.v1','cost.accepted_labor.v1','cost.accepted_material.v1',
     'cost.accepted_asset_travel.v1','cost.accepted_overhead.v1')),
   'unit',jsonb_build_object('key','ratio','currency',NULL),
   'scope',jsonb_build_object('sourceScope','compatible_positive_revenue_and_operating_cost',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKind','none',
    'dimensionValue',NULL,'dimensionDigest',NULL),
   'manifestEntryState','unknown_manifest_unavailable','value',NULL,
   'outputDigest',NULL,'sourceSnapshotDigest',NULL,'coverageDigest',NULL,
   'currentnessDigest',NULL),
  jsonb_build_object(
   'key','demand','label','Demand','state','unavailable','reason',reason_value,
   'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1',
    'status','cataloged','componentTargets','[]'::jsonb),
   'unit',jsonb_build_object('key','count','currency',NULL),
   'scope',jsonb_build_object('sourceScope','declared_complete_eligible_channels',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKind','none',
    'dimensionValue',NULL,'dimensionDigest',NULL),
   'manifestEntryState','unknown_manifest_unavailable','value',NULL,
   'outputDigest',NULL,'sourceSnapshotDigest',NULL,'coverageDigest',NULL,
   'currentnessDigest',NULL),
  jsonb_build_object(
   'key','capacity','label','Capacity','state','unavailable','reason',reason_value,
   'target',jsonb_build_object('key','capacity.available_role_hours',
    'definitionVersion','v1','status','cataloged','componentTargets','[]'::jsonb),
   'unit',jsonb_build_object('key','role_hours','currency',NULL),
   'scope',jsonb_build_object('sourceScope','qualified_available_role_hours',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKind','role',
    'dimensionValue',NULL,'dimensionDigest',NULL),
   'manifestEntryState','unknown_manifest_unavailable','value',NULL,
   'outputDigest',NULL,'sourceSnapshotDigest',NULL,'coverageDigest',NULL,
   'currentnessDigest',NULL)
 )
$$;

CREATE FUNCTION public.canonical_forecast_monthly_kpis_v1_unavailable(
 org UUID,timeline JSONB,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_current BOOLEAN:=timeline->>'reason'='complete_saved_run_inventory_not_available';
 anchor_value JSONB;month_value JSONB;slots_value JSONB;requirements_value JSONB;
 graph_value JSONB;bundle_digest TEXT;
BEGIN
 IF anchor_current THEN
  anchor_value:=jsonb_build_object(
   'originId',timeline->>'originId','timelineDigest',timeline#>>'{digests,timeline}',
   'target',timeline#>'{subject,target}','unit',timeline#>'{subject,unit}',
   'horizon',timeline#>'{subject,horizon}',
   'scope',timeline#>'{subject,scope}','profile',timeline#>'{subject,profile}',
   'sourceSnapshotDigest',timeline#>>'{subject,sourceSnapshotDigest}',
   'sourceReceiptDigest',timeline#>>'{subject,sourceReceiptDigest}',
   'baselineDigest',timeline#>>'{subject,baselineDigest}',
   'configurationDigest',timeline#>>'{subject,configurationDigest}',
   'algorithm',timeline#>'{subject,algorithm}');
  month_value:=jsonb_build_object(
   'localStart',timeline#>>'{subject,horizon,localStart}',
   'startsAt',timeline#>>'{subject,horizon,startsAt}',
   'endsAt',timeline#>>'{subject,horizon,endsAt}',
   'grain','business_local_month',
   'timeZone',timeline#>>'{subject,horizon,timeZone}',
   'calendarDigest',NULL,'partialPeriod',NULL);
 ELSE anchor_value:=NULL;month_value:=NULL;END IF;

 slots_value:=public.canonical_forecast_monthly_kpis_v1_slots(reason_value);
 requirements_value:=jsonb_build_object(
  'sameRunManifest',jsonb_build_object(
   'state','unavailable','reason','same_run_manifest_not_available','complete',FALSE,
   'runId',NULL,'revision',NULL,'predictionCutoff',NULL,'manifestDigest',NULL,
   'presentTargetCount',NULL,'expectedTargetCount',6,'absentTargets',NULL),
  'earnedRevenueAuthority',jsonb_build_object(
   'state','unavailable','reason','authorized_earned_revenue_not_available',
   'recognitionPolicyVersion',NULL,'recognitionPolicyDigest',NULL,
   'completeEventTimeCoverage',FALSE),
  'operatingCostCoverage',jsonb_build_object(
   'state','unavailable','reason','complete_operating_cost_categories_not_available',
   'costBasisVersion',NULL,'costBasisDigest',NULL,'currency',NULL,
   'categoriesComplete',FALSE,'nonOverlapping',FALSE,'longJobAllocationVerified',FALSE),
  'demandCoverage',jsonb_build_object(
   'state','unavailable','reason','same_run_demand_target_not_available',
   'eligibleChannelScope',NULL,'distinctLeadIdentityComplete',FALSE,
   'rawRetellCallsSeparated',TRUE),
  'capacityScope',jsonb_build_object(
   'state','unavailable','reason','same_run_role_capacity_target_not_available',
   'roleKey',NULL,'dimensionDigest',NULL,'qualifiedAvailabilityComplete',FALSE,
   'commitmentOverlapReviewed',FALSE));
 graph_value:=jsonb_build_object(
  'state','unavailable','reason',reason_value,'month',month_value,
  'series',jsonb_build_array(
   jsonb_build_object('key','revenue','value',NULL,'unitKey','money'),
   jsonb_build_object('key','operating_cost','value',NULL,'unitKey','money'),
   jsonb_build_object('key','profit','value',NULL,'unitKey','money'),
   jsonb_build_object('key','margin','value',NULL,'unitKey','ratio'),
   jsonb_build_object('key','demand','value',NULL,'unitKey','count'),
   jsonb_build_object('key','capacity','value',NULL,'unitKey','role_hours')));

 IF anchor_current THEN
  bundle_digest:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-monthly-kpi-bundle-v1','organizationId',org,
   'originId',timeline->>'originId','anchor',anchor_value,'month',month_value,
   'slots',slots_value,'requirements',requirements_value,'graph',graph_value));
 ELSE bundle_digest:=NULL;END IF;

 RETURN jsonb_build_object(
  'version','m26-monthly-kpi-bundle-v1','state','unavailable',
  'reason',reason_value,'organizationId',org,
  'originId',(timeline->>'originId')::uuid,'checkedAt',timeline->>'checkedAt',
  'anchor',anchor_value,'month',month_value,
  'run',jsonb_build_object(
   'state','unavailable','reason','same_run_manifest_not_available',
   'runId',NULL,'revision',NULL,'predictionCutoff',NULL,'manifestDigest',NULL,
   'algorithmSetDigest',NULL,'configurationDigest',NULL,
   'sourceSnapshotDigest',NULL,'complete',FALSE,'current',FALSE),
  'slots',slots_value,'requirements',requirements_value,'graph',graph_value,
  'currentness',jsonb_build_object(
   'anchorCurrent',anchor_current,'manifestCurrent',FALSE,
   'sourceReadersCurrent',FALSE,'refreshRequired',TRUE,
   'correctionOrRevocationApplied',NOT anchor_current),
  'digests',jsonb_build_object('bundle',bundle_digest,'run',NULL,'manifest',NULL),
  'anchorSourceAuthenticated',anchor_current,'sameRunManifestComplete',FALSE,
  'bundleIssued',FALSE,'paidNumericServing',FALSE,
  'automaticActionAuthorized',FALSE,'researchOnly',TRUE);
END
$$;

CREATE FUNCTION public.canonical_forecast_monthly_kpis_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE timeline JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    origin_value IS NULL OR role_value IS NULL OR
    role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Monthly KPI access restricted' USING ERRCODE='42501';
 END IF;
 timeline:=public.canonical_forecast_timeline_v1_read(
  org,actor,role_value,session_value,origin_value);
 IF timeline IS NULL THEN RETURN NULL;END IF;
 IF timeline->>'version'<>'m26-forecast-timeline-v1' OR
    timeline->>'state'<>'unavailable' OR
    timeline->>'timelineIssued'<>'false' OR
    timeline->>'paidNumericServing'<>'false' OR
    timeline->>'automaticActionAuthorized'<>'false' OR
    timeline->>'researchOnly'<>'true' OR
    timeline->>'reason' NOT IN(
     'complete_saved_run_inventory_not_available','deterministic_baseline_not_current') THEN
  RAISE EXCEPTION 'Monthly KPI anchor changed' USING ERRCODE='40001';
 END IF;
 IF timeline->>'reason'='deterministic_baseline_not_current' THEN
  RETURN public.canonical_forecast_monthly_kpis_v1_unavailable(
   org,timeline,'deterministic_baseline_not_current');
 END IF;
 RETURN public.canonical_forecast_monthly_kpis_v1_unavailable(
  org,timeline,'same_run_manifest_not_available');
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_monthly_kpis_v1_slots(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_monthly_kpis_v1_unavailable(
 UUID,JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_monthly_kpis_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_monthly_kpis_v1_slots(text) FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_monthly_kpis_v1_unavailable(uuid,jsonb,text) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_monthly_kpis_v1_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
