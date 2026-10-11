-- Mission 27 Part 2C: exact USD money and tenant-global document-numbering
-- authority. Number lifecycle primitives are private until Part 5 supplies an
-- accepted invoice/credit/receipt effect with its own action capability.

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_exact_money(
 minor_units_value TEXT,currency_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE amount_value NUMERIC;absolute_value NUMERIC;decimal_value TEXT;
BEGIN
 IF currency_value<>'USD' THEN
  RAISE EXCEPTION 'Unsupported customer financial currency'
   USING ERRCODE='22023',CONSTRAINT='canonical_customer_financial_currency_unsupported';
 END IF;
 IF minor_units_value IS NULL OR minor_units_value!~'^-?(0|[1-9][0-9]{0,15})$' THEN
  RAISE EXCEPTION 'Exact customer financial money invalid'
   USING ERRCODE='22023',CONSTRAINT='canonical_customer_financial_exact_money_invalid';
 END IF;
 amount_value:=minor_units_value::numeric;
 IF abs(amount_value)>9007199254740991 THEN
  RAISE EXCEPTION 'Exact customer financial money invalid'
   USING ERRCODE='22023',CONSTRAINT='canonical_customer_financial_exact_money_invalid';
 END IF;
 absolute_value:=abs(amount_value);
 decimal_value:=(CASE WHEN amount_value<0 THEN '-' ELSE '' END)||
  trunc(absolute_value/100)::text||'.'||lpad(mod(absolute_value,100)::text,2,'0');
 RETURN jsonb_build_object('version','m27-exact-money-v1','currency','USD',
  'minorUnitExponent',2,'minorUnits',amount_value::text,'decimal',decimal_value,
  'exactZero',amount_value=0);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_contract()
RETURNS JSONB LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m27-document-numbering-contract-v1',
  'currency',jsonb_build_object('code','USD','minorUnitExponent',2,
   'rounding','half_away_from_zero_at_owning_boundary','foreignExchangeSupported',FALSE),
  'location',jsonb_build_object('scope','tenant_global','locationId',NULL),
  'documents',jsonb_build_object(
   'invoice',jsonb_build_object('prefix','INV-','width',10,'firstSequence','1'),
   'credit',jsonb_build_object('prefix','CR-','width',10,'firstSequence','1'),
   'receipt',jsonb_build_object('prefix','RCT-','width',10,'firstSequence','1')),
  'reuseAllowed',FALSE,'gapsAllowed',TRUE,'yearResetAllowed',FALSE,
  'serverAssigned',TRUE,'statutorySufficiencyClaimed',FALSE)
$$;

CREATE TABLE public.canonical_customer_financial_numbering_capability_grants_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 capability TEXT NOT NULL CHECK(capability='customer_financial.document_numbering.review'),
 target_class TEXT NOT NULL CHECK(target_class='tenant_document_numbering_policy'),
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.document_numbering'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.document_numbering.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(
  policy_digest='2b98aa283e4b3ad464419c7f8cb964892fc2fe28cbc6b7afdbac94ddc194b041'),
 template_version TEXT NOT NULL CHECK(template_version='m27.document_numbering.owner.v1'),
 predecessor_policy_version TEXT NOT NULL CHECK(predecessor_policy_version='mission27.launch.v1'),
 predecessor_policy_digest CHAR(64) NOT NULL CHECK(
  predecessor_policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 action_mode TEXT NOT NULL CHECK(action_mode='single_control'),
 assurance TEXT NOT NULL CHECK(assurance='current_session'),
 active BOOLEAN NOT NULL,
 valid_from TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL CHECK(expires_at>valid_from),
 issued_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id,revision),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_customer_financial_numbering_capability_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 capability_grant_id UUID NOT NULL,
 latest_revision BIGINT NOT NULL CHECK(latest_revision BETWEEN 1 AND 9007199254740991),
 advanced_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,capability_grant_id),
 FOREIGN KEY(organization_id,capability_grant_id,latest_revision)
  REFERENCES public.canonical_customer_financial_numbering_capability_grants_v1(
   organization_id,id,revision) ON DELETE RESTRICT
);

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_grant_lock()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  NEW.organization_id::text||':numbering-capability-grant:'||NEW.id::text,0));
 RETURN NEW;
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_grant_head()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO public.canonical_customer_financial_numbering_capability_heads_v1(
  organization_id,capability_grant_id,latest_revision,advanced_at)
 VALUES(NEW.organization_id,NEW.id,NEW.revision,clock_timestamp())
 ON CONFLICT(organization_id,capability_grant_id) DO UPDATE
 SET latest_revision=EXCLUDED.latest_revision,advanced_at=EXCLUDED.advanced_at
 WHERE EXCLUDED.latest_revision>
  public.canonical_customer_financial_numbering_capability_heads_v1.latest_revision;
 RETURN NEW;
END $$;

