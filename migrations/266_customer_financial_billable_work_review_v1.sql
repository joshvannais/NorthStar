-- Mission 27 Part 3C: an explicit, capability-authorized human decision over
-- one exact current Part 3 source. It creates no invoice, booking, dispatch,
-- execution, payment, provider request or downstream handoff receipt.

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Billable-work review history is immutable' USING ERRCODE='55000'; END $$;

CREATE TABLE public.canonical_customer_financial_billable_review_grants_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, estimate_id UUID NOT NULL,
 capability TEXT NOT NULL CHECK(capability='customer_financial.billable_work.review'),
 target_class TEXT NOT NULL CHECK(target_class='canonical_estimate'),
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.billable_work_review'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 template_version TEXT NOT NULL CHECK(template_version IN('m27.owner.v1','m27.admin.v1')),
 action_mode TEXT NOT NULL CHECK(action_mode='conditional_dual_control'),
 assurance TEXT NOT NULL CHECK(assurance='recent_auth'), active BOOLEAN NOT NULL,
 valid_from TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL CHECK(expires_at>valid_from),
 issued_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id,revision),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_billable_review_grant_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 grant_id UUID NOT NULL, latest_revision BIGINT NOT NULL, advanced_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,grant_id),
 FOREIGN KEY(organization_id,grant_id,latest_revision)
  REFERENCES public.canonical_customer_financial_billable_review_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_billable_work_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(), estimate_id UUID NOT NULL,
 source_class TEXT NOT NULL CHECK(source_class IN('pre_work_deposit','final_balance')),
 source_identity UUID NOT NULL, work_id UUID,
 source_digest CHAR(64) NOT NULL CHECK(source_digest ~ '^[0-9a-f]{64}$'),
 source_authority_identity UUID NOT NULL,
 source_authority_digest CHAR(64) NOT NULL CHECK(source_authority_digest ~ '^[0-9a-f]{64}$'),
 commercial_basis_digest CHAR(64) NOT NULL CHECK(commercial_basis_digest ~ '^[0-9a-f]{64}$'),
 decision_digest CHAR(64) NOT NULL CHECK(decision_digest ~ '^[0-9a-f]{64}$'),
 currency CHAR(3) NOT NULL CHECK(currency='USD'),
 amount_minor_units BIGINT NOT NULL CHECK(amount_minor_units BETWEEN 0 AND 10000000),
 control_mode TEXT NOT NULL CHECK(control_mode IN('single_control','dual_control')),
 actor_user_id UUID NOT NULL, actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 capability_grant_id UUID NOT NULL, capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.billable_work_review'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 review_reason TEXT NOT NULL CHECK(review_reason=btrim(review_reason) AND octet_length(review_reason) BETWEEN 12 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m27-billable-work-review-v1'),
 reviewed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,estimate_id,decision_digest,actor_user_id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_billable_review_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_billable_review_requests_v1 (
 organization_id UUID NOT NULL, actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest ~ '^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 review_id UUID NOT NULL, response_status INTEGER NOT NULL CHECK(response_status IN(200,201,202)),
 response JSONB NOT NULL, response_digest CHAR(64) NOT NULL CHECK(response_digest ~ '^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest),
 FOREIGN KEY(organization_id,review_id) REFERENCES public.canonical_customer_financial_billable_work_reviews_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

DO $$ DECLARE name TEXT; BEGIN FOREACH name IN ARRAY ARRAY[
 'canonical_customer_financial_billable_review_grants_v1',
 'canonical_customer_financial_billable_review_grant_heads_v1',
 'canonical_customer_financial_billable_work_reviews_v1',
 'canonical_customer_financial_billable_review_requests_v1'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('CREATE POLICY %I ON public.%I USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::pg_catalog.regclass))) WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::pg_catalog.regclass)))',name||'_owner_only',name,'public.'||name,'public.'||name);
 END LOOP; END $$;

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_grant_head()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_customer_financial_billable_review_grants_v1%ROWTYPE; current_revision BIGINT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':billable-review-grant:'||NEW.id::text,0));
 SELECT * INTO prior FROM public.canonical_customer_financial_billable_review_grants_v1
  WHERE organization_id=NEW.organization_id AND id=NEW.id AND revision<NEW.revision ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF prior.id IS NULL AND NEW.revision<>1 THEN RAISE EXCEPTION 'Billable review grant must begin at revision one' USING ERRCODE='23514'; END IF;
 IF prior.id IS NOT NULL AND (prior.actor_user_id,prior.membership_id,prior.estimate_id,prior.capability,
  prior.target_class,prior.business_purpose,prior.policy_version,rtrim(prior.policy_digest),prior.template_version,
  prior.action_mode,prior.assurance) IS DISTINCT FROM (NEW.actor_user_id,NEW.membership_id,NEW.estimate_id,NEW.capability,
  NEW.target_class,NEW.business_purpose,NEW.policy_version,rtrim(NEW.policy_digest),NEW.template_version,NEW.action_mode,NEW.assurance)
 THEN RAISE EXCEPTION 'Billable review grant identity cannot change' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':billable-review-grant-scope:'||NEW.actor_user_id::text||':'||NEW.estimate_id::text,0));
 SELECT latest_revision INTO current_revision FROM public.canonical_customer_financial_billable_review_grant_heads_v1
  WHERE organization_id=NEW.organization_id AND grant_id=NEW.id FOR UPDATE;
 IF current_revision IS NOT NULL AND NEW.revision<=current_revision THEN RAISE EXCEPTION 'Billable review grant revision is not newer' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_customer_financial_billable_review_grant_heads_v1(organization_id,grant_id,latest_revision,advanced_at)
 VALUES(NEW.organization_id,NEW.id,NEW.revision,clock_timestamp()) ON CONFLICT(organization_id,grant_id) DO UPDATE
 SET latest_revision=EXCLUDED.latest_revision,advanced_at=EXCLUDED.advanced_at; RETURN NEW;
