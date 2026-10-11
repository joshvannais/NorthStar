-- Mission 27 Part 2B: owner/admin-reviewed billing contacts, service and
-- billing addresses, customer references, exact currentness and append-only
-- correction lineage for the Part 2A billing party. This migration creates no
-- customer, prospect, estimate, invoice, payment, provider or receiver record.

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_address_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF value IS NULL OR jsonb_typeof(value)<>'object' THEN RETURN FALSE; END IF;
 RETURN (SELECT count(*) FROM jsonb_object_keys(value))=6
  AND value ?& ARRAY['line1','line2','city','region','postalCode','countryCode']
  AND jsonb_typeof(value->'line1')='string'
  AND value->>'line1'=btrim(value->>'line1')
  AND octet_length(value->>'line1') BETWEEN 1 AND 255
  AND ((value->'line2')='null'::jsonb OR
   (jsonb_typeof(value->'line2')='string' AND value->>'line2'=btrim(value->>'line2')
    AND octet_length(value->>'line2') BETWEEN 1 AND 255))
  AND jsonb_typeof(value->'city')='string' AND value->>'city'=btrim(value->>'city')
  AND octet_length(value->>'city') BETWEEN 1 AND 100
  AND jsonb_typeof(value->'region')='string'
  AND value->>'region' IN('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
   'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
   'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC')
  AND jsonb_typeof(value->'postalCode')='string'
  AND value->>'postalCode'~'^[0-9]{5}(-[0-9]{4})?$'
  AND value->>'countryCode'='US';
END
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_payload_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF value IS NULL OR jsonb_typeof(value)<>'object' THEN RETURN FALSE; END IF;
 IF jsonb_typeof(value->'contact')<>'object' THEN RETURN FALSE; END IF;
 RETURN (SELECT count(*) FROM jsonb_object_keys(value))=5
  AND value ?& ARRAY['contact','serviceAddress','billingAddress','purchaseOrderReference','customerReference']
  AND jsonb_typeof(value->'contact')='object'
  AND (SELECT count(*) FROM jsonb_object_keys(value->'contact'))=3
  AND value->'contact' ?& ARRAY['name','email','phone']
  AND jsonb_typeof(value->'contact'->'name')='string'
  AND value->'contact'->>'name'=btrim(value->'contact'->>'name')
  AND octet_length(value->'contact'->>'name') BETWEEN 1 AND 255
  AND ((value->'contact'->'email')='null'::jsonb OR
   (jsonb_typeof(value->'contact'->'email')='string'
    AND value->'contact'->>'email'=btrim(value->'contact'->>'email')
    AND octet_length(value->'contact'->>'email') BETWEEN 3 AND 255
    AND value->'contact'->>'email'~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  AND ((value->'contact'->'phone')='null'::jsonb OR
   (jsonb_typeof(value->'contact'->'phone')='string'
    AND value->'contact'->>'phone'~'^\+[1-9][0-9]{7,14}$'))
  AND ((value->'contact'->'email')<>'null'::jsonb OR (value->'contact'->'phone')<>'null'::jsonb)
  AND public.canonical_customer_financial_billing_review_v1_address_valid(value->'serviceAddress')
  AND public.canonical_customer_financial_billing_review_v1_address_valid(value->'billingAddress')
  AND ((value->'purchaseOrderReference')='null'::jsonb OR
   (jsonb_typeof(value->'purchaseOrderReference')='string'
    AND value->>'purchaseOrderReference'=btrim(value->>'purchaseOrderReference')
    AND octet_length(value->>'purchaseOrderReference') BETWEEN 1 AND 100))
  AND ((value->'customerReference')='null'::jsonb OR
   (jsonb_typeof(value->'customerReference')='string'
    AND value->>'customerReference'=btrim(value->>'customerReference')
    AND octet_length(value->>'customerReference') BETWEEN 1 AND 100))
  AND octet_length(value::text)<=32768;
END
$$;

CREATE TABLE public.canonical_customer_financial_billing_identity_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 billing_party_id UUID NOT NULL,
 customer_id UUID NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),
 previous_review_id UUID,
 origin_snapshot_id UUID NOT NULL,
 origin_snapshot_digest CHAR(64) NOT NULL CHECK(origin_snapshot_digest~'^[0-9a-f]{64}$'),
 source_customer_updated_at TIMESTAMPTZ NOT NULL,
 source_customer_digest CHAR(64) NOT NULL CHECK(source_customer_digest~'^[0-9a-f]{64}$'),
 billing_contact_id UUID NOT NULL,
 service_address_id UUID NOT NULL,
 billing_address_id UUID NOT NULL,
 reviewed_snapshot JSONB NOT NULL,
 reviewed_snapshot_digest CHAR(64) NOT NULL CHECK(reviewed_snapshot_digest~'^[0-9a-f]{64}$'),
 reviewed_by_user_id UUID NOT NULL,
 reviewed_by_access_role TEXT NOT NULL CHECK(reviewed_by_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 capability_grant_id UUID NOT NULL,
 capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.billing_identity'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 correction_reason TEXT NOT NULL CHECK(
  correction_reason=btrim(correction_reason) AND octet_length(correction_reason) BETWEEN 12 AND 500),
 reviewed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,id,billing_party_id,customer_id),
 UNIQUE(organization_id,billing_party_id,sequence),
 UNIQUE(organization_id,billing_party_id,previous_review_id),
 FOREIGN KEY(organization_id,billing_party_id,customer_id)
  REFERENCES public.canonical_customer_financial_billing_parties_v1(organization_id,id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,origin_snapshot_id,billing_party_id,customer_id)
  REFERENCES public.canonical_customer_financial_billing_identity_snapshots_v1(
   organization_id,id,billing_party_id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_review_id,billing_party_id,customer_id)
  REFERENCES public.canonical_customer_financial_billing_identity_reviews_v1(
   organization_id,id,billing_party_id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,reviewed_by_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_billing_capability_grants_v1(
   organization_id,id,revision) ON DELETE RESTRICT,
 CHECK((sequence=1 AND previous_review_id IS NULL) OR (sequence>1 AND previous_review_id IS NOT NULL)),
 CHECK(rtrim(reviewed_snapshot_digest)=public.canonical_completion_digest(reviewed_snapshot)),
 CHECK(reviewed_snapshot->>'version'='m27-billing-identity-review-v1'),
 CHECK(reviewed_snapshot->>'organizationId'=organization_id::text),
 CHECK(reviewed_snapshot->>'billingPartyId'=billing_party_id::text),
 CHECK(reviewed_snapshot->>'customerId'=customer_id::text),
 CHECK(reviewed_snapshot->>'reviewId'=id::text),
 CHECK((reviewed_snapshot->>'sequence')::integer=sequence),
 CHECK(reviewed_snapshot->>'reviewState'='reviewed'),
 CHECK(reviewed_snapshot->'documentUseAuthorized'='true'::jsonb),
 CHECK(reviewed_snapshot->'automaticCustomerCreationAuthorized'='false'::jsonb),
 CHECK(reviewed_snapshot->'prospectIdentity'->>'reason'='canonical_prospect_source_unavailable'),
 CHECK(octet_length(reviewed_snapshot::text)<=65536)
);

