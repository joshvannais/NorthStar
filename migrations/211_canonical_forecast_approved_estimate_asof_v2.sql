-- Mission 26 Part 2A: purpose-fixed, target-complete NorthStar M24 approved-
-- estimate as-of receipts. The migration fence freezes an exact baseline;
-- later genuine M24 decisions are ordered by the already deployed source-order
-- trigger. This proves only the NorthStar decision ledger, never off-platform
-- or whole-business coverage, and it never reconstructs an arbitrary cutoff.

LOCK TABLE public.canonical_estimate_decisions IN SHARE MODE;

CREATE TABLE public.canonical_forecast_approved_estimate_v2_epochs (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 coverage_starts_at TIMESTAMPTZ NOT NULL,
 coverage_start_order BIGINT NOT NULL CHECK(coverage_start_order>=0),
 baseline_source_count INTEGER NOT NULL CHECK(baseline_source_count BETWEEN 0 AND 1001),
 baseline_manifest_digest CHAR(64),
 coverage_state TEXT NOT NULL CHECK(coverage_state IN ('complete','unavailable')),
 unavailable_reason TEXT,
 CHECK((coverage_state='complete' AND baseline_source_count<=1000 AND
        baseline_manifest_digest IS NOT NULL AND unavailable_reason IS NULL) OR
       (coverage_state='unavailable' AND unavailable_reason IN
        ('baseline_pin_limit','baseline_size_limit') AND baseline_manifest_digest IS NULL))
);

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_pins(org UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'sourceKind','estimate_decision','estimateId',decision.estimate_id,
   'sourceId',decision.id,'revision',decision.revision,'digest',decision.digest,
   'recordedAt',public.canonical_forecast_utc_instant(decision.created_at),
   'state','active'
 ) ORDER BY decision.estimate_id),'[]'::jsonb)
 FROM (
   SELECT * FROM (
     SELECT DISTINCT ON (estimate_id) estimate_id,id,revision,digest,created_at,action
     FROM public.canonical_estimate_decisions
     WHERE organization_id=org
     ORDER BY estimate_id,revision DESC,id DESC
   ) current_decision
   WHERE action='approve'
   ORDER BY estimate_id
   LIMIT 1001
 ) decision
$$;

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_gap(
 org UUID,epoch_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.canonical_estimate_decisions decision
   LEFT JOIN public.canonical_forecast_price_decision_orders source_order
    ON source_order.organization_id=decision.organization_id
     AND source_order.estimate_id=decision.estimate_id
     AND source_order.decision_id=decision.id
   WHERE decision.organization_id=org AND decision.created_at>=epoch_at
     AND source_order.decision_id IS NULL
 )
$$;

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Approved-estimate coverage epochs are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_approved_estimate_v2_epoch_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_approved_estimate_v2_epochs
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_immutable();

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_for_new_org()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pins JSONB:='[]'::jsonb;captured TIMESTAMPTZ:=clock_timestamp();
BEGIN
 INSERT INTO public.canonical_forecast_approved_estimate_v2_epochs(
  organization_id,coverage_starts_at,coverage_start_order,baseline_source_count,
  baseline_manifest_digest,coverage_state,unavailable_reason)
 VALUES(NEW.id,captured,0,0,public.canonical_completion_digest(pins),'complete',NULL);
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_approved_estimate_v2_epoch_for_new_org
 AFTER INSERT ON public.organizations FOR EACH ROW
 EXECUTE FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_for_new_org();

DO $$
DECLARE tenant RECORD;pins JSONB;pin_count INTEGER;start_order BIGINT;captured TIMESTAMPTZ;
BEGIN
 FOR tenant IN SELECT id FROM public.organizations ORDER BY id LOOP
  pins:=public.canonical_forecast_approved_estimate_v2_pins(tenant.id);
  pin_count:=jsonb_array_length(pins);
  SELECT COALESCE(MAX(source_order),0) INTO start_order
   FROM public.canonical_forecast_price_decision_orders
   WHERE organization_id=tenant.id;
  captured:=clock_timestamp();
  INSERT INTO public.canonical_forecast_approved_estimate_v2_epochs(
   organization_id,coverage_starts_at,coverage_start_order,baseline_source_count,
   baseline_manifest_digest,coverage_state,unavailable_reason)
  VALUES(tenant.id,captured,start_order,pin_count,
   CASE WHEN pin_count<=1000 AND octet_length(pins::text)<=262144
    THEN public.canonical_completion_digest(pins) ELSE NULL END,
   CASE WHEN pin_count<=1000 AND octet_length(pins::text)<=262144
    THEN 'complete' ELSE 'unavailable' END,
   CASE WHEN pin_count>1000 THEN 'baseline_pin_limit'
    WHEN octet_length(pins::text)>262144 THEN 'baseline_size_limit' ELSE NULL END);
 END LOOP;
END $$;

