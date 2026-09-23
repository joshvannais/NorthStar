-- Mission 26 Part 6A: read-only immediate predecessor context for the first
-- post-anchor amendment of an estimate. Old decisions remain outside observed
-- period counts and no earlier calendar coverage is inferred.

CREATE FUNCTION public.canonical_forecast_price_preanchor_context(
 org UUID, start_order BIGINT, events JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE expected INTEGER;context_value JSONB;
BEGIN
 IF events IS NULL OR jsonb_typeof(events)<>'array' OR
   jsonb_array_length(events)>1000 THEN
  RAISE EXCEPTION 'Forecast price lineage source invalid' USING ERRCODE='23514';
 END IF;
 WITH first_event AS (
  SELECT DISTINCT ON (item.value->>'estimateId') item.value
  FROM jsonb_array_elements(events) WITH ORDINALITY item(value,position)
  ORDER BY item.value->>'estimateId',item.position
 )
 SELECT count(*) INTO expected FROM first_event
 WHERE (value->>'revision')::integer>1;
 IF expected>256 THEN
  RAISE EXCEPTION 'Forecast price lineage context exceeds bound'
   USING ERRCODE='54000';
 END IF;
 WITH first_event AS (
  SELECT DISTINCT ON (item.value->>'estimateId') item.value
  FROM jsonb_array_elements(events) WITH ORDINALITY item(value,position)
  ORDER BY item.value->>'estimateId',item.position
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'estimateId',prior.estimate_id,'decisionId',prior.id,
   'revision',prior.revision,'action',prior.action,
   'priceBeforeTax',prior.price_before_tax,'currency',prior.currency,
   'recordedAt',public.canonical_forecast_utc_instant(prior.created_at),
   'digest',prior.digest) ORDER BY prior.estimate_id),'[]'::jsonb)
 INTO context_value
 FROM first_event first
 JOIN public.canonical_estimate_decisions prior
   ON prior.organization_id=org
   AND prior.estimate_id=(first.value->>'estimateId')::uuid
   AND prior.id=(first.value->>'previousId')::uuid
   AND prior.revision=(first.value->>'revision')::bigint-1
   AND prior.currency=first.value->>'currency'
   AND public.canonical_forecast_utc_instant(prior.created_at)<=first.value->>'recordedAt'
 LEFT JOIN public.canonical_forecast_price_decision_orders source
   ON source.organization_id=prior.organization_id
   AND source.decision_id=prior.id
 WHERE (first.value->>'revision')::integer>1
   AND (source.source_order IS NULL OR source.source_order<=start_order);
 IF jsonb_array_length(context_value)<>expected OR
   octet_length(context_value::text)>65536 THEN
  RAISE EXCEPTION 'Forecast price lineage context unavailable'
   USING ERRCODE='23514';
 END IF;
 RETURN context_value;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_price_ordered_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,receipt_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_price_ordered_receipts%ROWTYPE;
 anchor public.canonical_forecast_price_ordered_anchors%ROWTYPE;
 last_order BIGINT;context_value JSONB;context_digest TEXT;
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
 context_value:=public.canonical_forecast_price_preanchor_context(
  org,selected.coverage_start_order,selected.decision_events);
 context_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-price-preanchor-context-v1','organizationId',org,
  'receiptId',selected.id,'digestNonce',selected.digest_nonce,
  'predecessors',context_value));
 RETURN jsonb_build_object(
  'snapshot',public.canonical_forecast_price_ordered_projection(selected),
  'preAnchorPredecessors',context_value,
  'preAnchorContextDigest',context_digest,
  'coverageStartsAt',public.canonical_forecast_utc_instant(anchor.coverage_starts_at),
  'firstReceiptId',anchor.first_receipt_id,
  'state',CASE WHEN last_order=selected.high_water_order THEN 'current' ELSE 'stale' END,
  'sourceOrderCurrent',last_order=selected.high_water_order,
  'calendarPeriodVerified',FALSE,'eligibleForForecast',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_price_preanchor_context(
 UUID,BIGINT,JSONB) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON FUNCTION public.canonical_forecast_price_preanchor_context(
  UUID,BIGINT,JSONB) FROM northstar_app_runtime;
END IF;END $$;
