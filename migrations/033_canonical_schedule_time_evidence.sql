-- Mission 22 Part 1 correction: database-verifiable tenant time evidence.
-- Migration 032 remains immutable. This additive boundary preserves legacy
-- approvals while requiring every new approval to carry independently
-- verifiable raw schedule and current Business Profile time-zone evidence.

ALTER TABLE public.canonical_schedule_approvals
  ADD COLUMN time_evidence_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN submitted_schedule JSONB,
  ADD COLUMN time_zone_authority JSONB,
  ADD COLUMN time_evidence_digest CHAR(64);

ALTER TABLE public.canonical_schedule_approvals
  ALTER COLUMN time_evidence_version SET DEFAULT 2;

ALTER TABLE public.canonical_schedule_approvals
  ADD CONSTRAINT canonical_schedule_approvals_time_evidence_check CHECK (
    (time_evidence_version = 1
      AND submitted_schedule IS NULL
      AND time_zone_authority IS NULL
      AND time_evidence_digest IS NULL)
    OR
    (time_evidence_version = 2
      AND jsonb_typeof(submitted_schedule) = 'object'
      AND submitted_schedule ?& ARRAY[
        'startProvided', 'endProvided', 'scheduledStart', 'scheduledEnd'
      ]::TEXT[]
      AND submitted_schedule <@ jsonb_build_object(
        'startProvided', submitted_schedule -> 'startProvided',
        'endProvided', submitted_schedule -> 'endProvided',
        'scheduledStart', submitted_schedule -> 'scheduledStart',
        'scheduledEnd', submitted_schedule -> 'scheduledEnd'
      )
      AND jsonb_typeof(submitted_schedule -> 'startProvided') = 'boolean'
      AND jsonb_typeof(submitted_schedule -> 'endProvided') = 'boolean'
      AND jsonb_typeof(submitted_schedule -> 'scheduledStart') IN ('string', 'null')
      AND jsonb_typeof(submitted_schedule -> 'scheduledEnd') IN ('string', 'null')
      AND ((submitted_schedule ->> 'startProvided')::boolean
        OR jsonb_typeof(submitted_schedule -> 'scheduledStart') = 'null')
      AND ((submitted_schedule ->> 'endProvided')::boolean
        OR jsonb_typeof(submitted_schedule -> 'scheduledEnd') = 'null')
      AND jsonb_typeof(time_zone_authority) = 'object'
      AND time_zone_authority ?& ARRAY[
        'profileId', 'profileVersion', 'profileHash', 'timeZone'
      ]::TEXT[]
      AND time_zone_authority <@ jsonb_build_object(
        'profileId', time_zone_authority -> 'profileId',
        'profileVersion', time_zone_authority -> 'profileVersion',
        'profileHash', time_zone_authority -> 'profileHash',
        'timeZone', time_zone_authority -> 'timeZone'
      )
      AND jsonb_typeof(time_zone_authority -> 'profileId') = 'string'
      AND (time_zone_authority ->> 'profileId')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND jsonb_typeof(time_zone_authority -> 'profileVersion') = 'number'
      AND (time_zone_authority ->> 'profileVersion') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(time_zone_authority -> 'profileHash') = 'string'
      AND (time_zone_authority ->> 'profileHash') ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof(time_zone_authority -> 'timeZone') = 'string'
      AND length(time_zone_authority ->> 'timeZone') BETWEEN 1 AND 255
      AND btrim(time_zone_authority ->> 'timeZone') = time_zone_authority ->> 'timeZone'
      AND time_evidence_digest IS NOT NULL
      AND rtrim(time_evidence_digest) ~ '^[0-9a-f]{64}$')
  );

