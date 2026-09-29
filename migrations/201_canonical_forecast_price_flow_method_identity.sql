-- Mission 26 Part 3D: reviewed local executable identity and typed internal
-- experiment method eligibility. The statistical method has no installed
-- trained model or tenant-owned training receipt, so it stays unavailable.
CREATE FUNCTION public.canonical_forecast_price_flow_method_closure_digest()
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pending OID[]:=ARRAY[
 'public.canonical_forecast_capture_price_flow_origin(uuid,uuid,text,uuid,text,text,uuid,text,timestamptz,timestamptz)'::regprocedure::oid,
 'public.canonical_forecast_capture_price_flow_zero_baseline(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure::oid,
 'public.canonical_forecast_capture_supported_price_flow_origin(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure::oid,
 'public.canonical_forecast_activate_supported_price_flow_origin(uuid,uuid,text,uuid,text,uuid)'::regprocedure::oid,
 'public.canonical_forecast_price_flow_registered_insert()'::regprocedure::oid
 ];
 visited OID[]:=ARRAY[]::oid[]; entries TEXT[]:=ARRAY[]::text[];
 current_oid OID; body TEXT; matched TEXT[]; child OID; joined TEXT;
 attached RECORD;
BEGIN
 -- Attest the attachment as well as the body: dropping or replacing the
 -- immutable/registration trigger must change this reviewed identity.
 FOR attached IN SELECT tgrelid,tgname,tgfoid,tgenabled,
   pg_get_triggerdef(oid) definition
  FROM pg_trigger WHERE NOT tgisinternal AND tgrelid=ANY(ARRAY[
   'public.canonical_forecast_price_flow_saved_origins'::regclass,
   'public.canonical_forecast_price_flow_origin_activations'::regclass,
   'public.canonical_forecast_price_flow_profile_witnesses'::regclass,
   'public.canonical_forecast_price_flow_algorithms'::regclass,
   'public.canonical_forecast_price_flow_method_registration'::regclass,
   'public.canonical_forecast_price_flow_supported_selections'::regclass,
   'public.canonical_forecast_price_flow_supported_origins'::regclass,
   'public.canonical_forecast_price_flow_supported_origin_activations'::regclass])
  ORDER BY tgrelid::regclass::text,tgname LOOP
  entries:=array_append(entries,'TRIGGER:'||
   attached.tgrelid::regclass::text||':'||attached.tgname||':'||
   attached.tgenabled::text||':'||attached.definition);
  pending:=array_append(pending,attached.tgfoid);
 END LOOP;
 WHILE cardinality(pending)>0 LOOP
  current_oid:=pending[1];
  pending:=pending[2:cardinality(pending)];
  IF current_oid=ANY(visited) THEN CONTINUE; END IF;
  visited:=array_append(visited,current_oid);
  IF cardinality(visited)>256 THEN
   RAISE EXCEPTION 'Algorithm dependency closure exceeds reviewed bound'
    USING ERRCODE='23514';
  END IF;
  body:=pg_get_functiondef(current_oid);
  IF body IS NULL THEN
   RAISE EXCEPTION 'Algorithm dependency missing' USING ERRCODE='23514';
  END IF;
  entries:=array_append(entries,
   current_oid::regprocedure::text||':'||
   encode(sha256(convert_to(body,'UTF8')),'hex'));
  -- PL/pgSQL bodies do not expose every invoked routine through pg_depend.
  -- Include every public function named by each reached body, with all
  -- overloads; a new or modified helper then invalidates this registration.
  FOR matched IN SELECT regexp_matches(body,
    'public\.([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*\(', 'g') LOOP
   FOR child IN SELECT oid FROM pg_proc
     WHERE pronamespace='public'::regnamespace AND proname=matched[1]
     ORDER BY oid LOOP
    IF NOT child=ANY(visited) THEN pending:=array_append(pending,child); END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 SELECT string_agg(item,E'\n' ORDER BY item) INTO joined
 FROM unnest(entries) item;
 RETURN encode(sha256(convert_to(joined,'UTF8')),'hex');
END $$;

