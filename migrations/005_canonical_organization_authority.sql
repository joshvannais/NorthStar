-- Mission 19 Part 3 remediation - organization authority and strong identity.
-- Additive only: this migration intentionally performs no profile backfill,
-- customer merge, historical reassignment, or integration ownership inference.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_business_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    version_number BIGINT NOT NULL,
    version_label VARCHAR(100) NOT NULL,
    raw_profile JSONB NOT NULL,
    normalized_profile JSONB NOT NULL,
    normalized_profile_hash CHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    CONSTRAINT canonical_business_profiles_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_business_profiles_version_unique UNIQUE (organization_id, version_number),
    CONSTRAINT canonical_business_profiles_label_unique UNIQUE (organization_id, version_label),
    CONSTRAINT canonical_business_profiles_version_positive CHECK (version_number > 0),
    CONSTRAINT canonical_business_profiles_hash_format CHECK (normalized_profile_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_business_profiles_retirement_check CHECK (
      (is_active AND retired_at IS NULL) OR (NOT is_active AND retired_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_business_profiles_one_active
  ON canonical_business_profiles(organization_id)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS canonical_integration_ownership (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    provider VARCHAR(50) NOT NULL,
    external_integration_id VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_integration_ownership_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_integration_ownership_external_unique UNIQUE (provider, external_integration_id),
    CONSTRAINT canonical_integration_ownership_provider_check CHECK (provider IN ('retell', 'voice')),
    CONSTRAINT canonical_integration_ownership_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS canonical_integration_ownership_org_provider
  ON canonical_integration_ownership(organization_id, provider, status);

CREATE TABLE IF NOT EXISTS canonical_customer_identities (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    identity_type VARCHAR(32) NOT NULL,
    normalized_value VARCHAR(320) NOT NULL,
    customer_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_customer_identities_primary PRIMARY KEY
      (organization_id, identity_type, normalized_value),
    CONSTRAINT canonical_customer_identities_type_check CHECK
      (identity_type IN ('phone', 'email')),
    CONSTRAINT canonical_customer_identities_value_check CHECK
      (length(normalized_value) > 0),
    CONSTRAINT canonical_customer_identities_customer_fk FOREIGN KEY
      (organization_id, customer_id)
      REFERENCES canonical_customers(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS canonical_customer_identities_customer
  ON canonical_customer_identities(organization_id, customer_id);

ALTER TABLE canonical_estimates
  ADD COLUMN IF NOT EXISTS business_profile_id UUID;

ALTER TABLE canonical_estimates
  DROP CONSTRAINT IF EXISTS canonical_estimates_profile_authority_fk;
ALTER TABLE canonical_estimates
  ADD CONSTRAINT canonical_estimates_profile_authority_fk FOREIGN KEY
    (organization_id, business_profile_id)
    REFERENCES canonical_business_profiles(organization_id, id) ON DELETE RESTRICT;

ALTER TABLE canonical_polaris_snapshots
  ADD COLUMN IF NOT EXISTS business_profile_id UUID;

ALTER TABLE canonical_polaris_snapshots
  DROP CONSTRAINT IF EXISTS canonical_polaris_profile_authority_fk;
ALTER TABLE canonical_polaris_snapshots
  ADD CONSTRAINT canonical_polaris_profile_authority_fk FOREIGN KEY
    (organization_id, business_profile_id)
    REFERENCES canonical_business_profiles(organization_id, id) ON DELETE RESTRICT;

COMMIT;
