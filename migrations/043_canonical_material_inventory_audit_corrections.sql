-- Mission 23 Part 4 audit corrections. Migration 042 remains byte-for-byte frozen.
-- This forward-only unit closes nullable exact pins, serializes every supporting
-- authority change against material reads/writes, makes material text validation
-- code-point based, and exposes an independently paged balance summary.

CREATE OR REPLACE FUNCTION public.canonical_material_text_unicode_contract()
RETURNS JSONB LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,pg_temp AS $function$
  SELECT jsonb_build_object(
    'version','m23-material-text-unicode-v1',
    'sourceSha256','0280502fc832fce9ff2daccb962f3a8a9de36e202441406257d910dce535b74b',
    'maximumCodePoints',500,
    'maximumUtf8Bytes',2000,
    'edgeWhitespaceRanges',jsonb_build_array(
      jsonb_build_array(9,13),jsonb_build_array(32,32),jsonb_build_array(160,160),
      jsonb_build_array(5760,5760),jsonb_build_array(8192,8202),
      jsonb_build_array(8232,8233),jsonb_build_array(8239,8239),
      jsonb_build_array(8287,8287),jsonb_build_array(12288,12288),
      jsonb_build_array(65279,65279)),
    'rejectedCodePointRanges',jsonb_build_array(
      jsonb_build_array(0,31),jsonb_build_array(127,159),jsonb_build_array(173,173),
      jsonb_build_array(847,847),jsonb_build_array(1564,1564),
      jsonb_build_array(4447,4448),jsonb_build_array(6068,6069),
      jsonb_build_array(6158,6158),jsonb_build_array(8203,8207),
      jsonb_build_array(8232,8238),jsonb_build_array(8288,8303),
      jsonb_build_array(10240,10240),jsonb_build_array(12644,12644),
      jsonb_build_array(55296,57343),
      jsonb_build_array(65279,65279),jsonb_build_array(65440,65440),
      jsonb_build_array(65529,65532),jsonb_build_array(65533,65533),
      jsonb_build_array(917504,917631)))
$function$;

CREATE OR REPLACE FUNCTION public.canonical_material_text_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE
  position_value INTEGER; codepoint_value INTEGER;
  first_codepoint INTEGER; last_codepoint INTEGER;
BEGIN
  IF value IS NULL OR char_length(value) NOT BETWEEN 1 AND 500
    OR octet_length(value)>2000 OR value<>normalize(value,NFC) THEN RETURN FALSE; END IF;
  first_codepoint:=ascii(substr(value,1,1));
  last_codepoint:=ascii(substr(value,char_length(value),1));
  IF first_codepoint BETWEEN 9 AND 13 OR first_codepoint IN (32,160,5760,8239,8287,12288,65279)
    OR first_codepoint BETWEEN 8192 AND 8202 OR first_codepoint BETWEEN 8232 AND 8233
    OR last_codepoint BETWEEN 9 AND 13 OR last_codepoint IN (32,160,5760,8239,8287,12288,65279)
    OR last_codepoint BETWEEN 8192 AND 8202 OR last_codepoint BETWEEN 8232 AND 8233 THEN
    RETURN FALSE;
  END IF;
  FOR position_value IN 1..char_length(value) LOOP
    codepoint_value:=ascii(substr(value,position_value,1));
    IF codepoint_value BETWEEN 0 AND 31 OR codepoint_value BETWEEN 127 AND 159
      OR codepoint_value IN (173,847,1564,6158,10240,12644,65279,65440)
      OR codepoint_value BETWEEN 4447 AND 4448 OR codepoint_value BETWEEN 6068 AND 6069
      OR codepoint_value BETWEEN 8203 AND 8207 OR codepoint_value BETWEEN 8232 AND 8238
      OR codepoint_value BETWEEN 8288 AND 8303 OR codepoint_value BETWEEN 65529 AND 65532
      OR codepoint_value BETWEEN 55296 AND 57343 OR codepoint_value=65533
      OR codepoint_value BETWEEN 917504 AND 917631 THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $function$;

CREATE OR REPLACE FUNCTION public.canonical_material_supporting_authority_read_lock()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
  -- The shared session lock must be acquired by the repository before it opens
  -- the transaction. Acquiring a transaction lock from inside this function
  -- would be too late: the calling SQL statement's snapshot already exists.
  -- Refuse direct entry-function calls that bypass that ordered protocol.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks held
     WHERE held.locktype='advisory' AND held.pid=pg_catalog.pg_backend_pid()
       AND held.database=(SELECT oid FROM pg_catalog.pg_database
                           WHERE datname=pg_catalog.current_database())
       AND held.classid=230004 AND held.objid=4 AND held.objsubid=2
       AND held.mode='ShareLock' AND held.granted
  ) THEN
    RAISE EXCEPTION 'Canonical material authority serialization is required'
      USING ERRCODE='40001',CONSTRAINT='canonical_material_authority_changed';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.canonical_material_supporting_authority_write_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(230004,4);
  RETURN NULL;