END $$;

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_issue_grant(
 org UUID,grant_value UUID,revision_value BIGINT,actor UUID,membership UUID,estimate_value UUID,
 capability_value TEXT,target_value TEXT,purpose_value TEXT,policy_version_value TEXT,policy_digest_value TEXT,
 template_value TEXT,mode_value TEXT,assurance_value TEXT,active_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF capability_value<>'customer_financial.billable_work.review' OR target_value<>'canonical_estimate' OR
  purpose_value<>'customer_financial.billable_work_review' OR policy_version_value<>'mission27.launch.v1' OR
  policy_digest_value<>'d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a' OR
  template_value NOT IN('m27.owner.v1','m27.admin.v1') OR mode_value<>'conditional_dual_control' OR
  assurance_value<>'recent_auth' OR revision_value<1 OR active_value IS NULL THEN
  RAISE EXCEPTION 'Billable review grant issuance restricted' USING ERRCODE='42501'; END IF;
 INSERT INTO public.canonical_customer_financial_billable_review_grants_v1(
  organization_id,id,revision,actor_user_id,membership_id,estimate_id,capability,target_class,business_purpose,
  policy_version,policy_digest,template_version,action_mode,assurance,active,valid_from,expires_at,issued_at)
 VALUES(org,grant_value,revision_value,actor,membership,estimate_value,capability_value,target_value,purpose_value,
  policy_version_value,policy_digest_value,template_value,mode_value,assurance_value,active_value,
  clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp());
 RETURN jsonb_build_object('grantId',grant_value,'revision',revision_value);
END $$;

CREATE TRIGGER canonical_customer_financial_billable_review_grants_v1_head AFTER INSERT
 ON public.canonical_customer_financial_billable_review_grants_v1 FOR EACH ROW
 EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_grant_head();
CREATE TRIGGER canonical_customer_financial_billable_review_grants_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billable_review_grants_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_financial_billable_review_grant_heads_v1_immutable
 BEFORE DELETE OR TRUNCATE ON public.canonical_customer_financial_billable_review_grant_heads_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_financial_billable_work_reviews_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billable_work_reviews_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_financial_billable_review_requests_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billable_review_requests_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_access(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,estimate_value UUID,
 grant_value UUID,grant_revision_value BIGINT,purpose_value TEXT,policy_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_authority JSONB; session_record public.auth_sessions%ROWTYPE;
 grant_record public.canonical_customer_financial_billable_review_grants_v1%ROWTYPE;
BEGIN
 IF role_value NOT IN('owner','admin') OR csrf IS NULL OR octet_length(csrf)<16 OR
  purpose_value<>'customer_financial.billable_work_review' OR policy_version_value<>'mission27.launch.v1' THEN
  RAISE EXCEPTION 'Billable-work review restricted' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billable-review-grant:'||grant_value::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billable-review-grant-scope:'||actor::text||':'||estimate_value::text,0));
 actor_authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Current billable-work entitlement unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO session_record FROM public.auth_sessions WHERE organization_id=org AND user_id=actor AND id=session_value FOR SHARE;
 IF session_record.id IS NULL OR session_record.status<>'active' OR session_record.access_expires_at<=clock_timestamp() OR
  session_record.created_at<clock_timestamp()-INTERVAL '10 minutes' OR
  session_record.csrf_token_hash<>encode(sha256(convert_to(csrf,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Recent authentication required' USING ERRCODE='42501',CONSTRAINT='canonical_billable_review_recent_auth_required'; END IF;
 SELECT grant_row.* INTO grant_record FROM public.canonical_customer_financial_billable_review_grants_v1 grant_row
 JOIN public.canonical_customer_financial_billable_review_grant_heads_v1 head
  ON head.organization_id=grant_row.organization_id AND head.grant_id=grant_row.id AND head.latest_revision=grant_row.revision
 WHERE grant_row.organization_id=org AND grant_row.id=grant_value AND grant_row.revision=grant_revision_value
  AND grant_row.actor_user_id=actor AND grant_row.membership_id=(actor_authority->>'membershipId')::uuid
  AND grant_row.estimate_id=estimate_value AND grant_row.capability='customer_financial.billable_work.review'
  AND grant_row.target_class='canonical_estimate' AND grant_row.business_purpose=purpose_value
  AND grant_row.policy_version=policy_version_value
  AND rtrim(grant_row.policy_digest)='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'
  AND grant_row.template_version=CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END
  AND grant_row.action_mode='conditional_dual_control' AND grant_row.assurance='recent_auth'
  AND grant_row.active AND grant_row.valid_from<=clock_timestamp() AND grant_row.expires_at>clock_timestamp()
 FOR SHARE OF grant_row,head;
 IF grant_record.id IS NULL THEN RAISE EXCEPTION 'Current billable-work capability unavailable' USING ERRCODE='42501'; END IF;
 RETURN actor_authority||jsonb_build_object('capabilityGrantId',grant_record.id,
  'capabilityGrantRevision',grant_record.revision,'policyDigest',rtrim(grant_record.policy_digest),
  'membershipId',grant_record.membership_id);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_projection(
 org UUID,estimate_value UUID,decision_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_record public.canonical_customer_financial_billable_work_reviews_v1%ROWTYPE; approvals JSONB; count_value INTEGER;
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
 RETURN jsonb_build_object('contractVersion','m27-billable-work-review-v1',
  'state',CASE WHEN first_record.control_mode='single_control' OR count_value>=2 THEN 'reviewed_current' ELSE 'independent_review_required' END,
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
  'approvals',approvals,'financialActionAuthorized',FALSE,'invoiceAuthorized',FALSE,
  'handoffReceiptAuthorized',FALSE,'providerCallCount',0,'receiverMutationCount',0);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,decision_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN('owner','admin') OR decision_value!~'^[0-9a-f]{64}$' OR
  NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Billable-work review restricted' USING ERRCODE='42501'; END IF;
 RETURN public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,decision_value);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billable_review_v1_accept(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,request_key TEXT,
 estimate_value UUID,grant_value UUID,grant_revision_value BIGINT,purpose_value TEXT,policy_version_value TEXT,
 source_value JSONB,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; key_digest TEXT; request_digest_value TEXT; prior_request RECORD;
 approval public.canonical_customer_financial_billable_work_reviews_v1%ROWTYPE;
 projection JSONB; status_value INTEGER; count_value INTEGER; amount_value BIGINT; mode_value TEXT;
BEGIN
 IF request_key IS NULL OR octet_length(request_key) NOT BETWEEN 16 AND 200 OR
  confirmation_value<>'m27-billable-work-review-v1' OR reason_value IS NULL OR
  reason_value<>btrim(reason_value) OR octet_length(reason_value) NOT BETWEEN 12 AND 1000 OR
  jsonb_typeof(source_value)<>'object' OR source_value->>'contractVersion'<>'m27-billable-work-review-source-v1' OR
  source_value->>'sourceClass' NOT IN('pre_work_deposit','final_balance') OR
  source_value->>'estimateId'<>estimate_value::text OR source_value->>'sourceCurrent'<>'true' OR
  source_value->>'completionInferred'<>'false' OR source_value->'amount'->>'currency'<>'USD' OR
  source_value->'amount'->>'minorUnits'!~'^(0|[1-9][0-9]{0,7})$' OR
  source_value->>'sourceDigest'!~'^[0-9a-f]{64}$' OR source_value->>'sourceAuthorityDigest'!~'^[0-9a-f]{64}$' OR
  source_value->>'commercialBasisDigest'!~'^[0-9a-f]{64}$' OR source_value->>'decisionDigest'!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Billable-work review invalid' USING ERRCODE='22023'; END IF;
 amount_value:=(source_value->'amount'->>'minorUnits')::bigint;
 mode_value:=CASE WHEN amount_value<=1000000 THEN 'single_control' ELSE 'dual_control' END;
 IF amount_value>10000000 OR source_value->>'controlMode'<>mode_value OR
  (source_value->>'sourceClass'='final_balance' AND (source_value->>'completionClaimed')::boolean IS NOT TRUE) OR
  (source_value->>'sourceClass'='pre_work_deposit' AND (source_value->>'completionClaimed')::boolean IS NOT FALSE) THEN
  RAISE EXCEPTION 'Billable-work review source invalid' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_customer_financial_billable_review_v1_access(org,actor,role_value,session_value,csrf,
  estimate_value,grant_value,grant_revision_value,purpose_value,policy_version_value);
 key_digest:=encode(sha256(convert_to(request_key,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'authSessionId',session_value,'estimateId',estimate_value,'capabilityGrantId',grant_value,
  'capabilityGrantRevision',grant_revision_value,'source',source_value,'reason',reason_value,
  'confirmationVersion',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billable-review-request:'||actor::text||':'||key_digest,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billable-review-decision:'||estimate_value::text||':'||(source_value->>'decisionDigest'),0));
 SELECT * INTO prior_request FROM public.canonical_customer_financial_billable_review_requests_v1
  WHERE organization_id=org AND actor_user_id=actor AND auth_session_id=session_value AND request_key_digest=key_digest FOR SHARE;
 IF prior_request.request_digest IS NOT NULL THEN
  IF rtrim(prior_request.request_digest)<>request_digest_value THEN RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE='23505'; END IF;
  projection:=public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,source_value->>'decisionDigest');
  IF projection IS NULL THEN RAISE EXCEPTION 'Billable-work review changed' USING ERRCODE='40001'; END IF;
  status_value:=CASE WHEN projection->>'state'='reviewed_current' THEN 201 ELSE 202 END;
  RETURN jsonb_build_object('status',status_value,'body',projection,'replayed',TRUE);
 END IF;
 SELECT count(*)::integer INTO count_value FROM public.canonical_customer_financial_billable_work_reviews_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND decision_digest=source_value->>'decisionDigest';
 IF count_value>0 AND mode_value='single_control' THEN RAISE EXCEPTION 'Billable-work source already reviewed' USING ERRCODE='23505'; END IF;
 IF count_value>=2 THEN RAISE EXCEPTION 'Billable-work source already fully reviewed' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_customer_financial_billable_work_reviews_v1(
  organization_id,estimate_id,source_class,source_identity,work_id,source_digest,source_authority_identity,
  source_authority_digest,commercial_basis_digest,decision_digest,currency,amount_minor_units,control_mode,
  actor_user_id,actor_access_role,membership_id,auth_session_id,capability_grant_id,capability_grant_revision,
  business_purpose,policy_version,policy_digest,review_reason,confirmation_version,reviewed_at)
 VALUES(org,estimate_value,source_value->>'sourceClass',(source_value->>'sourceIdentity')::uuid,
  NULLIF(source_value->>'workId','')::uuid,source_value->>'sourceDigest',(source_value->>'sourceAuthorityIdentity')::uuid,
  source_value->>'sourceAuthorityDigest',source_value->>'commercialBasisDigest',source_value->>'decisionDigest','USD',
  amount_value,mode_value,actor,role_value,(authority->>'membershipId')::uuid,session_value,grant_value,
  grant_revision_value,purpose_value,policy_version_value,authority->>'policyDigest',reason_value,confirmation_value,
  clock_timestamp()) RETURNING * INTO approval;
 projection:=public.canonical_customer_financial_billable_review_v1_projection(org,estimate_value,source_value->>'decisionDigest');
 status_value:=CASE WHEN projection->>'state'='reviewed_current' THEN 201 ELSE 202 END;
 INSERT INTO public.canonical_customer_financial_billable_review_requests_v1(
  organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,review_id,response_status,
  response,response_digest,created_at) VALUES(org,actor,session_value,key_digest,request_digest_value,approval.id,
  status_value,projection,public.canonical_completion_digest(projection),approval.reviewed_at);
 RETURN jsonb_build_object('status',status_value,'body',projection,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_billable_review_grants_v1,
 public.canonical_customer_financial_billable_review_grant_heads_v1,
 public.canonical_customer_financial_billable_work_reviews_v1,
 public.canonical_customer_financial_billable_review_requests_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billable_review_v1_immutable(),
 public.canonical_customer_financial_billable_review_v1_grant_head(),
 public.canonical_customer_financial_billable_review_v1_issue_grant(UUID,UUID,BIGINT,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),
 public.canonical_customer_financial_billable_review_v1_access(UUID,UUID,TEXT,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT),
 public.canonical_customer_financial_billable_review_v1_projection(UUID,UUID,TEXT),
 public.canonical_customer_financial_billable_review_v1_read(UUID,UUID,TEXT,UUID,UUID,TEXT),
 public.canonical_customer_financial_billable_review_v1_accept(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,JSONB,TEXT,TEXT)
 FROM PUBLIC;

-- Additive Q6: one current editable view of the canonical Mission 24 estimate,
-- exact multi-option proposal reviews, and explicit value-free signature/handoff
-- boundaries. Part 3D owns append-only human-edit history; this slice does not
-- create a second estimate, customer, appointment, work, invoice, or provider act.

CREATE TABLE public.canonical_customer_financial_estimate_journey_grants_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, estimate_id UUID NOT NULL,
 capability TEXT NOT NULL CHECK(capability IN(
  'customer_financial.estimate.edit_draft','customer_financial.estimate.edit_options',
  'customer_financial.estimate.request_signature','customer_financial.estimate.review_signature',
  'customer_financial.estimate.request_work_handoff')),
 target_class TEXT NOT NULL CHECK(target_class='canonical_estimate'),
 business_purpose TEXT NOT NULL CHECK(business_purpose IN(
  'customer_financial.polaris_quote_draft','customer_financial.polaris_quote_options',
  'customer_financial.polaris_quote_signature_request','customer_financial.polaris_quote_signature_review',
  'customer_financial.polaris_quote_work_handoff')),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 template_version TEXT NOT NULL CHECK(template_version IN('m27.owner.v1','m27.admin.v1')),
 action_mode TEXT NOT NULL CHECK(action_mode IN('single_control','conditional_dual_control')),
 assurance TEXT NOT NULL CHECK(assurance IN('current_session','recent_auth')),
 active BOOLEAN NOT NULL, valid_from TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL CHECK(expires_at>valid_from), issued_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id,revision),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_estimate_journey_grant_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 capability_grant_id UUID NOT NULL, latest_revision BIGINT NOT NULL CHECK(latest_revision BETWEEN 1 AND 9007199254740991),
 advanced_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(organization_id,capability_grant_id),
 FOREIGN KEY(organization_id,capability_grant_id,latest_revision)
  REFERENCES public.canonical_customer_financial_estimate_journey_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_estimate_journey_drafts_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 estimate_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 draft JSONB NOT NULL, draft_digest CHAR(64) NOT NULL CHECK(draft_digest~'^[0-9a-f]{64}$'),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 source_revision_digest CHAR(64) NOT NULL CHECK(source_revision_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL, actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL, capability_grant_id UUID NOT NULL, capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL, policy_version TEXT NOT NULL, policy_digest CHAR(64) NOT NULL,
 reason TEXT NOT NULL CHECK(octet_length(reason) BETWEEN 12 AND 1000), updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,estimate_id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_estimate_journey_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_estimate_proposal_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(), estimate_id UUID NOT NULL, proposal_id UUID NOT NULL,
 proposal_revision BIGINT NOT NULL CHECK(proposal_revision BETWEEN 1 AND 9007199254740991),
 proposal_digest CHAR(64) NOT NULL CHECK(proposal_digest~'^[0-9a-f]{64}$'),
 draft_revision BIGINT NOT NULL, draft_digest CHAR(64) NOT NULL CHECK(draft_digest~'^[0-9a-f]{64}$'),
 total_minor_units BIGINT NOT NULL CHECK(total_minor_units BETWEEN 0 AND 10000000),
 control_mode TEXT NOT NULL CHECK(control_mode IN('single_control','dual_control')),
 actor_user_id UUID NOT NULL, actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL, capability_grant_id UUID NOT NULL,
 capability_grant_revision BIGINT NOT NULL, reason TEXT NOT NULL CHECK(octet_length(reason) BETWEEN 12 AND 1000),
 reviewed_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,proposal_digest,actor_user_id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_estimate_journey_grants_v1(organization_id,id,revision) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_estimate_multi_option_proposals_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL, estimate_id UUID NOT NULL, revision BIGINT NOT NULL,
 proposal JSONB NOT NULL, proposal_digest CHAR(64) NOT NULL CHECK(proposal_digest~'^[0-9a-f]{64}$'),
 draft_revision BIGINT NOT NULL, draft_digest CHAR(64) NOT NULL CHECK(draft_digest~'^[0-9a-f]{64}$'),
 required_approval_count INTEGER NOT NULL CHECK(required_approval_count IN(1,2)),
 created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(organization_id,id,revision),
 UNIQUE(organization_id,proposal_digest),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.canonical_customer_financial_estimate_journey_requests_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL, request_key_digest CHAR(64) NOT NULL,
 request_digest CHAR(64) NOT NULL, action TEXT NOT NULL CHECK(action IN('save_draft','request_proposal')),
 response_status INTEGER NOT NULL CHECK(response_status IN(200,201,202)), response JSONB NOT NULL,
 response_digest CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest)
);

DO $policy$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_customer_financial_estimate_journey_grants_v1',
  'canonical_customer_financial_estimate_journey_grant_heads_v1',
  'canonical_customer_financial_estimate_journey_drafts_v1',
  'canonical_customer_estimate_proposal_reviews_v1',
  'canonical_customer_estimate_multi_option_proposals_v1',
  'canonical_customer_financial_estimate_journey_requests_v1']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON public.%I USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass)))',
   table_name||'_owner_only',table_name,'public.'||table_name,'public.'||table_name);
 END LOOP;
