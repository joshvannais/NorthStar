-- Mission 26 founder Part 5: current booked-work cost and concentration insight.
-- This read composes only current owner-confirmed booked work with the exact
-- current M24 pricing/commercial authority for each booked estimate. It does
-- not claim earned revenue, company profit, utilization, delay probability,
-- equipment downtime, inventory availability, or future performance.

CREATE FUNCTION public.canonical_forecast_cost_risk_outlook_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE currency_value TEXT;sources JSONB;booked RECORD;
 pricing public.canonical_pricing_plans%ROWTYPE;
 terms public.canonical_commercial_terms%ROWTYPE;
 approval public.canonical_commercial_approvals%ROWTYPE;
 commercial_sources JSONB;commercial_state JSONB;
 booked_count INTEGER:=0;covered_count INTEGER:=0;
 booked_total NUMERIC(20,2):=0;cost_total NUMERIC(20,2):=0;
 largest_booked NUMERIC(20,2):=0;cost_value NUMERIC(20,2);
 cost_complete BOOLEAN:=TRUE;contribution_value NUMERIC(20,2);
 margin_value NUMERIC;share_value NUMERIC;
 cost_fact JSONB;contribution_fact JSONB;margin_fact JSONB;concentration_fact JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for cost and risk outlook'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) THEN
  RAISE EXCEPTION 'Cost and risk outlook is busy' USING ERRCODE='55P03';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT profile.raw_profile#>>'{company,currency}' INTO currency_value
 FROM public.canonical_business_profiles profile
 WHERE profile.organization_id=org AND profile.is_active=TRUE
 ORDER BY profile.version_number DESC,profile.id DESC LIMIT 1;
 IF currency_value IS NULL OR currency_value!~'^[A-Z]{3}$' THEN
  RETURN jsonb_build_object('version','m26-cost-risk-outlook-v1',
   'state','unavailable','reason','commercial_sources_unavailable','fictional',FALSE,
   'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
   'currency',NULL,'scope',jsonb_build_object(
    'label','Current owner-confirmed booked work','wholeBusinessCoverageVerified',FALSE),
   'bookedWork',jsonb_build_object('state','unavailable','count',NULL,'amountBeforeTax',NULL),
   'costBasis',jsonb_build_object('state','unavailable','coveredCount',NULL,'amount',NULL,
    'reason','current_cost_basis_unavailable'),
   'contribution',jsonb_build_object('state','unavailable','amount',NULL,
    'reason','current_cost_basis_unavailable'),
   'margin',jsonb_build_object('state','unavailable','percent',NULL,
    'reason','current_cost_basis_unavailable'),
   'concentration',jsonb_build_object('state','unavailable','largestBookedSharePercent',NULL,
    'largestBookedAmount',NULL,'reason','current_booked_work_unavailable'),
   'underutilization',jsonb_build_object('state','available_elsewhere','location','team_capacity'),
   'delays',jsonb_build_object('state','unavailable','reason','verified_delay_authority_unavailable'),
   'equipmentDowntime',jsonb_build_object('state','unavailable','reason','verified_downtime_authority_unavailable'),
   'companyProfit',jsonb_build_object('state','unavailable','reason','complete_overhead_authority_unavailable'),
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 sources:=public.canonical_forecast_integrated_commercial_sources(
  org,actor,role_value,session_value,currency_value);
 IF sources->>'state'<>'current_integrated_commercial_sources' OR
    sources->'sourceCohortsCompleteAtRead' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('version','m26-cost-risk-outlook-v1',
   'state','unavailable','reason','commercial_sources_unavailable','fictional',FALSE,
   'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
   'currency',NULL,'scope',jsonb_build_object(
    'label','Current owner-confirmed booked work','wholeBusinessCoverageVerified',FALSE),
   'bookedWork',jsonb_build_object('state','unavailable','count',NULL,'amountBeforeTax',NULL),
   'costBasis',jsonb_build_object('state','unavailable','coveredCount',NULL,'amount',NULL,
    'reason','current_cost_basis_unavailable'),
   'contribution',jsonb_build_object('state','unavailable','amount',NULL,
    'reason','current_cost_basis_unavailable'),
   'margin',jsonb_build_object('state','unavailable','percent',NULL,
    'reason','current_cost_basis_unavailable'),
   'concentration',jsonb_build_object('state','unavailable','largestBookedSharePercent',NULL,
    'largestBookedAmount',NULL,'reason','current_booked_work_unavailable'),
   'underutilization',jsonb_build_object('state','available_elsewhere','location','team_capacity'),
   'delays',jsonb_build_object('state','unavailable','reason','verified_delay_authority_unavailable'),
   'equipmentDowntime',jsonb_build_object('state','unavailable','reason','verified_downtime_authority_unavailable'),
   'companyProfit',jsonb_build_object('state','unavailable','reason','complete_overhead_authority_unavailable'),
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 END IF;

 FOR booked IN
  SELECT review.*,confirmation.id confirmation_id,version.estimate_id,
   version.decision_id issued_decision_id
  FROM (
   SELECT DISTINCT ON (r.appointment_id) r.*
   FROM public.canonical_forecast_commercial_booking_reviews r
   WHERE r.organization_id=org
   ORDER BY r.appointment_id,r.review_order DESC,r.id DESC LIMIT 1001
  ) review
  JOIN public.canonical_forecast_booked_work_confirmations confirmation
   ON confirmation.organization_id=review.organization_id
    AND confirmation.review_id=review.id
  JOIN public.canonical_customer_estimate_versions version
   ON version.organization_id=review.organization_id
    AND version.id=review.issued_version_id
  WHERE review.action<>'booking_cancelled'
  ORDER BY review.appointment_id
 LOOP
  booked_count:=booked_count+1;
  IF booked.reviewed_price_before_tax!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR
     booked.currency IS DISTINCT FROM currency_value OR
     booked.approved_decision_id IS DISTINCT FROM booked.issued_decision_id THEN
   RAISE EXCEPTION 'Booked-work cost lineage invalid' USING ERRCODE='23514';
  END IF;
  booked_total:=booked_total+booked.reviewed_price_before_tax::numeric;
  largest_booked:=greatest(largest_booked,booked.reviewed_price_before_tax::numeric);
  SELECT * INTO pricing FROM public.canonical_pricing_plans p
   WHERE p.organization_id=org AND p.estimate_id=booked.estimate_id
   ORDER BY p.revision DESC,p.id DESC LIMIT 1;
  SELECT * INTO terms FROM public.canonical_commercial_terms t
   WHERE t.organization_id=org AND t.estimate_id=booked.estimate_id
   ORDER BY t.revision DESC,t.id DESC LIMIT 1;
  SELECT * INTO approval FROM public.canonical_commercial_approvals a
   WHERE a.organization_id=org AND a.estimate_id=booked.estimate_id
   ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
  IF pricing.id IS NULL OR terms.id IS NULL OR approval.id IS NULL THEN
   cost_complete:=FALSE; CONTINUE;
  END IF;
  commercial_sources:=public.canonical_commercial_sources(
   org,actor,role_value,session_value,booked.estimate_id,NULL);
  commercial_state:=public.canonical_commercial_current(
   public.canonical_commercial_projection(terms),commercial_sources,
   public.canonical_commercial_binding_projection(approval));
  IF pricing.action<>'save' OR pricing.id::text IS DISTINCT FROM
       commercial_sources#>>'{pricingPin,id}' OR
     terms.action<>'save' OR terms.pricing_id IS DISTINCT FROM pricing.id OR
     approval.terms_id IS DISTINCT FROM terms.id OR
     approval.decision_id IS DISTINCT FROM booked.approved_decision_id OR
     commercial_state->'current' IS DISTINCT FROM 'true'::jsonb OR
     commercial_state->'linkedApproval' IS DISTINCT FROM 'true'::jsonb OR
     pricing.currency IS DISTINCT FROM currency_value OR
     pricing.result#>>'{overhead,overlapResolved}' IS DISTINCT FROM 'true' OR
     pricing.result->>'costWithOverhead'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN
   cost_complete:=FALSE; CONTINUE;
  END IF;
  cost_value:=(pricing.result->>'costWithOverhead')::numeric;
  cost_total:=cost_total+cost_value;covered_count:=covered_count+1;
 END LOOP;
 IF booked_count IS DISTINCT FROM
    COALESCE((sources#>>'{commercialStatuses,ownerConfirmedBookedCount}')::integer,-1) OR
    to_char(booked_total,'FM999999999999990.00') IS DISTINCT FROM
     sources->>'bookedWorkBeforeTax' THEN
  RAISE EXCEPTION 'Booked-work cohort changed' USING ERRCODE='40001';
 END IF;

 IF cost_complete AND covered_count=booked_count THEN
  contribution_value:=booked_total-cost_total;
  cost_fact:=jsonb_build_object('state','current','coveredCount',covered_count,
   'amount',to_char(cost_total,'FM999999999999990.00'),'reason',NULL);
  contribution_fact:=jsonb_build_object('state','current',
   'amount',to_char(contribution_value,'FM999999999999990.00'),'reason',NULL);
  IF booked_total>0 THEN
   margin_value:=round(contribution_value*1000/booked_total)/10;
   margin_fact:=jsonb_build_object('state','current',
    'percent',to_char(margin_value,'FM999999999999990.0'),'reason',NULL);
  ELSE
   margin_fact:=jsonb_build_object('state','unavailable','percent',NULL,
    'reason','no_booked_value');
  END IF;
 ELSE
  cost_fact:=jsonb_build_object('state','unavailable','coveredCount',covered_count,
   'amount',NULL,'reason','incomplete_current_cost_basis');
  contribution_fact:=jsonb_build_object('state','unavailable','amount',NULL,
   'reason','incomplete_current_cost_basis');
  margin_fact:=jsonb_build_object('state','unavailable','percent',NULL,
   'reason','incomplete_current_cost_basis');
 END IF;
 IF booked_total>0 THEN
  share_value:=round(largest_booked*1000/booked_total)/10;
  concentration_fact:=jsonb_build_object('state','current',
   'largestBookedSharePercent',to_char(share_value,'FM999999999999990.0'),
   'largestBookedAmount',to_char(largest_booked,'FM999999999999990.00'),'reason',NULL);
 ELSE
  concentration_fact:=jsonb_build_object('state','none',
   'largestBookedSharePercent','0.0','largestBookedAmount','0.00','reason',NULL);
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('version','m26-cost-risk-outlook-v1',
  'state','current','reason',NULL,'fictional',FALSE,
  'checkedAt',public.canonical_forecast_utc_instant(clock_timestamp()),
  'currency',currency_value,'scope',jsonb_build_object(
   'label','Current owner-confirmed booked work','wholeBusinessCoverageVerified',FALSE),
  'bookedWork',jsonb_build_object('state','current','count',booked_count,
   'amountBeforeTax',to_char(booked_total,'FM999999999999990.00')),
  'costBasis',cost_fact,'contribution',contribution_fact,'margin',margin_fact,
  'concentration',concentration_fact,
  'underutilization',jsonb_build_object('state','available_elsewhere','location','team_capacity'),
  'delays',jsonb_build_object('state','unavailable','reason','verified_delay_authority_unavailable'),
  'equipmentDowntime',jsonb_build_object('state','unavailable','reason','verified_downtime_authority_unavailable'),
  'companyProfit',jsonb_build_object('state','unavailable','reason','complete_overhead_authority_unavailable'),
  'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_cost_risk_outlook_current(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ DECLARE runtime_role TEXT:='northstar_app_runtime'; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format(
   'GRANT EXECUTE ON FUNCTION public.canonical_forecast_cost_risk_outlook_current(uuid,uuid,text,uuid) TO %I',
   runtime_role);
 END IF;
END $$;
