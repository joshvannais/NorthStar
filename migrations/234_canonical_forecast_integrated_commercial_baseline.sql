-- Mission 26 Part 6A: one immutable capture-time commercial baseline over
-- complete bounded NorthStar sources. This composes the released M24
-- approved-estimate authority, the M22/M24/owner-reviewed booked-work
-- lineage, and one already activated genuinely future approved-price origin.
-- It does not reconstruct an earlier calendar cutoff, cover off-platform
-- business, recognize earned revenue or cash, or issue a production forecast.

-- A capture that holds the commercial source fence must see every estimate
-- version that committed before it. Drain pre-install writers before adding
-- the same tenant fence to all future issued-version inserts.
LOCK TABLE public.canonical_customer_estimate_versions,
 public.canonical_forecast_booked_work_confirmations IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION public.canonical_forecast_integrated_issued_source_fence()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||NEW.organization_id::text,0));
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_integrated_issued_source_fence
 BEFORE INSERT ON public.canonical_customer_estimate_versions
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_integrated_issued_source_fence();
CREATE TRIGGER canonical_forecast_integrated_confirmation_source_fence
 BEFORE INSERT ON public.canonical_forecast_booked_work_confirmations
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_integrated_issued_source_fence();

-- The immutable registrations from migrations 201 and 218 remain truthful
-- historical evidence: later accepted migrations extended their dependency
-- closure, so neither may be rewritten. Register the exact live closure used
-- by this integrated authority while retaining both sealed lineage identities.
CREATE TABLE public.canonical_forecast_integrated_method_registration (
 version TEXT PRIMARY KEY CHECK(
  version='m26_integrated_commercial_price_closure_v1'),
 legacy_semantic_version TEXT NOT NULL CHECK(
  legacy_semantic_version='m26_selected_m24_deterministic_closure_v1'),
 governance_lineage_version TEXT NOT NULL CHECK(
  governance_lineage_version='m26_complete_window_deterministic_closure_v2'),
 governance_lineage_digest TEXT NOT NULL CHECK(
  governance_lineage_digest~'^[0-9a-f]{64}$'),
 dependency_closure_digest TEXT NOT NULL CHECK(
  dependency_closure_digest~'^[0-9a-f]{64}$'),
 registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER canonical_forecast_integrated_method_registration_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_integrated_method_registration
 FOR EACH STATEMENT EXECUTE FUNCTION
  public.canonical_forecast_price_flow_origin_immutable();
INSERT INTO public.canonical_forecast_integrated_method_registration(
 version,legacy_semantic_version,governance_lineage_version,
 governance_lineage_digest,dependency_closure_digest)
SELECT 'm26_integrated_commercial_price_closure_v1',
 'm26_selected_m24_deterministic_closure_v1',
 governance.version,governance.dependency_closure_digest,
 public.canonical_forecast_price_flow_method_closure_digest()
FROM public.canonical_forecast_complete_window_governance_methods_v2 governance
WHERE governance.version='m26_complete_window_deterministic_closure_v2';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.canonical_forecast_integrated_method_registration)<>1 THEN
  RAISE EXCEPTION 'Integrated commercial method lineage unavailable'
   USING ERRCODE='23514';
 END IF;
END $$;

