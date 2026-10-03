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
 operation TEXT NOT NULL CHECK(operation IN('INSERT','UPDATE','DELETE')),
 observed_at TIMESTAMPTZ NOT NULL,
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

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_lock_sources(org UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-source:'||org,0));
 PERFORM generation FROM public.canonical_forecast_constrained_capacity_source_fences_v1
  WHERE organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Constrained-capacity source fence unavailable' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 LOCK TABLE public.workforce_crews,public.workforce_skills,public.workforce_profile_skills,
 public.canonical_business_profiles,public.tenant_assets,public.tenant_asset_service_capabilities,
  public.canonical_equipment_events,public.canonical_equipment_plans,
  public.canonical_equipment_readiness_plans,public.canonical_travel_plans,
  public.canonical_opportunities IN SHARE MODE;
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
   ARRAY['scopeKey','appointmentId','assignmentId','crewApplicable','skillApplicable','workingHoursApplicable',
    'locationApplicable','travelApplicable','vehicleApplicable','equipmentApplicable','locationKey',
    'previousLocationKey','nextLocationKey','vehicleAssetIds','equipmentAssetIds','equipmentBasis',
    'readinessBasis','travelBasis'])
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
  ARRAY['scopeKey','role','applicability','crewIds','crewRoleRequirements','skillIds','locationKey','travelPairs',
   'vehicleAssetIds','equipmentAssetIds','operatorProfileIds','assetCalendars']) THEN RETURN FALSE;END IF;
 IF definition_value->>'scopeKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
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
  OR jsonb_array_length(definition_value->'operatorProfileIds')=0
  OR definition_value->>'locationKey'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  OR jsonb_typeof(definition_value->'crewRoleRequirements')<>'array' OR jsonb_array_length(definition_value->'crewRoleRequirements')>20
  OR (definition_value#>>'{applicability,crew}')::boolean<> (jsonb_array_length(definition_value->'crewRoleRequirements')>0)
  OR jsonb_typeof(definition_value->'travelPairs')<>'array' OR jsonb_array_length(definition_value->'travelPairs')>200
  OR jsonb_typeof(definition_value->'assetCalendars')<>'array' OR jsonb_array_length(definition_value->'assetCalendars')>40 THEN RETURN FALSE;END IF;
 FOR item IN SELECT entry FROM jsonb_array_elements(definition_value->'crewRoleRequirements') AS entries(entry) LOOP
  IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['role','count']) OR NOT(item->>'role'=ANY(roles))
   OR jsonb_typeof(item->'count')<>'number' OR item->>'count'!~'^[1-9][0-9]?$' THEN RETURN FALSE;END IF;
 END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'crewRoleRequirements') AS entries(crew_entry)
    GROUP BY crew_entry->>'role' HAVING count(*)>1) THEN RETURN FALSE;END IF;
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
  AND ((definition_value#>>'{applicability,skill}')::boolean=(jsonb_array_length(definition_value->'skillIds')>0))
  AND ((definition_value#>>'{applicability,vehicle}')::boolean=(jsonb_array_length(definition_value->'vehicleAssetIds')>0))
  AND ((definition_value#>>'{applicability,equipment}')::boolean=(jsonb_array_length(definition_value->'equipmentAssetIds')>0))
  AND (NOT (definition_value#>>'{applicability,travel}')::boolean OR jsonb_array_length(definition_value->'travelPairs')>0)
  AND (NOT (definition_value#>>'{applicability,crew}')::boolean OR
    (SELECT count(*)=1 FROM jsonb_array_elements(definition_value->'crewRoleRequirements') value
      WHERE value->>'role'=definition_value->>'role' AND value->>'count'='1'))
  AND ((SELECT count(*) FROM jsonb_array_elements(definition_value->'vehicleAssetIds') value
        WHERE lower(value#>>'{}')=ANY(asset_ids))=jsonb_array_length(definition_value->'vehicleAssetIds'))
   AND ((SELECT count(*) FROM jsonb_array_elements(definition_value->'equipmentAssetIds') value
         WHERE lower(value#>>'{}')=ANY(asset_ids))=jsonb_array_length(definition_value->'equipmentAssetIds'));
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_source_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE payload JSONB:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 org UUID;subject_value TEXT;now_value TIMESTAMPTZ;
BEGIN
 org:=(payload->>'organization_id')::uuid;
 subject_value:=COALESCE(payload->>'id',payload->>'profile_id',payload->>'crew_id',
  payload->>'skill_id',payload->>'asset_id',payload->>'estimate_id',payload->>'assignment_id',
  payload->>'appointment_id','unknown');
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-source:'||org,0));
 INSERT INTO public.canonical_forecast_constrained_capacity_source_fences_v1(organization_id,generation,updated_at)
  VALUES(org,1,now_value)
  ON CONFLICT(organization_id) DO UPDATE
   SET generation=public.canonical_forecast_constrained_capacity_source_fences_v1.generation+1,
       updated_at=EXCLUDED.updated_at;
 INSERT INTO public.canonical_forecast_constrained_capacity_source_events_v1(
  organization_id,source_kind,subject_key,operation,observed_at,row_digest)
 VALUES(org,TG_TABLE_NAME,subject_value,TG_OP,now_value,
  public.canonical_completion_digest(jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,
   'subject',subject_value,'payload',payload,'observedAt',now_value)));
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
 opportunity_value JSONB;basis_value JSONB;estimate_value UUID;receipt_value JSONB;
 expected_count INTEGER;actual_count INTEGER;
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
  SELECT * INTO assignment_value FROM public.canonical_schedule_assignments
   WHERE organization_id=org AND id=(definition_value->>'assignmentId')::uuid
    AND appointment_id=subject_value;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved work identity unavailable' USING ERRCODE='22023';END IF;
  SELECT to_jsonb(value) INTO opportunity_value FROM public.canonical_opportunities value
   WHERE value.organization_id=org AND value.id=assignment_value.opportunity_id;
  IF opportunity_value IS NULL THEN RAISE EXCEPTION 'Approved work source unavailable' USING ERRCODE='22023';END IF;
  IF (definition_value->>'locationApplicable')::boolean AND
    opportunity_value#>>'{job_scope,locationId}' IS DISTINCT FROM definition_value->>'locationKey' THEN
   RAISE EXCEPTION 'Approved work location authority unavailable' USING ERRCODE='22023';END IF;
  IF definition_value#>>'{equipmentBasis,kind}'='m24_adopted'
    OR definition_value#>>'{readinessBasis,kind}'='m24_adopted'
    OR definition_value#>>'{travelBasis,kind}'='m24_adopted' THEN
   SELECT (array_agg(value.id ORDER BY value.id))[1],count(*) INTO estimate_value,actual_count FROM public.canonical_estimates value
    WHERE value.organization_id=org AND value.opportunity_id=assignment_value.opportunity_id;
   IF actual_count<>1 THEN RAISE EXCEPTION 'Exact M24 estimate authority unavailable' USING ERRCODE='22023';END IF;
  END IF;
  FOR basis_value IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('kind','equipment','basis',definition_value->'equipmentBasis'),
    jsonb_build_object('kind','readiness','basis',definition_value->'readinessBasis'),
    jsonb_build_object('kind','travel','basis',definition_value->'travelBasis'))) value
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
  END LOOP;
  RETURN jsonb_build_object('appointmentId',subject_value,'assignmentId',assignment_value.id,
   'opportunityId',assignment_value.opportunity_id,
   'assignmentRevision',assignment_value.revision,
   'assignmentDigest',rtrim(assignment_value.canonical_digest),
   'workforceProfileId',assignment_value.workforce_profile_id,
   'workforceCrewId',assignment_value.workforce_crew_id,
   'scheduleState',assignment_value.schedule_state,'targetState',assignment_value.target_state,
   'opportunityDigest',public.canonical_completion_digest(opportunity_value),
   'serviceType',opportunity_value->>'service_type',
   'equipmentBasis',definition_value->'equipmentBasis','readinessBasis',definition_value->'readinessBasis',
   'travelBasis',definition_value->'travelBasis','estimateId',estimate_value);
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
  'latestSourceOrder',COALESCE((SELECT max(value.source_order) FROM public.canonical_forecast_constrained_capacity_source_events_v1 value
    WHERE value.organization_id=org),0)) INTO result_value;
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
 SELECT COALESCE(max(source_order),0) INTO order_value FROM public.canonical_forecast_constrained_capacity_source_events_v1 WHERE organization_id=org;
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

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_scope_calculation(
 org UUID,scope_review public.canonical_forecast_constrained_capacity_reviews_v1,
 start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,as_of_value TIMESTAMPTZ,job_evidence JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE definition_value JSONB:=scope_review.definition;base_value JSONB;row_value JSONB;
 profile_id UUID;eligible BOOLEAN;worker_minutes NUMERIC:=0;travel_minutes NUMERIC:=0;
 asset_minutes NUMERIC:=NULL;calendar_value JSONB;calendar_minutes NUMERIC;role_slots INTEGER:=1;
 availability_review public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 interval_value JSONB;working_value JSONB;job_item JSONB;job_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 assignment_value public.canonical_schedule_assignment_revisions%ROWTYPE;pair_value JSONB;duration_value INTEGER;worker_count INTEGER;
 selected_rows JSONB:='[]'::jsonb;job_rows JSONB:='[]'::jsonb;scheduled_rows JSONB:='[]'::jsonb;
 support_value JSONB;ordered_job JSONB;prior_job JSONB:=NULL;home_location TEXT;home_count INTEGER;
 horizon_minutes NUMERIC:=EXTRACT(EPOCH FROM(end_value-start_value))/60;support_count INTEGER;
BEGIN
 IF scope_review.id IS NULL OR scope_review.action<>'approve' THEN
  RAISE EXCEPTION 'Constrained-capacity scope unavailable' USING ERRCODE='22023';END IF;
 base_value:=public.canonical_forecast_workload_capacity_v1_capacity_calculation(
  org,start_value,end_value,as_of_value,definition_value->>'role');
 IF (base_value->>'censusCount')::int>100 OR (base_value->>'count')::int>100 THEN
  RAISE EXCEPTION 'Capacity evidence exceeds bound' USING ERRCODE='54000';END IF;
 IF (base_value->>'classificationComplete')::boolean IS NOT TRUE OR
    (base_value->>'availabilityComplete')::boolean IS NOT TRUE OR
    COALESCE((base_value->>'overlap')::boolean,FALSE) THEN
  RAISE EXCEPTION 'Base role capacity evidence incomplete' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(base_value->'rows')<>jsonb_array_length(definition_value->'operatorProfileIds')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(base_value->'rows') base_row
    WHERE base_row->>'profileId' NOT IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'operatorProfileIds') item)) THEN
  RAISE EXCEPTION 'Complete role-worker population unavailable' USING ERRCODE='22023';END IF;
 FOR row_value IN SELECT entry FROM jsonb_array_elements(base_value->'rows') AS entries(entry) LOOP
  profile_id:=(row_value->>'profileId')::uuid;eligible:=TRUE;
  IF (definition_value#>>'{applicability,crew}')::boolean AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(scope_review.source_identity->'crewMembers') member
    WHERE member->>1=profile_id::text
     AND member->>0 IN(SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item)) THEN eligible:=FALSE;END IF;
  IF eligible AND (definition_value#>>'{applicability,skill}')::boolean AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(definition_value->'skillIds') required_skill
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scope_review.source_identity->'profileSkills') relation
    WHERE relation->>0=profile_id::text AND relation->>1=required_skill#>>'{}')) THEN eligible:=FALSE;END IF;
  IF eligible AND profile_id::text NOT IN
    (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'operatorProfileIds') item) THEN eligible:=FALSE;END IF;
  IF eligible THEN
   SELECT * INTO availability_review FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org AND value.review_kind='availability_basis' AND value.subject_id=profile_id
     AND value.decided_at<=start_value ORDER BY value.revision DESC LIMIT 1;
   IF availability_review.id IS NULL OR availability_review.action<>'approve' THEN
    RAISE EXCEPTION 'Worker availability review unavailable' USING ERRCODE='22023';END IF;
   FOR interval_value IN SELECT value FROM jsonb_array_elements(availability_review.source_identity->'intervals')
    WHERE value->>'kind'='available' AND (value->>'start')::timestamptz<end_value AND (value->>'end')::timestamptz>start_value
   LOOP
    working_value:=public.canonical_schedule_part4_working_hours_authority(scope_review.source_identity#>'{businessProfile,rawProfile}',
     GREATEST((interval_value->>'start')::timestamptz,start_value),LEAST((interval_value->>'end')::timestamptz,end_value),
     scope_review.source_identity#>>'{businessProfile,timeZone}');
    IF working_value->'covered' IS DISTINCT FROM 'true'::jsonb THEN
     RAISE EXCEPTION 'Declared availability exceeds working-hours authority' USING ERRCODE='22023';END IF;
   END LOOP;
   worker_minutes:=worker_minutes+(row_value->>'availableMinutes')::numeric;
   selected_rows:=selected_rows||jsonb_build_array(jsonb_build_object('profileId',profile_id,
    'availableMinutes',row_value->'availableMinutes','roleReviewId',row_value->'roleReviewId',
    'availabilityReviewId',row_value->'availabilityReviewId'));
  END IF;
 END LOOP;
 IF jsonb_array_length(selected_rows)<>jsonb_array_length(definition_value->'operatorProfileIds') THEN
  RAISE EXCEPTION 'Exact reviewed worker population unavailable' USING ERRCODE='22023';END IF;
 FOR pair_value IN SELECT entry FROM jsonb_array_elements(definition_value->'crewRoleRequirements') AS entries(entry)
  WHERE entry->>'role'=definition_value->>'role' LOOP role_slots:=(pair_value->>'count')::int;END LOOP;
 IF (definition_value#>>'{applicability,crew}')::boolean THEN
 FOR pair_value IN SELECT entry FROM jsonb_array_elements(definition_value->'crewRoleRequirements') AS entries(entry) LOOP
   support_value:=public.canonical_forecast_workload_capacity_v1_capacity_calculation(
    org,start_value,end_value,as_of_value,pair_value->>'role');
   IF (support_value->>'classificationComplete')::boolean IS NOT TRUE OR
      (support_value->>'availabilityComplete')::boolean IS NOT TRUE OR
      COALESCE((support_value->>'overlap')::boolean,FALSE) THEN
    RAISE EXCEPTION 'Crew support evidence incomplete' USING ERRCODE='22023';END IF;
   SELECT count(*) INTO support_count FROM jsonb_array_elements(support_value->'rows') support_row
    WHERE ((pair_value->>'role'=definition_value->>'role'
       AND support_row->>'profileId' IN(SELECT selected->>'profileId' FROM jsonb_array_elements(selected_rows) selected))
      OR (pair_value->>'role'<>definition_value->>'role' AND (support_row->>'availableMinutes')::numeric=horizon_minutes))
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(scope_review.source_identity->'crewMembers') member
       WHERE member->>1=support_row->>'profileId'
        AND member->>0 IN(SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item));
   IF support_count<(pair_value->>'count')::int THEN
    RAISE EXCEPTION 'Exact crew formation unavailable for full horizon' USING ERRCODE='22023';END IF;
  END LOOP;
 END IF;
 FOR job_item IN SELECT entry FROM jsonb_array_elements(job_evidence) AS entries(entry)
  WHERE entry->>'scopeKey'=scope_review.scope_key ORDER BY entry->>'appointmentId'
 LOOP
  SELECT * INTO job_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(job_item->>'reviewId')::uuid AND review_kind='job'
    AND scope_key=scope_review.scope_key AND subject_id=(job_item->>'appointmentId')::uuid;
  IF job_review.id IS NULL OR job_review.action<>'approve'
   OR rtrim(job_review.digest) IS DISTINCT FROM job_item->>'digest' THEN
   RAISE EXCEPTION 'Approved work constraint receipt unavailable' USING ERRCODE='22023';END IF;
  SELECT revision_value.* INTO assignment_value
   FROM public.canonical_schedule_assignment_revisions revision_value
   LEFT JOIN public.canonical_schedule_human_approvals human_value
    ON human_value.organization_id=revision_value.organization_id AND human_value.id=revision_value.human_approval_id
   LEFT JOIN public.canonical_schedule_approvals approval_value
    ON approval_value.organization_id=revision_value.organization_id AND approval_value.id=revision_value.approval_id
   WHERE revision_value.organization_id=org AND revision_value.assignment_id=(job_review.definition->>'assignmentId')::uuid
    AND COALESCE(human_value.approved_at,approval_value.approved_at)<=as_of_value
   ORDER BY COALESCE(human_value.approved_at,approval_value.approved_at) DESC,revision_value.revision DESC LIMIT 1;
  IF assignment_value.assignment_id IS NULL THEN RAISE EXCEPTION 'Approved commitment evidence unavailable' USING ERRCODE='22023';END IF;
  IF assignment_value.schedule_state='scheduled' AND
    NOT COALESCE((assignment_value.workforce_profile_id::text IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'operatorProfileIds') item)
     OR assignment_value.workforce_crew_id::text IN
      (SELECT item#>>'{}' FROM jsonb_array_elements(definition_value->'crewIds') item)),FALSE) THEN
   RAISE EXCEPTION 'Approved commitment is outside reviewed capacity scope' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(
      (job_review.definition->'vehicleAssetIds')||(job_review.definition->'equipmentAssetIds')) asset_id
     WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scope_review.source_identity->'assetCapabilities') capability
       WHERE capability->>0=asset_id#>>'{}'
        AND lower(capability->>1)=lower(job_review.source_identity->>'serviceType'))) THEN
   RAISE EXCEPTION 'Approved work asset suitability unavailable' USING ERRCODE='22023';END IF;
  IF assignment_value.schedule_state='scheduled' AND assignment_value.scheduled_start<end_value
    AND assignment_value.scheduled_end>start_value AND (job_review.definition->>'travelApplicable')::boolean THEN
   scheduled_rows:=scheduled_rows||jsonb_build_array(jsonb_build_object(
    'appointmentId',job_review.subject_id,'start',assignment_value.scheduled_start,
    'end',assignment_value.scheduled_end,'locationKey',job_review.definition->>'locationKey',
    'previousLocationKey',job_review.definition->>'previousLocationKey',
    'nextLocationKey',job_review.definition->>'nextLocationKey'));
  END IF;
 job_rows:=job_rows||jsonb_build_array(jsonb_build_object('reviewId',job_review.id,
   'appointmentId',job_review.subject_id,'assignmentId',job_review.definition->>'assignmentId'));
 END LOOP;
 IF jsonb_array_length(scheduled_rows)>0 THEN
  SELECT count(DISTINCT value->>1),min(value->>1) INTO home_count,home_location
   FROM jsonb_array_elements(scope_review.source_identity->'crews') value;
  IF home_count<>1 OR home_location IS NULL THEN
   RAISE EXCEPTION 'Exact crew home location unavailable' USING ERRCODE='22023';END IF;
  FOR ordered_job IN SELECT entry FROM jsonb_array_elements(scheduled_rows) entries(entry)
   ORDER BY (entry->>'start')::timestamptz,entry->>'appointmentId'
  LOOP
   IF prior_job IS NULL THEN
    IF ordered_job->>'previousLocationKey' IS DISTINCT FROM home_location THEN
     RAISE EXCEPTION 'First approved commitment origin unavailable' USING ERRCODE='22023';END IF;
    SELECT (value->>'durationMinutes')::int INTO duration_value
     FROM jsonb_array_elements(definition_value->'travelPairs') value
     WHERE value->>'fromLocationKey'=home_location
      AND value->>'toLocationKey'=ordered_job->>'locationKey';
    IF duration_value IS NULL OR (ordered_job->>'start')::timestamptz-
       make_interval(mins=>duration_value)<start_value THEN
     RAISE EXCEPTION 'Inbound travel interval unavailable' USING ERRCODE='22023';END IF;
   ELSE
    IF ordered_job->>'previousLocationKey' IS DISTINCT FROM prior_job->>'locationKey'
      OR prior_job->>'nextLocationKey' IS DISTINCT FROM ordered_job->>'locationKey' THEN
     RAISE EXCEPTION 'Ordered approved commitment locations unavailable' USING ERRCODE='22023';END IF;
    SELECT (value->>'durationMinutes')::int INTO duration_value
     FROM jsonb_array_elements(definition_value->'travelPairs') value
     WHERE value->>'fromLocationKey'=prior_job->>'locationKey'
      AND value->>'toLocationKey'=ordered_job->>'locationKey';
    IF duration_value IS NULL OR (prior_job->>'end')::timestamptz+
       make_interval(mins=>duration_value)>(ordered_job->>'start')::timestamptz THEN
     RAISE EXCEPTION 'Ordered travel interval unavailable' USING ERRCODE='22023';END IF;
   END IF;
   travel_minutes:=travel_minutes+duration_value*role_slots;
   prior_job:=ordered_job;
  END LOOP;
  IF prior_job->>'nextLocationKey' IS DISTINCT FROM home_location THEN
   RAISE EXCEPTION 'Final approved commitment destination unavailable' USING ERRCODE='22023';END IF;
  SELECT (value->>'durationMinutes')::int INTO duration_value
   FROM jsonb_array_elements(definition_value->'travelPairs') value
   WHERE value->>'fromLocationKey'=prior_job->>'locationKey' AND value->>'toLocationKey'=home_location;
  IF duration_value IS NULL OR (prior_job->>'end')::timestamptz+
     make_interval(mins=>duration_value)>end_value THEN
   RAISE EXCEPTION 'Outbound travel interval unavailable' USING ERRCODE='22023';END IF;
  travel_minutes:=travel_minutes+duration_value*role_slots;
 END IF;
 FOR calendar_value IN SELECT entry FROM jsonb_array_elements(definition_value->'assetCalendars') AS entries(entry) LOOP
  calendar_minutes:=GREATEST(public.canonical_forecast_constrained_capacity_v1_interval_minutes(
    calendar_value->'availableIntervals',start_value,end_value)-
    public.canonical_forecast_constrained_capacity_v1_interval_minutes(
    calendar_value->'committedIntervals',start_value,end_value),0);
  IF calendar_minutes<>horizon_minutes THEN
   RAISE EXCEPTION 'Exact declared asset horizon unavailable' USING ERRCODE='22023';END IF;
  asset_minutes:=CASE WHEN asset_minutes IS NULL THEN calendar_minutes ELSE LEAST(asset_minutes,calendar_minutes) END;
 END LOOP;
 worker_minutes:=GREATEST(worker_minutes-travel_minutes,0);
 IF asset_minutes IS NOT NULL THEN worker_minutes:=LEAST(worker_minutes,asset_minutes*role_slots);END IF;
 RETURN jsonb_build_object('scopeKey',scope_review.scope_key,'scopeReviewId',scope_review.id,
  'scopeDigest',rtrim(scope_review.digest),'role',definition_value->>'role','personMinutes',round(worker_minutes,6),
  'workerEvidence',selected_rows,'jobEvidence',job_rows,'travelPersonMinutes',round(travel_minutes,6),
  'assetMinutes',CASE WHEN asset_minutes IS NULL THEN NULL ELSE round(asset_minutes,6) END,
  'allSevenDimensionsApplied',TRUE,'resultPrivate',TRUE);
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_work_census(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH accepted AS (
  SELECT assignment.*,revision_value.revision assignment_revision,
   rtrim(revision_value.canonical_digest) assignment_digest,
   COALESCE(human_value.approved_at,approval_value.approved_at) decision_at
  FROM public.canonical_schedule_assignments assignment
  JOIN LATERAL (SELECT value.* FROM public.canonical_schedule_assignment_revisions value
    WHERE value.organization_id=assignment.organization_id AND value.assignment_id=assignment.id
    ORDER BY value.revision DESC LIMIT 1) revision_value ON TRUE
  LEFT JOIN public.canonical_schedule_human_approvals human_value
   ON human_value.organization_id=revision_value.organization_id AND human_value.id=revision_value.human_approval_id
  LEFT JOIN public.canonical_schedule_approvals approval_value
   ON approval_value.organization_id=revision_value.organization_id AND approval_value.id=revision_value.approval_id
  WHERE assignment.organization_id=org
 ), eligible AS (
  SELECT * FROM accepted WHERE decision_at IS NOT NULL AND decision_at<=cutoff_value
   AND target_state='assigned' AND schedule_state IN('scheduled','unscheduled')
   AND (appointment_status NOT IN('completed','cancelled') OR
    (schedule_state='scheduled' AND scheduled_start<cutoff_value+INTERVAL '2592000 seconds' AND scheduled_end>cutoff_value))
  ORDER BY appointment_id LIMIT 501
 ) SELECT jsonb_build_object('count',count(*),'rows',COALESCE(jsonb_agg(jsonb_build_object(
   'appointmentId',appointment_id,'assignmentId',id,'assignmentRevision',assignment_revision,
   'assignmentDigest',assignment_digest,'scheduleState',schedule_state,'decisionAt',decision_at)
   ORDER BY appointment_id),'[]'::jsonb)) FROM eligible
$$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_complete_input(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE backlog_value JSONB;row_value JSONB;job_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 method_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 jobs_value JSONB:='[]'::jsonb;scopes_value JSONB:='[]'::jsonb;count_value INTEGER:=0;job_match_count INTEGER;
BEGIN
 method_review:=public.canonical_forecast_constrained_capacity_v1_review_current_internal(org,'method',NULL,NULL);
 IF method_review.id IS NULL OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,method_review) IS NOT TRUE THEN
  RAISE EXCEPTION 'Constrained-capacity method unavailable' USING ERRCODE='22023';END IF;
 backlog_value:=public.canonical_forecast_constrained_capacity_v1_work_census(org,cutoff_value);
 IF (backlog_value->>'count')::int>500 THEN RAISE EXCEPTION 'Approved work census exceeds bound' USING ERRCODE='54000';END IF;
 FOR scope_review IN SELECT value.* FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='scope' AND value.action='approve'
   AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
    WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=value.scope_key
    ORDER BY latest.revision DESC LIMIT 1) ORDER BY value.scope_key
 LOOP
  IF public.canonical_forecast_constrained_capacity_v1_review_is_current(org,scope_review) IS NOT TRUE THEN
   RAISE EXCEPTION 'Constrained-capacity scope unavailable' USING ERRCODE='22023';END IF;
  count_value:=count_value+1;
  scopes_value:=scopes_value||jsonb_build_array(jsonb_build_object('scopeKey',scope_review.scope_key,
   'reviewId',scope_review.id,'revision',scope_review.revision,'digest',rtrim(scope_review.digest),
   'definitionDigest',public.canonical_completion_digest(scope_review.definition)));
 END LOOP;
 IF count_value NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Constrained-capacity scope population unavailable' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_reviews_v1 left_scope
   JOIN public.canonical_forecast_constrained_capacity_reviews_v1 right_scope
    ON right_scope.organization_id=left_scope.organization_id AND right_scope.review_kind='scope'
     AND right_scope.action='approve' AND right_scope.scope_key>left_scope.scope_key
     AND right_scope.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
       WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=right_scope.scope_key
       ORDER BY latest.revision DESC LIMIT 1)
   WHERE left_scope.organization_id=org AND left_scope.review_kind='scope' AND left_scope.action='approve'
    AND left_scope.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
      WHERE latest.organization_id=org AND latest.review_kind='scope' AND latest.scope_key=left_scope.scope_key
      ORDER BY latest.revision DESC LIMIT 1)
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
  SELECT count(*) INTO job_match_count FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='job'
    AND value.subject_id=(row_value->>'appointmentId')::uuid AND value.action='approve'
    AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
      WHERE latest.organization_id=org AND latest.review_kind='job'
       AND latest.scope_key=value.scope_key AND latest.subject_id=value.subject_id
      ORDER BY latest.revision DESC LIMIT 1);
  IF job_match_count<>1 THEN
   RAISE EXCEPTION 'Complete approved work constraint census unavailable' USING ERRCODE='22023';END IF;
  SELECT value.* INTO job_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='job' AND value.subject_id=(row_value->>'appointmentId')::uuid
    AND value.action='approve'
    AND value.id=(SELECT latest.id FROM public.canonical_forecast_constrained_capacity_reviews_v1 latest
      WHERE latest.organization_id=org AND latest.review_kind='job'
       AND latest.scope_key=value.scope_key AND latest.subject_id=value.subject_id
      ORDER BY latest.revision DESC LIMIT 1)
   ORDER BY value.scope_key LIMIT 1;
  IF job_review.id IS NULL OR public.canonical_forecast_constrained_capacity_v1_review_is_current(org,job_review) IS NOT TRUE
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scopes_value) scope_item
      WHERE scope_item->>'scopeKey'=job_review.scope_key) THEN
   RAISE EXCEPTION 'Complete approved work constraint census unavailable' USING ERRCODE='22023';END IF;
  IF job_review.definition->>'assignmentId' IS DISTINCT FROM row_value->>'assignmentId' THEN
   RAISE EXCEPTION 'Approved work constraint identity differs' USING ERRCODE='22023';END IF;
  SELECT value.* INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='scope' AND value.scope_key=job_review.scope_key
   ORDER BY value.revision DESC LIMIT 1;
  IF job_review.definition->'crewApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,crew}'
   OR job_review.definition->'skillApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,skill}'
   OR job_review.definition->'workingHoursApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,workingHours}'
   OR job_review.definition->'locationApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,location}'
   OR job_review.definition->'travelApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,travel}'
   OR job_review.definition->'vehicleApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,vehicle}'
   OR job_review.definition->'equipmentApplicable' IS DISTINCT FROM scope_review.definition#>'{applicability,equipment}'
   OR job_review.definition->'vehicleAssetIds' IS DISTINCT FROM scope_review.definition->'vehicleAssetIds'
   OR job_review.definition->'equipmentAssetIds' IS DISTINCT FROM scope_review.definition->'equipmentAssetIds' THEN
   RAISE EXCEPTION 'Approved work constraints differ from scope' USING ERRCODE='22023';END IF;
  jobs_value:=jobs_value||jsonb_build_array(jsonb_build_object('appointmentId',row_value->>'appointmentId',
   'assignmentId',row_value->>'assignmentId','scopeKey',job_review.scope_key,'reviewId',job_review.id,
   'revision',job_review.revision,'digest',rtrim(job_review.digest),'scheduleState',row_value->>'scheduleState',
   'assignmentRevision',row_value->'assignmentRevision','assignmentDigest',row_value->'assignmentDigest'));
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
  'jobIds',(SELECT COALESCE(jsonb_agg(value->>'appointmentId' ORDER BY value->>'appointmentId'),'[]'::jsonb)
    FROM jsonb_array_elements(jobs_value) value),'approvedWorkCount',jsonb_array_length(jobs_value));
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_results(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,as_of_value TIMESTAMPTZ,input_value JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_item JSONB;scope_review public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
 result_value JSONB;results_value JSONB:='[]'::jsonb;
BEGIN
 FOR scope_item IN SELECT entry FROM jsonb_array_elements(input_value->'scopes') AS entries(entry) ORDER BY entry->>'scopeKey' LOOP
  SELECT * INTO scope_review FROM public.canonical_forecast_constrained_capacity_reviews_v1
   WHERE organization_id=org AND id=(scope_item->>'reviewId')::uuid;
  IF scope_review.id IS NULL OR scope_review.scope_key IS DISTINCT FROM scope_item->>'scopeKey'
   OR rtrim(scope_review.digest) IS DISTINCT FROM scope_item->>'digest' THEN
   RAISE EXCEPTION 'Constrained-capacity scope receipt unavailable' USING ERRCODE='22023';END IF;
  result_value:=public.canonical_forecast_constrained_capacity_v1_scope_calculation(
   org,scope_review,start_value,end_value,as_of_value,input_value->'jobs');
  results_value:=results_value||jsonb_build_array(result_value);
 END LOOP;
 RETURN results_value;
END $$;

CREATE FUNCTION public.canonical_forecast_constrained_capacity_v1_origin_current(
 org UUID,value public.canonical_forecast_constrained_capacity_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch_value public.canonical_forecast_constrained_capacity_epochs_v1%ROWTYPE;
 item JSONB;review_value public.canonical_forecast_constrained_capacity_reviews_v1%ROWTYPE;
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
       AND newer.revision>review_value.revision AND newer.decided_at<value.horizon_ends_at) THEN RETURN FALSE;END IF;
 END LOOP;
 SELECT * INTO review_value FROM public.canonical_forecast_constrained_capacity_reviews_v1
  WHERE organization_id=org AND id=(value.input_manifest#>>'{method,reviewId}')::uuid;
 IF review_value.id IS NULL OR review_value.action<>'approve'
  OR rtrim(review_value.digest) IS DISTINCT FROM value.input_manifest#>>'{method,digest}'
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_reviews_v1 newer
     WHERE newer.organization_id=org AND newer.review_kind='method'
      AND newer.revision>review_value.revision AND newer.decided_at<value.horizon_ends_at) THEN RETURN FALSE;END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_constrained_capacity_source_events_v1 event_value
    WHERE event_value.organization_id=org
     AND event_value.source_order>COALESCE((value.input_manifest#>>'{sourceGeneration,constrainedSourceOrder}')::bigint,0)
     AND event_value.observed_at>=value.prediction_cutoff_at AND event_value.observed_at<value.horizon_ends_at)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_role_generations_v1 event_value
    WHERE event_value.organization_id=org
     AND event_value.source_order>COALESCE((value.input_manifest#>>'{sourceGeneration,roleSourceOrder}')::bigint,0)
     AND event_value.observed_at>=value.prediction_cutoff_at AND event_value.observed_at<value.horizon_ends_at)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_profile_events_v1 event_value
    WHERE event_value.organization_id=org
     AND event_value.source_order>COALESCE((value.input_manifest#>>'{sourceGeneration,profileSourceOrder}')::bigint,0)
     AND event_value.observed_at>=value.prediction_cutoff_at AND event_value.observed_at<value.horizon_ends_at)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_availability_events_v1 event_value
    WHERE event_value.organization_id=org
     AND event_value.source_order>COALESCE((value.input_manifest#>>'{sourceGeneration,availabilitySourceOrder}')::bigint,0)
     AND event_value.observed_at>=value.prediction_cutoff_at AND event_value.observed_at<value.horizon_ends_at)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_crew_events_v1 event_value
    WHERE event_value.organization_id=org
     AND event_value.source_order>COALESCE((value.input_manifest#>>'{sourceGeneration,crewSourceOrder}')::bigint,0)
     AND event_value.observed_at>=value.prediction_cutoff_at AND event_value.observed_at<value.horizon_ends_at)
  OR (SELECT count(*) FROM public.canonical_schedule_approvals event_value
    WHERE event_value.organization_id=org AND event_value.approved_at>=value.prediction_cutoff_at
     AND event_value.approved_at<value.horizon_ends_at)>
     COALESCE((value.input_manifest#>>'{sourceGeneration,scheduleApprovalWindowCount}')::bigint,0)
  OR (SELECT count(*) FROM public.canonical_schedule_human_approvals event_value
    WHERE event_value.organization_id=org AND event_value.approved_at>=value.prediction_cutoff_at
     AND event_value.approved_at<value.horizon_ends_at)>
     COALESCE((value.input_manifest#>>'{sourceGeneration,humanApprovalWindowCount}')::bigint,0) THEN RETURN FALSE;END IF;
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
 recomputed JSONB;
BEGIN
 SELECT * INTO origin_value FROM public.canonical_forecast_constrained_capacity_origins_v1
  WHERE organization_id=org AND id=value.origin_id;
 SELECT * INTO current_epoch FROM public.canonical_forecast_constrained_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF origin_value.id IS NULL OR current_epoch.id IS DISTINCT FROM origin_value.epoch_id
  OR public.canonical_forecast_constrained_capacity_v1_origin_current(org,origin_value) IS NOT TRUE THEN RETURN FALSE;END IF;
 recomputed:=public.canonical_forecast_constrained_capacity_v1_results(org,origin_value.prediction_cutoff_at,
  origin_value.horizon_ends_at,origin_value.horizon_ends_at,origin_value.input_manifest);
 RETURN value.source_manifest#>>'{origin,digest}'=rtrim(origin_value.digest)
  AND value.source_manifest->>'resultDigest'=public.canonical_completion_digest(recomputed)
  AND value.private_results=recomputed
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
 now_value TIMESTAMPTZ;results_value JSONB;manifest_value JSONB;
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
 results_value:=public.canonical_forecast_constrained_capacity_v1_results(org,origin_value.prediction_cutoff_at,
  origin_value.horizon_ends_at,origin_value.horizon_ends_at,origin_value.input_manifest);
 manifest_value:=jsonb_build_object('origin',jsonb_build_object('id',origin_value.id,'digest',rtrim(origin_value.digest)),
  'window',jsonb_build_object('start',origin_value.prediction_cutoff_at,'end',origin_value.horizon_ends_at),
  'resultDigest',public.canonical_completion_digest(results_value));
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','outcome','originId',origin_id_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:constrained-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_constrained_capacity_outcomes_v1
  WHERE organization_id=org AND actor_id=actor AND idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash OR public.canonical_forecast_constrained_capacity_v1_outcome_current(org,old) IS NOT TRUE THEN
   RAISE EXCEPTION 'Constrained-capacity outcome replay conflict' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_constrained_capacity_v1_outcome_projection(old,'constrained_capacity_outcome_saved',TRUE);END IF;
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
 IF NOT FOUND THEN RETURN NULL;END IF;
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
 metrics_value:=(SELECT jsonb_agg(jsonb_build_object('scopeKey',forecast_value->>'scopeKey',
   'forecastPersonMinutes',forecast_value->'personMinutes','actualPersonMinutes',actual_value->'personMinutes')
   ORDER BY forecast_value->>'scopeKey') FROM jsonb_array_elements(origin_value.private_results) forecast_value
   JOIN jsonb_array_elements(outcome_value.private_results) actual_value
    ON actual_value->>'scopeKey'=forecast_value->>'scopeKey');
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
 IF NOT FOUND THEN RETURN NULL;END IF;
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
 public.canonical_forecast_constrained_capacity_v1_uuid_array(jsonb,integer),
 public.canonical_forecast_constrained_capacity_v1_intervals(jsonb),
 public.canonical_forecast_constrained_capacity_v1_definition_valid(text,jsonb),
 public.canonical_forecast_constrained_capacity_v1_source_identity(uuid,text,text,uuid,jsonb),
 public.canonical_forecast_constrained_capacity_v1_review_current_internal(uuid,text,text,uuid),
 public.canonical_forecast_constrained_capacity_v1_review_is_current(uuid,public.canonical_forecast_constrained_capacity_reviews_v1),
 public.canonical_forecast_constrained_capacity_v1_review_projection(public.canonical_forecast_constrained_capacity_reviews_v1,boolean),
 public.canonical_forecast_constrained_capacity_v1_interval_minutes(jsonb,timestamptz,timestamptz),
 public.canonical_forecast_constrained_capacity_v1_scope_calculation(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz,timestamptz,timestamptz,jsonb),
 public.canonical_forecast_constrained_capacity_v1_work_census(uuid,timestamptz),
 public.canonical_forecast_constrained_capacity_v1_complete_input(uuid,timestamptz),
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
   EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_constrained_capacity_v1_source_capture(),public.canonical_forecast_constrained_capacity_v1_immutable(),public.canonical_forecast_constrained_capacity_v1_lock_sources(uuid),public.canonical_forecast_constrained_capacity_v1_uuid_array(jsonb,integer),public.canonical_forecast_constrained_capacity_v1_intervals(jsonb),public.canonical_forecast_constrained_capacity_v1_definition_valid(text,jsonb),public.canonical_forecast_constrained_capacity_v1_source_identity(uuid,text,text,uuid,jsonb),public.canonical_forecast_constrained_capacity_v1_review_current_internal(uuid,text,text,uuid),public.canonical_forecast_constrained_capacity_v1_review_is_current(uuid,public.canonical_forecast_constrained_capacity_reviews_v1),public.canonical_forecast_constrained_capacity_v1_review_projection(public.canonical_forecast_constrained_capacity_reviews_v1,boolean),public.canonical_forecast_constrained_capacity_v1_interval_minutes(jsonb,timestamptz,timestamptz),public.canonical_forecast_constrained_capacity_v1_scope_calculation(uuid,public.canonical_forecast_constrained_capacity_reviews_v1,timestamptz,timestamptz,timestamptz,jsonb),public.canonical_forecast_constrained_capacity_v1_work_census(uuid,timestamptz),public.canonical_forecast_constrained_capacity_v1_complete_input(uuid,timestamptz),public.canonical_forecast_constrained_capacity_v1_results(uuid,timestamptz,timestamptz,timestamptz,jsonb),public.canonical_forecast_constrained_capacity_v1_origin_current(uuid,public.canonical_forecast_constrained_capacity_origins_v1),public.canonical_forecast_constrained_capacity_v1_origin_projection(public.canonical_forecast_constrained_capacity_origins_v1,text,boolean),public.canonical_forecast_constrained_capacity_v1_outcome_current(uuid,public.canonical_forecast_constrained_capacity_outcomes_v1),public.canonical_forecast_constrained_capacity_v1_outcome_projection(public.canonical_forecast_constrained_capacity_outcomes_v1,text,boolean),public.canonical_forecast_constrained_capacity_v1_evaluation_current(uuid,public.canonical_forecast_constrained_capacity_evaluations_v1),public.canonical_forecast_constrained_capacity_v1_evaluation_projection(public.canonical_forecast_constrained_capacity_evaluations_v1,text,boolean) FROM %I',runtime_role);
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_constrained_capacity_v1_prerequisites(uuid,uuid,text,uuid),public.canonical_forecast_constrained_capacity_v1_review_current(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_constrained_capacity_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,uuid,text,bigint,text,jsonb,text,text),public.canonical_forecast_constrained_capacity_v1_epoch_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_constrained_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_constrained_capacity_v1_origin_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_constrained_capacity_v1_outcome_capture(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_constrained_capacity_v1_outcome_read(uuid,uuid,text,uuid,uuid,uuid),public.canonical_forecast_constrained_capacity_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid,uuid),public.canonical_forecast_constrained_capacity_v1_evaluation_read(uuid,uuid,text,uuid,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
