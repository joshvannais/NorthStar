-- Mission 26 Part 3B: one narrow, immutable NorthStar M24 price-flow
-- prediction origin. This is an uncalibrated supported-source carry-forward,
-- not a whole-business forecast or a historical month-end balance.
CREATE TABLE public.canonical_forecast_price_flow_saved_origins (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 saved_at TIMESTAMPTZ NOT NULL,
 horizon_start TIMESTAMPTZ NOT NULL,
 horizon_end TIMESTAMPTZ NOT NULL,
 source_receipt_id UUID NOT NULL,
 output JSONB NOT NULL,
 receipt_digest TEXT NOT NULL CHECK(receipt_digest~'^[a-f0-9]{64}$'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,actor_user_id)
  REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_receipt_id)
  REFERENCES public.canonical_forecast_price_ordered_receipts(organization_id,id)
  ON DELETE RESTRICT,
 CHECK(horizon_start>=saved_at AND horizon_end=horizon_start+INTERVAL '1 day'),
 CHECK(output->'target'->>'key'='revenue.approved_price_flow'),
 CHECK(output->'confidence'->>'state'='unavailable'),
 CHECK(output->'value'->>'kind'='point'),
 CHECK(receipt_digest=public.canonical_completion_digest(output))
);
CREATE INDEX canonical_forecast_price_flow_origins_recent
 ON public.canonical_forecast_price_flow_saved_origins
 (organization_id,saved_at DESC,id DESC);
CREATE FUNCTION public.canonical_forecast_price_flow_origin_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Saved price-flow origins are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_price_flow_origins_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_flow_saved_origins
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

-- Serialize profile activation with origin capture. Without this shared lock,
-- an activation could obtain an earlier row clock, commit after the origin,
-- and later appear to have been available when the forecast was saved.
-- ACCESS EXCLUSIVE drains every legacy activation-table reader/writer before
-- installing the trigger, while the trigger covers calls that entered the old
-- function body but resume their INSERT after this migration commits.
LOCK TABLE public.canonical_forecast_profile_effective_activations
 IN ACCESS EXCLUSIVE MODE;
