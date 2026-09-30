-- Mission 26 Part 4C: private owner-reviewed person-hour plan authority.
-- This does not change schedules, reserve workers, prove complete backlog
-- coverage or issue a forecast. Existing migration bytes remain unchanged.

CREATE TABLE public.canonical_forecast_current_backlog_person_plan_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 appointment_id UUID NOT NULL,
 opportunity_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('approve','withdraw')),
 assignment_id UUID NOT NULL,
 assignment_revision BIGINT NOT NULL CHECK(assignment_revision>0),
 assignment_digest TEXT NOT NULL CHECK(assignment_digest~'^[0-9a-f]{64}$'),
 estimate_id UUID NOT NULL,
 estimate_decision_id UUID NOT NULL,
 estimate_decision_revision BIGINT NOT NULL CHECK(estimate_decision_revision>0),
 estimate_decision_digest TEXT NOT NULL CHECK(estimate_decision_digest~'^[0-9a-f]{64}$'),
 labor_plan_id UUID NOT NULL,
 labor_plan_revision BIGINT NOT NULL CHECK(labor_plan_revision>0),
 labor_plan_digest TEXT NOT NULL CHECK(labor_plan_digest~'^[0-9a-f]{64}$'),
 planned_person_minutes NUMERIC(20,6) NOT NULL CHECK(planned_person_minutes>0),
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(
  confirmation_version='m26-current-backlog-person-plan-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,appointment_id,id),
 UNIQUE(organization_id,appointment_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,appointment_id)
  REFERENCES public.canonical_appointments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,opportunity_id)
  REFERENCES public.canonical_opportunities(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,assignment_id)
  REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id)
  REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id,estimate_decision_id)
  REFERENCES public.canonical_estimate_decisions(organization_id,estimate_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id,labor_plan_id)
  REFERENCES public.canonical_labor_plans(organization_id,estimate_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,appointment_id,previous_id)
  REFERENCES public.canonical_forecast_current_backlog_person_plan_reviews(
   organization_id,appointment_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE INDEX canonical_forecast_backlog_person_plan_tenant_current
 ON public.canonical_forecast_current_backlog_person_plan_reviews(
  organization_id,appointment_id,revision DESC);

CREATE FUNCTION public.canonical_forecast_backlog_person_plan_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Backlog person-plan reviews are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_backlog_person_plan_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_current_backlog_person_plan_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION
  public.canonical_forecast_backlog_person_plan_immutable();

CREATE FUNCTION public.canonical_forecast_backlog_person_plan_stale(
 value public.canonical_forecast_current_backlog_person_plan_reviews)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value.action='approve' AND NOT EXISTS(
  SELECT 1
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=position_value.organization_id
   AND assignment.id=position_value.assignment_id
   AND assignment.appointment_id=position_value.appointment_id
  JOIN public.canonical_estimates estimate
   ON estimate.organization_id=assignment.organization_id
   AND estimate.id=value.estimate_id
   AND estimate.opportunity_id=assignment.opportunity_id
  JOIN public.canonical_estimate_decisions decision_value
   ON decision_value.organization_id=estimate.organization_id
   AND decision_value.estimate_id=estimate.id
   AND decision_value.id=value.estimate_decision_id
  JOIN public.canonical_labor_plans plan_value
   ON plan_value.organization_id=estimate.organization_id
   AND plan_value.estimate_id=estimate.id
   AND plan_value.id=value.labor_plan_id
  WHERE position_value.organization_id=value.organization_id
   AND position_value.appointment_id=value.appointment_id
   AND position_value.active
   AND assignment.id=value.assignment_id
   AND assignment.revision=value.assignment_revision
   AND rtrim(assignment.canonical_digest)=value.assignment_digest
   AND decision_value.revision=value.estimate_decision_revision
   AND rtrim(decision_value.digest)=value.estimate_decision_digest
   AND decision_value.action='approve'
   AND decision_value.id=(SELECT current_decision.id
    FROM public.canonical_estimate_decisions current_decision
    WHERE current_decision.organization_id=value.organization_id
     AND current_decision.estimate_id=value.estimate_id
    ORDER BY current_decision.revision DESC LIMIT 1)
   AND plan_value.revision=value.labor_plan_revision
   AND rtrim(plan_value.digest)=value.labor_plan_digest
   AND plan_value.action='save'
   AND plan_value.expected_decision_revision=decision_value.revision
   AND rtrim(plan_value.expected_decision_digest)=rtrim(decision_value.digest)
   AND plan_value.id=(SELECT current_plan.id
    FROM public.canonical_labor_plans current_plan
    WHERE current_plan.organization_id=value.organization_id
     AND current_plan.estimate_id=value.estimate_id
    ORDER BY current_plan.revision DESC LIMIT 1)
 )
$$;

CREATE FUNCTION public.canonical_forecast_backlog_person_plan_projection(
 value public.canonical_forecast_current_backlog_person_plan_reviews,
 stale_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,'appointmentId',value.appointment_id,
  'revision',value.revision,'previousId',value.previous_id,
  'action',value.action,
  'state',CASE WHEN stale_value THEN 'source_stale'
    WHEN value.action='withdraw' THEN 'withdrawn' ELSE 'approved' END,
  'plannedPersonMinutes',CASE WHEN value.action='approve' AND NOT stale_value
    THEN value.planned_person_minutes::text ELSE NULL END,
  'reason',value.reason,'createdAt',value.created_at,'digest',rtrim(value.digest),
  'sourceAuthority','owner_reviewed_m24_labor_plan_for_authenticated_booking',
  'sourceAuthenticated',NOT stale_value,'sourceCurrent',NOT stale_value,
  'knownSubsetOnly',TRUE,'sourceCoverageComplete',FALSE,
  'offPlatformCoverageVerified',FALSE,'providerCoverageVerified',FALSE,
  'forecastIssued',FALSE,'paidNumericServing',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_backlog_person_plan_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 appointment_value UUID,body JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;key_hash TEXT;request_hash TEXT;next_revision BIGINT;
 current_value public.canonical_forecast_current_backlog_person_plan_reviews%ROWTYPE;
 replay_value public.canonical_forecast_current_backlog_person_plan_reviews%ROWTYPE;
 inserted public.canonical_forecast_current_backlog_person_plan_reviews%ROWTYPE;
 assignment_value public.canonical_schedule_assignments%ROWTYPE;
 estimate_value public.canonical_estimates%ROWTYPE;
 decision_value public.canonical_estimate_decisions%ROWTYPE;
 plan_value public.canonical_labor_plans%ROWTYPE;
 planned_minutes NUMERIC(20,6);source_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY[
   'action','expectedCurrentReviewId','expectedCurrentReviewDigest',
   'assignmentId','expectedAssignmentRevision','expectedAssignmentDigest',
   'estimateId','laborPlanId','expectedLaborPlanRevision',
   'expectedLaborPlanDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' NOT IN('approve','withdraw') OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR
  body->>'confirmationVersion' IS DISTINCT FROM
   'm26-current-backlog-person-plan-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR
  length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  NOT ((body->'expectedCurrentReviewId'='null'::jsonb AND
    body->>'expectedCurrentReviewDigest'='none') OR
   (jsonb_typeof(body->'expectedCurrentReviewId')='string' AND
    (body->>'expectedCurrentReviewId')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
    (body->>'expectedCurrentReviewDigest')~'^[0-9a-f]{64}$')) THEN
  RAISE EXCEPTION 'Backlog person-plan review input invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'appointmentId',appointment_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:backlog-person-plan:'||org::text||':'||appointment_value::text,0));
 SELECT * INTO replay_value
 FROM public.canonical_forecast_current_backlog_person_plan_reviews
 WHERE organization_id=org AND actor_user_id=actor
  AND request_key_hash=key_hash;
 IF FOUND THEN
  IF replay_value.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Backlog person-plan request key changed' USING ERRCODE='23505';
  END IF;
  PERFORM public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('review',
   public.canonical_forecast_backlog_person_plan_projection(replay_value,
    public.canonical_forecast_backlog_person_plan_stale(replay_value)),
   'replayed',TRUE);
 END IF;
 SELECT * INTO current_value
 FROM public.canonical_forecast_current_backlog_person_plan_reviews
 WHERE organization_id=org AND appointment_id=appointment_value
 ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF COALESCE(current_value.id::text,'') IS DISTINCT FROM
    COALESCE(NULLIF(body->>'expectedCurrentReviewId','')::uuid::text,'') OR
  COALESCE(current_value.digest,'none') IS DISTINCT FROM
    body->>'expectedCurrentReviewDigest' THEN
  RAISE EXCEPTION 'Backlog person-plan review changed' USING ERRCODE='40001';
 END IF;
 IF body->>'action'='withdraw' THEN
  IF current_value.id IS NULL OR current_value.action<>'approve' OR
   body->'assignmentId'<>'null'::jsonb OR
   body->'expectedAssignmentRevision'<>'null'::jsonb OR
   body->'expectedAssignmentDigest'<>'null'::jsonb OR
   body->'estimateId'<>'null'::jsonb OR body->'laborPlanId'<>'null'::jsonb OR
   body->'expectedLaborPlanRevision'<>'null'::jsonb OR
   body->'expectedLaborPlanDigest'<>'null'::jsonb THEN
   RAISE EXCEPTION 'Backlog person-plan withdrawal invalid' USING ERRCODE='22023';
  END IF;
  assignment_value.id:=current_value.assignment_id;
  assignment_value.opportunity_id:=current_value.opportunity_id;
  assignment_value.revision:=current_value.assignment_revision;
  assignment_value.canonical_digest:=current_value.assignment_digest;
  estimate_value.id:=current_value.estimate_id;
  decision_value.id:=current_value.estimate_decision_id;
  decision_value.revision:=current_value.estimate_decision_revision;
  decision_value.digest:=current_value.estimate_decision_digest;
  plan_value.id:=current_value.labor_plan_id;
  plan_value.revision:=current_value.labor_plan_revision;
  plan_value.digest:=current_value.labor_plan_digest;
  planned_minutes:=current_value.planned_person_minutes;
  source_hash:=current_value.source_digest;
 ELSE
  IF jsonb_typeof(body->'assignmentId') IS DISTINCT FROM 'string' OR
   jsonb_typeof(body->'expectedAssignmentRevision') IS DISTINCT FROM 'number' OR
   jsonb_typeof(body->'expectedAssignmentDigest') IS DISTINCT FROM 'string' OR
   jsonb_typeof(body->'estimateId') IS DISTINCT FROM 'string' OR
   jsonb_typeof(body->'laborPlanId') IS DISTINCT FROM 'string' OR
   jsonb_typeof(body->'expectedLaborPlanRevision') IS DISTINCT FROM 'number' OR
   jsonb_typeof(body->'expectedLaborPlanDigest') IS DISTINCT FROM 'string' OR
   (body->>'assignmentId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
   (body->>'estimateId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
   (body->>'laborPlanId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
   (body->>'expectedAssignmentRevision')!~'^[1-9][0-9]{0,18}$' OR
   (body->>'expectedLaborPlanRevision')!~'^[1-9][0-9]{0,18}$' OR
   (body->>'expectedAssignmentDigest')!~'^[0-9a-f]{64}$' OR
   (body->>'expectedLaborPlanDigest')!~'^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Backlog person-plan pins invalid' USING ERRCODE='22023';
  END IF;
  SELECT assignment.* INTO STRICT assignment_value
  FROM public.canonical_forecast_current_backlog_booking_positions position_value
  JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=position_value.organization_id
   AND assignment.id=position_value.assignment_id
   AND assignment.appointment_id=position_value.appointment_id
  WHERE position_value.organization_id=org
   AND position_value.appointment_id=appointment_value AND position_value.active
   AND assignment.id=(body->>'assignmentId')::uuid FOR UPDATE OF assignment;
  IF assignment_value.revision<>(body->>'expectedAssignmentRevision')::bigint OR
   rtrim(assignment_value.canonical_digest)<>body->>'expectedAssignmentDigest' THEN
   RAISE EXCEPTION 'Backlog schedule source changed' USING ERRCODE='40001';
  END IF;
  SELECT * INTO STRICT estimate_value FROM public.canonical_estimates
  WHERE organization_id=org AND id=(body->>'estimateId')::uuid
   AND opportunity_id=assignment_value.opportunity_id;
  SELECT * INTO STRICT decision_value
  FROM public.canonical_estimate_decisions
  WHERE organization_id=org AND estimate_id=estimate_value.id
  ORDER BY revision DESC LIMIT 1;
  IF decision_value.action<>'approve' THEN
   RAISE EXCEPTION 'Current estimate approval unavailable' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT plan_value FROM public.canonical_labor_plans
  WHERE organization_id=org AND estimate_id=estimate_value.id
   AND id=(body->>'laborPlanId')::uuid
  ORDER BY revision DESC LIMIT 1;
  IF plan_value.id IS DISTINCT FROM (SELECT current_plan.id
      FROM public.canonical_labor_plans current_plan
      WHERE current_plan.organization_id=org
       AND current_plan.estimate_id=estimate_value.id
      ORDER BY current_plan.revision DESC LIMIT 1) OR
   plan_value.action<>'save' OR
   plan_value.revision<>(body->>'expectedLaborPlanRevision')::bigint OR
   rtrim(plan_value.digest)<>body->>'expectedLaborPlanDigest' OR
   plan_value.expected_decision_revision<>decision_value.revision OR
   rtrim(plan_value.expected_decision_digest)<>rtrim(decision_value.digest) THEN
   RAISE EXCEPTION 'Current labor plan source changed' USING ERRCODE='40001';
  END IF;
  planned_minutes:=round(public.canonical_labor_plan_worker_hours(
   plan_value.inputs)*60,6);
  IF planned_minutes<=0 THEN
   RAISE EXCEPTION 'Positive approved person-hours required' USING ERRCODE='22023';
  END IF;
  source_hash:=public.canonical_completion_digest(jsonb_build_object(
   'appointmentId',appointment_value,'opportunityId',assignment_value.opportunity_id,
   'assignmentId',assignment_value.id,'assignmentRevision',assignment_value.revision,
   'assignmentDigest',rtrim(assignment_value.canonical_digest),
   'estimateId',estimate_value.id,'estimateDecisionId',decision_value.id,
   'estimateDecisionRevision',decision_value.revision,
   'estimateDecisionDigest',rtrim(decision_value.digest),
   'laborPlanId',plan_value.id,'laborPlanRevision',plan_value.revision,
   'laborPlanDigest',rtrim(plan_value.digest),
   'plannedPersonMinutes',planned_minutes));
 END IF;
 next_revision:=COALESCE(current_value.revision,0)+1;
 IF next_revision>10000 THEN
  RAISE EXCEPTION 'Backlog person-plan review limit reached' USING ERRCODE='54000';
 END IF;
 INSERT INTO public.canonical_forecast_current_backlog_person_plan_reviews(
  organization_id,appointment_id,opportunity_id,revision,previous_id,action,
  assignment_id,assignment_revision,assignment_digest,estimate_id,
  estimate_decision_id,estimate_decision_revision,estimate_decision_digest,
  labor_plan_id,labor_plan_revision,labor_plan_digest,planned_person_minutes,
  source_digest,actor_user_id,membership_id,auth_session_id,reason,
  confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,appointment_value,assignment_value.opportunity_id,next_revision,
  current_value.id,body->>'action',assignment_value.id,assignment_value.revision,
  rtrim(assignment_value.canonical_digest),estimate_value.id,decision_value.id,
  decision_value.revision,rtrim(decision_value.digest),plan_value.id,
  plan_value.revision,rtrim(plan_value.digest),planned_minutes,source_hash,actor,
  (authority->>'membershipId')::uuid,session_value,btrim(body->>'reason'),
  'm26-current-backlog-person-plan-v1',key_hash,request_hash,
  public.canonical_completion_digest(jsonb_build_object(
   'organizationId',org,'appointmentId',appointment_value,
   'revision',next_revision,'previousId',current_value.id,
   'action',body->>'action','sourceDigest',source_hash,'actorId',actor,
   'membershipId',authority->>'membershipId','sessionId',session_value,
   'reason',btrim(body->>'reason')))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('review',
  public.canonical_forecast_backlog_person_plan_projection(inserted,FALSE),
  'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_backlog_person_plan_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,appointment_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value public.canonical_forecast_current_backlog_person_plan_reviews%ROWTYPE;
 history_value JSONB;total_value BIGINT;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO current_value
 FROM public.canonical_forecast_current_backlog_person_plan_reviews
 WHERE organization_id=org AND appointment_id=appointment_value
 ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total_value
 FROM public.canonical_forecast_current_backlog_person_plan_reviews
 WHERE organization_id=org AND appointment_id=appointment_value;
 SELECT COALESCE(jsonb_agg(
  public.canonical_forecast_backlog_person_plan_projection(item,
   public.canonical_forecast_backlog_person_plan_stale(item))
  ORDER BY item.revision DESC),'[]'::jsonb) INTO history_value
 FROM (SELECT *
  FROM public.canonical_forecast_current_backlog_person_plan_reviews
  WHERE organization_id=org AND appointment_id=appointment_value
  ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('current',CASE WHEN current_value.id IS NULL THEN NULL
   ELSE public.canonical_forecast_backlog_person_plan_projection(current_value,
    public.canonical_forecast_backlog_person_plan_stale(current_value)) END,
  'history',history_value,'total',total_value,'truncated',total_value>20,
  'boundary','Reviewed person-hours cover only this authenticated NorthStar booking; complete backlog coverage and forecasts remain unavailable.');
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_current_backlog_person_plan_reviews FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_backlog_person_plan_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_backlog_person_plan_stale(
 public.canonical_forecast_current_backlog_person_plan_reviews) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_backlog_person_plan_projection(
 public.canonical_forecast_current_backlog_person_plan_reviews,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_backlog_person_plan_mutate(
 uuid,uuid,text,uuid,text,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_backlog_person_plan_read(
 uuid,uuid,text,uuid,uuid) FROM PUBLIC;