CREATE OR REPLACE FUNCTION public.canonical_schedule_time_evidence_digest(
  time_evidence_version_value SMALLINT,
  submitted_schedule_value JSONB,
  time_zone_authority_value JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'submittedSchedule', submitted_schedule_value,
    'timeEvidenceVersion', time_evidence_version_value,
    'timeZoneAuthority', time_zone_authority_value
  )::text, 'UTF8')), 'hex')
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_validate_rfc3339_in_zone(
  raw_value TEXT,
  expected_instant_value TIMESTAMPTZ,
  time_zone_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  pieces TEXT[];
  wall_value TIMESTAMP WITHOUT TIME ZONE;
  parsed_instant TIMESTAMPTZ;
  local_value TIMESTAMP WITHOUT TIME ZONE;
  utc_value TIMESTAMP WITHOUT TIME ZONE;
  fraction_milliseconds INTEGER;
  offset_hour INTEGER;
  offset_minute INTEGER;
  offset_minutes INTEGER;
  actual_offset_seconds NUMERIC;
BEGIN
  IF raw_value IS NULL OR expected_instant_value IS NULL OR time_zone_value IS NULL THEN
    RAISE EXCEPTION 'Canonical schedule timestamp evidence is incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_evidence_invalid';
  END IF;
  IF raw_value <> btrim(raw_value)
     OR length(raw_value) < 20 OR length(raw_value) > 40 THEN
    RAISE EXCEPTION 'Canonical schedule timestamp is not strict RFC3339'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_rfc3339_invalid';
  END IF;
  pieces := regexp_match(
    raw_value,
    '^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,3})?(Z|([+-])([0-9]{2}):([0-9]{2}))$'
  );
  IF pieces IS NULL OR pieces[1]::INTEGER < 100 THEN
    RAISE EXCEPTION 'Canonical schedule timestamp is not strict RFC3339'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_rfc3339_invalid';
  END IF;
  IF pieces[4]::INTEGER NOT BETWEEN 0 AND 23
     OR pieces[6]::INTEGER NOT BETWEEN 0 AND 59 THEN
    RAISE EXCEPTION 'Canonical schedule timestamp has invalid calendar fields'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_rfc3339_invalid';
  END IF;

  fraction_milliseconds := CASE WHEN pieces[7] IS NULL THEN 0
    ELSE rpad(substring(pieces[7] FROM 2), 3, '0')::INTEGER END;
  BEGIN
    wall_value := make_timestamp(
      pieces[1]::INTEGER,
      pieces[2]::INTEGER,
      pieces[3]::INTEGER,
      pieces[4]::INTEGER,
      pieces[5]::INTEGER,
      pieces[6]::DOUBLE PRECISION + fraction_milliseconds::DOUBLE PRECISION / 1000.0
    );
  EXCEPTION
    WHEN datetime_field_overflow OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Canonical schedule timestamp has invalid calendar fields'
        USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_rfc3339_invalid';
  END;

  IF pieces[8] = 'Z' THEN
    offset_hour := 0;
    offset_minute := 0;
    offset_minutes := 0;
  ELSE
    offset_hour := pieces[10]::INTEGER;
    offset_minute := pieces[11]::INTEGER;
    IF offset_hour > 14 OR offset_minute > 59
       OR (offset_hour = 14 AND offset_minute <> 0) THEN
      RAISE EXCEPTION 'Canonical schedule timestamp offset is outside RFC3339 bounds'
        USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_rfc3339_invalid';
    END IF;
    offset_minutes := (offset_hour * 60 + offset_minute)
      * CASE WHEN pieces[9] = '-' THEN -1 ELSE 1 END;
  END IF;

  IF length(time_zone_value) NOT BETWEEN 1 AND 255
     OR time_zone_value <> btrim(time_zone_value)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_timezone_names zone
        WHERE lower(zone.name) = lower(time_zone_value)
     ) THEN
    RAISE EXCEPTION 'Canonical schedule time zone is unavailable'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_zone_invalid';
  END IF;

  parsed_instant := (wall_value - make_interval(mins => offset_minutes)) AT TIME ZONE 'UTC';
  IF parsed_instant IS DISTINCT FROM expected_instant_value THEN
    RAISE EXCEPTION 'Canonical schedule raw timestamp diverges from the approved instant'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_instant_mismatch';
  END IF;

  local_value := expected_instant_value AT TIME ZONE time_zone_value;
  utc_value := expected_instant_value AT TIME ZONE 'UTC';
  actual_offset_seconds := extract(EPOCH FROM (local_value - utc_value));
  IF local_value IS DISTINCT FROM wall_value
     OR actual_offset_seconds <> offset_minutes * 60 THEN
    RAISE EXCEPTION 'Canonical schedule timestamp does not round-trip in the current tenant time zone'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_zone_mismatch';
  END IF;
  RETURN TRUE;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_validate_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  membership_record RECORD;
  time_authority_record RECORD;
  submitted_keys TEXT[];
  authority_keys TEXT[];
  start_provided BOOLEAN;
  end_provided BOOLEAN;
  expected_applied_digest TEXT;
  expected_time_evidence_digest TEXT;
