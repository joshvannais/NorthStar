-- Mission 26 Part 4C: compose reviewed Mission 24 person plans into the
-- bounded current-backlog snapshot. This remains a present-state known subset,
-- not complete backlog coverage, a forecast, calibration, or paid numeric serving.

ALTER TABLE public.canonical_forecast_current_backlog_snapshots
 ADD COLUMN person_plan_composition_version TEXT NOT NULL DEFAULT 'none'
  CHECK(person_plan_composition_version IN
   ('none','m26-current-backlog-person-plan-composition-v1')),
 ADD COLUMN person_plan_receipts JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK(jsonb_typeof(person_plan_receipts)='array'),
 ADD COLUMN planned_person_minutes NUMERIC(20,6),
 ADD COLUMN backlog_hours_state TEXT NOT NULL DEFAULT 'unavailable'
  CHECK(backlog_hours_state IN('available','unavailable')),
 ADD COLUMN backlog_hours_reason TEXT DEFAULT 'approved_person_hour_plan_missing'
  CHECK(backlog_hours_reason IS NULL OR backlog_hours_reason IN(
   'approved_person_hour_plan_missing','no_active_backlog',
   'unresolved_linkage_present','reviewed_person_hour_plan_missing',
   'reviewed_person_hour_plan_not_current','source_changed_after_capture')),
 ADD CONSTRAINT canonical_forecast_current_backlog_person_plan_shape CHECK(
  (backlog_hours_state='available' AND backlog_hours_reason IS NULL AND
   planned_person_minutes>0) OR
  (backlog_hours_state='unavailable' AND backlog_hours_reason IS NOT NULL AND
   planned_person_minutes IS NULL)),
 ADD CONSTRAINT canonical_forecast_current_backlog_person_plan_receipt_bound
  CHECK(octet_length(person_plan_receipts::text)<=262144);

-- Reads and idempotent replays fence the exact private source identities before
-- currentness evaluation. Appointment locks serialize missing-to-known review
-- transitions; assignment and estimate/fence row locks compose with the genuine
-- Mission 22 and Mission 24 writers in their established order.
CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_source_lock(
 value public.canonical_forecast_current_backlog_snapshots)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE lock_value RECORD;
