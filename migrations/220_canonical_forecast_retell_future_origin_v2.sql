-- Mission 26 Part 4A: purpose-fixed Retell-only completed-period evidence
-- and a genuinely future-facing saved research origin. Human certification
-- is explicit and bounded; it does not prove off-platform or whole-business
-- coverage, calibration, service/area attribution, or paid forecast serving.

-- A lifetime Retell snapshot is intentionally bounded at 1,000 calls.  Part4A
-- therefore adds a month-scoped snapshot shape instead of trying to filter a
-- lifetime receipt after that lifetime bound has already been exceeded.  Old
-- snapshots retain NULL window columns and their exact v1 behavior.
ALTER TABLE public.canonical_forecast_retell_call_snapshots
 ADD COLUMN source_window_starts_at TIMESTAMPTZ,
 ADD COLUMN source_window_ends_at TIMESTAMPTZ,
 ADD COLUMN source_window_local_month DATE,
 ADD CONSTRAINT canonical_forecast_retell_call_snapshots_window_exact CHECK(
  (source_window_starts_at IS NULL AND source_window_ends_at IS NULL AND
   source_window_local_month IS NULL) OR
  (source_window_starts_at IS NOT NULL AND source_window_ends_at IS NOT NULL AND
   source_window_ends_at>source_window_starts_at AND
   source_window_ends_at-source_window_starts_at<=INTERVAL '35 days' AND
   source_window_local_month IS NOT NULL AND
   extract(day FROM source_window_local_month)=1));

CREATE FUNCTION public.canonical_forecast_retell_call_window_pins(
 org UUID,cutoff TIMESTAMPTZ,window_start TIMESTAMPTZ,window_end TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'sourceKind','retell_call','sourceId',source.transcript_id,
  'revision',1,'digest',source.source_digest,
  'recordedAt',public.canonical_forecast_utc_instant(source.completed_at),
  'eventAt',public.canonical_forecast_utc_instant(source.occurred_at),
  'state','active') ORDER BY source.transcript_id),'[]'::jsonb)
 FROM (
  SELECT transcript.id transcript_id,operation.completed_at,transcript.occurred_at,
   public.canonical_completion_digest(jsonb_build_object(
    'version','m26-retell-call-source-v1','organizationId',org,
    'transcriptId',transcript.id,'opportunityId',opportunity.id,
    'callIdentityDigest',encode(sha256(convert_to(transcript.external_call_id,'UTF8')),'hex'),
    'sourceVersion',transcript.source_version,
    'recordedAt',public.canonical_forecast_utc_instant(operation.completed_at),
    'eventAt',public.canonical_forecast_utc_instant(transcript.occurred_at))) source_digest
  FROM public.canonical_operations operation
  JOIN public.canonical_transcripts transcript ON transcript.organization_id=operation.organization_id
   AND transcript.operation_id=operation.id AND transcript.graph_id=operation.graph_id
  JOIN public.canonical_communications communication ON communication.organization_id=operation.organization_id
   AND communication.operation_id=operation.id AND communication.graph_id=operation.graph_id
   AND communication.transcript_id=transcript.id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=operation.organization_id
   AND opportunity.operation_id=operation.id AND opportunity.graph_id=operation.graph_id
  JOIN public.canonical_voice_sessions voice_session ON voice_session.organization_id=operation.organization_id
   AND voice_session.canonical_operation_id=operation.id
   AND voice_session.provider='retell' AND voice_session.provider_session_id=transcript.external_call_id
   AND voice_session.status='completed' AND voice_session.direction='inbound'
   AND voice_session.metadata->>'retellPayloadDirection'='inbound'
  WHERE operation.organization_id=org AND operation.state='completed'
   AND operation.completed_at<=cutoff AND transcript.source='retell'
   AND transcript.external_call_id IS NOT NULL
   AND communication.channel='voice_call'
   AND transcript.occurred_at>=window_start AND transcript.occurred_at<window_end
  ORDER BY transcript.id LIMIT 1001
 ) source
$$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_snapshot_consent_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_forecast_retell_source_consents%ROWTYPE;
BEGIN
 IF (NEW.source_window_starts_at IS NULL AND current_setting('transaction_isolation')<>'serializable') OR
    (NEW.source_window_starts_at IS NOT NULL AND current_setting('transaction_isolation')<>'read committed') THEN
  RAISE EXCEPTION 'Retell snapshot isolation invalid' USING ERRCODE='25001';END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_retell_source_consents
  WHERE organization_id=NEW.organization_id AND purpose_key='forecast_demand_source'
  ORDER BY revision DESC LIMIT 1;
 IF current_row.id IS NULL OR current_row.action<>'grant' OR current_row.created_at>NEW.as_of THEN
  RAISE EXCEPTION 'Forecast call source permission unavailable' USING ERRCODE='42501';END IF;
 NEW.source_consent_id:=current_row.id;
 NEW.source_consent_digest:=current_row.canonical_digest;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_snapshot_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual_role TEXT;expected_request TEXT;expected_sources JSONB;
