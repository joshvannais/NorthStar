-- Mission 27 Part 3A: private, read-only projection of one exact current
-- Mission 24 commercial and booking lineage into the shared Polaris editable
-- estimate seam. This creates no estimate revision, option, booking, work,
-- invoice, payment, provider request, or receiver mutation.

CREATE FUNCTION public.canonical_customer_financial_editable_basis_v1_immutable()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Editable estimate capability history is immutable'
  USING ERRCODE='55000';
END $$;

CREATE TABLE public.canonical_customer_financial_estimate_capability_grants_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 estimate_id UUID NOT NULL,
 capability TEXT NOT NULL CHECK(capability='customer_financial.estimate.edit_draft'),
 target_class TEXT NOT NULL CHECK(target_class='canonical_estimate'),
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.editable_estimate_basis'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(
  policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 template_version TEXT NOT NULL CHECK(template_version IN('m27.owner.v1','m27.admin.v1')),
 action_mode TEXT NOT NULL CHECK(action_mode='single_control'),
 assurance TEXT NOT NULL CHECK(assurance='current_session'),
 active BOOLEAN NOT NULL,
 valid_from TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL CHECK(expires_at>valid_from),
 issued_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id,revision),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id)
  REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_customer_financial_estimate_capability_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 capability_grant_id UUID NOT NULL,
 latest_revision BIGINT NOT NULL CHECK(latest_revision BETWEEN 1 AND 9007199254740991),
 advanced_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,capability_grant_id),
 FOREIGN KEY(organization_id,capability_grant_id,latest_revision)
  REFERENCES public.canonical_customer_financial_estimate_capability_grants_v1(
   organization_id,id,revision) ON DELETE RESTRICT
);

CREATE FUNCTION public.canonical_customer_financial_editable_basis_v1_grant_head()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_revision BIGINT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  NEW.organization_id::text||':editable-estimate-capability-scope:'||
  NEW.actor_user_id::text||':'||NEW.estimate_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  NEW.organization_id::text||':editable-estimate-capability:'||NEW.id::text,0));
 SELECT latest_revision INTO current_revision
 FROM public.canonical_customer_financial_estimate_capability_heads_v1
 WHERE organization_id=NEW.organization_id AND capability_grant_id=NEW.id
 FOR UPDATE;
 IF current_revision IS NOT NULL AND NEW.revision<=current_revision THEN
  RAISE EXCEPTION 'Editable estimate capability revision is not newer'
   USING ERRCODE='23505';
 END IF;
 INSERT INTO public.canonical_customer_financial_estimate_capability_heads_v1(
  organization_id,capability_grant_id,latest_revision,advanced_at)
 VALUES(NEW.organization_id,NEW.id,NEW.revision,clock_timestamp())
 ON CONFLICT(organization_id,capability_grant_id) DO UPDATE
 SET latest_revision=EXCLUDED.latest_revision,advanced_at=EXCLUDED.advanced_at;
 RETURN NEW;
END $$;

CREATE TRIGGER canonical_customer_financial_estimate_capability_grants_v1_head
 AFTER INSERT ON public.canonical_customer_financial_estimate_capability_grants_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_editable_basis_v1_grant_head();
CREATE TRIGGER canonical_customer_financial_estimate_capability_grants_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_estimate_capability_grants_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_editable_basis_v1_immutable();
CREATE TRIGGER canonical_customer_financial_estimate_capability_heads_v1_immutable
 BEFORE DELETE OR TRUNCATE ON public.canonical_customer_financial_estimate_capability_heads_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_editable_basis_v1_immutable();

