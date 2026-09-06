-- Mission 23 Part 8: evidence-pinned completion proposals, explicit approval,
-- cancellation, reopening, resume-after-reopen and append-only corrections.
-- No inferred completion, rendered UI, Polaris, downstream handoff, provider,
-- customer-contact, quote, invoice, payment or scheduling mutation authority.

ALTER TABLE public.canonical_field_executions
  DROP CONSTRAINT canonical_field_executions_state_check,
  ADD CONSTRAINT canonical_field_executions_state_check CHECK (
    lifecycle_state IN ('not_started','in_progress','paused','completion_pending','completed','reopened','cancelled')
  ),
  DROP CONSTRAINT canonical_field_executions_action_check,
  ADD CONSTRAINT canonical_field_executions_action_check CHECK (
    last_action_code IN ('initialize','start','pause','resume','propose_completion','approve_completion',
      'withdraw_completion','cancel_execution','reopen_execution','resume_reopened')
  );

ALTER TABLE public.canonical_field_execution_events
  DROP CONSTRAINT canonical_field_execution_events_action_check,
  ADD CONSTRAINT canonical_field_execution_events_action_check CHECK (
    action_code IN ('initialize','start','pause','resume','propose_completion','approve_completion',
      'withdraw_completion','cancel_execution','reopen_execution','resume_reopened')
  );

ALTER TABLE public.canonical_field_execution_revisions
  DROP CONSTRAINT canonical_field_execution_revisions_state_check,
  ADD CONSTRAINT canonical_field_execution_revisions_state_check CHECK (
    lifecycle_state IN ('not_started','in_progress','paused','completion_pending','completed','reopened','cancelled')
  ),
  DROP CONSTRAINT canonical_field_execution_revisions_action_check,
  ADD CONSTRAINT canonical_field_execution_revisions_action_check CHECK (
    action_code IN ('initialize','start','pause','resume','propose_completion','approve_completion',
      'withdraw_completion','cancel_execution','reopen_execution','resume_reopened')
  );

ALTER TABLE public.canonical_field_execution_audit_events
  DROP CONSTRAINT canonical_field_execution_audit_action_check,
  ADD CONSTRAINT canonical_field_execution_audit_action_check CHECK (
    action_code IN ('initialize','start','pause','resume','propose_completion','approve_completion',
      'withdraw_completion','cancel_execution','reopen_execution','resume_reopened')
  );

ALTER TABLE public.canonical_field_execution_idempotency
  DROP CONSTRAINT canonical_field_execution_idempotency_action_check,
  ADD CONSTRAINT canonical_field_execution_idempotency_action_check CHECK (
    action_code IN ('initialize','start','pause','resume','propose_completion','approve_completion',
      'withdraw_completion','cancel_execution','reopen_execution','resume_reopened')
  );

CREATE FUNCTION public.canonical_completion_digest(value JSONB)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex')
$$;

CREATE FUNCTION public.canonical_completion_pin_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (public.canonical_field_evidence_object_keys_exact(value,ARRAY['id','revision','digest'])
   AND public.canonical_field_evidence_uuid_valid(value->>'id')
   AND jsonb_typeof(value->'revision')='number'
   AND value->>'revision'~'^[1-9][0-9]{0,14}$'
   AND value->>'digest'~'^[0-9a-f]{64}$') IS TRUE
$$;

CREATE FUNCTION public.canonical_completion_pins_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pin JSONB;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>20 THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(value) item)<>jsonb_array_length(value) THEN RETURN FALSE; END IF;
 FOR pin IN SELECT item FROM jsonb_array_elements(value) item LOOP
  IF NOT public.canonical_completion_pin_valid(pin) THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_completion_requirements_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (public.canonical_field_evidence_object_keys_exact(value,ARRAY['checklists','inspections','files'])
   AND public.canonical_completion_pins_valid(value->'checklists')
   AND public.canonical_completion_pins_valid(value->'inspections')
   AND public.canonical_completion_pins_valid(value->'files')) IS TRUE
$$;