BEGIN
 IF NEW.created_at<>NEW.as_of OR NEW.as_of>clock_timestamp() THEN
  RAISE EXCEPTION 'Retell source or cutoff changed' USING ERRCODE='23514';END IF;
 IF NEW.source_window_starts_at IS NULL THEN
  IF current_setting('transaction_isolation')<>'serializable' THEN
   RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
  expected_sources:=public.canonical_forecast_retell_call_pins(NEW.organization_id,NEW.as_of);
  expected_request:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-as-of-snapshot-request-v1','organizationId',NEW.organization_id,
   'actorUserId',NEW.actor_user_id,'purposeKey',NEW.purpose_key,'targetKey',NEW.target_key));
 ELSE
  IF current_setting('transaction_isolation')<>'read committed' OR
     NEW.source_window_ends_at>NEW.as_of THEN
   RAISE EXCEPTION 'Retell period source request invalid' USING ERRCODE='25001';END IF;
  expected_sources:=public.canonical_forecast_retell_call_window_pins(
   NEW.organization_id,NEW.as_of,NEW.source_window_starts_at,NEW.source_window_ends_at);
  expected_request:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-retell-period-snapshot-request-v2','organizationId',NEW.organization_id,
   'actorUserId',NEW.actor_user_id,'purposeKey',NEW.purpose_key,'targetKey',NEW.target_key,
   'localMonthStart',NEW.source_window_local_month,
   'startsAt',public.canonical_forecast_utc_instant(NEW.source_window_starts_at),
   'endsAt',public.canonical_forecast_utc_instant(NEW.source_window_ends_at)));
 END IF;
 IF NEW.source_manifest IS DISTINCT FROM expected_sources THEN
  RAISE EXCEPTION 'Retell source or cutoff changed' USING ERRCODE='23514';END IF;
 SELECT role INTO actual_role FROM public.organization_memberships
  WHERE organization_id=NEW.organization_id AND id=NEW.membership_id
   AND user_id=NEW.actor_user_id AND status='active';
 IF actual_role IS NULL OR actual_role NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast source access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,NULL,FALSE);
 IF rtrim(NEW.request_digest)<>expected_request THEN
  RAISE EXCEPTION 'Retell source request changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_snapshot_projection(
 value public.canonical_forecast_retell_call_snapshots)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN public.canonical_forecast_retell_source_permission_current(
  value.organization_id,value.source_consent_id,rtrim(value.source_consent_digest))
 THEN jsonb_build_object('id',value.id,'version','m26-as-of-source-manifest-v1',
  'organizationId',value.organization_id,
  'asOf',public.canonical_forecast_utc_instant(value.as_of),
  'capturedAt',public.canonical_forecast_utc_instant(value.created_at),
  'purposeKey',value.purpose_key,'targetKey',value.target_key,
  'sources',value.source_manifest,'sourceCount',jsonb_array_length(value.source_manifest),
  'sourceSnapshotDigest',rtrim(value.snapshot_digest),
  'sourceConsentId',value.source_consent_id,'sourceConsentDigest',rtrim(value.source_consent_digest),
  'identityBoundary','Retell call receipts are not distinct reviewed lead identities or complete provider coverage.')||
  CASE WHEN value.source_window_starts_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
   'windowVersion','m26-retell-period-source-window-v2',
   'localMonthStart',value.source_window_local_month,
   'sourceWindowStartsAt',public.canonical_forecast_utc_instant(value.source_window_starts_at),
   'sourceWindowEndsAt',public.canonical_forecast_utc_instant(value.source_window_ends_at)) END
 ELSE jsonb_build_object('id',value.id,'stale',TRUE,'refreshRequired',TRUE,
  'sources','[]'::jsonb,'reason','Company permission to use this call source is no longer current.') END
