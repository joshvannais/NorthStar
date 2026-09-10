-- Mission24 Part2 Slice3. Original graph rows and all earlier ledger bytes remain unchanged.
CREATE TABLE public.canonical_estimate_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 2 AND 10000),
 previous_id UUID,
 material_plan_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 actor_name TEXT NOT NULL,
 source_pins JSONB NOT NULL,
 original_source_pins JSONB NOT NULL,
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 calculation_version TEXT NOT NULL CHECK(calculation_version='estimate-material-adoption-v1'),
 input_fingerprint TEXT NOT NULL CHECK(input_fingerprint~'^[0-9a-f]{64}$'),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-material-adoption-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,estimate_id,material_plan_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_estimate_revisions(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,material_plan_id) REFERENCES public.canonical_material_plans(organization_id,estimate_id,id),
 CHECK((revision=2 AND previous_id IS NULL) OR (revision>2 AND previous_id IS NOT NULL))
);
CREATE TRIGGER canonical_estimate_revision_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_estimate_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_estimate_decision_immutable();

CREATE FUNCTION public.canonical_estimate_revision_original_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('estimateId',e.id,'graphId',e.graph_id,'customerId',p.customer_id,
  'operationId',e.operation_id,'opportunityId',e.opportunity_id,'snapshotId',p.id,
  'snapshotDigest',rtrim(p.snapshot_digest),'calculationVersion',e.calculation_version,
  'normalizedInputFingerprint',rtrim(e.normalized_input_fingerprint),'businessProfileId',e.business_profile_id,
  'businessProfileVersion',e.business_profile_version,'businessProfileHash',rtrim(e.business_profile_hash),
  'supportingFactIds',p.supporting_fact_ids)
 FROM public.canonical_estimates e JOIN public.canonical_polaris_snapshots p ON p.organization_id=e.organization_id AND p.estimate_id=e.id
 JOIN public.canonical_operations o ON o.organization_id=e.organization_id AND o.id=e.operation_id AND o.state='completed'
 WHERE e.organization_id=org AND e.id=estimate AND e.snapshot_digest=p.snapshot_digest;
$$;

