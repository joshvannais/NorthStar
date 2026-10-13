-- Mission 27 Part 4E: exact-current invoice-draft totals and read-only preview.
-- This projection performs no approval, issue, receivable, payment, provider,
-- receiver, accounting, communication or other downstream effect.

-- The released launch policy makes invoice-draft editing a default owner/admin
-- capability, but Parts 4A-4D deliberately exposed no browser issuance path.
-- This guarded bootstrap validates the real current actor, paid entitlement and
-- reviewed Part 3 final-balance receipt before returning or issuing exactly one
-- short-lived grant.  It does not capture an origin or change a draft/tax state.
CREATE FUNCTION public.canonical_customer_financial_invoice_draft_workflow_v1_grant(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf_value TEXT,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_authority JSONB; billable_value JSONB;
 selected_grant public.canonical_customer_financial_invoice_draft_grants_v1%ROWTYPE;
 candidate_grant public.canonical_customer_financial_invoice_draft_grants_v1%ROWTYPE;
 candidate_count INTEGER:=0; created_id UUID;
BEGIN
 IF role_value NOT IN('owner','admin') OR csrf_value IS NULL OR octet_length(csrf_value)<16 THEN
  RAISE EXCEPTION 'Invoice-draft workflow capability restricted' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':invoice-draft-grant-scope:'||actor::text||':'||estimate_value::text,0));
 actor_authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf_value,TRUE);
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Current invoice-draft entitlement unavailable' USING ERRCODE='42501'; END IF;
 billable_value:=public.canonical_customer_financial_billable_review_v1_read(
  org,actor,role_value,session_value,estimate_value,'final_balance');
 IF billable_value->>'state'<>'reviewed_current' OR
    COALESCE((billable_value->>'sourceCurrent')::boolean,FALSE) IS NOT TRUE OR
    billable_value#>>'{handoffReceipt,receiptId}' IS NULL OR
    billable_value#>>'{handoffReceipt,receiptDigest}'!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Current reviewed invoice-draft handoff unavailable' USING ERRCODE='40001'; END IF;
 FOR candidate_grant IN SELECT grant_row.*
  FROM public.canonical_customer_financial_invoice_draft_grants_v1 grant_row
  JOIN public.canonical_customer_financial_invoice_draft_grant_heads_v1 head
   ON head.organization_id=grant_row.organization_id AND head.grant_id=grant_row.id
   AND head.latest_revision=grant_row.revision
  WHERE grant_row.organization_id=org AND grant_row.actor_user_id=actor
   AND grant_row.membership_id=(actor_authority->>'membershipId')::uuid
   AND grant_row.estimate_id=estimate_value
   AND grant_row.capability='customer_financial.invoice.edit_draft'
   AND grant_row.target_class='canonical_estimate'
   AND grant_row.business_purpose='customer_financial.invoice_draft'
   AND grant_row.policy_version='mission27.launch.v1'
   AND rtrim(grant_row.policy_digest)='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'
   AND grant_row.template_version=CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END
   AND grant_row.action_mode='single_control' AND grant_row.assurance='current_session'
   AND grant_row.active AND grant_row.valid_from<=clock_timestamp()
   AND grant_row.expires_at>clock_timestamp()
  ORDER BY grant_row.id FOR SHARE OF grant_row,head
 LOOP candidate_count:=candidate_count+1; selected_grant:=candidate_grant; END LOOP;
 IF candidate_count>1 THEN
  RAISE EXCEPTION 'Ambiguous current invoice-draft capability' USING ERRCODE='40001'; END IF;
 IF candidate_count=0 THEN
  created_id:=gen_random_uuid();
  PERFORM public.canonical_customer_financial_invoice_draft_v1_issue_grant(
   org,created_id,1,actor,(actor_authority->>'membershipId')::uuid,estimate_value,
   'customer_financial.invoice.edit_draft','canonical_estimate','customer_financial.invoice_draft',
   'mission27.launch.v1','d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a',
   CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END,
   'single_control','current_session',TRUE);
  SELECT * INTO selected_grant FROM public.canonical_customer_financial_invoice_draft_grants_v1
   WHERE organization_id=org AND id=created_id AND revision=1;
 END IF;
 RETURN jsonb_build_object('contractVersion','m27-invoice-draft-workflow-capability-v1',
  'state','current','capability','customer_financial.invoice.edit_draft',
  'grantId',selected_grant.id,'revision',selected_grant.revision,
  'businessPurpose','customer_financial.invoice_draft','policyVersion','mission27.launch.v1',
  'estimateId',estimate_value,'sourceCurrent',TRUE,'invoiceAuthorized',FALSE,
  'providerCallCount',0,'receiverMutationCount',0);
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_preview_v1_unavailable(reason_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'contractVersion','m27-invoice-draft-preview-v1','state','unavailable','mode','paid','fictional',FALSE,
 'reason',reason_value,'value',NULL,'sourceCurrent',FALSE,'commercialSourceAuthorityCurrent',FALSE,
 'taxAuthorityCurrent',FALSE,'amountDueCurrent',FALSE,'invoiceAuthorized',FALSE,
 'receivableAuthorized',FALSE,'issueAuthorized',FALSE,'providerCallCount',0,'receiverMutationCount',0) $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_preview_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE components_value JSONB; tax_value JSONB; draft_value JSONB; preparation_value JSONB;
 draft_identity JSONB; lines_value JSONB; line_value JSONB; tax_line JSONB;
 subtotal_minor BIGINT; tax_minor BIGINT; prepared_total_minor BIGINT;
 component_gaps JSONB; reconciliation_value JSONB; preview_value JSONB; base_value JSONB;