CREATE FUNCTION public.canonical_customer_financial_editable_basis_v1_authority(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_authority JSONB;
 selected_grant public.canonical_customer_financial_estimate_capability_grants_v1%ROWTYPE;
 candidate_grant public.canonical_customer_financial_estimate_capability_grants_v1%ROWTYPE;
 candidate_count INTEGER:=0;
BEGIN
 IF org IS NULL OR actor IS NULL OR session_value IS NULL OR estimate_value IS NULL OR
    role_value IS NULL OR role_value NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'Editable estimate basis access restricted'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_editable_basis_unauthorized';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   org::text||':editable-estimate-capability-scope:'||actor::text||':'||estimate_value::text,0)) THEN
  RAISE EXCEPTION 'Editable estimate capability is busy' USING ERRCODE='55P03';
 END IF;
 actor_authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Current editable estimate basis entitlement unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_editable_basis_unauthorized';
 END IF;
 FOR candidate_grant IN
  SELECT grant_value.*
  FROM public.canonical_customer_financial_estimate_capability_grants_v1 grant_value
  JOIN public.canonical_customer_financial_estimate_capability_heads_v1 head_value
   ON head_value.organization_id=grant_value.organization_id
   AND head_value.capability_grant_id=grant_value.id
   AND head_value.latest_revision=grant_value.revision
  WHERE grant_value.organization_id=org AND grant_value.actor_user_id=actor
   AND grant_value.membership_id=(actor_authority->>'membershipId')::uuid
   AND grant_value.estimate_id=estimate_value
   AND grant_value.capability='customer_financial.estimate.edit_draft'
   AND grant_value.target_class='canonical_estimate'
   AND grant_value.business_purpose='customer_financial.editable_estimate_basis'
   AND grant_value.policy_version='mission27.launch.v1'
   AND rtrim(grant_value.policy_digest)='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'
   AND grant_value.template_version=CASE role_value
    WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END
   AND grant_value.action_mode='single_control' AND grant_value.assurance='current_session'
   AND grant_value.active=TRUE AND grant_value.issued_at<=clock_timestamp()
   AND grant_value.valid_from<=clock_timestamp() AND grant_value.expires_at>clock_timestamp()
  ORDER BY grant_value.id
  FOR SHARE OF grant_value,head_value
 LOOP
  candidate_count:=candidate_count+1; selected_grant:=candidate_grant;
 END LOOP;
 IF candidate_count<>1 OR selected_grant.id IS NULL THEN
  RAISE EXCEPTION 'Current editable estimate capability unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_editable_basis_capability_unavailable';
 END IF;
 RETURN jsonb_build_object(
  'organizationId',org,'actorUserId',actor,'actorAccessRole',role_value,
  'authSessionId',session_value,'membershipId',selected_grant.membership_id,
  'capability','customer_financial.estimate.edit_draft',
  'capabilityGrantId',selected_grant.id,'capabilityGrantRevision',selected_grant.revision,
  'businessPurpose',selected_grant.business_purpose,
  'policyVersion',selected_grant.policy_version,'policyDigest',rtrim(selected_grant.policy_digest));
END $$;

CREATE FUNCTION public.canonical_customer_financial_editable_basis_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; review_value UUID; candidate_count INTEGER:=0;
 currentness JSONB; lineage RECORD;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required for editable estimate basis'
   USING ERRCODE='25001';
 END IF;
 -- Match the released Mission 24 commercial writer lock order.  This shared
 -- tenant fence prevents an issued version, approval, acceptance revocation,
 -- or related commercial source from changing after currentness is proved.
 PERFORM 1 FROM public.organizations WHERE id=org FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Editable estimate basis access restricted'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_editable_basis_unauthorized';
 END IF;
 authority:=public.canonical_customer_financial_editable_basis_v1_authority(
  org,actor,role_value,session_value,estimate_value);
 WITH latest AS (
  SELECT DISTINCT ON (appointment_id) id,estimate_id,action
  FROM public.canonical_forecast_commercial_booking_reviews
  WHERE organization_id=org
  ORDER BY appointment_id,review_order DESC)
 SELECT count(*)::int,(array_agg(id ORDER BY id))[1] INTO candidate_count,review_value
 FROM latest WHERE estimate_id=estimate_value AND action<>'booking_cancelled';
 IF candidate_count=0 THEN
  RETURN jsonb_build_object('state','unavailable','reason','current_booking_review_unavailable',
   'value',NULL,'sourceCurrent',FALSE,'providerCallCount',0,'receiverMutationCount',0);
 ELSIF candidate_count<>1 THEN
  RETURN jsonb_build_object('state','unavailable','reason','current_booking_review_ambiguous',
   'value',NULL,'sourceCurrent',FALSE,'providerCallCount',0,'receiverMutationCount',0);
 END IF;
 currentness:=public.canonical_forecast_commercial_review_currentness(
  org,actor,role_value,session_value,review_value);
 IF currentness->>'state'<>'review_evidence_current_at_read' OR
    currentness->'reviewCurrentAtRead' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('state','unavailable','reason','source_currentness_unavailable',
   'value',NULL,'sourceCurrent',FALSE,'providerCallCount',0,'receiverMutationCount',0);
 END IF;
 SELECT review.id review_id,review.review_order,review.reviewed_at,review.appointment_id,
  review.approval_id schedule_approval_id,review.acceptance_id,review.opportunity_id,
  review.approved_decision_id,review.approved_decision_digest,
  review.reviewed_price_before_tax,review.currency,
  estimate.id estimate_id,estimate.graph_id,estimate.operation_id,estimate.snapshot_digest,
  estimate.calculation_version,estimate.normalized_input_fingerprint,
  opportunity.customer_id,opportunity.service_type,
  issued.id issued_version_id,issued.revision issued_revision,issued.digest issued_digest,
  issued.document_digest,issued.document,issued.created_at issued_at,
  terms.id terms_id,terms.revision terms_revision,terms.digest terms_digest,
  approval.id commercial_approval_id,approval.digest commercial_approval_digest,
  decision.revision decision_revision,decision.digest decision_digest,
  acceptance.link_id,acceptance.digest acceptance_digest,acceptance.created_at accepted_at,
  assignment.id assignment_id,assignment.revision assignment_revision,
  rtrim(assignment.canonical_digest) assignment_digest,
  assignment.schedule_state,assignment.appointment_status,
  assignment.scheduled_start,assignment.scheduled_end,
  assignment.updated_at assignment_updated_at
 INTO lineage
 FROM public.canonical_forecast_commercial_booking_reviews review
 JOIN public.canonical_estimates estimate ON estimate.organization_id=review.organization_id
  AND estimate.id=review.estimate_id
 JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=estimate.organization_id
  AND opportunity.id=estimate.opportunity_id
 JOIN public.canonical_customer_estimate_versions issued ON issued.organization_id=review.organization_id
  AND issued.estimate_id=review.estimate_id AND issued.id=review.issued_version_id
 JOIN public.canonical_commercial_terms terms ON terms.organization_id=issued.organization_id
  AND terms.estimate_id=issued.estimate_id AND terms.id=issued.terms_id
 JOIN public.canonical_commercial_approvals approval ON approval.organization_id=issued.organization_id
  AND approval.estimate_id=issued.estimate_id AND approval.id=issued.commercial_approval_id
 JOIN public.canonical_estimate_decisions decision ON decision.organization_id=issued.organization_id
  AND decision.estimate_id=issued.estimate_id AND decision.id=issued.decision_id
 JOIN public.canonical_customer_estimate_delivery_events acceptance
  ON acceptance.organization_id=review.organization_id AND acceptance.id=review.acceptance_id
  AND acceptance.kind='accepted'
 JOIN public.canonical_schedule_assignments assignment
  ON assignment.organization_id=review.organization_id
  AND assignment.appointment_id=review.appointment_id
 WHERE review.organization_id=org AND review.id=review_value
  AND estimate.id=estimate_value AND estimate.opportunity_id=review.opportunity_id
  AND opportunity.id=review.opportunity_id
  AND issued.commercial_approval_id=approval.id AND issued.terms_id=terms.id
  AND issued.decision_id=decision.id AND approval.terms_id=terms.id
  AND approval.decision_id=decision.id AND decision.action='approve'
  AND rtrim(decision.digest)=review.approved_decision_digest
  AND decision.price_before_tax=review.reviewed_price_before_tax
  AND decision.currency=review.currency AND terms.action='save'
  AND issued.document->>'state'='issued'
  AND acceptance.estimate_id=estimate.id AND acceptance.version_id=issued.id
  AND assignment.last_human_approval_id=review.approval_id
  AND assignment.schedule_state='scheduled'
  AND assignment.appointment_status IN('preferred','scheduled')
  AND NOT EXISTS(SELECT 1 FROM public.canonical_customer_estimate_delivery_events revoked
   WHERE revoked.link_id=acceptance.link_id AND revoked.kind='revoked')
  AND NOT EXISTS(SELECT 1 FROM public.canonical_customer_estimate_versions newer
   WHERE newer.organization_id=issued.organization_id AND newer.estimate_id=issued.estimate_id
    AND newer.revision>issued.revision)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_commercial_terms newer
   WHERE newer.organization_id=terms.organization_id AND newer.estimate_id=terms.estimate_id
    AND newer.revision>terms.revision)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_estimate_decisions newer
   WHERE newer.organization_id=decision.organization_id AND newer.estimate_id=decision.estimate_id
    AND newer.revision>decision.revision)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_commercial_approvals newer
   WHERE newer.organization_id=approval.organization_id AND newer.estimate_id=approval.estimate_id
    AND (newer.created_at>approval.created_at OR
     (newer.created_at=approval.created_at AND newer.id>approval.id)))
 FOR SHARE OF review,estimate,opportunity,issued,terms,approval,decision,acceptance,assignment;
 IF lineage.review_id IS NULL THEN
  RETURN jsonb_build_object('state','unavailable','reason','commercial_lineage_unavailable',
   'value',NULL,'sourceCurrent',FALSE,'providerCallCount',0,'receiverMutationCount',0);
 END IF;
 RETURN jsonb_build_object(
  'state','current_mission24_commercial_lineage','version','m27-mission24-commercial-editable-basis-v1',
  'sourceCurrent',TRUE,'capturedAt',to_char(
   greatest(lineage.reviewed_at,lineage.issued_at,lineage.accepted_at,
    lineage.assignment_updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'authority',authority,
  'identity',jsonb_build_object('estimateId',lineage.estimate_id,'customerId',lineage.customer_id,
   'opportunityId',lineage.opportunity_id,'graphId',lineage.graph_id,
   'operationId',lineage.operation_id,'bookingReviewId',lineage.review_id,
   'appointmentId',lineage.appointment_id,'scheduleApprovalId',lineage.schedule_approval_id,
   'acceptanceId',lineage.acceptance_id,'issuedVersionId',lineage.issued_version_id),
  'commercial',jsonb_build_object('currency',lineage.currency,
   'approvedPriceBeforeTax',lineage.reviewed_price_before_tax,
   'decisionId',lineage.approved_decision_id,'decisionRevision',lineage.decision_revision,
   'decisionDigest',rtrim(lineage.decision_digest),
   'termsId',lineage.terms_id,'termsRevision',lineage.terms_revision,
   'termsDigest',rtrim(lineage.terms_digest),
   'commercialApprovalId',lineage.commercial_approval_id,
   'commercialApprovalDigest',rtrim(lineage.commercial_approval_digest),
   'issuedRevision',lineage.issued_revision,'issuedDigest',rtrim(lineage.issued_digest),
   'documentDigest',rtrim(lineage.document_digest),'issuedAt',lineage.issued_at,
   'acceptedAt',lineage.accepted_at,'acceptanceDigest',rtrim(lineage.acceptance_digest)),
  'source',jsonb_build_object('estimateSnapshotDigest',rtrim(lineage.snapshot_digest),
   'calculationVersion',lineage.calculation_version,
   'normalizedInputFingerprint',rtrim(lineage.normalized_input_fingerprint),
   'bookingReviewOrder',lineage.review_order,'reviewedAt',lineage.reviewed_at),
  'booking',jsonb_build_object('scheduleAssignmentId',lineage.assignment_id,
   'revision',lineage.assignment_revision,'digest',lineage.assignment_digest,
   'state',lineage.schedule_state,'appointmentStatus',lineage.appointment_status,
   'scheduledStart',lineage.scheduled_start,'scheduledEnd',lineage.scheduled_end),
  'customerSafeDocument',jsonb_build_object('work',lineage.document->'work',
   'currency',lineage.document->'currency','charges',lineage.document->'charges',
   'adjustments',lineage.document->'adjustments','taxes',lineage.document->'taxes',
   'subtotal',lineage.document->'subtotal','tax',lineage.document->'tax',
   'total',lineage.document->'total','payments',lineage.document->'payments',
   'reference',lineage.document->'reference'),
  'providerCallCount',0,'receiverMutationCount',0);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_estimate_capability_grants_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_estimate_capability_heads_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_editable_basis_v1_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_editable_basis_v1_grant_head() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_editable_basis_v1_authority(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_editable_basis_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_editable_basis_v1_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
