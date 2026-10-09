-- Mission 26 Part 11D: immutable review-only forecast handoffs.
-- A handoff is advice and review history. It never mutates a receiving
-- workflow, sends a communication, or authorizes an operational action.

CREATE TABLE public.canonical_forecast_handoff_proposals_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 run_id UUID NOT NULL,
 run_digest CHAR(64) NOT NULL CHECK(run_digest~'^[0-9a-f]{64}$'),
 target_key TEXT NOT NULL CHECK(target_key='demand.inbound_leads'),
 target_version TEXT NOT NULL CHECK(target_version='v1'),
 horizon_grain TEXT NOT NULL CHECK(horizon_grain='month'),
 horizon_local_start DATE NOT NULL CHECK(extract(day FROM horizon_local_start)=1),
 output_digest CHAR(64) NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 currentness_revision INTEGER NOT NULL CHECK(currentness_revision BETWEEN 1 AND 1000000000),
 currentness_digest CHAR(64) NOT NULL CHECK(currentness_digest~'^[0-9a-f]{64}$'),
 recommendation_type TEXT NOT NULL CHECK(recommendation_type='review_demand_capacity'),
 receiving_mission TEXT NOT NULL CHECK(receiving_mission='22'),
 receiving_workflow TEXT NOT NULL CHECK(receiving_workflow='calendar_capacity_review'),
 receiving_record_id UUID,
 expected_receiving_revision INTEGER,
 expected_receiving_digest CHAR(64),
 receiver_availability TEXT NOT NULL CHECK(receiver_availability='unavailable'),
 receiver_reason TEXT NOT NULL CHECK(receiver_reason='exact_receiving_record_not_available'),
 receiver_href TEXT,
 evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 uncertainty JSONB NOT NULL CHECK(jsonb_typeof(uncertainty)='object'),
 missing_information JSONB NOT NULL CHECK(jsonb_typeof(missing_information)='array'),
 tradeoff TEXT NOT NULL CHECK(length(tradeoff) BETWEEN 1 AND 500),
 reviewer_user_id UUID NOT NULL,
 reviewer_access_role TEXT NOT NULL CHECK(reviewer_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 expires_at TIMESTAMPTZ NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,reviewer_user_id,request_key_digest),
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_runs_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,reviewer_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '30 days'),
 CHECK((receiving_record_id IS NULL AND expected_receiving_revision IS NULL AND
        expected_receiving_digest IS NULL AND receiver_href IS NULL)),
 CHECK(evidence= jsonb_build_object(
  'predictionKind',evidence->>'predictionKind','amount',evidence->>'amount',
  'unit',evidence->>'unit','runDigest',evidence->>'runDigest',
  'outputDigest',evidence->>'outputDigest')),
 CHECK(evidence->>'predictionKind'='point' AND evidence->>'unit'='count' AND
       evidence->>'amount'~'^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,6})?$' AND
       evidence->>'runDigest'=rtrim(run_digest) AND
       evidence->>'outputDigest'=rtrim(output_digest)),
 CHECK(uncertainty=jsonb_build_object(
  'state',uncertainty->>'state','drivers',uncertainty->'drivers') AND
       uncertainty->>'state'='unquantified' AND
       jsonb_typeof(uncertainty->'drivers')='array'),
 CHECK(missing_information='["calibrated_interval","current_capacity_record","exact_receiving_record"]'::jsonb),
 CHECK(rtrim(canonical_digest)=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',organization_id,'id',id,'runId',run_id,
  'runDigest',rtrim(run_digest),'targetKey',target_key,'targetVersion',target_version,
  'horizon',jsonb_build_object('grain',horizon_grain,'localStart',horizon_local_start),
  'outputDigest',rtrim(output_digest),'currentnessRevision',currentness_revision,
  'currentnessDigest',rtrim(currentness_digest),'recommendationType',recommendation_type,
  'receiver',jsonb_build_object('mission',receiving_mission,'workflow',receiving_workflow,
   'recordId',receiving_record_id,'expectedRevision',expected_receiving_revision,
   'expectedDigest',rtrim(expected_receiving_digest),'availability',receiver_availability,
   'reason',receiver_reason,'href',receiver_href),
  'evidence',evidence,'uncertainty',uncertainty,'missingInformation',missing_information,
  'tradeoff',tradeoff,'reviewerUserId',reviewer_user_id,
  'reviewerAccessRole',reviewer_access_role,'createdAt',created_at,'expiresAt',expires_at)))
);

