-- Mission 26 Part 3D: tenant-private, non-serving human research selection.
-- An event never enables a numeric forecast or changes an existing run.
CREATE TABLE public.canonical_forecast_price_flow_research_selections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision>0),
 action TEXT NOT NULL CHECK(action IN ('select_candidate','rollback')),
 algorithm_version TEXT NOT NULL REFERENCES public.canonical_forecast_price_flow_algorithms(algorithm_version),
 previous_algorithm_version TEXT,
 reversed_event_id UUID REFERENCES public.canonical_forecast_price_flow_research_selections(id),
 comparison_digest TEXT NOT NULL CHECK(comparison_digest~'^[a-f0-9]{64}$'),
 policy_version TEXT NOT NULL CHECK(policy_version='m26_selected_m24_research_review_v1'),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 16 AND 1000),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 research_only BOOLEAN NOT NULL DEFAULT TRUE CHECK(research_only),
 forecast_serving_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT forecast_serving_enabled),
 UNIQUE(organization_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id)
  ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_price_flow_research_selection_latest
 ON public.canonical_forecast_price_flow_research_selections
 (organization_id,revision DESC);
CREATE TRIGGER canonical_forecast_price_flow_research_selection_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_research_selections
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

-- The challenge key is database-owned and never granted to app runtime.
-- A direct function caller cannot replace a reviewed action with arbitrary
-- token bytes, even if it can legitimately execute the writer function.
CREATE TABLE public.canonical_forecast_price_flow_research_key (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 key_bytes BYTEA NOT NULL CHECK(length(key_bytes)=32)
);
INSERT INTO public.canonical_forecast_price_flow_research_key(singleton,key_bytes)
 VALUES(TRUE,decode(replace(gen_random_uuid()::text,'-','')||
  replace(gen_random_uuid()::text,'-',''),'hex'));
CREATE TRIGGER canonical_forecast_price_flow_research_key_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_research_key
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

-- RFC 2104 HMAC-SHA256 using PostgreSQL's built-in sha256(bytea); avoids a
-- deployment extension dependency. The 32-byte key stays in the private table.
CREATE FUNCTION public.canonical_forecast_price_flow_research_mac(
 payload TEXT,secret BYTEA)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE inner_pad BYTEA:=decode(repeat('00',64),'hex');
 outer_pad BYTEA:=decode(repeat('00',64),'hex');
 index_value INTEGER; key_byte INTEGER;