BEGIN
 components_value:=public.canonical_customer_financial_invoice_draft_components_v1_read(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF components_value->>'state'<>'current' THEN RETURN public.canonical_customer_financial_invoice_draft_preview_v1_unavailable(
  COALESCE(components_value->>'reason','invoice_component_evidence_unavailable')); END IF;
 tax_value:=public.canonical_customer_financial_invoice_tax_review_v1_read(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF tax_value->>'state' NOT IN ('ready_to_record','recorded_policy_unavailable') THEN
  RETURN public.canonical_customer_financial_invoice_draft_preview_v1_unavailable(
   COALESCE(tax_value->>'reason','invoice_tax_preparation_unavailable')); END IF;
 draft_value:=public.canonical_customer_financial_invoice_draft_revision_v1_current(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF draft_value->>'state'<>'current' THEN RETURN public.canonical_customer_financial_invoice_draft_preview_v1_unavailable(
  COALESCE(draft_value->>'reason','invoice_draft_currentness_unavailable')); END IF;
 preparation_value:=tax_value->'preparation';
 IF components_value#>>'{invoiceDraft,originId}'<>draft_value->>'originId' OR
    components_value#>>'{invoiceDraft,originDigest}'<>draft_value->>'originDigest' OR
    (components_value#>>'{invoiceDraft,revision}')::bigint<>(draft_value->>'revision')::bigint OR
    components_value#>>'{invoiceDraft,draftDigest}'<>draft_value->>'draftDigest' OR
    components_value#>>'{invoiceDraft,historyChainDigest}'<>draft_value->>'historyChainDigest' OR
    preparation_value#>>'{invoiceDraft,originId}'<>draft_value->>'originId' OR
    preparation_value#>>'{invoiceDraft,originDigest}'<>draft_value->>'originDigest' OR
    (preparation_value#>>'{invoiceDraft,revision}')::bigint<>(draft_value->>'revision')::bigint OR
    preparation_value#>>'{invoiceDraft,draftDigest}'<>draft_value->>'draftDigest' OR
    preparation_value#>>'{invoiceDraft,historyChainDigest}'<>draft_value->>'historyChainDigest' OR
    components_value->>'componentsDigest'!~'^[0-9a-f]{64}$' OR tax_value->>'preparationDigest'!~'^[0-9a-f]{64}$' THEN
  RETURN public.canonical_customer_financial_invoice_draft_preview_v1_unavailable('invoice_preview_source_conflict'); END IF;
 subtotal_minor:=(draft_value#>>'{subtotalBeforeTax,minorUnits}')::bigint;
 IF subtotal_minor<>(components_value#>>'{reconciliation,subtotalBeforeTax,minorUnits}')::bigint OR
    subtotal_minor<>(preparation_value#>>'{invoiceDraft,subtotalBeforeTax,minorUnits}')::bigint THEN
  RETURN public.canonical_customer_financial_invoice_draft_preview_v1_unavailable('invoice_preview_total_conflict'); END IF;
 tax_minor:=(preparation_value#>>'{collectedTaxLiability,amount,minorUnits}')::bigint;
 prepared_total_minor:=subtotal_minor+tax_minor;
 IF jsonb_array_length(draft_value->'lines')<>jsonb_array_length(preparation_value->'lines') THEN
  RETURN public.canonical_customer_financial_invoice_draft_preview_v1_unavailable('invoice_preview_line_conflict'); END IF;
 lines_value:='[]'::jsonb;
 FOR line_value IN SELECT value FROM jsonb_array_elements(draft_value->'lines') LOOP
  tax_line:=preparation_value->'lines'->((line_value->>'ordinal')::integer);
  IF tax_line IS NULL OR tax_line->>'ordinal'<>line_value->>'ordinal' OR
     tax_line->>'invoiceSourceLineDigest'<>line_value->>'sourceLineDigest' THEN
   RETURN public.canonical_customer_financial_invoice_draft_preview_v1_unavailable('invoice_preview_line_conflict'); END IF;
  lines_value:=lines_value||jsonb_build_array(jsonb_build_object(
   'ordinal',(line_value->>'ordinal')::integer,'sourceLineDigest',line_value->>'sourceLineDigest',
   'group',line_value->>'group','description',line_value->>'description','quantity',line_value->'quantity',
   'amount',line_value->'allocatedAmount','tax',tax_line->'collectedTax',
   'taxTreatment',tax_line->>'treatment','inclusiveExclusive',tax_line->>'inclusiveExclusive'));
 END LOOP;
 component_gaps:=jsonb_build_array(
  jsonb_build_object('source','professional_tax_policy_review','state','unavailable','reason','tax_authority_unavailable'),
  jsonb_build_object('source','mission27.native_deposit_payment_receipt','state','unavailable','reason','deposit_payment_evidence_unavailable'),
  jsonb_build_object('source','mission27.native_prior_payment_receipt','state','unavailable','reason','prior_payment_evidence_unavailable'),
  jsonb_build_object('source','mission27.native_credit_note','state','unavailable','reason','credit_note_unavailable'),
  jsonb_build_object('source','mission27.native_refund_receipt','state','unavailable','reason','refund_unavailable'),
  jsonb_build_object('source','mission27.invoice_date_tax_review','state','unavailable','reason','tax_authority_unavailable'));
 draft_identity:=jsonb_build_object('estimateId',estimate_value,'originId',draft_value->>'originId',
  'originDigest',draft_value->>'originDigest','revision',(draft_value->>'revision')::bigint,
  'draftDigest',draft_value->>'draftDigest','historyChainDigest',draft_value->>'historyChainDigest',
  'componentsDigest',components_value->>'componentsDigest','preparationDigest',tax_value->>'preparationDigest');
 reconciliation_value:=jsonb_build_object('version','m27-invoice-draft-total-reconciliation-v1',
  'subtotalBeforeTax',draft_value->'subtotalBeforeTax','preparedTax',preparation_value#>'{collectedTaxLiability,amount}',
  'preparedDocumentTotal',jsonb_build_object('state','preparation_only',
   'reason','professional_tax_policy_unavailable','value',
    public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(prepared_total_minor)),
  'amountDue',jsonb_build_object('state','unavailable','reason','invoice_reconciliation_evidence_unavailable',
   'value',NULL,'missingEvidence',component_gaps),
  'zeroRequiresExplicitSupportedArithmetic',TRUE,'missingEvidenceTreatedAsZero',FALSE,'browserArithmeticUsed',FALSE);
 preview_value:=jsonb_build_object('version','m27-invoice-draft-document-preview-v1',
  'state','review_required','fictional',FALSE,'label','Invoice draft — not issued','lines',lines_value,
  'reconciliation',reconciliation_value,
  'pdf',jsonb_build_object('state','unavailable','reason','immutable_invoice_document_not_yet_authorized','value',NULL),
  'customerFacingDocumentAuthorized',FALSE,'issuedDocument',FALSE);
 base_value:=jsonb_build_object('contractVersion','m27-invoice-draft-preview-v1','state','current',
  'mode','paid','fictional',FALSE,'draftIdentity',draft_identity,'documentPreview',preview_value,
  'reconciliation',reconciliation_value,
  'professionalTaxPolicy',jsonb_build_object('state','unavailable','reason','tax_authority_unavailable','value',NULL),
  'sourceCurrent',TRUE,'commercialSourceAuthorityCurrent',TRUE,'taxAuthorityCurrent',FALSE,
  'amountDueCurrent',FALSE,'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,
  'issueAuthorized',FALSE,'providerCallCount',0,'receiverMutationCount',0);
 RETURN base_value||jsonb_build_object('previewDigest',public.canonical_completion_digest(base_value));
END $$;

REVOKE ALL ON FUNCTION
 public.canonical_customer_financial_invoice_draft_workflow_v1_grant(UUID,UUID,TEXT,UUID,TEXT,UUID),
 public.canonical_customer_financial_invoice_draft_preview_v1_unavailable(TEXT),
 public.canonical_customer_financial_invoice_draft_preview_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_workflow_v1_grant(
  UUID,UUID,TEXT,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_preview_v1_read(
  UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) TO northstar_app_runtime;
END IF; END $grant$;
