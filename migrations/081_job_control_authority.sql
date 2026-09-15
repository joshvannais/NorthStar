-- Job-level controls belong to a direct assignee or the current crew lead by
-- default. Individual crew members retain their separately projected field
-- evidence rights. An owner may delegate job control through the active
-- Business Profile without changing crew membership.

CREATE OR REPLACE FUNCTION public.canonical_job_control_authority(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID,
  csrf_token_value TEXT,
  mutation_value BOOLEAN,
  appointment_id_value UUID,
  execution_id_value UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  authority JSONB;
  actor_profile_id_value UUID;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  profile_document JSONB;
  policy_value TEXT;
  crew_role_value TEXT;
  delegated_value BOOLEAN:=FALSE;
  allowed_value BOOLEAN:=FALSE;
  basis_value TEXT:='unavailable';
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable')
     OR organization_id_value IS NULL OR actor_user_id_value IS NULL
     OR actor_access_role_value IS NULL OR auth_session_id_value IS NULL
     OR mutation_value IS NULL
     OR ((appointment_id_value IS NULL)=(execution_id_value IS NULL)) THEN
    RAISE EXCEPTION 'Job control authority input is invalid'
      USING ERRCODE='22023',CONSTRAINT='canonical_job_control_input_invalid';
  END IF;

  authority:=public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,csrf_token_value,mutation_value
  );
  actor_profile_id_value:=(authority->>'profileId')::UUID;

  IF appointment_id_value IS NOT NULL THEN
    SELECT assignment.* INTO assignment_record
      FROM public.canonical_schedule_assignments assignment
     WHERE assignment.organization_id=organization_id_value
       AND assignment.appointment_id=appointment_id_value
       AND assignment.target_state='assigned'
     ORDER BY assignment.updated_at DESC,assignment.id DESC
     LIMIT 1;
  ELSE
    SELECT assignment.* INTO assignment_record
      FROM public.canonical_field_executions execution
      JOIN public.canonical_schedule_assignments assignment
        ON assignment.organization_id=execution.organization_id
       AND assignment.id=execution.assignment_id
     WHERE execution.organization_id=organization_id_value
       AND execution.id=execution_id_value;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job control authority was not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_job_control_not_found';
  END IF;

  SELECT active_profile.raw_profile INTO profile_document
    FROM public.canonical_business_profiles active_profile
   WHERE active_profile.organization_id=organization_id_value
     AND active_profile.is_active=TRUE
   ORDER BY active_profile.version_number DESC,active_profile.id
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job control Business Profile was not found'
      USING ERRCODE='42501',CONSTRAINT='canonical_job_control_profile_unavailable';
  END IF;

  policy_value:=COALESCE(
    profile_document#>>'{workforce,jobControlPolicy}',
    'direct_assignee_or_crew_lead'
  );
  IF assignment_record.workforce_profile_id=actor_profile_id_value THEN
    allowed_value:=TRUE;
    basis_value:='direct_assignee';
  ELSIF assignment_record.workforce_crew_id IS NOT NULL THEN
    SELECT member.crew_role INTO crew_role_value
      FROM public.workforce_crew_members member
     WHERE member.organization_id=organization_id_value
       AND member.crew_id=assignment_record.workforce_crew_id
       AND member.profile_id=actor_profile_id_value;
    IF FOUND AND crew_role_value='lead' THEN
      allowed_value:=TRUE;
      basis_value:='crew_lead';
    ELSIF FOUND THEN
      SELECT EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(profile_document#>'{workforce,jobControlDelegatedProfileIds}')='array'
              THEN profile_document#>'{workforce,jobControlDelegatedProfileIds}' ELSE '[]'::jsonb END
          ) delegated(profile_id)
         WHERE delegated.profile_id=actor_profile_id_value::TEXT
      ) INTO delegated_value;
      IF delegated_value THEN
        allowed_value:=TRUE;
        basis_value:='owner_delegation';
      ELSE
        basis_value:='crew_member';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed',allowed_value,
    'basis',basis_value,
    'policy',policy_value,
    'profileId',actor_profile_id_value,
    'appointmentId',assignment_record.appointment_id,
    'assignmentId',assignment_record.id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.canonical_job_control_authority(
  UUID,UUID,TEXT,UUID,TEXT,BOOLEAN,UUID,UUID
) FROM PUBLIC;
