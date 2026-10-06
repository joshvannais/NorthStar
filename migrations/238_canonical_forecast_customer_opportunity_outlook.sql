-- Founder Part 6: one current customer and opportunity insight.
-- This is a bounded present-state projection of tenant-private NorthStar records.
-- It does not create probabilities, infer off-platform coverage, contact a customer,
-- or authorize any price, estimate, schedule, or lifecycle change.

CREATE FUNCTION public.canonical_forecast_customer_opportunity_outlook_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE customer_count INTEGER;returning_count INTEGER;opportunity_count INTEGER;
 reviewed_count INTEGER;unreviewed_count INTEGER;qualification_open INTEGER;
 qualification_qualified INTEGER;qualification_unqualified INTEGER;
 qualification_closed INTEGER;request_open INTEGER;request_requested INTEGER;
 request_withdrawn INTEGER;request_closed INTEGER;request_unreviewed INTEGER;
 qualified_needs_review INTEGER;action_key TEXT;action_label TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for customer opportunity outlook'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:lead-state:'||org::text,0)) THEN
  RAISE EXCEPTION 'Lead review source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:estimate-request-state:'||org::text,0)) THEN
  RAISE EXCEPTION 'Estimate request source is busy' USING ERRCODE='55P03';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);

 SELECT count(*)::integer INTO customer_count
 FROM public.canonical_customers customer
 JOIN public.canonical_operations operation
  ON operation.organization_id=customer.organization_id AND operation.id=customer.operation_id
 WHERE customer.organization_id=org AND operation.state='completed';
 SELECT count(*)::integer INTO opportunity_count
 FROM public.canonical_opportunities opportunity
 JOIN public.canonical_operations operation
  ON operation.organization_id=opportunity.organization_id AND operation.id=opportunity.operation_id
 WHERE opportunity.organization_id=org AND operation.state='completed';
 IF customer_count>500 OR opportunity_count>500 THEN
  PERFORM public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,NULL,FALSE);
  RETURN jsonb_build_object('version','m26-customer-opportunity-outlook-v1',
   'state','unavailable','reason','current_source_limit_exceeded','fictional',FALSE,
   'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
   'scope',jsonb_build_object(
    'label','Current NorthStar-recorded customer and reviewed opportunity records',
    'wholeBusinessCoverageVerified',FALSE,'providerCoverageVerified',FALSE,
    'offPlatformCoverageVerified',FALSE),
   'customers',jsonb_build_object('count',NULL,'returningCount',NULL),
   'opportunities',jsonb_build_object('count',NULL,'reviewedCount',NULL,'unreviewedCount',NULL),
   'qualification',jsonb_build_object('open',NULL,'qualified',NULL,'unqualified',NULL,'closed',NULL),
   'estimateRequests',jsonb_build_object('open',NULL,'requested',NULL,'withdrawn',NULL,
    'closed',NULL,'unreviewed',NULL,'qualifiedNeedsReview',NULL),
   'recommendedAction',jsonb_build_object('key','customer_review',
    'label','Review customers','href','/dashboard/leads'),
   'probabilityCalibrated',FALSE,'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 END IF;

 WITH eligible AS (
  SELECT opportunity.id,opportunity.customer_id
  FROM public.canonical_opportunities opportunity
  JOIN public.canonical_operations operation
   ON operation.organization_id=opportunity.organization_id AND operation.id=opportunity.operation_id
  WHERE opportunity.organization_id=org AND operation.state='completed'
 ), customer_work AS (
  SELECT customer_id,count(*) count FROM eligible GROUP BY customer_id
 ) SELECT count(*) FILTER(WHERE count>1)::integer INTO returning_count FROM customer_work;

 WITH eligible AS (
  SELECT opportunity.id
  FROM public.canonical_opportunities opportunity
  JOIN public.canonical_operations operation
   ON operation.organization_id=opportunity.organization_id AND operation.id=opportunity.operation_id
  WHERE opportunity.organization_id=org AND operation.state='completed'
 ), current_state AS (
  SELECT eligible.id,lead.qualification_state,request.request_state
  FROM eligible
  LEFT JOIN LATERAL (SELECT review.qualification_state
   FROM public.canonical_lead_state_reviews review
   WHERE review.organization_id=org AND review.opportunity_id=eligible.id
   ORDER BY review.revision DESC LIMIT 1) lead ON TRUE
  LEFT JOIN LATERAL (SELECT review.request_state
   FROM public.canonical_estimate_request_state_reviews review
   WHERE review.organization_id=org AND review.opportunity_id=eligible.id
   ORDER BY review.revision DESC LIMIT 1) request ON TRUE
 ) SELECT
  count(*) FILTER(WHERE qualification_state IS NOT NULL)::integer,
  count(*) FILTER(WHERE qualification_state IS NULL)::integer,
  count(*) FILTER(WHERE qualification_state='open')::integer,
  count(*) FILTER(WHERE qualification_state='qualified')::integer,
  count(*) FILTER(WHERE qualification_state='unqualified')::integer,
  count(*) FILTER(WHERE qualification_state='closed')::integer,
  count(*) FILTER(WHERE request_state='open')::integer,
  count(*) FILTER(WHERE request_state='requested')::integer,
  count(*) FILTER(WHERE request_state='withdrawn')::integer,
  count(*) FILTER(WHERE request_state='closed')::integer,
  count(*) FILTER(WHERE request_state IS NULL)::integer,
  count(*) FILTER(WHERE qualification_state='qualified' AND request_state='open')::integer
 INTO reviewed_count,unreviewed_count,qualification_open,qualification_qualified,
  qualification_unqualified,qualification_closed,request_open,request_requested,
  request_withdrawn,request_closed,request_unreviewed,qualified_needs_review
 FROM current_state;

 IF qualified_needs_review>0 THEN
  action_key:='estimate_review';action_label:='Review estimate requests';
 ELSIF qualification_open>0 OR unreviewed_count>0 THEN
  action_key:='lead_review';action_label:='Review open leads';
 ELSE action_key:='customer_review';action_label:='Review customers';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('version','m26-customer-opportunity-outlook-v1',
  'state','current','reason',NULL,'fictional',FALSE,
  'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
  'scope',jsonb_build_object(
   'label','Current NorthStar-recorded customer and reviewed opportunity records',
   'wholeBusinessCoverageVerified',FALSE,'providerCoverageVerified',FALSE,
   'offPlatformCoverageVerified',FALSE),
  'customers',jsonb_build_object('count',customer_count,'returningCount',returning_count),
  'opportunities',jsonb_build_object('count',opportunity_count,'reviewedCount',reviewed_count,
   'unreviewedCount',unreviewed_count),
  'qualification',jsonb_build_object('open',qualification_open,'qualified',qualification_qualified,
   'unqualified',qualification_unqualified,'closed',qualification_closed),
  'estimateRequests',jsonb_build_object('open',request_open,'requested',request_requested,
   'withdrawn',request_withdrawn,'closed',request_closed,'unreviewed',request_unreviewed,
   'qualifiedNeedsReview',qualified_needs_review),
  'recommendedAction',jsonb_build_object('key',action_key,'label',action_label,
   'href','/dashboard/leads'),
  'probabilityCalibrated',FALSE,'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_customer_opportunity_outlook_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ DECLARE runtime_role TEXT:='northstar_app_runtime'; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format(
   'GRANT EXECUTE ON FUNCTION public.canonical_forecast_customer_opportunity_outlook_current(uuid,uuid,text,uuid) TO %I',
   runtime_role);
 END IF;
END $$;
