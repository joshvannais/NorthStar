-- Mission 19 Part 3 - explicit server-provisioned demo organization authority.
-- Additive only: this migration intentionally creates no demo organization,
-- Business Profile, integration ownership, provider call, or production data.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_demo_authority (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_demo_authority_status_check CHECK (status IN ('active', 'inactive'))
);

COMMIT;
