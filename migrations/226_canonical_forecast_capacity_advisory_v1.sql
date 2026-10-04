-- Mission 26 Part 5C: tenant-private qualitative workload/capacity advisories.
-- Values and thresholds remain private; no operational authority is mutated.
CREATE TABLE public.canonical_forecast_capacity_advisory_methods_v1 (
 method_key TEXT PRIMARY KEY CHECK(method_key='workforce.capacity_advisory.v1'),
 version TEXT NOT NULL CHECK(version='v1'),
 horizon_seconds INTEGER NOT NULL CHECK(horizon_seconds=2592000),
 calculation_version TEXT NOT NULL,
 definition JSONB NOT NULL,
 definition_digest TEXT NOT NULL CHECK(definition_digest~'^[0-9a-f]{64}$')
);
INSERT INTO public.canonical_forecast_capacity_advisory_methods_v1
SELECT 'workforce.capacity_advisory.v1','v1',2592000,'m26-capacity-advisory-five-category-v1',value,
 public.canonical_completion_digest(value)
FROM (SELECT jsonb_build_object(
 'sourceTargets',jsonb_build_array('workload.end_backlog_hours.v1','capacity.available_role_hours.v1'),
 'categories',jsonb_build_array('bottleneck','backlog','overtime','contractor','hiring_need'),
 'grain','alternative_scope_declared_role','window','half_open_2592000_seconds',
 'qualitativeOnly',TRUE,'humanDecisionRequired',TRUE,'automaticAction',FALSE) value) source;

CREATE TABLE public.canonical_forecast_capacity_advisory_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 review_kind TEXT NOT NULL CHECK(review_kind IN('method','policy','demand','outcome_demand')),
 alternative_key TEXT,
 scope_key TEXT,
 role_name TEXT,
 subject_id UUID,
 revision BIGINT NOT NULL CHECK(revision>=1),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN('approve','reject','withdraw')),
 definition JSONB NOT NULL,
 source_identity JSONB NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m26-capacity-advisory-review-v1'),
 actor_id UUID NOT NULL REFERENCES public.users(id),
 membership_id UUID NOT NULL,
 session_id UUID NOT NULL,
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 decided_at TIMESTAMPTZ NOT NULL,
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_capacity_advisory_reviews_v1(organization_id,id),
 CHECK((review_kind='method' AND alternative_key IS NULL AND scope_key IS NULL AND role_name IS NULL AND subject_id IS NULL)
    OR (review_kind='policy' AND alternative_key IS NOT NULL AND scope_key IS NOT NULL AND role_name IS NOT NULL AND subject_id IS NULL)
    OR (review_kind='demand' AND alternative_key IS NOT NULL AND scope_key IS NULL AND role_name IS NULL AND subject_id IS NULL)
    OR (review_kind='outcome_demand' AND alternative_key IS NOT NULL AND scope_key IS NULL AND role_name IS NULL AND subject_id IS NOT NULL))
);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_review_revision_v1
 ON public.canonical_forecast_capacity_advisory_reviews_v1(
 organization_id,review_kind,COALESCE(alternative_key,''),COALESCE(scope_key,''),COALESCE(role_name,''),
 COALESCE(subject_id,'00000000-0000-0000-0000-000000000000'::uuid),revision);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_review_key_v1
 ON public.canonical_forecast_capacity_advisory_reviews_v1(organization_id,actor_id,idempotency_key_hash);

CREATE TABLE public.canonical_forecast_capacity_advisory_epochs_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 revision BIGINT NOT NULL CHECK(revision>=1),
 previous_id UUID,
 upstream_workload_epoch_id UUID NOT NULL,
 upstream_constraint_epoch_id UUID NOT NULL,
 review_manifest JSONB NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m26-capacity-advisory-epoch-v1'),
 actor_id UUID NOT NULL REFERENCES public.users(id),membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 installed_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_capacity_advisory_epochs_v1(organization_id,id)
);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_epoch_revision_v1
 ON public.canonical_forecast_capacity_advisory_epochs_v1(organization_id,revision);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_epoch_key_v1
 ON public.canonical_forecast_capacity_advisory_epochs_v1(organization_id,actor_id,idempotency_key_hash);

CREATE TABLE public.canonical_forecast_capacity_advisory_origins_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),id UUID NOT NULL DEFAULT gen_random_uuid(),
 epoch_id UUID NOT NULL,prediction_cutoff_at TIMESTAMPTZ NOT NULL,horizon_ends_at TIMESTAMPTZ NOT NULL,
 generation BIGINT NOT NULL CHECK(generation>=1),previous_id UUID,
 input_manifest JSONB NOT NULL,private_results JSONB NOT NULL,scope_count INTEGER NOT NULL CHECK(scope_count BETWEEN 1 AND 20),
 actor_id UUID NOT NULL REFERENCES public.users(id),membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),captured_at TIMESTAMPTZ NOT NULL,
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,epoch_id) REFERENCES public.canonical_forecast_capacity_advisory_epochs_v1(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_capacity_advisory_origins_v1(organization_id,id),
 CHECK(horizon_ends_at=prediction_cutoff_at+INTERVAL '2592000 seconds')
);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_origin_key_v1
 ON public.canonical_forecast_capacity_advisory_origins_v1(organization_id,actor_id,idempotency_key_hash);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_origin_generation_v1
 ON public.canonical_forecast_capacity_advisory_origins_v1(
 organization_id,epoch_id,prediction_cutoff_at,horizon_ends_at,generation);

CREATE TABLE public.canonical_forecast_capacity_advisory_decisions_v1 (
 organization_id UUID NOT NULL,id UUID NOT NULL DEFAULT gen_random_uuid(),origin_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision>=1),previous_id UUID,action TEXT NOT NULL CHECK(action IN('approve','reject','withdraw')),
 expected_origin_digest TEXT NOT NULL CHECK(expected_origin_digest~'^[0-9a-f]{64}$'),reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m26-capacity-advisory-decision-v1'),
 actor_id UUID NOT NULL REFERENCES public.users(id),membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 decided_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_capacity_advisory_origins_v1(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_capacity_advisory_decisions_v1(organization_id,id)
);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_decision_revision_v1
 ON public.canonical_forecast_capacity_advisory_decisions_v1(organization_id,origin_id,revision);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_decision_key_v1
 ON public.canonical_forecast_capacity_advisory_decisions_v1(organization_id,actor_id,idempotency_key_hash);

CREATE TABLE public.canonical_forecast_capacity_advisory_outcomes_v1 (
 organization_id UUID NOT NULL,id UUID NOT NULL DEFAULT gen_random_uuid(),origin_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision>=1),previous_id UUID,source_manifest JSONB NOT NULL,private_results JSONB NOT NULL,
 actor_id UUID NOT NULL REFERENCES public.users(id),membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_capacity_advisory_origins_v1(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_capacity_advisory_outcomes_v1(organization_id,id)
);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_outcome_revision_v1
 ON public.canonical_forecast_capacity_advisory_outcomes_v1(organization_id,origin_id,revision);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_outcome_key_v1
 ON public.canonical_forecast_capacity_advisory_outcomes_v1(organization_id,actor_id,idempotency_key_hash);

CREATE TABLE public.canonical_forecast_capacity_advisory_evaluations_v1 (
 organization_id UUID NOT NULL,id UUID NOT NULL DEFAULT gen_random_uuid(),origin_id UUID NOT NULL,outcome_id UUID NOT NULL,
 decision_id UUID NOT NULL,revision BIGINT NOT NULL CHECK(revision>=1),previous_id UUID,private_metrics JSONB NOT NULL,
 actor_id UUID NOT NULL REFERENCES public.users(id),membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 evaluated_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_capacity_advisory_origins_v1(organization_id,id),
 FOREIGN KEY(organization_id,outcome_id) REFERENCES public.canonical_forecast_capacity_advisory_outcomes_v1(organization_id,id),
 FOREIGN KEY(organization_id,decision_id) REFERENCES public.canonical_forecast_capacity_advisory_decisions_v1(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_capacity_advisory_evaluations_v1(organization_id,id)
);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_evaluation_revision_v1
 ON public.canonical_forecast_capacity_advisory_evaluations_v1(organization_id,origin_id,revision);
CREATE UNIQUE INDEX canonical_forecast_capacity_advisory_evaluation_key_v1
 ON public.canonical_forecast_capacity_advisory_evaluations_v1(organization_id,actor_id,idempotency_key_hash);

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Capacity advisory evidence is immutable' USING ERRCODE='42501';END $$;
DO $$ DECLARE n TEXT;BEGIN FOREACH n IN ARRAY ARRAY[
 'canonical_forecast_capacity_advisory_methods_v1','canonical_forecast_capacity_advisory_reviews_v1',
 'canonical_forecast_capacity_advisory_epochs_v1','canonical_forecast_capacity_advisory_origins_v1',
 'canonical_forecast_capacity_advisory_decisions_v1','canonical_forecast_capacity_advisory_outcomes_v1',
 'canonical_forecast_capacity_advisory_evaluations_v1'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable()',n||'_immutable',n);
END LOOP;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_lock_sources(org UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-source:'||org,0));
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 PERFORM 1 FROM public.canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=org FOR SHARE;
 PERFORM 1 FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org FOR SHARE;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_policy_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE keys TEXT[]:=ARRAY['methodVersion','alternativeKey','scopeKey','role','backlogThresholdMinutes',
 'bottleneckGapThresholdMinutes','overtimeReviewEnabled','overtimeGapThresholdMinutes',
 'contractorReviewEnabled','contractorGapThresholdMinutes','hiringReviewEnabled','hiringGapThresholdMinutes','hiringConsecutivePeriods'];
BEGIN
 RETURN public.canonical_field_evidence_object_keys_exact(value,keys)
  AND value->>'methodVersion'='m26-capacity-advisory-five-category-v1'
  AND value->>'alternativeKey'~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  AND value->>'scopeKey'~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  AND value->>'role'~'^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$'
  AND value->>'backlogThresholdMinutes'~'^(0|[1-9][0-9]{0,8})$'
  AND value->>'bottleneckGapThresholdMinutes'~'^(0|[1-9][0-9]{0,8})$'
  AND jsonb_typeof(value->'overtimeReviewEnabled')='boolean'
  AND value->>'overtimeGapThresholdMinutes'~'^(0|[1-9][0-9]{0,8})$'
  AND jsonb_typeof(value->'contractorReviewEnabled')='boolean'
  AND value->>'contractorGapThresholdMinutes'~'^(0|[1-9][0-9]{0,8})$'
  AND jsonb_typeof(value->'hiringReviewEnabled')='boolean'
  AND value->>'hiringGapThresholdMinutes'~'^(0|[1-9][0-9]{0,8})$'
  AND value->>'hiringConsecutivePeriods'~'^([2-9]|1[0-2])$';
EXCEPTION WHEN OTHERS THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_valid(value JSONB,kind_value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB;role_item JSONB;total_count INTEGER:=0;scope_count INTEGER:=0;
BEGIN
 IF kind_value NOT IN('demand','outcome_demand')
  OR NOT public.canonical_field_evidence_object_keys_exact(value,
   CASE WHEN kind_value='demand' THEN ARRAY['methodVersion','alternativeKey','scopeApplicability','allocations']
    ELSE ARRAY['methodVersion','alternativeKey','originId','scopeApplicability','allocations'] END)
  OR value->>'methodVersion'<>(CASE WHEN kind_value='demand' THEN 'm26-capacity-advisory-demand-allocation-v1'
    ELSE 'm26-capacity-advisory-outcome-allocation-v1' END)
  OR value->>'alternativeKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  OR (kind_value='outcome_demand' AND value->>'originId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  OR jsonb_typeof(value->'scopeApplicability')<>'array'
  OR jsonb_array_length(value->'scopeApplicability') NOT BETWEEN 1 AND 20
  OR jsonb_typeof(value->'allocations')<>'array' OR jsonb_array_length(value->'allocations')>1000 THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements(value->'scopeApplicability') entries(entry) LOOP
  IF NOT public.canonical_field_evidence_object_keys_exact(item,
      ARRAY['scopeKey','targetRole','targetSeats','supportRoles','operatorRoles'])
   OR item->>'scopeKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   OR item->>'targetRole'!~'^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$'
   OR item->>'targetSeats'!~'^[1-9][0-9]?$'
   OR jsonb_typeof(item->'supportRoles')<>'array' OR jsonb_array_length(item->'supportRoles')>20
   OR jsonb_typeof(item->'operatorRoles')<>'array' OR jsonb_array_length(item->'operatorRoles')>20 THEN RETURN FALSE;END IF;
  FOR role_item IN SELECT entry FROM jsonb_array_elements(item->'supportRoles') entries(entry) LOOP
   IF NOT public.canonical_field_evidence_object_keys_exact(role_item,ARRAY['role','count'])
    OR role_item->>'role'!~'^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$'
    OR role_item->>'count'!~'^[1-9][0-9]?$' OR role_item->>'role'=item->>'targetRole' THEN RETURN FALSE;END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'supportRoles') entries(role_entry)
      GROUP BY role_entry->>'role' HAVING count(*)>1)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'operatorRoles') entries(operator_entry)
      WHERE operator_entry#>>'{}'!~'^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$'
      GROUP BY operator_entry#>>'{}' HAVING count(*)>1) THEN RETURN FALSE;END IF;
  scope_count:=scope_count+1;
 END LOOP;
 FOR item IN SELECT entry FROM jsonb_array_elements(value->'allocations') entries(entry) LOOP
  IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['appointmentId','assignmentId','scopeKey','role','personMinutes'])
   OR item->>'appointmentId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR item->>'assignmentId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR item->>'scopeKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   OR item->>'role'!~'^(owner|administrator|dispatcher|estimator|crew_lead|technician|accounting|employee|other)$'
   OR item->>'personMinutes'!~'^(0|[1-9][0-9]{0,8})$' THEN RETURN FALSE;END IF;
  total_count:=total_count+1;
 END LOOP;
 RETURN total_count=jsonb_array_length(value->'allocations') AND scope_count=jsonb_array_length(value->'scopeApplicability')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'scopeApplicability') entries(entry)
   GROUP BY entry->>'scopeKey' HAVING count(*)>1)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'allocations') entries(entry)
   GROUP BY entry->>'appointmentId',entry->>'assignmentId',entry->>'scopeKey',entry->>'role' HAVING count(*)>1);
EXCEPTION WHEN OTHERS THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_current_internal(
 org UUID,kind_value TEXT,alternative_value TEXT,scope_value TEXT,role_value TEXT,subject_value UUID DEFAULT NULL)
RETURNS public.canonical_forecast_capacity_advisory_reviews_v1 LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
 WHERE value.organization_id=org AND value.review_kind=kind_value
  AND value.alternative_key IS NOT DISTINCT FROM alternative_value
  AND value.scope_key IS NOT DISTINCT FROM scope_value AND value.role_name IS NOT DISTINCT FROM role_value
  AND value.subject_id IS NOT DISTINCT FROM subject_value
 ORDER BY value.revision DESC LIMIT 1