CREATE TABLE public.canonical_completion_records (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 execution_id UUID NOT NULL,
 assignment_id UUID NOT NULL,
 root_id UUID NOT NULL,
 previous_record_id UUID,
 record_kind TEXT NOT NULL,
 subject_kind TEXT NOT NULL,
 revision BIGINT NOT NULL,
 related_proposal_id UUID,
 related_completion_id UUID,
 lifecycle_before TEXT NOT NULL,
 lifecycle_after TEXT NOT NULL,
 source_execution_revision BIGINT NOT NULL,
 source_execution_digest CHAR(64) NOT NULL,
 resulting_execution_revision BIGINT NOT NULL,
 resulting_execution_digest CHAR(64) NOT NULL,
 source_assignment_revision BIGINT NOT NULL,
 source_assignment_digest CHAR(64) NOT NULL,
 gate_requirements JSONB NOT NULL,
 gate_snapshot JSONB NOT NULL,
 document JSONB NOT NULL,
 canonical_digest CHAR(64) NOT NULL,
 recorded_by_user_id UUID NOT NULL,
 performed_by_profile_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 action_code TEXT NOT NULL,
 reason TEXT NOT NULL,
 request_correlation_id VARCHAR(128) NOT NULL,
 transaction_id BIGINT NOT NULL DEFAULT txid_current(),
 decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 expires_at TIMESTAMPTZ,
 CONSTRAINT canonical_completion_records_tenant_identity UNIQUE(organization_id,id),
 CONSTRAINT canonical_completion_records_root_revision UNIQUE(organization_id,root_id,revision),
 CONSTRAINT canonical_completion_records_execution_fk FOREIGN KEY(organization_id,execution_id)
   REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_assignment_fk FOREIGN KEY(organization_id,assignment_id)
   REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_root_fk FOREIGN KEY(organization_id,root_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT canonical_completion_records_previous_fk FOREIGN KEY(organization_id,previous_record_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_proposal_fk FOREIGN KEY(organization_id,related_proposal_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_completion_fk FOREIGN KEY(organization_id,related_completion_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id)
   REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id)
   REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id)
   REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_records_kind_check CHECK(record_kind IN
   ('proposal','approval','withdrawal','cancellation','reopening','resumption','correction')),
 CONSTRAINT canonical_completion_records_subject_check CHECK(subject_kind IN
   ('proposal','approval','withdrawal','cancellation','reopening','resumption')),
 CONSTRAINT canonical_completion_records_chain_check CHECK(
   (record_kind<>'correction' AND subject_kind=record_kind AND revision=1 AND root_id=id AND previous_record_id IS NULL)
   OR (record_kind='correction' AND subject_kind<>'correction' AND revision>1 AND root_id<>id AND previous_record_id IS NOT NULL)),
 CONSTRAINT canonical_completion_records_relation_check CHECK(
   (record_kind='proposal' AND related_proposal_id IS NULL AND related_completion_id IS NULL)
   OR (record_kind IN ('approval','withdrawal') AND related_proposal_id IS NOT NULL AND related_completion_id IS NULL)
   OR (record_kind='cancellation' AND related_completion_id IS NULL)
   OR (record_kind='reopening' AND related_proposal_id IS NULL AND related_completion_id IS NOT NULL)
   OR (record_kind='resumption' AND related_proposal_id IS NULL AND related_completion_id IS NOT NULL)
   OR record_kind='correction'),
 CONSTRAINT canonical_completion_records_lifecycle_check CHECK(
   lifecycle_before IN ('not_started','in_progress','paused','completion_pending','completed','reopened','cancelled')
   AND lifecycle_after IN ('not_started','in_progress','paused','completion_pending','completed','reopened','cancelled')),
 CONSTRAINT canonical_completion_records_revision_shape CHECK(
   source_execution_revision>=1 AND resulting_execution_revision>=1 AND source_assignment_revision>=1
   AND ((record_kind='correction' AND resulting_execution_revision=source_execution_revision
       AND resulting_execution_digest=source_execution_digest AND lifecycle_after=lifecycle_before)
     OR (record_kind<>'correction' AND resulting_execution_revision=source_execution_revision+1))),
 CONSTRAINT canonical_completion_records_digest_check CHECK(
   source_execution_digest~'^[0-9a-f]{64}$' AND resulting_execution_digest~'^[0-9a-f]{64}$'
   AND source_assignment_digest~'^[0-9a-f]{64}$' AND canonical_digest~'^[0-9a-f]{64}$'),
 CONSTRAINT canonical_completion_records_gate_check CHECK(
   public.canonical_completion_requirements_valid(gate_requirements)
   AND jsonb_typeof(gate_snapshot)='object' AND octet_length(gate_snapshot::text)<=131072),
 CONSTRAINT canonical_completion_records_document_check CHECK(
   jsonb_typeof(document)='object' AND document->>'contractVersion'='m23-completion-authority-v1'
   AND document->>'kind'=record_kind AND octet_length(document::text)<=16000),
 CONSTRAINT canonical_completion_records_action_check CHECK(action_code IN
   ('propose_completion','approve_completion','withdraw_completion','cancel_execution',
    'reopen_execution','resume_reopened','correct_completion')),
 CONSTRAINT canonical_completion_records_expiry_check CHECK(
   (record_kind='proposal' AND expires_at IS NOT NULL) OR (record_kind<>'proposal' AND expires_at IS NULL)),
 CONSTRAINT canonical_completion_records_reason_check CHECK(
   public.canonical_field_execution_reason_valid(reason)
   AND public.canonical_progress_text_valid(reason)),
 CONSTRAINT canonical_completion_records_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);

ALTER TABLE public.canonical_completion_records ADD CONSTRAINT canonical_completion_records_digest_valid CHECK(
 rtrim(canonical_digest)=public.canonical_completion_digest(jsonb_build_object(
  'action',action_code,'assignmentDigest',rtrim(source_assignment_digest),'assignmentId',assignment_id,
  'assignmentRevision',source_assignment_revision,'document',document,'executionId',execution_id,
  'gateRequirements',gate_requirements,'gateSnapshot',gate_snapshot,'lifecycleAfter',lifecycle_after,
  'lifecycleBefore',lifecycle_before,'performedBy',performed_by_profile_id,'previousRecordId',previous_record_id,
  'recordedBy',recorded_by_user_id,'recordKind',record_kind,'relatedCompletionId',related_completion_id,
  'relatedProposalId',related_proposal_id,'resultingExecutionDigest',rtrim(resulting_execution_digest),
  'resultingExecutionRevision',resulting_execution_revision,'revision',revision,'rootId',root_id,
  'sourceExecutionDigest',rtrim(source_execution_digest),'sourceExecutionRevision',source_execution_revision,
  'subjectKind',subject_kind
 ))
);

CREATE INDEX canonical_completion_execution_time
 ON public.canonical_completion_records(organization_id,execution_id,decided_at DESC,id DESC);
CREATE UNIQUE INDEX canonical_completion_predecessor_unique
 ON public.canonical_completion_records(organization_id,previous_record_id) WHERE previous_record_id IS NOT NULL;
CREATE UNIQUE INDEX canonical_completion_proposal_resolution_unique
 ON public.canonical_completion_records(organization_id,related_proposal_id)
 WHERE record_kind IN ('approval','withdrawal','cancellation') AND related_proposal_id IS NOT NULL;
CREATE UNIQUE INDEX canonical_completion_reopening_unique
 ON public.canonical_completion_records(organization_id,related_completion_id)
 WHERE record_kind='reopening';

CREATE TABLE public.canonical_completion_events (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 execution_id UUID NOT NULL,
 record_id UUID NOT NULL,
 root_id UUID NOT NULL,
 action_code TEXT NOT NULL,
 before_execution_revision BIGINT NOT NULL,
 after_execution_revision BIGINT NOT NULL,
 before_execution_digest CHAR(64) NOT NULL,
 after_execution_digest CHAR(64) NOT NULL,
 idempotency_key_hash CHAR(64) NOT NULL,
 request_digest CHAR(64) NOT NULL,
 recorded_by_user_id UUID NOT NULL,
 performed_by_profile_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_correlation_id VARCHAR(128) NOT NULL,
 transaction_id BIGINT NOT NULL DEFAULT txid_current(),
 decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT canonical_completion_events_tenant_identity UNIQUE(organization_id,id),
 CONSTRAINT canonical_completion_events_record_unique UNIQUE(organization_id,record_id),
 CONSTRAINT canonical_completion_events_execution_fk FOREIGN KEY(organization_id,execution_id)
   REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_events_record_fk FOREIGN KEY(organization_id,record_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_events_root_fk FOREIGN KEY(organization_id,root_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_events_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id)
   REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_events_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id)
   REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_events_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id)
   REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_events_action_check CHECK(action_code IN
   ('propose_completion','approve_completion','withdraw_completion','cancel_execution',
    'reopen_execution','resume_reopened','correct_completion')),
 CONSTRAINT canonical_completion_events_digest_check CHECK(before_execution_digest~'^[0-9a-f]{64}$'
   AND after_execution_digest~'^[0-9a-f]{64}$' AND idempotency_key_hash~'^[0-9a-f]{64}$'
   AND request_digest~'^[0-9a-f]{64}$'),
 CONSTRAINT canonical_completion_events_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);

