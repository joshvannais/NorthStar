-- Mission 23 Part 6: version-pinned checklists, inspection/quality observations,
-- inert notes and capability-gated tenant-private file evidence. No Part 7+
-- lifecycle, completion, UI, Polaris, financial, provider activation or contact.

CREATE FUNCTION public.canonical_field_evidence_text_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cp INTEGER;
BEGIN
  IF value IS NULL OR value<>normalize(value,NFC) OR octet_length(value)>16000 OR value ~ '[<>]' OR value ~* '(https?://|data:|javascript:|www\.)' THEN RETURN FALSE; END IF;
  FOR cp IN SELECT ascii(character_value) FROM regexp_split_to_table(value,'') character_value LOOP
    IF cp BETWEEN 0 AND 31 OR cp BETWEEN 127 AND 159 OR cp IN (1564,8203,8204,8205,8206,8207,8234,8235,8236,8237,8238,8288,8289,8290,8291,8292,8293,8294,8295,8296,8297,8298,8299,8300,8301,8302,8303,65279,65529,65530,65531,65532) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_field_evidence_json_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE child JSONB; child_key TEXT;
BEGIN
  IF value IS NULL OR octet_length(value::text)>32768 THEN RETURN FALSE; END IF;
  IF jsonb_typeof(value)='string' THEN RETURN public.canonical_field_evidence_text_valid(value#>>'{}'); END IF;
  IF jsonb_typeof(value)='array' THEN FOR child IN SELECT item FROM jsonb_array_elements(value) item LOOP IF NOT public.canonical_field_evidence_json_valid(child) THEN RETURN FALSE; END IF; END LOOP; END IF;
  IF jsonb_typeof(value)='object' THEN
    FOR child_key,child IN SELECT item.key,item.value FROM jsonb_each(value) item LOOP
      IF NOT public.canonical_field_evidence_text_valid(child_key) OR NOT public.canonical_field_evidence_json_valid(child) THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;
  RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_field_evidence_object_keys_exact(value JSONB, allowed TEXT[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(value)='object' AND
   (SELECT count(*)=cardinality(allowed) AND count(*) FILTER(WHERE object_key=ANY(allowed))=cardinality(allowed)
      FROM jsonb_object_keys(value) keys(object_key))
$$;

CREATE FUNCTION public.canonical_field_evidence_uuid_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

CREATE FUNCTION public.canonical_field_evidence_document_valid(action_value TEXT, document_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB; link_value JSONB; item_count INTEGER; key_count INTEGER; link_count INTEGER; unique_link_count INTEGER;
BEGIN
  IF jsonb_typeof(document_value)<>'object' OR NOT public.canonical_field_evidence_json_valid(document_value) THEN RETURN FALSE; END IF;
  IF action_value='create_checklist' THEN
    IF NOT public.canonical_field_evidence_object_keys_exact(document_value,ARRAY['kind','template','adHocTemplateVersion','adHocTemplateDigest','items']) THEN RETURN FALSE; END IF;
    IF document_value->>'kind'<>'checklist' OR jsonb_typeof(document_value->'items')<>'array' OR jsonb_array_length(document_value->'items') NOT BETWEEN 1 AND 100 THEN RETURN FALSE; END IF;
    SELECT count(*),count(DISTINCT item_value->>'key') INTO item_count,key_count
      FROM jsonb_array_elements(document_value->'items') checklist_items(item_value);
    IF item_count<>key_count THEN RETURN FALSE; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(document_value->'items') LOOP
      IF NOT public.canonical_field_evidence_object_keys_exact(item,ARRAY['key','prompt','required'])
        OR item->>'key' !~ '^[a-z0-9][a-z0-9._:-]{0,63}$' OR jsonb_typeof(item->'required')<>'boolean' OR length(item->>'prompt') NOT BETWEEN 1 AND 500 THEN RETURN FALSE; END IF;
    END LOOP;
    IF document_value->'template'='null'::jsonb THEN
      RETURN document_value->>'adHocTemplateVersion'='m23-checklist-ad-hoc-v1' AND document_value->>'adHocTemplateDigest'='ad69804f35ec72017dcbc7b4de41bc804f33a3b4b08e26e729b4313864ea895b';
    END IF;
    RETURN public.canonical_field_evidence_object_keys_exact(document_value->'template',ARRAY['entryId','versionId','versionNumber','digest','publicationId'])
      AND public.canonical_field_evidence_uuid_valid(document_value->'template'->>'entryId')
      AND public.canonical_field_evidence_uuid_valid(document_value->'template'->>'versionId')
      AND public.canonical_field_evidence_uuid_valid(document_value->'template'->>'publicationId')
      AND (document_value->'template'->>'versionNumber') ~ '^[1-9][0-9]{0,8}$'
      AND (document_value->'template'->>'digest') ~ '^[0-9a-f]{64}$'
      AND document_value->>'adHocTemplateVersion' IS NULL AND document_value->>'adHocTemplateDigest' IS NULL;
  ELSIF action_value IN ('respond_item','record_observation','correct') AND document_value->>'kind' IN ('checklist_response','observation') THEN
    IF document_value->>'kind'='checklist_response' AND NOT public.canonical_field_evidence_object_keys_exact(document_value,ARRAY['kind','resultType','observation','measurement','exception','supportingEvidenceIds','professionalConclusion','checklistId','itemKey']) THEN RETURN FALSE; END IF;
    IF document_value->>'kind'='observation' AND (NOT public.canonical_field_evidence_object_keys_exact(document_value,ARRAY['kind','observationClass','resultType','observation','measurement','exception','supportingEvidenceIds','professionalConclusion']) OR document_value->>'observationClass' NOT IN ('inspection','quality','field_observation')) THEN RETURN FALSE; END IF;
    IF document_value->>'resultType' NOT IN ('observation','measurement','pass','fail','unavailable','needs_review') OR document_value->'professionalConclusion'<>'false'::jsonb OR jsonb_typeof(document_value->'supportingEvidenceIds')<>'array' OR jsonb_array_length(document_value->'supportingEvidenceIds')>20 OR length(document_value->>'observation') NOT BETWEEN 1 AND 2000 THEN RETURN FALSE; END IF;
    SELECT count(*),count(DISTINCT link_item#>>'{}') INTO link_count,unique_link_count FROM jsonb_array_elements(document_value->'supportingEvidenceIds') links(link_item);
    IF link_count<>unique_link_count THEN RETURN FALSE; END IF;
    FOR link_value IN SELECT value FROM jsonb_array_elements(document_value->'supportingEvidenceIds') LOOP
      IF jsonb_typeof(link_value)<>'string' OR NOT public.canonical_field_evidence_uuid_valid(link_value#>>'{}') THEN RETURN FALSE; END IF;
    END LOOP;
    IF (document_value->>'resultType'='measurement')<>(jsonb_typeof(document_value->'measurement')='object') THEN RETURN FALSE; END IF;
    IF jsonb_typeof(document_value->'measurement')='object' AND (NOT public.canonical_field_evidence_object_keys_exact(document_value->'measurement',ARRAY['value','unit']) OR (document_value->'measurement'->>'value') !~ '^-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' OR (document_value->'measurement'->>'unit') !~ '^[a-z0-9][a-z0-9._:-]{0,63}$') THEN RETURN FALSE; END IF;
    IF document_value->'exception'<>'null'::jsonb AND length(document_value->>'exception') NOT BETWEEN 1 AND 1000 THEN RETURN FALSE; END IF;
    RETURN document_value->>'kind'<>'checklist_response' OR (public.canonical_field_evidence_uuid_valid(document_value->>'checklistId') AND (document_value->>'itemKey') ~ '^[a-z0-9][a-z0-9._:-]{0,63}$');
  ELSIF action_value IN ('record_note','correct') AND document_value->>'kind'='note' THEN
    RETURN public.canonical_field_evidence_object_keys_exact(document_value,ARRAY['kind','note','caption'])
      AND length(document_value->>'note') BETWEEN 1 AND 4000 AND (document_value->'caption'='null'::jsonb OR length(document_value->>'caption') BETWEEN 1 AND 500);
  ELSIF action_value='register_file' THEN
    RETURN public.canonical_field_evidence_object_keys_exact(document_value,ARRAY['kind','objectId','displayName','extension','mediaType','byteCount','contentDigest','quarantineDisposition','scannerVersion','scannerEvidenceDigest','metadataRemovalDigest','storageCapabilityVersion','storageCapabilityDigest','encryptionAtRest','decompressionSafe','decodedPixelCount','activeContentInline','privacyFlags','privacyPolicy','retentionDays','consentOrComplianceConclusion','malwareClearanceClaim'])
      AND document_value->>'kind'='file' AND public.canonical_field_evidence_uuid_valid(document_value->>'objectId')
      AND length(document_value->>'displayName') BETWEEN 1 AND 120
      AND document_value->>'mediaType' IN ('image/jpeg','image/png','image/webp')
      AND (document_value->>'extension') IN ('jpg','jpeg','png','webp')
      AND ((document_value->>'mediaType'='image/jpeg' AND document_value->>'extension' IN ('jpg','jpeg')) OR (document_value->>'mediaType'='image/png' AND document_value->>'extension'='png') OR (document_value->>'mediaType'='image/webp' AND document_value->>'extension'='webp'))
      AND (document_value->>'byteCount')::bigint BETWEEN 1 AND 10485760
      AND (document_value->>'contentDigest') ~ '^[0-9a-f]{64}$'
      AND document_value->>'quarantineDisposition'='released_after_clean_scan'
      AND (document_value->>'scannerVersion') ~ '^[a-z0-9][a-z0-9._-]{0,79}$'
      AND (document_value->>'scannerEvidenceDigest') ~ '^[0-9a-f]{64}$'
      AND (document_value->>'metadataRemovalDigest') ~ '^[0-9a-f]{64}$'
      AND (document_value->>'storageCapabilityVersion') ~ '^[a-z0-9][a-z0-9._-]{0,79}$'
      AND (document_value->>'storageCapabilityDigest') ~ '^[0-9a-f]{64}$'
      AND document_value->'encryptionAtRest'='true'::jsonb
      AND document_value->'decompressionSafe'='true'::jsonb
      AND (document_value->>'decodedPixelCount') ~ '^[1-9][0-9]{0,7}$'
      AND (document_value->>'decodedPixelCount')::bigint BETWEEN 1 AND 40000000
      AND document_value->'activeContentInline'='false'::jsonb
      AND document_value->'consentOrComplianceConclusion'='false'::jsonb
      AND document_value->'malwareClearanceClaim'='false'::jsonb
      AND jsonb_typeof(document_value->'privacyFlags')='array'
      AND jsonb_array_length(document_value->'privacyFlags') BETWEEN 1 AND 3
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(document_value->'privacyFlags') flag WHERE flag NOT IN ('none','faces','customer_property'))
      AND (SELECT count(*)=count(DISTINCT flag) FROM jsonb_array_elements_text(document_value->'privacyFlags') flags(flag))
      AND ((document_value->'privacyFlags'='["none"]'::jsonb AND document_value->'privacyPolicy'='null'::jsonb)
        OR (NOT (document_value->'privacyFlags' ? 'none') AND public.canonical_field_evidence_object_keys_exact(document_value->'privacyPolicy',ARRAY['policyVersion','policyDigest','consentEvidenceId','consentEvidenceDigest'])
          AND length(document_value->'privacyPolicy'->>'policyVersion') BETWEEN 1 AND 80
          AND (document_value->'privacyPolicy'->>'policyDigest') ~ '^[0-9a-f]{64}$'
          AND public.canonical_field_evidence_uuid_valid(document_value->'privacyPolicy'->>'consentEvidenceId')
          AND (document_value->'privacyPolicy'->>'consentEvidenceDigest') ~ '^[0-9a-f]{64}$'))
      AND (document_value->>'retentionDays') ~ '^[1-9][0-9]{0,2}$'
      AND (document_value->>'retentionDays')::integer BETWEEN 1 AND 365;
  END IF;
  RETURN FALSE;
EXCEPTION WHEN others THEN RETURN FALSE;
END $$;

CREATE TABLE public.canonical_field_evidence_records (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL, assignment_id UUID NOT NULL, root_id UUID NOT NULL,
  previous_record_id UUID, evidence_type TEXT NOT NULL, revision BIGINT NOT NULL,
  document JSONB NOT NULL, canonical_digest CHAR(64) NOT NULL,
  recorded_by_user_id UUID NOT NULL, performed_by_profile_id UUID NOT NULL, auth_session_id UUID NOT NULL,
  source_execution_revision BIGINT NOT NULL, source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL, source_assignment_digest CHAR(64) NOT NULL,
  action_code TEXT NOT NULL, reason TEXT NOT NULL, request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(), decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_evidence_records_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_field_evidence_records_root_revision UNIQUE(organization_id,root_id,revision),
  CONSTRAINT canonical_field_evidence_records_execution_fk FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_records_assignment_fk FOREIGN KEY(organization_id,assignment_id) REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_records_root_fk FOREIGN KEY(organization_id,root_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_field_evidence_records_previous_fk FOREIGN KEY(organization_id,previous_record_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_records_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_records_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_records_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_records_type_check CHECK(evidence_type IN ('checklist','checklist_response','observation','note','file')),
  CONSTRAINT canonical_field_evidence_records_revision_check CHECK(revision>=1 AND ((revision=1 AND previous_record_id IS NULL AND root_id=id) OR (revision>1 AND previous_record_id IS NOT NULL AND root_id<>id))),
  CONSTRAINT canonical_field_evidence_records_digest_check CHECK(canonical_digest~'^[0-9a-f]{64}$' AND source_execution_digest~'^[0-9a-f]{64}$' AND source_assignment_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_field_evidence_records_source_revision_check CHECK(source_execution_revision>=1 AND source_assignment_revision>=1),
  CONSTRAINT canonical_field_evidence_records_document_check CHECK(evidence_type=document->>'kind' AND (
    (action_code='create_checklist' AND evidence_type='checklist' AND public.canonical_field_evidence_document_valid(action_code,document)) OR
    (action_code='respond_item' AND evidence_type='checklist_response' AND public.canonical_field_evidence_document_valid(action_code,document)) OR
    (action_code='record_observation' AND evidence_type='observation' AND public.canonical_field_evidence_document_valid(action_code,document)) OR
    (action_code='record_note' AND evidence_type='note' AND public.canonical_field_evidence_document_valid(action_code,document)) OR
    (action_code='correct' AND evidence_type IN ('checklist_response','observation','note') AND public.canonical_field_evidence_document_valid(action_code,document)) OR
    (action_code='register_file' AND evidence_type='file' AND public.canonical_field_evidence_document_valid(action_code,document-'retainedUntil') AND
      document->>'retainedUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$')
  )),
  CONSTRAINT canonical_field_evidence_records_reason_check CHECK(public.canonical_field_execution_reason_valid(reason)),
  CONSTRAINT canonical_field_evidence_records_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);
CREATE INDEX canonical_field_evidence_records_execution_time ON public.canonical_field_evidence_records(organization_id,execution_id,decided_at DESC,id DESC);
CREATE UNIQUE INDEX canonical_field_evidence_object_unique ON public.canonical_field_evidence_records(organization_id,((document->>'objectId'))) WHERE evidence_type='file';

CREATE FUNCTION public.canonical_field_evidence_record_digest_valid(record_value public.canonical_field_evidence_records)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT rtrim(record_value.canonical_digest)=encode(sha256(convert_to(jsonb_build_object(
   'action',record_value.action_code,'assignmentDigest',rtrim(record_value.source_assignment_digest),
   'assignmentRevision',record_value.source_assignment_revision,'document',record_value.document,
   'executionDigest',rtrim(record_value.source_execution_digest),'executionId',record_value.execution_id,
   'executionRevision',record_value.source_execution_revision,'performedBy',record_value.performed_by_profile_id,
   'previousRecordId',record_value.previous_record_id,'recordedBy',record_value.recorded_by_user_id,
   'revision',record_value.revision,'rootId',record_value.root_id)::text,'UTF8')),'hex')
$$;
ALTER TABLE public.canonical_field_evidence_records ADD CONSTRAINT canonical_field_evidence_records_canonical_digest_check CHECK(public.canonical_field_evidence_record_digest_valid(canonical_field_evidence_records));

CREATE TABLE public.canonical_field_evidence_events (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL, record_id UUID NOT NULL, root_id UUID NOT NULL, action_code TEXT NOT NULL,
  before_revision BIGINT NOT NULL, after_revision BIGINT NOT NULL, before_digest CHAR(64), after_digest CHAR(64) NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL, request_digest CHAR(64) NOT NULL,
  recorded_by_user_id UUID NOT NULL, performed_by_profile_id UUID NOT NULL, auth_session_id UUID NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL, transaction_id BIGINT NOT NULL DEFAULT txid_current(), decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_evidence_events_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_field_evidence_events_record_unique UNIQUE(organization_id,record_id),
  CONSTRAINT canonical_field_evidence_events_record_fk FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_field_evidence_events_root_fk FOREIGN KEY(organization_id,root_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_field_evidence_events_execution_fk FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_events_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_events_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_events_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_events_revision_check CHECK(before_revision>=0 AND after_revision=before_revision+1 AND ((before_revision=0 AND before_digest IS NULL) OR (before_revision>0 AND before_digest~'^[0-9a-f]{64}$'))),
  CONSTRAINT canonical_field_evidence_events_digest_check CHECK(after_digest~'^[0-9a-f]{64}$' AND idempotency_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_field_evidence_events_action_check CHECK(action_code IN ('create_checklist','respond_item','record_observation','record_note','correct','register_file')),
  CONSTRAINT canonical_field_evidence_events_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);

CREATE TABLE public.canonical_field_evidence_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL, record_id UUID NOT NULL, event_id UUID NOT NULL, action_code TEXT NOT NULL,
  before_revision BIGINT NOT NULL, after_revision BIGINT NOT NULL, before_digest CHAR(64), after_digest CHAR(64) NOT NULL,
  recorded_by_user_id UUID NOT NULL, performed_by_profile_id UUID NOT NULL, auth_session_id UUID NOT NULL,
  source_execution_revision BIGINT NOT NULL, source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL, source_assignment_digest CHAR(64) NOT NULL,
  reason TEXT NOT NULL, request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(), decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_evidence_audit_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_field_evidence_audit_record_unique UNIQUE(organization_id,record_id),
  CONSTRAINT canonical_field_evidence_audit_record_fk FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_field_evidence_audit_event_fk FOREIGN KEY(organization_id,event_id) REFERENCES public.canonical_field_evidence_events(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_field_evidence_audit_execution_fk FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_audit_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_audit_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_audit_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_audit_revision_check CHECK(before_revision>=0 AND after_revision=before_revision+1 AND source_execution_revision>=1 AND source_assignment_revision>=1 AND ((before_revision=0 AND before_digest IS NULL) OR (before_revision>0 AND before_digest~'^[0-9a-f]{64}$'))),
  CONSTRAINT canonical_field_evidence_audit_digest_check CHECK(after_digest~'^[0-9a-f]{64}$' AND source_execution_digest~'^[0-9a-f]{64}$' AND source_assignment_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_field_evidence_audit_action_check CHECK(action_code IN ('create_checklist','respond_item','record_observation','record_note','correct','register_file')),
  CONSTRAINT canonical_field_evidence_audit_reason_check CHECK(public.canonical_field_execution_reason_valid(reason)),
  CONSTRAINT canonical_field_evidence_audit_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);

CREATE TABLE public.canonical_field_evidence_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL, key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL, action_code TEXT NOT NULL, record_id UUID NOT NULL,
  response_status INTEGER NOT NULL, response_body JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(organization_id,actor_user_id,auth_session_id,key_hash),
  CONSTRAINT canonical_field_evidence_idempotency_actor_fk FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_idempotency_session_fk FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_evidence_idempotency_record_fk FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_field_evidence_idempotency_digest_check CHECK(key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_field_evidence_idempotency_response_check CHECK(action_code IN ('create_checklist','respond_item','record_observation','record_note','correct','register_file') AND response_status=201 AND jsonb_typeof(response_body)='object')
);

CREATE TABLE public.canonical_field_evidence_file_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL, record_id UUID NOT NULL, object_id UUID NOT NULL, content_digest CHAR(64) NOT NULL,
  actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(), authorized_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_field_file_access_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_field_file_access_execution_fk FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_file_access_record_fk FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_file_access_actor_fk FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_file_access_session_fk FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_field_file_access_digest_check CHECK(content_digest~'^[0-9a-f]{64}$')
);
CREATE INDEX canonical_field_evidence_file_access_record_time ON public.canonical_field_evidence_file_access_events(organization_id,record_id,authorized_at DESC,id DESC);

CREATE FUNCTION public.canonical_field_evidence_projection(record_value public.canonical_field_evidence_records)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',record_value.id,'rootId',record_value.root_id,'previousRecordId',record_value.previous_record_id,
 'type',record_value.evidence_type,'revision',record_value.revision,'document',record_value.document,'digest',rtrim(record_value.canonical_digest),
 'executionId',record_value.execution_id,'assignmentId',record_value.assignment_id,'recordedByUserId',record_value.recorded_by_user_id,
 'performedByProfileId',record_value.performed_by_profile_id,'sourceExecutionRevision',record_value.source_execution_revision,
 'sourceExecutionDigest',rtrim(record_value.source_execution_digest),'sourceAssignmentRevision',record_value.source_assignment_revision,
 'sourceAssignmentDigest',rtrim(record_value.source_assignment_digest),'reason',record_value.reason,
 'decidedAt',to_char(record_value.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

CREATE FUNCTION public.canonical_field_evidence_immutable() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Canonical field evidence is immutable' USING ERRCODE='55000'; END $$;

CREATE FUNCTION public.canonical_field_evidence_own_decision_time() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN NEW.transaction_id:=txid_current(); NEW.decided_at:=transaction_timestamp(); RETURN NEW; END $$;

CREATE FUNCTION public.canonical_field_evidence_own_receipt_time() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN NEW.created_at:=transaction_timestamp(); RETURN NEW; END $$;

CREATE FUNCTION public.canonical_field_evidence_own_access() RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 NEW.transaction_id:=txid_current(); NEW.authorized_at:=transaction_timestamp();
 IF NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records r WHERE r.organization_id=NEW.organization_id AND r.execution_id=NEW.execution_id AND r.id=NEW.record_id AND r.evidence_type='file' AND r.document->>'objectId'=NEW.object_id::text AND r.document->>'contentDigest'=NEW.content_digest) THEN
   RAISE EXCEPTION 'File access evidence diverges from record' USING ERRCODE='23514',CONSTRAINT='canonical_field_file_access_divergent';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.canonical_field_evidence_complete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_events e WHERE e.organization_id=NEW.organization_id AND e.execution_id=NEW.execution_id AND e.record_id=NEW.id AND e.root_id=NEW.root_id AND e.action_code=NEW.action_code AND e.before_revision=NEW.revision-1 AND e.after_revision=NEW.revision AND e.before_digest IS NOT DISTINCT FROM CASE WHEN NEW.previous_record_id IS NULL THEN NULL ELSE (SELECT predecessor.canonical_digest FROM public.canonical_field_evidence_records predecessor WHERE predecessor.organization_id=NEW.organization_id AND predecessor.id=NEW.previous_record_id) END AND rtrim(e.after_digest)=rtrim(NEW.canonical_digest) AND e.recorded_by_user_id=NEW.recorded_by_user_id AND e.performed_by_profile_id=NEW.performed_by_profile_id AND e.auth_session_id=NEW.auth_session_id AND e.request_correlation_id=NEW.request_correlation_id AND e.transaction_id=NEW.transaction_id AND e.decided_at=NEW.decided_at)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_audit_events a WHERE a.organization_id=NEW.organization_id AND a.execution_id=NEW.execution_id AND a.record_id=NEW.id AND a.action_code=NEW.action_code AND a.before_revision=NEW.revision-1 AND a.after_revision=NEW.revision AND a.before_digest IS NOT DISTINCT FROM CASE WHEN NEW.previous_record_id IS NULL THEN NULL ELSE (SELECT predecessor.canonical_digest FROM public.canonical_field_evidence_records predecessor WHERE predecessor.organization_id=NEW.organization_id AND predecessor.id=NEW.previous_record_id) END AND rtrim(a.after_digest)=rtrim(NEW.canonical_digest) AND a.recorded_by_user_id=NEW.recorded_by_user_id AND a.performed_by_profile_id=NEW.performed_by_profile_id AND a.auth_session_id=NEW.auth_session_id AND a.source_execution_revision=NEW.source_execution_revision AND rtrim(a.source_execution_digest)=rtrim(NEW.source_execution_digest) AND a.source_assignment_revision=NEW.source_assignment_revision AND rtrim(a.source_assignment_digest)=rtrim(NEW.source_assignment_digest) AND a.reason=NEW.reason AND a.request_correlation_id=NEW.request_correlation_id AND a.transaction_id=NEW.transaction_id AND a.decided_at=NEW.decided_at)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_idempotency i JOIN public.canonical_field_evidence_events e ON e.organization_id=i.organization_id AND e.record_id=i.record_id WHERE i.organization_id=NEW.organization_id AND i.actor_user_id=NEW.recorded_by_user_id AND i.auth_session_id=NEW.auth_session_id AND i.record_id=NEW.id AND i.action_code=NEW.action_code AND i.key_hash=e.idempotency_key_hash AND i.request_digest=e.request_digest AND i.response_status=201 AND i.response_body=jsonb_build_object('success',TRUE,'data',public.canonical_field_evidence_projection(NEW)) AND i.created_at=NEW.decided_at) THEN
   RAISE EXCEPTION 'Field evidence transaction incomplete' USING ERRCODE='23514',CONSTRAINT='canonical_field_evidence_incomplete';
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION public.canonical_field_evidence_read_authorized(org UUID, role_value TEXT, profile_value UUID, execution_value UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.canonical_field_executions execution
   JOIN public.canonical_schedule_assignments assignment ON assignment.organization_id=execution.organization_id AND assignment.id=execution.assignment_id
   JOIN public.canonical_appointments appointment ON appointment.organization_id=execution.organization_id AND appointment.id=execution.appointment_id
   JOIN public.canonical_transcripts transcript ON transcript.organization_id=execution.organization_id AND transcript.operation_id=execution.operation_id AND transcript.graph_id=execution.graph_id
   WHERE execution.organization_id=org AND execution.id=execution_value
    AND assignment.target_state='assigned' AND assignment.dispatch_state='dispatched'
    AND lower(btrim(assignment.appointment_status)) NOT IN ('cancelled','completed')
    AND lower(btrim(appointment.status)) NOT IN ('cancelled','completed')
    AND public.canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice')
    AND public.canonical_field_execution_actor_in_scope(org,role_value,profile_value,assignment)
 )
$$;

CREATE FUNCTION public.canonical_field_file_upload_authorize(
 org UUID, actor UUID, role_value TEXT, session_value UUID, csrf_value TEXT, execution_value UUID,
 performer UUID, object_value UUID, expected_execution_revision BIGINT, expected_execution_digest TEXT,
 expected_assignment_revision BIGINT, expected_assignment_digest TEXT, idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; execution_record public.canonical_field_executions%ROWTYPE; assignment_record public.canonical_schedule_assignments%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR object_value IS NULL
 OR idempotency_key IS NULL OR idempotency_key !~ '^[!-~]{16,128}$'
 OR expected_execution_revision IS NULL OR expected_execution_digest !~ '^[0-9a-f]{64}$'
 OR expected_assignment_revision IS NULL OR expected_assignment_digest !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Invalid field file authorization input' USING ERRCODE='22023';
 END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf_value,TRUE);
 SELECT * INTO execution_record FROM public.canonical_field_executions WHERE organization_id=org AND id=execution_value FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Execution unavailable' USING ERRCODE='P0002',CONSTRAINT='canonical_field_evidence_not_found'; END IF;
 SELECT * INTO assignment_record FROM public.canonical_schedule_assignments WHERE organization_id=org AND id=execution_record.assignment_id FOR SHARE;
 IF NOT FOUND OR NOT public.canonical_field_execution_replay_authorized(org,role_value,(authority->>'profileId')::uuid,execution_value,NULL)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_transcripts t WHERE t.organization_id=org AND t.operation_id=execution_record.operation_id AND t.graph_id=execution_record.graph_id AND public.canonical_labor_transcript_source_normalized(t.source) IN ('lead','retell','voice')) THEN
   RAISE EXCEPTION 'Execution authority unavailable' USING ERRCODE='42501';
 END IF;
 IF execution_record.revision<>expected_execution_revision OR rtrim(execution_record.canonical_digest)<>expected_execution_digest
 OR assignment_record.revision<>expected_assignment_revision OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest THEN
   RAISE EXCEPTION 'Stale field evidence source' USING ERRCODE='40001',CONSTRAINT='canonical_field_evidence_source_stale';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles p JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
   WHERE p.organization_id=org AND p.id=performer AND m.status='active' AND u.status='active'
   AND (assignment_record.workforce_profile_id=p.id OR (assignment_record.workforce_crew_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.workforce_crew_members cm WHERE cm.organization_id=org AND cm.crew_id=assignment_record.workforce_crew_id AND cm.profile_id=p.id))))
 OR (role_value='member' AND performer<>(authority->>'profileId')::uuid) THEN RAISE EXCEPTION 'Performer unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('status',200,'body',jsonb_build_object('success',TRUE,'data',jsonb_build_object('objectId',object_value,'authorized',TRUE)),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_field_evidence_mutate(
 org UUID, actor UUID, role_value TEXT, session_value UUID, csrf_value TEXT, execution_value UUID,
 action_value TEXT, performer UUID, subject_value UUID, expected_subject_revision BIGINT, expected_subject_digest TEXT,
 expected_execution_revision BIGINT, expected_execution_digest TEXT, expected_assignment_revision BIGINT,
 expected_assignment_digest TEXT, document_value JSONB, idempotency_key TEXT, reason_value TEXT, correlation_value TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; execution_record public.canonical_field_executions%ROWTYPE; assignment_record public.canonical_schedule_assignments%ROWTYPE;
 receipt public.canonical_field_evidence_idempotency%ROWTYPE; subject_record public.canonical_field_evidence_records%ROWTYPE;
 record_value public.canonical_field_evidence_records%ROWTYPE; event_value UUID:=gen_random_uuid(); record_id UUID:=gen_random_uuid();
 key_hash_value TEXT; request_hash_value TEXT; record_digest TEXT; before_revision BIGINT:=0; before_digest TEXT:=NULL; root_value UUID; response JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR action_value NOT IN ('create_checklist','respond_item','record_observation','record_note','correct','register_file')
 OR idempotency_key IS NULL OR idempotency_key !~ '^[!-~]{16,128}$' OR expected_execution_revision IS NULL OR expected_execution_digest IS NULL
 OR expected_assignment_revision IS NULL OR expected_assignment_digest IS NULL OR NOT public.canonical_field_execution_reason_valid(reason_value)
 OR correlation_value !~ '^[ -~]{1,128}$' OR NOT public.canonical_field_evidence_document_valid(action_value,document_value) THEN
  RAISE EXCEPTION 'Invalid field evidence input' USING ERRCODE='22023',CONSTRAINT='canonical_field_evidence_input_invalid';
 END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf_value,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':field-evidence:'||encode(sha256(convert_to(idempotency_key,'UTF8')),'hex'),0));
 SELECT * INTO execution_record FROM public.canonical_field_executions WHERE organization_id=org AND id=execution_value FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Execution unavailable' USING ERRCODE='P0002',CONSTRAINT='canonical_field_evidence_not_found'; END IF;
 SELECT * INTO assignment_record FROM public.canonical_schedule_assignments WHERE organization_id=org AND id=execution_record.assignment_id FOR SHARE;
 IF NOT FOUND OR NOT public.canonical_field_execution_replay_authorized(org,role_value,(authority->>'profileId')::uuid,execution_value,NULL)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_transcripts t WHERE t.organization_id=org AND t.operation_id=execution_record.operation_id AND t.graph_id=execution_record.graph_id AND public.canonical_labor_transcript_source_normalized(t.source) IN ('lead','retell','voice')) THEN
  RAISE EXCEPTION 'Execution authority unavailable' USING ERRCODE='42501';
 END IF;
 IF execution_record.revision<>expected_execution_revision OR rtrim(execution_record.canonical_digest)<>expected_execution_digest
 OR assignment_record.revision<>expected_assignment_revision OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest THEN
  RAISE EXCEPTION 'Stale field evidence source' USING ERRCODE='40001',CONSTRAINT='canonical_field_evidence_source_stale';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles p JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
   WHERE p.organization_id=org AND p.id=performer AND m.status='active' AND u.status='active'
   AND (assignment_record.workforce_profile_id=p.id OR (assignment_record.workforce_crew_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.workforce_crew_members cm WHERE cm.organization_id=org AND cm.crew_id=assignment_record.workforce_crew_id AND cm.profile_id=p.id))))
 OR (role_value='member' AND performer<>(authority->>'profileId')::uuid) THEN RAISE EXCEPTION 'Performer unavailable' USING ERRCODE='42501'; END IF;
 key_hash_value:=encode(sha256(convert_to(idempotency_key,'UTF8')),'hex');
 request_hash_value:=encode(sha256(convert_to(jsonb_build_object('organizationId',org,'actorUserId',actor,'sessionId',session_value,'executionId',execution_value,'action',action_value,'performerId',performer,'subjectId',subject_value,'expectedSubjectRevision',expected_subject_revision,'expectedSubjectDigest',expected_subject_digest,'expectedExecutionRevision',expected_execution_revision,'expectedExecutionDigest',expected_execution_digest,'expectedAssignmentRevision',expected_assignment_revision,'expectedAssignmentDigest',expected_assignment_digest,'document',document_value,'keyHash',key_hash_value,'reason',reason_value)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.canonical_field_evidence_idempotency i WHERE i.organization_id=org AND i.actor_user_id=actor AND i.auth_session_id=session_value AND i.key_hash=key_hash_value;
 IF FOUND THEN IF rtrim(receipt.request_digest)<>request_hash_value THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505',CONSTRAINT='canonical_field_evidence_idempotency_conflict'; END IF; RETURN jsonb_build_object('status',receipt.response_status,'body',receipt.response_body,'replayed',TRUE); END IF;
 IF action_value='register_file' THEN
   document_value:=document_value || jsonb_build_object('retainedUntil',to_char((transaction_timestamp()+make_interval(days=>(document_value->>'retentionDays')::integer)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 END IF;
 IF document_value ? 'supportingEvidenceIds' AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(document_value->'supportingEvidenceIds') links(link_id)
   WHERE NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records linked
     WHERE linked.organization_id=org AND linked.execution_id=execution_value AND linked.id=links.link_id::uuid)
 ) THEN RAISE EXCEPTION 'Supporting evidence unavailable' USING ERRCODE='42501'; END IF;
 IF action_value='register_file' AND document_value->'privacyPolicy'<>'null'::jsonb AND NOT EXISTS(
   SELECT 1 FROM public.canonical_field_evidence_records consent_record
   WHERE consent_record.organization_id=org AND consent_record.execution_id=execution_value
     AND consent_record.id=(document_value->'privacyPolicy'->>'consentEvidenceId')::uuid
     AND rtrim(consent_record.canonical_digest)=document_value->'privacyPolicy'->>'consentEvidenceDigest'
 ) THEN RAISE EXCEPTION 'Sensitive-media policy evidence unavailable' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.canonical_field_evidence_records WHERE organization_id=org AND execution_id=execution_value)>=2000 THEN RAISE EXCEPTION 'Evidence limit' USING ERRCODE='54000',CONSTRAINT='canonical_field_evidence_record_limit'; END IF;
 IF action_value='respond_item' THEN
   SELECT * INTO subject_record FROM public.canonical_field_evidence_records WHERE organization_id=org AND execution_id=execution_value AND id=subject_value AND evidence_type='checklist' FOR SHARE;
   IF NOT FOUND OR subject_record.revision<>expected_subject_revision OR rtrim(subject_record.canonical_digest)<>expected_subject_digest OR document_value->>'checklistId'<>subject_record.id::text
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(subject_record.document->'items') item WHERE item->>'key'=document_value->>'itemKey') THEN RAISE EXCEPTION 'Checklist stale' USING ERRCODE='40001',CONSTRAINT='canonical_field_evidence_subject_stale'; END IF;
   IF EXISTS(SELECT 1 FROM public.canonical_field_evidence_records r WHERE r.organization_id=org AND r.execution_id=execution_value AND r.evidence_type='checklist_response' AND r.document->>'checklistId'=subject_record.id::text AND r.document->>'itemKey'=document_value->>'itemKey') THEN RAISE EXCEPTION 'Checklist response exists' USING ERRCODE='40001',CONSTRAINT='canonical_field_evidence_subject_stale'; END IF;
 ELSIF action_value='correct' THEN
   SELECT * INTO subject_record FROM public.canonical_field_evidence_records WHERE organization_id=org AND execution_id=execution_value AND id=subject_value FOR UPDATE;
   IF NOT FOUND OR subject_record.revision<>expected_subject_revision OR rtrim(subject_record.canonical_digest)<>expected_subject_digest OR subject_record.evidence_type NOT IN ('checklist_response','observation','note') OR document_value->>'kind'<>subject_record.evidence_type OR EXISTS(SELECT 1 FROM public.canonical_field_evidence_records r WHERE r.organization_id=org AND r.previous_record_id=subject_record.id) THEN RAISE EXCEPTION 'Evidence stale' USING ERRCODE='40001',CONSTRAINT='canonical_field_evidence_subject_stale'; END IF;
   IF subject_record.evidence_type='checklist_response' AND (document_value->>'checklistId' IS DISTINCT FROM subject_record.document->>'checklistId' OR document_value->>'itemKey' IS DISTINCT FROM subject_record.document->>'itemKey') THEN RAISE EXCEPTION 'Checklist identity changed' USING ERRCODE='22023'; END IF;
   record_id:=gen_random_uuid(); root_value:=subject_record.root_id; before_revision:=subject_record.revision; before_digest:=rtrim(subject_record.canonical_digest);
 ELSE
   IF subject_value IS NOT NULL OR expected_subject_revision IS NOT NULL OR expected_subject_digest IS NOT NULL THEN RAISE EXCEPTION 'Unexpected subject' USING ERRCODE='22023'; END IF;
 END IF;
 IF action_value='create_checklist' AND document_value->'template'<>'null'::jsonb AND NOT EXISTS(
   SELECT 1 FROM public.canonical_knowledge_publications p JOIN public.canonical_knowledge_versions v ON v.organization_id=p.organization_id AND v.entry_id=p.entry_id AND v.id=p.version_id
   WHERE p.organization_id=org AND p.entry_id=(document_value->'template'->>'entryId')::uuid AND p.version_id=(document_value->'template'->>'versionId')::uuid
   AND p.id=(document_value->'template'->>'publicationId')::uuid AND v.version_number=(document_value->'template'->>'versionNumber')::integer AND rtrim(v.canonical_digest)=document_value->'template'->>'digest')
 THEN RAISE EXCEPTION 'Checklist template stale' USING ERRCODE='40001',CONSTRAINT='canonical_field_evidence_template_stale'; END IF;
 IF action_value='register_file' AND ((SELECT count(*) FROM public.canonical_field_evidence_records WHERE organization_id=org AND execution_id=execution_value AND evidence_type='file')>=25 OR
   (SELECT COALESCE(sum((document->>'byteCount')::bigint),0) FROM public.canonical_field_evidence_records WHERE organization_id=org AND execution_id=execution_value AND evidence_type='file')+(document_value->>'byteCount')::bigint>104857600) THEN RAISE EXCEPTION 'File bound reached' USING ERRCODE='54000',CONSTRAINT='canonical_field_evidence_file_limit'; END IF;
 IF action_value<>'correct' THEN root_value:=record_id; END IF;
 record_digest:=encode(sha256(convert_to(jsonb_build_object('action',action_value,'assignmentDigest',expected_assignment_digest,'assignmentRevision',expected_assignment_revision,'document',document_value,'executionDigest',expected_execution_digest,'executionId',execution_value,'executionRevision',expected_execution_revision,'performedBy',performer,'previousRecordId',CASE WHEN action_value='correct' THEN subject_record.id ELSE NULL END,'recordedBy',actor,'revision',before_revision+1,'rootId',root_value)::text,'UTF8')),'hex');
 INSERT INTO public.canonical_field_evidence_records(id,organization_id,execution_id,assignment_id,root_id,previous_record_id,evidence_type,revision,document,canonical_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,source_execution_revision,source_execution_digest,source_assignment_revision,source_assignment_digest,action_code,reason,request_correlation_id)
 VALUES(record_id,org,execution_value,execution_record.assignment_id,root_value,CASE WHEN action_value='correct' THEN subject_record.id ELSE NULL END,document_value->>'kind',before_revision+1,document_value,record_digest,actor,performer,session_value,expected_execution_revision,expected_execution_digest,expected_assignment_revision,expected_assignment_digest,action_value,reason_value,correlation_value) RETURNING * INTO record_value;
 INSERT INTO public.canonical_field_evidence_events(id,organization_id,execution_id,record_id,root_id,action_code,before_revision,after_revision,before_digest,after_digest,idempotency_key_hash,request_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,request_correlation_id)
 VALUES(event_value,org,execution_value,record_id,root_value,action_value,before_revision,before_revision+1,before_digest,record_digest,key_hash_value,request_hash_value,actor,performer,session_value,correlation_value);
 INSERT INTO public.canonical_field_evidence_audit_events(organization_id,execution_id,record_id,event_id,action_code,before_revision,after_revision,before_digest,after_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,source_execution_revision,source_execution_digest,source_assignment_revision,source_assignment_digest,reason,request_correlation_id)
 VALUES(org,execution_value,record_id,event_value,action_value,before_revision,before_revision+1,before_digest,record_digest,actor,performer,session_value,expected_execution_revision,expected_execution_digest,expected_assignment_revision,expected_assignment_digest,reason_value,correlation_value);
 response:=jsonb_build_object('success',TRUE,'data',public.canonical_field_evidence_projection(record_value));
 INSERT INTO public.canonical_field_evidence_idempotency(organization_id,actor_user_id,auth_session_id,key_hash,request_digest,action_code,record_id,response_status,response_body)
 VALUES(org,actor,session_value,key_hash_value,request_hash_value,action_value,record_id,201,response);
 RETURN jsonb_build_object('status',201,'body',response,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_field_evidence_read(org UUID, actor UUID, role_value TEXT, session_value UUID, execution_value UUID, limit_value INTEGER, cutoff_value TIMESTAMPTZ, last_time TIMESTAMPTZ, last_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; cutoff TIMESTAMPTZ; records JSONB; returned INTEGER; more BOOLEAN; next_data JSONB; total_value INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR limit_value NOT BETWEEN 1 AND 200 OR ((last_time IS NULL)<>(last_id IS NULL))
 OR cutoff_value>transaction_timestamp() OR last_time>cutoff_value THEN RAISE EXCEPTION 'Invalid field evidence read' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF NOT public.canonical_field_evidence_read_authorized(org,role_value,(authority->>'profileId')::uuid,execution_value) THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 cutoff:=COALESCE(cutoff_value,clock_timestamp());
 WITH selected AS (SELECT r.* FROM public.canonical_field_evidence_records r WHERE r.organization_id=org AND r.execution_id=execution_value AND r.decided_at<=cutoff AND (last_time IS NULL OR (r.decided_at,r.id)<(last_time,last_id)) ORDER BY r.decided_at DESC,r.id DESC LIMIT limit_value+1), page AS (SELECT * FROM selected ORDER BY decided_at DESC,id DESC LIMIT limit_value)
 SELECT COALESCE(jsonb_agg(public.canonical_field_evidence_projection(page) ORDER BY decided_at DESC,id DESC),'[]'::jsonb),count(*) INTO records,returned FROM page;
 SELECT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records r WHERE r.organization_id=org AND r.execution_id=execution_value AND r.decided_at<=cutoff AND (last_time IS NULL OR (r.decided_at,r.id)<(last_time,last_id)) OFFSET limit_value) INTO more;
 SELECT count(*) INTO total_value FROM public.canonical_field_evidence_records r WHERE r.organization_id=org AND r.execution_id=execution_value AND r.decided_at<=cutoff;
 IF more AND returned>0 THEN SELECT jsonb_build_object('cutoff',to_char(cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lastTime',record->>'decidedAt','lastId',record->>'id') INTO next_data FROM jsonb_array_elements(records) WITH ORDINALITY item(record,ordinal) ORDER BY ordinal DESC LIMIT 1; END IF;
 RETURN jsonb_build_object('status',200,'body',jsonb_build_object('success',TRUE,'data',records,'total',total_value,'returned',returned,'truncated',more,'nextCursorData',next_data),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_field_file_retrieve_authorize(org UUID, actor UUID, role_value TEXT, session_value UUID, execution_value UUID, object_value UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; record_value public.canonical_field_evidence_records%ROWTYPE; access_value UUID:=gen_random_uuid(); access_time TIMESTAMPTZ:=transaction_timestamp();
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable retrieval required' USING ERRCODE='22023'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF NOT public.canonical_field_evidence_read_authorized(org,role_value,(authority->>'profileId')::uuid,execution_value) THEN RAISE EXCEPTION 'Retrieval unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO record_value FROM public.canonical_field_evidence_records WHERE organization_id=org AND execution_id=execution_value AND evidence_type='file' AND document->>'objectId'=object_value::text;
 IF NOT FOUND OR (record_value.document->>'retainedUntil')::timestamptz<=clock_timestamp() OR record_value.document->>'quarantineDisposition'<>'released_after_clean_scan' THEN RAISE EXCEPTION 'File unavailable' USING ERRCODE='P0002',CONSTRAINT='canonical_field_evidence_not_found'; END IF;
 INSERT INTO public.canonical_field_evidence_file_access_events(id,organization_id,execution_id,record_id,object_id,content_digest,actor_user_id,auth_session_id,authorized_at)
 VALUES(access_value,org,execution_value,record_value.id,object_value,record_value.document->>'contentDigest',actor,session_value,access_time);
 RETURN jsonb_build_object('organizationId',org,'executionId',execution_value,'objectId',object_value,'contentDigest',record_value.document->>'contentDigest','accessEventId',access_value,'authorizedAt',to_char(access_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;

CREATE CONSTRAINT TRIGGER canonical_field_evidence_complete AFTER INSERT ON public.canonical_field_evidence_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.canonical_field_evidence_complete();
CREATE TRIGGER canonical_field_evidence_records_owned_time BEFORE INSERT ON public.canonical_field_evidence_records FOR EACH ROW EXECUTE FUNCTION public.canonical_field_evidence_own_decision_time();
CREATE TRIGGER canonical_field_evidence_events_owned_time BEFORE INSERT ON public.canonical_field_evidence_events FOR EACH ROW EXECUTE FUNCTION public.canonical_field_evidence_own_decision_time();
CREATE TRIGGER canonical_field_evidence_audit_owned_time BEFORE INSERT ON public.canonical_field_evidence_audit_events FOR EACH ROW EXECUTE FUNCTION public.canonical_field_evidence_own_decision_time();
CREATE TRIGGER canonical_field_evidence_idempotency_owned_time BEFORE INSERT ON public.canonical_field_evidence_idempotency FOR EACH ROW EXECUTE FUNCTION public.canonical_field_evidence_own_receipt_time();
CREATE TRIGGER canonical_field_evidence_file_access_owned BEFORE INSERT ON public.canonical_field_evidence_file_access_events FOR EACH ROW EXECUTE FUNCTION public.canonical_field_evidence_own_access();
CREATE TRIGGER canonical_field_evidence_records_immutable BEFORE UPDATE OR DELETE ON public.canonical_field_evidence_records FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_records_no_truncate BEFORE TRUNCATE ON public.canonical_field_evidence_records FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_events_immutable BEFORE UPDATE OR DELETE ON public.canonical_field_evidence_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_events_no_truncate BEFORE TRUNCATE ON public.canonical_field_evidence_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_audit_immutable BEFORE UPDATE OR DELETE ON public.canonical_field_evidence_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_audit_no_truncate BEFORE TRUNCATE ON public.canonical_field_evidence_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_idempotency_immutable BEFORE UPDATE OR DELETE ON public.canonical_field_evidence_idempotency FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_idempotency_no_truncate BEFORE TRUNCATE ON public.canonical_field_evidence_idempotency FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_file_access_immutable BEFORE UPDATE OR DELETE ON public.canonical_field_evidence_file_access_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();
CREATE TRIGGER canonical_field_evidence_file_access_no_truncate BEFORE TRUNCATE ON public.canonical_field_evidence_file_access_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_field_evidence_immutable();

DO $$ DECLARE item RECORD; BEGIN
 FOR item IN SELECT oid::regclass AS identity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relname LIKE 'canonical_field_evidence_%' LOOP EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC',item.identity); END LOOP;
 FOR item IN SELECT oid::regprocedure AS identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'canonical_field_evidence_%' OR proname IN ('canonical_field_file_upload_authorize','canonical_field_file_retrieve_authorize')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',item.identity); END LOOP;
END $$;