CREATE TRIGGER canonical_customer_financial_numbering_capability_grants_v1_lock
 BEFORE INSERT ON public.canonical_customer_financial_numbering_capability_grants_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_numbering_v1_grant_lock();
CREATE TRIGGER canonical_customer_financial_numbering_capability_grants_v1_head
 AFTER INSERT ON public.canonical_customer_financial_numbering_capability_grants_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_numbering_v1_grant_head();

CREATE TABLE public.canonical_customer_financial_numbering_policies_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 contract_version TEXT NOT NULL CHECK(contract_version='m27-document-numbering-contract-v1'),
 contract JSONB NOT NULL,
 contract_digest CHAR(64) NOT NULL CHECK(contract_digest~'^[0-9a-f]{64}$'),
 reviewed_by_user_id UUID NOT NULL,
 reviewed_by_access_role TEXT NOT NULL CHECK(reviewed_by_access_role='owner'),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 capability_grant_id UUID NOT NULL,
 capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.document_numbering'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.document_numbering.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(
  policy_digest='2b98aa283e4b3ad464419c7f8cb964892fc2fe28cbc6b7afdbac94ddc194b041'),
 predecessor_policy_version TEXT NOT NULL CHECK(predecessor_policy_version='mission27.launch.v1'),
 predecessor_policy_digest CHAR(64) NOT NULL CHECK(
  predecessor_policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 capability_action_mode TEXT NOT NULL CHECK(capability_action_mode='single_control'),
 capability_assurance TEXT NOT NULL CHECK(capability_assurance='current_session'),
 review_reason TEXT NOT NULL CHECK(
  review_reason=btrim(review_reason) AND octet_length(review_reason) BETWEEN 12 AND 500),
 reviewed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,reviewed_by_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_numbering_capability_grants_v1(
   organization_id,id,revision) ON DELETE RESTRICT,
 CHECK(contract=public.canonical_customer_financial_numbering_v1_contract()),
 CHECK(rtrim(contract_digest)=public.canonical_completion_digest(contract))
);

CREATE TABLE public.canonical_customer_financial_numbering_policy_requests_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 policy_id UUID NOT NULL,
 response_status INTEGER NOT NULL CHECK(response_status IN(200,201)),
 response_digest CHAR(64) NOT NULL CHECK(response_digest~'^[0-9a-f]{64}$'),
 capability_grant_id UUID NOT NULL,
 capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.document_numbering'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.document_numbering.v1'),
 policy_digest CHAR(64) NOT NULL CHECK(
  policy_digest='2b98aa283e4b3ad464419c7f8cb964892fc2fe28cbc6b7afdbac94ddc194b041'),
 predecessor_policy_version TEXT NOT NULL CHECK(predecessor_policy_version='mission27.launch.v1'),
 predecessor_policy_digest CHAR(64) NOT NULL CHECK(
  predecessor_policy_digest='d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'),
 capability_action_mode TEXT NOT NULL CHECK(capability_action_mode='single_control'),
 capability_assurance TEXT NOT NULL CHECK(capability_assurance='current_session'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,policy_id)
  REFERENCES public.canonical_customer_financial_numbering_policies_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_numbering_capability_grants_v1(
   organization_id,id,revision) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_customer_financial_numbering_sequences_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 document_class TEXT NOT NULL CHECK(document_class IN('invoice','credit','receipt')),
 next_sequence BIGINT NOT NULL CHECK(next_sequence BETWEEN 1 AND 10000000000),
 updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,document_class)
);

CREATE TABLE public.canonical_customer_financial_numbering_reservations_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 policy_id UUID NOT NULL,
 policy_digest CHAR(64) NOT NULL CHECK(policy_digest~'^[0-9a-f]{64}$'),
 document_class TEXT NOT NULL CHECK(document_class IN('invoice','credit','receipt')),
 sequence_value BIGINT NOT NULL CHECK(sequence_value BETWEEN 1 AND 9999999999),
 document_number TEXT NOT NULL CHECK(document_number~'^(INV|CR|RCT)-[0-9]{10}$'),
 reservation_key_digest CHAR(64) NOT NULL CHECK(reservation_key_digest~'^[0-9a-f]{64}$'),
 reservation_request_digest CHAR(64) NOT NULL CHECK(reservation_request_digest~'^[0-9a-f]{64}$'),
 reserved_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,document_class,sequence_value),
 UNIQUE(organization_id,document_number),
 UNIQUE(organization_id,reservation_key_digest),
 FOREIGN KEY(organization_id,policy_id)
  REFERENCES public.canonical_customer_financial_numbering_policies_v1(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_customer_financial_numbering_events_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 reservation_id UUID NOT NULL,
 event_sequence INTEGER NOT NULL CHECK(event_sequence BETWEEN 1 AND 3),
 state TEXT NOT NULL CHECK(state IN('reserved','issued','void')),
 document_id UUID,
 document_digest CHAR(64) CHECK(document_digest~'^[0-9a-f]{64}$'),
 event_key_digest CHAR(64) NOT NULL CHECK(event_key_digest~'^[0-9a-f]{64}$'),
 event_request_digest CHAR(64) NOT NULL CHECK(event_request_digest~'^[0-9a-f]{64}$'),
 reason_digest CHAR(64) CHECK(reason_digest~'^[0-9a-f]{64}$'),
 occurred_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,reservation_id,event_sequence),
 UNIQUE(organization_id,reservation_id,event_key_digest),
 FOREIGN KEY(organization_id,reservation_id)
  REFERENCES public.canonical_customer_financial_numbering_reservations_v1(organization_id,id) ON DELETE RESTRICT,
 CHECK((state='reserved' AND event_sequence=1 AND document_id IS NULL AND document_digest IS NULL
   AND reason_digest IS NULL) OR
  (state='issued' AND event_sequence=2 AND document_id IS NOT NULL AND document_digest IS NOT NULL
   AND reason_digest IS NOT NULL) OR
  (state='void' AND event_sequence IN(2,3) AND reason_digest IS NOT NULL))
);

