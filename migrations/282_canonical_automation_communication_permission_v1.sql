-- Mission 28 Part 7B: versioned no-effect communication permission and
-- suppression evidence. No raw contact, message, provider, or effect data.

CREATE TABLE public.canonical_automation_communication_permission_subjects_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 permission_id UUID NOT NULL,
 recipient_class TEXT NOT NULL CHECK(recipient_class IN('customer','authorized_billing_contact','lead_or_prospect','staff_member')),
 recipient_record_id UUID NOT NULL,
 parent_customer_id UUID,
 membership_id UUID,
 contact_identity_digest TEXT NOT NULL CHECK(contact_identity_digest~'^sha256:[0-9a-f]{64}$'),
 channel_id TEXT NOT NULL CHECK(channel_id IN('in_app_passive','email','sms')),
 created_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,permission_id),
 UNIQUE(organization_id,contact_identity_digest,channel_id),
 CHECK((recipient_class='customer' AND parent_customer_id=recipient_record_id AND membership_id IS NULL) OR
       (recipient_class IN('authorized_billing_contact','lead_or_prospect') AND parent_customer_id IS NOT NULL AND membership_id IS NULL) OR
       (recipient_class='staff_member' AND parent_customer_id IS NULL AND membership_id IS NOT NULL))
);

CREATE TABLE public.canonical_automation_communication_permission_versions_v1 (
 organization_id UUID NOT NULL,
 permission_id UUID NOT NULL,
 version BIGINT NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 sender_recipient_resolution_id UUID NOT NULL,
 recipient_index INTEGER NOT NULL CHECK(recipient_index BETWEEN 0 AND 15),
 source_digest TEXT NOT NULL CHECK(source_digest~'^sha256:[0-9a-f]{64}$'),
 preference_state TEXT NOT NULL CHECK(preference_state IN('unknown','allowed','preferred','blocked')),
 permission_state TEXT NOT NULL CHECK(permission_state IN('unknown','reported_opt_in_unverified','opted_out','do_not_contact','conflicting','internal_membership_current')),
 basis_state TEXT NOT NULL CHECK(basis_state IN('none_unknown','owner_reviewed_reported_basis_unverified','recipient_opt_out','recipient_do_not_contact','conflicting_evidence','authenticated_tenant_membership')),
 basis_evidence_digest TEXT NOT NULL CHECK(basis_evidence_digest~'^sha256:[0-9a-f]{64}$'),
 jurisdiction_state TEXT NOT NULL CHECK(jurisdiction_state IN('unknown','restricted','not_applicable_internal')),
 age_restriction_state TEXT NOT NULL CHECK(age_restriction_state IN('unknown','restricted','not_applicable_internal')),
 quiet_hours_state TEXT NOT NULL CHECK(quiet_hours_state IN('unknown','restricted','not_applicable_internal_passive')),
 suppression_state TEXT NOT NULL CHECK(suppression_state IN('unavailable','suppressed_opt_out','suppressed_do_not_contact','suppressed_conflicting','suppressed_preference','suppressed_jurisdiction','suppressed_age','suppressed_quiet_hours','clear_internal_passive')),
 previous_version_digest TEXT,
 permission_digest TEXT NOT NULL CHECK(permission_digest~'^sha256:[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role='owner'),
 reviewed_at TIMESTAMPTZ(6) NOT NULL,
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,permission_id,version),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,permission_digest),
 FOREIGN KEY(organization_id,permission_id)
  REFERENCES public.canonical_automation_communication_permission_subjects_v1(organization_id,permission_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,sender_recipient_resolution_id)
  REFERENCES public.canonical_automation_sender_recipient_resolutions_v1(organization_id,resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((version=1 AND previous_version_digest IS NULL) OR (version>1 AND previous_version_digest~'^sha256:[0-9a-f]{64}$'))
);

