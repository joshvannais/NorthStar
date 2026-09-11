-- Mission24 Part2 Slice5: retain v1/v2 rows and validators, append reviewed cost evidence.
ALTER TABLE public.canonical_material_plans DROP CONSTRAINT canonical_material_plans_calculation_version_check;
ALTER TABLE public.canonical_material_plans DROP CONSTRAINT canonical_material_plans_confirmation_version_check;
ALTER TABLE public.canonical_material_plans ADD CONSTRAINT canonical_material_plans_calculation_version_check CHECK(calculation_version IN ('estimate-material-plan-v1','estimate-material-plan-v2','estimate-material-plan-v3'));
ALTER TABLE public.canonical_material_plans ADD CONSTRAINT canonical_material_plans_confirmation_version_check CHECK(confirmation_version=calculation_version);
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revisions_calculation_version_check;
ALTER TABLE public.canonical_estimate_revisions DROP CONSTRAINT canonical_estimate_revisions_confirmation_version_check;
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revisions_calculation_version_check CHECK(calculation_version IN ('estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3'));
ALTER TABLE public.canonical_estimate_revisions ADD CONSTRAINT canonical_estimate_revisions_confirmation_version_check CHECK(confirmation_version=calculation_version);

-- Versioned human-recorded cost evidence; no supplier verification or new provider authority.
-- Comparison-only normalization, exactly matching the JavaScript explicit edge set.
-- No case-folding, internal-space collapse, Unicode composition or evidence rewriting.
CREATE FUNCTION public.canonical_material_source_identity_text(value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT btrim(value,U&'\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
$$;
REVOKE ALL ON FUNCTION public.canonical_material_source_identity_text(TEXT) FROM PUBLIC;

CREATE FUNCTION public.canonical_material_source_assess(v JSONB,currency_value TEXT,service_value TEXT,as_of DATE)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE line JSONB; e JSONB; other JSONB; flags TEXT[]; parts TEXT[]; all_parts TEXT[]:=ARRAY[as_of::text]; rows JSONB:='[]'; k TEXT; source_hash TEXT; idx INT:=0;
 keys TEXT[]:=ARRAY['kind','issuer','reference','effectiveOn','validThrough','countryCode','region','locality','serviceKey','materialSpecification','statedUnit','statedCurrency','statedUnitPrice','appliesToReviewedJob','exceptionReason'];
BEGIN
 IF as_of IS NULL OR public.canonical_field_evidence_object_keys_exact(v,ARRAY['lines','sourceAssessment']) IS NOT TRUE OR jsonb_typeof(v->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Source review invalid' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_material_plan_validate_v2(jsonb_build_object('lines',(SELECT jsonb_agg(x-'evidence') FROM jsonb_array_elements(v->'lines') x)));
 FOR line IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
  e:=line->'evidence'; flags:=ARRAY[]::TEXT[];
  IF public.canonical_field_evidence_object_keys_exact(e,keys) IS NOT TRUE OR e->>'kind' IS NULL OR e->>'kind' NOT IN ('my_estimate','company_record','supplier_quote','published_reference') THEN RAISE EXCEPTION 'Source category invalid' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['issuer','reference','region','locality','serviceKey','materialSpecification','exceptionReason'] LOOP
   IF e->k IS DISTINCT FROM 'null'::JSONB AND (jsonb_typeof(e->k) IS DISTINCT FROM 'string' OR length(public.canonical_material_source_identity_text(e->>k))=0 OR length(e->>k)>CASE WHEN k='exceptionReason' THEN 500 ELSE 160 END OR (e->>k)~U&'[\0001-\001f\007f-\009f]') THEN RAISE EXCEPTION 'Source text invalid' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['effectiveOn','validThrough'] LOOP
   IF e->k IS DISTINCT FROM 'null'::JSONB AND (jsonb_typeof(e->k) IS DISTINCT FROM 'string' OR (e->>k)!~'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' OR (e->>k)::date::text<>e->>k) THEN RAISE EXCEPTION 'Source date invalid' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF e->>'effectiveOn' IS NOT NULL AND e->>'validThrough'<e->>'effectiveOn' THEN RAISE EXCEPTION 'Source date order invalid' USING ERRCODE='22023'; END IF;
  IF e->'countryCode' IS DISTINCT FROM 'null'::JSONB AND (jsonb_typeof(e->'countryCode') IS DISTINCT FROM 'string' OR (e->>'countryCode')!~'^[A-Z]{2}$') THEN RAISE EXCEPTION 'Country invalid' USING ERRCODE='22023'; END IF;
  IF e->>'kind'<>'my_estimate' AND (e->>'reference' IS NULL OR (e->>'kind'<>'company_record' AND e->>'issuer' IS NULL)) THEN RAISE EXCEPTION 'Source reference required' USING ERRCODE='22023'; END IF;
  IF e->>'statedUnit' IS DISTINCT FROM line->>'unit' OR e->>'statedCurrency' IS DISTINCT FROM currency_value OR e->>'statedUnitPrice' IS DISTINCT FROM line->>'unitPrice' OR jsonb_typeof(e->'appliesToReviewedJob') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Source price or applicability mismatch' USING ERRCODE='22023'; END IF;
  IF e->>'effectiveOn' IS NULL THEN flags:=array_append(flags,'date_missing'); ELSIF (e->>'effectiveOn')::date>as_of THEN flags:=array_append(flags,'not_effective'); END IF;
  IF e->>'validThrough' IS NULL THEN flags:=array_append(flags,'end_date_missing'); ELSIF (e->>'validThrough')::date<as_of THEN flags:=array_append(flags,'expired'); END IF;
  IF e->>'countryCode' IS NULL THEN flags:=array_append(flags,'place_unknown'); END IF;
  IF e->>'serviceKey' IS NOT NULL AND service_value IS NOT NULL AND e->>'serviceKey'<>service_value THEN flags:=array_append(flags,'service_mismatch'); END IF;
  IF e->'appliesToReviewedJob'<>'true'::jsonb THEN flags:=array_append(flags,'applicability_unconfirmed'); END IF;
  IF e->>'issuer' IS NOT NULL AND e->>'reference' IS NOT NULL THEN
   FOR other IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
    IF public.canonical_material_source_identity_text(other->'evidence'->>'issuer')=public.canonical_material_source_identity_text(e->>'issuer') AND public.canonical_material_source_identity_text(other->'evidence'->>'reference')=public.canonical_material_source_identity_text(e->>'reference') AND public.canonical_material_source_identity_text(other->'evidence'->>'materialSpecification') IS NOT DISTINCT FROM public.canonical_material_source_identity_text(e->>'materialSpecification') AND other->'evidence'->'effectiveOn' IS NOT DISTINCT FROM e->'effectiveOn' AND (other->>'unitPrice'<>line->>'unitPrice' OR other->>'unit'<>line->>'unit') THEN flags:=array_append(flags,'conflict'); EXIT; END IF;
   END LOOP;
  END IF;
  parts:=ARRAY[line->>'lineId']; FOREACH k IN ARRAY keys LOOP parts:=array_append(parts,e->>k); END LOOP;
  source_hash:=encode(sha256(convert_to(array_to_json(parts)::text,'UTF8')),'hex');
  rows:=rows||jsonb_build_array(jsonb_build_object('lineId',line->>'lineId','evidenceDigest',source_hash,'flags',to_jsonb(flags)));
  all_parts:=all_parts||ARRAY[line->>'lineId',source_hash]||flags;
 END LOOP;
 RETURN jsonb_build_object('asOfDate',as_of::text,'lines',rows,'digest',encode(sha256(convert_to(array_to_json(all_parts)::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.canonical_material_source_assess(JSONB,TEXT,TEXT,DATE) FROM PUBLIC;

CREATE FUNCTION public.canonical_material_source_require(v JSONB,currency_value TEXT,service_value TEXT,as_of DATE,adopting BOOLEAN)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE assessed JSONB; row JSONB; i INT:=0;
BEGIN
 assessed:=public.canonical_material_source_assess(v,currency_value,service_value,as_of);
 IF (NOT adopting AND v->'sourceAssessment' IS DISTINCT FROM assessed) OR (adopting AND v->'sourceAssessment'->'lines' IS DISTINCT FROM assessed->'lines') THEN RAISE EXCEPTION 'Source review changed' USING ERRCODE='40001'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(assessed->'lines') LOOP
  IF row->'flags' ?| ARRAY['conflict','service_mismatch','applicability_unconfirmed'] THEN RAISE EXCEPTION 'Resolve source applicability or conflict' USING ERRCODE='22023'; END IF;
  IF row->'flags' ?| ARRAY['expired','not_effective'] AND v->'lines'->i->'evidence'->>'exceptionReason' IS NULL THEN RAISE EXCEPTION 'Source date exception reason required' USING ERRCODE='22023'; END IF;
  i:=i+1;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.canonical_material_source_require(JSONB,TEXT,TEXT,DATE,BOOLEAN) FROM PUBLIC;

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
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR (body->>'confirmationVersion' IS NULL OR body->>'confirmationVersion' NOT IN ('estimate-material-plan-v1','estimate-material-plan-v2','estimate-material-plan-v3')) OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN
  IF body->>'confirmationVersion'='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_assess(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date); ELSIF body->>'confirmationVersion'='estimate-material-plan-v2' THEN PERFORM public.canonical_material_plan_validate_v2(body->'inputs'); ELSE PERFORM public.canonical_material_plan_validate(body->'inputs'); END IF;
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
 IF body->>'action'='save' AND body->>'confirmationVersion'='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(body->'inputs',current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,FALSE); END IF;
 INSERT INTO public.canonical_material_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,expected_decision_revision,expected_decision_digest,currency,reason,calculation_version,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,NULLIF(body->'inputs','null'::jsonb),(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),body->>'confirmationVersion',body->>'confirmationVersion',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
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
 body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR (body->>'confirmationVersion' IS NULL OR body->>'confirmationVersion' NOT IN ('estimate-material-adoption-v1','estimate-material-adoption-v2','estimate-material-adoption-v3')) OR
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
 IF plan.calculation_version='estimate-material-plan-v3' AND body->>'confirmationVersion'='estimate-material-adoption-v3' THEN PERFORM public.canonical_material_source_assess(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date);
 ELSIF plan.calculation_version='estimate-material-plan-v2' AND body->>'confirmationVersion' IN ('estimate-material-adoption-v2','estimate-material-adoption-v3') THEN PERFORM public.canonical_material_plan_validate_v2(plan.inputs);
 ELSIF plan.calculation_version='estimate-material-plan-v1' THEN PERFORM public.canonical_material_plan_validate(plan.inputs);
 ELSE RAISE EXCEPTION 'Material calculation version unavailable' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,1)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Estimate revision limit' USING ERRCODE='54000'; END IF;
 fingerprint:=public.canonical_completion_digest(jsonb_build_object('original',original,'parent',source_value,'materialPlan',public.canonical_material_plan_projection(plan),'calculationVersion',body->>'confirmationVersion'));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 IF plan.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE); END IF;
 INSERT INTO public.canonical_estimate_revisions(organization_id,estimate_id,revision,previous_id,material_plan_id,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,original_source_pins,expected_decision_revision,expected_decision_digest,calculation_version,input_fingerprint,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,plan.id,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,original,COALESCE(decision_row.revision,0),COALESCE(decision_row.digest,'none'),body->>'confirmationVersion',fingerprint,btrim(body->>'reason'),body->>'confirmationVersion',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'inputFingerprint',fingerprint,'body',body))) RETURNING * INTO inserted;
 IF plan.calculation_version='estimate-material-plan-v3' THEN PERFORM public.canonical_material_source_require(plan.inputs,current_currency,(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date,TRUE); END IF;
 RETURN jsonb_build_object('receipt',public.canonical_estimate_revision_projection(inserted),'replayed',FALSE);
END $$;
