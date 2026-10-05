-- Mission 26 Part 5D correction v5: complete asset/operator eligibility.
--
-- Migration 230 established the exact seven-dimension source review, but it
-- selected one profile for each asset and role.  That discarded other current
-- members with the same reviewed role before the sealed Part 5B maximum
-- matcher could choose distinct operators.  This additive replacement emits
-- the complete bounded eligibility relation between every reviewed asset and
-- every current formation member in the human-selected operator roles.  The
-- browser still receives role tokens only; private profile and asset identities
-- remain inside the accepted Part 5B definition and source identity.

CREATE FUNCTION public.canonical_forecast_capacity_ui_v5_scope_plan(
 org UUID,cutoff_value TIMESTAMPTZ,review_choices JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 census_value JSONB;formation RECORD;work_item JSONB;assignment_value public.canonical_schedule_assignments%ROWTYPE;
 opportunity_value public.canonical_opportunities%ROWTYPE;estimate_value public.canonical_estimates%ROWTYPE;
 travel_value public.canonical_travel_plans%ROWTYPE;equipment_value public.canonical_equipment_plans%ROWTYPE;
 current_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 role_generation public.canonical_forecast_workload_capacity_role_generations_v1%ROWTYPE;
 workload_review public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 availability_value public.canonical_workforce_availability_authorities%ROWTYPE;
 scope_key_value TEXT;formation_home TEXT;lead_role TEXT;target_role TEXT;service_value TEXT;location_value TEXT;
 definition_value JSONB;assignments_value JSONB;requirements_value JSONB;roles_value JSONB;skill_ids JSONB;
 vehicle_ids JSONB;equipment_ids JSONB;asset_ids JSONB;travel_pairs JSONB;asset_assignments JSONB;
 asset_calendars JSONB;operator_ids JSONB;operator_roles JSONB;support_roles JSONB;allowed_roles JSONB;
 selectable_target_roles JSONB;
 public_reviews JSONB:='[]'::jsonb;entries_value JSONB:='[]'::jsonb;choice_value JSONB;trip_value JSONB;
 line_value JSONB;asset_value public.tenant_assets%ROWTYPE;asset_id_value TEXT;operator_profile TEXT;
 available_intervals JSONB;source_value JSONB;review_source JSONB;assigned_value JSONB;
 formation_kind TEXT;crew_id_value UUID;profile_id_value UUID;profile_count INTEGER;job_count INTEGER;
 relevant_skill_count INTEGER;target_seats INTEGER;vehicle_per_seat INTEGER;equipment_per_seat INTEGER;
 job_vehicle_count INTEGER;required_vehicle_count INTEGER;job_equipment_count INTEGER;max_vehicle_count INTEGER;max_equipment_count INTEGER;
 travel_job_count INTEGER;vehicle_job_count INTEGER;equipment_job_count INTEGER;planned_count INTEGER:=0;
 active_count INTEGER;work_index INTEGER;eligible_operator_count INTEGER;availability_count INTEGER;duration_value NUMERIC;
 scope_needs_review BOOLEAN;entry_needs_review BOOLEAN;needs_review BOOLEAN:=FALSE;definition_ready BOOLEAN:=TRUE;
 skill_applicable BOOLEAN;travel_applicable BOOLEAN;vehicle_applicable BOOLEAN;equipment_applicable BOOLEAN;
 existing_operator_roles JSONB;
BEGIN
 IF review_choices IS NOT NULL AND (jsonb_typeof(review_choices)<>'array'
    OR jsonb_array_length(review_choices)>20 OR octet_length(review_choices::text)>32768
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(review_choices) choice
      WHERE NOT public.canonical_field_evidence_object_keys_exact(choice,ARRAY['scopeKey','targetRole','operatorRoles'])
       OR choice->>'scopeKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
       OR choice->>'targetRole' NOT IN('owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other')
       OR jsonb_typeof(choice->'operatorRoles')<>'array' OR jsonb_array_length(choice->'operatorRoles')>9
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(choice->'operatorRoles') role_item
         WHERE jsonb_typeof(role_item)<>'string' OR role_item#>>'{}' NOT IN
          ('owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other')))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(review_choices) choice GROUP BY choice->>'scopeKey' HAVING count(*)<>1)) THEN
  RAISE EXCEPTION 'Capacity scope classifications invalid' USING ERRCODE='22023';END IF;

 census_value:=public.canonical_forecast_constrained_capacity_v1_work_census(org,cutoff_value);
 IF (census_value->>'count')::int NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'Accepted work scope census unavailable' USING ERRCODE='22023';END IF;

 FOR formation IN
  SELECT DISTINCT CASE WHEN assignment_row.workforce_profile_id IS NOT NULL THEN 'profile' ELSE 'crew' END kind,
   COALESCE(assignment_row.workforce_profile_id,assignment_row.workforce_crew_id) formation_id
  FROM jsonb_array_elements(census_value->'rows') work(entry)
  JOIN public.canonical_schedule_assignments assignment_row
   ON assignment_row.organization_id=org AND assignment_row.id=(entry->>'assignmentId')::uuid
  WHERE (assignment_row.workforce_profile_id IS NULL)<>(assignment_row.workforce_crew_id IS NULL)
  ORDER BY 1,2
 LOOP
  formation_kind:=formation.kind;profile_id_value:=NULL;crew_id_value:=NULL;
  IF formation_kind='profile' THEN
   profile_id_value:=formation.formation_id;
   SELECT profile.home_location_id,profile.operational_role,
    jsonb_build_array(jsonb_build_object('profileId',profile.id,'crewId',NULL,'role',profile.operational_role)),
    jsonb_build_array(profile.operational_role),1
   INTO formation_home,lead_role,assignments_value,roles_value,profile_count
   FROM public.workforce_profiles profile
   JOIN public.organization_memberships membership ON membership.organization_id=profile.organization_id
    AND membership.id=profile.membership_id AND membership.status='active'
   JOIN public.users account ON account.id=membership.user_id AND account.status='active'
   WHERE profile.organization_id=org AND profile.id=profile_id_value;
   requirements_value:='[]'::jsonb;
   scope_key_value:='accepted_profile_'||substr(encode(sha256(convert_to(profile_id_value::text,'UTF8')),'hex'),1,16);
  ELSE
   crew_id_value:=formation.formation_id;
   SELECT crew.home_location_id,count(*) FILTER(WHERE member.crew_role='lead'),
    (array_agg(profile.operational_role ORDER BY profile.id)
      FILTER(WHERE member.crew_role='lead'))[1],count(*)::int,
    COALESCE(jsonb_agg(jsonb_build_object('profileId',profile.id,'crewId',crew.id,'role',profile.operational_role)
      ORDER BY profile.id),'[]'::jsonb),
    COALESCE(jsonb_agg(DISTINCT profile.operational_role ORDER BY profile.operational_role),'[]'::jsonb)
   INTO formation_home,active_count,lead_role,profile_count,assignments_value,roles_value
   FROM public.workforce_crews crew
   JOIN public.workforce_crew_members member ON member.organization_id=crew.organization_id AND member.crew_id=crew.id
   JOIN public.workforce_profiles profile ON profile.organization_id=member.organization_id AND profile.id=member.profile_id
   JOIN public.organization_memberships membership ON membership.organization_id=profile.organization_id
    AND membership.id=profile.membership_id AND membership.status='active'
   JOIN public.users account ON account.id=membership.user_id AND account.status='active'
   WHERE crew.organization_id=org AND crew.id=crew_id_value GROUP BY crew.id,crew.home_location_id;
   IF active_count<>1 THEN RAISE EXCEPTION 'Mixed crew target role authority unavailable' USING ERRCODE='22023';END IF;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('role',grouped.role_name,'count',grouped.member_count)
     ORDER BY grouped.role_name),'[]'::jsonb) INTO requirements_value
   FROM (SELECT assigned->>'role' role_name,count(*)::int member_count
     FROM jsonb_array_elements(assignments_value) assigned GROUP BY assigned->>'role') grouped;
   scope_key_value:='accepted_crew_'||substr(encode(sha256(convert_to(crew_id_value::text,'UTF8')),'hex'),1,16);
  END IF;
  IF formation_home IS NULL OR formation_home!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
     OR lead_role IS NULL OR profile_count NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Work formation source unavailable' USING ERRCODE='22023';END IF;

  SELECT value.* INTO current_value FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.scope_key=scope_key_value
   ORDER BY value.revision DESC LIMIT 1;
  choice_value:=NULL;
  IF review_choices IS NOT NULL THEN
   SELECT choice INTO choice_value FROM jsonb_array_elements(review_choices) choice
    WHERE choice->>'scopeKey'=scope_key_value;
   IF choice_value IS NULL THEN RAISE EXCEPTION 'Capacity scope classification missing' USING ERRCODE='22023';END IF;
  END IF;
  target_role:=COALESCE(choice_value->>'targetRole',
   CASE WHEN current_value.action='approve' AND roles_value ? (current_value.definition->>'role')
     THEN current_value.definition->>'role' ELSE lead_role END);
  IF NOT roles_value ? target_role THEN
   RAISE EXCEPTION 'Capacity target role differs from formation' USING ERRCODE='22023';END IF;
  SELECT count(*)::int INTO target_seats FROM jsonb_array_elements(assignments_value) assigned
   WHERE assigned->>'role'=target_role;
  IF target_seats NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'Capacity target seats unavailable' USING ERRCODE='22023';END IF;
  SELECT COALESCE(jsonb_agg(role_item ORDER BY role_item#>>'{}'),'[]'::jsonb) INTO support_roles
   FROM jsonb_array_elements(roles_value) role_item WHERE role_item#>>'{}'<>target_role;

  skill_ids:='[]'::jsonb;vehicle_ids:='[]'::jsonb;equipment_ids:='[]'::jsonb;
  travel_pairs:='[]'::jsonb;max_vehicle_count:=0;max_equipment_count:=0;
  travel_job_count:=0;vehicle_job_count:=0;equipment_job_count:=0;job_count:=0;

  SELECT count(*) INTO job_count
  FROM jsonb_array_elements(census_value->'rows') work(entry)
  JOIN public.canonical_schedule_assignments assignment_row ON assignment_row.organization_id=org
   AND assignment_row.id=(entry->>'assignmentId')::uuid
  WHERE (formation_kind='profile' AND assignment_row.workforce_profile_id=profile_id_value)
     OR (formation_kind='crew' AND assignment_row.workforce_crew_id=crew_id_value);
  IF job_count NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Formation work census unavailable' USING ERRCODE='22023';END IF;

  SELECT count(DISTINCT skill.id) INTO relevant_skill_count
  FROM public.workforce_skills skill
  JOIN public.workforce_profile_skills link ON link.organization_id=skill.organization_id AND link.skill_id=skill.id
  WHERE skill.organization_id=org AND link.profile_id::text IN
    (SELECT assigned->>'profileId' FROM jsonb_array_elements(assignments_value) assigned)
   AND (skill.service_id IS NULL OR skill.service_id IN(
    SELECT DISTINCT opportunity.service_type FROM jsonb_array_elements(census_value->'rows') work(entry)
    JOIN public.canonical_schedule_assignments assignment_row ON assignment_row.organization_id=org
     AND assignment_row.id=(entry->>'assignmentId')::uuid
    JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org
     AND opportunity.id=assignment_row.opportunity_id
    WHERE (formation_kind='profile' AND assignment_row.workforce_profile_id=profile_id_value)
       OR (formation_kind='crew' AND assignment_row.workforce_crew_id=crew_id_value)));
  SELECT COALESCE(jsonb_agg(skill_id ORDER BY skill_id),'[]'::jsonb) INTO skill_ids
  FROM (SELECT skill.id::text skill_id
    FROM public.workforce_skills skill
    JOIN public.workforce_profile_skills link ON link.organization_id=skill.organization_id AND link.skill_id=skill.id
    WHERE skill.organization_id=org AND link.profile_id::text IN
      (SELECT assigned->>'profileId' FROM jsonb_array_elements(assignments_value) assigned)
     AND (skill.service_id IS NULL OR skill.service_id IN(
      SELECT DISTINCT opportunity.service_type FROM jsonb_array_elements(census_value->'rows') work(entry)
      JOIN public.canonical_schedule_assignments assignment_row ON assignment_row.organization_id=org
       AND assignment_row.id=(entry->>'assignmentId')::uuid
      JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org
       AND opportunity.id=assignment_row.opportunity_id
      WHERE (formation_kind='profile' AND assignment_row.workforce_profile_id=profile_id_value)
         OR (formation_kind='crew' AND assignment_row.workforce_crew_id=crew_id_value)))
    GROUP BY skill.id HAVING count(DISTINCT link.profile_id)=profile_count) shared;
  IF relevant_skill_count>0 AND jsonb_array_length(skill_ids)=0 THEN
   RAISE EXCEPTION 'Formation skill authority contradictory' USING ERRCODE='22023';END IF;
  skill_applicable:=jsonb_array_length(skill_ids)>0;

  FOR work_index IN 0 .. jsonb_array_length(census_value->'rows')-1 LOOP
   work_item:=census_value->'rows'->work_index;
   SELECT * INTO assignment_value FROM public.canonical_schedule_assignments value
    WHERE value.organization_id=org AND value.id=(work_item->>'assignmentId')::uuid;
   IF NOT ((formation_kind='profile' AND assignment_value.workforce_profile_id=profile_id_value)
      OR (formation_kind='crew' AND assignment_value.workforce_crew_id=crew_id_value)) THEN CONTINUE;END IF;
   SELECT * INTO opportunity_value FROM public.canonical_opportunities value
    WHERE value.organization_id=org AND value.id=assignment_value.opportunity_id;
   service_value:=opportunity_value.service_type;location_value:=opportunity_value.job_scope->>'locationId';
   IF service_value IS NULL OR service_value!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
      OR location_value IS NULL OR location_value!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' THEN
    RAISE EXCEPTION 'Accepted work service or location authority unavailable' USING ERRCODE='22023';END IF;
   SELECT * INTO estimate_value FROM public.canonical_estimates value WHERE value.organization_id=org
    AND value.opportunity_id=opportunity_value.id ORDER BY value.id;
   SELECT count(*) INTO active_count FROM public.canonical_estimates value
    WHERE value.organization_id=org AND value.opportunity_id=opportunity_value.id;
   IF active_count<>1 OR estimate_value.id IS NULL THEN
    RAISE EXCEPTION 'Exact work estimate authority unavailable' USING ERRCODE='22023';END IF;
   SELECT * INTO travel_value FROM public.canonical_travel_plans value WHERE value.organization_id=org
    AND value.estimate_id=estimate_value.id ORDER BY value.revision DESC LIMIT 1;
   SELECT * INTO equipment_value FROM public.canonical_equipment_plans value WHERE value.organization_id=org
    AND value.estimate_id=estimate_value.id ORDER BY value.revision DESC LIMIT 1;

   job_vehicle_count:=0;required_vehicle_count:=0;job_equipment_count:=0;trip_value:=NULL;
   IF location_value<>formation_home THEN
    IF travel_value.id IS NULL OR travel_value.action<>'save' OR travel_value.inputs->>'serviceKey' IS DISTINCT FROM service_value
       OR jsonb_array_length(travel_value.inputs->'trips')<>1 THEN
     RAISE EXCEPTION 'Exact travel authority unavailable' USING ERRCODE='22023';END IF;
    trip_value:=travel_value.inputs->'trips'->0;
    IF trip_value#>>'{origin,kind}'<>'business_location' OR trip_value#>>'{origin,sourceId}' IS DISTINCT FROM formation_home
       OR trip_value#>>'{destination,kind}'<>'recorded_job'
       OR trip_value#>>'{destination,sourceId}' IS DISTINCT FROM estimate_value.id::text
       OR trip_value#>>'{destination,sourceDigest}' IS DISTINCT FROM public.canonical_completion_digest(opportunity_value.job_scope)
       OR trip_value->>'returnIncluded'<>'true'
       OR trip_value#>>'{time,basis}' NOT IN('estimated','reported') OR trip_value#>>'{time,value}' IS NULL THEN
     RAISE EXCEPTION 'Travel route source contradicts accepted work' USING ERRCODE='22023';END IF;
    duration_value:=(trip_value#>>'{time,value}')::numeric*CASE WHEN trip_value#>>'{time,unit}'='hour' THEN 60 ELSE 1 END;
    IF duration_value<>trunc(duration_value) OR duration_value NOT BETWEEN 0 AND 1440 THEN
     RAISE EXCEPTION 'Travel duration cannot enter constrained capacity' USING ERRCODE='22023';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(travel_pairs) pair
      WHERE pair->>'fromLocationKey'=formation_home AND pair->>'toLocationKey'=location_value
       AND (pair->>'durationMinutes')::numeric<>duration_value) THEN
     RAISE EXCEPTION 'Travel route authorities contradict' USING ERRCODE='22023';END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(travel_pairs) pair
      WHERE pair->>'fromLocationKey'=formation_home AND pair->>'toLocationKey'=location_value) THEN
     travel_pairs:=travel_pairs||jsonb_build_array(jsonb_build_object('fromLocationKey',formation_home,
      'toLocationKey',location_value,'durationMinutes',duration_value::int,'basis',trip_value#>>'{time,basis}'));
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(travel_pairs) pair
      WHERE pair->>'fromLocationKey'=location_value AND pair->>'toLocationKey'=formation_home
       AND (pair->>'durationMinutes')::numeric<>duration_value) THEN
     RAISE EXCEPTION 'Return route authorities contradict' USING ERRCODE='22023';END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(travel_pairs) pair
      WHERE pair->>'fromLocationKey'=location_value AND pair->>'toLocationKey'=formation_home) THEN
     travel_pairs:=travel_pairs||jsonb_build_array(jsonb_build_object('fromLocationKey',location_value,
      'toLocationKey',formation_home,'durationMinutes',duration_value::int,'basis',trip_value#>>'{time,basis}'));
    END IF;
    travel_job_count:=travel_job_count+1;
     IF trip_value#>>'{vehicle,method}'<>'not_applicable' THEN
      required_vehicle_count:=(trip_value->>'vehicles')::int;
      IF required_vehicle_count NOT BETWEEN 1 AND 20 THEN
       RAISE EXCEPTION 'Travel vehicle requirement exceeds bound' USING ERRCODE='22023';END IF;
     END IF;
   ELSIF travel_value.id IS NOT NULL AND travel_value.action='save'
      AND jsonb_array_length(travel_value.inputs->'trips')>0 THEN
    RAISE EXCEPTION 'Travel authority contradicts same-location work' USING ERRCODE='22023';
   END IF;

   IF equipment_value.id IS NOT NULL AND equipment_value.action='save' THEN
    IF equipment_value.inputs->>'serviceKey' IS DISTINCT FROM service_value THEN
     RAISE EXCEPTION 'Equipment service authority differs' USING ERRCODE='22023';END IF;
    FOR line_value IN SELECT line FROM jsonb_array_elements(equipment_value.inputs->'lines') lines(line) LOOP
     IF line_value->>'assetId' IS NULL THEN
      RAISE EXCEPTION 'Exact reviewed equipment asset required' USING ERRCODE='22023';END IF;
     SELECT * INTO asset_value FROM public.tenant_assets value WHERE value.organization_id=org
      AND value.id=(line_value->>'assetId')::uuid AND value.catalogue_state='active';
     IF asset_value.id IS NULL OR asset_value.category NOT IN('vehicle','equipment')
        OR asset_value.home_location_id IS DISTINCT FROM formation_home
        OR NOT EXISTS(SELECT 1 FROM public.tenant_asset_service_capabilities capability
          WHERE capability.organization_id=org AND capability.asset_id=asset_value.id
           AND capability.service_id=service_value) THEN
      RAISE EXCEPTION 'Equipment asset authority unavailable or contradictory' USING ERRCODE='22023';END IF;
     IF asset_value.category='vehicle' THEN
      job_vehicle_count:=job_vehicle_count+1;
      IF NOT vehicle_ids ? asset_value.id::text THEN vehicle_ids:=vehicle_ids||to_jsonb(asset_value.id::text);END IF;
     ELSE
      job_equipment_count:=job_equipment_count+1;
      IF NOT equipment_ids ? asset_value.id::text THEN equipment_ids:=equipment_ids||to_jsonb(asset_value.id::text);END IF;
     END IF;
    END LOOP;
   END IF;
   IF required_vehicle_count<>job_vehicle_count THEN
    RAISE EXCEPTION 'Travel and reviewed vehicle authorities differ' USING ERRCODE='22023';END IF;
   IF location_value=formation_home AND job_vehicle_count>0 THEN
    RAISE EXCEPTION 'Vehicle authority contradicts same-location work' USING ERRCODE='22023';END IF;
   IF job_vehicle_count>0 THEN vehicle_job_count:=vehicle_job_count+1;END IF;
   IF job_equipment_count>0 THEN equipment_job_count:=equipment_job_count+1;END IF;
   max_vehicle_count:=greatest(max_vehicle_count,job_vehicle_count);
   max_equipment_count:=greatest(max_equipment_count,job_equipment_count);
  END LOOP;

  travel_applicable:=travel_job_count=job_count;
  IF travel_job_count NOT IN(0,job_count) THEN RAISE EXCEPTION 'Travel applicability differs within scope' USING ERRCODE='22023';END IF;
  vehicle_applicable:=vehicle_job_count=job_count;
  IF vehicle_job_count NOT IN(0,job_count) OR (vehicle_applicable AND jsonb_array_length(vehicle_ids)=0) THEN
   RAISE EXCEPTION 'Vehicle applicability differs within scope' USING ERRCODE='22023';END IF;
  equipment_applicable:=equipment_job_count=job_count;
  IF equipment_job_count NOT IN(0,job_count) OR (equipment_applicable AND jsonb_array_length(equipment_ids)=0) THEN
   RAISE EXCEPTION 'Equipment applicability differs within scope' USING ERRCODE='22023';END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(candidate.role_name) ORDER BY candidate.role_name),'[]'::jsonb)
   INTO selectable_target_roles
  FROM (SELECT assigned->>'role' role_name,count(*)::int seat_count
    FROM jsonb_array_elements(assignments_value) assigned GROUP BY assigned->>'role') candidate
  WHERE (NOT vehicle_applicable OR max_vehicle_count%candidate.seat_count=0)
    AND (NOT equipment_applicable OR max_equipment_count%candidate.seat_count=0);
  IF jsonb_array_length(selectable_target_roles)=0 THEN
   RAISE EXCEPTION 'No exact target role classification is available' USING ERRCODE='22023';END IF;
  definition_ready:=selectable_target_roles ? target_role;
  IF NOT definition_ready AND choice_value IS NOT NULL THEN
   RAISE EXCEPTION 'Asset requirement does not resolve per target seat' USING ERRCODE='22023';END IF;
  vehicle_per_seat:=CASE WHEN vehicle_applicable AND definition_ready THEN max_vehicle_count/target_seats ELSE 0 END;
  equipment_per_seat:=CASE WHEN equipment_applicable AND definition_ready THEN max_equipment_count/target_seats ELSE 0 END;
  IF definition_ready AND ((vehicle_applicable AND vehicle_per_seat NOT BETWEEN 1 AND 99)
     OR (equipment_applicable AND equipment_per_seat NOT BETWEEN 1 AND 99)) THEN
   RAISE EXCEPTION 'Asset requirement exceeds scope bound' USING ERRCODE='22023';END IF;

  asset_ids:=vehicle_ids||equipment_ids;
  IF choice_value IS NOT NULL THEN operator_roles:=choice_value->'operatorRoles';
  ELSIF current_value.action='approve' THEN
   SELECT COALESCE(jsonb_agg(DISTINCT assigned->>'role' ORDER BY assigned->>'role'),'[]'::jsonb)
    INTO existing_operator_roles FROM jsonb_array_elements(current_value.definition->'crewAssignments') assigned
    WHERE assigned->>'profileId' IN(SELECT operator_id#>>'{}'
      FROM jsonb_array_elements(current_value.definition->'operatorProfileIds') operator_id);
   operator_roles:=existing_operator_roles;
  ELSE operator_roles:=CASE WHEN jsonb_array_length(asset_ids)>0 THEN jsonb_build_array(target_role) ELSE '[]'::jsonb END;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(operator_roles) role_item WHERE NOT roles_value ? (role_item#>>'{}'))
     OR (jsonb_array_length(asset_ids)=0)<>(jsonb_array_length(operator_roles)=0)
     OR (SELECT count(*)<>count(DISTINCT role_item#>>'{}') FROM jsonb_array_elements(operator_roles) role_item) THEN
   RAISE EXCEPTION 'Operator role classification differs from formation' USING ERRCODE='22023';END IF;
  SELECT count(*)::int INTO eligible_operator_count FROM jsonb_array_elements(assignments_value) assigned
   WHERE operator_roles ? (assigned->>'role');
  IF jsonb_array_length(asset_ids)>0 AND eligible_operator_count<1 THEN
   RAISE EXCEPTION 'Qualified asset operator unavailable' USING ERRCODE='22023';END IF;
  IF jsonb_array_length(asset_ids)*eligible_operator_count>40 THEN
   RAISE EXCEPTION 'Complete asset operator eligibility exceeds bound' USING ERRCODE='54000';END IF;

  asset_assignments:='[]'::jsonb;asset_calendars:='[]'::jsonb;operator_ids:='[]'::jsonb;
  FOR assigned_value IN SELECT assigned FROM jsonb_array_elements(assignments_value) assignments(assigned)
   WHERE operator_roles ? (assigned->>'role') ORDER BY assigned->>'profileId' LOOP
   operator_profile:=assigned_value->>'profileId';
   SELECT * INTO availability_value FROM public.canonical_workforce_availability_authorities value
    WHERE value.organization_id=org AND value.workforce_profile_id=operator_profile::uuid;
   SELECT count(*)::int INTO availability_count
    FROM public.canonical_workforce_availability_intervals interval_value
    WHERE interval_value.organization_id=org AND interval_value.availability_id=availability_value.id
     AND interval_value.interval_kind='available';
   IF availability_value.id IS NULL OR availability_count<1 THEN
    RAISE EXCEPTION 'Asset operator availability authority unavailable' USING ERRCODE='22023';END IF;
   operator_ids:=operator_ids||to_jsonb(operator_profile);
  END LOOP;

  FOR asset_id_value IN SELECT item#>>'{}' FROM jsonb_array_elements(asset_ids) item ORDER BY item#>>'{}' LOOP
   SELECT * INTO asset_value FROM public.tenant_assets value WHERE value.organization_id=org
    AND value.id=asset_id_value::uuid;
   FOR assigned_value IN SELECT assigned FROM jsonb_array_elements(assignments_value) assignments(assigned)
    WHERE operator_roles ? (assigned->>'role') ORDER BY assigned->>'profileId' LOOP
    asset_assignments:=asset_assignments||jsonb_build_array(jsonb_build_object('assetId',asset_id_value,
     'crewId',CASE WHEN formation_kind='crew' THEN to_jsonb(crew_id_value) ELSE 'null'::jsonb END,
     'kind',asset_value.category,'operatorProfileId',assigned_value->>'profileId'));
   END LOOP;
   WITH raw_intervals AS (
    SELECT interval_value.starts_at,interval_value.ends_at
    FROM jsonb_array_elements(assignments_value) assignments(assigned)
    JOIN public.canonical_workforce_availability_authorities authority
     ON authority.organization_id=org AND authority.workforce_profile_id=(assigned->>'profileId')::uuid
    JOIN public.canonical_workforce_availability_intervals interval_value
     ON interval_value.organization_id=authority.organization_id AND interval_value.availability_id=authority.id
      AND interval_value.interval_kind='available'
    WHERE operator_roles ? (assigned->>'role')
   ),marked AS (
    SELECT starts_at,ends_at,CASE WHEN starts_at>COALESCE(max(ends_at) OVER(
      ORDER BY starts_at,ends_at ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),starts_at)
      THEN 1 ELSE 0 END new_group FROM raw_intervals
   ),grouped AS (
    SELECT starts_at,ends_at,sum(new_group) OVER(ORDER BY starts_at,ends_at) interval_group FROM marked
   ),merged AS (
    SELECT min(starts_at) starts_at,max(ends_at) ends_at FROM grouped GROUP BY interval_group
   ) SELECT COALESCE(jsonb_agg(jsonb_build_object('start',starts_at,'end',ends_at)
      ORDER BY starts_at,ends_at),'[]'::jsonb) INTO available_intervals FROM merged;
   IF jsonb_array_length(available_intervals) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Complete asset operator availability exceeds bound' USING ERRCODE='54000';END IF;
   asset_calendars:=asset_calendars||jsonb_build_array(jsonb_build_object('assetId',asset_id_value,
    'availableIntervals',available_intervals,'committedIntervals','[]'::jsonb));
  END LOOP;

  IF definition_ready THEN
   definition_value:=jsonb_build_object('alternativeKey','accepted_team','scopeKey',scope_key_value,
    'role',target_role,'applicability',jsonb_build_object('crew',formation_kind='crew','skill',skill_applicable,
     'workingHours',TRUE,'location',TRUE,'travel',travel_applicable,'vehicle',vehicle_applicable,
     'equipment',equipment_applicable),'crewIds',CASE WHEN formation_kind='crew' THEN jsonb_build_array(crew_id_value)
      ELSE '[]'::jsonb END,'crewRoleRequirements',CASE WHEN formation_kind='crew' THEN requirements_value ELSE '[]'::jsonb END,
    'crewAssignments',assignments_value,'skillIds',skill_ids,'locationKey',formation_home,
    'travelPairs',travel_pairs,'vehicleAssetIds',vehicle_ids,'equipmentAssetIds',equipment_ids,
    'operatorProfileIds',operator_ids,'assetAssignments',asset_assignments,
    'assetRequirements',jsonb_build_object('vehiclePerSeat',vehicle_per_seat,'equipmentPerSeat',equipment_per_seat),
    'assetCalendars',asset_calendars);
   IF public.canonical_forecast_constrained_capacity_v1_definition_valid('scope',definition_value) IS NOT TRUE THEN
    RAISE EXCEPTION 'Exact source-derived scope definition invalid' USING ERRCODE='22023';END IF;
   source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(
    org,'scope',scope_key_value,NULL,definition_value);
   scope_needs_review:=current_value.id IS NULL OR current_value.action<>'approve'
    OR current_value.definition IS DISTINCT FROM definition_value
    OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,current_value) IS NOT TRUE;
  ELSE
   definition_value:=NULL;source_value:=NULL;scope_needs_review:=TRUE;
  END IF;
  entry_needs_review:=scope_needs_review;
  FOR assigned_value IN SELECT assigned FROM jsonb_array_elements(assignments_value) assignments(assigned) LOOP
   SELECT DISTINCT ON(value.profile_id) value.* INTO role_generation
    FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
    WHERE value.organization_id=org AND value.profile_id=(assigned_value->>'profileId')::uuid
    ORDER BY value.profile_id,value.source_order DESC;
   IF role_generation.profile_id IS NULL OR role_generation.present IS NOT TRUE
      OR role_generation.membership_status<>'active' OR role_generation.account_status<>'active'
      OR role_generation.operational_role IS DISTINCT FROM assigned_value->>'role' THEN
    RAISE EXCEPTION 'Formation role source unavailable' USING ERRCODE='22023';END IF;
   review_source:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,role_generation.operational_role);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='role_qualification'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   entry_needs_review:=entry_needs_review OR workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(review_source);
   review_source:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='availability_basis'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   entry_needs_review:=entry_needs_review OR workload_review.id IS NULL OR workload_review.action<>'approve'
    OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(review_source);
  END LOOP;
  entries_value:=entries_value||jsonb_build_array(jsonb_build_object('scopeKey',scope_key_value,
   'definition',definition_value,'expectedRevision',COALESCE(current_value.revision,0),
   'expectedDigest',COALESCE(rtrim(current_value.digest),'none'),'scopeNeedsReview',scope_needs_review,
   'needsReview',entry_needs_review));
  public_reviews:=public_reviews||jsonb_build_array(jsonb_build_object('scopeKey',scope_key_value,
   'formation',formation_kind,'dimensions',jsonb_build_object('crew',CASE WHEN formation_kind='crew' THEN 'applies' ELSE 'not_applicable' END,
    'skill',CASE WHEN skill_applicable THEN 'applies' ELSE 'not_applicable' END,'workingHours','applies','location','applies',
    'travel',CASE WHEN travel_applicable THEN 'applies' ELSE 'not_applicable' END,
    'vehicle',CASE WHEN vehicle_applicable THEN 'applies' ELSE 'not_applicable' END,
    'equipment',CASE WHEN equipment_applicable THEN 'applies' ELSE 'not_applicable' END),
   'targetRole',target_role,'supportRoles',support_roles,'operatorRoles',operator_roles,
   'targetRoleOptions',roles_value,'selectableTargetRoles',selectable_target_roles,
   'operatorRoleOptions',CASE WHEN jsonb_array_length(asset_ids)>0 THEN roles_value ELSE '[]'::jsonb END,
   'sourceState','source_backed','reviewState',CASE WHEN entry_needs_review THEN 'needs_review' ELSE 'current' END));
  needs_review:=needs_review OR entry_needs_review;planned_count:=planned_count+1;
 END LOOP;

 IF review_choices IS NOT NULL AND jsonb_array_length(review_choices)<>planned_count THEN
  RAISE EXCEPTION 'Capacity scope classification population changed' USING ERRCODE='40001';END IF;
 SELECT count(*) INTO active_count FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
   AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
    WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
    ORDER BY latest.revision DESC LIMIT 1)
   AND NOT (entries_value @> jsonb_build_array(jsonb_build_object('scopeKey',value.scope_key)));
 IF planned_count NOT BETWEEN 1 AND 20 OR planned_count+active_count>20
    OR octet_length(entries_value::text)>1048576 OR octet_length(public_reviews::text)>65536 THEN
  RAISE EXCEPTION 'Source-derived scope population exceeds bound' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('state',CASE WHEN needs_review THEN 'ready' ELSE 'complete' END,
  'entries',entries_value,'reviews',public_reviews,'marker',jsonb_build_object('kind','exact_accepted_work_scopes',
   'source',public.canonical_completion_digest(jsonb_build_object('census',census_value,'entries',entries_value))));
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '22P02' OR SQLSTATE '22012' OR SQLSTATE '54000' THEN
 RETURN jsonb_build_object('state','unavailable','entries','[]'::jsonb,'reviews','[]'::jsonb,
  'marker',jsonb_build_object('state','exact_work_scope_unavailable'));
END $$;

-- Keep the v3 prerequisite sequencer and all later accepted operations, while
-- replacing its unsafe scope planner with the corrected exact planner.
CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_ui_v3_scope_plan(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_forecast_capacity_ui_v5_scope_plan(org,cutoff_value,NULL)
$$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v5_job_plan(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 census_value JSONB;work_item JSONB;assignment_value public.canonical_schedule_assignments%ROWTYPE;
 scope_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 current_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 opportunity_value public.canonical_opportunities%ROWTYPE;estimate_value public.canonical_estimates%ROWTYPE;
 travel_value public.canonical_travel_plans%ROWTYPE;equipment_value public.canonical_equipment_plans%ROWTYPE;
 readiness_value public.canonical_equipment_readiness_plans%ROWTYPE;
 definition_value JSONB;source_value JSONB;entries_value JSONB:='[]'::jsonb;
 alternative_value TEXT;formation_home TEXT;location_value TEXT;match_count INTEGER;
 needs_review BOOLEAN:=FALSE;planned_count INTEGER:=0;
BEGIN
 census_value:=public.canonical_forecast_constrained_capacity_v1_work_census(org,cutoff_value);
 IF (census_value->>'count')::int>500 THEN RAISE EXCEPTION 'Accepted work census exceeds bound' USING ERRCODE='54000';END IF;
 FOR work_item IN SELECT entry FROM jsonb_array_elements(census_value->'rows') entries(entry)
  ORDER BY entry->>'appointmentId',entry->>'assignmentId' LOOP
  SELECT * INTO assignment_value FROM public.canonical_schedule_assignments value
   WHERE value.organization_id=org AND value.id=(work_item->>'assignmentId')::uuid
    AND value.appointment_id=(work_item->>'appointmentId')::uuid;
  SELECT * INTO opportunity_value FROM public.canonical_opportunities value
   WHERE value.organization_id=org AND value.id=assignment_value.opportunity_id;
  location_value:=opportunity_value.job_scope->>'locationId';
  IF assignment_value.id IS NULL OR (assignment_value.workforce_profile_id IS NULL)=(assignment_value.workforce_crew_id IS NULL)
     OR location_value IS NULL OR location_value!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' THEN
   RAISE EXCEPTION 'Accepted work formation or location unavailable' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO match_count FROM public.canonical_estimates value
   WHERE value.organization_id=org AND value.opportunity_id=opportunity_value.id;
  SELECT * INTO estimate_value FROM public.canonical_estimates value
   WHERE value.organization_id=org AND value.opportunity_id=opportunity_value.id ORDER BY value.id LIMIT 1;
  IF match_count<>1 THEN RAISE EXCEPTION 'Exact work estimate unavailable' USING ERRCODE='22023';END IF;
  FOR alternative_value IN SELECT DISTINCT value.definition->>'alternativeKey'
   FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
    AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
      WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
      ORDER BY latest.revision DESC LIMIT 1)
    AND public.canonical_forecast_constrained_capacity_v1_review_is_current(org,value) ORDER BY 1
  LOOP
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
     OR (assignment_value.workforce_crew_id IS NOT NULL AND value.definition->'crewIds' ? assignment_value.workforce_crew_id::text));
   SELECT value.* INTO scope_value
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
     OR (assignment_value.workforce_crew_id IS NOT NULL AND value.definition->'crewIds' ? assignment_value.workforce_crew_id::text))
   ORDER BY value.scope_key LIMIT 1;
   IF match_count<>1 OR scope_value.id IS NULL THEN
    RAISE EXCEPTION 'Accepted work scope mapping unavailable' USING ERRCODE='22023';END IF;
   formation_home:=scope_value.definition->>'locationKey';
   SELECT * INTO travel_value FROM public.canonical_travel_plans value WHERE value.organization_id=org
    AND value.estimate_id=estimate_value.id ORDER BY value.revision DESC LIMIT 1;
   SELECT * INTO equipment_value FROM public.canonical_equipment_plans value WHERE value.organization_id=org
    AND value.estimate_id=estimate_value.id ORDER BY value.revision DESC LIMIT 1;
   SELECT * INTO readiness_value FROM public.canonical_equipment_readiness_plans value WHERE value.organization_id=org
    AND value.estimate_id=estimate_value.id ORDER BY value.revision DESC LIMIT 1;
   IF (scope_value.definition#>>'{applicability,travel}')::boolean
      AND (travel_value.id IS NULL OR travel_value.action<>'save') THEN
    RAISE EXCEPTION 'Current job travel basis unavailable' USING ERRCODE='22023';END IF;
   IF (scope_value.definition#>>'{applicability,equipment}')::boolean
      AND (equipment_value.id IS NULL OR equipment_value.action<>'save') THEN
    RAISE EXCEPTION 'Current job equipment basis unavailable' USING ERRCODE='22023';END IF;
   definition_value:=jsonb_build_object('alternativeKey',alternative_value,'scopeKey',scope_value.scope_key,
    'appointmentId',work_item->>'appointmentId','assignmentId',work_item->>'assignmentId',
    'crewApplicable',scope_value.definition#>'{applicability,crew}',
    'skillApplicable',scope_value.definition#>'{applicability,skill}',
    'workingHoursApplicable',scope_value.definition#>'{applicability,workingHours}',
    'locationApplicable',scope_value.definition#>'{applicability,location}',
    'travelApplicable',scope_value.definition#>'{applicability,travel}',
    'vehicleApplicable',scope_value.definition#>'{applicability,vehicle}',
    'equipmentApplicable',scope_value.definition#>'{applicability,equipment}',
     'locationKey',location_value,'previousLocationKey',formation_home,'nextLocationKey',formation_home,
    'vehicleAssetIds',scope_value.definition->'vehicleAssetIds',
    'equipmentAssetIds',scope_value.definition->'equipmentAssetIds',
    'equipmentBasis',CASE WHEN (scope_value.definition#>>'{applicability,equipment}')::boolean
      THEN jsonb_build_object('kind','m24_adopted','receiptId',equipment_value.id,'digest',rtrim(equipment_value.digest))
      ELSE jsonb_build_object('kind','not_applicable','receiptId',NULL,'digest',NULL) END,
    'readinessBasis',CASE WHEN (scope_value.definition#>>'{applicability,equipment}')::boolean
       AND readiness_value.id IS NOT NULL AND readiness_value.action='save'
      THEN jsonb_build_object('kind','m24_adopted','receiptId',readiness_value.id,'digest',rtrim(readiness_value.digest))
      WHEN (scope_value.definition#>>'{applicability,equipment}')::boolean
      THEN jsonb_build_object('kind','part5b_owner_reviewed','receiptId',NULL,'digest',NULL)
      ELSE jsonb_build_object('kind','not_applicable','receiptId',NULL,'digest',NULL) END,
    'travelBasis',CASE WHEN (scope_value.definition#>>'{applicability,travel}')::boolean
      THEN jsonb_build_object('kind','m24_adopted','receiptId',travel_value.id,'digest',rtrim(travel_value.digest))
      ELSE jsonb_build_object('kind','not_applicable','receiptId',NULL,'digest',NULL) END);
   IF public.canonical_forecast_constrained_capacity_v1_definition_valid('job',definition_value) IS NOT TRUE THEN
    RAISE EXCEPTION 'Exact source-derived job constraint invalid' USING ERRCODE='22023';END IF;
   source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(
    org,'job',scope_value.scope_key,(work_item->>'appointmentId')::uuid,definition_value);
   current_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
    org,'job',scope_value.scope_key,(work_item->>'appointmentId')::uuid);
   entries_value:=entries_value||jsonb_build_array(jsonb_build_object('scopeKey',scope_value.scope_key,
    'subjectId',work_item->>'appointmentId','definition',definition_value,
    'expectedRevision',COALESCE(current_value.revision,0),'expectedDigest',COALESCE(rtrim(current_value.digest),'none'),
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
  RAISE EXCEPTION 'Accepted work alternative unavailable' USING ERRCODE='22023';END IF;
 IF planned_count>1000 OR octet_length(entries_value::text)>1048576 THEN
  RAISE EXCEPTION 'Job constraint census exceeds bound' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('state',CASE WHEN needs_review THEN 'ready' ELSE 'complete' END,
  'entries',entries_value,'marker',jsonb_build_object('kind','exact_accepted_job_constraints',
   'source',public.canonical_completion_digest(jsonb_build_object('census',census_value,'entries',entries_value))));
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '22P02' OR SQLSTATE '54000' THEN
 RETURN jsonb_build_object('state','unavailable','entries','[]'::jsonb,
  'marker',jsonb_build_object('state','exact_job_constraint_unavailable'));
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_capacity_ui_v3_job_plan(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_forecast_capacity_ui_v5_job_plan(org,cutoff_value)
$$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v5_setup_plan(org UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;private_plan JSONB;
BEGIN
 value:=public.canonical_forecast_capacity_ui_v3_setup_plan(org);
 IF value->>'state'='ready' AND value->>'action'='constrained_work_scopes' THEN
  private_plan:=public.canonical_forecast_capacity_ui_v5_scope_plan(
   org,public.canonical_forecast_workload_capacity_v1_clock(),NULL);
  IF private_plan->>'state'='ready' THEN value:=value||jsonb_build_object('scopeReviews',private_plan->'reviews');
  ELSE value:=jsonb_build_object('state','unavailable','action',NULL,'token',NULL,'lane','all',
    'label','Exact seven-dimension sources unavailable',
    'explanation','A location, route, skill, role, vehicle, equipment or availability source is absent or contradictory. No constraint review was written.',
    'reasonLimit',NULL,'hiringConsecutivePeriods',COALESCE((value->>'hiringConsecutivePeriods')::int,3),
    'scopeReviews','[]'::jsonb);END IF;
 ELSIF value->>'state'='waiting' AND value->>'lane'='workload' THEN
  -- Once the constrained epoch and method are installed, the v3 sequencer
  -- otherwise falls back to the ordinary prospective wait when an exact
  -- formation source is absent. Surface that prerequisite failure honestly;
  -- no setup control is enabled and no partial scope can be written.
  IF (public.canonical_forecast_constrained_capacity_v1_work_census(
       org,public.canonical_forecast_workload_capacity_v1_clock())->>'count')::int>0 THEN
   private_plan:=public.canonical_forecast_capacity_ui_v5_scope_plan(
    org,public.canonical_forecast_workload_capacity_v1_clock(),NULL);
  END IF;
  IF private_plan->>'state'='unavailable' THEN
   value:=jsonb_build_object('state','unavailable','action',NULL,'token',NULL,'lane','all',
    'label','Exact seven-dimension sources unavailable',
    'explanation','A location, route, skill, role, vehicle, equipment or availability source is absent or contradictory. No constraint review was written.',
    'reasonLimit',NULL,'hiringConsecutivePeriods',COALESCE((value->>'hiringConsecutivePeriods')::int,3),
    'scopeReviews','[]'::jsonb);
  ELSE value:=value||jsonb_build_object('scopeReviews','[]'::jsonb);END IF;
 ELSE value:=value||jsonb_build_object('scopeReviews','[]'::jsonb);END IF;
 RETURN value-'_source';
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v5_current(
 org UUID,actor UUID,actor_role TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;authority JSONB;
BEGIN
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,NULL,FALSE);
 value:=public.canonical_forecast_capacity_ui_v3_current(org,actor,actor_role,session_value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 value:=jsonb_set(value,'{setup}',public.canonical_forecast_capacity_ui_v5_setup_plan(org),FALSE);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,NULL,FALSE);
 RETURN value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v5_setup_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,token_value TEXT,hiring_periods INTEGER,scope_reviews JSONB,
 reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 authority JSONB;plan_value JSONB;private_plan JSONB;entry_value JSONB;assigned_value JSONB;
 child_result JSONB;result_value JSONB;review_source JSONB;request_hash TEXT;key_hash TEXT;
 old_request public.canonical_forecast_capacity_ui_setup_requests_v2%ROWTYPE;
 role_generation public.canonical_forecast_workload_capacity_role_generations_v1%ROWTYPE;
 workload_review public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 last_id UUID:=NULL;last_revision BIGINT:=NULL;now_value TIMESTAMPTZ;
BEGIN
 IF action_value<>'constrained_work_scopes' THEN
  IF scope_reviews IS DISTINCT FROM '[]'::jsonb THEN
   RAISE EXCEPTION 'Scope classifications only belong to scope review' USING ERRCODE='22023';END IF;
  RETURN public.canonical_forecast_capacity_ui_v3_setup_mutate(org,actor,actor_role,session_value,csrf,
   key_value,action_value,token_value,hiring_periods,reason_value,confirmation_value);
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' OR token_value!~'^[0-9a-f]{64}$'
    OR hiring_periods NOT BETWEEN 2 AND 12 OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
    OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-capacity-ui-setup-v2'
    OR jsonb_typeof(scope_reviews)<>'array' THEN
  RAISE EXCEPTION 'Capacity UI scope setup request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,actor_role,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_capacity_advisory_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('action',action_value,'token',token_value,
  'hiringConsecutivePeriods',hiring_periods,'scopeReviews',scope_reviews,'reason',btrim(reason_value),
  'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:capacity-ui-setup-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old_request FROM public.canonical_forecast_capacity_ui_setup_requests_v2 value
  WHERE value.organization_id=org AND value.actor_id=actor AND value.idempotency_key_hash=key_hash;
 IF old_request.idempotency_key_hash IS NOT NULL THEN
  IF old_request.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Capacity UI setup replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
  RETURN jsonb_set(old_request.response,'{replayed}','true'::jsonb,FALSE);
 END IF;
 plan_value:=public.canonical_forecast_capacity_ui_v5_setup_plan(org);
 IF plan_value->>'state'<>'ready' OR plan_value->>'action'<>action_value OR plan_value->>'token'<>token_value
    OR jsonb_array_length(scope_reviews)<>jsonb_array_length(plan_value->'scopeReviews')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_reviews) submitted
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan_value->'scopeReviews') offered
       WHERE offered->>'scopeKey'=submitted->>'scopeKey')) THEN
  RAISE EXCEPTION 'Capacity UI exact scope setup changed' USING ERRCODE='40001';END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 private_plan:=public.canonical_forecast_capacity_ui_v5_scope_plan(org,now_value,scope_reviews);
 IF private_plan->>'state'<>'ready' THEN
  RAISE EXCEPTION 'Exact work formation census changed' USING ERRCODE='40001';END IF;
 FOR entry_value IN SELECT entry FROM jsonb_array_elements(private_plan->'entries') entries(entry)
  WHERE (entry->>'needsReview')::boolean ORDER BY entry->>'scopeKey' LOOP
  FOR assigned_value IN SELECT assigned FROM jsonb_array_elements(entry_value#>'{definition,crewAssignments}') assignments(assigned)
   ORDER BY assigned->>'profileId' LOOP
   SELECT DISTINCT ON(value.profile_id) value.* INTO role_generation
    FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
    WHERE value.organization_id=org AND value.profile_id=(assigned_value->>'profileId')::uuid
    ORDER BY value.profile_id,value.source_order DESC;
   review_source:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,role_generation.operational_role);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='role_qualification'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   IF workload_review.id IS NULL OR workload_review.action<>'approve'
      OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(review_source) THEN
    child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
     public.canonical_forecast_capacity_ui_v2_child_key(key_value,'scope-role-'||role_generation.profile_id::text),
     'role_qualification','capacity.available_role_hours.v1',role_generation.profile_id,
     role_generation.operational_role,'approve',COALESCE(workload_review.revision,0),
     COALESCE(rtrim(workload_review.digest),'none'),NULL,reason_value,'m26-workload-capacity-review-v1');
    last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
   END IF;
   review_source:=public.canonical_forecast_workload_capacity_v1_review_source(org,
    'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL);
   SELECT * INTO workload_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='availability_basis'
     AND value.subject_id=role_generation.profile_id ORDER BY value.revision DESC LIMIT 1;
   IF workload_review.id IS NULL OR workload_review.action<>'approve'
      OR workload_review.source_digest IS DISTINCT FROM public.canonical_completion_digest(review_source) THEN
    child_result:=public.canonical_forecast_workload_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
     public.canonical_forecast_capacity_ui_v2_child_key(key_value,'scope-availability-'||role_generation.profile_id::text),
     'availability_basis','capacity.available_role_hours.v1',role_generation.profile_id,NULL,'approve',
     COALESCE(workload_review.revision,0),COALESCE(rtrim(workload_review.digest),'none'),NULL,reason_value,
     'm26-workload-capacity-review-v1');
    last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
   END IF;
  END LOOP;
  IF (entry_value->>'scopeNeedsReview')::boolean THEN
   child_result:=public.canonical_forecast_constrained_capacity_v1_review_mutate(org,actor,actor_role,session_value,csrf,
    public.canonical_forecast_capacity_ui_v2_child_key(key_value,'scope-'||(entry_value->>'scopeKey')),
    'scope',entry_value->>'scopeKey',NULL,'approve',(entry_value->>'expectedRevision')::bigint,
    entry_value->>'expectedDigest',entry_value->'definition',reason_value,'m26-constrained-capacity-review-v1');
   last_id:=(child_result->>'id')::uuid;last_revision:=(child_result->>'revision')::bigint;
  END IF;
 END LOOP;
 IF public.canonical_forecast_capacity_ui_v5_scope_plan(org,now_value,NULL)->>'state'<>'complete'
    OR last_id IS NULL OR last_revision IS NULL THEN
  RAISE EXCEPTION 'Exact work formation review incomplete' USING ERRCODE='40001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,actor_role,session_value,csrf,TRUE);
 result_value:=jsonb_build_object('state','capacity_research_setup_recorded','action',action_value,
  'token',token_value,'receiptId',last_id,'revision',last_revision,'hiringConsecutivePeriods',hiring_periods,
  'researchOnly',TRUE,'automaticActionTaken',FALSE,'replayed',FALSE);
 INSERT INTO public.canonical_forecast_capacity_ui_setup_requests_v2(
  organization_id,actor_id,idempotency_key_hash,request_digest,response,created_at)
 VALUES(org,actor,key_hash,request_hash,result_value,public.canonical_forecast_workload_capacity_v1_clock());
 RETURN result_value;
END $$;

CREATE FUNCTION public.canonical_forecast_capacity_ui_v5_action_mutate(
 org UUID,actor UUID,actor_role TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,origin_value UUID,outcome_value UUID,correction_value UUID,
 expected_revision BIGINT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_forecast_capacity_ui_v3_action_mutate(org,actor,actor_role,session_value,csrf,key_value,
  action_value,origin_value,outcome_value,correction_value,expected_revision,reason_value,confirmation_value)
$$;

REVOKE ALL ON FUNCTION
 public.canonical_forecast_capacity_ui_v5_scope_plan(uuid,timestamptz,jsonb),
 public.canonical_forecast_capacity_ui_v5_job_plan(uuid,timestamptz),
 public.canonical_forecast_capacity_ui_v5_setup_plan(uuid),
 public.canonical_forecast_capacity_ui_v5_current(uuid,uuid,text,uuid),
 public.canonical_forecast_capacity_ui_v5_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text),
 public.canonical_forecast_capacity_ui_v5_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)
 FROM PUBLIC;

DO $$ DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_capacity_ui_v5_scope_plan(uuid,timestamptz,jsonb),public.canonical_forecast_capacity_ui_v5_job_plan(uuid,timestamptz),public.canonical_forecast_capacity_ui_v5_setup_plan(uuid) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_capacity_ui_v5_current(uuid,uuid,text,uuid),public.canonical_forecast_capacity_ui_v5_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text),public.canonical_forecast_capacity_ui_v5_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text) TO %I',runtime_role);
 END IF;
END $$;
