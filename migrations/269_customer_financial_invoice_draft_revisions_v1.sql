-- Mission 27 Part 4B: owner/admin wording, grouping and allocation edits over
-- one exact-current Part 4A invoice-draft origin.  Revisions are append-only;
-- their fully recalculated subtotal must preserve the accepted Mission 24
-- commercial total.  No invoice, approval, receivable or external effect is
-- created here.

CREATE TABLE public.canonical_customer_financial_invoice_draft_revisions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 origin_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 estimate_id UUID NOT NULL, draft JSONB NOT NULL,
 draft_digest CHAR(64) NOT NULL CHECK(draft_digest~'^[0-9a-f]{64}$'),
 history_chain_digest CHAR(64) NOT NULL CHECK(history_chain_digest~'^[0-9a-f]{64}$'),
 line_count INTEGER NOT NULL CHECK(line_count BETWEEN 1 AND 24),
 subtotal_before_tax_minor_units BIGINT NOT NULL CHECK(subtotal_before_tax_minor_units BETWEEN 0 AND 10000000),
 actor_user_id UUID NOT NULL, actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 capability_grant_id UUID NOT NULL, capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.invoice_draft'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 reason TEXT NOT NULL CHECK(reason=btrim(reason) AND octet_length(reason) BETWEEN 12 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m27-invoice-draft-revision-save-v1'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,origin_id,revision),
 UNIQUE(organization_id,origin_id,draft_digest),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_customer_financial_invoice_draft_origins_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_invoice_draft_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_customer_financial_invoice_draft_revision_requests_v1 (
 organization_id UUID NOT NULL, actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 origin_id UUID NOT NULL, revision BIGINT NOT NULL,
 response_digest CHAR(64) NOT NULL CHECK(response_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest),
 FOREIGN KEY(organization_id,origin_id,revision)
  REFERENCES public.canonical_customer_financial_invoice_draft_revisions_v1(organization_id,origin_id,revision) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

DO $policy$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_customer_financial_invoice_draft_revisions_v1',
  'canonical_customer_financial_invoice_draft_revision_requests_v1'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass)))',
   table_name||'_owner_only',table_name,'public.'||table_name,'public.'||table_name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable()',table_name||'_immutable',table_name);
 END LOOP;
