-- Mission 26 Part 2B: an owner-reviewed claim that one immutable Business
-- Profile revision described a completed local month. This does not alter
-- Mission 20's Business Profile or establish source-observation coverage.

CREATE TABLE public.canonical_forecast_profile_month_attestations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 local_start_date DATE NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 1000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('confirm','revoke')),
 business_profile_id UUID NOT NULL,
 business_profile_version BIGINT NOT NULL CHECK(business_profile_version>0),
 business_profile_hash CHAR(64) NOT NULL CHECK(business_profile_hash~'^[0-9a-f]{64}$'),
 raw_profile_digest CHAR(64) NOT NULL CHECK(raw_profile_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000 AND octet_length(reason)<=4000),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest CHAR(64) NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,local_start_date,revision),
 UNIQUE(organization_id,local_start_date,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,business_profile_id)
  REFERENCES public.canonical_business_profiles(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,local_start_date,previous_id)
  REFERENCES public.canonical_forecast_profile_month_attestations(organization_id,local_start_date,id)
  ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL AND action='confirm') OR
       (revision>1 AND previous_id IS NOT NULL))
);
CREATE INDEX canonical_forecast_profile_month_attestations_tenant_month
 ON public.canonical_forecast_profile_month_attestations(organization_id,local_start_date,revision DESC);

CREATE FUNCTION public.canonical_forecast_profile_month_attestation_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast calendar attestation is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER canonical_forecast_profile_month_attestations_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_profile_month_attestations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_profile_month_attestation_immutable();

CREATE FUNCTION public.canonical_forecast_profile_month_attestation_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 month_value DATE,action_value TEXT,profile_value UUID,profile_hash_value TEXT,
 expected_revision INTEGER,expected_digest TEXT,reason_value TEXT,
 confirmed_value BOOLEAN,confirmation_version TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; old public.canonical_forecast_profile_month_attestations%ROWTYPE;
 current_row public.canonical_forecast_profile_month_attestations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
 inserted public.canonical_forecast_profile_month_attestations%ROWTYPE;
 key_hash TEXT; body_hash TEXT; current_local_date DATE; month_end DATE;
 raw_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast calendar access restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    month_value IS NULL OR month_value<DATE '2000-01-01' OR
    month_value>=DATE '2100-12-01' OR extract(day FROM month_value)<>1 OR
    action_value IS NULL OR action_value NOT IN ('confirm','revoke') OR
    profile_value IS NULL OR profile_hash_value IS NULL OR
    profile_hash_value!~'^[0-9a-f]{64}$' OR
    expected_revision IS NULL OR expected_revision<0 OR expected_revision>=1000 OR
    (expected_revision=0 AND expected_digest IS NOT NULL) OR
    (expected_revision>0 AND (expected_digest IS NULL OR expected_digest!~'^[0-9a-f]{64}$')) OR
    reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 1 AND 1000 OR
    octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE OR
    confirmation_version IS DISTINCT FROM 'forecast-calendar-review-v1' THEN
  RAISE EXCEPTION 'Forecast calendar request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 body_hash:=public.canonical_completion_digest(jsonb_build_object(
  'month',month_value,'action',action_value,'profile',profile_value,
  'profileHash',profile_hash_value,'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'reason',btrim(reason_value),
  'confirmed',confirmed_value,'confirmationVersion',confirmation_version));
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-month:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Forecast calendar busy' USING ERRCODE='55P03';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_forecast_profile_month_attestations
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>body_hash THEN
   RAISE EXCEPTION 'Forecast calendar request key conflict' USING ERRCODE='23505';END IF;
  SELECT * INTO profile_row FROM public.canonical_business_profiles
   WHERE organization_id=org AND id=old.business_profile_id;
  RETURN jsonb_build_object('id',old.id,'revision',old.revision,
   'digest',rtrim(old.digest),'action',old.action,'replayed',TRUE,
   'profilePinVerified',old.action='confirm' AND profile_row.id IS NOT NULL AND
     profile_row.version_number=old.business_profile_version AND
     rtrim(profile_row.normalized_profile_hash)=rtrim(old.business_profile_hash) AND
     public.canonical_completion_digest(profile_row.raw_profile)=rtrim(old.raw_profile_digest));
 END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_profile_month_attestations
  WHERE organization_id=org AND local_start_date=month_value
  ORDER BY revision DESC LIMIT 1;
 IF COALESCE(current_row.revision,0)<>expected_revision OR
    (expected_revision>0 AND rtrim(current_row.digest)<>expected_digest) OR
    (action_value='revoke' AND (current_row.id IS NULL OR current_row.action='revoke')) THEN
  RAISE EXCEPTION 'Forecast calendar changed' USING ERRCODE='40001';END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=profile_value FOR SHARE;
 IF profile_row.id IS NULL OR
    (action_value='confirm' AND
      rtrim(profile_row.normalized_profile_hash)<>profile_hash_value) OR
    (action_value='revoke' AND (current_row.business_profile_id<>profile_value OR
      rtrim(current_row.business_profile_hash)<>profile_hash_value)) THEN
  RAISE EXCEPTION 'Business Profile changed' USING ERRCODE='40001';END IF;
 IF action_value='confirm' THEN
  IF profile_row.raw_profile->'company'->>'timeZone' IS NULL OR
     NOT EXISTS(SELECT 1 FROM pg_timezone_names
       WHERE name=profile_row.raw_profile->'company'->>'timeZone') THEN
   RAISE EXCEPTION 'Business time zone unavailable' USING ERRCODE='22023';END IF;
  month_end:=(month_value+INTERVAL '1 month')::date;
  current_local_date:=(clock_timestamp() AT TIME ZONE
    (profile_row.raw_profile->'company'->>'timeZone'))::date;
  IF current_local_date IS NULL OR month_end>current_local_date THEN
   RAISE EXCEPTION 'The local month is not complete' USING ERRCODE='22023';END IF;
 END IF;
 raw_digest:=CASE WHEN action_value='revoke' THEN rtrim(current_row.raw_profile_digest)
  ELSE public.canonical_completion_digest(profile_row.raw_profile) END;
 INSERT INTO public.canonical_forecast_profile_month_attestations(
  organization_id,local_start_date,revision,previous_id,action,
  business_profile_id,business_profile_version,business_profile_hash,raw_profile_digest,
  actor_user_id,membership_id,auth_session_id,reason,digest,
  request_key_hash,request_digest)
 VALUES(org,month_value,expected_revision+1,current_row.id,action_value,
  profile_row.id,CASE WHEN action_value='revoke' THEN current_row.business_profile_version
    ELSE profile_row.version_number END,profile_hash_value,raw_digest,
  actor,(authority->>'membershipId')::uuid,session_value,btrim(reason_value),
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,
   'localStartDate',month_value,'revision',expected_revision+1,
   'previousDigest',expected_digest,'action',action_value,
   'businessProfileId',profile_row.id,'businessProfileVersion',
   CASE WHEN action_value='revoke' THEN current_row.business_profile_version
    ELSE profile_row.version_number END,
   'businessProfileHash',profile_hash_value,'rawProfileDigest',raw_digest,
   'actorUserId',actor,
   'reason',btrim(reason_value))),key_hash,body_hash)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('id',inserted.id,'revision',inserted.revision,
  'digest',rtrim(inserted.digest),'action',inserted.action,'replayed',FALSE,
  'profilePinVerified',action_value='confirm');
