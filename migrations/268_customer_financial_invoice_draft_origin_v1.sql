-- Mission 27 Part 4A: capture one immutable, customer-safe invoice-draft
-- origin from an exact-current reviewed Part 3 handoff.  This migration does
-- not create an invoice, receivable, tax decision, issue/send authority,
-- provider request, payment, or downstream mutation.

CREATE TABLE public.canonical_customer_financial_invoice_draft_grants_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, estimate_id UUID NOT NULL,
 capability TEXT NOT NULL CHECK(capability='customer_financial.invoice.edit_draft'),
 target_class TEXT NOT NULL CHECK(target_class='canonical_estimate'),
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.invoice_draft'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 template_version TEXT NOT NULL CHECK(template_version IN('m27.owner.v1','m27.admin.v1')),
 action_mode TEXT NOT NULL CHECK(action_mode='single_control'),
 assurance TEXT NOT NULL CHECK(assurance='current_session'), active BOOLEAN NOT NULL,
 valid_from TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL CHECK(expires_at>valid_from),
 issued_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id,revision),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_invoice_draft_grant_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 grant_id UUID NOT NULL, latest_revision BIGINT NOT NULL, advanced_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,grant_id),
 FOREIGN KEY(organization_id,grant_id,latest_revision)
  REFERENCES public.canonical_customer_financial_invoice_draft_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_invoice_draft_origins_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL, estimate_id UUID NOT NULL, customer_id UUID NOT NULL,
 handoff_receipt_id UUID NOT NULL, handoff_receipt_digest CHAR(64) NOT NULL CHECK(handoff_receipt_digest~'^[0-9a-f]{64}$'),
 source_class TEXT NOT NULL CHECK(source_class IN('pre_work_deposit','final_balance')),
 decision_digest CHAR(64) NOT NULL CHECK(decision_digest~'^[0-9a-f]{64}$'),
 commercial_basis_digest CHAR(64) NOT NULL CHECK(commercial_basis_digest~'^[0-9a-f]{64}$'),
 candidate_digest CHAR(64) NOT NULL CHECK(candidate_digest~'^[0-9a-f]{64}$'),
 currency CHAR(3) NOT NULL CHECK(currency='USD'),
 subtotal_before_tax_minor_units BIGINT NOT NULL CHECK(subtotal_before_tax_minor_units BETWEEN 0 AND 10000000),
 origin JSONB NOT NULL, origin_digest CHAR(64) NOT NULL CHECK(origin_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL, actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 capability_grant_id UUID NOT NULL, capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.invoice_draft'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 capture_reason TEXT NOT NULL CHECK(capture_reason=btrim(capture_reason) AND octet_length(capture_reason) BETWEEN 12 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m27-invoice-draft-origin-capture-v1'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,handoff_receipt_id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,customer_id) REFERENCES public.canonical_customers(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,handoff_receipt_id) REFERENCES public.canonical_customer_financial_billable_handoff_receipts_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_invoice_draft_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_invoice_draft_origin_requests_v1 (
 organization_id UUID NOT NULL, actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 origin_id UUID NOT NULL, response_status INTEGER NOT NULL CHECK(response_status IN(200,201)),
 response_digest CHAR(64) NOT NULL CHECK(response_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_customer_financial_invoice_draft_origins_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

DO $policy$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_customer_financial_invoice_draft_grants_v1',
  'canonical_customer_financial_invoice_draft_grant_heads_v1',
  'canonical_customer_financial_invoice_draft_origins_v1',
  'canonical_customer_financial_invoice_draft_origin_requests_v1'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass)))',
   table_name||'_owner_only',table_name,'public.'||table_name,'public.'||table_name);
 END LOOP;
