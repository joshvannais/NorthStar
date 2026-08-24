-- Mission 21 Part 6 - provider-neutral transactional synchronization authority.
-- This migration stores no credential and performs no provider or network call.

CREATE TABLE public.canonical_knowledge_sync_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_key VARCHAR(64) NOT NULL,
  consumer VARCHAR(32) NOT NULL,
  audience VARCHAR(24) NOT NULL,
  capabilities JSONB NOT NULL,
  maximum_entries SMALLINT NOT NULL,
  maximum_bytes INTEGER NOT NULL,
  stale_after_seconds INTEGER NOT NULL DEFAULT 86400,
  target_revision INTEGER NOT NULL DEFAULT 1,
  configuration_digest CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_sync_targets_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_sync_targets_identity_unique
    UNIQUE (organization_id, provider_key, consumer, audience),
  CONSTRAINT canonical_knowledge_sync_targets_created_actor_fk
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_targets_updated_actor_fk
    FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_targets_provider_check CHECK (
    provider_key ~ '^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$'
    AND length(provider_key) BETWEEN 1 AND 64
    AND octet_length(provider_key) <= 64
  ),
  CONSTRAINT canonical_knowledge_sync_targets_consumer_check CHECK (
    consumer IN ('voice_runtime', 'integration_adapter')
  ),
  CONSTRAINT canonical_knowledge_sync_targets_audience_check CHECK (
    audience IN ('customer', 'internal', 'workforce')
  ),
  CONSTRAINT canonical_knowledge_sync_targets_capabilities_check CHECK (
    jsonb_typeof(capabilities) = 'array'
    AND jsonb_array_length(capabilities) BETWEEN 1 AND 7
    AND octet_length(capabilities::text) <= 256
  ),
  CONSTRAINT canonical_knowledge_sync_targets_limits_check CHECK (
    maximum_entries BETWEEN 1 AND 64
    AND maximum_bytes BETWEEN 1024 AND 262144
    AND stale_after_seconds BETWEEN 300 AND 604800
  ),
  CONSTRAINT canonical_knowledge_sync_targets_revision_check CHECK (target_revision >= 1),
  CONSTRAINT canonical_knowledge_sync_targets_digest_check CHECK (
    configuration_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_sync_targets_status_check CHECK (
    status IN ('active', 'suspended')
  )
);

CREATE INDEX canonical_knowledge_sync_targets_active
  ON public.canonical_knowledge_sync_targets(
    organization_id, provider_key, consumer, audience, id
  ) WHERE status = 'active';

