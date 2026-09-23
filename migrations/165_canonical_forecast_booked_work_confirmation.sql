-- Mission 26 Part 6A: tenant-private owner confirmation of one booked job.
-- This adds no Mission 22 or 24 mutation and never claims earned or cash revenue.
CREATE TABLE public.canonical_forecast_booked_work_confirmations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 review_id UUID NOT NULL,
 appointment_id UUID NOT NULL,
 opportunity_id UUID NOT NULL,
 issued_version_id UUID NOT NULL,
 approval_id UUID NOT NULL,
 price_before_tax TEXT NOT NULL CHECK(price_before_tax ~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'),
 currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash ~ '^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 confirmed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,review_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,review_id)
  REFERENCES public.canonical_forecast_commercial_booking_reviews(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE FUNCTION public.canonical_forecast_booked_work_confirmation_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Booked-work confirmations are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_booked_work_confirmation_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_booked_work_confirmations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_booked_work_confirmation_immutable();

CREATE FUNCTION public.canonical_forecast_confirm_booked_work(
 org UUID,actor UUID,role_value TEXT,session_value UUID,review_value UUID,
 csrf TEXT,key_value TEXT,reason_value TEXT,confirmed_value BOOLEAN,version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE position JSONB;
 reviewed public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 existing public.canonical_forecast_booked_work_confirmations%ROWTYPE;
 inserted public.canonical_forecast_booked_work_confirmations%ROWTYPE;
 key_hash TEXT; request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  review_value IS NULL OR confirmed_value IS DISTINCT FROM TRUE OR
  version_value IS DISTINCT FROM 'owner-booked-work-confirm-v1' OR
  reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
  octet_length(reason_value)>4000 OR key_value IS NULL OR
  key_value !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Booked-work confirmation input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 -- The position rechecks tenant-private accepted scope, price and schedule
 -- while holding their source locks for the remainder of this transaction.
 position:=public.canonical_forecast_owner_reviewed_booking_position(
  org,actor,role_value,session_value,review_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'reviewId',review_value,'reason',btrim(reason_value),
  'confirmed',confirmed_value,'version',version_value)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.canonical_forecast_booked_work_confirmations
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.review_id IS DISTINCT FROM review_value OR
   existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Booked-work confirmation replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('id',existing.id,'state','booking_confirmation_recorded',
   'reviewId',existing.review_id,'replayed',TRUE,
   'currentnessUnknown',TRUE,'forecastIssued',FALSE);
 END IF;
 IF position->>'state'<>'owner_reviewed_booking_candidate' OR
  position->'ownerAttestationCurrentAtRead' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('state','booking_confirmation_unavailable',
   'reason',position->>'reason','replayed',FALSE,
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO reviewed FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND id=review_value
   AND action IN ('first_booking_reviewed','booking_corrected');
 IF NOT FOUND OR position->>'reviewedPriceBeforeTax' IS DISTINCT FROM
    reviewed.reviewed_price_before_tax OR
    position->>'currency' IS DISTINCT FROM reviewed.currency THEN
  RETURN jsonb_build_object('state','booking_confirmation_unavailable',
   'reason','review_position_changed','replayed',FALSE,
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_booked_work_confirmations
   WHERE organization_id=org AND review_id=review_value) THEN
  RETURN jsonb_build_object('state','prior_booking_confirmation_exists',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_booked_work_confirmations(
  organization_id,review_id,appointment_id,opportunity_id,issued_version_id,
  approval_id,price_before_tax,currency,reason,actor_user_id,
  auth_session_id,request_key_hash,request_digest)
 VALUES(org,reviewed.id,reviewed.appointment_id,reviewed.opportunity_id,
  reviewed.issued_version_id,reviewed.approval_id,
  reviewed.reviewed_price_before_tax,reviewed.currency,btrim(reason_value),
  actor,session_value,key_hash,request_hash) RETURNING * INTO inserted;
 RETURN jsonb_build_object('id',inserted.id,'state','booking_confirmation_recorded',
  'reviewId',inserted.review_id,'replayed',FALSE,
  'currentnessUnknown',TRUE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_booked_work_confirmation_currentness(
 org UUID,actor UUID,role_value TEXT,session_value UUID,confirmation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE recorded public.canonical_forecast_booked_work_confirmations%ROWTYPE;
 position JSONB;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO recorded FROM public.canonical_forecast_booked_work_confirmations
  WHERE organization_id=org AND id=confirmation_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','booking_confirmation_unavailable',
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 position:=public.canonical_forecast_owner_reviewed_booking_position(
  org,actor,role_value,session_value,recorded.review_id);
 IF position->>'state'<>'owner_reviewed_booking_candidate' OR
  position->>'reviewedPriceBeforeTax' IS DISTINCT FROM recorded.price_before_tax OR
  position->>'currency' IS DISTINCT FROM recorded.currency THEN
  RETURN jsonb_build_object('state','booking_confirmation_stale_or_unavailable',
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','owner_confirmed_booked_work_current',
  'confirmationId',recorded.id,'reviewId',recorded.review_id,
  'appointmentId',recorded.appointment_id,
  'commercialStatus','owner_confirmed_booked',
  'priceBeforeTax',recorded.price_before_tax,'currency',recorded.currency,
  'authority','paid_owner_or_admin_confirmation',
  'bookedWorkVerified',TRUE,'historicalCoverageVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'earnedRevenueMeasured',FALSE,
  'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_forecast_booked_work_confirmations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booked_work_confirmation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_confirm_booked_work(
 UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booked_work_confirmation_currentness(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_confirm_booked_work(
  UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT,TEXT,BOOLEAN,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booked_work_confirmation_currentness(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