CREATE TABLE public.canonical_forecast_handoff_events_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL,
 proposal_id UUID NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000),
 action TEXT NOT NULL CHECK(action IN('requested','dismissed','consumed','withdrawn')),
 predecessor_event_id UUID,
 predecessor_event_digest CHAR(64),
 actor_user_id UUID NOT NULL,
 actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 auth_session_id UUID NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,proposal_id,sequence),
 UNIQUE(organization_id,actor_user_id,request_key_digest),
 FOREIGN KEY(organization_id,proposal_id)
  REFERENCES public.canonical_forecast_handoff_proposals_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(predecessor_event_id)
  REFERENCES public.canonical_forecast_handoff_events_v1(id) ON DELETE RESTRICT,
 CHECK((sequence=1 AND action='requested' AND predecessor_event_id IS NULL AND
        predecessor_event_digest IS NULL) OR
       (sequence>1 AND action<>'requested' AND predecessor_event_id IS NOT NULL AND
        predecessor_event_digest~'^[0-9a-f]{64}$')),
 CHECK(rtrim(canonical_digest)=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',organization_id,'proposalId',proposal_id,'sequence',sequence,
  'action',action,'predecessorEventId',predecessor_event_id,
  'predecessorEventDigest',rtrim(predecessor_event_digest),
  'actorUserId',actor_user_id,'actorAccessRole',actor_access_role,'recordedAt',recorded_at)))
);

CREATE TRIGGER canonical_forecast_handoff_proposals_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_handoff_proposals_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();
CREATE TRIGGER canonical_forecast_handoff_events_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_handoff_events_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_handoff_v1_item(org UUID,proposal_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proposal public.canonical_forecast_handoff_proposals_v1%ROWTYPE;
 latest public.canonical_forecast_handoff_events_v1%ROWTYPE;state_value TEXT;
 body JSONB;projection_digest TEXT;
BEGIN
 SELECT * INTO proposal FROM public.canonical_forecast_handoff_proposals_v1
  WHERE organization_id=org AND id=proposal_value;
 IF proposal.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO latest FROM public.canonical_forecast_handoff_events_v1
  WHERE organization_id=org AND proposal_id=proposal.id
  ORDER BY sequence DESC LIMIT 1;
 IF latest.id IS NULL THEN RETURN NULL;END IF;
 state_value:=CASE WHEN latest.action='requested' AND proposal.expires_at<=clock_timestamp()
  THEN 'expired' ELSE latest.action END;
 body:=jsonb_build_object(
  'version','m26-forecast-reviewed-handoff-v1','id',proposal.id,'state',state_value,
  'revision',latest.sequence,'organizationId',proposal.organization_id,
  'createdAt',proposal.created_at,'expiresAt',proposal.expires_at,
  'reviewer',jsonb_build_object('userId',proposal.reviewer_user_id,
   'accessRole',proposal.reviewer_access_role),
  'run',jsonb_build_object('id',proposal.run_id,'digest',rtrim(proposal.run_digest),
   'targetKey',proposal.target_key,'targetVersion',proposal.target_version,
   'horizon',jsonb_build_object('grain',proposal.horizon_grain,
    'localStart',proposal.horizon_local_start),'outputDigest',rtrim(proposal.output_digest),
   'currentnessRevision',proposal.currentness_revision,
   'currentnessDigest',rtrim(proposal.currentness_digest)),
  'recommendation',jsonb_build_object('type',proposal.recommendation_type,
   'evidence',proposal.evidence,'uncertainty',proposal.uncertainty,
   'missingInformation',proposal.missing_information,'tradeoff',proposal.tradeoff),
  'receiver',jsonb_build_object('mission',proposal.receiving_mission,
   'workflow',proposal.receiving_workflow,'recordId',proposal.receiving_record_id,
   'expectedRevision',proposal.expected_receiving_revision,
   'expectedDigest',rtrim(proposal.expected_receiving_digest),
   'availability',proposal.receiver_availability,'reason',proposal.receiver_reason,
   'href',proposal.receiver_href),
  'history',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'revision',event.sequence,'action',event.action,'recordedAt',event.recorded_at,
    'actorUserId',event.actor_user_id,'digest',rtrim(event.canonical_digest))
    ORDER BY event.sequence)
   FROM public.canonical_forecast_handoff_events_v1 event
   WHERE event.organization_id=org AND event.proposal_id=proposal.id),'[]'::jsonb),
  'advisoryOnly',TRUE,'navigationIsApproval',FALSE,
  'receiverRecheckRequired',TRUE,'automaticActionAuthorized',FALSE,
  'outboundCommunicationAuthorized',FALSE,'proposalDigest',rtrim(proposal.canonical_digest));
 projection_digest:=public.canonical_completion_digest(body);
 RETURN body||jsonb_build_object('digest',projection_digest);
