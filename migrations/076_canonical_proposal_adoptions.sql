-- Package3: reviewed aggregate adoption. All73 applied migrations remain immutable.
CREATE TABLE public.canonical_estimate_proposal_adoptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id), estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 actor_name TEXT NOT NULL, request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 version TEXT NOT NULL CHECK(version='estimate-proposal-adoption-v1'), body JSONB NOT NULL,
 source_pins JSONB NOT NULL, original_source_pins JSONB NOT NULL, recipe_pin JSONB NOT NULL,
 component_manifest JSONB NOT NULL, child_id UUID NOT NULL, parent_id UUID,
 material_plan_id UUID, labor_plan_id UUID, equipment_plan_id UUID, equipment_cost_plan_id UUID,
 travel_plan_id UUID, pricing_plan_id UUID, pricing_policy_id UUID,
 reviewed_result JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 UNIQUE(organization_id,estimate_id,id), UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,estimate_id,child_id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_estimate_proposal_adoptions(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,parent_id) REFERENCES public.canonical_estimate_revisions(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,child_id) REFERENCES public.canonical_estimate_revisions(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,material_plan_id) REFERENCES public.canonical_material_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,labor_plan_id) REFERENCES public.canonical_labor_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,equipment_plan_id) REFERENCES public.canonical_equipment_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,equipment_cost_plan_id) REFERENCES public.canonical_equipment_cost_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,travel_plan_id) REFERENCES public.canonical_travel_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,pricing_plan_id) REFERENCES public.canonical_pricing_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,pricing_policy_id) REFERENCES public.canonical_pricing_policy_plans(organization_id,estimate_id,id),
 CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=131072),
 CHECK(expires_at>created_at)
);
CREATE TRIGGER canonical_proposal_adoption_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_estimate_proposal_adoptions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_equipment_plan_immutable();
REVOKE ALL ON TABLE public.canonical_estimate_proposal_adoptions FROM PUBLIC;
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revision_components_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revision_components_check CHECK(CASE
 WHEN calculation_version='estimate-cost-adoption-v3' THEN changed_component IN ('material','labor','equipment','travel','prepared') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND public.canonical_field_evidence_object_keys_exact(component_manifest,ARRAY['material','labor','equipment','travel']) AND coverage_assessment IS NOT NULL AND jsonb_typeof(coverage_assessment)='object' AND CASE changed_component WHEN 'material' THEN material_plan_id IS NOT NULL WHEN 'labor' THEN labor_plan_id IS NOT NULL WHEN 'equipment' THEN equipment_cost_plan_id IS NOT NULL WHEN 'prepared' THEN (material_plan_id IS NOT NULL OR labor_plan_id IS NOT NULL OR equipment_cost_plan_id IS NOT NULL OR travel_plan_id IS NOT NULL) ELSE travel_plan_id IS NOT NULL END
 WHEN calculation_version='estimate-cost-adoption-v2' THEN travel_plan_id IS NULL AND coverage_assessment IS NULL AND changed_component IN ('material','labor','equipment') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND public.canonical_field_evidence_object_keys_exact(component_manifest,ARRAY['material','labor','equipment']) AND CASE changed_component WHEN 'material' THEN material_plan_id IS NOT NULL WHEN 'labor' THEN labor_plan_id IS NOT NULL ELSE equipment_cost_plan_id IS NOT NULL END
 WHEN calculation_version='estimate-cost-adoption-v1' THEN travel_plan_id IS NULL AND coverage_assessment IS NULL AND equipment_cost_plan_id IS NULL AND changed_component IN ('material','labor') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND jsonb_typeof(component_manifest)='object' AND CASE WHEN changed_component='material' THEN material_plan_id IS NOT NULL ELSE labor_plan_id IS NOT NULL END
 ELSE travel_plan_id IS NULL AND coverage_assessment IS NULL AND material_plan_id IS NOT NULL AND labor_plan_id IS NULL AND equipment_cost_plan_id IS NULL AND changed_component IS NULL AND component_manifest IS NULL END);
CREATE UNIQUE INDEX canonical_revision_prepared_once ON public.canonical_estimate_revisions(organization_id,estimate_id,COALESCE(previous_id,estimate_id),input_fingerprint) WHERE changed_component='prepared';
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN('proposal_adopt','simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost','equipment_ready','travel_plan','pricing_plan','pricing_policy','commercial_terms','commercial_ok','tax_profile'));