CREATE TABLE public.canonical_completion_audit_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 execution_id UUID NOT NULL,
 record_id UUID NOT NULL,
 event_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,
 performed_by_profile_id UUID NOT NULL,
 action_code TEXT NOT NULL,
 reason TEXT NOT NULL,
 request_digest CHAR(64) NOT NULL,
 request_correlation_id VARCHAR(128) NOT NULL,
 transaction_id BIGINT NOT NULL DEFAULT txid_current(),
 decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT canonical_completion_audit_tenant_identity UNIQUE(organization_id,id),
 CONSTRAINT canonical_completion_audit_event_unique UNIQUE(organization_id,event_id),
 CONSTRAINT canonical_completion_audit_record_unique UNIQUE(organization_id,record_id),
 CONSTRAINT canonical_completion_audit_execution_fk FOREIGN KEY(organization_id,execution_id)
   REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_audit_record_fk FOREIGN KEY(organization_id,record_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_audit_event_fk FOREIGN KEY(organization_id,event_id)
   REFERENCES public.canonical_completion_events(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_audit_actor_fk FOREIGN KEY(organization_id,actor_user_id)
   REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_audit_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id)
   REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_audit_reason_check CHECK(
   public.canonical_field_execution_reason_valid(reason)
   AND public.canonical_progress_text_valid(reason)),
 CONSTRAINT canonical_completion_audit_digest_check CHECK(request_digest~'^[0-9a-f]{64}$'),
 CONSTRAINT canonical_completion_audit_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);

