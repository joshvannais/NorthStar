-- Mission 26 Part 4B: bounded first accepted-booking transition cohort.
-- The denominator is canonical NorthStar opportunities visible by the cutoff
-- that have never reached a genuine human-approved accepted-booking event.
-- Exact identities remain tenant-private. The output is descriptive history,
-- not complete coverage, calibration, a forecast, or a paid numeric claim.

CREATE SEQUENCE public.canonical_forecast_opportunity_eligibility_order_sequence;
CREATE TABLE public.canonical_forecast_opportunity_eligibility_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_order BIGINT NOT NULL DEFAULT nextval(
  'public.canonical_forecast_opportunity_eligibility_order_sequence'),
 operation_id UUID NOT NULL,
 graph_id UUID NOT NULL,
 opportunity_id UUID NOT NULL,
 transcript_id UUID NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('lead','retell','voice')),
 visible_at TIMESTAMPTZ NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source_order),
 UNIQUE(organization_id,operation_id),
 UNIQUE(organization_id,opportunity_id)
);
CREATE INDEX canonical_forecast_opportunity_eligibility_events_tenant_visible
 ON public.canonical_forecast_opportunity_eligibility_events(
  organization_id,visible_at,source_order);
CREATE INDEX canonical_forecast_opportunity_eligibility_events_tenant_order
 ON public.canonical_forecast_opportunity_eligibility_events(
  organization_id,source_order);

CREATE FUNCTION public.canonical_forecast_opportunity_eligibility_event_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Opportunity eligibility events are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_opportunity_eligibility_event_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_opportunity_eligibility_events
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_opportunity_eligibility_event_immutable();

CREATE FUNCTION public.canonical_forecast_opportunity_eligibility_lock()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD.state IS DISTINCT FROM 'completed' AND NEW.state='completed' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||NEW.organization_id::text,0));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_canonical_forecast_opportunity_eligibility_lock
 BEFORE UPDATE OF state ON public.canonical_operations
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_opportunity_eligibility_lock();

CREATE FUNCTION public.canonical_forecast_opportunity_eligibility_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE opportunity_value UUID;transcript_value UUID;source_value TEXT;
 order_value BIGINT;digest_value TEXT;
BEGIN
 IF OLD.state IS DISTINCT FROM 'completed' AND NEW.state='completed' THEN
  SELECT opportunity.id,transcript.id,
   public.canonical_labor_transcript_source_normalized(transcript.source)
  INTO opportunity_value,transcript_value,source_value
  FROM public.canonical_opportunities opportunity
  JOIN public.canonical_transcripts transcript
   ON transcript.organization_id=opportunity.organization_id
   AND transcript.operation_id=opportunity.operation_id
   AND transcript.graph_id=opportunity.graph_id
  WHERE opportunity.organization_id=NEW.organization_id
   AND opportunity.operation_id=NEW.id AND opportunity.graph_id=NEW.graph_id
   AND public.canonical_labor_transcript_source_normalized(transcript.source)
    IN ('lead','retell','voice')
  ORDER BY opportunity.id,transcript.id LIMIT 1;
  IF FOUND THEN
   order_value:=nextval(
    'public.canonical_forecast_opportunity_eligibility_order_sequence');
   digest_value:=public.canonical_completion_digest(jsonb_build_object(
    'version','m26-opportunity-eligibility-event-v1',
    'organizationId',NEW.organization_id,'operationId',NEW.id,
    'graphId',NEW.graph_id,'opportunityId',opportunity_value,
    'transcriptId',transcript_value,'sourceKind',source_value,
    'visibleAt',public.canonical_forecast_utc_instant(NEW.completed_at),
    'sourceOrder',order_value));
   INSERT INTO public.canonical_forecast_opportunity_eligibility_events(
    organization_id,source_order,operation_id,graph_id,opportunity_id,
    transcript_id,source_kind,visible_at,source_digest)
   VALUES(NEW.organization_id,order_value,NEW.id,NEW.graph_id,opportunity_value,
    transcript_value,source_value,NEW.completed_at,digest_value);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_opportunity_eligibility_capture
 AFTER UPDATE OF state ON public.canonical_operations
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_opportunity_eligibility_capture();

CREATE TABLE public.canonical_forecast_opportunity_eligibility_activations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_event_id UUID NOT NULL,
 source_order BIGINT NOT NULL,
 operation_id UUID NOT NULL,
 graph_id UUID NOT NULL,
 opportunity_id UUID NOT NULL,
 transcript_id UUID NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('lead','retell','voice')),
 visible_at TIMESTAMPTZ NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_event_id),
 UNIQUE(organization_id,source_order),
 UNIQUE(organization_id,opportunity_id)
);
CREATE INDEX canonical_forecast_opportunity_eligibility_activations_tenant_visible
 ON public.canonical_forecast_opportunity_eligibility_activations(
  organization_id,visible_at,source_order);

