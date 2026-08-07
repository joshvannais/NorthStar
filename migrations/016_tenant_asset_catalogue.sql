-- Mission 20 Part 2F - normalized tenant asset catalogue identity authority.
-- Additive only: this catalogue intentionally excludes assignments, live location,
-- availability, meters, condition, maintenance, faults, downtime, telematics,
-- provider mappings/synchronization, and asset costs.

CREATE TABLE tenant_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  category VARCHAR(16) NOT NULL,
  name VARCHAR(480) NOT NULL,
  internal_reference VARCHAR(480) NOT NULL DEFAULT '',
  manufacturer VARCHAR(480) NOT NULL DEFAULT '',
  model VARCHAR(480) NOT NULL DEFAULT '',
  model_year INTEGER,
  configuration TEXT NOT NULL DEFAULT '',
  serial_number VARCHAR(480) NOT NULL DEFAULT '',
  vin VARCHAR(480) NOT NULL DEFAULT '',
  home_location_id VARCHAR(64),
  catalogue_state VARCHAR(16) NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID NOT NULL,
  archived_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT tenant_assets_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT tenant_assets_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_assets_updated_by_fk FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_assets_archived_by_fk FOREIGN KEY (organization_id, archived_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_assets_category_check CHECK (
    category IN ('vehicle', 'equipment', 'tool', 'trailer', 'attachment', 'other')
  ),
  CONSTRAINT tenant_assets_name_check CHECK (
    length(name) BETWEEN 1 AND 120 AND length(btrim(name)) >= 1 AND octet_length(name) <= 480
  ),
  CONSTRAINT tenant_assets_reference_check CHECK (
    length(internal_reference) <= 120 AND octet_length(internal_reference) <= 480
  ),
  CONSTRAINT tenant_assets_manufacturer_check CHECK (
    length(manufacturer) <= 120 AND octet_length(manufacturer) <= 480
  ),
  CONSTRAINT tenant_assets_model_check CHECK (
    length(model) <= 120 AND octet_length(model) <= 480
  ),
  CONSTRAINT tenant_assets_model_year_check CHECK (
    model_year IS NULL OR model_year BETWEEN 1800 AND 3000
  ),
  CONSTRAINT tenant_assets_configuration_check CHECK (
    length(configuration) <= 1024 AND octet_length(configuration) <= 4096
  ),
  CONSTRAINT tenant_assets_serial_check CHECK (
    length(serial_number) <= 120 AND octet_length(serial_number) <= 480
  ),
  CONSTRAINT tenant_assets_vin_check CHECK (
    length(vin) <= 120 AND octet_length(vin) <= 480
  ),
  CONSTRAINT tenant_assets_location_check CHECK (
    home_location_id IS NULL OR home_location_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  ),
  CONSTRAINT tenant_assets_state_check CHECK (catalogue_state IN ('active', 'archived')),
  CONSTRAINT tenant_assets_version_check CHECK (version >= 1),
  CONSTRAINT tenant_assets_archive_terminal_check CHECK (
    catalogue_state NOT IN ('active', 'archived')
    OR (catalogue_state = 'active' AND archived_by_user_id IS NULL AND archived_at IS NULL)
    OR (catalogue_state = 'archived' AND archived_by_user_id IS NOT NULL AND archived_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX tenant_assets_internal_reference_unique
  ON tenant_assets(organization_id, lower(btrim(internal_reference)))
  WHERE btrim(internal_reference) <> '';

CREATE UNIQUE INDEX tenant_assets_vin_unique
  ON tenant_assets(organization_id, lower(btrim(vin)))
  WHERE btrim(vin) <> '';

CREATE INDEX tenant_assets_organization_catalogue
  ON tenant_assets(organization_id, catalogue_state, lower(name), id);

CREATE TABLE tenant_asset_service_capabilities (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL,
  service_id VARCHAR(64) NOT NULL,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_asset_service_capabilities_primary
    PRIMARY KEY (organization_id, asset_id, service_id),
  CONSTRAINT tenant_asset_service_capabilities_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES tenant_assets(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT tenant_asset_service_capabilities_created_by_fk
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_asset_service_capabilities_service_check CHECK (
    service_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  )
);

CREATE INDEX tenant_asset_service_capabilities_service
  ON tenant_asset_service_capabilities(organization_id, service_id, asset_id);

CREATE TABLE tenant_asset_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  action VARCHAR(32) NOT NULL,
  subject_id UUID NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_asset_audit_events_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT tenant_asset_audit_events_actor_fk FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_asset_audit_events_subject_fk FOREIGN KEY (organization_id, subject_id)
    REFERENCES tenant_assets(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT tenant_asset_audit_events_action_check CHECK (
    action IN ('asset_created', 'asset_updated', 'asset_archived', 'asset_restored')
  ),
  CONSTRAINT tenant_asset_audit_events_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX tenant_asset_audit_events_organization_time
  ON tenant_asset_audit_events(organization_id, created_at DESC, id);
