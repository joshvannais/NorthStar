-- Mission 26 Part 3B: a separate pre-horizon observation that the
-- prospective Business Profile anchor and its activation were committed.
-- The later paired reader must also prove the profile stayed effective
-- through the horizon; this witness alone does not create a backtest.
CREATE TABLE public.canonical_forecast_price_flow_profile_witnesses (
 organization_id UUID NOT NULL,
 run_id UUID NOT NULL,
 profile_anchor_id UUID NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 proof_digest TEXT NOT NULL CHECK(proof_digest~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,run_id),
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,profile_anchor_id)
  REFERENCES public.canonical_forecast_profile_effective_anchors(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT
);
CREATE TRIGGER canonical_forecast_price_flow_profile_witness_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_profile_witnesses
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_price_flow_profile_observe(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 run_value UUID,anchor_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 activation public.canonical_forecast_profile_effective_activations%ROWTYPE;
 anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 old public.canonical_forecast_price_flow_profile_witnesses%ROWTYPE;
 activation_xid XID8; observed TIMESTAMPTZ; digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  run_value IS NULL OR anchor_value IS NULL THEN
  RAISE EXCEPTION 'Profile witness request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Profile source busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','profile_witness_unavailable',
   'reason','run_not_found');
 END IF;
 SELECT * INTO old FROM public.canonical_forecast_price_flow_profile_witnesses
  WHERE organization_id=org AND run_id=run_value;
 IF FOUND THEN
  IF old.profile_anchor_id<>anchor_value THEN
   RAISE EXCEPTION 'Profile witness changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','profile_witness_recorded',
   'runId',run_value,'profileAnchorId',anchor_value,
   'proofDigest',old.proof_digest,'replayed',TRUE);
 END IF;
 observed:=clock_timestamp();
 IF observed>=saved.horizon_start THEN
  RETURN jsonb_build_object('state','profile_witness_unavailable',
   'reason','horizon_started');
 END IF;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 SELECT * INTO activation FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF anchor_row.id IS NULL OR activation.anchor_id IS NULL OR
  activation.observed_at>=saved.saved_at OR
  anchor_row.captured_at>=saved.saved_at OR
  activation.observed_at>=saved.horizon_start OR
  anchor_row.captured_at>=saved.horizon_start THEN
  RETURN jsonb_build_object('state','profile_witness_unavailable',
   'reason','prospective_profile_unverified');
 END IF;
 SELECT xmin::text::xid8 INTO activation_xid
  FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF pg_xact_status(activation_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','profile_witness_unavailable',
   'reason','profile_activation_commit_unverified');
 END IF;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'runId',run_value,'profileAnchorId',anchor_value,
  'profileId',anchor_row.business_profile_id,
  'profileHash',rtrim(anchor_row.business_profile_hash),
  'activationObservedAt',public.canonical_forecast_utc_instant(activation.observed_at),
  'witnessObservedAt',public.canonical_forecast_utc_instant(observed)));
 INSERT INTO public.canonical_forecast_price_flow_profile_witnesses(
  organization_id,run_id,profile_anchor_id,observed_at,actor_user_id,
  auth_session_id,proof_digest)
 VALUES(org,run_value,anchor_value,observed,actor,session_value,digest_value);
 RETURN jsonb_build_object('state','profile_witness_recorded',
  'runId',run_value,'profileAnchorId',anchor_value,
  'proofDigest',digest_value,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_profile_witness_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE witness public.canonical_forecast_price_flow_profile_witnesses%ROWTYPE;
 saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO witness FROM public.canonical_forecast_price_flow_profile_witnesses
  WHERE organization_id=org AND run_id=run_value;
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 IF witness.run_id IS NULL OR saved.id IS NULL OR
  witness.observed_at>=saved.horizon_start THEN
  RETURN jsonb_build_object('state','profile_witness_unavailable');
 END IF;
 RETURN jsonb_build_object('state','profile_witness_recorded',
  'runId',run_value,'profileAnchorId',witness.profile_anchor_id,
  'observedAt',public.canonical_forecast_utc_instant(witness.observed_at),
  'proofDigest',witness.proof_digest);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_pair_source_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 source_row public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 origin_proof public.canonical_forecast_price_flow_origin_activations%ROWTYPE;
 profile_proof public.canonical_forecast_price_flow_profile_witnesses%ROWTYPE;
 profile_anchor public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 profile_activation public.canonical_forecast_profile_effective_activations%ROWTYPE;
 latest_recorded TIMESTAMPTZ; source_asof TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for price-flow pair source'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','pair_source_unavailable',
   'reason','run_not_found');
 END IF;
 SELECT * INTO source_row FROM public.canonical_forecast_price_ordered_receipts
  WHERE organization_id=org AND id=saved.source_receipt_id;
 SELECT * INTO origin_proof FROM public.canonical_forecast_price_flow_origin_activations
  WHERE organization_id=org AND run_id=run_value;
 SELECT * INTO profile_proof FROM public.canonical_forecast_price_flow_profile_witnesses
  WHERE organization_id=org AND run_id=run_value;
 SELECT * INTO profile_anchor FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=profile_proof.profile_anchor_id;
 SELECT * INTO profile_activation FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=profile_proof.profile_anchor_id;
 source_asof:=to_char(date_trunc('milliseconds',source_row.captured_at)
  AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 IF source_row.id IS NULL OR origin_proof.run_id IS NULL OR
  profile_proof.run_id IS NULL OR
  profile_anchor.id IS NULL OR profile_activation.anchor_id IS NULL OR
  profile_anchor.captured_at>=saved.saved_at OR
  profile_activation.observed_at>=saved.saved_at OR
  profile_anchor.captured_at>=saved.horizon_start OR
  profile_activation.observed_at>=saved.horizon_start OR
  origin_proof.observed_at>=saved.horizon_start OR
  profile_proof.observed_at>=saved.horizon_start OR
  origin_proof.proof->>'savedReceiptDigest' IS DISTINCT FROM saved.receipt_digest OR
  saved.output->>'sourceSnapshotDigest' IS DISTINCT FROM rtrim(source_row.snapshot_digest) OR
  saved.output->>'asOf' IS DISTINCT FROM source_asof OR
  saved.output->'horizon'->>'startsAt' IS DISTINCT FROM
   to_char(saved.horizon_start AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') OR
  saved.output->'horizon'->>'endsAt' IS DISTINCT FROM
   to_char(saved.horizon_end AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
  RETURN jsonb_build_object('state','pair_source_unavailable',
   'reason','source_pin_unverified');
 END IF;
 IF jsonb_typeof(source_row.decision_events)<>'array' OR
  jsonb_array_length(source_row.decision_events)>1000 THEN
  RETURN jsonb_build_object('state','pair_source_unavailable',
   'reason','source_limit_exceeded');
 END IF;
 SELECT max((event->>'recordedAt')::timestamptz) INTO latest_recorded
  FROM jsonb_array_elements(source_row.decision_events) event;
 IF latest_recorded>source_row.captured_at THEN
  RETURN jsonb_build_object('state','pair_source_unavailable',
   'reason','source_time_invalid');
 END IF;
 RETURN jsonb_build_object('state','pair_source_verified',
  'runId',saved.id,'savedAt',to_char(date_trunc('milliseconds',saved.saved_at)
    AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'output',saved.output,'sourceReceiptDigest',saved.receipt_digest,
  'sourceSnapshotAsOf',source_asof,
  'latestSourceRecordedAt',CASE WHEN latest_recorded IS NULL THEN NULL
   ELSE to_char(date_trunc('milliseconds',latest_recorded)
    AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
  'profileAnchorId',profile_proof.profile_anchor_id,
  'profileProofDigest',profile_proof.proof_digest);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_pair_actual_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE guarded JSONB;
 latest public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
BEGIN
 guarded:=public.canonical_forecast_price_flow_actual_read(
  org,actor,role_value,session_value,run_value);
 IF guarded->>'state' NOT IN ('price_flow_actual_finalized',
  'price_flow_actual_revoked') THEN
  RETURN jsonb_build_object('state','pair_actual_unavailable',
   'reason',COALESCE(guarded->>'reason','actual_unavailable'));
 END IF;
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND run_id=run_value
  ORDER BY revision DESC LIMIT 1;
 IF latest.id IS NULL OR latest.id::text IS DISTINCT FROM guarded->>'receiptId' THEN
  RETURN jsonb_build_object('state','pair_actual_unavailable',
   'reason','actual_changed');
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN latest.state='known'
   THEN 'pair_actual_known' ELSE 'pair_actual_revoked' END,
  'runId',run_value,'receiptId',latest.id,'revision',latest.revision,
  'sourceDigest',latest.source_snapshot_digest,
  'observedThrough',to_char(date_trunc('milliseconds',latest.observed_through)
   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'capturedAt',to_char(date_trunc('milliseconds',latest.captured_at)
   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'amount',CASE WHEN latest.state='known' THEN latest.amount::text ELSE NULL END,
  'reason',CASE WHEN latest.state='revoked' THEN 'source_revoked' ELSE NULL END);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_profile_witnesses FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_profile_observe(
 UUID,UUID,TEXT,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_profile_witness_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_pair_source_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_pair_actual_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_profile_witnesses
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_profile_observe(
  UUID,UUID,TEXT,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_profile_witness_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_pair_source_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_pair_actual_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
