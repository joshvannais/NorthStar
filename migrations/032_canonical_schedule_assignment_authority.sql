-- Mission 22 Part 1: canonical tenant assignment and schedule authority.
-- Additive authority only. No conflicts, routing, recommendations, dispatch
-- workflow, field execution, provider transport, or autonomous mutation.

CREATE OR REPLACE FUNCTION public.canonical_schedule_assignment_digest(
  target_state_value TEXT,
  workforce_profile_id_value UUID,
  workforce_crew_id_value UUID,
  schedule_state_value TEXT,
  dispatch_state_value TEXT,
  scheduled_start_value TIMESTAMPTZ,
  scheduled_end_value TIMESTAMPTZ,
  appointment_status_value TEXT,
  needs_review_value BOOLEAN,
  review_reasons_value JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'appointmentStatus', appointment_status_value,
    'dispatchState', dispatch_state_value,
    'needsReview', needs_review_value,
    'reviewReasons', review_reasons_value,
    'scheduleState', schedule_state_value,
    'scheduledEnd', CASE WHEN scheduled_end_value IS NULL THEN NULL
      ELSE to_char(scheduled_end_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'scheduledStart', CASE WHEN scheduled_start_value IS NULL THEN NULL
      ELSE to_char(scheduled_start_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'targetState', target_state_value,
    'workforceCrewId', workforce_crew_id_value,
    'workforceProfileId', workforce_profile_id_value
  )::text, 'UTF8')), 'hex')
$function$;