CREATE TABLE public.canonical_automation_communication_permission_resolutions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 permission_resolution_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 run_id UUID NOT NULL,
 sender_recipient_resolution_id UUID NOT NULL,
 recipient_set_digest TEXT NOT NULL CHECK(recipient_set_digest~'^sha256:[0-9a-f]{64}$'),
 permission_set_digest TEXT NOT NULL CHECK(permission_set_digest~'^sha256:[0-9a-f]{64}$'),
 recipient_count INTEGER NOT NULL CHECK(recipient_count=1),
 result_state TEXT NOT NULL CHECK(result_state IN('clear_internal_passive_no_effect','unavailable','suppressed_opt_out','suppressed_do_not_contact','suppressed_conflicting','suppressed_preference','suppressed_jurisdiction','suppressed_age','suppressed_quiet_hours')),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role='owner'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 resolution_digest TEXT NOT NULL CHECK(resolution_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 evaluated_at TIMESTAMPTZ(6) NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,permission_resolution_id),
 UNIQUE(organization_id,unit_id),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,material_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,sender_recipient_resolution_id)
  REFERENCES public.canonical_automation_sender_recipient_resolutions_v1(organization_id,resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_automation_permission_resolution_items_v1 (
 organization_id UUID NOT NULL,
 permission_resolution_id UUID NOT NULL,
 recipient_index INTEGER NOT NULL CHECK(recipient_index=0),
 permission_id UUID NOT NULL,
 permission_version BIGINT NOT NULL,
 permission_digest TEXT NOT NULL CHECK(permission_digest~'^sha256:[0-9a-f]{64}$'),
 suppression_state TEXT NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,permission_resolution_id,recipient_index),
 FOREIGN KEY(organization_id,permission_resolution_id)
  REFERENCES public.canonical_automation_communication_permission_resolutions_v1(organization_id,permission_resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,permission_id,permission_version)
  REFERENCES public.canonical_automation_communication_permission_versions_v1(organization_id,permission_id,version) ON DELETE RESTRICT
);

CREATE TRIGGER canonical_automation_communication_permission_subjects_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_communication_permission_subjects_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_communication_permission_versions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_communication_permission_versions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_communication_permission_resolutions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_communication_permission_resolutions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_permission_resolution_items_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_permission_resolution_items_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_communication_permission_subjects_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_communication_permission_subjects_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_communication_permission_versions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_communication_permission_versions_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_communication_permission_resolutions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_communication_permission_resolutions_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_permission_resolution_items_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_permission_resolution_items_v1 FORCE ROW LEVEL SECURITY;

DO $$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_automation_communication_permission_subjects_v1',
  'canonical_automation_communication_permission_versions_v1',
  'canonical_automation_communication_permission_resolutions_v1',
  'canonical_automation_permission_resolution_items_v1']
 LOOP
  EXECUTE format('CREATE POLICY %I ON public.%I USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass)) AND organization_id::text=NULLIF(pg_catalog.current_setting(''northstar.automation_tenant_id'',TRUE),'''')) WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid=%L::regclass)) AND organization_id::text=NULLIF(pg_catalog.current_setting(''northstar.automation_tenant_id'',TRUE),''''))',table_name||'_tenant_owner_only',table_name,'public.'||table_name,'public.'||table_name);
 END LOOP;
END $$;

