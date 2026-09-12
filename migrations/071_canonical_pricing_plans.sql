-- Part6 Slice1: private proposals, never issued prices or direct-cost adoption.
CREATE FUNCTION public.canonical_pricing_recorded(v JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR (v#>>'{}')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' THEN RETURN NULL;END IF;RETURN (v#>>'{}')::numeric*100;END $$;
CREATE FUNCTION public.canonical_pricing_money(v JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF v='null'::jsonb THEN RETURN NULL;END IF;IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN RAISE EXCEPTION 'Pricing amount invalid' USING ERRCODE='22023';END IF;RETURN (v#>>'{}')::numeric*100;END $$;
CREATE FUNCTION public.canonical_pricing_quantity(v JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF v='null'::jsonb THEN RETURN NULL;END IF;IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION 'Pricing quantity invalid' USING ERRCODE='22023';END IF;RETURN (v#>>'{}')::numeric;END $$;
CREATE FUNCTION public.canonical_pricing_decimal(v NUMERIC) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF v IS NULL THEN RETURN NULL;END IF;IF v<0 OR v>99999999999999 OR v<>trunc(v) THEN RAISE EXCEPTION 'Pricing total invalid' USING ERRCODE='22023';END IF;RETURN trunc(v/100)::text||'.'||lpad(trunc(mod(v,100))::text,2,'0');END $$;
CREATE FUNCTION public.canonical_pricing_text(v JSONB,max_length INTEGER,allow_empty BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
SELECT public.canonical_labor_plan_text(v,max_length,allow_empty) $$;
CREATE FUNCTION public.canonical_pricing_day(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')<'1000-01-01' OR (v#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN FALSE;END IF;RETURN to_char((v#>>'{}')::date,'YYYY-MM-DD')=v#>>'{}';EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN FALSE;END $$;
CREATE FUNCTION public.canonical_pricing_source_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['kind','referenceId','digest','note','effectiveOn','endsOn']) IS NOT TRUE OR v->>'kind' IS NULL OR v->>'kind' NOT IN ('owner_estimate','profile','published_knowledge') OR public.canonical_pricing_text(v->'note',1000,TRUE) IS NOT TRUE OR v->'effectiveOn'<>'null'::jsonb AND public.canonical_pricing_day(v->'effectiveOn') IS NOT TRUE OR v->'endsOn'<>'null'::jsonb AND public.canonical_pricing_day(v->'endsOn') IS NOT TRUE OR v->>'effectiveOn' IS NOT NULL AND v->>'endsOn'<v->>'effectiveOn' THEN RAISE EXCEPTION 'Pricing source invalid' USING ERRCODE='22023';END IF;
IF v->>'kind'='owner_estimate' THEN IF v->'referenceId'<>'null'::jsonb OR v->'digest'<>'null'::jsonb THEN RAISE EXCEPTION 'Owner source invalid' USING ERRCODE='22023';END IF;
ELSIF public.canonical_pricing_text(v->'referenceId',200) IS NOT TRUE OR jsonb_typeof(v->'digest') IS DISTINCT FROM 'string' OR (v->>'digest')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Pricing reference invalid' USING ERRCODE='22023';END IF;
END $$;
CREATE FUNCTION public.canonical_pricing_calculate(v JSONB,currency_value TEXT,basis JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;p JSONB;o JSONB;s JSONB;c JSONB;ref JSONB;rows JSONB:='[]';payments JSONB:='[]';missing JSONB:='[]';parents JSONB:='{}';ids TEXT[]:=ARRAY[]::text[];seen TEXT[];payment_ids TEXT[]:=ARRAY[]::text[];used TEXT[]:=ARRAY[]::text[];id TEXT;parent TEXT;amount NUMERIC;q NUMERIC;r NUMERIC;subtotal NUMERIC:=0;complete BOOLEAN:=TRUE;total NUMERIC:=0;deposits INTEGER:=0;balances INTEGER:=0;direct NUMERIC;gross NUMERIC;included NUMERIC:=0;incremental NUMERIC;pool NUMERIC;t NUMERIC;overlap_resolved BOOLEAN;sum_value NUMERIC;idx INTEGER;
BEGIN
IF currency_value IS NULL OR currency_value NOT IN ('USD','CAD','EUR') OR public.canonical_field_evidence_object_keys_exact(v,ARRAY['serviceKey','lines','payments','overhead']) IS NOT TRUE OR public.canonical_pricing_text(v->'serviceKey',100) IS NOT TRUE OR jsonb_typeof(v->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'lines') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Pricing lines invalid' USING ERRCODE='22023';END IF;
FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','label','kind','quantity','unit','rate','amount','scope','includes','period','source']) IS NOT TRUE OR public.canonical_pricing_text(l->'lineId',80) IS NOT TRUE OR l->>'lineId'=ANY(ids) OR public.canonical_pricing_text(l->'label',160) IS NOT TRUE OR l->>'kind' IS NULL OR l->>'kind' NOT IN ('fixed','unit','package','retainer') OR public.canonical_pricing_text(l->'scope',2000,TRUE) IS NOT TRUE OR jsonb_typeof(l->'includes') IS DISTINCT FROM 'array' OR jsonb_array_length(l->'includes')>11 THEN RAISE EXCEPTION 'Pricing line invalid' USING ERRCODE='22023';END IF;
ids:=array_append(ids,l->>'lineId');PERFORM public.canonical_pricing_source_validate(l->'source');amount:=NULL;
IF l->>'kind' IN ('fixed','package') THEN
 IF l->'quantity'<>'null'::jsonb OR l->'unit'<>'null'::jsonb OR l->'rate'<>'null'::jsonb OR l->'period'<>'null'::jsonb THEN RAISE EXCEPTION 'Fixed pricing shape invalid' USING ERRCODE='22023';END IF;amount:=public.canonical_pricing_money(l->'amount');
ELSE
 IF l->'amount'<>'null'::jsonb THEN RAISE EXCEPTION 'Unit pricing shape invalid' USING ERRCODE='22023';END IF;q:=public.canonical_pricing_quantity(l->'quantity');r:=public.canonical_pricing_quantity(l->'rate');amount:=round(q*r*100);
 IF l->>'kind'='unit' THEN IF l->>'unit' IS NULL OR l->>'unit' NOT IN ('each','person_hour','elapsed_hour','ft','sq_ft','cu_yd','m','sq_m','cu_m','lb','kg','US_gal','L') OR l->'period'<>'null'::jsonb THEN RAISE EXCEPTION 'Pricing unit invalid' USING ERRCODE='22023';END IF;
 ELSE p:=l->'period';IF l->>'unit' IS DISTINCT FROM 'period' OR public.canonical_field_evidence_object_keys_exact(p,ARRAY['label','startsOn','endsOn']) IS NOT TRUE OR public.canonical_pricing_text(p->'label',160) IS NOT TRUE OR public.canonical_pricing_day(p->'startsOn') IS NOT TRUE OR public.canonical_pricing_day(p->'endsOn') IS NOT TRUE OR p->>'endsOn'<p->>'startsOn' OR q IS NOT NULL AND (q<=0 OR q<>trunc(q)) OR length(btrim(l->>'scope'))=0 THEN RAISE EXCEPTION 'Finite retainer invalid' USING ERRCODE='22023';END IF;END IF;
END IF;
IF l->>'kind'<>'package' AND jsonb_array_length(l->'includes')>0 OR l->>'kind'='package' AND length(btrim(l->>'scope'))=0 THEN RAISE EXCEPTION 'Package scope invalid' USING ERRCODE='22023';END IF;
FOR s IN SELECT value FROM jsonb_array_elements(l->'includes') LOOP id:=s#>>'{}';IF public.canonical_pricing_text(s,80) IS NOT TRUE OR id=l->>'lineId' OR parents?id THEN RAISE EXCEPTION 'Package inclusion invalid' USING ERRCODE='22023';END IF;parents:=parents||jsonb_build_object(id,l->>'lineId');END LOOP;
rows:=rows||jsonb_build_array(jsonb_build_object('lineId',l->>'lineId','label',l->>'label','kind',l->>'kind','amount',public.canonical_pricing_decimal(amount),'includedIn',NULL));
END LOOP;
FOR id,parent IN SELECT key,value FROM jsonb_each_text(parents) LOOP IF NOT id=ANY(ids) THEN RAISE EXCEPTION 'Included line unavailable' USING ERRCODE='22023';END IF;seen:=ARRAY[id];WHILE parent IS NOT NULL LOOP IF parent=ANY(seen) THEN RAISE EXCEPTION 'Package cycle' USING ERRCODE='22023';END IF;seen:=array_append(seen,parent);parent:=parents->>parent;END LOOP;END LOOP;
FOR idx IN 0..jsonb_array_length(rows)-1 LOOP l:=rows->idx;parent:=parents->>(l->>'lineId');rows:=jsonb_set(rows,ARRAY[idx::text,'includedIn'],COALESCE(to_jsonb(parent),'null'::jsonb));IF parent IS NULL THEN amount:=public.canonical_pricing_money(l->'amount');IF amount IS NULL THEN complete:=FALSE;missing:=missing||jsonb_build_array(l->>'lineId');ELSE subtotal:=subtotal+amount;END IF;END IF;END LOOP;
PERFORM public.canonical_pricing_decimal(subtotal);IF NOT complete THEN subtotal:=NULL;END IF;
p:=v->'payments';IF public.canonical_field_evidence_object_keys_exact(p,ARRAY['mode','balanceId','stages']) IS NOT TRUE OR p->>'mode' IS NULL OR p->>'mode' NOT IN ('none','amount','share') OR jsonb_typeof(p->'stages') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'stages')>12 THEN RAISE EXCEPTION 'Payment stages invalid' USING ERRCODE='22023';END IF;
IF p->>'mode'='none' THEN IF jsonb_array_length(p->'stages')<>0 OR p->'balanceId'<>'null'::jsonb THEN RAISE EXCEPTION 'Payment stages unavailable' USING ERRCODE='22023';END IF;
ELSE
IF jsonb_array_length(p->'stages')=0 OR public.canonical_pricing_text(p->'balanceId',80) IS NOT TRUE THEN RAISE EXCEPTION 'Payment balance required' USING ERRCODE='22023';END IF;
FOR s IN SELECT value FROM jsonb_array_elements(p->'stages') LOOP
IF public.canonical_field_evidence_object_keys_exact(s,ARRAY['stageId','label','kind','value']) IS NOT TRUE OR public.canonical_pricing_text(s->'stageId',80) IS NOT TRUE OR s->>'stageId'=ANY(payment_ids) OR public.canonical_pricing_text(s->'label',160) IS NOT TRUE OR s->>'kind' IS NULL OR s->>'kind' NOT IN ('deposit','milestone','balance') THEN RAISE EXCEPTION 'Payment stage invalid' USING ERRCODE='22023';END IF;
payment_ids:=array_append(payment_ids,s->>'stageId');IF s->>'kind'='deposit' THEN deposits:=deposits+1;END IF;IF s->>'kind'='balance' THEN balances:=balances+1;END IF;
amount:=public.canonical_pricing_money(s->'value');IF amount IS NULL OR p->>'mode'='share' AND (amount>10000 OR length(split_part(s->>'value','.',1))>3) THEN RAISE EXCEPTION 'Payment amount invalid' USING ERRCODE='22023';END IF;total:=total+amount;
payments:=payments||jsonb_build_array(jsonb_build_object('stageId',s->>'stageId','label',s->>'label','kind',s->>'kind','amount',public.canonical_pricing_decimal(CASE WHEN subtotal IS NULL THEN NULL WHEN p->>'mode'='amount' THEN amount ELSE trunc(amount*subtotal/10000) END),'share',CASE WHEN p->>'mode'='share' THEN s->>'value' ELSE NULL END));
END LOOP;
IF deposits>1 OR balances<>1 OR p->'stages'->-1->>'stageId' IS DISTINCT FROM p->>'balanceId' OR p->'stages'->-1->>'kind' IS DISTINCT FROM 'balance' OR p->>'mode'='share' AND total<>10000 OR p->>'mode'='amount' AND subtotal IS NOT NULL AND total<>subtotal THEN RAISE EXCEPTION 'Payment conservation invalid' USING ERRCODE='22023';END IF;
IF p->>'mode'='share' AND subtotal IS NOT NULL THEN SELECT sum(public.canonical_pricing_money(value->'amount')) INTO sum_value FROM jsonb_array_elements(payments);idx:=jsonb_array_length(payments)-1;payments:=jsonb_set(payments,ARRAY[idx::text,'amount'],to_jsonb(public.canonical_pricing_decimal(public.canonical_pricing_money(payments->idx->'amount')+subtotal-sum_value)));END IF;
END IF;
o:=v->'overhead';IF public.canonical_field_evidence_object_keys_exact(o,ARRAY['method','amount','percent','period','source','coverage']) IS NOT TRUE OR o->>'method' IS NULL OR o->>'method' NOT IN ('unknown','fixed','percent','period') THEN RAISE EXCEPTION 'Overhead method invalid' USING ERRCODE='22023';END IF;PERFORM public.canonical_pricing_source_validate(o->'source');direct:=public.canonical_pricing_money(COALESCE(basis->'directCosts','null'::jsonb));
IF o->>'method'='fixed' THEN IF o->'percent'<>'null'::jsonb OR o->'period'<>'null'::jsonb THEN RAISE EXCEPTION 'Overhead fields invalid' USING ERRCODE='22023';END IF;gross:=public.canonical_pricing_money(o->'amount');
ELSIF o->>'method'='percent' THEN IF o->'amount'<>'null'::jsonb OR o->'period'<>'null'::jsonb THEN RAISE EXCEPTION 'Overhead fields invalid' USING ERRCODE='22023';END IF;r:=public.canonical_pricing_quantity(o->'percent');IF r>100 THEN RAISE EXCEPTION 'Overhead percent invalid' USING ERRCODE='22023';END IF;gross:=round(direct*r/100);
ELSIF o->>'method'='period' THEN p:=o->'period';IF o->'amount'<>'null'::jsonb OR o->'percent'<>'null'::jsonb OR public.canonical_field_evidence_object_keys_exact(p,ARRAY['startsOn','endsOn','pool','jobUnits','totalUnits','unit']) IS NOT TRUE OR public.canonical_pricing_day(p->'startsOn') IS NOT TRUE OR public.canonical_pricing_day(p->'endsOn') IS NOT TRUE OR p->>'endsOn'<p->>'startsOn' OR p->>'unit' IS NULL OR p->>'unit' NOT IN ('person_hour','job') THEN RAISE EXCEPTION 'Overhead period invalid' USING ERRCODE='22023';END IF;pool:=public.canonical_pricing_money(p->'pool');q:=public.canonical_pricing_quantity(p->'jobUnits');t:=public.canonical_pricing_quantity(p->'totalUnits');IF t<=0 OR q>t THEN RAISE EXCEPTION 'Overhead allocation invalid' USING ERRCODE='22023';END IF;gross:=round(pool*q/t);
ELSE IF o->'amount'<>'null'::jsonb OR o->'percent'<>'null'::jsonb OR o->'period'<>'null'::jsonb THEN RAISE EXCEPTION 'Overhead fields invalid' USING ERRCODE='22023';END IF;END IF;
c:=o->'coverage';IF public.canonical_field_evidence_object_keys_exact(c,ARRAY['status','explanation','included']) IS NOT TRUE OR c->>'status' IS NULL OR c->>'status' NOT IN ('unknown','disjoint','allocated') OR public.canonical_pricing_text(c->'explanation',1000,c->>'status'='unknown') IS NOT TRUE OR jsonb_typeof(c->'included') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'included')>12 OR c->>'status'<>'allocated' AND jsonb_array_length(c->'included')<>0 OR c->>'status'='allocated' AND jsonb_array_length(c->'included')=0 THEN RAISE EXCEPTION 'Overhead coverage invalid' USING ERRCODE='22023';END IF;
FOR s IN SELECT value FROM jsonb_array_elements(c->'included') LOOP
IF public.canonical_field_evidence_object_keys_exact(s,ARRAY['referenceId','amount']) IS NOT TRUE OR public.canonical_pricing_text(s->'referenceId',200) IS NOT TRUE OR s->>'referenceId'=ANY(used) THEN RAISE EXCEPTION 'Overhead inclusion duplicate' USING ERRCODE='22023';END IF;used:=array_append(used,s->>'referenceId');SELECT value INTO ref FROM jsonb_array_elements(COALESCE(basis->'overheadIncluded','[]')) WHERE value->>'referenceId'=s->>'referenceId';amount:=public.canonical_pricing_money(s->'amount');IF ref IS NULL OR amount IS NULL OR amount>public.canonical_pricing_money(ref->'amount') THEN RAISE EXCEPTION 'Overhead inclusion unavailable' USING ERRCODE='22023';END IF;included:=included+amount;
END LOOP;
IF included>gross THEN RAISE EXCEPTION 'Overhead overclaimed' USING ERRCODE='22023';END IF;overlap_resolved:=c->>'status'<>'unknown' AND basis->'overheadUnresolved' IS DISTINCT FROM 'true'::jsonb;incremental:=CASE WHEN overlap_resolved THEN gross-included ELSE NULL END;
RETURN jsonb_build_object('calculationVersion','estimate-pricing-plan-v1','currency',currency_value,'lines',rows,'proposedBeforeTax',public.canonical_pricing_decimal(subtotal),'payments',payments,'missingLines',missing,'overhead',jsonb_build_object('gross',public.canonical_pricing_decimal(gross),'alreadyIncluded',public.canonical_pricing_decimal(included),'incremental',public.canonical_pricing_decimal(incremental),'overlapResolved',overlap_resolved),'directCosts',public.canonical_pricing_decimal(direct),'costWithOverhead',public.canonical_pricing_decimal(direct+incremental));
END $$;

CREATE FUNCTION public.canonical_pricing_basis(org UUID,estimate UUID,selected BIGINT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snap JSONB;d public.canonical_estimate_revisions%ROWTYPE;mp public.canonical_material_plans%ROWTYPE;lp public.canonical_labor_plans%ROWTYPE;ep public.canonical_equipment_cost_plans%ROWTYPE;tp public.canonical_travel_plans%ROWTYPE;l JSONB;c JSONB;charge JSONB;data JSONB;values JSONB;applicable JSONB;refs JSONB:='[]';q NUMERIC;w NUMERIC;planned NUMERIC;amount NUMERIC;direct NUMERIC:=0;complete BOOLEAN:=TRUE;kind TEXT;parent_pins JSONB;expected JSONB;coverage JSONB;component_value JSONB;
BEGIN
SELECT snapshot INTO snap FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;
IF snap IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
IF selected IS NULL THEN SELECT * INTO d FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;ELSIF selected>1 THEN SELECT * INTO d FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate AND revision=selected;IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;END IF;
IF d.id IS NULL THEN RETURN jsonb_build_object('directCosts',public.canonical_pricing_decimal(public.canonical_pricing_recorded(snap->'knownDirectCosts')),'overheadIncluded','[]'::jsonb,'componentManifest',NULL,'coverage',NULL);END IF;
SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate AND id=d.material_plan_id;
SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate AND id=d.labor_plan_id;
SELECT * INTO ep FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate AND id=d.equipment_cost_plan_id;
SELECT * INTO tp FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate AND id=d.travel_plan_id;
values:=jsonb_build_object('material',public.canonical_pricing_recorded(snap->'knownDirectMaterialCost'),'labor',public.canonical_pricing_recorded(snap->'knownInternalLaborCost'),'equipment',public.canonical_pricing_recorded(snap->'knownEquipmentCost'),'travel',public.canonical_pricing_recorded(snap#>'{travel,knownInternalCost}'));
applicable:=jsonb_build_object('material',CASE WHEN public.canonical_pricing_recorded(snap->'materialsCharge') IS NULL THEN NULL ELSE (snap->>'materialsCharge')::numeric>0 END,'labor',CASE WHEN public.canonical_pricing_recorded(snap->'laborCharge') IS NULL THEN NULL ELSE (snap->>'laborCharge')::numeric>0 END,'equipment',CASE WHEN public.canonical_pricing_recorded(snap->'equipmentCharge') IS NULL THEN NULL ELSE (snap->>'equipmentCharge')::numeric>0 END,'travel',CASE WHEN snap#>'{travel,distanceMiles}'='null'::jsonb THEN FALSE WHEN jsonb_typeof(snap#>'{travel,distanceMiles}')='number' AND (snap#>>'{travel,distanceMiles}')::numeric>=0 THEN TRUE ELSE NULL END);
IF mp.id IS NOT NULL THEN
 amount:=0;FOR l IN SELECT value FROM jsonb_array_elements(CASE WHEN mp.calculation_version='estimate-material-plan-v1' THEN jsonb_build_array(mp.inputs) ELSE mp.inputs->'lines' END) LOOP
 q:=(l->>'quantity')::numeric;w:=(l->>'wastePercent')::numeric;planned:=CASE WHEN l->>'unit'='ea' THEN ceil(q*(100+w)/100) ELSE ceil(q*(100+w)*10000)/1000000 END;amount:=amount+round(planned*(l->>'unitPrice')::numeric*100);END LOOP;
 values:=jsonb_set(values,'{material}',to_jsonb(amount));applicable:=jsonb_set(applicable,'{material}','true');END IF;
IF lp.id IS NOT NULL THEN data:=public.canonical_travel_labor_capacities(lp.inputs);amount:=0;FOR l IN SELECT value FROM jsonb_array_elements(lp.inputs->'lines') LOOP c:=data->(l->>'lineId');IF c='null'::jsonb THEN complete:=FALSE;ELSE amount:=amount+(c#>>'{}')::numeric;refs:=refs||jsonb_build_array(jsonb_build_object('referenceId','labor:'||lp.id::text||':'||(l->>'lineId'),'label',l->>'task','amount',public.canonical_pricing_decimal((c#>>'{}')::numeric),'meaning','Maximum recorded task cost. Any overhead share is your declared allocation, not a verified split.'));END IF;END LOOP;values:=jsonb_set(values,'{labor}',to_jsonb(amount));applicable:=jsonb_set(applicable,'{labor}','true');END IF;
IF ep.id IS NOT NULL THEN data:=public.canonical_travel_equipment_capacities(ep.inputs);IF EXISTS(SELECT 1 FROM jsonb_each(data) WHERE value->'complete' IS DISTINCT FROM 'true'::jsonb) THEN complete:=FALSE;END IF;values:=jsonb_set(values,'{equipment}',to_jsonb(public.canonical_equipment_cost_known_cents(ep.inputs)));applicable:=jsonb_set(applicable,'{equipment}','true');
 IF d.calculation_version='estimate-cost-adoption-v2' THEN parent_pins:=ep.source_pins-'revision';expected:=jsonb_build_object('operator',public.canonical_estimate_revision_plan_reference(CASE WHEN lp.id IS NULL THEN NULL ELSE public.canonical_labor_plan_projection(lp) END),'travel',jsonb_build_object('kind','original','originalSourcePins',parent_pins));
 FOR l IN SELECT value FROM jsonb_array_elements(ep.inputs->'lines') LOOP
 FOR charge IN SELECT value FROM jsonb_array_elements(jsonb_build_array(l#>'{rental,charge}',l#>'{allocation,pool}',l#>'{operating,allIn,rate}',l#>'{operating,fuelEnergy,rate}',l#>'{operating,consumables,rate}',l#>'{operating,maintenance,rate}')||COALESCE((SELECT jsonb_agg(value->'charge') FROM jsonb_array_elements(COALESCE(l#>'{allocation,additionalCosts}','[]'))),'[]')) LOOP
 IF charge->>'scope'='mixed' THEN FOREACH kind IN ARRAY ARRAY['operator','travel'] LOOP IF (charge#>>ARRAY['split',kind])::numeric>0 AND charge#>>ARRAY['split',kind||'Coverage','status']='covered' AND charge#>ARRAY['split',kind||'Coverage','basis'] IS DISTINCT FROM expected->kind THEN complete:=FALSE;END IF;END LOOP;END IF;END LOOP;END LOOP;END IF;
END IF;
IF tp.id IS NOT NULL THEN data:=public.canonical_travel_plan_calculate(tp.inputs);IF data->'complete' IS DISTINCT FROM 'true'::jsonb THEN complete:=FALSE;END IF;amount:=(data->>'totalCents')::numeric;component_value:=public.canonical_estimate_revision_components_v3(d);amount:=amount-public.canonical_travel_coverage_require(component_value,CASE WHEN lp.id IS NULL THEN NULL ELSE public.canonical_labor_plan_projection(lp) END,CASE WHEN ep.id IS NULL THEN NULL ELSE public.canonical_equipment_cost_projection(ep) END,public.canonical_travel_plan_projection(tp),snap,d.coverage_assessment);values:=jsonb_set(values,'{travel}',COALESCE(to_jsonb(amount),'null'));applicable:=jsonb_set(applicable,'{travel}','true');END IF;
IF d.calculation_version='estimate-cost-adoption-v3' AND tp.id IS NULL THEN PERFORM public.canonical_travel_coverage_require(public.canonical_estimate_revision_components_v3(d),CASE WHEN lp.id IS NULL THEN NULL ELSE public.canonical_labor_plan_projection(lp) END,CASE WHEN ep.id IS NULL THEN NULL ELSE public.canonical_equipment_cost_projection(ep) END,NULL,snap,d.coverage_assessment);END IF;
IF snap#>'{service,supported}' IS DISTINCT FROM 'true'::jsonb THEN complete:=FALSE;END IF;
FOREACH kind IN ARRAY ARRAY['material','labor','equipment','travel'] LOOP IF applicable->kind='null'::jsonb THEN complete:=FALSE;ELSIF applicable->kind='true'::jsonb THEN IF values->kind='null'::jsonb THEN complete:=FALSE;ELSE direct:=direct+(values->>kind)::numeric;END IF;END IF;END LOOP;
RETURN jsonb_build_object('directCosts',CASE WHEN complete THEN public.canonical_pricing_decimal(direct) ELSE NULL END,'overheadIncluded',refs,'componentManifest',d.component_manifest,'coverage',d.coverage_assessment);
END $$;

CREATE FUNCTION public.canonical_pricing_sources(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,selected BIGINT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE profile JSONB;profile_id UUID;profile_hash TEXT;knowledge JSONB;payload JSONB;service_key TEXT;
BEGIN
IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') OR role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Protected pricing review required' USING ERRCODE='42501';END IF;
PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
SELECT p.raw_profile,p.id,rtrim(p.normalized_profile_hash) INTO profile,profile_id,profile_hash FROM public.organization_onboarding o JOIN public.canonical_business_profiles p ON p.organization_id=o.organization_id AND p.id=o.active_business_profile_id AND p.is_active=TRUE WHERE o.organization_id=org AND o.status='complete' FOR SHARE OF o,p;
IF NOT FOUND THEN RAISE EXCEPTION 'Current profile unavailable' USING ERRCODE='42501';END IF;
SELECT snapshot#>>'{service,key}' INTO service_key FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
WITH latest AS (SELECT DISTINCT ON(entry_id) * FROM public.canonical_knowledge_publications WHERE organization_id=org ORDER BY entry_id,publication_number DESC,id), selected_rows AS (
 SELECT e.id entry_id,e.canonical_key,e.entry_type,v.id version_id,v.version_number,v.sensitivity,v.review_requirement,v.canonical_document,v.canonical_digest,p.id publication_id,p.publication_number,p.canonical_digest publication_digest
 FROM latest p JOIN public.canonical_knowledge_entries e ON e.organization_id=p.organization_id AND e.id=p.entry_id JOIN public.canonical_knowledge_versions v ON v.organization_id=p.organization_id AND v.entry_id=p.entry_id AND v.id=p.version_id
 WHERE e.canonical_key IN ('organization.financial-constraints','organization.services') OR v.applicability->'projection'->'capabilities' ?| ARRAY['financial_constraints','services'] ORDER BY e.canonical_key,p.id LIMIT 257)
SELECT COALESCE(jsonb_agg(to_jsonb(selected_rows)),'[]'::jsonb) INTO knowledge FROM selected_rows;
IF jsonb_array_length(knowledge)>256 THEN RAISE EXCEPTION 'Pricing source limit' USING ERRCODE='54000';END IF;
payload:=jsonb_build_object('serviceKey',service_key,'basis',public.canonical_pricing_basis(org,estimate,selected),'asOfDate',(clock_timestamp() AT TIME ZONE 'UTC')::date::text,'profilePin',jsonb_build_object('id',profile_id,'digest',profile_hash),'pricingProfile',jsonb_build_object('pricing',profile->'canonicalPricing','overheadPercent',profile#>'{canonicalCosts,overheadPercent}'),'knowledgeRows',knowledge);
RETURN payload||jsonb_build_object('digest',public.canonical_completion_digest(payload));
END $$;
CREATE FUNCTION public.canonical_pricing_require(v JSONB,sources JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s JSONB;row_value JSONB;doc JSONB;projection JSONB;
BEGIN
IF v->>'serviceKey' IS DISTINCT FROM sources->>'serviceKey' THEN RAISE EXCEPTION 'Pricing service changed' USING ERRCODE='40001';END IF;
FOR s IN SELECT value->'source' FROM jsonb_array_elements(v->'lines') UNION ALL SELECT v#>'{overhead,source}' LOOP
PERFORM public.canonical_pricing_source_validate(s);
IF s->>'kind'='profile' THEN IF s->>'referenceId' IS DISTINCT FROM sources#>>'{profilePin,id}' OR s->>'digest' IS DISTINCT FROM sources#>>'{profilePin,digest}' THEN RAISE EXCEPTION 'Pricing profile changed' USING ERRCODE='40001';END IF;
ELSIF s->>'kind'='published_knowledge' THEN
 SELECT value INTO row_value FROM jsonb_array_elements(sources->'knowledgeRows') WHERE value->>'publication_id'=s->>'referenceId' AND btrim(value->>'canonical_digest')=s->>'digest' AND btrim(value->>'publication_digest')=s->>'digest';
 IF row_value IS NULL THEN RAISE EXCEPTION 'Pricing publication unavailable' USING ERRCODE='40001';END IF;
 doc:=(row_value->>'canonical_document')::jsonb;projection:=doc#>'{applicability,projection}';
 IF doc#>>'{content,state}'='tombstoned' OR projection?'audiences' AND NOT projection->'audiences'?'internal' OR projection?'consumers' AND NOT projection->'consumers'?'northstar_assistant' OR projection?'capabilities' AND NOT projection->'capabilities' ?| ARRAY['financial_constraints','services'] THEN RAISE EXCEPTION 'Pricing source unavailable' USING ERRCODE='40001';END IF;
END IF;END LOOP;
END $$;
CREATE TABLE public.canonical_pricing_plans (
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
 evidence JSONB,
 inputs JSONB,
 result JSONB,
 evidence_digest TEXT NOT NULL CHECK(evidence_digest~'^[0-9a-f]{64}$'),
 calculation_version TEXT NOT NULL DEFAULT 'estimate-pricing-plan-v1' CHECK(calculation_version='estimate-pricing-plan-v1'),
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-pricing-plan-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_pricing_plans(organization_id,estimate_id,id),
 CHECK((action='save' AND inputs IS NOT NULL) OR (action='withdraw' AND inputs IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_pricing_plan_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_pricing_plan_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_pricing_plans FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_pricing_plan_immutable();

CREATE FUNCTION public.canonical_pricing_plan_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_decision_source(org,estimate) $$;
CREATE FUNCTION public.canonical_pricing_plan_projection(d public.canonical_pricing_plans) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'evidence',d.evidence,'evidenceDigest',d.evidence_digest,'result',d.result,'inputs',d.inputs,'calculationVersion',d.calculation_version,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_pricing_plan_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_pricing_plan_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_pricing_plans WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_pricing_plan_projection(d) INTO current_value FROM public.canonical_pricing_plans d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_pricing_plan_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_pricing_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
CREATE FUNCTION public.canonical_pricing_plan_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; old public.canonical_pricing_plans%ROWTYPE; current_row public.canonical_pricing_plans%ROWTYPE;
 inserted public.canonical_pricing_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; evidence_value JSONB; decision_row public.canonical_estimate_decisions%ROWTYPE;
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
 PERFORM public.canonical_travel_fence(org,estimate);
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 source_value:=public.canonical_pricing_plan_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion','evidenceDigest']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-pricing-plan-v1' OR
  public.canonical_pricing_text(body->'reason',2000) IS NOT TRUE OR jsonb_typeof(body->'evidenceDigest') IS DISTINCT FROM 'string' OR (body->>'evidenceDigest')!~'^[0-9a-f]{64}$' OR (body->>'expectedRevision')::bigint>10000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN IF jsonb_typeof(body->'inputs') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Pricing inputs invalid' USING ERRCODE='22023';END IF;
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':pricing-plan:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_pricing_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- Replays retain their historical result; current authority is required after all waits.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_pricing_plan_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_pricing_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='travel_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>10000 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
IF body->>'action'='save' THEN evidence_value:=public.canonical_pricing_sources(org,actor,role_value,session_value,estimate,NULL);IF body->>'evidenceDigest' IS DISTINCT FROM evidence_value->>'digest' THEN RAISE EXCEPTION 'Pricing source changed' USING ERRCODE='40001';END IF;PERFORM public.canonical_pricing_require(body->'inputs',evidence_value);PERFORM public.canonical_pricing_calculate(body->'inputs',current_currency,evidence_value->'basis');PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); END IF;
  SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_pricing_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,evidence,result,evidence_digest,inputs,expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,evidence_value,CASE WHEN body->>'action'='save' THEN public.canonical_pricing_calculate(body->'inputs',current_currency,evidence_value->'basis') ELSE NULL END,body->>'evidenceDigest',NULLIF(body->'inputs','null'::jsonb),(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),'estimate-pricing-plan-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_pricing_plan_projection(inserted),'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_pricing_plans FROM PUBLIC;
DO $$ DECLARE fn RECORD;BEGIN FOR fn IN SELECT oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_pricing_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn.identity||' FROM PUBLIC';END LOOP;END $$;
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost','equipment_ready','travel_plan','pricing_plan'));
