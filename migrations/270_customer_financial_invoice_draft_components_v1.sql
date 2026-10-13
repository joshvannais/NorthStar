-- Mission 27 Part 4C: exact-current Mission 24 commercial authority and
-- separately typed financial components over one current Part 4B draft.
-- This slice creates no price, payment, credit, refund, tax, invoice,
-- receivable, provider or downstream effect.

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_components_v1_unavailable(reason_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'contractVersion','m27-invoice-draft-components-v1','state','unavailable','reason',reason_value,
 'value',NULL,'sourceCurrent',FALSE,'commercialSourceAuthorityCurrent',FALSE,
 'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,'issueAuthorized',FALSE,
 'providerCallCount',0,'receiverMutationCount',0) $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_components_v1_missing(
 component_type_value TEXT,reason_value TEXT,arithmetic_role_value TEXT,missing_evidence_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'componentType',component_type_value,'state','unavailable','reason',reason_value,'value',NULL,
 'provenance',NULL,'arithmeticRole',arithmetic_role_value,
 'missingEvidence',jsonb_build_array(missing_evidence_value)) $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_components_v1_unsupported(
 component_type_value TEXT,reason_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'componentType',component_type_value,'state','unsupported','reason',reason_value,'value',NULL,
 'provenance',NULL,'arithmeticRole','none') $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_components_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; draft_value JSONB;
 saved public.canonical_customer_financial_invoice_draft_origins_v1%ROWTYPE;
 mission24_value JSONB; base_value JSONB; coverage_value JSONB; unsupported_value JSONB;