CREATE TABLE public.canonical_customer_financial_billing_review_requests_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 customer_id UUID NOT NULL,
 billing_party_id UUID NOT NULL,
 review_id UUID NOT NULL,
 response_status INTEGER NOT NULL CHECK(response_status=201),
 response_digest CHAR(64) NOT NULL CHECK(response_digest~'^[0-9a-f]{64}$'),
 capability_grant_id UUID NOT NULL,
 capability_grant_revision BIGINT NOT NULL,
 business_purpose TEXT NOT NULL CHECK(business_purpose='customer_financial.billing_identity'),
 policy_version TEXT NOT NULL CHECK(policy_version='mission27.launch.v1'),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,actor_user_id,auth_session_id,request_key_digest),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,review_id,billing_party_id,customer_id)
  REFERENCES public.canonical_customer_financial_billing_identity_reviews_v1(
   organization_id,id,billing_party_id,customer_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,capability_grant_id,capability_grant_revision)
  REFERENCES public.canonical_customer_financial_billing_capability_grants_v1(
   organization_id,id,revision) ON DELETE RESTRICT
);

CREATE TRIGGER canonical_customer_financial_billing_identity_reviews_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billing_identity_reviews_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();
CREATE TRIGGER canonical_customer_financial_billing_review_requests_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_financial_billing_review_requests_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_financial_billing_identity_v1_immutable();

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_field(
 value JSONB,source_value JSONB,source_digest_value TEXT,source_updated_at_value TIMESTAMPTZ,
 actor_value UUID,review_id_value UUID)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',CASE WHEN value='null'::jsonb THEN 'not_supplied' ELSE 'reviewed' END,
  'value',value,'provenance',jsonb_build_object(
   'class',CASE WHEN value<>'null'::jsonb AND value=source_value THEN 'canonical_customer.v1'
    ELSE 'owner_admin_review.v1' END,
   'customerSourceDigest',source_digest_value,
   'customerSourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(source_updated_at_value),
   'reviewActorUserId',actor_value,'reviewId',review_id_value))
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_snapshot(
 customer_record public.canonical_customers,
 party_record public.canonical_customer_financial_billing_parties_v1,
 origin_record public.canonical_customer_financial_billing_identity_snapshots_v1,
 previous_record public.canonical_customer_financial_billing_identity_reviews_v1,
 review_id_value UUID,sequence_value INTEGER,contact_id_value UUID,
 service_address_id_value UUID,billing_address_id_value UUID,payload_value JSONB,
 actor_value UUID,role_value TEXT,membership_id_value UUID,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT,reason_value TEXT,reviewed_at_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_digest_value TEXT;
BEGIN
 source_digest_value:=public.canonical_customer_financial_billing_identity_v1_source_digest(customer_record);
 RETURN jsonb_build_object(
  'version','m27-billing-identity-review-v1','organizationId',customer_record.organization_id,
  'billingPartyId',party_record.id,'customerId',customer_record.id,'reviewId',review_id_value,
  'sequence',sequence_value,'previousReviewId',previous_record.id,
  'previousReviewDigest',CASE WHEN previous_record.id IS NULL THEN NULL ELSE rtrim(previous_record.reviewed_snapshot_digest) END,
  'origin',jsonb_build_object('snapshotId',origin_record.id,
   'snapshotDigest',rtrim(origin_record.snapshot_digest)),
  'customerIdentity',jsonb_build_object('kind','canonical_customer','id',customer_record.id,
   'source',jsonb_build_object('class','canonical_customer.v1','operationId',customer_record.operation_id,
    'graphId',customer_record.graph_id,'externalCustomerId',customer_record.external_customer_id,
    'digest',source_digest_value,
    'updatedAt',public.canonical_customer_financial_billing_identity_v1_utc(customer_record.updated_at))),
  'prospectIdentity',jsonb_build_object('state','unavailable','value',NULL,
   'reason','canonical_prospect_source_unavailable'),
  'billingContact',jsonb_build_object('id',contact_id_value,
   'name',public.canonical_customer_financial_billing_review_v1_field(
    payload_value->'contact'->'name',to_jsonb(customer_record.name),source_digest_value,
    customer_record.updated_at,actor_value,review_id_value),
   'email',public.canonical_customer_financial_billing_review_v1_field(
    payload_value->'contact'->'email',to_jsonb(customer_record.email),source_digest_value,
    customer_record.updated_at,actor_value,review_id_value),
   'phone',public.canonical_customer_financial_billing_review_v1_field(
    payload_value->'contact'->'phone',to_jsonb(customer_record.phone),source_digest_value,
    customer_record.updated_at,actor_value,review_id_value)),
  'serviceLocation',jsonb_build_object('id',service_address_id_value,
   'address',public.canonical_customer_financial_billing_review_v1_field(
    payload_value->'serviceAddress',customer_record.address,source_digest_value,
    customer_record.updated_at,actor_value,review_id_value)),
  'billingAddress',jsonb_build_object('id',billing_address_id_value,
   'address',public.canonical_customer_financial_billing_review_v1_field(
    payload_value->'billingAddress',customer_record.address,source_digest_value,
    customer_record.updated_at,actor_value,review_id_value)),
  'references',jsonb_build_object(
   'purchaseOrder',public.canonical_customer_financial_billing_review_v1_field(
    payload_value->'purchaseOrderReference','null'::jsonb,source_digest_value,
    customer_record.updated_at,actor_value,review_id_value),
   'customer',public.canonical_customer_financial_billing_review_v1_field(
    payload_value->'customerReference','null'::jsonb,source_digest_value,
    customer_record.updated_at,actor_value,review_id_value)),
  'actor',jsonb_build_object('userId',actor_value,'accessRole',role_value,
   'membershipId',membership_id_value,'authSessionId',session_value,
   'capability','customer_financial.billing_identity.review',
   'capabilityGrantId',capability_grant_id_value,
   'capabilityGrantRevision',capability_grant_revision_value,
   'businessPurpose',business_purpose_value,'policyVersion',policy_version_value),
  'reason',reason_value,
  'sourceCustomerDigest',source_digest_value,
  'sourceCustomerUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(customer_record.updated_at),
  'reviewedAt',public.canonical_customer_financial_billing_identity_v1_utc(reviewed_at_value),
  'reviewState','reviewed','documentUseAuthorized',TRUE,
  'automaticCustomerCreationAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_unavailable(
 code_value TEXT,customer_id_value UUID,billing_party_id_value UUID,review_id_value UUID,current_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('version','m27-billing-identity-review-state-v1',
  'state','unavailable','available',FALSE,'current',current_value,'reason',code_value,
  'customerId',customer_id_value,'billingPartyId',billing_party_id_value,
  'reviewId',review_id_value,'sequence',NULL,'sourceDigest',NULL,'sourceUpdatedAt',NULL,
  'reviewDigest',NULL,'reviewState',NULL,'documentUseAuthorized',FALSE,'value',NULL,
  'automaticCustomerCreationAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_saved_projection(
 review_record public.canonical_customer_financial_billing_identity_reviews_v1)
RETURNS JSONB LANGUAGE SQL IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('version','m27-billing-identity-review-state-v1',
  'state','reviewed_current','available',TRUE,'current',TRUE,'reason',NULL,
  'customerId',review_record.customer_id,'billingPartyId',review_record.billing_party_id,
  'reviewId',review_record.id,'sequence',review_record.sequence,
  'sourceDigest',rtrim(review_record.source_customer_digest),
  'sourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(
   review_record.source_customer_updated_at),
  'reviewDigest',rtrim(review_record.reviewed_snapshot_digest),'reviewState','reviewed',
  'documentUseAuthorized',TRUE,'value',review_record.reviewed_snapshot,
  'automaticCustomerCreationAuthorized',FALSE)
$$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_projection(
 customer_record public.canonical_customers,
 review_record public.canonical_customer_financial_billing_identity_reviews_v1)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF rtrim(review_record.source_customer_digest)<>
     public.canonical_customer_financial_billing_identity_v1_source_digest(customer_record)
    OR review_record.source_customer_updated_at<>customer_record.updated_at THEN
  RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
   'billing_identity_review_source_changed',customer_record.id,
   review_record.billing_party_id,review_record.id,FALSE);
 END IF;
 RETURN public.canonical_customer_financial_billing_review_v1_saved_projection(review_record);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_candidate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT,customer_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;customer_record public.canonical_customers%ROWTYPE;
 party_record public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 origin_record public.canonical_customer_financial_billing_identity_snapshots_v1%ROWTYPE;
 previous_record public.canonical_customer_financial_billing_identity_reviews_v1%ROWTYPE;
 source_digest_value TEXT;
