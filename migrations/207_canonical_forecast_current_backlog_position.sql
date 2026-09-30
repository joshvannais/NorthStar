-- Mission 26 Part 4C: guarded current approved-work backlog position.
-- This freezes only the authenticated NorthStar booking/schedule/execution
-- subset visible in one serializable transaction. It is a present-state fact,
-- not a forecast, complete business history, or person-hour estimate.

CREATE TABLE public.canonical_forecast_current_backlog_snapshots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 schedule_source_high_water_order BIGINT NOT NULL CHECK(schedule_source_high_water_order>=0),
 member_receipts JSONB NOT NULL CHECK(jsonb_typeof(member_receipts)='array'),
 approved_unscheduled_count INTEGER NOT NULL CHECK(approved_unscheduled_count BETWEEN 0 AND 500),
 approved_scheduled_count INTEGER NOT NULL CHECK(approved_scheduled_count BETWEEN 0 AND 500),
 work_in_progress_count INTEGER NOT NULL CHECK(work_in_progress_count BETWEEN 0 AND 500),
 completed_count INTEGER NOT NULL CHECK(completed_count BETWEEN 0 AND 500),
 unresolved_linkage_count INTEGER NOT NULL CHECK(unresolved_linkage_count BETWEEN 0 AND 500),
 source_digest TEXT NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 digest_nonce UUID NOT NULL,
 snapshot_digest TEXT NOT NULL CHECK(snapshot_digest~'^[a-f0-9]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 CHECK(approved_unscheduled_count+approved_scheduled_count+work_in_progress_count+
  completed_count+unresolved_linkage_count<=500),
 CHECK(octet_length(member_receipts::text)<=262144),
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_current_backlog_snapshots_tenant_capture
 ON public.canonical_forecast_current_backlog_snapshots(
  organization_id,captured_at DESC,id);

-- This private current projection converts append-only booking history into a
-- unique, index-bounded identity source. It is maintained in the same
-- transactions as the genuine schedule event and assignment writers. Capture
-- never groups or enriches the unbounded event history.
CREATE TABLE public.canonical_forecast_current_backlog_booking_positions (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 appointment_id UUID NOT NULL,
 assignment_id UUID NOT NULL,
 first_booking_order BIGINT NOT NULL CHECK(first_booking_order>0),
 latest_booking_order BIGINT NOT NULL CHECK(latest_booking_order>=first_booking_order),
 active BOOLEAN NOT NULL,
 schedule_revision BIGINT NOT NULL CHECK(schedule_revision>0),
 schedule_digest TEXT NOT NULL CHECK(schedule_digest~'^[a-f0-9]{64}$'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,appointment_id),
 FOREIGN KEY(organization_id,appointment_id)
  REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,assignment_id)
  REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_current_backlog_booking_positions_active
 ON public.canonical_forecast_current_backlog_booking_positions(
  organization_id,appointment_id)
 INCLUDE(first_booking_order,assignment_id,schedule_revision,schedule_digest)
 WHERE active;

-- Rolling-upgrade fence: genuine writers update the assignment first and then
-- append the schedule event. Acquire those source locks in the same order and
-- hold them through backfill plus both trigger installations. An already-active
-- writer drains before the backfill snapshot; a queued writer cannot slip into
-- the triggerless interval.
LOCK TABLE public.canonical_schedule_assignments IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.canonical_forecast_schedule_booking_events
 IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.canonical_forecast_current_backlog_booking_positions(
 organization_id,appointment_id,assignment_id,first_booking_order,
 latest_booking_order,active,schedule_revision,schedule_digest)
SELECT event_value.organization_id,event_value.appointment_id,assignment.id,
 min(event_value.source_order),max(event_value.source_order),
 assignment.appointment_status<>'cancelled',assignment.revision,
 rtrim(assignment.canonical_digest)
FROM public.canonical_forecast_schedule_booking_events event_value
JOIN public.canonical_schedule_assignments assignment
 ON assignment.organization_id=event_value.organization_id
 AND assignment.appointment_id=event_value.appointment_id
