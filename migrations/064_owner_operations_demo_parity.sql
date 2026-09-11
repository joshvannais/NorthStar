-- Owner Operations demo parity. Applied migrations 001–063 remain immutable.
-- Pure rules below have no relation reads, paid authority or writes. Existing paid
-- entry functions retain their loaders/auth/locks/receipts; 051 wrapper remains.
-- Generated reproducibly by scripts/build-owner-operations-extraction.py.
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check
 CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action'));

CREATE FUNCTION public.canonical_work_lifecycle_after(before_state TEXT, action_value TEXT, return_state TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE
  WHEN before_state='not_started' AND action_value='start' THEN 'in_progress'
  WHEN before_state='in_progress' AND action_value='pause' THEN 'paused'
  WHEN before_state='paused' AND action_value='resume' THEN 'in_progress'
  WHEN before_state IN ('in_progress','paused','reopened') AND action_value='propose_completion' THEN 'completion_pending'
  WHEN before_state='completion_pending' AND action_value='approve_completion' THEN 'completed'
  WHEN before_state='completion_pending' AND action_value='withdraw_completion' AND return_state IN ('in_progress','paused','reopened') THEN return_state
  WHEN before_state IN ('not_started','in_progress','paused','completion_pending','reopened') AND action_value='cancel_execution' THEN 'cancelled'
  WHEN before_state='completed' AND action_value='reopen_execution' THEN 'reopened'
  WHEN before_state='reopened' AND action_value='resume_reopened' THEN 'in_progress'
  WHEN before_state IN ('not_started','in_progress','paused','completion_pending','completed','reopened','cancelled') AND action_value='correct_completion' THEN before_state
  ELSE NULL END
$$;


CREATE FUNCTION public.canonical_operations_progress_successor_document(action_value TEXT, previous_document JSONB, evidence_type_value TEXT, document_value JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF action_value NOT IN ('review','issue_state','correct','update_progress') OR previous_document IS NULL
  OR public.canonical_progress_document_valid(action_value,document_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Invalid operational input' USING ERRCODE='22023'; END IF;
  IF action_value='review' THEN document_value:=previous_document||jsonb_build_object('reviewState',document_value->>'outcome');
  ELSIF action_value='issue_state' THEN
   IF evidence_type_value NOT IN ('blocker','exception') OR previous_document->>'state'=document_value->>'state'
   OR (previous_document->>'state'='resolved' AND document_value->>'state'<>'open') THEN RAISE EXCEPTION 'Invalid issue transition' USING ERRCODE='22023'; END IF;
   document_value:=previous_document||document_value||jsonb_build_object('reviewState','needs_review');
  ELSE
   IF document_value->>'kind'<>evidence_type_value
   OR (evidence_type_value='progress' AND document_value->>'workKey'<>previous_document->>'workKey')
   OR (evidence_type_value IN ('blocker','exception') AND
     (document_value->'state'<>previous_document->'state' OR document_value->'resolution'<>previous_document->'resolution'))
   THEN RAISE EXCEPTION 'Correction cannot change fact identity or issue lifecycle' USING ERRCODE='22023'; END IF;
   IF action_value='update_progress' AND (evidence_type_value<>'progress'
    OR (previous_document->'quantity'<>'null'::jsonb AND
      (document_value->'quantity'='null'::jsonb OR document_value->'quantity'->>'unit'<>previous_document->'quantity'->>'unit'
       OR document_value->'quantity'->>'total'<>previous_document->'quantity'->>'total'
       OR (document_value->'quantity'->>'completed')::numeric<(previous_document->'quantity'->>'completed')::numeric)))
   THEN RAISE EXCEPTION 'Changed measurement basis requires explicit correction' USING ERRCODE='22023'; END IF;
  END IF;
 IF public.canonical_progress_full_document_valid(document_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Invalid canonical document' USING ERRCODE='22023'; END IF;
 RETURN document_value;
END $$;


CREATE FUNCTION public.canonical_completion_reduce_gates(
 execution_id_value UUID,
 assignment_value JSONB,
 gate_requirements_value JSONB,
 checklist_gates JSONB,
 inspection_gates JSONB,
 file_gates JSONB,
 labor_rows JSONB,
 material_rows JSONB,
 progress_rows JSONB,
 field_rows JSONB,
 equipment_rows JSONB,
 labor_open BIGINT,
 labor_review BIGINT,
 material_review BIGINT,
 progress_unresolved BIGINT,
 progress_review BIGINT,
 field_review BIGINT,
 field_expired BIGINT,
 equipment_checkout BIGINT,
 equipment_downtime BIGINT,
 equipment_fault BIGINT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE checklist_passed BOOLEAN; inspection_passed BOOLEAN; file_passed BOOLEAN; hard_passed BOOLEAN;
BEGIN
 IF execution_id_value IS NULL OR assignment_value IS NULL OR public.canonical_completion_requirements_valid(gate_requirements_value) IS NOT TRUE
  OR jsonb_typeof(checklist_gates) IS DISTINCT FROM 'array'
  OR jsonb_typeof(inspection_gates) IS DISTINCT FROM 'array'
  OR jsonb_typeof(file_gates) IS DISTINCT FROM 'array'
  OR jsonb_typeof(labor_rows) IS DISTINCT FROM 'array'
  OR jsonb_typeof(material_rows) IS DISTINCT FROM 'array'
  OR jsonb_typeof(progress_rows) IS DISTINCT FROM 'array'
  OR jsonb_typeof(field_rows) IS DISTINCT FROM 'array'
  OR jsonb_typeof(equipment_rows) IS DISTINCT FROM 'array'
  OR labor_open IS NULL OR labor_open<0
  OR labor_review IS NULL OR labor_review<0
  OR material_review IS NULL OR material_review<0
  OR progress_unresolved IS NULL OR progress_unresolved<0
  OR progress_review IS NULL OR progress_review<0
  OR field_review IS NULL OR field_review<0
  OR field_expired IS NULL OR field_expired<0
  OR equipment_checkout IS NULL OR equipment_checkout<0
  OR equipment_downtime IS NULL OR equipment_downtime<0
  OR equipment_fault IS NULL OR equipment_fault<0 THEN
  RAISE EXCEPTION 'Complete evidence inputs required' USING ERRCODE='22023'; END IF;
 checklist_passed:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(checklist_gates) gate(value)
   WHERE COALESCE((value->>'passed')::boolean,FALSE) IS NOT TRUE);
 inspection_passed:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inspection_gates) gate(value)
   WHERE COALESCE((value->>'passed')::boolean,FALSE) IS NOT TRUE);
 file_passed:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(file_gates) gate(value)
   WHERE COALESCE((value->>'passed')::boolean,FALSE) IS NOT TRUE);
 hard_passed:=checklist_passed AND inspection_passed AND file_passed
   AND progress_unresolved=0 AND progress_review=0 AND labor_open=0 AND labor_review=0
   AND material_review=0 AND equipment_checkout=0 AND equipment_downtime=0 AND field_review=0;

 RETURN jsonb_build_object(
  'contractVersion','m23-completion-gates-v1','executionId',execution_id_value,
  'assignment',assignment_value,
  'requirements',gate_requirements_value,
  'checklists',checklist_gates,'inspections',inspection_gates,'files',file_gates,
  'labor',jsonb_build_object('count',jsonb_array_length(labor_rows),'digest',public.canonical_completion_digest(labor_rows),
    'openTimerCount',labor_open,'needsReviewCount',labor_review),
  'materials',jsonb_build_object('count',jsonb_array_length(material_rows),'digest',public.canonical_completion_digest(material_rows),
    'needsReviewCount',material_review),
  'progress',jsonb_build_object('count',jsonb_array_length(progress_rows),'digest',public.canonical_completion_digest(progress_rows),
    'unresolvedIssueCount',progress_unresolved,'needsReviewCount',progress_review),
  'fieldEvidence',jsonb_build_object('count',jsonb_array_length(field_rows),'digest',public.canonical_completion_digest(field_rows),
    'needsReviewCount',field_review,'expiredFileCount',field_expired),
  'equipment',jsonb_build_object('count',jsonb_array_length(equipment_rows),'digest',public.canonical_completion_digest(equipment_rows),
    'checkedOutCount',equipment_checkout,'downtimeCount',equipment_downtime,'recordedFaultCount',equipment_fault),
  'gateResults',jsonb_build_array(
    jsonb_build_object('gate','required_checklists','hard',TRUE,'passed',checklist_passed),
    jsonb_build_object('gate','required_inspections','hard',TRUE,'passed',inspection_passed),
    jsonb_build_object('gate','required_files','hard',TRUE,'passed',file_passed),
    jsonb_build_object('gate','unresolved_blockers_or_exceptions','hard',TRUE,'passed',progress_unresolved=0,'count',progress_unresolved),
    jsonb_build_object('gate','progress_review','hard',TRUE,'passed',progress_review=0,'count',progress_review),
    jsonb_build_object('gate','open_labor_timers','hard',TRUE,'passed',labor_open=0,'count',labor_open),
    jsonb_build_object('gate','labor_review','hard',TRUE,'passed',labor_review=0,'count',labor_review),
    jsonb_build_object('gate','material_review','hard',TRUE,'passed',material_review=0,'count',material_review),
    jsonb_build_object('gate','equipment_checkout','hard',TRUE,'passed',equipment_checkout=0,'count',equipment_checkout),
    jsonb_build_object('gate','equipment_downtime','hard',TRUE,'passed',equipment_downtime=0,'count',equipment_downtime),
    jsonb_build_object('gate','field_evidence_review','hard',TRUE,'passed',field_review=0,'count',field_review)
  ),'hardGatesPassed',hard_passed,
  'interpretation','Explicit evidence-pinned completion gates only; no activity, progress percentage, billing, payment, profitability, professional, regulatory or customer-acceptance conclusion.'
 );
END $$;


CREATE FUNCTION public.canonical_operations_document_valid(domain_value TEXT, action_value TEXT, document_value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN domain_value='progress' THEN public.canonical_progress_full_document_valid(document_value)
 WHEN domain_value='evidence' THEN public.canonical_field_evidence_document_valid(action_value,document_value)
 ELSE FALSE END
$$;


CREATE OR REPLACE FUNCTION public.canonical_field_execution_transition(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID,
  csrf_token_value TEXT,
  execution_id_value UUID,
  expected_revision_value BIGINT,
  expected_digest_value TEXT,
  expected_assignment_revision_value BIGINT,
  expected_assignment_digest_value TEXT,
  action_code_value TEXT,
  idempotency_key_value TEXT,
  reason_value TEXT,
  request_correlation_id_value TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  authority JSONB;
  actor_profile_id UUID;
  preliminary_execution public.canonical_field_executions%ROWTYPE;
  execution_record public.canonical_field_executions%ROWTYPE;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  replay_record public.canonical_field_execution_idempotency%ROWTYPE;
  event_id_value UUID;
  idempotency_key_hash_value TEXT;
  request_digest_value TEXT;
  after_state_value TEXT;
  after_revision_value BIGINT;
  after_digest_value TEXT;
  response_body_value JSONB;
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' THEN
    RAISE EXCEPTION 'Canonical field execution writes require serializable isolation'
      USING ERRCODE='25001',CONSTRAINT='canonical_field_execution_serializable_required';
  END IF;
  IF actor_access_role_value NOT IN ('owner','admin','member','viewer')
     OR action_code_value NOT IN ('start','pause','resume')
     OR expected_revision_value<1
     OR expected_digest_value !~ '^[0-9a-f]{64}$'
     OR expected_assignment_revision_value<1
     OR expected_assignment_digest_value !~ '^[0-9a-f]{64}$'
     OR idempotency_key_value IS NULL
     OR idempotency_key_value<>btrim(idempotency_key_value)
     OR idempotency_key_value !~ '^[!-~]{16,128}$'
     OR NOT public.canonical_field_execution_reason_valid(reason_value)
     OR request_correlation_id_value IS NULL
     OR request_correlation_id_value !~ '^[ -~]{1,128}$' THEN
    RAISE EXCEPTION 'Canonical field execution transition input is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_input_invalid';
  END IF;
  authority := public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,csrf_token_value,TRUE
  );
  actor_profile_id := (authority->>'profileId')::UUID;
  idempotency_key_hash_value := encode(sha256(convert_to(idempotency_key_value,'UTF8')),'hex');
  request_digest_value := public.canonical_field_execution_request_digest(
    organization_id_value,actor_user_id_value,auth_session_id_value,action_code_value,
    'execution',execution_id_value,expected_revision_value,expected_digest_value,
    expected_assignment_revision_value,expected_assignment_digest_value,
    idempotency_key_hash_value,reason_value
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(
    organization_id_value::TEXT||':'||actor_user_id_value::TEXT||':'||idempotency_key_hash_value,0
  ));
  SELECT * INTO replay_record
    FROM public.canonical_field_execution_idempotency replay
   WHERE replay.organization_id=organization_id_value
     AND replay.actor_user_id=actor_user_id_value
     AND rtrim(replay.idempotency_key_hash)=idempotency_key_hash_value;
  IF FOUND THEN
    IF rtrim(replay_record.request_digest)<>request_digest_value
       OR replay_record.action_code<>action_code_value
       OR replay_record.identity_kind<>'execution'
       OR replay_record.identity_id<>execution_id_value THEN
      RAISE EXCEPTION 'The Idempotency-Key was already used for another field execution mutation'
        USING ERRCODE='23505',CONSTRAINT='canonical_field_execution_idempotency_conflict';
    END IF;
    IF NOT public.canonical_field_execution_replay_authorized(
      organization_id_value,actor_access_role_value,actor_profile_id,
      replay_record.execution_id,NULL::UUID
    ) THEN
      RAISE EXCEPTION 'Current field execution replay authority is unavailable'
        USING ERRCODE='42501',CONSTRAINT='canonical_field_execution_replay_unauthorized';
    END IF;
    RETURN jsonb_build_object(
      'status',replay_record.response_status,
      'body',replay_record.response_body,
      'replayed',TRUE
    );
  END IF;

  SELECT * INTO preliminary_execution
    FROM public.canonical_field_executions execution
   WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;
  SELECT assignment.* INTO assignment_record
    FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=assignment.organization_id
     AND appointment.id=assignment.appointment_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=appointment.organization_id
     AND transcript.operation_id=appointment.operation_id
   WHERE assignment.organization_id=organization_id_value
     AND assignment.id=preliminary_execution.assignment_id
     AND assignment.appointment_id=preliminary_execution.appointment_id
     AND transcript.source NOT IN ('simulation','demo')
   FOR SHARE OF assignment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;
  SELECT * INTO execution_record
    FROM public.canonical_field_executions execution
   WHERE execution.organization_id=organization_id_value
     AND execution.id=execution_id_value
   FOR UPDATE;
  IF NOT FOUND OR execution_record.assignment_id<>assignment_record.id THEN
    RAISE EXCEPTION 'Field execution authority changed'
      USING ERRCODE='40001',CONSTRAINT='canonical_field_execution_stale';
  END IF;
  IF execution_record.revision<>expected_revision_value
     OR rtrim(execution_record.canonical_digest)<>expected_digest_value THEN
    RAISE EXCEPTION 'Field execution authority changed'
      USING ERRCODE='40001',CONSTRAINT='canonical_field_execution_stale';
  END IF;
  IF assignment_record.revision<>expected_assignment_revision_value
     OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest_value THEN
    RAISE EXCEPTION 'Field execution assignment authority changed'
      USING ERRCODE='40001',CONSTRAINT='canonical_field_execution_assignment_stale';
  END IF;
  IF assignment_record.target_state<>'assigned'
     OR assignment_record.dispatch_state<>'dispatched'
     OR assignment_record.appointment_status IN ('cancelled','completed') THEN
    RAISE EXCEPTION 'A current dispatched assignment is required for field execution'
      USING ERRCODE='42501',CONSTRAINT='canonical_field_execution_dispatch_required';
  END IF;
  IF NOT public.canonical_field_execution_actor_in_scope(
    organization_id_value,actor_access_role_value,actor_profile_id,assignment_record
  ) THEN
    RAISE EXCEPTION 'The current actor is not authorized for this field execution'
      USING ERRCODE='42501',CONSTRAINT='canonical_field_execution_assignment_scope_forbidden';
  END IF;
  after_state_value := public.canonical_work_lifecycle_after(execution_record.lifecycle_state,action_code_value,NULL);
  IF after_state_value IS NULL THEN
    RAISE EXCEPTION 'Field execution lifecycle transition is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_transition_invalid';
  END IF;
  event_id_value := gen_random_uuid();
  after_revision_value := execution_record.revision+1;
  after_digest_value := public.canonical_field_execution_digest(
    execution_record.id,execution_record.appointment_id,execution_record.operation_id,
    execution_record.graph_id,execution_record.opportunity_id,execution_record.assignment_id,
    after_state_value,assignment_record.revision,rtrim(assignment_record.canonical_digest),
    actor_user_id_value,actor_profile_id
  );
  UPDATE public.canonical_field_executions
     SET lifecycle_state=after_state_value,
         source_assignment_revision=assignment_record.revision,
         source_assignment_digest=rtrim(assignment_record.canonical_digest),
         revision=after_revision_value,canonical_digest=after_digest_value,
         last_event_id=event_id_value,last_recorded_by_user_id=actor_user_id_value,
         last_performed_by_profile_id=actor_profile_id,last_action_code=action_code_value,
         last_reason=reason_value,last_transaction_id=txid_current(),
         updated_at=transaction_timestamp()
   WHERE organization_id=organization_id_value AND id=execution_id_value
   RETURNING * INTO execution_record;
  INSERT INTO public.canonical_field_execution_events(
    id,organization_id,execution_id,appointment_id,assignment_id,recorded_by_user_id,
    performed_by_profile_id,auth_session_id,action_code,reason,before_revision,
    after_revision,before_digest,after_digest,source_assignment_revision,
    source_assignment_digest,idempotency_key_hash,request_digest,request_correlation_id
  ) VALUES (
    event_id_value,organization_id_value,execution_id_value,execution_record.appointment_id,
    execution_record.assignment_id,actor_user_id_value,actor_profile_id,auth_session_id_value,
    action_code_value,reason_value,expected_revision_value,after_revision_value,
    expected_digest_value,after_digest_value,assignment_record.revision,
    rtrim(assignment_record.canonical_digest),idempotency_key_hash_value,
    request_digest_value,request_correlation_id_value
  );
  INSERT INTO public.canonical_field_execution_revisions(
    organization_id,execution_id,event_id,revision,appointment_id,operation_id,graph_id,
    opportunity_id,assignment_id,lifecycle_state,source_assignment_revision,
    source_assignment_digest,canonical_digest,recorded_by_user_id,performed_by_profile_id,
    action_code,reason
  ) VALUES (
    organization_id_value,execution_id_value,event_id_value,after_revision_value,
    execution_record.appointment_id,execution_record.operation_id,execution_record.graph_id,
    execution_record.opportunity_id,execution_record.assignment_id,after_state_value,
    assignment_record.revision,rtrim(assignment_record.canonical_digest),after_digest_value,
    actor_user_id_value,actor_profile_id,action_code_value,reason_value
  );
  INSERT INTO public.canonical_field_execution_audit_events(
    organization_id,execution_id,event_id,appointment_id,assignment_id,actor_user_id,
    performed_by_profile_id,action_code,reason,before_revision,after_revision,before_digest,
    after_digest,source_assignment_revision,source_assignment_digest,request_digest,
    request_correlation_id
  ) VALUES (
    organization_id_value,execution_id_value,event_id_value,execution_record.appointment_id,
    execution_record.assignment_id,actor_user_id_value,actor_profile_id,action_code_value,
    reason_value,expected_revision_value,after_revision_value,expected_digest_value,
    after_digest_value,assignment_record.revision,rtrim(assignment_record.canonical_digest),
    request_digest_value,request_correlation_id_value
  );
  response_body_value := jsonb_build_object(
    'success',TRUE,'data',public.canonical_field_execution_projection(execution_record),
    'requestId',request_correlation_id_value
  );
  INSERT INTO public.canonical_field_execution_idempotency(
    organization_id,actor_user_id,idempotency_key_hash,request_digest,action_code,
    identity_kind,identity_id,execution_id,event_id,response_status,response_body
  ) VALUES (
    organization_id_value,actor_user_id_value,idempotency_key_hash_value,request_digest_value,
    action_code_value,'execution',execution_id_value,execution_id_value,event_id_value,200,
    response_body_value
  );
  RETURN jsonb_build_object('status',200,'body',response_body_value,'replayed',FALSE);
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_progress_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf_value TEXT,execution_value UUID,
 action_value TEXT,performer UUID,subject_value UUID,expected_subject_revision BIGINT,expected_subject_digest TEXT,
 expected_execution_revision BIGINT,expected_execution_digest TEXT,expected_assignment_revision BIGINT,expected_assignment_digest TEXT,
 document_value JSONB,idempotency_key TEXT,reason_value TEXT,correlation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; execution_record public.canonical_field_executions%ROWTYPE; assignment_record public.canonical_schedule_assignments%ROWTYPE;
 receipt public.canonical_progress_idempotency%ROWTYPE; subject_record public.canonical_progress_records%ROWTYPE;
 record_value public.canonical_progress_records%ROWTYPE; event_value UUID:=gen_random_uuid(); record_id UUID:=gen_random_uuid();
 key_hash_value TEXT; request_hash_value TEXT; record_digest TEXT; before_revision BIGINT:=0;before_digest TEXT:=NULL;root_value UUID;response JSONB;
 updating BOOLEAN:=action_value IN ('update_progress','issue_state','correct','review');
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR (action_value IN ('record_progress','update_progress','record_blocker','record_exception','record_change','issue_state','correct','review')) IS NOT TRUE
 OR idempotency_key IS NULL OR idempotency_key!~'^[!-~]{16,128}$' OR expected_execution_revision IS NULL OR expected_execution_digest IS NULL
 OR expected_assignment_revision IS NULL OR expected_assignment_digest IS NULL OR performer IS NULL OR org IS NULL OR actor IS NULL OR session_value IS NULL OR role_value IS NULL OR execution_value IS NULL
 OR expected_execution_revision<1 OR expected_assignment_revision<1 OR expected_execution_digest!~'^[0-9a-f]{64}$' OR expected_assignment_digest!~'^[0-9a-f]{64}$'
 OR (updating AND (subject_value IS NULL OR expected_subject_revision IS NULL OR expected_subject_digest IS NULL OR expected_subject_revision<1 OR expected_subject_digest!~'^[0-9a-f]{64}$'))
 OR (NOT updating AND (subject_value IS NOT NULL OR expected_subject_revision IS NOT NULL OR expected_subject_digest IS NOT NULL))
 OR public.canonical_progress_text_valid(reason_value) IS NOT TRUE OR correlation_value IS NULL OR correlation_value!~'^[ -~]{1,128}$'
 OR public.canonical_progress_document_valid(action_value,document_value) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid operational input' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_progress_work_lock(org,execution_value,TRUE);
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf_value,TRUE);
 SELECT * INTO execution_record FROM public.canonical_field_executions WHERE organization_id=org AND id=execution_value FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Work unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO assignment_record FROM public.canonical_schedule_assignments WHERE organization_id=org AND id=execution_record.assignment_id FOR SHARE;
 IF NOT FOUND OR public.canonical_field_execution_replay_authorized(org,role_value,(authority->>'profileId')::uuid,execution_value,NULL) IS NOT TRUE
 OR execution_record.lifecycle_state NOT IN ('in_progress','paused') OR assignment_record.schedule_state<>'scheduled' OR assignment_record.needs_review
 OR NOT EXISTS(SELECT 1 FROM public.canonical_transcripts t WHERE t.organization_id=org AND t.operation_id=execution_record.operation_id
 AND t.graph_id=execution_record.graph_id AND public.canonical_labor_transcript_source_normalized(t.source) IN ('lead','retell','voice'))
 THEN RAISE EXCEPTION 'Current work unavailable' USING ERRCODE='42501'; END IF;
 IF execution_record.revision<>expected_execution_revision OR rtrim(execution_record.canonical_digest)<>expected_execution_digest
 OR assignment_record.revision<>expected_assignment_revision OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest
 THEN RAISE EXCEPTION 'Source pins stale' USING ERRCODE='40001',CONSTRAINT='canonical_progress_source_stale'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles p JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
 JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id WHERE p.organization_id=org AND p.id=performer AND m.status='active' AND u.status='active'
 AND (assignment_record.workforce_profile_id=p.id OR EXISTS(SELECT 1 FROM public.workforce_crew_members cm WHERE cm.organization_id=org AND cm.crew_id=assignment_record.workforce_crew_id AND cm.profile_id=p.id)))
 OR role_value='member' AND performer<>(authority->>'profileId')::uuid THEN RAISE EXCEPTION 'Performer unavailable' USING ERRCODE='42501'; END IF;
 IF action_value='review' AND ((document_value->>'outcome'='owner_confirmed' AND role_value NOT IN ('owner','admin'))
 OR (document_value->>'outcome'='worker_acknowledged' AND performer<>(authority->>'profileId')::uuid))
 THEN RAISE EXCEPTION 'Review authority unavailable' USING ERRCODE='42501'; END IF;
 key_hash_value:=encode(sha256(convert_to(idempotency_key,'UTF8')),'hex');
 request_hash_value:=encode(sha256(convert_to(jsonb_build_object('organizationId',org,'actor',actor,'session',session_value,'execution',execution_value,'action',action_value,
 'performer',performer,'subject',subject_value,'subjectRevision',expected_subject_revision,'subjectDigest',expected_subject_digest,
 'executionRevision',expected_execution_revision,'executionDigest',expected_execution_digest,'assignmentRevision',expected_assignment_revision,
 'assignmentDigest',expected_assignment_digest,'document',document_value,'keyHash',key_hash_value,'reason',reason_value)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.canonical_progress_idempotency WHERE organization_id=org AND actor_user_id=actor AND auth_session_id=session_value AND key_hash=key_hash_value;
 IF FOUND THEN
  IF rtrim(receipt.request_digest)<>request_hash_value THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505',CONSTRAINT='canonical_progress_idempotency_conflict'; END IF;
  RETURN jsonb_build_object('status',receipt.response_status,'body',receipt.response_body,'replayed',TRUE);
 END IF;
 IF (SELECT count(*) FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value)>=2000 THEN RAISE EXCEPTION 'Operational fact bound reached' USING ERRCODE='54000'; END IF;
 IF updating THEN
  SELECT * INTO subject_record FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value AND id=subject_value FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Record unavailable' USING ERRCODE='42501'; END IF;
  IF subject_record.performed_by_profile_id<>performer THEN RAISE EXCEPTION 'Attribution cannot be replaced' USING ERRCODE='42501'; END IF;
  IF subject_record.revision<>expected_subject_revision OR rtrim(subject_record.canonical_digest)<>expected_subject_digest
  OR EXISTS(SELECT 1 FROM public.canonical_progress_records WHERE organization_id=org AND previous_record_id=subject_record.id)
  THEN RAISE EXCEPTION 'Predecessor stale' USING ERRCODE='40001',CONSTRAINT='canonical_progress_subject_stale'; END IF;
  root_value:=subject_record.root_id;before_revision:=subject_record.revision;before_digest:=rtrim(subject_record.canonical_digest);
  document_value:=public.canonical_operations_progress_successor_document(action_value,subject_record.document,subject_record.evidence_type,document_value);
 ELSE root_value:=record_id;
  IF action_value='record_progress' AND EXISTS(SELECT 1 FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value
  AND evidence_type='progress' AND document->>'workKey'=document_value->>'workKey' AND performed_by_profile_id=performer)
  THEN RAISE EXCEPTION 'Progress work identity already exists; update exact predecessor' USING ERRCODE='40001',CONSTRAINT='canonical_progress_work_stale'; END IF;
 END IF;
 IF NOT public.canonical_progress_full_document_valid(document_value) THEN RAISE EXCEPTION 'Invalid canonical document' USING ERRCODE='22023'; END IF;
 -- Only these exact-predecessor actions inherit historical observation provenance.
 -- Retain its full profile pin and timezone (also for resolution instants); retirement
 -- is not revocation of current actor/work authority, already checked above.
 IF NOT public.canonical_progress_observation_authorized(org,execution_value,document_value,action_value NOT IN ('review','issue_state')) THEN RAISE EXCEPTION 'Observed source evidence unavailable' USING ERRCODE='42501'; END IF;
 record_digest:=encode(sha256(convert_to(jsonb_build_object('action',action_value,'assignmentDigest',expected_assignment_digest,'assignmentRevision',expected_assignment_revision,
 'document',document_value,'executionDigest',expected_execution_digest,'executionId',execution_value,'executionRevision',expected_execution_revision,
 'performedBy',performer,'previousRecordId',CASE WHEN updating THEN subject_record.id ELSE NULL END,'recordedBy',actor,'revision',before_revision+1,'rootId',root_value)::text,'UTF8')),'hex');
 INSERT INTO public.canonical_progress_records(id,organization_id,execution_id,assignment_id,root_id,previous_record_id,evidence_type,revision,document,canonical_digest,
 recorded_by_user_id,performed_by_profile_id,auth_session_id,source_execution_revision,source_execution_digest,source_assignment_revision,source_assignment_digest,action_code,reason,request_correlation_id)
 VALUES(record_id,org,execution_value,execution_record.assignment_id,root_value,CASE WHEN updating THEN subject_record.id ELSE NULL END,document_value->>'kind',before_revision+1,document_value,
 record_digest,actor,performer,session_value,expected_execution_revision,expected_execution_digest,expected_assignment_revision,expected_assignment_digest,action_value,reason_value,correlation_value) RETURNING * INTO record_value;
 INSERT INTO public.canonical_progress_events(id,organization_id,execution_id,record_id,root_id,action_code,before_revision,after_revision,before_digest,after_digest,idempotency_key_hash,request_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,request_correlation_id)
 VALUES(event_value,org,execution_value,record_id,root_value,action_value,before_revision,before_revision+1,before_digest,record_digest,key_hash_value,request_hash_value,actor,performer,session_value,correlation_value);
 INSERT INTO public.canonical_progress_audit_events(organization_id,execution_id,record_id,event_id,action_code,before_revision,after_revision,before_digest,after_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,source_execution_revision,source_execution_digest,source_assignment_revision,source_assignment_digest,reason,request_correlation_id)
 VALUES(org,execution_value,record_id,event_value,action_value,before_revision,before_revision+1,before_digest,record_digest,actor,performer,session_value,expected_execution_revision,expected_execution_digest,expected_assignment_revision,expected_assignment_digest,reason_value,correlation_value);
 response:=jsonb_build_object('success',TRUE,'data',public.canonical_progress_projection(record_value));
 INSERT INTO public.canonical_progress_idempotency(organization_id,actor_user_id,auth_session_id,key_hash,request_digest,action_code,record_id,response_status,response_body)
 VALUES(org,actor,session_value,key_hash_value,request_hash_value,action_value,record_id,201,response);
 RETURN jsonb_build_object('status',201,'body',response,'replayed',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_completion_mutate_v049(
 organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
 auth_session_id_value UUID, csrf_token_value TEXT, execution_id_value UUID, action_code_value TEXT,
 expected_execution_revision_value BIGINT, expected_execution_digest_value TEXT,
 expected_assignment_revision_value BIGINT, expected_assignment_digest_value TEXT,
 input_value JSONB, idempotency_key_value TEXT, reason_value TEXT, request_correlation_id_value TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 authority JSONB; actor_profile_id UUID;
 preliminary_execution public.canonical_field_executions%ROWTYPE;
 execution_record public.canonical_field_executions%ROWTYPE;
 assignment_record public.canonical_schedule_assignments%ROWTYPE;
 receipt public.canonical_completion_idempotency%ROWTYPE;
 proposal_record public.canonical_completion_records%ROWTYPE;
 completion_record public.canonical_completion_records%ROWTYPE;
 reopening_record public.canonical_completion_records%ROWTYPE;
 predecessor_record public.canonical_completion_records%ROWTYPE;
 inserted_record public.canonical_completion_records%ROWTYPE;
 idempotency_hash_value TEXT; request_digest_value TEXT;
 record_id_value UUID:=gen_random_uuid(); completion_event_id_value UUID:=gen_random_uuid();
 field_event_id_value UUID:=gen_random_uuid(); root_id_value UUID; previous_record_id_value UUID;
 record_kind_value TEXT; subject_kind_value TEXT; record_revision_value BIGINT:=1;
 related_proposal_id_value UUID; related_completion_id_value UUID;
 before_state_value TEXT; after_state_value TEXT; after_revision_value BIGINT; after_digest_value TEXT;
 gate_requirements_value JSONB:='{"checklists":[],"inspections":[],"files":[]}'::jsonb;
 gate_snapshot_value JSONB:='{"contractVersion":"m23-completion-gates-v1","notEvaluated":true}'::jsonb;
 document_value JSONB; record_payload_value JSONB; record_digest_value TEXT;
 expires_at_value TIMESTAMPTZ; response_body_value JSONB; lifecycle_changed BOOLEAN:=TRUE;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR organization_id_value IS NULL OR actor_user_id_value IS NULL OR auth_session_id_value IS NULL
  OR execution_id_value IS NULL
  OR actor_access_role_value IS NULL
  OR actor_access_role_value NOT IN ('owner','admin','member','viewer')
  OR action_code_value IS NULL
  OR action_code_value NOT IN ('propose_completion','approve_completion','withdraw_completion',
    'cancel_execution','reopen_execution','resume_reopened','correct_completion')
  OR expected_execution_revision_value IS NULL OR expected_execution_revision_value<1
  OR expected_execution_digest_value IS NULL OR expected_execution_digest_value!~'^[0-9a-f]{64}$'
  OR expected_assignment_revision_value IS NULL OR expected_assignment_revision_value<1
  OR expected_assignment_digest_value IS NULL OR expected_assignment_digest_value!~'^[0-9a-f]{64}$'
  OR idempotency_key_value IS NULL OR idempotency_key_value<>btrim(idempotency_key_value)
  OR idempotency_key_value!~'^[!-~]{16,128}$'
  OR reason_value IS NULL
  OR NOT public.canonical_field_execution_reason_valid(reason_value)
  OR NOT public.canonical_progress_text_valid(reason_value)
  OR request_correlation_id_value IS NULL OR request_correlation_id_value!~'^[ -~]{1,128}$'
  OR input_value IS NULL
  OR NOT public.canonical_field_evidence_object_keys_exact(input_value,ARRAY[
    'contractVersion','proposal','completion','reopening','record','expiresAt',
    'gateRequirements','nextAction','annotation'])
  OR input_value->>'contractVersion'<>'m23-completion-authority-v1' THEN
  RAISE EXCEPTION 'Completion authority input is invalid'
   USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid';
 END IF;
 IF action_code_value='propose_completion' THEN
  IF input_value->'proposal'<>'null'::jsonb OR input_value->'completion'<>'null'::jsonb
   OR input_value->'reopening'<>'null'::jsonb OR input_value->'record'<>'null'::jsonb
   OR input_value->'nextAction'<>'null'::jsonb OR input_value->'annotation'<>'null'::jsonb
   OR jsonb_typeof(input_value->'expiresAt')<>'string'
   OR NOT public.canonical_progress_instant_valid(input_value->>'expiresAt')
   OR NOT public.canonical_completion_requirements_valid(input_value->'gateRequirements') THEN
   RAISE EXCEPTION 'Completion proposal input is invalid'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
 ELSIF action_code_value IN ('approve_completion','withdraw_completion') THEN
  IF NOT public.canonical_completion_pin_valid(input_value->'proposal')
   OR input_value->'completion'<>'null'::jsonb OR input_value->'reopening'<>'null'::jsonb
   OR input_value->'record'<>'null'::jsonb OR input_value->'expiresAt'<>'null'::jsonb
   OR input_value->'gateRequirements'<>'null'::jsonb OR input_value->'nextAction'<>'null'::jsonb
   OR input_value->'annotation'<>'null'::jsonb THEN RAISE EXCEPTION 'Completion proposal reference is invalid'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
 ELSIF action_code_value='cancel_execution' THEN
  IF NOT (input_value->'proposal'='null'::jsonb OR public.canonical_completion_pin_valid(input_value->'proposal'))
   OR input_value->'completion'<>'null'::jsonb OR input_value->'reopening'<>'null'::jsonb
   OR input_value->'record'<>'null'::jsonb OR input_value->'expiresAt'<>'null'::jsonb
   OR input_value->'gateRequirements'<>'null'::jsonb OR input_value->'nextAction'<>'null'::jsonb
   OR input_value->'annotation'<>'null'::jsonb THEN RAISE EXCEPTION 'Completion cancellation input is invalid'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
 ELSIF action_code_value='reopen_execution' THEN
  IF NOT public.canonical_completion_pin_valid(input_value->'completion')
   OR NOT public.canonical_progress_text_valid(input_value->>'nextAction')
   OR input_value->'proposal'<>'null'::jsonb OR input_value->'reopening'<>'null'::jsonb
   OR input_value->'record'<>'null'::jsonb OR input_value->'expiresAt'<>'null'::jsonb
   OR input_value->'gateRequirements'<>'null'::jsonb OR input_value->'annotation'<>'null'::jsonb THEN
   RAISE EXCEPTION 'Completion reopening input is invalid'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
 ELSIF action_code_value='resume_reopened' THEN
  IF NOT public.canonical_completion_pin_valid(input_value->'reopening')
   OR input_value->'proposal'<>'null'::jsonb OR input_value->'completion'<>'null'::jsonb
   OR input_value->'record'<>'null'::jsonb OR input_value->'expiresAt'<>'null'::jsonb
   OR input_value->'gateRequirements'<>'null'::jsonb OR input_value->'nextAction'<>'null'::jsonb
   OR input_value->'annotation'<>'null'::jsonb THEN RAISE EXCEPTION 'Completion resumption input is invalid'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
 ELSE
  IF NOT public.canonical_completion_pin_valid(input_value->'record')
   OR NOT public.canonical_field_evidence_object_keys_exact(input_value->'annotation',ARRAY['note','nextAction'])
   OR NOT public.canonical_progress_text_valid(input_value->'annotation'->>'note',2000)
   OR NOT (input_value->'annotation'->'nextAction'='null'::jsonb
     OR public.canonical_progress_text_valid(input_value->'annotation'->>'nextAction'))
   OR input_value->'proposal'<>'null'::jsonb OR input_value->'completion'<>'null'::jsonb
   OR input_value->'reopening'<>'null'::jsonb OR input_value->'expiresAt'<>'null'::jsonb
   OR input_value->'gateRequirements'<>'null'::jsonb OR input_value->'nextAction'<>'null'::jsonb THEN
   RAISE EXCEPTION 'Completion correction input is invalid'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
 END IF;

 PERFORM public.canonical_completion_work_lock(organization_id_value,execution_id_value,TRUE);
 authority:=public.canonical_field_execution_actor_authority(organization_id_value,actor_user_id_value,
  actor_access_role_value,auth_session_id_value,csrf_token_value,TRUE);
 actor_profile_id:=(authority->>'profileId')::uuid;
 IF actor_access_role_value='viewer' OR (action_code_value IN ('approve_completion','cancel_execution',
   'reopen_execution','resume_reopened','correct_completion') AND actor_access_role_value NOT IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Completion authority is unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_completion_forbidden'; END IF;
 SELECT * INTO preliminary_execution FROM public.canonical_field_executions execution
  WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completion authority not found'
  USING ERRCODE='P0002',CONSTRAINT='canonical_completion_not_found'; END IF;
 SELECT assignment.* INTO assignment_record
 FROM public.canonical_schedule_assignments assignment
 JOIN public.canonical_appointments appointment ON appointment.organization_id=assignment.organization_id
   AND appointment.id=assignment.appointment_id AND appointment.operation_id=assignment.operation_id
   AND appointment.graph_id=assignment.graph_id AND appointment.opportunity_id=assignment.opportunity_id
 JOIN public.canonical_transcripts transcript ON transcript.organization_id=assignment.organization_id
   AND transcript.operation_id=assignment.operation_id AND transcript.graph_id=assignment.graph_id
 WHERE assignment.organization_id=organization_id_value AND assignment.id=preliminary_execution.assignment_id
   AND assignment.appointment_id=preliminary_execution.appointment_id
   AND assignment.target_state='assigned' AND assignment.dispatch_state='dispatched'
   AND lower(btrim(assignment.appointment_status)) NOT IN ('cancelled','completed')
   AND lower(btrim(appointment.status)) NOT IN ('cancelled','completed')
   AND public.canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice')
 FOR SHARE OF assignment,appointment,transcript;
 IF NOT FOUND OR NOT public.canonical_field_execution_actor_in_scope(organization_id_value,
   actor_access_role_value,actor_profile_id,assignment_record) THEN
  RAISE EXCEPTION 'Completion authority is unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_completion_forbidden'; END IF;

 idempotency_hash_value:=encode(sha256(convert_to(idempotency_key_value,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'action',action_code_value,'actorUserId',actor_user_id_value,'assignmentDigest',expected_assignment_digest_value,
  'assignmentRevision',expected_assignment_revision_value,'authSessionId',auth_session_id_value,
  'executionDigest',expected_execution_digest_value,'executionId',execution_id_value,
  'executionRevision',expected_execution_revision_value,'idempotencyKeyHash',idempotency_hash_value,
  'input',input_value,'organizationId',organization_id_value,'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(organization_id_value::text||':'||actor_user_id_value::text||':'||idempotency_hash_value,0));
 SELECT * INTO receipt FROM public.canonical_completion_idempotency replay
  WHERE replay.organization_id=organization_id_value AND replay.actor_user_id=actor_user_id_value
    AND rtrim(replay.idempotency_key_hash)=idempotency_hash_value;
 IF FOUND THEN
  IF rtrim(receipt.request_digest)<>request_digest_value OR receipt.action_code<>action_code_value
   OR receipt.execution_id<>execution_id_value THEN RAISE EXCEPTION 'Completion idempotency conflict'
    USING ERRCODE='23505',CONSTRAINT='canonical_completion_idempotency_conflict'; END IF;
  IF action_code_value IN ('approve_completion','cancel_execution','reopen_execution','resume_reopened','correct_completion')
    AND actor_access_role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Completion replay authority is unavailable'
     USING ERRCODE='42501',CONSTRAINT='canonical_completion_forbidden'; END IF;
  RETURN jsonb_build_object('status',receipt.response_status,'body',receipt.response_body,'replayed',TRUE);
 END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_field_execution_idempotency existing
  WHERE existing.organization_id=organization_id_value AND existing.actor_user_id=actor_user_id_value
    AND rtrim(existing.idempotency_key_hash)=idempotency_hash_value) THEN
  RAISE EXCEPTION 'Completion idempotency conflict'
   USING ERRCODE='23505',CONSTRAINT='canonical_completion_idempotency_conflict'; END IF;

 SELECT * INTO execution_record FROM public.canonical_field_executions execution
  WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value FOR UPDATE;
 IF execution_record.revision<>expected_execution_revision_value
  OR rtrim(execution_record.canonical_digest)<>expected_execution_digest_value THEN
  RAISE EXCEPTION 'Completion execution source is stale'
   USING ERRCODE='40001',CONSTRAINT='canonical_completion_execution_stale'; END IF;
 IF assignment_record.revision<>expected_assignment_revision_value
  OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest_value THEN
  RAISE EXCEPTION 'Completion assignment source is stale'
   USING ERRCODE='40001',CONSTRAINT='canonical_completion_assignment_stale'; END IF;
 IF (SELECT count(*) FROM public.canonical_completion_records record
   WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value)>=2000 THEN
  RAISE EXCEPTION 'Completion history limit reached' USING ERRCODE='54000'; END IF;

 before_state_value:=execution_record.lifecycle_state;
 root_id_value:=record_id_value;
 IF action_code_value='propose_completion' THEN
  IF before_state_value NOT IN ('in_progress','paused','reopened') THEN RAISE EXCEPTION 'Completion transition is invalid'
   USING ERRCODE='23514',CONSTRAINT='canonical_completion_transition_invalid'; END IF;
  expires_at_value:=(input_value->>'expiresAt')::timestamptz;
  IF expires_at_value<=transaction_timestamp() OR expires_at_value>transaction_timestamp()+INTERVAL '7 days' THEN
   RAISE EXCEPTION 'Completion proposal expiry is invalid'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
  gate_requirements_value:=input_value->'gateRequirements';
  gate_snapshot_value:=public.canonical_completion_gate_snapshot(organization_id_value,execution_id_value,gate_requirements_value);
  IF (gate_snapshot_value->>'hardGatesPassed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Completion hard gate failed'
   USING ERRCODE='40001',CONSTRAINT='canonical_completion_gate_failed'; END IF;
  record_kind_value:='proposal';subject_kind_value:='proposal';after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before);
  document_value:=jsonb_build_object('kind','proposal','contractVersion','m23-completion-authority-v1',
   'returnState',before_state_value,'gateRequirements',gate_requirements_value);
 ELSIF action_code_value IN ('approve_completion','withdraw_completion') THEN
  SELECT * INTO proposal_record FROM public.canonical_completion_records record
   WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
    AND record.id=(input_value->'proposal'->>'id')::uuid AND record.record_kind='proposal'
    AND record.revision=(input_value->'proposal'->>'revision')::bigint
    AND rtrim(record.canonical_digest)=input_value->'proposal'->>'digest';
  IF NOT FOUND THEN RAISE EXCEPTION 'Completion proposal is stale'
   USING ERRCODE='40001',CONSTRAINT='canonical_completion_proposal_stale'; END IF;
  IF before_state_value<>'completion_pending' OR execution_record.revision<>proposal_record.resulting_execution_revision
   OR rtrim(execution_record.canonical_digest)<>rtrim(proposal_record.resulting_execution_digest)
   OR EXISTS(SELECT 1 FROM public.canonical_completion_records resolution
     WHERE resolution.organization_id=organization_id_value AND resolution.related_proposal_id=proposal_record.id
       AND resolution.record_kind IN ('approval','withdrawal','cancellation')) THEN
   RAISE EXCEPTION 'Completion proposal changed'
    USING ERRCODE='40001',CONSTRAINT='canonical_completion_proposal_stale'; END IF;
  IF action_code_value='approve_completion' AND proposal_record.expires_at<=transaction_timestamp() THEN
   RAISE EXCEPTION 'Completion proposal expired'
    USING ERRCODE='40001',CONSTRAINT='canonical_completion_expired'; END IF;
  IF action_code_value='withdraw_completion' AND actor_access_role_value='member'
   AND proposal_record.recorded_by_user_id<>actor_user_id_value THEN RAISE EXCEPTION 'Completion withdrawal authority is unavailable'
    USING ERRCODE='42501',CONSTRAINT='canonical_completion_forbidden'; END IF;
  gate_requirements_value:=proposal_record.gate_requirements;gate_snapshot_value:=proposal_record.gate_snapshot;
  related_proposal_id_value:=proposal_record.id;
  IF action_code_value='approve_completion' THEN
   IF public.canonical_completion_gate_snapshot(organization_id_value,execution_id_value,gate_requirements_value)
      IS DISTINCT FROM gate_snapshot_value THEN RAISE EXCEPTION 'Completion evidence changed'
    USING ERRCODE='40001',CONSTRAINT='canonical_completion_evidence_changed'; END IF;
   IF (gate_snapshot_value->>'hardGatesPassed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Completion hard gate failed'
    USING ERRCODE='40001',CONSTRAINT='canonical_completion_gate_failed'; END IF;
   record_kind_value:='approval';subject_kind_value:='approval';after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before);
   document_value:=jsonb_build_object('kind','approval','contractVersion','m23-completion-authority-v1',
    'proposal',input_value->'proposal','gateSnapshotDigest',public.canonical_completion_digest(gate_snapshot_value));
  ELSE
   record_kind_value:='withdrawal';subject_kind_value:='withdrawal';after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before);
   document_value:=jsonb_build_object('kind','withdrawal','contractVersion','m23-completion-authority-v1',
    'proposal',input_value->'proposal','returnState',after_state_value);
  END IF;
 ELSIF action_code_value='cancel_execution' THEN
  IF before_state_value IN ('completed','cancelled') THEN RAISE EXCEPTION 'Completion transition is invalid'
   USING ERRCODE='23514',CONSTRAINT='canonical_completion_transition_invalid'; END IF;
  IF before_state_value='completion_pending' THEN
   IF NOT public.canonical_completion_pin_valid(input_value->'proposal') THEN RAISE EXCEPTION 'Current proposal pin is required'
    USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
   SELECT * INTO proposal_record FROM public.canonical_completion_records record
    WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
      AND record.id=(input_value->'proposal'->>'id')::uuid AND record.record_kind='proposal'
      AND record.revision=(input_value->'proposal'->>'revision')::bigint
      AND rtrim(record.canonical_digest)=input_value->'proposal'->>'digest';
   IF NOT FOUND OR proposal_record.resulting_execution_revision<>execution_record.revision
    OR rtrim(proposal_record.resulting_execution_digest)<>rtrim(execution_record.canonical_digest)
    OR EXISTS(SELECT 1 FROM public.canonical_completion_records resolution
      WHERE resolution.organization_id=organization_id_value AND resolution.related_proposal_id=proposal_record.id
        AND resolution.record_kind IN ('approval','withdrawal','cancellation')) THEN
    RAISE EXCEPTION 'Completion proposal changed'
     USING ERRCODE='40001',CONSTRAINT='canonical_completion_proposal_stale'; END IF;
   related_proposal_id_value:=proposal_record.id;gate_requirements_value:=proposal_record.gate_requirements;
   gate_snapshot_value:=proposal_record.gate_snapshot;
  ELSIF input_value->'proposal'<>'null'::jsonb THEN RAISE EXCEPTION 'Unexpected completion proposal pin'
   USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid'; END IF;
  record_kind_value:='cancellation';subject_kind_value:='cancellation';after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before);
  document_value:=jsonb_build_object('kind','cancellation','contractVersion','m23-completion-authority-v1',
   'proposal',input_value->'proposal','cancelledFrom',before_state_value);
 ELSIF action_code_value='reopen_execution' THEN
  SELECT * INTO completion_record FROM public.canonical_completion_records record
   WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
    AND record.id=(input_value->'completion'->>'id')::uuid AND record.record_kind='approval'
    AND record.revision=(input_value->'completion'->>'revision')::bigint
    AND rtrim(record.canonical_digest)=input_value->'completion'->>'digest';
  IF NOT FOUND OR before_state_value<>'completed'
   OR completion_record.resulting_execution_revision<>execution_record.revision
   OR rtrim(completion_record.resulting_execution_digest)<>rtrim(execution_record.canonical_digest)
   OR EXISTS(SELECT 1 FROM public.canonical_completion_records reopening
    WHERE reopening.organization_id=organization_id_value AND reopening.related_completion_id=completion_record.id
      AND reopening.record_kind='reopening') THEN RAISE EXCEPTION 'Completion record changed'
   USING ERRCODE='40001',CONSTRAINT='canonical_completion_record_stale'; END IF;
  related_completion_id_value:=completion_record.id;gate_requirements_value:=completion_record.gate_requirements;
  gate_snapshot_value:=completion_record.gate_snapshot;
  record_kind_value:='reopening';subject_kind_value:='reopening';after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before);
  document_value:=jsonb_build_object('kind','reopening','contractVersion','m23-completion-authority-v1',
   'originalCompletion',input_value->'completion','nextAction',input_value->>'nextAction');
 ELSIF action_code_value='resume_reopened' THEN
  SELECT * INTO reopening_record FROM public.canonical_completion_records record
   WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
    AND record.id=(input_value->'reopening'->>'id')::uuid AND record.record_kind='reopening'
    AND record.revision=(input_value->'reopening'->>'revision')::bigint
    AND rtrim(record.canonical_digest)=input_value->'reopening'->>'digest';
  IF NOT FOUND OR before_state_value<>'reopened'
   OR reopening_record.resulting_execution_revision<>execution_record.revision
   OR rtrim(reopening_record.resulting_execution_digest)<>rtrim(execution_record.canonical_digest) THEN
   RAISE EXCEPTION 'Reopening record changed'
    USING ERRCODE='40001',CONSTRAINT='canonical_completion_record_stale'; END IF;
  related_completion_id_value:=reopening_record.id;gate_requirements_value:=reopening_record.gate_requirements;
  gate_snapshot_value:=reopening_record.gate_snapshot;
  record_kind_value:='resumption';subject_kind_value:='resumption';after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before);
  document_value:=jsonb_build_object('kind','resumption','contractVersion','m23-completion-authority-v1',
   'reopening',input_value->'reopening');
 ELSE
  SELECT * INTO predecessor_record FROM public.canonical_completion_records record
   WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
    AND record.id=(input_value->'record'->>'id')::uuid
    AND record.revision=(input_value->'record'->>'revision')::bigint
    AND rtrim(record.canonical_digest)=input_value->'record'->>'digest';
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.canonical_completion_records successor
    WHERE successor.organization_id=organization_id_value AND successor.previous_record_id=predecessor_record.id) THEN
   RAISE EXCEPTION 'Completion correction predecessor changed'
    USING ERRCODE='40001',CONSTRAINT='canonical_completion_record_stale'; END IF;
  lifecycle_changed:=FALSE;root_id_value:=predecessor_record.root_id;previous_record_id_value:=predecessor_record.id;
  record_revision_value:=predecessor_record.revision+1;record_kind_value:='correction';
  subject_kind_value:=predecessor_record.subject_kind;related_proposal_id_value:=predecessor_record.related_proposal_id;
  related_completion_id_value:=predecessor_record.related_completion_id;
  gate_requirements_value:=predecessor_record.gate_requirements;gate_snapshot_value:=predecessor_record.gate_snapshot;
  after_state_value:=public.canonical_work_lifecycle_after(before_state_value,action_code_value,proposal_record.lifecycle_before);
  document_value:=jsonb_build_object('kind','correction','contractVersion','m23-completion-authority-v1',
   'corrects',input_value->'record','subjectKind',subject_kind_value,'annotation',input_value->'annotation');
 END IF;

 after_revision_value:=CASE WHEN lifecycle_changed THEN execution_record.revision+1 ELSE execution_record.revision END;
 after_digest_value:=CASE WHEN lifecycle_changed THEN public.canonical_field_execution_digest(
  execution_record.id,execution_record.appointment_id,execution_record.operation_id,execution_record.graph_id,
  execution_record.opportunity_id,execution_record.assignment_id,after_state_value,assignment_record.revision,
  rtrim(assignment_record.canonical_digest),actor_user_id_value,actor_profile_id)
  ELSE rtrim(execution_record.canonical_digest) END;
 record_payload_value:=jsonb_build_object(
  'action',action_code_value,'assignmentDigest',rtrim(assignment_record.canonical_digest),'assignmentId',assignment_record.id,
  'assignmentRevision',assignment_record.revision,'document',document_value,'executionId',execution_id_value,
  'gateRequirements',gate_requirements_value,'gateSnapshot',gate_snapshot_value,'lifecycleAfter',after_state_value,
  'lifecycleBefore',before_state_value,'performedBy',actor_profile_id,'previousRecordId',previous_record_id_value,
  'recordedBy',actor_user_id_value,'recordKind',record_kind_value,'relatedCompletionId',related_completion_id_value,
  'relatedProposalId',related_proposal_id_value,'resultingExecutionDigest',after_digest_value,
  'resultingExecutionRevision',after_revision_value,'revision',record_revision_value,'rootId',root_id_value,
  'sourceExecutionDigest',rtrim(execution_record.canonical_digest),'sourceExecutionRevision',execution_record.revision,
  'subjectKind',subject_kind_value);
 record_digest_value:=public.canonical_completion_digest(record_payload_value);

 IF lifecycle_changed THEN
  UPDATE public.canonical_field_executions SET lifecycle_state=after_state_value,
   source_assignment_revision=assignment_record.revision,source_assignment_digest=rtrim(assignment_record.canonical_digest),
   revision=after_revision_value,canonical_digest=after_digest_value,last_event_id=field_event_id_value,
   last_recorded_by_user_id=actor_user_id_value,last_performed_by_profile_id=actor_profile_id,
   last_action_code=action_code_value,last_reason=reason_value,last_transaction_id=txid_current(),
   updated_at=transaction_timestamp()
  WHERE organization_id=organization_id_value AND id=execution_id_value RETURNING * INTO execution_record;
  INSERT INTO public.canonical_field_execution_events(id,organization_id,execution_id,appointment_id,assignment_id,
   recorded_by_user_id,performed_by_profile_id,auth_session_id,action_code,reason,before_revision,after_revision,
   before_digest,after_digest,source_assignment_revision,source_assignment_digest,idempotency_key_hash,
   request_digest,request_correlation_id)
  VALUES(field_event_id_value,organization_id_value,execution_id_value,execution_record.appointment_id,
   execution_record.assignment_id,actor_user_id_value,actor_profile_id,auth_session_id_value,action_code_value,
   reason_value,expected_execution_revision_value,after_revision_value,expected_execution_digest_value,
   after_digest_value,assignment_record.revision,rtrim(assignment_record.canonical_digest),idempotency_hash_value,
   request_digest_value,request_correlation_id_value);
  INSERT INTO public.canonical_field_execution_revisions(organization_id,execution_id,event_id,revision,
   appointment_id,operation_id,graph_id,opportunity_id,assignment_id,lifecycle_state,source_assignment_revision,
   source_assignment_digest,canonical_digest,recorded_by_user_id,performed_by_profile_id,action_code,reason)
  VALUES(organization_id_value,execution_id_value,field_event_id_value,after_revision_value,
   execution_record.appointment_id,execution_record.operation_id,execution_record.graph_id,
   execution_record.opportunity_id,execution_record.assignment_id,after_state_value,assignment_record.revision,
   rtrim(assignment_record.canonical_digest),after_digest_value,actor_user_id_value,actor_profile_id,action_code_value,reason_value);
  INSERT INTO public.canonical_field_execution_audit_events(organization_id,execution_id,event_id,appointment_id,
   assignment_id,actor_user_id,performed_by_profile_id,action_code,reason,before_revision,after_revision,
   before_digest,after_digest,source_assignment_revision,source_assignment_digest,request_digest,request_correlation_id)
  VALUES(organization_id_value,execution_id_value,field_event_id_value,execution_record.appointment_id,
   execution_record.assignment_id,actor_user_id_value,actor_profile_id,action_code_value,reason_value,
   expected_execution_revision_value,after_revision_value,expected_execution_digest_value,after_digest_value,
   assignment_record.revision,rtrim(assignment_record.canonical_digest),request_digest_value,request_correlation_id_value);
 END IF;

 INSERT INTO public.canonical_completion_records(id,organization_id,execution_id,assignment_id,root_id,
  previous_record_id,record_kind,subject_kind,revision,related_proposal_id,related_completion_id,
  lifecycle_before,lifecycle_after,source_execution_revision,source_execution_digest,
  resulting_execution_revision,resulting_execution_digest,source_assignment_revision,source_assignment_digest,
  gate_requirements,gate_snapshot,document,canonical_digest,recorded_by_user_id,performed_by_profile_id,
  auth_session_id,action_code,reason,request_correlation_id,expires_at)
 VALUES(record_id_value,organization_id_value,execution_id_value,assignment_record.id,root_id_value,
  previous_record_id_value,record_kind_value,subject_kind_value,record_revision_value,related_proposal_id_value,
  related_completion_id_value,before_state_value,after_state_value,expected_execution_revision_value,
  expected_execution_digest_value,after_revision_value,after_digest_value,assignment_record.revision,
  rtrim(assignment_record.canonical_digest),gate_requirements_value,gate_snapshot_value,document_value,
  record_digest_value,actor_user_id_value,actor_profile_id,auth_session_id_value,action_code_value,reason_value,
  request_correlation_id_value,expires_at_value) RETURNING * INTO inserted_record;
 INSERT INTO public.canonical_completion_events(id,organization_id,execution_id,record_id,root_id,action_code,
  before_execution_revision,after_execution_revision,before_execution_digest,after_execution_digest,
  idempotency_key_hash,request_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,request_correlation_id)
 VALUES(completion_event_id_value,organization_id_value,execution_id_value,record_id_value,root_id_value,
  action_code_value,expected_execution_revision_value,after_revision_value,expected_execution_digest_value,
  after_digest_value,idempotency_hash_value,request_digest_value,actor_user_id_value,actor_profile_id,
  auth_session_id_value,request_correlation_id_value);
 INSERT INTO public.canonical_completion_audit_events(organization_id,execution_id,record_id,event_id,
  actor_user_id,performed_by_profile_id,action_code,reason,request_digest,request_correlation_id)
 VALUES(organization_id_value,execution_id_value,record_id_value,completion_event_id_value,actor_user_id_value,
  actor_profile_id,action_code_value,reason_value,request_digest_value,request_correlation_id_value);
 response_body_value:=jsonb_build_object('success',TRUE,
  'data',public.canonical_field_execution_projection(execution_record),
  'completionRecord',public.canonical_completion_projection(inserted_record),
  'requestId',request_correlation_id_value);
 INSERT INTO public.canonical_completion_idempotency(organization_id,actor_user_id,auth_session_id,
  idempotency_key_hash,request_digest,action_code,execution_id,record_id,event_id,response_status,response_body)
 VALUES(organization_id_value,actor_user_id_value,auth_session_id_value,idempotency_hash_value,
  request_digest_value,action_code_value,execution_id_value,record_id_value,completion_event_id_value,200,response_body_value);
 IF lifecycle_changed THEN
  INSERT INTO public.canonical_field_execution_idempotency(organization_id,actor_user_id,idempotency_key_hash,
   request_digest,action_code,identity_kind,identity_id,execution_id,event_id,response_status,response_body)
  VALUES(organization_id_value,actor_user_id_value,idempotency_hash_value,request_digest_value,action_code_value,
   'execution',execution_id_value,execution_id_value,field_event_id_value,200,response_body_value);
 END IF;
 RETURN jsonb_build_object('status',200,'body',response_body_value,'replayed',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_completion_gate_snapshot(
 organization_id_value UUID, execution_id_value UUID, gate_requirements_value JSONB
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 assignment_record public.canonical_schedule_assignments%ROWTYPE;
 checklist_gates JSONB; inspection_gates JSONB; file_gates JSONB;
 labor_rows JSONB; material_rows JSONB; progress_rows JSONB; field_rows JSONB; equipment_rows JSONB;
 labor_open BIGINT; labor_review BIGINT; material_review BIGINT;
 progress_unresolved BIGINT; progress_review BIGINT; field_review BIGINT; field_expired BIGINT;
 equipment_checkout BIGINT; equipment_downtime BIGINT; equipment_fault BIGINT;
 checklist_passed BOOLEAN; inspection_passed BOOLEAN; file_passed BOOLEAN; hard_passed BOOLEAN;
BEGIN
 IF NOT public.canonical_completion_requirements_valid(gate_requirements_value) THEN
  RAISE EXCEPTION 'Completion gate requirements are invalid'
   USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid';
 END IF;
 SELECT assignment.* INTO assignment_record
 FROM public.canonical_field_executions execution
 JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=execution.organization_id AND assignment.id=execution.assignment_id
 WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completion authority not found'
  USING ERRCODE='P0002',CONSTRAINT='canonical_completion_not_found'; END IF;

 WITH current_rows AS (
  SELECT interval.id,interval.revision,rtrim(interval.canonical_digest) AS digest,
    interval.review_state,interval.observed_end
  FROM public.canonical_labor_intervals interval
  WHERE interval.organization_id=organization_id_value AND interval.execution_id=execution_id_value
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'digest',digest,
    'reviewState',review_state,'open',observed_end IS NULL) ORDER BY id),'[]'::jsonb),
   count(*) FILTER(WHERE observed_end IS NULL AND review_state<>'rejected'),
   count(*) FILTER(WHERE review_state='needs_review')
 INTO labor_rows,labor_open,labor_review FROM current_rows;

 WITH current_rows AS (
  SELECT movement.id,movement.revision,rtrim(movement.canonical_digest) AS digest,movement.review_state
  FROM public.canonical_material_movements movement
  WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'digest',digest,
    'reviewState',review_state) ORDER BY id),'[]'::jsonb),
   count(*) FILTER(WHERE review_state='needs_review')
 INTO material_rows,material_review FROM current_rows;

 WITH latest AS (
  SELECT DISTINCT ON(record.root_id) record.id,record.root_id,record.revision,
    rtrim(record.canonical_digest) AS digest,record.evidence_type,record.document
  FROM public.canonical_progress_records record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
  ORDER BY record.root_id,record.revision DESC,record.id DESC
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rootId',root_id,'revision',revision,
    'digest',digest,'kind',evidence_type,'reviewState',document->>'reviewState',
    'issueState',document->>'state') ORDER BY root_id),'[]'::jsonb),
   count(*) FILTER(WHERE evidence_type IN ('blocker','exception') AND document->>'state'<>'resolved'),
   count(*) FILTER(WHERE document->>'reviewState' IN ('needs_review','disputed'))
 INTO progress_rows,progress_unresolved,progress_review FROM latest;

 WITH latest AS (
  SELECT DISTINCT ON(record.root_id) record.id,record.root_id,record.revision,
    rtrim(record.canonical_digest) AS digest,record.evidence_type,record.document
  FROM public.canonical_field_evidence_records record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
  ORDER BY record.root_id,record.revision DESC,record.id DESC
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rootId',root_id,'revision',revision,
    'digest',digest,'kind',evidence_type,'resultType',document->>'resultType',
    'retainedUntil',document->>'retainedUntil') ORDER BY root_id),'[]'::jsonb),
   count(*) FILTER(WHERE document->>'resultType'='needs_review'
     OR document#>>'{accessibility,state}'='needs_review'),
   count(*) FILTER(WHERE evidence_type='file' AND (document->>'retainedUntil')::timestamptz<=transaction_timestamp())
 INTO field_rows,field_review,field_expired FROM latest;

 WITH used_assets AS (
  SELECT DISTINCT event.asset_id
  FROM public.canonical_equipment_events event
  WHERE event.organization_id=organization_id_value AND event.execution_id=execution_id_value
 ), current_rows AS (
  SELECT asset.asset_id,COALESCE(ledger.revision,0) AS revision,rtrim(ledger.digest) AS digest,
    COALESCE(ledger.state,'{}'::jsonb) AS state
  FROM used_assets asset LEFT JOIN public.canonical_equipment_ledgers ledger
    ON ledger.organization_id=organization_id_value AND ledger.asset_id=asset.asset_id
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('assetId',asset_id,'revision',revision,'digest',digest,
    'availability',state->>'availability','checkedOutExecution',state->>'checkedOutExecution',
    'downtime',COALESCE((state->>'downtime')::boolean,FALSE),'recordedFault',COALESCE((state->>'recordedFault')::boolean,FALSE))
    ORDER BY asset_id),'[]'::jsonb),
   count(*) FILTER(WHERE state->>'checkedOutExecution'=execution_id_value::text),
   count(*) FILTER(WHERE COALESCE((state->>'downtime')::boolean,FALSE)),
   count(*) FILTER(WHERE COALESCE((state->>'recordedFault')::boolean,FALSE))
 INTO equipment_rows,equipment_checkout,equipment_downtime,equipment_fault FROM current_rows;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',pin->>'id','revision',(pin->>'revision')::bigint,'digest',pin->>'digest',
   'matched',checklist.id IS NOT NULL,'requiredItemCount',COALESCE(stats.required_count,0),
   'satisfiedRequiredItemCount',COALESCE(stats.satisfied_count,0),
   'passed',COALESCE(checklist.id IS NOT NULL AND stats.required_count=stats.satisfied_count,FALSE)
 ) ORDER BY pin->>'id'),'[]'::jsonb) INTO checklist_gates
 FROM jsonb_array_elements(gate_requirements_value->'checklists') pin
 LEFT JOIN LATERAL (
  SELECT record.* FROM public.canonical_field_evidence_records record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
    AND record.id=(pin->>'id')::uuid AND record.revision=(pin->>'revision')::bigint
    AND rtrim(record.canonical_digest)=pin->>'digest' AND record.evidence_type='checklist'
    AND NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records successor
      WHERE successor.organization_id=record.organization_id AND successor.previous_record_id=record.id)
 ) checklist ON TRUE
 LEFT JOIN LATERAL (
  SELECT count(*) FILTER(WHERE (item->>'required')::boolean) AS required_count,
    count(*) FILTER(WHERE (item->>'required')::boolean AND EXISTS(
      SELECT 1 FROM (
       SELECT DISTINCT ON(response.root_id) response.document
       FROM public.canonical_field_evidence_records response
       WHERE response.organization_id=organization_id_value AND response.execution_id=execution_id_value
         AND response.evidence_type='checklist_response'
         AND response.document->>'checklistId'=checklist.id::text
         AND response.document->>'itemKey'=item->>'key'
       ORDER BY response.root_id,response.revision DESC,response.id DESC
      ) current_response
      WHERE current_response.document->>'resultType' IN ('pass','observation','measurement')
    )) AS satisfied_count
  FROM jsonb_array_elements(checklist.document->'items') item
 ) stats ON TRUE;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',pin->>'id','revision',(pin->>'revision')::bigint,'digest',pin->>'digest',
   'matched',record.id IS NOT NULL,'resultType',record.document->>'resultType',
   'passed',COALESCE(record.id IS NOT NULL AND record.document->>'resultType'='pass',FALSE)
 ) ORDER BY pin->>'id'),'[]'::jsonb) INTO inspection_gates
 FROM jsonb_array_elements(gate_requirements_value->'inspections') pin
 LEFT JOIN LATERAL (
  SELECT evidence.* FROM public.canonical_field_evidence_records evidence
  WHERE evidence.organization_id=organization_id_value AND evidence.execution_id=execution_id_value
    AND evidence.id=(pin->>'id')::uuid AND evidence.revision=(pin->>'revision')::bigint
    AND rtrim(evidence.canonical_digest)=pin->>'digest' AND evidence.evidence_type='observation'
    AND evidence.document->>'observationClass'='inspection'
    AND NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records successor
      WHERE successor.organization_id=evidence.organization_id AND successor.previous_record_id=evidence.id)
 ) record ON TRUE;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',pin->>'id','revision',(pin->>'revision')::bigint,'digest',pin->>'digest',
   'matched',record.id IS NOT NULL,'retainedUntil',record.document->>'retainedUntil',
   'passed',COALESCE(record.id IS NOT NULL AND record.document->>'quarantineDisposition'='released_after_clean_scan'
     AND (record.document->>'retainedUntil')::timestamptz>transaction_timestamp(),FALSE)
 ) ORDER BY pin->>'id'),'[]'::jsonb) INTO file_gates
 FROM jsonb_array_elements(gate_requirements_value->'files') pin
 LEFT JOIN LATERAL (
  SELECT evidence.* FROM public.canonical_field_evidence_records evidence
  WHERE evidence.organization_id=organization_id_value AND evidence.execution_id=execution_id_value
    AND evidence.id=(pin->>'id')::uuid AND evidence.revision=(pin->>'revision')::bigint
    AND rtrim(evidence.canonical_digest)=pin->>'digest' AND evidence.evidence_type='file'
    AND NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records successor
      WHERE successor.organization_id=evidence.organization_id AND successor.previous_record_id=evidence.id)
 ) record ON TRUE;

 RETURN public.canonical_completion_reduce_gates(
  execution_id_value,
  jsonb_build_object('id',assignment_record.id,'revision',assignment_record.revision,'digest',rtrim(assignment_record.canonical_digest)),
  gate_requirements_value,
  checklist_gates,
  inspection_gates,
  file_gates,
  labor_rows,
  material_rows,
  progress_rows,
  field_rows,
  equipment_rows,
  labor_open,
  labor_review,
  material_review,
  progress_unresolved,
  progress_review,
  field_review,
  field_expired,
  equipment_checkout,
  equipment_downtime,
  equipment_fault);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_demo_completion_gate_snapshot(
 organization_id_value UUID, execution_id_value UUID, gate_requirements_value JSONB, assignment_value JSONB, evidence_value JSONB, evaluated_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 assignment_record public.canonical_schedule_assignments%ROWTYPE;
 checklist_gates JSONB; inspection_gates JSONB; file_gates JSONB;
 labor_rows JSONB; material_rows JSONB; progress_rows JSONB; field_rows JSONB; equipment_rows JSONB;
 labor_open BIGINT; labor_review BIGINT; material_review BIGINT;
 progress_unresolved BIGINT; progress_review BIGINT; field_review BIGINT; field_expired BIGINT;
 equipment_checkout BIGINT; equipment_downtime BIGINT; equipment_fault BIGINT;
 checklist_passed BOOLEAN; inspection_passed BOOLEAN; file_passed BOOLEAN; hard_passed BOOLEAN;
BEGIN
 IF NOT public.canonical_completion_requirements_valid(gate_requirements_value) THEN
  RAISE EXCEPTION 'Completion gate requirements are invalid'
   USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid';
 END IF;

 IF evaluated_at IS NULL OR evidence_value->>'complete' IS DISTINCT FROM 'true'
 OR jsonb_typeof(evidence_value->'labor') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'materials') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'progress') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'field') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'equipmentEvents') IS DISTINCT FROM 'array'
 OR jsonb_typeof(evidence_value->'equipmentLedgers') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Complete isolated evidence required' USING ERRCODE='22023'; END IF;
 assignment_record:=jsonb_populate_record(NULL::public.canonical_schedule_assignments,assignment_value);
 IF assignment_record.id IS NULL OR assignment_record.revision IS NULL OR assignment_record.canonical_digest IS NULL THEN
  RAISE EXCEPTION 'Current assignment required' USING ERRCODE='22023'; END IF;

 WITH current_rows AS (
  SELECT interval.id,interval.revision,rtrim(interval.canonical_digest) AS digest,
    interval.review_state,interval.observed_end
  FROM jsonb_populate_recordset(NULL::public.canonical_labor_intervals,evidence_value->'labor') interval
  WHERE interval.organization_id=organization_id_value AND interval.execution_id=execution_id_value
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'digest',digest,
    'reviewState',review_state,'open',observed_end IS NULL) ORDER BY id),'[]'::jsonb),
   count(*) FILTER(WHERE observed_end IS NULL AND review_state<>'rejected'),
   count(*) FILTER(WHERE review_state='needs_review')
 INTO labor_rows,labor_open,labor_review FROM current_rows;

 WITH current_rows AS (
  SELECT movement.id,movement.revision,rtrim(movement.canonical_digest) AS digest,movement.review_state
  FROM jsonb_populate_recordset(NULL::public.canonical_material_movements,evidence_value->'materials') movement
  WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'digest',digest,
    'reviewState',review_state) ORDER BY id),'[]'::jsonb),
   count(*) FILTER(WHERE review_state='needs_review')
 INTO material_rows,material_review FROM current_rows;

 WITH latest AS (
  SELECT DISTINCT ON(record.root_id) record.id,record.root_id,record.revision,
    rtrim(record.canonical_digest) AS digest,record.evidence_type,record.document
  FROM jsonb_populate_recordset(NULL::public.canonical_progress_records,evidence_value->'progress') record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
  ORDER BY record.root_id,record.revision DESC,record.id DESC
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rootId',root_id,'revision',revision,
    'digest',digest,'kind',evidence_type,'reviewState',document->>'reviewState',
    'issueState',document->>'state') ORDER BY root_id),'[]'::jsonb),
   count(*) FILTER(WHERE evidence_type IN ('blocker','exception') AND document->>'state'<>'resolved'),
   count(*) FILTER(WHERE document->>'reviewState' IN ('needs_review','disputed'))
 INTO progress_rows,progress_unresolved,progress_review FROM latest;

 WITH latest AS (
  SELECT DISTINCT ON(record.root_id) record.id,record.root_id,record.revision,
    rtrim(record.canonical_digest) AS digest,record.evidence_type,record.document
  FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
  ORDER BY record.root_id,record.revision DESC,record.id DESC
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rootId',root_id,'revision',revision,
    'digest',digest,'kind',evidence_type,'resultType',document->>'resultType',
    'retainedUntil',document->>'retainedUntil') ORDER BY root_id),'[]'::jsonb),
   count(*) FILTER(WHERE document->>'resultType'='needs_review'
     OR document#>>'{accessibility,state}'='needs_review'),
   count(*) FILTER(WHERE evidence_type='file' AND (document->>'retainedUntil')::timestamptz<=evaluated_at)
 INTO field_rows,field_review,field_expired FROM latest;

 WITH used_assets AS (
  SELECT DISTINCT event.asset_id
  FROM jsonb_populate_recordset(NULL::public.canonical_equipment_events,evidence_value->'equipmentEvents') event
  WHERE event.organization_id=organization_id_value AND event.execution_id=execution_id_value
 ), current_rows AS (
  SELECT asset.asset_id,COALESCE(ledger.revision,0) AS revision,rtrim(ledger.digest) AS digest,
    COALESCE(ledger.state,'{}'::jsonb) AS state
  FROM used_assets asset LEFT JOIN jsonb_populate_recordset(NULL::public.canonical_equipment_ledgers,evidence_value->'equipmentLedgers') ledger
    ON ledger.organization_id=organization_id_value AND ledger.asset_id=asset.asset_id
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object('assetId',asset_id,'revision',revision,'digest',digest,
    'availability',state->>'availability','checkedOutExecution',state->>'checkedOutExecution',
    'downtime',COALESCE((state->>'downtime')::boolean,FALSE),'recordedFault',COALESCE((state->>'recordedFault')::boolean,FALSE))
    ORDER BY asset_id),'[]'::jsonb),
   count(*) FILTER(WHERE state->>'checkedOutExecution'=execution_id_value::text),
   count(*) FILTER(WHERE COALESCE((state->>'downtime')::boolean,FALSE)),
   count(*) FILTER(WHERE COALESCE((state->>'recordedFault')::boolean,FALSE))
 INTO equipment_rows,equipment_checkout,equipment_downtime,equipment_fault FROM current_rows;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',pin->>'id','revision',(pin->>'revision')::bigint,'digest',pin->>'digest',
   'matched',checklist.id IS NOT NULL,'requiredItemCount',COALESCE(stats.required_count,0),
   'satisfiedRequiredItemCount',COALESCE(stats.satisfied_count,0),
   'passed',COALESCE(checklist.id IS NOT NULL AND stats.required_count=stats.satisfied_count,FALSE)
 ) ORDER BY pin->>'id'),'[]'::jsonb) INTO checklist_gates
 FROM jsonb_array_elements(gate_requirements_value->'checklists') pin
 LEFT JOIN LATERAL (
  SELECT record.* FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value
    AND record.id=(pin->>'id')::uuid AND record.revision=(pin->>'revision')::bigint
    AND rtrim(record.canonical_digest)=pin->>'digest' AND record.evidence_type='checklist'
    AND NOT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') successor
      WHERE successor.organization_id=record.organization_id AND successor.previous_record_id=record.id)
 ) checklist ON TRUE
 LEFT JOIN LATERAL (
  SELECT count(*) FILTER(WHERE (item->>'required')::boolean) AS required_count,
    count(*) FILTER(WHERE (item->>'required')::boolean AND EXISTS(
      SELECT 1 FROM (
       SELECT DISTINCT ON(response.root_id) response.document
       FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') response
       WHERE response.organization_id=organization_id_value AND response.execution_id=execution_id_value
         AND response.evidence_type='checklist_response'
         AND response.document->>'checklistId'=checklist.id::text
         AND response.document->>'itemKey'=item->>'key'
       ORDER BY response.root_id,response.revision DESC,response.id DESC
      ) current_response
      WHERE current_response.document->>'resultType' IN ('pass','observation','measurement')
    )) AS satisfied_count
  FROM jsonb_array_elements(checklist.document->'items') item
 ) stats ON TRUE;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',pin->>'id','revision',(pin->>'revision')::bigint,'digest',pin->>'digest',
   'matched',record.id IS NOT NULL,'resultType',record.document->>'resultType',
   'passed',COALESCE(record.id IS NOT NULL AND record.document->>'resultType'='pass',FALSE)
 ) ORDER BY pin->>'id'),'[]'::jsonb) INTO inspection_gates
 FROM jsonb_array_elements(gate_requirements_value->'inspections') pin
 LEFT JOIN LATERAL (
  SELECT evidence.* FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') evidence
  WHERE evidence.organization_id=organization_id_value AND evidence.execution_id=execution_id_value
    AND evidence.id=(pin->>'id')::uuid AND evidence.revision=(pin->>'revision')::bigint
    AND rtrim(evidence.canonical_digest)=pin->>'digest' AND evidence.evidence_type='observation'
    AND evidence.document->>'observationClass'='inspection'
    AND NOT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') successor
      WHERE successor.organization_id=evidence.organization_id AND successor.previous_record_id=evidence.id)
 ) record ON TRUE;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',pin->>'id','revision',(pin->>'revision')::bigint,'digest',pin->>'digest',
   'matched',record.id IS NOT NULL,'retainedUntil',record.document->>'retainedUntil',
   'passed',COALESCE(record.id IS NOT NULL AND record.document->>'quarantineDisposition'='released_after_clean_scan'
     AND (record.document->>'retainedUntil')::timestamptz>evaluated_at,FALSE)
 ) ORDER BY pin->>'id'),'[]'::jsonb) INTO file_gates
 FROM jsonb_array_elements(gate_requirements_value->'files') pin
 LEFT JOIN LATERAL (
  SELECT evidence.* FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') evidence
  WHERE evidence.organization_id=organization_id_value AND evidence.execution_id=execution_id_value
    AND evidence.id=(pin->>'id')::uuid AND evidence.revision=(pin->>'revision')::bigint
    AND rtrim(evidence.canonical_digest)=pin->>'digest' AND evidence.evidence_type='file'
    AND NOT EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.canonical_field_evidence_records,evidence_value->'field') successor
      WHERE successor.organization_id=evidence.organization_id AND successor.previous_record_id=evidence.id)
 ) record ON TRUE;

 RETURN public.canonical_completion_reduce_gates(
  execution_id_value,
  jsonb_build_object('id',assignment_record.id,'revision',assignment_record.revision,'digest',rtrim(assignment_record.canonical_digest)),
  gate_requirements_value,
  checklist_gates,
  inspection_gates,
  file_gates,
  labor_rows,
  material_rows,
  progress_rows,
  field_rows,
  equipment_rows,
  labor_open,
  labor_review,
  material_review,
  progress_unresolved,
  progress_review,
  field_review,
  field_expired,
  equipment_checkout,
  equipment_downtime,
  equipment_fault);
END $$;
REVOKE ALL ON FUNCTION public.canonical_work_lifecycle_after(TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operations_progress_successor_document(TEXT,JSONB,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_completion_reduce_gates(UUID,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB,BIGINT,BIGINT,BIGINT,BIGINT,BIGINT,BIGINT,BIGINT,BIGINT,BIGINT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operations_document_valid(TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_demo_completion_gate_snapshot(UUID,UUID,JSONB,JSONB,JSONB,TIMESTAMPTZ) FROM PUBLIC;
