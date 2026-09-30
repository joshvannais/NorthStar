-- Mission 26 Part 4B: tenant-private, human-reviewed lead qualification
-- history and one ended-horizon descriptive cohort. This source is limited to
-- canonical NorthStar lead opportunities that an owner or administrator has
-- explicitly reviewed. It does not establish provider or off-platform
-- coverage, calibration, a forecast, or permission to serve a paid number.

CREATE SEQUENCE public.canonical_lead_state_review_order_sequence AS BIGINT;

CREATE TABLE public.canonical_lead_state_reviews (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 opportunity_id UUID NOT NULL,
 review_order BIGINT NOT NULL DEFAULT nextval('public.canonical_lead_state_review_order_sequence'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 1000),
 previous_id UUID,
 event_key UUID NOT NULL,
 supersedes_id UUID,
 action TEXT NOT NULL CHECK(action IN ('observe','correct')),
 qualification_state TEXT NOT NULL CHECK(qualification_state IN ('open','qualified','unqualified','closed')),
 effective_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,1000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,opportunity_id,revision),
 UNIQUE(organization_id,review_order),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,opportunity_id,id),
 FOREIGN KEY(organization_id,opportunity_id)
  REFERENCES public.canonical_opportunities(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,opportunity_id,previous_id)
  REFERENCES public.canonical_lead_state_reviews(organization_id,opportunity_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,opportunity_id,event_key)
  REFERENCES public.canonical_lead_state_reviews(organization_id,opportunity_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,opportunity_id,supersedes_id)
  REFERENCES public.canonical_lead_state_reviews(organization_id,opportunity_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CHECK((action='observe' AND supersedes_id IS NULL AND event_key=id) OR
       (action='correct' AND supersedes_id IS NOT NULL AND event_key<>id))
);
CREATE INDEX canonical_lead_state_reviews_tenant_order
 ON public.canonical_lead_state_reviews(organization_id,review_order DESC);
CREATE INDEX canonical_lead_state_reviews_tenant_opportunity_time
 ON public.canonical_lead_state_reviews(
  organization_id,opportunity_id,effective_at,review_order);
CREATE INDEX canonical_lead_state_reviews_tenant_event_revision
 ON public.canonical_lead_state_reviews(
  organization_id,event_key,revision DESC);

CREATE TABLE public.canonical_lead_state_finalizations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 recorded_through TIMESTAMPTZ NOT NULL,
 source_high_water_order BIGINT NOT NULL CHECK(source_high_water_order>=0),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,1000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_lead_state_finalizations(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);
CREATE INDEX canonical_lead_state_finalizations_tenant_revision
 ON public.canonical_lead_state_finalizations(organization_id,revision DESC);

CREATE TABLE public.canonical_forecast_lead_qualification_cohorts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 cutoff_at TIMESTAMPTZ NOT NULL,
 horizon_ends_at TIMESTAMPTZ NOT NULL,
 finalization_id UUID NOT NULL,
 source_high_water_order BIGINT NOT NULL CHECK(source_high_water_order>=0),
 member_receipts JSONB NOT NULL CHECK(jsonb_typeof(member_receipts)='array'),
 eligible_count INTEGER NOT NULL CHECK(eligible_count BETWEEN 0 AND 500),
 qualified_count INTEGER NOT NULL CHECK(qualified_count BETWEEN 0 AND eligible_count),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 digest_nonce UUID NOT NULL,
 cohort_digest CHAR(64) NOT NULL CHECK(cohort_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,finalization_id)
  REFERENCES public.canonical_lead_state_finalizations(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CHECK(horizon_ends_at>cutoff_at),
 CHECK(octet_length(member_receipts::text)<=262144)
);
CREATE INDEX canonical_forecast_lead_qualification_cohorts_tenant_capture
 ON public.canonical_forecast_lead_qualification_cohorts(
  organization_id,captured_at DESC,id);

CREATE FUNCTION public.canonical_lead_state_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Lead qualification evidence is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_lead_state_reviews_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_lead_state_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_lead_state_immutable();
CREATE TRIGGER canonical_lead_state_finalizations_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_lead_state_finalizations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_lead_state_immutable();
CREATE TRIGGER canonical_forecast_lead_qualification_cohorts_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_lead_qualification_cohorts
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_lead_state_immutable();

