-- Mission 28 Part 7D: provider-neutral channel capability and truthful
-- no-effect delivery/native-handoff disposition. No route, provider adapter,
-- callback, operating-system handoff, recipient message or effect is mounted.

CREATE TABLE public.canonical_automation_channel_resolutions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 channel_resolution_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 run_id UUID NOT NULL,
 content_preview_id UUID NOT NULL,
 content_preview_digest TEXT NOT NULL CHECK(content_preview_digest~'^sha256:[0-9a-f]{64}$'),
 sender_recipient_resolution_id UUID NOT NULL,
 permission_resolution_id UUID NOT NULL,
 requested_channel_id TEXT NOT NULL CHECK(requested_channel_id IN('in_app_passive','native_manual_handoff','email','sms')),
 transport_class TEXT NOT NULL CHECK(transport_class IN('none_internal','native_os_handoff','provider_neutral_email','provider_neutral_sms')),
 capability_state TEXT NOT NULL CHECK(capability_state IN('available_internal_no_effect','manual_excluded_current_launch','external_unavailable')),
 result_state TEXT NOT NULL CHECK(result_state IN('ready_internal_no_effect','unavailable_manual_handoff_not_opened','unavailable_external_channel')),
 provider_mode TEXT NOT NULL CHECK(provider_mode='provider_disabled'),
 provider_request_identity_state TEXT NOT NULL CHECK(provider_request_identity_state='not_created'),
 fallback_state TEXT NOT NULL CHECK(fallback_state='none'),
 cost_state TEXT NOT NULL CHECK(cost_state IN('zero_no_provider','unknown_unavailable')),
 recipient_prefill_state TEXT NOT NULL CHECK(recipient_prefill_state IN('not_applicable_internal_identity_only','forbidden_current_launch')),
 attachment_state TEXT NOT NULL CHECK(attachment_state IN('none','forbidden_current_launch')),
 handoff_state TEXT NOT NULL CHECK(handoff_state IN('not_applicable','not_opened')),
 attempt_state TEXT NOT NULL CHECK(attempt_state='not_created'),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role='owner'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 channel_resolution_digest TEXT NOT NULL CHECK(channel_resolution_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 16384),
 evaluated_at TIMESTAMPTZ(6) NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,channel_resolution_id),
 UNIQUE(organization_id,content_preview_id,requested_channel_id),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,material_digest),
 CHECK(
  (requested_channel_id='in_app_passive' AND transport_class='none_internal' AND capability_state='available_internal_no_effect' AND
   result_state='ready_internal_no_effect' AND cost_state='zero_no_provider' AND recipient_prefill_state='not_applicable_internal_identity_only' AND
   attachment_state='none' AND handoff_state='not_applicable') OR
  (requested_channel_id='native_manual_handoff' AND transport_class='native_os_handoff' AND capability_state='manual_excluded_current_launch' AND
   result_state='unavailable_manual_handoff_not_opened' AND cost_state='unknown_unavailable' AND recipient_prefill_state='forbidden_current_launch' AND
   attachment_state='forbidden_current_launch' AND handoff_state='not_opened') OR
  (requested_channel_id='email' AND transport_class='provider_neutral_email' AND capability_state='external_unavailable' AND
   result_state='unavailable_external_channel' AND cost_state='unknown_unavailable' AND recipient_prefill_state='forbidden_current_launch' AND
   attachment_state='forbidden_current_launch' AND handoff_state='not_applicable') OR
  (requested_channel_id='sms' AND transport_class='provider_neutral_sms' AND capability_state='external_unavailable' AND
   result_state='unavailable_external_channel' AND cost_state='unknown_unavailable' AND recipient_prefill_state='forbidden_current_launch' AND
   attachment_state='forbidden_current_launch' AND handoff_state='not_applicable')),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,content_preview_id)
  REFERENCES public.canonical_automation_content_previews_v1(organization_id,content_preview_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,sender_recipient_resolution_id)
  REFERENCES public.canonical_automation_sender_recipient_resolutions_v1(organization_id,resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,permission_resolution_id)
  REFERENCES public.canonical_automation_communication_permission_resolutions_v1(organization_id,permission_resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TRIGGER canonical_automation_channel_resolutions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_channel_resolutions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_channel_resolutions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_channel_resolutions_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_channel_resolutions_v1_tenant_owner_only
 ON public.canonical_automation_channel_resolutions_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_channel_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_channel_resolutions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_record_channel_resolution_v1(
 canonical_text_value TEXT,trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE
 doc JSONB;expected_trusted JSONB;org UUID;resolution_value UUID;transaction_value UUID;unit_value UUID;
 preview_value UUID;sender_value UUID;permission_value UUID;actor_value UUID;session_value UUID;membership_value UUID;
 evaluated_value TIMESTAMPTZ(6);recorded_value TIMESTAMPTZ(6);actor_role TEXT;requested_channel TEXT;
 preview_row public.canonical_automation_content_previews_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 sender_row public.canonical_automation_sender_recipient_resolutions_v1%ROWTYPE;
 recipient_row public.canonical_automation_recipient_authority_items_v1%ROWTYPE;
 permission_resolution public.canonical_automation_communication_permission_resolutions_v1%ROWTYPE;
 permission_item public.canonical_automation_permission_resolution_items_v1%ROWTYPE;
 permission_version public.canonical_automation_communication_permission_versions_v1%ROWTYPE;
 permission_subject public.canonical_automation_communication_permission_subjects_v1%ROWTYPE;
 stored public.canonical_automation_channel_resolutions_v1%ROWTYPE;
 transport_value TEXT;capability_value TEXT;result_value TEXT;cost_value TEXT;prefill_value TEXT;attachment_value TEXT;handoff_value TEXT;
 request_digest_value TEXT;material_digest_value TEXT;resolution_digest_value TEXT;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 16384 THEN
  RAISE EXCEPTION 'Mission 28 channel resolution bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY[
    'schemaVersion','tenantId','channelResolutionId','transactionId','unitId','contentPreviewId',
    'senderRecipientResolutionId','permissionResolutionId','requestedChannelId','actorBinding','evaluatedAt','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.channel-resolution.v1' OR
    COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'channelResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'unitId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'contentPreviewId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'senderRecipientResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'permissionResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'requestedChannelId','') NOT IN('in_app_passive','native_manual_handoff','email','sms') OR
    COALESCE(doc->>'evaluatedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc#>>'{actorBinding,membershipRole}' IS DISTINCT FROM 'owner' THEN
  RAISE EXCEPTION 'Mission 28 channel resolution shape invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid;resolution_value:=(doc->>'channelResolutionId')::uuid;transaction_value:=(doc->>'transactionId')::uuid;
 unit_value:=(doc->>'unitId')::uuid;preview_value:=(doc->>'contentPreviewId')::uuid;sender_value:=(doc->>'senderRecipientResolutionId')::uuid;
 permission_value:=(doc->>'permissionResolutionId')::uuid;actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;
 session_value:=(doc#>>'{actorBinding,sessionId}')::uuid;membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;
 evaluated_value:=(doc->>'evaluatedAt')::timestamptz;requested_channel:=doc->>'requestedChannelId';
 request_digest_value:=public.canonical_automation_digest_v1('mission28.channel-resolution.v1'||chr(10),doc-'requestDigest');
 expected_trusted:=jsonb_build_object('tenantId',doc->'tenantId','transactionId',doc->'transactionId','unitId',doc->'unitId',
  'contentPreviewId',doc->'contentPreviewId','senderRecipientResolutionId',doc->'senderRecipientResolutionId',
  'permissionResolutionId',doc->'permissionResolutionId','requestedChannelId',doc->'requestedChannelId',
  'actorBinding',doc->'actorBinding','evaluatedAt',doc->'evaluatedAt');
 material_digest_value:=public.canonical_automation_digest_v1('mission28.channel-resolution-material.v1'||chr(10),expected_trusted);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR trusted_resolution IS DISTINCT FROM expected_trusted THEN
  RAISE EXCEPTION 'Mission 28 channel resolution digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-channel-resolution:'||resolution_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_channel_resolutions_v1
  WHERE organization_id=org AND channel_resolution_id=resolution_value;
 IF stored.channel_resolution_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 channel resolution replay conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('channelResolutionId',stored.channel_resolution_id,'resultState',stored.result_state,
   'channelResolutionDigest',stored.channel_resolution_digest,'replayed',TRUE,'handoffOpened',FALSE,
   'providerRequestCreated',FALSE,'attemptCreated',FALSE,'messageSent',FALSE,'delivered',FALSE,'effectCreated',FALSE);
 END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF evaluated_value>recorded_value OR evaluated_value<recorded_value-INTERVAL '30 seconds' THEN
  RAISE EXCEPTION 'Mission 28 channel resolution time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.organization_id=org AND session.id=session_value AND session.user_id=actor_value AND session.membership_id=membership_value
  AND session.status='active' AND session.revoked_at IS NULL AND session.access_expires_at>recorded_value
  AND membership.status='active' AND membership.revoked_at IS NULL AND membership.role='owner' AND account.status='active'
 FOR SHARE OF session,membership,account;
 IF actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Mission 28 channel resolution actor unavailable' USING ERRCODE='42501'; END IF;

 SELECT * INTO permission_resolution FROM public.canonical_automation_communication_permission_resolutions_v1
  WHERE organization_id=org AND permission_resolution_id=permission_value FOR SHARE;
 SELECT * INTO permission_item FROM public.canonical_automation_permission_resolution_items_v1
  WHERE organization_id=org AND permission_resolution_id=permission_value AND recipient_index=0 FOR SHARE;
 IF permission_resolution.permission_resolution_id IS NULL OR permission_item.permission_resolution_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 channel permission resolution unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-communication-permission:'||permission_item.permission_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-sender-recipient-unit:'||unit_value::text,0));

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
 IF preview_row.content_preview_id IS NULL OR unit_row.unit_id IS NULL OR sender_row.resolution_id IS NULL OR
    recipient_row.resolution_id IS NULL OR permission_version.permission_id IS NULL OR permission_subject.permission_id IS NULL OR
    preview_row.transaction_id IS DISTINCT FROM transaction_value OR preview_row.unit_id IS DISTINCT FROM unit_value OR
    preview_row.sender_recipient_resolution_id IS DISTINCT FROM sender_value OR preview_row.permission_resolution_id IS DISTINCT FROM permission_value OR
    permission_resolution.transaction_id IS DISTINCT FROM transaction_value OR permission_resolution.unit_id IS DISTINCT FROM unit_value OR
    permission_resolution.sender_recipient_resolution_id IS DISTINCT FROM sender_value OR
    permission_resolution.result_state IS DISTINCT FROM 'clear_internal_passive_no_effect' OR sender_row.recipient_count IS DISTINCT FROM 1 OR
    unit_row.recipient_set_digest IS DISTINCT FROM sender_row.recipient_set_digest OR unit_row.channel_id IS DISTINCT FROM 'in_app_passive' OR
    unit_row.provider_mode IS DISTINCT FROM 'provider_disabled' OR unit_row.effect_class IS DISTINCT FROM 'internal_record_only' OR
    preview_row.link_selection_count IS DISTINCT FROM 0 OR preview_row.attachment_selection_count IS DISTINCT FROM 0 OR
    permission_subject.channel_id IS DISTINCT FROM 'in_app_passive' OR permission_subject.recipient_class IS DISTINCT FROM recipient_row.recipient_class OR
    permission_subject.recipient_record_id IS DISTINCT FROM recipient_row.recipient_record_id OR
    permission_subject.contact_identity_digest IS DISTINCT FROM recipient_row.contact_identity_digest OR
    permission_version.suppression_state IS DISTINCT FROM 'clear_internal_passive' OR
    permission_version.version IS DISTINCT FROM (SELECT max(latest.version) FROM public.canonical_automation_communication_permission_versions_v1 latest
      WHERE latest.organization_id=org AND latest.permission_id=permission_version.permission_id) OR
    public.canonical_automation_part7b_recipient_current_v1(org,sender_value,0) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 exact current no-effect channel authority unavailable' USING ERRCODE='42501'; END IF;

 CASE requested_channel
  WHEN 'in_app_passive' THEN
   transport_value:='none_internal';capability_value:='available_internal_no_effect';result_value:='ready_internal_no_effect';
   cost_value:='zero_no_provider';prefill_value:='not_applicable_internal_identity_only';attachment_value:='none';handoff_value:='not_applicable';
  WHEN 'native_manual_handoff' THEN
   transport_value:='native_os_handoff';capability_value:='manual_excluded_current_launch';result_value:='unavailable_manual_handoff_not_opened';
   cost_value:='unknown_unavailable';prefill_value:='forbidden_current_launch';attachment_value:='forbidden_current_launch';handoff_value:='not_opened';
  WHEN 'email' THEN
   transport_value:='provider_neutral_email';capability_value:='external_unavailable';result_value:='unavailable_external_channel';
   cost_value:='unknown_unavailable';prefill_value:='forbidden_current_launch';attachment_value:='forbidden_current_launch';handoff_value:='not_applicable';
  WHEN 'sms' THEN
   transport_value:='provider_neutral_sms';capability_value:='external_unavailable';result_value:='unavailable_external_channel';
   cost_value:='unknown_unavailable';prefill_value:='forbidden_current_launch';attachment_value:='forbidden_current_launch';handoff_value:='not_applicable';
  ELSE RAISE EXCEPTION 'Mission 28 channel unavailable' USING ERRCODE='42501';
 END CASE;
 resolution_digest_value:=public.canonical_automation_digest_v1('mission28.channel-resolution-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org,'channelResolutionId',resolution_value,'transactionId',transaction_value,'unitId',unit_value,'runId',unit_row.run_id,
  'contentPreviewId',preview_value,'contentPreviewDigest',preview_row.content_preview_digest,'senderRecipientResolutionId',sender_value,
  'permissionResolutionId',permission_value,'requestedChannelId',requested_channel,'transportClass',transport_value,
  'capabilityState',capability_value,'resultState',result_value,'providerMode','provider_disabled','providerRequestIdentityState','not_created',
  'fallbackState','none','costState',cost_value,'recipientPrefillState',prefill_value,'attachmentState',attachment_value,
  'handoffState',handoff_value,'attemptState','not_created','evaluatedAt',doc->>'evaluatedAt'));
 INSERT INTO public.canonical_automation_channel_resolutions_v1 VALUES(
  org,resolution_value,transaction_value,unit_value,unit_row.run_id,preview_value,preview_row.content_preview_digest,sender_value,permission_value,
  requested_channel,transport_value,capability_value,result_value,'provider_disabled','not_created','none',cost_value,prefill_value,
  attachment_value,handoff_value,'not_created',actor_value,session_value,membership_value,'owner',request_digest_value,material_digest_value,
  resolution_digest_value,canonical_text_value,evaluated_value,recorded_value);
 RETURN jsonb_build_object('channelResolutionId',resolution_value,'resultState',result_value,'channelResolutionDigest',resolution_digest_value,
  'replayed',FALSE,'handoffOpened',FALSE,'providerRequestCreated',FALSE,'attemptCreated',FALSE,'messageSent',FALSE,'delivered',FALSE,'effectCreated',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_channel_resolutions_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_channel_resolution_v1(TEXT,JSONB) FROM PUBLIC;

COMMENT ON FUNCTION public.canonical_automation_record_channel_resolution_v1(TEXT,JSONB) IS
 'Owner-only Part 7D provider-neutral channel disposition. No provider request, handoff open, attempt, send, delivery, reply, upstream, accounting, money, legal or outcome authority.';
