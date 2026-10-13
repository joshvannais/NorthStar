-- Mission 27 Part 4D: immutable invoice-date review of one exact-current
-- Mission 24 tax preparation.  This is evidence capture only: the frozen
-- professional tax policy is not accepted, so no tax-bearing invoice,
-- liability filing, amount due, invoice, receivable, provider or receiver
-- action is authorized here.

CREATE TABLE public.canonical_customer_financial_invoice_tax_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 estimate_id UUID NOT NULL,
 origin_id UUID NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 10000),
 draft_revision BIGINT NOT NULL CHECK(draft_revision BETWEEN 0 AND 10000),
 draft_digest CHAR(64) NOT NULL CHECK(draft_digest~'^[0-9a-f]{64}$'),
 history_chain_digest CHAR(64) NOT NULL CHECK(history_chain_digest~'^[0-9a-f]{64}$'),
 billing_review_id UUID NOT NULL,
 billing_review_digest CHAR(64) NOT NULL CHECK(billing_review_digest~'^[0-9a-f]{64}$'),
 mission24_terms_id UUID NOT NULL,
 mission24_terms_revision BIGINT NOT NULL CHECK(mission24_terms_revision BETWEEN 1 AND 10000),
 mission24_terms_digest CHAR(64) NOT NULL CHECK(mission24_terms_digest~'^[0-9a-f]{64}$'),
 invoice_date DATE NOT NULL,
 preparation JSONB NOT NULL,
 preparation_digest CHAR(64) NOT NULL CHECK(preparation_digest~'^[0-9a-f]{64}$'),
 review JSONB NOT NULL,
 review_digest CHAR(64) NOT NULL CHECK(review_digest~'^[0-9a-f]{64}$'),
 reviewed_by_user_id UUID NOT NULL,
 reviewed_by_access_role TEXT NOT NULL CHECK(reviewed_by_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 capability_grant_id UUID NOT NULL,
 capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.invoice_draft'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 reason TEXT NOT NULL CHECK(reason=btrim(reason) AND octet_length(reason) BETWEEN 12 AND 1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,origin_id,sequence),
 UNIQUE(organization_id,origin_id,draft_revision,invoice_date,preparation_digest),
 FOREIGN KEY(organization_id,origin_id)
  REFERENCES public.canonical_customer_financial_invoice_draft_origins_v1(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,billing_review_id)
  REFERENCES public.canonical_customer_financial_billing_identity_reviews_v1(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id,mission24_terms_id)
  REFERENCES public.canonical_commercial_terms(organization_id,estimate_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,reviewed_by_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_invoice_draft_grants_v1(
   organization_id,id,revision) ON DELETE RESTRICT,
 CHECK(rtrim(preparation_digest)=public.canonical_completion_digest(preparation)),
 CHECK(rtrim(review_digest)=public.canonical_completion_digest(review-'reviewDigest')),
 CHECK(review->>'reviewDigest'=rtrim(review_digest)),
 CHECK(review->>'contractVersion'='m27-invoice-date-tax-review-v1'),
 CHECK(review->>'state'='recorded_policy_unavailable'),
 CHECK(review->>'reviewId'=id::text),
 CHECK((review->>'reviewSequence')::integer=sequence),
 CHECK(review->>'preparationDigest'=rtrim(preparation_digest))
);

CREATE TABLE public.canonical_customer_financial_invoice_tax_review_requests_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 review_id UUID NOT NULL,
 response_digest CHAR(64) NOT NULL CHECK(response_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest),
 FOREIGN KEY(organization_id,review_id)
  REFERENCES public.canonical_customer_financial_invoice_tax_reviews_v1(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

DO $policy$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_customer_financial_invoice_tax_reviews_v1',
  'canonical_customer_financial_invoice_tax_review_requests_v1'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass)))',
   table_name||'_owner_only',table_name,'public.'||table_name,'public.'||table_name);
 END LOOP;
END $policy$;

DO $immutability$ DECLARE table_value TEXT; BEGIN
 FOREACH table_value IN ARRAY ARRAY[
  'canonical_customer_financial_invoice_tax_reviews_v1',
  'canonical_customer_financial_invoice_tax_review_requests_v1'] LOOP
  EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable()',table_value,table_value);
 END LOOP;
END $immutability$;

CREATE FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_unavailable(reason_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'contractVersion','m27-invoice-date-tax-review-v1','state','unavailable','reason',reason_value,
 'value',NULL,'sourceCurrent',FALSE,'taxAuthorityCurrent',FALSE,
 'taxBearingInvoiceAuthorized',FALSE,'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,
 'issueAuthorized',FALSE,'providerCallCount',0,'receiverMutationCount',0) $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_money(decimal_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE minor_value BIGINT;
BEGIN
 IF decimal_value IS NULL OR decimal_value!~'^(0|[1-9][0-9]{0,7})\.[0-9]{2}$' THEN
  RAISE EXCEPTION 'Invoice tax money invalid' USING ERRCODE='22023'; END IF;
 minor_value:=(decimal_value::numeric*100)::bigint;
 IF minor_value NOT BETWEEN 0 AND 1000000000 THEN
  RAISE EXCEPTION 'Invoice tax money outside bounds' USING ERRCODE='22023'; END IF;
 RETURN public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(minor_value);
END $$;

-- Mission 24 publishes an issued charge as the gross amount for an inclusive
-- group and as the pre-tax amount for an exclusive group.  Keep that source
-- distinction inside the database boundary and return only the exact pre-tax
-- allocation used by the reviewed final-balance handoff.  NULL is deliberate:
-- callers translate every malformed or inconsistent source into the existing
-- value-free reconciliation failure.
CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
 document_amount TEXT,adjusted_amount TEXT,behavior_value TEXT,tax_amount TEXT)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gross_minor BIGINT;tax_minor BIGINT;basis_minor BIGINT;
