-- Mission 27 Part 3D: close the reviewed billable source with an immutable
-- handoff receipt and preserve the source-owned proposal plus every accepted
-- human draft revision.  These records authorize no invoice, provider call,
-- work mutation, learning write, or Mission 32 calculation.

CREATE TABLE public.canonical_customer_financial_billable_handoff_receipts_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL, estimate_id UUID NOT NULL, source_class TEXT NOT NULL
  CHECK(source_class IN('pre_work_deposit','final_balance')),
 decision_digest CHAR(64) NOT NULL CHECK(decision_digest~'^[0-9a-f]{64}$'),
 source_identity UUID NOT NULL, source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 source_authority_identity UUID NOT NULL,
 source_authority_digest CHAR(64) NOT NULL CHECK(source_authority_digest~'^[0-9a-f]{64}$'),
 commercial_basis_digest CHAR(64) NOT NULL CHECK(commercial_basis_digest~'^[0-9a-f]{64}$'),
 approval_set_digest CHAR(64) NOT NULL CHECK(approval_set_digest~'^[0-9a-f]{64}$'),
 request_lineage_digest CHAR(64) NOT NULL CHECK(request_lineage_digest~'^[0-9a-f]{64}$'),
 receipt JSONB NOT NULL, receipt_digest CHAR(64) NOT NULL CHECK(receipt_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,estimate_id,decision_digest),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_customer_financial_estimate_journey_revisions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 estimate_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
 revision_class TEXT NOT NULL CHECK(revision_class IN('source_original','human_revision')),
 snapshot JSONB NOT NULL, snapshot_digest CHAR(64) NOT NULL CHECK(snapshot_digest~'^[0-9a-f]{64}$'),
 source_proposal_digest CHAR(64) NOT NULL CHECK(source_proposal_digest~'^[0-9a-f]{64}$'),
 source_proposal_revision_digest CHAR(64) NOT NULL CHECK(source_proposal_revision_digest~'^[0-9a-f]{64}$'),
 option_lineage_digest CHAR(64) NOT NULL CHECK(option_lineage_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID, actor_access_role TEXT CHECK(actor_access_role IS NULL OR actor_access_role IN('owner','admin','member')),
 reason TEXT NOT NULL CHECK(octet_length(reason) BETWEEN 12 AND 1000),
 request_key_digest CHAR(64) CHECK(request_key_digest IS NULL OR request_key_digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,estimate_id,revision),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 CHECK((revision_class='source_original' AND revision=0 AND actor_user_id IS NULL) OR
       (revision_class='human_revision' AND revision>0 AND actor_user_id IS NOT NULL))
);

DO $policy$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_customer_financial_billable_handoff_receipts_v1',
  'canonical_customer_financial_estimate_journey_revisions_v1']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass)))',
   table_name||'_owner_only',table_name,'public.'||table_name,'public.'||table_name);
 END LOOP;
END $policy$;