END $policy$;

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_grant_head()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE previous public.canonical_customer_financial_estimate_journey_grants_v1%ROWTYPE; current_revision BIGINT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':estimate-journey-grant:'||NEW.id::text,0));
 SELECT * INTO previous FROM public.canonical_customer_financial_estimate_journey_grants_v1
  WHERE organization_id=NEW.organization_id AND id=NEW.id AND revision<NEW.revision
  ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF previous.id IS NULL AND NEW.revision<>1 THEN RAISE EXCEPTION 'Grant must begin at revision one' USING ERRCODE='23514'; END IF;
 IF previous.id IS NOT NULL AND (previous.actor_user_id,previous.membership_id,previous.estimate_id,
  previous.capability,previous.target_class,previous.business_purpose,previous.policy_version,rtrim(previous.policy_digest),
  previous.template_version,previous.action_mode,previous.assurance) IS DISTINCT FROM
 (NEW.actor_user_id,NEW.membership_id,NEW.estimate_id,NEW.capability,NEW.target_class,NEW.business_purpose,
  NEW.policy_version,rtrim(NEW.policy_digest),NEW.template_version,NEW.action_mode,NEW.assurance) THEN
  RAISE EXCEPTION 'Grant identity cannot change' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':estimate-journey-scope:'||
  NEW.actor_user_id::text||':'||NEW.estimate_id::text||':'||NEW.capability,0));
 IF NEW.active AND EXISTS(
  SELECT 1 FROM public.canonical_customer_financial_estimate_journey_grants_v1 grant_entry
  JOIN public.canonical_customer_financial_estimate_journey_grant_heads_v1 head
   ON head.organization_id=grant_entry.organization_id AND head.capability_grant_id=grant_entry.id
   AND head.latest_revision=grant_entry.revision
  WHERE grant_entry.organization_id=NEW.organization_id AND grant_entry.actor_user_id=NEW.actor_user_id
   AND grant_entry.membership_id=NEW.membership_id AND grant_entry.estimate_id=NEW.estimate_id
   AND grant_entry.capability=NEW.capability AND grant_entry.id<>NEW.id AND grant_entry.active
   AND grant_entry.valid_from<=clock_timestamp() AND grant_entry.expires_at>clock_timestamp()
 ) THEN RAISE EXCEPTION 'A current grant already owns this estimate journey scope' USING ERRCODE='23505'; END IF;
 SELECT latest_revision INTO current_revision FROM public.canonical_customer_financial_estimate_journey_grant_heads_v1
  WHERE organization_id=NEW.organization_id AND capability_grant_id=NEW.id FOR UPDATE;
 IF current_revision IS NOT NULL AND NEW.revision<=current_revision THEN RAISE EXCEPTION 'Grant revision is not newer' USING ERRCODE='23505'; END IF;
 INSERT INTO public.canonical_customer_financial_estimate_journey_grant_heads_v1 VALUES(
  NEW.organization_id,NEW.id,NEW.revision,clock_timestamp())
 ON CONFLICT(organization_id,capability_grant_id) DO UPDATE SET latest_revision=EXCLUDED.latest_revision,advanced_at=EXCLUDED.advanced_at;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_customer_financial_estimate_journey_grants_v1_head AFTER INSERT
 ON public.canonical_customer_financial_estimate_journey_grants_v1 FOR EACH ROW
 EXECUTE FUNCTION public.canonical_customer_financial_estimate_journey_v1_grant_head();
