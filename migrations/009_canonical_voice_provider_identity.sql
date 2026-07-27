-- Mission 19 Part 3 - separate stable public session identity from provider identity.
-- Additive only: historical rows are intentionally not inferred or backfilled.

BEGIN;

ALTER TABLE canonical_voice_sessions
  ADD COLUMN IF NOT EXISTS provider_session_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_voice_sessions_provider_identity
  ON canonical_voice_sessions(provider, provider_session_id)
  WHERE provider_session_id IS NOT NULL;

COMMIT;
