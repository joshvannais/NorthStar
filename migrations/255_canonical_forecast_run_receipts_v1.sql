-- Mission 26 Part 11B: immutable forecast run receipts and controlled
-- comparison over the one currently authorized deterministic demand target.
-- Part 11C still owns durable invalidation/correction events and Part 11D owns
-- reviewed handoff. Nothing here performs an operational action.

CREATE TABLE public.canonical_forecast_runs_v1 (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 prediction_cutoff TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL,
 settings_revision INTEGER NOT NULL,
 settings_digest CHAR(64) NOT NULL CHECK(settings_digest~'^[0-9a-f]{64}$'),
 origin_id UUID NOT NULL,
 source_snapshot_digest CHAR(64) NOT NULL CHECK(source_snapshot_digest~'^[0-9a-f]{64}$'),
 reporting_window_digest CHAR(64) NOT NULL CHECK(reporting_window_digest~'^[0-9a-f]{64}$'),
 feature_set_digest CHAR(64) NOT NULL CHECK(feature_set_digest~'^[0-9a-f]{64}$'),
 algorithm_key TEXT NOT NULL,
 algorithm_version TEXT NOT NULL,
 algorithm_definition_digest CHAR(64) NOT NULL CHECK(algorithm_definition_digest~'^[0-9a-f]{64}$'),
 implementation_digest CHAR(64) NOT NULL CHECK(implementation_digest~'^[0-9a-f]{64}$'),
 build_digest CHAR(64) NOT NULL CHECK(build_digest~'^[0-9a-f]{64}$'),
 calculation_version TEXT NOT NULL,
 output_contract_version TEXT NOT NULL,
 input_digest CHAR(64) NOT NULL CHECK(input_digest~'^[0-9a-f]{64}$'),
 result_digest CHAR(64) NOT NULL CHECK(result_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 receipt JSONB NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 receipt_canonical TEXT NOT NULL CHECK(octet_length(receipt_canonical) BETWEEN 2 AND 32768),
 actor_user_id UUID NOT NULL,
 actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 supersedes_run_id UUID,
 supersedes_run_digest CHAR(64),
 supersession_reason TEXT,
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_digest),
 UNIQUE(organization_id,origin_id),
 FOREIGN KEY(organization_id,settings_revision)
  REFERENCES public.canonical_forecast_settings_revisions_v1(organization_id,revision)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,origin_id)
  REFERENCES public.canonical_forecast_retell_future_origins_v2(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(created_at>=prediction_cutoff),
 CHECK(receipt=(receipt_canonical::jsonb||jsonb_build_object('digest',rtrim(canonical_digest)))),
 CHECK(rtrim(canonical_digest)=encode(sha256(convert_to(receipt_canonical,'UTF8')),'hex')),
 CHECK(receipt->>'version'='m26-forecast-run-receipt-v2'),
 CHECK(receipt->>'id'=id::text AND receipt->>'organizationId'=organization_id::text),
 CHECK((receipt#>>'{settings,revision}')::integer=settings_revision),
 CHECK(receipt#>>'{settings,digest}'=rtrim(settings_digest)),
 CHECK(receipt->>'sourceSnapshotDigest'=rtrim(source_snapshot_digest)),
 CHECK(receipt->>'reportingWindowDigest'=rtrim(reporting_window_digest)),
 CHECK(receipt->>'featureSetDigest'=rtrim(feature_set_digest)),
 CHECK(receipt#>>'{algorithm,key}'=algorithm_key AND
       receipt#>>'{algorithm,version}'=algorithm_version AND
       receipt#>>'{algorithm,definitionDigest}'=rtrim(algorithm_definition_digest) AND
       receipt#>>'{algorithm,implementationDigest}'=rtrim(implementation_digest) AND
       receipt#>>'{algorithm,buildDigest}'=rtrim(build_digest)),
 CHECK(receipt->>'calculationVersion'=calculation_version AND
       receipt->>'outputContractVersion'=output_contract_version),
 CHECK(receipt->>'inputDigest'=rtrim(input_digest) AND
       receipt->>'resultDigest'=rtrim(result_digest)),
 CHECK((supersedes_run_id IS NULL AND supersedes_run_digest IS NULL AND
        supersession_reason IS NULL AND receipt->'supersedes'='null'::jsonb AND
        receipt->'supersessionReason'='null'::jsonb) OR
       (supersedes_run_id IS NOT NULL AND supersedes_run_digest~'^[0-9a-f]{64}$' AND
        supersession_reason~'^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$' AND
        length(supersession_reason)<=80 AND
        receipt#>>'{supersedes,runId}'=supersedes_run_id::text AND
        receipt#>>'{supersedes,runDigest}'=rtrim(supersedes_run_digest) AND
        receipt->>'supersessionReason'=supersession_reason))
);

CREATE TABLE public.canonical_forecast_run_outputs_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL,
 run_id UUID NOT NULL,
 ordinal SMALLINT NOT NULL CHECK(ordinal BETWEEN 0 AND 23),
 target_key TEXT NOT NULL,
 target_version TEXT NOT NULL,
 output JSONB NOT NULL CHECK(jsonb_typeof(output)='object'),
 output_digest CHAR(64) NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,run_id,ordinal),
 UNIQUE(organization_id,run_id,target_key,target_version),
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_runs_v1(organization_id,id) ON DELETE RESTRICT,
 CHECK(output#>>'{target,key}'=target_key AND
       output#>>'{target,definitionVersion}'=target_version),
 CHECK(rtrim(output_digest)=public.canonical_completion_digest(output))
);

CREATE TABLE public.canonical_forecast_run_supersessions_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL,
 prior_run_id UUID NOT NULL,
 prior_run_digest CHAR(64) NOT NULL CHECK(prior_run_digest~'^[0-9a-f]{64}$'),
 replacement_run_id UUID NOT NULL,
 replacement_run_digest CHAR(64) NOT NULL CHECK(replacement_run_digest~'^[0-9a-f]{64}$'),
 reason TEXT NOT NULL CHECK(reason~'^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$' AND length(reason)<=80),
 actor_user_id UUID NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,prior_run_id),
 UNIQUE(organization_id,replacement_run_id),
 FOREIGN KEY(organization_id,prior_run_id)
  REFERENCES public.canonical_forecast_runs_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,replacement_run_id)
  REFERENCES public.canonical_forecast_runs_v1(organization_id,id) ON DELETE RESTRICT,
 CHECK(prior_run_id<>replacement_run_id),
 CHECK(rtrim(canonical_digest)=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',organization_id,'priorRunId',prior_run_id,
  'priorRunDigest',rtrim(prior_run_digest),'replacementRunId',replacement_run_id,
  'replacementRunDigest',rtrim(replacement_run_digest),'reason',reason,
  'actorUserId',actor_user_id)))
);

