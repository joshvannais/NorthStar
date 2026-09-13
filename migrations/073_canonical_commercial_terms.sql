-- Part6 Slice3: explicit commercial terms and owner approval, not tax-law coverage.
CREATE TABLE public.canonical_commercial_terms(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id),estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,pricing_id UUID NOT NULL,policy_id UUID,
 action TEXT NOT NULL CHECK(action IN('save','withdraw')),actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 actor_name TEXT NOT NULL,body JSONB NOT NULL,result JSONB,evidence JSONB,authority_pin JSONB NOT NULL,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,estimate_id,id),UNIQUE(organization_id,estimate_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_commercial_terms(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,pricing_id) REFERENCES public.canonical_pricing_plans(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,policy_id) REFERENCES public.canonical_pricing_policy_plans(organization_id,estimate_id,id),
 CHECK(body->>'confirmationVersion'='estimate-commercial-terms-v1'),CHECK((action='save' AND body->'inputs'<>'null'::jsonb AND result IS NOT NULL) OR(action='withdraw' AND body->'inputs'='null'::jsonb AND result IS NULL AND previous_id IS NOT NULL))
);
CREATE TABLE public.canonical_commercial_approvals(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,estimate_id UUID NOT NULL,terms_id UUID NOT NULL,decision_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 body JSONB NOT NULL,policy_comparison JSONB NOT NULL,authority_pin JSONB NOT NULL,decision_pin JSONB NOT NULL,previous_decision_basis JSONB NOT NULL,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,estimate_id,id),UNIQUE(decision_id),UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id,terms_id) REFERENCES public.canonical_commercial_terms(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,decision_id) REFERENCES public.canonical_estimate_decisions(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id)
);
CREATE FUNCTION public.canonical_commercial_percent(v JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n NUMERIC;BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION 'Commercial percentage invalid' USING ERRCODE='22023';END IF;n:=(v#>>'{}')::numeric*10000;IF n>1000000 THEN RAISE EXCEPTION 'Commercial percentage outside range' USING ERRCODE='22023';END IF;RETURN n;END $$;
CREATE FUNCTION public.canonical_commercial_signed(v JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF v='null'::jsonb THEN RETURN NULL;END IF;IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}')!~'^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR v='"-0.00"'::jsonb THEN RAISE EXCEPTION 'Commercial adjustment invalid' USING ERRCODE='22023';END IF;RETURN (v#>>'{}')::numeric*100;END $$;
CREATE FUNCTION public.canonical_commercial_allocate(total NUMERIC,rows_value JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE basis NUMERIC;out_value JSONB;
BEGIN
 IF total IS NULL OR total<0 OR total<>trunc(total) OR jsonb_typeof(rows_value) IS DISTINCT FROM 'array' OR jsonb_array_length(rows_value)=0 THEN RAISE EXCEPTION 'Allocation invalid' USING ERRCODE='22023';END IF;
 SELECT sum((v->>'value')::numeric) INTO basis FROM jsonb_array_elements(rows_value) v;
 IF basis=0 THEN IF total<>0 THEN RAISE EXCEPTION 'Positive allocation basis required' USING ERRCODE='22023';END IF;SELECT jsonb_agg(jsonb_build_object('lineId',v->>'lineId','amount',0) ORDER BY n) INTO out_value FROM jsonb_array_elements(rows_value) WITH ORDINALITY a(v,n);RETURN out_value;END IF;
 WITH parts AS (SELECT v->>'lineId' id,n,trunc(total*(v->>'value')::numeric/basis) amount,mod(total*(v->>'value')::numeric,basis) remainder FROM jsonb_array_elements(rows_value) WITH ORDINALITY a(v,n)), ranked AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,id COLLATE "C") position,sum(amount) OVER() allocated FROM parts)
 SELECT jsonb_agg(jsonb_build_object('lineId',id,'amount',amount+CASE WHEN position<=total-allocated THEN 1 ELSE 0 END) ORDER BY n) INTO out_value FROM ranked;
 RETURN out_value;
END $$;

-- Tenant declarations and public validation artifacts have separate authorities.
CREATE TABLE public.canonical_tax_profiles(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,inputs JSONB NOT NULL,body JSONB NOT NULL,
 actor_user_id UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_tax_profiles(organization_id,id)
);
CREATE TABLE public.canonical_tax_rule_versions(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),version TEXT NOT NULL CHECK(version='tax-preparation-v1'),
 rule_key TEXT NOT NULL,revision BIGINT NOT NULL CHECK(revision>0),content JSONB NOT NULL,
 digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(rule_key,revision),CHECK(content->>'validation'='validated'),CHECK(content->'simulated'='false'::jsonb)
);
-- No rule rows ship in this migration. Runtime owners cannot publish validation.
CREATE TABLE public.canonical_tax_preparation_jobs(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id),
 input_digest TEXT NOT NULL CHECK(input_digest~'^[a-f0-9]{64}$'),rules_digest TEXT NOT NULL CHECK(rules_digest~'^[a-f0-9]{64}$'),version TEXT NOT NULL CHECK(version='tax-preparation-v1'),inputs JSONB NOT NULL,
 as_of_date DATE NOT NULL DEFAULT ((clock_timestamp() AT TIME ZONE 'UTC')::date),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','done','exhausted')),attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token UUID,lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,input_digest,rules_digest,version,as_of_date),UNIQUE(organization_id,id),
 CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX canonical_tax_preparation_pending ON public.canonical_tax_preparation_jobs(state,created_at);
CREATE TABLE public.canonical_tax_preparation_results(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,job_id UUID NOT NULL,attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 input_digest TEXT NOT NULL,rules_digest TEXT NOT NULL,result JSONB NOT NULL,disposition TEXT NOT NULL CHECK(disposition IN('published','stale','expired','invalid')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),UNIQUE(job_id,attempt),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,job_id) REFERENCES public.canonical_tax_preparation_jobs(organization_id,id)
);
CREATE TABLE public.canonical_tax_preparation_current(
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id),result_id UUID NOT NULL,
 FOREIGN KEY(organization_id,result_id) REFERENCES public.canonical_tax_preparation_results(organization_id,id)
);
CREATE FUNCTION public.canonical_commercial_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Commercial history is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER canonical_commercial_terms_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_commercial_terms FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_commercial_immutable();
CREATE TRIGGER canonical_commercial_approvals_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_commercial_approvals FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_commercial_immutable();
CREATE TRIGGER canonical_tax_profiles_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_tax_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_commercial_immutable();
CREATE TRIGGER canonical_tax_rule_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_tax_rule_versions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_commercial_immutable();
CREATE TRIGGER canonical_tax_preparation_results_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_tax_preparation_results FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_commercial_immutable();