BEGIN
  IF NEW.time_evidence_version <> 2 THEN
    RAISE EXCEPTION 'Every new canonical schedule approval requires version 2 time evidence'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_evidence_version_required';
  END IF;
  IF jsonb_typeof(NEW.submitted_schedule) <> 'object'
     OR jsonb_typeof(NEW.time_zone_authority) <> 'object'
     OR NEW.time_evidence_digest IS NULL THEN
    RAISE EXCEPTION 'Canonical schedule time evidence is incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_evidence_invalid';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO submitted_keys
    FROM jsonb_object_keys(NEW.submitted_schedule) key;
  SELECT array_agg(key ORDER BY key) INTO authority_keys
    FROM jsonb_object_keys(NEW.time_zone_authority) key;
  IF submitted_keys IS DISTINCT FROM ARRAY[
       'endProvided', 'scheduledEnd', 'scheduledStart', 'startProvided'
     ]::TEXT[]
     OR authority_keys IS DISTINCT FROM ARRAY[
       'profileHash', 'profileId', 'profileVersion', 'timeZone'
     ]::TEXT[]
     OR jsonb_typeof(NEW.submitted_schedule -> 'startProvided') <> 'boolean'
     OR jsonb_typeof(NEW.submitted_schedule -> 'endProvided') <> 'boolean'
     OR jsonb_typeof(NEW.submitted_schedule -> 'scheduledStart') NOT IN ('string', 'null')
     OR jsonb_typeof(NEW.submitted_schedule -> 'scheduledEnd') NOT IN ('string', 'null')
     OR jsonb_typeof(NEW.time_zone_authority -> 'profileId') <> 'string'
     OR (NEW.time_zone_authority ->> 'profileId')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(NEW.time_zone_authority -> 'profileVersion') <> 'number'
     OR (NEW.time_zone_authority ->> 'profileVersion') !~ '^[1-9][0-9]*$'
     OR jsonb_typeof(NEW.time_zone_authority -> 'profileHash') <> 'string'
     OR (NEW.time_zone_authority ->> 'profileHash') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(NEW.time_zone_authority -> 'timeZone') <> 'string'
     OR length(NEW.time_zone_authority ->> 'timeZone') NOT BETWEEN 1 AND 255
     OR btrim(NEW.time_zone_authority ->> 'timeZone')
       <> NEW.time_zone_authority ->> 'timeZone' THEN
    RAISE EXCEPTION 'Canonical schedule time evidence has an invalid shape'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_evidence_invalid';
  END IF;

  start_provided := (NEW.submitted_schedule ->> 'startProvided')::BOOLEAN;
  end_provided := (NEW.submitted_schedule ->> 'endProvided')::BOOLEAN;
  IF (NOT start_provided
        AND jsonb_typeof(NEW.submitted_schedule -> 'scheduledStart') <> 'null')
     OR (NOT end_provided
        AND jsonb_typeof(NEW.submitted_schedule -> 'scheduledEnd') <> 'null') THEN
    RAISE EXCEPTION 'Omitted canonical schedule fields cannot carry raw values'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_evidence_invalid';
  END IF;

  expected_time_evidence_digest := public.canonical_schedule_time_evidence_digest(
    NEW.time_evidence_version,
    NEW.submitted_schedule,
    NEW.time_zone_authority
  );
  IF rtrim(NEW.time_evidence_digest) <> expected_time_evidence_digest THEN
    RAISE EXCEPTION 'Canonical schedule time evidence digest is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_evidence_digest_invalid';
  END IF;

  PERFORM 1 FROM public.organizations organization
   WHERE organization.id = NEW.organization_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical schedule organization is unavailable'
      USING ERRCODE = '23503', CONSTRAINT = 'canonical_schedule_organization_unavailable';
  END IF;

  SELECT onboarding.status AS onboarding_status,
         onboarding.active_business_profile_id,
         profile.id, profile.version_number, profile.normalized_profile_hash,
         profile.raw_profile #>> '{company,timeZone}' AS time_zone
    INTO time_authority_record
    FROM public.organization_onboarding onboarding
    JOIN public.canonical_business_profiles profile
      ON profile.organization_id = onboarding.organization_id
     AND profile.id = onboarding.active_business_profile_id
   WHERE onboarding.organization_id = NEW.organization_id
     AND onboarding.status = 'complete'
     AND profile.is_active = TRUE
   FOR SHARE OF onboarding, profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical schedule current Business Profile authority is unavailable'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_schedule_time_zone_authority_unavailable';
  END IF;
  IF time_authority_record.id::TEXT <> NEW.time_zone_authority ->> 'profileId'
     OR time_authority_record.version_number::TEXT
       <> NEW.time_zone_authority ->> 'profileVersion'
     OR rtrim(time_authority_record.normalized_profile_hash)
       <> NEW.time_zone_authority ->> 'profileHash'
     OR time_authority_record.time_zone IS DISTINCT FROM
       NEW.time_zone_authority ->> 'timeZone' THEN
    RAISE EXCEPTION 'Canonical schedule current Business Profile authority changed'
      USING ERRCODE = '40001', CONSTRAINT = 'canonical_schedule_time_zone_authority_stale';
  END IF;
  IF time_authority_record.time_zone IS NULL
     OR length(time_authority_record.time_zone) NOT BETWEEN 1 AND 255
     OR time_authority_record.time_zone <> btrim(time_authority_record.time_zone)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_timezone_names zone
        WHERE lower(zone.name) = lower(time_authority_record.time_zone)
     ) THEN
    RAISE EXCEPTION 'Canonical schedule current Business Profile time zone is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_zone_invalid';
  END IF;

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

  IF start_provided THEN
    IF jsonb_typeof(NEW.submitted_schedule -> 'scheduledStart') = 'null' THEN
      IF NEW.approved_scheduled_start IS NOT NULL THEN
        RAISE EXCEPTION 'Canonical schedule explicit start removal diverges from approval'
          USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_instant_mismatch';
      END IF;
    ELSE
      PERFORM public.canonical_schedule_validate_rfc3339_in_zone(
        NEW.submitted_schedule ->> 'scheduledStart',
        NEW.approved_scheduled_start,
        time_authority_record.time_zone
      );
    END IF;
  ELSIF NEW.approved_scheduled_start IS DISTINCT FROM assignment_record.scheduled_start THEN
    RAISE EXCEPTION 'Omitted canonical schedule start changed the approved instant'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_omission_mismatch';
  END IF;
  IF end_provided THEN
    IF jsonb_typeof(NEW.submitted_schedule -> 'scheduledEnd') = 'null' THEN
      IF NEW.approved_scheduled_end IS NOT NULL THEN
        RAISE EXCEPTION 'Canonical schedule explicit end removal diverges from approval'
          USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_instant_mismatch';
      END IF;
    ELSE
      PERFORM public.canonical_schedule_validate_rfc3339_in_zone(
        NEW.submitted_schedule ->> 'scheduledEnd',
        NEW.approved_scheduled_end,
        time_authority_record.time_zone
      );
    END IF;
  ELSIF NEW.approved_scheduled_end IS DISTINCT FROM assignment_record.scheduled_end THEN
    RAISE EXCEPTION 'Omitted canonical schedule end changed the approved instant'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_time_omission_mismatch';
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

