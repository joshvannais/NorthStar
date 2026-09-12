-- Mission24 Part4 Slice2. Existing 65 applied migration files remain immutable.
CREATE FUNCTION public.canonical_equipment_cost_money(v JSONB) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF v='null'::jsonb THEN RETURN NULL;END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN RAISE EXCEPTION 'Equipment money invalid' USING ERRCODE='22023';END IF;
 RETURN (v#>>'{}')::numeric;
END $$;
CREATE FUNCTION public.canonical_equipment_cost_quantity(v JSONB) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF v='null'::jsonb THEN RETURN NULL;END IF;
 RETURN public.canonical_labor_plan_number(v,6,9);
END $$;
CREATE FUNCTION public.canonical_equipment_cost_charge(v JSONB) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE amount NUMERIC;part NUMERIC;total NUMERIC:=0;complete BOOLEAN:=TRUE;k TEXT;c JSONB;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['amount','scope','split']) IS NOT TRUE THEN RAISE EXCEPTION 'Equipment charge invalid' USING ERRCODE='22023';END IF;
 amount:=public.canonical_equipment_cost_money(v->'amount');
 IF v->>'scope'='equipment_only' THEN
  IF v->'split' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Equipment scope invalid' USING ERRCODE='22023';END IF;RETURN;
 END IF;
 IF v->>'scope' IS DISTINCT FROM 'mixed' OR public.canonical_field_evidence_object_keys_exact(v->'split',ARRAY['equipment','operator','travel','overhead','operatorCoverage','travelCoverage']) IS NOT TRUE THEN RAISE EXCEPTION 'Equipment allocation invalid' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['equipment','operator','travel','overhead'] LOOP
  part:=public.canonical_equipment_cost_money(v->'split'->k);IF part IS NULL THEN complete:=FALSE;ELSE total:=total+part;END IF;
 END LOOP;
 IF complete AND amount IS NOT NULL AND amount<>total THEN RAISE EXCEPTION 'Equipment allocation total invalid' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['operatorCoverage','travelCoverage'] LOOP
  c:=v->'split'->k;
  IF public.canonical_field_evidence_object_keys_exact(c,ARRAY['status','basis','note']) IS NOT TRUE OR COALESCE(c->>'status','') NOT IN ('covered','unaccounted','unknown') OR public.canonical_labor_plan_text(c->'note',500,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Outside coverage invalid' USING ERRCODE='22023';END IF;
  IF c->>'status'='covered' THEN
   IF jsonb_typeof(c->'basis') IS DISTINCT FROM 'object' OR public.canonical_labor_plan_text(c->'note',500) IS NOT TRUE THEN RAISE EXCEPTION 'Outside basis invalid' USING ERRCODE='22023';END IF;
  ELSIF c->'basis' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unconfirmed outside basis invalid' USING ERRCODE='22023';END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.canonical_equipment_cost_source_validate(v JSONB) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE k TEXT;d DATE;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['kind','issuer','reference','note','effectiveOn','endsOn','geography']) IS NOT TRUE OR COALESCE(v->>'kind','') NOT IN ('my_estimate','company_reference','published_reference') OR public.canonical_labor_plan_text(v->'issuer',160,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(v->'reference',300,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(v->'note',500,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(v->'geography',160,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Equipment cost source invalid' USING ERRCODE='22023';END IF;
 IF v->>'kind'<>'my_estimate' AND public.canonical_labor_plan_text(v->'issuer',160) IS NOT TRUE AND public.canonical_labor_plan_text(v->'reference',300) IS NOT TRUE THEN RAISE EXCEPTION 'Equipment reference missing' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['effectiveOn','endsOn'] LOOP
  IF v->k IS DISTINCT FROM 'null'::jsonb THEN
   IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR (v->>k)!~'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Equipment date invalid' USING ERRCODE='22023';END IF;
   BEGIN d:=(v->>k)::date;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Equipment date invalid' USING ERRCODE='22023';END;
   IF to_char(d,'YYYY-MM-DD')<>v->>k THEN RAISE EXCEPTION 'Equipment date invalid' USING ERRCODE='22023';END IF;
  END IF;
 END LOOP;
 IF v->>'effectiveOn' IS NOT NULL AND v->>'endsOn' IS NOT NULL AND v->>'endsOn'<v->>'effectiveOn' THEN RAISE EXCEPTION 'Equipment date order invalid' USING ERRCODE='22023';END IF;
END $$;
-- One symmetric structured rule for pool, separate period, operating and fee categories.
CREATE FUNCTION public.canonical_equipment_cost_categories_overlap(existing TEXT[],candidate TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT candidate=ANY(existing) OR (candidate='operating' AND existing&&ARRAY['fuel_energy','consumables','maintenance']) OR (candidate IN ('fuel_energy','consumables','maintenance') AND 'operating'=ANY(existing))
$$;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_categories_overlap(text[],text) FROM PUBLIC;
CREATE FUNCTION public.canonical_equipment_cost_validate(v JSONB) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;a JSONB;c JSONB;o JSONB;k TEXT;category TEXT;required TEXT;forbidden TEXT;ids TEXT[]:=ARRAY[]::TEXT[];categories TEXT[];q NUMERIC;minimum NUMERIC;hours NUMERIC;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['serviceKey','equipmentBasis','lines','assessment']) IS NOT TRUE OR public.canonical_labor_plan_text(v->'serviceKey',160) IS NOT TRUE OR public.canonical_field_evidence_object_keys_exact(v->'equipmentBasis',ARRAY['planId','revision','digest','sourcePins']) IS NOT TRUE OR jsonb_typeof(v->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Equipment cost plan invalid' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(v->'lines') NOT BETWEEN 1 AND 12 OR jsonb_typeof(v#>'{equipmentBasis,planId}') IS DISTINCT FROM 'string' OR (v#>>'{equipmentBasis,planId}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(v#>'{equipmentBasis,revision}') IS DISTINCT FROM 'number' OR (v#>>'{equipmentBasis,revision}')!~'^[1-9][0-9]{0,4}$' OR (v#>>'{equipmentBasis,revision}')::integer>10000 OR COALESCE(v#>>'{equipmentBasis,digest}','')!~'^[a-f0-9]{64}$' OR jsonb_typeof(v#>'{equipmentBasis,sourcePins}') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Equipment cost basis invalid' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','access','method','notApplicableReason','plannedHours','rental','allocation','operating','fees','source']) IS NOT TRUE OR jsonb_typeof(l->'lineId') IS DISTINCT FROM 'string' OR (l->>'lineId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR lower(l->>'lineId')=ANY(ids) OR COALESCE(l->>'access','') NOT IN ('owned','rented','financed','proposed','unknown') THEN RAISE EXCEPTION 'Equipment cost line invalid' USING ERRCODE='22023';END IF;
  ids:=array_append(ids,lower(l->>'lineId'));categories:=ARRAY[]::TEXT[];
  PERFORM public.canonical_equipment_cost_source_validate(l->'source');
  IF jsonb_typeof(l->'fees') IS DISTINCT FROM 'array' OR jsonb_array_length(l->'fees')>4 THEN RAISE EXCEPTION 'Equipment fees invalid' USING ERRCODE='22023';END IF;
  IF l->>'method'='not_applicable' THEN
   IF public.canonical_labor_plan_text(l->'notApplicableReason',500) IS NOT TRUE OR l->'plannedHours' IS DISTINCT FROM 'null'::jsonb OR l->'rental' IS DISTINCT FROM 'null'::jsonb OR l->'allocation' IS DISTINCT FROM 'null'::jsonb OR l->'operating' IS DISTINCT FROM 'null'::jsonb OR jsonb_array_length(l->'fees')<>0 THEN RAISE EXCEPTION 'Equipment not applicable invalid' USING ERRCODE='22023';END IF;CONTINUE;
  END IF;
  IF l->'notApplicableReason' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Equipment method invalid' USING ERRCODE='22023';END IF;
  hours:=public.canonical_equipment_cost_quantity(l->'plannedHours');
  IF l->>'method'='rental' THEN
   a:=l->'rental';
   IF l->'allocation' IS DISTINCT FROM 'null'::jsonb OR public.canonical_field_evidence_object_keys_exact(a,ARRAY['unit','quantity','minimumQuantity','charge']) IS NOT TRUE OR COALESCE(a->>'unit','') NOT IN ('hour','day','week','month','job') THEN RAISE EXCEPTION 'Equipment rental invalid' USING ERRCODE='22023';END IF;
   q:=public.canonical_equipment_cost_quantity(a->'quantity');minimum:=public.canonical_equipment_cost_quantity(a->'minimumQuantity');
   IF (a->>'unit'='job' AND q IS DISTINCT FROM 1) OR (q IS NOT NULL AND minimum IS NOT NULL AND q<minimum) THEN RAISE EXCEPTION 'Equipment rental quantity invalid' USING ERRCODE='22023';END IF;
   PERFORM public.canonical_equipment_cost_charge(a->'charge');
  ELSIF l->>'method' IN ('economic_recovery','financing_cash') THEN
   a:=l->'allocation';
   IF l->'rental' IS DISTINCT FROM 'null'::jsonb OR public.canonical_field_evidence_object_keys_exact(a,ARRAY['period','usableHours','pool','includedCategories','additionalCosts']) IS NOT TRUE OR COALESCE(a->>'period','') NOT IN ('month','year') OR jsonb_typeof(a->'includedCategories') IS DISTINCT FROM 'array' OR jsonb_typeof(a->'additionalCosts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Equipment allocation invalid' USING ERRCODE='22023';END IF;
   IF jsonb_array_length(a->'includedCategories')>6 OR jsonb_array_length(a->'additionalCosts')>4 THEN RAISE EXCEPTION 'Equipment allocation bounds invalid' USING ERRCODE='22023';END IF;
   IF public.canonical_equipment_cost_quantity(a->'usableHours')=0 THEN RAISE EXCEPTION 'Equipment usable hours invalid' USING ERRCODE='22023';END IF;
   required:=CASE WHEN l->>'method'='economic_recovery' THEN 'capital_recovery' ELSE 'debt_service' END;
   forbidden:=CASE WHEN required='capital_recovery' THEN 'debt_service' ELSE 'capital_recovery' END;
   FOR c IN SELECT value FROM jsonb_array_elements(a->'includedCategories') LOOP
    category:=c#>>'{}';IF jsonb_typeof(c) IS DISTINCT FROM 'string' OR category NOT IN ('capital_recovery','debt_service','interest','insurance','maintenance','operating','fuel_energy','consumables') OR public.canonical_equipment_cost_categories_overlap(categories,category) THEN RAISE EXCEPTION 'Equipment category invalid' USING ERRCODE='22023';END IF;categories:=array_append(categories,category);
   END LOOP;
   IF NOT required=ANY(categories) OR forbidden=ANY(categories) THEN RAISE EXCEPTION 'Equipment recovery duplicate invalid' USING ERRCODE='22023';END IF;
   PERFORM public.canonical_equipment_cost_charge(a->'pool');
   FOR c IN SELECT value FROM jsonb_array_elements(a->'additionalCosts') LOOP
    category:=c->>'category';IF public.canonical_field_evidence_object_keys_exact(c,ARRAY['category','label','charge']) IS NOT TRUE OR public.canonical_labor_plan_text(c->'label',160) IS NOT TRUE OR category IS NULL OR category NOT IN ('capital_recovery','debt_service','interest','insurance','maintenance','operating','fuel_energy','consumables') OR category=forbidden OR public.canonical_equipment_cost_categories_overlap(categories,category) THEN RAISE EXCEPTION 'Equipment period category invalid' USING ERRCODE='22023';END IF;categories:=array_append(categories,category);PERFORM public.canonical_equipment_cost_charge(c->'charge');
   END LOOP;
  ELSE RAISE EXCEPTION 'Equipment method invalid' USING ERRCODE='22023';END IF;
  o:=l->'operating';
  IF public.canonical_field_evidence_object_keys_exact(o,ARRAY['mode','allIn','fuelEnergy','consumables','maintenance']) IS NOT TRUE OR COALESCE(o->>'mode','') NOT IN ('all_in','separate') THEN RAISE EXCEPTION 'Equipment operating invalid' USING ERRCODE='22023';END IF;
  IF o->>'mode'='all_in' THEN
   IF o->'fuelEnergy' IS DISTINCT FROM 'null'::jsonb OR o->'consumables' IS DISTINCT FROM 'null'::jsonb OR o->'maintenance' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Equipment operating duplicated' USING ERRCODE='22023';END IF;
  ELSIF o->'allIn' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Equipment operating duplicated' USING ERRCODE='22023';END IF;
  FOREACH k IN ARRAY CASE WHEN o->>'mode'='all_in' THEN ARRAY['allIn'] ELSE ARRAY['fuelEnergy','consumables','maintenance'] END LOOP
   c:=o->k;category:=CASE k WHEN 'allIn' THEN 'operating' WHEN 'fuelEnergy' THEN 'fuel_energy' ELSE k END;
   IF public.canonical_field_evidence_object_keys_exact(c,ARRAY['status','rate']) IS NOT TRUE OR COALESCE(c->>'status','') NOT IN ('known','not_applicable','unknown') THEN RAISE EXCEPTION 'Equipment operating status invalid' USING ERRCODE='22023';END IF;
   IF c->>'status'='known' THEN
    IF public.canonical_equipment_cost_categories_overlap(categories,category) THEN RAISE EXCEPTION 'Equipment operating duplicated' USING ERRCODE='22023';END IF;
    categories:=array_append(categories,category);PERFORM public.canonical_equipment_cost_charge(c->'rate');
   ELSIF c->'rate' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Equipment unknown rate invalid' USING ERRCODE='22023';END IF;
  END LOOP;
  FOR c IN SELECT value FROM jsonb_array_elements(l->'fees') LOOP
   category:=c->>'category';
   IF public.canonical_field_evidence_object_keys_exact(c,ARRAY['category','label','amount']) IS NOT TRUE OR public.canonical_labor_plan_text(c->'label',160) IS NOT TRUE OR public.canonical_labor_plan_text(c->'category',80) IS NOT TRUE OR public.canonical_equipment_cost_categories_overlap(categories,category) OR category IN ('operator','travel','delivery','tax','deposit','overhead','capital_recovery','debt_service') THEN RAISE EXCEPTION 'Equipment fee invalid' USING ERRCODE='22023';END IF;
   categories:=array_append(categories,category);PERFORM public.canonical_equipment_cost_money(c->'amount');
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_money(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_quantity(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_charge(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_source_validate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_validate(jsonb) FROM PUBLIC;

CREATE FUNCTION public.canonical_equipment_cost_source_assess(v JSONB,day_value DATE) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;s JSONB;codes JSONB;cautions JSONB:='[]';
BEGIN
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  s:=l->'source';codes:='[]';
  IF s->>'effectiveOn' IS NULL THEN codes:=codes||'"date_unknown"'::jsonb;ELSIF (s->>'effectiveOn')::date>day_value THEN codes:=codes||'"not_yet_effective"'::jsonb;END IF;
  IF s->>'endsOn' IS NULL THEN codes:=codes||'"freshness_unknown"'::jsonb;ELSIF (s->>'endsOn')::date<day_value THEN codes:=codes||'"expired"'::jsonb;END IF;
  IF public.canonical_labor_plan_text(s->'geography',160) IS NOT TRUE THEN codes:=codes||'"applicability_unknown"'::jsonb;END IF;
  IF l->>'method'='rental' AND l#>'{rental,minimumQuantity}'='null'::jsonb THEN codes:=codes||'"rental_minimum_unknown"'::jsonb;END IF;
  IF jsonb_array_length(codes)>0 THEN cautions:=cautions||jsonb_build_array(jsonb_build_object('lineId',l->'lineId','codes',codes));END IF;
 END LOOP;
 RETURN jsonb_build_object('date',day_value::text,'cautions',cautions);
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_source_assess(jsonb,date) FROM PUBLIC;
CREATE FUNCTION public.canonical_equipment_cost_require(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,v JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE plan public.canonical_equipment_plans%ROWTYPE;sources JSONB;a JSONB:=v->'assessment';l JSONB;saved JSONB;today TEXT;
BEGIN
 PERFORM public.canonical_equipment_cost_validate(v);
 SELECT * INTO plan FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF plan.id IS NULL OR plan.action<>'save' OR v#>>'{equipmentBasis,planId}' IS DISTINCT FROM plan.id::text OR v#>>'{equipmentBasis,digest}' IS DISTINCT FROM plan.digest OR v#>>'{equipmentBasis,revision}' IS DISTINCT FROM plan.revision::text OR v#>'{equipmentBasis,sourcePins}' IS DISTINCT FROM plan.source_pins OR v->>'serviceKey' IS DISTINCT FROM plan.inputs->>'serviceKey' THEN RAISE EXCEPTION 'Equipment review changed' USING ERRCODE='40001';END IF;
 IF jsonb_array_length(v->'lines')<>jsonb_array_length(plan.inputs->'lines') THEN RAISE EXCEPTION 'Equipment cost lines missing' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  SELECT value INTO saved FROM jsonb_array_elements(plan.inputs->'lines') WHERE lower(value->>'lineId')=lower(l->>'lineId');
  IF saved IS NULL OR l->>'access' IS DISTINCT FROM saved->>'accessBasis' THEN RAISE EXCEPTION 'Equipment cost association changed' USING ERRCODE='40001';END IF;
 END LOOP;
 sources:=public.canonical_equipment_plan_sources(org,actor,role_value,session_value,estimate,plan.inputs);
 IF sources->>'digest' IS DISTINCT FROM plan.evidence->>'digest' THEN RAISE EXCEPTION 'Equipment sources need review' USING ERRCODE='40001';END IF;
 today:=(clock_timestamp() AT TIME ZONE 'UTC')::date::text;
 IF public.canonical_field_evidence_object_keys_exact(a,ARRAY['date','cautions','equipmentAssessment','acknowledged','explanation']) IS NOT TRUE OR a->>'date' IS DISTINCT FROM today OR a->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR a#>>'{equipmentAssessment,sourcesDigest}' IS DISTINCT FROM sources->>'digest' OR jsonb_typeof(a->'cautions') IS DISTINCT FROM 'array' OR public.canonical_labor_plan_text(a->'explanation',1000,jsonb_array_length(a->'cautions')=0) IS NOT TRUE THEN RAISE EXCEPTION 'Equipment cost source review changed' USING ERRCODE='40001';END IF;
 IF (a-'equipmentAssessment'-'acknowledged'-'explanation') IS DISTINCT FROM public.canonical_equipment_cost_source_assess(v,today::date) THEN RAISE EXCEPTION 'Equipment cost date review changed' USING ERRCODE='40001';END IF;
 RETURN sources;
END $$;
CREATE TABLE public.canonical_equipment_cost_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('save','withdraw')),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 actor_name TEXT NOT NULL,
 source_pins JSONB NOT NULL,
 inputs JSONB,
 equipment_plan_id UUID GENERATED ALWAYS AS ((inputs#>>'{equipmentBasis,planId}')::uuid) STORED,
 evidence JSONB,
 calculation_version TEXT NOT NULL DEFAULT 'estimate-equipment-cost-plan-v1' CHECK(calculation_version='estimate-equipment-cost-plan-v1'),
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-equipment-cost-plan-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,equipment_plan_id) REFERENCES public.canonical_equipment_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_equipment_cost_plans(organization_id,estimate_id,id),
 CHECK((action='save' AND inputs IS NOT NULL) OR (action='withdraw' AND inputs IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_equipment_cost_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_equipment_cost_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_equipment_cost_plans FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_equipment_cost_immutable();

CREATE FUNCTION public.canonical_equipment_cost_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_decision_source(org,estimate) $$;
CREATE FUNCTION public.canonical_equipment_cost_projection(d public.canonical_equipment_cost_plans) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'inputs',d.inputs,'evidence',d.evidence,'calculationVersion',d.calculation_version,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_equipment_cost_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_equipment_cost_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_equipment_cost_projection(d) INTO current_value FROM public.canonical_equipment_cost_plans d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_equipment_cost_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
CREATE FUNCTION public.canonical_equipment_cost_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; evidence_value JSONB; old public.canonical_equipment_cost_plans%ROWTYPE; current_row public.canonical_equipment_cost_plans%ROWTYPE;
 inserted public.canonical_equipment_cost_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; decision_row public.canonical_estimate_decisions%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 -- Lock subscription eligibility as well as the audited actor helper's membership/account/session/onboarding rows.
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 -- The inherited helper uses a LEFT JOIN; this new mutation contract requires a present subscription row.
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT currency INTO current_currency FROM public.canonical_estimates WHERE organization_id=org AND id=estimate FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 source_value:=public.canonical_equipment_cost_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-equipment-cost-plan-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN PERFORM public.canonical_equipment_cost_validate(body->'inputs');
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':equipment-cost:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before returning it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_equipment_cost_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='equipment_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>20 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
IF body->>'action'='save' THEN evidence_value:=public.canonical_equipment_cost_require(org,actor,role_value,session_value,estimate,body->'inputs'); END IF;
  SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_equipment_cost_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,evidence,expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,NULLIF(body->'inputs','null'::jsonb),evidence_value,(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),'estimate-equipment-cost-plan-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_equipment_cost_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_equipment_cost_plans FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_source(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_projection(public.canonical_equipment_cost_plans) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;

ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost'));

REVOKE ALL ON FUNCTION public.canonical_equipment_cost_validate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_require(uuid,uuid,text,uuid,uuid,jsonb) FROM PUBLIC;

ALTER TABLE public.canonical_estimate_revisions ADD COLUMN equipment_cost_plan_id UUID;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revision_equipment_cost_fk FOREIGN KEY(organization_id,estimate_id,equipment_cost_plan_id) REFERENCES public.canonical_equipment_cost_plans(organization_id,estimate_id,id);
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revisions_calculation_version_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revisions_calculation_version_check CHECK(calculation_version IN ('estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4','estimate-cost-adoption-v1','estimate-cost-adoption-v2'));
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revision_components_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revision_components_check CHECK(CASE
 WHEN calculation_version='estimate-cost-adoption-v2' THEN changed_component IN ('material','labor','equipment') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND public.canonical_field_evidence_object_keys_exact(component_manifest,ARRAY['material','labor','equipment']) AND CASE changed_component WHEN 'material' THEN material_plan_id IS NOT NULL WHEN 'labor' THEN labor_plan_id IS NOT NULL ELSE equipment_cost_plan_id IS NOT NULL END
 WHEN calculation_version='estimate-cost-adoption-v1' THEN equipment_cost_plan_id IS NULL AND changed_component IN ('material','labor') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND jsonb_typeof(component_manifest)='object' AND CASE WHEN changed_component='material' THEN material_plan_id IS NOT NULL ELSE labor_plan_id IS NOT NULL END
 ELSE material_plan_id IS NOT NULL AND labor_plan_id IS NULL AND equipment_cost_plan_id IS NULL AND changed_component IS NULL AND component_manifest IS NULL END);
DROP INDEX public.canonical_revision_legacy_material_once;
CREATE UNIQUE INDEX canonical_revision_legacy_material_once ON public.canonical_estimate_revisions(organization_id,estimate_id,material_plan_id) WHERE calculation_version NOT IN ('estimate-cost-adoption-v1','estimate-cost-adoption-v2');
CREATE UNIQUE INDEX canonical_revision_component_v2_once ON public.canonical_estimate_revisions(organization_id,estimate_id,COALESCE(previous_id,estimate_id),changed_component,(CASE changed_component WHEN 'material' THEN material_plan_id WHEN 'labor' THEN labor_plan_id ELSE equipment_cost_plan_id END)) WHERE calculation_version='estimate-cost-adoption-v2';
CREATE FUNCTION public.canonical_estimate_revision_equipment_reference(p JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN p IS NULL OR p='null'::jsonb THEN jsonb_build_object('kind','original') ELSE public.canonical_estimate_revision_plan_reference(p)||jsonb_build_object('equipmentBasis',p#>'{inputs,equipmentBasis}') END $$;
CREATE FUNCTION public.canonical_estimate_revision_components_v2(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN d.calculation_version='estimate-cost-adoption-v2' THEN d.component_manifest ELSE public.canonical_estimate_revision_components(d)||jsonb_build_object('equipment',jsonb_build_object('kind','original')) END $$;
ALTER FUNCTION public.canonical_estimate_revision_projection(public.canonical_estimate_revisions) RENAME TO canonical_estimate_revision_projection_v066;
CREATE FUNCTION public.canonical_estimate_revision_projection(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN d.calculation_version='estimate-cost-adoption-v2' THEN public.canonical_estimate_revision_projection_legacy(d)||jsonb_build_object('changedComponent',d.changed_component,'componentManifest',d.component_manifest,'laborPlanId',d.labor_plan_id,'laborPlan',(SELECT public.canonical_labor_plan_projection(l) FROM public.canonical_labor_plans l WHERE l.organization_id=d.organization_id AND l.estimate_id=d.estimate_id AND l.id=d.labor_plan_id),'equipmentCostPlanId',d.equipment_cost_plan_id,'equipmentCostPlan',(SELECT public.canonical_equipment_cost_projection(e)-'evidence' FROM public.canonical_equipment_cost_plans e WHERE e.organization_id=d.organization_id AND e.estimate_id=d.estimate_id AND e.id=d.equipment_cost_plan_id)) ELSE public.canonical_estimate_revision_projection_v066(d) END $$;
CREATE FUNCTION public.canonical_estimate_revision_cost_assessment_v2(m JSONB,l JSONB,e JSONB,service_key TEXT,day_value DATE) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_revision_cost_assessment(m,l,service_key,day_value)||jsonb_build_object('equipmentSource',CASE WHEN e IS NULL THEN NULL ELSE public.canonical_equipment_cost_source_assess(e->'inputs',day_value) END) $$;
CREATE FUNCTION public.canonical_equipment_cost_adoption_require(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,v JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE plan public.canonical_equipment_plans%ROWTYPE;sources JSONB;
BEGIN
 PERFORM public.canonical_equipment_cost_validate(v);
 SELECT * INTO plan FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF plan.id IS NULL OR plan.action<>'save' OR v#>>'{equipmentBasis,planId}' IS DISTINCT FROM plan.id::text OR v#>>'{equipmentBasis,digest}' IS DISTINCT FROM plan.digest THEN RAISE EXCEPTION 'Equipment review changed' USING ERRCODE='40001';END IF;
 sources:=public.canonical_equipment_plan_sources(org,actor,role_value,session_value,estimate,plan.inputs);
 IF sources->>'digest' IS DISTINCT FROM plan.evidence->>'digest' THEN RAISE EXCEPTION 'Equipment source changed' USING ERRCODE='40001';END IF;
END $$;
ALTER FUNCTION public.canonical_estimate_revision_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) RENAME TO canonical_estimate_revision_mutate_v066;
CREATE OR REPLACE FUNCTION public.canonical_estimate_revision_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; original JSONB; old public.canonical_estimate_revisions%ROWTYPE;
 current_row public.canonical_estimate_revisions%ROWTYPE; inserted public.canonical_estimate_revisions%ROWTYPE;
 legacy_result JSONB;ep public.canonical_equipment_cost_plans%ROWTYPE;equipment_value JSONB;plan JSONB; mp public.canonical_material_plans%ROWTYPE; lp public.canonical_labor_plans%ROWTYPE; material_value JSONB; labor_value JSONB; component_value JSONB; service_key TEXT; assessment_value JSONB; decision_row public.canonical_estimate_decisions%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; fingerprint TEXT;
BEGIN
 IF body->>'confirmationVersion' IS DISTINCT FROM 'estimate-cost-adoption-v2' THEN
 legacy_result:=public.canonical_estimate_revision_mutate_v066(org,actor,role_value,session_value,estimate,csrf,key_value,body);
 IF legacy_result->'replayed' IS DISTINCT FROM 'true'::jsonb AND legacy_result#>>'{receipt,sourcePins,revision,calculationVersion}'='estimate-cost-adoption-v2' THEN RAISE EXCEPTION 'Use current cost review' USING ERRCODE='40001';END IF;RETURN legacy_result;END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT currency INTO current_currency FROM public.canonical_estimates WHERE organization_id=org AND id=estimate FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 original:=public.canonical_estimate_revision_original_source(org,estimate);
 source_value:=public.canonical_estimate_decision_source(org,estimate);
 IF source_value IS NULL OR original IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
 public.canonical_field_evidence_object_keys_exact(body,ARRAY['sourcePins','expectedPlanId','expectedPlanRevision','expectedPlanDigest','expectedDecisionRevision','expectedDecisionDigest','reason','confirmed','confirmationVersion','changedComponent','expectedComponents','assessment']) IS NOT TRUE OR
 body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR (body->>'changedComponent' IS NULL OR body->>'changedComponent' NOT IN ('material','labor','equipment')) OR
 jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR (body->>'reason')~U&'[\0001-\001f\007f-\009f]' OR
 jsonb_typeof(body->'expectedPlanRevision') IS DISTINCT FROM 'number' OR (body->>'expectedPlanRevision')!~'^[1-9][0-9]{0,4}$' OR
 jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
 current_currency NOT IN ('USD','CAD','EUR') OR original->>'calculationVersion' IS DISTINCT FROM 'm19-part3-canonical-v2' THEN RAISE EXCEPTION 'Adoption input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':estimate-revision:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_estimate_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
 IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Adoption key conflict' USING ERRCODE='23505'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('receipt',public.canonical_estimate_revision_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT snapshot->'service'->>'key' INTO service_key FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;
 SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.material_plan_id;
 SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.labor_plan_id;
 SELECT * INTO ep FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.equipment_cost_plan_id;
 IF body->>'changedComponent'='material' THEN SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_material_plan_projection(mp);
 ELSIF body->>'changedComponent'='labor' THEN SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_labor_plan_projection(lp);
 ELSE SELECT * INTO ep FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_equipment_cost_projection(ep);END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF body->'sourcePins' IS DISTINCT FROM source_value OR plan->>'id' IS NULL OR plan->>'action'<>'save' OR plan->'sourcePins' IS DISTINCT FROM source_value OR body->>'expectedPlanId' IS DISTINCT FROM plan->>'id' OR body->>'expectedPlanRevision' IS DISTINCT FROM plan->>'revision' OR body->>'expectedPlanDigest' IS DISTINCT FROM plan->>'digest' OR plan->>'currency' IS DISTINCT FROM current_currency OR (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') OR body->'expectedComponents' IS DISTINCT FROM public.canonical_estimate_revision_components_v2(current_row) THEN RAISE EXCEPTION 'Estimate or plan changed' USING ERRCODE='40001';END IF;
 IF (public.canonical_estimate_revision_components_v2(current_row)->(body->>'changedComponent')->>'id')=plan->>'id' THEN RAISE EXCEPTION 'Plan already included' USING ERRCODE='40001';END IF;
 material_value:=CASE WHEN mp.id IS NOT NULL THEN public.canonical_material_plan_projection(mp) ELSE NULL END;labor_value:=CASE WHEN lp.id IS NOT NULL THEN public.canonical_labor_plan_projection(lp) ELSE NULL END;
 equipment_value:=CASE WHEN ep.id IS NOT NULL THEN public.canonical_equipment_cost_projection(ep) ELSE NULL END;
 component_value:=jsonb_build_object('material',public.canonical_estimate_revision_plan_reference(material_value),'labor',public.canonical_estimate_revision_plan_reference(labor_value),'equipment',public.canonical_estimate_revision_equipment_reference(equipment_value));
 IF body->>'changedComponent'='labor' THEN PERFORM public.canonical_labor_plan_validate(lp.inputs);IF EXISTS(SELECT 1 FROM jsonb_array_elements(lp.inputs->'lines') l WHERE l->'hourlyCost'='null'::jsonb OR (l->>'rateMode'='base_burden' AND l->'burdenPercent'='null'::jsonb)) THEN RAISE EXCEPTION 'Complete labor costs required' USING ERRCODE='22023';END IF;IF lp.inputs->>'serviceKey' IS DISTINCT FROM service_key THEN RAISE EXCEPTION 'Labor service changed' USING ERRCODE='40001';END IF;END IF;
 assessment_value:=public.canonical_estimate_revision_cost_assessment_v2(material_value,labor_value,equipment_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date);
 IF body->'assessment' IS DISTINCT FROM assessment_value THEN RAISE EXCEPTION 'Source review changed' USING ERRCODE='40001';END IF;
 next_revision:=COALESCE(current_row.revision,1)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Estimate revision limit' USING ERRCODE='54000'; END IF;
 fingerprint:=public.canonical_completion_digest(jsonb_build_object('original',original,'parent',source_value,'components',component_value,'calculationVersion','estimate-cost-adoption-v2'));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 IF body->>'changedComponent'='material' THEN
 IF mp.calculation_version='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(mp.inputs,current_currency,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
 ELSIF mp.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(mp.inputs,current_currency,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
 ELSIF mp.calculation_version='estimate-material-plan-v2' THEN PERFORM public.canonical_material_plan_validate_v2(mp.inputs);ELSE PERFORM public.canonical_material_plan_validate(mp.inputs);END IF;END IF;
 IF body->>'changedComponent'='equipment' THEN PERFORM public.canonical_equipment_cost_adoption_require(org,actor,role_value,session_value,estimate,ep.inputs);END IF;
 INSERT INTO public.canonical_estimate_revisions(organization_id,estimate_id,revision,previous_id,material_plan_id,labor_plan_id,equipment_cost_plan_id,changed_component,component_manifest,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,original_source_pins,expected_decision_revision,expected_decision_digest,calculation_version,input_fingerprint,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,mp.id,lp.id,ep.id,body->>'changedComponent',component_value,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,original,COALESCE(decision_row.revision,0),COALESCE(decision_row.digest,'none'),body->>'confirmationVersion',fingerprint,btrim(body->>'reason'),body->>'confirmationVersion',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'inputFingerprint',fingerprint,'body',body))) RETURNING * INTO inserted;
 IF body->'assessment' IS DISTINCT FROM public.canonical_estimate_revision_cost_assessment_v2(material_value,labor_value,equipment_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date) THEN RAISE EXCEPTION 'Source review changed' USING ERRCODE='40001';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('receipt',public.canonical_estimate_revision_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_equipment_reference(jsonb),public.canonical_estimate_revision_components_v2(public.canonical_estimate_revisions),public.canonical_estimate_revision_projection_v066(public.canonical_estimate_revisions),public.canonical_estimate_revision_cost_assessment_v2(jsonb,jsonb,jsonb,text,date),public.canonical_equipment_cost_adoption_require(uuid,uuid,text,uuid,uuid,jsonb),public.canonical_estimate_revision_mutate_v066(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;

-- Exact integer-rational overflow validation. NUMERIC division is never rounded
-- into a displayed hourly rate; div() performs the final half-up cents step.
CREATE FUNCTION public.canonical_equipment_cost_equipment_cents(v JSONB) RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_equipment_cost_money(CASE WHEN v->>'scope'='mixed' THEN v#>'{split,equipment}' ELSE v->'amount' END)*100
$$;
CREATE FUNCTION public.canonical_equipment_cost_add(r NUMERIC[],amount NUMERIC,multiplier NUMERIC,denominator NUMERIC) RETURNS NUMERIC[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN amount IS NULL OR multiplier IS NULL OR denominator IS NULL THEN r ELSE ARRAY[r[1]*denominator+amount*multiplier*r[2],r[2]*denominator] END
$$;
CREATE FUNCTION public.canonical_equipment_cost_known_cents(v JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;c JSONB;r NUMERIC[];hours NUMERIC;usable NUMERIC;q NUMERIC;k TEXT;line_cents NUMERIC;total NUMERIC:=0;
BEGIN
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  r:=ARRAY[0::numeric,1::numeric];
  IF l->>'method'='not_applicable' THEN CONTINUE;END IF;
  hours:=public.canonical_equipment_cost_quantity(l->'plannedHours')*1000000;
  IF l->>'method'='rental' THEN
   q:=public.canonical_equipment_cost_quantity(l#>'{rental,quantity}')*1000000;
   r:=public.canonical_equipment_cost_add(r,public.canonical_equipment_cost_equipment_cents(l#>'{rental,charge}'),q,1000000);
  ELSE
   usable:=public.canonical_equipment_cost_quantity(l#>'{allocation,usableHours}')*1000000;
   r:=public.canonical_equipment_cost_add(r,public.canonical_equipment_cost_equipment_cents(l#>'{allocation,pool}'),hours,usable);
   FOR c IN SELECT value FROM jsonb_array_elements(l#>'{allocation,additionalCosts}') LOOP
    r:=public.canonical_equipment_cost_add(r,public.canonical_equipment_cost_equipment_cents(c->'charge'),hours,usable);
   END LOOP;
  END IF;
  FOREACH k IN ARRAY CASE WHEN l#>>'{operating,mode}'='all_in' THEN ARRAY['allIn'] ELSE ARRAY['fuelEnergy','consumables','maintenance'] END LOOP
   c:=l->'operating'->k;
   IF c->>'status'='known' THEN r:=public.canonical_equipment_cost_add(r,public.canonical_equipment_cost_equipment_cents(c->'rate'),hours,1000000);END IF;
  END LOOP;
  FOR c IN SELECT value FROM jsonb_array_elements(l->'fees') LOOP
   r:=public.canonical_equipment_cost_add(r,public.canonical_equipment_cost_money(c->'amount')*100,1,1);
  END LOOP;
  line_cents:=div(r[1]*2+r[2],r[2]*2);total:=total+line_cents;
  IF line_cents>99999999999999 OR total>99999999999999 THEN RAISE EXCEPTION 'Equipment cost overflow' USING ERRCODE='22023';END IF;
 END LOOP;
 RETURN total;
END $$;
ALTER FUNCTION public.canonical_equipment_cost_validate(jsonb) RENAME TO canonical_equipment_cost_validate_structure;
CREATE FUNCTION public.canonical_equipment_cost_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN PERFORM public.canonical_equipment_cost_validate_structure(v);PERFORM public.canonical_equipment_cost_known_cents(v);END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_cost_equipment_cents(jsonb),public.canonical_equipment_cost_add(numeric[],numeric,numeric,numeric),public.canonical_equipment_cost_known_cents(jsonb),public.canonical_equipment_cost_validate_structure(jsonb),public.canonical_equipment_cost_validate(jsonb) FROM PUBLIC;
