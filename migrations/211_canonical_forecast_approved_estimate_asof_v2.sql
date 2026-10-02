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

-- Runtime capture never walks the unbounded decision ledger. Migration 211
-- builds one current row per estimate while the writer table is fenced; the
-- post-install writer trigger then replaces only that estimate's row.
CREATE TABLE public.canonical_forecast_approved_estimate_v2_current_sources (
 organization_id UUID NOT NULL,
 estimate_id UUID NOT NULL,
 decision_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision>0),
 action TEXT NOT NULL CHECK(action IN ('approve','withdraw')),
 digest CHAR(64) NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL,
 source_order BIGINT NOT NULL CHECK(source_order>=0),
 PRIMARY KEY(organization_id,estimate_id),
 UNIQUE(organization_id,decision_id),
 FOREIGN KEY(organization_id,estimate_id,decision_id)
  REFERENCES public.canonical_estimate_decisions(organization_id,estimate_id,id)
  ON DELETE RESTRICT
);
CREATE UNIQUE INDEX canonical_forecast_approved_estimate_v2_order_idx
 ON public.canonical_forecast_approved_estimate_v2_current_sources(
  organization_id,source_order) WHERE source_order>0;
CREATE INDEX canonical_forecast_approved_estimate_v2_active_idx
 ON public.canonical_forecast_approved_estimate_v2_current_sources(
  organization_id,estimate_id)
 WHERE action='approve';

CREATE TABLE public.canonical_forecast_approved_estimate_v2_states (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 coverage_starts_at TIMESTAMPTZ NOT NULL,
 high_water_order BIGINT NOT NULL CHECK(high_water_order>=0),
 ordering_complete BOOLEAN NOT NULL
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
   SELECT estimate_id,decision_id id,revision,digest,recorded_at created_at,action
   FROM public.canonical_forecast_approved_estimate_v2_current_sources
   WHERE organization_id=org AND action='approve'
   ORDER BY estimate_id
   LIMIT 1001
 ) decision
$$;

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_gap(
 org UUID,epoch_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT COALESCE((SELECT state.ordering_complete AND
   state.coverage_starts_at=epoch_at AND state.high_water_order=COALESCE((
    SELECT source_order.source_order
    FROM public.canonical_forecast_price_decision_orders source_order
    WHERE source_order.organization_id=org
    ORDER BY source_order.source_order DESC LIMIT 1),0)
  FROM public.canonical_forecast_approved_estimate_v2_states state
  WHERE state.organization_id=org),FALSE)
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
 INSERT INTO public.canonical_forecast_approved_estimate_v2_states(
  organization_id,coverage_starts_at,high_water_order,ordering_complete)
 VALUES(NEW.id,captured,0,TRUE);
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_approved_estimate_v2_epoch_for_new_org
 AFTER INSERT ON public.organizations FOR EACH ROW
 EXECUTE FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_for_new_org();

DO $$
DECLARE tenant RECORD;pins JSONB;pin_count INTEGER;start_order BIGINT;captured TIMESTAMPTZ;
BEGIN
 INSERT INTO public.canonical_forecast_approved_estimate_v2_current_sources(
  organization_id,estimate_id,decision_id,revision,action,digest,recorded_at,source_order)
 SELECT current_decision.organization_id,current_decision.estimate_id,
  current_decision.id,current_decision.revision,current_decision.action,
  current_decision.digest,current_decision.created_at,COALESCE(source_order.source_order,0)
 FROM (
  SELECT DISTINCT ON (organization_id,estimate_id) organization_id,estimate_id,
   id,revision,action,digest,created_at
  FROM public.canonical_estimate_decisions
  ORDER BY organization_id,estimate_id,revision DESC,id DESC
 ) current_decision
 LEFT JOIN public.canonical_forecast_price_decision_orders source_order
  ON source_order.organization_id=current_decision.organization_id
   AND source_order.estimate_id=current_decision.estimate_id
   AND source_order.decision_id=current_decision.id;
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
  INSERT INTO public.canonical_forecast_approved_estimate_v2_states(
   organization_id,coverage_starts_at,high_water_order,ordering_complete)
  VALUES(tenant.id,captured,start_order,TRUE);
 END LOOP;
END $$;

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_current_track()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ordered BIGINT;
BEGIN
 SELECT source_order INTO ordered
 FROM public.canonical_forecast_price_decision_orders
 WHERE organization_id=NEW.organization_id AND decision_id=NEW.id;
 IF ordered IS NULL THEN
  UPDATE public.canonical_forecast_approved_estimate_v2_states
   SET ordering_complete=FALSE WHERE organization_id=NEW.organization_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Approved-estimate coverage state is missing' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 INSERT INTO public.canonical_forecast_approved_estimate_v2_current_sources(
  organization_id,estimate_id,decision_id,revision,action,digest,recorded_at,source_order)
 VALUES(NEW.organization_id,NEW.estimate_id,NEW.id,NEW.revision,NEW.action,
  NEW.digest,NEW.created_at,ordered)
 ON CONFLICT(organization_id,estimate_id) DO UPDATE SET
  decision_id=EXCLUDED.decision_id,revision=EXCLUDED.revision,
  action=EXCLUDED.action,digest=EXCLUDED.digest,
  recorded_at=EXCLUDED.recorded_at,source_order=EXCLUDED.source_order;
 UPDATE public.canonical_forecast_approved_estimate_v2_states
  SET high_water_order=GREATEST(high_water_order,ordered)
  WHERE organization_id=NEW.organization_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Approved-estimate coverage state is missing' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
