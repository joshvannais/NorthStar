-- Mission 26 Part 4D: expose the immutable person-plan composition marker to
-- the new guarded entries without changing the deployed migration 209 response
-- contract used by an older application process during a rolling deployment.

CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_capture_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB;snapshot_id UUID;composition_version TEXT;
BEGIN
 result:=public.canonical_forecast_current_backlog_snapshot_capture(
  org,actor,role_value,session_value,csrf,key_value);
 BEGIN
  snapshot_id:=(result#>>'{snapshot,id}')::uuid;
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Current backlog composition projection unavailable'
   USING ERRCODE='55000';
 END;
 SELECT person_plan_composition_version INTO composition_version
 FROM public.canonical_forecast_current_backlog_snapshots
 WHERE organization_id=org AND id=snapshot_id;
 IF composition_version IS NULL THEN
  RAISE EXCEPTION 'Current backlog composition projection unavailable'
   USING ERRCODE='55000';
 END IF;
 RETURN jsonb_set(result,'{snapshot,personPlanCompositionVersion}',
  to_jsonb(composition_version),TRUE);
END $$;

CREATE FUNCTION public.canonical_forecast_current_backlog_snapshot_read_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB;composition_version TEXT;
BEGIN
 result:=public.canonical_forecast_current_backlog_snapshot_read(
  org,actor,role_value,session_value,snapshot_id);
 SELECT person_plan_composition_version INTO composition_version
 FROM public.canonical_forecast_current_backlog_snapshots
 WHERE organization_id=org AND id=snapshot_id;
 IF composition_version IS NULL THEN
  RAISE EXCEPTION 'Current backlog composition projection unavailable'
   USING ERRCODE='55000';
 END IF;
 RETURN jsonb_set(result,'{personPlanCompositionVersion}',
  to_jsonb(composition_version),TRUE);
END $$;

REVOKE ALL ON FUNCTION
 public.canonical_forecast_current_backlog_snapshot_capture_v2(
  UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION
 public.canonical_forecast_current_backlog_snapshot_read_v2(
  UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