CREATE TRIGGER canonical_customer_financial_billable_handoff_receipts_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billable_handoff_receipts_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_financial_estimate_journey_revisions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_estimate_journey_revisions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_ensure_handoff_receipt(
 org UUID,estimate_value UUID,decision_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_record public.canonical_customer_financial_billable_work_reviews_v1%ROWTYPE;
 approvals JSONB; requests JSONB; approval_count INTEGER; required_count INTEGER;
 receipt_value JSONB; receipt_digest_value TEXT; receipt_row RECORD;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billable-handoff:'||estimate_value::text||':'||decision_value,0));
 SELECT * INTO first_record FROM public.canonical_customer_financial_billable_work_reviews_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=decision_value
  ORDER BY reviewed_at,id LIMIT 1 FOR SHARE;
 IF first_record.id IS NULL THEN RETURN NULL; END IF;
 SELECT count(*)::int,jsonb_agg(jsonb_build_object(
  'reviewId',id,'actorUserId',actor_user_id,'capabilityGrantId',capability_grant_id,
  'capabilityGrantRevision',capability_grant_revision,
  'reviewDigest',public.canonical_completion_digest(jsonb_build_object(
   'reviewId',id,'actorUserId',actor_user_id,'membershipId',membership_id,
   'sourceDigest',rtrim(source_digest),'decisionDigest',rtrim(decision_digest),
   'reason',review_reason,'reviewedAt',public.canonical_customer_financial_billing_identity_v1_utc(reviewed_at))),
  'requestBindingDigest',public.canonical_completion_digest(jsonb_build_object(
   'actorUserId',actor_user_id,'authSessionId',auth_session_id,'capabilityGrantId',capability_grant_id,
   'capabilityGrantRevision',capability_grant_revision,'businessPurpose',business_purpose,
   'policyVersion',policy_version,'confirmationVersion',confirmation_version,
   'decisionDigest',rtrim(decision_digest),'reason',review_reason)))
  ORDER BY reviewed_at,id) INTO approval_count,approvals
 FROM public.canonical_customer_financial_billable_work_reviews_v1
 WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=decision_value;
 required_count:=CASE WHEN first_record.control_mode='single_control' THEN 1 ELSE 2 END;
 IF approval_count<>required_count THEN RETURN NULL; END IF;
 -- The immutable review itself contains the actor/session/grant/purpose/policy,
 -- confirmation and reason that bind its accepted request.  Digesting those
 -- bindings avoids a circular dependency on the response receipt that is
 -- inserted after the review reaches its required approval count.
 SELECT jsonb_agg(jsonb_build_object('reviewId',item.value->'reviewId',
  'requestBindingDigest',item.value->'requestBindingDigest') ORDER BY item.ordinal)
 INTO requests FROM jsonb_array_elements(approvals) WITH ORDINALITY item(value,ordinal);
 receipt_value:=jsonb_build_object('contractVersion','m27-billable-handoff-receipt-v1',
  'estimateId',estimate_value,'sourceClass',first_record.source_class,
  'sourceIdentity',first_record.source_identity,'workId',first_record.work_id,
  'sourceDigest',rtrim(first_record.source_digest),'sourceAuthorityIdentity',first_record.source_authority_identity,
  'sourceAuthorityDigest',rtrim(first_record.source_authority_digest),
  'commercialBasisDigest',rtrim(first_record.commercial_basis_digest),
  'decisionDigest',rtrim(first_record.decision_digest),
  'amount',jsonb_build_object('version','m27-exact-money-v1','currency','USD','minorUnitExponent',2,
   'minorUnits',first_record.amount_minor_units::text,
   'decimal',to_char(first_record.amount_minor_units/100.0,'FM999999999999990.00'),
   'exactZero',first_record.amount_minor_units=0),
  'controlMode',first_record.control_mode,'approvalCount',approval_count,
  'requiredApprovalCount',required_count,'approvalSet',approvals,
  'approvalSetDigest',public.canonical_completion_digest(approvals),
  'requestLineageDigest',public.canonical_completion_digest(requests),
  'downstreamContract','mission27.part4.invoice_draft_source.v1',
  'billableHandoffAuthorized',TRUE,'invoiceAuthorized',FALSE,'financialActionAuthorized',FALSE,
  'providerCallCount',0,'receiverMutationCount',0);
 receipt_digest_value:=public.canonical_completion_digest(receipt_value);
 INSERT INTO public.canonical_customer_financial_billable_handoff_receipts_v1(
  organization_id,id,estimate_id,source_class,decision_digest,source_identity,source_digest,
  source_authority_identity,source_authority_digest,commercial_basis_digest,approval_set_digest,
  request_lineage_digest,receipt,receipt_digest,created_at)
 VALUES(org,gen_random_uuid(),estimate_value,first_record.source_class,decision_value,first_record.source_identity,
  first_record.source_digest,first_record.source_authority_identity,first_record.source_authority_digest,
  first_record.commercial_basis_digest,public.canonical_completion_digest(approvals),
  public.canonical_completion_digest(requests),receipt_value,receipt_digest_value,clock_timestamp())
 ON CONFLICT(organization_id,estimate_id,decision_digest) DO NOTHING;
 SELECT * INTO receipt_row FROM public.canonical_customer_financial_billable_handoff_receipts_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=decision_value FOR SHARE;
 IF receipt_row.id IS NULL OR receipt_row.receipt_digest<>receipt_digest_value OR
  receipt_row.approval_set_digest<>public.canonical_completion_digest(approvals) THEN
  RAISE EXCEPTION 'Billable handoff receipt conflict' USING ERRCODE='40001'; END IF;
 RETURN receipt_row.receipt||jsonb_build_object('receiptId',receipt_row.id,
  'receiptDigest',rtrim(receipt_row.receipt_digest),
  'createdAt',public.canonical_customer_financial_billing_identity_v1_utc(receipt_row.created_at));
END $$;

CREATE OR REPLACE FUNCTION public.canonical_customer_financial_billable_review_v1_projection(
 org UUID,estimate_value UUID,decision_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_record public.canonical_customer_financial_billable_work_reviews_v1%ROWTYPE;
 approvals JSONB; count_value INTEGER; reviewed BOOLEAN; receipt_row RECORD;
BEGIN
 SELECT * INTO first_record FROM public.canonical_customer_financial_billable_work_reviews_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=decision_value
  ORDER BY reviewed_at,id LIMIT 1;
 IF first_record.id IS NULL THEN RETURN NULL; END IF;
 SELECT count(*)::integer,jsonb_agg(jsonb_build_object('reviewId',id,'actorUserId',actor_user_id,
  'actorAccessRole',actor_access_role,'reviewedAt',public.canonical_customer_financial_billing_identity_v1_utc(reviewed_at),
  'reason',review_reason) ORDER BY reviewed_at,id) INTO count_value,approvals
 FROM public.canonical_customer_financial_billable_work_reviews_v1
 WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=decision_value;
 reviewed:=first_record.control_mode='single_control' OR count_value>=2;
 SELECT * INTO receipt_row FROM public.canonical_customer_financial_billable_handoff_receipts_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=decision_value;
 IF reviewed AND receipt_row.id IS NULL THEN
  RETURN jsonb_build_object('contractVersion','m27-billable-work-review-v1','state','unavailable',
   'reason','handoff_receipt_unavailable','value',NULL,
   'missingEvidence',jsonb_build_array('mission27.immutable_billable_handoff_receipt'),
   'financialActionAuthorized',FALSE,'invoiceAuthorized',FALSE,'handoffReceiptAuthorized',FALSE,
   'providerCallCount',0,'receiverMutationCount',0);
 END IF;
 RETURN jsonb_build_object('contractVersion','m27-billable-work-review-v1',
  'state',CASE WHEN reviewed THEN 'reviewed_current' ELSE 'independent_review_required' END,
  'sourceClass',first_record.source_class,'estimateId',first_record.estimate_id,'workId',first_record.work_id,
  'sourceIdentity',first_record.source_identity,'sourceDigest',rtrim(first_record.source_digest),
  'sourceAuthorityIdentity',first_record.source_authority_identity,
  'sourceAuthorityDigest',rtrim(first_record.source_authority_digest),
  'commercialBasisDigest',rtrim(first_record.commercial_basis_digest),'decisionDigest',rtrim(first_record.decision_digest),
  'amount',jsonb_build_object('version','m27-exact-money-v1','currency','USD','minorUnitExponent',2,
   'minorUnits',first_record.amount_minor_units::text,'decimal',to_char(first_record.amount_minor_units/100.0,'FM999999999999990.00'),
   'exactZero',first_record.amount_minor_units=0),
  'controlMode',first_record.control_mode,'approvalCount',count_value,'requiredApprovalCount',
   CASE WHEN first_record.control_mode='single_control' THEN 1 ELSE 2 END,
  'approvals',approvals,'handoffReceipt',CASE WHEN reviewed THEN receipt_row.receipt||jsonb_build_object(
   'receiptId',receipt_row.id,'receiptDigest',rtrim(receipt_row.receipt_digest),
   'createdAt',public.canonical_customer_financial_billing_identity_v1_utc(receipt_row.created_at)) ELSE NULL END,
  'financialActionAuthorized',FALSE,'invoiceAuthorized',FALSE,'handoffReceiptAuthorized',reviewed,
  'providerCallCount',0,'receiverMutationCount',0);
END $$;

-- Seed receipts for already-complete Part 3C decisions before replacing the effect.
DO $backfill$ DECLARE item RECORD; BEGIN
 FOR item IN SELECT organization_id,estimate_id,rtrim(decision_digest) decision_digest
  FROM public.canonical_customer_financial_billable_work_reviews_v1
  GROUP BY organization_id,estimate_id,decision_digest,control_mode
  HAVING (control_mode='single_control' AND count(*)=1) OR (control_mode='dual_control' AND count(*)=2)
 LOOP PERFORM public.canonical_customer_financial_billable_review_v1_ensure_handoff_receipt(
  item.organization_id,item.estimate_id,item.decision_digest); END LOOP;
END $backfill$;

CREATE OR REPLACE FUNCTION public.canonical_customer_financial_billable_review_v1_accept(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,request_key TEXT,
 estimate_value UUID,grant_value UUID,grant_revision_value BIGINT,purpose_value TEXT,policy_version_value TEXT,
 source_class_value TEXT,expected_decision_digest TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; key_digest TEXT; request_digest_value TEXT; prior_request RECORD;
 approval public.canonical_customer_financial_billable_work_reviews_v1%ROWTYPE; current_value JSONB;
 source_value JSONB; projection JSONB; status_value INTEGER; count_value INTEGER; amount_value BIGINT; mode_value TEXT;
BEGIN
 IF request_key IS NULL OR octet_length(request_key) NOT BETWEEN 16 AND 200 OR
  confirmation_value<>'m27-billable-work-review-v1' OR reason_value IS NULL OR
  reason_value<>btrim(reason_value) OR octet_length(reason_value) NOT BETWEEN 12 AND 1000 OR
  source_class_value NOT IN('pre_work_deposit','final_balance') OR expected_decision_digest!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Billable-work review invalid' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_customer_financial_billable_review_v1_access(org,actor,role_value,session_value,csrf,
  estimate_value,grant_value,grant_revision_value,purpose_value,policy_version_value);
 current_value:=public.canonical_customer_financial_billable_review_v1_source(
  org,actor,role_value,session_value,estimate_value,source_class_value);
 IF current_value->>'state'<>'review_required' OR
  current_value#>>'{source,decisionDigest}'<>expected_decision_digest THEN
  RAISE EXCEPTION 'Billable-work source changed' USING ERRCODE='40001'; END IF;
 source_value:=current_value->'source'; amount_value:=(source_value#>>'{amount,minorUnits}')::bigint;
 mode_value:=source_value->>'controlMode'; key_digest:=encode(sha256(convert_to(request_key,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'authSessionId',session_value,'estimateId',estimate_value,'capabilityGrantId',grant_value,
  'capabilityGrantRevision',grant_revision_value,'sourceClass',source_class_value,
  'expectedDecisionDigest',expected_decision_digest,'reason',reason_value,'confirmationVersion',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billable-review-request:'||actor::text||':'||key_digest,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billable-review-decision:'||estimate_value::text||':'||expected_decision_digest,0));
 SELECT * INTO prior_request FROM public.canonical_customer_financial_billable_review_requests_v1
  WHERE organization_id=org AND actor_user_id=actor AND auth_session_id=session_value AND request_key_digest=key_digest FOR SHARE;
 IF prior_request.request_digest IS NOT NULL THEN
  IF rtrim(prior_request.request_digest)<>request_digest_value THEN RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE='23505'; END IF;
  projection:=public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,expected_decision_digest);
  IF projection IS NULL THEN RAISE EXCEPTION 'Billable-work review changed' USING ERRCODE='40001'; END IF;
  IF projection->>'state'='unavailable' AND projection->>'reason'='handoff_receipt_unavailable' THEN
   PERFORM public.canonical_customer_financial_billable_review_v1_ensure_handoff_receipt(org,estimate_value,expected_decision_digest);
   projection:=public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,expected_decision_digest);
  END IF;
  status_value:=CASE WHEN projection->>'state'='reviewed_current' THEN 201 ELSE 202 END;
  RETURN jsonb_build_object('status',status_value,'body',projection,'replayed',TRUE);
 END IF;
 SELECT count(*)::integer INTO count_value FROM public.canonical_customer_financial_billable_work_reviews_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=expected_decision_digest;
 IF count_value>0 AND mode_value='single_control' THEN RAISE EXCEPTION 'Billable-work source already reviewed' USING ERRCODE='23505'; END IF;
 IF count_value>=2 THEN RAISE EXCEPTION 'Billable-work source already fully reviewed' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_customer_financial_billable_work_reviews_v1(
  organization_id,estimate_id,source_class,source_identity,work_id,source_digest,source_authority_identity,
  source_authority_digest,commercial_basis_digest,decision_digest,currency,amount_minor_units,control_mode,
  actor_user_id,actor_access_role,membership_id,auth_session_id,capability_grant_id,capability_grant_revision,
  business_purpose,policy_version,policy_digest,review_reason,confirmation_version,reviewed_at)
 VALUES(org,estimate_value,source_value->>'sourceClass',(source_value->>'sourceIdentity')::uuid,
  NULLIF(source_value->>'workId','')::uuid,source_value->>'sourceDigest',(source_value->>'sourceAuthorityIdentity')::uuid,
  source_value->>'sourceAuthorityDigest',source_value->>'commercialBasisDigest',expected_decision_digest,'USD',
  amount_value,mode_value,actor,role_value,(authority->>'membershipId')::uuid,session_value,grant_value,
  grant_revision_value,purpose_value,policy_version_value,authority->>'policyDigest',reason_value,confirmation_value,
  clock_timestamp()) RETURNING * INTO approval;
 projection:=public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,expected_decision_digest);
 IF projection->>'state'='unavailable' AND projection->>'reason'='handoff_receipt_unavailable' THEN
  PERFORM public.canonical_customer_financial_billable_review_v1_ensure_handoff_receipt(org,estimate_value,expected_decision_digest);
  projection:=public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,expected_decision_digest);
 END IF;
 status_value:=CASE WHEN projection->>'state'='reviewed_current' THEN 201 ELSE 202 END;
 INSERT INTO public.canonical_customer_financial_billable_review_requests_v1(
  organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,review_id,response_status,
  response,response_digest,created_at) VALUES(org,actor,session_value,key_digest,request_digest_value,approval.id,
  status_value,projection,public.canonical_completion_digest(projection),approval.reviewed_at);
 RETURN jsonb_build_object('status',status_value,'body',projection,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_append_revision()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_snapshot JSONB; human_snapshot JSONB; source_row RECORD; existing_digest TEXT; existing_row RECORD;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':estimate-journey-history:'||NEW.estimate_id::text,0));
 IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM public.canonical_customer_financial_estimate_journey_revisions_v1
  WHERE organization_id=NEW.organization_id AND estimate_id=NEW.estimate_id AND revision=NEW.revision-1
   AND revision_class='human_revision') THEN
  RAISE EXCEPTION 'Estimate journey history is incomplete' USING ERRCODE='40001'; END IF;
 SELECT version.id,version.revision,rtrim(version.digest) digest,rtrim(version.document_digest) document_digest,
  version.document,version.created_at,event.id acceptance_id,rtrim(event.digest) acceptance_digest,event.created_at accepted_at
 INTO source_row FROM public.canonical_customer_estimate_versions version
 JOIN public.canonical_customer_estimate_delivery_events event ON event.organization_id=version.organization_id
  AND event.estimate_id=version.estimate_id AND event.version_id=version.id AND event.kind='accepted'
 WHERE version.organization_id=NEW.organization_id AND version.estimate_id=NEW.estimate_id
  AND rtrim(version.document_digest)=rtrim(NEW.source_proposal_digest)
  AND rtrim(version.digest)=rtrim(NEW.source_proposal_revision_digest)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_customer_estimate_delivery_events revoked
   WHERE revoked.organization_id=event.organization_id AND revoked.link_id=event.link_id AND revoked.kind='revoked')
 ORDER BY event.created_at DESC,event.id DESC LIMIT 1 FOR SHARE OF version,event;
 IF source_row.id IS NULL THEN RAISE EXCEPTION 'Mission 24 source original unavailable' USING ERRCODE='40001'; END IF;
 source_snapshot:=jsonb_build_object('contractVersion','m24-source-original-history-v1',
  'estimateId',NEW.estimate_id,'sourceVersionId',source_row.id,'sourceRevision',source_row.revision,
  'sourceProposalDigest',source_row.document_digest,'sourceProposalRevisionDigest',source_row.digest,
  'document',source_row.document,'issuedAt',source_row.created_at,
  'acceptedEvidence',jsonb_build_object('id',source_row.acceptance_id,'digest',source_row.acceptance_digest,
   'acceptedAt',source_row.accepted_at),'machineSource',TRUE,'humanRevision',FALSE);
 INSERT INTO public.canonical_customer_financial_estimate_journey_revisions_v1(
  organization_id,estimate_id,revision,revision_class,snapshot,snapshot_digest,source_proposal_digest,
  source_proposal_revision_digest,option_lineage_digest,actor_user_id,actor_access_role,reason,request_key_digest,recorded_at)
 VALUES(NEW.organization_id,NEW.estimate_id,0,'source_original',source_snapshot,
  public.canonical_completion_digest(source_snapshot),NEW.source_proposal_digest,NEW.source_proposal_revision_digest,
  public.canonical_completion_digest(COALESCE(source_row.document->'options','[]'::jsonb)),NULL,NULL,
  'Mission 24 source-owned original',NULL,source_row.created_at)
 ON CONFLICT(organization_id,estimate_id,revision) DO NOTHING;
 SELECT rtrim(snapshot_digest) INTO existing_digest FROM public.canonical_customer_financial_estimate_journey_revisions_v1
  WHERE organization_id=NEW.organization_id AND estimate_id=NEW.estimate_id AND revision=0 FOR SHARE;
 IF existing_digest<>public.canonical_completion_digest(source_snapshot) THEN
  RAISE EXCEPTION 'Source original history conflict' USING ERRCODE='40001'; END IF;
 human_snapshot:=jsonb_build_object('contractVersion','m27-polaris-human-revision-v1',
  'estimateId',NEW.estimate_id,'revision',NEW.revision,'draft',NEW.draft,
  'draftDigest',rtrim(NEW.draft_digest),'sourceDigest',rtrim(NEW.source_digest),
  'sourceRevisionDigest',rtrim(NEW.source_revision_digest),
  'sourceProposalDigest',rtrim(NEW.source_proposal_digest),
  'sourceProposalRevisionDigest',rtrim(NEW.source_proposal_revision_digest),
  'actorUserId',NEW.actor_user_id,'actorAccessRole',NEW.actor_access_role,'membershipId',NEW.membership_id,
  'capabilityGrantId',NEW.capability_grant_id,'capabilityGrantRevision',NEW.capability_grant_revision,
  'reason',NEW.reason,'recordedAt',NEW.updated_at,
  'signatureEvidence',jsonb_build_object('state','unavailable','reason','legal_review_unavailable','value',NULL),
  'acceptanceEvidence',source_snapshot->'acceptedEvidence',
  'mission32Adapter',jsonb_build_object('name','polaris.estimate_studio.adapter.v1','compatibleSchemaVersion',1,
   'mayCreateParallelEstimate',FALSE,'mayDuplicateAcceptedMath',FALSE));
 INSERT INTO public.canonical_customer_financial_estimate_journey_revisions_v1(
  organization_id,estimate_id,revision,revision_class,snapshot,snapshot_digest,source_proposal_digest,
  source_proposal_revision_digest,option_lineage_digest,actor_user_id,actor_access_role,reason,request_key_digest,recorded_at)
 VALUES(NEW.organization_id,NEW.estimate_id,NEW.revision,'human_revision',human_snapshot,
  public.canonical_completion_digest(human_snapshot),NEW.source_proposal_digest,NEW.source_proposal_revision_digest,
  public.canonical_completion_digest(NEW.draft->'options'),NEW.actor_user_id,NEW.actor_access_role,NEW.reason,NULL,NEW.updated_at)
 ON CONFLICT(organization_id,estimate_id,revision) DO NOTHING;
 SELECT * INTO existing_row FROM public.canonical_customer_financial_estimate_journey_revisions_v1
  WHERE organization_id=NEW.organization_id AND estimate_id=NEW.estimate_id AND revision=NEW.revision FOR SHARE;
 IF existing_row.snapshot_digest IS NULL OR existing_row.revision_class<>'human_revision' OR
  existing_row.actor_user_id<>NEW.actor_user_id OR existing_row.reason<>NEW.reason OR
  existing_row.snapshot->>'draftDigest'<>rtrim(NEW.draft_digest) OR
  rtrim(existing_row.source_proposal_digest)<>rtrim(NEW.source_proposal_digest) OR
  rtrim(existing_row.source_proposal_revision_digest)<>rtrim(NEW.source_proposal_revision_digest) THEN
  RAISE EXCEPTION 'Human revision history conflict' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END $$;