CREATE OR REPLACE FUNCTION public.canonical_schedule_validate_approval_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_onboarding onboarding
      JOIN public.canonical_business_profiles profile
        ON profile.organization_id=onboarding.organization_id
       AND profile.id=onboarding.active_business_profile_id
     WHERE onboarding.organization_id=NEW.organization_id
       AND onboarding.status='complete'
       AND profile.is_active=TRUE
       AND profile.id::TEXT=NEW.time_zone_authority ->> 'profileId'
       AND profile.version_number::TEXT=NEW.time_zone_authority ->> 'profileVersion'
       AND rtrim(profile.normalized_profile_hash)=NEW.time_zone_authority ->> 'profileHash'
       AND profile.raw_profile #>> '{company,timeZone}'=NEW.time_zone_authority ->> 'timeZone'
  ) OR NOT EXISTS (
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
       AND revision.source_snapshot #>> '{timeEvidenceVersion}' = NEW.time_evidence_version::TEXT
       AND revision.source_snapshot #> '{submittedSchedule}' = NEW.submitted_schedule
       AND revision.source_snapshot #> '{timeZoneAuthority}' = NEW.time_zone_authority
       AND revision.source_snapshot #>> '{timeEvidenceDigest}' = rtrim(NEW.time_evidence_digest)
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
       AND audit.details #>> '{timeEvidenceVersion}' = NEW.time_evidence_version::TEXT
       AND audit.details #> '{submittedSchedule}' = NEW.submitted_schedule
       AND audit.details #> '{timeZoneAuthority}' = NEW.time_zone_authority
       AND audit.details #>> '{timeEvidenceDigest}' = rtrim(NEW.time_evidence_digest)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.canonical_schedule_idempotency replay
     WHERE replay.organization_id = NEW.organization_id
       AND replay.actor_user_id = NEW.actor_user_id
       AND rtrim(replay.idempotency_key_hash) = rtrim(NEW.idempotency_key_hash)
       AND rtrim(replay.request_digest) = rtrim(NEW.request_digest)
       AND replay.assignment_id = NEW.assignment_id
       AND replay.approval_id = NEW.id
       AND replay.response_status = 200
       AND replay.response_body #>> '{data,id}' = NEW.appointment_id::TEXT
       AND replay.response_body #>> '{data,scheduleAuthority,digest}' = rtrim(NEW.applied_digest)
       AND replay.response_body #>> '{data,scheduleAuthority,revision}' = NEW.applied_revision::TEXT
  ) THEN
    RAISE EXCEPTION 'Canonical schedule approval did not commit complete mutation evidence'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_approval_incomplete';
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.canonical_schedule_time_evidence_digest(SMALLINT, JSONB, JSONB)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_validate_rfc3339_in_zone(TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_validate_approval()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_validate_approval_completion()
  FROM PUBLIC;