WHERE event_value.transition_kind='accepted_booking'
GROUP BY event_value.organization_id,event_value.appointment_id,assignment.id,
 assignment.appointment_status,assignment.revision,assignment.canonical_digest;

CREATE FUNCTION public.canonical_forecast_current_backlog_booking_event_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE assignment_value public.canonical_schedule_assignments%ROWTYPE;
BEGIN
 IF NEW.transition_kind<>'accepted_booking' THEN RETURN NEW; END IF;
 SELECT * INTO STRICT assignment_value
 FROM public.canonical_schedule_assignments
 WHERE organization_id=NEW.organization_id AND id=NEW.assignment_id
  AND appointment_id=NEW.appointment_id;
 INSERT INTO public.canonical_forecast_current_backlog_booking_positions(
  organization_id,appointment_id,assignment_id,first_booking_order,
  latest_booking_order,active,schedule_revision,schedule_digest)
 VALUES(NEW.organization_id,NEW.appointment_id,NEW.assignment_id,
  NEW.source_order,NEW.source_order,
  assignment_value.appointment_status<>'cancelled',assignment_value.revision,
  rtrim(assignment_value.canonical_digest))
 ON CONFLICT(organization_id,appointment_id) DO UPDATE SET
  assignment_id=EXCLUDED.assignment_id,
  first_booking_order=least(
   canonical_forecast_current_backlog_booking_positions.first_booking_order,
   EXCLUDED.first_booking_order),
  latest_booking_order=greatest(
   canonical_forecast_current_backlog_booking_positions.latest_booking_order,
   EXCLUDED.latest_booking_order),
  active=EXCLUDED.active,schedule_revision=EXCLUDED.schedule_revision,
  schedule_digest=EXCLUDED.schedule_digest,updated_at=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_current_backlog_booking_event_sync
 AFTER INSERT ON public.canonical_forecast_schedule_booking_events
 FOR EACH ROW EXECUTE FUNCTION
  public.canonical_forecast_current_backlog_booking_event_sync();

CREATE FUNCTION public.canonical_forecast_current_backlog_assignment_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 UPDATE public.canonical_forecast_current_backlog_booking_positions SET
  assignment_id=NEW.id,active=NEW.appointment_status<>'cancelled',
  schedule_revision=NEW.revision,schedule_digest=rtrim(NEW.canonical_digest),
  updated_at=clock_timestamp()
 WHERE organization_id=NEW.organization_id
  AND appointment_id=NEW.appointment_id;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_current_backlog_assignment_sync
 AFTER UPDATE OF appointment_status,schedule_state,revision,canonical_digest
 ON public.canonical_schedule_assignments
 FOR EACH ROW EXECUTE FUNCTION
  public.canonical_forecast_current_backlog_assignment_sync();

CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Current backlog snapshots are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_current_backlog_snapshot_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_current_backlog_snapshots
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_current_backlog_snapshot_immutable();

CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_stale(
 value public.canonical_forecast_current_backlog_snapshots)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.canonical_forecast_schedule_booking_events source_value
  WHERE source_value.organization_id=value.organization_id
   AND source_value.source_order>value.schedule_source_high_water_order
  UNION ALL
  SELECT 1
  FROM jsonb_to_recordset(value.member_receipts) member(
   "appointmentId" UUID,"assignmentId" UUID,"scheduleRevision" BIGINT,
   "scheduleDigest" TEXT,"executionId" UUID,"executionRevision" BIGINT,
   "executionDigest" TEXT)
  LEFT JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=value.organization_id
   AND assignment.id=member."assignmentId"
   AND assignment.appointment_id=member."appointmentId"
  LEFT JOIN public.canonical_field_executions execution_value
   ON execution_value.organization_id=value.organization_id
   AND execution_value.appointment_id=member."appointmentId"
  WHERE assignment.id IS NULL OR assignment.revision<>member."scheduleRevision"
   OR rtrim(assignment.canonical_digest)<>member."scheduleDigest"
   OR execution_value.id IS DISTINCT FROM member."executionId"
   OR execution_value.revision IS DISTINCT FROM member."executionRevision"
   OR rtrim(execution_value.canonical_digest) IS DISTINCT FROM member."executionDigest"
 )