CREATE FUNCTION public.canonical_forecast_profile_activation_order_lock()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||NEW.organization_id::text,0));
 NEW.observed_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_profile_activation_order_lock
 BEFORE INSERT ON public.canonical_forecast_profile_effective_activations
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_profile_activation_order_lock();
CREATE OR REPLACE FUNCTION public.canonical_forecast_profile_effective_anchor_activate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,anchor_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 prior public.canonical_forecast_profile_effective_activations%ROWTYPE;
 source_xid XID8; observed TIMESTAMPTZ; inserted_value BOOLEAN:=FALSE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Forecast profile activation requires READ COMMITTED' USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0));
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state','profile_effective_activation_unavailable',
   'reason','anchor_not_found','historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF FOUND THEN
  RETURN jsonb_build_object('state','profile_effective_activation_recorded',
   'anchorId',anchor_value,'observedAt',public.canonical_forecast_utc_instant(prior.observed_at),
   'replayed',TRUE,'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO source_xid
  FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 IF pg_xact_status(source_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','profile_effective_activation_unavailable',
   'reason','anchor_commit_unverified','historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 observed:=clock_timestamp();
 INSERT INTO public.canonical_forecast_profile_effective_activations(
  organization_id,anchor_id,observed_at,actor_user_id,auth_session_id)
 VALUES(org,anchor_value,observed,actor,session_value)
 ON CONFLICT ON CONSTRAINT canonical_forecast_profile_effective_activations_pkey
 DO NOTHING RETURNING TRUE INTO inserted_value;
 SELECT * INTO prior FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Forecast profile activation unavailable' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('state','profile_effective_activation_recorded',
  'anchorId',anchor_value,'observedAt',public.canonical_forecast_utc_instant(prior.observed_at),
  'replayed',NOT COALESCE(inserted_value,FALSE),
  'historicalCalendarVerified',FALSE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_capture_price_flow_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,receipt_id UUID,currency_value TEXT,
 horizon_start_value TIMESTAMPTZ,horizon_end_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 source JSONB; activation JSONB; value JSONB; saved TIMESTAMPTZ;
 prior_start TIMESTAMPTZ; prior_end TIMESTAMPTZ;
 count_value INT; total_value NUMERIC(18,2);
 key_hash TEXT; request_hash TEXT; source_events JSONB;
 receipt_xid XID8; activation_xid XID8;
 profile_timezone TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  currency_value IS NULL OR currency_value!~'^[A-Z]{3}$' OR
  receipt_id IS NULL OR horizon_start_value IS NULL OR
  horizon_end_value IS NULL OR
  horizon_end_value<>horizon_start_value+INTERVAL '1 day' OR
  horizon_start_value<>(date_trunc('day',
   horizon_start_value AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN
  RAISE EXCEPTION 'Price-flow origin input invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=encode(sha256(convert_to(jsonb_build_object(
  'receiptId',receipt_id,'currency',currency_value,
  'horizonStart',public.canonical_forecast_utc_instant(horizon_start_value),
  'horizonEnd',public.canonical_forecast_utc_instant(horizon_end_value))::text,
  'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':'||actor::text||':price-flow-origin:'||key_hash,0));
 SELECT * INTO prior FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF prior.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Price-flow origin replay changed' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state','saved_price_flow_origin',
   'runId',prior.id,'output',prior.output,
   'receiptDigest',prior.receipt_digest,'replayed',TRUE,
   'preHorizonCommitVerified',FALSE);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0));
 SELECT profile.raw_profile->'company'->>'timeZone' INTO profile_timezone
  FROM public.canonical_business_profiles profile
  WHERE profile.organization_id=org AND profile.is_active=TRUE;
 IF profile_timezone IS DISTINCT FROM 'UTC' THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','unsupported_calendar_timezone','calendarTimeZone',profile_timezone,
   'forecastIssued',FALSE);
 END IF;
 source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,receipt_id);
 activation:=public.canonical_forecast_price_anchor_activation_read(
  org,actor,role_value,session_value);
 prior_start:=horizon_start_value-INTERVAL '2 days';
 prior_end:=horizon_start_value-INTERVAL '1 day';
 IF source IS NULL OR source->>'state'<>'current' OR
  source->>'firstReceiptId' IS DISTINCT FROM activation->>'firstReceiptId' OR
  activation->>'state'<>'price_anchor_activation_recorded' OR
  (source->>'coverageStartsAt')::timestamptz>prior_start OR
  (activation->>'observedAt')::timestamptz>=prior_start OR
  source->'snapshot'->>'scope' IS DISTINCT FROM
    'northstar_m24_approved_price_decisions' THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','supported_source_coverage_unavailable',
   'forecastIssued',FALSE);
 END IF;
 SELECT xmin::text::xid8 INTO receipt_xid
  FROM public.canonical_forecast_price_ordered_receipts
  WHERE organization_id=org AND id=receipt_id;
 SELECT xmin::text::xid8 INTO activation_xid
  FROM public.canonical_forecast_price_anchor_activations
  WHERE organization_id=org;
 IF pg_xact_status(receipt_xid) IS DISTINCT FROM 'committed' OR
    pg_xact_status(activation_xid) IS DISTINCT FROM 'committed' THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','source_commit_not_observed','forecastIssued',FALSE);
 END IF;
 source_events:=source->'snapshot'->'events';
 IF jsonb_typeof(source_events)<>'array' OR
  jsonb_array_length(source_events)>1000 THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','source_limit_exceeded','forecastIssued',FALSE);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(source_events) event
    WHERE (event->>'sourceObservedAt')::timestamptz>=prior_start
      AND (event->>'sourceObservedAt')::timestamptz<prior_end
      AND event->>'currency'<>currency_value) THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','currency_conflict','forecastIssued',FALSE);
 END IF;
 SELECT count(*)::int,
  COALESCE(sum((event->>'priceBeforeTax')::numeric(18,2)),0)::numeric(18,2)
 INTO count_value,total_value FROM jsonb_array_elements(source_events) event
 WHERE event->>'action'='approve' AND (event->>'revision')::int=1
  AND (event->>'sourceObservedAt')::timestamptz>=prior_start
  AND (event->>'sourceObservedAt')::timestamptz<prior_end;
 saved:=clock_timestamp();
 IF saved<prior_end OR saved>=horizon_start_value THEN
  RETURN jsonb_build_object('state','price_flow_origin_unavailable',
   'reason','origin_window_not_eligible','forecastIssued',FALSE);
 END IF;
 value:=jsonb_build_object(
  'contractVersion','m26-forecast-output-v1','organizationId',org,
  'asOf',to_char(date_trunc('milliseconds',
    (source->'snapshot'->>'capturedAt')::timestamptz) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'horizon',jsonb_build_object(
   'startsAt',to_char(horizon_start_value AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'endsAt',to_char(horizon_end_value AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'grain','day'),
  'target',jsonb_build_object('key','revenue.approved_price_flow',
   'definitionVersion','v1'),
  'unit',jsonb_build_object('key','money','currency',currency_value),
  'value',jsonb_build_object('kind','point','amount',total_value::text),
  'confidence',jsonb_build_object('state','unavailable',
   'backtestDigest',NULL),
  'uncertainty',jsonb_build_object('state','unquantified',
   'drivers',jsonb_build_array('deterministic_carry_forward')),
  'evidenceCoverage',jsonb_build_object('included',count_value,
   'excluded',0,'missing',0,'stale',0,'conflicting',0),
  'applicability',jsonb_build_object('serviceKey',NULL,'areaKey',NULL,
   'limits',jsonb_build_array('northstar_m24_only','uncalibrated_carry_forward')),
  'calculationVersion','m26_price_flow_carry_forward_v1',
  'sourceSnapshotDigest',source->'snapshot'->>'sourceSnapshotDigest');
 INSERT INTO public.canonical_forecast_price_flow_saved_origins(
  organization_id,saved_at,horizon_start,horizon_end,source_receipt_id,
  output,receipt_digest,actor_user_id,auth_session_id,request_key_hash,
  request_digest)
 VALUES(org,saved,horizon_start_value,horizon_end_value,receipt_id,value,
  public.canonical_completion_digest(value),actor,session_value,key_hash,
  request_hash) RETURNING * INTO prior;
 RETURN jsonb_build_object('state','saved_price_flow_origin',
  'runId',prior.id,'output',prior.output,
  'receiptDigest',prior.receipt_digest,'replayed',FALSE,
  'preHorizonCommitVerified',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_flow_saved_origins FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_flow_origin_immutable()
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_profile_activation_order_lock()
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_price_flow_origin(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
 FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_price_flow_saved_origins
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_profile_activation_order_lock()
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_price_flow_origin(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
  TO northstar_app_runtime;
END IF; END $$;