CREATE OR REPLACE FUNCTION public.canonical_estimate_decision_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; old public.canonical_estimate_decisions%ROWTYPE; current_row public.canonical_estimate_decisions%ROWTYPE;
 inserted public.canonical_estimate_decisions%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT;
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
 source_value:=public.canonical_estimate_decision_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','scopeSummary','priceBeforeTax','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('approve','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-quote-preparation-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF (body->>'action'='approve' AND (jsonb_typeof(body->'scopeSummary') IS DISTINCT FROM 'string' OR length(btrim(body->>'scopeSummary')) NOT BETWEEN 1 AND 4000 OR jsonb_typeof(body->'priceBeforeTax') IS DISTINCT FROM 'string' OR (body->>'priceBeforeTax')!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$')) OR
    (body->>'action'='withdraw' AND (body->'scopeSummary' IS DISTINCT FROM 'null'::jsonb OR body->'priceBeforeTax' IS DISTINCT FROM 'null'::jsonb)) THEN RAISE EXCEPTION 'Decision fields invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':estimate-decision:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_estimate_decisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before returning it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_estimate_decision_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='estimate_decision_stale'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'approve' OR current_row.source_pins IS DISTINCT FROM source_value) THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>10000 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_estimate_decisions(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,scope_summary,price_before_tax,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,body->>'scopeSummary',body->>'priceBeforeTax',current_currency,btrim(body->>'reason'),'estimate-quote-preparation-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_estimate_decision_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_estimate_revision_pins(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT d.original_source_pins || jsonb_build_object('revision',jsonb_build_object('id',d.id,'number',d.revision,'digest',d.digest,'calculationVersion',d.calculation_version,'inputFingerprint',d.input_fingerprint));
$$;
CREATE FUNCTION public.canonical_estimate_revision_projection(d public.canonical_estimate_revisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'materialPlanId',d.material_plan_id,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'pins',public.canonical_estimate_revision_pins(d),
 'originalSourcePins',d.original_source_pins,'calculationVersion',d.calculation_version,'inputFingerprint',d.input_fingerprint,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,
 'reason',d.reason,'confirmationVersion',d.confirmation_version,
 'materialPlan',(SELECT public.canonical_material_plan_projection(p) FROM public.canonical_material_plans p WHERE p.organization_id=d.organization_id AND p.estimate_id=d.estimate_id AND p.id=d.material_plan_id));
$$;
CREATE OR REPLACE FUNCTION public.canonical_estimate_decision_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE((SELECT public.canonical_estimate_revision_pins(d) FROM public.canonical_estimate_revisions d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1),public.canonical_estimate_revision_original_source(org,estimate));
$$;
CREATE FUNCTION public.canonical_estimate_revision_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,selected BIGINT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest BIGINT; chosen BIGINT; selected_row JSONB; history JSONB; original JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 original:=public.canonical_estimate_revision_original_source(org,estimate);
 IF original IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT COALESCE(max(revision),1) INTO latest FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate;
 chosen:=COALESCE(selected,latest);
 IF chosen<1 OR chosen>latest THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF chosen>1 THEN SELECT public.canonical_estimate_revision_projection(d) INTO selected_row FROM public.canonical_estimate_revisions d WHERE organization_id=org AND estimate_id=estimate AND revision=chosen;
 IF selected_row IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('revision',revision,'createdAt',created_at,'actorName',actor_name) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate;
 RETURN jsonb_build_object('currentRevision',latest,'selectedRevision',chosen,'selected',selected_row,'history',history,'originalPins',original,'isCurrent',chosen=latest);
END $$;
CREATE FUNCTION public.canonical_estimate_revision_decisions(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,selected BIGINT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selection JSONB; pins JSONB; current_value JSONB; history JSONB; total BIGINT; write_basis JSONB;
BEGIN
 selection:=public.canonical_estimate_revision_read(org,actor,role_value,session_value,estimate,selected);
 pins:=CASE WHEN (selection->>'selectedRevision')::bigint=1 THEN selection->'originalPins' ELSE selection->'selected'->'pins' END;
 SELECT jsonb_build_object('revision',revision,'digest',digest) INTO write_basis FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate AND source_pins=pins;
 SELECT public.canonical_estimate_decision_projection(d) INTO current_value FROM public.canonical_estimate_decisions d WHERE organization_id=org AND estimate_id=estimate AND source_pins=pins ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_estimate_decision_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM (SELECT * FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate AND source_pins=pins ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20,'writeBasis',COALESCE(write_basis,jsonb_build_object('revision',0,'digest','none')));
END $$;
CREATE OR REPLACE FUNCTION public.canonical_estimate_decision_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_estimate_revision_decisions(org,actor,role_value,session_value,estimate,NULL);
$$;
CREATE FUNCTION public.canonical_estimate_revision_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
 body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-material-adoption-v1' OR
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
 PERFORM public.canonical_material_plan_validate(plan.inputs);
 next_revision:=COALESCE(current_row.revision,1)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Estimate revision limit' USING ERRCODE='54000'; END IF;
 fingerprint:=public.canonical_completion_digest(jsonb_build_object('original',original,'parent',source_value,'materialPlan',public.canonical_material_plan_projection(plan),'calculationVersion','estimate-material-adoption-v1'));
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_estimate_revisions(organization_id,estimate_id,revision,previous_id,material_plan_id,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,original_source_pins,expected_decision_revision,expected_decision_digest,calculation_version,input_fingerprint,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,plan.id,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,original,COALESCE(decision_row.revision,0),COALESCE(decision_row.digest,'none'),'estimate-material-adoption-v1',fingerprint,btrim(body->>'reason'),'estimate-material-adoption-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'inputFingerprint',fingerprint,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_estimate_revision_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_estimate_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_original_source(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_pins(public.canonical_estimate_revisions) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_projection(public.canonical_estimate_revisions) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_read(uuid,uuid,text,uuid,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_decisions(uuid,uuid,text,uuid,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_revision_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt'));