BEGIN
 IF length(secret)<>32 THEN
  RAISE EXCEPTION 'Research MAC key invalid' USING ERRCODE='22023';
 END IF;
 FOR index_value IN 0..63 LOOP
  key_byte:=CASE WHEN index_value<32 THEN get_byte(secret,index_value)
   ELSE 0 END;
  inner_pad:=set_byte(inner_pad,index_value,key_byte # 54);
  outer_pad:=set_byte(outer_pad,index_value,key_byte # 92);
 END LOOP;
 RETURN encode(sha256(outer_pad||
  sha256(inner_pad||convert_to(payload,'UTF8'))),'hex');
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_research_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE population JSONB; reviewed_population JSONB; item JSONB; lag_ok BOOLEAN:=TRUE;
 horizon_end TIMESTAMPTZ; observed_through TIMESTAMPTZ;
 latest public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 complete BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Research review requires read committed'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 population:=public.canonical_forecast_price_flow_matched_population(
  org,actor,role_value,session_value,FALSE);
 IF population->>'state'='matched_population_observed' THEN
  IF jsonb_typeof(population->'selectedRunIds') IS DISTINCT FROM 'array' OR
     jsonb_array_length(population->'selectedRunIds')>200 OR
     (SELECT count(*) FROM jsonb_array_elements_text(
       population->'selectedRunIds')) IS DISTINCT FROM
      (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(
       population->'selectedRunIds')) OR
     EXISTS(SELECT 1 FROM jsonb_array_elements_text(
       population->'selectedRunIds') selected(value)
       WHERE value!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
   RAISE EXCEPTION 'Research population origin inventory invalid'
    USING ERRCODE='23514';
  END IF;
  -- The inventory holds the tenant price fence. Never wait for an actual
  -- writer lock while holding it: a writer takes the locks in the opposite
  -- order. A failed try aborts this review and releases the fence.
  IF EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(
     population->'selectedRunIds') selected(value)
   WHERE NOT pg_try_advisory_xact_lock(hashtextextended(
    'm26:price-flow-actual:'||org::text||':'||selected.value,0))) THEN
   RAISE EXCEPTION 'Forecast price-flow actual source is busy'
    USING ERRCODE='55P03';
  END IF;
  reviewed_population:=public.canonical_forecast_price_flow_matched_population(
   org,actor,role_value,session_value,TRUE);
  IF reviewed_population->>'state' IS DISTINCT FROM
       'matched_population_observed' OR
     reviewed_population->'selectedRunIds' IS DISTINCT FROM
       population->'selectedRunIds' THEN
   RAISE EXCEPTION 'Research population changed during guarded review'
    USING ERRCODE='40001';
  END IF;
  population:=reviewed_population;
 END IF;
 SELECT * INTO latest
 FROM public.canonical_forecast_price_flow_research_selections
 WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF population->>'state' IS DISTINCT FROM 'matched_population_observed' THEN
  RETURN jsonb_build_object('state','research_review_unavailable',
   'reason','matched_population_unavailable',
   'currentRevision',COALESCE(latest.revision,0),
   'currentAlgorithmVersion',latest.algorithm_version,
   'forecastServingEnabled',FALSE);
 END IF;
 complete:=jsonb_typeof(population->'completeRegisteredPopulation')='boolean' AND
  population->'completeRegisteredPopulation'='true'::jsonb AND
  jsonb_typeof(population->'sourceEventDiversityVerified')='boolean' AND
  population->'sourceEventDiversityVerified'='true'::jsonb AND
  jsonb_typeof(population->'distinctSourceEventDays')='number' AND
  COALESCE((population->>'distinctSourceEventDays')::numeric=60,FALSE) AND
  jsonb_typeof(population->'items')='array' AND
  jsonb_array_length(population->'items')=60;
 IF complete IS TRUE THEN
  FOR item IN SELECT value FROM jsonb_array_elements(population->'items') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR
      jsonb_typeof(item->'baseActual') IS DISTINCT FROM 'object' OR
      jsonb_typeof(item->'candidateActual') IS DISTINCT FROM 'object' OR
      jsonb_typeof(item->'horizonEnd') IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'baseActual'->'observedThrough')
       IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'candidateActual'->'observedThrough')
       IS DISTINCT FROM 'string' OR
      item->>'horizonEnd' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' OR
      item->'baseActual'->>'observedThrough' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' OR
      item->'candidateActual'->>'observedThrough' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' OR
      item->>'state' IS DISTINCT FROM 'matched_algorithms_observed' OR
      item->>'actualPairStatus' IS DISTINCT FROM 'paired' OR
      item->'baseActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
      item->'candidateActual'->>'state' IS DISTINCT FROM 'pair_actual_known' OR
      item->'baseActual'->>'observedThrough' IS DISTINCT FROM
       item->'candidateActual'->>'observedThrough' THEN
    lag_ok:=FALSE; EXIT;
   END IF;
   horizon_end:=(item->>'horizonEnd')::timestamptz;
   observed_through:=(item->'baseActual'->>'observedThrough')::timestamptz;
   IF observed_through IS NULL OR horizon_end IS NULL OR
      observed_through<horizon_end OR
      observed_through>horizon_end+INTERVAL '60 days' THEN
    lag_ok:=FALSE; EXIT;
   END IF;
  END LOOP;
 END IF;
 IF complete IS DISTINCT FROM TRUE OR lag_ok IS DISTINCT FROM TRUE THEN
  RETURN jsonb_build_object('state','research_review_unavailable',
   'reason',CASE WHEN NOT complete THEN 'matched_population_incomplete'
    ELSE 'source_observation_lag_unverified' END,
   'currentRevision',COALESCE(latest.revision,0),
   'currentAlgorithmVersion',latest.algorithm_version,
   'forecastServingEnabled',FALSE);
 END IF;
 RETURN jsonb_build_object('state','research_review_ready',
  'policyVersion','m26_selected_m24_research_review_v1',
  'comparisonDigest',public.canonical_completion_digest(population),
  'currentRevision',COALESCE(latest.revision,0),
  'currentAlgorithmVersion',latest.algorithm_version,
  'scope','northstar_m24_registered_saved_algorithms_only',
  'researchOnly',TRUE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_research_challenge(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 expected_revision INTEGER,action_value TEXT,candidate_version TEXT,
 reverses_value UUID,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reviewed JSONB; secret BYTEA; challenge TEXT;
BEGIN
 IF role_value NOT IN ('owner','admin') OR
    expected_revision IS NULL OR expected_revision<0 OR
    action_value NOT IN ('select_candidate','rollback') OR
    candidate_version NOT IN ('m26_price_flow_zero_baseline_v1',
      'm26_price_flow_carry_forward_v1') OR
    reason_value IS NULL OR length(reason_value)<16 OR
    length(reason_value)>1000 THEN
  RAISE EXCEPTION 'Research challenge invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 reviewed:=public.canonical_forecast_price_flow_research_review(
  org,actor,role_value,session_value);
 IF reviewed->>'state' IS DISTINCT FROM 'research_review_ready' OR
    (reviewed->>'currentRevision')::integer<>expected_revision THEN
  RETURN jsonb_build_object('state','research_challenge_unavailable',
   'reason','review_source_changed','forecastServingEnabled',FALSE);
 END IF;
 SELECT key_bytes INTO secret
  FROM public.canonical_forecast_price_flow_research_key WHERE singleton=TRUE;
 IF secret IS NULL THEN
  RAISE EXCEPTION 'Research challenge key unavailable'
   USING ERRCODE='23514';
 END IF;
 challenge:=public.canonical_forecast_price_flow_research_mac(
  jsonb_build_object(
  'version','m26-selected-m24-research-challenge-v1',
  'organizationId',org,'actorUserId',actor,'sessionId',session_value,
  'expectedRevision',expected_revision,'action',action_value,
  'candidateVersion',candidate_version,'reversesEventId',reverses_value,
  'reason',reason_value,
  'comparisonDigest',reviewed->>'comparisonDigest')::text,secret);
 RETURN jsonb_build_object('state','research_challenge_ready',
  'reviewToken',challenge,'currentRevision',expected_revision,
  'researchOnly',TRUE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_research_select(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,expected_revision INTEGER,action_value TEXT,
 candidate_version TEXT,reverses_value UUID,reason_value TEXT,
 review_token_value TEXT,reviewed_comparison_digest TEXT,
 confirmed_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 latest public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 review_value JSONB; key_hash TEXT; request_hash TEXT;
 selected_version TEXT; prior_version TEXT;
 saved public.canonical_forecast_price_flow_research_selections%ROWTYPE;
 secret BYTEA; expected_token TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') OR
    key_value IS NULL OR length(key_value)<16 OR length(key_value)>128 OR
    expected_revision IS NULL OR expected_revision<0 OR
    action_value NOT IN ('select_candidate','rollback') OR
    reason_value IS NULL OR length(reason_value)<16 OR
    length(reason_value)>1000 OR
    review_token_value IS NULL OR
    review_token_value!~'^[a-f0-9]{64}$' OR
    confirmed_value IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Research selection request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy'
   USING ERRCODE='55P03';
 END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'expectedRevision',expected_revision,'action',action_value,
  'candidateVersion',candidate_version,'reversesEventId',reverses_value,
  'reason',reason_value,'reviewToken',review_token_value));
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_research_selections
 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Research selection replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','research_selection_recorded',
   'eventId',prior.id,'revision',prior.revision,
   'algorithmVersion',prior.algorithm_version,
   'researchOnly',TRUE,'forecastServingEnabled',FALSE,'replayed',TRUE);
 END IF;
 IF reviewed_comparison_digest IS NULL THEN
  RETURN jsonb_build_object('state','research_selection_unavailable',
   'reason','review_required','forecastServingEnabled',FALSE);
 END IF;
 IF reviewed_comparison_digest!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Research comparison digest invalid'
   USING ERRCODE='22023';
 END IF;
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_research_selections
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF COALESCE(latest.revision,0)<>expected_revision THEN
  RAISE EXCEPTION 'Research selection revision changed' USING ERRCODE='23505';
 END IF;
 prior_version:=COALESCE(latest.algorithm_version,
  'm26_price_flow_carry_forward_v1');
 IF action_value='select_candidate' THEN
  IF candidate_version IS DISTINCT FROM 'm26_price_flow_zero_baseline_v1' OR
     reverses_value IS NOT NULL OR
     prior_version='m26_price_flow_zero_baseline_v1' THEN
   RAISE EXCEPTION 'Research selection candidate invalid'
    USING ERRCODE='22023';
  END IF;
  selected_version:=candidate_version;
 ELSE
  IF candidate_version IS DISTINCT FROM
      'm26_price_flow_carry_forward_v1' OR
     latest.id IS NULL OR latest.action<>'select_candidate' OR
     reverses_value IS DISTINCT FROM latest.id OR
     prior_version<>'m26_price_flow_zero_baseline_v1' THEN
   RAISE EXCEPTION 'Research rollback invalid' USING ERRCODE='22023';
  END IF;
  selected_version:=candidate_version;
 END IF;
 review_value:=public.canonical_forecast_price_flow_research_review(
  org,actor,role_value,session_value);
 IF review_value->>'state' IS DISTINCT FROM 'research_review_ready' OR
    review_value->>'comparisonDigest' IS DISTINCT FROM
      reviewed_comparison_digest OR
    (review_value->>'currentRevision')::integer<>expected_revision THEN
  RETURN jsonb_build_object('state','research_selection_unavailable',
   'reason','review_source_changed','forecastServingEnabled',FALSE);
 END IF;
 -- Validate the challenge against the guarded review already completed in
 -- this transaction. Calling the challenge endpoint function here would run
 -- the bounded population review again under the same statement timeout.
 SELECT key_bytes INTO secret
  FROM public.canonical_forecast_price_flow_research_key WHERE singleton=TRUE;
 IF secret IS NULL THEN
  RAISE EXCEPTION 'Research challenge key unavailable'
   USING ERRCODE='23514';
 END IF;
 expected_token:=public.canonical_forecast_price_flow_research_mac(
  jsonb_build_object(
  'version','m26-selected-m24-research-challenge-v1',
  'organizationId',org,'actorUserId',actor,'sessionId',session_value,
  'expectedRevision',expected_revision,'action',action_value,
  'candidateVersion',candidate_version,'reversesEventId',reverses_value,
  'reason',reason_value,
  'comparisonDigest',review_value->>'comparisonDigest')::text,secret);
 IF expected_token IS DISTINCT FROM review_token_value THEN
  RETURN jsonb_build_object('state','research_selection_unavailable',
   'reason','review_challenge_invalid','forecastServingEnabled',FALSE);
 END IF;
 INSERT INTO public.canonical_forecast_price_flow_research_selections(
  organization_id,revision,action,algorithm_version,
  previous_algorithm_version,reversed_event_id,comparison_digest,
  policy_version,reason,actor_user_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,expected_revision+1,action_value,selected_version,
  prior_version,reverses_value,reviewed_comparison_digest,
  'm26_selected_m24_research_review_v1',reason_value,actor,session_value,
  key_hash,request_hash) RETURNING * INTO saved;
 RETURN jsonb_build_object('state','research_selection_recorded',
  'eventId',saved.id,'revision',saved.revision,
  'algorithmVersion',saved.algorithm_version,
  'researchOnly',TRUE,'forecastServingEnabled',FALSE,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_selections
 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_key FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_research_mac(
 TEXT,BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_research_review(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_research_challenge(
 UUID,UUID,TEXT,UUID,TEXT,INTEGER,TEXT,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_research_select(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_research_review(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_research_challenge(
  UUID,UUID,TEXT,UUID,TEXT,INTEGER,TEXT,TEXT,UUID,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_research_select(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,BOOLEAN)
  TO northstar_app_runtime;
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_selections
  FROM northstar_app_runtime;
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_research_key
  FROM northstar_app_runtime;
END IF; END $$;