END $policy$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_unavailable(reason_value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'contractVersion','m27-invoice-draft-revision-v1','state','unavailable','reason',reason_value,
 'value',NULL,'sourceCurrent',FALSE,'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,
 'issueAuthorized',FALSE,'providerCallCount',0,'receiverMutationCount',0) $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(value_minor BIGINT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object(
 'version','m27-exact-money-v1','currency','USD','minorUnitExponent',2,'minorUnits',value_minor::text,
 'decimal',to_char(value_minor/100.0,'FM999999999999990.00'),'exactZero',value_minor=0) $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_build(
 saved public.canonical_customer_financial_invoice_draft_origins_v1,edit_value JSONB,revision_value BIGINT,
 reason_value TEXT,created_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_line JSONB; edit_line JSONB; lines_value JSONB:='[]'::jsonb; ordinal_value INTEGER;
 source_count INTEGER; edit_count INTEGER; allocation BIGINT; total_value BIGINT:=0; draft_base JSONB;
 expected_keys TEXT[]:=ARRAY['contractVersion','lines','originDigest','originId'];
 expected_line_keys TEXT[]:=ARRAY['allocatedMinorUnits','description','group','ordinal','sourceLineDigest'];
BEGIN
 IF edit_value IS NULL OR jsonb_typeof(edit_value)<>'object' OR
  NOT edit_value ?& expected_keys OR edit_value-expected_keys<>'{}'::jsonb OR
  edit_value->>'contractVersion'<>'m27-invoice-draft-edit-v1' OR
  edit_value->>'originId'<>saved.id::text OR edit_value->>'originDigest'<>rtrim(saved.origin_digest) OR
  jsonb_typeof(edit_value->'lines')<>'array' THEN
  RAISE EXCEPTION 'Invoice-draft edit shape invalid' USING ERRCODE='22023'; END IF;
 source_count:=jsonb_array_length(saved.origin->'lines'); edit_count:=jsonb_array_length(edit_value->'lines');
 IF source_count NOT BETWEEN 1 AND 24 OR edit_count<>source_count THEN
  RAISE EXCEPTION 'Invoice-draft lines must preserve exact source coverage' USING ERRCODE='22023'; END IF;
 FOR ordinal_value IN 0..source_count-1 LOOP
  source_line:=saved.origin->'lines'->ordinal_value; edit_line:=edit_value->'lines'->ordinal_value;
  IF jsonb_typeof(edit_line)<>'object' OR NOT edit_line ?& expected_line_keys OR
   edit_line-expected_line_keys<>'{}'::jsonb OR (edit_line->>'ordinal')::integer<>ordinal_value OR
   edit_line->>'sourceLineDigest'<>source_line->>'lineDigest' OR
   edit_line->>'group' IS NULL OR edit_line->>'group'<>btrim(edit_line->>'group') OR
   octet_length(edit_line->>'group') NOT BETWEEN 1 AND 120 OR
   edit_line->>'description' IS NULL OR edit_line->>'description'<>btrim(edit_line->>'description') OR
   octet_length(edit_line->>'description') NOT BETWEEN 1 AND 500 OR
   edit_line->>'allocatedMinorUnits' IS NULL OR
   edit_line->>'allocatedMinorUnits' !~ '^(0|[1-9][0-9]{0,7})$' THEN
   RAISE EXCEPTION 'Invoice-draft line invalid' USING ERRCODE='22023'; END IF;
  allocation:=(edit_line->>'allocatedMinorUnits')::bigint;
  IF allocation>10000000 THEN RAISE EXCEPTION 'Invoice-draft allocation out of bounds' USING ERRCODE='22023'; END IF;
  total_value:=total_value+allocation;
  lines_value:=lines_value||jsonb_build_array(jsonb_build_object('ordinal',ordinal_value,
   'sourceLineDigest',source_line->>'lineDigest','group',edit_line->>'group',
   'description',edit_line->>'description','quantity',source_line->'quantity',
   'allocatedAmount',public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(allocation)));
 END LOOP;
 IF total_value<>saved.subtotal_before_tax_minor_units THEN
  RAISE EXCEPTION 'Invoice-draft revision cannot change accepted commercial total' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT item->>'sourceLineDigest') FROM jsonb_array_elements(lines_value) item)<>source_count THEN
  RAISE EXCEPTION 'Invoice-draft source-line identity repeated' USING ERRCODE='22023'; END IF;
 draft_base:=jsonb_build_object('contractVersion','m27-invoice-draft-revision-v1','state','current',
  'originId',saved.id,'originDigest',rtrim(saved.origin_digest),'candidateDigest',rtrim(saved.candidate_digest),
  'revision',revision_value,'currency','USD','lines',lines_value,
  'subtotalBeforeTax',public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(total_value),
  'sourceCurrent',TRUE,'invoiceAuthorized',FALSE,'receivableAuthorized',FALSE,'issueAuthorized',FALSE,
  'providerCallCount',0,'receiverMutationCount',0);
 RETURN draft_base||jsonb_build_object('draftDigest',public.canonical_completion_digest(draft_base),
  'reason',reason_value,'updatedAt',public.canonical_customer_financial_billing_identity_v1_utc(created_value));
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate JSONB; saved public.canonical_customer_financial_invoice_draft_origins_v1%ROWTYPE;
 latest public.canonical_customer_financial_invoice_draft_revisions_v1%ROWTYPE;
 edit_value JSONB; baseline JSONB; baseline_chain TEXT;
