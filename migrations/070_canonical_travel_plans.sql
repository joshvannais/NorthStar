-- Mission24 Part5. All67 prior migration files remain byte-identical.
CREATE FUNCTION public.canonical_travel_round(r NUMERIC[]) RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT div(r[1]*2+r[2],r[2]*2) $$;
CREATE FUNCTION public.canonical_travel_add(r NUMERIC[],amount NUMERIC,multiplier NUMERIC DEFAULT 1,denominator NUMERIC DEFAULT 1) RETURNS NUMERIC[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF amount IS NULL OR multiplier IS NULL OR denominator IS NULL THEN RETURN r;END IF;IF denominator<=0 THEN RAISE EXCEPTION 'Travel denominator invalid' USING ERRCODE='22023';END IF;RETURN ARRAY[r[1]*denominator+amount*multiplier*r[2],r[2]*denominator];END $$;
CREATE FUNCTION public.canonical_travel_source_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN PERFORM public.canonical_equipment_cost_source_validate(CASE WHEN v->>'kind'='recorded_caller' THEN jsonb_set(v,'{kind}','"company_reference"'::jsonb) ELSE v END);END $$;
CREATE FUNCTION public.canonical_travel_location_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['kind','label','sourceId','sourceDigest','latitude','longitude']) IS NOT TRUE OR COALESCE(v->>'kind','') NOT IN ('business_location','recorded_job','declared') OR public.canonical_labor_plan_text(v->'label',500) IS NOT TRUE THEN RAISE EXCEPTION 'Travel location invalid' USING ERRCODE='22023';END IF;
 IF v->>'kind'='declared' THEN IF v->'sourceId' IS DISTINCT FROM 'null'::jsonb OR v->'sourceDigest' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Declared location source invalid' USING ERRCODE='22023';END IF;
 ELSIF public.canonical_labor_plan_text(v->'sourceId',160) IS NOT TRUE OR COALESCE(v->>'sourceDigest','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Location source invalid' USING ERRCODE='22023';END IF;
 IF (v->'latitude'='null'::jsonb) IS DISTINCT FROM (v->'longitude'='null'::jsonb) THEN RAISE EXCEPTION 'Location coordinate pair invalid' USING ERRCODE='22023';END IF;
 IF v->'latitude' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(v->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'longitude') IS DISTINCT FROM 'number' OR (v->>'latitude')::numeric NOT BETWEEN -90 AND 90 OR (v->>'longitude')::numeric NOT BETWEEN -180 AND 180) THEN RAISE EXCEPTION 'Location coordinates invalid' USING ERRCODE='22023';END IF;