END $function$;

DO $block$
DECLARE relation_name TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'auth_sessions','subscriptions','organization_onboarding','users',
    'organization_memberships','workforce_profiles','workforce_crew_members',
    'canonical_transcripts','canonical_appointments','canonical_schedule_assignments',
    'canonical_field_executions'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER canonical_material_supporting_authority_serialization '
      'BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_material_supporting_authority_write_lock()',
      relation_name);
  END LOOP;
END $block$;

ALTER FUNCTION public.canonical_material_inventory_mutate(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,UUID,
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,BIGINT,TEXT,
  BIGINT,TEXT,TEXT,TEXT,TEXT) RENAME TO canonical_material_inventory_mutate_v042;

CREATE FUNCTION public.canonical_material_inventory_mutate(
  organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
  auth_session_id_value UUID, csrf_token_value TEXT, execution_id_value UUID,
  action_value TEXT, performer_profile_id_value UUID, movement_kind_value TEXT,
  item_key_value TEXT, description_value TEXT, quantity_text_value TEXT,
  unit_code_value TEXT, unit_contract_version_value TEXT, unit_contract_digest_value TEXT,
  location_key_value TEXT, destination_location_key_value TEXT, lot_code_value TEXT,
  adjustment_direction_value TEXT, movement_id_value UUID,
  expected_movement_revision_value BIGINT, expected_movement_digest_value TEXT,
  review_outcome_value TEXT, expected_execution_revision_value BIGINT,
  expected_execution_digest_value TEXT, expected_assignment_revision_value BIGINT,
  expected_assignment_digest_value TEXT, idempotency_key_value TEXT,
  reason_value TEXT, request_correlation_id_value TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  IF expected_execution_revision_value IS NULL OR expected_execution_digest_value IS NULL
    OR expected_assignment_revision_value IS NULL OR expected_assignment_digest_value IS NULL
    OR (action_value IN ('correct','review','reverse') AND
      (expected_movement_revision_value IS NULL OR expected_movement_digest_value IS NULL)) THEN
    RAISE EXCEPTION 'Canonical material exact pins are required'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_input_invalid';
  END IF;
  PERFORM public.canonical_material_supporting_authority_read_lock();
  RETURN public.canonical_material_inventory_mutate_v042(
    organization_id_value,actor_user_id_value,actor_access_role_value,auth_session_id_value,
    csrf_token_value,execution_id_value,action_value,performer_profile_id_value,
    movement_kind_value,item_key_value,description_value,quantity_text_value,unit_code_value,
    unit_contract_version_value,unit_contract_digest_value,location_key_value,
    destination_location_key_value,lot_code_value,adjustment_direction_value,movement_id_value,
    expected_movement_revision_value,expected_movement_digest_value,review_outcome_value,
    expected_execution_revision_value,expected_execution_digest_value,
    expected_assignment_revision_value,expected_assignment_digest_value,idempotency_key_value,
    reason_value,request_correlation_id_value);
END $function$;

ALTER FUNCTION public.canonical_material_inventory_read(UUID,UUID,TEXT,UUID,UUID)
  RENAME TO canonical_material_inventory_read_v042;

CREATE FUNCTION public.canonical_material_inventory_read(
  organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
  auth_session_id_value UUID, execution_id_value UUID,
  balance_offset_value INTEGER, balance_limit_value INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE
  result_value JSONB; authority JSONB; actor_profile_id UUID;
  balances_value JSONB; total_balance_rows BIGINT; returned_balance_rows INTEGER;
BEGIN
  IF balance_offset_value IS NULL OR balance_limit_value IS NULL
    OR balance_offset_value<0 OR balance_offset_value>10000
    OR balance_limit_value<1 OR balance_limit_value>200 THEN
    RAISE EXCEPTION 'Canonical material balance window is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_input_invalid';
  END IF;
  PERFORM public.canonical_material_supporting_authority_read_lock();
  result_value:=public.canonical_material_inventory_read_v042(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,execution_id_value);
  authority:=public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,NULL,FALSE);
  actor_profile_id:=(authority->>'profileId')::UUID;

  WITH effects AS (
    SELECT movement.item_key,movement.unit_code,movement.location_key,movement.lot_code,
      public.canonical_material_signed_quantity(movement.entry_kind,movement.movement_kind,
        movement.quantity,movement.adjustment_direction) AS delta
    FROM public.canonical_material_movements movement
    WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
      AND movement.review_state<>'rejected' AND movement.movement_kind<>'transferred'
      AND movement.location_key IS NOT NULL
      AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id)
    UNION ALL
    SELECT movement.item_key,movement.unit_code,movement.location_key,movement.lot_code,
      -movement.quantity*CASE movement.entry_kind WHEN 'reversal' THEN -1 ELSE 1 END
    FROM public.canonical_material_movements movement
    WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
      AND movement.review_state<>'rejected' AND movement.movement_kind='transferred'
      AND movement.location_key IS NOT NULL AND movement.destination_location_key IS NOT NULL
      AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id)
    UNION ALL
    SELECT movement.item_key,movement.unit_code,movement.destination_location_key,movement.lot_code,
      movement.quantity*CASE movement.entry_kind WHEN 'reversal' THEN -1 ELSE 1 END
    FROM public.canonical_material_movements movement
    WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
      AND movement.review_state<>'rejected' AND movement.movement_kind='transferred'
      AND movement.location_key IS NOT NULL AND movement.destination_location_key IS NOT NULL
      AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id)
  ), summaries AS (
    SELECT effect.item_key,effect.unit_code,effect.location_key,effect.lot_code,
      sum(effect.delta) AS balance
    FROM effects effect
    GROUP BY effect.item_key,effect.unit_code,effect.location_key,effect.lot_code
  )
  SELECT count(*) INTO total_balance_rows FROM summaries;

  WITH effects AS (
    SELECT movement.item_key,movement.unit_code,movement.location_key,movement.lot_code,
      public.canonical_material_signed_quantity(movement.entry_kind,movement.movement_kind,
        movement.quantity,movement.adjustment_direction) AS delta
    FROM public.canonical_material_movements movement
    WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
      AND movement.review_state<>'rejected' AND movement.movement_kind<>'transferred'
      AND movement.location_key IS NOT NULL
      AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id)
    UNION ALL
    SELECT movement.item_key,movement.unit_code,movement.location_key,movement.lot_code,
      -movement.quantity*CASE movement.entry_kind WHEN 'reversal' THEN -1 ELSE 1 END
    FROM public.canonical_material_movements movement
    WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
      AND movement.review_state<>'rejected' AND movement.movement_kind='transferred'
      AND movement.location_key IS NOT NULL AND movement.destination_location_key IS NOT NULL
      AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id)
    UNION ALL
    SELECT movement.item_key,movement.unit_code,movement.destination_location_key,movement.lot_code,
      movement.quantity*CASE movement.entry_kind WHEN 'reversal' THEN -1 ELSE 1 END
    FROM public.canonical_material_movements movement
    WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
      AND movement.review_state<>'rejected' AND movement.movement_kind='transferred'
      AND movement.location_key IS NOT NULL AND movement.destination_location_key IS NOT NULL
      AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id)
  ), summaries AS (
    SELECT effect.item_key,effect.unit_code,effect.location_key,effect.lot_code,
      sum(effect.delta) AS balance
    FROM effects effect
    GROUP BY effect.item_key,effect.unit_code,effect.location_key,effect.lot_code
    ORDER BY effect.item_key,effect.unit_code,effect.location_key,effect.lot_code
    OFFSET balance_offset_value LIMIT balance_limit_value
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'itemKey',summary.item_key,'unitCode',summary.unit_code,'locationKey',summary.location_key,
      'lotCode',summary.lot_code,'recordedMovementBalance',CASE WHEN summary.balance<0 THEN NULL
        ELSE trim(trailing '.' FROM trim(trailing '0' FROM summary.balance::TEXT)) END,
      'needsReview',summary.balance<0,'stockKnown',FALSE,'conversionApplied',FALSE)
      ORDER BY summary.item_key,summary.unit_code,summary.location_key,summary.lot_code),'[]'::JSONB)
    INTO balances_value FROM summaries summary;
  returned_balance_rows:=jsonb_array_length(balances_value);
  result_value:=jsonb_set(result_value,'{data,balances}',balances_value,TRUE);
  result_value:=jsonb_set(result_value,'{data,totalBalanceCount}',to_jsonb(total_balance_rows),TRUE);
  result_value:=jsonb_set(result_value,'{data,balanceTruncated}',
    to_jsonb(total_balance_rows>returned_balance_rows),TRUE);
  result_value:=jsonb_set(result_value,'{data,balancePage}',jsonb_build_object(
    'offset',balance_offset_value,'limit',balance_limit_value,
    'returnedCount',returned_balance_rows,'totalCount',total_balance_rows,
    'hasPrevious',balance_offset_value>0,
    'hasNext',balance_offset_value+returned_balance_rows<total_balance_rows,
    'previousOffset',CASE WHEN balance_offset_value>0
      THEN greatest(0,balance_offset_value-balance_limit_value) ELSE NULL END,
    'nextOffset',CASE WHEN balance_offset_value+returned_balance_rows<total_balance_rows
      THEN balance_offset_value+returned_balance_rows ELSE NULL END),TRUE);
  RETURN result_value;
END $function$;

REVOKE ALL ON FUNCTION public.canonical_material_text_unicode_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_text_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_supporting_authority_read_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_supporting_authority_write_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_inventory_mutate_v042(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,UUID,
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,BIGINT,TEXT,
  BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_inventory_read_v042(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_inventory_mutate(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,UUID,
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,BIGINT,TEXT,
  BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_inventory_read(UUID,UUID,TEXT,UUID,UUID,INTEGER,INTEGER) FROM PUBLIC;
