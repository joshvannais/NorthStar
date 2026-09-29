-- Mission 26 Part 3C: the runtime may measure a saved Part 3B result only
-- after the current tenant/source manifest has been checked. The private
-- numerical result never crosses the paid HTTP response boundary.
CREATE FUNCTION public.canonical_forecast_price_flow_evaluation_private_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE manifest JSONB;
 saved public.canonical_forecast_price_flow_evaluations%ROWTYPE;
BEGIN
 manifest:=public.canonical_forecast_price_flow_evaluation_manifest(
  org,actor,role_value,session_value,evaluation_value);
 IF manifest->>'state'<>'evaluation_manifest_available' THEN
  RETURN jsonb_build_object('state','evaluation_measurement_unavailable',
   'reason','source_evidence_unavailable');
 END IF;
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_evaluations
  WHERE organization_id=org AND id=evaluation_value;
 IF saved.id IS NULL OR
  saved.result_digest IS DISTINCT FROM public.canonical_completion_digest(saved.result) THEN
  RETURN jsonb_build_object('state','evaluation_measurement_unavailable',
   'reason','saved_result_unavailable');
 END IF;
 RETURN jsonb_build_object('state','evaluation_measurement_source_verified',
  'evaluationId',saved.id,'revision',saved.revision,
  'manifest',manifest,'result',saved.result,
  'sourceProvenance',saved.source_provenance);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_evaluation_private_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_evaluation_private_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
