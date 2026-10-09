-- Mission 26 Part 12A: provider-independent paid source-to-review journey.
-- This additive migration preserves the sealed Part 11 ledgers and mounts the
-- approved-price path with its own immutable receipts and review-only history.

CREATE FUNCTION public.canonical_forecast_paid_price_v1_calculate(origin_output JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF origin_output->'target'->>'key'<>'revenue.approved_price_flow' OR
    origin_output->'target'->>'definitionVersion'<>'v1' OR
    origin_output->'unit'->>'key'<>'money' OR
    origin_output->'unit'->>'currency'!~'^[A-Z]{3}$' OR
    origin_output->'value'->>'kind'<>'point' OR
    origin_output->'value'->>'amount'!~'^(0|[1-9][0-9]{0,14})\.[0-9]{2}$' OR
    origin_output->>'calculationVersion'<>'m26_price_flow_carry_forward_v1' THEN
  RAISE EXCEPTION 'Approved-price calculation input invalid' USING ERRCODE='22023';
 END IF;
 RETURN jsonb_build_object(
  'target',jsonb_build_object('key','revenue.approved_price_flow','definitionVersion','v1'),
  'predictionKind','deterministic_point','unit',origin_output->'unit',
  'value',origin_output->'value','uncertainty',jsonb_build_object(
   'state','unquantified','calibratedIntervalAvailable',FALSE,
   'reason','empirical_calibration_unavailable'),
  'calculationVersion','m26-paid-approved-price-flow-v1',
  'outputContractVersion','m26-paid-journey-output-v1');
END $$;

CREATE TABLE public.canonical_forecast_paid_price_algorithms_v1 (
 algorithm_key TEXT NOT NULL,
 algorithm_version TEXT NOT NULL,
 definition JSONB NOT NULL,
 definition_digest CHAR(64) NOT NULL CHECK(definition_digest~'^[0-9a-f]{64}$'),
 implementation_identity TEXT NOT NULL,
 implementation_digest CHAR(64) NOT NULL CHECK(implementation_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(algorithm_key,algorithm_version),
 CHECK(rtrim(definition_digest)=public.canonical_completion_digest(definition))
);
CREATE TRIGGER canonical_forecast_paid_price_algorithms_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_paid_price_algorithms_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();
INSERT INTO public.canonical_forecast_paid_price_algorithms_v1(
 algorithm_key,algorithm_version,definition,definition_digest,
 implementation_identity,implementation_digest)
SELECT 'approved_price_carry_forward','m26-paid-approved-price-flow-v1',definition,
 public.canonical_completion_digest(definition),
 'public.canonical_forecast_paid_price_v1_calculate(jsonb)',
 encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_paid_price_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex')
FROM (SELECT jsonb_build_object(
 'key','approved_price_carry_forward','version','m26-paid-approved-price-flow-v1',
 'target',jsonb_build_object('key','revenue.approved_price_flow','definitionVersion','v1'),
 'sourceScope','northstar_m24_approved_price_decisions','kind','deterministic',
 'method','carry_forward_pre_horizon_approved_price','horizonGrain','month','unit','money',
 'outputContractVersion','m26-paid-journey-output-v1','probabilityPolicy','unavailable',
 'rangePolicy','unavailable','trainingReceiptDigest',NULL) definition) seed;

CREATE OR REPLACE FUNCTION public.canonical_forecast_settings_v1_authority()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE registry public.canonical_forecast_deterministic_baseline_algorithms_v1%ROWTYPE;
 price_registry public.canonical_forecast_paid_price_algorithms_v1%ROWTYPE;
 expected JSONB;installed TEXT;targets JSONB:='[]'::jsonb;
BEGIN
 expected:=jsonb_build_object(
  'key','retell_three_complete_month_mean','version','m26-retell-three-month-mean-v2',
  'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1'),
  'sourceScope','retell_only_tenant_all','kind','deterministic',
  'method','arithmetic_mean_comparable_prior_periods',
  'parameters',jsonb_build_object('minimumPeriods',3,'decimalScale',6,
   'rounding','half_up','observationOrder','local_month_start_ascending'),
  'horizonGrain','business_local_month','unit','count',
  'outputContractVersion','m26-forecast-output-v1','probabilityPolicy','unavailable',
  'rangePolicy','unavailable','trainingReceiptDigest',NULL);
 SELECT * INTO registry FROM public.canonical_forecast_deterministic_baseline_algorithms_v1
  WHERE algorithm_key='retell_three_complete_month_mean'
   AND algorithm_version='m26-retell-three-month-mean-v2';
 IF registry.algorithm_key IS NOT NULL THEN
  installed:=encode(sha256(convert_to(pg_get_functiondef(
   'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)'::regprocedure),'UTF8')),'hex');
  IF registry.definition IS NOT DISTINCT FROM expected AND
     rtrim(registry.definition_digest)=public.canonical_completion_digest(registry.definition) AND
     registry.implementation_identity='public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)' AND
     rtrim(registry.implementation_digest)=installed THEN
   targets:=targets||jsonb_build_array(jsonb_build_object(
    'key','demand.inbound_leads','label','Inbound leads','definitionVersion','v1',
    'unit','count','sourceScope','retell_only_tenant_all',
    'algorithmKey','retell_three_complete_month_mean',
    'algorithmVersion','m26-retell-three-month-mean-v2',
    'algorithmDefinitionDigest',rtrim(registry.definition_digest),
    'implementationDigest',rtrim(registry.implementation_digest),
    'supportedGrains',jsonb_build_array('month')));
  END IF;
 END IF;
 SELECT * INTO price_registry FROM public.canonical_forecast_paid_price_algorithms_v1
  WHERE algorithm_key='approved_price_carry_forward'
   AND algorithm_version='m26-paid-approved-price-flow-v1';
 installed:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_paid_price_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex');
 IF price_registry.algorithm_key IS NOT NULL AND
    rtrim(price_registry.definition_digest)=public.canonical_completion_digest(price_registry.definition) AND
    price_registry.implementation_identity='public.canonical_forecast_paid_price_v1_calculate(jsonb)' AND
    rtrim(price_registry.implementation_digest)=installed THEN
  targets:=targets||jsonb_build_array(jsonb_build_object(
   'key','revenue.approved_price_flow','label','Approved price flow',
   'definitionVersion','v1','unit','money',
   'sourceScope','northstar_m24_approved_price_decisions',
   'algorithmKey','approved_price_carry_forward',
   'algorithmVersion','m26-paid-approved-price-flow-v1',
   'algorithmDefinitionDigest',rtrim(price_registry.definition_digest),
   'implementationDigest',rtrim(price_registry.implementation_digest),
   'supportedGrains',jsonb_build_array('month')));
 END IF;
 RETURN jsonb_build_object('version','m26-forecast-settings-authority-v1',
  'targets',targets,'limits',jsonb_build_object('targets',24,'horizons',12,'periodsPerHorizon',100),
  'preferenceProves',jsonb_build_object('sourceAuthority',FALSE,
   'targetRegistration',FALSE,'algorithmPromotion',FALSE,'intervalCalibration',FALSE,
   'actualFinality',FALSE,'issuanceEligibility',FALSE),'automaticActionAuthorized',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_settings_v1_settings_valid(value JSONB,org UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE enabled BOOLEAN;authority JSONB;horizon JSONB;selected TEXT;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(value,
    ARRAY['enabled','targets','horizons','scenarioDisplay','comparisonDisplay','alertDelivery','actionPolicy']) IS NOT TRUE OR
    jsonb_typeof(value->'enabled')<>'boolean' OR jsonb_typeof(value->'targets')<>'array' OR
    jsonb_typeof(value->'horizons')<>'array' OR jsonb_array_length(value->'targets')>24 OR
    jsonb_array_length(value->'horizons')>12 OR
    value->>'scenarioDisplay' NOT IN('withhold','deterministic_when_eligible','calibrated_when_eligible') OR
    value->>'comparisonDisplay' NOT IN('none','prior','actual','prior_and_actual') OR
    value->>'alertDelivery' NOT IN('off','in_app_review_only') OR value->>'actionPolicy'<>'review_required' THEN RETURN FALSE;END IF;
 enabled:=(value->>'enabled')::boolean;
 IF NOT enabled THEN RETURN jsonb_array_length(value->'targets')=0 AND
  jsonb_array_length(value->'horizons')=0 AND value->>'scenarioDisplay'='withhold' AND
  value->>'comparisonDisplay'='none' AND value->>'alertDelivery'='off';END IF;
 IF jsonb_array_length(value->'targets')<>1 OR jsonb_array_length(value->'horizons')<>1 THEN RETURN FALSE;END IF;
 selected:=value->'targets'->>0;authority:=public.canonical_forecast_settings_v1_authority();
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(authority->'targets') target WHERE target->>'key'=selected) THEN RETURN FALSE;END IF;
 IF selected='demand.inbound_leads' AND public.canonical_forecast_settings_v1_source_current(org) IS NOT TRUE THEN RETURN FALSE;END IF;
 IF selected NOT IN('demand.inbound_leads','revenue.approved_price_flow') THEN RETURN FALSE;END IF;
 horizon:=value->'horizons'->0;
 RETURN public.canonical_field_evidence_object_keys_exact(horizon,ARRAY['grain','periods']) IS TRUE AND
  horizon->>'grain'='month' AND jsonb_typeof(horizon->'periods')='number' AND
  horizon->>'periods'~'^[1-9][0-9]{0,2}$' AND (horizon->>'periods')::integer BETWEEN 1 AND 100;
END $$;

CREATE TABLE public.canonical_forecast_paid_journey_runs_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),created_at TIMESTAMPTZ NOT NULL,cutoff_at TIMESTAMPTZ NOT NULL,
 settings_revision INTEGER NOT NULL CHECK(settings_revision>0),settings_digest CHAR(64) NOT NULL CHECK(settings_digest~'^[0-9a-f]{64}$'),
 source_position_id UUID NOT NULL,source_position_digest CHAR(64) NOT NULL CHECK(source_position_digest~'^[0-9a-f]{64}$'),
 source_snapshot_digest CHAR(64) NOT NULL CHECK(source_snapshot_digest~'^[0-9a-f]{64}$'),
 reporting_window_digest CHAR(64) NOT NULL CHECK(reporting_window_digest~'^[0-9a-f]{64}$'),
 feature_set_digest CHAR(64) NOT NULL CHECK(feature_set_digest~'^[0-9a-f]{64}$'),origin_id UUID NOT NULL,
 horizon_starts_at TIMESTAMPTZ NOT NULL,horizon_ends_at TIMESTAMPTZ NOT NULL,
 algorithm_definition_digest CHAR(64) NOT NULL CHECK(algorithm_definition_digest~'^[0-9a-f]{64}$'),
 algorithm_implementation_digest CHAR(64) NOT NULL CHECK(algorithm_implementation_digest~'^[0-9a-f]{64}$'),
 output JSONB NOT NULL,output_digest CHAR(64) NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 explanation JSONB NOT NULL,explanation_digest CHAR(64) NOT NULL CHECK(explanation_digest~'^[0-9a-f]{64}$'),
 receipt JSONB NOT NULL,receipt_digest CHAR(64) NOT NULL CHECK(receipt_digest~'^[0-9a-f]{64}$'),
 currentness_digest CHAR(64) NOT NULL CHECK(currentness_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,actor_user_id,request_key_digest),
 FOREIGN KEY(organization_id,source_position_id) REFERENCES public.canonical_forecast_integrated_commercial_positions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(cutoff_at<horizon_starts_at AND horizon_ends_at=horizon_starts_at+INTERVAL '1 day'),
 CHECK(rtrim(output_digest)=public.canonical_completion_digest(output)),
 CHECK(rtrim(explanation_digest)=public.canonical_completion_digest(explanation)),
 CHECK(rtrim(receipt_digest)=public.canonical_completion_digest(receipt))
);
CREATE INDEX canonical_forecast_paid_journey_runs_v1_recent ON public.canonical_forecast_paid_journey_runs_v1(organization_id,created_at DESC,id DESC);
CREATE TRIGGER canonical_forecast_paid_journey_runs_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_paid_journey_runs_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE TABLE public.canonical_forecast_paid_journey_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),run_id UUID NOT NULL,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),
 action TEXT NOT NULL CHECK(action IN('requested','dismissed')),recorded_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),auth_session_id UUID NOT NULL,
 run_digest CHAR(64) NOT NULL CHECK(run_digest~'^[0-9a-f]{64}$'),
 currentness_revision INTEGER NOT NULL CHECK(currentness_revision>0),
 currentness_digest CHAR(64) NOT NULL CHECK(currentness_digest~'^[0-9a-f]{64}$'),event JSONB NOT NULL,
 predecessor_digest CHAR(64),request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),event_digest CHAR(64) NOT NULL CHECK(event_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,actor_user_id,request_key_digest),UNIQUE(organization_id,run_id,sequence),
 FOREIGN KEY(organization_id,run_id) REFERENCES public.canonical_forecast_paid_journey_runs_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((sequence=1 AND predecessor_digest IS NULL) OR (sequence>1 AND predecessor_digest~'^[0-9a-f]{64}$')),
 CHECK(expires_at>recorded_at),CHECK(rtrim(event_digest)=public.canonical_completion_digest(event))
);
CREATE TRIGGER canonical_forecast_paid_journey_reviews_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_paid_journey_reviews_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_paid_journey_v1_projection(
 org UUID,saved public.canonical_forecast_paid_journey_runs_v1)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB;currentness JSONB;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('revision',review.sequence,
  'action',CASE WHEN review.action='requested' AND review.expires_at<=statement_timestamp() THEN 'expired' ELSE review.action END,
  'recordedAction',review.action,
  'recordedAt',public.canonical_forecast_utc_instant(review.recorded_at),
  'expiresAt',public.canonical_forecast_utc_instant(review.expires_at),
  'organizationId',review.organization_id,'runId',review.run_id,
  'actorUserId',review.actor_user_id,'actorAccessRole',review.actor_access_role,
  'predecessorDigest',CASE WHEN review.predecessor_digest IS NULL THEN NULL ELSE rtrim(review.predecessor_digest) END,
  'runDigest',rtrim(review.run_digest),'currentnessRevision',review.currentness_revision,
  'currentnessDigest',rtrim(review.currentness_digest),
  'target',review.event->'target','horizon',review.event->'horizon',
  'outputDigest',review.event->>'outputDigest','recommendationType',review.event->>'recommendationType',
  'receiving',review.event->'receiving','evidence',review.event->'evidence',
  'uncertainty',review.event->'uncertainty','missingInformation',review.event->'missingInformation',
  'tradeoff',review.event->>'tradeoff','digest',rtrim(review.event_digest))
  ORDER BY review.sequence),'[]'::jsonb) INTO history
 FROM public.canonical_forecast_paid_journey_reviews_v1 review
 WHERE review.organization_id=org AND review.run_id=saved.id;
 currentness:=jsonb_build_object('state','unchanged_candidate','revision',1,
  'digest',rtrim(saved.currentness_digest),'adviceDisplayAuthorized',FALSE);
 RETURN jsonb_build_object('id',saved.id,
  'createdAt',public.canonical_forecast_utc_instant(saved.created_at),
  'cutoffAt',public.canonical_forecast_utc_instant(saved.cutoff_at),
  'settings',jsonb_build_object('revision',saved.settings_revision,'digest',rtrim(saved.settings_digest)),
  'source',jsonb_build_object('positionId',saved.source_position_id,
   'positionDigest',rtrim(saved.source_position_digest),
   'sourceSnapshotDigest',rtrim(saved.source_snapshot_digest),
   'reportingWindowDigest',rtrim(saved.reporting_window_digest),
   'featureSetDigest',rtrim(saved.feature_set_digest),
   'scope','northstar_supported_commercial_sources_at_capture',
   'naturalHistoryValidated',FALSE,'wholeBusinessCoverageValidated',FALSE),
  'target',jsonb_build_object('key','revenue.approved_price_flow','definitionVersion','v1',
   'semantic','future_human_approved_commercial_price_decisions'),
  'horizon',jsonb_build_object('grain','month',
   'startsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
   'endsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at)),
  'algorithm',jsonb_build_object('key','approved_price_carry_forward',
   'version','m26-paid-approved-price-flow-v1',
   'definitionDigest',rtrim(saved.algorithm_definition_digest),
   'implementationDigest',rtrim(saved.algorithm_implementation_digest),
   'configurationDigest',rtrim(saved.feature_set_digest)),
  'output',saved.output||jsonb_build_object('digest',rtrim(saved.output_digest)),
  'explanation',saved.explanation||jsonb_build_object('digest',rtrim(saved.explanation_digest)),
  'receipt',saved.receipt||jsonb_build_object('digest',rtrim(saved.receipt_digest)),
  'currentness',currentness,
  'review',jsonb_build_object('receiverAvailability','unavailable',
   'receiverReason','no_exact_receiving_adapter','receiverHref',NULL,
   'history',history,'advisoryOnly',TRUE,'receiverMutationCount',0),
  'automaticActionAuthorized',FALSE,'outboundCommunicationAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_paid_journey_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_paid_journey_runs_v1%ROWTYPE;
 settings_row public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 latest_review public.canonical_forecast_paid_journey_reviews_v1%ROWTYPE;
 source_value JSONB;algorithm_row public.canonical_forecast_paid_price_algorithms_v1%ROWTYPE;installed TEXT;
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);PERFORM set_config('statement_timeout','8000ms',TRUE);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF pg_try_advisory_xact_lock(hashtextextended('m26:forecast-settings:'||org::text,0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended('m26:paid-journey-run:'||org::text,0)) IS NOT TRUE THEN
  RAISE EXCEPTION 'Paid forecast journey is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO settings_row FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT * INTO saved FROM public.canonical_forecast_paid_journey_runs_v1
  WHERE organization_id=org ORDER BY created_at DESC,id DESC LIMIT 1;
 IF saved.id IS NULL THEN
  IF settings_row.id IS NOT NULL AND settings_row.normalized#>'{settings,targets}'='["revenue.approved_price_flow"]'::jsonb AND
     public.canonical_forecast_settings_v1_settings_valid(settings_row.normalized->'settings',org) THEN
   RETURN jsonb_build_object('version','m26-paid-journey-v1','state','ready','reason',NULL,
    'run',NULL,'review',NULL,'targetKey','revenue.approved_price_flow',
    'syntheticImplementationEvidenceOnly',TRUE,'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE);
  END IF;
  RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable',
   'reason','approved_price_settings_not_current','run',NULL,'review',NULL,
   'targetKey','revenue.approved_price_flow','syntheticImplementationEvidenceOnly',TRUE,
   'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 IF settings_row.id IS NULL OR settings_row.revision<>saved.settings_revision OR
    rtrim(settings_row.canonical_digest)<>rtrim(saved.settings_digest) OR
    settings_row.normalized#>'{settings,targets}'<>'["revenue.approved_price_flow"]'::jsonb OR
    public.canonical_forecast_settings_v1_settings_valid(settings_row.normalized->'settings',org) IS NOT TRUE THEN
  RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable',
   'reason','settings_not_current','run',NULL,'review',NULL,'targetKey','revenue.approved_price_flow',
   'syntheticImplementationEvidenceOnly',TRUE,'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 source_value:=public.canonical_forecast_integrated_commercial_position_read(org,actor,role_value,session_value,saved.source_position_id);
 IF source_value->>'state'<>'northstar_integrated_commercial_baseline' OR
    source_value->'sourceCurrent' IS DISTINCT FROM 'true'::jsonb OR
    source_value->>'positionId'<>saved.source_position_id::text OR
    source_value->'sourceCapture'->>'sourceDigest'<>rtrim(saved.source_snapshot_digest) THEN
  RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable',
   'reason',COALESCE(source_value->>'reason','source_not_current'),'run',NULL,'review',NULL,
   'targetKey','revenue.approved_price_flow','syntheticImplementationEvidenceOnly',TRUE,
   'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 SELECT * INTO algorithm_row FROM public.canonical_forecast_paid_price_algorithms_v1
  WHERE algorithm_key='approved_price_carry_forward' AND algorithm_version='m26-paid-approved-price-flow-v1';
 installed:=encode(sha256(convert_to(pg_get_functiondef(
  'public.canonical_forecast_paid_price_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex');
 IF algorithm_row.algorithm_key IS NULL OR rtrim(algorithm_row.definition_digest)<>rtrim(saved.algorithm_definition_digest) OR
    rtrim(algorithm_row.implementation_digest)<>rtrim(saved.algorithm_implementation_digest) OR installed<>rtrim(saved.algorithm_implementation_digest) THEN
  RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable',
   'reason','algorithm_not_current','run',NULL,'review',NULL,'targetKey','revenue.approved_price_flow',
   'syntheticImplementationEvidenceOnly',TRUE,'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 SELECT * INTO latest_review FROM public.canonical_forecast_paid_journey_reviews_v1
  WHERE organization_id=org AND run_id=saved.id ORDER BY sequence DESC LIMIT 1;
 RETURN jsonb_build_object('version','m26-paid-journey-v1','state','current','reason',NULL,
  'run',public.canonical_forecast_paid_journey_v1_projection(org,saved),
   'review',jsonb_build_object('availability','unavailable','reason','no_exact_receiving_adapter',
    'requestReviewAvailable',latest_review.id IS NULL OR latest_review.action='dismissed' OR latest_review.expires_at<=statement_timestamp()),
  'targetKey','revenue.approved_price_flow','syntheticImplementationEvidenceOnly',TRUE,
  'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_paid_journey_v1_issue(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 request_hash TEXT,expected_revision INTEGER,expected_digest TEXT,origin_value UUID,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;settings_row public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 replay public.canonical_forecast_paid_journey_runs_v1%ROWTYPE;
 position_value JSONB;position_row public.canonical_forecast_integrated_commercial_positions%ROWTYPE;
 origin_row public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 algorithm_row public.canonical_forecast_paid_price_algorithms_v1%ROWTYPE;
 output_value JSONB;explanation_value JSONB;receipt_value JSONB;inserted public.canonical_forecast_paid_journey_runs_v1%ROWTYPE;
 key_hash TEXT;installed TEXT;created_value TIMESTAMPTZ:=date_trunc('milliseconds',clock_timestamp());latest_run UUID;
 source_digest TEXT;window_digest TEXT;feature_digest TEXT;output_hash TEXT;explanation_hash TEXT;currentness_hash TEXT;
 unavailable_reason TEXT;
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);PERFORM set_config('statement_timeout','8000ms',TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR request_hash!~'^[0-9a-f]{64}$' OR
    expected_revision IS NULL OR expected_revision<1 OR expected_digest!~'^[0-9a-f]{64}$' OR
    origin_value IS NULL OR reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 THEN
  RAISE EXCEPTION 'Paid forecast journey request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF pg_try_advisory_xact_lock(hashtextextended('m26:paid-journey-request:'||org::text||':'||actor::text||':'||key_hash,0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended('m26:forecast-settings:'||org::text,0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended('m26:paid-journey-run:'||org::text,0)) IS NOT TRUE THEN
  RAISE EXCEPTION 'Paid forecast journey is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO replay FROM public.canonical_forecast_paid_journey_runs_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_digest=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Paid forecast journey request conflict' USING ERRCODE='23505';END IF;
  SELECT id INTO latest_run FROM public.canonical_forecast_paid_journey_runs_v1
   WHERE organization_id=org ORDER BY created_at DESC,id DESC LIMIT 1;
  IF latest_run IS DISTINCT FROM replay.id THEN
   RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable',
    'reason','historical_replay_superseded','run',NULL,'review',NULL,
    'targetKey','revenue.approved_price_flow','syntheticImplementationEvidenceOnly',TRUE,
    'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE,'replayed',TRUE);
  END IF;
  RETURN public.canonical_forecast_paid_journey_v1_current(org,actor,role_value,session_value)||jsonb_build_object('replayed',TRUE);
 END IF;
 SELECT * INTO settings_row FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR SHARE NOWAIT;
 IF settings_row.id IS NULL OR settings_row.revision<>expected_revision OR rtrim(settings_row.canonical_digest)<>expected_digest OR
    settings_row.normalized#>'{settings,targets}'<>'["revenue.approved_price_flow"]'::jsonb OR
    public.canonical_forecast_settings_v1_settings_valid(settings_row.normalized->'settings',org) IS NOT TRUE THEN
  RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable','reason','approved_price_settings_not_current',
   'run',NULL,'review',NULL,'targetKey','revenue.approved_price_flow','syntheticImplementationEvidenceOnly',TRUE,
   'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE,'replayed',FALSE);
 END IF;
 SELECT * INTO origin_row FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=origin_value FOR SHARE NOWAIT;
 SELECT * INTO algorithm_row FROM public.canonical_forecast_paid_price_algorithms_v1
  WHERE algorithm_key='approved_price_carry_forward' AND algorithm_version='m26-paid-approved-price-flow-v1';
 installed:=encode(sha256(convert_to(pg_get_functiondef('public.canonical_forecast_paid_price_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex');
 IF origin_row.id IS NULL OR origin_row.horizon_start<=clock_timestamp() OR
    algorithm_row.algorithm_key IS NULL OR rtrim(algorithm_row.implementation_digest)<>installed THEN
  RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable','reason','exact_issue_inputs_not_current',
   'run',NULL,'review',NULL,'targetKey','revenue.approved_price_flow','syntheticImplementationEvidenceOnly',TRUE,
   'liveValidationAvailable',FALSE,'automaticActionAuthorized',FALSE,'replayed',FALSE);
 END IF;
 BEGIN
 position_value:=public.canonical_forecast_capture_integrated_commercial_position(
  org,actor,role_value,session_value,csrf,origin_value,left(key_value,121)||':source',btrim(reason_value),TRUE,'integrated-commercial-baseline-v1');
 IF position_value->>'state'<>'northstar_integrated_commercial_baseline' OR position_value->'sourceCurrent' IS DISTINCT FROM 'true'::jsonb THEN
  unavailable_reason:=COALESCE(position_value->>'reason','source_not_current');
  RAISE EXCEPTION 'Paid forecast journey source unavailable' USING ERRCODE='P1258';
 END IF;
 SELECT * INTO position_row FROM public.canonical_forecast_integrated_commercial_positions
  WHERE organization_id=org AND id=(position_value->>'positionId')::uuid FOR SHARE NOWAIT;
 IF position_row.id IS NULL OR position_value->>'asOf' IS NULL OR
    (position_value->>'asOf')::timestamptz>=origin_row.horizon_start THEN
  unavailable_reason:='exact_issue_inputs_not_current';
  RAISE EXCEPTION 'Paid forecast journey inputs unavailable' USING ERRCODE='P1258';
 END IF;
 output_value:=public.canonical_forecast_paid_price_v1_calculate(origin_row.output);
 source_digest:=position_value->'sourceCapture'->>'sourceDigest';
 window_digest:=public.canonical_completion_digest(jsonb_build_object('cutoffAt',position_value->>'asOf',
  'horizonStartsAt',public.canonical_forecast_utc_instant(origin_row.horizon_start),
  'horizonEndsAt',public.canonical_forecast_utc_instant(origin_row.horizon_end)));
 feature_digest:=public.canonical_completion_digest(jsonb_build_object('positionDigest',rtrim(position_row.position_digest),
  'originReceiptDigest',rtrim(origin_row.receipt_digest),'profileProofDigest',position_value#>>'{futureApprovedPriceBaseline,profileProofDigest}'));
 output_hash:=public.canonical_completion_digest(output_value);
 explanation_value:=jsonb_build_object('predictionKind','deterministic_point',
  'summary','A future human-approved commercial price decision carried forward from the exact pre-horizon approved-price origin.',
  'sourceCoverage','Current NorthStar-supported commercial records at capture time.',
  'doesNotMeasure',jsonb_build_array('earned_revenue','cash','invoices','payments','collections'),
  'uncertainty','A calibrated interval is unavailable.',
  'missingEvidence',jsonb_build_array('natural_observation_history','empirical_calibration','whole_business_coverage','live_provider_validation'),
  'customerSafe',TRUE,'advisoryOnly',TRUE);
 explanation_hash:=public.canonical_completion_digest(explanation_value);
 receipt_value:=jsonb_build_object('version','m26-paid-journey-receipt-v1','organizationId',org,'cutoffAt',position_value->>'asOf',
  'settings',jsonb_build_object('revision',settings_row.revision,'digest',rtrim(settings_row.canonical_digest)),
  'source',jsonb_build_object('positionId',position_row.id,'positionDigest',rtrim(position_row.position_digest),
   'sourceSnapshotDigest',source_digest,'reportingWindowDigest',window_digest,'featureSetDigest',feature_digest,
   'originId',origin_row.id,'originReceiptDigest',rtrim(origin_row.receipt_digest)),
  'target',jsonb_build_object('key','revenue.approved_price_flow','definitionVersion','v1'),
  'algorithm',jsonb_build_object('key','approved_price_carry_forward','version','m26-paid-approved-price-flow-v1',
   'definitionDigest',rtrim(algorithm_row.definition_digest),'implementationDigest',installed,'configurationDigest',feature_digest),
  'outputContractVersion','m26-paid-journey-output-v1','manifest',jsonb_build_array(jsonb_build_object(
   'targetKey','revenue.approved_price_flow','targetVersion','v1','outputDigest',output_hash)));
 currentness_hash:=public.canonical_completion_digest(jsonb_build_object('receiptDigest',public.canonical_completion_digest(receipt_value),
  'sourcePositionDigest',rtrim(position_row.position_digest),'settingsDigest',rtrim(settings_row.canonical_digest),
  'algorithmImplementationDigest',installed));
 INSERT INTO public.canonical_forecast_paid_journey_runs_v1(
  organization_id,created_at,cutoff_at,settings_revision,settings_digest,source_position_id,source_position_digest,
  source_snapshot_digest,reporting_window_digest,feature_set_digest,origin_id,horizon_starts_at,horizon_ends_at,
  algorithm_definition_digest,algorithm_implementation_digest,output,output_digest,explanation,explanation_digest,
  receipt,receipt_digest,currentness_digest,actor_user_id,actor_access_role,membership_id,auth_session_id,request_key_digest,request_digest)
 VALUES(org,created_value,(position_value->>'asOf')::timestamptz,settings_row.revision,settings_row.canonical_digest,
  position_row.id,position_row.position_digest,source_digest,window_digest,feature_digest,origin_row.id,
  origin_row.horizon_start,origin_row.horizon_end,algorithm_row.definition_digest,algorithm_row.implementation_digest,
  output_value,output_hash,explanation_value,explanation_hash,receipt_value,public.canonical_completion_digest(receipt_value),
  currentness_hash,actor,role_value,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash) RETURNING * INTO inserted;
 INSERT INTO public.audit_logs(organization_id,user_id,action,entity_type,entity_id,details)
 VALUES(org,actor,'paid_forecast_journey_issued','forecast_paid_journey',inserted.id::text,
  jsonb_build_object('receiptDigest',rtrim(inserted.receipt_digest),'targetKey','revenue.approved_price_flow',
   'syntheticImplementationEvidenceOnly',TRUE,'automaticActionAuthorized',FALSE));
 RETURN public.canonical_forecast_paid_journey_v1_current(org,actor,role_value,session_value)||jsonb_build_object('replayed',FALSE);
 EXCEPTION WHEN SQLSTATE 'P1258' THEN
  RETURN jsonb_build_object('version','m26-paid-journey-v1','state','unavailable',
   'reason',unavailable_reason,'run',NULL,'review',NULL,'targetKey','revenue.approved_price_flow',
   'syntheticImplementationEvidenceOnly',TRUE,'liveValidationAvailable',FALSE,
   'automaticActionAuthorized',FALSE,'replayed',FALSE);
 END;
END $$;

CREATE FUNCTION public.canonical_forecast_paid_journey_v1_rerun(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value JSONB;saved public.canonical_forecast_paid_journey_runs_v1%ROWTYPE;
 origin_row public.canonical_forecast_price_flow_saved_origins%ROWTYPE;fresh JSONB;fresh_digest TEXT;
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);PERFORM set_config('statement_timeout','8000ms',TRUE);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 current_value:=public.canonical_forecast_paid_journey_v1_current(org,actor,role_value,session_value);
 IF current_value->>'state'<>'current' OR current_value#>>'{run,id}'<>run_value::text THEN
  RETURN jsonb_build_object('state','unavailable','reason',COALESCE(current_value->>'reason','run_not_current'),
   'runId',NULL,'comparison',NULL,'automaticActionAuthorized',FALSE);END IF;
 SELECT * INTO saved FROM public.canonical_forecast_paid_journey_runs_v1
  WHERE organization_id=org AND id=run_value FOR SHARE NOWAIT;
 SELECT * INTO origin_row FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=saved.origin_id FOR SHARE NOWAIT;
 IF origin_row.id IS NULL OR rtrim(origin_row.receipt_digest)<>saved.receipt#>>'{source,originReceiptDigest}' THEN
  RETURN jsonb_build_object('state','unavailable','reason','retained_inputs_unavailable',
   'runId',NULL,'comparison',NULL,'automaticActionAuthorized',FALSE);END IF;
 fresh:=public.canonical_forecast_paid_price_v1_calculate(origin_row.output);
 fresh_digest:=public.canonical_completion_digest(fresh);
 RETURN jsonb_build_object('state',CASE WHEN fresh_digest=rtrim(saved.output_digest) THEN 'reproduced' ELSE 'result_mismatch' END,
  'runId',saved.id,'runDigest',rtrim(saved.receipt_digest),'storedOutputDigest',rtrim(saved.output_digest),
  'freshOutputDigest',fresh_digest,'sameResults',fresh_digest=rtrim(saved.output_digest),'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_paid_journey_v1_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,request_hash TEXT,
 run_value UUID,run_digest_value TEXT,currentness_digest_value TEXT,action_value TEXT,
 expected_revision INTEGER,expected_digest TEXT,expires_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value JSONB;replay public.canonical_forecast_paid_journey_reviews_v1%ROWTYPE;
 prior public.canonical_forecast_paid_journey_reviews_v1%ROWTYPE;inserted public.canonical_forecast_paid_journey_reviews_v1%ROWTYPE;
 key_hash TEXT;event_value JSONB;
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);PERFORM set_config('statement_timeout','8000ms',TRUE);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR request_hash!~'^[0-9a-f]{64}$' OR
    action_value NOT IN('requested','dismissed') OR run_value IS NULL OR run_digest_value!~'^[0-9a-f]{64}$' OR
    currentness_digest_value!~'^[0-9a-f]{64}$' OR expires_value IS NULL OR
    expires_value>clock_timestamp()+INTERVAL '30 days' OR
    (action_value='requested' AND expires_value<=clock_timestamp()+INTERVAL '1 hour') OR
    (action_value='dismissed' AND expires_value<=clock_timestamp()) THEN
  RAISE EXCEPTION 'Paid forecast review invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF pg_try_advisory_xact_lock(hashtextextended('m26:paid-journey-review:'||org::text||':'||run_value::text,0)) IS NOT TRUE THEN
  RAISE EXCEPTION 'Paid forecast review is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO replay FROM public.canonical_forecast_paid_journey_reviews_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_digest=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Paid forecast review conflict' USING ERRCODE='23505';END IF;
  current_value:=public.canonical_forecast_paid_journey_v1_current(org,actor,role_value,session_value);
  SELECT * INTO prior FROM public.canonical_forecast_paid_journey_reviews_v1
   WHERE organization_id=org AND run_id=replay.run_id ORDER BY sequence DESC LIMIT 1 FOR SHARE NOWAIT;
  IF current_value->>'state'<>'current' OR current_value#>>'{run,id}'<>replay.run_id::text OR
     prior.id IS DISTINCT FROM replay.id OR replay.expires_at<=statement_timestamp() THEN
   RETURN jsonb_build_object('state','unavailable','reason','review_replay_superseded','journey',NULL);
  END IF;
  RETURN jsonb_build_object('state','replay','journey',current_value);
 END IF;
 current_value:=public.canonical_forecast_paid_journey_v1_current(org,actor,role_value,session_value);
 IF current_value->>'state'<>'current' OR current_value#>>'{run,id}'<>run_value::text OR
    current_value#>>'{run,receipt,digest}'<>run_digest_value OR
    current_value#>>'{run,currentness,digest}'<>currentness_digest_value THEN
  RETURN jsonb_build_object('state','unavailable','reason',COALESCE(current_value->>'reason','run_not_current'),'journey',NULL);END IF;
 SELECT * INTO prior FROM public.canonical_forecast_paid_journey_reviews_v1
  WHERE organization_id=org AND run_id=run_value ORDER BY sequence DESC LIMIT 1 FOR SHARE NOWAIT;
 IF (action_value='requested' AND prior.id IS NOT NULL AND prior.action='requested' AND prior.expires_at>clock_timestamp()) OR
    (action_value='dismissed' AND (prior.id IS NULL OR prior.action<>'requested' OR
     expected_revision<>prior.sequence OR expected_digest<>rtrim(prior.event_digest) OR
     expires_value IS DISTINCT FROM prior.expires_at)) THEN
  RAISE EXCEPTION 'Paid forecast review changed' USING ERRCODE='40001';END IF;
 event_value:=jsonb_build_object('organizationId',org,'runId',run_value,
  'sequence',COALESCE(prior.sequence,0)+1,'action',action_value,
  'predecessorDigest',CASE WHEN prior.id IS NULL THEN NULL ELSE rtrim(prior.event_digest) END,
  'actorUserId',actor,'actorAccessRole',role_value,
  'recordedAt',public.canonical_forecast_utc_instant(date_trunc('milliseconds',clock_timestamp())),
  'expiresAt',public.canonical_forecast_utc_instant(expires_value),
  'runDigest',run_digest_value,'currentnessRevision',
   (current_value#>>'{run,currentness,revision}')::integer,
  'currentnessDigest',currentness_digest_value,
  'target',current_value#>'{run,target}','horizon',current_value#>'{run,horizon}',
  'outputDigest',current_value#>>'{run,output,digest}',
  'recommendationType','review_approved_price_flow',
  'receiving',jsonb_build_object('mission',NULL,'workflow',NULL,'recordId',NULL,
   'expectedRevision',NULL,'availability','unavailable','reason','no_exact_receiving_adapter'),
  'evidence',jsonb_build_object('receiptDigest',run_digest_value,
   'explanationDigest',current_value#>>'{run,explanation,digest}',
   'sourcePositionDigest',current_value#>>'{run,source,positionDigest}'),
  'uncertainty',current_value#>'{run,output,uncertainty}',
  'missingInformation',current_value#>'{run,explanation,missingEvidence}',
  'tradeoff','Review can inform a later independently authorized workflow; no receiver or operational state changes here.',
  'receiverAvailability','unavailable','receiverReason','no_exact_receiving_adapter',
  'receiverMutationCount',0,'automaticActionAuthorized',FALSE);
 INSERT INTO public.canonical_forecast_paid_journey_reviews_v1(
  organization_id,run_id,sequence,action,recorded_at,expires_at,actor_user_id,actor_access_role,
  auth_session_id,run_digest,currentness_revision,currentness_digest,event,
  predecessor_digest,request_key_digest,request_digest,event_digest)
 VALUES(org,run_value,COALESCE(prior.sequence,0)+1,action_value,(event_value->>'recordedAt')::timestamptz,expires_value,
  actor,role_value,session_value,run_digest_value,
  (current_value#>>'{run,currentness,revision}')::integer,currentness_digest_value,event_value,
  prior.event_digest,key_hash,request_hash,public.canonical_completion_digest(event_value))
 RETURNING * INTO inserted;
 INSERT INTO public.audit_logs(organization_id,user_id,action,entity_type,entity_id,details)
 VALUES(org,actor,CASE WHEN action_value='requested' THEN 'paid_forecast_review_requested' ELSE 'paid_forecast_review_dismissed' END,
  'forecast_paid_journey',run_value::text,jsonb_build_object('eventDigest',rtrim(inserted.event_digest),
   'receiverMutationCount',0,'automaticActionAuthorized',FALSE));
 RETURN jsonb_build_object('state',action_value,'journey',public.canonical_forecast_paid_journey_v1_current(org,actor,role_value,session_value));
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_paid_price_algorithms_v1,
 public.canonical_forecast_paid_journey_runs_v1,public.canonical_forecast_paid_journey_reviews_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_paid_price_v1_calculate(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_paid_journey_v1_projection(UUID,public.canonical_forecast_paid_journey_runs_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_paid_journey_v1_current(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_paid_journey_v1_issue(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_paid_journey_v1_rerun(UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_paid_journey_v1_review(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,TIMESTAMPTZ) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_paid_price_algorithms_v1,public.canonical_forecast_paid_journey_runs_v1,public.canonical_forecast_paid_journey_reviews_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_paid_price_v1_calculate(jsonb) FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_paid_journey_v1_projection(uuid,public.canonical_forecast_paid_journey_runs_v1) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_paid_journey_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_paid_journey_v1_issue(uuid,uuid,text,uuid,text,text,text,integer,text,uuid,text) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_paid_journey_v1_rerun(uuid,uuid,text,uuid,text,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_paid_journey_v1_review(uuid,uuid,text,uuid,text,text,text,uuid,text,text,text,integer,text,timestamptz) TO %I',runtime_role);
 END IF;
END $$;