CREATE TABLE public.canonical_forecast_approved_estimate_v2_snapshots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 as_of TIMESTAMPTZ NOT NULL,
 coverage_starts_at TIMESTAMPTZ NOT NULL,
 coverage_start_order BIGINT NOT NULL CHECK(coverage_start_order>=0),
 high_water_order BIGINT NOT NULL CHECK(high_water_order>=coverage_start_order),
 purpose_key TEXT NOT NULL CHECK(purpose_key='forecast_pipeline'),
 target_key TEXT NOT NULL CHECK(target_key='pipeline.approved_estimates'),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='array' AND
   jsonb_array_length(source_manifest)<=1000 AND octet_length(source_manifest::text)<=262144),
 coverage_state TEXT NOT NULL CHECK(coverage_state='complete_northstar_m24'),
 digest_nonce UUID NOT NULL,
 snapshot_digest CHAR(64) NOT NULL CHECK(snapshot_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id) REFERENCES public.canonical_forecast_approved_estimate_v2_epochs(organization_id),
 CHECK(as_of=created_at),
 CHECK(rtrim(snapshot_digest)=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-approved-estimate-asof-v2','organizationId',organization_id,
  'asOf',public.canonical_forecast_utc_instant(as_of),
  'coverageStartsAt',public.canonical_forecast_utc_instant(coverage_starts_at),
  'coverageStartOrder',coverage_start_order,'highWaterOrder',high_water_order,
  'purposeKey',purpose_key,'targetKey',target_key,'coverageState',coverage_state,
  'digestNonce',digest_nonce,'sources',source_manifest)))
);
CREATE INDEX canonical_forecast_approved_estimate_v2_tenant_time_idx
 ON public.canonical_forecast_approved_estimate_v2_snapshots(organization_id,as_of DESC,id);

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Approved-estimate as-of v2 receipts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_approved_estimate_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_approved_estimate_v2_snapshots
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_approved_estimate_v2_immutable();

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch public.canonical_forecast_approved_estimate_v2_epochs%ROWTYPE;
 actual_role TEXT;expected_request TEXT;current_order BIGINT;current_pins JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   NEW.created_at<>NEW.as_of OR NEW.as_of>clock_timestamp() THEN
  RAISE EXCEPTION 'Approved-estimate receipt cutoff changed' USING ERRCODE='23514';END IF;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=NEW.organization_id;
 SELECT COALESCE(MAX(source_order),0) INTO current_order
  FROM public.canonical_forecast_price_decision_orders
  WHERE organization_id=NEW.organization_id;
 current_pins:=public.canonical_forecast_approved_estimate_v2_pins(NEW.organization_id);
 IF epoch.coverage_state IS DISTINCT FROM 'complete' OR
   NEW.coverage_starts_at IS DISTINCT FROM epoch.coverage_starts_at OR
   NEW.coverage_start_order IS DISTINCT FROM epoch.coverage_start_order OR
   NEW.high_water_order IS DISTINCT FROM current_order OR
   NEW.source_manifest IS DISTINCT FROM current_pins OR
   public.canonical_forecast_approved_estimate_v2_gap(
    NEW.organization_id,epoch.coverage_starts_at) THEN
  RAISE EXCEPTION 'Approved-estimate coverage is unavailable' USING ERRCODE='23514';END IF;
 SELECT role INTO actual_role FROM public.organization_memberships
  WHERE organization_id=NEW.organization_id AND id=NEW.membership_id
   AND user_id=NEW.actor_user_id AND status='active';
 IF actual_role NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Approved-estimate access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,NULL,FALSE);
 expected_request:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-approved-estimate-asof-request-v2',
  'organizationId',NEW.organization_id,'actorUserId',NEW.actor_user_id,
  'purposeKey','forecast_pipeline','targetKey','pipeline.approved_estimates'));
 IF rtrim(NEW.request_digest)<>expected_request THEN
  RAISE EXCEPTION 'Approved-estimate request changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_approved_estimate_v2_guard
 BEFORE INSERT ON public.canonical_forecast_approved_estimate_v2_snapshots
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_approved_estimate_v2_guard();

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_projection(
 value public.canonical_forecast_approved_estimate_v2_snapshots)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,'version','m26-approved-estimate-asof-v2',
  'organizationId',value.organization_id,
  'asOf',public.canonical_forecast_utc_instant(value.as_of),
  'capturedAt',public.canonical_forecast_utc_instant(value.created_at),
  'purposeKey',value.purpose_key,'targetKey',value.target_key,
  'sources',value.source_manifest,'sourceCount',jsonb_array_length(value.source_manifest),
  'sourceSnapshotDigest',rtrim(value.snapshot_digest),
  'coverage',jsonb_build_object('state','complete','scope','northstar_m24_decision_ledger',
   'startsAt',public.canonical_forecast_utc_instant(value.coverage_starts_at),
   'providerCoverageVerified',FALSE,'wholeBusinessCoverageVerified',FALSE),
  'historicalBoundary','Exact immutable NorthStar M24 state at capture; no arbitrary earlier cutoff or off-platform coverage.')
