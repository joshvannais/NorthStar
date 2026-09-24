-- Mission 26 Part 6A: bounded discovery of recent human schedule approvals
-- that may be ready for commercial review. The write remains authoritative.
CREATE FUNCTION public.canonical_forecast_booking_review_candidates(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item RECORD;price JSONB;items JSONB:='[]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for booking candidates' USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 FOR item IN
  WITH recent AS MATERIALIZED (
   SELECT source.organization_id,source.approval_id,source.appointment_id,
    source.source_order
   FROM public.canonical_forecast_booking_approval_orders source
   WHERE source.organization_id=org
   ORDER BY source.source_order DESC LIMIT 100
  )
  SELECT recent.approval_id,recent.appointment_id,
   assignment.scheduled_start,assignment.opportunity_id
  FROM recent
  JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=recent.organization_id
    AND assignment.appointment_id=recent.appointment_id
    AND assignment.last_human_approval_id=recent.approval_id
  WHERE assignment.schedule_state='scheduled'
   AND assignment.appointment_status IN ('preferred','scheduled')
  ORDER BY recent.source_order DESC
 LOOP
  IF EXISTS(SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews review
    WHERE review.organization_id=org AND review.appointment_id=item.appointment_id) THEN
   CONTINUE;
  END IF;
  price:=public.canonical_forecast_booked_price_candidate(
   org,actor,role_value,session_value,item.approval_id);
  IF price->>'state'<>'reviewed_price_candidate' OR
    price->'linkRevokedAfterApproval'='true'::jsonb THEN
   CONTINUE;
  END IF;
  items:=items||jsonb_build_array(jsonb_build_object(
   'appointmentId',item.appointment_id,'approvalId',item.approval_id,
   'opportunityId',item.opportunity_id,
   'scheduledStart',public.canonical_forecast_utc_instant(item.scheduled_start),
   'reviewedPriceBeforeTax',price->>'priceBeforeTax',
   'currency',price->>'currency'));
 END LOOP;
 RETURN jsonb_build_object('state','booking_review_candidates_observed',
  'candidates',items,'candidateCount',jsonb_array_length(items),
  'recentApprovalWindowLimit',100,'recentWindowOnly',TRUE,
  'writeRechecksCurrentness',TRUE,'bookedWorkVerified',FALSE,
  'completePeriodVerified',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_review_candidates(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booking_review_candidates(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF;END $$;