CREATE TRIGGER canonical_customer_financial_estimate_journey_grants_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_customer_financial_estimate_journey_grants_v1 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_financial_estimate_journey_grant_heads_v1_immutable BEFORE DELETE OR TRUNCATE
 ON public.canonical_customer_financial_estimate_journey_grant_heads_v1 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_estimate_proposal_reviews_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_customer_estimate_proposal_reviews_v1 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_estimate_multi_option_proposals_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_customer_estimate_multi_option_proposals_v1 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_financial_estimate_journey_requests_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_customer_financial_estimate_journey_requests_v1 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();
CREATE TRIGGER canonical_customer_financial_estimate_journey_drafts_v1_no_delete BEFORE DELETE OR TRUNCATE
 ON public.canonical_customer_financial_estimate_journey_drafts_v1 FOR EACH STATEMENT
 EXECUTE FUNCTION public.canonical_customer_financial_billable_review_v1_immutable();

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_issue_grant(
 org UUID,grant_value UUID,revision_value BIGINT,actor UUID,membership UUID,estimate_value UUID,
 capability_value TEXT,target_class_value TEXT,purpose_value TEXT,policy_version_value TEXT,
 policy_digest_value TEXT,template_value TEXT,action_mode_value TEXT,assurance_value TEXT,active_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE role_value TEXT; expected_purpose TEXT; expected_mode TEXT; expected_assurance TEXT;
BEGIN
 expected_purpose:=CASE capability_value
  WHEN 'customer_financial.estimate.edit_draft' THEN 'customer_financial.polaris_quote_draft'
  WHEN 'customer_financial.estimate.edit_options' THEN 'customer_financial.polaris_quote_options'
  WHEN 'customer_financial.estimate.request_signature' THEN 'customer_financial.polaris_quote_signature_request'
  WHEN 'customer_financial.estimate.review_signature' THEN 'customer_financial.polaris_quote_signature_review'
  WHEN 'customer_financial.estimate.request_work_handoff' THEN 'customer_financial.polaris_quote_work_handoff' END;
 expected_mode:=CASE WHEN capability_value IN('customer_financial.estimate.request_signature','customer_financial.estimate.request_work_handoff') THEN 'conditional_dual_control' ELSE 'single_control' END;
 expected_assurance:=CASE WHEN capability_value IN('customer_financial.estimate.edit_draft','customer_financial.estimate.edit_options') THEN 'current_session' ELSE 'recent_auth' END;
 SELECT role INTO role_value FROM public.organization_memberships
  WHERE organization_id=org AND id=membership AND user_id=actor AND status='active' FOR SHARE;
 IF org IS NULL OR grant_value IS NULL OR revision_value<1 OR role_value NOT IN('owner','admin') OR
  expected_purpose IS NULL OR purpose_value<>expected_purpose OR target_class_value<>'canonical_estimate' OR
  policy_version_value<>'mission27.launch.v1' OR policy_digest_value<>'d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a' OR
  template_value<>(CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END) OR
  action_mode_value<>expected_mode OR assurance_value<>expected_assurance OR active_value IS NULL THEN
  RAISE EXCEPTION 'Estimate journey capability issuance restricted' USING ERRCODE='42501'; END IF;
 INSERT INTO public.canonical_customer_financial_estimate_journey_grants_v1(
  organization_id,id,revision,actor_user_id,membership_id,estimate_id,capability,target_class,business_purpose,
  policy_version,policy_digest,template_version,action_mode,assurance,active,valid_from,expires_at,issued_at)
 VALUES(org,grant_value,revision_value,actor,membership,estimate_value,capability_value,target_class_value,purpose_value,
  policy_version_value,policy_digest_value,template_value,action_mode_value,assurance_value,active_value,
  clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp());
 RETURN jsonb_build_object('grantId',grant_value,'revision',revision_value);
END $$;

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_access(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,estimate_value UUID,
 grant_value UUID,grant_revision_value BIGINT,capability_value TEXT,purpose_value TEXT,policy_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_authority JSONB; grant_row public.canonical_customer_financial_estimate_journey_grants_v1%ROWTYPE;
 head_revision BIGINT; auth_time TIMESTAMPTZ; expected_purpose TEXT; expected_mode TEXT; expected_assurance TEXT;
BEGIN
 actor_authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 expected_purpose:=CASE capability_value
  WHEN 'customer_financial.estimate.edit_draft' THEN 'customer_financial.polaris_quote_draft'
  WHEN 'customer_financial.estimate.edit_options' THEN 'customer_financial.polaris_quote_options'
  WHEN 'customer_financial.estimate.request_signature' THEN 'customer_financial.polaris_quote_signature_request'
  WHEN 'customer_financial.estimate.review_signature' THEN 'customer_financial.polaris_quote_signature_review'
  WHEN 'customer_financial.estimate.request_work_handoff' THEN 'customer_financial.polaris_quote_work_handoff' END;
 expected_mode:=CASE WHEN capability_value IN('customer_financial.estimate.request_signature',
  'customer_financial.estimate.request_work_handoff') THEN 'conditional_dual_control' ELSE 'single_control' END;
 expected_assurance:=CASE WHEN capability_value IN('customer_financial.estimate.edit_draft',
  'customer_financial.estimate.edit_options') THEN 'current_session' ELSE 'recent_auth' END;
 IF role_value NOT IN('owner','admin') OR NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Estimate journey restricted' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':estimate-journey-grant:'||grant_value::text,0));
 SELECT grant_entry.* INTO grant_row
 FROM public.canonical_customer_financial_estimate_journey_grants_v1 grant_entry
 JOIN public.canonical_customer_financial_estimate_journey_grant_heads_v1 head
  ON head.organization_id=grant_entry.organization_id AND head.capability_grant_id=grant_entry.id
 WHERE grant_entry.organization_id=org AND grant_entry.id=grant_value AND grant_entry.revision=grant_revision_value FOR SHARE;
 SELECT latest_revision INTO head_revision FROM public.canonical_customer_financial_estimate_journey_grant_heads_v1
  WHERE organization_id=org AND capability_grant_id=grant_value FOR SHARE;
 IF grant_row.id IS NULL OR head_revision<>grant_revision_value OR grant_row.actor_user_id<>actor OR
  grant_row.membership_id<>(actor_authority->>'membershipId')::uuid OR grant_row.estimate_id<>estimate_value OR
  grant_row.capability<>capability_value OR expected_purpose IS NULL OR grant_row.business_purpose<>expected_purpose OR
  purpose_value<>expected_purpose OR grant_row.target_class<>'canonical_estimate' OR
  grant_row.policy_version<>'mission27.launch.v1' OR policy_version_value<>'mission27.launch.v1' OR
  rtrim(grant_row.policy_digest)<>'d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a' OR
  grant_row.template_version<>(CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END) OR
  grant_row.action_mode<>expected_mode OR grant_row.assurance<>expected_assurance OR grant_row.active IS NOT TRUE OR
  grant_row.valid_from>clock_timestamp() OR grant_row.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Current estimate journey capability unavailable' USING ERRCODE='42501'; END IF;
 IF grant_row.assurance='recent_auth' THEN
  SELECT created_at INTO auth_time FROM public.auth_sessions WHERE id=session_value AND user_id=actor FOR SHARE;
  IF auth_time IS NULL OR auth_time<clock_timestamp()-INTERVAL '600 seconds' THEN
   RAISE EXCEPTION 'Recent authentication required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN jsonb_build_object('membershipId',grant_row.membership_id,'policyDigest',rtrim(grant_row.policy_digest));
END $$;

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE draft_row RECORD; proposal_row RECORD; pending_row RECORD; capability_rows JSONB; actor_authority JSONB;
BEGIN
 actor_authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN('owner','admin') OR NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
 RAISE EXCEPTION 'Estimate journey restricted' USING ERRCODE='42501'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.canonical_customer_financial_estimate_journey_grants_v1 grant_entry
  JOIN public.canonical_customer_financial_estimate_journey_grant_heads_v1 head
   ON head.organization_id=grant_entry.organization_id AND head.capability_grant_id=grant_entry.id
   AND head.latest_revision=grant_entry.revision
  WHERE grant_entry.organization_id=org AND grant_entry.actor_user_id=actor
   AND grant_entry.membership_id=(actor_authority->>'membershipId')::uuid
   AND grant_entry.estimate_id=estimate_value AND grant_entry.active=TRUE
   AND grant_entry.valid_from<=clock_timestamp() AND grant_entry.expires_at>clock_timestamp()
  GROUP BY grant_entry.capability HAVING count(*)>1
 ) THEN RAISE EXCEPTION 'Estimate journey capability scope is ambiguous' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_object_agg(grant_entry.capability,jsonb_build_object(
  'grantId',grant_entry.id,'revision',grant_entry.revision,
  'businessPurpose',grant_entry.business_purpose,'policyVersion',grant_entry.policy_version)), '{}'::jsonb)
 INTO capability_rows
 FROM public.canonical_customer_financial_estimate_journey_grants_v1 grant_entry
 JOIN public.canonical_customer_financial_estimate_journey_grant_heads_v1 head
  ON head.organization_id=grant_entry.organization_id AND head.capability_grant_id=grant_entry.id
  AND head.latest_revision=grant_entry.revision
 WHERE grant_entry.organization_id=org AND grant_entry.actor_user_id=actor
  AND grant_entry.membership_id=(actor_authority->>'membershipId')::uuid
  AND grant_entry.estimate_id=estimate_value AND grant_entry.active=TRUE
  AND grant_entry.valid_from<=clock_timestamp() AND grant_entry.expires_at>clock_timestamp()
  AND grant_entry.target_class='canonical_estimate' AND grant_entry.policy_version='mission27.launch.v1'
  AND rtrim(grant_entry.policy_digest)='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'
  AND grant_entry.template_version=CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END
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
 SELECT * INTO draft_row FROM public.canonical_customer_financial_estimate_journey_drafts_v1
  WHERE organization_id=org AND estimate_id=estimate_value FOR SHARE;
 IF draft_row.estimate_id IS NULL THEN RETURN jsonb_build_object('draft',NULL,'proposal',NULL,
  'capabilities',capability_rows); END IF;
 SELECT * INTO proposal_row FROM public.canonical_customer_estimate_multi_option_proposals_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND draft_revision=draft_row.revision
   AND rtrim(draft_digest)=rtrim(draft_row.draft_digest)
  ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO pending_row FROM public.canonical_customer_estimate_proposal_reviews_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND draft_revision=draft_row.revision
   AND rtrim(draft_digest)=rtrim(draft_row.draft_digest)
  ORDER BY reviewed_at,id LIMIT 1 FOR SHARE;
 RETURN jsonb_build_object('state','current','draft',draft_row.draft||jsonb_build_object(
  'revision',draft_row.revision,'updatedAt',draft_row.updated_at,'reason',draft_row.reason),
  'proposal',CASE WHEN proposal_row.id IS NULL THEN NULL ELSE proposal_row.proposal END,
  'pendingProposal',CASE WHEN pending_row.id IS NULL THEN NULL ELSE jsonb_build_object(
   'id',pending_row.proposal_id,'revision',pending_row.proposal_revision,
   'proposalDigest',rtrim(pending_row.proposal_digest),'draftRevision',pending_row.draft_revision,
   'draftDigest',rtrim(pending_row.draft_digest)) END,
  'capabilities',capability_rows,
  'signature',jsonb_build_object('state','unavailable','reason','legal_review_unavailable','value',NULL),
  'workHandoff',jsonb_build_object('state','unavailable','reason','work_handoff_receiver_unavailable','value',NULL));
