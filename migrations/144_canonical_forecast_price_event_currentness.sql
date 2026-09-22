-- Mission 26 Part 6A/12A: compare an immutable M24 price-event receipt with
-- current tenant-visible decision history. This read never changes the source.

CREATE FUNCTION public.canonical_forecast_price_event_currentness_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved JSONB;cutoff TIMESTAMPTZ;current_events JSONB;
 captured_events JSONB;captured_digest TEXT;current_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 -- This read enforces the current paid owner/admin, session and tenant gates.
 -- A historical receipt never grants permission by itself.
 saved:=public.canonical_forecast_price_event_snapshot_read(
   org,actor,role_value,session_value,snapshot_value);
 IF saved IS NULL THEN RETURN NULL;END IF;
 cutoff:=clock_timestamp();
 current_events:=public.canonical_forecast_price_decision_events(org,cutoff);
 IF jsonb_array_length(current_events)>1000 OR
    octet_length(current_events::text)>262144 OR
    (SELECT count(DISTINCT event->>'estimateId')
       FROM jsonb_array_elements(current_events) event)>256 THEN
  RAISE EXCEPTION 'Forecast price-event comparison exceeds bounded source size'
   USING ERRCODE='54000';END IF;
 captured_events:=saved->'events';
 captured_digest:=public.canonical_completion_digest(captured_events);
 current_digest:=public.canonical_completion_digest(current_events);
 RETURN jsonb_build_object(
  'snapshotId',saved->>'id',
  'sourceSnapshotDigest',saved->>'sourceSnapshotDigest',
  'asOf',saved->>'asOf',
  'checkedAt',public.canonical_forecast_utc_instant(cutoff),
  'state',CASE WHEN captured_events=current_events THEN 'current' ELSE 'stale' END,
  'capturedEventCount',jsonb_array_length(captured_events),
  'currentEventCount',jsonb_array_length(current_events),
  'capturedEventsDigest',captured_digest,
  'currentEventsDigest',current_digest,
  'forecastIssued',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_event_currentness_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_event_currentness_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
