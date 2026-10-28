-- Mission 28 Part 7F: durable provider-neutral no-evidence resolution.
-- Current launch has no provider attempt, callback, receipt, reply, opt-out,
-- correction, suppression mutation, delivery outcome, recipient message or effect.

CREATE TABLE public.canonical_automation_delivery_evidence_resolutions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 delivery_evidence_resolution_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 run_id UUID NOT NULL,
 content_preview_id UUID NOT NULL,
 content_preview_digest TEXT NOT NULL CHECK(content_preview_digest~'^sha256:[0-9a-f]{64}$'),
 channel_resolution_id UUID NOT NULL,
 channel_resolution_digest TEXT NOT NULL CHECK(channel_resolution_digest~'^sha256:[0-9a-f]{64}$'),
 link_attachment_resolution_id UUID NOT NULL,
 link_attachment_resolution_digest TEXT NOT NULL CHECK(link_attachment_resolution_digest~'^sha256:[0-9a-f]{64}$'),
 sender_recipient_resolution_id UUID NOT NULL,
 permission_resolution_id UUID NOT NULL,
 requested_profile_id TEXT NOT NULL CHECK(requested_profile_id='current_launch_no_provider_or_recipient_evidence'),
 provider_attempt_state TEXT NOT NULL CHECK(provider_attempt_state='not_created'),
 provider_acknowledgement_state TEXT NOT NULL CHECK(provider_acknowledgement_state='unavailable_no_attempt'),
 callback_state TEXT NOT NULL CHECK(callback_state='not_received_no_callback_authority'),
 delivery_state TEXT NOT NULL CHECK(delivery_state='unavailable_no_message_or_evidence'),
 open_state TEXT NOT NULL CHECK(open_state='unavailable_not_supported'),
 reply_state TEXT NOT NULL CHECK(reply_state='unavailable_no_authenticated_inbound'),
 question_state TEXT NOT NULL CHECK(question_state='unavailable_no_authenticated_inbound'),
 opt_out_state TEXT NOT NULL CHECK(opt_out_state='unavailable_no_authenticated_inbound'),
 complaint_state TEXT NOT NULL CHECK(complaint_state='unavailable_no_authenticated_provider_evidence'),
 undeliverable_state TEXT NOT NULL CHECK(undeliverable_state='unavailable_no_provider_evidence'),
 correction_state TEXT NOT NULL CHECK(correction_state='not_created'),
 strongest_claim TEXT NOT NULL CHECK(strongest_claim='none'),
 reconciliation_state TEXT NOT NULL CHECK(reconciliation_state='no_provider_evidence_to_reconcile'),
 suppression_propagation_state TEXT NOT NULL CHECK(suppression_propagation_state='no_new_suppression_evidence'),
 result_state TEXT NOT NULL CHECK(result_state='unavailable_no_effect_evidence'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role='owner'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 delivery_evidence_resolution_digest TEXT NOT NULL CHECK(delivery_evidence_resolution_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 16384),
 evaluated_at TIMESTAMPTZ(6) NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,delivery_evidence_resolution_id),
 UNIQUE(organization_id,link_attachment_resolution_id),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,material_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,content_preview_id)
  REFERENCES public.canonical_automation_content_previews_v1(organization_id,content_preview_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,channel_resolution_id)
  REFERENCES public.canonical_automation_channel_resolutions_v1(organization_id,channel_resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,link_attachment_resolution_id)
  REFERENCES public.canonical_automation_link_attachment_resolutions_v1(organization_id,link_attachment_resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,sender_recipient_resolution_id)
  REFERENCES public.canonical_automation_sender_recipient_resolutions_v1(organization_id,resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,permission_resolution_id)
  REFERENCES public.canonical_automation_communication_permission_resolutions_v1(organization_id,permission_resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TRIGGER canonical_automation_delivery_evidence_resolutions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_delivery_evidence_resolutions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_delivery_evidence_resolutions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_evidence_resolutions_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_delivery_evidence_resolutions_v1_tenant_owner_only
 ON public.canonical_automation_delivery_evidence_resolutions_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_delivery_evidence_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_delivery_evidence_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_record_delivery_evidence_resolution_v1(
 canonical_text_value TEXT,trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE
 doc JSONB;expected_trusted JSONB;org UUID;resolution_value UUID;transaction_value UUID;unit_value UUID;
 preview_value UUID;channel_value UUID;link_value UUID;sender_value UUID;permission_value UUID;
 actor_value UUID;session_value UUID;membership_value UUID;evaluated_value TIMESTAMPTZ(6);recorded_value TIMESTAMPTZ(6);actor_role TEXT;
 preview_row public.canonical_automation_content_previews_v1%ROWTYPE;
 channel_row public.canonical_automation_channel_resolutions_v1%ROWTYPE;
 link_row public.canonical_automation_link_attachment_resolutions_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 sender_row public.canonical_automation_sender_recipient_resolutions_v1%ROWTYPE;
 recipient_row public.canonical_automation_recipient_authority_items_v1%ROWTYPE;
 permission_resolution public.canonical_automation_communication_permission_resolutions_v1%ROWTYPE;
 permission_item public.canonical_automation_permission_resolution_items_v1%ROWTYPE;
 permission_version public.canonical_automation_communication_permission_versions_v1%ROWTYPE;
 permission_subject public.canonical_automation_communication_permission_subjects_v1%ROWTYPE;
 stored public.canonical_automation_delivery_evidence_resolutions_v1%ROWTYPE;
 request_digest_value TEXT;material_digest_value TEXT;resolution_digest_value TEXT;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 16384 THEN
  RAISE EXCEPTION 'Mission 28 delivery evidence resolution bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY[
    'schemaVersion','tenantId','deliveryEvidenceResolutionId','transactionId','unitId','contentPreviewId','channelResolutionId',
    'linkAttachmentResolutionId','senderRecipientResolutionId','permissionResolutionId','requestedProfileId','actorBinding','evaluatedAt','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.delivery-evidence-resolution.v1' OR
    COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'deliveryEvidenceResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'unitId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'contentPreviewId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'channelResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'linkAttachmentResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'senderRecipientResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'permissionResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc->>'requestedProfileId' IS DISTINCT FROM 'current_launch_no_provider_or_recipient_evidence' OR
    COALESCE(doc->>'evaluatedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc#>>'{actorBinding,membershipRole}' IS DISTINCT FROM 'owner' THEN
  RAISE EXCEPTION 'Mission 28 delivery evidence resolution shape invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid;resolution_value:=(doc->>'deliveryEvidenceResolutionId')::uuid;
 transaction_value:=(doc->>'transactionId')::uuid;unit_value:=(doc->>'unitId')::uuid;
 preview_value:=(doc->>'contentPreviewId')::uuid;channel_value:=(doc->>'channelResolutionId')::uuid;
 link_value:=(doc->>'linkAttachmentResolutionId')::uuid;sender_value:=(doc->>'senderRecipientResolutionId')::uuid;
 permission_value:=(doc->>'permissionResolutionId')::uuid;actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;
 session_value:=(doc#>>'{actorBinding,sessionId}')::uuid;membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;
 evaluated_value:=(doc->>'evaluatedAt')::timestamptz;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-evidence-resolution.v1'||chr(10),doc-'requestDigest');
 expected_trusted:=jsonb_build_object('tenantId',doc->'tenantId','transactionId',doc->'transactionId','unitId',doc->'unitId',
  'contentPreviewId',doc->'contentPreviewId','channelResolutionId',doc->'channelResolutionId',
  'linkAttachmentResolutionId',doc->'linkAttachmentResolutionId','senderRecipientResolutionId',doc->'senderRecipientResolutionId',
  'permissionResolutionId',doc->'permissionResolutionId','requestedProfileId',doc->'requestedProfileId',
  'actorBinding',doc->'actorBinding','evaluatedAt',doc->'evaluatedAt');
 material_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-evidence-resolution-material.v1'||chr(10),expected_trusted);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR trusted_resolution IS DISTINCT FROM expected_trusted THEN
  RAISE EXCEPTION 'Mission 28 delivery evidence digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-delivery-evidence-resolution:'||resolution_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_delivery_evidence_resolutions_v1
  WHERE organization_id=org AND delivery_evidence_resolution_id=resolution_value;
 IF stored.delivery_evidence_resolution_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 delivery evidence replay conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('deliveryEvidenceResolutionId',stored.delivery_evidence_resolution_id,'resultState',stored.result_state,
   'deliveryEvidenceResolutionDigest',stored.delivery_evidence_resolution_digest,'replayed',TRUE,
   'providerEventIngested',FALSE,'callbackAccepted',FALSE,'receiptPersisted',FALSE,'openPersisted',FALSE,
   'replyPersisted',FALSE,'questionPersisted',FALSE,'optOutPersisted',FALSE,'complaintPersisted',FALSE,
   'correctionPersisted',FALSE,'suppressionCreated',FALSE,'messageSent',FALSE,'delivered',FALSE,'effectCreated',FALSE);
 END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF evaluated_value>recorded_value OR evaluated_value<recorded_value-INTERVAL '30 seconds' THEN
  RAISE EXCEPTION 'Mission 28 delivery evidence resolution time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.organization_id=org AND session.id=session_value AND session.user_id=actor_value AND session.membership_id=membership_value
  AND session.status='active' AND session.revoked_at IS NULL AND session.access_expires_at>recorded_value
  AND membership.status='active' AND membership.revoked_at IS NULL AND membership.role='owner' AND account.status='active'
 FOR SHARE OF session,membership,account;
 IF actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Mission 28 delivery evidence actor unavailable' USING ERRCODE='42501'; END IF;

 SELECT * INTO permission_resolution FROM public.canonical_automation_communication_permission_resolutions_v1
  WHERE organization_id=org AND permission_resolution_id=permission_value FOR SHARE;
 SELECT * INTO permission_item FROM public.canonical_automation_permission_resolution_items_v1
  WHERE organization_id=org AND permission_resolution_id=permission_value AND recipient_index=0 FOR SHARE;
 IF permission_resolution.permission_resolution_id IS NULL OR permission_item.permission_resolution_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 delivery evidence permission unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-communication-permission:'||permission_item.permission_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-sender-recipient-unit:'||unit_value::text,0));

 SELECT * INTO link_row FROM public.canonical_automation_link_attachment_resolutions_v1
  WHERE organization_id=org AND link_attachment_resolution_id=link_value FOR SHARE;
 SELECT * INTO channel_row FROM public.canonical_automation_channel_resolutions_v1
  WHERE organization_id=org AND channel_resolution_id=channel_value FOR SHARE;
 SELECT * INTO preview_row FROM public.canonical_automation_content_previews_v1
  WHERE organization_id=org AND content_preview_id=preview_value FOR SHARE;
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=org AND unit_id=unit_value AND transaction_id=transaction_value FOR SHARE;
 SELECT * INTO sender_row FROM public.canonical_automation_sender_recipient_resolutions_v1
  WHERE organization_id=org AND resolution_id=sender_value AND unit_id=unit_value AND transaction_id=transaction_value FOR SHARE;
 SELECT * INTO recipient_row FROM public.canonical_automation_recipient_authority_items_v1
  WHERE organization_id=org AND resolution_id=sender_value AND recipient_index=0 FOR SHARE;
 SELECT * INTO permission_version FROM public.canonical_automation_communication_permission_versions_v1
  WHERE organization_id=org AND permission_id=permission_item.permission_id AND version=permission_item.permission_version
   AND permission_digest=permission_item.permission_digest FOR SHARE;
 SELECT * INTO permission_subject FROM public.canonical_automation_communication_permission_subjects_v1
  WHERE organization_id=org AND permission_id=permission_item.permission_id FOR SHARE;
 IF link_row.link_attachment_resolution_id IS NULL OR channel_row.channel_resolution_id IS NULL OR preview_row.content_preview_id IS NULL OR
    unit_row.unit_id IS NULL OR sender_row.resolution_id IS NULL OR recipient_row.resolution_id IS NULL OR
    permission_version.permission_id IS NULL OR permission_subject.permission_id IS NULL OR
    link_row.transaction_id IS DISTINCT FROM transaction_value OR link_row.unit_id IS DISTINCT FROM unit_value OR
    link_row.run_id IS DISTINCT FROM unit_row.run_id OR link_row.content_preview_id IS DISTINCT FROM preview_value OR
    link_row.content_preview_digest IS DISTINCT FROM preview_row.content_preview_digest OR
    link_row.channel_resolution_id IS DISTINCT FROM channel_value OR link_row.channel_resolution_digest IS DISTINCT FROM channel_row.channel_resolution_digest OR
    link_row.sender_recipient_resolution_id IS DISTINCT FROM sender_value OR link_row.permission_resolution_id IS DISTINCT FROM permission_value OR
    link_row.requested_profile_id IS DISTINCT FROM 'current_launch_no_external_access' OR
    link_row.document_authority_state IS DISTINCT FROM 'unavailable_until_part8' OR
    link_row.link_state IS DISTINCT FROM 'unavailable_no_accepted_secure_document_delivery' OR
    link_row.attachment_state IS DISTINCT FROM 'unavailable_no_accepted_customer_safe_document' OR
    link_row.token_state IS DISTINCT FROM 'not_generated' OR link_row.token_digest_state IS DISTINCT FROM 'not_persisted' OR
    link_row.result_state IS DISTINCT FROM 'unavailable_no_access_grant' OR
    channel_row.transaction_id IS DISTINCT FROM transaction_value OR channel_row.unit_id IS DISTINCT FROM unit_value OR
    channel_row.content_preview_id IS DISTINCT FROM preview_value OR channel_row.content_preview_digest IS DISTINCT FROM preview_row.content_preview_digest OR
    channel_row.sender_recipient_resolution_id IS DISTINCT FROM sender_value OR channel_row.permission_resolution_id IS DISTINCT FROM permission_value OR
    channel_row.provider_mode IS DISTINCT FROM 'provider_disabled' OR channel_row.provider_request_identity_state IS DISTINCT FROM 'not_created' OR
    channel_row.fallback_state IS DISTINCT FROM 'none' OR channel_row.attempt_state IS DISTINCT FROM 'not_created' OR
    preview_row.transaction_id IS DISTINCT FROM transaction_value OR preview_row.unit_id IS DISTINCT FROM unit_value OR
    preview_row.sender_recipient_resolution_id IS DISTINCT FROM sender_value OR preview_row.permission_resolution_id IS DISTINCT FROM permission_value OR
    permission_resolution.transaction_id IS DISTINCT FROM transaction_value OR permission_resolution.unit_id IS DISTINCT FROM unit_value OR
    permission_resolution.sender_recipient_resolution_id IS DISTINCT FROM sender_value OR
    permission_resolution.result_state IS DISTINCT FROM 'clear_internal_passive_no_effect' OR sender_row.recipient_count IS DISTINCT FROM 1 OR
    unit_row.recipient_set_digest IS DISTINCT FROM sender_row.recipient_set_digest OR unit_row.run_id IS DISTINCT FROM channel_row.run_id OR
    unit_row.channel_id IS DISTINCT FROM 'in_app_passive' OR unit_row.provider_mode IS DISTINCT FROM 'provider_disabled' OR
    unit_row.effect_class IS DISTINCT FROM 'internal_record_only' OR preview_row.link_selection_count IS DISTINCT FROM 0 OR
    preview_row.attachment_selection_count IS DISTINCT FROM 0 OR permission_subject.channel_id IS DISTINCT FROM 'in_app_passive' OR
    permission_subject.recipient_class IS DISTINCT FROM recipient_row.recipient_class OR
    permission_subject.recipient_record_id IS DISTINCT FROM recipient_row.recipient_record_id OR
    permission_subject.contact_identity_digest IS DISTINCT FROM recipient_row.contact_identity_digest OR
    permission_version.suppression_state IS DISTINCT FROM 'clear_internal_passive' OR
    permission_version.version IS DISTINCT FROM (SELECT max(latest.version) FROM public.canonical_automation_communication_permission_versions_v1 latest
      WHERE latest.organization_id=org AND latest.permission_id=permission_version.permission_id) OR
    public.canonical_automation_part7b_recipient_current_v1(org,sender_value,0) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 exact current delivery evidence authority unavailable' USING ERRCODE='42501'; END IF;

 resolution_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-evidence-resolution-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org,'deliveryEvidenceResolutionId',resolution_value,'transactionId',transaction_value,'unitId',unit_value,'runId',unit_row.run_id,
  'contentPreviewId',preview_value,'contentPreviewDigest',preview_row.content_preview_digest,'channelResolutionId',channel_value,
  'channelResolutionDigest',channel_row.channel_resolution_digest,'linkAttachmentResolutionId',link_value,
  'linkAttachmentResolutionDigest',link_row.link_attachment_resolution_digest,'senderRecipientResolutionId',sender_value,
  'permissionResolutionId',permission_value,'requestedProfileId','current_launch_no_provider_or_recipient_evidence',
  'providerAttemptState','not_created','providerAcknowledgementState','unavailable_no_attempt',
  'callbackState','not_received_no_callback_authority','deliveryState','unavailable_no_message_or_evidence',
  'openState','unavailable_not_supported','replyState','unavailable_no_authenticated_inbound',
  'questionState','unavailable_no_authenticated_inbound','optOutState','unavailable_no_authenticated_inbound',
  'complaintState','unavailable_no_authenticated_provider_evidence','undeliverableState','unavailable_no_provider_evidence',
  'correctionState','not_created','strongestClaim','none','reconciliationState','no_provider_evidence_to_reconcile',
  'suppressionPropagationState','no_new_suppression_evidence','resultState','unavailable_no_effect_evidence','evaluatedAt',doc->>'evaluatedAt'));
 INSERT INTO public.canonical_automation_delivery_evidence_resolutions_v1(
  organization_id,delivery_evidence_resolution_id,transaction_id,unit_id,run_id,content_preview_id,content_preview_digest,
  channel_resolution_id,channel_resolution_digest,link_attachment_resolution_id,link_attachment_resolution_digest,
  sender_recipient_resolution_id,permission_resolution_id,requested_profile_id,provider_attempt_state,provider_acknowledgement_state,
  callback_state,delivery_state,open_state,reply_state,question_state,opt_out_state,complaint_state,undeliverable_state,
  correction_state,strongest_claim,reconciliation_state,suppression_propagation_state,result_state,actor_user_id,auth_session_id,
  membership_id,actor_role,request_digest,material_digest,delivery_evidence_resolution_digest,canonical_text,evaluated_at,recorded_at)
 VALUES(org,resolution_value,transaction_value,unit_value,unit_row.run_id,preview_value,preview_row.content_preview_digest,
  channel_value,channel_row.channel_resolution_digest,link_value,link_row.link_attachment_resolution_digest,
  sender_value,permission_value,'current_launch_no_provider_or_recipient_evidence','not_created','unavailable_no_attempt',
  'not_received_no_callback_authority','unavailable_no_message_or_evidence','unavailable_not_supported',
  'unavailable_no_authenticated_inbound','unavailable_no_authenticated_inbound','unavailable_no_authenticated_inbound',
  'unavailable_no_authenticated_provider_evidence','unavailable_no_provider_evidence','not_created','none',
  'no_provider_evidence_to_reconcile','no_new_suppression_evidence','unavailable_no_effect_evidence',
  actor_value,session_value,membership_value,'owner',request_digest_value,material_digest_value,resolution_digest_value,
  canonical_text_value,evaluated_value,recorded_value);
 RETURN jsonb_build_object('deliveryEvidenceResolutionId',resolution_value,'resultState','unavailable_no_effect_evidence',
  'deliveryEvidenceResolutionDigest',resolution_digest_value,'replayed',FALSE,'providerEventIngested',FALSE,
  'callbackAccepted',FALSE,'receiptPersisted',FALSE,'openPersisted',FALSE,'replyPersisted',FALSE,
  'questionPersisted',FALSE,'optOutPersisted',FALSE,'complaintPersisted',FALSE,'correctionPersisted',FALSE,
  'suppressionCreated',FALSE,'messageSent',FALSE,'delivered',FALSE,'effectCreated',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_delivery_evidence_resolutions_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_delivery_evidence_resolution_v1(TEXT,JSONB) FROM PUBLIC;

COMMENT ON FUNCTION public.canonical_automation_record_delivery_evidence_resolution_v1(TEXT,JSONB) IS
 'Owner-only Part 7F provider-neutral no-evidence disposition. No provider event, callback, receipt, open, reply, question, opt-out, complaint, correction, suppression mutation, recipient message, delivery or external effect authority.';