$$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_basis(
 org UUID,kind_value TEXT,alternative_value TEXT,definition_value JSONB,backlog_rows JSONB,constraint_input JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE allocation JSONB;backlog_row JSONB;applicability_item JSONB;expected_applicability JSONB;
 scope_item JSONB;scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 sum_minutes NUMERIC;job_count INTEGER;allocation_count INTEGER;scope_count INTEGER:=0;
BEGIN
 IF public.canonical_forecast_capacity_advisory_v1_demand_valid(definition_value,kind_value) IS NOT TRUE
  OR definition_value->>'alternativeKey' IS DISTINCT FROM alternative_value THEN
  RAISE EXCEPTION 'Capacity advisory demand identity unavailable' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(backlog_rows)<>'array' OR jsonb_typeof(constraint_input)<>'object' THEN
  RAISE EXCEPTION 'Capacity advisory demand source unavailable' USING ERRCODE='22023';END IF;
 IF NOT (constraint_input->'alternatives' ? alternative_value) THEN
  RAISE EXCEPTION 'Capacity advisory alternative unavailable' USING ERRCODE='22023';END IF;
 FOR backlog_row IN SELECT entry FROM jsonb_array_elements(backlog_rows) entries(entry) LOOP
  SELECT COALESCE(sum((entry->>'personMinutes')::numeric),0),count(*) INTO sum_minutes,allocation_count
  FROM jsonb_array_elements(definition_value->'allocations') entries(entry)
  WHERE entry->>'appointmentId'=backlog_row->>'appointmentId'
   AND entry->>'assignmentId'=backlog_row->>'assignmentId';
  -- Completed owning work remains in the accepted Part 5A receipt with an
  -- authenticated zero.  It need not remain in the future Part 5B job census,
  -- so zero rows may be explicitly unallocated.  Every positive row must still
  -- be completely allocated, and any supplied zero allocations are checked by
  -- the same exact source binding below.
  IF ((backlog_row->>'personMinutes')::numeric>0 AND allocation_count=0)
   OR sum_minutes<>(backlog_row->>'personMinutes')::numeric THEN
   RAISE EXCEPTION 'Capacity advisory demand allocation incomplete' USING ERRCODE='22023';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'allocations') allocation_value
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(backlog_rows) backlog_item
     WHERE backlog_item->>'appointmentId'=allocation_value->>'appointmentId'
      AND backlog_item->>'assignmentId'=allocation_value->>'assignmentId')) THEN
  RAISE EXCEPTION 'Capacity advisory demand allocation includes unknown work' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(constraint_input->'jobs') job_value
   WHERE job_value->>'alternativeKey'=alternative_value
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(backlog_rows) backlog_item
      WHERE backlog_item->>'appointmentId'=job_value->>'appointmentId'
       AND backlog_item->>'assignmentId'=job_value->>'assignmentId')
     AND job_value->>'appointmentStatus' NOT IN('completed','cancelled')) THEN
  RAISE EXCEPTION 'Capacity advisory workload and constraint populations differ' USING ERRCODE='22023';END IF;
 FOR allocation IN SELECT entry FROM jsonb_array_elements(definition_value->'allocations') entries(entry) LOOP
  SELECT count(*) INTO job_count FROM jsonb_array_elements(constraint_input->'jobs') job
   WHERE job->>'alternativeKey'=alternative_value AND job->>'appointmentId'=allocation->>'appointmentId'
    AND job->>'assignmentId'=allocation->>'assignmentId' AND job->>'scopeKey'=allocation->>'scopeKey';
  SELECT value INTO scope_item FROM jsonb_array_elements(constraint_input->'scopes') value
   WHERE value->>'alternativeKey'=alternative_value AND value->>'scopeKey'=allocation->>'scopeKey';
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(scope_item->>'reviewId')::uuid;
  IF job_count<>1 OR scope_review.id IS NULL OR scope_review.definition->>'role' IS DISTINCT FROM allocation->>'role' THEN
   RAISE EXCEPTION 'Capacity advisory demand role mapping unavailable' USING ERRCODE='22023';END IF;
 END LOOP;
 FOR scope_item IN SELECT value FROM jsonb_array_elements(constraint_input->'scopes') value
   WHERE value->>'alternativeKey'=alternative_value ORDER BY value->>'scopeKey' LOOP
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(scope_item->>'reviewId')::uuid;
  IF scope_review.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory scope authority unavailable' USING ERRCODE='22023';END IF;
  expected_applicability:=jsonb_build_object('scopeKey',scope_review.scope_key,
   'targetRole',scope_review.definition->>'role',
   'targetSeats',CASE WHEN (scope_review.definition#>>'{applicability,crew}')::boolean THEN
     (SELECT (value->>'count')::int FROM jsonb_array_elements(scope_review.definition->'crewRoleRequirements') value
       WHERE value->>'role'=scope_review.definition->>'role') ELSE 1 END,
   'supportRoles',(SELECT COALESCE(jsonb_agg(jsonb_build_object('role',value->>'role','count',(value->>'count')::int)
      ORDER BY value->>'role'),'[]'::jsonb) FROM jsonb_array_elements(scope_review.definition->'crewRoleRequirements') value
      WHERE value->>'role'<>scope_review.definition->>'role'),
   'operatorRoles',(SELECT COALESCE(jsonb_agg(DISTINCT assigned->>'role' ORDER BY assigned->>'role'),'[]'::jsonb)
      FROM jsonb_array_elements(scope_review.definition->'crewAssignments') assigned
      WHERE assigned->>'profileId' IN(SELECT operator_value#>>'{}'
        FROM jsonb_array_elements(scope_review.definition->'operatorProfileIds') operator_value)));
  SELECT value INTO applicability_item FROM jsonb_array_elements(definition_value->'scopeApplicability') value
   WHERE value->>'scopeKey'=scope_review.scope_key;
  IF applicability_item IS DISTINCT FROM expected_applicability THEN
   RAISE EXCEPTION 'Capacity advisory scope applicability differs' USING ERRCODE='22023';END IF;
  scope_count:=scope_count+1;
 END LOOP;
 IF scope_count<>jsonb_array_length(definition_value->'scopeApplicability') THEN
  RAISE EXCEPTION 'Capacity advisory scope applicability incomplete' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('kind',kind_value,'alternativeKey',alternative_value,
  'backlogRowsDigest',public.canonical_completion_digest(backlog_rows),
  'constraintInputDigest',public.canonical_completion_digest(constraint_input),
  'allocationDigest',public.canonical_completion_digest(definition_value));
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_source(
 org UUID,kind_value TEXT,alternative_value TEXT,subject_value UUID,definition_value JSONB,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE backlog_value JSONB;constraint_input JSONB;origin_value public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 outcome_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;basis JSONB;
BEGIN
 IF kind_value='demand' THEN
  IF subject_value IS NOT NULL THEN RAISE EXCEPTION 'Capacity advisory demand subject unavailable' USING ERRCODE='22023';END IF;
  backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,cutoff_value);
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,cutoff_value);
  basis:=public.canonical_forecast_capacity_advisory_v1_demand_basis(
   org,kind_value,alternative_value,definition_value,backlog_value->'rows',constraint_input);
  RETURN basis||jsonb_build_object('sourceCutoff',public.canonical_forecast_utc_instant(cutoff_value));
 END IF;
 IF kind_value<>'outcome_demand' OR subject_value IS NULL OR (definition_value->>'originId')::uuid<>subject_value THEN
  RAISE EXCEPTION 'Capacity advisory outcome demand subject unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO origin_value FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=subject_value;
 IF origin_value.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory origin unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(origin_value.input_manifest#>>'{workloadOrigin,id}')::uuid;
 SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND origin_id=workload_origin.id ORDER BY revision DESC LIMIT 1;
 IF workload_evaluation.id IS NULL OR
   public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,workload_evaluation) IS NOT TRUE THEN
  RAISE EXCEPTION 'Accepted workload outcome unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO outcome_window FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND id=workload_evaluation.outcome_window_id;
 constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
  org,origin_value.horizon_ends_at,origin_value.prediction_cutoff_at);
 basis:=public.canonical_forecast_capacity_advisory_v1_demand_basis(
  org,kind_value,alternative_value,definition_value,outcome_window.evidence#>'{backlog,rows}',constraint_input);
 RETURN basis||jsonb_build_object('originId',origin_value.id,'workloadEvaluationId',workload_evaluation.id,
  'workloadEvaluationDigest',rtrim(workload_evaluation.digest),'workloadOutcomeWindowId',outcome_window.id,
  'workloadOutcomeWindowDigest',rtrim(outcome_window.digest),'periodStart',origin_value.prediction_cutoff_at,
  'periodEnd',origin_value.horizon_ends_at);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_source(
 org UUID,kind_value TEXT,alternative_value TEXT,scope_value TEXT,role_value TEXT,subject_value UUID,definition_value JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE method_value public.canonical_forecast_capacity_advisory_methods_v1%ROWTYPE;
 scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 workload_method public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 constraint_method public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 cutoff_value TIMESTAMPTZ;
BEGIN
 SELECT * INTO method_value FROM public.canonical_forecast_capacity_advisory_methods_v1;
 IF kind_value='method' THEN RETURN jsonb_build_object('methodKey',method_value.method_key,'version',method_value.version,
  'calculationVersion',method_value.calculation_version,'definitionDigest',method_value.definition_digest);END IF;
 IF kind_value IN('demand','outcome_demand') THEN
  IF public.canonical_forecast_capacity_advisory_v1_demand_valid(definition_value,kind_value) IS NOT TRUE
   OR definition_value->>'alternativeKey' IS DISTINCT FROM alternative_value OR scope_value IS NOT NULL OR role_value IS NOT NULL
   OR (kind_value='demand' AND subject_value IS NOT NULL)
   OR (kind_value='outcome_demand' AND (subject_value IS NULL OR (definition_value->>'originId')::uuid<>subject_value)) THEN
   RAISE EXCEPTION 'Capacity advisory demand identity unavailable' USING ERRCODE='22023';END IF;
  cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
  RETURN public.canonical_forecast_capacity_advisory_v1_demand_source(
   org,kind_value,alternative_value,subject_value,definition_value,cutoff_value);
 END IF;
 IF kind_value<>'policy' OR public.canonical_forecast_capacity_advisory_v1_policy_valid(definition_value) IS NOT TRUE
  OR definition_value->>'alternativeKey' IS DISTINCT FROM alternative_value
  OR definition_value->>'scopeKey' IS DISTINCT FROM scope_value OR definition_value->>'role' IS DISTINCT FROM role_value THEN
  RAISE EXCEPTION 'Capacity advisory policy identity unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'scope',scope_value,NULL);
 IF scope_review.id IS NULL OR scope_review.action<>'approve'
  OR scope_review.definition->>'alternativeKey' IS DISTINCT FROM alternative_value
  OR scope_review.definition->>'role' IS DISTINCT FROM role_value
  OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,scope_review) IS NOT TRUE THEN
  RAISE EXCEPTION 'Current constrained scope unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO workload_method FROM public.canonical_forecast_workload_capacity_reviews_v1
  WHERE organization_id=org AND review_kind='method' AND target_key='workload.end_backlog_hours.v1' ORDER BY revision DESC LIMIT 1;
 IF workload_method.id IS NULL OR workload_method.action<>'approve' OR workload_method.source_digest<>
  public.canonical_completion_digest(public.canonical_forecast_workload_capacity_v1_review_source(
   org,'method','workload.end_backlog_hours.v1',NULL,NULL)) THEN
  RAISE EXCEPTION 'Current workload method unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO constraint_method FROM public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'method',NULL,NULL);
 IF constraint_method.id IS NULL OR constraint_method.action<>'approve'
  OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,constraint_method) IS NOT TRUE THEN
  RAISE EXCEPTION 'Current constraint method unavailable' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('methodDefinitionDigest',method_value.definition_digest,
  'workloadMethodId',workload_method.id,'workloadMethodDigest',rtrim(workload_method.digest),
  'constraintMethodId',constraint_method.id,'constraintMethodDigest',rtrim(constraint_method.digest),
  'scopeReviewId',scope_review.id,'scopeReviewRevision',scope_review.revision,'scopeReviewDigest',rtrim(scope_review.digest),
  'alternativeKey',alternative_value,'scopeKey',scope_value,'role',role_value);
END $$;

-- Demand allocations are period evidence. A later review for a later cutoff is
-- ordinary progress and must not rewrite an older origin. The saved review is
-- historical-current only while its exact cutoff source still recomputes to
-- the pinned digest and no later review replaced that same cutoff authority.
CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_review_historical_current(
 org UUID,value public.canonical_forecast_capacity_advisory_reviews_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF value.review_kind<>'demand' OR value.action<>'approve'
  OR public.canonical_forecast_capacity_advisory_v1_demand_valid(value.definition,'demand') IS NOT TRUE
  OR value.alternative_key IS DISTINCT FROM value.definition->>'alternativeKey' THEN RETURN FALSE;END IF;
 -- The source object is the immutable period allocation receipt. Its owning
 -- 5A and 5B evidence is revalidated by demand_manifest_pinned below; calling
 -- the current-stock readers again here would let ordinary post-cutoff work
 -- completion rewrite an older period. A same-cutoff rereview is still a
 -- correction and permanently retires the older generation.
 RETURN public.canonical_field_evidence_object_keys_exact(value.source_identity,
    ARRAY['kind','alternativeKey','backlogRowsDigest','constraintInputDigest','allocationDigest','sourceCutoff'])
   AND value.source_identity->>'kind'='demand'
   AND value.source_identity->>'alternativeKey'=value.alternative_key
   AND (value.source_identity->>'sourceCutoff')::timestamptz IS NOT NULL
   AND value.source_digest=public.canonical_completion_digest(value.source_identity)
   AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_reviews_v1 newer
    WHERE newer.organization_id=org AND newer.review_kind='demand'
     AND newer.alternative_key=value.alternative_key AND newer.revision>value.revision
    AND newer.source_identity->>'sourceCutoff'=value.source_identity->>'sourceCutoff');
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_manifest_pinned(
 org UUID,saved_manifest JSONB,backlog_rows JSONB,constraint_input JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE alternative_value TEXT;saved_item JSONB;review_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 basis JSONB;result_value JSONB:='[]'::jsonb;alternative_count INTEGER:=0;
BEGIN
 IF jsonb_typeof(saved_manifest)<>'array' OR jsonb_typeof(backlog_rows)<>'array'
  OR jsonb_typeof(constraint_input)<>'object' THEN
  RAISE EXCEPTION 'Pinned capacity advisory demand population unavailable' USING ERRCODE='22023';END IF;
 FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
  SELECT entry INTO saved_item FROM jsonb_array_elements(saved_manifest) entries(entry)
   WHERE entry->>'alternativeKey'=alternative_value;
  IF saved_item IS NULL OR NOT public.canonical_field_evidence_object_keys_exact(
    saved_item,ARRAY['alternativeKey','reviewId','revision','digest','definition','basisDigest']) THEN
   RAISE EXCEPTION 'Pinned capacity advisory demand allocation unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO review_value FROM public.canonical_forecast_capacity_advisory_reviews_v1
   WHERE organization_id=org AND id=(saved_item->>'reviewId')::uuid;
  IF review_value.id IS NULL OR review_value.review_kind<>'demand'
   OR review_value.alternative_key IS DISTINCT FROM alternative_value
   OR review_value.revision<>(saved_item->>'revision')::bigint
   OR rtrim(review_value.digest) IS DISTINCT FROM saved_item->>'digest'
   OR review_value.definition IS DISTINCT FROM saved_item->'definition'
   OR public.canonical_forecast_capacity_advisory_v1_demand_review_historical_current(org,review_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Pinned capacity advisory demand allocation stale' USING ERRCODE='22023';END IF;
   basis:=public.canonical_forecast_capacity_advisory_v1_demand_basis(
    org,'demand',alternative_value,review_value.definition,backlog_rows,constraint_input);
   IF public.canonical_completion_digest(basis) IS DISTINCT FROM saved_item->>'basisDigest'
    OR (review_value.source_identity-'sourceCutoff') IS DISTINCT FROM basis THEN
    RAISE EXCEPTION 'Pinned capacity advisory demand source changed' USING ERRCODE='22023';END IF;
  result_value:=result_value||jsonb_build_array(saved_item);alternative_count:=alternative_count+1;
 END LOOP;
 IF alternative_count<>jsonb_array_length(saved_manifest) THEN
  RAISE EXCEPTION 'Pinned capacity advisory demand population differs' USING ERRCODE='22023';END IF;
 RETURN result_value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(
 org UUID,value public.canonical_forecast_workload_capacity_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB;review_value public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 pinned_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 latest_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 input_value JSONB;current_epoch_id UUID;
BEGIN
 SELECT id INTO current_epoch_id FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF current_epoch_id IS NULL OR value.epoch_id<>current_epoch_id THEN RETURN FALSE;END IF;
 FOR item IN SELECT jsonb_array_elements(value.method_review_ids) LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'id')::uuid;
  IF review_value.id IS NULL OR review_value.action<>'approve' OR rtrim(review_value.digest)<>item->>'digest'
   OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 newer
    WHERE newer.organization_id=org AND newer.review_kind='method'
     AND newer.target_key=review_value.target_key AND newer.revision>review_value.revision) THEN RETURN FALSE;END IF;
 END LOOP;
 FOR item IN SELECT jsonb_array_elements(value.training_window_ids) LOOP
  SELECT * INTO pinned_window FROM public.canonical_forecast_workload_capacity_windows_v1
   WHERE organization_id=org AND id=(item->>'id')::uuid;
  SELECT * INTO latest_window FROM public.canonical_forecast_workload_capacity_windows_v1
   WHERE organization_id=org AND window_start=pinned_window.window_start AND window_end=pinned_window.window_end
   ORDER BY revision DESC LIMIT 1;
  IF pinned_window.id IS NULL OR rtrim(pinned_window.digest)<>item->>'digest'
   OR latest_window.id IS NULL OR pinned_window.capacity_role IS DISTINCT FROM latest_window.capacity_role
   OR pinned_window.evidence IS DISTINCT FROM latest_window.evidence
   OR public.canonical_forecast_workload_capacity_v1_window_current(org,latest_window) IS NOT TRUE THEN RETURN FALSE;END IF;
 END LOOP;
 input_value:=public.canonical_forecast_workload_capacity_v1_origin_input(
  org,value.prediction_cutoff_at,value.horizon_ends_at);
 IF input_value#>>'{capacity,declaredRole}'<>value.capacity_role
  OR input_value#>>'{capacity,roleScopeReviewId}' IS NULL
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 scope_value
   WHERE scope_value.organization_id=org AND scope_value.review_kind='capacity_role_scope'
    AND scope_value.target_key='capacity.available_role_hours.v1'
    AND scope_value.id<>(input_value#>>'{capacity,roleScopeReviewId}')::uuid
    AND scope_value.revision>(input_value#>>'{capacity,roleScopeRevision}')::integer) THEN RETURN FALSE;END IF;
 FOR item IN SELECT jsonb_array_elements(input_value#>'{capacity,rows}') LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'roleReviewId')::uuid;
  IF review_value.id IS NULL OR review_value.action<>'approve' OR rtrim(review_value.digest)<>item->>'roleReviewDigest'
   OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 newer
    WHERE newer.organization_id=org AND newer.review_kind='role_qualification'
     AND newer.subject_id=review_value.subject_id AND newer.operational_role=review_value.operational_role
     AND newer.revision>review_value.revision AND newer.decided_at<=value.prediction_cutoff_at) THEN RETURN FALSE;END IF;
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'availabilityReviewId')::uuid;
  IF review_value.id IS NULL OR review_value.action<>'approve' OR rtrim(review_value.digest)<>item->>'availabilityReviewDigest'
   OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 newer
    WHERE newer.organization_id=org AND newer.review_kind='availability_basis'
     AND newer.subject_id=review_value.subject_id AND newer.revision>review_value.revision
     AND newer.decided_at<=value.prediction_cutoff_at) THEN RETURN FALSE;END IF;
 END LOOP;
 RETURN input_value->>'digest'=value.input_evidence->>'digest';
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

-- Revalidate a pinned Part 5B input as an immutable prediction-time receipt.
-- Ordinary post-cutoff completion and cancellation may change the current work
-- census, so they must not replace the saved population. Exact scope/job/method
-- reviews, their owning sources and every prospective review interval remain
-- current through the accepted Part 5B currentness rules.
CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_constraint_manifest_current(
 org UUID,input_value JSONB,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB;review_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 covering_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
BEGIN
 IF jsonb_typeof(input_value)<>'object' OR jsonb_typeof(input_value->'scopes')<>'array'
  OR jsonb_typeof(input_value->'jobs')<>'array' OR jsonb_typeof(input_value->'method')<>'object'
  OR public.canonical_forecast_constrained_capacity_v1_scope_population_valid(
    org,input_value->'scopes',start_value,end_value) IS NOT TRUE THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements((input_value->'scopes')||(input_value->'jobs')) entries(entry) LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'reviewId')::uuid;
  IF review_value.id IS NULL OR rtrim(review_value.digest) IS DISTINCT FROM item->>'digest'
   OR review_value.action<>'approve'
   OR EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
      WHERE newer.organization_id=org AND newer.review_kind=review_value.review_kind
       AND newer.scope_key IS NOT DISTINCT FROM review_value.scope_key
       AND newer.subject_id IS NOT DISTINCT FROM review_value.subject_id
       AND newer.revision>review_value.revision AND newer.decided_at<=start_value) THEN RETURN FALSE;END IF;
  IF review_value.review_kind='job' THEN
   SELECT newer.* INTO covering_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
    WHERE newer.organization_id=org AND newer.review_kind='job'
     AND newer.scope_key IS NOT DISTINCT FROM review_value.scope_key
     AND newer.subject_id IS NOT DISTINCT FROM review_value.subject_id
     AND newer.action='approve' AND newer.decided_at<end_value
    ORDER BY newer.decided_at DESC,newer.revision DESC LIMIT 1;
   IF covering_review.id IS NULL OR public.canonical_forecast_constrained_capacity_v1_job_review_covers(
     org,covering_review,end_value) IS NOT TRUE THEN RETURN FALSE;END IF;
  END IF;
 END LOOP;
 SELECT * INTO review_value FROM public.canonical_forecast_constrained_capacity_reviews_v1
  WHERE organization_id=org AND id=(input_value#>>'{method,reviewId}')::uuid;
 RETURN review_value.id IS NOT NULL AND review_value.action='approve'
  AND rtrim(review_value.digest) IS NOT DISTINCT FROM input_value#>>'{method,digest}'
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
     WHERE newer.organization_id=org AND newer.review_kind='method'
      AND newer.revision>review_value.revision AND newer.decided_at<end_value);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

