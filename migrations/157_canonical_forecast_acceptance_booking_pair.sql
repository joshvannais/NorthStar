-- Mission 26 Part 6A: guarded positive lineage candidate, never booked value.
-- The shared post-installation order is necessary but not sufficient for a
-- commercial booking. This reader keeps that distinction explicit.
CREATE FUNCTION public.canonical_forecast_acceptance_booking_pair(
 org UUID,actor UUID,role_value TEXT,session_value UUID,approval_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE approval_order BIGINT; opportunity_value UUID; appointment_value UUID;
 candidate RECORD; candidate_count INT;
 revoked_before_acceptance BOOLEAN; revoked_before BOOLEAN; revoked_after BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for booking lineage' USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT source.source_order,assignment.opportunity_id,approval.appointment_id
  INTO approval_order,opportunity_value,appointment_value
 FROM public.canonical_forecast_commercial_booking_orders source
 JOIN public.canonical_schedule_human_approvals approval
  ON approval.organization_id=source.organization_id AND approval.id=source.approval_id
 JOIN public.canonical_schedule_assignments assignment
  ON assignment.organization_id=approval.organization_id
   AND assignment.id=approval.assignment_id
   AND assignment.appointment_id=approval.appointment_id
 WHERE source.organization_id=org AND source.approval_id=approval_value
  AND source.source_kind='schedule_approval';
 IF approval_order IS NULL THEN
  RETURN jsonb_build_object('state','source_order_unavailable',
   'candidateOnly',TRUE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 -- An accepted issued version must belong to an estimate for the immutable
 -- assignment opportunity. Count at most two: multiple accepted versions
 -- cannot be silently collapsed into one price or booking.
 WITH matches AS (
  SELECT source.source_order AS acceptance_order,event.id AS acceptance_id,
   event.link_id,event.estimate_id,event.version_id,version.decision_id,
   decision.digest AS decision_digest
  FROM public.canonical_forecast_commercial_booking_orders source
  JOIN public.canonical_customer_estimate_delivery_events event
   ON event.organization_id=source.organization_id
    AND event.id=source.delivery_event_id AND event.kind='accepted'
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=event.organization_id
    AND version.estimate_id=event.estimate_id AND version.id=event.version_id
  JOIN public.canonical_estimates estimate
   ON estimate.organization_id=event.organization_id AND estimate.id=event.estimate_id
  JOIN public.canonical_estimate_decisions decision
   ON decision.organization_id=version.organization_id
    AND decision.estimate_id=version.estimate_id AND decision.id=version.decision_id
    AND decision.action='approve'
  WHERE source.organization_id=org AND source.source_kind='customer_estimate_acceptance'
   AND source.source_order<approval_order AND estimate.opportunity_id=opportunity_value
  ORDER BY source.source_order DESC LIMIT 2
 )
 SELECT count(*)::int INTO candidate_count FROM matches;
 IF candidate_count<>1 THEN
  RETURN jsonb_build_object('state',CASE WHEN candidate_count=0 THEN
   'no_ordered_acceptance' ELSE 'ambiguous_accepted_responses' END,
   'appointmentId',appointment_value,'approvalId',approval_value,
   'opportunityId',opportunity_value,
   'candidateOnly',TRUE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT source.source_order AS acceptance_order,event.id AS acceptance_id,
   event.link_id,event.estimate_id,event.version_id,version.decision_id,
   decision.digest AS decision_digest
 INTO candidate
 FROM public.canonical_forecast_commercial_booking_orders source
 JOIN public.canonical_customer_estimate_delivery_events event
  ON event.organization_id=source.organization_id
   AND event.id=source.delivery_event_id AND event.kind='accepted'
 JOIN public.canonical_customer_estimate_versions version
  ON version.organization_id=event.organization_id
   AND version.estimate_id=event.estimate_id AND version.id=event.version_id
 JOIN public.canonical_estimates estimate
  ON estimate.organization_id=event.organization_id AND estimate.id=event.estimate_id
 JOIN public.canonical_estimate_decisions decision
  ON decision.organization_id=version.organization_id
   AND decision.estimate_id=version.estimate_id AND decision.id=version.decision_id
   AND decision.action='approve'
 WHERE source.organization_id=org AND source.source_kind='customer_estimate_acceptance'
  AND source.source_order<approval_order AND estimate.opportunity_id=opportunity_value
 ORDER BY source.source_order DESC LIMIT 1;
 SELECT EXISTS(
  SELECT 1 FROM public.canonical_forecast_commercial_booking_orders source
  JOIN public.canonical_customer_estimate_delivery_events event
   ON event.organization_id=source.organization_id
    AND event.id=source.delivery_event_id
  WHERE source.organization_id=org AND source.source_kind='customer_estimate_link_revocation'
   AND event.link_id=candidate.link_id
   AND source.source_order<candidate.acceptance_order), EXISTS(
  SELECT 1 FROM public.canonical_forecast_commercial_booking_orders source
  JOIN public.canonical_customer_estimate_delivery_events event
   ON event.organization_id=source.organization_id
    AND event.id=source.delivery_event_id
  WHERE source.organization_id=org AND source.source_kind='customer_estimate_link_revocation'
   AND event.link_id=candidate.link_id
   AND source.source_order<approval_order), EXISTS(
  SELECT 1 FROM public.canonical_forecast_commercial_booking_orders source
  JOIN public.canonical_customer_estimate_delivery_events event
   ON event.organization_id=source.organization_id
    AND event.id=source.delivery_event_id
  WHERE source.organization_id=org AND source.source_kind='customer_estimate_link_revocation'
   AND event.link_id=candidate.link_id AND source.source_order>approval_order)
 INTO revoked_before_acceptance,revoked_before,revoked_after;
 IF revoked_before THEN
  RETURN jsonb_build_object(
   'state','accepted_link_revoked_before_approval',
   'appointmentId',appointment_value,'approvalId',approval_value,
   'opportunityId',opportunity_value,'acceptancePrecedesApproval',TRUE,
   'acceptanceId',candidate.acceptance_id,
   'estimateId',candidate.estimate_id,'issuedVersionId',candidate.version_id,
   'approvedDecisionId',candidate.decision_id,
   'approvedDecisionDigest',candidate.decision_digest,
   'decisionCurrentnessVerified',FALSE,
   'linkRevokedBeforeAcceptance',revoked_before_acceptance,
   'linkRevokedBeforeApproval',TRUE,
   'linkRevokedAfterApproval',revoked_after,
   'candidateOnly',TRUE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object(
  'state','ordered_same_opportunity_candidate',
  'appointmentId',appointment_value,'approvalId',approval_value,
  'opportunityId',opportunity_value,'acceptancePrecedesApproval',TRUE,
  'acceptanceId',candidate.acceptance_id,
  'estimateId',candidate.estimate_id,'issuedVersionId',candidate.version_id,
  'approvedDecisionId',candidate.decision_id,
  'approvedDecisionDigest',candidate.decision_digest,
  'decisionCurrentnessVerified',FALSE,
  'linkRevokedBeforeAcceptance',FALSE,
  'linkRevokedBeforeApproval',revoked_before,
  'linkRevokedAfterApproval',revoked_after,
  'candidateOnly',TRUE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_acceptance_booking_pair(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_acceptance_booking_pair(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
