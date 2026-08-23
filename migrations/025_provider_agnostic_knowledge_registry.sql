-- Mission 21 Part 1 - provider-agnostic canonical knowledge registry foundation.
-- Additive only. This migration creates no knowledge from existing authorities,
-- exposes no route, publishes no version, and performs no provider synchronization.

CREATE TABLE canonical_knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  canonical_key VARCHAR(128) NOT NULL,
  entry_type VARCHAR(32) NOT NULL,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_entries_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_entries_version_identity
    UNIQUE (organization_id, id, canonical_key, entry_type),
  CONSTRAINT canonical_knowledge_entries_key_unique
    UNIQUE (organization_id, canonical_key),
  CONSTRAINT canonical_knowledge_entries_created_by_fk
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_entries_key_check CHECK (
    canonical_key ~ '^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$'
    AND length(canonical_key) BETWEEN 1 AND 128
    AND octet_length(canonical_key) <= 128
  ),
  CONSTRAINT canonical_knowledge_entries_type_check CHECK (
    entry_type IN (
      'fact', 'override', 'policy', 'faq', 'guidance', 'constraint',
      'generated_knowledge', 'disclosure'
    )
  )
);

CREATE INDEX canonical_knowledge_entries_tenant_type
  ON canonical_knowledge_entries(organization_id, entry_type, canonical_key, id);

