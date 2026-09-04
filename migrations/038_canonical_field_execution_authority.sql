-- Mission 23 Part 2: canonical field-execution identity and lifecycle foundation.
-- Additive authority only. No labor/time intervals, materials, equipment, files,
-- progress, blockers, completion, UI, Polaris writes, or provider actions.

CREATE OR REPLACE FUNCTION public.canonical_field_execution_reason_valid(value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  utf8_value BYTEA;
  byte_position INTEGER;
  byte_value INTEGER;
BEGIN
  IF value IS NULL
    OR value <> btrim(value)
    OR value <> normalize(value,NFC)
    OR char_length(value) NOT BETWEEN 1 AND 1000
    OR octet_length(value) > 4000
  THEN
    RETURN FALSE;
  END IF;

  utf8_value := convert_to(value,'UTF8');
  FOR byte_position IN 0..octet_length(utf8_value)-1 LOOP
    byte_value := get_byte(utf8_value,byte_position);
    IF byte_value BETWEEN 1 AND 8
      OR byte_value IN (11,12)
      OR byte_value BETWEEN 14 AND 31
      OR byte_value = 127
    THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_field_execution_digest(
  execution_id_value UUID,
  appointment_id_value UUID,
  operation_id_value UUID,
  graph_id_value UUID,
  opportunity_id_value UUID,
  assignment_id_value UUID,
  lifecycle_state_value TEXT,
  assignment_revision_value BIGINT,
  assignment_digest_value TEXT,
  recorded_by_user_id_value UUID,
  performed_by_profile_id_value UUID
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'assignmentDigest',assignment_digest_value,
    'assignmentId',assignment_id_value,
    'assignmentRevision',assignment_revision_value,
    'executionId',execution_id_value,
    'graphId',graph_id_value,
    'lifecycleState',lifecycle_state_value,
    'operationId',operation_id_value,
    'opportunityId',opportunity_id_value,
    'appointmentId',appointment_id_value,
    'performedByProfileId',performed_by_profile_id_value,
    'recordedByUserId',recorded_by_user_id_value
  )::TEXT,'UTF8')),'hex')
$function$;

