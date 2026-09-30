-- Mission 26 Part 4B: canonical Mission 22 booking-cancellation history.
-- This bridge is populated only by the immutable human-approved scheduling
-- revision writers. Scheduled-to-scheduled reschedules remain state changes;
-- only an explicit transition to appointment_status=cancelled is cancellation.
-- Legacy scheduling binaries omitted approved_at. Change its default before
-- installing the bridge so a rolling old writer records the wall clock rather
-- than PostgreSQL's transaction-start NOW(). Historical legacy rows whose
-- approval and revision share that old transaction-start instant become private
-- immutable lineage-gap markers because their actual cutoff side is unknowable.
ALTER TABLE public.canonical_schedule_approvals
 ALTER COLUMN approved_at SET DEFAULT clock_timestamp();

CREATE SEQUENCE public.canonical_forecast_schedule_booking_event_order_sequence;

CREATE TABLE public.canonical_forecast_schedule_booking_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 assignment_id UUID NOT NULL,
 appointment_id UUID NOT NULL,
 source_revision_id UUID NOT NULL,
 source_revision BIGINT NOT NULL CHECK(source_revision>1),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('human_approved','human_preview_approved')),
 source_order BIGINT NOT NULL DEFAULT nextval(
  'public.canonical_forecast_schedule_booking_event_order_sequence') CHECK(source_order>0),
 schedule_state TEXT NOT NULL CHECK(schedule_state IN ('scheduled','unscheduled')),
 appointment_status TEXT NOT NULL,
 transition_kind TEXT NOT NULL CHECK(
  transition_kind IN ('accepted_booking','booking_cancelled','state_changed')),
 occurred_at TIMESTAMPTZ NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 event_digest TEXT NOT NULL CHECK(event_digest~'^[a-f0-9]{64}$'),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,source_revision_id),
 UNIQUE(organization_id,source_order),
 FOREIGN KEY(organization_id,assignment_id)
  REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,appointment_id)
  REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_revision_id)
  REFERENCES public.canonical_schedule_assignment_revisions(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_schedule_booking_events_tenant_order
 ON public.canonical_forecast_schedule_booking_events(organization_id,source_order DESC);
CREATE INDEX canonical_forecast_schedule_booking_events_tenant_time
 ON public.canonical_forecast_schedule_booking_events(
  organization_id,occurred_at,assignment_id,source_order);
CREATE INDEX canonical_forecast_schedule_booking_events_candidates
 ON public.canonical_forecast_schedule_booking_events(
  organization_id,transition_kind,occurred_at,assignment_id);

-- Preserve every legacy revision whose exact decision instant is unknowable.
-- These markers are private source authority: a cohort may only authenticate a
-- horizon that ends before the marker's earliest possible decision instant.
CREATE TABLE public.canonical_forecast_schedule_booking_lineage_gaps (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 assignment_id UUID NOT NULL,
 appointment_id UUID NOT NULL,
 source_revision_id UUID NOT NULL,
 source_revision BIGINT NOT NULL CHECK(source_revision>1),
 uncertain_from_at TIMESTAMPTZ NOT NULL,
 reason TEXT NOT NULL CHECK(reason='legacy_transaction_start_timestamp'),
 source_digest TEXT NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 gap_digest TEXT NOT NULL CHECK(gap_digest~'^[a-f0-9]{64}$'),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,source_revision_id),
 FOREIGN KEY(organization_id,assignment_id)
  REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,appointment_id)
  REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_revision_id)
  REFERENCES public.canonical_schedule_assignment_revisions(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_schedule_booking_lineage_gaps_tenant_time
 ON public.canonical_forecast_schedule_booking_lineage_gaps(
  organization_id,uncertain_from_at,assignment_id);

CREATE FUNCTION public.canonical_forecast_schedule_booking_lineage_gap_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Schedule booking lineage gaps are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_schedule_booking_lineage_gap_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_schedule_booking_lineage_gaps
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_schedule_booking_lineage_gap_immutable();

CREATE FUNCTION public.canonical_forecast_schedule_booking_event_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Schedule booking events are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_schedule_booking_event_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_schedule_booking_events
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_schedule_booking_event_immutable();

-- Fence every genuine human schedule writer before its immutable revision can
-- become an uncommitted source fact. Cohort capture takes the same tenant lock
-- with try semantics, so it cannot win between revision insertion and event
-- derivation and return an authenticated pre-writer view.
CREATE FUNCTION public.canonical_forecast_schedule_booking_event_lock()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.source_kind IN ('human_approved','human_preview_approved') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||NEW.organization_id::text,0));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_canonical_forecast_schedule_booking_event_lock
 BEFORE INSERT ON public.canonical_schedule_assignment_revisions
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_schedule_booking_event_lock();