CREATE FUNCTION public.canonical_lead_state_review_projection(
 value public.canonical_lead_state_reviews)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,'opportunityId',value.opportunity_id,
  'revision',value.revision,'previousId',value.previous_id,
  'eventKey',value.event_key,'supersedesId',value.supersedes_id,
  'action',value.action,'state',value.qualification_state,
  'effectiveAt',public.canonical_forecast_utc_instant(value.effective_at),
  'reason',value.reason,'digest',rtrim(value.canonical_digest),
  'createdAt',public.canonical_forecast_utc_instant(value.created_at),
  'sourceAuthority','northstar_human_reviewed_lead_state')
$$;

CREATE FUNCTION public.canonical_lead_state_review_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 opportunity_value UUID,action_value TEXT,state_value TEXT,effective_value TIMESTAMPTZ,
 reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_row public.canonical_lead_state_reviews%ROWTYPE;
 replay public.canonical_lead_state_reviews%ROWTYPE;
 inserted public.canonical_lead_state_reviews%ROWTYPE;
 next_id UUID:=gen_random_uuid();next_revision BIGINT;key_hash TEXT;request_hash TEXT;
 digest_value TEXT;event_value UUID;supersedes_value UUID;created_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR
  opportunity_value IS NULL OR action_value NOT IN ('observe','correct') OR
  state_value NOT IN ('open','qualified','unqualified','closed') OR
  effective_value IS NULL OR effective_value>clock_timestamp() OR
  reason_value IS NULL OR public.canonical_learning_text_valid(reason_value,1000) IS NOT TRUE OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Lead qualification review invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-lead-state-review-request-v1','organizationId',org,
  'actorUserId',actor,'opportunityId',opportunity_value,'action',action_value,
  'state',state_value,'effectiveAt',public.canonical_forecast_utc_instant(effective_value),
  'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:lead-state:'||org::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:lead-state:'||org::text||':'||opportunity_value::text,0));
 IF NOT EXISTS(
  SELECT 1 FROM public.canonical_opportunities opportunity
  JOIN public.canonical_operations operation
   ON operation.organization_id=opportunity.organization_id
   AND operation.id=opportunity.operation_id AND operation.graph_id=opportunity.graph_id
  JOIN public.canonical_transcripts transcript
   ON transcript.organization_id=operation.organization_id
   AND transcript.operation_id=operation.id AND transcript.graph_id=operation.graph_id
  WHERE opportunity.organization_id=org AND opportunity.id=opportunity_value
   AND operation.state='completed'
   AND opportunity.created_at<=effective_value
   AND public.canonical_labor_transcript_source_normalized(transcript.source)
    IN ('lead','retell','voice')) THEN
  RAISE EXCEPTION 'Canonical lead opportunity unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO current_row FROM public.canonical_lead_state_reviews
 WHERE organization_id=org AND opportunity_id=opportunity_value
 ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 SELECT * INTO replay FROM public.canonical_lead_state_reviews
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Lead qualification request key conflict' USING ERRCODE='23505';
  END IF;
  IF current_row.id IS DISTINCT FROM replay.id THEN
   RAISE EXCEPTION 'Lead qualification history changed' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('review',
   public.canonical_lead_state_review_projection(replay),'replayed',TRUE);
 END IF;
 IF current_row.id IS NULL THEN
  IF action_value<>'observe' OR state_value<>'open' THEN
   RAISE EXCEPTION 'Lead qualification history must begin open' USING ERRCODE='22023';
  END IF;
 ELSIF action_value='observe' AND effective_value<=current_row.effective_at THEN
  RAISE EXCEPTION 'Lead qualification observation time changed' USING ERRCODE='22023';
 ELSIF action_value='correct' AND
   (effective_value<>current_row.effective_at OR state_value=current_row.qualification_state) THEN
  RAISE EXCEPTION 'Lead qualification correction invalid' USING ERRCODE='22023';
 END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 IF next_revision>1000 THEN
  RAISE EXCEPTION 'Lead qualification history exceeds bounded revision size'
   USING ERRCODE='54000';
 END IF;
 event_value:=CASE WHEN action_value='observe' THEN next_id ELSE current_row.event_key END;
 supersedes_value:=CASE WHEN action_value='correct' THEN current_row.id ELSE NULL END;
 created_value:=clock_timestamp();
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-lead-state-review-v1','id',next_id,'organizationId',org,
  'opportunityId',opportunity_value,'revision',next_revision,
  'previousId',current_row.id,'eventKey',event_value,'supersedesId',supersedes_value,
  'action',action_value,'state',state_value,
  'effectiveAt',public.canonical_forecast_utc_instant(effective_value),
  'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,
  'authSessionId',session_value,'reason',reason_value,'requestDigest',request_hash,
  'createdAt',public.canonical_forecast_utc_instant(created_value)));
 INSERT INTO public.canonical_lead_state_reviews(
  id,organization_id,opportunity_id,revision,previous_id,event_key,supersedes_id,
  action,qualification_state,effective_at,actor_user_id,membership_id,
  auth_session_id,reason,request_key_hash,request_digest,canonical_digest,created_at)
 VALUES(next_id,org,opportunity_value,next_revision,current_row.id,event_value,
  supersedes_value,action_value,state_value,effective_value,actor,
  (authority->>'membershipId')::uuid,session_value,reason_value,key_hash,
  request_hash,digest_value,created_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('review',
  public.canonical_lead_state_review_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_lead_state_review_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,opportunity_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_lead_state_reviews%ROWTYPE;
 history JSONB;total BIGINT;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO current_row FROM public.canonical_lead_state_reviews
 WHERE organization_id=org AND opportunity_id=opportunity_value
 ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_lead_state_reviews
 WHERE organization_id=org AND opportunity_id=opportunity_value;
 SELECT COALESCE(jsonb_agg(public.canonical_lead_state_review_projection(item)
  ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_lead_state_reviews
  WHERE organization_id=org AND opportunity_id=opportunity_value
  ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NULL THEN NULL
   ELSE public.canonical_lead_state_review_projection(current_row) END,
  'history',history,'total',total,'truncated',total>20,
  'boundary','Human-reviewed NorthStar lead state does not prove provider or off-platform coverage.');
END $$;

CREATE FUNCTION public.canonical_lead_state_finalization_projection(
 value public.canonical_lead_state_finalizations)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'revision',value.revision,
  'previousId',value.previous_id,
  'recordedThrough',public.canonical_forecast_utc_instant(value.recorded_through),
  'sourceHighWaterOrder',value.source_high_water_order,
  'reason',value.reason,'digest',rtrim(value.canonical_digest),
  'createdAt',public.canonical_forecast_utc_instant(value.created_at),
  'boundary','Finalization covers only this NorthStar human-review source, not complete business history.')
$$;

CREATE FUNCTION public.canonical_lead_state_finalization_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 recorded_value TIMESTAMPTZ,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_row public.canonical_lead_state_finalizations%ROWTYPE;
 replay public.canonical_lead_state_finalizations%ROWTYPE;
 inserted public.canonical_lead_state_finalizations%ROWTYPE;
 key_hash TEXT;request_hash TEXT;digest_value TEXT;next_revision BIGINT;
 high_water BIGINT;created_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR
  recorded_value IS NULL OR recorded_value>clock_timestamp() OR
  reason_value IS NULL OR public.canonical_learning_text_valid(reason_value,1000) IS NOT TRUE OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Lead qualification finalization invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-lead-state-finalization-request-v1','organizationId',org,
  'actorUserId',actor,
  'recordedThrough',public.canonical_forecast_utc_instant(recorded_value),
  'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:lead-state:'||org::text,0));
 SELECT * INTO current_row FROM public.canonical_lead_state_finalizations
 WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 SELECT * INTO replay FROM public.canonical_lead_state_finalizations
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Lead finalization request key conflict' USING ERRCODE='23505';
  END IF;
  IF current_row.id IS DISTINCT FROM replay.id THEN
   RAISE EXCEPTION 'Lead finalization history changed' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('finalization',
   public.canonical_lead_state_finalization_projection(replay),'replayed',TRUE);
 END IF;
 IF current_row.id IS NOT NULL AND recorded_value<=current_row.recorded_through THEN
  RAISE EXCEPTION 'Lead finalization must advance' USING ERRCODE='22023';
 END IF;
 SELECT COALESCE(MAX(review_order),0) INTO high_water
 FROM public.canonical_lead_state_reviews WHERE organization_id=org;
 next_revision:=COALESCE(current_row.revision,0)+1;created_value:=clock_timestamp();
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-lead-state-finalization-v1','organizationId',org,
  'revision',next_revision,'previousId',current_row.id,
  'recordedThrough',public.canonical_forecast_utc_instant(recorded_value),
  'sourceHighWaterOrder',high_water,'actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,
  'reason',reason_value,'requestDigest',request_hash,
  'createdAt',public.canonical_forecast_utc_instant(created_value)));
 INSERT INTO public.canonical_lead_state_finalizations(
  organization_id,revision,previous_id,recorded_through,source_high_water_order,
  actor_user_id,membership_id,auth_session_id,reason,request_key_hash,
  request_digest,canonical_digest,created_at)
 VALUES(org,next_revision,current_row.id,recorded_value,high_water,actor,
  (authority->>'membershipId')::uuid,session_value,reason_value,key_hash,
  request_hash,digest_value,created_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('finalization',
  public.canonical_lead_state_finalization_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_lead_state_finalization_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_lead_state_finalizations%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_lead_state_finalizations
 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 RETURN CASE WHEN value.id IS NULL THEN NULL
  ELSE public.canonical_lead_state_finalization_projection(value) END;
END $$;

CREATE FUNCTION public.canonical_forecast_lead_qualification_cohort_projection(
 value public.canonical_forecast_lead_qualification_cohorts,stale_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,'version','m26-lead-qualification-cohort-v1',
  'targetKey','demand.qualification_transition.v1',
  'state',CASE WHEN stale_value THEN 'source_stale'
    WHEN value.eligible_count=0 THEN 'unavailable' ELSE 'descriptive_only' END,
  'reason',CASE WHEN stale_value THEN 'source_changed_inside_horizon'
    WHEN value.eligible_count=0 THEN 'insufficient_history' ELSE NULL END,
  'cutoffAt',public.canonical_forecast_utc_instant(value.cutoff_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(value.horizon_ends_at),
  'capturedAt',public.canonical_forecast_utc_instant(value.captured_at),
  'eligibleCount',CASE WHEN stale_value THEN 0 ELSE value.eligible_count END,
  'qualifiedCount',CASE WHEN stale_value THEN 0 ELSE value.qualified_count END,
  'observedRate',CASE WHEN stale_value OR value.eligible_count=0 THEN NULL ELSE
   trim(trailing '.' FROM trim(trailing '0' FROM
    round(value.qualified_count::numeric/value.eligible_count::numeric,6)::text)) END,
  'sourceDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.source_digest) END,
  'cohortDigest',CASE WHEN stale_value THEN NULL ELSE rtrim(value.cohort_digest) END,
  'sourceAuthority','northstar_human_reviewed_lead_state',
  'sourceAuthenticated',NOT stale_value,
  'sourceCoverageComplete',FALSE,'offPlatformCoverageVerified',FALSE,
  'providerCoverageVerified',FALSE,'probabilityCalibrated',FALSE,
  'confidence','unavailable','forecastIssued',FALSE,'paidNumericServing',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_lead_qualification_cohort_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;finalization public.canonical_lead_state_finalizations%ROWTYPE;
 existing public.canonical_forecast_lead_qualification_cohorts%ROWTYPE;
 inserted public.canonical_forecast_lead_qualification_cohorts%ROWTYPE;
 key_hash TEXT;request_hash TEXT;members JSONB;source_hash TEXT;cohort_hash TEXT;
 nonce UUID;eligible INTEGER;qualified INTEGER;candidate_count INTEGER;
 source_row_count INTEGER;
 stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  cutoff_value IS NULL OR horizon_value IS NULL OR horizon_value<=cutoff_value OR
  horizon_value>clock_timestamp() OR horizon_value-cutoff_value<INTERVAL '1 hour' OR
  horizon_value-cutoff_value>INTERVAL '90 days' OR key_value IS NULL OR
  key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Lead qualification cohort input invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-lead-qualification-cohort-request-v1','organizationId',org,
  'actorUserId',actor,'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value)));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:lead-qualification-cohort:'||org::text||':'||actor::text||':'||key_hash,0));
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:lead-state:'||org::text,0)) THEN
  RAISE EXCEPTION 'Lead qualification source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO existing FROM public.canonical_forecast_lead_qualification_cohorts
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF existing.id IS NOT NULL THEN
  IF rtrim(existing.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Lead qualification cohort replay changed' USING ERRCODE='23505';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.canonical_lead_state_reviews review
   WHERE review.organization_id=org
    AND review.review_order>existing.source_high_water_order
    AND review.effective_at<=existing.horizon_ends_at) INTO stale_value;
  RETURN jsonb_build_object('cohort',
   public.canonical_forecast_lead_qualification_cohort_projection(existing,stale_value),
   'replayed',TRUE);
 END IF;
 SELECT * INTO finalization FROM public.canonical_lead_state_finalizations
 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF finalization.id IS NULL OR finalization.recorded_through<horizon_value OR EXISTS(
  SELECT 1 FROM public.canonical_lead_state_reviews review
  WHERE review.organization_id=org
   AND review.review_order>finalization.source_high_water_order
   AND review.effective_at<=horizon_value) THEN
  RAISE EXCEPTION 'Lead qualification source is not finalized through the horizon'
   USING ERRCODE='P0002';
 END IF;
 SELECT count(*)::integer INTO source_row_count FROM (
  SELECT 1 FROM public.canonical_lead_state_reviews review
  WHERE review.organization_id=org
   AND review.review_order<=finalization.source_high_water_order
  ORDER BY review.review_order LIMIT 5001) bounded_source;
 IF source_row_count>5000 THEN
  RAISE EXCEPTION 'Lead qualification source exceeds bounded history size'
   USING ERRCODE='54000';
 END IF;
 SELECT count(*)::integer INTO candidate_count FROM (
  SELECT opportunity_id FROM public.canonical_lead_state_reviews review
  WHERE review.organization_id=org AND review.effective_at<=cutoff_value
   AND review.review_order<=finalization.source_high_water_order
  GROUP BY opportunity_id LIMIT 501) candidates;
 IF candidate_count>500 THEN
  RAISE EXCEPTION 'Lead qualification cohort exceeds bounded candidate size'
   USING ERRCODE='54000';
 END IF;
 WITH resolved_events AS MATERIALIZED (
  SELECT DISTINCT ON(review.event_key) review.*
  FROM public.canonical_lead_state_reviews review
  WHERE review.organization_id=org
   AND review.review_order<=finalization.source_high_water_order
  ORDER BY review.event_key,review.revision DESC
 ), as_of_rows AS MATERIALIZED (
  SELECT DISTINCT ON(event.opportunity_id) event.*
  FROM resolved_events event WHERE event.effective_at<=cutoff_value
  ORDER BY event.opportunity_id,event.effective_at DESC,event.review_order DESC
 ), eligible_rows AS MATERIALIZED (
  SELECT as_of_row.* FROM as_of_rows as_of_row
  WHERE as_of_row.qualification_state='open'
  ORDER BY as_of_row.opportunity_id LIMIT 501
 ), enriched AS MATERIALIZED (
  SELECT eligible.opportunity_id,eligible.id as_of_review_id,
   eligible.review_order as_of_review_order,eligible.effective_at as_of_effective_at,
   (SELECT outcome.id FROM resolved_events outcome
    WHERE outcome.opportunity_id=eligible.opportunity_id
     AND outcome.qualification_state='qualified'
     AND outcome.effective_at>cutoff_value AND outcome.effective_at<=horizon_value
    ORDER BY outcome.effective_at,outcome.review_order LIMIT 1) qualification_review_id,
   (SELECT outcome.review_order FROM resolved_events outcome
    WHERE outcome.opportunity_id=eligible.opportunity_id
     AND outcome.qualification_state='qualified'
     AND outcome.effective_at>cutoff_value AND outcome.effective_at<=horizon_value
    ORDER BY outcome.effective_at,outcome.review_order LIMIT 1) qualification_review_order,
   (SELECT outcome.effective_at FROM resolved_events outcome
    WHERE outcome.opportunity_id=eligible.opportunity_id
     AND outcome.qualification_state='qualified'
     AND outcome.effective_at>cutoff_value AND outcome.effective_at<=horizon_value
    ORDER BY outcome.effective_at,outcome.review_order LIMIT 1) qualified_at
  FROM eligible_rows eligible
 )
 SELECT count(*)::integer,COALESCE(jsonb_agg(jsonb_build_object(
  'opportunityId',opportunity_id,'asOfReviewId',as_of_review_id,
  'asOfReviewOrder',as_of_review_order,
  'asOfEffectiveAt',public.canonical_forecast_utc_instant(as_of_effective_at),
  'qualificationReviewId',qualification_review_id,
  'qualificationReviewOrder',qualification_review_order,
  'qualifiedAt',public.canonical_forecast_utc_instant(qualified_at))
  ORDER BY opportunity_id),'[]'::jsonb),count(qualification_review_id)::integer
 INTO eligible,members,qualified FROM enriched;
 IF eligible>500 OR octet_length(members::text)>262144 THEN
  RAISE EXCEPTION 'Lead qualification cohort exceeds bounded size' USING ERRCODE='54000';
 END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'sourceAuthority','northstar_human_reviewed_lead_state','organizationId',org,
  'cutoffAt',public.canonical_forecast_utc_instant(cutoff_value),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_value),
  'finalizationId',finalization.id,
  'sourceHighWaterOrder',finalization.source_high_water_order,'members',members));
 nonce:=gen_random_uuid();
 cohort_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-lead-qualification-cohort-v1','organizationId',org,
  'sourceDigest',source_hash,'digestNonce',nonce,
  'eligibleCount',eligible,'qualifiedCount',qualified));
 INSERT INTO public.canonical_forecast_lead_qualification_cohorts(
  organization_id,cutoff_at,horizon_ends_at,finalization_id,
  source_high_water_order,member_receipts,eligible_count,qualified_count,
  source_digest,digest_nonce,cohort_digest,actor_user_id,membership_id,
  auth_session_id,request_key_hash,request_digest)
 VALUES(org,cutoff_value,horizon_value,finalization.id,
  finalization.source_high_water_order,members,eligible,qualified,source_hash,
  nonce,cohort_hash,actor,(authority->>'membershipId')::uuid,session_value,
  key_hash,request_hash) RETURNING * INTO inserted;
 RETURN jsonb_build_object('cohort',
  public.canonical_forecast_lead_qualification_cohort_projection(inserted,FALSE),
  'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_lead_qualification_cohort_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,cohort_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_forecast_lead_qualification_cohorts%ROWTYPE;
 stale_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for lead qualification cohort read'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:lead-state:'||org::text,0)) THEN
  RAISE EXCEPTION 'Lead qualification source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO value FROM public.canonical_forecast_lead_qualification_cohorts
 WHERE organization_id=org AND id=cohort_value;
 IF value.id IS NULL THEN RETURN NULL;END IF;
 SELECT EXISTS(SELECT 1 FROM public.canonical_lead_state_reviews review
  WHERE review.organization_id=org
   AND review.review_order>value.source_high_water_order
   AND review.effective_at<=value.horizon_ends_at) INTO stale_value;
 RETURN public.canonical_forecast_lead_qualification_cohort_projection(value,stale_value);
END $$;

REVOKE ALL ON TABLE public.canonical_lead_state_reviews,
 public.canonical_lead_state_finalizations,
 public.canonical_forecast_lead_qualification_cohorts FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.canonical_lead_state_review_order_sequence FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_lead_state_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_lead_state_review_projection(
 public.canonical_lead_state_reviews) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_lead_state_review_mutate(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_lead_state_review_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_lead_state_finalization_projection(
 public.canonical_lead_state_finalizations) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_lead_state_finalization_mutate(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_lead_state_finalization_read(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_lead_qualification_cohort_projection(
 public.canonical_forecast_lead_qualification_cohorts,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_lead_qualification_cohort_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_lead_qualification_cohort_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_lead_state_review_mutate(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_lead_state_review_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_lead_state_finalization_mutate(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_lead_state_finalization_read(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_lead_qualification_cohort_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_lead_qualification_cohort_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
