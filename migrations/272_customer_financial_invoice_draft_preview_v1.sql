-- Mission 27 Part 4E: exact-current invoice-draft totals and read-only preview.
-- This projection performs no approval, issue, receivable, payment, provider,
-- receiver, accounting, communication or other downstream effect.

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
 public.canonical_customer_financial_invoice_draft_preview_v1_unavailable(TEXT),
 public.canonical_customer_financial_invoice_draft_preview_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_preview_v1_read(
  UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) TO northstar_app_runtime;
END IF; END $grant$;
