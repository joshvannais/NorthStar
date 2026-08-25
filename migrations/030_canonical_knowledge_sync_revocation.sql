-- Mission 21 Part 6 - atomic synchronization claim revocation.
-- This migration stores no credential and performs no provider or network call.

ALTER TABLE public.canonical_knowledge_sync_outbox
  ADD COLUMN revoked_at TIMESTAMPTZ;

ALTER TABLE public.canonical_knowledge_sync_outbox
  DROP CONSTRAINT canonical_knowledge_sync_outbox_state_check,
  DROP CONSTRAINT canonical_knowledge_sync_outbox_lifecycle_check;

ALTER TABLE public.canonical_knowledge_sync_outbox
  ADD CONSTRAINT canonical_knowledge_sync_outbox_state_check CHECK (
    state IN ('pending', 'claimed', 'retry', 'succeeded', 'dead', 'blocked', 'revoked')
  ),
  ADD CONSTRAINT canonical_knowledge_sync_outbox_lifecycle_check CHECK (
    (state IN ('pending', 'retry')
      AND desired_projection IS NOT NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND succeeded_at IS NULL AND dead_at IS NULL AND blocked_at IS NULL
      AND revoked_at IS NULL)
    OR
    (state = 'claimed'
      AND desired_projection IS NOT NULL
      AND claim_token IS NOT NULL AND claimed_at IS NOT NULL
      AND lease_expires_at > claimed_at
      AND succeeded_at IS NULL AND dead_at IS NULL AND blocked_at IS NULL
      AND revoked_at IS NULL)
    OR
    (state = 'succeeded'
      AND desired_projection IS NOT NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND observed_projection_digest = projection_digest
      AND succeeded_at IS NOT NULL AND dead_at IS NULL AND blocked_at IS NULL
      AND revoked_at IS NULL)
    OR
    (state = 'dead'
      AND desired_projection IS NOT NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND succeeded_at IS NULL AND dead_at IS NOT NULL AND blocked_at IS NULL
      AND revoked_at IS NULL AND diagnostic_category IS NOT NULL)
    OR
    (state = 'blocked'
      AND desired_projection IS NULL
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND succeeded_at IS NULL AND dead_at IS NULL AND blocked_at IS NOT NULL
      AND revoked_at IS NULL AND diagnostic_category IS NOT NULL)
    OR
    (state = 'revoked'
      AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL
      AND succeeded_at IS NULL AND dead_at IS NULL AND blocked_at IS NULL
      AND revoked_at IS NOT NULL
      AND diagnostic_category IN ('target_suspended', 'target_superseded'))
  );

ALTER TABLE public.canonical_knowledge_sync_attempts
  DROP CONSTRAINT canonical_knowledge_sync_attempts_outcome_check,
  DROP CONSTRAINT canonical_knowledge_sync_attempts_outcome_shape_check;

ALTER TABLE public.canonical_knowledge_sync_attempts
  ADD CONSTRAINT canonical_knowledge_sync_attempts_outcome_check CHECK (
    outcome IS NULL OR outcome IN (
      'succeeded', 'retry', 'dead', 'claim_expired', 'drift', 'revoked'
    )
  ),
  ADD CONSTRAINT canonical_knowledge_sync_attempts_outcome_shape_check CHECK (
    outcome IS NULL
    OR
    (outcome = 'succeeded'
      AND diagnostic_category IS NULL
      AND observed_projection_digest IS NOT NULL)
    OR
    (outcome = 'drift'
      AND diagnostic_category = 'projection_digest_mismatch'
      AND observed_projection_digest IS NOT NULL)
    OR
    (outcome = 'claim_expired'
      AND diagnostic_category = 'claim_expired'
      AND observed_projection_digest IS NULL)
    OR
    (outcome = 'revoked'
      AND diagnostic_category IN ('target_suspended', 'target_superseded')
      AND observed_projection_digest IS NULL)
    OR
    (outcome IN ('retry', 'dead')
      AND diagnostic_category IS NOT NULL
      AND diagnostic_category NOT IN (
        'claim_expired', 'ownership_lost', 'projection_digest_mismatch',
        'reconciliation_requested', 'stale_observation',
        'target_suspended', 'target_superseded'
      )
      AND observed_projection_digest IS NULL)
  );

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_outbox_update()
RETURNS TRIGGER AS $$
DECLARE
  target_record public.canonical_knowledge_sync_targets%ROWTYPE;