CREATE FUNCTION public.canonical_automation_part7b_recipient_current_v1(
 organization_value UUID,resolution_value UUID,index_value INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE item public.canonical_automation_recipient_authority_items_v1%ROWTYPE;
 customer_row public.canonical_customers%ROWTYPE; opportunity_row public.canonical_opportunities%ROWTYPE;
 review_row public.canonical_customer_financial_billing_identity_reviews_v1%ROWTYPE;
 account_row public.users%ROWTYPE; membership_row public.organization_memberships%ROWTYPE;
 source_value JSONB; contact_value JSONB; source_digest_value TEXT; contact_digest_value TEXT;
BEGIN
 SELECT * INTO item FROM public.canonical_automation_recipient_authority_items_v1
  WHERE organization_id=organization_value AND resolution_id=resolution_value AND recipient_index=index_value FOR SHARE;
 IF item.resolution_id IS NULL THEN RETURN FALSE; END IF;
 IF item.recipient_class='customer' THEN
  SELECT * INTO customer_row FROM public.canonical_customers WHERE organization_id=organization_value AND id=item.recipient_record_id FOR SHARE;
  IF customer_row.id IS NULL OR (COALESCE(btrim(customer_row.email),'')='' AND COALESCE(btrim(customer_row.phone),'')='') THEN RETURN FALSE; END IF;
  source_value:=jsonb_build_object('recipientClass','customer','customerId',customer_row.id,'operationId',customer_row.operation_id,'graphId',customer_row.graph_id,'updatedAt',public.canonical_automation_utc_v1(customer_row.updated_at),'customerSourceDigest','sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(customer_row));
  contact_value:=jsonb_build_object('email',customer_row.email,'phone',customer_row.phone);
 ELSIF item.recipient_class='authorized_billing_contact' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(organization_value::text||':billing-identity-customer:'||item.parent_customer_id::text,0));
  SELECT * INTO customer_row FROM public.canonical_customers WHERE organization_id=organization_value AND id=item.parent_customer_id FOR SHARE;
  SELECT * INTO review_row FROM public.canonical_customer_financial_billing_identity_reviews_v1
   WHERE organization_id=organization_value AND customer_id=item.parent_customer_id AND billing_contact_id=item.recipient_record_id
   ORDER BY sequence DESC LIMIT 1 FOR SHARE;
  IF customer_row.id IS NULL OR review_row.id IS NULL OR
     review_row.sequence IS DISTINCT FROM (SELECT max(sequence) FROM public.canonical_customer_financial_billing_identity_reviews_v1 WHERE organization_id=organization_value AND billing_party_id=review_row.billing_party_id) OR
     'sha256:'||rtrim(review_row.source_customer_digest) IS DISTINCT FROM 'sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(customer_row) OR
     review_row.source_customer_updated_at IS DISTINCT FROM customer_row.updated_at OR
     review_row.reviewed_snapshot->>'reviewState' IS DISTINCT FROM 'reviewed' OR review_row.reviewed_snapshot->'documentUseAuthorized' IS DISTINCT FROM 'true'::jsonb THEN RETURN FALSE; END IF;
  source_value:=jsonb_build_object('recipientClass','authorized_billing_contact','billingContactId',item.recipient_record_id,'customerId',item.parent_customer_id,'billingPartyId',review_row.billing_party_id,'reviewId',review_row.id,'reviewSequence',review_row.sequence,'reviewDigest','sha256:'||rtrim(review_row.reviewed_snapshot_digest));
  contact_value:=jsonb_build_object('email',CASE WHEN review_row.reviewed_snapshot#>>'{billingContact,email,state}'='reviewed' THEN review_row.reviewed_snapshot#>'{billingContact,email,value}' ELSE 'null'::jsonb END,'phone',CASE WHEN review_row.reviewed_snapshot#>>'{billingContact,phone,state}'='reviewed' THEN review_row.reviewed_snapshot#>'{billingContact,phone,value}' ELSE 'null'::jsonb END);
 ELSIF item.recipient_class='lead_or_prospect' THEN
  SELECT * INTO opportunity_row FROM public.canonical_opportunities WHERE organization_id=organization_value AND id=item.recipient_record_id AND customer_id=item.parent_customer_id FOR SHARE;
  SELECT * INTO customer_row FROM public.canonical_customers WHERE organization_id=organization_value AND id=item.parent_customer_id FOR SHARE;
  IF opportunity_row.id IS NULL OR customer_row.id IS NULL OR (COALESCE(btrim(customer_row.email),'')='' AND COALESCE(btrim(customer_row.phone),'')='') THEN RETURN FALSE; END IF;
  source_value:=jsonb_build_object('recipientClass','lead_or_prospect','opportunityId',opportunity_row.id,'customerId',customer_row.id,'operationId',opportunity_row.operation_id,'graphId',opportunity_row.graph_id,'status',opportunity_row.status,'updatedAt',public.canonical_automation_utc_v1(opportunity_row.updated_at),'customerSourceDigest','sha256:'||public.canonical_customer_financial_billing_identity_v1_source_digest(customer_row));
  contact_value:=jsonb_build_object('email',customer_row.email,'phone',customer_row.phone);
 ELSE
  SELECT * INTO account_row FROM public.users WHERE organization_id=organization_value AND id=item.recipient_record_id AND status='active' FOR SHARE;
  SELECT * INTO membership_row FROM public.organization_memberships WHERE organization_id=organization_value AND id=item.membership_id AND user_id=item.recipient_record_id AND status='active' AND revoked_at IS NULL AND role=item.role FOR SHARE;
  IF account_row.id IS NULL OR membership_row.id IS NULL THEN RETURN FALSE; END IF;
  source_value:=jsonb_build_object('recipientClass','staff_member','userId',account_row.id,'membershipId',membership_row.id,'role',membership_row.role,'userUpdatedAt',public.canonical_automation_utc_v1(account_row.updated_at),'membershipUpdatedAt',public.canonical_automation_utc_v1(membership_row.updated_at));
  contact_value:=jsonb_build_object('email',account_row.email_normalized,'phone',account_row.phone);
 END IF;
 source_digest_value:=public.canonical_automation_digest_v1('mission28.recipient-source.v1'||chr(10),source_value);
 contact_digest_value:=public.canonical_automation_digest_v1('mission28.recipient-contact.v1'||chr(10),contact_value);
 RETURN source_digest_value IS NOT DISTINCT FROM item.source_digest AND contact_digest_value IS NOT DISTINCT FROM item.contact_identity_digest;
END $$;

CREATE FUNCTION public.canonical_automation_record_communication_permission_version_v1(
 canonical_text_value TEXT,trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE doc JSONB;org UUID;permission_value UUID;version_value BIGINT;resolution_value UUID;recipient_index_value INTEGER;
 actor_value UUID;session_value UUID;membership_value UUID;reviewed_value TIMESTAMPTZ(6);recorded_value TIMESTAMPTZ(6);actor_role TEXT;
 item public.canonical_automation_recipient_authority_items_v1%ROWTYPE;subject public.canonical_automation_communication_permission_subjects_v1%ROWTYPE;
 stored public.canonical_automation_communication_permission_versions_v1%ROWTYPE;previous public.canonical_automation_communication_permission_versions_v1%ROWTYPE;
 preference_value TEXT;permission_state_value TEXT;basis_value TEXT;jurisdiction_value TEXT;age_value TEXT;quiet_value TEXT;suppression_value TEXT;
 request_digest_value TEXT;permission_digest_value TEXT;expected_trusted JSONB;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN RAISE EXCEPTION 'Mission 28 communication permission bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','permissionId','version','recipientBinding','channelId','preferenceState','permissionState','basisState','basisEvidenceDigest','jurisdictionState','ageRestrictionState','quietHoursState','suppressionState','previousVersionDigest','permissionDigest','actorBinding','reviewedAt','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.communication-permission-version.v1' OR
    COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'permissionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'version','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc->>'channelId','') NOT IN('in_app_passive','email','sms') OR
    COALESCE(doc->>'preferenceState','') NOT IN('unknown','allowed','preferred','blocked') OR
    COALESCE(doc->>'permissionState','') NOT IN('unknown','reported_opt_in_unverified','opted_out','do_not_contact','conflicting','internal_membership_current') OR
    COALESCE(doc->>'basisState','') NOT IN('none_unknown','owner_reviewed_reported_basis_unverified','recipient_opt_out','recipient_do_not_contact','conflicting_evidence','authenticated_tenant_membership') OR
    COALESCE(doc->>'basisEvidenceDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc->>'jurisdictionState','') NOT IN('unknown','restricted','not_applicable_internal') OR
    COALESCE(doc->>'ageRestrictionState','') NOT IN('unknown','restricted','not_applicable_internal') OR
    COALESCE(doc->>'quietHoursState','') NOT IN('unknown','restricted','not_applicable_internal_passive') OR
    COALESCE(doc->>'suppressionState','') NOT IN('unavailable','suppressed_opt_out','suppressed_do_not_contact','suppressed_conflicting','suppressed_preference','suppressed_jurisdiction','suppressed_age','suppressed_quiet_hours','clear_internal_passive') OR
    COALESCE(doc->>'permissionDigest','')!~'^sha256:[0-9a-f]{64}$' OR COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc->>'reviewedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
  RAISE EXCEPTION 'Mission 28 communication permission shape invalid' USING ERRCODE='22023'; END IF;
 IF public.canonical_automation_part4b_keys_exact_v1(doc->'recipientBinding',ARRAY['senderRecipientResolutionId','recipientIndex','recipientClass','recipientRecordId','parentCustomerId','membershipId','role','sourceDigest','contactIdentityDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{recipientBinding,senderRecipientResolutionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc#>>'{recipientBinding,recipientIndex}','')!~'^(0|[1-9][0-9]*)$' OR
    COALESCE(doc#>>'{recipientBinding,recipientClass}','') NOT IN('customer','authorized_billing_contact','lead_or_prospect','staff_member') OR
    COALESCE(doc#>>'{recipientBinding,recipientRecordId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc#>>'{recipientBinding,sourceDigest}','')!~'^sha256:[0-9a-f]{64}$' OR COALESCE(doc#>>'{recipientBinding,contactIdentityDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR doc#>>'{actorBinding,membershipRole}' IS DISTINCT FROM 'owner' THEN
  RAISE EXCEPTION 'Mission 28 recipient or actor binding invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid;permission_value:=(doc->>'permissionId')::uuid;version_value:=(doc->>'version')::bigint;
 resolution_value:=(doc#>>'{recipientBinding,senderRecipientResolutionId}')::uuid;recipient_index_value:=(doc#>>'{recipientBinding,recipientIndex}')::integer;
 actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;session_value:=(doc#>>'{actorBinding,sessionId}')::uuid;membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;
 reviewed_value:=(doc->>'reviewedAt')::timestamptz;preference_value:=doc->>'preferenceState';permission_state_value:=doc->>'permissionState';basis_value:=doc->>'basisState';jurisdiction_value:=doc->>'jurisdictionState';age_value:=doc->>'ageRestrictionState';quiet_value:=doc->>'quietHoursState';
 permission_digest_value:=public.canonical_automation_digest_v1('mission28.communication-permission-version.v1'||chr(10),doc-'permissionDigest'-'requestDigest');
 request_digest_value:=public.canonical_automation_digest_v1('mission28.communication-permission-request.v1'||chr(10),doc-'requestDigest');
 expected_trusted:=jsonb_build_object('tenantId',doc->'tenantId','permissionId',doc->'permissionId','version',doc->'version','recipientBinding',doc->'recipientBinding','channelId',doc->'channelId','preferenceState',doc->'preferenceState','permissionState',doc->'permissionState','basisState',doc->'basisState','basisEvidenceDigest',doc->'basisEvidenceDigest','jurisdictionState',doc->'jurisdictionState','ageRestrictionState',doc->'ageRestrictionState','quietHoursState',doc->'quietHoursState','suppressionState',doc->'suppressionState','previousVersionDigest',doc->'previousVersionDigest','actorBinding',doc->'actorBinding','reviewedAt',doc->'reviewedAt');
 IF permission_digest_value IS DISTINCT FROM doc->>'permissionDigest' OR request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR trusted_resolution IS DISTINCT FROM expected_trusted THEN
  RAISE EXCEPTION 'Mission 28 permission digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-communication-permission:'||permission_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_communication_permission_versions_v1 WHERE organization_id=org AND permission_id=permission_value AND version=version_value;
 IF stored.permission_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN RAISE EXCEPTION 'Mission 28 permission version replay conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('permissionId',stored.permission_id,'version',stored.version,'permissionDigest',stored.permission_digest,'suppressionState',stored.suppression_state,'replayed',TRUE,'effectCreated',FALSE);
 END IF;
 recorded_value:=public.canonical_automation_clock_v1();
 IF reviewed_value>recorded_value OR reviewed_value<recorded_value-INTERVAL '30 seconds' THEN RAISE EXCEPTION 'Mission 28 permission review time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.organization_id=org AND session.id=session_value AND session.user_id=actor_value AND session.membership_id=membership_value
  AND session.status='active' AND session.revoked_at IS NULL AND session.access_expires_at>recorded_value
   AND membership.status='active' AND membership.revoked_at IS NULL AND membership.role='owner' AND account.status='active'
  FOR SHARE OF session,membership,account;
 IF actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Mission 28 permission actor unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO item FROM public.canonical_automation_recipient_authority_items_v1 WHERE organization_id=org AND resolution_id=resolution_value AND recipient_index=recipient_index_value FOR SHARE;
 IF item.resolution_id IS NULL OR item.recipient_class IS DISTINCT FROM doc#>>'{recipientBinding,recipientClass}' OR item.recipient_record_id::text IS DISTINCT FROM doc#>>'{recipientBinding,recipientRecordId}' OR
    COALESCE(to_jsonb(item.parent_customer_id),'null'::jsonb) IS DISTINCT FROM doc#>'{recipientBinding,parentCustomerId}' OR COALESCE(to_jsonb(item.membership_id),'null'::jsonb) IS DISTINCT FROM doc#>'{recipientBinding,membershipId}' OR COALESCE(to_jsonb(item.role),'null'::jsonb) IS DISTINCT FROM doc#>'{recipientBinding,role}' OR
    item.source_digest IS DISTINCT FROM doc#>>'{recipientBinding,sourceDigest}' OR item.contact_identity_digest IS DISTINCT FROM doc#>>'{recipientBinding,contactIdentityDigest}' OR
    public.canonical_automation_part7b_recipient_current_v1(org,resolution_value,recipient_index_value) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 permission recipient source unavailable' USING ERRCODE='42501'; END IF;
 IF permission_state_value='do_not_contact' THEN suppression_value:='suppressed_do_not_contact';
 ELSIF permission_state_value='opted_out' THEN suppression_value:='suppressed_opt_out';
 ELSIF permission_state_value='conflicting' OR basis_value='conflicting_evidence' THEN suppression_value:='suppressed_conflicting';
 ELSIF preference_value='blocked' THEN suppression_value:='suppressed_preference';
 ELSIF jurisdiction_value='restricted' THEN suppression_value:='suppressed_jurisdiction';
 ELSIF age_value='restricted' THEN suppression_value:='suppressed_age';
 ELSIF quiet_value='restricted' THEN suppression_value:='suppressed_quiet_hours';
 ELSIF item.recipient_class='staff_member' AND doc->>'channelId'='in_app_passive' AND permission_state_value='internal_membership_current' AND basis_value='authenticated_tenant_membership' AND preference_value IN('allowed','preferred') AND jurisdiction_value='not_applicable_internal' AND age_value='not_applicable_internal' AND quiet_value='not_applicable_internal_passive' THEN suppression_value:='clear_internal_passive';
 ELSE suppression_value:='unavailable'; END IF;
 IF suppression_value IS DISTINCT FROM doc->>'suppressionState' OR
    (permission_state_value='unknown' AND basis_value IS DISTINCT FROM 'none_unknown') OR
    (permission_state_value='reported_opt_in_unverified' AND basis_value IS DISTINCT FROM 'owner_reviewed_reported_basis_unverified') OR
    (permission_state_value='opted_out' AND basis_value IS DISTINCT FROM 'recipient_opt_out') OR
    (permission_state_value='do_not_contact' AND basis_value IS DISTINCT FROM 'recipient_do_not_contact') OR
    (permission_state_value='conflicting' AND basis_value IS DISTINCT FROM 'conflicting_evidence') OR
    (basis_value='conflicting_evidence' AND permission_state_value IS DISTINCT FROM 'conflicting') OR
    (permission_state_value='internal_membership_current' AND basis_value IS DISTINCT FROM 'authenticated_tenant_membership') OR
    (doc->>'channelId'='in_app_passive' AND item.recipient_class IS DISTINCT FROM 'staff_member') OR
     (doc->>'channelId'<>'in_app_passive' AND permission_state_value='internal_membership_current') OR
     ((item.recipient_class IS DISTINCT FROM 'staff_member' OR doc->>'channelId'<>'in_app_passive') AND
      (jurisdiction_value='not_applicable_internal' OR age_value='not_applicable_internal' OR quiet_value='not_applicable_internal_passive')) THEN
  RAISE EXCEPTION 'Mission 28 permission state coherence invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-communication-subject:'||item.contact_identity_digest||':'||(doc->>'channelId'),0));
 SELECT * INTO subject FROM public.canonical_automation_communication_permission_subjects_v1 WHERE organization_id=org AND contact_identity_digest=item.contact_identity_digest AND channel_id=doc->>'channelId' FOR SHARE;
 IF subject.permission_id IS NULL THEN
  IF version_value<>1 OR doc->'previousVersionDigest'<>'null'::jsonb THEN RAISE EXCEPTION 'Mission 28 permission lineage must begin at version one' USING ERRCODE='22023'; END IF;
  INSERT INTO public.canonical_automation_communication_permission_subjects_v1 VALUES(org,permission_value,item.recipient_class,item.recipient_record_id,item.parent_customer_id,item.membership_id,item.contact_identity_digest,doc->>'channelId',recorded_value);
 ELSE
  IF subject.permission_id IS DISTINCT FROM permission_value OR subject.recipient_class IS DISTINCT FROM item.recipient_class OR subject.recipient_record_id IS DISTINCT FROM item.recipient_record_id OR subject.parent_customer_id IS DISTINCT FROM item.parent_customer_id OR subject.membership_id IS DISTINCT FROM item.membership_id THEN
   RAISE EXCEPTION 'Mission 28 permission subject conflict' USING ERRCODE='23505'; END IF;
 END IF;
 SELECT * INTO previous FROM public.canonical_automation_communication_permission_versions_v1 WHERE organization_id=org AND permission_id=permission_value ORDER BY version DESC LIMIT 1;
 IF version_value=1 THEN
  IF previous.permission_id IS NOT NULL OR doc->'previousVersionDigest'<>'null'::jsonb THEN RAISE EXCEPTION 'Mission 28 permission first version conflict' USING ERRCODE='23505'; END IF;
 ELSIF previous.permission_id IS NULL OR previous.version IS DISTINCT FROM version_value-1 OR previous.permission_digest IS DISTINCT FROM doc->>'previousVersionDigest' THEN
  RAISE EXCEPTION 'Mission 28 permission previous version mismatch' USING ERRCODE='42501'; END IF;
 INSERT INTO public.canonical_automation_communication_permission_versions_v1 VALUES(org,permission_value,version_value,resolution_value,recipient_index_value,item.source_digest,preference_value,permission_state_value,basis_value,doc->>'basisEvidenceDigest',jurisdiction_value,age_value,quiet_value,suppression_value,CASE WHEN doc->'previousVersionDigest'='null'::jsonb THEN NULL ELSE doc->>'previousVersionDigest' END,permission_digest_value,actor_value,session_value,membership_value,'owner',reviewed_value,request_digest_value,canonical_text_value,recorded_value);
 RETURN jsonb_build_object('permissionId',permission_value,'version',version_value,'permissionDigest',permission_digest_value,'suppressionState',suppression_value,'replayed',FALSE,'effectCreated',FALSE);
END $$;

CREATE FUNCTION public.canonical_automation_record_communication_permission_resolution_v1(
 canonical_text_value TEXT,trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE doc JSONB;org UUID;resolution_value UUID;transaction_value UUID;unit_value UUID;sender_resolution_value UUID;actor_value UUID;session_value UUID;membership_value UUID;evaluated_value TIMESTAMPTZ(6);recorded_value TIMESTAMPTZ(6);actor_role TEXT;
 stored public.canonical_automation_communication_permission_resolutions_v1%ROWTYPE;unit_row public.canonical_automation_action_units_v1%ROWTYPE;sender_row public.canonical_automation_sender_recipient_resolutions_v1%ROWTYPE;item public.canonical_automation_recipient_authority_items_v1%ROWTYPE;permission_row public.canonical_automation_communication_permission_versions_v1%ROWTYPE;
 binding JSONB;request_digest_value TEXT;material_digest_value TEXT;permission_set_digest_value TEXT;resolution_digest_value TEXT;result_value TEXT;expected_trusted JSONB;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN RAISE EXCEPTION 'Mission 28 permission resolution bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','permissionResolutionId','transactionId','unitId','senderRecipientResolutionId','permissionBindings','actorBinding','evaluatedAt','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.communication-permission-resolution.v1' OR COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc->>'permissionResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc->>'unitId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc->>'senderRecipientResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(doc->'permissionBindings') IS DISTINCT FROM 'array' OR jsonb_array_length(doc->'permissionBindings')<>1 OR COALESCE(doc->>'evaluatedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole']) IS DISTINCT FROM TRUE OR COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR doc#>>'{actorBinding,membershipRole}' IS DISTINCT FROM 'owner' THEN
  RAISE EXCEPTION 'Mission 28 permission resolution shape invalid' USING ERRCODE='22023'; END IF;
 binding:=doc->'permissionBindings'->0;
 IF public.canonical_automation_part4b_keys_exact_v1(binding,ARRAY['recipientIndex','permissionId','permissionVersion','permissionDigest']) IS DISTINCT FROM TRUE OR binding->>'recipientIndex' IS DISTINCT FROM '0' OR COALESCE(binding->>'permissionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR COALESCE(binding->>'permissionVersion','')!~'^[1-9][0-9]*$' OR COALESCE(binding->>'permissionDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 permission binding invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid;resolution_value:=(doc->>'permissionResolutionId')::uuid;transaction_value:=(doc->>'transactionId')::uuid;unit_value:=(doc->>'unitId')::uuid;sender_resolution_value:=(doc->>'senderRecipientResolutionId')::uuid;actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;session_value:=(doc#>>'{actorBinding,sessionId}')::uuid;membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;evaluated_value:=(doc->>'evaluatedAt')::timestamptz;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.communication-permission-resolution.v1'||chr(10),doc-'requestDigest');
 material_digest_value:=public.canonical_automation_digest_v1('mission28.communication-permission-resolution-material.v1'||chr(10),doc-'permissionResolutionId'-'requestDigest');
 expected_trusted:=jsonb_build_object('tenantId',doc->'tenantId','transactionId',doc->'transactionId','unitId',doc->'unitId','senderRecipientResolutionId',doc->'senderRecipientResolutionId','permissionBindings',doc->'permissionBindings','actorBinding',doc->'actorBinding','evaluatedAt',doc->'evaluatedAt');
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR trusted_resolution IS DISTINCT FROM expected_trusted THEN RAISE EXCEPTION 'Mission 28 permission resolution digest or trust invalid' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-communication-permission-resolution:'||resolution_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-communication-permission:'||(binding->>'permissionId'),0));
 SELECT * INTO stored FROM public.canonical_automation_communication_permission_resolutions_v1 WHERE organization_id=org AND permission_resolution_id=resolution_value;
 IF stored.permission_resolution_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN RAISE EXCEPTION 'Mission 28 permission resolution replay conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('permissionResolutionId',stored.permission_resolution_id,'resultState',stored.result_state,'resolutionDigest',stored.resolution_digest,'replayed',TRUE,'effectCreated',FALSE);
 END IF;
 recorded_value:=public.canonical_automation_clock_v1();
 IF evaluated_value>recorded_value OR evaluated_value<recorded_value-INTERVAL '30 seconds' THEN RAISE EXCEPTION 'Mission 28 permission evaluation time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role FROM public.auth_sessions session JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id AND membership.id=session.membership_id AND membership.user_id=session.user_id JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id WHERE session.organization_id=org AND session.id=session_value AND session.user_id=actor_value AND session.membership_id=membership_value AND session.status='active' AND session.revoked_at IS NULL AND session.access_expires_at>recorded_value AND membership.status='active' AND membership.revoked_at IS NULL AND membership.role='owner' AND account.status='active' FOR SHARE OF session,membership,account;
 IF actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Mission 28 permission resolution actor unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-sender-recipient-unit:'||unit_value::text,0));
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1 WHERE organization_id=org AND unit_id=unit_value AND transaction_id=transaction_value FOR SHARE;
 SELECT * INTO sender_row FROM public.canonical_automation_sender_recipient_resolutions_v1 WHERE organization_id=org AND resolution_id=sender_resolution_value AND unit_id=unit_value AND transaction_id=transaction_value FOR SHARE;
 SELECT * INTO item FROM public.canonical_automation_recipient_authority_items_v1 WHERE organization_id=org AND resolution_id=sender_resolution_value AND recipient_index=0 FOR SHARE;
 IF unit_row.unit_id IS NULL OR sender_row.resolution_id IS NULL OR item.resolution_id IS NULL OR sender_row.recipient_count<>1 OR unit_row.recipient_set_digest IS DISTINCT FROM sender_row.recipient_set_digest OR unit_row.channel_id IS DISTINCT FROM 'in_app_passive' OR unit_row.provider_mode IS DISTINCT FROM 'provider_disabled' OR unit_row.effect_class IS DISTINCT FROM 'internal_record_only' OR public.canonical_automation_part7b_recipient_current_v1(org,sender_resolution_value,0) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 exact no-effect action recipient authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT version_row.* INTO permission_row FROM public.canonical_automation_communication_permission_versions_v1 version_row JOIN public.canonical_automation_communication_permission_subjects_v1 subject ON subject.organization_id=version_row.organization_id AND subject.permission_id=version_row.permission_id WHERE version_row.organization_id=org AND version_row.permission_id=(binding->>'permissionId')::uuid AND version_row.version=(binding->>'permissionVersion')::bigint AND version_row.permission_digest=binding->>'permissionDigest' AND version_row.sender_recipient_resolution_id=sender_resolution_value AND version_row.recipient_index=0 AND subject.recipient_class=item.recipient_class AND subject.recipient_record_id=item.recipient_record_id AND subject.contact_identity_digest=item.contact_identity_digest AND subject.channel_id=unit_row.channel_id FOR SHARE OF version_row,subject;
 IF permission_row.permission_id IS NULL OR permission_row.version IS DISTINCT FROM (SELECT max(latest.version) FROM public.canonical_automation_communication_permission_versions_v1 latest WHERE latest.organization_id=org AND latest.permission_id=permission_row.permission_id) THEN RAISE EXCEPTION 'Mission 28 latest exact permission unavailable' USING ERRCODE='42501'; END IF;
 result_value:=CASE permission_row.suppression_state WHEN 'clear_internal_passive' THEN 'clear_internal_passive_no_effect' ELSE permission_row.suppression_state END;
 permission_set_digest_value:=public.canonical_automation_digest_v1('mission28.communication-permission-set.v1'||chr(10),doc->'permissionBindings');
 resolution_digest_value:=public.canonical_automation_digest_v1('mission28.communication-permission-resolution-evidence.v1'||chr(10),jsonb_build_object('tenantId',org,'permissionResolutionId',resolution_value,'transactionId',transaction_value,'unitId',unit_value,'senderRecipientResolutionId',sender_resolution_value,'recipientSetDigest',sender_row.recipient_set_digest,'permissionSetDigest',permission_set_digest_value,'resultState',result_value,'evaluatedAt',doc->>'evaluatedAt'));
 INSERT INTO public.canonical_automation_communication_permission_resolutions_v1 VALUES(org,resolution_value,transaction_value,unit_value,unit_row.run_id,sender_resolution_value,sender_row.recipient_set_digest,permission_set_digest_value,1,result_value,actor_value,session_value,membership_value,'owner',request_digest_value,material_digest_value,resolution_digest_value,canonical_text_value,evaluated_value,recorded_value);
 INSERT INTO public.canonical_automation_permission_resolution_items_v1 VALUES(org,resolution_value,0,permission_row.permission_id,permission_row.version,permission_row.permission_digest,permission_row.suppression_state,recorded_value);
 RETURN jsonb_build_object('permissionResolutionId',resolution_value,'resultState',result_value,'resolutionDigest',resolution_digest_value,'replayed',FALSE,'effectCreated',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_communication_permission_subjects_v1,public.canonical_automation_communication_permission_versions_v1,public.canonical_automation_communication_permission_resolutions_v1,public.canonical_automation_permission_resolution_items_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_part7b_recipient_current_v1(UUID,UUID,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_communication_permission_version_v1(TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_communication_permission_resolution_v1(TEXT,JSONB) FROM PUBLIC;

COMMENT ON FUNCTION public.canonical_automation_record_communication_permission_resolution_v1(TEXT,JSONB) IS
 'Owner-only Part 7B no-effect permission and suppression evidence. No legal, provider, message, delivery, upstream, accounting, or money authority.';
