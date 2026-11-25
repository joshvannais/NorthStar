-- Mission 28 Part 14E: mount the paid Automation Center read projection for
-- the separated application runtime role without exposing canonical storage.

CREATE OR REPLACE FUNCTION public.canonical_automation_center_v1_read(
  organization_id_value UUID,
  actor_user_id_value UUID,
  actor_access_role_value TEXT,
  auth_session_id_value UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  evaluated_at_value TIMESTAMPTZ;
  policies_value JSONB;
  runs_value JSONB;
  records_value JSONB;
  documents_value JSONB;
  channels_value JSONB;
  stop_control_value JSONB;
BEGIN
  IF actor_access_role_value IS NULL
     OR actor_access_role_value NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Current Automation Center read authority is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_automation_center_v1_read_unauthorized';
  END IF;

  PERFORM public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,NULL,FALSE
  );
  -- The canonical automation tables enforce tenant ownership with FORCE RLS.
  -- Establish this transaction-local context only after exact actor, account,
  -- membership, role and session authority succeeds; never trust a caller or
  -- pooled connection's prior setting.
  PERFORM pg_catalog.set_config(
    'northstar.automation_tenant_id',organization_id_value::TEXT,TRUE
  );
  evaluated_at_value := statement_timestamp();

  SELECT COALESCE(jsonb_agg(to_jsonb(bounded_value)
    ORDER BY bounded_value.recorded_at DESC,bounded_value.policy_id),'[]'::jsonb)
    INTO policies_value
    FROM (
      WITH latest_policy AS (
        SELECT DISTINCT ON (policy_id)
          policy_id,version,canonical_digest,document,expires_at,recorded_at
        FROM public.canonical_automation_policy_versions_v1
        WHERE organization_id=organization_id_value
        ORDER BY policy_id,version DESC
      )
      SELECT policy.policy_id,policy.version,policy.expires_at,policy.recorded_at,
        policy.document#>>'{trigger,sourceClassId}' source_class_id,
        policy.document#>>'{action,familyId}' action_family,
        policy.document#>>'{channel,channelId}' channel_id,
        lifecycle.to_state lifecycle_state,
        lifecycle.currentness_marker lifecycle_currentness,
        control.control_state
      FROM latest_policy policy
      LEFT JOIN LATERAL (
        SELECT to_state,currentness_marker
        FROM public.canonical_automation_lifecycle_events_v1
        WHERE organization_id=organization_id_value
          AND policy_id=policy.policy_id AND policy_version=policy.version
        ORDER BY lifecycle_sequence DESC LIMIT 1
      ) lifecycle ON TRUE
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 control
        ON control.organization_id=organization_id_value
       AND control.target_kind='policy_version'
       AND control.policy_id=policy.policy_id
       AND control.policy_version=policy.version
      ORDER BY policy.recorded_at DESC,policy.policy_id
      LIMIT 101
    ) bounded_value;

  SELECT COALESCE(jsonb_agg(to_jsonb(bounded_value)
    ORDER BY COALESCE(bounded_value.latest_recorded_at,bounded_value.recorded_at) DESC,
      bounded_value.run_id),'[]'::jsonb)
    INTO runs_value
    FROM (
      SELECT binding.run_id,binding.policy_id,binding.policy_version,binding.recorded_at,
        latest.record_type latest_record_type,latest.currentness_marker,
        latest.recorded_at latest_recorded_at,
        latest.document#>>'{payload,resultState}' eligibility_state,
        latest.document#>>'{payload,authorityState}' approval_state,
        latest.document#>>'{payload,scheduleState}' schedule_record_state,
        latest.document#>>'{payload,unitState}' unit_state,
        latest.document#>>'{payload,suppressionCode}' suppression_code,
        latest.document#>>'{payload,blocksEffect}' suppression_blocks_effect,
        latest.document#>>'{payload,cancellationState}' cancellation_state,
        latest.document#>>'{payload,authenticated}' reply_authenticated,
        latest.document#>>'{payload,suppressionRequired}' suppression_required,
        latest.document#>>'{payload,reconciliationState}' reconciliation_state,
        latest.document#>>'{payload,terminalState}' terminal_state,
        run_policy.expires_at policy_expires_at,
        policy_lifecycle.to_state policy_lifecycle_state,
        policy_lifecycle.currentness_marker policy_lifecycle_currentness,
        schedule.schedule_id,schedule.transaction_id schedule_transaction_id,
        schedule.expires_at schedule_expires_at,schedule.schedule_count,
        units.action_unit_count,retry.state retry_state,
        retry.next_attempt_at retry_next_attempt_at,retry.updated_at retry_updated_at,
        lease.lease_id,lease.lease_acquired_at,lease.lease_expires_at,
        recovery.transaction_id recovery_transaction_id,
        recovery.policy_id recovery_policy_id,
        recovery.policy_version recovery_policy_version,
        recovery.result_state recovery_state,recovery.recorded_at recovery_recorded_at,
        tenant_control.control_state tenant_control_state,
        policy_control.control_state policy_control_state,
        action_control.control_state action_control_state,
        action_control.execution_phase action_execution_phase,
        action_control.updated_at action_control_updated_at
      FROM public.canonical_automation_historical_run_bindings_v1 binding
      JOIN public.canonical_automation_policy_versions_v1 run_policy
        ON run_policy.organization_id=organization_id_value
       AND run_policy.policy_id=binding.policy_id
       AND run_policy.version=binding.policy_version
      LEFT JOIN LATERAL (
        SELECT to_state,currentness_marker
        FROM public.canonical_automation_lifecycle_events_v1
        WHERE organization_id=organization_id_value
          AND policy_id=binding.policy_id AND policy_version=binding.policy_version
        ORDER BY lifecycle_sequence DESC LIMIT 1
      ) policy_lifecycle ON TRUE
      LEFT JOIN LATERAL (
        SELECT record_type,currentness_marker,recorded_at,document
        FROM public.canonical_automation_records_v1
        WHERE organization_id=organization_id_value AND run_id=binding.run_id
        ORDER BY causal_ordinal DESC LIMIT 1
      ) latest ON TRUE
      LEFT JOIN LATERAL (
        SELECT schedule_id,transaction_id,expires_at,count(*) OVER() schedule_count
        FROM public.canonical_automation_action_schedules_v1
        WHERE organization_id=organization_id_value AND run_id=binding.run_id
        ORDER BY recorded_at DESC LIMIT 1
      ) schedule ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::integer action_unit_count
        FROM public.canonical_automation_action_units_v1
        WHERE organization_id=organization_id_value AND run_id=binding.run_id
      ) units ON TRUE
      LEFT JOIN public.canonical_automation_delivery_retry_heads_v1 retry
        ON retry.organization_id=organization_id_value
       AND retry.schedule_id=schedule.schedule_id
      LEFT JOIN public.canonical_automation_delivery_lease_heads_v1 lease
        ON lease.organization_id=organization_id_value
       AND lease.schedule_id=schedule.schedule_id
      LEFT JOIN LATERAL (
        SELECT transaction_id,policy_id,policy_version,result_state,recorded_at
        FROM public.canonical_automation_recovery_assessments_v1
        WHERE organization_id=organization_id_value AND run_id=binding.run_id
        ORDER BY recorded_at DESC,recovery_id DESC LIMIT 1
      ) recovery ON TRUE
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 tenant_control
        ON tenant_control.organization_id=organization_id_value
       AND tenant_control.target_kind='tenant'
       AND tenant_control.target_key=organization_id_value::text
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 policy_control
        ON policy_control.organization_id=organization_id_value
       AND policy_control.target_kind='policy_version'
       AND policy_control.target_key=binding.policy_id::text||':'||binding.policy_version::text
      LEFT JOIN public.canonical_automation_delivery_control_heads_v1 action_control
        ON action_control.organization_id=organization_id_value
       AND action_control.target_kind='action_schedule'
       AND action_control.target_key=schedule.schedule_id::text
      WHERE binding.organization_id=organization_id_value
      ORDER BY COALESCE(latest.recorded_at,binding.recorded_at) DESC,binding.run_id
      LIMIT 101
    ) bounded_value;

  SELECT COALESCE(jsonb_agg(to_jsonb(bounded_value)
    ORDER BY bounded_value.recorded_at DESC,bounded_value.record_id),'[]'::jsonb)
    INTO records_value
    FROM (
      SELECT record_id,run_id,record_type,currentness_marker,authority_class,recorded_at
      FROM public.canonical_automation_records_v1
      WHERE organization_id=organization_id_value
      ORDER BY recorded_at DESC,record_id LIMIT 101
    ) bounded_value;

  SELECT COALESCE(jsonb_agg(to_jsonb(bounded_value)
    ORDER BY bounded_value.recorded_at DESC,bounded_value.estimate_quote_resolution_id),'[]'::jsonb)
    INTO documents_value
    FROM (
      SELECT estimate_quote_resolution_id,run_id,result_state,recorded_at
      FROM public.canonical_automation_estimate_quote_resolutions_v1
      WHERE organization_id=organization_id_value
      ORDER BY recorded_at DESC,estimate_quote_resolution_id LIMIT 101
    ) bounded_value;

  SELECT COALESCE(jsonb_agg(to_jsonb(bounded_value)
    ORDER BY bounded_value.requested_channel_id),'[]'::jsonb)
    INTO channels_value
    FROM (
      SELECT DISTINCT ON (requested_channel_id)
        requested_channel_id,capability_state,result_state,recorded_at
      FROM public.canonical_automation_channel_resolutions_v1
      WHERE organization_id=organization_id_value
      ORDER BY requested_channel_id,recorded_at DESC LIMIT 101
    ) bounded_value;

  SELECT COALESCE(jsonb_agg(to_jsonb(bounded_value)
    ORDER BY bounded_value.control_sequence DESC),'[]'::jsonb)
    INTO stop_control_value
    FROM (
      SELECT control_state,control_sequence,queued_count,leased_count,
        uncertain_count,permanent_stop_count,updated_at
      FROM public.canonical_automation_delivery_control_heads_v1
      WHERE organization_id=organization_id_value
        AND target_kind='tenant' AND target_key=organization_id_value::text
      ORDER BY control_sequence DESC LIMIT 2
    ) bounded_value;

  RETURN jsonb_build_object(
    'evaluatedAt',to_char(evaluated_at_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'policies',policies_value,
    'runs',runs_value,
    'records',records_value,
    'documents',documents_value,
    'channels',channels_value,
    'stopControl',stop_control_value
  );
END
$function$;

REVOKE ALL ON FUNCTION public.canonical_automation_center_v1_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;

COMMENT ON FUNCTION public.canonical_automation_center_v1_read(UUID,UUID,TEXT,UUID) IS
  'Capability-checked, tenant-private, read-only paid Automation Center projection. No automation or external effect is created.';
