-- Mission 26 Part 2D: bounded, purpose-fixed lineage replay for the exact
-- post-installation Mission 24 approved-estimate authority introduced by 211.
-- This is a read-only recovery lane over immutable v2 receipts. It does not
-- create a forecast run, infer retention/deletion policy, or accept manifests.

CREATE FUNCTION public.canonical_forecast_approved_estimate_v2_lineage_replay(
 org UUID,actor UUID,role_value TEXT,session_value UUID,request JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot_ids JSONB;cursor_value JSONB;limit_value INTEGER;
 request_digest TEXT;generation_digest TEXT;offset_value INTEGER:=0;
 item_count INTEGER;item_index INTEGER;selected_id UUID;
 selected public.canonical_forecast_approved_estimate_v2_snapshots%ROWTYPE;
 epoch public.canonical_forecast_approved_estimate_v2_epochs%ROWTYPE;
 state_row public.canonical_forecast_approved_estimate_v2_states%ROWTYPE;
 source_current BOOLEAN;items JSONB:='[]'::jsonb;next_cursor JSONB:=NULL;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Approved-estimate replay access restricted' USING ERRCODE='42501';END IF;
 IF request IS NULL OR jsonb_typeof(request)<>'object' OR
   (SELECT count(*) FROM jsonb_object_keys(request))<>3 OR
   NOT (request ? 'snapshotIds' AND request ? 'cursor' AND request ? 'limit') OR
   jsonb_typeof(request->'snapshotIds')<>'array' OR
   jsonb_typeof(request->'limit')<>'number' THEN
  RAISE EXCEPTION 'Approved-estimate replay request invalid' USING ERRCODE='22023';END IF;
 snapshot_ids:=request->'snapshotIds';cursor_value:=request->'cursor';
 BEGIN limit_value:=(request->>'limit')::INTEGER;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Approved-estimate replay request invalid' USING ERRCODE='22023';
 END;
 item_count:=jsonb_array_length(snapshot_ids);
 IF item_count NOT BETWEEN 1 AND 100 OR limit_value NOT BETWEEN 1 AND 25 OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot_ids) value
    WHERE jsonb_typeof(value)<>'string' OR
      value#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') OR
   (SELECT count(DISTINCT value#>>'{}') FROM jsonb_array_elements(snapshot_ids) value)
      <>item_count THEN
  RAISE EXCEPTION 'Approved-estimate replay request invalid' USING ERRCODE='22023';END IF;

 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Approved-estimate source is busy' USING ERRCODE='55P03';END IF;
 -- Recheck after acquiring the source writer fence. Access loss cannot be
 -- bypassed by waiting on the fence or resuming a cursor.
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=org;
 SELECT * INTO state_row FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=org;
 IF epoch.organization_id IS NULL OR state_row.organization_id IS NULL THEN
  RAISE EXCEPTION 'Approved-estimate replay authority unavailable' USING ERRCODE='55000';END IF;

 request_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-approved-estimate-lineage-replay-request-v2',
  'organizationId',org,'snapshotIds',snapshot_ids));
 generation_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-approved-estimate-lineage-generation-v2',
  'organizationId',org,'coverageState',epoch.coverage_state,
  'coverageStartsAt',public.canonical_forecast_utc_instant(epoch.coverage_starts_at),
  'coverageStartOrder',epoch.coverage_start_order,
  'stateCoverageStartsAt',public.canonical_forecast_utc_instant(state_row.coverage_starts_at),
  'highWaterOrder',state_row.high_water_order,
  'orderingComplete',state_row.ordering_complete));

 IF jsonb_typeof(cursor_value)='null' THEN offset_value:=0;
 ELSIF jsonb_typeof(cursor_value)<>'object' OR
   (SELECT count(*) FROM jsonb_object_keys(cursor_value))<>4 OR
   NOT (cursor_value ? 'version' AND cursor_value ? 'offset' AND
    cursor_value ? 'requestDigest' AND cursor_value ? 'currentGenerationDigest') OR
   jsonb_typeof(cursor_value->'version')<>'string' OR
   jsonb_typeof(cursor_value->'offset')<>'number' OR
   jsonb_typeof(cursor_value->'requestDigest')<>'string' OR
   jsonb_typeof(cursor_value->'currentGenerationDigest')<>'string' OR
   (cursor_value->>'version') IS DISTINCT FROM
    'm26-approved-estimate-lineage-replay-v2' OR
   (cursor_value->>'requestDigest') IS DISTINCT FROM request_digest OR
   (cursor_value->>'currentGenerationDigest') IS DISTINCT FROM generation_digest OR
   (cursor_value->>'requestDigest')!~'^[0-9a-f]{64}$' OR
   (cursor_value->>'currentGenerationDigest')!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Approved-estimate replay cursor changed' USING ERRCODE='40001';
 ELSE
  BEGIN offset_value:=(cursor_value->>'offset')::INTEGER;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   RAISE EXCEPTION 'Approved-estimate replay cursor changed' USING ERRCODE='40001';
  END;
  IF offset_value IS NULL OR offset_value<=0 OR offset_value>=item_count THEN
   RAISE EXCEPTION 'Approved-estimate replay cursor changed' USING ERRCODE='40001';END IF;
 END IF;

 FOR item_index IN offset_value..LEAST(offset_value+limit_value,item_count)-1 LOOP
  selected_id:=(snapshot_ids->>item_index)::UUID;
  SELECT * INTO selected FROM public.canonical_forecast_approved_estimate_v2_snapshots
   WHERE organization_id=org AND id=selected_id;
  IF selected.id IS NULL THEN RETURN NULL;END IF;
  source_current:=epoch.coverage_state='complete' AND
   epoch.coverage_starts_at=selected.coverage_starts_at AND
   epoch.coverage_start_order=selected.coverage_start_order AND
   state_row.ordering_complete AND
   state_row.coverage_starts_at=epoch.coverage_starts_at AND
   NOT public.canonical_forecast_approved_estimate_v2_gap(org,epoch.coverage_starts_at) AND
   state_row.high_water_order=selected.high_water_order;
  items:=items||jsonb_build_array(jsonb_build_object(
   'snapshot',public.canonical_forecast_approved_estimate_v2_projection(selected),
   'state',CASE WHEN source_current THEN 'current' ELSE 'stale' END,
   'sourceCurrent',source_current,'eligibleForForecast',FALSE,'forecastIssued',FALSE));
 END LOOP;

 IF offset_value+jsonb_array_length(items)<item_count THEN
  next_cursor:=jsonb_build_object(
   'version','m26-approved-estimate-lineage-replay-v2',
   'offset',offset_value+jsonb_array_length(items),
   'requestDigest',request_digest,
   'currentGenerationDigest',generation_digest);
 END IF;
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object(
  'version','m26-approved-estimate-lineage-replay-v2','items',items,
  'nextCursor',next_cursor,'sourceAuthenticated',TRUE,
  'targetComplete',TRUE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_approved_estimate_v2_lineage_replay(
 UUID,UUID,TEXT,UUID,JSONB) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_approved_estimate_v2_lineage_replay(
  UUID,UUID,TEXT,UUID,JSONB) TO northstar_app_runtime;
END IF;END $$;
