-- Mission 23 Part 8 second correction: preserve 001-050 and narrow final authority.
-- The original implementation remains private; every runtime mutation first
-- checks JSON types, before coercion, locks, authorization, replay or writes.
ALTER FUNCTION public.canonical_completion_mutate(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,BIGINT,TEXT,BIGINT,TEXT,JSONB,TEXT,TEXT,TEXT)
 RENAME TO canonical_completion_mutate_v049;

CREATE FUNCTION public.canonical_completion_mutate(
 organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
 auth_session_id_value UUID, csrf_token_value TEXT, execution_id_value UUID, action_code_value TEXT,
 expected_execution_revision_value BIGINT, expected_execution_digest_value TEXT,
 expected_assignment_revision_value BIGINT, expected_assignment_digest_value TEXT,
 input_value JSONB, idempotency_key_value TEXT, reason_value TEXT, request_correlation_id_value TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF (action_code_value='reopen_execution'
      AND jsonb_typeof(input_value->'nextAction') IS DISTINCT FROM 'string')
  OR (action_code_value='correct_completion' AND (
      jsonb_typeof(input_value->'annotation'->'note') IS DISTINCT FROM 'string'
      OR (jsonb_typeof(input_value->'annotation'->'nextAction') IS DISTINCT FROM 'null'
          AND jsonb_typeof(input_value->'annotation'->'nextAction') IS DISTINCT FROM 'string'))) THEN
  RAISE EXCEPTION 'Completion text input is invalid'
   USING ERRCODE='22023',CONSTRAINT='canonical_completion_input_invalid';
 END IF;
 RETURN public.canonical_completion_mutate_v049(
  organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,
  csrf_token_value,execution_id_value,action_code_value,expected_execution_revision_value,
  expected_execution_digest_value,expected_assignment_revision_value,expected_assignment_digest_value,
  input_value,idempotency_key_value,reason_value,request_correlation_id_value);
END $$;

REVOKE ALL ON FUNCTION public.canonical_completion_mutate(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,BIGINT,TEXT,BIGINT,TEXT,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_completion_mutate_v049(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,BIGINT,TEXT,BIGINT,TEXT,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Runtime-specific table AND column ACLs are reconciled and verified after
-- the runner's broad grants on every startup by transcriptDatabaseAuthority.
-- Keep validated INSERT for canonicalGraphService; unique operation identity
-- plus denied DELETE/provenance UPDATE prevents replacement or rebinding.
REVOKE UPDATE, DELETE ON TABLE public.canonical_transcripts FROM PUBLIC;
REVOKE UPDATE (id,organization_id,operation_id,graph_id,customer_id,source,source_version,
 external_call_id,external_transcript_id,transcript_text,normalized_fingerprint,occurred_at,created_at)
 ON TABLE public.canonical_transcripts FROM PUBLIC;
