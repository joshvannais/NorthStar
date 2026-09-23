-- Mission 26 Part 6A: an additive, source-ordered NorthStar price-decision
-- observation receipt. The first receipt starts a new coverage period. It
-- deliberately cannot certify decisions made before that first fence, other
-- sales channels, booked work, earned revenue, or a numerical forecast.

CREATE TABLE public.canonical_forecast_price_ordered_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 coverage_start_order BIGINT NOT NULL CHECK(coverage_start_order>=0),
 high_water_order BIGINT NOT NULL CHECK(high_water_order>=coverage_start_order),
 decision_events JSONB NOT NULL CHECK(jsonb_typeof(decision_events)='array' AND
   jsonb_array_length(decision_events)<=1000 AND octet_length(decision_events::text)<=262144),
 digest_nonce UUID NOT NULL,
 snapshot_digest CHAR(64) NOT NULL CHECK(snapshot_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL,
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(rtrim(snapshot_digest)=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-price-ordered-source-v1','organizationId',organization_id,
  'coverageStartOrder',coverage_start_order,'highWaterOrder',high_water_order,
  'digestNonce',digest_nonce,
  'capturedAt',public.canonical_forecast_utc_instant(captured_at),
  'events',decision_events)))
);
CREATE INDEX canonical_forecast_price_ordered_receipts_tenant_time_idx
 ON public.canonical_forecast_price_ordered_receipts(organization_id,captured_at DESC,id);

CREATE TABLE public.canonical_forecast_price_ordered_anchors (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 first_receipt_id UUID NOT NULL,
 coverage_start_order BIGINT NOT NULL CHECK(coverage_start_order>=0),
 coverage_starts_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(organization_id,first_receipt_id)
  REFERENCES public.canonical_forecast_price_ordered_receipts(organization_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION public.canonical_forecast_price_ordered_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast price-order evidence is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_price_ordered_receipts_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_ordered_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_ordered_immutable();
CREATE TRIGGER canonical_forecast_price_ordered_anchors_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_ordered_anchors
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_ordered_immutable();

CREATE FUNCTION public.canonical_forecast_price_ordered_events(
 org UUID,start_order BIGINT,end_order BIGINT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'estimateId',event.estimate_id,
  'decisionId',event.id,'revision',event.revision,'previousId',event.previous_id,
  'action',event.action,'priceBeforeTax',event.price_before_tax,
  'currency',event.currency,
  'recordedAt',public.canonical_forecast_utc_instant(event.created_at),
  'sourceObservedAt',public.canonical_forecast_utc_instant(event.ordered_at),
  'digest',event.digest) ORDER BY event.source_order),'[]'::jsonb)
 FROM (SELECT source.source_order,source.ordered_at,decision.estimate_id,decision.id,
    decision.revision,decision.previous_id,decision.action,
    decision.price_before_tax,decision.currency,decision.created_at,decision.digest
   FROM public.canonical_forecast_price_decision_orders source
   JOIN public.canonical_estimate_decisions decision
    ON decision.organization_id=source.organization_id
     AND decision.estimate_id=source.estimate_id AND decision.id=source.decision_id
   WHERE source.organization_id=org AND source.source_order>start_order
     AND source.source_order<=end_order
   ORDER BY source.source_order LIMIT 1001) event
$$;

CREATE FUNCTION public.canonical_forecast_price_ordered_projection(
 value public.canonical_forecast_price_ordered_receipts)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'version','m26-price-ordered-source-v1',
  'organizationId',value.organization_id,
  'capturedAt',public.canonical_forecast_utc_instant(value.captured_at),
  'events',value.decision_events,'eventCount',jsonb_array_length(value.decision_events),
  'sourceSnapshotDigest',rtrim(value.snapshot_digest),
  'scope','northstar_m24_approved_price_decisions',
  'wholeBusinessCoverageVerified',FALSE,'forecastIssued',FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_price_ordered_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 inserted public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 anchor public.canonical_forecast_price_ordered_anchors%ROWTYPE;
 key_hash TEXT;first_order BIGINT;last_order BIGINT;events JSONB;
 captured TIMESTAMPTZ;digest_value TEXT;nonce UUID;