CREATE TABLE public.canonical_knowledge_sync_sequences (
  organization_id UUID NOT NULL,
  target_id UUID NOT NULL,
  next_sequence BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT canonical_knowledge_sync_sequences_primary
    PRIMARY KEY (organization_id, target_id),
  CONSTRAINT canonical_knowledge_sync_sequences_target_fk
    FOREIGN KEY (organization_id, target_id)
    REFERENCES public.canonical_knowledge_sync_targets(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_sequences_value_check CHECK (next_sequence >= 1)
);

CREATE TABLE public.canonical_knowledge_sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  target_id UUID NOT NULL,
  target_revision INTEGER NOT NULL,
  target_sequence BIGINT NOT NULL,
  configuration_digest CHAR(64) NOT NULL,
  provider_key VARCHAR(64) NOT NULL,
  consumer VARCHAR(32) NOT NULL,
  audience VARCHAR(24) NOT NULL,
  capabilities JSONB NOT NULL,
  maximum_entries SMALLINT NOT NULL,
  maximum_bytes INTEGER NOT NULL,
  trigger_type VARCHAR(24) NOT NULL,
  trigger_publication_id UUID,
  trigger_entry_id UUID,
  trigger_version_id UUID,
  trigger_canonical_digest CHAR(64),
  source_pins JSONB NOT NULL,
  desired_projection JSONB,
  canonical_projection TEXT,
  projection_digest CHAR(64),
  idempotency_key CHAR(64) NOT NULL,
  state VARCHAR(16) NOT NULL,
  reconciliation_generation INTEGER NOT NULL DEFAULT 1,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  observed_projection_digest CHAR(64),
  diagnostic_category VARCHAR(64),
  succeeded_at TIMESTAMPTZ,
  dead_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_sync_outbox_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_sync_outbox_target_identity
    UNIQUE (organization_id, target_id, id),
  CONSTRAINT canonical_knowledge_sync_outbox_target_sequence_unique
    UNIQUE (organization_id, target_id, target_sequence),
  CONSTRAINT canonical_knowledge_sync_outbox_idempotency_unique
    UNIQUE (organization_id, target_id, idempotency_key),
  CONSTRAINT canonical_knowledge_sync_outbox_target_fk
    FOREIGN KEY (organization_id, target_id)
    REFERENCES public.canonical_knowledge_sync_targets(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_outbox_trigger_publication_fk
    FOREIGN KEY (organization_id, trigger_entry_id, trigger_publication_id)
    REFERENCES public.canonical_knowledge_publications(organization_id, entry_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_outbox_trigger_version_fk
    FOREIGN KEY (organization_id, trigger_entry_id, trigger_version_id)
    REFERENCES public.canonical_knowledge_versions(organization_id, entry_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_outbox_target_revision_check CHECK (target_revision >= 1),
  CONSTRAINT canonical_knowledge_sync_outbox_target_sequence_check CHECK (target_sequence >= 1),
  CONSTRAINT canonical_knowledge_sync_outbox_configuration_digest_check CHECK (
    configuration_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_provider_check CHECK (
    provider_key ~ '^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$'
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_consumer_check CHECK (
    consumer IN ('voice_runtime', 'integration_adapter')
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_audience_check CHECK (
    audience IN ('customer', 'internal', 'workforce')
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_capabilities_check CHECK (
    jsonb_typeof(capabilities) = 'array'
    AND jsonb_array_length(capabilities) BETWEEN 1 AND 7
    AND octet_length(capabilities::text) <= 256
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_limits_check CHECK (
    maximum_entries BETWEEN 1 AND 64 AND maximum_bytes BETWEEN 1024 AND 262144
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_trigger_type_check CHECK (
    trigger_type IN ('publication', 'target_config', 'reconciliation', 'drift', 'staleness')
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_trigger_shape_check CHECK (
    (trigger_type = 'publication'
      AND trigger_publication_id IS NOT NULL
      AND trigger_entry_id IS NOT NULL
      AND trigger_version_id IS NOT NULL
      AND trigger_canonical_digest ~ '^[0-9a-f]{64}$')
    OR
    (trigger_type <> 'publication'
      AND trigger_publication_id IS NULL
      AND trigger_entry_id IS NULL
      AND trigger_version_id IS NULL
      AND trigger_canonical_digest IS NULL)
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_source_pins_check CHECK (
    jsonb_typeof(source_pins) = 'array'
    AND jsonb_array_length(source_pins) BETWEEN 0 AND 64
    AND octet_length(source_pins::text) <= 32768
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_projection_check CHECK ((
    (desired_projection IS NULL
      AND canonical_projection IS NULL
      AND projection_digest IS NULL)
    OR
    (jsonb_typeof(desired_projection) = 'object'
      AND octet_length(desired_projection::text) <= 262144
      AND octet_length(canonical_projection) <= 262144
      AND canonical_projection::jsonb = desired_projection
      AND canonical_projection = public.canonical_knowledge_render_jsonb(desired_projection)
      AND projection_digest ~ '^[0-9a-f]{64}$'
      AND encode(sha256(convert_to(canonical_projection, 'UTF8')), 'hex') = projection_digest)
  ) IS TRUE),
  CONSTRAINT canonical_knowledge_sync_outbox_idempotency_check CHECK (
    idempotency_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_state_check CHECK (
    state IN ('pending', 'claimed', 'retry', 'succeeded', 'dead', 'blocked')
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_attempt_check CHECK (
    reconciliation_generation BETWEEN 1 AND 1000 AND attempt_count BETWEEN 0 AND 5
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_observed_digest_check CHECK (
    observed_projection_digest IS NULL OR observed_projection_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_diagnostic_check CHECK (
    diagnostic_category IS NULL OR diagnostic_category ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT canonical_knowledge_sync_outbox_lifecycle_check CHECK (
    (state IN ('pending', 'retry')
      AND desired_projection IS NOT NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND succeeded_at IS NULL AND dead_at IS NULL AND blocked_at IS NULL)
    OR
    (state = 'claimed'
      AND desired_projection IS NOT NULL
      AND claim_token IS NOT NULL AND claimed_at IS NOT NULL
      AND lease_expires_at > claimed_at
      AND succeeded_at IS NULL AND dead_at IS NULL AND blocked_at IS NULL)
    OR
    (state = 'succeeded'
      AND desired_projection IS NOT NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND observed_projection_digest = projection_digest
      AND succeeded_at IS NOT NULL AND dead_at IS NULL AND blocked_at IS NULL)
    OR
    (state = 'dead'
      AND desired_projection IS NOT NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND succeeded_at IS NULL AND dead_at IS NOT NULL AND blocked_at IS NULL
      AND diagnostic_category IS NOT NULL)
    OR
    (state = 'blocked'
      AND desired_projection IS NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND succeeded_at IS NULL AND dead_at IS NULL AND blocked_at IS NOT NULL
      AND diagnostic_category IS NOT NULL)
  )
);

CREATE INDEX canonical_knowledge_sync_outbox_available
  ON public.canonical_knowledge_sync_outbox(
    available_at, organization_id, target_id, target_sequence, id
  ) WHERE state IN ('pending', 'retry');

CREATE INDEX canonical_knowledge_sync_outbox_expired_claims
  ON public.canonical_knowledge_sync_outbox(lease_expires_at, organization_id, target_id, id)
  WHERE state = 'claimed';

CREATE INDEX canonical_knowledge_sync_outbox_target_history
  ON public.canonical_knowledge_sync_outbox(
    organization_id, target_id, target_sequence DESC, id
  );

CREATE TABLE public.canonical_knowledge_sync_states (
  organization_id UUID NOT NULL,
  target_id UUID NOT NULL,
  desired_event_id UUID,
  desired_sequence BIGINT,
  desired_projection_digest CHAR(64),
  observed_event_id UUID,
  observed_sequence BIGINT,
  observed_projection_digest CHAR(64),
  last_known_good_event_id UUID,
  last_known_good_sequence BIGINT,
  last_known_good_projection_digest CHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'blocked',
  diagnostic_category VARCHAR(64),
  drift_detected_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_sync_states_primary
    PRIMARY KEY (organization_id, target_id),
  CONSTRAINT canonical_knowledge_sync_states_target_fk
    FOREIGN KEY (organization_id, target_id)
    REFERENCES public.canonical_knowledge_sync_targets(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_states_desired_event_fk
    FOREIGN KEY (organization_id, target_id, desired_event_id)
    REFERENCES public.canonical_knowledge_sync_outbox(organization_id, target_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_knowledge_sync_states_observed_event_fk
    FOREIGN KEY (organization_id, target_id, observed_event_id)
    REFERENCES public.canonical_knowledge_sync_outbox(organization_id, target_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_knowledge_sync_states_lkg_event_fk
    FOREIGN KEY (organization_id, target_id, last_known_good_event_id)
    REFERENCES public.canonical_knowledge_sync_outbox(organization_id, target_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_knowledge_sync_states_sequence_check CHECK (
    (desired_event_id IS NULL) = (desired_sequence IS NULL)
    AND (observed_event_id IS NULL) = (observed_sequence IS NULL)
    AND (last_known_good_event_id IS NULL) = (last_known_good_sequence IS NULL)
    AND (desired_sequence IS NULL OR desired_sequence >= 1)
    AND (observed_sequence IS NULL OR observed_sequence >= 1)
    AND (last_known_good_sequence IS NULL OR last_known_good_sequence >= 1)
  ),
  CONSTRAINT canonical_knowledge_sync_states_digest_check CHECK (
    (desired_projection_digest IS NULL OR desired_projection_digest ~ '^[0-9a-f]{64}$')
    AND (observed_projection_digest IS NULL OR observed_projection_digest ~ '^[0-9a-f]{64}$')
    AND (last_known_good_projection_digest IS NULL
      OR last_known_good_projection_digest ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT canonical_knowledge_sync_states_status_check CHECK (
    status IN ('blocked', 'pending', 'retry', 'in_sync', 'dead', 'drift', 'stale', 'suspended')
  ),
  CONSTRAINT canonical_knowledge_sync_states_diagnostic_check CHECK (
    diagnostic_category IS NULL OR diagnostic_category ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT canonical_knowledge_sync_states_lkg_shape_check CHECK (
    (last_known_good_event_id IS NULL
      AND last_known_good_sequence IS NULL
      AND last_known_good_projection_digest IS NULL)
    OR
    (last_known_good_event_id IS NOT NULL
      AND last_known_good_sequence IS NOT NULL
      AND last_known_good_projection_digest ~ '^[0-9a-f]{64}$')
  )
);

CREATE INDEX canonical_knowledge_sync_states_reconciliation
  ON public.canonical_knowledge_sync_states(status, updated_at, organization_id, target_id)
  WHERE status IN ('dead', 'drift', 'stale', 'retry', 'blocked');

CREATE TABLE public.canonical_knowledge_sync_attempts (
  organization_id UUID NOT NULL,
  target_id UUID NOT NULL,
  outbox_id UUID NOT NULL,
  reconciliation_generation INTEGER NOT NULL,
  attempt_number SMALLINT NOT NULL,
  claim_token UUID NOT NULL,
  idempotency_key CHAR(64) NOT NULL,
  outcome VARCHAR(24),
  diagnostic_category VARCHAR(64),
  observed_projection_digest CHAR(64),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT canonical_knowledge_sync_attempts_primary
    PRIMARY KEY (
      organization_id, target_id, outbox_id,
      reconciliation_generation, attempt_number
    ),
  CONSTRAINT canonical_knowledge_sync_attempts_claim_unique UNIQUE (claim_token),
  CONSTRAINT canonical_knowledge_sync_attempts_outbox_fk
    FOREIGN KEY (organization_id, target_id, outbox_id)
    REFERENCES public.canonical_knowledge_sync_outbox(organization_id, target_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_sync_attempts_count_check CHECK (
    reconciliation_generation BETWEEN 1 AND 1000 AND attempt_number BETWEEN 1 AND 5
  ),
  CONSTRAINT canonical_knowledge_sync_attempts_idempotency_check CHECK (
    idempotency_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_sync_attempts_outcome_check CHECK (
    outcome IS NULL OR outcome IN (
      'succeeded', 'retry', 'dead', 'claim_expired', 'ownership_lost', 'drift'
    )
  ),
  CONSTRAINT canonical_knowledge_sync_attempts_diagnostic_check CHECK (
    diagnostic_category IS NULL OR diagnostic_category ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT canonical_knowledge_sync_attempts_observed_check CHECK (
    observed_projection_digest IS NULL OR observed_projection_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_sync_attempts_lifecycle_check CHECK (
    (outcome IS NULL AND completed_at IS NULL
      AND diagnostic_category IS NULL AND observed_projection_digest IS NULL)
    OR
    (outcome IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX canonical_knowledge_sync_attempts_history
  ON public.canonical_knowledge_sync_attempts(
    organization_id, target_id, outbox_id,
    reconciliation_generation DESC, attempt_number DESC
  );

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_configuration_document(
  provider_value TEXT,
  consumer_value TEXT,
  audience_value TEXT,
  capabilities_value JSONB,
  maximum_entries_value INTEGER,
  maximum_bytes_value INTEGER,
  stale_after_seconds_value INTEGER,
  revision_value INTEGER,
  status_value TEXT
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'audience', audience_value,
    'capabilities', capabilities_value,
    'consumer', consumer_value,
    'maximumBytes', maximum_bytes_value,
    'maximumEntries', maximum_entries_value,
    'providerKey', provider_value,
    'revision', revision_value,
    'staleAfterSeconds', stale_after_seconds_value,
    'status', status_value
  );
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_target()
RETURNS TRIGGER AS $$
DECLARE
  sorted_capabilities JSONB;
  capability_count INTEGER;
  distinct_capability_count INTEGER;
  expected_digest TEXT;
BEGIN
  SELECT jsonb_agg(capability.value ORDER BY capability.value COLLATE "C"),
         count(*), count(DISTINCT capability.value)
    INTO sorted_capabilities, capability_count, distinct_capability_count
    FROM jsonb_array_elements_text(NEW.capabilities) AS capability(value);

  IF capability_count IS NULL
     OR capability_count <> distinct_capability_count
     OR NEW.capabilities IS DISTINCT FROM sorted_capabilities
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(NEW.capabilities) capability(value)
        WHERE capability.value NOT IN (
          'availability', 'customer_guidance', 'financial_constraints', 'identity',
          'operational_capabilities', 'services', 'voice_guidance'
        )
     ) THEN
    RAISE EXCEPTION 'Knowledge synchronization capabilities are invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_targets_capabilities_canonical';
  END IF;

  IF NEW.consumer = 'voice_runtime' AND (
       NEW.audience <> 'customer'
       OR NEW.maximum_entries > 16
       OR NEW.maximum_bytes > 65536
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(NEW.capabilities) capability(value)
          WHERE capability.value NOT IN (
            'availability', 'customer_guidance', 'identity', 'services', 'voice_guidance'
          )
       )
     ) THEN
    RAISE EXCEPTION 'Voice synchronization target is outside its projection contract'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_targets_voice_contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships membership
     WHERE membership.organization_id = NEW.organization_id
       AND membership.user_id = NEW.updated_by_user_id
       AND membership.status = 'active'
       AND membership.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Active owner or administrator membership is required'
      USING ERRCODE = '42501',
            CONSTRAINT = 'canonical_knowledge_sync_targets_actor_required';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := statement_timestamp();
    NEW.updated_at := NEW.created_at;
    IF NEW.target_revision <> 1 OR NEW.created_by_user_id <> NEW.updated_by_user_id THEN
      RAISE EXCEPTION 'Initial synchronization target revision is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_targets_initial_revision';
    END IF;
  ELSE
    IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
       OR NEW.created_by_user_id <> OLD.created_by_user_id
       OR NEW.created_at <> OLD.created_at
       OR NEW.target_revision <> OLD.target_revision + 1 THEN
      RAISE EXCEPTION 'Synchronization target identity or revision is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_targets_revision_transition';
    END IF;
    NEW.updated_at := statement_timestamp();
  END IF;

  expected_digest := encode(sha256(convert_to(
    public.canonical_knowledge_render_jsonb(
      public.canonical_knowledge_sync_configuration_document(
        NEW.provider_key, NEW.consumer, NEW.audience, NEW.capabilities,
        NEW.maximum_entries, NEW.maximum_bytes, NEW.stale_after_seconds,
        NEW.target_revision, NEW.status
      )
    ), 'UTF8'
  )), 'hex');
  IF rtrim(NEW.configuration_digest) <> expected_digest THEN
    RAISE EXCEPTION 'Synchronization target configuration digest is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_targets_configuration_digest';
  END IF;
  IF TG_OP = 'UPDATE' AND rtrim(NEW.configuration_digest) = rtrim(OLD.configuration_digest) THEN
    RAISE EXCEPTION 'Synchronization target revision must change configuration'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_targets_revision_no_change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_initialize_sync_target()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.canonical_knowledge_sync_sequences(organization_id, target_id)
  VALUES (NEW.organization_id, NEW.id);
  INSERT INTO public.canonical_knowledge_sync_states(
    organization_id, target_id, status, diagnostic_category, updated_at
  ) VALUES (
    NEW.organization_id, NEW.id,
    CASE WHEN NEW.status = 'active' THEN 'blocked' ELSE 'suspended' END,
    CASE WHEN NEW.status = 'active' THEN 'projection_unavailable' ELSE 'target_suspended' END,
    statement_timestamp()
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_reject_sync_target_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Synchronization targets are retained for ordered evidence'
    USING ERRCODE = '55000',
          CONSTRAINT = 'canonical_knowledge_sync_targets_no_delete';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_pick_fields(
  source_value JSONB,
  allowed_fields TEXT[]
) RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(source_value) = 'object' THEN source_value ELSE '{}'::jsonb END
    ) AS field(key, value)
   WHERE field.key = ANY(allowed_fields);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_customer_content(
  canonical_key_value TEXT,
  document_value JSONB
) RETURNS JSONB AS $$
DECLARE
  facts_value JSONB := document_value->'content'->'facts';
  services_value JSONB;
BEGIN
  IF jsonb_typeof(document_value->'content') <> 'object'
     OR jsonb_typeof(facts_value) <> 'object' THEN
    RAISE EXCEPTION 'Published knowledge does not satisfy its projection shape'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_projection_content_shape';
  END IF;
  IF canonical_key_value = 'organization.identity' THEN
    RETURN public.canonical_knowledge_sync_pick_fields(
      facts_value, ARRAY['businessDescription', 'industry']
    ) || jsonb_build_object(
      'company', public.canonical_knowledge_sync_pick_fields(
        facts_value->'company', ARRAY['dba', 'name', 'phone', 'website']
      )
    );
  ELSIF canonical_key_value = 'organization.availability' THEN
    RETURN public.canonical_knowledge_sync_pick_fields(facts_value, ARRAY['hours']) ||
      jsonb_build_object(
        'serviceArea', public.canonical_knowledge_sync_pick_fields(
          facts_value->'serviceArea',
          ARRAY['maxRadiusMiles', 'maxTravelMinutes', 'primaryTerritory']
        )
      );
  ELSIF canonical_key_value = 'organization.services' THEN
    SELECT COALESCE(jsonb_agg(
             public.canonical_knowledge_sync_pick_fields(
               service.value,
               ARRAY['active', 'category', 'description', 'id', 'name']
             ) ORDER BY service.ordinality
           ), '[]'::jsonb)
      INTO services_value
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(facts_value->'services') = 'array'
          THEN facts_value->'services' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS service(value, ordinality)
     WHERE jsonb_typeof(service.value) = 'object';
    RETURN jsonb_build_object('services', services_value);
  ELSIF canonical_key_value = 'organization.customer-guidance' THEN
    RETURN public.canonical_knowledge_sync_pick_fields(
      facts_value, ARRAY['companyValues', 'emergencyPolicy', 'faq', 'policies']
    );
  ELSIF canonical_key_value = 'organization.voice-guidance' THEN
    RETURN jsonb_build_object(
      'voiceAssistant', public.canonical_knowledge_sync_pick_fields(
        facts_value->'voiceAssistant',
        ARRAY['conversationStyle', 'greeting', 'name', 'personality', 'style']
      )
    );
  END IF;
  RAISE EXCEPTION 'Requested customer capability is not allowed'
    USING ERRCODE = '23514',
          CONSTRAINT = 'canonical_knowledge_sync_projection_customer_capability';
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_applicability_allows(
  document_value JSONB,
  consumer_value TEXT,
  audience_value TEXT,
  capability_value TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  projection_value JSONB := document_value->'applicability'->'projection';
  field_name TEXT;
  field_value JSONB;
  expected_value TEXT;
  allowed_values TEXT[];
  item_count INTEGER;
  distinct_count INTEGER;
BEGIN
  IF projection_value IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(projection_value) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(projection_value) AS key(value)
        WHERE key.value NOT IN ('audiences', 'capabilities', 'consumers')
     ) THEN
    RAISE EXCEPTION 'Published projection applicability is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_projection_applicability';
  END IF;
  FOR field_name, expected_value, allowed_values IN
    VALUES
      ('audiences', audience_value, ARRAY['customer', 'internal', 'workforce']::text[]),
      ('capabilities', capability_value, ARRAY[
        'availability', 'customer_guidance', 'financial_constraints', 'identity',
        'operational_capabilities', 'services', 'voice_guidance'
      ]::text[]),
      ('consumers', consumer_value, ARRAY[
        'integration_adapter', 'northstar_assistant', 'northstar_search', 'voice_runtime'
      ]::text[])
  LOOP
    field_value := projection_value->field_name;
    IF field_value IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(field_value) <> 'array' THEN
      RAISE EXCEPTION 'Published projection applicability is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_projection_applicability';
    END IF;
    SELECT count(*), count(DISTINCT item.value)
      INTO item_count, distinct_count
      FROM jsonb_array_elements_text(field_value) AS item(value);
    IF item_count > cardinality(allowed_values) OR item_count <> distinct_count
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(field_value) AS item(value)
          WHERE jsonb_typeof(item.value) <> 'string'
             OR trim(both '"' from item.value::text) <> ALL(allowed_values)
       ) THEN
      RAISE EXCEPTION 'Published projection applicability is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_projection_applicability';
    END IF;
    IF NOT field_value ? expected_value THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_expected_projection(
  organization_id_value UUID,
  consumer_value TEXT,
  audience_value TEXT,
  capabilities_value JSONB,
  maximum_entries_value INTEGER,
  maximum_bytes_value INTEGER,
  source_mode_value TEXT,
  source_pins_value JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB AS $$
DECLARE
  source_record RECORD;
  capability_value TEXT;
  fixed_capability TEXT;
  projection_value JSONB;
  document_value JSONB;
  item_value JSONB;
  source_value JSONB;
  candidate_value JSONB;
  candidates JSONB := '[]'::jsonb;
  items_value JSONB := '[]'::jsonb;
  sources_value JSONB := '[]'::jsonb;
  missing_value JSONB := '[]'::jsonb;
  expected_value JSONB;
  source_index INTEGER;
  source_count INTEGER := 0;
  candidate_count INTEGER := 0;
  maximum_candidates INTEGER := CASE consumer_value WHEN 'voice_runtime' THEN 16 ELSE 64 END;
BEGIN
  IF source_mode_value NOT IN ('latest', 'pins')
     OR jsonb_typeof(capabilities_value) <> 'array'
     OR jsonb_typeof(source_pins_value) <> 'array' THEN
    RAISE EXCEPTION 'Synchronization projection authority request is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_projection_authority_request';
  END IF;

  FOR source_record IN
    WITH latest_publications AS (
      SELECT DISTINCT ON (publication.entry_id) publication.*
        FROM public.canonical_knowledge_publications publication
       WHERE publication.organization_id = organization_id_value
       ORDER BY publication.entry_id, publication.publication_number DESC, publication.id
    ), selected AS (
      SELECT entry.id AS entry_id, entry.canonical_key, entry.entry_type,
             version.id AS version_id, version.version_number, version.label,
             version.sensitivity, version.review_requirement, version.applicability,
             version.document, version.canonical_digest,
             publication.id AS publication_id, publication.publication_number,
             publication.canonical_digest AS publication_digest
        FROM latest_publications publication
        JOIN public.canonical_knowledge_entries entry
          ON entry.organization_id = publication.organization_id
         AND entry.id = publication.entry_id
        JOIN public.canonical_knowledge_versions version
          ON version.organization_id = publication.organization_id
         AND version.entry_id = publication.entry_id AND version.id = publication.version_id
       WHERE source_mode_value = 'latest'
         AND (
           entry.canonical_key = ANY(ARRAY[
             CASE WHEN capabilities_value ? 'availability'
               THEN 'organization.availability' END,
             CASE WHEN capabilities_value ? 'customer_guidance'
               THEN 'organization.customer-guidance' END,
             CASE WHEN capabilities_value ? 'financial_constraints'
               THEN 'organization.financial-constraints' END,
             CASE WHEN capabilities_value ? 'identity'
               THEN 'organization.identity' END,
             CASE WHEN capabilities_value ? 'operational_capabilities'
               THEN 'organization.operational-capabilities' END,
             CASE WHEN capabilities_value ? 'services'
               THEN 'organization.services' END,
             CASE WHEN capabilities_value ? 'voice_guidance'
               THEN 'organization.voice-guidance' END
           ]::text[])
           OR (
             audience_value <> 'customer'
             AND jsonb_typeof(version.applicability->'projection'->'capabilities') = 'array'
             AND (version.applicability->'projection'->'capabilities') ?|
               ARRAY(SELECT value FROM jsonb_array_elements_text(capabilities_value))
             AND (
               version.applicability->'projection'->'consumers' IS NULL
               OR (
                 jsonb_typeof(version.applicability->'projection'->'consumers') = 'array'
                 AND (version.applicability->'projection'->'consumers') ? consumer_value
               )
             )
             AND (
               version.applicability->'projection'->'audiences' IS NULL
               OR (
                 jsonb_typeof(version.applicability->'projection'->'audiences') = 'array'
                 AND (version.applicability->'projection'->'audiences') ? audience_value
               )
             )
           )
         )
      UNION ALL
      SELECT entry.id AS entry_id, entry.canonical_key, entry.entry_type,
             version.id AS version_id, version.version_number, version.label,
             version.sensitivity, version.review_requirement, version.applicability,
             version.document, version.canonical_digest,
             publication.id AS publication_id, publication.publication_number,
             publication.canonical_digest AS publication_digest
        FROM jsonb_array_elements(source_pins_value) AS exact(pin)
        JOIN public.canonical_knowledge_publications publication
          ON publication.organization_id = organization_id_value
         AND publication.id = (exact.pin->>'publicationId')::uuid
         AND publication.entry_id = (exact.pin->>'entryId')::uuid
         AND publication.version_id = (exact.pin->>'versionId')::uuid
        JOIN public.canonical_knowledge_entries entry
          ON entry.organization_id = publication.organization_id
         AND entry.id = publication.entry_id
        JOIN public.canonical_knowledge_versions version
          ON version.organization_id = publication.organization_id
         AND version.entry_id = publication.entry_id AND version.id = publication.version_id
       WHERE source_mode_value = 'pins'
    )
    SELECT * FROM selected
     ORDER BY canonical_key COLLATE "C", publication_id
  LOOP
    source_count := source_count + 1;
    IF source_count > maximum_candidates THEN
      RAISE EXCEPTION 'Synchronization projection candidate limit was exceeded'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_projection_candidate_limit';
    END IF;
    IF rtrim(source_record.canonical_digest) <> rtrim(source_record.publication_digest)
       OR source_record.document->>'canonicalKey' <> source_record.canonical_key
       OR source_record.document->>'entryType' <> source_record.entry_type
       OR source_record.document->>'sensitivity' <> source_record.sensitivity
       OR source_record.document->>'reviewRequirement' <> source_record.review_requirement
       OR source_record.document->'applicability' <> source_record.applicability THEN
      RAISE EXCEPTION 'Published knowledge failed synchronization integrity verification'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_projection_publication_integrity';
    END IF;
    document_value := source_record.document;
    fixed_capability := CASE source_record.canonical_key
      WHEN 'organization.availability' THEN 'availability'
      WHEN 'organization.customer-guidance' THEN 'customer_guidance'
      WHEN 'organization.financial-constraints' THEN 'financial_constraints'
      WHEN 'organization.identity' THEN 'identity'
      WHEN 'organization.operational-capabilities' THEN 'operational_capabilities'
      WHEN 'organization.services' THEN 'services'
      WHEN 'organization.voice-guidance' THEN 'voice_guidance'
      ELSE NULL
    END;
    IF fixed_capability IS NOT NULL THEN
      IF NOT capabilities_value ? fixed_capability THEN CONTINUE; END IF;
      FOR capability_value IN SELECT fixed_capability LOOP
        IF NOT public.canonical_knowledge_sync_applicability_allows(
          document_value, consumer_value, audience_value, capability_value
        ) THEN CONTINUE; END IF;
        source_value := jsonb_build_object(
          'canonicalDigest', rtrim(source_record.canonical_digest),
          'entryId', source_record.entry_id::text,
          'publicationId', source_record.publication_id::text,
          'publicationNumber', source_record.publication_number,
          'versionId', source_record.version_id::text,
          'versionNumber', source_record.version_number
        );
        item_value := jsonb_build_object(
          'capability', capability_value,
          'canonicalKey', source_record.canonical_key,
          'entryType', source_record.entry_type,
          'state', CASE WHEN document_value->'content'->>'state' = 'tombstoned'
            THEN 'tombstoned' ELSE 'published' END
        );
        IF audience_value <> 'customer' THEN
          item_value := item_value || jsonb_build_object('label', document_value->>'label');
        END IF;
        IF document_value->'content'->>'state' <> 'tombstoned' THEN
          item_value := item_value || jsonb_build_object(
            'content', CASE WHEN audience_value = 'customer'
              THEN public.canonical_knowledge_sync_customer_content(
                source_record.canonical_key, document_value
              ) ELSE document_value->'content' END
          );
        END IF;
        candidates := candidates || jsonb_build_array(jsonb_build_object(
          'capability', capability_value,
          'canonicalDigest', rtrim(source_record.canonical_digest),
          'canonicalKey', source_record.canonical_key,
          'item', item_value,
          'source', source_value
        ));
      END LOOP;
    ELSE
      IF audience_value = 'customer' THEN CONTINUE; END IF;
      projection_value := document_value->'applicability'->'projection';
      IF projection_value IS NULL THEN CONTINUE; END IF;
      IF jsonb_typeof(projection_value) <> 'object'
         OR jsonb_typeof(projection_value->'capabilities') <> 'array'
         OR jsonb_array_length(projection_value->'capabilities') < 1 THEN
        RAISE EXCEPTION 'Published projection applicability is invalid'
          USING ERRCODE = '23514',
                CONSTRAINT = 'canonical_knowledge_sync_projection_applicability';
      END IF;
      FOR capability_value IN
        SELECT DISTINCT capability.value
          FROM jsonb_array_elements_text(projection_value->'capabilities') capability(value)
         ORDER BY capability.value COLLATE "C"
      LOOP
        IF capability_value NOT IN (
          'availability', 'customer_guidance', 'financial_constraints', 'identity',
          'operational_capabilities', 'services', 'voice_guidance'
        ) THEN
          RAISE EXCEPTION 'Published projection applicability is invalid'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'canonical_knowledge_sync_projection_applicability';
        END IF;
        IF NOT capabilities_value ? capability_value OR NOT
          public.canonical_knowledge_sync_applicability_allows(
            document_value, consumer_value, audience_value, capability_value
          ) THEN CONTINUE; END IF;
        source_value := jsonb_build_object(
          'canonicalDigest', rtrim(source_record.canonical_digest),
          'entryId', source_record.entry_id::text,
          'publicationId', source_record.publication_id::text,
          'publicationNumber', source_record.publication_number,
          'versionId', source_record.version_id::text,
          'versionNumber', source_record.version_number
        );
        item_value := jsonb_build_object(
          'capability', capability_value,
          'canonicalKey', source_record.canonical_key,
          'entryType', source_record.entry_type,
          'label', document_value->>'label',
          'state', CASE WHEN document_value->'content'->>'state' = 'tombstoned'
            THEN 'tombstoned' ELSE 'published' END
        );
        IF document_value->'content'->>'state' <> 'tombstoned' THEN
          item_value := item_value || jsonb_build_object('content', document_value->'content');
        END IF;
        candidates := candidates || jsonb_build_array(jsonb_build_object(
          'capability', capability_value,
          'canonicalDigest', rtrim(source_record.canonical_digest),
          'canonicalKey', source_record.canonical_key,
          'item', item_value,
          'source', source_value
        ));
      END LOOP;
    END IF;
  END LOOP;

  FOR capability_value IN
    SELECT value FROM jsonb_array_elements_text(capabilities_value) capability(value)
     ORDER BY value COLLATE "C"
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(candidates) candidate(value)
       WHERE candidate.value->>'capability' = capability_value
    ) THEN
      missing_value := missing_value || jsonb_build_array(capability_value);
    END IF;
  END LOOP;
  IF jsonb_array_length(missing_value) > 0 THEN
    RAISE EXCEPTION 'The exact requested synchronization projection is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_projection_complete';
  END IF;

  FOR candidate_value IN
    SELECT candidate.value
      FROM jsonb_array_elements(candidates) candidate(value)
     ORDER BY candidate.value->>'capability' COLLATE "C",
              candidate.value->>'canonicalKey' COLLATE "C",
              candidate.value->>'canonicalDigest' COLLATE "C"
  LOOP
    candidate_count := candidate_count + 1;
    IF candidate_count > maximum_entries_value THEN
      RAISE EXCEPTION 'The exact requested synchronization projection exceeds its entry limit'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_projection_entry_limit';
    END IF;
    SELECT source.ordinality::integer - 1 INTO source_index
      FROM jsonb_array_elements(sources_value) WITH ORDINALITY AS source(value, ordinality)
     WHERE source.value = candidate_value->'source'
     LIMIT 1;
    IF source_index IS NULL THEN
      source_index := jsonb_array_length(sources_value);
      sources_value := sources_value || jsonb_build_array(candidate_value->'source');
    END IF;
    items_value := items_value || jsonb_build_array(
      (candidate_value->'item') || jsonb_build_object('sourceIndex', source_index)
    );
    source_index := NULL;
  END LOOP;

  expected_value := jsonb_build_object(
    'audience', audience_value,
    'capabilities', capabilities_value,
    'consumer', consumer_value,
    'contract', 'NorthStarKnowledgeProjection/v1',
    'items', items_value,
    'missingCapabilities', missing_value,
    'organizationId', organization_id_value::text,
    'queryDigest', NULL,
    'selection', 'exact_pins',
    'sources', sources_value,
    'truncated', FALSE
  );
  IF octet_length(public.canonical_knowledge_render_jsonb(expected_value)) > maximum_bytes_value THEN
    RAISE EXCEPTION 'The exact requested synchronization projection exceeds its byte limit'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_projection_byte_limit';
  END IF;
  RETURN expected_value;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_assign_sync_outbox_identity()
RETURNS TRIGGER AS $$
DECLARE
  target_record public.canonical_knowledge_sync_targets%ROWTYPE;
  sequence_value BIGINT;
  expected_idempotency TEXT;
BEGIN
  SELECT * INTO target_record
    FROM public.canonical_knowledge_sync_targets target
   WHERE target.organization_id = NEW.organization_id AND target.id = NEW.target_id
   FOR SHARE;
  IF NOT FOUND OR target_record.status <> 'active'
     OR target_record.target_revision <> NEW.target_revision
     OR rtrim(target_record.configuration_digest) <> rtrim(NEW.configuration_digest)
     OR target_record.provider_key <> NEW.provider_key
     OR target_record.consumer <> NEW.consumer
     OR target_record.audience <> NEW.audience
     OR target_record.capabilities <> NEW.capabilities
     OR target_record.maximum_entries <> NEW.maximum_entries
     OR target_record.maximum_bytes <> NEW.maximum_bytes THEN
    RAISE EXCEPTION 'Synchronization outbox target snapshot is stale or invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_target_snapshot';
  END IF;

  SELECT sequence.next_sequence INTO sequence_value
    FROM public.canonical_knowledge_sync_sequences sequence
   WHERE sequence.organization_id = NEW.organization_id AND sequence.target_id = NEW.target_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synchronization target sequence is unavailable'
      USING ERRCODE = '55000',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_sequence_required';
  END IF;
  NEW.target_sequence := sequence_value;
  UPDATE public.canonical_knowledge_sync_sequences
     SET next_sequence = sequence_value + 1
   WHERE organization_id = NEW.organization_id AND target_id = NEW.target_id;

  expected_idempotency := encode(sha256(convert_to(
    public.canonical_knowledge_render_jsonb(jsonb_build_object(
      'configurationDigest', rtrim(NEW.configuration_digest),
      'projectionIdentity', COALESCE(
        rtrim(NEW.projection_digest),
        'blocked:' || NEW.diagnostic_category
      ),
      'sourcePins', NEW.source_pins,
      'targetId', NEW.target_id::text,
      'targetRevision', NEW.target_revision
    )), 'UTF8'
  )), 'hex');
  IF NEW.idempotency_key IS NOT NULL AND rtrim(NEW.idempotency_key) <> expected_idempotency THEN
    RAISE EXCEPTION 'Synchronization idempotency key is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_idempotency_digest';
  END IF;
  NEW.idempotency_key := expected_idempotency;
  NEW.created_at := statement_timestamp();
  NEW.updated_at := NEW.created_at;
  IF NEW.state = 'blocked' THEN
    NEW.blocked_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_outbox_insert()
RETURNS TRIGGER AS $$
DECLARE
  pin JSONB;
  seen_entries JSONB := '{}'::jsonb;
  seen_publications JSONB := '{}'::jsonb;
  publication_record RECORD;
  expected_projection JSONB;
BEGIN
  FOR pin IN SELECT value FROM jsonb_array_elements(NEW.source_pins)
  LOOP
    IF jsonb_typeof(pin) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(pin)) <> 6
       OR seen_entries ? (pin->>'entryId')
       OR seen_publications ? (pin->>'publicationId')
       OR (pin->>'publicationNumber')::integer < 1
       OR (pin->>'versionNumber')::integer < 1
       OR pin->>'canonicalDigest' !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Synchronization source pins are malformed or unordered'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_source_pin_shape';
    END IF;
    SELECT publication.id, publication.entry_id, publication.version_id,
           publication.publication_number, publication.canonical_digest,
           version.version_number
      INTO publication_record
      FROM public.canonical_knowledge_publications publication
      JOIN public.canonical_knowledge_versions version
        ON version.organization_id = publication.organization_id
       AND version.entry_id = publication.entry_id
       AND version.id = publication.version_id
     WHERE publication.organization_id = NEW.organization_id
       AND publication.id = (pin->>'publicationId')::uuid
       AND publication.entry_id = (pin->>'entryId')::uuid
       AND publication.version_id = (pin->>'versionId')::uuid;
    IF NOT FOUND
       OR publication_record.publication_number <> (pin->>'publicationNumber')::integer
       OR publication_record.version_number <> (pin->>'versionNumber')::integer
       OR rtrim(publication_record.canonical_digest) <> pin->>'canonicalDigest' THEN
      RAISE EXCEPTION 'Synchronization source pin is not an exact publication'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_source_pin_exact';
    END IF;
    seen_entries := seen_entries || jsonb_build_object(pin->>'entryId', true);
    seen_publications := seen_publications || jsonb_build_object(pin->>'publicationId', true);
  END LOOP;

  IF NEW.state = 'pending' THEN
    expected_projection := public.canonical_knowledge_sync_expected_projection(
      NEW.organization_id, NEW.consumer, NEW.audience, NEW.capabilities,
      NEW.maximum_entries, NEW.maximum_bytes, 'latest', NEW.source_pins
    );
    IF jsonb_array_length(NEW.source_pins) < 1
       OR NEW.desired_projection->>'contract' <> 'NorthStarKnowledgeProjection/v1'
       OR NEW.desired_projection->>'organizationId' <> NEW.organization_id::text
       OR NEW.desired_projection->>'consumer' <> NEW.consumer
       OR NEW.desired_projection->>'audience' <> NEW.audience
       OR NEW.desired_projection->'capabilities' <> NEW.capabilities
       OR NEW.desired_projection->>'selection' <> 'exact_pins'
       OR NEW.desired_projection->'sources' <> NEW.source_pins
       OR NEW.desired_projection->>'queryDigest' IS NOT NULL
       OR NEW.desired_projection->>'truncated' <> 'false'
       OR NEW.source_pins <> expected_projection->'sources'
       OR NEW.desired_projection <> expected_projection
       OR NEW.diagnostic_category IS NOT NULL THEN
      RAISE EXCEPTION 'Synchronization desired projection does not match its target and pins'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_projection_exact';
    END IF;
  ELSIF NEW.state = 'blocked' THEN
    IF NEW.diagnostic_category NOT IN (
      'authorization_required', 'candidate_limit_exceeded', 'integrity_failure',
      'projection_incomplete', 'projection_oversized', 'projection_unavailable'
    ) THEN
      RAISE EXCEPTION 'Synchronization blocked diagnostic is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_blocked_category';
    END IF;
  ELSE
    RAISE EXCEPTION 'New synchronization work must begin pending or blocked'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_initial_state';
  END IF;

  IF NEW.trigger_type = 'publication' THEN
    SELECT publication.canonical_digest INTO publication_record
      FROM public.canonical_knowledge_publications publication
     WHERE publication.organization_id = NEW.organization_id
       AND publication.entry_id = NEW.trigger_entry_id
       AND publication.version_id = NEW.trigger_version_id
       AND publication.id = NEW.trigger_publication_id;
    IF NOT FOUND OR rtrim(publication_record.canonical_digest) <> rtrim(NEW.trigger_canonical_digest) THEN
      RAISE EXCEPTION 'Synchronization trigger publication pin is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_trigger_exact';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_outbox_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
     OR NEW.target_id <> OLD.target_id OR NEW.target_revision <> OLD.target_revision
     OR NEW.target_sequence <> OLD.target_sequence
     OR NEW.configuration_digest <> OLD.configuration_digest
     OR NEW.provider_key <> OLD.provider_key OR NEW.consumer <> OLD.consumer
     OR NEW.audience <> OLD.audience OR NEW.capabilities <> OLD.capabilities
     OR NEW.maximum_entries <> OLD.maximum_entries OR NEW.maximum_bytes <> OLD.maximum_bytes
     OR NEW.trigger_type <> OLD.trigger_type
     OR NEW.trigger_publication_id IS DISTINCT FROM OLD.trigger_publication_id
     OR NEW.trigger_entry_id IS DISTINCT FROM OLD.trigger_entry_id
     OR NEW.trigger_version_id IS DISTINCT FROM OLD.trigger_version_id
     OR NEW.trigger_canonical_digest IS DISTINCT FROM OLD.trigger_canonical_digest
     OR NEW.source_pins <> OLD.source_pins
     OR NEW.desired_projection IS DISTINCT FROM OLD.desired_projection
     OR NEW.canonical_projection IS DISTINCT FROM OLD.canonical_projection
     OR NEW.projection_digest IS DISTINCT FROM OLD.projection_digest
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Synchronization desired work identity is immutable'
      USING ERRCODE = '55000',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_desired_immutable';
  END IF;

  IF OLD.state IN ('pending', 'retry') AND NEW.state = 'claimed' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1
       OR NEW.reconciliation_generation <> OLD.reconciliation_generation
       OR NEW.claim_token IS NULL OR NEW.claimed_at IS NULL
       OR NEW.lease_expires_at <= NEW.claimed_at THEN
      RAISE EXCEPTION 'Synchronization claim transition is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_claim_transition';
    END IF;
  ELSIF OLD.state = 'claimed' AND NEW.state = 'claimed' THEN
    IF OLD.lease_expires_at <= statement_timestamp()
       OR NEW.claim_token <> OLD.claim_token
       OR NEW.attempt_count <> OLD.attempt_count
       OR NEW.reconciliation_generation <> OLD.reconciliation_generation
       OR NEW.lease_expires_at <= OLD.lease_expires_at
       OR NEW.observed_projection_digest IS DISTINCT FROM OLD.observed_projection_digest
       OR NEW.diagnostic_category IS DISTINCT FROM OLD.diagnostic_category
       OR NEW.available_at IS DISTINCT FROM OLD.available_at
       OR NEW.succeeded_at IS DISTINCT FROM OLD.succeeded_at
       OR NEW.dead_at IS DISTINCT FROM OLD.dead_at
       OR NEW.blocked_at IS DISTINCT FROM OLD.blocked_at THEN
      RAISE EXCEPTION 'Synchronization lease renewal is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_lease_transition';
    END IF;
  ELSIF OLD.state = 'claimed' AND NEW.state IN ('retry', 'succeeded', 'dead') THEN
    IF OLD.claim_token IS NULL
       OR NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.attempt_count <> OLD.attempt_count
       OR NEW.reconciliation_generation <> OLD.reconciliation_generation THEN
      RAISE EXCEPTION 'Synchronization finalization transition is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_finalize_transition';
    END IF;
    IF OLD.lease_expires_at <= statement_timestamp() THEN
      IF NEW.state = 'succeeded'
         OR NEW.diagnostic_category <> 'claim_expired'
         OR NEW.observed_projection_digest IS DISTINCT FROM OLD.observed_projection_digest THEN
        RAISE EXCEPTION 'Expired synchronization ownership cannot finalize provider state'
          USING ERRCODE = '23514',
                CONSTRAINT = 'canonical_knowledge_sync_outbox_expired_finalize';
      END IF;
    ELSIF NEW.diagnostic_category = 'claim_expired' THEN
      RAISE EXCEPTION 'Unexpired synchronization ownership cannot be recovered as expired'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_unexpired_recovery';
    END IF;
  ELSIF OLD.state = 'retry' AND NEW.state = 'retry' THEN
    IF NEW.attempt_count <> OLD.attempt_count
       OR NEW.reconciliation_generation <> OLD.reconciliation_generation
       OR NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.available_at > OLD.available_at
       OR NEW.blocked_at IS DISTINCT FROM OLD.blocked_at
       OR NEW.succeeded_at IS DISTINCT FROM OLD.succeeded_at
       OR NEW.dead_at IS DISTINCT FROM OLD.dead_at
       OR NEW.diagnostic_category IS DISTINCT FROM OLD.diagnostic_category
       OR NEW.observed_projection_digest IS DISTINCT FROM OLD.observed_projection_digest THEN
      RAISE EXCEPTION 'Synchronization retry acceleration is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_retry_acceleration';
    END IF;
  ELSIF OLD.state IN ('dead', 'succeeded') AND NEW.state = 'retry' THEN
    IF NEW.reconciliation_generation <> OLD.reconciliation_generation + 1
       OR NEW.attempt_count <> 0
       OR NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'Synchronization reconciliation transition is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_reconcile_transition';
    END IF;
  ELSE
    RAISE EXCEPTION 'Synchronization outbox state transition is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_state_transition';
  END IF;

  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_attempt_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id OR NEW.target_id <> OLD.target_id
     OR NEW.outbox_id <> OLD.outbox_id
     OR NEW.reconciliation_generation <> OLD.reconciliation_generation
     OR NEW.attempt_number <> OLD.attempt_number OR NEW.claim_token <> OLD.claim_token
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.started_at <> OLD.started_at
     OR OLD.outcome IS NOT NULL OR NEW.outcome IS NULL OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Synchronization attempt evidence transition is invalid'
      USING ERRCODE = '55000',
            CONSTRAINT = 'canonical_knowledge_sync_attempts_transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_attempt_insert()
RETURNS TRIGGER AS $$
DECLARE
  outbox_record public.canonical_knowledge_sync_outbox%ROWTYPE;
BEGIN
  SELECT * INTO outbox_record
    FROM public.canonical_knowledge_sync_outbox outbox
   WHERE outbox.organization_id = NEW.organization_id
     AND outbox.target_id = NEW.target_id
     AND outbox.id = NEW.outbox_id;
  IF NOT FOUND OR outbox_record.state <> 'claimed'
     OR outbox_record.reconciliation_generation <> NEW.reconciliation_generation
     OR outbox_record.attempt_count <> NEW.attempt_number
     OR outbox_record.claim_token <> NEW.claim_token
     OR rtrim(outbox_record.idempotency_key) <> rtrim(NEW.idempotency_key) THEN
    RAISE EXCEPTION 'Synchronization attempt does not match its exact claim'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_attempts_claim_exact';
  END IF;
  NEW.started_at := statement_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_reject_sync_attempt_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Synchronization attempt evidence is retained'
    USING ERRCODE = '55000',
          CONSTRAINT = 'canonical_knowledge_sync_attempts_no_delete';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_target_matches_version(
  target_id_value UUID,
  version_id_value UUID
) RETURNS BOOLEAN AS $$
DECLARE
  target_record public.canonical_knowledge_sync_targets%ROWTYPE;
  version_record public.canonical_knowledge_versions%ROWTYPE;
  capability TEXT;
BEGIN
  SELECT target.* INTO target_record
    FROM public.canonical_knowledge_sync_targets target
   WHERE target.id = target_id_value;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT version.* INTO version_record
    FROM public.canonical_knowledge_versions version
   WHERE version.organization_id = target_record.organization_id
     AND version.id = version_id_value;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  capability := CASE version_record.canonical_key
    WHEN 'organization.availability' THEN 'availability'
    WHEN 'organization.customer-guidance' THEN 'customer_guidance'
    WHEN 'organization.financial-constraints' THEN 'financial_constraints'
    WHEN 'organization.identity' THEN 'identity'
    WHEN 'organization.operational-capabilities' THEN 'operational_capabilities'
    WHEN 'organization.services' THEN 'services'
    WHEN 'organization.voice-guidance' THEN 'voice_guidance'
    ELSE NULL
  END;
  IF capability IS NULL THEN
    IF jsonb_typeof(version_record.applicability->'projection'->'capabilities') <> 'array'
       OR target_record.audience = 'customer' THEN RETURN FALSE; END IF;
    RETURN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        version_record.applicability->'projection'->'capabilities'
      ) mapped(value)
      WHERE target_record.capabilities ? mapped.value
    );
  END IF;
  RETURN target_record.capabilities ? capability;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_state()
RETURNS TRIGGER AS $$
DECLARE
  event_record public.canonical_knowledge_sync_outbox%ROWTYPE;
BEGIN
  IF NEW.desired_event_id IS NOT NULL THEN
    SELECT * INTO event_record FROM public.canonical_knowledge_sync_outbox outbox
     WHERE outbox.organization_id = NEW.organization_id
       AND outbox.target_id = NEW.target_id AND outbox.id = NEW.desired_event_id;
    IF NOT FOUND OR event_record.target_sequence <> NEW.desired_sequence
       OR rtrim(event_record.projection_digest) IS DISTINCT FROM
          rtrim(NEW.desired_projection_digest) THEN
      RAISE EXCEPTION 'Synchronization desired pointer is not exact'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_states_desired_exact';
    END IF;
  END IF;
  IF NEW.observed_event_id IS NOT NULL THEN
    SELECT * INTO event_record FROM public.canonical_knowledge_sync_outbox outbox
     WHERE outbox.organization_id = NEW.organization_id
       AND outbox.target_id = NEW.target_id AND outbox.id = NEW.observed_event_id;
    IF NOT FOUND OR event_record.target_sequence <> NEW.observed_sequence
       OR rtrim(event_record.observed_projection_digest) IS DISTINCT FROM
          rtrim(NEW.observed_projection_digest)
       OR NOT (
         (event_record.state IN ('succeeded', 'retry', 'dead') AND EXISTS (
           SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
            WHERE attempt.organization_id = NEW.organization_id
              AND attempt.target_id = NEW.target_id
              AND attempt.outbox_id = NEW.observed_event_id
              AND attempt.outcome = 'succeeded'
              AND rtrim(attempt.observed_projection_digest) =
                  rtrim(NEW.observed_projection_digest)
         ))
         OR
         (event_record.state IN ('retry', 'dead') AND EXISTS (
           SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
            WHERE attempt.organization_id = NEW.organization_id
              AND attempt.target_id = NEW.target_id
              AND attempt.outbox_id = NEW.observed_event_id
              AND attempt.outcome = 'drift'
              AND rtrim(attempt.observed_projection_digest) =
                  rtrim(NEW.observed_projection_digest)
         ))
       ) THEN
      RAISE EXCEPTION 'Synchronization observed pointer is not exact'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_states_observed_exact';
    END IF;
  END IF;
  IF NEW.last_known_good_event_id IS NOT NULL THEN
    SELECT * INTO event_record FROM public.canonical_knowledge_sync_outbox outbox
     WHERE outbox.organization_id = NEW.organization_id
       AND outbox.target_id = NEW.target_id AND outbox.id = NEW.last_known_good_event_id;
    IF NOT FOUND OR event_record.state NOT IN ('succeeded', 'retry', 'dead')
       OR event_record.target_sequence <> NEW.last_known_good_sequence
       OR rtrim(event_record.observed_projection_digest) <>
          rtrim(NEW.last_known_good_projection_digest)
       OR rtrim(event_record.projection_digest) <> rtrim(NEW.last_known_good_projection_digest)
       OR NOT EXISTS (
         SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
          WHERE attempt.organization_id = NEW.organization_id
            AND attempt.target_id = NEW.target_id
            AND attempt.outbox_id = NEW.last_known_good_event_id
            AND attempt.outcome = 'succeeded'
            AND rtrim(attempt.observed_projection_digest) =
                rtrim(NEW.last_known_good_projection_digest)
       ) THEN
      RAISE EXCEPTION 'Synchronization last-known-good pointer is not exact'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_states_lkg_exact';
    END IF;
  END IF;
  IF NEW.status = 'in_sync' AND (
       NEW.desired_event_id IS DISTINCT FROM NEW.observed_event_id
       OR NEW.desired_sequence IS DISTINCT FROM NEW.observed_sequence
       OR rtrim(NEW.desired_projection_digest) IS DISTINCT FROM
          rtrim(NEW.observed_projection_digest)
     ) THEN
    RAISE EXCEPTION 'In-sync state requires exact desired and observed identity'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_states_in_sync_exact';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.last_known_good_sequence IS NOT NULL
     AND (NEW.last_known_good_sequence IS NULL
       OR NEW.last_known_good_sequence < OLD.last_known_good_sequence) THEN
    RAISE EXCEPTION 'Last-known-good synchronization state cannot regress'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_states_lkg_monotonic';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.desired_sequence IS NOT NULL
     AND (NEW.desired_sequence IS NULL
       OR NEW.desired_sequence < OLD.desired_sequence) THEN
    RAISE EXCEPTION 'Desired synchronization state cannot regress'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_states_desired_monotonic';
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_sync_attempt_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state = 'claimed' AND (
    NOT EXISTS (
      SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
       WHERE attempt.organization_id = NEW.organization_id
         AND attempt.target_id = NEW.target_id AND attempt.outbox_id = NEW.id
         AND attempt.reconciliation_generation = NEW.reconciliation_generation
         AND attempt.attempt_number = NEW.attempt_count
         AND attempt.claim_token = NEW.claim_token AND attempt.outcome IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Synchronization claim is missing attempt evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_attempt_open_required';
  ELSIF OLD.state = 'claimed' AND NEW.state <> 'claimed' AND (
    NOT EXISTS (
      SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
       WHERE attempt.organization_id = NEW.organization_id
         AND attempt.target_id = NEW.target_id AND attempt.outbox_id = NEW.id
         AND attempt.reconciliation_generation = OLD.reconciliation_generation
         AND attempt.attempt_number = OLD.attempt_count
         AND attempt.claim_token = OLD.claim_token AND attempt.outcome IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'Synchronization finalization is missing attempt evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_attempt_closed_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_sync_publication_work()
RETURNS TRIGGER AS $$
DECLARE
  target_record RECORD;
BEGIN
  FOR target_record IN
    SELECT target.id
      FROM public.canonical_knowledge_sync_targets target
     WHERE target.organization_id = NEW.organization_id
       AND target.status = 'active'
       AND public.canonical_knowledge_sync_target_matches_version(target.id, NEW.version_id)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.canonical_knowledge_sync_outbox outbox
       WHERE outbox.organization_id = NEW.organization_id
         AND outbox.target_id = target_record.id
         AND outbox.trigger_type = 'publication'
         AND outbox.trigger_publication_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Canonical publication is missing transactional synchronization work'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_publication_sync_outbox_required';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_sync_target_desired()
RETURNS TRIGGER AS $$
DECLARE
  current_target public.canonical_knowledge_sync_targets%ROWTYPE;
BEGIN
  SELECT * INTO current_target
    FROM public.canonical_knowledge_sync_targets target
   WHERE target.organization_id = NEW.organization_id AND target.id = NEW.id;
  IF current_target.status = 'active'
     AND current_target.target_revision = NEW.target_revision
     AND NOT EXISTS (
       SELECT 1 FROM public.canonical_knowledge_sync_outbox outbox
        WHERE outbox.organization_id = NEW.organization_id
          AND outbox.target_id = NEW.id
          AND outbox.target_revision = NEW.target_revision
     ) THEN
    RAISE EXCEPTION 'Active synchronization target is missing durable desired state'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_target_desired_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_sync_state_pointer()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_knowledge_sync_states state
     WHERE state.organization_id = NEW.organization_id
       AND state.target_id = NEW.target_id
       AND state.desired_sequence >= NEW.target_sequence
  ) THEN
    RAISE EXCEPTION 'Synchronization desired state pointer is missing'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_state_pointer_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER canonical_knowledge_sync_targets_validate
  BEFORE INSERT OR UPDATE ON public.canonical_knowledge_sync_targets
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_sync_target();

CREATE TRIGGER canonical_knowledge_sync_targets_initialize
  AFTER INSERT ON public.canonical_knowledge_sync_targets
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_initialize_sync_target();

CREATE TRIGGER canonical_knowledge_sync_targets_no_delete
  BEFORE DELETE ON public.canonical_knowledge_sync_targets
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_reject_sync_target_delete();

CREATE TRIGGER canonical_knowledge_sync_outbox_assign_identity
  BEFORE INSERT ON public.canonical_knowledge_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_assign_sync_outbox_identity();

CREATE TRIGGER canonical_knowledge_sync_outbox_validate_insert
  BEFORE INSERT ON public.canonical_knowledge_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_sync_outbox_insert();

CREATE TRIGGER canonical_knowledge_sync_outbox_validate_update
  BEFORE UPDATE ON public.canonical_knowledge_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_sync_outbox_update();

CREATE TRIGGER canonical_knowledge_sync_outbox_no_delete
  BEFORE DELETE ON public.canonical_knowledge_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_reject_sync_attempt_delete();

CREATE TRIGGER canonical_knowledge_sync_attempts_validate_update
  BEFORE UPDATE ON public.canonical_knowledge_sync_attempts
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_sync_attempt_update();

CREATE TRIGGER canonical_knowledge_sync_attempts_validate_insert
  BEFORE INSERT ON public.canonical_knowledge_sync_attempts
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_sync_attempt_insert();

CREATE TRIGGER canonical_knowledge_sync_attempts_no_delete
  BEFORE DELETE ON public.canonical_knowledge_sync_attempts
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_reject_sync_attempt_delete();

CREATE TRIGGER canonical_knowledge_sync_states_validate
  BEFORE INSERT OR UPDATE ON public.canonical_knowledge_sync_states
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_sync_state();

CREATE CONSTRAINT TRIGGER canonical_knowledge_publications_require_sync_outbox
  AFTER INSERT ON public.canonical_knowledge_publications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_sync_publication_work();

CREATE CONSTRAINT TRIGGER canonical_knowledge_sync_targets_require_desired
  AFTER INSERT OR UPDATE ON public.canonical_knowledge_sync_targets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_sync_target_desired();

CREATE CONSTRAINT TRIGGER canonical_knowledge_sync_outbox_require_state_pointer
  AFTER INSERT ON public.canonical_knowledge_sync_outbox
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_sync_state_pointer();

CREATE CONSTRAINT TRIGGER canonical_knowledge_sync_outbox_require_attempt_transition
  AFTER UPDATE ON public.canonical_knowledge_sync_outbox
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_sync_attempt_transition();
