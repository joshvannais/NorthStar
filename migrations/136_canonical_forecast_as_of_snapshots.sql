-- Mission 26 Part 2A. The first source-specific as-of capture reads only the
-- immutable Mission 24 decision ledger. Other sources require separate guards.

CREATE FUNCTION public.canonical_forecast_utc_instant(value TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

CREATE FUNCTION public.canonical_forecast_estimate_decision_pins(org UUID,cutoff TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'sourceKind','estimate_decision','sourceId',decision.id,
   'revision',decision.revision,'digest',decision.digest,
   'recordedAt',public.canonical_forecast_utc_instant(decision.created_at),
   'eventAt',NULL,'state',CASE decision.action WHEN 'approve' THEN 'active' ELSE 'tombstone' END
 ) ORDER BY decision.id),'[]'::jsonb)
 FROM (
   SELECT DISTINCT ON (estimate_id) id,revision,digest,created_at,action
   FROM public.canonical_estimate_decisions
   WHERE organization_id=org AND created_at<=cutoff
   ORDER BY estimate_id,revision DESC,id DESC
   LIMIT 1001
 ) decision
$$;

CREATE TABLE public.canonical_forecast_source_snapshots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 as_of TIMESTAMPTZ NOT NULL,
 purpose_key TEXT NOT NULL CHECK(purpose_key='forecast_pipeline'),
 target_key TEXT NOT NULL CHECK(target_key='pipeline.approved_estimates'),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='array' AND
   jsonb_array_length(source_manifest)<=1000 AND octet_length(source_manifest::text)<=262144),
 snapshot_digest CHAR(64) NOT NULL CHECK(snapshot_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(as_of=created_at),
 CHECK(rtrim(snapshot_digest)=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-as-of-source-manifest-v1','organizationId',organization_id,
   'asOf',public.canonical_forecast_utc_instant(as_of),
   'purposeKey',purpose_key,'targetKey',target_key,'sources',source_manifest)))
);
CREATE INDEX canonical_forecast_source_snapshots_tenant_time_idx
 ON public.canonical_forecast_source_snapshots(organization_id,as_of DESC,id);

CREATE FUNCTION public.canonical_forecast_source_snapshot_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast source snapshots are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_source_snapshots_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_source_snapshots
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_source_snapshot_immutable();

CREATE FUNCTION public.canonical_forecast_source_snapshot_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual_role TEXT;expected_request TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR
   NEW.created_at<>NEW.as_of OR NEW.as_of>clock_timestamp() OR
   NEW.source_manifest IS DISTINCT FROM public.canonical_forecast_estimate_decision_pins(NEW.organization_id,NEW.as_of)
 THEN RAISE EXCEPTION 'Forecast snapshot source or cutoff changed' USING ERRCODE='23514';END IF;
 SELECT role INTO actual_role FROM public.organization_memberships
  WHERE organization_id=NEW.organization_id AND id=NEW.membership_id
    AND user_id=NEW.actor_user_id AND status='active';
 IF actual_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Forecast source access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
   NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,NULL,FALSE);
 expected_request:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-as-of-snapshot-request-v1','organizationId',NEW.organization_id,
   'actorUserId',NEW.actor_user_id,'purposeKey',NEW.purpose_key,'targetKey',NEW.target_key));
 IF rtrim(NEW.request_digest)<>expected_request THEN
  RAISE EXCEPTION 'Forecast snapshot request changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_source_snapshots_guard
 BEFORE INSERT ON public.canonical_forecast_source_snapshots
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_source_snapshot_guard();

CREATE FUNCTION public.canonical_forecast_source_snapshot_projection(
 value public.canonical_forecast_source_snapshots)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'version','m26-as-of-source-manifest-v1',
  'organizationId',value.organization_id,
  'asOf',public.canonical_forecast_utc_instant(value.as_of),
  'capturedAt',public.canonical_forecast_utc_instant(value.created_at),
  'purposeKey',value.purpose_key,'targetKey',value.target_key,
  'sources',value.source_manifest,'sourceCount',jsonb_array_length(value.source_manifest),
  'sourceSnapshotDigest',rtrim(value.snapshot_digest),
  'historicalBoundary','This is an immutable source receipt, not a forecast or current source approval.')
$$;

CREATE FUNCTION public.canonical_forecast_estimate_decision_snapshot_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_source_snapshots%ROWTYPE;
 inserted public.canonical_forecast_source_snapshots%ROWTYPE;
 key_hash TEXT;request_hash TEXT;cutoff TIMESTAMPTZ; pins JSONB;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 IF role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast source access restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Forecast snapshot request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-as-of-snapshot-request-v1','organizationId',org,
   'actorUserId',actor,'purposeKey','forecast_pipeline',
   'targetKey','pipeline.approved_estimates'));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':forecast-snapshot:'||actor::text||':'||key_hash,0));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_forecast_source_snapshots
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Forecast snapshot request key conflict' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('snapshot',public.canonical_forecast_source_snapshot_projection(old),'replayed',TRUE);
 END IF;
 -- The subscription/authority reads have already acquired this transaction's
 -- MVCC snapshot. Minting the cutoff afterward prevents a concurrent commit
 -- from appearing in a receipt dated before that commit became visible.
 cutoff:=clock_timestamp();
 pins:=public.canonical_forecast_estimate_decision_pins(org,cutoff);
 IF jsonb_array_length(pins)>1000 OR octet_length(pins::text)>262144 THEN
  RAISE EXCEPTION 'Forecast source cohort exceeds bounded snapshot size' USING ERRCODE='54000';END IF;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-as-of-source-manifest-v1','organizationId',org,
   'asOf',public.canonical_forecast_utc_instant(cutoff),
   'purposeKey','forecast_pipeline','targetKey','pipeline.approved_estimates','sources',pins));
 INSERT INTO public.canonical_forecast_source_snapshots(
  organization_id,as_of,purpose_key,target_key,source_manifest,snapshot_digest,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,created_at)
VALUES(org,cutoff,'forecast_pipeline','pipeline.approved_estimates',pins,digest_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,cutoff)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('snapshot',public.canonical_forecast_source_snapshot_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_source_snapshot_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_source_snapshots%ROWTYPE;
BEGIN
 IF role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast source access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
  JOIN public.organization_onboarding onboarding
    ON onboarding.organization_id=subscription.organization_id
  WHERE subscription.organization_id=org AND onboarding.status='complete'
    AND (subscription.status='active' OR
      (subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
        AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days'
        AND subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_source_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 RETURN public.canonical_forecast_source_snapshot_projection(selected);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_source_snapshots FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_utc_instant(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_estimate_decision_pins(UUID,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_source_snapshot_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_source_snapshot_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_source_snapshot_projection(public.canonical_forecast_source_snapshots) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_estimate_decision_snapshot_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_source_snapshot_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_estimate_decision_snapshot_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_source_snapshot_read(UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
