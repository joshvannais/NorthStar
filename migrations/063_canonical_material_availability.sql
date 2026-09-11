-- Mission24 Part2 Slice6: human-reported availability and explicit alternative lineage.
-- Applied migration bytes remain unchanged. Existing ledger constraints revalidate.
ALTER TABLE public.canonical_material_plans DROP CONSTRAINT canonical_material_plans_calculation_version_check;
ALTER TABLE public.canonical_material_plans ADD CONSTRAINT canonical_material_plans_calculation_version_check CHECK(calculation_version IN ('estimate-material-plan-v1','estimate-material-plan-v2','estimate-material-plan-v3','estimate-material-plan-v4'));
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revisions_calculation_version_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revisions_calculation_version_check CHECK(calculation_version IN ('estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3','estimate-material-adoption-v4'));

CREATE FUNCTION public.canonical_material_availability_cost_inputs(v JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('lines',(SELECT jsonb_agg(x-'availability'-'replacement' ORDER BY ord) FROM jsonb_array_elements(v->'lines') WITH ORDINALITY AS a(x,ord)),'sourceAssessment',v->'sourceAssessment')
$$;
REVOKE ALL ON FUNCTION public.canonical_material_availability_cost_inputs(JSONB) FROM PUBLIC;

CREATE FUNCTION public.canonical_material_availability_assess(v JSONB,currency_value TEXT,service_value TEXT,as_of DATE)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;e JSONB;r JSONB;old_line JSONB;flags TEXT[];keys TEXT[]:=ARRAY['kind','issuer','reference','observedOn','validThrough','location','availableQuantity','statedUnit','leadTimeDays','appliesToReviewedJob','exceptionReason'];
 k TEXT;parts TEXT[];all_parts TEXT[]:=ARRAY[as_of::text];rows JSONB:='[]';pools TEXT[]:=ARRAY[]::TEXT[];pool_key TEXT;hash TEXT;required NUMERIC;reported NUMERIC;shortage NUMERIC;surplus NUMERIC;status TEXT;
 required_text TEXT;reported_text TEXT;shortage_text TEXT;surplus_text TEXT;
BEGIN
 IF as_of IS NULL OR public.canonical_field_evidence_object_keys_exact(v,ARRAY['lines','sourceAssessment','availabilityAssessment']) IS NOT TRUE OR jsonb_typeof(v->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Availability input invalid' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_material_source_assess(public.canonical_material_availability_cost_inputs(v),currency_value,service_value,as_of);
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  e:=l->'availability';r:=l->'replacement';flags:=ARRAY[]::TEXT[];
  IF NOT (l ? 'availability' AND l ? 'replacement') OR public.canonical_field_evidence_object_keys_exact(e,keys) IS NOT TRUE OR e->>'kind' IS NULL OR e->>'kind' NOT IN ('unknown','my_observation','company_record','supplier_statement') THEN RAISE EXCEPTION 'Availability source invalid' USING ERRCODE='22023'; END IF;
  IF r IS DISTINCT FROM 'null'::jsonb THEN
   IF public.canonical_field_evidence_object_keys_exact(r,ARRAY['previousPlanId','previousPlanRevision','previousPlanDigest','previousLineId','reason','suitabilityConfirmed']) IS NOT TRUE OR (r->>'previousPlanId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR (r->>'previousLineId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(r->'previousPlanRevision') IS DISTINCT FROM 'number' OR (r->>'previousPlanRevision')!~'^[1-9][0-9]{0,4}$' OR (r->>'previousPlanRevision')::int>10000 OR (r->>'previousPlanDigest')!~'^[0-9a-f]{64}$' OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string' OR (length(public.canonical_material_source_identity_text(r->>'reason'))=0 OR length(r->>'reason')>500) OR (r->>'reason')~U&'[\0001-\001f\007f-\009f]' OR r->'suitabilityConfirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Alternative review invalid' USING ERRCODE='22023'; END IF;
   FOREACH k IN ARRAY ARRAY['previousPlanId','previousLineId','previousPlanDigest'] LOOP IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Alternative identity invalid' USING ERRCODE='22023';END IF;END LOOP;
  END IF;
  IF e->>'kind'='unknown' THEN
   FOREACH k IN ARRAY keys LOOP
    IF k NOT IN ('kind','appliesToReviewedJob') AND e->k IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unknown availability details must be empty' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF e->'appliesToReviewedJob' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Unknown availability cannot be confirmed' USING ERRCODE='22023';END IF;
   flags:=ARRAY['unknown'];
  ELSE
   FOREACH k IN ARRAY ARRAY['issuer','reference','location','exceptionReason'] LOOP
    IF e->k IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(e->k) IS DISTINCT FROM 'string' OR length(public.canonical_material_source_identity_text(e->>k))=0 OR length(e->>k)>CASE WHEN k='exceptionReason' THEN 500 ELSE 160 END OR (e->>k)~U&'[\0001-\001f\007f-\009f]') THEN RAISE EXCEPTION 'Availability text invalid' USING ERRCODE='22023'; END IF;
   END LOOP;
   FOREACH k IN ARRAY ARRAY['observedOn','validThrough'] LOOP
    IF e->k IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(e->k) IS DISTINCT FROM 'string' OR (e->>k)!~'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' OR (e->>k)::date::text<>e->>k) THEN RAISE EXCEPTION 'Availability date invalid' USING ERRCODE='22023';END IF;
   END LOOP;
   IF e->>'validThrough'<e->>'observedOn' OR (e->>'observedOn')::date>as_of THEN RAISE EXCEPTION 'Availability date order invalid' USING ERRCODE='22023';END IF;
   IF (e->>'kind'='company_record' AND e->>'reference' IS NULL) OR (e->>'kind'='supplier_statement' AND (e->>'issuer' IS NULL OR e->>'reference' IS NULL)) THEN RAISE EXCEPTION 'Availability reference required' USING ERRCODE='22023';END IF;
   IF e->'availableQuantity'='null'::jsonb THEN
    IF e->'statedUnit' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unknown quantity unit invalid' USING ERRCODE='22023';END IF;
   ELSIF jsonb_typeof(e->'availableQuantity') IS DISTINCT FROM 'string' OR (e->>'availableQuantity')!~'^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' OR e->>'statedUnit' IS DISTINCT FROM l->>'unit' OR (l->>'unit'='ea' AND mod((e->>'availableQuantity')::numeric,1)<>0) THEN RAISE EXCEPTION 'Availability quantity invalid' USING ERRCODE='22023';END IF;
   IF e->'leadTimeDays' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(e->'leadTimeDays') IS DISTINCT FROM 'number' OR (e->>'leadTimeDays')!~'^(0|[1-9][0-9]{0,3})$' OR (e->>'leadTimeDays')::int>3650) THEN RAISE EXCEPTION 'Lead time invalid' USING ERRCODE='22023';END IF;
   IF jsonb_typeof(e->'appliesToReviewedJob') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Availability applicability invalid' USING ERRCODE='22023';END IF;
   IF e->>'observedOn' IS NULL THEN flags:=array_append(flags,'date_missing');END IF;
   IF e->>'validThrough' IS NULL THEN flags:=array_append(flags,'end_date_missing');ELSIF (e->>'validThrough')::date<as_of THEN flags:=array_append(flags,'expired');END IF;
   IF e->>'location' IS NULL THEN flags:=array_append(flags,'place_unknown');END IF;
   IF e->'appliesToReviewedJob'<>'true'::jsonb THEN flags:=array_append(flags,'applicability_unconfirmed');END IF;
   IF e->>'availableQuantity' IS NULL THEN flags:=array_append(flags,'quantity_unknown');END IF;
   IF e->>'reference' IS NOT NULL THEN
    pool_key:=jsonb_build_array(e->>'kind',public.canonical_material_source_identity_text(e->>'issuer'),public.canonical_material_source_identity_text(e->>'reference'),public.canonical_material_source_identity_text(e->>'location'),e->>'observedOn',public.canonical_material_source_identity_text(l->'evidence'->>'materialSpecification'))::text;
    IF pool_key=ANY(pools) THEN RAISE EXCEPTION 'Ambiguous shared material supply' USING ERRCODE='22023';END IF;pools:=array_append(pools,pool_key);
   END IF;
  END IF;
  required:=(l->>'quantity')::numeric*(1+(l->>'wastePercent')::numeric/100);
  required:=CASE WHEN l->>'unit'='ea' THEN ceil(required) ELSE ceil(required*1000000)/1000000 END;
  reported:=(e->>'availableQuantity')::numeric;shortage:=CASE WHEN reported IS NULL THEN NULL ELSE greatest(required-reported,0) END;surplus:=CASE WHEN reported IS NULL THEN NULL ELSE greatest(reported-required,0) END;
  required_text:=trim_scale(required)::text;reported_text:=trim_scale(reported)::text;shortage_text:=trim_scale(shortage)::text;surplus_text:=trim_scale(surplus)::text;
  status:=CASE WHEN cardinality(flags)>0 THEN 'unknown' WHEN required>reported THEN 'reported_shortage' ELSE 'reported_sufficient' END;
  parts:=ARRAY[l->>'lineId'];FOREACH k IN ARRAY keys LOOP parts:=array_append(parts,e->>k);END LOOP;hash:=encode(sha256(convert_to(array_to_json(parts)::text,'UTF8')),'hex');
  rows:=rows||jsonb_build_array(jsonb_build_object('lineId',l->>'lineId','evidenceDigest',hash,'flags',to_jsonb(flags),'requiredQuantity',required_text,'reportedQuantity',reported_text,'shortage',shortage_text,'surplus',surplus_text,'currentStatus',status));
  all_parts:=all_parts||ARRAY[l->>'lineId',hash]||flags||ARRAY[required_text,reported_text,shortage_text,surplus_text,status];
 END LOOP;
 RETURN jsonb_build_object('asOfDate',as_of::text,'lines',rows,'digest',encode(sha256(convert_to(array_to_json(all_parts)::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.canonical_material_availability_assess(JSONB,TEXT,TEXT,DATE) FROM PUBLIC;

CREATE FUNCTION public.canonical_material_availability_require(v JSONB,currency_value TEXT,service_value TEXT,as_of DATE,adopting BOOLEAN) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a JSONB;r JSONB;i INT:=0;
BEGIN
 PERFORM public.canonical_material_source_require(public.canonical_material_availability_cost_inputs(v),currency_value,service_value,as_of,adopting);
 a:=public.canonical_material_availability_assess(v,currency_value,service_value,as_of);
 IF (NOT adopting AND v->'availabilityAssessment' IS DISTINCT FROM a) OR (adopting AND v->'availabilityAssessment'->'lines' IS DISTINCT FROM a->'lines') THEN RAISE EXCEPTION 'Availability review changed' USING ERRCODE='40001';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(a->'lines') LOOP
  IF r->'flags' ? 'applicability_unconfirmed' OR (r->'flags' ? 'expired' AND v->'lines'->i->'availability'->>'exceptionReason' IS NULL) THEN RAISE EXCEPTION 'Availability requires explicit review' USING ERRCODE='22023';END IF;i:=i+1;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.canonical_material_availability_require(JSONB,TEXT,TEXT,DATE,BOOLEAN) FROM PUBLIC;

CREATE FUNCTION public.canonical_material_replacement_require(v JSONB,prior public.canonical_material_plans) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;r JSONB;old JSONB;other JSONB;n INT:=0;
BEGIN
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  r:=l->'replacement';SELECT x INTO old FROM jsonb_array_elements(CASE WHEN prior.action='save' THEN COALESCE(prior.inputs->'lines','[]') ELSE '[]' END) x WHERE x->>'lineId'=l->>'lineId';
  IF FOUND THEN IF r IS DISTINCT FROM COALESCE(old->'replacement','null') THEN RAISE EXCEPTION 'Alternative history changed' USING ERRCODE='22023';END IF;CONTINUE;END IF;
  IF r='null'::jsonb THEN CONTINUE;END IF;n:=n+1;
  IF prior.id IS NULL OR prior.action<>'save' OR r->>'previousPlanId' IS DISTINCT FROM prior.id::text OR r->>'previousPlanRevision' IS DISTINCT FROM prior.revision::text OR r->>'previousPlanDigest' IS DISTINCT FROM prior.digest OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prior.inputs->'lines') x WHERE x->>'lineId'=r->>'previousLineId') OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'lines') x WHERE x->>'lineId'=r->>'previousLineId') THEN RAISE EXCEPTION 'Alternative basis changed' USING ERRCODE='40001';END IF;
  IF jsonb_array_length(v->'lines')<>jsonb_array_length(prior.inputs->'lines') THEN RAISE EXCEPTION 'One replacement required' USING ERRCODE='22023';END IF;
  FOR other IN SELECT value FROM jsonb_array_elements(prior.inputs->'lines') WHERE value->>'lineId'<>r->>'previousLineId' LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'lines') x WHERE x=other) THEN RAISE EXCEPTION 'Other material changes require separate review' USING ERRCODE='22023';END IF;
  END LOOP;
 END LOOP;
 IF n>1 THEN RAISE EXCEPTION 'One alternative at a time' USING ERRCODE='22023';END IF;
