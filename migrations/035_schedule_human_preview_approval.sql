-- Mission 22 Part 4: current-authority human preview and approval.
-- The preview is durable evidence, expires after exactly fifteen minutes, and
-- is never a bearer capability. Every applied mutation rechecks current
-- tenant, actor, session, CSRF, subscription, scope, target, schedule,
-- conflict, recommendation, warning, revision, digest, and time authority.

CREATE TABLE public.canonical_schedule_mutation_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  actor_access_role VARCHAR(16) NOT NULL,
  auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
  expected_revision BIGINT NOT NULL,
  expected_digest CHAR(64) NOT NULL,
  expected_time_zone VARCHAR(255) NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  proposed_target_kind VARCHAR(16) NOT NULL,
  proposed_target_id UUID,
  proposed_scheduled_start TIMESTAMPTZ,
  proposed_scheduled_end TIMESTAMPTZ,
  proposed_schedule_state VARCHAR(16) NOT NULL,
  proposed_dispatch_state VARCHAR(24) NOT NULL,
  proposed_appointment_status VARCHAR(50) NOT NULL,
  submitted_schedule JSONB NOT NULL,
  reason TEXT NOT NULL,
  conflict_evaluation JSONB NOT NULL,
  conflict_digest CHAR(64) NOT NULL,
  warning_digests JSONB NOT NULL,
  review_reason_digests JSONB NOT NULL,
  recommendation_digest CHAR(64) NOT NULL,
  recommendation_authority_digest CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  preview_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp() + INTERVAL '15 minutes',
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  CONSTRAINT canonical_schedule_previews_tenant_identity UNIQUE (organization_id,id),
  CONSTRAINT canonical_schedule_previews_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_previews_appointment_fk FOREIGN KEY (organization_id,appointment_id)
    REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_previews_actor_fk FOREIGN KEY (organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_previews_role_check CHECK (actor_access_role IN ('owner','admin','member')),
  CONSTRAINT canonical_schedule_previews_revision_check CHECK (expected_revision >= 1),
  CONSTRAINT canonical_schedule_previews_action_check CHECK (
    action_code IN ('assign','reassign','unassign','schedule','reschedule','dispatch')
  ),
  CONSTRAINT canonical_schedule_previews_target_check CHECK (
    (proposed_target_kind='unassigned' AND proposed_target_id IS NULL)
    OR (proposed_target_kind IN ('profile','crew') AND proposed_target_id IS NOT NULL)
  ),
  CONSTRAINT canonical_schedule_previews_schedule_check CHECK (
    (proposed_schedule_state='unscheduled' AND proposed_scheduled_start IS NULL AND proposed_scheduled_end IS NULL)
    OR (proposed_schedule_state='scheduled' AND proposed_scheduled_start IS NOT NULL
      AND proposed_scheduled_end IS NOT NULL AND proposed_scheduled_end > proposed_scheduled_start)
  ),
  CONSTRAINT canonical_schedule_previews_dispatch_check CHECK (
    proposed_dispatch_state IN ('not_dispatched','dispatched','revoked')
  ),
  CONSTRAINT canonical_schedule_previews_reason_check CHECK (
    length(btrim(reason)) BETWEEN 1 AND 1000 AND octet_length(reason) <= 4000
  ),
  CONSTRAINT canonical_schedule_previews_json_check CHECK (
    jsonb_typeof(submitted_schedule)='object'
    AND jsonb_typeof(conflict_evaluation)='object'
    AND jsonb_typeof(warning_digests)='array'
    AND jsonb_typeof(review_reason_digests)='array'
  ),
  CONSTRAINT canonical_schedule_previews_digest_check CHECK (
    expected_digest ~ '^[0-9a-f]{64}$' AND conflict_digest ~ '^[0-9a-f]{64}$'
    AND recommendation_digest ~ '^[0-9a-f]{64}$'
    AND recommendation_authority_digest ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$' AND preview_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_schedule_previews_expiry_check CHECK (
    expires_at = created_at + INTERVAL '15 minutes'
  )
);

CREATE INDEX canonical_schedule_previews_tenant_expiry
  ON public.canonical_schedule_mutation_previews(organization_id,expires_at,id);

