CREATE FUNCTION public.canonical_equipment_plan_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;q JSONB;k TEXT;ids TEXT[]:=ARRAY[]::TEXT[];rids TEXT[]:=ARRAY[]::TEXT[];
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['serviceKey','lines','assessment']) IS NOT TRUE OR public.canonical_labor_plan_text(v->'serviceKey',160,FALSE) IS NOT TRUE OR jsonb_typeof(v->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'lines') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Equipment plan invalid' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','task','assetId','identity','accessBasis','requirements','knowledgePins','ownerReview']) IS NOT TRUE OR (l->>'lineId') IS NULL OR (l->>'lineId')!~'^[0-9a-fA-F-]{36}$' OR (l->>'lineId')=ANY(ids) OR public.canonical_labor_plan_text(l->'task',160,FALSE) IS NOT TRUE OR (l->'assetId'<>'null'::jsonb AND (l->>'assetId')!~'^[0-9a-fA-F-]{36}$') OR l->>'accessBasis' IS NULL OR l->>'accessBasis' NOT IN ('unknown','owned','rented','financed') OR public.canonical_labor_plan_text(l->'ownerReview',1000,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Equipment line invalid' USING ERRCODE='22023';END IF;
  PERFORM (l->>'lineId')::uuid;IF l->>'assetId' IS NOT NULL THEN PERFORM (l->>'assetId')::uuid;END IF;ids:=array_append(ids,l->>'lineId');
  IF public.canonical_field_evidence_object_keys_exact(l->'identity',ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments']) IS NOT TRUE THEN RAISE EXCEPTION 'Identity invalid' USING ERRCODE='22023';END IF;
  FOREACH k IN ARRAY ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments'] LOOP IF l->'identity'->k<>'null'::jsonb AND public.canonical_labor_plan_text(l->'identity'->k,200,FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'Identity invalid' USING ERRCODE='22023';END IF;END LOOP;
  IF jsonb_typeof(l->'requirements') IS DISTINCT FROM 'array' OR jsonb_array_length(l->'requirements')>12 OR jsonb_typeof(l->'knowledgePins') IS DISTINCT FROM 'array' OR jsonb_array_length(l->'knowledgePins')>12 THEN RAISE EXCEPTION 'Requirements invalid' USING ERRCODE='22023';END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(l->'knowledgePins') LOOP IF jsonb_typeof(q)<>'string' THEN RAISE EXCEPTION 'Knowledge pin invalid' USING ERRCODE='22023';END IF;PERFORM (q#>>'{}')::uuid;END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(l->'knowledgePins'))<>jsonb_array_length(l->'knowledgePins') THEN RAISE EXCEPTION 'Repeated source' USING ERRCODE='22023';END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(l->'requirements') LOOP
   IF public.canonical_field_evidence_object_keys_exact(q,ARRAY['requirementId','label','kind','operator','value','unit','origin','scopeKey','specificationIndex']) IS NOT TRUE OR (q->>'requirementId') IS NULL OR (q->>'requirementId')=ANY(rids) OR public.canonical_labor_plan_text(q->'label',120,FALSE) IS NOT TRUE OR q->>'kind' IS NULL OR q->>'kind' NOT IN ('numeric','categorical') OR q->>'operator' IS NULL OR q->>'operator' NOT IN ('at_least','at_most','equals') OR q->>'origin' IS NULL OR q->>'origin' NOT IN ('recorded_job','caller_assertion','owner_entry') OR public.canonical_labor_plan_text(q->'unit',80,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Requirement invalid' USING ERRCODE='22023';END IF;
   PERFORM (q->>'requirementId')::uuid;rids:=array_append(rids,q->>'requirementId');IF cardinality(rids)>12 THEN RAISE EXCEPTION 'Equipment plan requirement limit exceeded' USING ERRCODE='22023';END IF;IF q->'value'<>'null'::jsonb AND public.canonical_labor_plan_text(q->'value',240,FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'Requirement value invalid' USING ERRCODE='22023';END IF;
   IF q->>'kind'='numeric' AND q->'value'<>'null'::jsonb AND q->>'value'!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'Numeric requirement invalid' USING ERRCODE='22023';END IF;
   IF q->>'kind'='categorical' AND q->>'operator'<>'equals' OR q->>'origin'<>'recorded_job' AND q->'scopeKey'<>'null'::jsonb THEN RAISE EXCEPTION 'Requirement method invalid' USING ERRCODE='22023';END IF;
   IF q->'scopeKey'<>'null'::jsonb AND public.canonical_labor_plan_text(q->'scopeKey',120,FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'Job field invalid' USING ERRCODE='22023';END IF;
   IF q->'specificationIndex'<>'null'::jsonb AND (jsonb_typeof(q->'specificationIndex')<>'number' OR q->>'specificationIndex'!~'^(0|[1-9][0-9]?)$' OR (q->>'specificationIndex')::integer>47) THEN RAISE EXCEPTION 'Specification invalid' USING ERRCODE='22023';END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION public.canonical_equipment_plan_sources(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,inputs_value JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE catalog JSONB;assets JSONB;refs JSONB;knowledge JSONB;scope_value JSONB;service_key TEXT;payload JSONB;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') OR role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Protected equipment review required' USING ERRCODE='42501';END IF;
 PERFORM public.equipment_actor(org,actor,role_value,session_value,NULL,FALSE,TRUE);
 SELECT snapshot->'service'->'scope',snapshot->'service'->>'key' INTO scope_value,service_key FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 IF inputs_value IS NOT NULL THEN PERFORM public.canonical_equipment_plan_validate(inputs_value);IF inputs_value->>'serviceKey' IS DISTINCT FROM service_key THEN RAISE EXCEPTION 'Service changed' USING ERRCODE='40001';END IF;END IF;
 catalog:=public.equipment_read(org,actor,role_value,session_value,NULL,NULL);
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

-- Mission24 Part4 Slice1. Additive equipment review; no cost adoption or operating authority.
CREATE TABLE public.canonical_equipment_plans (
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
 calculation_version TEXT NOT NULL DEFAULT 'estimate-equipment-plan-v1' CHECK(calculation_version='estimate-equipment-plan-v1'),
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-equipment-plan-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_equipment_plans(organization_id,estimate_id,id),
 CHECK((action='save' AND inputs IS NOT NULL) OR (action='withdraw' AND inputs IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_equipment_plan_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_equipment_plan_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_equipment_plans FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_equipment_plan_immutable();

CREATE FUNCTION public.canonical_equipment_plan_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_decision_source(org,estimate) $$;
CREATE FUNCTION public.canonical_equipment_plan_projection(d public.canonical_equipment_plans) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'inputs',d.inputs,'evidence',d.evidence,'calculationVersion',d.calculation_version,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_equipment_plan_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_equipment_plan_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_equipment_plan_projection(d) INTO current_value FROM public.canonical_equipment_plans d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_equipment_plan_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
CREATE FUNCTION public.canonical_equipment_plan_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; evidence_value JSONB; old public.canonical_equipment_plans%ROWTYPE; current_row public.canonical_equipment_plans%ROWTYPE;
 inserted public.canonical_equipment_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; decision_row public.canonical_estimate_decisions%ROWTYPE;
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
 source_value:=public.canonical_equipment_plan_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-equipment-plan-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN PERFORM public.canonical_equipment_plan_validate(body->'inputs');
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':equipment-plan:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_equipment_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before returning it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_equipment_plan_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='equipment_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>20 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
IF body->>'action'='save' THEN evidence_value:=public.canonical_equipment_plan_sources(org,actor,role_value,session_value,estimate,body->'inputs'); IF body#>>'{inputs,assessment,sourcesDigest}' IS DISTINCT FROM (evidence_value->>'digest') OR body#>'{inputs,assessment,acknowledged}' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Equipment sources changed' USING ERRCODE='40001';END IF; END IF;
  SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_equipment_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,evidence,expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,NULLIF(body->'inputs','null'::jsonb),evidence_value,(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),'estimate-equipment-plan-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_equipment_plan_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_equipment_plans FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_plan_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_plan_source(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_plan_projection(public.canonical_equipment_plans) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_plan_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_plan_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;

ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan'));

REVOKE ALL ON FUNCTION public.canonical_equipment_plan_validate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_plan_sources(uuid,uuid,text,uuid,uuid,jsonb) FROM PUBLIC;