BEGIN
 candidate:=public.canonical_customer_financial_invoice_draft_v1_source(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF candidate->>'state'='unavailable' THEN
  RETURN public.canonical_customer_financial_invoice_draft_revision_v1_unavailable(candidate->>'reason'); END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_draft_origins_v1
  WHERE organization_id=org AND handoff_receipt_id=receipt_value AND estimate_id=estimate_value FOR SHARE;
 IF saved.id IS NULL THEN RETURN public.canonical_customer_financial_invoice_draft_revision_v1_unavailable('invoice_draft_origin_required'); END IF;
 IF rtrim(saved.candidate_digest)<>candidate->>'candidateDigest' OR rtrim(saved.origin_digest)<>saved.origin->>'originDigest' THEN
  RETURN public.canonical_customer_financial_invoice_draft_revision_v1_unavailable('invoice_draft_origin_stale'); END IF;
 SELECT * INTO latest FROM public.canonical_customer_financial_invoice_draft_revisions_v1
  WHERE organization_id=org AND origin_id=saved.id ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF latest.origin_id IS NOT NULL THEN
  RETURN latest.draft||jsonb_build_object('historyChainDigest',rtrim(latest.history_chain_digest)); END IF;
 SELECT jsonb_build_object('contractVersion','m27-invoice-draft-edit-v1','originId',saved.id,
  'originDigest',rtrim(saved.origin_digest),'lines',jsonb_agg(jsonb_build_object(
   'ordinal',(line.ordinal-1)::integer,'sourceLineDigest',line.value->>'lineDigest',
   'group',CASE WHEN line.value->>'kind'='mission24_accepted_deposit' THEN 'Deposit' ELSE 'Services' END,
   'description',line.value->>'description','allocatedMinorUnits',line.value#>>'{lineAmount,minorUnits}')
   ORDER BY line.ordinal)) INTO edit_value
 FROM jsonb_array_elements(saved.origin->'lines') WITH ORDINALITY line(value,ordinal);
 baseline:=public.canonical_customer_financial_invoice_draft_revision_v1_build(
  saved,edit_value,0,'Mission 24 accepted invoice-draft origin',saved.created_at);
 baseline_chain:=public.canonical_completion_digest(jsonb_build_object('previousHistoryDigest',NULL,
  'originId',saved.id,'originDigest',rtrim(saved.origin_digest),'revision',0,
  'draftDigest',baseline->>'draftDigest','revisionClass','source_origin',
  'createdAt',public.canonical_customer_financial_billing_identity_v1_utc(saved.created_at)));
 RETURN baseline||jsonb_build_object('historyChainDigest',baseline_chain);
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,
 receipt_value UUID,receipt_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
BEGIN
 authority:=public.canonical_customer_financial_invoice_draft_v1_access(
  org,actor,role_value,session_value,NULL,estimate_value,NULL,NULL,FALSE);
 RETURN public.canonical_customer_financial_invoice_draft_revision_v1_current(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
END $$;

CREATE FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_save(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,request_key TEXT,
 estimate_value UUID,receipt_value UUID,receipt_digest_value TEXT,grant_value UUID,
 grant_revision_value BIGINT,purpose_value TEXT,policy_version_value TEXT,expected_revision BIGINT,
 expected_draft_digest TEXT,origin_value UUID,edit_value JSONB,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_value JSONB; key_digest TEXT; request_digest_value TEXT; prior RECORD;
 saved public.canonical_customer_financial_invoice_draft_origins_v1%ROWTYPE;
 latest public.canonical_customer_financial_invoice_draft_revisions_v1%ROWTYPE;
 new_revision BIGINT; created_value TIMESTAMPTZ; draft_value JSONB; chain_value TEXT;
 previous_chain TEXT; inserted public.canonical_customer_financial_invoice_draft_revisions_v1%ROWTYPE;
BEGIN
 IF request_key IS NULL OR octet_length(request_key) NOT BETWEEN 16 AND 200 OR
  purpose_value<>'customer_financial.invoice_draft' OR policy_version_value<>'mission27.launch.v1' OR
  expected_revision NOT BETWEEN 0 AND 9007199254740990 OR expected_draft_digest!~'^[0-9a-f]{64}$' OR
  reason_value IS NULL OR reason_value<>btrim(reason_value) OR octet_length(reason_value) NOT BETWEEN 12 AND 1000 OR
  confirmation_value<>'m27-invoice-draft-revision-save-v1' THEN
  RAISE EXCEPTION 'Invoice-draft revision request invalid' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_customer_financial_invoice_draft_v1_access(
  org,actor,role_value,session_value,csrf,estimate_value,grant_value,grant_revision_value,TRUE);
 key_digest:=encode(sha256(convert_to(request_key,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,
  'actorUserId',actor,'authSessionId',session_value,'estimateId',estimate_value,
  'handoffReceiptId',receipt_value,'handoffReceiptDigest',receipt_digest_value,
  'capabilityGrantId',grant_value,'capabilityGrantRevision',grant_revision_value,
  'businessPurpose',purpose_value,'policyVersion',policy_version_value,'expectedRevision',expected_revision,
  'expectedDraftDigest',expected_draft_digest,'originId',origin_value,'edit',edit_value,
  'reason',reason_value,'confirmationVersion',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':invoice-draft-revision-request:'||actor::text||':'||key_digest,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':invoice-draft-revision:'||origin_value::text,0));
 current_value:=public.canonical_customer_financial_invoice_draft_revision_v1_current(
  org,actor,role_value,session_value,estimate_value,receipt_value,receipt_digest_value);
 IF current_value->>'state'<>'current' OR current_value->>'originId'<>origin_value::text THEN
  RAISE EXCEPTION 'Invoice-draft source changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO saved FROM public.canonical_customer_financial_invoice_draft_origins_v1
  WHERE organization_id=org AND id=origin_value AND estimate_id=estimate_value FOR SHARE;
 SELECT * INTO prior FROM public.canonical_customer_financial_invoice_draft_revision_requests_v1
  WHERE organization_id=org AND actor_user_id=actor AND auth_session_id=session_value
   AND request_key_digest=key_digest FOR SHARE;
 IF prior.request_digest IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_digest_value THEN RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE='23505'; END IF;
  IF prior.revision<>(current_value->>'revision')::bigint OR rtrim(prior.response_digest)<>current_value->>'draftDigest' THEN
   RAISE EXCEPTION 'Saved invoice-draft revision is superseded' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('status',200,'body',current_value,'replayed',TRUE);
 END IF;
 IF (current_value->>'revision')::bigint<>expected_revision OR current_value->>'draftDigest'<>expected_draft_digest THEN
  RAISE EXCEPTION 'Invoice-draft revision conflict' USING ERRCODE='40001'; END IF;
 new_revision:=expected_revision+1; created_value:=clock_timestamp();
 draft_value:=public.canonical_customer_financial_invoice_draft_revision_v1_build(
  saved,edit_value,new_revision,reason_value,created_value);
 previous_chain:=current_value->>'historyChainDigest';
 chain_value:=public.canonical_completion_digest(jsonb_build_object('previousHistoryDigest',previous_chain,
  'originId',origin_value,'originDigest',rtrim(saved.origin_digest),'revision',new_revision,
  'draftDigest',draft_value->>'draftDigest','revisionClass','human_revision',
  'actorUserId',actor,'actorAccessRole',role_value,'membershipId',authority->>'membershipId',
  'authSessionId',session_value,'capabilityGrantId',grant_value,
  'capabilityGrantRevision',grant_revision_value,'businessPurpose',purpose_value,
  'policyVersion',policy_version_value,'reason',reason_value,
  'createdAt',public.canonical_customer_financial_billing_identity_v1_utc(created_value)));
 draft_value:=draft_value||jsonb_build_object('historyChainDigest',chain_value);
 INSERT INTO public.canonical_customer_financial_invoice_draft_revisions_v1(
  organization_id,origin_id,revision,estimate_id,draft,draft_digest,history_chain_digest,line_count,
  subtotal_before_tax_minor_units,actor_user_id,actor_access_role,membership_id,auth_session_id,
  capability_grant_id,capability_grant_revision,business_purpose,policy_version,policy_digest,
  reason,confirmation_version,created_at)
 VALUES(org,origin_value,new_revision,estimate_value,draft_value,draft_value->>'draftDigest',chain_value,
  jsonb_array_length(draft_value->'lines'),(draft_value#>>'{subtotalBeforeTax,minorUnits}')::bigint,
  actor,role_value,(authority->>'membershipId')::uuid,session_value,grant_value,grant_revision_value,
  purpose_value,policy_version_value,authority->>'policyDigest',reason_value,confirmation_value,created_value)
 RETURNING * INTO inserted;
 INSERT INTO public.canonical_customer_financial_invoice_draft_revision_requests_v1(
  organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,
  origin_id,revision,response_digest,created_at)
 VALUES(org,actor,session_value,key_digest,request_digest_value,origin_value,new_revision,
  inserted.draft_digest,clock_timestamp());
 RETURN jsonb_build_object('status',201,'body',inserted.draft,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_invoice_draft_revisions_v1,
 public.canonical_customer_financial_invoice_draft_revision_requests_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_unavailable(TEXT),
 public.canonical_customer_financial_invoice_draft_revision_v1_exact_money(BIGINT),
 public.canonical_customer_financial_invoice_draft_revision_v1_build(public.canonical_customer_financial_invoice_draft_origins_v1,JSONB,BIGINT,TEXT,TIMESTAMPTZ),
 public.canonical_customer_financial_invoice_draft_revision_v1_current(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT),
 public.canonical_customer_financial_invoice_draft_revision_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT),
 public.canonical_customer_financial_invoice_draft_revision_v1_save(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,TEXT,UUID,BIGINT,TEXT,TEXT,BIGINT,TEXT,UUID,JSONB,TEXT,TEXT) FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_read(UUID,UUID,TEXT,UUID,UUID,UUID,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_invoice_draft_revision_v1_save(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,TEXT,UUID,BIGINT,TEXT,TEXT,BIGINT,TEXT,UUID,JSONB,TEXT,TEXT) TO northstar_app_runtime;
END IF; END $grant$;