CREATE TRIGGER canonical_forecast_runs_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_runs_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();
CREATE TRIGGER canonical_forecast_run_outputs_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_run_outputs_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();
CREATE TRIGGER canonical_forecast_run_supersessions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_run_supersessions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

-- One pure, digest-addressed calculator is shared by issue and controlled
-- rerun. The immutable Part 4A origin capture remains the authenticated input
-- reader; this function is the only Part 11B output calculation path.
CREATE FUNCTION public.canonical_forecast_run_v1_calculate(evidence_value JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE lead_total BIGINT;period_count INTEGER;amount_value TEXT;
BEGIN
 IF jsonb_typeof(evidence_value)<>'object' OR
    jsonb_typeof(evidence_value->'periods')<>'array' OR
    jsonb_array_length(evidence_value->'periods')<>3 THEN RETURN NULL;END IF;
 SELECT count(*),sum((item->>'leadCount')::bigint) INTO period_count,lead_total
 FROM jsonb_array_elements(evidence_value->'periods') item
 WHERE item->>'leadCount'~'^(?:0|[1-9][0-9]{0,14})$';
 IF period_count<>3 OR lead_total IS NULL THEN RETURN NULL;END IF;
 amount_value:=trim(trailing '.' FROM trim(trailing '0' FROM
  to_char(round(lead_total::numeric/3,6),'FM999999999999990.000000')));
 RETURN jsonb_build_object('contractVersion','m26-forecast-output-v1',
  'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1'),
  'unit',jsonb_build_object('key','count','currency',NULL),
  'value',jsonb_build_object('kind','point','amount',amount_value),
  'confidence',jsonb_build_object('state','unavailable','backtestDigest',NULL),
  'uncertainty',jsonb_build_object('state','unquantified',
   'drivers',jsonb_build_array('retell_only','human_attested_coverage','uncalibrated')),
  'applicability',jsonb_build_object('serviceKey',NULL,'areaKey',NULL,
   'limits',jsonb_build_array('retell_only','tenant_all')),
  'calculationVersion','m26-retell-three-month-mean-v2',
  'researchOnly',TRUE,'realForecastEligible',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE);
EXCEPTION WHEN data_exception THEN RETURN NULL;
END $$;