BEGIN
  IF NEW.diagnostic_category = 'ownership_lost' THEN
    RAISE EXCEPTION 'Ownership loss is an ephemeral worker observation, not durable evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_ownership_lost_reserved';
  END IF;

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
       OR NEW.lease_expires_at <= NEW.claimed_at
       OR NEW.revoked_at IS NOT NULL THEN
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
       OR NEW.blocked_at IS DISTINCT FROM OLD.blocked_at
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'Synchronization lease renewal is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_lease_transition';
    END IF;
  ELSIF OLD.state IN ('pending', 'retry', 'claimed') AND NEW.state = 'revoked' THEN
    SELECT * INTO target_record
      FROM public.canonical_knowledge_sync_targets target
     WHERE target.organization_id = OLD.organization_id
       AND target.id = OLD.target_id;
    IF NOT FOUND
       OR target_record.target_revision <= OLD.target_revision
       OR NEW.diagnostic_category <> (CASE
         WHEN target_record.status = 'suspended' THEN 'target_suspended'
         ELSE 'target_superseded' END)
       OR NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.attempt_count <> OLD.attempt_count
       OR NEW.reconciliation_generation <> OLD.reconciliation_generation
       OR NEW.observed_projection_digest IS DISTINCT FROM OLD.observed_projection_digest
       OR NEW.available_at IS DISTINCT FROM OLD.available_at
       OR NEW.succeeded_at IS NOT NULL OR NEW.dead_at IS NOT NULL
       OR NEW.blocked_at IS NOT NULL OR NEW.revoked_at IS NULL
       OR OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Synchronization revocation transition is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_revocation_transition';
    END IF;
  ELSIF OLD.state = 'claimed' AND NEW.state IN ('retry', 'succeeded', 'dead') THEN
    IF OLD.claim_token IS NULL
       OR NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.attempt_count <> OLD.attempt_count
       OR NEW.reconciliation_generation <> OLD.reconciliation_generation
       OR NEW.revoked_at IS NOT NULL THEN
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
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
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
       OR NEW.lease_expires_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
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
DECLARE
  outbox_record public.canonical_knowledge_sync_outbox%ROWTYPE;
  target_record public.canonical_knowledge_sync_targets%ROWTYPE;
  current_claim_matches BOOLEAN := FALSE;
  finalized_outbox_matches BOOLEAN := FALSE;
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

  IF NEW.outcome = 'ownership_lost' THEN
    RAISE EXCEPTION 'Ownership loss is an ephemeral worker observation, not durable evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_attempts_ownership_lost_reserved';
  END IF;

  SELECT * INTO outbox_record
    FROM public.canonical_knowledge_sync_outbox outbox
   WHERE outbox.organization_id = OLD.organization_id
     AND outbox.target_id = OLD.target_id
     AND outbox.id = OLD.outbox_id
     AND outbox.reconciliation_generation = OLD.reconciliation_generation
     AND outbox.attempt_count = OLD.attempt_number
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synchronization attempt no longer has exact outbox authority'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_attempts_outbox_authority';
  END IF;

  SELECT * INTO target_record
    FROM public.canonical_knowledge_sync_targets target
   WHERE target.organization_id = OLD.organization_id
     AND target.id = OLD.target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synchronization attempt is missing target authority'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_attempts_target_authority';
  END IF;

  current_claim_matches := outbox_record.state = 'claimed'
    AND outbox_record.claim_token = OLD.claim_token
    AND rtrim(outbox_record.idempotency_key) = rtrim(OLD.idempotency_key);

  finalized_outbox_matches := outbox_record.claim_token IS NULL
    AND outbox_record.claimed_at IS NULL
    AND outbox_record.lease_expires_at IS NULL
    AND outbox_record.diagnostic_category IS NOT DISTINCT FROM NEW.diagnostic_category
    AND rtrim(outbox_record.observed_projection_digest) IS NOT DISTINCT FROM
      rtrim(NEW.observed_projection_digest)
    AND (
      (NEW.outcome = 'succeeded'
        AND outbox_record.state = 'succeeded'
        AND rtrim(NEW.observed_projection_digest) = rtrim(outbox_record.projection_digest))
      OR
      (NEW.outcome = 'retry'
        AND OLD.attempt_number < 5
        AND outbox_record.state = 'retry')
      OR
      (NEW.outcome = 'dead'
        AND OLD.attempt_number = 5
        AND outbox_record.state = 'dead')
      OR
      (NEW.outcome = 'drift'
        AND outbox_record.state = CASE WHEN OLD.attempt_number = 5 THEN 'dead' ELSE 'retry' END
        AND NEW.diagnostic_category = 'projection_digest_mismatch')
      OR
      (NEW.outcome = 'claim_expired'
        AND outbox_record.state = CASE WHEN OLD.attempt_number = 5 THEN 'dead' ELSE 'retry' END
        AND NEW.diagnostic_category = 'claim_expired')
      OR
      (NEW.outcome = 'revoked'
        AND outbox_record.state = 'revoked'
        AND outbox_record.revoked_at IS NOT NULL)
    );

  IF NEW.outcome = 'revoked' THEN
    IF NOT current_claim_matches
       OR target_record.target_revision <= outbox_record.target_revision
       OR NEW.diagnostic_category <> (CASE
         WHEN target_record.status = 'suspended' THEN 'target_suspended'
         ELSE 'target_superseded' END) THEN
      RAISE EXCEPTION 'Revoked synchronization evidence requires superseded target authority'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_attempts_revocation_authority';
    END IF;
  ELSIF NEW.outcome = 'claim_expired' THEN
    IF NOT (
      (current_claim_matches AND outbox_record.lease_expires_at <= statement_timestamp())
      OR finalized_outbox_matches
    ) THEN
      RAISE EXCEPTION 'Claim-expired evidence requires an expired database-time lease'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_attempts_claim_expired_authority';
    END IF;
  ELSE
    IF NEW.outcome = 'retry' AND OLD.attempt_number >= 5
       OR NEW.outcome = 'dead' AND OLD.attempt_number <> 5 THEN
      RAISE EXCEPTION 'Synchronization attempt outcome does not match its bounded attempt'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_attempts_bounded_outcome';
    END IF;
    IF NOT (
      (current_claim_matches AND outbox_record.lease_expires_at > statement_timestamp())
      OR finalized_outbox_matches
    ) THEN
      RAISE EXCEPTION 'Provider or integrity evidence requires live database-time ownership'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_attempts_live_authority';
    END IF;
  END IF;

  NEW.completed_at := statement_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_attempt_state_matches(
  outbox_id_value UUID
) RETURNS BOOLEAN AS $$
DECLARE
  outbox_record public.canonical_knowledge_sync_outbox%ROWTYPE;
  attempt_record public.canonical_knowledge_sync_attempts%ROWTYPE;
  state_record public.canonical_knowledge_sync_states%ROWTYPE;
  target_record public.canonical_knowledge_sync_targets%ROWTYPE;
  attempt_matches BOOLEAN := FALSE;
  state_matches BOOLEAN := TRUE;