BEGIN
 IF jsonb_typeof(value.member_receipts) IS DISTINCT FROM 'array' OR
  jsonb_array_length(value.member_receipts)>500 OR
  jsonb_typeof(value.person_plan_receipts) IS DISTINCT FROM 'array' OR
  jsonb_array_length(value.person_plan_receipts)>500 THEN
  RAISE EXCEPTION 'Current backlog private receipt invalid' USING ERRCODE='55000';
 END IF;
 FOR lock_value IN
  SELECT member."appointmentId" appointment_id,
   member."assignmentId" assignment_id
  FROM jsonb_to_recordset(value.member_receipts) member(
   "appointmentId" UUID,"assignmentId" UUID)
  ORDER BY member."appointmentId"
 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:backlog-person-plan:'||value.organization_id::text||':'||
     lock_value.appointment_id::text,0)) THEN
   RAISE EXCEPTION 'Current backlog person-plan source busy' USING ERRCODE='55P03';
  END IF;
  PERFORM 1 FROM public.canonical_schedule_assignments assignment
  WHERE assignment.organization_id=value.organization_id
   AND assignment.id=lock_value.assignment_id
   AND assignment.appointment_id=lock_value.appointment_id
  FOR UPDATE OF assignment NOWAIT;
 END LOOP;
 IF value.person_plan_composition_version=
    'm26-current-backlog-person-plan-composition-v1' THEN
  FOR lock_value IN
   SELECT DISTINCT receipt."estimateId" estimate_id
   FROM jsonb_to_recordset(value.person_plan_receipts) receipt(
    "estimateId" UUID)
   WHERE receipt."estimateId" IS NOT NULL
   ORDER BY receipt."estimateId"
  LOOP
   PERFORM 1 FROM public.canonical_estimates estimate
   WHERE estimate.organization_id=value.organization_id
    AND estimate.id=lock_value.estimate_id
   FOR UPDATE OF estimate NOWAIT;
   PERFORM 1 FROM public.canonical_forecast_estimate_source_fences source_fence
   WHERE source_fence.organization_id=value.organization_id
    AND source_fence.estimate_id=lock_value.estimate_id
   FOR UPDATE OF source_fence NOWAIT;
  END LOOP;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_current_backlog_snapshot_stale(
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
  UNION ALL
  SELECT 1
  WHERE value.person_plan_composition_version=
     'm26-current-backlog-person-plan-composition-v1'
   AND ((SELECT count(*)
      FROM jsonb_to_recordset(value.member_receipts) member("classification" TEXT)
      WHERE member."classification" IN
       ('approved_unscheduled','approved_scheduled','work_in_progress'))<>
     jsonb_array_length(value.person_plan_receipts) OR EXISTS(
    SELECT 1
    FROM jsonb_to_recordset(value.person_plan_receipts) receipt(
     "appointmentId" UUID,"assignmentId" UUID,"classification" TEXT,
     "state" TEXT,"reviewId" UUID,"reviewRevision" BIGINT,
     "reviewDigest" TEXT,"estimateId" UUID,"plannedPersonMinutes" NUMERIC)
    LEFT JOIN jsonb_to_recordset(value.member_receipts) member(
     "appointmentId" UUID,"assignmentId" UUID,"classification" TEXT)
     ON member."appointmentId"=receipt."appointmentId"
      AND member."assignmentId"=receipt."assignmentId"
      AND member."classification"=receipt."classification"
    LEFT JOIN LATERAL(
     SELECT review.*
     FROM public.canonical_forecast_current_backlog_person_plan_reviews review
     WHERE review.organization_id=value.organization_id
      AND review.appointment_id=receipt."appointmentId"
     ORDER BY review.revision DESC LIMIT 1) current_review ON TRUE
    WHERE member."appointmentId" IS NULL OR receipt."classification" NOT IN
       ('approved_unscheduled','approved_scheduled','work_in_progress') OR
     current_review.id IS DISTINCT FROM receipt."reviewId" OR
     current_review.revision IS DISTINCT FROM receipt."reviewRevision" OR
     rtrim(current_review.digest) IS DISTINCT FROM receipt."reviewDigest" OR
     current_review.estimate_id IS DISTINCT FROM receipt."estimateId" OR
     CASE
      WHEN current_review.id IS NULL OR current_review.action='withdraw' THEN 'missing'
      WHEN current_review.assignment_id=receipt."assignmentId" AND
       NOT public.canonical_forecast_backlog_person_plan_stale(current_review)
       THEN 'available'
      ELSE 'not_current' END IS DISTINCT FROM receipt."state" OR
     (receipt."state"='available' AND
      current_review.planned_person_minutes IS DISTINCT FROM
       receipt."plannedPersonMinutes") OR
     (receipt."state"<>'available' AND receipt."plannedPersonMinutes" IS NOT NULL)
    ))
 )
$$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_current_backlog_snapshot_projection(
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
  'plannedPersonMinutes',CASE WHEN stale_value THEN NULL
    ELSE value.planned_person_minutes::text END,
  'backlogHoursState',CASE WHEN stale_value THEN 'unavailable'
    ELSE value.backlog_hours_state END,
  'backlogHoursReason',CASE WHEN stale_value THEN 'source_changed_after_capture'
    ELSE value.backlog_hours_reason END,
  'sourceDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.source_digest) END,
  'snapshotDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.snapshot_digest) END,
  'sourceAuthority','northstar_authenticated_booking_schedule_and_execution_current_position',
  'sourceAuthenticated',NOT stale_value,
  'knownSubsetOnly',TRUE,'sourceCoverageComplete',FALSE,
  'offPlatformCoverageVerified',FALSE,'providerCoverageVerified',FALSE,
  'probabilityCalibrated',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE)