END $$;

CREATE FUNCTION public.canonical_forecast_handoff_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;decision JSONB;saved public.canonical_forecast_runs_v1%ROWTYPE;
 output_row public.canonical_forecast_run_outputs_v1%ROWTYPE;
 origin public.canonical_forecast_retell_future_origins_v2%ROWTYPE;
 current_event public.canonical_forecast_run_currentness_events_v1%ROWTYPE;
 candidate JSONB;items JSONB;
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);
 PERFORM set_config('statement_timeout','8000ms',TRUE);
 authority:=public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 decision:=public.canonical_forecast_run_currentness_v1_latest(
  org,actor,role_value,session_value);
 IF decision->>'state'<>'unchanged_candidate' THEN RETURN jsonb_build_object(
  'version','m26-forecast-reviewed-handoff-v1','state','unavailable',
  'reason',decision->>'reason','candidate',NULL,'proposals',NULL,
  'automaticActionAuthorized',FALSE,'outboundCommunicationAuthorized',FALSE);END IF;
 SELECT * INTO saved FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND id=(decision->>'runId')::uuid FOR SHARE NOWAIT;
 SELECT * INTO output_row FROM public.canonical_forecast_run_outputs_v1
  WHERE organization_id=org AND run_id=saved.id AND ordinal=0 FOR SHARE NOWAIT;
 SELECT * INTO origin FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND id=saved.origin_id FOR SHARE NOWAIT;
 SELECT * INTO current_event FROM public.canonical_forecast_run_currentness_events_v1
  WHERE organization_id=org AND run_id=saved.id ORDER BY sequence DESC LIMIT 1;
 IF saved.id IS NULL OR output_row.id IS NULL OR origin.id IS NULL OR
    current_event.id IS NULL OR rtrim(saved.canonical_digest)<>decision->>'runDigest' OR
    rtrim(current_event.currentness_digest)<>decision->>'digest' OR
    output_row.target_key<>'demand.inbound_leads' OR output_row.target_version<>'v1' OR
    output_row.output#>>'{value,kind}'<>'point' OR output_row.output#>>'{unit,key}'<>'count' OR
    output_row.output#>'{unit,currency}'<>'null'::jsonb OR
    origin.local_horizon_start IS NULL THEN RETURN jsonb_build_object(
   'version','m26-forecast-reviewed-handoff-v1','state','unavailable',
   'reason','run_identity_unavailable','candidate',NULL,'proposals',NULL,
   'automaticActionAuthorized',FALSE,'outboundCommunicationAuthorized',FALSE);END IF;
 candidate:=jsonb_build_object('runId',saved.id,'runDigest',rtrim(saved.canonical_digest),
  'targetKey',output_row.target_key,'targetVersion',output_row.target_version,
  'horizon',jsonb_build_object('grain','month','localStart',origin.local_horizon_start),
  'outputDigest',rtrim(output_row.output_digest),
  'currentness',jsonb_build_object('revision',current_event.sequence,
   'digest',rtrim(current_event.currentness_digest)),
  'recommendation',jsonb_build_object('type','review_demand_capacity',
   'summary','Review staffing and schedule capacity for the saved inbound-lead forecast.',
   'evidence',jsonb_build_object('predictionKind','point',
    'amount',output_row.output#>>'{value,amount}','unit','count',
    'runDigest',rtrim(saved.canonical_digest),'outputDigest',rtrim(output_row.output_digest)),
   'uncertainty',output_row.output->'uncertainty',
   'missingInformation','["calibrated_interval","current_capacity_record","exact_receiving_record"]'::jsonb,
   'tradeoff','Reviewing capacity early may expose staffing or schedule constraints, but the forecast does not identify a specific appointment or prove available capacity.'),
  'receiver',jsonb_build_object('mission','22','workflow','calendar_capacity_review',
   'recordId',NULL,'expectedRevision',NULL,'expectedDigest',NULL,
   'availability','unavailable','reason','exact_receiving_record_not_available','href',NULL),
  'advisoryOnly',TRUE,'navigationIsApproval',FALSE,
  'receiverRecheckRequired',TRUE,'automaticActionAuthorized',FALSE);
 SELECT COALESCE(jsonb_agg(public.canonical_forecast_handoff_v1_item(org,item.id)
   ORDER BY item.created_at DESC,item.id DESC),'[]'::jsonb) INTO items
 FROM (SELECT id,created_at FROM public.canonical_forecast_handoff_proposals_v1
  WHERE organization_id=org AND run_id=saved.id AND expires_at>clock_timestamp()
  ORDER BY created_at DESC,id DESC LIMIT 20) item;
 RETURN jsonb_build_object('version','m26-forecast-reviewed-handoff-v1',
  'state','current','reason',NULL,'candidate',candidate,'proposals',items,
  'automaticActionAuthorized',FALSE,'outboundCommunicationAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_handoff_v1_request(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 request_hash TEXT,run_value UUID,run_digest_value TEXT,currentness_digest_value TEXT,
 expires_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;replay public.canonical_forecast_handoff_proposals_v1%ROWTYPE;
 saved public.canonical_forecast_runs_v1%ROWTYPE;output_row public.canonical_forecast_run_outputs_v1%ROWTYPE;
 origin public.canonical_forecast_retell_future_origins_v2%ROWTYPE;
 current_event public.canonical_forecast_run_currentness_events_v1%ROWTYPE;
 decision JSONB;inserted public.canonical_forecast_handoff_proposals_v1%ROWTYPE;
 created_value TIMESTAMPTZ:=date_trunc('milliseconds',clock_timestamp());
 evidence_value JSONB;uncertainty_value JSONB;missing_value JSONB;
 tradeoff_value TEXT;key_hash TEXT;proposal_digest TEXT;event_digest TEXT;event_id UUID;
 proposal_id UUID:=gen_random_uuid();
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);
 PERFORM set_config('statement_timeout','8000ms',TRUE);
 authority:=public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    request_hash IS NULL OR request_hash!~'^[0-9a-f]{64}$' OR run_value IS NULL OR
    run_digest_value IS NULL OR run_digest_value!~'^[0-9a-f]{64}$' OR
    currentness_digest_value IS NULL OR currentness_digest_value!~'^[0-9a-f]{64}$' OR
    expires_value IS NULL OR expires_value<created_value+INTERVAL '1 hour' OR
    expires_value>created_value+INTERVAL '30 days' THEN
  RAISE EXCEPTION 'Forecast handoff request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF pg_try_advisory_xact_lock(hashtextextended(
   'm26:forecast-handoff-request:'||org::text||':'||actor::text||':'||key_hash,0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended(
   'm26:forecast-handoff:'||org::text||':'||run_value::text,0)) IS NOT TRUE THEN
  RAISE EXCEPTION 'Forecast handoff request is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO replay FROM public.canonical_forecast_handoff_proposals_v1
  WHERE organization_id=org AND reviewer_user_id=actor AND request_key_digest=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Forecast handoff request key conflict' USING ERRCODE='23505';END IF;
  decision:=public.canonical_forecast_run_currentness_v1_read(
   org,actor,role_value,session_value,replay.run_id);
  IF decision->>'state'<>'unchanged_candidate' OR
     decision->>'runDigest'<>rtrim(replay.run_digest) OR
     decision->>'digest'<>rtrim(replay.currentness_digest) THEN
   RETURN jsonb_build_object('state','unavailable','reason',decision->>'reason',
    'proposal',NULL);END IF;
  IF replay.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object(
   'state','unavailable','reason','proposal_expired','proposal',NULL);END IF;
  RETURN jsonb_build_object('state','replay','proposal',
   public.canonical_forecast_handoff_v1_item(org,replay.id));
 END IF;
 decision:=public.canonical_forecast_run_currentness_v1_read(
  org,actor,role_value,session_value,run_value);
 IF decision->>'state'<>'unchanged_candidate' OR
    decision->>'runDigest'<>run_digest_value OR decision->>'digest'<>currentness_digest_value THEN
  RETURN jsonb_build_object('state','unavailable','reason',decision->>'reason','proposal',NULL);END IF;
 SELECT * INTO saved FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND id=run_value FOR SHARE NOWAIT;
 SELECT * INTO output_row FROM public.canonical_forecast_run_outputs_v1
  WHERE organization_id=org AND run_id=run_value AND ordinal=0 FOR SHARE NOWAIT;
 SELECT * INTO origin FROM public.canonical_forecast_retell_future_origins_v2
  WHERE organization_id=org AND id=saved.origin_id FOR SHARE NOWAIT;
 SELECT * INTO current_event FROM public.canonical_forecast_run_currentness_events_v1
  WHERE organization_id=org AND run_id=run_value ORDER BY sequence DESC LIMIT 1;
 IF saved.id IS NULL OR output_row.id IS NULL OR origin.id IS NULL OR current_event.id IS NULL OR
    rtrim(saved.canonical_digest)<>run_digest_value OR
    rtrim(current_event.currentness_digest)<>currentness_digest_value OR
    output_row.target_key<>'demand.inbound_leads' OR output_row.target_version<>'v1' OR
    output_row.output#>>'{value,kind}'<>'point' OR output_row.output#>>'{unit,key}'<>'count' OR
    output_row.output#>'{unit,currency}'<>'null'::jsonb OR origin.local_horizon_start IS NULL THEN
  RAISE EXCEPTION 'Forecast handoff evidence changed' USING ERRCODE='40001';END IF;
 evidence_value:=jsonb_build_object('predictionKind','point',
  'amount',output_row.output#>>'{value,amount}','unit','count',
  'runDigest',run_digest_value,'outputDigest',rtrim(output_row.output_digest));
 uncertainty_value:=output_row.output->'uncertainty';
 missing_value:='["calibrated_interval","current_capacity_record","exact_receiving_record"]'::jsonb;
 tradeoff_value:='Reviewing capacity early may expose staffing or schedule constraints, but the forecast does not identify a specific appointment or prove available capacity.';
 proposal_digest:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'id',proposal_id,'runId',saved.id,'runDigest',run_digest_value,
  'targetKey','demand.inbound_leads','targetVersion','v1',
  'horizon',jsonb_build_object('grain','month','localStart',origin.local_horizon_start),
  'outputDigest',rtrim(output_row.output_digest),'currentnessRevision',current_event.sequence,
  'currentnessDigest',currentness_digest_value,'recommendationType','review_demand_capacity',
  'receiver',jsonb_build_object('mission','22','workflow','calendar_capacity_review',
   'recordId',NULL,'expectedRevision',NULL,'expectedDigest',NULL,
   'availability','unavailable','reason','exact_receiving_record_not_available','href',NULL),
  'evidence',evidence_value,'uncertainty',uncertainty_value,
  'missingInformation',missing_value,'tradeoff',tradeoff_value,
  'reviewerUserId',actor,'reviewerAccessRole',role_value,
  'createdAt',created_value,'expiresAt',expires_value));
 INSERT INTO public.canonical_forecast_handoff_proposals_v1(
  id,organization_id,run_id,run_digest,target_key,target_version,horizon_grain,
  horizon_local_start,output_digest,currentness_revision,currentness_digest,
  recommendation_type,receiving_mission,receiving_workflow,receiver_availability,
  receiver_reason,evidence,uncertainty,missing_information,tradeoff,
  reviewer_user_id,reviewer_access_role,membership_id,auth_session_id,created_at,
  expires_at,request_key_digest,request_digest,canonical_digest)
 VALUES(proposal_id,org,saved.id,run_digest_value,'demand.inbound_leads','v1','month',
  origin.local_horizon_start,output_row.output_digest,current_event.sequence,
  currentness_digest_value,'review_demand_capacity','22','calendar_capacity_review',
  'unavailable','exact_receiving_record_not_available',evidence_value,
  uncertainty_value,missing_value,tradeoff_value,actor,role_value,
  (authority->>'membershipId')::uuid,session_value,created_value,expires_value,
  key_hash,request_hash,proposal_digest) RETURNING * INTO inserted;
 event_digest:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'proposalId',inserted.id,'sequence',1,'action','requested',
  'predecessorEventId',NULL,'predecessorEventDigest',NULL,'actorUserId',actor,
  'actorAccessRole',role_value,'recordedAt',created_value));
 INSERT INTO public.canonical_forecast_handoff_events_v1(
  organization_id,proposal_id,sequence,action,actor_user_id,actor_access_role,
  auth_session_id,recorded_at,request_key_digest,request_digest,canonical_digest)
 VALUES(org,inserted.id,1,'requested',actor,role_value,session_value,created_value,
  key_hash,request_hash,event_digest) RETURNING id INTO event_id;
 INSERT INTO public.audit_logs(organization_id,user_id,action,entity_type,entity_id,details)
 VALUES(org,actor,'forecast_handoff_review_requested','forecast_handoff',inserted.id::text,
  jsonb_build_object('runId',saved.id,'runDigest',run_digest_value,
   'proposalDigest',proposal_digest,'eventId',event_id,
   'receiverAvailability','unavailable','automaticActionAuthorized',FALSE));
 RETURN jsonb_build_object('state','created','proposal',
  public.canonical_forecast_handoff_v1_item(org,inserted.id));
