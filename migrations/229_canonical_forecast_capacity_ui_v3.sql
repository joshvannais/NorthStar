-- Mission 26 Part 5D correction v3: complete positive-work prerequisite
-- discovery and explicit source-derived human review.
--
-- This migration is additive.  It leaves every accepted Part 5A/B/C row and
-- every migration through 228 unchanged.  Private helpers retain job,
-- workforce, asset and numeric evidence inside PostgreSQL.  The guarded v3
-- projection exposes only fixed copy and an opaque purpose-bound token.

CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_remaining_plan(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 work_item RECORD;plan_value public.canonical_forecast_current_backlog_person_plan_reviews%ROWTYPE;
 completion_value public.canonical_completion_records%ROWTYPE;
 review_value public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 source_value JSONB;entries_value JSONB:='[]'::jsonb;needs_review BOOLEAN:=FALSE;
 census_count INTEGER:=0;
BEGIN
 SELECT count(*) INTO census_count FROM (
  WITH accepted AS (
   SELECT DISTINCT event_value.assignment_id,event_value.appointment_id
   FROM public.canonical_forecast_schedule_booking_events event_value
   WHERE event_value.organization_id=org
    AND event_value.transition_kind='accepted_booking' AND event_value.occurred_at<cutoff_value
  ),latest AS (
   SELECT DISTINCT ON(event_value.assignment_id) event_value.*
   FROM public.canonical_forecast_schedule_booking_events event_value
   JOIN accepted USING(assignment_id,appointment_id)
   WHERE event_value.organization_id=org AND event_value.occurred_at<cutoff_value
   ORDER BY event_value.assignment_id,event_value.occurred_at DESC,event_value.source_order DESC
  ) SELECT 1 FROM latest WHERE appointment_status<>'cancelled') bounded;
 IF census_count>500 THEN
  RAISE EXCEPTION 'Accepted work census exceeds bound' USING ERRCODE='54000';
 END IF;

 FOR work_item IN
  WITH accepted AS (
   SELECT DISTINCT event_value.assignment_id,event_value.appointment_id
   FROM public.canonical_forecast_schedule_booking_events event_value
   WHERE event_value.organization_id=org
    AND event_value.transition_kind='accepted_booking' AND event_value.occurred_at<cutoff_value
  ),latest AS (
   SELECT DISTINCT ON(event_value.assignment_id) event_value.*
   FROM public.canonical_forecast_schedule_booking_events event_value
   JOIN accepted USING(assignment_id,appointment_id)
   WHERE event_value.organization_id=org AND event_value.occurred_at<cutoff_value
   ORDER BY event_value.assignment_id,event_value.occurred_at DESC,event_value.source_order DESC
  ) SELECT appointment_id,assignment_id FROM latest
     WHERE appointment_status<>'cancelled' ORDER BY appointment_id
 LOOP
  SELECT value.* INTO completion_value FROM public.canonical_completion_records value
   WHERE value.organization_id=org AND value.assignment_id=work_item.assignment_id
    AND value.record_kind<>'proposal' AND value.decided_at<cutoff_value
   ORDER BY value.decided_at DESC,value.id DESC LIMIT 1;
  IF completion_value.id IS NOT NULL AND completion_value.lifecycle_after='completed' THEN
   CONTINUE;
  END IF;
  SELECT value.* INTO plan_value FROM public.canonical_forecast_current_backlog_person_plan_reviews value
   WHERE value.organization_id=org AND value.appointment_id=work_item.appointment_id
    AND value.created_at<cutoff_value ORDER BY value.revision DESC LIMIT 1;
  IF plan_value.id IS NULL OR plan_value.action<>'approve'
     OR public.canonical_forecast_backlog_person_plan_stale(plan_value) THEN
   RETURN jsonb_build_object('state','unavailable','entries','[]'::jsonb,
    'marker',jsonb_build_object('state','person_plan_unavailable'));
  END IF;
  source_value:=public.canonical_forecast_workload_capacity_v1_review_source(
   org,'remaining_work','workload.end_backlog_hours.v1',work_item.appointment_id,NULL);
  SELECT value.* INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='remaining_work'
    AND value.target_key='workload.end_backlog_hours.v1'
    AND value.subject_id=work_item.appointment_id ORDER BY value.revision DESC LIMIT 1;
  IF review_value.id IS NULL OR review_value.action<>'approve'
     OR review_value.remaining_person_minutes IS DISTINCT FROM plan_value.planned_person_minutes
     OR review_value.source_digest IS DISTINCT FROM public.canonical_completion_digest(source_value) THEN
   needs_review:=TRUE;
  END IF;
  entries_value:=entries_value||jsonb_build_array(jsonb_build_object(
   'appointmentId',work_item.appointment_id,'remainingPersonMinutes',plan_value.planned_person_minutes,
   'expectedRevision',COALESCE(review_value.revision,0),
   'expectedDigest',COALESCE(rtrim(review_value.digest),'none'),
   'needsReview',review_value.id IS NULL OR review_value.action<>'approve'
     OR review_value.remaining_person_minutes IS DISTINCT FROM plan_value.planned_person_minutes
     OR review_value.source_digest IS DISTINCT FROM public.canonical_completion_digest(source_value)));
 END LOOP;
 IF octet_length(entries_value::text)>262144 THEN
  RAISE EXCEPTION 'Remaining work review census exceeds bound' USING ERRCODE='54000';
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN needs_review THEN 'ready' ELSE 'complete' END,
  'entries',entries_value,'marker',jsonb_build_object('kind','remaining_work',
   'source',public.canonical_completion_digest(entries_value)));
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN
 RETURN jsonb_build_object('state','unavailable','entries','[]'::jsonb,
  'marker',jsonb_build_object('state','remaining_work_unavailable'));
END $$;

