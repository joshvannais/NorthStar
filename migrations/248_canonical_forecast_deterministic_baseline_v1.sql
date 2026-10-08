-- Mission 26 Part 9A: mount one reproducible deterministic research baseline
-- from the already-governed Part 4A future origin. This migration performs no
-- new forecast arithmetic and stores no second run: it verifies and projects
-- the immutable Part 4A source/config/output receipt.

CREATE TABLE public.canonical_forecast_deterministic_baseline_algorithms_v1 (
 algorithm_key TEXT PRIMARY KEY CHECK(
  algorithm_key='retell_three_complete_month_mean'),
 algorithm_version TEXT NOT NULL UNIQUE CHECK(
  algorithm_version='m26-retell-three-month-mean-v2'),
 definition JSONB NOT NULL CHECK(jsonb_typeof(definition)='object'),
 definition_digest TEXT NOT NULL CHECK(definition_digest~'^[a-f0-9]{64}$' AND
  definition_digest=public.canonical_completion_digest(definition)),
 implementation_identity TEXT NOT NULL CHECK(implementation_identity=
  'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)'),
 implementation_digest TEXT NOT NULL CHECK(implementation_digest~'^[a-f0-9]{64}$'),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER canonical_forecast_deterministic_baseline_algorithms_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_deterministic_baseline_algorithms_v1
 FOR EACH STATEMENT EXECUTE FUNCTION
  public.canonical_forecast_price_flow_origin_immutable();

WITH algorithm AS (SELECT jsonb_build_object(
 'key','retell_three_complete_month_mean',
 'version','m26-retell-three-month-mean-v2',
 'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1'),
 'sourceScope','retell_only_tenant_all','kind','deterministic',
 'method','arithmetic_mean_comparable_prior_periods',
 'parameters',jsonb_build_object('minimumPeriods',3,'decimalScale',6,
   'rounding','half_up','observationOrder','local_month_start_ascending'),
 'horizonGrain','business_local_month','unit','count',
 'outputContractVersion','m26-forecast-output-v1',
 'probabilityPolicy','unavailable','rangePolicy','unavailable',
 'trainingReceiptDigest',NULL) definition)
INSERT INTO public.canonical_forecast_deterministic_baseline_algorithms_v1(
 algorithm_key,algorithm_version,definition,definition_digest,
 implementation_identity,implementation_digest)
SELECT 'retell_three_complete_month_mean','m26-retell-three-month-mean-v2',
 definition,public.canonical_completion_digest(definition),
 'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)',
 encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)'::regprocedure),
  'UTF8')),'hex') FROM algorithm;