$$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_snapshot_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_retell_call_snapshots%ROWTYPE;current_sources JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast source access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
 JOIN public.organization_onboarding onboarding ON onboarding.organization_id=subscription.organization_id
 WHERE subscription.organization_id=org AND onboarding.status='complete'
  AND (subscription.status='active' OR (subscription.status='trialing' AND
   subscription.trial_started_at IS NOT NULL AND
   subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days' AND
   subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 IF NOT public.canonical_forecast_retell_source_permission_current(
  org,selected.source_consent_id,rtrim(selected.source_consent_digest)) THEN
  RETURN jsonb_build_object('id',selected.id,'stale',TRUE,'refreshRequired',TRUE,
   'sources','[]'::jsonb,'reason','Company permission to use this call source is no longer current.');
 END IF;
 current_sources:=CASE WHEN selected.source_window_starts_at IS NULL THEN
  public.canonical_forecast_retell_call_pins(org,selected.as_of) ELSE
  public.canonical_forecast_retell_call_window_pins(org,selected.as_of,
   selected.source_window_starts_at,selected.source_window_ends_at) END;
 IF selected.source_manifest IS DISTINCT FROM current_sources THEN
  RETURN jsonb_build_object('id',selected.id,'stale',TRUE,'refreshRequired',TRUE,
   'sourceSnapshotDigest',rtrim(selected.snapshot_digest),'sources','[]'::jsonb,
   'reason','The recorded call source changed. Capture a new receipt before using it.');
 END IF;
 RETURN public.canonical_forecast_retell_call_snapshot_projection(selected)||
  jsonb_build_object('stale',FALSE,'refreshRequired',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_review_source(
 org UUID,snapshot_value UUID,transcript_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_retell_call_snapshots%ROWTYPE;source_value JSONB;
 current_sources JSONB;
BEGIN
 SELECT * INTO saved FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF saved.id IS NULL OR NOT public.canonical_forecast_retell_source_permission_current(
  org,saved.source_consent_id,rtrim(saved.source_consent_digest)) THEN RETURN NULL;END IF;
 current_sources:=CASE WHEN saved.source_window_starts_at IS NULL THEN
  public.canonical_forecast_retell_call_pins(org,saved.as_of) ELSE
  public.canonical_forecast_retell_call_window_pins(org,saved.as_of,
   saved.source_window_starts_at,saved.source_window_ends_at) END;
 IF saved.source_manifest IS DISTINCT FROM current_sources THEN RETURN NULL;END IF;
 SELECT item INTO source_value FROM jsonb_array_elements(saved.source_manifest)item
  WHERE item->>'sourceKind'='retell_call' AND item->>'sourceId'=transcript_value::text
   AND item->>'state'='active';
 RETURN source_value;
END $$;

CREATE FUNCTION public.canonical_forecast_retell_period_snapshot_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 month_value DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_retell_call_snapshots%ROWTYPE;
 inserted public.canonical_forecast_retell_call_snapshots%ROWTYPE;
 profile JSONB;zone TEXT;starts_at TIMESTAMPTZ;ends_at TIMESTAMPTZ;
 key_hash TEXT;request_hash TEXT;cutoff TIMESTAMPTZ;pins JSONB;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    month_value IS NULL OR extract(day FROM month_value)<>1 OR
    month_value<DATE '2000-01-01' OR month_value>=DATE '2100-12-01' THEN
  RAISE EXCEPTION 'Retell period snapshot request invalid' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 profile:=public.canonical_forecast_profile_month_guarded_source(
  org,actor,role_value,session_value,month_value);
 IF profile->>'state'<>'owner_claim_only' THEN
  RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
   'reason','profile_month_unavailable','replayed',FALSE);END IF;
 zone:=profile#>>'{rawProfile,company,timeZone}';
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
  RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
   'reason','profile_time_zone_unavailable','replayed',FALSE);END IF;
 starts_at:=month_value::timestamp AT TIME ZONE zone;
 ends_at:=(month_value+INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 IF ends_at>statement_timestamp() THEN
  RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
   'reason','period_not_complete','replayed',FALSE);END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:retell-period-snapshot-v2:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Retell period snapshot busy' USING ERRCODE='55P03';END IF;
 LOCK TABLE public.canonical_operations,public.canonical_transcripts,
  public.canonical_communications,public.canonical_opportunities,
  public.canonical_voice_sessions,public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents IN SHARE MODE;
 cutoff:=clock_timestamp();
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-period-snapshot-request-v2','organizationId',org,
  'actorUserId',actor,'purposeKey','forecast_demand_source','targetKey','retell.inbound_calls',
  'localMonthStart',month_value,'startsAt',public.canonical_forecast_utc_instant(starts_at),
  'endsAt',public.canonical_forecast_utc_instant(ends_at)));
 SELECT * INTO old FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Retell period snapshot request key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_retell_source_permission_current(
    org,old.source_consent_id,rtrim(old.source_consent_digest)) THEN
   RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
    'reason','source_permission_changed_refresh_required','replayed',TRUE);END IF;
  IF old.source_manifest IS DISTINCT FROM public.canonical_forecast_retell_call_window_pins(
    org,old.as_of,old.source_window_starts_at,old.source_window_ends_at) THEN
   RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
    'reason','source_changed_refresh_required','replayed',TRUE);END IF;
  RETURN jsonb_build_object('state','retell_period_snapshot_saved','snapshot',
   public.canonical_forecast_retell_call_snapshot_projection(old),'replayed',TRUE);
 END IF;
 pins:=public.canonical_forecast_retell_call_window_pins(org,cutoff,starts_at,ends_at);
 IF jsonb_array_length(pins)>1000 OR octet_length(pins::text)>262144 THEN
  RAISE EXCEPTION 'Retell period source exceeds bounded snapshot size' USING ERRCODE='54000';END IF;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-as-of-source-manifest-v1','organizationId',org,
  'asOf',public.canonical_forecast_utc_instant(cutoff),
  'purposeKey','forecast_demand_source','targetKey','retell.inbound_calls','sources',pins));
 INSERT INTO public.canonical_forecast_retell_call_snapshots(
  organization_id,as_of,purpose_key,target_key,source_manifest,snapshot_digest,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,created_at,
  source_window_starts_at,source_window_ends_at,source_window_local_month)
 VALUES(org,cutoff,'forecast_demand_source','retell.inbound_calls',pins,digest_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,cutoff,
  starts_at,ends_at,month_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','retell_period_snapshot_saved','snapshot',
  public.canonical_forecast_retell_call_snapshot_projection(inserted),'replayed',FALSE);
END $$;

CREATE TABLE public.canonical_forecast_retell_period_certifications_v2 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 local_month_start DATE NOT NULL CHECK(extract(day FROM local_month_start)=1),
 revision INTEGER NOT NULL CHECK(revision>0),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('certify','revoke')),
 snapshot_id UUID NOT NULL,
 evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object' AND
   octet_length(evidence::text)<=262144),
 evidence_digest CHAR(64) NOT NULL CHECK(evidence_digest~'^[0-9a-f]{64}$'),
 provider_scan_count INTEGER NOT NULL CHECK(provider_scan_count BETWEEN 0 AND 1000),
 provider_scan_digest CHAR(64) NOT NULL CHECK(provider_scan_digest~'^[0-9a-f]{64}$'),
 provider_scan_evidence JSONB NOT NULL CHECK(jsonb_typeof(provider_scan_evidence)='object' AND
   octet_length(provider_scan_evidence::text)<=131072),
 caller_consent_attested BOOLEAN NOT NULL,
 provider_coverage_attested BOOLEAN NOT NULL,
 retention_attested BOOLEAN NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND
   octet_length(reason)<=4000),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,local_month_start,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,snapshot_id)
  REFERENCES public.canonical_forecast_retell_call_snapshots(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_retell_period_certifications_v2(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((action='certify' AND caller_consent_attested AND
   provider_coverage_attested AND retention_attested) OR action='revoke')
);
CREATE INDEX canonical_forecast_retell_period_certifications_v2_current_idx
 ON public.canonical_forecast_retell_period_certifications_v2(
  organization_id,local_month_start,revision DESC);

CREATE TABLE public.canonical_forecast_retell_future_origins_v2 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 as_of TIMESTAMPTZ NOT NULL,
 local_horizon_start DATE NOT NULL CHECK(extract(day FROM local_horizon_start)=1),
 horizon_starts_at TIMESTAMPTZ NOT NULL,
 horizon_ends_at TIMESTAMPTZ NOT NULL CHECK(horizon_ends_at>horizon_starts_at),
 evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object' AND
   octet_length(evidence::text)<=262144),
 evidence_digest CHAR(64) NOT NULL CHECK(evidence_digest~'^[0-9a-f]{64}$'),
 private_output JSONB NOT NULL CHECK(jsonb_typeof(private_output)='object' AND
   octet_length(private_output::text)<=16384),
 output_digest CHAR(64) NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_retell_future_origins_v2_org_idx
 ON public.canonical_forecast_retell_future_origins_v2(organization_id,recorded_at DESC,id);

