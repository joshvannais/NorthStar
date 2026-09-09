-- Mission 23 Part 9B: bounded owner/admin operational overview and masked
-- dispatcher coordination. Routine only: no table/data or mutation authority.
-- Preserve the personal/current-crew entry in 053 and all preceding sources.

CREATE FUNCTION public.canonical_operational_overview_read(
  organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
  auth_session_id_value UUID, state_value TEXT, limit_value INTEGER, cursor_value JSONB
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE
  actor JSONB; scope_value TEXT; scope_digest TEXT; data_digest TEXT;
  cutoff TIMESTAMPTZ:=transaction_timestamp(); cutoff_text TEXT;
  last_time TIMESTAMPTZ; last_id UUID; pointer_seen BOOLEAN:=cursor_value IS NULL;
  row_value RECORD; proposal public.canonical_completion_records%ROWTYPE;
  progress_stats RECORD; field_stats RECORD; operational_stats RECORD;
  active_profile RECORD; gate_value JSONB; item JSONB; detail_progress JSONB;
  records JSONB:='[]'::jsonb; next_cursor JSONB; result_value JSONB;
  approval_state TEXT; evidence_state TEXT; assignment_current BOOLEAN;
  total_value BIGINT:=0; offset_value BIGINT:=0; last_returned_time TEXT; last_returned_id UUID;
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable')
     OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION 'A bounded read-only snapshot is required'
      USING ERRCODE='25000',CONSTRAINT='canonical_operational_overview_snapshot_required';
  END IF;
  IF organization_id_value IS NULL OR actor_user_id_value IS NULL OR auth_session_id_value IS NULL
     OR actor_access_role_value IS NULL THEN
    RAISE EXCEPTION 'Operational overview authority is unavailable' USING ERRCODE='42501';
  END IF;
  actor:=public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,NULL,FALSE);
  IF actor_access_role_value IN ('owner','admin') THEN scope_value:='owner_admin';
  ELSIF actor_access_role_value='member' AND actor->>'operationalRole'='dispatcher' THEN
    scope_value:='dispatcher_coordination';
  ELSE RAISE EXCEPTION 'Operational overview authority is unavailable' USING ERRCODE='42501';
  END IF;
  IF state_value IS NULL OR state_value NOT IN ('active','all','completion_pending','completed')
     OR limit_value IS NULL OR limit_value NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Operational overview input is invalid' USING ERRCODE='22023';
  END IF;
  scope_digest:=public.canonical_completion_digest(jsonb_build_object(
    'organization',organization_id_value,'actor',actor_user_id_value,'session',auth_session_id_value,
    'authority',actor-'evaluatedAt','scope',scope_value,'state',state_value));
  IF cursor_value IS NOT NULL THEN
    IF public.canonical_field_evidence_object_keys_exact(cursor_value,
         ARRAY['version','state','scopeDigest','dataDigest','cutoff','lastCreatedAt','lastId']) IS NOT TRUE
       OR cursor_value->>'version' IS DISTINCT FROM 'm23-part9b-cursor-v1'
       OR cursor_value->>'state' IS DISTINCT FROM state_value
       OR cursor_value->>'dataDigest' IS NULL OR cursor_value->>'dataDigest'!~'^[0-9a-f]{64}$'
       OR public.canonical_field_evidence_uuid_valid(cursor_value->>'lastId') IS NOT TRUE
       OR cursor_value->>'cutoff' IS NULL OR cursor_value->>'cutoff'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
       OR cursor_value->>'lastCreatedAt' IS NULL OR cursor_value->>'lastCreatedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
       OR octet_length(cursor_value::text)>1536 THEN
      RAISE EXCEPTION 'Operational overview cursor is invalid' USING ERRCODE='22023';
    END IF;
    IF cursor_value->>'scopeDigest' IS DISTINCT FROM scope_digest THEN
      RAISE EXCEPTION 'Operational overview scope changed'
        USING ERRCODE='40001',CONSTRAINT='canonical_operational_overview_stale';
    END IF;
    BEGIN
      cutoff:=(cursor_value->>'cutoff')::timestamptz;
      last_time:=(cursor_value->>'lastCreatedAt')::timestamptz;
      last_id:=(cursor_value->>'lastId')::uuid;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Operational overview cursor is invalid' USING ERRCODE='22023';
    END;
    IF cutoff>transaction_timestamp() OR last_time>cutoff THEN
      RAISE EXCEPTION 'Operational overview cursor is invalid' USING ERRCODE='22023';
    END IF;
  END IF;
  cutoff_text:=to_char(cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  SELECT profile.id,profile.version_number,rtrim(profile.normalized_profile_hash) AS hash,
    CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names zone
      WHERE zone.name=profile.raw_profile#>>'{company,timeZone}')
      THEN profile.raw_profile#>>'{company,timeZone}' END AS time_zone
    INTO active_profile FROM public.canonical_business_profiles profile
   WHERE profile.organization_id=organization_id_value AND profile.is_active
   ORDER BY profile.version_number DESC LIMIT 1;
  data_digest:=public.canonical_completion_digest(jsonb_build_object('scope',scope_digest,'profile',to_jsonb(active_profile)));

  -- Walk only this tenant's accepted source identities. The rolling digest
  -- binds all current matching work, including arrivals after an old cutoff;
  -- only the bounded requested page is retained as presentation JSON.
  FOR row_value IN
    SELECT execution.*,assignment.revision AS assignment_revision,
      rtrim(assignment.canonical_digest) AS assignment_digest,
      assignment.target_state,assignment.workforce_profile_id,assignment.workforce_crew_id,
      assignment.schedule_state,assignment.dispatch_state,assignment.appointment_status,
      assignment.scheduled_start,assignment.scheduled_end,assignment.needs_review,
      appointment.status AS current_appointment_status,opportunity.service_type,
      COALESCE(NULLIF(CASE WHEN jsonb_typeof(opportunity.job_scope->'jobTitle')='string'
        THEN left(opportunity.job_scope->>'jobTitle',500) END,''),
        NULLIF(CASE WHEN jsonb_typeof(opportunity.job_scope->'title')='string'
        THEN left(opportunity.job_scope->>'title',500) END,''),
        NULLIF(left(opportunity.service_type,200),''),'Service appointment') AS title,
      assigned_account.name AS worker_name,assigned_account.status AS worker_status,
      assigned_membership.status AS membership_status,assigned_membership.role AS assigned_role,
      crew.name AS crew_name,crew_members.active_count AS crew_active_count,
      crew_members.digest AS crew_members_digest
    FROM public.canonical_field_executions execution
    JOIN public.canonical_schedule_assignments assignment
      ON assignment.organization_id=execution.organization_id AND assignment.id=execution.assignment_id
      AND assignment.appointment_id=execution.appointment_id
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=execution.organization_id AND appointment.id=execution.appointment_id
      AND appointment.operation_id=execution.operation_id AND appointment.graph_id=execution.graph_id
      AND appointment.opportunity_id=execution.opportunity_id
    JOIN public.canonical_opportunities opportunity
      ON opportunity.organization_id=execution.organization_id AND opportunity.id=execution.opportunity_id
      AND opportunity.operation_id=execution.operation_id AND opportunity.graph_id=execution.graph_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=execution.organization_id AND transcript.operation_id=execution.operation_id
      AND transcript.graph_id=execution.graph_id
    LEFT JOIN public.organization_memberships assigned_membership
      ON assigned_membership.organization_id=execution.organization_id AND assigned_membership.id=assignment.workforce_profile_id
    LEFT JOIN public.users assigned_account
      ON assigned_account.organization_id=execution.organization_id AND assigned_account.id=assigned_membership.user_id
    LEFT JOIN public.workforce_crews crew
      ON crew.organization_id=execution.organization_id AND crew.id=assignment.workforce_crew_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER(WHERE membership.status='active' AND account.status='active'
        AND membership.role IN ('owner','admin','member')) AS active_count,
        public.canonical_completion_digest(COALESCE(jsonb_agg(jsonb_build_array(
          member.profile_id,member.crew_role,membership.status,membership.role,account.status)
          ORDER BY member.profile_id),'[]'::jsonb)) AS digest
      FROM public.workforce_crew_members member
      JOIN public.organization_memberships membership
        ON membership.organization_id=member.organization_id AND membership.id=member.profile_id
      JOIN public.users account ON account.organization_id=membership.organization_id AND account.id=membership.user_id
      WHERE member.organization_id=execution.organization_id AND member.crew_id=assignment.workforce_crew_id
    ) crew_members ON TRUE
    WHERE execution.organization_id=organization_id_value
      AND public.canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice')
      AND (state_value='all' OR state_value='active' AND execution.lifecycle_state NOT IN ('completed','cancelled')
        OR state_value IN ('completion_pending','completed') AND execution.lifecycle_state=state_value)
    ORDER BY execution.created_at DESC,execution.id DESC
  LOOP
    total_value:=total_value+1;
    assignment_current:=COALESCE(row_value.source_assignment_revision=row_value.assignment_revision
      AND rtrim(row_value.source_assignment_digest)=row_value.assignment_digest
      AND row_value.target_state='assigned' AND row_value.schedule_state='scheduled'
      AND row_value.dispatch_state='dispatched' AND NOT row_value.needs_review
      AND lower(btrim(row_value.appointment_status))<>'cancelled'
      AND lower(btrim(row_value.current_appointment_status))<>'cancelled'
      AND (row_value.workforce_profile_id IS NOT NULL AND row_value.worker_status='active'
        AND row_value.membership_status='active' AND row_value.assigned_role IN ('owner','admin','member')
        OR row_value.workforce_crew_id IS NOT NULL AND row_value.crew_active_count>0),FALSE);
    WITH latest AS (
      SELECT DISTINCT ON(fact.root_id) fact.* FROM public.canonical_progress_records fact
       WHERE fact.organization_id=organization_id_value AND fact.execution_id=row_value.id
       ORDER BY fact.root_id,fact.revision DESC,fact.id DESC
    )
    SELECT count(*) FILTER(WHERE evidence_type='progress') AS recorded,
      count(*) FILTER(WHERE evidence_type='progress' AND document->>'reviewState'='needs_review') AS needs_review,
      count(*) FILTER(WHERE evidence_type='progress' AND document->>'uncertainty'<>'measured') AS uncertain,
      count(*) FILTER(WHERE evidence_type='blocker' AND document->>'state'<>'resolved') AS blockers,
      count(*) FILTER(WHERE evidence_type='exception' AND document->>'state'<>'resolved') AS exceptions,
      count(*) FILTER(WHERE evidence_type IN ('blocker','exception') AND document->>'state'<>'resolved'
        AND document->>'impact' IN ('prevents_work','constrains_work')) AS constraints,
      public.canonical_completion_digest(COALESCE(jsonb_agg(jsonb_build_array(id,revision,rtrim(canonical_digest)) ORDER BY root_id),'[]'::jsonb)) AS digest
      INTO progress_stats FROM latest;
    WITH latest AS (
      SELECT DISTINCT ON(fact.root_id) fact.* FROM public.canonical_field_evidence_records fact
       WHERE fact.organization_id=organization_id_value AND fact.execution_id=row_value.id
       ORDER BY fact.root_id,fact.revision DESC,fact.id DESC
    )
    SELECT count(*) AS recorded,count(*) FILTER(WHERE evidence_type='checklist') AS checklists,
      count(*) FILTER(WHERE evidence_type='observation' AND document->>'observationClass'='inspection') AS inspections,
      count(*) FILTER(WHERE evidence_type='file') AS files,count(*) FILTER(WHERE evidence_type='note') AS notes,
      public.canonical_completion_digest(COALESCE(jsonb_agg(jsonb_build_array(id,revision,rtrim(canonical_digest)) ORDER BY root_id),'[]'::jsonb)) AS digest
      INTO field_stats FROM latest;
    SELECT
      (SELECT count(*) FROM public.canonical_labor_intervals fact WHERE fact.organization_id=organization_id_value AND fact.execution_id=row_value.id) AS labor,
      (SELECT count(*) FROM public.canonical_material_movements fact WHERE fact.organization_id=organization_id_value AND fact.execution_id=row_value.id) AS materials,
      (SELECT count(*) FROM public.canonical_equipment_events fact WHERE fact.organization_id=organization_id_value AND fact.execution_id=row_value.id) AS equipment
      INTO operational_stats;
    approval_state:='none'; evidence_state:='not_evaluated'; gate_value:=NULL; proposal:=NULL;
    IF row_value.lifecycle_state='completion_pending' THEN
      SELECT record.* INTO proposal FROM public.canonical_completion_records record
       WHERE record.organization_id=organization_id_value AND record.execution_id=row_value.id
         AND record.record_kind='proposal'
         AND record.resulting_execution_revision=row_value.revision
         AND rtrim(record.resulting_execution_digest)=rtrim(row_value.canonical_digest)
         AND NOT EXISTS(SELECT 1 FROM public.canonical_completion_records resolution
           WHERE resolution.organization_id=organization_id_value AND resolution.related_proposal_id=record.id
             AND resolution.record_kind IN ('approval','withdrawal','cancellation'))
       ORDER BY record.decided_at DESC,record.id DESC LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'Current completion proposal is unavailable' USING ERRCODE='55000'; END IF;
      gate_value:=public.canonical_completion_gate_snapshot(organization_id_value,row_value.id,proposal.gate_requirements);
      IF proposal.expires_at<=transaction_timestamp() THEN approval_state:='expired'; evidence_state:='incomplete';
      ELSIF NOT assignment_current OR gate_value IS DISTINCT FROM proposal.gate_snapshot THEN
        approval_state:='changed'; evidence_state:='changed';
      ELSE approval_state:='pending';
        evidence_state:=CASE WHEN (gate_value->>'hardGatesPassed')::boolean IS TRUE THEN 'ready_for_review' ELSE 'incomplete' END;
      END IF;
    END IF;
    item:=jsonb_build_object(
      'executionId',row_value.id,'appointmentId',row_value.appointment_id,'title',row_value.title,
      'serviceType',NULLIF(left(row_value.service_type,200),''),
      'createdAt',to_char(row_value.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'updatedAt',to_char(row_value.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'lifecycleState',row_value.lifecycle_state,
      'schedule',jsonb_build_object('state',CASE WHEN lower(btrim(row_value.current_appointment_status))='cancelled' THEN 'unavailable'
        WHEN row_value.dispatch_state='dispatched' THEN 'dispatched' WHEN row_value.schedule_state='scheduled' THEN 'scheduled'
        WHEN row_value.target_state='assigned' THEN 'assigned' ELSE 'unassigned' END,
        'start',to_char(row_value.scheduled_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'end',to_char(row_value.scheduled_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',active_profile.time_zone),
      'assignment',jsonb_build_object('kind',CASE WHEN row_value.workforce_profile_id IS NOT NULL THEN 'worker'
        WHEN row_value.workforce_crew_id IS NOT NULL THEN 'crew' ELSE 'unassigned' END,
        'label',CASE WHEN row_value.workforce_profile_id IS NOT NULL THEN COALESCE(NULLIF(left(row_value.worker_name,250),''),'Assigned worker')
        WHEN row_value.workforce_crew_id IS NOT NULL THEN COALESCE(NULLIF(left(row_value.crew_name,250),''),'Assigned crew') ELSE 'Unassigned' END,
        'current',assignment_current),
      'progress',jsonb_build_object('recorded',progress_stats.recorded,'needsReview',progress_stats.needs_review,'uncertain',progress_stats.uncertain),
      'blockers',jsonb_build_object('open',progress_stats.blockers),'exceptions',jsonb_build_object('open',progress_stats.exceptions),
      'approval',jsonb_build_object('state',approval_state),'evidence',jsonb_build_object('state',evidence_state,'recorded',field_stats.recorded),
      'capacity',jsonb_build_object('status','unknown','recordedConstraints',progress_stats.constraints));
    IF scope_value='owner_admin' THEN
      WITH latest AS (
        SELECT DISTINCT ON(fact.root_id) fact.* FROM public.canonical_progress_records fact
         WHERE fact.organization_id=organization_id_value AND fact.execution_id=row_value.id
         ORDER BY fact.root_id,fact.revision DESC,fact.id DESC
      ), bounded AS (SELECT * FROM latest WHERE evidence_type='progress' ORDER BY decided_at DESC,id DESC LIMIT 20)
      SELECT COALESCE(jsonb_agg(jsonb_build_object('workKey',document->>'workKey',
        'quantity',CASE WHEN document->'quantity'='null'::jsonb THEN 'null'::jsonb ELSE (document->'quantity')-'contractVersion' END,
        'milestone',CASE WHEN document->'milestone'='null'::jsonb THEN 'null'::jsonb ELSE
          jsonb_build_object('key',document->'milestone'->>'key','state',document->'milestone'->>'state') END,
        'uncertainty',document->>'uncertainty',
        'observedAt',to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'reviewState',document->>'reviewState') ORDER BY decided_at DESC,id DESC),'[]'::jsonb)
        INTO detail_progress FROM bounded;
      item:=item||jsonb_build_object('ownerDetails',jsonb_build_object('progress',detail_progress,
        'progressTruncated',progress_stats.recorded>jsonb_array_length(detail_progress),
        'evidenceCounts',jsonb_build_object('checklists',field_stats.checklists,'inspections',field_stats.inspections,'files',field_stats.files,'notes',field_stats.notes),
        'operationalCounts',jsonb_build_object('laborIntervals',operational_stats.labor,'materialMovements',operational_stats.materials,'equipmentEvents',operational_stats.equipment),
        'pendingProposal',CASE WHEN proposal.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
          'id',proposal.id,'revision',proposal.revision,'digest',rtrim(proposal.canonical_digest),
          'decidedAt',to_char(proposal.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'expiresAt',to_char(proposal.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) END));
    END IF;
    data_digest:=public.canonical_completion_digest(jsonb_build_object('previous',data_digest,'projection',item,
      'executionRevision',row_value.revision,'executionDigest',rtrim(row_value.canonical_digest),
      'assignmentRevision',row_value.assignment_revision,'assignmentDigest',row_value.assignment_digest,
      'crewMembers',row_value.crew_members_digest,'progress',progress_stats.digest,'fieldEvidence',field_stats.digest,
      'operationalCounts',to_jsonb(operational_stats),'gates',gate_value));
    IF NOT pointer_seen THEN
      IF row_value.id=last_id AND row_value.created_at=last_time THEN pointer_seen:=TRUE; offset_value:=total_value; END IF;
    ELSIF jsonb_array_length(records)<limit_value THEN
      records:=records||jsonb_build_array(item);
      last_returned_time:=item->>'createdAt';last_returned_id:=row_value.id;
      IF octet_length(records::text)>1000000 THEN RAISE EXCEPTION 'Operational overview size limit reached' USING ERRCODE='54000'; END IF;
    END IF;
  END LOOP;
  IF NOT pointer_seen OR cursor_value IS NOT NULL AND cursor_value->>'dataDigest' IS DISTINCT FROM data_digest THEN
    RAISE EXCEPTION 'Operational overview records changed'
      USING ERRCODE='40001',CONSTRAINT='canonical_operational_overview_stale';
  END IF;
  IF offset_value+jsonb_array_length(records)<total_value THEN
    next_cursor:=jsonb_build_object('version','m23-part9b-cursor-v1','state',state_value,
      'scopeDigest',scope_digest,'dataDigest',data_digest,'cutoff',cutoff_text,
      'lastCreatedAt',last_returned_time,'lastId',last_returned_id);
  END IF;
  result_value:=jsonb_build_object('version','m23-part9b-overview-v1','authority','postgresql','readOnly',TRUE,
    'scope',scope_value,'evaluatedAt',cutoff_text,'dataDigest',data_digest,'filter',state_value,
    'capacity',jsonb_build_object('status','unknown'),'records',records,
    'pagination',jsonb_build_object('limit',limit_value,'offset',offset_value,'returned',jsonb_array_length(records),'total',total_value,
      'nextCursor',CASE WHEN next_cursor IS NULL THEN NULL ELSE rtrim(translate(replace(replace(
        encode(convert_to(next_cursor::text,'UTF8'),'base64'),chr(10),''),chr(13),''),'+/','-_'),'=') END));
  IF octet_length(result_value::text)>1048576 THEN RAISE EXCEPTION 'Operational overview size limit reached' USING ERRCODE='54000'; END IF;
  RETURN result_value;
END
$function$;

REVOKE ALL ON FUNCTION public.canonical_operational_overview_read(uuid,uuid,text,uuid,text,integer,jsonb) FROM PUBLIC;
