-- Mission 22 Part 2: declared availability and deterministic conflict evidence.
-- Additive only. This migration does not assign, schedule, dispatch, route,
-- recommend, execute field work, or authorize an automated mutation.
-- Read-only conflict evaluations are deterministic non-capability responses,
-- not durable database records. Part 4 owns durable preview/approval evidence.

CREATE OR REPLACE FUNCTION public.canonical_workforce_availability_digest(
  workforce_profile_id_value UUID,
  coverage_start_value TIMESTAMPTZ,
  coverage_end_value TIMESTAMPTZ,
  intervals_value JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'coverageEnd', to_char(coverage_end_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'coverageStart', to_char(coverage_start_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'intervals', intervals_value,
    'profileId', workforce_profile_id_value
  )::text, 'UTF8')), 'hex')
$function$;

CREATE TABLE public.canonical_workforce_availability_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workforce_profile_id UUID NOT NULL,
  coverage_start TIMESTAMPTZ NOT NULL,
  coverage_end TIMESTAMPTZ NOT NULL,
  revision BIGINT NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  last_actor_user_id UUID NOT NULL,
  last_auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
  last_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_workforce_availability_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT canonical_workforce_availability_profile_unique UNIQUE (organization_id, workforce_profile_id),
  CONSTRAINT canonical_workforce_availability_profile_fk
    FOREIGN KEY (organization_id, workforce_profile_id)
    REFERENCES public.workforce_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_actor_fk
    FOREIGN KEY (organization_id, last_actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_coverage_check CHECK (
    coverage_end > coverage_start AND coverage_end <= coverage_start + INTERVAL '366 days'
  ),
  CONSTRAINT canonical_workforce_availability_revision_check CHECK (revision >= 1),
  CONSTRAINT canonical_workforce_availability_digest_check CHECK (canonical_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_workforce_availability_reason_check CHECK (
    length(btrim(last_reason)) BETWEEN 1 AND 1000 AND octet_length(last_reason) <= 4000
  )
);

CREATE TABLE public.canonical_workforce_availability_intervals (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  availability_id UUID NOT NULL,
  ordinal INTEGER NOT NULL,
  interval_kind VARCHAR(16) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT canonical_workforce_availability_intervals_primary
    PRIMARY KEY (organization_id, availability_id, ordinal),
  CONSTRAINT canonical_workforce_availability_intervals_authority_fk
    FOREIGN KEY (organization_id, availability_id)
    REFERENCES public.canonical_workforce_availability_authorities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_intervals_ordinal_check CHECK (ordinal BETWEEN 0 AND 511),
  CONSTRAINT canonical_workforce_availability_intervals_kind_check CHECK (
    interval_kind IN ('available', 'unavailable')
  ),
  CONSTRAINT canonical_workforce_availability_intervals_range_check CHECK (
    ends_at > starts_at AND ends_at <= starts_at + INTERVAL '31 days'
  )
);

CREATE INDEX canonical_workforce_availability_intervals_range
  ON public.canonical_workforce_availability_intervals(
    organization_id, availability_id, starts_at, ends_at, ordinal
  );

CREATE TABLE public.canonical_workforce_availability_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  availability_id UUID NOT NULL,
  workforce_profile_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  coverage_start TIMESTAMPTZ NOT NULL,
  coverage_end TIMESTAMPTZ NOT NULL,
  intervals JSONB NOT NULL,
  submitted_coverage JSONB NOT NULL,
  submitted_intervals JSONB NOT NULL,
  time_zone_authority JSONB NOT NULL,
  actor_user_id UUID NOT NULL,
  actor_access_role VARCHAR(16) NOT NULL,
  auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
  request_digest CHAR(64) NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_workforce_availability_revisions_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT canonical_workforce_availability_revisions_unique UNIQUE (organization_id, availability_id, revision),
  CONSTRAINT canonical_workforce_availability_revisions_authority_fk
    FOREIGN KEY (organization_id, availability_id)
    REFERENCES public.canonical_workforce_availability_authorities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_revisions_profile_fk
    FOREIGN KEY (organization_id, workforce_profile_id)
    REFERENCES public.workforce_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_revisions_actor_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_revisions_role_check CHECK (
    actor_access_role IN ('owner', 'admin', 'member')
  ),
  CONSTRAINT canonical_workforce_availability_revisions_revision_check CHECK (revision >= 1),
  CONSTRAINT canonical_workforce_availability_revisions_digest_check CHECK (
    canonical_digest ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'
    AND idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_workforce_availability_revisions_coverage_check CHECK (
    coverage_end > coverage_start AND coverage_end <= coverage_start + INTERVAL '366 days'
  ),
  CONSTRAINT canonical_workforce_availability_revisions_json_check CHECK (
    jsonb_typeof(intervals) = 'array' AND jsonb_array_length(intervals) <= 512
    AND jsonb_typeof(submitted_coverage) = 'object'
    AND jsonb_typeof(submitted_intervals) = 'array'
    AND jsonb_array_length(submitted_intervals) = jsonb_array_length(intervals)
    AND jsonb_typeof(time_zone_authority) = 'object'
  ),
  CONSTRAINT canonical_workforce_availability_revisions_reason_check CHECK (
    length(btrim(reason)) BETWEEN 1 AND 1000 AND octet_length(reason) <= 4000
  )
);

CREATE TABLE public.canonical_workforce_availability_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  availability_id UUID NOT NULL,
  availability_revision_id UUID NOT NULL,
  workforce_profile_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64),
  after_digest CHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  details JSONB NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_workforce_availability_audit_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT canonical_workforce_availability_audit_revision_unique
    UNIQUE (organization_id, availability_revision_id),
  CONSTRAINT canonical_workforce_availability_audit_authority_fk
    FOREIGN KEY (organization_id, availability_id)
    REFERENCES public.canonical_workforce_availability_authorities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_audit_revision_fk
    FOREIGN KEY (organization_id, availability_revision_id)
    REFERENCES public.canonical_workforce_availability_revisions(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_audit_profile_fk
    FOREIGN KEY (organization_id, workforce_profile_id)
    REFERENCES public.workforce_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_audit_actor_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_audit_revision_check CHECK (
    before_revision >= 0 AND after_revision = before_revision + 1
  ),
  CONSTRAINT canonical_workforce_availability_audit_digest_check CHECK (
    (before_revision = 0 AND before_digest IS NULL OR before_revision > 0 AND before_digest ~ '^[0-9a-f]{64}$')
    AND after_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_workforce_availability_audit_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE TABLE public.canonical_workforce_availability_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  availability_id UUID NOT NULL,
  availability_revision_id UUID NOT NULL,
  response_status SMALLINT NOT NULL,
  response_body JSONB NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_workforce_availability_idempotency_primary
    PRIMARY KEY (organization_id, actor_user_id, idempotency_key_hash),
  CONSTRAINT canonical_workforce_availability_idempotency_revision_unique
    UNIQUE (organization_id, availability_revision_id),
  CONSTRAINT canonical_workforce_availability_idempotency_actor_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_idempotency_authority_fk
    FOREIGN KEY (organization_id, availability_id)
    REFERENCES public.canonical_workforce_availability_authorities(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_idempotency_revision_fk
    FOREIGN KEY (organization_id, availability_revision_id)
    REFERENCES public.canonical_workforce_availability_revisions(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_workforce_availability_idempotency_digest_check CHECK (
    idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_workforce_availability_idempotency_response_check CHECK (
    response_status BETWEEN 200 AND 299 AND jsonb_typeof(response_body) = 'object'
  )
);

CREATE OR REPLACE FUNCTION public.canonical_workforce_availability_validate_idempotency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  authority_record public.canonical_workforce_availability_authorities%ROWTYPE;
  revision_record public.canonical_workforce_availability_revisions%ROWTYPE;
  expected_response JSONB;
BEGIN
  SELECT * INTO revision_record
    FROM public.canonical_workforce_availability_revisions
   WHERE organization_id = NEW.organization_id
     AND id = NEW.availability_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical workforce availability idempotency revision is unavailable'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_idempotency_divergent';
  END IF;

  SELECT * INTO authority_record
    FROM public.canonical_workforce_availability_authorities
   WHERE organization_id = NEW.organization_id
     AND id = NEW.availability_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical workforce availability idempotency authority is unavailable'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_idempotency_divergent';
  END IF;

  expected_response := jsonb_build_object(
    'data', jsonb_build_object(
      'coverageEnd', to_char(revision_record.coverage_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'coverageStart', to_char(revision_record.coverage_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'digest', rtrim(revision_record.canonical_digest),
      'id', revision_record.availability_id,
      'intervals', revision_record.intervals,
      'profileId', revision_record.workforce_profile_id,
      'revision', revision_record.revision,
      'updatedAt', to_char(authority_record.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'success', TRUE
  );

  IF revision_record.availability_id <> NEW.availability_id
     OR revision_record.actor_user_id <> NEW.actor_user_id
     OR rtrim(revision_record.idempotency_key_hash) <> rtrim(NEW.idempotency_key_hash)
     OR rtrim(revision_record.request_digest) <> rtrim(NEW.request_digest)
     OR revision_record.transaction_id <> NEW.transaction_id
     OR NEW.transaction_id <> txid_current()::bigint
     OR NEW.created_at IS DISTINCT FROM revision_record.created_at
     OR authority_record.workforce_profile_id <> revision_record.workforce_profile_id
     OR authority_record.revision <> revision_record.revision
     OR rtrim(authority_record.canonical_digest) <> rtrim(revision_record.canonical_digest)
     OR authority_record.coverage_start IS DISTINCT FROM revision_record.coverage_start
     OR authority_record.coverage_end IS DISTINCT FROM revision_record.coverage_end
     OR authority_record.last_actor_user_id <> revision_record.actor_user_id
     OR authority_record.updated_at IS DISTINCT FROM revision_record.created_at
     OR NEW.response_status <> 200
     OR NEW.response_body <> expected_response THEN
    RAISE EXCEPTION 'Canonical workforce availability idempotency evidence diverges from its revision'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_idempotency_divergent';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_workforce_availability_idempotency_validate
  BEFORE INSERT ON public.canonical_workforce_availability_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.canonical_workforce_availability_validate_idempotency();

CREATE OR REPLACE FUNCTION public.canonical_schedule_part2_immutable_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'Mission 22 Part 2 evidence is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'canonical_schedule_part2_evidence_immutable';
END
$function$;

CREATE TRIGGER canonical_workforce_availability_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_workforce_availability_revisions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_part2_immutable_evidence();
CREATE TRIGGER canonical_workforce_availability_audit_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_workforce_availability_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_part2_immutable_evidence();
CREATE TRIGGER canonical_workforce_availability_idempotency_immutable
  BEFORE UPDATE OR DELETE ON public.canonical_workforce_availability_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.canonical_schedule_part2_immutable_evidence();
CREATE OR REPLACE FUNCTION public.canonical_workforce_availability_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Canonical workforce availability cannot be deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_delete_forbidden';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.created_at <> NEW.updated_at THEN
      RAISE EXCEPTION 'Canonical workforce availability initial revision is invalid'
        USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_revision_invalid';
    END IF;
  ELSIF NEW.organization_id <> OLD.organization_id OR NEW.id <> OLD.id
     OR NEW.workforce_profile_id <> OLD.workforce_profile_id OR NEW.created_at <> OLD.created_at
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Canonical workforce availability identity or revision is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_revision_invalid';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_workforce_availability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_workforce_availability_authorities
  FOR EACH ROW EXECUTE FUNCTION public.canonical_workforce_availability_guard();

CREATE OR REPLACE FUNCTION public.canonical_workforce_availability_validate_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  authority_record public.canonical_workforce_availability_authorities%ROWTYPE;
  membership_record RECORD;
  profile_record RECORD;
  canonical_item JSONB;
  submitted_item JSONB;
  canonical_items JSONB;
  item_index INTEGER;
BEGIN
  SELECT * INTO authority_record
    FROM public.canonical_workforce_availability_authorities
   WHERE organization_id = NEW.organization_id AND id = NEW.availability_id
   FOR UPDATE;
  IF NOT FOUND OR authority_record.workforce_profile_id <> NEW.workforce_profile_id
     OR authority_record.revision <> NEW.revision
     OR rtrim(authority_record.canonical_digest) <> rtrim(NEW.canonical_digest)
     OR authority_record.coverage_start IS DISTINCT FROM NEW.coverage_start
     OR authority_record.coverage_end IS DISTINCT FROM NEW.coverage_end
     OR authority_record.last_actor_user_id <> NEW.actor_user_id
     OR authority_record.last_auth_session_id <> NEW.auth_session_id
     OR authority_record.last_reason <> NEW.reason
     OR NEW.transaction_id <> txid_current()::bigint THEN
    RAISE EXCEPTION 'Canonical workforce availability revision diverges from current authority'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_revision_divergent';
  END IF;

  SELECT membership.id, membership.role, profile.operational_role
    INTO membership_record
    FROM public.organization_memberships membership
    JOIN public.workforce_profiles profile
      ON profile.organization_id = membership.organization_id
     AND profile.membership_id = membership.id
   WHERE membership.organization_id = NEW.organization_id
     AND membership.user_id = NEW.actor_user_id
     AND membership.status = 'active'
   FOR SHARE OF membership, profile;
  IF NOT FOUND OR membership_record.role <> NEW.actor_access_role
     OR NOT (membership_record.role IN ('owner', 'admin')
       OR (membership_record.role = 'member' AND membership_record.operational_role = 'dispatcher')) THEN
    RAISE EXCEPTION 'Canonical workforce availability actor is unauthorized'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_workforce_availability_actor_unauthorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auth_sessions session
     WHERE session.id = NEW.auth_session_id
       AND session.organization_id = NEW.organization_id
       AND session.user_id = NEW.actor_user_id
       AND session.membership_id = membership_record.id
       AND session.status = 'active' AND session.access_expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Canonical workforce availability session is unavailable'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_workforce_availability_session_inactive';
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
    RAISE EXCEPTION 'Canonical workforce availability subscription is read-only'
      USING ERRCODE = '42501', CONSTRAINT = 'canonical_workforce_availability_subscription_read_only';
  END IF;

  SELECT business.id, business.version_number, business.normalized_profile_hash,
         business.raw_profile #>> '{company,timeZone}' AS time_zone
    INTO profile_record
    FROM public.organization_onboarding onboarding
    JOIN public.canonical_business_profiles business
      ON business.organization_id = onboarding.organization_id
     AND business.id = onboarding.active_business_profile_id
   WHERE onboarding.organization_id = NEW.organization_id
     AND onboarding.status = 'complete' AND business.is_active = TRUE
   FOR SHARE OF onboarding, business;
  IF NOT FOUND OR NEW.time_zone_authority <> jsonb_build_object(
       'profileHash', rtrim(profile_record.normalized_profile_hash),
       'profileId', profile_record.id,
       'profileVersion', profile_record.version_number,
       'timeZone', profile_record.time_zone
     ) THEN
    RAISE EXCEPTION 'Canonical workforce availability time-zone authority is stale'
      USING ERRCODE = '40001', CONSTRAINT = 'canonical_workforce_availability_time_zone_stale';
  END IF;

  IF jsonb_typeof(NEW.submitted_coverage -> 'start') <> 'string'
     OR jsonb_typeof(NEW.submitted_coverage -> 'end') <> 'string' THEN
    RAISE EXCEPTION 'Canonical workforce availability coverage evidence is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_time_evidence_invalid';
  END IF;
  PERFORM public.canonical_schedule_validate_rfc3339_in_zone(
    NEW.submitted_coverage ->> 'start', NEW.coverage_start, profile_record.time_zone
  );
  PERFORM public.canonical_schedule_validate_rfc3339_in_zone(
    NEW.submitted_coverage ->> 'end', NEW.coverage_end, profile_record.time_zone
  );

  FOR item_index IN 0..jsonb_array_length(NEW.intervals) - 1 LOOP
    EXIT WHEN jsonb_array_length(NEW.intervals) = 0;
    canonical_item := NEW.intervals -> item_index;
    submitted_item := NEW.submitted_intervals -> item_index;
    IF canonical_item ->> 'ordinal' <> item_index::text
       OR submitted_item ->> 'ordinal' <> item_index::text
       OR canonical_item ->> 'kind' NOT IN ('available', 'unavailable')
       OR canonical_item ->> 'kind' IS DISTINCT FROM submitted_item ->> 'kind'
       OR jsonb_typeof(canonical_item -> 'start') <> 'string'
       OR jsonb_typeof(canonical_item -> 'end') <> 'string'
       OR jsonb_typeof(submitted_item -> 'start') <> 'string'
       OR jsonb_typeof(submitted_item -> 'end') <> 'string' THEN
      RAISE EXCEPTION 'Canonical workforce availability interval evidence is invalid'
        USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_time_evidence_invalid';
    END IF;
    PERFORM public.canonical_schedule_validate_rfc3339_in_zone(
      submitted_item ->> 'start', (canonical_item ->> 'start')::timestamptz, profile_record.time_zone
    );
    PERFORM public.canonical_schedule_validate_rfc3339_in_zone(
      submitted_item ->> 'end', (canonical_item ->> 'end')::timestamptz, profile_record.time_zone
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'end', to_char(interval.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'kind', interval.interval_kind,
           'ordinal', interval.ordinal,
           'start', to_char(interval.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ) ORDER BY interval.ordinal), '[]'::jsonb)
    INTO canonical_items
    FROM public.canonical_workforce_availability_intervals interval
   WHERE interval.organization_id = NEW.organization_id
     AND interval.availability_id = NEW.availability_id;
  IF canonical_items <> NEW.intervals
     OR rtrim(NEW.canonical_digest) <> public.canonical_workforce_availability_digest(
       NEW.workforce_profile_id, NEW.coverage_start, NEW.coverage_end, NEW.intervals
     ) THEN
    RAISE EXCEPTION 'Canonical workforce availability interval snapshot or digest is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_digest_invalid';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER canonical_workforce_availability_revisions_validate
  BEFORE INSERT ON public.canonical_workforce_availability_revisions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_workforce_availability_validate_revision();

CREATE OR REPLACE FUNCTION public.canonical_workforce_availability_validate_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  target_organization UUID;
  target_availability UUID;
  authority_record public.canonical_workforce_availability_authorities%ROWTYPE;
  revision_record public.canonical_workforce_availability_revisions%ROWTYPE;
  canonical_items JSONB;
  expected_response JSONB;
BEGIN
  target_organization := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF TG_TABLE_NAME = 'canonical_workforce_availability_authorities' THEN
    target_availability := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_availability := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.availability_id ELSE NEW.availability_id
    END;
  END IF;
  SELECT * INTO authority_record
    FROM public.canonical_workforce_availability_authorities
   WHERE organization_id = target_organization AND id = target_availability;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO revision_record
    FROM public.canonical_workforce_availability_revisions
   WHERE organization_id = authority_record.organization_id
     AND availability_id = authority_record.id
     AND revision = authority_record.revision;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'end', to_char(interval.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'kind', interval.interval_kind,
           'ordinal', interval.ordinal,
           'start', to_char(interval.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ) ORDER BY interval.ordinal), '[]'::jsonb)
    INTO canonical_items
    FROM public.canonical_workforce_availability_intervals interval
   WHERE interval.organization_id = authority_record.organization_id
     AND interval.availability_id = authority_record.id;
  expected_response := jsonb_build_object(
    'data', jsonb_build_object(
      'coverageEnd', to_char(revision_record.coverage_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'coverageStart', to_char(revision_record.coverage_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'digest', rtrim(revision_record.canonical_digest),
      'id', revision_record.availability_id,
      'intervals', revision_record.intervals,
      'profileId', revision_record.workforce_profile_id,
      'revision', revision_record.revision,
      'updatedAt', to_char(authority_record.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'success', TRUE
  );
  IF revision_record.id IS NULL
     OR revision_record.workforce_profile_id <> authority_record.workforce_profile_id
     OR revision_record.coverage_start IS DISTINCT FROM authority_record.coverage_start
     OR revision_record.coverage_end IS DISTINCT FROM authority_record.coverage_end
     OR rtrim(revision_record.canonical_digest) <> rtrim(authority_record.canonical_digest)
     OR revision_record.intervals <> canonical_items
     OR rtrim(authority_record.canonical_digest) <> public.canonical_workforce_availability_digest(
       authority_record.workforce_profile_id, authority_record.coverage_start,
       authority_record.coverage_end, canonical_items
     ) OR NOT EXISTS (
       SELECT 1 FROM public.canonical_workforce_availability_audit_events audit
        WHERE audit.organization_id = authority_record.organization_id
          AND audit.availability_id = authority_record.id
          AND audit.availability_revision_id = revision_record.id
          AND audit.workforce_profile_id = authority_record.workforce_profile_id
          AND audit.actor_user_id = revision_record.actor_user_id
          AND audit.after_revision = authority_record.revision
          AND rtrim(audit.after_digest) = rtrim(authority_record.canonical_digest)
          AND audit.transaction_id = revision_record.transaction_id
     ) OR 1 <> (
       SELECT count(*) FROM public.canonical_workforce_availability_idempotency replay
        WHERE replay.organization_id = authority_record.organization_id
          AND replay.actor_user_id = revision_record.actor_user_id
          AND replay.availability_id = authority_record.id
          AND replay.availability_revision_id = revision_record.id
          AND rtrim(replay.idempotency_key_hash) = rtrim(revision_record.idempotency_key_hash)
          AND rtrim(replay.request_digest) = rtrim(revision_record.request_digest)
          AND replay.transaction_id = revision_record.transaction_id
          AND replay.response_status = 200
          AND replay.response_body = expected_response
     ) THEN
    RAISE EXCEPTION 'Canonical workforce availability mutation evidence is incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'canonical_workforce_availability_evidence_incomplete';
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER canonical_workforce_availability_authority_complete
  AFTER INSERT OR UPDATE ON public.canonical_workforce_availability_authorities
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_workforce_availability_validate_completion();
CREATE CONSTRAINT TRIGGER canonical_workforce_availability_intervals_complete
  AFTER INSERT OR UPDATE OR DELETE ON public.canonical_workforce_availability_intervals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_workforce_availability_validate_completion();

REVOKE ALL ON FUNCTION public.canonical_workforce_availability_digest(UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part2_immutable_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_workforce_availability_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_workforce_availability_validate_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_workforce_availability_validate_idempotency() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_workforce_availability_validate_completion() FROM PUBLIC;
