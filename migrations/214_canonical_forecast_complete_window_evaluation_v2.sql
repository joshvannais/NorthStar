-- Mission 26 Part 3B target-complete authority. This purpose-fixed receipt
-- inventories the entire bounded server-selected registered-M24 window. The
-- caller supplies only an idempotency key; it cannot select origins, truncate
-- the window, or submit forecasts, actuals, or an evidence manifest.
CREATE TABLE public.canonical_forecast_complete_window_evaluations_v2 (
 organization_id UUID NOT NULL,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 revision INTEGER NOT NULL CHECK(revision>0),
 previous_id UUID,
 anchor_run_id UUID NOT NULL,
 window_start TIMESTAMPTZ NOT NULL,
 window_end TIMESTAMPTZ NOT NULL,
 evidence JSONB NOT NULL,
 evidence_digest TEXT NOT NULL CHECK(evidence_digest~'^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,revision),
 CHECK(window_end-window_start=INTERVAL '60 days'),
 CHECK(pg_column_size(evidence)<=262144),
 CHECK(evidence->>'version'='m26-complete-window-evaluation-v2'),
 CHECK(evidence->>'organizationId'=organization_id::text),
 CHECK((evidence->>'anchorRunId')::uuid=anchor_run_id),
 CHECK((evidence->>'windowStart')::timestamptz=window_start),
 CHECK((evidence->>'windowEnd')::timestamptz=window_end),
 CHECK(jsonb_typeof(evidence->'origins')='array'),
 CHECK(jsonb_array_length(evidence->'origins') BETWEEN 1 AND 100),
 CHECK(evidence_digest=public.canonical_completion_digest(evidence)),
 FOREIGN KEY(organization_id,anchor_run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_complete_window_evaluations_v2(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_complete_window_evaluations_v2_latest
 ON public.canonical_forecast_complete_window_evaluations_v2
 (organization_id,revision DESC,id DESC);
CREATE TRIGGER canonical_forecast_complete_window_evaluations_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_complete_window_evaluations_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

-- Build the authoritative non-numeric evidence receipt under the same per-run
-- locks used by genuine actual writers. Actual receipt digests commit the
-- private amount without returning or duplicating it in this receipt.
CREATE FUNCTION public.canonical_forecast_complete_window_evidence_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE window_value JSONB; origin JSONB; source_value JSONB;
 actual_value JSONB; profile_value JSONB; evidence_rows JSONB:='[]'::jsonb;
 actual_row public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 run_value UUID; evidence_state TEXT; reason_value TEXT;
 paired_count INTEGER:=0; missing_count INTEGER:=0;
 revoked_count INTEGER:=0; excluded_count INTEGER:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Complete-window evaluation requires read committed'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 window_value:=public.canonical_forecast_price_flow_complete_window(
  org,actor,role_value,session_value);
 IF window_value->>'state'<>'complete_saved_origin_window_observed' THEN
  RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
   'reason',COALESCE(window_value->>'reason','complete_window_unavailable'));
 END IF;
 IF (window_value->>'expectedUtcDays')::integer<>60 OR
  jsonb_typeof(window_value->'origins')<>'array' OR
  jsonb_array_length(window_value->'origins') NOT BETWEEN 1 AND 100 OR
  (window_value->>'storedOriginCount')::integer<>
   jsonb_array_length(window_value->'origins') THEN
  RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
   'reason','complete_window_invalid');
 END IF;
 -- Locks are acquired in UUID order before any guarded source is read.
 FOR run_value IN
  SELECT (entry->>'runId')::uuid
  FROM jsonb_array_elements(window_value->'origins') entry
  WHERE entry->>'eligibility'='matching_context'
  ORDER BY (entry->>'runId')::uuid
 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-flow-actual:'||org::text||':'||run_value::text,0)) THEN
   RAISE EXCEPTION 'Complete-window evaluation actual busy' USING ERRCODE='55P03';
  END IF;
 END LOOP;
 FOR origin IN SELECT value FROM jsonb_array_elements(window_value->'origins') LOOP
  run_value:=(origin->>'runId')::uuid;
  IF origin->>'eligibility'='excluded_context' THEN
   evidence_state:='excluded'; reason_value:='context_changed';
   excluded_count:=excluded_count+1;
   evidence_rows:=evidence_rows||jsonb_build_array(jsonb_build_object(
    'runId',run_value,'horizonStart',origin->>'horizonStart',
    'horizonEnd',origin->>'horizonEnd','eligibility','excluded_context',
    'state',evidence_state,'reason',reason_value,
    'sourceReceiptDigest',NULL,'profileAnchorId',NULL,
    'profileProofDigest',NULL,'outcomeReceiptId',NULL,
    'outcomeRevision',NULL,'outcomeReceiptDigest',NULL,
    'outcomeCutoff',NULL,'outcomeSourceDigest',NULL));
   CONTINUE;
  END IF;
  IF origin->>'eligibility'<>'matching_context' THEN
   RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
    'reason','origin_eligibility_invalid');
  END IF;
  source_value:=public.canonical_forecast_price_flow_pair_source_read(
   org,actor,role_value,session_value,run_value);
  IF source_value->>'state'<>'pair_source_verified' THEN
   RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
    'reason','source_evidence_unavailable');
  END IF;
  IF source_value->'output'->'target'->>'key'<>'revenue.approved_price_flow' OR
   source_value->'output'->'target'->>'definitionVersion'<>'v1' OR
   source_value->'output'->>'calculationVersion'<>'m26_price_flow_carry_forward_v1' OR
   (source_value->'output'->'horizon'->>'startsAt')::timestamptz IS DISTINCT FROM
    (origin->>'horizonStart')::timestamptz OR
   (source_value->'output'->'horizon'->>'endsAt')::timestamptz IS DISTINCT FROM
    (origin->>'horizonEnd')::timestamptz THEN
   RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
    'reason','origin_identity_changed');
  END IF;
  profile_value:=public.canonical_forecast_profile_effective_window(
   org,actor,role_value,session_value,(source_value->>'profileAnchorId')::uuid,
   (origin->>'horizonStart')::timestamptz,(origin->>'horizonEnd')::timestamptz);
  actual_value:=public.canonical_forecast_price_flow_pair_actual_read(
   org,actor,role_value,session_value,run_value);
  SELECT * INTO actual_row
   FROM public.canonical_forecast_price_flow_actual_receipts
   WHERE organization_id=org AND run_id=run_value
   ORDER BY revision DESC LIMIT 1;
  IF actual_value->>'receiptId' IS NOT NULL AND
   actual_row.id::text IS DISTINCT FROM actual_value->>'receiptId' THEN
   RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
    'reason','actual_generation_changed');
  END IF;
  IF profile_value->>'state'<>'profile_effective_window_verified' THEN
   evidence_state:='excluded'; reason_value:='profile_period_unavailable';
   excluded_count:=excluded_count+1;
  ELSIF actual_value->>'state'='pair_actual_known' THEN
   evidence_state:='paired'; reason_value:=NULL; paired_count:=paired_count+1;
  ELSIF actual_value->>'state'='pair_actual_revoked' THEN
   evidence_state:='revoked'; reason_value:='actual_revoked';
   revoked_count:=revoked_count+1;
  ELSIF actual_value->>'state'='pair_actual_unavailable' AND
   actual_value->>'reason'='no_saved_actual' THEN
   evidence_state:='missing'; reason_value:='actual_not_recorded';
   missing_count:=missing_count+1;
  ELSE
   evidence_state:='excluded';
   reason_value:=COALESCE(actual_value->>'reason','actual_evidence_unavailable');
   excluded_count:=excluded_count+1;
  END IF;
  evidence_rows:=evidence_rows||jsonb_build_array(jsonb_build_object(
   'runId',run_value,'horizonStart',origin->>'horizonStart',
   'horizonEnd',origin->>'horizonEnd','eligibility','matching_context',
   'state',evidence_state,'reason',reason_value,
   'predictionAsOf',source_value->'output'->>'asOf',
   'target',source_value->'output'->'target',
   'unit',source_value->'output'->'unit',
   'applicability',source_value->'output'->'applicability',
   'calculationVersion',source_value->'output'->>'calculationVersion',
   'forecastOutputDigest',public.canonical_completion_digest(source_value->'output'),
   'sourceSnapshotDigest',source_value->'output'->>'sourceSnapshotDigest',
   'sourceSnapshotAsOf',source_value->>'sourceSnapshotAsOf',
   'sourceReceiptDigest',source_value->>'sourceReceiptDigest',
   'profileAnchorId',source_value->>'profileAnchorId',
   'profileProofDigest',source_value->>'profileProofDigest',
   'outcomeReceiptId',actual_value->>'receiptId',
   'outcomeRevision',CASE WHEN actual_value->>'revision' IS NULL THEN NULL
    ELSE (actual_value->>'revision')::integer END,
   'outcomeReceiptDigest',CASE WHEN actual_value->>'receiptId' IS NULL THEN NULL
    ELSE actual_row.receipt_digest END,
   'outcomeCutoff',actual_value->>'observedThrough',
   'outcomeSourceDigest',actual_value->>'sourceDigest'));
 END LOOP;
 RETURN jsonb_build_object('state','complete_window_evidence_current',
  'evidence',jsonb_build_object(
   'version','m26-complete-window-evaluation-v2',
   'organizationId',org,'scope','northstar_m24_registered_saved_origins_only',
   'anchorRunId',window_value->>'anchorRunId',
   'windowStart',window_value->>'windowStart','windowEnd',window_value->>'windowEnd',
   'expectedUtcDays',60,'storedOriginCount',window_value->'storedOriginCount',
   'matchingContextCount',window_value->'matchingContextCount',
   'excludedContextCount',window_value->'excludedContextCount',
   'pairedCount',paired_count,'missingCount',missing_count,
   'revokedCount',revoked_count,'excludedCount',excluded_count,
   'algorithmVersion','m26-rolling-backtest-v1',
   'calculationVersion','m26_price_flow_carry_forward_v1',
   'unsavedOriginCoverageVerified',FALSE,
   'wholeBusinessCoverageVerified',FALSE,
   'empiricalAccuracyAvailable',FALSE,'calibrationAvailable',FALSE,
   'origins',evidence_rows));
