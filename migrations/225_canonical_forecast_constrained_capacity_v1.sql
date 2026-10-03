-- Mission 26 Part 5B: purpose-fixed, tenant-private constrained role capacity.
-- Additive only.  This authority never schedules work, reserves an asset, or
-- exposes a numeric forecast.  All source declarations are explicit human
-- reviews and remain narrower than provider, credential, attendance or
-- physical-availability proof.
CREATE SEQUENCE public.canonical_forecast_constrained_capacity_source_order_v1;

CREATE TABLE public.canonical_forecast_constrained_capacity_source_fences_v1 (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 generation BIGINT NOT NULL DEFAULT 0 CHECK(generation>=0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.canonical_forecast_constrained_capacity_source_fences_v1(organization_id)
 SELECT id FROM public.organizations ON CONFLICT DO NOTHING;

CREATE TABLE public.canonical_forecast_constrained_capacity_source_events_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_order BIGINT NOT NULL DEFAULT nextval('public.canonical_forecast_constrained_capacity_source_order_v1'),
 source_kind TEXT NOT NULL,
 subject_key TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('BASELINE','INSERT','UPDATE','DELETE')),
 observed_at TIMESTAMPTZ NOT NULL,
 before_payload JSONB,
 after_payload JSONB,
 row_digest CHAR(64) NOT NULL CHECK(row_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,source_order),
 CHECK(length(source_kind) BETWEEN 1 AND 100 AND length(subject_key) BETWEEN 1 AND 200)
);

CREATE TABLE public.canonical_forecast_constrained_capacity_methods_v1 (
 method_key TEXT PRIMARY KEY,
 calculation_version TEXT NOT NULL UNIQUE,
 definition JSONB NOT NULL,
 digest CHAR(64) NOT NULL CHECK(digest~'^[0-9a-f]{64}$')
);
INSERT INTO public.canonical_forecast_constrained_capacity_methods_v1
VALUES('capacity.available_role_hours.v1','m26-constrained-declared-role-supply-v1',
 jsonb_build_object('unit','role_worker_hours','window','half_open_30_elapsed_days',
  'training','none','scope','server_selected_all_active_reviews','numericServing',FALSE,
  'automaticAction',FALSE),
 public.canonical_completion_digest(jsonb_build_object('method','m26-constrained-declared-role-supply-v1')));

CREATE TABLE public.canonical_forecast_constrained_capacity_epochs_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),revision BIGINT NOT NULL,
 previous_id UUID,installed_at TIMESTAMPTZ NOT NULL,source_order BIGINT NOT NULL,
 reason TEXT NOT NULL,confirmation_version TEXT NOT NULL CHECK(confirmation_version='m26-constrained-capacity-epoch-v1'),
 actor_id UUID NOT NULL,membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash CHAR(64) NOT NULL,request_digest CHAR(64) NOT NULL,digest CHAR(64) NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,revision),
 UNIQUE(organization_id,actor_id,idempotency_key_hash),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_constrained_capacity_epochs_v1(organization_id,id),
 CHECK(length(reason) BETWEEN 10 AND 1000),
 CHECK(idempotency_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$' AND digest~'^[0-9a-f]{64}$')
);

CREATE TABLE public.canonical_forecast_constrained_capacity_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),review_kind TEXT NOT NULL CHECK(review_kind IN('method','scope','job')),
 scope_key TEXT,subject_id UUID,revision BIGINT NOT NULL,previous_id UUID,
 action TEXT NOT NULL CHECK(action IN('approve','reject','withdraw')),
 definition JSONB NOT NULL,source_identity JSONB NOT NULL,source_digest CHAR(64) NOT NULL,
 decided_at TIMESTAMPTZ NOT NULL,reason TEXT NOT NULL,actor_id UUID NOT NULL,membership_id UUID NOT NULL,
 session_id UUID NOT NULL,idempotency_key_hash CHAR(64) NOT NULL,request_digest CHAR(64) NOT NULL,
 digest CHAR(64) NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,review_kind,scope_key,subject_id,revision),
 UNIQUE(organization_id,actor_id,idempotency_key_hash),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_constrained_capacity_reviews_v1(organization_id,id),
 CHECK(jsonb_typeof(definition)='object' AND jsonb_typeof(source_identity)='object'),
 CHECK(source_digest~'^[0-9a-f]{64}$' AND idempotency_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$' AND digest~'^[0-9a-f]{64}$'),
 CHECK(length(reason) BETWEEN 10 AND 1000),
 CHECK((review_kind='method' AND scope_key IS NULL AND subject_id IS NULL) OR
  (review_kind='scope' AND scope_key IS NOT NULL AND subject_id IS NULL) OR
  (review_kind='job' AND scope_key IS NOT NULL AND subject_id IS NOT NULL))
);

CREATE TABLE public.canonical_forecast_constrained_capacity_origins_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),epoch_id UUID NOT NULL,
 prediction_cutoff_at TIMESTAMPTZ NOT NULL,horizon_ends_at TIMESTAMPTZ NOT NULL,
 input_manifest JSONB NOT NULL,private_results JSONB NOT NULL,scope_count INTEGER NOT NULL,
 actor_id UUID NOT NULL,membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash CHAR(64) NOT NULL,request_digest CHAR(64) NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL,digest CHAR(64) NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,actor_id,idempotency_key_hash),
 FOREIGN KEY(organization_id,epoch_id) REFERENCES public.canonical_forecast_constrained_capacity_epochs_v1(organization_id,id),
 CHECK(horizon_ends_at=prediction_cutoff_at+INTERVAL '2592000 seconds'),
 CHECK(scope_count BETWEEN 1 AND 20 AND jsonb_typeof(input_manifest)='object' AND jsonb_typeof(private_results)='array'),
 CHECK(octet_length(input_manifest::text)<=524288 AND octet_length(private_results::text)<=262144),
 CHECK(idempotency_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$' AND digest~'^[0-9a-f]{64}$')
);

CREATE TABLE public.canonical_forecast_constrained_capacity_outcomes_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),origin_id UUID NOT NULL,revision BIGINT NOT NULL,previous_id UUID,
 source_manifest JSONB NOT NULL,private_results JSONB NOT NULL,captured_at TIMESTAMPTZ NOT NULL,
 actor_id UUID NOT NULL,membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash CHAR(64) NOT NULL,request_digest CHAR(64) NOT NULL,digest CHAR(64) NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,origin_id,revision),
 UNIQUE(organization_id,actor_id,idempotency_key_hash),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_constrained_capacity_origins_v1(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_constrained_capacity_outcomes_v1(organization_id,id),
 CHECK(jsonb_typeof(source_manifest)='object' AND jsonb_typeof(private_results)='array'),
 CHECK(octet_length(source_manifest::text)<=524288 AND octet_length(private_results::text)<=262144),
 CHECK(idempotency_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$' AND digest~'^[0-9a-f]{64}$')
);

CREATE TABLE public.canonical_forecast_constrained_capacity_evaluations_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),origin_id UUID NOT NULL,outcome_id UUID NOT NULL,
 revision BIGINT NOT NULL,previous_id UUID,private_metrics JSONB NOT NULL,captured_at TIMESTAMPTZ NOT NULL,
 actor_id UUID NOT NULL,membership_id UUID NOT NULL,session_id UUID NOT NULL,
 idempotency_key_hash CHAR(64) NOT NULL,request_digest CHAR(64) NOT NULL,digest CHAR(64) NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,origin_id,revision),
 UNIQUE(organization_id,actor_id,idempotency_key_hash),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_constrained_capacity_origins_v1(organization_id,id),
 FOREIGN KEY(organization_id,outcome_id) REFERENCES public.canonical_forecast_constrained_capacity_outcomes_v1(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_constrained_capacity_evaluations_v1(organization_id,id),
 CHECK(jsonb_typeof(private_metrics)='array' AND octet_length(private_metrics::text)<=262144),
 CHECK(idempotency_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$' AND digest~'^[0-9a-f]{64}$')
);

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Constrained-capacity evidence is immutable' USING ERRCODE='42501';END $$;
DO $$ DECLARE item RECORD;BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('canonical_forecast_constrained_capacity_source_events_v1','z_m26_p5b_immutable_source_events'),
  ('canonical_forecast_constrained_capacity_methods_v1','z_m26_p5b_immutable_methods'),
  ('canonical_forecast_constrained_capacity_epochs_v1','z_m26_p5b_immutable_epochs'),
  ('canonical_forecast_constrained_capacity_reviews_v1','z_m26_p5b_immutable_reviews'),
  ('canonical_forecast_constrained_capacity_origins_v1','z_m26_p5b_immutable_origins'),
  ('canonical_forecast_constrained_capacity_outcomes_v1','z_m26_p5b_immutable_outcomes'),
  ('canonical_forecast_constrained_capacity_evaluations_v1','z_m26_p5b_immutable_evaluations')) value(table_name,trigger_name)
 LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_constrained_capacity_v1_immutable()',item.trigger_name,item.table_name);END LOOP;
END $$;

-- Each human-created epoch takes an exact installed-source baseline under the
-- same writer fences used by all later observations.  Baselines do not grant
-- approval or fabricate history; they only make subsequent, genuinely
-- observed source transitions reconstructable on half-open subintervals.
CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_source_baseline(
 org UUID,observed_value TIMESTAMPTZ)
