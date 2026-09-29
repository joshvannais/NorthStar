-- Mission 26 Part 3B: private append-only evaluations of two guarded M24
-- price-flow origins. The trusted server assembles this result from the
-- guarded owning readers; clients cannot submit its numerical contents.
CREATE TABLE public.canonical_forecast_price_flow_evaluations (
 organization_id UUID NOT NULL,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 first_run_id UUID NOT NULL,
 second_run_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 previous_id UUID,
 result JSONB NOT NULL,
 result_digest TEXT NOT NULL CHECK(result_digest~'^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,id),
 CHECK(first_run_id<second_run_id),
 CHECK(result->>'version'='m26-rolling-backtest-v1'),
 CHECK(result->>'organizationId'=organization_id::text),
 CHECK((result->>'originCount')::integer=2),
 CHECK(jsonb_array_length(result->'comparisons')=2),
 CHECK(result_digest=public.canonical_completion_digest(result)),
 UNIQUE(organization_id,first_run_id,second_run_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,first_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,second_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_price_flow_evaluations(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_price_flow_evaluations_latest
 ON public.canonical_forecast_price_flow_evaluations
 (organization_id,first_run_id,second_run_id,revision DESC,id DESC);
CREATE TRIGGER canonical_forecast_price_flow_evaluations_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_evaluations
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

-- Look up an already committed request before consulting mutable current
-- source state. The transaction-level pair lock also serializes fresh writes.
CREATE FUNCTION public.canonical_forecast_price_flow_evaluation_replay(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,run_a UUID,run_b UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_run UUID; second_run UUID; saved public.canonical_forecast_price_flow_evaluations%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  run_a IS NULL OR run_b IS NULL OR run_a=run_b THEN
  RAISE EXCEPTION 'Price-flow evaluation request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 first_run:=LEAST(run_a,run_b);
 second_run:=GREATEST(run_a,run_b);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-flow-evaluation:'||org::text||':'||first_run::text||':'||
   second_run::text,0)) THEN
  RAISE EXCEPTION 'Price-flow evaluation busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_evaluations
  WHERE organization_id=org AND actor_user_id=actor
   AND request_key_hash=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF saved.id IS NULL THEN
  RETURN jsonb_build_object('state','price_flow_evaluation_new');
 END IF;
 IF saved.first_run_id<>first_run OR saved.second_run_id<>second_run THEN
  RAISE EXCEPTION 'Price-flow evaluation replay changed' USING ERRCODE='23505';
 END IF;
 RETURN jsonb_build_object('state','price_flow_evaluation_saved',
  'evaluationId',saved.id,'revision',saved.revision,'replayed',TRUE);
END $$;

CREATE FUNCTION public.canonical_forecast_capture_price_flow_evaluation(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,run_a UUID,run_b UUID,result_value JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_run UUID; second_run UUID;
 prior public.canonical_forecast_price_flow_evaluations%ROWTYPE;
 inserted public.canonical_forecast_price_flow_evaluations%ROWTYPE;
 comparison_ids UUID[]; requested TEXT; result_hash TEXT; key_hash TEXT; replay JSONB;
 pair_a JSONB; pair_b JSONB; actual_a JSONB; actual_b JSONB;
 item JSONB; linked JSONB; linked_actual JSONB; profile_check JSONB;
BEGIN
 replay:=public.canonical_forecast_price_flow_evaluation_replay(
  org,actor,role_value,session_value,csrf,key_value,run_a,run_b);
 IF replay->>'state'='price_flow_evaluation_saved' THEN RETURN replay; END IF;
 IF current_setting('transaction_isolation')<>'read committed' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  run_a IS NULL OR run_b IS NULL OR run_a=run_b OR
  result_value IS NULL OR jsonb_typeof(result_value)<>'object' OR
  pg_column_size(result_value)>65536 OR
  result_value->>'version'<>'m26-rolling-backtest-v1' OR
  result_value->>'organizationId' IS DISTINCT FROM org::text OR
  jsonb_typeof(result_value->'comparisons')<>'array' OR
  jsonb_array_length(result_value->'comparisons')<>2 OR
  (result_value->>'originCount')::integer<>2 THEN
  RAISE EXCEPTION 'Price-flow evaluation request invalid' USING ERRCODE='22023';
 END IF;
 first_run:=LEAST(run_a,run_b);
 second_run:=GREATEST(run_a,run_b);
 comparison_ids:=ARRAY[
  (result_value->'comparisons'->0->>'forecastRunId')::uuid,
  (result_value->'comparisons'->1->>'forecastRunId')::uuid];
 IF comparison_ids[1] IS NULL OR comparison_ids[2] IS NULL OR
  comparison_ids[1]=comparison_ids[2] OR
  NOT (first_run=ANY(comparison_ids) AND second_run=ANY(comparison_ids)) THEN
  RAISE EXCEPTION 'Price-flow evaluation run mismatch' USING ERRCODE='22023';
 END IF;
 pair_a:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,first_run);
 pair_b:=public.canonical_forecast_price_flow_pair_source_read(
  org,actor,role_value,session_value,second_run);
 actual_a:=public.canonical_forecast_price_flow_pair_actual_read(
  org,actor,role_value,session_value,first_run);
 actual_b:=public.canonical_forecast_price_flow_pair_actual_read(
  org,actor,role_value,session_value,second_run);
 IF pair_a->>'state'<>'pair_source_verified' OR
  pair_b->>'state'<>'pair_source_verified' OR
  result_value->'target' IS DISTINCT FROM pair_a->'output'->'target' OR
  result_value->'target' IS DISTINCT FROM pair_b->'output'->'target' OR
  result_value->'unit' IS DISTINCT FROM pair_a->'output'->'unit' OR
  result_value->'unit' IS DISTINCT FROM pair_b->'output'->'unit' OR
  result_value->'applicability' IS DISTINCT FROM pair_a->'output'->'applicability' OR
  result_value->'applicability' IS DISTINCT FROM pair_b->'output'->'applicability' OR
  result_value->>'calculationVersion' IS DISTINCT FROM
   pair_a->'output'->>'calculationVersion' OR
  result_value->>'calculationVersion' IS DISTINCT FROM
   pair_b->'output'->>'calculationVersion' OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(result_value->'comparisons') elem
   WHERE (elem->>'forecastRunId'=first_run::text AND
     elem->>'outcomeReceiptId' IS DISTINCT FROM
      CASE WHEN actual_a->>'state' IN ('pair_actual_known','pair_actual_revoked')
       THEN actual_a->>'receiptId' ELSE NULL END)
    OR (elem->>'forecastRunId'=second_run::text AND
     elem->>'outcomeReceiptId' IS DISTINCT FROM
      CASE WHEN actual_b->>'state' IN ('pair_actual_known','pair_actual_revoked')
       THEN actual_b->>'receiptId' ELSE NULL END)) THEN
  RETURN jsonb_build_object('state','price_flow_evaluation_unavailable',
   'reason','source_changed');
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(result_value->'comparisons') LOOP
  IF item->>'forecastRunId'=first_run::text THEN
   linked:=pair_a;
   linked_actual:=actual_a;
  ELSE
   linked:=pair_b;
   linked_actual:=actual_b;
  END IF;
  profile_check:=public.canonical_forecast_profile_effective_window(
   org,actor,role_value,session_value,
   (linked->>'profileAnchorId')::uuid,
   (linked->'output'->'horizon'->>'startsAt')::timestamptz,
   (linked->'output'->'horizon'->>'endsAt')::timestamptz);
  IF profile_check->>'state'<>'profile_effective_window_verified' OR
   item->'forecastValue' IS DISTINCT FROM linked->'output'->'value' OR
   item->>'sourceSnapshotDigest' IS DISTINCT FROM
    linked->'output'->>'sourceSnapshotDigest' OR
   item->'horizon' IS DISTINCT FROM linked->'output'->'horizon' OR
   item->>'outcomeSourceDigest' IS DISTINCT FROM
    linked_actual->>'sourceDigest' OR
   item->>'outcomeCutoff' IS DISTINCT FROM
    linked_actual->>'observedThrough' OR
   (linked_actual->>'state'='pair_actual_known' AND
    (item->>'status' NOT IN ('paired','window_normalization_required') OR
     (item->>'status'='paired' AND item->>'outcomeAmount' IS DISTINCT FROM
      linked_actual->>'amount') OR
     (item->>'status'='window_normalization_required' AND
      item->>'outcomeAmount' IS NOT NULL))) OR
   (linked_actual->>'state' IS DISTINCT FROM 'pair_actual_known' AND
    (item->>'status'<>'outcome_unavailable' OR
     item->>'outcomeAmount' IS NOT NULL)) THEN
   RETURN jsonb_build_object('state','price_flow_evaluation_unavailable',
    'reason','source_changed');
  END IF;
 END LOOP;
 result_hash:=public.canonical_completion_digest(result_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 requested:=encode(sha256(convert_to(jsonb_build_object(
  'firstRunId',first_run,'secondRunId',second_run)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_evaluations
  WHERE organization_id=org AND first_run_id=first_run
   AND second_run_id=second_run ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.canonical_forecast_price_flow_evaluations(
  organization_id,first_run_id,second_run_id,revision,previous_id,
  result,result_digest,captured_at,actor_user_id,auth_session_id,
  request_key_hash,request_digest)
 VALUES(org,first_run,second_run,COALESCE(prior.revision,0)+1,prior.id,
  result_value,result_hash,clock_timestamp(),actor,session_value,
  key_hash,requested) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','price_flow_evaluation_saved',
  'evaluationId',inserted.id,'revision',inserted.revision,
  'previousId',inserted.previous_id,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_evaluations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_evaluation_replay(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_price_flow_evaluation(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,JSONB) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_evaluations
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_evaluation_replay(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_price_flow_evaluation(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,JSONB) TO northstar_app_runtime;
END IF; END $$;