-- Backfill the complete accepted save history from immutable request receipts.
INSERT INTO public.canonical_customer_financial_estimate_journey_revisions_v1(
 organization_id,estimate_id,revision,revision_class,snapshot,snapshot_digest,source_proposal_digest,
 source_proposal_revision_digest,option_lineage_digest,actor_user_id,actor_access_role,reason,request_key_digest,recorded_at)
SELECT request.organization_id,(request.response#>>'{draft,estimateId}')::uuid,
 (request.response#>>'{draft,revision}')::bigint,'human_revision',snapshot.value,
 public.canonical_completion_digest(snapshot.value),request.response#>>'{draft,sourceProposalDigest}',
 request.response#>>'{draft,sourceProposalRevisionDigest}',
 public.canonical_completion_digest(request.response#>'{draft,options}'),request.actor_user_id,NULL,
 request.response#>>'{draft,reason}',request.request_key_digest,
 (request.response#>>'{draft,updatedAt}')::timestamptz
FROM public.canonical_customer_financial_estimate_journey_requests_v1 request
CROSS JOIN LATERAL (SELECT jsonb_build_object('contractVersion','m27-polaris-human-revision-v1',
 'estimateId',request.response#>>'{draft,estimateId}','revision',(request.response#>>'{draft,revision}')::bigint,
 'draft',(request.response->'draft')-'revision'-'updatedAt'-'reason',
 'draftDigest',request.response#>>'{draft,draftDigest}','sourceDigest',request.response#>>'{draft,sourceDigest}',
 'sourceRevisionDigest',request.response#>>'{draft,sourceRevisionDigest}',
 'sourceProposalDigest',request.response#>>'{draft,sourceProposalDigest}',
 'sourceProposalRevisionDigest',request.response#>>'{draft,sourceProposalRevisionDigest}',
 'actorUserId',request.actor_user_id,'actorAccessRole',NULL,'membershipId',NULL,
 'capabilityGrantId',NULL,'capabilityGrantRevision',NULL,'reason',request.response#>>'{draft,reason}',
 'recordedAt',request.response#>>'{draft,updatedAt}',
 'signatureEvidence',jsonb_build_object('state','unavailable','reason','legal_review_unavailable','value',NULL),
 'acceptanceEvidence',NULL,
 'mission32Adapter',jsonb_build_object('name','polaris.estimate_studio.adapter.v1','compatibleSchemaVersion',1,
  'mayCreateParallelEstimate',FALSE,'mayDuplicateAcceptedMath',FALSE)) value) snapshot
WHERE request.response#>>'{draft,revision}' IS NOT NULL
ORDER BY request.organization_id,(request.response#>>'{draft,estimateId}')::uuid,
 (request.response#>>'{draft,revision}')::bigint
ON CONFLICT(organization_id,estimate_id,revision) DO NOTHING;

CREATE TRIGGER canonical_customer_financial_estimate_journey_drafts_v1_append_revision
 AFTER INSERT OR UPDATE ON public.canonical_customer_financial_estimate_journey_drafts_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_estimate_journey_v1_append_revision();

-- Fire the append-only trigger once for every pre-267 current row.  This is a
-- no-op update to the mutable current projection; it creates only missing
-- immutable source originals/current human revisions and validates conflicts.
UPDATE public.canonical_customer_financial_estimate_journey_drafts_v1 SET updated_at=updated_at;

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_history(
 org UUID,estimate_value UUID,current_draft JSONB,current_source JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_row RECORD; entries JSONB; human_count INTEGER; current_revision BIGINT; history_digest TEXT;
 option_ids JSONB; line_ids JSONB; assumption_ids JSONB;
BEGIN
 IF current_draft IS NULL OR current_source IS NULL THEN RETURN NULL; END IF;
 current_revision:=(current_draft->>'revision')::bigint;
 SELECT * INTO source_row FROM public.canonical_customer_financial_estimate_journey_revisions_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND revision=0 AND revision_class='source_original';
 SELECT count(*)::int,jsonb_agg(jsonb_build_object('revision',revision,'revisionClass',revision_class,
  'snapshotDigest',rtrim(snapshot_digest),'actorUserId',actor_user_id,'actorAccessRole',actor_access_role,
  'reason',reason,'recordedAt',public.canonical_customer_financial_billing_identity_v1_utc(recorded_at),
  'optionLineageDigest',rtrim(option_lineage_digest),'snapshot',snapshot) ORDER BY revision)
 INTO human_count,entries FROM public.canonical_customer_financial_estimate_journey_revisions_v1
 WHERE organization_id=org AND estimate_id=estimate_value AND revision_class='human_revision';
 IF source_row.estimate_id IS NULL OR rtrim(source_row.source_proposal_digest)<>current_source->>'sourceProposalDigest' OR
  rtrim(source_row.source_proposal_revision_digest)<>current_source->>'sourceProposalRevisionDigest' OR
  human_count<>current_revision OR EXISTS(SELECT 1 FROM generate_series(1,current_revision) expected
   WHERE NOT EXISTS(SELECT 1 FROM public.canonical_customer_financial_estimate_journey_revisions_v1 actual
    WHERE actual.organization_id=org AND actual.estimate_id=estimate_value AND actual.revision=expected
     AND actual.revision_class='human_revision')) OR
  (entries->-1->'snapshot'->>'draftDigest') IS DISTINCT FROM current_draft->>'draftDigest' THEN RETURN NULL; END IF;
 history_digest:=public.canonical_completion_digest(jsonb_build_object(
  'sourceOriginalDigest',rtrim(source_row.snapshot_digest),'humanRevisions',entries));
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',option->>'id','digest',option->>'optionDigest') ORDER BY option->>'id'),'[]'::jsonb)
 INTO option_ids FROM jsonb_array_elements(current_draft->'options') option;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('optionId',option->>'id','lineId',line->>'id') ORDER BY option->>'id',line->>'id'),'[]'::jsonb)
 INTO line_ids FROM jsonb_array_elements(current_draft->'options') option
 CROSS JOIN LATERAL jsonb_array_elements(option->'lines') line;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('optionId',option->>'id','ordinal',assumption->>'ordinal',
  'digest',public.canonical_completion_digest(assumption)) ORDER BY option->>'id',(assumption->>'ordinal')::int),'[]'::jsonb)
 INTO assumption_ids FROM jsonb_array_elements(current_draft->'options') option
 CROSS JOIN LATERAL jsonb_array_elements(option->'assumptions') assumption;
 RETURN jsonb_build_object('contractVersion','m27-polaris-revision-history-v1','state','current',
  'sourceOriginal',jsonb_build_object('revision',0,'snapshotDigest',rtrim(source_row.snapshot_digest),
   'recordedAt',public.canonical_customer_financial_billing_identity_v1_utc(source_row.recorded_at),
   'sourceProposalDigest',rtrim(source_row.source_proposal_digest),
   'sourceProposalRevisionDigest',rtrim(source_row.source_proposal_revision_digest),'snapshot',source_row.snapshot),
  'humanRevisions',entries,'currentRevision',current_revision,'historyDigest',history_digest,
  'signatureEvidence',jsonb_build_object('state','unavailable','reason','legal_review_unavailable','value',NULL),
  'mission25Observation',jsonb_build_object('adapter','mission25.tenant_edit_observation.v1',
   'state','unavailable','reason','learning_permission_unavailable','value',NULL,
   'automaticApplication',FALSE,'published',FALSE,'excludedInputs',jsonb_build_array(
    'raw_photo','raw_transcript','signature_artifact','customer_contact','payment_data','other_tenant_data')),
  'mission32Adapter',jsonb_build_object('name','polaris.estimate_studio.adapter.v1','compatibleSchemaVersion',1,
   'state','compatible_contract','estimateId',estimate_value,'revision',current_revision,
   'draftDigest',current_draft->>'draftDigest','historyDigest',history_digest,
   'optionIdentities',option_ids,'lineIdentities',line_ids,'assumptionIdentities',assumption_ids,
   'mayCreateParallelEstimate',FALSE,'mayDuplicateAcceptedMath',FALSE,'mayApproveCommercialDecision',FALSE,
   'receiverExecutionAvailable',FALSE,'receiverMutationCount',0),
  'providerCallCount',0,'receiverMutationCount',0,'learningWriteCount',0);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_customer_financial_estimate_journey_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE draft_row RECORD; capability_rows JSONB; actor_authority JSONB; source_proposal JSONB;
 draft_value JSONB; history_value JSONB;
BEGIN
 actor_authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN('owner','admin','member') OR NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Estimate journey restricted' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_customer_financial_estimate_journey_grants_v1 grant_entry
  JOIN public.canonical_customer_financial_estimate_journey_grant_heads_v1 head
   ON head.organization_id=grant_entry.organization_id AND head.capability_grant_id=grant_entry.id
   AND head.latest_revision=grant_entry.revision
  WHERE grant_entry.organization_id=org AND grant_entry.actor_user_id=actor
   AND grant_entry.membership_id=(actor_authority->>'membershipId')::uuid
   AND grant_entry.estimate_id=estimate_value AND grant_entry.active=TRUE
   AND grant_entry.valid_from<=clock_timestamp() AND grant_entry.expires_at>clock_timestamp()
  GROUP BY grant_entry.capability HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Estimate journey capability scope is ambiguous' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_object_agg(grant_entry.capability,jsonb_build_object(
  'grantId',grant_entry.id,'revision',grant_entry.revision,
  'businessPurpose',grant_entry.business_purpose,'policyVersion',grant_entry.policy_version)), '{}'::jsonb)
 INTO capability_rows FROM public.canonical_customer_financial_estimate_journey_grants_v1 grant_entry
 JOIN public.canonical_customer_financial_estimate_journey_grant_heads_v1 head
  ON head.organization_id=grant_entry.organization_id AND head.capability_grant_id=grant_entry.id
  AND head.latest_revision=grant_entry.revision
 WHERE grant_entry.organization_id=org AND grant_entry.actor_user_id=actor
  AND grant_entry.membership_id=(actor_authority->>'membershipId')::uuid
  AND grant_entry.estimate_id=estimate_value AND grant_entry.active=TRUE
  AND grant_entry.valid_from<=clock_timestamp() AND grant_entry.expires_at>clock_timestamp()
  AND grant_entry.target_class='canonical_estimate' AND grant_entry.policy_version='mission27.launch.v1'
  AND rtrim(grant_entry.policy_digest)='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'
  AND grant_entry.template_version=CASE role_value WHEN 'owner' THEN 'm27.owner.v1'
    WHEN 'admin' THEN 'm27.admin.v1' ELSE 'm27.member.granted.v1' END
  AND (role_value<>'member' OR grant_entry.capability IN(
    'customer_financial.estimate.edit_draft','customer_financial.estimate.edit_options'))
  AND grant_entry.business_purpose=CASE grant_entry.capability
   WHEN 'customer_financial.estimate.edit_draft' THEN 'customer_financial.polaris_quote_draft'
   WHEN 'customer_financial.estimate.edit_options' THEN 'customer_financial.polaris_quote_options'
   WHEN 'customer_financial.estimate.request_signature' THEN 'customer_financial.polaris_quote_signature_request'
   WHEN 'customer_financial.estimate.review_signature' THEN 'customer_financial.polaris_quote_signature_review'
   WHEN 'customer_financial.estimate.request_work_handoff' THEN 'customer_financial.polaris_quote_work_handoff' END
  AND grant_entry.action_mode=CASE WHEN grant_entry.capability IN(
   'customer_financial.estimate.request_signature','customer_financial.estimate.request_work_handoff')
   THEN 'conditional_dual_control' ELSE 'single_control' END
  AND grant_entry.assurance=CASE WHEN grant_entry.capability IN(
   'customer_financial.estimate.edit_draft','customer_financial.estimate.edit_options')
   THEN 'current_session' ELSE 'recent_auth' END;
 source_proposal:=public.canonical_customer_financial_estimate_journey_v1_source_proposal(
  org,actor,role_value,session_value,estimate_value);
 SELECT * INTO draft_row FROM public.canonical_customer_financial_estimate_journey_drafts_v1
  WHERE organization_id=org AND estimate_id=estimate_value FOR SHARE;
 IF draft_row.estimate_id IS NULL THEN RETURN jsonb_build_object('state','current','draft',NULL,
  'sourceProposal',source_proposal,'capabilities',capability_rows,
  'revisionHistory',NULL,'providerCallCount',0,'receiverMutationCount',0); END IF;
 IF source_proposal IS NULL OR rtrim(draft_row.source_proposal_digest)<>source_proposal->>'sourceProposalDigest' OR
  rtrim(draft_row.source_proposal_revision_digest)<>source_proposal->>'sourceProposalRevisionDigest' THEN
  RETURN jsonb_build_object('state','source_currentness_unavailable','draft',NULL,
   'sourceProposal',NULL,'capabilities','{}'::jsonb,'revisionHistory',NULL,'mission32Adapter',NULL,
   'mission25Observation',NULL,'value',NULL,'providerCallCount',0,'receiverMutationCount',0); END IF;
 draft_value:=draft_row.draft||jsonb_build_object(
  'revision',draft_row.revision,'updatedAt',draft_row.updated_at,'reason',draft_row.reason);
 history_value:=public.canonical_customer_financial_estimate_journey_v1_history(
  org,estimate_value,draft_value,source_proposal);
 IF history_value IS NULL THEN RETURN jsonb_build_object('state','revision_history_unavailable','draft',NULL,
  'sourceProposal',NULL,'capabilities','{}'::jsonb,'revisionHistory',NULL,'value',NULL,
  'providerCallCount',0,'receiverMutationCount',0); END IF;
 RETURN jsonb_build_object('state','current','draft',draft_value,
  'sourceProposal',source_proposal,'capabilities',capability_rows,'revisionHistory',history_value,
  'mission25Observation',history_value->'mission25Observation','mission32Adapter',history_value->'mission32Adapter',
  'signature',jsonb_build_object('state','unavailable','reason','legal_review_unavailable','value',NULL,
   'missingEvidence',jsonb_build_array('mission24.current_source_proposal_digest',
    'mission24.reviewed_recipient','professional_review.legal')),
  'workHandoff',jsonb_build_object('state','unavailable','reason','work_handoff_receiver_unavailable','value',NULL),
  'providerCallCount',0,'receiverMutationCount',0);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_billable_handoff_receipts_v1,
 public.canonical_customer_financial_estimate_journey_revisions_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billable_review_v1_ensure_handoff_receipt(UUID,UUID,TEXT),
 public.canonical_customer_financial_estimate_journey_v1_append_revision(),
 public.canonical_customer_financial_estimate_journey_v1_history(UUID,UUID,JSONB,JSONB) FROM PUBLIC;