END $$;
REVOKE ALL ON FUNCTION public.canonical_material_replacement_require(JSONB,public.canonical_material_plans) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.canonical_material_plan_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; old public.canonical_material_plans%ROWTYPE; current_row public.canonical_material_plans%ROWTYPE;
 inserted public.canonical_material_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; decision_row public.canonical_estimate_decisions%ROWTYPE;
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
 source_value:=public.canonical_material_plan_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR (body->>'confirmationVersion' IS NULL OR body->>'confirmationVersion' NOT IN ('estimate-material-plan-v1','estimate-material-plan-v2','estimate-material-plan-v3','estimate-material-plan-v4')) OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN
  IF body->>'confirmationVersion'='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_assess(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date); ELSIF body->>'confirmationVersion'='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_assess(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date); ELSIF body->>'confirmationVersion'='estimate-material-plan-v2' THEN PERFORM public.canonical_material_plan_validate_v2(body->'inputs'); ELSE PERFORM public.canonical_material_plan_validate(body->'inputs'); END IF;
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':material-plan:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_material_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before returning it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_material_plan_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF current_row.calculation_version='estimate-material-plan-v4' AND body->>'confirmationVersion'<>'estimate-material-plan-v4' THEN RAISE EXCEPTION 'Refresh whole material plan' USING ERRCODE='40001';END IF;
 IF body->>'action'='save' AND body->>'confirmationVersion'='estimate-material-plan-v4' THEN PERFORM public.canonical_material_replacement_require(body->'inputs',current_row);END IF;
 IF (body->>'confirmationVersion'='estimate-material-plan-v1' AND current_row.calculation_version IN ('estimate-material-plan-v2','estimate-material-plan-v3')) OR (body->>'confirmationVersion'='estimate-material-plan-v2' AND current_row.calculation_version='estimate-material-plan-v3') THEN RAISE EXCEPTION 'Whole material plan review required' USING ERRCODE='40001'; END IF;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='material_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>10000 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 IF body->>'action'='save' AND body->>'confirmationVersion'='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,FALSE); END IF;
 IF body->>'action'='save' AND body->>'confirmationVersion'='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,FALSE); END IF;
 INSERT INTO public.canonical_material_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,expected_decision_revision,expected_decision_digest,currency,reason,calculation_version,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,NULLIF(body->'inputs','null'::jsonb),(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),body->>'confirmationVersion',body->>'confirmationVersion',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 IF body->>'action'='save' AND body->>'confirmationVersion'='estimate-material-plan-v4' THEN PERFORM public.canonical_material_availability_require(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,FALSE); END IF;
 IF body->>'action'='save' AND body->>'confirmationVersion'='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,FALSE); END IF;
 RETURN jsonb_build_object('receipt',public.canonical_material_plan_projection(inserted),'replayed',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_estimate_revision_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
