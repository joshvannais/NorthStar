-- Mission 23 Part 9A: minimum current-worker execution discovery for Today.
-- Read-only projection only. No table grants, lifecycle mutation, owner-wide
-- operational view, provider action, or browser-held authority.

CREATE OR REPLACE FUNCTION public.canonical_field_execution_read_by_appointment(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID,
  appointment_id_value UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  authority JSONB;
  actor_profile_id UUID;
  appointment_status_value TEXT;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  execution_record public.canonical_field_executions%ROWTYPE;
  open_interval_execution_id UUID;
  production_evidence_source BOOLEAN:=FALSE;
  action_values TEXT[]:=ARRAY[]::TEXT[];
  material_kind_values TEXT[]:=ARRAY[]::TEXT[];
  equipment_kind_values TEXT[]:=ARRAY[]::TEXT[];
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
    RAISE EXCEPTION 'Canonical field execution reads require a bounded snapshot'
      USING ERRCODE='25001',CONSTRAINT='canonical_field_execution_snapshot_required';
  END IF;
  IF organization_id_value IS NULL
     OR actor_user_id_value IS NULL
     OR actor_access_role_value IS NULL
     OR actor_access_role_value NOT IN ('owner','admin','member','viewer')
     OR auth_session_id_value IS NULL
     OR appointment_id_value IS NULL THEN
    RAISE EXCEPTION 'Current worker execution lookup input is invalid'
      USING ERRCODE='22023',CONSTRAINT='canonical_field_execution_lookup_input_invalid';
  END IF;

  authority := public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,NULL,FALSE
  );
  actor_profile_id := (authority->>'profileId')::UUID;

  SELECT assignment.* INTO assignment_record
    FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=assignment.organization_id
     AND appointment.id=assignment.appointment_id
     AND appointment.operation_id=assignment.operation_id
     AND appointment.graph_id=assignment.graph_id
     AND appointment.opportunity_id=assignment.opportunity_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=assignment.organization_id
     AND transcript.operation_id=assignment.operation_id
     AND transcript.graph_id=assignment.graph_id
   WHERE assignment.organization_id=organization_id_value
     AND assignment.appointment_id=appointment_id_value
     AND assignment.target_state='assigned'
     AND assignment.schedule_state='scheduled'
     AND assignment.dispatch_state='dispatched'
     AND lower(btrim(assignment.appointment_status))<>'cancelled'
     AND lower(btrim(appointment.status))<>'cancelled'
     AND translate(
       btrim(transcript.source,
         chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
         chr(133) || chr(160) || chr(5760) ||
         chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) ||
         chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) ||
         chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288)),
       'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'
     ) NOT IN ('demo','simulation');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current worker execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;

  SELECT appointment.status INTO appointment_status_value
    FROM public.canonical_appointments appointment
   WHERE appointment.organization_id=assignment_record.organization_id
     AND appointment.id=assignment_record.appointment_id
     AND appointment.operation_id=assignment_record.operation_id
     AND appointment.graph_id=assignment_record.graph_id
     AND appointment.opportunity_id=assignment_record.opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current worker execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;

  IF NOT COALESCE(assignment_record.workforce_profile_id=actor_profile_id,FALSE)
     AND NOT (
       assignment_record.workforce_crew_id IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.workforce_crew_members crew_member
          WHERE crew_member.organization_id=organization_id_value
            AND crew_member.crew_id=assignment_record.workforce_crew_id
            AND crew_member.profile_id=actor_profile_id
       )
     ) THEN
    RAISE EXCEPTION 'Current worker execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;

  SELECT execution.* INTO execution_record
    FROM public.canonical_field_executions execution
   WHERE execution.organization_id=organization_id_value
     AND execution.appointment_id=assignment_record.appointment_id
     AND execution.assignment_id=assignment_record.id
     AND execution.operation_id=assignment_record.operation_id
     AND execution.graph_id=assignment_record.graph_id
     AND execution.opportunity_id=assignment_record.opportunity_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',TRUE,'data','null'::JSONB);
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.canonical_transcripts transcript
     WHERE transcript.organization_id=execution_record.organization_id
       AND transcript.operation_id=execution_record.operation_id
       AND transcript.graph_id=execution_record.graph_id
       AND public.canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice')
  ) INTO production_evidence_source;

  IF actor_access_role_value<>'viewer'
     AND lower(btrim(assignment_record.appointment_status))<>'completed'
     AND lower(btrim(appointment_status_value))<>'completed' THEN
    SELECT interval.execution_id INTO open_interval_execution_id
      FROM public.canonical_labor_intervals interval
     WHERE interval.organization_id=organization_id_value
       AND interval.performer_profile_id=actor_profile_id
       AND interval.observed_end IS NULL
       AND interval.review_state<>'rejected'
     ORDER BY interval.updated_at DESC,interval.id DESC
     LIMIT 1;

    IF execution_record.lifecycle_state='not_started' THEN
      action_values:=ARRAY['start'];
    ELSIF execution_record.lifecycle_state='in_progress' THEN
      action_values:=ARRAY['pause'];
      IF production_evidence_source THEN
        IF open_interval_execution_id IS NULL THEN
          action_values:=action_values||ARRAY['start_timer'];
        ELSIF open_interval_execution_id=execution_record.id THEN
          action_values:=action_values||ARRAY['stop_timer'];
        END IF;
        action_values:=action_values||ARRAY['record_manual','record_material'];
        IF assignment_record.needs_review IS FALSE THEN
          action_values:=action_values||ARRAY['record_equipment'];
        END IF;
        action_values:=action_values||ARRAY[
          'create_checklist','respond_item','record_observation','record_note'
        ];
        IF assignment_record.needs_review IS FALSE THEN
          action_values:=action_values||ARRAY[
            'record_progress','record_blocker','record_exception','record_change'
          ];
        END IF;
        action_values:=action_values||ARRAY['propose_completion'];
        material_kind_values:=ARRAY['consumed','returned','transferred','waste'];
        IF actor_access_role_value IN ('owner','admin') THEN
          material_kind_values:=material_kind_values||ARRAY['adjustment'];
        END IF;
        IF assignment_record.needs_review IS FALSE THEN
          equipment_kind_values:=ARRAY[
            'check_out','use','check_in','reading','condition','fault','downtime_start','downtime_end','maintenance'
          ];
          IF actor_access_role_value IN ('owner','admin') THEN
            equipment_kind_values:=equipment_kind_values||ARRAY['meter_reset'];
          END IF;
        END IF;
      END IF;
    ELSIF execution_record.lifecycle_state='paused' THEN
      action_values:=ARRAY['resume'];
      IF production_evidence_source THEN
        IF open_interval_execution_id=execution_record.id THEN
          action_values:=action_values||ARRAY['stop_timer'];
        END IF;
        action_values:=action_values||ARRAY[
          'create_checklist','respond_item','record_observation','record_note'
        ];
        IF assignment_record.needs_review IS FALSE THEN
          action_values:=action_values||ARRAY[
            'record_progress','record_blocker','record_exception','record_change'
          ];
        END IF;
        action_values:=action_values||ARRAY['propose_completion'];
      END IF;
    ELSIF execution_record.lifecycle_state='reopened' AND production_evidence_source THEN
      action_values:=ARRAY[
        'create_checklist','respond_item','record_observation','record_note','propose_completion'
      ];
    ELSIF execution_record.lifecycle_state='completion_pending' AND production_evidence_source AND EXISTS (
      SELECT 1
        FROM public.canonical_completion_records proposal
       WHERE proposal.organization_id=organization_id_value
         AND proposal.execution_id=execution_record.id
         AND proposal.record_kind='proposal'
         AND proposal.resulting_execution_revision=execution_record.revision
         AND rtrim(proposal.resulting_execution_digest)=rtrim(execution_record.canonical_digest)
         AND (actor_access_role_value IN ('owner','admin') OR proposal.recorded_by_user_id=actor_user_id_value)
         AND NOT EXISTS (
           SELECT 1 FROM public.canonical_completion_records resolution
            WHERE resolution.organization_id=organization_id_value
              AND resolution.related_proposal_id=proposal.id
              AND resolution.record_kind IN ('approval','withdrawal','cancellation')
         )
    ) THEN
      action_values:=ARRAY['withdraw_completion'];
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',TRUE,
    'data',jsonb_build_object(
      'id',execution_record.id,
      'appointmentId',execution_record.appointment_id,
      'lifecycleState',execution_record.lifecycle_state,
      'sourceAssignmentRevision',execution_record.source_assignment_revision,
      'sourceAssignmentDigest',rtrim(execution_record.source_assignment_digest),
      'revision',execution_record.revision,
      'digest',rtrim(execution_record.canonical_digest),
      'actions',to_jsonb(action_values),
      'materialMovementKinds',to_jsonb(material_kind_values),
      'equipmentKinds',to_jsonb(equipment_kind_values)
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.canonical_field_execution_read_by_appointment(
  UUID,UUID,TEXT,UUID,UUID
) FROM PUBLIC;
