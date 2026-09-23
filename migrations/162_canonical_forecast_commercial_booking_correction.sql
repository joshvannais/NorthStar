-- Mission 26 Part 6A: explicit owner/admin re-review of the same work after
-- accepted scope, reviewed price or human scheduling evidence changes.
-- This is a new commercial attestation, never an edit to Mission 22 or 24.
CREATE FUNCTION public.canonical_forecast_correct_booking_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,prior_value UUID,
 approval_value UUID,reason_value TEXT,key_value TEXT,csrf TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 latest public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 existing public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 inserted public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 pair JSONB; price JSONB; position JSONB; assignment RECORD;
 key_hash TEXT; request_hash TEXT; pinned_order BIGINT;
 acceptance RECORD; observed_count INT:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  prior_value IS NULL OR approval_value IS NULL OR
  reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
  octet_length(reason_value)>4000 OR key_value IS NULL OR
  key_value !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Booking correction input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 -- The pair takes the tenant commercial source lock; replay and all source
 -- checks below remain ordered with acceptance and scheduling sources.
 pair:=public.canonical_forecast_acceptance_booking_pair(
  org,actor,role_value,session_value,approval_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'action','booking_corrected','priorReviewId',prior_value,
  'approvalId',approval_value,'reason',btrim(reason_value))::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.action<>'booking_corrected' OR
   existing.previous_review_id IS DISTINCT FROM prior_value OR
   existing.approval_id IS DISTINCT FROM approval_value OR
   existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Booking correction replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('id',existing.id,'state','booking_corrected',
   'previousReviewId',prior_value,'replayed',TRUE,
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND id=prior_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','prior_review_unavailable','replayed',FALSE,
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO latest FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND appointment_id=prior.appointment_id
  ORDER BY review_order DESC LIMIT 1;
 IF latest.id IS DISTINCT FROM prior.id OR prior.action='booking_cancelled' THEN
  RETURN jsonb_build_object('state','prior_review_stale_or_cancelled',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 IF pair->>'state'<>'ordered_same_opportunity_candidate' OR
  pair->'linkRevokedBeforeApproval'='true'::jsonb OR
  pair->'linkRevokedAfterApproval'='true'::jsonb OR
  pair->>'appointmentId' IS DISTINCT FROM prior.appointment_id::text OR
  pair->>'opportunityId' IS DISTINCT FROM prior.opportunity_id::text THEN
  RETURN jsonb_build_object('state','corrected_lineage_unavailable',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT source_order INTO pinned_order
  FROM public.canonical_forecast_commercial_booking_orders
  WHERE organization_id=org
   AND delivery_event_id=(pair->>'acceptanceId')::uuid;
 IF pinned_order IS NULL THEN
  RETURN jsonb_build_object('state','acceptance_order_unavailable',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 FOR acceptance IN
  SELECT estimate.opportunity_id
  FROM public.canonical_forecast_commercial_booking_orders later
  JOIN public.canonical_customer_estimate_delivery_events event
   ON event.organization_id=later.organization_id
    AND event.id=later.delivery_event_id AND event.kind='accepted'
  JOIN public.canonical_estimates estimate
   ON estimate.organization_id=event.organization_id
    AND estimate.id=event.estimate_id
  WHERE later.organization_id=org
   AND later.source_kind='customer_estimate_acceptance'
   AND later.source_order>pinned_order
  ORDER BY later.source_order LIMIT 1001
 LOOP
  observed_count:=observed_count+1;
  IF observed_count>1000 THEN
   RETURN jsonb_build_object('state','acceptance_history_exceeds_bound',
    'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
  END IF;
  IF acceptance.opportunity_id=prior.opportunity_id THEN
   RETURN jsonb_build_object('state','later_accepted_response_unreviewed',
    'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
  END IF;
 END LOOP;
 price:=public.canonical_forecast_booked_price_candidate(
  org,actor,role_value,session_value,approval_value);
 position:=public.canonical_forecast_booking_status_position(
  org,actor,role_value,session_value,approval_value);
 SELECT last_human_approval_id,schedule_state,appointment_status INTO assignment
  FROM public.canonical_schedule_assignments
  WHERE organization_id=org AND appointment_id=prior.appointment_id;
 IF price->>'state'<>'reviewed_price_candidate' OR
  position->>'state'<>'observed_schedule_position' OR
  position->>'latestObservedApprovalId' IS DISTINCT FROM approval_value::text OR
  position->>'latestScheduleState'<>'scheduled' OR
  position->>'latestAppointmentStatus' NOT IN ('preferred','scheduled') OR
  assignment.last_human_approval_id IS DISTINCT FROM approval_value OR
  assignment.schedule_state IS DISTINCT FROM 'scheduled' OR
  assignment.appointment_status IS DISTINCT FROM
   position->>'latestAppointmentStatus' THEN
  RETURN jsonb_build_object('state','current_booking_evidence_unavailable',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_commercial_booking_reviews(
  organization_id,appointment_id,opportunity_id,approval_id,acceptance_id,
  estimate_id,issued_version_id,approved_decision_id,approved_decision_digest,
  reviewed_price_before_tax,currency,action,previous_review_id,reason,
  actor_user_id,auth_session_id,request_key_hash,request_digest,review_order)
 VALUES(org,prior.appointment_id,prior.opportunity_id,approval_value,
  (pair->>'acceptanceId')::uuid,(pair->>'estimateId')::uuid,
  (pair->>'issuedVersionId')::uuid,(pair->>'approvedDecisionId')::uuid,
  pair->>'approvedDecisionDigest',price->>'priceBeforeTax',price->>'currency',
  'booking_corrected',prior.id,btrim(reason_value),actor,session_value,
  key_hash,request_hash,
  nextval('public.canonical_forecast_commercial_review_sequence'))
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('id',inserted.id,'state','booking_corrected',
  'previousReviewId',prior.id,'replayed',FALSE,
  'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_correct_booking_review(
 UUID,UUID,TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_correct_booking_review(
  UUID,UUID,TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT) TO northstar_app_runtime;
END IF;END $$;
