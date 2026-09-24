-- Mission 26 Part 3B: immutable, source-selected M24 actual revisions.
-- "Finalized" here means the supported NorthStar price-order source was
-- complete/current through this capture. A later decision stales the receipt
-- and requires a new append-only revision. It is not whole-business finality.
CREATE TABLE public.canonical_forecast_price_flow_actual_receipts (
 organization_id UUID NOT NULL,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 run_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 previous_id UUID,
 source_receipt_id UUID NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('known','revoked')),
 amount NUMERIC(18,2),
 first_approval_count INTEGER CHECK(first_approval_count>=0),
 currency TEXT NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 source_snapshot_digest TEXT NOT NULL CHECK(source_snapshot_digest~'^[a-f0-9]{64}$'),
 observed_through TIMESTAMPTZ NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 receipt_digest TEXT NOT NULL CHECK(receipt_digest~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,run_id,revision),
 UNIQUE(organization_id,run_id,source_receipt_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_receipt_id)
  REFERENCES public.canonical_forecast_price_ordered_receipts(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_price_flow_actual_receipts(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id)
  ON DELETE RESTRICT,
 CHECK((state='known' AND amount IS NOT NULL AND first_approval_count IS NOT NULL)
    OR (state='revoked' AND amount IS NULL AND first_approval_count IS NULL)),
 CHECK(receipt_digest=public.canonical_completion_digest(jsonb_build_object(
  'id',id,'runId',run_id,'revision',revision,'previousId',previous_id,
  'sourceReceiptId',source_receipt_id,'state',state,'amount',amount,
  'firstApprovalCount',first_approval_count,'currency',currency,
  'sourceSnapshotDigest',source_snapshot_digest,
  'observedThrough',public.canonical_forecast_utc_instant(observed_through),
  'capturedAt',public.canonical_forecast_utc_instant(captured_at))))
);
CREATE INDEX canonical_forecast_price_flow_actual_latest
 ON public.canonical_forecast_price_flow_actual_receipts
 (organization_id,run_id,revision DESC,id DESC);