BEGIN
  SELECT * INTO outbox_record
    FROM public.canonical_knowledge_sync_outbox outbox
   WHERE outbox.id = outbox_id_value;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT * INTO state_record
    FROM public.canonical_knowledge_sync_states state
   WHERE state.organization_id = outbox_record.organization_id
     AND state.target_id = outbox_record.target_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO target_record
    FROM public.canonical_knowledge_sync_targets target
   WHERE target.organization_id = outbox_record.organization_id
     AND target.id = outbox_record.target_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF outbox_record.state IN ('pending', 'blocked') THEN
    attempt_matches := outbox_record.reconciliation_generation = 1
      AND outbox_record.attempt_count = 0
      AND NOT EXISTS (
        SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
         WHERE attempt.organization_id = outbox_record.organization_id
           AND attempt.target_id = outbox_record.target_id
           AND attempt.outbox_id = outbox_record.id
      );
  ELSIF outbox_record.state = 'claimed' THEN
    SELECT * INTO attempt_record
      FROM public.canonical_knowledge_sync_attempts attempt
     WHERE attempt.organization_id = outbox_record.organization_id
       AND attempt.target_id = outbox_record.target_id
       AND attempt.outbox_id = outbox_record.id
       AND attempt.reconciliation_generation = outbox_record.reconciliation_generation
       AND attempt.attempt_number = outbox_record.attempt_count;
    attempt_matches := FOUND
      AND attempt_record.claim_token = outbox_record.claim_token
      AND rtrim(attempt_record.idempotency_key) = rtrim(outbox_record.idempotency_key)
      AND attempt_record.outcome IS NULL;
  ELSIF outbox_record.state = 'revoked' THEN
    attempt_matches := target_record.target_revision > outbox_record.target_revision
      AND outbox_record.diagnostic_category = CASE
        WHEN target_record.status = 'suspended' THEN 'target_suspended'
        ELSE COALESCE(outbox_record.diagnostic_category, 'target_superseded') END
      AND outbox_record.diagnostic_category IN ('target_suspended', 'target_superseded')
      AND NOT EXISTS (
        SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
         WHERE attempt.organization_id = outbox_record.organization_id
           AND attempt.target_id = outbox_record.target_id
           AND attempt.outbox_id = outbox_record.id
           AND attempt.outcome IS NULL
      );
  ELSIF outbox_record.state = 'retry' AND outbox_record.attempt_count = 0 THEN
    attempt_matches := outbox_record.reconciliation_generation > 1
      AND outbox_record.diagnostic_category IN (
        'reconciliation_requested', 'stale_observation'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
         WHERE attempt.organization_id = outbox_record.organization_id
           AND attempt.target_id = outbox_record.target_id
           AND attempt.outbox_id = outbox_record.id
           AND attempt.reconciliation_generation = outbox_record.reconciliation_generation
      );
  ELSE
    SELECT * INTO attempt_record
      FROM public.canonical_knowledge_sync_attempts attempt
     WHERE attempt.organization_id = outbox_record.organization_id
       AND attempt.target_id = outbox_record.target_id
       AND attempt.outbox_id = outbox_record.id
       AND attempt.reconciliation_generation = outbox_record.reconciliation_generation
       AND attempt.attempt_number = outbox_record.attempt_count;
    IF FOUND THEN
      attempt_matches := rtrim(attempt_record.idempotency_key) =
          rtrim(outbox_record.idempotency_key)
        AND attempt_record.diagnostic_category IS NOT DISTINCT FROM
          outbox_record.diagnostic_category
        AND rtrim(attempt_record.observed_projection_digest) IS NOT DISTINCT FROM
          rtrim(outbox_record.observed_projection_digest)
        AND (
          (outbox_record.state = 'succeeded'
            AND attempt_record.outcome = 'succeeded'
            AND attempt_record.diagnostic_category IS NULL
            AND rtrim(attempt_record.observed_projection_digest) =
              rtrim(outbox_record.projection_digest))
          OR
          (outbox_record.state = 'retry'
            AND outbox_record.attempt_count < 5
            AND attempt_record.outcome IN ('retry', 'drift', 'claim_expired')
            AND outbox_record.available_at > attempt_record.completed_at)
          OR
          (outbox_record.state = 'dead'
            AND outbox_record.attempt_count = 5
            AND attempt_record.outcome IN ('dead', 'drift', 'claim_expired'))
        );
    END IF;
  END IF;

  IF NOT attempt_matches THEN RETURN FALSE; END IF;
  IF target_record.status = 'suspended'
     OR state_record.desired_event_id IS DISTINCT FROM outbox_record.id THEN
    RETURN TRUE;
  END IF;

  IF outbox_record.state = 'blocked' THEN
    state_matches := state_record.status = 'blocked'
      AND state_record.diagnostic_category IS NOT DISTINCT FROM
        outbox_record.diagnostic_category;
  ELSIF outbox_record.state = 'pending' THEN
    state_matches := state_record.status = 'pending';
  ELSIF outbox_record.state = 'retry' AND outbox_record.attempt_count = 0 THEN
    state_matches := state_record.diagnostic_category = outbox_record.diagnostic_category
      AND state_record.status = CASE outbox_record.diagnostic_category
        WHEN 'stale_observation' THEN 'stale' ELSE 'retry' END;
  ELSIF outbox_record.state = 'retry' THEN
    state_matches := state_record.diagnostic_category = outbox_record.diagnostic_category
      AND state_record.status = CASE attempt_record.outcome
        WHEN 'drift' THEN 'drift' ELSE 'retry' END
      AND (
        attempt_record.outcome <> 'drift'
        OR (
          state_record.observed_event_id = outbox_record.id
          AND state_record.observed_sequence = outbox_record.target_sequence
          AND rtrim(state_record.observed_projection_digest) =
            rtrim(outbox_record.observed_projection_digest)
        )
      );
  ELSIF outbox_record.state = 'succeeded' THEN
    state_matches := state_record.status = 'in_sync'
      AND state_record.diagnostic_category IS NULL
      AND state_record.observed_event_id = outbox_record.id
      AND state_record.observed_sequence = outbox_record.target_sequence
      AND rtrim(state_record.observed_projection_digest) = rtrim(outbox_record.projection_digest)
      AND state_record.last_known_good_event_id = outbox_record.id
      AND state_record.last_known_good_sequence = outbox_record.target_sequence
      AND rtrim(state_record.last_known_good_projection_digest) =
        rtrim(outbox_record.projection_digest);
  ELSIF outbox_record.state = 'dead' THEN
    state_matches := state_record.diagnostic_category = outbox_record.diagnostic_category
      AND state_record.status = CASE attempt_record.outcome
        WHEN 'drift' THEN 'drift' ELSE 'dead' END
      AND (
        attempt_record.outcome <> 'drift'
        OR (
          state_record.observed_event_id = outbox_record.id
          AND state_record.observed_sequence = outbox_record.target_sequence
          AND rtrim(state_record.observed_projection_digest) =
            rtrim(outbox_record.observed_projection_digest)
        )
      );
  END IF;
  RETURN state_matches;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_sync_attempt_transition()