-- A later accepted Part 5A origin may append an identical revision of an older
-- outcome window because that period becomes one of its training windows.
-- Preserve the pinned evaluation only when the latest current window carries
-- byte-identical evidence. Corrections and explicit reevaluations still retire
-- it and require an append-only Part 5C recovery.
CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(
 org UUID,value public.canonical_forecast_workload_capacity_evaluations_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pinned_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 latest_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 origin_value public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
BEGIN
 SELECT * INTO pinned_window FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND id=value.outcome_window_id;
 SELECT * INTO origin_value FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=value.origin_id;
 SELECT * INTO latest_window FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND window_start=pinned_window.window_start AND window_end=pinned_window.window_end
  ORDER BY revision DESC LIMIT 1;
 RETURN pinned_window.id IS NOT NULL AND origin_value.id IS NOT NULL AND latest_window.id IS NOT NULL
  AND rtrim(pinned_window.digest)=value.outcome_digest
  AND value.capacity_role=origin_value.capacity_role AND pinned_window.capacity_role=origin_value.capacity_role
  AND latest_window.capacity_role=origin_value.capacity_role
  AND pinned_window.evidence IS NOT DISTINCT FROM latest_window.evidence
  AND public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(org,origin_value)
  AND public.canonical_forecast_workload_capacity_v1_window_current(org,latest_window)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_evaluations_v1 newer
   WHERE newer.organization_id=org AND newer.origin_id=value.origin_id AND newer.revision>value.revision);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_is_current(
 org UUID,value public.canonical_forecast_capacity_advisory_reviews_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;source_value JSONB;
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
  current_scope:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
   org,'scope',value.scope_key,NULL);
  SELECT * INTO workload_method FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(value.source_identity->>'workloadMethodId')::uuid;
  SELECT * INTO constraint_method FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(value.source_identity->>'constraintMethodId')::uuid;
  RETURN public.canonical_forecast_capacity_advisory_v1_policy_valid(value.definition)
   AND value.source_digest=public.canonical_completion_digest(value.source_identity)
   AND scope_review.id IS NOT NULL AND rtrim(scope_review.digest)=value.source_identity->>'scopeReviewDigest'
   AND scope_review.action='approve'
   AND current_scope.id IS NOT NULL AND current_scope.action='approve'
   AND current_scope.definition->>'alternativeKey' IS NOT DISTINCT FROM value.alternative_key
   AND current_scope.definition->>'role' IS NOT DISTINCT FROM value.role_name
   AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,current_scope)
   AND workload_method.id IS NOT NULL AND workload_method.action='approve'
   AND rtrim(workload_method.digest)=value.source_identity->>'workloadMethodDigest'
   AND workload_method.id=(SELECT current_method.id FROM public.canonical_forecast_workload_capacity_reviews_v1 current_method
     WHERE current_method.organization_id=org AND current_method.review_kind='method'
      AND current_method.target_key='workload.end_backlog_hours.v1' ORDER BY current_method.revision DESC LIMIT 1)
   AND workload_method.source_digest=public.canonical_completion_digest(
     public.canonical_forecast_workload_capacity_v1_review_source(
      org,'method','workload.end_backlog_hours.v1',NULL,NULL))
   AND constraint_method.id IS NOT NULL AND constraint_method.action='approve'
   AND rtrim(constraint_method.digest)=value.source_identity->>'constraintMethodDigest'
   AND constraint_method.id=(public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'method',NULL,NULL)).id
   AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,constraint_method);
  END IF;
  IF value.review_kind='demand' THEN
   RETURN public.canonical_forecast_capacity_advisory_v1_demand_review_historical_current(org,value);
  END IF;
  IF value.review_kind='outcome_demand' THEN
   SELECT * INTO outcome_origin FROM public.canonical_forecast_capacity_advisory_origins_v1
    WHERE organization_id=org AND id=value.subject_id;
   SELECT * INTO outcome_epoch FROM public.canonical_forecast_capacity_advisory_epochs_v1
    WHERE organization_id=org AND id=outcome_origin.epoch_id;
   IF outcome_origin.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,outcome_epoch) IS NOT TRUE
    OR EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_origins_v1 newer
      WHERE newer.organization_id=org AND newer.epoch_id=outcome_origin.epoch_id
       AND newer.prediction_cutoff_at=outcome_origin.prediction_cutoff_at
       AND newer.horizon_ends_at=outcome_origin.horizon_ends_at
       AND newer.generation>outcome_origin.generation) THEN RETURN FALSE;END IF;
  END IF;
  source_value:=CASE WHEN value.review_kind='demand' THEN
  public.canonical_forecast_capacity_advisory_v1_demand_source(org,value.review_kind,value.alternative_key,NULL,value.definition,
   (value.source_identity->>'sourceCutoff')::timestamptz)
  WHEN value.review_kind='outcome_demand' THEN
  public.canonical_forecast_capacity_advisory_v1_demand_source(org,value.review_kind,value.alternative_key,
   value.subject_id,value.definition,(value.source_identity->>'periodEnd')::timestamptz)
 ELSE public.canonical_forecast_capacity_advisory_v1_review_source(
  org,value.review_kind,value.alternative_key,value.scope_key,value.role_name,value.subject_id,value.definition) END;
 RETURN value.source_digest=public.canonical_completion_digest(source_value);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_current(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,kind_value TEXT,alternative_value TEXT,scope_value TEXT,role_value TEXT,
 subject_value UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR kind_value NOT IN('method','policy','demand','outcome_demand')
  OR (kind_value='method' AND (alternative_value IS NOT NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL OR subject_value IS NOT NULL))
  OR (kind_value='policy' AND (alternative_value IS NULL OR scope_value IS NULL OR role_value IS NULL OR subject_value IS NOT NULL))
  OR (kind_value='demand' AND (alternative_value IS NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL OR subject_value IS NOT NULL))
  OR (kind_value='outcome_demand' AND (alternative_value IS NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL OR subject_value IS NULL)) THEN
  RAISE EXCEPTION 'Capacity advisory review lookup invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
  org,kind_value,alternative_value,scope_value,role_value,subject_value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','capacity_advisory_review_current','kind',kind_value,'alternativeKey',alternative_value,
  'scopeKey',scope_value,'role',role_value,'subjectId',subject_value,'reviewId',value.id,'action',value.action,
  'expectedRevision',COALESCE(value.revision,0),'expectedDigest',COALESCE(rtrim(value.digest),'none'),
  'sourceCurrent',COALESCE(public.canonical_forecast_capacity_advisory_v1_review_is_current(org,value),FALSE),
  'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,
  'automaticActionTaken',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,kind_value TEXT,
 alternative_value TEXT,scope_value TEXT,role_value TEXT,subject_value UUID,action_value TEXT,expected_revision BIGINT,
 expected_digest TEXT,definition_value JSONB,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 current_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;source_value JSONB;
 outcome_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;now_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR kind_value NOT IN('method','policy','demand','outcome_demand')
  OR action_value NOT IN('approve','reject','withdraw') OR expected_revision<0
  OR ((expected_revision=0) IS DISTINCT FROM (expected_digest='none'))
  OR (expected_revision>0 AND expected_digest!~'^[0-9a-f]{64}$') OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-capacity-advisory-review-v1'
  OR (kind_value='method' AND (alternative_value IS NOT NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL OR subject_value IS NOT NULL
     OR definition_value<>jsonb_build_object('methodVersion','m26-capacity-advisory-five-category-v1')))
  OR (kind_value='policy' AND (subject_value IS NOT NULL OR public.canonical_forecast_capacity_advisory_v1_policy_valid(definition_value) IS NOT TRUE))
  OR (kind_value='demand' AND (subject_value IS NOT NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL
    OR public.canonical_forecast_capacity_advisory_v1_demand_valid(definition_value,kind_value) IS NOT TRUE))
  OR (kind_value='outcome_demand' AND (subject_value IS NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL
    OR public.canonical_forecast_capacity_advisory_v1_demand_valid(definition_value,kind_value) IS NOT TRUE
    OR (definition_value->>'originId')::uuid<>subject_value)) THEN
  RAISE EXCEPTION 'Capacity advisory review request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 IF kind_value='outcome_demand' THEN
  SELECT * INTO outcome_origin FROM public.canonical_forecast_capacity_advisory_origins_v1
   WHERE organization_id=org AND id=subject_value;
  IF outcome_origin.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
  IF public.canonical_forecast_capacity_advisory_v1_origin_current(org,outcome_origin) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 END IF;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind',kind_value,'alternative',alternative_value,
  'scope',scope_value,'role',role_value,'subjectId',subject_value,'action',action_value,'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'definition',definition_value,'reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_reviews_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash OR (old.action='approve' AND
    public.canonical_forecast_capacity_advisory_v1_review_is_current(org,old) IS NOT TRUE) THEN
   RAISE EXCEPTION 'Capacity advisory review replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','capacity_advisory_review_recorded','id',old.id,'kind',old.review_kind,
   'alternativeKey',old.alternative_key,'scopeKey',old.scope_key,'role',old.role_name,'subjectId',old.subject_id,'action',old.action,
   'revision',old.revision,'digest',rtrim(old.digest),'replayed',TRUE);END IF;
 current_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
  org,kind_value,alternative_value,scope_value,role_value,subject_value);
 IF COALESCE(current_value.revision,0)<>expected_revision OR COALESCE(rtrim(current_value.digest),'none')<>expected_digest THEN
  RAISE EXCEPTION 'Capacity advisory review revision conflict' USING ERRCODE='40001';END IF;
 IF action_value='withdraw' THEN
  IF current_value.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory review unavailable' USING ERRCODE='22023';END IF;
  source_value:=current_value.source_identity;
 ELSE
  source_value:=public.canonical_forecast_capacity_advisory_v1_review_source(
   org,kind_value,alternative_value,scope_value,role_value,subject_value,definition_value);
 END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 INSERT INTO public.canonical_forecast_capacity_advisory_reviews_v1(
  organization_id,review_kind,alternative_key,scope_key,role_name,subject_id,revision,previous_id,action,definition,
  source_identity,source_digest,reason,confirmation_version,actor_id,membership_id,session_id,idempotency_key_hash,
  request_digest,decided_at,digest)
 VALUES(org,kind_value,alternative_value,scope_value,role_value,subject_value,expected_revision+1,current_value.id,action_value,definition_value,
  source_value,public.canonical_completion_digest(source_value),btrim(reason_value),confirmation_value,actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash,now_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'kind',kind_value,'alternative',alternative_value,
   'scope',scope_value,'role',role_value,'subjectId',subject_value,'revision',expected_revision+1,'action',action_value,'definition',definition_value,
   'source',source_value,'decidedAt',now_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','capacity_advisory_review_recorded','id',inserted.id,'kind',inserted.review_kind,
  'alternativeKey',inserted.alternative_key,'scopeKey',inserted.scope_key,'role',inserted.role_name,'subjectId',inserted.subject_id,'action',inserted.action,
  'revision',inserted.revision,'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

-- A complete policy manifest is selected from the current Part 5B scope population.
CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_policy_manifest(org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE input_value JSONB;scope_item JSONB;scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 policy_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 result_value JSONB:='[]'::jsonb;
BEGIN
 input_value:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,cutoff_value);
 FOR scope_item IN SELECT value FROM jsonb_array_elements(input_value->'scopes') value
  ORDER BY value->>'alternativeKey',value->>'scopeKey' LOOP
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(scope_item->>'reviewId')::uuid;
  IF scope_review.id IS NULL OR scope_review.definition->>'alternativeKey' IS DISTINCT FROM scope_item->>'alternativeKey' THEN
   RAISE EXCEPTION 'Current constrained scope authority unavailable' USING ERRCODE='22023';END IF;
  policy_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(org,'policy',
   scope_item->>'alternativeKey',scope_item->>'scopeKey',scope_review.definition->>'role');
  IF policy_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,policy_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Complete capacity advisory policy population unavailable' USING ERRCODE='22023';END IF;
  result_value:=result_value||jsonb_build_array(jsonb_build_object('alternativeKey',policy_value.alternative_key,
   'scopeKey',policy_value.scope_key,'role',policy_value.role_name,'reviewId',policy_value.id,
   'revision',policy_value.revision,'digest',rtrim(policy_value.digest),'definition',policy_value.definition));
 END LOOP;
 IF jsonb_array_length(result_value)=0 OR jsonb_array_length(result_value)>20 OR octet_length(result_value::text)>262144 THEN
  RAISE EXCEPTION 'Capacity advisory policy population exceeds bounds' USING ERRCODE='54000';END IF;
 RETURN result_value;
END $$;

-- One complete, current, human-reviewed demand allocation per alternative.  This
-- does not turn the current backlog into a forecast.  It only supplies the
-- explicit role/scope shares used to allocate the separately saved Part 5A
-- end-backlog forecast across compatible Part 5B scopes.
CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_manifest(
 org UUID,kind_value TEXT,subject_value UUID,backlog_rows JSONB,constraint_input JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE alternative_value TEXT;review_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 result_value JSONB:='[]'::jsonb;basis JSONB;
BEGIN
 IF kind_value NOT IN('demand','outcome_demand') OR jsonb_typeof(backlog_rows)<>'array' THEN
  RAISE EXCEPTION 'Capacity advisory demand population unavailable' USING ERRCODE='22023';END IF;
 FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
  review_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
   org,kind_value,alternative_value,NULL,NULL,subject_value);
  IF review_value.id IS NULL OR review_value.action<>'approve'
   OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,review_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Complete capacity advisory demand allocation unavailable' USING ERRCODE='22023';END IF;
  basis:=public.canonical_forecast_capacity_advisory_v1_demand_basis(
   org,kind_value,alternative_value,review_value.definition,backlog_rows,constraint_input);
  result_value:=result_value||jsonb_build_array(jsonb_build_object('alternativeKey',alternative_value,
   'reviewId',review_value.id,'revision',review_value.revision,'digest',rtrim(review_value.digest),
   'definition',review_value.definition,'basisDigest',public.canonical_completion_digest(basis)));
 END LOOP;
 IF jsonb_array_length(result_value)=0 OR jsonb_array_length(result_value)>20
  OR octet_length(result_value::text)>262144 THEN
  RAISE EXCEPTION 'Capacity advisory demand population exceeds bounds' USING ERRCODE='54000';END IF;
 RETURN result_value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_epoch_capture(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 current_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;inserted public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 workload_epoch public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 constraint_epoch public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 method_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;manifest JSONB;now_value TIMESTAMPTZ;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-capacity-advisory-epoch-v1' THEN
  RAISE EXCEPTION 'Capacity advisory epoch request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 SELECT * INTO workload_epoch FROM public.canonical_forecast_workload_capacity_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT * INTO constraint_epoch FROM public.canonical_forecast_constrained_capacity_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 method_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(org,'method',NULL,NULL,NULL);
 IF workload_epoch.id IS NULL OR constraint_epoch.id IS NULL OR method_review.id IS NULL
  OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,method_review) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory epoch prerequisites unavailable' USING ERRCODE='22023';END IF;
 manifest:=jsonb_build_object('method',jsonb_build_object('id',method_review.id,'digest',rtrim(method_review.digest)),
  'policies',public.canonical_forecast_capacity_advisory_v1_policy_manifest(org,now_value));
 request_hash:=public.canonical_completion_digest(jsonb_build_object('reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  SELECT * INTO current_value FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
  IF old.request_digest<>request_hash OR current_value.id IS DISTINCT FROM old.id
   OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory epoch replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','capacity_advisory_epoch_recorded','id',old.id,'revision',old.revision,
   'installedAt',old.installed_at,'digest',rtrim(old.digest),'replayed',TRUE);END IF;
 SELECT * INTO current_value FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.canonical_forecast_capacity_advisory_epochs_v1(
  organization_id,revision,previous_id,upstream_workload_epoch_id,upstream_constraint_epoch_id,review_manifest,reason,
  confirmation_version,actor_id,membership_id,session_id,idempotency_key_hash,request_digest,installed_at,digest)
 VALUES(org,COALESCE(current_value.revision,0)+1,current_value.id,workload_epoch.id,constraint_epoch.id,manifest,btrim(reason_value),
  confirmation_value,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,now_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'revision',COALESCE(current_value.revision,0)+1,
   'workloadEpoch',workload_epoch.id,'constraintEpoch',constraint_epoch.id,'reviews',manifest,'installedAt',now_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','capacity_advisory_epoch_recorded','id',inserted.id,'revision',inserted.revision,
  'installedAt',inserted.installed_at,'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

-- Builds one exact private result per server-selected alternative/scope.
CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_results(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,as_of_value TIMESTAMPTZ,
 constraint_input JSONB,policy_manifest JSONB,demand_manifest JSONB,workload_results JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE constraint_results JSONB;scope_result JSONB;policy_item JSONB;demand_item JSONB;allocation JSONB;
 forecast_minutes NUMERIC;allocation_total NUMERIC;scope_allocation NUMERIC;demand_minutes NUMERIC;
 constrained_minutes NUMERIC;gap_minutes NUMERIC;
 prior_count INTEGER;prior_cursor TIMESTAMPTZ;prior_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 prior_evaluation public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;prior_outcome public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;
 categories JSONB;result_value JSONB:='[]'::jsonb;required_periods INTEGER;latest_epoch_id UUID;
BEGIN
 SELECT id INTO latest_epoch_id FROM public.canonical_forecast_capacity_advisory_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 constraint_results:=public.canonical_forecast_constrained_capacity_v1_results(org,start_value,end_value,as_of_value,constraint_input);
 IF jsonb_array_length(constraint_results)>20
  OR workload_results->>'workload.end_backlog_hours.v1' !~ '^-?[0-9]+(?:\.[0-9]+)?$' THEN
  RAISE EXCEPTION 'Capacity advisory evidence exceeds bounds' USING ERRCODE='54000';END IF;
 forecast_minutes:=(workload_results->>'workload.end_backlog_hours.v1')::numeric*60;
 IF forecast_minutes<0 THEN RAISE EXCEPTION 'Capacity advisory upstream values invalid' USING ERRCODE='22023';END IF;
 FOR policy_item IN SELECT value FROM jsonb_array_elements(policy_manifest) value
  ORDER BY value->>'alternativeKey',value->>'scopeKey' LOOP
  SELECT value INTO scope_result FROM jsonb_array_elements(constraint_results) value
   WHERE value->>'alternativeKey'=policy_item->>'alternativeKey' AND value->>'scopeKey'=policy_item->>'scopeKey';
  IF scope_result IS NULL OR policy_item->>'role' IS DISTINCT FROM scope_result->>'role' THEN
   RAISE EXCEPTION 'Capacity advisory policy differs' USING ERRCODE='22023';END IF;
  SELECT value INTO demand_item FROM jsonb_array_elements(demand_manifest) value
   WHERE value->>'alternativeKey'=scope_result->>'alternativeKey';
  IF demand_item IS NULL THEN RAISE EXCEPTION 'Capacity advisory demand allocation unavailable' USING ERRCODE='22023';END IF;
  SELECT COALESCE(sum((value->>'personMinutes')::numeric),0),
   COALESCE(sum((value->>'personMinutes')::numeric) FILTER(WHERE value->>'scopeKey'=scope_result->>'scopeKey'
     AND value->>'role'=scope_result->>'role'),0)
  INTO allocation_total,scope_allocation FROM jsonb_array_elements(demand_item#>'{definition,allocations}') value;
  IF allocation_total=0 AND forecast_minutes>0 THEN
   RAISE EXCEPTION 'Positive workload forecast lacks role allocation basis' USING ERRCODE='22023';END IF;
  demand_minutes:=CASE WHEN allocation_total=0 THEN 0 ELSE round(forecast_minutes*scope_allocation/allocation_total,6) END;
  constrained_minutes:=(scope_result->>'personMinutes')::numeric;
  gap_minutes:=GREATEST(demand_minutes-constrained_minutes,0);
  -- The bounded owner policy is consecutive evaluated periods, never an
  -- empirical hiring threshold.  Walk exact adjacent periods backwards and
  -- stop at the first gap, stale evaluation, different scope/role, or
  -- ineligible result.
  required_periods:=(policy_item#>>'{definition,hiringConsecutivePeriods}')::int;
  prior_count:=0;prior_cursor:=start_value;
  WHILE prior_count<required_periods-1 LOOP
   SELECT origin_value.* INTO prior_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 origin_value
    WHERE origin_value.organization_id=org AND origin_value.horizon_ends_at=prior_cursor
    ORDER BY origin_value.prediction_cutoff_at DESC,origin_value.generation DESC,origin_value.id DESC LIMIT 1;
   EXIT WHEN prior_origin.id IS NULL OR prior_origin.epoch_id IS DISTINCT FROM latest_epoch_id;
   SELECT value.* INTO prior_evaluation FROM public.canonical_forecast_capacity_advisory_evaluations_v1 value
    WHERE value.organization_id=org AND value.origin_id=prior_origin.id ORDER BY value.revision DESC LIMIT 1;
   EXIT WHEN prior_evaluation.id IS NULL
    OR public.canonical_forecast_capacity_advisory_v1_evaluation_current(org,prior_evaluation) IS NOT TRUE
    OR EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_evaluations_v1 newer
    WHERE newer.organization_id=org AND newer.origin_id=prior_origin.id AND newer.revision>prior_evaluation.revision);
   SELECT value.* INTO prior_outcome FROM public.canonical_forecast_capacity_advisory_outcomes_v1 value
    WHERE value.organization_id=org AND value.id=prior_evaluation.outcome_id;
   EXIT WHEN prior_outcome.id IS NULL OR EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_outcomes_v1 newer
    WHERE newer.organization_id=org AND newer.origin_id=prior_origin.id AND newer.revision>prior_outcome.revision)
    OR NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_decisions_v1 decision_value
      WHERE decision_value.organization_id=org AND decision_value.id=prior_evaluation.decision_id
       AND decision_value.action='approve' AND decision_value.id=(SELECT current_decision.id
        FROM public.canonical_forecast_capacity_advisory_decisions_v1 current_decision
        WHERE current_decision.organization_id=org AND current_decision.origin_id=prior_origin.id
        ORDER BY current_decision.revision DESC LIMIT 1))
    OR NOT EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_evaluations_v1 upstream_value
      WHERE upstream_value.organization_id=org
       AND upstream_value.id=(prior_outcome.source_manifest->>'workloadEvaluationId')::uuid
       AND rtrim(upstream_value.digest)=prior_outcome.source_manifest->>'workloadEvaluationDigest'
       AND public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,upstream_value));
   EXIT WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prior_outcome.private_results) old_scope
    WHERE old_scope->>'alternativeKey'=scope_result->>'alternativeKey'
     AND old_scope->>'scopeKey'=scope_result->>'scopeKey' AND old_scope->>'role'=scope_result->>'role'
     AND old_scope->>'policyDigest'=policy_item->>'digest'
     AND COALESCE((old_scope#>>'{categories,hiring_need,gapEligible}')::boolean,FALSE));
   prior_count:=prior_count+1;prior_cursor:=prior_origin.prediction_cutoff_at;
  END LOOP;
  categories:=jsonb_build_object(
   'backlog',jsonb_build_object('state',CASE WHEN demand_minutes>0
      AND demand_minutes>=(policy_item#>>'{definition,backlogThresholdMinutes}')::numeric THEN 'attention' ELSE 'clear' END),
   'bottleneck',jsonb_build_object('state',CASE WHEN gap_minutes>=(policy_item#>>'{definition,bottleneckGapThresholdMinutes}')::numeric
      AND gap_minutes>0 THEN 'attention' ELSE 'clear' END),
   'overtime',jsonb_build_object('state',CASE WHEN (policy_item#>>'{definition,overtimeReviewEnabled}')::boolean
      AND gap_minutes>=(policy_item#>>'{definition,overtimeGapThresholdMinutes}')::numeric AND gap_minutes>0 THEN 'attention' ELSE 'clear' END),
   'contractor',jsonb_build_object('state',CASE WHEN (policy_item#>>'{definition,contractorReviewEnabled}')::boolean
      AND gap_minutes>=(policy_item#>>'{definition,contractorGapThresholdMinutes}')::numeric AND gap_minutes>0 THEN 'attention' ELSE 'clear' END),
   'hiring_need',jsonb_build_object('state',CASE WHEN NOT (policy_item#>>'{definition,hiringReviewEnabled}')::boolean THEN 'clear'
      WHEN gap_minutes<(policy_item#>>'{definition,hiringGapThresholdMinutes}')::numeric OR gap_minutes=0 THEN 'clear'
      WHEN prior_count+1>=(policy_item#>>'{definition,hiringConsecutivePeriods}')::int THEN 'attention' ELSE 'insufficient_history' END,
      'gapEligible',(policy_item#>>'{definition,hiringReviewEnabled}')::boolean
       AND gap_minutes>=(policy_item#>>'{definition,hiringGapThresholdMinutes}')::numeric AND gap_minutes>0));
  result_value:=result_value||jsonb_build_array(jsonb_build_object('alternativeKey',scope_result->>'alternativeKey',
   'scopeKey',scope_result->>'scopeKey','role',scope_result->>'role','demandMinutes',demand_minutes,
   'constrainedMinutes',constrained_minutes,'gapMinutes',gap_minutes,
   'policyReviewId',policy_item->>'reviewId','policyDigest',policy_item->>'digest',
   'demandReviewId',demand_item->>'reviewId','demandDigest',demand_item->>'digest',
   'categories',categories));
 END LOOP;
 IF jsonb_array_length(result_value)=0 OR octet_length(result_value::text)>524288 THEN
  RAISE EXCEPTION 'Capacity advisory result exceeds bounds' USING ERRCODE='54000';END IF;
 RETURN result_value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_epoch_current(
 org UUID,value public.canonical_forecast_capacity_advisory_epochs_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 workload_epoch public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 constraint_epoch public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;item JSONB;review_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
BEGIN
 SELECT * INTO latest FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT * INTO workload_epoch FROM public.canonical_forecast_workload_capacity_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT * INTO constraint_epoch FROM public.canonical_forecast_constrained_capacity_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF latest.id IS DISTINCT FROM value.id OR workload_epoch.id IS DISTINCT FROM value.upstream_workload_epoch_id
  OR constraint_epoch.id IS DISTINCT FROM value.upstream_constraint_epoch_id THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements((value.review_manifest->'policies')||
   jsonb_build_array(value.review_manifest->'method')) entries(entry) LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_capacity_advisory_reviews_v1
   WHERE organization_id=org AND id=(item->>'id')::uuid;
  IF review_value.id IS NULL THEN
   SELECT * INTO review_value FROM public.canonical_forecast_capacity_advisory_reviews_v1
    WHERE organization_id=org AND id=(item->>'reviewId')::uuid;
  END IF;
  IF review_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_review_is_current(org,review_value) IS NOT TRUE THEN RETURN FALSE;END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_origin_current(
 org UUID,value public.canonical_forecast_capacity_advisory_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 current_constraint JSONB;current_policy JSONB;current_demand JSONB;current_results JSONB;
BEGIN
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org AND id=value.epoch_id;
 IF epoch_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE THEN RETURN FALSE;END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_origins_v1 newer
   WHERE newer.organization_id=org AND newer.epoch_id=value.epoch_id
    AND newer.prediction_cutoff_at=value.prediction_cutoff_at AND newer.horizon_ends_at=value.horizon_ends_at
    AND newer.generation>value.generation) THEN RETURN FALSE;END IF;
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(value.input_manifest#>>'{workloadOrigin,id}')::uuid;
 IF workload_origin.id IS NULL OR rtrim(workload_origin.digest) IS DISTINCT FROM value.input_manifest#>>'{workloadOrigin,digest}'
  OR workload_origin.prediction_cutoff_at IS DISTINCT FROM value.prediction_cutoff_at
  OR workload_origin.horizon_ends_at IS DISTINCT FROM value.horizon_ends_at
  OR public.canonical_forecast_workload_capacity_v1_origin_current(org,workload_origin) IS NOT TRUE
  OR public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(org,workload_origin) IS NOT TRUE THEN RETURN FALSE;END IF;
 current_constraint:=value.input_manifest->'constraintInput';
 IF public.canonical_forecast_capacity_advisory_v1_constraint_manifest_current(
   org,current_constraint,value.prediction_cutoff_at,value.horizon_ends_at) IS NOT TRUE THEN RETURN FALSE;END IF;
 current_policy:=public.canonical_forecast_capacity_advisory_v1_policy_manifest(org,value.prediction_cutoff_at);
  current_demand:=public.canonical_forecast_capacity_advisory_v1_demand_manifest_pinned(
   org,value.input_manifest->'demands',workload_origin.input_evidence#>'{backlog,rows}',current_constraint);
 current_results:=public.canonical_forecast_capacity_advisory_v1_results(org,value.prediction_cutoff_at,value.horizon_ends_at,
  value.prediction_cutoff_at,current_constraint,current_policy,current_demand,
  workload_origin.private_results);
 RETURN value.input_manifest->>'constraintDigest'=public.canonical_completion_digest(current_constraint)
  AND value.input_manifest->>'policyDigest'=public.canonical_completion_digest(current_policy)
  AND value.input_manifest->>'demandDigest'=public.canonical_completion_digest(current_demand)
  AND value.private_results=current_results;
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_origin_projection(
 value public.canonical_forecast_capacity_advisory_origins_v1,state_value TEXT,replayed_value BOOLEAN,decision_action TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE categories JSONB:=NULL;
BEGIN
 IF decision_action='approve' THEN
 SELECT jsonb_agg(jsonb_build_object('alternativeKey',entry->>'alternativeKey','scopeKey',entry->>'scopeKey',
   'role',entry->>'role','categories',jsonb_build_object(
    'bottleneck',jsonb_build_object('state',entry#>>'{categories,bottleneck,state}'),
    'backlog',jsonb_build_object('state',entry#>>'{categories,backlog,state}'),
    'overtime',jsonb_build_object('state',entry#>>'{categories,overtime,state}'),
    'contractor',jsonb_build_object('state',entry#>>'{categories,contractor,state}'),
    'hiring_need',jsonb_build_object('state',entry#>>'{categories,hiring_need,state}')))
   ORDER BY entry->>'alternativeKey',entry->>'scopeKey')
  INTO categories FROM jsonb_array_elements(value.private_results) entry;
 END IF;
 RETURN jsonb_build_object('state',state_value,'id',value.id,'predictionCutoffAt',value.prediction_cutoff_at,
  'horizonEndsAt',value.horizon_ends_at,'scopeCount',value.scope_count,'categoryCount',value.scope_count*5,
  'decisionAction',decision_action,'categories',categories,'refreshRequired',state_value='capacity_advisory_origin_stale',
  'valuesWithheld',TRUE,'thresholdsWithheld',TRUE,'outputDigestsWithheld',TRUE,'researchOnly',TRUE,
  'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,
  'replayed',replayed_value);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_origin_capture(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 old public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;current_generation public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;workload_response JSONB;
 candidate_cutoff TIMESTAMPTZ;cutoff_value TIMESTAMPTZ;end_value TIMESTAMPTZ;constraint_input JSONB;policy_manifest JSONB;demand_manifest JSONB;
 results_value JSONB;input_value JSONB;child_key TEXT;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-capacity-advisory-origin-v1' THEN
  RAISE EXCEPTION 'Capacity advisory origin request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 request_hash:=public.canonical_completion_digest(jsonb_build_object('reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash OR public.canonical_forecast_capacity_advisory_v1_origin_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory origin replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_capacity_advisory_v1_origin_projection(old,'capacity_advisory_origin_saved',TRUE,NULL);END IF;
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF epoch_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory epoch unavailable' USING ERRCODE='22023';END IF;
 -- Reject an already-current exact server instant before invoking the accepted
 -- Part 5A child. This makes exact-time duplicate attempts side-effect free.
 candidate_cutoff:=public.canonical_forecast_workload_capacity_v1_clock();
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-period:'||org||':'||epoch_value.id||':'||candidate_cutoff||':'||(candidate_cutoff+INTERVAL '2592000 seconds'),0));
 SELECT * INTO current_generation FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND epoch_id=epoch_value.id AND prediction_cutoff_at=candidate_cutoff
   AND horizon_ends_at=candidate_cutoff+INTERVAL '2592000 seconds' ORDER BY generation DESC LIMIT 1;
 IF current_generation.id IS NOT NULL
  AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,current_generation) IS TRUE THEN
  RAISE EXCEPTION 'Capacity advisory period already has a current origin' USING ERRCODE='40001';END IF;
 -- The accepted Part 5A action owns the forecast cutoff, 60-day prospective
 -- training requirement, method reviews, two atomic training windows and the
 -- immutable future workload origin.  Part 5C cannot replace it with a current
 -- stock snapshot.  The child key hashes the full parent identity.
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 child_key:='m26p5c:'||encode(sha256(convert_to(key_value||':accepted-p5a-origin','UTF8')),'hex');
 workload_response:=public.canonical_forecast_workload_capacity_v1_origin_capture(
  org,actor,actor_role,session_value,csrf,child_key,
  'Part 5C advisory capture authorizes the exact accepted Part 5A forecast: '||left(btrim(reason_value),800),
  'm26-workload-capacity-origin-v1');
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(workload_response->>'id')::uuid;
 IF workload_origin.id IS NULL OR public.canonical_forecast_workload_capacity_v1_origin_current(org,workload_origin) IS NOT TRUE THEN
  RAISE EXCEPTION 'Accepted workload forecast unavailable' USING ERRCODE='22023';END IF;
 cutoff_value:=workload_origin.prediction_cutoff_at;end_value:=workload_origin.horizon_ends_at;
 constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,cutoff_value);
 policy_manifest:=public.canonical_forecast_capacity_advisory_v1_policy_manifest(org,cutoff_value);
 demand_manifest:=public.canonical_forecast_capacity_advisory_v1_demand_manifest(
  org,'demand',NULL,workload_origin.input_evidence#>'{backlog,rows}',constraint_input);
 results_value:=public.canonical_forecast_capacity_advisory_v1_results(org,cutoff_value,end_value,cutoff_value,
  constraint_input,policy_manifest,demand_manifest,workload_origin.private_results);
 input_value:=jsonb_build_object('constraintInput',constraint_input,'constraintDigest',public.canonical_completion_digest(constraint_input),
  'policies',policy_manifest,'policyDigest',public.canonical_completion_digest(policy_manifest),
  'demands',demand_manifest,'demandDigest',public.canonical_completion_digest(demand_manifest),
  'workloadOrigin',jsonb_build_object('id',workload_origin.id,'digest',rtrim(workload_origin.digest),
   'capacityRole',workload_origin.capacity_role,'cutoff',workload_origin.prediction_cutoff_at,
   'horizon',workload_origin.horizon_ends_at));
 IF octet_length(input_value::text)+octet_length(results_value::text)>524288 THEN RAISE EXCEPTION 'Capacity advisory evidence exceeds bounds' USING ERRCODE='54000';END IF;
 -- Different request keys for one exact period serialize here. A current
 -- canonical generation refuses duplication; a genuinely stale generation
 -- may be superseded append-only without making the old lineage selectable.
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-period:'||org||':'||epoch_value.id||':'||cutoff_value||':'||end_value,0));
 SELECT * INTO current_generation FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND epoch_id=epoch_value.id AND prediction_cutoff_at=cutoff_value
   AND horizon_ends_at=end_value ORDER BY generation DESC LIMIT 1;
 IF current_generation.id IS NOT NULL
  AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,current_generation) IS TRUE THEN
  RAISE EXCEPTION 'Capacity advisory period already has a current origin' USING ERRCODE='40001';END IF;
 INSERT INTO public.canonical_forecast_capacity_advisory_origins_v1(
  organization_id,epoch_id,prediction_cutoff_at,horizon_ends_at,generation,previous_id,input_manifest,private_results,scope_count,
  actor_id,membership_id,session_id,idempotency_key_hash,request_digest,captured_at,digest)
 VALUES(org,epoch_value.id,cutoff_value,end_value,COALESCE(current_generation.generation,0)+1,current_generation.id,
  input_value,results_value,jsonb_array_length(results_value),actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash,cutoff_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'epochId',epoch_value.id,'cutoff',cutoff_value,
   'end',end_value,'generation',COALESCE(current_generation.generation,0)+1,'previousId',current_generation.id,
   'inputDigest',public.canonical_completion_digest(input_value),'outputDigest',public.canonical_completion_digest(results_value))))
 RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_capacity_advisory_v1_origin_projection(inserted,'capacity_advisory_origin_saved',FALSE,NULL);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_latest_decision(
 org UUID,origin_value UUID)
RETURNS public.canonical_forecast_capacity_advisory_decisions_v1 LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value FROM public.canonical_forecast_capacity_advisory_decisions_v1 value
 WHERE value.organization_id=org AND value.origin_id=origin_value ORDER BY value.revision DESC LIMIT 1
$$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_origin_read(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 decision_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND id=id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 current_value:=public.canonical_forecast_capacity_advisory_v1_origin_current(org,value);
 decision_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,value.id);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_capacity_advisory_v1_origin_projection(value,
  CASE WHEN current_value THEN 'capacity_advisory_origin_current' ELSE 'capacity_advisory_origin_stale' END,FALSE,
  CASE WHEN current_value THEN decision_value.action ELSE NULL END);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_decision_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_value UUID,action_value TEXT,
 expected_revision BIGINT,expected_digest TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;origin_row public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 old public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;current_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;now_value TIMESTAMPTZ;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR action_value NOT IN('approve','reject','withdraw')
  OR expected_revision<0 OR ((expected_revision=0) IS DISTINCT FROM (expected_digest='none'))
  OR (expected_revision>0 AND expected_digest!~'^[0-9a-f]{64}$')
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR confirmation_value<>'m26-capacity-advisory-decision-v1' THEN RAISE EXCEPTION 'Capacity advisory decision request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 SELECT * INTO origin_row FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND id=origin_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_row) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('originId',origin_value,'action',action_value,
  'expectedRevision',expected_revision,'expectedDigest',expected_digest,'expectedOriginDigest',rtrim(origin_row.digest),
  'reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_decisions_v1 WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  current_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,origin_value);
  IF old.request_digest<>request_hash OR current_value.id IS DISTINCT FROM old.id THEN RAISE EXCEPTION 'Capacity advisory decision replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','capacity_advisory_decision_recorded','id',old.id,'originId',old.origin_id,
   'action',old.action,'revision',old.revision,'digest',rtrim(old.digest),'replayed',TRUE);END IF;
 current_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,origin_value);
 IF COALESCE(current_value.revision,0)<>expected_revision OR COALESCE(rtrim(current_value.digest),'none')<>expected_digest THEN
  RAISE EXCEPTION 'Capacity advisory decision revision conflict' USING ERRCODE='40001';END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 INSERT INTO public.canonical_forecast_capacity_advisory_decisions_v1(
  organization_id,origin_id,revision,previous_id,action,expected_origin_digest,reason,confirmation_version,
  actor_id,membership_id,session_id,idempotency_key_hash,request_digest,decided_at,digest)
 VALUES(org,origin_value,expected_revision+1,current_value.id,action_value,rtrim(origin_row.digest),btrim(reason_value),confirmation_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,now_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'originId',origin_value,'originDigest',rtrim(origin_row.digest),
   'revision',expected_revision+1,'action',action_value,'decidedAt',now_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','capacity_advisory_decision_recorded','id',inserted.id,'originId',inserted.origin_id,
  'action',inserted.action,'revision',inserted.revision,'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_decision_read(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,origin_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 origin_row public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;current_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
BEGIN
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_capacity_advisory_decisions_v1 WHERE organization_id=org AND origin_id=origin_value AND id=id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO origin_row FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND id=origin_value;
 current_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,origin_value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state',CASE WHEN current_value.id=value.id AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_row)
   THEN 'capacity_advisory_decision_current' ELSE 'capacity_advisory_decision_stale' END,
  'id',value.id,'originId',value.origin_id,'action',value.action,'revision',value.revision,
  'refreshRequired',NOT(current_value.id=value.id AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_row)),
  'researchOnly',TRUE,'automaticActionTaken',FALSE,'replayed',FALSE);
END $$;

-- Explicit preparation records the accepted Part 5A original-period outcome
-- before the separate human outcome-allocation review. It does not persist a
-- Part 5C outcome and cannot silently reuse the origin allocation.
CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_outcome_prepare(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;origin_row public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 decision_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 window_response JSONB;evaluation_response JSONB;window_key TEXT;evaluation_key TEXT;alternatives JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Capacity advisory outcome preparation invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 SELECT * INTO origin_row FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=origin_value;
 IF origin_row.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_row) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 decision_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,origin_value);
 IF decision_value.id IS NULL OR decision_value.action<>'approve' THEN
  RAISE EXCEPTION 'Approved capacity advice unavailable' USING ERRCODE='22023';END IF;
 IF public.canonical_forecast_workload_capacity_v1_clock()<origin_row.horizon_ends_at THEN
  RAISE EXCEPTION 'Capacity advisory horizon incomplete' USING ERRCODE='22023';END IF;
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(origin_row.input_manifest#>>'{workloadOrigin,id}')::uuid;
 IF workload_origin.id IS NULL OR rtrim(workload_origin.digest) IS DISTINCT FROM origin_row.input_manifest#>>'{workloadOrigin,digest}' THEN
  RAISE EXCEPTION 'Accepted workload forecast unavailable' USING ERRCODE='22023';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_row) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 window_key:='m26p5c:'||encode(sha256(convert_to(key_value||':accepted-p5a-outcome-window:'||origin_value,'UTF8')),'hex');
 evaluation_key:='m26p5c:'||encode(sha256(convert_to(key_value||':accepted-p5a-evaluation:'||origin_value,'UTF8')),'hex');
 window_response:=public.canonical_forecast_workload_capacity_v1_window_finalize(
  org,actor,actor_role,session_value,csrf,window_key,origin_row.prediction_cutoff_at,origin_row.horizon_ends_at,
  'Part 5C outcome preparation authorizes this exact accepted Part 5A original-period window.');
 evaluation_response:=public.canonical_forecast_workload_capacity_v1_evaluation_capture(
  org,actor,actor_role,session_value,csrf,evaluation_key,workload_origin.id);
 SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND id=(evaluation_response->>'id')::uuid;
 IF workload_evaluation.id IS NULL OR
   public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,workload_evaluation) IS NOT TRUE THEN
  RAISE EXCEPTION 'Accepted workload outcome unavailable' USING ERRCODE='22023';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_row) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 SELECT jsonb_agg(value ORDER BY value) INTO alternatives
 FROM jsonb_array_elements_text(origin_row.input_manifest#>'{constraintInput,alternatives}') value;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','capacity_advisory_outcome_basis_ready','originId',origin_value,
  'workloadEvaluationId',workload_evaluation.id,'alternativeKeys',COALESCE(alternatives,'[]'::jsonb),
  'periodStart',origin_row.prediction_cutoff_at,'periodEnd',origin_row.horizon_ends_at,
  'researchOnly',TRUE,'valuesWithheld',TRUE,'automaticActionTaken',FALSE,
  'replayed',COALESCE((evaluation_response->>'replayed')::boolean,FALSE));
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_outcome_current(
 org UUID,value public.canonical_forecast_capacity_advisory_outcomes_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE origin_row public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 workload_results JSONB;constraint_input JSONB;historical_input JSONB;demand_manifest JSONB;results_value JSONB;
BEGIN
 SELECT * INTO origin_row FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND id=value.origin_id;
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org AND id=origin_row.epoch_id;
 IF origin_row.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_origins_v1 newer
    WHERE newer.organization_id=org AND newer.epoch_id=origin_row.epoch_id
     AND newer.prediction_cutoff_at=origin_row.prediction_cutoff_at
     AND newer.horizon_ends_at=origin_row.horizon_ends_at
     AND newer.generation>origin_row.generation) THEN RETURN FALSE;END IF;
 SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND id=(value.source_manifest->>'workloadEvaluationId')::uuid;
 IF workload_evaluation.id IS NULL OR rtrim(workload_evaluation.digest) IS DISTINCT FROM value.source_manifest->>'workloadEvaluationDigest'
  OR public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,workload_evaluation) IS NOT TRUE THEN RETURN FALSE;END IF;
 SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND id=workload_evaluation.outcome_window_id;
 workload_results:=jsonb_build_object(
  'workload.end_backlog_hours.v1',workload_evaluation.private_metrics#>'{workload.end_backlog_hours.v1,actual}');
 constraint_input:=origin_row.input_manifest->'constraintInput';
 historical_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
  org,origin_row.horizon_ends_at,origin_row.prediction_cutoff_at);
 demand_manifest:=public.canonical_forecast_capacity_advisory_v1_demand_manifest(
  org,'outcome_demand',origin_row.id,workload_window.evidence#>'{backlog,rows}',historical_input);
 results_value:=public.canonical_forecast_capacity_advisory_v1_results(org,origin_row.prediction_cutoff_at,
  origin_row.horizon_ends_at,origin_row.horizon_ends_at,constraint_input,origin_row.input_manifest->'policies',
  demand_manifest,workload_results);
 RETURN value.private_results=results_value AND value.source_manifest->>'resultDigest'=public.canonical_completion_digest(results_value)
  AND value.source_manifest->>'constraintDigest'=public.canonical_completion_digest(constraint_input)
  AND value.source_manifest->>'historicalConstraintDigest'=public.canonical_completion_digest(historical_input)
  AND value.source_manifest->>'demandDigest'=public.canonical_completion_digest(demand_manifest)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_outcomes_v1 newer
   WHERE newer.organization_id=org AND newer.origin_id=value.origin_id AND newer.revision>value.revision);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_outcome_projection(
 value public.canonical_forecast_capacity_advisory_outcomes_v1,state_value TEXT,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',state_value,'id',value.id,'originId',value.origin_id,'revision',value.revision,
  'capturedAt',value.captured_at,'refreshRequired',state_value='capacity_advisory_outcome_stale',
  'valuesWithheld',TRUE,'outputDigestsWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',replayed_value)
$$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_outcome_capture(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;origin_row public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 old public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;current_value public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 decision_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 workload_results JSONB;constraint_input JSONB;historical_input JSONB;demand_manifest JSONB;
 results_value JSONB;manifest_value JSONB;now_value TIMESTAMPTZ;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Capacity advisory outcome request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 SELECT * INTO origin_row FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND id=origin_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_row) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org AND id=origin_row.epoch_id;
 IF public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE THEN RAISE EXCEPTION 'Capacity advisory epoch stale' USING ERRCODE='40001';END IF;
 decision_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,origin_value);
 IF decision_value.id IS NULL OR decision_value.action<>'approve' THEN RAISE EXCEPTION 'Approved capacity advice unavailable' USING ERRCODE='22023';END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 IF now_value<origin_row.horizon_ends_at THEN RAISE EXCEPTION 'Capacity advisory horizon incomplete' USING ERRCODE='22023';END IF;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','outcome','originId',origin_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_outcomes_v1 WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash OR public.canonical_forecast_capacity_advisory_v1_outcome_current(org,old) IS NOT TRUE THEN RAISE EXCEPTION 'Capacity advisory outcome replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_capacity_advisory_v1_outcome_projection(old,'capacity_advisory_outcome_saved',TRUE);END IF;
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(origin_row.input_manifest#>>'{workloadOrigin,id}')::uuid;
 IF workload_origin.id IS NULL OR rtrim(workload_origin.digest) IS DISTINCT FROM origin_row.input_manifest#>>'{workloadOrigin,digest}' THEN
  RAISE EXCEPTION 'Accepted workload forecast unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND origin_id=workload_origin.id ORDER BY revision DESC LIMIT 1;
 IF workload_evaluation.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,workload_evaluation) IS NOT TRUE THEN
  RAISE EXCEPTION 'Accepted workload outcome unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND id=workload_evaluation.outcome_window_id;
 workload_results:=jsonb_build_object(
  'workload.end_backlog_hours.v1',workload_evaluation.private_metrics#>'{workload.end_backlog_hours.v1,actual}');
 constraint_input:=origin_row.input_manifest->'constraintInput';
 historical_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
  org,origin_row.horizon_ends_at,origin_row.prediction_cutoff_at);
 demand_manifest:=public.canonical_forecast_capacity_advisory_v1_demand_manifest(
  org,'outcome_demand',origin_row.id,workload_window.evidence#>'{backlog,rows}',historical_input);
 results_value:=public.canonical_forecast_capacity_advisory_v1_results(org,origin_row.prediction_cutoff_at,origin_row.horizon_ends_at,
  origin_row.horizon_ends_at,constraint_input,origin_row.input_manifest->'policies',demand_manifest,workload_results);
 manifest_value:=jsonb_build_object('originId',origin_row.id,'originDigest',rtrim(origin_row.digest),
  'decisionId',decision_value.id,'decisionDigest',rtrim(decision_value.digest),
  'workloadEvaluationId',workload_evaluation.id,'workloadEvaluationDigest',rtrim(workload_evaluation.digest),
  'workloadOutcomeWindowId',workload_evaluation.outcome_window_id,
  'constraintDigest',public.canonical_completion_digest(constraint_input),
  'historicalConstraintDigest',public.canonical_completion_digest(historical_input),
  'demandDigest',public.canonical_completion_digest(demand_manifest),
  'resultDigest',public.canonical_completion_digest(results_value));
 SELECT * INTO current_value FROM public.canonical_forecast_capacity_advisory_outcomes_v1 WHERE organization_id=org AND origin_id=origin_value ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.canonical_forecast_capacity_advisory_outcomes_v1(
  organization_id,origin_id,revision,previous_id,source_manifest,private_results,actor_id,membership_id,session_id,
  idempotency_key_hash,request_digest,captured_at,digest)
 VALUES(org,origin_value,COALESCE(current_value.revision,0)+1,current_value.id,manifest_value,results_value,actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash,now_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'originId',origin_value,
   'revision',COALESCE(current_value.revision,0)+1,'source',manifest_value,'results',results_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_capacity_advisory_v1_outcome_projection(inserted,'capacity_advisory_outcome_saved',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_outcome_read(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,origin_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_capacity_advisory_outcomes_v1 WHERE organization_id=org AND origin_id=origin_value AND id=id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 current_value:=public.canonical_forecast_capacity_advisory_v1_outcome_current(org,value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_capacity_advisory_v1_outcome_projection(value,
  CASE WHEN current_value THEN 'capacity_advisory_outcome_current' ELSE 'capacity_advisory_outcome_stale' END,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_evaluation_current(
 org UUID,value public.canonical_forecast_capacity_advisory_evaluations_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE outcome_value public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;
 decision_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;latest_decision public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
BEGIN
 SELECT * INTO outcome_value FROM public.canonical_forecast_capacity_advisory_outcomes_v1 WHERE organization_id=org AND id=value.outcome_id;
 SELECT * INTO decision_value FROM public.canonical_forecast_capacity_advisory_decisions_v1 WHERE organization_id=org AND id=value.decision_id;
 latest_decision:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,value.origin_id);
 RETURN outcome_value.id IS NOT NULL AND decision_value.id IS NOT NULL AND decision_value.action='approve'
  AND latest_decision.id=decision_value.id AND public.canonical_forecast_capacity_advisory_v1_outcome_current(org,outcome_value)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_evaluations_v1 newer
   WHERE newer.organization_id=org AND newer.origin_id=value.origin_id AND newer.revision>value.revision);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_evaluation_projection(
 value public.canonical_forecast_capacity_advisory_evaluations_v1,state_value TEXT,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',state_value,'id',value.id,'originId',value.origin_id,'outcomeId',value.outcome_id,
  'decisionId',value.decision_id,'revision',value.revision,'evaluatedAt',value.evaluated_at,
  'refreshRequired',state_value='capacity_advisory_evaluation_stale','metricsWithheld',TRUE,
  'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,
  'automaticActionTaken',FALSE,'replayed',replayed_value)
$$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_evaluation_capture(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_value UUID,outcome_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;origin_row public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 outcome_row public.canonical_forecast_capacity_advisory_outcomes_v1%ROWTYPE;decision_row public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 old public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;current_value public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;metrics_value JSONB;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;now_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Capacity advisory evaluation request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 SELECT * INTO origin_row FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND id=origin_value;
 SELECT * INTO outcome_row FROM public.canonical_forecast_capacity_advisory_outcomes_v1 WHERE organization_id=org AND id=outcome_value AND origin_id=origin_value;
 IF origin_row.id IS NULL OR outcome_row.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_outcome_current(org,outcome_row) IS NOT TRUE THEN RAISE EXCEPTION 'Capacity advisory outcome stale' USING ERRCODE='40001';END IF;
 decision_row:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,origin_value);
 IF decision_row.id IS NULL OR decision_row.action<>'approve' THEN RAISE EXCEPTION 'Approved capacity advice unavailable' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(jsonb_build_object('alternativeKey',forecast->>'alternativeKey','scopeKey',forecast->>'scopeKey','role',forecast->>'role',
  'categories',(SELECT jsonb_object_agg(category.key,jsonb_build_object('forecastState',category.value->>'state',
   'actualState',matched.actual->'categories'->category.key->>'state','matches',category.value->>'state'=matched.actual->'categories'->category.key->>'state'))
   FROM jsonb_each(forecast->'categories') category)) ORDER BY forecast->>'alternativeKey',forecast->>'scopeKey') INTO metrics_value
 FROM jsonb_array_elements(origin_row.private_results) forecast
 JOIN LATERAL (SELECT entry AS actual FROM jsonb_array_elements(outcome_row.private_results) entries(entry)
  WHERE entry->>'alternativeKey'=forecast->>'alternativeKey' AND entry->>'scopeKey'=forecast->>'scopeKey') matched ON TRUE;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('originId',origin_value,'outcomeId',outcome_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_evaluations_v1 WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash OR public.canonical_forecast_capacity_advisory_v1_evaluation_current(org,old) IS NOT TRUE THEN RAISE EXCEPTION 'Capacity advisory evaluation replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_capacity_advisory_v1_evaluation_projection(old,'capacity_advisory_evaluation_saved',TRUE);END IF;
 SELECT * INTO current_value FROM public.canonical_forecast_capacity_advisory_evaluations_v1 WHERE organization_id=org AND origin_id=origin_value ORDER BY revision DESC LIMIT 1;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 INSERT INTO public.canonical_forecast_capacity_advisory_evaluations_v1(
  organization_id,origin_id,outcome_id,decision_id,revision,previous_id,private_metrics,actor_id,membership_id,session_id,
  idempotency_key_hash,request_digest,evaluated_at,digest)
 VALUES(org,origin_value,outcome_value,decision_row.id,COALESCE(current_value.revision,0)+1,current_value.id,metrics_value,actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash,now_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'originId',origin_value,'outcomeId',outcome_value,
   'decisionId',decision_row.id,'revision',COALESCE(current_value.revision,0)+1,'metrics',metrics_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_capacity_advisory_v1_evaluation_projection(inserted,'capacity_advisory_evaluation_saved',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_evaluation_read(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,origin_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_capacity_advisory_evaluations_v1 WHERE organization_id=org AND origin_id=origin_value AND id=id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 current_value:=public.canonical_forecast_capacity_advisory_v1_evaluation_current(org,value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_capacity_advisory_v1_evaluation_projection(value,
  CASE WHEN current_value THEN 'capacity_advisory_evaluation_current' ELSE 'capacity_advisory_evaluation_stale' END,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_prerequisites(
 org UUID,actor UUID,actor_role TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 method_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;policy_count BIGINT;scope_count INTEGER:=0;
BEGIN
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 method_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(org,'method',NULL,NULL,NULL);
 SELECT count(*) INTO policy_count FROM (SELECT DISTINCT ON(alternative_key,scope_key,role_name) *
  FROM public.canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=org AND review_kind='policy'
  ORDER BY alternative_key,scope_key,role_name,revision DESC) current_policies WHERE action='approve';
 BEGIN scope_count:=jsonb_array_length(public.canonical_forecast_constrained_capacity_v1_complete_input(
  org,public.canonical_forecast_workload_capacity_v1_clock())->'scopes');EXCEPTION WHEN OTHERS THEN scope_count:=0;END;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','capacity_advisory_prerequisites_current','epoch',jsonb_build_object(
  'state',CASE WHEN epoch_value.id IS NULL THEN 'missing'
    WHEN public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) THEN 'current' ELSE 'stale' END,
  'id',epoch_value.id,'revision',epoch_value.revision,
  'installedAt',epoch_value.installed_at),'method',jsonb_build_object('expectedRevision',COALESCE(method_value.revision,0),
  'expectedDigest',COALESCE(rtrim(method_value.digest),'none'),'approved',COALESCE(method_value.action='approve',FALSE),
  'sourceCurrent',COALESCE(public.canonical_forecast_capacity_advisory_v1_review_is_current(org,method_value),FALSE)),
  'policyCount',policy_count,'scopeCount',scope_count,'categories',jsonb_build_array('bottleneck','backlog','overtime','contractor','hiring_need'),
  'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_capacity_advisory_methods_v1,
 public.canonical_forecast_capacity_advisory_reviews_v1,public.canonical_forecast_capacity_advisory_epochs_v1,
 public.canonical_forecast_capacity_advisory_origins_v1,public.canonical_forecast_capacity_advisory_decisions_v1,
 public.canonical_forecast_capacity_advisory_outcomes_v1,public.canonical_forecast_capacity_advisory_evaluations_v1 FROM PUBLIC;

REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable(),
 public.canonical_forecast_capacity_advisory_v1_lock_sources(uuid),
 public.canonical_forecast_capacity_advisory_v1_policy_valid(jsonb),
 public.canonical_forecast_capacity_advisory_v1_demand_valid(jsonb,text),
 public.canonical_forecast_capacity_advisory_v1_review_current_internal(uuid,text,text,text,text,uuid),
 public.canonical_forecast_capacity_advisory_v1_demand_basis(uuid,text,text,jsonb,jsonb,jsonb),
 public.canonical_forecast_capacity_advisory_v1_demand_source(uuid,text,text,uuid,jsonb,timestamptz),
 public.canonical_forecast_capacity_advisory_v1_demand_review_historical_current(uuid,public.canonical_forecast_capacity_advisory_reviews_v1),
 public.canonical_forecast_capacity_advisory_v1_demand_manifest_pinned(uuid,jsonb,jsonb,jsonb),
 public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(uuid,public.canonical_forecast_workload_capacity_origins_v1),
 public.canonical_forecast_capacity_advisory_v1_constraint_manifest_current(uuid,jsonb,timestamptz,timestamptz),
 public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(uuid,public.canonical_forecast_workload_capacity_evaluations_v1),
 public.canonical_forecast_capacity_advisory_v1_review_source(uuid,text,text,text,text,uuid,jsonb),
 public.canonical_forecast_capacity_advisory_v1_review_is_current(uuid,public.canonical_forecast_capacity_advisory_reviews_v1),
 public.canonical_forecast_capacity_advisory_v1_policy_manifest(uuid,timestamptz),
 public.canonical_forecast_capacity_advisory_v1_demand_manifest(uuid,text,uuid,jsonb,jsonb),
 public.canonical_forecast_capacity_advisory_v1_epoch_current(uuid,public.canonical_forecast_capacity_advisory_epochs_v1),
 public.canonical_forecast_capacity_advisory_v1_results(uuid,timestamptz,timestamptz,timestamptz,jsonb,jsonb,jsonb,jsonb),
 public.canonical_forecast_capacity_advisory_v1_origin_current(uuid,public.canonical_forecast_capacity_advisory_origins_v1),
 public.canonical_forecast_capacity_advisory_v1_origin_projection(public.canonical_forecast_capacity_advisory_origins_v1,text,boolean,text),
 public.canonical_forecast_capacity_advisory_v1_latest_decision(uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_outcome_current(uuid,public.canonical_forecast_capacity_advisory_outcomes_v1),
 public.canonical_forecast_capacity_advisory_v1_outcome_projection(public.canonical_forecast_capacity_advisory_outcomes_v1,text,boolean),
 public.canonical_forecast_capacity_advisory_v1_evaluation_current(uuid,public.canonical_forecast_capacity_advisory_evaluations_v1),
 public.canonical_forecast_capacity_advisory_v1_evaluation_projection(public.canonical_forecast_capacity_advisory_evaluations_v1,text,boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_advisory_v1_prerequisites(uuid,uuid,text,uuid),
 public.canonical_forecast_capacity_advisory_v1_review_current(uuid,uuid,text,uuid,text,text,text,text,uuid),
 public.canonical_forecast_capacity_advisory_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,text,text,uuid,text,bigint,text,jsonb,text,text),
 public.canonical_forecast_capacity_advisory_v1_epoch_capture(uuid,uuid,text,uuid,text,text,text,text),
 public.canonical_forecast_capacity_advisory_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text),
 public.canonical_forecast_capacity_advisory_v1_origin_read(uuid,uuid,text,uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,text,bigint,text,text,text),
 public.canonical_forecast_capacity_advisory_v1_decision_read(uuid,uuid,text,uuid,uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_outcome_prepare(uuid,uuid,text,uuid,text,text,uuid),
 public.canonical_forecast_capacity_advisory_v1_outcome_capture(uuid,uuid,text,uuid,text,text,uuid),
 public.canonical_forecast_capacity_advisory_v1_outcome_read(uuid,uuid,text,uuid,uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_evaluation_read(uuid,uuid,text,uuid,uuid,uuid) FROM PUBLIC;

DO $$ DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
 EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_capacity_advisory_methods_v1,public.canonical_forecast_capacity_advisory_reviews_v1,public.canonical_forecast_capacity_advisory_epochs_v1,public.canonical_forecast_capacity_advisory_origins_v1,public.canonical_forecast_capacity_advisory_decisions_v1,public.canonical_forecast_capacity_advisory_outcomes_v1,public.canonical_forecast_capacity_advisory_evaluations_v1 FROM %I',runtime_role);
 EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable(),public.canonical_forecast_capacity_advisory_v1_lock_sources(uuid),public.canonical_forecast_capacity_advisory_v1_policy_valid(jsonb),public.canonical_forecast_capacity_advisory_v1_demand_valid(jsonb,text),public.canonical_forecast_capacity_advisory_v1_review_current_internal(uuid,text,text,text,text,uuid),public.canonical_forecast_capacity_advisory_v1_demand_basis(uuid,text,text,jsonb,jsonb,jsonb),public.canonical_forecast_capacity_advisory_v1_demand_source(uuid,text,text,uuid,jsonb,timestamptz),public.canonical_forecast_capacity_advisory_v1_demand_review_historical_current(uuid,public.canonical_forecast_capacity_advisory_reviews_v1),public.canonical_forecast_capacity_advisory_v1_demand_manifest_pinned(uuid,jsonb,jsonb,jsonb),
 public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(uuid,public.canonical_forecast_workload_capacity_origins_v1),
 public.canonical_forecast_capacity_advisory_v1_constraint_manifest_current(uuid,jsonb,timestamptz,timestamptz),
 public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(uuid,public.canonical_forecast_workload_capacity_evaluations_v1),public.canonical_forecast_capacity_advisory_v1_review_source(uuid,text,text,text,text,uuid,jsonb),public.canonical_forecast_capacity_advisory_v1_review_is_current(uuid,public.canonical_forecast_capacity_advisory_reviews_v1),public.canonical_forecast_capacity_advisory_v1_policy_manifest(uuid,timestamptz),public.canonical_forecast_capacity_advisory_v1_demand_manifest(uuid,text,uuid,jsonb,jsonb),public.canonical_forecast_capacity_advisory_v1_epoch_current(uuid,public.canonical_forecast_capacity_advisory_epochs_v1),public.canonical_forecast_capacity_advisory_v1_results(uuid,timestamptz,timestamptz,timestamptz,jsonb,jsonb,jsonb,jsonb),public.canonical_forecast_capacity_advisory_v1_origin_current(uuid,public.canonical_forecast_capacity_advisory_origins_v1),public.canonical_forecast_capacity_advisory_v1_origin_projection(public.canonical_forecast_capacity_advisory_origins_v1,text,boolean,text),public.canonical_forecast_capacity_advisory_v1_latest_decision(uuid,uuid),public.canonical_forecast_capacity_advisory_v1_outcome_current(uuid,public.canonical_forecast_capacity_advisory_outcomes_v1),public.canonical_forecast_capacity_advisory_v1_outcome_projection(public.canonical_forecast_capacity_advisory_outcomes_v1,text,boolean),public.canonical_forecast_capacity_advisory_v1_evaluation_current(uuid,public.canonical_forecast_capacity_advisory_evaluations_v1),public.canonical_forecast_capacity_advisory_v1_evaluation_projection(public.canonical_forecast_capacity_advisory_evaluations_v1,text,boolean) FROM %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_capacity_advisory_v1_prerequisites(uuid,uuid,text,uuid),public.canonical_forecast_capacity_advisory_v1_review_current(uuid,uuid,text,uuid,text,text,text,text,uuid),public.canonical_forecast_capacity_advisory_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,text,text,uuid,text,bigint,text,jsonb,text,text),public.canonical_forecast_capacity_advisory_v1_epoch_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_capacity_advisory_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_capacity_advisory_v1_origin_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_capacity_advisory_v1_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,text,bigint,text,text,text),public.canonical_forecast_capacity_advisory_v1_decision_read(uuid,uuid,text,uuid,uuid,uuid),public.canonical_forecast_capacity_advisory_v1_outcome_prepare(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_capacity_advisory_v1_outcome_capture(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_capacity_advisory_v1_outcome_read(uuid,uuid,text,uuid,uuid,uuid),public.canonical_forecast_capacity_advisory_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid,uuid),public.canonical_forecast_capacity_advisory_v1_evaluation_read(uuid,uuid,text,uuid,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;

-- Part 5C prospective continuation and same-period correction authority.
-- This additive authority preserves every accepted Part 5A/5B contract. A
-- human reserves one exact successor period before the predecessor ends; a
-- private runtime worker may activate it only after the boundary and before
-- the fixed one-hour deadline. Callers never choose or backdate a cutoff.
CREATE TABLE public.canonical_forecast_capacity_advisory_continuations_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 id UUID NOT NULL DEFAULT gen_random_uuid(),predecessor_origin_id UUID NOT NULL,
 epoch_id UUID NOT NULL,period_start TIMESTAMPTZ NOT NULL,period_end TIMESTAMPTZ NOT NULL,
 activation_deadline TIMESTAMPTZ NOT NULL,review_manifest JSONB NOT NULL,
 actor_id UUID NOT NULL REFERENCES public.users(id),membership_id UUID NOT NULL,session_id UUID NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role IN('owner','admin')),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m26-capacity-advisory-continuation-v1'),
 idempotency_key_hash TEXT NOT NULL CHECK(idempotency_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 reserved_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,predecessor_origin_id),
 UNIQUE(organization_id,actor_id,idempotency_key_hash),
 FOREIGN KEY(organization_id,predecessor_origin_id)
  REFERENCES public.canonical_forecast_capacity_advisory_origins_v1(organization_id,id),
 FOREIGN KEY(organization_id,epoch_id)
  REFERENCES public.canonical_forecast_capacity_advisory_epochs_v1(organization_id,id),
 CHECK(period_end=period_start+INTERVAL '2592000 seconds'),
 CHECK(activation_deadline=period_start+INTERVAL '1 hour'),
 CHECK(jsonb_typeof(review_manifest)='object' AND octet_length(review_manifest::text)<=262144)
);
CREATE TABLE public.canonical_forecast_capacity_advisory_continuation_events_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id),id UUID NOT NULL DEFAULT gen_random_uuid(),
 continuation_id UUID NOT NULL,event_kind TEXT NOT NULL CHECK(event_kind IN('activated','missed','retired')),
 origin_id UUID,observed_at TIMESTAMPTZ NOT NULL,detail_code TEXT NOT NULL
  CHECK(detail_code IN('activated','activation_deadline_missed','source_authority_retired')),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,continuation_id),
 FOREIGN KEY(organization_id,continuation_id)
  REFERENCES public.canonical_forecast_capacity_advisory_continuations_v1(organization_id,id),
 FOREIGN KEY(organization_id,origin_id)
  REFERENCES public.canonical_forecast_capacity_advisory_origins_v1(organization_id,id),
 CHECK((event_kind='activated' AND origin_id IS NOT NULL AND detail_code='activated') OR
       (event_kind='missed' AND origin_id IS NULL AND detail_code='activation_deadline_missed') OR
       (event_kind='retired' AND origin_id IS NULL AND detail_code='source_authority_retired'))
);
CREATE TRIGGER canonical_forecast_capacity_advisory_continuations_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_capacity_advisory_continuations_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable();
CREATE TRIGGER canonical_forecast_capacity_advisory_continuation_events_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_capacity_advisory_continuation_events_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_capacity_advisory_v1_immutable();

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_current(
 org UUID,value public.canonical_forecast_capacity_advisory_continuations_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE predecessor public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 decision_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 event_value public.canonical_forecast_capacity_advisory_continuation_events_v1%ROWTYPE;
BEGIN
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1
  WHERE organization_id=org AND id=value.epoch_id;
 SELECT * INTO predecessor FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=value.predecessor_origin_id;
 decision_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,value.predecessor_origin_id);
 SELECT * INTO event_value FROM public.canonical_forecast_capacity_advisory_continuation_events_v1
  WHERE organization_id=org AND continuation_id=value.id;
 RETURN value.period_start=predecessor.horizon_ends_at
  AND value.period_end=value.period_start+INTERVAL '2592000 seconds'
  AND value.activation_deadline=value.period_start+INTERVAL '1 hour'
  AND epoch_value.id IS NOT NULL AND public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value)
  AND predecessor.id IS NOT NULL AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,predecessor)
  AND decision_value.id IS NOT NULL AND decision_value.action='approve'
  AND (event_value.id IS NULL OR (event_value.event_kind='activated' AND EXISTS(
    SELECT 1 FROM public.canonical_forecast_capacity_advisory_origins_v1 origin_value
    WHERE origin_value.organization_id=org AND origin_value.id=event_value.origin_id
     AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,origin_value))));
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_projection(
 value public.canonical_forecast_capacity_advisory_continuations_v1,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE event_value public.canonical_forecast_capacity_advisory_continuation_events_v1%ROWTYPE;state_value TEXT;
BEGIN
 SELECT * INTO event_value FROM public.canonical_forecast_capacity_advisory_continuation_events_v1
  WHERE organization_id=value.organization_id AND continuation_id=value.id;
 state_value:=CASE WHEN event_value.event_kind='activated'
    AND public.canonical_forecast_capacity_advisory_v1_continuation_current(value.organization_id,value)
   THEN 'capacity_advisory_continuation_activated'
  WHEN event_value.event_kind='missed' THEN 'capacity_advisory_continuation_missed'
  WHEN event_value.event_kind='retired' THEN 'capacity_advisory_continuation_stale'
  WHEN public.canonical_forecast_capacity_advisory_v1_continuation_current(value.organization_id,value)
   THEN 'capacity_advisory_continuation_pending' ELSE 'capacity_advisory_continuation_stale' END;
 RETURN jsonb_build_object('state',state_value,'id',value.id,'predecessorOriginId',value.predecessor_origin_id,
  'periodStart',value.period_start,'periodEnd',value.period_end,'activationDeadline',value.activation_deadline,
  'originId',CASE WHEN state_value='capacity_advisory_continuation_activated' THEN event_value.origin_id ELSE NULL END,
  'refreshRequired',state_value IN('capacity_advisory_continuation_missed','capacity_advisory_continuation_stale'),
  'valuesWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',replayed_value);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_reserve(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 predecessor_value UUID,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;predecessor public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 decision_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 old public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;now_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR predecessor_value IS NULL
  OR reason_value IS NULL OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR confirmation_value<>'m26-capacity-advisory-continuation-v1' THEN
  RAISE EXCEPTION 'Capacity advisory continuation request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 request_hash:=public.canonical_completion_digest(jsonb_build_object('predecessorOriginId',predecessor_value,
  'reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-continuation-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_continuations_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash OR public.canonical_forecast_capacity_advisory_v1_continuation_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory continuation replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(old,TRUE);END IF;
 SELECT * INTO predecessor FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=predecessor_value;
 IF predecessor.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_origin_current(org,predecessor) IS NOT TRUE THEN
  RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 decision_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,predecessor.id);
 IF decision_value.id IS NULL OR decision_value.action<>'approve' THEN
  RAISE EXCEPTION 'Approved capacity advice unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1
  WHERE organization_id=org AND id=predecessor.epoch_id;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 IF epoch_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE
  OR now_value>=predecessor.horizon_ends_at THEN
  RAISE EXCEPTION 'Prospective continuation unavailable' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
   WHERE value.organization_id=org AND value.predecessor_origin_id=predecessor.id) THEN
  RAISE EXCEPTION 'Capacity advisory continuation already reserved' USING ERRCODE='40001';END IF;
 INSERT INTO public.canonical_forecast_capacity_advisory_continuations_v1(
  organization_id,predecessor_origin_id,epoch_id,period_start,period_end,activation_deadline,review_manifest,
  actor_id,membership_id,session_id,actor_role,reason,confirmation_version,idempotency_key_hash,request_digest,reserved_at,digest)
 VALUES(org,predecessor.id,epoch_value.id,predecessor.horizon_ends_at,
  predecessor.horizon_ends_at+INTERVAL '2592000 seconds',predecessor.horizon_ends_at+INTERVAL '1 hour',
  epoch_value.review_manifest,actor,(authority->>'membershipId')::uuid,session_value,actor_role,btrim(reason_value),
  confirmation_value,key_hash,request_hash,now_value,public.canonical_completion_digest(jsonb_build_object(
   'organizationId',org,'predecessorOriginId',predecessor.id,'epochId',epoch_value.id,
   'periodStart',predecessor.horizon_ends_at,'periodEnd',predecessor.horizon_ends_at+INTERVAL '2592000 seconds',
   'activationDeadline',predecessor.horizon_ends_at+INTERVAL '1 hour','reviewManifest',epoch_value.review_manifest,
   'actorId',actor,'sessionId',session_value,'requestDigest',request_hash))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(inserted,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_read(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
BEGIN
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_capacity_advisory_continuations_v1
  WHERE organization_id=org AND id=id_value;
 IF value.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(
 org UUID,value public.canonical_forecast_capacity_advisory_reviews_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_authority UUID;
BEGIN
 IF value.review_kind NOT IN('demand','outcome_demand') OR value.action<>'approve'
  OR public.canonical_forecast_capacity_advisory_v1_demand_valid(value.definition,value.review_kind) IS NOT TRUE
  OR value.alternative_key IS DISTINCT FROM value.definition->>'alternativeKey'
  OR value.source_identity->>'periodAuthorityId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR value.source_identity->>'effectiveStart' IS NULL OR value.source_identity->>'effectiveEnd' IS NULL
  OR (value.source_identity->>'effectiveEnd')::timestamptz<>(value.source_identity->>'effectiveStart')::timestamptz+INTERVAL '2592000 seconds'
  OR value.source_digest<>public.canonical_completion_digest(value.source_identity) THEN RETURN FALSE;END IF;
 period_authority:=(value.source_identity->>'periodAuthorityId')::uuid;
 RETURN NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_reviews_v1 newer
  WHERE newer.organization_id=org AND newer.review_kind=value.review_kind
   AND newer.alternative_key=value.alternative_key AND newer.subject_id IS NOT DISTINCT FROM value.subject_id
   AND newer.revision>value.revision
   AND newer.source_identity->>'periodAuthorityId'=period_authority::text);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_review_historical_current(
 org UUID,value public.canonical_forecast_capacity_advisory_reviews_v1)
RETURNS BOOLEAN LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value.review_kind='demand'
  AND public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(org,value)
$$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_manifest_pinned(
 org UUID,saved_manifest JSONB,backlog_rows JSONB,constraint_input JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE alternative_value TEXT;saved_item JSONB;review_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 basis JSONB;result_value JSONB:='[]'::jsonb;alternative_count INTEGER:=0;
BEGIN
 IF jsonb_typeof(saved_manifest)<>'array' OR jsonb_typeof(backlog_rows)<>'array'
  OR jsonb_typeof(constraint_input)<>'object' THEN
  RAISE EXCEPTION 'Pinned capacity advisory demand population unavailable' USING ERRCODE='22023';END IF;
 FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
  SELECT entry INTO saved_item FROM jsonb_array_elements(saved_manifest) entries(entry)
   WHERE entry->>'alternativeKey'=alternative_value;
  IF saved_item IS NULL OR NOT public.canonical_field_evidence_object_keys_exact(
    saved_item,ARRAY['alternativeKey','reviewId','revision','digest','definition','basisDigest']) THEN
   RAISE EXCEPTION 'Pinned capacity advisory demand allocation unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO review_value FROM public.canonical_forecast_capacity_advisory_reviews_v1
   WHERE organization_id=org AND id=(saved_item->>'reviewId')::uuid;
  IF review_value.id IS NULL OR review_value.review_kind<>'demand'
   OR review_value.alternative_key IS DISTINCT FROM alternative_value
   OR review_value.revision<>(saved_item->>'revision')::bigint OR rtrim(review_value.digest) IS DISTINCT FROM saved_item->>'digest'
   OR review_value.definition IS DISTINCT FROM saved_item->'definition'
   OR public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(org,review_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Pinned capacity advisory demand allocation stale' USING ERRCODE='22023';END IF;
  basis:=public.canonical_forecast_capacity_advisory_v1_demand_basis(
   org,'demand',alternative_value,review_value.definition,backlog_rows,constraint_input);
  IF public.canonical_completion_digest(basis) IS DISTINCT FROM saved_item->>'basisDigest'
   OR (review_value.source_identity-ARRAY['sourceCutoff','periodAuthorityId','effectiveStart','effectiveEnd',
      'correctionOfReviewId','correctionGeneration','observedAt','continuationId']::text[]) IS DISTINCT FROM basis THEN
   RAISE EXCEPTION 'Pinned capacity advisory demand source changed' USING ERRCODE='22023';END IF;
  result_value:=result_value||jsonb_build_array(saved_item);alternative_count:=alternative_count+1;
 END LOOP;
 IF alternative_count<>jsonb_array_length(saved_manifest) THEN
  RAISE EXCEPTION 'Pinned capacity advisory demand population differs' USING ERRCODE='22023';END IF;
 RETURN result_value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(
 org UUID,kind_value TEXT,subject_value UUID,period_authority UUID,backlog_rows JSONB,constraint_input JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE alternative_value TEXT;review_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 result_value JSONB:='[]'::jsonb;basis JSONB;authority_count INTEGER;
BEGIN
 IF kind_value NOT IN('demand','outcome_demand') OR jsonb_typeof(backlog_rows)<>'array'
  OR jsonb_typeof(constraint_input)<>'object' THEN
  RAISE EXCEPTION 'Capacity advisory demand population unavailable' USING ERRCODE='22023';END IF;
 FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
  IF period_authority IS NULL THEN
   review_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,kind_value,alternative_value,NULL,NULL,subject_value);
  ELSE
   SELECT count(DISTINCT source_identity->>'periodAuthorityId') INTO authority_count
    FROM public.canonical_forecast_capacity_advisory_reviews_v1
    WHERE organization_id=org AND review_kind=kind_value AND alternative_key=alternative_value
     AND subject_id IS NOT DISTINCT FROM subject_value AND source_identity->>'periodAuthorityId'=period_authority::text;
   IF authority_count<>1 THEN RAISE EXCEPTION 'Capacity advisory period allocation ambiguous' USING ERRCODE='22023';END IF;
   SELECT * INTO review_value FROM public.canonical_forecast_capacity_advisory_reviews_v1
    WHERE organization_id=org AND review_kind=kind_value AND alternative_key=alternative_value
     AND subject_id IS NOT DISTINCT FROM subject_value AND source_identity->>'periodAuthorityId'=period_authority::text
    ORDER BY revision DESC LIMIT 1;
  END IF;
  IF review_value.id IS NULL OR review_value.action<>'approve'
   OR public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(org,review_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Complete capacity advisory demand allocation unavailable' USING ERRCODE='22023';END IF;
  basis:=public.canonical_forecast_capacity_advisory_v1_demand_basis(
   org,kind_value,alternative_value,review_value.definition,backlog_rows,constraint_input);
  result_value:=result_value||jsonb_build_array(jsonb_build_object('alternativeKey',alternative_value,
   'reviewId',review_value.id,'revision',review_value.revision,'digest',rtrim(review_value.digest),
   'definition',review_value.definition,'basisDigest',public.canonical_completion_digest(basis)));
 END LOOP;
 IF jsonb_array_length(result_value)=0 OR jsonb_array_length(result_value)>20
  OR octet_length(result_value::text)>262144 THEN
  RAISE EXCEPTION 'Capacity advisory demand population exceeds bounds' USING ERRCODE='54000';END IF;
 RETURN result_value;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_manifest(
 org UUID,kind_value TEXT,subject_value UUID,backlog_rows JSONB,constraint_input JSONB)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(
  org,kind_value,subject_value,CASE WHEN kind_value='outcome_demand' THEN subject_value ELSE NULL END,
  backlog_rows,constraint_input)
$$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_workload_capture(
 org UUID,value public.canonical_forecast_capacity_advisory_continuations_v1)
RETURNS public.canonical_forecast_workload_capacity_origins_v1 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch_value public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 method_value public.canonical_forecast_workload_capacity_methods_v1%ROWTYPE;
 review_value public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 current_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 inserted_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 first_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 second_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 old public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 inserted public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 method_ids JSONB:='[]'::jsonb;window_ids JSONB;input_value JSONB;results_value JSONB;
 evidence_value JSONB;counts_value JSONB;window_key_hash TEXT;window_request_hash TEXT;
 window_digest TEXT;window_start_value TIMESTAMPTZ;window_end_value TIMESTAMPTZ;window_index INTEGER;
 key_hash TEXT:=encode(sha256(convert_to(value.id::text||':accepted-p5a-origin','UTF8')),'hex');
 request_hash TEXT;source_hash TEXT;output_hash TEXT;digest_value TEXT;now_value TIMESTAMPTZ;
 accepted_minutes NUMERIC;backlog_minutes NUMERIC;capacity_minutes NUMERIC;
BEGIN
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 IF now_value<value.period_start OR now_value>value.activation_deadline THEN
  RAISE EXCEPTION 'Continuation boundary is unavailable' USING ERRCODE='22023';END IF;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','part5c_continuation_origin',
  'continuationId',value.id,'cutoff',value.period_start,'horizon',value.period_end));
 SELECT * INTO old FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND actor_user_id=value.actor_id AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF old.request_digest<>request_hash OR old.prediction_cutoff_at<>value.period_start OR old.horizon_ends_at<>value.period_end
   OR public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Continuation workload replay conflict' USING ERRCODE='40001';END IF;
  RETURN old;END IF;
 SELECT * INTO epoch_value FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF epoch_value.id IS NULL OR epoch_value.installed_at>value.period_start-INTERVAL '5184000 seconds' THEN
  RAISE EXCEPTION 'Prospective workload history incomplete' USING ERRCODE='22023';END IF;
 FOR method_value IN SELECT * FROM public.canonical_forecast_workload_capacity_methods_v1 ORDER BY target_key LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND review_kind='method' AND target_key=method_value.target_key
   ORDER BY revision DESC LIMIT 1;
  IF review_value.id IS NULL OR review_value.action<>'approve' OR review_value.source_digest<>
   public.canonical_completion_digest(public.canonical_forecast_workload_capacity_v1_review_source(
    org,'method',method_value.target_key,NULL,NULL)) THEN
   RAISE EXCEPTION 'Approved workload method unavailable' USING ERRCODE='22023';END IF;
  method_ids:=method_ids||jsonb_build_array(jsonb_build_object('id',review_value.id,
   'target',review_value.target_key,'revision',review_value.revision,'digest',rtrim(review_value.digest)));
 END LOOP;
 FOR window_index IN 1..2 LOOP
  window_start_value:=value.period_start-((3-window_index)*INTERVAL '2592000 seconds');
  window_end_value:=window_start_value+INTERVAL '2592000 seconds';
  evidence_value:=public.canonical_forecast_workload_capacity_v1_window_evidence(org,window_start_value,window_end_value);
  counts_value:=jsonb_build_object('labor',(evidence_value#>>'{labor,count}')::bigint,
   'backlog',(evidence_value#>>'{backlog,count}')::bigint,'capacity',(evidence_value#>>'{capacity,count}')::bigint);
  SELECT * INTO current_window FROM public.canonical_forecast_workload_capacity_windows_v1
   WHERE organization_id=org AND window_start=window_start_value AND window_end=window_end_value
   ORDER BY revision DESC LIMIT 1;
  IF current_window.id IS NOT NULL
   AND current_window.epoch_id=epoch_value.id
   AND current_window.source_digest=evidence_value->>'digest'
   AND public.canonical_forecast_workload_capacity_v1_window_current(org,current_window) THEN
   -- Reuse an exact current accepted Part 5A certification. Appending an
   -- identical overlapping revision would incorrectly retire the predecessor
   -- origin that owns the same training window.
   inserted_window:=current_window;
  ELSE
   window_key_hash:=encode(sha256(convert_to(value.id::text||':training-window:'||window_index::text,'UTF8')),'hex');
   window_request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','continuation_training_window',
    'continuationId',value.id,'index',window_index,'start',window_start_value,'end',window_end_value));
   window_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,
    'windowStart',window_start_value,'windowEnd',window_end_value,'revision',COALESCE(current_window.revision,0)+1,
    'epochId',epoch_value.id,'sourceDigest',evidence_value->>'digest','continuationId',value.id));
   INSERT INTO public.canonical_forecast_workload_capacity_windows_v1(
    organization_id,window_start,window_end,revision,previous_id,capacity_role,epoch_id,source_counts,evidence,
    source_digest,actor_user_id,auth_session_id,reason,request_key_hash,request_digest,finalized_at,digest)
   VALUES(org,window_start_value,window_end_value,COALESCE(current_window.revision,0)+1,current_window.id,
    evidence_value#>>'{capacity,declaredRole}',epoch_value.id,counts_value,evidence_value,evidence_value->>'digest',
    value.actor_id,value.session_id,'Reserved Part 5C continuation authorizes this exact completed training window.',
    window_key_hash,window_request_hash,now_value,window_digest) RETURNING * INTO inserted_window;
  END IF;
  IF window_index=1 THEN first_window:=inserted_window;ELSE second_window:=inserted_window;END IF;
 END LOOP;
 window_ids:=jsonb_build_array(jsonb_build_object('id',first_window.id,'digest',rtrim(first_window.digest)),
  jsonb_build_object('id',second_window.id,'digest',rtrim(second_window.digest)));
 input_value:=public.canonical_forecast_workload_capacity_v1_origin_input(org,value.period_start,value.period_end);
 IF first_window.capacity_role<>second_window.capacity_role OR
  first_window.capacity_role<>input_value#>>'{capacity,declaredRole}' THEN
  RAISE EXCEPTION 'Declared capacity role changed' USING ERRCODE='40001';END IF;
 accepted_minutes:=((first_window.evidence#>>'{labor,personMinutes}')::numeric+
  (second_window.evidence#>>'{labor,personMinutes}')::numeric)/2;
 backlog_minutes:=(input_value#>>'{backlog,scheduledPersonMinutes}')::numeric+
  (input_value#>>'{backlog,unscheduledPersonMinutes}')::numeric;
 capacity_minutes:=(input_value#>>'{capacity,availablePersonMinutes}')::numeric;
 results_value:=jsonb_build_object('workload.accepted_person_hours.v1',round(accepted_minutes/60,6),
  'workload.end_backlog_hours.v1',round(backlog_minutes/60,6),
  'capacity.available_role_hours.v1',round(capacity_minutes/60,6),
  'scheduledBacklogHours',round((input_value#>>'{backlog,scheduledPersonMinutes}')::numeric/60,6),
  'unscheduledBacklogHours',round((input_value#>>'{backlog,unscheduledPersonMinutes}')::numeric/60,6));
 IF octet_length(method_ids::text)+octet_length(window_ids::text)+octet_length(input_value::text)+
  octet_length(results_value::text)>262144 THEN
  RAISE EXCEPTION 'Workload origin evidence exceeds bound' USING ERRCODE='54000';END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object('epoch',epoch_value.digest,'methods',method_ids,
  'training',window_ids,'inputDigest',input_value->>'digest','continuationId',value.id));
 output_hash:=public.canonical_completion_digest(results_value);
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'cutoff',value.period_start,
  'horizon',value.period_end,'sourceDigest',source_hash,'outputDigest',output_hash,'continuationId',value.id));
 INSERT INTO public.canonical_forecast_workload_capacity_origins_v1(
  organization_id,prediction_cutoff_at,horizon_ends_at,capacity_role,epoch_id,method_review_ids,training_window_ids,
  input_evidence,private_results,source_digest,output_digest,actor_user_id,auth_session_id,
  request_key_hash,request_digest,digest)
 VALUES(org,value.period_start,value.period_end,input_value#>>'{capacity,declaredRole}',epoch_value.id,method_ids,
  window_ids,input_value,results_value,source_hash,output_hash,value.actor_id,value.session_id,key_hash,request_hash,
  digest_value) RETURNING * INTO inserted;
 RETURN inserted;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_source_v2(
 org UUID,kind_value TEXT,alternative_value TEXT,scope_value TEXT,role_value TEXT,subject_value UUID,
 definition_value JSONB,new_review_id UUID,continuation_value UUID,correction_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base JSONB;continuation_row public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 corrected public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;cutoff_value TIMESTAMPTZ;
 period_authority UUID;effective_start TIMESTAMPTZ;effective_end TIMESTAMPTZ;generation_value BIGINT:=1;
 now_value TIMESTAMPTZ:=public.canonical_forecast_workload_capacity_v1_clock();
BEGIN
 IF kind_value NOT IN('demand','outcome_demand') THEN
  IF continuation_value IS NOT NULL OR correction_value IS NOT NULL THEN
   RAISE EXCEPTION 'Capacity advisory review period identity invalid' USING ERRCODE='22023';END IF;
  RETURN public.canonical_forecast_capacity_advisory_v1_review_source(
   org,kind_value,alternative_value,scope_value,role_value,subject_value,definition_value);
 END IF;
 IF continuation_value IS NOT NULL AND (kind_value<>'demand' OR correction_value IS NOT NULL) THEN
  RAISE EXCEPTION 'Capacity advisory continuation review identity invalid' USING ERRCODE='22023';END IF;
 IF correction_value IS NOT NULL THEN
  SELECT * INTO corrected FROM public.canonical_forecast_capacity_advisory_reviews_v1
   WHERE organization_id=org AND id=correction_value;
  IF corrected.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
  IF corrected.review_kind<>kind_value OR corrected.alternative_key IS DISTINCT FROM alternative_value
   OR corrected.scope_key IS DISTINCT FROM scope_value OR corrected.role_name IS DISTINCT FROM role_value
   OR corrected.subject_id IS DISTINCT FROM subject_value OR corrected.action<>'approve'
   OR public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(org,corrected) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory correction target unavailable' USING ERRCODE='40001';END IF;
  period_authority:=(corrected.source_identity->>'periodAuthorityId')::uuid;
  effective_start:=(corrected.source_identity->>'effectiveStart')::timestamptz;
  effective_end:=(corrected.source_identity->>'effectiveEnd')::timestamptz;
  generation_value:=COALESCE((corrected.source_identity->>'correctionGeneration')::bigint,1)+1;
 ELSIF continuation_value IS NOT NULL THEN
  SELECT * INTO continuation_row FROM public.canonical_forecast_capacity_advisory_continuations_v1
   WHERE organization_id=org AND id=continuation_value;
  IF continuation_row.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
  IF public.canonical_forecast_capacity_advisory_v1_continuation_current(org,continuation_row) IS NOT TRUE
   OR now_value<continuation_row.period_start OR now_value>continuation_row.activation_deadline THEN
   RAISE EXCEPTION 'Capacity advisory continuation review unavailable' USING ERRCODE='40001';END IF;
  period_authority:=continuation_row.id;effective_start:=continuation_row.period_start;effective_end:=continuation_row.period_end;
 ELSE
  period_authority:=CASE WHEN kind_value='outcome_demand' THEN subject_value ELSE new_review_id END;
  IF kind_value='outcome_demand' THEN
   SELECT prediction_cutoff_at,horizon_ends_at INTO effective_start,effective_end
    FROM public.canonical_forecast_capacity_advisory_origins_v1 WHERE organization_id=org AND id=subject_value;
   IF effective_start IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
  ELSE effective_start:=now_value;effective_end:=now_value+INTERVAL '2592000 seconds';END IF;
 END IF;
 cutoff_value:=CASE WHEN kind_value='outcome_demand' THEN effective_end ELSE effective_start END;
 base:=public.canonical_forecast_capacity_advisory_v1_demand_source(
  org,kind_value,alternative_value,subject_value,definition_value,cutoff_value);
 RETURN base||jsonb_build_object('sourceCutoff',cutoff_value,'periodAuthorityId',period_authority,
  'effectiveStart',effective_start,'effectiveEnd',effective_end,'correctionOfReviewId',correction_value,
  'correctionGeneration',generation_value,'observedAt',now_value,'continuationId',continuation_value);
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,kind_value TEXT,
 alternative_value TEXT,scope_value TEXT,role_value TEXT,subject_value UUID,action_value TEXT,expected_revision BIGINT,
 expected_digest TEXT,definition_value JSONB,reason_value TEXT,confirmation_value TEXT,
 continuation_value UUID,correction_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 current_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;source_value JSONB;
 outcome_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;new_id UUID:=gen_random_uuid();
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;now_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR kind_value NOT IN('method','policy','demand','outcome_demand')
  OR action_value NOT IN('approve','reject','withdraw') OR expected_revision<0
  OR ((expected_revision=0) IS DISTINCT FROM (expected_digest='none'))
  OR (expected_revision>0 AND expected_digest!~'^[0-9a-f]{64}$') OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR reason_value IS NULL OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-capacity-advisory-review-v1'
  OR (kind_value='method' AND (alternative_value IS NOT NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL OR subject_value IS NOT NULL
     OR definition_value<>jsonb_build_object('methodVersion','m26-capacity-advisory-five-category-v1')))
  OR (kind_value='policy' AND (subject_value IS NOT NULL OR public.canonical_forecast_capacity_advisory_v1_policy_valid(definition_value) IS NOT TRUE))
  OR (kind_value='demand' AND (subject_value IS NOT NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL
    OR public.canonical_forecast_capacity_advisory_v1_demand_valid(definition_value,kind_value) IS NOT TRUE))
  OR (kind_value='outcome_demand' AND (subject_value IS NULL OR scope_value IS NOT NULL OR role_value IS NOT NULL
    OR public.canonical_forecast_capacity_advisory_v1_demand_valid(definition_value,kind_value) IS NOT TRUE
    OR (definition_value->>'originId')::uuid<>subject_value))
  OR (kind_value NOT IN('demand','outcome_demand') AND (continuation_value IS NOT NULL OR correction_value IS NOT NULL))
  OR (continuation_value IS NOT NULL AND (kind_value<>'demand' OR correction_value IS NOT NULL)) THEN
  RAISE EXCEPTION 'Capacity advisory review request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 IF kind_value='outcome_demand' THEN
  SELECT * INTO outcome_origin FROM public.canonical_forecast_capacity_advisory_origins_v1
   WHERE organization_id=org AND id=subject_value;
  IF outcome_origin.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
  IF correction_value IS NULL AND public.canonical_forecast_capacity_advisory_v1_origin_current(org,outcome_origin) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory origin stale' USING ERRCODE='40001';END IF;
 END IF;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind',kind_value,'alternative',alternative_value,
  'scope',scope_value,'role',role_value,'subjectId',subject_value,'action',action_value,'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'definition',definition_value,'reason',btrim(reason_value),'confirmation',confirmation_value,
  'continuationId',continuation_value,'correctionOfReviewId',correction_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_reviews_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  current_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
   org,old.review_kind,old.alternative_key,old.scope_key,old.role_name,old.subject_id);
  IF old.request_digest<>request_hash OR current_value.id IS DISTINCT FROM old.id
   OR (old.action='approve' AND public.canonical_forecast_capacity_advisory_v1_review_is_current(org,old) IS NOT TRUE) THEN
   RAISE EXCEPTION 'Capacity advisory review replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','capacity_advisory_review_recorded','id',old.id,'kind',old.review_kind,
   'alternativeKey',old.alternative_key,'scopeKey',old.scope_key,'role',old.role_name,'subjectId',old.subject_id,'action',old.action,
   'revision',old.revision,'digest',rtrim(old.digest),'replayed',TRUE);END IF;
 current_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
  org,kind_value,alternative_value,scope_value,role_value,subject_value);
 IF COALESCE(current_value.revision,0)<>expected_revision OR COALESCE(rtrim(current_value.digest),'none')<>expected_digest THEN
  RAISE EXCEPTION 'Capacity advisory review revision conflict' USING ERRCODE='40001';END IF;
 IF action_value='withdraw' AND continuation_value IS NULL AND correction_value IS NULL THEN
  IF current_value.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory review unavailable' USING ERRCODE='22023';END IF;
  source_value:=current_value.source_identity;
 ELSE
  source_value:=public.canonical_forecast_capacity_advisory_v1_review_source_v2(org,kind_value,alternative_value,
   scope_value,role_value,subject_value,definition_value,new_id,continuation_value,correction_value);
 END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 INSERT INTO public.canonical_forecast_capacity_advisory_reviews_v1(
  organization_id,id,review_kind,alternative_key,scope_key,role_name,subject_id,revision,previous_id,action,definition,
  source_identity,source_digest,reason,confirmation_version,actor_id,membership_id,session_id,idempotency_key_hash,
  request_digest,decided_at,digest)
 VALUES(org,new_id,kind_value,alternative_value,scope_value,role_value,subject_value,expected_revision+1,current_value.id,
  action_value,definition_value,source_value,public.canonical_completion_digest(source_value),btrim(reason_value),confirmation_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,now_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'id',new_id,'kind',kind_value,
   'alternative',alternative_value,'scope',scope_value,'role',role_value,'subjectId',subject_value,
   'revision',expected_revision+1,'action',action_value,'definition',definition_value,'source',source_value,'decidedAt',now_value)))
 RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','capacity_advisory_review_recorded','id',inserted.id,'kind',inserted.review_kind,
  'alternativeKey',inserted.alternative_key,'scopeKey',inserted.scope_key,'role',inserted.role_name,
  'subjectId',inserted.subject_id,'action',inserted.action,'revision',inserted.revision,
 'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

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
  base_source:=value.source_identity-ARRAY['sourceCutoff','periodAuthorityId','effectiveStart','effectiveEnd',
   'correctionOfReviewId','correctionGeneration','observedAt','continuationId']::text[];
  RETURN source_value=base_source;
 END IF;
 source_value:=public.canonical_forecast_capacity_advisory_v1_review_source(org,value.review_kind,
  value.alternative_key,value.scope_key,value.role_name,value.subject_id,value.definition);
 RETURN value.source_digest=public.canonical_completion_digest(source_value);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(
 org UUID,value public.canonical_forecast_capacity_advisory_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 current_constraint JSONB;current_policy JSONB;
BEGIN
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1
  WHERE organization_id=org AND id=value.epoch_id;
 IF epoch_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE THEN RETURN FALSE;END IF;
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(value.input_manifest#>>'{workloadOrigin,id}')::uuid;
 IF workload_origin.id IS NULL OR rtrim(workload_origin.digest) IS DISTINCT FROM value.input_manifest#>>'{workloadOrigin,digest}'
  OR workload_origin.prediction_cutoff_at IS DISTINCT FROM value.prediction_cutoff_at
  OR workload_origin.horizon_ends_at IS DISTINCT FROM value.horizon_ends_at
  OR public.canonical_forecast_workload_capacity_v1_origin_current(org,workload_origin) IS NOT TRUE
  OR public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(org,workload_origin) IS NOT TRUE THEN RETURN FALSE;END IF;
 current_constraint:=value.input_manifest->'constraintInput';
 IF public.canonical_forecast_capacity_advisory_v1_constraint_manifest_current(
  org,current_constraint,value.prediction_cutoff_at,value.horizon_ends_at) IS NOT TRUE THEN RETURN FALSE;END IF;
 current_policy:=public.canonical_forecast_capacity_advisory_v1_policy_manifest(org,value.prediction_cutoff_at);
 RETURN value.input_manifest->>'constraintDigest'=public.canonical_completion_digest(current_constraint)
  AND value.input_manifest->>'policyDigest'=public.canonical_completion_digest(current_policy);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

-- Activated continuation currentness deliberately checks only the resulting
-- origin's non-demand authority here. The period demand review itself names
-- this continuation, so calling full origin_current would create a circular
-- currentness dependency. Full origin reads still require both halves.
CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_current(
 org UUID,value public.canonical_forecast_capacity_advisory_continuations_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 predecessor public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 decision_value public.canonical_forecast_capacity_advisory_decisions_v1%ROWTYPE;
 event_value public.canonical_forecast_capacity_advisory_continuation_events_v1%ROWTYPE;
 origin_value public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
BEGIN
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1
  WHERE organization_id=org AND id=value.epoch_id;
 SELECT * INTO predecessor FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=value.predecessor_origin_id;
 decision_value:=public.canonical_forecast_capacity_advisory_v1_latest_decision(org,value.predecessor_origin_id);
 SELECT * INTO event_value FROM public.canonical_forecast_capacity_advisory_continuation_events_v1
  WHERE organization_id=org AND continuation_id=value.id;
 IF epoch_value.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE
  OR predecessor.id IS NULL OR decision_value.id IS NULL OR decision_value.action<>'approve' THEN RETURN FALSE;END IF;
 IF event_value.id IS NULL THEN RETURN public.canonical_forecast_capacity_advisory_v1_origin_current(org,predecessor);END IF;
 IF event_value.event_kind<>'activated' OR event_value.origin_id IS NULL THEN RETURN FALSE;END IF;
 SELECT * INTO origin_value FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=event_value.origin_id;
 RETURN origin_value.id IS NOT NULL AND origin_value.input_manifest->>'continuationId'=value.id::text
  AND origin_value.prediction_cutoff_at=value.period_start AND origin_value.horizon_ends_at=value.period_end
  AND public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(org,origin_value);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_origin_input_demand_current(
 org UUID,value public.canonical_forecast_capacity_advisory_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;current_demand JSONB;
BEGIN
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(value.input_manifest#>>'{workloadOrigin,id}')::uuid;
 IF workload_origin.id IS NULL THEN RETURN FALSE;END IF;
 current_demand:=public.canonical_forecast_capacity_advisory_v1_demand_manifest_pinned(org,
  value.input_manifest->'demands',workload_origin.input_evidence#>'{backlog,rows}',value.input_manifest->'constraintInput');
 RETURN value.input_manifest->>'demandDigest'=public.canonical_completion_digest(current_demand);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_demand_manifest_corrected(
 org UUID,saved_manifest JSONB,backlog_rows JSONB,constraint_input JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved_item JSONB;saved_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 latest_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;basis JSONB;result_value JSONB:='[]'::jsonb;
BEGIN
 FOR saved_item IN SELECT entry FROM jsonb_array_elements(saved_manifest) entries(entry)
  ORDER BY entry->>'alternativeKey' LOOP
  SELECT * INTO saved_review FROM public.canonical_forecast_capacity_advisory_reviews_v1
   WHERE organization_id=org AND id=(saved_item->>'reviewId')::uuid;
  IF saved_review.id IS NULL OR saved_review.source_identity->>'periodAuthorityId' IS NULL THEN
   RAISE EXCEPTION 'Capacity advisory correction authority unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO latest_review FROM public.canonical_forecast_capacity_advisory_reviews_v1
   WHERE organization_id=org AND review_kind='demand' AND alternative_key=saved_review.alternative_key
    AND source_identity->>'periodAuthorityId'=saved_review.source_identity->>'periodAuthorityId'
   ORDER BY revision DESC LIMIT 1;
  IF latest_review.id IS NULL OR latest_review.action<>'approve'
   OR public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(org,latest_review) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory corrected demand unavailable' USING ERRCODE='22023';END IF;
  basis:=public.canonical_forecast_capacity_advisory_v1_demand_basis(org,'demand',latest_review.alternative_key,
   latest_review.definition,backlog_rows,constraint_input);
  result_value:=result_value||jsonb_build_array(jsonb_build_object('alternativeKey',latest_review.alternative_key,
   'reviewId',latest_review.id,'revision',latest_review.revision,'digest',rtrim(latest_review.digest),
   'definition',latest_review.definition,'basisDigest',public.canonical_completion_digest(basis)));
 END LOOP;
 IF jsonb_array_length(result_value)<>jsonb_array_length(saved_manifest) THEN
  RAISE EXCEPTION 'Capacity advisory corrected demand population differs' USING ERRCODE='22023';END IF;
 RETURN result_value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_origin_capture_v2(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,reason_value TEXT,
 confirmation_value TEXT,correction_origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;target public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 current_generation public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 demand_manifest JSONB;results_value JSONB;input_value JSONB;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
 old public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;now_value TIMESTAMPTZ;
BEGIN
 IF correction_origin_value IS NULL THEN
  RETURN public.canonical_forecast_capacity_advisory_v1_origin_capture(
   org,actor,actor_role,session_value,csrf,key_value,reason_value,confirmation_value);END IF;
 IF current_setting('transaction_isolation')<>'serializable' OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR reason_value IS NULL
  OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-capacity-advisory-origin-v1' THEN
  RAISE EXCEPTION 'Capacity advisory origin request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 request_hash:=public.canonical_completion_digest(jsonb_build_object('reason',btrim(reason_value),'confirmation',confirmation_value,
  'correctionOriginId',correction_origin_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF old.request_digest<>request_hash OR public.canonical_forecast_capacity_advisory_v1_origin_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity advisory origin replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_capacity_advisory_v1_origin_projection(old,'capacity_advisory_origin_saved',TRUE,NULL);END IF;
 SELECT * INTO target FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=correction_origin_value;
 IF target.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(org,target) IS NOT TRUE
  OR public.canonical_forecast_capacity_advisory_v1_origin_input_demand_current(org,target) IS TRUE THEN
  RAISE EXCEPTION 'Capacity advisory correction origin unavailable' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-period:'||org||':'||target.epoch_id||':'||
  target.prediction_cutoff_at||':'||target.horizon_ends_at,0));
 SELECT * INTO current_generation FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND epoch_id=target.epoch_id AND prediction_cutoff_at=target.prediction_cutoff_at
   AND horizon_ends_at=target.horizon_ends_at ORDER BY generation DESC LIMIT 1;
 IF current_generation.id IS DISTINCT FROM target.id THEN
  RAISE EXCEPTION 'Capacity advisory correction generation changed' USING ERRCODE='40001';END IF;
 SELECT * INTO workload_origin FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=(target.input_manifest#>>'{workloadOrigin,id}')::uuid;
 IF workload_origin.id IS NULL THEN RAISE EXCEPTION 'Accepted workload forecast unavailable' USING ERRCODE='22023';END IF;
 demand_manifest:=public.canonical_forecast_capacity_advisory_v1_demand_manifest_corrected(org,
  target.input_manifest->'demands',workload_origin.input_evidence#>'{backlog,rows}',target.input_manifest->'constraintInput');
 results_value:=public.canonical_forecast_capacity_advisory_v1_results(org,target.prediction_cutoff_at,
  target.horizon_ends_at,target.prediction_cutoff_at,target.input_manifest->'constraintInput',
  target.input_manifest->'policies',demand_manifest,workload_origin.private_results);
 input_value:=target.input_manifest||jsonb_build_object('demands',demand_manifest,
  'demandDigest',public.canonical_completion_digest(demand_manifest),'correctionOfOriginId',target.id);
 IF octet_length(input_value::text)+octet_length(results_value::text)>524288 THEN
  RAISE EXCEPTION 'Capacity advisory evidence exceeds bounds' USING ERRCODE='54000';END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 INSERT INTO public.canonical_forecast_capacity_advisory_origins_v1(
  organization_id,epoch_id,prediction_cutoff_at,horizon_ends_at,generation,previous_id,input_manifest,private_results,
  scope_count,actor_id,membership_id,session_id,idempotency_key_hash,request_digest,captured_at,digest)
 VALUES(org,target.epoch_id,target.prediction_cutoff_at,target.horizon_ends_at,target.generation+1,target.id,
  input_value,results_value,jsonb_array_length(results_value),actor,(authority->>'membershipId')::uuid,session_value,key_hash,
  request_hash,now_value,public.canonical_completion_digest(jsonb_build_object('organizationId',org,'epochId',target.epoch_id,
   'cutoff',target.prediction_cutoff_at,'end',target.horizon_ends_at,'generation',target.generation+1,
   'previousId',target.id,'inputDigest',public.canonical_completion_digest(input_value),
   'outputDigest',public.canonical_completion_digest(results_value)))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_capacity_advisory_v1_origin_projection(inserted,'capacity_advisory_origin_saved',FALSE,NULL);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_advisory_v1_outcome_current(
 org UUID,value public.canonical_forecast_capacity_advisory_outcomes_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE origin_row public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 epoch_value public.canonical_forecast_capacity_advisory_epochs_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 workload_results JSONB;constraint_input JSONB;historical_input JSONB;demand_manifest JSONB;results_value JSONB;
BEGIN
 SELECT * INTO origin_row FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND id=value.origin_id;
 SELECT * INTO epoch_value FROM public.canonical_forecast_capacity_advisory_epochs_v1
  WHERE organization_id=org AND id=origin_row.epoch_id;
 IF origin_row.id IS NULL OR public.canonical_forecast_capacity_advisory_v1_epoch_current(org,epoch_value) IS NOT TRUE
  OR public.canonical_forecast_capacity_advisory_v1_origin_input_demand_current(org,origin_row) IS NOT TRUE
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_origins_v1 newer
    WHERE newer.organization_id=org AND newer.epoch_id=origin_row.epoch_id
     AND newer.prediction_cutoff_at=origin_row.prediction_cutoff_at
     AND newer.horizon_ends_at=origin_row.horizon_ends_at AND newer.generation>origin_row.generation) THEN RETURN FALSE;END IF;
 SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND id=(value.source_manifest->>'workloadEvaluationId')::uuid;
 IF workload_evaluation.id IS NULL OR rtrim(workload_evaluation.digest) IS DISTINCT FROM value.source_manifest->>'workloadEvaluationDigest'
  OR public.canonical_forecast_capacity_advisory_v1_workload_evaluation_historical_current(org,workload_evaluation) IS NOT TRUE THEN RETURN FALSE;END IF;
 SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND id=workload_evaluation.outcome_window_id;
 workload_results:=jsonb_build_object(
  'workload.end_backlog_hours.v1',workload_evaluation.private_metrics#>'{workload.end_backlog_hours.v1,actual}');
 constraint_input:=origin_row.input_manifest->'constraintInput';
 historical_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
  org,origin_row.horizon_ends_at,origin_row.prediction_cutoff_at);
 demand_manifest:=public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(
  org,'outcome_demand',origin_row.id,origin_row.id,workload_window.evidence#>'{backlog,rows}',historical_input);
 results_value:=public.canonical_forecast_capacity_advisory_v1_results(org,origin_row.prediction_cutoff_at,
  origin_row.horizon_ends_at,origin_row.horizon_ends_at,constraint_input,origin_row.input_manifest->'policies',
  demand_manifest,workload_results);
 RETURN value.private_results=results_value AND value.source_manifest->>'resultDigest'=public.canonical_completion_digest(results_value)
  AND value.source_manifest->>'constraintDigest'=public.canonical_completion_digest(constraint_input)
  AND value.source_manifest->>'historicalConstraintDigest'=public.canonical_completion_digest(historical_input)
  AND value.source_manifest->>'demandDigest'=public.canonical_completion_digest(demand_manifest)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_outcomes_v1 newer
   WHERE newer.organization_id=org AND newer.origin_id=value.origin_id AND newer.revision>value.revision);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_due(limit_value INTEGER DEFAULT 25)
RETURNS TABLE(organization_id UUID,continuation_id UUID) LANGUAGE SQL VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value.organization_id,value.id FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
 WHERE value.period_start<=public.canonical_forecast_workload_capacity_v1_clock()
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_capacity_advisory_continuation_events_v1 event_value
   WHERE event_value.organization_id=value.organization_id AND event_value.continuation_id=value.id)
 ORDER BY value.period_start,value.id LIMIT LEAST(GREATEST(limit_value,1),25)
$$;

CREATE FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_activate(org UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 event_value public.canonical_forecast_capacity_advisory_continuation_events_v1%ROWTYPE;
 predecessor_evaluation public.canonical_forecast_capacity_advisory_evaluations_v1%ROWTYPE;
 workload_origin public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 inserted public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 authority JSONB;constraint_input JSONB;policy_manifest JSONB;demand_manifest JSONB;results_value JSONB;input_value JSONB;
 provisional_input JSONB;now_value TIMESTAMPTZ;generation_value BIGINT;previous_value UUID;
 request_hash TEXT;key_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable transaction required' USING ERRCODE='25001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-continuation:'||org||':'||id_value,0));
 SELECT * INTO value FROM public.canonical_forecast_capacity_advisory_continuations_v1
  WHERE organization_id=org AND id=id_value;
 IF value.id IS NULL THEN RAISE EXCEPTION 'Capacity advisory receipt unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO event_value FROM public.canonical_forecast_capacity_advisory_continuation_events_v1
  WHERE organization_id=org AND continuation_id=value.id;
 IF event_value.id IS NOT NULL THEN RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,TRUE);END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 IF now_value<value.period_start THEN RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);END IF;
 IF now_value>value.activation_deadline THEN
  INSERT INTO public.canonical_forecast_capacity_advisory_continuation_events_v1(
   organization_id,continuation_id,event_kind,origin_id,observed_at,detail_code,digest)
  VALUES(org,value.id,'missed',NULL,now_value,'activation_deadline_missed',
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'continuationId',value.id,
    'event','missed','observedAt',now_value))) RETURNING * INTO event_value;
  RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(
  org,value.actor_id,value.actor_role,value.session_id,NULL,FALSE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,value.actor_id,value.actor_role,value.session_id,NULL,FALSE);
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 IF now_value>value.activation_deadline THEN
  INSERT INTO public.canonical_forecast_capacity_advisory_continuation_events_v1(
   organization_id,continuation_id,event_kind,origin_id,observed_at,detail_code,digest)
  VALUES(org,value.id,'missed',NULL,now_value,'activation_deadline_missed',
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'continuationId',value.id,
    'event','missed','observedAt',now_value))) RETURNING * INTO event_value;
  RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);END IF;
 IF public.canonical_forecast_capacity_advisory_v1_continuation_current(org,value) IS NOT TRUE THEN
  INSERT INTO public.canonical_forecast_capacity_advisory_continuation_events_v1(
   organization_id,continuation_id,event_kind,origin_id,observed_at,detail_code,digest)
  VALUES(org,value.id,'retired',NULL,now_value,'source_authority_retired',
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'continuationId',value.id,
    'event','retired','observedAt',now_value))) RETURNING * INTO event_value;
  RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);END IF;
 SELECT * INTO predecessor_evaluation FROM public.canonical_forecast_capacity_advisory_evaluations_v1
  WHERE organization_id=org AND origin_id=value.predecessor_origin_id ORDER BY revision DESC LIMIT 1;
 IF predecessor_evaluation.id IS NULL
  OR public.canonical_forecast_capacity_advisory_v1_evaluation_current(org,predecessor_evaluation) IS NOT TRUE THEN
  RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);END IF;
 -- Validate every period-dependent human/source input before the first child
 -- write. A missing rereview leaves the reservation pending and the transaction
 -- side-effect free so the worker may retry before the immutable deadline.
 provisional_input:=public.canonical_forecast_workload_capacity_v1_origin_input(org,value.period_start,value.period_end);
 constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,value.period_start);
 policy_manifest:=public.canonical_forecast_capacity_advisory_v1_policy_manifest(org,value.period_start);
 demand_manifest:=public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(org,'demand',NULL,value.id,
  provisional_input#>'{backlog,rows}',constraint_input);
 workload_origin:=public.canonical_forecast_capacity_advisory_v1_continuation_workload_capture(org,value);
 IF workload_origin.id IS NULL OR workload_origin.prediction_cutoff_at<>value.period_start
  OR workload_origin.horizon_ends_at<>value.period_end
  OR workload_origin.input_evidence->>'digest'<>provisional_input->>'digest'
  OR public.canonical_forecast_capacity_advisory_v1_workload_origin_historical_current(org,workload_origin) IS NOT TRUE THEN
  RAISE EXCEPTION 'Continuation workload authority changed' USING ERRCODE='40001';END IF;
 results_value:=public.canonical_forecast_capacity_advisory_v1_results(org,value.period_start,value.period_end,
  value.period_start,constraint_input,policy_manifest,demand_manifest,workload_origin.private_results);
 input_value:=jsonb_build_object('constraintInput',constraint_input,
  'constraintDigest',public.canonical_completion_digest(constraint_input),'policies',policy_manifest,
  'policyDigest',public.canonical_completion_digest(policy_manifest),'demands',demand_manifest,
  'demandDigest',public.canonical_completion_digest(demand_manifest),'continuationId',value.id,
  'workloadOrigin',jsonb_build_object('id',workload_origin.id,'digest',rtrim(workload_origin.digest),
   'capacityRole',workload_origin.capacity_role,'cutoff',workload_origin.prediction_cutoff_at,
   'horizon',workload_origin.horizon_ends_at));
 IF octet_length(input_value::text)+octet_length(results_value::text)>524288 THEN
  RAISE EXCEPTION 'Capacity advisory evidence exceeds bounds' USING ERRCODE='54000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-period:'||org||':'||value.epoch_id||':'||
  value.period_start||':'||value.period_end,0));
 SELECT COALESCE(max(generation),0)+1,(array_agg(id ORDER BY generation DESC))[1]
  INTO generation_value,previous_value FROM public.canonical_forecast_capacity_advisory_origins_v1
  WHERE organization_id=org AND epoch_id=value.epoch_id AND prediction_cutoff_at=value.period_start
   AND horizon_ends_at=value.period_end;
 IF generation_value<>1 THEN RAISE EXCEPTION 'Continuation period generation conflict' USING ERRCODE='40001';END IF;
 key_hash:=encode(sha256(convert_to(value.id::text||':capacity-advisory-origin','UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('continuationId',value.id,
  'predecessorOriginId',value.predecessor_origin_id,'periodStart',value.period_start,'periodEnd',value.period_end));
 INSERT INTO public.canonical_forecast_capacity_advisory_origins_v1(
  organization_id,epoch_id,prediction_cutoff_at,horizon_ends_at,generation,previous_id,input_manifest,private_results,
  scope_count,actor_id,membership_id,session_id,idempotency_key_hash,request_digest,captured_at,digest)
 VALUES(org,value.epoch_id,value.period_start,value.period_end,1,NULL,input_value,results_value,
  jsonb_array_length(results_value),value.actor_id,value.membership_id,value.session_id,key_hash,request_hash,now_value,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'epochId',value.epoch_id,
   'cutoff',value.period_start,'end',value.period_end,'generation',1,'previousId',NULL,
   'inputDigest',public.canonical_completion_digest(input_value),'outputDigest',public.canonical_completion_digest(results_value),
   'continuationId',value.id))) RETURNING * INTO inserted;
 INSERT INTO public.canonical_forecast_capacity_advisory_continuation_events_v1(
  organization_id,continuation_id,event_kind,origin_id,observed_at,detail_code,digest)
 VALUES(org,value.id,'activated',inserted.id,now_value,'activated',
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'continuationId',value.id,
   'event','activated','originId',inserted.id,'observedAt',now_value)));
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,value.actor_id,value.actor_role,value.session_id,NULL,FALSE);
 RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);
EXCEPTION WHEN SQLSTATE '22023' THEN
 RETURN public.canonical_forecast_capacity_advisory_v1_continuation_projection(value,FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_advisory_v1_lock_sources(org UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-advisory-source:'||org,0));
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 PERFORM 1 FROM public.canonical_forecast_capacity_advisory_reviews_v1 WHERE organization_id=org FOR SHARE;
 PERFORM 1 FROM public.canonical_forecast_capacity_advisory_epochs_v1 WHERE organization_id=org FOR SHARE;
 PERFORM 1 FROM public.canonical_forecast_capacity_advisory_continuations_v1 WHERE organization_id=org FOR SHARE;
 PERFORM 1 FROM public.canonical_forecast_capacity_advisory_continuation_events_v1 WHERE organization_id=org FOR SHARE;
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_capacity_advisory_continuations_v1,
 public.canonical_forecast_capacity_advisory_continuation_events_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION
 public.canonical_forecast_capacity_advisory_v1_continuation_current(uuid,public.canonical_forecast_capacity_advisory_continuations_v1),
 public.canonical_forecast_capacity_advisory_v1_continuation_projection(public.canonical_forecast_capacity_advisory_continuations_v1,boolean),
 public.canonical_forecast_capacity_advisory_v1_continuation_workload_capture(uuid,public.canonical_forecast_capacity_advisory_continuations_v1),
 public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(uuid,public.canonical_forecast_capacity_advisory_reviews_v1),
 public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(uuid,text,uuid,uuid,jsonb,jsonb),
 public.canonical_forecast_capacity_advisory_v1_review_source_v2(uuid,text,text,text,text,uuid,jsonb,uuid,uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(uuid,public.canonical_forecast_capacity_advisory_origins_v1),
 public.canonical_forecast_capacity_advisory_v1_origin_input_demand_current(uuid,public.canonical_forecast_capacity_advisory_origins_v1),
 public.canonical_forecast_capacity_advisory_v1_demand_manifest_corrected(uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION
 public.canonical_forecast_capacity_advisory_v1_continuation_reserve(uuid,uuid,text,uuid,text,text,uuid,text,text),
 public.canonical_forecast_capacity_advisory_v1_continuation_read(uuid,uuid,text,uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(uuid,uuid,text,uuid,text,text,text,text,text,text,uuid,text,bigint,text,jsonb,text,text,uuid,uuid),
 public.canonical_forecast_capacity_advisory_v1_origin_capture_v2(uuid,uuid,text,uuid,text,text,text,text,uuid),
 public.canonical_forecast_capacity_advisory_v1_continuation_due(integer),
 public.canonical_forecast_capacity_advisory_v1_continuation_activate(uuid,uuid) FROM PUBLIC;

DO $$ DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_capacity_advisory_continuations_v1,public.canonical_forecast_capacity_advisory_continuation_events_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_advisory_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,text,text,uuid,text,bigint,text,jsonb,text,text),public.canonical_forecast_capacity_advisory_v1_continuation_current(uuid,public.canonical_forecast_capacity_advisory_continuations_v1),public.canonical_forecast_capacity_advisory_v1_continuation_projection(public.canonical_forecast_capacity_advisory_continuations_v1,boolean),public.canonical_forecast_capacity_advisory_v1_continuation_workload_capture(uuid,public.canonical_forecast_capacity_advisory_continuations_v1),public.canonical_forecast_capacity_advisory_v1_review_period_historical_current(uuid,public.canonical_forecast_capacity_advisory_reviews_v1),public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(uuid,text,uuid,uuid,jsonb,jsonb),public.canonical_forecast_capacity_advisory_v1_review_source_v2(uuid,text,text,text,text,uuid,jsonb,uuid,uuid,uuid),public.canonical_forecast_capacity_advisory_v1_origin_non_demand_current(uuid,public.canonical_forecast_capacity_advisory_origins_v1),public.canonical_forecast_capacity_advisory_v1_origin_input_demand_current(uuid,public.canonical_forecast_capacity_advisory_origins_v1),public.canonical_forecast_capacity_advisory_v1_demand_manifest_corrected(uuid,jsonb,jsonb,jsonb) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_capacity_advisory_v1_continuation_reserve(uuid,uuid,text,uuid,text,text,uuid,text,text),public.canonical_forecast_capacity_advisory_v1_continuation_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(uuid,uuid,text,uuid,text,text,text,text,text,text,uuid,text,bigint,text,jsonb,text,text,uuid,uuid),public.canonical_forecast_capacity_advisory_v1_origin_capture_v2(uuid,uuid,text,uuid,text,text,text,text,uuid),public.canonical_forecast_capacity_advisory_v1_continuation_due(integer),public.canonical_forecast_capacity_advisory_v1_continuation_activate(uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
