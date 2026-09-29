-- Mission 26 Part 4B: one immutable, source-owned historical cohort for the
-- owner-reviewed commercial-booking withdrawal target. This deliberately is
-- not the canonical demand.booking_cancellation target: a commercial review
-- does not prove Mission 22 operational cancellation or current at-risk state.
-- It is descriptive internal evidence, not complete business history, a
-- calibrated probability or a forecast, and never mutates scheduling.
CREATE TABLE public.canonical_forecast_booking_cancellation_cohorts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 cutoff_at TIMESTAMPTZ NOT NULL,
 horizon_ends_at TIMESTAMPTZ NOT NULL,
 source_high_water_order BIGINT NOT NULL CHECK(source_high_water_order>=0),
 member_receipts JSONB NOT NULL CHECK(jsonb_typeof(member_receipts)='array'),
 eligible_count INTEGER NOT NULL CHECK(eligible_count BETWEEN 0 AND 500),
 cancelled_count INTEGER NOT NULL CHECK(cancelled_count BETWEEN 0 AND eligible_count),
 source_digest TEXT NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 digest_nonce UUID NOT NULL,
 cohort_digest TEXT NOT NULL CHECK(cohort_digest~'^[a-f0-9]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 CHECK(horizon_ends_at>cutoff_at),
 CHECK(octet_length(member_receipts::text)<=262144),
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_booking_cancellation_cohorts_tenant_capture
 ON public.canonical_forecast_booking_cancellation_cohorts(
  organization_id,captured_at DESC,id);

CREATE FUNCTION public.canonical_forecast_booking_cancellation_cohort_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Booking cancellation cohorts are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_booking_cancellation_cohort_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_booking_cancellation_cohorts
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_booking_cancellation_cohort_immutable();

CREATE FUNCTION public.canonical_forecast_booking_cancellation_cohort_projection(
 value public.canonical_forecast_booking_cancellation_cohorts,stale_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,
  'version','m26-commercial-booking-withdrawal-cohort-v1',
  'targetKey','commercial.owner_reviewed_booking_withdrawal',
  'state',CASE WHEN stale_value THEN 'source_stale'
    WHEN value.eligible_count=0 THEN 'unavailable' ELSE 'descriptive_only' END,
  'reason',CASE WHEN stale_value THEN 'source_changed_inside_horizon'
    WHEN value.eligible_count=0 THEN 'insufficient_history' ELSE NULL END,
  'cutoffAt',public.canonical_forecast_utc_instant(value.cutoff_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(value.horizon_ends_at),
  'capturedAt',public.canonical_forecast_utc_instant(value.captured_at),
  'eligibleCount',CASE WHEN stale_value THEN 0 ELSE value.eligible_count END,
  'cancelledCount',CASE WHEN stale_value THEN 0 ELSE value.cancelled_count END,
  'observedRate',CASE WHEN stale_value OR value.eligible_count=0 THEN NULL ELSE
    trim(trailing '.' FROM trim(trailing '0' FROM
      round(value.cancelled_count::numeric/value.eligible_count::numeric,6)::text)) END,
  'sourceDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.source_digest) END,
  'cohortDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.cohort_digest) END,
  'sourceAuthority','northstar_owner_reviewed_commercial_booking_history',
  'sourceAuthenticated',NOT stale_value,
  'sourceCoverageComplete',FALSE,
  'offPlatformCoverageVerified',FALSE,
  'providerCoverageVerified',FALSE,
  'probabilityCalibrated',FALSE,
  'confidence','unavailable',
  'forecastIssued',FALSE,
  'paidNumericServing',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_booking_cancellation_cohort_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
 existing public.canonical_forecast_booking_cancellation_cohorts%ROWTYPE;
 inserted public.canonical_forecast_booking_cancellation_cohorts%ROWTYPE;
 key_hash TEXT;request_hash TEXT;members JSONB;source_hash TEXT;cohort_hash TEXT;
 nonce UUID;eligible INTEGER;cancelled INTEGER;high_water BIGINT;stale_value BOOLEAN;
 corrected_count INTEGER;bounded_count INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  cutoff_value IS NULL OR horizon_value IS NULL OR horizon_value<=cutoff_value OR
  horizon_value>clock_timestamp() OR horizon_value-cutoff_value<INTERVAL '1 hour' OR
  horizon_value-cutoff_value>INTERVAL '90 days' OR key_value IS NULL OR
  key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Booking cancellation cohort input invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value))::text,'UTF8')),'hex');
 -- Identical in-flight requests serialize here. The route transaction applies
 -- a bounded lock_timeout, so the waiter either observes the committed receipt
 -- and replays it or receives a bounded busy response.
 PERFORM pg_advisory_xact_lock(hashtextextended(
   'm26:booking-cancellation-cohort:'||org::text||':'||actor::text||':'||key_hash,0));
 -- Take the source lock before both replay currentness and new calculation.
 -- Because READ COMMITTED refreshes subsequent statement snapshots, a writer
 -- that committed before this try-lock is visible below; an in-flight writer
 -- makes this request fail busy without returning authenticated old numerics.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO existing
 FROM public.canonical_forecast_booking_cancellation_cohorts
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Booking cancellation cohort replay changed' USING ERRCODE='23505';
  END IF;
  SELECT EXISTS(
   SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews review
   WHERE review.organization_id=org
    AND review.review_order>existing.source_high_water_order
    AND review.reviewed_at<=existing.horizon_ends_at) INTO stale_value;
  RETURN jsonb_build_object('cohort',
   public.canonical_forecast_booking_cancellation_cohort_projection(existing,stale_value),
   'replayed',TRUE);
 END IF;
 SELECT COALESCE(MAX(review_order),0) INTO high_water
 FROM public.canonical_forecast_commercial_booking_reviews
 WHERE organization_id=org;
 IF high_water>9007199254740991 THEN
  RAISE EXCEPTION 'Commercial booking source exceeds safe order size' USING ERRCODE='54000';
 END IF;
 WITH firsts AS MATERIALIZED (
  SELECT review.appointment_id,review.id first_review_id,
   review.review_order first_review_order,review.reviewed_at first_reviewed_at
  FROM public.canonical_forecast_commercial_booking_reviews review
  WHERE review.organization_id=org AND review.action='first_booking_reviewed'
   AND review.reviewed_at<=cutoff_value
 ), eligible_rows AS MATERIALIZED (
  SELECT firsts.*,
   (SELECT latest.id FROM public.canonical_forecast_commercial_booking_reviews latest
    WHERE latest.organization_id=org AND latest.appointment_id=firsts.appointment_id
     AND latest.reviewed_at<=cutoff_value
    ORDER BY latest.review_order DESC LIMIT 1) as_of_review_id,
   (SELECT latest.review_order FROM public.canonical_forecast_commercial_booking_reviews latest
    WHERE latest.organization_id=org AND latest.appointment_id=firsts.appointment_id
     AND latest.reviewed_at<=cutoff_value
    ORDER BY latest.review_order DESC LIMIT 1) as_of_review_order,
   (SELECT cancellation.id FROM public.canonical_forecast_commercial_booking_reviews cancellation
    WHERE cancellation.organization_id=org
     AND cancellation.appointment_id=firsts.appointment_id
     AND cancellation.action='booking_cancelled'
     AND cancellation.reviewed_at>cutoff_value
     AND cancellation.reviewed_at<=horizon_value
    ORDER BY cancellation.review_order LIMIT 1) cancellation_review_id,
   (SELECT cancellation.review_order FROM public.canonical_forecast_commercial_booking_reviews cancellation
    WHERE cancellation.organization_id=org
     AND cancellation.appointment_id=firsts.appointment_id
     AND cancellation.action='booking_cancelled'
     AND cancellation.reviewed_at>cutoff_value
     AND cancellation.reviewed_at<=horizon_value
    ORDER BY cancellation.review_order LIMIT 1) cancellation_review_order,
   (SELECT cancellation.reviewed_at FROM public.canonical_forecast_commercial_booking_reviews cancellation
    WHERE cancellation.organization_id=org
     AND cancellation.appointment_id=firsts.appointment_id
     AND cancellation.action='booking_cancelled'
     AND cancellation.reviewed_at>cutoff_value
     AND cancellation.reviewed_at<=horizon_value
    ORDER BY cancellation.review_order LIMIT 1) cancelled_at
  FROM firsts
  WHERE NOT EXISTS(
   SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews prior_cancel
   WHERE prior_cancel.organization_id=org
    AND prior_cancel.appointment_id=firsts.appointment_id
    AND prior_cancel.action='booking_cancelled'
    AND prior_cancel.reviewed_at<=cutoff_value)
 ), bounded AS (
  SELECT * FROM eligible_rows ORDER BY appointment_id LIMIT 501
 )
 SELECT count(*)::integer,
  COALESCE(jsonb_agg(jsonb_build_object(
   'appointmentId',appointment_id,
   'firstBookingReviewId',first_review_id,
   'firstBookingReviewOrder',first_review_order,
   'firstBookedAt',public.canonical_forecast_utc_instant(first_reviewed_at),
   'asOfReviewId',as_of_review_id,
   'asOfReviewOrder',as_of_review_order,
   'cancellationReviewId',cancellation_review_id,
   'cancellationReviewOrder',cancellation_review_order,
   'cancelledAt',public.canonical_forecast_utc_instant(cancelled_at))
   ORDER BY appointment_id),'[]'::jsonb),
  count(cancellation_review_id)::integer
 INTO bounded_count,members,cancelled FROM bounded;
 IF bounded_count>500 OR octet_length(members::text)>262144 THEN
  RAISE EXCEPTION 'Booking cancellation cohort exceeds bounded size' USING ERRCODE='54000';
 END IF;
 SELECT count(*)::integer INTO corrected_count
 FROM public.canonical_forecast_commercial_booking_reviews correction
 WHERE correction.organization_id=org AND correction.action='booking_corrected'
  AND correction.reviewed_at>cutoff_value AND correction.reviewed_at<=horizon_value
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(members) member
   WHERE (member->>'appointmentId')::uuid=correction.appointment_id);
 IF corrected_count>0 THEN
  RETURN jsonb_build_object('state','source_changed_inside_horizon',
   'replayed',FALSE,'sourceAuthenticated',FALSE,
   'sourceCoverageComplete',FALSE,'offPlatformCoverageVerified',FALSE,
   'providerCoverageVerified',FALSE,'probabilityCalibrated',FALSE,
   'confidence','unavailable',
   'forecastIssued',FALSE,'paidNumericServing',FALSE);
 END IF;
 eligible:=bounded_count;
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'sourceAuthority','northstar_owner_reviewed_commercial_booking_history',
  'organizationId',org,'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value),
  'sourceHighWaterOrder',high_water,'members',members));
 nonce:=gen_random_uuid();
 cohort_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-commercial-booking-withdrawal-cohort-v1','organizationId',org,
  'sourceDigest',source_hash,'digestNonce',nonce,
  'eligibleCount',eligible,'cancelledCount',cancelled));
 INSERT INTO public.canonical_forecast_booking_cancellation_cohorts(
  organization_id,cutoff_at,horizon_ends_at,source_high_water_order,
  member_receipts,eligible_count,cancelled_count,source_digest,digest_nonce,
  cohort_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,cutoff_value,horizon_value,high_water,members,eligible,cancelled,
  source_hash,nonce,cohort_hash,actor,(authority->>'membershipId')::uuid,
  session_value,key_hash,request_hash)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('cohort',
  public.canonical_forecast_booking_cancellation_cohort_projection(inserted,FALSE),
  'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_booking_cancellation_cohort_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,cohort_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_forecast_booking_cancellation_cohorts%ROWTYPE;
 stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for booking cancellation cohort read'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO value
 FROM public.canonical_forecast_booking_cancellation_cohorts
 WHERE organization_id=org AND id=cohort_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','unavailable','reason','cohort_not_found',
   'sourceAuthenticated',FALSE,'sourceCoverageComplete',FALSE,
   'probabilityCalibrated',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE);
 END IF;
 SELECT EXISTS(
  SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews review
  WHERE review.organization_id=org
   AND review.review_order>value.source_high_water_order
   AND review.reviewed_at<=value.horizon_ends_at) INTO stale_value;
 RETURN public.canonical_forecast_booking_cancellation_cohort_projection(
  value,stale_value);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_booking_cancellation_cohorts FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_cancellation_cohort_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_cancellation_cohort_projection(
 public.canonical_forecast_booking_cancellation_cohorts,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_cancellation_cohort_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_cancellation_cohort_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booking_cancellation_cohort_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booking_cancellation_cohort_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
