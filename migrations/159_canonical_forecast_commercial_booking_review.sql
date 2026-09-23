-- Mission 26 Part 6A: an owner/admin may explicitly review a first booking.
-- This post-installation attestation is not proof of historical completeness,
-- an off-platform booking, earned revenue, cash, or a forecast.
CREATE SEQUENCE public.canonical_forecast_commercial_review_sequence AS BIGINT;

CREATE TABLE public.canonical_forecast_commercial_booking_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 appointment_id UUID NOT NULL,
 opportunity_id UUID NOT NULL,
 approval_id UUID NOT NULL,
 acceptance_id UUID NOT NULL REFERENCES public.canonical_customer_estimate_delivery_events(id) ON DELETE RESTRICT,
 estimate_id UUID NOT NULL,
 issued_version_id UUID NOT NULL,
 approved_decision_id UUID NOT NULL,
 approved_decision_digest TEXT NOT NULL CHECK(approved_decision_digest ~ '^[a-f0-9]{64}$'),
 reviewed_price_before_tax TEXT NOT NULL CHECK(reviewed_price_before_tax ~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'),
 currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 action TEXT NOT NULL CHECK(action='first_booking_reviewed'),
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash ~ '^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 review_order BIGINT NOT NULL CHECK(review_order>0),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,appointment_id,review_order),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,appointment_id,action),
 FOREIGN KEY(organization_id,appointment_id)
  REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,approval_id)
  REFERENCES public.canonical_schedule_human_approvals(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id,issued_version_id)
  REFERENCES public.canonical_customer_estimate_versions(organization_id,estimate_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_commercial_booking_reviews_tenant_appointment
 ON public.canonical_forecast_commercial_booking_reviews(organization_id,appointment_id,review_order DESC);

CREATE FUNCTION public.canonical_forecast_commercial_booking_review_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Commercial booking reviews are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_commercial_booking_review_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_commercial_booking_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_commercial_booking_review_immutable();

CREATE FUNCTION public.canonical_forecast_review_first_booking(
 org UUID,actor UUID,role_value TEXT,session_value UUID,approval_value UUID,
 reason_value TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pair JSONB; price JSONB; position JSONB; assignment RECORD;
 existing public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 inserted public.canonical_forecast_commercial_booking_reviews%ROWTYPE;
 key_hash TEXT; request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
  octet_length(reason_value)>4000 OR key_value IS NULL OR
  key_value !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'First booking review input invalid' USING ERRCODE='22023';
 END IF;
 -- The pair authenticates the paid owner/admin/session and holds the shared
 -- commercial lock. All following checks and the insert occur under it.
 pair:=public.canonical_forecast_acceptance_booking_pair(
  org,actor,role_value,session_value,approval_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'approvalId',approval_value,'reason',btrim(reason_value))::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'First booking review replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('id',existing.id,'state','first_booking_reviewed',
   'replayed',TRUE,'historicalCoverageVerified',FALSE,
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 IF pair->>'state'<>'ordered_same_opportunity_candidate' OR
  pair->'linkRevokedBeforeApproval'='true'::jsonb OR
  pair->'linkRevokedAfterApproval'='true'::jsonb THEN
  RETURN jsonb_build_object('state','lineage_unavailable','replayed',FALSE,
   'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 -- A customer can accept a newer issued scope after the paired schedule
 -- approval. The pair reader intentionally proves only earlier acceptance;
 -- the human review must also reject a competing later accepted response.
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
    AND pinned.delivery_event_id=(pair->>'acceptanceId')::uuid
  WHERE later.organization_id=org
   AND later.source_kind='customer_estimate_acceptance'
   AND later.source_order>pinned.source_order
   AND estimate.opportunity_id=(pair->>'opportunityId')::uuid
 ) THEN
  RETURN jsonb_build_object('state','later_accepted_response_unreviewed',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 price:=public.canonical_forecast_booked_price_candidate(
  org,actor,role_value,session_value,approval_value);
 position:=public.canonical_forecast_booking_status_position(
  org,actor,role_value,session_value,approval_value);
 SELECT last_human_approval_id,schedule_state,appointment_status INTO assignment
  FROM public.canonical_schedule_assignments
  WHERE organization_id=org AND appointment_id=(pair->>'appointmentId')::uuid;
 IF price->>'state'<>'reviewed_price_candidate' OR
  position->>'state'<>'observed_schedule_position' OR
  position->>'latestObservedApprovalId'<>approval_value::text OR
  position->>'latestScheduleState'<>'scheduled' OR
  position->>'latestAppointmentStatus' NOT IN ('preferred','scheduled') OR
  assignment.last_human_approval_id IS DISTINCT FROM approval_value OR
  assignment.schedule_state<>'scheduled' OR
  assignment.appointment_status IS DISTINCT FROM
   position->>'latestAppointmentStatus' THEN
  RETURN jsonb_build_object('state','current_booking_evidence_unavailable',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org AND appointment_id=(pair->>'appointmentId')::uuid) THEN
  RETURN jsonb_build_object('state','prior_commercial_review_exists',
   'replayed',FALSE,'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_commercial_booking_reviews(
  organization_id,appointment_id,opportunity_id,approval_id,acceptance_id,
  estimate_id,issued_version_id,approved_decision_id,approved_decision_digest,
  reviewed_price_before_tax,currency,action,reason,actor_user_id,
  auth_session_id,request_key_hash,request_digest,review_order)
 VALUES(org,(pair->>'appointmentId')::uuid,(pair->>'opportunityId')::uuid,
  approval_value,(pair->>'acceptanceId')::uuid,(pair->>'estimateId')::uuid,
  (pair->>'issuedVersionId')::uuid,(pair->>'approvedDecisionId')::uuid,
  pair->>'approvedDecisionDigest',price->>'priceBeforeTax',price->>'currency',
  'first_booking_reviewed',btrim(reason_value),actor,session_value,key_hash,
  request_hash,nextval('public.canonical_forecast_commercial_review_sequence'))
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('id',inserted.id,'state','first_booking_reviewed',
  'replayed',FALSE,'historicalCoverageVerified',FALSE,
  'bookedWorkVerified',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON SEQUENCE public.canonical_forecast_commercial_review_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_commercial_booking_reviews FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_commercial_booking_review_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_review_first_booking(
 UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_review_first_booking(
  UUID,UUID,TEXT,UUID,UUID,TEXT,TEXT) TO northstar_app_runtime;
END IF;END $$;