CREATE TRIGGER canonical_forecast_price_flow_actual_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_price_flow_actual_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE FUNCTION public.canonical_forecast_capture_price_flow_actual(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,run_value UUID,receipt_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 prior public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 inserted public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 source_row public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 candidate JSONB; state_value TEXT; amount_value NUMERIC(18,2);
 count_value INTEGER; currency_value TEXT; observed TIMESTAMPTZ;
 key_hash TEXT; request_hash TEXT; digest_value TEXT; new_id UUID;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  run_value IS NULL OR receipt_value IS NULL THEN
  RAISE EXCEPTION 'Price-flow actual request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'runId',run_value,'sourceReceiptId',receipt_value)::text,'UTF8')),'hex');
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-flow-actual:'||org::text||':'||run_value::text,0)) THEN
  RAISE EXCEPTION 'Price-flow actual capture is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO old FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Price-flow actual replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','price_flow_actual_recorded',
   'receiptId',old.id,'revision',old.revision,'actualState',old.state,
   'receiptDigest',old.receipt_digest,'replayed',TRUE,
   'selectedSourceFinalizedAtCapture',TRUE,
   'wholeBusinessCoverageVerified',FALSE);
 END IF;
 candidate:=public.canonical_forecast_price_flow_actual_candidate(
  org,actor,role_value,session_value,run_value,receipt_value);
 IF candidate->>'state' NOT IN ('price_flow_actual_candidate',
   'price_flow_actual_unavailable') OR
  (candidate->>'state'='price_flow_actual_unavailable' AND
   candidate->>'reason'<>'approval_amended_or_withdrawn') THEN
  RETURN candidate||jsonb_build_object('actualSaved',FALSE);
 END IF;
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=run_value;
 SELECT * INTO source_row FROM public.canonical_forecast_price_ordered_receipts
  WHERE organization_id=org AND id=receipt_value;
 IF saved.id IS NULL OR source_row.id IS NULL THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','source_not_found','actualSaved',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND run_id=run_value
  ORDER BY revision DESC LIMIT 1;
 IF candidate->>'state'='price_flow_actual_unavailable' AND prior.id IS NULL THEN
  RETURN candidate||jsonb_build_object('actualSaved',FALSE);
 END IF;
 SELECT * INTO old FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND run_id=run_value
   AND source_receipt_id=receipt_value;
 IF FOUND THEN
  RETURN jsonb_build_object('state','price_flow_actual_recorded',
   'receiptId',old.id,'revision',old.revision,'actualState',old.state,
   'receiptDigest',old.receipt_digest,'replayed',TRUE,
   'selectedSourceFinalizedAtCapture',TRUE,
   'wholeBusinessCoverageVerified',FALSE);
 END IF;
 state_value:=CASE WHEN candidate->>'state'='price_flow_actual_candidate'
  THEN 'known' ELSE 'revoked' END;
 amount_value:=CASE WHEN state_value='known' THEN
  (candidate->>'amount')::numeric(18,2) ELSE NULL END;
 count_value:=CASE WHEN state_value='known' THEN
  (candidate->>'firstApprovalCount')::integer ELSE NULL END;
 currency_value:=saved.output->'unit'->>'currency';
 observed:=clock_timestamp();
 new_id:=gen_random_uuid();
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'id',new_id,'runId',run_value,'revision',COALESCE(prior.revision,0)+1,
  'previousId',prior.id,'sourceReceiptId',receipt_value,
  'state',state_value,'amount',amount_value,
  'firstApprovalCount',count_value,'currency',currency_value,
  'sourceSnapshotDigest',rtrim(source_row.snapshot_digest),
  'observedThrough',public.canonical_forecast_utc_instant(source_row.captured_at),
  'capturedAt',public.canonical_forecast_utc_instant(observed)));
 INSERT INTO public.canonical_forecast_price_flow_actual_receipts(
  organization_id,id,run_id,revision,previous_id,source_receipt_id,
  state,amount,first_approval_count,currency,source_snapshot_digest,
  observed_through,captured_at,actor_user_id,auth_session_id,
  request_key_hash,request_digest,receipt_digest)
 VALUES(org,new_id,run_value,COALESCE(prior.revision,0)+1,prior.id,
  receipt_value,state_value,amount_value,count_value,currency_value,
  rtrim(source_row.snapshot_digest),source_row.captured_at,observed,actor,
  session_value,key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','price_flow_actual_recorded',
  'receiptId',inserted.id,'revision',inserted.revision,
  'previousId',inserted.previous_id,'actualState',inserted.state,
  'receiptDigest',inserted.receipt_digest,'replayed',FALSE,
  'selectedSourceFinalizedAtCapture',TRUE,
  'wholeBusinessCoverageVerified',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_flow_actual_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.canonical_forecast_price_flow_actual_receipts%ROWTYPE;
 source JSONB; actual_xid XID8;
BEGIN
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO latest FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND run_id=run_value
  ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','no_saved_actual','outcomeFinalized',FALSE);
 END IF;
 source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,latest.source_receipt_id);
 IF source IS NULL OR source->>'state'<>'current' OR
  source->'snapshot'->>'sourceSnapshotDigest' IS DISTINCT FROM
   latest.source_snapshot_digest THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','source_changed','receiptId',latest.id,
   'revision',latest.revision,'outcomeFinalized',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO actual_xid
  FROM public.canonical_forecast_price_flow_actual_receipts
  WHERE organization_id=org AND id=latest.id;
 IF pg_xact_status(actual_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','price_flow_actual_unavailable',
   'reason','actual_commit_unverified','outcomeFinalized',FALSE);
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN latest.state='known' THEN
   'price_flow_actual_finalized' ELSE 'price_flow_actual_revoked' END,
  'receiptId',latest.id,'revision',latest.revision,
  'previousId',latest.previous_id,'runId',latest.run_id,
  'sourceReceiptId',latest.source_receipt_id,
  'sourceSnapshotDigest',latest.source_snapshot_digest,
  'receiptDigest',latest.receipt_digest,
  'observedThrough',public.canonical_forecast_utc_instant(latest.observed_through),
  'capturedAt',public.canonical_forecast_utc_instant(latest.captured_at),
  'amount',latest.amount,'firstApprovalCount',latest.first_approval_count,
  'currency',latest.currency,
  'outcomeFinalized',latest.state='known',
  'wholeBusinessCoverageVerified',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_actual_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_price_flow_actual(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_actual_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_actual_receipts
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_price_flow_actual(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_flow_actual_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