END $$;

CREATE FUNCTION public.canonical_forecast_handoff_v1_dismiss(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 request_hash TEXT,proposal_value UUID,expected_revision INTEGER,expected_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proposal public.canonical_forecast_handoff_proposals_v1%ROWTYPE;
 current_event public.canonical_forecast_handoff_events_v1%ROWTYPE;
 replay public.canonical_forecast_handoff_events_v1%ROWTYPE;decision JSONB;
 projection JSONB;key_hash TEXT;recorded_value TIMESTAMPTZ:=date_trunc('milliseconds',clock_timestamp());
 event_digest TEXT;inserted_id UUID;
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);
 PERFORM set_config('statement_timeout','8000ms',TRUE);
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    request_hash IS NULL OR request_hash!~'^[0-9a-f]{64}$' OR proposal_value IS NULL OR
    expected_revision IS NULL OR expected_revision<1 OR
    expected_digest IS NULL OR expected_digest!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Forecast handoff dismissal invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF pg_try_advisory_xact_lock(hashtextextended(
   'm26:forecast-handoff-event:'||org::text||':'||actor::text||':'||key_hash,0)) IS NOT TRUE OR
    pg_try_advisory_xact_lock(hashtextextended(
   'm26:forecast-handoff-proposal:'||org::text||':'||proposal_value::text,0)) IS NOT TRUE THEN
  RAISE EXCEPTION 'Forecast handoff dismissal is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO replay FROM public.canonical_forecast_handoff_events_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_digest=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Forecast handoff request key conflict' USING ERRCODE='23505';END IF;
  SELECT * INTO proposal FROM public.canonical_forecast_handoff_proposals_v1
   WHERE organization_id=org AND id=replay.proposal_id;
  IF proposal.id IS NULL OR proposal.expires_at<=clock_timestamp() THEN
   RETURN jsonb_build_object('state','unavailable','reason','proposal_expired',
    'proposal',NULL);END IF;
  decision:=public.canonical_forecast_run_currentness_v1_read(
   org,actor,role_value,session_value,proposal.run_id);
  IF decision->>'state'<>'unchanged_candidate' OR
     decision->>'runDigest'<>rtrim(proposal.run_digest) OR
     decision->>'digest'<>rtrim(proposal.currentness_digest) THEN
   RETURN jsonb_build_object('state','unavailable','reason',COALESCE(
    decision->>'reason','run_identity_unavailable'),'proposal',NULL);END IF;
  RETURN jsonb_build_object('state','replay','proposal',
   public.canonical_forecast_handoff_v1_item(org,replay.proposal_id));
 END IF;
 SELECT * INTO proposal FROM public.canonical_forecast_handoff_proposals_v1
  WHERE organization_id=org AND id=proposal_value FOR SHARE NOWAIT;
 IF proposal.id IS NULL THEN
  RAISE EXCEPTION 'Forecast handoff not found' USING ERRCODE='22023';END IF;
 SELECT * INTO current_event FROM public.canonical_forecast_handoff_events_v1
  WHERE organization_id=org AND proposal_id=proposal.id
  ORDER BY sequence DESC LIMIT 1 FOR SHARE NOWAIT;
 projection:=public.canonical_forecast_handoff_v1_item(org,proposal.id);
 IF current_event.action<>'requested' OR proposal.expires_at<=clock_timestamp() OR
    expected_revision<>current_event.sequence OR projection->>'digest'<>expected_digest THEN
  RAISE EXCEPTION 'Forecast handoff changed' USING ERRCODE='40001';END IF;
 decision:=public.canonical_forecast_run_currentness_v1_read(
  org,actor,role_value,session_value,proposal.run_id);
 IF decision->>'state'<>'unchanged_candidate' OR
    decision->>'runDigest'<>rtrim(proposal.run_digest) OR
    decision->>'digest'<>rtrim(proposal.currentness_digest) THEN
  RETURN jsonb_build_object('state','unavailable','reason',decision->>'reason','proposal',NULL);END IF;
 event_digest:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'proposalId',proposal.id,'sequence',current_event.sequence+1,
  'action','dismissed','predecessorEventId',current_event.id,
  'predecessorEventDigest',rtrim(current_event.canonical_digest),
  'actorUserId',actor,'actorAccessRole',role_value,'recordedAt',recorded_value));
 INSERT INTO public.canonical_forecast_handoff_events_v1(
  organization_id,proposal_id,sequence,action,predecessor_event_id,
  predecessor_event_digest,actor_user_id,actor_access_role,auth_session_id,
  recorded_at,request_key_digest,request_digest,canonical_digest)
 VALUES(org,proposal.id,current_event.sequence+1,'dismissed',current_event.id,
  current_event.canonical_digest,actor,role_value,session_value,recorded_value,
  key_hash,request_hash,event_digest) RETURNING id INTO inserted_id;
 INSERT INTO public.audit_logs(organization_id,user_id,action,entity_type,entity_id,details)
 VALUES(org,actor,'forecast_handoff_review_dismissed','forecast_handoff',proposal.id::text,
  jsonb_build_object('eventId',inserted_id,'eventDigest',event_digest,
   'automaticActionAuthorized',FALSE));
 RETURN jsonb_build_object('state','dismissed','proposal',
  public.canonical_forecast_handoff_v1_item(org,proposal.id));
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_handoff_proposals_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_handoff_events_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_handoff_v1_item(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_handoff_v1_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_handoff_v1_request(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_handoff_v1_dismiss(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID,INTEGER,TEXT) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_handoff_proposals_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_handoff_events_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_handoff_v1_item(uuid,uuid) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_handoff_v1_read(uuid,uuid,text,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_handoff_v1_request(uuid,uuid,text,uuid,text,text,text,uuid,text,text,timestamptz) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_handoff_v1_dismiss(uuid,uuid,text,uuid,text,text,text,uuid,integer,text) TO %I',runtime_role);
 END IF;
END $$;
