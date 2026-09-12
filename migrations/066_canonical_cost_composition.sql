-- Mission24 Part3 Slice2. Existing event values and legacy projection remain unchanged.
ALTER TABLE public.canonical_estimate_revisions ADD COLUMN labor_plan_id UUID, ADD COLUMN changed_component TEXT, ADD COLUMN component_manifest JSONB;
ALTER TABLE public.canonical_estimate_revisions ALTER COLUMN material_plan_id DROP NOT NULL;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revision_labor_fk FOREIGN KEY(organization_id,estimate_id,labor_plan_id) REFERENCES public.canonical_labor_plans(organization_id,estimate_id,id);
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revisions_calculation_version_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revisions_calculation_version_check CHECK(calculation_version IN ('estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4','estimate-cost-adoption-v1'));
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revision_components_check CHECK(CASE WHEN calculation_version='estimate-cost-adoption-v1' THEN changed_component IN ('material','labor') AND changed_component IS NOT NULL AND component_manifest IS NOT NULL AND jsonb_typeof(component_manifest)='object' AND (CASE WHEN changed_component='material' THEN material_plan_id IS NOT NULL ELSE labor_plan_id IS NOT NULL END) ELSE material_plan_id IS NOT NULL AND labor_plan_id IS NULL AND changed_component IS NULL AND component_manifest IS NULL END);
DO $block$ DECLARE n TEXT;BEGIN SELECT c.conname INTO STRICT n FROM pg_constraint c WHERE c.conrelid='public.canonical_estimate_revisions'::regclass AND c.contype='u' AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='organization_id'),(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='estimate_id'),(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='material_plan_id')]::smallint[];EXECUTE format('ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT %I',n);END $block$;
CREATE UNIQUE INDEX canonical_revision_legacy_material_once ON public.canonical_estimate_revisions(organization_id,estimate_id,material_plan_id) WHERE calculation_version<>'estimate-cost-adoption-v1';
CREATE UNIQUE INDEX canonical_revision_component_once ON public.canonical_estimate_revisions(organization_id,estimate_id,COALESCE(previous_id,estimate_id),changed_component,(CASE WHEN changed_component='material' THEN material_plan_id ELSE labor_plan_id END)) WHERE calculation_version='estimate-cost-adoption-v1';
CREATE FUNCTION public.canonical_estimate_revision_plan_reference(p JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN p IS NULL OR p='null'::jsonb THEN jsonb_build_object('kind','original') ELSE jsonb_build_object('kind','plan','id',p->'id','revision',p->'revision','digest',p->'digest','calculationVersion',p->'calculationVersion','sourcePins',p->'sourcePins') END $$;
ALTER FUNCTION public.canonical_estimate_revision_projection(public.canonical_estimate_revisions) RENAME TO canonical_estimate_revision_projection_legacy;
CREATE FUNCTION public.canonical_estimate_revision_projection(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN d.calculation_version='estimate-cost-adoption-v1' THEN public.canonical_estimate_revision_projection_legacy(d)||jsonb_build_object('changedComponent',d.changed_component,'componentManifest',d.component_manifest,'laborPlanId',d.labor_plan_id,'laborPlan',(SELECT public.canonical_labor_plan_projection(l) FROM public.canonical_labor_plans l WHERE l.organization_id=d.organization_id AND l.estimate_id=d.estimate_id AND l.id=d.labor_plan_id)) ELSE public.canonical_estimate_revision_projection_legacy(d) END $$;
CREATE FUNCTION public.canonical_estimate_revision_components(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN d.calculation_version='estimate-cost-adoption-v1' THEN d.component_manifest ELSE jsonb_build_object('material',public.canonical_estimate_revision_plan_reference((SELECT public.canonical_material_plan_projection(m) FROM public.canonical_material_plans m WHERE m.organization_id=d.organization_id AND m.estimate_id=d.estimate_id AND m.id=d.material_plan_id)),'labor',jsonb_build_object('kind','original')) END $$;
CREATE FUNCTION public.canonical_estimate_revision_cost_assessment(m JSONB,l JSONB,service_key TEXT,day_value DATE) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RETURN jsonb_build_object('date',day_value::text,'laborSource',CASE WHEN l IS NOT NULL THEN public.canonical_labor_plan_assess(l->'inputs',day_value) ELSE NULL END,'materialSource',CASE WHEN m->>'calculationVersion' IN ('estimate-material-plan-v3','estimate-material-plan-v4') THEN public.canonical_material_source_assess(CASE WHEN m->>'calculationVersion'='estimate-material-plan-v4' THEN public.canonical_material_availability_cost_inputs(m->'inputs') ELSE m->'inputs' END,m->>'currency',service_key,day_value) ELSE NULL END,'materialAvailability',CASE WHEN m->>'calculationVersion'='estimate-material-plan-v4' THEN public.canonical_material_availability_assess(m->'inputs',m->>'currency',service_key,day_value) ELSE NULL END);END $$;
CREATE OR REPLACE FUNCTION public.canonical_estimate_revision_mutate_v063(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; original JSONB; old public.canonical_estimate_revisions%ROWTYPE;
 current_row public.canonical_estimate_revisions%ROWTYPE; inserted public.canonical_estimate_revisions%ROWTYPE;
 plan public.canonical_material_plans%ROWTYPE; decision_row public.canonical_estimate_decisions%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; fingerprint TEXT;
BEGIN
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
 public.canonical_field_evidence_object_keys_exact(body,ARRAY['sourcePins','expectedPlanId','expectedPlanRevision','expectedPlanDigest','expectedDecisionRevision','expectedDecisionDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
 body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR (body->>'confirmationVersion' IS NULL OR body->>'confirmationVersion' NOT IN ('estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4')) OR
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
 IF current_row.calculation_version='estimate-cost-adoption-v1' THEN RAISE EXCEPTION 'Current cost review required' USING ERRCODE='40001'; END IF;
 SELECT * INTO plan FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF body->'sourcePins' IS DISTINCT FROM source_value OR plan.id IS NULL OR plan.action<>'save' OR plan.source_pins IS DISTINCT FROM source_value OR
 body->>'expectedPlanId' IS DISTINCT FROM plan.id::text OR (body->>'expectedPlanRevision')::bigint<>plan.revision OR body->>'expectedPlanDigest' IS DISTINCT FROM plan.digest OR
 plan.currency IS DISTINCT FROM current_currency OR (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN
 RAISE EXCEPTION 'Estimate or material plan changed' USING ERRCODE='40001'; END IF;
 IF plan.calculation_version='estimate-material-plan-v4' AND body->>'confirmationVersion'='estimate-material-adoption-v4' THEN PERFORM public.canonical_material_availability_assess(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date);
 ELSIF plan.calculation_version='estimate-material-plan-v3' AND body->>'confirmationVersion' IN ('estimate-material-adoption-v3','estimate-material-adoption-v4') THEN PERFORM public.canonical_material_source_assess(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date);
 ELSIF plan.calculation_version='estimate-material-plan-v2' AND body->>'confirmationVersion' IN ('estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4') THEN PERFORM public.canonical_material_plan_validate_v2(plan.inputs);
 ELSIF plan.calculation_version='estimate-material-plan-v1' THEN PERFORM public.canonical_material_plan_validate(plan.inputs);
 ELSE RAISE EXCEPTION 'Material calculation version unavailable' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,1)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Estimate revision limit' USING ERRCODE='54000'; END IF;
 fingerprint:=public.canonical_completion_digest(jsonb_build_object('original',original,'parent',source_value,'materialPlan',public.canonical_material_plan_projection(plan),'calculationVersion',body->>'confirmationVersion'));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 IF plan.calculation_version='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE); END IF;
 IF plan.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE); END IF;
 INSERT INTO public.canonical_estimate_revisions(organization_id,estimate_id,revision,previous_id,material_plan_id,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,original_source_pins,expected_decision_revision,expected_decision_digest,calculation_version,input_fingerprint,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,plan.id,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,original,COALESCE(decision_row.revision,0),COALESCE(decision_row.digest,'none'),body->>'confirmationVersion',fingerprint,btrim(body->>'reason'),body->>'confirmationVersion',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'inputFingerprint',fingerprint,'body',body))) RETURNING * INTO inserted;
 IF plan.calculation_version='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE); END IF;
 IF plan.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE); END IF;
 RETURN jsonb_build_object('receipt',public.canonical_estimate_revision_projection(inserted),'replayed',FALSE);
END $$;
CREATE OR REPLACE FUNCTION public.canonical_estimate_revision_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; original JSONB; old public.canonical_estimate_revisions%ROWTYPE;
 current_row public.canonical_estimate_revisions%ROWTYPE; inserted public.canonical_estimate_revisions%ROWTYPE;
 plan JSONB; mp public.canonical_material_plans%ROWTYPE; lp public.canonical_labor_plans%ROWTYPE; material_value JSONB; labor_value JSONB; component_value JSONB; service_key TEXT; assessment_value JSONB; decision_row public.canonical_estimate_decisions%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; fingerprint TEXT;
BEGIN
 IF body->>'confirmationVersion' IS DISTINCT FROM 'estimate-cost-adoption-v1' THEN RETURN public.canonical_estimate_revision_mutate_v063(org,actor,role_value,session_value,estimate,csrf,key_value,body);END IF;
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
 body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR (body->>'changedComponent' IS NULL OR body->>'changedComponent' NOT IN ('material','labor')) OR
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
 IF body->>'changedComponent'='material' THEN SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_material_plan_projection(mp);SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.labor_plan_id;
 ELSE SELECT * INTO lp FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;plan:=public.canonical_labor_plan_projection(lp);SELECT * INTO mp FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate AND id=current_row.material_plan_id;END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF body->'sourcePins' IS DISTINCT FROM source_value OR plan->>'id' IS NULL OR plan->>'action'<>'save' OR plan->'sourcePins' IS DISTINCT FROM source_value OR body->>'expectedPlanId' IS DISTINCT FROM plan->>'id' OR body->>'expectedPlanRevision' IS DISTINCT FROM plan->>'revision' OR body->>'expectedPlanDigest' IS DISTINCT FROM plan->>'digest' OR plan->>'currency' IS DISTINCT FROM current_currency OR (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') OR body->'expectedComponents' IS DISTINCT FROM public.canonical_estimate_revision_components(current_row) THEN RAISE EXCEPTION 'Estimate or plan changed' USING ERRCODE='40001';END IF;
 IF (public.canonical_estimate_revision_components(current_row)->(body->>'changedComponent')->>'id')=plan->>'id' THEN RAISE EXCEPTION 'Plan already included' USING ERRCODE='40001';END IF;
 material_value:=CASE WHEN mp.id IS NOT NULL THEN public.canonical_material_plan_projection(mp) ELSE NULL END;labor_value:=CASE WHEN lp.id IS NOT NULL THEN public.canonical_labor_plan_projection(lp) ELSE NULL END;
 component_value:=jsonb_build_object('material',public.canonical_estimate_revision_plan_reference(material_value),'labor',public.canonical_estimate_revision_plan_reference(labor_value));
 IF body->>'changedComponent'='labor' THEN PERFORM public.canonical_labor_plan_validate(lp.inputs);IF EXISTS(SELECT 1 FROM jsonb_array_elements(lp.inputs->'lines') l WHERE l->'hourlyCost'='null'::jsonb OR (l->>'rateMode'='base_burden' AND l->'burdenPercent'='null'::jsonb)) THEN RAISE EXCEPTION 'Complete labor costs required' USING ERRCODE='22023';END IF;IF lp.inputs->>'serviceKey' IS DISTINCT FROM service_key THEN RAISE EXCEPTION 'Labor service changed' USING ERRCODE='40001';END IF;END IF;
 assessment_value:=public.canonical_estimate_revision_cost_assessment(material_value,labor_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date);
 IF body->'assessment' IS DISTINCT FROM assessment_value THEN RAISE EXCEPTION 'Source review changed' USING ERRCODE='40001';END IF;
 next_revision:=COALESCE(current_row.revision,1)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Estimate revision limit' USING ERRCODE='54000'; END IF;
 fingerprint:=public.canonical_completion_digest(jsonb_build_object('original',original,'parent',source_value,'components',component_value,'calculationVersion','estimate-cost-adoption-v1'));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 IF body->>'changedComponent'='material' THEN
 IF mp.calculation_version='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(mp.inputs,current_currency,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
 ELSIF mp.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(mp.inputs,current_currency,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE);
 ELSIF mp.calculation_version='estimate-material-plan-v2' THEN PERFORM public.canonical_material_plan_validate_v2(mp.inputs);ELSE PERFORM public.canonical_material_plan_validate(mp.inputs);END IF;END IF;
 INSERT INTO public.canonical_estimate_revisions(organization_id,estimate_id,revision,previous_id,material_plan_id,labor_plan_id,changed_component,component_manifest,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,original_source_pins,expected_decision_revision,expected_decision_digest,calculation_version,input_fingerprint,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,mp.id,lp.id,body->>'changedComponent',component_value,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,original,COALESCE(decision_row.revision,0),COALESCE(decision_row.digest,'none'),body->>'confirmationVersion',fingerprint,btrim(body->>'reason'),body->>'confirmationVersion',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'inputFingerprint',fingerprint,'body',body))) RETURNING * INTO inserted;
 IF body->'assessment' IS DISTINCT FROM public.canonical_estimate_revision_cost_assessment(material_value,labor_value,service_key,(clock_timestamp() AT TIME ZONE 'UTC')::date) THEN RAISE EXCEPTION 'Source review changed' USING ERRCODE='40001';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('receipt',public.canonical_estimate_revision_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_plan_reference(jsonb),public.canonical_estimate_revision_projection_legacy(public.canonical_estimate_revisions),public.canonical_estimate_revision_components(public.canonical_estimate_revisions),public.canonical_estimate_revision_cost_assessment(jsonb,jsonb,text,date),public.canonical_estimate_revision_mutate_v063(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
