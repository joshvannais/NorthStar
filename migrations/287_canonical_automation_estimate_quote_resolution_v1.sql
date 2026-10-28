-- Mission 28 Part 8A: exact current Mission 24 customer-safe estimate binding.
-- No message, link, provider attempt, delivery, response or external effect is created.

CREATE TABLE public.canonical_automation_estimate_quote_resolutions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 estimate_quote_resolution_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 run_id UUID NOT NULL,
 estimate_id UUID NOT NULL,
 customer_estimate_version_id UUID NOT NULL,
 estimate_revision BIGINT NOT NULL CHECK(estimate_revision BETWEEN 1 AND 10000),
 customer_estimate_version_digest TEXT NOT NULL CHECK(customer_estimate_version_digest~'^sha256:[0-9a-f]{64}$'),
 document_digest TEXT NOT NULL CHECK(document_digest~'^sha256:[0-9a-f]{64}$'),
 commercial_approval_id UUID NOT NULL,
 commercial_approval_digest TEXT NOT NULL CHECK(commercial_approval_digest~'^sha256:[0-9a-f]{64}$'),
 terms_id UUID NOT NULL,
 terms_digest TEXT NOT NULL CHECK(terms_digest~'^sha256:[0-9a-f]{64}$'),
 decision_id UUID NOT NULL,
 decision_digest TEXT NOT NULL CHECK(decision_digest~'^sha256:[0-9a-f]{64}$'),
 customer_id UUID NOT NULL,
 customer_identity_digest TEXT NOT NULL CHECK(customer_identity_digest~'^sha256:[0-9a-f]{64}$'),
 authorization_id UUID NOT NULL,
 authorization_kind TEXT NOT NULL CHECK(authorization_kind IN('per_run_approval','standing_authorization')),
 authorization_record_digest TEXT NOT NULL CHECK(authorization_record_digest~'^sha256:[0-9a-f]{64}$'),
 authorization_material_binding_digest TEXT NOT NULL CHECK(authorization_material_binding_digest~'^sha256:[0-9a-f]{64}$'),
 requested_channel_id TEXT NOT NULL CHECK(requested_channel_id IN('email','sms','secure_link','native_handoff')),
 requested_profile_id TEXT NOT NULL CHECK(requested_profile_id='current_launch_exact_document_external_delivery_unavailable'),
 document_state TEXT NOT NULL CHECK(document_state='exact_current_approved_customer_safe_version'),
 recipient_preview_state TEXT NOT NULL CHECK(recipient_preview_state='exact_current_customer_identity_preview_no_send_authority'),
 message_preview_state TEXT NOT NULL CHECK(message_preview_state='unavailable_no_accepted_external_customer_estimate_template'),
 channel_preview_state TEXT NOT NULL CHECK(channel_preview_state='unavailable_no_accepted_external_customer_channel'),
 authorization_reference_state TEXT NOT NULL CHECK(authorization_reference_state='exact_part3b_reference_no_external_delivery_authority'),
 expiration_state TEXT NOT NULL CHECK(expiration_state='not_created_no_access_grant'),
 customer_response_state TEXT NOT NULL CHECK(customer_response_state='unavailable_no_access_or_authenticated_response'),
 delivery_state TEXT NOT NULL CHECK(delivery_state='unavailable_no_message_or_access'),
 price_mutation_state TEXT NOT NULL CHECK(price_mutation_state='forbidden_none'),
 scope_mutation_state TEXT NOT NULL CHECK(scope_mutation_state='forbidden_none'),
 result_state TEXT NOT NULL CHECK(result_state='exact_document_bound_external_delivery_unavailable'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role='owner'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 estimate_quote_resolution_digest TEXT NOT NULL CHECK(estimate_quote_resolution_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 16384),
 evaluated_at TIMESTAMPTZ(6) NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,estimate_quote_resolution_id),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,material_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,estimate_id,customer_estimate_version_id)
  REFERENCES public.canonical_customer_estimate_versions(organization_id,estimate_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,customer_id)
  REFERENCES public.canonical_customers(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX canonical_automation_estimate_quote_resolutions_v1_estimate
 ON public.canonical_automation_estimate_quote_resolutions_v1(organization_id,estimate_id,recorded_at,estimate_quote_resolution_id);

CREATE TRIGGER canonical_automation_estimate_quote_resolutions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_estimate_quote_resolutions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_estimate_quote_resolutions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_estimate_quote_resolutions_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_estimate_quote_resolutions_v1_tenant_owner_only
 ON public.canonical_automation_estimate_quote_resolutions_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_estimate_quote_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_estimate_quote_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_record_estimate_quote_resolution_v1(
 canonical_text_value TEXT,trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE
 doc JSONB; expected_trusted JSONB; org UUID; resolution_value UUID; transaction_value UUID; unit_value UUID;
 actor_value UUID; session_value UUID; membership_value UUID; estimate_value UUID; version_value UUID;
 evaluated_value TIMESTAMPTZ(6); recorded_value TIMESTAMPTZ(6); actor_role TEXT;
 transaction_row public.canonical_automation_action_transactions_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 version_row public.canonical_customer_estimate_versions%ROWTYPE;
 terms_row public.canonical_commercial_terms%ROWTYPE;
 approval_row public.canonical_commercial_approvals%ROWTYPE;
 estimate_row public.canonical_estimates%ROWTYPE;
 opportunity_row public.canonical_opportunities%ROWTYPE;
 customer_row public.canonical_customers%ROWTYPE;
 stored public.canonical_automation_estimate_quote_resolutions_v1%ROWTYPE;
 sources JSONB; current_state JSONB; expected_document JSONB;
 request_digest_value TEXT; material_digest_value TEXT; resolution_digest_value TEXT; customer_digest_value TEXT;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 16384 THEN
  RAISE EXCEPTION 'Mission 28 estimate quote resolution bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','estimateQuoteResolutionId','transactionId','unitId','estimateBinding','authorizationBinding','requestedChannelId','requestedProfileId','actorBinding','evaluatedAt','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.estimate-quote-resolution.v1' OR
    COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'estimateQuoteResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'unitId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc->>'requestedChannelId' IS NULL OR doc->>'requestedChannelId'<>ALL(ARRAY['email','sms','secure_link','native_handoff']) OR
    doc->>'requestedProfileId' IS DISTINCT FROM 'current_launch_exact_document_external_delivery_unavailable' OR
    COALESCE(doc->>'evaluatedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc#>>'{actorBinding,membershipRole}' IS DISTINCT FROM 'owner' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'estimateBinding',ARRAY['estimateId','customerEstimateVersionId','revision','customerEstimateVersionDigest','documentDigest','commercialApprovalId','commercialApprovalDigest','termsId','termsDigest','decisionId','decisionDigest']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{estimateBinding,estimateId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{estimateBinding,customerEstimateVersionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{estimateBinding,revision}') IS DISTINCT FROM 'number' OR (doc#>>'{estimateBinding,revision}')!~'^[1-9][0-9]{0,3}$' OR
    COALESCE(doc#>>'{estimateBinding,customerEstimateVersionDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{estimateBinding,documentDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{estimateBinding,commercialApprovalId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{estimateBinding,commercialApprovalDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{estimateBinding,termsId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{estimateBinding,termsDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{estimateBinding,decisionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{estimateBinding,decisionDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'authorizationBinding',ARRAY['authorizationId','authorizationKind','authorizationRecordDigest','authorizationMaterialBindingDigest']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{authorizationBinding,authorizationId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc#>>'{authorizationBinding,authorizationKind}' IS NULL OR doc#>>'{authorizationBinding,authorizationKind}'<>ALL(ARRAY['per_run_approval','standing_authorization']) OR
    COALESCE(doc#>>'{authorizationBinding,authorizationRecordDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{authorizationBinding,authorizationMaterialBindingDigest}','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 estimate quote resolution shape invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid; resolution_value:=(doc->>'estimateQuoteResolutionId')::uuid;
 transaction_value:=(doc->>'transactionId')::uuid; unit_value:=(doc->>'unitId')::uuid;
 actor_value:=(doc#>>'{actorBinding,actorId}')::uuid; session_value:=(doc#>>'{actorBinding,sessionId}')::uuid;
 membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid; estimate_value:=(doc#>>'{estimateBinding,estimateId}')::uuid;
 version_value:=(doc#>>'{estimateBinding,customerEstimateVersionId}')::uuid; evaluated_value:=(doc->>'evaluatedAt')::timestamptz;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.estimate-quote-resolution.v1'||chr(10),doc-'requestDigest');
 expected_trusted:=jsonb_build_object('tenantId',doc->'tenantId','transactionId',doc->'transactionId','unitId',doc->'unitId',
  'estimateBinding',doc->'estimateBinding','authorizationBinding',doc->'authorizationBinding','requestedChannelId',doc->'requestedChannelId',
  'requestedProfileId',doc->'requestedProfileId','actorBinding',doc->'actorBinding','evaluatedAt',doc->'evaluatedAt');
 material_digest_value:=public.canonical_automation_digest_v1('mission28.estimate-quote-resolution-material.v1'||chr(10),expected_trusted);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR trusted_resolution IS DISTINCT FROM expected_trusted THEN
  RAISE EXCEPTION 'Mission 28 estimate quote digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-estimate-quote-resolution:'||resolution_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_estimate_quote_resolutions_v1
  WHERE organization_id=org AND estimate_quote_resolution_id=resolution_value;
 IF stored.estimate_quote_resolution_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 estimate quote replay conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('estimateQuoteResolutionId',stored.estimate_quote_resolution_id,'resultState',stored.result_state,
   'estimateQuoteResolutionDigest',stored.estimate_quote_resolution_digest,'replayed',TRUE,'messageCreated',FALSE,
   'accessGrantCreated',FALSE,'providerAttempted',FALSE,'customerResponseCreated',FALSE,'priceOrScopeMutated',FALSE,'effectCreated',FALSE);
 END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF evaluated_value>recorded_value OR evaluated_value<recorded_value-INTERVAL '30 seconds' THEN
  RAISE EXCEPTION 'Mission 28 estimate quote resolution time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.organization_id=org AND session.id=session_value AND session.user_id=actor_value AND session.membership_id=membership_value
  AND session.status='active' AND session.revoked_at IS NULL AND session.access_expires_at>recorded_value
  AND membership.status='active' AND membership.revoked_at IS NULL AND membership.role='owner' AND account.status='active'
 FOR SHARE OF session,membership,account;
 IF actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Mission 28 estimate quote actor unavailable' USING ERRCODE='42501'; END IF;

 -- Match the Mission 24 commercial lock order so version/link writers serialize.
 PERFORM 1 FROM public.organizations WHERE id=org FOR SHARE;
 PERFORM public.canonical_travel_fence(org,estimate_value);
 SELECT * INTO estimate_row FROM public.canonical_estimates WHERE organization_id=org AND id=estimate_value FOR SHARE;
 SELECT * INTO transaction_row FROM public.canonical_automation_action_transactions_v1
  WHERE organization_id=org AND transaction_id=transaction_value FOR SHARE;
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND unit_id=unit_value FOR SHARE;
 SELECT * INTO version_row FROM public.canonical_customer_estimate_versions
  WHERE organization_id=org AND estimate_id=estimate_value AND id=version_value FOR SHARE;
 SELECT * INTO terms_row FROM public.canonical_commercial_terms
  WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO approval_row FROM public.canonical_commercial_approvals
  WHERE organization_id=org AND estimate_id=estimate_value ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 SELECT * INTO opportunity_row FROM public.canonical_opportunities
  WHERE organization_id=org AND id=estimate_row.opportunity_id FOR SHARE;
 SELECT * INTO customer_row FROM public.canonical_customers
  WHERE organization_id=org AND id=opportunity_row.customer_id FOR SHARE;
 IF estimate_row.id IS NULL OR transaction_row.transaction_id IS NULL OR unit_row.unit_id IS NULL OR version_row.id IS NULL OR
    terms_row.id IS NULL OR approval_row.id IS NULL OR customer_row.id IS NULL OR
    version_row.id IS DISTINCT FROM (SELECT latest.id FROM public.canonical_customer_estimate_versions latest
      WHERE latest.organization_id=org AND latest.estimate_id=estimate_value ORDER BY latest.revision DESC LIMIT 1) OR
    version_row.revision IS DISTINCT FROM (doc#>>'{estimateBinding,revision}')::bigint OR
    'sha256:'||version_row.digest IS DISTINCT FROM doc#>>'{estimateBinding,customerEstimateVersionDigest}' OR
    'sha256:'||version_row.document_digest IS DISTINCT FROM doc#>>'{estimateBinding,documentDigest}' OR
    version_row.commercial_approval_id IS DISTINCT FROM (doc#>>'{estimateBinding,commercialApprovalId}')::uuid OR
    'sha256:'||approval_row.digest IS DISTINCT FROM doc#>>'{estimateBinding,commercialApprovalDigest}' OR
    version_row.terms_id IS DISTINCT FROM (doc#>>'{estimateBinding,termsId}')::uuid OR
    'sha256:'||terms_row.digest IS DISTINCT FROM doc#>>'{estimateBinding,termsDigest}' OR
    version_row.decision_id IS DISTINCT FROM (doc#>>'{estimateBinding,decisionId}')::uuid OR
    'sha256:'||(approval_row.decision_pin->>'digest') IS DISTINCT FROM doc#>>'{estimateBinding,decisionDigest}' OR
    approval_row.id IS DISTINCT FROM version_row.commercial_approval_id OR approval_row.terms_id IS DISTINCT FROM terms_row.id OR
    transaction_row.run_id IS DISTINCT FROM unit_row.run_id OR
    transaction_row.document->'authorizationBinding' IS DISTINCT FROM doc->'authorizationBinding' OR
    transaction_row.authorization_digest IS DISTINCT FROM public.canonical_automation_digest_v1('mission28.authorization-binding.v1'||chr(10),doc->'authorizationBinding') OR
    unit_row.action_family_id IS DISTINCT FROM 'owner_approval_request' OR unit_row.action_template_id IS DISTINCT FROM 'owner_approval_request_v1' OR
    unit_row.provider_mode IS DISTINCT FROM 'provider_disabled' OR unit_row.effect_class IS DISTINCT FROM 'internal_record_only' OR
    unit_row.channel_id IS DISTINCT FROM 'in_app_passive' OR
    EXISTS(SELECT 1 FROM public.canonical_customer_estimate_delivery_links legacy
      WHERE legacy.organization_id=org AND legacy.estimate_id=estimate_value AND legacy.version_id=version_value) THEN
  RAISE EXCEPTION 'Mission 28 exact current estimate quote authority unavailable' USING ERRCODE='42501'; END IF;

 sources:=public.canonical_commercial_sources(org,actor_value,'owner',session_value,estimate_value,NULL);
 current_state:=public.canonical_commercial_current(public.canonical_commercial_projection(terms_row),sources,public.canonical_commercial_binding_projection(approval_row));
 expected_document:=public.canonical_customer_estimate_version_document(org,estimate_value,terms_row,approval_row);
 -- Mission24 sealed preparedAt as an exact timestamptz rendered in the issuing
 -- session offset. Tenant entry uses UTC, so bind the immutable instant while
 -- preserving that exact issued representation before comparing the document.
 IF COALESCE(version_row.document->>'preparedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?([+-][0-9]{2}:[0-9]{2}|Z)$' OR
    (version_row.document->>'preparedAt')::timestamptz IS DISTINCT FROM approval_row.created_at THEN
  RAISE EXCEPTION 'Mission 28 approved customer estimate time changed' USING ERRCODE='40001'; END IF;
 expected_document:=jsonb_set(expected_document,'{preparedAt}',version_row.document->'preparedAt',FALSE);
 expected_document:=jsonb_set(expected_document,'{reference}',to_jsonb('EST-'||upper(substr(encode(sha256(convert_to(
  public.canonical_customer_estimate_version_stable_text(expected_document-'reference'-'state'-'notice'-'capabilities'-'platformSignature'),'UTF8')),'hex'),1,10))),FALSE);
 IF current_state->'current' IS DISTINCT FROM 'true'::jsonb OR current_state->'linkedApproval' IS DISTINCT FROM 'true'::jsonb OR
    version_row.document IS DISTINCT FROM expected_document OR version_row.document_digest IS DISTINCT FROM public.canonical_completion_digest(version_row.document) THEN
  RAISE EXCEPTION 'Mission 28 approved customer estimate changed' USING ERRCODE='40001'; END IF;

 customer_digest_value:=public.canonical_automation_digest_v1('mission28.customer-identity-preview.v1'||chr(10),jsonb_build_object(
  'tenantId',org,'customerId',customer_row.id,'operationId',customer_row.operation_id,'updatedAt',customer_row.updated_at));
 resolution_digest_value:=public.canonical_automation_digest_v1('mission28.estimate-quote-resolution-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org,'estimateQuoteResolutionId',resolution_value,'transactionId',transaction_value,'unitId',unit_value,'runId',unit_row.run_id,
  'estimateBinding',doc->'estimateBinding','customerId',customer_row.id,'customerIdentityDigest',customer_digest_value,
  'authorizationBinding',doc->'authorizationBinding','requestedChannelId',doc->>'requestedChannelId',
  'requestedProfileId','current_launch_exact_document_external_delivery_unavailable',
  'documentState','exact_current_approved_customer_safe_version','recipientPreviewState','exact_current_customer_identity_preview_no_send_authority',
  'messagePreviewState','unavailable_no_accepted_external_customer_estimate_template','channelPreviewState','unavailable_no_accepted_external_customer_channel',
  'authorizationReferenceState','exact_part3b_reference_no_external_delivery_authority','expirationState','not_created_no_access_grant',
  'customerResponseState','unavailable_no_access_or_authenticated_response','deliveryState','unavailable_no_message_or_access',
  'priceMutationState','forbidden_none','scopeMutationState','forbidden_none','resultState','exact_document_bound_external_delivery_unavailable',
  'evaluatedAt',doc->>'evaluatedAt'));

 INSERT INTO public.canonical_automation_estimate_quote_resolutions_v1(
  organization_id,estimate_quote_resolution_id,transaction_id,unit_id,run_id,estimate_id,customer_estimate_version_id,estimate_revision,
  customer_estimate_version_digest,document_digest,commercial_approval_id,commercial_approval_digest,terms_id,terms_digest,decision_id,
  decision_digest,customer_id,customer_identity_digest,authorization_id,authorization_kind,authorization_record_digest,
  authorization_material_binding_digest,requested_channel_id,requested_profile_id,document_state,recipient_preview_state,message_preview_state,
  channel_preview_state,authorization_reference_state,expiration_state,customer_response_state,delivery_state,price_mutation_state,scope_mutation_state,
  result_state,actor_user_id,auth_session_id,membership_id,actor_role,request_digest,material_digest,estimate_quote_resolution_digest,
  canonical_text,evaluated_at,recorded_at)
 VALUES(org,resolution_value,transaction_value,unit_value,unit_row.run_id,estimate_value,version_value,version_row.revision,
  'sha256:'||version_row.digest,'sha256:'||version_row.document_digest,approval_row.id,'sha256:'||approval_row.digest,terms_row.id,
  'sha256:'||terms_row.digest,version_row.decision_id,doc#>>'{estimateBinding,decisionDigest}',customer_row.id,customer_digest_value,
  (doc#>>'{authorizationBinding,authorizationId}')::uuid,doc#>>'{authorizationBinding,authorizationKind}',
  doc#>>'{authorizationBinding,authorizationRecordDigest}',doc#>>'{authorizationBinding,authorizationMaterialBindingDigest}',
  doc->>'requestedChannelId','current_launch_exact_document_external_delivery_unavailable','exact_current_approved_customer_safe_version',
  'exact_current_customer_identity_preview_no_send_authority','unavailable_no_accepted_external_customer_estimate_template',
  'unavailable_no_accepted_external_customer_channel','exact_part3b_reference_no_external_delivery_authority','not_created_no_access_grant',
  'unavailable_no_access_or_authenticated_response','unavailable_no_message_or_access','forbidden_none','forbidden_none',
  'exact_document_bound_external_delivery_unavailable',actor_value,session_value,membership_value,'owner',request_digest_value,
  material_digest_value,resolution_digest_value,canonical_text_value,evaluated_value,recorded_value);
 RETURN jsonb_build_object('estimateQuoteResolutionId',resolution_value,'resultState','exact_document_bound_external_delivery_unavailable',
  'estimateQuoteResolutionDigest',resolution_digest_value,'replayed',FALSE,'messageCreated',FALSE,'accessGrantCreated',FALSE,
  'providerAttempted',FALSE,'customerResponseCreated',FALSE,'priceOrScopeMutated',FALSE,'effectCreated',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_estimate_quote_resolutions_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_estimate_quote_resolution_v1(TEXT,JSONB) FROM PUBLIC;
