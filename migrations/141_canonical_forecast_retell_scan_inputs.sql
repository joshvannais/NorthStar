-- Mission 26 Part 4A: guarded internal input to a Retell call-list diagnostic.
-- Hashed call identities are not lead identities or a coverage certificate.

CREATE FUNCTION public.canonical_forecast_retell_scan_inputs_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID,
 window_start TIMESTAMPTZ,window_end TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt JSONB;pin JSONB;active_count INTEGER;active_ownership UUID;agent_id TEXT;
 external_id TEXT;occurred TIMESTAMPTZ;digests JSONB:='[]'::jsonb;
BEGIN
 -- Reuse current membership, session, entitlement, consent and source-revision gates.
 receipt:=public.canonical_forecast_retell_call_snapshot_read(
  org,actor,role_value,session_value,snapshot_value);
 IF receipt IS NULL THEN RETURN NULL;END IF;
 IF receipt->>'stale'='true' THEN
  RETURN jsonb_build_object('state','unavailable','reason','source_stale');END IF;
 IF window_start IS NULL OR window_end IS NULL OR window_start>=window_end OR
    window_end-window_start>INTERVAL '35 days' OR
    window_end>(receipt->>'asOf')::timestamptz THEN
  RAISE EXCEPTION 'Invalid Retell scan window' USING ERRCODE='22023';END IF;
 SELECT count(*),min(id::text)::uuid,min(external_integration_id)
  INTO active_count,active_ownership,agent_id
  FROM public.canonical_integration_ownership
  WHERE organization_id=org AND provider='retell' AND status='active';
 IF active_count<>1 OR agent_id IS NULL THEN
  RETURN jsonb_build_object('state','unavailable','reason','integration_ownership_unavailable');END IF;
 FOR pin IN SELECT value FROM jsonb_array_elements(receipt->'sources') value LOOP
  external_id:=NULL;occurred:=NULL;
  SELECT transcript.external_call_id,transcript.occurred_at INTO external_id,occurred
   FROM public.canonical_transcripts transcript
   JOIN public.canonical_voice_sessions voice_session
    ON voice_session.organization_id=transcript.organization_id
    AND voice_session.canonical_operation_id=transcript.operation_id
    AND voice_session.provider='retell'
    AND voice_session.provider_session_id=transcript.external_call_id
    AND voice_session.integration_ownership_id=active_ownership
   WHERE transcript.organization_id=org AND transcript.id=(pin->>'sourceId')::uuid;
  IF external_id IS NULL OR occurred IS NULL THEN
   RETURN jsonb_build_object('state','unavailable','reason','call_identity_or_time_unavailable');END IF;
  IF occurred>=window_start AND occurred<window_end THEN
   digests:=digests||jsonb_build_array(encode(sha256(convert_to(external_id,'UTF8')),'hex'));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('state','ready_for_diagnostic','agentId',agent_id,
  'startsAt',public.canonical_forecast_utc_instant(window_start),
  'endsAt',public.canonical_forecast_utc_instant(window_end),
  'canonicalCallDigests',digests,'sourceSnapshotDigest',receipt->>'sourceSnapshotDigest',
  'historicalCoverageCertified',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_retell_scan_inputs_read(
 UUID,UUID,TEXT,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_scan_inputs_read(
  UUID,UUID,TEXT,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO northstar_app_runtime;
END IF;END $$;