CREATE TABLE public.canonical_forecast_price_flow_method_registration (
 version TEXT PRIMARY KEY CHECK(version IN (
  'm26_selected_m24_deterministic_closure_v1',
  'm26_selected_m24_statistical_unavailable_v1')),
 method_kind TEXT NOT NULL CHECK(method_kind IN ('deterministic','statistical')),
 target_key TEXT NOT NULL CHECK(target_key='revenue.approved_price_flow'),
 target_version TEXT NOT NULL CHECK(target_version='v1'),
 source_scope TEXT NOT NULL CHECK(source_scope='northstar_m24_approved_price_decisions'),
 output_kind TEXT NOT NULL CHECK(output_kind='point'),
 interval_policy TEXT NOT NULL CHECK(interval_policy='unavailable'),
 dependency_closure_digest TEXT CHECK(dependency_closure_digest~'^[a-f0-9]{64}$'),
 eligibility_state TEXT NOT NULL CHECK(eligibility_state IN ('registered','unavailable')),
 unavailable_reason TEXT,
 registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK((method_kind='deterministic' AND
   version='m26_selected_m24_deterministic_closure_v1' AND
   dependency_closure_digest IS NOT NULL AND
   eligibility_state='registered' AND unavailable_reason IS NULL) OR
  (method_kind='statistical' AND
   version='m26_selected_m24_statistical_unavailable_v1' AND
   dependency_closure_digest IS NULL AND
   eligibility_state='unavailable' AND
   unavailable_reason='no_installed_trained_model_or_tenant_training_receipt'))
);
CREATE TRIGGER canonical_forecast_price_flow_method_registration_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_method_registration
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_price_flow_method_closure_current()
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE registered public.canonical_forecast_price_flow_method_registration%ROWTYPE;
BEGIN
 SELECT * INTO registered FROM public.canonical_forecast_price_flow_method_registration
  WHERE version='m26_selected_m24_deterministic_closure_v1';
 RETURN registered.version IS NOT NULL AND
  registered.dependency_closure_digest IS NOT DISTINCT FROM
   public.canonical_forecast_price_flow_method_closure_digest();
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_method_eligibility(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 context_run_value UUID,method_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 registered public.canonical_forecast_price_flow_method_registration%ROWTYPE;
BEGIN
 IF method_value NOT IN ('deterministic','statistical') OR
    context_run_value IS NULL THEN
  RAISE EXCEPTION 'Algorithm method request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=context_run_value AND
   output->>'calculationVersion'='m26_price_flow_carry_forward_v1';
 IF saved.id IS NULL THEN
  RETURN jsonb_build_object('state','method_unavailable',
   'reason','context_unavailable','methodKind',method_value,
   'eligible',FALSE,'internalExperimentOnly',TRUE,
   'productionPromotionEligible',FALSE,
   'paidNumericServing',FALSE,'realForecastEligible',FALSE);
 END IF;
 IF method_value='statistical' THEN
  SELECT * INTO registered FROM public.canonical_forecast_price_flow_method_registration
   WHERE version='m26_selected_m24_statistical_unavailable_v1';
  IF registered.version IS NULL OR registered.method_kind<>'statistical' OR
     registered.eligibility_state<>'unavailable' THEN
   RETURN jsonb_build_object('state','method_unavailable',
    'reason','statistical_registration_unavailable',
    'methodKind','statistical','eligible',FALSE,
    'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
    'paidNumericServing',FALSE,'realForecastEligible',FALSE);
  END IF;
  RETURN jsonb_build_object('state','method_unavailable',
   'reason',registered.unavailable_reason,
   'registrationVersion',registered.version,
   'methodKind','statistical','eligible',FALSE,
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'paidNumericServing',FALSE,'realForecastEligible',FALSE);
 END IF;
 IF NOT public.canonical_forecast_price_flow_method_closure_current() THEN
  RETURN jsonb_build_object('state','method_unavailable',
   'reason','reviewed_implementation_changed',
   'methodKind','deterministic','eligible',FALSE,
   'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
   'paidNumericServing',FALSE,'realForecastEligible',FALSE);
 END IF;
 RETURN jsonb_build_object('state','method_registered',
  'methodKind','deterministic','eligible',TRUE,
  'registrationVersion','m26_selected_m24_deterministic_closure_v1',
  'internalExperimentOnly',TRUE,'productionPromotionEligible',FALSE,
  'paidNumericServing',FALSE,'realForecastEligible',FALSE);
END $$;

-- Registration is installed only after all of the above executable and
-- eligibility readers exist, so the closure includes their reached bodies.
INSERT INTO public.canonical_forecast_price_flow_method_registration(
 version,method_kind,target_key,target_version,source_scope,output_kind,
 interval_policy,dependency_closure_digest,eligibility_state,unavailable_reason)
VALUES
 ('m26_selected_m24_deterministic_closure_v1','deterministic',
  'revenue.approved_price_flow','v1',
  'northstar_m24_approved_price_decisions','point','unavailable',
  public.canonical_forecast_price_flow_method_closure_digest(),
  'registered',NULL),
 ('m26_selected_m24_statistical_unavailable_v1','statistical',
  'revenue.approved_price_flow','v1',
  'northstar_m24_approved_price_decisions','point','unavailable',
  NULL,'unavailable',
  'no_installed_trained_model_or_tenant_training_receipt');

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_method_registration
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_method_closure_digest()
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_method_closure_current()
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_method_eligibility(
 UUID,UUID,TEXT,UUID,UUID,TEXT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_method_registration
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_method_closure_digest()
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_method_closure_current()
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_method_eligibility(
  UUID,UUID,TEXT,UUID,UUID,TEXT) TO northstar_app_runtime;
END IF; END $$;