-- Recipe binding is private and resolves current publication bytes itself.
-- Financial calculations remain in the existing component routines.
CREATE FUNCTION public.canonical_proposal_adoption_envelope_require(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,body JSONB,at_value TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw JSONB; row_value JSONB; doc JSONB; recipe JSONB; candidate JSONB; scope_value JSONB;
 fields JSONB; facts JSONB:='{}'; values_map JSONB:='{}'; units_map JSONB:='{}'; result JSONB:='{}';
 field_value JSONB; step_value JSONB; arg JSONB; binding JSONB; component JSONB; inputs_value JSONB;
 override_value JSONB; value_json JSONB; field_id TEXT; kind TEXT; unit_value TEXT; part TEXT; expected TEXT;
 dimensions JSONB; target_dims JSONB; source_dims JSONB; key_value TEXT; vector_n INTEGER; sign_value INTEGER;
 ids TEXT[]:=ARRAY[]::TEXT[]; seen TEXT[]:=ARRAY[]::TEXT[]; allowed TEXT[];
 n NUMERIC; d NUMERIC; an NUMERIC; ad NUMERIC; divisor NUMERIC; a NUMERIC; b NUMERIC;
 decimal_value TEXT; row_target JSONB; path_value TEXT[]; source_count INTEGER:=0; index_value INTEGER; j INTEGER;
 service_value TEXT; currency_value TEXT; day_value DATE:=(at_value AT TIME ZONE 'UTC')::date;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 raw:=public.canonical_equipment_plan_sources(org,actor,role_value,session_value,estimate,NULL);
 scope_value:=raw->'scope'; service_value:=raw->>'serviceKey';
 SELECT currency INTO currency_value FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;
 FOR row_value IN SELECT value FROM jsonb_array_elements(raw->'knowledgeRows') LOOP
  doc:=(row_value->>'canonical_document')::jsonb;
  IF encode(sha256(convert_to(row_value->>'canonical_document','UTF8')),'hex') IS DISTINCT FROM row_value->>'canonical_digest' OR row_value->>'publication_digest' IS DISTINCT FROM row_value->>'canonical_digest' OR doc->>'canonicalKey' IS DISTINCT FROM row_value->>'canonical_key' OR doc->>'entryType' IS DISTINCT FROM row_value->>'entry_type' OR doc->>'sensitivity' IS DISTINCT FROM row_value->>'sensitivity' OR doc->>'reviewRequirement' IS DISTINCT FROM row_value->>'review_requirement' THEN RAISE EXCEPTION 'Published source integrity unavailable' USING ERRCODE='40001';END IF;
  IF doc#>>'{content,state}'='tombstoned' THEN CONTINUE;END IF;
  IF doc#>'{applicability,projection}' IS NOT NULL THEN
   candidate:=doc#>'{applicability,projection}';
   IF jsonb_typeof(candidate)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(candidate) k WHERE k NOT IN('audiences','consumers','capabilities')) THEN RAISE EXCEPTION 'Published applicability invalid' USING ERRCODE='22023';END IF;
   IF candidate?'audiences' AND NOT candidate->'audiences'?'internal' OR candidate?'consumers' AND NOT candidate->'consumers'?'northstar_assistant' THEN CONTINUE;END IF;
   IF candidate?'capabilities' AND NOT candidate->'capabilities' ?| ARRAY['services','operational_capabilities','availability'] THEN CONTINUE;END IF;
  END IF;
  candidate:=doc#>'{content,estimateProposalRecipe}';
  IF candidate->>'serviceKey' IS DISTINCT FROM service_value THEN CONTINUE;END IF;
  source_count:=source_count+1;recipe:=candidate;
  IF body->'recipePin' IS DISTINCT FROM jsonb_build_object('id',row_value->>'publication_id','digest',row_value->>'canonical_digest') THEN RAISE EXCEPTION 'Recipe publication changed' USING ERRCODE='40001';END IF;
 END LOOP;
 IF source_count<>1 OR recipe IS NULL THEN RAISE EXCEPTION 'One current recipe required' USING ERRCODE='40001';END IF;
 IF public.canonical_field_evidence_object_keys_exact(recipe,ARRAY['version','id','serviceKey','currency','geography','effectiveOn','reviewBy','fields','steps','components','equipmentCostLines','applicability']) IS NOT TRUE OR recipe->>'version'<>'estimate-proposal-recipe-v1' OR recipe->>'currency' IS DISTINCT FROM currency_value OR octet_length(recipe::text)>65536 OR jsonb_array_length(recipe->'fields')>24 OR jsonb_array_length(recipe->'steps')>12 OR jsonb_array_length(recipe->'components')>5 OR jsonb_array_length(recipe->'equipmentCostLines')>12 OR jsonb_array_length(recipe->'applicability')>12 THEN RAISE EXCEPTION 'Recipe invalid' USING ERRCODE='22023';END IF;
 IF day_value<(recipe->>'effectiveOn')::date OR day_value>(recipe->>'reviewBy')::date OR scope_value->>'proposalGeography' IS DISTINCT FROM recipe->>'geography' THEN RAISE EXCEPTION 'Recipe date or area requires review' USING ERRCODE='40001';END IF;
 IF recipe->>'id'!~'^[a-z][a-zA-Z0-9_]{0,63}$' OR recipe->>'effectiveOn'!~'^\d{4}-\d{2}-\d{2}$' OR recipe->>'reviewBy'!~'^\d{4}-\d{2}-\d{2}$' OR (recipe->>'reviewBy')::date<(recipe->>'effectiveOn')::date THEN RAISE EXCEPTION 'Recipe identity or dates invalid' USING ERRCODE='22023';END IF;
 IF public.canonical_field_evidence_object_keys_exact(body#>'{request,draft}',ARRAY['version','selectedRevision','expectedBasisDigest','overrides','candidateIds']) IS NOT TRUE OR body#>>'{request,draft,version}' IS DISTINCT FROM 'estimate-proposal-preview-v1' OR body#>>'{request,draft,expectedBasisDigest}'!~'^[a-f0-9]{64}$' OR jsonb_typeof(body#>'{request,draft,overrides}') IS DISTINCT FROM 'array' OR jsonb_array_length(body#>'{request,draft,overrides}')>24 OR jsonb_typeof(body#>'{request,draft,candidateIds}') IS DISTINCT FROM 'array' OR jsonb_array_length(body#>'{request,draft,candidateIds}')>24 THEN RAISE EXCEPTION 'Draft request invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(body#>'{request,draft,overrides}') o WHERE public.canonical_field_evidence_object_keys_exact(o,ARRAY['fieldId','value','unit','sourceKind','reason']) IS NOT TRUE OR o->>'sourceKind' IS DISTINCT FROM 'owner_assumption' OR jsonb_typeof(o->'value') IS DISTINCT FROM 'string' OR jsonb_typeof(o->'unit') IS DISTINCT FROM 'string' OR length(btrim(o->>'reason')) NOT BETWEEN 1 AND 500 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'fields') f WHERE f->>'id'=o->>'fieldId')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(body#>'{request,draft,overrides}') o GROUP BY o->>'fieldId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Explicit unique owner inputs required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'fields') f WHERE public.canonical_field_evidence_object_keys_exact(f,ARRAY['id','label','type','unit','allowedValues','question','why']) IS NOT TRUE OR f->>'id'!~'^[a-z][a-zA-Z0-9_]{0,63}$' OR jsonb_typeof(f->'unit') IS DISTINCT FROM 'string' OR f->>'type' NOT IN('quantity','category') OR (f->>'type'='category' AND f->>'unit' IS DISTINCT FROM 'category') OR (f->>'type'='quantity' AND f->'allowedValues' IS DISTINCT FROM 'null'::jsonb) OR (f->>'type'='category' AND (jsonb_typeof(f->'allowedValues') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'allowedValues') NOT BETWEEN 1 AND 12))) THEN RAISE EXCEPTION 'Recipe fields invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'steps') v WHERE public.canonical_field_evidence_object_keys_exact(v,ARRAY['id','op','unit','args','fieldId','value']) IS NOT TRUE OR v->>'id'!~'^[a-z][a-zA-Z0-9_]{0,63}$' OR jsonb_typeof(v->'unit') IS DISTINCT FROM 'string' OR length(v->>'unit') NOT BETWEEN 1 AND 80 OR jsonb_typeof(v->'args') IS DISTINCT FROM 'array' OR (v->>'op'='input' AND v->'value' IS DISTINCT FROM 'null'::jsonb) OR (v->>'op'<>'input' AND v->'fieldId' IS DISTINCT FROM 'null'::jsonb) OR (v->>'op' NOT IN('input','constant') AND v->'value' IS DISTINCT FROM 'null'::jsonb)) THEN RAISE EXCEPTION 'Recipe steps invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'components') c WHERE public.canonical_field_evidence_object_keys_exact(c,ARRAY['kind','version','inputs','bindings']) IS NOT TRUE OR jsonb_typeof(c->'inputs') IS DISTINCT FROM 'object' OR jsonb_typeof(c->'bindings') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'bindings')>64 OR (c->>'kind'<>'materials' AND c#>>'{inputs,serviceKey}' IS DISTINCT FROM service_value)) OR (SELECT COALESCE(sum(CASE WHEN jsonb_typeof(c#>'{inputs,lines}')='array' THEN jsonb_array_length(c#>'{inputs,lines}') ELSE 1 END),0) FROM jsonb_array_elements(recipe->'components') c)>64 THEN RAISE EXCEPTION 'Bounded same-service components required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'components') c CROSS JOIN LATERAL jsonb_array_elements(c->'bindings') bind_rule WHERE public.canonical_field_evidence_object_keys_exact(bind_rule,ARRAY['line','field','step']) IS NOT TRUE OR (bind_rule->'line'<>'null'::jsonb AND (jsonb_typeof(bind_rule->'line') IS DISTINCT FROM 'number' OR bind_rule->>'line'!~'^(0|[1-9]|1[0-9])$')) OR bind_rule->>'field'!~'^[a-z][a-zA-Z0-9]{0,63}$') THEN RAISE EXCEPTION 'Bounded recipe bindings required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'applicability') ap_rule WHERE public.canonical_field_evidence_object_keys_exact(ap_rule,ARRAY['fieldId','value','question']) IS NOT TRUE OR ap_rule->>'fieldId'!~'^[a-z][a-zA-Z0-9_]{0,63}$' OR jsonb_typeof(ap_rule->'value') NOT IN('string','boolean')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'applicability') ap_rule GROUP BY ap_rule->>'fieldId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Unique typed applicability required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(recipe->'fields') f WHERE f->>'type'='category' AND (EXISTS(SELECT 1 FROM jsonb_array_elements(f->'allowedValues') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string') OR (SELECT count(*)<>count(DISTINCT v) FROM jsonb_array_elements(f->'allowedValues') v))) THEN RAISE EXCEPTION 'Explicit unique category values required' USING ERRCODE='22023';END IF;
 -- Non-collected recorded facts cannot become authoritative inputs by name.
 FOR field_id IN SELECT f.fact_type FROM public.canonical_facts f JOIN public.canonical_estimates e ON e.organization_id=f.organization_id AND e.graph_id=f.graph_id WHERE e.organization_id=org AND e.id=estimate AND COALESCE(f.value->>'status','collected')<>'collected' LOOP scope_value:=scope_value-field_id;END LOOP;
 FOR field_value IN SELECT value FROM jsonb_array_elements(recipe->'fields') LOOP
  field_id:=field_value->>'id';IF field_id IS NULL OR field_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate recipe field' USING ERRCODE='22023';END IF;seen:=array_append(seen,field_id);
  IF field_value->>'type'='quantity' AND EXISTS(SELECT 1 FROM unnest(string_to_array(field_value->>'unit','/')) u WHERE u NOT IN('1','ft','ft2','ft3','m','m2','m3','yd3','ea','kg','lb','hour','worker_hour','mile','USD','CAD','EUR')) OR field_value->>'type'='quantity' AND cardinality(string_to_array(field_value->>'unit','/')) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'Field unit invalid' USING ERRCODE='22023';END IF;
  value_json:=scope_value->field_id;
  SELECT value INTO override_value FROM jsonb_array_elements(body#>'{request,draft,overrides}') WHERE value->>'fieldId'=field_id;
  IF override_value IS NOT NULL THEN value_json:=jsonb_build_object('value',override_value->'value','unit',override_value->'unit');END IF;
  IF value_json IS NULL OR value_json='null'::jsonb THEN CONTINUE;END IF;
  IF field_value->>'type'='category' THEN
   IF override_value IS NULL THEN value_json:=jsonb_build_object('value',value_json,'unit','category');END IF;
   IF value_json->>'unit' IS DISTINCT FROM 'category' OR NOT field_value->'allowedValues' @> jsonb_build_array(value_json->'value') THEN RAISE EXCEPTION 'Recipe category requires confirmation' USING ERRCODE='22023';END IF;
  ELSIF field_value->>'type'='quantity' THEN
   IF jsonb_typeof(value_json)<>'object' OR jsonb_typeof(value_json->'value') IS DISTINCT FROM 'string' OR value_json->>'value'!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' OR (CASE WHEN split_part(value_json->>'unit','/',1)=split_part(value_json->>'unit','/',2) THEN '1' ELSE regexp_replace(value_json->>'unit','/1$','') END) IS DISTINCT FROM (CASE WHEN split_part(field_value->>'unit','/',1)=split_part(field_value->>'unit','/',2) THEN '1' ELSE regexp_replace(field_value->>'unit','/1$','') END) THEN RAISE EXCEPTION 'Typed quantity required' USING ERRCODE='22023';END IF;
  ELSE RAISE EXCEPTION 'Recipe field invalid' USING ERRCODE='22023';END IF;
  facts:=facts||jsonb_build_object(field_id,value_json);
 END LOOP;
 FOR field_value IN SELECT value FROM jsonb_array_elements(recipe->'applicability') LOOP
  value_json:=COALESCE(facts->(field_value->>'fieldId')->'value',scope_value->(field_value->>'fieldId'));
  IF value_json IS DISTINCT FROM field_value->'value' THEN RAISE EXCEPTION 'Recipe applicability requires review' USING ERRCODE='22023';END IF;
 END LOOP;
 FOR step_value IN SELECT value FROM jsonb_array_elements(recipe->'steps') LOOP
  field_id:=step_value->>'id';kind:=step_value->>'op';unit_value:=step_value->>'unit';
  IF field_id IS NULL OR field_id=ANY(ids) OR kind IS NULL OR kind NOT IN('input','constant','sum','product','ratio','ceil') THEN RAISE EXCEPTION 'Recipe step invalid' USING ERRCODE='22023';END IF;
  dimensions:='{}';
  FOR part,index_value IN SELECT v,i::integer FROM unnest(string_to_array(unit_value,'/')) WITH ORDINALITY t(v,i) LOOP
   IF index_value>2 OR part NOT IN('1','ft','ft2','ft3','m','m2','m3','yd3','ea','kg','lb','hour','worker_hour','mile','USD','CAD','EUR') THEN RAISE EXCEPTION 'Recipe unit invalid' USING ERRCODE='22023';END IF;
   IF part<>'1' THEN dimensions:=jsonb_set(dimensions,ARRAY[part],to_jsonb(COALESCE((dimensions->>part)::integer,0)+CASE WHEN index_value=1 THEN 1 ELSE -1 END));END IF;
  END LOOP;
  SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO dimensions FROM jsonb_each(dimensions) WHERE value<>'0'::jsonb;
  IF kind IN('input','constant') THEN
   IF jsonb_array_length(step_value->'args')<>0 THEN RAISE EXCEPTION 'Recipe arguments invalid' USING ERRCODE='22023';END IF;
   decimal_value:=CASE WHEN kind='input' THEN facts->(step_value->>'fieldId')->>'value' ELSE step_value->>'value' END;
   IF decimal_value IS NULL OR decimal_value!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'Recipe quantity missing' USING ERRCODE='22023';END IF;
   IF kind='input' AND (CASE WHEN split_part(facts->(step_value->>'fieldId')->>'unit','/',1)=split_part(facts->(step_value->>'fieldId')->>'unit','/',2) THEN '1' ELSE regexp_replace(facts->(step_value->>'fieldId')->>'unit','/1$','') END) IS DISTINCT FROM (CASE WHEN split_part(unit_value,'/',1)=split_part(unit_value,'/',2) THEN '1' ELSE regexp_replace(unit_value,'/1$','') END) THEN RAISE EXCEPTION 'Recipe input unit mismatch' USING ERRCODE='22023';END IF;
   n:=replace(decimal_value,'.','')::numeric;d:=power(10::numeric,length(split_part(decimal_value,'.',2)));
  ELSE
   IF jsonb_array_length(step_value->'args') NOT BETWEEN 1 AND 12 OR kind IN('product','ratio') AND jsonb_array_length(step_value->'args')<>2 OR kind='ceil' AND jsonb_array_length(step_value->'args')<>1 THEN RAISE EXCEPTION 'Recipe arguments invalid' USING ERRCODE='22023';END IF;
   j:=0;target_dims:='{}';n:=NULL;d:=NULL;
   FOR arg IN SELECT value FROM jsonb_array_elements(step_value->'args') LOOP
    key_value:=arg#>>'{}';IF NOT key_value=ANY(ids) THEN RAISE EXCEPTION 'Recipe dependency invalid' USING ERRCODE='22023';END IF;
    an:=(values_map->key_value->>'n')::numeric;ad:=(values_map->key_value->>'d')::numeric;source_dims:=units_map->key_value;
    IF kind IN('sum','ceil') AND source_dims IS DISTINCT FROM dimensions THEN RAISE EXCEPTION 'Recipe unit mismatch' USING ERRCODE='22023';END IF;
    IF j=0 THEN n:=an;d:=ad;target_dims:=source_dims;
    ELSE
     IF kind='sum' THEN n:=n*ad+an*d;d:=d*ad;ELSIF kind='product' THEN n:=n*an;d:=d*ad;ELSE n:=n*ad;d:=d*an;END IF;
     IF kind IN('product','ratio') THEN FOR key_value,value_json IN SELECT key,value FROM jsonb_each(source_dims) LOOP target_dims:=jsonb_set(target_dims,ARRAY[key_value],to_jsonb(COALESCE((target_dims->>key_value)::integer,0)+(value_json#>>'{}')::integer*CASE WHEN kind='ratio' THEN -1 ELSE 1 END));END LOOP;END IF;
    END IF;j:=j+1;
   END LOOP;
   SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO target_dims FROM jsonb_each(target_dims) WHERE value<>'0'::jsonb;
   IF target_dims IS DISTINCT FROM dimensions OR d=0 THEN RAISE EXCEPTION 'Recipe dimension or divisor invalid' USING ERRCODE='22023';END IF;
   IF kind='ceil' THEN n:=div(n+d-1,d);d:=1;END IF;
  END IF;
  divisor:=gcd(n,d);n:=n/divisor;d:=d/divisor;
  IF length(trunc(n)::text)>90 OR length(trunc(d)::text)>90 THEN RAISE EXCEPTION 'Recipe bound exceeded' USING ERRCODE='22023';END IF;
  values_map:=values_map||jsonb_build_object(field_id,jsonb_build_object('n',n,'d',d));units_map:=units_map||jsonb_build_object(field_id,dimensions);ids:=array_append(ids,field_id);
 END LOOP;
 FOR component IN SELECT value FROM jsonb_array_elements(recipe->'components') LOOP
  kind:=component->>'kind';inputs_value:=component->'inputs';
  IF result?kind OR kind NOT IN('materials','labor','equipment','travel','pricing') THEN RAISE EXCEPTION 'Recipe component invalid' USING ERRCODE='22023';END IF;
  allowed:=CASE kind WHEN 'materials' THEN ARRAY['quantity','wastePercent','unitPrice'] WHEN 'labor' THEN ARRAY['workerHours','elapsedHours','quantity','hoursPerUnit','hourlyCost','burdenPercent'] WHEN 'pricing' THEN ARRAY['quantity','rate','amount'] ELSE ARRAY[]::text[] END;
  FOR binding IN SELECT value FROM jsonb_array_elements(component->'bindings') LOOP
   field_id:=binding->>'field';IF NOT field_id=ANY(allowed) OR NOT (binding->>'step')=ANY(ids) THEN RAISE EXCEPTION 'Recipe binding invalid' USING ERRCODE='22023';END IF;
   path_value:=CASE WHEN binding->'line'='null'::jsonb THEN ARRAY[]::text[] ELSE ARRAY['lines',binding->>'line'] END;
   row_target:=CASE WHEN cardinality(path_value)=0 THEN inputs_value ELSE inputs_value#>path_value END;
   IF row_target IS NULL OR NOT row_target?field_id THEN RAISE EXCEPTION 'Recipe line unavailable' USING ERRCODE='22023';END IF;
   expected:=CASE field_id WHEN 'wastePercent' THEN '1' WHEN 'burdenPercent' THEN '1' WHEN 'workerHours' THEN 'worker_hour' WHEN 'elapsedHours' THEN 'hour' WHEN 'unitPrice' THEN currency_value||'/'||(row_target->>'unit') WHEN 'rate' THEN currency_value||'/'||(row_target->>'unit') WHEN 'hourlyCost' THEN currency_value||'/hour' WHEN 'amount' THEN currency_value WHEN 'hoursPerUnit' THEN 'worker_hour/'||(row_target->>'unit') ELSE row_target->>'unit' END;
   target_dims:='{}';FOR part,index_value IN SELECT v,i::integer FROM unnest(string_to_array(expected,'/')) WITH ORDINALITY t(v,i) LOOP IF part<>'1' THEN target_dims:=jsonb_set(target_dims,ARRAY[part],to_jsonb(COALESCE((target_dims->>part)::integer,0)+CASE WHEN index_value=1 THEN 1 ELSE -1 END));END IF;END LOOP;
   SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO target_dims FROM jsonb_each(target_dims) WHERE value<>'0'::jsonb;
   IF expected IS NULL OR target_dims IS DISTINCT FROM units_map->(binding->>'step') THEN RAISE EXCEPTION 'Recipe monetary or quantity unit mismatch' USING ERRCODE='22023';END IF;
   n:=(values_map->(binding->>'step')->>'n')::numeric;d:=(values_map->(binding->>'step')->>'d')::numeric;
   IF mod(n*1000000,d)<>0 THEN RAISE EXCEPTION 'Explicit recipe rounding required' USING ERRCODE='22023';END IF;
   decimal_value:=trim_scale(n/d)::text;
   IF field_id IN('unitPrice','hourlyCost','amount') THEN IF mod(n*100,d)<>0 THEN RAISE EXCEPTION 'Explicit cost rounding required' USING ERRCODE='22023';END IF;decimal_value:=trunc(n/d)::text||'.'||lpad(mod(div(n*100,d),100)::text,2,'0');END IF;
   inputs_value:=jsonb_set(inputs_value,array_append(path_value,field_id),to_jsonb(decimal_value),FALSE);
  END LOOP;
  result:=result||jsonb_build_object(kind,jsonb_build_object('version',component->>'version','inputs',inputs_value));
 END LOOP;
 RETURN jsonb_build_object('components',result,'equipmentCostLines',recipe->'equipmentCostLines','recipePin',body->'recipePin');
END $$;
REVOKE ALL ON FUNCTION public.canonical_proposal_adoption_envelope_require(uuid,uuid,text,uuid,uuid,jsonb,timestamptz) FROM PUBLIC;


CREATE FUNCTION public.canonical_proposal_adoption_child_insert(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,body JSONB) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; original JSONB; snapshot_value JSONB; service_key TEXT; currency_value TEXT;
 current_row public.canonical_estimate_revisions%ROWTYPE; inserted public.canonical_estimate_revisions%ROWTYPE; decision_row public.canonical_estimate_decisions%ROWTYPE;
 mp public.canonical_material_plans%ROWTYPE; lp public.canonical_labor_plans%ROWTYPE; ep public.canonical_equipment_cost_plans%ROWTYPE; tp public.canonical_travel_plans%ROWTYPE;
 m JSONB;l JSONB;e JSONB;t JSONB;manifest JSONB;current_manifest JSONB;assessment_value JSONB;plan JSONB;kind TEXT;pin JSONB;
 fingerprint TEXT;key_hash TEXT;request_hash TEXT;actor_label TEXT;next_revision BIGINT;travel_sources JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Protected adoption transaction required' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT currency INTO currency_value FROM public.canonical_estimates WHERE organization_id=org AND id=estimate FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 PERFORM public.canonical_travel_fence(org,estimate);
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 original:=public.canonical_estimate_revision_original_source(org,estimate);source_value:=public.canonical_estimate_decision_source(org,estimate);
 SELECT * INTO current_row FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 current_manifest:=public.canonical_estimate_revision_components_v3(current_row);
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF body->'sourcePins' IS DISTINCT FROM source_value OR body->'expectedComponents' IS DISTINCT FROM current_manifest OR body->'decisionBasis' IS DISTINCT FROM jsonb_build_object('revision',COALESCE(decision_row.revision,0),'digest',COALESCE(decision_row.digest,'none')) THEN RAISE EXCEPTION 'Estimate changed' USING ERRCODE='40001';END IF;
 SELECT snapshot,snapshot->'service'->>'key' INTO snapshot_value,service_key FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;
 SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate AND id=(body#>>'{plans,material,id}')::uuid;
 SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate AND id=(body#>>'{plans,labor,id}')::uuid;
 SELECT * INTO ep FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate AND id=(body#>>'{plans,equipment,id}')::uuid;
 SELECT * INTO tp FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate AND id=(body#>>'{plans,travel,id}')::uuid;
 m:=CASE WHEN mp.id IS NOT NULL THEN public.canonical_material_plan_projection(mp) END;
 l:=CASE WHEN lp.id IS NOT NULL THEN public.canonical_labor_plan_projection(lp) END;
 e:=CASE WHEN ep.id IS NOT NULL THEN public.canonical_equipment_cost_projection(ep) END;
 t:=CASE WHEN tp.id IS NOT NULL THEN public.canonical_travel_plan_projection(tp) END;
 manifest:=jsonb_build_object('material',public.canonical_estimate_revision_plan_reference(m),'labor',public.canonical_estimate_revision_plan_reference(l),'equipment',public.canonical_estimate_revision_equipment_reference(e),'travel',public.canonical_estimate_revision_plan_reference(t));
 IF manifest IS DISTINCT FROM body->'plans' OR manifest IS NOT DISTINCT FROM current_manifest THEN RAISE EXCEPTION 'Reviewed components changed or already included' USING ERRCODE='40001';END IF;
 FOREACH kind IN ARRAY ARRAY['material','labor','equipment','travel'] LOOP
  plan:=CASE kind WHEN 'material' THEN m WHEN 'labor' THEN l WHEN 'equipment' THEN e ELSE t END;
  IF plan IS NULL THEN CONTINUE;END IF;
  IF plan->>'action'<>'save' OR plan->>'currency' IS DISTINCT FROM currency_value THEN RAISE EXCEPTION 'Cost component unavailable' USING ERRCODE='40001';END IF;
  IF manifest->kind IS DISTINCT FROM current_manifest->kind AND plan->'sourcePins' IS DISTINCT FROM source_value THEN RAISE EXCEPTION 'Replacement component has stale basis' USING ERRCODE='40001';END IF;
 END LOOP;
 IF mp.id IS NOT NULL THEN
  IF mp.calculation_version='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(mp.inputs,currency_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
  ELSIF mp.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(mp.inputs,currency_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
  ELSIF mp.calculation_version='estimate-material-plan-v2' THEN PERFORM public.canonical_material_plan_validate_v2(mp.inputs);ELSE PERFORM public.canonical_material_plan_validate(mp.inputs);END IF;
 END IF;
 IF lp.id IS NOT NULL THEN
  PERFORM public.canonical_labor_plan_validate(lp.inputs);
  IF lp.inputs->>'serviceKey' IS DISTINCT FROM service_key OR EXISTS(SELECT 1 FROM jsonb_array_elements(lp.inputs->'lines') v WHERE v->'hourlyCost'='null'::jsonb OR(v->>'rateMode'='base_burden' AND v->'burdenPercent'='null'::jsonb)) THEN RAISE EXCEPTION 'Complete applicable labor required' USING ERRCODE='22023';END IF;
 END IF;
 IF ep.id IS NOT NULL THEN PERFORM public.canonical_equipment_cost_adoption_require(org,actor,role_value,session_value,estimate,ep.inputs);END IF;
 IF tp.id IS NOT NULL THEN
  travel_sources:=public.canonical_travel_plan_sources(org,actor,role_value,session_value,estimate);
  IF tp.inputs->>'serviceKey' IS DISTINCT FROM service_key OR
    (CASE WHEN manifest->'travel'=current_manifest->'travel' THEN (travel_sources-'digest'-'resourceChoices') IS DISTINCT FROM (tp.evidence-'digest'-'resourceChoices') ELSE travel_sources->>'digest' IS DISTINCT FROM tp.evidence->>'digest' END)
  THEN RAISE EXCEPTION 'Travel sources changed' USING ERRCODE='40001';END IF;
  -- Retained receipts keep their historical choice inventory. Only actual bound
  -- resources are authority; every binding must still resolve in current choices.
  PERFORM public.canonical_travel_resource_require(tp.inputs,travel_sources);
 END IF;
 PERFORM public.canonical_travel_coverage_require(manifest,l,e,t,snapshot_value,body->'coverage');
 assessment_value:=public.canonical_estimate_revision_cost_assessment_v3(m,l,e,t,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date);
 IF assessment_value IS DISTINCT FROM body->'assessment' THEN RAISE EXCEPTION 'Component source review changed' USING ERRCODE='40001';END IF;
 next_revision:=COALESCE(current_row.revision,1)+1;IF next_revision>10000 THEN RAISE EXCEPTION 'Estimate history limit' USING ERRCODE='54000';END IF;
 fingerprint:=public.canonical_completion_digest(jsonb_build_object('original',original,'parent',source_value,'components',manifest,'coverage',body->'coverage','calculationVersion','estimate-cost-adoption-v3'));
 key_hash:=encode(sha256(convert_to(body->>'key','UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 IF body->>'key'!~'^[A-Za-z0-9._:-]{16,128}$' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Aggregate review invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_estimate_revisions(organization_id,estimate_id,revision,previous_id,material_plan_id,labor_plan_id,equipment_cost_plan_id,travel_plan_id,coverage_assessment,changed_component,component_manifest,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,original_source_pins,expected_decision_revision,expected_decision_digest,calculation_version,input_fingerprint,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,mp.id,lp.id,ep.id,tp.id,body->'coverage','prepared',manifest,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,original,COALESCE(decision_row.revision,0),COALESCE(decision_row.digest,'none'),'estimate-cost-adoption-v3',fingerprint,btrim(body->>'reason'),'estimate-cost-adoption-v3',key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'inputFingerprint',fingerprint,'body',body))) RETURNING * INTO inserted;
 IF (body->>'expiresAt')::timestamptz<=clock_timestamp() OR body->'assessment' IS DISTINCT FROM public.canonical_estimate_revision_cost_assessment_v3(m,l,e,t,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date) THEN RAISE EXCEPTION 'Aggregate review expired or changed' USING ERRCODE='40001';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 RETURN public.canonical_estimate_revision_projection(inserted);
END $$;
REVOKE ALL ON FUNCTION public.canonical_proposal_adoption_child_insert(uuid,uuid,text,uuid,uuid,text,jsonb) FROM PUBLIC;

CREATE FUNCTION public.canonical_proposal_adoption_projection(d public.canonical_estimate_proposal_adoptions) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'previousId',d.previous_id,'digest',d.digest,'version',d.version,'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'originalSourcePins',d.original_source_pins,'childId',d.child_id,'parentId',d.parent_id,'componentManifest',d.component_manifest,'pricingPlanId',d.pricing_plan_id,'pricingPolicyId',d.pricing_policy_id)
$$;
REVOKE ALL ON FUNCTION public.canonical_proposal_adoption_projection(public.canonical_estimate_proposal_adoptions) FROM PUBLIC;

CREATE FUNCTION public.canonical_proposal_adoption_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB;current_value JSONB;total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_estimate_decision_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 SELECT count(*) INTO total FROM public.canonical_estimate_proposal_adoptions WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_proposal_adoption_projection(d) INTO current_value FROM public.canonical_estimate_proposal_adoptions d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_proposal_adoption_projection(d) ORDER BY revision DESC),'[]') INTO history FROM(SELECT * FROM public.canonical_estimate_proposal_adoptions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20)d;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
REVOKE ALL ON FUNCTION public.canonical_proposal_adoption_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;


CREATE FUNCTION public.canonical_proposal_adoption_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_value JSONB:=body->'request';authority JSONB;source_value JSONB;original JSONB;bound JSONB;writes JSONB:=body->'writes';
 old public.canonical_estimate_proposal_adoptions%ROWTYPE; prior public.canonical_estimate_proposal_adoptions%ROWTYPE; inserted public.canonical_estimate_proposal_adoptions%ROWTYPE;
 parent public.canonical_estimate_revisions%ROWTYPE; child JSONB; plans JSONB; receipts JSONB:='{}';write_value JSONB;expected_inputs JSONB;actual_inputs JSONB;entry JSONB;kind TEXT;subkey TEXT;asset UUID;
 currency_value TEXT;key_hash TEXT;request_hash TEXT;actor_label TEXT;next_revision BIGINT;deadline TIMESTAMPTZ;at_value TIMESTAMPTZ;policy_source JSONB;pricing_source JSONB;decision_value JSONB;coverage JSONB;assessment JSONB;snapshot_value JSONB;overhead_row JSONB;overhead_rows JSONB;reference_text TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Protected adoption transaction required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT currency INTO currency_value FROM public.canonical_estimates WHERE organization_id=org AND id=estimate FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 PERFORM public.canonical_travel_fence(org,estimate);
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>262144 OR octet_length(request_value::text)>131072 OR request_value->>'version' IS DISTINCT FROM 'estimate-proposal-adoption-v1' OR request_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR public.canonical_field_evidence_object_keys_exact(request_value,ARRAY['version','draft','selection','previousReceipt','coverage','pricingPolicy','expectedReviewDigest','confirmed','reason']) IS NOT TRUE OR length(btrim(request_value->>'reason')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Aggregate confirmation invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',request_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':proposal-adoption:'||key_hash,0));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_estimate_proposal_adoptions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF old.estimate_id<>estimate OR old.request_digest IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'Aggregate key conflict' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('receipt',public.canonical_proposal_adoption_projection(old),'replayed',TRUE);END IF;
 IF body->'replayOnly'='true'::jsonb THEN RETURN jsonb_build_object('replayed',FALSE);END IF;
 source_value:=public.canonical_estimate_decision_source(org,estimate);original:=public.canonical_estimate_revision_original_source(org,estimate);
 IF source_value IS DISTINCT FROM body->'sourcePins' THEN RAISE EXCEPTION 'Selected estimate changed' USING ERRCODE='40001';END IF;
 SELECT * INTO prior FROM public.canonical_estimate_proposal_adoptions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF request_value->'previousReceipt' IS DISTINCT FROM (CASE WHEN prior.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',prior.id,'revision',prior.revision,'digest',prior.digest) END) THEN RAISE EXCEPTION 'Aggregate history changed' USING ERRCODE='40001';END IF;
 IF public.canonical_field_evidence_object_keys_exact(request_value->'selection',ARRAY['materials','labor','equipment','travel','pricing']) IS NOT TRUE OR EXISTS(SELECT 1 FROM jsonb_each_text(request_value->'selection') e WHERE e.value NOT IN('replace','retain')) OR NOT EXISTS(SELECT 1 FROM jsonb_each_text(request_value->'selection') e WHERE e.key<>'pricing' AND e.value='replace') OR public.canonical_field_evidence_object_keys_exact(request_value->'coverage',ARRAY['costs','overhead']) IS NOT TRUE THEN RAISE EXCEPTION 'Aggregate choices invalid' USING ERRCODE='22023';END IF;
 IF request_value->>'expectedReviewDigest'!~'^[a-f0-9]{64}$' OR request_value->>'expectedReviewDigest' IS DISTINCT FROM body#>>'{reviewResult,reviewDigest}' OR body#>>'{reviewResult,state}' IS DISTINCT FROM 'ready' OR body#>'{reviewResult,sourcePins}' IS DISTINCT FROM source_value OR body#>'{reviewResult,selection}' IS DISTINCT FROM request_value->'selection' THEN RAISE EXCEPTION 'Confirmed review differs' USING ERRCODE='40001';END IF;
 IF request_value->'pricingPolicy'<>'null'::jsonb THEN
  IF request_value#>>'{selection,pricing}' IS DISTINCT FROM 'replace' THEN RAISE EXCEPTION 'Policy requires reviewed pricing' USING ERRCODE='22023';END IF;
  policy_source:=public.canonical_pricing_policy_sources(org,actor,role_value,session_value,estimate,NULL);
  IF policy_source->>'digest' IS DISTINCT FROM request_value#>>'{pricingPolicy,sourceDigest}' THEN RAISE EXCEPTION 'Policy sources changed' USING ERRCODE='40001';END IF;
  SELECT jsonb_build_object('id',id,'revision',revision,'digest',digest) INTO entry FROM public.canonical_pricing_policy_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
  IF COALESCE(entry,'null'::jsonb) IS DISTINCT FROM request_value#>'{pricingPolicy,currentPin}' THEN RAISE EXCEPTION 'Policy history changed' USING ERRCODE='40001';END IF;
 END IF;
 next_revision:=COALESCE(prior.revision,0)+1;IF next_revision>10000 THEN RAISE EXCEPTION 'Aggregate history limit' USING ERRCODE='54000';END IF;
 at_value:=clock_timestamp();deadline:=to_timestamp((floor(extract(epoch FROM at_value)/300)+1)*300);
 IF (body->>'expiresAt')::timestamptz>deadline OR (body->>'expiresAt')::timestamptz<=at_value THEN RAISE EXCEPTION 'Aggregate review expired' USING ERRCODE='40001';END IF;deadline:=(body->>'expiresAt')::timestamptz;
 SELECT * INTO parent FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 plans:=public.canonical_estimate_revision_components_v3(parent);
 bound:=public.canonical_proposal_adoption_envelope_require(org,actor,role_value,session_value,estimate,body,at_value);
 -- Asset identities come from current authorized sources and recipe, never a caller lock list.
 FOR asset IN SELECT DISTINCT (v->>'assetId')::uuid FROM (
  SELECT value v FROM jsonb_array_elements(COALESCE(bound#>'{components,equipment,inputs,lines}','[]'))
  UNION ALL SELECT value FROM public.canonical_equipment_plans ep CROSS JOIN LATERAL jsonb_array_elements(ep.inputs->'lines') WHERE ep.organization_id=org AND ep.estimate_id=estimate AND ep.action='save' AND (ep.id=(SELECT id FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1) OR ep.id=(SELECT (inputs#>>'{equipmentBasis,planId}')::uuid FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate AND id=parent.equipment_cost_plan_id))
 ) all_assets WHERE v->>'assetId' IS NOT NULL ORDER BY 1 LOOP
  PERFORM public.canonical_equipment_readiness_fence(org,asset);
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 END LOOP;
 IF deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Aggregate review expired after wait' USING ERRCODE='40001';END IF;
 IF bound IS DISTINCT FROM public.canonical_proposal_adoption_envelope_require(org,actor,role_value,session_value,estimate,body,clock_timestamp()) THEN RAISE EXCEPTION 'Recipe changed after wait' USING ERRCODE='40001';END IF;
 FOREACH kind IN ARRAY ARRAY['materials','labor','equipment','equipmentCost','travel'] LOOP
  IF kind='equipmentCost' THEN IF request_value#>>'{selection,equipment}'<>'replace' THEN CONTINUE;END IF;
  ELSIF request_value->'selection'->>kind='retain' THEN CONTINUE;
  ELSIF request_value->'selection'->>kind IS DISTINCT FROM 'replace' THEN RAISE EXCEPTION 'Component selection invalid' USING ERRCODE='22023';END IF;
  write_value:=writes->kind;expected_inputs:=bound->'components'->kind->'inputs';actual_inputs:=write_value->'inputs';
  IF kind='equipmentCost' THEN
   expected_inputs:=jsonb_build_object('serviceKey',bound#>'{components,equipment,inputs,serviceKey}','lines',bound->'equipmentCostLines');
   IF actual_inputs-ARRAY['assessment','equipmentBasis'] IS DISTINCT FROM expected_inputs THEN RAISE EXCEPTION 'Equipment costs do not match recipe' USING ERRCODE='22023';END IF;
   actual_inputs:=jsonb_set(actual_inputs,'{equipmentBasis}',jsonb_build_object('planId',receipts#>'{equipment,id}','revision',receipts#>'{equipment,revision}','digest',receipts#>'{equipment,digest}','sourcePins',source_value));write_value:=jsonb_set(write_value,'{inputs}',actual_inputs);
  ELSIF actual_inputs-'assessment' IS DISTINCT FROM expected_inputs-'assessment' THEN RAISE EXCEPTION 'Component inputs do not match reviewed recipe' USING ERRCODE='22023';END IF;
  IF write_value->'sourcePins' IS DISTINCT FROM source_value OR write_value->>'action'<>'save' OR write_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR write_value->>'currency' IS DISTINCT FROM currency_value THEN RAISE EXCEPTION 'Component review invalid' USING ERRCODE='22023';END IF;
  -- Our preceding labor/equipment receipts change travel's resource-choice digest.
  -- All source content and explicit bindings still pass the existing require;
  -- only this server-derived digest is rebound within the locked aggregate.
  IF kind='travel' THEN
   entry:=public.canonical_travel_plan_sources(org,actor,role_value,session_value,estimate);
   write_value:=jsonb_set(write_value,'{inputs,assessment,sourcesDigest}',entry->'digest');
  END IF;
  subkey:='proposal:'||key_hash||':'||kind;
  IF kind='materials' THEN entry:=public.canonical_material_plan_mutate(org,actor,role_value,session_value,estimate,csrf,subkey,write_value);
  ELSIF kind='labor' THEN entry:=public.canonical_labor_plan_mutate(org,actor,role_value,session_value,estimate,csrf,subkey,write_value);
  ELSIF kind='equipment' THEN entry:=public.canonical_equipment_plan_mutate(org,actor,role_value,session_value,estimate,csrf,subkey,write_value);
  ELSIF kind='equipmentCost' THEN entry:=public.canonical_equipment_cost_mutate(org,actor,role_value,session_value,estimate,csrf,subkey,write_value);
  ELSE entry:=public.canonical_travel_plan_mutate(org,actor,role_value,session_value,estimate,csrf,subkey,write_value);END IF;
  IF entry->'replayed'='true'::jsonb THEN RAISE EXCEPTION 'Unexpected orphan component retry' USING ERRCODE='40001';END IF;
  receipts:=receipts||jsonb_build_object(kind,entry->'receipt');
  IF kind<>'equipment' THEN plans:=jsonb_set(plans,ARRAY[CASE kind WHEN 'materials' THEN 'material' WHEN 'equipmentCost' THEN 'equipment' ELSE kind END],CASE WHEN kind='equipmentCost' THEN public.canonical_estimate_revision_equipment_reference(entry->'receipt') ELSE public.canonical_estimate_revision_plan_reference(entry->'receipt') END);END IF;
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  IF deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Aggregate review expired' USING ERRCODE='40001';END IF;
 END LOOP;
 -- One child only. Coverage line identifiers are unchanged; durable plan pins replace draft pins.
 coverage:=jsonb_set(request_value#>'{coverage,costs}','{componentManifest}',plans,TRUE);
 SELECT snapshot INTO snapshot_value FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_estimate_revision_cost_assessment_v3(
  (SELECT public.canonical_material_plan_projection(x) FROM public.canonical_material_plans x WHERE x.organization_id=org AND x.estimate_id=estimate AND x.id=(plans#>>'{material,id}')::uuid),
  (SELECT public.canonical_labor_plan_projection(x) FROM public.canonical_labor_plans x WHERE x.organization_id=org AND x.estimate_id=estimate AND x.id=(plans#>>'{labor,id}')::uuid),
  (SELECT public.canonical_equipment_cost_projection(x) FROM public.canonical_equipment_cost_plans x WHERE x.organization_id=org AND x.estimate_id=estimate AND x.id=(plans#>>'{equipment,id}')::uuid),
  (SELECT public.canonical_travel_plan_projection(x) FROM public.canonical_travel_plans x WHERE x.organization_id=org AND x.estimate_id=estimate AND x.id=(plans#>>'{travel,id}')::uuid),snapshot_value#>>'{service,key}',(clock_timestamp() AT TIME ZONE 'UTC')::date) INTO assessment;
 child:=public.canonical_proposal_adoption_child_insert(org,actor,role_value,session_value,estimate,csrf,jsonb_build_object('sourcePins',source_value,'expectedComponents',public.canonical_estimate_revision_components_v3(parent),'decisionBasis',body->'decisionBasis','plans',plans,'coverage',coverage,'assessment',assessment,'key','proposal:'||key_hash||':child','reason',request_value->'reason','expiresAt',deadline));
 IF request_value#>>'{selection,pricing}'='replace' THEN
  write_value:=writes->'pricing';expected_inputs:=bound#>'{components,pricing,inputs}';expected_inputs:=jsonb_set(expected_inputs,'{overhead,coverage}',request_value#>'{coverage,overhead}');
  IF write_value->'inputs' IS DISTINCT FROM expected_inputs THEN RAISE EXCEPTION 'Pricing differs from recipe and reviewed overhead' USING ERRCODE='22023';END IF;
  overhead_rows:='[]'::jsonb;
  FOR overhead_row IN SELECT value FROM jsonb_array_elements(write_value#>'{inputs,overhead,coverage,included}') LOOP
   reference_text:=overhead_row->>'referenceId';
   IF left(reference_text,15)='labor:prepared:' THEN
    IF request_value#>>'{selection,labor}' IS DISTINCT FROM 'replace' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipts#>'{labor,inputs,lines}') line WHERE line->>'lineId'=substring(reference_text FROM 16)) THEN RAISE EXCEPTION 'Exact proposed labor allocation required' USING ERRCODE='22023';END IF;
    overhead_row:=jsonb_set(overhead_row,'{referenceId}',to_jsonb('labor:'||(receipts#>>'{labor,id}')||':'||substring(reference_text FROM 16)));
   END IF;
   overhead_rows:=overhead_rows||jsonb_build_array(overhead_row);
  END LOOP;
  write_value:=jsonb_set(write_value,'{inputs,overhead,coverage,included}',overhead_rows);
  pricing_source:=public.canonical_pricing_sources(org,actor,role_value,session_value,estimate,NULL);
  write_value:=write_value||jsonb_build_object('sourcePins',public.canonical_estimate_decision_source(org,estimate),'evidenceDigest',pricing_source->'digest');
  entry:=public.canonical_pricing_plan_mutate(org,actor,role_value,session_value,estimate,csrf,'proposal:'||key_hash||':pricing',write_value);receipts:=receipts||jsonb_build_object('pricing',entry->'receipt');
  IF entry#>'{receipt,result,costWithOverhead}' IS NULL OR entry#>'{receipt,result,costWithOverhead}'='null'::jsonb OR entry#>'{receipt,result,proposedBeforeTax}' IS NULL OR entry#>'{receipt,result,proposedBeforeTax}'='null'::jsonb THEN RAISE EXCEPTION 'Complete reviewed pricing required' USING ERRCODE='22023';END IF;
  IF request_value->'pricingPolicy'<>'null'::jsonb THEN
   policy_source:=public.canonical_pricing_policy_sources(org,actor,role_value,session_value,estimate,NULL);write_value:=writes->'pricingPolicy';
   IF write_value->'inputs' IS DISTINCT FROM request_value#>'{pricingPolicy,inputs}' THEN RAISE EXCEPTION 'Policy differs from explicit review' USING ERRCODE='22023';END IF;
   write_value:=write_value||jsonb_build_object('sourcePins',public.canonical_estimate_decision_source(org,estimate),'evidenceDigest',policy_source->'digest','pricingPin',policy_source->'pricingPin');
   entry:=public.canonical_pricing_policy_mutate(org,actor,role_value,session_value,estimate,csrf,'proposal:'||key_hash||':policy',write_value);receipts:=receipts||jsonb_build_object('pricingPolicy',entry->'receipt');
  END IF;
 END IF;
 pricing_source:=public.canonical_pricing_basis(org,estimate,NULL);
 IF pricing_source->'directCosts' IS NULL OR pricing_source->'directCosts'='null'::jsonb OR pricing_source->'directCosts' IS DISTINCT FROM body#>'{reviewResult,completeCost}' OR COALESCE(receipts#>'{pricing,result}','null'::jsonb) IS DISTINCT FROM body#>'{reviewResult,price}' OR COALESCE(receipts#>'{pricingPolicy,result}','null'::jsonb) IS DISTINCT FROM body#>'{reviewResult,policy}' THEN RAISE EXCEPTION 'Actual result differs from confirmed review' USING ERRCODE='40001';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Aggregate review expired before receipt' USING ERRCODE='40001';END IF;
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_estimate_proposal_adoptions(organization_id,estimate_id,revision,previous_id,actor_user_id,auth_session_id,actor_name,request_key_hash,request_digest,version,body,source_pins,original_source_pins,recipe_pin,component_manifest,child_id,parent_id,material_plan_id,labor_plan_id,equipment_plan_id,equipment_cost_plan_id,travel_plan_id,pricing_plan_id,pricing_policy_id,reviewed_result,expires_at,digest)
 VALUES(org,estimate,next_revision,prior.id,actor,session_value,COALESCE(actor_label,'Company reviewer'),key_hash,request_hash,'estimate-proposal-adoption-v1',request_value,source_value,original,body->'recipePin',plans,(child->>'id')::uuid,parent.id,(plans#>>'{material,id}')::uuid,(plans#>>'{labor,id}')::uuid,(receipts#>>'{equipment,id}')::uuid,(plans#>>'{equipment,id}')::uuid,(plans#>>'{travel,id}')::uuid,(receipts#>>'{pricing,id}')::uuid,(receipts#>>'{pricingPolicy,id}')::uuid,body->'reviewResult',deadline,public.canonical_completion_digest(jsonb_build_object('request',request_hash,'previous',prior.digest,'child',child->'digest','receipts',receipts))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_proposal_adoption_projection(inserted),'child',child,'components',receipts,'replayed',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_proposal_adoption_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