END $$;

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_save_draft(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,estimate_value UUID,
 grant_value UUID,grant_revision_value BIGINT,capability_value TEXT,purpose_value TEXT,policy_version_value TEXT,
 request_key TEXT,expected_revision BIGINT,draft_value JSONB,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row RECORD; next_revision BIGINT; key_digest TEXT; req_digest TEXT; prior RECORD;
 response_value JSONB;
BEGIN
 IF request_key IS NULL OR octet_length(request_key) NOT BETWEEN 16 AND 200 OR reason_value IS NULL OR
  reason_value<>btrim(reason_value) OR octet_length(reason_value) NOT BETWEEN 12 AND 1000 OR
  confirmation_value<>'m27-polaris-quote-journey-v1' OR jsonb_typeof(draft_value)<>'object' OR
  draft_value->>'version'<>'polaris.editable.estimate.v1' OR draft_value->>'estimateId'<>estimate_value::text OR
  draft_value->>'currency'<>'USD' OR draft_value->>'draftDigest'!~'^[0-9a-f]{64}$' OR
  draft_value->>'sourceDigest'!~'^[0-9a-f]{64}$' OR draft_value->>'sourceRevisionDigest'!~'^[0-9a-f]{64}$' OR
  jsonb_typeof(draft_value->'options')<>'array' OR jsonb_array_length(draft_value->'options') NOT BETWEEN 1 AND 3 OR
  capability_value<>(CASE WHEN jsonb_array_length(draft_value->'options')>1 THEN 'customer_financial.estimate.edit_options' ELSE 'customer_financial.estimate.edit_draft' END) THEN
  RAISE EXCEPTION 'Estimate draft invalid' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_customer_financial_estimate_journey_v1_access(org,actor,role_value,session_value,csrf,
  estimate_value,grant_value,grant_revision_value,capability_value,purpose_value,policy_version_value);
 key_digest:=encode(sha256(convert_to(request_key,'UTF8')),'hex');
 req_digest:=public.canonical_completion_digest(jsonb_build_object('action','save_draft','estimateId',estimate_value,
  'grantId',grant_value,'grantRevision',grant_revision_value,'expectedRevision',expected_revision,'draft',draft_value,
  'reason',reason_value,'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':estimate-journey-request:'||actor::text||':'||key_digest,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':estimate-journey-draft:'||estimate_value::text,0));
 SELECT * INTO prior FROM public.canonical_customer_financial_estimate_journey_requests_v1 WHERE organization_id=org
  AND actor_user_id=actor AND auth_session_id=session_value AND request_key_digest=key_digest FOR SHARE;
 SELECT * INTO current_row FROM public.canonical_customer_financial_estimate_journey_drafts_v1
  WHERE organization_id=org AND estimate_id=estimate_value FOR UPDATE;
 IF prior.request_digest IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>req_digest THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505'; END IF;
  IF current_row.estimate_id IS NULL OR current_row.revision<>(prior.response->'draft'->>'revision')::bigint OR
   rtrim(current_row.draft_digest)<>prior.response->'draft'->>'draftDigest' THEN
   RAISE EXCEPTION 'Draft changed' USING ERRCODE='40001'; END IF;
  RETURN prior.response||jsonb_build_object('replayed',TRUE);
 END IF;
 IF COALESCE(current_row.revision,0)<>expected_revision THEN RAISE EXCEPTION 'Draft changed' USING ERRCODE='40001'; END IF;
 next_revision:=expected_revision+1;
 INSERT INTO public.canonical_customer_financial_estimate_journey_drafts_v1(
  organization_id,estimate_id,revision,draft,draft_digest,source_digest,source_revision_digest,
  actor_user_id,actor_access_role,membership_id,capability_grant_id,capability_grant_revision,
  business_purpose,policy_version,policy_digest,reason,updated_at)
 VALUES(org,estimate_value,next_revision,draft_value,draft_value->>'draftDigest',draft_value->>'sourceDigest',
  draft_value->>'sourceRevisionDigest',actor,role_value,(authority->>'membershipId')::uuid,grant_value,
  grant_revision_value,purpose_value,policy_version_value,authority->>'policyDigest',reason_value,clock_timestamp())
 ON CONFLICT(organization_id,estimate_id) DO UPDATE SET revision=EXCLUDED.revision,draft=EXCLUDED.draft,
  draft_digest=EXCLUDED.draft_digest,source_digest=EXCLUDED.source_digest,
  source_revision_digest=EXCLUDED.source_revision_digest,actor_user_id=EXCLUDED.actor_user_id,
  actor_access_role=EXCLUDED.actor_access_role,membership_id=EXCLUDED.membership_id,
  capability_grant_id=EXCLUDED.capability_grant_id,capability_grant_revision=EXCLUDED.capability_grant_revision,
  business_purpose=EXCLUDED.business_purpose,policy_version=EXCLUDED.policy_version,
  policy_digest=EXCLUDED.policy_digest,reason=EXCLUDED.reason,updated_at=EXCLUDED.updated_at;
 SELECT * INTO current_row FROM public.canonical_customer_financial_estimate_journey_drafts_v1
  WHERE organization_id=org AND estimate_id=estimate_value FOR SHARE;
 response_value:=jsonb_build_object('status',201,'draft',draft_value||jsonb_build_object(
  'revision',next_revision,'updatedAt',current_row.updated_at,'reason',reason_value),
  'proposalInvalidated',TRUE,'signatureInvalidated',TRUE,'handoffInvalidated',TRUE,'providerCallCount',0,'receiverMutationCount',0);
 INSERT INTO public.canonical_customer_financial_estimate_journey_requests_v1 VALUES(org,actor,session_value,
  key_digest,req_digest,'save_draft',201,response_value,public.canonical_completion_digest(response_value),clock_timestamp());
 RETURN response_value||jsonb_build_object('replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_estimate_journey_v1_proposal(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,estimate_value UUID,
 grant_value UUID,grant_revision_value BIGINT,capability_value TEXT,purpose_value TEXT,policy_version_value TEXT,
 request_key TEXT,proposal_value JSONB,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; draft_row RECORD; key_digest TEXT; req_digest TEXT; prior RECORD;
 total_value BIGINT:=0; option_value JSONB; required_count INTEGER; actual_count INTEGER; response_value JSONB;
BEGIN
 IF confirmation_value<>'m27-polaris-proposal-review-v1' OR capability_value<>'customer_financial.estimate.request_signature' OR
  proposal_value->>'version'<>'m24.polaris.multi_option_proposal.v1' OR proposal_value->>'estimateId'<>estimate_value::text OR
  proposal_value->>'proposalDigest'!~'^[0-9a-f]{64}$' OR jsonb_typeof(proposal_value->'options')<>'array' OR
  jsonb_array_length(proposal_value->'options') NOT BETWEEN 2 AND 3 OR request_key IS NULL OR
  octet_length(request_key) NOT BETWEEN 16 AND 200 OR reason_value IS NULL OR reason_value<>btrim(reason_value) OR
  octet_length(reason_value) NOT BETWEEN 12 AND 1000 THEN RAISE EXCEPTION 'Proposal review invalid' USING ERRCODE='22023'; END IF;
 FOR option_value IN SELECT value FROM jsonb_array_elements(proposal_value->'options') LOOP
  IF option_value->'total'->>'minorUnits'!~'^(0|[1-9][0-9]{0,7})$' THEN RAISE EXCEPTION 'Proposal amount invalid' USING ERRCODE='22023'; END IF;
  total_value:=greatest(total_value,(option_value->'total'->>'minorUnits')::bigint);
 END LOOP;
 IF total_value>10000000 THEN RAISE EXCEPTION 'Proposal amount invalid' USING ERRCODE='22023'; END IF;
 required_count:=CASE WHEN total_value<=1000000 THEN 1 ELSE 2 END;
 authority:=public.canonical_customer_financial_estimate_journey_v1_access(org,actor,role_value,session_value,csrf,
  estimate_value,grant_value,grant_revision_value,capability_value,purpose_value,policy_version_value);
 key_digest:=encode(sha256(convert_to(request_key,'UTF8')),'hex');
 req_digest:=public.canonical_completion_digest(jsonb_build_object('action','request_proposal','proposal',proposal_value,
  'grantId',grant_value,'grantRevision',grant_revision_value,'reason',reason_value,'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':estimate-journey-request:'||actor::text||':'||key_digest,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':estimate-journey-draft:'||estimate_value::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':estimate-journey-proposal-draft:'||
  estimate_value::text||':'||(proposal_value->>'draftRevision'),0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':estimate-journey-proposal:'||(proposal_value->>'proposalDigest'),0));
 SELECT * INTO prior FROM public.canonical_customer_financial_estimate_journey_requests_v1 WHERE organization_id=org
  AND actor_user_id=actor AND auth_session_id=session_value AND request_key_digest=key_digest FOR SHARE;
 IF prior.request_digest IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>req_digest THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505'; END IF;
 END IF;
 SELECT * INTO draft_row FROM public.canonical_customer_financial_estimate_journey_drafts_v1
  WHERE organization_id=org AND estimate_id=estimate_value FOR SHARE;
 IF draft_row.estimate_id IS NULL OR draft_row.revision<>(proposal_value->>'draftRevision')::bigint OR
 rtrim(draft_row.draft_digest)<>proposal_value->>'draftDigest' THEN RAISE EXCEPTION 'Draft changed' USING ERRCODE='40001'; END IF;
 IF prior.request_digest IS NOT NULL THEN
  SELECT count(*)::int INTO actual_count FROM public.canonical_customer_estimate_proposal_reviews_v1
   WHERE organization_id=org AND proposal_digest=proposal_value->>'proposalDigest';
  response_value:=prior.response||jsonb_build_object(
   'status',CASE WHEN actual_count>=required_count THEN 201 ELSE 202 END,
   'state',CASE WHEN actual_count>=required_count THEN 'proposal_current' ELSE 'independent_review_required' END,
   'approvalCount',actual_count,'requiredApprovalCount',required_count);
  RETURN response_value||jsonb_build_object('replayed',TRUE);
 END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_customer_estimate_proposal_reviews_v1
  WHERE organization_id=org AND estimate_id=estimate_value AND draft_revision=draft_row.revision
   AND rtrim(proposal_digest)<>proposal_value->>'proposalDigest') THEN
  RAISE EXCEPTION 'A different proposal review is already pending' USING ERRCODE='40001';
 END IF;
 INSERT INTO public.canonical_customer_estimate_proposal_reviews_v1(
  organization_id,estimate_id,proposal_id,proposal_revision,proposal_digest,draft_revision,draft_digest,total_minor_units,
  control_mode,actor_user_id,actor_access_role,membership_id,auth_session_id,capability_grant_id,
  capability_grant_revision,reason,reviewed_at)
 VALUES(org,estimate_value,(proposal_value->>'id')::uuid,(proposal_value->>'revision')::bigint,
  proposal_value->>'proposalDigest',draft_row.revision,draft_row.draft_digest,total_value,
  CASE WHEN required_count=1 THEN 'single_control' ELSE 'dual_control' END,actor,role_value,
  (authority->>'membershipId')::uuid,session_value,grant_value,grant_revision_value,reason_value,clock_timestamp());
 SELECT count(*)::int INTO actual_count FROM public.canonical_customer_estimate_proposal_reviews_v1
  WHERE organization_id=org AND proposal_digest=proposal_value->>'proposalDigest';
 IF actual_count>=required_count THEN
  INSERT INTO public.canonical_customer_estimate_multi_option_proposals_v1(
   organization_id,id,estimate_id,revision,proposal,proposal_digest,draft_revision,draft_digest,required_approval_count,created_at)
  VALUES(org,(proposal_value->>'id')::uuid,estimate_value,(proposal_value->>'revision')::bigint,proposal_value,
   proposal_value->>'proposalDigest',draft_row.revision,draft_row.draft_digest,required_count,clock_timestamp())
  ON CONFLICT(organization_id,proposal_digest) DO NOTHING;
 END IF;
 response_value:=jsonb_build_object('status',CASE WHEN actual_count>=required_count THEN 201 ELSE 202 END,
  'state',CASE WHEN actual_count>=required_count THEN 'proposal_current' ELSE 'independent_review_required' END,
  'proposal',proposal_value,'approvalCount',actual_count,'requiredApprovalCount',required_count,
  'automaticDelivery',FALSE,'signature',jsonb_build_object('state','unavailable','reason','legal_review_unavailable','value',NULL),
  'workHandoff',jsonb_build_object('state','unavailable','reason','work_handoff_receiver_unavailable','value',NULL),
  'providerCallCount',0,'receiverMutationCount',0);
 INSERT INTO public.canonical_customer_financial_estimate_journey_requests_v1 VALUES(org,actor,session_value,
  key_digest,req_digest,'request_proposal',(response_value->>'status')::int,response_value,
  public.canonical_completion_digest(response_value),clock_timestamp());
 RETURN response_value||jsonb_build_object('replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_estimate_journey_grants_v1,
 public.canonical_customer_financial_estimate_journey_grant_heads_v1,
 public.canonical_customer_financial_estimate_journey_drafts_v1,
 public.canonical_customer_estimate_proposal_reviews_v1,
 public.canonical_customer_estimate_multi_option_proposals_v1,
 public.canonical_customer_financial_estimate_journey_requests_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_estimate_journey_v1_grant_head(),
 public.canonical_customer_financial_estimate_journey_v1_issue_grant(UUID,UUID,BIGINT,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),
 public.canonical_customer_financial_estimate_journey_v1_access(UUID,UUID,TEXT,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT),
 public.canonical_customer_financial_estimate_journey_v1_read(UUID,UUID,TEXT,UUID,UUID),
 public.canonical_customer_financial_estimate_journey_v1_save_draft(UUID,UUID,TEXT,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,BIGINT,JSONB,TEXT,TEXT),
 public.canonical_customer_financial_estimate_journey_v1_proposal(UUID,UUID,TEXT,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT)
 FROM PUBLIC;
