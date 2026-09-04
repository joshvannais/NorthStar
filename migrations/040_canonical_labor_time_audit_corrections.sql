-- Mission 23 Part 3 audit corrections only.
-- Migration 039 remains frozen byte-for-byte. This forward-only migration closes
-- review overlap, future-endpoint, and normalized demo/simulation source gaps.

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
     AND lower(btrim(transcript.source)) NOT IN ('simulation','demo') FOR UPDATE OF execution;
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
      OR observed_end_value>transaction_timestamp()+INTERVAL '5 minutes'
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

  IF review_state_value<>'rejected' AND action_value IN ('start_timer','record_manual','correct','review') AND EXISTS(
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
     AND lower(btrim(transcript.source)) NOT IN ('simulation','demo');
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