RETURNS TRIGGER AS $$
DECLARE
  current_outbox public.canonical_knowledge_sync_outbox%ROWTYPE;
  attempt_record public.canonical_knowledge_sync_attempts%ROWTYPE;
BEGIN
  SELECT * INTO current_outbox
    FROM public.canonical_knowledge_sync_outbox outbox
   WHERE outbox.organization_id = NEW.organization_id
     AND outbox.target_id = NEW.target_id
     AND outbox.id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synchronization outbox authority is missing'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_outbox_attempt_authority';
  END IF;

  IF current_outbox.state = 'claimed' THEN
    SELECT * INTO attempt_record
      FROM public.canonical_knowledge_sync_attempts attempt
     WHERE attempt.organization_id = current_outbox.organization_id
       AND attempt.target_id = current_outbox.target_id
       AND attempt.outbox_id = current_outbox.id
       AND attempt.reconciliation_generation = current_outbox.reconciliation_generation
       AND attempt.attempt_number = current_outbox.attempt_count
       AND attempt.claim_token = current_outbox.claim_token
       AND rtrim(attempt.idempotency_key) = rtrim(current_outbox.idempotency_key)
       AND attempt.outcome IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Synchronization claim is missing exact open attempt evidence'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_attempt_open_required';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.state = 'claimed' THEN
    SELECT * INTO attempt_record
      FROM public.canonical_knowledge_sync_attempts attempt
     WHERE attempt.organization_id = OLD.organization_id
       AND attempt.target_id = OLD.target_id
       AND attempt.outbox_id = OLD.id
       AND attempt.reconciliation_generation = OLD.reconciliation_generation
       AND attempt.attempt_number = OLD.attempt_count
       AND attempt.claim_token = OLD.claim_token
       AND rtrim(attempt.idempotency_key) = rtrim(OLD.idempotency_key)
       AND attempt.outcome IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Synchronization finalization is missing exact closed attempt evidence'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_outbox_attempt_closed_required';
    END IF;
  END IF;

  IF NOT public.canonical_knowledge_sync_attempt_state_matches(current_outbox.id) THEN
    RAISE EXCEPTION 'Synchronization outbox, attempt, and observed state are inconsistent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_attempt_state_exact';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_sync_state()