CREATE TABLE public.canonical_schedule_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  appointment_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  graph_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  workforce_profile_id UUID,
  workforce_crew_id UUID,
  target_state VARCHAR(16) NOT NULL DEFAULT 'unassigned',
  schedule_state VARCHAR(16) NOT NULL DEFAULT 'unscheduled',
  dispatch_state VARCHAR(24) NOT NULL DEFAULT 'not_dispatched',
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  appointment_status VARCHAR(50) NOT NULL,
  needs_review BOOLEAN NOT NULL DEFAULT TRUE,
  review_reasons JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  canonical_digest CHAR(64) NOT NULL,
  last_approval_id UUID,
  last_actor_user_id UUID,
  last_action_code VARCHAR(48) NOT NULL,
  last_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_schedule_assignments_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT canonical_schedule_assignments_appointment_unique UNIQUE (organization_id, appointment_id),
  CONSTRAINT canonical_schedule_assignments_operation_unique UNIQUE (organization_id, operation_id),
  CONSTRAINT canonical_schedule_assignments_appointment_fk FOREIGN KEY (organization_id, appointment_id)
    REFERENCES public.canonical_appointments(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_assignments_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
    REFERENCES public.canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_assignments_opportunity_fk FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES public.canonical_opportunities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_assignments_profile_fk FOREIGN KEY (organization_id, workforce_profile_id)
    REFERENCES public.workforce_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_assignments_crew_fk FOREIGN KEY (organization_id, workforce_crew_id)
    REFERENCES public.workforce_crews(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_assignments_actor_fk FOREIGN KEY (organization_id, last_actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_assignments_target_state_check CHECK (
    (target_state = 'unassigned' AND workforce_profile_id IS NULL AND workforce_crew_id IS NULL)
    OR (target_state = 'assigned' AND ((workforce_profile_id IS NOT NULL)::int + (workforce_crew_id IS NOT NULL)::int) = 1)
  ),
  CONSTRAINT canonical_schedule_assignments_schedule_state_check CHECK (
    (schedule_state = 'unscheduled' AND scheduled_start IS NULL AND scheduled_end IS NULL)
    OR (schedule_state = 'scheduled' AND scheduled_start IS NOT NULL
      AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
  ),
  CONSTRAINT canonical_schedule_assignments_dispatch_state_check CHECK (
    dispatch_state IN ('not_dispatched', 'dispatched', 'revoked')
  ),
  CONSTRAINT canonical_schedule_assignments_status_check CHECK (
    length(btrim(appointment_status)) BETWEEN 1 AND 50
  ),
  CONSTRAINT canonical_schedule_assignments_review_reasons_check CHECK (
    jsonb_typeof(review_reasons) = 'array'
    AND (needs_review OR jsonb_array_length(review_reasons) = 0)
    AND (NOT needs_review OR jsonb_array_length(review_reasons) > 0)
  ),
  CONSTRAINT canonical_schedule_assignments_revision_check CHECK (revision >= 1),
  CONSTRAINT canonical_schedule_assignments_digest_check CHECK (canonical_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_schedule_assignments_action_check CHECK (
    length(btrim(last_action_code)) BETWEEN 1 AND 48
    AND last_action_code ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT canonical_schedule_assignments_reason_check CHECK (
    length(btrim(last_reason)) BETWEEN 1 AND 1000 AND octet_length(last_reason) <= 4000
  )
);

CREATE INDEX canonical_schedule_assignments_tenant_schedule
  ON public.canonical_schedule_assignments(organization_id, schedule_state, scheduled_start, id);
CREATE INDEX canonical_schedule_assignments_profile_schedule
  ON public.canonical_schedule_assignments(organization_id, workforce_profile_id, scheduled_start, scheduled_end)
  WHERE workforce_profile_id IS NOT NULL;
CREATE INDEX canonical_schedule_assignments_crew_schedule
  ON public.canonical_schedule_assignments(organization_id, workforce_crew_id, scheduled_start, scheduled_end)
  WHERE workforce_crew_id IS NOT NULL;

CREATE TABLE public.canonical_schedule_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  actor_access_role VARCHAR(16) NOT NULL,
  auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
  expected_revision BIGINT NOT NULL,
  expected_digest CHAR(64) NOT NULL,
  applied_revision BIGINT NOT NULL,
  applied_digest CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  action_code VARCHAR(48) NOT NULL,
  reason TEXT NOT NULL,
  approved_scheduled_start TIMESTAMPTZ,
  approved_scheduled_end TIMESTAMPTZ,
  approved_appointment_status VARCHAR(50) NOT NULL,
  resulting_schedule_state VARCHAR(16) NOT NULL,
  resulting_dispatch_state VARCHAR(24) NOT NULL,
  resulting_needs_review BOOLEAN NOT NULL,
  resulting_review_reasons JSONB NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_schedule_approvals_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT canonical_schedule_approvals_idempotency_unique
    UNIQUE (organization_id, actor_user_id, idempotency_key_hash),
  CONSTRAINT canonical_schedule_approvals_assignment_fk FOREIGN KEY (organization_id, assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_approvals_appointment_fk FOREIGN KEY (organization_id, appointment_id)
    REFERENCES public.canonical_appointments(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_approvals_actor_fk FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_approvals_role_check CHECK (actor_access_role IN ('owner', 'admin', 'member')),
  CONSTRAINT canonical_schedule_approvals_revision_check CHECK (
    expected_revision >= 1 AND applied_revision = expected_revision + 1
  ),
  CONSTRAINT canonical_schedule_approvals_digest_check CHECK (
    expected_digest ~ '^[0-9a-f]{64}$'
    AND applied_digest ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$'
    AND idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_schedule_approvals_action_check CHECK (
    action_code IN ('calendar_drag_drop', 'calendar_resize', 'calendar_edit')
  ),
  CONSTRAINT canonical_schedule_approvals_reason_check CHECK (
    length(btrim(reason)) BETWEEN 1 AND 1000 AND octet_length(reason) <= 4000
  ),
  CONSTRAINT canonical_schedule_approvals_schedule_check CHECK (
    (resulting_schedule_state = 'unscheduled'
      AND approved_scheduled_start IS NULL AND approved_scheduled_end IS NULL)
    OR (resulting_schedule_state = 'scheduled'
      AND approved_scheduled_start IS NOT NULL AND approved_scheduled_end IS NOT NULL
      AND approved_scheduled_end > approved_scheduled_start)
  ),
  CONSTRAINT canonical_schedule_approvals_dispatch_check CHECK (
    resulting_dispatch_state IN ('not_dispatched', 'dispatched', 'revoked')
  ),
  CONSTRAINT canonical_schedule_approvals_review_check CHECK (
    jsonb_typeof(resulting_review_reasons) = 'array'
    AND (resulting_needs_review OR jsonb_array_length(resulting_review_reasons) = 0)
    AND (NOT resulting_needs_review OR jsonb_array_length(resulting_review_reasons) > 0)
  )
);

ALTER TABLE public.canonical_schedule_assignments
  ADD CONSTRAINT canonical_schedule_assignments_last_approval_fk
  FOREIGN KEY (organization_id, last_approval_id)
  REFERENCES public.canonical_schedule_approvals(organization_id, id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.canonical_schedule_assignment_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  workforce_profile_id UUID,
  workforce_crew_id UUID,
  target_state VARCHAR(16) NOT NULL,
  schedule_state VARCHAR(16) NOT NULL,
  dispatch_state VARCHAR(24) NOT NULL,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  appointment_status VARCHAR(50) NOT NULL,
  needs_review BOOLEAN NOT NULL,
  review_reasons JSONB NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  approval_id UUID,
  actor_user_id UUID,
  action_code VARCHAR(48) NOT NULL,
  reason TEXT NOT NULL,
  request_digest CHAR(64),
  source_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_schedule_revisions_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT canonical_schedule_revisions_number_unique UNIQUE (organization_id, assignment_id, revision),
  CONSTRAINT canonical_schedule_revisions_assignment_fk FOREIGN KEY (organization_id, assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_revisions_approval_fk FOREIGN KEY (organization_id, approval_id)
    REFERENCES public.canonical_schedule_approvals(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_revisions_actor_fk FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_revisions_profile_fk FOREIGN KEY (organization_id, workforce_profile_id)
    REFERENCES public.workforce_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_revisions_crew_fk FOREIGN KEY (organization_id, workforce_crew_id)
    REFERENCES public.workforce_crews(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_revisions_shape_check CHECK (
    ((target_state = 'unassigned' AND workforce_profile_id IS NULL AND workforce_crew_id IS NULL)
      OR (target_state = 'assigned' AND ((workforce_profile_id IS NOT NULL)::int + (workforce_crew_id IS NOT NULL)::int) = 1))
    AND ((schedule_state = 'unscheduled' AND scheduled_start IS NULL AND scheduled_end IS NULL)
      OR (schedule_state = 'scheduled' AND scheduled_start IS NOT NULL
        AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start))
    AND dispatch_state IN ('not_dispatched', 'dispatched', 'revoked')
  ),
  CONSTRAINT canonical_schedule_revisions_digest_check CHECK (
    canonical_digest ~ '^[0-9a-f]{64}$'
    AND (request_digest IS NULL OR request_digest ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT canonical_schedule_revisions_source_check CHECK (
    (source_kind IN ('legacy_import', 'appointment_created')
      AND revision = 1 AND approval_id IS NULL AND actor_user_id IS NULL
      AND request_digest IS NULL)
    OR (source_kind = 'human_approved' AND revision > 1
      AND approval_id IS NOT NULL AND actor_user_id IS NOT NULL
      AND request_digest IS NOT NULL)
  ),
  CONSTRAINT canonical_schedule_revisions_snapshot_check CHECK (jsonb_typeof(source_snapshot) = 'object')
);

CREATE INDEX canonical_schedule_revisions_history
  ON public.canonical_schedule_assignment_revisions(organization_id, assignment_id, revision DESC);

CREATE TABLE public.canonical_schedule_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  approval_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  action_code VARCHAR(48) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64) NOT NULL,
  after_digest CHAR(64) NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_schedule_audit_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT canonical_schedule_audit_approval_unique UNIQUE (organization_id, approval_id),
  CONSTRAINT canonical_schedule_audit_assignment_fk FOREIGN KEY (organization_id, assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_audit_approval_fk FOREIGN KEY (organization_id, approval_id)
    REFERENCES public.canonical_schedule_approvals(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_audit_actor_fk FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_audit_revision_check CHECK (after_revision = before_revision + 1),
  CONSTRAINT canonical_schedule_audit_digest_check CHECK (
    before_digest ~ '^[0-9a-f]{64}$' AND after_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_schedule_audit_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX canonical_schedule_audit_tenant_time
  ON public.canonical_schedule_audit_events(organization_id, created_at DESC, id);

CREATE TABLE public.canonical_schedule_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  assignment_id UUID NOT NULL,
  approval_id UUID NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_schedule_idempotency_primary
    PRIMARY KEY (organization_id, actor_user_id, idempotency_key_hash),
  CONSTRAINT canonical_schedule_idempotency_actor_fk FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_idempotency_assignment_fk FOREIGN KEY (organization_id, assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_idempotency_approval_fk FOREIGN KEY (organization_id, approval_id)
    REFERENCES public.canonical_schedule_approvals(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_schedule_idempotency_digest_check CHECK (
    idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_schedule_idempotency_status_check CHECK (response_status BETWEEN 200 AND 299),
  CONSTRAINT canonical_schedule_idempotency_body_check CHECK (jsonb_typeof(response_body) = 'object')
);

CREATE OR REPLACE FUNCTION public.canonical_schedule_immutable_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'Canonical schedule evidence is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_evidence_immutable';
END
$function$;

CREATE TRIGGER canonical_schedule_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_assignment_revisions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_immutable_evidence();
CREATE TRIGGER canonical_schedule_approvals_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_approvals
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_immutable_evidence();
CREATE TRIGGER canonical_schedule_audit_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_immutable_evidence();
CREATE TRIGGER canonical_schedule_idempotency_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_schedule_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_immutable_evidence();

CREATE OR REPLACE FUNCTION public.canonical_schedule_validate_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  membership_record RECORD;
  expected_applied_digest TEXT;
BEGIN
  SELECT * INTO assignment_record
    FROM public.canonical_schedule_assignments
   WHERE organization_id = NEW.organization_id AND id = NEW.assignment_id
   FOR UPDATE;
  IF NOT FOUND OR assignment_record.appointment_id <> NEW.appointment_id THEN
    RAISE EXCEPTION 'Canonical schedule assignment is unavailable'
      USING ERRCODE = '23503', CONSTRAINT = 'canonical_schedule_approval_assignment_unavailable';
  END IF;
  IF assignment_record.revision <> NEW.expected_revision
     OR rtrim(assignment_record.canonical_digest) <> rtrim(NEW.expected_digest) THEN
    RAISE EXCEPTION 'Canonical schedule approval is stale'
      USING ERRCODE = '40001', CONSTRAINT = 'canonical_schedule_approval_stale';
  END IF;

  SELECT membership.id, membership.role, profile.operational_role
    INTO membership_record
    FROM public.organization_memberships membership
    LEFT JOIN public.workforce_profiles profile
      ON profile.organization_id = membership.organization_id
     AND profile.membership_id = membership.id
   WHERE membership.organization_id = NEW.organization_id
     AND membership.user_id = NEW.actor_user_id
     AND membership.status = 'active';
  IF NOT FOUND OR membership_record.role <> NEW.actor_access_role
     OR NOT (membership_record.role IN ('owner', 'admin')
       OR (membership_record.role = 'member' AND membership_record.operational_role = 'dispatcher')) THEN
    RAISE EXCEPTION 'Canonical schedule actor is not authorized'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_actor_unauthorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auth_sessions session
     WHERE session.id = NEW.auth_session_id
       AND session.organization_id = NEW.organization_id
       AND session.user_id = NEW.actor_user_id
       AND session.membership_id = membership_record.id
       AND session.status = 'active'
       AND session.access_expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Canonical schedule session is not current'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_session_inactive';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions subscription
     WHERE subscription.organization_id = NEW.organization_id
       AND (subscription.status = 'active'
         OR (subscription.status = 'trialing'
           AND subscription.trial_started_at IS NOT NULL
           AND subscription.trial_ends_at = subscription.trial_started_at + INTERVAL '14 days'
           AND subscription.trial_ends_at > clock_timestamp()))
  ) THEN
    RAISE EXCEPTION 'Canonical schedule subscription is read-only'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_subscription_read_only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_onboarding onboarding
     WHERE onboarding.organization_id = NEW.organization_id AND onboarding.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'Canonical schedule onboarding is incomplete'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_onboarding_incomplete';
  END IF;

  expected_applied_digest := public.canonical_schedule_assignment_digest(
    assignment_record.target_state,
    assignment_record.workforce_profile_id,
    assignment_record.workforce_crew_id,
    NEW.resulting_schedule_state,
    NEW.resulting_dispatch_state,
    NEW.approved_scheduled_start,
    NEW.approved_scheduled_end,
    NEW.approved_appointment_status,
    NEW.resulting_needs_review,
    NEW.resulting_review_reasons
  );
  IF rtrim(NEW.applied_digest) <> expected_applied_digest
     OR NEW.applied_revision <> assignment_record.revision + 1
     OR NEW.transaction_id <> txid_current()::bigint THEN
    RAISE EXCEPTION 'Canonical schedule approval evidence diverges from the approved result'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_approval_divergent';
  END IF;
  IF NEW.resulting_dispatch_state <> assignment_record.dispatch_state
     AND NOT (
       assignment_record.dispatch_state = 'dispatched'
       AND NEW.resulting_dispatch_state = 'revoked'
       AND (NEW.resulting_schedule_state <> assignment_record.schedule_state
         OR NEW.approved_scheduled_start IS DISTINCT FROM assignment_record.scheduled_start
         OR NEW.approved_scheduled_end IS DISTINCT FROM assignment_record.scheduled_end)
     ) THEN
    RAISE EXCEPTION 'Mission 22 Part 1 cannot create or alter dispatch state'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_dispatch_transition_forbidden';
  END IF;
  IF assignment_record.dispatch_state = 'dispatched'
     AND (NEW.resulting_schedule_state <> assignment_record.schedule_state
       OR NEW.approved_scheduled_start IS DISTINCT FROM assignment_record.scheduled_start
       OR NEW.approved_scheduled_end IS DISTINCT FROM assignment_record.scheduled_end)
     AND NEW.resulting_dispatch_state <> 'revoked' THEN
    RAISE EXCEPTION 'Schedule changes after dispatch must revoke dispatch'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_dispatch_revocation_required';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_schedule_approvals_validate
  BEFORE INSERT ON public.canonical_schedule_approvals
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_validate_approval();

CREATE OR REPLACE FUNCTION public.canonical_schedule_validate_approval_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.canonical_schedule_assignments assignment
      JOIN public.canonical_appointments appointment
        ON appointment.organization_id = assignment.organization_id
       AND appointment.id = assignment.appointment_id
     WHERE assignment.organization_id = NEW.organization_id
       AND assignment.id = NEW.assignment_id
       AND assignment.appointment_id = NEW.appointment_id
       AND assignment.last_approval_id = NEW.id
       AND assignment.last_actor_user_id = NEW.actor_user_id
       AND assignment.revision = NEW.applied_revision
       AND rtrim(assignment.canonical_digest) = rtrim(NEW.applied_digest)
       AND assignment.schedule_state = NEW.resulting_schedule_state
       AND assignment.dispatch_state = NEW.resulting_dispatch_state
       AND assignment.scheduled_start IS NOT DISTINCT FROM NEW.approved_scheduled_start
       AND assignment.scheduled_end IS NOT DISTINCT FROM NEW.approved_scheduled_end
       AND assignment.appointment_status = NEW.approved_appointment_status
       AND assignment.needs_review = NEW.resulting_needs_review
       AND assignment.review_reasons = NEW.resulting_review_reasons
       AND appointment.scheduled_start IS NOT DISTINCT FROM NEW.approved_scheduled_start
       AND appointment.scheduled_end IS NOT DISTINCT FROM NEW.approved_scheduled_end
       AND appointment.status = NEW.approved_appointment_status
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_assignment_revisions revision
     WHERE revision.organization_id = NEW.organization_id
       AND revision.assignment_id = NEW.assignment_id
       AND revision.revision = NEW.applied_revision
       AND revision.approval_id = NEW.id
       AND revision.actor_user_id = NEW.actor_user_id
       AND rtrim(revision.canonical_digest) = rtrim(NEW.applied_digest)
       AND rtrim(revision.request_digest) = rtrim(NEW.request_digest)
       AND revision.action_code = NEW.action_code
       AND revision.reason = NEW.reason
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_audit_events audit
     WHERE audit.organization_id = NEW.organization_id
       AND audit.assignment_id = NEW.assignment_id
       AND audit.approval_id = NEW.id
       AND audit.actor_user_id = NEW.actor_user_id
       AND audit.before_revision = NEW.expected_revision
       AND audit.after_revision = NEW.applied_revision
       AND rtrim(audit.before_digest) = rtrim(NEW.expected_digest)
       AND rtrim(audit.after_digest) = rtrim(NEW.applied_digest)
       AND audit.action_code = NEW.action_code
       AND audit.reason = NEW.reason
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_idempotency replay
     WHERE replay.organization_id = NEW.organization_id
       AND replay.actor_user_id = NEW.actor_user_id
       AND rtrim(replay.idempotency_key_hash) = rtrim(NEW.idempotency_key_hash)
       AND rtrim(replay.request_digest) = rtrim(NEW.request_digest)
       AND replay.assignment_id = NEW.assignment_id
       AND replay.approval_id = NEW.id
       AND replay.response_status = 200
       AND replay.response_body #>> '{data,id}' = NEW.appointment_id::text
       AND replay.response_body #>> '{data,scheduleAuthority,digest}' = rtrim(NEW.applied_digest)
       AND replay.response_body #>> '{data,scheduleAuthority,revision}' = NEW.applied_revision::text
  ) THEN
    RAISE EXCEPTION 'Canonical schedule approval did not commit complete mutation evidence'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_approval_incomplete';
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER canonical_schedule_approvals_complete
  AFTER INSERT ON public.canonical_schedule_approvals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_validate_approval_completion();

CREATE OR REPLACE FUNCTION public.canonical_schedule_guard_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  approval_record public.canonical_schedule_approvals%ROWTYPE;
  expected_digest TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Canonical schedule assignments cannot be deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_assignment_delete_forbidden';
  END IF;
  expected_digest := public.canonical_schedule_assignment_digest(
    NEW.target_state, NEW.workforce_profile_id, NEW.workforce_crew_id,
    NEW.schedule_state, NEW.dispatch_state, NEW.scheduled_start, NEW.scheduled_end,
    NEW.appointment_status, NEW.needs_review, NEW.review_reasons
  );
  IF rtrim(NEW.canonical_digest) <> expected_digest THEN
    RAISE EXCEPTION 'Canonical schedule assignment digest is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_assignment_digest_invalid';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.last_approval_id IS NOT NULL OR NEW.last_actor_user_id IS NOT NULL
       OR NEW.last_action_code NOT IN ('legacy_import', 'appointment_created') THEN
      RAISE EXCEPTION 'Canonical schedule assignment initial state is invalid'
        USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_assignment_initial_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.organization_id <> OLD.organization_id OR NEW.id <> OLD.id
     OR NEW.appointment_id <> OLD.appointment_id OR NEW.operation_id <> OLD.operation_id
     OR NEW.graph_id <> OLD.graph_id OR NEW.opportunity_id <> OLD.opportunity_id
     OR NEW.created_at <> OLD.created_at OR NEW.revision <> OLD.revision + 1
     OR NEW.workforce_profile_id IS DISTINCT FROM OLD.workforce_profile_id
     OR NEW.workforce_crew_id IS DISTINCT FROM OLD.workforce_crew_id
     OR NEW.target_state <> OLD.target_state THEN
    RAISE EXCEPTION 'Canonical schedule assignment identity or Part 1 target is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_assignment_identity_immutable';
  END IF;
  SELECT * INTO approval_record
    FROM public.canonical_schedule_approvals approval
   WHERE approval.organization_id = NEW.organization_id
     AND approval.id = NEW.last_approval_id
     AND approval.assignment_id = NEW.id
     AND approval.appointment_id = NEW.appointment_id
     AND approval.actor_user_id = NEW.last_actor_user_id
     AND approval.expected_revision = OLD.revision
     AND rtrim(approval.expected_digest) = rtrim(OLD.canonical_digest)
     AND approval.applied_revision = NEW.revision
     AND rtrim(approval.applied_digest) = rtrim(NEW.canonical_digest)
     AND approval.transaction_id = txid_current()::bigint;
  IF NOT FOUND OR approval_record.action_code <> NEW.last_action_code
     OR approval_record.reason <> NEW.last_reason
     OR approval_record.approved_scheduled_start IS DISTINCT FROM NEW.scheduled_start
     OR approval_record.approved_scheduled_end IS DISTINCT FROM NEW.scheduled_end
     OR approval_record.approved_appointment_status <> NEW.appointment_status
     OR approval_record.resulting_schedule_state <> NEW.schedule_state
     OR approval_record.resulting_dispatch_state <> NEW.dispatch_state
     OR approval_record.resulting_needs_review <> NEW.needs_review
     OR approval_record.resulting_review_reasons <> NEW.review_reasons THEN
    RAISE EXCEPTION 'Canonical schedule assignment mutation lacks matching approval evidence'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_approval_required';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_schedule_assignments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_schedule_assignments
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_guard_assignment();

CREATE OR REPLACE FUNCTION public.canonical_schedule_guard_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  approval_record public.canonical_schedule_approvals%ROWTYPE;
BEGIN
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments
   WHERE organization_id = NEW.organization_id AND id = NEW.assignment_id;
  IF NOT FOUND OR assignment_record.revision <> NEW.revision
     OR rtrim(assignment_record.canonical_digest) <> rtrim(NEW.canonical_digest)
     OR assignment_record.target_state <> NEW.target_state
     OR assignment_record.workforce_profile_id IS DISTINCT FROM NEW.workforce_profile_id
     OR assignment_record.workforce_crew_id IS DISTINCT FROM NEW.workforce_crew_id
     OR assignment_record.schedule_state <> NEW.schedule_state
     OR assignment_record.dispatch_state <> NEW.dispatch_state
     OR assignment_record.scheduled_start IS DISTINCT FROM NEW.scheduled_start
     OR assignment_record.scheduled_end IS DISTINCT FROM NEW.scheduled_end
     OR assignment_record.appointment_status <> NEW.appointment_status
     OR assignment_record.needs_review <> NEW.needs_review
     OR assignment_record.review_reasons <> NEW.review_reasons THEN
    RAISE EXCEPTION 'Canonical schedule revision diverges from current authority'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_revision_divergent';
  END IF;
  IF NEW.source_kind = 'human_approved' THEN
    SELECT * INTO approval_record FROM public.canonical_schedule_approvals
     WHERE organization_id = NEW.organization_id AND id = NEW.approval_id
       AND assignment_id = NEW.assignment_id AND actor_user_id = NEW.actor_user_id
       AND applied_revision = NEW.revision
       AND rtrim(applied_digest) = rtrim(NEW.canonical_digest)
       AND rtrim(request_digest) = rtrim(NEW.request_digest)
       AND transaction_id = txid_current()::bigint;
    IF NOT FOUND OR approval_record.action_code <> NEW.action_code OR approval_record.reason <> NEW.reason THEN
      RAISE EXCEPTION 'Canonical schedule revision lacks approval evidence'
        USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_revision_approval_required';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_schedule_revisions_validate
  BEFORE INSERT ON public.canonical_schedule_assignment_revisions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_guard_revision();

CREATE OR REPLACE FUNCTION public.canonical_schedule_guard_appointment_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Appointment creation remains the accepted compatibility ingress. The
    -- AFTER INSERT trigger copies any accepted initial schedule into a
    -- needs-review authority without inventing Mission 22 approval evidence.
    -- Every later schedule/status mutation is guarded below.
    RETURN NEW;
  END IF;
  IF NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start
     AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end
     AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments
   WHERE organization_id = NEW.organization_id AND appointment_id = NEW.id;
  IF NOT FOUND OR assignment_record.scheduled_start IS DISTINCT FROM NEW.scheduled_start
     OR assignment_record.scheduled_end IS DISTINCT FROM NEW.scheduled_end
     OR assignment_record.appointment_status <> NEW.status
     OR NOT EXISTS (
        SELECT 1 FROM public.canonical_schedule_approvals approval
        WHERE approval.organization_id = NEW.organization_id
          AND approval.id = assignment_record.last_approval_id
          AND approval.assignment_id = assignment_record.id
          AND approval.applied_revision = assignment_record.revision
          AND rtrim(approval.applied_digest) = rtrim(assignment_record.canonical_digest)
          AND approval.transaction_id = txid_current()::bigint
     ) THEN
    RAISE EXCEPTION 'Appointment schedule mutation requires matching Mission 22 approval'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_approval_required';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_create_for_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  schedule_state_value TEXT;
  reasons JSONB;
  digest_value TEXT;
BEGIN
  schedule_state_value := CASE
    WHEN NEW.scheduled_start IS NOT NULL AND NEW.scheduled_end IS NOT NULL
      THEN 'scheduled'
    ELSE 'unscheduled'
  END;
  reasons := CASE WHEN schedule_state_value = 'scheduled'
    THEN '["appointment_creation_schedule_unreviewed","conflict_evaluation_not_available"]'::jsonb
    ELSE '["assignment_unreviewed","conflict_evaluation_not_available"]'::jsonb
  END;
  digest_value := public.canonical_schedule_assignment_digest(
    'unassigned', NULL, NULL, schedule_state_value, 'not_dispatched',
    NEW.scheduled_start, NEW.scheduled_end,
    NEW.status, TRUE, reasons
  );
  INSERT INTO public.canonical_schedule_assignments (
    organization_id, appointment_id, operation_id, graph_id, opportunity_id,
    target_state, schedule_state, dispatch_state, scheduled_start, scheduled_end,
    appointment_status,
    needs_review, review_reasons, revision, canonical_digest,
    last_action_code, last_reason
  ) VALUES (
    NEW.organization_id, NEW.id, NEW.operation_id, NEW.graph_id, NEW.opportunity_id,
    'unassigned', schedule_state_value, 'not_dispatched',
    NEW.scheduled_start, NEW.scheduled_end, NEW.status,
    TRUE, reasons, 1, digest_value,
    'appointment_created',
    'Canonical assignment created from accepted appointment authority; Mission 22 approval was not inferred.'
  ) RETURNING * INTO assignment_record;
  INSERT INTO public.canonical_schedule_assignment_revisions (
    organization_id, assignment_id, revision, target_state, schedule_state,
    dispatch_state, scheduled_start, scheduled_end, appointment_status,
    needs_review, review_reasons,
    canonical_digest, source_kind, action_code, reason, source_snapshot
  ) VALUES (
    NEW.organization_id, assignment_record.id, 1, 'unassigned', schedule_state_value,
    'not_dispatched', NEW.scheduled_start, NEW.scheduled_end,
    NEW.status, TRUE, reasons, digest_value,
    'appointment_created', 'appointment_created',
    'Canonical assignment created from accepted appointment authority; Mission 22 approval was not inferred.',
    jsonb_build_object(
      'appointmentId', NEW.id,
      'scheduledStart', NEW.scheduled_start,
      'scheduledEnd', NEW.scheduled_end,
      'status', NEW.status
    )
  );
  RETURN NEW;
END
$function$;

INSERT INTO public.canonical_schedule_assignments (
  organization_id, appointment_id, operation_id, graph_id, opportunity_id,
  target_state, schedule_state, dispatch_state, scheduled_start, scheduled_end,
  appointment_status, needs_review, review_reasons, revision, canonical_digest,
  last_action_code, last_reason, created_at, updated_at
)
SELECT appointment.organization_id,
       appointment.id,
       appointment.operation_id,
       appointment.graph_id,
       appointment.opportunity_id,
       'unassigned',
       CASE WHEN appointment.scheduled_start IS NOT NULL
                  AND appointment.scheduled_end IS NOT NULL
                  AND appointment.scheduled_end > appointment.scheduled_start
            THEN 'scheduled' ELSE 'unscheduled' END,
       'not_dispatched',
       CASE WHEN appointment.scheduled_start IS NOT NULL
                  AND appointment.scheduled_end IS NOT NULL
                  AND appointment.scheduled_end > appointment.scheduled_start
            THEN appointment.scheduled_start ELSE NULL END,
       CASE WHEN appointment.scheduled_start IS NOT NULL
                  AND appointment.scheduled_end IS NOT NULL
                  AND appointment.scheduled_end > appointment.scheduled_start
            THEN appointment.scheduled_end ELSE NULL END,
       appointment.status,
       TRUE,
       CASE WHEN (appointment.scheduled_start IS NULL AND appointment.scheduled_end IS NULL)
                  OR (appointment.scheduled_start IS NOT NULL
                    AND appointment.scheduled_end IS NOT NULL
                    AND appointment.scheduled_end > appointment.scheduled_start)
            THEN '["legacy_import_unreviewed","conflict_evaluation_not_available"]'::jsonb
            ELSE '["legacy_import_unreviewed","legacy_schedule_invalid","conflict_evaluation_not_available"]'::jsonb END,
       1,
       public.canonical_schedule_assignment_digest(
         'unassigned', NULL, NULL,
         CASE WHEN appointment.scheduled_start IS NOT NULL
                    AND appointment.scheduled_end IS NOT NULL
                    AND appointment.scheduled_end > appointment.scheduled_start
              THEN 'scheduled' ELSE 'unscheduled' END,
         'not_dispatched',
         CASE WHEN appointment.scheduled_start IS NOT NULL
                    AND appointment.scheduled_end IS NOT NULL
                    AND appointment.scheduled_end > appointment.scheduled_start
              THEN appointment.scheduled_start ELSE NULL END,
         CASE WHEN appointment.scheduled_start IS NOT NULL
                    AND appointment.scheduled_end IS NOT NULL
                    AND appointment.scheduled_end > appointment.scheduled_start
              THEN appointment.scheduled_end ELSE NULL END,
         appointment.status,
         TRUE,
         CASE WHEN (appointment.scheduled_start IS NULL AND appointment.scheduled_end IS NULL)
                    OR (appointment.scheduled_start IS NOT NULL
                      AND appointment.scheduled_end IS NOT NULL
                      AND appointment.scheduled_end > appointment.scheduled_start)
              THEN '["legacy_import_unreviewed","conflict_evaluation_not_available"]'::jsonb
              ELSE '["legacy_import_unreviewed","legacy_schedule_invalid","conflict_evaluation_not_available"]'::jsonb END
       ),
       'legacy_import',
       'Imported from the pre-Mission 22 appointment authority; human approval was not inferred.',
       appointment.created_at,
       appointment.updated_at
  FROM public.canonical_appointments appointment
 ORDER BY appointment.organization_id, appointment.id;

INSERT INTO public.canonical_schedule_assignment_revisions (
  organization_id, assignment_id, revision, target_state, schedule_state,
  dispatch_state, scheduled_start, scheduled_end, appointment_status,
  needs_review, review_reasons, canonical_digest, source_kind, action_code,
  reason, source_snapshot, created_at
)
SELECT assignment.organization_id, assignment.id, 1, assignment.target_state,
       assignment.schedule_state, assignment.dispatch_state,
       assignment.scheduled_start, assignment.scheduled_end,
       assignment.appointment_status, assignment.needs_review,
       assignment.review_reasons, assignment.canonical_digest,
       'legacy_import', 'legacy_import', assignment.last_reason,
       jsonb_build_object(
         'appointmentId', appointment.id,
         'scheduledStart', appointment.scheduled_start,
         'scheduledEnd', appointment.scheduled_end,
         'status', appointment.status
       ),
       assignment.created_at
  FROM public.canonical_schedule_assignments assignment
  JOIN public.canonical_appointments appointment
    ON appointment.organization_id = assignment.organization_id
   AND appointment.id = assignment.appointment_id
 ORDER BY assignment.organization_id, assignment.id;

UPDATE public.canonical_appointments appointment
   SET scheduled_start = assignment.scheduled_start,
       scheduled_end = assignment.scheduled_end
  FROM public.canonical_schedule_assignments assignment
 WHERE assignment.organization_id = appointment.organization_id
   AND assignment.appointment_id = appointment.id
   AND (appointment.scheduled_start IS DISTINCT FROM assignment.scheduled_start
     OR appointment.scheduled_end IS DISTINCT FROM assignment.scheduled_end);

ALTER TABLE public.canonical_appointments
  DROP CONSTRAINT canonical_appointments_schedule_check;
ALTER TABLE public.canonical_appointments
  ADD CONSTRAINT canonical_appointments_schedule_check CHECK (
    (scheduled_start IS NULL AND scheduled_end IS NULL)
    OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
  );

CREATE TRIGGER canonical_schedule_appointments_guard
  BEFORE INSERT OR UPDATE OF scheduled_start, scheduled_end, status ON public.canonical_appointments
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_guard_appointment_write();
CREATE TRIGGER canonical_schedule_appointments_create
  AFTER INSERT ON public.canonical_appointments
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_create_for_appointment();