CREATE TABLE public.canonical_schedule_human_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  preview_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  actor_access_role VARCHAR(16) NOT NULL,
  auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
  expected_revision BIGINT NOT NULL,
  expected_digest CHAR(64) NOT NULL,
  applied_revision BIGINT NOT NULL,
  applied_digest CHAR(64) NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  approved_target_kind VARCHAR(16) NOT NULL,
  approved_target_id UUID,
  approved_scheduled_start TIMESTAMPTZ,
  approved_scheduled_end TIMESTAMPTZ,
  resulting_schedule_state VARCHAR(16) NOT NULL,
  resulting_dispatch_state VARCHAR(24) NOT NULL,
  approved_appointment_status VARCHAR(50) NOT NULL,
  resulting_needs_review BOOLEAN NOT NULL,
  resulting_review_reasons JSONB NOT NULL,
  submitted_schedule JSONB NOT NULL,
  time_zone_authority JSONB NOT NULL,
  time_evidence_digest CHAR(64) NOT NULL,
  conflict_digest CHAR(64) NOT NULL,
  recommendation_digest CHAR(64) NOT NULL,
  recommendation_authority_digest CHAR(64) NOT NULL,
  acknowledged_warning_digests JSONB NOT NULL,
  acknowledged_review_reason_digests JSONB NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_schedule_human_approvals_tenant_identity UNIQUE (organization_id,id),
  CONSTRAINT canonical_schedule_human_approvals_preview_unique UNIQUE (organization_id,preview_id),
  CONSTRAINT canonical_schedule_human_approvals_idempotency_unique
    UNIQUE (organization_id,actor_user_id,idempotency_key_hash),
  CONSTRAINT canonical_schedule_human_approvals_preview_fk FOREIGN KEY (organization_id,preview_id)
    REFERENCES public.canonical_schedule_mutation_previews(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_approvals_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_approvals_appointment_fk FOREIGN KEY (organization_id,appointment_id)
    REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_approvals_actor_fk FOREIGN KEY (organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_approvals_role_check CHECK (actor_access_role IN ('owner','admin','member')),
  CONSTRAINT canonical_schedule_human_approvals_revision_check CHECK (
    expected_revision >= 1 AND applied_revision=expected_revision+1
  ),
  CONSTRAINT canonical_schedule_human_approvals_target_check CHECK (
    (approved_target_kind='unassigned' AND approved_target_id IS NULL)
    OR (approved_target_kind IN ('profile','crew') AND approved_target_id IS NOT NULL)
  ),
  CONSTRAINT canonical_schedule_human_approvals_schedule_check CHECK (
    (resulting_schedule_state='unscheduled' AND approved_scheduled_start IS NULL AND approved_scheduled_end IS NULL)
    OR (resulting_schedule_state='scheduled' AND approved_scheduled_start IS NOT NULL
      AND approved_scheduled_end IS NOT NULL AND approved_scheduled_end > approved_scheduled_start)
  ),
  CONSTRAINT canonical_schedule_human_approvals_review_check CHECK (
    jsonb_typeof(resulting_review_reasons)='array'
    AND (resulting_needs_review OR jsonb_array_length(resulting_review_reasons)=0)
    AND (NOT resulting_needs_review OR jsonb_array_length(resulting_review_reasons)>0)
  ),
  CONSTRAINT canonical_schedule_human_approvals_json_check CHECK (
    jsonb_typeof(submitted_schedule)='object' AND jsonb_typeof(time_zone_authority)='object'
    AND jsonb_typeof(acknowledged_warning_digests)='array'
    AND jsonb_typeof(acknowledged_review_reason_digests)='array'
  ),
  CONSTRAINT canonical_schedule_human_approvals_digest_check CHECK (
    expected_digest ~ '^[0-9a-f]{64}$' AND applied_digest ~ '^[0-9a-f]{64}$'
    AND time_evidence_digest ~ '^[0-9a-f]{64}$' AND conflict_digest ~ '^[0-9a-f]{64}$'
    AND recommendation_digest ~ '^[0-9a-f]{64}$'
    AND recommendation_authority_digest ~ '^[0-9a-f]{64}$'
    AND idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_schedule_human_approvals_reason_check CHECK (
    length(btrim(reason)) BETWEEN 1 AND 1000 AND octet_length(reason) <= 4000
  )
);

ALTER TABLE public.canonical_schedule_assignments
  ADD COLUMN last_human_approval_id UUID;
ALTER TABLE public.canonical_schedule_assignments
  ADD CONSTRAINT canonical_schedule_assignments_last_human_approval_fk
  FOREIGN KEY (organization_id,last_human_approval_id)
  REFERENCES public.canonical_schedule_human_approvals(organization_id,id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.canonical_schedule_assignment_revisions
  ADD COLUMN human_approval_id UUID;
ALTER TABLE public.canonical_schedule_assignment_revisions
  ADD CONSTRAINT canonical_schedule_revisions_human_approval_fk
  FOREIGN KEY (organization_id,human_approval_id)
  REFERENCES public.canonical_schedule_human_approvals(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE public.canonical_schedule_assignment_revisions
  DROP CONSTRAINT canonical_schedule_revisions_source_check;
ALTER TABLE public.canonical_schedule_assignment_revisions
  ADD CONSTRAINT canonical_schedule_revisions_source_check CHECK (
    (source_kind IN ('legacy_import','appointment_created') AND revision=1
      AND approval_id IS NULL AND human_approval_id IS NULL AND actor_user_id IS NULL AND request_digest IS NULL)
    OR (source_kind='human_approved' AND revision>1 AND approval_id IS NOT NULL
      AND human_approval_id IS NULL AND actor_user_id IS NOT NULL AND request_digest IS NOT NULL)
    OR (source_kind='human_preview_approved' AND revision>1 AND approval_id IS NULL
      AND human_approval_id IS NOT NULL AND actor_user_id IS NOT NULL AND request_digest IS NOT NULL)
  );

CREATE TABLE public.canonical_schedule_human_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  human_approval_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64) NOT NULL,
  after_digest CHAR(64) NOT NULL,
  details JSONB NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_schedule_human_audit_tenant_identity UNIQUE (organization_id,id),
  CONSTRAINT canonical_schedule_human_audit_approval_unique UNIQUE (organization_id,human_approval_id),
  CONSTRAINT canonical_schedule_human_audit_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_audit_approval_fk FOREIGN KEY (organization_id,human_approval_id)
    REFERENCES public.canonical_schedule_human_approvals(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_audit_actor_fk FOREIGN KEY (organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_audit_revision_check CHECK (after_revision=before_revision+1),
  CONSTRAINT canonical_schedule_human_audit_digest_check CHECK (
    before_digest ~ '^[0-9a-f]{64}$' AND after_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_schedule_human_audit_details_check CHECK (jsonb_typeof(details)='object')
);

CREATE TABLE public.canonical_schedule_human_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  assignment_id UUID NOT NULL,
  human_approval_id UUID NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_schedule_human_idempotency_primary
    PRIMARY KEY (organization_id,actor_user_id,idempotency_key_hash),
  CONSTRAINT canonical_schedule_human_idempotency_actor_fk FOREIGN KEY (organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_idempotency_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_idempotency_approval_fk FOREIGN KEY (organization_id,human_approval_id)
    REFERENCES public.canonical_schedule_human_approvals(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_human_idempotency_digest_check CHECK (
    idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_schedule_human_idempotency_response_check CHECK (
    response_status=200 AND jsonb_typeof(response_body)='object'
  )
);

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_immutable_evidence()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'Canonical schedule Part 4 evidence is immutable'
    USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_immutable';
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_apply_mutation_approval(
  organization_id_value UUID,appointment_id_value UUID,actor_user_id_value UUID,
  actor_access_role_value TEXT,auth_session_id_value UUID,csrf_token_value TEXT,
  preview_id_value UUID,preview_digest_value TEXT,acknowledged_warning_digests_value JSONB,
  acknowledged_review_reason_digests_value JSONB,reason_value TEXT,
  current_conflict_digest_value TEXT,current_recommendation_authority_digest_value TEXT,
  idempotency_key_hash_value TEXT,request_digest_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  preview_hint RECORD;
  preview_record public.canonical_schedule_mutation_previews%ROWTYPE;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  approval_record public.canonical_schedule_human_approvals%ROWTYPE;
  appointment_record public.canonical_appointments%ROWTYPE;
  replay_record public.canonical_schedule_human_idempotency%ROWTYPE;
  time_authority JSONB;
  submitted_time_evidence JSONB;
  time_evidence_digest_value TEXT;
  workforce_profile_id_value UUID;
  workforce_crew_id_value UUID;
  target_state_value TEXT;
  needs_review_value BOOLEAN;
  review_reasons_value JSONB;
  after_revision_value BIGINT;
  after_digest_value TEXT;
  response_body_value JSONB;
BEGIN
  SELECT expected_time_zone INTO preview_hint
    FROM public.canonical_schedule_mutation_previews
   WHERE organization_id=organization_id_value AND appointment_id=appointment_id_value
     AND id=preview_id_value AND actor_user_id=actor_user_id_value
     AND auth_session_id=auth_session_id_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mutation preview is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_scope_unavailable';
  END IF;
  time_authority := public.canonical_schedule_part4_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,
    csrf_token_value,preview_hint.expected_time_zone
  );
  SELECT * INTO replay_record FROM public.canonical_schedule_human_idempotency replay
   WHERE replay.organization_id=organization_id_value AND replay.actor_user_id=actor_user_id_value
     AND rtrim(replay.idempotency_key_hash)=idempotency_key_hash_value;
  IF FOUND THEN
    IF rtrim(replay_record.request_digest)<>request_digest_value THEN
      RAISE EXCEPTION 'Idempotency-Key was reused for a divergent approval'
        USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_idempotency_divergent';
    END IF;
    RETURN replay_record.response_body;
  END IF;
  SELECT * INTO preview_record FROM public.canonical_schedule_mutation_previews preview
   WHERE preview.organization_id=organization_id_value AND preview.appointment_id=appointment_id_value
     AND preview.id=preview_id_value AND preview.actor_user_id=actor_user_id_value
     AND preview.auth_session_id=auth_session_id_value
   FOR SHARE;
  IF NOT FOUND OR rtrim(preview_record.preview_digest)<>preview_digest_value
     OR preview_record.actor_access_role<>actor_access_role_value
     OR preview_record.reason<>reason_value THEN
    RAISE EXCEPTION 'Mutation preview evidence diverges'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  IF transaction_timestamp()>=preview_record.expires_at THEN
    RAISE EXCEPTION 'Mutation preview expired'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_preview_expired';
  END IF;
  IF EXISTS (SELECT 1 FROM public.canonical_schedule_human_approvals approval
    WHERE approval.organization_id=organization_id_value AND approval.preview_id=preview_id_value) THEN
    RAISE EXCEPTION 'Mutation preview was already applied'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_preview_replayed';
  END IF;
  SELECT assignment.* INTO assignment_record
    FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=assignment.organization_id AND appointment.id=assignment.appointment_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=appointment.organization_id AND transcript.operation_id=appointment.operation_id
   WHERE assignment.organization_id=organization_id_value AND assignment.id=preview_record.assignment_id
     AND assignment.appointment_id=appointment_id_value AND transcript.source NOT IN ('simulation','demo')
   FOR UPDATE OF assignment;
  IF NOT FOUND OR assignment_record.revision<>preview_record.expected_revision
     OR rtrim(assignment_record.canonical_digest)<>rtrim(preview_record.expected_digest)
     OR assignment_record.appointment_status<>preview_record.proposed_appointment_status THEN
    RAISE EXCEPTION 'Scheduling authority changed after preview'
      USING ERRCODE='40001',CONSTRAINT='canonical_schedule_part4_preview_stale';
  END IF;
  IF current_conflict_digest_value<>rtrim(preview_record.conflict_digest)
     OR current_recommendation_authority_digest_value<>rtrim(preview_record.recommendation_authority_digest) THEN
    RAISE EXCEPTION 'Conflict or recommendation authority changed after preview'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  IF jsonb_array_length(preview_record.conflict_evaluation->'hardConflicts')<>0 THEN
    RAISE EXCEPTION 'Hard conflicts cannot be overridden'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_hard_conflict';
  END IF;
  IF jsonb_typeof(acknowledged_warning_digests_value)<>'array'
     OR jsonb_typeof(acknowledged_review_reason_digests_value)<>'array'
     OR acknowledged_warning_digests_value<>preview_record.warning_digests
     OR acknowledged_review_reason_digests_value<>preview_record.review_reason_digests THEN
    RAISE EXCEPTION 'Exact warning acknowledgement diverges from preview'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_acknowledgement_divergent';
  END IF;
  IF NOT public.canonical_schedule_part4_target_current(
    organization_id_value,preview_record.proposed_target_kind,preview_record.proposed_target_id
  ) THEN
    RAISE EXCEPTION 'Approved target is no longer current'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  target_state_value := CASE WHEN preview_record.proposed_target_kind='unassigned'
    THEN 'unassigned' ELSE 'assigned' END;
  workforce_profile_id_value := CASE WHEN preview_record.proposed_target_kind='profile'
    THEN preview_record.proposed_target_id ELSE NULL END;
  workforce_crew_id_value := CASE WHEN preview_record.proposed_target_kind='crew'
    THEN preview_record.proposed_target_id ELSE NULL END;
  needs_review_value := COALESCE((preview_record.conflict_evaluation->>'needsReview')::BOOLEAN,FALSE);
  review_reasons_value := preview_record.conflict_evaluation->'reviewReasons';
  IF jsonb_typeof(review_reasons_value)<>'array'
     OR (needs_review_value AND jsonb_array_length(review_reasons_value)=0)
     OR (NOT needs_review_value AND jsonb_array_length(review_reasons_value)<>0) THEN
    RAISE EXCEPTION 'Conflict review evidence is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  submitted_time_evidence := jsonb_build_object(
    'startProvided',TRUE,'endProvided',TRUE,
    'scheduledStart',preview_record.submitted_schedule->'scheduledStart',
    'scheduledEnd',preview_record.submitted_schedule->'scheduledEnd'
  );
  time_evidence_digest_value := public.canonical_schedule_time_evidence_digest(
    2::SMALLINT,submitted_time_evidence,time_authority
  );
  after_revision_value := assignment_record.revision+1;
  after_digest_value := public.canonical_schedule_assignment_digest(
    target_state_value,workforce_profile_id_value,workforce_crew_id_value,
    preview_record.proposed_schedule_state,preview_record.proposed_dispatch_state,
    preview_record.proposed_scheduled_start,preview_record.proposed_scheduled_end,
    preview_record.proposed_appointment_status,needs_review_value,review_reasons_value
  );
  INSERT INTO public.canonical_schedule_human_approvals(
    organization_id,preview_id,assignment_id,appointment_id,actor_user_id,actor_access_role,
    auth_session_id,expected_revision,expected_digest,applied_revision,applied_digest,
    action_code,approved_target_kind,approved_target_id,approved_scheduled_start,approved_scheduled_end,
    resulting_schedule_state,resulting_dispatch_state,approved_appointment_status,
    resulting_needs_review,resulting_review_reasons,submitted_schedule,time_zone_authority,
    time_evidence_digest,conflict_digest,recommendation_digest,recommendation_authority_digest,
    acknowledged_warning_digests,acknowledged_review_reason_digests,reason,idempotency_key_hash,
    request_digest,transaction_id,approved_at
  ) VALUES (
    organization_id_value,preview_id_value,assignment_record.id,appointment_id_value,actor_user_id_value,
    actor_access_role_value,auth_session_id_value,preview_record.expected_revision,
    preview_record.expected_digest,after_revision_value,after_digest_value,preview_record.action_code,
    preview_record.proposed_target_kind,preview_record.proposed_target_id,
    preview_record.proposed_scheduled_start,preview_record.proposed_scheduled_end,
    preview_record.proposed_schedule_state,preview_record.proposed_dispatch_state,
    preview_record.proposed_appointment_status,needs_review_value,review_reasons_value,
    submitted_time_evidence,time_authority,time_evidence_digest_value,preview_record.conflict_digest,
    preview_record.recommendation_digest,preview_record.recommendation_authority_digest,
    acknowledged_warning_digests_value,acknowledged_review_reason_digests_value,reason_value,
    idempotency_key_hash_value,request_digest_value,txid_current(),transaction_timestamp()
  ) RETURNING * INTO approval_record;
  UPDATE public.canonical_schedule_assignments SET
    workforce_profile_id=workforce_profile_id_value,workforce_crew_id=workforce_crew_id_value,
    target_state=target_state_value,schedule_state=preview_record.proposed_schedule_state,
    dispatch_state=preview_record.proposed_dispatch_state,
    scheduled_start=preview_record.proposed_scheduled_start,scheduled_end=preview_record.proposed_scheduled_end,
    appointment_status=preview_record.proposed_appointment_status,needs_review=needs_review_value,
    review_reasons=review_reasons_value,revision=after_revision_value,canonical_digest=after_digest_value,
    last_approval_id=NULL,last_human_approval_id=approval_record.id,last_actor_user_id=actor_user_id_value,
    last_action_code=preview_record.action_code,last_reason=reason_value,updated_at=transaction_timestamp()
   WHERE organization_id=organization_id_value AND id=assignment_record.id
   RETURNING * INTO assignment_record;
  INSERT INTO public.canonical_schedule_assignment_revisions(
    organization_id,assignment_id,revision,workforce_profile_id,workforce_crew_id,target_state,
    schedule_state,dispatch_state,scheduled_start,scheduled_end,appointment_status,needs_review,
    review_reasons,canonical_digest,source_kind,approval_id,human_approval_id,actor_user_id,
    action_code,reason,request_digest,source_snapshot
  ) VALUES (
    organization_id_value,assignment_record.id,after_revision_value,workforce_profile_id_value,
    workforce_crew_id_value,target_state_value,preview_record.proposed_schedule_state,
    preview_record.proposed_dispatch_state,preview_record.proposed_scheduled_start,
    preview_record.proposed_scheduled_end,preview_record.proposed_appointment_status,
    needs_review_value,review_reasons_value,after_digest_value,'human_preview_approved',NULL,
    approval_record.id,actor_user_id_value,preview_record.action_code,reason_value,request_digest_value,
    jsonb_build_object('appointmentId',appointment_id_value,'previewId',preview_id_value,
      'conflictDigest',preview_record.conflict_digest,'recommendationDigest',preview_record.recommendation_digest,
      'recommendationAuthorityDigest',preview_record.recommendation_authority_digest,
      'timeEvidenceVersion',2,'submittedSchedule',submitted_time_evidence,
      'timeZoneAuthority',time_authority,'timeEvidenceDigest',time_evidence_digest_value)
  );
  UPDATE public.canonical_appointments SET scheduled_start=preview_record.proposed_scheduled_start,
    scheduled_end=preview_record.proposed_scheduled_end,status=preview_record.proposed_appointment_status,
    updated_at=transaction_timestamp()
   WHERE organization_id=organization_id_value AND id=appointment_id_value
   RETURNING * INTO appointment_record;
  INSERT INTO public.canonical_schedule_human_audit_events(
    organization_id,assignment_id,human_approval_id,actor_user_id,action_code,reason,
    before_revision,after_revision,before_digest,after_digest,details,transaction_id,created_at
  ) VALUES (
    organization_id_value,assignment_record.id,approval_record.id,actor_user_id_value,
    preview_record.action_code,reason_value,preview_record.expected_revision,after_revision_value,
    preview_record.expected_digest,after_digest_value,
    jsonb_build_object('appointmentId',appointment_id_value,'previewId',preview_id_value,
      'target',jsonb_build_object('kind',preview_record.proposed_target_kind,'id',preview_record.proposed_target_id),
      'scheduleState',preview_record.proposed_schedule_state,'dispatchState',preview_record.proposed_dispatch_state,
      'needsReview',needs_review_value,'reviewReasons',review_reasons_value,
      'conflictDigest',preview_record.conflict_digest,'recommendationDigest',preview_record.recommendation_digest,
      'recommendationAuthorityDigest',preview_record.recommendation_authority_digest,
      'warningDigests',acknowledged_warning_digests_value,
      'reviewReasonDigests',acknowledged_review_reason_digests_value,
      'timeEvidenceVersion',2,'submittedSchedule',submitted_time_evidence,
      'timeZoneAuthority',time_authority,'timeEvidenceDigest',time_evidence_digest_value),
    txid_current(),transaction_timestamp()
  );
  response_body_value := jsonb_build_object('success',TRUE,'data',jsonb_build_object(
    'id',appointment_record.id,'organization_id',appointment_record.organization_id,
    'operation_id',appointment_record.operation_id,'graph_id',appointment_record.graph_id,
    'opportunity_id',appointment_record.opportunity_id,
    'external_appointment_id',appointment_record.external_appointment_id,
    'preference',appointment_record.preference,'scheduled_start',appointment_record.scheduled_start,
    'scheduled_end',appointment_record.scheduled_end,'status',appointment_record.status,
    'created_at',appointment_record.created_at,'updated_at',appointment_record.updated_at,
    'scheduleAuthority',jsonb_build_object(
      'id',assignment_record.id,'appointmentId',assignment_record.appointment_id,
      'operationId',assignment_record.operation_id,'graphId',assignment_record.graph_id,
      'opportunityId',assignment_record.opportunity_id,'targetState',assignment_record.target_state,
      'workforceProfileId',assignment_record.workforce_profile_id,
      'workforceCrewId',assignment_record.workforce_crew_id,'scheduleState',assignment_record.schedule_state,
      'dispatchState',assignment_record.dispatch_state,'scheduledStart',assignment_record.scheduled_start,
      'scheduledEnd',assignment_record.scheduled_end,'appointmentStatus',assignment_record.appointment_status,
      'needsReview',assignment_record.needs_review,'reviewReasons',assignment_record.review_reasons,
      'revision',assignment_record.revision,'digest',rtrim(assignment_record.canonical_digest),
      'lastAction',assignment_record.last_action_code,'lastReason',assignment_record.last_reason,
      'lastHumanApprovalId',approval_record.id,'updatedAt',assignment_record.updated_at),
    'humanApproval',jsonb_build_object(
      'id',approval_record.id,'previewId',preview_id_value,'action',approval_record.action_code,
      'approvedAt',approval_record.approved_at,'requestDigest',rtrim(approval_record.request_digest),
      'timeEvidenceDigest',rtrim(approval_record.time_evidence_digest),
      'conflictDigest',rtrim(approval_record.conflict_digest),
      'recommendationDigest',rtrim(approval_record.recommendation_digest),
      'recommendationAuthorityDigest',rtrim(approval_record.recommendation_authority_digest)))
  );
  INSERT INTO public.canonical_schedule_human_idempotency(
    organization_id,actor_user_id,idempotency_key_hash,request_digest,assignment_id,
    human_approval_id,response_status,response_body,transaction_id,created_at
  ) VALUES (
    organization_id_value,actor_user_id_value,idempotency_key_hash_value,request_digest_value,
    assignment_record.id,approval_record.id,200,response_body_value,txid_current(),transaction_timestamp()
  );
  RETURN response_body_value;
END
$function$;

-- Part 4 replaces the assignment guard with a dual-evidence guard. Historical
-- Part 1 approvals remain valid, while every Part 4 update must match a human
-- approval inserted in this exact transaction. The two evidence pointers are
-- mutually exclusive so a caller cannot confuse the accepted authority.
CREATE OR REPLACE FUNCTION public.canonical_schedule_guard_assignment()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  legacy_approval public.canonical_schedule_approvals%ROWTYPE;
  human_approval public.canonical_schedule_human_approvals%ROWTYPE;
  expected_digest TEXT;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Canonical schedule assignments cannot be deleted'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_assignment_delete_forbidden';
  END IF;
  expected_digest := public.canonical_schedule_assignment_digest(
    NEW.target_state,NEW.workforce_profile_id,NEW.workforce_crew_id,
    NEW.schedule_state,NEW.dispatch_state,NEW.scheduled_start,NEW.scheduled_end,
    NEW.appointment_status,NEW.needs_review,NEW.review_reasons
  );
  IF rtrim(NEW.canonical_digest)<>expected_digest THEN
    RAISE EXCEPTION 'Canonical schedule assignment digest is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_assignment_digest_invalid';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.last_approval_id IS NOT NULL
       OR NEW.last_human_approval_id IS NOT NULL OR NEW.last_actor_user_id IS NOT NULL
       OR NEW.last_action_code NOT IN ('legacy_import','appointment_created') THEN
      RAISE EXCEPTION 'Canonical schedule assignment initial state is invalid'
        USING ERRCODE='23514',CONSTRAINT='canonical_schedule_assignment_initial_invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id
     OR NEW.appointment_id<>OLD.appointment_id OR NEW.operation_id<>OLD.operation_id
     OR NEW.graph_id<>OLD.graph_id OR NEW.opportunity_id<>OLD.opportunity_id
     OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Canonical schedule assignment identity is immutable'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_assignment_identity_immutable';
  END IF;
  IF NEW.last_human_approval_id IS NOT NULL AND NEW.last_approval_id IS NULL THEN
    SELECT * INTO human_approval
      FROM public.canonical_schedule_human_approvals approval
     WHERE approval.organization_id=NEW.organization_id
       AND approval.id=NEW.last_human_approval_id
       AND approval.assignment_id=NEW.id AND approval.appointment_id=NEW.appointment_id
       AND approval.actor_user_id=NEW.last_actor_user_id
       AND approval.expected_revision=OLD.revision
       AND rtrim(approval.expected_digest)=rtrim(OLD.canonical_digest)
       AND approval.applied_revision=NEW.revision
       AND rtrim(approval.applied_digest)=rtrim(NEW.canonical_digest)
       AND approval.transaction_id=txid_current()::bigint;
    IF NOT FOUND OR human_approval.action_code<>NEW.last_action_code
       OR human_approval.reason<>NEW.last_reason
       OR human_approval.approved_target_kind<>(CASE WHEN NEW.target_state='unassigned' THEN 'unassigned'
            WHEN NEW.workforce_profile_id IS NOT NULL THEN 'profile' ELSE 'crew' END)
       OR human_approval.approved_target_id IS DISTINCT FROM COALESCE(NEW.workforce_profile_id,NEW.workforce_crew_id)
       OR human_approval.approved_scheduled_start IS DISTINCT FROM NEW.scheduled_start
       OR human_approval.approved_scheduled_end IS DISTINCT FROM NEW.scheduled_end
       OR human_approval.approved_appointment_status<>NEW.appointment_status
       OR human_approval.resulting_schedule_state<>NEW.schedule_state
       OR human_approval.resulting_dispatch_state<>NEW.dispatch_state
       OR human_approval.resulting_needs_review<>NEW.needs_review
       OR human_approval.resulting_review_reasons<>NEW.review_reasons THEN
      RAISE EXCEPTION 'Canonical schedule assignment mutation lacks matching human approval evidence'
        USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_approval_required';
    END IF;
  ELSIF NEW.last_approval_id IS NOT NULL AND NEW.last_human_approval_id IS NULL THEN
    IF NEW.workforce_profile_id IS DISTINCT FROM OLD.workforce_profile_id
       OR NEW.workforce_crew_id IS DISTINCT FROM OLD.workforce_crew_id
       OR NEW.target_state<>OLD.target_state THEN
      RAISE EXCEPTION 'Historical Part 1 approval cannot alter an assignment target'
        USING ERRCODE='23514',CONSTRAINT='canonical_schedule_assignment_identity_immutable';
    END IF;
    SELECT * INTO legacy_approval FROM public.canonical_schedule_approvals approval
     WHERE approval.organization_id=NEW.organization_id AND approval.id=NEW.last_approval_id
       AND approval.assignment_id=NEW.id AND approval.appointment_id=NEW.appointment_id
       AND approval.actor_user_id=NEW.last_actor_user_id
       AND approval.expected_revision=OLD.revision
       AND rtrim(approval.expected_digest)=rtrim(OLD.canonical_digest)
       AND approval.applied_revision=NEW.revision
       AND rtrim(approval.applied_digest)=rtrim(NEW.canonical_digest)
       AND approval.transaction_id=txid_current()::bigint;
    IF NOT FOUND OR legacy_approval.action_code<>NEW.last_action_code
       OR legacy_approval.reason<>NEW.last_reason
       OR legacy_approval.approved_scheduled_start IS DISTINCT FROM NEW.scheduled_start
       OR legacy_approval.approved_scheduled_end IS DISTINCT FROM NEW.scheduled_end
       OR legacy_approval.approved_appointment_status<>NEW.appointment_status
       OR legacy_approval.resulting_schedule_state<>NEW.schedule_state
       OR legacy_approval.resulting_dispatch_state<>NEW.dispatch_state
       OR legacy_approval.resulting_needs_review<>NEW.needs_review
       OR legacy_approval.resulting_review_reasons<>NEW.review_reasons THEN
      RAISE EXCEPTION 'Canonical schedule assignment mutation lacks matching approval evidence'
        USING ERRCODE='42501',CONSTRAINT='canonical_schedule_approval_required';
    END IF;
  ELSE
    RAISE EXCEPTION 'Canonical schedule mutation must identify exactly one approval authority'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_approval_required';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_guard_revision()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  legacy_approval public.canonical_schedule_approvals%ROWTYPE;
  human_approval public.canonical_schedule_human_approvals%ROWTYPE;
BEGIN
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments
   WHERE organization_id=NEW.organization_id AND id=NEW.assignment_id;
  IF NOT FOUND OR assignment_record.revision<>NEW.revision
     OR rtrim(assignment_record.canonical_digest)<>rtrim(NEW.canonical_digest)
     OR assignment_record.target_state<>NEW.target_state
     OR assignment_record.workforce_profile_id IS DISTINCT FROM NEW.workforce_profile_id
     OR assignment_record.workforce_crew_id IS DISTINCT FROM NEW.workforce_crew_id
     OR assignment_record.schedule_state<>NEW.schedule_state
     OR assignment_record.dispatch_state<>NEW.dispatch_state
     OR assignment_record.scheduled_start IS DISTINCT FROM NEW.scheduled_start
     OR assignment_record.scheduled_end IS DISTINCT FROM NEW.scheduled_end
     OR assignment_record.appointment_status<>NEW.appointment_status
     OR assignment_record.needs_review<>NEW.needs_review
     OR assignment_record.review_reasons<>NEW.review_reasons THEN
    RAISE EXCEPTION 'Canonical schedule revision diverges from current authority'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_revision_divergent';
  END IF;
  IF NEW.source_kind='human_approved' THEN
    SELECT * INTO legacy_approval FROM public.canonical_schedule_approvals approval
     WHERE organization_id=NEW.organization_id AND id=NEW.approval_id
       AND assignment_id=NEW.assignment_id AND actor_user_id=NEW.actor_user_id
       AND applied_revision=NEW.revision AND rtrim(applied_digest)=rtrim(NEW.canonical_digest)
       AND rtrim(request_digest)=rtrim(NEW.request_digest)
       AND transaction_id=txid_current()::bigint;
    IF NOT FOUND OR legacy_approval.action_code<>NEW.action_code OR legacy_approval.reason<>NEW.reason THEN
      RAISE EXCEPTION 'Canonical schedule revision lacks approval evidence'
        USING ERRCODE='42501',CONSTRAINT='canonical_schedule_revision_approval_required';
    END IF;
  ELSIF NEW.source_kind='human_preview_approved' THEN
    SELECT * INTO human_approval FROM public.canonical_schedule_human_approvals approval
     WHERE organization_id=NEW.organization_id AND id=NEW.human_approval_id
       AND assignment_id=NEW.assignment_id AND actor_user_id=NEW.actor_user_id
       AND applied_revision=NEW.revision AND rtrim(applied_digest)=rtrim(NEW.canonical_digest)
       AND rtrim(request_digest)=rtrim(NEW.request_digest)
       AND transaction_id=txid_current()::bigint;
    IF NOT FOUND OR human_approval.action_code<>NEW.action_code OR human_approval.reason<>NEW.reason THEN
      RAISE EXCEPTION 'Canonical schedule revision lacks human preview approval evidence'
        USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_revision_approval_required';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_guard_appointment_write()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start
     AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end AND NEW.status=OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments
   WHERE organization_id=NEW.organization_id AND appointment_id=NEW.id;
  IF NOT FOUND OR assignment_record.scheduled_start IS DISTINCT FROM NEW.scheduled_start
     OR assignment_record.scheduled_end IS DISTINCT FROM NEW.scheduled_end
     OR assignment_record.appointment_status<>NEW.status
     OR NOT (
       EXISTS (SELECT 1 FROM public.canonical_schedule_approvals approval
        WHERE approval.organization_id=NEW.organization_id AND approval.id=assignment_record.last_approval_id
          AND approval.assignment_id=assignment_record.id AND approval.applied_revision=assignment_record.revision
          AND rtrim(approval.applied_digest)=rtrim(assignment_record.canonical_digest)
          AND approval.transaction_id=txid_current()::bigint)
       OR EXISTS (SELECT 1 FROM public.canonical_schedule_human_approvals approval
        WHERE approval.organization_id=NEW.organization_id AND approval.id=assignment_record.last_human_approval_id
          AND approval.assignment_id=assignment_record.id AND approval.applied_revision=assignment_record.revision
          AND rtrim(approval.applied_digest)=rtrim(assignment_record.canonical_digest)
          AND approval.transaction_id=txid_current()::bigint)
     ) THEN
    RAISE EXCEPTION 'Appointment schedule mutation requires matching Mission 22 human approval'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_approval_required';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_schedule_previews_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_mutation_previews
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_part4_immutable_evidence();
CREATE TRIGGER canonical_schedule_human_approvals_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_human_approvals
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_part4_immutable_evidence();
CREATE TRIGGER canonical_schedule_human_audit_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_human_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_part4_immutable_evidence();
CREATE TRIGGER canonical_schedule_human_idempotency_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_human_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_part4_immutable_evidence();

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_actor_authority(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID,
  csrf_token_value TEXT,
  expected_time_zone_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  authority RECORD;
  evaluated_at TIMESTAMPTZ := transaction_timestamp();
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=organization_id_value FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical schedule organization is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_actor_unauthorized';
  END IF;
  SELECT membership.id AS membership_id,membership.role,membership.status AS membership_status,
         profile.operational_role,account.status AS account_status,
         session.status AS session_status,session.access_expires_at,session.csrf_token_hash,
         subscription.status AS subscription_status,subscription.trial_started_at,subscription.trial_ends_at,
         onboarding.status AS onboarding_status,
         business_profile.id AS profile_id,business_profile.version_number,
         business_profile.normalized_profile_hash,
         business_profile.raw_profile #>> '{company,timeZone}' AS time_zone
    INTO authority
    FROM public.organization_memberships membership
    JOIN public.workforce_profiles profile
      ON profile.organization_id=membership.organization_id AND profile.membership_id=membership.id
    JOIN public.users account
      ON account.organization_id=membership.organization_id AND account.id=membership.user_id
    JOIN public.auth_sessions session
      ON session.organization_id=membership.organization_id AND session.membership_id=membership.id
     AND session.user_id=membership.user_id AND session.id=auth_session_id_value
    JOIN public.subscriptions subscription ON subscription.organization_id=membership.organization_id
    JOIN public.organization_onboarding onboarding ON onboarding.organization_id=membership.organization_id
    JOIN public.canonical_business_profiles business_profile
      ON business_profile.organization_id=onboarding.organization_id
     AND business_profile.id=onboarding.active_business_profile_id AND business_profile.is_active=TRUE
   WHERE membership.organization_id=organization_id_value AND membership.user_id=actor_user_id_value
   FOR SHARE OF membership,profile,account,session,subscription,onboarding,business_profile;
  IF NOT FOUND OR authority.membership_status<>'active' OR authority.account_status<>'active'
     OR authority.role<>actor_access_role_value
     OR NOT (authority.role IN ('owner','admin')
       OR (authority.role='member' AND authority.operational_role='dispatcher'))
     OR authority.session_status<>'active' OR authority.access_expires_at<=evaluated_at
     OR csrf_token_value IS NULL OR octet_length(csrf_token_value) NOT BETWEEN 32 AND 512
     OR encode(sha256(convert_to(csrf_token_value,'UTF8')),'hex')<>rtrim(authority.csrf_token_hash)
     OR NOT (authority.subscription_status='active'
       OR (authority.subscription_status='trialing' AND authority.trial_started_at IS NOT NULL
         AND authority.trial_ends_at=authority.trial_started_at+INTERVAL '14 days'
         AND authority.trial_ends_at>evaluated_at))
     OR authority.onboarding_status<>'complete' OR authority.time_zone IS DISTINCT FROM expected_time_zone_value
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names zone
       WHERE lower(zone.name)=lower(authority.time_zone)) THEN
    RAISE EXCEPTION 'Current human schedule approval authority is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_actor_unauthorized';
  END IF;
  RETURN jsonb_build_object(
    'profileId',authority.profile_id::TEXT,
    'profileVersion',authority.version_number,
    'profileHash',rtrim(authority.normalized_profile_hash),
    'timeZone',authority.time_zone
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_target_current(
  organization_id_value UUID,target_kind_value TEXT,target_id_value UUID
)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT CASE target_kind_value
    WHEN 'unassigned' THEN target_id_value IS NULL
    WHEN 'profile' THEN target_id_value IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.workforce_profiles profile
      JOIN public.organization_memberships membership
        ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
      JOIN public.users account
        ON account.organization_id=membership.organization_id AND account.id=membership.user_id
      WHERE profile.organization_id=organization_id_value AND profile.id=target_id_value
        AND membership.status='active' AND account.status='active'
    )
    WHEN 'crew' THEN target_id_value IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.workforce_crews crew
      JOIN public.workforce_crew_members member
        ON member.organization_id=crew.organization_id AND member.crew_id=crew.id
      JOIN public.workforce_profiles profile
        ON profile.organization_id=member.organization_id AND profile.id=member.profile_id
      JOIN public.organization_memberships membership
        ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
      JOIN public.users account
        ON account.organization_id=membership.organization_id AND account.id=membership.user_id
      WHERE crew.organization_id=organization_id_value AND crew.id=target_id_value
        AND membership.status='active' AND account.status='active'
    )
    ELSE FALSE
  END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_preview_digest(
  preview_id_value UUID,organization_id_value UUID,assignment_id_value UUID,appointment_id_value UUID,
  actor_user_id_value UUID,auth_session_id_value UUID,expected_revision_value BIGINT,expected_digest_value TEXT,
  expected_time_zone_value TEXT,action_code_value TEXT,target_kind_value TEXT,target_id_value UUID,
  scheduled_start_value TIMESTAMPTZ,scheduled_end_value TIMESTAMPTZ,schedule_state_value TEXT,
  dispatch_state_value TEXT,appointment_status_value TEXT,reason_value TEXT,conflict_digest_value TEXT,
  warning_digests_value JSONB,review_reason_digests_value JSONB,recommendation_digest_value TEXT,
  recommendation_authority_digest_value TEXT,request_digest_value TEXT,created_at_value TIMESTAMPTZ,
  expires_at_value TIMESTAMPTZ
)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'action',action_code_value,'actorUserId',actor_user_id_value,'appointmentId',appointment_id_value,
    'assignmentId',assignment_id_value,'authSessionId',auth_session_id_value,
    'conflictDigest',conflict_digest_value,
    'createdAt',to_char(created_at_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'dispatchState',dispatch_state_value,'expectedDigest',expected_digest_value,
    'expectedRevision',expected_revision_value,'expectedTimeZone',expected_time_zone_value,
    'expiresAt',to_char(expires_at_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'organizationId',organization_id_value,'previewId',preview_id_value,
    'reason',reason_value,'recommendationAuthorityDigest',recommendation_authority_digest_value,
    'recommendationDigest',recommendation_digest_value,'requestDigest',request_digest_value,
    'reviewReasonDigests',review_reason_digests_value,'scheduleState',schedule_state_value,
    'scheduledEnd',scheduled_end_value,'scheduledStart',scheduled_start_value,
    'status',appointment_status_value,'targetId',target_id_value,'targetKind',target_kind_value,
    'warningDigests',warning_digests_value
  )::TEXT,'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_create_mutation_preview(
  organization_id_value UUID,appointment_id_value UUID,actor_user_id_value UUID,
  actor_access_role_value TEXT,auth_session_id_value UUID,csrf_token_value TEXT,
  expected_revision_value BIGINT,expected_digest_value TEXT,expected_time_zone_value TEXT,
  action_code_value TEXT,target_kind_value TEXT,target_id_value UUID,
  scheduled_start_value TIMESTAMPTZ,scheduled_end_value TIMESTAMPTZ,submitted_schedule_value JSONB,
  appointment_status_value TEXT,reason_value TEXT,conflict_evaluation_value JSONB,
  conflict_digest_value TEXT,warning_digests_value JSONB,review_reason_digests_value JSONB,
  recommendation_digest_value TEXT,recommendation_authority_digest_value TEXT,request_digest_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  time_authority JSONB;
  current_target_kind TEXT;
  current_target_id UUID;
  proposed_schedule_state TEXT;
  proposed_dispatch_state TEXT;
  preview_id_value UUID := gen_random_uuid();
  created_at_value TIMESTAMPTZ := transaction_timestamp();
  expires_at_value TIMESTAMPTZ := transaction_timestamp()+INTERVAL '15 minutes';
  preview_digest_value TEXT;
BEGIN
  time_authority := public.canonical_schedule_part4_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,
    csrf_token_value,expected_time_zone_value
  );
  SELECT assignment.* INTO assignment_record
    FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=assignment.organization_id AND appointment.id=assignment.appointment_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=appointment.organization_id AND transcript.operation_id=appointment.operation_id
   WHERE assignment.organization_id=organization_id_value AND assignment.appointment_id=appointment_id_value
     AND transcript.source NOT IN ('simulation','demo')
   FOR SHARE OF assignment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical appointment is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_scope_unavailable';
  END IF;
  IF assignment_record.revision<>expected_revision_value
     OR rtrim(assignment_record.canonical_digest)<>expected_digest_value THEN
    RAISE EXCEPTION 'Canonical schedule preview is stale'
      USING ERRCODE='40001',CONSTRAINT='canonical_schedule_part4_preview_stale';
  END IF;
  IF assignment_record.appointment_status<>appointment_status_value THEN
    RAISE EXCEPTION 'Appointment compatibility status changed'
      USING ERRCODE='40001',CONSTRAINT='canonical_schedule_part4_preview_stale';
  END IF;
  IF jsonb_typeof(submitted_schedule_value)<>'object'
     OR NOT (submitted_schedule_value ?& ARRAY['scheduledStart','scheduledEnd'])
     OR (SELECT count(*) FROM jsonb_object_keys(submitted_schedule_value))<>2 THEN
    RAISE EXCEPTION 'Submitted schedule evidence is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  IF scheduled_start_value IS NULL OR scheduled_end_value IS NULL THEN
    IF scheduled_start_value IS NOT NULL OR scheduled_end_value IS NOT NULL
       OR submitted_schedule_value->'scheduledStart'<>'null'::jsonb
       OR submitted_schedule_value->'scheduledEnd'<>'null'::jsonb THEN
      RAISE EXCEPTION 'Unscheduled preview evidence diverges'
        USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
    proposed_schedule_state := 'unscheduled';
  ELSE
    IF scheduled_end_value<=scheduled_start_value
       OR public.canonical_schedule_validate_rfc3339_in_zone(
         submitted_schedule_value->>'scheduledStart',scheduled_start_value,expected_time_zone_value
       ) IS NOT TRUE
       OR public.canonical_schedule_validate_rfc3339_in_zone(
         submitted_schedule_value->>'scheduledEnd',scheduled_end_value,expected_time_zone_value
       ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Scheduled preview evidence diverges'
        USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
    proposed_schedule_state := 'scheduled';
  END IF;
  current_target_kind := CASE WHEN assignment_record.target_state='unassigned' THEN 'unassigned'
    WHEN assignment_record.workforce_profile_id IS NOT NULL THEN 'profile' ELSE 'crew' END;
  current_target_id := COALESCE(assignment_record.workforce_profile_id,assignment_record.workforce_crew_id);
  IF NOT public.canonical_schedule_part4_target_current(organization_id_value,target_kind_value,target_id_value) THEN
    RAISE EXCEPTION 'Proposed assignment target is inactive or unavailable'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  IF action_code_value='assign' THEN
    IF current_target_kind<>'unassigned' OR target_kind_value NOT IN ('profile','crew')
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Assign transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='reassign' THEN
    IF current_target_kind='unassigned' OR target_kind_value NOT IN ('profile','crew')
       OR (target_kind_value=current_target_kind AND target_id_value=current_target_id)
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Reassign transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='unassign' THEN
    IF current_target_kind='unassigned' OR target_kind_value<>'unassigned'
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Unassign transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='schedule' THEN
    IF assignment_record.schedule_state<>'unscheduled' OR proposed_schedule_state<>'scheduled'
       OR target_kind_value<>current_target_kind OR target_id_value IS DISTINCT FROM current_target_id THEN
      RAISE EXCEPTION 'Schedule transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='reschedule' THEN
    IF assignment_record.schedule_state<>'scheduled' OR proposed_schedule_state<>'scheduled'
       OR target_kind_value<>current_target_kind OR target_id_value IS DISTINCT FROM current_target_id
       OR (scheduled_start_value IS NOT DISTINCT FROM assignment_record.scheduled_start
         AND scheduled_end_value IS NOT DISTINCT FROM assignment_record.scheduled_end) THEN
      RAISE EXCEPTION 'Reschedule transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='dispatch' THEN
    IF current_target_kind='unassigned' OR assignment_record.schedule_state<>'scheduled'
       OR assignment_record.dispatch_state='dispatched' OR assignment_record.appointment_status IN ('cancelled','completed')
       OR target_kind_value<>current_target_kind OR target_id_value IS DISTINCT FROM current_target_id
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Dispatch transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'Approval action is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  proposed_dispatch_state := CASE WHEN action_code_value='dispatch' THEN 'dispatched'
    WHEN assignment_record.dispatch_state='dispatched' AND action_code_value IN ('reassign','unassign','reschedule') THEN 'revoked'
    ELSE assignment_record.dispatch_state END;
  IF jsonb_typeof(conflict_evaluation_value)<>'object'
     OR conflict_evaluation_value->>'digest'<>conflict_digest_value
     OR conflict_evaluation_value->>'assignmentId'<>assignment_record.id::TEXT
     OR conflict_evaluation_value->>'assignmentRevision'<>assignment_record.revision::TEXT
     OR conflict_evaluation_value->>'assignmentDigest'<>rtrim(assignment_record.canonical_digest)
     OR jsonb_typeof(conflict_evaluation_value->'hardConflicts')<>'array'
     OR jsonb_typeof(conflict_evaluation_value->'warnings')<>'array'
     OR jsonb_typeof(conflict_evaluation_value->'reviewReasons')<>'array'
     OR jsonb_typeof(warning_digests_value)<>'array'
     OR jsonb_array_length(warning_digests_value)<>jsonb_array_length(conflict_evaluation_value->'warnings')
     OR jsonb_typeof(review_reason_digests_value)<>'array'
     OR jsonb_array_length(review_reason_digests_value)<>jsonb_array_length(conflict_evaluation_value->'reviewReasons') THEN
    RAISE EXCEPTION 'Conflict preview evidence diverges'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  preview_digest_value := public.canonical_schedule_part4_preview_digest(
    preview_id_value,organization_id_value,assignment_record.id,appointment_id_value,actor_user_id_value,
    auth_session_id_value,expected_revision_value,expected_digest_value,expected_time_zone_value,
    action_code_value,target_kind_value,target_id_value,scheduled_start_value,scheduled_end_value,
    proposed_schedule_state,proposed_dispatch_state,appointment_status_value,reason_value,
    conflict_digest_value,warning_digests_value,review_reason_digests_value,recommendation_digest_value,
    recommendation_authority_digest_value,request_digest_value,created_at_value,expires_at_value
  );
  INSERT INTO public.canonical_schedule_mutation_previews(
    id,organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,auth_session_id,
    expected_revision,expected_digest,expected_time_zone,action_code,proposed_target_kind,proposed_target_id,
    proposed_scheduled_start,proposed_scheduled_end,proposed_schedule_state,proposed_dispatch_state,
    proposed_appointment_status,submitted_schedule,reason,conflict_evaluation,conflict_digest,
    warning_digests,review_reason_digests,recommendation_digest,recommendation_authority_digest,
    request_digest,preview_digest,created_at,expires_at,transaction_id
  ) VALUES (
    preview_id_value,organization_id_value,assignment_record.id,appointment_id_value,actor_user_id_value,
    actor_access_role_value,auth_session_id_value,expected_revision_value,expected_digest_value,
    expected_time_zone_value,action_code_value,target_kind_value,target_id_value,scheduled_start_value,
    scheduled_end_value,proposed_schedule_state,proposed_dispatch_state,appointment_status_value,
    submitted_schedule_value,reason_value,conflict_evaluation_value,conflict_digest_value,
    warning_digests_value,review_reason_digests_value,recommendation_digest_value,
    recommendation_authority_digest_value,request_digest_value,preview_digest_value,created_at_value,
    expires_at_value,txid_current()
  );
  RETURN jsonb_build_object('success',TRUE,'data',jsonb_build_object(
    'id',preview_id_value,'appointmentId',appointment_id_value,'assignmentId',assignment_record.id,
    'action',action_code_value,'proposal',jsonb_build_object(
      'target',jsonb_build_object('kind',target_kind_value,'id',target_id_value),
      'scheduledStart',scheduled_start_value,'scheduledEnd',scheduled_end_value,
      'scheduleState',proposed_schedule_state,'dispatchState',proposed_dispatch_state,
      'appointmentStatus',appointment_status_value,'timeZone',expected_time_zone_value
    ),
    'conflicts',conflict_evaluation_value,'warningDigests',warning_digests_value,
    'reviewReasonDigests',review_reason_digests_value,'recommendationDigest',recommendation_digest_value,
    'recommendationAuthorityDigest',recommendation_authority_digest_value,
    'previewDigest',preview_digest_value,'createdAt',created_at_value,'expiresAt',expires_at_value,
    'expiresInSeconds',900,'grantsMutation',FALSE,'persisted',TRUE
  ));
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_validate_human_approval_completion()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_mutation_previews preview
     WHERE preview.organization_id=NEW.organization_id AND preview.id=NEW.preview_id
       AND preview.assignment_id=NEW.assignment_id AND preview.appointment_id=NEW.appointment_id
       AND preview.actor_user_id=NEW.actor_user_id AND preview.auth_session_id=NEW.auth_session_id
       AND rtrim(preview.expected_digest)=rtrim(NEW.expected_digest)
       AND preview.expected_revision=NEW.expected_revision AND preview.action_code=NEW.action_code
       AND preview.reason=NEW.reason
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=assignment.organization_id AND appointment.id=assignment.appointment_id
     WHERE assignment.organization_id=NEW.organization_id AND assignment.id=NEW.assignment_id
       AND assignment.appointment_id=NEW.appointment_id AND assignment.last_human_approval_id=NEW.id
       AND assignment.last_approval_id IS NULL AND assignment.last_actor_user_id=NEW.actor_user_id
       AND assignment.revision=NEW.applied_revision
       AND rtrim(assignment.canonical_digest)=rtrim(NEW.applied_digest)
       AND assignment.scheduled_start IS NOT DISTINCT FROM NEW.approved_scheduled_start
       AND assignment.scheduled_end IS NOT DISTINCT FROM NEW.approved_scheduled_end
       AND assignment.schedule_state=NEW.resulting_schedule_state
       AND assignment.dispatch_state=NEW.resulting_dispatch_state
       AND assignment.appointment_status=NEW.approved_appointment_status
       AND assignment.needs_review=NEW.resulting_needs_review
       AND assignment.review_reasons=NEW.resulting_review_reasons
       AND appointment.scheduled_start IS NOT DISTINCT FROM NEW.approved_scheduled_start
       AND appointment.scheduled_end IS NOT DISTINCT FROM NEW.approved_scheduled_end
       AND appointment.status=NEW.approved_appointment_status
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_assignment_revisions revision
     WHERE revision.organization_id=NEW.organization_id AND revision.assignment_id=NEW.assignment_id
       AND revision.revision=NEW.applied_revision AND revision.human_approval_id=NEW.id
       AND revision.approval_id IS NULL AND revision.actor_user_id=NEW.actor_user_id
       AND revision.source_kind='human_preview_approved'
       AND rtrim(revision.canonical_digest)=rtrim(NEW.applied_digest)
       AND rtrim(revision.request_digest)=rtrim(NEW.request_digest)
       AND revision.action_code=NEW.action_code AND revision.reason=NEW.reason
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_human_audit_events audit
     WHERE audit.organization_id=NEW.organization_id AND audit.assignment_id=NEW.assignment_id
       AND audit.human_approval_id=NEW.id AND audit.actor_user_id=NEW.actor_user_id
       AND audit.before_revision=NEW.expected_revision AND audit.after_revision=NEW.applied_revision
       AND rtrim(audit.before_digest)=rtrim(NEW.expected_digest)
       AND rtrim(audit.after_digest)=rtrim(NEW.applied_digest)
       AND audit.action_code=NEW.action_code AND audit.reason=NEW.reason
       AND audit.transaction_id=NEW.transaction_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_human_idempotency replay
     WHERE replay.organization_id=NEW.organization_id AND replay.actor_user_id=NEW.actor_user_id
       AND rtrim(replay.idempotency_key_hash)=rtrim(NEW.idempotency_key_hash)
       AND rtrim(replay.request_digest)=rtrim(NEW.request_digest)
       AND replay.assignment_id=NEW.assignment_id AND replay.human_approval_id=NEW.id
       AND replay.response_status=200 AND replay.transaction_id=NEW.transaction_id
       AND replay.response_body #>> '{data,id}'=NEW.appointment_id::TEXT
       AND replay.response_body #>> '{data,scheduleAuthority,digest}'=rtrim(NEW.applied_digest)
       AND replay.response_body #>> '{data,scheduleAuthority,revision}'=NEW.applied_revision::TEXT
       AND replay.response_body #>> '{data,humanApproval,id}'=NEW.id::TEXT
  ) THEN
    RAISE EXCEPTION 'Human approval did not commit complete immutable mutation evidence'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_approval_incomplete';
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER canonical_schedule_human_approvals_complete
  AFTER INSERT ON public.canonical_schedule_human_approvals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_validate_human_approval_completion();

-- Appointment creation is still a compatibility ingress, but once the runtime
-- role loses direct assignment-table DML the trigger needs trusted owner rights
-- to create its initial needs-review assignment and immutable revision.
ALTER FUNCTION public.canonical_schedule_create_for_appointment() SECURITY DEFINER;
ALTER FUNCTION public.canonical_schedule_create_for_appointment()
  SET search_path=pg_catalog,public,pg_temp;

REVOKE ALL ON FUNCTION public.canonical_schedule_part4_immutable_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_guard_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_guard_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_guard_appointment_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_create_for_appointment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_actor_authority(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_target_current(UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_preview_digest(
  UUID,UUID,UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,
  TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT,TEXT,TEXT,
  TIMESTAMPTZ,TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_validate_human_approval_completion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_create_mutation_preview(
  UUID,UUID,UUID,TEXT,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,
  TIMESTAMPTZ,TIMESTAMPTZ,JSONB,TEXT,TEXT,JSONB,TEXT,JSONB,JSONB,TEXT,TEXT,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_apply_mutation_approval(
  UUID,UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC;