CREATE TRIGGER canonical_customer_financial_numbering_capability_grants_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_numbering_capability_grants_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();
CREATE TRIGGER canonical_customer_financial_numbering_policies_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_numbering_policies_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();
CREATE TRIGGER canonical_customer_financial_numbering_policy_requests_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_numbering_policy_requests_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();
CREATE TRIGGER canonical_customer_financial_numbering_reservations_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_numbering_reservations_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();
CREATE TRIGGER canonical_customer_financial_numbering_events_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_numbering_events_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_effect_grant_fence()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE head_record public.canonical_customer_financial_numbering_capability_heads_v1%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  NEW.organization_id::text||':numbering-capability-grant:'||NEW.capability_grant_id::text,0));
 SELECT head.* INTO head_record
 FROM public.canonical_customer_financial_numbering_capability_heads_v1 head
 WHERE head.organization_id=NEW.organization_id
  AND head.capability_grant_id=NEW.capability_grant_id FOR SHARE OF head;
 IF head_record.capability_grant_id IS NULL OR
    head_record.latest_revision<>NEW.capability_grant_revision THEN
  RAISE EXCEPTION 'Current document numbering capability unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_numbering_capability_unavailable';
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER canonical_customer_financial_numbering_policies_v1_grant_fence
 BEFORE INSERT ON public.canonical_customer_financial_numbering_policies_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_numbering_v1_effect_grant_fence();
CREATE TRIGGER canonical_customer_financial_numbering_policy_requests_v1_grant_fence
 BEFORE INSERT ON public.canonical_customer_financial_numbering_policy_requests_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_numbering_v1_effect_grant_fence();

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_access(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,write_value BOOLEAN,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
 head_record public.canonical_customer_financial_numbering_capability_heads_v1%ROWTYPE;
 grant_record public.canonical_customer_financial_numbering_capability_grants_v1%ROWTYPE;
BEGIN
 IF role_value<>'owner' OR capability_grant_id_value IS NULL OR
    capability_grant_revision_value IS NULL OR
    capability_grant_revision_value NOT BETWEEN 1 AND 9007199254740991 OR
    business_purpose_value<>'customer_financial.document_numbering' OR
    policy_version_value<>'mission27.document_numbering.v1' THEN
  RAISE EXCEPTION 'Document numbering policy access restricted'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_numbering_unauthorized';
 END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,write_value);
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,FALSE) THEN
  RAISE EXCEPTION 'Current document numbering policy access unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_numbering_unauthorized';
 END IF;
 SELECT head.* INTO head_record
 FROM public.canonical_customer_financial_numbering_capability_heads_v1 head
 WHERE head.organization_id=org AND head.capability_grant_id=capability_grant_id_value;
 IF head_record.capability_grant_id IS NULL OR
    head_record.latest_revision<>capability_grant_revision_value THEN
  RAISE EXCEPTION 'Current document numbering capability unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_numbering_capability_unavailable';
 END IF;
 SELECT grant_value.* INTO grant_record
 FROM public.canonical_customer_financial_numbering_capability_grants_v1 grant_value
 WHERE grant_value.organization_id=org AND grant_value.id=capability_grant_id_value
  AND grant_value.revision=capability_grant_revision_value
  AND grant_value.actor_user_id=actor
  AND grant_value.membership_id=(authority->>'membershipId')::uuid
  AND grant_value.capability='customer_financial.document_numbering.review'
  AND grant_value.target_class='tenant_document_numbering_policy'
  AND grant_value.business_purpose=business_purpose_value
  AND grant_value.policy_version=policy_version_value
  AND rtrim(grant_value.policy_digest)=
   '2b98aa283e4b3ad464419c7f8cb964892fc2fe28cbc6b7afdbac94ddc194b041'
  AND grant_value.template_version='m27.document_numbering.owner.v1'
  AND grant_value.predecessor_policy_version='mission27.launch.v1'
  AND rtrim(grant_value.predecessor_policy_digest)=
   'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a'
  AND grant_value.action_mode='single_control' AND grant_value.assurance='current_session'
  AND grant_value.active=TRUE
  AND grant_value.issued_at<=clock_timestamp() AND grant_value.valid_from<=clock_timestamp()
  AND grant_value.expires_at>clock_timestamp()
  AND NOT EXISTS(SELECT 1 FROM public.canonical_customer_financial_numbering_capability_grants_v1 newer
   WHERE newer.organization_id=grant_value.organization_id AND newer.id=grant_value.id
    AND newer.revision>grant_value.revision)
 FOR SHARE OF grant_value;
 IF grant_record.id IS NULL THEN
  RAISE EXCEPTION 'Current document numbering capability unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_numbering_capability_unavailable';
 END IF;
 RETURN authority||jsonb_build_object('capability','customer_financial.document_numbering.review',
  'capabilityGrantId',grant_record.id,'capabilityGrantRevision',grant_record.revision,
  'businessPurpose',grant_record.business_purpose,'policyVersion',grant_record.policy_version,
  'policyDigest',rtrim(grant_record.policy_digest),
  'predecessorPolicyVersion',grant_record.predecessor_policy_version,
  'predecessorPolicyDigest',rtrim(grant_record.predecessor_policy_digest),
  'capabilityActionMode',grant_record.action_mode,'capabilityAssurance',grant_record.assurance);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_projection(
 org UUID,policy_record public.canonical_customer_financial_numbering_policies_v1)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE contract_value JSONB:=public.canonical_customer_financial_numbering_v1_contract();
 contract_digest_value TEXT:=public.canonical_completion_digest(contract_value);