-- Build the exact current supported-source position while the caller holds
-- commercial, profile-effective-source, then price-decision source fences. The
-- M24 v2 epoch/current-source tables
-- provide installation-fenced, source-ordered decision completeness. Issued
-- versions are read from their full immutable ledger under the new fence.
-- Every currently confirmed booking is revalidated through the owning
-- schedule, acceptance, price, commercial-review and confirmation authority.
CREATE FUNCTION public.canonical_forecast_integrated_source_bound(
 source_kind TEXT,source_count INTEGER,manifest_size INTEGER)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF source_kind NOT IN ('approved_price','issued_current','issued_history',
    'commercial_review','confirmation_history') OR source_count<0 OR
    manifest_size<0 THEN
  RAISE EXCEPTION 'Integrated source bound input invalid' USING ERRCODE='22023';
 END IF;
 IF source_count>1000 THEN
  RETURN CASE source_kind
   WHEN 'approved_price' THEN 'approved_price_source_limit'
   WHEN 'issued_current' THEN 'issued_estimate_source_limit'
   WHEN 'issued_history' THEN 'issued_estimate_history_source_limit'
   WHEN 'commercial_review' THEN 'commercial_review_source_limit'
   ELSE 'booked_work_confirmation_source_limit' END;
 END IF;
 IF manifest_size>262144 THEN
  RETURN CASE WHEN source_kind='approved_price'
   THEN 'approved_price_manifest_size'
   WHEN source_kind IN ('issued_current','issued_history')
   THEN 'issued_estimate_manifest_size'
   ELSE 'booked_work_manifest_size' END;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.canonical_forecast_integrated_commercial_sources(
 org UUID,actor UUID,role_value TEXT,session_value UUID,currency_hint TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch public.canonical_forecast_approved_estimate_v2_epochs%ROWTYPE;
 state_row public.canonical_forecast_approved_estimate_v2_states%ROWTYPE;
 decision RECORD;issued RECORD;issued_history RECORD;reviewed RECORD;
 confirmation RECORD;confirmation_history RECORD;
 current_value JSONB;approved_manifest JSONB:='[]'::jsonb;
 issued_manifest JSONB:='[]'::jsonb;issued_history_manifest JSONB:='[]'::jsonb;
 booking_manifest JSONB:='[]'::jsonb;confirmation_manifest JSONB:='[]'::jsonb;
 confirmed_opportunity_ids JSONB:='[]'::jsonb;
 approved_count INTEGER:=0;withdrawn_count INTEGER:=0;
 issued_count INTEGER:=0;stale_issued_count INTEGER:=0;issued_history_count INTEGER:=0;
 review_count INTEGER:=0;reviewed_unconfirmed_count INTEGER:=0;
 corrected_unconfirmed_count INTEGER:=0;confirmed_count INTEGER:=0;
 confirmation_history_count INTEGER:=0;
 corrected_formerly_confirmed_count INTEGER:=0;
 cancelled_count INTEGER:=0;cancelled_formerly_confirmed_count INTEGER:=0;
 approved_amount NUMERIC(20,2):=0;issued_amount NUMERIC(20,2):=0;
 booked_amount NUMERIC(20,2):=0;currency_value TEXT;
 commercial_order BIGINT;review_order_value BIGINT;checked_at TIMESTAMPTZ;
 source_hash TEXT;bound_reason TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for integrated commercial sources'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF currency_hint IS NULL OR currency_hint!~'^[A-Z]{3}$' THEN
  RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
   'reason','currency_authority_unavailable','forecastIssued',FALSE);
 END IF;
 currency_value:=currency_hint;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=org;
 SELECT * INTO state_row FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=org;
 IF epoch.organization_id IS NULL OR epoch.coverage_state<>'complete' OR
   state_row.organization_id IS NULL OR NOT state_row.ordering_complete OR
   state_row.coverage_starts_at<>epoch.coverage_starts_at OR
   public.canonical_forecast_approved_estimate_v2_gap(
    org,epoch.coverage_starts_at) THEN
  RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
   'reason','approved_price_coverage_unavailable','forecastIssued',FALSE);
 END IF;
 FOR decision IN
  SELECT current_source.estimate_id,current_source.decision_id,
   current_source.revision,current_source.action,current_source.digest,
   current_source.recorded_at,current_source.source_order,
   source.price_before_tax,source.currency
  FROM public.canonical_forecast_approved_estimate_v2_current_sources current_source
  JOIN public.canonical_estimate_decisions source
   ON source.organization_id=current_source.organization_id
    AND source.estimate_id=current_source.estimate_id
    AND source.id=current_source.decision_id
  WHERE current_source.organization_id=org
  ORDER BY current_source.estimate_id LIMIT 1001
 LOOP
  IF decision.action='withdraw' THEN
   withdrawn_count:=withdrawn_count+1;
  ELSIF decision.action='approve' AND decision.price_before_tax~
      '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' AND
      decision.currency~'^[A-Z]{3}$' THEN
   IF currency_value<>decision.currency THEN
    RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
     'reason','mixed_currency','forecastIssued',FALSE);
   END IF;
   approved_count:=approved_count+1;
   approved_amount:=approved_amount+decision.price_before_tax::numeric;
  ELSE
   RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
    'reason','approved_price_source_invalid','forecastIssued',FALSE);
  END IF;
  approved_manifest:=approved_manifest||jsonb_build_array(jsonb_build_object(
   'estimateId',decision.estimate_id,'decisionId',decision.decision_id,
   'revision',decision.revision,'action',decision.action,
   'digest',rtrim(decision.digest),'sourceOrder',decision.source_order));
 END LOOP;
 bound_reason:=public.canonical_forecast_integrated_source_bound(
  'approved_price',approved_count+withdrawn_count,
  octet_length(approved_manifest::text));
 IF approved_amount>999999999999999.99 OR bound_reason IS NOT NULL THEN
  RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
   'reason',CASE WHEN approved_amount>999999999999999.99 THEN 'amount_exceeds_limit'
    ELSE bound_reason END,'forecastIssued',FALSE);
 END IF;

 FOR issued IN
  SELECT current_version.id,current_version.estimate_id,current_version.revision,
   current_version.decision_id,current_version.document_digest,
   current_version.document,current_source.decision_id current_decision_id,
   current_source.action current_action
  FROM (
   SELECT DISTINCT ON (version.estimate_id) version.*
   FROM public.canonical_customer_estimate_versions version
   WHERE version.organization_id=org
   ORDER BY version.estimate_id,version.revision DESC,version.id DESC
   LIMIT 1001
  ) current_version
  LEFT JOIN public.canonical_forecast_approved_estimate_v2_current_sources current_source
   ON current_source.organization_id=current_version.organization_id
    AND current_source.estimate_id=current_version.estimate_id
  ORDER BY current_version.estimate_id
 LOOP
  IF issued.decision_id IS DISTINCT FROM issued.current_decision_id OR
     issued.current_action IS DISTINCT FROM 'approve' THEN
   stale_issued_count:=stale_issued_count+1;
   CONTINUE;
  END IF;
  IF issued.document->>'subtotal' !~
      '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR
    issued.document->>'currency' !~ '^[A-Z]{3}$' OR
    issued.document->>'currency' IS DISTINCT FROM currency_value THEN
   RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
    'reason','issued_estimate_source_invalid','forecastIssued',FALSE);
  END IF;
  issued_count:=issued_count+1;
  issued_amount:=issued_amount+(issued.document->>'subtotal')::numeric;
  issued_manifest:=issued_manifest||jsonb_build_array(jsonb_build_object(
   'estimateId',issued.estimate_id,'issuedVersionId',issued.id,
   'revision',issued.revision,'decisionId',issued.decision_id,
   'documentDigest',rtrim(issued.document_digest)));
 END LOOP;
 bound_reason:=public.canonical_forecast_integrated_source_bound(
  'issued_current',issued_count+stale_issued_count,
  octet_length(issued_manifest::text));
 IF bound_reason IS NOT NULL THEN
  RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
   'reason',bound_reason,'forecastIssued',FALSE);
 END IF;
 FOR issued_history IN
  SELECT version.id,version.estimate_id,version.revision,version.decision_id,
   version.document_digest
  FROM public.canonical_customer_estimate_versions version
  WHERE version.organization_id=org
  ORDER BY version.estimate_id,version.revision,version.id LIMIT 1001
 LOOP
  issued_history_count:=issued_history_count+1;
  issued_history_manifest:=issued_history_manifest||jsonb_build_array(jsonb_build_object(
   'estimateId',issued_history.estimate_id,'issuedVersionId',issued_history.id,
   'revision',issued_history.revision,'decisionId',issued_history.decision_id,
   'documentDigest',rtrim(issued_history.document_digest)));
 END LOOP;
 bound_reason:=public.canonical_forecast_integrated_source_bound(
  'issued_history',issued_history_count,
  octet_length(issued_history_manifest::text));
 IF issued_amount>999999999999999.99 OR bound_reason IS NOT NULL THEN
  RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
   'reason',CASE WHEN issued_amount>999999999999999.99 THEN 'amount_exceeds_limit'
    ELSE bound_reason END,'forecastIssued',FALSE);
 END IF;

 FOR reviewed IN
  SELECT current_review.* FROM (
   SELECT DISTINCT ON (review.appointment_id) review.*
   FROM public.canonical_forecast_commercial_booking_reviews review
   WHERE review.organization_id=org
   ORDER BY review.appointment_id,review.review_order DESC,review.id DESC
   LIMIT 1001
  ) current_review ORDER BY current_review.appointment_id
 LOOP
  review_count:=review_count+1;
  SELECT booked.id,booked.price_before_tax,booked.currency
   INTO confirmation
  FROM public.canonical_forecast_booked_work_confirmations booked
  WHERE booked.organization_id=org AND booked.review_id=reviewed.id;
  IF reviewed.action<>'booking_cancelled' THEN
   current_value:=public.canonical_forecast_commercial_review_currentness(
    org,actor,role_value,session_value,reviewed.id);
   IF current_value->>'state'<>'review_evidence_current_at_read' OR
     current_value->'reviewCurrentAtRead' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
     'reason','booked_work_lineage_unavailable','forecastIssued',FALSE);
   END IF;
  END IF;
  IF reviewed.action='booking_cancelled' THEN
   cancelled_count:=cancelled_count+1;
   IF EXISTS(SELECT 1 FROM public.canonical_forecast_booked_work_confirmations prior
      JOIN public.canonical_forecast_commercial_booking_reviews prior_review
       ON prior_review.organization_id=prior.organization_id
        AND prior_review.id=prior.review_id
     WHERE prior.organization_id=org
      AND prior_review.appointment_id=reviewed.appointment_id) THEN
    cancelled_formerly_confirmed_count:=cancelled_formerly_confirmed_count+1;
   END IF;
  ELSIF confirmation.id IS NULL THEN
   IF reviewed.action='booking_corrected' THEN
    corrected_unconfirmed_count:=corrected_unconfirmed_count+1;
    IF EXISTS(SELECT 1 FROM public.canonical_forecast_booked_work_confirmations prior
       JOIN public.canonical_forecast_commercial_booking_reviews prior_review
        ON prior_review.organization_id=prior.organization_id
         AND prior_review.id=prior.review_id
      WHERE prior.organization_id=org
       AND prior_review.appointment_id=reviewed.appointment_id) THEN
     corrected_formerly_confirmed_count:=corrected_formerly_confirmed_count+1;
    END IF;
   ELSE reviewed_unconfirmed_count:=reviewed_unconfirmed_count+1;
   END IF;
  ELSE
   current_value:=public.canonical_forecast_booked_work_confirmation_currentness(
    org,actor,role_value,session_value,confirmation.id);
   IF current_value->>'state'<>'owner_confirmed_booked_work_current' OR
     current_value->'bookedWorkVerified' IS DISTINCT FROM 'true'::jsonb OR
     current_value->>'reviewId' IS DISTINCT FROM reviewed.id::text OR
     current_value->>'priceBeforeTax' IS DISTINCT FROM reviewed.reviewed_price_before_tax OR
     current_value->>'currency' IS DISTINCT FROM reviewed.currency OR
     reviewed.currency IS DISTINCT FROM currency_value THEN
   RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
     'reason','booked_work_lineage_unavailable','forecastIssued',FALSE);
   END IF;
   -- An opportunity is one commercial sale. Multiple current appointments may
   -- never make the same accepted estimate look like multiple booked jobs.
   IF confirmed_opportunity_ids ? reviewed.opportunity_id::text THEN
    RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
     'reason','duplicate_current_booked_opportunity','forecastIssued',FALSE);
   END IF;
   confirmed_opportunity_ids:=confirmed_opportunity_ids||
    jsonb_build_array(reviewed.opportunity_id::text);
   confirmed_count:=confirmed_count+1;
   booked_amount:=booked_amount+(current_value->>'priceBeforeTax')::numeric;
  END IF;
  booking_manifest:=booking_manifest||jsonb_build_array(jsonb_build_object(
   'appointmentId',reviewed.appointment_id,'opportunityId',reviewed.opportunity_id,
   'reviewId',reviewed.id,'reviewOrder',reviewed.review_order,
   'action',reviewed.action,'acceptanceId',reviewed.acceptance_id,
   'issuedVersionId',reviewed.issued_version_id,
   'approvedDecisionId',reviewed.approved_decision_id,
   'confirmationId',confirmation.id));
 END LOOP;
 bound_reason:=public.canonical_forecast_integrated_source_bound(
  'commercial_review',review_count,octet_length(booking_manifest::text));
 IF bound_reason IS NOT NULL THEN
  RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
   'reason',bound_reason,'forecastIssued',FALSE);
 END IF;
 FOR confirmation_history IN
  SELECT booked.id,booked.review_id,review.appointment_id,review.review_order
  FROM public.canonical_forecast_booked_work_confirmations booked
  JOIN public.canonical_forecast_commercial_booking_reviews review
   ON review.organization_id=booked.organization_id AND review.id=booked.review_id
  WHERE booked.organization_id=org
  ORDER BY review.appointment_id,review.review_order,booked.id LIMIT 1001
 LOOP
  confirmation_history_count:=confirmation_history_count+1;
  confirmation_manifest:=confirmation_manifest||jsonb_build_array(jsonb_build_object(
   'appointmentId',confirmation_history.appointment_id,
   'reviewOrder',confirmation_history.review_order,
   'reviewId',confirmation_history.review_id,
   'confirmationId',confirmation_history.id));
 END LOOP;
 bound_reason:=public.canonical_forecast_integrated_source_bound(
  'confirmation_history',confirmation_history_count,
  octet_length(confirmation_manifest::text));
 IF booked_amount>999999999999999.99 OR bound_reason IS NOT NULL THEN
  RETURN jsonb_build_object('state','integrated_commercial_sources_unavailable',
   'reason',CASE WHEN booked_amount>999999999999999.99 THEN 'amount_exceeds_limit'
    ELSE bound_reason END,'forecastIssued',FALSE);
 END IF;
 SELECT COALESCE(MAX(source_order),0) INTO commercial_order
  FROM public.canonical_forecast_commercial_booking_orders
  WHERE organization_id=org;
 SELECT COALESCE(MAX(review_order),0) INTO review_order_value
  FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org;
 IF state_row.high_water_order>9007199254740991 OR
   commercial_order>9007199254740991 OR review_order_value>9007199254740991 THEN
  RAISE EXCEPTION 'Integrated commercial source order exceeds safe size'
   USING ERRCODE='54000';
 END IF;
 checked_at:=clock_timestamp();
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-integrated-commercial-sources-v1','organizationId',org,
  'currency',currency_value,'approvedCoverageStartsAt',
   public.canonical_forecast_utc_instant(epoch.coverage_starts_at),
  'approvedCoverageStartOrder',epoch.coverage_start_order,
  'approvedHighWaterOrder',state_row.high_water_order,
  'commercialHighWaterOrder',commercial_order,
  'commercialReviewHighWaterOrder',review_order_value,
  'approvedSources',approved_manifest,'issuedCurrentSources',issued_manifest,
  'issuedHistorySources',issued_history_manifest,
  'bookingCurrentSources',booking_manifest,
  'bookingConfirmationSources',confirmation_manifest));
 RETURN jsonb_build_object('state','current_integrated_commercial_sources',
  'scope','northstar_supported_commercial_sources_at_capture',
  'checkedAt',public.canonical_forecast_utc_instant(checked_at),
  'currency',currency_value,
  'authorizedEstimateBeforeTax',issued_amount::text,
  'approvedPriceBeforeTax',approved_amount::text,
  'bookedWorkBeforeTax',booked_amount::text,
  'commercialStatuses',jsonb_build_object(
   'currentIssuedEstimateCount',issued_count,
   'issuedVersionSourceCount',issued_history_count,
   'staleIssuedEstimateCount',stale_issued_count,
   'activeApprovedPriceCount',approved_count,
   'withdrawnPriceCount',withdrawn_count,
   'ownerReviewedUnconfirmedCount',reviewed_unconfirmed_count,
   'correctedAwaitingConfirmationCount',corrected_unconfirmed_count,
   'correctedFormerlyConfirmedCount',corrected_formerly_confirmed_count,
   'ownerConfirmedBookedCount',confirmed_count,
   'bookingConfirmationSourceCount',confirmation_history_count,
   'cancelledBookingCount',cancelled_count,
   'cancelledFormerlyConfirmedCount',cancelled_formerly_confirmed_count),
  'approvedCoverageStartsAt',
   public.canonical_forecast_utc_instant(epoch.coverage_starts_at),
  'approvedCoverageStartOrder',epoch.coverage_start_order,
  'approvedHighWaterOrder',state_row.high_water_order,
  'commercialHighWaterOrder',commercial_order,
  'commercialReviewHighWaterOrder',review_order_value,
  'sourceDigest',source_hash,'sourceCohortsCompleteAtRead',TRUE,
  'captureTimeEquivalentVerified',TRUE,'naturalObservationPeriodVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'earnedRevenueMeasured',FALSE,
  'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
END $$;

-- Validate an already saved, profile-witnessed and separately activated Part
-- 3B origin without exposing its private amount. The origin must still point
-- into the future; its exact ordered source receipt, calendar/profile witness,
-- and deterministic registered method identity must all remain current.
CREATE FUNCTION public.canonical_forecast_integrated_future_price_origin(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_price_flow_saved_origins%ROWTYPE;
 activation public.canonical_forecast_price_flow_origin_activations%ROWTYPE;
 witness public.canonical_forecast_price_flow_profile_witnesses%ROWTYPE;
 profile_anchor public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 profile_activation public.canonical_forecast_profile_effective_activations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
 method_registration public.canonical_forecast_price_flow_method_registration%ROWTYPE;
 method_registration_v2 public.canonical_forecast_complete_window_governance_methods_v2%ROWTYPE;
 integrated_method_registration public.canonical_forecast_integrated_method_registration%ROWTYPE;
 source JSONB;now_value TIMESTAMPTZ:=clock_timestamp();
 expected_profile_proof TEXT;
BEGIN
 SELECT * INTO saved FROM public.canonical_forecast_price_flow_saved_origins
  WHERE organization_id=org AND id=origin_value;
 SELECT * INTO activation FROM public.canonical_forecast_price_flow_origin_activations
  WHERE organization_id=org AND run_id=origin_value;
 SELECT * INTO witness FROM public.canonical_forecast_price_flow_profile_witnesses
  WHERE organization_id=org AND run_id=origin_value;
 SELECT * INTO profile_anchor FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=witness.profile_anchor_id;
 SELECT * INTO profile_activation FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=witness.profile_anchor_id;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=profile_anchor.business_profile_id;
 IF saved.id IS NULL OR activation.run_id IS NULL OR witness.run_id IS NULL OR
    profile_anchor.id IS NULL OR profile_activation.anchor_id IS NULL OR
    profile_row.id IS NULL THEN
  RETURN jsonb_build_object('state','future_approved_price_baseline_unavailable',
   'reason','origin_or_activation_missing','forecastIssued',FALSE);
 END IF;
 expected_profile_proof:=public.canonical_completion_digest(jsonb_build_object(
  'runId',saved.id,'profileAnchorId',profile_anchor.id,
  'profileId',profile_anchor.business_profile_id,
  'profileHash',rtrim(profile_anchor.business_profile_hash),
  'activationObservedAt',
   public.canonical_forecast_utc_instant(profile_activation.observed_at),
  'witnessObservedAt',public.canonical_forecast_utc_instant(witness.observed_at)));
 source:=public.canonical_forecast_price_ordered_read(
  org,actor,role_value,session_value,saved.source_receipt_id);
 SELECT * INTO method_registration
   FROM public.canonical_forecast_price_flow_method_registration
   WHERE version='m26_selected_m24_deterministic_closure_v1';
 SELECT * INTO method_registration_v2
   FROM public.canonical_forecast_complete_window_governance_methods_v2
   WHERE version='m26_complete_window_deterministic_closure_v2';
 SELECT * INTO integrated_method_registration
   FROM public.canonical_forecast_integrated_method_registration
   WHERE version='m26_integrated_commercial_price_closure_v1';
 IF source IS NULL OR source->>'state'<>'current' OR
   source->'sourceOrderCurrent' IS DISTINCT FROM 'true'::jsonb OR
   saved.horizon_start<=now_value OR saved.horizon_end<>saved.horizon_start+INTERVAL '1 day' OR
   activation.observed_at>=saved.horizon_start OR
   activation.proof->'preHorizonCommitVerified' IS DISTINCT FROM 'true'::jsonb OR
    activation.proof_digest<>public.canonical_completion_digest(activation.proof) OR
    saved.receipt_digest<>public.canonical_completion_digest(saved.output) OR
    witness.observed_at>=saved.horizon_start OR
    profile_anchor.captured_at>=saved.saved_at OR
    profile_activation.observed_at>=saved.saved_at OR
    profile_anchor.captured_at>=saved.horizon_start OR
    profile_activation.observed_at>=saved.horizon_start OR
    rtrim(witness.proof_digest)<>expected_profile_proof OR
    profile_row.version_number<>profile_anchor.business_profile_version OR
    profile_row.normalized_profile_hash<>profile_anchor.business_profile_hash OR
    public.canonical_completion_digest(profile_row.raw_profile)<>
     rtrim(profile_anchor.raw_profile_digest) OR
    profile_row.raw_profile->'company'->>'timeZone'<>'UTC' OR
    profile_row.raw_profile->'company'->>'currency' IS DISTINCT FROM
     saved.output->'unit'->>'currency' OR
    EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events event
     WHERE event.organization_id=org AND
      event.source_order>profile_anchor.source_order LIMIT 1) OR
    method_registration.version IS NULL OR
    method_registration.method_kind<>'deterministic' OR
    method_registration.target_key<>'revenue.approved_price_flow' OR
    method_registration.target_version<>'v1' OR
    method_registration.source_scope<>'northstar_m24_approved_price_decisions' OR
    method_registration.output_kind<>'point' OR
    method_registration.interval_policy<>'unavailable' OR
    method_registration.eligibility_state<>'registered' OR
    method_registration.dependency_closure_digest !~ '^[0-9a-f]{64}$' OR
    method_registration_v2.version IS NULL OR
    method_registration_v2.method_kind<>'deterministic' OR
    method_registration_v2.dependency_closure_digest !~ '^[0-9a-f]{64}$' OR
    integrated_method_registration.version IS NULL OR
    integrated_method_registration.legacy_semantic_version IS DISTINCT FROM
     method_registration.version OR
    integrated_method_registration.governance_lineage_version IS DISTINCT FROM
     method_registration_v2.version OR
    integrated_method_registration.governance_lineage_digest IS DISTINCT FROM
     method_registration_v2.dependency_closure_digest OR
    integrated_method_registration.dependency_closure_digest IS DISTINCT FROM
     public.canonical_forecast_price_flow_method_closure_digest() OR
    saved.output->'target'->>'key'<>'revenue.approved_price_flow' OR
   saved.output->'target'->>'definitionVersion'<>'v1' OR
   saved.output->'unit'->>'key'<>'money' OR
   saved.output->'unit'->>'currency' !~ '^[A-Z]{3}$' OR
   saved.output->'value'->>'kind'<>'point' OR
   saved.output->'value'->>'amount' !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{2}$' OR
   saved.output->>'calculationVersion'<>'m26_price_flow_carry_forward_v1' OR
   saved.output->>'sourceSnapshotDigest' IS DISTINCT FROM
    source->'snapshot'->>'sourceSnapshotDigest' THEN
  RETURN jsonb_build_object('state','future_approved_price_baseline_unavailable',
   'reason','origin_stale_or_not_future','forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','future_approved_price_baseline_verified',
  'runId',saved.id,'targetKey','revenue.approved_price_flow',
  'definitionVersion','v1','calculationVersion',
   saved.output->>'calculationVersion','currency',saved.output->'unit'->>'currency',
  'calendarTimeZone','UTC','profileAnchorId',profile_anchor.id,
   'profileProofDigest',witness.proof_digest,
   'methodRegistrationVersion','m26_selected_m24_deterministic_closure_v1',
   'methodGovernanceRegistrationVersion',method_registration_v2.version,
   'methodGovernanceClosureDigest',method_registration_v2.dependency_closure_digest,
   'integratedMethodRegistrationVersion',integrated_method_registration.version,
   'integratedMethodClosureDigest',integrated_method_registration.dependency_closure_digest,
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_start),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_end),
  'sourceReceiptId',saved.source_receipt_id,
  'sourceSnapshotDigest',saved.output->>'sourceSnapshotDigest',
  'receiptDigest',saved.receipt_digest,
  'originProofDigest',activation.proof_digest,
  'captureCommitObservedAt',activation.proof->>'captureCommitObservedAt',
  'preHorizonCommitVerified',TRUE,'genuineFutureAtRead',TRUE,
  'amountStoredPrivately',TRUE,'valueWithheld',TRUE,
  'realForecastEligible',FALSE,'paidNumericServing',FALSE,
  'forecastIssued',FALSE);
