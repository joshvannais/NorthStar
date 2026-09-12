-- Shared serialization witness: an advisory lock does not refresh a snapshot.
-- Only mutation-authorizing transactions touch this table; reads do not.
CREATE TABLE public.canonical_equipment_readiness_fences(
 organization_id UUID NOT NULL,asset_id UUID NOT NULL,counter BIGINT NOT NULL CHECK(counter>0),
 PRIMARY KEY(organization_id,asset_id),FOREIGN KEY(organization_id,asset_id) REFERENCES public.tenant_assets(organization_id,id));
CREATE FUNCTION public.canonical_equipment_readiness_fence(org UUID,asset UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable equipment review required' USING ERRCODE='25001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':equipment:'||asset::text,0));
 INSERT INTO public.canonical_equipment_readiness_fences(organization_id,asset_id,counter) VALUES(org,asset,1)
 ON CONFLICT(organization_id,asset_id) DO UPDATE SET counter=canonical_equipment_readiness_fences.counter+1;
END $$;
REVOKE ALL ON TABLE public.canonical_equipment_readiness_fences FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_fence(uuid,uuid) FROM PUBLIC;

-- Mission24 Part4 Slice3. All previous migrations remain byte-identical.
CREATE FUNCTION public.canonical_equipment_readiness_assess_line(l JSONB,f JSONB,at_value TIMESTAMPTZ,proposal JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE hard TEXT[]:=ARRAY[]::text[]; review TEXT[]:=ARRAY[]::text[];s JSONB:=l->'source';st JSONB:=COALESCE(f->'state','{}');m JSONB:=l->'maintenance';meter JSONB;fresh BOOLEAN;complete BOOLEAN:=COALESCE((f->>'complete')::boolean,FALSE);start_value TIMESTAMPTZ;end_value TIMESTAMPTZ;result_state TEXT;
BEGIN
 IF s->>'observedAt' IS NOT NULL AND (s->>'observedAt')::timestamptz>at_value THEN RAISE EXCEPTION 'Observation is in future' USING ERRCODE='22023';END IF;
 IF l->'required'='false'::jsonb THEN RETURN jsonb_build_object('lineId',l->>'lineId','required',FALSE,'status','not_required','hard','[]'::jsonb,'review','[]'::jsonb);END IF;
 IF st->'downtime'='true'::jsonb THEN hard:=array_append(hard,'recorded_downtime');END IF;
 IF st->>'checkedOutExecution' IS NOT NULL AND (COALESCE((f->>'currentJob')::boolean,FALSE) IS FALSE OR proposal IS NOT NULL AND COALESCE((f->>'targetMatches')::boolean,FALSE) IS FALSE) THEN hard:=array_append(hard,'recorded_checkout');END IF;
 IF f->'declaredCheckout' IS NOT NULL AND f->'declaredCheckout'<>'null'::jsonb THEN IF f#>'{declaredCheckout,currentJob}' IS DISTINCT FROM 'true'::jsonb OR proposal IS NOT NULL AND f#>'{declaredCheckout,targetMatches}' IS DISTINCT FROM 'true'::jsonb THEN hard:=array_append(hard,'recorded_checkout');ELSIF f#>'{declaredCheckout,executionKnown}' IS DISTINCT FROM 'true'::jsonb THEN review:=array_append(review,'checkout_execution_unknown');END IF;END IF;
 IF st->'recordedFault'='true'::jsonb THEN review:=array_append(review,'recorded_fault');END IF;
 IF NOT complete THEN review:=array_append(review,'operational_history_unknown');END IF;
 IF f->'sourceCurrent' IS DISTINCT FROM 'true'::jsonb THEN review:=array_append(review,'equipment_source_changed');END IF;
 IF f->>'requirementStatus'='conflicts_with_requirement' THEN hard:=array_append(hard,'requirement_not_met');ELSIF f->>'requirementStatus' IS DISTINCT FROM 'matches_reviewed_requirements' THEN review:=array_append(review,'requirements_unknown');END IF;
 fresh:=s->>'observedAt' IS NOT NULL AND s->>'validUntil' IS NOT NULL AND (s->>'observedAt')::timestamptz<=at_value AND (s->>'validUntil')::timestamptz>at_value;
 IF NOT fresh THEN review:=array_append(review,'source_date_unknown_or_expired');END IF;
 IF s->>'condition'='out_of_service' THEN hard:=array_append(hard,'reported_out_of_service');ELSIF s->>'condition'<>'reported_no_problem' THEN review:=array_append(review,CASE WHEN s->>'condition'='problem_reported' THEN 'reported_condition_problem' ELSE 'condition_unknown' END);END IF;
 start_value:=(CASE WHEN proposal IS NULL THEN l->>'start' ELSE proposal->>'scheduledStart' END)::timestamptz;end_value:=(CASE WHEN proposal IS NULL THEN l->>'end' ELSE proposal->>'scheduledEnd' END)::timestamptz;
 IF start_value IS NULL OR end_value IS NULL OR end_value<=start_value THEN review:=array_append(review,'required_window_unknown');END IF;
 IF l->>'quantity' IS NULL OR s->>'quantity' IS NULL THEN review:=array_append(review,'quantity_unknown');ELSIF fresh AND (s->>'quantity')::int<(l->>'quantity')::int THEN hard:=array_append(hard,'reported_quantity_shortfall');END IF;
 IF f->>'assetId' IS NOT NULL AND (l->>'quantity')::int>1 THEN hard:=array_append(hard,'identified_asset_quantity');END IF;
 IF s->>'start' IS NULL OR start_value IS NULL THEN review:=array_append(review,'reported_window_unknown');ELSIF fresh AND ((s->>'start')::timestamptz>start_value OR (s->>'end')::timestamptz<end_value) THEN hard:=array_append(hard,'reported_window_shortfall');END IF;
 IF s->>'validUntil' IS NOT NULL AND end_value IS NOT NULL AND (s->>'validUntil')::timestamptz<end_value THEN review:=array_append(review,'source_expires_before_work_ends');END IF;
 IF COALESCE(l->>'location','')='' OR COALESCE(s->>'location','')='' THEN review:=array_append(review,'location_unknown');ELSIF btrim(l->>'location')<>btrim(s->>'location') THEN review:=array_append(review,'location_needs_confirmation');END IF;
 IF btrim(s->>'restrictions')<>'' THEN review:=array_append(review,'reported_restrictions');END IF;
 IF s->>'leadTime' IS NULL OR s->>'observedAt' IS NULL THEN review:=array_append(review,'lead_time_unknown');ELSIF start_value IS NOT NULL AND (s->>'observedAt')::timestamptz+(s->>'leadTime')::int*(CASE WHEN s->>'leadTimeUnit'='days' THEN interval '24 hours' ELSE interval '1 hour' END)>start_value THEN review:=array_append(review,'lead_time_after_work_start');END IF;
 IF m->>'dueAt' IS NOT NULL AND (m->>'dueAt')::timestamptz<=GREATEST(at_value,COALESCE(end_value,at_value)) THEN review:=array_append(review,'maintenance_due');END IF;
 IF m->>'threshold' IS NOT NULL THEN
 meter:=st->'readings'->(m->>'meterKey');
 IF NOT complete OR meter IS NULL OR meter->>'unit' IS DISTINCT FROM m->>'unit' OR COALESCE(meter->>'reading','')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' OR (f->'meterResets'->>(m->>'meterKey') IS NOT NULL AND (s->>'observedAt' IS NULL OR (f->'meterResets'->>(m->>'meterKey'))::timestamptz>=(s->>'observedAt')::timestamptz)) OR (f->'meterResets' IS NULL AND f->'meterReset'='true'::jsonb) OR NOT fresh THEN review:=array_append(review,'maintenance_meter_unknown');
 ELSIF (meter->>'reading')::numeric>=(m->>'threshold')::numeric THEN review:=array_append(review,'maintenance_due');END IF;END IF;
 IF f->'basisDiverged'='true'::jsonb THEN review:=array_append(review,'included_equipment_differs');END IF;
 SELECT COALESCE(array_agg(x ORDER BY x),ARRAY[]::text[]) INTO hard FROM (SELECT DISTINCT unnest(hard) x) a;
 SELECT COALESCE(array_agg(x ORDER BY x),ARRAY[]::text[]) INTO review FROM (SELECT DISTINCT unnest(review) x) a;
 result_state:=CASE WHEN cardinality(hard)>0 THEN 'blocked' WHEN cardinality(review)>0 THEN 'needs_review' ELSE 'no_recorded_conflict' END;
 RETURN jsonb_build_object('lineId',l->>'lineId','required',TRUE,'status',result_state,'hard',to_jsonb(hard),'review',to_jsonb(review));
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_assess(v JSONB,evidence JSONB,at_value TIMESTAMPTZ,proposal JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE lines JSONB;result_state TEXT;checked_line JSONB;other_line JSONB;asset_id TEXT;start_a TIMESTAMPTZ;end_a TIMESTAMPTZ;start_b TIMESTAMPTZ;end_b TIMESTAMPTZ;idx INT;field_name TEXT;reason_code TEXT;row_value JSONB;
BEGIN
 SELECT COALESCE(jsonb_agg(public.canonical_equipment_readiness_assess_line(l,(SELECT f FROM jsonb_array_elements(evidence->'lines') f WHERE f->>'lineId'=l->>'lineId'),at_value,proposal) ORDER BY ordinal),'[]') INTO lines FROM jsonb_array_elements(v->'lines') WITH ORDINALITY a(l,ordinal);
 FOR checked_line IN SELECT value FROM jsonb_array_elements(v->'lines') WHERE value->'required'='true'::jsonb LOOP
 SELECT f->>'assetId' INTO asset_id FROM jsonb_array_elements(evidence->'lines') f WHERE f->>'lineId'=checked_line->>'lineId';IF asset_id IS NULL THEN CONTINUE;END IF;
 FOR other_line IN SELECT value FROM jsonb_array_elements(v->'lines') WHERE value->'required'='true'::jsonb AND value->>'lineId'<>checked_line->>'lineId' LOOP
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence->'lines') f WHERE f->>'lineId'=other_line->>'lineId' AND f->>'assetId'=asset_id) THEN CONTINUE;END IF;
 start_a:=(CASE WHEN proposal IS NULL THEN checked_line->>'start' ELSE proposal->>'scheduledStart' END)::timestamptz;end_a:=(CASE WHEN proposal IS NULL THEN checked_line->>'end' ELSE proposal->>'scheduledEnd' END)::timestamptz;
 start_b:=(CASE WHEN proposal IS NULL THEN other_line->>'start' ELSE proposal->>'scheduledStart' END)::timestamptz;end_b:=(CASE WHEN proposal IS NULL THEN other_line->>'end' ELSE proposal->>'scheduledEnd' END)::timestamptz;
 IF start_a IS NULL OR end_a IS NULL OR start_b IS NULL OR end_b IS NULL THEN field_name:='review';reason_code:='identified_asset_windows_unknown';ELSIF start_a<end_b AND start_b<end_a THEN field_name:='hard';reason_code:='identified_asset_overlap';ELSE CONTINUE;END IF;
 SELECT ordinal::int-1,value INTO idx,row_value FROM jsonb_array_elements(lines) WITH ORDINALITY r(value,ordinal) WHERE value->>'lineId'=checked_line->>'lineId';
 row_value:=jsonb_set(row_value,ARRAY[field_name],(SELECT jsonb_agg(code ORDER BY code) FROM (SELECT DISTINCT value code FROM jsonb_array_elements_text((row_value->field_name)||to_jsonb(reason_code))) codes));
 row_value:=jsonb_set(row_value,'{status}',to_jsonb(CASE WHEN jsonb_array_length(row_value->'hard')>0 THEN 'blocked' ELSE 'needs_review' END::text));lines:=jsonb_set(lines,ARRAY[idx::text],row_value);
 END LOOP;END LOOP;
 result_state:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(lines) l WHERE l->>'status'='blocked') THEN 'blocked' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(lines) l WHERE l->>'status'='needs_review') THEN 'needs_review' WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lines) l WHERE l->'required'='true'::jsonb) THEN 'not_required' ELSE 'no_recorded_conflict' END;
 RETURN jsonb_build_object('sourcesDigest',evidence->>'digest','status',result_state,'lines',lines);
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_knowledge_current(k JSONB,include_tombstoned BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE document JSONB:=(k->>'canonical_document')::jsonb;projection JSONB;cap TEXT;caps JSONB;
BEGIN
 IF encode(sha256(convert_to(k->>'canonical_document','UTF8')),'hex') IS DISTINCT FROM btrim(k->>'canonical_digest') OR btrim(k->>'canonical_digest') IS DISTINCT FROM btrim(k->>'publication_digest') OR document->>'canonicalKey' IS DISTINCT FROM k->>'canonical_key' OR document->>'entryType' IS DISTINCT FROM k->>'entry_type' OR document->>'sensitivity' IS DISTINCT FROM k->>'sensitivity' OR document->>'reviewRequirement' IS DISTINCT FROM k->>'review_requirement' OR NOT include_tombstoned AND document#>>'{content,state}'='tombstoned' THEN RETURN FALSE;END IF;
 projection:=document#>'{applicability,projection}';
 IF projection IS NOT NULL THEN
 IF jsonb_typeof(projection)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(projection) field WHERE field NOT IN ('audiences','capabilities','consumers')) THEN RETURN FALSE;END IF;
 IF projection ? 'audiences' AND (jsonb_typeof(projection->'audiences')<>'array' OR NOT projection->'audiences' ? 'internal') THEN RETURN FALSE;END IF;
 IF projection ? 'consumers' AND (jsonb_typeof(projection->'consumers')<>'array' OR NOT projection->'consumers' ? 'northstar_assistant') THEN RETURN FALSE;END IF;
 END IF;
 cap:=CASE k->>'canonical_key' WHEN 'organization.operational-capabilities' THEN 'operational_capabilities' WHEN 'organization.services' THEN 'services' WHEN 'organization.availability' THEN 'availability' ELSE NULL END;
 IF cap IS NOT NULL THEN RETURN projection IS NULL OR NOT projection ? 'capabilities' OR projection->'capabilities' ? cap;END IF;
 caps:=projection->'capabilities';RETURN jsonb_typeof(caps)='array' AND caps ?| ARRAY['operational_capabilities','services','availability'];
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_knowledge_current(jsonb,boolean) FROM PUBLIC;
CREATE FUNCTION public.canonical_equipment_readiness_knowledge_pins(sources JSONB) RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(array_agg(DISTINCT selected.pin),ARRAY[]::text[]) FROM (
 SELECT k->>'publication_id' pin,cap FROM jsonb_array_elements(COALESCE(sources->'knowledgeRows','[]')) k CROSS JOIN unnest(ARRAY['availability','operational_capabilities','services']) cap
 WHERE public.canonical_equipment_readiness_knowledge_current(k,TRUE)
 AND CASE k->>'canonical_key' WHEN 'organization.availability' THEN cap='availability' WHEN 'organization.operational-capabilities' THEN cap='operational_capabilities' WHEN 'organization.services' THEN cap='services' ELSE (k->>'canonical_document')::jsonb#>'{applicability,projection,capabilities}' ? cap END
 AND ((k->>'canonical_document')::jsonb#>'{applicability,projection,capabilities}' IS NULL OR (k->>'canonical_document')::jsonb#>'{applicability,projection,capabilities}' ? cap)
 ORDER BY cap COLLATE "C",(k->>'canonical_key') COLLATE "C",(k->>'canonical_digest') COLLATE "C" LIMIT 32
 ) selected;
$$;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_knowledge_pins(jsonb) FROM PUBLIC;
CREATE FUNCTION public.canonical_equipment_readiness_requirement_status(l JSONB,sources JSONB,at_value TIMESTAMPTZ) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset JSONB;research JSONB;q JSONB;spec JSONB;k TEXT;reviewed BOOLEAN:=TRUE;unknown_value BOOLEAN:=FALSE;conflict_value BOOLEAN:=FALSE;match_value BOOLEAN;
BEGIN
 IF l->>'assetId' IS NOT NULL THEN
 SELECT a INTO asset FROM jsonb_array_elements(sources->'assets') a WHERE a->>'id'=l->>'assetId';research:=asset->'research';
 IF asset IS NULL OR asset->>'catalogueState'<>'active' OR asset->>'reviewState'<>'reviewed' OR (SELECT jsonb_object_agg(identity_key,asset->'privateConfiguration'->identity_key) FROM unnest(ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments']) identity_key) IS DISTINCT FROM l->'identity' THEN reviewed:=FALSE;END IF;
 ELSE SELECT r->'research' INTO research FROM jsonb_array_elements(sources->'references') r WHERE r->'identity'=l->'identity';END IF;
 FOREACH k IN ARRAY ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments'] LOOP IF l->'identity'->>k IS NULL THEN reviewed:=FALSE;END IF;END LOOP;
 IF research->>'state' IS DISTINCT FROM 'reviewed' OR research->>'freshUntil' IS NULL OR (research->>'freshUntil')::timestamptz<=at_value THEN reviewed:=FALSE;END IF;
 IF jsonb_array_length(l->'requirements')=0 THEN unknown_value:=TRUE;END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(l->'requirements') LOOP
 IF q->>'origin'='recorded_job' AND (sources->'scope'->>(q->>'scopeKey')) IS DISTINCT FROM q->>'value' THEN unknown_value:=TRUE;CONTINUE;END IF;
 spec:=research->'specifications'->((q->>'specificationIndex')::int);
 IF NOT reviewed OR spec IS NULL OR q->>'value' IS NULL OR spec->>'unit' IS DISTINCT FROM q->>'unit' THEN unknown_value:=TRUE;CONTINUE;END IF;
 IF q->>'kind'='numeric' THEN
 IF q->>'unit'='' OR COALESCE(spec->>'value','')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' THEN unknown_value:=TRUE;CONTINUE;END IF;
 match_value:=CASE q->>'operator' WHEN 'at_least' THEN (spec->>'value')::numeric>=(q->>'value')::numeric WHEN 'at_most' THEN (spec->>'value')::numeric<=(q->>'value')::numeric ELSE (spec->>'value')::numeric=(q->>'value')::numeric END;
 ELSE match_value:=spec->>'value'=q->>'value';END IF;
 IF NOT match_value THEN conflict_value:=TRUE;END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(l->'knowledgePins') pin WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources->'knowledgeRows') knowledge_row WHERE knowledge_row->>'publication_id'=pin AND pin=ANY(public.canonical_equipment_readiness_knowledge_pins(sources)) AND public.canonical_equipment_readiness_knowledge_current(knowledge_row))) THEN unknown_value:=TRUE;END IF;
 RETURN CASE WHEN conflict_value THEN 'conflicts_with_requirement' WHEN NOT reviewed OR unknown_value THEN 'needs_information' ELSE 'matches_reviewed_requirements' END;
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;s JSONB;m JSONB;a JSONB;p JSONB;k TEXT;ids TEXT[]:=ARRAY[]::text[];alts TEXT[]:=ARRAY[]::text[];
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['equipmentBasis','lines','replacement','assessment']) IS NOT TRUE OR jsonb_typeof(v->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'lines') NOT BETWEEN 1 AND 12 OR octet_length(v::text)>32768 THEN RAISE EXCEPTION 'Readiness input invalid' USING ERRCODE='22023';END IF;
 p:=v->'equipmentBasis';IF public.canonical_field_evidence_object_keys_exact(p,ARRAY['planId','revision','digest']) IS NOT TRUE OR p->>'planId' IS NULL OR jsonb_typeof(p->'revision') IS DISTINCT FROM 'number' OR COALESCE(p->>'revision','')!~'^[1-9][0-9]{0,4}$' OR (p->>'revision')::int>10000 OR COALESCE(p->>'digest','')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Equipment basis invalid' USING ERRCODE='22023';END IF;IF COALESCE((p->>'planId'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
 IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','required','notRequiredReason','quantity','start','end','timeZone','location','source','maintenance','alternatives']) IS NOT TRUE OR l->>'lineId' IS NULL OR l->>'lineId'=ANY(ids) OR jsonb_typeof(l->'required') IS DISTINCT FROM 'boolean' OR public.canonical_labor_plan_text(l->'notRequiredReason',500,(l->>'required')::boolean) IS NOT TRUE OR public.canonical_labor_plan_text(l->'location',500,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(l->'timeZone',100,FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'Readiness line invalid' USING ERRCODE='22023';END IF;
 IF COALESCE((l->>'lineId'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;ids:=array_append(ids,l->>'lineId');IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=l->>'timeZone') THEN RAISE EXCEPTION 'Timezone invalid' USING ERRCODE='22023';END IF;
 IF l->'quantity'<>'null'::jsonb AND (jsonb_typeof(l->'quantity')<>'number' OR l->>'quantity'!~'^[1-9][0-9]{0,4}$' OR (l->>'quantity')::int>10000) THEN RAISE EXCEPTION 'Quantity invalid' USING ERRCODE='22023';END IF;
 s:=l->'source';m:=l->'maintenance';
 IF public.canonical_field_evidence_object_keys_exact(s,ARRAY['kind','label','reference','observedAt','validUntil','quantity','start','end','condition','restrictions','location','leadTime','leadTimeUnit']) IS NOT TRUE OR COALESCE(s->>'kind','') NOT IN ('my_observation','supplier_statement','company_record') OR public.canonical_labor_plan_text(s->'label',200,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(s->'reference',500,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(s->'restrictions',1000,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(s->'location',500,TRUE) IS NOT TRUE OR COALESCE(s->>'condition','') NOT IN ('unknown','reported_no_problem','problem_reported','out_of_service') THEN RAISE EXCEPTION 'Readiness source invalid' USING ERRCODE='22023';END IF;
 IF s->'quantity'<>'null'::jsonb AND (jsonb_typeof(s->'quantity')<>'number' OR s->>'quantity'!~'^(0|[1-9][0-9]{0,4})$' OR (s->>'quantity')::int>10000) THEN RAISE EXCEPTION 'Reported quantity invalid' USING ERRCODE='22023';END IF;
 IF s->'leadTime'='null'::jsonb THEN IF s->'leadTimeUnit'<>'null'::jsonb THEN RAISE EXCEPTION 'Lead time unit invalid' USING ERRCODE='22023';END IF;
 ELSIF jsonb_typeof(s->'leadTime')<>'number' OR s->>'leadTime'!~'^(0|[1-9][0-9]{0,4})$' OR (s->>'leadTime')::int>10000 OR COALESCE(s->>'leadTimeUnit','') NOT IN ('hours','days') THEN RAISE EXCEPTION 'Lead time invalid' USING ERRCODE='22023';END IF;
 IF public.canonical_field_evidence_object_keys_exact(m,ARRAY['dueAt','meterKey','threshold','unit','reference']) IS NOT TRUE OR public.canonical_labor_plan_text(m->'reference',500,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Maintenance invalid' USING ERRCODE='22023';END IF;
 IF m->'threshold'='null'::jsonb THEN IF m->'meterKey'<>'null'::jsonb OR m->'unit'<>'null'::jsonb THEN RAISE EXCEPTION 'Maintenance unit invalid' USING ERRCODE='22023';END IF;
 ELSIF jsonb_typeof(m->'threshold')<>'string' OR m->>'threshold'!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' OR public.canonical_labor_plan_text(m->'meterKey',80,FALSE) IS NOT TRUE OR public.canonical_labor_plan_text(m->'unit',80,FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'Maintenance threshold invalid' USING ERRCODE='22023';END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(jsonb_build_array(l->'start',l->'end',s->'start',s->'end',s->'observedAt',s->'validUntil',m->'dueAt')) LOOP
 IF a<>'null'::jsonb THEN IF jsonb_typeof(a)<>'string' OR a#>>'{}'!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$' THEN RAISE EXCEPTION 'Date invalid' USING ERRCODE='22023';END IF;IF substring(a#>>'{}',1,4)::int<1 OR substring(a#>>'{}',12,2)::int>23 OR substring(a#>>'{}',15,2)::int>59 OR substring(a#>>'{}',18,2)::int>59 OR (right(a#>>'{}',1)<>'Z' AND (substring(right(a#>>'{}',6),2,2)::int>14 OR right(a#>>'{}',2)::int>59 OR substring(right(a#>>'{}',6),2,2)::int=14 AND right(a#>>'{}',2)::int<>0)) THEN RAISE EXCEPTION 'Date invalid' USING ERRCODE='22023';END IF;PERFORM (a#>>'{}')::timestamptz;END IF;
 END LOOP;
 IF (l->>'start' IS NULL)<>(l->>'end' IS NULL) OR (l->>'start')::timestamptz>=(l->>'end')::timestamptz OR (s->>'start' IS NULL)<>(s->>'end' IS NULL) OR (s->>'start')::timestamptz>=(s->>'end')::timestamptz OR s->>'validUntil' IS NOT NULL AND (s->>'observedAt' IS NULL OR (s->>'validUntil')::timestamptz<=(s->>'observedAt')::timestamptz) THEN RAISE EXCEPTION 'Date order invalid' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(l->'alternatives') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Alternatives invalid' USING ERRCODE='22023';END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(l->'alternatives') LOOP
 IF public.canonical_field_evidence_object_keys_exact(a,ARRAY['alternativeId','assetId','identity','reason']) IS NOT TRUE OR a->>'alternativeId' IS NULL OR a->>'alternativeId'=ANY(alts) OR public.canonical_labor_plan_text(a->'reason',1000,FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'Alternative invalid' USING ERRCODE='22023';END IF;IF COALESCE((a->>'alternativeId'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;IF a->>'assetId' IS NOT NULL THEN IF COALESCE((a->>'assetId'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;END IF;alts:=array_append(alts,a->>'alternativeId');IF cardinality(alts)>12 THEN RAISE EXCEPTION 'Alternative limit' USING ERRCODE='22023';END IF;
 IF public.canonical_field_evidence_object_keys_exact(a->'identity',ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments']) IS NOT TRUE THEN RAISE EXCEPTION 'Alternative identity invalid' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments'] LOOP IF a->'identity'->k<>'null'::jsonb AND public.canonical_labor_plan_text(a->'identity'->k,200,FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'Alternative identity invalid' USING ERRCODE='22023';END IF;END LOOP;
 END LOOP;
 END LOOP;
 p:=v->'replacement';IF p<>'null'::jsonb THEN
 IF public.canonical_field_evidence_object_keys_exact(p,ARRAY['readinessId','equipmentBasis','lineId','alternativeId']) IS NOT TRUE OR public.canonical_field_evidence_object_keys_exact(p->'equipmentBasis',ARRAY['planId','revision','digest']) IS NOT TRUE OR jsonb_typeof(p#>'{equipmentBasis,revision}') IS DISTINCT FROM 'number' OR p->>'readinessId' IS NULL OR p->>'lineId' IS NULL OR p->>'alternativeId' IS NULL OR p#>>'{equipmentBasis,planId}' IS NULL OR COALESCE(p#>>'{equipmentBasis,revision}','')!~'^[1-9][0-9]{0,4}$' OR (p#>>'{equipmentBasis,revision}')::int>10000 OR COALESCE(p#>>'{equipmentBasis,digest}','')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Replacement invalid' USING ERRCODE='22023';END IF;
 IF COALESCE((p->>'readinessId'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;IF COALESCE((p->>'lineId'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;IF COALESCE((p->>'alternativeId'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;IF COALESCE((p#>>'{equipmentBasis,planId}'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Equipment identity invalid' USING ERRCODE='22023';END IF;END IF;
END $$;
-- Withheld source helper. Only protected owner reads or trusted scheduling routines call it.
CREATE FUNCTION public.canonical_equipment_readiness_catalog(org UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB;total_value INTEGER;
BEGIN
 SELECT count(*) INTO total_value FROM public.tenant_assets WHERE organization_id=org;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',asset.id,'name',asset.name,'manufacturer',asset.manufacturer,'model',asset.model,'modelYear',asset.model_year,
 'catalogueState',asset.catalogue_state,'version',asset.version,'category',asset.category,
 'categoryLabel',CASE WHEN pin.asset_id IS NULL OR pin.review_state<>'reviewed' OR pin.asset_digest<>public.equipment_digest(to_jsonb(asset)) OR research.value->>'state'<>'reviewed'
 OR research.value->>'versionId' IS DISTINCT FROM pin.knowledge_version_id::text THEN 'Needs review' ELSE pin.category_label END,
 'reviewState',CASE WHEN pin.asset_id IS NOT NULL AND pin.review_state='reviewed' AND pin.asset_digest=public.equipment_digest(to_jsonb(asset)) AND research.value->>'state'='reviewed'
 AND research.value->>'versionId'=pin.knowledge_version_id::text THEN 'reviewed' ELSE 'needs_review' END,
 'assetDigest',public.equipment_digest(to_jsonb(asset)),'knowledgeVersionId',pin.knowledge_version_id,'knowledgeDigest',pin.knowledge_digest,
 'research',research.value,'privateConfiguration',pin.private_configuration,
 'operationRevision',COALESCE(ledger.revision,0),'operationDigest',ledger.digest,
 'availability',CASE WHEN pin.asset_id IS NULL OR pin.review_state<>'reviewed' OR pin.asset_digest<>public.equipment_digest(to_jsonb(asset))
 OR research.value->>'state' IS DISTINCT FROM 'reviewed' OR research.value->>'versionId' IS DISTINCT FROM pin.knowledge_version_id::text THEN 'needs_review' ELSE COALESCE(ledger.state->>'availability','unknown') END,
 'recordedAvailability',COALESCE(ledger.state->>'availability','unknown')) ORDER BY lower(asset.name),asset.id),'[]')
 INTO result FROM (SELECT * FROM public.tenant_assets WHERE organization_id=org ORDER BY lower(name),id LIMIT 500) asset
 LEFT JOIN public.canonical_equipment_asset_versions pin ON pin.organization_id=asset.organization_id AND pin.asset_id=asset.id AND pin.asset_version=asset.version
 LEFT JOIN public.canonical_equipment_ledgers ledger ON ledger.organization_id=asset.organization_id AND ledger.asset_id=asset.id
 LEFT JOIN LATERAL (SELECT public.equipment_research(pin.private_configuration) AS value WHERE pin.asset_id IS NOT NULL) research ON TRUE;
 RETURN jsonb_build_object('assets',result,'total',total_value,'returned',jsonb_array_length(result),'truncated',total_value>jsonb_array_length(result),
 'authority','postgresql');
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_plan_sources(org UUID,estimate UUID,inputs_value JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE catalog JSONB;assets JSONB;refs JSONB;knowledge JSONB;scope_value JSONB;service_key TEXT;payload JSONB;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN RAISE EXCEPTION 'Protected equipment review required' USING ERRCODE='42501';END IF;
 SELECT snapshot->'service'->'scope',snapshot->'service'->>'key' INTO scope_value,service_key FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 IF inputs_value IS NOT NULL THEN PERFORM public.canonical_equipment_plan_validate(inputs_value);IF inputs_value->>'serviceKey' IS DISTINCT FROM service_key THEN RAISE EXCEPTION 'Service changed' USING ERRCODE='40001';END IF;END IF;
 catalog:=public.canonical_equipment_readiness_catalog(org);
 SELECT COALESCE(jsonb_agg(a ORDER BY a->>'id'),'[]'::jsonb) INTO assets FROM jsonb_array_elements(catalog->'assets') a WHERE inputs_value IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(inputs_value->'lines') l WHERE l->>'assetId'=a->>'id');
 SELECT COALESCE(jsonb_agg(jsonb_build_object('identity',identity_value,'research',public.equipment_research(identity_value)) ORDER BY identity_value::text),'[]'::jsonb) INTO refs FROM (SELECT DISTINCT l->'identity' identity_value FROM jsonb_array_elements(COALESCE(inputs_value->'lines','[]'::jsonb)) l WHERE l->'assetId'='null'::jsonb) identities;
 WITH latest AS (SELECT DISTINCT ON(entry_id) * FROM public.canonical_knowledge_publications WHERE organization_id=org ORDER BY entry_id,publication_number DESC,id), selected AS (
 SELECT e.id entry_id,e.canonical_key,e.entry_type,v.id version_id,v.version_number,v.sensitivity,v.review_requirement,v.canonical_document,v.canonical_digest,p.id publication_id,p.publication_number,p.canonical_digest publication_digest
 FROM latest p JOIN public.canonical_knowledge_entries e ON e.organization_id=p.organization_id AND e.id=p.entry_id JOIN public.canonical_knowledge_versions v ON v.organization_id=p.organization_id AND v.entry_id=p.entry_id AND v.id=p.version_id
 WHERE (e.canonical_key IN ('organization.operational-capabilities','organization.services','organization.availability') OR v.applicability->'projection'->'capabilities' ?| ARRAY['operational_capabilities','services','availability']) AND (inputs_value IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(inputs_value->'lines') l CROSS JOIN LATERAL jsonb_array_elements_text(l->'knowledgePins') pin WHERE pin=p.id::text)) ORDER BY e.canonical_key,p.id LIMIT 257)
 SELECT COALESCE(jsonb_agg(to_jsonb(selected)),'[]'::jsonb) INTO knowledge FROM selected;
 IF jsonb_array_length(knowledge)>256 THEN RAISE EXCEPTION 'Source limit reached' USING ERRCODE='54000';END IF;
 payload:=jsonb_build_object('assets',assets,'references',refs,'knowledgeRows',knowledge,'scope',COALESCE(scope_value,'{}'::jsonb),'serviceKey',service_key,'truncated',catalog->'truncated');
 RETURN payload||jsonb_build_object('digest',public.equipment_digest(payload));
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_asset_fact(org UUID,operation_value UUID,graph_value UUID,l JSONB,sources JSONB,cost_diverged BOOLEAN,at_value TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset JSONB;ledger public.canonical_equipment_ledgers%ROWTYPE;last_record TIMESTAMPTZ;last_observed TIMESTAMPTZ;count_value BIGINT;current_job BOOLEAN;last_reset BOOLEAN;state_value JSONB;fact JSONB;notes JSONB:='[]';resets JSONB:='{}';
BEGIN
 asset:=NULL;ledger:=NULL;last_record:=NULL;last_observed:=NULL;count_value:=0;current_job:=FALSE;last_reset:=FALSE;
 IF l->>'assetId' IS NOT NULL THEN
 SELECT a INTO asset FROM jsonb_array_elements(sources->'assets') a WHERE a->>'id'=l->>'assetId';
 SELECT * INTO ledger FROM public.canonical_equipment_ledgers WHERE organization_id=org AND asset_id=(l->>'assetId')::uuid;
 SELECT count(*),max(recorded_at),max((document->>'observedAt')::timestamptz) INTO count_value,last_record,last_observed FROM public.canonical_equipment_events WHERE organization_id=org AND asset_id=(l->>'assetId')::uuid;
 SELECT document->>'kind'='meter_reset' INTO last_reset FROM public.canonical_equipment_events WHERE organization_id=org AND asset_id=(l->>'assetId')::uuid AND document->>'reading' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events s WHERE s.organization_id=org AND s.supersedes_id=canonical_equipment_events.id) ORDER BY revision DESC LIMIT 1;
 SELECT EXISTS(SELECT 1 FROM public.canonical_field_executions x WHERE x.organization_id=org AND x.id::text=ledger.state->>'checkedOutExecution' AND x.operation_id=operation_value AND x.graph_id=graph_value) INTO current_job;
 END IF;
 IF l->>'assetId' IS NOT NULL THEN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',document->>'kind','observedAt',document->>'observedAt','description',document->>'description') ORDER BY revision DESC),'[]') INTO notes FROM (SELECT e.document,e.revision FROM public.canonical_equipment_events e WHERE e.organization_id=org AND e.asset_id=(l->>'assetId')::uuid AND e.document->>'kind' IN ('condition','fault','maintenance','downtime_start','downtime_end') AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events newer WHERE newer.organization_id=org AND newer.supersedes_id=e.id) ORDER BY e.revision DESC LIMIT 4) recent;
 SELECT COALESCE(jsonb_object_agg(meter_key,observed),'{}') INTO resets FROM (SELECT e.document->>'meterKey' meter_key,max((e.document->>'observedAt')::timestamptz) observed FROM public.canonical_equipment_events e WHERE e.organization_id=org AND e.asset_id=(l->>'assetId')::uuid AND e.document->>'kind'='meter_reset' AND e.document->>'meterKey' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events newer WHERE newer.organization_id=org AND newer.supersedes_id=e.id) GROUP BY e.document->>'meterKey') meters;
 END IF;
 state_value:=COALESCE(ledger.state,'{}');fact:=jsonb_build_object('lineId',l->>'lineId','assetId',l->>'assetId','ledgerRevision',COALESCE(ledger.revision,0),'ledgerDigest',ledger.digest,'complete',ledger.revision IS NOT NULL AND count_value=ledger.revision AND last_record IS NOT NULL AND sources->'truncated' IS DISTINCT FROM 'true'::jsonb,'recordedAt',last_record,'observedAt',last_observed,'state',state_value,'meterReset',COALESCE(last_reset,FALSE),'meterResets',resets,'observations',notes,'currentJob',current_job,'targetMatches',FALSE,'sourceCurrent',asset IS NOT NULL AND asset->>'reviewState'='reviewed' AND (SELECT jsonb_object_agg(identity_key,asset->'privateConfiguration'->identity_key) FROM unnest(ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments']) identity_key)=l->'identity' AND sources->'truncated' IS DISTINCT FROM 'true'::jsonb,'requirementStatus',public.canonical_equipment_readiness_requirement_status(l,sources,at_value),'basisDiverged',cost_diverged);
 RETURN fact;
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_asset_fact(uuid,uuid,uuid,jsonb,jsonb,boolean,timestamptz) FROM PUBLIC;
CREATE FUNCTION public.canonical_equipment_readiness_evidence(org UUID,estimate UUID,inputs_value JSONB,lock_value BOOLEAN DEFAULT FALSE) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE plan public.canonical_equipment_plans%ROWTYPE;ep public.canonical_estimates%ROWTYPE;sources JSONB;asset JSONB;l JSONB;fact JSONB;result JSONB:='[]';state_value JSONB;payload JSONB;ledger public.canonical_equipment_ledgers%ROWTYPE;count_value BIGINT;last_record TIMESTAMPTZ;last_observed TIMESTAMPTZ;last_reset BOOLEAN;current_job BOOLEAN;cost_basis JSONB;at_value TIMESTAMPTZ;comparison_inputs JSONB;candidate JSONB;original_line JSONB;candidate_line JSONB;candidate_sources JSONB;alternative_facts JSONB:='[]';
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN RAISE EXCEPTION 'Protected equipment review required' USING ERRCODE='42501';END IF;
 SELECT * INTO ep FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO plan FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF plan.id IS NULL OR plan.action<>'save' THEN IF inputs_value IS NOT NULL THEN RAISE EXCEPTION 'Equipment plan changed' USING ERRCODE='40001';END IF; RETURN jsonb_build_object('equipmentBasis',NULL,'lines','[]'::jsonb,'digest',public.canonical_completion_digest(jsonb_build_object('equipment',plan.id,'action',plan.action)));END IF;
 IF inputs_value IS NOT NULL THEN PERFORM public.canonical_equipment_readiness_validate(inputs_value);PERFORM public.canonical_equipment_readiness_replacement(org,estimate,inputs_value);IF inputs_value->'equipmentBasis' IS DISTINCT FROM jsonb_build_object('planId',plan.id,'revision',plan.revision,'digest',plan.digest) THEN RAISE EXCEPTION 'Equipment plan changed' USING ERRCODE='40001';END IF;
 IF jsonb_array_length(inputs_value->'lines')<>jsonb_array_length(plan.inputs->'lines') OR EXISTS(SELECT 1 FROM jsonb_array_elements(inputs_value->'lines') r WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan.inputs->'lines') p WHERE p->>'lineId'=r->>'lineId')) THEN RAISE EXCEPTION 'Readiness must cover the saved equipment plan' USING ERRCODE='22023';END IF;
 END IF;
 comparison_inputs:=inputs_value;
 IF comparison_inputs IS NULL THEN SELECT inputs INTO comparison_inputs FROM public.canonical_equipment_readiness_plans WHERE organization_id=org AND estimate_id=estimate AND action='save' AND inputs->'equipmentBasis'=jsonb_build_object('planId',plan.id,'revision',plan.revision,'digest',plan.digest) ORDER BY revision DESC LIMIT 1;END IF;
 -- Same key as046 writer, ordered across all selected assets, including absent ledgers.
 IF lock_value THEN
 PERFORM public.canonical_material_supporting_authority_read_lock();
 FOR l IN SELECT jsonb_build_object('assetId',asset_id) FROM (SELECT value->>'assetId' asset_id FROM jsonb_array_elements(plan.inputs->'lines') UNION SELECT a->>'assetId' FROM jsonb_array_elements(COALESCE(comparison_inputs->'lines','[]')) r CROSS JOIN LATERAL jsonb_array_elements(r->'alternatives') a) assets WHERE asset_id IS NOT NULL ORDER BY asset_id LOOP
 PERFORM 1 FROM public.tenant_assets WHERE organization_id=org AND id=(l->>'assetId')::uuid FOR SHARE;
 PERFORM public.canonical_equipment_readiness_fence(org,(l->>'assetId')::uuid);
 END LOOP;END IF;
 sources:=public.canonical_equipment_readiness_plan_sources(org,estimate,plan.inputs);at_value:=clock_timestamp();
 SELECT component_manifest#>'{equipment,equipmentBasis}' INTO cost_basis FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 FOR l IN SELECT value FROM jsonb_array_elements(plan.inputs->'lines') LOOP
 fact:=public.canonical_equipment_readiness_asset_fact(org,ep.operation_id,ep.graph_id,l,sources,cost_basis IS NOT NULL AND cost_basis->>'planId' IS DISTINCT FROM plan.id::text,at_value);
 result:=result||jsonb_build_array(fact);
 END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(COALESCE(comparison_inputs->'lines','[]')) LOOP
 SELECT value INTO original_line FROM jsonb_array_elements(plan.inputs->'lines') WHERE value->>'lineId'=l->>'lineId';
 FOR candidate IN SELECT value FROM jsonb_array_elements(l->'alternatives') LOOP
 candidate_line:=original_line||jsonb_build_object('assetId',candidate->'assetId','identity',candidate->'identity','requirements',(SELECT COALESCE(jsonb_agg(q||jsonb_build_object('specificationIndex',NULL)),'[]') FROM jsonb_array_elements(original_line->'requirements') q));
 candidate_sources:=public.canonical_equipment_readiness_plan_sources(org,estimate,plan.inputs||jsonb_build_object('lines',jsonb_build_array(candidate_line)));
 fact:=public.canonical_equipment_readiness_asset_fact(org,ep.operation_id,ep.graph_id,candidate_line,candidate_sources,TRUE,at_value);
 alternative_facts:=alternative_facts||jsonb_build_array(fact||jsonb_build_object('alternativeId',candidate->>'alternativeId','sourceDigest',candidate_sources->>'digest'));
 END LOOP;END LOOP;
 payload:=jsonb_build_object('equipmentBasis',jsonb_build_object('planId',plan.id,'revision',plan.revision,'digest',plan.digest),'equipmentSourceDigest',sources->>'digest','lines',result,'alternatives',alternative_facts);
 RETURN payload||jsonb_build_object('digest',public.canonical_completion_digest(payload));
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_sources(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,inputs_value JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current equipment reviewer required' USING ERRCODE='42501';END IF;
 PERFORM public.equipment_actor(org,actor,role_value,session_value,NULL,FALSE,TRUE);
 RETURN public.canonical_equipment_readiness_evidence(org,estimate,inputs_value,current_setting('transaction_isolation')='serializable');
END $$;

CREATE TABLE public.canonical_equipment_readiness_plans (
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
 evidence JSONB,
 calculation_version TEXT NOT NULL DEFAULT 'estimate-equipment-readiness-v1' CHECK(calculation_version='estimate-equipment-readiness-v1'),
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-equipment-readiness-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_equipment_readiness_plans(organization_id,estimate_id,id),
 CHECK((action='save' AND inputs IS NOT NULL) OR (action='withdraw' AND inputs IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_equipment_readiness_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_equipment_readiness_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_equipment_readiness_plans FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_equipment_readiness_immutable();

CREATE FUNCTION public.canonical_equipment_readiness_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_decision_source(org,estimate) $$;
CREATE FUNCTION public.canonical_equipment_readiness_projection(d public.canonical_equipment_readiness_plans) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'inputs',d.inputs,'evidence',d.evidence,'calculationVersion',d.calculation_version,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_equipment_readiness_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_equipment_readiness_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_equipment_readiness_plans WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_equipment_readiness_projection(d) INTO current_value FROM public.canonical_equipment_readiness_plans d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_equipment_readiness_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_equipment_readiness_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_replacement(org UUID,estimate UUID,inputs_value JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE replacement JSONB:=inputs_value->'replacement';original public.canonical_equipment_readiness_plans%ROWTYPE;plan public.canonical_equipment_plans%ROWTYPE;alternative JSONB;next_line JSONB;
BEGIN
 IF replacement IS NULL OR replacement='null'::jsonb THEN RETURN;END IF;
 SELECT * INTO original FROM public.canonical_equipment_readiness_plans WHERE organization_id=org AND estimate_id=estimate AND id=(replacement->>'readinessId')::uuid AND action='save';
 IF NOT FOUND OR original.inputs->'equipmentBasis' IS DISTINCT FROM replacement->'equipmentBasis' THEN RAISE EXCEPTION 'Original replacement review changed' USING ERRCODE='40001';END IF;
 SELECT a INTO alternative FROM jsonb_array_elements(original.inputs->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'alternatives') a WHERE l->>'lineId'=replacement->>'lineId' AND a->>'alternativeId'=replacement->>'alternativeId';
 SELECT * INTO plan FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT l INTO next_line FROM jsonb_array_elements(plan.inputs->'lines') l WHERE l->>'lineId'=replacement->>'lineId';
 IF alternative IS NULL OR next_line IS NULL OR plan.action<>'save' OR plan.revision<=(replacement#>>'{equipmentBasis,revision}')::bigint OR next_line->'assetId' IS DISTINCT FROM alternative->'assetId' OR next_line->'identity' IS DISTINCT FROM alternative->'identity' THEN RAISE EXCEPTION 'Save the selected equipment replacement first' USING ERRCODE='40001';END IF;
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_replacement(uuid,uuid,jsonb) FROM PUBLIC;
CREATE FUNCTION public.canonical_equipment_readiness_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; evidence_value JSONB; old public.canonical_equipment_readiness_plans%ROWTYPE; current_row public.canonical_equipment_readiness_plans%ROWTYPE;
 inserted public.canonical_equipment_readiness_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; decision_row public.canonical_estimate_decisions%ROWTYPE;
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
 source_value:=public.canonical_equipment_readiness_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-equipment-readiness-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN PERFORM public.canonical_equipment_readiness_validate(body->'inputs');
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':equipment-readiness:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_equipment_readiness_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before returning it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_equipment_readiness_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_equipment_readiness_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='equipment_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>20 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
IF body->>'action'='save' THEN evidence_value:=public.canonical_equipment_readiness_sources(org,actor,role_value,session_value,estimate,body->'inputs'); IF body#>'{inputs,assessment,acknowledged}' IS DISTINCT FROM 'true'::jsonb OR (body#>'{inputs,assessment}')-'acknowledged' IS DISTINCT FROM public.canonical_equipment_readiness_assess(body->'inputs',evidence_value,clock_timestamp()) THEN RAISE EXCEPTION 'Equipment readiness changed' USING ERRCODE='40001';END IF; END IF;
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_equipment_readiness_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,evidence,expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,NULLIF(body->'inputs','null'::jsonb),evidence_value,(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),'estimate-equipment-readiness-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_equipment_readiness_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_equipment_readiness_plans FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_source(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_projection(public.canonical_equipment_readiness_plans) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;


ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost','equipment_ready'));

REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_validate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_assess_line(jsonb,jsonb,timestamptz,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_assess(jsonb,jsonb,timestamptz,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_requirement_status(jsonb,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_sources(uuid,uuid,text,uuid,uuid,jsonb) FROM PUBLIC;

-- Exact046 successor: fence and post-wait current actor checks only.
CREATE OR REPLACE FUNCTION public.equipment_operation_mutate(org UUID, actor UUID, role_value TEXT, session_value UUID, csrf TEXT,
 execution_value UUID, key_value TEXT, input JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a JSONB; execution_record public.canonical_field_executions%ROWTYPE;
 assignment_record public.canonical_schedule_assignments%ROWTYPE; asset_record public.tenant_assets%ROWTYPE;
 pin public.canonical_equipment_asset_versions%ROWTYPE; ledger public.canonical_equipment_ledgers%ROWTYPE;
 previous public.canonical_equipment_events%ROWTYPE; receipt public.canonical_equipment_receipts%ROWTYPE;
 event_value UUID:=gen_random_uuid(); root_value UUID; supersedes_value UUID; performer UUID;
 asset_value UUID; research JSONB; request_hash TEXT; key_hash_value TEXT; result JSONB; item RECORD;
 state_value JSONB; readings JSONB:='{}'; meter JSONB; held_execution TEXT; held_operator TEXT; downtime BOOLEAN:=FALSE;
 has_fault BOOLEAN:=FALSE; count_value INTEGER:=0; action_value TEXT; kind_value TEXT; observed TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value IS NULL OR key_value !~ '^[!-~]{16,128}$'
 OR NOT public.equipment_keys(input,ARRAY['action','assetId','assetVersion','assetDigest','knowledgeVersionId','knowledgeDigest',
 'expectedExecutionRevision','expectedExecutionDigest','expectedAssignmentRevision','expectedAssignmentDigest','expectedAssetRevision','expectedAssetDigest',
 'performerProfileId','kind','observedAt','meterKey','reading','unit','description','reason','correctsEventId'],
 ARRAY['action','assetId','assetVersion','assetDigest','knowledgeVersionId','knowledgeDigest','expectedExecutionRevision','expectedExecutionDigest',
 'expectedAssignmentRevision','expectedAssignmentDigest','expectedAssetRevision','expectedAssetDigest','performerProfileId','kind','observedAt','meterKey','reading','unit','description','reason','correctsEventId']) THEN
 RAISE EXCEPTION 'Invalid equipment operation' USING ERRCODE='22023'; END IF;
 IF NOT public.equipment_types(input,'{"action":"string","assetId":"string","assetVersion":"number","assetDigest":"string","knowledgeVersionId":"string","knowledgeDigest":"string","expectedExecutionRevision":"number","expectedExecutionDigest":"string","expectedAssignmentRevision":"number","expectedAssignmentDigest":"string","expectedAssetRevision":"number","expectedAssetDigest":"string,null","performerProfileId":"string","kind":"string","observedAt":"string","meterKey":"string,null","reading":"string,null","unit":"string,null","description":"string","reason":"string","correctsEventId":"string,null"}') THEN
 RAISE EXCEPTION 'Invalid equipment value types' USING ERRCODE='22023'; END IF;
 a:=public.equipment_actor(org,actor,role_value,session_value,csrf,TRUE,FALSE);
 action_value:=input->>'action'; kind_value:=input->>'kind'; asset_value:=(input->>'assetId')::uuid;
 performer:=(input->>'performerProfileId')::uuid; observed:=(input->>'observedAt')::timestamptz;
 IF action_value NOT IN ('record','correct') OR kind_value NOT IN ('check_out','use','check_in','reading','condition','fault','downtime_start','downtime_end','maintenance','meter_reset')
 OR asset_value IS NULL OR performer IS NULL OR observed IS NULL OR NOT isfinite(observed)
 OR observed>clock_timestamp()+INTERVAL '5 minutes' OR observed<clock_timestamp()-INTERVAL '366 days'
 OR NOT public.equipment_text(input->>'description',1000) OR NOT public.equipment_text(input->>'reason',500) OR input->>'reason'=''
 OR input->>'expectedExecutionRevision' IS NULL OR input->>'expectedExecutionDigest' IS NULL
 OR input->>'expectedAssignmentRevision' IS NULL OR input->>'expectedAssignmentDigest' IS NULL
 OR input->>'assetVersion' IS NULL OR input->>'assetDigest' IS NULL OR input->>'knowledgeVersionId' IS NULL OR input->>'knowledgeDigest' IS NULL
 OR input->>'expectedAssetRevision' IS NULL OR (input->>'expectedAssetRevision')::integer<0
 OR ((input->>'expectedAssetRevision')::integer=0 AND input->'expectedAssetDigest'<>'null'::jsonb)
 OR ((input->>'expectedAssetRevision')::integer>0 AND input->>'expectedAssetDigest' IS NULL) THEN
 RAISE EXCEPTION 'Invalid equipment evidence' USING ERRCODE='22023'; END IF;
 IF input->>'reading' IS NOT NULL THEN
 IF input->>'reading' !~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,3})?$' OR input->>'unit' NOT IN ('hours','km','mi','percent','litres','gallons','count')
 OR NOT public.equipment_text(input->>'meterKey',80) OR input->>'meterKey'='' OR (input->>'unit'='percent' AND (input->>'reading')::numeric>100) THEN
 RAISE EXCEPTION 'Invalid equipment reading' USING ERRCODE='22023'; END IF;
 ELSIF input->>'unit' IS NOT NULL OR input->>'meterKey' IS NOT NULL OR kind_value IN ('reading','meter_reset') THEN
 RAISE EXCEPTION 'Reading and unit required' USING ERRCODE='22023'; END IF;
 IF (action_value='correct' OR kind_value='meter_reset') AND role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Equipment review authority required' USING ERRCODE='42501'; END IF;
 IF action_value='record' AND input->>'correctsEventId' IS NOT NULL OR action_value='correct' AND input->>'correctsEventId' IS NULL THEN
 RAISE EXCEPTION 'Exact correction predecessor required' USING ERRCODE='22023'; END IF;
 SELECT * INTO execution_record FROM public.canonical_field_executions WHERE organization_id=org AND id=execution_value FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Execution unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO assignment_record FROM public.canonical_schedule_assignments WHERE organization_id=org AND id=execution_record.assignment_id FOR SHARE;
 IF NOT FOUND OR NOT public.canonical_field_execution_replay_authorized(org,role_value,(a->>'profileId')::uuid,execution_value,NULL)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_transcripts WHERE organization_id=org AND operation_id=execution_record.operation_id AND graph_id=execution_record.graph_id
 AND public.canonical_labor_transcript_source_normalized(source) IN ('lead','retell','voice')) THEN RAISE EXCEPTION 'Current execution scope unavailable' USING ERRCODE='42501'; END IF;
 IF assignment_record.needs_review OR assignment_record.schedule_state<>'scheduled' THEN RAISE EXCEPTION 'Assignment needs review' USING ERRCODE='40001'; END IF;
 IF action_value='record' AND execution_record.lifecycle_state<>'in_progress' THEN RAISE EXCEPTION 'Equipment recording requires in-progress execution' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles p JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
 JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
 WHERE p.organization_id=org AND p.id=performer AND m.status='active' AND u.status='active')
 OR (role_value='member' AND performer<>(a->>'profileId')::uuid) THEN RAISE EXCEPTION 'Performer unavailable' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE(assignment_record.workforce_profile_id=performer OR
 (assignment_record.workforce_crew_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.workforce_crew_members cm
 WHERE cm.organization_id=org AND cm.crew_id=assignment_record.workforce_crew_id AND cm.profile_id=performer)),FALSE) THEN
 RAISE EXCEPTION 'Performer is outside current assignment' USING ERRCODE='42501'; END IF;
 SELECT * INTO asset_record FROM public.tenant_assets WHERE organization_id=org AND id=asset_value FOR SHARE;
 IF NOT FOUND OR asset_record.catalogue_state<>'active' THEN RAISE EXCEPTION 'Asset unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO pin FROM public.canonical_equipment_asset_versions WHERE organization_id=org AND asset_id=asset_value AND asset_version=asset_record.version;
 IF NOT FOUND OR pin.asset_digest<>public.equipment_digest(to_jsonb(asset_record)) OR pin.review_state<>'reviewed' THEN RAISE EXCEPTION 'Asset needs review' USING ERRCODE='40001'; END IF;
 research:=public.equipment_research(pin.private_configuration);
 IF research->>'state'<>'reviewed' OR (research->>'versionId')::uuid<>pin.knowledge_version_id OR research->>'digest'<>pin.knowledge_digest THEN
 RAISE EXCEPTION 'Research needs review' USING ERRCODE='40001'; END IF;
 IF execution_record.revision<>(input->>'expectedExecutionRevision')::bigint OR rtrim(execution_record.canonical_digest)<>input->>'expectedExecutionDigest'
 OR assignment_record.revision<>(input->>'expectedAssignmentRevision')::bigint OR rtrim(assignment_record.canonical_digest)<>input->>'expectedAssignmentDigest'
 OR pin.asset_version<>(input->>'assetVersion')::integer OR pin.asset_digest<>input->>'assetDigest'
 OR pin.knowledge_version_id<>(input->>'knowledgeVersionId')::uuid OR pin.knowledge_digest<>input->>'knowledgeDigest' THEN
 RAISE EXCEPTION 'Equipment source pins changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':equipment:'||asset_value::text,0));
 PERFORM public.canonical_equipment_readiness_fence(org,asset_value);
 request_hash:=public.equipment_digest(jsonb_build_object('execution',execution_value,'input',input));
 key_hash_value:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||actor::text||session_value::text||key_hash_value,0));
 SELECT * INTO receipt FROM public.canonical_equipment_receipts WHERE organization_id=org AND actor_user_id=actor AND session_id=session_value AND key_hash=key_hash_value;
 IF FOUND THEN
 IF receipt.request_digest<>request_hash THEN RAISE EXCEPTION 'Equipment idempotency conflict' USING ERRCODE='23505'; END IF;
 PERFORM public.equipment_actor(org,actor,role_value,session_value,csrf,TRUE,FALSE);
 RETURN receipt.response||jsonb_build_object('replayed',TRUE); END IF;
 IF execution_record.revision<>(input->>'expectedExecutionRevision')::bigint OR rtrim(execution_record.canonical_digest)<>input->>'expectedExecutionDigest'
 OR assignment_record.revision<>(input->>'expectedAssignmentRevision')::bigint OR rtrim(assignment_record.canonical_digest)<>input->>'expectedAssignmentDigest'
 OR pin.asset_version<>(input->>'assetVersion')::integer OR pin.asset_digest<>input->>'assetDigest'
 OR pin.knowledge_version_id<>(input->>'knowledgeVersionId')::uuid OR pin.knowledge_digest<>input->>'knowledgeDigest' THEN
 RAISE EXCEPTION 'Equipment source pins changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO ledger FROM public.canonical_equipment_ledgers WHERE organization_id=org AND asset_id=asset_value FOR UPDATE;
 IF COALESCE(ledger.revision,0)<>(input->>'expectedAssetRevision')::integer OR ledger.digest IS DISTINCT FROM input->>'expectedAssetDigest' THEN
 RAISE EXCEPTION 'Equipment ledger changed' USING ERRCODE='40001'; END IF;
 IF COALESCE(ledger.revision,0)>=10000 THEN RAISE EXCEPTION 'Equipment evidence limit reached' USING ERRCODE='54000'; END IF;
 root_value:=event_value; supersedes_value:=NULL;
 IF action_value='correct' THEN
 SELECT * INTO previous FROM public.canonical_equipment_events WHERE organization_id=org AND id=(input->>'correctsEventId')::uuid
 AND asset_id=asset_value AND execution_id=execution_value;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.canonical_equipment_events WHERE organization_id=org AND supersedes_id=previous.id) THEN
 RAISE EXCEPTION 'Correction predecessor changed' USING ERRCODE='40001'; END IF;
 root_value:=previous.root_id; supersedes_value:=previous.id;
 END IF;
 -- Fold effective evidence in original recording order. Correction replaces one
 -- fact at its original place and must preserve the complete ledger invariants.
 FOR item IN
 SELECT x.document,x.execution_id,x.performer_profile_id,x.ordinal FROM (
 SELECT e.document,e.execution_id,e.performer_profile_id,r.revision AS ordinal
 FROM public.canonical_equipment_events e JOIN public.canonical_equipment_events r ON r.organization_id=e.organization_id AND r.id=e.root_id
 WHERE e.organization_id=org AND e.asset_id=asset_value AND e.id IS DISTINCT FROM supersedes_value
 AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events s WHERE s.organization_id=org AND s.supersedes_id=e.id)
 UNION ALL SELECT input,execution_value,performer,COALESCE((SELECT revision FROM public.canonical_equipment_events WHERE organization_id=org AND id=root_value),COALESCE(ledger.revision,0)+1)
 ) x ORDER BY x.ordinal LOOP
 count_value:=count_value+1;
 IF item.document->>'kind'='check_out' THEN
 IF held_execution IS NOT NULL OR downtime THEN RAISE EXCEPTION 'Asset checkout conflicts with recorded state' USING ERRCODE='40001'; END IF;
 held_execution:=item.execution_id::text; held_operator:=item.performer_profile_id::text;
 ELSIF item.document->>'kind' IN ('use','check_in') THEN
 IF held_execution IS DISTINCT FROM item.execution_id::text OR held_operator IS DISTINCT FROM item.performer_profile_id::text OR (downtime AND item.document->>'kind'='use') THEN
 RAISE EXCEPTION 'Asset must be checked out to this operator and execution' USING ERRCODE='40001'; END IF;
 IF item.document->>'kind'='check_in' THEN held_execution:=NULL; held_operator:=NULL; END IF;
 ELSIF item.document->>'kind'='downtime_start' THEN
 IF downtime THEN RAISE EXCEPTION 'Downtime already open' USING ERRCODE='40001'; END IF; downtime:=TRUE;
 ELSIF item.document->>'kind'='downtime_end' THEN
 IF NOT downtime THEN RAISE EXCEPTION 'No recorded downtime to end' USING ERRCODE='40001'; END IF; downtime:=FALSE;
 ELSIF item.document->>'kind'='fault' THEN has_fault:=TRUE;
 END IF;
 IF item.document->>'reading' IS NOT NULL THEN
 meter:=readings->(item.document->>'meterKey');
 IF meter IS NOT NULL AND (meter->>'unit'<>item.document->>'unit' OR
 ((item.document->>'unit') IN ('hours','km','mi','count') AND (item.document->>'reading')::numeric<(meter->>'reading')::numeric))
 AND item.document->>'kind'<>'meter_reset' THEN RAISE EXCEPTION 'Meter needs explicit reset or correction' USING ERRCODE='40001'; END IF;
 readings:=readings||jsonb_build_object(item.document->>'meterKey',jsonb_build_object('reading',item.document->>'reading','unit',item.document->>'unit'));
 IF (SELECT count(*) FROM jsonb_object_keys(readings))>64 THEN RAISE EXCEPTION 'Equipment meter bound reached' USING ERRCODE='54000'; END IF;
 END IF;
 END LOOP;
 state_value:=jsonb_build_object('revision',COALESCE(ledger.revision,0)+1,'effectiveFactCount',count_value,'checkedOutExecution',held_execution,'operator',held_operator,
 'downtime',downtime,'recordedFault',has_fault,'readings',readings,'availability',CASE WHEN downtime THEN 'recorded_unavailable' WHEN has_fault THEN 'needs_review' WHEN held_execution IS NOT NULL THEN 'in_use' ELSE 'unknown' END);
 IF octet_length(state_value::text)>32768 THEN RAISE EXCEPTION 'Equipment state bound reached' USING ERRCODE='54000'; END IF;
 PERFORM public.equipment_actor(org,actor,role_value,session_value,csrf,TRUE,FALSE);
 INSERT INTO public.canonical_equipment_ledgers(organization_id,asset_id,revision,state,digest)
 VALUES(org,asset_value,COALESCE(ledger.revision,0)+1,state_value,public.equipment_digest(state_value))
 ON CONFLICT(organization_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision,state=EXCLUDED.state,digest=EXCLUDED.digest;
 INSERT INTO public.canonical_equipment_events(organization_id,id,asset_id,asset_version,asset_digest,knowledge_version_id,knowledge_digest,execution_id,assignment_id,
 actor_user_id,performer_profile_id,session_id,revision,root_id,supersedes_id,document,digest,state,state_digest,request_digest)
 VALUES(org,event_value,asset_value,pin.asset_version,pin.asset_digest,pin.knowledge_version_id,pin.knowledge_digest,execution_value,assignment_record.id,actor,performer,session_value,
 COALESCE(ledger.revision,0)+1,root_value,supersedes_value,input,public.equipment_digest(input),state_value,public.equipment_digest(state_value),request_hash);
 result:=jsonb_build_object('data',jsonb_build_object('eventId',event_value,'revision',COALESCE(ledger.revision,0)+1,'digest',public.equipment_digest(state_value),
 'availability',state_value->>'availability','advisoryOnly',TRUE),'replayed',FALSE);
 INSERT INTO public.canonical_equipment_receipts(organization_id,actor_user_id,session_id,key_hash,request_digest,action,subject_id,response)
 VALUES(org,actor,session_value,key_hash_value,request_hash,'operation',event_value,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_catalog(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_plan_sources(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_evidence(uuid,uuid,jsonb,boolean) FROM PUBLIC;

-- Internal scheduling evidence shares the same selected equipment/046 fold. It
-- returns no recommendation authority of its own and never reserves an asset.
CREATE FUNCTION public.canonical_equipment_readiness_schedule_basis(org UUID,assignment UUID,target_kind TEXT,target_id UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,zone_value TEXT,lock_value BOOLEAN DEFAULT FALSE) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE schedule public.canonical_schedule_assignments%ROWTYPE;estimate_value UUID;plan public.canonical_equipment_plans%ROWTYPE;ready public.canonical_equipment_readiness_plans%ROWTYPE;inputs_value JSONB;evidence JSONB;facts JSONB;f JSONB;payload JSONB;changed BOOLEAN;target_profiles UUID[];at_value TIMESTAMPTZ;
BEGIN
 SELECT * INTO schedule FROM public.canonical_schedule_assignments WHERE organization_id=org AND id=assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='P0002';END IF;
 SELECT e.id INTO estimate_value FROM public.canonical_estimates e JOIN public.canonical_appointments a ON a.organization_id=e.organization_id AND a.operation_id=e.operation_id AND a.graph_id=e.graph_id WHERE a.organization_id=org AND a.id=schedule.appointment_id;
 IF estimate_value IS NULL THEN RETURN jsonb_build_object('notRecorded',TRUE,'digest','none');END IF;
 SELECT * INTO plan FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO ready FROM public.canonical_equipment_readiness_plans WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1;
 IF plan.id IS NULL THEN RETURN jsonb_build_object('notRecorded',TRUE,'digest','none');END IF;
 IF plan.action<>'save' THEN RETURN jsonb_build_object('sourceChanged',TRUE,'notRecorded',FALSE,'digest',public.canonical_completion_digest(jsonb_build_array(plan.id,plan.digest,ready.digest)));END IF;
 changed:=ready.id IS NULL OR ready.action<>'save' OR ready.inputs->'equipmentBasis' IS DISTINCT FROM jsonb_build_object('planId',plan.id,'revision',plan.revision,'digest',plan.digest);
 IF NOT changed THEN inputs_value:=ready.inputs;
 ELSE
 SELECT jsonb_build_object('equipmentBasis',jsonb_build_object('planId',plan.id,'revision',plan.revision,'digest',plan.digest),'replacement',NULL,'assessment',NULL,'lines',jsonb_agg(jsonb_build_object('lineId',l->>'lineId','required',TRUE,'notRequiredReason','','quantity',NULL,'start',NULL,'end',NULL,'timeZone',zone_value,'location','','source',jsonb_build_object('kind','my_observation','label','','reference','','observedAt',NULL,'validUntil',NULL,'quantity',NULL,'start',NULL,'end',NULL,'condition','unknown','restrictions','','location','','leadTime',NULL,'leadTimeUnit',NULL),'maintenance',jsonb_build_object('dueAt',NULL,'meterKey',NULL,'threshold',NULL,'unit',NULL,'reference',''),'alternatives','[]'::jsonb) ORDER BY ordinal)) INTO inputs_value FROM jsonb_array_elements(plan.inputs->'lines') WITH ORDINALITY a(l,ordinal);
 END IF;
 evidence:=public.canonical_equipment_readiness_evidence(org,estimate_value,NULL,lock_value);
 IF target_kind='profile' THEN target_profiles:=ARRAY[target_id];ELSIF target_kind='crew' THEN SELECT COALESCE(array_agg(profile_id ORDER BY profile_id),ARRAY[]::uuid[]) INTO target_profiles FROM public.workforce_crew_members WHERE organization_id=org AND crew_id=target_id;ELSE target_profiles:=ARRAY[]::uuid[];END IF;
 facts:='[]';FOR f IN SELECT value FROM jsonb_array_elements(evidence->'lines') LOOP
 f:=jsonb_set(f,'{targetMatches}',to_jsonb(COALESCE((f#>>'{state,operator}')::uuid=ANY(target_profiles),FALSE)));facts:=facts||jsonb_build_array(f);
 END LOOP;
 evidence:=jsonb_set(evidence,'{lines}',facts);evidence:=jsonb_set(evidence,'{digest}',to_jsonb(public.canonical_completion_digest(evidence-'digest')));
 at_value:=clock_timestamp();payload:=jsonb_build_object('notRecorded',FALSE,'sourceChanged',changed,'inputs',inputs_value,'evidence',evidence,'assessedAt',at_value,'readinessPin',jsonb_build_object('id',ready.id,'revision',ready.revision,'digest',ready.digest),'sourcePins',public.canonical_estimate_decision_source(org,estimate_value));
 RETURN payload||jsonb_build_object('digest',public.canonical_completion_digest(payload-'assessedAt'));
END $$;
CREATE FUNCTION public.canonical_equipment_readiness_schedule_result(basis JSONB,proposal JSONB,at_value TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE assessed JSONB;l JSONB;code_value TEXT;hard JSONB:='[]';review JSONB:='[]';
BEGIN
 IF basis->'notRecorded'='true'::jsonb THEN RETURN jsonb_build_object('hardConflicts',hard,'reviewReasons',review,'digest',basis->>'digest');END IF;
 IF basis->'sourceChanged'='true'::jsonb THEN review:=review||jsonb_build_array(jsonb_build_object('code','equipment_readiness_changed'));END IF;
 IF basis->'inputs' IS NOT NULL THEN
 assessed:=public.canonical_equipment_readiness_assess(basis->'inputs',basis->'evidence',at_value,proposal);
 FOR l IN SELECT value FROM jsonb_array_elements(assessed->'lines') LOOP
 FOR code_value IN SELECT value FROM jsonb_array_elements_text(l->'hard') LOOP hard:=hard||jsonb_build_array(jsonb_build_object('code','equipment_'||code_value,'lineId',l->>'lineId'));END LOOP;
 FOR code_value IN SELECT value FROM jsonb_array_elements_text(l->'review') LOOP review:=review||jsonb_build_array(jsonb_build_object('code','equipment_'||code_value,'lineId',l->>'lineId'));END LOOP;
 END LOOP;END IF;
 RETURN jsonb_build_object('hardConflicts',hard,'reviewReasons',review,'digest',basis->>'digest');
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_schedule_basis(uuid,uuid,text,uuid,timestamptz,timestamptz,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_schedule_result(jsonb,jsonb,timestamptz) FROM PUBLIC;

-- The existing trusted scheduling callers retain their signature and independent
-- actor/expiry/receipt checks. Cleanup remains possible despite adverse equipment.
ALTER FUNCTION public.canonical_schedule_part4_review_authority(uuid,uuid,text,uuid,timestamptz,timestamptz,text) RENAME TO canonical_equipment_readiness_schedule_legacy;
CREATE FUNCTION public.canonical_schedule_part4_review_authority(org UUID,assignment UUID,target_kind TEXT,target_id UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,zone_value TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior JSONB;basis JSONB;extra JSONB;hard JSONB;review JSONB;digest_value TEXT;recommendation TEXT;state_value TEXT;
BEGIN
 prior:=public.canonical_equipment_readiness_schedule_legacy(org,assignment,target_kind,target_id,start_value,end_value,zone_value);
 IF target_kind='unassigned' AND EXISTS(SELECT 1 FROM public.canonical_schedule_assignments s WHERE s.organization_id=org AND s.id=assignment AND s.target_state='assigned' AND s.schedule_state=CASE WHEN start_value IS NULL THEN 'unscheduled' ELSE 'scheduled' END AND s.scheduled_start IS NOT DISTINCT FROM start_value AND s.scheduled_end IS NOT DISTINCT FROM end_value) THEN RETURN prior;END IF;
 basis:=public.canonical_equipment_readiness_schedule_basis(org,assignment,target_kind,target_id,start_value,end_value,zone_value,TRUE);
 IF basis->'notRecorded'='true'::jsonb THEN RETURN prior;END IF;
 extra:=public.canonical_equipment_readiness_schedule_result(basis,jsonb_build_object('scheduledStart',start_value,'scheduledEnd',end_value),clock_timestamp());
 hard:=public.canonical_schedule_part4_stable_entries((prior->'hardConflicts')||(extra->'hardConflicts'));review:=public.canonical_schedule_part4_stable_entries((prior->'reviewReasons')||(extra->'reviewReasons'));
 IF jsonb_array_length(hard)>256 OR jsonb_array_length(review)>256 THEN RAISE EXCEPTION 'Equipment scheduling evidence exceeds review limits' USING ERRCODE='54000';END IF;
 digest_value:=encode(sha256(convert_to(public.canonical_schedule_part4_stable_json(jsonb_build_object('prior',prior->>'conflictDigest','equipment',basis->>'digest','hardConflicts',hard,'reviewReasons',review)),'UTF8')),'hex');
 recommendation:=encode(sha256(convert_to(public.canonical_schedule_part4_stable_json(jsonb_build_object('authorityDigest',digest_value,'mutationGrant',FALSE,'providerCallsAllowed',0,'routeEvidence','unavailable_without_separately_authorized_current_durable_evidence')),'UTF8')),'hex');
 state_value:=CASE WHEN jsonb_array_length(hard)>0 THEN 'hard_conflict' WHEN jsonb_array_length(review)>0 THEN 'needs_review' WHEN jsonb_array_length(prior->'warnings')>0 THEN 'warning' ELSE 'clear' END;
 RETURN prior||jsonb_build_object('status',state_value,'hardConflicts',hard,'reviewReasons',review,'needsReview',jsonb_array_length(review)>0,'reviewReasonDigests',public.canonical_schedule_part4_entry_digests(review),'conflictDigest',digest_value,'recommendationDigest',recommendation,'recommendationAuthorityDigest',digest_value);
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_schedule_legacy(uuid,uuid,text,uuid,timestamptz,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_schedule_part4_review_authority(uuid,uuid,text,uuid,timestamptz,timestamptz,text) FROM PUBLIC;
-- Read-only entry for the shared JS evaluator. No fence counter writes here.
CREATE FUNCTION public.canonical_equipment_readiness_schedule_read(org UUID,actor UUID,role_value TEXT,session_value UUID,appointment UUID,target_kind TEXT,target_id UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,zone_value TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;assignment UUID;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN RAISE EXCEPTION 'Equipment scheduling snapshot required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF NOT (role_value IN ('owner','admin') OR role_value='member' AND authority->>'operationalRole'='dispatcher') THEN RAISE EXCEPTION 'Current scheduling operator required' USING ERRCODE='42501';END IF;
 SELECT s.id INTO assignment FROM public.canonical_schedule_assignments s JOIN public.canonical_appointments a ON a.organization_id=s.organization_id AND a.id=s.appointment_id WHERE s.organization_id=org AND s.appointment_id=appointment AND EXISTS(SELECT 1 FROM public.canonical_transcripts t WHERE t.organization_id=a.organization_id AND t.operation_id=a.operation_id AND t.graph_id=a.graph_id AND public.canonical_labor_transcript_source_normalized(t.source) IN ('lead','retell','voice'));
 IF assignment IS NULL THEN RAISE EXCEPTION 'Appointment unavailable' USING ERRCODE='P0002';END IF;
 IF target_kind='unassigned' AND EXISTS(SELECT 1 FROM public.canonical_schedule_assignments s WHERE s.organization_id=org AND s.id=assignment AND s.target_state='assigned' AND s.schedule_state=CASE WHEN start_value IS NULL THEN 'unscheduled' ELSE 'scheduled' END AND s.scheduled_start IS NOT DISTINCT FROM start_value AND s.scheduled_end IS NOT DISTINCT FROM end_value) THEN RETURN jsonb_build_object('notRecorded',TRUE,'digest','none');END IF;
 RETURN public.canonical_equipment_readiness_schedule_basis(org,assignment,target_kind,target_id,start_value,end_value,zone_value,FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_equipment_readiness_schedule_read(uuid,uuid,text,uuid,uuid,text,uuid,timestamptz,timestamptz,text) FROM PUBLIC;

-- Exact 035 preview successor: recheck current actor after equipment fence waits.
CREATE OR REPLACE FUNCTION public.canonical_schedule_create_mutation_preview(
  organization_id_value UUID,appointment_id_value UUID,actor_user_id_value UUID,
  actor_access_role_value TEXT,auth_session_id_value UUID,csrf_token_value TEXT,
  expected_revision_value BIGINT,expected_digest_value TEXT,expected_time_zone_value TEXT,
  action_code_value TEXT,target_kind_value TEXT,target_id_value UUID,
  scheduled_start_value TIMESTAMPTZ,scheduled_end_value TIMESTAMPTZ,submitted_schedule_value JSONB,
  appointment_status_value TEXT,reason_value TEXT,conflict_evaluation_value JSONB,
  conflict_digest_value TEXT,warning_digests_value JSONB,review_reason_digests_value JSONB,
  recommendation_digest_value TEXT,recommendation_authority_digest_value TEXT,request_digest_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  time_authority JSONB;
  current_target_kind TEXT;
  current_target_id UUID;
  proposed_schedule_state TEXT;
  proposed_dispatch_state TEXT;
  preview_id_value UUID := gen_random_uuid();
  created_at_value TIMESTAMPTZ;
  expires_at_value TIMESTAMPTZ;
  preview_digest_value TEXT;
  trusted_request_digest_value TEXT;
  trusted_hard_conflicts_value JSONB;
  trusted_review_authority_value JSONB;
  trusted_conflict_evaluation_value JSONB;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=organization_id_value FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical schedule organization is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_actor_unauthorized';
  END IF;
  time_authority := public.canonical_schedule_part4_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,
    csrf_token_value,expected_time_zone_value
  );
  SELECT assignment.* INTO assignment_record
    FROM public.canonical_schedule_assignments assignment
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=assignment.organization_id AND appointment.id=assignment.appointment_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=appointment.organization_id AND transcript.operation_id=appointment.operation_id
   WHERE assignment.organization_id=organization_id_value AND assignment.appointment_id=appointment_id_value
     AND transcript.source NOT IN ('simulation','demo')
   FOR SHARE OF assignment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical appointment is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_schedule_part4_scope_unavailable';
  END IF;
  IF assignment_record.revision<>expected_revision_value
     OR rtrim(assignment_record.canonical_digest)<>expected_digest_value THEN
    RAISE EXCEPTION 'Canonical schedule preview is stale'
      USING ERRCODE='40001',CONSTRAINT='canonical_schedule_part4_preview_stale';
  END IF;
  IF assignment_record.appointment_status<>appointment_status_value THEN
    RAISE EXCEPTION 'Appointment compatibility status changed'
      USING ERRCODE='40001',CONSTRAINT='canonical_schedule_part4_preview_stale';
  END IF;
  IF action_code_value NOT IN ('assign','reassign','unassign','schedule','reschedule','dispatch')
     OR appointment_status_value NOT IN ('preferred','scheduled','cancelled','completed')
     OR NOT public.canonical_schedule_part4_reason_valid(reason_value)
     OR NOT public.canonical_schedule_part4_schedule_contract_valid(
       scheduled_start_value,scheduled_end_value,submitted_schedule_value,expected_time_zone_value
     ) THEN
    RAISE EXCEPTION 'Mutation preview violates the canonical public contract'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  IF scheduled_start_value IS NULL THEN
    proposed_schedule_state := 'unscheduled';
  ELSE
    proposed_schedule_state := 'scheduled';
  END IF;
  trusted_request_digest_value := public.canonical_schedule_part4_preview_request_digest(
    organization_id_value,appointment_id_value,actor_user_id_value,auth_session_id_value,
    expected_revision_value,expected_digest_value,expected_time_zone_value,action_code_value,
    target_kind_value,target_id_value,scheduled_start_value,scheduled_end_value,
    submitted_schedule_value,appointment_status_value,reason_value
  );
  IF request_digest_value<>trusted_request_digest_value THEN
    RAISE EXCEPTION 'Mutation preview request digest diverges from canonical inputs'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_request_digest_divergent';
  END IF;
  request_digest_value := trusted_request_digest_value;
  current_target_kind := CASE WHEN assignment_record.target_state='unassigned' THEN 'unassigned'
    WHEN assignment_record.workforce_profile_id IS NOT NULL THEN 'profile' ELSE 'crew' END;
  current_target_id := COALESCE(assignment_record.workforce_profile_id,assignment_record.workforce_crew_id);
  IF NOT public.canonical_schedule_part4_target_current(organization_id_value,target_kind_value,target_id_value) THEN
    RAISE EXCEPTION 'Proposed assignment target is inactive or unavailable'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  IF action_code_value='assign' THEN
    IF current_target_kind<>'unassigned' OR target_kind_value NOT IN ('profile','crew')
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Assign transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='reassign' THEN
    IF current_target_kind='unassigned' OR target_kind_value NOT IN ('profile','crew')
       OR (target_kind_value=current_target_kind AND target_id_value=current_target_id)
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Reassign transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='unassign' THEN
    IF current_target_kind='unassigned' OR target_kind_value<>'unassigned'
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Unassign transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='schedule' THEN
    IF assignment_record.schedule_state<>'unscheduled' OR proposed_schedule_state<>'scheduled'
       OR target_kind_value<>current_target_kind OR target_id_value IS DISTINCT FROM current_target_id THEN
      RAISE EXCEPTION 'Schedule transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='reschedule' THEN
    IF assignment_record.schedule_state<>'scheduled' OR proposed_schedule_state<>'scheduled'
       OR target_kind_value<>current_target_kind OR target_id_value IS DISTINCT FROM current_target_id
       OR (scheduled_start_value IS NOT DISTINCT FROM assignment_record.scheduled_start
         AND scheduled_end_value IS NOT DISTINCT FROM assignment_record.scheduled_end) THEN
      RAISE EXCEPTION 'Reschedule transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSIF action_code_value='dispatch' THEN
    IF current_target_kind='unassigned' OR assignment_record.schedule_state<>'scheduled'
       OR assignment_record.dispatch_state='dispatched' OR assignment_record.appointment_status IN ('cancelled','completed')
       OR target_kind_value<>current_target_kind OR target_id_value IS DISTINCT FROM current_target_id
       OR proposed_schedule_state<>assignment_record.schedule_state
       OR scheduled_start_value IS DISTINCT FROM assignment_record.scheduled_start
       OR scheduled_end_value IS DISTINCT FROM assignment_record.scheduled_end THEN
      RAISE EXCEPTION 'Dispatch transition is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'Approval action is invalid' USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_transition_invalid';
  END IF;
  proposed_dispatch_state := CASE WHEN action_code_value='dispatch' THEN 'dispatched'
    WHEN assignment_record.dispatch_state='dispatched' AND action_code_value IN ('reassign','unassign','reschedule') THEN 'revoked'
    ELSE assignment_record.dispatch_state END;
  trusted_review_authority_value := public.canonical_schedule_part4_review_authority(
    organization_id_value,assignment_record.id,target_kind_value,target_id_value,
    scheduled_start_value,scheduled_end_value,expected_time_zone_value
  );
  trusted_hard_conflicts_value := trusted_review_authority_value->'hardConflicts';
  IF jsonb_typeof(conflict_evaluation_value)<>'object'
     OR conflict_evaluation_value->>'assignmentId'<>assignment_record.id::TEXT
     OR conflict_evaluation_value->>'assignmentRevision'<>assignment_record.revision::TEXT
     OR conflict_evaluation_value->>'assignmentDigest'<>rtrim(assignment_record.canonical_digest)
     OR conflict_evaluation_value->>'appointmentId'<>appointment_id_value::TEXT THEN
    RAISE EXCEPTION 'Conflict preview evidence diverges'
      USING ERRCODE='23514',CONSTRAINT='canonical_schedule_part4_evidence_stale';
  END IF;
  -- Preview lifetime starts only after all current authority/conflict rows have
  -- been locked and validated; it is exactly fifteen database-clock minutes.
  created_at_value := clock_timestamp();
  expires_at_value := created_at_value+INTERVAL '15 minutes';
  conflict_digest_value := trusted_review_authority_value->>'conflictDigest';
  warning_digests_value := trusted_review_authority_value->'warningDigests';
  review_reason_digests_value := trusted_review_authority_value->'reviewReasonDigests';
  recommendation_digest_value := trusted_review_authority_value->>'recommendationDigest';
  recommendation_authority_digest_value := trusted_review_authority_value->>'recommendationAuthorityDigest';
  trusted_conflict_evaluation_value := jsonb_build_object(
    'id',conflict_digest_value,'assignmentId',assignment_record.id,
    'appointmentId',appointment_id_value,'evaluationVersion','m22-conflict-v1',
    'assignmentRevision',assignment_record.revision,
    'assignmentDigest',rtrim(assignment_record.canonical_digest),
    'proposal',jsonb_build_object(
      'target',jsonb_build_object('kind',target_kind_value,'id',target_id_value),
      'scheduledStart',scheduled_start_value,'scheduledEnd',scheduled_end_value,
      'submittedScheduledStart',submitted_schedule_value->'scheduledStart',
      'submittedScheduledEnd',submitted_schedule_value->'scheduledEnd',
      'timeZone',expected_time_zone_value,'appointmentStatus',appointment_status_value),
    'status',trusted_review_authority_value->>'status',
    'hardConflicts',trusted_hard_conflicts_value,
    'warnings',trusted_review_authority_value->'warnings',
    'needsReview',(trusted_review_authority_value->>'needsReview')::BOOLEAN,
    'reviewReasons',trusted_review_authority_value->'reviewReasons',
    'digest',conflict_digest_value,'evaluatedAt',created_at_value,
    'persisted',FALSE,'grantsMutation',FALSE
  );
  conflict_evaluation_value := trusted_conflict_evaluation_value;
  preview_digest_value := public.canonical_schedule_part4_preview_digest(
    preview_id_value,organization_id_value,assignment_record.id,appointment_id_value,actor_user_id_value,
    auth_session_id_value,expected_revision_value,expected_digest_value,expected_time_zone_value,
    action_code_value,target_kind_value,target_id_value,scheduled_start_value,scheduled_end_value,
    proposed_schedule_state,proposed_dispatch_state,appointment_status_value,reason_value,
    conflict_digest_value,warning_digests_value,review_reason_digests_value,recommendation_digest_value,
    recommendation_authority_digest_value,request_digest_value,created_at_value,expires_at_value
  );
  PERFORM public.canonical_schedule_part4_actor_authority(organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,csrf_token_value,expected_time_zone_value);
  INSERT INTO public.canonical_schedule_mutation_previews(
    id,organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,auth_session_id,
    expected_revision,expected_digest,expected_time_zone,action_code,proposed_target_kind,proposed_target_id,
    proposed_scheduled_start,proposed_scheduled_end,proposed_schedule_state,proposed_dispatch_state,
    proposed_appointment_status,submitted_schedule,reason,conflict_evaluation,conflict_digest,
    warning_digests,review_reason_digests,recommendation_digest,recommendation_authority_digest,
    request_digest,preview_digest,created_at,expires_at,transaction_id
  ) VALUES (
    preview_id_value,organization_id_value,assignment_record.id,appointment_id_value,actor_user_id_value,
    actor_access_role_value,auth_session_id_value,expected_revision_value,expected_digest_value,
    expected_time_zone_value,action_code_value,target_kind_value,target_id_value,scheduled_start_value,
    scheduled_end_value,proposed_schedule_state,proposed_dispatch_state,appointment_status_value,
    submitted_schedule_value,reason_value,conflict_evaluation_value,conflict_digest_value,
    warning_digests_value,review_reason_digests_value,recommendation_digest_value,
    recommendation_authority_digest_value,request_digest_value,preview_digest_value,created_at_value,
    expires_at_value,txid_current()
  );
  RETURN jsonb_build_object('success',TRUE,'data',jsonb_build_object(
    'id',preview_id_value,'appointmentId',appointment_id_value,'assignmentId',assignment_record.id,
    'action',action_code_value,'proposal',jsonb_build_object(
      'target',jsonb_build_object('kind',target_kind_value,'id',target_id_value),
      'scheduledStart',scheduled_start_value,'scheduledEnd',scheduled_end_value,
      'scheduleState',proposed_schedule_state,'dispatchState',proposed_dispatch_state,
      'appointmentStatus',appointment_status_value,'timeZone',expected_time_zone_value
    ),
    'conflicts',conflict_evaluation_value,'warningDigests',warning_digests_value,
    'reviewReasonDigests',review_reason_digests_value,'recommendationDigest',recommendation_digest_value,
    'recommendationAuthorityDigest',recommendation_authority_digest_value,
    'previewDigest',preview_digest_value,'createdAt',created_at_value,'expiresAt',expires_at_value,
    'expiresInSeconds',900,'grantsMutation',FALSE,'persisted',TRUE
  ));
END
$function$;