END $$;
CREATE FUNCTION public.canonical_travel_measure(v JSONB,units TEXT[]) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['value','unit','basis']) IS NOT TRUE OR NOT(COALESCE(v->>'unit','')=ANY(units)) OR COALESCE(v->>'basis','') NOT IN ('estimated','reported','straight_line') THEN RAISE EXCEPTION 'Travel measurement invalid' USING ERRCODE='22023';END IF;RETURN public.canonical_equipment_cost_quantity(v->'value');END $$;
CREATE FUNCTION public.canonical_travel_trip(l JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE distance NUMERIC;duration NUMERIC;trips NUMERIC;vehicles NUMERIC;people NUMERIC;legs NUMERIC;vehicle_legs NUMERIC;distance_den NUMERIC;hours_den NUMERIC;v JSONB;labor JSONB;rate NUMERIC;r JSONB;eff NUMERIC;used NUMERIC;used_den NUMERIC;burden NUMERIC;sum NUMERIC[]:=ARRAY[0,1]::numeric[];complete BOOLEAN:=TRUE;seen TEXT[]:=ARRAY[]::text[];cents NUMERIC;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','purpose','origin','destination','distance','time','returnIncluded','trips','vehicles','people','vehicle','labor','source']) IS NOT TRUE OR public.canonical_labor_plan_text(l->'purpose',160) IS NOT TRUE OR jsonb_typeof(l->'returnIncluded') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Travel trip invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_travel_location_validate(l->'origin');PERFORM public.canonical_travel_location_validate(l->'destination');PERFORM public.canonical_travel_source_validate(l->'source');
 distance:=public.canonical_travel_measure(l->'distance',ARRAY['mi','km']);duration:=public.canonical_travel_measure(l->'time',ARRAY['min','hour']);IF l#>>'{time,basis}'='straight_line' THEN RAISE EXCEPTION 'Geometry is not travel time' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(l->'trips') IS DISTINCT FROM 'number' OR COALESCE(l->>'trips','')!~'^[1-9][0-9]{0,3}$' OR (l->>'trips')::numeric>1000 OR jsonb_typeof(l->'vehicles') IS DISTINCT FROM 'number' OR COALESCE(l->>'vehicles','')!~'^[1-9][0-9]{0,2}$' OR (l->>'vehicles')::numeric>100 OR (l->'people' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(l->'people') IS DISTINCT FROM 'number' OR COALESCE(l->>'people','')!~'^(0|[1-9][0-9]{0,2})$' OR (l->>'people')::numeric>100)) THEN RAISE EXCEPTION 'Trip counts invalid' USING ERRCODE='22023';END IF;
 trips:=(l->>'trips')::numeric;vehicles:=(l->>'vehicles')::numeric;people:=(l->>'people')::numeric;legs:=trips*CASE WHEN l->'returnIncluded'='true'::jsonb THEN 2 ELSE 1 END;vehicle_legs:=legs*vehicles;v:=l->'vehicle';
 IF v->>'method'='not_applicable' THEN IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['method','reason']) IS NOT TRUE OR public.canonical_labor_plan_text(v->'reason',500) IS NOT TRUE THEN RAISE EXCEPTION 'Vehicle applicability invalid' USING ERRCODE='22023';END IF;
 ELSIF v->>'method' IN ('all_in_distance','itemized_distance') THEN
  IF v->>'method'='all_in_distance' THEN IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['method','rate','unit']) IS NOT TRUE THEN RAISE EXCEPTION 'All-in vehicle cost invalid' USING ERRCODE='22023';END IF;
  ELSE IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['method','rates']) IS NOT TRUE OR jsonb_typeof(v->'rates') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'rates')<>3 THEN RAISE EXCEPTION 'Vehicle categories invalid' USING ERRCODE='22023';END IF;END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(CASE WHEN v->>'method'='all_in_distance' THEN jsonb_build_array(v) ELSE v->'rates' END) LOOP
   IF v->>'method'='itemized_distance' THEN
    IF public.canonical_field_evidence_object_keys_exact(r,ARRAY['category','applicable','rate','unit','reason']) IS NOT TRUE OR COALESCE(r->>'category','') NOT IN ('fuel_energy','maintenance','ownership_insurance') OR r->>'category'=ANY(seen) OR jsonb_typeof(r->'applicable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Duplicate vehicle category' USING ERRCODE='22023';END IF;seen:=array_append(seen,r->>'category');
    IF r->'applicable'='false'::jsonb THEN IF r->'rate' IS DISTINCT FROM 'null'::jsonb OR public.canonical_labor_plan_text(r->'reason',500) IS NOT TRUE THEN RAISE EXCEPTION 'Vehicle category applicability invalid' USING ERRCODE='22023';END IF;CONTINUE;
    ELSIF r->'reason' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Vehicle category reason invalid' USING ERRCODE='22023';END IF;
   END IF;
   IF COALESCE(r->>'unit','') NOT IN ('mi','km') THEN RAISE EXCEPTION 'Vehicle distance unit invalid' USING ERRCODE='22023';END IF;rate:=public.canonical_equipment_cost_money(r->'rate');
   IF rate IS NULL OR distance IS NULL OR l#>>'{distance,basis}'='straight_line' THEN complete:=FALSE;ELSE distance_den:=CASE WHEN l#>>'{distance,unit}'='km' AND r->>'unit'='mi' THEN 1.609344 ELSE 1 END;sum:=public.canonical_travel_add(sum,rate*100,distance*vehicle_legs*CASE WHEN l#>>'{distance,unit}'='mi' AND r->>'unit'='km' THEN 1.609344 ELSE 1 END,distance_den);END IF;
  END LOOP;
 ELSIF v->>'method'='consumption' THEN
  IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['method','unit','price','basis','quantity','efficiency','otherCosts']) IS NOT TRUE OR COALESCE(v->>'unit','') NOT IN ('us_gal','l','kwh') OR COALESCE(v->>'basis','') NOT IN ('whole_job','per_vehicle_leg','efficiency') OR public.canonical_field_evidence_object_keys_exact(v->'otherCosts',ARRAY['status','note']) IS NOT TRUE OR COALESCE(v#>>'{otherCosts,status}','') NOT IN ('included_elsewhere','not_applicable','unknown') OR public.canonical_labor_plan_text(v#>'{otherCosts,note}',500) IS NOT TRUE THEN RAISE EXCEPTION 'Consumption basis invalid' USING ERRCODE='22023';END IF;
  IF v#>>'{otherCosts,status}'='unknown' THEN complete:=FALSE;END IF;rate:=public.canonical_equipment_cost_money(v->'price');used:=NULL;used_den:=1;
  IF v->>'basis'='efficiency' THEN
   IF v->'quantity' IS DISTINCT FROM 'null'::jsonb OR public.canonical_field_evidence_object_keys_exact(v->'efficiency',ARRAY['value','unit']) IS NOT TRUE OR v#>>'{efficiency,unit}' IS DISTINCT FROM (CASE v->>'unit' WHEN 'us_gal' THEN 'mi_per_us_gal' WHEN 'l' THEN 'l_per_100km' ELSE 'kwh_per_100km' END) THEN RAISE EXCEPTION 'Efficiency unit invalid' USING ERRCODE='22023';END IF;
   eff:=public.canonical_equipment_cost_quantity(v#>'{efficiency,value}');IF eff=0 THEN RAISE EXCEPTION 'Efficiency must be positive' USING ERRCODE='22023';END IF;
   IF eff IS NOT NULL AND distance IS NOT NULL AND l#>>'{distance,basis}'<>'straight_line' THEN
    IF v->>'unit'='us_gal' THEN used:=distance*vehicle_legs;used_den:=eff*CASE WHEN l#>>'{distance,unit}'='km' THEN 1.609344 ELSE 1 END;
    ELSE used:=distance*eff*vehicle_legs*CASE WHEN l#>>'{distance,unit}'='mi' THEN 1.609344 ELSE 1 END;used_den:=100;END IF;
   END IF;
  ELSE IF v->'efficiency' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Consumption duplicates efficiency' USING ERRCODE='22023';END IF;used:=public.canonical_equipment_cost_quantity(v->'quantity')*CASE WHEN v->>'basis'='whole_job' THEN 1 ELSE vehicle_legs END;END IF;
  IF used IS NULL OR rate IS NULL THEN complete:=FALSE;ELSE sum:=public.canonical_travel_add(sum,rate*100,used,used_den);END IF;
 ELSIF v->>'method'='job_charge' THEN
  IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['method','amount','scope']) IS NOT TRUE OR COALESCE(v->>'scope','') NOT IN ('whole_job','per_vehicle_trip') THEN RAISE EXCEPTION 'Vehicle job charge invalid' USING ERRCODE='22023';END IF;rate:=public.canonical_equipment_cost_money(v->'amount');IF rate IS NULL THEN complete:=FALSE;ELSE sum:=public.canonical_travel_add(sum,rate*100,CASE WHEN v->>'scope'='whole_job' THEN 1 ELSE vehicles*trips END);END IF;
 ELSE RAISE EXCEPTION 'Vehicle method invalid' USING ERRCODE='22023';END IF;
 labor:=l->'labor';
 IF labor->>'method'='not_applicable' THEN IF public.canonical_field_evidence_object_keys_exact(labor,ARRAY['method','reason']) IS NOT TRUE OR public.canonical_labor_plan_text(labor->'reason',500) IS NOT TRUE THEN RAISE EXCEPTION 'Travel labor applicability invalid' USING ERRCODE='22023';END IF;
 ELSE
  IF public.canonical_field_evidence_object_keys_exact(labor,ARRAY['method','rate','burdenPercent']) IS NOT TRUE OR COALESCE(labor->>'method','') NOT IN ('all_in','base_burden') THEN RAISE EXCEPTION 'Travel labor invalid' USING ERRCODE='22023';END IF;
  rate:=public.canonical_equipment_cost_money(labor->'rate');burden:=0;
  IF labor->>'method'='all_in' THEN IF labor->'burdenPercent' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Travel labor burden duplicated' USING ERRCODE='22023';END IF;
  ELSE burden:=public.canonical_equipment_cost_quantity(labor->'burdenPercent');IF burden>100 THEN RAISE EXCEPTION 'Travel burden invalid' USING ERRCODE='22023';END IF;END IF;
  IF duration IS NULL OR rate IS NULL OR burden IS NULL OR people IS NULL THEN complete:=FALSE;ELSE hours_den:=CASE WHEN l#>>'{time,unit}'='min' THEN 60 ELSE 1 END;sum:=public.canonical_travel_add(sum,rate*100,duration*legs*people*(100+burden),hours_den*100);END IF;
 END IF;
 cents:=public.canonical_travel_round(sum);IF cents>99999999999999 THEN RAISE EXCEPTION 'Travel total overflow' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('lineId',l->>'lineId','knownCents',cents,'complete',complete,'tripLegs',legs,'vehicleLegs',vehicle_legs,'exactNumerator',sum[1],'exactDenominator',sum[2]);
END $$;
CREATE FUNCTION public.canonical_travel_plan_calculate(v JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;t JSONB;r JSONB;ids TEXT[]:=ARRAY[]::text[];lines JSONB:='[]';total NUMERIC:=0;complete BOOLEAN:=TRUE;amount NUMERIC;q NUMERIC;factor NUMERIC;ts TIMESTAMPTZ;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['serviceKey','trips','logistics','access','hauls','loadBindings','stagePlan','assessment']) IS NOT TRUE OR public.canonical_labor_plan_text(v->'serviceKey',160) IS NOT TRUE OR jsonb_typeof(v->'trips') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'logistics') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'access') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Travel plan invalid' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(v->'trips')>12 OR jsonb_array_length(v->'logistics')>12 OR jsonb_array_length(v->'access')>12 OR jsonb_array_length(v->'trips')+jsonb_array_length(v->'logistics')=0 THEN RAISE EXCEPTION 'Travel plan bounds invalid' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements((v->'trips')||(v->'logistics')||(v->'access')) LOOP
  IF COALESCE(l->>'lineId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR lower(l->>'lineId')=ANY(ids) THEN RAISE EXCEPTION 'Travel identity invalid' USING ERRCODE='22023';END IF;ids:=array_append(ids,lower(l->>'lineId'));
 END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'trips') LOOP r:=public.canonical_travel_trip(l);total:=total+(r->>'knownCents')::numeric;complete:=complete AND (r->>'complete')::boolean;lines:=lines||jsonb_build_array(r);END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'logistics') LOOP
  IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','label','category','applicable','reason','basis','tripId','quantity','unit','rate','source']) IS NOT TRUE OR public.canonical_labor_plan_text(l->'label',160) IS NOT TRUE OR COALESCE(l->>'category','') NOT IN ('mobilization','loading','waiting','delivery','tolls','parking','permit','accommodation','access') OR jsonb_typeof(l->'applicable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Logistics line invalid' USING ERRCODE='22023';END IF;PERFORM public.canonical_travel_source_validate(l->'source');
  IF l->'applicable'='false'::jsonb THEN IF public.canonical_labor_plan_text(l->'reason',500) IS NOT TRUE OR l->>'basis' IS DISTINCT FROM 'whole_job' OR l->'tripId' IS DISTINCT FROM 'null'::jsonb OR l->'quantity' IS DISTINCT FROM 'null'::jsonb OR l->'unit' IS DISTINCT FROM 'null'::jsonb OR l->'rate' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Logistics applicability invalid' USING ERRCODE='22023';END IF;amount:=0;
  ELSE
   IF l->'reason' IS DISTINCT FROM 'null'::jsonb OR COALESCE(l->>'basis','') NOT IN ('whole_job','per_trip','per_vehicle_trip') OR COALESCE(l->>'unit','') NOT IN ('job','trip','day','hour','item') THEN RAISE EXCEPTION 'Logistics basis invalid' USING ERRCODE='22023';END IF;factor:=1;
   IF l->>'basis'='whole_job' THEN IF l->'tripId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Whole job trip invalid' USING ERRCODE='22023';END IF;
   ELSE SELECT x INTO t FROM jsonb_array_elements(v->'trips') x WHERE x->>'lineId'=l->>'tripId';IF t IS NULL THEN RAISE EXCEPTION 'Logistics trip missing' USING ERRCODE='22023';END IF;factor:=(t->>'trips')::numeric*CASE WHEN l->>'basis'='per_vehicle_trip' THEN (t->>'vehicles')::numeric ELSE 1 END;END IF;
   q:=public.canonical_equipment_cost_quantity(l->'quantity');IF l->>'unit'='job' AND q IS NOT NULL AND q<>1 THEN RAISE EXCEPTION 'Job quantity invalid' USING ERRCODE='22023';END IF;amount:=public.canonical_equipment_cost_money(l->'rate');IF amount IS NOT NULL AND q IS NOT NULL THEN amount:=public.canonical_travel_round(ARRAY[amount*100*q*factor,1]);ELSE amount:=NULL;complete:=FALSE;END IF;
  END IF;
  IF amount>99999999999999 THEN RAISE EXCEPTION 'Logistics overflow' USING ERRCODE='22023';END IF;total:=total+COALESCE(amount,0);lines:=lines||jsonb_build_array(jsonb_build_object('lineId',l->>'lineId','knownCents',COALESCE(amount,0),'complete',amount IS NOT NULL));
 END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'access') LOOP
  IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','label','status','start','end','appliesToJob','source']) IS NOT TRUE OR public.canonical_labor_plan_text(l->'label',160) IS NOT TRUE OR COALESCE(l->>'status','') NOT IN ('closed','open','unknown') OR l->'appliesToJob' NOT IN ('true'::jsonb,'false'::jsonb,'null'::jsonb) THEN RAISE EXCEPTION 'Access entry invalid' USING ERRCODE='22023';END IF;PERFORM public.canonical_travel_source_validate(l->'source');
  FOREACH t IN ARRAY ARRAY[l->'start',l->'end'] LOOP IF t IS DISTINCT FROM 'null'::jsonb THEN IF jsonb_typeof(t) IS DISTINCT FROM 'string' OR (t#>>'{}')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' THEN RAISE EXCEPTION 'Access time invalid' USING ERRCODE='22023';END IF;ts:=(t#>>'{}')::timestamptz;END IF;END LOOP;
  IF l->>'start' IS NOT NULL AND l->>'end' IS NOT NULL AND (l->>'end')::timestamptz<=(l->>'start')::timestamptz THEN RAISE EXCEPTION 'Access time order invalid' USING ERRCODE='22023';END IF;
 END LOOP;
 complete:=public.canonical_travel_load_bindings(v->'hauls',v->'loadBindings',v->'trips') AND complete;IF v->'stagePlan' IS DISTINCT FROM 'null'::jsonb THEN PERFORM public.canonical_travel_stages(v->'stagePlan');END IF;
 IF total>99999999999999 THEN RAISE EXCEPTION 'Travel total overflow' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('knownCents',total,'totalCents',CASE WHEN complete THEN total ELSE NULL END,'complete',complete,'lines',lines);
END $$;

CREATE FUNCTION public.canonical_travel_location_sources(org UUID,estimate UUID,raw JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE profile JSONB;profile_id UUID;profile_hash TEXT;scope_value JSONB;service_key TEXT;loc JSONB;locs JSONB:='[]';label_value TEXT;payload JSONB;id_value TEXT;latitude JSONB;longitude JSONB;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN RAISE EXCEPTION 'Protected travel source snapshot required' USING ERRCODE='42501';END IF;
 SELECT p.raw_profile,p.id,rtrim(p.normalized_profile_hash) INTO profile,profile_id,profile_hash FROM public.organization_onboarding o JOIN public.canonical_business_profiles p ON p.organization_id=o.organization_id AND p.id=o.active_business_profile_id AND p.is_active=TRUE WHERE o.organization_id=org AND o.status='complete' FOR SHARE OF o,p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current profile unavailable' USING ERRCODE='42501';END IF;
 SELECT o.job_scope,o.service_type INTO scope_value,service_key FROM public.canonical_estimates e JOIN public.canonical_opportunities o ON o.organization_id=e.organization_id AND o.id=e.opportunity_id WHERE e.organization_id=org AND e.id=estimate FOR SHARE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='P0002';END IF;
 FOR loc IN SELECT x FROM jsonb_array_elements(jsonb_build_array(COALESCE(profile->'headquarters','{}')||jsonb_build_object('id','headquarters'))||CASE WHEN jsonb_typeof(profile#>'{headquarters,additionalOffices}')='array' THEN profile#>'{headquarters,additionalOffices}' ELSE '[]' END) x LOOP
  id_value:=loc->>'id';IF id_value IS NULL OR id_value!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' OR public.canonical_labor_plan_text(loc->'street',300) IS NOT TRUE THEN CONTINUE;END IF;
  label_value:=concat_ws(', ',NULLIF(btrim(loc->>'street'),''),NULLIF(btrim(loc->>'city'),''),NULLIF(btrim(loc->>'state'),''),NULLIF(btrim(loc->>'zip'),''),NULLIF(btrim(loc->>'country'),''));
  latitude:=CASE WHEN jsonb_typeof(loc->'latitude')='number' AND jsonb_typeof(loc->'longitude')='number' THEN loc->'latitude' ELSE 'null'::jsonb END;longitude:=CASE WHEN latitude<>'null'::jsonb THEN loc->'longitude' ELSE 'null'::jsonb END;
  locs:=locs||jsonb_build_array(jsonb_build_object('kind','business_location','label',label_value,'sourceId',id_value,'sourceDigest',public.canonical_completion_digest(jsonb_build_object('profileId',profile_id,'profileHash',profile_hash,'location',loc)),'latitude',latitude,'longitude',longitude));
 END LOOP;
 IF public.canonical_labor_plan_text(scope_value->'address',500) THEN locs:=locs||jsonb_build_array(jsonb_build_object('kind','recorded_job','label',scope_value->>'address','sourceId',estimate::text,'sourceDigest',public.canonical_completion_digest(scope_value),'latitude',NULL,'longitude',NULL));END IF;
 payload:=jsonb_build_object('resourceChoices',public.canonical_travel_resource_choices(org,estimate),'locations',locs,'serviceKey',raw->>'serviceKey','profilePin',jsonb_build_object('id',profile_id,'digest',profile_hash),'serviceArea',COALESCE(profile->'serviceArea','{}'::jsonb),'bufferMinutes',greatest(CASE WHEN jsonb_typeof(profile#>'{scheduling,travelBuffer}')='number' THEN (profile#>>'{scheduling,travelBuffer}')::numeric ELSE NULL END,CASE WHEN jsonb_typeof(profile#>'{scheduling,appointmentBuffer}')='number' THEN (profile#>>'{scheduling,appointmentBuffer}')::numeric ELSE NULL END),'knowledgeRows',raw->'knowledgeRows','scope',COALESCE(scope_value,'{}'::jsonb),'truncated',raw->'truncated');
 RETURN payload||jsonb_build_object('digest',public.canonical_completion_digest(payload));
END $$;
CREATE FUNCTION public.canonical_travel_plan_sources(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw JSONB;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') OR role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Protected travel review required' USING ERRCODE='42501';END IF;
 raw:=public.canonical_equipment_plan_sources(org,actor,role_value,session_value,estimate,NULL);
 RETURN public.canonical_travel_location_sources(org,estimate,raw);
END $$;
CREATE FUNCTION public.canonical_travel_plan_assess(v JSONB,day_value DATE) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;e JSONB;codes JSONB;cautions JSONB:='[]';
BEGIN
 PERFORM public.canonical_travel_plan_calculate(v);
 FOR l IN SELECT value FROM jsonb_array_elements((v->'trips')||(v->'logistics')||(v->'access')||(v->'hauls')||(SELECT COALESCE(jsonb_agg(jsonb_build_object('lineId',h->'lineId','source',h#>'{detail,density,source}')),'[]'::jsonb) FROM jsonb_array_elements(v->'hauls') h WHERE h#>'{detail,density}' IS NOT NULL AND h#>'{detail,density}'<>'null'::jsonb)||(SELECT COALESCE(jsonb_agg(x||jsonb_build_object('lineId',x->>'resourceId')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(v#>'{stagePlan,resources}','[]'::jsonb)) x)||(SELECT COALESCE(jsonb_agg(x||jsonb_build_object('lineId',x->>'stageId')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(v#>'{stagePlan,stages}','[]'::jsonb)) x)) LOOP
 e:=l->'source';codes:='[]';
 IF e->>'effectiveOn' IS NULL THEN codes:=codes||'"date_unknown"'::jsonb;ELSIF (e->>'effectiveOn')::date>day_value THEN codes:=codes||'"not_yet_effective"'::jsonb;END IF;
 IF e->>'endsOn' IS NULL THEN codes:=codes||'"freshness_unknown"'::jsonb;ELSIF (e->>'endsOn')::date<day_value THEN codes:=codes||'"expired"'::jsonb;END IF;
 IF public.canonical_labor_plan_text(e->'geography',160) IS NOT TRUE THEN codes:=codes||'"applicability_unknown"'::jsonb;END IF;
 IF jsonb_array_length(codes)>0 THEN cautions:=cautions||jsonb_build_array(jsonb_build_object('lineId',l->>'lineId','codes',codes));END IF;END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'trips') LOOP codes:='[]';
 IF l#>>'{origin,kind}'='declared' OR l#>>'{destination,kind}'='declared' THEN codes:=codes||'"location_declared"'::jsonb;END IF;
 IF l#>>'{distance,value}' IS NULL THEN codes:=codes||'"distance_unknown"'::jsonb;ELSIF l#>>'{distance,basis}'='straight_line' THEN codes:=codes||'"not_driving_distance"'::jsonb;END IF;
 IF l#>>'{time,value}' IS NULL THEN codes:=codes||'"travel_time_unknown"'::jsonb;END IF;
 IF jsonb_array_length(codes)>0 THEN cautions:=cautions||jsonb_build_array(jsonb_build_object('lineId',l->>'lineId','codes',codes));END IF;END LOOP;
 RETURN jsonb_build_object('date',to_char(day_value,'YYYY-MM-DD'),'cautions',cautions);
END $$;
CREATE FUNCTION public.canonical_travel_plan_require(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,v JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sources JSONB;expected JSONB;a JSONB:=v->'assessment';l JSONB;loc JSONB;
BEGIN
 sources:=public.canonical_travel_plan_sources(org,actor,role_value,session_value,estimate);
 expected:=public.canonical_travel_plan_assess(v,(clock_timestamp() AT TIME ZONE 'UTC')::date)||jsonb_build_object('sourcesDigest',sources->>'digest');
 IF v->>'serviceKey' IS DISTINCT FROM sources->>'serviceKey' OR public.canonical_field_evidence_object_keys_exact(a,ARRAY['date','cautions','sourcesDigest','acknowledged','explanation']) IS NOT TRUE OR (a-'acknowledged'-'explanation') IS DISTINCT FROM expected OR a->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR public.canonical_labor_plan_text(a->'explanation',1000,jsonb_array_length(expected->'cautions')=0) IS NOT TRUE THEN RAISE EXCEPTION 'Travel source review changed' USING ERRCODE='40001';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'trips') LOOP FOREACH loc IN ARRAY ARRAY[l->'origin',l->'destination'] LOOP IF loc->>'kind'<>'declared' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources->'locations') x WHERE x=loc) THEN RAISE EXCEPTION 'Travel location changed' USING ERRCODE='40001';END IF;END LOOP;END LOOP;
 PERFORM public.canonical_travel_resource_require(v,sources);
 RETURN sources;
END $$;

CREATE TABLE public.canonical_travel_plans (
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
 calculation_version TEXT NOT NULL DEFAULT 'estimate-travel-plan-v1' CHECK(calculation_version='estimate-travel-plan-v1'),
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-travel-plan-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_travel_plans(organization_id,estimate_id,id),
 CHECK((action='save' AND inputs IS NOT NULL) OR (action='withdraw' AND inputs IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_travel_plan_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_travel_plan_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_travel_plans FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_travel_plan_immutable();

CREATE FUNCTION public.canonical_travel_plan_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_decision_source(org,estimate) $$;
CREATE FUNCTION public.canonical_travel_plan_projection(d public.canonical_travel_plans) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'evidence',d.evidence,'inputs',d.inputs,'calculationVersion',d.calculation_version,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_travel_plan_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_travel_plan_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_travel_plan_projection(d) INTO current_value FROM public.canonical_travel_plans d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_travel_plan_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
-- Private shared write fence: ordinary reads never call this helper.
CREATE TABLE public.canonical_travel_fences (
 organization_id UUID NOT NULL, estimate_id UUID NOT NULL, counter BIGINT NOT NULL,
 PRIMARY KEY(organization_id,estimate_id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id)
);
CREATE FUNCTION public.canonical_travel_fence(org UUID,estimate UUID) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 INSERT INTO public.canonical_travel_fences(organization_id,estimate_id,counter) VALUES(org,estimate,1)
 ON CONFLICT(organization_id,estimate_id) DO UPDATE SET counter=canonical_travel_fences.counter+1;
END $$;
REVOKE ALL ON TABLE public.canonical_travel_fences FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_fence(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.canonical_travel_plan_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; old public.canonical_travel_plans%ROWTYPE; current_row public.canonical_travel_plans%ROWTYPE;
 inserted public.canonical_travel_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; evidence_value JSONB; decision_row public.canonical_estimate_decisions%ROWTYPE;
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
 source_value:=public.canonical_travel_plan_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-travel-plan-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN PERFORM public.canonical_travel_plan_calculate(body->'inputs');
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':travel-plan:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_travel_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before return_leg it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_travel_plan_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='travel_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>10000 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
IF body->>'action'='save' THEN evidence_value:=public.canonical_travel_plan_require(org,actor,role_value,session_value,estimate,body->'inputs'); PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); END IF;
  SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_travel_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,evidence,inputs,expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,evidence_value,NULLIF(body->'inputs','null'::jsonb),(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),'estimate-travel-plan-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_travel_plan_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_travel_plans FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_plan_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_plan_source(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_plan_projection(public.canonical_travel_plans) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_plan_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_plan_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;


ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost','equipment_ready','travel_plan'));

DO $$ DECLARE f RECORD;BEGIN FOR f IN SELECT oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_travel_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.identity||' FROM PUBLIC';END LOOP;END $$;

-- Versioned fourth component. Earlier row formats and plan bytes remain immutable.
ALTER TABLE public.canonical_estimate_revisions ADD COLUMN travel_plan_id UUID;
ALTER TABLE public.canonical_estimate_revisions ADD COLUMN coverage_assessment JSONB;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revision_travel_fk FOREIGN KEY(organization_id,estimate_id,travel_plan_id) REFERENCES public.canonical_travel_plans(organization_id,estimate_id,id);
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revisions_calculation_version_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revisions_calculation_version_check CHECK(calculation_version IN ('estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4','estimate-cost-adoption-v1','estimate-cost-adoption-v2','estimate-cost-adoption-v3'));
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revision_components_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revision_components_check CHECK(CASE
 WHEN calculation_version='estimate-cost-adoption-v3' THEN changed_component IN ('material','labor','equipment','travel') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND public.canonical_field_evidence_object_keys_exact(component_manifest,ARRAY['material','labor','equipment','travel']) AND coverage_assessment IS NOT NULL AND jsonb_typeof(coverage_assessment)='object' AND CASE changed_component WHEN 'material' THEN material_plan_id IS NOT NULL WHEN 'labor' THEN labor_plan_id IS NOT NULL WHEN 'equipment' THEN equipment_cost_plan_id IS NOT NULL ELSE travel_plan_id IS NOT NULL END
 WHEN calculation_version='estimate-cost-adoption-v2' THEN travel_plan_id IS NULL AND coverage_assessment IS NULL AND changed_component IN ('material','labor','equipment') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND public.canonical_field_evidence_object_keys_exact(component_manifest,ARRAY['material','labor','equipment']) AND CASE changed_component WHEN 'material' THEN material_plan_id IS NOT NULL WHEN 'labor' THEN labor_plan_id IS NOT NULL ELSE equipment_cost_plan_id IS NOT NULL END
 WHEN calculation_version='estimate-cost-adoption-v1' THEN travel_plan_id IS NULL AND coverage_assessment IS NULL AND equipment_cost_plan_id IS NULL AND changed_component IN ('material','labor') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND jsonb_typeof(component_manifest)='object' AND CASE WHEN changed_component='material' THEN material_plan_id IS NOT NULL ELSE labor_plan_id IS NOT NULL END
 ELSE travel_plan_id IS NULL AND coverage_assessment IS NULL AND material_plan_id IS NOT NULL AND labor_plan_id IS NULL AND equipment_cost_plan_id IS NULL AND changed_component IS NULL AND component_manifest IS NULL END);
DROP INDEX public.canonical_revision_legacy_material_once;
CREATE UNIQUE INDEX canonical_revision_legacy_material_once ON public.canonical_estimate_revisions(organization_id,estimate_id,material_plan_id) WHERE calculation_version NOT IN ('estimate-cost-adoption-v1','estimate-cost-adoption-v2','estimate-cost-adoption-v3');
CREATE UNIQUE INDEX canonical_revision_component_v3_once ON public.canonical_estimate_revisions(organization_id,estimate_id,COALESCE(previous_id,estimate_id),changed_component,(CASE changed_component WHEN 'material' THEN material_plan_id WHEN 'labor' THEN labor_plan_id WHEN 'equipment' THEN equipment_cost_plan_id ELSE travel_plan_id END)) WHERE calculation_version='estimate-cost-adoption-v3';
CREATE FUNCTION public.canonical_estimate_revision_components_v3(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN d.calculation_version='estimate-cost-adoption-v3' THEN d.component_manifest ELSE public.canonical_estimate_revision_components_v2(d)||jsonb_build_object('travel',jsonb_build_object('kind','original')) END $$;
ALTER FUNCTION public.canonical_estimate_revision_projection(public.canonical_estimate_revisions) RENAME TO canonical_estimate_revision_projection_v068;
CREATE FUNCTION public.canonical_estimate_revision_projection(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN d.calculation_version='estimate-cost-adoption-v3' THEN public.canonical_estimate_revision_projection_legacy(d)||jsonb_build_object('changedComponent',d.changed_component,'componentManifest',d.component_manifest,'coverageAssessment',d.coverage_assessment,'laborPlanId',d.labor_plan_id,'laborPlan',(SELECT public.canonical_labor_plan_projection(l) FROM public.canonical_labor_plans l WHERE l.organization_id=d.organization_id AND l.estimate_id=d.estimate_id AND l.id=d.labor_plan_id),'equipmentCostPlanId',d.equipment_cost_plan_id,'equipmentCostPlan',(SELECT public.canonical_equipment_cost_projection(e)-'evidence' FROM public.canonical_equipment_cost_plans e WHERE e.organization_id=d.organization_id AND e.estimate_id=d.estimate_id AND e.id=d.equipment_cost_plan_id),'travelPlanId',d.travel_plan_id,'travelPlan',(SELECT public.canonical_travel_plan_projection(t)-'evidence' FROM public.canonical_travel_plans t WHERE t.organization_id=d.organization_id AND t.estimate_id=d.estimate_id AND t.id=d.travel_plan_id)) ELSE public.canonical_estimate_revision_projection_v068(d) END $$;
CREATE FUNCTION public.canonical_estimate_revision_cost_assessment_v3(m JSONB,l JSONB,e JSONB,t JSONB,service_key TEXT,day_value DATE) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_revision_cost_assessment_v2(m,l,e,service_key,day_value)||jsonb_build_object('travelSource',CASE WHEN t IS NULL THEN NULL ELSE public.canonical_travel_plan_assess(t->'inputs',day_value) END) $$;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_components_v3(public.canonical_estimate_revisions),public.canonical_estimate_revision_projection_v068(public.canonical_estimate_revisions),public.canonical_estimate_revision_cost_assessment_v3(jsonb,jsonb,jsonb,jsonb,text,date) FROM PUBLIC;

-- Exact declared hauling dimensions; no density or material-yield default.
CREATE FUNCTION public.canonical_travel_fraction(n NUMERIC,d NUMERIC) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a NUMERIC:=abs(n);b NUMERIC:=d;t NUMERIC;
BEGIN IF d<=0 OR n<>trunc(n) OR d<>trunc(d) THEN RAISE EXCEPTION 'Fraction invalid' USING ERRCODE='22023';END IF;WHILE b<>0 LOOP t:=mod(a,b);a:=b;b:=t;END LOOP;RETURN jsonb_build_object('numerator',div(n,a)::text,'denominator',div(d,a)::text);END $$;
CREATE FUNCTION public.canonical_travel_haul(h JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE k TEXT;d JSONB;q JSONB;out_value NUMERIC;retained NUMERIC;capacity NUMERIC;existing NUMERIC;remaining NUMERIC;unknown BOOLEAN:=FALSE;active INT:=0;positive INT:=0;dimensions JSONB:='{}';fn NUMERIC:=1;fd NUMERIC:=1;en NUMERIC:=1;ed NUMERIC:=1;rn NUMERIC;rd NUMERIC;count_after NUMERIC;count_value NUMERIC;lastn NUMERIC;lastd NUMERIC;first_value JSONB:='{}';last_value JSONB:='{}';firstn NUMERIC;firstd NUMERIC;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(h,ARRAY['lineId','label','material','homogeneous','volume','mass','initialLoadOwner','initialLoadNote','source']) IS NOT TRUE OR COALESCE(h->>'lineId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR public.canonical_labor_plan_text(h->'label',160) IS NOT TRUE OR public.canonical_labor_plan_text(h->'material',160) IS NOT TRUE OR jsonb_typeof(h->'homogeneous') IS DISTINCT FROM 'boolean' OR COALESCE(h->>'initialLoadOwner','') NOT IN ('this_job','other_job','unknown') OR public.canonical_labor_plan_text(h->'initialLoadNote',500) IS NOT TRUE THEN RAISE EXCEPTION 'Haul input invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_travel_source_validate(h->'source');
 FOREACH k IN ARRAY ARRAY['volume','mass'] LOOP
 d:=h->k;
 IF public.canonical_field_evidence_object_keys_exact(d,ARRAY['applicable','reason','unit','output','retained','capacity','existing']) IS NOT TRUE OR d->'applicable' NOT IN ('true'::jsonb,'false'::jsonb,'null'::jsonb) OR (k='volume' AND COALESCE(d->>'unit','') NOT IN ('yd3','m3')) OR (k='mass' AND COALESCE(d->>'unit','') NOT IN ('lb','kg')) THEN RAISE EXCEPTION 'Haul dimension invalid' USING ERRCODE='22023';END IF;
 out_value:=public.canonical_equipment_cost_quantity(d->'output')*1000000;retained:=public.canonical_equipment_cost_quantity(d->'retained')*1000000;capacity:=public.canonical_equipment_cost_quantity(d->'capacity')*1000000;existing:=public.canonical_equipment_cost_quantity(d->'existing')*1000000;
 IF d->'applicable'='false'::jsonb THEN IF public.canonical_labor_plan_text(d->'reason',500) IS NOT TRUE OR out_value IS NOT NULL OR retained IS NOT NULL OR capacity IS NOT NULL OR existing IS NOT NULL THEN RAISE EXCEPTION 'Non-applicable dimension invalid' USING ERRCODE='22023';END IF;CONTINUE;END IF;
 active:=active+1;
 IF d->'reason' IS DISTINCT FROM 'null'::jsonb OR retained>out_value OR existing>capacity OR capacity=0 THEN RAISE EXCEPTION 'Haul quantity conflicts' USING ERRCODE='22023';END IF;
 IF d->'applicable' IS DISTINCT FROM 'true'::jsonb OR out_value IS NULL OR retained IS NULL OR capacity IS NULL OR existing IS NULL THEN unknown:=TRUE;CONTINUE;END IF;
 remaining:=out_value-retained;dimensions:=dimensions||jsonb_build_object(k,jsonb_build_object('unit',d->>'unit','remaining',remaining,'capacity',capacity,'existing',existing));
 IF remaining>0 THEN positive:=positive+1;IF (capacity-existing)*fd<fn*remaining THEN fn:=capacity-existing;fd:=remaining;END IF;IF capacity*ed<en*remaining THEN en:=capacity;ed:=remaining;END IF;END IF;
 END LOOP;
 IF active=0 THEN RAISE EXCEPTION 'Applicable capacity required' USING ERRCODE='22023';END IF;
 IF unknown OR h->'homogeneous'='false'::jsonb THEN RETURN jsonb_build_object('complete',FALSE,'additionalLoads',NULL,'firstLoad',NULL,'lastLoad',NULL,'existingDisposalIncluded',FALSE);END IF;
 IF positive>0 AND positive<active THEN RAISE EXCEPTION 'Recorded dimensions conflict' USING ERRCODE='22023';END IF;
 IF positive=0 THEN RETURN jsonb_build_object('complete',h->>'initialLoadOwner'<>'unknown','additionalLoads',0,'firstLoad',NULL,'lastLoad',NULL,'existingDisposalIncluded',FALSE);END IF;
 rn:=fd-fn;rd:=fd;count_after:=CASE WHEN rn=0 THEN 0 ELSE div(rn*ed+rd*en-1,rd*en) END;
 count_value:=CASE WHEN fn>0 THEN 1 ELSE 0 END+count_after;
 IF count_value>1000 THEN RAISE EXCEPTION 'Haul count exceeds limit' USING ERRCODE='22023';END IF;
 IF count_after>0 THEN lastn:=rn*ed-en*(count_after-1)*rd;lastd:=rd*ed;ELSE lastn:=fn;lastd:=fd;END IF;
 firstn:=CASE WHEN fn>0 THEN fn ELSE en END;firstd:=CASE WHEN fn>0 THEN fd ELSE ed END;
 FOR k,d IN SELECT key,value FROM jsonb_each(dimensions) LOOP
 first_value:=first_value||jsonb_build_object(k,jsonb_build_object('unit',d->>'unit','quantity',public.canonical_travel_fraction((d->>'remaining')::numeric*firstn,1000000*firstd)));
 last_value:=last_value||jsonb_build_object(k,jsonb_build_object('unit',d->>'unit','quantity',public.canonical_travel_fraction((d->>'remaining')::numeric*lastn,1000000*lastd)));
 END LOOP;
 RETURN jsonb_build_object('complete',h->>'initialLoadOwner'<>'unknown','additionalLoads',count_value,'firstLoad',first_value,'lastLoad',last_value,'lastLoadPartial',lastn*ed<en*lastd,'initialClearanceRequired',fn=0,'existingDisposalIncluded',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_fraction(numeric,numeric),public.canonical_travel_haul(jsonb) FROM PUBLIC;

CREATE FUNCTION public.canonical_travel_stages(v JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r JSONB;s JSONB;prior JSONB;resource JSONB;resources JSONB:='{}';done JSONB:='{}';key_value TEXT;stage_key TEXT;duration NUMERIC;start_value NUMERIC;end_value NUMERIC;elapsed NUMERIC:=0;people NUMERIC;person_minutes NUMERIC:=0;unknown BOOLEAN:=FALSE;unresolved BOOLEAN:=FALSE;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['resources','stages']) IS NOT TRUE OR jsonb_typeof(v->'resources') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'stages') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'resources')>12 OR jsonb_array_length(v->'stages')>12 THEN RAISE EXCEPTION 'Stage input invalid' USING ERRCODE='22023';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(v->'resources') LOOP
 IF public.canonical_field_evidence_object_keys_exact(r,CASE WHEN r?'binding' THEN ARRAY['resourceId','label','kind','available','source','binding'] ELSE ARRAY['resourceId','label','kind','available','source'] END) IS NOT TRUE OR COALESCE(r->>'resourceId','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR public.canonical_labor_plan_text(r->'label',160) IS NOT TRUE OR COALESCE(r->>'kind','') NOT IN ('person','equipment') OR r->'available' NOT IN ('true'::jsonb,'false'::jsonb,'null'::jsonb) OR resources ? (r->>'resourceId') THEN RAISE EXCEPTION 'Stage resource invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_travel_source_validate(r->'source');resources:=resources||jsonb_build_object(r->>'resourceId',r);
 END LOOP;
 IF jsonb_array_length(v->'stages')=0 THEN unresolved:=TRUE;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(v->'stages') LOOP
 IF jsonb_array_length(s->'resourceIds')=0 THEN unresolved:=TRUE;END IF;
 IF s?'presence' AND (s->>'presence' IS NULL OR s->>'presence' NOT IN ('onsite','away','unknown')) THEN RAISE EXCEPTION 'Review stage presence' USING ERRCODE='22023';END IF;stage_key:=s->>'stageId';
 IF public.canonical_field_evidence_object_keys_exact(s,CASE WHEN s?'presence' THEN ARRAY['stageId','label','kind','duration','unit','dependencies','resourceIds','source','presence'] ELSE ARRAY['stageId','label','kind','duration','unit','dependencies','resourceIds','source'] END) IS NOT TRUE OR COALESCE(stage_key,'')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR public.canonical_labor_plan_text(s->'label',160) IS NOT TRUE OR COALESCE(s->>'kind','') NOT IN ('travel','loading','queue','unloading','onsite','other') OR COALESCE(s->>'unit','') NOT IN ('min','hour') OR jsonb_typeof(s->'dependencies') IS DISTINCT FROM 'array' OR jsonb_typeof(s->'resourceIds') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'dependencies')>12 OR jsonb_array_length(s->'resourceIds')>12 OR done ? stage_key THEN RAISE EXCEPTION 'Stage invalid' USING ERRCODE='22023';END IF;
 IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(s->'dependencies')) OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(s->'resourceIds')) THEN RAISE EXCEPTION 'Stage relationship duplicate' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_travel_source_validate(s->'source');
 duration:=public.canonical_equipment_cost_quantity(s->'duration')*1000000*CASE WHEN s->>'unit'='hour' THEN 60 ELSE 1 END;start_value:=0;
 FOR key_value IN SELECT value FROM jsonb_array_elements_text(s->'dependencies') LOOP
 IF NOT(done ? key_value) THEN RAISE EXCEPTION 'Dependency must be earlier stage' USING ERRCODE='22023';END IF;
 prior:=done->key_value;IF prior->'end'='null'::jsonb THEN start_value:=NULL;ELSIF start_value IS NOT NULL THEN start_value:=greatest(start_value,(prior->>'end')::numeric);END IF;
 END LOOP;
 end_value:=start_value+duration;IF end_value IS NULL THEN unknown:=TRUE;ELSE elapsed:=greatest(elapsed,end_value);END IF;people:=0;
 FOR key_value IN SELECT value FROM jsonb_array_elements_text(s->'resourceIds') LOOP
 IF NOT(resources ? key_value) THEN RAISE EXCEPTION 'Recorded resource required' USING ERRCODE='22023';END IF;
 resource:=resources->key_value;IF resource->>'kind'='person' THEN people:=people+1;END IF;IF resource->'available' IS DISTINCT FROM 'true'::jsonb THEN unresolved:=TRUE;END IF;
 FOR prior IN SELECT value FROM jsonb_each(done) LOOP
 IF prior->'resourceIds' ? key_value AND start_value<(prior->>'end')::numeric AND (prior->>'start')::numeric<end_value THEN unresolved:=TRUE;END IF;
 END LOOP;
 END LOOP;
 person_minutes:=person_minutes+duration*people;
 done:=done||jsonb_build_object(stage_key,jsonb_build_object('start',start_value,'end',end_value,'resourceIds',s->'resourceIds'));
 END LOOP;
 RETURN jsonb_build_object('declaredElapsedMinutes',CASE WHEN unknown THEN NULL ELSE public.canonical_travel_fraction(elapsed,1000000) END,'feasibleElapsedMinutes',CASE WHEN unknown OR unresolved THEN NULL ELSE public.canonical_travel_fraction(elapsed,1000000) END,'personMinutes',CASE WHEN person_minutes IS NULL THEN NULL ELSE public.canonical_travel_fraction(person_minutes,1000000) END);
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_stages(jsonb) FROM PUBLIC;

CREATE FUNCTION public.canonical_travel_load_bindings(groups JSONB,bindings JSONB,trips JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h JSONB;b JSONB;t JSONB;calc JSONB;results JSONB:='{}';used TEXT[]:=ARRAY[]::text[];roles TEXT[]:=ARRAY[]::text[];key_value TEXT;expected NUMERIC;complete BOOLEAN:=TRUE;outbound JSONB;return_leg JSONB;final_leg JSONB;return_count NUMERIC;
BEGIN
 IF jsonb_typeof(groups) IS DISTINCT FROM 'array' OR jsonb_typeof(bindings) IS DISTINCT FROM 'array' OR jsonb_array_length(groups)>12 OR jsonb_array_length(bindings)>36 THEN RAISE EXCEPTION 'Load bindings invalid' USING ERRCODE='22023';END IF;
 FOR h IN SELECT value FROM jsonb_array_elements(groups) LOOP
 IF results ? (h->>'lineId') THEN RAISE EXCEPTION 'Duplicate haul group' USING ERRCODE='22023';END IF;calc:=public.canonical_travel_haul(h);results:=results||jsonb_build_object(h->>'lineId',calc);IF calc->'complete' IS DISTINCT FROM 'true'::jsonb THEN complete:=FALSE;END IF;
 END LOOP;
 FOR b IN SELECT value FROM jsonb_array_elements(bindings) LOOP
 IF public.canonical_field_evidence_object_keys_exact(b,ARRAY['groupId','tripId','role','countBasis']) IS NOT TRUE OR COALESCE(b->>'role','') NOT IN ('outbound','return','final') OR COALESCE(b->>'countBasis','') NOT IN ('all_loads','except_last','once') THEN RAISE EXCEPTION 'Route load binding invalid' USING ERRCODE='22023';END IF;
 SELECT value INTO t FROM jsonb_array_elements(trips) WHERE value->>'lineId'=b->>'tripId';calc:=results->(b->>'groupId');key_value:=(b->>'groupId')||':'||(b->>'role');
 IF t IS NULL OR calc IS NULL OR (b->>'tripId')=ANY(used) OR key_value=ANY(roles) THEN RAISE EXCEPTION 'Route binding unavailable or duplicated' USING ERRCODE='22023';END IF;
 used:=array_append(used,b->>'tripId');roles:=array_append(roles,key_value);
 IF t->'returnIncluded' IS DISTINCT FROM 'false'::jsonb OR b->>'role'='outbound' AND b->>'countBasis'<>'all_loads' OR b->>'role'='final' AND b->>'countBasis'<>'once' THEN RAISE EXCEPTION 'Review one-way load legs' USING ERRCODE='22023';END IF;
 IF calc->'additionalLoads'='null'::jsonb THEN complete:=FALSE;CONTINUE;END IF;
 expected:=(calc->>'additionalLoads')::numeric;IF b->>'countBasis'='except_last' THEN expected:=greatest(0,expected-1);ELSIF b->>'countBasis'='once' THEN expected:=CASE WHEN expected>0 THEN 1 ELSE 0 END;END IF;
 IF (t->>'trips')::numeric*(t->>'vehicles')::numeric<>expected THEN RAISE EXCEPTION 'Vehicle trips differ from loads' USING ERRCODE='22023';END IF;
 END LOOP;
 FOR key_value,calc IN SELECT key,value FROM jsonb_each(results) LOOP
 SELECT trip INTO outbound FROM jsonb_array_elements(bindings) link CROSS JOIN jsonb_array_elements(trips) trip WHERE link->>'groupId'=key_value AND link->>'role'='outbound' AND trip->>'lineId'=link->>'tripId';
 SELECT trip INTO return_leg FROM jsonb_array_elements(bindings) link CROSS JOIN jsonb_array_elements(trips) trip WHERE link->>'groupId'=key_value AND link->>'role'='return' AND trip->>'lineId'=link->>'tripId';
 SELECT trip INTO final_leg FROM jsonb_array_elements(bindings) link CROSS JOIN jsonb_array_elements(trips) trip WHERE link->>'groupId'=key_value AND link->>'role'='final' AND trip->>'lineId'=link->>'tripId';
 IF calc->'additionalLoads' IS DISTINCT FROM '0'::jsonb AND outbound IS NULL THEN complete:=FALSE;END IF;
 IF outbound IS NOT NULL AND return_leg IS NOT NULL AND (return_leg->'origin' IS DISTINCT FROM outbound->'destination' OR return_leg->'destination' IS DISTINCT FROM outbound->'origin') THEN RAISE EXCEPTION 'Return endpoints differ' USING ERRCODE='22023';END IF;
 return_count:=COALESCE((return_leg->>'trips')::numeric*(return_leg->>'vehicles')::numeric,0);
 IF (calc->>'additionalLoads')::numeric>0 AND return_count<(calc->>'additionalLoads')::numeric-1 THEN complete:=FALSE;END IF;
 IF (calc->>'additionalLoads')::numeric>0 AND final_leg IS NULL AND return_count<(calc->>'additionalLoads')::numeric THEN complete:=FALSE;END IF;
 IF outbound IS NOT NULL AND final_leg IS NOT NULL AND final_leg->'origin' IS DISTINCT FROM (CASE WHEN return_count=(calc->>'additionalLoads')::numeric THEN outbound->'origin' ELSE outbound->'destination' END) THEN RAISE EXCEPTION 'Final route origin differs' USING ERRCODE='22023';END IF;
 END LOOP;
 RETURN complete;
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_load_bindings(jsonb,jsonb,jsonb) FROM PUBLIC;

-- Recompute bounded source capacities for explicit v3 allocation ownership.
CREATE FUNCTION public.canonical_travel_labor_capacities(v JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;hours NUMERIC;rate NUMERIC;burden NUMERIC;amount NUMERIC;result JSONB:='{}';
BEGIN
 PERFORM public.canonical_labor_plan_validate(v);
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
 hours:=CASE l->>'basis' WHEN 'worker_hours' THEN (l->>'workerHours')::numeric WHEN 'people_time' THEN (l->>'people')::numeric*(l->>'elapsedHours')::numeric ELSE (l->>'quantity')::numeric*(l->>'hoursPerUnit')::numeric END;
 rate:=(l->>'hourlyCost')::numeric;burden:=CASE WHEN l->>'rateMode'='all_in' THEN 0 ELSE (l->>'burdenPercent')::numeric END;
 amount:=CASE WHEN rate IS NULL OR burden IS NULL THEN NULL ELSE public.canonical_travel_round(ARRAY[hours*rate*(100+burden),1]) END;
 IF amount>99999999999999 THEN RAISE EXCEPTION 'Labor amount overflow' USING ERRCODE='22023';END IF;result:=result||jsonb_build_object(l->>'lineId',amount);
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.canonical_travel_equipment_capacities(v JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;c JSONB;entry JSONB;charges JSONB;part TEXT;hours NUMERIC;n NUMERIC;d NUMERIC;amount NUMERIC;sum NUMERIC[];result JSONB:='{}';line_value JSONB;complete BOOLEAN;
BEGIN
 PERFORM public.canonical_equipment_cost_validate(v);
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
 IF l->>'method'='not_applicable' THEN result:=result||jsonb_build_object(l->>'lineId',jsonb_build_object('equipment',0,'operator',0,'travel',0,'complete',TRUE));CONTINUE;END IF;
 hours:=(l->>'plannedHours')::numeric;charges:='[]';complete:=TRUE;
 IF l->>'method'='rental' THEN charges:=charges||jsonb_build_array(jsonb_build_object('charge',l#>'{rental,charge}','n',l#>'{rental,quantity}','d','1'));
 ELSE charges:=charges||jsonb_build_array(jsonb_build_object('charge',l#>'{allocation,pool}','n',l->'plannedHours','d',l#>'{allocation,usableHours}'));FOR entry IN SELECT value FROM jsonb_array_elements(l#>'{allocation,additionalCosts}') LOOP charges:=charges||jsonb_build_array(jsonb_build_object('charge',entry->'charge','n',l->'plannedHours','d',l#>'{allocation,usableHours}'));END LOOP;END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(jsonb_build_array(l#>'{operating,allIn}',l#>'{operating,fuelEnergy}',l#>'{operating,consumables}',l#>'{operating,maintenance}')) LOOP
 IF entry->>'status'='known' THEN charges:=charges||jsonb_build_array(jsonb_build_object('charge',entry->'rate','n',l->'plannedHours','d','1'));ELSIF entry->>'status'='unknown' THEN complete:=FALSE;END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(l->'fees') LOOP charges:=charges||jsonb_build_array(jsonb_build_object('charge',jsonb_build_object('amount',entry->'amount','scope','equipment_only','split',NULL),'n','1','d','1'));END LOOP;
 line_value:='{}';
 FOREACH part IN ARRAY ARRAY['equipment','operator','travel'] LOOP
 sum:=ARRAY[0,1]::numeric[];
 FOR entry IN SELECT value FROM jsonb_array_elements(charges) LOOP
 c:=entry->'charge';n:=(entry->>'n')::numeric;d:=(entry->>'d')::numeric;
 amount:=CASE WHEN c->>'scope'='mixed' THEN (c->'split'->>part)::numeric WHEN part='equipment' THEN (c->>'amount')::numeric ELSE 0 END;
 IF amount IS NULL OR n IS NULL OR d IS NULL OR c->>'amount' IS NULL THEN complete:=FALSE;ELSE sum:=public.canonical_travel_add(sum,amount*100,n,d);END IF;
 END LOOP;
 amount:=public.canonical_travel_round(sum);IF amount>99999999999999 THEN RAISE EXCEPTION 'Equipment amount overflow' USING ERRCODE='22023';END IF;line_value:=line_value||jsonb_build_object(part,amount);
 END LOOP;
 result:=result||jsonb_build_object(l->>'lineId',line_value||jsonb_build_object('complete',complete));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_labor_capacities(jsonb),public.canonical_travel_equipment_capacities(jsonb) FROM PUBLIC;

CREATE FUNCTION public.canonical_travel_category_capacity(l JSONB,category_value TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v JSONB:=l;r JSONB;rates JSONB:='[]';result JSONB;
BEGIN
 IF category_value='travel_labor' THEN v:=jsonb_set(v,'{vehicle}',jsonb_build_object('method','not_applicable','reason','Only the declared labor contribution is measured here.'));
 ELSE
 v:=jsonb_set(v,'{labor}',jsonb_build_object('method','not_applicable','reason','Only the declared vehicle contribution is measured here.'));
 IF l#>>'{vehicle,method}'='itemized_distance' THEN
 IF category_value NOT IN ('fuel_energy','maintenance','ownership_insurance') THEN RETURN NULL;END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(l#>'{vehicle,rates}') LOOP
 IF r->>'category'<>category_value THEN r:=r||jsonb_build_object('applicable',FALSE,'rate',NULL,'reason','Separate contribution.');END IF;rates:=rates||jsonb_build_array(r);END LOOP;v:=jsonb_set(v,'{vehicle,rates}',rates);
 ELSIF l#>>'{vehicle,method}'='consumption' THEN IF category_value<>'fuel_energy' THEN RETURN NULL;END IF;
 ELSIF category_value<>'vehicle' THEN RETURN NULL;END IF;
 END IF;
 result:=public.canonical_travel_trip(v);IF result->'complete' IS DISTINCT FROM 'true'::jsonb THEN RETURN NULL;END IF;
 RETURN div((result->>'exactNumerator')::numeric,(result->>'exactDenominator')::numeric);
END $$;
CREATE FUNCTION public.canonical_travel_claim(claims JSONB,key_value TEXT,amount NUMERIC,capacity NUMERIC) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE total NUMERIC;
BEGIN IF amount IS NULL OR amount<=0 OR capacity IS NULL THEN RAISE EXCEPTION 'Known positive coverage and source required' USING ERRCODE='22023';END IF;total:=COALESCE((claims->>key_value)::numeric,0)+amount;IF total>capacity THEN RAISE EXCEPTION 'Coverage exceeds source capacity' USING ERRCODE='22023';END IF;RETURN claims||jsonb_build_object(key_value,total);END $$;
CREATE FUNCTION public.canonical_travel_source_capacity(kind TEXT,line_value TEXT,labor JSONB,equipment JSONB,travel JSONB,snapshot JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE amount JSONB;
BEGIN
 IF kind='travel' THEN RETURN (travel->line_value->>'amount')::numeric;
 ELSIF kind='labor' THEN IF labor IS NOT NULL THEN RETURN (labor->>line_value)::numeric;END IF;IF line_value<>'original' THEN RETURN NULL;END IF;amount:=snapshot->'knownInternalLaborCost';
 ELSIF kind='equipment' THEN IF equipment IS NOT NULL THEN RETURN (equipment->line_value->>'equipment')::numeric;END IF;IF line_value<>'original' THEN RETURN NULL;END IF;amount:=snapshot->'knownEquipmentCost';
 ELSE RETURN NULL;END IF;
 IF jsonb_typeof(amount) IS DISTINCT FROM 'number' OR (amount#>>'{}')::numeric<0 OR mod((amount#>>'{}')::numeric*100,1)<>0 THEN RETURN NULL;END IF;RETURN (amount#>>'{}')::numeric*100;
END $$;
CREATE FUNCTION public.canonical_travel_coverage_require(component_value JSONB,labor_plan JSONB,equipment_plan JSONB,travel_plan JSONB,snapshot JSONB,coverage JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE labor JSONB;equipment JSONB;travel JSONB:='{}';l JSONB;a JSONB;r JSONB;claims JSONB:='{}';deductions JSONB:='{}';seen TEXT[]:=ARRAY[]::text[];key_value TEXT;line_value TEXT;kind TEXT;amount NUMERIC;capacity NUMERIC;total_deduction NUMERIC:=0;expected NUMERIC;calculated JSONB;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(coverage,CASE WHEN coverage?'travelOutside' THEN ARRAY['componentManifest','overlaps','equipmentOutside','travelOutside','confirmed','reason'] ELSE ARRAY['componentManifest','overlaps','equipmentOutside','confirmed','reason'] END) IS NOT TRUE OR coverage->'componentManifest' IS DISTINCT FROM component_value OR coverage->'confirmed' IS DISTINCT FROM 'true'::jsonb OR public.canonical_labor_plan_text(coverage->'reason',1000) IS NOT TRUE OR jsonb_typeof(coverage->'overlaps') IS DISTINCT FROM 'array' OR jsonb_typeof(coverage->'equipmentOutside') IS DISTINCT FROM 'array' OR jsonb_array_length(coverage->'overlaps')>24 OR jsonb_array_length(coverage->'equipmentOutside')>24 THEN RAISE EXCEPTION 'Current coverage review required' USING ERRCODE='40001';END IF;
 IF labor_plan IS NOT NULL THEN labor:=public.canonical_travel_labor_capacities(labor_plan->'inputs');IF EXISTS(SELECT 1 FROM jsonb_each(labor) WHERE value='null'::jsonb) THEN RAISE EXCEPTION 'Complete labor costs required' USING ERRCODE='22023';END IF;END IF;
 IF equipment_plan IS NOT NULL THEN equipment:=public.canonical_travel_equipment_capacities(equipment_plan->'inputs');IF EXISTS(SELECT 1 FROM jsonb_each(equipment) WHERE value->'complete' IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Complete equipment costs required' USING ERRCODE='22023';END IF;END IF;
 IF travel_plan IS NOT NULL THEN
 calculated:=public.canonical_travel_plan_calculate(travel_plan->'inputs');IF calculated->'complete' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Complete travel costs required' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(travel_plan#>'{inputs,trips}') LOOP r:=public.canonical_travel_trip(l);travel:=travel||jsonb_build_object(l->>'lineId',jsonb_build_object('amount',r->'knownCents','trip',l));END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(travel_plan#>'{inputs,logistics}') LOOP SELECT value INTO r FROM jsonb_array_elements(calculated->'lines') WHERE value->>'lineId'=l->>'lineId';travel:=travel||jsonb_build_object(l->>'lineId',jsonb_build_object('amount',r->'knownCents','category',l->>'category'));END LOOP;
 END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(coverage->'overlaps') LOOP
 IF public.canonical_field_evidence_object_keys_exact(a,ARRAY['travelLineId','category','component','sourceLineId','amount','reason']) IS NOT TRUE OR COALESCE(a->>'component','') NOT IN ('labor','equipment') OR public.canonical_labor_plan_text(a->'reason',500) IS NOT TRUE THEN RAISE EXCEPTION 'Coverage line invalid' USING ERRCODE='22023';END IF;
 amount:=public.canonical_equipment_cost_money(a->'amount')*100;line_value:=a->>'travelLineId';r:=travel->line_value;
 claims:=public.canonical_travel_claim(claims,'source:'||(a->>'component')||':'||(a->>'sourceLineId'),amount,public.canonical_travel_source_capacity(a->>'component',a->>'sourceLineId',labor,equipment,travel,snapshot));
 claims:=public.canonical_travel_claim(claims,'travel:'||line_value,amount,(r->>'amount')::numeric);
 capacity:=CASE WHEN r ? 'trip' THEN public.canonical_travel_category_capacity(r->'trip',a->>'category') WHEN r->>'category'=a->>'category' THEN (r->>'amount')::numeric ELSE NULL END;
 claims:=public.canonical_travel_claim(claims,'category:'||line_value||':'||(a->>'category'),amount,capacity);
 deductions:=deductions||jsonb_build_object(line_value,COALESCE((deductions->>line_value)::numeric,0)+amount);total_deduction:=total_deduction+amount;
 END LOOP;
 FOR a IN SELECT value FROM jsonb_array_elements(coverage->'equipmentOutside') LOOP
 IF public.canonical_field_evidence_object_keys_exact(a,ARRAY['equipmentLineId','kind','component','targetLineId','targetCategory','amount','reason']) IS NOT TRUE OR COALESCE(a->>'kind','') NOT IN ('operator','travel') OR COALESCE(a->>'component','') NOT IN ('labor','travel') OR a->>'kind'='operator' AND a->>'component'<>'labor' OR public.canonical_labor_plan_text(a->'reason',500) IS NOT TRUE THEN RAISE EXCEPTION 'Outside allocation invalid' USING ERRCODE='22023';END IF;
 amount:=public.canonical_equipment_cost_money(a->'amount')*100;key_value:=(a->>'equipmentLineId')||':'||(a->>'kind');expected:=(equipment->(a->>'equipmentLineId')->>(a->>'kind'))::numeric;
 IF expected IS NULL OR expected<=0 OR expected IS DISTINCT FROM amount OR key_value=ANY(seen) THEN RAISE EXCEPTION 'Outside shares must be reviewed exactly once' USING ERRCODE='22023';END IF;seen:=array_append(seen,key_value);
 line_value:=a->>'targetLineId';capacity:=public.canonical_travel_source_capacity(a->>'component',line_value,labor,equipment,travel,snapshot);
 IF a->>'component'='travel' THEN r:=travel->line_value;claims:=public.canonical_travel_claim(claims,'category:'||line_value||':'||(a->>'targetCategory'),amount,CASE WHEN r ? 'trip' THEN public.canonical_travel_category_capacity(r->'trip',a->>'targetCategory') WHEN r->>'category'=a->>'targetCategory' THEN (r->>'amount')::numeric ELSE NULL END);capacity:=capacity-COALESCE((deductions->>line_value)::numeric,0);
 ELSIF a->>'targetCategory' IS DISTINCT FROM 'travel_labor' THEN RAISE EXCEPTION 'Labor allocation category required' USING ERRCODE='22023';END IF;
 claims:=public.canonical_travel_claim(claims,'source:'||(a->>'component')||':'||line_value,amount,capacity);
 END LOOP;
 FOR line_value,l IN SELECT key,value FROM jsonb_each(COALESCE(equipment,'{}')) LOOP FOREACH kind IN ARRAY ARRAY['operator','travel'] LOOP IF (l->>kind)::numeric>0 AND NOT(line_value||':'||kind=ANY(seen)) THEN RAISE EXCEPTION 'Outside equipment share unaccounted' USING ERRCODE='22023';END IF;END LOOP;END LOOP;
 IF coverage?'travelOutside' AND (jsonb_typeof(coverage->'travelOutside') IS DISTINCT FROM 'array' OR jsonb_array_length(coverage->'travelOutside')>12) THEN RAISE EXCEPTION 'Vehicle coverage rows invalid' USING ERRCODE='22023';END IF;
 seen:=ARRAY[]::text[];
 FOR a IN SELECT value FROM jsonb_array_elements(COALESCE(coverage->'travelOutside','[]'::jsonb)) LOOP
 IF public.canonical_field_evidence_object_keys_exact(a,ARRAY['travelLineId','component','sourceLineId','amount','reason']) IS NOT TRUE OR a->>'component' IS DISTINCT FROM 'equipment' OR public.canonical_labor_plan_text(a->'reason',500) IS NOT TRUE OR (a->>'travelLineId')=ANY(seen) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(travel_plan#>'{inputs,trips}') x WHERE x->>'lineId'=a->>'travelLineId' AND x#>>'{vehicle,method}'='consumption' AND x#>>'{vehicle,otherCosts,status}'='included_elsewhere') THEN RAISE EXCEPTION 'Vehicle cost ownership invalid' USING ERRCODE='22023';END IF;
 seen:=array_append(seen,a->>'travelLineId');amount:=public.canonical_equipment_cost_money(a->'amount')*100;
 claims:=public.canonical_travel_claim(claims,'source:equipment:'||(a->>'sourceLineId'),amount,public.canonical_travel_source_capacity('equipment',a->>'sourceLineId',labor,equipment,travel,snapshot));
 END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(COALESCE(travel_plan#>'{inputs,trips}','[]'::jsonb)) LOOP IF l#>>'{vehicle,method}'='consumption' AND l#>>'{vehicle,otherCosts,status}'='included_elsewhere' AND NOT(l->>'lineId'=ANY(seen)) THEN RAISE EXCEPTION 'Other vehicle costs need an exact recorded equipment allocation' USING ERRCODE='22023';END IF;END LOOP;
 RETURN total_deduction;
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_category_capacity(jsonb,text),public.canonical_travel_claim(jsonb,text,numeric,numeric),public.canonical_travel_source_capacity(text,text,jsonb,jsonb,jsonb,jsonb),public.canonical_travel_coverage_require(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC;

-- Preserve prior mutation version and receipts; v3 stores explicit allocation ownership.
ALTER FUNCTION public.canonical_estimate_revision_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) RENAME TO canonical_estimate_revision_mutate_v068;
CREATE OR REPLACE FUNCTION public.canonical_estimate_revision_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; original JSONB; old public.canonical_estimate_revisions%ROWTYPE;
 current_row public.canonical_estimate_revisions%ROWTYPE; inserted public.canonical_estimate_revisions%ROWTYPE;
 legacy_result JSONB;tp public.canonical_travel_plans%ROWTYPE;travel_value JSONB;travel_sources JSONB;snapshot_value JSONB;deduction NUMERIC;ep public.canonical_equipment_cost_plans%ROWTYPE;equipment_value JSONB;plan JSONB; mp public.canonical_material_plans%ROWTYPE; lp public.canonical_labor_plans%ROWTYPE; material_value JSONB; labor_value JSONB; component_value JSONB; service_key TEXT; assessment_value JSONB; decision_row public.canonical_estimate_decisions%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; fingerprint TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT currency INTO current_currency FROM public.canonical_estimates WHERE organization_id=org AND id=estimate FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM public.canonical_travel_fence(org,estimate);
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF body->>'confirmationVersion' IS DISTINCT FROM 'estimate-cost-adoption-v3' THEN
 legacy_result:=public.canonical_estimate_revision_mutate_v068(org,actor,role_value,session_value,estimate,csrf,key_value,body);
 IF legacy_result->'replayed' IS DISTINCT FROM 'true'::jsonb AND legacy_result#>>'{receipt,sourcePins,revision,calculationVersion}'='estimate-cost-adoption-v3' THEN RAISE EXCEPTION 'Use current cost review' USING ERRCODE='40001';END IF;RETURN legacy_result;END IF;

 original:=public.canonical_estimate_revision_original_source(org,estimate);
 source_value:=public.canonical_estimate_decision_source(org,estimate);
 IF source_value IS NULL OR original IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
 public.canonical_field_evidence_object_keys_exact(body,ARRAY['sourcePins','expectedPlanId','expectedPlanRevision','expectedPlanDigest','expectedDecisionRevision','expectedDecisionDigest','reason','confirmed','confirmationVersion','changedComponent','expectedComponents','assessment','coverage']) IS NOT TRUE OR
 body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR (body->>'changedComponent' IS NULL OR body->>'changedComponent' NOT IN ('material','labor','equipment','travel')) OR
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
 SELECT snapshot,snapshot->'service'->>'key' INTO snapshot_value,service_key FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;
 SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.material_plan_id;
 SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.labor_plan_id;
 SELECT * INTO ep FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.equipment_cost_plan_id;
 SELECT * INTO tp FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.travel_plan_id;
 IF body->>'changedComponent'='material' THEN SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_material_plan_projection(mp);
 ELSIF body->>'changedComponent'='labor' THEN SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_labor_plan_projection(lp);
 ELSIF body->>'changedComponent'='travel' THEN SELECT * INTO tp FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_travel_plan_projection(tp);
 ELSE SELECT * INTO ep FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_equipment_cost_projection(ep);END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF body->'sourcePins' IS DISTINCT FROM source_value OR plan->>'id' IS NULL OR plan->>'action'<>'save' OR plan->'sourcePins' IS DISTINCT FROM source_value OR body->>'expectedPlanId' IS DISTINCT FROM plan->>'id' OR body->>'expectedPlanRevision' IS DISTINCT FROM plan->>'revision' OR body->>'expectedPlanDigest' IS DISTINCT FROM plan->>'digest' OR plan->>'currency' IS DISTINCT FROM current_currency OR (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') OR body->'expectedComponents' IS DISTINCT FROM public.canonical_estimate_revision_components_v3(current_row) THEN RAISE EXCEPTION 'Estimate or plan changed' USING ERRCODE='40001';END IF;
 IF (public.canonical_estimate_revision_components_v3(current_row)->(body->>'changedComponent')->>'id')=plan->>'id' THEN RAISE EXCEPTION 'Plan already included' USING ERRCODE='40001';END IF;
 material_value:=CASE WHEN mp.id IS NOT NULL THEN public.canonical_material_plan_projection(mp) ELSE NULL END;labor_value:=CASE WHEN lp.id IS NOT NULL THEN public.canonical_labor_plan_projection(lp) ELSE NULL END;
 equipment_value:=CASE WHEN ep.id IS NOT NULL THEN public.canonical_equipment_cost_projection(ep) ELSE NULL END;
 travel_value:=CASE WHEN tp.id IS NOT NULL THEN public.canonical_travel_plan_projection(tp) ELSE NULL END;
 component_value:=jsonb_build_object('material',public.canonical_estimate_revision_plan_reference(material_value),'labor',public.canonical_estimate_revision_plan_reference(labor_value),'equipment',public.canonical_estimate_revision_equipment_reference(equipment_value),'travel',public.canonical_estimate_revision_plan_reference(travel_value));
 deduction:=public.canonical_travel_coverage_require(component_value,labor_value,equipment_value,travel_value,snapshot_value,body->'coverage');
 IF body->>'changedComponent'='labor' THEN PERFORM public.canonical_labor_plan_validate(lp.inputs);IF EXISTS(SELECT 1 FROM jsonb_array_elements(lp.inputs->'lines') l WHERE l->'hourlyCost'='null'::jsonb OR (l->>'rateMode'='base_burden' AND l->'burdenPercent'='null'::jsonb)) THEN RAISE EXCEPTION 'Complete labor costs required' USING ERRCODE='22023';END IF;IF lp.inputs->>'serviceKey' IS DISTINCT FROM service_key THEN RAISE EXCEPTION 'Labor service changed' USING ERRCODE='40001';END IF;END IF;
 assessment_value:=public.canonical_estimate_revision_cost_assessment_v3(material_value,labor_value,equipment_value,travel_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date);
 IF body->'assessment' IS DISTINCT FROM assessment_value THEN RAISE EXCEPTION 'Source review changed' USING ERRCODE='40001';END IF;
 next_revision:=COALESCE(current_row.revision,1)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Estimate revision limit' USING ERRCODE='54000'; END IF;
 fingerprint:=public.canonical_completion_digest(jsonb_build_object('original',original,'parent',source_value,'components',component_value,'coverage',body->'coverage','calculationVersion','estimate-cost-adoption-v3'));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 IF body->>'changedComponent'='material' THEN
 IF mp.calculation_version='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(mp.inputs,current_currency,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
 ELSIF mp.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(mp.inputs,current_currency,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
 ELSIF mp.calculation_version='estimate-material-plan-v2' THEN PERFORM public.canonical_material_plan_validate_v2(mp.inputs);ELSE PERFORM public.canonical_material_plan_validate(mp.inputs);END IF;END IF;
 IF body->>'changedComponent'='equipment' THEN PERFORM public.canonical_equipment_cost_adoption_require(org,actor,role_value,session_value,estimate,ep.inputs);END IF;
 IF body->>'changedComponent'='travel' THEN travel_sources:=public.canonical_travel_plan_sources(org,actor,role_value,session_value,estimate);IF travel_sources->>'digest' IS DISTINCT FROM tp.evidence->>'digest' OR tp.inputs->>'serviceKey' IS DISTINCT FROM service_key THEN RAISE EXCEPTION 'Travel source changed' USING ERRCODE='40001';END IF;END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_estimate_revisions(organization_id,estimate_id,revision,previous_id,material_plan_id,labor_plan_id,equipment_cost_plan_id,travel_plan_id,coverage_assessment,changed_component,component_manifest,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,original_source_pins,expected_decision_revision,expected_decision_digest,calculation_version,input_fingerprint,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,mp.id,lp.id,ep.id,tp.id,body->'coverage',body->>'changedComponent',component_value,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,original,COALESCE(decision_row.revision,0),COALESCE(decision_row.digest,'none'),body->>'confirmationVersion',fingerprint,btrim(body->>'reason'),body->>'confirmationVersion',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'inputFingerprint',fingerprint,'body',body))) RETURNING * INTO inserted;
 IF body->'assessment' IS DISTINCT FROM public.canonical_estimate_revision_cost_assessment_v3(material_value,labor_value,equipment_value,travel_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date) THEN RAISE EXCEPTION 'Source review changed' USING ERRCODE='40001';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('receipt',public.canonical_estimate_revision_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_mutate_v068(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;

-- Scheduling consumes a cost-free projection, never private reference documents or pricing.
CREATE FUNCTION public.canonical_travel_schedule_location(v JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('kind',v->'kind','label','','sourceId',v->'sourceId','sourceDigest',v->'sourceDigest','latitude',v->'latitude','longitude',v->'longitude')
$$;
CREATE FUNCTION public.canonical_travel_schedule_source(v JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('effectiveOn',v->'effectiveOn','endsOn',v->'endsOn','geography',CASE WHEN length(btrim(COALESCE(v->>'geography','')))>0 THEN 'Recorded' ELSE '' END)
$$;
CREATE FUNCTION public.canonical_travel_schedule_plan(plan public.canonical_travel_plans,sources JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE trips JSONB:='[]'; access_value JSONB:='[]'; source_rows JSONB:='[]'; locations JSONB;v JSONB;payload JSONB;calc JSONB;
BEGIN
 IF plan.id IS NULL THEN RETURN jsonb_build_object('notRecorded',TRUE,'digest','none');END IF;
 IF plan.action<>'save' THEN RETURN jsonb_build_object('notRecorded',FALSE,'sourceChanged',TRUE,'planPin',jsonb_build_object('id',plan.id,'revision',plan.revision,'digest',plan.digest));END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(plan.inputs->'trips') LOOP
 trips:=trips||jsonb_build_array(jsonb_build_object('lineId',v->'lineId','origin',public.canonical_travel_schedule_location(v->'origin'),'destination',public.canonical_travel_schedule_location(v->'destination'),'distance',v->'distance','time',v->'time','source',public.canonical_travel_schedule_source(v->'source')));
 END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(plan.inputs->'access') LOOP
 access_value:=access_value||jsonb_build_array(jsonb_build_object('lineId',v->'lineId','status',v->'status','start',v->'start','end',v->'end','appliesToJob',v->'appliesToJob','source',public.canonical_travel_schedule_source(v->'source')));
 END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements((plan.inputs->'logistics')||(plan.inputs->'hauls')||(SELECT COALESCE(jsonb_agg(jsonb_build_object('lineId',h->'lineId','source',h#>'{detail,density,source}')),'[]'::jsonb) FROM jsonb_array_elements(plan.inputs->'hauls') h WHERE h#>'{detail,density}' IS NOT NULL AND h#>'{detail,density}'<>'null'::jsonb)||(SELECT COALESCE(jsonb_agg(x||jsonb_build_object('lineId',x->>'resourceId')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(plan.inputs#>'{stagePlan,resources}','[]'::jsonb)) x)||(SELECT COALESCE(jsonb_agg(x||jsonb_build_object('lineId',x->>'stageId')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(plan.inputs#>'{stagePlan,stages}','[]'::jsonb)) x)) LOOP
 source_rows:=source_rows||jsonb_build_array(jsonb_build_object('lineId',v->'lineId','source',public.canonical_travel_schedule_source(v->'source')));END LOOP;
 SELECT COALESCE(jsonb_agg(public.canonical_travel_schedule_location(x) ORDER BY ordinal),'[]'::jsonb) INTO locations FROM jsonb_array_elements(sources->'locations') WITH ORDINALITY a(x,ordinal);
 calc:=public.canonical_travel_plan_calculate(plan.inputs);
 payload:=jsonb_build_object('notRecorded',FALSE,'sourceChanged',plan.evidence->>'digest' IS DISTINCT FROM sources->>'digest','planPin',jsonb_build_object('id',plan.id,'revision',plan.revision,'digest',plan.digest),
 'inputs',jsonb_build_object('serviceKey',plan.inputs->'serviceKey','trips',trips,'logistics',source_rows,'access',access_value,'hauls','[]'::jsonb,'stagePlan',NULL),
 'sources',jsonb_build_object('serviceKey',sources->'serviceKey','locations',locations,'serviceArea',jsonb_build_object('maxRadiusMiles',sources#>'{serviceArea,maxRadiusMiles}','maxTravelMinutes',sources#>'{serviceArea,maxTravelMinutes}'),'bufferMinutes',sources->'bufferMinutes','targetOrigin',NULL),
 'haulingNeedsReview',NOT public.canonical_travel_load_bindings(plan.inputs->'hauls',plan.inputs->'loadBindings',plan.inputs->'trips') OR (public.canonical_travel_resource_unknown(plan.inputs,sources)->>'hauling')::boolean,'stagesNeedReview',CASE WHEN plan.inputs->'stagePlan'<>'null'::jsonb THEN public.canonical_travel_stages(plan.inputs->'stagePlan')->'feasibleElapsedMinutes'='null'::jsonb OR (public.canonical_travel_resource_unknown(plan.inputs,sources)->>'stages')::boolean ELSE FALSE END);
 RETURN payload;
END $$;
CREATE FUNCTION public.canonical_travel_schedule_basis(org UUID,assignment UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE estimate_value UUID;latest public.canonical_travel_plans%ROWTYPE;adopted public.canonical_travel_plans%ROWTYPE;selected public.canonical_estimate_revisions%ROWTYPE;pin JSONB;raw JSONB;sources JSONB;payload JSONB;
BEGIN
 SELECT e.id INTO estimate_value FROM public.canonical_schedule_assignments s JOIN public.canonical_appointments a ON a.organization_id=s.organization_id AND a.id=s.appointment_id JOIN public.canonical_estimates e ON e.organization_id=a.organization_id AND e.operation_id=a.operation_id AND e.graph_id=a.graph_id WHERE s.organization_id=org AND s.id=assignment;
 IF estimate_value IS NULL THEN RETURN jsonb_build_object('notRecorded',TRUE,'digest','none');END IF;
 SELECT * INTO latest FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO selected FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1;
 pin:=selected.component_manifest->'travel';
 IF pin->>'kind'='plan' THEN
 SELECT * INTO adopted FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate_value AND id::text=pin->>'id' AND revision::text=pin->>'revision' AND digest=pin->>'digest' AND source_pins=pin->'sourcePins' AND action='save';
 IF adopted.id IS NULL OR adopted.id IS DISTINCT FROM selected.travel_plan_id THEN RAISE EXCEPTION 'Included travel basis unavailable; refresh the estimate and travel review' USING ERRCODE='40001';END IF;END IF;
 IF latest.id IS NULL AND adopted.id IS NULL THEN RETURN jsonb_build_object('notRecorded',TRUE,'digest','none');END IF;
 raw:=public.canonical_equipment_readiness_plan_sources(org,estimate_value,NULL);
 sources:=public.canonical_travel_location_sources(org,estimate_value,raw);
 payload:=public.canonical_travel_schedule_plan(latest,sources);
 IF adopted.id IS NOT NULL THEN
 payload:=payload||jsonb_build_object('adoptionPin',jsonb_build_object('id',selected.id,'revision',selected.revision,'digest',selected.digest,'travel',pin));
 IF adopted.id IS DISTINCT FROM latest.id OR latest.action IS DISTINCT FROM 'save' THEN payload:=payload||jsonb_build_object('notRecorded',FALSE,'sourceChanged',TRUE,'adopted',public.canonical_travel_schedule_plan(adopted,sources));END IF;END IF;
 RETURN payload||jsonb_build_object('digest',public.canonical_completion_digest(payload));
END $$;
CREATE FUNCTION public.canonical_travel_schedule_read(org UUID,actor UUID,role_value TEXT,session_value UUID,appointment UUID,target_kind TEXT,target_id UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,zone_value TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;assignment UUID;payload JSONB;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN RAISE EXCEPTION 'Protected scheduling snapshot required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF NOT(role_value IN ('owner','admin') OR role_value='member' AND authority->>'operationalRole'='dispatcher') THEN RAISE EXCEPTION 'Current scheduling operator required' USING ERRCODE='42501';END IF;
 SELECT s.id INTO assignment FROM public.canonical_schedule_assignments s JOIN public.canonical_appointments a ON a.organization_id=s.organization_id AND a.id=s.appointment_id WHERE s.organization_id=org AND s.appointment_id=appointment AND EXISTS(SELECT 1 FROM public.canonical_transcripts t WHERE t.organization_id=a.organization_id AND t.operation_id=a.operation_id AND t.graph_id=a.graph_id AND public.canonical_labor_transcript_source_normalized(t.source) IN ('lead','retell','voice'));
 IF assignment IS NULL THEN RAISE EXCEPTION 'Appointment unavailable' USING ERRCODE='P0002';END IF;
 IF target_kind='unassigned' AND EXISTS(SELECT 1 FROM public.canonical_schedule_assignments s WHERE s.organization_id=org AND s.id=assignment AND s.target_state='assigned' AND s.schedule_state=CASE WHEN start_value IS NULL THEN 'unscheduled' ELSE 'scheduled' END AND s.scheduled_start IS NOT DISTINCT FROM start_value AND s.scheduled_end IS NOT DISTINCT FROM end_value) THEN RETURN jsonb_build_object('notRecorded',TRUE,'digest','none');END IF;
 payload:=public.canonical_travel_schedule_basis(org,assignment);
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 RETURN payload;
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_schedule_location(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_schedule_source(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_schedule_plan(public.canonical_travel_plans,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_schedule_basis(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_schedule_read(uuid,uuid,text,uuid,uuid,text,uuid,timestamptz,timestamptz,text) FROM PUBLIC;

CREATE FUNCTION public.canonical_travel_schedule_result(basis JSONB,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,at_value TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE hard JSONB:='[]';review JSONB:='[]';nested JSONB;v JSONB;loc JSONB;current_loc JSONB;source_value JSONB;inputs JSONB;sources JSONB;day_value DATE:=(at_value AT TIME ZONE 'UTC')::date;minutes NUMERIC;distance NUMERIC;h DOUBLE PRECISION;current_source BOOLEAN;source_caution BOOLEAN:=FALSE;
BEGIN
 IF basis IS NULL OR basis->'notRecorded'='true'::jsonb THEN RETURN jsonb_build_object('hardConflicts',hard,'reviewReasons',review);END IF;
 IF basis ? 'adopted' THEN nested:=public.canonical_travel_schedule_result(basis->'adopted',start_value,end_value,at_value);hard:=hard||(nested->'hardConflicts');review:=review||(nested->'reviewReasons');END IF;
 IF basis->'sourceChanged'='true'::jsonb THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_plan_changed'));END IF;
 IF basis->'haulingNeedsReview'='true'::jsonb THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_loads_need_review'));END IF;
 IF basis->'stagesNeedReview'='true'::jsonb THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_stages_need_review'));END IF;
 inputs:=basis->'inputs';sources:=basis->'sources';IF inputs IS NULL THEN RETURN jsonb_build_object('hardConflicts',hard,'reviewReasons',review);END IF;
 IF inputs->>'serviceKey' IS DISTINCT FROM sources->>'serviceKey' THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_location_changed'));END IF;
 FOR v IN SELECT value FROM jsonb_array_elements((inputs->'trips')||(inputs->'logistics')||(inputs->'access')) LOOP
 source_value:=v->'source';IF source_value->>'effectiveOn' IS NULL OR (source_value->>'effectiveOn')::date>day_value OR source_value->>'endsOn' IS NULL OR (source_value->>'endsOn')::date<day_value OR length(btrim(COALESCE(source_value->>'geography','')))=0 THEN source_caution:=TRUE;END IF;
 END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(inputs->'trips') LOOP
 FOR loc IN SELECT value FROM jsonb_array_elements(jsonb_build_array(v->'origin',v->'destination')) LOOP
 IF loc->>'kind'='declared' THEN source_caution:=TRUE;ELSE
 SELECT value INTO current_loc FROM jsonb_array_elements(sources->'locations') WHERE value->>'kind'=loc->>'kind' AND value->>'sourceId'=loc->>'sourceId';
 IF current_loc IS DISTINCT FROM loc THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_location_changed'));END IF;END IF;END LOOP;
 IF v#>>'{distance,value}' IS NULL OR v#>>'{distance,basis}'='straight_line' OR v#>>'{time,value}' IS NULL THEN source_caution:=TRUE;END IF;
 IF jsonb_typeof(v#>'{origin,latitude}')='number' AND jsonb_typeof(v#>'{origin,longitude}')='number' AND jsonb_typeof(v#>'{destination,latitude}')='number' AND jsonb_typeof(v#>'{destination,longitude}')='number' THEN
 h:=power(sin(radians(((v#>>'{destination,latitude}')::double precision-(v#>>'{origin,latitude}')::double precision)/2)),2)+cos(radians((v#>>'{origin,latitude}')::double precision))*cos(radians((v#>>'{destination,latitude}')::double precision))*power(sin(radians(((v#>>'{destination,longitude}')::double precision-(v#>>'{origin,longitude}')::double precision)/2)),2);
 distance:=round((6371008.8*2*atan2(sqrt(greatest(0,h)),sqrt(greatest(0,1-h)))/1609.344)::numeric,6);
 IF jsonb_typeof(sources#>'{serviceArea,maxRadiusMiles}')='number' AND distance>(sources#>>'{serviceArea,maxRadiusMiles}')::numeric THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_outside_declared_radius','lineId',v->'lineId'));END IF;
 ELSE review:=review||jsonb_build_array(jsonb_build_object('code','travel_location_coordinates_unknown','lineId',v->'lineId'));END IF;
 minutes:=(v#>>'{time,value}')::numeric*CASE WHEN v#>>'{time,unit}'='hour' THEN 60 ELSE 1 END;
 IF minutes IS NULL THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_duration_unknown','lineId',v->'lineId'));
 ELSE
 IF jsonb_typeof(sources#>'{serviceArea,maxTravelMinutes}')='number' AND minutes>(sources#>>'{serviceArea,maxTravelMinutes}')::numeric THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_exceeds_declared_time','lineId',v->'lineId'));END IF;
 IF jsonb_typeof(sources->'bufferMinutes')='number' AND minutes>(sources->>'bufferMinutes')::numeric THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_buffer_review','lineId',v->'lineId'));END IF;
 END IF;
 review:=review||jsonb_build_array(jsonb_build_object('code','travel_target_origin_unknown','lineId',v->'lineId'),jsonb_build_object('code','travel_driving_route_unverified','lineId',v->'lineId'));
 END LOOP;
 IF source_caution THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_source_needs_review'));END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(inputs->'access') LOOP source_value:=v->'source';
 current_source:=source_value->>'effectiveOn' IS NOT NULL AND (source_value->>'effectiveOn')::date<=day_value AND source_value->>'endsOn' IS NOT NULL AND (source_value->>'endsOn')::date>=day_value;
 IF NOT current_source OR v->'appliesToJob' IS DISTINCT FROM 'true'::jsonb OR v->>'start' IS NULL OR v->>'end' IS NULL OR start_value IS NULL OR end_value IS NULL OR v->>'status'='unknown' THEN review:=review||jsonb_build_array(jsonb_build_object('code','travel_access_needs_review','lineId',v->'lineId'));
 ELSIF v->>'status'='closed' AND start_value<(v->>'end')::timestamptz AND end_value>(v->>'start')::timestamptz THEN hard:=hard||jsonb_build_array(jsonb_build_object('code','travel_access_closed','lineId',v->'lineId'));END IF;
 END LOOP;
 RETURN jsonb_build_object('hardConflicts',public.canonical_schedule_part4_stable_entries(hard),'reviewReasons',public.canonical_schedule_part4_stable_entries(review));
END $$;
-- Existing outer preview/approval entries perform current actor checks before this
-- private helper and again after all its waits. Assignment -> estimate/travel ->
-- supporting authority -> sorted069 asset fences is the shared scheduling order.
ALTER FUNCTION public.canonical_schedule_part4_review_authority(uuid,uuid,text,uuid,timestamptz,timestamptz,text) RENAME TO canonical_travel_schedule_equipment_authority;
CREATE FUNCTION public.canonical_schedule_part4_review_authority(org UUID,assignment UUID,target_kind TEXT,target_id UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,zone_value TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior JSONB;basis JSONB;extra JSONB;hard JSONB;review JSONB;digest_value TEXT;recommendation TEXT;state_value TEXT;estimate_value UUID;cleanup BOOLEAN;
BEGIN
 SELECT target_kind='unassigned' AND s.target_state='assigned' AND s.schedule_state=CASE WHEN start_value IS NULL THEN 'unscheduled' ELSE 'scheduled' END AND s.scheduled_start IS NOT DISTINCT FROM start_value AND s.scheduled_end IS NOT DISTINCT FROM end_value INTO cleanup FROM public.canonical_schedule_assignments s WHERE s.organization_id=org AND s.id=assignment;
 IF NOT COALESCE(cleanup,FALSE) THEN
 SELECT e.id INTO estimate_value FROM public.canonical_schedule_assignments s JOIN public.canonical_appointments a ON a.organization_id=s.organization_id AND a.id=s.appointment_id JOIN public.canonical_estimates e ON e.organization_id=a.organization_id AND e.operation_id=a.operation_id AND e.graph_id=a.graph_id WHERE s.organization_id=org AND s.id=assignment FOR UPDATE OF e;
 IF estimate_value IS NOT NULL THEN PERFORM public.canonical_travel_fence(org,estimate_value);END IF;END IF;
 prior:=public.canonical_travel_schedule_equipment_authority(org,assignment,target_kind,target_id,start_value,end_value,zone_value);
 IF COALESCE(cleanup,FALSE) THEN RETURN prior;END IF;
 basis:=public.canonical_travel_schedule_basis(org,assignment);
 IF basis->'notRecorded'='true'::jsonb THEN RETURN prior;END IF;
 extra:=public.canonical_travel_schedule_result(basis,start_value,end_value,clock_timestamp());
 hard:=public.canonical_schedule_part4_stable_entries((prior->'hardConflicts')||(extra->'hardConflicts'));review:=public.canonical_schedule_part4_stable_entries((prior->'reviewReasons')||(extra->'reviewReasons'));
 IF jsonb_array_length(hard)>256 OR jsonb_array_length(review)>256 THEN RAISE EXCEPTION 'Travel scheduling evidence exceeds review limits' USING ERRCODE='54000';END IF;
 digest_value:=encode(sha256(convert_to(public.canonical_schedule_part4_stable_json(jsonb_build_object('prior',prior->>'conflictDigest','travel',basis->>'digest','hardConflicts',hard,'reviewReasons',review)),'UTF8')),'hex');
 recommendation:=encode(sha256(convert_to(public.canonical_schedule_part4_stable_json(jsonb_build_object('authorityDigest',digest_value,'mutationGrant',FALSE,'providerCallsAllowed',0,'routeEvidence','unavailable_without_separately_authorized_current_durable_evidence')),'UTF8')),'hex');
 state_value:=CASE WHEN jsonb_array_length(hard)>0 THEN 'hard_conflict' WHEN jsonb_array_length(review)>0 THEN 'needs_review' WHEN jsonb_array_length(prior->'warnings')>0 THEN 'warning' ELSE 'clear' END;
 RETURN prior||jsonb_build_object('status',state_value,'hardConflicts',hard,'reviewReasons',review,'needsReview',jsonb_array_length(review)>0,'reviewReasonDigests',public.canonical_schedule_part4_entry_digests(review),'conflictDigest',digest_value,'recommendationDigest',recommendation,'recommendationAuthorityDigest',digest_value);
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_schedule_result(jsonb,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_schedule_equipment_authority(uuid,uuid,text,uuid,timestamptz,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_review_authority(uuid,uuid,text,uuid,timestamptz,timestamptz,text) FROM PUBLIC;

-- Application-pause admission still checks current write authority and CSRF.
CREATE FUNCTION public.canonical_travel_write_authority(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') OR role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_write_authority(uuid,uuid,text,uuid,text) FROM PUBLIC;

ALTER FUNCTION public.canonical_travel_haul(jsonb) RENAME TO canonical_travel_haul_base;
CREATE FUNCTION public.canonical_travel_haul(v JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h JSONB:=v-'detail';detail JSONB:=v->'detail';base JSONB;d JSONB;key_value TEXT;kind TEXT;density NUMERIC;volume NUMERIC;n NUMERIC;den NUMERIC;micro NUMERIC;vinN NUMERIC;vinD NUMERIC;vdN NUMERIC;vdD NUMERIC;mdN NUMERIC;mdD NUMERIC;moN NUMERIC;moD NUMERIC;unresolved BOOLEAN:=FALSE;derived JSONB:='[]';load JSONB;dim JSONB;ids TEXT[]:=ARRAY[]::text[];sums JSONB:='{"volume":0,"mass":0}';known JSONB:='{"volume":true,"mass":true}';complete BOOLEAN:=TRUE;row_known BOOLEAN;has_quantity BOOLEAN;q NUMERIC;capacity NUMERIC;existing NUMERIC;output NUMERIC;retained NUMERIC;rows JSONB:='[]';row_value JSONB;basis JSONB;
BEGIN
 base:=public.canonical_travel_haul_base(h);IF NOT(v ? 'detail') THEN RETURN base;END IF;
 IF public.canonical_field_evidence_object_keys_exact(detail,ARRAY['equipmentBasis','density','orderedLoads']) IS NOT TRUE OR jsonb_typeof(detail->'orderedLoads') IS DISTINCT FROM 'array' OR jsonb_array_length(detail->'orderedLoads')>12 THEN RAISE EXCEPTION 'Review measured load details' USING ERRCODE='22023';END IF;
 d:=detail->'equipmentBasis';IF d IS DISTINCT FROM 'null'::jsonb AND (public.canonical_field_evidence_object_keys_exact(d,ARRAY['planId','revision','digest','lineId']) IS NOT TRUE OR COALESCE(d->>'planId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' OR COALESCE(d->>'lineId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' OR jsonb_typeof(d->'revision') IS DISTINCT FROM 'number' OR COALESCE(d->>'revision','')!~'^[1-9][0-9]*$' OR COALESCE(d->>'digest','')!~'^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'Equipment basis invalid' USING ERRCODE='22023';END IF;
 d:=detail->'density';IF d IS DISTINCT FROM 'null'::jsonb THEN
 IF public.canonical_field_evidence_object_keys_exact(d,ARRAY['value','massUnit','volumeUnit','source']) IS NOT TRUE OR COALESCE(d->>'massUnit','') NOT IN ('lb','kg') OR COALESCE(d->>'volumeUnit','') NOT IN ('yd3','m3') OR h->'homogeneous' IS DISTINCT FROM 'true'::jsonb OR jsonb_array_length(detail->'orderedLoads')>0 OR h#>'{volume,applicable}' IS DISTINCT FROM 'true'::jsonb OR h#>'{mass,applicable}' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Density requires one homogeneous material and both dimensions' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_travel_source_validate(d->'source');density:=public.canonical_equipment_cost_quantity(d->'value')*1000000;IF density=0 THEN RAISE EXCEPTION 'Density must be positive or unknown' USING ERRCODE='22023';END IF;
 vinN:=CASE WHEN h#>>'{volume,unit}'='yd3' THEN 764554857984 ELSE 1 END;vinD:=CASE WHEN h#>>'{volume,unit}'='yd3' THEN 1000000000000 ELSE 1 END;vdN:=CASE WHEN d->>'volumeUnit'='yd3' THEN 764554857984 ELSE 1 END;vdD:=CASE WHEN d->>'volumeUnit'='yd3' THEN 1000000000000 ELSE 1 END;mdN:=CASE WHEN d->>'massUnit'='lb' THEN 45359237 ELSE 1 END;mdD:=CASE WHEN d->>'massUnit'='lb' THEN 100000000 ELSE 1 END;moN:=CASE WHEN h#>>'{mass,unit}'='lb' THEN 45359237 ELSE 1 END;moD:=CASE WHEN h#>>'{mass,unit}'='lb' THEN 100000000 ELSE 1 END;
 FOREACH key_value IN ARRAY ARRAY['output','retained'] LOOP volume:=public.canonical_equipment_cost_quantity(h#>ARRAY['volume',key_value])*1000000;
 IF volume IS NULL OR density IS NULL THEN unresolved:=TRUE;CONTINUE;END IF;n:=volume*density*vinN*vdD*mdN*moD;den:=1000000*vinD*vdN*mdD*moN;
 IF mod(n,den)<>0 THEN unresolved:=TRUE;CONTINUE;END IF;micro:=n/den;IF micro>999999999999999 THEN RAISE EXCEPTION 'Density conversion exceeds supported quantity' USING ERRCODE='22023';END IF;
 IF h#>ARRAY['mass',key_value]<>'null'::jsonb AND public.canonical_equipment_cost_quantity(h#>ARRAY['mass',key_value])*1000000<>micro THEN RAISE EXCEPTION 'Recorded mass and sourced density disagree' USING ERRCODE='22023';END IF;
 IF h#>ARRAY['mass',key_value]='null'::jsonb THEN h:=jsonb_set(h,ARRAY['mass',key_value],to_jsonb(CASE WHEN micro=0 THEN '0' ELSE rtrim(rtrim((micro/1000000)::text,'0'),'.') END));derived:=derived||to_jsonb(key_value);END IF;
 END LOOP;END IF;
 IF jsonb_array_length(detail->'orderedLoads')=0 THEN base:=public.canonical_travel_haul_base(h);IF unresolved THEN base:=base||jsonb_build_object('complete',FALSE,'additionalLoads',NULL);END IF;RETURN base;END IF;
 FOR load IN SELECT value FROM jsonb_array_elements(detail->'orderedLoads') LOOP
 IF public.canonical_field_evidence_object_keys_exact(load,ARRAY['loadId','volume','mass','initialLoadOwner','initialLoadNote']) IS NOT TRUE OR COALESCE(load->>'loadId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' OR load->>'loadId'=ANY(ids) OR COALESCE(load->>'initialLoadOwner','') NOT IN ('this_job','other_job','unknown') OR public.canonical_labor_plan_text(load->'initialLoadNote',500) IS NOT TRUE THEN RAISE EXCEPTION 'Review each measured load' USING ERRCODE='22023';END IF;
 ids:=array_append(ids,load->>'loadId');IF load->>'initialLoadOwner'='unknown' THEN complete:=FALSE;END IF;row_known:=TRUE;has_quantity:=FALSE;
 FOREACH kind IN ARRAY ARRAY['volume','mass'] LOOP dim:=load->kind;IF public.canonical_field_evidence_object_keys_exact(dim,ARRAY['quantity','capacity','existing']) IS NOT TRUE THEN RAISE EXCEPTION 'Measured capacity fields invalid' USING ERRCODE='22023';END IF;q:=public.canonical_equipment_cost_quantity(dim->'quantity');capacity:=public.canonical_equipment_cost_quantity(dim->'capacity');existing:=public.canonical_equipment_cost_quantity(dim->'existing');
 IF h#>ARRAY[kind,'applicable']='false'::jsonb THEN IF q IS NOT NULL OR capacity IS NOT NULL OR existing IS NOT NULL THEN RAISE EXCEPTION 'Non-applicable dimension has quantities' USING ERRCODE='22023';END IF;CONTINUE;END IF;
 IF h#>ARRAY[kind,'applicable'] IS DISTINCT FROM 'true'::jsonb OR q IS NULL OR capacity IS NULL OR existing IS NULL THEN complete:=FALSE;row_known:=FALSE;known:=jsonb_set(known,ARRAY[kind],'false'::jsonb);CONTINUE;END IF;
 IF capacity=0 OR existing>capacity OR q>capacity-existing THEN RAISE EXCEPTION 'Measured load exceeds remaining capacity' USING ERRCODE='22023';END IF;IF q>0 THEN has_quantity:=TRUE;END IF;sums:=jsonb_set(sums,ARRAY[kind],to_jsonb((sums->>kind)::numeric+q));
 END LOOP;IF row_known AND NOT has_quantity THEN RAISE EXCEPTION 'Empty measured load' USING ERRCODE='22023';END IF;
 END LOOP;
 FOREACH kind IN ARRAY ARRAY['volume','mass'] LOOP IF h#>ARRAY[kind,'applicable']='false'::jsonb THEN CONTINUE;END IF;output:=public.canonical_equipment_cost_quantity(h#>ARRAY[kind,'output']);retained:=public.canonical_equipment_cost_quantity(h#>ARRAY[kind,'retained']);IF output IS NULL OR retained IS NULL THEN complete:=FALSE;CONTINUE;END IF;IF retained>output OR known->kind='true'::jsonb AND (sums->>kind)::numeric<>output-retained THEN RAISE EXCEPTION 'Measured load totals differ from net material' USING ERRCODE='22023';END IF;END LOOP;
 RETURN jsonb_build_object('complete',complete,'additionalLoads',CASE WHEN complete THEN jsonb_array_length(detail->'orderedLoads') ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_haul_base(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_haul(jsonb) FROM PUBLIC;

-- Only protected owner reads and trusted scheduling helpers call these private functions.
CREATE FUNCTION public.canonical_travel_resource_choices(org UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_estimate_revisions%ROWTYPE;ep public.canonical_equipment_plans%ROWTYPE;lp public.canonical_labor_plans%ROWTYPE;current_id UUID;adopted_id UUID;line JSONB;fresh JSONB;equipment JSONB:='[]';labor JSONB:='[]';
BEGIN
 SELECT * INTO selected FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT id INTO current_id FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT equipment_plan_id INTO adopted_id FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate AND id=selected.equipment_cost_plan_id;
 FOR ep IN SELECT * FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate AND id IN(current_id,adopted_id) AND action='save' ORDER BY revision DESC LOOP
 fresh:=public.canonical_equipment_readiness_plan_sources(org,estimate,ep.inputs);
 FOR line IN SELECT value FROM jsonb_array_elements(ep.inputs->'lines') LOOP equipment:=equipment||jsonb_build_array(jsonb_build_object('pin',jsonb_build_object('planId',ep.id,'revision',ep.revision,'digest',rtrim(ep.digest),'lineId',line->'lineId'),'label',COALESCE(NULLIF(concat_ws(' ',NULLIF(line#>>'{identity,manufacturer}',''),NULLIF(line#>>'{identity,model}',''),NULLIF(line#>>'{identity,configuration}','')),''),'Recorded Equipment'),'sourceCurrent',ep.evidence->>'digest'=fresh->>'digest'));END LOOP;END LOOP;
 SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate AND id=selected.labor_plan_id AND action='save';
 IF lp.id IS NOT NULL THEN FOR line IN SELECT value FROM jsonb_array_elements(lp.inputs->'lines') LOOP labor:=labor||jsonb_build_array(jsonb_build_object('pin',jsonb_build_object('planId',lp.id,'revision',lp.revision,'digest',rtrim(lp.digest),'lineId',line->'lineId'),'label',line->'task','people',CASE WHEN line->>'basis'='people_time' THEN line->'people' ELSE 'null'::jsonb END));END LOOP;END IF;
 RETURN jsonb_build_object('equipment',equipment,'labor',labor);
END $$;
CREATE FUNCTION public.canonical_travel_resource_require(v JSONB,sources JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h JSONB;r JSONB;b JSONB;entry JSONB;ref JSONB;seen JSONB:='[]';
BEGIN
 FOR h IN SELECT value FROM jsonb_array_elements(v->'hauls') LOOP ref:=h#>'{detail,equipmentBasis}';IF ref IS NOT NULL AND ref<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources#>'{resourceChoices,equipment}') x WHERE x->'pin'=ref AND x->'sourceCurrent'='true'::jsonb) THEN RAISE EXCEPTION 'Travel equipment basis changed' USING ERRCODE='40001';END IF;END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(v#>'{stagePlan,resources}','[]'::jsonb)) LOOP b:=r->'binding';IF b IS NULL OR b='null'::jsonb THEN CONTINUE;END IF;
 IF public.canonical_field_evidence_object_keys_exact(b,ARRAY['component','reference','position']) IS NOT TRUE OR b->>'component' IS DISTINCT FROM (CASE WHEN r->>'kind'='person' THEN 'labor' ELSE 'equipment' END) OR public.canonical_field_evidence_object_keys_exact(b->'reference',ARRAY['planId','revision','digest','lineId']) IS NOT TRUE OR (b->>'component'='equipment' AND b->'position'<>'null'::jsonb) OR (b->>'component'='labor' AND (jsonb_typeof(b->'position')<>'number' OR (b->>'position')!~'^[1-9][0-9]{0,2}$' OR (b->>'position')::integer>100)) THEN RAISE EXCEPTION 'Review travel resource binding' USING ERRCODE='22023';END IF;
 SELECT x INTO entry FROM jsonb_array_elements(sources#>ARRAY['resourceChoices',b->>'component']) x WHERE x->'pin'=b->'reference';
 IF entry IS NULL OR (b->>'component'='equipment' AND entry->'sourceCurrent' IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Travel resource source changed' USING ERRCODE='40001';END IF;
 IF seen @> jsonb_build_array(b) OR (b->>'component'='labor' AND entry->>'people' IS NOT NULL AND (b->>'position')::integer>(entry->>'people')::integer) THEN RAISE EXCEPTION 'Review unique task position and crew count' USING ERRCODE='22023';END IF;seen:=seen||jsonb_build_array(b);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_resource_choices(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_travel_resource_require(JSONB,JSONB) FROM PUBLIC;

CREATE FUNCTION public.canonical_travel_resource_unknown(v JSONB,sources JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE hauling BOOLEAN:=FALSE;stages BOOLEAN:=FALSE;h JSONB;r JSONB;s JSONB;entry JSONB;
BEGIN
 BEGIN PERFORM public.canonical_travel_resource_require(v,sources);EXCEPTION WHEN SQLSTATE '40001' OR SQLSTATE '22023' THEN RETURN jsonb_build_object('hauling',jsonb_array_length(v->'hauls')>0,'stages',v->'stagePlan'<>'null'::jsonb);END;
 FOR h IN SELECT value FROM jsonb_array_elements(v->'hauls') LOOP IF h#>'{detail,equipmentBasis}' IS NULL OR h#>'{detail,equipmentBasis}'='null'::jsonb THEN hauling:=TRUE;END IF;END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(v#>'{stagePlan,resources}','[]'::jsonb)) LOOP IF r->'binding' IS NULL OR r->'binding'='null'::jsonb THEN stages:=TRUE;ELSIF r#>>'{binding,component}'='labor' THEN SELECT x INTO entry FROM jsonb_array_elements(sources#>'{resourceChoices,labor}') x WHERE x->'pin'=r#>'{binding,reference}';IF entry->>'people' IS NULL THEN stages:=TRUE;END IF;END IF;END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(COALESCE(v#>'{stagePlan,stages}','[]'::jsonb)) LOOP IF s->>'presence' IS NULL OR s->>'presence'='unknown' THEN stages:=TRUE;END IF;END LOOP;
 RETURN jsonb_build_object('hauling',hauling,'stages',stages OR (public.canonical_travel_absence(v,sources)->>'needsReview')::boolean);
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_resource_unknown(JSONB,JSONB) FROM PUBLIC;

CREATE FUNCTION public.canonical_travel_absence(v JSONB,sources JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s JSONB;r JSONB;task JSONB;row_value JSONB;done JSONB:='{}';key_value TEXT;duration NUMERIC;start_value NUMERIC;end_value NUMERIC;points NUMERIC[]:=ARRAY[]::numeric[];ordered_points NUMERIC[];i INTEGER;away JSONB;onsite JSONB;affected JSONB;presence_unknown BOOLEAN;has_task BOOLEAN;remaining INTEGER;people INTEGER;windows JSONB:='[]';unresolved BOOLEAN:=FALSE;timing JSONB;
BEGIN
 IF v->'stagePlan' IS NULL OR v->'stagePlan'='null'::jsonb THEN RETURN jsonb_build_object('needsReview',FALSE,'absenceWindows','[]'::jsonb);END IF;
 timing:=public.canonical_travel_stages(v->'stagePlan');
 FOR s IN SELECT value FROM jsonb_array_elements(v#>'{stagePlan,stages}') LOOP
 duration:=public.canonical_equipment_cost_quantity(s->'duration')*1000000*CASE WHEN s->>'unit'='hour' THEN 60 ELSE 1 END;start_value:=0;
 FOR key_value IN SELECT value FROM jsonb_array_elements_text(s->'dependencies') LOOP IF done#>>ARRAY[key_value,'end'] IS NULL THEN start_value:=NULL;ELSIF start_value IS NOT NULL THEN start_value:=greatest(start_value,(done#>>ARRAY[key_value,'end'])::numeric);END IF;END LOOP;
 end_value:=start_value+duration;IF start_value IS NOT NULL THEN points:=array_append(points,start_value);END IF;IF end_value IS NOT NULL THEN points:=array_append(points,end_value);END IF;
 done:=done||jsonb_build_object(s->>'stageId',jsonb_build_object('start',start_value,'end',end_value,'stage',s));
 END LOOP;
 SELECT array_agg(x ORDER BY x) INTO ordered_points FROM (SELECT DISTINCT unnest(points) x) t;
 IF COALESCE(cardinality(ordered_points),0)>1 THEN FOR i IN 2..cardinality(ordered_points) LOOP start_value:=ordered_points[i-1];end_value:=ordered_points[i];
 FOR task IN SELECT value FROM jsonb_array_elements(COALESCE(sources#>'{resourceChoices,labor}','[]'::jsonb)) LOOP
 away:='[]';onsite:='[]';affected:='[]';presence_unknown:=FALSE;people:=(task->>'people')::integer;
 FOR s IN SELECT value FROM jsonb_array_elements(v#>'{stagePlan,stages}') LOOP row_value:=done->(s->>'stageId');IF NOT(COALESCE((row_value->>'start')::numeric<end_value AND start_value<(row_value->>'end')::numeric,FALSE)) THEN CONTINUE;END IF;has_task:=FALSE;
 FOR r IN SELECT value FROM jsonb_array_elements(v#>'{stagePlan,resources}') LOOP IF r->>'kind'<>'person' OR r#>>'{binding,component}' IS DISTINCT FROM 'labor' OR r#>'{binding,reference}' IS DISTINCT FROM task->'pin' OR NOT(s->'resourceIds' ? (r->>'resourceId')) THEN CONTINUE;END IF;has_task:=TRUE;
 IF s->>'presence'='away' THEN IF NOT(away @> jsonb_build_array(r#>'{binding,position}')) THEN away:=away||jsonb_build_array(r#>'{binding,position}');END IF;
 ELSIF s->>'presence'='onsite' THEN IF NOT(onsite @> jsonb_build_array(r#>'{binding,position}')) THEN onsite:=onsite||jsonb_build_array(r#>'{binding,position}');END IF;
 ELSE presence_unknown:=TRUE;END IF;
 END LOOP;
 IF has_task THEN affected:=affected||jsonb_build_array(s->'label');END IF;
 END LOOP;
 IF jsonb_array_length(affected)>0 THEN remaining:=CASE WHEN presence_unknown OR people IS NULL OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(away||onsite))<>people OR EXISTS(SELECT 1 FROM jsonb_array_elements(away) x WHERE onsite @> jsonb_build_array(x)) THEN NULL ELSE jsonb_array_length(onsite) END;
 IF remaining IS NULL THEN unresolved:=TRUE;END IF;
 windows:=windows||jsonb_build_array(jsonb_build_object('task',task->'label','taskPin',task->'pin','start',public.canonical_travel_fraction(start_value,1000000),'end',public.canonical_travel_fraction(end_value,1000000),'recordedPeople',people,'awayPositions',jsonb_array_length(away),'explicitOnsitePositions',jsonb_array_length(onsite),'positionsNotAssignedAway',people-jsonb_array_length(away),'remainingOnsite',remaining,'stages',affected,'presenceUnknown',presence_unknown));END IF;
 END LOOP;END LOOP;END IF;
 RETURN jsonb_build_object('needsReview',unresolved,'absenceWindows',windows);
END $$;
REVOKE ALL ON FUNCTION public.canonical_travel_absence(JSONB,JSONB) FROM PUBLIC;