CREATE TABLE public.canonical_completion_idempotency (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 idempotency_key_hash CHAR(64) NOT NULL,
 request_digest CHAR(64) NOT NULL,
 action_code TEXT NOT NULL,
 execution_id UUID NOT NULL,
 record_id UUID NOT NULL,
 event_id UUID NOT NULL,
 response_status INTEGER NOT NULL,
 response_body JSONB NOT NULL,
 transaction_id BIGINT NOT NULL DEFAULT txid_current(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT canonical_completion_idempotency_primary PRIMARY KEY(organization_id,actor_user_id,idempotency_key_hash),
 CONSTRAINT canonical_completion_idempotency_actor_fk FOREIGN KEY(organization_id,actor_user_id)
   REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_idempotency_session_fk FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
   REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_idempotency_execution_fk FOREIGN KEY(organization_id,execution_id)
   REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_idempotency_record_fk FOREIGN KEY(organization_id,record_id)
   REFERENCES public.canonical_completion_records(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_idempotency_event_fk FOREIGN KEY(organization_id,event_id)
   REFERENCES public.canonical_completion_events(organization_id,id) ON DELETE RESTRICT,
 CONSTRAINT canonical_completion_idempotency_action_check CHECK(action_code IN
   ('propose_completion','approve_completion','withdraw_completion','cancel_execution',
    'reopen_execution','resume_reopened','correct_completion')),
 CONSTRAINT canonical_completion_idempotency_digest_check CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'
   AND request_digest~'^[0-9a-f]{64}$'),
 CONSTRAINT canonical_completion_idempotency_response_check CHECK(response_status=200
   AND jsonb_typeof(response_body)='object' AND octet_length(response_body::text)<=262144)
);

CREATE FUNCTION public.canonical_completion_gate_snapshot(
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
  'assignment',jsonb_build_object('id',assignment_record.id,'revision',assignment_record.revision,
    'digest',rtrim(assignment_record.canonical_digest)),
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

CREATE FUNCTION public.canonical_completion_projection(record_value public.canonical_completion_records)
RETURNS JSONB LANGUAGE SQL STABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',record_value.id,'executionId',record_value.execution_id,'assignmentId',record_value.assignment_id,
  'rootId',record_value.root_id,'previousRecordId',record_value.previous_record_id,
  'recordKind',record_value.record_kind,'subjectKind',record_value.subject_kind,'revision',record_value.revision,
  'relatedProposalId',record_value.related_proposal_id,'relatedCompletionId',record_value.related_completion_id,
  'lifecycleBefore',record_value.lifecycle_before,'lifecycleAfter',record_value.lifecycle_after,
  'sourceExecutionRevision',record_value.source_execution_revision,
  'sourceExecutionDigest',rtrim(record_value.source_execution_digest),
  'resultingExecutionRevision',record_value.resulting_execution_revision,
  'resultingExecutionDigest',rtrim(record_value.resulting_execution_digest),
  'sourceAssignmentRevision',record_value.source_assignment_revision,
  'sourceAssignmentDigest',rtrim(record_value.source_assignment_digest),
  'gateRequirements',record_value.gate_requirements,'gateSnapshot',record_value.gate_snapshot,
  'document',record_value.document,'digest',rtrim(record_value.canonical_digest),
  'recordedByUserId',record_value.recorded_by_user_id,
  'performedByProfileId',record_value.performed_by_profile_id,
  'action',record_value.action_code,'reason',record_value.reason,
  'decidedAt',to_char(record_value.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expiresAt',CASE WHEN record_value.expires_at IS NULL THEN NULL ELSE
    to_char(record_value.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
 )
$$;

CREATE OR REPLACE FUNCTION public.canonical_field_execution_guard_current()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE expected_digest TEXT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Canonical field execution current state cannot be deleted'
  USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_delete_forbidden'; END IF;
 expected_digest:=public.canonical_field_execution_digest(NEW.id,NEW.appointment_id,NEW.operation_id,
  NEW.graph_id,NEW.opportunity_id,NEW.assignment_id,NEW.lifecycle_state,NEW.source_assignment_revision,
  rtrim(NEW.source_assignment_digest),NEW.last_recorded_by_user_id,NEW.last_performed_by_profile_id);
 IF rtrim(NEW.canonical_digest)<>expected_digest OR NEW.last_transaction_id<>txid_current()::bigint THEN
  RAISE EXCEPTION 'Canonical field execution current state digest is invalid'
   USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_digest_invalid'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.lifecycle_state<>'not_started' OR NEW.last_action_code<>'initialize' THEN
   RAISE EXCEPTION 'Canonical field execution initial state is invalid'
    USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_initial_invalid'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id OR NEW.appointment_id<>OLD.appointment_id
  OR NEW.operation_id<>OLD.operation_id OR NEW.graph_id<>OLD.graph_id OR NEW.opportunity_id<>OLD.opportunity_id
  OR NEW.assignment_id<>OLD.assignment_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Canonical field execution identity or revision is invalid'
   USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_identity_immutable'; END IF;
 IF NOT (
  (OLD.lifecycle_state='not_started' AND NEW.lifecycle_state='in_progress' AND NEW.last_action_code='start')
  OR (OLD.lifecycle_state='in_progress' AND NEW.lifecycle_state='paused' AND NEW.last_action_code='pause')
  OR (OLD.lifecycle_state='paused' AND NEW.lifecycle_state='in_progress' AND NEW.last_action_code='resume')
  OR (OLD.lifecycle_state IN ('in_progress','paused','reopened') AND NEW.lifecycle_state='completion_pending' AND NEW.last_action_code='propose_completion')
  OR (OLD.lifecycle_state='completion_pending' AND NEW.lifecycle_state='completed' AND NEW.last_action_code='approve_completion')
  OR (OLD.lifecycle_state='completion_pending' AND NEW.lifecycle_state IN ('in_progress','paused','reopened') AND NEW.last_action_code='withdraw_completion')
  OR (OLD.lifecycle_state IN ('not_started','in_progress','paused','completion_pending','reopened') AND NEW.lifecycle_state='cancelled' AND NEW.last_action_code='cancel_execution')
  OR (OLD.lifecycle_state='completed' AND NEW.lifecycle_state='reopened' AND NEW.last_action_code='reopen_execution')
  OR (OLD.lifecycle_state='reopened' AND NEW.lifecycle_state='in_progress' AND NEW.last_action_code='resume_reopened')
 ) THEN RAISE EXCEPTION 'Canonical field execution lifecycle transition is invalid'
  USING ERRCODE='23514',CONSTRAINT='canonical_completion_transition_invalid'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.canonical_completion_evidence_immutable()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Canonical completion evidence is immutable'
  USING ERRCODE='23514',CONSTRAINT='canonical_completion_evidence_immutable';
END $$;

CREATE TRIGGER canonical_completion_records_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_completion_records FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_completion_evidence_immutable();
CREATE TRIGGER canonical_completion_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_completion_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_completion_evidence_immutable();
CREATE TRIGGER canonical_completion_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_completion_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_completion_evidence_immutable();
CREATE TRIGGER canonical_completion_idempotency_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_completion_idempotency FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_completion_evidence_immutable();

CREATE FUNCTION public.canonical_completion_validate_complete()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.canonical_completion_events event
  JOIN public.canonical_completion_audit_events audit
    ON audit.organization_id=event.organization_id AND audit.event_id=event.id AND audit.record_id=event.record_id
  JOIN public.canonical_completion_idempotency receipt
    ON receipt.organization_id=event.organization_id AND receipt.event_id=event.id AND receipt.record_id=event.record_id
   AND receipt.actor_user_id=event.recorded_by_user_id AND receipt.auth_session_id=event.auth_session_id
  WHERE event.organization_id=NEW.organization_id AND event.record_id=NEW.id
    AND event.execution_id=NEW.execution_id AND event.root_id=NEW.root_id AND event.action_code=NEW.action_code
    AND event.before_execution_revision=NEW.source_execution_revision
    AND event.after_execution_revision=NEW.resulting_execution_revision
    AND rtrim(event.before_execution_digest)=rtrim(NEW.source_execution_digest)
    AND rtrim(event.after_execution_digest)=rtrim(NEW.resulting_execution_digest)
    AND event.recorded_by_user_id=NEW.recorded_by_user_id
    AND event.performed_by_profile_id=NEW.performed_by_profile_id
    AND event.transaction_id=NEW.transaction_id
    AND audit.actor_user_id=NEW.recorded_by_user_id AND audit.performed_by_profile_id=NEW.performed_by_profile_id
    AND audit.action_code=NEW.action_code AND audit.reason=NEW.reason
    AND rtrim(audit.request_digest)=rtrim(event.request_digest)
    AND audit.request_correlation_id=NEW.request_correlation_id AND audit.transaction_id=NEW.transaction_id
    AND rtrim(receipt.request_digest)=rtrim(event.request_digest) AND receipt.action_code=NEW.action_code
    AND receipt.execution_id=NEW.execution_id AND receipt.response_body#>>'{completionRecord,id}'=NEW.id::text
    AND receipt.transaction_id=NEW.transaction_id
 ) THEN RAISE EXCEPTION 'Canonical completion mutation did not commit complete evidence'
  USING ERRCODE='23514',CONSTRAINT='canonical_completion_evidence_incomplete'; END IF;
 IF NEW.revision>1 AND (SELECT count(*) FROM public.canonical_completion_records history
   WHERE history.organization_id=NEW.organization_id AND history.root_id=NEW.root_id AND history.revision<=NEW.revision)<>NEW.revision THEN
  RAISE EXCEPTION 'Canonical completion correction history has a gap'
   USING ERRCODE='23514',CONSTRAINT='canonical_completion_evidence_incomplete'; END IF;
 RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER canonical_completion_complete AFTER INSERT ON public.canonical_completion_records
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.canonical_completion_validate_complete();

CREATE FUNCTION public.canonical_completion_work_lock(org UUID,execution_value UUID,write_value BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.canonical_progress_work_lock(org,execution_value,write_value);
END $$;

CREATE FUNCTION public.canonical_completion_mutate(
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
  record_kind_value:='proposal';subject_kind_value:='proposal';after_state_value:='completion_pending';
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
   record_kind_value:='approval';subject_kind_value:='approval';after_state_value:='completed';
   document_value:=jsonb_build_object('kind','approval','contractVersion','m23-completion-authority-v1',
    'proposal',input_value->'proposal','gateSnapshotDigest',public.canonical_completion_digest(gate_snapshot_value));
  ELSE
   record_kind_value:='withdrawal';subject_kind_value:='withdrawal';after_state_value:=proposal_record.lifecycle_before;
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
  record_kind_value:='cancellation';subject_kind_value:='cancellation';after_state_value:='cancelled';
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
  record_kind_value:='reopening';subject_kind_value:='reopening';after_state_value:='reopened';
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
  record_kind_value:='resumption';subject_kind_value:='resumption';after_state_value:='in_progress';
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
  after_state_value:=before_state_value;
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

CREATE FUNCTION public.canonical_completion_read(
 organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
 auth_session_id_value UUID, execution_id_value UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; actor_profile_id UUID; execution_record public.canonical_field_executions%ROWTYPE;
 total_records BIGINT; records_value JSONB; active_proposal public.canonical_completion_records%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
  RAISE EXCEPTION 'Completion reads require a bounded snapshot'
   USING ERRCODE='25001',CONSTRAINT='canonical_completion_snapshot_required'; END IF;
 PERFORM public.canonical_completion_work_lock(organization_id_value,execution_id_value,FALSE);
 authority:=public.canonical_field_execution_actor_authority(organization_id_value,actor_user_id_value,
  actor_access_role_value,auth_session_id_value,NULL,FALSE);
 actor_profile_id:=(authority->>'profileId')::uuid;
 SELECT * INTO execution_record FROM public.canonical_field_executions execution
  WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value;
 IF NOT FOUND OR NOT public.canonical_field_execution_replay_authorized(organization_id_value,
   actor_access_role_value,actor_profile_id,execution_id_value,NULL) THEN
  RAISE EXCEPTION 'Completion authority not found'
   USING ERRCODE='P0002',CONSTRAINT='canonical_completion_not_found'; END IF;
 SELECT count(*) INTO total_records FROM public.canonical_completion_records record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value;
 SELECT COALESCE(jsonb_agg(public.canonical_completion_projection(record)
   ORDER BY record.decided_at DESC,record.id DESC),'[]'::jsonb)
 INTO records_value FROM (SELECT * FROM public.canonical_completion_records item
  WHERE item.organization_id=organization_id_value AND item.execution_id=execution_id_value
  ORDER BY item.decided_at DESC,item.id DESC LIMIT 200) record;
 IF execution_record.lifecycle_state='completion_pending' THEN
  SELECT * INTO active_proposal FROM public.canonical_completion_records proposal
   WHERE proposal.organization_id=organization_id_value AND proposal.execution_id=execution_id_value
    AND proposal.record_kind='proposal' AND proposal.resulting_execution_revision=execution_record.revision
    AND rtrim(proposal.resulting_execution_digest)=rtrim(execution_record.canonical_digest)
    AND NOT EXISTS(SELECT 1 FROM public.canonical_completion_records resolution
      WHERE resolution.organization_id=organization_id_value AND resolution.related_proposal_id=proposal.id
        AND resolution.record_kind IN ('approval','withdrawal','cancellation'))
   ORDER BY proposal.decided_at DESC,proposal.id DESC LIMIT 1;
 END IF;
 RETURN jsonb_build_object('success',TRUE,'data',jsonb_build_object(
  'execution',public.canonical_field_execution_projection(execution_record),
  'activeProposal',CASE WHEN active_proposal.id IS NULL THEN NULL ELSE
    public.canonical_completion_projection(active_proposal)||jsonb_build_object(
      'expired',active_proposal.expires_at<=transaction_timestamp()) END,
  'records',records_value,'totalRecordCount',total_records,'truncated',total_records>200,
  'authority','postgresql','completionInferred',FALSE,
  'interpretation','Explicit completion and reopening authority only; no schedule, customer acceptance, invoice, payment, warranty, regulatory or professional conclusion.'));
END $$;

DO $$ DECLARE relation RECORD; routine RECORD; BEGIN
 FOR relation IN SELECT oid::regclass AS identity FROM pg_class
  WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relname LIKE 'canonical_completion_%'
 LOOP EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC',relation.identity); END LOOP;
 FOR routine IN SELECT oid::regprocedure AS identity FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_completion_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',routine.identity); END LOOP;
END $$;
