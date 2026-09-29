-- Mission 26 Part 6A: current owner-reviewed job price position. This is
-- one post-anchor candidate, not a complete booked-revenue period or forecast.
CREATE FUNCTION public.canonical_forecast_owner_reviewed_booking_position(
 org UUID,actor UUID,role_value TEXT,session_value UUID,review_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value JSONB;
 reviewed public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
BEGIN
 current_value:=public.canonical_forecast_commercial_review_currentness(
  org,actor,role_value,session_value,review_value);
 IF current_value->>'state'<>'review_evidence_current_at_read' THEN
  RETURN jsonb_build_object('state','owner_reviewed_position_unavailable',
   'reason',current_value->>'state','ownerAttestationCurrentAtRead',FALSE,
   'bookedWorkVerified',FALSE,'historicalCoverageVerified',FALSE,
   'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,
   'forecastIssued',FALSE);
 END IF;
 -- Currentness holds the tenant commercial, acceptance, price, and schedule
 -- source locks until this transaction ends. The review row is immutable.
 SELECT * INTO reviewed FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND id=review_value
   AND action IN ('first_booking_reviewed','booking_corrected');
 IF NOT FOUND OR reviewed.reviewed_price_before_tax !~
    '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR
    reviewed.currency !~ '^[A-Z]{3}$' THEN
  RETURN jsonb_build_object('state','owner_reviewed_position_unavailable',
   'reason','review_unavailable','ownerAttestationCurrentAtRead',FALSE,
   'bookedWorkVerified',FALSE,'historicalCoverageVerified',FALSE,
   'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,
   'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','owner_reviewed_booking_candidate',
  'reviewId',reviewed.id,'appointmentId',reviewed.appointment_id,
  'commercialStatus','owner_reviewed_booking',
  'reviewedPriceBeforeTax',reviewed.reviewed_price_before_tax,
  'currency',reviewed.currency,'ownerAttestationCurrentAtRead',TRUE,
  'reviewCurrentAtRead',TRUE,
  'bookedWorkVerified',FALSE,'historicalCoverageVerified',FALSE,
  'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,
  'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_owner_reviewed_booking_position(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_owner_reviewed_booking_position(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
