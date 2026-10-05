-- Mission 26 Part 5D: purpose-fixed, nonnumeric capacity research UI projection.
-- This migration adds no forecast method and changes no Part 5A/B/C evidence.

CREATE FUNCTION public.canonical_forecast_capacity_ui_v1_history_item(
 kind_value TEXT,id_value UUID,parent_value UUID,state_value TEXT,recorded_value TIMESTAMPTZ,
 start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,revision_value BIGINT,action_value TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'kind',kind_value,'id',id_value,'parentId',parent_value,'state',state_value,
  'recordedAt',recorded_value,'periodStart',start_value,'periodEnd',end_value,
  'revision',revision_value,'action',action_value)
$$;

-- One endpoint-level key may name only one exact UI action request. This
-- private registry contains no research values and participates in the same
-- transaction as the accepted Part 5A/B/C writer it delegates to.
CREATE TABLE public.canonical_forecast_capacity_ui_action_requests_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 actor_id UUID NOT NULL REFERENCES public.users(id),
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_id,idempotency_key_hash)
);
CREATE TRIGGER canonical_forecast_capacity_ui_action_requests_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_capacity_ui_action_requests_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable();

CREATE FUNCTION public.canonical_forecast_capacity_ui_v1_current(
 org UUID,actor UUID,actor_role TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 authority JSONB;now_value TIMESTAMPTZ;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_origin_current BOOLEAN:=FALSE;workload_evaluation_current BOOLEAN:=FALSE;
 constrained_origin public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 constrained_outcome public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
 constrained_evaluation public.canonical_forecast_constrained_capacity_evaluations_v1%ROWTYPE;
 constrained_origin_current BOOLEAN:=FALSE;constrained_outcome_current BOOLEAN:=FALSE;
 constrained_evaluation_current BOOLEAN:=FALSE;
 advisory_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 advisory_decision public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 advisory_outcome public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;
 advisory_evaluation public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;
 advisory_continuation public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 advisory_origin_current BOOLEAN:=FALSE;advisory_outcome_current BOOLEAN:=FALSE;
 advisory_evaluation_current BOOLEAN:=FALSE;
 workload_projection JSONB:=NULL;workload_evaluation_projection JSONB:=NULL;
 constrained_projection JSONB:=NULL;constrained_outcome_projection JSONB:=NULL;
 constrained_evaluation_projection JSONB:=NULL;
 advisory_projection JSONB:=NULL;advisory_outcome_projection JSONB:=NULL;
 advisory_evaluation_projection JSONB:=NULL;advisory_continuation_projection JSONB:=NULL;
 workload_targets JSONB:='[]'::jsonb;constrained_scopes JSONB:='[]'::jsonb;
 workload_history JSONB:='[]'::jsonb;constrained_history JSONB:='[]'::jsonb;
 advisory_history JSONB:='[]'::jsonb;
 workload_total BIGINT;constrained_total BIGINT;advisory_total BIGINT;
 workload_action TEXT;constrained_action TEXT;advisory_action TEXT;
 preparation_ready BOOLEAN:=FALSE;
 scope_item JSONB;result_item JSONB;scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 row_a_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 row_a_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 row_b_origin public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 row_b_outcome public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
 row_b_evaluation public.canonical_forecast_constrained_capacity_evaluations_v1%ROWTYPE;
 row_c_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 row_c_decision public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 row_c_outcome public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;
 row_c_evaluation public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;
 row_c_continuation public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 row_current BOOLEAN;latest_decision_id UUID;history_item JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(
  org,actor,actor_role,session_value,NULL,FALSE);
 -- This is the complete accepted Part 5A/B/C source fence. It may wait behind
 -- an owning writer, so paid access is rechecked immediately after it drains.
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,NULL,FALSE);
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();

 SELECT * INTO workload_origin
 FROM public.canonical_forecast_workload_capacity_origins_v1 value
 WHERE value.organization_id=org ORDER BY value.created_at DESC,value.id DESC LIMIT 1;
 IF workload_origin.id IS NOT NULL THEN
  workload_origin_current:=public.canonical_forecast_workload_capacity_v1_origin_current(org,workload_origin);
  workload_projection:=public.canonical_forecast_workload_capacity_v1_origin_projection(
   workload_origin,CASE WHEN workload_origin_current THEN 'workload_capacity_origin_current'
    ELSE 'workload_capacity_origin_stale' END,FALSE);
  SELECT * INTO workload_evaluation
  FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
  WHERE value.organization_id=org AND value.origin_id=workload_origin.id
  ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF workload_evaluation.id IS NOT NULL THEN
   workload_evaluation_current:=public.canonical_forecast_workload_capacity_v1_evaluation_current(
    org,workload_evaluation);
   workload_evaluation_projection:=public.canonical_forecast_workload_capacity_v1_evaluation_projection(
    workload_evaluation,CASE WHEN workload_evaluation_current THEN 'workload_capacity_evaluation_current'
     ELSE 'workload_capacity_evaluation_stale' END,FALSE);
  END IF;
 END IF;
 workload_targets:=jsonb_build_array(
  jsonb_build_object('key','workload.accepted_person_hours.v1','evidenceState',
   CASE WHEN NOT workload_origin_current THEN 'unavailable'
    WHEN (workload_origin.private_results->>'workload.accepted_person_hours.v1')::numeric=0 THEN 'authenticated_zero'
    ELSE 'bounded_value' END),
  jsonb_build_object('key','workload.end_backlog_hours.v1','evidenceState',
   CASE WHEN NOT workload_origin_current THEN 'unavailable'
    WHEN (workload_origin.private_results->>'workload.end_backlog_hours.v1')::numeric=0 THEN 'authenticated_zero'
    ELSE 'bounded_value' END),
  jsonb_build_object('key','capacity.available_role_hours.v1','evidenceState',
   CASE WHEN NOT workload_origin_current THEN 'unavailable'
    WHEN (workload_origin.private_results->>'capacity.available_role_hours.v1')::numeric=0 THEN 'authenticated_zero'
    ELSE 'bounded_value' END));
 workload_action:=CASE WHEN workload_origin.id IS NULL THEN 'capture_origin'
  WHEN NOT workload_origin_current THEN 'recover_origin'
  WHEN now_value<workload_origin.horizon_ends_at THEN 'wait_for_horizon'
  WHEN NOT workload_evaluation_current THEN 'capture_evaluation' ELSE 'complete' END;

 SELECT * INTO constrained_origin
 FROM public.canonical_forecast_constrained_capacity_origins_v1 value
 WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.id DESC LIMIT 1;
 IF constrained_origin.id IS NOT NULL THEN
  constrained_origin_current:=public.canonical_forecast_constrained_capacity_v1_origin_current(org,constrained_origin);
  constrained_projection:=public.canonical_forecast_constrained_capacity_v1_origin_projection(
   constrained_origin,CASE WHEN constrained_origin_current THEN 'constrained_capacity_origin_current'
    ELSE 'constrained_capacity_origin_stale' END,FALSE);
  SELECT * INTO constrained_outcome FROM public.canonical_forecast_constrained_capacity_outcomes_v1 value
   WHERE value.organization_id=org AND value.origin_id=constrained_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF constrained_outcome.id IS NOT NULL THEN
   constrained_outcome_current:=public.canonical_forecast_constrained_capacity_v1_outcome_current(org,constrained_outcome);
   constrained_outcome_projection:=public.canonical_forecast_constrained_capacity_v1_outcome_projection(
    constrained_outcome,CASE WHEN constrained_outcome_current THEN 'constrained_capacity_outcome_current'
     ELSE 'constrained_capacity_outcome_stale' END,FALSE);
  END IF;
  SELECT * INTO constrained_evaluation FROM public.canonical_forecast_constrained_capacity_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=constrained_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF constrained_evaluation.id IS NOT NULL THEN
   constrained_evaluation_current:=public.canonical_forecast_constrained_capacity_v1_evaluation_current(
    org,constrained_evaluation);
   constrained_evaluation_projection:=public.canonical_forecast_constrained_capacity_v1_evaluation_projection(
    constrained_evaluation,CASE WHEN constrained_evaluation_current THEN 'constrained_capacity_evaluation_current'
     ELSE 'constrained_capacity_evaluation_stale' END,FALSE);
  END IF;
  FOR scope_item IN SELECT entry FROM jsonb_array_elements(constrained_origin.input_manifest->'scopes') entries(entry)
   ORDER BY entry->>'alternativeKey',entry->>'scopeKey' LOOP
   SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.id=(scope_item->>'reviewId')::uuid;
   SELECT entry INTO result_item FROM jsonb_array_elements(constrained_origin.private_results) entries(entry)
    WHERE entry->>'alternativeKey'=scope_item->>'alternativeKey'
     AND entry->>'scopeKey'=scope_item->>'scopeKey' LIMIT 1;
   constrained_scopes:=constrained_scopes||jsonb_build_array(jsonb_build_object(
    'alternativeKey',scope_item->>'alternativeKey','scopeKey',scope_item->>'scopeKey',
    'role',scope_review.definition->>'role','dimensions',jsonb_build_object(
     'crew',(scope_review.definition#>>'{applicability,crew}')::boolean,
     'skill',(scope_review.definition#>>'{applicability,skill}')::boolean,
     'workingHours',(scope_review.definition#>>'{applicability,workingHours}')::boolean,
     'location',(scope_review.definition#>>'{applicability,location}')::boolean,
     'travel',(scope_review.definition#>>'{applicability,travel}')::boolean,
     'vehicle',(scope_review.definition#>>'{applicability,vehicle}')::boolean,
     'equipment',(scope_review.definition#>>'{applicability,equipment}')::boolean),
    'evidenceState',CASE WHEN NOT constrained_origin_current OR result_item IS NULL THEN 'unavailable'
     WHEN (result_item->>'personMinutes')::numeric=0 THEN 'authenticated_zero' ELSE 'bounded_value' END));
  END LOOP;
 END IF;
 constrained_action:=CASE WHEN constrained_origin.id IS NULL THEN 'capture_origin'
  WHEN NOT constrained_origin_current THEN 'recover_origin'
  WHEN now_value<constrained_origin.horizon_ends_at THEN 'wait_for_horizon'
  WHEN NOT constrained_outcome_current THEN 'capture_outcome'
  WHEN NOT constrained_evaluation_current THEN 'capture_evaluation' ELSE 'complete' END;

 SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
 WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
 IF advisory_origin.id IS NOT NULL THEN
  advisory_origin_current:=public.canonical_forecast_capacity_advisory_v1_origin_current(org,advisory_origin);
  advisory_decision:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,advisory_origin.id);
  advisory_projection:=public.canonical_forecast_capacity_advisory_v1_origin_projection(
   advisory_origin,CASE WHEN advisory_origin_current THEN 'capacity_advisory_origin_current'
    ELSE 'capacity_advisory_origin_stale' END,FALSE,
   CASE WHEN advisory_origin_current THEN advisory_decision.action ELSE NULL END);
  SELECT * INTO advisory_outcome FROM public.canonical_forecast_capacity_advisory_outcomes_v1 value
   WHERE value.organization_id=org AND value.origin_id=advisory_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF advisory_outcome.id IS NOT NULL THEN
   advisory_outcome_current:=public.canonical_forecast_capacity_advisory_v1_outcome_current(org,advisory_outcome);
   advisory_outcome_projection:=public.canonical_forecast_capacity_advisory_v1_outcome_projection(
    advisory_outcome,CASE WHEN advisory_outcome_current THEN 'capacity_advisory_outcome_current'
     ELSE 'capacity_advisory_outcome_stale' END,FALSE);
  END IF;
  SELECT * INTO advisory_evaluation FROM public.canonical_forecast_capacity_advisory_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=advisory_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF advisory_evaluation.id IS NOT NULL THEN
   advisory_evaluation_current:=public.canonical_forecast_capacity_advisory_v1_evaluation_current(org,advisory_evaluation);
   advisory_evaluation_projection:=public.canonical_forecast_capacity_advisory_v1_evaluation_projection(
    advisory_evaluation,CASE WHEN advisory_evaluation_current THEN 'capacity_advisory_evaluation_current'
     ELSE 'capacity_advisory_evaluation_stale' END,FALSE);
  END IF;
  SELECT * INTO advisory_continuation FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
   WHERE value.organization_id=org AND value.predecessor_origin_id=advisory_origin.id
   ORDER BY value.reserved_at DESC,value.id DESC LIMIT 1;
  IF advisory_continuation.id IS NOT NULL THEN
   advisory_continuation_projection:=public.canonical_forecast_capacity_advisory_v1_continuation_projection(
    advisory_continuation,FALSE);
  END IF;
  preparation_ready:=EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=(advisory_origin.input_manifest#>>'{workloadOrigin,id}')::uuid
    AND public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,value));
 END IF;
 advisory_action:=CASE WHEN advisory_origin.id IS NULL THEN 'capture_origin'
  WHEN NOT advisory_origin_current THEN 'recover_origin'
  WHEN advisory_decision.id IS NULL OR advisory_decision.action<>'approve' THEN 'review_advisory'
  WHEN now_value<advisory_origin.horizon_ends_at AND advisory_continuation.id IS NULL THEN 'reserve_continuation'
  WHEN now_value<advisory_origin.horizon_ends_at THEN 'wait_for_horizon'
  WHEN NOT preparation_ready THEN 'prepare_outcome'
  WHEN NOT advisory_outcome_current THEN 'capture_outcome'
  WHEN NOT advisory_evaluation_current THEN 'capture_evaluation' ELSE 'complete' END;

 -- Receipt history is bounded for the UI but remains exact and append-only. It
 -- contains only public receipt identities, chronology, state and decisions.
 FOR row_a_origin IN SELECT value.* FROM public.canonical_forecast_workload_capacity_origins_v1 value
  WHERE value.organization_id=org ORDER BY value.created_at DESC,value.id DESC LIMIT 8 LOOP
  row_current:=public.canonical_forecast_workload_capacity_v1_origin_current(org,row_a_origin);
  workload_history:=workload_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'origin',row_a_origin.id,NULL,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_a_origin.created_at,row_a_origin.prediction_cutoff_at,row_a_origin.horizon_ends_at,NULL,NULL));
 END LOOP;
 FOR row_a_evaluation IN SELECT value.* FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
  WHERE value.organization_id=org ORDER BY value.evaluated_at DESC,value.id DESC LIMIT 8 LOOP
  row_current:=public.canonical_forecast_workload_capacity_v1_evaluation_current(org,row_a_evaluation);
  SELECT value.prediction_cutoff_at,value.horizon_ends_at INTO row_a_origin.prediction_cutoff_at,row_a_origin.horizon_ends_at
   FROM public.canonical_forecast_workload_capacity_origins_v1 value
   WHERE value.organization_id=org AND value.id=row_a_evaluation.origin_id;
  workload_history:=workload_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'evaluation',row_a_evaluation.id,row_a_evaluation.origin_id,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_a_evaluation.evaluated_at,row_a_origin.prediction_cutoff_at,row_a_origin.horizon_ends_at,row_a_evaluation.revision,NULL));
 END LOOP;
 SELECT (SELECT count(*) FROM public.canonical_forecast_workload_capacity_origins_v1 value WHERE value.organization_id=org)+
  (SELECT count(*) FROM public.canonical_forecast_workload_capacity_evaluations_v1 value WHERE value.organization_id=org)
 INTO workload_total;

 FOR row_b_origin IN SELECT value.* FROM public.canonical_forecast_constrained_capacity_origins_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.id DESC LIMIT 8 LOOP
  row_current:=public.canonical_forecast_constrained_capacity_v1_origin_current(org,row_b_origin);
  constrained_history:=constrained_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'origin',row_b_origin.id,NULL,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_b_origin.captured_at,row_b_origin.prediction_cutoff_at,row_b_origin.horizon_ends_at,NULL,NULL));
 END LOOP;
 FOR row_b_outcome IN SELECT value.* FROM public.canonical_forecast_constrained_capacity_outcomes_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.id DESC LIMIT 8 LOOP
  row_current:=public.canonical_forecast_constrained_capacity_v1_outcome_current(org,row_b_outcome);
  SELECT value.prediction_cutoff_at,value.horizon_ends_at INTO row_b_origin.prediction_cutoff_at,row_b_origin.horizon_ends_at
   FROM public.canonical_forecast_constrained_capacity_origins_v1 value
   WHERE value.organization_id=org AND value.id=row_b_outcome.origin_id;
  constrained_history:=constrained_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'outcome',row_b_outcome.id,row_b_outcome.origin_id,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_b_outcome.captured_at,row_b_origin.prediction_cutoff_at,row_b_origin.horizon_ends_at,row_b_outcome.revision,NULL));
 END LOOP;
 FOR row_b_evaluation IN SELECT value.* FROM public.canonical_forecast_constrained_capacity_evaluations_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.id DESC LIMIT 8 LOOP
  row_current:=public.canonical_forecast_constrained_capacity_v1_evaluation_current(org,row_b_evaluation);
  SELECT value.prediction_cutoff_at,value.horizon_ends_at INTO row_b_origin.prediction_cutoff_at,row_b_origin.horizon_ends_at
   FROM public.canonical_forecast_constrained_capacity_origins_v1 value
   WHERE value.organization_id=org AND value.id=row_b_evaluation.origin_id;
  constrained_history:=constrained_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'evaluation',row_b_evaluation.id,row_b_evaluation.origin_id,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_b_evaluation.captured_at,row_b_origin.prediction_cutoff_at,row_b_origin.horizon_ends_at,row_b_evaluation.revision,NULL));
 END LOOP;
 SELECT (SELECT count(*) FROM public.canonical_forecast_constrained_capacity_origins_v1 value WHERE value.organization_id=org)+
  (SELECT count(*) FROM public.canonical_forecast_constrained_capacity_outcomes_v1 value WHERE value.organization_id=org)+
  (SELECT count(*) FROM public.canonical_forecast_constrained_capacity_evaluations_v1 value WHERE value.organization_id=org)
 INTO constrained_total;

 FOR row_c_origin IN SELECT value.* FROM public.canonical_forecast_capacity_advisory_origins_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 6 LOOP
  row_current:=public.canonical_forecast_capacity_advisory_v1_origin_current(org,row_c_origin);
  advisory_history:=advisory_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'origin',row_c_origin.id,row_c_origin.previous_id,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_c_origin.captured_at,row_c_origin.prediction_cutoff_at,row_c_origin.horizon_ends_at,row_c_origin.generation,NULL));
 END LOOP;
 FOR row_c_decision IN SELECT value.* FROM public.canonical_forecast_capacity_advisory_decisions_v1 value
  WHERE value.organization_id=org ORDER BY value.decided_at DESC,value.id DESC LIMIT 6 LOOP
  SELECT latest.id INTO latest_decision_id FROM public.canonical_forecast_capacity_advisory_decisions_v1 latest
   WHERE latest.organization_id=org AND latest.origin_id=row_c_decision.origin_id
   ORDER BY latest.revision DESC LIMIT 1;
  SELECT * INTO row_c_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org AND value.id=row_c_decision.origin_id;
  row_current:=latest_decision_id=row_c_decision.id AND
   public.canonical_forecast_capacity_advisory_v1_origin_current(org,row_c_origin);
  advisory_history:=advisory_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'decision',row_c_decision.id,row_c_decision.origin_id,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_c_decision.decided_at,row_c_origin.prediction_cutoff_at,row_c_origin.horizon_ends_at,row_c_decision.revision,row_c_decision.action));
 END LOOP;
 FOR row_c_outcome IN SELECT value.* FROM public.canonical_forecast_capacity_advisory_outcomes_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.id DESC LIMIT 6 LOOP
  row_current:=public.canonical_forecast_capacity_advisory_v1_outcome_current(org,row_c_outcome);
  SELECT * INTO row_c_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org AND value.id=row_c_outcome.origin_id;
  advisory_history:=advisory_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'outcome',row_c_outcome.id,row_c_outcome.origin_id,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_c_outcome.captured_at,row_c_origin.prediction_cutoff_at,row_c_origin.horizon_ends_at,row_c_outcome.revision,NULL));
 END LOOP;
 FOR row_c_evaluation IN SELECT value.* FROM public.canonical_forecast_capacity_advisory_evaluations_v1 value
  WHERE value.organization_id=org ORDER BY value.evaluated_at DESC,value.id DESC LIMIT 6 LOOP
  row_current:=public.canonical_forecast_capacity_advisory_v1_evaluation_current(org,row_c_evaluation);
  SELECT * INTO row_c_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org AND value.id=row_c_evaluation.origin_id;
  advisory_history:=advisory_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'evaluation',row_c_evaluation.id,row_c_evaluation.origin_id,CASE WHEN row_current THEN 'current' ELSE 'stale' END,
   row_c_evaluation.evaluated_at,row_c_origin.prediction_cutoff_at,row_c_origin.horizon_ends_at,row_c_evaluation.revision,NULL));
 END LOOP;
 FOR row_c_continuation IN SELECT value.* FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
  WHERE value.organization_id=org ORDER BY value.reserved_at DESC,value.id DESC LIMIT 6 LOOP
  history_item:=public.canonical_forecast_capacity_advisory_v1_continuation_projection(row_c_continuation,FALSE);
  advisory_history:=advisory_history||jsonb_build_array(public.canonical_forecast_capacity_ui_v1_history_item(
   'continuation',row_c_continuation.id,row_c_continuation.predecessor_origin_id,history_item->>'state',
   row_c_continuation.reserved_at,row_c_continuation.period_start,row_c_continuation.period_end,NULL,NULL));
 END LOOP;
 SELECT (SELECT count(*) FROM public.canonical_forecast_capacity_advisory_origins_v1 value WHERE value.organization_id=org)+
  (SELECT count(*) FROM public.canonical_forecast_capacity_advisory_decisions_v1 value WHERE value.organization_id=org)+
  (SELECT count(*) FROM public.canonical_forecast_capacity_advisory_outcomes_v1 value WHERE value.organization_id=org)+
  (SELECT count(*) FROM public.canonical_forecast_capacity_advisory_evaluations_v1 value WHERE value.organization_id=org)+
  (SELECT count(*) FROM public.canonical_forecast_capacity_advisory_continuations_v1 value WHERE value.organization_id=org)
 INTO advisory_total;

 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'state','capacity_research_journey_current','asOf',now_value,
  'workload',jsonb_build_object('targets',workload_targets,'selectedOrigin',workload_projection,
   'selectedEvaluation',workload_evaluation_projection,
   'history',jsonb_build_object('records',workload_history,'total',workload_total,
    'truncated',workload_total>jsonb_array_length(workload_history)),
   'currentAction',jsonb_build_object('name',workload_action,'originId',workload_origin.id,
    'outcomeId',NULL,'continuationId',NULL,'correctionOriginId',NULL,
    'expectedDecisionId',NULL,'expectedDecisionRevision',NULL)),
  'constrained',jsonb_build_object('selectedOrigin',constrained_projection,
   'selectedOutcome',constrained_outcome_projection,'selectedEvaluation',constrained_evaluation_projection,
   'scopes',constrained_scopes,
   'history',jsonb_build_object('records',constrained_history,'total',constrained_total,
    'truncated',constrained_total>jsonb_array_length(constrained_history)),
   'currentAction',jsonb_build_object('name',constrained_action,'originId',constrained_origin.id,
    'outcomeId',constrained_outcome.id,'continuationId',NULL,'correctionOriginId',NULL,
    'expectedDecisionId',NULL,'expectedDecisionRevision',NULL)),
  'advisory',jsonb_build_object('selectedOrigin',advisory_projection,
   'selectedOutcome',advisory_outcome_projection,'selectedEvaluation',advisory_evaluation_projection,
   'selectedContinuation',advisory_continuation_projection,'preparationReady',preparation_ready,
   'history',jsonb_build_object('records',advisory_history,'total',advisory_total,
    'truncated',advisory_total>jsonb_array_length(advisory_history)),
   'currentAction',jsonb_build_object('name',advisory_action,'originId',advisory_origin.id,
    'outcomeId',advisory_outcome.id,'continuationId',advisory_continuation.id,
    'correctionOriginId',CASE WHEN advisory_origin.id IS NOT NULL AND NOT advisory_origin_current
      THEN advisory_origin.id ELSE NULL END,
    'expectedDecisionId',advisory_decision.id,
    'expectedDecisionRevision',COALESCE(advisory_decision.revision,0))),
  'boundaries',jsonb_build_object(
   'sourceLineage','accepted_installed_northstar_sources',
   'calculationBoundary','qualitative_capacity_research_only',
   'uncertainty','natural_history_accuracy_calibration_confidence_unavailable',
   'alternativesCombined',FALSE,'valuesWithheld',TRUE,'predictionIsFact',FALSE),
  'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v1_action_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,origin_value UUID,outcome_value UUID,correction_value UUID,
 reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;result_value JSONB;request_hash TEXT;key_hash TEXT;
 old_request public.canonical_forecast_capacity_ui_action_requests_v1%ROWTYPE;
 receipt_id JSONB:=NULL;result_origin JSONB:=NULL;result_outcome JSONB:=NULL;
 result_continuation JSONB:=NULL;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR action_value NOT IN('workload_capture_origin','workload_capture_evaluation',
   'constrained_capture_origin','constrained_capture_outcome','constrained_capture_evaluation',
   'advisory_capture_origin','advisory_reserve_continuation','advisory_prepare_outcome',
   'advisory_capture_outcome','advisory_capture_evaluation')
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR confirmation_value<>'m26-capacity-ui-action-v1'
  OR ((action_value IN('workload_capture_origin','constrained_capture_origin',
      'advisory_capture_origin','advisory_reserve_continuation')) IS DISTINCT FROM
      (reason_value IS NOT NULL AND length(reason_value) BETWEEN 10 AND 900))
  OR (action_value NOT IN('workload_capture_origin','constrained_capture_origin',
      'advisory_capture_origin','advisory_reserve_continuation') AND reason_value IS NOT NULL)
  OR (action_value IN('workload_capture_origin','constrained_capture_origin') AND
      (origin_value IS NOT NULL OR outcome_value IS NOT NULL OR correction_value IS NOT NULL))
  OR (action_value='advisory_capture_origin' AND
      (origin_value IS NOT NULL OR outcome_value IS NOT NULL))
  OR (action_value IN('workload_capture_evaluation','constrained_capture_outcome',
      'advisory_reserve_continuation','advisory_prepare_outcome','advisory_capture_outcome') AND
      (origin_value IS NULL OR outcome_value IS NOT NULL OR correction_value IS NOT NULL))
  OR (action_value IN('constrained_capture_evaluation','advisory_capture_evaluation') AND
      (origin_value IS NULL OR outcome_value IS NULL OR correction_value IS NOT NULL)) THEN
  RAISE EXCEPTION 'Capacity UI action request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(
  org,actor,actor_role,session_value,csrf,TRUE);
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'action',action_value,'originId',origin_value,'outcomeId',outcome_value,
  'correctionOriginId',correction_value,'reason',CASE WHEN reason_value IS NULL THEN NULL ELSE btrim(reason_value) END,
  'confirmation',confirmation_value));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-ui-action-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old_request FROM public.canonical_forecast_capacity_ui_action_requests_v1 value
  WHERE value.organization_id=org AND value.actor_id=actor AND value.idempotency_key_hash=key_hash;
 IF old_request.idempotency_key_hash IS NOT NULL AND old_request.request_digest<>request_hash THEN
  RAISE EXCEPTION 'Capacity UI action replay conflict' USING ERRCODE='40001';END IF;
 IF old_request.idempotency_key_hash IS NULL THEN
  INSERT INTO public.canonical_forecast_capacity_ui_action_requests_v1(
   organization_id,actor_id,idempotency_key_hash,request_digest,created_at)
  VALUES(org,actor,key_hash,request_hash,public.canonical_forecast_workload_capacity_v1_clock());
 END IF;

 CASE action_value
  WHEN 'workload_capture_origin' THEN
   result_value:=public.canonical_forecast_workload_capacity_v1_origin_capture(
    org,actor,actor_role,session_value,csrf,key_value,reason_value,'m26-workload-capacity-origin-v1');
   receipt_id:=result_value->'id';result_origin:=result_value->'id';
  WHEN 'workload_capture_evaluation' THEN
   result_value:=public.canonical_forecast_workload_capacity_v1_evaluation_capture(
    org,actor,actor_role,session_value,csrf,key_value,origin_value);
   receipt_id:=result_value->'id';result_origin:=result_value->'originId';
  WHEN 'constrained_capture_origin' THEN
   result_value:=public.canonical_forecast_constrained_capacity_v1_origin_capture(
    org,actor,actor_role,session_value,csrf,key_value,reason_value,'m26-constrained-capacity-origin-v1');
   receipt_id:=result_value->'id';result_origin:=result_value->'id';
  WHEN 'constrained_capture_outcome' THEN
   result_value:=public.canonical_forecast_constrained_capacity_v1_outcome_capture(
    org,actor,actor_role,session_value,csrf,key_value,origin_value);
   receipt_id:=result_value->'id';result_origin:=result_value->'originId';
   result_outcome:=result_value->'id';
  WHEN 'constrained_capture_evaluation' THEN
   result_value:=public.canonical_forecast_constrained_capacity_v1_evaluation_capture(
    org,actor,actor_role,session_value,csrf,key_value,origin_value,outcome_value);
   receipt_id:=result_value->'id';result_origin:=result_value->'originId';
   result_outcome:=result_value->'outcomeId';
  WHEN 'advisory_capture_origin' THEN
   result_value:=public.canonical_forecast_capacity_advisory_v1_origin_capture_v2(
    org,actor,actor_role,session_value,csrf,key_value,reason_value,
    'm26-capacity-advisory-origin-v1',correction_value);
   receipt_id:=result_value->'id';result_origin:=result_value->'id';
  WHEN 'advisory_reserve_continuation' THEN
   result_value:=public.canonical_forecast_capacity_advisory_v1_continuation_reserve(
    org,actor,actor_role,session_value,csrf,key_value,origin_value,reason_value,
    'm26-capacity-advisory-continuation-v1');
   receipt_id:=result_value->'id';result_origin:=result_value->'predecessorOriginId';
   result_continuation:=result_value->'id';
  WHEN 'advisory_prepare_outcome' THEN
   result_value:=public.canonical_forecast_capacity_advisory_v1_outcome_prepare(
    org,actor,actor_role,session_value,csrf,key_value,origin_value);
   result_origin:=result_value->'originId';
  WHEN 'advisory_capture_outcome' THEN
   result_value:=public.canonical_forecast_capacity_advisory_v1_outcome_capture(
    org,actor,actor_role,session_value,csrf,key_value,origin_value);
   receipt_id:=result_value->'id';result_origin:=result_value->'originId';
   result_outcome:=result_value->'id';
  WHEN 'advisory_capture_evaluation' THEN
   result_value:=public.canonical_forecast_capacity_advisory_v1_evaluation_capture(
    org,actor,actor_role,session_value,csrf,key_value,origin_value,outcome_value);
   receipt_id:=result_value->'id';result_origin:=result_value->'originId';
   result_outcome:=result_value->'outcomeId';
 END CASE;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','capacity_research_action_recorded','action',action_value,
  'receiptId',receipt_id,'originId',result_origin,'outcomeId',result_outcome,
  'continuationId',result_continuation,'revision',result_value->'revision',
  'researchOnly',TRUE,'automaticActionTaken',FALSE,'replayed',result_value->'replayed');