BEGIN
 -- A serializable snapshot established before the tenant fence would omit a
 -- writer that commits during lock acquisition. Require fresh statement
 -- snapshots and take the same transaction lock as the decision trigger.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for source-order capture' USING ERRCODE='25001';END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast price-order access restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(
   org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Forecast price-order request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   org::text||':forecast-price-order:'||actor::text||':'||key_hash,0)) THEN
  RAISE EXCEPTION 'Forecast price-order request is busy' USING ERRCODE='55P03';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';END IF;
 -- Authorization is repeated after the possible idempotency-key wait.
 authority:=public.canonical_field_execution_actor_authority(
   org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_forecast_price_ordered_receipts
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  RETURN jsonb_build_object('snapshot',public.canonical_forecast_price_ordered_projection(old),
   'replayed',TRUE);
 END IF;
 SELECT * INTO anchor FROM public.canonical_forecast_price_ordered_anchors
  WHERE organization_id=org;
 SELECT COALESCE(MAX(source_order),0) INTO last_order
  FROM public.canonical_forecast_price_decision_orders WHERE organization_id=org;
 IF last_order>9007199254740991 THEN
  RAISE EXCEPTION 'Forecast price-decision order exceeds safe source size'
   USING ERRCODE='54000';END IF;
 first_order:=CASE WHEN anchor.organization_id IS NULL THEN last_order
  ELSE anchor.coverage_start_order END;
 events:=public.canonical_forecast_price_ordered_events(org,first_order,last_order);
 IF jsonb_array_length(events)>1000 OR octet_length(events::text)>262144 OR
   (SELECT count(DISTINCT event->>'estimateId')
      FROM jsonb_array_elements(events) event)>256 THEN
  RAISE EXCEPTION 'Forecast price-order cohort exceeds bounded source size'
   USING ERRCODE='54000';END IF;
 captured:=clock_timestamp();
 nonce:=gen_random_uuid();
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-price-ordered-source-v1','organizationId',org,
  'coverageStartOrder',first_order,'highWaterOrder',last_order,
  'digestNonce',nonce,
  'capturedAt',public.canonical_forecast_utc_instant(captured),
  'events',events));
 INSERT INTO public.canonical_forecast_price_ordered_receipts(
  organization_id,coverage_start_order,high_water_order,decision_events,
  digest_nonce,snapshot_digest,actor_user_id,membership_id,auth_session_id,
  request_key_hash,captured_at)
 VALUES(org,first_order,last_order,events,nonce,digest_value,actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,captured)
 RETURNING * INTO inserted;
 IF anchor.organization_id IS NULL THEN
  INSERT INTO public.canonical_forecast_price_ordered_anchors(
   organization_id,first_receipt_id,coverage_start_order,coverage_starts_at)
  VALUES(org,inserted.id,last_order,captured);
 END IF;
 RETURN jsonb_build_object('snapshot',public.canonical_forecast_price_ordered_projection(inserted),
  'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_price_ordered_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,receipt_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 anchor public.canonical_forecast_price_ordered_anchors%ROWTYPE;
 last_order BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast price-order access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
  JOIN public.organization_onboarding onboarding
    ON onboarding.organization_id=subscription.organization_id
  WHERE subscription.organization_id=org AND onboarding.status='complete'
    AND (subscription.status='active' OR
      (subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
       AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days'
       AND subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast price-decision source is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_price_ordered_receipts
  WHERE organization_id=org AND id=receipt_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO anchor FROM public.canonical_forecast_price_ordered_anchors
  WHERE organization_id=org;
 IF anchor.organization_id IS NULL OR
   anchor.coverage_start_order<>selected.coverage_start_order THEN
  RAISE EXCEPTION 'Forecast price-order coverage changed' USING ERRCODE='23514';END IF;
 SELECT COALESCE(MAX(source_order),0) INTO last_order
  FROM public.canonical_forecast_price_decision_orders WHERE organization_id=org;
 IF last_order>9007199254740991 THEN
  RAISE EXCEPTION 'Forecast price-decision order exceeds safe source size'
   USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object(
  'snapshot',public.canonical_forecast_price_ordered_projection(selected),
  'coverageStartsAt',public.canonical_forecast_utc_instant(anchor.coverage_starts_at),
  'firstReceiptId',anchor.first_receipt_id,
  'state',CASE WHEN last_order=selected.high_water_order THEN 'current' ELSE 'stale' END,
  'sourceOrderCurrent',last_order=selected.high_water_order,
  'calendarPeriodVerified',FALSE,'eligibleForForecast',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_ordered_receipts FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_price_ordered_anchors FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_ordered_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_ordered_events(UUID,BIGINT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_ordered_projection(
 public.canonical_forecast_price_ordered_receipts) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_ordered_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_ordered_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_ordered_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_ordered_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