BEGIN
 IF document_amount IS NULL OR adjusted_amount IS NULL OR tax_amount IS NULL OR
    document_amount!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$' OR
    adjusted_amount!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$' OR
    tax_amount!~'^(0|[1-9][0-9]{0,7})\.[0-9]{2}$' OR
    document_amount::numeric<>adjusted_amount::numeric OR
    behavior_value NOT IN('inclusive','exclusive') THEN RETURN NULL; END IF;
 gross_minor:=(adjusted_amount::numeric*100)::bigint;
 tax_minor:=(tax_amount::numeric*100)::bigint;
 IF gross_minor NOT BETWEEN 0 AND 10000000 OR tax_minor<0 OR tax_minor>gross_minor THEN
  RETURN NULL; END IF;
 basis_minor:=CASE WHEN behavior_value='inclusive' THEN gross_minor-tax_minor ELSE gross_minor END;
 RETURN basis_minor;
END $$;

-- Part 4D closes the only missing Part 4A reconciliation case without changing
-- the sealed source authorities or their tables.  Exact exclusive candidates
-- remain byte-for-byte compatible; inclusive candidates use Mission 24's own
-- immutable line tax allocation to derive the accepted pre-tax line amounts.
CREATE OR REPLACE FUNCTION public.canonical_customer_financial_invoice_draft_v1_source(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt_row public.canonical_customer_financial_billable_handoff_receipts_v1%ROWTYPE;
 terms_row public.canonical_commercial_terms%ROWTYPE;
 source_value JSONB;projection JSONB;basis JSONB;item JSONB;payment JSONB;
 term_line JSONB;input_group JSONB;result_group JSONB;allocation JSONB;
 lines JSONB:='[]'::jsonb;amount_value BIGINT;gross_minor BIGINT;item_amount BIGINT;
 tax_minor BIGINT;total_value BIGINT:=0;item_count INTEGER:=0;ordinal_value INTEGER:=0;
 description_value TEXT;candidate JSONB;group_count INTEGER;result_group_count INTEGER;
 allocation_count INTEGER;
BEGIN
 SELECT * INTO receipt_row FROM public.canonical_customer_financial_billable_handoff_receipts_v1
  WHERE organization_id=org AND id=receipt_value AND estimate_id=estimate_value
   AND receipt_digest=receipt_digest_value FOR SHARE;
 IF receipt_row.id IS NULL THEN RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('reviewed_handoff_unavailable'); END IF;
 source_value:=public.canonical_customer_financial_billable_review_v1_source(
  org,actor,role_value,session_value,estimate_value,receipt_row.source_class);
 IF source_value->>'state'<>'review_required' OR source_value#>>'{source,decisionDigest}'<>rtrim(receipt_row.decision_digest) OR
  source_value#>>'{source,sourceIdentity}'<>receipt_row.source_identity::text OR
  source_value#>>'{source,sourceDigest}'<>rtrim(receipt_row.source_digest) OR
  source_value#>>'{source,sourceAuthorityIdentity}'<>receipt_row.source_authority_identity::text OR
  source_value#>>'{source,sourceAuthorityDigest}'<>rtrim(receipt_row.source_authority_digest) OR
  source_value#>>'{source,commercialBasisDigest}'<>rtrim(receipt_row.commercial_basis_digest) THEN
  RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('reviewed_handoff_stale'); END IF;
 projection:=public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,rtrim(receipt_row.decision_digest));
 IF projection->>'state'<>'reviewed_current' OR projection#>>'{handoffReceipt,receiptId}'<>receipt_row.id::text OR
  projection#>>'{handoffReceipt,receiptDigest}'<>rtrim(receipt_row.receipt_digest) THEN
  RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('reviewed_handoff_not_current'); END IF;
 basis:=public.canonical_customer_financial_editable_basis_v1_read(org,actor,role_value,session_value,estimate_value);
 IF basis->>'state'<>'current_mission24_commercial_lineage' OR basis->'sourceCurrent' IS DISTINCT FROM 'true'::jsonb OR
  public.canonical_completion_digest(basis-'authority')<>rtrim(receipt_row.commercial_basis_digest) THEN
  RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('mission24_commercial_source_stale'); END IF;
 amount_value:=(receipt_row.receipt#>>'{amount,minorUnits}')::bigint;
 IF amount_value<0 OR amount_value>10000000 OR receipt_row.receipt#>>'{amount,currency}'<>'USD' THEN
  RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('reviewed_amount_unavailable'); END IF;
 IF receipt_row.source_class='final_balance' THEN
  SELECT * INTO terms_row FROM public.canonical_commercial_terms
   WHERE organization_id=org AND estimate_id=estimate_value
    AND id=(basis#>>'{commercial,termsId}')::uuid
    AND revision=(basis#>>'{commercial,termsRevision}')::bigint
    AND rtrim(digest)=basis#>>'{commercial,termsDigest}' FOR SHARE;
  IF terms_row.id IS NULL OR terms_row.action<>'save' OR
     terms_row.result->'complete' IS DISTINCT FROM 'true'::jsonb OR
     terms_row.result->>'currency'<>'USD' OR terms_row.body->>'currency'<>'USD' OR
     jsonb_typeof(terms_row.result->'lines')<>'array' OR
     jsonb_typeof(terms_row.body#>'{inputs,taxGroups}')<>'array' OR
     jsonb_typeof(terms_row.result->'taxGroups')<>'array' OR
     jsonb_array_length(terms_row.result->'lines')<>
      jsonb_array_length(COALESCE(basis#>'{customerSafeDocument,charges}','[]'::jsonb)) OR
     COALESCE(terms_row.result->>'netBeforeTax','')<>COALESCE(basis#>>'{customerSafeDocument,subtotal}','') OR
     COALESCE(terms_row.result->>'tax','')<>COALESCE(basis#>>'{customerSafeDocument,tax}','') OR
     COALESCE(terms_row.result->>'total','')<>COALESCE(basis#>>'{customerSafeDocument,total}','') OR
     COALESCE(terms_row.result->>'netBeforeTax','')!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$' OR
     (terms_row.result->>'netBeforeTax')::numeric*100<>amount_value THEN
   RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('invoice_origin_reconciliation_failed'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(basis#>'{customerSafeDocument,charges}','[]'::jsonb)) LOOP
   item_count:=item_count+1;description_value:=btrim(item->>'label');
   term_line:=terms_row.result->'lines'->ordinal_value;
   IF item_count>24 OR description_value IS NULL OR octet_length(description_value) NOT BETWEEN 1 AND 500 OR
      (item->>'amount')!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$' OR
      COALESCE(term_line->>'lineId','')='' OR COALESCE(term_line->>'adjustedAmount','')='' THEN
    RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('customer_safe_lines_unavailable'); END IF;
   SELECT count(*)::integer,(jsonb_agg(entry.value ORDER BY entry.value->>'groupId')->0)
    INTO group_count,input_group
    FROM jsonb_array_elements(terms_row.body#>'{inputs,taxGroups}') entry(value)
    WHERE entry.value->'lineIds' ? (term_line->>'lineId');
   IF group_count<>1 OR input_group->>'behavior' NOT IN('inclusive','exclusive') THEN
    RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('invoice_origin_reconciliation_failed'); END IF;
   SELECT count(*)::integer,(jsonb_agg(entry.value ORDER BY entry.value->>'groupId')->0)
    INTO result_group_count,result_group
    FROM jsonb_array_elements(terms_row.result->'taxGroups') entry(value)
    WHERE entry.value->>'groupId'=input_group->>'groupId';
   IF result_group_count<>1 OR jsonb_typeof(result_group->'allocations')<>'array' THEN
    RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('invoice_origin_reconciliation_failed'); END IF;
   SELECT count(*)::integer,(jsonb_agg(entry.value ORDER BY entry.value->>'lineId')->0)
    INTO allocation_count,allocation
    FROM jsonb_array_elements(result_group->'allocations') entry(value)
    WHERE entry.value->>'lineId'=term_line->>'lineId';
   IF allocation_count<>1 THEN
    RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('invoice_origin_reconciliation_failed'); END IF;
   item_amount:=public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
    item->>'amount',term_line->>'adjustedAmount',input_group->>'behavior',allocation->>'tax');
   IF item_amount IS NULL THEN
    RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('invoice_origin_reconciliation_failed'); END IF;
   gross_minor:=((item->>'amount')::numeric*100)::bigint;
   tax_minor:=((allocation->>'tax')::numeric*100)::bigint;
   total_value:=total_value+item_amount;
   lines:=lines||jsonb_build_array(jsonb_build_object('ordinal',ordinal_value,
    'lineDigest',public.canonical_completion_digest(CASE WHEN input_group->>'behavior'='exclusive'
     THEN jsonb_build_object('issuedVersionId',basis#>>'{identity,issuedVersionId}',
      'ordinal',ordinal_value,'description',description_value,'minorUnits',item_amount::text)
     ELSE jsonb_build_object('issuedVersionId',basis#>>'{identity,issuedVersionId}',
      'ordinal',ordinal_value,'description',description_value,'minorUnits',item_amount::text,
      'grossMinorUnits',gross_minor::text,'taxMinorUnits',tax_minor::text,
      'taxBehavior','inclusive','mission24LineId',term_line->>'lineId',
      'termsDigest',basis#>>'{commercial,termsDigest}') END),
    'kind','mission24_customer_safe_charge','description',description_value,
    'quantity',jsonb_build_object('version','m27-invoice-quantity-v1','value','1','unit','customer_safe_charge',
     'meaning','one accepted customer-safe commercial charge; not a field quantity'),
    'unitAmount',jsonb_build_object('version','m27-exact-money-v1','currency','USD','minorUnitExponent',2,
     'minorUnits',item_amount::text,'decimal',to_char(item_amount/100.0,'FM999999999999990.00'),'exactZero',item_amount=0),
    'lineAmount',jsonb_build_object('version','m27-exact-money-v1','currency','USD','minorUnitExponent',2,
     'minorUnits',item_amount::text,'decimal',to_char(item_amount/100.0,'FM999999999999990.00'),'exactZero',item_amount=0),
    'source','mission24.accepted_customer_safe_charge'));
   ordinal_value:=ordinal_value+1;
  END LOOP;
 ELSE
  SELECT value INTO payment FROM jsonb_array_elements(COALESCE(basis#>'{customerSafeDocument,payments}','[]'::jsonb))
   WHERE value->>'kind'='deposit';
  IF payment IS NULL THEN RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('accepted_deposit_line_unavailable'); END IF;
  description_value:=btrim(COALESCE(payment->>'label','Accepted pre-work deposit'));
  IF octet_length(description_value) NOT BETWEEN 1 AND 500 THEN
   RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('accepted_deposit_line_unavailable'); END IF;
  item_count:=1;total_value:=amount_value;
  lines:=jsonb_build_array(jsonb_build_object('ordinal',0,
   'lineDigest',public.canonical_completion_digest(jsonb_build_object('issuedVersionId',basis#>>'{identity,issuedVersionId}',
    'deposit',payment,'minorUnits',amount_value::text)),
   'kind','mission24_accepted_deposit','description',description_value,
   'quantity',jsonb_build_object('version','m27-invoice-quantity-v1','value','1','unit','accepted_deposit',
    'meaning','one exact accepted deposit schedule obligation; not a field quantity'),
   'unitAmount',receipt_row.receipt->'amount','lineAmount',receipt_row.receipt->'amount',
   'source','mission24.exact_accepted_deposit_schedule'));
 END IF;
 IF item_count<1 OR total_value<>amount_value THEN
  RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('invoice_origin_reconciliation_failed'); END IF;
 candidate:=jsonb_build_object('contractVersion','m27-invoice-draft-origin-candidate-v1',
  'estimateId',estimate_value,'customerId',basis#>>'{identity,customerId}',
  'handoffReceiptId',receipt_row.id,'handoffReceiptDigest',rtrim(receipt_row.receipt_digest),
  'sourceClass',receipt_row.source_class,'decisionDigest',rtrim(receipt_row.decision_digest),
  'commercialBasisDigest',rtrim(receipt_row.commercial_basis_digest),
  'mission24Source',jsonb_build_object('issuedVersionId',basis#>>'{identity,issuedVersionId}',
   'issuedRevision',(basis#>>'{commercial,issuedRevision}')::bigint,
   'issuedDigest',basis#>>'{commercial,issuedDigest}','documentDigest',basis#>>'{commercial,documentDigest}',
   'commercialApprovalId',basis#>>'{commercial,commercialApprovalId}',
   'commercialApprovalDigest',basis#>>'{commercial,commercialApprovalDigest}',
   'acceptanceId',basis#>>'{identity,acceptanceId}','acceptanceDigest',basis#>>'{commercial,acceptanceDigest}'),
  'currency','USD','lines',lines,
  'subtotalBeforeTax',jsonb_build_object('version','m27-exact-money-v1','currency','USD','minorUnitExponent',2,
   'minorUnits',amount_value::text,'decimal',to_char(amount_value/100.0,'FM999999999999990.00'),'exactZero',amount_value=0),
  'tax',jsonb_build_object('state','unavailable','reason','invoice_date_tax_review_required','value',NULL),
  'amountDue',jsonb_build_object('state','unavailable','reason','invoice_reconciliation_not_yet_authorized','value',NULL),
  'sourceCurrent',TRUE,'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,'issueAuthorized',FALSE,
  'providerCallCount',0,'receiverMutationCount',0);
 RETURN candidate||jsonb_build_object('candidateDigest',public.canonical_completion_digest(candidate));
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_source(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE components_value JSONB;draft_value JSONB;
 saved public.canonical_customer_financial_invoice_draft_origins_v1%ROWTYPE;
 issued public.canonical_customer_estimate_versions%ROWTYPE;
 terms public.canonical_commercial_terms%ROWTYPE;
 party public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 customer_record public.canonical_customers%ROWTYPE;
 billing_review public.canonical_customer_financial_billing_identity_reviews_v1%ROWTYPE;
 billing_state JSONB;tax_profile public.canonical_tax_profiles%ROWTYPE;
 service_address JSONB;billing_address JSONB;tax_context JSONB;
 input_group JSONB;result_group JSONB;term_line JSONB;draft_line JSONB;
 allocation JSONB;source_value JSONB;line_value JSONB;lines_value JSONB:='[]'::jsonb;
 registration_value JSONB;preparation_value JSONB;base_value JSONB;
 ordinal_value INTEGER;line_count INTEGER;tax_sum BIGINT:=0;tax_minor BIGINT;
 basis_minor BIGINT;basis_sum BIGINT:=0;
 invoice_day DATE:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 components_value:=public.canonical_customer_financial_invoice_draft_components_v1_read(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF components_value->>'state'<>'current' THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable(
   COALESCE(components_value->>'reason','invoice_draft_currentness_unavailable')); END IF;
 draft_value:=public.canonical_customer_financial_invoice_draft_revision_v1_current(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF draft_value->>'state'<>'current' THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable(
   COALESCE(draft_value->>'reason','invoice_draft_currentness_unavailable')); END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_draft_origins_v1
  WHERE organization_id=org AND id=(draft_value->>'originId')::uuid
   AND estimate_id=estimate_value AND handoff_receipt_id=receipt_value
   AND rtrim(handoff_receipt_digest)=receipt_digest_value FOR SHARE;
 IF saved.id IS NULL OR rtrim(saved.origin_digest)<>draft_value->>'originDigest' OR
    rtrim(saved.candidate_digest)<>draft_value->>'candidateDigest' THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('invoice_draft_origin_stale'); END IF;

 SELECT * INTO issued FROM public.canonical_customer_estimate_versions
  WHERE organization_id=org AND estimate_id=estimate_value
   AND id=(saved.origin#>>'{mission24Source,issuedVersionId}')::uuid FOR SHARE;
 IF issued.id IS NULL OR issued.revision<>(saved.origin#>>'{mission24Source,issuedRevision}')::bigint OR
    rtrim(issued.digest)<>saved.origin#>>'{mission24Source,issuedDigest}' OR
    rtrim(issued.document_digest)<>saved.origin#>>'{mission24Source,documentDigest}' THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('mission24_tax_preparation_stale'); END IF;
 SELECT * INTO terms FROM public.canonical_commercial_terms
  WHERE organization_id=org AND estimate_id=estimate_value AND id=issued.terms_id FOR SHARE;
 IF terms.id IS NULL OR terms.action<>'save' OR terms.result->'complete' IS DISTINCT FROM 'true'::jsonb OR
    terms.result->>'currency'<>'USD' OR terms.body->>'currency'<>'USD' OR
    terms.result->>'calculationVersion' NOT IN('estimate-commercial-terms-v1','estimate-commercial-terms-v2') OR
    terms.result->>'taxAuthority' NOT IN('owner_recorded','validated') OR
    rtrim(terms.digest)<>saved.origin#>>'{mission24Source,termsDigest}' OR
    jsonb_typeof(terms.body#>'{inputs,taxGroups}')<>'array' OR
    jsonb_typeof(terms.result->'taxGroups')<>'array' OR
    jsonb_array_length(terms.body#>'{inputs,taxGroups}') NOT BETWEEN 1 AND 12 OR
    jsonb_array_length(terms.body#>'{inputs,taxGroups}')<>jsonb_array_length(terms.result->'taxGroups') THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('tax_authority_unavailable'); END IF;

 SELECT * INTO party FROM public.canonical_customer_financial_billing_parties_v1
  WHERE organization_id=org AND customer_id=saved.customer_id FOR SHARE;
 IF party.id IS NULL THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('billing_identity_review_required'); END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(
  org::text||':billing-review-party:'||party.id::text,0));
 SELECT * INTO customer_record FROM public.canonical_customers
  WHERE organization_id=org AND id=saved.customer_id FOR SHARE;
 SELECT * INTO billing_review FROM public.canonical_customer_financial_billing_identity_reviews_v1
  WHERE organization_id=org AND billing_party_id=party.id ORDER BY sequence DESC LIMIT 1 FOR SHARE;
 IF customer_record.id IS NULL OR billing_review.id IS NULL THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('billing_identity_review_required'); END IF;
 billing_state:=public.canonical_customer_financial_billing_review_v1_projection(customer_record,billing_review);
 IF billing_state->>'state'<>'reviewed_current' OR billing_state->'documentUseAuthorized' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable(
   COALESCE(billing_state->>'reason','billing_identity_review_stale')); END IF;
 service_address:=billing_review.reviewed_snapshot#>'{serviceLocation,address,value}';
 billing_address:=billing_review.reviewed_snapshot#>'{billingAddress,address,value}';
 IF public.canonical_customer_financial_billing_review_v1_address_valid(service_address) IS NOT TRUE OR
    public.canonical_customer_financial_billing_review_v1_address_valid(billing_address) IS NOT TRUE OR
    service_address->>'countryCode'<>'US' OR billing_address->>'countryCode'<>'US' OR
    service_address->>'region' NOT IN('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
      'WV','WI','WY','DC') OR
    billing_address->>'region' NOT IN('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
      'WV','WI','WY','DC') THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('geography_unsupported'); END IF;

 IF jsonb_typeof(terms.authority_pin#>'{taxProfilePin}')='object' AND
    COALESCE(terms.authority_pin#>>'{taxProfilePin,id}','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
    COALESCE(terms.authority_pin#>>'{taxProfilePin,revision}','')~'^[1-9][0-9]{0,4}$' AND
    COALESCE(terms.authority_pin#>>'{taxProfilePin,digest}','')~'^[0-9a-f]{64}$' THEN
  SELECT * INTO tax_profile FROM public.canonical_tax_profiles
   WHERE organization_id=org AND id=(terms.authority_pin#>>'{taxProfilePin,id}')::uuid
    AND revision=(terms.authority_pin#>>'{taxProfilePin,revision}')::bigint
    AND rtrim(digest)=terms.authority_pin#>>'{taxProfilePin,digest}' FOR SHARE;
  IF tax_profile.id IS NULL THEN
   RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('mission24_tax_preparation_stale'); END IF;
 END IF;

 line_count:=jsonb_array_length(terms.result->'lines');
 IF line_count<1 OR line_count<>jsonb_array_length(draft_value->'lines') OR
    line_count<>jsonb_array_length(issued.document->'charges') OR
    terms.result->>'netBeforeTax'<>issued.document->>'subtotal' OR
    terms.result->>'tax'<>issued.document->>'tax' OR terms.result->>'total'<>issued.document->>'total' THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('invoice_tax_basis_incompatible'); END IF;
 FOR ordinal_value IN 0..line_count-1 LOOP
  term_line:=terms.result->'lines'->ordinal_value;
  draft_line:=draft_value->'lines'->ordinal_value;
  IF issued.document#>>ARRAY['charges',ordinal_value::text,'amount']<>term_line->>'adjustedAmount' THEN
   RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('invoice_tax_basis_incompatible'); END IF;
  SELECT entry.value INTO input_group FROM jsonb_array_elements(terms.body#>'{inputs,taxGroups}') AS entry(value)
   WHERE entry.value->'lineIds' ? (term_line->>'lineId') LIMIT 1;
  SELECT entry.value INTO result_group FROM jsonb_array_elements(terms.result->'taxGroups') AS entry(value)
   WHERE entry.value->>'groupId'=input_group->>'groupId' LIMIT 1;
  SELECT entry.value INTO allocation FROM jsonb_array_elements(COALESCE(result_group->'allocations','[]'::jsonb)) AS entry(value)
   WHERE entry.value->>'lineId'=term_line->>'lineId' LIMIT 1;
  source_value:=input_group->'source';
  IF input_group IS NULL OR result_group IS NULL OR allocation IS NULL OR
     input_group->>'behavior' NOT IN('inclusive','exclusive') OR
     input_group->>'treatment' NOT IN('taxable','zero_rate','exempt') OR
     source_value->>'kind' NOT IN('owner_recorded','validated') OR
     COALESCE(source_value->>'jurisdiction','')='' OR COALESCE(source_value->>'location','')='' OR
     COALESCE(source_value->>'collectionBasis','')='' OR source_value->'acknowledged' IS DISTINCT FROM 'true'::jsonb OR
     COALESCE(source_value->>'legalEffectiveOn','')>invoice_day::text OR
     (source_value->>'legalEndsOn' IS NOT NULL AND source_value->'legalEndsOn'<>'null'::jsonb AND
      source_value->>'legalEndsOn'<invoice_day::text) OR
     COALESCE(source_value->>'reviewedOn','')>invoice_day::text OR
     COALESCE(source_value->>'reviewValidThrough','')<invoice_day::text OR
     COALESCE(input_group->>'ratePercent','')!~'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,4})?$' OR
     COALESCE(allocation->>'tax','')!~'^(0|[1-9][0-9]{0,7})\.[0-9]{2}$' THEN
   RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('tax_authority_unavailable'); END IF;
  tax_minor:=((allocation->>'tax')::numeric*100)::bigint;
  basis_minor:=public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(
   issued.document#>>ARRAY['charges',ordinal_value::text,'amount'],term_line->>'adjustedAmount',
   input_group->>'behavior',allocation->>'tax');
  IF basis_minor IS NULL OR draft_line#>>'{allocatedAmount,minorUnits}'<>basis_minor::text THEN
   RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('invoice_tax_basis_incompatible'); END IF;
  basis_sum:=basis_sum+basis_minor;
  tax_sum:=tax_sum+tax_minor;
  line_value:=jsonb_build_object('ordinal',ordinal_value,
   'invoiceSourceLineDigest',draft_line->>'sourceLineDigest','mission24LineId',term_line->>'lineId',
   'taxGroupId',input_group->>'groupId','treatment',input_group->>'treatment',
   'inclusiveExclusive',input_group->>'behavior','ratePercent',input_group->>'ratePercent',
   'taxableBasis',public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(basis_minor),
   'collectedTax',public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(tax_minor),
   'source',jsonb_build_object('kind',source_value->>'kind','jurisdiction',source_value->>'jurisdiction',
    'location',source_value->>'location','serviceKey',source_value->>'serviceKey',
    'collectionBasis',source_value->>'collectionBasis','reference',source_value->>'reference',
    'effectiveOn',source_value->>'legalEffectiveOn','endsOn',source_value->'legalEndsOn',
    'reviewedOn',source_value->>'reviewedOn','reviewValidThrough',source_value->>'reviewValidThrough',
    'ruleId',source_value->'ruleId','ruleDigest',source_value->'ruleDigest'));
  lines_value:=lines_value||jsonb_build_array(line_value);
 END LOOP;
 IF tax_sum<>((terms.result->>'tax')::numeric*100)::bigint OR
    basis_sum<>((terms.result->>'netBeforeTax')::numeric*100)::bigint OR
    basis_sum<>(draft_value#>>'{subtotalBeforeTax,minorUnits}')::bigint THEN
  RETURN public.canonical_customer_financial_invoice_tax_review_v1_unavailable('invoice_tax_basis_incompatible'); END IF;

 IF tax_profile.id IS NOT NULL THEN
   SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(entry.value ORDER BY entry.value->>'id'))->0 ELSE NULL END
   INTO tax_context
   FROM jsonb_array_elements(COALESCE(tax_profile.inputs->'contexts','[]'::jsonb)) AS entry(value)
   WHERE entry.value->>'country'='US'
    AND entry.value->>'serviceKey'=(terms.body#>>'{inputs,taxGroups,0,source,serviceKey}')
    AND entry.value->>'jurisdiction'=(terms.body#>>'{inputs,taxGroups,0,source,jurisdiction}')
    AND entry.value->>'collectionBasis'=(terms.body#>>'{inputs,taxGroups,0,source,collectionBasis}');
 END IF;
 registration_value:=CASE WHEN tax_context IS NULL THEN
  jsonb_build_object('state','unavailable','reason','registration_evidence_unavailable','value',NULL)
 ELSE jsonb_build_object('state','source_snapshot','registration',tax_context->>'registration',
  'registrationReference',tax_context->>'registrationReference',
  'collectionBasis',tax_context->>'collectionBasis','taxProfileId',tax_profile.id,
  'taxProfileRevision',tax_profile.revision,'taxProfileDigest',rtrim(tax_profile.digest)) END;

 preparation_value:=jsonb_build_object(
  'version','m27-invoice-date-tax-preparation-v1','invoiceDate',invoice_day::text,
  'invoiceDraft',jsonb_build_object('originId',saved.id,'originDigest',rtrim(saved.origin_digest),
   'revision',(draft_value->>'revision')::bigint,'draftDigest',draft_value->>'draftDigest',
   'historyChainDigest',draft_value->>'historyChainDigest','currency','USD',
   'subtotalBeforeTax',draft_value->'subtotalBeforeTax'),
  'billingIdentity',jsonb_build_object('billingPartyId',party.id,'reviewId',billing_review.id,
   'reviewSequence',billing_review.sequence,'reviewDigest',rtrim(billing_review.reviewed_snapshot_digest)),
  'mission24',jsonb_build_object('authorityClass','mission24.current_accepted_tax_preparation',
   'issuedVersionId',issued.id,'issuedRevision',issued.revision,'issuedDigest',rtrim(issued.digest),
   'documentDigest',rtrim(issued.document_digest),'termsId',terms.id,'termsRevision',terms.revision,
    'termsDigest',rtrim(terms.digest),'decisionDigest',rtrim(saved.decision_digest),
   'calculationVersion',terms.result->>'calculationVersion','taxAuthorityClass',terms.result->>'taxAuthority'),
  'serviceJurisdiction',jsonb_build_object('countryCode',service_address->>'countryCode',
   'region',service_address->>'region','city',service_address->>'city','postalCode',service_address->>'postalCode'),
  'billingJurisdiction',jsonb_build_object('countryCode',billing_address->>'countryCode',
   'region',billing_address->>'region','city',billing_address->>'city','postalCode',billing_address->>'postalCode'),
  'registrationEvidence',registration_value,
  'nexusEvidence',jsonb_build_object('state','unavailable','reason','professional_tax_policy_unavailable','value',NULL),
  'exemptionSnapshot',jsonb_build_object('classification',terms.body#>>'{inputs,jobApplicability,customerExemption}',
   'evidenceReference',terms.body#>'{inputs,jobApplicability,evidenceRef,customerExemption}',
   'profileExemptionReference',CASE WHEN tax_context IS NULL THEN NULL ELSE tax_context->'exemptionReference' END),
  'rounding',jsonb_build_object('version','mission24.canonical_commercial_numeric_round.v1',
   'mode','half_away_from_zero','minorUnitExponent',2),
  'lines',lines_value,
  'collectedTaxLiability',jsonb_build_object('amount',
   public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(tax_sum),
   'arithmeticRole','tax_liability_separate_from_commercial_subtotal',
   'revenueRecognitionAuthorized',FALSE,'filingAuthorized',FALSE),
  'creditRefundAdjustmentLineage',jsonb_build_object('state','unavailable',
   'reason','credit_refund_lineage_unavailable','value',NULL,
   'missingEvidence',jsonb_build_array('mission27.native_credit_note','mission27.native_refund_receipt')),
  'sourceCurrent',TRUE,'providerCalculationUsed',FALSE,'browserArithmeticUsed',FALSE);
 base_value:=jsonb_build_object('contractVersion','m27-invoice-date-tax-review-v1',
  'state','ready_to_record','reviewId',NULL,'reviewSequence',0,
  'preparation',preparation_value,'preparationDigest',public.canonical_completion_digest(preparation_value),
  'professionalPolicy',jsonb_build_object('state','unavailable','reason','tax_authority_unavailable',
   'value',NULL,'missingEvidence',jsonb_build_array('professional_tax_policy_review')),
  'taxReviewDisposition',jsonb_build_object('state','unavailable','reason','tax_authority_unavailable',
   'value',NULL,'taxBearingInvoiceAuthorized',FALSE),
  'sourceCurrent',TRUE,'taxAuthorityCurrent',FALSE,'taxBearingInvoiceAuthorized',FALSE,
  'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,'issueAuthorized',FALSE,
  'providerCallCount',0,'receiverMutationCount',0);
 RETURN base_value||jsonb_build_object('candidateDigest',public.canonical_completion_digest(base_value),
  'reviewDigest',NULL,'reason',NULL,'reviewedAt',NULL);
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_saved(
 review_record public.canonical_customer_financial_invoice_tax_reviews_v1)
RETURNS JSONB LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT review_record.review $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate JSONB;saved public.canonical_customer_financial_invoice_tax_reviews_v1%ROWTYPE;
BEGIN
 candidate:=public.canonical_customer_financial_invoice_tax_review_v1_source(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF candidate->>'state'='unavailable' THEN RETURN candidate; END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_tax_reviews_v1
  WHERE organization_id=org AND origin_id=(candidate#>>'{preparation,invoiceDraft,originId}')::uuid
  ORDER BY sequence DESC LIMIT 1 FOR SHARE;
 IF saved.id IS NULL OR saved.draft_revision<>(candidate#>>'{preparation,invoiceDraft,revision}')::bigint OR
    rtrim(saved.draft_digest)<>candidate#>>'{preparation,invoiceDraft,draftDigest}' OR
    rtrim(saved.history_chain_digest)<>candidate#>>'{preparation,invoiceDraft,historyChainDigest}' OR
    saved.billing_review_id<>(candidate#>>'{preparation,billingIdentity,reviewId}')::uuid OR
    rtrim(saved.billing_review_digest)<>candidate#>>'{preparation,billingIdentity,reviewDigest}' OR
    saved.mission24_terms_id<>(candidate#>>'{preparation,mission24,termsId}')::uuid OR
    saved.mission24_terms_revision<>(candidate#>>'{preparation,mission24,termsRevision}')::bigint OR
    rtrim(saved.mission24_terms_digest)<>candidate#>>'{preparation,mission24,termsDigest}' OR
    saved.invoice_date<>(candidate#>>'{preparation,invoiceDate}')::date OR
    rtrim(saved.preparation_digest)<>candidate->>'preparationDigest' THEN RETURN candidate; END IF;
 RETURN public.canonical_customer_financial_invoice_tax_review_v1_saved(saved);
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_record(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf_value TEXT,key_value TEXT,
 estimate_value UUID,receipt_value UUID,receipt_digest_value TEXT,
 grant_value UUID,grant_revision_value BIGINT,purpose_value TEXT,policy_version_value TEXT,
 expected_candidate_digest_value TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;candidate JSONB;request_key_digest_value TEXT;request_digest_value TEXT;
 prior public.canonical_customer_financial_invoice_tax_review_requests_v1%ROWTYPE;
 saved public.canonical_customer_financial_invoice_tax_reviews_v1%ROWTYPE;
 inserted public.canonical_customer_financial_invoice_tax_reviews_v1%ROWTYPE;
 review_base JSONB;review_value JSONB;review_digest_value TEXT;sequence_value INTEGER;inserted_count INTEGER:=0;
BEGIN
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    expected_candidate_digest_value!~'^[0-9a-f]{64}$' OR
    reason_value IS NULL OR reason_value<>btrim(reason_value) OR octet_length(reason_value) NOT BETWEEN 12 AND 1000 OR
    confirmation_value<>'m27-invoice-date-tax-review-record-v1' OR
    purpose_value<>'customer_financial.invoice_draft' OR policy_version_value<>'mission27.launch.v1' THEN
  RAISE EXCEPTION 'Invoice tax review input invalid' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_customer_financial_invoice_draft_v1_access(
  org,actor,role_value,session_value,csrf_value,estimate_value,grant_value,grant_revision_value,TRUE);
 candidate:=public.canonical_customer_financial_invoice_tax_review_v1_source(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF candidate->>'state'<>'ready_to_record' OR candidate->>'candidateDigest'<>expected_candidate_digest_value THEN
  RAISE EXCEPTION 'Invoice tax review source changed' USING ERRCODE='40001'; END IF;
 request_key_digest_value:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'actorUserId',actor,'authSessionId',session_value,'estimateId',estimate_value,
  'handoffReceiptId',receipt_value,'handoffReceiptDigest',receipt_digest_value,
  'capabilityGrantId',grant_value,'capabilityGrantRevision',grant_revision_value,
  'businessPurpose',purpose_value,'policyVersion',policy_version_value,
  'expectedCandidateDigest',expected_candidate_digest_value,'reason',reason_value,
  'confirmationVersion',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':invoice-tax-review-request:'||actor::text||':'||session_value::text||':'||request_key_digest_value,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':invoice-tax-review-origin:'||(candidate#>>'{preparation,invoiceDraft,originId}'),0));
 SELECT * INTO prior FROM public.canonical_customer_financial_invoice_tax_review_requests_v1
  WHERE organization_id=org AND actor_user_id=actor AND auth_session_id=session_value
   AND rtrim(request_key_digest)=request_key_digest_value;
 IF prior.review_id IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_digest_value THEN
   RAISE EXCEPTION 'Invoice tax review idempotency conflict' USING ERRCODE='23505'; END IF;
  candidate:=public.canonical_customer_financial_invoice_tax_review_v1_source(
   org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
  SELECT * INTO saved FROM public.canonical_customer_financial_invoice_tax_reviews_v1
   WHERE organization_id=org AND id=prior.review_id FOR SHARE;
  IF candidate->>'state'<>'ready_to_record' OR saved.id IS NULL OR
     candidate->>'preparationDigest'<>rtrim(saved.preparation_digest) OR
     rtrim(prior.response_digest)<>rtrim(saved.review_digest) THEN
   RETURN jsonb_build_object('status',409,'body',
    public.canonical_customer_financial_invoice_tax_review_v1_unavailable('invoice_tax_review_stale'),
    'replayed',TRUE); END IF;
  RETURN jsonb_build_object('status',200,'body',saved.review,'replayed',TRUE);
 END IF;
 candidate:=public.canonical_customer_financial_invoice_tax_review_v1_source(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF candidate->>'state'<>'ready_to_record' OR candidate->>'candidateDigest'<>expected_candidate_digest_value THEN
  RAISE EXCEPTION 'Invoice tax review source changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_tax_reviews_v1
  WHERE organization_id=org AND origin_id=(candidate#>>'{preparation,invoiceDraft,originId}')::uuid
   AND draft_revision=(candidate#>>'{preparation,invoiceDraft,revision}')::bigint
   AND invoice_date=(candidate#>>'{preparation,invoiceDate}')::date
   AND rtrim(preparation_digest)=candidate->>'preparationDigest' FOR SHARE;
 IF saved.id IS NULL THEN
  SELECT COALESCE(max(sequence),0)+1 INTO sequence_value
   FROM public.canonical_customer_financial_invoice_tax_reviews_v1
   WHERE organization_id=org AND origin_id=(candidate#>>'{preparation,invoiceDraft,originId}')::uuid;
  review_base:=(candidate-'candidateDigest'-'reviewDigest'-'reason'-'reviewedAt')||jsonb_build_object(
   'state','recorded_policy_unavailable','reviewId',gen_random_uuid(),'reviewSequence',sequence_value,
   'reason',reason_value,'reviewedAt',public.canonical_customer_financial_billing_identity_v1_utc(clock_timestamp()));
  review_digest_value:=public.canonical_completion_digest(review_base);
  review_value:=review_base||jsonb_build_object('reviewDigest',review_digest_value);
  INSERT INTO public.canonical_customer_financial_invoice_tax_reviews_v1(
   organization_id,id,estimate_id,origin_id,sequence,draft_revision,draft_digest,history_chain_digest,
   billing_review_id,billing_review_digest,mission24_terms_id,mission24_terms_revision,
   mission24_terms_digest,invoice_date,preparation,preparation_digest,review,review_digest,
   reviewed_by_user_id,reviewed_by_access_role,membership_id,auth_session_id,
   capability_grant_id,capability_grant_revision,business_purpose,policy_version,reason)
  VALUES(org,(review_value->>'reviewId')::uuid,estimate_value,
   (candidate#>>'{preparation,invoiceDraft,originId}')::uuid,sequence_value,
   (candidate#>>'{preparation,invoiceDraft,revision}')::bigint,
   candidate#>>'{preparation,invoiceDraft,draftDigest}',candidate#>>'{preparation,invoiceDraft,historyChainDigest}',
   (candidate#>>'{preparation,billingIdentity,reviewId}')::uuid,
   candidate#>>'{preparation,billingIdentity,reviewDigest}',
   (candidate#>>'{preparation,mission24,termsId}')::uuid,
   (candidate#>>'{preparation,mission24,termsRevision}')::bigint,
   candidate#>>'{preparation,mission24,termsDigest}',(candidate#>>'{preparation,invoiceDate}')::date,
   candidate->'preparation',candidate->>'preparationDigest',review_value,review_digest_value,
   actor,role_value,(authority->>'membershipId')::uuid,session_value,grant_value,grant_revision_value,
   purpose_value,policy_version_value,reason_value) RETURNING * INTO inserted;
  saved:=inserted;inserted_count:=1;
 END IF;
 INSERT INTO public.canonical_customer_financial_invoice_tax_review_requests_v1(
  organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,
  review_id,response_digest)
 VALUES(org,actor,session_value,request_key_digest_value,request_digest_value,saved.id,saved.review_digest);
 RETURN jsonb_build_object('status',CASE WHEN inserted_count=1 THEN 201 ELSE 200 END,
  'body',saved.review,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_invoice_tax_reviews_v1,
 public.canonical_customer_financial_invoice_tax_review_requests_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION
 public.canonical_customer_financial_invoice_tax_review_v1_unavailable(TEXT),
 public.canonical_customer_financial_invoice_tax_review_v1_money(TEXT),
 public.canonical_customer_financial_invoice_draft_v1_pre_tax_line_minor(TEXT,TEXT,TEXT,TEXT),
 public.canonical_customer_financial_invoice_tax_review_v1_source(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT),
 public.canonical_customer_financial_invoice_tax_review_v1_saved(public.canonical_customer_financial_invoice_tax_reviews_v1),
 public.canonical_customer_financial_invoice_tax_review_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT),
 public.canonical_customer_financial_invoice_tax_review_v1_record(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT)
 FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_read(
  UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_tax_review_v1_record(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT)
  TO northstar_app_runtime;
END IF; END $grant$;
