-- Mission 26 Part 5D correction v2: bounded prerequisite discovery,
-- purpose-fixed setup reviews and exact action/response relationships.
-- This migration is additive. It does not alter any accepted Part 5A/B/C row.

-- Migration 226's final currentness implementation removed sourceCutoff from
-- the saved demand source before comparing it with demand_source(), even
-- though demand_source() deliberately returns that cutoff. That made every
-- accepted demand review immediately appear stale. Keep migration 226
-- byte-identical and correct the comparison additively here.
CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_is_current(
 org UUID,value public.canonical_forecast_capacity_advisory_reviews_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;source_value JSONB;base_source JSONB;
 scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 current_scope public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 workload_method public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 constraint_method public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 outcome_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 outcome_epoch public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
BEGIN
 latest:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
  org,value.review_kind,value.alternative_key,value.scope_key,value.role_name,value.subject_id);
 IF latest.id IS DISTINCT FROM value.id OR value.action<>'approve' THEN RETURN FALSE;END IF;
 IF value.review_kind='policy' THEN
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(value.source_identity->>'scopeReviewId')::uuid;
  current_scope:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'scope',value.scope_key,NULL);
  SELECT * INTO workload_method FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(value.source_identity->>'workloadMethodId')::uuid;
  SELECT * INTO constraint_method FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(value.source_identity->>'constraintMethodId')::uuid;
  RETURN public.canonical_forecast_capacity_advisory_v1_policy_valid(value.definition)
   AND value.source_digest=public.canonical_completion_digest(value.source_identity)
   AND scope_review.id IS NOT NULL AND rtrim(scope_review.digest)=value.source_identity->>'scopeReviewDigest'
   AND scope_review.action='approve' AND current_scope.id IS NOT NULL AND current_scope.action='approve'
   AND current_scope.definition->>'alternativeKey' IS NOT DISTINCT FROM value.alternative_key
   AND current_scope.definition->>'role' IS NOT DISTINCT FROM value.role_name
   AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,current_scope)
   AND workload_method.id IS NOT NULL AND workload_method.action='approve'
   AND rtrim(workload_method.digest)=value.source_identity->>'workloadMethodDigest'
   AND workload_method.id=(SELECT current_method.id FROM public.canonical_forecast_workload_capacity_reviews_v1 current_method
     WHERE current_method.organization_id=org AND current_method.review_kind='method'
      AND current_method.target_key='workload.end_backlog_hours.v1' ORDER BY current_method.revision DESC LIMIT 1)
   AND workload_method.source_digest=public.canonical_completion_digest(
    public.canonical_forecast_workload_capacity_v1_review_source(org,'method','workload.end_backlog_hours.v1',NULL,NULL))
   AND constraint_method.id IS NOT NULL AND constraint_method.action='approve'
   AND rtrim(constraint_method.digest)=value.source_identity->>'constraintMethodDigest'
   AND constraint_method.id=(public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'method',NULL,NULL)).id
   AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,constraint_method);
 END IF;
 IF value.review_kind IN('demand','outcome_demand') THEN
  IF public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(org,value) IS NOT TRUE THEN RETURN FALSE;END IF;
  IF value.review_kind='outcome_demand' THEN
   SELECT * INTO outcome_origin FROM public.canonical_forecast_capacity_advisory_origins_v1
    WHERE organization_id=org AND id=value.subject_id;
   SELECT * INTO outcome_epoch FROM public.canonical_forecast_capacity_advisory_epochs_v1
    WHERE organization_id=org AND id=outcome_origin.epoch_id;
   IF outcome_origin.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,outcome_epoch) IS NOT TRUE
    OR EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_origins_v1 newer
      WHERE newer.organization_id=org AND newer.epoch_id=outcome_origin.epoch_id
       AND newer.prediction_cutoff_at=outcome_origin.prediction_cutoff_at
       AND newer.horizon_ends_at=outcome_origin.horizon_ends_at AND newer.generation>outcome_origin.generation) THEN RETURN FALSE;END IF;
  END IF;
  source_value:=public.canonical_forecast_capacity_advisory_v1_demand_source(org,value.review_kind,
   value.alternative_key,value.subject_id,value.definition,
   CASE WHEN value.review_kind='demand' THEN (value.source_identity->>'effectiveStart')::timestamptz
    ELSE (value.source_identity->>'effectiveEnd')::timestamptz END);
  base_source:=value.source_identity-ARRAY['periodAuthorityId','effectiveStart','effectiveEnd',
   'correctionOfReviewId','correctionGeneration','observedAt','continuationId',
   'predecessorDecisionId','predecessorDecisionDigest','predecessorOutcomeId','predecessorOutcomeDigest',
   'predecessorEvaluationId','predecessorEvaluationDigest']::text[];
  RETURN (source_value-'sourceCutoff')=(base_source-'sourceCutoff')
   AND (source_value->>'sourceCutoff')::timestamptz=(base_source->>'sourceCutoff')::timestamptz;
 END IF;
 source_value:=public.canonical_forecast_capacity_advisory_v1_review_source(org,value.review_kind,
  value.alternative_key,value.scope_key,value.role_name,value.subject_id,value.definition);
 RETURN value.source_digest=public.canonical_completion_digest(source_value);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE TABLE public.canonical_forecast_capacity_ui_setup_requests_v2 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 actor_id UUID NOT NULL REFERENCES public.users(id),
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 response JSONB NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_id,idempotency_key_hash)
);
CREATE TRIGGER canonical_forecast_capacity_ui_setup_requests_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_capacity_ui_setup_requests_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable();

CREATE TABLE public.canonical_forecast_capacity_ui_action_requests_v2 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 actor_id UUID NOT NULL REFERENCES public.users(id),
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_id,idempotency_key_hash)
);
CREATE TRIGGER canonical_forecast_capacity_ui_action_requests_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_capacity_ui_action_requests_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable();

CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_child_key(key_value TEXT,suffix_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT 'ui2:'||encode(sha256(convert_to(key_value||':'||suffix_value,'UTF8')),'hex')
$$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_scope_definition(role_value TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'alternativeKey','accepted_team','scopeKey','accepted_role','role',role_value,
  'applicability',jsonb_build_object('crew',FALSE,'skill',FALSE,'workingHours',TRUE,
   'location',FALSE,'travel',FALSE,'vehicle',FALSE,'equipment',FALSE),
  'crewIds','[]'::jsonb,'crewRoleRequirements','[]'::jsonb,'crewAssignments','[]'::jsonb,
  'skillIds','[]'::jsonb,'locationKey','not_applicable','travelPairs','[]'::jsonb,
  'vehicleAssetIds','[]'::jsonb,'equipmentAssetIds','[]'::jsonb,
  'operatorProfileIds','[]'::jsonb,'assetAssignments','[]'::jsonb,
  'assetRequirements',jsonb_build_object('vehiclePerSeat',0,'equipmentPerSeat',0),
  'assetCalendars','[]'::jsonb)
$$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_demand_definition(
 alternative_value TEXT,constraint_input JSONB,kind_value TEXT,origin_value UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_item JSONB;scope_review JSONB;applicability JSONB:='[]'::jsonb;definition_value JSONB;
BEGIN
 FOR scope_item IN SELECT entry FROM jsonb_array_elements(constraint_input->'scopes') entries(entry)
  WHERE entry->>'alternativeKey'=alternative_value ORDER BY entry->>'scopeKey' LOOP
  scope_review:=scope_item->'definition';
  IF scope_review IS NULL THEN
   RAISE EXCEPTION 'Safe demand scope unavailable' USING ERRCODE='22023';
  END IF;
  applicability:=applicability||jsonb_build_array(jsonb_build_object(
   'scopeKey',scope_review->>'scopeKey','targetRole',scope_review->>'role','targetSeats',1,
   'supportRoles','[]'::jsonb,'operatorRoles','[]'::jsonb));
 END LOOP;
 definition_value:=jsonb_build_object(
  'methodVersion',CASE WHEN kind_value='demand' THEN 'm26-capacity-advisory-demand-allocation-v1'
    ELSE 'm26-capacity-advisory-outcome-allocation-v1' END,
  'alternativeKey',alternative_value,'scopeApplicability',applicability,'allocations','[]'::jsonb);
 IF kind_value='outcome_demand' THEN
  definition_value:=definition_value||jsonb_build_object('originId',origin_value);
 END IF;
 RETURN definition_value;
END $$;

-- Internal planner. The runtime role is explicitly denied this helper. Only the
-- bounded v2 projection exposes its safe fields; `_source` is an opaque token
-- input and never leaves the database.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_setup_plan(org UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 now_value TIMESTAMPTZ:=public.canonical_forecast_workload_capacity_v1_clock();
 workload_epoch public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 workload_method public.canonical_forecast_workload_capacity_methods_v1%ROWTYPE;
 workload_review public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 role_generation public.canonical_forecast_workload_capacity_role_generations_v1%ROWTYPE;
 constrained_epoch public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 constrained_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 advisory_epoch public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 advisory_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 saved_advisory_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 advisory_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 advisory_continuation public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 advisory_evaluation public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 source_value JSONB;backlog_value JSONB;constraint_input JSONB;scope_item JSONB;
 selected_role TEXT:='other';action_value TEXT:=NULL;state_value TEXT:='complete';lane_value TEXT:=NULL;
 label_value TEXT:='Prerequisites current';explanation_value TEXT:='Accepted prerequisite reviews and coverage epochs are current.';
 marker JSONB:=jsonb_build_object('state','complete');token_value TEXT:=NULL;role_missing BOOLEAN:=FALSE;
 scope_missing BOOLEAN:=FALSE;policy_missing BOOLEAN:=FALSE;demand_missing BOOLEAN:=FALSE;
 correction_missing BOOLEAN:=FALSE;
 review_current BOOLEAN:=FALSE;work_count INTEGER:=0;reason_limit INTEGER:=NULL;
 hiring_periods INTEGER:=2;hiring_min INTEGER;hiring_max INTEGER;period_count INTEGER;
BEGIN
 SELECT * INTO workload_epoch FROM public.canonical_forecast_workload_capacity_epochs_v1 value
  WHERE value.organization_id=org ORDER BY value.revision DESC LIMIT 1;
 IF workload_epoch.id IS NULL THEN
  action_value:='workload_epoch';state_value:='ready';lane_value:='all';reason_limit:=1000;
  label_value:='Start prospective source coverage';
  explanation_value:='Install the accepted prospective workload coverage boundary before any forecast receipt can be saved.';
  marker:=jsonb_build_object('action',action_value,'source','no_workload_epoch');
 END IF;

 IF action_value IS NULL THEN
  FOR workload_method IN SELECT * FROM public.canonical_forecast_workload_capacity_methods_v1 ORDER BY target_key LOOP
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='method' AND value.target_key=workload_method.target_key
    ORDER BY value.revision DESC LIMIT 1;
   source_value:=public.canonical_forecast_workload_capacity_v1_review_source(
    org,'method',workload_method.target_key,NULL,NULL);
   IF workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest<>public.canonical_completion_digest(source_value) THEN
    action_value:='workload_methods';state_value:='ready';lane_value:='all';reason_limit:=1000;
    label_value:='Review three workload methods';
    explanation_value:='Explicitly approve each distinct accepted-work, remaining-work and base role-capacity method.';
    marker:=jsonb_build_object('action',action_value,'epoch',workload_epoch.id,'target',workload_method.target_key,
     'source',public.canonical_completion_digest(source_value));EXIT;
   END IF;
  END LOOP;
 END IF;

 IF action_value IS NULL THEN
  FOR role_generation IN SELECT DISTINCT ON(value.profile_id) value.*
   FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
   WHERE value.organization_id=org ORDER BY value.profile_id,value.source_order DESC LOOP
   IF role_generation.present AND role_generation.membership_status='active' AND role_generation.account_status='active' THEN
    source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,'role_qualification',
     'capacity.available_role_hours.v1',role_generation.profile_id,role_generation.operational_role);
    SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
     WHERE value.organization_id=org AND value.review_kind='role_qualification'
      AND value.target_key='capacity.available_role_hours.v1' AND value.subject_id=role_generation.profile_id
      AND value.operational_role=role_generation.operational_role ORDER BY value.revision DESC LIMIT 1;
    IF workload_review.id IS NULL OR workload_review.action<>'approve'
     OR workload_review.source_digest<>public.canonical_completion_digest(source_value) THEN
     role_missing:=TRUE;marker:=jsonb_build_object('action','workload_roles','epoch',workload_epoch.id,
      'source',public.canonical_completion_digest(source_value));EXIT;
    END IF;
   END IF;
  END LOOP;
  IF role_missing THEN
   action_value:='workload_roles';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Review workforce role authority';
   explanation_value:='Approve the current source-backed operational role qualification for each active workforce profile. No identity is shown.';
  END IF;
 END IF;

 IF action_value IS NULL THEN
  SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='capacity_role_scope'
    AND value.target_key='capacity.available_role_hours.v1' ORDER BY value.revision DESC LIMIT 1;
  IF workload_review.id IS NOT NULL THEN selected_role:=workload_review.operational_role;END IF;
  source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,'capacity_role_scope',
   'capacity.available_role_hours.v1',NULL,selected_role);
  IF workload_review.id IS NULL OR workload_review.action<>'approve'
   OR workload_review.source_digest<>public.canonical_completion_digest(source_value) THEN
   action_value:='workload_role_scope';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Review the base capacity role';
   explanation_value:='Approve one operational role as the base role-capacity question. Job-specific constraints remain separate.';
   marker:=jsonb_build_object('action',action_value,'role',selected_role,
    'source',public.canonical_completion_digest(source_value));
  END IF;
 END IF;

 IF action_value IS NULL THEN
  FOR role_generation IN SELECT DISTINCT ON(value.profile_id) value.*
   FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
   WHERE value.organization_id=org ORDER BY value.profile_id,value.source_order DESC LOOP
   IF role_generation.present AND role_generation.membership_status='active'
      AND role_generation.account_status='active' AND role_generation.operational_role=selected_role THEN
    source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,'availability_basis',
     'capacity.available_role_hours.v1',role_generation.profile_id,NULL);
    SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
     WHERE value.organization_id=org AND value.review_kind='availability_basis'
      AND value.target_key='capacity.available_role_hours.v1' AND value.subject_id=role_generation.profile_id
     ORDER BY value.revision DESC LIMIT 1;
    IF workload_review.id IS NULL OR workload_review.action<>'approve'
     OR workload_review.source_digest<>public.canonical_completion_digest(source_value) THEN
     role_missing:=TRUE;marker:=jsonb_build_object('action','workload_availability','role',selected_role,
      'source',public.canonical_completion_digest(source_value));EXIT;
    END IF;
   END IF;
  END LOOP;
  IF role_missing THEN
   action_value:='workload_availability';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Review declared availability';
   explanation_value:='Approve the current declared working-time basis for the selected role. Realized attendance remains unverified.';
  END IF;
 END IF;

 IF action_value IS NULL THEN
  backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,now_value);
  FOR scope_item IN SELECT entry FROM jsonb_array_elements(backlog_value->'rows') entries(entry) LOOP
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='remaining_work'
     AND value.subject_id=(scope_item->>'appointmentId')::uuid ORDER BY value.revision DESC LIMIT 1;
   IF workload_review.id IS NULL OR workload_review.action<>'approve' THEN
    state_value:='unavailable';lane_value:='all';
    label_value:='Remaining-work review unavailable';
    explanation_value:='Accepted open work needs its explicit remaining-work review in the owning workflow before capacity research can continue.';
    marker:=jsonb_build_object('state','remaining_work_unavailable');EXIT;
   END IF;
  END LOOP;
 END IF;

 -- The accepted Part 5A origin requires two complete prospective 30-day
 -- windows. Waiting is an honest state; no enabled control can bypass it.
 IF action_value IS NULL AND state_value='complete'
    AND now_value<workload_epoch.installed_at+INTERVAL '5184000 seconds' THEN
  state_value:='waiting';lane_value:='workload';label_value:='Building prospective history';
  explanation_value:='Two complete prospective 30-day source windows are required. Refresh after that accepted history exists.';
  marker:=jsonb_build_object('state','waiting','epoch',workload_epoch.id,'installedAt',workload_epoch.installed_at);
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  SELECT * INTO constrained_epoch FROM public.canonical_forecast_constrained_capacity_epochs_v1 value
   WHERE value.organization_id=org ORDER BY value.revision DESC LIMIT 1;
  IF constrained_epoch.id IS NULL THEN
   action_value:='constrained_epoch';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Start constrained-capacity coverage';
   explanation_value:='Install the source boundary for crew, skill, working hours, location, travel, vehicle and equipment evidence.';
   marker:=jsonb_build_object('action',action_value,'workloadEpoch',workload_epoch.id);
  END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  constrained_review:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'method',NULL,NULL);
  IF constrained_review.id IS NULL OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,constrained_review) IS NOT TRUE THEN
   action_value:='constrained_method';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Review constrained-capacity method';
   explanation_value:='Approve the accepted declared-role supply method before defining any alternative scope.';
   marker:=jsonb_build_object('action',action_value,'epoch',constrained_epoch.id,
    'previous',constrained_review.id,'revision',constrained_review.revision);
  END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  SELECT count(*) INTO period_count FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
    AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
     WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
     ORDER BY latest.revision DESC LIMIT 1)
    AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,value);
  IF period_count=0 THEN
   action_value:='constrained_scope';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Review a seven-dimension scope';
   explanation_value:='Approve one source-backed alternative and scope. Every dimension is recorded separately and alternatives are never summed.';
   marker:=jsonb_build_object('action',action_value,'epoch',constrained_epoch.id,'role',selected_role,
    'definition',public.canonical_completion_digest(public.canonical_forecast_capacity_ui_v2_scope_definition(selected_role)));
  END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  BEGIN
   constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,now_value);
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN
   work_count:=COALESCE((public.canonical_forecast_constrained_capacity_v1_work_census(org,now_value)->>'count')::int,0);
   state_value:='unavailable';lane_value:='all';
   label_value:=CASE WHEN work_count>0 THEN 'Job constraint review unavailable' ELSE 'Constrained evidence unavailable' END;
   explanation_value:=CASE WHEN work_count>0
    THEN 'Accepted work needs one explicit source-backed job constraint review for each alternative in the owning workflow.'
    ELSE 'The accepted constrained-capacity source cannot establish a complete scope without private or assumed data.' END;
   marker:=jsonb_build_object('state','constrained_input_unavailable');
  END;
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(org,'method',NULL,NULL,NULL,NULL);
  IF advisory_review.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,advisory_review) IS NOT TRUE THEN
   action_value:='advisory_method';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Review the five-advisory method';
   explanation_value:='Approve the qualitative bottleneck, backlog, overtime, contractor and hiring-attention method.';
   marker:=jsonb_build_object('action',action_value,'previous',advisory_review.id,'revision',advisory_review.revision);
  END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  FOR scope_item IN SELECT entry FROM jsonb_array_elements(constraint_input->'scopes') entries(entry)
   ORDER BY entry->>'alternativeKey',entry->>'scopeKey' LOOP
   SELECT * INTO constrained_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.id=(scope_item->>'reviewId')::uuid;
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(org,'policy',
    scope_item->>'alternativeKey',scope_item->>'scopeKey',constrained_review.definition->>'role',NULL);
   IF advisory_review.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,advisory_review) IS NOT TRUE THEN
    policy_missing:=TRUE;marker:=jsonb_build_object('action','advisory_policy','scope',scope_item->>'scopeKey',
     'scopeReview',scope_item->>'reviewId','scopeDigest',scope_item->>'digest');EXIT;
   END IF;
  END LOOP;
  IF policy_missing THEN
   action_value:='advisory_policy';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Review private advisory policies';
   explanation_value:='Approve the private qualitative thresholds and a human-selected hiring-attention run length for every scope.';
  END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,now_value);
  FOR scope_item IN SELECT value FROM jsonb_array_elements(constraint_input->'alternatives') values(value) LOOP
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',scope_item#>>'{}',NULL,NULL,NULL);
   IF advisory_review.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,advisory_review) IS NOT TRUE THEN
    demand_missing:=TRUE;EXIT;
   END IF;
  END LOOP;
  IF demand_missing THEN
   IF jsonb_array_length(backlog_value->'rows')>0 THEN
    state_value:='unavailable';lane_value:='all';label_value:='Demand allocation review unavailable';
    explanation_value:='Accepted open work requires an explicit per-job, per-scope allocation in the owning workflow. Capacity research will not infer it.';
    marker:=jsonb_build_object('state','demand_allocation_unavailable');
   ELSE
    action_value:='advisory_demand';state_value:='ready';lane_value:='all';reason_limit:=1000;
    label_value:='Review the demand allocation';
    explanation_value:='Approve the source-backed zero-work allocation separately for each alternative. Alternatives remain unsummed.';
    marker:=jsonb_build_object('action',action_value,'constraint',public.canonical_completion_digest(constraint_input),
     'backlog',backlog_value->>'digest');
   END IF;
  END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' THEN
  SELECT * INTO advisory_epoch FROM public.canonical_forecast_capacity_advisory_epochs_v1 value
   WHERE value.organization_id=org ORDER BY value.revision DESC LIMIT 1;
  IF advisory_epoch.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,advisory_epoch) IS NOT TRUE THEN
   action_value:='advisory_epoch';state_value:='ready';lane_value:='all';reason_limit:=1000;
   label_value:='Install the advisory coverage epoch';
   explanation_value:='Bind the current workload, constrained-capacity, method and policy authorities before an advisory origin is saved.';
   marker:=jsonb_build_object('action',action_value,'workloadEpoch',workload_epoch.id,
    'constrainedEpoch',constrained_epoch.id,'previous',advisory_epoch.id);
  END IF;
 END IF;

 -- The accepted evaluation writer requires an explicit finalized outcome
 -- window. Project that bounded prerequisite before the lane advertises an
 -- evaluation which would otherwise be guaranteed to refuse at the horizon.
 IF action_value IS NULL AND state_value='complete' THEN
  SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.created_at DESC,value.id DESC LIMIT 1;
  IF workload_origin.id IS NOT NULL
     AND public.canonical_forecast_workload_capacity_v1_origin_current(org,workload_origin)
     AND now_value>=workload_origin.horizon_ends_at THEN
   SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1 value
    WHERE value.organization_id=org AND value.window_start=workload_origin.prediction_cutoff_at
     AND value.window_end=workload_origin.horizon_ends_at ORDER BY value.revision DESC LIMIT 1;
   IF workload_window.id IS NULL
      OR public.canonical_forecast_workload_capacity_v1_window_current(org,workload_window) IS NOT TRUE THEN
    action_value:='workload_outcome_window';state_value:='ready';lane_value:='workload';reason_limit:=1000;
    label_value:='Finalize the workload outcome window';
    explanation_value:='Explicitly review and finalize the completed source window before evaluating the saved workload forecast.';
    marker:=jsonb_build_object('action',action_value,'origin',workload_origin.id,
     'windowStart',workload_origin.prediction_cutoff_at,'windowEnd',workload_origin.horizon_ends_at);
   END IF;
  END IF;
 END IF;

 -- Later-period human reviews are projected only when their exact source
 -- authority exists. They are never inferred from private results.
 IF action_value IS NULL AND state_value='complete' THEN
  SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
  IF advisory_origin.id IS NOT NULL
   AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,advisory_origin) IS NOT TRUE
   AND public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(org,advisory_origin) IS TRUE
   AND public.canonical_forecast_capacity_advisory_v1_origin_input_demand_current(org,advisory_origin) IS NOT TRUE THEN
    FOR scope_item IN SELECT entry FROM jsonb_array_elements(advisory_origin.input_manifest->'demands') entries(entry) LOOP
     SELECT * INTO saved_advisory_review FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
      WHERE value.organization_id=org AND value.id=(scope_item->>'reviewId')::uuid;
     SELECT * INTO advisory_review FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
      WHERE value.organization_id=org AND value.review_kind='demand'
       AND value.alternative_key=saved_advisory_review.alternative_key
       AND value.source_identity->>'periodAuthorityId'=saved_advisory_review.source_identity->>'periodAuthorityId'
      ORDER BY value.revision DESC LIMIT 1;
     IF advisory_review.id IS NULL OR advisory_review.id=saved_advisory_review.id
        OR advisory_review.action<>'approve'
        OR public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(org,advisory_review) IS NOT TRUE THEN
      correction_missing:=TRUE;EXIT;
     END IF;
    END LOOP;
    IF correction_missing THEN
     action_value:='advisory_correction_demand';state_value:='ready';lane_value:='advisory';reason_limit:=1000;
     label_value:='Review corrected demand lineage';
     explanation_value:='Append corrected source-backed demand reviews for the same immutable period before saving a recovery origin.';
     marker:=jsonb_build_object('action',action_value,'origin',advisory_origin.id,
      'savedDemand',advisory_origin.input_manifest->>'demandDigest');
    END IF;
   END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' AND advisory_origin.id IS NOT NULL
    AND now_value>=advisory_origin.horizon_ends_at THEN
  SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=(advisory_origin.input_manifest#>>'{workloadOrigin,id}')::uuid
   ORDER BY value.revision DESC LIMIT 1;
  IF workload_evaluation.id IS NOT NULL THEN
   SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1 value
    WHERE value.organization_id=org AND value.id=workload_evaluation.outcome_window_id;
   BEGIN
    PERFORM public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(org,'outcome_demand',
     advisory_origin.id,advisory_origin.id,workload_window.evidence#>'{backlog,rows}',
     public.canonical_forecast_constrained_capacity_v1_complete_input(
      org,advisory_origin.horizon_ends_at,advisory_origin.prediction_cutoff_at));
   EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN
    IF jsonb_array_length(workload_window.evidence#>'{backlog,rows}')=0 THEN
     action_value:='advisory_outcome_demand';state_value:='ready';lane_value:='advisory';reason_limit:=1000;
     label_value:='Review original-period outcome allocation';
     explanation_value:='Approve the source-backed zero-work outcome allocation before the qualitative outcome is captured.';
     marker:=jsonb_build_object('action',action_value,'origin',advisory_origin.id,
      'window',workload_evaluation.outcome_window_id);
    ELSE
     state_value:='unavailable';lane_value:='advisory';label_value:='Outcome allocation review unavailable';
     explanation_value:='Observed open work requires a new explicit per-job outcome allocation in the owning workflow.';
     marker:=jsonb_build_object('state','outcome_allocation_unavailable');
    END IF;
   END;
  END IF;
 END IF;

 IF action_value IS NULL AND state_value='complete' AND advisory_origin.id IS NOT NULL THEN
  SELECT * INTO advisory_continuation FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
   WHERE value.organization_id=org AND value.predecessor_origin_id=advisory_origin.id
   ORDER BY value.reserved_at DESC,value.id DESC LIMIT 1;
  SELECT * INTO advisory_evaluation FROM public.canonical_forecast_capacity_advisory_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=advisory_origin.id ORDER BY value.revision DESC LIMIT 1;
  IF advisory_continuation.id IS NOT NULL AND advisory_evaluation.id IS NOT NULL
   AND now_value>=advisory_continuation.period_start AND now_value<=advisory_continuation.activation_deadline
   AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='demand' AND value.action='approve'
     AND value.source_identity->>'continuationId'=advisory_continuation.id::text) THEN
   action_value:='advisory_continuation_demand';state_value:='ready';lane_value:='advisory';reason_limit:=1000;
   label_value:='Review the successor-period allocation';
   explanation_value:='Bind the exact approved predecessor decision, outcome and evaluation to the reserved gap-free successor period.';
   marker:=jsonb_build_object('action',action_value,'continuation',advisory_continuation.id,
    'predecessor',advisory_origin.id,'evaluation',advisory_evaluation.id);
  END IF;
 END IF;

 IF action_value IS NOT NULL THEN token_value:=public.canonical_completion_digest(marker);END IF;
 SELECT min((value.definition->>'hiringConsecutivePeriods')::int),
        max((value.definition->>'hiringConsecutivePeriods')::int),count(*)
  INTO hiring_min,hiring_max,period_count
 FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
 WHERE value.organization_id=org AND value.review_kind='policy' AND value.action='approve'
  AND value.id=(SELECT latest.id FROM public.canonical_forecast_capacity_advisory_reviews_v1 latest
   WHERE latest.organization_id=org AND latest.review_kind='policy'
    AND latest.alternative_key=value.alternative_key AND latest.scope_key=value.scope_key
    AND latest.role_name=value.role_name ORDER BY latest.revision DESC LIMIT 1);
 IF period_count>0 AND hiring_min=hiring_max THEN hiring_periods:=hiring_min;END IF;
 RETURN jsonb_build_object('state',state_value,'action',action_value,'token',token_value,'lane',lane_value,
  'label',label_value,'explanation',explanation_value,'reasonLimit',reason_limit,
  'hiringConsecutivePeriods',hiring_periods,'_source',marker);
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('state','unavailable','action',NULL,'token',NULL,'lane','all',
  'label','Accepted source authority unavailable',
  'explanation','A required accepted source, review or private authority is unavailable. No capacity action is enabled.',
  'reasonLimit',NULL,'hiringConsecutivePeriods',2,
  '_source',jsonb_build_object('state','unavailable'));
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_hiring_policy(org UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE input_value JSONB;item JSONB;review_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 marker JSONB:='[]'::jsonb;minimum_value INTEGER;maximum_value INTEGER;count_value INTEGER;
 token_value TEXT;state_value TEXT:='unavailable';period_value INTEGER:=2;
BEGIN
 input_value:=public.canonical_forecast_constrained_capacity_v1_complete_input(
  org,public.canonical_forecast_workload_capacity_v1_clock());
 FOR item IN SELECT entry FROM jsonb_array_elements(input_value->'scopes') entries(entry)
  ORDER BY entry->>'alternativeKey',entry->>'scopeKey' LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='policy'
    AND value.alternative_key=item->>'alternativeKey' AND value.scope_key=item->>'scopeKey'
   ORDER BY value.revision DESC LIMIT 1;
  IF review_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,review_value) IS NOT TRUE THEN
   RETURN jsonb_build_object('state','unavailable','token',NULL,'consecutivePeriods',2,'minimum',2,'maximum',12);
  END IF;
  marker:=marker||jsonb_build_array(jsonb_build_array(item->>'alternativeKey',item->>'scopeKey',
   item->>'digest',review_value.id,rtrim(review_value.digest)));
 END LOOP;
 SELECT min((entry->>0)::int),max((entry->>0)::int),count(*) INTO minimum_value,maximum_value,count_value
 FROM (SELECT jsonb_build_array((value.definition->>'hiringConsecutivePeriods')::int) entry
  FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='policy' AND value.action='approve'
   AND value.id=(SELECT latest.id FROM public.canonical_forecast_capacity_advisory_reviews_v1 latest
    WHERE latest.organization_id=org AND latest.review_kind='policy'
     AND latest.alternative_key=value.alternative_key AND latest.scope_key=value.scope_key
     AND latest.role_name=value.role_name ORDER BY latest.revision DESC LIMIT 1)) values;
 IF count_value>0 AND minimum_value=maximum_value THEN period_value:=minimum_value;state_value:='current';END IF;
 token_value:=public.canonical_completion_digest(jsonb_build_object('scopes',marker,'period',period_value));
 RETURN jsonb_build_object('state',state_value,'token',CASE WHEN state_value='current' THEN token_value ELSE NULL END,
  'consecutivePeriods',period_value,'minimum',2,'maximum',12);
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('state','unavailable','token',NULL,'consecutivePeriods',2,'minimum',2,'maximum',12);
END $$;

-- Optional explicit source re-review is projected with a purpose-fixed token.
-- It never exposes the origin, demand manifest or review identities used to
-- bind the accepted same-period correction writer.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_correction_review(org UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE origin_value public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;token_value TEXT;
BEGIN
 SELECT * INTO origin_value FROM public.canonical_forecast_capacity_advisory_origins_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
 IF origin_value.id IS NULL
    OR public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_value) IS NOT TRUE
    OR public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(org,origin_value) IS NOT TRUE
    OR public.canonical_forecast_capacity_advisory_v1_origin_input_demand_current(org,origin_value) IS NOT TRUE THEN
  RETURN jsonb_build_object('state','unavailable','action',NULL,'token',NULL,
   'label','Source correction review unavailable',
   'explanation','A current accepted advisory period is required before its source lineage can be reviewed again.',
   'reasonLimit',NULL);
 END IF;
 token_value:=public.canonical_completion_digest(jsonb_build_object('action','advisory_correction_demand',
  'origin',origin_value.id,'generation',origin_value.generation,
  'demand',origin_value.input_manifest->>'demandDigest'));
 RETURN jsonb_build_object('state','ready','action','advisory_correction_demand','token',token_value,
  'label','Review a source correction',
  'explanation','Append an explicit same-period demand-lineage review. The saved origin becomes stale and recovery appends a new generation.',
  'reasonLimit',1000);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN
 RETURN jsonb_build_object('state','unavailable','action',NULL,'token',NULL,
  'label','Source correction review unavailable',
  'explanation','Current accepted same-period source authority is unavailable. No correction control is enabled.',
  'reasonLimit',NULL);
END $$;

-- Private action selector shared by the read projection and the serializable
-- writer. Callers hold the complete Part 5A/B/C source fence before using it.
-- It returns receipt identities only to its guarded parents and is never
-- executable by the runtime role or PUBLIC.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_current_actions(org UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 now_value TIMESTAMPTZ:=public.canonical_forecast_workload_capacity_v1_clock();plan_value JSONB;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 constrained_origin public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 constrained_outcome public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
 constrained_evaluation public.canonical_forecast_constrained_capacity_evaluations_v1%ROWTYPE;
 advisory_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 advisory_decision public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 advisory_outcome public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;
 advisory_evaluation public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;
 advisory_continuation public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 workload_current BOOLEAN:=FALSE;workload_evaluation_current BOOLEAN:=FALSE;
 constrained_current BOOLEAN:=FALSE;constrained_outcome_current BOOLEAN:=FALSE;
 constrained_evaluation_current BOOLEAN:=FALSE;advisory_current BOOLEAN:=FALSE;
 advisory_outcome_current BOOLEAN:=FALSE;advisory_evaluation_current BOOLEAN:=FALSE;
 preparation_ready BOOLEAN:=FALSE;workload_action TEXT;constrained_action TEXT;advisory_action TEXT;
BEGIN
 plan_value:=public.canonical_forecast_capacity_ui_v2_setup_plan(org);
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1 value
  WHERE value.organization_id=org ORDER BY value.created_at DESC,value.id DESC LIMIT 1;
 IF workload_origin.id IS NOT NULL THEN
  workload_current:=public.canonical_forecast_workload_capacity_v1_origin_current(org,workload_origin);
  SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=workload_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF workload_evaluation.id IS NOT NULL THEN
   workload_evaluation_current:=public.canonical_forecast_workload_capacity_v1_evaluation_current(
    org,workload_evaluation);
  END IF;
 END IF;
 workload_action:=CASE WHEN workload_origin.id IS NULL THEN 'capture_origin'
  WHEN NOT workload_current THEN 'recover_origin'
  WHEN now_value<workload_origin.horizon_ends_at THEN 'wait_for_horizon'
  WHEN NOT workload_evaluation_current THEN 'capture_evaluation' ELSE 'complete' END;

 SELECT * INTO constrained_origin FROM public.canonical_forecast_constrained_capacity_origins_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.id DESC LIMIT 1;
 IF constrained_origin.id IS NOT NULL THEN
  constrained_current:=public.canonical_forecast_constrained_capacity_v1_origin_current(org,constrained_origin);
  SELECT * INTO constrained_outcome FROM public.canonical_forecast_constrained_capacity_outcomes_v1 value
   WHERE value.organization_id=org AND value.origin_id=constrained_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF constrained_outcome.id IS NOT NULL THEN
   constrained_outcome_current:=public.canonical_forecast_constrained_capacity_v1_outcome_current(org,constrained_outcome);
  END IF;
  SELECT * INTO constrained_evaluation FROM public.canonical_forecast_constrained_capacity_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=constrained_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF constrained_evaluation.id IS NOT NULL THEN
   constrained_evaluation_current:=public.canonical_forecast_constrained_capacity_v1_evaluation_current(
    org,constrained_evaluation);
  END IF;
 END IF;
 constrained_action:=CASE WHEN constrained_origin.id IS NULL THEN 'capture_origin'
  WHEN NOT constrained_current THEN 'recover_origin'
  WHEN now_value<constrained_origin.horizon_ends_at THEN 'wait_for_horizon'
  WHEN NOT constrained_outcome_current THEN 'capture_outcome'
  WHEN NOT constrained_evaluation_current THEN 'capture_evaluation' ELSE 'complete' END;

 SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
  WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
 IF advisory_origin.id IS NOT NULL THEN
  advisory_current:=public.canonical_forecast_capacity_advisory_v1_origin_current(org,advisory_origin);
  advisory_decision:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,advisory_origin.id);
  SELECT * INTO advisory_outcome FROM public.canonical_forecast_capacity_advisory_outcomes_v1 value
   WHERE value.organization_id=org AND value.origin_id=advisory_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF advisory_outcome.id IS NOT NULL THEN
   advisory_outcome_current:=public.canonical_forecast_capacity_advisory_v1_outcome_current(org,advisory_outcome);
  END IF;
  SELECT * INTO advisory_evaluation FROM public.canonical_forecast_capacity_advisory_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=advisory_origin.id
   ORDER BY value.revision DESC,value.id DESC LIMIT 1;
  IF advisory_evaluation.id IS NOT NULL THEN
   advisory_evaluation_current:=public.canonical_forecast_capacity_advisory_v1_evaluation_current(
    org,advisory_evaluation);
  END IF;
  SELECT * INTO advisory_continuation FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
   WHERE value.organization_id=org AND value.predecessor_origin_id=advisory_origin.id
   ORDER BY value.reserved_at DESC,value.id DESC LIMIT 1;
  preparation_ready:=EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
   WHERE value.organization_id=org
    AND value.origin_id=(advisory_origin.input_manifest#>>'{workloadOrigin,id}')::uuid
    AND public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,value));
 END IF;
 advisory_action:=CASE WHEN advisory_origin.id IS NULL THEN 'capture_origin'
  WHEN NOT advisory_current THEN 'recover_origin'
  WHEN advisory_decision.id IS NULL OR advisory_decision.action<>'approve' THEN 'review_advisory'
  WHEN now_value<advisory_origin.horizon_ends_at AND advisory_continuation.id IS NULL THEN 'reserve_continuation'
  WHEN now_value<advisory_origin.horizon_ends_at THEN 'wait_for_horizon'
  WHEN NOT preparation_ready THEN 'prepare_outcome'
  WHEN NOT advisory_outcome_current THEN 'capture_outcome'
  WHEN NOT advisory_evaluation_current THEN 'capture_evaluation' ELSE 'complete' END;
 IF advisory_action='recover_origin'
    AND public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(org,advisory_origin) IS NOT TRUE THEN
  advisory_action:='capture_origin';advisory_origin.id:=NULL;advisory_decision.id:=NULL;
  advisory_decision.revision:=NULL;advisory_outcome.id:=NULL;advisory_evaluation.id:=NULL;
  advisory_continuation.id:=NULL;
 END IF;

 IF plan_value->>'state'<>'complete' THEN
  IF NOT (plan_value->>'state'='ready' AND plan_value->>'lane'='advisory') THEN
   workload_action:='review_prerequisites';
  END IF;
  IF NOT (plan_value->>'state'='ready' AND
     (plan_value->>'lane'='advisory' OR
      (plan_value->>'lane'='workload' AND plan_value->>'action'='workload_outcome_window'))) THEN
   constrained_action:='review_prerequisites';
  END IF;
  advisory_action:='review_prerequisites';
 END IF;
 RETURN jsonb_build_object(
  'workload',jsonb_build_object('name',workload_action,'originId',workload_origin.id,
   'outcomeId',NULL,'continuationId',NULL,'correctionOriginId',NULL,
   'expectedDecisionId',NULL,'expectedDecisionRevision',NULL,
   'expectedResultRevision',CASE WHEN workload_action='capture_evaluation'
    THEN COALESCE(workload_evaluation.revision,0)+1 ELSE NULL END),
  'constrained',jsonb_build_object('name',constrained_action,'originId',constrained_origin.id,
   'outcomeId',constrained_outcome.id,'continuationId',NULL,'correctionOriginId',NULL,
   'expectedDecisionId',NULL,'expectedDecisionRevision',NULL,
   'expectedResultRevision',CASE WHEN constrained_action='capture_outcome'
    THEN COALESCE(constrained_outcome.revision,0)+1 WHEN constrained_action='capture_evaluation'
    THEN COALESCE(constrained_evaluation.revision,0)+1 ELSE NULL END),
  'advisory',jsonb_build_object('name',advisory_action,'originId',advisory_origin.id,
   'outcomeId',advisory_outcome.id,'continuationId',advisory_continuation.id,
   'correctionOriginId',CASE WHEN advisory_action='recover_origin' THEN advisory_origin.id ELSE NULL END,
   'expectedDecisionId',advisory_decision.id,'expectedDecisionRevision',COALESCE(advisory_decision.revision,0),
   'expectedResultRevision',CASE WHEN advisory_action='capture_outcome'
    THEN COALESCE(advisory_outcome.revision,0)+1 WHEN advisory_action='capture_evaluation'
    THEN COALESCE(advisory_evaluation.revision,0)+1 ELSE NULL END));
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_current(
 org UUID,actor UUID,actor_role TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;plan_value JSONB;policy_value JSONB;correction_value JSONB;authority JSONB;
 action_value JSONB;
 advisory_origin_value public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
BEGIN
 value:=public.canonical_forecast_capacity_ui_v1_current(org,actor,actor_role,session_value);
 plan_value:=public.canonical_forecast_capacity_ui_v2_setup_plan(org);
 policy_value:=public.canonical_forecast_capacity_ui_v2_hiring_policy(org);
 correction_value:=public.canonical_forecast_capacity_ui_v2_correction_review(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,NULL,FALSE);
 value:=jsonb_set(value,'{workload,currentAction}',
  (value#>'{workload,currentAction}')||jsonb_build_object('expectedResultRevision',
   CASE WHEN value#>>'{workload,currentAction,name}'='capture_evaluation'
     THEN COALESCE((value#>>'{workload,selectedEvaluation,revision}')::bigint,0)+1 ELSE NULL END),FALSE);
 IF plan_value->>'state'='ready' AND plan_value->>'action'='workload_outcome_window' THEN
  value:=jsonb_set(value,'{workload,currentAction}',
   (value#>'{workload,currentAction}')||jsonb_build_object('name','wait_for_horizon',
    'expectedResultRevision',NULL),FALSE);
 END IF;
  value:=jsonb_set(value,'{constrained,currentAction}',
  (value#>'{constrained,currentAction}')||jsonb_build_object('expectedResultRevision',
   CASE WHEN value#>>'{constrained,currentAction,name}'='capture_outcome'
     THEN COALESCE((value#>>'{constrained,selectedOutcome,revision}')::bigint,0)+1
    WHEN value#>>'{constrained,currentAction,name}'='capture_evaluation'
     THEN COALESCE((value#>>'{constrained,selectedEvaluation,revision}')::bigint,0)+1 ELSE NULL END),FALSE);
 IF value#>>'{advisory,currentAction,name}'='recover_origin'
    AND value#>>'{advisory,currentAction,correctionOriginId}' IS NOT NULL THEN
  SELECT * INTO advisory_origin_value FROM public.canonical_forecast_capacity_advisory_origins_v1
   WHERE organization_id=org AND id=(value#>>'{advisory,currentAction,correctionOriginId}')::uuid;
  -- A correction generation is valid only when the non-demand authority for
  -- the saved period remains current. Policy or epoch changes need a fresh
  -- origin instead; advertising correction there is guaranteed to conflict.
  IF advisory_origin_value.id IS NULL
     OR public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(org,advisory_origin_value) IS NOT TRUE THEN
   value:=jsonb_set(value,'{advisory,selectedOrigin}','null'::jsonb,FALSE);
   value:=jsonb_set(value,'{advisory,selectedOutcome}','null'::jsonb,FALSE);
   value:=jsonb_set(value,'{advisory,selectedEvaluation}','null'::jsonb,FALSE);
   value:=jsonb_set(value,'{advisory,selectedContinuation}','null'::jsonb,FALSE);
   value:=jsonb_set(value,'{advisory,preparationReady}','false'::jsonb,FALSE);
   value:=jsonb_set(value,'{advisory,currentAction}',jsonb_build_object(
    'name','capture_origin','originId',NULL,'outcomeId',NULL,'continuationId',NULL,
    'correctionOriginId',NULL,'expectedDecisionId',NULL,'expectedDecisionRevision',0),FALSE);
  END IF;
 END IF;
  value:=jsonb_set(value,'{advisory,currentAction}',
  (value#>'{advisory,currentAction}')||jsonb_build_object('expectedResultRevision',
   CASE WHEN value#>>'{advisory,currentAction,name}'='capture_outcome'
     THEN COALESCE((value#>>'{advisory,selectedOutcome,revision}')::bigint,0)+1
     WHEN value#>>'{advisory,currentAction,name}'='capture_evaluation'
      THEN COALESCE((value#>>'{advisory,selectedEvaluation,revision}')::bigint,0)+1 ELSE NULL END),FALSE);
 IF plan_value->>'state'<>'complete' THEN
  -- Foundational setup blocks the whole journey. Later, lane-specific source
  -- preparation blocks only the actions whose accepted predecessor is not yet
  -- available; independent accepted lanes remain usable.
  IF NOT (plan_value->>'state'='ready' AND plan_value->>'lane'='advisory') THEN
   value:=jsonb_set(value,'{workload,currentAction}',
    (value#>'{workload,currentAction}')||jsonb_build_object(
     'name','review_prerequisites','expectedResultRevision',NULL),FALSE);
  END IF;
  IF NOT (plan_value->>'state'='ready' AND
     (plan_value->>'lane'='advisory' OR
      (plan_value->>'lane'='workload' AND plan_value->>'action'='workload_outcome_window'))) THEN
   value:=jsonb_set(value,'{constrained,currentAction}',
    (value#>'{constrained,currentAction}')||jsonb_build_object(
     'name','review_prerequisites','expectedResultRevision',NULL),FALSE);
  END IF;
  value:=jsonb_set(value,'{advisory,currentAction}',
   (value#>'{advisory,currentAction}')||jsonb_build_object(
    'name','review_prerequisites','expectedResultRevision',NULL),FALSE);
 END IF;
 action_value:=public.canonical_forecast_capacity_ui_v2_current_actions(org);
 value:=jsonb_set(value,'{workload,currentAction}',action_value->'workload',FALSE);
 value:=jsonb_set(value,'{constrained,currentAction}',action_value->'constrained',FALSE);
 value:=jsonb_set(value,'{advisory,currentAction}',action_value->'advisory',FALSE);
 RETURN value||jsonb_build_object('setup',plan_value-'_source','hiringPolicy',policy_value,
  'correctionReview',correction_value);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_setup_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,token_value TEXT,hiring_periods INTEGER,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;plan_value JSONB;policy_value JSONB;correction_value JSONB;request_hash TEXT;key_hash TEXT;
 old_request public.canonical_forecast_capacity_ui_setup_requests_v2%ROWTYPE;result_value JSONB;
 child_result JSONB;last_id UUID:=NULL;last_revision BIGINT:=NULL;replayed_value BOOLEAN:=FALSE;
 method_value public.canonical_forecast_workload_capacity_methods_v1%ROWTYPE;
 role_generation public.canonical_forecast_workload_capacity_role_generations_v1%ROWTYPE;
 workload_review public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 constrained_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 advisory_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 scope_item JSONB;constraint_input JSONB;definition_value JSONB;source_value JSONB;
 advisory_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 advisory_continuation public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 selected_role TEXT:='other';saved_item JSONB;saved_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 expected_token TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
   OR action_value NOT IN('workload_epoch','workload_methods','workload_roles','workload_role_scope',
    'workload_availability','workload_outcome_window','constrained_epoch','constrained_method','constrained_scope','advisory_method',
   'advisory_policy','advisory_demand','advisory_epoch','advisory_outcome_demand',
   'advisory_continuation_demand','advisory_correction_demand','advisory_policy_revision')
  OR token_value!~'^[0-9a-f]{64}$' OR hiring_periods NOT BETWEEN 2 AND 12
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR confirmation_value<>'m26-capacity-ui-setup-v2' THEN
  RAISE EXCEPTION 'Capacity UI setup request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('action',action_value,'token',token_value,
  'hiringConsecutivePeriods',hiring_periods,'reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-ui-setup-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old_request FROM public.canonical_forecast_capacity_ui_setup_requests_v2 value
  WHERE value.organization_id=org AND value.actor_id=actor AND value.idempotency_key_hash=key_hash;
 IF old_request.idempotency_key_hash IS NOT NULL THEN
  IF old_request.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Capacity UI setup replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN jsonb_set(old_request.response,'{replayed}','true'::jsonb,FALSE);
 END IF;
 plan_value:=public.canonical_forecast_capacity_ui_v2_setup_plan(org);
 IF action_value='advisory_policy_revision' THEN
  policy_value:=public.canonical_forecast_capacity_ui_v2_hiring_policy(org);
  expected_token:=policy_value->>'token';
  IF policy_value->>'state'<>'current' OR expected_token IS DISTINCT FROM token_value
   OR (policy_value->>'consecutivePeriods')::int=hiring_periods THEN
    RAISE EXCEPTION 'Capacity UI policy setup changed' USING ERRCODE='40001';END IF;
  ELSIF action_value='advisory_correction_demand' THEN
   correction_value:=public.canonical_forecast_capacity_ui_v2_correction_review(org);
   IF ((plan_value->>'state'='ready' AND plan_value->>'action'=action_value
       AND plan_value->>'token'=token_value)
      OR (correction_value->>'state'='ready' AND correction_value->>'action'=action_value
       AND correction_value->>'token'=token_value)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Capacity UI correction setup changed' USING ERRCODE='40001';END IF;
  ELSE
  expected_token:=plan_value->>'token';
  IF plan_value->>'state'<>'ready' OR plan_value->>'action' IS DISTINCT FROM action_value
   OR expected_token IS DISTINCT FROM token_value THEN
   RAISE EXCEPTION 'Capacity UI setup changed' USING ERRCODE='40001';END IF;
 END IF;

 CASE action_value
 WHEN 'workload_epoch' THEN
  child_result:=public.canonical_forecast_workload_capacity_v1_epoch_capture(org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'workload-epoch'),reason_value,'m26-workload-capacity-epoch-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'workload_methods' THEN
  FOR method_value IN SELECT * FROM public.canonical_forecast_workload_capacity_methods_v1 ORDER BY target_key LOOP
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='method' AND value.target_key=method_value.target_key
    ORDER BY value.revision DESC LIMIT 1;
   source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,'method',method_value.target_key,NULL,NULL);
   IF workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest<>public.canonical_completion_digest(source_value) THEN
    child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
     public.canonical_forecast_capacity_ui_v2_child_key(key_value,'workload-method-'||method_value.target_key),
     'method',method_value.target_key,NULL,NULL,'approve',COALESCE(workload_review.revision,0),
     COALESCE(rtrim(workload_review.digest),'none'),NULL,reason_value,'m26-workload-capacity-review-v1');
    last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
   END IF;
  END LOOP;
 WHEN 'workload_roles' THEN
  FOR role_generation IN SELECT DISTINCT ON(value.profile_id) value.*
   FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
   WHERE value.organization_id=org ORDER BY value.profile_id,value.source_order DESC LOOP
   IF role_generation.present AND role_generation.membership_status='active' AND role_generation.account_status='active' THEN
    source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,'role_qualification',
     'capacity.available_role_hours.v1',role_generation.profile_id,role_generation.operational_role);
    SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
     WHERE value.organization_id=org AND value.review_kind='role_qualification'
      AND value.subject_id=role_generation.profile_id AND value.operational_role=role_generation.operational_role
     ORDER BY value.revision DESC LIMIT 1;
    IF workload_review.id IS NULL OR workload_review.action<>'approve'
     OR workload_review.source_digest<>public.canonical_completion_digest(source_value) THEN
     child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
      public.canonical_forecast_capacity_ui_v2_child_key(key_value,'workload-role-'||role_generation.profile_id::text),
      'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,
      role_generation.operational_role,'approve',COALESCE(workload_review.revision,0),
      COALESCE(rtrim(workload_review.digest),'none'),NULL,reason_value,'m26-workload-capacity-review-v1');
     last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
    END IF;
   END IF;
  END LOOP;
 WHEN 'workload_role_scope' THEN
  SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='capacity_role_scope'
    AND value.target_key='capacity.available_role_hours.v1' ORDER BY value.revision DESC LIMIT 1;
  IF workload_review.id IS NOT NULL THEN selected_role:=workload_review.operational_role;END IF;
  child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'workload-role-scope'),
   'capacity_role_scope','capacity.available_role_hours.v1',NULL,selected_role,'approve',
   COALESCE(workload_review.revision,0),COALESCE(rtrim(workload_review.digest),'none'),NULL,
   reason_value,'m26-workload-capacity-review-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'workload_availability' THEN
  SELECT operational_role INTO selected_role FROM public.canonical_forecast_workload_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='capacity_role_scope'
    AND value.target_key='capacity.available_role_hours.v1' ORDER BY value.revision DESC LIMIT 1;
  FOR role_generation IN SELECT DISTINCT ON(value.profile_id) value.*
   FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
   WHERE value.organization_id=org ORDER BY value.profile_id,value.source_order DESC LOOP
   IF role_generation.present AND role_generation.membership_status='active' AND role_generation.account_status='active'
      AND role_generation.operational_role=selected_role THEN
    SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
     WHERE value.organization_id=org AND value.review_kind='availability_basis'
      AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
    child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
     public.canonical_forecast_capacity_ui_v2_child_key(key_value,'workload-availability-'||role_generation.profile_id::text),
     'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL,'approve',
     COALESCE(workload_review.revision,0),COALESCE(rtrim(workload_review.digest),'none'),NULL,
     reason_value,'m26-workload-capacity-review-v1');
    last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
   END IF;
  END LOOP;
 WHEN 'workload_outcome_window' THEN
  SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.created_at DESC,value.id DESC LIMIT 1;
  child_result:=public.canonical_forecast_workload_capacity_v1_window_finalize(
   org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'workload-outcome-window'),
   workload_origin.prediction_cutoff_at,workload_origin.horizon_ends_at,reason_value);
  last_id:=(child_result->>'id')::uuid;
  SELECT revision INTO last_revision FROM public.canonical_forecast_workload_capacity_windows_v1 WHERE id=last_id;
 WHEN 'constrained_epoch' THEN
  child_result:=public.canonical_forecast_constrained_capacity_v1_epoch_capture(org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'constrained-epoch'),reason_value,
   'm26-constrained-capacity-epoch-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'constrained_method' THEN
  constrained_review:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'method',NULL,NULL);
  child_result:=public.canonical_forecast_constrained_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'constrained-method'),'method',NULL,NULL,'approve',
   COALESCE(constrained_review.revision,0),COALESCE(rtrim(constrained_review.digest),'none'),
   jsonb_build_object('methodVersion','m26-constrained-declared-role-supply-v1'),reason_value,
   'm26-constrained-capacity-review-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'constrained_scope' THEN
  SELECT operational_role INTO selected_role FROM public.canonical_forecast_workload_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='capacity_role_scope'
    AND value.target_key='capacity.available_role_hours.v1' ORDER BY value.revision DESC LIMIT 1;
  constrained_review:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'scope','accepted_role',NULL);
  child_result:=public.canonical_forecast_constrained_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'constrained-scope'),'scope','accepted_role',NULL,'approve',
   COALESCE(constrained_review.revision,0),COALESCE(rtrim(constrained_review.digest),'none'),
   public.canonical_forecast_capacity_ui_v2_scope_definition(selected_role),reason_value,
   'm26-constrained-capacity-review-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'advisory_method' THEN
  advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(org,'method',NULL,NULL,NULL,NULL);
  child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'advisory-method'),'method',NULL,NULL,NULL,NULL,'approve',
   COALESCE(advisory_review.revision,0),COALESCE(rtrim(advisory_review.digest),'none'),
   jsonb_build_object('methodVersion','m26-capacity-advisory-five-category-v1'),reason_value,
   'm26-capacity-advisory-review-v1',NULL,NULL);
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'advisory_policy','advisory_policy_revision' THEN
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
   org,public.canonical_forecast_workload_capacity_v1_clock());
  FOR scope_item IN SELECT entry FROM jsonb_array_elements(constraint_input->'scopes') entries(entry)
   ORDER BY entry->>'alternativeKey',entry->>'scopeKey' LOOP
   SELECT * INTO constrained_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.id=(scope_item->>'reviewId')::uuid;
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(org,'policy',
    scope_item->>'alternativeKey',scope_item->>'scopeKey',constrained_review.definition->>'role',NULL);
   definition_value:=jsonb_build_object('methodVersion','m26-capacity-advisory-five-category-v1',
    'alternativeKey',scope_item->>'alternativeKey','scopeKey',scope_item->>'scopeKey',
    'role',constrained_review.definition->>'role','backlogThresholdMinutes',1,
    'bottleneckGapThresholdMinutes',1,'overtimeReviewEnabled',TRUE,'overtimeGapThresholdMinutes',1,
    'contractorReviewEnabled',TRUE,'contractorGapThresholdMinutes',1,
    'hiringReviewEnabled',TRUE,'hiringGapThresholdMinutes',1,'hiringConsecutivePeriods',hiring_periods);
   IF advisory_review.id IS NULL OR advisory_review.definition IS DISTINCT FROM definition_value
     OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,advisory_review) IS NOT TRUE THEN
    child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(org,actor,actor_role,session_value,csrf,
     public.canonical_forecast_capacity_ui_v2_child_key(key_value,
      'advisory-policy-'||(scope_item->>'alternativeKey')||'-'||(scope_item->>'scopeKey')),
     'policy',scope_item->>'alternativeKey',scope_item->>'scopeKey',constrained_review.definition->>'role',NULL,'approve',
     COALESCE(advisory_review.revision,0),COALESCE(rtrim(advisory_review.digest),'none'),definition_value,
     reason_value,'m26-capacity-advisory-review-v1',NULL,NULL);
    last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
   END IF;
  END LOOP;
 WHEN 'advisory_demand' THEN
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
   org,public.canonical_forecast_workload_capacity_v1_clock());
  -- Add the private scope definitions only inside this transaction so the
  -- internal definition builder can derive safe applicability without exposing
  -- any review identity or manifest to the route.
  SELECT jsonb_set(constraint_input,'{scopes}',COALESCE(jsonb_agg(item||jsonb_build_object('definition',review_value.definition)
    ORDER BY item->>'alternativeKey',item->>'scopeKey'),'[]'::jsonb),FALSE)
   INTO constraint_input
  FROM jsonb_array_elements(constraint_input->'scopes') entries(item)
  JOIN public.canonical_forecast_constrained_capacity_reviews_v1 review_value
   ON review_value.organization_id=org AND review_value.id=(item->>'reviewId')::uuid;
  FOR scope_item IN SELECT value FROM jsonb_array_elements(constraint_input->'alternatives') values(value) LOOP
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',scope_item#>>'{}',NULL,NULL,NULL);
   definition_value:=public.canonical_forecast_capacity_ui_v2_demand_definition(
    scope_item#>>'{}',constraint_input,'demand',NULL);
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'advisory-demand-'||(scope_item#>>'{}')),
    'demand',scope_item#>>'{}',NULL,NULL,NULL,'approve',COALESCE(advisory_review.revision,0),
    COALESCE(rtrim(advisory_review.digest),'none'),definition_value,reason_value,
    'm26-capacity-advisory-review-v1',NULL,NULL);
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
 WHEN 'advisory_epoch' THEN
  child_result:=public.canonical_forecast_capacity_advisory_v1_epoch_capture(org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'advisory-epoch'),reason_value,
   'm26-capacity-advisory-epoch-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'advisory_outcome_demand' THEN
  SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
  SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
   WHERE value.organization_id=org AND value.origin_id=(advisory_origin.input_manifest#>>'{workloadOrigin,id}')::uuid
   ORDER BY value.revision DESC LIMIT 1;
  SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1 value
   WHERE value.organization_id=org AND value.id=workload_evaluation.outcome_window_id;
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
   org,advisory_origin.horizon_ends_at,advisory_origin.prediction_cutoff_at);
  SELECT jsonb_set(constraint_input,'{scopes}',COALESCE(jsonb_agg(item||jsonb_build_object('definition',review_value.definition)
    ORDER BY item->>'alternativeKey',item->>'scopeKey'),'[]'::jsonb),FALSE) INTO constraint_input
  FROM jsonb_array_elements(constraint_input->'scopes') entries(item)
  JOIN public.canonical_forecast_constrained_capacity_reviews_v1 review_value
   ON review_value.organization_id=org AND review_value.id=(item->>'reviewId')::uuid;
  IF jsonb_array_length(workload_window.evidence#>'{backlog,rows}')<>0 THEN
   RAISE EXCEPTION 'Safe zero-work outcome unavailable' USING ERRCODE='22023';END IF;
  FOR scope_item IN SELECT value FROM jsonb_array_elements(constraint_input->'alternatives') values(value) LOOP
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'outcome_demand',scope_item#>>'{}',NULL,NULL,advisory_origin.id);
   definition_value:=public.canonical_forecast_capacity_ui_v2_demand_definition(
    scope_item#>>'{}',constraint_input,'outcome_demand',advisory_origin.id);
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'advisory-outcome-'||(scope_item#>>'{}')),
    'outcome_demand',scope_item#>>'{}',NULL,NULL,advisory_origin.id,'approve',
    COALESCE(advisory_review.revision,0),COALESCE(rtrim(advisory_review.digest),'none'),definition_value,
    reason_value,'m26-capacity-advisory-review-v1',NULL,NULL);
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
 WHEN 'advisory_continuation_demand' THEN
  SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
  SELECT * INTO advisory_continuation FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
   WHERE value.organization_id=org AND value.predecessor_origin_id=advisory_origin.id
   ORDER BY value.reserved_at DESC,value.id DESC LIMIT 1;
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,advisory_continuation.period_start);
  SELECT jsonb_set(constraint_input,'{scopes}',COALESCE(jsonb_agg(item||jsonb_build_object('definition',review_value.definition)
    ORDER BY item->>'alternativeKey',item->>'scopeKey'),'[]'::jsonb),FALSE) INTO constraint_input
  FROM jsonb_array_elements(constraint_input->'scopes') entries(item)
  JOIN public.canonical_forecast_constrained_capacity_reviews_v1 review_value
   ON review_value.organization_id=org AND review_value.id=(item->>'reviewId')::uuid;
  IF jsonb_array_length(public.canonical_forecast_workload_capacity_v1_backlog_evidence(
    org,advisory_continuation.period_start)->'rows')<>0 THEN
   RAISE EXCEPTION 'Safe zero-work continuation unavailable' USING ERRCODE='22023';END IF;
  FOR scope_item IN SELECT value FROM jsonb_array_elements(constraint_input->'alternatives') values(value) LOOP
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',scope_item#>>'{}',NULL,NULL,NULL);
   definition_value:=public.canonical_forecast_capacity_ui_v2_demand_definition(
    scope_item#>>'{}',constraint_input,'demand',NULL);
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'advisory-continuation-'||(scope_item#>>'{}')),
    'demand',scope_item#>>'{}',NULL,NULL,NULL,'approve',COALESCE(advisory_review.revision,0),
    COALESCE(rtrim(advisory_review.digest),'none'),definition_value,reason_value,
    'm26-capacity-advisory-review-v1',advisory_continuation.id,NULL);
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
 WHEN 'advisory_correction_demand' THEN
  SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
  FOR saved_item IN SELECT entry FROM jsonb_array_elements(advisory_origin.input_manifest->'demands') entries(entry)
   ORDER BY entry->>'alternativeKey' LOOP
   SELECT * INTO saved_review FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
    WHERE value.organization_id=org AND value.id=(saved_item->>'reviewId')::uuid;
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',saved_review.alternative_key,NULL,NULL,NULL);
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'advisory-correction-'||saved_review.alternative_key),
    'demand',saved_review.alternative_key,NULL,NULL,NULL,'approve',COALESCE(advisory_review.revision,0),
    COALESCE(rtrim(advisory_review.digest),'none'),saved_review.definition,reason_value,
    'm26-capacity-advisory-review-v1',NULL,saved_review.id);
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
 END CASE;

 IF last_id IS NULL OR last_revision IS NULL THEN
  RAISE EXCEPTION 'Capacity UI setup produced no receipt' USING ERRCODE='40001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 result_value:=jsonb_build_object('state','capacity_research_setup_recorded','action',action_value,
  'token',token_value,'receiptId',last_id,'revision',last_revision,
  'hiringConsecutivePeriods',hiring_periods,'researchOnly',TRUE,'automaticActionTaken',FALSE,'replayed',FALSE);
 INSERT INTO public.canonical_forecast_capacity_ui_setup_requests_v2(
  organization_id,actor_id,idempotency_key_hash,request_digest,response,created_at)
 VALUES(org,actor,key_hash,request_hash,result_value,public.canonical_forecast_workload_capacity_v1_clock());
 RETURN result_value;
END $$;

-- Exact action-specific result relationships are enforced inside the database
-- before a response can cross the guarded route boundary.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_action_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,origin_value UUID,outcome_value UUID,correction_value UUID,
 expected_result_revision BIGINT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;current_value JSONB;lane_value JSONB;authority JSONB;receipt UUID;result_origin UUID;
 result_outcome UUID;result_continuation UUID;
 result_revision BIGINT;key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
 old_request public.canonical_forecast_capacity_ui_action_requests_v2%ROWTYPE;
 matches_current BOOLEAN:=FALSE;
BEGIN
 authority:=public.canonical_forecast_workload_capacity_v1_access(
  org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,csrf,TRUE);
 request_hash:=public.canonical_completion_digest(jsonb_build_object('action',action_value,
  'originId',origin_value,'outcomeId',outcome_value,'correctionOriginId',correction_value,
  'expectedRevision',expected_result_revision,
  'reason',CASE WHEN reason_value IS NULL THEN NULL ELSE btrim(reason_value) END,
  'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:capacity-ui-v2-action-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old_request FROM public.canonical_forecast_capacity_ui_action_requests_v2 old_value
  WHERE old_value.organization_id=org AND old_value.actor_id=actor
   AND old_value.idempotency_key_hash=key_hash;
 IF old_request.idempotency_key_hash IS NOT NULL AND old_request.request_digest<>request_hash THEN
  RAISE EXCEPTION 'Capacity UI v2 action replay conflict' USING ERRCODE='40001';END IF;
 -- A new key may execute only the action projected from the exact current
 -- accepted predecessor while the source locks are held. Exact retries skip
 -- this check because the successful action has legitimately advanced state;
 -- the immutable v1/v2 registries still bind their byte-identical request.
 IF old_request.idempotency_key_hash IS NULL THEN
  current_value:=public.canonical_forecast_capacity_ui_v2_current_actions(org);
  lane_value:=CASE
   WHEN action_value LIKE 'workload_%' THEN current_value->'workload'
   WHEN action_value LIKE 'constrained_%' THEN current_value->'constrained'
   ELSE current_value->'advisory' END;
  CASE action_value
   WHEN 'workload_capture_origin' THEN matches_current:=lane_value->>'name' IN('capture_origin','recover_origin')
    AND origin_value IS NULL AND outcome_value IS NULL AND correction_value IS NULL
    AND expected_result_revision IS NULL;
   WHEN 'workload_capture_evaluation' THEN matches_current:=lane_value->>'name'='capture_evaluation'
    AND lane_value->>'originId'=origin_value::text AND outcome_value IS NULL AND correction_value IS NULL
    AND (lane_value->>'expectedResultRevision')::bigint=expected_result_revision;
   WHEN 'constrained_capture_origin' THEN matches_current:=lane_value->>'name' IN('capture_origin','recover_origin')
    AND origin_value IS NULL AND outcome_value IS NULL AND correction_value IS NULL
    AND expected_result_revision IS NULL;
   WHEN 'constrained_capture_outcome' THEN matches_current:=lane_value->>'name'='capture_outcome'
    AND lane_value->>'originId'=origin_value::text AND outcome_value IS NULL AND correction_value IS NULL
    AND (lane_value->>'expectedResultRevision')::bigint=expected_result_revision;
   WHEN 'constrained_capture_evaluation' THEN matches_current:=lane_value->>'name'='capture_evaluation'
    AND lane_value->>'originId'=origin_value::text AND lane_value->>'outcomeId'=outcome_value::text
    AND correction_value IS NULL AND (lane_value->>'expectedResultRevision')::bigint=expected_result_revision;
   WHEN 'advisory_capture_origin' THEN matches_current:=lane_value->>'name' IN('capture_origin','recover_origin')
    AND origin_value IS NULL AND outcome_value IS NULL
    AND lane_value->>'correctionOriginId' IS NOT DISTINCT FROM correction_value::text
    AND expected_result_revision IS NULL;
   WHEN 'advisory_reserve_continuation' THEN matches_current:=lane_value->>'name'='reserve_continuation'
    AND lane_value->>'originId'=origin_value::text AND outcome_value IS NULL AND correction_value IS NULL
    AND expected_result_revision IS NULL;
   WHEN 'advisory_prepare_outcome' THEN matches_current:=lane_value->>'name'='prepare_outcome'
    AND lane_value->>'originId'=origin_value::text AND outcome_value IS NULL AND correction_value IS NULL
    AND expected_result_revision IS NULL;
   WHEN 'advisory_capture_outcome' THEN matches_current:=lane_value->>'name'='capture_outcome'
    AND lane_value->>'originId'=origin_value::text AND outcome_value IS NULL AND correction_value IS NULL
    AND (lane_value->>'expectedResultRevision')::bigint=expected_result_revision;
   WHEN 'advisory_capture_evaluation' THEN matches_current:=lane_value->>'name'='capture_evaluation'
    AND lane_value->>'originId'=origin_value::text AND lane_value->>'outcomeId'=outcome_value::text
    AND correction_value IS NULL AND (lane_value->>'expectedResultRevision')::bigint=expected_result_revision;
   ELSE matches_current:=FALSE;
  END CASE;
  IF matches_current IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity UI action predecessor changed' USING ERRCODE='40001';
  END IF;
 END IF;
 value:=public.canonical_forecast_capacity_ui_v1_action_mutate(org,actor,actor_role,session_value,csrf,key_value,
  action_value,origin_value,outcome_value,correction_value,reason_value,confirmation_value);
 receipt:=NULLIF(value->>'receiptId','')::uuid;result_origin:=NULLIF(value->>'originId','')::uuid;
 result_outcome:=NULLIF(value->>'outcomeId','')::uuid;result_continuation:=NULLIF(value->>'continuationId','')::uuid;
 result_revision:=NULLIF(value->>'revision','')::bigint;
 IF value->>'action' IS DISTINCT FROM action_value
  OR ((action_value IN('workload_capture_evaluation','constrained_capture_outcome','constrained_capture_evaluation',
       'advisory_capture_outcome','advisory_capture_evaluation')) IS DISTINCT FROM
      (expected_result_revision IS NOT NULL AND expected_result_revision>=1))
  OR (action_value='workload_capture_origin' AND NOT COALESCE(receipt IS NOT NULL AND receipt=result_origin
      AND origin_value IS NULL AND result_outcome IS NULL AND result_continuation IS NULL
      AND result_revision IS NULL,FALSE))
  OR (action_value='workload_capture_evaluation' AND NOT COALESCE(receipt IS NOT NULL AND receipt<>origin_value
      AND result_origin=origin_value AND result_outcome IS NULL AND result_continuation IS NULL
      AND result_revision=expected_result_revision,FALSE))
  OR (action_value='constrained_capture_origin' AND NOT COALESCE(receipt IS NOT NULL AND receipt=result_origin
      AND origin_value IS NULL AND result_outcome IS NULL AND result_continuation IS NULL
      AND result_revision IS NULL,FALSE))
  OR (action_value='constrained_capture_outcome' AND NOT COALESCE(receipt IS NOT NULL AND receipt<>origin_value
      AND result_origin=origin_value AND receipt=result_outcome AND result_continuation IS NULL
      AND result_revision=expected_result_revision,FALSE))
  OR (action_value='constrained_capture_evaluation' AND NOT COALESCE(receipt IS NOT NULL AND receipt<>origin_value
      AND receipt<>outcome_value AND result_origin=origin_value AND result_outcome=outcome_value
      AND result_continuation IS NULL AND result_revision=expected_result_revision,FALSE))
  OR (action_value='advisory_capture_origin' AND NOT COALESCE(receipt IS NOT NULL AND receipt=result_origin
      AND receipt IS DISTINCT FROM correction_value AND origin_value IS NULL AND result_outcome IS NULL
      AND result_continuation IS NULL AND result_revision IS NULL,FALSE))
  OR (action_value='advisory_reserve_continuation' AND NOT COALESCE(receipt IS NOT NULL AND receipt<>origin_value
      AND result_origin=origin_value AND result_outcome IS NULL AND receipt=result_continuation
      AND result_revision IS NULL,FALSE))
  OR (action_value='advisory_prepare_outcome' AND NOT COALESCE(receipt IS NULL AND result_origin=origin_value
      AND result_outcome IS NULL AND result_continuation IS NULL AND result_revision IS NULL,FALSE))
  OR (action_value='advisory_capture_outcome' AND NOT COALESCE(receipt IS NOT NULL AND receipt<>origin_value
      AND result_origin=origin_value AND receipt=result_outcome AND result_continuation IS NULL
      AND result_revision=expected_result_revision,FALSE))
  OR (action_value='advisory_capture_evaluation' AND NOT COALESCE(receipt IS NOT NULL AND receipt<>origin_value
      AND receipt<>outcome_value AND result_origin=origin_value AND result_outcome=outcome_value
      AND result_continuation IS NULL AND result_revision=expected_result_revision,FALSE)) THEN
  RAISE EXCEPTION 'Capacity UI action response relationship invalid' USING ERRCODE='22023';END IF;
 IF old_request.idempotency_key_hash IS NULL THEN
  INSERT INTO public.canonical_forecast_capacity_ui_action_requests_v2(
   organization_id,actor_id,idempotency_key_hash,request_digest,created_at)
  VALUES(org,actor,key_hash,request_hash,public.canonical_forecast_workload_capacity_v1_clock());
 END IF;
 RETURN value||jsonb_build_object('correctionOriginId',CASE WHEN action_value='advisory_capture_origin'
  THEN correction_value ELSE NULL END);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v2_decision_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 origin_value UUID,expected_decision_id UUID,expected_revision BIGINT,action_value TEXT,
 reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;
BEGIN
 value:=public.canonical_forecast_capacity_ui_v1_decision_mutate(org,actor,actor_role,session_value,csrf,key_value,
  origin_value,expected_decision_id,expected_revision,action_value,reason_value,confirmation_value);
 IF NOT COALESCE(value->>'originId'=origin_value::text AND value->>'action'=action_value
  AND value->>'id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND value->>'id'<>origin_value::text AND (value->>'revision')::bigint=expected_revision+1
  AND (expected_decision_id IS NULL OR value->>'id'<>expected_decision_id::text),FALSE) THEN
  RAISE EXCEPTION 'Capacity UI decision response relationship invalid' USING ERRCODE='22023';END IF;
 RETURN value||jsonb_build_object('previousDecisionId',expected_decision_id,
  'previousDecisionRevision',expected_revision);
END $$;

REVOKE ALL ON FUNCTION
 public.canonical_forecast_capacity_ui_v2_child_key(text,text),
 public.canonical_forecast_capacity_ui_v2_scope_definition(text),
 public.canonical_forecast_capacity_ui_v2_demand_definition(text,jsonb,text,uuid),
 public.canonical_forecast_capacity_ui_v2_setup_plan(uuid),
 public.canonical_forecast_capacity_ui_v2_hiring_policy(uuid),
 public.canonical_forecast_capacity_ui_v2_correction_review(uuid),
 public.canonical_forecast_capacity_ui_v2_current_actions(uuid),
 public.canonical_forecast_capacity_ui_v2_current(uuid,uuid,text,uuid),
 public.canonical_forecast_capacity_ui_v2_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text),
 public.canonical_forecast_capacity_ui_v2_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text),
 public.canonical_forecast_capacity_ui_v2_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid,bigint,text,text,text)
 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_capacity_ui_setup_requests_v2,
 public.canonical_forecast_capacity_ui_action_requests_v2 FROM PUBLIC;

DO $$ DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_capacity_ui_setup_requests_v2,public.canonical_forecast_capacity_ui_action_requests_v2 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_ui_v2_child_key(text,text),public.canonical_forecast_capacity_ui_v2_scope_definition(text),public.canonical_forecast_capacity_ui_v2_demand_definition(text,jsonb,text,uuid),public.canonical_forecast_capacity_ui_v2_setup_plan(uuid),public.canonical_forecast_capacity_ui_v2_hiring_policy(uuid),public.canonical_forecast_capacity_ui_v2_correction_review(uuid),public.canonical_forecast_capacity_ui_v2_current_actions(uuid) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_capacity_ui_v2_current(uuid,uuid,text,uuid),public.canonical_forecast_capacity_ui_v2_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text),public.canonical_forecast_capacity_ui_v2_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text),public.canonical_forecast_capacity_ui_v2_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid,bigint,text,text,text) TO %I',runtime_role);
 END IF;
END $$;