END $$;

CREATE FUNCTION public.canonical_forecast_profile_month_attestation_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,month_value DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_profile_month_attestations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast calendar access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF month_value IS NULL OR month_value<DATE '2000-01-01' OR
    month_value>=DATE '2100-12-01' OR extract(day FROM month_value)<>1 THEN
  RAISE EXCEPTION 'Forecast calendar request invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_profile_month_attestations
  WHERE organization_id=org AND local_start_date=month_value
  ORDER BY revision DESC LIMIT 1;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=selected.business_profile_id;
 RETURN jsonb_build_object('id',selected.id,'revision',selected.revision,
  'digest',rtrim(selected.digest),'action',selected.action,
  'businessProfileId',selected.business_profile_id,
  'businessProfileVersion',selected.business_profile_version,
  'businessProfileHash',rtrim(selected.business_profile_hash),
  'profilePinVerified',selected.action='confirm' AND profile_row.id IS NOT NULL AND
    profile_row.version_number=selected.business_profile_version AND
    rtrim(profile_row.normalized_profile_hash)=rtrim(selected.business_profile_hash) AND
    public.canonical_completion_digest(profile_row.raw_profile)=rtrim(selected.raw_profile_digest),
  'localStartDate',selected.local_start_date,'recordedAt',
  public.canonical_forecast_utc_instant(selected.recorded_at),
  'evidenceKind','owner_confirmed_historical_profile_applicability',
  'historicalCalendarVerified',FALSE,'observationCoverageVerified',FALSE,
  'forecastIssued',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_profile_month_attestations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_month_attestation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_month_attestation_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,DATE,TEXT,UUID,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_month_attestation_read(
 UUID,UUID,TEXT,UUID,DATE) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_profile_month_attestation_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,DATE,TEXT,UUID,TEXT,INTEGER,TEXT,TEXT,BOOLEAN,TEXT)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_profile_month_attestation_read(
  UUID,UUID,TEXT,UUID,DATE) TO northstar_app_runtime;
END IF;END $$;
