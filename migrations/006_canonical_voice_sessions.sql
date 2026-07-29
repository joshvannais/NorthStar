-- Mission 19 Part 3 - durable organization-scoped voice session authority.
-- Additive only: historical voice rows are intentionally not inferred or backfilled.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS canonical_operations_tenant_identity
  ON canonical_operations(organization_id, id);

CREATE TABLE IF NOT EXISTS canonical_voice_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    external_session_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    integration_ownership_id UUID NOT NULL,
    business_profile_id UUID NOT NULL,
    business_profile_version VARCHAR(100) NOT NULL,
    business_profile_hash CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    direction VARCHAR(16) NOT NULL DEFAULT 'inbound',
    from_number VARCHAR(64),
    to_number VARCHAR(64),
    runtime_owner_id VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    summary JSONB,
    canonical_operation_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_voice_sessions_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_voice_sessions_external_unique UNIQUE (organization_id, external_session_id),
    CONSTRAINT canonical_voice_sessions_integration_fk FOREIGN KEY (organization_id, integration_ownership_id)
      REFERENCES canonical_integration_ownership(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT canonical_voice_sessions_profile_fk FOREIGN KEY (organization_id, business_profile_id)
      REFERENCES canonical_business_profiles(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT canonical_voice_sessions_operation_fk FOREIGN KEY (organization_id, canonical_operation_id)
      REFERENCES canonical_operations(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT canonical_voice_sessions_provider_check CHECK (provider IN ('retell', 'voice')),
    CONSTRAINT canonical_voice_sessions_status_check CHECK (status IN ('active', 'escalating', 'completed', 'cancelled', 'failed')),
    CONSTRAINT canonical_voice_sessions_direction_check CHECK (direction IN ('inbound', 'outbound')),
    CONSTRAINT canonical_voice_sessions_hash_format CHECK (business_profile_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_voice_sessions_completion_check CHECK (
      (status IN ('completed', 'cancelled', 'failed') AND completed_at IS NOT NULL)
      OR (status IN ('active', 'escalating') AND completed_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS canonical_voice_sessions_org_status
  ON canonical_voice_sessions(organization_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS canonical_voice_session_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    voice_session_id UUID NOT NULL,
    external_event_id VARCHAR(255),
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_voice_session_events_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_voice_session_events_session_fk FOREIGN KEY (organization_id, voice_session_id)
      REFERENCES canonical_voice_sessions(organization_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_voice_session_events_external_unique
  ON canonical_voice_session_events(organization_id, voice_session_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS canonical_voice_session_events_timeline
  ON canonical_voice_session_events(organization_id, voice_session_id, occurred_at, created_at);

COMMIT;