CREATE FUNCTION public.canonical_commercial_tax_profile_validate(v JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c JSONB;k TEXT;ids TEXT[]:='{}';
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['contexts']) IS NOT TRUE OR jsonb_typeof(v->'contexts') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'contexts')>12 THEN RAISE EXCEPTION 'Tax profile invalid' USING ERRCODE='22023';END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(v->'contexts') LOOP
  IF public.canonical_field_evidence_object_keys_exact(c,ARRAY['id','country','region','locality','jurisdiction','serviceKey','classification','registration','registrationReference','collectionBasis','exemptionReference','effectiveOn','endsOn','sourceNote','sourceReference','acknowledged']) IS NOT TRUE OR public.canonical_pricing_text(c->'id',80) IS NOT TRUE OR c->>'id'=ANY(ids) OR c->>'registration' IS NULL OR c->>'registration' NOT IN('unknown','registered','not_registered','exempt') OR jsonb_typeof(c->'acknowledged') IS DISTINCT FROM 'boolean' OR c->'effectiveOn'<>'null'::jsonb AND public.canonical_pricing_day(c->'effectiveOn') IS NOT TRUE OR c->'endsOn'<>'null'::jsonb AND public.canonical_pricing_day(c->'endsOn') IS NOT TRUE OR c->>'endsOn'<c->>'effectiveOn' THEN RAISE EXCEPTION 'Tax context invalid' USING ERRCODE='22023';END IF;
  ids:=array_append(ids,c->>'id');FOREACH k IN ARRAY ARRAY['country','region','locality','jurisdiction','serviceKey','classification','registrationReference','collectionBasis','exemptionReference','sourceNote','sourceReference'] LOOP IF public.canonical_pricing_text(c->k,CASE WHEN k='sourceNote' THEN 1000 ELSE 300 END,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Tax context text invalid' USING ERRCODE='22023';END IF;END LOOP;
  IF c->>'registration'='unknown' AND (c->>'registrationReference'<>'' OR c->>'exemptionReference'<>'') OR c->>'registration'<>'exempt' AND c->>'exemptionReference'<>'' THEN RAISE EXCEPTION 'Tax registration declaration contradicts reference' USING ERRCODE='22023';END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.canonical_commercial_tax_location(v JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object('street',COALESCE(v->>'street',''),'city',COALESCE(v->>'city',''),'state',COALESCE(v->>'state',''),'zip',COALESCE(v->>'zip',''),'country',COALESCE(v->>'country','')) $$;
CREATE FUNCTION public.canonical_commercial_tax_inputs(org UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw_value JSONB;declared JSONB;offices JSONB;services JSONB;
BEGIN
 SELECT raw_profile INTO raw_value FROM public.canonical_business_profiles WHERE organization_id=org AND is_active=TRUE;
 SELECT inputs INTO declared FROM public.canonical_tax_profiles WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v->>'id')||public.canonical_commercial_tax_location(v) ORDER BY v->>'id'),'[]'::jsonb) INTO offices FROM jsonb_array_elements(COALESCE(raw_value#>'{headquarters,additionalOffices}','[]'::jsonb)) v;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v->>'id','name',COALESCE(v->>'name',''),'description',COALESCE(v->>'description','')) ORDER BY v->>'id'),'[]'::jsonb) INTO services FROM jsonb_array_elements(COALESCE(raw_value->'services','[]'::jsonb)) v;
 RETURN jsonb_build_object('version','tax-preparation-v1','headquarters',public.canonical_commercial_tax_location(raw_value->'headquarters'),'offices',offices,'serviceArea',raw_value->'serviceArea','services',services,'declared',COALESCE(declared,'{"contexts":[]}'::jsonb));
END $$;
CREATE FUNCTION public.canonical_commercial_tax_rules() RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(content||jsonb_build_object('id',id,'digest',digest) ORDER BY rule_key),'[]'::jsonb) FROM (SELECT DISTINCT ON(rule_key) * FROM public.canonical_tax_rule_versions ORDER BY rule_key,revision DESC LIMIT 1000) r
$$;
CREATE FUNCTION public.canonical_commercial_tax_enqueue(org UUID) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE inputs_value JSONB;input_hash TEXT;rule_hash TEXT;job UUID;date_value DATE;
BEGIN
 -- Caller and every worker acquire organization before job locks.
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE='P0002';END IF;
 inputs_value:=public.canonical_commercial_tax_inputs(org);input_hash:=public.canonical_completion_digest(inputs_value);rule_hash:=public.canonical_completion_digest(public.canonical_commercial_tax_rules());date_value:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
 INSERT INTO public.canonical_tax_preparation_jobs(organization_id,input_digest,rules_digest,version,inputs,as_of_date) VALUES(org,input_hash,rule_hash,'tax-preparation-v1',inputs_value,date_value) ON CONFLICT(organization_id,input_digest,rules_digest,version,as_of_date) DO NOTHING RETURNING id INTO job;
 IF job IS NULL THEN SELECT id INTO job FROM public.canonical_tax_preparation_jobs WHERE organization_id=org AND input_digest=input_hash AND rules_digest=rule_hash AND version='tax-preparation-v1' AND as_of_date=date_value;END IF;
 RETURN job;
END $$;
CREATE FUNCTION public.canonical_commercial_profile_enqueue() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_hash TEXT;latest_hash TEXT;
BEGIN
 IF NEW.is_active THEN
  PERFORM 1 FROM public.organizations WHERE id=NEW.organization_id FOR UPDATE;
  current_hash:=public.canonical_completion_digest(public.canonical_commercial_tax_inputs(NEW.organization_id));
  SELECT input_digest INTO latest_hash FROM public.canonical_tax_preparation_jobs WHERE organization_id=NEW.organization_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF current_hash IS DISTINCT FROM latest_hash THEN PERFORM public.canonical_commercial_tax_enqueue(NEW.organization_id);END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER canonical_commercial_profile_enqueue AFTER INSERT ON public.canonical_business_profiles FOR EACH ROW EXECUTE FUNCTION public.canonical_commercial_profile_enqueue();
CREATE FUNCTION public.canonical_commercial_tax_evaluate(inputs_value JSONB,rules_value JSONB,as_of TEXT,simulated BOOLEAN DEFAULT FALSE) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE missing JSONB:='[]';coverage JSONB:='[]';gaps JSONB;c JSONB;r JSONB;matches JSONB;k TEXT;state_value TEXT;
BEGIN
 IF inputs_value->>'version' IS DISTINCT FROM 'tax-preparation-v1' OR public.canonical_pricing_day(to_jsonb(as_of)) IS NOT TRUE OR jsonb_typeof(rules_value) IS DISTINCT FROM 'array' OR jsonb_array_length(rules_value)>1000 THEN RAISE EXCEPTION 'Preparation input invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_commercial_tax_profile_validate(inputs_value->'declared');
 IF COALESCE(inputs_value#>>'{headquarters,country}','')='' OR COALESCE(inputs_value#>>'{headquarters,state}','')='' OR COALESCE(inputs_value#>>'{headquarters,city}','')='' THEN missing:=missing||'"operating_location"'::jsonb;END IF;
 IF jsonb_array_length(inputs_value->'services')=0 THEN missing:=missing||'"services"'::jsonb;END IF;
 IF jsonb_array_length(inputs_value#>'{declared,contexts}')=0 THEN missing:=missing||'"collection_context"'::jsonb;END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(inputs_value#>'{declared,contexts}') LOOP
  gaps:='[]';FOREACH k IN ARRAY ARRAY['country','region','jurisdiction','serviceKey','classification','collectionBasis','sourceNote','sourceReference'] LOOP IF btrim(c->>k)='' THEN gaps:=gaps||to_jsonb(k);END IF;END LOOP;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inputs_value->'services') s WHERE s->>'id'=c->>'serviceKey') THEN gaps:=gaps||'"supported_service"'::jsonb;END IF;
  IF c->>'registration'='unknown' THEN gaps:=gaps||'"registration"'::jsonb;END IF;
  IF c->>'registration'='registered' AND btrim(c->>'registrationReference')='' THEN gaps:=gaps||'"registration_reference"'::jsonb;END IF;
  IF c->>'registration'='exempt' AND btrim(c->>'exemptionReference')='' THEN gaps:=gaps||'"exemption_reference"'::jsonb;END IF;
  IF c->'acknowledged'<>'true'::jsonb THEN gaps:=gaps||'"acknowledgment"'::jsonb;END IF;
  IF c->>'effectiveOn' IS NULL THEN gaps:=gaps||'"effective_date"'::jsonb;END IF;
  IF as_of<c->>'effectiveOn' OR as_of>c->>'endsOn' THEN gaps:=gaps||'"applicability_date"'::jsonb;END IF;
  matches:='[]';IF jsonb_array_length(gaps)=0 THEN FOR r IN SELECT * FROM jsonb_array_elements(rules_value) LOOP
   IF r->>'validation'='validated' AND r->'simulated'=to_jsonb(simulated) AND r->>'version'='tax-preparation-v1' AND r->>'country'=c->>'country' AND r->>'region'=c->>'region' AND r->>'locality'=c->>'locality' AND r->>'jurisdiction'=c->>'jurisdiction' AND r->>'serviceKey'=c->>'serviceKey' AND r->>'classification'=c->>'classification' AND r->>'registration'=c->>'registration' AND r->>'collectionBasis'=c->>'collectionBasis' AND public.canonical_pricing_day(r->'effectiveOn') IS TRUE AND public.canonical_pricing_day(r->'endsOn') IS TRUE AND as_of>=r->>'effectiveOn' AND as_of<=r->>'endsOn' AND jsonb_typeof(r->'id')='string' AND r->>'digest'~'^[a-f0-9]{64}$' AND r->'active'='true'::jsonb THEN matches:=matches||jsonb_build_array(r);END IF;
  END LOOP;END IF;
  coverage:=coverage||jsonb_build_array(jsonb_build_object('contextId',c->>'id','state',CASE WHEN jsonb_array_length(gaps)>0 THEN 'missing_inputs' WHEN jsonb_array_length(matches)=1 THEN 'matched' WHEN jsonb_array_length(matches)>1 THEN 'conflicting_coverage' ELSE 'unsupported' END,'missing',gaps,'rule',CASE WHEN jsonb_array_length(matches)=1 THEN jsonb_build_object('id',matches#>>'{0,id}','digest',matches#>>'{0,digest}') END));
 END LOOP;
 state_value:=CASE WHEN jsonb_array_length(missing)>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(coverage) element WHERE element->>'state'='missing_inputs') THEN 'missing_inputs' WHEN jsonb_array_length(coverage)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coverage) element WHERE element->>'state'<>'matched') THEN 'matched' ELSE 'unsupported' END;
 RETURN jsonb_build_object('version','tax-preparation-v1','asOfDate',as_of,'inputDigest',public.canonical_completion_digest(inputs_value),'simulated',simulated,'state',state_value,'missing',missing,'coverage',coverage);
END $$;
CREATE FUNCTION public.canonical_commercial_tax_claim() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate RECORD;j public.canonical_tax_preparation_jobs%ROWTYPE;token UUID;now_value TIMESTAMPTZ;
BEGIN
 -- Discovery is not authority. Lock the organization before the chosen job.
 FOR candidate IN SELECT id,organization_id FROM public.canonical_tax_preparation_jobs WHERE state='pending' OR state='leased' AND lease_until<clock_timestamp() ORDER BY created_at LIMIT 5 LOOP
  PERFORM 1 FROM public.organizations WHERE id=candidate.organization_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  SELECT * INTO j FROM public.canonical_tax_preparation_jobs WHERE id=candidate.id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  now_value:=clock_timestamp();IF j.state NOT IN('pending','leased') OR j.state='leased' AND j.lease_until>=now_value THEN CONTINUE;END IF;
  IF j.state='leased' THEN INSERT INTO public.canonical_tax_preparation_results(organization_id,job_id,attempt,input_digest,rules_digest,result,disposition) VALUES(j.organization_id,j.id,j.attempts,j.input_digest,j.rules_digest,'{}','expired') ON CONFLICT(job_id,attempt) DO NOTHING;END IF;
  IF j.attempts>=3 THEN UPDATE public.canonical_tax_preparation_jobs SET state='exhausted',lease_token=NULL,lease_until=NULL WHERE id=j.id;CONTINUE;END IF;
  token:=gen_random_uuid();UPDATE public.canonical_tax_preparation_jobs SET state='leased',attempts=attempts+1,lease_token=token,lease_until=now_value+INTERVAL '30 seconds' WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('id',j.id,'organizationId',j.organization_id,'attempt',j.attempts,'leaseToken',j.lease_token,'leaseUntil',j.lease_until,'inputs',j.inputs,'inputDigest',j.input_digest,'rulesDigest',j.rules_digest,'rules',public.canonical_commercial_tax_rules(),'asOfDate',to_char(now_value AT TIME ZONE 'UTC','YYYY-MM-DD'));
 END LOOP;RETURN NULL;
END $$;
CREATE FUNCTION public.canonical_commercial_tax_finish(job UUID,token UUID,calculated JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org UUID;j public.canonical_tax_preparation_jobs%ROWTYPE;inputs_value JSONB;rules_value JSONB;result_value JSONB;disposition_value TEXT;result_id UUID;now_value TIMESTAMPTZ;
BEGIN
 SELECT organization_id INTO org FROM public.canonical_tax_preparation_jobs WHERE id=job;IF org IS NULL THEN RAISE EXCEPTION 'Preparation unavailable' USING ERRCODE='P0002';END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO j FROM public.canonical_tax_preparation_jobs WHERE id=job AND organization_id=org FOR UPDATE;
 IF j.state<>'leased' OR j.lease_token IS DISTINCT FROM token THEN RAISE EXCEPTION 'Preparation claim changed' USING ERRCODE='40001';END IF;
 inputs_value:=public.canonical_commercial_tax_inputs(org);rules_value:=public.canonical_commercial_tax_rules();now_value:=clock_timestamp();
 IF j.lease_until<=now_value THEN disposition_value:='expired';result_value:='{}';
 ELSIF j.input_digest<>public.canonical_completion_digest(inputs_value) OR j.rules_digest<>public.canonical_completion_digest(rules_value) THEN disposition_value:='stale';result_value:='{}';
 ELSE result_value:=public.canonical_commercial_tax_evaluate(inputs_value,rules_value,to_char(now_value AT TIME ZONE 'UTC','YYYY-MM-DD'),FALSE);disposition_value:=CASE WHEN result_value=calculated THEN 'published' ELSE 'invalid' END;END IF;
 INSERT INTO public.canonical_tax_preparation_results(organization_id,job_id,attempt,input_digest,rules_digest,result,disposition) VALUES(org,j.id,j.attempts,j.input_digest,j.rules_digest,result_value,disposition_value) RETURNING id INTO result_id;
 UPDATE public.canonical_tax_preparation_jobs SET state=CASE WHEN disposition_value IN('invalid','expired') AND attempts<3 THEN 'pending' WHEN disposition_value IN('invalid','expired') THEN 'exhausted' ELSE 'done' END,lease_token=NULL,lease_until=NULL WHERE id=j.id;
 IF disposition_value='published' THEN INSERT INTO public.canonical_tax_preparation_current(organization_id,result_id) VALUES(org,result_id) ON CONFLICT(organization_id) DO UPDATE SET result_id=EXCLUDED.result_id;END IF;
 RETURN jsonb_build_object('id',result_id,'disposition',disposition_value);
END $$;
CREATE FUNCTION public.canonical_commercial_tax_backfill(limit_value INTEGER DEFAULT 5) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org UUID;n INTEGER:=0;
BEGIN
 IF limit_value NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Preparation batch outside range' USING ERRCODE='22023';END IF;
 FOR org IN SELECT o.id FROM public.organizations o WHERE EXISTS(SELECT 1 FROM public.canonical_business_profiles p WHERE p.organization_id=o.id AND p.is_active) AND NOT EXISTS(SELECT 1 FROM public.canonical_tax_preparation_jobs j WHERE j.organization_id=o.id AND j.version='tax-preparation-v1' AND j.as_of_date=(clock_timestamp() AT TIME ZONE 'UTC')::date AND j.input_digest=public.canonical_completion_digest(public.canonical_commercial_tax_inputs(o.id)) AND j.rules_digest=public.canonical_completion_digest(public.canonical_commercial_tax_rules())) ORDER BY o.id LIMIT limit_value FOR UPDATE OF o SKIP LOCKED LOOP PERFORM public.canonical_commercial_tax_enqueue(org);n:=n+1;END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION public.canonical_commercial_tax_source(g JSONB,context_value JSONB,transaction_day TEXT) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s JSONB:=g->'source';r JSONB;field TEXT;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(s,ARRAY['kind','note','reference','effectiveOn','endsOn','jurisdiction','location','serviceKey','collectionBasis','acknowledged','ruleId','ruleDigest']) IS NOT TRUE OR s->>'kind' IS NULL OR s->>'kind' NOT IN ('unknown','owner_recorded','validated') OR jsonb_typeof(s->'acknowledged') IS DISTINCT FROM 'boolean' OR s->'effectiveOn'<>'null'::jsonb AND public.canonical_pricing_day(s->'effectiveOn') IS NOT TRUE OR s->'endsOn'<>'null'::jsonb AND public.canonical_pricing_day(s->'endsOn') IS NOT TRUE OR s->>'endsOn'<s->>'effectiveOn' THEN RAISE EXCEPTION 'Tax source invalid' USING ERRCODE='22023';END IF;
 FOREACH field IN ARRAY ARRAY['note','reference','jurisdiction','location','serviceKey','collectionBasis'] LOOP IF public.canonical_pricing_text(s->field,CASE field WHEN 'note' THEN 1000 WHEN 'collectionBasis' THEN 1000 WHEN 'serviceKey' THEN 100 WHEN 'jurisdiction' THEN 200 ELSE 300 END,TRUE) IS NOT TRUE THEN RAISE EXCEPTION 'Tax source text invalid' USING ERRCODE='22023';END IF;END LOOP;
 IF s->>'kind'<>'validated' AND (s->'ruleId'<>'null'::jsonb OR s->'ruleDigest'<>'null'::jsonb) THEN RAISE EXCEPTION 'Owner declaration cannot claim validated rule' USING ERRCODE='22023';END IF;
 IF s->>'kind'='unknown' THEN IF g->>'treatment'<>'unknown' OR g->'ratePercent'<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown treatment has rate' USING ERRCODE='22023';END IF;RETURN FALSE;END IF;
 IF g->>'treatment'='unknown' OR s->'acknowledged'<>'true'::jsonb OR btrim(s->>'note')='' OR btrim(s->>'reference')='' OR btrim(s->>'jurisdiction')='' OR btrim(s->>'location')='' OR btrim(s->>'collectionBasis')='' OR s->>'serviceKey' IS DISTINCT FROM context_value->>'serviceKey' OR s->>'effectiveOn' IS NULL OR transaction_day IS NULL OR transaction_day<s->>'effectiveOn' OR transaction_day>s->>'endsOn' THEN RETURN FALSE;END IF;
 IF s->>'kind'='validated' THEN
  SELECT v INTO r FROM jsonb_array_elements(COALESCE(context_value->'validatedRules','[]'::jsonb)) v WHERE v->>'id'=s->>'ruleId' AND v->>'digest'=s->>'ruleDigest' LIMIT 1;
  IF r IS NULL OR r->'simulated' IS DISTINCT FROM context_value->'simulated' OR r->>'jurisdiction' IS DISTINCT FROM s->>'jurisdiction' OR r->>'serviceKey' IS DISTINCT FROM s->>'serviceKey' OR r->>'treatment' IS DISTINCT FROM g->>'treatment' OR r->>'ratePercent' IS DISTINCT FROM g->>'ratePercent' OR r->>'behavior' IS DISTINCT FROM g->>'behavior' OR transaction_day<r->>'effectiveOn' OR transaction_day>r->>'endsOn' THEN RAISE EXCEPTION 'Validated tax source changed' USING ERRCODE='40001';END IF;
 END IF;RETURN TRUE;
END $$;
CREATE FUNCTION public.canonical_commercial_payments(p JSONB,total NUMERIC) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows_value JSONB:='[]';s JSONB;ids TEXT[]:='{}';n NUMERIC;sum_value NUMERIC:=0;allocated NUMERIC:=0;deposits INT:=0;balances INT:=0;stage_count INT;mode_value TEXT:=p->>'mode';
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(p,ARRAY['mode','balanceId','stages']) IS NOT TRUE OR mode_value IS NULL OR mode_value NOT IN ('none','amount','share') OR jsonb_typeof(p->'stages') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'stages')>12 THEN RAISE EXCEPTION 'Payment schedule invalid' USING ERRCODE='22023';END IF;
 IF mode_value='none' THEN IF p->'balanceId'<>'null'::jsonb OR jsonb_array_length(p->'stages')<>0 THEN RAISE EXCEPTION 'Payment stages unexpected' USING ERRCODE='22023';END IF;RETURN rows_value;END IF;
 FOR s IN SELECT * FROM jsonb_array_elements(p->'stages') LOOP
  IF public.canonical_field_evidence_object_keys_exact(s,ARRAY['stageId','label','kind','value']) IS NOT TRUE OR public.canonical_pricing_text(s->'stageId',80) IS NOT TRUE OR s->>'stageId'=ANY(ids) OR public.canonical_pricing_text(s->'label',160) IS NOT TRUE OR s->>'kind' IS NULL OR s->>'kind' NOT IN ('deposit','milestone','balance') THEN RAISE EXCEPTION 'Payment stage invalid' USING ERRCODE='22023';END IF;
  ids:=array_append(ids,s->>'stageId');IF s->>'kind'='deposit' THEN deposits:=deposits+1;END IF;IF s->>'kind'='balance' THEN balances:=balances+1;END IF;
  n:=CASE WHEN mode_value='amount' THEN public.canonical_pricing_money(s->'value') ELSE public.canonical_commercial_percent(s->'value') END;IF n IS NULL THEN RAISE EXCEPTION 'Payment amount missing' USING ERRCODE='22023';END IF;sum_value:=sum_value+n;
  n:=CASE WHEN total IS NULL THEN NULL WHEN mode_value='amount' THEN n ELSE trunc(total*n/1000000) END;allocated:=allocated+COALESCE(n,0);
  rows_value:=rows_value||jsonb_build_array(jsonb_build_object('stageId',s->>'stageId','label',s->>'label','kind',s->>'kind','amount',public.canonical_pricing_decimal(n)));
 END LOOP;
 stage_count:=jsonb_array_length(rows_value);
 IF stage_count=0 OR deposits>1 OR balances<>1 OR rows_value->-1->>'kind'<>'balance' OR rows_value->-1->>'stageId' IS DISTINCT FROM p->>'balanceId' THEN RAISE EXCEPTION 'Final balance required' USING ERRCODE='22023';END IF;
 IF mode_value='share' AND sum_value<>1000000 OR mode_value='amount' AND total IS NOT NULL AND sum_value<>total THEN RAISE EXCEPTION 'Payment total does not reconcile' USING ERRCODE='22023';END IF;
 IF mode_value='share' AND total IS NOT NULL THEN rows_value:=jsonb_set(rows_value,ARRAY[(stage_count-1)::text,'amount'],to_jsonb(public.canonical_pricing_decimal(public.canonical_pricing_money(rows_value->-1->'amount')+total-allocated)));END IF;
 RETURN rows_value;
END $$;
CREATE FUNCTION public.canonical_commercial_calculate(v JSONB,currency_value TEXT,context_value JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows_value JSONB:='[]';groups_value JSONB:='[]';adjustments_value JSONB:='[]';tax_map JSONB:='{}';unknowns JSONB:='[]';ids TEXT[]:='{}';group_ids TEXT[]:='{}';adjustment_ids TEXT[]:='{}';discounted TEXT[]:='{}';l JSONB;g JSONB;a JSONB;f JSONB;r JSONB;part JSONB;eligible JSONB;parts JSONB;allocations JSONB;n NUMERIC;basis NUMERIC;tax_value NUMERIC;net_value NUMERIC;payable NUMERIC;net_sum NUMERIC:=0;tax_sum NUMERIC:=0;total_sum NUMERIC:=0;idx INT;phase INT:=0;next_phase INT;has_order BOOLEAN:=FALSE;incomplete BOOLEAN:=FALSE;complete BOOLEAN;decrease BOOLEAN;behavior_count INT;line_id TEXT;tax_authority TEXT;
BEGIN
 IF currency_value IS NULL OR currency_value NOT IN ('USD','CAD','EUR') OR public.canonical_field_evidence_object_keys_exact(v,ARRAY['transactionDate','adjustments','fees','taxGroups','payments']) IS NOT TRUE OR v->'transactionDate'<>'null'::jsonb AND public.canonical_pricing_day(v->'transactionDate') IS NOT TRUE OR jsonb_typeof(v->'adjustments') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'adjustments')>12 OR jsonb_typeof(v->'fees') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'taxGroups') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'taxGroups')>12 OR jsonb_typeof(context_value#>'{pricing,lines}') IS DISTINCT FROM 'array' OR jsonb_array_length(context_value#>'{pricing,lines}')=0 THEN RAISE EXCEPTION 'Commercial inputs invalid' USING ERRCODE='22023';END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(context_value#>'{pricing,lines}') LOOP
  IF l->>'includedIn' IS NOT NULL THEN CONTINUE;END IF;IF l->>'lineId'=ANY(ids) THEN RAISE EXCEPTION 'Duplicate charge identity' USING ERRCODE='22023';END IF;ids:=array_append(ids,l->>'lineId');n:=public.canonical_pricing_money(l->'amount');incomplete:=incomplete OR n IS NULL;rows_value:=rows_value||jsonb_build_array(jsonb_build_object('lineId',l->>'lineId','label',l->>'label','kind','charge','original',n,'value',n));
 END LOOP;
 IF jsonb_array_length(rows_value)+jsonb_array_length(v->'fees')>12 THEN RAISE EXCEPTION 'Commercial line limit' USING ERRCODE='22023';END IF;
 FOR g IN SELECT * FROM jsonb_array_elements(v->'taxGroups') LOOP
  IF public.canonical_field_evidence_object_keys_exact(g,ARRAY['groupId','label','lineIds','behavior','treatment','ratePercent','source']) IS NOT TRUE OR public.canonical_pricing_text(g->'groupId',80) IS NOT TRUE OR g->>'groupId'=ANY(group_ids) OR public.canonical_pricing_text(g->'label',160) IS NOT TRUE OR jsonb_typeof(g->'lineIds') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'lineIds') NOT BETWEEN 1 AND 12 OR g->>'behavior' IS NULL OR g->>'behavior' NOT IN ('exclusive','inclusive') OR g->>'treatment' IS NULL OR g->>'treatment' NOT IN ('unknown','taxable','zero_rate','exempt') THEN RAISE EXCEPTION 'Tax group invalid' USING ERRCODE='22023';END IF;
  group_ids:=array_append(group_ids,g->>'groupId');FOR l IN SELECT * FROM jsonb_array_elements(g->'lineIds') LOOP IF public.canonical_pricing_text(l,80) IS NOT TRUE OR tax_map ? (l#>>'{}') THEN RAISE EXCEPTION 'Tax groups overlap' USING ERRCODE='22023';END IF;tax_map:=tax_map||jsonb_build_object(l#>>'{}',g);END LOOP;
  IF g->>'treatment'='unknown' THEN IF g->'ratePercent'<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown rate invalid' USING ERRCODE='22023';END IF;ELSE n:=public.canonical_commercial_percent(g->'ratePercent');IF g->>'treatment' IN ('zero_rate','exempt') AND n<>0 THEN RAISE EXCEPTION 'Zero treatment invalid' USING ERRCODE='22023';END IF;END IF;
 END LOOP;
 FOR a IN SELECT * FROM jsonb_array_elements(v->'adjustments') LOOP
  IF public.canonical_field_evidence_object_keys_exact(a,ARRAY['adjustmentId','label','kind','method','amount','percent','lineIds','reason']) IS NOT TRUE OR public.canonical_pricing_text(a->'adjustmentId',80) IS NOT TRUE OR a->>'adjustmentId'=ANY(adjustment_ids) OR public.canonical_pricing_text(a->'label',160) IS NOT TRUE OR public.canonical_pricing_text(a->'reason',1000) IS NOT TRUE OR a->>'kind' IS NULL OR a->>'kind' NOT IN ('line_discount','order_discount','adjustment') OR a->>'method' IS NULL OR a->>'method' NOT IN ('fixed','percent') OR jsonb_typeof(a->'lineIds') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'lineIds')=0 OR (SELECT count(DISTINCT z) FROM jsonb_array_elements(a->'lineIds') z)<>jsonb_array_length(a->'lineIds') THEN RAISE EXCEPTION 'Adjustment invalid' USING ERRCODE='22023';END IF;
  adjustment_ids:=array_append(adjustment_ids,a->>'adjustmentId');next_phase:=CASE a->>'kind' WHEN 'line_discount' THEN 0 WHEN 'order_discount' THEN 1 ELSE 2 END;IF next_phase<phase THEN RAISE EXCEPTION 'Adjustment order invalid' USING ERRCODE='22023';END IF;phase:=next_phase;
  IF a->>'kind'='order_discount' THEN IF has_order THEN RAISE EXCEPTION 'One order discount supported' USING ERRCODE='22023';END IF;has_order:=TRUE;END IF;
  IF a->>'kind'='line_discount' THEN IF jsonb_array_length(a->'lineIds')<>1 OR a#>>'{lineIds,0}'=ANY(discounted) THEN RAISE EXCEPTION 'One line discount per charge' USING ERRCODE='22023';END IF;discounted:=array_append(discounted,a#>>'{lineIds,0}');END IF;
  eligible:='[]';FOR line_id IN SELECT jsonb_array_elements_text(a->'lineIds') LOOP SELECT x INTO r FROM jsonb_array_elements(rows_value) x WHERE x->>'lineId'=line_id;IF r IS NULL THEN RAISE EXCEPTION 'Adjustment charge unavailable' USING ERRCODE='22023';END IF;eligible:=eligible||jsonb_build_array(r);END LOOP;
  SELECT count(DISTINCT COALESCE(tax_map->(x->>'lineId')->>'behavior','unknown')) INTO behavior_count FROM jsonb_array_elements(eligible) x;IF behavior_count>1 THEN RAISE EXCEPTION 'Mixed inclusive adjustment unsupported' USING ERRCODE='22023';END IF;
  SELECT CASE WHEN bool_or(x->'value'='null'::jsonb) THEN NULL ELSE sum((x->>'value')::numeric) END INTO basis FROM jsonb_array_elements(eligible) x;
  IF a->>'method'='fixed' THEN IF a->'percent'<>'null'::jsonb THEN RAISE EXCEPTION 'Adjustment method invalid' USING ERRCODE='22023';END IF;n:=CASE WHEN a->>'kind'='adjustment' THEN public.canonical_commercial_signed(a->'amount') ELSE public.canonical_pricing_money(a->'amount') END;
  ELSE IF a->'amount'<>'null'::jsonb OR a->>'kind'='adjustment' THEN RAISE EXCEPTION 'Signed adjustment requires fixed amount' USING ERRCODE='22023';END IF;n:=round(basis*public.canonical_commercial_percent(a->'percent')/1000000);END IF;
  IF n IS NULL OR basis IS NULL THEN incomplete:=TRUE;adjustments_value:=adjustments_value||jsonb_build_array(jsonb_build_object('adjustmentId',a->>'adjustmentId','label',a->>'label','reason',a->>'reason','amount',NULL,'allocations','[]'::jsonb));CONTINUE;END IF;
  decrease:=a->>'kind'<>'adjustment' OR n<0;n:=abs(n);IF decrease AND n>basis THEN RAISE EXCEPTION 'Adjustment exceeds eligible base' USING ERRCODE='22023';END IF;
  parts:=public.canonical_commercial_allocate(n,eligible);allocations:='[]';FOR part IN SELECT * FROM jsonb_array_elements(parts) LOOP
   SELECT (o-1)::int INTO idx FROM jsonb_array_elements(rows_value) WITH ORDINALITY z(x,o) WHERE x->>'lineId'=part->>'lineId';basis:=(rows_value->idx->>'value')::numeric+CASE WHEN decrease THEN -(part->>'amount')::numeric ELSE (part->>'amount')::numeric END;PERFORM public.canonical_pricing_decimal(basis);rows_value:=jsonb_set(rows_value,ARRAY[idx::text,'value'],to_jsonb(basis));
   allocations:=allocations||jsonb_build_array(jsonb_build_object('lineId',part->>'lineId','amount',CASE WHEN decrease AND (part->>'amount')::numeric<>0 THEN '-' ELSE '' END||public.canonical_pricing_decimal((part->>'amount')::numeric)));
  END LOOP;
  adjustments_value:=adjustments_value||jsonb_build_array(jsonb_build_object('adjustmentId',a->>'adjustmentId','label',a->>'label','reason',a->>'reason','amount',CASE WHEN decrease AND n<>0 THEN '-' ELSE '' END||public.canonical_pricing_decimal(n),'allocations',allocations));
 END LOOP;
 FOR f IN SELECT * FROM jsonb_array_elements(v->'fees') LOOP
  IF public.canonical_field_evidence_object_keys_exact(f,ARRAY['lineId','label','amount','reason']) IS NOT TRUE OR public.canonical_pricing_text(f->'lineId',80) IS NOT TRUE OR f->>'lineId'=ANY(ids) OR public.canonical_pricing_text(f->'label',160) IS NOT TRUE OR public.canonical_pricing_text(f->'reason',1000) IS NOT TRUE THEN RAISE EXCEPTION 'Fee invalid' USING ERRCODE='22023';END IF;
  ids:=array_append(ids,f->>'lineId');n:=public.canonical_pricing_money(f->'amount');incomplete:=incomplete OR n IS NULL;rows_value:=rows_value||jsonb_build_array(jsonb_build_object('lineId',f->>'lineId','label',f->>'label','kind','fee','original',n,'value',n));
 END LOOP;
 FOR line_id IN SELECT jsonb_object_keys(tax_map) LOOP IF NOT line_id=ANY(ids) THEN RAISE EXCEPTION 'Taxed charge unavailable' USING ERRCODE='22023';END IF;END LOOP;
 FOREACH line_id IN ARRAY ids LOOP IF NOT tax_map ? line_id THEN unknowns:=unknowns||to_jsonb(line_id);END IF;END LOOP;
 FOR g IN SELECT * FROM jsonb_array_elements(v->'taxGroups') LOOP
  IF public.canonical_commercial_tax_source(g,context_value,v->>'transactionDate') IS NOT TRUE THEN unknowns:=unknowns||to_jsonb(g->>'groupId');END IF;
  SELECT jsonb_agg(x ORDER BY o),CASE WHEN bool_or(x->'value'='null'::jsonb) THEN NULL ELSE sum((x->>'value')::numeric) END INTO eligible,basis FROM jsonb_array_elements_text(g->'lineIds') WITH ORDINALITY z(id,o) JOIN LATERAL (SELECT x FROM jsonb_array_elements(rows_value) x WHERE x->>'lineId'=z.id) q ON TRUE;
  IF basis IS NULL OR unknowns ? (g->>'groupId') THEN groups_value:=groups_value||jsonb_build_array(jsonb_build_object('groupId',g->>'groupId','label',g->>'label','behavior',g->>'behavior','treatment',g->>'treatment','base',public.canonical_pricing_decimal(basis),'net',NULL,'tax',NULL,'total',NULL,'allocations','[]'::jsonb));CONTINUE;END IF;
  n:=public.canonical_commercial_percent(g->'ratePercent');net_value:=CASE WHEN g->>'behavior'='inclusive' THEN round(basis*1000000/(1000000+n)) ELSE basis END;tax_value:=CASE WHEN g->>'behavior'='inclusive' THEN basis-net_value ELSE round(basis*n/1000000) END;payable:=net_value+tax_value;PERFORM public.canonical_pricing_decimal(payable);
  parts:=public.canonical_commercial_allocate(tax_value,eligible);SELECT jsonb_agg(jsonb_build_object('lineId',x->>'lineId','tax',public.canonical_pricing_decimal((x->>'amount')::numeric)) ORDER BY o) INTO allocations FROM jsonb_array_elements(parts) WITH ORDINALITY z(x,o);
  groups_value:=groups_value||jsonb_build_array(jsonb_build_object('groupId',g->>'groupId','label',g->>'label','behavior',g->>'behavior','treatment',g->>'treatment','base',public.canonical_pricing_decimal(basis),'net',public.canonical_pricing_decimal(net_value),'tax',public.canonical_pricing_decimal(tax_value),'total',public.canonical_pricing_decimal(payable),'allocations',allocations));net_sum:=net_sum+net_value;tax_sum:=tax_sum+tax_value;total_sum:=total_sum+payable;
 END LOOP;
 complete:=NOT incomplete AND jsonb_array_length(unknowns)=0 AND jsonb_array_length(groups_value)>0;PERFORM public.canonical_pricing_decimal(net_sum);PERFORM public.canonical_pricing_decimal(tax_sum);PERFORM public.canonical_pricing_decimal(total_sum);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('lineId',x->>'lineId','label',x->>'label','kind',x->>'kind','originalAmount',public.canonical_pricing_decimal((x->>'original')::numeric),'adjustedAmount',public.canonical_pricing_decimal((x->>'value')::numeric)) ORDER BY o),'[]'::jsonb) INTO rows_value FROM jsonb_array_elements(rows_value) WITH ORDINALITY z(x,o);
 tax_authority:=CASE WHEN NOT complete THEN 'unknown' WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'taxGroups') x WHERE x#>>'{source,kind}'<>'validated') THEN 'validated' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(v->'taxGroups') x WHERE x#>>'{source,kind}'='owner_recorded') THEN 'owner_recorded' ELSE 'unknown' END;
 RETURN jsonb_build_object('calculationVersion','estimate-commercial-terms-v1','currency',currency_value,'lines',rows_value,'adjustments',adjustments_value,'taxGroups',groups_value,'netBeforeTax',CASE WHEN complete THEN public.canonical_pricing_decimal(net_sum) END,'tax',CASE WHEN complete THEN public.canonical_pricing_decimal(tax_sum) END,'total',CASE WHEN complete THEN public.canonical_pricing_decimal(total_sum) END,'complete',complete,'unresolvedTax',unknowns,'payments',public.canonical_commercial_payments(v->'payments',CASE WHEN complete THEN total_sum END),'taxAuthority',tax_authority);
