-- Mission 26 Part 6A: owner/admin records an explicit commercial booking
-- cancellation. This does not mutate Mission 22 scheduling or Mission 24
-- estimate authority and never claims a booked-work amount.
CREATE FUNCTION public.canonical_forecast_cancel_booking_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,prior_value UUID,
 reason_value TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 latest public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 existing public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 inserted public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 key_hash TEXT; request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
  octet_length(reason_value)>4000 OR key_value IS NULL OR
  key_value !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Booking cancellation review input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'priorReviewId',prior_value,'reason',btrim(reason_value),
  'action','booking_cancelled')::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.action<>'booking_cancelled' OR
   existing.request_digest<>request_hash OR
   existing.previous_review_id IS DISTINCT FROM prior_value THEN
   RAISE EXCEPTION 'Booking cancellation replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('id',existing.id,'state','booking_cancelled',
   'replayed',TRUE,'schedulingNeedsReview',TRUE,
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND id=prior_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','prior_review_unavailable',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO latest FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND appointment_id=prior.appointment_id
  ORDER BY review_order DESC LIMIT 1;
 IF latest.id IS DISTINCT FROM prior.id OR prior.action='booking_cancelled' THEN
  RETURN jsonb_build_object('state','prior_review_stale_or_cancelled',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_commercial_booking_reviews(
  organization_id,appointment_id,opportunity_id,approval_id,acceptance_id,
  estimate_id,issued_version_id,approved_decision_id,approved_decision_digest,
  reviewed_price_before_tax,currency,action,previous_review_id,reason,
  actor_user_id,auth_session_id,request_key_hash,request_digest,review_order)
 VALUES(org,prior.appointment_id,prior.opportunity_id,prior.approval_id,
  prior.acceptance_id,prior.estimate_id,prior.issued_version_id,
  prior.approved_decision_id,prior.approved_decision_digest,
  prior.reviewed_price_before_tax,prior.currency,'booking_cancelled',prior.id,
  btrim(reason_value),actor,session_value,key_hash,request_hash,
  nextval('public.canonical_forecast_commercial_review_sequence'))
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('id',inserted.id,'state','booking_cancelled',
  'previousReviewId',prior.id,'replayed',FALSE,'schedulingNeedsReview',TRUE,
  'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_cancel_booking_review(
 UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_cancel_booking_review(
  UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT) TO northstar_app_runtime;
END IF;END $$;
