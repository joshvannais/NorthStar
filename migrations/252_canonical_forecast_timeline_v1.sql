-- Mission 26 Part 10A: mount the weekly/monthly/quarterly timeline boundary.
-- The current repository has one current Part 9A deterministic research origin,
-- but no complete Part 11 saved-run inventory or authenticated finalized-actual
-- reader for this target. This boundary therefore preserves the exact current
-- subject identity while withholding every current/prior/actual value.

CREATE FUNCTION public.canonical_forecast_timeline_v1_unavailable(
 org UUID,baseline JSONB,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE baseline_current BOOLEAN:=baseline->>'state'='current';
 subject_value JSONB;periods_value JSONB;requirements_value JSONB;
 timeline_digest TEXT;
BEGIN
 IF baseline_current THEN
  subject_value:=jsonb_build_object(
   'target',baseline->'target','unit',baseline->'unit',
   'horizon',baseline->'horizon',
   'scope',jsonb_build_object(
    'sourceScope',baseline#>>'{target,sourceScope}',
    'serviceKey',NULL,'areaKey',NULL,'dimensionKeys','[]'::jsonb),
   'profile',baseline#>'{sourceSnapshot,profile}',
   'sourceSnapshotDigest',baseline#>>'{digests,input}',
   'sourceReceiptDigest',baseline#>>'{digests,receipt}',
   'baselineDigest',baseline#>>'{digests,baseline}',
   'configurationDigest',baseline#>>'{digests,configuration}',
   'algorithm',baseline#>'{provenance,algorithm}');
 ELSE subject_value:=NULL;END IF;

 periods_value:=jsonb_build_array(
  jsonb_build_object('grain','week','label','Weekly','state','unavailable',
   'reason',reason_value,'startsAt',NULL,'endsAt',NULL,'partialPeriod',NULL,
   'current',NULL,'prior',NULL,'actual',NULL),
  jsonb_build_object('grain','month','label','Monthly','state','unavailable',
   'reason',reason_value,'startsAt',NULL,'endsAt',NULL,'partialPeriod',NULL,
   'current',NULL,'prior',NULL,'actual',NULL),
  jsonb_build_object('grain','quarter','label','Quarterly','state','unavailable',
   'reason',reason_value,'startsAt',NULL,'endsAt',NULL,'partialPeriod',NULL,
   'current',NULL,'prior',NULL,'actual',NULL));

 requirements_value:=jsonb_build_object(
  'completeRunInventory',jsonb_build_object(
   'state','unavailable','reason','complete_saved_run_inventory_not_available',
   'complete',FALSE,'inventoryDigest',NULL,'runCount',NULL,
   'currentRunId',NULL,'currentRunDigest',NULL,
   'priorRunId',NULL,'priorRunDigest',NULL),
  'issuanceChronology',jsonb_build_object(
   'state','unavailable','reason','pre_outcome_issuance_chronology_not_available',
   'verified',FALSE,'currentIssuedAt',NULL,'priorIssuedAt',NULL),
  'finalizedActuals',jsonb_build_object(
   'state','unavailable','reason','authorized_finalized_actuals_not_available',
   'sourceAuthenticated',FALSE,'outcomeFinalityPolicyVersion',NULL,
   'outcomeFinalityPolicyDigest',NULL,'actualInventoryDigest',NULL),
  'businessCalendarBuckets',jsonb_build_object(
   'state','unavailable','reason','compatible_business_calendar_buckets_not_available',
   'timeZone',CASE WHEN baseline_current THEN baseline#>>'{horizon,timeZone}' ELSE NULL END,
   'calendarDigest',NULL,'partialPeriodsDisclosed',FALSE,
   'grains',jsonb_build_array('week','month','quarter')));

 IF baseline_current THEN
  timeline_digest:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-forecast-timeline-v1','organizationId',org,
   'originId',baseline->>'originId','subject',subject_value,
   'periods',periods_value,'requirements',requirements_value));
 ELSE timeline_digest:=NULL;END IF;

 RETURN jsonb_build_object(
  'version','m26-forecast-timeline-v1','state','unavailable',
  'reason',reason_value,'organizationId',org,
  'originId',(baseline->>'originId')::uuid,
  'checkedAt',baseline->>'checkedAt','comparisonMode','current_prior_actual',
  'subject',subject_value,'periods',periods_value,
  'requirements',requirements_value,
  'currentness',jsonb_build_object(
   'baselineCurrent',baseline_current,'runInventoryCurrent',FALSE,
   'actualsCurrent',FALSE,'refreshRequired',TRUE,
   'correctionOrRevocationApplied',NOT baseline_current),
  'digests',jsonb_build_object('timeline',timeline_digest,
   'runInventory',NULL,'actualInventory',NULL),
  'sourceAuthenticated',baseline_current,'runInventoryComplete',FALSE,
  'actualSourceAuthenticated',FALSE,'timelineIssued',FALSE,
  'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE,
  'researchOnly',TRUE);
END
$$;

CREATE FUNCTION public.canonical_forecast_timeline_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE baseline JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    origin_value IS NULL OR role_value IS NULL OR
    role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast timeline access restricted' USING ERRCODE='42501';
 END IF;
 baseline:=public.canonical_forecast_deterministic_baseline_v1_read(
  org,actor,role_value,session_value,origin_value);
 IF baseline IS NULL THEN RETURN NULL;END IF;
 IF baseline->>'state'<>'current' THEN
  RETURN public.canonical_forecast_timeline_v1_unavailable(
   org,baseline,'deterministic_baseline_not_current');
 END IF;
 IF baseline->>'version'<>'m26-deterministic-baseline-v1' OR
    baseline#>>'{target,key}'<>'demand.inbound_leads' OR
    baseline#>>'{target,definitionVersion}'<>'v1' OR
    baseline#>>'{target,sourceScope}'<>'retell_only_tenant_all' OR
    baseline#>>'{unit,key}'<>'count' OR baseline#>'{unit,currency}'<>'null'::jsonb OR
    baseline#>>'{configuration,algorithmId}'<>'retell_three_complete_month_mean' OR
    baseline#>>'{configuration,algorithmVersion}'<>'m26-retell-three-month-mean-v2' OR
    baseline#>>'{configuration,horizonGrain}'<>'business_local_month' OR
    baseline#>>'{sourceSnapshot,state}'<>'complete_as_of' OR
    baseline#>>'{sourceSnapshot,completeAsOf}'<>'true' OR
    baseline#>>'{sourceSnapshot,hasMore}'<>'false' OR
    baseline->>'sourceAuthenticated'<>'true' OR
    baseline->>'forecastIssued'<>'true' OR
    baseline->>'researchOnly'<>'true' OR
    baseline->>'realForecastEligible'<>'false' OR
    baseline->>'paidNumericServing'<>'false' OR
    baseline#>>'{evaluation,state}'<>'unavailable' THEN
  RAISE EXCEPTION 'Forecast timeline subject changed' USING ERRCODE='40001';
 END IF;
 RETURN public.canonical_forecast_timeline_v1_unavailable(
  org,baseline,'complete_saved_run_inventory_not_available');
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_timeline_v1_unavailable(
 UUID,JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_timeline_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_timeline_v1_unavailable(uuid,jsonb,text) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_timeline_v1_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