CREATE TABLE canonical_knowledge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  canonical_key VARCHAR(128) NOT NULL,
  entry_type VARCHAR(32) NOT NULL,
  content_origin VARCHAR(32) NOT NULL,
  label VARCHAR(640) NOT NULL,
  sensitivity VARCHAR(24) NOT NULL,
  review_requirement VARCHAR(24) NOT NULL,
  applicability JSONB NOT NULL DEFAULT '{}',
  document JSONB NOT NULL,
  canonical_document TEXT NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  parent_version_id UUID,
  created_by_user_id UUID NOT NULL,
  reason VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_versions_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_versions_entry_identity
    UNIQUE (organization_id, entry_id, id),
  CONSTRAINT canonical_knowledge_versions_number_unique
    UNIQUE (organization_id, entry_id, version_number),
  CONSTRAINT canonical_knowledge_versions_entry_fk
    FOREIGN KEY (organization_id, entry_id, canonical_key, entry_type)
    REFERENCES canonical_knowledge_entries(
      organization_id, id, canonical_key, entry_type
    ) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_versions_parent_fk
    FOREIGN KEY (organization_id, entry_id, parent_version_id)
    REFERENCES canonical_knowledge_versions(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_versions_created_by_fk
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_versions_number_check CHECK (version_number >= 1),
  CONSTRAINT canonical_knowledge_versions_schema_check CHECK (schema_version = 1),
  CONSTRAINT canonical_knowledge_versions_key_check CHECK (
    canonical_key ~ '^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$'
    AND length(canonical_key) BETWEEN 1 AND 128
    AND octet_length(canonical_key) <= 128
  ),
  CONSTRAINT canonical_knowledge_versions_type_check CHECK (
    entry_type IN (
      'fact', 'override', 'policy', 'faq', 'guidance', 'constraint',
      'generated_knowledge', 'disclosure'
    )
  ),
  CONSTRAINT canonical_knowledge_versions_origin_check CHECK (
    content_origin IN ('human', 'authoritative_source', 'generated', 'imported')
  ),
  CONSTRAINT canonical_knowledge_versions_label_check CHECK (
    length(label) BETWEEN 1 AND 160
    AND length(btrim(label)) >= 1
    AND octet_length(label) <= 640
    AND label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT canonical_knowledge_versions_sensitivity_check CHECK (
    sensitivity IN ('public', 'internal', 'restricted', 'legal')
  ),
  CONSTRAINT canonical_knowledge_versions_review_check CHECK (
    review_requirement IN ('standard', 'high_risk', 'attorney_gated')
  ),
  CONSTRAINT canonical_knowledge_versions_applicability_check CHECK (
    jsonb_typeof(applicability) = 'object'
    AND octet_length(applicability::text) <= 8192
  ),
  CONSTRAINT canonical_knowledge_versions_document_check CHECK (
    jsonb_typeof(document) = 'object'
    AND jsonb_typeof(document->'content') = 'object'
    AND octet_length(document::text) <= 65536
    AND (document->>'schemaVersion')::integer = schema_version
    AND document->>'canonicalKey' = canonical_key
    AND document->>'entryType' = entry_type
    AND document->>'label' = label
    AND document->>'sensitivity' = sensitivity
    AND document->>'reviewRequirement' = review_requirement
    AND document->>'origin' = content_origin
    AND document->'applicability' = applicability
  ),
  CONSTRAINT canonical_knowledge_versions_canonical_check CHECK (
    octet_length(canonical_document) <= 65536
    AND canonical_document::jsonb = document
  ),
  CONSTRAINT canonical_knowledge_versions_digest_check CHECK (
    canonical_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_versions_parent_check CHECK (
    parent_version_id IS NULL OR parent_version_id <> id
  ),
  CONSTRAINT canonical_knowledge_versions_reason_check CHECK (
    length(reason) BETWEEN 1 AND 500
    AND length(btrim(reason)) >= 1
    AND octet_length(reason) <= 2000
    AND reason !~ '[[:cntrl:]]'
  )
);

CREATE INDEX canonical_knowledge_versions_entry_history
  ON canonical_knowledge_versions(organization_id, entry_id, version_number DESC, id);

CREATE INDEX canonical_knowledge_versions_digest
  ON canonical_knowledge_versions(organization_id, canonical_digest, id);

CREATE TABLE canonical_knowledge_provenance (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  version_id UUID NOT NULL,
  ordinal SMALLINT NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_record_id VARCHAR(512) NOT NULL,
  source_version VARCHAR(256) NOT NULL,
  source_digest CHAR(64) NOT NULL,
  json_pointer VARCHAR(2048) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_provenance_primary
    PRIMARY KEY (organization_id, version_id, ordinal),
  CONSTRAINT canonical_knowledge_provenance_version_fk
    FOREIGN KEY (organization_id, version_id)
    REFERENCES canonical_knowledge_versions(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_provenance_ordinal_check CHECK (ordinal BETWEEN 1 AND 1024),
  CONSTRAINT canonical_knowledge_provenance_source_type_check CHECK (
    source_type IN (
      'business_profile', 'service_catalogue', 'workforce', 'asset_catalogue',
      'policy_override', 'human_input', 'system_generation', 'imported_record'
    )
  ),
  CONSTRAINT canonical_knowledge_provenance_record_check CHECK (
    length(source_record_id) BETWEEN 1 AND 128
    AND octet_length(source_record_id) <= 512
    AND source_record_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT canonical_knowledge_provenance_version_check CHECK (
    length(source_version) BETWEEN 1 AND 64
    AND octet_length(source_version) <= 256
    AND source_version !~ '[[:cntrl:]]'
  ),
  CONSTRAINT canonical_knowledge_provenance_digest_check CHECK (
    source_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_provenance_pointer_check CHECK (
    (json_pointer = '' OR left(json_pointer, 1) = '/')
    AND length(json_pointer) <= 512
    AND octet_length(json_pointer) <= 2048
    AND json_pointer !~ '[[:cntrl:]]'
  )
);

CREATE INDEX canonical_knowledge_provenance_source
  ON canonical_knowledge_provenance(
    organization_id, source_type, source_record_id, source_version, version_id
  );

CREATE TABLE canonical_knowledge_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL,
  version_id UUID,
  actor_user_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL,
  reason VARCHAR(2000) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_audit_events_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_audit_events_entry_fk
    FOREIGN KEY (organization_id, entry_id)
    REFERENCES canonical_knowledge_entries(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_audit_events_version_fk
    FOREIGN KEY (organization_id, entry_id, version_id)
    REFERENCES canonical_knowledge_versions(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_audit_events_actor_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_audit_events_action_check CHECK (
    action ~ '^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$'
    AND length(action) <= 64
  ),
  CONSTRAINT canonical_knowledge_audit_events_reason_check CHECK (
    length(reason) BETWEEN 1 AND 500
    AND length(btrim(reason)) >= 1
    AND octet_length(reason) <= 2000
    AND reason !~ '[[:cntrl:]]'
  ),
  CONSTRAINT canonical_knowledge_audit_events_details_check CHECK (
    jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 8192
  )
);

CREATE INDEX canonical_knowledge_audit_events_tenant_time
  ON canonical_knowledge_audit_events(organization_id, created_at DESC, id);

CREATE OR REPLACE FUNCTION canonical_knowledge_reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Canonical knowledge authority is append-only: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER canonical_knowledge_entries_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();

CREATE TRIGGER canonical_knowledge_versions_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();

CREATE TRIGGER canonical_knowledge_provenance_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_provenance
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();

CREATE TRIGGER canonical_knowledge_audit_events_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_audit_events
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();
