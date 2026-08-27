-- Mission 22 Part 4: current-authority human preview and approval.
-- The preview is durable evidence, expires after exactly fifteen minutes, and
-- is never a bearer capability. Every applied mutation rechecks current
-- tenant, actor, session, CSRF, subscription, scope, target, schedule,
-- conflict, recommendation, warning, revision, digest, and time authority.

-- Match JavaScript String.prototype.trim and boundedReason without relying on
-- database locale or regex character classes. PostgreSQL text cannot contain
-- U+0000; every other prohibited C0/DEL byte is rejected while interior tab,
-- LF, and CR remain legitimate exactly as in the public contract.
CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_reason_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  first_code INTEGER;
  last_code INTEGER;
BEGIN
  IF value IS NULL OR char_length(value) NOT BETWEEN 1 AND 1000
     OR octet_length(value)>4000 THEN
    RETURN FALSE;
  END IF;
  first_code := ascii(left(value,1));
  last_code := ascii(right(value,1));
  IF first_code IN (9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,
      8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)
     OR last_code IN (9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,
      8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)
     OR EXISTS (
       SELECT 1 FROM generate_series(0,octet_length(value)-1) byte_position
        WHERE get_byte(convert_to(value,'UTF8'),byte_position) BETWEEN 1 AND 8
           OR get_byte(convert_to(value,'UTF8'),byte_position) IN (11,12,127)
           OR get_byte(convert_to(value,'UTF8'),byte_position) BETWEEN 14 AND 31
     ) THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END
$function$;

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
      AND proposed_scheduled_end IS NOT NULL AND proposed_scheduled_end > proposed_scheduled_start
      AND proposed_scheduled_end-proposed_scheduled_start<=INTERVAL '31 days')
  ),
  CONSTRAINT canonical_schedule_previews_dispatch_check CHECK (
    proposed_dispatch_state IN ('not_dispatched','dispatched','revoked')
  ),
  CONSTRAINT canonical_schedule_previews_reason_check CHECK (
    public.canonical_schedule_part4_reason_valid(reason)
  ),
  CONSTRAINT canonical_schedule_previews_status_check CHECK (
    proposed_appointment_status IN ('preferred','scheduled','cancelled','completed')
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
      AND approved_scheduled_end IS NOT NULL AND approved_scheduled_end > approved_scheduled_start
      AND approved_scheduled_end-approved_scheduled_start<=INTERVAL '31 days')
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
    public.canonical_schedule_part4_reason_valid(reason)
  ),
  CONSTRAINT canonical_schedule_human_approvals_status_check CHECK (
    approved_appointment_status IN ('preferred','scheduled','cancelled','completed')
  )
);

ALTER TABLE public.canonical_schedule_assignments
  ADD COLUMN last_human_approval_id UUID;
