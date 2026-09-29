-- Mission 26 Part 6A: post-installation scheduling status around a guarded
-- accepted-estimate/approval pair. This is not a commercial booking decision.
CREATE INDEX canonical_forecast_booking_approval_orders_tenant_appointment_idx
 ON public.canonical_forecast_booking_approval_orders(
  organization_id,appointment_id,source_order);

CREATE FUNCTION public.canonical_forecast_booking_status_position(
 org UUID,actor UUID,role_value TEXT,session_value UUID,approval_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pair JSONB; target_order BIGINT; event_row RECORD;
 first_id UUID; first_action TEXT; latest_id UUID; latest_action TEXT;
 latest_schedule TEXT; latest_appointment TEXT;
 observed_count INT:=0; later_count INT:=0;
BEGIN
 -- Pair authenticates paid tenant/owner/admin/session and holds the shared
 -- commercial order lock through this read. It requires READ COMMITTED.
 pair:=public.canonical_forecast_acceptance_booking_pair(
  org,actor,role_value,session_value,approval_value);
 IF pair->>'state'<>'ordered_same_opportunity_candidate' THEN
  RETURN jsonb_build_object('state','lineage_unavailable',
   'lineageState',pair->>'state','bookingStatusVerified',FALSE,
   'sourceComplete',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT source_order INTO target_order
  FROM public.canonical_forecast_booking_approval_orders
  WHERE organization_id=org AND approval_id=approval_value
   AND appointment_id=(pair->>'appointmentId')::uuid;
 IF target_order IS NULL THEN
  RETURN jsonb_build_object('state','approval_order_unavailable',
   'bookingStatusVerified',FALSE,'sourceComplete',FALSE,'forecastIssued',FALSE);
 END IF;
 -- This appointment-indexed scan stops after 1001 rows. It never counts the
 -- entire tenant's event table to decide whether the bounded read is safe.
 FOR event_row IN
  SELECT source.source_order,approval.id,approval.action_code,
   approval.resulting_schedule_state,approval.approved_appointment_status
  FROM public.canonical_forecast_booking_approval_orders source
  JOIN public.canonical_schedule_human_approvals approval
   ON approval.organization_id=source.organization_id
    AND approval.id=source.approval_id
  WHERE source.organization_id=org
   AND source.appointment_id=(pair->>'appointmentId')::uuid
  ORDER BY source.source_order LIMIT 1001
 LOOP
  observed_count:=observed_count+1;
  IF observed_count>1000 THEN
   RETURN jsonb_build_object('state','history_exceeds_bound',
    'bookingStatusVerified',FALSE,'sourceComplete',FALSE,'forecastIssued',FALSE);
  END IF;
  IF first_id IS NULL THEN first_id:=event_row.id;
   first_action:=event_row.action_code;END IF;
  latest_id:=event_row.id;latest_action:=event_row.action_code;
  latest_schedule:=event_row.resulting_schedule_state;
  latest_appointment:=event_row.approved_appointment_status;
  IF event_row.source_order>target_order THEN later_count:=later_count+1;END IF;
 END LOOP;
 RETURN jsonb_build_object('state','observed_schedule_position',
  'appointmentId',pair->>'appointmentId','opportunityId',pair->>'opportunityId',
  'pairedApprovalId',approval_value,
  'firstObservedApprovalId',first_id,
  'firstObservedAction',first_action,
  'latestObservedApprovalId',latest_id,
  'latestObservedAction',latest_action,
  'latestScheduleState',latest_schedule,
  'latestAppointmentStatus',latest_appointment,
  'observedApprovalCount',observed_count,
  'laterApprovalCount',later_count,
  'firstActualBookingKnown',FALSE,'bookingStatusVerified',FALSE,
  'sourceComplete',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_status_position(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booking_status_position(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