RETURNS BIGINT LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE table_value TEXT;statement_value TEXT;maximum_order BIGINT:=0;
BEGIN
 FOR table_value IN SELECT unnest(ARRAY[
  'workforce_crews','workforce_crew_members','workforce_skills','workforce_profile_skills',
  'canonical_business_profiles','tenant_assets','tenant_asset_service_capabilities',
  'canonical_equipment_events','canonical_equipment_plans','canonical_equipment_readiness_plans',
  'canonical_travel_plans','canonical_schedule_assignments','canonical_schedule_assignment_revisions',
  'canonical_schedule_approvals','canonical_schedule_human_approvals','canonical_workforce_availability_revisions',
  'canonical_estimates','canonical_completion_records',
  'canonical_opportunities'])
 LOOP
  statement_value:=format($sql$
   INSERT INTO public.canonical_forecast_constrained_capacity_source_events_v1(
    organization_id,source_kind,subject_key,operation,observed_at,before_payload,after_payload,row_digest)
   SELECT $1,%L,public.canonical_forecast_constrained_capacity_v1_source_subject(%L,to_jsonb(value)),
    'BASELINE',$2,NULL,to_jsonb(value),public.canonical_completion_digest(jsonb_build_object(
     'table',%L,'operation','BASELINE','subject',
     public.canonical_forecast_constrained_capacity_v1_source_subject(%L,to_jsonb(value)),
     'after',to_jsonb(value),'observedAt',$2))
   FROM public.%I value WHERE value.organization_id=$1 ORDER BY 3$sql$,
   table_value,table_value,table_value,table_value,table_value);
  EXECUTE statement_value USING org,observed_value;
 END LOOP;
 SELECT COALESCE(max(source_order),0) INTO maximum_order
 FROM public.canonical_forecast_constrained_capacity_source_events_v1 WHERE organization_id=org;
 RETURN maximum_order;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_source_payload_at(
 org UUID,kind_value TEXT,subject_value TEXT,instant_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value.after_payload
 FROM public.canonical_forecast_constrained_capacity_source_events_v1 value
 WHERE value.organization_id=org AND value.source_kind=kind_value AND value.subject_key=subject_value
  AND value.observed_at<=instant_value
 ORDER BY CASE WHEN kind_value IN('canonical_schedule_assignment_revisions',
     'canonical_workforce_availability_revisions')
    THEN COALESCE((value.after_payload->>'revision')::bigint,-1) ELSE 0 END DESC,
   value.observed_at DESC,value.source_order DESC LIMIT 1
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_lock_sources(org UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-source:'||org,0));
 PERFORM generation FROM public.canonical_forecast_constrained_capacity_source_fences_v1
  WHERE organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Constrained-capacity source fence unavailable' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 LOCK TABLE public.workforce_crews,public.workforce_crew_members,public.workforce_skills,public.workforce_profile_skills,
 public.canonical_business_profiles,public.tenant_assets,public.tenant_asset_service_capabilities,
  public.canonical_equipment_events,public.canonical_equipment_plans,
  public.canonical_equipment_readiness_plans,public.canonical_travel_plans,
  public.canonical_schedule_assignments,public.canonical_schedule_assignment_revisions,
  public.canonical_schedule_approvals,public.canonical_schedule_human_approvals,
  public.canonical_estimates,public.canonical_opportunities,public.canonical_field_executions,
  public.canonical_completion_records IN SHARE MODE;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_uuid_array(array_value JSONB,max_count INTEGER)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(array_value)='array' AND jsonb_array_length(array_value)<=max_count
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(array_value) AS entries(item)
   WHERE jsonb_typeof(item)<>'string' OR item#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  AND (SELECT count(*)=count(DISTINCT lower(item#>>'{}')) FROM jsonb_array_elements(array_value) AS entries(item))
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_intervals(intervals_value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(intervals_value)='array' AND jsonb_array_length(intervals_value)<=200
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(intervals_value) AS entries(item)
   WHERE NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['start','end'])
    OR jsonb_typeof(item->'start')<>'string' OR jsonb_typeof(item->'end')<>'string'
    OR (item->>'start')::timestamptz>=(item->>'end')::timestamptz)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(intervals_value) WITH ORDINALITY AS left_rows(left_item,left_index)
   JOIN jsonb_array_elements(intervals_value) WITH ORDINALITY AS right_rows(right_item,right_index)
    ON left_index<right_index
   WHERE (left_item->>'start')::timestamptz<(right_item->>'end')::timestamptz
    AND (left_item->>'end')::timestamptz>(right_item->>'start')::timestamptz)
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_definition_valid(kind_value TEXT,definition_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB;keys TEXT[];roles TEXT[]:=ARRAY['owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other'];
 asset_ids TEXT[]:=ARRAY[]::TEXT[];
BEGIN
 IF jsonb_typeof(definition_value)<>'object' OR octet_length(definition_value::text)>262144 THEN RETURN FALSE;END IF;
 IF kind_value='method' THEN RETURN public.canonical_field_evidence_object_keys_exact(definition_value,ARRAY['methodVersion'])
  AND definition_value->>'methodVersion'='m26-constrained-declared-role-supply-v1';END IF;
 IF kind_value='job' THEN
  RETURN public.canonical_field_evidence_object_keys_exact(definition_value,
   ARRAY['alternativeKey','scopeKey','appointmentId','assignmentId','crewApplicable','skillApplicable','workingHoursApplicable',
    'locationApplicable','travelApplicable','vehicleApplicable','equipmentApplicable','locationKey',
    'previousLocationKey','nextLocationKey','vehicleAssetIds','equipmentAssetIds','equipmentBasis',
    'readinessBasis','travelBasis'])
   AND definition_value->>'alternativeKey'~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   AND definition_value->>'scopeKey'~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   AND definition_value->>'appointmentId'~*'^[0-9a-f-]{36}$' AND definition_value->>'assignmentId'~*'^[0-9a-f-]{36}$'
   AND jsonb_typeof(definition_value->'crewApplicable')='boolean'
   AND jsonb_typeof(definition_value->'skillApplicable')='boolean'
   AND definition_value->'workingHoursApplicable'='true'::jsonb
   AND jsonb_typeof(definition_value->'locationApplicable')='boolean'
   AND jsonb_typeof(definition_value->'travelApplicable')='boolean'
   AND jsonb_typeof(definition_value->'vehicleApplicable')='boolean'
   AND jsonb_typeof(definition_value->'equipmentApplicable')='boolean'
   AND definition_value->>'locationKey'~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   AND definition_value->>'previousLocationKey'~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   AND definition_value->>'nextLocationKey'~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   AND public.canonical_forecast_constrained_capacity_v1_uuid_array(definition_value->'vehicleAssetIds',20)
   AND public.canonical_forecast_constrained_capacity_v1_uuid_array(definition_value->'equipmentAssetIds',20)
   AND ((definition_value->'vehicleApplicable')::boolean=(jsonb_array_length(definition_value->'vehicleAssetIds')>0))
   AND ((definition_value->'equipmentApplicable')::boolean=(jsonb_array_length(definition_value->'equipmentAssetIds')>0))
   AND public.canonical_field_evidence_object_keys_exact(definition_value->'equipmentBasis',ARRAY['kind','receiptId','digest'])
   AND public.canonical_field_evidence_object_keys_exact(definition_value->'readinessBasis',ARRAY['kind','receiptId','digest'])
   AND public.canonical_field_evidence_object_keys_exact(definition_value->'travelBasis',ARRAY['kind','receiptId','digest'])
   AND definition_value#>>'{equipmentBasis,kind}' IN('part5b_owner_reviewed','m24_adopted','not_applicable')
   AND definition_value#>>'{readinessBasis,kind}' IN('part5b_owner_reviewed','m24_adopted','not_applicable')
   AND definition_value#>>'{travelBasis,kind}' IN('part5b_owner_reviewed','m24_adopted','not_applicable')
   AND ((definition_value#>>'{equipmentBasis,kind}'='m24_adopted'
       AND definition_value#>>'{equipmentBasis,receiptId}'~*'^[0-9a-f-]{36}$'
       AND definition_value#>>'{equipmentBasis,digest}'~'^[0-9a-f]{64}$')
    OR (definition_value#>>'{equipmentBasis,kind}'<>'m24_adopted'
       AND definition_value#>'{equipmentBasis,receiptId}'='null'::jsonb
       AND definition_value#>'{equipmentBasis,digest}'='null'::jsonb))
   AND ((definition_value#>>'{readinessBasis,kind}'='m24_adopted'
       AND definition_value#>>'{readinessBasis,receiptId}'~*'^[0-9a-f-]{36}$'
       AND definition_value#>>'{readinessBasis,digest}'~'^[0-9a-f]{64}$')
    OR (definition_value#>>'{readinessBasis,kind}'<>'m24_adopted'
       AND definition_value#>'{readinessBasis,receiptId}'='null'::jsonb
       AND definition_value#>'{readinessBasis,digest}'='null'::jsonb))
   AND ((definition_value#>>'{travelBasis,kind}'='m24_adopted'
       AND definition_value#>>'{travelBasis,receiptId}'~*'^[0-9a-f-]{36}$'
       AND definition_value#>>'{travelBasis,digest}'~'^[0-9a-f]{64}$')
    OR (definition_value#>>'{travelBasis,kind}'<>'m24_adopted'
       AND definition_value#>'{travelBasis,receiptId}'='null'::jsonb
       AND definition_value#>'{travelBasis,digest}'='null'::jsonb))
   AND ((definition_value->>'equipmentApplicable')::boolean
     OR definition_value#>>'{equipmentBasis,kind}'='not_applicable')
   AND ((definition_value->>'equipmentApplicable')::boolean
     OR definition_value#>>'{readinessBasis,kind}'='not_applicable')
   AND ((definition_value->>'travelApplicable')::boolean
     OR definition_value#>>'{travelBasis,kind}'='not_applicable')
   AND (NOT (definition_value->>'equipmentApplicable')::boolean
     OR definition_value#>>'{equipmentBasis,kind}'<>'not_applicable')
   AND (NOT (definition_value->>'equipmentApplicable')::boolean
     OR definition_value#>>'{readinessBasis,kind}'<>'not_applicable')
   AND (NOT (definition_value->>'travelApplicable')::boolean
     OR definition_value#>>'{travelBasis,kind}'<>'not_applicable');
 END IF;
 IF kind_value<>'scope' OR NOT public.canonical_field_evidence_object_keys_exact(definition_value,
  ARRAY['alternativeKey','scopeKey','role','applicability','crewIds','crewRoleRequirements','crewAssignments',
   'skillIds','locationKey','travelPairs','vehicleAssetIds','equipmentAssetIds','operatorProfileIds',
   'assetAssignments','assetRequirements','assetCalendars']) THEN RETURN FALSE;END IF;
 IF definition_value->>'alternativeKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  OR definition_value->>'scopeKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  OR NOT(definition_value->>'role'=ANY(roles))
  OR NOT public.canonical_field_evidence_object_keys_exact(definition_value->'applicability',
   ARRAY['crew','skill','workingHours','location','travel','vehicle','equipment'])
  OR EXISTS(SELECT 1 FROM jsonb_each(definition_value->'applicability') pair WHERE jsonb_typeof(pair.value)<>'boolean')
  OR definition_value#>'{applicability,workingHours}'<>'true'::jsonb
  OR NOT public.canonical_forecast_constrained_capacity_v1_uuid_array(definition_value->'crewIds',20)
  OR NOT public.canonical_forecast_constrained_capacity_v1_uuid_array(definition_value->'skillIds',20)
  OR NOT public.canonical_forecast_constrained_capacity_v1_uuid_array(definition_value->'vehicleAssetIds',20)
  OR NOT public.canonical_forecast_constrained_capacity_v1_uuid_array(definition_value->'equipmentAssetIds',20)
  OR NOT public.canonical_forecast_constrained_capacity_v1_uuid_array(definition_value->'operatorProfileIds',100)
  OR definition_value->>'locationKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  OR jsonb_typeof(definition_value->'crewRoleRequirements')<>'array' OR jsonb_array_length(definition_value->'crewRoleRequirements')>20
  OR jsonb_typeof(definition_value->'travelPairs')<>'array' OR jsonb_array_length(definition_value->'travelPairs')>200
  OR jsonb_typeof(definition_value->'crewAssignments')<>'array' OR jsonb_array_length(definition_value->'crewAssignments')>100
  OR jsonb_typeof(definition_value->'assetAssignments')<>'array' OR jsonb_array_length(definition_value->'assetAssignments')>40
  OR NOT public.canonical_field_evidence_object_keys_exact(definition_value->'assetRequirements',
    ARRAY['vehiclePerSeat','equipmentPerSeat'])
  OR definition_value#>>'{assetRequirements,vehiclePerSeat}'!~'^(0|[1-9][0-9]?)$'
  OR definition_value#>>'{assetRequirements,equipmentPerSeat}'!~'^(0|[1-9][0-9]?)$'
  OR jsonb_typeof(definition_value->'assetCalendars')<>'array' OR jsonb_array_length(definition_value->'assetCalendars')>40 THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements(definition_value->'crewRoleRequirements') AS entries(entry) LOOP
  IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['role','count']) OR NOT(item->>'role'=ANY(roles))
   OR jsonb_typeof(item->'count')<>'number' OR item->>'count'!~'^[1-9][0-9]?$' THEN RETURN FALSE;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewRoleRequirements') AS entries(crew_entry)
    GROUP BY crew_entry->>'role' HAVING count(*)>1) THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements(definition_value->'crewAssignments') AS entries(entry) LOOP
 IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['profileId','crewId','role'])
   OR item->>'profileId'!~*'^[0-9a-f-]{36}$'
   OR NOT(item->'crewId'='null'::jsonb OR item->>'crewId'~*'^[0-9a-f-]{36}$')
   OR NOT(item->>'role'=ANY(roles)) THEN RETURN FALSE;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewAssignments') entry
   GROUP BY lower(entry->>'profileId'),COALESCE(lower(entry->>'crewId'),''),entry->>'role' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewAssignments') entry
   WHERE (entry->'crewId'<>'null'::jsonb AND entry->>'crewId' NOT IN
      (SELECT value#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') value))
      OR ((definition_value#>>'{applicability,crew}')::boolean AND entry->>'role' NOT IN
        (SELECT value->>'role' FROM jsonb_array_elements(definition_value->'crewRoleRequirements') value))
      OR (NOT (definition_value#>>'{applicability,crew}')::boolean
        AND entry->>'role' IS DISTINCT FROM definition_value->>'role'))
 THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements(definition_value->'assetAssignments') AS entries(entry) LOOP
  IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['assetId','crewId','kind','operatorProfileId'])
   OR item->>'assetId'!~*'^[0-9a-f-]{36}$'
   OR NOT(item->'crewId'='null'::jsonb OR item->>'crewId'~*'^[0-9a-f-]{36}$')
   OR item->>'operatorProfileId'!~*'^[0-9a-f-]{36}$'
   OR item->>'kind' NOT IN('vehicle','equipment') THEN RETURN FALSE;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'assetAssignments') entry
   GROUP BY lower(entry->>'assetId'),COALESCE(lower(entry->>'crewId'),''),entry->>'kind',
    lower(entry->>'operatorProfileId') HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'assetAssignments') entry
   WHERE (entry->'crewId'<>'null'::jsonb AND entry->>'crewId' NOT IN
      (SELECT value#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') value))
      OR entry->>'operatorProfileId' NOT IN(SELECT value#>>'{}' FROM jsonb_array_elements(definition_value->'operatorProfileIds') value)
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewAssignments') assigned
         WHERE assigned->'crewId' IS NOT DISTINCT FROM entry->'crewId'
          AND assigned->>'profileId'=entry->>'operatorProfileId'
          AND assigned->>'role'=ANY(roles)))
 THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements(definition_value->'travelPairs') AS entries(entry) LOOP
  IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['fromLocationKey','toLocationKey','durationMinutes','basis'])
   OR item->>'fromLocationKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   OR item->>'toLocationKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
   OR item->>'durationMinutes'!~'^(0|[1-9][0-9]{0,3})$' OR (item->>'durationMinutes')::int>1440
  OR item->>'basis' NOT IN('estimated','reported') THEN RETURN FALSE;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'travelPairs') WITH ORDINALITY left_rows(left_item,left_index)
   JOIN jsonb_array_elements(definition_value->'travelPairs') WITH ORDINALITY right_rows(right_item,right_index)
    ON left_index<right_index
   WHERE left_item->>'fromLocationKey'=right_item->>'fromLocationKey'
    AND left_item->>'toLocationKey'=right_item->>'toLocationKey') THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements(definition_value->'assetCalendars') AS entries(entry) LOOP
  IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['assetId','availableIntervals','committedIntervals'])
   OR item->>'assetId'!~*'^[0-9a-f-]{36}$' OR lower(item->>'assetId')=ANY(asset_ids)
   OR NOT public.canonical_forecast_constrained_capacity_v1_intervals(item->'availableIntervals')
   OR NOT public.canonical_forecast_constrained_capacity_v1_intervals(item->'committedIntervals') THEN RETURN FALSE;END IF;
  asset_ids:=array_append(asset_ids,lower(item->>'assetId'));
 END LOOP;
 RETURN ((definition_value#>>'{applicability,crew}')::boolean=(jsonb_array_length(definition_value->'crewIds')>0))
  AND ((definition_value#>>'{applicability,crew}')::boolean=(jsonb_array_length(definition_value->'crewRoleRequirements')>0))
  AND ((definition_value#>>'{applicability,crew}')::boolean OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewAssignments') value
      WHERE value->'crewId'<>'null'::jsonb))
  AND ((definition_value#>>'{applicability,crew}')::boolean OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'assetAssignments') value
      WHERE value->'crewId'<>'null'::jsonb))
  AND ((definition_value#>>'{applicability,skill}')::boolean=(jsonb_array_length(definition_value->'skillIds')>0))
  AND ((definition_value#>>'{applicability,vehicle}')::boolean=(jsonb_array_length(definition_value->'vehicleAssetIds')>0))
  AND ((definition_value#>>'{applicability,equipment}')::boolean=(jsonb_array_length(definition_value->'equipmentAssetIds')>0))
  AND (NOT (definition_value#>>'{applicability,travel}')::boolean OR jsonb_array_length(definition_value->'travelPairs')>0)
  AND (NOT (definition_value#>>'{applicability,crew}')::boolean OR
    (SELECT count(*)=1 FROM jsonb_array_elements(definition_value->'crewRoleRequirements') value
      WHERE value->>'role'=definition_value->>'role'))
  AND ((definition_value#>>'{applicability,vehicle}')::boolean=
    ((definition_value#>>'{assetRequirements,vehiclePerSeat}')::int>0))
  AND ((definition_value#>>'{applicability,equipment}')::boolean=
    ((definition_value#>>'{assetRequirements,equipmentPerSeat}')::int>0))
  AND (SELECT count(DISTINCT value->>'operatorProfileId')=jsonb_array_length(definition_value->'operatorProfileIds')
    FROM jsonb_array_elements(definition_value->'assetAssignments') value
    WHERE value->>'operatorProfileId' IN
      (SELECT member#>>'{}' FROM jsonb_array_elements(definition_value->'operatorProfileIds') member))
  AND ((definition_value#>>'{applicability,vehicle}')::boolean
    OR (definition_value#>>'{applicability,equipment}')::boolean
    OR jsonb_array_length(definition_value->'operatorProfileIds')=0)
  AND (SELECT count(DISTINCT value->>'assetId')=jsonb_array_length(definition_value->'vehicleAssetIds')
    FROM jsonb_array_elements(definition_value->'assetAssignments') entries(value)
    WHERE value->>'kind'='vehicle' AND value->>'assetId' IN
      (SELECT member#>>'{}' FROM jsonb_array_elements(definition_value->'vehicleAssetIds') member))
  AND (SELECT count(DISTINCT value->>'assetId')=jsonb_array_length(definition_value->'equipmentAssetIds')
    FROM jsonb_array_elements(definition_value->'assetAssignments') entries(value)
    WHERE value->>'kind'='equipment' AND value->>'assetId' IN
      (SELECT member#>>'{}' FROM jsonb_array_elements(definition_value->'equipmentAssetIds') member))
  AND ((SELECT count(*) FROM jsonb_array_elements(definition_value->'vehicleAssetIds') value
        WHERE lower(value#>>'{}')=ANY(asset_ids))=jsonb_array_length(definition_value->'vehicleAssetIds'))
   AND ((SELECT count(*) FROM jsonb_array_elements(definition_value->'equipmentAssetIds') value
         WHERE lower(value#>>'{}')=ANY(asset_ids))=jsonb_array_length(definition_value->'equipmentAssetIds'));
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_source_subject(
 table_value TEXT,payload JSONB)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE table_value
  WHEN 'workforce_crew_members' THEN (payload->>'crew_id')||':'||(payload->>'profile_id')
  WHEN 'workforce_profile_skills' THEN (payload->>'profile_id')||':'||(payload->>'skill_id')
  WHEN 'tenant_asset_service_capabilities' THEN (payload->>'asset_id')||':'||(payload->>'service_id')
  WHEN 'canonical_schedule_assignment_revisions' THEN payload->>'assignment_id'
  WHEN 'canonical_schedule_approvals' THEN payload->>'assignment_id'
  WHEN 'canonical_schedule_human_approvals' THEN payload->>'assignment_id'
  WHEN 'canonical_workforce_availability_revisions' THEN payload->>'workforce_profile_id'
  WHEN 'canonical_estimates' THEN payload->>'opportunity_id'
  WHEN 'canonical_equipment_plans' THEN (payload->>'estimate_id')||':equipment'
  WHEN 'canonical_equipment_readiness_plans' THEN (payload->>'estimate_id')||':readiness'
  WHEN 'canonical_travel_plans' THEN (payload->>'estimate_id')||':travel'
  WHEN 'canonical_completion_records' THEN payload->>'execution_id'
  ELSE COALESCE(payload->>'id',payload->>'profile_id',payload->>'crew_id',payload->>'skill_id',
   payload->>'asset_id',payload->>'estimate_id',payload->>'assignment_id',payload->>'appointment_id') END
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_source_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE before_value JSONB:=CASE WHEN TG_OP IN('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
 after_value JSONB:=CASE WHEN TG_OP IN('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
 payload JSONB:=COALESCE(after_value,before_value);org UUID;subject_value TEXT;now_value TIMESTAMPTZ;
BEGIN
 org:=(payload->>'organization_id')::uuid;
 subject_value:=public.canonical_forecast_constrained_capacity_v1_source_subject(TG_TABLE_NAME,payload);
 IF subject_value IS NULL OR length(subject_value)>200 THEN
  RAISE EXCEPTION 'Constrained-capacity source identity unavailable' USING ERRCODE='22023';END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-source:'||org,0));
 INSERT INTO public.canonical_forecast_constrained_capacity_source_fences_v1(organization_id,generation,updated_at)
  VALUES(org,1,now_value)
  ON CONFLICT(organization_id) DO UPDATE
   SET generation=public.canonical_forecast_constrained_capacity_source_fences_v1.generation+1,
       updated_at=EXCLUDED.updated_at;
 INSERT INTO public.canonical_forecast_constrained_capacity_source_events_v1(
  organization_id,source_kind,subject_key,operation,observed_at,before_payload,after_payload,row_digest)
 VALUES(org,TG_TABLE_NAME,subject_value,TG_OP,now_value,before_value,after_value,
  public.canonical_completion_digest(jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,
   'subject',subject_value,'before',before_value,'after',after_value,'observedAt',now_value)));
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DO $$
DECLARE item RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('workforce_crews','z_m26_p5b_source_crews'),
  ('workforce_crew_members','z_m26_p5b_source_crew_members'),
  ('workforce_skills','z_m26_p5b_source_skills'),
  ('workforce_profile_skills','z_m26_p5b_source_profile_skills'),
  ('canonical_business_profiles','z_m26_p5b_source_business_profiles'),
  ('tenant_assets','z_m26_p5b_source_assets'),
  ('tenant_asset_service_capabilities','z_m26_p5b_source_asset_capabilities'),
  ('canonical_equipment_events','z_m26_p5b_source_equipment_events'),
  ('canonical_equipment_plans','z_m26_p5b_source_equipment_plans'),
  ('canonical_equipment_readiness_plans','z_m26_p5b_source_equipment_readiness'),
  ('canonical_travel_plans','z_m26_p5b_source_travel_plans'),
  ('canonical_schedule_assignments','z_m26_p5b_source_schedule_assignments'),
  ('canonical_schedule_assignment_revisions','z_m26_p5b_source_schedule_revisions'),
  ('canonical_schedule_approvals','z_m26_p5b_source_schedule_approvals'),
  ('canonical_schedule_human_approvals','z_m26_p5b_source_human_approvals'),
  ('canonical_workforce_availability_revisions','z_m26_p5b_source_availability_revisions'),
  ('canonical_estimates','z_m26_p5b_source_estimates'),
  ('canonical_completion_records','z_m26_p5b_source_completion_records'),
  ('canonical_opportunities','z_m26_p5b_source_opportunities')) AS value(table_name,trigger_name)
 LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_constrained_capacity_v1_source_capture()',item.trigger_name,item.table_name);
 END LOOP;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_source_identity(
 org UUID,kind_value TEXT,scope_value TEXT,subject_value UUID,definition_value JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result_value JSONB;profile_value public.canonical_business_profiles%ROWTYPE;
 assignment_value public.canonical_schedule_assignments%ROWTYPE;
 scope_review_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 opportunity_value JSONB;basis_value JSONB;estimate_value UUID;receipt_value JSONB;estimate_population JSONB;
 m24_bases JSONB:='[]'::jsonb;
 expected_count INTEGER;actual_count INTEGER;assigned_role TEXT;route_home TEXT;route_key TEXT;
 job_source_order BIGINT:=0;job_role_source_order BIGINT:=0;job_crew_source_order BIGINT:=0;
BEGIN
 IF public.canonical_forecast_constrained_capacity_v1_definition_valid(kind_value,definition_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Constrained-capacity review definition invalid' USING ERRCODE='22023';END IF;
 IF kind_value='method' THEN
  SELECT jsonb_build_object('methodKey',method_key,'calculationVersion',calculation_version,'digest',rtrim(digest))
   INTO result_value FROM public.canonical_forecast_constrained_capacity_methods_v1
   WHERE method_key='capacity.available_role_hours.v1';RETURN result_value;
 END IF;
 IF definition_value->>'scopeKey' IS DISTINCT FROM scope_value THEN
  RAISE EXCEPTION 'Constrained-capacity scope identity differs' USING ERRCODE='22023';END IF;
 IF kind_value='job' THEN
 IF (definition_value->>'appointmentId')::uuid IS DISTINCT FROM subject_value THEN
   RAISE EXCEPTION 'Constrained-capacity job identity differs' USING ERRCODE='22023';END IF;
  scope_review_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'scope',scope_value,NULL);
  IF scope_review_value.id IS NULL OR scope_review_value.action<>'approve'
   OR scope_review_value.definition->>'alternativeKey' IS DISTINCT FROM definition_value->>'alternativeKey' THEN
   RAISE EXCEPTION 'Constrained-capacity alternative identity differs' USING ERRCODE='22023';END IF;
  SELECT * INTO assignment_value FROM public.canonical_schedule_assignments
   WHERE organization_id=org AND id=(definition_value->>'assignmentId')::uuid
    AND appointment_id=subject_value;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved work identity unavailable' USING ERRCODE='22023';END IF;
  IF (assignment_value.workforce_profile_id IS NULL)=(assignment_value.workforce_crew_id IS NULL) THEN
   RAISE EXCEPTION 'Approved work target authority unavailable' USING ERRCODE='22023';END IF;
  IF assignment_value.workforce_profile_id IS NOT NULL THEN
   SELECT assigned->>'role',profile.home_location_id,
     'profile:'||assignment_value.workforce_profile_id::text
    INTO assigned_role,route_home,route_key
    FROM jsonb_array_elements(scope_review_value.definition->'crewAssignments') assigned
    JOIN public.workforce_profiles profile ON profile.organization_id=org
     AND profile.id=assignment_value.workforce_profile_id
    WHERE assigned->>'profileId'=assignment_value.workforce_profile_id::text
    LIMIT 1;
  ELSE
   SELECT scope_review_value.definition->>'role',crew.home_location_id,
     'crew:'||assignment_value.workforce_crew_id::text
    INTO assigned_role,route_home,route_key
    FROM public.workforce_crews crew
    WHERE crew.organization_id=org AND crew.id=assignment_value.workforce_crew_id
     AND (scope_review_value.definition#>>'{applicability,crew}')::boolean
     AND assignment_value.workforce_crew_id::text IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(scope_review_value.definition->'crewIds') item)
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(scope_review_value.definition->'crewRoleRequirements') required
      WHERE required->>'role'=scope_review_value.definition->>'role')
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(scope_review_value.definition->'crewAssignments') assigned
      WHERE assigned->>'crewId'=assignment_value.workforce_crew_id::text);
  END IF;
  IF assigned_role IS NULL OR route_home IS NULL OR route_key IS NULL THEN
   RAISE EXCEPTION 'Approved work does not match reviewed formation' USING ERRCODE='22023';END IF;
  SELECT to_jsonb(value) INTO opportunity_value FROM public.canonical_opportunities value
   WHERE value.organization_id=org AND value.id=assignment_value.opportunity_id;
  IF opportunity_value IS NULL THEN RAISE EXCEPTION 'Approved work source unavailable' USING ERRCODE='22023';END IF;
  IF (definition_value->>'locationApplicable')::boolean AND
    opportunity_value#>>'{job_scope,locationId}' IS DISTINCT FROM definition_value->>'locationKey' THEN
   RAISE EXCEPTION 'Approved work location authority unavailable' USING ERRCODE='22023';END IF;
  SELECT (array_agg(value.id ORDER BY value.id))[1],count(*),COALESCE(jsonb_agg(jsonb_build_array(
   value.id,value.snapshot_digest,value.created_at) ORDER BY value.id),'[]'::jsonb)
   INTO estimate_value,actual_count,estimate_population FROM public.canonical_estimates value
   WHERE value.organization_id=org AND value.opportunity_id=assignment_value.opportunity_id;
  IF actual_count<>1 THEN RAISE EXCEPTION 'Exact M24 estimate authority unavailable' USING ERRCODE='22023';END IF;
  FOR basis_value IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('kind','equipment','basis',definition_value->'equipmentBasis'),
    jsonb_build_object('kind','readiness','basis',definition_value->'readinessBasis'),
    jsonb_build_object('kind','travel','basis',definition_value->'travelBasis'))) entries(value)
   WHERE value#>>'{basis,kind}'='m24_adopted'
  LOOP
   receipt_value:=NULL;
   IF basis_value->>'kind'='equipment' THEN
    SELECT to_jsonb(value) INTO receipt_value FROM public.canonical_equipment_plans value
     WHERE value.organization_id=org AND value.estimate_id=estimate_value ORDER BY value.revision DESC LIMIT 1;
   ELSIF basis_value->>'kind'='readiness' THEN
    SELECT to_jsonb(value) INTO receipt_value FROM public.canonical_equipment_readiness_plans value
     WHERE value.organization_id=org AND value.estimate_id=estimate_value ORDER BY value.revision DESC LIMIT 1;
   ELSE
    SELECT to_jsonb(value) INTO receipt_value FROM public.canonical_travel_plans value
     WHERE value.organization_id=org AND value.estimate_id=estimate_value ORDER BY value.revision DESC LIMIT 1;
   END IF;
   IF receipt_value IS NULL OR receipt_value->>'action'<>'save'
    OR receipt_value->>'id' IS DISTINCT FROM basis_value#>>'{basis,receiptId}'
    OR rtrim(receipt_value->>'digest') IS DISTINCT FROM basis_value#>>'{basis,digest}' THEN
    RAISE EXCEPTION 'Adopted M24 constrained-capacity basis unavailable' USING ERRCODE='22023';END IF;
   m24_bases:=m24_bases||jsonb_build_array(jsonb_build_object('kind',basis_value->>'kind',
    'estimateId',estimate_value,'receiptId',receipt_value->>'id','revision',(receipt_value->>'revision')::bigint,
    'digest',rtrim(receipt_value->>'digest'),'action',receipt_value->>'action'));
  END LOOP;
  IF estimate_population IS NULL THEN
   SELECT COALESCE(jsonb_agg(jsonb_build_array(value.id,value.snapshot_digest,value.created_at) ORDER BY value.id),'[]'::jsonb)
    INTO estimate_population FROM public.canonical_estimates value
    WHERE value.organization_id=org AND value.opportunity_id=assignment_value.opportunity_id;
  END IF;
  SELECT COALESCE(max(event_value.source_order),0) INTO job_source_order
  FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
  WHERE event_value.organization_id=org AND (
   (event_value.source_kind IN('canonical_schedule_assignments','canonical_schedule_assignment_revisions',
     'canonical_schedule_approvals','canonical_schedule_human_approvals')
    AND event_value.subject_key=assignment_value.id::text)
   OR (event_value.source_kind IN('canonical_opportunities','canonical_estimates')
    AND event_value.subject_key=assignment_value.opportunity_id::text)
   OR (event_value.source_kind IN('canonical_equipment_plans','canonical_equipment_readiness_plans','canonical_travel_plans')
    AND event_value.subject_key IN(estimate_value::text||':equipment',estimate_value::text||':readiness',estimate_value::text||':travel'))
   OR (assignment_value.workforce_crew_id IS NOT NULL AND event_value.source_kind='workforce_crews'
    AND event_value.subject_key=assignment_value.workforce_crew_id::text));
  IF assignment_value.workforce_profile_id IS NOT NULL THEN
   SELECT COALESCE(max(event_value.source_order),0) INTO job_role_source_order
   FROM public.canonical_forecast_workload_capacity_role_generations_v1 event_value
   WHERE event_value.organization_id=org AND event_value.profile_id=assignment_value.workforce_profile_id;
  END IF;
  IF assignment_value.workforce_crew_id IS NOT NULL THEN
   SELECT COALESCE(max(event_value.source_order),0) INTO job_crew_source_order
   FROM public.canonical_forecast_workload_capacity_crew_events_v1 event_value
   WHERE event_value.organization_id=org AND event_value.crew_id=assignment_value.workforce_crew_id;
  END IF;
  RETURN jsonb_build_object('alternativeKey',definition_value->>'alternativeKey',
   'appointmentId',subject_value,'assignmentId',assignment_value.id,
   'opportunityId',assignment_value.opportunity_id,
   'assignmentRevision',assignment_value.revision,
   'assignmentDigest',rtrim(assignment_value.canonical_digest),
	   'workforceProfileId',assignment_value.workforce_profile_id,
	   'workforceCrewId',assignment_value.workforce_crew_id,
	   'assignedRole',assigned_role,'routeKey',route_key,'routeHomeLocation',route_home,
	   'scheduleState',assignment_value.schedule_state,'targetState',assignment_value.target_state,
	   'appointmentStatus',assignment_value.appointment_status,'scheduledStart',assignment_value.scheduled_start,
	   'scheduledEnd',assignment_value.scheduled_end,
   'opportunityDigest',public.canonical_completion_digest(opportunity_value),
   'serviceType',opportunity_value->>'service_type',
   'equipmentBasis',definition_value->'equipmentBasis','readinessBasis',definition_value->'readinessBasis',
   'travelBasis',definition_value->'travelBasis','m24Bases',m24_bases,'estimateId',estimate_value,
   'estimatePopulation',estimate_population,
    'estimatePopulationDigest',public.canonical_completion_digest(estimate_population),
    'jobConstrainedSourceOrder',job_source_order,'jobRoleSourceOrder',job_role_source_order,
    'jobCrewSourceOrder',job_crew_source_order);
 END IF;
 SELECT * INTO profile_value FROM public.canonical_business_profiles
  WHERE organization_id=org AND is_active ORDER BY version_number DESC LIMIT 1;
 IF NOT FOUND OR profile_value.raw_profile#>>'{company,timeZone}' IS NULL THEN
  RAISE EXCEPTION 'Business calendar authority unavailable' USING ERRCODE='22023';END IF;
 expected_count:=jsonb_array_length(definition_value->'skillIds');
 SELECT count(*) INTO actual_count FROM public.workforce_skills value
  WHERE value.organization_id=org AND value.id::text IN
   (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'skillIds') item);
 IF expected_count<>actual_count THEN RAISE EXCEPTION 'Skill authority unavailable' USING ERRCODE='22023';END IF;
 expected_count:=jsonb_array_length(definition_value->'crewIds');
 SELECT count(*) INTO actual_count FROM public.workforce_crews value
  WHERE value.organization_id=org AND value.id::text IN
   (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item);
 IF expected_count<>actual_count THEN RAISE EXCEPTION 'Crew authority unavailable' USING ERRCODE='22023';END IF;
 expected_count:=jsonb_array_length(definition_value->'vehicleAssetIds')+
  jsonb_array_length(definition_value->'equipmentAssetIds');
 SELECT count(*) INTO actual_count FROM public.tenant_assets value
  WHERE value.organization_id=org AND value.id::text IN
   (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item)
   AND value.catalogue_state='active';
 IF expected_count<>actual_count THEN RAISE EXCEPTION 'Asset authority unavailable' USING ERRCODE='22023';END IF;
 expected_count:=jsonb_array_length(definition_value->'operatorProfileIds');
 SELECT count(*) INTO actual_count FROM public.workforce_profiles value
  WHERE value.organization_id=org AND value.id::text IN
   (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'operatorProfileIds') item);
 IF expected_count<>actual_count THEN RAISE EXCEPTION 'Operator authority unavailable' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewAssignments') assignment
   WHERE (assignment->'crewId'<>'null'::jsonb AND NOT EXISTS(
     SELECT 1 FROM public.workforce_crew_members member
      JOIN public.workforce_profiles profile ON profile.organization_id=member.organization_id
       AND profile.id=member.profile_id
     WHERE member.organization_id=org AND member.crew_id=(assignment->>'crewId')::uuid
      AND member.profile_id=(assignment->>'profileId')::uuid
      AND profile.operational_role=assignment->>'role'))
    OR (assignment->'crewId'='null'::jsonb AND NOT EXISTS(
     SELECT 1 FROM public.workforce_profiles profile WHERE profile.organization_id=org
      AND profile.id=(assignment->>'profileId')::uuid AND profile.operational_role=assignment->>'role'))) THEN
  RAISE EXCEPTION 'Reviewed crew allocation authority unavailable' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'assetAssignments') assignment
   JOIN public.tenant_assets asset ON asset.organization_id=org AND asset.id=(assignment->>'assetId')::uuid
   LEFT JOIN public.workforce_crews crew ON crew.organization_id=org AND crew.id=(assignment->>'crewId')::uuid
   LEFT JOIN public.workforce_profiles operator ON operator.organization_id=org
    AND operator.id=(assignment->>'operatorProfileId')::uuid
   WHERE asset.category IS DISTINCT FROM assignment->>'kind'
      OR asset.home_location_id IS DISTINCT FROM COALESCE(crew.home_location_id,operator.home_location_id)
      OR asset.catalogue_state<>'active') THEN
  RAISE EXCEPTION 'Reviewed asset category or home-location authority unavailable' USING ERRCODE='22023';END IF;
 SELECT jsonb_build_object(
  'businessProfile',jsonb_build_object('id',profile_value.id,'version',profile_value.version_number,
   'digest',rtrim(profile_value.normalized_profile_hash),'timeZone',profile_value.raw_profile#>>'{company,timeZone}',
   'rawProfile',profile_value.raw_profile),
  'skills',COALESCE((SELECT jsonb_agg(jsonb_build_array(value.id,value.skill_key,value.service_id,value.updated_at)
    ORDER BY value.id) FROM public.workforce_skills value WHERE value.organization_id=org AND value.id::text IN
    (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'skillIds') item)),'[]'::jsonb),
  'crews',COALESCE((SELECT jsonb_agg(jsonb_build_array(value.id,value.home_location_id,value.updated_at)
    ORDER BY value.id) FROM public.workforce_crews value WHERE value.organization_id=org AND value.id::text IN
    (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item)),'[]'::jsonb),
  'crewMembers',COALESCE((SELECT jsonb_agg(jsonb_build_array(value.crew_id,value.profile_id,value.crew_role)
    ORDER BY value.crew_id,value.profile_id) FROM public.workforce_crew_members value
    WHERE value.organization_id=org AND value.crew_id::text IN
    (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item)),'[]'::jsonb),
  'profileSkills',COALESCE((SELECT jsonb_agg(jsonb_build_array(value.profile_id,value.skill_id)
    ORDER BY value.profile_id,value.skill_id) FROM public.workforce_profile_skills value
    WHERE value.organization_id=org AND value.skill_id::text IN
    (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'skillIds') item)),'[]'::jsonb),
  'operators',COALESCE((SELECT jsonb_agg(jsonb_build_array(value.id,value.operational_role,value.updated_at)
    ORDER BY value.id) FROM public.workforce_profiles value WHERE value.organization_id=org AND value.id::text IN
    (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'operatorProfileIds') item)),'[]'::jsonb),
  'assets',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',value.id,'category',value.category,
    'configuration',value.configuration,'version',value.version,'homeLocationId',value.home_location_id)
    ORDER BY value.id) FROM public.tenant_assets value WHERE value.organization_id=org AND value.id::text IN
    (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item)),'[]'::jsonb),
  'assetCapabilities',COALESCE((SELECT jsonb_agg(jsonb_build_array(value.asset_id,value.service_id)
    ORDER BY value.asset_id,value.service_id) FROM public.tenant_asset_service_capabilities value
    WHERE value.organization_id=org AND value.asset_id::text IN
    (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item)),'[]'::jsonb),
  'equipmentLedgers',COALESCE((SELECT jsonb_agg(jsonb_build_array(value.asset_id,value.revision,value.digest,value.state)
    ORDER BY value.asset_id) FROM public.canonical_equipment_ledgers value WHERE value.organization_id=org
    AND value.asset_id::text IN (SELECT item#>>'{}' FROM jsonb_array_elements(
      (definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item)),'[]'::jsonb),
   'scopeConstrainedSourceOrder',COALESCE((SELECT max(value.source_order)
     FROM public.canonical_forecast_constrained_capacity_source_events_v1 value
     WHERE value.organization_id=org AND (
      (value.source_kind='canonical_business_profiles' AND value.subject_key=profile_value.id::text)
      OR (value.source_kind='workforce_crews' AND value.subject_key IN
       (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item))
      OR (value.source_kind='workforce_crew_members' AND split_part(value.subject_key,':',1) IN
       (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item))
      OR (value.source_kind='workforce_skills' AND value.subject_key IN
       (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'skillIds') item))
      OR (value.source_kind='workforce_profile_skills' AND split_part(value.subject_key,':',1) IN
       (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item))
      OR (value.source_kind='tenant_assets' AND value.subject_key IN
       (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item))
      OR (value.source_kind='tenant_asset_service_capabilities' AND split_part(value.subject_key,':',1) IN
       (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item))
      OR (value.source_kind='canonical_equipment_events' AND COALESCE(value.after_payload,value.before_payload)->>'asset_id' IN
       (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item)))),0),
   'scopeRoleSourceOrder',COALESCE((SELECT max(value.source_order)
     FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
     WHERE value.organization_id=org AND value.profile_id::text IN
      (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item)),0),
   'scopeProfileSourceOrder',COALESCE((SELECT max(value.source_order)
     FROM public.canonical_forecast_workload_capacity_profile_events_v1 value
     WHERE value.organization_id=org AND value.profile_id::text IN
      (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item)),0),
   'scopeCrewSourceOrder',COALESCE((SELECT max(value.source_order)
     FROM public.canonical_forecast_workload_capacity_crew_events_v1 value
     WHERE value.organization_id=org AND (value.crew_id::text IN
       (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item)
      OR value.profile_id::text IN
       (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item))),0)) INTO result_value;
 RETURN result_value;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_review_current_internal(
 org UUID,kind_value TEXT,scope_value TEXT,subject_value UUID)
RETURNS public.canonical_forecast_constrained_capacity_reviews_v1 LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
 WHERE value.organization_id=org AND value.review_kind=kind_value
  AND value.scope_key IS NOT DISTINCT FROM scope_value AND value.subject_id IS NOT DISTINCT FROM subject_value
 ORDER BY value.revision DESC LIMIT 1
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_review_is_current(
 org UUID,value public.canonical_forecast_constrained_capacity_reviews_v1)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value public.canonical_forecast_constrained_capacity_reviews_v1;source_value JSONB;
BEGIN
 current_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
  org,value.review_kind,value.scope_key,value.subject_id);
 IF current_value.id IS DISTINCT FROM value.id OR value.action<>'approve' THEN RETURN FALSE;END IF;
 source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(
  org,value.review_kind,value.scope_key,value.subject_id,value.definition);
 RETURN public.canonical_completion_digest(source_value)=rtrim(value.source_digest);
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_review_projection(
 value public.canonical_forecast_constrained_capacity_reviews_v1,source_current BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state','constrained_capacity_review_current','kind',value.review_kind,
  'scopeKey',value.scope_key,'subjectId',value.subject_id,'reviewId',value.id,'action',value.action,
  'expectedRevision',value.revision,'expectedDigest',rtrim(value.digest),'sourceCurrent',source_current,
  'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_review_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID,kind_value TEXT,scope_value TEXT,subject_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_constrained_capacity_reviews_v1;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,kind_value,scope_value,subject_value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 IF value.id IS NULL THEN RETURN jsonb_build_object('state','constrained_capacity_review_current','kind',kind_value,
  'scopeKey',scope_value,'subjectId',subject_value,'reviewId',NULL,'action',NULL,'expectedRevision',0,
  'expectedDigest','none','sourceCurrent',FALSE,'researchOnly',TRUE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE);END IF;
 RETURN public.canonical_forecast_constrained_capacity_v1_review_projection(value,
  public.canonical_forecast_constrained_capacity_v1_review_is_current(org,value));
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_review_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 kind_value TEXT,scope_value TEXT,subject_value UUID,action_value TEXT,expected_revision BIGINT,
 expected_digest TEXT,definition_value JSONB,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 current_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 inserted public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
 source_value JSONB;next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR action_value IS NULL
  OR action_value NOT IN('approve','reject','withdraw')
  OR confirmation_value IS DISTINCT FROM 'm26-constrained-capacity-review-v1'
  OR reason_value IS NULL OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR expected_revision IS NULL OR expected_revision<0 OR expected_digest IS NULL
  OR (expected_digest<>'none' AND expected_digest!~'^[0-9a-f]{64}$')
  OR ((expected_revision=0) IS DISTINCT FROM (expected_digest='none'))
  OR public.canonical_forecast_constrained_capacity_v1_definition_valid(kind_value,definition_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Constrained-capacity review request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind',kind_value,'scope',scope_value,
  'subject',subject_value,'action',action_value,'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'definition',definition_value,'reason',btrim(reason_value)));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-key:'||org||':'||actor||':'||key_hash,0));
  SELECT * INTO old FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
  IF FOUND THEN
   current_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(
    org,old.review_kind,old.scope_key,old.subject_id);
   source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(
    org,old.review_kind,old.scope_key,old.subject_id,old.definition);
   IF rtrim(old.request_digest)<>request_hash OR current_value.id IS DISTINCT FROM old.id
    OR public.canonical_completion_digest(source_value) IS DISTINCT FROM rtrim(old.source_digest) THEN
    RAISE EXCEPTION 'Constrained-capacity review replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','constrained_capacity_review_recorded','id',old.id,'kind',old.review_kind,
   'scopeKey',old.scope_key,'subjectId',old.subject_id,'action',old.action,'revision',old.revision,
   'digest',rtrim(old.digest),'replayed',TRUE);END IF;
 source_value:=public.canonical_forecast_constrained_capacity_v1_source_identity(org,kind_value,scope_value,subject_value,definition_value);
 current_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,kind_value,scope_value,subject_value);
 IF expected_revision<>COALESCE(current_value.revision,0) OR expected_digest IS DISTINCT FROM COALESCE(rtrim(current_value.digest),'none') THEN
  RAISE EXCEPTION 'Constrained-capacity review revision conflict' USING ERRCODE='40001';END IF;
 next_revision:=expected_revision+1;IF next_revision>10000 THEN RAISE EXCEPTION 'Review bound exceeded' USING ERRCODE='54000';END IF;
 INSERT INTO public.canonical_forecast_constrained_capacity_reviews_v1(
  organization_id,review_kind,scope_key,subject_id,revision,previous_id,action,definition,
  source_identity,source_digest,decided_at,reason,actor_id,membership_id,session_id,
  idempotency_key_hash,request_digest,digest)
 VALUES(org,kind_value,scope_value,subject_value,next_revision,current_value.id,action_value,definition_value,
  source_value,public.canonical_completion_digest(source_value),public.canonical_forecast_workload_capacity_v1_clock(),
  btrim(reason_value),actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,
  public.canonical_completion_digest(jsonb_build_object('kind',kind_value,'scope',scope_value,
   'subject',subject_value,'revision',next_revision,'action',action_value,'definition',definition_value,
   'source',source_value,'reason',btrim(reason_value)))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','constrained_capacity_review_recorded','id',inserted.id,'kind',inserted.review_kind,
  'scopeKey',inserted.scope_key,'subjectId',inserted.subject_id,'action',inserted.action,
  'revision',inserted.revision,'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;


CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_epoch_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 current_value public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 inserted public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
 now_value TIMESTAMPTZ;order_value BIGINT;next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR confirmation_value IS DISTINCT FROM 'm26-constrained-capacity-epoch-v1'
  OR reason_value IS NULL OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Constrained-capacity epoch request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 request_hash:=public.canonical_completion_digest(jsonb_build_object('reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_constrained_capacity_epochs_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash OR EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_epochs_v1 newer
    WHERE newer.organization_id=org AND newer.revision>old.revision) THEN
   RAISE EXCEPTION 'Constrained-capacity epoch replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','constrained_capacity_epoch_recorded','id',old.id,'revision',old.revision,
   'installedAt',old.installed_at,'digest',rtrim(old.digest),'replayed',TRUE);END IF;
 SELECT * INTO current_value FROM public.canonical_forecast_constrained_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 next_revision:=COALESCE(current_value.revision,0)+1;
 order_value:=public.canonical_forecast_constrained_capacity_v1_source_baseline(org,now_value);
 INSERT INTO public.canonical_forecast_constrained_capacity_epochs_v1(
  organization_id,revision,previous_id,installed_at,source_order,reason,confirmation_version,
  actor_id,membership_id,session_id,idempotency_key_hash,request_digest,digest)
 VALUES(org,next_revision,current_value.id,now_value,order_value,btrim(reason_value),confirmation_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,
  public.canonical_completion_digest(jsonb_build_object('revision',next_revision,'previous',current_value.id,
   'installedAt',now_value,'sourceOrder',order_value,'reason',btrim(reason_value)))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','constrained_capacity_epoch_recorded','id',inserted.id,
  'revision',inserted.revision,'installedAt',inserted.installed_at,'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_prerequisites(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_value public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 method_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 scope_count INTEGER;job_count INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO epoch_value FROM public.canonical_forecast_constrained_capacity_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 method_value:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'method',NULL,NULL);
 SELECT count(*) INTO scope_count FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
   AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
    WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
    ORDER BY latest.revision DESC LIMIT 1);
 SELECT count(*) INTO job_count FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='job' AND value.action='approve'
   AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
    WHERE latest.organization_id=org AND latest.review_kind='job' AND latest.scope_key=value.scope_key
     AND latest.subject_id=value.subject_id ORDER BY latest.revision DESC LIMIT 1);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','constrained_capacity_prerequisites_current','epoch',
  CASE WHEN epoch_value.id IS NULL THEN jsonb_build_object('state','missing','id',NULL,'revision',NULL,'digest',NULL,'installedAt',NULL)
   ELSE jsonb_build_object('state','current','id',epoch_value.id,'revision',epoch_value.revision,
    'digest',rtrim(epoch_value.digest),'installedAt',epoch_value.installed_at) END,
  'method',jsonb_build_object('expectedRevision',COALESCE(method_value.revision,0),
   'expectedDigest',COALESCE(rtrim(method_value.digest),'none'),'approved',COALESCE(method_value.action='approve',FALSE),
   'sourceCurrent',COALESCE(public.canonical_forecast_constrained_capacity_v1_review_is_current(org,method_value),FALSE)),
  'scopeCount',scope_count,'jobReviewCount',job_count,'researchOnly',TRUE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_interval_minutes(
 intervals_value JSONB,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS NUMERIC LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(sum(EXTRACT(EPOCH FROM(LEAST((item->>'end')::timestamptz,end_value)-
  GREATEST((item->>'start')::timestamptz,start_value)))/60) FILTER(WHERE (item->>'start')::timestamptz<end_value
   AND (item->>'end')::timestamptz>start_value),0) FROM jsonb_array_elements(intervals_value) item
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_working_windows(
 raw_profile_value JSONB,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,time_zone_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE day_value DATE;last_day DATE;weekday_value TEXT;policy JSONB;holiday JSONB;holiday_count INTEGER;
 open_value TIMESTAMP;close_value TIMESTAMP;open_at TIMESTAMPTZ;close_at TIMESTAMPTZ;
 lunch_match TEXT[];lunch_start TIMESTAMPTZ;lunch_end TIMESTAMPTZ;windows JSONB:='[]'::jsonb;
 unknown JSONB:='[]'::jsonb;guard INTEGER:=0;
BEGIN
 BEGIN
  day_value:=(start_value AT TIME ZONE time_zone_value)::date-1;
  last_day:=((end_value-INTERVAL '1 microsecond') AT TIME ZONE time_zone_value)::date;
 EXCEPTION WHEN invalid_parameter_value THEN
  RETURN jsonb_build_object('windows','[]'::jsonb,'unknownDates',jsonb_build_array('invalid_time_zone'));
 END;
 WHILE day_value<=last_day AND guard<35 LOOP
  weekday_value:=(ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[
   extract(dow FROM day_value)::int+1];
  SELECT count(*)::int,(jsonb_agg(value)->0) INTO holiday_count,holiday
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw_profile_value#>'{hours,holidays}')='array'
    THEN raw_profile_value#>'{hours,holidays}' ELSE '[]'::jsonb END) value
   WHERE jsonb_typeof(value)='object' AND value->>'date'=day_value::text;
  IF holiday_count>1 THEN unknown:=unknown||jsonb_build_array(day_value::text);
  ELSE
   policy:=CASE WHEN holiday_count=1 THEN holiday ELSE raw_profile_value#>ARRAY['hours',weekday_value] END;
   IF holiday_count=1 AND policy->'closed'='true'::jsonb THEN NULL;
   ELSIF jsonb_typeof(policy)<>'object' OR (holiday_count=1 AND policy->'closed'<>'false'::jsonb) THEN
    unknown:=unknown||jsonb_build_array(day_value::text);
   ELSIF COALESCE(policy->>'open','')='' AND COALESCE(policy->>'close','')='' THEN NULL;
   ELSIF policy->>'open'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR policy->>'close'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    unknown:=unknown||jsonb_build_array(day_value::text);
   ELSE
    open_value:=day_value+(policy->>'open')::time;
    close_value:=(CASE WHEN policy->>'close'<=policy->>'open' THEN day_value+1 ELSE day_value END)+(policy->>'close')::time;
    open_at:=public.canonical_schedule_part4_unique_local_instant(open_value,time_zone_value);
    close_at:=public.canonical_schedule_part4_unique_local_instant(close_value,time_zone_value);
    lunch_match:=regexp_match(COALESCE(policy->>'lunch',''),
      '^(([01][0-9]|2[0-3]):[0-5][0-9])-(([01][0-9]|2[0-3]):[0-5][0-9])$');
    IF open_at IS NULL OR close_at IS NULL OR close_at<=open_at THEN unknown:=unknown||jsonb_build_array(day_value::text);
    ELSIF COALESCE(policy->>'lunch','')='' THEN
     windows:=windows||jsonb_build_array(jsonb_build_object('start',GREATEST(open_at,start_value),'end',LEAST(close_at,end_value)));
    ELSIF lunch_match IS NULL THEN unknown:=unknown||jsonb_build_array(day_value::text);
    ELSE
     lunch_start:=public.canonical_schedule_part4_unique_local_instant(day_value+lunch_match[1]::time,time_zone_value);
     lunch_end:=public.canonical_schedule_part4_unique_local_instant(day_value+lunch_match[3]::time,time_zone_value);
     IF lunch_start IS NULL OR lunch_end IS NULL OR lunch_start<open_at OR lunch_end>close_at OR lunch_end<=lunch_start THEN
      unknown:=unknown||jsonb_build_array(day_value::text);
     ELSE
      IF lunch_start>open_at AND GREATEST(open_at,start_value)<LEAST(lunch_start,end_value) THEN
       windows:=windows||jsonb_build_array(jsonb_build_object('start',GREATEST(open_at,start_value),'end',LEAST(lunch_start,end_value)));END IF;
      IF lunch_end<close_at AND GREATEST(lunch_end,start_value)<LEAST(close_at,end_value) THEN
       windows:=windows||jsonb_build_array(jsonb_build_object('start',GREATEST(lunch_end,start_value),'end',LEAST(close_at,end_value)));END IF;
     END IF;
    END IF;
   END IF;
  END IF;
  day_value:=day_value+1;guard:=guard+1;
 END LOOP;
 RETURN jsonb_build_object('windows',(SELECT COALESCE(jsonb_agg(value ORDER BY value->>'start'),'[]'::jsonb)
   FROM jsonb_array_elements(windows) value WHERE (value->>'start')::timestamptz<(value->>'end')::timestamptz),
  'unknownDates',public.canonical_schedule_part4_stable_entries(unknown));
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_subject_present(
 org UUID,kind_value TEXT,subject_value TEXT,instant_value TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_forecast_constrained_capacity_v1_source_payload_at(org,kind_value,subject_value,instant_value) IS NOT NULL
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_review_at(
 org UUID,kind_value TEXT,scope_value TEXT,subject_value UUID,at_value TIMESTAMPTZ)
RETURNS public.canonical_forecast_constrained_capacity_reviews_v1
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
BEGIN
 SELECT review_value.* INTO value
 FROM public.canonical_forecast_constrained_capacity_reviews_v1 review_value
 WHERE review_value.organization_id=org AND review_value.review_kind=kind_value
  AND review_value.scope_key IS NOT DISTINCT FROM scope_value
  AND review_value.subject_id IS NOT DISTINCT FROM subject_value
  AND review_value.decided_at<=at_value
 ORDER BY review_value.decided_at DESC,review_value.revision DESC LIMIT 1;
 IF value.id IS NULL OR value.action<>'approve' THEN
  RAISE EXCEPTION 'Applicable constrained-capacity review unavailable' USING ERRCODE='22023';
 END IF;
 RETURN value;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_m24_bases_current(
 org UUID,review_value public.canonical_forecast_constrained_capacity_reviews_v1)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pinned JSONB;current_value JSONB;expected_count INTEGER:=0;
BEGIN
 expected_count:=(CASE WHEN review_value.definition#>>'{equipmentBasis,kind}'='m24_adopted' THEN 1 ELSE 0 END)+
  (CASE WHEN review_value.definition#>>'{readinessBasis,kind}'='m24_adopted' THEN 1 ELSE 0 END)+
  (CASE WHEN review_value.definition#>>'{travelBasis,kind}'='m24_adopted' THEN 1 ELSE 0 END);
 IF jsonb_typeof(review_value.source_identity->'m24Bases')<>'array'
  OR jsonb_array_length(review_value.source_identity->'m24Bases')<>expected_count THEN RETURN FALSE;END IF;
 FOR pinned IN SELECT value FROM jsonb_array_elements(review_value.source_identity->'m24Bases') entries(value) LOOP
  current_value:=NULL;
  IF pinned->>'kind'='equipment' THEN
   SELECT to_jsonb(value) INTO current_value FROM public.canonical_equipment_plans value
    WHERE value.organization_id=org AND value.estimate_id=(pinned->>'estimateId')::uuid
    ORDER BY value.revision DESC LIMIT 1;
  ELSIF pinned->>'kind'='readiness' THEN
   SELECT to_jsonb(value) INTO current_value FROM public.canonical_equipment_readiness_plans value
    WHERE value.organization_id=org AND value.estimate_id=(pinned->>'estimateId')::uuid
    ORDER BY value.revision DESC LIMIT 1;
  ELSIF pinned->>'kind'='travel' THEN
   SELECT to_jsonb(value) INTO current_value FROM public.canonical_travel_plans value
    WHERE value.organization_id=org AND value.estimate_id=(pinned->>'estimateId')::uuid
    ORDER BY value.revision DESC LIMIT 1;
  ELSE RETURN FALSE;END IF;
  IF current_value IS NULL OR current_value->>'action'<>'save'
   OR current_value->>'id' IS DISTINCT FROM pinned->>'receiptId'
   OR (current_value->>'revision')::bigint IS DISTINCT FROM (pinned->>'revision')::bigint
   OR rtrim(current_value->>'digest') IS DISTINCT FROM pinned->>'digest' THEN RETURN FALSE;END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_job_review_covers(
 org UUID,review_value public.canonical_forecast_constrained_capacity_reviews_v1,at_value TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT review_value.id IS NOT NULL AND review_value.review_kind='job' AND review_value.action='approve'
  AND review_value.decided_at<=at_value
  AND public.canonical_forecast_constrained_capacity_v1_m24_bases_current(org,review_value)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
   WHERE event_value.organization_id=org
    AND event_value.source_order>COALESCE((review_value.source_identity->>'jobConstrainedSourceOrder')::bigint,0)
    AND event_value.observed_at<at_value AND (
	     (event_value.source_kind IN('canonical_schedule_assignments','canonical_schedule_assignment_revisions')
	      AND event_value.subject_key=review_value.source_identity->>'assignmentId'
	      AND NOT (COALESCE(event_value.after_payload->>'appointment_status','') IN('completed','cancelled')
	       AND event_value.after_payload->>'target_state'=review_value.source_identity->>'targetState'
	       AND event_value.after_payload->>'schedule_state'=review_value.source_identity->>'scheduleState'
	       AND event_value.after_payload->>'workforce_profile_id' IS NOT DISTINCT FROM review_value.source_identity->>'workforceProfileId'
	       AND event_value.after_payload->>'workforce_crew_id' IS NOT DISTINCT FROM review_value.source_identity->>'workforceCrewId'
	       AND event_value.after_payload->>'scheduled_start' IS NOT DISTINCT FROM review_value.source_identity->>'scheduledStart'
	       AND event_value.after_payload->>'scheduled_end' IS NOT DISTINCT FROM review_value.source_identity->>'scheduledEnd'))
     OR (event_value.source_kind IN('canonical_opportunities','canonical_estimates')
      AND event_value.subject_key=review_value.source_identity->>'opportunityId')
     OR (event_value.source_kind IN('canonical_equipment_plans','canonical_equipment_readiness_plans','canonical_travel_plans')
      AND event_value.subject_key IN(SELECT (basis->>'estimateId')||':'||(basis->>'kind')
       FROM jsonb_array_elements(COALESCE(review_value.source_identity->'m24Bases','[]'::jsonb)) entries(basis)))
     OR (review_value.source_identity->>'workforceCrewId' IS NOT NULL
      AND event_value.source_kind='workforce_crews'
      AND event_value.subject_key=review_value.source_identity->>'workforceCrewId')))
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_role_generations_v1 event_value
   WHERE event_value.organization_id=org
    AND event_value.source_order>COALESCE((review_value.source_identity->>'jobRoleSourceOrder')::bigint,0)
    AND event_value.observed_at<at_value
    AND event_value.profile_id::text=review_value.source_identity->>'workforceProfileId')
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_crew_events_v1 event_value
   WHERE event_value.organization_id=org
    AND event_value.source_order>COALESCE((review_value.source_identity->>'jobCrewSourceOrder')::bigint,0)
    AND event_value.observed_at<at_value
    AND event_value.crew_id::text=review_value.source_identity->>'workforceCrewId')
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_exact_pack(candidates JSONB)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_count INTEGER:=jsonb_array_length(candidates);visited INTEGER[]:=ARRAY[]::integer[];
 component INTEGER[];queue_pos INTEGER;left_index INTEGER;right_index INTEGER;left_value JSONB;right_value JSONB;
 mask BIGINT;limit_mask BIGINT;bit_pos INTEGER;used_profiles TEXT[];used_assets TEXT[];candidate_value JSONB;
 score INTEGER;best_score INTEGER;total_score INTEGER:=0;conflicts BOOLEAN;
BEGIN
 IF jsonb_typeof(candidates)<>'array' OR candidate_count>256 THEN
  RAISE EXCEPTION 'Exact constrained-capacity matching exceeds candidate bound' USING ERRCODE='54000';END IF;
 FOR left_index IN 1..candidate_count LOOP
  IF left_index=ANY(visited) THEN CONTINUE;END IF;
  component:=ARRAY[left_index];visited:=array_append(visited,left_index);queue_pos:=1;
  WHILE queue_pos<=cardinality(component) LOOP
   left_value:=candidates->(component[queue_pos]-1);
   FOR right_index IN 1..candidate_count LOOP
    IF right_index=ANY(visited) THEN CONTINUE;END IF;
    right_value:=candidates->(right_index-1);
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(left_value->'profiles') a(value)
      JOIN jsonb_array_elements_text(right_value->'profiles') b(value) ON b.value=a.value)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(left_value->'assets') a(value)
      JOIN jsonb_array_elements_text(right_value->'assets') b(value) ON b.value=a.value) INTO conflicts;
    IF conflicts THEN component:=array_append(component,right_index);visited:=array_append(visited,right_index);END IF;
   END LOOP;
   queue_pos:=queue_pos+1;
  END LOOP;
  IF cardinality(component)>20 THEN
   RAISE EXCEPTION 'Exact constrained-capacity matching component exceeds bound' USING ERRCODE='54000';END IF;
  best_score:=0;limit_mask:=(1::bigint<<cardinality(component));
  FOR mask IN 0..limit_mask-1 LOOP
   used_profiles:=ARRAY[]::text[];used_assets:=ARRAY[]::text[];score:=0;conflicts:=FALSE;
   FOR bit_pos IN 0..cardinality(component)-1 LOOP
    IF (mask&(1::bigint<<bit_pos))=0 THEN CONTINUE;END IF;
    candidate_value:=candidates->(component[bit_pos+1]-1);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(candidate_value->'profiles') value WHERE value=ANY(used_profiles))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(candidate_value->'assets') value WHERE value=ANY(used_assets)) THEN
     conflicts:=TRUE;EXIT;END IF;
    used_profiles:=used_profiles||ARRAY(SELECT value FROM jsonb_array_elements_text(candidate_value->'profiles') value);
    used_assets:=used_assets||ARRAY(SELECT value FROM jsonb_array_elements_text(candidate_value->'assets') value);
    score:=score+(candidate_value->>'targetSeats')::int;
   END LOOP;
   IF NOT conflicts THEN best_score:=GREATEST(best_score,score);END IF;
  END LOOP;
  total_score:=total_score+best_score;
 END LOOP;
 RETURN total_score;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_exact_match(
 definition_value JSONB,workers_value JSONB,assets_value JSONB,route_key TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidates_value JSONB;score_value INTEGER;target_role TEXT:=definition_value->>'role';
BEGIN
 WITH RECURSIVE formations AS (
  SELECT CASE WHEN (definition_value#>>'{applicability,crew}')::boolean THEN crew_id ELSE 'profile:'||profile_id END formation_key,
   CASE WHEN (definition_value#>>'{applicability,crew}')::boolean THEN crew_id ELSE NULL END crew_id,
   CASE WHEN (definition_value#>>'{applicability,crew}')::boolean THEN NULL ELSE profile_id END direct_profile
  FROM (SELECT DISTINCT value crew_id,NULL::text profile_id FROM jsonb_array_elements_text(definition_value->'crewIds') value
        WHERE (definition_value#>>'{applicability,crew}')::boolean
        UNION ALL
        SELECT DISTINCT NULL,value->>'profileId' FROM jsonb_array_elements(workers_value) value
        WHERE NOT (definition_value#>>'{applicability,crew}')::boolean AND value->>'role'=target_role) source
 ), seat_tokens AS (
  SELECT formation_key,crew_id,direct_profile,row_number() OVER(PARTITION BY formation_key ORDER BY role,ordinal)::int position,
   role,count(*) OVER(PARTITION BY formation_key)::int seat_count,
   count(*) FILTER(WHERE role=target_role) OVER(PARTITION BY formation_key)::int target_seats
  FROM (SELECT formation.formation_key,formation.crew_id,formation.direct_profile,required->>'role' role,ordinal
    FROM formations formation CROSS JOIN LATERAL jsonb_array_elements(definition_value->'crewRoleRequirements') required
    CROSS JOIN LATERAL generate_series(1,(required->>'count')::int) ordinal
    WHERE (definition_value#>>'{applicability,crew}')::boolean
    UNION ALL SELECT formation_key,crew_id,direct_profile,target_role,1 FROM formations
     WHERE NOT (definition_value#>>'{applicability,crew}')::boolean) tokens
 ), worker_paths AS (
  SELECT formation_key,crew_id,direct_profile,0 position,'[]'::jsonb profiles,0 seat_count,0 target_seats FROM formations
  UNION ALL
  SELECT path.formation_key,path.crew_id,path.direct_profile,path.position+1,
   path.profiles||jsonb_build_array(worker.value->>'profileId'),token.seat_count,token.target_seats
  FROM worker_paths path JOIN seat_tokens token ON token.formation_key=path.formation_key AND token.position=path.position+1
  JOIN LATERAL (SELECT value FROM jsonb_array_elements(workers_value) value
    WHERE value->>'role'=token.role AND value->'crewId' IS NOT DISTINCT FROM COALESCE(to_jsonb(path.crew_id),'null'::jsonb)
     AND (path.direct_profile IS NULL OR value->>'profileId'=path.direct_profile)
     AND NOT path.profiles ? (value->>'profileId') ORDER BY value->>'profileId') worker ON TRUE
 ), worker_candidates AS (
  SELECT DISTINCT formation_key,crew_id,
   (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(path.profiles) value) profiles,target_seats
  FROM worker_paths path WHERE position=seat_count AND seat_count>0
   AND (route_key IS NULL OR route_key='crew:'||COALESCE(crew_id,'')
    OR (route_key LIKE 'profile:%' AND path.profiles ? substring(route_key FROM 9)))
 ), asset_tokens AS (
  SELECT candidate.formation_key,candidate.crew_id,candidate.profiles,candidate.target_seats,
   row_number() OVER(PARTITION BY candidate.formation_key,candidate.profiles::text ORDER BY kind,ordinal)::int position,
   kind,count(*) OVER(PARTITION BY candidate.formation_key,candidate.profiles::text)::int asset_count
  FROM worker_candidates candidate CROSS JOIN LATERAL (
   SELECT 'vehicle' kind,ordinal FROM generate_series(1,(definition_value#>>'{assetRequirements,vehiclePerSeat}')::int*candidate.target_seats) ordinal
   UNION ALL SELECT 'equipment',ordinal FROM generate_series(1,(definition_value#>>'{assetRequirements,equipmentPerSeat}')::int*candidate.target_seats) ordinal) slots
 ), asset_paths AS (
  SELECT candidate.formation_key,candidate.crew_id,candidate.profiles,candidate.target_seats,0 position,
   '[]'::jsonb assets,'[]'::jsonb operators,
   (((definition_value#>>'{assetRequirements,vehiclePerSeat}')::int+
     (definition_value#>>'{assetRequirements,equipmentPerSeat}')::int)*candidate.target_seats) asset_count
   FROM worker_candidates candidate
  UNION ALL
  SELECT path.formation_key,path.crew_id,path.profiles,path.target_seats,path.position+1,
   path.assets||jsonb_build_array(asset.value->>'assetId'),path.operators||jsonb_build_array(asset.value->>'operatorProfileId'),token.asset_count
  FROM asset_paths path JOIN asset_tokens token ON token.formation_key=path.formation_key
    AND token.profiles=path.profiles AND token.position=path.position+1
  JOIN LATERAL (SELECT value FROM jsonb_array_elements(assets_value) value
    WHERE value->>'kind'=token.kind AND value->'crewId' IS NOT DISTINCT FROM COALESCE(to_jsonb(path.crew_id),'null'::jsonb)
     AND path.profiles ? (value->>'operatorProfileId') AND NOT path.assets ? (value->>'assetId')
     AND NOT path.operators ? (value->>'operatorProfileId')
    ORDER BY value->>'assetId',value->>'operatorProfileId') asset ON TRUE
 ), completed AS (
  SELECT DISTINCT profiles,assets,target_seats FROM asset_paths
   WHERE (asset_count=0 AND position=0) OR (asset_count>0 AND position=asset_count)
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('profiles',profiles,'assets',assets,'targetSeats',target_seats)
    ORDER BY profiles::text,assets::text),'[]'::jsonb) INTO candidates_value FROM completed;
 IF jsonb_array_length(candidates_value)>256 THEN
  RAISE EXCEPTION 'Exact constrained-capacity matching exceeds candidate bound' USING ERRCODE='54000';END IF;
 score_value:=public.canonical_forecast_constrained_capacity_v1_exact_pack(candidates_value);
 RETURN jsonb_build_object('targetSlots',score_value,'candidateCount',jsonb_array_length(candidates_value),
  'matchingDigest',public.canonical_completion_digest(candidates_value));
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_scope_segment(
 org UUID,scope_review public.canonical_forecast_constrained_capacity_reviews_v1,
 start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,job_evidence JSONB,route_key TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE definition_value JSONB:=scope_review.definition;segment_minutes NUMERIC:=EXTRACT(EPOCH FROM(end_value-start_value))/60;
 profile JSONB;requirement JSONB;role_result JSONB;role_profile JSONB;
 target_value JSONB;profile_id TEXT;role_value TEXT;target_seats INTEGER:=1;
 vehicle_needed INTEGER:=(definition_value#>>'{assetRequirements,vehiclePerSeat}')::int;
 equipment_needed INTEGER:=(definition_value#>>'{assetRequirements,equipmentPerSeat}')::int;
 worker_minutes NUMERIC:=0;calendar_value JSONB;business_payload JSONB;business_id TEXT;
 asset_assignment JSONB;asset_payload JSONB;asset_free BOOLEAN;crew_payload JSONB;reviewed_asset JSONB;
 operator_assignment JSONB;operator_result JSONB;operator_row JSONB;operator_available BOOLEAN;
 workers_value JSONB:='[]'::jsonb;assets_value JSONB:='[]'::jsonb;match_value JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_source_events_v1 value
   WHERE value.organization_id=org AND value.source_order>
     COALESCE((scope_review.source_identity->>'scopeConstrainedSourceOrder')::bigint,0)
    AND value.observed_at<=start_value AND (
     (value.source_kind='canonical_business_profiles'
      AND value.subject_key=scope_review.source_identity#>>'{businessProfile,id}')
     OR (value.source_kind='workforce_crews' AND value.subject_key IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item))
     OR (value.source_kind='workforce_crew_members' AND split_part(value.subject_key,':',1) IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item))
     OR (value.source_kind='workforce_skills' AND value.subject_key IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'skillIds') item))
     OR (value.source_kind='workforce_profile_skills' AND split_part(value.subject_key,':',1) IN
      (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item))
     OR (value.source_kind='tenant_assets' AND value.subject_key IN
      (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item))
     OR (value.source_kind='tenant_asset_service_capabilities' AND split_part(value.subject_key,':',1) IN
      (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item))
     OR (value.source_kind='canonical_equipment_events' AND COALESCE(value.after_payload,value.before_payload)->>'asset_id' IN
      (SELECT item#>>'{}' FROM jsonb_array_elements((definition_value->'vehicleAssetIds')||(definition_value->'equipmentAssetIds')) item))))
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
   WHERE value.organization_id=org AND value.source_order>
     COALESCE((scope_review.source_identity->>'scopeRoleSourceOrder')::bigint,0)
    AND value.observed_at<=start_value AND value.profile_id::text IN
     (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item))
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_profile_events_v1 value
   WHERE value.organization_id=org AND value.source_order>
     COALESCE((scope_review.source_identity->>'scopeProfileSourceOrder')::bigint,0)
    AND value.observed_at<=start_value AND value.profile_id::text IN
     (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item))
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_crew_events_v1 value
   WHERE value.organization_id=org AND value.source_order>
     COALESCE((scope_review.source_identity->>'scopeCrewSourceOrder')::bigint,0)
    AND value.observed_at<=start_value AND (value.crew_id::text IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item)
     OR value.profile_id::text IN
      (SELECT item->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') item))) THEN
  RAISE EXCEPTION 'Applicable constrained-capacity scope review stale' USING ERRCODE='22023';END IF;
 business_id:=scope_review.source_identity#>>'{businessProfile,id}';
 business_payload:=public.canonical_forecast_constrained_capacity_v1_source_payload_at(
  org,'canonical_business_profiles',business_id,start_value);
 IF business_payload IS NULL OR COALESCE((business_payload->>'is_active')::boolean,FALSE) IS NOT TRUE THEN
  RAISE EXCEPTION 'Business calendar transition unsupported' USING ERRCODE='22023';END IF;
 calendar_value:=public.canonical_forecast_constrained_capacity_v1_working_windows(
  business_payload->'raw_profile',start_value,end_value,business_payload#>>'{raw_profile,company,timeZone}');
 IF jsonb_array_length(calendar_value->'unknownDates')>0 THEN
  RAISE EXCEPTION 'Business calendar interval unavailable' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(calendar_value->'windows') value
   WHERE (value->>'start')::timestamptz<=start_value AND (value->>'end')::timestamptz>=end_value) THEN
  RETURN jsonb_build_object('personMinutes',0,'segmentMinutes',segment_minutes,'crewSlots',0);END IF;
 target_value:=public.canonical_forecast_workload_capacity_v1_capacity_calculation(
  org,start_value,end_value,end_value,definition_value->>'role');
 IF (target_value->>'classificationComplete')::boolean IS NOT TRUE
  OR (target_value->>'availabilityComplete')::boolean IS NOT TRUE OR COALESCE((target_value->>'overlap')::boolean,FALSE) THEN
  RAISE EXCEPTION 'Target-role interval evidence incomplete' USING ERRCODE='22023';END IF;
 IF (definition_value#>>'{applicability,crew}')::boolean THEN
  SELECT (value->>'count')::int INTO target_seats FROM jsonb_array_elements(definition_value->'crewRoleRequirements') value
   WHERE value->>'role'=definition_value->>'role';
 ELSE target_seats:=1;END IF;
 FOR operator_assignment IN SELECT value FROM jsonb_array_elements(definition_value->'crewAssignments') entries(value)
  ORDER BY value->>'profileId',value->>'crewId',value->>'role' LOOP
  role_value:=operator_assignment->>'role';profile_id:=operator_assignment->>'profileId';
  role_result:=CASE WHEN role_value=definition_value->>'role' THEN target_value ELSE
    public.canonical_forecast_workload_capacity_v1_capacity_calculation(org,start_value,end_value,end_value,role_value) END;
  IF (role_result->>'classificationComplete')::boolean IS NOT TRUE
   OR (role_result->>'availabilityComplete')::boolean IS NOT TRUE OR COALESCE((role_result->>'overlap')::boolean,FALSE) THEN
   RAISE EXCEPTION 'Formation-role interval evidence incomplete' USING ERRCODE='22023';END IF;
  SELECT value INTO role_profile FROM jsonb_array_elements(role_result->'rows') value WHERE value->>'profileId'=profile_id;
  IF role_profile IS NOT NULL AND (role_profile->>'availableMinutes')::numeric=round(segment_minutes,6)
   AND (operator_assignment->'crewId'='null'::jsonb OR public.canonical_forecast_constrained_capacity_v1_subject_present(
     org,'workforce_crew_members',(operator_assignment->>'crewId')||':'||profile_id,start_value))
   AND (NOT (definition_value#>>'{applicability,skill}')::boolean OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(definition_value->'skillIds') skill WHERE NOT
     public.canonical_forecast_constrained_capacity_v1_subject_present(
      org,'workforce_profile_skills',profile_id||':'||(skill#>>'{}'),start_value))) THEN
   workers_value:=workers_value||jsonb_build_array(jsonb_build_object('profileId',profile_id,
    'crewId',operator_assignment->'crewId','role',role_value));
  END IF;
 END LOOP;
 FOR asset_assignment IN SELECT value FROM jsonb_array_elements(definition_value->'assetAssignments') entries(value)
  ORDER BY value->>'assetId',value->>'crewId',value->>'operatorProfileId' LOOP
   crew_payload:=CASE WHEN asset_assignment->'crewId'='null'::jsonb THEN NULL ELSE
    public.canonical_forecast_constrained_capacity_v1_source_payload_at(org,'workforce_crews',asset_assignment->>'crewId',start_value) END;
   IF asset_assignment->'crewId'<>'null'::jsonb AND crew_payload IS NULL THEN
    RAISE EXCEPTION 'Crew interval authority unavailable' USING ERRCODE='22023';END IF;
   asset_payload:=public.canonical_forecast_constrained_capacity_v1_source_payload_at(
    org,'tenant_assets',asset_assignment->>'assetId',start_value);
   SELECT value INTO reviewed_asset FROM jsonb_array_elements(scope_review.source_identity->'assets') value
    WHERE value->>'id'=asset_assignment->>'assetId';
   SELECT value INTO operator_assignment FROM jsonb_array_elements(definition_value->'crewAssignments') value
     WHERE value->>'profileId'=asset_assignment->>'operatorProfileId'
      AND value->'crewId' IS NOT DISTINCT FROM asset_assignment->'crewId'
     ORDER BY value->>'role' LIMIT 1;
   operator_available:=FALSE;
   IF operator_assignment IS NOT NULL THEN
    operator_result:=CASE WHEN operator_assignment->>'role'=definition_value->>'role' THEN target_value ELSE
     public.canonical_forecast_workload_capacity_v1_capacity_calculation(
      org,start_value,end_value,end_value,operator_assignment->>'role') END;
    SELECT value INTO operator_row FROM jsonb_array_elements(operator_result->'rows') value
     WHERE value->>'profileId'=asset_assignment->>'operatorProfileId';
    operator_available:=operator_row IS NOT NULL
     AND (operator_row->>'availableMinutes')::numeric=round(segment_minutes,6);
   END IF;
   asset_free:=operator_available AND asset_payload IS NOT NULL AND reviewed_asset IS NOT NULL
    AND asset_payload->>'catalogue_state'='active'
    AND asset_payload->>'category'=asset_assignment->>'kind'
    AND asset_payload->>'home_location_id'=COALESCE(crew_payload->>'home_location_id',
      (public.canonical_forecast_constrained_capacity_v1_source_payload_at(org,'workforce_profiles',
       asset_assignment->>'operatorProfileId',start_value))->>'home_location_id')
    AND (asset_assignment->'crewId'='null'::jsonb OR public.canonical_forecast_constrained_capacity_v1_subject_present(
      org,'workforce_crew_members',(asset_assignment->>'crewId')||':'||(asset_assignment->>'operatorProfileId'),start_value))
    AND public.canonical_completion_digest(asset_payload->'configuration')=
      public.canonical_completion_digest(reviewed_asset->'configuration')
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(job_evidence) job_item
      JOIN public.canonical_forecast_constrained_capacity_reviews_v1 pinned_job_review
       ON pinned_job_review.organization_id=org AND pinned_job_review.id=(job_item->>'reviewId')::uuid
      JOIN LATERAL (SELECT newer.* FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
       WHERE newer.organization_id=org AND newer.review_kind='job'
        AND newer.scope_key=scope_review.scope_key AND newer.subject_id=pinned_job_review.subject_id
        AND newer.decided_at<=start_value AND newer.action='approve'
       ORDER BY newer.decided_at DESC,newer.revision DESC LIMIT 1) job_review ON TRUE
      WHERE job_item->>'alternativeKey'=definition_value->>'alternativeKey'
       AND job_item->>'scopeKey'=scope_review.scope_key
       AND NOT public.canonical_forecast_constrained_capacity_v1_subject_present(org,
        'tenant_asset_service_capabilities',(asset_assignment->>'assetId')||':'||(job_review.source_identity->>'serviceType'),start_value))
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'assetCalendars') value
      WHERE value->>'assetId'=asset_assignment->>'assetId'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(value->'availableIntervals') interval_value
        WHERE (interval_value->>'start')::timestamptz<=start_value AND (interval_value->>'end')::timestamptz>=end_value)
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'committedIntervals') interval_value
        WHERE (interval_value->>'start')::timestamptz<end_value AND (interval_value->>'end')::timestamptz>start_value));
   IF asset_free THEN assets_value:=assets_value||jsonb_build_array(jsonb_build_object(
    'assetId',asset_assignment->>'assetId','crewId',asset_assignment->'crewId',
    'kind',asset_assignment->>'kind','operatorProfileId',asset_assignment->>'operatorProfileId'));END IF;
 END LOOP;
 match_value:=public.canonical_forecast_constrained_capacity_v1_exact_match(definition_value,workers_value,assets_value,route_key);
 worker_minutes:=(match_value->>'targetSlots')::int*segment_minutes;
 RETURN jsonb_build_object('personMinutes',worker_minutes,'segmentMinutes',segment_minutes,
  'crewSlots',CASE WHEN target_seats=0 THEN 0 ELSE (match_value->>'targetSlots')::int/target_seats END,
  'targetSlots',(match_value->>'targetSlots')::int,'matchingDigest',match_value->>'matchingDigest');
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_scope_calculation(
 org UUID,scope_review public.canonical_forecast_constrained_capacity_reviews_v1,
 start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,as_of_value TIMESTAMPTZ,job_evidence JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE definition_value JSONB:=scope_review.definition;endpoints TIMESTAMPTZ[]:=ARRAY[start_value,end_value];
 endpoint_value TIMESTAMPTZ;prior_value TIMESTAMPTZ;segment_value JSONB;person_minutes NUMERIC:=0;
 interval_value JSONB;calendar_value JSONB;business_payload JSONB;business_id TEXT;event_value RECORD;
 job_item JSONB;job_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 active_scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 assignment_value public.canonical_schedule_assignment_revisions%ROWTYPE;assignment_decided_at TIMESTAMPTZ;travel_minutes NUMERIC:=0;
 ordered_job JSONB;prior_job JSONB:=NULL;scheduled_rows JSONB:='[]'::jsonb;duration_value INTEGER;
  home_location TEXT;home_count INTEGER;route_value TEXT;route_jobs JSONB;active_target_seats INTEGER:=1;
 route_definition JSONB;
 base_value JSONB;support_value JSONB;requirement JSONB;
 travel_start TIMESTAMPTZ;travel_end TIMESTAMPTZ;travel_segment JSONB;
BEGIN
 IF scope_review.id IS NULL OR scope_review.action<>'approve' THEN
 RAISE EXCEPTION 'Constrained-capacity scope unavailable' USING ERRCODE='22023';END IF;
 base_value:=public.canonical_forecast_workload_capacity_v1_capacity_calculation(
  org,start_value,end_value,start_value,definition_value->>'role');
 IF (base_value->>'censusCount')::int>100 OR (base_value->>'count')::int>100 THEN
  RAISE EXCEPTION 'Capacity evidence exceeds bound' USING ERRCODE='54000';END IF;
 IF (base_value->>'classificationComplete')::boolean IS NOT TRUE OR
    (base_value->>'availabilityComplete')::boolean IS NOT TRUE OR COALESCE((base_value->>'overlap')::boolean,FALSE)
	    OR jsonb_array_length(base_value->'rows')<>(SELECT count(DISTINCT assigned->>'profileId') FROM jsonb_array_elements(definition_value->'crewAssignments') assigned
      WHERE assigned->>'role'=definition_value->>'role')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(base_value->'rows') row_value
      WHERE row_value->>'profileId' NOT IN(SELECT value->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') value
       WHERE value->>'role'=definition_value->>'role')) THEN
  RAISE EXCEPTION 'Complete target-role population unavailable' USING ERRCODE='22023';END IF;
 FOR requirement IN SELECT value FROM jsonb_array_elements(definition_value->'crewRoleRequirements') entries(value)
  WHERE value->>'role'<>definition_value->>'role' LOOP
  support_value:=public.canonical_forecast_workload_capacity_v1_capacity_calculation(
   org,start_value,end_value,start_value,requirement->>'role');
  IF (support_value->>'classificationComplete')::boolean IS NOT TRUE
   OR (support_value->>'availabilityComplete')::boolean IS NOT TRUE OR COALESCE((support_value->>'overlap')::boolean,FALSE) THEN
   RAISE EXCEPTION 'Complete support-role population unavailable' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(support_value->'rows') row_value
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(scope_review.source_identity->'crewMembers') member
      WHERE member->>1=row_value->>'profileId' AND member->>0 IN
       (SELECT value#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') value))
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewAssignments') assigned
      WHERE assigned->>'profileId'=row_value->>'profileId' AND assigned->>'role'=requirement->>'role')) THEN
   RAISE EXCEPTION 'Complete support-role allocation unavailable' USING ERRCODE='22023';END IF;
 END LOOP;
 business_id:=scope_review.source_identity#>>'{businessProfile,id}';
 business_payload:=public.canonical_forecast_constrained_capacity_v1_source_payload_at(org,'canonical_business_profiles',business_id,start_value);
 IF business_payload IS NULL THEN RAISE EXCEPTION 'Business calendar authority unavailable' USING ERRCODE='22023';END IF;
 calendar_value:=public.canonical_forecast_constrained_capacity_v1_working_windows(
  business_payload->'raw_profile',start_value,end_value,business_payload#>>'{raw_profile,company,timeZone}');
 IF jsonb_array_length(calendar_value->'unknownDates')>0 THEN RAISE EXCEPTION 'Business calendar unavailable' USING ERRCODE='22023';END IF;
 FOR interval_value IN SELECT value FROM jsonb_array_elements(calendar_value->'windows') entries(value) LOOP
  endpoints:=array_append(endpoints,(interval_value->>'start')::timestamptz);
  endpoints:=array_append(endpoints,(interval_value->>'end')::timestamptz);END LOOP;
 FOR interval_value IN SELECT interval_entry FROM public.canonical_forecast_workload_capacity_reviews_v1 review_value,
  LATERAL jsonb_array_elements(review_value.source_identity->'intervals') interval_entry
  WHERE review_value.organization_id=org AND review_value.review_kind='availability_basis'
   AND review_value.subject_id::text IN(SELECT value->>'profileId' FROM jsonb_array_elements(definition_value->'crewAssignments') value)
   AND review_value.id=(SELECT latest.id FROM public.canonical_forecast_workload_capacity_reviews_v1 latest
    WHERE latest.organization_id=org AND latest.review_kind='availability_basis'
     AND latest.subject_id=review_value.subject_id ORDER BY latest.revision DESC LIMIT 1)
 LOOP
  IF (interval_value->>'start')::timestamptz>start_value AND (interval_value->>'start')::timestamptz<end_value THEN endpoints:=array_append(endpoints,(interval_value->>'start')::timestamptz);END IF;
  IF (interval_value->>'end')::timestamptz>start_value AND (interval_value->>'end')::timestamptz<end_value THEN endpoints:=array_append(endpoints,(interval_value->>'end')::timestamptz);END IF;
 END LOOP;
 FOR interval_value IN SELECT interval_entry FROM jsonb_array_elements(definition_value->'assetCalendars') calendar_entry,
   LATERAL jsonb_array_elements((calendar_entry->'availableIntervals')||(calendar_entry->'committedIntervals')) interval_entry LOOP
  IF (interval_value->>'start')::timestamptz>start_value AND (interval_value->>'start')::timestamptz<end_value THEN endpoints:=array_append(endpoints,(interval_value->>'start')::timestamptz);END IF;
  IF (interval_value->>'end')::timestamptz>start_value AND (interval_value->>'end')::timestamptz<end_value THEN endpoints:=array_append(endpoints,(interval_value->>'end')::timestamptz);END IF;
 END LOOP;
 FOR interval_value IN SELECT interval_entry
  FROM public.canonical_forecast_constrained_capacity_reviews_v1 review_value,
   LATERAL jsonb_array_elements(review_value.definition->'assetCalendars') calendar_entry,
   LATERAL jsonb_array_elements((calendar_entry->'availableIntervals')||(calendar_entry->'committedIntervals')) interval_entry
  WHERE review_value.organization_id=org AND review_value.review_kind='scope'
   AND review_value.scope_key=scope_review.scope_key AND review_value.action='approve'
   AND review_value.decided_at>start_value AND review_value.decided_at<end_value LOOP
  IF (interval_value->>'start')::timestamptz>start_value AND (interval_value->>'start')::timestamptz<end_value THEN endpoints:=array_append(endpoints,(interval_value->>'start')::timestamptz);END IF;
  IF (interval_value->>'end')::timestamptz>start_value AND (interval_value->>'end')::timestamptz<end_value THEN endpoints:=array_append(endpoints,(interval_value->>'end')::timestamptz);END IF;
 END LOOP;
 FOR event_value IN
  SELECT observed_at FROM public.canonical_forecast_constrained_capacity_source_events_v1
   WHERE organization_id=org AND observed_at>start_value AND observed_at<end_value
  UNION SELECT observed_at FROM public.canonical_forecast_workload_capacity_role_generations_v1 WHERE organization_id=org AND observed_at>start_value AND observed_at<end_value
  UNION SELECT observed_at FROM public.canonical_forecast_workload_capacity_profile_events_v1 WHERE organization_id=org AND observed_at>start_value AND observed_at<end_value
  UNION SELECT observed_at FROM public.canonical_forecast_workload_capacity_availability_events_v1 WHERE organization_id=org AND observed_at>start_value AND observed_at<end_value
  UNION SELECT observed_at FROM public.canonical_forecast_workload_capacity_crew_events_v1 WHERE organization_id=org AND observed_at>start_value AND observed_at<end_value
  UNION SELECT decided_at FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND decided_at>start_value AND decided_at<end_value
  UNION SELECT decided_at FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND review_kind IN('scope','job')
    AND decided_at>start_value AND decided_at<end_value
 LOOP endpoints:=array_append(endpoints,event_value.observed_at);END LOOP;
 FOR job_item IN SELECT entry FROM jsonb_array_elements(job_evidence) entries(entry)
  WHERE entry->>'alternativeKey'=definition_value->>'alternativeKey' AND entry->>'scopeKey'=scope_review.scope_key LOOP
  SELECT * INTO job_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(job_item->>'reviewId')::uuid;
  IF job_review.id IS NULL OR job_review.action<>'approve' THEN RAISE EXCEPTION 'Approved work receipt unavailable' USING ERRCODE='22023';END IF;
  SELECT revision_value.* INTO assignment_value FROM public.canonical_schedule_assignment_revisions revision_value
   LEFT JOIN public.canonical_schedule_human_approvals human_value ON human_value.organization_id=revision_value.organization_id AND human_value.id=revision_value.human_approval_id
   LEFT JOIN public.canonical_schedule_approvals approval_value ON approval_value.organization_id=revision_value.organization_id AND approval_value.id=revision_value.approval_id
   WHERE revision_value.organization_id=org AND revision_value.assignment_id=(job_review.definition->>'assignmentId')::uuid
    AND COALESCE(human_value.approved_at,approval_value.approved_at)<=as_of_value
   ORDER BY COALESCE(human_value.approved_at,approval_value.approved_at) DESC,revision_value.revision DESC LIMIT 1;
  IF assignment_value.assignment_id IS NULL THEN RAISE EXCEPTION 'Approved commitment unavailable' USING ERRCODE='22023';END IF;
  SELECT COALESCE(human_value.approved_at,approval_value.approved_at) INTO assignment_decided_at
   FROM public.canonical_schedule_assignment_revisions revision_value
   LEFT JOIN public.canonical_schedule_human_approvals human_value ON human_value.organization_id=revision_value.organization_id
    AND human_value.id=revision_value.human_approval_id
   LEFT JOIN public.canonical_schedule_approvals approval_value ON approval_value.organization_id=revision_value.organization_id
    AND approval_value.id=revision_value.approval_id
   WHERE revision_value.organization_id=org AND revision_value.assignment_id=assignment_value.assignment_id
    AND revision_value.revision=assignment_value.revision;
  IF assignment_value.schedule_state='scheduled' THEN
   job_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
    org,'job',scope_review.scope_key,job_review.subject_id,GREATEST(assignment_value.scheduled_start,start_value));
   IF job_review.definition->>'alternativeKey' IS DISTINCT FROM definition_value->>'alternativeKey'
    OR job_review.definition->>'scopeKey' IS DISTINCT FROM scope_review.scope_key THEN
    RAISE EXCEPTION 'Applicable approved work scope unavailable' USING ERRCODE='22023';END IF;
  END IF;
  -- The owning schedule authority remains the commitment clock even when a
  -- later completion/cancellation shortens route evidence. Split every
  -- intersecting approved commitment at its exact half-open boundaries so
  -- the base role-hours calculation subtracts only that interval rather than
  -- making the entire surrounding calendar segment unavailable.
  IF assignment_value.schedule_state='scheduled' AND assignment_value.scheduled_start<end_value
   AND assignment_value.scheduled_end>start_value THEN
   endpoints:=array_append(endpoints,GREATEST(assignment_value.scheduled_start,start_value));
   endpoints:=array_append(endpoints,LEAST(assignment_value.scheduled_end,end_value));
  END IF;
  IF assignment_value.schedule_state='scheduled' AND assignment_value.scheduled_start<end_value
   AND LEAST(assignment_value.scheduled_end,CASE WHEN job_item->>'appointmentStatus' IN('completed','cancelled')
      THEN (job_item->>'statusObservedAt')::timestamptz ELSE assignment_value.scheduled_end END)>
       GREATEST(assignment_value.scheduled_start,start_value) THEN
   endpoints:=array_append(endpoints,GREATEST(assignment_value.scheduled_start,start_value));
   endpoints:=array_append(endpoints,LEAST(assignment_value.scheduled_end,end_value,
    CASE WHEN job_item->>'appointmentStatus' IN('completed','cancelled')
     THEN (job_item->>'statusObservedAt')::timestamptz ELSE assignment_value.scheduled_end END));
   scheduled_rows:=scheduled_rows||jsonb_build_array(jsonb_build_object('appointmentId',job_review.subject_id,
   'start',assignment_value.scheduled_start,'end',LEAST(assignment_value.scheduled_end,
     CASE WHEN job_item->>'appointmentStatus' IN('completed','cancelled')
      THEN (job_item->>'statusObservedAt')::timestamptz ELSE assignment_value.scheduled_end END),
    'routeKey',job_review.source_identity->>'routeKey',
    'routeHomeLocation',job_review.source_identity->>'routeHomeLocation',
    'locationKey',job_review.definition->>'locationKey','previousLocationKey',job_review.definition->>'previousLocationKey',
    'nextLocationKey',job_review.definition->>'nextLocationKey'));
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements((job_review.definition->'vehicleAssetIds')||(job_review.definition->'equipmentAssetIds')) asset_id
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scope_review.source_identity->'assetCapabilities') capability
     WHERE capability->>0=asset_id#>>'{}' AND lower(capability->>1)=lower(job_review.source_identity->>'serviceType'))) THEN
   RAISE EXCEPTION 'Approved work asset suitability unavailable' USING ERRCODE='22023';END IF;
 END LOOP;
  IF (definition_value#>>'{applicability,travel}')::boolean THEN
 FOR route_value IN SELECT DISTINCT entry->>'routeKey' FROM jsonb_array_elements(scheduled_rows) entries(entry) ORDER BY 1 LOOP
  SELECT count(DISTINCT entry->>'routeHomeLocation'),min(entry->>'routeHomeLocation'),
    jsonb_agg(entry ORDER BY (entry->>'start')::timestamptz,entry->>'appointmentId')
   INTO home_count,home_location,route_jobs FROM jsonb_array_elements(scheduled_rows) entries(entry)
   WHERE entry->>'routeKey'=route_value;
  IF home_count<>1 OR home_location IS NULL THEN RAISE EXCEPTION 'Exact route home location unavailable' USING ERRCODE='22023';END IF;
  prior_job:=NULL;
  FOR ordered_job IN SELECT entry FROM jsonb_array_elements(route_jobs) entries(entry) ORDER BY (entry->>'start')::timestamptz,entry->>'appointmentId' LOOP
  IF prior_job IS NULL THEN
   IF ordered_job->>'previousLocationKey' IS DISTINCT FROM home_location THEN RAISE EXCEPTION 'First approved commitment origin unavailable' USING ERRCODE='22023';END IF;
   active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
    org,'scope',scope_review.scope_key,NULL,(ordered_job->>'start')::timestamptz);
   route_definition:=active_scope_review.definition;
   SELECT (value->>'durationMinutes')::int INTO duration_value FROM jsonb_array_elements(route_definition->'travelPairs') value
    WHERE value->>'fromLocationKey'=home_location AND value->>'toLocationKey'=ordered_job->>'locationKey';
   IF duration_value IS NULL THEN RAISE EXCEPTION 'Ordered route duration unavailable' USING ERRCODE='22023';END IF;
   travel_end:=(ordered_job->>'start')::timestamptz;travel_start:=travel_end-make_interval(mins=>duration_value);
  ELSE
   IF ordered_job->>'previousLocationKey'=home_location AND prior_job->>'nextLocationKey'=home_location THEN
    active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
     org,'scope',scope_review.scope_key,NULL,(prior_job->>'end')::timestamptz);
    route_definition:=active_scope_review.definition;
    SELECT (value->>'durationMinutes')::int INTO duration_value FROM jsonb_array_elements(route_definition->'travelPairs') value
     WHERE value->>'fromLocationKey'=prior_job->>'locationKey' AND value->>'toLocationKey'=home_location;
    IF duration_value IS NULL THEN RAISE EXCEPTION 'Return route duration unavailable' USING ERRCODE='22023';END IF;
    travel_start:=(prior_job->>'end')::timestamptz;travel_end:=travel_start+make_interval(mins=>duration_value);
    IF duration_value>0 AND travel_start<end_value AND travel_end>start_value THEN
     active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
      org,'scope',scope_review.scope_key,NULL,GREATEST(travel_start,start_value));
     travel_segment:=public.canonical_forecast_constrained_capacity_v1_scope_segment(org,active_scope_review,
      GREATEST(travel_start,start_value),LEAST(travel_end,end_value),job_evidence,route_value);
     IF (travel_segment->>'crewSlots')::int<1 THEN RAISE EXCEPTION 'Crew or asset return interval unavailable' USING ERRCODE='22023';END IF;
     active_target_seats:=CASE WHEN (active_scope_review.definition#>>'{applicability,crew}')::boolean THEN
      (SELECT (value->>'count')::int FROM jsonb_array_elements(active_scope_review.definition->'crewRoleRequirements') value
       WHERE value->>'role'=active_scope_review.definition->>'role') ELSE 1 END;
     travel_minutes:=travel_minutes+(EXTRACT(EPOCH FROM(LEAST(travel_end,end_value)-GREATEST(travel_start,start_value)))/60)*active_target_seats;
    END IF;
    active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
     org,'scope',scope_review.scope_key,NULL,(ordered_job->>'start')::timestamptz);
    route_definition:=active_scope_review.definition;
    SELECT (value->>'durationMinutes')::int INTO duration_value FROM jsonb_array_elements(route_definition->'travelPairs') value
     WHERE value->>'fromLocationKey'=home_location AND value->>'toLocationKey'=ordered_job->>'locationKey';
    IF duration_value IS NULL THEN RAISE EXCEPTION 'Outbound route duration unavailable' USING ERRCODE='22023';END IF;
    travel_end:=(ordered_job->>'start')::timestamptz;travel_start:=travel_end-make_interval(mins=>duration_value);
    IF travel_start<(prior_job->>'end')::timestamptz THEN RAISE EXCEPTION 'Travel interval conflicts with approved commitment' USING ERRCODE='22023';END IF;
   ELSE
    IF ordered_job->>'previousLocationKey' IS DISTINCT FROM prior_job->>'locationKey'
     OR prior_job->>'nextLocationKey' IS DISTINCT FROM ordered_job->>'locationKey' THEN RAISE EXCEPTION 'Ordered route identity unavailable' USING ERRCODE='22023';END IF;
    active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
     org,'scope',scope_review.scope_key,NULL,(prior_job->>'end')::timestamptz);
    route_definition:=active_scope_review.definition;
    SELECT (value->>'durationMinutes')::int INTO duration_value FROM jsonb_array_elements(route_definition->'travelPairs') value
     WHERE value->>'fromLocationKey'=prior_job->>'locationKey' AND value->>'toLocationKey'=ordered_job->>'locationKey';
    IF duration_value IS NULL THEN RAISE EXCEPTION 'Ordered route duration unavailable' USING ERRCODE='22023';END IF;
    IF (ordered_job->>'start')::timestamptz<(prior_job->>'end')::timestamptz+make_interval(mins=>duration_value) THEN RAISE EXCEPTION 'Travel interval conflicts with approved commitment' USING ERRCODE='22023';END IF;
    travel_start:=(prior_job->>'end')::timestamptz;travel_end:=travel_start+make_interval(mins=>duration_value);
   END IF;
  END IF;
  IF duration_value IS NULL THEN RAISE EXCEPTION 'Ordered route duration unavailable' USING ERRCODE='22023';END IF;
  IF duration_value>0 AND travel_start<end_value AND travel_end>start_value THEN
   travel_start:=GREATEST(travel_start,start_value);travel_end:=LEAST(travel_end,end_value);
   endpoints:=array_append(endpoints,travel_start);endpoints:=array_append(endpoints,travel_end);
   active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
    org,'scope',scope_review.scope_key,NULL,travel_start);
    travel_segment:=public.canonical_forecast_constrained_capacity_v1_scope_segment(
     org,active_scope_review,travel_start,travel_end,job_evidence,route_value);
    IF (travel_segment->>'crewSlots')::int<1 THEN
     RAISE EXCEPTION 'Crew or asset travel interval unavailable' USING ERRCODE='22023';END IF;
    active_target_seats:=CASE WHEN (active_scope_review.definition#>>'{applicability,crew}')::boolean THEN
     (SELECT (value->>'count')::int FROM jsonb_array_elements(active_scope_review.definition->'crewRoleRequirements') value
      WHERE value->>'role'=active_scope_review.definition->>'role') ELSE 1 END;
    travel_minutes:=travel_minutes+(EXTRACT(EPOCH FROM(travel_end-travel_start))/60)*active_target_seats;
  END IF;
  prior_job:=ordered_job;
  END LOOP;
  IF prior_job IS NOT NULL THEN
  IF prior_job->>'nextLocationKey' IS DISTINCT FROM home_location THEN RAISE EXCEPTION 'Final approved commitment destination unavailable' USING ERRCODE='22023';END IF;
  active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
   org,'scope',scope_review.scope_key,NULL,(prior_job->>'end')::timestamptz);
  route_definition:=active_scope_review.definition;
  SELECT (value->>'durationMinutes')::int INTO duration_value FROM jsonb_array_elements(route_definition->'travelPairs') value
   WHERE value->>'fromLocationKey'=prior_job->>'locationKey' AND value->>'toLocationKey'=home_location;
  IF duration_value IS NULL THEN RAISE EXCEPTION 'Return route duration unavailable' USING ERRCODE='22023';END IF;
  travel_start:=(prior_job->>'end')::timestamptz;travel_end:=travel_start+make_interval(mins=>duration_value);
  IF duration_value>0 AND travel_start<end_value AND travel_end>start_value THEN
   travel_start:=GREATEST(travel_start,start_value);travel_end:=LEAST(travel_end,end_value);
   endpoints:=array_append(endpoints,travel_start);endpoints:=array_append(endpoints,travel_end);
   active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
    org,'scope',scope_review.scope_key,NULL,travel_start);
   travel_segment:=public.canonical_forecast_constrained_capacity_v1_scope_segment(
    org,active_scope_review,travel_start,travel_end,job_evidence,route_value);
   IF (travel_segment->>'crewSlots')::int<1 THEN
    RAISE EXCEPTION 'Crew or asset return interval unavailable' USING ERRCODE='22023';END IF;
   active_target_seats:=CASE WHEN (active_scope_review.definition#>>'{applicability,crew}')::boolean THEN
    (SELECT (value->>'count')::int FROM jsonb_array_elements(active_scope_review.definition->'crewRoleRequirements') value
     WHERE value->>'role'=active_scope_review.definition->>'role') ELSE 1 END;
   travel_minutes:=travel_minutes+(EXTRACT(EPOCH FROM(travel_end-travel_start))/60)*active_target_seats;
 END IF;
 END IF;
 END LOOP;
 END IF;
 prior_value:=NULL;
 FOR endpoint_value IN SELECT DISTINCT endpoint FROM unnest(endpoints) entries(endpoint) WHERE endpoint>=start_value AND endpoint<=end_value ORDER BY endpoint LOOP
  IF prior_value IS NOT NULL AND endpoint_value>prior_value THEN
   active_scope_review:=public.canonical_forecast_constrained_capacity_v1_review_at(
    org,'scope',scope_review.scope_key,NULL,prior_value);
   IF active_scope_review.definition->>'alternativeKey' IS DISTINCT FROM definition_value->>'alternativeKey'
    OR active_scope_review.definition->>'role' IS DISTINCT FROM definition_value->>'role' THEN
    RAISE EXCEPTION 'Applicable constrained-capacity scope changed' USING ERRCODE='22023';END IF;
   segment_value:=public.canonical_forecast_constrained_capacity_v1_scope_segment(org,active_scope_review,prior_value,endpoint_value,job_evidence);
   person_minutes:=person_minutes+(segment_value->>'personMinutes')::numeric;
  END IF;
  prior_value:=endpoint_value;
 END LOOP;
 person_minutes:=GREATEST(person_minutes-travel_minutes,0);
 RETURN jsonb_build_object('alternativeKey',definition_value->>'alternativeKey','scopeKey',scope_review.scope_key,
  'role',definition_value->>'role','personMinutes',person_minutes,'travelPersonMinutes',travel_minutes,
  'dimensionDigest',public.canonical_completion_digest(jsonb_build_object('definition',definition_value,
   'start',start_value,'end',end_value,'jobs',job_evidence,'reviewTimeline',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',review_value.id,'revision',review_value.revision,
      'digest',rtrim(review_value.digest),'decidedAt',review_value.decided_at)
      ORDER BY review_value.decided_at,review_value.review_kind,review_value.subject_id,review_value.revision),'[]'::jsonb)
    FROM public.canonical_forecast_constrained_capacity_reviews_v1 review_value
    WHERE review_value.organization_id=org AND review_value.review_kind IN('scope','job')
     AND review_value.decided_at>=start_value AND review_value.decided_at<end_value
     AND (review_value.scope_key=scope_review.scope_key OR review_value.scope_key IS NULL)))));
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_work_census(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH subjects AS (
  SELECT DISTINCT event_value.subject_key assignment_id
  FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
  WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_assignments'
   AND event_value.observed_at<=cutoff_value
 ), accepted AS (
  SELECT assignment_payload,revision_payload,
   COALESCE(completion_lifecycle,assignment_payload->>'appointment_status') appointment_status,
   COALESCE(completion_decided_at,assignment_event.observed_at) status_observed_at,
   COALESCE((human_payload->>'approved_at')::timestamptz,(approval_payload->>'approved_at')::timestamptz) decision_at
  FROM subjects subject_value
  CROSS JOIN LATERAL (SELECT public.canonical_forecast_constrained_capacity_v1_source_payload_at(
    org,'canonical_schedule_assignments',subject_value.assignment_id,cutoff_value) assignment_payload) assignment_source
  CROSS JOIN LATERAL (SELECT event_value.observed_at
    FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_assignments'
     AND event_value.subject_key=subject_value.assignment_id AND event_value.observed_at<=cutoff_value
    ORDER BY event_value.observed_at DESC,event_value.source_order DESC LIMIT 1) assignment_event
  CROSS JOIN LATERAL (SELECT public.canonical_forecast_constrained_capacity_v1_source_payload_at(
    org,'canonical_schedule_assignment_revisions',subject_value.assignment_id,cutoff_value) revision_payload) revision_source
  LEFT JOIN LATERAL (
   SELECT latest.lifecycle_after completion_lifecycle,
    CASE WHEN latest.lifecycle_after IN('completed','cancelled') THEN COALESCE((
      SELECT min(root_value.decided_at) FROM public.canonical_completion_records root_value
       WHERE root_value.organization_id=org AND root_value.execution_id=latest.execution_id
        AND (root_value.id=COALESCE(latest.root_id,latest.id)
         OR root_value.root_id=COALESCE(latest.root_id,latest.id))
        AND root_value.decided_at<=cutoff_value),latest.decided_at) ELSE latest.decided_at END completion_decided_at
   FROM (SELECT record_value.* FROM public.canonical_field_executions execution_value
     JOIN public.canonical_completion_records record_value
      ON record_value.organization_id=execution_value.organization_id AND record_value.execution_id=execution_value.id
     JOIN public.canonical_forecast_constrained_capacity_source_events_v1 completion_event
      ON completion_event.organization_id=record_value.organization_id
       AND completion_event.source_kind='canonical_completion_records'
       AND completion_event.subject_key=record_value.execution_id::text
       AND completion_event.after_payload->>'id'=record_value.id::text
    WHERE execution_value.organization_id=org AND execution_value.assignment_id=subject_value.assignment_id::uuid
     AND record_value.decided_at<=cutoff_value
    ORDER BY record_value.decided_at DESC,completion_event.source_order DESC LIMIT 1) latest) completion_source ON TRUE
  LEFT JOIN LATERAL (SELECT event_value.after_payload human_payload
    FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_human_approvals'
     AND event_value.subject_key=subject_value.assignment_id AND event_value.observed_at<=cutoff_value
     AND event_value.after_payload->>'id'=revision_payload->>'human_approval_id'
    ORDER BY event_value.observed_at DESC,event_value.source_order DESC LIMIT 1) human_source ON TRUE
  LEFT JOIN LATERAL (SELECT event_value.after_payload approval_payload
    FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_approvals'
     AND event_value.subject_key=subject_value.assignment_id AND event_value.observed_at<=cutoff_value
     AND event_value.after_payload->>'id'=revision_payload->>'approval_id'
    ORDER BY event_value.observed_at DESC,event_value.source_order DESC LIMIT 1) approval_source ON TRUE
  WHERE assignment_payload IS NOT NULL AND revision_payload IS NOT NULL
 ), eligible AS (
  SELECT * FROM accepted WHERE decision_at IS NOT NULL AND decision_at<=cutoff_value
   AND revision_payload->>'target_state'='assigned'
   AND revision_payload->>'schedule_state' IN('scheduled','unscheduled')
   AND (appointment_status NOT IN('completed','cancelled') OR
    (revision_payload->>'schedule_state'='scheduled'
     AND (revision_payload->>'scheduled_start')::timestamptz<cutoff_value+INTERVAL '2592000 seconds'
     AND (revision_payload->>'scheduled_end')::timestamptz>cutoff_value))
  ORDER BY assignment_payload->>'appointment_id' LIMIT 501
 ) SELECT jsonb_build_object('count',count(*),'rows',COALESCE(jsonb_agg(jsonb_build_object(
   'appointmentId',assignment_payload->>'appointment_id','assignmentId',revision_payload->>'assignment_id',
   'assignmentRevision',(revision_payload->>'revision')::bigint,
   'assignmentDigest',rtrim(revision_payload->>'canonical_digest'),
   'scheduleState',revision_payload->>'schedule_state','decisionAt',decision_at,
   'appointmentStatus',appointment_status,'statusObservedAt',status_observed_at)
   ORDER BY assignment_payload->>'appointment_id'),'[]'::jsonb)) FROM eligible
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_work_census_period(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH subjects AS (
  SELECT DISTINCT event_value.subject_key assignment_id
  FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
  WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_assignments'
   AND event_value.observed_at<end_value
 ), accepted AS (
  SELECT assignment_payload,revision_payload,
   COALESCE(completion_lifecycle,assignment_payload->>'appointment_status') appointment_status,
   COALESCE(completion_decided_at,assignment_event.observed_at) status_observed_at,
   COALESCE((human_payload->>'approved_at')::timestamptz,(approval_payload->>'approved_at')::timestamptz) decision_at
  FROM subjects subject_value
  CROSS JOIN LATERAL (SELECT public.canonical_forecast_constrained_capacity_v1_source_payload_at(
    org,'canonical_schedule_assignments',subject_value.assignment_id,end_value) assignment_payload) assignment_source
  CROSS JOIN LATERAL (SELECT event_value.observed_at
    FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_assignments'
     AND event_value.subject_key=subject_value.assignment_id AND event_value.observed_at<end_value
    ORDER BY event_value.observed_at DESC,event_value.source_order DESC LIMIT 1) assignment_event
  CROSS JOIN LATERAL (SELECT public.canonical_forecast_constrained_capacity_v1_source_payload_at(
    org,'canonical_schedule_assignment_revisions',subject_value.assignment_id,end_value) revision_payload) revision_source
  LEFT JOIN LATERAL (
   SELECT latest.lifecycle_after completion_lifecycle,
    CASE WHEN latest.lifecycle_after IN('completed','cancelled') THEN COALESCE((
      SELECT min(root_value.decided_at) FROM public.canonical_completion_records root_value
       WHERE root_value.organization_id=org AND root_value.execution_id=latest.execution_id
        AND (root_value.id=COALESCE(latest.root_id,latest.id)
         OR root_value.root_id=COALESCE(latest.root_id,latest.id))
        AND root_value.decided_at<end_value),latest.decided_at) ELSE latest.decided_at END completion_decided_at
   FROM (SELECT record_value.* FROM public.canonical_field_executions execution_value
     JOIN public.canonical_completion_records record_value
      ON record_value.organization_id=execution_value.organization_id AND record_value.execution_id=execution_value.id
     JOIN public.canonical_forecast_constrained_capacity_source_events_v1 completion_event
      ON completion_event.organization_id=record_value.organization_id
       AND completion_event.source_kind='canonical_completion_records'
       AND completion_event.subject_key=record_value.execution_id::text
       AND completion_event.after_payload->>'id'=record_value.id::text
    WHERE execution_value.organization_id=org AND execution_value.assignment_id=subject_value.assignment_id::uuid
     AND record_value.decided_at<end_value
    ORDER BY record_value.decided_at DESC,completion_event.source_order DESC LIMIT 1) latest) completion_source ON TRUE
  LEFT JOIN LATERAL (SELECT event_value.after_payload human_payload
    FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_human_approvals'
     AND event_value.subject_key=subject_value.assignment_id AND event_value.observed_at<end_value
     AND event_value.after_payload->>'id'=revision_payload->>'human_approval_id'
    ORDER BY event_value.observed_at DESC,event_value.source_order DESC LIMIT 1) human_source ON TRUE
  LEFT JOIN LATERAL (SELECT event_value.after_payload approval_payload
    FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.source_kind='canonical_schedule_approvals'
     AND event_value.subject_key=subject_value.assignment_id AND event_value.observed_at<end_value
     AND event_value.after_payload->>'id'=revision_payload->>'approval_id'
    ORDER BY event_value.observed_at DESC,event_value.source_order DESC LIMIT 1) approval_source ON TRUE
  WHERE assignment_payload IS NOT NULL AND revision_payload IS NOT NULL
 ), eligible AS (
  SELECT * FROM accepted WHERE decision_at IS NOT NULL AND decision_at<end_value
   AND revision_payload->>'target_state'='assigned'
   AND revision_payload->>'schedule_state' IN('scheduled','unscheduled')
   AND (revision_payload->>'schedule_state'='unscheduled' OR
    ((revision_payload->>'scheduled_start')::timestamptz<end_value
     AND (revision_payload->>'scheduled_end')::timestamptz>start_value))
  ORDER BY assignment_payload->>'appointment_id' LIMIT 501
 ) SELECT jsonb_build_object('count',count(*),'rows',COALESCE(jsonb_agg(jsonb_build_object(
   'appointmentId',assignment_payload->>'appointment_id','assignmentId',revision_payload->>'assignment_id',
   'assignmentRevision',(revision_payload->>'revision')::bigint,
   'assignmentDigest',rtrim(revision_payload->>'canonical_digest'),
   'scheduleState',revision_payload->>'schedule_state','decisionAt',decision_at,
   'appointmentStatus',appointment_status,'statusObservedAt',status_observed_at)
   ORDER BY assignment_payload->>'appointment_id'),'[]'::jsonb)) FROM eligible
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_complete_input(
 org UUID,cutoff_value TIMESTAMPTZ,period_start_value TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE backlog_value JSONB;row_value JSONB;job_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;alternative_value TEXT;
 method_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 jobs_value JSONB:='[]'::jsonb;scopes_value JSONB:='[]'::jsonb;count_value INTEGER:=0;job_match_count INTEGER;
BEGIN
 method_review:=public.canonical_forecast_constrained_capacity_v1_review_at(org,'method',NULL,NULL,cutoff_value);
 IF method_review.id IS NULL THEN
  RAISE EXCEPTION 'Constrained-capacity method unavailable' USING ERRCODE='22023';END IF;
 backlog_value:=CASE WHEN period_start_value IS NULL THEN
  public.canonical_forecast_constrained_capacity_v1_work_census(org,cutoff_value)
 ELSE public.canonical_forecast_constrained_capacity_v1_work_census_period(org,period_start_value,cutoff_value) END;
 IF (backlog_value->>'count')::int>500 THEN RAISE EXCEPTION 'Approved work census exceeds bound' USING ERRCODE='54000';END IF;
 FOR scope_review IN SELECT value.* FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
   AND value.decided_at<=cutoff_value
   AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
     WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
      AND latest.decided_at<=cutoff_value
     ORDER BY latest.decided_at DESC,latest.revision DESC LIMIT 1) ORDER BY value.scope_key
  LOOP
  count_value:=count_value+1;
  scopes_value:=scopes_value||jsonb_build_array(jsonb_build_object('alternativeKey',scope_review.definition->>'alternativeKey',
   'scopeKey',scope_review.scope_key,
   'reviewId',scope_review.id,'revision',scope_review.revision,'digest',rtrim(scope_review.digest),
   'definitionDigest',public.canonical_completion_digest(scope_review.definition)));
 END LOOP;
 IF count_value NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Constrained-capacity scope population unavailable' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_reviews_v1 left_scope
   JOIN public.canonical_forecast_constrained_capacity_reviews_v1 right_scope
    ON right_scope.organization_id=left_scope.organization_id AND right_scope.review_kind='scope'
      AND right_scope.action='approve' AND right_scope.scope_key>left_scope.scope_key
      AND right_scope.definition->>'alternativeKey'=left_scope.definition->>'alternativeKey'
      AND right_scope.decided_at<=cutoff_value
      AND right_scope.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
        WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=right_scope.scope_key
         AND latest.decided_at<=cutoff_value
       ORDER BY latest.decided_at DESC,latest.revision DESC LIMIT 1)
    WHERE left_scope.organization_id=org AND left_scope.review_kind='scope' AND left_scope.action='approve'
     AND left_scope.decided_at<=cutoff_value
     AND left_scope.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
       WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=left_scope.scope_key
        AND latest.decided_at<=cutoff_value
       ORDER BY latest.decided_at DESC,latest.revision DESC LIMIT 1)
    AND (EXISTS(SELECT 1 FROM jsonb_array_elements_text(left_scope.definition->'operatorProfileIds') left_id
      JOIN jsonb_array_elements_text(right_scope.definition->'operatorProfileIds') right_id ON right_id=left_id)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(left_scope.definition->'vehicleAssetIds') left_id
      JOIN jsonb_array_elements_text(right_scope.definition->'vehicleAssetIds') right_id ON right_id=left_id)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(left_scope.definition->'equipmentAssetIds') left_id
       JOIN jsonb_array_elements_text(right_scope.definition->'equipmentAssetIds') right_id ON right_id=left_id)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(left_scope.definition->'crewIds') left_id
       JOIN jsonb_array_elements_text(right_scope.definition->'crewIds') right_id ON right_id=left_id)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(left_scope.source_identity->'crewMembers') left_member
       JOIN jsonb_array_elements(right_scope.source_identity->'crewMembers') right_member
        ON right_member->>1=left_member->>1))) THEN
 RAISE EXCEPTION 'Constrained-capacity scopes share people or assets' USING ERRCODE='22023';END IF;
 FOR row_value IN SELECT entry FROM jsonb_array_elements(backlog_value->'rows') AS entries(entry) LOOP
 FOR alternative_value IN SELECT DISTINCT value->>'alternativeKey' FROM jsonb_array_elements(scopes_value) value ORDER BY 1 LOOP
  SELECT count(*) INTO job_match_count FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='job'
     AND value.subject_id=(row_value->>'appointmentId')::uuid AND value.action='approve'
     AND value.decided_at<=cutoff_value
     AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
       WHERE latest.organization_id=org AND latest.review_kind='job'
        AND latest.scope_key=value.scope_key AND latest.subject_id=value.subject_id
        AND latest.decided_at<=cutoff_value
       ORDER BY latest.decided_at DESC,latest.revision DESC LIMIT 1)
    AND value.scope_key IN(SELECT scope_item->>'scopeKey' FROM jsonb_array_elements(scopes_value) scope_item
      WHERE scope_item->>'alternativeKey'=alternative_value);
  IF job_match_count<>1 THEN
   RAISE EXCEPTION 'Complete approved work constraint census unavailable' USING ERRCODE='22023';END IF;
  SELECT value.* INTO job_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='job' AND value.subject_id=(row_value->>'appointmentId')::uuid
     AND value.action='approve'
     AND value.decided_at<=cutoff_value
     AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
       WHERE latest.organization_id=org AND latest.review_kind='job'
        AND latest.scope_key=value.scope_key AND latest.subject_id=value.subject_id
        AND latest.decided_at<=cutoff_value
       ORDER BY latest.decided_at DESC,latest.revision DESC LIMIT 1)
    AND value.scope_key IN(SELECT scope_item->>'scopeKey' FROM jsonb_array_elements(scopes_value) scope_item
      WHERE scope_item->>'alternativeKey'=alternative_value)
   ORDER BY value.scope_key LIMIT 1;
   IF job_review.id IS NULL
    OR public.canonical_forecast_constrained_capacity_v1_job_review_covers(org,job_review,cutoff_value) IS NOT TRUE
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scopes_value) scope_item
      WHERE scope_item->>'scopeKey'=job_review.scope_key) THEN
   RAISE EXCEPTION 'Complete approved work constraint census unavailable' USING ERRCODE='22023';END IF;
  IF job_review.definition->>'assignmentId' IS DISTINCT FROM row_value->>'assignmentId' THEN
   RAISE EXCEPTION 'Approved work constraint identity differs' USING ERRCODE='22023';END IF;
   SELECT value.* INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='scope' AND value.scope_key=job_review.scope_key
     AND value.decided_at<=cutoff_value
    ORDER BY value.decided_at DESC,value.revision DESC LIMIT 1;
  IF job_review.definition->>'alternativeKey' IS DISTINCT FROM alternative_value
   OR job_review.definition->'crewApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,crew}'
   OR job_review.definition->'skillApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,skill}'
   OR job_review.definition->'workingHoursApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,workingHours}'
   OR job_review.definition->'locationApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,location}'
   OR job_review.definition->'travelApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,travel}'
   OR job_review.definition->'vehicleApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,vehicle}'
   OR job_review.definition->'equipmentApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,equipment}'
   OR job_review.definition->'vehicleAssetIds' IS DISTINCT FROM scope_review.definition->'vehicleAssetIds'
   OR job_review.definition->'equipmentAssetIds' IS DISTINCT FROM scope_review.definition->'equipmentAssetIds' THEN
   RAISE EXCEPTION 'Approved work constraints differ from scope' USING ERRCODE='22023';END IF;
  jobs_value:=jobs_value||jsonb_build_array(jsonb_build_object('alternativeKey',alternative_value,
   'appointmentId',row_value->>'appointmentId',
   'assignmentId',row_value->>'assignmentId','scopeKey',job_review.scope_key,'reviewId',job_review.id,
   'routeKey',job_review.source_identity->>'routeKey',
   'routeHomeLocation',job_review.source_identity->>'routeHomeLocation',
   'assignedRole',job_review.source_identity->>'assignedRole',
   'workforceProfileId',job_review.source_identity->'workforceProfileId',
   'workforceCrewId',job_review.source_identity->'workforceCrewId',
   'revision',job_review.revision,'digest',rtrim(job_review.digest),'scheduleState',row_value->>'scheduleState',
   'appointmentStatus',row_value->>'appointmentStatus','statusObservedAt',row_value->'statusObservedAt',
   'assignmentRevision',row_value->'assignmentRevision','assignmentDigest',row_value->'assignmentDigest'));
 END LOOP;
 END LOOP;
 IF octet_length(scopes_value::text)+octet_length(jobs_value::text)>524288 THEN
  RAISE EXCEPTION 'Constrained-capacity input exceeds bound' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('method',jsonb_build_object('reviewId',method_review.id,'revision',method_review.revision,
  'digest',rtrim(method_review.digest)),'scopes',scopes_value,'jobs',jobs_value,
  'sourceGeneration',jsonb_build_object(
   'constrainedSourceOrder',COALESCE((SELECT max(value.source_order)
      FROM public.canonical_forecast_constrained_capacity_source_events_v1 value
      WHERE value.organization_id=org),0),
   'roleSourceOrder',COALESCE((SELECT max(value.source_order)
      FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
      WHERE value.organization_id=org),0),
   'profileSourceOrder',COALESCE((SELECT max(value.source_order)
      FROM public.canonical_forecast_workload_capacity_profile_events_v1 value
      WHERE value.organization_id=org),0),
   'availabilitySourceOrder',COALESCE((SELECT max(value.source_order)
      FROM public.canonical_forecast_workload_capacity_availability_events_v1 value
      WHERE value.organization_id=org),0),
   'crewSourceOrder',COALESCE((SELECT max(value.source_order)
      FROM public.canonical_forecast_workload_capacity_crew_events_v1 value
      WHERE value.organization_id=org),0),
   'scheduleApprovalWindowCount',(SELECT count(*) FROM public.canonical_schedule_approvals value
      WHERE value.organization_id=org AND value.approved_at>=cutoff_value
       AND value.approved_at<cutoff_value+INTERVAL '2592000 seconds'),
   'humanApprovalWindowCount',(SELECT count(*) FROM public.canonical_schedule_human_approvals value
      WHERE value.organization_id=org AND value.approved_at>=cutoff_value
       AND value.approved_at<cutoff_value+INTERVAL '2592000 seconds')),
  'alternatives',(SELECT COALESCE(jsonb_agg(DISTINCT value->>'alternativeKey' ORDER BY value->>'alternativeKey'),'[]'::jsonb)
    FROM jsonb_array_elements(scopes_value) value),
  'jobIds',(SELECT COALESCE(jsonb_agg((value->>'alternativeKey')||':'||(value->>'appointmentId')
    ORDER BY value->>'alternativeKey',value->>'appointmentId'),'[]'::jsonb)
    FROM jsonb_array_elements(jobs_value) value),'approvedWorkCount',jsonb_array_length(jobs_value));
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_results(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,as_of_value TIMESTAMPTZ,input_value JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_item JSONB;scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 result_value JSONB;results_value JSONB:='[]'::jsonb;effective_input JSONB:=input_value;current_input JSONB;
BEGIN
 IF as_of_value>start_value THEN
  current_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,as_of_value,start_value);
  IF (SELECT jsonb_agg((entry->>'alternativeKey')||':'||(entry->>'scopeKey') ORDER BY entry->>'alternativeKey',entry->>'scopeKey')
       FROM jsonb_array_elements(current_input->'scopes') entries(entry)) IS DISTINCT FROM
     (SELECT jsonb_agg((entry->>'alternativeKey')||':'||(entry->>'scopeKey') ORDER BY entry->>'alternativeKey',entry->>'scopeKey')
       FROM jsonb_array_elements(input_value->'scopes') entries(entry)) THEN
   RAISE EXCEPTION 'Constrained-capacity scope population changed' USING ERRCODE='22023';END IF;
  effective_input:=jsonb_set(input_value,'{jobs}',current_input->'jobs',FALSE);
 END IF;
 FOR scope_item IN SELECT entry FROM jsonb_array_elements(input_value->'scopes') AS entries(entry)
  ORDER BY entry->>'alternativeKey',entry->>'scopeKey' LOOP
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(scope_item->>'reviewId')::uuid;
  IF scope_review.id IS NULL OR scope_review.scope_key IS DISTINCT FROM scope_item->>'scopeKey'
   OR scope_review.definition->>'alternativeKey' IS DISTINCT FROM scope_item->>'alternativeKey'
   OR rtrim(scope_review.digest) IS DISTINCT FROM scope_item->>'digest' THEN
   RAISE EXCEPTION 'Constrained-capacity scope receipt unavailable' USING ERRCODE='22023';END IF;
  result_value:=public.canonical_forecast_constrained_capacity_v1_scope_calculation(
   org,scope_review,start_value,end_value,as_of_value,effective_input->'jobs');
  results_value:=results_value||jsonb_build_array(result_value);
 END LOOP;
 RETURN results_value;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_origin_current(
 org UUID,value public.canonical_forecast_constrained_capacity_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 DECLARE epoch_value public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
  item JSONB;review_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
  covering_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
BEGIN
 SELECT * INTO epoch_value FROM public.canonical_forecast_constrained_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF epoch_value.id IS DISTINCT FROM value.epoch_id THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements((value.input_manifest->'scopes')||(value.input_manifest->'jobs')) AS entries(entry) LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'reviewId')::uuid;
  IF review_value.id IS NULL OR rtrim(review_value.digest) IS DISTINCT FROM item->>'digest'
   OR review_value.action<>'approve'
   OR EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
      WHERE newer.organization_id=org AND newer.review_kind=review_value.review_kind
       AND newer.scope_key IS NOT DISTINCT FROM review_value.scope_key
       AND newer.subject_id IS NOT DISTINCT FROM review_value.subject_id
       AND newer.revision>review_value.revision AND newer.decided_at<=value.prediction_cutoff_at) THEN RETURN FALSE;END IF;
  IF review_value.review_kind='job' THEN
    SELECT newer.* INTO covering_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
     WHERE newer.organization_id=org AND newer.review_kind='job'
      AND newer.scope_key IS NOT DISTINCT FROM review_value.scope_key
      AND newer.subject_id IS NOT DISTINCT FROM review_value.subject_id
      AND newer.action='approve' AND newer.decided_at<value.horizon_ends_at
     ORDER BY newer.decided_at DESC,newer.revision DESC LIMIT 1;
    IF covering_review.id IS NULL OR
      public.canonical_forecast_constrained_capacity_v1_job_review_covers(
       org,covering_review,value.horizon_ends_at) IS NOT TRUE THEN RETURN FALSE;END IF;
   END IF;
 END LOOP;
 SELECT * INTO review_value FROM public.canonical_forecast_constrained_capacity_reviews_v1
  WHERE organization_id=org AND id=(value.input_manifest#>>'{method,reviewId}')::uuid;
 IF review_value.id IS NULL OR review_value.action<>'approve'
  OR rtrim(review_value.digest) IS DISTINCT FROM value.input_manifest#>>'{method,digest}'
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
     WHERE newer.organization_id=org AND newer.review_kind='method'
      AND newer.revision>review_value.revision AND newer.decided_at<value.horizon_ends_at) THEN RETURN FALSE;END IF;
 RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_origin_projection(
 value public.canonical_forecast_constrained_capacity_origins_v1,state_value TEXT,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',state_value,'id',value.id,'predictionCutoffAt',value.prediction_cutoff_at,
  'horizonEndsAt',value.horizon_ends_at,'scopeCount',value.scope_count,
  'refreshRequired',state_value='constrained_capacity_origin_stale','allSevenDimensionsApplied',TRUE,
  'resultsWithheld',TRUE,'outputDigestsWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',replayed_value)
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_origin_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_value public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 old public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 inserted public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 cutoff_value TIMESTAMPTZ;end_value TIMESTAMPTZ;input_value JSONB;results_value JSONB;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR confirmation_value IS DISTINCT FROM 'm26-constrained-capacity-origin-v1'
  OR reason_value IS NULL OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Constrained-capacity origin request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO epoch_value FROM public.canonical_forecast_constrained_capacity_epochs_v1 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF epoch_value.id IS NULL THEN RAISE EXCEPTION 'Constrained-capacity epoch unavailable' USING ERRCODE='22023';END IF;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('reason',btrim(reason_value),'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_constrained_capacity_origins_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash OR public.canonical_forecast_constrained_capacity_v1_origin_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Constrained-capacity origin replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_constrained_capacity_v1_origin_projection(old,'constrained_capacity_origin_saved',TRUE);END IF;
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();end_value:=cutoff_value+INTERVAL '2592000 seconds';
 input_value:=public.canonical_forecast_constrained_capacity_v1_complete_input(org,cutoff_value);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements((input_value->'scopes')||(input_value->'jobs')) item
   JOIN public.canonical_forecast_constrained_capacity_reviews_v1 review_value
    ON review_value.organization_id=org AND review_value.id=(item->>'reviewId')::uuid
   WHERE review_value.decided_at<epoch_value.installed_at) OR
   (SELECT decided_at FROM public.canonical_forecast_constrained_capacity_reviews_v1 WHERE organization_id=org
    AND id=(input_value#>>'{method,reviewId}')::uuid)<epoch_value.installed_at THEN
  RAISE EXCEPTION 'Current human reviews must follow coverage epoch' USING ERRCODE='22023';END IF;
 results_value:=public.canonical_forecast_constrained_capacity_v1_results(org,cutoff_value,end_value,cutoff_value,input_value);
 INSERT INTO public.canonical_forecast_constrained_capacity_origins_v1(
  organization_id,epoch_id,prediction_cutoff_at,horizon_ends_at,input_manifest,private_results,scope_count,
  actor_id,membership_id,session_id,idempotency_key_hash,request_digest,captured_at,digest)
 VALUES(org,epoch_value.id,cutoff_value,end_value,input_value,results_value,jsonb_array_length(input_value->'scopes'),
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,cutoff_value,
  public.canonical_completion_digest(jsonb_build_object('epoch',epoch_value.id,'cutoff',cutoff_value,
   'end',end_value,'input',input_value,'results',results_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_constrained_capacity_v1_origin_projection(inserted,'constrained_capacity_origin_saved',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_origin_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_constrained_capacity_origins_v1
  WHERE organization_id=org AND id=origin_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Constrained-capacity receipt unavailable' USING ERRCODE='P0002';END IF;
 current_value:=public.canonical_forecast_constrained_capacity_v1_origin_current(org,value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_constrained_capacity_v1_origin_projection(value,
  CASE WHEN current_value THEN 'constrained_capacity_origin_current' ELSE 'constrained_capacity_origin_stale' END,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_outcome_current(
 org UUID,value public.canonical_forecast_constrained_capacity_outcomes_v1)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE origin_value public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 current_epoch public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
BEGIN
 SELECT * INTO origin_value FROM public.canonical_forecast_constrained_capacity_origins_v1
  WHERE organization_id=org AND id=value.origin_id;
 SELECT * INTO current_epoch FROM public.canonical_forecast_constrained_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF origin_value.id IS NULL OR current_epoch.id IS DISTINCT FROM origin_value.epoch_id
  OR public.canonical_forecast_constrained_capacity_v1_origin_current(org,origin_value) IS NOT TRUE THEN RETURN FALSE;END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.observed_at>value.captured_at
     AND event_value.source_kind='canonical_schedule_assignment_revisions'
     AND COALESCE((event_value.after_payload->>'scheduled_start')::timestamptz,
       (event_value.before_payload->>'scheduled_start')::timestamptz)<origin_value.horizon_ends_at
     AND COALESCE((event_value.after_payload->>'scheduled_end')::timestamptz,
       (event_value.before_payload->>'scheduled_end')::timestamptz)>origin_value.prediction_cutoff_at)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org AND event_value.observed_at>value.captured_at
     AND event_value.source_kind='canonical_workforce_availability_revisions'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(event_value.after_payload->'intervals','[]'::jsonb)) interval_value
       WHERE (interval_value->>'start')::timestamptz<origin_value.horizon_ends_at
        AND (interval_value->>'end')::timestamptz>origin_value.prediction_cutoff_at))
  OR EXISTS(SELECT 1
    FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    JOIN public.canonical_field_executions execution_value
      ON execution_value.organization_id=org AND execution_value.id::text=event_value.subject_key
    WHERE event_value.organization_id=org AND event_value.observed_at>value.captured_at
     AND event_value.source_kind='canonical_completion_records'
     AND event_value.after_payload->>'record_kind'='correction'
     AND value.source_manifest->'assignmentIds' ? execution_value.assignment_id::text)
  THEN RETURN FALSE;END IF;
 RETURN value.source_manifest#>>'{origin,digest}'=rtrim(origin_value.digest)
  AND value.source_manifest->>'resultDigest'=public.canonical_completion_digest(value.private_results)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_outcomes_v1 newer
   WHERE newer.organization_id=org AND newer.origin_id=value.origin_id AND newer.revision>value.revision);
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_outcome_projection(
 value public.canonical_forecast_constrained_capacity_outcomes_v1,state_value TEXT,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',state_value,'id',value.id,'originId',value.origin_id,
  'revision',value.revision,'capturedAt',value.captured_at,
  'refreshRequired',state_value='constrained_capacity_outcome_stale','allSevenDimensionsApplied',TRUE,
  'resultsWithheld',TRUE,'outputDigestsWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',replayed_value)
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_outcome_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;origin_value public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 old public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
 current_value public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
 inserted public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
 now_value TIMESTAMPTZ;results_value JSONB;manifest_value JSONB;period_input JSONB;
 key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Constrained-capacity outcome request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO origin_value FROM public.canonical_forecast_constrained_capacity_origins_v1
  WHERE organization_id=org AND id=origin_id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Constrained-capacity receipt unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_constrained_capacity_v1_origin_current(org,origin_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Saved constrained-capacity origin stale' USING ERRCODE='40001';END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 IF now_value<origin_value.horizon_ends_at THEN RAISE EXCEPTION 'Constrained-capacity horizon incomplete' USING ERRCODE='22023';END IF;
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','outcome','originId',origin_id_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_constrained_capacity_outcomes_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash OR public.canonical_forecast_constrained_capacity_v1_outcome_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Constrained-capacity outcome replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_constrained_capacity_v1_outcome_projection(old,'constrained_capacity_outcome_saved',TRUE);END IF;
 period_input:=public.canonical_forecast_constrained_capacity_v1_complete_input(
  org,origin_value.horizon_ends_at,origin_value.prediction_cutoff_at);
 results_value:=public.canonical_forecast_constrained_capacity_v1_results(org,origin_value.prediction_cutoff_at,
  origin_value.horizon_ends_at,origin_value.horizon_ends_at,origin_value.input_manifest);
manifest_value:=jsonb_build_object('origin',jsonb_build_object('id',origin_value.id,'digest',rtrim(origin_value.digest)),
  'window',jsonb_build_object('start',origin_value.prediction_cutoff_at,'end',origin_value.horizon_ends_at),
  'periodInputDigest',public.canonical_completion_digest(period_input),
  'assignmentIds',(SELECT COALESCE(jsonb_agg(DISTINCT job_value->>'assignmentId'
    ORDER BY job_value->>'assignmentId'),'[]'::jsonb) FROM jsonb_array_elements(period_input->'jobs') job_value),
  'resultDigest',public.canonical_completion_digest(results_value));
 SELECT * INTO current_value FROM public.canonical_forecast_constrained_capacity_outcomes_v1
  WHERE organization_id=org AND origin_id=origin_id_value ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.canonical_forecast_constrained_capacity_outcomes_v1(
  organization_id,origin_id,revision,previous_id,source_manifest,private_results,captured_at,
  actor_id,membership_id,session_id,idempotency_key_hash,request_digest,digest)
 VALUES(org,origin_id_value,COALESCE(current_value.revision,0)+1,current_value.id,manifest_value,results_value,now_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,
  public.canonical_completion_digest(jsonb_build_object('originId',origin_id_value,'revision',COALESCE(current_value.revision,0)+1,
   'source',manifest_value,'results',results_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_constrained_capacity_v1_outcome_projection(inserted,'constrained_capacity_outcome_saved',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_outcome_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_id_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_constrained_capacity_outcomes_v1
  WHERE organization_id=org AND origin_id=origin_id_value AND id=id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Constrained-capacity receipt unavailable' USING ERRCODE='P0002';END IF;
 current_value:=public.canonical_forecast_constrained_capacity_v1_outcome_current(org,value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_constrained_capacity_v1_outcome_projection(value,
  CASE WHEN current_value THEN 'constrained_capacity_outcome_current' ELSE 'constrained_capacity_outcome_stale' END,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_evaluation_current(
 org UUID,value public.canonical_forecast_constrained_capacity_evaluations_v1)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE origin_value public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 outcome_value public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
BEGIN
 SELECT * INTO origin_value FROM public.canonical_forecast_constrained_capacity_origins_v1
  WHERE organization_id=org AND id=value.origin_id;
 SELECT * INTO outcome_value FROM public.canonical_forecast_constrained_capacity_outcomes_v1
  WHERE organization_id=org AND id=value.outcome_id AND origin_id=value.origin_id;
 RETURN origin_value.id IS NOT NULL AND outcome_value.id IS NOT NULL
  AND public.canonical_forecast_constrained_capacity_v1_origin_current(org,origin_value)
  AND public.canonical_forecast_constrained_capacity_v1_outcome_current(org,outcome_value)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_evaluations_v1 newer
   WHERE newer.organization_id=org AND newer.origin_id=value.origin_id AND newer.revision>value.revision);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_evaluation_projection(
 value public.canonical_forecast_constrained_capacity_evaluations_v1,state_value TEXT,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',state_value,'id',value.id,'originId',value.origin_id,'outcomeId',value.outcome_id,
  'revision',value.revision,'capturedAt',value.captured_at,
  'refreshRequired',state_value='constrained_capacity_evaluation_stale','allSevenDimensionsApplied',TRUE,
  'metricsWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',replayed_value)
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_evaluation_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_id_value UUID,outcome_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;origin_value public.canonical_forecast_constrained_capacity_origins_v1%ROWTYPE;
 outcome_value public.canonical_forecast_constrained_capacity_outcomes_v1%ROWTYPE;
 old public.canonical_forecast_constrained_capacity_evaluations_v1%ROWTYPE;
 current_value public.canonical_forecast_constrained_capacity_evaluations_v1%ROWTYPE;
 inserted public.canonical_forecast_constrained_capacity_evaluations_v1%ROWTYPE;
 metrics_value JSONB;key_hash TEXT:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash TEXT;now_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Constrained-capacity evaluation request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO origin_value FROM public.canonical_forecast_constrained_capacity_origins_v1 WHERE organization_id=org AND id=origin_id_value;
 SELECT * INTO outcome_value FROM public.canonical_forecast_constrained_capacity_outcomes_v1
  WHERE organization_id=org AND id=outcome_id_value AND origin_id=origin_id_value;
 IF origin_value.id IS NULL OR outcome_value.id IS NULL THEN RAISE EXCEPTION 'Constrained-capacity evidence unavailable' USING ERRCODE='P0002';END IF;
 IF public.canonical_forecast_constrained_capacity_v1_origin_current(org,origin_value) IS NOT TRUE
  OR public.canonical_forecast_constrained_capacity_v1_outcome_current(org,outcome_value) IS NOT TRUE THEN
  RAISE EXCEPTION 'Constrained-capacity evidence stale' USING ERRCODE='40001';END IF;
 metrics_value:=(SELECT jsonb_agg(jsonb_build_object('alternativeKey',forecast_value->>'alternativeKey',
   'scopeKey',forecast_value->>'scopeKey',
   'forecastPersonMinutes',forecast_value->'personMinutes','actualPersonMinutes',actual_value->'personMinutes')
   ORDER BY forecast_value->>'alternativeKey',forecast_value->>'scopeKey') FROM jsonb_array_elements(origin_value.private_results) forecast_value
   JOIN jsonb_array_elements(outcome_value.private_results) actual_value
    ON actual_value->>'alternativeKey'=forecast_value->>'alternativeKey'
    AND actual_value->>'scopeKey'=forecast_value->>'scopeKey');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','evaluation','originId',origin_id_value,'outcomeId',outcome_id_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_constrained_capacity_evaluations_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash OR public.canonical_forecast_constrained_capacity_v1_evaluation_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Constrained-capacity evaluation replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_constrained_capacity_v1_evaluation_projection(old,'constrained_capacity_evaluation_saved',TRUE);END IF;
 SELECT * INTO current_value FROM public.canonical_forecast_constrained_capacity_evaluations_v1
  WHERE organization_id=org AND origin_id=origin_id_value ORDER BY revision DESC LIMIT 1;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 INSERT INTO public.canonical_forecast_constrained_capacity_evaluations_v1(
  organization_id,origin_id,outcome_id,revision,previous_id,private_metrics,captured_at,
  actor_id,membership_id,session_id,idempotency_key_hash,request_digest,digest)
 VALUES(org,origin_id_value,outcome_id_value,COALESCE(current_value.revision,0)+1,current_value.id,metrics_value,now_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,
  public.canonical_completion_digest(jsonb_build_object('originId',origin_id_value,'outcomeId',outcome_id_value,
   'revision',COALESCE(current_value.revision,0)+1,'metrics',metrics_value))) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_constrained_capacity_v1_evaluation_projection(inserted,'constrained_capacity_evaluation_saved',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_evaluation_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_id_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_constrained_capacity_evaluations_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_constrained_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_constrained_capacity_evaluations_v1
  WHERE organization_id=org AND origin_id=origin_id_value AND id=id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Constrained-capacity receipt unavailable' USING ERRCODE='P0002';END IF;
 current_value:=public.canonical_forecast_constrained_capacity_v1_evaluation_current(org,value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_constrained_capacity_v1_evaluation_projection(value,
  CASE WHEN current_value THEN 'constrained_capacity_evaluation_current' ELSE 'constrained_capacity_evaluation_stale' END,FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_constrained_capacity_source_fences_v1,
 public.canonical_forecast_constrained_capacity_source_events_v1,
 public.canonical_forecast_constrained_capacity_methods_v1,public.canonical_forecast_constrained_capacity_epochs_v1,
 public.canonical_forecast_constrained_capacity_reviews_v1,public.canonical_forecast_constrained_capacity_origins_v1,
 public.canonical_forecast_constrained_capacity_outcomes_v1,public.canonical_forecast_constrained_capacity_evaluations_v1 FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.canonical_forecast_constrained_capacity_source_order_v1 FROM PUBLIC;

REVOKE ALL ON FUNCTION public.canonical_forecast_constrained_capacity_v1_source_capture(),
 public.canonical_forecast_constrained_capacity_v1_immutable(),
 public.canonical_forecast_constrained_capacity_v1_lock_sources(uuid),
 public.canonical_forecast_constrained_capacity_v1_source_baseline(uuid,timestamptz),
 public.canonical_forecast_constrained_capacity_v1_source_payload_at(uuid,text,text,timestamptz),
 public.canonical_forecast_constrained_capacity_v1_source_subject(text,jsonb),
 public.canonical_forecast_constrained_capacity_v1_uuid_array(jsonb,integer),
 public.canonical_forecast_constrained_capacity_v1_intervals(jsonb),
 public.canonical_forecast_constrained_capacity_v1_definition_valid(text,jsonb),
	 public.canonical_forecast_constrained_capacity_v1_source_identity(uuid,text,text,uuid,jsonb),
	 public.canonical_forecast_constrained_capacity_v1_review_current_internal(uuid,text,text,uuid),public.canonical_forecast_constrained_capacity_v1_review_at(uuid,text,text,uuid,timestamptz),
	 public.canonical_forecast_constrained_capacity_v1_m24_bases_current(uuid,public.canonical_forecast_constrained_capacity_reviews_v1),
	 public.canonical_forecast_constrained_capacity_v1_job_review_covers(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz),
 public.canonical_forecast_constrained_capacity_v1_review_is_current(uuid,public.canonical_forecast_constrained_capacity_reviews_v1),
 public.canonical_forecast_constrained_capacity_v1_review_projection(public.canonical_forecast_constrained_capacity_reviews_v1,boolean),
 public.canonical_forecast_constrained_capacity_v1_interval_minutes(jsonb,timestamptz,timestamptz),
 public.canonical_forecast_constrained_capacity_v1_scope_calculation(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz,timestamptz,timestamptz,jsonb),
 public.canonical_forecast_constrained_capacity_v1_working_windows(jsonb,timestamptz,timestamptz,text),
	 public.canonical_forecast_constrained_capacity_v1_subject_present(uuid,text,text,timestamptz),
	 public.canonical_forecast_constrained_capacity_v1_exact_pack(jsonb),
	 public.canonical_forecast_constrained_capacity_v1_exact_match(jsonb,jsonb,jsonb,text),
	 public.canonical_forecast_constrained_capacity_v1_scope_segment(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz,timestamptz,jsonb,text),
	 public.canonical_forecast_constrained_capacity_v1_work_census(uuid,timestamptz),
	 public.canonical_forecast_constrained_capacity_v1_work_census_period(uuid,timestamptz,timestamptz),
	 public.canonical_forecast_constrained_capacity_v1_complete_input(uuid,timestamptz,timestamptz),
 public.canonical_forecast_constrained_capacity_v1_results(uuid,timestamptz,timestamptz,timestamptz,jsonb),
 public.canonical_forecast_constrained_capacity_v1_origin_current(uuid,public.canonical_forecast_constrained_capacity_origins_v1),
 public.canonical_forecast_constrained_capacity_v1_origin_projection(public.canonical_forecast_constrained_capacity_origins_v1,text,boolean),
 public.canonical_forecast_constrained_capacity_v1_outcome_current(uuid,public.canonical_forecast_constrained_capacity_outcomes_v1),
 public.canonical_forecast_constrained_capacity_v1_outcome_projection(public.canonical_forecast_constrained_capacity_outcomes_v1,text,boolean),
 public.canonical_forecast_constrained_capacity_v1_evaluation_current(uuid,public.canonical_forecast_constrained_capacity_evaluations_v1),
 public.canonical_forecast_constrained_capacity_v1_evaluation_projection(public.canonical_forecast_constrained_capacity_evaluations_v1,text,boolean)
 FROM PUBLIC;

REVOKE ALL ON FUNCTION public.canonical_forecast_constrained_capacity_v1_prerequisites(uuid,uuid,text,uuid),
 public.canonical_forecast_constrained_capacity_v1_review_current(uuid,uuid,text,uuid,text,text,uuid),
 public.canonical_forecast_constrained_capacity_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,uuid,text,bigint,text,jsonb,text,text),
 public.canonical_forecast_constrained_capacity_v1_epoch_capture(uuid,uuid,text,uuid,text,text,text,text),
 public.canonical_forecast_constrained_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text),
 public.canonical_forecast_constrained_capacity_v1_origin_read(uuid,uuid,text,uuid,uuid),
 public.canonical_forecast_constrained_capacity_v1_outcome_capture(uuid,uuid,text,uuid,text,text,uuid),
 public.canonical_forecast_constrained_capacity_v1_outcome_read(uuid,uuid,text,uuid,uuid,uuid),
 public.canonical_forecast_constrained_capacity_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid,uuid),
 public.canonical_forecast_constrained_capacity_v1_evaluation_read(uuid,uuid,text,uuid,uuid,uuid)
 FROM PUBLIC;

DO $$DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_constrained_capacity_source_fences_v1,public.canonical_forecast_constrained_capacity_source_events_v1,public.canonical_forecast_constrained_capacity_methods_v1,public.canonical_forecast_constrained_capacity_epochs_v1,public.canonical_forecast_constrained_capacity_reviews_v1,public.canonical_forecast_constrained_capacity_origins_v1,public.canonical_forecast_constrained_capacity_outcomes_v1,public.canonical_forecast_constrained_capacity_evaluations_v1 FROM %I',runtime_role);
   EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.canonical_forecast_constrained_capacity_source_order_v1 FROM %I',runtime_role);
	   EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_constrained_capacity_v1_source_capture(),public.canonical_forecast_constrained_capacity_v1_immutable(),public.canonical_forecast_constrained_capacity_v1_lock_sources(uuid),public.canonical_forecast_constrained_capacity_v1_source_baseline(uuid,timestamptz),public.canonical_forecast_constrained_capacity_v1_source_payload_at(uuid,text,text,timestamptz),public.canonical_forecast_constrained_capacity_v1_source_subject(text,jsonb),public.canonical_forecast_constrained_capacity_v1_uuid_array(jsonb,integer),public.canonical_forecast_constrained_capacity_v1_intervals(jsonb),public.canonical_forecast_constrained_capacity_v1_definition_valid(text,jsonb),public.canonical_forecast_constrained_capacity_v1_source_identity(uuid,text,text,uuid,jsonb),public.canonical_forecast_constrained_capacity_v1_review_current_internal(uuid,text,text,uuid),public.canonical_forecast_constrained_capacity_v1_review_at(uuid,text,text,uuid,timestamptz),public.canonical_forecast_constrained_capacity_v1_m24_bases_current(uuid,public.canonical_forecast_constrained_capacity_reviews_v1),public.canonical_forecast_constrained_capacity_v1_job_review_covers(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz),public.canonical_forecast_constrained_capacity_v1_review_is_current(uuid,public.canonical_forecast_constrained_capacity_reviews_v1),public.canonical_forecast_constrained_capacity_v1_review_projection(public.canonical_forecast_constrained_capacity_reviews_v1,boolean),public.canonical_forecast_constrained_capacity_v1_interval_minutes(jsonb,timestamptz,timestamptz),public.canonical_forecast_constrained_capacity_v1_scope_calculation(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz,timestamptz,timestamptz,jsonb),public.canonical_forecast_constrained_capacity_v1_working_windows(jsonb,timestamptz,timestamptz,text),public.canonical_forecast_constrained_capacity_v1_subject_present(uuid,text,text,timestamptz),public.canonical_forecast_constrained_capacity_v1_exact_pack(jsonb),public.canonical_forecast_constrained_capacity_v1_exact_match(jsonb,jsonb,jsonb,text),public.canonical_forecast_constrained_capacity_v1_scope_segment(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz,timestamptz,jsonb,text),public.canonical_forecast_constrained_capacity_v1_work_census(uuid,timestamptz),public.canonical_forecast_constrained_capacity_v1_work_census_period(uuid,timestamptz,timestamptz),public.canonical_forecast_constrained_capacity_v1_complete_input(uuid,timestamptz,timestamptz),public.canonical_forecast_constrained_capacity_v1_results(uuid,timestamptz,timestamptz,timestamptz,jsonb),public.canonical_forecast_constrained_capacity_v1_origin_current(uuid,public.canonical_forecast_constrained_capacity_origins_v1),public.canonical_forecast_constrained_capacity_v1_origin_projection(public.canonical_forecast_constrained_capacity_origins_v1,text,boolean),public.canonical_forecast_constrained_capacity_v1_outcome_current(uuid,public.canonical_forecast_constrained_capacity_outcomes_v1),public.canonical_forecast_constrained_capacity_v1_outcome_projection(public.canonical_forecast_constrained_capacity_outcomes_v1,text,boolean),public.canonical_forecast_constrained_capacity_v1_evaluation_current(uuid,public.canonical_forecast_constrained_capacity_evaluations_v1),public.canonical_forecast_constrained_capacity_v1_evaluation_projection(public.canonical_forecast_constrained_capacity_evaluations_v1,text,boolean) FROM %I',runtime_role);
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_constrained_capacity_v1_prerequisites(uuid,uuid,text,uuid),public.canonical_forecast_constrained_capacity_v1_review_current(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_constrained_capacity_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,uuid,text,bigint,text,jsonb,text,text),public.canonical_forecast_constrained_capacity_v1_epoch_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_constrained_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_constrained_capacity_v1_origin_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_constrained_capacity_v1_outcome_capture(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_constrained_capacity_v1_outcome_read(uuid,uuid,text,uuid,uuid,uuid),public.canonical_forecast_constrained_capacity_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid,uuid),public.canonical_forecast_constrained_capacity_v1_evaluation_read(uuid,uuid,text,uuid,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