CREATE FUNCTION public.canonical_forecast_opportunity_eligibility_activation_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Opportunity eligibility activations are immutable'
  USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_opportunity_eligibility_activation_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_opportunity_eligibility_activations
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_opportunity_eligibility_activation_immutable();

CREATE FUNCTION public.canonical_forecast_opportunity_eligibility_activate(org UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE visible_time TIMESTAMPTZ;pending_count INTEGER;
BEGIN
 SELECT count(*)::integer INTO pending_count FROM (
  SELECT 1
  FROM public.canonical_forecast_opportunity_eligibility_events source_value
  WHERE source_value.organization_id=org
   AND NOT EXISTS(SELECT 1
    FROM public.canonical_forecast_opportunity_eligibility_activations activated
    WHERE activated.organization_id=source_value.organization_id
     AND activated.source_event_id=source_value.id)
  ORDER BY source_value.source_order
  LIMIT 501) pending;
 IF pending_count>500 THEN
  RAISE EXCEPTION 'Opportunity eligibility activation backlog exceeds bounded size'
   USING ERRCODE='54000';
 END IF;
 visible_time:=clock_timestamp();
 INSERT INTO public.canonical_forecast_opportunity_eligibility_activations(
  organization_id,source_event_id,source_order,operation_id,graph_id,
  opportunity_id,transcript_id,source_kind,visible_at,source_digest)
 SELECT source_value.organization_id,source_value.id,source_value.source_order,
  source_value.operation_id,source_value.graph_id,source_value.opportunity_id,
  source_value.transcript_id,source_value.source_kind,visible_time,
  public.canonical_completion_digest(jsonb_build_object(
   'version','m26-opportunity-eligibility-activation-v1',
   'organizationId',source_value.organization_id,
   'sourceEventId',source_value.id,'sourceOrder',source_value.source_order,
   'sourceDigest',rtrim(source_value.source_digest),
   'visibleAt',public.canonical_forecast_utc_instant(visible_time)))
 FROM public.canonical_forecast_opportunity_eligibility_events source_value
 WHERE source_value.organization_id=org
  AND NOT EXISTS(SELECT 1
   FROM public.canonical_forecast_opportunity_eligibility_activations activated
   WHERE activated.organization_id=source_value.organization_id
    AND activated.source_event_id=source_value.id)
 ORDER BY source_value.source_order
 LIMIT 500
 ON CONFLICT(organization_id,source_event_id) DO NOTHING;
END $$;

CREATE TABLE public.canonical_forecast_schedule_booking_transition_cohorts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 cutoff_at TIMESTAMPTZ NOT NULL,
 horizon_ends_at TIMESTAMPTZ NOT NULL,
 source_high_water_order BIGINT NOT NULL CHECK(source_high_water_order>=0),
 opportunity_source_high_water_order BIGINT NOT NULL
  CHECK(opportunity_source_high_water_order>=0),
 member_receipts JSONB NOT NULL CHECK(jsonb_typeof(member_receipts)='array'),
 eligible_count INTEGER NOT NULL CHECK(eligible_count BETWEEN 0 AND 500),
 booked_count INTEGER NOT NULL CHECK(booked_count BETWEEN 0 AND eligible_count),
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
CREATE INDEX canonical_forecast_schedule_booking_transition_cohorts_tenant
 ON public.canonical_forecast_schedule_booking_transition_cohorts(
  organization_id,captured_at DESC,id);

CREATE FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Schedule booking transition cohorts are immutable'
  USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_schedule_booking_transition_cohort_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_schedule_booking_transition_cohorts
 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_immutable();

CREATE FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_projection(
 value public.canonical_forecast_schedule_booking_transition_cohorts,
 stale_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,
  'version','m26-schedule-booking-transition-cohort-v1',
  'targetKey','demand.booking_transition.v1',
  'state',CASE WHEN stale_value THEN 'source_stale'
    WHEN value.eligible_count=0 THEN 'unavailable' ELSE 'descriptive_only' END,
  'reason',CASE WHEN stale_value THEN 'source_changed_inside_horizon'
    WHEN value.eligible_count=0 THEN 'insufficient_history' ELSE NULL END,
  'cutoffAt',public.canonical_forecast_utc_instant(value.cutoff_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(value.horizon_ends_at),
  'capturedAt',public.canonical_forecast_utc_instant(value.captured_at),
  'eligibleCount',CASE WHEN stale_value THEN 0 ELSE value.eligible_count END,
  'bookedCount',CASE WHEN stale_value THEN 0 ELSE value.booked_count END,
  'observedRate',CASE WHEN stale_value OR value.eligible_count=0 THEN NULL ELSE
   trim(trailing '.' FROM trim(trailing '0' FROM
    round(value.booked_count::numeric/value.eligible_count::numeric,6)::text)) END,
  'sourceDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.source_digest) END,
  'cohortDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.cohort_digest) END,
  'sourceAuthority','northstar_canonical_opportunity_and_human_approved_schedule_history',
  'sourceAuthenticated',NOT stale_value,
  'sourceCoverageComplete',FALSE,
  'offPlatformCoverageVerified',FALSE,
  'providerCoverageVerified',FALSE,
  'probabilityCalibrated',FALSE,
  'confidence','unavailable',
  'forecastIssued',FALSE,
  'paidNumericServing',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
 existing public.canonical_forecast_schedule_booking_transition_cohorts%ROWTYPE;
 inserted public.canonical_forecast_schedule_booking_transition_cohorts%ROWTYPE;
 key_hash TEXT;request_hash TEXT;members JSONB;source_hash TEXT;cohort_hash TEXT;
 nonce UUID;eligible INTEGER;booked INTEGER;high_water BIGINT;
 opportunity_high_water BIGINT;stale_value BOOLEAN;
 source_count INTEGER;candidate_count INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
 cutoff_value IS NULL OR horizon_value IS NULL OR horizon_value<=cutoff_value OR
  horizon_value>clock_timestamp() OR
  horizon_value-cutoff_value>INTERVAL '90 days' OR key_value IS NULL OR
  key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Schedule booking transition cohort input invalid'
   USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:schedule-booking-transition:'||org::text||':'||actor::text||':'||key_hash,0));
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:opportunity-eligibility:'||org::text,0)) THEN
  RAISE EXCEPTION 'Opportunity eligibility source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:schedule-booking-events:'||org::text,0)) THEN
  RAISE EXCEPTION 'Schedule booking source is busy' USING ERRCODE='55P03';
 END IF;
 PERFORM public.canonical_forecast_opportunity_eligibility_activate(org);
 SELECT * INTO existing
 FROM public.canonical_forecast_schedule_booking_transition_cohorts
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF existing.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Schedule booking transition replay changed' USING ERRCODE='23505';
  END IF;
  SELECT EXISTS(
   SELECT 1 FROM public.canonical_forecast_schedule_booking_events event_value
   WHERE event_value.organization_id=org
    AND event_value.source_order>existing.source_high_water_order
    AND event_value.occurred_at<=existing.horizon_ends_at
   UNION ALL
   SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps gap_value
   WHERE gap_value.organization_id=org
    AND gap_value.uncertain_from_at<=existing.horizon_ends_at
   UNION ALL
   SELECT 1 FROM public.canonical_forecast_opportunity_eligibility_activations source_value
   WHERE source_value.organization_id=org
    AND source_value.source_order>existing.opportunity_source_high_water_order
    AND source_value.visible_at<=existing.cutoff_at) INTO stale_value;
  RETURN jsonb_build_object('cohort',
   public.canonical_forecast_schedule_booking_transition_cohort_projection(
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
 SELECT COALESCE(MAX(source_order),0) INTO opportunity_high_water
 FROM public.canonical_forecast_opportunity_eligibility_activations
 WHERE organization_id=org;
 IF opportunity_high_water>9007199254740991 THEN
  RAISE EXCEPTION 'Opportunity eligibility source exceeds safe order size'
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
  SELECT source_value.id
  FROM public.canonical_forecast_opportunity_eligibility_activations source_value
  WHERE source_value.organization_id=org AND source_value.visible_at<=cutoff_value
  ORDER BY source_value.visible_at,source_value.source_order
  LIMIT 501) bounded_candidates;
 IF candidate_count>500 THEN
  RAISE EXCEPTION 'Schedule booking cohort exceeds bounded candidate size'
   USING ERRCODE='54000';
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT source_value.id opportunity_source_activation_id,
   source_value.source_event_id opportunity_source_event_id,
   source_value.source_order opportunity_source_order,
   source_value.source_digest opportunity_source_digest,
   source_value.opportunity_id,source_value.visible_at opportunity_visible_at
  FROM public.canonical_forecast_opportunity_eligibility_activations source_value
  WHERE source_value.organization_id=org AND source_value.visible_at<=cutoff_value
  ORDER BY source_value.visible_at,source_value.source_order
  LIMIT 500
 ), eligible_rows AS MATERIALIZED (
  SELECT candidate.*,
   accepted.id accepted_event_id,accepted.assignment_id accepted_assignment_id,
   accepted.appointment_id accepted_appointment_id,
   accepted.source_order accepted_source_order,accepted.occurred_at accepted_at
  FROM candidates candidate
  LEFT JOIN LATERAL (
   SELECT event_value.*
   FROM public.canonical_forecast_schedule_booking_events event_value
   JOIN public.canonical_appointments appointment
    ON appointment.organization_id=event_value.organization_id
    AND appointment.id=event_value.appointment_id
   WHERE event_value.organization_id=org
    AND appointment.opportunity_id=candidate.opportunity_id
    AND event_value.transition_kind='accepted_booking'
    AND event_value.occurred_at>cutoff_value
    AND event_value.occurred_at<=horizon_value
   ORDER BY event_value.occurred_at,event_value.source_order LIMIT 1) accepted ON TRUE
  WHERE NOT EXISTS(
   SELECT 1 FROM public.canonical_forecast_schedule_booking_events prior
   JOIN public.canonical_appointments prior_appointment
    ON prior_appointment.organization_id=prior.organization_id
    AND prior_appointment.id=prior.appointment_id
   WHERE prior.organization_id=org
    AND prior_appointment.opportunity_id=candidate.opportunity_id
    AND prior.transition_kind='accepted_booking'
    AND prior.occurred_at<=cutoff_value)
 )
 SELECT count(*)::integer,
  COALESCE(jsonb_agg(jsonb_build_object(
   'opportunitySourceActivationId',opportunity_source_activation_id,
   'opportunitySourceEventId',opportunity_source_event_id,
   'opportunitySourceOrder',opportunity_source_order,
   'opportunitySourceDigest',rtrim(opportunity_source_digest),
   'opportunityId',opportunity_id,
   'opportunityVisibleAt',public.canonical_forecast_utc_instant(opportunity_visible_at),
   'acceptedEventId',accepted_event_id,
   'acceptedAssignmentId',accepted_assignment_id,
   'acceptedAppointmentId',accepted_appointment_id,
   'acceptedSourceOrder',accepted_source_order,
   'acceptedAt',public.canonical_forecast_utc_instant(accepted_at))
   ORDER BY opportunity_id),'[]'::jsonb),
  count(accepted_event_id)::integer
 INTO eligible,members,booked FROM eligible_rows;
 IF eligible>500 OR octet_length(members::text)>262144 THEN
  RAISE EXCEPTION 'Schedule booking cohort exceeds bounded size' USING ERRCODE='54000';
 END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'sourceAuthority','northstar_canonical_opportunity_and_human_approved_schedule_history',
  'organizationId',org,'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value),
  'sourceHighWaterOrder',high_water,
  'opportunitySourceHighWaterOrder',opportunity_high_water,'members',members));
 nonce:=gen_random_uuid();
 cohort_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-schedule-booking-transition-cohort-v1',
  'organizationId',org,'sourceDigest',source_hash,'digestNonce',nonce,
  'eligibleCount',eligible,'bookedCount',booked));
 INSERT INTO public.canonical_forecast_schedule_booking_transition_cohorts(
 organization_id,cutoff_at,horizon_ends_at,source_high_water_order,
  opportunity_source_high_water_order,
  member_receipts,eligible_count,booked_count,source_digest,digest_nonce,
  cohort_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,cutoff_value,horizon_value,high_water,opportunity_high_water,
  members,eligible,booked,
  source_hash,nonce,cohort_hash,actor,(authority->>'membershipId')::uuid,
  session_value,key_hash,request_hash)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('cohort',
  public.canonical_forecast_schedule_booking_transition_cohort_projection(
   inserted,FALSE),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,cohort_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_forecast_schedule_booking_transition_cohorts%ROWTYPE;
 stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for schedule booking transition cohort read'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:schedule-booking-events:'||org::text,0)) THEN
  RAISE EXCEPTION 'Schedule booking source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO value
 FROM public.canonical_forecast_schedule_booking_transition_cohorts
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
   AND gap_value.uncertain_from_at<=value.horizon_ends_at
  UNION ALL
  SELECT 1 FROM public.canonical_forecast_opportunity_eligibility_activations source_value
  WHERE source_value.organization_id=org
   AND source_value.source_order>value.opportunity_source_high_water_order
   AND source_value.visible_at<=value.cutoff_at) INTO stale_value;
 RETURN public.canonical_forecast_schedule_booking_transition_cohort_projection(
  value,stale_value);
END $$;

REVOKE ALL ON SEQUENCE public.canonical_forecast_schedule_booking_event_order_sequence FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.canonical_forecast_opportunity_eligibility_order_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_schedule_booking_events FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_schedule_booking_lineage_gaps FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_opportunity_eligibility_events FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_opportunity_eligibility_activations FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_schedule_booking_transition_cohorts FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_event_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_lineage_gap_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_event_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_event_capture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_opportunity_eligibility_event_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_opportunity_eligibility_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_opportunity_eligibility_capture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_opportunity_eligibility_activation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_opportunity_eligibility_activate(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_projection(
 public.canonical_forecast_schedule_booking_transition_cohorts,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_schedule_booking_transition_cohort_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