END $$;

-- Exact installed059 successor: one existing travel-fence call, before estimate lock.
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
 PERFORM public.canonical_travel_fence(org,estimate);
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

CREATE FUNCTION public.canonical_commercial_pin(v JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN v->>'id' IS NOT NULL THEN jsonb_build_object('id',v->>'id','revision',v->'revision','digest',v->>'digest') END $$;
CREATE FUNCTION public.canonical_commercial_projection(t public.canonical_commercial_terms) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT t.body||jsonb_build_object('id',t.id,'revision',t.revision,'previousId',t.previous_id,'digest',t.digest,'result',t.result,'evidence',t.evidence,'authorityPin',t.authority_pin,'actorName',t.actor_name,'createdAt',t.created_at)
$$;
CREATE FUNCTION public.canonical_commercial_binding_projection(a public.canonical_commercial_approvals) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'digest',a.digest,'termsPin',a.body->'termsPin','decisionPin',a.decision_pin,'previousDecisionBasis',a.previous_decision_basis,'authorityPin',a.authority_pin,'scopeSummary',a.body->>'scopeSummary','reason',a.body->>'reason','exceptions',a.body->'exceptions','policyComparison',a.policy_comparison,'createdAt',a.created_at)
$$;
CREATE FUNCTION public.canonical_commercial_authority_pin(s JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('sourcePins',s->'sourcePins','pricingPin',s->'pricingPin','policyPin',s->'policyPin','profilePin',s->'profilePin','taxProfilePin',s->'taxProfilePin','rulePins',s->'rulePins','sourceDigest',s->>'sourceDigest','currency',s->>'currency')
$$;
CREATE FUNCTION public.canonical_commercial_sources(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,selected BIGINT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior JSONB;base JSONB;policy_row public.canonical_pricing_policy_plans%ROWTYPE;tax_row public.canonical_tax_profiles%ROWTYPE;policy_valid BOOLEAN:=FALSE;rules_value JSONB;rule_pins JSONB;payload JSONB;rules_eligible JSONB;decision_value JSONB;tax_setup JSONB;
BEGIN
 prior:=public.canonical_pricing_policy_sources(org,actor,role_value,session_value,estimate,selected);base:=prior->'baseSources';decision_value:=prior->'decision';
 SELECT * INTO policy_row FROM public.canonical_pricing_policy_plans WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF policy_row.action='save' AND policy_row.source_pins=prior->'sourcePins' AND policy_row.pricing_id::text=prior#>>'{pricingPin,id}' AND policy_row.currency=prior->>'currency' THEN BEGIN PERFORM public.canonical_pricing_policy_require(policy_row.inputs,prior);policy_valid:=TRUE;EXCEPTION WHEN serialization_failure THEN policy_valid:=FALSE;END;END IF;
 SELECT * INTO tax_row FROM public.canonical_tax_profiles WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 rules_value:=public.canonical_commercial_tax_rules();
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v->>'id','digest',v->>'digest') ORDER BY v->>'id'),'[]'::jsonb) INTO rule_pins FROM jsonb_array_elements(rules_value) v;
 -- Real rules are not shipped. Only active source-controlled artifacts can match.
 tax_setup:=public.canonical_commercial_tax_read(org,actor,role_value,session_value);
 SELECT COALESCE(jsonb_agg(v ORDER BY v->>'id'),'[]'::jsonb) INTO rules_eligible FROM jsonb_array_elements(rules_value) v WHERE v->'active'='true'::jsonb AND v->'simulated'='false'::jsonb AND tax_setup->'resultCurrent'='true'::jsonb AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(tax_setup#>'{result,coverage}','[]'::jsonb)) c WHERE c->>'state'='matched' AND c#>>'{rule,id}'=v->>'id' AND c#>>'{rule,digest}'=v->>'digest');
 payload:=jsonb_build_object('baseSources',base,'sourcePins',prior->'sourcePins','currency',prior->>'currency','asOfDate',base->>'asOfDate','serviceKey',base->>'serviceKey','simulated',FALSE,
  'pricing',prior->'pricing','pricingPin',prior->'pricingPin','pricingCurrent',prior->'pricingPin' IS NOT NULL AND prior->'pricingPin'<>'null'::jsonb,
  'policy',CASE WHEN policy_row.id IS NOT NULL THEN public.canonical_pricing_policy_projection(policy_row) END,'policyPin',CASE WHEN policy_row.id IS NOT NULL THEN jsonb_build_object('id',policy_row.id,'revision',policy_row.revision,'digest',policy_row.digest) END,'policyBasisCurrent',policy_valid,
  'profilePin',base->'profilePin','taxProfilePin',CASE WHEN tax_row.id IS NOT NULL THEN jsonb_build_object('id',tax_row.id,'revision',tax_row.revision,'digest',tax_row.digest) END,
  'rulePins',rule_pins,'validatedRules',rules_eligible,'sourceDigest',public.canonical_completion_digest(base-'asOfDate'-'digest'),
  'decision',decision_value,'decisionBasis',jsonb_build_object('revision',COALESCE((decision_value->>'revision')::bigint,0),'digest',COALESCE(decision_value->>'digest','none')));
 RETURN payload||jsonb_build_object('digest',public.canonical_completion_digest(payload));
END $$;
CREATE FUNCTION public.canonical_commercial_current(t JSONB,s JSONB,binding JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE before_value JSONB;self_value BOOLEAN;
BEGIN
 IF t IS NULL OR t->>'action' IS DISTINCT FROM 'save' THEN RETURN jsonb_build_object('current',FALSE,'reason','not_recorded');END IF;
 IF s->'pricingCurrent' IS DISTINCT FROM 'true'::jsonb OR t->'authorityPin' IS DISTINCT FROM public.canonical_commercial_authority_pin(s) THEN RETURN jsonb_build_object('current',FALSE,'reason','basis_changed');END IF;
 before_value:=jsonb_build_object('revision',t->'expectedDecisionRevision','digest',t->>'expectedDecisionDigest');
 self_value:=binding IS NOT NULL AND binding->'termsPin'=public.canonical_commercial_pin(t) AND binding->'authorityPin'=t->'authorityPin' AND binding->'previousDecisionBasis'=before_value AND jsonb_build_object('revision',binding#>'{decisionPin,revision}','digest',binding#>>'{decisionPin,digest}')=s->'decisionBasis' AND binding#>>'{decisionPin,id}'=s#>>'{decision,id}' AND s#>>'{decision,action}'='approve' AND s#>>'{decision,priceBeforeTax}'=t#>>'{result,netBeforeTax}' AND s#>'{decision,sourcePins}'=t->'sourcePins';
 IF before_value IS DISTINCT FROM s->'decisionBasis' AND self_value IS NOT TRUE THEN RETURN jsonb_build_object('current',FALSE,'reason','decision_changed');END IF;
 RETURN jsonb_build_object('current',TRUE,'linkedApproval',COALESCE(self_value,FALSE));
END $$;
CREATE FUNCTION public.canonical_commercial_policy_comparison(t JSONB,s JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE net NUMERIC;threshold NUMERIC;difference NUMERIC;reason_value TEXT;
BEGIN
 net:=public.canonical_pricing_money(t#>'{result,netBeforeTax}');
 IF s#>>'{policy,action}' IS DISTINCT FROM 'save' THEN reason_value:='no_policy';ELSIF s->'policyBasisCurrent' IS DISTINCT FROM 'true'::jsonb OR s#>'{policy,expectedDecisionRevision}' IS DISTINCT FROM t->'expectedDecisionRevision' OR s#>>'{policy,expectedDecisionDigest}' IS DISTINCT FROM t->>'expectedDecisionDigest' THEN reason_value:='changed_policy';
 ELSE threshold:=public.canonical_pricing_money(s#>'{policy,result,threshold}');IF threshold IS NULL OR net IS NULL THEN reason_value:='incomplete_policy';END IF;END IF;
 IF reason_value IS NOT NULL THEN RETURN jsonb_build_object('state','unavailable','reason',reason_value,'threshold',NULL,'difference',NULL);END IF;
 difference:=net-threshold;RETURN jsonb_build_object('state',CASE WHEN difference<0 THEN 'below' WHEN difference>0 THEN 'above' ELSE 'at' END,'reason',NULL,'threshold',public.canonical_pricing_decimal(threshold),'difference',CASE WHEN difference<0 THEN '-' ELSE '' END||public.canonical_pricing_decimal(abs(difference)));
END $$;
CREATE FUNCTION public.canonical_commercial_lock(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Commercial owner transaction required' USING ERRCODE='42501';END IF;
 -- Nonlocking current-actor discovery precedes the shared organization/profile order.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE='P0002';END IF;
 PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);
 PERFORM 1 FROM public.canonical_business_profiles WHERE organization_id=org AND is_active=TRUE FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Current profile unavailable' USING ERRCODE='42501';END IF;
 IF estimate IS NOT NULL THEN PERFORM 1 FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;PERFORM public.canonical_travel_fence(org,estimate);PERFORM 1 FROM public.canonical_estimates WHERE organization_id=org AND id=estimate FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);RETURN authority;
END $$;
CREATE FUNCTION public.canonical_commercial_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_commercial_terms%ROWTYPE;a public.canonical_commercial_approvals%ROWTYPE;history JSONB;total_value BIGINT;
BEGIN
 IF current_setting('transaction_isolation') NOT IN('repeatable read','serializable') OR role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Protected commercial read required' USING ERRCODE='42501';END IF;PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_estimate_decision_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO current_row FROM public.canonical_commercial_terms WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT * INTO a FROM public.canonical_commercial_approvals WHERE organization_id=org AND estimate_id=estimate ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT count(*) INTO total_value FROM public.canonical_commercial_terms WHERE organization_id=org AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(public.canonical_commercial_projection(x) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_commercial_terms WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 50)x;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NOT NULL THEN public.canonical_commercial_projection(current_row) END,'history',history,'total',total_value,'truncated',total_value>50,'binding',CASE WHEN a.id IS NOT NULL THEN public.canonical_commercial_binding_projection(a) END);
END $$;
CREATE FUNCTION public.canonical_commercial_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body_value JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;sources JSONB;current_row public.canonical_commercial_terms%ROWTYPE;old public.canonical_commercial_terms%ROWTYPE;inserted public.canonical_commercial_terms%ROWTYPE;key_hash TEXT;request_hash TEXT;result_value JSONB;authority_value JSONB;actor_label TEXT;next_revision BIGINT;pricing_value UUID;policy_value UUID;
BEGIN
 authority:=public.canonical_commercial_lock(org,actor,role_value,session_value,estimate,csrf);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body_value::text)>65536 OR public.canonical_field_evidence_object_keys_exact(body_value,ARRAY['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion','evidenceDigest']) IS NOT TRUE OR body_value->>'action' IS NULL OR body_value->>'action' NOT IN('save','withdraw') OR body_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body_value->>'confirmationVersion' IS DISTINCT FROM 'estimate-commercial-terms-v1' OR public.canonical_pricing_text(body_value->'reason',2000) IS NOT TRUE OR jsonb_typeof(body_value->'expectedRevision') IS DISTINCT FROM 'number' OR (body_value->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body_value->>'expectedRevision')::bigint>10000 OR jsonb_typeof(body_value->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body_value->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body_value->>'expectedDecisionRevision')::bigint>10000 OR public.canonical_pricing_text(body_value->'expectedDigest',64) IS NOT TRUE OR public.canonical_pricing_text(body_value->'expectedDecisionDigest',64) IS NOT TRUE OR (body_value->>'evidenceDigest')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Commercial confirmation invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':commercial:'||key_hash,0));SELECT * INTO old FROM public.canonical_commercial_terms WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Commercial attempt changed' USING ERRCODE='23505';END IF;PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);RETURN jsonb_build_object('receipt',public.canonical_commercial_projection(old),'replayed',TRUE);END IF;
 SELECT * INTO current_row FROM public.canonical_commercial_terms WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 sources:=public.canonical_commercial_sources(org,actor,role_value,session_value,estimate,NULL);
 IF (body_value->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body_value->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body_value->'sourcePins' IS DISTINCT FROM sources->'sourcePins' OR body_value->>'currency' IS DISTINCT FROM sources->>'currency' OR jsonb_build_object('revision',body_value->'expectedDecisionRevision','digest',body_value->>'expectedDecisionDigest') IS DISTINCT FROM sources->'decisionBasis' THEN RAISE EXCEPTION 'Commercial basis changed' USING ERRCODE='40001';END IF;
 IF body_value->>'action'='save' THEN
  IF body_value->>'evidenceDigest' IS DISTINCT FROM sources->>'digest' OR sources->'pricingCurrent' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Commercial source changed' USING ERRCODE='40001';END IF;
  result_value:=public.canonical_commercial_calculate(body_value->'inputs',body_value->>'currency',sources||jsonb_build_object('pricing',sources#>'{pricing,result}'));
  authority_value:=public.canonical_commercial_authority_pin(sources);pricing_value:=(sources#>>'{pricingPin,id}')::uuid;policy_value:=(sources#>>'{policyPin,id}')::uuid;
 ELSE
  IF current_row.id IS NULL OR current_row.action<>'save' OR body_value->'inputs' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'No commercial terms to withdraw' USING ERRCODE='22023';END IF;authority_value:=current_row.authority_pin;pricing_value:=current_row.pricing_id;policy_value:=current_row.policy_id;
 END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;IF next_revision>10000 THEN RAISE EXCEPTION 'Commercial history limit' USING ERRCODE='54000';END IF;
 PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_commercial_terms(organization_id,estimate_id,revision,previous_id,pricing_id,policy_id,action,actor_user_id,membership_id,auth_session_id,actor_name,body,result,evidence,authority_pin,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,pricing_value,policy_value,body_value->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company Reviewer'),body_value,result_value,CASE WHEN body_value->>'action'='save' THEN sources END,authority_value,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'body',body_value,'sources',CASE WHEN body_value->>'action'='save' THEN sources END))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_commercial_projection(inserted),'replayed',FALSE);
END $$;
CREATE FUNCTION public.canonical_commercial_approve(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body_value JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;sources JSONB;after_sources JSONB;t public.canonical_commercial_terms%ROWTYPE;old public.canonical_commercial_approvals%ROWTYPE;inserted public.canonical_commercial_approvals%ROWTYPE;key_hash TEXT;request_hash TEXT;projection JSONB;calculated JSONB;comparison JSONB;decision_body JSONB;decision_result JSONB;exception_value JSONB;
BEGIN
 authority:=public.canonical_commercial_lock(org,actor,role_value,session_value,estimate,csrf);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body_value::text)>32768 OR public.canonical_field_evidence_object_keys_exact(body_value,ARRAY['termsPin','evidenceDigest','expectedDecisionRevision','expectedDecisionDigest','scopeSummary','reason','confirmed','confirmationVersion','exceptions']) IS NOT TRUE OR public.canonical_field_evidence_object_keys_exact(body_value->'termsPin',ARRAY['id','revision','digest']) IS NOT TRUE OR public.canonical_pricing_text(body_value#>'{termsPin,id}',80) IS NOT TRUE OR jsonb_typeof(body_value#>'{termsPin,revision}') IS DISTINCT FROM 'number' OR (body_value#>>'{termsPin,revision}')!~'^[1-9][0-9]{0,4}$' OR (body_value#>>'{termsPin,digest}')!~'^[a-f0-9]{64}$' OR (body_value->>'evidenceDigest')!~'^[a-f0-9]{64}$' OR jsonb_typeof(body_value->'expectedDecisionRevision') IS DISTINCT FROM 'number' OR (body_value->>'expectedDecisionRevision')!~'^(0|[1-9][0-9]{0,4})$' OR public.canonical_pricing_text(body_value->'expectedDecisionDigest',64) IS NOT TRUE OR public.canonical_pricing_text(body_value->'scopeSummary',4000) IS NOT TRUE OR public.canonical_pricing_text(body_value->'reason',2000) IS NOT TRUE OR body_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body_value->>'confirmationVersion' IS DISTINCT FROM 'estimate-commercial-terms-v1' THEN RAISE EXCEPTION 'Commercial approval invalid' USING ERRCODE='22023';END IF;
 exception_value:=body_value->'exceptions';IF public.canonical_field_evidence_object_keys_exact(exception_value,ARRAY['policyReason','policyUnknownAcknowledged','ownerRecordedTaxAcknowledged']) IS NOT TRUE OR public.canonical_pricing_text(exception_value->'policyReason',2000,TRUE) IS NOT TRUE OR jsonb_typeof(exception_value->'policyUnknownAcknowledged') IS DISTINCT FROM 'boolean' OR jsonb_typeof(exception_value->'ownerRecordedTaxAcknowledged') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Commercial exceptions invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':commercial-approve:'||key_hash,0));SELECT * INTO old FROM public.canonical_commercial_approvals WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Commercial approval attempt changed' USING ERRCODE='23505';END IF;PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);RETURN jsonb_build_object('receipt',public.canonical_commercial_binding_projection(old),'replayed',TRUE);END IF;
 SELECT * INTO t FROM public.canonical_commercial_terms WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF t.id IS NULL OR t.action<>'save' THEN RAISE EXCEPTION 'Current commercial terms required' USING ERRCODE='40001';END IF;
 projection:=public.canonical_commercial_projection(t);sources:=public.canonical_commercial_sources(org,actor,role_value,session_value,estimate,NULL);
 IF body_value->'termsPin' IS DISTINCT FROM public.canonical_commercial_pin(projection) OR body_value->>'evidenceDigest' IS DISTINCT FROM sources->>'digest' OR jsonb_build_object('revision',body_value->'expectedDecisionRevision','digest',body_value->>'expectedDecisionDigest') IS DISTINCT FROM sources->'decisionBasis' OR public.canonical_commercial_current(projection,sources,NULL)->'current' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Commercial approval source changed' USING ERRCODE='40001';END IF;
 calculated:=public.canonical_commercial_calculate(t.body->'inputs',t.body->>'currency',sources||jsonb_build_object('pricing',sources#>'{pricing,result}'));
 IF calculated IS DISTINCT FROM t.result THEN RAISE EXCEPTION 'Commercial totals changed' USING ERRCODE='40001';END IF;IF calculated->'complete' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Commercial totals incomplete' USING ERRCODE='22023';END IF;
 comparison:=public.canonical_commercial_policy_comparison(projection,sources);
 IF comparison->>'state'='below' AND btrim(exception_value->>'policyReason')='' OR comparison->>'state'='unavailable' AND exception_value->'policyUnknownAcknowledged'<>'true'::jsonb OR calculated->>'taxAuthority'='owner_recorded' AND exception_value->'ownerRecordedTaxAcknowledged'<>'true'::jsonb THEN RAISE EXCEPTION 'Review commercial policy and tax acknowledgments' USING ERRCODE='22023';END IF;
 decision_body:=jsonb_build_object('action','approve','expectedRevision',body_value->'expectedDecisionRevision','expectedDigest',body_value->>'expectedDecisionDigest','sourcePins',t.body->'sourcePins','scopeSummary',btrim(body_value->>'scopeSummary'),'priceBeforeTax',calculated->>'netBeforeTax','currency',t.body->>'currency','reason',btrim(body_value->>'reason'),'confirmed',TRUE,'confirmationVersion','estimate-quote-preparation-v1');
 decision_result:=public.canonical_estimate_decision_mutate(org,actor,role_value,session_value,estimate,csrf,'commercial:'||key_hash,decision_body);
 IF decision_result->'replayed' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Legacy receipt cannot establish new commercial approval' USING ERRCODE='23505';END IF;
 after_sources:=public.canonical_commercial_sources(org,actor,role_value,session_value,estimate,NULL);
 IF public.canonical_commercial_authority_pin(after_sources) IS DISTINCT FROM t.authority_pin OR after_sources#>>'{decision,id}' IS DISTINCT FROM decision_result#>>'{receipt,id}' THEN RAISE EXCEPTION 'Commercial approval basis changed during review' USING ERRCODE='40001';END IF;
 PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);
 INSERT INTO public.canonical_commercial_approvals(organization_id,estimate_id,terms_id,decision_id,actor_user_id,membership_id,auth_session_id,body,policy_comparison,authority_pin,decision_pin,previous_decision_basis,request_key_hash,request_digest,digest)
 VALUES(org,estimate,t.id,(decision_result#>>'{receipt,id}')::uuid,actor,(authority->>'membershipId')::uuid,session_value,body_value,comparison,t.authority_pin,public.canonical_commercial_pin(decision_result->'receipt'),sources->'decisionBasis',key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('terms',t.id,'decision',decision_result#>>'{receipt,id}','body',body_value,'authority',t.authority_pin))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_commercial_binding_projection(inserted),'replayed',FALSE);
END $$;
CREATE FUNCTION public.canonical_commercial_tax_read(org UUID,actor UUID,role_value TEXT,session_value UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.canonical_tax_profiles%ROWTYPE;r public.canonical_tax_preparation_results%ROWTYPE;profile_version TEXT;input_hash TEXT;rules_hash TEXT;history JSONB;current_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation') NOT IN('repeatable read','serializable') OR role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Protected tax setup read required' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT version_label INTO profile_version FROM public.canonical_business_profiles WHERE organization_id=org AND is_active;
 SELECT * INTO p FROM public.canonical_tax_profiles WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT saved.* INTO r FROM public.canonical_tax_preparation_current current_result JOIN public.canonical_tax_preparation_results saved ON saved.organization_id=current_result.organization_id AND saved.id=current_result.result_id WHERE current_result.organization_id=org;
 input_hash:=public.canonical_completion_digest(public.canonical_commercial_tax_inputs(org));rules_hash:=public.canonical_completion_digest(public.canonical_commercial_tax_rules());
 current_value:=r.id IS NOT NULL AND r.disposition='published' AND r.input_digest=input_hash AND r.rules_digest=rules_hash AND r.result->>'asOfDate'=(clock_timestamp() AT TIME ZONE 'UTC')::date::text;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'revision',x.revision,'digest',x.digest,'inputs',x.inputs,'createdAt',x.created_at) ORDER BY x.revision DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_tax_profiles WHERE organization_id=org ORDER BY revision DESC LIMIT 50)x;
 RETURN jsonb_build_object('version','tax-preparation-v1','services',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v->>'id','label',COALESCE(NULLIF(v->>'name',''),v->>'id'))),'[]'::jsonb) FROM jsonb_array_elements(public.canonical_commercial_tax_inputs(org)->'services') v),'expectedProfileVersion',profile_version,'current',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'revision',p.revision,'digest',p.digest,'inputs',p.inputs,'createdAt',p.created_at) END,'history',history,'inputDigest',input_hash,'rulesDigest',rules_hash,'resultCurrent',COALESCE(current_value,FALSE),'result',CASE WHEN current_value THEN r.result END,'preparationState',CASE WHEN current_value THEN r.result->>'state' WHEN r.id IS NULL THEN 'pending' ELSE 'changed' END);
END $$;
CREATE FUNCTION public.canonical_commercial_tax_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,body_value JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.canonical_tax_profiles%ROWTYPE;old public.canonical_tax_profiles%ROWTYPE;inserted public.canonical_tax_profiles%ROWTYPE;profile_version TEXT;key_hash TEXT;request_hash TEXT;next_revision BIGINT;
BEGIN
 PERFORM public.canonical_commercial_lock(org,actor,role_value,session_value,NULL,csrf);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body_value::text)>32768 OR public.canonical_field_evidence_object_keys_exact(body_value,ARRAY['expectedRevision','expectedDigest','expectedProfileVersion','inputs','reason','confirmed','confirmationVersion']) IS NOT TRUE OR jsonb_typeof(body_value->'expectedRevision') IS DISTINCT FROM 'number' OR (body_value->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR (body_value->>'expectedRevision')::bigint>10000 OR public.canonical_pricing_text(body_value->'expectedDigest',64) IS NOT TRUE OR public.canonical_pricing_text(body_value->'expectedProfileVersion',100) IS NOT TRUE OR public.canonical_pricing_text(body_value->'reason',2000) IS NOT TRUE OR body_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body_value->>'confirmationVersion' IS DISTINCT FROM 'tax-preparation-v1' THEN RAISE EXCEPTION 'Tax setup review invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_commercial_tax_profile_validate(body_value->'inputs');key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(body_value);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':tax-profile:'||key_hash,0));SELECT * INTO old FROM public.canonical_tax_profiles WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Tax setup attempt changed' USING ERRCODE='23505';END IF;PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);RETURN jsonb_build_object('receipt',jsonb_build_object('id',old.id,'revision',old.revision,'digest',old.digest),'replayed',TRUE);END IF;
 SELECT * INTO p FROM public.canonical_tax_profiles WHERE organization_id=org ORDER BY revision DESC LIMIT 1;SELECT version_label INTO profile_version FROM public.canonical_business_profiles WHERE organization_id=org AND is_active;
 IF (body_value->>'expectedRevision')::bigint<>COALESCE(p.revision,0) OR body_value->>'expectedDigest' IS DISTINCT FROM COALESCE(p.digest,'none') OR body_value->>'expectedProfileVersion' IS DISTINCT FROM profile_version THEN RAISE EXCEPTION 'Tax setup or profile changed' USING ERRCODE='40001';END IF;
 next_revision:=COALESCE(p.revision,0)+1;IF next_revision>10000 THEN RAISE EXCEPTION 'Tax setup history limit' USING ERRCODE='54000';END IF;
 PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);
 INSERT INTO public.canonical_tax_profiles(organization_id,revision,previous_id,inputs,body,actor_user_id,request_key_hash,request_digest,digest) VALUES(org,next_revision,p.id,body_value->'inputs',body_value,actor,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('body',body_value,'previous',p.id,'actor',actor))) RETURNING * INTO inserted;
 PERFORM public.canonical_commercial_tax_enqueue(org);PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);
 RETURN jsonb_build_object('receipt',jsonb_build_object('id',inserted.id,'revision',inserted.revision,'digest',inserted.digest),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_commercial_terms,public.canonical_commercial_approvals,public.canonical_tax_profiles,public.canonical_tax_rule_versions,public.canonical_tax_preparation_jobs,public.canonical_tax_preparation_results,public.canonical_tax_preparation_current FROM PUBLIC;
DO $$ DECLARE fn RECORD;BEGIN FOR fn IN SELECT oid::regprocedure::text identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_commercial_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||fn.identity||' FROM PUBLIC';END LOOP;END $$;
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost','equipment_ready','travel_plan','pricing_plan','pricing_policy','commercial_terms','commercial_ok','tax_profile'));