$$;

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_approved_estimate_v2_snapshots%ROWTYPE;
 inserted public.canonical_forecast_approved_estimate_v2_snapshots%ROWTYPE;
 epoch public.canonical_forecast_approved_estimate_v2_epochs%ROWTYPE;
 key_hash TEXT;request_hash TEXT;cutoff TIMESTAMPTZ;pins JSONB;
 last_order BIGINT;digest_value TEXT;nonce UUID;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Approved-estimate access restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Approved-estimate request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-approved-estimate-asof-request-v2','organizationId',org,
  'actorUserId',actor,'purposeKey','forecast_pipeline',
  'targetKey','pipeline.approved_estimates'));
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  org::text||':forecast-approved-estimate-v2:'||actor::text||':'||key_hash,0)) THEN
  RAISE EXCEPTION 'Approved-estimate request is busy' USING ERRCODE='55P03';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Approved-estimate source is busy' USING ERRCODE='55P03';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_forecast_approved_estimate_v2_snapshots
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Approved-estimate request key conflict' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('state','complete','snapshot',
   public.canonical_forecast_approved_estimate_v2_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=org;
 IF epoch.organization_id IS NULL THEN
  RETURN jsonb_build_object('state','unavailable','reason','coverage_epoch_missing',
   'snapshot',NULL,'replayed',FALSE);
 END IF;
 IF epoch.coverage_state<>'complete' THEN
  RETURN jsonb_build_object('state','unavailable','reason',epoch.unavailable_reason,
   'snapshot',NULL,'replayed',FALSE);
 END IF;
 IF public.canonical_forecast_approved_estimate_v2_gap(org,epoch.coverage_starts_at) THEN
  RETURN jsonb_build_object('state','unavailable','reason','legacy_order_gap',
   'snapshot',NULL,'replayed',FALSE);
 END IF;
 SELECT COALESCE(MAX(source_order),0) INTO last_order
  FROM public.canonical_forecast_price_decision_orders WHERE organization_id=org;
 IF last_order>9007199254740991 THEN
  RAISE EXCEPTION 'Approved-estimate source order exceeds safe size' USING ERRCODE='54000';END IF;
 pins:=public.canonical_forecast_approved_estimate_v2_pins(org);
 IF jsonb_array_length(pins)>1000 OR octet_length(pins::text)>262144 THEN
  RAISE EXCEPTION 'Approved-estimate cohort exceeds bounded source size' USING ERRCODE='54000';END IF;
 cutoff:=clock_timestamp();nonce:=gen_random_uuid();
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-approved-estimate-asof-v2','organizationId',org,
  'asOf',public.canonical_forecast_utc_instant(cutoff),
  'coverageStartsAt',public.canonical_forecast_utc_instant(epoch.coverage_starts_at),
  'coverageStartOrder',epoch.coverage_start_order,'highWaterOrder',last_order,
  'purposeKey','forecast_pipeline','targetKey','pipeline.approved_estimates',
  'coverageState','complete_northstar_m24','digestNonce',nonce,'sources',pins));
 INSERT INTO public.canonical_forecast_approved_estimate_v2_snapshots(
  organization_id,as_of,coverage_starts_at,coverage_start_order,high_water_order,
  purpose_key,target_key,source_manifest,coverage_state,digest_nonce,snapshot_digest,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,created_at)
 VALUES(org,cutoff,epoch.coverage_starts_at,epoch.coverage_start_order,last_order,
  'forecast_pipeline','pipeline.approved_estimates',pins,'complete_northstar_m24',
  nonce,digest_value,actor,(authority->>'membershipId')::uuid,session_value,
  key_hash,request_hash,cutoff) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','complete','snapshot',
  public.canonical_forecast_approved_estimate_v2_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_approved_estimate_v2_snapshots%ROWTYPE;
 epoch public.canonical_forecast_approved_estimate_v2_epochs%ROWTYPE;last_order BIGINT;
 source_current BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Approved-estimate access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
  JOIN public.organization_onboarding onboarding
   ON onboarding.organization_id=subscription.organization_id
  WHERE subscription.organization_id=org AND onboarding.status='complete'
   AND (subscription.status='active' OR
    (subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
     AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days'
     AND subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Approved-estimate source is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_approved_estimate_v2_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=org;
 SELECT COALESCE(MAX(source_order),0) INTO last_order
  FROM public.canonical_forecast_price_decision_orders WHERE organization_id=org;
 source_current:=epoch.coverage_state='complete' AND
  epoch.coverage_starts_at=selected.coverage_starts_at AND
  epoch.coverage_start_order=selected.coverage_start_order AND
  NOT public.canonical_forecast_approved_estimate_v2_gap(org,epoch.coverage_starts_at) AND
  last_order=selected.high_water_order;
 RETURN jsonb_build_object(
  'snapshot',public.canonical_forecast_approved_estimate_v2_projection(selected),
  'state',CASE WHEN source_current THEN 'current' ELSE 'stale' END,
  'sourceCurrent',source_current,'eligibleForForecast',FALSE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_approved_estimate_v2_epochs FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_approved_estimate_v2_snapshots FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_pins(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_gap(UUID,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_for_new_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_projection(public.canonical_forecast_approved_estimate_v2_snapshots) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_approved_estimate_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_approved_estimate_v2_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