CREATE FUNCTION public.canonical_forecast_schedule_booking_event_capture()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior_revision public.canonical_schedule_assignment_revisions%ROWTYPE;
 appointment_value UUID;transition_value TEXT;event_hash TEXT;prior_found BOOLEAN;
 event_occurred_at TIMESTAMPTZ;gap_hash TEXT;
BEGIN
 IF NEW.source_kind NOT IN ('human_approved','human_preview_approved') THEN
  RETURN NEW;
 END IF;
 SELECT * INTO prior_revision
 FROM public.canonical_schedule_assignment_revisions
 WHERE organization_id=NEW.organization_id AND assignment_id=NEW.assignment_id
  AND source_kind IN ('human_approved','human_preview_approved')
  AND revision<NEW.revision
 ORDER BY revision DESC LIMIT 1;
 prior_found:=FOUND;
 SELECT appointment_id INTO STRICT appointment_value
 FROM public.canonical_schedule_assignments
 WHERE organization_id=NEW.organization_id AND id=NEW.assignment_id;
 IF NEW.source_kind='human_approved' THEN
  SELECT approval.approved_at INTO STRICT event_occurred_at
  FROM public.canonical_schedule_approvals approval
  WHERE approval.organization_id=NEW.organization_id AND approval.id=NEW.approval_id;
 ELSE
  SELECT approval.approved_at INTO STRICT event_occurred_at
  FROM public.canonical_schedule_human_approvals approval
  WHERE approval.organization_id=NEW.organization_id AND approval.id=NEW.human_approval_id;
 END IF;
 IF NEW.source_kind='human_approved' AND event_occurred_at<=NEW.created_at THEN
  gap_hash:=public.canonical_completion_digest(jsonb_build_object(
   'organizationId',NEW.organization_id,'assignmentId',NEW.assignment_id,
   'appointmentId',appointment_value,'sourceRevisionId',NEW.id,
   'sourceRevision',NEW.revision,
   'uncertainFromAt',public.canonical_forecast_utc_instant(event_occurred_at),
   'reason','legacy_transaction_start_timestamp',
   'sourceDigest',rtrim(NEW.canonical_digest)));
  INSERT INTO public.canonical_forecast_schedule_booking_lineage_gaps(
   organization_id,assignment_id,appointment_id,source_revision_id,source_revision,
   uncertain_from_at,reason,source_digest,gap_digest)
  VALUES(NEW.organization_id,NEW.assignment_id,appointment_value,NEW.id,NEW.revision,
   event_occurred_at,'legacy_transaction_start_timestamp',
   rtrim(NEW.canonical_digest),gap_hash)
  ON CONFLICT(organization_id,source_revision_id) DO NOTHING;
  RETURN NEW;
 END IF;
 transition_value:=CASE
  WHEN prior_found AND NEW.appointment_status='cancelled'
   AND prior_revision.appointment_status<>'cancelled' THEN 'booking_cancelled'
  WHEN NEW.schedule_state='scheduled' AND NEW.appointment_status='scheduled'
   AND (NOT prior_found OR prior_revision.schedule_state<>'scheduled'
    OR prior_revision.appointment_status<>'scheduled') THEN 'accepted_booking'
  ELSE 'state_changed' END;
 event_hash:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',NEW.organization_id,'assignmentId',NEW.assignment_id,
  'appointmentId',appointment_value,'sourceRevisionId',NEW.id,
  'sourceRevision',NEW.revision,'sourceKind',NEW.source_kind,
  'scheduleState',NEW.schedule_state,'appointmentStatus',NEW.appointment_status,
  'transitionKind',transition_value,
  'occurredAt',public.canonical_forecast_utc_instant(event_occurred_at),
  'sourceDigest',rtrim(NEW.canonical_digest)));
 INSERT INTO public.canonical_forecast_schedule_booking_events(
  organization_id,assignment_id,appointment_id,source_revision_id,source_revision,
  source_kind,schedule_state,appointment_status,transition_kind,occurred_at,
  source_digest,event_digest)
 VALUES(NEW.organization_id,NEW.assignment_id,appointment_value,NEW.id,NEW.revision,
  NEW.source_kind,NEW.schedule_state,NEW.appointment_status,transition_value,
  event_occurred_at,rtrim(NEW.canonical_digest),event_hash)
 ON CONFLICT(organization_id,source_revision_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_schedule_booking_event_capture
 AFTER INSERT ON public.canonical_schedule_assignment_revisions
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_schedule_booking_event_capture();

-- Persist unsafe pre-203 lineage before mounting the durable event subset.
INSERT INTO public.canonical_forecast_schedule_booking_lineage_gaps(
 organization_id,assignment_id,appointment_id,source_revision_id,source_revision,
 uncertain_from_at,reason,source_digest,gap_digest)
SELECT revision_value.organization_id,revision_value.assignment_id,
 assignment.appointment_id,revision_value.id,revision_value.revision,
 approval.approved_at,'legacy_transaction_start_timestamp',
 rtrim(revision_value.canonical_digest),
 public.canonical_completion_digest(jsonb_build_object(
  'organizationId',revision_value.organization_id,
  'assignmentId',revision_value.assignment_id,
  'appointmentId',assignment.appointment_id,
  'sourceRevisionId',revision_value.id,
  'sourceRevision',revision_value.revision,
  'uncertainFromAt',public.canonical_forecast_utc_instant(approval.approved_at),
  'reason','legacy_transaction_start_timestamp',
  'sourceDigest',rtrim(revision_value.canonical_digest)))
FROM public.canonical_schedule_assignment_revisions revision_value
JOIN public.canonical_schedule_assignments assignment
 ON assignment.organization_id=revision_value.organization_id
 AND assignment.id=revision_value.assignment_id
JOIN public.canonical_schedule_approvals approval
 ON approval.organization_id=revision_value.organization_id
 AND approval.id=revision_value.approval_id
WHERE revision_value.source_kind='human_approved'
 AND approval.approved_at<=revision_value.created_at
ORDER BY revision_value.organization_id,revision_value.assignment_id,revision_value.revision;

-- Mount all pre-existing genuine human scheduling history in revision order.
WITH human_ordered AS MATERIALIZED (
 SELECT revision_value.*,assignment.appointment_id,
  CASE WHEN revision_value.source_kind='human_approved'
   THEN legacy_approval.approved_at ELSE preview_approval.approved_at END event_occurred_at,
  lag(revision_value.schedule_state) OVER (
   PARTITION BY revision_value.organization_id,revision_value.assignment_id
   ORDER BY revision_value.revision) prior_schedule_state,
  lag(revision_value.appointment_status) OVER (
   PARTITION BY revision_value.organization_id,revision_value.assignment_id
   ORDER BY revision_value.revision) prior_appointment_status
 FROM public.canonical_schedule_assignment_revisions revision_value
 JOIN public.canonical_schedule_assignments assignment
  ON assignment.organization_id=revision_value.organization_id
  AND assignment.id=revision_value.assignment_id
 LEFT JOIN public.canonical_schedule_approvals legacy_approval
  ON legacy_approval.organization_id=revision_value.organization_id
  AND legacy_approval.id=revision_value.approval_id
 LEFT JOIN public.canonical_schedule_human_approvals preview_approval
  ON preview_approval.organization_id=revision_value.organization_id
  AND preview_approval.id=revision_value.human_approval_id
 WHERE revision_value.source_kind IN ('human_approved','human_preview_approved')
), human_rows AS (
 SELECT human_ordered.*,
  CASE
   WHEN prior_appointment_status IS NOT NULL AND appointment_status='cancelled'
    AND prior_appointment_status IS DISTINCT FROM 'cancelled' THEN 'booking_cancelled'
   WHEN schedule_state='scheduled' AND appointment_status='scheduled'
    AND (prior_schedule_state IS NULL OR prior_schedule_state IS DISTINCT FROM 'scheduled'
     OR prior_appointment_status IS DISTINCT FROM 'scheduled') THEN 'accepted_booking'
   ELSE 'state_changed' END transition_kind
 FROM human_ordered
 WHERE source_kind<>'human_approved' OR event_occurred_at>created_at
), prepared AS (
 SELECT human_rows.*,
  public.canonical_completion_digest(jsonb_build_object(
   'organizationId',organization_id,'assignmentId',assignment_id,
   'appointmentId',appointment_id,'sourceRevisionId',id,
   'sourceRevision',revision,'sourceKind',source_kind,
   'scheduleState',schedule_state,'appointmentStatus',appointment_status,
   'transitionKind',transition_kind,
   'occurredAt',public.canonical_forecast_utc_instant(event_occurred_at),
   'sourceDigest',rtrim(canonical_digest))) event_digest_value
 FROM human_rows
)
INSERT INTO public.canonical_forecast_schedule_booking_events(
 organization_id,assignment_id,appointment_id,source_revision_id,source_revision,
 source_kind,schedule_state,appointment_status,transition_kind,occurred_at,
 source_digest,event_digest)
SELECT organization_id,assignment_id,appointment_id,id,revision,source_kind,
 schedule_state,appointment_status,transition_kind,event_occurred_at,
 rtrim(canonical_digest),event_digest_value
FROM prepared ORDER BY organization_id,assignment_id,revision;

CREATE TABLE public.canonical_forecast_schedule_booking_cancellation_cohorts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 cutoff_at TIMESTAMPTZ NOT NULL,
 horizon_ends_at TIMESTAMPTZ NOT NULL,
 source_high_water_order BIGINT NOT NULL CHECK(source_high_water_order>=0),
 member_receipts JSONB NOT NULL CHECK(jsonb_typeof(member_receipts)='array'),
 eligible_count INTEGER NOT NULL CHECK(eligible_count BETWEEN 0 AND 500),
 cancelled_count INTEGER NOT NULL CHECK(cancelled_count BETWEEN 0 AND eligible_count),
 source_digest TEXT NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 digest_nonce UUID NOT NULL,
 cohort_digest TEXT NOT NULL CHECK(cohort_digest~'^[a-f0-9]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 CHECK(horizon_ends_at>cutoff_at),
 CHECK(octet_length(member_receipts::text)<=262144),
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_schedule_booking_cancellation_cohorts_tenant
 ON public.canonical_forecast_schedule_booking_cancellation_cohorts(
  organization_id,captured_at DESC,id);

CREATE FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Schedule booking cancellation cohorts are immutable'
  USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_schedule_booking_cancellation_cohort_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_schedule_booking_cancellation_cohorts
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_immutable();

CREATE FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_projection(
 value public.canonical_forecast_schedule_booking_cancellation_cohorts,
 stale_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,
  'version','m26-schedule-booking-cancellation-cohort-v1',
  'targetKey','demand.booking_cancellation.v1',
  'state',CASE WHEN stale_value THEN 'source_stale'
    WHEN value.eligible_count=0 THEN 'unavailable' ELSE 'descriptive_only' END,
  'reason',CASE WHEN stale_value THEN 'source_changed_inside_horizon'
    WHEN value.eligible_count=0 THEN 'insufficient_history' ELSE NULL END,
  'cutoffAt',public.canonical_forecast_utc_instant(value.cutoff_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(value.horizon_ends_at),
  'capturedAt',public.canonical_forecast_utc_instant(value.captured_at),
  'eligibleCount',CASE WHEN stale_value THEN 0 ELSE value.eligible_count END,
  'cancelledCount',CASE WHEN stale_value THEN 0 ELSE value.cancelled_count END,
  'observedRate',CASE WHEN stale_value OR value.eligible_count=0 THEN NULL ELSE
   trim(trailing '.' FROM trim(trailing '0' FROM
    round(value.cancelled_count::numeric/value.eligible_count::numeric,6)::text)) END,
  'sourceDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.source_digest) END,
  'cohortDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.cohort_digest) END,
  'sourceAuthority','northstar_human_approved_schedule_history',
  'sourceAuthenticated',NOT stale_value,
  'sourceCoverageComplete',FALSE,
  'offPlatformCoverageVerified',FALSE,
  'providerCoverageVerified',FALSE,
  'probabilityCalibrated',FALSE,
  'confidence','unavailable',
  'forecastIssued',FALSE,
  'paidNumericServing',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
 existing public.canonical_forecast_schedule_booking_cancellation_cohorts%ROWTYPE;
 inserted public.canonical_forecast_schedule_booking_cancellation_cohorts%ROWTYPE;
 key_hash TEXT;request_hash TEXT;members JSONB;source_hash TEXT;cohort_hash TEXT;
 nonce UUID;eligible INTEGER;cancelled INTEGER;high_water BIGINT;stale_value BOOLEAN;
 source_count INTEGER;candidate_count INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  cutoff_value IS NULL OR horizon_value IS NULL OR horizon_value<=cutoff_value OR
  horizon_value>clock_timestamp() OR
  horizon_value-cutoff_value>INTERVAL '90 days' OR key_value IS NULL OR
  key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Schedule booking cancellation cohort input invalid'
   USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:schedule-booking-cancellation:'||org::text||':'||actor::text||':'||key_hash,0));
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:schedule-booking-events:'||org::text,0)) THEN
  RAISE EXCEPTION 'Schedule booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO existing
 FROM public.canonical_forecast_schedule_booking_cancellation_cohorts
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Schedule booking cancellation replay changed' USING ERRCODE='23505';
  END IF;
  SELECT EXISTS(
   SELECT 1 FROM public.canonical_forecast_schedule_booking_events event_value
   WHERE event_value.organization_id=org
    AND event_value.source_order>existing.source_high_water_order
    AND event_value.occurred_at<=existing.horizon_ends_at
   UNION ALL
   SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps gap_value
   WHERE gap_value.organization_id=org
    AND gap_value.uncertain_from_at<=existing.horizon_ends_at) INTO stale_value;
  RETURN jsonb_build_object('cohort',
   public.canonical_forecast_schedule_booking_cancellation_cohort_projection(
    existing,stale_value),'replayed',TRUE);
 END IF;
 IF EXISTS(
  SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps gap_value
  WHERE gap_value.organization_id=org
   AND gap_value.uncertain_from_at<=horizon_value) THEN
  RAISE EXCEPTION 'Schedule booking source contains unknowable legacy lineage'
   USING ERRCODE='55000';
 END IF;
 SELECT COALESCE(MAX(source_order),0) INTO high_water
 FROM public.canonical_forecast_schedule_booking_events
 WHERE organization_id=org;
 IF high_water>9007199254740991 THEN
  RAISE EXCEPTION 'Schedule booking source exceeds safe order size'
   USING ERRCODE='54000';
 END IF;
 SELECT count(*)::integer INTO source_count FROM (
  SELECT 1 FROM public.canonical_forecast_schedule_booking_events event_value
  WHERE event_value.organization_id=org AND event_value.occurred_at<=horizon_value
  LIMIT 1001) bounded_source;
 IF source_count>1000 THEN
  RAISE EXCEPTION 'Schedule booking source exceeds bounded history'
   USING ERRCODE='54000';
 END IF;
 SELECT count(*)::integer INTO candidate_count FROM (
  SELECT event_value.assignment_id
  FROM public.canonical_forecast_schedule_booking_events event_value
  WHERE event_value.organization_id=org
   AND event_value.transition_kind='accepted_booking'
   AND event_value.occurred_at<=cutoff_value
  GROUP BY event_value.assignment_id
  LIMIT 501) bounded_candidates;
 IF candidate_count>500 THEN
  RAISE EXCEPTION 'Schedule booking cohort exceeds bounded candidate size'
   USING ERRCODE='54000';
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT event_value.assignment_id,min(event_value.appointment_id::text)::uuid appointment_id
  FROM public.canonical_forecast_schedule_booking_events event_value
  WHERE event_value.organization_id=org
   AND event_value.transition_kind='accepted_booking'
   AND event_value.occurred_at<=cutoff_value
  GROUP BY event_value.assignment_id
 ), as_of_rows AS MATERIALIZED (
  SELECT candidate.assignment_id,candidate.appointment_id,
   latest.id as_of_event_id,latest.source_order as_of_source_order,
   latest.schedule_state,latest.appointment_status,
   accepted.id accepted_event_id,accepted.source_order accepted_source_order,
   accepted.occurred_at accepted_at
  FROM candidates candidate
  CROSS JOIN LATERAL (
   SELECT event_value.*
   FROM public.canonical_forecast_schedule_booking_events event_value
   WHERE event_value.organization_id=org
    AND event_value.assignment_id=candidate.assignment_id
    AND event_value.occurred_at<=cutoff_value
   ORDER BY event_value.source_revision DESC LIMIT 1) latest
  CROSS JOIN LATERAL (
   SELECT event_value.*
   FROM public.canonical_forecast_schedule_booking_events event_value
   WHERE event_value.organization_id=org
    AND event_value.assignment_id=candidate.assignment_id
    AND event_value.transition_kind='accepted_booking'
    AND event_value.occurred_at<=cutoff_value
   ORDER BY event_value.source_revision LIMIT 1) accepted
 ), eligible_rows AS MATERIALIZED (
  SELECT as_of_rows.*,
   cancellation.id cancellation_event_id,
   cancellation.source_order cancellation_source_order,
   cancellation.occurred_at cancelled_at
  FROM as_of_rows
  LEFT JOIN LATERAL (
   SELECT event_value.*
   FROM public.canonical_forecast_schedule_booking_events event_value
   WHERE event_value.organization_id=org
    AND event_value.assignment_id=as_of_rows.assignment_id
    AND event_value.transition_kind='booking_cancelled'
    AND event_value.occurred_at>cutoff_value
    AND event_value.occurred_at<=horizon_value
   ORDER BY event_value.source_revision LIMIT 1) cancellation ON TRUE
  WHERE as_of_rows.schedule_state='scheduled'
   AND as_of_rows.appointment_status='scheduled'
 )
 SELECT count(*)::integer,
  COALESCE(jsonb_agg(jsonb_build_object(
   'assignmentId',assignment_id,'appointmentId',appointment_id,
   'acceptedEventId',accepted_event_id,'acceptedSourceOrder',accepted_source_order,
   'acceptedAt',public.canonical_forecast_utc_instant(accepted_at),
   'asOfEventId',as_of_event_id,'asOfSourceOrder',as_of_source_order,
   'cancellationEventId',cancellation_event_id,
   'cancellationSourceOrder',cancellation_source_order,
   'cancelledAt',public.canonical_forecast_utc_instant(cancelled_at))
   ORDER BY assignment_id),'[]'::jsonb),
  count(cancellation_event_id)::integer
 INTO eligible,members,cancelled FROM eligible_rows;
 IF eligible>500 OR octet_length(members::text)>262144 THEN
  RAISE EXCEPTION 'Schedule booking cohort exceeds bounded size' USING ERRCODE='54000';
 END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'sourceAuthority','northstar_human_approved_schedule_history',
  'organizationId',org,'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value),
  'sourceHighWaterOrder',high_water,'members',members));
 nonce:=gen_random_uuid();
 cohort_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-schedule-booking-cancellation-cohort-v1',
  'organizationId',org,'sourceDigest',source_hash,'digestNonce',nonce,
  'eligibleCount',eligible,'cancelledCount',cancelled));
 INSERT INTO public.canonical_forecast_schedule_booking_cancellation_cohorts(
  organization_id,cutoff_at,horizon_ends_at,source_high_water_order,
  member_receipts,eligible_count,cancelled_count,source_digest,digest_nonce,
  cohort_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,cutoff_value,horizon_value,high_water,members,eligible,cancelled,
  source_hash,nonce,cohort_hash,actor,(authority->>'membershipId')::uuid,
  session_value,key_hash,request_hash)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('cohort',
  public.canonical_forecast_schedule_booking_cancellation_cohort_projection(
   inserted,FALSE),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,cohort_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_forecast_schedule_booking_cancellation_cohorts%ROWTYPE;
 stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for schedule booking cancellation cohort read'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:schedule-booking-events:'||org::text,0)) THEN
  RAISE EXCEPTION 'Schedule booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO value
 FROM public.canonical_forecast_schedule_booking_cancellation_cohorts
 WHERE organization_id=org AND id=cohort_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','unavailable','reason','cohort_not_found',
   'sourceAuthenticated',FALSE,'sourceCoverageComplete',FALSE,
   'offPlatformCoverageVerified',FALSE,'providerCoverageVerified',FALSE,
   'probabilityCalibrated',FALSE,'confidence','unavailable',
   'forecastIssued',FALSE,'paidNumericServing',FALSE);
 END IF;
 SELECT EXISTS(
  SELECT 1 FROM public.canonical_forecast_schedule_booking_events event_value
  WHERE event_value.organization_id=org
   AND event_value.source_order>value.source_high_water_order
   AND event_value.occurred_at<=value.horizon_ends_at
  UNION ALL
  SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps gap_value
  WHERE gap_value.organization_id=org
   AND gap_value.uncertain_from_at<=value.horizon_ends_at) INTO stale_value;
 RETURN public.canonical_forecast_schedule_booking_cancellation_cohort_projection(
  value,stale_value);
END $$;

REVOKE ALL ON SEQUENCE public.canonical_forecast_schedule_booking_event_order_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_schedule_booking_events FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_schedule_booking_lineage_gaps FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_schedule_booking_cancellation_cohorts FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_event_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_lineage_gap_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_event_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_event_capture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_projection(
 public.canonical_forecast_schedule_booking_cancellation_cohorts,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_schedule_booking_cancellation_cohort_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
