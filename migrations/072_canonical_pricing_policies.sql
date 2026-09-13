-- Part6 Slice2: immutable private policy comparisons, never price approval.
CREATE FUNCTION public.canonical_pricing_policy_percent(v JSONB,maximum NUMERIC) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n NUMERIC;BEGIN IF v='null'::jsonb THEN RETURN NULL;END IF;IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~'^(0|[1-9][0-9]{0,3})\.[0-9]{2}$' THEN RAISE EXCEPTION 'Policy percentage invalid' USING ERRCODE='22023';END IF;n:=(v#>>'{}')::numeric*100;IF n>maximum THEN RAISE EXCEPTION 'Policy percentage outside range' USING ERRCODE='22023';END IF;RETURN n;END $$;
CREATE FUNCTION public.canonical_pricing_policy_signed(v NUMERIC) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN v<0 THEN '-' ELSE '' END||public.canonical_pricing_decimal(abs(v)) $$;
CREATE FUNCTION public.canonical_pricing_policy_ratio(n NUMERIC,d NUMERIC) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r NUMERIC;BEGIN IF d=0 OR d IS NULL OR n IS NULL THEN RETURN NULL;END IF;r:=round(n*1000000/d);RETURN jsonb_build_object('value',CASE WHEN r<0 THEN '-' ELSE '' END||trunc(abs(r)/10000)::text||'.'||lpad(trunc(mod(abs(r),10000))::text,4,'0'),'approximate',mod(abs(n*1000000),d)<>0);END $$;
CREATE FUNCTION public.canonical_pricing_policy_compare(p NUMERIC,c NUMERIC,t NUMERIC,f NUMERIC) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF p IS NULL THEN RETURN NULL;END IF;RETURN jsonb_build_object('price',public.canonical_pricing_decimal(p),'remaining',public.canonical_pricing_policy_signed(p-c),'thresholdDifference',public.canonical_pricing_policy_signed(p-t),'status',CASE WHEN t IS NULL THEN 'unavailable' WHEN p<t THEN 'below' WHEN p>t THEN 'above' ELSE 'at' END,'fixedFloorDifference',public.canonical_pricing_policy_signed(p-f),'achievedMarkup',public.canonical_pricing_policy_ratio(p-c,c),'achievedMargin',public.canonical_pricing_policy_ratio(p-c,p));END $$;
CREATE FUNCTION public.canonical_pricing_policy_calculate(v JSONB,currency_value TEXT,basis JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rate NUMERIC;c JSONB;m JSONB;o JSONB;direct NUMERIC;gross NUMERIC;included NUMERIC;h NUMERIC;b NUMERIC;a NUMERIC;cost NUMERIC;t NUMERIC;f NUMERIC;final_value NUMERIC;coverage BOOLEAN;
BEGIN
IF currency_value IS NULL OR currency_value NOT IN ('USD','CAD','EUR') OR public.canonical_field_evidence_object_keys_exact(v,ARRAY['serviceKey','method','percent','contingency','minimum','source']) IS NOT TRUE OR public.canonical_pricing_text(v->'serviceKey',100) IS NOT TRUE OR v->>'method' IS NULL OR v->>'method' NOT IN ('unknown','markup','target_margin') THEN RAISE EXCEPTION 'Policy inputs invalid' USING ERRCODE='22023';END IF;
PERFORM public.canonical_pricing_source_validate(v->'source');
rate:=public.canonical_pricing_policy_percent(v->'percent',CASE WHEN v->>'method'='target_margin' THEN 9999 ELSE 100000 END);
IF v->>'method'='unknown' AND v->'percent'<>'null'::jsonb THEN RAISE EXCEPTION 'Policy method required' USING ERRCODE='22023';END IF;
c:=v->'contingency';IF public.canonical_field_evidence_object_keys_exact(c,ARRAY['method','amount','percent','coverage']) IS NOT TRUE OR c->>'method' IS NULL OR c->>'method' NOT IN ('unknown','none','fixed','percent') OR public.canonical_field_evidence_object_keys_exact(c->'coverage',ARRAY['status','explanation']) IS NOT TRUE OR c#>>'{coverage,status}' IS NULL OR c#>>'{coverage,status}' NOT IN ('unknown','declared_separate') OR public.canonical_pricing_text(c#>'{coverage,explanation}',1000,c#>>'{coverage,status}'='unknown') IS NOT TRUE THEN RAISE EXCEPTION 'Policy allowance invalid' USING ERRCODE='22023';END IF;
o:=basis->'overhead';IF public.canonical_field_evidence_object_keys_exact(o,ARRAY['gross','alreadyIncluded','incremental','overlapResolved']) IS NOT TRUE THEN RAISE EXCEPTION 'Policy overhead missing' USING ERRCODE='22023';END IF;
direct:=public.canonical_pricing_money(basis->'directCosts');gross:=public.canonical_pricing_money(o->'gross');included:=public.canonical_pricing_money(o->'alreadyIncluded');h:=public.canonical_pricing_money(o->'incremental');
IF gross IS NOT NULL AND included IS NOT NULL AND included>gross OR h IS NOT NULL AND (gross IS NULL OR included IS NULL OR gross-included<>h OR o->'overlapResolved' IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Policy overhead inconsistent' USING ERRCODE='22023';END IF;
b:=direct+h;PERFORM public.canonical_pricing_decimal(b);
IF c->>'method'='fixed' THEN IF c->'percent'<>'null'::jsonb THEN RAISE EXCEPTION 'Policy amount shape invalid' USING ERRCODE='22023';END IF;a:=public.canonical_pricing_money(c->'amount');
ELSIF c->>'method'='percent' THEN IF c->'amount'<>'null'::jsonb THEN RAISE EXCEPTION 'Policy amount shape invalid' USING ERRCODE='22023';END IF;a:=round(b*public.canonical_pricing_policy_percent(c->'percent',10000)/10000);
ELSE IF c->'amount'<>'null'::jsonb OR c->'percent'<>'null'::jsonb THEN RAISE EXCEPTION 'Policy amount shape invalid' USING ERRCODE='22023';END IF;IF c->>'method'='none' THEN a:=0;END IF;END IF;
PERFORM public.canonical_pricing_decimal(a);coverage:=c#>>'{coverage,status}'='declared_separate';IF coverage THEN cost:=b+a;END IF;PERFORM public.canonical_pricing_decimal(cost);
IF cost IS NOT NULL AND rate IS NOT NULL AND v->>'method'<>'unknown' THEN t:=CASE WHEN v->>'method'='markup' THEN ceil(cost*(10000+rate)/10000) ELSE ceil(cost*10000/(10000-rate)) END;PERFORM public.canonical_pricing_decimal(t);END IF;
m:=v->'minimum';IF public.canonical_field_evidence_object_keys_exact(m,ARRAY['method','amount']) IS NOT TRUE OR m->>'method' IS NULL OR m->>'method' NOT IN ('none','fixed') OR m->>'method'='none' AND m->'amount'<>'null'::jsonb THEN RAISE EXCEPTION 'Policy minimum invalid' USING ERRCODE='22023';END IF;
f:=CASE WHEN m->>'method'='none' THEN 0 ELSE public.canonical_pricing_money(m->'amount') END;IF t IS NOT NULL AND f IS NOT NULL THEN final_value:=greatest(t,f);END IF;
RETURN jsonb_build_object('calculationVersion','estimate-pricing-policy-v1','currency',currency_value,'directCosts',public.canonical_pricing_decimal(direct),'overhead',o,'base',public.canonical_pricing_decimal(b),'allowance',public.canonical_pricing_decimal(a),'coverageResolved',coverage,'policyCost',public.canonical_pricing_decimal(cost),'method',v->'method','percent',v->'percent','calculatedThreshold',public.canonical_pricing_decimal(t),'minimum',public.canonical_pricing_decimal(f),'threshold',public.canonical_pricing_decimal(final_value),'binding',CASE WHEN final_value IS NULL THEN 'unavailable' WHEN t=f THEN 'equal' WHEN f>t THEN 'minimum' ELSE 'method' END,'floorIncrease',CASE WHEN t IS NULL OR f IS NULL THEN NULL ELSE public.canonical_pricing_decimal(greatest(f-t,0)) END,'proposed',public.canonical_pricing_policy_compare(public.canonical_pricing_money(basis->'proposedBeforeTax'),cost,final_value,CASE WHEN m->>'method'='fixed' THEN f ELSE NULL END),'reviewed',public.canonical_pricing_policy_compare(public.canonical_pricing_money(basis->'reviewedPrice'),cost,final_value,CASE WHEN m->>'method'='fixed' THEN f ELSE NULL END));
END $$;

CREATE FUNCTION public.canonical_pricing_policy_sources(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,selected BIGINT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sources JSONB;pricing public.canonical_pricing_plans%ROWTYPE;decision public.canonical_estimate_decisions%ROWTYPE;pins JSONB;currency_value TEXT;payload JSONB;basis JSONB;valid BOOLEAN:=FALSE;reviewed TEXT;
BEGIN
sources:=public.canonical_pricing_sources(org,actor,role_value,session_value,estimate,selected);
pins:=public.canonical_estimate_decision_source(org,estimate);
SELECT currency INTO currency_value FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;
SELECT * INTO pricing FROM public.canonical_pricing_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
SELECT * INTO decision FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
IF pricing.action='save' AND pricing.source_pins=pins AND pricing.currency=currency_value AND pricing.result->'directCosts'=sources#>'{basis,directCosts}' THEN
 BEGIN PERFORM public.canonical_pricing_require(pricing.inputs,sources);valid:=TRUE;EXCEPTION WHEN serialization_failure THEN valid:=FALSE;END;
END IF;
IF decision.action='approve' AND decision.source_pins=pins AND decision.currency=currency_value THEN reviewed:=decision.price_before_tax;END IF;
IF valid THEN basis:=sources->'basis'||jsonb_build_object('overhead',pricing.result->'overhead','proposedBeforeTax',pricing.result->'proposedBeforeTax','reviewedPrice',reviewed);END IF;
payload:=jsonb_build_object('baseSources',sources,'sourcePins',pins,'currency',currency_value,'decision',CASE WHEN decision.id IS NOT NULL THEN public.canonical_estimate_decision_projection(decision) ELSE NULL END,'pricing',CASE WHEN pricing.id IS NOT NULL THEN public.canonical_pricing_plan_projection(pricing) ELSE NULL END,'pricingPin',CASE WHEN valid THEN jsonb_build_object('id',pricing.id,'revision',pricing.revision,'digest',pricing.digest) ELSE NULL END,'basis',basis);
RETURN payload||jsonb_build_object('digest',public.canonical_completion_digest(payload));
END $$;
CREATE FUNCTION public.canonical_pricing_policy_require(v JSONB,sources JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF sources->'basis' IS NULL OR sources->'basis'='null'::jsonb THEN RAISE EXCEPTION 'Current pricing required' USING ERRCODE='40001';END IF;
PERFORM public.canonical_pricing_require(jsonb_build_object('serviceKey',v->'serviceKey','lines',jsonb_build_array(jsonb_build_object('source',v->'source')),'overhead',jsonb_build_object('source',v->'source')),sources->'baseSources');END $$;
CREATE TABLE public.canonical_pricing_policy_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 pricing_id UUID NOT NULL,
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
 calculation_version TEXT NOT NULL DEFAULT 'estimate-pricing-policy-v1' CHECK(calculation_version='estimate-pricing-policy-v1'),
 expected_decision_revision BIGINT NOT NULL CHECK(expected_decision_revision BETWEEN 0 AND 10000),
 expected_decision_digest TEXT NOT NULL,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-pricing-policy-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,pricing_id) REFERENCES public.canonical_pricing_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_pricing_policy_plans(organization_id,estimate_id,id),
 CHECK((action='save' AND inputs IS NOT NULL) OR (action='withdraw' AND inputs IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_pricing_policy_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_pricing_policy_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_pricing_policy_plans FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_pricing_policy_immutable();

CREATE FUNCTION public.canonical_pricing_policy_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_estimate_decision_source(org,estimate) $$;
CREATE FUNCTION public.canonical_pricing_policy_projection(d public.canonical_pricing_policy_plans) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'pricingPin',(SELECT jsonb_build_object('id',p.id,'revision',p.revision,'digest',p.digest) FROM public.canonical_pricing_plans p WHERE p.id=d.pricing_id AND p.organization_id=d.organization_id AND p.estimate_id=d.estimate_id),'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'evidence',d.evidence,'evidenceDigest',d.evidence_digest,'result',d.result,'inputs',d.inputs,'calculationVersion',d.calculation_version,
 'expectedDecisionRevision',d.expected_decision_revision,'expectedDecisionDigest',d.expected_decision_digest,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_pricing_policy_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_pricing_policy_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_pricing_policy_plans WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_pricing_policy_projection(d) INTO current_value FROM public.canonical_pricing_policy_plans d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_pricing_policy_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_pricing_policy_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
CREATE FUNCTION public.canonical_pricing_policy_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; old public.canonical_pricing_policy_plans%ROWTYPE; current_row public.canonical_pricing_policy_plans%ROWTYPE;
 inserted public.canonical_pricing_policy_plans%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT; evidence_value JSONB; decision_row public.canonical_estimate_decisions%ROWTYPE; pricing_id_value UUID;
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
 source_value:=public.canonical_pricing_policy_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion','evidenceDigest','pricingPin']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('save','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-pricing-policy-v1' OR
  public.canonical_pricing_text(body->'reason',2000) IS NOT TRUE OR jsonb_typeof(body->'evidenceDigest') IS DISTINCT FROM 'string' OR (body->>'evidenceDigest')!~'^[0-9a-f]{64}$' OR (body->>'expectedRevision')::bigint>10000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(body->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body->>'expectedDecisionRevision')::bigint>10000 OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'expectedDecisionDigest') IS DISTINCT FROM 'string' OR current_currency NOT IN ('USD','CAD','EUR') THEN RAISE EXCEPTION 'Plan basis invalid' USING ERRCODE='22023'; END IF;
 IF body->>'action'='save' THEN IF jsonb_typeof(body->'inputs') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Pricing inputs invalid' USING ERRCODE='22023';END IF;
 ELSIF body->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Withdraw inputs invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':pricing-policy:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_pricing_policy_plans WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- Replays retain their historical result; current authority is required after all waits.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_pricing_policy_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_pricing_policy_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='travel_plan_stale'; END IF;
 SELECT * INTO decision_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedDecisionRevision')::bigint<>COALESCE(decision_row.revision,0) OR body->>'expectedDecisionDigest' IS DISTINCT FROM COALESCE(decision_row.digest,'none') THEN RAISE EXCEPTION 'Human decision changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'save') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>10000 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
IF body->>'action'='save' THEN evidence_value:=public.canonical_pricing_policy_sources(org,actor,role_value,session_value,estimate,NULL);IF body->>'evidenceDigest' IS DISTINCT FROM evidence_value->>'digest' THEN RAISE EXCEPTION 'Pricing source changed' USING ERRCODE='40001';END IF;IF body->'pricingPin' IS DISTINCT FROM evidence_value->'pricingPin' THEN RAISE EXCEPTION 'Pricing changed' USING ERRCODE='40001';END IF;pricing_id_value:=(evidence_value#>>'{pricingPin,id}')::uuid;PERFORM public.canonical_pricing_policy_require(body->'inputs',evidence_value);PERFORM public.canonical_pricing_policy_calculate(body->'inputs',current_currency,evidence_value->'basis');PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); END IF;
  IF body->>'action'='withdraw' THEN pricing_id_value:=current_row.pricing_id;END IF;
  SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_pricing_policy_plans(organization_id,estimate_id,revision,previous_id,pricing_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,evidence,result,evidence_digest,inputs,expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,pricing_id_value,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,evidence_value,CASE WHEN body->>'action'='save' THEN public.canonical_pricing_policy_calculate(body->'inputs',current_currency,evidence_value->'basis') ELSE NULL END,body->>'evidenceDigest',NULLIF(body->'inputs','null'::jsonb),(body->>'expectedDecisionRevision')::bigint,body->>'expectedDecisionDigest',current_currency,btrim(body->>'reason'),'estimate-pricing-policy-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_pricing_policy_projection(inserted),'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_pricing_policy_plans FROM PUBLIC;
DO $$ DECLARE fn RECORD;BEGIN FOR fn IN SELECT oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_pricing_policy_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn.identity||' FROM PUBLIC';END LOOP;END $$;
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost','equipment_ready','travel_plan','pricing_plan','pricing_policy'));