ALTER TABLE public.canonical_schedule_assignments
  ADD CONSTRAINT canonical_schedule_assignments_last_human_approval_fk
  FOREIGN KEY (organization_id,last_human_approval_id)
  REFERENCES public.canonical_schedule_human_approvals(organization_id,id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.canonical_schedule_assignments
  ADD CONSTRAINT canonical_schedule_assignments_part4_contract_check CHECK (
    last_human_approval_id IS NULL OR (
      public.canonical_schedule_part4_reason_valid(last_reason)
      AND (schedule_state='unscheduled'
        OR scheduled_end-scheduled_start<=INTERVAL '31 days')
      AND appointment_status IN ('preferred','scheduled','cancelled','completed')
    )
  );

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
ALTER TABLE public.canonical_schedule_assignment_revisions
  ADD CONSTRAINT canonical_schedule_revisions_part4_contract_check CHECK (
    source_kind<>'human_preview_approved' OR (
      public.canonical_schedule_part4_reason_valid(reason)
      AND (schedule_state='unscheduled'
        OR scheduled_end-scheduled_start<=INTERVAL '31 days')
      AND appointment_status IN ('preferred','scheduled','cancelled','completed')
    )
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
  CONSTRAINT canonical_schedule_human_audit_reason_check CHECK (
    public.canonical_schedule_part4_reason_valid(reason)
  ),
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

-- Produce the same whitespace-free, recursively key-sorted JSON text used by
-- the mounted JavaScript evaluators.  This helper is never granted to the
-- ordinary runtime role; entry digests written to the immutable ledger are
-- therefore database-derived rather than caller assertions.
CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_stable_json(value JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  result TEXT;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    SELECT '{'||COALESCE(string_agg(to_jsonb(key_name)::TEXT||':'||
      public.canonical_schedule_part4_stable_json(entry_value),',' ORDER BY key_name COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(value) item(key_name,entry_value);
    RETURN result;
  ELSIF jsonb_typeof(value)='array' THEN
    SELECT '['||COALESCE(string_agg(public.canonical_schedule_part4_stable_json(entry_value),','
      ORDER BY ordinal),'')||']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY item(entry_value,ordinal);
    RETURN result;
  END IF;
  RETURN value::TEXT;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_stable_entries(values_value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'code' COLLATE "C",
    public.canonical_schedule_part4_stable_json(entry) COLLATE "C"),'[]'::JSONB)
    FROM (SELECT DISTINCT entry FROM jsonb_array_elements(values_value) item(entry)) unique_entries
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_normalize_digest_list(values_value JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  result JSONB;
  entry_count INTEGER;
  distinct_count INTEGER;
BEGIN
  IF jsonb_typeof(values_value)<>'array' OR jsonb_array_length(values_value)>256
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(values_value) item(entry)
        WHERE jsonb_typeof(entry)<>'string'
           OR (entry#>>'{}') !~ '^[0-9a-f]{64}$'
     ) THEN
    RAISE EXCEPTION 'Approval acknowledgement digests are invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_acknowledgement_invalid';
  END IF;
  SELECT count(*)::INTEGER,count(DISTINCT entry#>>'{}')::INTEGER,
         COALESCE(jsonb_agg(entry#>>'{}' ORDER BY entry#>>'{}' COLLATE "C"),'[]'::JSONB)
    INTO entry_count,distinct_count,result
    FROM jsonb_array_elements(values_value) item(entry);
  IF distinct_count<>entry_count THEN
    RAISE EXCEPTION 'Approval acknowledgement digests contain duplicates'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_acknowledgement_invalid';
  END IF;
  RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_preview_request_digest(
  organization_id_value UUID,appointment_id_value UUID,actor_user_id_value UUID,
  auth_session_id_value UUID,expected_revision_value BIGINT,expected_digest_value TEXT,
  expected_time_zone_value TEXT,action_code_value TEXT,target_kind_value TEXT,target_id_value UUID,
  scheduled_start_value TIMESTAMPTZ,scheduled_end_value TIMESTAMPTZ,
  submitted_schedule_value JSONB,appointment_status_value TEXT,reason_value TEXT
)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT encode(sha256(convert_to(public.canonical_schedule_part4_stable_json(
    jsonb_build_object(
      'action',action_code_value,'actorUserId',actor_user_id_value,
      'appointmentId',appointment_id_value,'appointmentStatus',appointment_status_value,
      'authSessionId',auth_session_id_value,'expectedDigest',expected_digest_value,
      'expectedRevision',expected_revision_value,'expectedTimeZone',expected_time_zone_value,
      'organizationId',organization_id_value,
      'proposal',jsonb_build_object(
        'appointmentStatus',appointment_status_value,
        'scheduledEnd',CASE WHEN scheduled_end_value IS NULL THEN NULL ELSE
          to_char(scheduled_end_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'scheduledStart',CASE WHEN scheduled_start_value IS NULL THEN NULL ELSE
          to_char(scheduled_start_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'submittedScheduledEnd',submitted_schedule_value->'scheduledEnd',
        'submittedScheduledStart',submitted_schedule_value->'scheduledStart',
        'target',jsonb_build_object('id',target_id_value,'kind',target_kind_value),
        'timeZone',expected_time_zone_value
      ),
      'rawScheduledEnd',submitted_schedule_value->'scheduledEnd',
      'rawScheduledStart',submitted_schedule_value->'scheduledStart',
      'reason',reason_value,
      'scheduledEnd',CASE WHEN scheduled_end_value IS NULL THEN NULL ELSE
        to_char(scheduled_end_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'scheduledStart',CASE WHEN scheduled_start_value IS NULL THEN NULL ELSE
        to_char(scheduled_start_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'target',jsonb_build_object('id',target_id_value,'kind',target_kind_value)
    )
  ),'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_approval_request_digest(
  organization_id_value UUID,appointment_id_value UUID,actor_user_id_value UUID,
  auth_session_id_value UUID,preview_id_value UUID,preview_digest_value TEXT,
  acknowledged_warning_digests_value JSONB,acknowledged_review_reason_digests_value JSONB,
  reason_value TEXT,idempotency_key_hash_value TEXT
)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT encode(sha256(convert_to(public.canonical_schedule_part4_stable_json(
    jsonb_build_object(
      'acknowledgedReviewReasonDigests',acknowledged_review_reason_digests_value,
      'acknowledgedWarningDigests',acknowledged_warning_digests_value,
      'actorUserId',actor_user_id_value,'appointmentId',appointment_id_value,
      'authSessionId',auth_session_id_value,'idempotencyKeyHash',idempotency_key_hash_value,
      'organizationId',organization_id_value,'previewDigest',preview_digest_value,
      'previewId',preview_id_value,'reason',reason_value
    )
  ),'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_schedule_contract_valid(
  scheduled_start_value TIMESTAMPTZ,scheduled_end_value TIMESTAMPTZ,
  submitted_schedule_value JSONB,time_zone_value TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
BEGIN
  IF jsonb_typeof(submitted_schedule_value)<>'object'
     OR NOT (submitted_schedule_value ?& ARRAY['scheduledStart','scheduledEnd'])
     OR (SELECT count(*) FROM jsonb_object_keys(submitted_schedule_value))<>2 THEN
    RETURN FALSE;
  END IF;
  IF scheduled_start_value IS NULL OR scheduled_end_value IS NULL THEN
    RETURN scheduled_start_value IS NULL AND scheduled_end_value IS NULL
      AND submitted_schedule_value->'scheduledStart'='null'::JSONB
      AND submitted_schedule_value->'scheduledEnd'='null'::JSONB;
  END IF;
  IF scheduled_end_value<=scheduled_start_value
     OR scheduled_end_value-scheduled_start_value>INTERVAL '31 days'
     OR jsonb_typeof(submitted_schedule_value->'scheduledStart')<>'string'
     OR jsonb_typeof(submitted_schedule_value->'scheduledEnd')<>'string' THEN
    RETURN FALSE;
  END IF;
  RETURN public.canonical_schedule_validate_rfc3339_in_zone(
      submitted_schedule_value->>'scheduledStart',scheduled_start_value,time_zone_value
    ) IS TRUE
    AND public.canonical_schedule_validate_rfc3339_in_zone(
      submitted_schedule_value->>'scheduledEnd',scheduled_end_value,time_zone_value
    ) IS TRUE;
END
$function$;

ALTER TABLE public.canonical_schedule_mutation_previews
  ADD CONSTRAINT canonical_schedule_previews_request_digest_authority_check CHECK (
    rtrim(request_digest)=public.canonical_schedule_part4_preview_request_digest(
      organization_id,appointment_id,actor_user_id,auth_session_id,expected_revision,
      rtrim(expected_digest),expected_time_zone,action_code,proposed_target_kind,
      proposed_target_id,proposed_scheduled_start,proposed_scheduled_end,submitted_schedule,
      proposed_appointment_status,reason
    )
  );

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_bounded_entries(values_value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(entry ORDER BY ordinal),'[]'::JSONB)
    FROM jsonb_array_elements(values_value) WITH ORDINALITY item(entry,ordinal)
   WHERE ordinal<=256
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_entry_digests(values_value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(digest_value ORDER BY digest_value),'[]'::JSONB)
    FROM (
      SELECT encode(sha256(convert_to(public.canonical_schedule_part4_stable_json(entry),'UTF8')),
        'hex') AS digest_value
        FROM jsonb_array_elements(values_value) item(entry)
    ) digests
$function$;

-- Return NULL for a local wall time that is a gap or fold.  Business Profile
-- hours are minute-granular, so the bounded fifteen-minute offset probe covers
-- all IANA offset changes representable by the accepted profile contract.
CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_unique_local_instant(
  local_value TIMESTAMP WITHOUT TIME ZONE,time_zone_value TEXT
)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  candidate TIMESTAMPTZ;
BEGIN
  candidate := local_value AT TIME ZONE time_zone_value;
  IF candidate AT TIME ZONE time_zone_value<>local_value OR EXISTS (
    SELECT 1 FROM generate_series(-104,104) offset_step
     WHERE offset_step<>0
       AND (candidate+make_interval(mins=>offset_step*15)) AT TIME ZONE time_zone_value=local_value
  ) THEN
    RETURN NULL;
  END IF;
  RETURN candidate;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_working_hours_authority(
  raw_profile_value JSONB,scheduled_start_value TIMESTAMPTZ,
  scheduled_end_value TIMESTAMPTZ,time_zone_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql STABLE
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  first_date DATE;
  last_date DATE;
  current_date_value DATE;
  weekday_name TEXT;
  day_policy JSONB;
  holiday_policy JSONB;
  holiday_count INTEGER;
  open_text TEXT;
  close_text TEXT;
  lunch_match TEXT[];
  open_local TIMESTAMP WITHOUT TIME ZONE;
  close_local TIMESTAMP WITHOUT TIME ZONE;
  open_instant TIMESTAMPTZ;
  close_instant TIMESTAMPTZ;
  lunch_open_instant TIMESTAMPTZ;
  lunch_close_instant TIMESTAMPTZ;
  windows_value JSONB := '[]'::JSONB;
  unknown_dates_value JSONB := '[]'::JSONB;
  cursor_value TIMESTAMPTZ;
  window_record RECORD;
  guard INTEGER := 0;
BEGIN
  IF scheduled_start_value IS NULL OR scheduled_end_value IS NULL
     OR scheduled_end_value<=scheduled_start_value THEN
    RETURN jsonb_build_object('covered',FALSE,'unknownDates',jsonb_build_array());
  END IF;
  BEGIN
    first_date := (scheduled_start_value AT TIME ZONE time_zone_value)::DATE;
    last_date := ((scheduled_end_value-INTERVAL '1 microsecond') AT TIME ZONE time_zone_value)::DATE;
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN jsonb_build_object('covered',FALSE,'unknownDates',jsonb_build_array('invalid_time_zone'));
  END;
  current_date_value := first_date-1;
  WHILE current_date_value<=last_date AND guard<35 LOOP
    weekday_name := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[
      extract(dow FROM current_date_value)::INTEGER+1];
    holiday_policy := NULL;
    SELECT count(*)::INTEGER,(jsonb_agg(holiday)->0)
      INTO holiday_count,holiday_policy
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw_profile_value#>'{hours,holidays}')='array'
        THEN raw_profile_value#>'{hours,holidays}' ELSE '[]'::JSONB END) item(holiday)
     WHERE jsonb_typeof(holiday)='object' AND holiday->>'date'=current_date_value::TEXT;
    IF holiday_count>1 THEN
      unknown_dates_value := unknown_dates_value||jsonb_build_array(current_date_value::TEXT);
      current_date_value := current_date_value+1;
      guard := guard+1;
      CONTINUE;
    ELSIF holiday_count=1 THEN
      day_policy := holiday_policy;
      IF day_policy->'closed'='true'::JSONB THEN
        current_date_value := current_date_value+1;
        guard := guard+1;
        CONTINUE;
      ELSIF day_policy->'closed'<>'false'::JSONB THEN
        unknown_dates_value := unknown_dates_value||jsonb_build_array(current_date_value::TEXT);
        current_date_value := current_date_value+1;
        guard := guard+1;
        CONTINUE;
      END IF;
    ELSE
      day_policy := raw_profile_value#>ARRAY['hours',weekday_name];
      IF jsonb_typeof(day_policy)<>'object' THEN
        unknown_dates_value := unknown_dates_value||jsonb_build_array(current_date_value::TEXT);
        current_date_value := current_date_value+1;
        guard := guard+1;
        CONTINUE;
      END IF;
      IF COALESCE(day_policy->>'open','')='' AND COALESCE(day_policy->>'close','')='' THEN
        current_date_value := current_date_value+1;
        guard := guard+1;
        CONTINUE;
      END IF;
    END IF;
    open_text := day_policy->>'open';
    close_text := day_policy->>'close';
    IF open_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR close_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      unknown_dates_value := unknown_dates_value||jsonb_build_array(current_date_value::TEXT);
      current_date_value := current_date_value+1;
      guard := guard+1;
      CONTINUE;
    END IF;
    open_local := current_date_value+open_text::TIME;
    close_local := (CASE WHEN close_text<=open_text THEN current_date_value+1 ELSE current_date_value END)+close_text::TIME;
    open_instant := public.canonical_schedule_part4_unique_local_instant(open_local,time_zone_value);
    close_instant := public.canonical_schedule_part4_unique_local_instant(close_local,time_zone_value);
    IF open_instant IS NULL OR close_instant IS NULL OR close_instant<=open_instant THEN
      unknown_dates_value := unknown_dates_value||jsonb_build_array(current_date_value::TEXT);
      current_date_value := current_date_value+1;
      guard := guard+1;
      CONTINUE;
    END IF;
    lunch_match := regexp_match(COALESCE(day_policy->>'lunch',''),
      '^(([01][0-9]|2[0-3]):[0-5][0-9])-(([01][0-9]|2[0-3]):[0-5][0-9])$');
    IF COALESCE(day_policy->>'lunch','')='' THEN
      windows_value := windows_value||jsonb_build_array(jsonb_build_object('start',open_instant,'end',close_instant));
    ELSIF lunch_match IS NULL THEN
      unknown_dates_value := unknown_dates_value||jsonb_build_array(current_date_value::TEXT);
    ELSE
      lunch_open_instant := public.canonical_schedule_part4_unique_local_instant(
        current_date_value+lunch_match[1]::TIME,time_zone_value);
      lunch_close_instant := public.canonical_schedule_part4_unique_local_instant(
        current_date_value+lunch_match[3]::TIME,time_zone_value);
      IF lunch_open_instant IS NULL OR lunch_close_instant IS NULL
         OR lunch_open_instant<open_instant OR lunch_close_instant>close_instant
         OR lunch_close_instant<=lunch_open_instant THEN
        unknown_dates_value := unknown_dates_value||jsonb_build_array(current_date_value::TEXT);
      ELSE
        IF lunch_open_instant>open_instant THEN
          windows_value := windows_value||jsonb_build_array(jsonb_build_object('start',open_instant,'end',lunch_open_instant));
        END IF;
        IF lunch_close_instant<close_instant THEN
          windows_value := windows_value||jsonb_build_array(jsonb_build_object('start',lunch_close_instant,'end',close_instant));
        END IF;
      END IF;
    END IF;
    current_date_value := current_date_value+1;
    guard := guard+1;
  END LOOP;
  IF current_date_value<=last_date THEN
    unknown_dates_value := unknown_dates_value||jsonb_build_array(last_date::TEXT);
  END IF;
  cursor_value := scheduled_start_value;
  FOR window_record IN
    SELECT (window_value->>'start')::TIMESTAMPTZ AS starts_at,
           (window_value->>'end')::TIMESTAMPTZ AS ends_at
      FROM jsonb_array_elements(windows_value) item(window_value)
     ORDER BY (window_value->>'start')::TIMESTAMPTZ,(window_value->>'end')::TIMESTAMPTZ
  LOOP
    IF window_record.ends_at<=cursor_value THEN CONTINUE; END IF;
    IF window_record.starts_at>cursor_value THEN EXIT; END IF;
    cursor_value := greatest(cursor_value,window_record.ends_at);
    IF cursor_value>=scheduled_end_value THEN EXIT; END IF;
  END LOOP;
  RETURN jsonb_build_object('covered',cursor_value>=scheduled_end_value,
    'unknownDates',public.canonical_schedule_part4_stable_entries(unknown_dates_value));
END
$function$;

-- The ordinary application role deliberately owns no canonical scheduling
-- evidence tables, but it can invoke the two Part 4 entry routines.  Therefore
-- caller-provided Part 2 JSON is never sufficient authority for a mutation.
-- Recompute every presently authoritative hard-conflict class from locked
-- PostgreSQL state.  Advisory warnings/recommendations remain useful preview
-- context, but cannot make this trusted result less restrictive.
CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_hard_authority(
  organization_id_value UUID,assignment_id_value UUID,target_kind_value TEXT,
  target_id_value UUID,scheduled_start_value TIMESTAMPTZ,scheduled_end_value TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  member_ids UUID[] := ARRAY[]::UUID[];
  target_exists BOOLEAN := FALSE;
  target_location_id TEXT;
  service_id_value TEXT;
  location_id_value TEXT;
  canonical_location_id TEXT;
  location_match_count INTEGER := 0;
  skill_authority_known BOOLEAN := FALSE;
  hard_conflicts_value JSONB := '[]'::JSONB;
BEGIN
  IF (scheduled_start_value IS NULL) IS DISTINCT FROM (scheduled_end_value IS NULL)
     OR (scheduled_start_value IS NOT NULL AND scheduled_end_value<=scheduled_start_value) THEN
    RAISE EXCEPTION 'Trusted conflict proposal is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;

  -- The owning entry routine holds the organization update lock before calling
  -- here.  These row locks bind the hard-conflict read set to that same atomic
  -- transaction and prevent a concurrent authority change from being accepted.
  PERFORM 1
    FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_opportunities opportunity
      ON opportunity.organization_id=assignment.organization_id
     AND opportunity.id=assignment.opportunity_id
   WHERE assignment.organization_id=organization_id_value AND assignment.id=assignment_id_value
   FOR SHARE OF assignment,opportunity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted conflict assignment is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_scope_unavailable';
  END IF;

  SELECT opportunity.service_type,
         CASE WHEN jsonb_typeof(opportunity.job_scope)='object'
                   AND jsonb_typeof(opportunity.job_scope->'locationId')='string'
              THEN opportunity.job_scope->>'locationId' ELSE NULL END
    INTO service_id_value,location_id_value
    FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_opportunities opportunity
      ON opportunity.organization_id=assignment.organization_id
     AND opportunity.id=assignment.opportunity_id
   WHERE assignment.organization_id=organization_id_value AND assignment.id=assignment_id_value;

  IF target_kind_value='profile' THEN
    SELECT TRUE,profile.home_location_id,ARRAY[profile.id]::UUID[]
      INTO target_exists,target_location_id,member_ids
      FROM public.workforce_profiles profile
      JOIN public.organization_memberships membership
        ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
      JOIN public.users account
        ON account.organization_id=membership.organization_id AND account.id=membership.user_id
     WHERE profile.organization_id=organization_id_value AND profile.id=target_id_value
     FOR SHARE OF profile,membership,account;
  ELSIF target_kind_value='crew' THEN
    SELECT TRUE,crew.home_location_id
      INTO target_exists,target_location_id
      FROM public.workforce_crews crew
     WHERE crew.organization_id=organization_id_value AND crew.id=target_id_value
     FOR SHARE OF crew;
    IF target_exists THEN
      SELECT COALESCE(array_agg(member.profile_id ORDER BY member.profile_id),ARRAY[]::UUID[])
        INTO member_ids
        FROM (
          SELECT relation.profile_id
            FROM public.workforce_crew_members relation
            JOIN public.workforce_profiles profile
              ON profile.organization_id=relation.organization_id AND profile.id=relation.profile_id
            JOIN public.organization_memberships membership
              ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
            JOIN public.users account
              ON account.organization_id=membership.organization_id AND account.id=membership.user_id
           WHERE relation.organization_id=organization_id_value AND relation.crew_id=target_id_value
           ORDER BY relation.profile_id LIMIT 100
           FOR SHARE OF relation,profile,membership,account
        ) member;
    END IF;
  ELSIF target_kind_value='unassigned' AND target_id_value IS NULL THEN
    target_exists := TRUE;
  END IF;

  IF scheduled_start_value IS NULL OR target_kind_value='unassigned' THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Lock the remaining authoritative workforce and availability evidence.
  PERFORM 1
    FROM public.workforce_profile_skills relation
    JOIN public.workforce_skills skill
      ON skill.organization_id=relation.organization_id AND skill.id=relation.skill_id
   WHERE relation.organization_id=organization_id_value AND relation.profile_id=ANY(member_ids)
   FOR SHARE OF relation,skill;
  PERFORM 1
    FROM public.canonical_workforce_availability_authorities authority
   WHERE authority.organization_id=organization_id_value
     AND authority.workforce_profile_id=ANY(member_ids)
   FOR SHARE OF authority;
  PERFORM 1
    FROM public.canonical_workforce_availability_intervals interval
    JOIN public.canonical_workforce_availability_authorities authority
      ON authority.organization_id=interval.organization_id AND authority.id=interval.availability_id
   WHERE interval.organization_id=organization_id_value
     AND authority.workforce_profile_id=ANY(member_ids)
   FOR SHARE OF interval,authority;
  PERFORM 1
    FROM public.canonical_schedule_assignments assignment
   WHERE assignment.organization_id=organization_id_value AND assignment.id<>assignment_id_value
     AND assignment.schedule_state='scheduled' AND assignment.appointment_status<>'cancelled'
     AND assignment.scheduled_start<scheduled_end_value
     AND assignment.scheduled_end>scheduled_start_value
   ORDER BY assignment.id
   FOR SHARE OF assignment;
  PERFORM 1
    FROM public.workforce_crew_members relation
    JOIN public.canonical_schedule_assignments assignment
      ON assignment.organization_id=relation.organization_id AND assignment.workforce_crew_id=relation.crew_id
   WHERE assignment.organization_id=organization_id_value AND assignment.id<>assignment_id_value
     AND assignment.schedule_state='scheduled' AND assignment.appointment_status<>'cancelled'
     AND assignment.scheduled_start<scheduled_end_value
     AND assignment.scheduled_end>scheduled_start_value
   FOR SHARE OF relation,assignment;

  SELECT count(*)::INTEGER,min(candidate.location_id)
    INTO location_match_count,canonical_location_id
    FROM (
      SELECT 'headquarters'::TEXT AS location_id
      UNION ALL
      SELECT office->>'id'
        FROM public.organization_onboarding onboarding
        JOIN public.canonical_business_profiles profile
          ON profile.organization_id=onboarding.organization_id
         AND profile.id=onboarding.active_business_profile_id AND profile.is_active=TRUE
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(profile.raw_profile#>'{headquarters,additionalOffices}')='array'
               THEN profile.raw_profile#>'{headquarters,additionalOffices}' ELSE '[]'::JSONB END
        ) office
       WHERE onboarding.organization_id=organization_id_value
         AND jsonb_typeof(office)='object' AND jsonb_typeof(office->'id')='string'
         AND office->>'id' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    ) candidate
   WHERE location_id_value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
     AND lower(candidate.location_id)=lower(location_id_value);
  SELECT EXISTS (
    SELECT 1 FROM public.workforce_skills skill
     WHERE skill.organization_id=organization_id_value
       AND lower(skill.service_id)=lower(service_id_value)
  ) INTO skill_authority_known;

  WITH inactive AS (
    SELECT CASE WHEN target_kind_value='crew' THEN 'inactive_crew_member' ELSE 'inactive_target' END AS code,
           profile.id AS profile_id
      FROM public.workforce_profiles profile
      JOIN public.organization_memberships membership
        ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
      JOIN public.users account
        ON account.organization_id=membership.organization_id AND account.id=membership.user_id
     WHERE profile.organization_id=organization_id_value AND profile.id=ANY(member_ids)
       AND (membership.status<>'active' OR account.status<>'active')
  ), unavailable AS (
    SELECT DISTINCT 'declared_unavailable'::TEXT AS code,authority.workforce_profile_id AS profile_id
      FROM public.canonical_workforce_availability_authorities authority
      JOIN public.canonical_workforce_availability_intervals interval
        ON interval.organization_id=authority.organization_id AND interval.availability_id=authority.id
     WHERE authority.organization_id=organization_id_value
       AND authority.workforce_profile_id=ANY(member_ids)
       AND authority.coverage_start<=scheduled_start_value AND authority.coverage_end>=scheduled_end_value
       AND interval.interval_kind='unavailable'
       AND interval.starts_at<scheduled_end_value AND interval.ends_at>scheduled_start_value
  ), overlapping_targets AS (
    SELECT assignment.id AS assignment_id,assignment.workforce_profile_id AS profile_id
      FROM public.canonical_schedule_assignments assignment
     WHERE assignment.organization_id=organization_id_value AND assignment.id<>assignment_id_value
       AND assignment.schedule_state='scheduled' AND assignment.appointment_status<>'cancelled'
       AND (assignment.last_approval_id IS NOT NULL OR assignment.last_human_approval_id IS NOT NULL)
       AND assignment.scheduled_start<scheduled_end_value AND assignment.scheduled_end>scheduled_start_value
       AND assignment.workforce_profile_id IS NOT NULL
    UNION ALL
    SELECT assignment.id,member.profile_id
      FROM public.canonical_schedule_assignments assignment
      JOIN LATERAL (
        SELECT relation.profile_id
          FROM public.workforce_crew_members relation
         WHERE relation.organization_id=assignment.organization_id
           AND relation.crew_id=assignment.workforce_crew_id
         ORDER BY relation.profile_id LIMIT 100
      ) member ON TRUE
     WHERE assignment.organization_id=organization_id_value AND assignment.id<>assignment_id_value
       AND assignment.schedule_state='scheduled' AND assignment.appointment_status<>'cancelled'
       AND (assignment.last_approval_id IS NOT NULL OR assignment.last_human_approval_id IS NOT NULL)
       AND assignment.scheduled_start<scheduled_end_value AND assignment.scheduled_end>scheduled_start_value
  ), entries AS (
    SELECT 'target_unavailable'::TEXT AS code,NULL::UUID AS assignment_id,NULL::UUID AS profile_id,
           jsonb_build_object('code','target_unavailable') AS entry
     WHERE NOT target_exists
    UNION ALL
    SELECT inactive.code,NULL,inactive.profile_id,
           jsonb_build_object('code',inactive.code,'profileId',inactive.profile_id)
      FROM inactive
    UNION ALL
    SELECT 'required_skill_mismatch',NULL,NULL,
           jsonb_build_object('code','required_skill_mismatch','serviceId',service_id_value)
     WHERE service_id_value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
       AND skill_authority_known
       AND NOT EXISTS (
         SELECT 1 FROM public.workforce_profile_skills relation
         JOIN public.workforce_skills skill
           ON skill.organization_id=relation.organization_id AND skill.id=relation.skill_id
        WHERE relation.organization_id=organization_id_value AND relation.profile_id=ANY(member_ids)
          AND lower(skill.service_id)=lower(service_id_value)
       )
    UNION ALL
    SELECT 'location_scope_mismatch',NULL,NULL,
           jsonb_build_object('code','location_scope_mismatch','requiredLocationId',canonical_location_id)
     WHERE location_match_count=1 AND target_location_id IS NOT NULL
       AND lower(target_location_id)<>lower(canonical_location_id)
    UNION ALL
    SELECT unavailable.code,NULL,unavailable.profile_id,
           jsonb_build_object('code',unavailable.code,'profileId',unavailable.profile_id)
      FROM unavailable
    UNION ALL
    SELECT 'approved_schedule_overlap',overlap.assignment_id,overlap.profile_id,
           jsonb_build_object('code','approved_schedule_overlap',
             'assignmentId',overlap.assignment_id,'profileId',overlap.profile_id)
      FROM overlapping_targets overlap
     WHERE overlap.profile_id=ANY(member_ids)
  ), distinct_entries AS (
    SELECT DISTINCT code,assignment_id,profile_id,entry FROM entries
  ), bounded AS (
    SELECT code,assignment_id,profile_id,entry FROM distinct_entries
     ORDER BY code COLLATE "C",assignment_id NULLS FIRST,profile_id NULLS FIRST,entry::TEXT COLLATE "C"
     LIMIT 256
  )
  SELECT COALESCE(jsonb_agg(entry ORDER BY code COLLATE "C",assignment_id NULLS FIRST,
    profile_id NULLS FIRST,entry::TEXT COLLATE "C"),'[]'::JSONB)
    INTO hard_conflicts_value FROM bounded;
  RETURN hard_conflicts_value;
END
$function$;

-- Derive the complete Part 2 decision from the same locked PostgreSQL evidence
-- used by the mutation.  The result is deliberately broader than the hard
-- gate above: warnings and missing/stale evidence are immutable human-review
-- authority too and may not be cleared (or invented) by a runtime caller.
CREATE OR REPLACE FUNCTION public.canonical_schedule_part4_review_authority(
  organization_id_value UUID,assignment_id_value UUID,target_kind_value TEXT,
  target_id_value UUID,scheduled_start_value TIMESTAMPTZ,scheduled_end_value TIMESTAMPTZ,
  time_zone_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  raw_profile_value JSONB;
  profile_hash_value TEXT;
  opportunity_updated_value TIMESTAMPTZ;
  service_id_value TEXT;
  location_id_value TEXT;
  target_location_id TEXT;
  canonical_location_id TEXT;
  location_match_count INTEGER := 0;
  member_ids UUID[] := ARRAY[]::UUID[];
  member_count INTEGER := 0;
  total_member_count INTEGER := 0;
  skill_count INTEGER := 0;
  interval_count INTEGER := 0;
  schedule_count INTEGER := 0;
  workload_count INTEGER := 0;
  skill_authority_known BOOLEAN := FALSE;
  hard_value JSONB;
  warnings_value JSONB := '[]'::JSONB;
  reviews_value JSONB := '[]'::JSONB;
  working_value JSONB;
  buffer_minutes INTEGER := 0;
  max_jobs INTEGER;
  workday_minutes NUMERIC;
  max_crew_size INTEGER;
  member_id_value UUID;
  availability_record RECORD;
  availability_cursor TIMESTAMPTZ;
  interval_record RECORD;
  schedule_record RECORD;
  shared_ids UUID[];
  local_first DATE;
  local_last DATE;
  local_date_value DATE;
  day_start TIMESTAMPTZ;
  day_end TIMESTAMPTZ;
  approved_count INTEGER;
  approved_minutes NUMERIC;
  proposed_minutes NUMERIC;
  all_hard_count INTEGER;
  all_warning_count INTEGER;
  all_review_count INTEGER;
  status_value TEXT;
  authority_snapshot JSONB;
  authority_digest_value TEXT;
  recommendation_digest_value TEXT;
BEGIN
  hard_value := public.canonical_schedule_part4_hard_authority(
    organization_id_value,assignment_id_value,target_kind_value,target_id_value,
    scheduled_start_value,scheduled_end_value
  );
  SELECT assignment.* INTO assignment_record
    FROM public.canonical_schedule_assignments assignment
   WHERE assignment.organization_id=organization_id_value AND assignment.id=assignment_id_value
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted review assignment is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_scope_unavailable';
  END IF;
  SELECT opportunity.service_type,
         CASE WHEN jsonb_typeof(opportunity.job_scope)='object'
                    AND jsonb_typeof(opportunity.job_scope->'locationId')='string'
              THEN opportunity.job_scope->>'locationId' ELSE NULL END,
         opportunity.updated_at,profile.raw_profile,rtrim(profile.normalized_profile_hash)
    INTO service_id_value,location_id_value,opportunity_updated_value,raw_profile_value,profile_hash_value
    FROM public.canonical_opportunities opportunity
    JOIN public.organization_onboarding onboarding
      ON onboarding.organization_id=opportunity.organization_id AND onboarding.status='complete'
    JOIN public.canonical_business_profiles profile
      ON profile.organization_id=onboarding.organization_id
     AND profile.id=onboarding.active_business_profile_id AND profile.is_active=TRUE
   WHERE opportunity.organization_id=organization_id_value AND opportunity.id=assignment_record.opportunity_id
     AND profile.raw_profile#>>'{company,timeZone}'=time_zone_value
   FOR SHARE OF opportunity,onboarding,profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted review authority is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_scope_unavailable';
  END IF;

  -- An unscheduled Part 2 result is intentionally the single
  -- appointment_schedule_unavailable review reason, but target/crew evidence
  -- still influences Part 3 recommendations and must remain pinned between
  -- preview and approval.
  IF scheduled_start_value IS NULL AND target_kind_value='profile' THEN
    SELECT profile.home_location_id,ARRAY[profile.id]::UUID[]
      INTO target_location_id,member_ids
      FROM public.workforce_profiles profile
     WHERE profile.organization_id=organization_id_value AND profile.id=target_id_value
     FOR SHARE;
    total_member_count := COALESCE(array_length(member_ids,1),0);
    member_count := total_member_count;
  ELSIF scheduled_start_value IS NULL AND target_kind_value='crew' THEN
    SELECT crew.home_location_id INTO target_location_id
      FROM public.workforce_crews crew
     WHERE crew.organization_id=organization_id_value AND crew.id=target_id_value
     FOR SHARE;
    SELECT count(*)::INTEGER,
           COALESCE(array_agg(profile_id ORDER BY profile_id) FILTER (WHERE ordinal<=100),ARRAY[]::UUID[])
      INTO total_member_count,member_ids
      FROM (
        SELECT relation.profile_id,row_number() OVER (ORDER BY relation.profile_id) AS ordinal
          FROM public.workforce_crew_members relation
         WHERE relation.organization_id=organization_id_value AND relation.crew_id=target_id_value
      ) members;
    member_count := COALESCE(array_length(member_ids,1),0);
  END IF;

  IF scheduled_start_value IS NULL THEN
    reviews_value := jsonb_build_array(jsonb_build_object('code','appointment_schedule_unavailable'));
  ELSIF target_kind_value='unassigned' THEN
    reviews_value := jsonb_build_array(jsonb_build_object('code','target_unassigned'));
  ELSE
    IF target_kind_value='profile' THEN
      SELECT profile.home_location_id,ARRAY[profile.id]::UUID[]
        INTO target_location_id,member_ids
        FROM public.workforce_profiles profile
       WHERE profile.organization_id=organization_id_value AND profile.id=target_id_value
       FOR SHARE;
      total_member_count := COALESCE(array_length(member_ids,1),0);
    ELSE
      SELECT crew.home_location_id INTO target_location_id
        FROM public.workforce_crews crew
       WHERE crew.organization_id=organization_id_value AND crew.id=target_id_value
       FOR SHARE;
      SELECT count(*)::INTEGER,
             COALESCE(array_agg(profile_id ORDER BY profile_id) FILTER (WHERE ordinal<=100),ARRAY[]::UUID[])
        INTO total_member_count,member_ids
        FROM (
          SELECT relation.profile_id,row_number() OVER (ORDER BY relation.profile_id) AS ordinal
            FROM public.workforce_crew_members relation
           WHERE relation.organization_id=organization_id_value AND relation.crew_id=target_id_value
        ) members;
      IF total_member_count=0 THEN
        reviews_value := reviews_value||jsonb_build_array(
          jsonb_build_object('code','crew_membership_incomplete','crewId',target_id_value));
      END IF;
      IF total_member_count>100 THEN
        reviews_value := reviews_value||jsonb_build_array(
          jsonb_build_object('code','crew_membership_bounded','crewId',target_id_value));
      END IF;
    END IF;
    member_count := COALESCE(array_length(member_ids,1),0);

    SELECT count(*)::INTEGER INTO skill_count
      FROM public.workforce_profile_skills relation
      JOIN public.workforce_skills skill
        ON skill.organization_id=relation.organization_id AND skill.id=relation.skill_id
     WHERE relation.organization_id=organization_id_value AND relation.profile_id=ANY(member_ids);
    SELECT EXISTS (SELECT 1 FROM public.workforce_skills skill
      WHERE skill.organization_id=organization_id_value
        AND service_id_value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
        AND lower(skill.service_id)=lower(service_id_value)) INTO skill_authority_known;
    IF skill_count>4096 THEN
      reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','required_skill_authority_bounded'));
    ELSIF service_id_value IS NULL
       OR service_id_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
       OR NOT skill_authority_known THEN
      reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','required_skill_authority_missing'));
    END IF;

    SELECT count(*)::INTEGER,min(candidate.location_id)
      INTO location_match_count,canonical_location_id
      FROM (
        SELECT 'headquarters'::TEXT AS location_id
        UNION ALL
        SELECT office->>'id'
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw_profile_value#>'{headquarters,additionalOffices}')='array'
            THEN raw_profile_value#>'{headquarters,additionalOffices}' ELSE '[]'::JSONB END) item(office)
         WHERE jsonb_typeof(office)='object' AND jsonb_typeof(office->'id')='string'
           AND office->>'id' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
      ) candidate
     WHERE location_id_value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
       AND lower(candidate.location_id)=lower(location_id_value);
    IF location_match_count<>1 THEN
      reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','location_scope_authority_missing'));
    ELSIF target_location_id IS NULL THEN
      reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','target_location_scope_missing'));
    END IF;

    working_value := public.canonical_schedule_part4_working_hours_authority(
      raw_profile_value,scheduled_start_value,scheduled_end_value,time_zone_value);
    IF (working_value->>'covered')::BOOLEAN IS NOT TRUE THEN
      IF jsonb_array_length(working_value->'unknownDates')>0 THEN
        reviews_value := reviews_value||jsonb_build_array(jsonb_build_object(
          'code','working_hours_authority_incomplete','dates',working_value->'unknownDates'));
      ELSE
        warnings_value := warnings_value||jsonb_build_array(jsonb_build_object('code','outside_working_hours'));
      END IF;
    END IF;

    SELECT count(*)::INTEGER INTO interval_count
      FROM public.canonical_workforce_availability_intervals interval
      JOIN public.canonical_workforce_availability_authorities authority
        ON authority.organization_id=interval.organization_id AND authority.id=interval.availability_id
     WHERE interval.organization_id=organization_id_value
       AND authority.workforce_profile_id=ANY(member_ids);
    IF interval_count>4096 THEN
      reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','availability_authority_bounded'));
    ELSE
      FOREACH member_id_value IN ARRAY member_ids LOOP
        SELECT authority.* INTO availability_record
          FROM public.canonical_workforce_availability_authorities authority
         WHERE authority.organization_id=organization_id_value
           AND authority.workforce_profile_id=member_id_value FOR SHARE;
        IF NOT FOUND THEN
          reviews_value := reviews_value||jsonb_build_array(jsonb_build_object(
            'code','availability_authority_missing','profileId',member_id_value));
          CONTINUE;
        END IF;
        IF availability_record.coverage_start>scheduled_start_value
           OR availability_record.coverage_end<scheduled_end_value THEN
          reviews_value := reviews_value||jsonb_build_array(jsonb_build_object(
            'code','availability_authority_stale','profileId',member_id_value));
          CONTINUE;
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.canonical_workforce_availability_intervals interval
           WHERE interval.organization_id=organization_id_value
             AND interval.availability_id=availability_record.id
             AND interval.interval_kind='unavailable'
             AND interval.starts_at<scheduled_end_value AND interval.ends_at>scheduled_start_value
        ) THEN
          CONTINUE;
        END IF;
        availability_cursor := scheduled_start_value;
        FOR interval_record IN
          SELECT interval.starts_at,interval.ends_at
            FROM public.canonical_workforce_availability_intervals interval
           WHERE interval.organization_id=organization_id_value
             AND interval.availability_id=availability_record.id AND interval.interval_kind='available'
           ORDER BY interval.starts_at,interval.ends_at
        LOOP
          IF interval_record.ends_at<=availability_cursor THEN CONTINUE; END IF;
          IF interval_record.starts_at>availability_cursor THEN EXIT; END IF;
          availability_cursor := greatest(availability_cursor,interval_record.ends_at);
          IF availability_cursor>=scheduled_end_value THEN EXIT; END IF;
        END LOOP;
        IF availability_cursor<scheduled_end_value THEN
          reviews_value := reviews_value||jsonb_build_array(jsonb_build_object(
            'code','declared_availability_incomplete','profileId',member_id_value));
        END IF;
      END LOOP;
    END IF;

    buffer_minutes := greatest(
      CASE WHEN jsonb_typeof(raw_profile_value#>'{scheduling,appointmentBuffer}')='number'
             AND (raw_profile_value#>>'{scheduling,appointmentBuffer}')::NUMERIC BETWEEN 0 AND 1440
        THEN (raw_profile_value#>>'{scheduling,appointmentBuffer}')::INTEGER ELSE 0 END,
      CASE WHEN jsonb_typeof(raw_profile_value#>'{scheduling,travelBuffer}')='number'
             AND (raw_profile_value#>>'{scheduling,travelBuffer}')::NUMERIC BETWEEN 0 AND 1440
        THEN (raw_profile_value#>>'{scheduling,travelBuffer}')::INTEGER ELSE 0 END
    );
    FOR schedule_record IN
      SELECT assignment.id,assignment.scheduled_start,assignment.scheduled_end,
             (assignment.last_approval_id IS NOT NULL OR assignment.last_human_approval_id IS NOT NULL) AS approved,
             COALESCE(targets.profile_ids,ARRAY[]::UUID[]) AS profile_ids,targets.total_count,
             row_number() OVER (ORDER BY assignment.scheduled_start,assignment.id) AS ordinal
        FROM public.canonical_schedule_assignments assignment
        LEFT JOIN LATERAL (
          SELECT count(*)::INTEGER AS total_count,
                 COALESCE(array_agg(profile_id ORDER BY profile_id) FILTER (WHERE ordinal<=100),ARRAY[]::UUID[]) AS profile_ids
            FROM (
              SELECT profile_id,row_number() OVER (ORDER BY profile_id) AS ordinal
                FROM (
                  SELECT assignment.workforce_profile_id AS profile_id WHERE assignment.workforce_profile_id IS NOT NULL
                  UNION
                  SELECT relation.profile_id FROM public.workforce_crew_members relation
                   WHERE relation.organization_id=assignment.organization_id
                     AND relation.crew_id=assignment.workforce_crew_id
                ) profiles
            ) bounded_profiles
        ) targets ON TRUE
       WHERE assignment.organization_id=organization_id_value AND assignment.id<>assignment_id_value
         AND assignment.schedule_state='scheduled' AND assignment.appointment_status<>'cancelled'
         AND assignment.scheduled_start<scheduled_end_value+make_interval(mins=>buffer_minutes)
         AND assignment.scheduled_end>scheduled_start_value-make_interval(mins=>buffer_minutes)
       ORDER BY assignment.scheduled_start,assignment.id LIMIT 1001
    LOOP
      schedule_count := schedule_count+1;
      IF schedule_record.ordinal>1000 THEN CONTINUE; END IF;
      IF schedule_record.total_count>100 THEN schedule_count := 1001; END IF;
      SELECT COALESCE(array_agg(profile_id ORDER BY profile_id),ARRAY[]::UUID[]) INTO shared_ids
        FROM unnest(schedule_record.profile_ids) profile_id WHERE profile_id=ANY(member_ids);
      IF COALESCE(array_length(shared_ids,1),0)=0 THEN CONTINUE; END IF;
      IF schedule_record.scheduled_start<scheduled_end_value
         AND schedule_record.scheduled_end>scheduled_start_value THEN
        IF NOT schedule_record.approved THEN
          FOREACH member_id_value IN ARRAY shared_ids LOOP
            reviews_value := reviews_value||jsonb_build_array(jsonb_build_object(
              'code','overlap_authority_unapproved','assignmentId',schedule_record.id,
              'profileId',member_id_value));
          END LOOP;
        END IF;
      ELSIF schedule_record.approved AND buffer_minutes>0 THEN
        warnings_value := warnings_value||jsonb_build_array(jsonb_build_object(
          'code','schedule_buffer_threshold','assignmentId',schedule_record.id,
          'bufferMinutes',buffer_minutes,'profileIds',to_jsonb(shared_ids)));
      END IF;
    END LOOP;
    IF schedule_count>1000 THEN
      reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','schedule_evidence_bounded'));
    END IF;

    BEGIN
      local_first := (scheduled_start_value AT TIME ZONE time_zone_value)::DATE;
      local_last := ((scheduled_end_value-INTERVAL '1 millisecond') AT TIME ZONE time_zone_value)::DATE;
    EXCEPTION WHEN invalid_parameter_value THEN
      local_first := NULL; local_last := NULL;
    END;
    IF local_first IS NULL OR local_last-local_first>=32 THEN
      reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','workload_authority_incomplete'));
    ELSE
      IF jsonb_typeof(raw_profile_value#>'{scheduling,maxJobsPerDay}')='number'
         AND (raw_profile_value#>>'{scheduling,maxJobsPerDay}')::NUMERIC BETWEEN 1 AND 1000 THEN
        max_jobs := (raw_profile_value#>>'{scheduling,maxJobsPerDay}')::INTEGER;
      END IF;
      IF jsonb_typeof(raw_profile_value#>'{scheduling,workDayLength}')='number'
         AND (raw_profile_value#>>'{scheduling,workDayLength}')::NUMERIC BETWEEN 0.25 AND 24 THEN
        workday_minutes := (raw_profile_value#>>'{scheduling,workDayLength}')::NUMERIC*60;
      END IF;
      FOREACH member_id_value IN ARRAY member_ids LOOP
        local_date_value := local_first;
        WHILE local_date_value<=local_last LOOP
          day_start := public.canonical_schedule_part4_unique_local_instant(local_date_value::TIMESTAMP,time_zone_value);
          day_end := public.canonical_schedule_part4_unique_local_instant((local_date_value+1)::TIMESTAMP,time_zone_value);
          IF day_start IS NULL OR day_end IS NULL OR day_end<=day_start THEN
            reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','workload_authority_incomplete'));
            EXIT;
          END IF;
          approved_count := 0; approved_minutes := 0;
          FOR schedule_record IN
            SELECT assignment.id,assignment.scheduled_start,assignment.scheduled_end,
                   (assignment.last_approval_id IS NOT NULL OR assignment.last_human_approval_id IS NOT NULL) AS approved,
                   row_number() OVER (ORDER BY assignment.scheduled_start,assignment.id) AS ordinal
              FROM public.canonical_schedule_assignments assignment
             WHERE assignment.organization_id=organization_id_value AND assignment.id<>assignment_id_value
               AND assignment.schedule_state='scheduled' AND assignment.appointment_status<>'cancelled'
               AND assignment.scheduled_start<scheduled_end_value+INTERVAL '48 hours'
               AND assignment.scheduled_end>scheduled_start_value-INTERVAL '48 hours'
               AND assignment.scheduled_start<day_end AND assignment.scheduled_end>day_start
               AND (assignment.workforce_profile_id=member_id_value OR EXISTS (
                 SELECT 1 FROM public.workforce_crew_members relation
                  WHERE relation.organization_id=assignment.organization_id
                    AND relation.crew_id=assignment.workforce_crew_id AND relation.profile_id=member_id_value))
             ORDER BY assignment.scheduled_start,assignment.id LIMIT 1001
          LOOP
            workload_count := greatest(workload_count,schedule_record.ordinal);
            IF schedule_record.ordinal>1000 THEN CONTINUE; END IF;
            IF schedule_record.approved THEN
              approved_count := approved_count+1;
              approved_minutes := approved_minutes+extract(epoch FROM
                least(schedule_record.scheduled_end,day_end)-greatest(schedule_record.scheduled_start,day_start))/60;
            ELSE
              reviews_value := reviews_value||jsonb_build_array(jsonb_build_object(
                'code','workload_authority_unapproved','assignmentId',schedule_record.id,
                'localDate',local_date_value::TEXT,'profileId',member_id_value));
            END IF;
          END LOOP;
          IF max_jobs IS NOT NULL AND approved_count+1>max_jobs THEN
            warnings_value := warnings_value||jsonb_build_array(jsonb_build_object(
              'code','max_jobs_per_day_threshold','localDate',local_date_value::TEXT,
              'profileId',member_id_value,'proposedJobs',approved_count+1,'threshold',max_jobs));
          END IF;
          proposed_minutes := extract(epoch FROM
            least(scheduled_end_value,day_end)-greatest(scheduled_start_value,day_start))/60;
          IF workday_minutes IS NOT NULL AND proposed_minutes+approved_minutes>workday_minutes THEN
            warnings_value := warnings_value||jsonb_build_array(jsonb_build_object(
              'code','workday_length_threshold','localDate',local_date_value::TEXT,
              'profileId',member_id_value,'proposedMinutes',round(proposed_minutes+approved_minutes),
              'thresholdMinutes',round(workday_minutes)));
          END IF;
          local_date_value := local_date_value+1;
        END LOOP;
      END LOOP;
      IF workload_count>1000 THEN
        reviews_value := reviews_value||jsonb_build_array(jsonb_build_object('code','workload_evidence_bounded'));
      END IF;
    END IF;
    IF target_kind_value='crew'
       AND jsonb_typeof(raw_profile_value#>'{crew,maxCrewSize}')='number'
       AND (raw_profile_value#>>'{crew,maxCrewSize}')::NUMERIC BETWEEN 1 AND 1000 THEN
      max_crew_size := (raw_profile_value#>>'{crew,maxCrewSize}')::INTEGER;
      IF member_count>max_crew_size THEN
        warnings_value := warnings_value||jsonb_build_array(jsonb_build_object(
          'code','crew_size_threshold','proposedSize',member_count,'threshold',max_crew_size));
      END IF;
    END IF;
  END IF;

  hard_value := public.canonical_schedule_part4_stable_entries(hard_value);
  warnings_value := public.canonical_schedule_part4_stable_entries(warnings_value);
  reviews_value := public.canonical_schedule_part4_stable_entries(reviews_value);
  all_hard_count := jsonb_array_length(hard_value);
  all_warning_count := jsonb_array_length(warnings_value);
  all_review_count := jsonb_array_length(reviews_value);
  IF all_hard_count>256 OR all_warning_count>256 OR all_review_count>256 THEN
    reviews_value := public.canonical_schedule_part4_stable_entries(reviews_value||jsonb_build_array(
      jsonb_build_object('code','conflict_evidence_bounded','hardConflictCount',all_hard_count,
        'reviewReasonCount',all_review_count,'warningCount',all_warning_count)));
  END IF;
  hard_value := public.canonical_schedule_part4_bounded_entries(hard_value);
  warnings_value := public.canonical_schedule_part4_bounded_entries(warnings_value);
  reviews_value := public.canonical_schedule_part4_bounded_entries(reviews_value);
  status_value := CASE WHEN jsonb_array_length(hard_value)>0 THEN 'hard_conflict'
    WHEN jsonb_array_length(reviews_value)>0 THEN 'needs_review'
    WHEN jsonb_array_length(warnings_value)>0 THEN 'warning' ELSE 'clear' END;

  authority_snapshot := jsonb_build_object(
    'assignmentDigest',rtrim(assignment_record.canonical_digest),'assignmentRevision',assignment_record.revision,
    'businessProfileDigest',profile_hash_value,
    'businessProfileRawDigest',encode(sha256(convert_to(
      public.canonical_schedule_part4_stable_json(raw_profile_value),'UTF8')),'hex'),
    'opportunityUpdatedAt',opportunity_updated_value,
    'targetKind',target_kind_value,'targetId',target_id_value,'memberIds',to_jsonb(member_ids),
    'scheduledStart',scheduled_start_value,'scheduledEnd',scheduled_end_value,'timeZone',time_zone_value,
    'skillCount',skill_count,'availabilityIntervalCount',interval_count,
    'scheduleEvidenceCount',schedule_count,'workloadEvidenceCount',workload_count,
    'memberAuthority',(
      SELECT COALESCE(jsonb_agg(jsonb_build_array(
        profile.id,profile.home_location_id,profile.updated_at,membership.id,membership.role,
        membership.status,membership.updated_at,account.status,account.updated_at)
        ORDER BY profile.id),'[]'::JSONB)
        FROM public.workforce_profiles profile
        JOIN public.organization_memberships membership
          ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
        JOIN public.users account
          ON account.organization_id=membership.organization_id AND account.id=membership.user_id
       WHERE profile.organization_id=organization_id_value AND profile.id=ANY(member_ids)
    ),
    'skillAuthority',(
      SELECT COALESCE(jsonb_agg(jsonb_build_array(relation.profile_id,skill.id,skill.service_id,
        skill.updated_at) ORDER BY relation.profile_id,skill.service_id,skill.id),'[]'::JSONB)
        FROM public.workforce_profile_skills relation
        JOIN public.workforce_skills skill
          ON skill.organization_id=relation.organization_id AND skill.id=relation.skill_id
       WHERE relation.organization_id=organization_id_value AND relation.profile_id=ANY(member_ids)
    ),
    'availabilityAuthority',(
      SELECT COALESCE(jsonb_agg(jsonb_build_array(authority.workforce_profile_id,authority.id,
        authority.revision,rtrim(authority.canonical_digest),authority.coverage_start,
        authority.coverage_end,authority.updated_at) ORDER BY authority.workforce_profile_id),'[]'::JSONB)
        FROM public.canonical_workforce_availability_authorities authority
       WHERE authority.organization_id=organization_id_value
         AND authority.workforce_profile_id=ANY(member_ids)
    ),
    'availabilityIntervalAuthority',(
      SELECT COALESCE(jsonb_agg(jsonb_build_array(interval.workforce_profile_id,
        interval.availability_id,interval.ordinal,interval.interval_kind,
        interval.starts_at,interval.ends_at)
        ORDER BY interval.workforce_profile_id,interval.ordinal),'[]'::JSONB)
        FROM (
          SELECT authority.workforce_profile_id,source.availability_id,source.ordinal,
                 source.interval_kind,source.starts_at,source.ends_at
            FROM public.canonical_workforce_availability_intervals source
            JOIN public.canonical_workforce_availability_authorities authority
              ON authority.organization_id=source.organization_id AND authority.id=source.availability_id
           WHERE source.organization_id=organization_id_value
             AND authority.workforce_profile_id=ANY(member_ids)
           ORDER BY authority.workforce_profile_id,source.ordinal
           LIMIT 4097
        ) interval
    ),
    -- Part 3 recommendations never authorize a mutation, but their bounded
    -- database authority still has to go stale atomically.  Pin the same
    -- tenant candidate sources that feed the provider-neutral evaluator so a
    -- direct runtime call cannot preserve a recommendation digest after
    -- candidate, crew, skill, availability, or workload evidence changes.
    'recommendationCandidateAuthority',jsonb_build_object(
      'profiles',(
        SELECT COALESCE(jsonb_agg(jsonb_build_array(candidate.id,candidate.display_name,
          candidate.home_location_id,candidate.updated_at,candidate.membership_id,
          candidate.membership_role,candidate.membership_status,candidate.membership_updated_at,
          candidate.user_id,candidate.user_status,candidate.user_updated_at)
          ORDER BY candidate.id),'[]'::JSONB)
          FROM (
            SELECT profile.id,account.name AS display_name,profile.home_location_id,profile.updated_at,
                   membership.id AS membership_id,membership.role AS membership_role,
                   membership.status AS membership_status,membership.updated_at AS membership_updated_at,
                   account.id AS user_id,account.status AS user_status,account.updated_at AS user_updated_at
              FROM public.workforce_profiles profile
              JOIN public.organization_memberships membership
                ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
              JOIN public.users account
                ON account.organization_id=membership.organization_id AND account.id=membership.user_id
             WHERE profile.organization_id=organization_id_value
             ORDER BY profile.id
             LIMIT 21
          ) candidate
      ),
      'crews',(
        SELECT COALESCE(jsonb_agg(jsonb_build_array(candidate.id,candidate.name,
          candidate.home_location_id,candidate.updated_at)
          ORDER BY candidate.id),'[]'::JSONB)
          FROM (
            SELECT crew.id,crew.name,crew.home_location_id,crew.updated_at
              FROM public.workforce_crews crew
             WHERE crew.organization_id=organization_id_value
             ORDER BY crew.id
             LIMIT 21
          ) candidate
      ),
      'crewMembers',(
        SELECT COALESCE(jsonb_agg(jsonb_build_array(candidate.crew_id,candidate.profile_id,
          candidate.crew_role,candidate.created_at) ORDER BY candidate.crew_id,candidate.profile_id),'[]'::JSONB)
          FROM (
            SELECT relation.crew_id,relation.profile_id,relation.crew_role,relation.created_at
              FROM public.workforce_crew_members relation
             WHERE relation.organization_id=organization_id_value
             ORDER BY relation.crew_id,relation.profile_id
             LIMIT 2001
          ) candidate
      ),
      'skills',(
        SELECT COALESCE(jsonb_agg(jsonb_build_array(candidate.profile_id,candidate.skill_id,
          candidate.service_id,candidate.updated_at) ORDER BY candidate.profile_id,candidate.service_id,
          candidate.skill_id),'[]'::JSONB)
          FROM (
            SELECT relation.profile_id,skill.id AS skill_id,skill.service_id,skill.updated_at
              FROM public.workforce_profile_skills relation
              JOIN public.workforce_skills skill
                ON skill.organization_id=relation.organization_id AND skill.id=relation.skill_id
             WHERE relation.organization_id=organization_id_value
             ORDER BY relation.profile_id,skill.service_id,skill.id
             LIMIT 4097
          ) candidate
      ),
      'availability',(
        SELECT COALESCE(jsonb_agg(jsonb_build_array(candidate.workforce_profile_id,candidate.id,
          candidate.revision,rtrim(candidate.canonical_digest),candidate.coverage_start,
          candidate.coverage_end,candidate.updated_at) ORDER BY candidate.workforce_profile_id),'[]'::JSONB)
          FROM (
            SELECT authority.workforce_profile_id,authority.id,authority.revision,
                   authority.canonical_digest,authority.coverage_start,authority.coverage_end,
                   authority.updated_at
              FROM public.canonical_workforce_availability_authorities authority
             WHERE authority.organization_id=organization_id_value
             ORDER BY authority.workforce_profile_id
             LIMIT 21
          ) candidate
      )
    ),
    'scheduleAuthority',(
      SELECT COALESCE(jsonb_agg(jsonb_build_array(candidate.id,candidate.appointment_id,
        candidate.revision,rtrim(candidate.canonical_digest),candidate.target_state,
        candidate.workforce_profile_id,candidate.workforce_crew_id,candidate.schedule_state,
        candidate.dispatch_state,candidate.scheduled_start,candidate.scheduled_end,
        candidate.appointment_status,candidate.updated_at)
        ORDER BY candidate.scheduled_start,candidate.id),'[]'::JSONB)
        FROM (
          SELECT schedule.id,schedule.appointment_id,schedule.revision,schedule.canonical_digest,
                 schedule.target_state,schedule.workforce_profile_id,schedule.workforce_crew_id,
                 schedule.schedule_state,schedule.dispatch_state,schedule.scheduled_start,
                 schedule.scheduled_end,schedule.appointment_status,schedule.updated_at
            FROM public.canonical_schedule_assignments schedule
           WHERE schedule.organization_id=organization_id_value
             AND schedule.id<>assignment_record.id
             AND schedule.schedule_state='scheduled'
             AND schedule.scheduled_start<scheduled_end_value+INTERVAL '48 hours'
             AND schedule.scheduled_end>scheduled_start_value-INTERVAL '48 hours'
           ORDER BY schedule.scheduled_start,schedule.id
           LIMIT 1001
        ) candidate
    ),
    'hardConflicts',hard_value,'warnings',warnings_value,'reviewReasons',reviews_value
  );
  authority_digest_value := encode(sha256(convert_to(
    public.canonical_schedule_part4_stable_json(authority_snapshot),'UTF8')),'hex');
  recommendation_digest_value := encode(sha256(convert_to(
    public.canonical_schedule_part4_stable_json(jsonb_build_object(
      'authorityDigest',authority_digest_value,'mutationGrant',FALSE,'providerCallsAllowed',0,
      'routeEvidence','unavailable_without_separately_authorized_current_durable_evidence')),
    'UTF8')),'hex');
  RETURN jsonb_build_object(
    'status',status_value,'hardConflicts',hard_value,'warnings',warnings_value,
    'needsReview',jsonb_array_length(reviews_value)>0,'reviewReasons',reviews_value,
    'warningDigests',public.canonical_schedule_part4_entry_digests(warnings_value),
    'reviewReasonDigests',public.canonical_schedule_part4_entry_digests(reviews_value),
    'conflictDigest',authority_digest_value,'recommendationDigest',recommendation_digest_value,
    'recommendationAuthorityDigest',authority_digest_value
  );
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
  trusted_hard_conflicts_value JSONB;
  trusted_review_authority_value JSONB;
  approval_decided_at TIMESTAMPTZ;
  normalized_warning_digests_value JSONB;
  normalized_review_reason_digests_value JSONB;
  trusted_request_digest_value TEXT;
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
  PERFORM 1 FROM public.organizations WHERE id=organization_id_value FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical schedule organization is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_actor_unauthorized';
  END IF;
  time_authority := public.canonical_schedule_part4_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,
    csrf_token_value,preview_hint.expected_time_zone
  );
  IF NOT public.canonical_schedule_part4_reason_valid(reason_value)
     OR preview_digest_value !~ '^[0-9a-f]{64}$'
     OR idempotency_key_hash_value !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Mutation approval violates the canonical public contract'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  normalized_warning_digests_value :=
    public.canonical_schedule_part4_normalize_digest_list(acknowledged_warning_digests_value);
  normalized_review_reason_digests_value :=
    public.canonical_schedule_part4_normalize_digest_list(acknowledged_review_reason_digests_value);
  trusted_request_digest_value := public.canonical_schedule_part4_approval_request_digest(
    organization_id_value,appointment_id_value,actor_user_id_value,auth_session_id_value,
    preview_id_value,preview_digest_value,normalized_warning_digests_value,
    normalized_review_reason_digests_value,reason_value,idempotency_key_hash_value
  );
  IF request_digest_value<>trusted_request_digest_value THEN
    RAISE EXCEPTION 'Mutation approval request digest diverges from canonical inputs'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_request_digest_divergent';
  END IF;
  request_digest_value := trusted_request_digest_value;
  acknowledged_warning_digests_value := normalized_warning_digests_value;
  acknowledged_review_reason_digests_value := normalized_review_reason_digests_value;
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
  IF preview_record.action_code NOT IN ('assign','reassign','unassign','schedule','reschedule','dispatch')
     OR preview_record.proposed_appointment_status NOT IN ('preferred','scheduled','cancelled','completed')
     OR NOT public.canonical_schedule_part4_reason_valid(preview_record.reason)
     OR NOT public.canonical_schedule_part4_schedule_contract_valid(
       preview_record.proposed_scheduled_start,preview_record.proposed_scheduled_end,
       preview_record.submitted_schedule,preview_record.expected_time_zone
     )
     OR rtrim(preview_record.request_digest)<>public.canonical_schedule_part4_preview_request_digest(
       preview_record.organization_id,preview_record.appointment_id,preview_record.actor_user_id,
       preview_record.auth_session_id,preview_record.expected_revision,rtrim(preview_record.expected_digest),
       preview_record.expected_time_zone,preview_record.action_code,preview_record.proposed_target_kind,
       preview_record.proposed_target_id,preview_record.proposed_scheduled_start,
       preview_record.proposed_scheduled_end,preview_record.submitted_schedule,
       preview_record.proposed_appointment_status,preview_record.reason
     ) THEN
    RAISE EXCEPTION 'Stored mutation preview violates the canonical public contract'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
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
  trusted_review_authority_value := public.canonical_schedule_part4_review_authority(
    organization_id_value,assignment_record.id,preview_record.proposed_target_kind,
    preview_record.proposed_target_id,preview_record.proposed_scheduled_start,
    preview_record.proposed_scheduled_end,preview_record.expected_time_zone
  );
  trusted_hard_conflicts_value := trusted_review_authority_value->'hardConflicts';
  -- Recheck live actor/session/subscription authority only after every mutation
  -- and conflict row is locked.  The returned evaluatedAt is the durable
  -- approval decision time and is never frozen at transaction start.
  time_authority := public.canonical_schedule_part4_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,
    csrf_token_value,preview_record.expected_time_zone
  );
  approval_decided_at := (time_authority->>'evaluatedAt')::TIMESTAMPTZ;
  IF approval_decided_at>=preview_record.expires_at THEN
    RAISE EXCEPTION 'Mutation preview expired'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_preview_expired';
  END IF;
  IF current_conflict_digest_value<>rtrim(preview_record.conflict_digest)
     OR current_recommendation_authority_digest_value<>rtrim(preview_record.recommendation_authority_digest) THEN
    RAISE EXCEPTION 'Conflict or recommendation authority changed after preview'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  IF jsonb_array_length(trusted_hard_conflicts_value)<>0 THEN
    RAISE EXCEPTION 'Hard conflicts cannot be overridden'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_hard_conflict';
  END IF;
  IF preview_record.conflict_evaluation->'hardConflicts'<>trusted_hard_conflicts_value THEN
    RAISE EXCEPTION 'Trusted conflict authority changed after preview'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  IF preview_record.conflict_evaluation->'warnings'<>trusted_review_authority_value->'warnings'
     OR preview_record.conflict_evaluation->'reviewReasons'<>trusted_review_authority_value->'reviewReasons'
     OR preview_record.conflict_evaluation->>'status'<>trusted_review_authority_value->>'status'
     OR COALESCE((preview_record.conflict_evaluation->>'needsReview')::BOOLEAN,FALSE)
          IS DISTINCT FROM (trusted_review_authority_value->>'needsReview')::BOOLEAN
     OR rtrim(preview_record.conflict_digest)<>trusted_review_authority_value->>'conflictDigest'
     OR preview_record.warning_digests<>trusted_review_authority_value->'warningDigests'
     OR preview_record.review_reason_digests<>trusted_review_authority_value->'reviewReasonDigests'
     OR rtrim(preview_record.recommendation_digest)<>trusted_review_authority_value->>'recommendationDigest'
     OR rtrim(preview_record.recommendation_authority_digest)<>
          trusted_review_authority_value->>'recommendationAuthorityDigest' THEN
    RAISE EXCEPTION 'Trusted review or recommendation authority changed after preview'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
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
    idempotency_key_hash_value,request_digest_value,txid_current(),approval_decided_at
  ) RETURNING * INTO approval_record;
  UPDATE public.canonical_schedule_assignments SET
    workforce_profile_id=workforce_profile_id_value,workforce_crew_id=workforce_crew_id_value,
    target_state=target_state_value,schedule_state=preview_record.proposed_schedule_state,
    dispatch_state=preview_record.proposed_dispatch_state,
    scheduled_start=preview_record.proposed_scheduled_start,scheduled_end=preview_record.proposed_scheduled_end,
    appointment_status=preview_record.proposed_appointment_status,needs_review=needs_review_value,
    review_reasons=review_reasons_value,revision=after_revision_value,canonical_digest=after_digest_value,
    last_approval_id=NULL,last_human_approval_id=approval_record.id,last_actor_user_id=actor_user_id_value,
    last_action_code=preview_record.action_code,last_reason=reason_value,updated_at=approval_decided_at
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
    updated_at=approval_decided_at
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
    txid_current(),approval_decided_at
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
    assignment_record.id,approval_record.id,200,response_body_value,txid_current(),approval_decided_at
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
  evaluated_at TIMESTAMPTZ;
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
  -- Live database wall time is sampled only after the complete authority row
  -- set is locked; a transaction opened before expiry cannot freeze authority.
  evaluated_at := clock_timestamp();
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
    'timeZone',authority.time_zone,
    'evaluatedAt',to_char(evaluated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
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
  created_at_value TIMESTAMPTZ;
  expires_at_value TIMESTAMPTZ;
  preview_digest_value TEXT;
  trusted_request_digest_value TEXT;
  trusted_hard_conflicts_value JSONB;
  trusted_review_authority_value JSONB;
  trusted_conflict_evaluation_value JSONB;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=organization_id_value FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical schedule organization is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_actor_unauthorized';
  END IF;
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
  IF action_code_value NOT IN ('assign','reassign','unassign','schedule','reschedule','dispatch')
     OR appointment_status_value NOT IN ('preferred','scheduled','cancelled','completed')
     OR NOT public.canonical_schedule_part4_reason_valid(reason_value)
     OR NOT public.canonical_schedule_part4_schedule_contract_valid(
       scheduled_start_value,scheduled_end_value,submitted_schedule_value,expected_time_zone_value
     ) THEN
    RAISE EXCEPTION 'Mutation preview violates the canonical public contract'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  IF scheduled_start_value IS NULL THEN
    proposed_schedule_state := 'unscheduled';
  ELSE
    proposed_schedule_state := 'scheduled';
  END IF;
  trusted_request_digest_value := public.canonical_schedule_part4_preview_request_digest(
    organization_id_value,appointment_id_value,actor_user_id_value,auth_session_id_value,
    expected_revision_value,expected_digest_value,expected_time_zone_value,action_code_value,
    target_kind_value,target_id_value,scheduled_start_value,scheduled_end_value,
    submitted_schedule_value,appointment_status_value,reason_value
  );
  IF request_digest_value<>trusted_request_digest_value THEN
    RAISE EXCEPTION 'Mutation preview request digest diverges from canonical inputs'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_request_digest_divergent';
  END IF;
  request_digest_value := trusted_request_digest_value;
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
  trusted_review_authority_value := public.canonical_schedule_part4_review_authority(
    organization_id_value,assignment_record.id,target_kind_value,target_id_value,
    scheduled_start_value,scheduled_end_value,expected_time_zone_value
  );
  trusted_hard_conflicts_value := trusted_review_authority_value->'hardConflicts';
  IF jsonb_typeof(conflict_evaluation_value)<>'object'
     OR conflict_evaluation_value->>'assignmentId'<>assignment_record.id::TEXT
     OR conflict_evaluation_value->>'assignmentRevision'<>assignment_record.revision::TEXT
     OR conflict_evaluation_value->>'assignmentDigest'<>rtrim(assignment_record.canonical_digest)
     OR conflict_evaluation_value->>'appointmentId'<>appointment_id_value::TEXT THEN
    RAISE EXCEPTION 'Conflict preview evidence diverges'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  -- Preview lifetime starts only after all current authority/conflict rows have
  -- been locked and validated; it is exactly fifteen database-clock minutes.
  created_at_value := clock_timestamp();
  expires_at_value := created_at_value+INTERVAL '15 minutes';
  conflict_digest_value := trusted_review_authority_value->>'conflictDigest';
  warning_digests_value := trusted_review_authority_value->'warningDigests';
  review_reason_digests_value := trusted_review_authority_value->'reviewReasonDigests';
  recommendation_digest_value := trusted_review_authority_value->>'recommendationDigest';
  recommendation_authority_digest_value := trusted_review_authority_value->>'recommendationAuthorityDigest';
  trusted_conflict_evaluation_value := jsonb_build_object(
    'id',conflict_digest_value,'assignmentId',assignment_record.id,
    'appointmentId',appointment_id_value,'evaluationVersion','m22-conflict-v1',
    'assignmentRevision',assignment_record.revision,
    'assignmentDigest',rtrim(assignment_record.canonical_digest),
    'proposal',jsonb_build_object(
      'target',jsonb_build_object('kind',target_kind_value,'id',target_id_value),
      'scheduledStart',scheduled_start_value,'scheduledEnd',scheduled_end_value,
      'submittedScheduledStart',submitted_schedule_value->'scheduledStart',
      'submittedScheduledEnd',submitted_schedule_value->'scheduledEnd',
      'timeZone',expected_time_zone_value,'appointmentStatus',appointment_status_value),
    'status',trusted_review_authority_value->>'status',
    'hardConflicts',trusted_hard_conflicts_value,
    'warnings',trusted_review_authority_value->'warnings',
    'needsReview',(trusted_review_authority_value->>'needsReview')::BOOLEAN,
    'reviewReasons',trusted_review_authority_value->'reviewReasons',
    'digest',conflict_digest_value,'evaluatedAt',created_at_value,
    'persisted',FALSE,'grantsMutation',FALSE
  );
  conflict_evaluation_value := trusted_conflict_evaluation_value;
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
       AND rtrim(NEW.request_digest)=public.canonical_schedule_part4_approval_request_digest(
         NEW.organization_id,NEW.appointment_id,NEW.actor_user_id,NEW.auth_session_id,
         NEW.preview_id,rtrim(preview.preview_digest),NEW.acknowledged_warning_digests,
         NEW.acknowledged_review_reason_digests,NEW.reason,rtrim(NEW.idempotency_key_hash)
       )
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
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_reason_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_hard_authority(
  UUID,UUID,TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_stable_json(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_stable_entries(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_normalize_digest_list(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_preview_request_digest(
  UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,
  TIMESTAMPTZ,TIMESTAMPTZ,JSONB,TEXT,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_approval_request_digest(
  UUID,UUID,UUID,UUID,UUID,TEXT,JSONB,JSONB,TEXT,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_schedule_contract_valid(
  TIMESTAMPTZ,TIMESTAMPTZ,JSONB,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_bounded_entries(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_entry_digests(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_unique_local_instant(
  TIMESTAMP WITHOUT TIME ZONE,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_working_hours_authority(
  JSONB,TIMESTAMPTZ,TIMESTAMPTZ,TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_review_authority(
  UUID,UUID,TEXT,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT
) FROM PUBLIC;
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