END $$;

-- The UI may review an advisory without receiving its private digest. The safe
-- predecessor token is the exact immutable decision receipt ID plus revision.
-- The accepted Part 5C writer still owns request hashing, replay and mutation.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v1_decision_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 origin_value UUID,expected_decision_id UUID,expected_revision BIGINT,action_value TEXT,
 reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;predecessor public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 result_value JSONB;expected_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR expected_revision<0 OR ((expected_revision=0) IS DISTINCT FROM (expected_decision_id IS NULL))
  OR action_value NOT IN('approve','reject','withdraw')
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR confirmation_value<>'m26-capacity-ui-decision-v1' THEN
  RAISE EXCEPTION 'Capacity UI decision request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(
  org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,csrf,TRUE);
 IF expected_revision=0 THEN expected_digest:='none';
 ELSE
  SELECT * INTO predecessor FROM public.canonical_forecast_capacity_advisory_decisions_v1 value
   WHERE value.organization_id=org AND value.origin_id=origin_value
    AND value.id=expected_decision_id AND value.revision=expected_revision;
  IF predecessor.id IS NULL THEN
   RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
  expected_digest:=rtrim(predecessor.digest);
 END IF;
 result_value:=public.canonical_forecast_capacity_advisory_v1_decision_mutate(
  org,actor,actor_role,session_value,csrf,key_value,origin_value,action_value,
  expected_revision,expected_digest,reason_value,'m26-capacity-advisory-decision-v1');
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','capacity_advisory_decision_recorded',
  'id',result_value->'id','originId',result_value->'originId','action',result_value->'action',
  'revision',result_value->'revision','researchOnly',TRUE,'automaticActionTaken',FALSE,
  'replayed',result_value->'replayed');
END $$;

REVOKE ALL ON FUNCTION
 public.canonical_forecast_capacity_ui_v1_history_item(text,uuid,uuid,text,timestamptz,timestamptz,timestamptz,bigint,text),
 public.canonical_forecast_capacity_ui_v1_current(uuid,uuid,text,uuid),
 public.canonical_forecast_capacity_ui_v1_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,text,text),
 public.canonical_forecast_capacity_ui_v1_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid,bigint,text,text,text)
 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_capacity_ui_action_requests_v1 FROM PUBLIC;

DO $$ DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_ui_v1_history_item(text,uuid,uuid,text,timestamptz,timestamptz,timestamptz,bigint,text) FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_capacity_ui_action_requests_v1 FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_capacity_ui_v1_current(uuid,uuid,text,uuid),public.canonical_forecast_capacity_ui_v1_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,text,text),public.canonical_forecast_capacity_ui_v1_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid,bigint,text,text,text) TO %I',runtime_role);
 END IF;
END $$;
