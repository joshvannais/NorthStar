-- Mission 26 Part 6A: explicit start of tenant-local booked confirmation coverage.
-- The anchor cannot make an earlier month, off-platform bookings, or a
-- historical month-end booked-work balance complete.
CREATE TABLE public.canonical_forecast_booked_work_anchors (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 captured_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(auth_session_id) REFERENCES public.auth_sessions(id) ON DELETE RESTRICT
);
CREATE FUNCTION public.canonical_forecast_booked_work_anchor_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Booked-work source anchors are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_booked_work_anchor_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_booked_work_anchors
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_booked_work_anchor_immutable();

CREATE FUNCTION public.canonical_forecast_capture_booked_work_anchor(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,reason_value TEXT,confirmed_value BOOLEAN,version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old public.canonical_forecast_booked_work_anchors%ROWTYPE;
 inserted public.canonical_forecast_booked_work_anchors%ROWTYPE;
 key_hash TEXT;request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
   octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE OR
   version_value IS DISTINCT FROM 'booked-work-source-anchor-v1' THEN
  RAISE EXCEPTION 'Booked-work source anchor input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 -- Confirmations, corrections, cancellations and schedule approvals use
 -- this tenant source lock, which remains held until the caller commits.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'reason',btrim(reason_value),'confirmed',confirmed_value,
  'version',version_value)::text,'UTF8')),'hex');
 SELECT * INTO old FROM public.canonical_forecast_booked_work_anchors
  WHERE organization_id=org;
 IF FOUND THEN
  IF old.actor_user_id=actor AND old.request_key_hash=key_hash THEN
   IF old.request_digest<>request_hash THEN
    RAISE EXCEPTION 'Booked-work source anchor replay changed' USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object('state','booked_work_source_anchored',
    'anchorId',old.id,'coverageStartsAt',public.canonical_forecast_utc_instant(old.captured_at),
    'replayed',TRUE,'completePeriodVerified',FALSE,'forecastIssued',FALSE);
  END IF;
  RETURN jsonb_build_object('state','booked_work_source_already_anchored',
   'anchorId',old.id,'coverageStartsAt',public.canonical_forecast_utc_instant(old.captured_at),
   'replayed',FALSE,'completePeriodVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_booked_work_anchors(
  organization_id,captured_at,actor_user_id,auth_session_id,reason,
  request_key_hash,request_digest)
 VALUES(org,clock_timestamp(),actor,session_value,btrim(reason_value),
  key_hash,request_hash) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','booked_work_source_anchored',
  'anchorId',inserted.id,
  'coverageStartsAt',public.canonical_forecast_utc_instant(inserted.captured_at),
  'replayed',FALSE,'completePeriodVerified',FALSE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_booked_work_source_month(
 org UUID,actor UUID,role_value TEXT,session_value UUID,month_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor public.canonical_forecast_booked_work_anchors%ROWTYPE;
 month_start TIMESTAMPTZ;month_end TIMESTAMPTZ;observed JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   month_value IS NULL OR month_value !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR
   substring(month_value,1,4)::integer=0 THEN
  RAISE EXCEPTION 'Booked-work source month invalid' USING ERRCODE='22023';
 END IF;
 month_start:=make_date(substring(month_value,1,4)::integer,
  substring(month_value,6,2)::integer,1)::timestamp AT TIME ZONE 'UTC';
 month_end:=(make_date(substring(month_value,1,4)::integer,
  substring(month_value,6,2)::integer,1)+INTERVAL '1 month')::timestamp
  AT TIME ZONE 'UTC';
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO anchor FROM public.canonical_forecast_booked_work_anchors
  WHERE organization_id=org;
 IF NOT FOUND OR anchor.captured_at>month_start OR month_end>clock_timestamp() THEN
  RETURN jsonb_build_object('state','booked_work_source_month_unavailable',
   'reason',CASE WHEN anchor.organization_id IS NULL THEN 'source_anchor_missing'
    WHEN anchor.captured_at>month_start THEN 'month_before_source_anchor'
    ELSE 'month_not_closed' END,'month',month_value,
   'sourceMonthCoverageVerified',FALSE,'completePeriodVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 observed:=public.canonical_forecast_booked_work_month_observed(
  org,actor,role_value,session_value,month_value);
 IF observed->>'state'<>'observed_owner_confirmed_jobs' OR
   observed->'includedJobConfirmationsVerified' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('state','booked_work_source_month_unavailable',
   'reason','observed_confirmations_unavailable','month',month_value,
   'sourceMonthCoverageVerified',FALSE,'completePeriodVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','northstar_confirmation_source_month_current',
  'month',month_value,'timeZone','UTC','anchorId',anchor.id,
  'coverageStartsAt',public.canonical_forecast_utc_instant(anchor.captured_at),
  'confirmedJobCount',observed->'confirmedJobCount',
  'currentConfirmedBeforeTax',observed->>'observedBeforeTax',
  'currency',observed->>'currency',
  'sourceMonthCoverageVerified',TRUE,'completePeriodVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'earnedRevenueMeasured',FALSE,
  'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_forecast_booked_work_anchors FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booked_work_anchor_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_booked_work_anchor(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booked_work_source_month(
 UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_booked_work_anchor(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booked_work_source_month(
  UUID,UUID,TEXT,UUID,TEXT) TO northstar_app_runtime;
END IF;END $$;