$$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_current_backlog_snapshot_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
 existing public.canonical_forecast_current_backlog_snapshots%ROWTYPE;
 inserted public.canonical_forecast_current_backlog_snapshots%ROWTYPE;
 lock_value RECORD;
 key_hash TEXT;request_hash TEXT;members JSONB;plan_receipts JSONB;
 source_hash TEXT;snapshot_hash TEXT;hours_state TEXT;hours_reason TEXT;
 nonce UUID;candidate_count INTEGER;high_water BIGINT;
 unscheduled_count INTEGER;scheduled_count INTEGER;in_progress_count INTEGER;
 completed_value INTEGER;unresolved_count INTEGER;missing_plan_count INTEGER;
 stale_plan_count INTEGER;planned_total NUMERIC;stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value IS NULL OR
  key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Current backlog snapshot input invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'version','m26-current-backlog-position-v1',
  'personPlanCompositionVersion',
   'm26-current-backlog-person-plan-composition-v1')::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:current-backlog:'||org::text||':'||actor::text||':'||key_hash,0));
 SELECT * INTO existing FROM public.canonical_forecast_current_backlog_snapshots
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Current backlog replay changed' USING ERRCODE='23505';
  END IF;
  PERFORM public.canonical_forecast_current_backlog_snapshot_source_lock(existing);
  stale_value:=public.canonical_forecast_current_backlog_snapshot_stale(existing);
  RETURN jsonb_build_object('snapshot',
   public.canonical_forecast_current_backlog_snapshot_projection(existing,stale_value),
   'replayed',TRUE);
 END IF;
 SELECT count(*)::integer INTO candidate_count FROM (
  SELECT position_value.appointment_id
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  WHERE position_value.organization_id=org AND position_value.active
  ORDER BY position_value.appointment_id LIMIT 501) bounded_candidates;
 IF candidate_count>500 THEN
  RAISE EXCEPTION 'Current backlog source exceeds bounded size' USING ERRCODE='54000';
 END IF;
 -- Freeze every existing appointment review identity before authoritative reads,
 -- then take assignment and Mission 24 estimate/fence locks in deterministic order.
 FOR lock_value IN
  SELECT position_value.appointment_id,position_value.assignment_id
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  WHERE position_value.organization_id=org AND position_value.active
  ORDER BY position_value.appointment_id LIMIT 500
 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:backlog-person-plan:'||org::text||':'||lock_value.appointment_id::text,0)) THEN
   RAISE EXCEPTION 'Current backlog person-plan source busy' USING ERRCODE='55P03';
  END IF;
  PERFORM 1 FROM public.canonical_schedule_assignments assignment
  WHERE assignment.organization_id=org AND assignment.id=lock_value.assignment_id
   AND assignment.appointment_id=lock_value.appointment_id
  FOR UPDATE OF assignment NOWAIT;
 END LOOP;
 FOR lock_value IN
  SELECT DISTINCT current_review.estimate_id
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  JOIN LATERAL(
   SELECT review.estimate_id
   FROM public.canonical_forecast_current_backlog_person_plan_reviews review
   WHERE review.organization_id=org
    AND review.appointment_id=position_value.appointment_id
   ORDER BY review.revision DESC LIMIT 1) current_review ON TRUE
  WHERE position_value.organization_id=org AND position_value.active
  ORDER BY current_review.estimate_id
 LOOP
  PERFORM 1 FROM public.canonical_estimates estimate
  WHERE estimate.organization_id=org AND estimate.id=lock_value.estimate_id
  FOR UPDATE OF estimate NOWAIT;
  PERFORM 1 FROM public.canonical_forecast_estimate_source_fences source_fence
  WHERE source_fence.organization_id=org
   AND source_fence.estimate_id=lock_value.estimate_id
  FOR UPDATE OF source_fence NOWAIT;
 END LOOP;
 SELECT COALESCE((SELECT source_order
  FROM public.canonical_forecast_schedule_booking_events
  WHERE organization_id=org ORDER BY source_order DESC LIMIT 1),0)
 INTO high_water;
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
   rtrim(assignment.canonical_digest) schedule_digest,assignment.schedule_state,
   schedule_revision.id schedule_revision_id,
   execution_value.id execution_id,execution_value.revision execution_revision,
   rtrim(execution_value.canonical_digest) execution_digest,
   execution_value.assignment_id execution_assignment_id,
   execution_value.source_assignment_revision execution_source_schedule_revision,
   rtrim(execution_value.source_assignment_digest) execution_source_schedule_digest,
   execution_value.lifecycle_state,execution_revision.id execution_revision_id,
   CASE WHEN assignment.revision<>candidate.schedule_revision OR
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
 WITH active_members AS (
  SELECT member.*
  FROM jsonb_to_recordset(members) member(
   "appointmentId" UUID,"assignmentId" UUID,"scheduleRevision" BIGINT,
   "scheduleDigest" TEXT,"classification" TEXT)
  WHERE member."classification" IN
   ('approved_unscheduled','approved_scheduled','work_in_progress')
 ), reviewed AS MATERIALIZED (
  SELECT member.*,current_review.id review_id,current_review.revision review_revision,
   rtrim(current_review.digest) review_digest,current_review.estimate_id,
   CASE WHEN current_review.id IS NULL OR current_review.action='withdraw' THEN 'missing'
    WHEN current_review.assignment_id=member."assignmentId" AND
     current_review.assignment_revision=member."scheduleRevision" AND
     rtrim(current_review.assignment_digest)=member."scheduleDigest" AND
     NOT public.canonical_forecast_backlog_person_plan_stale(current_review)
     THEN 'available' ELSE 'not_current' END plan_state,
   current_review.planned_person_minutes
  FROM active_members member
  LEFT JOIN LATERAL(
   SELECT review.*
   FROM public.canonical_forecast_current_backlog_person_plan_reviews review
   WHERE review.organization_id=org
    AND review.appointment_id=member."appointmentId"
   ORDER BY review.revision DESC LIMIT 1) current_review ON TRUE
 ), plan_aggregate AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'appointmentId',"appointmentId",'assignmentId',"assignmentId",
    'classification',"classification",'state',plan_state,
    'reviewId',review_id,'reviewRevision',review_revision,
    'reviewDigest',review_digest,'estimateId',estimate_id,
    'plannedPersonMinutes',CASE WHEN plan_state='available'
      THEN planned_person_minutes ELSE NULL END)
    ORDER BY "appointmentId"),'[]'::jsonb) receipts,
   count(*) FILTER(WHERE plan_state='missing')::integer missing_count,
   count(*) FILTER(WHERE plan_state='not_current')::integer stale_count,
    sum(planned_person_minutes) FILTER(WHERE plan_state='available') available_minutes
  FROM reviewed)
  SELECT receipts,missing_count,stale_count,available_minutes
 INTO plan_receipts,missing_plan_count,stale_plan_count,planned_total
 FROM plan_aggregate;
 IF octet_length(plan_receipts::text)>262144 THEN
  RAISE EXCEPTION 'Current backlog person-plan receipt exceeds bounded size'
   USING ERRCODE='54000';
 END IF;
 IF planned_total>99999999999999.999999 THEN
  RAISE EXCEPTION 'Current backlog person-plan total exceeds supported range'
   USING ERRCODE='22023';
 END IF;
 IF unresolved_count>0 THEN
  hours_state:='unavailable';hours_reason:='unresolved_linkage_present';
  planned_total:=NULL;
 ELSIF unscheduled_count+scheduled_count+in_progress_count=0 THEN
  hours_state:='unavailable';hours_reason:='no_active_backlog';
  planned_total:=NULL;
 ELSIF missing_plan_count>0 THEN
  hours_state:='unavailable';hours_reason:='reviewed_person_hour_plan_missing';
  planned_total:=NULL;
 ELSIF stale_plan_count>0 THEN
  hours_state:='unavailable';hours_reason:='reviewed_person_hour_plan_not_current';
  planned_total:=NULL;
 ELSE
  hours_state:='available';hours_reason:=NULL;
 END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'sourceAuthority','northstar_authenticated_booking_schedule_and_execution_current_position',
  'organizationId',org,'scheduleSourceHighWaterOrder',high_water,'members',members,
  'personPlanCompositionVersion','m26-current-backlog-person-plan-composition-v1',
  'personPlanReceipts',plan_receipts));
 nonce:=gen_random_uuid();
 snapshot_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-current-backlog-position-v1','organizationId',org,
  'sourceDigest',source_hash,'digestNonce',nonce,
  'approvedUnscheduledCount',unscheduled_count,
  'approvedScheduledCount',scheduled_count,'workInProgressCount',in_progress_count,
  'completedCount',completed_value,'unresolvedLinkageCount',unresolved_count,
  'plannedPersonMinutes',planned_total,'backlogHoursState',hours_state,
  'backlogHoursReason',hours_reason));
 INSERT INTO public.canonical_forecast_current_backlog_snapshots(
  organization_id,schedule_source_high_water_order,member_receipts,
  approved_unscheduled_count,approved_scheduled_count,work_in_progress_count,
  completed_count,unresolved_linkage_count,source_digest,digest_nonce,
  snapshot_digest,actor_user_id,membership_id,auth_session_id,
  request_key_hash,request_digest,person_plan_composition_version,
  person_plan_receipts,planned_person_minutes,backlog_hours_state,
  backlog_hours_reason)
 VALUES(org,high_water,members,unscheduled_count,scheduled_count,in_progress_count,
  completed_value,unresolved_count,source_hash,nonce,snapshot_hash,actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash,
  'm26-current-backlog-person-plan-composition-v1',plan_receipts,planned_total,
  hours_state,hours_reason)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('snapshot',
  public.canonical_forecast_current_backlog_snapshot_projection(inserted,FALSE),
  'replayed',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_current_backlog_snapshot_read(
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
 PERFORM public.canonical_forecast_current_backlog_snapshot_source_lock(value);
 stale_value:=public.canonical_forecast_current_backlog_snapshot_stale(value);
 RETURN public.canonical_forecast_current_backlog_snapshot_projection(value,stale_value);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_source_lock(
 public.canonical_forecast_current_backlog_snapshots) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_stale(
 public.canonical_forecast_current_backlog_snapshots) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_projection(
 public.canonical_forecast_current_backlog_snapshots,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_current_backlog_snapshot_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