BEGIN
 authority:=public.canonical_customer_financial_invoice_draft_v1_access(
  org,actor,role_value,session_value,NULL,estimate_value,NULL,NULL,FALSE);
 draft_value:=public.canonical_customer_financial_invoice_draft_revision_v1_current(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF draft_value->>'state'<>'current' THEN
  RETURN public.canonical_customer_financial_invoice_draft_components_v1_unavailable(
   COALESCE(draft_value->>'reason','invoice_draft_currentness_unavailable'));
 END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_draft_origins_v1
  WHERE organization_id=org AND id=(draft_value->>'originId')::uuid
   AND estimate_id=estimate_value AND handoff_receipt_id=receipt_value
   AND rtrim(handoff_receipt_digest)=receipt_digest_value FOR SHARE;
 IF saved.id IS NULL OR rtrim(saved.origin_digest)<>draft_value->>'originDigest' OR
  rtrim(saved.candidate_digest)<>draft_value->>'candidateDigest' THEN
  RETURN public.canonical_customer_financial_invoice_draft_components_v1_unavailable(
   'invoice_draft_origin_stale');
 END IF;
 mission24_value:=saved.origin->'mission24Source';
 IF jsonb_typeof(mission24_value)<>'object' OR
  COALESCE(mission24_value->>'issuedVersionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(mission24_value->>'issuedDigest','')!~'^[0-9a-f]{64}$' OR
  COALESCE(mission24_value->>'documentDigest','')!~'^[0-9a-f]{64}$' OR
  COALESCE(mission24_value->>'commercialApprovalId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(mission24_value->>'commercialApprovalDigest','')!~'^[0-9a-f]{64}$' OR
  COALESCE(mission24_value->>'acceptanceId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(mission24_value->>'acceptanceDigest','')!~'^[0-9a-f]{64}$' OR
  (mission24_value->>'issuedRevision')!~'^[1-9][0-9]{0,15}$' THEN
  RETURN public.canonical_customer_financial_invoice_draft_components_v1_unavailable(
   'mission24_commercial_authority_unavailable');
 END IF;
 coverage_value:=jsonb_build_array(
  public.canonical_customer_financial_invoice_draft_components_v1_missing(
   'deposit_application','deposit_payment_evidence_unavailable','amount_due_subtraction_once',
   'mission27.native_deposit_payment_receipt'),
  public.canonical_customer_financial_invoice_draft_components_v1_missing(
   'prior_payment','prior_payment_evidence_unavailable','amount_due_subtraction_once',
   'mission27.native_prior_payment_receipt'),
  public.canonical_customer_financial_invoice_draft_components_v1_missing(
   'credit_note','credit_note_unavailable','document_balance_adjustment_once',
   'mission27.native_credit_note'),
  public.canonical_customer_financial_invoice_draft_components_v1_missing(
   'refund','refund_unavailable','settled_payment_reversal_once',
   'mission27.native_refund_receipt'),
  public.canonical_customer_financial_invoice_draft_components_v1_missing(
   'tax_adjustment','tax_authority_unavailable','tax_liability_adjustment_once',
   'mission27.invoice_date_tax_review'));
 unsupported_value:=jsonb_build_array(
  public.canonical_customer_financial_invoice_draft_components_v1_unsupported(
   'retainage','retainage_unsupported'),
  public.canonical_customer_financial_invoice_draft_components_v1_unsupported(
   'milestone','milestone_authority_unavailable'),
  public.canonical_customer_financial_invoice_draft_components_v1_unsupported(
   'tip','tip_unsupported'),
  public.canonical_customer_financial_invoice_draft_components_v1_unsupported(
   'surcharge','surcharge_unsupported'),
  public.canonical_customer_financial_invoice_draft_components_v1_unsupported(
   'financing','financing_unsupported'),
  public.canonical_customer_financial_invoice_draft_components_v1_unsupported(
   'recurring','recurring_billing_unsupported'));
 base_value:=jsonb_build_object(
  'contractVersion','m27-invoice-draft-components-v1','state','current',
  'invoiceDraft',jsonb_build_object('originId',saved.id,'originDigest',rtrim(saved.origin_digest),
   'revision',(draft_value->>'revision')::bigint,'draftDigest',draft_value->>'draftDigest',
   'historyChainDigest',draft_value->>'historyChainDigest','currency','USD',
   'subtotalBeforeTax',draft_value->'subtotalBeforeTax'),
  'commercialRevision',jsonb_build_object(
   'authorityClass','mission24.current_accepted_commercial_revision',
   'issuedVersionId',mission24_value->>'issuedVersionId',
   'issuedRevision',(mission24_value->>'issuedRevision')::bigint,
   'issuedDigest',mission24_value->>'issuedDigest','documentDigest',mission24_value->>'documentDigest',
   'commercialApprovalId',mission24_value->>'commercialApprovalId',
   'commercialApprovalDigest',mission24_value->>'commercialApprovalDigest',
   'customerAcceptance',jsonb_build_object('state','accepted_current',
    'acceptanceId',mission24_value->>'acceptanceId',
    'acceptanceDigest',mission24_value->>'acceptanceDigest'),
   'amountChangingFeesDiscountsOrScopeRequireNewAcceptedMission24Revision',TRUE,
   'mission27CommercialAmountOverrideAuthorized',FALSE),
  'financialComponents',coverage_value,'unsupportedShapes',unsupported_value,
  'reconciliation',jsonb_build_object('version','m27-invoice-component-reconciliation-v1',
   'commercialSubtotalSource','exact_current_invoice_draft_only',
   'subtotalBeforeTax',draft_value->'subtotalBeforeTax',
   'separateComponentsAffectCommercialSubtotal',FALSE,
   'depositScheduleIsPaymentReceipt',FALSE,'componentIdentityAndProvenanceRequired',TRUE,
   'duplicateComponentEffectAllowed',FALSE,
   'componentEffect',jsonb_build_object('state','unavailable',
    'reason','financial_component_evidence_unavailable','value',NULL),
   'amountDue',jsonb_build_object('state','unavailable',
    'reason','invoice_reconciliation_not_yet_authorized','value',NULL)),
  'sourceCurrent',TRUE,'commercialSourceAuthorityCurrent',TRUE,
  'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,'issueAuthorized',FALSE,
  'providerCallCount',0,'receiverMutationCount',0);
 RETURN base_value||jsonb_build_object('componentsDigest',public.canonical_completion_digest(base_value));
END $$;

REVOKE ALL ON FUNCTION
 public.canonical_customer_financial_invoice_draft_components_v1_unavailable(TEXT),
 public.canonical_customer_financial_invoice_draft_components_v1_missing(TEXT,TEXT,TEXT,TEXT),
 public.canonical_customer_financial_invoice_draft_components_v1_unsupported(TEXT,TEXT),
 public.canonical_customer_financial_invoice_draft_components_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT)
 FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_components_v1_read(
  UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) TO northstar_app_runtime;
END IF; END $grant$;