CREATE TRIGGER canonical_forecast_retell_period_certifications_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_retell_period_certifications_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();
CREATE TRIGGER canonical_forecast_retell_future_origins_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_retell_future_origins_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_retell_period_evidence_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 snapshot_value UUID,month_value DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot JSONB;reviews JSONB;profile JSONB;profile_raw JSONB;
 zone TEXT;starts_at TIMESTAMPTZ;ends_at TIMESTAMPTZ;
 sources JSONB;review_items JSONB;source_item JSONB;review_item JSONB;
 lead_count INTEGER;source_manifest_digest TEXT;review_manifest_digest TEXT;
 active_count INTEGER;integration_ownership_id UUID;agent_id TEXT;scan_inputs JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR snapshot_value IS NULL OR
    month_value IS NULL OR extract(day FROM month_value)<>1 OR
    month_value<DATE '2000-01-01' OR month_value>=DATE '2100-12-01' THEN
  RAISE EXCEPTION 'Retell period evidence request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Retell period evidence access restricted' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:retell-period-v2:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Retell period evidence busy' USING ERRCODE='55P03';
 END IF;
 profile:=public.canonical_forecast_profile_month_guarded_source(
  org,actor,role_value,session_value,month_value);
 IF profile->>'state'<>'owner_claim_only' THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','profile_month_unavailable');
 END IF;
 profile_raw:=profile->'rawProfile'; zone:=profile_raw#>>'{company,timeZone}';
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','profile_time_zone_unavailable');
 END IF;
 starts_at:=month_value::timestamp AT TIME ZONE zone;
 ends_at:=(month_value+INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 IF ends_at>statement_timestamp() THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','period_not_complete');
 END IF;
 snapshot:=public.canonical_forecast_retell_call_snapshot_read(
  org,actor,role_value,session_value,snapshot_value);
 reviews:=public.canonical_forecast_retell_call_reviews_read(
  org,actor,role_value,session_value,snapshot_value);
 IF snapshot IS NULL OR snapshot->>'stale' IS DISTINCT FROM 'false' OR
     reviews IS NULL OR reviews->>'stale' IS DISTINCT FROM 'false' THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','source_unavailable');
 END IF;
 IF snapshot->>'windowVersion' IS DISTINCT FROM 'm26-retell-period-source-window-v2' OR
    snapshot->>'localMonthStart' IS DISTINCT FROM month_value::text OR
    snapshot->>'sourceWindowStartsAt' IS DISTINCT FROM
      public.canonical_forecast_utc_instant(starts_at) OR
    snapshot->>'sourceWindowEndsAt' IS DISTINCT FROM
      public.canonical_forecast_utc_instant(ends_at) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','period_snapshot_window_mismatch');
 END IF;
 IF (snapshot->>'capturedAt')::timestamptz<ends_at THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','source_cutoff_too_early');
 END IF;
 SELECT count(*),min(id::text)::uuid,min(external_integration_id)
 INTO active_count,integration_ownership_id,agent_id
 FROM public.canonical_integration_ownership
 WHERE organization_id=org AND provider='retell' AND status='active';
 IF active_count<>1 OR integration_ownership_id IS NULL OR agent_id IS NULL THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','integration_ownership_unavailable');
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'sources') item
   WHERE item->>'eventAt' IS NULL) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','unknown_call_occurrence');
 END IF;
 SELECT COALESCE(jsonb_agg(item ORDER BY item->>'sourceId'),'[]'::jsonb)
 INTO sources FROM jsonb_array_elements(snapshot->'sources') item
 WHERE (item->>'eventAt')::timestamptz>=starts_at
   AND (item->>'eventAt')::timestamptz<ends_at;
 IF jsonb_array_length(sources)>1000 THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','period_limit_exceeded');
 END IF;
 scan_inputs:=public.canonical_forecast_retell_scan_inputs_read(
  org,actor,role_value,session_value,snapshot_value,starts_at,ends_at);
 IF scan_inputs->>'state' IS DISTINCT FROM 'ready_for_diagnostic' OR
    scan_inputs->>'agentId' IS DISTINCT FROM agent_id OR
    scan_inputs->>'sourceSnapshotDigest' IS DISTINCT FROM snapshot->>'sourceSnapshotDigest' OR
    jsonb_array_length(scan_inputs->'canonicalCallDigests')<>jsonb_array_length(sources) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','provider_scan_identity_unavailable');
 END IF;
 review_items:='[]'::jsonb;
 FOR source_item IN SELECT value FROM jsonb_array_elements(sources) value LOOP
  SELECT value INTO review_item FROM jsonb_array_elements(reviews->'calls') value
   WHERE value->>'callSourceId'=source_item->>'sourceId';
  IF review_item IS NULL OR review_item->>'status'<>'reviewed' OR
     review_item->>'reviewDigest' IS NULL OR review_item->>'reviewedAt' IS NULL THEN
   RETURN jsonb_build_object('state','retell_period_unavailable',
    'reason','period_reviews_incomplete');
  END IF;
  review_items:=review_items||jsonb_build_array(jsonb_build_object(
   'callSourceId',review_item->>'callSourceId','disposition',review_item->>'disposition',
   'anchorCallSourceId',review_item->>'anchorCallSourceId',
   'reviewRevision',(review_item->>'reviewRevision')::integer,
   'reviewDigest',review_item->>'reviewDigest','reviewedAt',review_item->>'reviewedAt'));
 END LOOP;
 SELECT count(*) INTO lead_count FROM jsonb_array_elements(review_items) item
  WHERE item->>'disposition'='new_lead';
 source_manifest_digest:=public.canonical_completion_digest(sources);
 review_manifest_digest:=public.canonical_completion_digest(review_items);
 RETURN jsonb_build_object(
  'state','retell_period_ready_for_certification',
  'version','m26-retell-complete-period-v2','organizationId',org,
  'scope','retell_only_tenant_all','targetKey','demand.inbound_leads',
  'targetVersion','v1','localMonthStart',month_value,'timeZone',zone,
  'startsAt',public.canonical_forecast_utc_instant(starts_at),
  'endsAt',public.canonical_forecast_utc_instant(ends_at),
  'profileAttestationId',profile->>'attestationId',
  'profileAttestationRevision',(profile->>'attestationRevision')::integer,
  'profileAttestationDigest',profile->>'attestationDigest',
  'businessProfileId',profile->>'businessProfileId',
  'businessProfileVersion',profile->>'businessProfileVersion',
  'businessProfileHash',profile->>'businessProfileHash',
  'integrationOwnershipId',integration_ownership_id,'agentId',agent_id,
  'providerCallDigestSetDigest',
    public.canonical_completion_digest(scan_inputs->'canonicalCallDigests'),
  'snapshotId',snapshot_value,'snapshotDigest',snapshot->>'sourceSnapshotDigest',
  'snapshotCapturedAt',snapshot->>'capturedAt','sourceCount',jsonb_array_length(sources),
  'sourceManifestDigest',source_manifest_digest,
  'reviewManifestDigest',review_manifest_digest,'reviewedDistinctLeadCount',lead_count,
  'callerConsentAttested',FALSE,'providerCoverageAttested',FALSE,
  'retentionAttested',FALSE,'providerIndependentVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'serviceMixAvailable',FALSE,
  'areaForecastAvailable',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_retell_period_certification_v2_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,snapshot_value UUID,month_value DATE,expected_revision INTEGER,
 expected_digest TEXT,evidence_digest_value TEXT,provider_scan_count_value INTEGER,
 provider_scan_digest_value TEXT,provider_scan_evidence_value JSONB,
 caller_consent_value BOOLEAN,
 provider_coverage_value BOOLEAN,retention_value BOOLEAN,reason_value TEXT,
 confirmation_version TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;evidence_value JSONB;prior public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 replay public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 key_hash TEXT;request_value JSONB;request_hash TEXT;new_id UUID:=gen_random_uuid();
 new_revision INTEGER;canonical_hash TEXT;scan_inputs JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value IS DISTINCT FROM 'owner' OR
     action_value NOT IN ('certify','revoke') OR key_value IS NULL OR length(key_value) NOT BETWEEN 8 AND 200 OR
     expected_revision NOT BETWEEN 0 AND 10000 OR
     expected_digest IS NULL OR evidence_digest_value<>repeat('0',64) OR
     provider_scan_digest_value<>repeat('0',64) OR
     provider_scan_count_value NOT BETWEEN 0 AND 1000 OR reason_value IS NULL OR
     jsonb_typeof(provider_scan_evidence_value) IS DISTINCT FROM 'object' OR
     octet_length(provider_scan_evidence_value::text)>131072 OR
     length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR octet_length(reason_value)>4000 OR
     (action_value='certify' AND (caller_consent_value IS DISTINCT FROM TRUE OR
       provider_coverage_value IS DISTINCT FROM TRUE OR
       retention_value IS DISTINCT FROM TRUE)) OR
     confirmation_version IS DISTINCT FROM 'm26-retell-period-certification-v2' THEN
   RAISE EXCEPTION 'Retell period certification request invalid' USING ERRCODE='22023';
  END IF;
  IF action_value='revoke' AND (provider_scan_count_value<>0 OR
     provider_scan_digest_value<>repeat('0',64) OR provider_scan_evidence_value<>'{}'::jsonb OR
     caller_consent_value OR
     provider_coverage_value OR retention_value) THEN
   RAISE EXCEPTION 'Retell period certification request invalid' USING ERRCODE='22023';
  END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 LOCK TABLE public.canonical_operations,public.canonical_transcripts,
  public.canonical_communications,public.canonical_opportunities,
  public.canonical_voice_sessions,public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents,
  public.canonical_forecast_retell_call_reviews,
  public.canonical_business_profiles,
  public.canonical_forecast_profile_month_attestations,
  public.canonical_forecast_retell_period_certifications_v2 IN SHARE MODE;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:retell-period-v2:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Retell period certification busy' USING ERRCODE='55P03';
 END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_value:=jsonb_build_object('action',action_value,'snapshotId',snapshot_value,
  'month',month_value,'expectedRevision',expected_revision,'expectedDigest',expected_digest,
  'evidenceDigest',evidence_digest_value,'providerScanCount',provider_scan_count_value,
  'providerScanDigest',provider_scan_digest_value,
  'providerScanEvidence',provider_scan_evidence_value,'callerConsent',caller_consent_value,
  'providerCoverage',provider_coverage_value,'retention',retention_value,
  'reason',reason_value,'confirmationVersion',confirmation_version);
 request_hash:=public.canonical_completion_digest(request_value);
 SELECT * INTO replay FROM public.canonical_forecast_retell_period_certifications_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF replay.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Retell period certification request key conflict' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state',CASE WHEN replay.action='certify' THEN
   'retell_period_certified' ELSE 'retell_period_revoked' END,'id',replay.id,
   'revision',replay.revision,'digest',rtrim(replay.canonical_digest),'replayed',TRUE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_retell_period_certifications_v2
  WHERE organization_id=org AND local_month_start=month_value ORDER BY revision DESC LIMIT 1;
 IF COALESCE(prior.revision,0)<>expected_revision OR
    (CASE WHEN prior.id IS NULL THEN expected_digest<>'none'
      ELSE rtrim(prior.canonical_digest)<>expected_digest END) THEN
  RAISE EXCEPTION 'Retell period certification changed' USING ERRCODE='40001';
 END IF;
 IF action_value='revoke' THEN
  IF prior.id IS NULL OR prior.action<>'certify' THEN
   RAISE EXCEPTION 'Retell period certification request invalid' USING ERRCODE='22023';
  END IF;
  evidence_digest_value:=rtrim(prior.evidence_digest);
  provider_scan_count_value:=prior.provider_scan_count;
  provider_scan_digest_value:=rtrim(prior.provider_scan_digest);
  provider_scan_evidence_value:=prior.provider_scan_evidence;
  evidence_value:=prior.evidence;
  IF snapshot_value<>prior.snapshot_id THEN
   RAISE EXCEPTION 'Retell period certification changed' USING ERRCODE='40001';
  END IF;
 ELSE
  IF caller_consent_value IS DISTINCT FROM TRUE OR provider_coverage_value IS DISTINCT FROM TRUE OR
     retention_value IS DISTINCT FROM TRUE THEN
   RAISE EXCEPTION 'Retell period certification confirmation required' USING ERRCODE='22023';
  END IF;
  evidence_value:=public.canonical_forecast_retell_period_evidence_v2(
   org,actor,role_value,session_value,snapshot_value,month_value);
  evidence_digest_value:=public.canonical_completion_digest(evidence_value);
  IF evidence_value->>'state' IS DISTINCT FROM 'retell_period_ready_for_certification' OR
     (evidence_value->>'sourceCount')::integer<>provider_scan_count_value THEN
   RAISE EXCEPTION 'Retell period evidence changed' USING ERRCODE='40001';
  END IF;
  scan_inputs:=public.canonical_forecast_retell_scan_inputs_read(
   org,actor,role_value,session_value,snapshot_value,
   (evidence_value->>'startsAt')::timestamptz,(evidence_value->>'endsAt')::timestamptz);
  IF NOT public.canonical_field_evidence_object_keys_exact(provider_scan_evidence_value,
       ARRAY['version','organizationId','snapshotId','localMonthStart','startsAt','endsAt',
       'integrationOwnershipId','agentId','canonicalCallDigests','callCount',
       'sourceSnapshotDigest','scannedAt']) OR
     provider_scan_evidence_value->>'version'<>'m26-retell-provider-scan-v2' OR
     provider_scan_evidence_value->>'organizationId'<>org::text OR
     provider_scan_evidence_value->>'snapshotId'<>snapshot_value::text OR
     provider_scan_evidence_value->>'localMonthStart'<>month_value::text OR
     provider_scan_evidence_value->>'startsAt'<>evidence_value->>'startsAt' OR
     provider_scan_evidence_value->>'endsAt'<>evidence_value->>'endsAt' OR
     provider_scan_evidence_value->>'integrationOwnershipId'<>
       evidence_value->>'integrationOwnershipId' OR
     provider_scan_evidence_value->>'agentId'<>evidence_value->>'agentId' OR
     jsonb_typeof(provider_scan_evidence_value->'canonicalCallDigests')<>'array' OR
     provider_scan_evidence_value->'canonicalCallDigests'<>scan_inputs->'canonicalCallDigests' OR
     jsonb_typeof(provider_scan_evidence_value->'callCount')<>'number' OR
     provider_scan_evidence_value->>'callCount'!~'^(0|[1-9][0-9]{0,3})$' OR
     (provider_scan_evidence_value->>'callCount')::integer<>provider_scan_count_value OR
     provider_scan_evidence_value->>'sourceSnapshotDigest'<>evidence_value->>'snapshotDigest' OR
     NOT public.canonical_progress_instant_valid(provider_scan_evidence_value->>'scannedAt') THEN
   RAISE EXCEPTION 'Retell period evidence changed' USING ERRCODE='40001';
  END IF;
  IF
     (provider_scan_evidence_value->>'scannedAt')::timestamptz<
       (evidence_value->>'endsAt')::timestamptz OR
     (provider_scan_evidence_value->>'scannedAt')::timestamptz<statement_timestamp()-INTERVAL '15 minutes' OR
     (provider_scan_evidence_value->>'scannedAt')::timestamptz>statement_timestamp()+INTERVAL '5 seconds' THEN
   RAISE EXCEPTION 'Retell period evidence changed' USING ERRCODE='40001';
  END IF;
  provider_scan_digest_value:=public.canonical_completion_digest(provider_scan_evidence_value);
 END IF;
 new_revision:=COALESCE(prior.revision,0)+1;
 canonical_hash:=public.canonical_completion_digest(jsonb_build_object(
  'id',new_id,'organizationId',org,'month',month_value,'revision',new_revision,
  'previousId',prior.id,'action',action_value,'snapshotId',snapshot_value,
  'evidenceDigest',evidence_digest_value,'providerScanCount',provider_scan_count_value,
  'providerScanDigest',provider_scan_digest_value,'callerConsent',caller_consent_value,
  'providerCoverage',provider_coverage_value,'retention',retention_value,
  'actorUserId',actor,'membershipId',authority->>'membershipId','reason',reason_value));
 INSERT INTO public.canonical_forecast_retell_period_certifications_v2(
  id,organization_id,local_month_start,revision,previous_id,action,snapshot_id,
  evidence,evidence_digest,provider_scan_count,provider_scan_digest,
  provider_scan_evidence,
  caller_consent_attested,provider_coverage_attested,retention_attested,reason,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,month_value,new_revision,prior.id,action_value,snapshot_value,
  evidence_value,evidence_digest_value,provider_scan_count_value,provider_scan_digest_value,
  provider_scan_evidence_value,
  caller_consent_value,provider_coverage_value,retention_value,reason_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state',CASE WHEN action_value='certify' THEN
  'retell_period_certified' ELSE 'retell_period_revoked' END,'id',new_id,
  'revision',new_revision,'digest',canonical_hash,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_retell_period_certification_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,month_value DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') OR
    month_value IS NULL OR extract(day FROM month_value)<>1 OR
    month_value<DATE '2000-01-01' OR month_value>=DATE '2100-12-01' THEN
  RAISE EXCEPTION 'Retell period certification read restricted' USING ERRCODE='42501';END IF;
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
 IF NOT FOUND THEN RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_retell_period_certifications_v2
  WHERE organization_id=org AND local_month_start=month_value
  ORDER BY revision DESC LIMIT 1;
 IF selected.id IS NULL THEN RETURN jsonb_build_object(
  'state','retell_period_certification_missing','localMonthStart',month_value,
  'expectedRevision',0,'expectedDigest','none');END IF;
 RETURN jsonb_build_object(
  'state',CASE WHEN selected.action='certify' THEN 'retell_period_certified'
   ELSE 'retell_period_revoked' END,
  'id',selected.id,'localMonthStart',selected.local_month_start,
  'snapshotId',selected.snapshot_id,'revision',selected.revision,
  'digest',rtrim(selected.canonical_digest),'action',selected.action,
  'recordedAt',public.canonical_forecast_utc_instant(selected.recorded_at),
  'expectedRevision',selected.revision,'expectedDigest',rtrim(selected.canonical_digest),
  'callerConsentAttested',selected.caller_consent_attested,
  'providerCoverageAttested',selected.provider_coverage_attested,
  'retentionAttested',selected.retention_attested,
  'providerIndependentVerified',FALSE,'wholeBusinessCoverageVerified',FALSE,
  'forecastIssued',FALSE,'paidNumericServing',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_retell_future_evidence_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,horizon_month DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE profile_row public.canonical_business_profiles%ROWTYPE;zone TEXT;
 expected_month DATE;month_value DATE;cert public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 current_evidence JSONB;items JSONB:='[]'::jsonb;lead_total BIGINT:=0;
 horizon_start TIMESTAMPTZ;horizon_end TIMESTAMPTZ;offset_value INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR horizon_month IS NULL OR
    extract(day FROM horizon_month)<>1 THEN
  RAISE EXCEPTION 'Retell future evidence request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Retell future evidence access restricted' USING ERRCODE='42501';
 END IF;
 LOCK TABLE public.canonical_operations,public.canonical_transcripts,
  public.canonical_communications,public.canonical_opportunities,
  public.canonical_voice_sessions,public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents,
  public.canonical_forecast_retell_call_reviews,
  public.canonical_business_profiles,
  public.canonical_forecast_profile_month_attestations,
  public.canonical_forecast_retell_period_certifications_v2 IN SHARE MODE;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:retell-future-v2:'||org::text,0)) THEN
  RAISE EXCEPTION 'Retell future evidence busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND is_active ORDER BY version_number DESC LIMIT 1 FOR SHARE;
 zone:=profile_row.raw_profile#>>'{company,timeZone}';
 IF profile_row.id IS NULL OR zone IS NULL OR
    NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
  RETURN jsonb_build_object('state','retell_future_unavailable','reason','current_profile_unavailable');
 END IF;
 expected_month:=date_trunc('month',(statement_timestamp() AT TIME ZONE zone)+INTERVAL '1 month')::date;
 IF horizon_month<>expected_month THEN
  RETURN jsonb_build_object('state','retell_future_unavailable','reason','horizon_not_next_local_month');
 END IF;
 -- A next-month origin uses the three fully completed months before the
 -- current partial month. The current month can never certify before capture.
 FOR offset_value IN REVERSE 4..2 LOOP
  month_value:=(horizon_month-(offset_value||' months')::interval)::date;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:retell-period-v2:'||org::text||':'||month_value::text,0)) THEN
   RAISE EXCEPTION 'Retell period evidence busy' USING ERRCODE='55P03';
  END IF;
  SELECT * INTO cert FROM public.canonical_forecast_retell_period_certifications_v2
   WHERE organization_id=org AND local_month_start=month_value
   ORDER BY revision DESC LIMIT 1;
  IF cert.id IS NULL OR cert.action<>'certify' THEN
   RETURN jsonb_build_object('state','retell_future_unavailable','reason','complete_period_missing');
  END IF;
  current_evidence:=public.canonical_forecast_retell_period_evidence_v2(
   org,actor,role_value,session_value,cert.snapshot_id,month_value);
  IF current_evidence->>'state'<>'retell_period_ready_for_certification' OR
     public.canonical_completion_digest(current_evidence)<>rtrim(cert.evidence_digest) OR
     current_evidence->>'businessProfileId'<>profile_row.id::text OR
     current_evidence->>'businessProfileVersion'<>profile_row.version_number::text OR
     current_evidence->>'businessProfileHash'<>rtrim(profile_row.normalized_profile_hash) THEN
   RETURN jsonb_build_object('state','retell_future_unavailable','reason','complete_period_stale');
  END IF;
  lead_total:=lead_total+(current_evidence->>'reviewedDistinctLeadCount')::integer;
  items:=items||jsonb_build_array(jsonb_build_object(
   'certificationId',cert.id,'certificationRevision',cert.revision,
   'certificationDigest',rtrim(cert.canonical_digest),'month',month_value,
   'snapshotId',cert.snapshot_id,'evidenceDigest',rtrim(cert.evidence_digest),
   'leadCount',(current_evidence->>'reviewedDistinctLeadCount')::integer));
 END LOOP;
 horizon_start:=horizon_month::timestamp AT TIME ZONE zone;
 horizon_end:=(horizon_month+INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 RETURN jsonb_build_object('state','retell_future_evidence_current',
  'version','m26-retell-future-origin-v2','organizationId',org,
  'scope','retell_only_tenant_all','targetKey','demand.inbound_leads',
  'targetVersion','v1','calculationVersion','m26-retell-three-month-mean-v2',
  'businessProfileId',profile_row.id,'businessProfileVersion',profile_row.version_number,
  'businessProfileHash',rtrim(profile_row.normalized_profile_hash),'timeZone',zone,
  'localHorizonStart',horizon_month,
  'horizonStartsAt',public.canonical_forecast_utc_instant(horizon_start),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_end),
  'periodCount',3,'periods',items,'periodInventoryDigest',public.canonical_completion_digest(items),
  'leadTotal',lead_total,'researchOnly',TRUE,'providerCoverageAttestedRetellOnly',TRUE,
  'providerIndependentVerified',FALSE,'wholeBusinessCoverageVerified',FALSE,
  'serviceMixAvailable',FALSE,'areaForecastAvailable',FALSE,
  'realForecastEligible',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_retell_future_origin_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 horizon_month DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;evidence_value JSONB;output_value JSONB;
 prior public.canonical_forecast_retell_future_origins_v2%ROWTYPE;
 key_hash TEXT;request_hash TEXT;evidence_hash TEXT;output_hash TEXT;canonical_hash TEXT;
 new_id UUID:=gen_random_uuid();amount_value TEXT;lead_total BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') OR
    key_value IS NULL OR length(key_value) NOT BETWEEN 8 AND 200 THEN
  RAISE EXCEPTION 'Retell future origin request invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'horizonMonth',horizon_month,'version','m26-retell-future-origin-v2'));
 SELECT * INTO prior FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Retell future origin request key conflict' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','retell_future_origin_saved','id',prior.id,
   'asOf',public.canonical_forecast_utc_instant(prior.as_of),
   'localHorizonStart',prior.local_horizon_start,'evidenceDigest',rtrim(prior.evidence_digest),
   'replayed',TRUE,'researchOnly',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 evidence_value:=public.canonical_forecast_retell_future_evidence_v2(
  org,actor,role_value,session_value,horizon_month);
 IF evidence_value->>'state'<>'retell_future_evidence_current' THEN
  RETURN evidence_value||jsonb_build_object('researchOnly',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 lead_total:=(evidence_value->>'leadTotal')::bigint;
 amount_value:=trim(trailing '.' FROM trim(trailing '0' FROM
  to_char(round(lead_total::numeric/3,6),'FM999999999999990.000000')));
 output_value:=jsonb_build_object('contractVersion','m26-forecast-output-v1',
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
 evidence_hash:=public.canonical_completion_digest(evidence_value);
 output_hash:=public.canonical_completion_digest(output_value);
 canonical_hash:=public.canonical_completion_digest(jsonb_build_object(
  'id',new_id,'organizationId',org,'evidenceDigest',evidence_hash,
  'outputDigest',output_hash,'actorUserId',actor,'membershipId',authority->>'membershipId'));
 INSERT INTO public.canonical_forecast_retell_future_origins_v2(
  id,organization_id,as_of,local_horizon_start,horizon_starts_at,horizon_ends_at,
  evidence,evidence_digest,private_output,output_digest,actor_user_id,membership_id,
  auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,statement_timestamp(),horizon_month,
  (evidence_value->>'horizonStartsAt')::timestamptz,
  (evidence_value->>'horizonEndsAt')::timestamptz,evidence_value,evidence_hash,
  output_value,output_hash,actor,(authority->>'membershipId')::uuid,session_value,
  key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state','retell_future_origin_saved','id',new_id,
  'asOf',public.canonical_forecast_utc_instant(statement_timestamp()),
  'localHorizonStart',horizon_month,'evidenceDigest',evidence_hash,
  'replayed',FALSE,'researchOnly',TRUE,
  'amountWithheld',TRUE,'serviceMixAvailable',FALSE,'areaForecastAvailable',FALSE,
  'realForecastEligible',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_retell_future_origin_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_retell_future_origins_v2%ROWTYPE;current_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR origin_value IS NULL THEN
  RAISE EXCEPTION 'Retell future origin request invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Retell future origin access restricted' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND id=origin_value;
 IF saved.id IS NULL THEN RETURN NULL;END IF;
 current_value:=public.canonical_forecast_retell_future_evidence_v2(
  org,actor,role_value,session_value,saved.local_horizon_start);
 IF current_value->>'state'<>'retell_future_evidence_current' OR
    public.canonical_completion_digest(current_value)<>rtrim(saved.evidence_digest) THEN
  RETURN jsonb_build_object('state','retell_future_origin_stale','id',saved.id,
   'refreshRequired',TRUE,'researchOnly',TRUE,'amountWithheld',TRUE,
   'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
 END IF;
 RETURN jsonb_build_object('state','retell_future_origin_current','id',saved.id,
  'asOf',public.canonical_forecast_utc_instant(saved.as_of),
  'localHorizonStart',saved.local_horizon_start,
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'targetKey','demand.inbound_leads','targetVersion','v1','scope','retell_only_tenant_all',
  'evidenceDigest',rtrim(saved.evidence_digest),
  'researchOnly',TRUE,'amountWithheld',TRUE,'serviceMixAvailable',FALSE,
  'areaForecastAvailable',FALSE,'providerIndependentVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'realForecastEligible',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_retell_period_certifications_v2 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_retell_future_origins_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_window_pins(
 UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_period_snapshot_v2_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_period_evidence_v2(
 UUID,UUID,TEXT,UUID,UUID,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_period_certification_v2_mutate(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID,DATE,INTEGER,TEXT,TEXT,INTEGER,TEXT,JSONB,
 BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_period_certification_v2_read(
 UUID,UUID,TEXT,UUID,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_future_evidence_v2(
 UUID,UUID,TEXT,UUID,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_future_origin_v2_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_future_origin_v2_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_retell_period_certifications_v2
  FROM northstar_app_runtime;
 REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_retell_future_origins_v2
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_window_pins(
  UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_retell_period_evidence_v2(
  UUID,UUID,TEXT,UUID,UUID,DATE) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_retell_future_evidence_v2(
  UUID,UUID,TEXT,UUID,DATE) FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_period_snapshot_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,DATE) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_period_evidence_v2(
  UUID,UUID,TEXT,UUID,UUID,DATE) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_period_certification_v2_mutate(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID,DATE,INTEGER,TEXT,TEXT,INTEGER,TEXT,JSONB,
 BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_period_certification_v2_read(
  UUID,UUID,TEXT,UUID,DATE) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_future_origin_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,DATE) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_future_origin_v2_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