END $$;

CREATE FUNCTION public.canonical_forecast_complete_window_evaluation_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE existing public.canonical_forecast_complete_window_evaluations_v2%ROWTYPE;
 prior public.canonical_forecast_complete_window_evaluations_v2%ROWTYPE;
 inserted public.canonical_forecast_complete_window_evaluations_v2%ROWTYPE;
 built JSONB; receipt JSONB; key_hash TEXT; digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Complete-window evaluation request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:complete-window-evaluation-v2:'||org::text,0)) THEN
  RAISE EXCEPTION 'Complete-window evaluation busy' USING ERRCODE='55P03';
 END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 SELECT * INTO existing FROM public.canonical_forecast_complete_window_evaluations_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF existing.id IS NOT NULL THEN
  RETURN jsonb_build_object('state','complete_window_evaluation_saved',
   'evaluationId',existing.id,'revision',existing.revision,
   'previousId',existing.previous_id,'replayed',TRUE);
 END IF;
 built:=public.canonical_forecast_complete_window_evidence_v2(
  org,actor,role_value,session_value);
 IF built->>'state'<>'complete_window_evidence_current' THEN RETURN built; END IF;
 receipt:=built->'evidence';
 IF pg_column_size(receipt)>262144 THEN
  RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
   'reason','receipt_size_limit_exceeded');
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_complete_window_evaluations_v2
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 digest_value:=public.canonical_completion_digest(receipt);
 INSERT INTO public.canonical_forecast_complete_window_evaluations_v2(
  organization_id,revision,previous_id,anchor_run_id,window_start,window_end,
  evidence,evidence_digest,captured_at,actor_user_id,auth_session_id,request_key_hash)
 VALUES(org,COALESCE(prior.revision,0)+1,prior.id,
  (receipt->>'anchorRunId')::uuid,(receipt->>'windowStart')::timestamptz,
  (receipt->>'windowEnd')::timestamptz,receipt,digest_value,clock_timestamp(),
  actor,session_value,key_hash) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','complete_window_evaluation_saved',
  'evaluationId',inserted.id,'revision',inserted.revision,
  'previousId',inserted.previous_id,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_complete_window_evaluation_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_complete_window_evaluations_v2%ROWTYPE;
 built JSONB; current_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  evaluation_value IS NULL THEN
  RAISE EXCEPTION 'Complete-window evaluation read invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_complete_window_evaluations_v2
  WHERE organization_id=org AND id=evaluation_value;
 IF saved.id IS NULL THEN
  RETURN jsonb_build_object('state','complete_window_evaluation_unavailable',
   'reason','evaluation_not_found');
 END IF;
 built:=public.canonical_forecast_complete_window_evidence_v2(
  org,actor,role_value,session_value);
 IF built->>'state'<>'complete_window_evidence_current' THEN
  RETURN jsonb_build_object('state','complete_window_evaluation_stale',
   'evaluationId',saved.id,'revision',saved.revision,
   'reason',COALESCE(built->>'reason','source_evidence_unavailable'),
   'restartRequired',TRUE);
 END IF;
 current_digest:=public.canonical_completion_digest(built->'evidence');
 IF current_digest IS DISTINCT FROM saved.evidence_digest THEN
  RETURN jsonb_build_object('state','complete_window_evaluation_stale',
   'evaluationId',saved.id,'revision',saved.revision,
   'reason','source_generation_changed','restartRequired',TRUE);
 END IF;
 RETURN jsonb_build_object('state','complete_window_evaluation_available',
  'evaluationId',saved.id,'revision',saved.revision,'previousId',saved.previous_id,
  'capturedAt',public.canonical_forecast_utc_instant(saved.captured_at),
  'windowStart',public.canonical_forecast_utc_instant(saved.window_start),
  'windowEnd',public.canonical_forecast_utc_instant(saved.window_end),
  'storedOriginCount',(saved.evidence->>'storedOriginCount')::integer,
  'matchingContextCount',(saved.evidence->>'matchingContextCount')::integer,
  'excludedContextCount',(saved.evidence->>'excludedContextCount')::integer,
  'pairedCount',(saved.evidence->>'pairedCount')::integer,
  'missingCount',(saved.evidence->>'missingCount')::integer,
  'revokedCount',(saved.evidence->>'revokedCount')::integer,
  'excludedCount',(saved.evidence->>'excludedCount')::integer,
  'scope',saved.evidence->>'scope','restartRequired',FALSE,
  'empiricalAccuracyAvailable',FALSE,'calibrationAvailable',FALSE,
  'realForecastEligible',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_complete_window_evaluations_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_evidence_v2(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_evaluation_v2_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_evaluation_v2_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_complete_window_evaluations_v2
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_evaluation_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_evaluation_v2_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_evidence_v2(
  UUID,UUID,TEXT,UUID) FROM northstar_app_runtime;
END IF; END $$;
