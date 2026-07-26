-- Mission 19 Part 3 - additive canonical PostgreSQL persistence V2.
-- This migration intentionally does not alter or backfill legacy tables.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    graph_id UUID NOT NULL DEFAULT gen_random_uuid(),
    idempotency_key_hash CHAR(64) NOT NULL,
    payload_fingerprint CHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'claimed',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    lease_owner UUID NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    result_status INTEGER,
    result_body JSONB,
    safe_error_code VARCHAR(100),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_operations_key_unique UNIQUE (organization_id, idempotency_key_hash),
    CONSTRAINT canonical_operations_graph_unique UNIQUE (organization_id, graph_id),
    CONSTRAINT canonical_operations_identity_unique UNIQUE (organization_id, id, graph_id),
    CONSTRAINT canonical_operations_key_hash_format CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_operations_payload_hash_format CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_operations_state_check CHECK (state IN ('claimed', 'completed', 'retryable_failed', 'permanent_failed')),
    CONSTRAINT canonical_operations_attempt_check CHECK (attempt_count >= 1),
    CONSTRAINT canonical_operations_result_status_check CHECK (result_status IS NULL OR result_status BETWEEN 100 AND 599),
    CONSTRAINT canonical_operations_completed_check CHECK (
      state <> 'completed' OR (completed_at IS NOT NULL AND result_status IS NOT NULL AND result_body IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS canonical_customers (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    external_customer_id VARCHAR(255),
    name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(100),
    address JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_customers_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_customers_operation_unique UNIQUE (organization_id, operation_id),
    CONSTRAINT canonical_customers_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_customers_external_unique
  ON canonical_customers(organization_id, external_customer_id)
  WHERE external_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_transcripts (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    source VARCHAR(50) NOT NULL,
    source_version VARCHAR(100) NOT NULL,
    external_call_id VARCHAR(255),
    external_transcript_id VARCHAR(255),
    transcript_text TEXT NOT NULL,
    normalized_fingerprint CHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_transcripts_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_transcripts_operation_unique UNIQUE (organization_id, operation_id),
    CONSTRAINT canonical_transcripts_fingerprint_format CHECK (normalized_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_transcripts_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
    CONSTRAINT canonical_transcripts_customer_fk FOREIGN KEY (organization_id, customer_id)
      REFERENCES canonical_customers(organization_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_transcripts_external_call_unique
  ON canonical_transcripts(organization_id, external_call_id)
  WHERE external_call_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS canonical_transcripts_external_transcript_unique
  ON canonical_transcripts(organization_id, external_transcript_id)
  WHERE external_transcript_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_facts (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    transcript_id UUID NOT NULL,
    ordinal INTEGER NOT NULL,
    fact_type VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    evidence_text TEXT NOT NULL,
    speaker VARCHAR(50) NOT NULL,
    confidence NUMERIC(5,4),
    source_start INTEGER,
    source_end INTEGER,
    fact_fingerprint CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_facts_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_facts_ordinal_unique UNIQUE (organization_id, transcript_id, ordinal),
    CONSTRAINT canonical_facts_fingerprint_unique UNIQUE (organization_id, transcript_id, fact_fingerprint),
    CONSTRAINT canonical_facts_ordinal_check CHECK (ordinal >= 0),
    CONSTRAINT canonical_facts_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    CONSTRAINT canonical_facts_source_range_check CHECK (
      (source_start IS NULL AND source_end IS NULL) OR
      (source_start IS NOT NULL AND source_end IS NOT NULL AND source_start >= 0 AND source_end >= source_start)
    ),
    CONSTRAINT canonical_facts_fingerprint_format CHECK (fact_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_facts_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
    CONSTRAINT canonical_facts_transcript_fk FOREIGN KEY (organization_id, transcript_id)
      REFERENCES canonical_transcripts(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS canonical_communications (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    transcript_id UUID NOT NULL,
    external_communication_id VARCHAR(255),
    channel VARCHAR(50) NOT NULL,
    direction VARCHAR(20) NOT NULL,
    subject TEXT,
    body TEXT,
    duration_seconds INTEGER,
    occurred_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_communications_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_communications_operation_unique UNIQUE (organization_id, operation_id),
    CONSTRAINT canonical_communications_direction_check CHECK (direction IN ('inbound', 'outbound', 'internal')),
    CONSTRAINT canonical_communications_duration_check CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    CONSTRAINT canonical_communications_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
    CONSTRAINT canonical_communications_customer_fk FOREIGN KEY (organization_id, customer_id)
      REFERENCES canonical_customers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT canonical_communications_transcript_fk FOREIGN KEY (organization_id, transcript_id)
      REFERENCES canonical_transcripts(organization_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_communications_external_unique
  ON canonical_communications(organization_id, external_communication_id)
  WHERE external_communication_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_opportunities (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL,
    service_type VARCHAR(100),
    job_scope JSONB NOT NULL DEFAULT '{}',
    appointment_preference JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_opportunities_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_opportunities_operation_unique UNIQUE (organization_id, operation_id),
    CONSTRAINT canonical_opportunities_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
    CONSTRAINT canonical_opportunities_customer_fk FOREIGN KEY (organization_id, customer_id)
      REFERENCES canonical_customers(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS canonical_estimates (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    opportunity_id UUID NOT NULL,
    calculation_version VARCHAR(100) NOT NULL,
    normalized_input_fingerprint CHAR(64) NOT NULL,
    business_profile_version VARCHAR(100) NOT NULL,
    business_profile_hash CHAR(64) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    customer_price NUMERIC(14,2),
    line_items JSONB NOT NULL,
    calculation_output JSONB NOT NULL,
    snapshot_digest CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_estimates_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_estimates_operation_unique UNIQUE (organization_id, operation_id),
    CONSTRAINT canonical_estimates_input_hash_format CHECK (normalized_input_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_estimates_profile_hash_format CHECK (business_profile_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_estimates_digest_format CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_estimates_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
    CONSTRAINT canonical_estimates_opportunity_fk FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES canonical_opportunities(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS canonical_appointments (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    opportunity_id UUID NOT NULL,
    external_appointment_id VARCHAR(255),
    preference JSONB,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'preferred',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_appointments_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_appointments_operation_unique UNIQUE (organization_id, operation_id),
    CONSTRAINT canonical_appointments_schedule_check CHECK (
      scheduled_end IS NULL OR (scheduled_start IS NOT NULL AND scheduled_end >= scheduled_start)
    ),
    CONSTRAINT canonical_appointments_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
    CONSTRAINT canonical_appointments_opportunity_fk FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES canonical_opportunities(organization_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_appointments_external_unique
  ON canonical_appointments(organization_id, external_appointment_id)
  WHERE external_appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_polaris_snapshots (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    graph_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    transcript_id UUID NOT NULL,
    opportunity_id UUID NOT NULL,
    estimate_id UUID NOT NULL,
    calculation_version VARCHAR(100) NOT NULL,
    normalized_input_fingerprint CHAR(64) NOT NULL,
    business_profile_version VARCHAR(100) NOT NULL,
    business_profile_hash CHAR(64) NOT NULL,
    supporting_fact_ids UUID[] NOT NULL DEFAULT '{}',
    snapshot JSONB NOT NULL,
    snapshot_digest CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT canonical_polaris_tenant_identity UNIQUE (organization_id, id),
    CONSTRAINT canonical_polaris_operation_unique UNIQUE (organization_id, operation_id),
    CONSTRAINT canonical_polaris_input_hash_format CHECK (normalized_input_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_polaris_profile_hash_format CHECK (business_profile_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_polaris_digest_format CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT canonical_polaris_operation_fk FOREIGN KEY (organization_id, operation_id, graph_id)
      REFERENCES canonical_operations(organization_id, id, graph_id) ON DELETE RESTRICT,
    CONSTRAINT canonical_polaris_customer_fk FOREIGN KEY (organization_id, customer_id)
      REFERENCES canonical_customers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT canonical_polaris_transcript_fk FOREIGN KEY (organization_id, transcript_id)
      REFERENCES canonical_transcripts(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT canonical_polaris_opportunity_fk FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES canonical_opportunities(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT canonical_polaris_estimate_fk FOREIGN KEY (organization_id, estimate_id)
      REFERENCES canonical_estimates(organization_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION prevent_canonical_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'canonical snapshots are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS canonical_estimates_immutable ON canonical_estimates;
CREATE TRIGGER canonical_estimates_immutable
  BEFORE UPDATE OR DELETE ON canonical_estimates
  FOR EACH ROW EXECUTE FUNCTION prevent_canonical_snapshot_mutation();

DROP TRIGGER IF EXISTS canonical_polaris_snapshots_immutable ON canonical_polaris_snapshots;
CREATE TRIGGER canonical_polaris_snapshots_immutable
  BEFORE UPDATE OR DELETE ON canonical_polaris_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_canonical_snapshot_mutation();

COMMIT;
