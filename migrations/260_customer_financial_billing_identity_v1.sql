-- Mission 27 Part 2A: one tenant-private billing party for one existing
-- canonical customer, plus an immutable unreviewed origin snapshot. This
-- migration never creates, merges, or corrects a customer and grants no
-- invoice, payment, delivery, tax, or provider authority.

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Customer financial billing identity history is immutable'
  USING ERRCODE='55000';
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_utc(value TIMESTAMPTZ)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_source_digest(
 value public.canonical_customers)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_completion_digest(jsonb_build_object(
  'version','m27-billing-customer-source-v1',
  'organizationId',value.organization_id,
  'customerId',value.id,
  'operationId',value.operation_id,
  'graphId',value.graph_id,
  'externalCustomerId',value.external_customer_id,
  'name',value.name,
  'email',value.email,
  'phone',value.phone,
  'address',value.address,
  'createdAt',public.canonical_customer_financial_billing_identity_v1_utc(value.created_at),
  'updatedAt',public.canonical_customer_financial_billing_identity_v1_utc(value.updated_at)))
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_source(
 value public.canonical_customers,
 billing_party_id_value UUID,
 actor_user_id_value UUID,
 actor_access_role_value TEXT,
 membership_id_value UUID,
 auth_session_id_value UUID,
 captured_at_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_digest_value TEXT;
BEGIN
 IF value.created_at>value.updated_at OR value.updated_at>captured_at_value OR
    (value.address IS NOT NULL AND (jsonb_typeof(value.address)<>'object' OR
     octet_length(value.address::text)>16384)) THEN RETURN NULL;END IF;
 source_digest_value:=public.canonical_customer_financial_billing_identity_v1_source_digest(value);
 RETURN jsonb_build_object(
  'version','m27-billing-identity-origin-v1',
  'organizationId',value.organization_id,
  'billingPartyId',billing_party_id_value,
  'customer',jsonb_build_object(
   'identityKind','canonical_customer','id',value.id,
   'source',jsonb_build_object(
    'class','canonical_customer.v1','operationId',value.operation_id,
    'graphId',value.graph_id,'externalCustomerId',value.external_customer_id,
    'createdAt',public.canonical_customer_financial_billing_identity_v1_utc(value.created_at),
    'updatedAt',public.canonical_customer_financial_billing_identity_v1_utc(value.updated_at),
    'digest',source_digest_value)),
  'name',CASE WHEN value.name IS NULL OR btrim(value.name)=''
   THEN jsonb_build_object('state','unavailable','value',NULL,'reason','source_value_missing')
   ELSE jsonb_build_object('state','source_candidate','value',value.name,'reason',NULL) END,
  'address',CASE WHEN value.address IS NULL
   THEN jsonb_build_object('state','unavailable','value',NULL,'reason','source_value_missing','sourceRole','unclassified_customer_address')
   ELSE jsonb_build_object('state','source_candidate','value',value.address,'reason',NULL,'sourceRole','unclassified_customer_address') END,
  'contact',jsonb_build_object(
   'email',CASE WHEN value.email IS NULL OR btrim(value.email)=''
    THEN jsonb_build_object('state','unavailable','value',NULL,'reason','source_value_missing')
    ELSE jsonb_build_object('state','source_candidate','value',value.email,'reason',NULL) END,
   'phone',CASE WHEN value.phone IS NULL OR btrim(value.phone)=''
    THEN jsonb_build_object('state','unavailable','value',NULL,'reason','source_value_missing')
    ELSE jsonb_build_object('state','source_candidate','value',value.phone,'reason',NULL) END),
  'tax',jsonb_build_object('state','unavailable','value',NULL,'reason','owner_review_required'),
  'exemption',jsonb_build_object('state','unavailable','value',NULL,'reason','owner_review_required'),
  'delivery',jsonb_build_object('state','unavailable','value',NULL,'reason','owner_review_required'),
  'actor',jsonb_build_object('userId',actor_user_id_value,'accessRole',actor_access_role_value,
   'membershipId',membership_id_value,'authSessionId',auth_session_id_value),
  'capturedAt',public.canonical_customer_financial_billing_identity_v1_utc(captured_at_value),
  'reviewState','unreviewed','documentUseAuthorized',FALSE,
  'automaticCustomerCreationAuthorized',FALSE);
END $$;

CREATE TABLE public.canonical_customer_financial_billing_parties_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 customer_id UUID NOT NULL,
 established_at TIMESTAMPTZ NOT NULL,
 source_customer_updated_at TIMESTAMPTZ NOT NULL,
 source_customer_digest CHAR(64) NOT NULL CHECK(source_customer_digest~'^[0-9a-f]{64}$'),
 established_by_user_id UUID NOT NULL,
 established_by_access_role TEXT NOT NULL CHECK(established_by_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 establishment_reason TEXT NOT NULL CHECK(
  establishment_reason=btrim(establishment_reason) AND octet_length(establishment_reason) BETWEEN 12 AND 500),
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,customer_id),
 UNIQUE(organization_id,id,customer_id),
 FOREIGN KEY(organization_id,customer_id)
  REFERENCES public.canonical_customers(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,established_by_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_customer_financial_billing_identity_snapshots_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 billing_party_id UUID NOT NULL,
 customer_id UUID NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence=1),
 snapshot_kind TEXT NOT NULL CHECK(snapshot_kind='party_origin_unreviewed'),
 captured_at TIMESTAMPTZ NOT NULL,
 source_customer_updated_at TIMESTAMPTZ NOT NULL,
 source_customer_digest CHAR(64) NOT NULL CHECK(source_customer_digest~'^[0-9a-f]{64}$'),
 snapshot JSONB NOT NULL,
 snapshot_digest CHAR(64) NOT NULL CHECK(snapshot_digest~'^[0-9a-f]{64}$'),
 captured_by_user_id UUID NOT NULL,
 captured_by_access_role TEXT NOT NULL CHECK(captured_by_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,billing_party_id,sequence),
 UNIQUE(organization_id,id,billing_party_id,customer_id),
 FOREIGN KEY(organization_id,billing_party_id,customer_id)
  REFERENCES public.canonical_customer_financial_billing_parties_v1(organization_id,id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,customer_id)
  REFERENCES public.canonical_customers(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,captured_by_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(octet_length(snapshot::text)<=32768),
 CHECK(rtrim(snapshot_digest)=public.canonical_completion_digest(snapshot)),
 CHECK(snapshot->>'version'='m27-billing-identity-origin-v1'),
 CHECK(snapshot->>'organizationId'=organization_id::text),
 CHECK(snapshot->>'billingPartyId'=billing_party_id::text),
 CHECK(snapshot->'customer'->>'id'=customer_id::text),
 CHECK(snapshot->>'reviewState'='unreviewed'),
 CHECK(snapshot->'documentUseAuthorized'='false'::jsonb),
 CHECK(snapshot->'automaticCustomerCreationAuthorized'='false'::jsonb)
);

CREATE TABLE public.canonical_customer_financial_billing_identity_requests_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 customer_id UUID NOT NULL,
 billing_party_id UUID NOT NULL,
 snapshot_id UUID NOT NULL,
 response_status INTEGER NOT NULL CHECK(response_status=201),
 response_digest CHAR(64) NOT NULL CHECK(response_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,billing_party_id,customer_id)
  REFERENCES public.canonical_customer_financial_billing_parties_v1(organization_id,id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,snapshot_id,billing_party_id,customer_id)
  REFERENCES public.canonical_customer_financial_billing_identity_snapshots_v1(
   organization_id,id,billing_party_id,customer_id) ON DELETE RESTRICT,
 CHECK(response_digest~'^[0-9a-f]{64}$')
);

