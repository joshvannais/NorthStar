-- Mission 23 Part 3: canonical, individually attributable labor/time evidence.
-- Operational evidence only: no payroll, wage, overtime, break-law, billing,
-- pricing, tax, union, geolocation, monitoring-consent, or profitability authority.

CREATE OR REPLACE FUNCTION public.canonical_labor_reason_valid(value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE utf8_value BYTEA; byte_position INTEGER; byte_value INTEGER;
BEGIN
  IF value IS NULL OR value<>btrim(value) OR value<>normalize(value,NFC)
    OR char_length(value) NOT BETWEEN 1 AND 1000 OR octet_length(value)>4000 THEN
    RETURN FALSE;
  END IF;
  utf8_value:=convert_to(value,'UTF8');
  FOR byte_position IN 0..octet_length(utf8_value)-1 LOOP
    byte_value:=get_byte(utf8_value,byte_position);
    IF byte_value BETWEEN 1 AND 8 OR byte_value IN (11,12)
      OR byte_value BETWEEN 14 AND 31 OR byte_value=127 THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_labor_interval_digest(
  interval_id_value UUID, execution_id_value UUID, assignment_id_value UUID,
  performer_profile_id_value UUID, entry_mode_value TEXT, category_value TEXT,
  category_contract_version_value TEXT, category_contract_digest_value TEXT,
  observed_start_value TIMESTAMPTZ, observed_end_value TIMESTAMPTZ,
  observed_start_raw_value TEXT, observed_end_raw_value TEXT,
  business_profile_id_value UUID, business_profile_version_value BIGINT,
  business_profile_hash_value TEXT, time_zone_value TEXT, review_state_value TEXT,
  source_execution_revision_value BIGINT, source_execution_digest_value TEXT,
  source_assignment_revision_value BIGINT, source_assignment_digest_value TEXT,
  revision_value BIGINT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'assignmentDigest',source_assignment_digest_value,
    'assignmentId',assignment_id_value,
    'assignmentRevision',source_assignment_revision_value,
    'businessProfileHash',business_profile_hash_value,
    'businessProfileId',business_profile_id_value,
    'businessProfileVersion',business_profile_version_value,
    'category',category_value,
    'categoryContractDigest',category_contract_digest_value,
    'categoryContractVersion',category_contract_version_value,
    'entryMode',entry_mode_value,
    'executionDigest',source_execution_digest_value,
    'executionId',execution_id_value,
    'executionRevision',source_execution_revision_value,
    'intervalId',interval_id_value,
    'observedEnd',CASE WHEN observed_end_value IS NULL THEN NULL ELSE
      to_char(observed_end_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'observedEndRaw',observed_end_raw_value,
    'observedStart',to_char(observed_start_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'observedStartRaw',observed_start_raw_value,
    'performerProfileId',performer_profile_id_value,
    'reviewState',review_state_value,
    'revision',revision_value,
    'timeZone',time_zone_value
  )::TEXT,'UTF8')),'hex')
$function$;