END $$;

CREATE TABLE public.canonical_forecast_integrated_commercial_positions (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 captured_at TIMESTAMPTZ NOT NULL,
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 future_origin_id UUID NOT NULL,
 position JSONB NOT NULL,
 position_digest CHAR(64) NOT NULL CHECK(position_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,future_origin_id)
  REFERENCES public.canonical_forecast_price_flow_saved_origins(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(position->>'state'='northstar_integrated_commercial_baseline'),
 CHECK(position->'sourceCohortsCompleteAtCapture'='true'::jsonb),
 CHECK(position->'captureTimeEquivalentVerified'='true'::jsonb),
 CHECK(position->'futureApprovedPriceBaselineVerified'='true'::jsonb),
 CHECK(position->'earnedRevenueMeasured'='false'::jsonb),
 CHECK(position->'collectedCashMeasured'='false'::jsonb),
 CHECK(position->'forecastIssued'='false'::jsonb),
 CHECK(rtrim(position_digest)=public.canonical_completion_digest(position))
);
CREATE INDEX canonical_forecast_integrated_commercial_positions_recent
 ON public.canonical_forecast_integrated_commercial_positions(
  organization_id,captured_at DESC,id DESC);
CREATE FUNCTION public.canonical_forecast_integrated_commercial_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Integrated commercial baselines are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_integrated_commercial_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_integrated_commercial_positions
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_integrated_commercial_immutable();

CREATE FUNCTION public.canonical_forecast_capture_integrated_commercial_position(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 origin_value UUID,key_value TEXT,reason_value TEXT,confirmed_value BOOLEAN,
 version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_integrated_commercial_positions%ROWTYPE;
 inserted public.canonical_forecast_integrated_commercial_positions%ROWTYPE;
 sources JSONB;future JSONB;payload JSONB;captured TIMESTAMPTZ;
 key_hash TEXT;request_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
  origin_value IS NULL OR key_value IS NULL OR
  key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR reason_value IS NULL OR
  length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
  octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE OR
  version_value IS DISTINCT FROM 'integrated-commercial-baseline-v1' THEN
  RAISE EXCEPTION 'Integrated commercial baseline input invalid' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version',version_value,'organizationId',org,'actorUserId',actor,
  'futureApprovedPriceOriginId',origin_value,'reason',btrim(reason_value),
  'confirmed',confirmed_value));
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:integrated-commercial:'||org::text||':'||actor::text||':'||key_hash,0)) THEN
  RAISE EXCEPTION 'Integrated commercial request is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Profile source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Approved-price source is busy' USING ERRCODE='55P03';
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_forecast_integrated_commercial_positions
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL AND rtrim(old.request_digest)<>request_hash THEN
  RAISE EXCEPTION 'Integrated commercial request replay changed' USING ERRCODE='23505';
 END IF;
 future:=public.canonical_forecast_integrated_future_price_origin(
  org,actor,role_value,session_value,origin_value);
 IF future->>'state'<>'future_approved_price_baseline_verified' THEN
  RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
   'reason',COALESCE(future->>'reason','future_approved_price_baseline_unavailable'),
   'sourceCurrent',FALSE,'sourceCohortsCompleteAtRead',FALSE,
   'futureApprovedPriceBaselineVerified',FALSE,'earnedRevenueMeasured',FALSE,
   'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
 END IF;
 sources:=public.canonical_forecast_integrated_commercial_sources(
  org,actor,role_value,session_value,future->>'currency');
 IF sources->>'state'<>'current_integrated_commercial_sources' OR
   sources->'sourceCohortsCompleteAtRead' IS DISTINCT FROM 'true'::jsonb OR
   future->>'currency' IS DISTINCT FROM sources->>'currency' THEN
  RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
   'reason',CASE WHEN sources->>'state'<>'current_integrated_commercial_sources'
    THEN COALESCE(sources->>'reason','commercial_sources_unavailable')
    ELSE 'currency_conflict' END,'sourceCurrent',FALSE,
   'sourceCohortsCompleteAtRead',FALSE,'futureApprovedPriceBaselineVerified',FALSE,
   'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
 END IF;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.position_digest)<>public.canonical_completion_digest(old.position) THEN
   RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
    'reason','saved_position_integrity_invalid','positionId',old.id,
    'sourceCurrent',FALSE,'sourceCohortsCompleteAtRead',FALSE,
    'futureApprovedPriceBaselineVerified',FALSE,'earnedRevenueMeasured',FALSE,
    'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
  END IF;
  IF rtrim(old.source_digest)<>sources->>'sourceDigest' OR
    old.future_origin_id<>origin_value THEN
   RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
    'reason','sources_changed_since_capture','positionId',old.id,
    'sourceCurrent',FALSE,'sourceCohortsCompleteAtRead',FALSE,
    'futureApprovedPriceBaselineVerified',FALSE,'earnedRevenueMeasured',FALSE,
    'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
  END IF;
  RETURN old.position||jsonb_build_object('positionId',old.id,'replayed',TRUE,
   'sourceCurrent',TRUE);
 END IF;
 captured:=clock_timestamp();
 IF (future->>'horizonStartsAt')::timestamptz<=captured THEN
  RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
   'reason','future_horizon_elapsed_before_capture','sourceCurrent',FALSE,
   'sourceCohortsCompleteAtRead',FALSE,'futureApprovedPriceBaselineVerified',FALSE,
   'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
 END IF;
 payload:=jsonb_build_object(
  'state','northstar_integrated_commercial_baseline',
  'version','m26-integrated-commercial-baseline-v1',
  'scope','northstar_supported_commercial_sources_at_capture',
  'asOf',public.canonical_forecast_utc_instant(captured),
  'currency',sources->>'currency',
  'authorizedEstimateBeforeTax',sources->>'authorizedEstimateBeforeTax',
  'approvedPriceBeforeTax',sources->>'approvedPriceBeforeTax',
  'bookedWorkBeforeTax',sources->>'bookedWorkBeforeTax',
  'commercialStatuses',sources->'commercialStatuses',
  'sourceCapture',jsonb_build_object(
   'method','migration_fenced_current_state_v1',
   'sourceDigest',sources->>'sourceDigest',
   'approvedCoverageStartsAt',sources->>'approvedCoverageStartsAt',
   'approvedCoverageStartOrder',sources->'approvedCoverageStartOrder',
   'approvedHighWaterOrder',sources->'approvedHighWaterOrder',
   'commercialHighWaterOrder',sources->'commercialHighWaterOrder',
   'commercialReviewHighWaterOrder',sources->'commercialReviewHighWaterOrder'),
  'futureApprovedPriceBaseline',future-'state'-'currency'-'forecastIssued',
  'sourceCohortsCompleteAtCapture',TRUE,
  'captureTimeEquivalentVerified',TRUE,
  'naturalObservationPeriodVerified',FALSE,
  'futureApprovedPriceBaselineVerified',TRUE,
  'wholeBusinessCoverageVerified',FALSE,
  'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,
  'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_integrated_commercial_positions(
  organization_id,captured_at,source_digest,future_origin_id,position,
  position_digest,actor_user_id,membership_id,auth_session_id,reason,
  request_key_hash,request_digest)
 VALUES(org,captured,sources->>'sourceDigest',origin_value,payload,
  public.canonical_completion_digest(payload),actor,
  (authority->>'membershipId')::uuid,session_value,btrim(reason_value),
  key_hash,request_hash) RETURNING * INTO inserted;
 RETURN payload||jsonb_build_object('positionId',inserted.id,'replayed',FALSE,
  'sourceCurrent',TRUE);