CREATE FUNCTION public.canonical_forecast_deterministic_baseline_v1_chronology(
 issued_at TIMESTAMPTZ,horizon_starts_at TIMESTAMPTZ,checked_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT issued_at IS NOT NULL AND horizon_starts_at IS NOT NULL AND
  checked_at IS NOT NULL AND issued_at<=checked_at AND checked_at<horizon_starts_at
$$;

CREATE FUNCTION public.canonical_forecast_deterministic_baseline_v1_unavailable(
 origin_value UUID,reason_value TEXT,checked_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m26-deterministic-baseline-v1','state','unavailable',
  'reason',reason_value,'originId',origin_value,
  'checkedAt',public.canonical_forecast_utc_instant(checked_at),
  'issuedAt',NULL,'evaluationAsOf',NULL,
  'target',NULL,'configuration',NULL,'horizon',NULL,'unit',NULL,
  'sourceSnapshot',NULL,'output',NULL,
  'evaluation',jsonb_build_object('state','unavailable','evaluatedAt',NULL,
   'outcomeDigest',NULL,'reason','finalized_outcome_not_available'),
  'provenance',NULL,
  'digests',jsonb_build_object('configuration',NULL,'input',NULL,
   'output',NULL,'baseline',NULL,'receipt',NULL),
  'currentness',jsonb_build_object('sourceCurrent',FALSE,
   'refreshRequired',TRUE,'correctionOrRevocationApplied',TRUE),
  'sourceAuthenticated',FALSE,'researchOnly',TRUE,
  'realForecastEligible',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'probabilityIssued',FALSE,
  'calibratedRangeIssued',FALSE,'automaticActionAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_deterministic_baseline_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_retell_future_origins_v2%ROWTYPE;
 registry public.canonical_forecast_deterministic_baseline_algorithms_v1%ROWTYPE;
 current_value JSONB;configuration_value JSONB;observations_value JSONB;
 expected_definition JSONB;
 algorithm_identity JSONB;build_identity JSONB;
 input_value JSONB;configuration_digest TEXT;input_digest TEXT;
 output_digest TEXT;baseline_digest TEXT;receipt_digest TEXT;
 installed_implementation_digest TEXT;
 checked_at TIMESTAMPTZ:=statement_timestamp();period_count INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    origin_value IS NULL OR role_value IS NULL OR
    role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Deterministic baseline access restricted' USING ERRCODE='42501';
 END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
 JOIN public.organization_onboarding onboarding
  ON onboarding.organization_id=subscription.organization_id
 WHERE subscription.organization_id=org AND onboarding.status='complete'
  AND (subscription.status='active' OR (subscription.status='trialing' AND
   subscription.trial_started_at IS NOT NULL AND
   subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days' AND
   subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO saved FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND id=origin_value;
 IF saved.id IS NULL THEN RETURN NULL;END IF;

 IF NOT public.canonical_forecast_deterministic_baseline_v1_chronology(
    saved.as_of,saved.horizon_starts_at,checked_at) THEN
  RETURN public.canonical_forecast_deterministic_baseline_v1_unavailable(
   saved.id,'baseline_clock_or_horizon_ineligible',checked_at);
 END IF;

 expected_definition:=jsonb_build_object(
  'key','retell_three_complete_month_mean',
  'version','m26-retell-three-month-mean-v2',
  'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1'),
  'sourceScope','retell_only_tenant_all','kind','deterministic',
  'method','arithmetic_mean_comparable_prior_periods',
  'parameters',jsonb_build_object('minimumPeriods',3,'decimalScale',6,
    'rounding','half_up','observationOrder','local_month_start_ascending'),
  'horizonGrain','business_local_month','unit','count',
  'outputContractVersion','m26-forecast-output-v1',
  'probabilityPolicy','unavailable','rangePolicy','unavailable',
  'trainingReceiptDigest',NULL);
 SELECT * INTO registry
 FROM public.canonical_forecast_deterministic_baseline_algorithms_v1
 WHERE algorithm_key='retell_three_complete_month_mean' AND
  algorithm_version='m26-retell-three-month-mean-v2';
 installed_implementation_digest:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)'::regprocedure),
  'UTF8')),'hex');
 IF registry.algorithm_key IS NULL OR
    registry.definition IS DISTINCT FROM expected_definition OR
    registry.definition_digest IS DISTINCT FROM
      public.canonical_completion_digest(registry.definition) OR
    registry.implementation_identity IS DISTINCT FROM
      'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)' OR
    registry.implementation_digest IS DISTINCT FROM installed_implementation_digest THEN
  RETURN public.canonical_forecast_deterministic_baseline_v1_unavailable(
   saved.id,'algorithm_identity_changed_refresh_required',checked_at);
 END IF;
 build_identity:=jsonb_build_object(
  'kind','postgresql_function_definition_sha256',
  'procedure',registry.implementation_identity);
 algorithm_identity:=jsonb_build_object(
  'key',registry.algorithm_key,'version',registry.algorithm_version,
  'definitionDigest',registry.definition_digest,
  'implementationDigest',registry.implementation_digest,
  'buildIdentity',build_identity);

 -- Revalidate the exact authenticated Part 4A source under the same locks,
 -- permission, profile, certification, correction and revocation boundary.
 current_value:=public.canonical_forecast_retell_future_evidence_v2(
  org,actor,role_value,session_value,saved.local_horizon_start);
 IF current_value->>'state'<>'retell_future_evidence_current' OR
    public.canonical_completion_digest(current_value)<>rtrim(saved.evidence_digest) THEN
  RETURN public.canonical_forecast_deterministic_baseline_v1_unavailable(
   saved.id,'source_or_profile_changed_refresh_required',checked_at);
 END IF;

 -- The old immutable receipt remains authoritative. Detect database/tamper
 -- disagreement before projecting any amount or digest.
 output_digest:=public.canonical_completion_digest(saved.private_output);
 receipt_digest:=public.canonical_completion_digest(jsonb_build_object(
  'id',saved.id,'organizationId',saved.organization_id,
  'evidenceDigest',rtrim(saved.evidence_digest),
  'outputDigest',rtrim(saved.output_digest),'actorUserId',saved.actor_user_id,
  'membershipId',saved.membership_id));
 IF public.canonical_completion_digest(saved.evidence)<>rtrim(saved.evidence_digest) OR
    output_digest<>rtrim(saved.output_digest) OR
    receipt_digest<>rtrim(saved.canonical_digest) OR
    saved.evidence->>'version'<>'m26-retell-future-origin-v2' OR
    saved.evidence->>'organizationId'<>org::text OR
    saved.evidence->>'scope'<>'retell_only_tenant_all' OR
    saved.evidence->>'targetKey'<>'demand.inbound_leads' OR
    saved.evidence->>'targetVersion'<>'v1' OR
    saved.evidence->>'calculationVersion'<>'m26-retell-three-month-mean-v2' OR
    saved.evidence->>'periodCount'<>'3' OR
    jsonb_typeof(saved.evidence->'periods')<>'array' OR
    jsonb_array_length(saved.evidence->'periods')<>3 OR
    saved.private_output#>>'{target,key}'<>'demand.inbound_leads' OR
    saved.private_output#>>'{target,definitionVersion}'<>'v1' OR
    saved.private_output#>>'{unit,key}'<>'count' OR
    saved.private_output#>'{unit,currency}'<>'null'::jsonb OR
    saved.private_output#>>'{value,kind}'<>'point' OR
    saved.private_output->>'calculationVersion'<>'m26-retell-three-month-mean-v2' OR
    saved.private_output->>'researchOnly'<>'true' OR
    saved.private_output->>'realForecastEligible'<>'false' OR
    saved.private_output->>'paidNumericServing'<>'false' OR
    saved.private_output->>'forecastServingEnabled'<>'false' THEN
  RAISE EXCEPTION 'Deterministic baseline receipt changed' USING ERRCODE='40001';
 END IF;

 SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object(
   'localMonthStart',item->>'month','state','complete',
   'count',(item->>'leadCount')::integer,
   'sourceWindowStartsAt',cert.evidence->>'startsAt',
   'sourceWindowEndsAt',cert.evidence->>'endsAt',
   'sourceRecordedThrough',cert.evidence->>'snapshotCapturedAt',
   'certificationId',cert.id,'certificationRevision',cert.revision,
   'certificationDigest',rtrim(cert.canonical_digest),
   'certificationAction',cert.action,
   'certificationRecordedAt',public.canonical_forecast_utc_instant(cert.recorded_at),
   'snapshotId',cert.snapshot_id,
   'snapshotDigest',cert.evidence->>'snapshotDigest',
   'coverageEvidenceDigest',rtrim(cert.evidence_digest),
   'providerScanDigest',rtrim(cert.provider_scan_digest),
   'callerConsentAttested',cert.caller_consent_attested,
   'providerCoverageAttestedRetellOnly',cert.provider_coverage_attested,
   'retentionAttested',cert.retention_attested)
   ORDER BY item->>'month'),'[]'::jsonb)
 INTO period_count,observations_value
 FROM jsonb_array_elements(saved.evidence->'periods') item
 JOIN public.canonical_forecast_retell_period_certifications_v2 cert
  ON cert.organization_id=org
  AND cert.id=(item->>'certificationId')::uuid
  AND cert.revision=(item->>'certificationRevision')::integer
  AND rtrim(cert.canonical_digest)=item->>'certificationDigest'
  AND cert.snapshot_id=(item->>'snapshotId')::uuid
  AND rtrim(cert.evidence_digest)=item->>'evidenceDigest'
  AND cert.local_month_start=(item->>'month')::date
  AND (cert.evidence->>'reviewedDistinctLeadCount')::integer=(item->>'leadCount')::integer
 WHERE cert.action='certify';
 IF period_count<>3 OR jsonb_array_length(observations_value)<>3 OR
    (SELECT count(DISTINCT item->>'localMonthStart')
     FROM jsonb_array_elements(observations_value)item)<>3 THEN
  RETURN public.canonical_forecast_deterministic_baseline_v1_unavailable(
   saved.id,'complete_period_lineage_unavailable',checked_at);
 END IF;

 configuration_value:=jsonb_build_object(
  'version','m26-deterministic-baseline-configuration-v1',
  'targetKey','demand.inbound_leads','targetVersion','v1',
  'sourceScope','retell_only_tenant_all',
  'algorithmId','retell_three_complete_month_mean',
  'algorithmVersion','m26-retell-three-month-mean-v2',
  'definitionDigest',registry.definition_digest,
  'implementationDigest',registry.implementation_digest,
  'buildIdentity',build_identity,
  'method','arithmetic_mean_comparable_prior_periods','minimumPeriods',3,
  'horizonGrain','business_local_month','unit','count',
  'decimalScale',6,'rounding','half_up',
  'observationOrder','local_month_start_ascending');
 input_value:=jsonb_build_object(
  'version','m26-deterministic-baseline-input-v1','organizationId',org,
  'asOf',public.canonical_forecast_utc_instant(saved.as_of),
  'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1'),
  'sourceScope','retell_only_tenant_all',
  'profile',jsonb_build_object(
   'businessProfileId',saved.evidence->>'businessProfileId',
   'businessProfileVersion',(saved.evidence->>'businessProfileVersion')::integer,
   'businessProfileHash',saved.evidence->>'businessProfileHash',
   'timeZone',saved.evidence->>'timeZone'),
  'horizon',jsonb_build_object('localStart',saved.local_horizon_start,
   'startsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
   'endsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
   'grain','business_local_month'),
  'periodInventoryDigest',saved.evidence->>'periodInventoryDigest',
  'observations',observations_value);
 configuration_digest:=public.canonical_completion_digest(configuration_value);
 input_digest:=public.canonical_completion_digest(input_value);
 baseline_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-deterministic-baseline-v1',
  'configurationDigest',configuration_digest,'inputDigest',input_digest,
  'outputDigest',output_digest,'algorithmIdentity',algorithm_identity));

 RETURN jsonb_build_object(
  'version','m26-deterministic-baseline-v1','state','current','reason',NULL,
  'originId',saved.id,'checkedAt',public.canonical_forecast_utc_instant(checked_at),
  'issuedAt',public.canonical_forecast_utc_instant(saved.as_of),
  'evaluationAsOf',NULL,
  'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1',
   'sourceScope','retell_only_tenant_all'),
  'configuration',configuration_value,
  'horizon',jsonb_build_object('localStart',saved.local_horizon_start,
   'startsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
   'endsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
   'grain','business_local_month','timeZone',saved.evidence->>'timeZone'),
  'unit',saved.private_output->'unit',
  'sourceSnapshot',jsonb_build_object(
   'state','complete_as_of','completeAsOf',TRUE,
   'sourceScope','retell_only_tenant_all',
   'sourceAsOf',public.canonical_forecast_utc_instant(saved.as_of),
   'profile',input_value->'profile',
   'periodInventoryDigest',saved.evidence->>'periodInventoryDigest',
   'evidenceDigest',rtrim(saved.evidence_digest),
   'expectedPeriods',3,'includedPeriods',3,'excludedPeriods',0,
   'missingPeriods',0,'stalePeriods',0,'hasMore',FALSE,
   'paginationVersion','bounded_single_page','nextCursor',NULL,
   'observations',observations_value,
   'providerCoverageAttestedRetellOnly',TRUE,
   'providerIndependentVerified',FALSE,'wholeBusinessCoverageVerified',FALSE),
  'output',saved.private_output,
  'evaluation',jsonb_build_object('state','unavailable','evaluatedAt',NULL,
   'outcomeDigest',NULL,'reason','finalized_outcome_not_available'),
  'provenance',jsonb_build_object('algorithm',algorithm_identity,
   'sourceReceiptDigest',receipt_digest),
  'digests',jsonb_build_object('configuration',configuration_digest,
   'input',input_digest,'output',output_digest,'baseline',baseline_digest,
   'receipt',receipt_digest),
  'currentness',jsonb_build_object('sourceCurrent',TRUE,
   'refreshRequired',FALSE,'correctionOrRevocationApplied',FALSE),
  'sourceAuthenticated',TRUE,'researchOnly',TRUE,
  'realForecastEligible',FALSE,'forecastIssued',TRUE,
  'paidNumericServing',FALSE,'probabilityIssued',FALSE,
  'calibratedRangeIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON TABLE
 public.canonical_forecast_deterministic_baseline_algorithms_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_deterministic_baseline_v1_chronology(
 TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_deterministic_baseline_v1_unavailable(
 UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_deterministic_baseline_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_deterministic_baseline_algorithms_v1 FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_deterministic_baseline_v1_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
