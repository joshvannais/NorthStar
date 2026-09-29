-- Mission 26 Part 6A: guarded current approved-price evidence for an
-- accepted-estimate/scheduling lineage candidate. Never booked revenue.
CREATE FUNCTION public.canonical_forecast_booked_price_candidate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,approval_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pair JSONB; decision public.canonical_estimate_decisions%ROWTYPE;
 issued public.canonical_customer_estimate_versions%ROWTYPE;
BEGIN
 -- The pair reader validates current paid owner/admin/session authority,
 -- uses READ COMMITTED and holds the shared commercial source lock through
 -- this transaction. Never use a caller-supplied pair as source evidence.
 pair:=public.canonical_forecast_acceptance_booking_pair(
  org,actor,role_value,session_value,approval_value);
 IF pair->>'state'='accepted_link_revoked_before_approval' THEN
  RETURN jsonb_build_object('state','response_revoked_before_approval',
   'lineageState',pair->>'state','candidateOnly',TRUE,
   'bookedWorkVerified',FALSE,'savedRunCurrentnessVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 IF pair->>'state'<>'ordered_same_opportunity_candidate' THEN
  RETURN jsonb_build_object('state','lineage_unavailable',
   'lineageState',pair->>'state','candidateOnly',TRUE,
   'bookedWorkVerified',FALSE,'savedRunCurrentnessVerified',FALSE,
   'forecastIssued',FALSE);
 END IF;
 -- Mission 24 decision inserts hold this tenant lock through commit. Taking
 -- it after the commercial lock gives an ordered current read of both
 -- sources without changing either sealed writer contract.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Approved-price source is busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO issued FROM public.canonical_customer_estimate_versions
  WHERE organization_id=org AND estimate_id=(pair->>'estimateId')::uuid
   AND id=(pair->>'issuedVersionId')::uuid;
 SELECT * INTO decision FROM public.canonical_estimate_decisions
  WHERE organization_id=org AND estimate_id=(pair->>'estimateId')::uuid
  ORDER BY revision DESC LIMIT 1;
 IF issued.id IS NULL OR decision.id IS NULL OR
  issued.decision_id IS DISTINCT FROM (pair->>'approvedDecisionId')::uuid OR
  decision.id IS DISTINCT FROM issued.decision_id OR decision.action<>'approve'
  OR decision.digest IS DISTINCT FROM pair->>'approvedDecisionDigest' THEN
  RETURN jsonb_build_object('state','approved_price_changed_or_unavailable',
   'candidateOnly',TRUE,'bookedWorkVerified',FALSE,
   'savedRunCurrentnessVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 IF issued.document->>'currency' IS DISTINCT FROM decision.currency OR
  issued.document->>'subtotal' IS DISTINCT FROM decision.price_before_tax OR
  decision.price_before_tax !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN
  RETURN jsonb_build_object('state','issued_price_mismatch',
   'candidateOnly',TRUE,'bookedWorkVerified',FALSE,
   'savedRunCurrentnessVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','reviewed_price_candidate',
  'estimateId',issued.estimate_id,'issuedVersionId',issued.id,
  'approvalId',approval_value,'approvedDecisionId',decision.id,
  'priceBeforeTax',decision.price_before_tax,'currency',decision.currency,
  'decisionMatchesLatestAtRead',TRUE,
  'linkRevokedAfterApproval',pair->'linkRevokedAfterApproval',
  'candidateOnly',TRUE,'bookedWorkVerified',FALSE,
  'savedRunCurrentnessVerified',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_booked_price_candidate(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booked_price_candidate(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