BEGIN
 IF policy_record.id IS NULL THEN
  RETURN jsonb_build_object('version','m27-document-numbering-policy-state-v1',
   'state','review_required','available',TRUE,'current',TRUE,'reason',NULL,
   'organizationId',org,'policyId',NULL,'policyDigest',contract_digest_value,
   'reviewState','unreviewed','numberReservationAvailable',FALSE,
   'value',jsonb_build_object('contract',contract_value,'ownerReviewRequired',TRUE));
 END IF;
 RETURN jsonb_build_object('version','m27-document-numbering-policy-state-v1',
  'state','reviewed_current','available',TRUE,'current',TRUE,'reason',NULL,
  'organizationId',org,'policyId',policy_record.id,
  'policyDigest',rtrim(policy_record.contract_digest),'reviewState','reviewed',
  'numberReservationAvailable',TRUE,'value',jsonb_build_object(
   'contract',policy_record.contract,'actor',jsonb_build_object(
    'organizationId',org,'userId',policy_record.reviewed_by_user_id,
    'accessRole',policy_record.reviewed_by_access_role,'membershipId',policy_record.membership_id,
    'authSessionId',policy_record.auth_session_id,'capability','customer_financial.document_numbering.review',
    'capabilityGrantId',policy_record.capability_grant_id,
    'capabilityGrantRevision',policy_record.capability_grant_revision,
    'businessPurpose',policy_record.business_purpose,'policyVersion',policy_record.policy_version,
    'policyDigest',rtrim(policy_record.policy_digest),
    'predecessorPolicyVersion',policy_record.predecessor_policy_version,
    'predecessorPolicyDigest',rtrim(policy_record.predecessor_policy_digest),
    'actionMode',policy_record.capability_action_mode,
    'assurance',policy_record.capability_assurance),
   'reason',policy_record.review_reason,
   'reviewedAt',public.canonical_customer_financial_billing_identity_v1_utc(policy_record.reviewed_at)));
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_candidate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE policy_record public.canonical_customer_financial_numbering_policies_v1%ROWTYPE;
BEGIN
 PERFORM public.canonical_customer_financial_numbering_v1_access(org,actor,role_value,
  session_value,NULL,FALSE,capability_grant_id_value,capability_grant_revision_value,
  business_purpose_value,policy_version_value);
 SELECT policy.* INTO policy_record FROM public.canonical_customer_financial_numbering_policies_v1 policy
 WHERE policy.organization_id=org;
 RETURN public.canonical_customer_financial_numbering_v1_projection(org,policy_record);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RETURN public.canonical_customer_financial_numbering_v1_candidate(org,actor,role_value,
  session_value,capability_grant_id_value,capability_grant_revision_value,
  business_purpose_value,policy_version_value);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_review(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT,csrf TEXT,key_value TEXT,
 expected_policy_digest_value TEXT,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;policy_record public.canonical_customer_financial_numbering_policies_v1%ROWTYPE;
 request_record public.canonical_customer_financial_numbering_policy_requests_v1%ROWTYPE;
 contract_value JSONB:=public.canonical_customer_financial_numbering_v1_contract();
 policy_digest_value TEXT:=public.canonical_completion_digest(contract_value);
 key_digest_value TEXT;request_digest_value TEXT;response_value JSONB;reviewed_at_value TIMESTAMPTZ;
 response_status_value INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable transaction required for document numbering review'
   USING ERRCODE='25001';END IF;
 authority:=public.canonical_customer_financial_numbering_v1_access(org,actor,role_value,
  session_value,csrf,TRUE,capability_grant_id_value,capability_grant_revision_value,
  business_purpose_value,policy_version_value);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    expected_policy_digest_value IS NULL OR expected_policy_digest_value!~'^[0-9a-f]{64}$' OR
    reason_value IS NULL OR reason_value<>btrim(reason_value) OR
    octet_length(reason_value) NOT BETWEEN 12 AND 500 THEN
  RAISE EXCEPTION 'Document numbering review request invalid' USING ERRCODE='22023';END IF;
 IF expected_policy_digest_value<>policy_digest_value THEN
  RAISE EXCEPTION 'Document numbering policy changed'
   USING ERRCODE='40001',CONSTRAINT='canonical_customer_financial_numbering_policy_changed';END IF;
 key_digest_value:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m27-document-numbering-policy-review-request-v1','organizationId',org,
  'actorUserId',actor,'authSessionId',session_value,
  'capabilityGrantId',capability_grant_id_value,
   'capabilityGrantRevision',capability_grant_revision_value,
   'businessPurpose',business_purpose_value,'policyVersion',policy_version_value,
   'policyDigest',authority->>'policyDigest',
   'predecessorPolicyVersion',authority->>'predecessorPolicyVersion',
   'predecessorPolicyDigest',authority->>'predecessorPolicyDigest',
   'expectedPolicyDigest',expected_policy_digest_value,'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':numbering-policy-request:'||actor::text||':'||session_value::text||':'||key_digest_value,0));
 SELECT request_value.* INTO request_record
 FROM public.canonical_customer_financial_numbering_policy_requests_v1 request_value
 WHERE request_value.organization_id=org AND request_value.actor_user_id=actor
  AND request_value.auth_session_id=session_value
  AND rtrim(request_value.request_key_digest)=key_digest_value;
 IF request_record.policy_id IS NOT NULL THEN
  IF rtrim(request_record.request_digest)<>request_digest_value THEN
   RAISE EXCEPTION 'Document numbering review idempotency conflict'
    USING ERRCODE='23505',CONSTRAINT='canonical_customer_financial_numbering_idempotency_conflict';END IF;
  SELECT policy.* INTO policy_record FROM public.canonical_customer_financial_numbering_policies_v1 policy
   WHERE policy.organization_id=org AND policy.id=request_record.policy_id FOR SHARE;
  IF policy_record.id IS NULL THEN RAISE EXCEPTION 'Document numbering review history unavailable'
   USING ERRCODE='55000';END IF;
  response_value:=public.canonical_customer_financial_numbering_v1_projection(org,policy_record);
  IF rtrim(request_record.response_digest)<>public.canonical_completion_digest(response_value) THEN
   RAISE EXCEPTION 'Document numbering review replay digest invalid' USING ERRCODE='55000';END IF;
  RETURN jsonb_build_object('status',200,'body',response_value,'replayed',TRUE);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':numbering-policy',0));
 SELECT policy.* INTO policy_record FROM public.canonical_customer_financial_numbering_policies_v1 policy
  WHERE policy.organization_id=org FOR SHARE;
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Current document numbering policy access unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_numbering_unauthorized';END IF;
 authority:=public.canonical_customer_financial_numbering_v1_access(org,actor,role_value,
  session_value,csrf,TRUE,capability_grant_id_value,capability_grant_revision_value,
  business_purpose_value,policy_version_value);
 reviewed_at_value:=statement_timestamp();
 IF policy_record.id IS NULL THEN
  INSERT INTO public.canonical_customer_financial_numbering_policies_v1(
   organization_id,contract_version,contract,contract_digest,reviewed_by_user_id,
   reviewed_by_access_role,membership_id,auth_session_id,capability_grant_id,
   capability_grant_revision,business_purpose,policy_version,policy_digest,predecessor_policy_version,
   predecessor_policy_digest,capability_action_mode,capability_assurance,review_reason,reviewed_at)
  VALUES(org,'m27-document-numbering-contract-v1',contract_value,policy_digest_value,actor,
   role_value,(authority->>'membershipId')::uuid,session_value,capability_grant_id_value,
   capability_grant_revision_value,business_purpose_value,policy_version_value,
   authority->>'policyDigest',
   authority->>'predecessorPolicyVersion',authority->>'predecessorPolicyDigest',
   authority->>'capabilityActionMode',authority->>'capabilityAssurance',reason_value,
   reviewed_at_value) RETURNING * INTO policy_record;
  response_status_value:=201;
 ELSE
  response_status_value:=200;
 END IF;
 response_value:=public.canonical_customer_financial_numbering_v1_projection(org,policy_record);
 INSERT INTO public.canonical_customer_financial_numbering_policy_requests_v1(
  organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,
  policy_id,response_status,response_digest,capability_grant_id,capability_grant_revision,
  business_purpose,policy_version,policy_digest,predecessor_policy_version,predecessor_policy_digest,
  capability_action_mode,capability_assurance,created_at)
 VALUES(org,actor,session_value,key_digest_value,request_digest_value,policy_record.id,
  response_status_value,public.canonical_completion_digest(response_value),capability_grant_id_value,
  capability_grant_revision_value,business_purpose_value,policy_version_value,
  authority->>'policyDigest',
  authority->>'predecessorPolicyVersion',authority->>'predecessorPolicyDigest',
  authority->>'capabilityActionMode',authority->>'capabilityAssurance',reviewed_at_value);
 RETURN jsonb_build_object('status',response_status_value,'body',response_value,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_reservation_event_projection(
 reservation_record public.canonical_customer_financial_numbering_reservations_v1,
 event_record public.canonical_customer_financial_numbering_events_v1)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF event_record.reservation_id IS NULL OR
    event_record.organization_id<>reservation_record.organization_id OR
    event_record.reservation_id<>reservation_record.id THEN
  RAISE EXCEPTION 'Document number event history unavailable' USING ERRCODE='55000';END IF;
 RETURN jsonb_build_object('version','m27-document-number-reservation-v1',
  'organizationId',reservation_record.organization_id,'reservationId',reservation_record.id,
  'policyId',reservation_record.policy_id,'policyDigest',rtrim(reservation_record.policy_digest),
  'documentClass',reservation_record.document_class,
  'sequence',reservation_record.sequence_value::text,
  'documentNumber',reservation_record.document_number,'state',event_record.state,
  'documentId',event_record.document_id,'documentDigest',rtrim(event_record.document_digest),
  'reservedAt',public.canonical_customer_financial_billing_identity_v1_utc(reservation_record.reserved_at),
  'stateChangedAt',public.canonical_customer_financial_billing_identity_v1_utc(event_record.occurred_at),
  'reuseAllowed',FALSE,'recoveryBoundedToRequest',TRUE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_reservation_projection(
 reservation_record public.canonical_customer_financial_numbering_reservations_v1)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE event_record public.canonical_customer_financial_numbering_events_v1%ROWTYPE;
BEGIN
 SELECT event_value.* INTO event_record FROM public.canonical_customer_financial_numbering_events_v1 event_value
 WHERE event_value.organization_id=reservation_record.organization_id
  AND event_value.reservation_id=reservation_record.id
 ORDER BY event_value.event_sequence DESC LIMIT 1;
 IF event_record.reservation_id IS NULL THEN RAISE EXCEPTION 'Document number history unavailable'
  USING ERRCODE='55000';END IF;
 RETURN public.canonical_customer_financial_numbering_v1_reservation_event_projection(
  reservation_record,event_record);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_reserve(
 org UUID,document_class_value TEXT,reservation_key_digest_value TEXT,
 reservation_request_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE policy_record public.canonical_customer_financial_numbering_policies_v1%ROWTYPE;
 reservation_record public.canonical_customer_financial_numbering_reservations_v1%ROWTYPE;
 reservation_event public.canonical_customer_financial_numbering_events_v1%ROWTYPE;
 assigned_sequence BIGINT;prefix_value TEXT;number_value TEXT;now_value TIMESTAMPTZ:=statement_timestamp();
BEGIN
 IF org IS NULL OR document_class_value NOT IN('invoice','credit','receipt') OR
    reservation_key_digest_value IS NULL OR reservation_key_digest_value!~'^[0-9a-f]{64}$' OR
    reservation_request_digest_value IS NULL OR reservation_request_digest_value!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Document number reservation invalid' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':document-number-request:'||reservation_key_digest_value,0));
 SELECT reservation.* INTO reservation_record
 FROM public.canonical_customer_financial_numbering_reservations_v1 reservation
 WHERE reservation.organization_id=org
  AND rtrim(reservation.reservation_key_digest)=reservation_key_digest_value FOR SHARE;
 IF reservation_record.id IS NOT NULL THEN
  IF rtrim(reservation_record.reservation_request_digest)<>reservation_request_digest_value THEN
   RAISE EXCEPTION 'Document number reservation idempotency conflict'
    USING ERRCODE='23505',CONSTRAINT='canonical_customer_financial_numbering_reservation_conflict';END IF;
  SELECT event_value.* INTO reservation_event
  FROM public.canonical_customer_financial_numbering_events_v1 event_value
  WHERE event_value.organization_id=org AND event_value.reservation_id=reservation_record.id
   AND event_value.event_sequence=1;
  RETURN public.canonical_customer_financial_numbering_v1_reservation_event_projection(
   reservation_record,reservation_event);
 END IF;
 SELECT policy.* INTO policy_record FROM public.canonical_customer_financial_numbering_policies_v1 policy
  WHERE policy.organization_id=org FOR SHARE;
 IF policy_record.id IS NULL OR policy_record.contract<>public.canonical_customer_financial_numbering_v1_contract() THEN
  RAISE EXCEPTION 'Reviewed document numbering policy unavailable'
   USING ERRCODE='55000',CONSTRAINT='canonical_customer_financial_numbering_policy_unavailable';END IF;
 INSERT INTO public.canonical_customer_financial_numbering_sequences_v1(
  organization_id,document_class,next_sequence,updated_at)
 VALUES(org,document_class_value,2,now_value)
 ON CONFLICT(organization_id,document_class) DO UPDATE
 SET next_sequence=public.canonical_customer_financial_numbering_sequences_v1.next_sequence+1,
     updated_at=EXCLUDED.updated_at
 WHERE public.canonical_customer_financial_numbering_sequences_v1.next_sequence<=9999999999
 RETURNING next_sequence-1 INTO assigned_sequence;
 IF assigned_sequence IS NULL OR assigned_sequence NOT BETWEEN 1 AND 9999999999 THEN
  RAISE EXCEPTION 'Document number sequence exhausted'
   USING ERRCODE='22003',CONSTRAINT='canonical_customer_financial_numbering_sequence_exhausted';END IF;
 prefix_value:=CASE document_class_value WHEN 'invoice' THEN 'INV-'
  WHEN 'credit' THEN 'CR-' ELSE 'RCT-' END;
 number_value:=prefix_value||lpad(assigned_sequence::text,10,'0');
 INSERT INTO public.canonical_customer_financial_numbering_reservations_v1(
  organization_id,policy_id,policy_digest,document_class,sequence_value,document_number,
  reservation_key_digest,reservation_request_digest,reserved_at)
 VALUES(org,policy_record.id,rtrim(policy_record.contract_digest),document_class_value,
  assigned_sequence,number_value,reservation_key_digest_value,reservation_request_digest_value,now_value)
 RETURNING * INTO reservation_record;
 INSERT INTO public.canonical_customer_financial_numbering_events_v1(
  organization_id,reservation_id,event_sequence,state,document_id,document_digest,
  event_key_digest,event_request_digest,reason_digest,occurred_at)
 VALUES(org,reservation_record.id,1,'reserved',NULL,NULL,reservation_key_digest_value,
  reservation_request_digest_value,NULL,now_value);
 SELECT event_value.* INTO reservation_event
 FROM public.canonical_customer_financial_numbering_events_v1 event_value
 WHERE event_value.organization_id=org AND event_value.reservation_id=reservation_record.id
  AND event_value.event_sequence=1;
 RETURN public.canonical_customer_financial_numbering_v1_reservation_event_projection(
  reservation_record,reservation_event);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_transition(
 org UUID,reservation_id_value UUID,expected_state_value TEXT,new_state_value TEXT,
 document_id_value UUID,document_digest_value TEXT,event_key_digest_value TEXT,
 event_request_digest_value TEXT,reason_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reservation_record public.canonical_customer_financial_numbering_reservations_v1%ROWTYPE;
 current_event public.canonical_customer_financial_numbering_events_v1%ROWTYPE;
 replay_event public.canonical_customer_financial_numbering_events_v1%ROWTYPE;
 next_sequence INTEGER;now_value TIMESTAMPTZ:=statement_timestamp();
BEGIN
 IF org IS NULL OR reservation_id_value IS NULL OR expected_state_value NOT IN('reserved','issued') OR
    new_state_value NOT IN('issued','void') OR
    event_key_digest_value IS NULL OR event_key_digest_value!~'^[0-9a-f]{64}$' OR
    event_request_digest_value IS NULL OR event_request_digest_value!~'^[0-9a-f]{64}$' OR
    reason_digest_value IS NULL OR reason_digest_value!~'^[0-9a-f]{64}$' OR
    (new_state_value='issued' AND (document_id_value IS NULL OR document_digest_value IS NULL OR
      document_digest_value!~'^[0-9a-f]{64}$')) OR
    (document_digest_value IS NOT NULL AND document_digest_value!~'^[0-9a-f]{64}$') THEN
  RAISE EXCEPTION 'Document number transition invalid' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':document-number-reservation:'||reservation_id_value::text,0));
 SELECT reservation.* INTO reservation_record
 FROM public.canonical_customer_financial_numbering_reservations_v1 reservation
 WHERE reservation.organization_id=org AND reservation.id=reservation_id_value FOR SHARE;
 IF reservation_record.id IS NULL THEN RAISE EXCEPTION 'Document number reservation unavailable'
  USING ERRCODE='55000';END IF;
 SELECT event_value.* INTO replay_event FROM public.canonical_customer_financial_numbering_events_v1 event_value
 WHERE event_value.organization_id=org AND event_value.reservation_id=reservation_id_value
  AND rtrim(event_value.event_key_digest)=event_key_digest_value;
 IF replay_event.reservation_id IS NOT NULL THEN
  IF rtrim(replay_event.event_request_digest)<>event_request_digest_value OR
     replay_event.state<>new_state_value OR
     replay_event.document_id IS DISTINCT FROM document_id_value OR
     rtrim(replay_event.document_digest) IS DISTINCT FROM document_digest_value OR
     rtrim(replay_event.reason_digest)<>reason_digest_value THEN
   RAISE EXCEPTION 'Document number transition idempotency conflict'
    USING ERRCODE='23505',CONSTRAINT='canonical_customer_financial_numbering_transition_conflict';END IF;
  RETURN public.canonical_customer_financial_numbering_v1_reservation_event_projection(
   reservation_record,replay_event);
 END IF;
 SELECT event_value.* INTO current_event FROM public.canonical_customer_financial_numbering_events_v1 event_value
 WHERE event_value.organization_id=org AND event_value.reservation_id=reservation_id_value
 ORDER BY event_value.event_sequence DESC LIMIT 1 FOR SHARE;
 IF current_event.state<>expected_state_value OR
    (expected_state_value='reserved' AND new_state_value NOT IN('issued','void')) OR
    (expected_state_value='issued' AND new_state_value<>'void') THEN
  RAISE EXCEPTION 'Document number transition conflict'
   USING ERRCODE='40001',CONSTRAINT='canonical_customer_financial_numbering_state_conflict';END IF;
 IF expected_state_value='reserved' AND new_state_value='void' AND
    (document_id_value IS NOT NULL OR document_digest_value IS NOT NULL) THEN
  RAISE EXCEPTION 'Reserved document number void cannot claim a document'
   USING ERRCODE='22023',CONSTRAINT='canonical_customer_financial_numbering_document_conflict';END IF;
 IF expected_state_value='issued' AND
    (document_id_value IS DISTINCT FROM current_event.document_id OR
     document_digest_value IS DISTINCT FROM rtrim(current_event.document_digest)) THEN
  RAISE EXCEPTION 'Document number transition document conflict'
   USING ERRCODE='40001',CONSTRAINT='canonical_customer_financial_numbering_document_conflict';END IF;
 next_sequence:=current_event.event_sequence+1;
 INSERT INTO public.canonical_customer_financial_numbering_events_v1(
  organization_id,reservation_id,event_sequence,state,document_id,document_digest,
  event_key_digest,event_request_digest,reason_digest,occurred_at)
 VALUES(org,reservation_id_value,next_sequence,new_state_value,document_id_value,
  document_digest_value,event_key_digest_value,event_request_digest_value,reason_digest_value,now_value);
 SELECT event_value.* INTO current_event
 FROM public.canonical_customer_financial_numbering_events_v1 event_value
 WHERE event_value.organization_id=org AND event_value.reservation_id=reservation_id_value
  AND event_value.event_sequence=next_sequence;
 RETURN public.canonical_customer_financial_numbering_v1_reservation_event_projection(
  reservation_record,current_event);
END $$;

CREATE FUNCTION public.canonical_customer_financial_numbering_v1_recover(
 org UUID,reservation_key_digest_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reservation_record public.canonical_customer_financial_numbering_reservations_v1%ROWTYPE;
BEGIN
 IF org IS NULL OR reservation_key_digest_value IS NULL OR
    reservation_key_digest_value!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Document number recovery invalid' USING ERRCODE='22023';END IF;
 SELECT reservation.* INTO reservation_record
 FROM public.canonical_customer_financial_numbering_reservations_v1 reservation
 WHERE reservation.organization_id=org
  AND rtrim(reservation.reservation_key_digest)=reservation_key_digest_value;
 IF reservation_record.id IS NULL THEN
  RETURN jsonb_build_object('version','m27-document-number-reservation-v1',
   'available',FALSE,'value',NULL,'reason','source_authority_unavailable');
 END IF;
 RETURN jsonb_build_object('version','m27-document-number-reservation-v1',
  'available',TRUE,'value',public.canonical_customer_financial_numbering_v1_reservation_projection(
   reservation_record),'reason',NULL);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_numbering_capability_grants_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_numbering_capability_heads_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_numbering_policies_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_numbering_policy_requests_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_numbering_sequences_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_numbering_reservations_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_numbering_events_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_exact_money(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_grant_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_grant_head() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_effect_grant_fence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_access(UUID,UUID,TEXT,UUID,TEXT,BOOLEAN,UUID,BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_projection(UUID,public.canonical_customer_financial_numbering_policies_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_candidate(UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_read(UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_review(UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_reservation_event_projection(public.canonical_customer_financial_numbering_reservations_v1,public.canonical_customer_financial_numbering_events_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_reservation_projection(public.canonical_customer_financial_numbering_reservations_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_reserve(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_transition(UUID,UUID,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_recover(UUID,TEXT) FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_numbering_v1_candidate(
  UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_numbering_v1_read(
  UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_numbering_v1_review(
  UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO northstar_app_runtime;
END IF;END $$;
