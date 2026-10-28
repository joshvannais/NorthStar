-- Mission 28 Part 7A: immutable, owner-only sender and recipient identity
-- resolution for one exact Part 6A action unit.  This migration stores no raw
-- contact data and grants no permission, content, channel, provider or effect.

CREATE TABLE public.canonical_automation_sender_recipient_resolutions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 resolution_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 run_id UUID NOT NULL,
 sender_class TEXT NOT NULL CHECK(sender_class='tenant_business_profile'),
 business_profile_id UUID NOT NULL,
 business_profile_version BIGINT NOT NULL CHECK(business_profile_version BETWEEN 1 AND 9007199254740991),
 business_profile_digest TEXT NOT NULL CHECK(business_profile_digest~'^sha256:[0-9a-f]{64}$'),
 recipient_set_digest TEXT NOT NULL CHECK(recipient_set_digest~'^sha256:[0-9a-f]{64}$'),
 recipient_count INTEGER NOT NULL CHECK(recipient_count BETWEEN 1 AND 16),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 membership_role TEXT NOT NULL CHECK(membership_role IN('owner','admin')),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 resolution_digest TEXT NOT NULL CHECK(resolution_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,resolution_id),
 UNIQUE(organization_id,unit_id),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,material_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,business_profile_id)
  REFERENCES public.canonical_business_profiles(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_automation_recipient_authority_items_v1 (
 organization_id UUID NOT NULL,
 resolution_id UUID NOT NULL,
 recipient_index INTEGER NOT NULL CHECK(recipient_index BETWEEN 0 AND 15),
 recipient_class TEXT NOT NULL CHECK(recipient_class IN(
  'customer','authorized_billing_contact','lead_or_prospect','staff_member')),
 recipient_record_id UUID NOT NULL,
 parent_customer_id UUID,
 membership_id UUID,
 role TEXT,
 source_digest TEXT NOT NULL CHECK(source_digest~'^sha256:[0-9a-f]{64}$'),
 contact_identity_digest TEXT NOT NULL CHECK(contact_identity_digest~'^sha256:[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,resolution_id,recipient_index),
 UNIQUE(organization_id,resolution_id,recipient_class,recipient_record_id),
 UNIQUE(organization_id,resolution_id,contact_identity_digest),
 FOREIGN KEY(organization_id,resolution_id)
  REFERENCES public.canonical_automation_sender_recipient_resolutions_v1(organization_id,resolution_id) ON DELETE RESTRICT,
 CHECK(
  (recipient_class='customer' AND parent_customer_id=recipient_record_id AND membership_id IS NULL AND role IS NULL) OR
  (recipient_class IN('authorized_billing_contact','lead_or_prospect') AND parent_customer_id IS NOT NULL AND membership_id IS NULL AND role IS NULL) OR
  (recipient_class='staff_member' AND parent_customer_id IS NULL AND membership_id IS NOT NULL AND role IN('owner','admin','member','viewer'))
 )
);

CREATE INDEX canonical_automation_sender_recipient_resolutions_v1_unit
 ON public.canonical_automation_sender_recipient_resolutions_v1(organization_id,transaction_id,unit_id);

CREATE TRIGGER canonical_automation_sender_recipient_resolutions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_sender_recipient_resolutions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_recipient_authority_items_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_recipient_authority_items_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_sender_recipient_resolutions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_sender_recipient_resolutions_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_recipient_authority_items_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_recipient_authority_items_v1 FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_automation_sender_recipient_resolutions_v1_tenant_owner_only
 ON public.canonical_automation_sender_recipient_resolutions_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_sender_recipient_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_sender_recipient_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_recipient_authority_items_v1_tenant_owner_only
 ON public.canonical_automation_recipient_authority_items_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_recipient_authority_items_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_recipient_authority_items_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_record_sender_recipient_resolution_v1(
 canonical_text_value TEXT,trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 doc JSONB;org UUID;resolution_value UUID;transaction_value UUID;unit_value UUID;actor_value UUID;
 session_value UUID;membership_value UUID;requested_value TIMESTAMPTZ(6);recorded_value TIMESTAMPTZ(6);
 profile_value public.canonical_business_profiles%ROWTYPE;unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 transaction_row public.canonical_automation_action_transactions_v1%ROWTYPE;
 stored public.canonical_automation_sender_recipient_resolutions_v1%ROWTYPE;
 recipient JSONB;recipient_index_value INTEGER;recipient_class_value TEXT;record_value UUID;customer_value UUID;
 recipient_membership UUID;recipient_role TEXT;source_digest_value TEXT;contact_digest_value TEXT;
 derived_recipients JSONB:='[]'::jsonb;customer_row public.canonical_customers%ROWTYPE;
 opportunity_row public.canonical_opportunities%ROWTYPE;review_row public.canonical_customer_financial_billing_identity_reviews_v1%ROWTYPE;
 account_row public.users%ROWTYPE;membership_row public.organization_memberships%ROWTYPE;
 recipient_set_digest_value TEXT;request_digest_value TEXT;material_digest_value TEXT;resolution_digest_value TEXT;
 actor_role TEXT;recipient_count_value INTEGER;sender_profile_value UUID;sender_version_value BIGINT;
 sender_digest_value TEXT;contact_value JSONB;source_value JSONB;result_value JSONB;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN
  RAISE EXCEPTION 'Mission 28 sender recipient request bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','resolutionId','transactionId','unitId','senderBinding','recipients','actorBinding','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.sender-recipient-resolution.v1' OR
    COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'resolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'unitId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    jsonb_typeof(doc->'recipients') IS DISTINCT FROM 'array' OR
    jsonb_array_length(doc->'recipients') NOT BETWEEN 1 AND 16 THEN
  RAISE EXCEPTION 'Mission 28 sender recipient request shape invalid' USING ERRCODE='22023'; END IF;
 IF public.canonical_automation_part4b_keys_exact_v1(doc->'senderBinding',ARRAY['senderClass','businessProfileId','businessProfileVersion','businessProfileDigest']) IS DISTINCT FROM TRUE OR
    doc#>>'{senderBinding,senderClass}' IS DISTINCT FROM 'tenant_business_profile' OR
    COALESCE(doc#>>'{senderBinding,businessProfileId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{senderBinding,businessProfileVersion}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{senderBinding,businessProfileDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole','requestedAt']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipRole}','') NOT IN('owner','admin') OR
    COALESCE(doc#>>'{actorBinding,requestedAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
  RAISE EXCEPTION 'Mission 28 sender or actor binding invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid;resolution_value:=(doc->>'resolutionId')::uuid;
 transaction_value:=(doc->>'transactionId')::uuid;unit_value:=(doc->>'unitId')::uuid;
 actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;session_value:=(doc#>>'{actorBinding,sessionId}')::uuid;
 membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;requested_value:=(doc#>>'{actorBinding,requestedAt}')::timestamptz;
 sender_profile_value:=(doc#>>'{senderBinding,businessProfileId}')::uuid;
 sender_version_value:=(doc#>>'{senderBinding,businessProfileVersion}')::bigint;
 sender_digest_value:=doc#>>'{senderBinding,businessProfileDigest}';
 request_digest_value:=public.canonical_automation_digest_v1('mission28.sender-recipient-resolution.v1'||chr(10),doc-'requestDigest'::text);
 material_digest_value:=public.canonical_automation_digest_v1('mission28.sender-recipient-material.v1'||chr(10),doc-'resolutionId'::text-'requestDigest'::text);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR
    public.canonical_automation_part4b_keys_exact_v1(trusted_resolution,ARRAY['tenantId','transactionId','unitId','senderBinding','recipients','actorBinding']) IS DISTINCT FROM TRUE OR
    trusted_resolution IS DISTINCT FROM jsonb_build_object('tenantId',doc->'tenantId','transactionId',doc->'transactionId','unitId',doc->'unitId','senderBinding',doc->'senderBinding','recipients',doc->'recipients','actorBinding',doc->'actorBinding') THEN
  RAISE EXCEPTION 'Mission 28 sender recipient digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-sender-recipient-id:'||resolution_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_sender_recipient_resolutions_v1
  WHERE organization_id=org AND resolution_id=resolution_value;
 IF stored.resolution_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 sender recipient identity conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('resolutionId',stored.resolution_id,'recipientSetDigest',stored.recipient_set_digest,
   'recipientCount',stored.recipient_count,'resolutionDigest',stored.resolution_digest,'replayed',TRUE,'effectCreated',FALSE);
 END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF requested_value>recorded_value OR requested_value<recorded_value-INTERVAL '30 seconds' THEN
  RAISE EXCEPTION 'Mission 28 sender recipient request time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role
 FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id
  AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.id=session_value AND session.organization_id=org AND session.user_id=actor_value
  AND session.membership_id=membership_value AND session.status='active' AND session.revoked_at IS NULL
  AND session.access_expires_at>recorded_value AND membership.status='active' AND membership.revoked_at IS NULL
  AND account.status='active';
 IF actor_role IS NULL OR actor_role IS DISTINCT FROM doc#>>'{actorBinding,membershipRole}' THEN
  RAISE EXCEPTION 'Mission 28 sender recipient actor unavailable' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-sender-recipient-unit:'||unit_value::text,0));
 SELECT unit.* INTO unit_row FROM public.canonical_automation_action_units_v1 unit
  WHERE unit.organization_id=org AND unit.unit_id=unit_value AND unit.transaction_id=transaction_value FOR SHARE;
 SELECT transaction.* INTO transaction_row FROM public.canonical_automation_action_transactions_v1 transaction
  WHERE transaction.organization_id=org AND transaction.transaction_id=transaction_value FOR SHARE;
 IF unit_row.unit_id IS NULL OR transaction_row.transaction_id IS NULL OR unit_row.run_id IS DISTINCT FROM transaction_row.run_id THEN
  RAISE EXCEPTION 'Mission 28 exact action unit unavailable' USING ERRCODE='42501'; END IF;

 SELECT profile.* INTO profile_value
 FROM public.organization_onboarding onboarding
 JOIN public.canonical_business_profiles profile ON profile.organization_id=onboarding.organization_id
  AND profile.id=onboarding.active_business_profile_id
 WHERE onboarding.organization_id=org AND onboarding.status='complete' AND profile.id=sender_profile_value
  AND profile.version_number=sender_version_value AND profile.is_active AND profile.retired_at IS NULL
  AND 'sha256:'||rtrim(profile.normalized_profile_hash)=sender_digest_value FOR SHARE OF onboarding,profile;
 IF profile_value.id IS NULL THEN RAISE EXCEPTION 'Mission 28 exact sender unavailable' USING ERRCODE='42501'; END IF;

 recipient_count_value:=jsonb_array_length(doc->'recipients');
 FOR recipient_index_value IN 0..recipient_count_value-1 LOOP
  recipient:=doc->'recipients'->recipient_index_value;
  IF public.canonical_automation_part4b_keys_exact_v1(recipient,ARRAY['recipientIndex','recipientClass','recipientRecordId','parentCustomerId','membershipId','role','sourceDigest','contactIdentityDigest']) IS DISTINCT FROM TRUE OR
     jsonb_typeof(recipient->'recipientIndex') IS DISTINCT FROM 'number' OR
     COALESCE(recipient->>'recipientIndex','')!~'^(0|[1-9][0-9]*)$' OR (recipient->>'recipientIndex')::integer IS DISTINCT FROM recipient_index_value OR
     COALESCE(recipient->>'recipientClass','') NOT IN('customer','authorized_billing_contact','lead_or_prospect','staff_member') OR
     COALESCE(recipient->>'recipientRecordId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     COALESCE(recipient->>'sourceDigest','')!~'^sha256:[0-9a-f]{64}$' OR
     COALESCE(recipient->>'contactIdentityDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Mission 28 recipient shape invalid' USING ERRCODE='22023'; END IF;
  recipient_class_value:=recipient->>'recipientClass';record_value:=(recipient->>'recipientRecordId')::uuid;
  customer_value:=CASE WHEN recipient->'parentCustomerId'='null'::jsonb THEN NULL ELSE (recipient->>'parentCustomerId')::uuid END;
  recipient_membership:=CASE WHEN recipient->'membershipId'='null'::jsonb THEN NULL ELSE (recipient->>'membershipId')::uuid END;
  recipient_role:=CASE WHEN recipient->'role'='null'::jsonb THEN NULL ELSE recipient->>'role' END;

  IF recipient_class_value='customer' THEN
   IF customer_value IS DISTINCT FROM record_value OR recipient_membership IS NOT NULL OR recipient_role IS NOT NULL THEN
    RAISE EXCEPTION 'Mission 28 customer recipient binding invalid' USING ERRCODE='22023'; END IF;
   SELECT * INTO customer_row FROM public.canonical_customers WHERE organization_id=org AND id=record_value FOR SHARE;
   IF customer_row.id IS NULL OR (COALESCE(btrim(customer_row.email),'')='' AND COALESCE(btrim(customer_row.phone),'')='') THEN
    RAISE EXCEPTION 'Mission 28 customer recipient unavailable' USING ERRCODE='42501'; END IF;
   source_value:=jsonb_build_object('recipientClass','customer','customerId',customer_row.id,'operationId',customer_row.operation_id,
    'graphId',customer_row.graph_id,'updatedAt',public.canonical_automation_utc_v1(customer_row.updated_at),
    'customerSourceDigest','sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(customer_row));
   contact_value:=jsonb_build_object('email',customer_row.email,'phone',customer_row.phone);
  ELSIF recipient_class_value='authorized_billing_contact' THEN
   IF customer_value IS NULL OR recipient_membership IS NOT NULL OR recipient_role IS NOT NULL THEN
    RAISE EXCEPTION 'Mission 28 billing contact binding invalid' USING ERRCODE='22023'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':billing-identity-customer:'||customer_value::text,0));
   SELECT * INTO customer_row FROM public.canonical_customers WHERE organization_id=org AND id=customer_value FOR SHARE;
   SELECT review.* INTO review_row FROM public.canonical_customer_financial_billing_identity_reviews_v1 review
    WHERE review.organization_id=org AND review.customer_id=customer_value AND review.billing_contact_id=record_value
    ORDER BY review.sequence DESC LIMIT 1 FOR SHARE;
   IF customer_row.id IS NULL OR review_row.id IS NULL OR
      review_row.sequence IS DISTINCT FROM (SELECT max(latest.sequence) FROM public.canonical_customer_financial_billing_identity_reviews_v1 latest WHERE latest.organization_id=org AND latest.billing_party_id=review_row.billing_party_id) OR
      'sha256:'||rtrim(review_row.source_customer_digest) IS DISTINCT FROM 'sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(customer_row) OR
      review_row.source_customer_updated_at IS DISTINCT FROM customer_row.updated_at OR
      review_row.reviewed_snapshot->>'reviewState' IS DISTINCT FROM 'reviewed' OR
      review_row.reviewed_snapshot->'documentUseAuthorized' IS DISTINCT FROM 'true'::jsonb OR
      NOT ((review_row.reviewed_snapshot#>>'{billingContact,email,state}'='reviewed' AND jsonb_typeof(review_row.reviewed_snapshot#>'{billingContact,email,value}')='string') OR
           (review_row.reviewed_snapshot#>>'{billingContact,phone,state}'='reviewed' AND jsonb_typeof(review_row.reviewed_snapshot#>'{billingContact,phone,value}')='string')) THEN
    RAISE EXCEPTION 'Mission 28 reviewed billing contact unavailable' USING ERRCODE='42501'; END IF;
   source_value:=jsonb_build_object('recipientClass','authorized_billing_contact','billingContactId',record_value,
    'customerId',customer_value,'billingPartyId',review_row.billing_party_id,'reviewId',review_row.id,
    'reviewSequence',review_row.sequence,'reviewDigest','sha256:'||rtrim(review_row.reviewed_snapshot_digest));
   contact_value:=jsonb_build_object(
    'email',CASE WHEN review_row.reviewed_snapshot#>>'{billingContact,email,state}'='reviewed' THEN review_row.reviewed_snapshot#>'{billingContact,email,value}' ELSE 'null'::jsonb END,
    'phone',CASE WHEN review_row.reviewed_snapshot#>>'{billingContact,phone,state}'='reviewed' THEN review_row.reviewed_snapshot#>'{billingContact,phone,value}' ELSE 'null'::jsonb END);
  ELSIF recipient_class_value='lead_or_prospect' THEN
   IF customer_value IS NULL OR recipient_membership IS NOT NULL OR recipient_role IS NOT NULL THEN
    RAISE EXCEPTION 'Mission 28 lead recipient binding invalid' USING ERRCODE='22023'; END IF;
   SELECT * INTO opportunity_row FROM public.canonical_opportunities
    WHERE organization_id=org AND id=record_value AND customer_id=customer_value FOR SHARE;
   SELECT * INTO customer_row FROM public.canonical_customers WHERE organization_id=org AND id=customer_value FOR SHARE;
   IF opportunity_row.id IS NULL OR customer_row.id IS NULL OR (COALESCE(btrim(customer_row.email),'')='' AND COALESCE(btrim(customer_row.phone),'')='') THEN
    RAISE EXCEPTION 'Mission 28 lead recipient unavailable' USING ERRCODE='42501'; END IF;
   source_value:=jsonb_build_object('recipientClass','lead_or_prospect','opportunityId',opportunity_row.id,
    'customerId',customer_row.id,'operationId',opportunity_row.operation_id,'graphId',opportunity_row.graph_id,
    'status',opportunity_row.status,'updatedAt',public.canonical_automation_utc_v1(opportunity_row.updated_at),
    'customerSourceDigest','sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(customer_row));
   contact_value:=jsonb_build_object('email',customer_row.email,'phone',customer_row.phone);
  ELSE
   IF customer_value IS NOT NULL OR recipient_membership IS NULL OR recipient_role NOT IN('owner','admin','member','viewer') THEN
    RAISE EXCEPTION 'Mission 28 staff recipient binding invalid' USING ERRCODE='22023'; END IF;
   SELECT * INTO account_row FROM public.users WHERE organization_id=org AND id=record_value AND status='active' FOR SHARE;
   SELECT * INTO membership_row FROM public.organization_memberships
    WHERE organization_id=org AND id=recipient_membership AND user_id=record_value
     AND status='active' AND revoked_at IS NULL AND role=recipient_role FOR SHARE;
   IF account_row.id IS NULL OR membership_row.id IS NULL THEN
    RAISE EXCEPTION 'Mission 28 staff recipient unavailable' USING ERRCODE='42501'; END IF;
   source_value:=jsonb_build_object('recipientClass','staff_member','userId',account_row.id,'membershipId',membership_row.id,
    'role',membership_row.role,'userUpdatedAt',public.canonical_automation_utc_v1(account_row.updated_at),
    'membershipUpdatedAt',public.canonical_automation_utc_v1(membership_row.updated_at));
   contact_value:=jsonb_build_object('email',account_row.email_normalized,'phone',account_row.phone);
  END IF;
  source_digest_value:=public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),source_value);
  contact_digest_value:=public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),contact_value);
  IF source_digest_value IS DISTINCT FROM recipient->>'sourceDigest' OR contact_digest_value IS DISTINCT FROM recipient->>'contactIdentityDigest' THEN
   RAISE EXCEPTION 'Mission 28 recipient source changed or substituted' USING ERRCODE='42501'; END IF;
  derived_recipients:=derived_recipients||jsonb_build_array(jsonb_build_object(
   'recipientIndex',recipient_index_value,'recipientClass',recipient_class_value,'recipientRecordId',record_value,
   'parentCustomerId',customer_value,'membershipId',recipient_membership,'role',recipient_role,
   'sourceDigest',source_digest_value,'contactIdentityDigest',contact_digest_value));
 END LOOP;

 IF (SELECT count(DISTINCT item->>'contactIdentityDigest') FROM jsonb_array_elements(derived_recipients) item) IS DISTINCT FROM recipient_count_value::bigint OR
    (SELECT count(DISTINCT (item->>'recipientClass')||':'||(item->>'recipientRecordId')) FROM jsonb_array_elements(derived_recipients) item) IS DISTINCT FROM recipient_count_value::bigint THEN
  RAISE EXCEPTION 'Mission 28 ambiguous or duplicate recipient identity' USING ERRCODE='42501'; END IF;
 recipient_set_digest_value:=public.canonical_automation_digest_v1('mission28.recipient-set.v1'||chr(10),derived_recipients);
 IF recipient_set_digest_value IS DISTINCT FROM unit_row.recipient_set_digest THEN
  RAISE EXCEPTION 'Mission 28 action unit recipient set mismatch' USING ERRCODE='42501'; END IF;
 resolution_digest_value:=public.canonical_automation_digest_v1('mission28.sender-recipient-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org,'resolutionId',resolution_value,'transactionId',transaction_value,'unitId',unit_value,
  'senderBinding',doc->'senderBinding','recipients',derived_recipients,'actorBinding',doc->'actorBinding'));

 INSERT INTO public.canonical_automation_sender_recipient_resolutions_v1(
  organization_id,resolution_id,transaction_id,unit_id,run_id,sender_class,business_profile_id,
  business_profile_version,business_profile_digest,recipient_set_digest,recipient_count,actor_user_id,
  auth_session_id,membership_id,membership_role,request_digest,material_digest,resolution_digest,canonical_text,recorded_at)
 VALUES(org,resolution_value,transaction_value,unit_value,unit_row.run_id,'tenant_business_profile',sender_profile_value,
  sender_version_value,sender_digest_value,recipient_set_digest_value,recipient_count_value,actor_value,
  session_value,membership_value,actor_role,request_digest_value,material_digest_value,resolution_digest_value,canonical_text_value,recorded_value);
 INSERT INTO public.canonical_automation_recipient_authority_items_v1(
  organization_id,resolution_id,recipient_index,recipient_class,recipient_record_id,parent_customer_id,
  membership_id,role,source_digest,contact_identity_digest,recorded_at)
 SELECT org,resolution_value,(item->>'recipientIndex')::integer,item->>'recipientClass',(item->>'recipientRecordId')::uuid,
  CASE WHEN item->'parentCustomerId'='null'::jsonb THEN NULL ELSE (item->>'parentCustomerId')::uuid END,
  CASE WHEN item->'membershipId'='null'::jsonb THEN NULL ELSE (item->>'membershipId')::uuid END,
  CASE WHEN item->'role'='null'::jsonb THEN NULL ELSE item->>'role' END,item->>'sourceDigest',item->>'contactIdentityDigest',recorded_value
 FROM jsonb_array_elements(derived_recipients) item;
 result_value:=jsonb_build_object('resolutionId',resolution_value,'recipientSetDigest',recipient_set_digest_value,
  'recipientCount',recipient_count_value,'resolutionDigest',resolution_digest_value,'replayed',FALSE,'effectCreated',FALSE);
 RETURN result_value;
END $$;

REVOKE ALL ON TABLE public.canonical_automation_sender_recipient_resolutions_v1,
 public.canonical_automation_recipient_authority_items_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_sender_recipient_resolution_v1(TEXT,JSONB) FROM PUBLIC;

COMMENT ON FUNCTION public.canonical_automation_record_sender_recipient_resolution_v1(TEXT,JSONB) IS
 'Owner-only Part 7A exact identity evidence. No runtime grant, raw contact persistence, permission, provider, message or effect.';
