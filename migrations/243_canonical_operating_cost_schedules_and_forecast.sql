-- Mission 26 original Part 7D: source-owned operating-cost schedules and a
-- bounded next-30-day overhead / financed-asset cash-commitment forecast.
-- The source revision is an owner-recorded complete schedule snapshot. The
-- forecast is read-only and never treats a schedule status as payment proof,
-- economic depreciation, or a Mission 24 job-cost allocation.

CREATE TABLE public.canonical_operating_cost_schedule_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN('replace','revoke')),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=1048576),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='operating-cost-schedule-snapshot-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,revision), UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_operating_cost_schedule_revisions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE FUNCTION public.canonical_operating_cost_schedule_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Operating-cost schedule history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_operating_cost_schedule_immutable
BEFORE UPDATE OR DELETE ON public.canonical_operating_cost_schedule_revisions
FOR EACH ROW EXECUTE FUNCTION public.canonical_operating_cost_schedule_immutable();

CREATE FUNCTION public.canonical_operating_cost_snapshot_valid(body JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE schedule JSONB;due_item JSONB;category_item JSONB;attestation JSONB;
 coverage JSONB;policy JSONB;seen_keys TEXT[]:='{}';seen_dates TEXT[];seen_categories TEXT[];
 kind_value TEXT;asset_value TEXT;currency_value TEXT;recurrence_end TEXT;due_on TEXT;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(body,ARRAY[
  'expectedRevision','expectedDigest','action','currency','effectiveOn','coverage',
  'schedules','allocationPolicy','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  jsonb_typeof(body->'expectedRevision')<>'number' OR body->>'expectedRevision'!~'^(0|[1-9][0-9]{0,3}|10000)$' OR
  jsonb_typeof(body->'expectedDigest')<>'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$' OR
  (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none')) OR
  body->>'action' NOT IN('replace','revoke') OR
  public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR
  body->>'confirmationVersion' IS DISTINCT FROM 'operating-cost-schedule-snapshot-v1' THEN RETURN FALSE;END IF;
 IF body->>'action'='revoke' THEN
  RETURN body->'currency'='null'::jsonb AND body->'effectiveOn'='null'::jsonb AND
   body->'coverage'='null'::jsonb AND body->'allocationPolicy'='null'::jsonb AND
   body->'schedules'='[]'::jsonb;
 END IF;
 currency_value:=body->>'currency';coverage:=body->'coverage';policy:=body->'allocationPolicy';
 IF currency_value IS NULL OR currency_value!~'^[A-Z]{3}$' OR
  public.canonical_pricing_day(body->'effectiveOn') IS NOT TRUE OR
  jsonb_typeof(body->'schedules')<>'array' OR jsonb_array_length(body->'schedules')>100 OR
  public.canonical_field_evidence_object_keys_exact(coverage,ARRAY[
   'startsOn','endsOn','recordedThrough','complete']) IS NOT TRUE OR
  public.canonical_pricing_day(coverage->'startsOn') IS NOT TRUE OR
  public.canonical_pricing_day(coverage->'endsOn') IS NOT TRUE OR
  coverage->>'endsOn'<coverage->>'startsOn' OR coverage->'complete' IS DISTINCT FROM 'true'::jsonb OR
  coverage->>'recordedThrough' IS NULL OR coverage->>'recordedThrough'!~
   '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' OR
  public.canonical_field_evidence_object_keys_exact(policy,ARRAY[
   'status','basis','mission24EquipmentTreatment','mission24OverheadTreatment',
   'economicDepreciationTreatment','actualPaymentTreatment','reason']) IS NOT TRUE OR
  policy->>'status'<>'reconciled' OR policy->>'basis'<>'owner_approved_schedule_policy' OR
  policy->>'mission24EquipmentTreatment'<>'separate_job_cost_allocation' OR
  policy->>'mission24OverheadTreatment'<>'separate_job_cost_allocation' OR
  policy->>'economicDepreciationTreatment'<>'excluded' OR
  policy->>'actualPaymentTreatment'<>'not_evidence' OR
  public.canonical_learning_text_valid(policy->>'reason',1000) IS NOT TRUE THEN RETURN FALSE;END IF;
 FOR schedule IN SELECT value FROM jsonb_array_elements(body->'schedules') LOOP
  IF public.canonical_field_evidence_object_keys_exact(schedule,ARRAY[
   'scheduleKey','kind','assetId','amount','currency','dueDates','recurrenceEnd',
   'includedCategories','sourceAttestation']) IS NOT TRUE OR
   schedule->>'scheduleKey' IS NULL OR schedule->>'scheduleKey'!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR
   schedule->>'scheduleKey'=ANY(seen_keys) OR schedule->>'kind' NOT IN(
    'overhead_expense','financed_asset_obligation') OR
   schedule->>'amount' IS NULL OR schedule->>'amount'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR
   schedule->>'currency' IS DISTINCT FROM currency_value OR
   jsonb_typeof(schedule->'dueDates')<>'array' OR
   jsonb_array_length(schedule->'dueDates') NOT BETWEEN 1 AND 120 OR
   public.canonical_pricing_day(schedule->'recurrenceEnd') IS NOT TRUE OR
   jsonb_typeof(schedule->'includedCategories')<>'array' OR
   jsonb_array_length(schedule->'includedCategories') NOT BETWEEN 1 AND 12 THEN RETURN FALSE;END IF;
  seen_keys:=array_append(seen_keys,schedule->>'scheduleKey');kind_value:=schedule->>'kind';
  asset_value:=schedule->>'assetId';recurrence_end:=schedule->>'recurrenceEnd';
  IF (kind_value='overhead_expense' AND schedule->'assetId'<>'null'::jsonb) OR
    (kind_value='financed_asset_obligation' AND
     (asset_value IS NULL OR asset_value!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
    THEN RETURN FALSE;END IF;
  seen_dates:='{}';
  FOR due_item IN SELECT value FROM jsonb_array_elements(schedule->'dueDates') LOOP
   IF public.canonical_field_evidence_object_keys_exact(due_item,ARRAY['dueOn','paymentStatus']) IS NOT TRUE OR
    public.canonical_pricing_day(due_item->'dueOn') IS NOT TRUE OR
    due_item->>'paymentStatus' NOT IN('scheduled','owner_marked_satisfied','canceled') OR
    due_item->>'dueOn'=ANY(seen_dates) OR due_item->>'dueOn'>recurrence_end OR
    due_item->>'dueOn'<coverage->>'startsOn' OR due_item->>'dueOn'>coverage->>'endsOn'
    THEN RETURN FALSE;END IF;
   seen_dates:=array_append(seen_dates,due_item->>'dueOn');
  END LOOP;
  seen_categories:='{}';
  FOR category_item IN SELECT value FROM jsonb_array_elements(schedule->'includedCategories') LOOP
   IF jsonb_typeof(category_item)<>'string' OR category_item#>>'{}'=ANY(seen_categories) OR
    category_item#>>'{}' NOT IN('rent','utilities','insurance','tax','administration','maintenance',
      'interest','principal','debt_service','other') THEN RETURN FALSE;END IF;
   seen_categories:=array_append(seen_categories,category_item#>>'{}');
  END LOOP;
  IF kind_value='overhead_expense' AND ('principal'=ANY(seen_categories) OR
     'debt_service'=ANY(seen_categories) OR 'interest'=ANY(seen_categories)) OR
    kind_value='financed_asset_obligation' AND NOT ('debt_service'=ANY(seen_categories))
    THEN RETURN FALSE;END IF;
  attestation:=schedule->'sourceAttestation';
  IF public.canonical_field_evidence_object_keys_exact(attestation,ARRAY[
    'kind','reference','documentDigest','attestedAt']) IS NOT TRUE OR
    attestation->>'kind' NOT IN('owner_attested','source_document') OR
    public.canonical_learning_text_valid(attestation->>'reference',500) IS NOT TRUE OR
    attestation->>'attestedAt' IS NULL OR attestation->>'attestedAt'!~
     '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' OR
    (attestation->>'kind'='owner_attested' AND attestation->'documentDigest'<>'null'::jsonb) OR
    (attestation->>'kind'='source_document' AND
     (attestation->>'documentDigest' IS NULL OR attestation->>'documentDigest'!~'^[0-9a-f]{64}$'))
   THEN RETURN FALSE;END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.canonical_operating_cost_snapshot_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_row public.canonical_operating_cost_schedule_revisions%ROWTYPE;
 replay public.canonical_operating_cost_schedule_revisions%ROWTYPE;inserted public.canonical_operating_cost_schedule_revisions%ROWTYPE;
 key_hash TEXT;request_hash TEXT;digest_value TEXT;next_revision BIGINT;schedule JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required for operating-cost schedules' USING ERRCODE='25001';END IF;
 IF role_value NOT IN('owner','admin') OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  public.canonical_operating_cost_snapshot_valid(body) IS NOT TRUE THEN
  RAISE EXCEPTION 'Operating-cost schedule input invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'actorUserId',actor,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-cost-schedules:'||org::text,0));
 SELECT * INTO replay FROM public.canonical_operating_cost_schedule_revisions
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Operating-cost schedule request changed' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('revision',replay.revision,'digest',rtrim(replay.canonical_digest),
   'action',replay.action,'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_operating_cost_schedule_revisions
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF COALESCE(current_row.revision,0)<>(body->>'expectedRevision')::bigint OR
    COALESCE(rtrim(current_row.canonical_digest),'none')<>body->>'expectedDigest' THEN
  RAISE EXCEPTION 'Operating-cost schedules changed' USING ERRCODE='40001';END IF;
 IF body->>'action'='revoke' AND current_row.id IS NULL THEN
  RAISE EXCEPTION 'No operating-cost schedule snapshot to revoke' USING ERRCODE='22023';END IF;
 IF body->>'action'='replace' THEN
  IF (body#>>'{coverage,recordedThrough}')::timestamptz>clock_timestamp() OR
     (body->>'effectiveOn')::date>(body#>>'{coverage,endsOn}')::date THEN
   RAISE EXCEPTION 'Operating-cost schedule dates invalid' USING ERRCODE='22023';END IF;
  FOR schedule IN SELECT value FROM jsonb_array_elements(body->'schedules') LOOP
   IF (schedule#>>'{sourceAttestation,attestedAt}')::timestamptz>clock_timestamp() THEN
    RAISE EXCEPTION 'Operating-cost source attestation is in the future' USING ERRCODE='22023';END IF;
   IF schedule->>'kind'='financed_asset_obligation' AND NOT EXISTS(
    SELECT 1 FROM public.tenant_assets asset WHERE asset.organization_id=org
     AND asset.id=(schedule->>'assetId')::uuid AND asset.catalogue_state='active') THEN
    RAISE EXCEPTION 'Operating-cost asset is unavailable' USING ERRCODE='22023';END IF;
  END LOOP;
 END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'revision',next_revision,'previousId',current_row.id,
  'action',body->>'action','payload',body-'expectedRevision'-'expectedDigest'-'reason'-'confirmed'-'confirmationVersion',
  'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,
  'authSessionId',session_value,'reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_operating_cost_schedule_revisions(
  organization_id,revision,previous_id,action,payload,actor_user_id,membership_id,auth_session_id,
  reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,next_revision,current_row.id,body->>'action',
  body-'expectedRevision'-'expectedDigest'-'reason'-'confirmed'-'confirmationVersion',actor,
  (authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,
  'operating-cost-schedule-snapshot-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('revision',inserted.revision,'digest',rtrim(inserted.canonical_digest),
  'action',inserted.action,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_overhead_cash_v1_unavailable(
 reason_value TEXT,cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m26-overhead-cash-forecast-v1','state','unavailable','reason',reason_value,
  'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),
  'currency',NULL,'horizon',jsonb_build_object(
   'startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object('label','Next 30 days of owner-recorded company obligations',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'overhead',jsonb_build_object('state','unavailable','amount',NULL,'dueCount',NULL,
   'scheduleCount',NULL,'reason',reason_value),
  'financedAssetCash',jsonb_build_object('state','unavailable','amount',NULL,'dueCount',NULL,
   'obligationCount',NULL,'ownerMarkedSatisfiedCount',NULL,'canceledCount',NULL,'reason',reason_value),
  'evidence',jsonb_build_object('ownerRecordedSchedules',FALSE,'exactAmounts',FALSE,
   'exactDueDates',FALSE,'recurrenceEndRecorded',FALSE,'sourceAttested',FALSE,
   'currentRevision',FALSE,'completeAsOf',FALSE,'overlapReconciled',FALSE,
   'actualPaymentVerified',FALSE,'learnedAdjustmentApplied',FALSE),
  'allocation',jsonb_build_object('state','unavailable','basis','owner_approved_schedule_policy',
   'jobCostAllocationIncluded',FALSE,'economicDepreciationIncluded',FALSE,
   'actualPaymentClaimed',FALSE,'reason',reason_value),
  'forecastIssued',FALSE,'completeOperatingCostForecastIssued',FALSE,
  'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_operating_cost_snapshot_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;source_row public.canonical_operating_cost_schedule_revisions%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for operating-cost schedules' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'Operating-cost schedules restricted' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-cost-schedules:'||org::text,0));
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO source_row FROM public.canonical_operating_cost_schedule_revisions
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF source_row.id IS NULL THEN RETURN jsonb_build_object(
  'state','absent','revision',0,'digest','none','action',NULL,'snapshot',NULL);END IF;
 RETURN jsonb_build_object('state',CASE WHEN source_row.action='replace' THEN 'current' ELSE 'revoked' END,
  'revision',source_row.revision,'digest',rtrim(source_row.canonical_digest),
  'action',source_row.action,'snapshot',source_row.payload);
END $$;

CREATE FUNCTION public.canonical_forecast_overhead_cash_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;cutoff_value TIMESTAMPTZ;horizon_value TIMESTAMPTZ;
 profile_row public.canonical_business_profiles%ROWTYPE;source_row public.canonical_operating_cost_schedule_revisions%ROWTYPE;
 time_zone_value TEXT;currency_value TEXT;local_start DATE;local_end DATE;schedule JSONB;due_item JSONB;
 overhead_cents NUMERIC:=0;asset_cents NUMERIC:=0;amount_cents NUMERIC;
 overhead_due_count INTEGER:=0;asset_due_count INTEGER:=0;overhead_schedule_count INTEGER:=0;
 obligation_count INTEGER:=0;satisfied_count INTEGER:=0;canceled_count INTEGER:=0;
 due_on DATE;scheduled_in_window BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for overhead and cash forecast' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Overhead and cash forecast restricted' USING ERRCODE='42501';END IF;
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-cost-schedules:'||org::text,0));
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 SELECT profile.* INTO profile_row FROM public.canonical_business_profiles profile
  JOIN public.organization_onboarding onboarding ON onboarding.organization_id=profile.organization_id
   AND onboarding.active_business_profile_id=profile.id AND onboarding.status='complete'
  WHERE profile.organization_id=org AND profile.is_active=TRUE;
 time_zone_value:=profile_row.raw_profile#>>'{company,timeZone}';currency_value:=profile_row.raw_profile#>>'{company,currency}';
 IF profile_row.id IS NULL OR time_zone_value IS NULL OR currency_value IS NULL OR currency_value!~'^[A-Z]{3}$' OR
    NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=time_zone_value) THEN
  RETURN public.canonical_forecast_overhead_cash_v1_unavailable('reporting_profile_unavailable',cutoff_value,horizon_value);END IF;
 local_start:=(cutoff_value AT TIME ZONE time_zone_value)::date;local_end:=local_start+30;
 SELECT * INTO source_row FROM public.canonical_operating_cost_schedule_revisions
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF source_row.id IS NULL OR source_row.action<>'replace' THEN
  RETURN public.canonical_forecast_overhead_cash_v1_unavailable('owner_recorded_schedule_coverage_unavailable',cutoff_value,horizon_value);END IF;
 IF source_row.payload->>'currency' IS DISTINCT FROM currency_value THEN
  RETURN public.canonical_forecast_overhead_cash_v1_unavailable('schedule_currency_conflict',cutoff_value,horizon_value);END IF;
 IF (source_row.payload->>'effectiveOn')::date>local_start OR
    (source_row.payload#>>'{coverage,startsOn}')::date>local_start OR
    (source_row.payload#>>'{coverage,endsOn}')::date<local_end-1 OR
    (((source_row.payload#>>'{coverage,recordedThrough}')::timestamptz AT TIME ZONE time_zone_value)::date)<local_start OR
    source_row.payload#>>'{allocationPolicy,status}'<>'reconciled' THEN
  RETURN public.canonical_forecast_overhead_cash_v1_unavailable('owner_recorded_schedule_coverage_stale',cutoff_value,horizon_value);END IF;
 FOR schedule IN SELECT value FROM jsonb_array_elements(source_row.payload->'schedules') LOOP
  IF schedule->>'currency' IS DISTINCT FROM currency_value OR
     (schedule->>'kind'='financed_asset_obligation' AND NOT EXISTS(
      SELECT 1 FROM public.tenant_assets asset WHERE asset.organization_id=org
       AND asset.id=(schedule->>'assetId')::uuid AND asset.catalogue_state='active')) THEN
   RETURN public.canonical_forecast_overhead_cash_v1_unavailable('schedule_source_currentness_unavailable',cutoff_value,horizon_value);END IF;
  amount_cents:=round((schedule->>'amount')::numeric*100);scheduled_in_window:=FALSE;
  FOR due_item IN SELECT value FROM jsonb_array_elements(schedule->'dueDates') LOOP
   due_on:=(due_item->>'dueOn')::date;
   IF due_on>=local_start AND due_on<local_end THEN
    IF due_item->>'paymentStatus'='scheduled' THEN
     scheduled_in_window:=TRUE;
     IF schedule->>'kind'='overhead_expense' THEN overhead_cents:=overhead_cents+amount_cents;overhead_due_count:=overhead_due_count+1;
     ELSE asset_cents:=asset_cents+amount_cents;asset_due_count:=asset_due_count+1;END IF;
    ELSIF schedule->>'kind'='financed_asset_obligation' AND
          due_item->>'paymentStatus'='owner_marked_satisfied' THEN satisfied_count:=satisfied_count+1;
    ELSIF schedule->>'kind'='financed_asset_obligation' THEN canceled_count:=canceled_count+1;END IF;
   END IF;
  END LOOP;
  IF scheduled_in_window THEN
   IF schedule->>'kind'='overhead_expense' THEN overhead_schedule_count:=overhead_schedule_count+1;
   ELSE obligation_count:=obligation_count+1;END IF;
  END IF;
 END LOOP;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-overhead-cash-forecast-v1','state','current','reason',NULL,'fictional',FALSE,
  'checkedAt',public.canonical_forecast_utc_instant(cutoff_value),'currency',currency_value,
  'horizon',jsonb_build_object('startsAt',public.canonical_forecast_utc_instant(cutoff_value),
   'endsAt',public.canonical_forecast_utc_instant(horizon_value),'days',30),
  'scope',jsonb_build_object('label','Next 30 days of owner-recorded company obligations',
   'wholeBusinessCoverageVerified',TRUE,'offPlatformCoverageVerified',FALSE),
  'overhead',jsonb_build_object('state','current','amount',to_char(overhead_cents/100,'FM999999999999990.00'),
   'dueCount',overhead_due_count,'scheduleCount',overhead_schedule_count,'reason',NULL),
  'financedAssetCash',jsonb_build_object('state','current','amount',to_char(asset_cents/100,'FM999999999999990.00'),
   'dueCount',asset_due_count,'obligationCount',obligation_count,
   'ownerMarkedSatisfiedCount',satisfied_count,'canceledCount',canceled_count,'reason',NULL),
  'evidence',jsonb_build_object('ownerRecordedSchedules',TRUE,'exactAmounts',TRUE,'exactDueDates',TRUE,
   'recurrenceEndRecorded',TRUE,'sourceAttested',TRUE,'currentRevision',TRUE,'completeAsOf',TRUE,
   'overlapReconciled',TRUE,'actualPaymentVerified',FALSE,'learnedAdjustmentApplied',FALSE),
  'allocation',jsonb_build_object('state','reconciled','basis','owner_approved_schedule_policy',
   'jobCostAllocationIncluded',FALSE,'economicDepreciationIncluded',FALSE,'actualPaymentClaimed',FALSE,
   'reason','dated_cash_commitments_kept_separate_from_job_cost_and_economic_recovery'),
  'forecastIssued',TRUE,'completeOperatingCostForecastIssued',FALSE,'calibratedRangeIssued',FALSE,
  'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_operating_cost_schedule_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_schedule_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_snapshot_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_snapshot_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_snapshot_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_overhead_cash_v1_unavailable(TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_overhead_cash_v1_current(UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ DECLARE runtime_role TEXT:='northstar_app_runtime'; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.canonical_operating_cost_snapshot_mutate(uuid,uuid,text,uuid,text,text,jsonb) TO %I',runtime_role);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.canonical_operating_cost_snapshot_read(uuid,uuid,text,uuid) TO %I',runtime_role);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_overhead_cash_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
 END IF;
END $$;
