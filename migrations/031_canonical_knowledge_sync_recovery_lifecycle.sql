-- Mission 21 Part 6 - synchronization recovery and finalization lifecycle exactness.
-- This migration stores no credential and performs no provider or network call.

CREATE OR REPLACE FUNCTION public.canonical_knowledge_sync_historical_observation_is_exact(
  outbox_id_value UUID,
  observed_digest_value CHAR(64)
) RETURNS BOOLEAN AS $$
  SELECT observed_digest_value IS NULL OR EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_sync_attempts attempt
     WHERE attempt.outbox_id = outbox_id_value
       AND attempt.outcome IN ('succeeded', 'drift')
       AND rtrim(attempt.observed_projection_digest) = rtrim(observed_digest_value)
  );
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public;

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
    AND (
      (NEW.outcome IN ('succeeded', 'drift')
        AND rtrim(outbox_record.observed_projection_digest) IS NOT DISTINCT FROM
          rtrim(NEW.observed_projection_digest))
      OR
      (NEW.outcome IN ('retry', 'dead', 'claim_expired', 'revoked')
        AND NEW.observed_projection_digest IS NULL
        AND public.canonical_knowledge_sync_historical_observation_is_exact(
          outbox_record.id, outbox_record.observed_projection_digest
        ))
    )
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
        AND (
          (attempt_record.outcome IN ('succeeded', 'drift')
            AND rtrim(attempt_record.observed_projection_digest) IS NOT DISTINCT FROM
              rtrim(outbox_record.observed_projection_digest))
          OR
          (attempt_record.outcome IN ('retry', 'dead', 'claim_expired')
            AND attempt_record.observed_projection_digest IS NULL
            AND public.canonical_knowledge_sync_historical_observation_is_exact(
              outbox_record.id, outbox_record.observed_projection_digest
            ))
        )
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
     AND target.id = target_id_value
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Synchronization revocation requires exact target authority'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_sync_revocation_target_required';
  END IF;
  diagnostic_value := CASE
    WHEN target_record.status = 'suspended' THEN 'target_suspended'
    ELSE 'target_superseded' END;

  PERFORM 1
    FROM public.canonical_knowledge_sync_outbox outbox
   WHERE outbox.organization_id = organization_id_value
     AND outbox.target_id = target_id_value
     AND outbox.state IN ('pending', 'retry', 'claimed')
     AND outbox.target_revision < target_record.target_revision
   ORDER BY outbox.id
   FOR UPDATE;

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