-- Build the complete per-job review population from the bounded accepted-work
-- census and the source-backed formations reviewed above.  The returned plan
-- is private: the public projection receives only a fixed label and token.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_job_plan(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 census_value JSONB;work_item JSONB;alternative_value TEXT;assignment_value public.canonical_schedule_assignments%ROWTYPE;
 scope_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 current_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 definition_value JSONB;source_value JSONB;entries_value JSONB:='[]'::jsonb;
 match_count INTEGER;needs_review BOOLEAN:=FALSE;planned_count INTEGER:=0;
BEGIN
 census_value:=public.canonical_forecast_constrained_capacity_v1_work_census(org,cutoff_value);
 IF (census_value->>'count')::int>500 THEN
  RAISE EXCEPTION 'Accepted work census exceeds bound' USING ERRCODE='54000';END IF;
 FOR work_item IN SELECT entry FROM jsonb_array_elements(census_value->'rows') entries(entry)
  ORDER BY entry->>'appointmentId',entry->>'assignmentId' LOOP
  SELECT * INTO assignment_value FROM public.canonical_schedule_assignments value
   WHERE value.organization_id=org AND value.id=(work_item->>'assignmentId')::uuid
    AND value.appointment_id=(work_item->>'appointmentId')::uuid;
  IF assignment_value.id IS NULL OR
     (assignment_value.workforce_profile_id IS NULL)=(assignment_value.workforce_crew_id IS NULL) THEN
   RAISE EXCEPTION 'Accepted work formation unavailable' USING ERRCODE='22023';END IF;
  FOR alternative_value IN SELECT DISTINCT value.definition->>'alternativeKey'
   FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
    AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
      WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
      ORDER BY latest.revision DESC LIMIT 1)
    AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,value)
   ORDER BY 1 LOOP
   SELECT count(*) INTO match_count
   FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
    AND value.definition->>'alternativeKey'=alternative_value
    AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
      WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
      ORDER BY latest.revision DESC LIMIT 1)
    AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,value)
    AND ((assignment_value.workforce_profile_id IS NOT NULL AND EXISTS(
       SELECT 1 FROM jsonb_array_elements(value.definition->'crewAssignments') assigned
       WHERE assigned->>'profileId'=assignment_value.workforce_profile_id::text))
      OR (assignment_value.workforce_crew_id IS NOT NULL
       AND value.definition->'crewIds' ? assignment_value.workforce_crew_id::text));
   IF match_count<>1 THEN
    RAISE EXCEPTION 'Accepted work scope mapping unavailable' USING ERRCODE='22023';END IF;
   SELECT * INTO scope_value
   FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
    AND value.definition->>'alternativeKey'=alternative_value
    AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
      WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
      ORDER BY latest.revision DESC LIMIT 1)
    AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,value)
    AND ((assignment_value.workforce_profile_id IS NOT NULL AND EXISTS(
       SELECT 1 FROM jsonb_array_elements(value.definition->'crewAssignments') assigned
       WHERE assigned->>'profileId'=assignment_value.workforce_profile_id::text))
      OR (assignment_value.workforce_crew_id IS NOT NULL
       AND value.definition->'crewIds' ? assignment_value.workforce_crew_id::text));
   definition_value:=jsonb_build_object(
    'alternativeKey',alternative_value,'scopeKey',scope_value.scope_key,
    'appointmentId',work_item->>'appointmentId','assignmentId',work_item->>'assignmentId',
    'crewApplicable',scope_value.definition#>'{applicability,crew}',
    'skillApplicable',scope_value.definition#>'{applicability,skill}',
    'workingHoursApplicable',scope_value.definition#>'{applicability,workingHours}',
    'locationApplicable',scope_value.definition#>'{applicability,location}',
    'travelApplicable',scope_value.definition#>'{applicability,travel}',
    'vehicleApplicable',scope_value.definition#>'{applicability,vehicle}',
    'equipmentApplicable',scope_value.definition#>'{applicability,equipment}',
    'locationKey',CASE WHEN (scope_value.definition#>>'{applicability,location}')::boolean
      THEN COALESCE((SELECT value.job_scope->>'locationId' FROM public.canonical_opportunities value
       WHERE value.organization_id=org AND value.id=assignment_value.opportunity_id),'not_applicable')
      ELSE 'not_applicable' END,
    'previousLocationKey','not_applicable','nextLocationKey','not_applicable',
    'vehicleAssetIds',scope_value.definition->'vehicleAssetIds',
    'equipmentAssetIds',scope_value.definition->'equipmentAssetIds',
    'equipmentBasis',jsonb_build_object('kind',CASE WHEN (scope_value.definition#>>'{applicability,equipment}')::boolean
      THEN 'part5b_owner_reviewed' ELSE 'not_applicable' END,'receiptId',NULL,'digest',NULL),
    'readinessBasis',jsonb_build_object('kind',CASE WHEN (scope_value.definition#>>'{applicability,equipment}')::boolean
      THEN 'part5b_owner_reviewed' ELSE 'not_applicable' END,'receiptId',NULL,'digest',NULL),
    'travelBasis',jsonb_build_object('kind',CASE WHEN (scope_value.definition#>>'{applicability,travel}')::boolean
      THEN 'part5b_owner_reviewed' ELSE 'not_applicable' END,'receiptId',NULL,'digest',NULL));
   IF public.canonical_forecast_constrained_capacity_v1_definition_valid('job',definition_value) IS NOT TRUE THEN
    RAISE EXCEPTION 'Source-derived job constraint definition invalid' USING ERRCODE='22023';END IF;
   source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(
    org,'job',scope_value.scope_key,(work_item->>'appointmentId')::uuid,definition_value);
   current_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
    org,'job',scope_value.scope_key,(work_item->>'appointmentId')::uuid);
   entries_value:=entries_value||jsonb_build_array(jsonb_build_object(
    'scopeKey',scope_value.scope_key,'subjectId',work_item->>'appointmentId','definition',definition_value,
    'expectedRevision',COALESCE(current_value.revision,0),
    'expectedDigest',COALESCE(rtrim(current_value.digest),'none'),
    'needsReview',current_value.id IS NULL OR current_value.action<>'approve'
      OR current_value.definition IS DISTINCT FROM definition_value
      OR public.canonical_forecast_constrained_capacity_v1_job_review_covers(org,current_value,cutoff_value) IS NOT TRUE));
   needs_review:=needs_review OR current_value.id IS NULL OR current_value.action<>'approve'
    OR current_value.definition IS DISTINCT FROM definition_value
    OR public.canonical_forecast_constrained_capacity_v1_job_review_covers(org,current_value,cutoff_value) IS NOT TRUE;
   planned_count:=planned_count+1;
  END LOOP;
 END LOOP;
 IF (census_value->>'count')::int>0 AND planned_count=0 THEN
  RAISE EXCEPTION 'Accepted work alternatives unavailable' USING ERRCODE='22023';END IF;
 IF planned_count>1000 OR octet_length(entries_value::text)>1048576 THEN
  RAISE EXCEPTION 'Job constraint review census exceeds bound' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('state',CASE WHEN needs_review THEN 'ready' ELSE 'complete' END,
  'entries',entries_value,'marker',jsonb_build_object('kind','accepted_job_constraints',
   'source',public.canonical_completion_digest(jsonb_build_object('census',census_value,'entries',entries_value))));
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN
 RETURN jsonb_build_object('state','unavailable','entries','[]'::jsonb,
  'marker',jsonb_build_object('state','job_constraint_unavailable'));
END $$;

-- Derive the complete hidden allocation from the exact Part 5A backlog rows
-- and the accepted Part 5B job/scope census.  No caller supplies an identity,
-- minute value, applicability choice or manifest.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_demand_definition(
 org UUID,alternative_value TEXT,constraint_input JSONB,kind_value TEXT,
 origin_value UUID,backlog_rows JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 scope_item JSONB;scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 backlog_item JSONB;job_item JSONB;applicability JSONB:='[]'::jsonb;allocations JSONB:='[]'::jsonb;
 definition_value JSONB;match_count INTEGER;target_seats INTEGER;support_roles JSONB;operator_roles JSONB;
BEGIN
 IF kind_value NOT IN('demand','outcome_demand') OR jsonb_typeof(backlog_rows)<>'array'
    OR jsonb_typeof(constraint_input)<>'object' THEN
  RAISE EXCEPTION 'Demand allocation source unavailable' USING ERRCODE='22023';END IF;
 FOR scope_item IN SELECT value FROM jsonb_array_elements(constraint_input->'scopes') value
  WHERE value->>'alternativeKey'=alternative_value ORDER BY value->>'scopeKey' LOOP
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.id=(scope_item->>'reviewId')::uuid;
  IF scope_review.id IS NULL THEN
   RAISE EXCEPTION 'Demand scope authority unavailable' USING ERRCODE='22023';END IF;
  IF (scope_review.definition#>>'{applicability,crew}')::boolean THEN
   SELECT (entry->>'count')::int INTO target_seats
    FROM jsonb_array_elements(scope_review.definition->'crewRoleRequirements') entry
    WHERE entry->>'role'=scope_review.definition->>'role';
  ELSE target_seats:=1;END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('role',entry->>'role','count',(entry->>'count')::int)
    ORDER BY entry->>'role'),'[]'::jsonb) INTO support_roles
   FROM jsonb_array_elements(scope_review.definition->'crewRoleRequirements') entry
   WHERE entry->>'role'<>scope_review.definition->>'role';
  SELECT COALESCE(jsonb_agg(DISTINCT assigned->>'role' ORDER BY assigned->>'role'),'[]'::jsonb)
   INTO operator_roles FROM jsonb_array_elements(scope_review.definition->'crewAssignments') assigned
   WHERE assigned->>'profileId' IN(SELECT operator_value#>>'{}'
     FROM jsonb_array_elements(scope_review.definition->'operatorProfileIds') operator_value);
  applicability:=applicability||jsonb_build_array(jsonb_build_object(
   'scopeKey',scope_review.scope_key,'targetRole',scope_review.definition->>'role',
   'targetSeats',target_seats,'supportRoles',support_roles,'operatorRoles',operator_roles));
 END LOOP;
 FOR backlog_item IN SELECT entry FROM jsonb_array_elements(backlog_rows) entries(entry)
  WHERE (entry->>'personMinutes')::numeric>0 ORDER BY entry->>'appointmentId',entry->>'assignmentId' LOOP
  SELECT count(*),(array_agg(value ORDER BY value->>'scopeKey'))[1] INTO match_count,job_item
   FROM jsonb_array_elements(constraint_input->'jobs') value
   WHERE value->>'alternativeKey'=alternative_value
    AND value->>'appointmentId'=backlog_item->>'appointmentId'
    AND value->>'assignmentId'=backlog_item->>'assignmentId';
  IF match_count<>1 OR job_item IS NULL THEN
   RAISE EXCEPTION 'Demand job allocation authority unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.scope_key=job_item->>'scopeKey'
   ORDER BY value.revision DESC LIMIT 1;
  IF scope_review.id IS NULL THEN
   RAISE EXCEPTION 'Demand role authority unavailable' USING ERRCODE='22023';END IF;
  allocations:=allocations||jsonb_build_array(jsonb_build_object(
   'appointmentId',backlog_item->>'appointmentId','assignmentId',backlog_item->>'assignmentId',
   'scopeKey',job_item->>'scopeKey','role',scope_review.definition->>'role',
   'personMinutes',(backlog_item->>'personMinutes')::bigint));
 END LOOP;
 definition_value:=jsonb_build_object(
  'methodVersion',CASE WHEN kind_value='demand' THEN 'm26-capacity-advisory-demand-allocation-v1'
    ELSE 'm26-capacity-advisory-outcome-allocation-v1' END,
  'alternativeKey',alternative_value,'scopeApplicability',applicability,'allocations',allocations);
 IF kind_value='outcome_demand' THEN
  definition_value:=definition_value||jsonb_build_object('originId',origin_value);END IF;
 PERFORM public.canonical_forecast_capacity_advisory_v1_demand_basis(
  org,kind_value,alternative_value,definition_value,backlog_rows,constraint_input);
 RETURN definition_value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_scope_plan(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 census_value JSONB;role_value TEXT;crew_value UUID;scope_key_value TEXT;definition_value JSONB;
 profiles_value JSONB;assignments_value JSONB;requirements_value JSONB;target_role TEXT;
 current_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 role_generation public.canonical_forecast_workload_capacity_role_generations_v1%ROWTYPE;
 workload_review public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 assigned_value JSONB;entry_needs_review BOOLEAN;scope_needs_review BOOLEAN;
 source_value JSONB;entries_value JSONB:='[]'::jsonb;needs_review BOOLEAN:=FALSE;
 planned_count INTEGER:=0;active_count INTEGER:=0;
BEGIN
 census_value:=public.canonical_forecast_constrained_capacity_v1_work_census(org,cutoff_value);
 IF (census_value->>'count')::int>500 THEN
  RAISE EXCEPTION 'Accepted work census exceeds bound' USING ERRCODE='54000';
 END IF;

 FOR role_value IN
  SELECT DISTINCT profile.operational_role
  FROM jsonb_array_elements(census_value->'rows') work(entry)
  JOIN public.canonical_schedule_assignments assignment_value
   ON assignment_value.organization_id=org AND assignment_value.id=(entry->>'assignmentId')::uuid
  JOIN public.workforce_profiles profile ON profile.organization_id=org
   AND profile.id=assignment_value.workforce_profile_id
  WHERE assignment_value.workforce_profile_id IS NOT NULL ORDER BY profile.operational_role
 LOOP
  SELECT COALESCE(jsonb_agg(value.profile_id ORDER BY value.profile_id),'[]'::jsonb),
         COALESCE(jsonb_agg(jsonb_build_object('profileId',value.profile_id,'crewId',NULL,
          'role',role_value) ORDER BY value.profile_id),'[]'::jsonb)
   INTO profiles_value,assignments_value
  FROM (SELECT DISTINCT assignment_value.workforce_profile_id::text profile_id
    FROM jsonb_array_elements(census_value->'rows') work(entry)
    JOIN public.canonical_schedule_assignments assignment_value
     ON assignment_value.organization_id=org AND assignment_value.id=(entry->>'assignmentId')::uuid
    JOIN public.workforce_profiles profile ON profile.organization_id=org
     AND profile.id=assignment_value.workforce_profile_id
    WHERE assignment_value.workforce_profile_id IS NOT NULL
     AND profile.operational_role=role_value) value;
  scope_key_value:='accepted_profile_'||role_value;
  definition_value:=jsonb_build_object(
   'alternativeKey','accepted_team','scopeKey',scope_key_value,'role',role_value,
   'applicability',jsonb_build_object('crew',FALSE,'skill',FALSE,'workingHours',TRUE,
    'location',FALSE,'travel',FALSE,'vehicle',FALSE,'equipment',FALSE),
   'crewIds','[]'::jsonb,'crewRoleRequirements','[]'::jsonb,'crewAssignments',assignments_value,
   'skillIds','[]'::jsonb,'locationKey','not_applicable','travelPairs','[]'::jsonb,
   'vehicleAssetIds','[]'::jsonb,'equipmentAssetIds','[]'::jsonb,
   'operatorProfileIds','[]'::jsonb,'assetAssignments','[]'::jsonb,
   'assetRequirements',jsonb_build_object('vehiclePerSeat',0,'equipmentPerSeat',0),
   'assetCalendars','[]'::jsonb);
  IF public.canonical_forecast_constrained_capacity_v1_definition_valid('scope',definition_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Source-derived profile scope invalid' USING ERRCODE='22023';
  END IF;
  source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(
   org,'scope',scope_key_value,NULL,definition_value);
  current_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
   org,'scope',scope_key_value,NULL);
  scope_needs_review:=current_value.id IS NULL OR current_value.action<>'approve'
    OR current_value.definition IS DISTINCT FROM definition_value
    OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,current_value) IS NOT TRUE;
  entry_needs_review:=scope_needs_review;
  FOR assigned_value IN SELECT entry FROM jsonb_array_elements(assignments_value) entries(entry) LOOP
   SELECT DISTINCT ON(value.profile_id) value.* INTO role_generation
    FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
    WHERE value.organization_id=org AND value.profile_id=(assigned_value->>'profileId')::uuid
    ORDER BY value.profile_id,value.source_order DESC;
   IF role_generation.profile_id IS NULL OR role_generation.present IS NOT TRUE
      OR role_generation.membership_status<>'active' OR role_generation.account_status<>'active'
      OR role_generation.operational_role IS DISTINCT FROM role_value THEN
    RAISE EXCEPTION 'Source-derived profile authority unavailable' USING ERRCODE='22023';END IF;
   source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,role_value);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='role_qualification'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   entry_needs_review:=entry_needs_review OR workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(source_value);
   source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='availability_basis'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   entry_needs_review:=entry_needs_review OR workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(source_value);
  END LOOP;
  entries_value:=entries_value||jsonb_build_array(jsonb_build_object(
   'scopeKey',scope_key_value,'definition',definition_value,
   'expectedRevision',COALESCE(current_value.revision,0),
   'expectedDigest',COALESCE(rtrim(current_value.digest),'none'),
   'scopeNeedsReview',scope_needs_review,'needsReview',entry_needs_review));
  needs_review:=needs_review OR entry_needs_review;
 END LOOP;

 FOR crew_value IN
  SELECT DISTINCT assignment_value.workforce_crew_id
  FROM jsonb_array_elements(census_value->'rows') work(entry)
  JOIN public.canonical_schedule_assignments assignment_value
   ON assignment_value.organization_id=org AND assignment_value.id=(entry->>'assignmentId')::uuid
  WHERE assignment_value.workforce_crew_id IS NOT NULL ORDER BY assignment_value.workforce_crew_id
 LOOP
  SELECT min(profile.operational_role),
    COALESCE(jsonb_agg(jsonb_build_object('profileId',member.profile_id,'crewId',crew_value,
      'role',profile.operational_role) ORDER BY member.profile_id),'[]'::jsonb)
   INTO target_role,assignments_value
  FROM public.workforce_crew_members member
  JOIN public.workforce_profiles profile ON profile.organization_id=member.organization_id
   AND profile.id=member.profile_id
  WHERE member.organization_id=org AND member.crew_id=crew_value;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('role',grouped.operational_role,'count',grouped.member_count)
    ORDER BY grouped.operational_role),'[]'::jsonb) INTO requirements_value
  FROM (SELECT profile.operational_role,count(*)::int member_count
    FROM public.workforce_crew_members member
    JOIN public.workforce_profiles profile ON profile.organization_id=member.organization_id
     AND profile.id=member.profile_id
    WHERE member.organization_id=org AND member.crew_id=crew_value
    GROUP BY profile.operational_role) grouped;
  IF target_role IS NULL OR jsonb_array_length(assignments_value) NOT BETWEEN 1 AND 100
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(requirements_value) entry
       WHERE (entry->>'count')::int>99) THEN
   RAISE EXCEPTION 'Source-derived crew formation unavailable' USING ERRCODE='22023';
  END IF;
  scope_key_value:='accepted_crew_'||substr(encode(sha256(convert_to(crew_value::text,'UTF8')),'hex'),1,16);
  definition_value:=jsonb_build_object(
   'alternativeKey','accepted_team','scopeKey',scope_key_value,'role',target_role,
   'applicability',jsonb_build_object('crew',TRUE,'skill',FALSE,'workingHours',TRUE,
    'location',FALSE,'travel',FALSE,'vehicle',FALSE,'equipment',FALSE),
   'crewIds',jsonb_build_array(crew_value),'crewRoleRequirements',requirements_value,
   'crewAssignments',assignments_value,'skillIds','[]'::jsonb,'locationKey','not_applicable',
   'travelPairs','[]'::jsonb,'vehicleAssetIds','[]'::jsonb,'equipmentAssetIds','[]'::jsonb,
   'operatorProfileIds','[]'::jsonb,'assetAssignments','[]'::jsonb,
   'assetRequirements',jsonb_build_object('vehiclePerSeat',0,'equipmentPerSeat',0),
   'assetCalendars','[]'::jsonb);
  IF public.canonical_forecast_constrained_capacity_v1_definition_valid('scope',definition_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Source-derived crew scope invalid' USING ERRCODE='22023';
  END IF;
  source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(
   org,'scope',scope_key_value,NULL,definition_value);
  current_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
   org,'scope',scope_key_value,NULL);
  scope_needs_review:=current_value.id IS NULL OR current_value.action<>'approve'
    OR current_value.definition IS DISTINCT FROM definition_value
    OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,current_value) IS NOT TRUE;
  entry_needs_review:=scope_needs_review;
  FOR assigned_value IN SELECT entry FROM jsonb_array_elements(assignments_value) entries(entry) LOOP
   SELECT DISTINCT ON(value.profile_id) value.* INTO role_generation
    FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
    WHERE value.organization_id=org AND value.profile_id=(assigned_value->>'profileId')::uuid
    ORDER BY value.profile_id,value.source_order DESC;
   IF role_generation.profile_id IS NULL OR role_generation.present IS NOT TRUE
      OR role_generation.membership_status<>'active' OR role_generation.account_status<>'active'
      OR role_generation.operational_role IS DISTINCT FROM assigned_value->>'role' THEN
    RAISE EXCEPTION 'Source-derived crew member authority unavailable' USING ERRCODE='22023';END IF;
   source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,
    role_generation.operational_role);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='role_qualification'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   entry_needs_review:=entry_needs_review OR workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(source_value);
   source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='availability_basis'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   entry_needs_review:=entry_needs_review OR workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(source_value);
  END LOOP;
  entries_value:=entries_value||jsonb_build_array(jsonb_build_object(
   'scopeKey',scope_key_value,'definition',definition_value,
   'expectedRevision',COALESCE(current_value.revision,0),
   'expectedDigest',COALESCE(rtrim(current_value.digest),'none'),
   'scopeNeedsReview',scope_needs_review,'needsReview',entry_needs_review));
  needs_review:=needs_review OR entry_needs_review;
 END LOOP;

 planned_count:=jsonb_array_length(entries_value);
 SELECT count(*) INTO active_count FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
   AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
    WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
    ORDER BY latest.revision DESC LIMIT 1)
   AND NOT (entries_value @> jsonb_build_array(jsonb_build_object('scopeKey',value.scope_key)));
 IF planned_count=0 OR planned_count+active_count>20 OR octet_length(entries_value::text)>262144 THEN
  RAISE EXCEPTION 'Source-derived scope population unavailable' USING ERRCODE='54000';
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN needs_review THEN 'ready' ELSE 'complete' END,
  'entries',entries_value,'marker',jsonb_build_object('kind','accepted_work_scopes',
   'source',public.canonical_completion_digest(jsonb_build_object('census',census_value,'entries',entries_value))));
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN
 RETURN jsonb_build_object('state','unavailable','entries','[]'::jsonb,
  'marker',jsonb_build_object('state','work_scope_unavailable'));
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_setup_plan(org UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 base_plan JSONB;private_plan JSONB;marker_value JSONB;now_value TIMESTAMPTZ;
 constraint_input JSONB;backlog_value JSONB;definitions_value JSONB:='[]'::jsonb;
 alternative_value TEXT;definition_value JSONB;
 advisory_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 constrained_epoch public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 constrained_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
BEGIN
 base_plan:=public.canonical_forecast_capacity_ui_v2_setup_plan(org);
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 -- Positive accepted work needs source-derived formations.  Do not create the
 -- v2 zero-work placeholder scope and then ask the user to repair it.
 IF base_plan->>'state'='ready' AND base_plan->>'action'='constrained_scope' THEN
  private_plan:=public.canonical_forecast_capacity_ui_v3_scope_plan(org,now_value);
  IF private_plan->>'state'='ready' THEN
   marker_value:=jsonb_build_object('action','constrained_work_scopes',
    'source',private_plan#>>'{marker,source}');
   RETURN jsonb_build_object('state','ready','action','constrained_work_scopes',
    'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Review source-backed work formations',
    'explanation','Approve the complete accepted-work formation set. Crew, skill, working hours, location, travel, vehicle and equipment remain separate dimensions.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  END IF;
 END IF;
 -- Build positive-work Part 5B authorities during the accepted Part 5A
 -- prospective wait.  Later qualification reviews would fall inside those
 -- immutable training windows and truthfully invalidate them.
 IF base_plan->>'state'='waiting' AND base_plan->>'lane'='workload' THEN
  SELECT * INTO constrained_epoch FROM public.canonical_forecast_constrained_capacity_epochs_v1 value
   WHERE value.organization_id=org ORDER BY value.revision DESC LIMIT 1;
  IF constrained_epoch.id IS NULL THEN
   marker_value:=jsonb_build_object('action','constrained_epoch',
    'workloadWait',base_plan#>>'{_source,epoch}');
   RETURN jsonb_build_object('state','ready','action','constrained_epoch',
    'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Start constrained-capacity coverage',
    'explanation','Install the source boundary for crew, skill, working hours, location, travel, vehicle and equipment evidence while prospective workload history builds.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  END IF;
  constrained_review:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
   org,'method',NULL,NULL);
  IF constrained_review.id IS NULL OR
     public.canonical_forecast_constrained_capacity_v1_review_is_current(org,constrained_review) IS NOT TRUE THEN
   marker_value:=jsonb_build_object('action','constrained_method','epoch',constrained_epoch.id,
    'previous',constrained_review.id,'revision',constrained_review.revision);
   RETURN jsonb_build_object('state','ready','action','constrained_method',
    'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Review constrained-capacity method',
    'explanation','Approve the accepted declared-role supply method before reviewing each source-backed work formation.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  END IF;
  private_plan:=public.canonical_forecast_capacity_ui_v3_scope_plan(org,now_value);
  IF private_plan->>'state'='ready' THEN
   marker_value:=jsonb_build_object('action','constrained_work_scopes',
    'source',private_plan#>>'{marker,source}');
   RETURN jsonb_build_object('state','ready','action','constrained_work_scopes',
    'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Review source-backed work formations',
    'explanation','Approve the complete accepted-work formation set. Crew, skill, working hours, location, travel, vehicle and equipment remain separate dimensions.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  ELSIF private_plan->>'state'='complete' THEN
   private_plan:=public.canonical_forecast_capacity_ui_v3_job_plan(org,now_value);
   IF private_plan->>'state'='ready' THEN
    marker_value:=jsonb_build_object('action','constrained_job_census',
     'source',private_plan#>>'{marker,source}');
    RETURN jsonb_build_object('state','ready','action','constrained_job_census',
     'token',public.canonical_completion_digest(marker_value),'lane','all',
     'label','Review every accepted work constraint',
     'explanation','Approve one source-backed job review for every accepted work item and alternative. The full census commits together or not at all.',
     'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
     '_source',marker_value);
   END IF;
  END IF;
 END IF;
 -- A corrected accepted-work source can make the previously finalized
 -- training windows historically incomplete.  Do not advertise a recovery
 -- origin until both exact prospective windows are source-complete again.
 IF base_plan->>'state'='complete' THEN
  BEGIN
   PERFORM public.canonical_forecast_workload_capacity_v1_window_evidence(
    org,now_value-INTERVAL '5184000 seconds',now_value-INTERVAL '2592000 seconds');
   PERFORM public.canonical_forecast_workload_capacity_v1_window_evidence(
    org,now_value-INTERVAL '2592000 seconds',now_value);
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0002' THEN
   RETURN jsonb_build_object('state','waiting','action',NULL,'token',NULL,'lane','workload',
    'label','Building corrected workload history',
    'explanation','The corrected accepted-work source needs two complete prospective periods before a recovery origin can be saved.',
    'reasonLimit',NULL,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',jsonb_build_object('state','corrected_history_incomplete'));
  END;
 END IF;
 IF base_plan->>'state'<>'unavailable' THEN RETURN base_plan;END IF;

 private_plan:=public.canonical_forecast_capacity_ui_v3_remaining_plan(org,now_value);
 IF private_plan->>'state'='ready' THEN
  marker_value:=jsonb_build_object('action','workload_remaining_census',
   'source',private_plan#>>'{marker,source}');
  RETURN jsonb_build_object('state','ready','action','workload_remaining_census',
   'token',public.canonical_completion_digest(marker_value),'lane','all',
   'label','Review the full remaining-work census',
   'explanation','Approve every source-backed unfinished-work amount in one bounded review. Private work identities and amounts stay hidden.',
   'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
   '_source',marker_value);
 END IF;
 IF private_plan->>'state'='unavailable' THEN RETURN base_plan;END IF;

 IF base_plan#>>'{_source,state}'='constrained_input_unavailable' THEN
  private_plan:=public.canonical_forecast_capacity_ui_v3_scope_plan(org,now_value);
  IF private_plan->>'state'='ready' THEN
   marker_value:=jsonb_build_object('action','constrained_work_scopes',
    'source',private_plan#>>'{marker,source}');
   RETURN jsonb_build_object('state','ready','action','constrained_work_scopes',
    'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Review source-backed work formations',
    'explanation','Approve the complete accepted-work formation set. Crew, skill, working hours, location, travel, vehicle and equipment remain separate dimensions.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  ELSIF private_plan->>'state'='unavailable' THEN RETURN base_plan;END IF;
  private_plan:=public.canonical_forecast_capacity_ui_v3_job_plan(org,now_value);
  IF private_plan->>'state'='ready' THEN
   marker_value:=jsonb_build_object('action','constrained_job_census',
    'source',private_plan#>>'{marker,source}');
   RETURN jsonb_build_object('state','ready','action','constrained_job_census',
    'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Review every accepted work constraint',
    'explanation','Approve one source-backed job review for every accepted work item and alternative. The full census commits together or not at all.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  END IF;
  RETURN base_plan;
 END IF;

 IF base_plan#>>'{_source,state}'='demand_allocation_unavailable' THEN
  BEGIN
   constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,now_value);
   backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,now_value);
   FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
    definition_value:=public.canonical_forecast_capacity_ui_v3_demand_definition(
     org,alternative_value,constraint_input,'demand',NULL,backlog_value->'rows');
    definitions_value:=definitions_value||jsonb_build_array(jsonb_build_object(
     'alternativeKey',alternative_value,'definitionDigest',public.canonical_completion_digest(definition_value)));
   END LOOP;
   marker_value:=jsonb_build_object('action','advisory_demand',
    'source',public.canonical_completion_digest(jsonb_build_object('constraint',constraint_input,
      'backlogDigest',backlog_value->>'digest','definitions',definitions_value)));
   RETURN jsonb_build_object('state','ready','action','advisory_demand',
    'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Review every accepted-work allocation',
    'explanation','Approve the complete source-backed per-job, per-scope allocation for each alternative. Alternatives remain separate and unsummed.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN base_plan;END;
 END IF;

 IF base_plan#>>'{_source,state}'='outcome_allocation_unavailable' THEN
  BEGIN
   SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
    WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
   SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
    WHERE value.organization_id=org
     AND value.origin_id=(advisory_origin.input_manifest#>>'{workloadOrigin,id}')::uuid
    ORDER BY value.revision DESC LIMIT 1;
   SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1 value
    WHERE value.organization_id=org AND value.id=workload_evaluation.outcome_window_id;
   constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
    org,advisory_origin.horizon_ends_at,advisory_origin.prediction_cutoff_at);
   definitions_value:='[]'::jsonb;
   FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
    definition_value:=public.canonical_forecast_capacity_ui_v3_demand_definition(org,alternative_value,
     constraint_input,'outcome_demand',advisory_origin.id,workload_window.evidence#>'{backlog,rows}');
    definitions_value:=definitions_value||jsonb_build_array(jsonb_build_object(
     'alternativeKey',alternative_value,'definitionDigest',public.canonical_completion_digest(definition_value)));
   END LOOP;
   marker_value:=jsonb_build_object('action','advisory_outcome_demand','origin',advisory_origin.id,
    'source',public.canonical_completion_digest(jsonb_build_object('constraint',constraint_input,
     'window',workload_window.id,'definitions',definitions_value)));
    RETURN jsonb_build_object('state','ready','action','advisory_outcome_demand',
     'token',public.canonical_completion_digest(marker_value),'lane','all',
    'label','Review original-period outcome allocations',
    'explanation','Approve every observed per-job outcome allocation for the immutable original period before qualitative evaluation.',
    'reasonLimit',1000,'hiringConsecutivePeriods',COALESCE((base_plan->>'hiringConsecutivePeriods')::int,2),
    '_source',marker_value);
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' OR SQLSTATE 'P0002' THEN RETURN base_plan;END;
 END IF;
 RETURN base_plan;
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('state','unavailable','action',NULL,'token',NULL,'lane','all',
  'label','Accepted source authority unavailable',
  'explanation','A required accepted source, review or private authority is unavailable. No capacity action is enabled.',
  'reasonLimit',NULL,'hiringConsecutivePeriods',2,'_source',jsonb_build_object('state','unavailable'));
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_current(
 org UUID,actor UUID,actor_role TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;plan_value JSONB;authority JSONB;
BEGIN
 value:=public.canonical_forecast_capacity_ui_v2_current(org,actor,actor_role,session_value);
 plan_value:=public.canonical_forecast_capacity_ui_v3_setup_plan(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,actor_role,session_value,NULL,FALSE);
 value:=jsonb_set(value,'{setup}',plan_value-'_source',FALSE);
 -- v2 derives lane actions from its own prerequisite plan.  When the v3 plan
 -- adds a source review or corrected-history wait, replace every blocked lane
 -- with an honest non-mutating review state.
 IF plan_value->>'state'<>'complete' THEN
  IF NOT (plan_value->>'state'='ready' AND plan_value->>'lane'='advisory') THEN
   value:=jsonb_set(value,'{workload,currentAction,name}',to_jsonb('review_prerequisites'::text),FALSE);
   value:=jsonb_set(value,'{workload,currentAction,expectedResultRevision}','null'::jsonb,FALSE);
   IF NOT (plan_value->>'state'='ready' AND plan_value->>'lane'='workload'
           AND plan_value->>'action'='workload_outcome_window') THEN
    value:=jsonb_set(value,'{constrained,currentAction,name}',to_jsonb('review_prerequisites'::text),FALSE);
    value:=jsonb_set(value,'{constrained,currentAction,expectedResultRevision}','null'::jsonb,FALSE);
   END IF;
  END IF;
  value:=jsonb_set(value,'{advisory,currentAction,name}',to_jsonb('review_prerequisites'::text),FALSE);
  value:=jsonb_set(value,'{advisory,currentAction,correctionOriginId}','null'::jsonb,FALSE);
  value:=jsonb_set(value,'{advisory,currentAction,expectedResultRevision}','null'::jsonb,FALSE);
 END IF;
 RETURN value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_setup_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,token_value TEXT,hiring_periods INTEGER,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 authority JSONB;plan_value JSONB;correction_value JSONB;request_hash TEXT;key_hash TEXT;
 old_request public.canonical_forecast_capacity_ui_setup_requests_v2%ROWTYPE;result_value JSONB;
 private_plan JSONB;entry_value JSONB;child_result JSONB;last_id UUID:=NULL;last_revision BIGINT:=NULL;
 assigned_value JSONB;role_generation public.canonical_forecast_workload_capacity_role_generations_v1%ROWTYPE;
 workload_review public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;review_source JSONB;
 constrained_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 constraint_input JSONB;backlog_value JSONB;definition_value JSONB;alternative_value TEXT;
 advisory_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 advisory_origin public.canonical_forecast_capacity_advisory_origins_v1%ROWTYPE;
 advisory_continuation public.canonical_forecast_capacity_advisory_continuations_v1%ROWTYPE;
 workload_evaluation public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 workload_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 saved_item JSONB;saved_review public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 now_value TIMESTAMPTZ;
BEGIN
 IF action_value NOT IN('workload_remaining_census','constrained_epoch','constrained_method',
   'constrained_work_scopes','constrained_job_census',
   'advisory_demand','advisory_outcome_demand','advisory_continuation_demand','advisory_correction_demand') THEN
  RETURN public.canonical_forecast_capacity_ui_v2_setup_mutate(org,actor,actor_role,session_value,csrf,
   key_value,action_value,token_value,hiring_periods,reason_value,confirmation_value);
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' OR token_value!~'^[0-9a-f]{64}$'
   OR hiring_periods NOT BETWEEN 2 AND 12 OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
   OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-capacity-ui-setup-v2' THEN
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
 plan_value:=public.canonical_forecast_capacity_ui_v3_setup_plan(org);
 IF action_value='advisory_correction_demand' THEN
  correction_value:=public.canonical_forecast_capacity_ui_v2_correction_review(org);
  IF ((plan_value->>'state'='ready' AND plan_value->>'action'=action_value AND plan_value->>'token'=token_value)
     OR (correction_value->>'state'='ready' AND correction_value->>'action'=action_value
      AND correction_value->>'token'=token_value)) IS NOT TRUE THEN
   RAISE EXCEPTION 'Capacity UI correction setup changed' USING ERRCODE='40001';END IF;
 ELSE
  IF plan_value->>'state'<>'ready' OR plan_value->>'action' IS DISTINCT FROM action_value
     OR plan_value->>'token' IS DISTINCT FROM token_value THEN
   RAISE EXCEPTION 'Capacity UI setup changed' USING ERRCODE='40001';END IF;
 END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();

 CASE action_value
 WHEN 'constrained_epoch' THEN
  child_result:=public.canonical_forecast_constrained_capacity_v1_epoch_capture(
   org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'constrained-epoch'),reason_value,
   'm26-constrained-capacity-epoch-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'constrained_method' THEN
  constrained_review:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
   org,'method',NULL,NULL);
  child_result:=public.canonical_forecast_constrained_capacity_v1_review_mutate(
   org,actor,actor_role,session_value,csrf,
   public.canonical_forecast_capacity_ui_v2_child_key(key_value,'constrained-method'),
   'method',NULL,NULL,'approve',COALESCE(constrained_review.revision,0),
   COALESCE(rtrim(constrained_review.digest),'none'),
   jsonb_build_object('methodVersion','m26-constrained-declared-role-supply-v1'),reason_value,
   'm26-constrained-capacity-review-v1');
  last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
 WHEN 'workload_remaining_census' THEN
  private_plan:=public.canonical_forecast_capacity_ui_v3_remaining_plan(org,now_value);
  IF private_plan->>'state'<>'ready' THEN
   RAISE EXCEPTION 'Remaining work review census changed' USING ERRCODE='40001';END IF;
  FOR entry_value IN SELECT entry FROM jsonb_array_elements(private_plan->'entries') entries(entry)
   WHERE (entry->>'needsReview')::boolean ORDER BY entry->>'appointmentId' LOOP
   child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(
    org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'remaining-'||(entry_value->>'appointmentId')),
    'remaining_work','workload.end_backlog_hours.v1',(entry_value->>'appointmentId')::uuid,NULL,'approve',
    (entry_value->>'expectedRevision')::int,entry_value->>'expectedDigest',
    (entry_value->>'remainingPersonMinutes')::numeric::bigint,reason_value,'m26-workload-capacity-review-v1');
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
  -- The disposable authority clock is deliberately fixed within a request;
  -- include receipts written at that exact instant in this postcondition.
  PERFORM public.canonical_forecast_workload_capacity_v1_backlog_evidence(
   org,now_value+INTERVAL '1 microsecond');
 WHEN 'constrained_work_scopes' THEN
  private_plan:=public.canonical_forecast_capacity_ui_v3_scope_plan(org,now_value);
  IF private_plan->>'state'<>'ready' THEN
   RAISE EXCEPTION 'Work formation census changed' USING ERRCODE='40001';END IF;
 FOR entry_value IN SELECT entry FROM jsonb_array_elements(private_plan->'entries') entries(entry)
   WHERE (entry->>'needsReview')::boolean ORDER BY entry->>'scopeKey' LOOP
   FOR assigned_value IN SELECT assigned FROM jsonb_array_elements(
      entry_value#>'{definition,crewAssignments}') assignments(assigned)
     ORDER BY assigned->>'profileId' LOOP
    SELECT DISTINCT ON(value.profile_id) value.* INTO role_generation
     FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
     WHERE value.organization_id=org AND value.profile_id=(assigned_value->>'profileId')::uuid
     ORDER BY value.profile_id,value.source_order DESC;
    review_source:=public.canonical_forecast_workload_capacity_v1_review_source(org,
     'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,
     role_generation.operational_role);
    SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
     WHERE value.organization_id=org AND value.review_kind='role_qualification'
      AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
    IF workload_review.id IS NULL OR workload_review.action<>'approve'
       OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(review_source) THEN
     child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(
      org,actor,actor_role,session_value,csrf,
      public.canonical_forecast_capacity_ui_v2_child_key(key_value,
       'scope-role-'||role_generation.profile_id::text),
      'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,
      role_generation.operational_role,'approve',COALESCE(workload_review.revision,0),
      COALESCE(rtrim(workload_review.digest),'none'),NULL,reason_value,
      'm26-workload-capacity-review-v1');
     last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
    END IF;
    review_source:=public.canonical_forecast_workload_capacity_v1_review_source(org,
     'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL);
    SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
     WHERE value.organization_id=org AND value.review_kind='availability_basis'
      AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
    IF workload_review.id IS NULL OR workload_review.action<>'approve'
       OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(review_source) THEN
     child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(
      org,actor,actor_role,session_value,csrf,
      public.canonical_forecast_capacity_ui_v2_child_key(key_value,
       'scope-availability-'||role_generation.profile_id::text),
      'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL,
      'approve',COALESCE(workload_review.revision,0),COALESCE(rtrim(workload_review.digest),'none'),
      NULL,reason_value,'m26-workload-capacity-review-v1');
     last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
    END IF;
   END LOOP;
   IF (entry_value->>'scopeNeedsReview')::boolean THEN
    child_result:=public.canonical_forecast_constrained_capacity_v1_review_mutate(
     org,actor,actor_role,session_value,csrf,
     public.canonical_forecast_capacity_ui_v2_child_key(key_value,'scope-'||(entry_value->>'scopeKey')),
     'scope',entry_value->>'scopeKey',NULL,'approve',(entry_value->>'expectedRevision')::bigint,
     entry_value->>'expectedDigest',entry_value->'definition',reason_value,'m26-constrained-capacity-review-v1');
    last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
   END IF;
  END LOOP;
  IF public.canonical_forecast_capacity_ui_v3_scope_plan(org,now_value)->>'state'<>'complete' THEN
   RAISE EXCEPTION 'Work formation census incomplete' USING ERRCODE='40001';END IF;
 WHEN 'constrained_job_census' THEN
  private_plan:=public.canonical_forecast_capacity_ui_v3_job_plan(org,now_value);
  IF private_plan->>'state'<>'ready' THEN
   RAISE EXCEPTION 'Job constraint census changed' USING ERRCODE='40001';END IF;
  FOR entry_value IN SELECT entry FROM jsonb_array_elements(private_plan->'entries') entries(entry)
   WHERE (entry->>'needsReview')::boolean ORDER BY entry->>'subjectId',entry->>'scopeKey' LOOP
   child_result:=public.canonical_forecast_constrained_capacity_v1_review_mutate(
    org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,
     'job-'||(entry_value->>'subjectId')||'-'||(entry_value->>'scopeKey')),
    'job',entry_value->>'scopeKey',(entry_value->>'subjectId')::uuid,'approve',
    (entry_value->>'expectedRevision')::bigint,entry_value->>'expectedDigest',entry_value->'definition',
    reason_value,'m26-constrained-capacity-review-v1');
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
  PERFORM public.canonical_forecast_constrained_capacity_v1_complete_input(org,now_value);
 WHEN 'advisory_demand' THEN
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,now_value);
  backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,now_value);
  FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',alternative_value,NULL,NULL,NULL);
   definition_value:=public.canonical_forecast_capacity_ui_v3_demand_definition(
    org,alternative_value,constraint_input,'demand',NULL,backlog_value->'rows');
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(
    org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'demand-'||alternative_value),
    'demand',alternative_value,NULL,NULL,NULL,'approve',COALESCE(advisory_review.revision,0),
    COALESCE(rtrim(advisory_review.digest),'none'),definition_value,reason_value,
    'm26-capacity-advisory-review-v1',NULL,NULL);
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
  PERFORM public.canonical_forecast_capacity_advisory_v1_demand_manifest(
   org,'demand',NULL,backlog_value->'rows',constraint_input);
 WHEN 'advisory_outcome_demand' THEN
  SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
  SELECT * INTO workload_evaluation FROM public.canonical_forecast_workload_capacity_evaluations_v1 value
   WHERE value.organization_id=org
    AND value.origin_id=(advisory_origin.input_manifest#>>'{workloadOrigin,id}')::uuid
   ORDER BY value.revision DESC LIMIT 1;
  SELECT * INTO workload_window FROM public.canonical_forecast_workload_capacity_windows_v1 value
   WHERE value.organization_id=org AND value.id=workload_evaluation.outcome_window_id;
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
   org,advisory_origin.horizon_ends_at,advisory_origin.prediction_cutoff_at);
  FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'outcome_demand',alternative_value,NULL,NULL,advisory_origin.id);
   definition_value:=public.canonical_forecast_capacity_ui_v3_demand_definition(org,alternative_value,
    constraint_input,'outcome_demand',advisory_origin.id,workload_window.evidence#>'{backlog,rows}');
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(
    org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'outcome-'||alternative_value),
    'outcome_demand',alternative_value,NULL,NULL,advisory_origin.id,'approve',
    COALESCE(advisory_review.revision,0),COALESCE(rtrim(advisory_review.digest),'none'),definition_value,
    reason_value,'m26-capacity-advisory-review-v1',NULL,NULL);
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
  PERFORM public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(org,'outcome_demand',
   advisory_origin.id,advisory_origin.id,workload_window.evidence#>'{backlog,rows}',constraint_input);
 WHEN 'advisory_continuation_demand' THEN
  SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
  SELECT * INTO advisory_continuation FROM public.canonical_forecast_capacity_advisory_continuations_v1 value
   WHERE value.organization_id=org AND value.predecessor_origin_id=advisory_origin.id
   ORDER BY value.reserved_at DESC,value.id DESC LIMIT 1;
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,advisory_continuation.period_start);
  backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,advisory_continuation.period_start);
  FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value ORDER BY value LOOP
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',alternative_value,NULL,NULL,NULL);
   definition_value:=public.canonical_forecast_capacity_ui_v3_demand_definition(
    org,alternative_value,constraint_input,'demand',NULL,backlog_value->'rows');
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(
    org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'continuation-'||alternative_value),
    'demand',alternative_value,NULL,NULL,NULL,'approve',COALESCE(advisory_review.revision,0),
    COALESCE(rtrim(advisory_review.digest),'none'),definition_value,reason_value,
    'm26-capacity-advisory-review-v1',advisory_continuation.id,NULL);
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END LOOP;
  PERFORM public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(org,'demand',NULL,
   advisory_continuation.id,backlog_value->'rows',constraint_input);
 WHEN 'advisory_correction_demand' THEN
  SELECT * INTO advisory_origin FROM public.canonical_forecast_capacity_advisory_origins_v1 value
   WHERE value.organization_id=org ORDER BY value.captured_at DESC,value.generation DESC,value.id DESC LIMIT 1;
  FOR saved_item IN SELECT entry FROM jsonb_array_elements(advisory_origin.input_manifest->'demands') entries(entry)
   ORDER BY entry->>'alternativeKey' LOOP
   SELECT * INTO saved_review FROM public.canonical_forecast_capacity_advisory_reviews_v1 value
    WHERE value.organization_id=org AND value.id=(saved_item->>'reviewId')::uuid;
   constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
    org,(saved_review.source_identity->>'effectiveStart')::timestamptz);
   backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(
    org,(saved_review.source_identity->>'effectiveStart')::timestamptz);
   advisory_review:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',saved_review.alternative_key,NULL,NULL,NULL);
   definition_value:=public.canonical_forecast_capacity_ui_v3_demand_definition(
    org,saved_review.alternative_key,constraint_input,'demand',NULL,backlog_value->'rows');
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(
    org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'correction-'||saved_review.alternative_key),
    'demand',saved_review.alternative_key,NULL,NULL,NULL,'approve',COALESCE(advisory_review.revision,0),
    COALESCE(rtrim(advisory_review.digest),'none'),definition_value,reason_value,
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

-- Bind a positive-work advisory origin to an allocation review captured at
-- the exact server-owned cutoff.  The visible origin action is the explicit
-- human review; private job identities and amounts never cross HTTP.  The
-- child reviews and origin share one serializable transaction, so a failure
-- leaves neither a partial census nor a misleading receipt.
CREATE FUNCTION public.canonical_forecast_capacity_ui_v3_action_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,origin_value UUID,outcome_value UUID,correction_value UUID,
 expected_result_revision BIGINT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 old_request public.canonical_forecast_capacity_ui_action_requests_v2%ROWTYPE;
 now_value TIMESTAMPTZ;constraint_input JSONB;backlog_value JSONB;definition_value JSONB;
 alternative_value TEXT;review_value public.canonical_forecast_capacity_advisory_reviews_v1%ROWTYPE;
 child_result JSONB;
BEGIN
 SELECT * INTO old_request FROM public.canonical_forecast_capacity_ui_action_requests_v2 value
  WHERE value.organization_id=org AND value.actor_id=actor AND value.idempotency_key_hash=key_hash;
 IF old_request.idempotency_key_hash IS NULL AND action_value='advisory_capture_origin'
    AND correction_value IS NULL THEN
  now_value:=public.canonical_forecast_workload_capacity_v1_clock();
  constraint_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,now_value);
  backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,now_value);
  FOR alternative_value IN SELECT value FROM jsonb_array_elements_text(constraint_input->'alternatives') value
   ORDER BY value LOOP
   review_value:=public.canonical_forecast_capacity_advisory_v1_review_current_internal(
    org,'demand',alternative_value,NULL,NULL,NULL);
   definition_value:=public.canonical_forecast_capacity_ui_v3_demand_definition(
    org,alternative_value,constraint_input,'demand',NULL,backlog_value->'rows');
   child_result:=public.canonical_forecast_capacity_advisory_v1_review_mutate_v2(
    org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'origin-demand-'||alternative_value),
    'demand',alternative_value,NULL,NULL,NULL,'approve',COALESCE(review_value.revision,0),
    COALESCE(rtrim(review_value.digest),'none'),definition_value,reason_value,
    'm26-capacity-advisory-review-v1',NULL,NULL);
  END LOOP;
  PERFORM public.canonical_forecast_capacity_advisory_v1_demand_manifest_period(
   org,'demand',NULL,NULL,backlog_value->'rows',constraint_input);
 END IF;
 RETURN public.canonical_forecast_capacity_ui_v2_action_mutate(
  org,actor,actor_role,session_value,csrf,key_value,action_value,origin_value,outcome_value,
  correction_value,expected_result_revision,reason_value,confirmation_value);
END $$;

REVOKE ALL ON FUNCTION
 public.canonical_forecast_capacity_ui_v3_remaining_plan(uuid,timestamptz),
 public.canonical_forecast_capacity_ui_v3_scope_plan(uuid,timestamptz),
 public.canonical_forecast_capacity_ui_v3_job_plan(uuid,timestamptz),
 public.canonical_forecast_capacity_ui_v3_demand_definition(uuid,text,jsonb,text,uuid,jsonb),
 public.canonical_forecast_capacity_ui_v3_setup_plan(uuid),
 public.canonical_forecast_capacity_ui_v3_current(uuid,uuid,text,uuid),
 public.canonical_forecast_capacity_ui_v3_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text),
 public.canonical_forecast_capacity_ui_v3_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)
 FROM PUBLIC;

DO $$ DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_ui_v3_remaining_plan(uuid,timestamptz),public.canonical_forecast_capacity_ui_v3_scope_plan(uuid,timestamptz),public.canonical_forecast_capacity_ui_v3_job_plan(uuid,timestamptz),public.canonical_forecast_capacity_ui_v3_demand_definition(uuid,text,jsonb,text,uuid,jsonb),public.canonical_forecast_capacity_ui_v3_setup_plan(uuid) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_capacity_ui_v3_current(uuid,uuid,text,uuid),public.canonical_forecast_capacity_ui_v3_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text),public.canonical_forecast_capacity_ui_v3_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text) TO %I',runtime_role);
 END IF;
END $$;