RETURNS TRIGGER AS $$
DECLARE
  event_record public.canonical_knowledge_sync_outbox%ROWTYPE;
  target_record public.canonical_knowledge_sync_targets%ROWTYPE;
  expected_initial_status TEXT;
  expected_initial_diagnostic TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id <> OLD.organization_id OR NEW.target_id <> OLD.target_id
  ) THEN
    RAISE EXCEPTION 'Synchronization state target identity is immutable'
      USING ERRCODE = '55000',
            CONSTRAINT = 'canonical_knowledge_sync_states_identity_immutable';
  END IF;
  IF NEW.diagnostic_category = 'ownership_lost' THEN
    RAISE EXCEPTION 'Ownership loss is an ephemeral worker observation, not durable state'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_states_ownership_lost_reserved';
  END IF;

  SELECT * INTO target_record
    FROM public.canonical_knowledge_sync_targets target
   WHERE target.organization_id = NEW.organization_id
     AND target.id = NEW.target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synchronization state requires exact target authority'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_states_target_exact';
  END IF;

  IF TG_OP = 'INSERT' THEN
    expected_initial_status := CASE
      WHEN target_record.status = 'active' THEN 'blocked'
      ELSE 'suspended'
    END;
    expected_initial_diagnostic := CASE
      WHEN target_record.status = 'active' THEN 'projection_unavailable'
      ELSE 'target_suspended'
    END;
    IF NEW.desired_event_id IS NOT NULL OR NEW.desired_sequence IS NOT NULL
       OR NEW.desired_projection_digest IS NOT NULL
       OR NEW.observed_event_id IS NOT NULL OR NEW.observed_sequence IS NOT NULL
       OR NEW.observed_projection_digest IS NOT NULL
       OR NEW.last_known_good_event_id IS NOT NULL
       OR NEW.last_known_good_sequence IS NOT NULL
       OR NEW.last_known_good_projection_digest IS NOT NULL
       OR NEW.drift_detected_at IS NOT NULL OR NEW.last_observed_at IS NOT NULL
       OR NEW.status <> expected_initial_status
       OR NEW.diagnostic_category <> expected_initial_diagnostic THEN
      RAISE EXCEPTION 'Synchronization state must begin at its exact target origin'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_sync_states_initial_exact';
    END IF;
  END IF;

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
         (event_record.state IN ('succeeded', 'retry', 'dead', 'revoked') AND EXISTS (
           SELECT 1 FROM public.canonical_knowledge_sync_attempts attempt
            WHERE attempt.organization_id = NEW.organization_id
              AND attempt.target_id = NEW.target_id
              AND attempt.outbox_id = NEW.observed_event_id
              AND attempt.outcome = 'succeeded'
              AND rtrim(attempt.observed_projection_digest) =
                  rtrim(NEW.observed_projection_digest)
         ))
         OR
         (event_record.state IN ('retry', 'dead', 'revoked') AND EXISTS (
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
    IF NOT FOUND OR event_record.state NOT IN ('succeeded', 'retry', 'dead', 'revoked')
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
  IF TG_OP = 'UPDATE' AND OLD.observed_sequence IS NOT NULL
     AND (NEW.observed_sequence IS NULL
       OR NEW.observed_sequence < OLD.observed_sequence) THEN
    RAISE EXCEPTION 'Observed synchronization state cannot regress'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_states_observed_monotonic';
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

CREATE OR REPLACE FUNCTION public.canonical_knowledge_revoke_sync_target_work(
  organization_id_value UUID,
  target_id_value UUID
) RETURNS INTEGER AS $$
DECLARE
  target_record public.canonical_knowledge_sync_targets%ROWTYPE;
  diagnostic_value TEXT;
  revoked_count INTEGER := 0;
BEGIN
  SELECT * INTO target_record
    FROM public.canonical_knowledge_sync_targets target
   WHERE target.organization_id = organization_id_value
     AND target.id = target_id_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synchronization revocation requires exact target authority'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_revocation_target_required';
  END IF;
  diagnostic_value := CASE
    WHEN target_record.status = 'suspended' THEN 'target_suspended'
    ELSE 'target_superseded' END;

  UPDATE public.canonical_knowledge_sync_attempts attempt
     SET outcome = 'revoked', diagnostic_category = diagnostic_value,
         observed_projection_digest = NULL, completed_at = statement_timestamp()
    FROM public.canonical_knowledge_sync_outbox outbox
   WHERE outbox.organization_id = organization_id_value
     AND outbox.target_id = target_id_value
     AND outbox.state = 'claimed'
     AND outbox.target_revision < target_record.target_revision
     AND attempt.organization_id = outbox.organization_id
     AND attempt.target_id = outbox.target_id
     AND attempt.outbox_id = outbox.id
     AND attempt.reconciliation_generation = outbox.reconciliation_generation
     AND attempt.attempt_number = outbox.attempt_count
     AND attempt.claim_token = outbox.claim_token
     AND attempt.outcome IS NULL;

  UPDATE public.canonical_knowledge_sync_outbox outbox
     SET state = 'revoked', claim_token = NULL, claimed_at = NULL,
         lease_expires_at = NULL, diagnostic_category = diagnostic_value,
         revoked_at = statement_timestamp()
   WHERE outbox.organization_id = organization_id_value
     AND outbox.target_id = target_id_value
     AND outbox.state IN ('pending', 'retry', 'claimed')
     AND outbox.target_revision < target_record.target_revision;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;
  RETURN revoked_count;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_revoke_sync_target_work_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.canonical_knowledge_revoke_sync_target_work(
    NEW.organization_id, NEW.id
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER canonical_knowledge_sync_targets_revoke_work
  AFTER UPDATE OF target_revision, status
  ON public.canonical_knowledge_sync_targets
  FOR EACH ROW
  WHEN (NEW.target_revision > OLD.target_revision)
  EXECUTE FUNCTION public.canonical_knowledge_revoke_sync_target_work_trigger();

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_sync_target_revocation()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_sync_outbox outbox
     WHERE outbox.organization_id = NEW.organization_id
       AND outbox.target_id = NEW.id
       AND outbox.state IN ('pending', 'retry', 'claimed')
       AND outbox.target_revision < NEW.target_revision
  ) THEN
    RAISE EXCEPTION 'Synchronization target retained superseded delivery authority'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_target_revocation_exact';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE CONSTRAINT TRIGGER canonical_knowledge_sync_targets_require_revocation
  AFTER UPDATE ON public.canonical_knowledge_sync_targets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.canonical_knowledge_require_sync_target_revocation();

DO $$
DECLARE
  target_record RECORD;
BEGIN
  FOR target_record IN
    SELECT DISTINCT target.organization_id, target.id
      FROM public.canonical_knowledge_sync_targets target
      JOIN public.canonical_knowledge_sync_outbox outbox
        ON outbox.organization_id = target.organization_id
       AND outbox.target_id = target.id
     WHERE outbox.state IN ('pending', 'retry', 'claimed')
       AND outbox.target_revision < target.target_revision
  LOOP
    PERFORM public.canonical_knowledge_revoke_sync_target_work(
      target_record.organization_id, target_record.id
    );
  END LOOP;
END;
$$;
