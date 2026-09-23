-- Mission 26 Part 6A: read-time currentness of one recorded human review.
-- This guarded diagnostic does not emit booked-work value or a forecast.
CREATE FUNCTION public.canonical_forecast_commercial_review_currentness(
 org UUID,actor UUID,role_value TEXT,session_value UUID,review_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reviewed public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 pair JSONB; price JSONB; position JSONB; assignment RECORD;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for booking review currentness'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO reviewed FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND id=review_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','review_unavailable',
   'reviewCurrentAtRead',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews later
  WHERE later.organization_id=org AND later.appointment_id=reviewed.appointment_id
   AND later.review_order>reviewed.review_order) THEN
  RETURN jsonb_build_object('state','later_review_exists',
   'reviewCurrentAtRead',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 -- The pair takes this tenant commercial lock again and authenticates the
 -- immutable accepted version and scheduling approval. Missing/ambiguous
 -- source evidence never becomes zero booked work.
 pair:=public.canonical_forecast_acceptance_booking_pair(
  org,actor,role_value,session_value,reviewed.approval_id);
 IF pair->>'state'<>'ordered_same_opportunity_candidate' OR
  pair->>'acceptanceId' IS DISTINCT FROM reviewed.acceptance_id::text OR
  pair->>'issuedVersionId' IS DISTINCT FROM reviewed.issued_version_id::text OR
  pair->>'approvedDecisionId' IS DISTINCT FROM reviewed.approved_decision_id::text OR
  pair->>'approvedDecisionDigest' IS DISTINCT FROM reviewed.approved_decision_digest OR
  pair->>'appointmentId' IS DISTINCT FROM reviewed.appointment_id::text OR
  pair->>'opportunityId' IS DISTINCT FROM reviewed.opportunity_id::text OR
  pair->'linkRevokedBeforeApproval'='true'::jsonb OR
  pair->'linkRevokedAfterApproval'='true'::jsonb THEN
  RETURN jsonb_build_object('state','review_lineage_stale_or_unavailable',
   'reviewCurrentAtRead',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 IF EXISTS(
  SELECT 1 FROM public.canonical_forecast_commercial_booking_orders later
  JOIN public.canonical_customer_estimate_delivery_events event
   ON event.organization_id=later.organization_id
    AND event.id=later.delivery_event_id AND event.kind='accepted'
  JOIN public.canonical_estimates estimate
   ON estimate.organization_id=event.organization_id
    AND estimate.id=event.estimate_id
  JOIN public.canonical_forecast_commercial_booking_orders pinned
   ON pinned.organization_id=later.organization_id
    AND pinned.delivery_event_id=reviewed.acceptance_id
  WHERE later.organization_id=org
   AND later.source_kind='customer_estimate_acceptance'
   AND later.source_order>pinned.source_order
   AND estimate.opportunity_id=reviewed.opportunity_id
 ) THEN
  RETURN jsonb_build_object('state','later_accepted_response_unreviewed',
   'reviewCurrentAtRead',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 -- Price read adds the M24 decision lock after the commercial source lock.
 price:=public.canonical_forecast_booked_price_candidate(
  org,actor,role_value,session_value,reviewed.approval_id);
 IF price->>'state'<>'reviewed_price_candidate' OR
  price->>'priceBeforeTax' IS DISTINCT FROM reviewed.reviewed_price_before_tax OR
  price->>'currency' IS DISTINCT FROM reviewed.currency THEN
  RETURN jsonb_build_object('state','review_price_stale_or_unavailable',
   'reviewCurrentAtRead',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 position:=public.canonical_forecast_booking_status_position(
  org,actor,role_value,session_value,reviewed.approval_id);
 SELECT last_human_approval_id,schedule_state,appointment_status INTO assignment
  FROM public.canonical_schedule_assignments
  WHERE organization_id=org AND appointment_id=reviewed.appointment_id;
 IF position->>'state'<>'observed_schedule_position' OR
  position->>'latestObservedApprovalId' IS DISTINCT FROM reviewed.approval_id::text OR
  position->>'latestScheduleState'<>'scheduled' OR
  position->>'latestAppointmentStatus' NOT IN ('preferred','scheduled') OR
  assignment.last_human_approval_id IS DISTINCT FROM reviewed.approval_id OR
  assignment.schedule_state IS DISTINCT FROM 'scheduled' OR
  assignment.appointment_status IS DISTINCT FROM
   position->>'latestAppointmentStatus' THEN
  RETURN jsonb_build_object('state','review_schedule_stale_or_unavailable',
   'reviewCurrentAtRead',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','review_evidence_current_at_read',
  'reviewId',reviewed.id,'appointmentId',reviewed.appointment_id,
  'issuedVersionId',reviewed.issued_version_id,'approvalId',reviewed.approval_id,
  'reviewCurrentAtRead',TRUE,'historicalCoverageVerified',FALSE,
  'firstActualBookingKnown',FALSE,'bookedWorkVerified',FALSE,
  'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_commercial_review_currentness(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_commercial_review_currentness(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
