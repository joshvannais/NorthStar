-- Mission 28 Part 6A: an owner-only, tenant-private atomic transaction from
-- one separately trusted accepted-current decision to bounded internal action
-- units and committed-unpublished outbox evidence.  This migration grants no
-- application execute privilege and mounts no publisher, scheduler or worker.

CREATE TABLE public.canonical_automation_action_transactions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 policy_id UUID NOT NULL,
 policy_version BIGINT NOT NULL CHECK(policy_version BETWEEN 1 AND 9007199254740991),
 policy_digest TEXT NOT NULL CHECK(policy_digest~'^sha256:[0-9a-f]{64}$'),
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 decision_digest TEXT NOT NULL CHECK(decision_digest~'^sha256:[0-9a-f]{64}$'),
 authorization_digest TEXT NOT NULL CHECK(authorization_digest~'^sha256:[0-9a-f]{64}$'),
 currentness_digest TEXT NOT NULL CHECK(currentness_digest~'^sha256:[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 unit_count INTEGER NOT NULL CHECK(unit_count BETWEEN 1 AND 32),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,transaction_id),
 UNIQUE(organization_id,request_digest),
 FOREIGN KEY(organization_id,policy_id,policy_version)
  REFERENCES public.canonical_automation_policy_versions_v1(organization_id,policy_id,version) ON DELETE RESTRICT,
 CHECK(retention_class='decision_history'),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'transactionId' IS NOT DISTINCT FROM transaction_id::text),
 CHECK(document->>'runId' IS NOT DISTINCT FROM run_id::text),
 CHECK(document#>>'{policyBinding,policyId}' IS NOT DISTINCT FROM policy_id::text),
 CHECK((document#>>'{policyBinding,policyVersion}')::bigint IS NOT DISTINCT FROM policy_version),
 CHECK(document#>>'{policyBinding,policyDigest}' IS NOT DISTINCT FROM policy_digest),
 CHECK(document#>>'{sourceBinding,sourceSetDigest}' IS NOT DISTINCT FROM source_set_digest),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest),
 CHECK(jsonb_array_length(document->'actionUnits') IS NOT DISTINCT FROM unit_count)
);

CREATE TABLE public.canonical_automation_action_units_v1 (
 organization_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_index INTEGER NOT NULL CHECK(unit_index BETWEEN 0 AND 31),
 action_family_id TEXT NOT NULL CHECK(action_family_id IN(
  'internal_read_digest_task','owner_approval_request','collection_escalation')),
 action_template_id TEXT NOT NULL CHECK(action_template_id IN(
  'internal_fact_digest_v1','owner_approval_request_v1','reviewed_collection_work_item_v1')),
 action_template_digest TEXT NOT NULL CHECK(action_template_digest~'^sha256:[0-9a-f]{64}$'),
 recipient_set_digest TEXT NOT NULL CHECK(recipient_set_digest~'^sha256:[0-9a-f]{64}$'),
 channel_id TEXT NOT NULL CHECK(channel_id='in_app_passive'),
 provider_mode TEXT NOT NULL CHECK(provider_mode='provider_disabled'),
 effect_class TEXT NOT NULL CHECK(effect_class='internal_record_only'),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 idempotency_key_digest TEXT NOT NULL CHECK(idempotency_key_digest~'^sha256:[0-9a-f]{64}$'),
 unit_digest TEXT NOT NULL CHECK(unit_digest~'^sha256:[0-9a-f]{64}$'),
 state TEXT NOT NULL CHECK(state='committed_unpublished'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,unit_id),
 UNIQUE(organization_id,transaction_id,unit_index),
 UNIQUE(organization_id,run_id,idempotency_key_digest),
 UNIQUE(organization_id,run_id,material_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_automation_action_outbox_v1 (
 organization_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 unit_digest TEXT NOT NULL CHECK(unit_digest~'^sha256:[0-9a-f]{64}$'),
 state TEXT NOT NULL CHECK(state='committed_unpublished'),
 queue_publication_id TEXT NULL,
 queue_published_at TIMESTAMPTZ(6) NULL,
 claim_id UUID NULL,
 lease_expires_at TIMESTAMPTZ(6) NULL,
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,outbox_id),
 UNIQUE(organization_id,unit_id),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 CHECK(queue_publication_id IS NULL AND queue_published_at IS NULL AND claim_id IS NULL AND lease_expires_at IS NULL)
);

CREATE INDEX canonical_automation_action_transactions_v1_run
 ON public.canonical_automation_action_transactions_v1(organization_id,run_id,recorded_at,transaction_id);
CREATE INDEX canonical_automation_action_units_v1_transaction
 ON public.canonical_automation_action_units_v1(organization_id,transaction_id,unit_index);
CREATE INDEX canonical_automation_action_outbox_v1_unpublished
 ON public.canonical_automation_action_outbox_v1(organization_id,recorded_at,outbox_id)
 WHERE state='committed_unpublished';

CREATE TRIGGER canonical_automation_action_transactions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_action_transactions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_action_units_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_action_units_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_action_outbox_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_action_outbox_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_action_transactions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_action_transactions_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_action_units_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_action_units_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_action_outbox_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_action_outbox_v1 FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_automation_action_transactions_v1_tenant_owner_only
 ON public.canonical_automation_action_transactions_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_transactions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_transactions_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_action_units_v1_tenant_owner_only
 ON public.canonical_automation_action_units_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_units_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_units_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_action_outbox_v1_tenant_owner_only
 ON public.canonical_automation_action_outbox_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_outbox_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_outbox_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_store_action_transaction_v1(
 canonical_text_value TEXT, trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 doc JSONB; org UUID; transaction_value UUID; run_value UUID; policy_value UUID; policy_version_value BIGINT;
 request_digest_value TEXT; decision_digest_value TEXT; authorization_digest_value TEXT; currentness_digest_value TEXT;
 recorded_value TIMESTAMPTZ(6); unit JSONB; unit_base JSONB; unit_digest_value TEXT; outbox_value UUID;
 item_index INTEGER:=0; stored public.canonical_automation_action_transactions_v1%ROWTYPE;
 snapshot_item RECORD; snapshot_id_value UUID; snapshot_digest_value TEXT; latest_snapshot_id UUID;
 latest_policy_state TEXT; expected_template TEXT; source_count INTEGER;
 trusted_expected JSONB;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 65536 THEN
  RAISE EXCEPTION 'Mission 28 action transaction bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','transactionId','runId',
  'policyBinding','sourceBinding','decisionBinding','authorizationBinding','currentnessBinding','actionUnits','requestDigest']) IS DISTINCT FROM TRUE OR
  doc->>'schemaVersion' IS DISTINCT FROM 'mission28.action-transaction.request.v1' OR
  COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'runId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' OR jsonb_typeof(doc->'actionUnits') IS DISTINCT FROM 'array' OR
  jsonb_array_length(doc->'actionUnits') NOT BETWEEN 1 AND 32 THEN
  RAISE EXCEPTION 'Mission 28 action transaction shape invalid' USING ERRCODE='22023'; END IF;
 IF public.canonical_automation_part4b_keys_exact_v1(doc->'policyBinding',ARRAY['tenantId','policyId','policyVersion','policyDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'sourceBinding',ARRAY['tenantId','sourceSetDigest','snapshotIds','snapshotDigests']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'decisionBinding',ARRAY['evaluationId','evaluationOutputDigest','previewId','previewDigest','analysisId','analysisOutputDigest','candidateId','collisionDecisionDigest','collisionResult','actionMaterialDigest','actionUnitSetDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'authorizationBinding',ARRAY['authorizationId','authorizationKind','authorizationRecordDigest','authorizationMaterialBindingDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'currentnessBinding',ARRAY['evaluationRevalidationId','evaluationRevalidationDigest','preEffectRevalidationId','preEffectRevalidationDigest','acceptedState']) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 action binding shape invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; transaction_value:=(doc->>'transactionId')::uuid; run_value:=(doc->>'runId')::uuid;
 IF doc#>>'{policyBinding,tenantId}' IS DISTINCT FROM org::text OR doc#>>'{sourceBinding,tenantId}' IS DISTINCT FROM org::text OR
    COALESCE(doc#>>'{policyBinding,policyId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{policyBinding,policyVersion}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{policyBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{sourceBinding,sourceSetDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    jsonb_typeof(doc#>'{sourceBinding,snapshotIds}') IS DISTINCT FROM 'array' OR
    jsonb_typeof(doc#>'{sourceBinding,snapshotDigests}') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Mission 28 policy or source binding invalid' USING ERRCODE='22023'; END IF;
 policy_value:=(doc#>>'{policyBinding,policyId}')::uuid; policy_version_value:=(doc#>>'{policyBinding,policyVersion}')::bigint;
 source_count:=jsonb_array_length(doc#>'{sourceBinding,snapshotIds}');
 IF source_count NOT BETWEEN 1 AND 8 OR jsonb_array_length(doc#>'{sourceBinding,snapshotDigests}') IS DISTINCT FROM source_count THEN
  RAISE EXCEPTION 'Mission 28 source snapshot bounds invalid' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(doc#>'{sourceBinding,snapshotIds}')) IS DISTINCT FROM source_count::bigint OR
    (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(doc#>'{sourceBinding,snapshotDigests}')) IS DISTINCT FROM source_count::bigint THEN
  RAISE EXCEPTION 'Mission 28 duplicate source snapshot identity invalid' USING ERRCODE='22023'; END IF;
 IF public.canonical_automation_digest_v1('mission28.action-source-set.v1'||chr(10),jsonb_build_object(
   'tenantId',doc#>>'{sourceBinding,tenantId}','snapshotIds',doc#>'{sourceBinding,snapshotIds}',
   'snapshotDigests',doc#>'{sourceBinding,snapshotDigests}')) IS DISTINCT FROM doc#>>'{sourceBinding,sourceSetDigest}' OR
    public.canonical_automation_digest_v1('mission28.action-unit-set.v1'||chr(10),doc->'actionUnits') IS DISTINCT FROM
      doc#>>'{decisionBinding,actionUnitSetDigest}' THEN
  RAISE EXCEPTION 'Mission 28 source or action-unit-set digest invalid' USING ERRCODE='22023'; END IF;
 IF doc#>>'{decisionBinding,collisionResult}' IS DISTINCT FROM 'selected_no_effect' OR
    doc#>>'{currentnessBinding,acceptedState}' IS DISTINCT FROM 'current_contract_only_no_effect_authority' OR
    COALESCE(doc#>>'{authorizationBinding,authorizationKind}','') NOT IN('per_run_approval','standing_authorization') THEN
  RAISE EXCEPTION 'Mission 28 accepted decision unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(doc->'decisionBinding') e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string') OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'authorizationBinding') e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string') OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'currentnessBinding') e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string') OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'decisionBinding') e WHERE e.key<>'collisionResult' AND e.value#>>'{}'!~'^(sha256:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$') OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'authorizationBinding') e WHERE e.key<>'authorizationKind' AND e.value#>>'{}'!~'^(sha256:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$') OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'currentnessBinding') e WHERE e.key<>'acceptedState' AND e.value#>>'{}'!~'^(sha256:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$') THEN
  RAISE EXCEPTION 'Mission 28 decision identity invalid' USING ERRCODE='22023'; END IF;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.action-transaction.request.v1'||chr(10),doc-'requestDigest');
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' THEN
  RAISE EXCEPTION 'Mission 28 action request digest invalid' USING ERRCODE='22023'; END IF;
 trusted_expected:=jsonb_build_object('tenantId',doc->>'tenantId','runId',doc->>'runId','policyBinding',doc->'policyBinding',
  'sourceBinding',doc->'sourceBinding','decisionBinding',doc->'decisionBinding','authorizationBinding',doc->'authorizationBinding',
  'currentnessBinding',doc->'currentnessBinding');
 IF public.canonical_automation_part4b_keys_exact_v1(trusted_resolution,ARRAY['tenantId','runId','policyBinding','sourceBinding','decisionBinding','authorizationBinding','currentnessBinding']) IS DISTINCT FROM TRUE OR
    trusted_resolution IS DISTINCT FROM trusted_expected THEN
  RAISE EXCEPTION 'Mission 28 separately trusted resolution mismatch' USING ERRCODE='42501'; END IF;
 decision_digest_value:=public.canonical_automation_digest_v1('mission28.accepted-decision-binding.v1'||chr(10),doc->'decisionBinding');
 authorization_digest_value:=public.canonical_automation_digest_v1('mission28.authorization-binding.v1'||chr(10),doc->'authorizationBinding');
 currentness_digest_value:=public.canonical_automation_digest_v1('mission28.currentness-binding.v1'||chr(10),doc->'currentnessBinding');
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-action-transaction:'||transaction_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_action_transactions_v1
  WHERE organization_id=org AND transaction_id=transaction_value;
 IF stored.transaction_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 conflicting action transaction identity' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('state','stored','replayed',TRUE,'transactionId',transaction_value,'runId',run_value,
   'unitCount',stored.unit_count,'requestDigest',stored.request_digest,'recordedAt',public.canonical_automation_utc_v1(stored.recorded_at));
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy_value::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1 WHERE organization_id=org AND policy_id=policy_value
   AND version=policy_version_value AND canonical_digest=doc#>>'{policyBinding,policyDigest}' AND expires_at>statement_timestamp()) THEN
  RAISE EXCEPTION 'Mission 28 exact current policy unavailable' USING ERRCODE='42501'; END IF;
 SELECT to_state INTO latest_policy_state FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND policy_id=policy_value AND policy_version=policy_version_value
  ORDER BY lifecycle_sequence DESC LIMIT 1;
 IF latest_policy_state IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'Mission 28 active policy authority unavailable' USING ERRCODE='42501'; END IF;
 FOR item_index IN 0..source_count-1 LOOP
  IF jsonb_typeof(doc#>'{sourceBinding,snapshotIds}'->item_index) IS DISTINCT FROM 'string' OR
     jsonb_typeof(doc#>'{sourceBinding,snapshotDigests}'->item_index) IS DISTINCT FROM 'string' OR
     COALESCE(doc#>>ARRAY['sourceBinding','snapshotIds',item_index::text],'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     COALESCE(doc#>>ARRAY['sourceBinding','snapshotDigests',item_index::text],'')!~'^sha256:[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Mission 28 source snapshot identity invalid' USING ERRCODE='22023'; END IF;
  snapshot_id_value:=(doc#>>ARRAY['sourceBinding','snapshotIds',item_index::text])::uuid;
  snapshot_digest_value:=doc#>>ARRAY['sourceBinding','snapshotDigests',item_index::text];
  SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND snapshot_id=snapshot_id_value AND snapshot_digest=snapshot_digest_value;
  IF snapshot_item.snapshot_id IS NULL OR snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
   RAISE EXCEPTION 'Mission 28 exact current source snapshot unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-lineage:'||snapshot_item.trigger_id||':'||
   snapshot_item.record_identity_digest||':'||snapshot_item.event_kind,0));
  SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id AND record_identity_digest=snapshot_item.record_identity_digest
    AND event_kind=snapshot_item.event_kind ORDER BY lineage_sequence DESC LIMIT 1;
  IF latest_snapshot_id IS DISTINCT FROM snapshot_id_value THEN
   RAISE EXCEPTION 'Mission 28 source snapshot is not latest lineage head' USING ERRCODE='42501'; END IF;
 END LOOP;
 item_index:=0;
 FOR unit IN SELECT value FROM jsonb_array_elements(doc->'actionUnits') LOOP
  IF public.canonical_automation_part4b_keys_exact_v1(unit,ARRAY['unitId','outboxId','unitIndex','actionFamilyId','actionTemplateId','actionTemplateDigest','recipientSetDigest','channelId','providerMode','effectClass','materialDigest','idempotencyKeyDigest','unitDigest']) IS DISTINCT FROM TRUE OR
     jsonb_typeof(unit->'unitIndex') IS DISTINCT FROM 'number' OR (unit->>'unitIndex')!~'^(0|[1-9][0-9]*)$' OR
     (unit->>'unitIndex')::integer IS DISTINCT FROM item_index OR
     COALESCE(unit->>'unitId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     COALESCE(unit->>'outboxId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR unit->>'outboxId' IS NOT DISTINCT FROM unit->>'unitId' OR
     COALESCE(unit->>'actionTemplateDigest','')!~'^sha256:[0-9a-f]{64}$' OR COALESCE(unit->>'recipientSetDigest','')!~'^sha256:[0-9a-f]{64}$' OR
     COALESCE(unit->>'materialDigest','')!~'^sha256:[0-9a-f]{64}$' OR COALESCE(unit->>'idempotencyKeyDigest','')!~'^sha256:[0-9a-f]{64}$' OR
     COALESCE(unit->>'unitDigest','')!~'^sha256:[0-9a-f]{64}$' OR unit->>'channelId' IS DISTINCT FROM 'in_app_passive' OR
     unit->>'providerMode' IS DISTINCT FROM 'provider_disabled' OR unit->>'effectClass' IS DISTINCT FROM 'internal_record_only' THEN
   RAISE EXCEPTION 'Mission 28 action unit shape invalid' USING ERRCODE='22023'; END IF;
  expected_template:=CASE unit->>'actionFamilyId' WHEN 'internal_read_digest_task' THEN 'internal_fact_digest_v1'
   WHEN 'owner_approval_request' THEN 'owner_approval_request_v1'
   WHEN 'collection_escalation' THEN 'reviewed_collection_work_item_v1' ELSE NULL END;
  IF expected_template IS NULL OR unit->>'actionTemplateId' IS DISTINCT FROM expected_template THEN
   RAISE EXCEPTION 'Mission 28 action template binding invalid' USING ERRCODE='42501'; END IF;
  unit_base:=unit-'unitDigest';
  unit_digest_value:=public.canonical_automation_digest_v1('mission28.action-unit.v1'||chr(10),unit_base);
  IF unit_digest_value IS DISTINCT FROM unit->>'unitDigest' THEN
   RAISE EXCEPTION 'Mission 28 action unit digest invalid' USING ERRCODE='22023'; END IF;
  item_index:=item_index+1;
 END LOOP;
 recorded_value:=public.canonical_automation_clock_v1();
 INSERT INTO public.canonical_automation_action_transactions_v1 VALUES(org,transaction_value,run_value,policy_value,
  policy_version_value,doc#>>'{policyBinding,policyDigest}',doc#>>'{sourceBinding,sourceSetDigest}',decision_digest_value,
  authorization_digest_value,currentness_digest_value,request_digest_value,jsonb_array_length(doc->'actionUnits'),canonical_text_value,doc,
  'decision_history','postgresql_statement_timestamp_v1','UTC',recorded_value);
 item_index:=0;
 FOR unit IN SELECT value FROM jsonb_array_elements(doc->'actionUnits') LOOP
  outbox_value:=(unit->>'outboxId')::uuid;
  INSERT INTO public.canonical_automation_action_units_v1 VALUES(org,transaction_value,(unit->>'unitId')::uuid,run_value,item_index,
   unit->>'actionFamilyId',unit->>'actionTemplateId',unit->>'actionTemplateDigest',unit->>'recipientSetDigest',unit->>'channelId',
   unit->>'providerMode',unit->>'effectClass',unit->>'materialDigest',unit->>'idempotencyKeyDigest',unit->>'unitDigest',
   'committed_unpublished',recorded_value);
  INSERT INTO public.canonical_automation_action_outbox_v1 VALUES(org,outbox_value,transaction_value,(unit->>'unitId')::uuid,
   unit->>'unitDigest','committed_unpublished',NULL,NULL,NULL,NULL,recorded_value);
  item_index:=item_index+1;
 END LOOP;
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'transactionId',transaction_value,'runId',run_value,
  'unitCount',item_index,'requestDigest',request_digest_value,'recordedAt',public.canonical_automation_utc_v1(recorded_value));
END $$;

REVOKE ALL ON TABLE public.canonical_automation_action_transactions_v1,
 public.canonical_automation_action_units_v1,public.canonical_automation_action_outbox_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_store_action_transaction_v1(TEXT,JSONB) FROM PUBLIC;