CREATE TRIGGER canonical_customer_financial_billing_parties_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billing_parties_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();
CREATE TRIGGER canonical_customer_financial_billing_identity_snapshots_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billing_identity_snapshots_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();
CREATE TRIGGER canonical_customer_financial_billing_identity_requests_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billing_identity_requests_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_access(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,write_value BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'Billing identity access restricted'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_billing_identity_unauthorized';
 END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,write_value);
 PERFORM 1 FROM public.subscriptions subscription
 JOIN public.organization_onboarding onboarding
  ON onboarding.organization_id=subscription.organization_id
 WHERE subscription.organization_id=org AND onboarding.status='complete'
  AND (subscription.status='active' OR
   (subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
    AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days'
    AND subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Current billing identity access unavailable'
  USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_billing_identity_unauthorized';END IF;
 RETURN authority;
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_unavailable(
 code_value TEXT,customer_id_value UUID,billing_party_id_value UUID,snapshot_id_value UUID,current_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m27-billing-identity-v1','state','unavailable','available',FALSE,
  'current',current_value,'reason',code_value,'customerId',customer_id_value,
  'billingPartyId',billing_party_id_value,'snapshotId',snapshot_id_value,
  'sourceDigest',NULL,'sourceUpdatedAt',NULL,'reviewState',NULL,
  'documentUseAuthorized',FALSE,'value',NULL,'automaticCustomerCreationAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_saved_projection(
 party_record public.canonical_customer_financial_billing_parties_v1,
 snapshot_record public.canonical_customer_financial_billing_identity_snapshots_v1)
RETURNS JSONB LANGUAGE SQL IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'version','m27-billing-identity-v1','state','established_unreviewed','available',TRUE,
  'current',TRUE,'reason',NULL,'customerId',party_record.customer_id,
  'billingPartyId',party_record.id,'snapshotId',snapshot_record.id,
  'sourceDigest',rtrim(snapshot_record.source_customer_digest),
  'sourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(snapshot_record.source_customer_updated_at),
  'reviewState','unreviewed','documentUseAuthorized',FALSE,
 'value',snapshot_record.snapshot,'automaticCustomerCreationAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_projection(
 customer_record public.canonical_customers,
 party_record public.canonical_customer_financial_billing_parties_v1,
 snapshot_record public.canonical_customer_financial_billing_identity_snapshots_v1)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_digest TEXT;
BEGIN
 current_digest:=public.canonical_customer_financial_billing_identity_v1_source_digest(customer_record);
 IF rtrim(party_record.source_customer_digest)<>current_digest OR
    party_record.source_customer_updated_at<>customer_record.updated_at OR
    rtrim(snapshot_record.source_customer_digest)<>current_digest OR
    snapshot_record.source_customer_updated_at<>customer_record.updated_at THEN
  RETURN public.canonical_customer_financial_billing_identity_v1_unavailable(
   'billing_identity_source_changed_requires_review',customer_record.id,party_record.id,snapshot_record.id,FALSE);
 END IF;
 RETURN public.canonical_customer_financial_billing_identity_v1_saved_projection(
  party_record,snapshot_record);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_candidate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,customer_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;customer_record public.canonical_customers%ROWTYPE;
 party_record public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 snapshot_record public.canonical_customer_financial_billing_identity_snapshots_v1%ROWTYPE;
 candidate_value JSONB;
BEGIN
 authority:=public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO customer_record FROM public.canonical_customers customer
  WHERE customer.organization_id=org AND customer.id=customer_id_value;
 IF customer_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_identity_v1_unavailable(
  'billing_customer_identity_unavailable',NULL,NULL,NULL,NULL);END IF;
 SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
  WHERE party.organization_id=org AND party.customer_id=customer_id_value;
 IF party_record.id IS NOT NULL THEN
  SELECT * INTO snapshot_record FROM public.canonical_customer_financial_billing_identity_snapshots_v1 snapshot
   WHERE snapshot.organization_id=org AND snapshot.billing_party_id=party_record.id AND snapshot.sequence=1;
  IF snapshot_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_identity_v1_unavailable(
   'billing_identity_history_unavailable',customer_record.id,party_record.id,NULL,NULL);END IF;
  RETURN public.canonical_customer_financial_billing_identity_v1_projection(
   customer_record,party_record,snapshot_record);
 END IF;
 candidate_value:=public.canonical_customer_financial_billing_identity_v1_source(
  customer_record,NULL,actor,role_value,(authority->>'membershipId')::uuid,
  session_value,statement_timestamp());
 IF candidate_value IS NULL THEN RETURN public.canonical_customer_financial_billing_identity_v1_unavailable(
  'billing_customer_source_shape_unavailable',customer_record.id,NULL,NULL,NULL);END IF;
 RETURN jsonb_build_object(
  'version','m27-billing-identity-v1','state','candidate_unreviewed','available',TRUE,
  'current',TRUE,'reason',NULL,'customerId',customer_record.id,
  'billingPartyId',NULL,'snapshotId',NULL,
  'sourceDigest',public.canonical_customer_financial_billing_identity_v1_source_digest(customer_record),
  'sourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(customer_record.updated_at),
  'reviewState','unreviewed','documentUseAuthorized',FALSE,'value',candidate_value,
  'automaticCustomerCreationAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,customer_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE customer_record public.canonical_customers%ROWTYPE;
 party_record public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 snapshot_record public.canonical_customer_financial_billing_identity_snapshots_v1%ROWTYPE;
BEGIN
 PERFORM public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO customer_record FROM public.canonical_customers customer
  WHERE customer.organization_id=org AND customer.id=customer_id_value;
 IF customer_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_identity_v1_unavailable(
  'billing_customer_identity_unavailable',NULL,NULL,NULL,NULL);END IF;
 SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
  WHERE party.organization_id=org AND party.customer_id=customer_id_value;
 IF party_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_identity_v1_unavailable(
  'billing_identity_not_established',customer_record.id,NULL,NULL,NULL);END IF;
 SELECT * INTO snapshot_record FROM public.canonical_customer_financial_billing_identity_snapshots_v1 snapshot
  WHERE snapshot.organization_id=org AND snapshot.billing_party_id=party_record.id AND snapshot.sequence=1;
 IF snapshot_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_identity_v1_unavailable(
  'billing_identity_history_unavailable',customer_record.id,party_record.id,NULL,NULL);END IF;
 RETURN public.canonical_customer_financial_billing_identity_v1_projection(
  customer_record,party_record,snapshot_record);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_identity_v1_establish(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 customer_id_value UUID,expected_source_digest_value TEXT,expected_source_updated_at_value TIMESTAMPTZ,
 reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;customer_record public.canonical_customers%ROWTYPE;
 party_record public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 snapshot_record public.canonical_customer_financial_billing_identity_snapshots_v1%ROWTYPE;
 request_record public.canonical_customer_financial_billing_identity_requests_v1%ROWTYPE;
 key_digest_value TEXT;request_digest_value TEXT;source_digest_value TEXT;
 snapshot_value JSONB;response_value JSONB;captured_at_value TIMESTAMPTZ;
 party_id_value UUID:=gen_random_uuid();snapshot_id_value UUID:=gen_random_uuid();
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable transaction required for billing identity establishment'
   USING ERRCODE='25001';END IF;
 authority:=public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    expected_source_digest_value IS NULL OR expected_source_digest_value!~'^[0-9a-f]{64}$' OR
    expected_source_updated_at_value IS NULL OR reason_value IS NULL OR
    reason_value<>btrim(reason_value) OR octet_length(reason_value) NOT BETWEEN 12 AND 500 THEN
  RAISE EXCEPTION 'Billing identity establishment request invalid' USING ERRCODE='22023';END IF;
 key_digest_value:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m27-billing-identity-establish-request-v1','organizationId',org,
  'actorUserId',actor,'authSessionId',session_value,'customerId',customer_id_value,
  'expectedSourceDigest',expected_source_digest_value,
  'expectedSourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(expected_source_updated_at_value),
  'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':billing-identity-request:'||actor::text||':'||session_value::text||':'||key_digest_value,0));
 SELECT * INTO request_record FROM public.canonical_customer_financial_billing_identity_requests_v1 request
  WHERE request.organization_id=org AND request.actor_user_id=actor
   AND request.auth_session_id=session_value AND rtrim(request.request_key_digest)=key_digest_value;
 IF request_record.customer_id IS NOT NULL THEN
  IF rtrim(request_record.request_digest)<>request_digest_value THEN
   RAISE EXCEPTION 'Billing identity idempotency conflict'
    USING ERRCODE='23505',CONSTRAINT='canonical_customer_financial_billing_identity_idempotency_conflict';
  END IF;
  SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
   WHERE party.organization_id=org AND party.id=request_record.billing_party_id;
  SELECT * INTO snapshot_record FROM public.canonical_customer_financial_billing_identity_snapshots_v1 snapshot
   WHERE snapshot.organization_id=org AND snapshot.id=request_record.snapshot_id;
  IF party_record.id IS NULL OR snapshot_record.id IS NULL THEN
   RAISE EXCEPTION 'Billing identity replay history unavailable' USING ERRCODE='55000';END IF;
  response_value:=public.canonical_customer_financial_billing_identity_v1_saved_projection(
   party_record,snapshot_record);
  IF rtrim(request_record.response_digest)<>public.canonical_completion_digest(response_value) THEN
   RAISE EXCEPTION 'Billing identity replay digest invalid' USING ERRCODE='55000';END IF;
  RETURN jsonb_build_object('status',200,'body',response_value,'replayed',TRUE);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billing-identity-customer:'||customer_id_value::text,0));
 SELECT * INTO customer_record FROM public.canonical_customers customer
  WHERE customer.organization_id=org AND customer.id=customer_id_value FOR SHARE;
 IF customer_record.id IS NULL THEN RETURN jsonb_build_object('status',409,'body',
  public.canonical_customer_financial_billing_identity_v1_unavailable(
   'billing_customer_identity_unavailable',NULL,NULL,NULL,NULL),'replayed',FALSE);END IF;
 source_digest_value:=public.canonical_customer_financial_billing_identity_v1_source_digest(customer_record);
 IF source_digest_value<>expected_source_digest_value OR
    customer_record.updated_at<>expected_source_updated_at_value THEN
  RETURN jsonb_build_object('status',409,'body',
   public.canonical_customer_financial_billing_identity_v1_unavailable(
    'billing_customer_source_changed',customer_record.id,NULL,NULL,FALSE),'replayed',FALSE);END IF;
 SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
  WHERE party.organization_id=org AND party.customer_id=customer_id_value;
 IF party_record.id IS NOT NULL THEN
  SELECT * INTO snapshot_record FROM public.canonical_customer_financial_billing_identity_snapshots_v1 snapshot
   WHERE snapshot.organization_id=org AND snapshot.billing_party_id=party_record.id AND snapshot.sequence=1;
  IF snapshot_record.id IS NULL THEN RETURN jsonb_build_object('status',409,'body',
   public.canonical_customer_financial_billing_identity_v1_unavailable(
    'billing_identity_history_unavailable',customer_record.id,party_record.id,NULL,NULL),'replayed',FALSE);END IF;
  response_value:=public.canonical_customer_financial_billing_identity_v1_projection(
   customer_record,party_record,snapshot_record);
  IF response_value->>'state'='unavailable' THEN RETURN jsonb_build_object(
   'status',409,'body',response_value,'replayed',FALSE);END IF;
  RETURN jsonb_build_object('status',200,'body',response_value,'replayed',FALSE);
 END IF;
 captured_at_value:=statement_timestamp();
 snapshot_value:=public.canonical_customer_financial_billing_identity_v1_source(
  customer_record,party_id_value,actor,role_value,(authority->>'membershipId')::uuid,
  session_value,captured_at_value);
 IF snapshot_value IS NULL THEN RETURN jsonb_build_object('status',409,'body',
  public.canonical_customer_financial_billing_identity_v1_unavailable(
   'billing_customer_source_shape_unavailable',customer_record.id,NULL,NULL,NULL),'replayed',FALSE);END IF;
 INSERT INTO public.canonical_customer_financial_billing_parties_v1(
  organization_id,id,customer_id,established_at,source_customer_updated_at,
  source_customer_digest,established_by_user_id,established_by_access_role,
  membership_id,auth_session_id,establishment_reason)
 VALUES(org,party_id_value,customer_id_value,captured_at_value,customer_record.updated_at,
  source_digest_value,actor,role_value,(authority->>'membershipId')::uuid,session_value,reason_value)
 RETURNING * INTO party_record;
 INSERT INTO public.canonical_customer_financial_billing_identity_snapshots_v1(
  organization_id,id,billing_party_id,customer_id,sequence,snapshot_kind,captured_at,
  source_customer_updated_at,source_customer_digest,snapshot,snapshot_digest,
  captured_by_user_id,captured_by_access_role,membership_id,auth_session_id)
 VALUES(org,snapshot_id_value,party_id_value,customer_id_value,1,'party_origin_unreviewed',captured_at_value,
  customer_record.updated_at,source_digest_value,snapshot_value,
  public.canonical_completion_digest(snapshot_value),actor,role_value,
  (authority->>'membershipId')::uuid,session_value)
 RETURNING * INTO snapshot_record;
 response_value:=public.canonical_customer_financial_billing_identity_v1_projection(
  customer_record,party_record,snapshot_record);
 INSERT INTO public.canonical_customer_financial_billing_identity_requests_v1(
 organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,
  customer_id,billing_party_id,snapshot_id,response_status,response_digest,created_at)
 VALUES(org,actor,session_value,key_digest_value,request_digest_value,customer_id_value,
  party_id_value,snapshot_id_value,201,
  public.canonical_completion_digest(response_value),captured_at_value);
 RETURN jsonb_build_object('status',201,'body',response_value,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_billing_parties_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_billing_identity_snapshots_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_billing_identity_requests_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_utc(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_source_digest(public.canonical_customers) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_source(public.canonical_customers,UUID,UUID,TEXT,UUID,UUID,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_access(UUID,UUID,TEXT,UUID,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_unavailable(TEXT,UUID,UUID,UUID,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_projection(public.canonical_customers,public.canonical_customer_financial_billing_parties_v1,public.canonical_customer_financial_billing_identity_snapshots_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_saved_projection(public.canonical_customer_financial_billing_parties_v1,public.canonical_customer_financial_billing_identity_snapshots_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_candidate(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_identity_v1_establish(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_identity_v1_candidate(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_identity_v1_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_identity_v1_establish(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ,TEXT) TO northstar_app_runtime;
END IF;END $$;