-- The name sorts after the migration-146 order trigger, so the order sidecar
-- exists before this tracker reads it for the same inserted decision.
CREATE TRIGGER canonical_forecast_z_approved_estimate_v2_current_track
 AFTER INSERT ON public.canonical_estimate_decisions
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_approved_estimate_v2_current_track();

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

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_access(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 mutation_required BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority RECORD;evaluated TIMESTAMPTZ:=clock_timestamp();
BEGIN
 SELECT membership.id membership_id,membership.role membership_role,
  membership.status membership_status,account.status account_status,
  session.status session_status,session.access_expires_at,session.csrf_token_hash,
  subscription.status subscription_status,subscription.trial_started_at,
  subscription.trial_ends_at,onboarding.status onboarding_status
 INTO authority
 FROM public.organization_memberships membership
 JOIN public.users account ON account.organization_id=membership.organization_id
  AND account.id=membership.user_id
 JOIN public.auth_sessions session ON session.organization_id=membership.organization_id
  AND session.membership_id=membership.id AND session.user_id=membership.user_id
  AND session.id=session_value
 JOIN public.subscriptions subscription
  ON subscription.organization_id=membership.organization_id
 JOIN public.organization_onboarding onboarding
  ON onboarding.organization_id=membership.organization_id
 WHERE membership.organization_id=org AND membership.user_id=actor
 FOR SHARE OF membership,account,session,subscription,onboarding;
 IF NOT FOUND OR authority.membership_role IS DISTINCT FROM role_value OR
  authority.membership_role NOT IN ('owner','admin') OR
  authority.membership_status<>'active' OR authority.account_status<>'active' OR
  authority.session_status<>'active' OR authority.access_expires_at<=evaluated OR
  authority.onboarding_status<>'complete' OR NOT(
   authority.subscription_status='active' OR
   (authority.subscription_status='trialing' AND
    authority.trial_started_at IS NOT NULL AND
    authority.trial_ends_at=authority.trial_started_at+INTERVAL '14 days' AND
    authority.trial_ends_at>evaluated)) OR
  (mutation_required AND (csrf IS NULL OR octet_length(csrf) NOT BETWEEN 32 AND 512 OR
   encode(sha256(convert_to(csrf,'UTF8')),'hex')<>rtrim(authority.csrf_token_hash))) THEN
  RAISE EXCEPTION 'Current approved-estimate authority is unavailable'
   USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('membershipId',authority.membership_id,
  'evaluatedAt',public.canonical_forecast_utc_instant(evaluated));
END $$;

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
 SELECT high_water_order INTO current_order
  FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=NEW.organization_id AND ordering_complete;
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
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
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
 authority:=public.canonical_forecast_approved_estimate_v2_access(
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
  authority:=public.canonical_forecast_approved_estimate_v2_access(
   org,actor,role_value,session_value,csrf,TRUE);
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
 SELECT high_water_order INTO last_order
  FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=org AND ordering_complete;
 IF last_order IS NULL THEN
  RETURN jsonb_build_object('state','unavailable','reason','legacy_order_gap',
   'snapshot',NULL,'replayed',FALSE);
 END IF;
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
 authority:=public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,csrf,TRUE);
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
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Approved-estimate source is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_approved_estimate_v2_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=org;
 SELECT high_water_order INTO last_order
  FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=org;
 source_current:=epoch.coverage_state='complete' AND
  epoch.coverage_starts_at=selected.coverage_starts_at AND
  epoch.coverage_start_order=selected.coverage_start_order AND
  NOT public.canonical_forecast_approved_estimate_v2_gap(org,epoch.coverage_starts_at) AND
  last_order=selected.high_water_order;
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'snapshot',public.canonical_forecast_approved_estimate_v2_projection(selected),
  'state',CASE WHEN source_current THEN 'current' ELSE 'stale' END,
  'sourceCurrent',source_current,'eligibleForForecast',FALSE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_approved_estimate_v2_epochs FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_approved_estimate_v2_current_sources FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_approved_estimate_v2_states FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_approved_estimate_v2_snapshots FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_pins(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_gap(UUID,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_epoch_for_new_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_current_track() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_access(UUID,UUID,TEXT,UUID,TEXT,BOOLEAN) FROM PUBLIC;
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