$$;

CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_projection(
 value public.canonical_forecast_current_backlog_snapshots,stale_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,'version','m26-current-backlog-position-v1',
  'targetKey','demand.current_backlog_position.v1',
  'state',CASE WHEN stale_value THEN 'source_stale'
    WHEN value.approved_unscheduled_count+value.approved_scheduled_count+
      value.work_in_progress_count+value.completed_count+
      value.unresolved_linkage_count=0 THEN 'unavailable'
    WHEN value.unresolved_linkage_count>0 THEN 'partial'
    ELSE 'descriptive_subset' END,
  'reason',CASE WHEN stale_value THEN 'source_changed_after_capture'
    WHEN value.approved_unscheduled_count+value.approved_scheduled_count+
      value.work_in_progress_count+value.completed_count+
      value.unresolved_linkage_count=0 THEN 'no_authenticated_approved_booking_history'
    WHEN value.unresolved_linkage_count>0 THEN 'unresolved_linkage_present'
    ELSE NULL END,
  'capturedAt',public.canonical_forecast_utc_instant(value.captured_at),
  'approvedUnscheduledCount',CASE WHEN stale_value THEN 0 ELSE value.approved_unscheduled_count END,
  'approvedScheduledCount',CASE WHEN stale_value THEN 0 ELSE value.approved_scheduled_count END,
  'workInProgressCount',CASE WHEN stale_value THEN 0 ELSE value.work_in_progress_count END,
  'completedCount',CASE WHEN stale_value THEN 0 ELSE value.completed_count END,
  'unresolvedLinkageCount',CASE WHEN stale_value THEN 0 ELSE value.unresolved_linkage_count END,
  'knownBacklogCount',CASE WHEN stale_value THEN 0 ELSE
    value.approved_unscheduled_count+value.approved_scheduled_count+
      value.work_in_progress_count END,
  'plannedPersonMinutes',NULL,
  'backlogHoursState','unavailable',
  'backlogHoursReason','approved_person_hour_plan_missing',
  'sourceDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.source_digest) END,
  'snapshotDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.snapshot_digest) END,
  'sourceAuthority','northstar_authenticated_booking_schedule_and_execution_current_position',
  'sourceAuthenticated',NOT stale_value,
  'knownSubsetOnly',TRUE,'sourceCoverageComplete',FALSE,
  'offPlatformCoverageVerified',FALSE,'providerCoverageVerified',FALSE,
  'probabilityCalibrated',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
 existing public.canonical_forecast_current_backlog_snapshots%ROWTYPE;
 inserted public.canonical_forecast_current_backlog_snapshots%ROWTYPE;
 key_hash TEXT;request_hash TEXT;members JSONB;source_hash TEXT;snapshot_hash TEXT;
 nonce UUID;candidate_count INTEGER;high_water BIGINT;
 unscheduled_count INTEGER;scheduled_count INTEGER;in_progress_count INTEGER;
 completed_value INTEGER;unresolved_count INTEGER;stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value IS NULL OR
  key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Current backlog snapshot input invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(
  jsonb_build_object('version','m26-current-backlog-position-v1')::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:current-backlog:'||org::text||':'||actor::text||':'||key_hash,0));
 SELECT * INTO existing FROM public.canonical_forecast_current_backlog_snapshots
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Current backlog replay changed' USING ERRCODE='23505';
  END IF;
  stale_value:=public.canonical_forecast_current_backlog_snapshot_stale(existing);
  RETURN jsonb_build_object('snapshot',
   public.canonical_forecast_current_backlog_snapshot_projection(existing,stale_value),
   'replayed',TRUE);
 END IF;
 -- SERIALIZABLE supplies one logical tenant snapshot without cross-tenant
 -- table locks. The private unique-position projection bounds identity work;
 -- persisted revision/digest pins and the source high-water invalidate later
 -- source changes on every read.
 SELECT COALESCE((SELECT source_order
  FROM public.canonical_forecast_schedule_booking_events
  WHERE organization_id=org ORDER BY source_order DESC LIMIT 1),0)
 INTO high_water;
 SELECT count(*)::integer INTO candidate_count FROM (
  SELECT position_value.appointment_id
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  WHERE position_value.organization_id=org AND position_value.active
  ORDER BY position_value.appointment_id
  LIMIT 501) bounded_candidates;
 IF candidate_count>500 THEN
  RAISE EXCEPTION 'Current backlog source exceeds bounded size' USING ERRCODE='54000';
 END IF;
 WITH candidates AS (
  SELECT position_value.appointment_id,position_value.first_booking_order,
   position_value.assignment_id,position_value.schedule_revision,
   rtrim(position_value.schedule_digest) schedule_digest
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  WHERE position_value.organization_id=org AND position_value.active
  ORDER BY position_value.appointment_id LIMIT 500
 ), enriched AS (
  SELECT candidate.appointment_id,candidate.first_booking_order,
   assignment.id assignment_id,assignment.revision schedule_revision,
   rtrim(assignment.canonical_digest) schedule_digest,
   assignment.schedule_state,
   schedule_revision.id schedule_revision_id,
   execution_value.id execution_id,execution_value.revision execution_revision,
   rtrim(execution_value.canonical_digest) execution_digest,
   execution_value.assignment_id execution_assignment_id,
   execution_value.source_assignment_revision execution_source_schedule_revision,
   rtrim(execution_value.source_assignment_digest) execution_source_schedule_digest,
   execution_value.lifecycle_state,execution_revision.id execution_revision_id,
   CASE
    WHEN assignment.revision<>candidate.schedule_revision OR
      rtrim(assignment.canonical_digest)<>candidate.schedule_digest OR
      schedule_revision.id IS NULL OR
      (execution_value.id IS NOT NULL AND execution_revision.id IS NULL) OR
      (execution_value.id IS NOT NULL AND (
       execution_value.assignment_id<>assignment.id OR
       execution_value.source_assignment_revision<>assignment.revision OR
       rtrim(execution_value.source_assignment_digest)<>
        rtrim(assignment.canonical_digest))) OR
      execution_value.lifecycle_state='cancelled' THEN 'unresolved_linkage'
    WHEN execution_value.lifecycle_state='completed' THEN 'completed'
    WHEN execution_value.lifecycle_state IN
      ('in_progress','paused','completion_pending','reopened') THEN 'work_in_progress'
    WHEN assignment.schedule_state='scheduled' THEN 'approved_scheduled'
    WHEN assignment.schedule_state='unscheduled' THEN 'approved_unscheduled'
    ELSE 'unresolved_linkage' END classification
  FROM candidates candidate
  JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=org
   AND assignment.appointment_id=candidate.appointment_id
   AND assignment.id=candidate.assignment_id
  LEFT JOIN public.canonical_schedule_assignment_revisions schedule_revision
   ON schedule_revision.organization_id=assignment.organization_id
   AND schedule_revision.assignment_id=assignment.id
   AND schedule_revision.revision=assignment.revision
   AND rtrim(schedule_revision.canonical_digest)=rtrim(assignment.canonical_digest)
  LEFT JOIN public.canonical_field_executions execution_value
   ON execution_value.organization_id=assignment.organization_id
   AND execution_value.appointment_id=assignment.appointment_id
  LEFT JOIN public.canonical_field_execution_revisions execution_revision
   ON execution_revision.organization_id=execution_value.organization_id
   AND execution_revision.execution_id=execution_value.id
   AND execution_revision.revision=execution_value.revision
   AND rtrim(execution_revision.canonical_digest)=rtrim(execution_value.canonical_digest)
 ), aggregate_value AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'appointmentId',appointment_id,'firstBookingOrder',first_booking_order,
    'assignmentId',assignment_id,'scheduleRevision',schedule_revision,
    'scheduleDigest',schedule_digest,'scheduleRevisionId',schedule_revision_id,
    'scheduleState',schedule_state,'executionId',execution_id,
    'executionRevision',execution_revision,'executionDigest',execution_digest,
    'executionAssignmentId',execution_assignment_id,
    'executionSourceScheduleRevision',execution_source_schedule_revision,
    'executionSourceScheduleDigest',execution_source_schedule_digest,
    'executionRevisionId',execution_revision_id,'lifecycleState',lifecycle_state,
    'classification',classification) ORDER BY appointment_id),'[]'::jsonb) receipts,
   count(*) FILTER(WHERE classification='approved_unscheduled')::integer unscheduled,
   count(*) FILTER(WHERE classification='approved_scheduled')::integer scheduled,
   count(*) FILTER(WHERE classification='work_in_progress')::integer in_progress,
   count(*) FILTER(WHERE classification='completed')::integer completed,
   count(*) FILTER(WHERE classification='unresolved_linkage')::integer unresolved
  FROM enriched)
 SELECT receipts,unscheduled,scheduled,in_progress,completed,unresolved
 INTO members,unscheduled_count,scheduled_count,in_progress_count,
  completed_value,unresolved_count FROM aggregate_value;
 IF octet_length(members::text)>262144 THEN
  RAISE EXCEPTION 'Current backlog receipt exceeds bounded size' USING ERRCODE='54000';
 END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'sourceAuthority','northstar_authenticated_booking_schedule_and_execution_current_position',
  'organizationId',org,'scheduleSourceHighWaterOrder',high_water,'members',members));
 nonce:=gen_random_uuid();
 snapshot_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-current-backlog-position-v1','organizationId',org,
  'sourceDigest',source_hash,'digestNonce',nonce,
  'approvedUnscheduledCount',unscheduled_count,
  'approvedScheduledCount',scheduled_count,'workInProgressCount',in_progress_count,
  'completedCount',completed_value,'unresolvedLinkageCount',unresolved_count));
 INSERT INTO public.canonical_forecast_current_backlog_snapshots(
  organization_id,schedule_source_high_water_order,member_receipts,
  approved_unscheduled_count,approved_scheduled_count,work_in_progress_count,
  completed_count,unresolved_linkage_count,source_digest,digest_nonce,
  snapshot_digest,actor_user_id,membership_id,auth_session_id,
  request_key_hash,request_digest)
 VALUES(org,high_water,members,unscheduled_count,scheduled_count,in_progress_count,
  completed_value,unresolved_count,source_hash,nonce,snapshot_hash,actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('snapshot',
  public.canonical_forecast_current_backlog_snapshot_projection(inserted,FALSE),
  'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_forecast_current_backlog_snapshots%ROWTYPE;
 stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for current backlog snapshot read'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_current_backlog_snapshots
 WHERE organization_id=org AND id=snapshot_value;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Current backlog snapshot unavailable' USING ERRCODE='55000';
 END IF;
 stale_value:=public.canonical_forecast_current_backlog_snapshot_stale(value);
 RETURN public.canonical_forecast_current_backlog_snapshot_projection(value,stale_value);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_current_backlog_snapshots FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_current_backlog_booking_positions FROM PUBLIC;
REVOKE ALL ON FUNCTION
 public.canonical_forecast_current_backlog_booking_event_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION
 public.canonical_forecast_current_backlog_assignment_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_stale(
 public.canonical_forecast_current_backlog_snapshots) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_projection(
 public.canonical_forecast_current_backlog_snapshots,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_current_backlog_snapshot_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_current_backlog_snapshot_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