END $$;

CREATE FUNCTION public.canonical_forecast_integrated_commercial_position_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,position_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_integrated_commercial_positions%ROWTYPE;
 sources JSONB;future JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for integrated commercial baseline read'
   USING ERRCODE='25001';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Profile source is busy' USING ERRCODE='55P03';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Approved-price source is busy' USING ERRCODE='55P03';
 END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_integrated_commercial_positions
  WHERE organization_id=org AND id=position_value;
 IF saved.id IS NULL THEN
  RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
   'reason','position_not_found','sourceCurrent',FALSE,
   'sourceCohortsCompleteAtRead',FALSE,'futureApprovedPriceBaselineVerified',FALSE,
   'earnedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
 END IF;
 IF rtrim(saved.position_digest)<>public.canonical_completion_digest(saved.position) THEN
  RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
   'reason','saved_position_integrity_invalid','positionId',saved.id,
   'sourceCurrent',FALSE,'sourceCohortsCompleteAtRead',FALSE,
   'futureApprovedPriceBaselineVerified',FALSE,'earnedRevenueMeasured',FALSE,
   'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
 END IF;
 future:=public.canonical_forecast_integrated_future_price_origin(
  org,actor,role_value,session_value,saved.future_origin_id);
 IF future->>'state'='future_approved_price_baseline_verified' THEN
  sources:=public.canonical_forecast_integrated_commercial_sources(
   org,actor,role_value,session_value,future->>'currency');
 ELSE
  sources:=jsonb_build_object('state','integrated_commercial_sources_unavailable');
 END IF;
 IF sources->>'state'<>'current_integrated_commercial_sources' OR
   future->>'state'<>'future_approved_price_baseline_verified' OR
   rtrim(saved.source_digest) IS DISTINCT FROM sources->>'sourceDigest' OR
   future->>'currency' IS DISTINCT FROM sources->>'currency' THEN
  RETURN jsonb_build_object('state','integrated_commercial_baseline_unavailable',
   'reason','sources_changed_or_future_horizon_elapsed','positionId',saved.id,
   'sourceCurrent',FALSE,'sourceCohortsCompleteAtRead',FALSE,
   'futureApprovedPriceBaselineVerified',FALSE,'earnedRevenueMeasured',FALSE,
   'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
 END IF;
 RETURN saved.position||jsonb_build_object('positionId',saved.id,
  'sourceCurrent',TRUE,'currentAtRead',TRUE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_integrated_commercial_positions,
 public.canonical_forecast_integrated_method_registration FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_integrated_issued_source_fence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_integrated_source_bound(
 TEXT,INTEGER,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_integrated_commercial_sources(
 UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_integrated_future_price_origin(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_integrated_commercial_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_capture_integrated_commercial_position(
 UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_integrated_commercial_position_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
  REVOKE ALL PRIVILEGES ON TABLE
   public.canonical_forecast_integrated_commercial_positions,
   public.canonical_forecast_integrated_method_registration FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_integrated_issued_source_fence(),
  public.canonical_forecast_integrated_source_bound(TEXT,INTEGER,INTEGER),
  public.canonical_forecast_integrated_commercial_sources(UUID,UUID,TEXT,UUID,TEXT),
  public.canonical_forecast_integrated_future_price_origin(UUID,UUID,TEXT,UUID,UUID),
  public.canonical_forecast_integrated_commercial_immutable()
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_capture_integrated_commercial_position(
  UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,TEXT,BOOLEAN,TEXT),
  public.canonical_forecast_integrated_commercial_position_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