END $policy$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_grant_head()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_customer_financial_invoice_draft_grants_v1%ROWTYPE; current_revision BIGINT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':invoice-draft-grant:'||NEW.id::text,0));
 SELECT * INTO prior FROM public.canonical_customer_financial_invoice_draft_grants_v1
  WHERE organization_id=NEW.organization_id AND id=NEW.id AND revision<NEW.revision
  ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF prior.id IS NULL AND NEW.revision<>1 THEN RAISE EXCEPTION 'Invoice-draft grant must begin at revision one' USING ERRCODE='23514'; END IF;
 IF prior.id IS NOT NULL AND (prior.actor_user_id,prior.membership_id,prior.estimate_id,prior.capability,
  prior.target_class,prior.business_purpose,prior.policy_version,rtrim(prior.policy_digest),prior.template_version,
  prior.action_mode,prior.assurance) IS DISTINCT FROM (NEW.actor_user_id,NEW.membership_id,NEW.estimate_id,NEW.capability,
  NEW.target_class,NEW.business_purpose,NEW.policy_version,rtrim(NEW.policy_digest),NEW.template_version,
  NEW.action_mode,NEW.assurance) THEN
  RAISE EXCEPTION 'Invoice-draft grant identity cannot change' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':invoice-draft-grant-scope:'||NEW.actor_user_id::text||':'||NEW.estimate_id::text,0));
 SELECT latest_revision INTO current_revision FROM public.canonical_customer_financial_invoice_draft_grant_heads_v1
  WHERE organization_id=NEW.organization_id AND grant_id=NEW.id FOR UPDATE;
 IF current_revision IS NOT NULL AND NEW.revision<=current_revision THEN
  RAISE EXCEPTION 'Invoice-draft grant revision is not newer' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_customer_financial_invoice_draft_grant_heads_v1(organization_id,grant_id,latest_revision,advanced_at)
 VALUES(NEW.organization_id,NEW.id,NEW.revision,clock_timestamp()) ON CONFLICT(organization_id,grant_id) DO UPDATE
 SET latest_revision=EXCLUDED.latest_revision,advanced_at=EXCLUDED.advanced_at; RETURN NEW;
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_issue_grant(
 org UUID,grant_value UUID,revision_value BIGINT,actor UUID,membership UUID,estimate_value UUID,
 capability_value TEXT,target_value TEXT,purpose_value TEXT,policy_version_value TEXT,policy_digest_value TEXT,
 template_value TEXT,mode_value TEXT,assurance_value TEXT,active_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF capability_value<>'customer_financial.invoice.edit_draft' OR target_value<>'canonical_estimate' OR
  purpose_value<>'customer_financial.invoice_draft' OR policy_version_value<>'mission27.launch.v1' OR
  policy_digest_value<>'d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a' OR
  template_value NOT IN('m27.owner.v1','m27.admin.v1') OR mode_value<>'single_control' OR
  assurance_value<>'current_session' OR revision_value<1 OR active_value IS NULL THEN
  RAISE EXCEPTION 'Invoice-draft grant issuance restricted' USING ERRCODE='42501'; END IF;
 INSERT INTO public.canonical_customer_financial_invoice_draft_grants_v1(
  organization_id,id,revision,actor_user_id,membership_id,estimate_id,capability,target_class,business_purpose,
  policy_version,policy_digest,template_version,action_mode,assurance,active,valid_from,expires_at,issued_at)
 VALUES(org,grant_value,revision_value,actor,membership,estimate_value,capability_value,target_value,purpose_value,
  policy_version_value,policy_digest_value,template_value,mode_value,assurance_value,active_value,
  clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp());
 RETURN jsonb_build_object('grantId',grant_value,'revision',revision_value);
END $$;

CREATE TRIGGER canonical_customer_financial_invoice_draft_grants_v1_head AFTER INSERT
 ON public.canonical_customer_financial_invoice_draft_grants_v1 FOR EACH ROW
 EXECUTE FUNCTION public.canonical_customer_financial_invoice_draft_v1_grant_head();
DO $immutable$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_customer_financial_invoice_draft_grants_v1',
  'canonical_customer_financial_invoice_draft_origins_v1',
  'canonical_customer_financial_invoice_draft_origin_requests_v1'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable()',table_name||'_immutable',table_name);
 END LOOP;
 EXECUTE 'CREATE TRIGGER canonical_customer_financial_invoice_draft_grant_heads_v1_immutable BEFORE DELETE OR TRUNCATE ON public.canonical_customer_financial_invoice_draft_grant_heads_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable()';
END $immutable$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_access(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,estimate_value UUID,
 grant_value UUID,grant_revision_value BIGINT,write_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_authority JSONB; selected_grant public.canonical_customer_financial_invoice_draft_grants_v1%ROWTYPE;
 candidate_grant public.canonical_customer_financial_invoice_draft_grants_v1%ROWTYPE; candidate_count INTEGER:=0;
BEGIN
 IF role_value NOT IN('owner','admin') OR (write_value AND (csrf IS NULL OR octet_length(csrf)<16)) THEN
  RAISE EXCEPTION 'Invoice-draft access restricted' USING ERRCODE='42501'; END IF;
 IF write_value THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':invoice-draft-grant:'||grant_value::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':invoice-draft-grant-scope:'||actor::text||':'||estimate_value::text,0));
 END IF;
 actor_authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,write_value);
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,write_value) THEN
  RAISE EXCEPTION 'Current invoice-draft entitlement unavailable' USING ERRCODE='42501'; END IF;
 FOR candidate_grant IN SELECT grant_row.*
  FROM public.canonical_customer_financial_invoice_draft_grants_v1 grant_row
  JOIN public.canonical_customer_financial_invoice_draft_grant_heads_v1 head
   ON head.organization_id=grant_row.organization_id AND head.grant_id=grant_row.id AND head.latest_revision=grant_row.revision
  WHERE grant_row.organization_id=org AND grant_row.actor_user_id=actor
   AND grant_row.membership_id=(actor_authority->>'membershipId')::uuid AND grant_row.estimate_id=estimate_value
   AND grant_row.capability='customer_financial.invoice.edit_draft' AND grant_row.target_class='canonical_estimate'
   AND grant_row.business_purpose='customer_financial.invoice_draft' AND grant_row.policy_version='mission27.launch.v1'
   AND rtrim(grant_row.policy_digest)='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'
   AND grant_row.template_version=CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END
   AND grant_row.action_mode='single_control' AND grant_row.assurance='current_session'
   AND grant_row.active AND grant_row.valid_from<=clock_timestamp() AND grant_row.expires_at>clock_timestamp()
   AND (NOT write_value OR (grant_row.id=grant_value AND grant_row.revision=grant_revision_value))
  ORDER BY grant_row.id FOR SHARE OF grant_row,head
 LOOP candidate_count:=candidate_count+1; selected_grant:=candidate_grant; END LOOP;
 IF candidate_count<>1 OR selected_grant.id IS NULL THEN
  RAISE EXCEPTION 'Current invoice-draft capability unavailable' USING ERRCODE='42501'; END IF;
 RETURN actor_authority||jsonb_build_object('capabilityGrantId',selected_grant.id,
  'capabilityGrantRevision',selected_grant.revision,'membershipId',selected_grant.membership_id,
  'policyDigest',rtrim(selected_grant.policy_digest));
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_unavailable(reason_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'contractVersion','m27-invoice-draft-origin-v1','state','unavailable','reason',reason_value,
 'value',NULL,'sourceCurrent',FALSE,'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,
 'issueAuthorized',FALSE,'providerCallCount',0,'receiverMutationCount',0) $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_source(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt_row public.canonical_customer_financial_billable_handoff_receipts_v1%ROWTYPE;
 source_value JSONB; projection JSONB; basis JSONB; item JSONB; payment JSONB;
 lines JSONB:='[]'::jsonb; amount_value BIGINT; item_amount BIGINT; total_value BIGINT:=0;
 item_count INTEGER:=0; ordinal_value INTEGER:=0; description_value TEXT; candidate JSONB;
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
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(basis#>'{customerSafeDocument,charges}','[]'::jsonb)) LOOP
   item_count:=item_count+1; description_value:=btrim(item->>'label');
   IF item_count>24 OR description_value IS NULL OR octet_length(description_value) NOT BETWEEN 1 AND 500 OR
    (item->>'amount')!~'^(0|[1-9][0-9]{0,5})(\.[0-9]{1,2})?$' THEN
    RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('customer_safe_lines_unavailable'); END IF;
   item_amount:=((item->>'amount')::numeric*100)::bigint; total_value:=total_value+item_amount;
   lines:=lines||jsonb_build_array(jsonb_build_object('ordinal',ordinal_value,
    'lineDigest',public.canonical_completion_digest(jsonb_build_object('issuedVersionId',basis#>>'{identity,issuedVersionId}',
     'ordinal',ordinal_value,'description',description_value,'minorUnits',item_amount::text)),
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
  item_count:=1; total_value:=amount_value;
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

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; candidate JSONB; saved public.canonical_customer_financial_invoice_draft_origins_v1%ROWTYPE;
BEGIN
 authority:=public.canonical_customer_financial_invoice_draft_v1_access(
  org,actor,role_value,session_value,NULL,estimate_value,NULL,NULL,FALSE);
 candidate:=public.canonical_customer_financial_invoice_draft_v1_source(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF candidate->>'state'='unavailable' THEN RETURN candidate; END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_draft_origins_v1
  WHERE organization_id=org AND handoff_receipt_id=receipt_value FOR SHARE;
 IF saved.id IS NULL THEN RETURN candidate||jsonb_build_object('contractVersion','m27-invoice-draft-origin-v1',
  'state','ready_to_capture','originId',NULL,'originDigest',NULL); END IF;
 IF rtrim(saved.candidate_digest)<>candidate->>'candidateDigest' THEN
  RETURN public.canonical_customer_financial_invoice_draft_v1_unavailable('saved_origin_source_stale'); END IF;
 RETURN saved.origin;
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_v1_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,request_key TEXT,
 estimate_value UUID,receipt_value UUID,receipt_digest_value TEXT,grant_value UUID,
 grant_revision_value BIGINT,purpose_value TEXT,policy_version_value TEXT,
 expected_candidate_digest TEXT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; candidate JSONB; key_digest TEXT; request_digest_value TEXT; prior RECORD;
 saved public.canonical_customer_financial_invoice_draft_origins_v1%ROWTYPE; origin_id_value UUID;
 created_value TIMESTAMPTZ; origin_base JSONB; origin_value JSONB; origin_digest_value TEXT; inserted_count INTEGER;
BEGIN
 IF request_key IS NULL OR octet_length(request_key) NOT BETWEEN 16 AND 200 OR
  purpose_value<>'customer_financial.invoice_draft' OR policy_version_value<>'mission27.launch.v1' OR
  expected_candidate_digest!~'^[0-9a-f]{64}$' OR reason_value IS NULL OR reason_value<>btrim(reason_value) OR
  octet_length(reason_value) NOT BETWEEN 12 AND 1000 OR confirmation_value<>'m27-invoice-draft-origin-capture-v1' THEN
  RAISE EXCEPTION 'Invoice-draft origin request invalid' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_customer_financial_invoice_draft_v1_access(
  org,actor,role_value,session_value,csrf,estimate_value,grant_value,grant_revision_value,TRUE);
 candidate:=public.canonical_customer_financial_invoice_draft_v1_source(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF candidate->>'state'='unavailable' OR candidate->>'candidateDigest'<>expected_candidate_digest THEN
  RAISE EXCEPTION 'Invoice-draft origin source changed' USING ERRCODE='40001'; END IF;
 key_digest:=encode(sha256(convert_to(request_key,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,
  'actorUserId',actor,'authSessionId',session_value,'estimateId',estimate_value,
  'handoffReceiptId',receipt_value,'handoffReceiptDigest',receipt_digest_value,
  'capabilityGrantId',grant_value,'capabilityGrantRevision',grant_revision_value,
  'businessPurpose',purpose_value,'policyVersion',policy_version_value,
  'expectedCandidateDigest',expected_candidate_digest,'reason',reason_value,
  'confirmationVersion',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':invoice-draft-request:'||actor::text||':'||key_digest,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':invoice-draft-origin:'||receipt_value::text,0));
 SELECT * INTO prior FROM public.canonical_customer_financial_invoice_draft_origin_requests_v1
  WHERE organization_id=org AND actor_user_id=actor AND auth_session_id=session_value
   AND request_key_digest=key_digest FOR SHARE;
 IF prior.request_digest IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_digest_value THEN RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE='23505'; END IF;
  SELECT * INTO saved FROM public.canonical_customer_financial_invoice_draft_origins_v1
   WHERE organization_id=org AND id=prior.origin_id FOR SHARE;
  IF saved.id IS NULL OR rtrim(saved.candidate_digest)<>candidate->>'candidateDigest' THEN
   RAISE EXCEPTION 'Saved invoice-draft origin is stale' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('status',200,'body',saved.origin,'replayed',TRUE);
 END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_draft_origins_v1
  WHERE organization_id=org AND handoff_receipt_id=receipt_value FOR SHARE;
 IF saved.id IS NULL THEN
  origin_id_value:=gen_random_uuid(); created_value:=clock_timestamp();
  origin_base:=(candidate-'candidateDigest')||jsonb_build_object(
   'contractVersion','m27-invoice-draft-origin-v1','state','current','originId',origin_id_value,
   'candidateDigest',candidate->>'candidateDigest','createdAt',
    public.canonical_customer_financial_billing_identity_v1_utc(created_value),
   'authority',jsonb_build_object('capability','customer_financial.invoice.edit_draft',
    'businessPurpose',purpose_value,'policyVersion',policy_version_value,
    'policyDigest',authority->>'policyDigest','capabilityGrantId',grant_value,
    'capabilityGrantRevision',grant_revision_value));
  origin_digest_value:=public.canonical_completion_digest(origin_base);
  origin_value:=origin_base||jsonb_build_object('originDigest',origin_digest_value);
  INSERT INTO public.canonical_customer_financial_invoice_draft_origins_v1(
   organization_id,id,estimate_id,customer_id,handoff_receipt_id,handoff_receipt_digest,source_class,
   decision_digest,commercial_basis_digest,candidate_digest,currency,subtotal_before_tax_minor_units,
   origin,origin_digest,actor_user_id,actor_access_role,membership_id,auth_session_id,
   capability_grant_id,capability_grant_revision,business_purpose,policy_version,policy_digest,
   capture_reason,confirmation_version,created_at)
  VALUES(org,origin_id_value,estimate_value,(candidate->>'customerId')::uuid,receipt_value,receipt_digest_value,
   candidate->>'sourceClass',candidate->>'decisionDigest',candidate->>'commercialBasisDigest',
   candidate->>'candidateDigest','USD',(candidate#>>'{subtotalBeforeTax,minorUnits}')::bigint,
   origin_value,origin_digest_value,actor,role_value,(authority->>'membershipId')::uuid,session_value,
   grant_value,grant_revision_value,purpose_value,policy_version_value,authority->>'policyDigest',
   reason_value,confirmation_value,created_value) RETURNING * INTO saved;
  inserted_count:=1;
 ELSE
  IF rtrim(saved.candidate_digest)<>candidate->>'candidateDigest' THEN
   RAISE EXCEPTION 'Existing invoice-draft origin conflict' USING ERRCODE='40001'; END IF;
  inserted_count:=0;
 END IF;
 INSERT INTO public.canonical_customer_financial_invoice_draft_origin_requests_v1(
  organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,origin_id,
  response_status,response_digest,created_at)
 VALUES(org,actor,session_value,key_digest,request_digest_value,saved.id,
  CASE WHEN inserted_count=1 THEN 201 ELSE 200 END,rtrim(saved.origin_digest),clock_timestamp());
 RETURN jsonb_build_object('status',CASE WHEN inserted_count=1 THEN 201 ELSE 200 END,
  'body',saved.origin,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_invoice_draft_grants_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_invoice_draft_grant_heads_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_invoice_draft_origins_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_invoice_draft_origin_requests_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_grant_head() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_issue_grant(UUID,UUID,BIGINT,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_access(UUID,UUID,TEXT,UUID,TEXT,UUID,UUID,BIGINT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_unavailable(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_source(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,TEXT,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) TO northstar_app_runtime;
END IF; END $$;