CREATE TABLE public.canonical_field_executions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  appointment_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  graph_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  lifecycle_state VARCHAR(24) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  revision BIGINT NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  last_event_id UUID NOT NULL,
  last_recorded_by_user_id UUID NOT NULL,
  last_performed_by_profile_id UUID NOT NULL,
  last_action_code VARCHAR(24) NOT NULL,
  last_reason TEXT NOT NULL,
  last_transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_executions_tenant_identity UNIQUE (organization_id,id),
  CONSTRAINT canonical_field_executions_appointment_unique UNIQUE (organization_id,appointment_id),
  CONSTRAINT canonical_field_executions_assignment_unique UNIQUE (organization_id,assignment_id),
  CONSTRAINT canonical_field_executions_appointment_fk FOREIGN KEY (organization_id,appointment_id)
    REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_executions_operation_fk FOREIGN KEY (organization_id,operation_id,graph_id)
    REFERENCES public.canonical_operations(organization_id,id,graph_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_executions_opportunity_fk FOREIGN KEY (organization_id,opportunity_id)
    REFERENCES public.canonical_opportunities(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_executions_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_executions_recorder_fk FOREIGN KEY (organization_id,last_recorded_by_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_executions_performer_fk FOREIGN KEY (organization_id,last_performed_by_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_executions_state_check CHECK (
    lifecycle_state IN ('not_started','in_progress','paused')
  ),
  CONSTRAINT canonical_field_executions_revision_check CHECK (revision >= 1),
  CONSTRAINT canonical_field_executions_digest_check CHECK (
    source_assignment_digest ~ '^[0-9a-f]{64}$'
    AND canonical_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_field_executions_action_check CHECK (
    last_action_code IN ('initialize','start','pause','resume')
  ),
  CONSTRAINT canonical_field_executions_reason_check CHECK (
    public.canonical_field_execution_reason_valid(last_reason)
  )
);

CREATE INDEX canonical_field_executions_tenant_state
  ON public.canonical_field_executions(organization_id,lifecycle_state,updated_at DESC,id);

CREATE TABLE public.canonical_field_execution_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  recorded_by_user_id UUID NOT NULL,
  performed_by_profile_id UUID NOT NULL,
  auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
  action_code VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64),
  after_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_execution_events_tenant_identity UNIQUE (organization_id,id),
  CONSTRAINT canonical_field_execution_events_revision_unique
    UNIQUE (organization_id,execution_id,after_revision),
  CONSTRAINT canonical_field_execution_events_execution_fk FOREIGN KEY (organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_field_execution_events_appointment_fk FOREIGN KEY (organization_id,appointment_id)
    REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_events_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_events_recorder_fk FOREIGN KEY (organization_id,recorded_by_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_events_performer_fk FOREIGN KEY (organization_id,performed_by_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_events_action_check CHECK (
    action_code IN ('initialize','start','pause','resume')
  ),
  CONSTRAINT canonical_field_execution_events_reason_check CHECK (
    public.canonical_field_execution_reason_valid(reason)
  ),
  CONSTRAINT canonical_field_execution_events_revision_check CHECK (
    (action_code='initialize' AND before_revision=0 AND after_revision=1 AND before_digest IS NULL)
    OR (action_code<>'initialize' AND before_revision>=1
      AND after_revision=before_revision+1 AND before_digest IS NOT NULL)
  ),
  CONSTRAINT canonical_field_execution_events_digest_check CHECK (
    (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$')
    AND after_digest ~ '^[0-9a-f]{64}$'
    AND source_assignment_digest ~ '^[0-9a-f]{64}$'
    AND idempotency_key_hash ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_field_execution_events_correlation_check CHECK (
    request_correlation_id ~ '^[ -~]{1,128}$'
  )
);

ALTER TABLE public.canonical_field_executions
  ADD CONSTRAINT canonical_field_executions_last_event_fk
  FOREIGN KEY (organization_id,last_event_id)
  REFERENCES public.canonical_field_execution_events(organization_id,id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.canonical_field_execution_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL,
  event_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  appointment_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  graph_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  lifecycle_state VARCHAR(24) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  recorded_by_user_id UUID NOT NULL,
  performed_by_profile_id UUID NOT NULL,
  action_code VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_execution_revisions_tenant_identity UNIQUE (organization_id,id),
  CONSTRAINT canonical_field_execution_revisions_number_unique
    UNIQUE (organization_id,execution_id,revision),
  CONSTRAINT canonical_field_execution_revisions_execution_fk FOREIGN KEY (organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_event_fk FOREIGN KEY (organization_id,event_id)
    REFERENCES public.canonical_field_execution_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_appointment_fk FOREIGN KEY (organization_id,appointment_id)
    REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_operation_fk FOREIGN KEY (organization_id,operation_id,graph_id)
    REFERENCES public.canonical_operations(organization_id,id,graph_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_opportunity_fk FOREIGN KEY (organization_id,opportunity_id)
    REFERENCES public.canonical_opportunities(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_recorder_fk FOREIGN KEY (organization_id,recorded_by_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_performer_fk FOREIGN KEY (organization_id,performed_by_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_revisions_state_check CHECK (
    lifecycle_state IN ('not_started','in_progress','paused')
  ),
  CONSTRAINT canonical_field_execution_revisions_action_check CHECK (
    action_code IN ('initialize','start','pause','resume')
  ),
  CONSTRAINT canonical_field_execution_revisions_reason_check CHECK (
    public.canonical_field_execution_reason_valid(reason)
  ),
  CONSTRAINT canonical_field_execution_revisions_digest_check CHECK (
    source_assignment_digest ~ '^[0-9a-f]{64}$'
    AND canonical_digest ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX canonical_field_execution_revisions_history
  ON public.canonical_field_execution_revisions(organization_id,execution_id,revision DESC);

CREATE TABLE public.canonical_field_execution_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL,
  event_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  performed_by_profile_id UUID NOT NULL,
  action_code VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64),
  after_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_execution_audit_tenant_identity UNIQUE (organization_id,id),
  CONSTRAINT canonical_field_execution_audit_event_unique UNIQUE (organization_id,event_id),
  CONSTRAINT canonical_field_execution_audit_execution_fk FOREIGN KEY (organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_audit_event_fk FOREIGN KEY (organization_id,event_id)
    REFERENCES public.canonical_field_execution_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_audit_appointment_fk FOREIGN KEY (organization_id,appointment_id)
    REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_audit_assignment_fk FOREIGN KEY (organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_audit_actor_fk FOREIGN KEY (organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_audit_performer_fk FOREIGN KEY (organization_id,performed_by_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_audit_action_check CHECK (
    action_code IN ('initialize','start','pause','resume')
  ),
  CONSTRAINT canonical_field_execution_audit_reason_check CHECK (
    public.canonical_field_execution_reason_valid(reason)
  ),
  CONSTRAINT canonical_field_execution_audit_revision_check CHECK (
    (action_code='initialize' AND before_revision=0 AND after_revision=1 AND before_digest IS NULL)
    OR (action_code<>'initialize' AND before_revision>=1
      AND after_revision=before_revision+1 AND before_digest IS NOT NULL)
  ),
  CONSTRAINT canonical_field_execution_audit_digest_check CHECK (
    (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$')
    AND after_digest ~ '^[0-9a-f]{64}$'
    AND source_assignment_digest ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_field_execution_audit_correlation_check CHECK (
    request_correlation_id ~ '^[ -~]{1,128}$'
  )
);

CREATE INDEX canonical_field_execution_audit_tenant_time
  ON public.canonical_field_execution_audit_events(organization_id,decided_at DESC,id);

CREATE TABLE public.canonical_field_execution_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  action_code VARCHAR(24) NOT NULL,
  identity_kind VARCHAR(16) NOT NULL,
  identity_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  event_id UUID NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_execution_idempotency_primary
    PRIMARY KEY (organization_id,actor_user_id,idempotency_key_hash),
  CONSTRAINT canonical_field_execution_idempotency_actor_fk FOREIGN KEY (organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_idempotency_execution_fk FOREIGN KEY (organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_idempotency_event_fk FOREIGN KEY (organization_id,event_id)
    REFERENCES public.canonical_field_execution_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_execution_idempotency_digest_check CHECK (
    idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_field_execution_idempotency_action_check CHECK (
    action_code IN ('initialize','start','pause','resume')
  ),
  CONSTRAINT canonical_field_execution_idempotency_identity_check CHECK (
    (action_code='initialize' AND identity_kind='appointment')
    OR (action_code<>'initialize' AND identity_kind='execution')
  ),
  CONSTRAINT canonical_field_execution_idempotency_response_check CHECK (
    response_status IN (200,201) AND jsonb_typeof(response_body)='object'
  )
);

CREATE OR REPLACE FUNCTION public.canonical_field_execution_request_digest(
  organization_id_value UUID,
  actor_user_id_value UUID,
  auth_session_id_value UUID,
  action_code_value TEXT,
  identity_kind_value TEXT,
  identity_id_value UUID,
  expected_revision_value BIGINT,
  expected_digest_value TEXT,
  assignment_revision_value BIGINT,
  assignment_digest_value TEXT,
  idempotency_key_hash_value TEXT,
  reason_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'action',action_code_value,
    'actorUserId',actor_user_id_value,
    'assignmentDigest',assignment_digest_value,
    'assignmentRevision',assignment_revision_value,
    'authSessionId',auth_session_id_value,
    'expectedDigest',expected_digest_value,
    'expectedRevision',expected_revision_value,
    'idempotencyKeyHash',idempotency_key_hash_value,
    'identityId',identity_id_value,
    'identityKind',identity_kind_value,
    'organizationId',organization_id_value,
    'reason',reason_value
  )::TEXT,'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION public.canonical_field_execution_actor_authority(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID,
  csrf_token_value TEXT,
  mutation_required BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  authority RECORD;
  evaluated_at TIMESTAMPTZ;
BEGIN
  IF mutation_required THEN
    SELECT membership.id AS membership_id,membership.role,membership.status AS membership_status,
           account.status AS account_status,profile.id AS profile_id,profile.operational_role,
           session.id AS session_id,session.status AS session_status,session.access_expires_at,
           session.csrf_token_hash,subscription.status AS subscription_status,
           subscription.trial_started_at,subscription.trial_ends_at,
           onboarding.status AS onboarding_status
      INTO authority
      FROM public.organization_memberships membership
      JOIN public.users account
        ON account.organization_id=membership.organization_id AND account.id=membership.user_id
      JOIN public.workforce_profiles profile
        ON profile.organization_id=membership.organization_id AND profile.membership_id=membership.id
      JOIN public.auth_sessions session
        ON session.organization_id=membership.organization_id
       AND session.membership_id=membership.id
       AND session.user_id=membership.user_id
       AND session.id=auth_session_id_value
      LEFT JOIN LATERAL (
        SELECT current_subscription.status,current_subscription.trial_started_at,
               current_subscription.trial_ends_at
          FROM public.subscriptions current_subscription
         WHERE current_subscription.organization_id=membership.organization_id
         LIMIT 1
      ) subscription ON TRUE
      JOIN public.organization_onboarding onboarding
        ON onboarding.organization_id=membership.organization_id
     WHERE membership.organization_id=organization_id_value
       AND membership.user_id=actor_user_id_value
     FOR SHARE OF membership,account,profile,session,onboarding;
  ELSE
    SELECT membership.id AS membership_id,membership.role,membership.status AS membership_status,
           account.status AS account_status,profile.id AS profile_id,profile.operational_role,
           session.id AS session_id,session.status AS session_status,session.access_expires_at,
           session.csrf_token_hash,subscription.status AS subscription_status,
           subscription.trial_started_at,subscription.trial_ends_at,
           onboarding.status AS onboarding_status
      INTO authority
      FROM public.organization_memberships membership
      JOIN public.users account
        ON account.organization_id=membership.organization_id AND account.id=membership.user_id
      JOIN public.workforce_profiles profile
        ON profile.organization_id=membership.organization_id AND profile.membership_id=membership.id
      JOIN public.auth_sessions session
        ON session.organization_id=membership.organization_id
       AND session.membership_id=membership.id
       AND session.user_id=membership.user_id
       AND session.id=auth_session_id_value
      LEFT JOIN LATERAL (
        SELECT current_subscription.status,current_subscription.trial_started_at,
               current_subscription.trial_ends_at
          FROM public.subscriptions current_subscription
         WHERE current_subscription.organization_id=membership.organization_id
         LIMIT 1
      ) subscription ON TRUE
      JOIN public.organization_onboarding onboarding
        ON onboarding.organization_id=membership.organization_id
     WHERE membership.organization_id=organization_id_value
       AND membership.user_id=actor_user_id_value;
  END IF;
  evaluated_at := clock_timestamp();
  IF NOT FOUND OR authority.membership_status<>'active' OR authority.account_status<>'active'
     OR authority.role<>actor_access_role_value
     OR authority.role NOT IN ('owner','admin','member','viewer')
     OR authority.session_status<>'active' OR authority.access_expires_at<=evaluated_at THEN
    RAISE EXCEPTION 'Current field execution authority is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_field_execution_actor_unauthorized';
  END IF;
  IF mutation_required AND (
       authority.role='viewer'
       OR csrf_token_value IS NULL
       OR octet_length(csrf_token_value) NOT BETWEEN 32 AND 512
       OR encode(sha256(convert_to(csrf_token_value,'UTF8')),'hex')<>rtrim(authority.csrf_token_hash)
       OR authority.onboarding_status<>'complete'
       OR NOT (authority.subscription_status='active'
         OR (authority.subscription_status='trialing'
           AND authority.trial_started_at IS NOT NULL
           AND authority.trial_ends_at=authority.trial_started_at+INTERVAL '14 days'
           AND authority.trial_ends_at>evaluated_at))
     ) THEN
    RAISE EXCEPTION 'Current field execution mutation authority is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_field_execution_actor_unauthorized';
  END IF;
  RETURN jsonb_build_object(
    'accessRole',authority.role,
    'membershipId',authority.membership_id,
    'operationalRole',authority.operational_role,
    'profileId',authority.profile_id,
    'evaluatedAt',to_char(evaluated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_field_execution_actor_in_scope(
  organization_id_value UUID,
  actor_access_role_value TEXT,
  actor_profile_id_value UUID,
  assignment_record public.canonical_schedule_assignments
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT CASE
    WHEN actor_access_role_value IN ('owner','admin') THEN TRUE
    WHEN actor_access_role_value<>'member' THEN FALSE
    WHEN assignment_record.workforce_profile_id=actor_profile_id_value THEN TRUE
    WHEN assignment_record.workforce_crew_id IS NOT NULL THEN EXISTS (
      SELECT 1
        FROM public.workforce_crew_members crew_member
        JOIN public.workforce_profiles profile
          ON profile.organization_id=crew_member.organization_id
         AND profile.id=crew_member.profile_id
        JOIN public.organization_memberships membership
          ON membership.organization_id=profile.organization_id
         AND membership.id=profile.membership_id
        JOIN public.users account
          ON account.organization_id=membership.organization_id
         AND account.id=membership.user_id
       WHERE crew_member.organization_id=organization_id_value
         AND crew_member.crew_id=assignment_record.workforce_crew_id
         AND crew_member.profile_id=actor_profile_id_value
         AND membership.status='active' AND account.status='active'
    )
    ELSE FALSE
  END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_field_execution_projection(
  execution_record public.canonical_field_executions
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT jsonb_build_object(
    'id',execution_record.id,
    'appointmentId',execution_record.appointment_id,
    'operationId',execution_record.operation_id,
    'graphId',execution_record.graph_id,
    'opportunityId',execution_record.opportunity_id,
    'assignmentId',execution_record.assignment_id,
    'lifecycleState',execution_record.lifecycle_state,
    'sourceAssignmentRevision',execution_record.source_assignment_revision,
    'sourceAssignmentDigest',rtrim(execution_record.source_assignment_digest),
    'revision',execution_record.revision,
    'digest',rtrim(execution_record.canonical_digest),
    'recordedByUserId',execution_record.last_recorded_by_user_id,
    'performedByProfileId',execution_record.last_performed_by_profile_id,
    'lastAction',execution_record.last_action_code,
    'lastReason',execution_record.last_reason,
    'createdAt',to_char(execution_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updatedAt',to_char(execution_record.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
$function$;

CREATE OR REPLACE FUNCTION public.canonical_field_execution_immutable_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'Canonical field execution evidence is immutable'
    USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_evidence_immutable';
END
$function$;

CREATE TRIGGER canonical_field_execution_events_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_field_execution_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_execution_immutable_evidence();
CREATE TRIGGER canonical_field_execution_revisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_field_execution_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_execution_immutable_evidence();
CREATE TRIGGER canonical_field_execution_audit_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_field_execution_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_execution_immutable_evidence();
CREATE TRIGGER canonical_field_execution_idempotency_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_field_execution_idempotency
  FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_execution_immutable_evidence();

CREATE OR REPLACE FUNCTION public.canonical_field_execution_guard_current()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  expected_digest TEXT;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Canonical field execution current state cannot be deleted'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_delete_forbidden';
  END IF;
  expected_digest := public.canonical_field_execution_digest(
    NEW.id,NEW.appointment_id,NEW.operation_id,NEW.graph_id,NEW.opportunity_id,
    NEW.assignment_id,NEW.lifecycle_state,NEW.source_assignment_revision,
    rtrim(NEW.source_assignment_digest),NEW.last_recorded_by_user_id,
    NEW.last_performed_by_profile_id
  );
  IF rtrim(NEW.canonical_digest)<>expected_digest
     OR NEW.last_transaction_id<>txid_current()::BIGINT THEN
    RAISE EXCEPTION 'Canonical field execution current state digest is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_digest_invalid';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.lifecycle_state<>'not_started'
       OR NEW.last_action_code<>'initialize' THEN
      RAISE EXCEPTION 'Canonical field execution initial state is invalid'
        USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_initial_invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id
     OR NEW.appointment_id<>OLD.appointment_id OR NEW.operation_id<>OLD.operation_id
     OR NEW.graph_id<>OLD.graph_id OR NEW.opportunity_id<>OLD.opportunity_id
     OR NEW.assignment_id<>OLD.assignment_id OR NEW.created_at<>OLD.created_at
     OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Canonical field execution identity or revision is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_identity_immutable';
  END IF;
  IF NOT (
    (OLD.lifecycle_state='not_started' AND NEW.lifecycle_state='in_progress' AND NEW.last_action_code='start')
    OR (OLD.lifecycle_state='in_progress' AND NEW.lifecycle_state='paused' AND NEW.last_action_code='pause')
    OR (OLD.lifecycle_state='paused' AND NEW.lifecycle_state='in_progress' AND NEW.last_action_code='resume')
  ) THEN
    RAISE EXCEPTION 'Canonical field execution lifecycle transition is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_transition_invalid';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_field_executions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_field_executions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_field_execution_guard_current();

CREATE OR REPLACE FUNCTION public.canonical_field_execution_validate_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  execution_record public.canonical_field_executions%ROWTYPE;
  event_record public.canonical_field_execution_events%ROWTYPE;
BEGIN
  SELECT * INTO execution_record
    FROM public.canonical_field_executions execution
   WHERE execution.organization_id=NEW.organization_id AND execution.id=NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical field execution current state is unavailable'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_incomplete';
  END IF;
  SELECT * INTO event_record
    FROM public.canonical_field_execution_events event
   WHERE event.organization_id=execution_record.organization_id
     AND event.id=execution_record.last_event_id
     AND event.execution_id=execution_record.id
     AND event.appointment_id=execution_record.appointment_id
     AND event.assignment_id=execution_record.assignment_id;
  IF NOT FOUND
     OR event_record.after_revision<>execution_record.revision
     OR rtrim(event_record.after_digest)<>rtrim(execution_record.canonical_digest)
     OR event_record.source_assignment_revision<>execution_record.source_assignment_revision
     OR rtrim(event_record.source_assignment_digest)<>rtrim(execution_record.source_assignment_digest)
     OR event_record.recorded_by_user_id<>execution_record.last_recorded_by_user_id
     OR event_record.performed_by_profile_id<>execution_record.last_performed_by_profile_id
     OR event_record.action_code<>execution_record.last_action_code
     OR event_record.reason<>execution_record.last_reason
     OR event_record.transaction_id<>execution_record.last_transaction_id
     OR NOT EXISTS (
       SELECT 1 FROM public.canonical_field_execution_revisions revision
        WHERE revision.organization_id=execution_record.organization_id
          AND revision.execution_id=execution_record.id
          AND revision.event_id=event_record.id
          AND revision.revision=execution_record.revision
          AND revision.appointment_id=execution_record.appointment_id
          AND revision.operation_id=execution_record.operation_id
          AND revision.graph_id=execution_record.graph_id
          AND revision.opportunity_id=execution_record.opportunity_id
          AND revision.assignment_id=execution_record.assignment_id
          AND revision.lifecycle_state=execution_record.lifecycle_state
          AND revision.source_assignment_revision=execution_record.source_assignment_revision
          AND rtrim(revision.source_assignment_digest)=rtrim(execution_record.source_assignment_digest)
          AND rtrim(revision.canonical_digest)=rtrim(execution_record.canonical_digest)
          AND revision.recorded_by_user_id=execution_record.last_recorded_by_user_id
          AND revision.performed_by_profile_id=execution_record.last_performed_by_profile_id
          AND revision.action_code=execution_record.last_action_code
          AND revision.reason=execution_record.last_reason
          AND revision.transaction_id=execution_record.last_transaction_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.canonical_field_execution_audit_events audit
        WHERE audit.organization_id=execution_record.organization_id
          AND audit.execution_id=execution_record.id
          AND audit.event_id=event_record.id
          AND audit.appointment_id=execution_record.appointment_id
          AND audit.assignment_id=execution_record.assignment_id
          AND audit.actor_user_id=execution_record.last_recorded_by_user_id
          AND audit.performed_by_profile_id=execution_record.last_performed_by_profile_id
          AND audit.action_code=execution_record.last_action_code
          AND audit.reason=execution_record.last_reason
          AND audit.after_revision=execution_record.revision
          AND rtrim(audit.after_digest)=rtrim(execution_record.canonical_digest)
          AND audit.source_assignment_revision=execution_record.source_assignment_revision
          AND rtrim(audit.source_assignment_digest)=rtrim(execution_record.source_assignment_digest)
          AND rtrim(audit.request_digest)=rtrim(event_record.request_digest)
          AND audit.request_correlation_id=event_record.request_correlation_id
          AND audit.transaction_id=execution_record.last_transaction_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.canonical_field_execution_idempotency replay
        WHERE replay.organization_id=execution_record.organization_id
          AND replay.actor_user_id=execution_record.last_recorded_by_user_id
          AND rtrim(replay.idempotency_key_hash)=rtrim(event_record.idempotency_key_hash)
          AND rtrim(replay.request_digest)=rtrim(event_record.request_digest)
          AND replay.action_code=execution_record.last_action_code
          AND replay.execution_id=execution_record.id
          AND replay.event_id=event_record.id
          AND replay.response_body #>> '{data,id}'=execution_record.id::TEXT
          AND replay.response_body #>> '{data,revision}'=execution_record.revision::TEXT
          AND replay.response_body #>> '{data,digest}'=rtrim(execution_record.canonical_digest)
          AND replay.transaction_id=execution_record.last_transaction_id
     ) THEN
    RAISE EXCEPTION 'Canonical field execution mutation did not commit complete evidence'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_incomplete';
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER canonical_field_executions_complete
  AFTER INSERT OR UPDATE ON public.canonical_field_executions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_field_execution_validate_complete();

CREATE OR REPLACE FUNCTION public.canonical_field_execution_initialize(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID,
  csrf_token_value TEXT,
  appointment_id_value UUID,
  expected_assignment_revision_value BIGINT,
  expected_assignment_digest_value TEXT,
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
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  execution_record public.canonical_field_executions%ROWTYPE;
  replay_record public.canonical_field_execution_idempotency%ROWTYPE;
  execution_id_value UUID;
  event_id_value UUID;
  idempotency_key_hash_value TEXT;
  request_digest_value TEXT;
  execution_digest_value TEXT;
  response_body_value JSONB;
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' THEN
    RAISE EXCEPTION 'Canonical field execution writes require serializable isolation'
      USING ERRCODE='25001',CONSTRAINT='canonical_field_execution_serializable_required';
  END IF;
  IF actor_access_role_value NOT IN ('owner','admin','member','viewer')
     OR expected_assignment_revision_value<1
     OR expected_assignment_digest_value !~ '^[0-9a-f]{64}$'
     OR idempotency_key_value IS NULL
     OR idempotency_key_value<>btrim(idempotency_key_value)
     OR idempotency_key_value !~ '^[!-~]{16,128}$'
     OR NOT public.canonical_field_execution_reason_valid(reason_value)
     OR request_correlation_id_value IS NULL
     OR request_correlation_id_value !~ '^[ -~]{1,128}$' THEN
    RAISE EXCEPTION 'Canonical field execution initialization input is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_field_execution_input_invalid';
  END IF;
  authority := public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,csrf_token_value,TRUE
  );
  actor_profile_id := (authority->>'profileId')::UUID;
  idempotency_key_hash_value := encode(sha256(convert_to(idempotency_key_value,'UTF8')),'hex');
  request_digest_value := public.canonical_field_execution_request_digest(
    organization_id_value,actor_user_id_value,auth_session_id_value,'initialize',
    'appointment',appointment_id_value,0,NULL,expected_assignment_revision_value,
    expected_assignment_digest_value,idempotency_key_hash_value,reason_value
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
       OR replay_record.action_code<>'initialize'
       OR replay_record.identity_kind<>'appointment'
       OR replay_record.identity_id<>appointment_id_value THEN
      RAISE EXCEPTION 'The Idempotency-Key was already used for another field execution mutation'
        USING ERRCODE='23505',CONSTRAINT='canonical_field_execution_idempotency_conflict';
    END IF;
    RETURN jsonb_build_object(
      'status',replay_record.response_status,
      'body',replay_record.response_body,
      'replayed',TRUE
    );
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
     AND assignment.appointment_id=appointment_id_value
     AND transcript.source NOT IN ('simulation','demo')
   FOR UPDATE OF assignment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field execution appointment not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
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
  IF EXISTS (
    SELECT 1 FROM public.canonical_field_executions execution
     WHERE execution.organization_id=organization_id_value
       AND execution.appointment_id=appointment_id_value
  ) THEN
    RAISE EXCEPTION 'A canonical field execution already exists for this appointment'
      USING ERRCODE='23505',CONSTRAINT='canonical_field_execution_already_exists';
  END IF;

  execution_id_value := gen_random_uuid();
  event_id_value := gen_random_uuid();
  execution_digest_value := public.canonical_field_execution_digest(
    execution_id_value,assignment_record.appointment_id,assignment_record.operation_id,
    assignment_record.graph_id,assignment_record.opportunity_id,assignment_record.id,
    'not_started',assignment_record.revision,rtrim(assignment_record.canonical_digest),
    actor_user_id_value,actor_profile_id
  );
  INSERT INTO public.canonical_field_executions(
    id,organization_id,appointment_id,operation_id,graph_id,opportunity_id,assignment_id,
    lifecycle_state,source_assignment_revision,source_assignment_digest,revision,
    canonical_digest,last_event_id,last_recorded_by_user_id,last_performed_by_profile_id,
    last_action_code,last_reason
  ) VALUES (
    execution_id_value,organization_id_value,assignment_record.appointment_id,
    assignment_record.operation_id,assignment_record.graph_id,assignment_record.opportunity_id,
    assignment_record.id,'not_started',assignment_record.revision,
    rtrim(assignment_record.canonical_digest),1,execution_digest_value,event_id_value,
    actor_user_id_value,actor_profile_id,'initialize',reason_value
  ) RETURNING * INTO execution_record;
  INSERT INTO public.canonical_field_execution_events(
    id,organization_id,execution_id,appointment_id,assignment_id,recorded_by_user_id,
    performed_by_profile_id,auth_session_id,action_code,reason,before_revision,
    after_revision,before_digest,after_digest,source_assignment_revision,
    source_assignment_digest,idempotency_key_hash,request_digest,request_correlation_id
  ) VALUES (
    event_id_value,organization_id_value,execution_id_value,assignment_record.appointment_id,
    assignment_record.id,actor_user_id_value,actor_profile_id,auth_session_id_value,
    'initialize',reason_value,0,1,NULL,execution_digest_value,assignment_record.revision,
    rtrim(assignment_record.canonical_digest),idempotency_key_hash_value,
    request_digest_value,request_correlation_id_value
  );
  INSERT INTO public.canonical_field_execution_revisions(
    organization_id,execution_id,event_id,revision,appointment_id,operation_id,graph_id,
    opportunity_id,assignment_id,lifecycle_state,source_assignment_revision,
    source_assignment_digest,canonical_digest,recorded_by_user_id,performed_by_profile_id,
    action_code,reason
  ) VALUES (
    organization_id_value,execution_id_value,event_id_value,1,assignment_record.appointment_id,
    assignment_record.operation_id,assignment_record.graph_id,assignment_record.opportunity_id,
    assignment_record.id,'not_started',assignment_record.revision,
    rtrim(assignment_record.canonical_digest),execution_digest_value,actor_user_id_value,
    actor_profile_id,'initialize',reason_value
  );
  INSERT INTO public.canonical_field_execution_audit_events(
    organization_id,execution_id,event_id,appointment_id,assignment_id,actor_user_id,
    performed_by_profile_id,action_code,reason,before_revision,after_revision,before_digest,
    after_digest,source_assignment_revision,source_assignment_digest,request_digest,
    request_correlation_id
  ) VALUES (
    organization_id_value,execution_id_value,event_id_value,assignment_record.appointment_id,
    assignment_record.id,actor_user_id_value,actor_profile_id,'initialize',reason_value,
    0,1,NULL,execution_digest_value,assignment_record.revision,
    rtrim(assignment_record.canonical_digest),request_digest_value,request_correlation_id_value
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
    'initialize','appointment',appointment_id_value,execution_id_value,event_id_value,201,
    response_body_value
  );
  RETURN jsonb_build_object('status',201,'body',response_body_value,'replayed',FALSE);
END
$function$;

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
  after_state_value := CASE
    WHEN execution_record.lifecycle_state='not_started' AND action_code_value='start' THEN 'in_progress'
    WHEN execution_record.lifecycle_state='in_progress' AND action_code_value='pause' THEN 'paused'
    WHEN execution_record.lifecycle_state='paused' AND action_code_value='resume' THEN 'in_progress'
    ELSE NULL
  END;
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

CREATE OR REPLACE FUNCTION public.canonical_field_execution_read(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID,
  execution_id_value UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  authority JSONB;
  actor_profile_id UUID;
  execution_record public.canonical_field_executions%ROWTYPE;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
    RAISE EXCEPTION 'Canonical field execution reads require a bounded snapshot'
      USING ERRCODE='25001',CONSTRAINT='canonical_field_execution_snapshot_required';
  END IF;
  authority := public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,NULL,FALSE
  );
  actor_profile_id := (authority->>'profileId')::UUID;
  SELECT execution.* INTO execution_record
    FROM public.canonical_field_executions execution
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=execution.organization_id
     AND transcript.operation_id=execution.operation_id
   WHERE execution.organization_id=organization_id_value
     AND execution.id=execution_id_value
     AND transcript.source NOT IN ('simulation','demo');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;
  SELECT * INTO assignment_record
    FROM public.canonical_schedule_assignments assignment
   WHERE assignment.organization_id=organization_id_value
     AND assignment.id=execution_record.assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;
  IF actor_access_role_value='member'
     AND NOT public.canonical_field_execution_actor_in_scope(
       organization_id_value,actor_access_role_value,actor_profile_id,assignment_record
     ) THEN
    RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found';
  END IF;
  RETURN jsonb_build_object(
    'success',TRUE,'data',public.canonical_field_execution_projection(execution_record)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.canonical_field_execution_reason_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_digest(
  UUID,UUID,UUID,UUID,UUID,UUID,TEXT,BIGINT,TEXT,UUID,UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_request_digest(
  UUID,UUID,UUID,TEXT,TEXT,UUID,BIGINT,TEXT,BIGINT,TEXT,TEXT,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_actor_authority(
  UUID,UUID,TEXT,UUID,TEXT,BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_actor_in_scope(
  UUID,TEXT,UUID,public.canonical_schedule_assignments
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_projection(
  public.canonical_field_executions
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_immutable_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_guard_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_validate_complete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_initialize(
  UUID,UUID,TEXT,UUID,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_transition(
  UUID,UUID,TEXT,UUID,TEXT,UUID,BIGINT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_field_execution_read(
  UUID,UUID,TEXT,UUID,UUID
) FROM PUBLIC;
