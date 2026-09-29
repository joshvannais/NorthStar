-- Mission 26 Part 2B: prospective Business Profile source visibility.
-- Existing profile rows do not establish past applicability. A captured
-- anchor can support only future windows with no intervening source change.
CREATE SEQUENCE public.canonical_forecast_profile_change_sequence AS BIGINT;
CREATE TABLE public.canonical_forecast_profile_change_events (
 organization_id UUID NOT NULL,
 source_order BIGINT NOT NULL CHECK(source_order>0),
 business_profile_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,source_order),
 FOREIGN KEY(organization_id,business_profile_id)
  REFERENCES public.canonical_business_profiles(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_profile_changes_recent
 ON public.canonical_forecast_profile_change_events(organization_id,source_order DESC);
CREATE FUNCTION public.canonical_forecast_profile_change_record()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
  RAISE EXCEPTION 'Business Profile tenant cannot change' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||NEW.organization_id::text,0));
 INSERT INTO public.canonical_forecast_profile_change_events(
  organization_id,source_order,business_profile_id,observed_at)
 VALUES(NEW.organization_id,
  nextval('public.canonical_forecast_profile_change_sequence'),NEW.id,clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_profile_change_record
 AFTER INSERT OR UPDATE OF is_active,raw_profile,normalized_profile,
  normalized_profile_hash,version_number,retired_at
 ON public.canonical_business_profiles
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_profile_change_record();

CREATE TABLE public.canonical_forecast_profile_effective_anchors (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 business_profile_id UUID NOT NULL,
 business_profile_version BIGINT NOT NULL CHECK(business_profile_version>0),
 business_profile_hash CHAR(64) NOT NULL CHECK(business_profile_hash~'^[a-f0-9]{64}$'),
 raw_profile_digest CHAR(64) NOT NULL CHECK(raw_profile_digest~'^[a-f0-9]{64}$'),
 source_order BIGINT NOT NULL CHECK(source_order>=0),
 captured_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,business_profile_id)
  REFERENCES public.canonical_business_profiles(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(auth_session_id) REFERENCES public.auth_sessions(id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_profile_effective_anchors_recent
 ON public.canonical_forecast_profile_effective_anchors(organization_id,captured_at DESC,id DESC);
CREATE TABLE public.canonical_forecast_profile_effective_activations (
 organization_id UUID NOT NULL,
 anchor_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 PRIMARY KEY(organization_id,anchor_id),
 FOREIGN KEY(organization_id,anchor_id)
  REFERENCES public.canonical_forecast_profile_effective_anchors(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(auth_session_id) REFERENCES public.auth_sessions(id) ON DELETE RESTRICT
);
CREATE FUNCTION public.canonical_forecast_profile_effective_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast profile evidence is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_profile_change_events_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_profile_change_events
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_profile_effective_immutable();
CREATE TRIGGER canonical_forecast_profile_effective_anchors_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_profile_effective_anchors
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_profile_effective_immutable();
CREATE TRIGGER canonical_forecast_profile_effective_activations_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_profile_effective_activations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_profile_effective_immutable();

CREATE FUNCTION public.canonical_forecast_profile_effective_anchor_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,reason_value TEXT,confirmed_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE profile_row public.canonical_business_profiles%ROWTYPE;
 prior public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 last_order BIGINT; key_hash TEXT; body_hash TEXT; captured TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
  octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Forecast profile anchor input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast profile source busy' USING ERRCODE='55P03';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 body_hash:=encode(sha256(convert_to(jsonb_build_object(
  'reason',btrim(reason_value),'confirmed',confirmed_value,
  'version','m26-profile-effective-anchor-v1')::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF prior.request_digest<>body_hash THEN
   RAISE EXCEPTION 'Forecast profile anchor replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','profile_effective_anchor_recorded',
   'anchorId',prior.id,'capturedAt',public.canonical_forecast_utc_instant(prior.captured_at),
   'replayed',TRUE,'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND is_active=TRUE;
 IF profile_row.id IS NULL THEN
  RETURN jsonb_build_object('state','profile_effective_anchor_unavailable',
   'reason','active_profile_missing','historicalCalendarVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 SELECT COALESCE(MAX(source_order),0) INTO last_order
  FROM public.canonical_forecast_profile_change_events WHERE organization_id=org;
 captured:=clock_timestamp();
 INSERT INTO public.canonical_forecast_profile_effective_anchors(
  organization_id,business_profile_id,business_profile_version,
  business_profile_hash,raw_profile_digest,source_order,captured_at,
  actor_user_id,auth_session_id,reason,request_key_hash,request_digest)
 VALUES(org,profile_row.id,profile_row.version_number,
  profile_row.normalized_profile_hash,
  public.canonical_completion_digest(profile_row.raw_profile),last_order,captured,
  actor,session_value,btrim(reason_value),key_hash,body_hash) RETURNING * INTO prior;
 RETURN jsonb_build_object('state','profile_effective_anchor_recorded',
  'anchorId',prior.id,'capturedAt',public.canonical_forecast_utc_instant(captured),
  'replayed',FALSE,'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
END $$;

-- A separate transaction proves the anchor committed before a future local
-- period begins. The capture's insert clock alone is insufficient.
CREATE FUNCTION public.canonical_forecast_profile_effective_anchor_activate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,anchor_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 prior public.canonical_forecast_profile_effective_activations%ROWTYPE;
 source_xid XID8; observed TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Forecast profile activation requires READ COMMITTED' USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','profile_effective_activation_unavailable',
   'reason','anchor_not_found','historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF FOUND THEN
  RETURN jsonb_build_object('state','profile_effective_activation_recorded',
   'anchorId',anchor_value,'observedAt',public.canonical_forecast_utc_instant(prior.observed_at),
   'replayed',TRUE,'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO source_xid
  FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 IF pg_xact_status(source_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','profile_effective_activation_unavailable',
   'reason','anchor_commit_unverified','historicalCalendarVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 observed:=clock_timestamp();
 INSERT INTO public.canonical_forecast_profile_effective_activations(
  organization_id,anchor_id,observed_at,actor_user_id,auth_session_id)
 VALUES(org,anchor_value,observed,actor,session_value)
 ON CONFLICT ON CONSTRAINT canonical_forecast_profile_effective_activations_pkey
 DO NOTHING;
 SELECT * INTO prior FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Forecast profile activation unavailable' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('state','profile_effective_activation_recorded',
  'anchorId',anchor_value,'observedAt',public.canonical_forecast_utc_instant(prior.observed_at),
  'replayed',prior.observed_at<>observed,
  'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_profile_effective_window(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 anchor_value UUID,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 activation public.canonical_forecast_profile_effective_activations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Forecast profile window requires READ COMMITTED' USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast profile source busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 SELECT * INTO activation FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF anchor_row.id IS NULL OR activation.anchor_id IS NULL OR
  starts_at IS NULL OR ends_at IS NULL OR starts_at>=ends_at OR
  activation.observed_at>=starts_at OR ends_at>clock_timestamp() THEN
  RETURN jsonb_build_object('state','profile_effective_window_unavailable',
   'reason','prospective_elapsed_period_unverified',
   'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=anchor_row.business_profile_id;
 IF profile_row.id IS NULL OR
  profile_row.version_number<>anchor_row.business_profile_version OR
  profile_row.normalized_profile_hash<>anchor_row.business_profile_hash OR
  public.canonical_completion_digest(profile_row.raw_profile)<>anchor_row.raw_profile_digest OR
  EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events event
   WHERE event.organization_id=org AND event.source_order>anchor_row.source_order
    AND event.observed_at<ends_at LIMIT 1) THEN
  RETURN jsonb_build_object('state','profile_effective_window_unavailable',
   'reason','profile_changed_during_period',
   'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','profile_effective_window_verified',
  'anchorId',anchor_value,'businessProfileId',anchor_row.business_profile_id,
  'businessProfileVersion',anchor_row.business_profile_version,
  'businessProfileHash',rtrim(anchor_row.business_profile_hash),
  'startsAt',public.canonical_forecast_utc_instant(starts_at),
  'endsAt',public.canonical_forecast_utc_instant(ends_at),
  'scope','prospective_northstar_business_profile',
  'historicalCalendarVerified',TRUE,'observationCoverageVerified',FALSE,
  'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_profile_effective_anchor_pin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,anchor_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','profile_effective_anchor_unavailable');
 END IF;
 RETURN jsonb_build_object('state','profile_effective_anchor_pinned',
  'businessProfileId',anchor_row.business_profile_id,
  'businessProfileVersion',anchor_row.business_profile_version,
  'businessProfileHash',rtrim(anchor_row.business_profile_hash));
END $$;

REVOKE ALL ON SEQUENCE public.canonical_forecast_profile_change_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_profile_change_events FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_profile_effective_anchors FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_profile_effective_activations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_change_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_effective_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_effective_anchor_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_effective_anchor_activate(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_effective_window(
 UUID,UUID,TEXT,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_effective_anchor_pin(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON SEQUENCE public.canonical_forecast_profile_change_sequence FROM northstar_app_runtime;
 REVOKE ALL ON TABLE public.canonical_forecast_profile_change_events FROM northstar_app_runtime;
 REVOKE ALL ON TABLE public.canonical_forecast_profile_effective_anchors FROM northstar_app_runtime;
 REVOKE ALL ON TABLE public.canonical_forecast_profile_effective_activations FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_profile_change_record() FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_profile_effective_immutable() FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_profile_effective_anchor_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_profile_effective_anchor_activate(
  UUID,UUID,TEXT,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_profile_effective_window(
  UUID,UUID,TEXT,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_profile_effective_anchor_pin(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