BEGIN
 authority:=public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,NULL,FALSE,capability_grant_id_value,
  capability_grant_revision_value,business_purpose_value,policy_version_value,customer_id_value);
 SELECT * INTO customer_record FROM public.canonical_customers customer
  WHERE customer.organization_id=org AND customer.id=customer_id_value;
 IF customer_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
  'billing_customer_identity_unavailable',NULL,NULL,NULL,NULL);END IF;
 SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
  WHERE party.organization_id=org AND party.customer_id=customer_id_value;
 IF party_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
  'billing_identity_not_established',customer_record.id,NULL,NULL,NULL);END IF;
 SELECT * INTO origin_record FROM public.canonical_customer_financial_billing_identity_snapshots_v1 origin
  WHERE origin.organization_id=org AND origin.billing_party_id=party_record.id AND origin.sequence=1;
 IF origin_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
  'billing_identity_history_unavailable',customer_record.id,party_record.id,NULL,NULL);END IF;
 SELECT * INTO previous_record FROM public.canonical_customer_financial_billing_identity_reviews_v1 review
  WHERE review.organization_id=org AND review.billing_party_id=party_record.id
  ORDER BY review.sequence DESC LIMIT 1;
 source_digest_value:=public.canonical_customer_financial_billing_identity_v1_source_digest(customer_record);
 RETURN jsonb_build_object('version','m27-billing-identity-review-state-v1',
  'state',CASE WHEN previous_record.id IS NULL THEN 'review_required' ELSE 'correction_required' END,
  'available',TRUE,'current',TRUE,'reason',NULL,'customerId',customer_record.id,
  'billingPartyId',party_record.id,'reviewId',previous_record.id,
  'sequence',COALESCE(previous_record.sequence,0),'sourceDigest',source_digest_value,
  'sourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(customer_record.updated_at),
  'reviewDigest',CASE WHEN previous_record.id IS NULL THEN NULL ELSE rtrim(previous_record.reviewed_snapshot_digest) END,
  'reviewState','unreviewed','documentUseAuthorized',FALSE,
  'value',jsonb_build_object('version','m27-billing-identity-review-candidate-v1',
   'originSnapshotId',origin_record.id,'originSnapshotDigest',rtrim(origin_record.snapshot_digest),
   'customerIdentity',jsonb_build_object('kind','canonical_customer','id',customer_record.id,
    'operationId',customer_record.operation_id,'graphId',customer_record.graph_id),
   'prospectIdentity',jsonb_build_object('state','unavailable','value',NULL,
    'reason','canonical_prospect_source_unavailable'),
   'name',customer_record.name,'email',customer_record.email,'phone',customer_record.phone,
   'unclassifiedAddress',customer_record.address),
  'automaticCustomerCreationAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT,customer_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE customer_record public.canonical_customers%ROWTYPE;
 party_record public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 review_record public.canonical_customer_financial_billing_identity_reviews_v1%ROWTYPE;
BEGIN
 PERFORM public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,NULL,FALSE,capability_grant_id_value,
  capability_grant_revision_value,business_purpose_value,policy_version_value,customer_id_value);
 SELECT * INTO customer_record FROM public.canonical_customers customer
  WHERE customer.organization_id=org AND customer.id=customer_id_value;
 IF customer_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
  'billing_customer_identity_unavailable',NULL,NULL,NULL,NULL);END IF;
 SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
  WHERE party.organization_id=org AND party.customer_id=customer_id_value;
 IF party_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
  'billing_identity_not_established',customer_record.id,NULL,NULL,NULL);END IF;
 SELECT * INTO review_record FROM public.canonical_customer_financial_billing_identity_reviews_v1 review
  WHERE review.organization_id=org AND review.billing_party_id=party_record.id
  ORDER BY review.sequence DESC LIMIT 1;
 IF review_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
  'billing_identity_review_required',customer_record.id,party_record.id,NULL,TRUE);END IF;
 RETURN public.canonical_customer_financial_billing_review_v1_projection(customer_record,review_record);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_history(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT,customer_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE party_record public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 total_value INTEGER;lineage_value JSONB;
BEGIN
 PERFORM public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,NULL,FALSE,capability_grant_id_value,
  capability_grant_revision_value,business_purpose_value,policy_version_value,customer_id_value);
 SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
  WHERE party.organization_id=org AND party.customer_id=customer_id_value;
 IF party_record.id IS NULL THEN RETURN public.canonical_customer_financial_billing_review_v1_unavailable(
  'billing_identity_not_established',customer_id_value,NULL,NULL,NULL);END IF;
 SELECT count(*)::integer INTO total_value
  FROM public.canonical_customer_financial_billing_identity_reviews_v1 review
  WHERE review.organization_id=org AND review.billing_party_id=party_record.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('reviewId',review.id,'sequence',review.sequence,
   'previousReviewId',review.previous_review_id,'reviewDigest',rtrim(review.reviewed_snapshot_digest),
   'sourceDigest',rtrim(review.source_customer_digest),
   'sourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(review.source_customer_updated_at),
   'reviewedAt',public.canonical_customer_financial_billing_identity_v1_utc(review.reviewed_at),
   'reviewedByUserId',review.reviewed_by_user_id,'reason',review.correction_reason)
   ORDER BY review.sequence),'[]'::jsonb) INTO lineage_value
  FROM public.canonical_customer_financial_billing_identity_reviews_v1 review
  WHERE review.organization_id=org AND review.billing_party_id=party_record.id;
 RETURN jsonb_build_object('version','m27-billing-identity-review-lineage-v1','available',TRUE,
  'customerId',customer_id_value,'billingPartyId',party_record.id,'complete',TRUE,
  'total',total_value,'revisions',lineage_value,'automaticCustomerCreationAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_customer_financial_billing_review_v1_accept(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 capability_grant_id_value UUID,capability_grant_revision_value BIGINT,
 business_purpose_value TEXT,policy_version_value TEXT,csrf TEXT,key_value TEXT,
 customer_id_value UUID,billing_party_id_value UUID,origin_snapshot_id_value UUID,
 expected_source_digest_value TEXT,expected_source_updated_at_value TIMESTAMPTZ,
 expected_previous_review_id_value UUID,expected_previous_review_digest_value TEXT,
 expected_previous_sequence_value INTEGER,payload_value JSONB,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;customer_record public.canonical_customers%ROWTYPE;
 party_record public.canonical_customer_financial_billing_parties_v1%ROWTYPE;
 origin_record public.canonical_customer_financial_billing_identity_snapshots_v1%ROWTYPE;
 previous_record public.canonical_customer_financial_billing_identity_reviews_v1%ROWTYPE;
 review_record public.canonical_customer_financial_billing_identity_reviews_v1%ROWTYPE;
 request_record public.canonical_customer_financial_billing_review_requests_v1%ROWTYPE;
 key_digest_value TEXT;request_digest_value TEXT;source_digest_value TEXT;
 snapshot_value JSONB;saved_response_value JSONB;response_value JSONB;
 reviewed_at_value TIMESTAMPTZ;review_id_value UUID:=gen_random_uuid();
 contact_id_value UUID;service_address_id_value UUID;billing_address_id_value UUID;
 sequence_value INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable transaction required for billing identity review'
   USING ERRCODE='25001';END IF;
 authority:=public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,csrf,TRUE,capability_grant_id_value,
  capability_grant_revision_value,business_purpose_value,policy_version_value,customer_id_value);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    billing_party_id_value IS NULL OR origin_snapshot_id_value IS NULL OR
    expected_source_digest_value IS NULL OR expected_source_digest_value!~'^[0-9a-f]{64}$' OR
    expected_source_updated_at_value IS NULL OR expected_previous_sequence_value IS NULL OR
    expected_previous_sequence_value NOT BETWEEN 0 AND 99 OR
    ((expected_previous_sequence_value=0)<>(expected_previous_review_id_value IS NULL)) OR
    ((expected_previous_sequence_value=0)<>(expected_previous_review_digest_value IS NULL)) OR
    (expected_previous_review_digest_value IS NOT NULL AND expected_previous_review_digest_value!~'^[0-9a-f]{64}$') OR
    NOT public.canonical_customer_financial_billing_review_v1_payload_valid(payload_value) OR
    reason_value IS NULL OR reason_value<>btrim(reason_value) OR
    octet_length(reason_value) NOT BETWEEN 12 AND 500 THEN
  RAISE EXCEPTION 'Billing identity review request invalid' USING ERRCODE='22023';END IF;
 key_digest_value:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m27-billing-identity-review-request-v1','organizationId',org,
  'actorUserId',actor,'authSessionId',session_value,'customerId',customer_id_value,
  'billingPartyId',billing_party_id_value,'originSnapshotId',origin_snapshot_id_value,
  'capabilityGrantId',capability_grant_id_value,
  'capabilityGrantRevision',capability_grant_revision_value,
  'businessPurpose',business_purpose_value,'policyVersion',policy_version_value,
  'expectedSourceDigest',expected_source_digest_value,
  'expectedSourceUpdatedAt',public.canonical_customer_financial_billing_identity_v1_utc(expected_source_updated_at_value),
  'expectedPreviousReviewId',expected_previous_review_id_value,
  'expectedPreviousReviewDigest',expected_previous_review_digest_value,
  'expectedPreviousSequence',expected_previous_sequence_value,'payload',payload_value,'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':billing-review-request:'||actor::text||':'||session_value::text||':'||key_digest_value,0));
 SELECT * INTO request_record FROM public.canonical_customer_financial_billing_review_requests_v1 request
  WHERE request.organization_id=org AND request.actor_user_id=actor
   AND request.auth_session_id=session_value AND rtrim(request.request_key_digest)=key_digest_value;
 IF request_record.customer_id IS NOT NULL THEN
  IF rtrim(request_record.request_digest)<>request_digest_value THEN
   RAISE EXCEPTION 'Billing identity review idempotency conflict'
    USING ERRCODE='23505',CONSTRAINT='canonical_customer_financial_billing_review_idempotency_conflict';END IF;
  SELECT * INTO review_record FROM public.canonical_customer_financial_billing_identity_reviews_v1 review
   WHERE review.organization_id=org AND review.id=request_record.review_id;
  IF review_record.id IS NULL THEN RAISE EXCEPTION 'Billing identity review replay history unavailable'
   USING ERRCODE='55000';END IF;
  saved_response_value:=public.canonical_customer_financial_billing_review_v1_saved_projection(review_record);
  IF rtrim(request_record.response_digest)<>public.canonical_completion_digest(saved_response_value) THEN
   RAISE EXCEPTION 'Billing identity review replay digest invalid' USING ERRCODE='55000';END IF;
  SELECT * INTO customer_record FROM public.canonical_customers customer
   WHERE customer.organization_id=org AND customer.id=request_record.customer_id FOR SHARE;
  IF customer_record.id IS NULL THEN RETURN jsonb_build_object('status',409,'body',
   public.canonical_customer_financial_billing_review_v1_unavailable(
    'billing_customer_identity_unavailable',NULL,review_record.billing_party_id,review_record.id,NULL),
   'replayed',TRUE);END IF;
  response_value:=public.canonical_customer_financial_billing_review_v1_projection(customer_record,review_record);
  IF response_value->>'state'='unavailable' THEN RETURN jsonb_build_object(
   'status',409,'body',response_value,'replayed',TRUE);END IF;
  RETURN jsonb_build_object('status',200,'body',response_value,'replayed',TRUE);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':billing-review-party:'||billing_party_id_value::text,0));
 SELECT * INTO customer_record FROM public.canonical_customers customer
  WHERE customer.organization_id=org AND customer.id=customer_id_value FOR SHARE;
 IF customer_record.id IS NULL THEN RETURN jsonb_build_object('status',409,'body',
  public.canonical_customer_financial_billing_review_v1_unavailable(
   'billing_customer_identity_unavailable',NULL,NULL,NULL,NULL),'replayed',FALSE);END IF;
 SELECT * INTO party_record FROM public.canonical_customer_financial_billing_parties_v1 party
  WHERE party.organization_id=org AND party.id=billing_party_id_value
   AND party.customer_id=customer_id_value FOR SHARE;
 IF party_record.id IS NULL THEN RETURN jsonb_build_object('status',409,'body',
  public.canonical_customer_financial_billing_review_v1_unavailable(
   'billing_identity_not_established',customer_record.id,NULL,NULL,NULL),'replayed',FALSE);END IF;
 SELECT * INTO origin_record FROM public.canonical_customer_financial_billing_identity_snapshots_v1 origin
  WHERE origin.organization_id=org AND origin.id=origin_snapshot_id_value
   AND origin.billing_party_id=party_record.id AND origin.customer_id=customer_record.id FOR SHARE;
 IF origin_record.id IS NULL THEN RETURN jsonb_build_object('status',409,'body',
  public.canonical_customer_financial_billing_review_v1_unavailable(
   'billing_identity_history_unavailable',customer_record.id,party_record.id,NULL,NULL),'replayed',FALSE);END IF;
 source_digest_value:=public.canonical_customer_financial_billing_identity_v1_source_digest(customer_record);
 IF source_digest_value<>expected_source_digest_value OR
    customer_record.updated_at<>expected_source_updated_at_value THEN
  RETURN jsonb_build_object('status',409,'body',
   public.canonical_customer_financial_billing_review_v1_unavailable(
    'billing_customer_source_changed',customer_record.id,party_record.id,NULL,FALSE),'replayed',FALSE);END IF;
 SELECT * INTO previous_record FROM public.canonical_customer_financial_billing_identity_reviews_v1 review
  WHERE review.organization_id=org AND review.billing_party_id=party_record.id
  ORDER BY review.sequence DESC LIMIT 1 FOR SHARE;
 IF (previous_record.id IS NULL AND expected_previous_sequence_value<>0) OR
    (previous_record.id IS NOT NULL AND (previous_record.id<>expected_previous_review_id_value OR
     previous_record.sequence<>expected_previous_sequence_value OR
     rtrim(previous_record.reviewed_snapshot_digest)<>expected_previous_review_digest_value)) THEN
  RETURN jsonb_build_object('status',409,'body',
   public.canonical_customer_financial_billing_review_v1_unavailable(
    'billing_identity_review_conflict',customer_record.id,party_record.id,previous_record.id,FALSE),
   'replayed',FALSE);END IF;
 sequence_value:=COALESCE(previous_record.sequence,0)+1;
 IF sequence_value>100 THEN RETURN jsonb_build_object('status',409,'body',
  public.canonical_customer_financial_billing_review_v1_unavailable(
   'billing_identity_review_limit_reached',customer_record.id,party_record.id,previous_record.id,FALSE),
  'replayed',FALSE);END IF;
 contact_id_value:=COALESCE(previous_record.billing_contact_id,gen_random_uuid());
 service_address_id_value:=COALESCE(previous_record.service_address_id,gen_random_uuid());
 billing_address_id_value:=COALESCE(previous_record.billing_address_id,gen_random_uuid());
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE) THEN
  RAISE EXCEPTION 'Current billing identity access unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_billing_identity_unauthorized';END IF;
 authority:=public.canonical_customer_financial_billing_identity_v1_access(
  org,actor,role_value,session_value,csrf,TRUE,capability_grant_id_value,
  capability_grant_revision_value,business_purpose_value,policy_version_value,customer_id_value);
 reviewed_at_value:=statement_timestamp();
 snapshot_value:=public.canonical_customer_financial_billing_review_v1_snapshot(
  customer_record,party_record,origin_record,previous_record,review_id_value,sequence_value,
  contact_id_value,service_address_id_value,billing_address_id_value,payload_value,
  actor,role_value,(authority->>'membershipId')::uuid,session_value,
  capability_grant_id_value,capability_grant_revision_value,business_purpose_value,
  policy_version_value,reason_value,reviewed_at_value);
 INSERT INTO public.canonical_customer_financial_billing_identity_reviews_v1(
  organization_id,id,billing_party_id,customer_id,sequence,previous_review_id,
  origin_snapshot_id,origin_snapshot_digest,source_customer_updated_at,source_customer_digest,
  billing_contact_id,service_address_id,billing_address_id,reviewed_snapshot,
  reviewed_snapshot_digest,reviewed_by_user_id,reviewed_by_access_role,membership_id,
  auth_session_id,capability_grant_id,capability_grant_revision,business_purpose,
  policy_version,correction_reason,reviewed_at)
 VALUES(org,review_id_value,party_record.id,customer_record.id,sequence_value,previous_record.id,
  origin_record.id,rtrim(origin_record.snapshot_digest),customer_record.updated_at,source_digest_value,
  contact_id_value,service_address_id_value,billing_address_id_value,snapshot_value,
  public.canonical_completion_digest(snapshot_value),actor,role_value,
  (authority->>'membershipId')::uuid,session_value,capability_grant_id_value,
  capability_grant_revision_value,business_purpose_value,policy_version_value,
  reason_value,reviewed_at_value) RETURNING * INTO review_record;
 response_value:=public.canonical_customer_financial_billing_review_v1_saved_projection(review_record);
 INSERT INTO public.canonical_customer_financial_billing_review_requests_v1(
  organization_id,actor_user_id,auth_session_id,request_key_digest,request_digest,
  customer_id,billing_party_id,review_id,response_status,response_digest,
  capability_grant_id,capability_grant_revision,business_purpose,policy_version,created_at)
 VALUES(org,actor,session_value,key_digest_value,request_digest_value,customer_record.id,
  party_record.id,review_record.id,201,public.canonical_completion_digest(response_value),
  capability_grant_id_value,capability_grant_revision_value,business_purpose_value,
  policy_version_value,reviewed_at_value);
 RETURN jsonb_build_object('status',201,'body',response_value,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_customer_financial_billing_identity_reviews_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_customer_financial_billing_review_requests_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_address_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_payload_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_field(JSONB,JSONB,TEXT,TIMESTAMPTZ,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_snapshot(public.canonical_customers,public.canonical_customer_financial_billing_parties_v1,public.canonical_customer_financial_billing_identity_snapshots_v1,public.canonical_customer_financial_billing_identity_reviews_v1,UUID,INTEGER,UUID,UUID,UUID,JSONB,UUID,TEXT,UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_unavailable(TEXT,UUID,UUID,UUID,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_saved_projection(public.canonical_customer_financial_billing_identity_reviews_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_projection(public.canonical_customers,public.canonical_customer_financial_billing_identity_reviews_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_candidate(UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_read(UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_history(UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_review_v1_accept(UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID,TEXT,TIMESTAMPTZ,UUID,TEXT,INTEGER,JSONB,TEXT) FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_review_v1_candidate(
  UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_review_v1_read(
  UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_review_v1_history(
  UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_review_v1_accept(
  UUID,UUID,TEXT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID,TEXT,TIMESTAMPTZ,UUID,TEXT,INTEGER,JSONB,TEXT)
  TO northstar_app_runtime;
END IF;END $$;