CREATE TABLE public.canonical_forecast_run_calculators_v1 (
 calculator_key TEXT PRIMARY KEY CHECK(calculator_key='demand.inbound_leads.monthly_mean'),
 calculator_version TEXT NOT NULL UNIQUE CHECK(calculator_version='m26-run-calculator-v1'),
 implementation_identity TEXT NOT NULL CHECK(implementation_identity=
  'public.canonical_forecast_run_v1_calculate(jsonb)'),
 implementation_digest CHAR(64) NOT NULL CHECK(implementation_digest~'^[0-9a-f]{64}$'),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER canonical_forecast_run_calculators_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_run_calculators_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();
INSERT INTO public.canonical_forecast_run_calculators_v1(
 calculator_key,calculator_version,implementation_identity,implementation_digest)
VALUES('demand.inbound_leads.monthly_mean','m26-run-calculator-v1',
 'public.canonical_forecast_run_v1_calculate(jsonb)',
 encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_run_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex'));

CREATE FUNCTION public.canonical_forecast_run_v1_paid_authority(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,mutation BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'Forecast run access restricted' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,mutation);
 PERFORM 1 FROM public.subscriptions subscription
 JOIN public.organization_onboarding onboarding
  ON onboarding.organization_id=subscription.organization_id
 WHERE subscription.organization_id=org AND onboarding.status='complete'
  AND (subscription.status='active' OR (subscription.status='trialing' AND
   subscription.trial_started_at IS NOT NULL AND
   subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days' AND
   subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Forecast run access unavailable' USING ERRCODE='42501';END IF;
 RETURN authority;
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_prepare(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 request_hash TEXT,expected_revision INTEGER,expected_digest TEXT,horizon_month DATE,
 supersedes_id UUID,supersedes_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_settings public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 replay public.canonical_forecast_runs_v1%ROWTYPE;prior public.canonical_forecast_runs_v1%ROWTYPE;
 origin public.canonical_forecast_retell_future_origins_v2%ROWTYPE;
 calculator public.canonical_forecast_run_calculators_v1%ROWTYPE;
 origin_result JSONB;baseline JSONB;new_id UUID:=gen_random_uuid();created_value TIMESTAMPTZ;
 calculated_output JSONB;installed_calculator_digest TEXT;
 key_hash TEXT;child_key TEXT;settings_value JSONB;business_time_zone TEXT;
 first_horizon DATE;horizon_periods INTEGER;prior_projection JSONB;
BEGIN
 authority:=public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    request_hash IS NULL OR request_hash!~'^[0-9a-f]{64}$' OR
    expected_revision IS NULL OR expected_revision<1 OR expected_revision>=1000000000 OR
    expected_digest IS NULL OR expected_digest!~'^[0-9a-f]{64}$' OR
    horizon_month IS NULL OR extract(day FROM horizon_month)<>1 OR
    horizon_month<DATE '2000-01-01' OR horizon_month>=DATE '2100-12-01' OR
    ((supersedes_id IS NULL)<>(supersedes_digest IS NULL)) OR
    (supersedes_digest IS NOT NULL AND supersedes_digest!~'^[0-9a-f]{64}$') THEN
  RAISE EXCEPTION 'Forecast run request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF pg_try_advisory_xact_lock(hashtextextended(
   'm26:forecast-run-request:'||org::text||':'||actor::text||':'||key_hash,0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended(org::text||':forecast-retell-source-consent',0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended('m26:forecast-run:'||org::text,0)) IS NOT TRUE THEN
  RAISE EXCEPTION 'Forecast run request is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO replay FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_digest=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Forecast run request key conflict' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('state','replay','runId',replay.id,'runDigest',rtrim(replay.canonical_digest));
 END IF;
 SELECT * INTO current_settings FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR SHARE NOWAIT;
 IF current_settings.id IS NULL OR current_settings.revision<>expected_revision OR
    rtrim(current_settings.canonical_digest)<>expected_digest THEN
  RAISE EXCEPTION 'Forecast settings changed' USING ERRCODE='40001';END IF;
 settings_value:=current_settings.normalized->'settings';
 IF public.canonical_forecast_settings_v1_settings_valid(settings_value,org) IS NOT TRUE OR
    settings_value->>'enabled'<>'true' OR
    settings_value->'targets'<>'["demand.inbound_leads"]'::jsonb OR
    jsonb_array_length(settings_value->'horizons')<>1 OR
    settings_value#>>'{horizons,0,grain}'<>'month' THEN
  RETURN jsonb_build_object('state','unavailable','reason','settings_not_enabled');END IF;
 horizon_periods:=(settings_value#>>'{horizons,0,periods}')::integer;
 SELECT profile.raw_profile#>>'{company,timeZone}' INTO business_time_zone
 FROM public.canonical_business_profiles profile
 WHERE profile.organization_id=org AND profile.is_active
 ORDER BY profile.created_at DESC,profile.id DESC LIMIT 1;
 IF business_time_zone IS NULL THEN RETURN jsonb_build_object(
  'state','unavailable','reason','source_or_algorithm_not_current');END IF;
 first_horizon:=(date_trunc('month',statement_timestamp() AT TIME ZONE
  business_time_zone)+INTERVAL '1 month')::date;
 IF horizon_month<first_horizon OR
    horizon_month>=(first_horizon+(horizon_periods||' months')::interval)::date THEN
  RAISE EXCEPTION 'Forecast run horizon is outside reviewed settings' USING ERRCODE='22023';END IF;
 IF supersedes_id IS NOT NULL THEN
  SELECT * INTO prior FROM public.canonical_forecast_runs_v1
   WHERE organization_id=org AND id=supersedes_id FOR SHARE NOWAIT;
  IF prior.id IS NULL OR rtrim(prior.canonical_digest)<>supersedes_digest OR
     EXISTS(SELECT 1 FROM public.canonical_forecast_run_supersessions_v1
       WHERE organization_id=org AND prior_run_id=prior.id) THEN
   RAISE EXCEPTION 'Forecast run supersession changed' USING ERRCODE='40001';END IF;
  prior_projection:=public.canonical_forecast_run_v1_read(
   org,actor,role_value,session_value,prior.id);
  IF prior_projection->>'state'<>'current' THEN
   RAISE EXCEPTION 'Forecast run supersession is not current' USING ERRCODE='40001';END IF;
 END IF;
 child_key:='m26run:'||key_value;
 origin_result:=public.canonical_forecast_retell_future_origin_v2_capture(
  org,actor,role_value,session_value,csrf,child_key,horizon_month);
 IF origin_result->>'state'<>'retell_future_origin_saved' THEN
  RETURN jsonb_build_object('state','unavailable','reason','source_or_algorithm_not_current');END IF;
 baseline:=public.canonical_forecast_deterministic_baseline_v1_read(
  org,actor,role_value,session_value,(origin_result->>'id')::uuid);
 SELECT * INTO origin FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND id=(origin_result->>'id')::uuid FOR SHARE NOWAIT;
 SELECT * INTO calculator FROM public.canonical_forecast_run_calculators_v1
  WHERE calculator_key='demand.inbound_leads.monthly_mean' AND
   calculator_version='m26-run-calculator-v1';
 installed_calculator_digest:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_run_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex');
 calculated_output:=public.canonical_forecast_run_v1_calculate(origin.evidence);
 IF baseline IS NULL OR baseline->>'state'<>'current' OR
    origin.id IS NULL OR calculated_output IS NULL OR
    calculator.calculator_key IS NULL OR
    rtrim(calculator.implementation_digest)<>installed_calculator_digest OR
    baseline->'output' IS DISTINCT FROM calculated_output OR
    baseline->>'sourceAuthenticated'<>'true' OR baseline->>'forecastIssued'<>'true' OR
    baseline#>>'{currentness,sourceCurrent}'<>'true' OR
    baseline#>>'{currentness,refreshRequired}'<>'false' OR
    baseline#>>'{target,key}'<>'demand.inbound_leads' OR
    baseline#>>'{target,definitionVersion}'<>'v1' OR
    baseline#>>'{unit,key}'<>'count' OR
    baseline#>'{unit,currency}'<>'null'::jsonb OR
    baseline#>>'{horizon,localStart}'<>horizon_month::text OR
    (baseline->>'issuedAt')::timestamptz >= (baseline#>>'{horizon,startsAt}')::timestamptz THEN
  RAISE EXCEPTION 'Forecast run post-capture evidence unavailable'
   USING ERRCODE='P11B1',DETAIL='source_or_algorithm_not_current';END IF;
 created_value:=date_trunc('milliseconds',clock_timestamp());
 RETURN jsonb_build_object('state','prepared','id',new_id,'organizationId',org,
  'asOf',baseline->>'issuedAt','createdAt',to_char(created_value AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'settings',jsonb_build_object('revision',current_settings.revision,
    'digest',rtrim(current_settings.canonical_digest)),
  'sourceSnapshotDigest',baseline#>>'{sourceSnapshot,evidenceDigest}',
  'reportingWindow',baseline->'horizon','featureSetDigest',baseline#>>'{digests,input}',
  'algorithm',((baseline#>'{provenance,algorithm}')-'buildIdentity')||jsonb_build_object(
    'buildIdentity',jsonb_build_object('kind','postgresql_function_definition_sha256',
      'procedure',calculator.implementation_identity),
    'buildDigest',rtrim(calculator.implementation_digest)),
  'calculationVersion',baseline#>>'{output,calculationVersion}',
  'outputContractVersion',baseline#>>'{output,contractVersion}',
  'output',jsonb_build_object('targetKey','demand.inbound_leads','targetVersion','v1',
    'payload',calculated_output,'outputDigest',
      public.canonical_completion_digest(calculated_output)),
  'supersedes',CASE WHEN prior.id IS NULL THEN NULL ELSE jsonb_build_object(
    'runId',prior.id,'runDigest',rtrim(prior.canonical_digest)) END);
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_commit(
 org UUID,actor UUID,role_value TEXT,session_value UUID,key_value TEXT,
 request_hash TEXT,expected_revision INTEGER,expected_digest TEXT,horizon_month DATE,
 run_value UUID,receipt_value JSONB,output_value JSONB,input_canonical TEXT,
 result_canonical TEXT,receipt_canonical_value TEXT,supersession_reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_settings public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 origin public.canonical_forecast_retell_future_origins_v2%ROWTYPE;baseline JSONB;
 registry public.canonical_forecast_deterministic_baseline_algorithms_v1%ROWTYPE;
 calculator public.canonical_forecast_run_calculators_v1%ROWTYPE;calculated_output JSONB;
 installed_calculator_digest TEXT;
 old_run public.canonical_forecast_runs_v1%ROWTYPE;inserted public.canonical_forecast_runs_v1%ROWTYPE;
 membership_value UUID;key_hash TEXT;child_key TEXT;child_key_hash TEXT;
 expected_input JSONB;expected_result JSONB;expected_receipt JSONB;business_time_zone TEXT;
 first_horizon DATE;horizon_periods INTEGER;
 input_hash TEXT;result_hash TEXT;receipt_hash TEXT;
BEGIN
 IF run_value IS NULL OR receipt_value IS NULL OR jsonb_typeof(receipt_value)<>'object' OR
    output_value IS NULL OR jsonb_typeof(output_value)<>'object' OR
    input_canonical IS NULL OR result_canonical IS NULL OR receipt_canonical_value IS NULL OR
    octet_length(input_canonical)>32768 OR octet_length(result_canonical)>32768 OR
    octet_length(receipt_canonical_value)>32768 THEN
  RAISE EXCEPTION 'Forecast run commit invalid' USING ERRCODE='22023';END IF;
 membership_value:=(public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,NULL,FALSE)->>'membershipId')::uuid;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF pg_try_advisory_xact_lock(hashtextextended(
   'm26:forecast-run-request:'||org::text||':'||actor::text||':'||key_hash,0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended('m26:forecast-run:'||org::text,0)) IS NOT TRUE THEN
  RAISE EXCEPTION 'Forecast run request is busy' USING ERRCODE='55P03';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_runs_v1
   WHERE organization_id=org AND actor_user_id=actor AND request_key_digest=key_hash) THEN
  RAISE EXCEPTION 'Forecast run request changed during capture' USING ERRCODE='40001';END IF;
 SELECT * INTO current_settings FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR SHARE NOWAIT;
 IF current_settings.id IS NULL OR current_settings.revision<>expected_revision OR
    rtrim(current_settings.canonical_digest)<>expected_digest OR
    public.canonical_forecast_settings_v1_settings_valid(
      current_settings.normalized->'settings',org) IS NOT TRUE THEN
  RAISE EXCEPTION 'Forecast settings changed' USING ERRCODE='40001';END IF;
 horizon_periods:=(current_settings.normalized#>>'{settings,horizons,0,periods}')::integer;
 SELECT profile.raw_profile#>>'{company,timeZone}' INTO business_time_zone
 FROM public.canonical_business_profiles profile
 WHERE profile.organization_id=org AND profile.is_active
 ORDER BY profile.created_at DESC,profile.id DESC LIMIT 1;
 first_horizon:=(date_trunc('month',statement_timestamp() AT TIME ZONE
  business_time_zone)+INTERVAL '1 month')::date;
 IF business_time_zone IS NULL OR horizon_month<first_horizon OR
    horizon_month>=(first_horizon+(horizon_periods||' months')::interval)::date THEN
  RAISE EXCEPTION 'Forecast run horizon changed' USING ERRCODE='40001';END IF;
 child_key:='m26run:'||key_value;
 child_key_hash:=encode(sha256(convert_to(child_key,'UTF8')),'hex');
 SELECT * INTO origin FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=child_key_hash
  FOR SHARE NOWAIT;
 IF origin.id IS NULL OR origin.local_horizon_start<>horizon_month THEN
  RAISE EXCEPTION 'Forecast run source changed' USING ERRCODE='40001';END IF;
 baseline:=public.canonical_forecast_deterministic_baseline_v1_read(
  org,actor,role_value,session_value,origin.id);
 SELECT * INTO registry FROM public.canonical_forecast_deterministic_baseline_algorithms_v1
  WHERE algorithm_key='retell_three_complete_month_mean' AND
    algorithm_version='m26-retell-three-month-mean-v2';
 SELECT * INTO calculator FROM public.canonical_forecast_run_calculators_v1
  WHERE calculator_key='demand.inbound_leads.monthly_mean' AND
   calculator_version='m26-run-calculator-v1';
 installed_calculator_digest:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_run_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex');
 calculated_output:=public.canonical_forecast_run_v1_calculate(origin.evidence);
 IF baseline IS NULL OR baseline->>'state'<>'current' OR
    receipt_value->>'version'<>'m26-forecast-run-receipt-v2' OR
    receipt_value->>'id'<>run_value::text OR receipt_value->>'organizationId'<>org::text OR
    (receipt_value->>'asOf')::timestamptz<>origin.as_of OR
    (receipt_value#>>'{settings,revision}')::integer<>expected_revision OR
    receipt_value#>>'{settings,digest}'<>expected_digest OR
    receipt_value->>'sourceSnapshotDigest'<>baseline#>>'{sourceSnapshot,evidenceDigest}' OR
    receipt_value->>'reportingWindowDigest'<>encode(sha256(convert_to(format(
     '{"endsAt":"%s","grain":"%s","localStart":"%s","startsAt":"%s","timeZone":"%s"}',
     baseline#>>'{horizon,endsAt}',baseline#>>'{horizon,grain}',
     baseline#>>'{horizon,localStart}',baseline#>>'{horizon,startsAt}',
     baseline#>>'{horizon,timeZone}'),'UTF8')),'hex') OR
    receipt_value->>'featureSetDigest'<>baseline#>>'{digests,input}' OR
    (receipt_value->>'createdAt')::timestamptz<origin.as_of OR
    (receipt_value->>'createdAt')::timestamptz>statement_timestamp()+INTERVAL '1 second' OR
    receipt_value#>>'{algorithm,key}'<>registry.algorithm_key OR
    receipt_value#>>'{algorithm,version}'<>registry.algorithm_version OR
    receipt_value#>>'{algorithm,definitionDigest}'<>rtrim(registry.definition_digest) OR
    receipt_value#>>'{algorithm,implementationDigest}'<>rtrim(registry.implementation_digest) OR
    calculator.calculator_key IS NULL OR calculated_output IS NULL OR
    rtrim(calculator.implementation_digest)<>installed_calculator_digest OR
    receipt_value#>>'{algorithm,buildDigest}'<>installed_calculator_digest OR
    receipt_value->>'calculationVersion'<>baseline#>>'{output,calculationVersion}' OR
    receipt_value->>'outputContractVersion'<>baseline#>>'{output,contractVersion}' OR
    jsonb_array_length(receipt_value->'outputs')<>1 OR
    receipt_value#>>'{outputs,0,targetKey}'<>'demand.inbound_leads' OR
    receipt_value#>>'{outputs,0,targetVersion}'<>'v1' OR
    receipt_value#>>'{outputs,0,outputDigest}'<>baseline#>>'{digests,output}' OR
    output_value IS DISTINCT FROM calculated_output OR
    baseline->'output' IS DISTINCT FROM calculated_output THEN
  RAISE EXCEPTION 'Forecast run authority changed' USING ERRCODE='40001';END IF;
 IF receipt_value->'supersedes'<>'null'::jsonb THEN
  SELECT * INTO old_run FROM public.canonical_forecast_runs_v1
   WHERE organization_id=org AND id=(receipt_value#>>'{supersedes,runId}')::uuid
   FOR SHARE NOWAIT;
  IF old_run.id IS NULL OR rtrim(old_run.canonical_digest)<>receipt_value#>>'{supersedes,runDigest}' OR
     old_run.created_at>(receipt_value->>'createdAt')::timestamptz OR
     supersession_reason_value IS NULL OR supersession_reason_value<>receipt_value->>'supersessionReason' OR
     EXISTS(SELECT 1 FROM public.canonical_forecast_run_supersessions_v1
       WHERE organization_id=org AND prior_run_id=old_run.id) THEN
   RAISE EXCEPTION 'Forecast run supersession changed' USING ERRCODE='40001';END IF;
 ELSIF supersession_reason_value IS NOT NULL OR receipt_value->'supersessionReason'<>'null'::jsonb THEN
  RAISE EXCEPTION 'Forecast run supersession invalid' USING ERRCODE='22023';END IF;
 BEGIN
  expected_input:=input_canonical::jsonb;expected_result:=result_canonical::jsonb;
  expected_receipt:=receipt_canonical_value::jsonb;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Forecast run canonical identity invalid' USING ERRCODE='22023';END;
 input_hash:=encode(sha256(convert_to(input_canonical,'UTF8')),'hex');
 result_hash:=encode(sha256(convert_to(result_canonical,'UTF8')),'hex');
 receipt_hash:=encode(sha256(convert_to(receipt_canonical_value,'UTF8')),'hex');
 IF receipt_value->>'inputDigest'<>input_hash OR receipt_value->>'resultDigest'<>result_hash OR
    receipt_value->>'digest'<>receipt_hash OR
    expected_receipt IS DISTINCT FROM receipt_value-'digest' OR
    expected_input IS DISTINCT FROM jsonb_build_object(
      'organizationId',org,'asOf',receipt_value->>'asOf','settings',receipt_value->'settings',
      'sourceSnapshotDigest',receipt_value->>'sourceSnapshotDigest',
      'reportingWindowDigest',receipt_value->>'reportingWindowDigest',
      'featureSetDigest',receipt_value->>'featureSetDigest','algorithm',receipt_value->'algorithm',
      'calculationVersion',receipt_value->>'calculationVersion',
      'outputContractVersion',receipt_value->>'outputContractVersion',
      'targets',jsonb_build_array(jsonb_build_object(
        'targetKey','demand.inbound_leads','targetVersion','v1'))) OR
    expected_result IS DISTINCT FROM jsonb_build_object('outputs',receipt_value->'outputs') THEN
  RAISE EXCEPTION 'Forecast run digest identity invalid' USING ERRCODE='22023';END IF;
 INSERT INTO public.canonical_forecast_runs_v1(
  id,organization_id,prediction_cutoff,created_at,settings_revision,settings_digest,
  origin_id,source_snapshot_digest,reporting_window_digest,feature_set_digest,
  algorithm_key,algorithm_version,algorithm_definition_digest,implementation_digest,
  build_digest,calculation_version,output_contract_version,input_digest,result_digest,
  canonical_digest,receipt,receipt_canonical,actor_user_id,actor_access_role,membership_id,
  auth_session_id,request_key_digest,request_digest,supersedes_run_id,supersedes_run_digest,
  supersession_reason)
 VALUES(run_value,org,(receipt_value->>'asOf')::timestamptz,
  (receipt_value->>'createdAt')::timestamptz,expected_revision,expected_digest,origin.id,
  receipt_value->>'sourceSnapshotDigest',receipt_value->>'reportingWindowDigest',
  receipt_value->>'featureSetDigest',receipt_value#>>'{algorithm,key}',
  receipt_value#>>'{algorithm,version}',receipt_value#>>'{algorithm,definitionDigest}',
  receipt_value#>>'{algorithm,implementationDigest}',receipt_value#>>'{algorithm,buildDigest}',
  receipt_value->>'calculationVersion',receipt_value->>'outputContractVersion',input_hash,
  result_hash,receipt_hash,receipt_value,receipt_canonical_value,actor,role_value,
  membership_value,session_value,key_hash,request_hash,old_run.id,
  CASE WHEN old_run.id IS NULL THEN NULL ELSE rtrim(old_run.canonical_digest) END,
  supersession_reason_value) RETURNING * INTO inserted;
 INSERT INTO public.canonical_forecast_run_outputs_v1(
  organization_id,run_id,ordinal,target_key,target_version,output,output_digest)
 VALUES(org,inserted.id,0,'demand.inbound_leads','v1',output_value,
  baseline#>>'{digests,output}');
 IF old_run.id IS NOT NULL THEN
  INSERT INTO public.canonical_forecast_run_supersessions_v1(
   organization_id,prior_run_id,prior_run_digest,replacement_run_id,
   replacement_run_digest,reason,actor_user_id,canonical_digest)
  VALUES(org,old_run.id,rtrim(old_run.canonical_digest),inserted.id,
   rtrim(inserted.canonical_digest),supersession_reason_value,actor,
   public.canonical_completion_digest(jsonb_build_object(
    'organizationId',org,'priorRunId',old_run.id,
    'priorRunDigest',rtrim(old_run.canonical_digest),'replacementRunId',inserted.id,
    'replacementRunDigest',rtrim(inserted.canonical_digest),
    'reason',supersession_reason_value,'actorUserId',actor)));
 END IF;
 INSERT INTO public.audit_logs(organization_id,user_id,action,entity_type,entity_id,details)
 VALUES(org,actor,'forecast_run_receipt_recorded','forecast_run',inserted.id::text,
  jsonb_build_object('runDigest',rtrim(inserted.canonical_digest),
   'settingsRevision',inserted.settings_revision,'settingsDigest',expected_digest,
   'targetCount',1,'supersedesRunId',old_run.id,'automaticActionAuthorized',FALSE));
 RETURN public.canonical_forecast_run_v1_read(org,actor,role_value,session_value,inserted.id);
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_runs_v1%ROWTYPE;baseline JSONB;outputs JSONB;
 registry public.canonical_forecast_deterministic_baseline_algorithms_v1%ROWTYPE;
 calculator public.canonical_forecast_run_calculators_v1%ROWTYPE;
 current_settings public.canonical_forecast_settings_revisions_v1%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND id=run_value;
 IF saved.id IS NULL THEN RETURN jsonb_build_object(
  'state','unavailable','reason','run_not_found','runs',NULL);END IF;
 SELECT * INTO current_settings FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF current_settings.id IS NULL OR current_settings.revision<>saved.settings_revision OR
    rtrim(current_settings.canonical_digest)<>rtrim(saved.settings_digest) THEN
  RETURN jsonb_build_object('state','unavailable',
   'reason','settings_not_current','runs',NULL);END IF;
 baseline:=public.canonical_forecast_deterministic_baseline_v1_read(
  org,actor,role_value,session_value,saved.origin_id);
 SELECT * INTO registry FROM public.canonical_forecast_deterministic_baseline_algorithms_v1
  WHERE algorithm_key=saved.algorithm_key AND algorithm_version=saved.algorithm_version;
 SELECT * INTO calculator FROM public.canonical_forecast_run_calculators_v1
  WHERE calculator_key='demand.inbound_leads.monthly_mean' AND
   calculator_version='m26-run-calculator-v1';
 IF baseline IS NULL OR baseline->>'state'<>'current' OR
    baseline#>>'{sourceSnapshot,evidenceDigest}'<>rtrim(saved.source_snapshot_digest) OR
    baseline#>>'{digests,input}'<>rtrim(saved.feature_set_digest) OR
    baseline#>>'{digests,output}' IS NULL OR registry.algorithm_key IS NULL OR
    rtrim(registry.definition_digest)<>rtrim(saved.algorithm_definition_digest) OR
    rtrim(registry.implementation_digest)<>rtrim(saved.implementation_digest) OR
    calculator.calculator_key IS NULL OR
    rtrim(saved.build_digest)<>rtrim(calculator.implementation_digest) OR
    rtrim(calculator.implementation_digest)<>encode(sha256(convert_to(pg_get_functiondef(
     'public.canonical_forecast_run_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex') THEN
  RETURN jsonb_build_object('state','unavailable',
   'reason','source_or_algorithm_not_current','runs',NULL);END IF;
 SELECT jsonb_agg(jsonb_build_object(
   'targetKey',value.target_key,'targetVersion',value.target_version,
   'unit',value.output->'unit','value',value.output->'value',
   'outputDigest',rtrim(value.output_digest)) ORDER BY value.ordinal)
 INTO outputs FROM public.canonical_forecast_run_outputs_v1 value
 WHERE value.organization_id=org AND value.run_id=saved.id;
 IF outputs IS NULL OR jsonb_array_length(outputs)<>1 THEN
  RETURN jsonb_build_object('state','unavailable',
   'reason','retained_inputs_unavailable','runs',NULL);END IF;
 RETURN jsonb_build_object('state','current','receipt',saved.receipt,'values',outputs,
  'currentness',jsonb_build_object('sourceCurrent',TRUE,'algorithmCurrent',TRUE,
   'settingsRecorded',TRUE,'refreshRequired',FALSE),
  'historyPosition',jsonb_build_object(
   'latest',NOT EXISTS(SELECT 1 FROM public.canonical_forecast_runs_v1 newer
    WHERE newer.organization_id=org AND (newer.created_at>saved.created_at OR
      (newer.created_at=saved.created_at AND newer.id>saved.id))),
   'superseded',EXISTS(SELECT 1 FROM public.canonical_forecast_run_supersessions_v1 lineage
    WHERE lineage.organization_id=org AND lineage.prior_run_id=saved.id)));
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_list(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item public.canonical_forecast_runs_v1%ROWTYPE;projection JSONB;items JSONB:='[]'::jsonb;
BEGIN
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 FOR item IN SELECT * FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org ORDER BY created_at DESC,id DESC LIMIT 20 LOOP
  projection:=public.canonical_forecast_run_v1_read(
   org,actor,role_value,session_value,item.id);
  IF projection->>'state'<>'current' THEN RETURN jsonb_build_object(
   'state','unavailable','reason',projection->>'reason','runs',NULL);END IF;
  items:=items||jsonb_build_array(projection);
 END LOOP;
 RETURN jsonb_build_object('state','current','runs',items);
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_compare(
 org UUID,actor UUID,role_value TEXT,session_value UUID,left_id UUID,right_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE left_run public.canonical_forecast_runs_v1%ROWTYPE;
 right_run public.canonical_forecast_runs_v1%ROWTYPE;left_value JSONB;right_value JSONB;
 state_value TEXT;result JSONB;
BEGIN
 IF left_id IS NULL OR right_id IS NULL OR left_id=right_id THEN
  RAISE EXCEPTION 'Forecast comparison invalid' USING ERRCODE='22023';END IF;
 left_value:=public.canonical_forecast_run_v1_read(org,actor,role_value,session_value,left_id);
 right_value:=public.canonical_forecast_run_v1_read(org,actor,role_value,session_value,right_id);
 IF left_value->>'state'<>'current' OR right_value->>'state'<>'current' THEN
  RETURN jsonb_build_object('state','unavailable','reason',CASE
   WHEN left_value->>'reason'='run_not_found' OR right_value->>'reason'='run_not_found'
    THEN 'run_not_found'
   WHEN left_value->>'reason'='settings_not_current' OR
     right_value->>'reason'='settings_not_current' THEN 'settings_not_current'
   ELSE 'source_or_algorithm_not_current' END,'comparison',NULL);END IF;
 SELECT * INTO left_run FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND id=left_id;
 SELECT * INTO right_run FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND id=right_id;
 state_value:=CASE WHEN rtrim(left_run.input_digest)<>rtrim(right_run.input_digest)
  THEN 'input_changed' WHEN rtrim(left_run.result_digest)=rtrim(right_run.result_digest)
  THEN 'reproduced' ELSE 'result_mismatch' END;
 result:=jsonb_build_object('state',state_value,'leftRunId',left_run.id,
  'rightRunId',right_run.id,'leftRunDigest',rtrim(left_run.canonical_digest),
  'rightRunDigest',rtrim(right_run.canonical_digest),
  'sameInputs',rtrim(left_run.input_digest)=rtrim(right_run.input_digest),
  'sameResults',rtrim(left_run.result_digest)=rtrim(right_run.result_digest));
 RETURN result||jsonb_build_object('digest',public.canonical_completion_digest(result));
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_controlled_rerun(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_runs_v1%ROWTYPE;
 origin public.canonical_forecast_retell_future_origins_v2%ROWTYPE;baseline JSONB;
 registry public.canonical_forecast_deterministic_baseline_algorithms_v1%ROWTYPE;
 calculator public.canonical_forecast_run_calculators_v1%ROWTYPE;
 current_settings public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 fresh_output JSONB;installed_calculator_digest TEXT;
 fresh_output_digest TEXT;fresh_result_digest TEXT;same_value BOOLEAN;
BEGIN
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO saved FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND id=run_value FOR SHARE NOWAIT;
 IF saved.id IS NULL THEN RETURN jsonb_build_object('state','unavailable',
  'reason','run_not_found','runId',NULL,'comparison',NULL);END IF;
 SELECT * INTO current_settings FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF current_settings.id IS NULL OR current_settings.revision<>saved.settings_revision OR
    rtrim(current_settings.canonical_digest)<>rtrim(saved.settings_digest) THEN
  RETURN jsonb_build_object('state','unavailable','reason','settings_not_current',
   'runId',NULL,'comparison',NULL);END IF;
 baseline:=public.canonical_forecast_deterministic_baseline_v1_read(
  org,actor,role_value,session_value,saved.origin_id);
 SELECT * INTO origin FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND id=saved.origin_id FOR SHARE NOWAIT;
 SELECT * INTO registry FROM public.canonical_forecast_deterministic_baseline_algorithms_v1
  WHERE algorithm_key=saved.algorithm_key AND algorithm_version=saved.algorithm_version;
 SELECT * INTO calculator FROM public.canonical_forecast_run_calculators_v1
  WHERE calculator_key='demand.inbound_leads.monthly_mean' AND
   calculator_version='m26-run-calculator-v1';
 IF baseline IS NULL OR baseline->>'state'<>'current' THEN RETURN jsonb_build_object(
  'state','unavailable','reason','source_or_algorithm_not_current',
  'runId',NULL,'comparison',NULL);END IF;
 IF origin.id IS NULL OR jsonb_typeof(origin.evidence->'periods')<>'array' THEN
  RETURN jsonb_build_object('state','unavailable','reason','retained_inputs_unavailable',
   'runId',NULL,'comparison',NULL);END IF;
 installed_calculator_digest:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_run_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex');
 IF registry.algorithm_key IS NULL OR calculator.calculator_key IS NULL OR
    rtrim(registry.definition_digest)<>rtrim(saved.algorithm_definition_digest) OR
    rtrim(registry.implementation_digest)<>rtrim(saved.implementation_digest) OR
    rtrim(saved.build_digest)<>rtrim(calculator.implementation_digest) OR
    rtrim(calculator.implementation_digest)<>installed_calculator_digest OR
    encode(sha256(convert_to(pg_get_functiondef(
     'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)'::regprocedure),
     'UTF8')),'hex')<>rtrim(saved.implementation_digest) THEN
  RETURN jsonb_build_object('state','unavailable',
   'reason','exact_executable_version_unavailable','runId',NULL,'comparison',NULL);END IF;
 fresh_output:=public.canonical_forecast_run_v1_calculate(origin.evidence);
 IF fresh_output IS NULL THEN RETURN jsonb_build_object(
  'state','unavailable','reason','retained_inputs_unavailable',
  'runId',NULL,'comparison',NULL);END IF;
 fresh_output_digest:=public.canonical_completion_digest(fresh_output);
 fresh_result_digest:=encode(sha256(convert_to(format(
  '{"outputs":[{"outputDigest":"%s","targetKey":"demand.inbound_leads","targetVersion":"v1"}]}',
  fresh_output_digest),'UTF8')),'hex');
 same_value:=fresh_result_digest=rtrim(saved.result_digest);
 RETURN jsonb_build_object('state',CASE WHEN same_value THEN 'reproduced'
   ELSE 'result_mismatch' END,'runId',saved.id,'runDigest',rtrim(saved.canonical_digest),
  'storedResultDigest',rtrim(saved.result_digest),'freshResultDigest',fresh_result_digest,
  'sameResults',same_value,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_runs_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_run_outputs_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_run_supersessions_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_run_calculators_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_calculate(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_paid_authority(
 UUID,UUID,TEXT,UUID,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_prepare(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,DATE,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_commit(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,INTEGER,TEXT,DATE,UUID,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_list(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_compare(
 UUID,UUID,TEXT,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_controlled_rerun(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_runs_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_run_outputs_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_run_supersessions_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_run_calculators_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_calculate(jsonb) FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_paid_authority(uuid,uuid,text,uuid,text,boolean) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_prepare(uuid,uuid,text,uuid,text,text,text,integer,text,date,uuid,text) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_commit(uuid,uuid,text,uuid,text,text,integer,text,date,uuid,jsonb,jsonb,text,text,text,text) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_list(uuid,uuid,text,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_compare(uuid,uuid,text,uuid,uuid,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_controlled_rerun(uuid,uuid,text,uuid,text,uuid) TO %I',runtime_role);
 END IF;
END $$;