CREATE TABLE public.canonical_labor_intervals (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  entry_mode VARCHAR(16) NOT NULL,
  category_code VARCHAR(24) NOT NULL,
  category_contract_version VARCHAR(64) NOT NULL,
  category_contract_digest CHAR(64) NOT NULL,
  observed_start TIMESTAMPTZ NOT NULL,
  observed_end TIMESTAMPTZ,
  observed_start_raw VARCHAR(64) NOT NULL,
  observed_end_raw VARCHAR(64),
  business_profile_id UUID NOT NULL,
  business_profile_version BIGINT NOT NULL,
  business_profile_hash CHAR(64) NOT NULL,
  time_zone VARCHAR(255) NOT NULL,
  review_state VARCHAR(24) NOT NULL,
  source_execution_revision BIGINT NOT NULL,
  source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  revision BIGINT NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  last_event_id UUID NOT NULL,
  last_recorded_by_user_id UUID NOT NULL,
  last_action_code VARCHAR(24) NOT NULL,
  last_reason TEXT NOT NULL,
  last_transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_labor_intervals_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_labor_intervals_execution_fk FOREIGN KEY(organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_intervals_assignment_fk FOREIGN KEY(organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_intervals_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_intervals_profile_fk FOREIGN KEY(organization_id,business_profile_id)
    REFERENCES public.canonical_business_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_intervals_recorder_fk FOREIGN KEY(organization_id,last_recorded_by_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_intervals_mode_check CHECK(entry_mode IN ('timer','manual')),
  CONSTRAINT canonical_labor_intervals_category_check CHECK(category_code IN
    ('break','cleanup','other','production','setup','travel')),
  CONSTRAINT canonical_labor_intervals_category_contract_check CHECK(
    category_contract_version='m23-labor-category-v1' AND
    rtrim(category_contract_digest)='298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738'),
  CONSTRAINT canonical_labor_intervals_time_check CHECK(
    observed_end IS NULL OR (observed_end>observed_start AND
      (entry_mode='timer' OR observed_end-observed_start<=INTERVAL '31 days'))),
  CONSTRAINT canonical_labor_intervals_raw_check CHECK(
    observed_start_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    AND (observed_end_raw IS NULL OR observed_end_raw ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$')),
  CONSTRAINT canonical_labor_intervals_review_check CHECK(review_state IN
    ('unreviewed','needs_review','accepted','rejected')),
  CONSTRAINT canonical_labor_intervals_version_check CHECK(
    business_profile_version>=1 AND source_execution_revision>=1 AND
    source_assignment_revision>=1 AND revision>=1),
  CONSTRAINT canonical_labor_intervals_digest_check CHECK(
    category_contract_digest ~ '^[0-9a-f]{64}$' AND business_profile_hash ~ '^[0-9a-f]{64}$'
    AND source_execution_digest ~ '^[0-9a-f]{64}$'
    AND source_assignment_digest ~ '^[0-9a-f]{64}$' AND canonical_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_labor_intervals_action_check CHECK(last_action_code IN
    ('start_timer','stop_timer','record_manual','correct','review')),
  CONSTRAINT canonical_labor_intervals_reason_check CHECK(public.canonical_labor_reason_valid(last_reason))
);

CREATE UNIQUE INDEX canonical_labor_one_open_timer
  ON public.canonical_labor_intervals(organization_id,performer_profile_id)
  WHERE entry_mode='timer' AND observed_end IS NULL AND review_state<>'rejected';
CREATE INDEX canonical_labor_execution_history
  ON public.canonical_labor_intervals(organization_id,execution_id,observed_start DESC,id);
CREATE INDEX canonical_labor_performer_range
  ON public.canonical_labor_intervals(organization_id,performer_profile_id,observed_start,observed_end,id)
  WHERE review_state<>'rejected';

CREATE TABLE public.canonical_labor_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  interval_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  auth_session_id UUID NOT NULL,
  action_code VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64),
  after_digest CHAR(64) NOT NULL,
  source_execution_revision BIGINT NOT NULL,
  source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_labor_events_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_labor_events_revision_unique UNIQUE(organization_id,interval_id,after_revision),
  CONSTRAINT canonical_labor_events_interval_fk FOREIGN KEY(organization_id,interval_id)
    REFERENCES public.canonical_labor_intervals(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_labor_events_execution_fk FOREIGN KEY(organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_events_assignment_fk FOREIGN KEY(organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_events_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_events_session_fk FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
    REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_events_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_events_action_check CHECK(action_code IN
    ('start_timer','stop_timer','record_manual','correct','review')),
  CONSTRAINT canonical_labor_events_revision_check CHECK(
    (action_code IN ('start_timer','record_manual') AND before_revision=0 AND after_revision=1 AND before_digest IS NULL)
    OR (action_code IN ('stop_timer','correct','review') AND before_revision>=1
      AND after_revision=before_revision+1 AND before_digest IS NOT NULL)),
  CONSTRAINT canonical_labor_events_reason_check CHECK(public.canonical_labor_reason_valid(reason)),
  CONSTRAINT canonical_labor_events_digest_check CHECK(
    (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$') AND after_digest ~ '^[0-9a-f]{64}$'
    AND source_execution_digest ~ '^[0-9a-f]{64}$' AND source_assignment_digest ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$' AND idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_labor_events_correlation_check CHECK(request_correlation_id ~ '^[ -~]{1,128}$')
);

ALTER TABLE public.canonical_labor_intervals ADD CONSTRAINT canonical_labor_intervals_last_event_fk
  FOREIGN KEY(organization_id,last_event_id) REFERENCES public.canonical_labor_events(organization_id,id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.canonical_labor_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  interval_id UUID NOT NULL,
  event_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  actor_user_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  action_code VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_labor_revisions_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_labor_revisions_number_unique UNIQUE(organization_id,interval_id,revision),
  CONSTRAINT canonical_labor_revisions_interval_fk FOREIGN KEY(organization_id,interval_id)
    REFERENCES public.canonical_labor_intervals(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_revisions_event_fk FOREIGN KEY(organization_id,event_id)
    REFERENCES public.canonical_labor_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_revisions_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_revisions_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_revisions_shape_check CHECK(jsonb_typeof(snapshot)='object' AND revision>=1),
  CONSTRAINT canonical_labor_revisions_digest_check CHECK(snapshot_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_labor_revisions_reason_check CHECK(public.canonical_labor_reason_valid(reason))
);

CREATE TABLE public.canonical_labor_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  interval_id UUID NOT NULL,
  event_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  action_code VARCHAR(24) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64),
  after_digest CHAR(64) NOT NULL,
  authority_evidence JSONB NOT NULL,
  request_digest CHAR(64) NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_labor_audit_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_labor_audit_event_unique UNIQUE(organization_id,event_id),
  CONSTRAINT canonical_labor_audit_interval_fk FOREIGN KEY(organization_id,interval_id)
    REFERENCES public.canonical_labor_intervals(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_audit_event_fk FOREIGN KEY(organization_id,event_id)
    REFERENCES public.canonical_labor_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_audit_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_audit_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_audit_shape_check CHECK(jsonb_typeof(authority_evidence)='object'),
  CONSTRAINT canonical_labor_audit_digest_check CHECK(
    (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$') AND after_digest ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_labor_audit_reason_check CHECK(public.canonical_labor_reason_valid(reason))
);

CREATE TABLE public.canonical_labor_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  action_code VARCHAR(24) NOT NULL,
  execution_id UUID NOT NULL,
  interval_id UUID NOT NULL,
  event_id UUID NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_labor_idempotency_primary PRIMARY KEY(organization_id,actor_user_id,idempotency_key_hash),
  CONSTRAINT canonical_labor_idempotency_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_idempotency_interval_fk FOREIGN KEY(organization_id,interval_id)
    REFERENCES public.canonical_labor_intervals(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_idempotency_event_fk FOREIGN KEY(organization_id,event_id)
    REFERENCES public.canonical_labor_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_labor_idempotency_digest_check CHECK(
    idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_labor_idempotency_response_check CHECK(response_status BETWEEN 200 AND 299
    AND jsonb_typeof(response_body)='object')
);

CREATE OR REPLACE FUNCTION public.canonical_labor_immutable_evidence()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'Canonical labor evidence is immutable'
    USING ERRCODE='23514',CONSTRAINT='canonical_labor_evidence_immutable';
END $function$;

CREATE TRIGGER canonical_labor_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_labor_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_labor_immutable_evidence();
CREATE TRIGGER canonical_labor_revisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_labor_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_labor_immutable_evidence();
CREATE TRIGGER canonical_labor_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_labor_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_labor_immutable_evidence();
CREATE TRIGGER canonical_labor_idempotency_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_labor_idempotency FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_labor_immutable_evidence();

CREATE OR REPLACE FUNCTION public.canonical_labor_projection(interval_record public.canonical_labor_intervals)
RETURNS JSONB LANGUAGE SQL STABLE
SET search_path=pg_catalog,public,pg_temp AS $function$
  SELECT jsonb_build_object(
    'id',interval_record.id,'executionId',interval_record.execution_id,
    'assignmentId',interval_record.assignment_id,'performedByProfileId',interval_record.performer_profile_id,
    'entryMode',interval_record.entry_mode,'category',interval_record.category_code,
    'categoryContractVersion',interval_record.category_contract_version,
    'categoryContractDigest',rtrim(interval_record.category_contract_digest),
    'observedStart',to_char(interval_record.observed_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'observedEnd',CASE WHEN interval_record.observed_end IS NULL THEN NULL ELSE
      to_char(interval_record.observed_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'observedStartRaw',interval_record.observed_start_raw,'observedEndRaw',interval_record.observed_end_raw,
    'displayStart',to_char(interval_record.observed_start AT TIME ZONE interval_record.time_zone,'YYYY-MM-DD HH24:MI:SS.US'),
    'displayEnd',CASE WHEN interval_record.observed_end IS NULL THEN NULL ELSE
      to_char(interval_record.observed_end AT TIME ZONE interval_record.time_zone,'YYYY-MM-DD HH24:MI:SS.US') END,
    'durationSeconds',CASE WHEN interval_record.observed_end IS NULL THEN NULL ELSE
      floor(extract(epoch FROM interval_record.observed_end-interval_record.observed_start))::BIGINT END,
    'timeZoneAuthority',jsonb_build_object('businessProfileId',interval_record.business_profile_id,
      'businessProfileVersion',interval_record.business_profile_version,
      'businessProfileHash',rtrim(interval_record.business_profile_hash),'timeZone',interval_record.time_zone),
    'reviewState',interval_record.review_state,
    'sourceExecutionRevision',interval_record.source_execution_revision,
    'sourceExecutionDigest',rtrim(interval_record.source_execution_digest),
    'sourceAssignmentRevision',interval_record.source_assignment_revision,
    'sourceAssignmentDigest',rtrim(interval_record.source_assignment_digest),
    'revision',interval_record.revision,'digest',rtrim(interval_record.canonical_digest),
    'recordedByUserId',interval_record.last_recorded_by_user_id,
    'lastAction',interval_record.last_action_code,'lastReason',interval_record.last_reason,
    'createdAt',to_char(interval_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updatedAt',to_char(interval_record.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
$function$;

CREATE OR REPLACE FUNCTION public.canonical_labor_guard_current()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE expected TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Canonical labor state cannot be deleted'
    USING ERRCODE='23514',CONSTRAINT='canonical_labor_delete_forbidden'; END IF;
  expected:=public.canonical_labor_interval_digest(NEW.id,NEW.execution_id,NEW.assignment_id,
    NEW.performer_profile_id,NEW.entry_mode,NEW.category_code,NEW.category_contract_version,
    rtrim(NEW.category_contract_digest),NEW.observed_start,NEW.observed_end,NEW.observed_start_raw,
    NEW.observed_end_raw,NEW.business_profile_id,NEW.business_profile_version,
    rtrim(NEW.business_profile_hash),NEW.time_zone,NEW.review_state,NEW.source_execution_revision,
    rtrim(NEW.source_execution_digest),NEW.source_assignment_revision,rtrim(NEW.source_assignment_digest),NEW.revision);
  IF rtrim(NEW.canonical_digest)<>expected OR NEW.last_transaction_id<>txid_current()::BIGINT THEN
    RAISE EXCEPTION 'Canonical labor digest is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_digest_invalid'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.last_action_code NOT IN ('start_timer','record_manual') THEN
      RAISE EXCEPTION 'Canonical labor initial state is invalid'
        USING ERRCODE='23514',CONSTRAINT='canonical_labor_initial_invalid'; END IF;
  ELSE
    IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id OR NEW.execution_id<>OLD.execution_id
      OR NEW.assignment_id<>OLD.assignment_id OR NEW.performer_profile_id<>OLD.performer_profile_id
      OR NEW.entry_mode<>OLD.entry_mode OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'Canonical labor identity is immutable'
        USING ERRCODE='23514',CONSTRAINT='canonical_labor_identity_immutable'; END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER canonical_labor_guard BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_labor_intervals
  FOR EACH ROW EXECUTE FUNCTION public.canonical_labor_guard_current();

CREATE OR REPLACE FUNCTION public.canonical_labor_validate_complete()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.canonical_labor_events event
    WHERE event.organization_id=NEW.organization_id AND event.id=NEW.last_event_id
      AND event.interval_id=NEW.id AND event.execution_id=NEW.execution_id
      AND event.assignment_id=NEW.assignment_id AND event.performer_profile_id=NEW.performer_profile_id
      AND event.after_revision=NEW.revision AND rtrim(event.after_digest)=rtrim(NEW.canonical_digest)
      AND event.action_code=NEW.last_action_code
      AND event.source_execution_revision=NEW.source_execution_revision
      AND rtrim(event.source_execution_digest)=rtrim(NEW.source_execution_digest)
      AND event.source_assignment_revision=NEW.source_assignment_revision
      AND rtrim(event.source_assignment_digest)=rtrim(NEW.source_assignment_digest))
    OR NOT EXISTS(SELECT 1 FROM public.canonical_labor_revisions revision
      WHERE revision.organization_id=NEW.organization_id AND revision.interval_id=NEW.id
        AND revision.event_id=NEW.last_event_id AND revision.revision=NEW.revision
        AND rtrim(revision.snapshot_digest)=rtrim(NEW.canonical_digest)
        AND revision.snapshot=public.canonical_labor_projection(NEW))
    OR NOT EXISTS(SELECT 1 FROM public.canonical_labor_audit_events audit
      WHERE audit.organization_id=NEW.organization_id AND audit.interval_id=NEW.id
        AND audit.event_id=NEW.last_event_id AND audit.execution_id=NEW.execution_id
        AND audit.after_revision=NEW.revision AND rtrim(audit.after_digest)=rtrim(NEW.canonical_digest))
    OR NOT EXISTS(SELECT 1 FROM public.canonical_labor_idempotency replay
      WHERE replay.organization_id=NEW.organization_id AND replay.interval_id=NEW.id
        AND replay.event_id=NEW.last_event_id AND replay.execution_id=NEW.execution_id) THEN
    RAISE EXCEPTION 'Canonical labor evidence set is incomplete'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_evidence_incomplete';
  END IF;
  RETURN NULL;
END $function$;
CREATE CONSTRAINT TRIGGER canonical_labor_complete_after_current
  AFTER INSERT OR UPDATE ON public.canonical_labor_intervals DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_labor_validate_complete();

CREATE OR REPLACE FUNCTION public.canonical_labor_request_digest(
  organization_id_value UUID, actor_user_id_value UUID, auth_session_id_value UUID,
  execution_id_value UUID, action_value TEXT, performer_profile_id_value UUID,
  category_value TEXT, execution_revision_value BIGINT, execution_digest_value TEXT,
  assignment_revision_value BIGINT, assignment_digest_value TEXT, business_profile_id_value UUID,
  business_profile_version_value BIGINT, business_profile_hash_value TEXT, time_zone_value TEXT,
  observed_start_raw_value TEXT, observed_end_raw_value TEXT, interval_id_value UUID,
  interval_revision_value BIGINT, interval_digest_value TEXT, review_outcome_value TEXT,
  idempotency_key_hash_value TEXT, reason_value TEXT
)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $function$
 SELECT encode(sha256(convert_to(jsonb_build_object(
   'action',action_value,'actorUserId',actor_user_id_value,'assignmentDigest',assignment_digest_value,
   'assignmentRevision',assignment_revision_value,'authSessionId',auth_session_id_value,
   'businessProfileHash',business_profile_hash_value,'businessProfileId',business_profile_id_value,
   'businessProfileVersion',business_profile_version_value,'category',category_value,
   'executionDigest',execution_digest_value,'executionId',execution_id_value,
   'executionRevision',execution_revision_value,'idempotencyKeyHash',idempotency_key_hash_value,
   'intervalDigest',interval_digest_value,'intervalId',interval_id_value,
   'intervalRevision',interval_revision_value,'observedEndRaw',observed_end_raw_value,
   'observedStartRaw',observed_start_raw_value,'organizationId',organization_id_value,
   'performerProfileId',performer_profile_id_value,'reason',reason_value,
   'reviewOutcome',review_outcome_value,'timeZone',time_zone_value)::TEXT,'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION public.canonical_labor_time_mutate(
  organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
  auth_session_id_value UUID, csrf_token_value TEXT, execution_id_value UUID,
  action_value TEXT, performer_profile_id_value UUID, category_value TEXT,
  category_contract_version_value TEXT, category_contract_digest_value TEXT,
  expected_execution_revision_value BIGINT, expected_execution_digest_value TEXT,
  expected_assignment_revision_value BIGINT, expected_assignment_digest_value TEXT,
  business_profile_id_value UUID, business_profile_version_value BIGINT,
  business_profile_hash_value TEXT, time_zone_value TEXT, observed_start_raw_value TEXT,
  observed_end_raw_value TEXT, interval_id_value UUID, expected_interval_revision_value BIGINT,
  expected_interval_digest_value TEXT, review_outcome_value TEXT, idempotency_key_value TEXT,
  reason_value TEXT, request_correlation_id_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE
  authority JSONB; actor_profile_id UUID;
  execution_record public.canonical_field_executions%ROWTYPE;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  profile_record public.canonical_business_profiles%ROWTYPE;
  interval_record public.canonical_labor_intervals%ROWTYPE; replay_record public.canonical_labor_idempotency%ROWTYPE;
  event_id_value UUID; actual_interval_id UUID; before_revision_value BIGINT:=0;
  before_digest_value TEXT; after_revision_value BIGINT; after_digest_value TEXT;
  observed_start_value TIMESTAMPTZ; observed_end_value TIMESTAMPTZ;
  entry_mode_value TEXT; review_state_value TEXT; request_digest_value TEXT;
  idempotency_hash_value TEXT; response_body_value JSONB; snapshot_value JSONB;
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' THEN
    RAISE EXCEPTION 'Canonical labor mutations require serializable isolation'
      USING ERRCODE='25001',CONSTRAINT='canonical_labor_serializable_required'; END IF;
  IF organization_id_value IS NULL OR actor_user_id_value IS NULL OR auth_session_id_value IS NULL
    OR execution_id_value IS NULL OR performer_profile_id_value IS NULL OR business_profile_id_value IS NULL
    OR action_value IS NULL OR action_value NOT IN ('start_timer','stop_timer','record_manual','correct','review')
    OR category_contract_version_value IS NULL OR category_contract_digest_value IS NULL
    OR expected_execution_revision_value<1 OR expected_execution_digest_value !~ '^[0-9a-f]{64}$'
    OR expected_assignment_revision_value<1 OR expected_assignment_digest_value !~ '^[0-9a-f]{64}$'
    OR business_profile_version_value<1 OR business_profile_hash_value !~ '^[0-9a-f]{64}$'
    OR time_zone_value IS NULL OR time_zone_value<>btrim(time_zone_value) OR length(time_zone_value)>255
    OR idempotency_key_value IS NULL OR idempotency_key_value<>btrim(idempotency_key_value)
    OR idempotency_key_value !~ '^[!-~]{16,128}$' OR NOT public.canonical_labor_reason_valid(reason_value)
    OR request_correlation_id_value !~ '^[ -~]{1,128}$' THEN
    RAISE EXCEPTION 'Canonical labor input is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_input_invalid'; END IF;
  IF category_contract_version_value<>'m23-labor-category-v1'
    OR category_contract_digest_value<>'298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738' THEN
    RAISE EXCEPTION 'Canonical labor category authority is stale'
      USING ERRCODE='40001',CONSTRAINT='canonical_labor_category_stale'; END IF;
  IF (action_value IN ('start_timer','record_manual','correct') AND category_value NOT IN
      ('break','cleanup','other','production','setup','travel'))
    OR (action_value IN ('stop_timer','review') AND category_value IS NOT NULL)
    OR (action_value IN ('stop_timer','correct','review') AND
      (interval_id_value IS NULL OR expected_interval_revision_value<1 OR expected_interval_digest_value !~ '^[0-9a-f]{64}$'))
    OR (action_value IN ('start_timer','record_manual') AND
      (interval_id_value IS NOT NULL OR expected_interval_revision_value IS NOT NULL OR expected_interval_digest_value IS NOT NULL))
    OR (action_value IN ('record_manual','correct') AND
      (observed_start_raw_value IS NULL OR observed_end_raw_value IS NULL))
    OR (action_value NOT IN ('record_manual','correct') AND
      (observed_start_raw_value IS NOT NULL OR observed_end_raw_value IS NOT NULL))
    OR (action_value='review' AND review_outcome_value NOT IN ('accepted','rejected'))
    OR (action_value<>'review' AND review_outcome_value IS NOT NULL) THEN
    RAISE EXCEPTION 'Canonical labor action input is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_input_invalid'; END IF;

  authority:=public.canonical_field_execution_actor_authority(organization_id_value,actor_user_id_value,
    actor_access_role_value,auth_session_id_value,csrf_token_value,TRUE);
  actor_profile_id:=(authority->>'profileId')::UUID;
  SELECT execution.* INTO execution_record FROM public.canonical_field_executions execution
    JOIN public.canonical_transcripts transcript ON transcript.organization_id=execution.organization_id
      AND transcript.operation_id=execution.operation_id AND transcript.graph_id=execution.graph_id
   WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value
     AND transcript.source NOT IN ('simulation','demo') FOR UPDATE OF execution;
  IF NOT FOUND THEN RAISE EXCEPTION 'Field execution not found'
    USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found'; END IF;
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments assignment
   WHERE assignment.organization_id=organization_id_value AND assignment.id=execution_record.assignment_id
   FOR SHARE;
  IF NOT FOUND OR assignment_record.target_state<>'assigned' OR assignment_record.dispatch_state<>'dispatched'
    OR lower(btrim(assignment_record.appointment_status)) IN ('cancelled','completed') THEN
    RAISE EXCEPTION 'Current dispatched assignment is required'
      USING ERRCODE='42501',CONSTRAINT='canonical_labor_dispatch_required'; END IF;
  IF action_value IN ('start_timer','record_manual') AND execution_record.lifecycle_state<>'in_progress' THEN
    RAISE EXCEPTION 'Labor recording requires an in-progress field execution'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_action_invalid'; END IF;
  IF execution_record.revision<>expected_execution_revision_value
    OR rtrim(execution_record.canonical_digest)<>expected_execution_digest_value
    OR assignment_record.revision<>expected_assignment_revision_value
    OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest_value THEN
    RAISE EXCEPTION 'Canonical labor source pins are stale'
      USING ERRCODE='40001',CONSTRAINT='canonical_labor_stale_source'; END IF;
  IF NOT public.canonical_field_execution_actor_in_scope(organization_id_value,actor_access_role_value,
    actor_profile_id,assignment_record) THEN RAISE EXCEPTION 'Actor scope unavailable'
    USING ERRCODE='42501',CONSTRAINT='canonical_labor_actor_scope_forbidden'; END IF;
  IF actor_access_role_value='member' AND performer_profile_id_value<>actor_profile_id THEN
    RAISE EXCEPTION 'Members may only record their own labor evidence'
      USING ERRCODE='42501',CONSTRAINT='canonical_labor_performer_forged'; END IF;
  IF NOT (assignment_record.workforce_profile_id=performer_profile_id_value OR
    (assignment_record.workforce_crew_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.workforce_crew_members cm JOIN public.workforce_profiles wp
        ON wp.organization_id=cm.organization_id AND wp.id=cm.profile_id
      JOIN public.organization_memberships om ON om.organization_id=wp.organization_id AND om.id=wp.membership_id
      JOIN public.users u ON u.organization_id=om.organization_id AND u.id=om.user_id
      WHERE cm.organization_id=organization_id_value AND cm.crew_id=assignment_record.workforce_crew_id
        AND cm.profile_id=performer_profile_id_value AND om.status='active' AND u.status='active'))) THEN
    RAISE EXCEPTION 'Performer is outside the current assignment'
      USING ERRCODE='42501',CONSTRAINT='canonical_labor_performer_scope_forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles wp
    JOIN public.organization_memberships om ON om.organization_id=wp.organization_id AND om.id=wp.membership_id
    JOIN public.users u ON u.organization_id=om.organization_id AND u.id=om.user_id
    WHERE wp.organization_id=organization_id_value AND wp.id=performer_profile_id_value
      AND om.status='active' AND u.status='active') THEN
    RAISE EXCEPTION 'Performer authority is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_labor_performer_scope_forbidden'; END IF;

  SELECT * INTO profile_record FROM public.canonical_business_profiles bp
   WHERE bp.organization_id=organization_id_value AND bp.id=business_profile_id_value
     AND bp.version_number=business_profile_version_value
     AND rtrim(bp.normalized_profile_hash)=business_profile_hash_value AND bp.is_active
     AND bp.raw_profile#>>'{company,timeZone}'=time_zone_value FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=time_zone_value) THEN
    RAISE EXCEPTION 'Canonical labor time-zone authority is stale'
      USING ERRCODE='40001',CONSTRAINT='canonical_labor_time_authority_stale'; END IF;

  idempotency_hash_value:=encode(sha256(convert_to(idempotency_key_value,'UTF8')),'hex');
  request_digest_value:=public.canonical_labor_request_digest(organization_id_value,actor_user_id_value,
    auth_session_id_value,execution_id_value,action_value,performer_profile_id_value,category_value,
    expected_execution_revision_value,expected_execution_digest_value,expected_assignment_revision_value,
    expected_assignment_digest_value,business_profile_id_value,business_profile_version_value,
    business_profile_hash_value,time_zone_value,observed_start_raw_value,observed_end_raw_value,
    interval_id_value,expected_interval_revision_value,expected_interval_digest_value,review_outcome_value,
    idempotency_hash_value,reason_value);
  PERFORM pg_advisory_xact_lock(hashtextextended(organization_id_value::TEXT||':'||actor_user_id_value::TEXT||':'||idempotency_hash_value,0));
  SELECT * INTO replay_record FROM public.canonical_labor_idempotency replay
   WHERE replay.organization_id=organization_id_value AND replay.actor_user_id=actor_user_id_value
     AND rtrim(replay.idempotency_key_hash)=idempotency_hash_value;
  IF FOUND THEN
    IF rtrim(replay_record.request_digest)<>request_digest_value OR replay_record.action_code<>action_value
      OR replay_record.execution_id<>execution_id_value THEN RAISE EXCEPTION 'Labor idempotency conflict'
      USING ERRCODE='23505',CONSTRAINT='canonical_labor_idempotency_conflict'; END IF;
    IF NOT public.canonical_field_execution_replay_authorized(organization_id_value,actor_access_role_value,
      actor_profile_id,execution_id_value,NULL) THEN RAISE EXCEPTION 'Labor replay authority unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_labor_replay_unauthorized'; END IF;
    RETURN jsonb_build_object('status',replay_record.response_status,'body',replay_record.response_body,'replayed',TRUE);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(organization_id_value::TEXT||':'||performer_profile_id_value::TEXT,1));
  actual_interval_id:=COALESCE(interval_id_value,gen_random_uuid());
  IF action_value IN ('stop_timer','correct','review') THEN
    SELECT * INTO interval_record FROM public.canonical_labor_intervals current_interval
     WHERE current_interval.organization_id=organization_id_value AND current_interval.id=interval_id_value FOR UPDATE;
    IF NOT FOUND OR interval_record.execution_id<>execution_id_value THEN RAISE EXCEPTION 'Labor interval not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_labor_interval_not_found'; END IF;
    IF interval_record.performer_profile_id<>performer_profile_id_value THEN RAISE EXCEPTION 'Forged performer'
      USING ERRCODE='42501',CONSTRAINT='canonical_labor_performer_forged'; END IF;
    IF interval_record.revision<>expected_interval_revision_value
      OR rtrim(interval_record.canonical_digest)<>expected_interval_digest_value THEN
      RAISE EXCEPTION 'Labor interval is stale' USING ERRCODE='40001',CONSTRAINT='canonical_labor_stale_interval'; END IF;
    before_revision_value:=interval_record.revision; before_digest_value:=rtrim(interval_record.canonical_digest);
  END IF;

  IF action_value='start_timer' THEN
    IF execution_record.lifecycle_state<>'in_progress' THEN RAISE EXCEPTION 'Timer requires in-progress execution'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_action_invalid'; END IF;
    IF EXISTS(SELECT 1 FROM public.canonical_labor_intervals li WHERE li.organization_id=organization_id_value
      AND li.performer_profile_id=performer_profile_id_value AND li.observed_end IS NULL AND li.review_state<>'rejected') THEN
      RAISE EXCEPTION 'Timer already open' USING ERRCODE='23505',CONSTRAINT='canonical_labor_timer_open'; END IF;
    observed_start_value:=transaction_timestamp(); observed_start_raw_value:=to_char(observed_start_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    observed_end_value:=NULL; observed_end_raw_value:=NULL; entry_mode_value:='timer'; review_state_value:='unreviewed';
  ELSIF action_value='stop_timer' THEN
    IF interval_record.entry_mode<>'timer' OR interval_record.observed_end IS NOT NULL THEN RAISE EXCEPTION 'Timer not open'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_timer_not_open'; END IF;
    observed_start_value:=interval_record.observed_start; observed_start_raw_value:=interval_record.observed_start_raw;
    observed_end_value:=transaction_timestamp(); observed_end_raw_value:=to_char(observed_end_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    entry_mode_value:='timer'; category_value:=interval_record.category_code;
    review_state_value:=CASE WHEN observed_end_value-observed_start_value>INTERVAL '16 hours' THEN 'needs_review' ELSE 'unreviewed' END;
  ELSIF action_value IN ('record_manual','correct') THEN
    BEGIN observed_start_value:=observed_start_raw_value::TIMESTAMPTZ; observed_end_value:=observed_end_raw_value::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Labor instant is invalid'
      USING ERRCODE='22007',CONSTRAINT='canonical_labor_instant_invalid'; END;
    IF observed_end_value<=observed_start_value OR observed_end_value-observed_start_value>INTERVAL '31 days'
      OR observed_start_value>transaction_timestamp()+INTERVAL '5 minutes'
      OR (observed_start_value AT TIME ZONE time_zone_value)<>
        replace(substring(observed_start_raw_value FROM '^(.+)(Z|[+-][0-9]{2}:[0-9]{2})$'),'T',' ')::TIMESTAMP
      OR (observed_end_value AT TIME ZONE time_zone_value)<>
        replace(substring(observed_end_raw_value FROM '^(.+)(Z|[+-][0-9]{2}:[0-9]{2})$'),'T',' ')::TIMESTAMP THEN
      RAISE EXCEPTION 'Labor instant or tenant-zone offset is invalid'
        USING ERRCODE='22007',CONSTRAINT='canonical_labor_instant_invalid'; END IF;
    entry_mode_value:=CASE WHEN action_value='record_manual' THEN 'manual' ELSE interval_record.entry_mode END;
    review_state_value:=CASE
      WHEN actor_profile_id<>performer_profile_id_value OR observed_end_value-observed_start_value>INTERVAL '16 hours'
      THEN 'needs_review' ELSE 'unreviewed' END;
  ELSE
    observed_start_value:=interval_record.observed_start; observed_end_value:=interval_record.observed_end;
    observed_start_raw_value:=interval_record.observed_start_raw; observed_end_raw_value:=interval_record.observed_end_raw;
    entry_mode_value:=interval_record.entry_mode; category_value:=interval_record.category_code;
    IF interval_record.observed_end IS NULL THEN RAISE EXCEPTION 'Open timers cannot be reviewed'
      USING ERRCODE='23514',CONSTRAINT='canonical_labor_action_invalid'; END IF;
    IF actor_access_role_value='member' AND actor_profile_id<>performer_profile_id_value THEN
      RAISE EXCEPTION 'Review authority unavailable' USING ERRCODE='42501',CONSTRAINT='canonical_labor_review_forbidden'; END IF;
    review_state_value:=review_outcome_value;
  END IF;

  IF action_value IN ('start_timer','record_manual','correct') AND EXISTS(
    SELECT 1 FROM public.canonical_labor_intervals li
     WHERE li.organization_id=organization_id_value AND li.performer_profile_id=performer_profile_id_value
       AND li.id<>actual_interval_id AND li.review_state<>'rejected'
       AND tstzrange(li.observed_start,li.observed_end,'[)') && tstzrange(observed_start_value,observed_end_value,'[)')) THEN
    RAISE EXCEPTION 'Labor intervals overlap' USING ERRCODE='23P01',CONSTRAINT='canonical_labor_overlap'; END IF;

  event_id_value:=gen_random_uuid(); after_revision_value:=before_revision_value+1;
  after_digest_value:=public.canonical_labor_interval_digest(actual_interval_id,execution_id_value,
    assignment_record.id,performer_profile_id_value,entry_mode_value,category_value,
    category_contract_version_value,category_contract_digest_value,observed_start_value,observed_end_value,
    observed_start_raw_value,observed_end_raw_value,business_profile_id_value,business_profile_version_value,
    business_profile_hash_value,time_zone_value,review_state_value,execution_record.revision,
    rtrim(execution_record.canonical_digest),assignment_record.revision,rtrim(assignment_record.canonical_digest),after_revision_value);
  IF action_value IN ('start_timer','record_manual') THEN
    INSERT INTO public.canonical_labor_intervals(id,organization_id,execution_id,assignment_id,
      performer_profile_id,entry_mode,category_code,category_contract_version,category_contract_digest,
      observed_start,observed_end,observed_start_raw,observed_end_raw,business_profile_id,
      business_profile_version,business_profile_hash,time_zone,review_state,source_execution_revision,
      source_execution_digest,source_assignment_revision,source_assignment_digest,revision,canonical_digest,
      last_event_id,last_recorded_by_user_id,last_action_code,last_reason)
    VALUES(actual_interval_id,organization_id_value,execution_id_value,assignment_record.id,
      performer_profile_id_value,entry_mode_value,category_value,category_contract_version_value,
      category_contract_digest_value,observed_start_value,observed_end_value,observed_start_raw_value,
      observed_end_raw_value,business_profile_id_value,business_profile_version_value,business_profile_hash_value,
      time_zone_value,review_state_value,execution_record.revision,rtrim(execution_record.canonical_digest),
      assignment_record.revision,rtrim(assignment_record.canonical_digest),after_revision_value,after_digest_value,
      event_id_value,actor_user_id_value,action_value,reason_value) RETURNING * INTO interval_record;
  ELSE
    UPDATE public.canonical_labor_intervals SET category_code=category_value,observed_start=observed_start_value,
      observed_end=observed_end_value,observed_start_raw=observed_start_raw_value,observed_end_raw=observed_end_raw_value,
      business_profile_id=business_profile_id_value,business_profile_version=business_profile_version_value,
      business_profile_hash=business_profile_hash_value,time_zone=time_zone_value,review_state=review_state_value,
      source_execution_revision=execution_record.revision,source_execution_digest=rtrim(execution_record.canonical_digest),
      source_assignment_revision=assignment_record.revision,source_assignment_digest=rtrim(assignment_record.canonical_digest),
      revision=after_revision_value,canonical_digest=after_digest_value,last_event_id=event_id_value,
      last_recorded_by_user_id=actor_user_id_value,last_action_code=action_value,last_reason=reason_value,
      last_transaction_id=txid_current(),updated_at=transaction_timestamp()
     WHERE organization_id=organization_id_value AND id=actual_interval_id RETURNING * INTO interval_record;
  END IF;

  INSERT INTO public.canonical_labor_events(id,organization_id,interval_id,execution_id,assignment_id,
    actor_user_id,performer_profile_id,auth_session_id,action_code,reason,before_revision,after_revision,
    before_digest,after_digest,source_execution_revision,source_execution_digest,source_assignment_revision,
    source_assignment_digest,request_digest,idempotency_key_hash,request_correlation_id)
  VALUES(event_id_value,organization_id_value,actual_interval_id,execution_id_value,assignment_record.id,
    actor_user_id_value,performer_profile_id_value,auth_session_id_value,action_value,reason_value,
    before_revision_value,after_revision_value,before_digest_value,after_digest_value,execution_record.revision,
    rtrim(execution_record.canonical_digest),assignment_record.revision,rtrim(assignment_record.canonical_digest),
    request_digest_value,idempotency_hash_value,request_correlation_id_value);
  snapshot_value:=public.canonical_labor_projection(interval_record);
  INSERT INTO public.canonical_labor_revisions(organization_id,interval_id,event_id,revision,snapshot,
    snapshot_digest,actor_user_id,performer_profile_id,action_code,reason)
  VALUES(organization_id_value,actual_interval_id,event_id_value,after_revision_value,snapshot_value,
    after_digest_value,actor_user_id_value,performer_profile_id_value,action_value,reason_value);
  INSERT INTO public.canonical_labor_audit_events(organization_id,interval_id,event_id,execution_id,
    actor_user_id,performer_profile_id,action_code,reason,before_revision,after_revision,before_digest,
    after_digest,authority_evidence,request_digest,request_correlation_id)
  VALUES(organization_id_value,actual_interval_id,event_id_value,execution_id_value,actor_user_id_value,
    performer_profile_id_value,action_value,reason_value,before_revision_value,after_revision_value,
    before_digest_value,after_digest_value,jsonb_build_object('actor',authority,'businessProfileId',business_profile_id_value,
      'businessProfileVersion',business_profile_version_value,'businessProfileHash',business_profile_hash_value,
      'timeZone',time_zone_value,'executionRevision',execution_record.revision,
      'executionDigest',rtrim(execution_record.canonical_digest),'assignmentRevision',assignment_record.revision,
      'assignmentDigest',rtrim(assignment_record.canonical_digest)),request_digest_value,request_correlation_id_value);
  response_body_value:=jsonb_build_object('success',TRUE,'data',snapshot_value,'requestId',request_correlation_id_value);
  INSERT INTO public.canonical_labor_idempotency(organization_id,actor_user_id,idempotency_key_hash,
    request_digest,action_code,execution_id,interval_id,event_id,response_status,response_body)
  VALUES(organization_id_value,actor_user_id_value,idempotency_hash_value,request_digest_value,action_value,
    execution_id_value,actual_interval_id,event_id_value,200,response_body_value);
  RETURN jsonb_build_object('status',200,'body',response_body_value,'replayed',FALSE);
END $function$;

CREATE OR REPLACE FUNCTION public.canonical_labor_time_read(
  organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
  auth_session_id_value UUID, execution_id_value UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE authority JSONB; actor_profile_id UUID; execution_record public.canonical_field_executions%ROWTYPE;
  assignment_record public.canonical_schedule_assignments%ROWTYPE; intervals JSONB; summaries JSONB; total_rows BIGINT;
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
    RAISE EXCEPTION 'Canonical labor reads require a bounded snapshot'
      USING ERRCODE='25001',CONSTRAINT='canonical_labor_snapshot_required'; END IF;
  authority:=public.canonical_field_execution_actor_authority(organization_id_value,actor_user_id_value,
    actor_access_role_value,auth_session_id_value,NULL,FALSE); actor_profile_id:=(authority->>'profileId')::UUID;
  SELECT execution.* INTO execution_record FROM public.canonical_field_executions execution
    JOIN public.canonical_transcripts transcript ON transcript.organization_id=execution.organization_id
      AND transcript.operation_id=execution.operation_id AND transcript.graph_id=execution.graph_id
   WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value
     AND transcript.source NOT IN ('simulation','demo');
  IF NOT FOUND THEN RAISE EXCEPTION 'Field execution not found'
    USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found'; END IF;
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments assignment
   WHERE assignment.organization_id=organization_id_value AND assignment.id=execution_record.assignment_id;
  IF NOT FOUND OR (actor_access_role_value='member' AND NOT
    public.canonical_field_execution_actor_in_scope(organization_id_value,actor_access_role_value,
      actor_profile_id,assignment_record)) THEN RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found'; END IF;
  IF actor_access_role_value NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found'; END IF;
  SELECT count(*) INTO total_rows FROM public.canonical_labor_intervals li
   WHERE li.organization_id=organization_id_value AND li.execution_id=execution_id_value
     AND (actor_access_role_value IN ('owner','admin') OR li.performer_profile_id=actor_profile_id);
  SELECT COALESCE(jsonb_agg(public.canonical_labor_projection(row_value) ORDER BY row_value.observed_start DESC,row_value.id),'[]'::JSONB)
    INTO intervals FROM (SELECT * FROM public.canonical_labor_intervals li
      WHERE li.organization_id=organization_id_value AND li.execution_id=execution_id_value
        AND (actor_access_role_value IN ('owner','admin') OR li.performer_profile_id=actor_profile_id)
      ORDER BY li.observed_start DESC,li.id LIMIT 200) row_value;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('performedByProfileId',summary.performer_profile_id,
      'category',summary.category_code,'closedIntervalCount',summary.interval_count,
      'observedSeconds',summary.observed_seconds,'openTimerCount',summary.open_timer_count)
      ORDER BY summary.performer_profile_id,summary.category_code),'[]'::JSONB) INTO summaries
    FROM (SELECT li.performer_profile_id,li.category_code,
      count(*) FILTER(WHERE li.observed_end IS NOT NULL AND li.review_state<>'rejected') AS interval_count,
      COALESCE(sum(floor(extract(epoch FROM li.observed_end-li.observed_start))) FILTER(
        WHERE li.observed_end IS NOT NULL AND li.review_state<>'rejected'),0)::BIGINT AS observed_seconds,
      count(*) FILTER(WHERE li.observed_end IS NULL AND li.review_state<>'rejected') AS open_timer_count
      FROM public.canonical_labor_intervals li WHERE li.organization_id=organization_id_value
        AND li.execution_id=execution_id_value
        AND (actor_access_role_value IN ('owner','admin') OR li.performer_profile_id=actor_profile_id)
      GROUP BY li.performer_profile_id,li.category_code ORDER BY li.performer_profile_id,li.category_code LIMIT 200) summary;
  RETURN jsonb_build_object('success',TRUE,'data',jsonb_build_object(
    'executionId',execution_id_value,'intervals',intervals,'summaries',summaries,
    'totalIntervalCount',total_rows,'truncated',total_rows>200,
    'categoryContract',jsonb_build_object('version','m23-labor-category-v1',
      'digest','298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738',
      'categories',jsonb_build_array('break','cleanup','other','production','setup','travel')),
    'interpretation','Observed or entered operational time evidence only; not payroll, wage, overtime, billable time, customer pricing, tax, legal compliance, or profitability evidence.'));
END $function$;

REVOKE ALL ON FUNCTION public.canonical_labor_reason_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_interval_digest(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,
  TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,BIGINT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_projection(public.canonical_labor_intervals) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_immutable_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_guard_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_validate_complete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_request_digest(UUID,UUID,UUID,UUID,TEXT,UUID,TEXT,BIGINT,TEXT,
  BIGINT,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_time_mutate(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,UUID,TEXT,TEXT,
  TEXT,BIGINT,TEXT,BIGINT,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_time_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
