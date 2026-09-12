-- Mission24 Part3 Slice1: new private labor-plan history; original62 SQL files unchanged.
CREATE FUNCTION public.canonical_labor_plan_text(v JSONB,maximum INTEGER,blank BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(v)='string' AND length(v#>>'{}')<=maximum AND (blank OR length(btrim(v#>>'{}',U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0) AND (v#>>'{}')!~U&'[\0001-\001f\007f-\009f]'
$$;
CREATE FUNCTION public.canonical_labor_plan_number(v JSONB,d INTEGER,w INTEGER) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~('^(0|[1-9][0-9]{0,'||(w-1)||'})(\.[0-9]{1,'||d||'})?$') THEN RAISE EXCEPTION 'Labor number invalid' USING ERRCODE='22023'; END IF; RETURN (v#>>'{}')::numeric; END $$;
CREATE FUNCTION public.canonical_labor_plan_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;e JSONB;k TEXT;t TEXT;dd DATE;hours NUMERIC;rate NUMERIC;burden NUMERIC;cost NUMERIC;total NUMERIC:=0;ids TEXT[]:=ARRAY[]::TEXT[];
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['serviceKey','lines','assessment']) IS NOT TRUE OR public.canonical_labor_plan_text(v->'serviceKey',160) IS NOT TRUE OR jsonb_typeof(v->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Labor plan invalid' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(v->'lines') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Labor tasks invalid' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
 IF public.canonical_field_evidence_object_keys_exact(l,ARRAY['lineId','task','basis','workerHours','people','elapsedHours','quantity','unit','hoursPerUnit','rateMode','hourlyCost','burdenPercent','quantitySource','rateSource']) IS NOT TRUE OR jsonb_typeof(l->'lineId') IS DISTINCT FROM 'string' OR (l->>'lineId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR lower(l->>'lineId')=ANY(ids) OR public.canonical_labor_plan_text(l->'task',160) IS NOT TRUE THEN RAISE EXCEPTION 'Labor task identity invalid' USING ERRCODE='22023';END IF;
 ids:=array_append(ids,lower(l->>'lineId'));
 FOREACH k IN ARRAY ARRAY['quantitySource','rateSource'] LOOP
 e:=l->k;
 IF public.canonical_field_evidence_object_keys_exact(e,ARRAY['kind','reference','note','effectiveOn','endsOn','geography']) IS NOT TRUE OR COALESCE(e->>'kind','') NOT IN ('my_estimate','company_reference','published_reference') OR public.canonical_labor_plan_text(e->'reference',300,e->>'kind'='my_estimate') IS NOT TRUE OR public.canonical_labor_plan_text(e->'note',500,TRUE) IS NOT TRUE OR public.canonical_labor_plan_text(e->'geography',160,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Labor source invalid' USING ERRCODE='22023';END IF;
 FOREACH t IN ARRAY ARRAY['effectiveOn','endsOn'] LOOP
 IF e->t IS DISTINCT FROM 'null'::jsonb THEN
 IF jsonb_typeof(e->t) IS DISTINCT FROM 'string' OR (e->>t)!~'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Labor date invalid' USING ERRCODE='22023';END IF;
 BEGIN dd:=(e->>t)::date;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Labor date invalid' USING ERRCODE='22023';END;
 IF to_char(dd,'YYYY-MM-DD')<>e->>t THEN RAISE EXCEPTION 'Labor date invalid' USING ERRCODE='22023';END IF;
 END IF;END LOOP;
 IF e->>'effectiveOn' IS NOT NULL AND e->>'endsOn' IS NOT NULL AND e->>'endsOn'<e->>'effectiveOn' THEN RAISE EXCEPTION 'Labor date order invalid' USING ERRCODE='22023';END IF;
 END LOOP;
 IF l->>'basis'='worker_hours' THEN
 IF (l->'people') IS DISTINCT FROM 'null'::jsonb OR l->'elapsedHours' IS DISTINCT FROM 'null'::jsonb OR l->'quantity' IS DISTINCT FROM 'null'::jsonb OR l->'unit' IS DISTINCT FROM 'null'::jsonb OR l->'hoursPerUnit' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Labor basis invalid' USING ERRCODE='22023';END IF;
 hours:=public.canonical_labor_plan_number(l->'workerHours',6,9);
 ELSIF l->>'basis'='people_time' THEN
 IF l->'workerHours' IS DISTINCT FROM 'null'::jsonb OR l->'quantity' IS DISTINCT FROM 'null'::jsonb OR l->'unit' IS DISTINCT FROM 'null'::jsonb OR l->'hoursPerUnit' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(l->'people') IS DISTINCT FROM 'number' OR (l->>'people')!~'^[1-9][0-9]{0,2}$' OR (l->>'people')::numeric>100 THEN RAISE EXCEPTION 'Labor crew basis invalid' USING ERRCODE='22023';END IF;
 hours:=public.canonical_labor_plan_number(l->'elapsedHours',6,9)*(l->>'people')::numeric;
 ELSIF l->>'basis'='quantity_productivity' THEN
 IF l->'workerHours' IS DISTINCT FROM 'null'::jsonb OR l->'people' IS DISTINCT FROM 'null'::jsonb OR l->'elapsedHours' IS DISTINCT FROM 'null'::jsonb OR COALESCE(l->>'unit','') NOT IN ('ea','ft','ft2','m','m2','yd3','m3') THEN RAISE EXCEPTION 'Labor quantity basis invalid' USING ERRCODE='22023';END IF;
 hours:=public.canonical_labor_plan_number(l->'quantity',6,9);
 IF l->>'unit'='ea' AND hours<>trunc(hours) THEN RAISE EXCEPTION 'Labor item quantity invalid' USING ERRCODE='22023';END IF;
 hours:=hours*public.canonical_labor_plan_number(l->'hoursPerUnit',6,9);
 ELSE RAISE EXCEPTION 'Labor basis invalid' USING ERRCODE='22023';END IF;
 rate:=NULL;burden:=NULL;
 IF l->'hourlyCost' IS DISTINCT FROM 'null'::jsonb THEN
 IF jsonb_typeof(l->'hourlyCost') IS DISTINCT FROM 'string' OR (l->>'hourlyCost')!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN RAISE EXCEPTION 'Labor rate invalid' USING ERRCODE='22023';END IF;rate:=(l->>'hourlyCost')::numeric;END IF;
 IF l->>'rateMode'='all_in' THEN IF l->'burdenPercent' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Labor burden duplicated' USING ERRCODE='22023';END IF;burden:=0;
 ELSIF l->>'rateMode'='base_burden' THEN IF l->'burdenPercent' IS DISTINCT FROM 'null'::jsonb THEN burden:=public.canonical_labor_plan_number(l->'burdenPercent',2,3);IF burden>100 THEN RAISE EXCEPTION 'Labor burden invalid' USING ERRCODE='22023';END IF;END IF;
 ELSE RAISE EXCEPTION 'Labor rate basis invalid' USING ERRCODE='22023';END IF;
 IF rate IS NOT NULL AND burden IS NOT NULL THEN cost:=round(hours*rate*(1+burden/100),2);total:=total+cost;IF cost>999999999999.99 OR total>999999999999.99 THEN RAISE EXCEPTION 'Labor total overflow' USING ERRCODE='22023';END IF;END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.canonical_labor_plan_assess(v JSONB,day_value DATE) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE l JSONB;e JSONB;k TEXT;codes JSONB;cautions JSONB:='[]';
BEGIN
 PERFORM public.canonical_labor_plan_validate(v);
 FOR l IN SELECT value FROM jsonb_array_elements(v->'lines') LOOP
 FOREACH k IN ARRAY ARRAY['quantitySource','rateSource'] LOOP
 e:=l->k;codes:='[]';
 IF e->>'effectiveOn' IS NULL THEN codes:=codes||'"date_unknown"'::jsonb;ELSIF (e->>'effectiveOn')::date>day_value THEN codes:=codes||'"not_yet_effective"'::jsonb;END IF;
 IF e->>'endsOn' IS NULL THEN codes:=codes||'"freshness_unknown"'::jsonb;ELSIF (e->>'endsOn')::date<day_value THEN codes:=codes||'"expired"'::jsonb;END IF;
 IF public.canonical_labor_plan_text(e->'geography',160) IS NOT TRUE THEN codes:=codes||'"applicability_unknown"'::jsonb;END IF;
 IF jsonb_array_length(codes)>0 THEN cautions:=cautions||jsonb_build_array(jsonb_build_object('lineId',l->>'lineId','source',k,'codes',codes));END IF;
 END LOOP;END LOOP;
 RETURN jsonb_build_object('date',to_char(day_value,'YYYY-MM-DD'),'cautions',cautions);
END $$;
CREATE FUNCTION public.canonical_labor_plan_require(v JSONB,service_key TEXT,day_value DATE) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a JSONB:=v->'assessment';expected JSONB;
BEGIN
 expected:=public.canonical_labor_plan_assess(v,day_value);
 IF v->>'serviceKey' IS DISTINCT FROM service_key OR public.canonical_field_evidence_object_keys_exact(a,ARRAY['date','cautions','acknowledged','explanation']) IS NOT TRUE OR (a-'acknowledged'-'explanation') IS DISTINCT FROM expected OR a->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR public.canonical_labor_plan_text(a->'explanation',1000,jsonb_array_length(expected->'cautions')=0) IS NOT TRUE THEN RAISE EXCEPTION 'Labor source review changed' USING ERRCODE='22023';END IF;
END $$;
-- Mission24 single labor planning inputs. Additive: calculated estimates and old history remain immutable.
CREATE TABLE public.canonical_labor_plans (
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
 calculation_version TEXT NOT NULL DEFAULT 'estimate-labor-plan-v1' CHECK(calculation_version='estimate-labor-plan-v1'),
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-labor-plan-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_labor_plans(organization_id,estimate_id,id),
 CHECK((action='save' AND inputs IS NOT NULL) OR (action='withdraw' AND inputs IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_labor_plan_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_labor_plan_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_labor_plans FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_labor_plan_immutable();

CREATE FUNCTION public.canonical_labor_plan_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_decision_source(org,estimate) $$;
CREATE FUNCTION public.canonical_labor_plan_projection(d public.canonical_labor_plans) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'inputs',d.inputs,'calculationVersion',d.calculation_version,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_labor_plan_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_labor_plan_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_labor_plan_projection(d) INTO current_value FROM public.canonical_labor_plans d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_labor_plan_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
CREATE FUNCTION public.canonical_labor_plan_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; old public.canonical_labor_plans%ROWTYPE; current_row public.canonical_labor_plans%ROWTYPE;
 inserted public.canonical_labor_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; decision_row public.canonical_estimate_decisions%ROWTYPE;
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
 source_value:=public.canonical_labor_plan_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-labor-plan-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN PERFORM public.canonical_labor_plan_validate(body->'inputs');
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':labor-plan:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_labor_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before returning it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_labor_plan_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_labor_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='labor_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>10000 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
IF body->>'action'='save' THEN PERFORM public.canonical_labor_plan_require(body->'inputs',(SELECT snapshot->'service'->>'key' FROM public.canonical_polaris_snapshots WHERE organization_id=org AND estimate_id=estimate),(clock_timestamp() AT TIME ZONE 'UTC')::date); END IF;
  SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_labor_plans(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,NULLIF(body->'inputs','null'::jsonb),(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),'estimate-labor-plan-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_labor_plan_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_labor_plans FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_source(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_projection(public.canonical_labor_plans) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;

ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan'));
REVOKE ALL ON FUNCTION public.canonical_labor_plan_text(jsonb,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_number(jsonb,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_validate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_assess(jsonb,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_labor_plan_require(jsonb,text,date) FROM PUBLIC;
