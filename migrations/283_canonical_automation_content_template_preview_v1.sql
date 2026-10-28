-- Mission 28 Part 7C: exact approved static content catalog and owner-readable
-- no-effect preview evidence. No route, provider, message, link, attachment or
-- effect consumer is mounted by this migration.

CREATE TABLE public.canonical_automation_content_previews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 content_preview_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 run_id UUID NOT NULL,
 sender_recipient_resolution_id UUID NOT NULL,
 permission_resolution_id UUID NOT NULL,
 content_template_id TEXT NOT NULL CHECK(content_template_id IN(
  'internal_fact_digest_content_v1','owner_approval_request_content_v1','reviewed_collection_work_item_content_v1')),
 content_template_version BIGINT NOT NULL CHECK(content_template_version=1),
 content_template_digest TEXT NOT NULL CHECK(content_template_digest~'^sha256:[0-9a-f]{64}$'),
 action_template_id TEXT NOT NULL CHECK(action_template_id IN(
  'internal_fact_digest_v1','owner_approval_request_v1','reviewed_collection_work_item_v1')),
 action_template_digest TEXT NOT NULL CHECK(action_template_digest~'^sha256:[0-9a-f]{64}$'),
 action_family_id TEXT NOT NULL CHECK(action_family_id IN(
  'internal_read_digest_task','owner_approval_request','collection_escalation')),
 locale_id TEXT NOT NULL CHECK(locale_id='en-US'),
 language_id TEXT NOT NULL CHECK(language_id='en'),
 content_format TEXT NOT NULL CHECK(content_format='plain_text'),
 wording_origin TEXT NOT NULL CHECK(wording_origin='approved_static_catalog'),
 customer_safe_rule TEXT NOT NULL CHECK(customer_safe_rule='closed_catalog_no_free_text_internal_no_effect'),
 variable_name TEXT NOT NULL CHECK(variable_name='actionLabel'),
 variable_value_id TEXT NOT NULL CHECK(variable_value_id IN(
  'current_source_evidence','owner_approval_request','reviewed_collection_work_item')),
 variable_value_digest TEXT NOT NULL CHECK(variable_value_digest~'^sha256:[0-9a-f]{64}$'),
 variable_set_digest TEXT NOT NULL CHECK(variable_set_digest~'^sha256:[0-9a-f]{64}$'),
 title_text TEXT NOT NULL CHECK(octet_length(title_text) BETWEEN 1 AND 96),
 body_text TEXT NOT NULL CHECK(octet_length(body_text) BETWEEN 1 AND 256),
 link_selection_count INTEGER NOT NULL CHECK(link_selection_count=0),
 attachment_selection_count INTEGER NOT NULL CHECK(attachment_selection_count=0),
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role='owner'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 content_preview_digest TEXT NOT NULL CHECK(content_preview_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 previewed_at TIMESTAMPTZ(6) NOT NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,content_preview_id),
 UNIQUE(organization_id,unit_id),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,material_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,sender_recipient_resolution_id)
  REFERENCES public.canonical_automation_sender_recipient_resolutions_v1(organization_id,resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,permission_resolution_id)
  REFERENCES public.canonical_automation_communication_permission_resolutions_v1(organization_id,permission_resolution_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TRIGGER canonical_automation_content_previews_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_content_previews_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_content_previews_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_content_previews_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_content_previews_v1_tenant_owner_only
 ON public.canonical_automation_content_previews_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_content_previews_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.canonical_automation_content_previews_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_record_content_preview_v1(
 canonical_text_value TEXT,trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE
 doc JSONB;binding JSONB;variable_binding JSONB;expected_trusted JSONB;template_definition JSONB;
 org UUID;preview_value UUID;transaction_value UUID;unit_value UUID;sender_value UUID;permission_value UUID;
 actor_value UUID;session_value UUID;membership_value UUID;previewed_value TIMESTAMPTZ(6);recorded_value TIMESTAMPTZ(6);actor_role TEXT;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 sender_row public.canonical_automation_sender_recipient_resolutions_v1%ROWTYPE;
 recipient_row public.canonical_automation_recipient_authority_items_v1%ROWTYPE;
 permission_resolution public.canonical_automation_communication_permission_resolutions_v1%ROWTYPE;
 permission_item public.canonical_automation_permission_resolution_items_v1%ROWTYPE;
 permission_version public.canonical_automation_communication_permission_versions_v1%ROWTYPE;
 stored public.canonical_automation_content_previews_v1%ROWTYPE;
 expected_content_template TEXT;expected_action_template_digest TEXT;expected_family TEXT;expected_value_id TEXT;
 expected_template_digest TEXT;expected_variable_digest TEXT;variable_set_digest_value TEXT;
 title_value TEXT;body_value TEXT;request_digest_value TEXT;material_digest_value TEXT;preview_digest_value TEXT;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN
  RAISE EXCEPTION 'Mission 28 content preview bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY[
    'schemaVersion','tenantId','contentPreviewId','transactionId','unitId','senderRecipientResolutionId',
    'permissionResolutionId','templateBinding','variableBindings','localeId','languageId','linkSelections',
    'attachmentSelections','actorBinding','previewedAt','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.content-preview.v1' OR
    COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'contentPreviewId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'unitId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'senderRecipientResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'permissionResolutionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc->>'localeId' IS DISTINCT FROM 'en-US' OR doc->>'languageId' IS DISTINCT FROM 'en' OR
    jsonb_typeof(doc->'variableBindings') IS DISTINCT FROM 'array' OR jsonb_array_length(doc->'variableBindings') IS DISTINCT FROM 1 OR
    jsonb_typeof(doc->'linkSelections') IS DISTINCT FROM 'array' OR jsonb_array_length(doc->'linkSelections') IS DISTINCT FROM 0 OR
    jsonb_typeof(doc->'attachmentSelections') IS DISTINCT FROM 'array' OR jsonb_array_length(doc->'attachmentSelections') IS DISTINCT FROM 0 OR
    COALESCE(doc->>'previewedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 content preview shape invalid' USING ERRCODE='22023'; END IF;
 binding:=doc->'templateBinding';variable_binding:=doc->'variableBindings'->0;
 IF public.canonical_automation_part4b_keys_exact_v1(binding,ARRAY[
    'contentTemplateId','contentTemplateVersion','contentTemplateDigest','actionTemplateId','actionTemplateDigest',
    'actionFamilyId','contentFormat','wordingOrigin','customerSafeRule']) IS DISTINCT FROM TRUE OR
    COALESCE(binding->>'contentTemplateId','') NOT IN('internal_fact_digest_content_v1','owner_approval_request_content_v1','reviewed_collection_work_item_content_v1') OR
    jsonb_typeof(binding->'contentTemplateVersion') IS DISTINCT FROM 'number' OR
    binding->'contentTemplateVersion' IS DISTINCT FROM '1'::jsonb OR COALESCE(binding->>'contentTemplateDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(binding->>'actionTemplateId','') NOT IN('internal_fact_digest_v1','owner_approval_request_v1','reviewed_collection_work_item_v1') OR
    COALESCE(binding->>'actionTemplateDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(binding->>'actionFamilyId','') NOT IN('internal_read_digest_task','owner_approval_request','collection_escalation') OR
    binding->>'contentFormat' IS DISTINCT FROM 'plain_text' OR binding->>'wordingOrigin' IS DISTINCT FROM 'approved_static_catalog' OR
    binding->>'customerSafeRule' IS DISTINCT FROM 'closed_catalog_no_free_text_internal_no_effect' OR
    public.canonical_automation_part4b_keys_exact_v1(variable_binding,ARRAY['name','valueId','valueDigest']) IS DISTINCT FROM TRUE OR
    variable_binding->>'name' IS DISTINCT FROM 'actionLabel' OR
    COALESCE(variable_binding->>'valueId','') NOT IN('current_source_evidence','owner_approval_request','reviewed_collection_work_item') OR
    COALESCE(variable_binding->>'valueDigest','')!~'^sha256:[0-9a-f]{64}$' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole']) IS DISTINCT FROM TRUE OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    doc#>>'{actorBinding,membershipRole}' IS DISTINCT FROM 'owner' THEN
  RAISE EXCEPTION 'Mission 28 content template variable or actor binding invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid;preview_value:=(doc->>'contentPreviewId')::uuid;transaction_value:=(doc->>'transactionId')::uuid;
 unit_value:=(doc->>'unitId')::uuid;sender_value:=(doc->>'senderRecipientResolutionId')::uuid;permission_value:=(doc->>'permissionResolutionId')::uuid;
 actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;session_value:=(doc#>>'{actorBinding,sessionId}')::uuid;membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;
 previewed_value:=(doc->>'previewedAt')::timestamptz;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.content-preview.v1'||chr(10),doc-'requestDigest');
 expected_trusted:=jsonb_build_object('tenantId',doc->'tenantId','transactionId',doc->'transactionId','unitId',doc->'unitId',
  'senderRecipientResolutionId',doc->'senderRecipientResolutionId','permissionResolutionId',doc->'permissionResolutionId',
  'templateBinding',doc->'templateBinding','variableBindings',doc->'variableBindings','localeId',doc->'localeId','languageId',doc->'languageId',
  'linkSelections',doc->'linkSelections','attachmentSelections',doc->'attachmentSelections','actorBinding',doc->'actorBinding','previewedAt',doc->'previewedAt');
 material_digest_value:=public.canonical_automation_digest_v1('mission28.content-preview-material.v1'||chr(10),expected_trusted);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR trusted_resolution IS DISTINCT FROM expected_trusted THEN
  RAISE EXCEPTION 'Mission 28 content preview digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-content-preview:'||preview_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_content_previews_v1 WHERE organization_id=org AND content_preview_id=preview_value;
 IF stored.content_preview_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 content preview replay conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('contentPreviewId',stored.content_preview_id,'contentPreviewDigest',stored.content_preview_digest,
   'titleText',stored.title_text,'bodyText',stored.body_text,'replayed',TRUE,'messageCreated',FALSE,'effectCreated',FALSE);
 END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF previewed_value>recorded_value OR previewed_value<recorded_value-INTERVAL '30 seconds' THEN
  RAISE EXCEPTION 'Mission 28 content preview time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.organization_id=org AND session.id=session_value AND session.user_id=actor_value AND session.membership_id=membership_value
  AND session.status='active' AND session.revoked_at IS NULL AND session.access_expires_at>recorded_value
  AND membership.status='active' AND membership.revoked_at IS NULL AND membership.role='owner' AND account.status='active'
 FOR SHARE OF session,membership,account;
 IF actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Mission 28 content preview actor unavailable' USING ERRCODE='42501'; END IF;

 SELECT * INTO permission_resolution FROM public.canonical_automation_communication_permission_resolutions_v1
  WHERE organization_id=org AND permission_resolution_id=permission_value FOR SHARE;
 SELECT * INTO permission_item FROM public.canonical_automation_permission_resolution_items_v1
  WHERE organization_id=org AND permission_resolution_id=permission_value AND recipient_index=0 FOR SHARE;
 IF permission_resolution.permission_resolution_id IS NULL OR permission_item.permission_resolution_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 content permission resolution unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-communication-permission:'||permission_item.permission_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-sender-recipient-unit:'||unit_value::text,0));

 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=org AND unit_id=unit_value AND transaction_id=transaction_value FOR SHARE;
 SELECT * INTO sender_row FROM public.canonical_automation_sender_recipient_resolutions_v1
  WHERE organization_id=org AND resolution_id=sender_value AND unit_id=unit_value AND transaction_id=transaction_value FOR SHARE;
 SELECT * INTO recipient_row FROM public.canonical_automation_recipient_authority_items_v1
  WHERE organization_id=org AND resolution_id=sender_value AND recipient_index=0 FOR SHARE;
 SELECT * INTO permission_version FROM public.canonical_automation_communication_permission_versions_v1
  WHERE organization_id=org AND permission_id=permission_item.permission_id AND version=permission_item.permission_version
   AND permission_digest=permission_item.permission_digest FOR SHARE;
 IF unit_row.unit_id IS NULL OR sender_row.resolution_id IS NULL OR recipient_row.resolution_id IS NULL OR permission_version.permission_id IS NULL OR
    permission_resolution.transaction_id IS DISTINCT FROM transaction_value OR permission_resolution.unit_id IS DISTINCT FROM unit_value OR
    permission_resolution.sender_recipient_resolution_id IS DISTINCT FROM sender_value OR permission_resolution.result_state IS DISTINCT FROM 'clear_internal_passive_no_effect' OR
    sender_row.recipient_count IS DISTINCT FROM 1 OR unit_row.recipient_set_digest IS DISTINCT FROM sender_row.recipient_set_digest OR
    unit_row.channel_id IS DISTINCT FROM 'in_app_passive' OR unit_row.provider_mode IS DISTINCT FROM 'provider_disabled' OR unit_row.effect_class IS DISTINCT FROM 'internal_record_only' OR
    permission_version.version IS DISTINCT FROM (SELECT max(latest.version) FROM public.canonical_automation_communication_permission_versions_v1 latest
      WHERE latest.organization_id=org AND latest.permission_id=permission_version.permission_id) OR
    public.canonical_automation_part7b_recipient_current_v1(org,sender_value,0) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 exact current no-effect content authority unavailable' USING ERRCODE='42501'; END IF;

 CASE unit_row.action_template_id
  WHEN 'internal_fact_digest_v1' THEN
   expected_content_template:='internal_fact_digest_content_v1';expected_action_template_digest:='sha256:e937f4b70e4129230e844e20b073b2fef80d0f456bd8868069ae83fde5c352c1';expected_family:='internal_read_digest_task';expected_value_id:='current_source_evidence';
  WHEN 'owner_approval_request_v1' THEN
   expected_content_template:='owner_approval_request_content_v1';expected_action_template_digest:='sha256:595425c52a9e09476539524f36de8c93def2152c4143d13638054c695d345e7f';expected_family:='owner_approval_request';expected_value_id:='owner_approval_request';
  WHEN 'reviewed_collection_work_item_v1' THEN
   expected_content_template:='reviewed_collection_work_item_content_v1';expected_action_template_digest:='sha256:1256045656b32a8f5edbb57fa8f135b7ea82f2db8b179f4ac982beed5481a2f5';expected_family:='collection_escalation';expected_value_id:='reviewed_collection_work_item';
  ELSE RAISE EXCEPTION 'Mission 28 content action template unavailable' USING ERRCODE='42501';
 END CASE;
 template_definition:=jsonb_build_object(
  'contentTemplateId',expected_content_template,'contentTemplateVersion',1,'actionTemplateId',unit_row.action_template_id,
  'actionTemplateDigest',expected_action_template_digest,'actionFamilyId',expected_family,'localeId','en-US','languageId','en',
  'contentFormat','plain_text','wordingOrigin','approved_static_catalog',
  'variableSchema',jsonb_build_array(jsonb_build_object('name','actionLabel','type','closed_catalog_value','allowedValueId',expected_value_id)),
  'titlePattern','Review {{actionLabel}}','bodyPattern','Open the tenant-private {{actionLabel}}. This preview creates no external effect.',
  'linkSelectionPolicy','none_current_launch','attachmentSelectionPolicy','none_current_launch',
  'customerSafeRule','closed_catalog_no_free_text_internal_no_effect');
 expected_template_digest:=public.canonical_automation_digest_v1('mission28.content-template.v1'||chr(10),template_definition);
 expected_variable_digest:=public.canonical_automation_digest_v1('mission28.content-variable.v1'||chr(10),jsonb_build_object('name','actionLabel','valueId',expected_value_id));
 IF unit_row.action_template_digest IS DISTINCT FROM expected_action_template_digest OR unit_row.action_family_id IS DISTINCT FROM expected_family OR
    binding->>'contentTemplateId' IS DISTINCT FROM expected_content_template OR binding->>'contentTemplateDigest' IS DISTINCT FROM expected_template_digest OR
    binding->>'actionTemplateId' IS DISTINCT FROM unit_row.action_template_id OR binding->>'actionTemplateDigest' IS DISTINCT FROM unit_row.action_template_digest OR
    binding->>'actionFamilyId' IS DISTINCT FROM unit_row.action_family_id OR variable_binding->>'valueId' IS DISTINCT FROM expected_value_id OR
    variable_binding->>'valueDigest' IS DISTINCT FROM expected_variable_digest THEN
  RAISE EXCEPTION 'Mission 28 approved content catalog binding unavailable' USING ERRCODE='42501'; END IF;

 variable_set_digest_value:=public.canonical_automation_digest_v1('mission28.content-variable-set.v1'||chr(10),doc->'variableBindings');
 title_value:=replace('Review {{actionLabel}}','{{actionLabel}}',replace(expected_value_id,'_',' '));
 body_value:=replace('Open the tenant-private {{actionLabel}}. This preview creates no external effect.','{{actionLabel}}',replace(expected_value_id,'_',' '));
 preview_digest_value:=public.canonical_automation_digest_v1('mission28.content-preview-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org,'contentPreviewId',preview_value,'transactionId',transaction_value,'unitId',unit_value,'runId',unit_row.run_id,
  'senderRecipientResolutionId',sender_value,'permissionResolutionId',permission_value,'contentTemplateId',expected_content_template,
  'contentTemplateVersion',1,'contentTemplateDigest',expected_template_digest,'actionTemplateId',unit_row.action_template_id,
  'actionTemplateDigest',unit_row.action_template_digest,'actionFamilyId',unit_row.action_family_id,'localeId','en-US','languageId','en',
  'variableSetDigest',variable_set_digest_value,'titleText',title_value,'bodyText',body_value,'linkSelections','[]'::jsonb,
  'attachmentSelections','[]'::jsonb,'previewedAt',doc->>'previewedAt'));
 INSERT INTO public.canonical_automation_content_previews_v1 VALUES(
  org,preview_value,transaction_value,unit_value,unit_row.run_id,sender_value,permission_value,expected_content_template,1,
  expected_template_digest,unit_row.action_template_id,unit_row.action_template_digest,unit_row.action_family_id,'en-US','en','plain_text',
  'approved_static_catalog','closed_catalog_no_free_text_internal_no_effect','actionLabel',expected_value_id,expected_variable_digest,
  variable_set_digest_value,title_value,body_value,0,0,actor_value,session_value,membership_value,'owner',request_digest_value,
  material_digest_value,preview_digest_value,canonical_text_value,previewed_value,recorded_value);
 RETURN jsonb_build_object('contentPreviewId',preview_value,'contentPreviewDigest',preview_digest_value,'titleText',title_value,
  'bodyText',body_value,'replayed',FALSE,'messageCreated',FALSE,'effectCreated',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_content_previews_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_content_preview_v1(TEXT,JSONB) FROM PUBLIC;

COMMENT ON FUNCTION public.canonical_automation_record_content_preview_v1(TEXT,JSONB) IS
 'Owner-only Part 7C approved static content and no-effect preview evidence. No provider, recipient, message, link, attachment, delivery, reply, upstream, accounting, money, legal or outcome authority.';
