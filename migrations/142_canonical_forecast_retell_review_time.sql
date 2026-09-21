-- Mission 26 Part 4A. Expose the recorded review time through the existing
-- guarded read. This is review evidence, not provider coverage or a forecast.
CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_reviews_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt JSONB;pin JSONB;latest public.canonical_forecast_retell_call_reviews%ROWTYPE;
 anchor_row public.canonical_forecast_retell_call_reviews%ROWTYPE;
 items JSONB:='[]'::jsonb;state_value TEXT;reviewed_count INTEGER:=0;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Call review access restricted' USING ERRCODE='42501';END IF;
 receipt:=public.canonical_forecast_retell_call_snapshot_read(org,actor,role_value,session_value,snapshot_value);
 IF receipt IS NULL THEN RETURN NULL;END IF;
 IF receipt->>'stale'='true' THEN
  RETURN jsonb_build_object('snapshotId',snapshot_value,'stale',TRUE,'calls','[]'::jsonb,
   'reason','The recorded call source changed. Capture a new receipt before reviewing calls.');
 END IF;
 FOR pin IN SELECT value FROM jsonb_array_elements(receipt->'sources') value LOOP
  SELECT * INTO latest FROM public.canonical_forecast_retell_call_reviews
   WHERE organization_id=org AND transcript_id=(pin->>'sourceId')::uuid
   ORDER BY revision DESC LIMIT 1;
  state_value:='unresolved';
  IF latest.id IS NOT NULL AND latest.source_digest=pin->>'digest' AND
    latest.disposition<>'unresolved' THEN
   state_value:='reviewed';
   IF latest.disposition='repeat_lead' THEN
    SELECT * INTO anchor_row FROM public.canonical_forecast_retell_call_reviews
     WHERE organization_id=org AND transcript_id=latest.anchor_transcript_id
     ORDER BY revision DESC LIMIT 1;
    IF anchor_row.id IS DISTINCT FROM latest.anchor_review_id OR
       anchor_row.source_digest IS DISTINCT FROM (
         SELECT x->>'digest' FROM jsonb_array_elements(receipt->'sources')x
          WHERE x->>'sourceId'=latest.anchor_transcript_id::text) THEN state_value:='unresolved';END IF;
   END IF;
  END IF;
  IF state_value='reviewed' THEN reviewed_count:=reviewed_count+1;END IF;
  items:=items||jsonb_build_array(jsonb_build_object('callSourceId',pin->>'sourceId',
   'status',state_value,'disposition',CASE WHEN state_value='reviewed' THEN latest.disposition ELSE NULL END,
   'anchorCallSourceId',CASE WHEN state_value='reviewed' THEN latest.anchor_transcript_id ELSE NULL END,
   'reviewRevision',CASE WHEN latest.id IS NULL THEN 0 ELSE latest.revision END,
   'reviewDigest',CASE WHEN latest.id IS NULL THEN NULL ELSE latest.canonical_digest END,
   'reviewedAt',CASE WHEN state_value='reviewed' THEN
      public.canonical_forecast_utc_instant(latest.created_at) ELSE NULL END));
 END LOOP;
 RETURN jsonb_build_object('snapshotId',snapshot_value,'stale',FALSE,
  'sourceSnapshotDigest',receipt->>'sourceSnapshotDigest','callCount',jsonb_array_length(items),
  'reviewedCount',reviewed_count,'unresolvedCount',jsonb_array_length(items)-reviewed_count,
  'calls',items,'boundary','Call dispositions are review evidence, not certified provider coverage or a lead forecast.');
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_reviews_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
