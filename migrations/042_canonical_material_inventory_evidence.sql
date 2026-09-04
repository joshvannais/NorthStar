-- Mission 23 Part 4: canonical material movement and inventory-usage evidence.
-- These records are attributable operational facts and bounded ledger projections.
-- They are not authority for physical stock existence, cost/value, procurement,
-- purchasing, supplier truth, pricing, quotes, invoices, payments, or profitability.

CREATE OR REPLACE FUNCTION public.canonical_material_text_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE
  utf8_value BYTEA; byte_position INTEGER; byte_value INTEGER;
  trim_characters TEXT :=
    chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(133)||chr(160)||chr(5760)||
    chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||
    chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||
    chr(8287)||chr(12288);
BEGIN
  IF value IS NULL OR value<>btrim(value,trim_characters) OR value<>normalize(value,NFC)
    OR char_length(value) NOT BETWEEN 1 AND 500 OR octet_length(value)>2000
    OR position(chr(8203) IN value)>0 OR position(chr(8204) IN value)>0
    OR position(chr(8205) IN value)>0 OR position(chr(8206) IN value)>0
    OR position(chr(8207) IN value)>0 OR position(chr(8232) IN value)>0
    OR position(chr(8233) IN value)>0 OR position(chr(8234) IN value)>0
    OR position(chr(8235) IN value)>0 OR position(chr(8236) IN value)>0
    OR position(chr(8237) IN value)>0 OR position(chr(8238) IN value)>0
    OR position(chr(8239) IN value)>0 OR position(chr(8288) IN value)>0
    OR position(chr(8289) IN value)>0 OR position(chr(8290) IN value)>0
    OR position(chr(8291) IN value)>0 OR position(chr(8292) IN value)>0
    OR position(chr(8293) IN value)>0 OR position(chr(8294) IN value)>0
    OR position(chr(8295) IN value)>0 OR position(chr(8296) IN value)>0
    OR position(chr(8297) IN value)>0 OR position(chr(8298) IN value)>0
    OR position(chr(8299) IN value)>0 OR position(chr(8300) IN value)>0
    OR position(chr(8301) IN value)>0 OR position(chr(8302) IN value)>0
    OR position(chr(8303) IN value)>0 OR position(chr(65279) IN value)>0 THEN RETURN FALSE; END IF;
  utf8_value:=convert_to(value,'UTF8');
  FOR byte_position IN 0..octet_length(utf8_value)-1 LOOP
    byte_value:=get_byte(utf8_value,byte_position);
    IF byte_value BETWEEN 0 AND 31 OR byte_value BETWEEN 127 AND 159 THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $function$;

CREATE OR REPLACE FUNCTION public.canonical_material_key_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,pg_temp AS $function$
  SELECT value IS NOT NULL AND value ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
$function$;

CREATE OR REPLACE FUNCTION public.canonical_material_quantity_text_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,pg_temp AS $function$
DECLARE parsed NUMERIC(18,6);
BEGIN
  IF value IS NULL OR value !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' THEN RETURN FALSE; END IF;
  BEGIN parsed:=value::NUMERIC(18,6); EXCEPTION WHEN OTHERS THEN RETURN FALSE; END;
  RETURN parsed>0 AND parsed<=999999999999.999999::NUMERIC;
END $function$;

CREATE OR REPLACE FUNCTION public.canonical_material_signed_quantity(
  entry_kind_value TEXT, movement_kind_value TEXT, quantity_value NUMERIC,
  adjustment_direction_value TEXT
)
RETURNS NUMERIC LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,pg_temp AS $function$
  SELECT (CASE movement_kind_value
    WHEN 'consumed' THEN -quantity_value
    WHEN 'waste' THEN -quantity_value
    WHEN 'returned' THEN quantity_value
    WHEN 'adjustment' THEN CASE adjustment_direction_value WHEN 'increase' THEN quantity_value ELSE -quantity_value END
    ELSE 0::NUMERIC END) * CASE entry_kind_value WHEN 'reversal' THEN -1 ELSE 1 END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_material_movement_digest(
  movement_id_value UUID, execution_id_value UUID, assignment_id_value UUID,
  performer_profile_id_value UUID, entry_kind_value TEXT, reversal_of_id_value UUID,
  movement_kind_value TEXT, item_key_value TEXT, description_value TEXT,
  quantity_text_value TEXT, unit_code_value TEXT, unit_contract_version_value TEXT,
  unit_contract_digest_value TEXT, location_key_value TEXT,
  destination_location_key_value TEXT, lot_code_value TEXT,
  adjustment_direction_value TEXT, observed_at_value TIMESTAMPTZ,
  review_state_value TEXT, source_execution_revision_value BIGINT,
  source_execution_digest_value TEXT, source_assignment_revision_value BIGINT,
  source_assignment_digest_value TEXT, revision_value BIGINT
)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'adjustmentDirection',adjustment_direction_value,
    'assignmentDigest',source_assignment_digest_value,
    'assignmentId',assignment_id_value,
    'assignmentRevision',source_assignment_revision_value,
    'description',description_value,
    'destinationLocationKey',destination_location_key_value,
    'entryKind',entry_kind_value,
    'executionDigest',source_execution_digest_value,
    'executionId',execution_id_value,
    'executionRevision',source_execution_revision_value,
    'itemKey',item_key_value,
    'locationKey',location_key_value,
    'lotCode',lot_code_value,
    'movementId',movement_id_value,
    'movementKind',movement_kind_value,
    'observedAt',to_char(observed_at_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'performedByProfileId',performer_profile_id_value,
    'quantity',quantity_text_value,
    'reversalOfId',reversal_of_id_value,
    'reviewState',review_state_value,
    'revision',revision_value,
    'unitCode',unit_code_value,
    'unitContractDigest',unit_contract_digest_value,
    'unitContractVersion',unit_contract_version_value
  )::TEXT,'UTF8')),'hex')
$function$;

CREATE TABLE public.canonical_material_movements (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  entry_kind VARCHAR(16) NOT NULL,
  reversal_of_id UUID,
  movement_kind VARCHAR(16) NOT NULL,
  item_key VARCHAR(64) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  quantity NUMERIC(18,6) NOT NULL,
  quantity_text VARCHAR(32) NOT NULL,
  unit_code VARCHAR(64) NOT NULL,
  unit_contract_version VARCHAR(64) NOT NULL,
  unit_contract_digest CHAR(64) NOT NULL,
  location_key VARCHAR(64),
  destination_location_key VARCHAR(64),
  lot_code VARCHAR(64),
  adjustment_direction VARCHAR(16),
  observed_at TIMESTAMPTZ NOT NULL,
  review_state VARCHAR(24) NOT NULL,
  source_execution_revision BIGINT NOT NULL,
  source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  revision BIGINT NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  last_event_id UUID NOT NULL,
  last_recorded_by_user_id UUID NOT NULL,
  last_action_code VARCHAR(16) NOT NULL,
  last_reason TEXT NOT NULL,
  last_transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_material_movements_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_material_movements_execution_fk FOREIGN KEY(organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_movements_assignment_fk FOREIGN KEY(organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_movements_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_movements_recorder_fk FOREIGN KEY(organization_id,last_recorded_by_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_entry_check CHECK(entry_kind IN ('record','reversal')),
  CONSTRAINT canonical_material_reversal_shape CHECK(
    (entry_kind='record' AND reversal_of_id IS NULL) OR
    (entry_kind='reversal' AND reversal_of_id IS NOT NULL)),
  CONSTRAINT canonical_material_kind_check CHECK(movement_kind IN
    ('adjustment','consumed','returned','transferred','waste')),
  CONSTRAINT canonical_material_text_check CHECK(
    public.canonical_material_key_valid(item_key) AND
    public.canonical_material_text_valid(description) AND
    public.canonical_material_key_valid(unit_code) AND
    (location_key IS NULL OR public.canonical_material_key_valid(location_key)) AND
    (destination_location_key IS NULL OR public.canonical_material_key_valid(destination_location_key)) AND
    (lot_code IS NULL OR public.canonical_material_key_valid(lot_code))),
  CONSTRAINT canonical_material_quantity_check CHECK(
    public.canonical_material_quantity_text_valid(quantity_text) AND quantity=quantity_text::NUMERIC(18,6)),
  CONSTRAINT canonical_material_unit_contract_check CHECK(
    unit_contract_version='m23-material-unit-v1' AND
    rtrim(unit_contract_digest)='8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba'),
  CONSTRAINT canonical_material_location_shape CHECK(
    (movement_kind='transferred' AND
      ((location_key IS NULL AND destination_location_key IS NULL) OR
       (location_key IS NOT NULL AND destination_location_key IS NOT NULL AND
        location_key<>destination_location_key))) OR
    (movement_kind<>'transferred' AND destination_location_key IS NULL)),
  CONSTRAINT canonical_material_adjustment_shape CHECK(
    (movement_kind='adjustment' AND adjustment_direction IN ('increase','decrease')) OR
    (movement_kind<>'adjustment' AND adjustment_direction IS NULL)),
  CONSTRAINT canonical_material_review_check CHECK(review_state IN
    ('unreviewed','needs_review','accepted','rejected')),
  CONSTRAINT canonical_material_version_check CHECK(
    source_execution_revision>=1 AND source_assignment_revision>=1 AND revision>=1),
  CONSTRAINT canonical_material_digest_check CHECK(
    unit_contract_digest ~ '^[0-9a-f]{64}$' AND source_execution_digest ~ '^[0-9a-f]{64}$'
    AND source_assignment_digest ~ '^[0-9a-f]{64}$' AND canonical_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_material_action_check CHECK(last_action_code IN ('record','correct','review','reverse')),
  CONSTRAINT canonical_material_reason_check CHECK(public.canonical_field_execution_reason_valid(last_reason))
);

ALTER TABLE public.canonical_material_movements ADD CONSTRAINT canonical_material_reversal_fk
  FOREIGN KEY(organization_id,reversal_of_id)
  REFERENCES public.canonical_material_movements(organization_id,id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX canonical_material_one_reversal
  ON public.canonical_material_movements(organization_id,reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;
CREATE INDEX canonical_material_execution_history
  ON public.canonical_material_movements(organization_id,execution_id,observed_at DESC,id);
CREATE INDEX canonical_material_balance_projection
  ON public.canonical_material_movements(organization_id,item_key,unit_code,location_key,lot_code,id)
  WHERE review_state<>'rejected';

CREATE TABLE public.canonical_material_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  movement_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  auth_session_id UUID NOT NULL,
  action_code VARCHAR(16) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64),
  after_digest CHAR(64) NOT NULL,
  source_execution_revision BIGINT NOT NULL,
  source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL,
  source_assignment_digest CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_material_events_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_material_events_revision_unique UNIQUE(organization_id,movement_id,after_revision),
  CONSTRAINT canonical_material_events_movement_fk FOREIGN KEY(organization_id,movement_id)
    REFERENCES public.canonical_material_movements(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_material_events_execution_fk FOREIGN KEY(organization_id,execution_id)
    REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_events_assignment_fk FOREIGN KEY(organization_id,assignment_id)
    REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_events_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_events_session_fk FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
    REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_events_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_events_action_check CHECK(action_code IN ('record','correct','review','reverse')),
  CONSTRAINT canonical_material_events_revision_check CHECK(
    (action_code IN ('record','reverse') AND before_revision=0 AND after_revision=1 AND before_digest IS NULL) OR
    (action_code IN ('correct','review') AND before_revision>=1 AND after_revision=before_revision+1 AND before_digest IS NOT NULL)),
  CONSTRAINT canonical_material_events_reason_check CHECK(public.canonical_field_execution_reason_valid(reason)),
  CONSTRAINT canonical_material_events_digest_check CHECK(
    (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$') AND after_digest ~ '^[0-9a-f]{64}$'
    AND source_execution_digest ~ '^[0-9a-f]{64}$' AND source_assignment_digest ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$' AND idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_material_events_correlation_check CHECK(request_correlation_id ~ '^[ -~]{1,128}$')
);

ALTER TABLE public.canonical_material_movements ADD CONSTRAINT canonical_material_last_event_fk
  FOREIGN KEY(organization_id,last_event_id) REFERENCES public.canonical_material_events(organization_id,id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.canonical_material_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  movement_id UUID NOT NULL,
  event_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  actor_user_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  action_code VARCHAR(16) NOT NULL,
  reason TEXT NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_material_revisions_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_material_revisions_number_unique UNIQUE(organization_id,movement_id,revision),
  CONSTRAINT canonical_material_revisions_movement_fk FOREIGN KEY(organization_id,movement_id)
    REFERENCES public.canonical_material_movements(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_revisions_event_fk FOREIGN KEY(organization_id,event_id)
    REFERENCES public.canonical_material_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_revisions_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_revisions_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_revisions_shape_check CHECK(jsonb_typeof(snapshot)='object' AND revision>=1),
  CONSTRAINT canonical_material_revisions_digest_check CHECK(snapshot_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_material_revisions_reason_check CHECK(public.canonical_field_execution_reason_valid(reason))
);

CREATE TABLE public.canonical_material_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  movement_id UUID NOT NULL,
  event_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  performer_profile_id UUID NOT NULL,
  action_code VARCHAR(16) NOT NULL,
  reason TEXT NOT NULL,
  before_revision BIGINT NOT NULL,
  after_revision BIGINT NOT NULL,
  before_digest CHAR(64),
  after_digest CHAR(64) NOT NULL,
  authority_evidence JSONB NOT NULL,
  request_digest CHAR(64) NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_material_audit_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_material_audit_event_unique UNIQUE(organization_id,event_id),
  CONSTRAINT canonical_material_audit_movement_fk FOREIGN KEY(organization_id,movement_id)
    REFERENCES public.canonical_material_movements(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_audit_event_fk FOREIGN KEY(organization_id,event_id)
    REFERENCES public.canonical_material_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_audit_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_audit_performer_fk FOREIGN KEY(organization_id,performer_profile_id)
    REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_audit_shape_check CHECK(jsonb_typeof(authority_evidence)='object'),
  CONSTRAINT canonical_material_audit_digest_check CHECK(
    (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$') AND after_digest ~ '^[0-9a-f]{64}$'
    AND request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_material_audit_reason_check CHECK(public.canonical_field_execution_reason_valid(reason))
);

CREATE TABLE public.canonical_material_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  action_code VARCHAR(16) NOT NULL,
  execution_id UUID NOT NULL,
  movement_id UUID NOT NULL,
  event_id UUID NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_material_idempotency_primary PRIMARY KEY(organization_id,actor_user_id,idempotency_key_hash),
  CONSTRAINT canonical_material_idempotency_actor_fk FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_idempotency_movement_fk FOREIGN KEY(organization_id,movement_id)
    REFERENCES public.canonical_material_movements(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_idempotency_event_fk FOREIGN KEY(organization_id,event_id)
    REFERENCES public.canonical_material_events(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_material_idempotency_digest_check CHECK(
    idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT canonical_material_idempotency_response_check CHECK(
    response_status BETWEEN 200 AND 299 AND jsonb_typeof(response_body)='object')
);

CREATE OR REPLACE FUNCTION public.canonical_material_immutable_evidence()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'Canonical material evidence is immutable'
    USING ERRCODE='23514',CONSTRAINT='canonical_material_evidence_immutable';
END $function$;

CREATE TRIGGER canonical_material_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_material_events FOR EACH STATEMENT
  EXECUTE FUNCTION public.canonical_material_immutable_evidence();
CREATE TRIGGER canonical_material_revisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_material_revisions FOR EACH STATEMENT
  EXECUTE FUNCTION public.canonical_material_immutable_evidence();
CREATE TRIGGER canonical_material_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_material_audit_events FOR EACH STATEMENT
  EXECUTE FUNCTION public.canonical_material_immutable_evidence();
CREATE TRIGGER canonical_material_idempotency_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.canonical_material_idempotency FOR EACH STATEMENT
  EXECUTE FUNCTION public.canonical_material_immutable_evidence();

CREATE OR REPLACE FUNCTION public.canonical_material_projection(
  movement_record public.canonical_material_movements
)
RETURNS JSONB LANGUAGE SQL STABLE
SET search_path=pg_catalog,public,pg_temp AS $function$
  SELECT jsonb_build_object(
    'id',movement_record.id,
    'executionId',movement_record.execution_id,
    'assignmentId',movement_record.assignment_id,
    'performedByProfileId',movement_record.performer_profile_id,
    'entryKind',movement_record.entry_kind,
    'reversalOfId',movement_record.reversal_of_id,
    'movementKind',movement_record.movement_kind,
    'itemKey',movement_record.item_key,
    'description',movement_record.description,
    'quantity',movement_record.quantity_text,
    'unitCode',movement_record.unit_code,
    'unitContractVersion',movement_record.unit_contract_version,
    'unitContractDigest',rtrim(movement_record.unit_contract_digest),
    'conversionApplied',FALSE,
    'locationKey',movement_record.location_key,
    'destinationLocationKey',movement_record.destination_location_key,
    'lotCode',movement_record.lot_code,
    'adjustmentDirection',movement_record.adjustment_direction,
    'observedAt',to_char(movement_record.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'reviewState',movement_record.review_state,
    'sourceExecutionRevision',movement_record.source_execution_revision,
    'sourceExecutionDigest',rtrim(movement_record.source_execution_digest),
    'sourceAssignmentRevision',movement_record.source_assignment_revision,
    'sourceAssignmentDigest',rtrim(movement_record.source_assignment_digest),
    'revision',movement_record.revision,
    'digest',rtrim(movement_record.canonical_digest),
    'recordedByUserId',movement_record.last_recorded_by_user_id,
    'lastAction',movement_record.last_action_code,
    'lastReason',movement_record.last_reason,
    'createdAt',to_char(movement_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updatedAt',to_char(movement_record.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
$function$;

CREATE OR REPLACE FUNCTION public.canonical_material_guard_current()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE expected_digest TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Canonical material state cannot be deleted'
    USING ERRCODE='23514',CONSTRAINT='canonical_material_delete_forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.canonical_field_executions execution
      WHERE execution.organization_id=NEW.organization_id AND execution.id=NEW.execution_id
        AND execution.assignment_id=NEW.assignment_id) THEN
    RAISE EXCEPTION 'Canonical material execution and assignment do not match'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_execution_assignment_mismatch'; END IF;
  IF NEW.entry_kind='reversal' AND NOT EXISTS(
    SELECT 1 FROM public.canonical_material_movements source
     WHERE source.organization_id=NEW.organization_id AND source.id=NEW.reversal_of_id
       AND source.entry_kind='record' AND source.execution_id=NEW.execution_id
       AND source.assignment_id=NEW.assignment_id
       AND source.performer_profile_id=NEW.performer_profile_id
       AND source.movement_kind=NEW.movement_kind AND source.item_key=NEW.item_key
       AND source.description=NEW.description AND source.quantity=NEW.quantity
       AND source.quantity_text=NEW.quantity_text AND source.unit_code=NEW.unit_code
       AND source.unit_contract_version=NEW.unit_contract_version
       AND rtrim(source.unit_contract_digest)=rtrim(NEW.unit_contract_digest)
       AND source.location_key IS NOT DISTINCT FROM NEW.location_key
       AND source.destination_location_key IS NOT DISTINCT FROM NEW.destination_location_key
       AND source.lot_code IS NOT DISTINCT FROM NEW.lot_code
       AND source.adjustment_direction IS NOT DISTINCT FROM NEW.adjustment_direction) THEN
    RAISE EXCEPTION 'Canonical material reversal lineage is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_reversal_invalid'; END IF;
  expected_digest:=public.canonical_material_movement_digest(
    NEW.id,NEW.execution_id,NEW.assignment_id,NEW.performer_profile_id,NEW.entry_kind,
    NEW.reversal_of_id,NEW.movement_kind,NEW.item_key,NEW.description,NEW.quantity_text,
    NEW.unit_code,NEW.unit_contract_version,rtrim(NEW.unit_contract_digest),NEW.location_key,
    NEW.destination_location_key,NEW.lot_code,NEW.adjustment_direction,NEW.observed_at,
    NEW.review_state,NEW.source_execution_revision,rtrim(NEW.source_execution_digest),
    NEW.source_assignment_revision,rtrim(NEW.source_assignment_digest),NEW.revision);
  IF rtrim(NEW.canonical_digest)<>expected_digest OR NEW.last_transaction_id<>txid_current()::BIGINT THEN
    RAISE EXCEPTION 'Canonical material digest is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_digest_invalid'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR
       (NEW.entry_kind='record' AND NEW.last_action_code<>'record') OR
       (NEW.entry_kind='reversal' AND NEW.last_action_code<>'reverse') THEN
      RAISE EXCEPTION 'Canonical material initial state is invalid'
        USING ERRCODE='23514',CONSTRAINT='canonical_material_initial_invalid'; END IF;
  ELSE
    IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id
      OR NEW.execution_id<>OLD.execution_id OR NEW.assignment_id<>OLD.assignment_id
      OR NEW.performer_profile_id<>OLD.performer_profile_id OR NEW.entry_kind<>OLD.entry_kind
      OR NEW.reversal_of_id IS DISTINCT FROM OLD.reversal_of_id OR NEW.observed_at<>OLD.observed_at
      OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
      OR NEW.last_action_code NOT IN ('correct','review')
      OR (NEW.entry_kind='reversal' AND NEW.last_action_code<>'review') THEN
      RAISE EXCEPTION 'Canonical material identity is immutable'
        USING ERRCODE='23514',CONSTRAINT='canonical_material_identity_immutable'; END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER canonical_material_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.canonical_material_movements FOR EACH ROW
  EXECUTE FUNCTION public.canonical_material_guard_current();

CREATE OR REPLACE FUNCTION public.canonical_material_validate_complete()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.canonical_material_events event
      WHERE event.organization_id=NEW.organization_id AND event.id=NEW.last_event_id
        AND event.movement_id=NEW.id AND event.execution_id=NEW.execution_id
        AND event.assignment_id=NEW.assignment_id
        AND event.performer_profile_id=NEW.performer_profile_id
        AND event.after_revision=NEW.revision AND rtrim(event.after_digest)=rtrim(NEW.canonical_digest)
        AND event.action_code=NEW.last_action_code
        AND event.source_execution_revision=NEW.source_execution_revision
        AND rtrim(event.source_execution_digest)=rtrim(NEW.source_execution_digest)
        AND event.source_assignment_revision=NEW.source_assignment_revision
        AND rtrim(event.source_assignment_digest)=rtrim(NEW.source_assignment_digest))
    OR NOT EXISTS(SELECT 1 FROM public.canonical_material_revisions revision
      WHERE revision.organization_id=NEW.organization_id AND revision.movement_id=NEW.id
        AND revision.event_id=NEW.last_event_id AND revision.revision=NEW.revision
        AND rtrim(revision.snapshot_digest)=rtrim(NEW.canonical_digest)
        AND revision.snapshot=public.canonical_material_projection(NEW))
    OR NOT EXISTS(SELECT 1 FROM public.canonical_material_audit_events audit
      WHERE audit.organization_id=NEW.organization_id AND audit.movement_id=NEW.id
        AND audit.event_id=NEW.last_event_id AND audit.execution_id=NEW.execution_id
        AND audit.after_revision=NEW.revision AND rtrim(audit.after_digest)=rtrim(NEW.canonical_digest))
    OR NOT EXISTS(SELECT 1 FROM public.canonical_material_idempotency replay
      WHERE replay.organization_id=NEW.organization_id AND replay.movement_id=NEW.id
        AND replay.event_id=NEW.last_event_id AND replay.execution_id=NEW.execution_id) THEN
    RAISE EXCEPTION 'Canonical material evidence set is incomplete'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_evidence_incomplete';
  END IF;
  RETURN NULL;
END $function$;
CREATE CONSTRAINT TRIGGER canonical_material_complete_after_current
  AFTER INSERT OR UPDATE ON public.canonical_material_movements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.canonical_material_validate_complete();

CREATE OR REPLACE FUNCTION public.canonical_material_balance_issue(
  organization_id_value UUID, exclude_movement_id_value UUID,
  entry_kind_value TEXT, movement_kind_value TEXT, item_key_value TEXT,
  quantity_value NUMERIC, unit_code_value TEXT, location_key_value TEXT,
  destination_location_key_value TEXT, lot_code_value TEXT,
  adjustment_direction_value TEXT, review_state_value TEXT
)
RETURNS TEXT LANGUAGE SQL STABLE
SET search_path=pg_catalog,public,pg_temp AS $function$
WITH candidate AS (
  SELECT entry_kind_value AS entry_kind,movement_kind_value AS movement_kind,
    item_key_value AS item_key,quantity_value AS quantity,unit_code_value AS unit_code,
    location_key_value AS location_key,destination_location_key_value AS destination_location_key,
    lot_code_value AS lot_code,adjustment_direction_value AS adjustment_direction,
    review_state_value AS review_state
), rows_after AS (
  SELECT movement.entry_kind,movement.movement_kind,movement.item_key,movement.quantity,
    movement.unit_code,movement.location_key,movement.destination_location_key,movement.lot_code,
    movement.adjustment_direction,movement.review_state
  FROM public.canonical_material_movements movement
  WHERE movement.organization_id=organization_id_value
    AND (exclude_movement_id_value IS NULL OR movement.id<>exclude_movement_id_value)
  UNION ALL SELECT * FROM candidate
), all_effects AS (
  SELECT row_value.item_key,row_value.unit_code,row_value.location_key,row_value.lot_code,
    public.canonical_material_signed_quantity(row_value.entry_kind,row_value.movement_kind,
      row_value.quantity,row_value.adjustment_direction) AS delta
  FROM rows_after row_value
  WHERE row_value.review_state<>'rejected' AND row_value.movement_kind<>'transferred'
    AND row_value.location_key IS NOT NULL
  UNION ALL
  SELECT row_value.item_key,row_value.unit_code,row_value.location_key,row_value.lot_code,
    -row_value.quantity * CASE row_value.entry_kind WHEN 'reversal' THEN -1 ELSE 1 END
  FROM rows_after row_value
  WHERE row_value.review_state<>'rejected' AND row_value.movement_kind='transferred'
    AND row_value.location_key IS NOT NULL AND row_value.destination_location_key IS NOT NULL
  UNION ALL
  SELECT row_value.item_key,row_value.unit_code,row_value.destination_location_key,row_value.lot_code,
    row_value.quantity * CASE row_value.entry_kind WHEN 'reversal' THEN -1 ELSE 1 END
  FROM rows_after row_value
  WHERE row_value.review_state<>'rejected' AND row_value.movement_kind='transferred'
    AND row_value.location_key IS NOT NULL AND row_value.destination_location_key IS NOT NULL
), affected AS (
  SELECT movement.item_key,movement.unit_code,movement.location_key,movement.lot_code
  FROM public.canonical_material_movements movement
  WHERE movement.organization_id=organization_id_value AND movement.id=exclude_movement_id_value
    AND movement.location_key IS NOT NULL
  UNION SELECT movement.item_key,movement.unit_code,movement.destination_location_key,movement.lot_code
  FROM public.canonical_material_movements movement
  WHERE movement.organization_id=organization_id_value AND movement.id=exclude_movement_id_value
    AND movement.destination_location_key IS NOT NULL
  UNION SELECT item_key_value,unit_code_value,location_key_value,lot_code_value
    WHERE location_key_value IS NOT NULL
  UNION SELECT item_key_value,unit_code_value,destination_location_key_value,lot_code_value
    WHERE destination_location_key_value IS NOT NULL
), balances AS (
  SELECT affected.item_key,affected.unit_code,affected.location_key,affected.lot_code,
    COALESCE(sum(all_effects.delta),0::NUMERIC) AS recorded_balance
  FROM affected LEFT JOIN all_effects
    ON all_effects.item_key=affected.item_key AND all_effects.unit_code=affected.unit_code
   AND all_effects.location_key=affected.location_key
   AND all_effects.lot_code IS NOT DISTINCT FROM affected.lot_code
  GROUP BY affected.item_key,affected.unit_code,affected.location_key,affected.lot_code
)
SELECT CASE
  WHEN EXISTS(SELECT 1 FROM balances WHERE abs(recorded_balance)>999999999999.999999::NUMERIC)
    THEN 'overflow'
  WHEN location_key_value IS NULL OR
    (movement_kind_value='transferred' AND destination_location_key_value IS NULL)
    THEN 'unknown'
  WHEN EXISTS(SELECT 1 FROM balances WHERE recorded_balance<0) THEN 'underflow'
  ELSE 'bounded' END
$function$;

CREATE OR REPLACE FUNCTION public.canonical_material_request_digest(
  organization_id_value UUID, actor_user_id_value UUID, auth_session_id_value UUID,
  execution_id_value UUID, action_value TEXT, performer_profile_id_value UUID,
  movement_kind_value TEXT, item_key_value TEXT, description_value TEXT,
  quantity_text_value TEXT, unit_code_value TEXT, unit_contract_version_value TEXT,
  unit_contract_digest_value TEXT, location_key_value TEXT,
  destination_location_key_value TEXT, lot_code_value TEXT, adjustment_direction_value TEXT,
  movement_id_value UUID, movement_revision_value BIGINT, movement_digest_value TEXT,
  review_outcome_value TEXT, execution_revision_value BIGINT, execution_digest_value TEXT,
  assignment_revision_value BIGINT, assignment_digest_value TEXT,
  idempotency_key_hash_value TEXT, reason_value TEXT
)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'action',action_value,'actorUserId',actor_user_id_value,
    'adjustmentDirection',adjustment_direction_value,
    'assignmentDigest',assignment_digest_value,'assignmentRevision',assignment_revision_value,
    'authSessionId',auth_session_id_value,'description',description_value,
    'destinationLocationKey',destination_location_key_value,
    'executionDigest',execution_digest_value,'executionId',execution_id_value,
    'executionRevision',execution_revision_value,'idempotencyKeyHash',idempotency_key_hash_value,
    'itemKey',item_key_value,'locationKey',location_key_value,'lotCode',lot_code_value,
    'movementDigest',movement_digest_value,'movementId',movement_id_value,
    'movementKind',movement_kind_value,'movementRevision',movement_revision_value,
    'organizationId',organization_id_value,'performerProfileId',performer_profile_id_value,
    'quantity',quantity_text_value,'reason',reason_value,'reviewOutcome',review_outcome_value,
    'unitCode',unit_code_value,'unitContractDigest',unit_contract_digest_value,
    'unitContractVersion',unit_contract_version_value
  )::TEXT,'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION public.canonical_material_inventory_mutate(
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
DECLARE
  authority JSONB; actor_profile_id UUID;
  execution_record public.canonical_field_executions%ROWTYPE;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  movement_record public.canonical_material_movements%ROWTYPE;
  replay_record public.canonical_material_idempotency%ROWTYPE;
  actual_movement_id UUID; event_id_value UUID:=gen_random_uuid();
  before_revision_value BIGINT:=0; after_revision_value BIGINT:=1;
  before_digest_value TEXT; after_digest_value TEXT; request_digest_value TEXT;
  idempotency_hash_value TEXT; response_body_value JSONB; snapshot_value JSONB;
  effective_kind TEXT; effective_item TEXT; effective_description TEXT;
  effective_quantity_text TEXT; effective_unit TEXT; effective_location TEXT;
  effective_destination TEXT; effective_lot TEXT; effective_adjustment TEXT;
  effective_review TEXT; effective_entry TEXT:='record'; effective_reversal UUID;
  effective_observed TIMESTAMPTZ:=transaction_timestamp(); balance_issue TEXT;
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' THEN
    RAISE EXCEPTION 'Canonical material mutations require serializable isolation'
      USING ERRCODE='25001',CONSTRAINT='canonical_material_serializable_required'; END IF;
  IF organization_id_value IS NULL OR actor_user_id_value IS NULL OR auth_session_id_value IS NULL
    OR execution_id_value IS NULL OR performer_profile_id_value IS NULL
    OR action_value NOT IN ('record','correct','review','reverse')
    OR expected_execution_revision_value<1 OR expected_execution_digest_value !~ '^[0-9a-f]{64}$'
    OR expected_assignment_revision_value<1 OR expected_assignment_digest_value !~ '^[0-9a-f]{64}$'
    OR unit_contract_version_value<>'m23-material-unit-v1'
    OR unit_contract_digest_value<>'8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba'
    OR idempotency_key_value IS NULL OR idempotency_key_value<>btrim(idempotency_key_value)
    OR idempotency_key_value !~ '^[!-~]{16,128}$'
    OR NOT public.canonical_field_execution_reason_valid(reason_value)
    OR request_correlation_id_value !~ '^[ -~]{1,128}$' THEN
    RAISE EXCEPTION 'Canonical material input is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_input_invalid'; END IF;
  IF (action_value IN ('record','correct') AND (
      movement_kind_value NOT IN ('adjustment','consumed','returned','transferred','waste')
      OR NOT public.canonical_material_key_valid(item_key_value)
      OR NOT public.canonical_material_text_valid(description_value)
      OR NOT public.canonical_material_quantity_text_valid(quantity_text_value)
      OR NOT public.canonical_material_key_valid(unit_code_value)
      OR (location_key_value IS NOT NULL AND NOT public.canonical_material_key_valid(location_key_value))
      OR (destination_location_key_value IS NOT NULL AND NOT public.canonical_material_key_valid(destination_location_key_value))
      OR (lot_code_value IS NOT NULL AND NOT public.canonical_material_key_valid(lot_code_value))
      OR (movement_kind_value='transferred' AND
        ((location_key_value IS NULL)<>(destination_location_key_value IS NULL)
         OR location_key_value=destination_location_key_value))
      OR (movement_kind_value<>'transferred' AND destination_location_key_value IS NOT NULL)
      OR (movement_kind_value='adjustment' AND adjustment_direction_value NOT IN ('increase','decrease'))
      OR (movement_kind_value<>'adjustment' AND adjustment_direction_value IS NOT NULL)))
    OR (action_value IN ('review','reverse') AND
      (movement_kind_value IS NOT NULL OR item_key_value IS NOT NULL OR description_value IS NOT NULL
       OR quantity_text_value IS NOT NULL OR unit_code_value IS NOT NULL OR location_key_value IS NOT NULL
       OR destination_location_key_value IS NOT NULL OR lot_code_value IS NOT NULL
       OR adjustment_direction_value IS NOT NULL))
    OR (action_value IN ('correct','review','reverse') AND
      (movement_id_value IS NULL OR expected_movement_revision_value<1
       OR expected_movement_digest_value !~ '^[0-9a-f]{64}$'))
    OR (action_value='record' AND
      (movement_id_value IS NOT NULL OR expected_movement_revision_value IS NOT NULL
       OR expected_movement_digest_value IS NOT NULL))
    OR (action_value='review' AND review_outcome_value NOT IN ('accepted','rejected'))
    OR (action_value<>'review' AND review_outcome_value IS NOT NULL) THEN
    RAISE EXCEPTION 'Canonical material action input is invalid'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_input_invalid'; END IF;

  authority:=public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,csrf_token_value,TRUE);
  actor_profile_id:=(authority->>'profileId')::UUID;
  SELECT execution.* INTO execution_record
    FROM public.canonical_field_executions execution
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=execution.organization_id
     AND appointment.id=execution.appointment_id
     AND appointment.operation_id=execution.operation_id
     AND appointment.graph_id=execution.graph_id
     AND appointment.opportunity_id=execution.opportunity_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=execution.organization_id
     AND transcript.operation_id=execution.operation_id AND transcript.graph_id=execution.graph_id
   WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value
     AND lower(btrim(appointment.status)) NOT IN ('cancelled','completed')
     AND public.canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice')
   FOR UPDATE OF execution;
  IF NOT FOUND THEN RAISE EXCEPTION 'Field execution not found'
    USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found'; END IF;
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments assignment
   WHERE assignment.organization_id=organization_id_value AND assignment.id=execution_record.assignment_id
   FOR SHARE;
  IF NOT FOUND OR assignment_record.target_state<>'assigned'
    OR assignment_record.dispatch_state<>'dispatched'
    OR lower(btrim(assignment_record.appointment_status)) IN ('cancelled','completed') THEN
    RAISE EXCEPTION 'Current dispatched assignment is required'
      USING ERRCODE='42501',CONSTRAINT='canonical_material_dispatch_required'; END IF;
  IF action_value='record' AND execution_record.lifecycle_state<>'in_progress' THEN
    RAISE EXCEPTION 'Material recording requires an in-progress field execution'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_action_invalid'; END IF;
  IF execution_record.revision<>expected_execution_revision_value
    OR rtrim(execution_record.canonical_digest)<>expected_execution_digest_value
    OR assignment_record.revision<>expected_assignment_revision_value
    OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest_value THEN
    RAISE EXCEPTION 'Canonical material source pins are stale'
      USING ERRCODE='40001',CONSTRAINT='canonical_material_stale_source'; END IF;
  IF NOT public.canonical_field_execution_actor_in_scope(
      organization_id_value,actor_access_role_value,actor_profile_id,assignment_record) THEN
    RAISE EXCEPTION 'Actor scope unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_material_actor_scope_forbidden'; END IF;
  IF actor_access_role_value='member' AND performer_profile_id_value<>actor_profile_id THEN
    RAISE EXCEPTION 'Members may only record their own material evidence'
      USING ERRCODE='42501',CONSTRAINT='canonical_material_performer_forged'; END IF;
  IF NOT (assignment_record.workforce_profile_id=performer_profile_id_value OR
    (assignment_record.workforce_crew_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.workforce_crew_members cm
      JOIN public.workforce_profiles wp ON wp.organization_id=cm.organization_id AND wp.id=cm.profile_id
      JOIN public.organization_memberships om ON om.organization_id=wp.organization_id AND om.id=wp.membership_id
      JOIN public.users u ON u.organization_id=om.organization_id AND u.id=om.user_id
      WHERE cm.organization_id=organization_id_value AND cm.crew_id=assignment_record.workforce_crew_id
        AND cm.profile_id=performer_profile_id_value AND om.status='active' AND u.status='active'))) THEN
    RAISE EXCEPTION 'Performer is outside the current assignment'
      USING ERRCODE='42501',CONSTRAINT='canonical_material_performer_scope_forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles wp
    JOIN public.organization_memberships om ON om.organization_id=wp.organization_id AND om.id=wp.membership_id
    JOIN public.users u ON u.organization_id=om.organization_id AND u.id=om.user_id
    WHERE wp.organization_id=organization_id_value AND wp.id=performer_profile_id_value
      AND om.status='active' AND u.status='active') THEN
    RAISE EXCEPTION 'Performer authority is unavailable'
      USING ERRCODE='42501',CONSTRAINT='canonical_material_performer_scope_forbidden'; END IF;
  IF movement_kind_value='adjustment' AND actor_access_role_value NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Material adjustment requires owner or admin review authority'
      USING ERRCODE='42501',CONSTRAINT='canonical_material_adjustment_forbidden'; END IF;
  IF action_value='review' AND actor_access_role_value NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Material review requires owner or admin authority'
      USING ERRCODE='42501',CONSTRAINT='canonical_material_review_forbidden'; END IF;

  idempotency_hash_value:=encode(sha256(convert_to(idempotency_key_value,'UTF8')),'hex');
  request_digest_value:=public.canonical_material_request_digest(
    organization_id_value,actor_user_id_value,auth_session_id_value,execution_id_value,
    action_value,performer_profile_id_value,movement_kind_value,item_key_value,description_value,
    quantity_text_value,unit_code_value,unit_contract_version_value,unit_contract_digest_value,
    location_key_value,destination_location_key_value,lot_code_value,adjustment_direction_value,
    movement_id_value,expected_movement_revision_value,expected_movement_digest_value,
    review_outcome_value,expected_execution_revision_value,expected_execution_digest_value,
    expected_assignment_revision_value,expected_assignment_digest_value,idempotency_hash_value,reason_value);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    organization_id_value::TEXT||':'||actor_user_id_value::TEXT||':'||idempotency_hash_value,2));
  SELECT * INTO replay_record FROM public.canonical_material_idempotency replay
   WHERE replay.organization_id=organization_id_value AND replay.actor_user_id=actor_user_id_value
     AND rtrim(replay.idempotency_key_hash)=idempotency_hash_value;
  IF FOUND THEN
    IF rtrim(replay_record.request_digest)<>request_digest_value
      OR replay_record.action_code<>action_value OR replay_record.execution_id<>execution_id_value THEN
      RAISE EXCEPTION 'Material idempotency conflict'
        USING ERRCODE='23505',CONSTRAINT='canonical_material_idempotency_conflict'; END IF;
    IF NOT public.canonical_field_execution_replay_authorized(
        organization_id_value,actor_access_role_value,actor_profile_id,execution_id_value,NULL) THEN
      RAISE EXCEPTION 'Material replay authority unavailable'
        USING ERRCODE='42501',CONSTRAINT='canonical_material_replay_unauthorized'; END IF;
    RETURN jsonb_build_object('status',replay_record.response_status,
      'body',replay_record.response_body,'replayed',TRUE);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    organization_id_value::TEXT||':canonical-material-ledger',4));
  actual_movement_id:=COALESCE(movement_id_value,gen_random_uuid());
  IF action_value IN ('correct','review','reverse') THEN
    SELECT * INTO movement_record FROM public.canonical_material_movements movement
     WHERE movement.organization_id=organization_id_value AND movement.id=movement_id_value FOR UPDATE;
    IF NOT FOUND OR movement_record.execution_id<>execution_id_value THEN
      RAISE EXCEPTION 'Material movement not found'
        USING ERRCODE='P0002',CONSTRAINT='canonical_material_movement_not_found'; END IF;
    IF movement_record.performer_profile_id<>performer_profile_id_value THEN
      RAISE EXCEPTION 'Forged material performer'
        USING ERRCODE='42501',CONSTRAINT='canonical_material_performer_forged'; END IF;
    IF movement_record.revision<>expected_movement_revision_value
      OR rtrim(movement_record.canonical_digest)<>expected_movement_digest_value THEN
      RAISE EXCEPTION 'Material movement is stale'
        USING ERRCODE='40001',CONSTRAINT='canonical_material_stale_movement'; END IF;
    IF (action_value IN ('correct','reverse') AND movement_record.entry_kind<>'record')
      OR (action_value='reverse' AND movement_record.review_state='rejected') OR EXISTS(
      SELECT 1 FROM public.canonical_material_movements reversal
       WHERE reversal.organization_id=organization_id_value AND reversal.reversal_of_id=movement_record.id) THEN
      RAISE EXCEPTION 'Material movement is already reversed'
        USING ERRCODE='23514',CONSTRAINT='canonical_material_reversal_invalid'; END IF;
    before_revision_value:=movement_record.revision;
    before_digest_value:=rtrim(movement_record.canonical_digest);
    after_revision_value:=before_revision_value+1;
    effective_observed:=movement_record.observed_at;
  END IF;

  IF action_value='record' THEN
    effective_kind:=movement_kind_value; effective_item:=item_key_value;
    effective_description:=description_value; effective_quantity_text:=quantity_text_value;
    effective_unit:=unit_code_value; effective_location:=location_key_value;
    effective_destination:=destination_location_key_value; effective_lot:=lot_code_value;
    effective_adjustment:=adjustment_direction_value; effective_review:='unreviewed';
  ELSIF action_value='correct' THEN
    effective_kind:=movement_kind_value; effective_item:=item_key_value;
    effective_description:=description_value; effective_quantity_text:=quantity_text_value;
    effective_unit:=unit_code_value; effective_location:=location_key_value;
    effective_destination:=destination_location_key_value; effective_lot:=lot_code_value;
    effective_adjustment:=adjustment_direction_value; effective_review:=movement_record.review_state;
  ELSIF action_value='review' THEN
    effective_entry:=movement_record.entry_kind; effective_reversal:=movement_record.reversal_of_id;
    effective_kind:=movement_record.movement_kind; effective_item:=movement_record.item_key;
    effective_description:=movement_record.description; effective_quantity_text:=movement_record.quantity_text;
    effective_unit:=movement_record.unit_code; effective_location:=movement_record.location_key;
    effective_destination:=movement_record.destination_location_key; effective_lot:=movement_record.lot_code;
    effective_adjustment:=movement_record.adjustment_direction; effective_review:=review_outcome_value;
  ELSE
    actual_movement_id:=gen_random_uuid(); effective_entry:='reversal'; effective_reversal:=movement_record.id;
    effective_kind:=movement_record.movement_kind; effective_item:=movement_record.item_key;
    effective_description:=movement_record.description; effective_quantity_text:=movement_record.quantity_text;
    effective_unit:=movement_record.unit_code; effective_location:=movement_record.location_key;
    effective_destination:=movement_record.destination_location_key; effective_lot:=movement_record.lot_code;
    effective_adjustment:=movement_record.adjustment_direction; effective_review:='needs_review';
    before_revision_value:=0; before_digest_value:=NULL; after_revision_value:=1;
  END IF;

  balance_issue:=public.canonical_material_balance_issue(
    organization_id_value,CASE WHEN action_value IN ('correct','review') THEN movement_id_value ELSE NULL END,
    effective_entry,effective_kind,effective_item,effective_quantity_text::NUMERIC(18,6),effective_unit,
    effective_location,effective_destination,effective_lot,effective_adjustment,effective_review);
  IF balance_issue='overflow' THEN RAISE EXCEPTION 'Material recorded balance exceeds the bounded range'
    USING ERRCODE='22003',CONSTRAINT='canonical_material_balance_overflow'; END IF;
  IF action_value='review' AND review_outcome_value='accepted' AND balance_issue IN ('underflow','unknown') THEN
    RAISE EXCEPTION 'Material evidence still requires review'
      USING ERRCODE='23514',CONSTRAINT='canonical_material_balance_review_required'; END IF;
  IF action_value IN ('record','correct') AND
     (balance_issue IN ('underflow','unknown') OR effective_kind='adjustment') THEN
    effective_review:='needs_review';
  END IF;

  after_digest_value:=public.canonical_material_movement_digest(
    actual_movement_id,execution_id_value,execution_record.assignment_id,performer_profile_id_value,
    effective_entry,effective_reversal,effective_kind,effective_item,effective_description,
    effective_quantity_text,effective_unit,unit_contract_version_value,unit_contract_digest_value,
    effective_location,effective_destination,effective_lot,effective_adjustment,effective_observed,
    effective_review,execution_record.revision,rtrim(execution_record.canonical_digest),
    assignment_record.revision,rtrim(assignment_record.canonical_digest),after_revision_value);

  IF action_value IN ('record','reverse') THEN
    INSERT INTO public.canonical_material_movements(
      id,organization_id,execution_id,assignment_id,performer_profile_id,entry_kind,reversal_of_id,
      movement_kind,item_key,description,quantity,quantity_text,unit_code,unit_contract_version,
      unit_contract_digest,location_key,destination_location_key,lot_code,adjustment_direction,
      observed_at,review_state,source_execution_revision,source_execution_digest,
      source_assignment_revision,source_assignment_digest,revision,canonical_digest,last_event_id,
      last_recorded_by_user_id,last_action_code,last_reason,last_transaction_id)
    VALUES(actual_movement_id,organization_id_value,execution_id_value,execution_record.assignment_id,
      performer_profile_id_value,effective_entry,effective_reversal,effective_kind,effective_item,
      effective_description,effective_quantity_text::NUMERIC(18,6),effective_quantity_text,effective_unit,
      unit_contract_version_value,unit_contract_digest_value,effective_location,effective_destination,
      effective_lot,effective_adjustment,effective_observed,effective_review,execution_record.revision,
      rtrim(execution_record.canonical_digest),assignment_record.revision,
      rtrim(assignment_record.canonical_digest),after_revision_value,after_digest_value,event_id_value,
      actor_user_id_value,action_value,reason_value,txid_current()::BIGINT);
  ELSE
    UPDATE public.canonical_material_movements SET
      movement_kind=effective_kind,item_key=effective_item,description=effective_description,
      quantity=effective_quantity_text::NUMERIC(18,6),quantity_text=effective_quantity_text,
      unit_code=effective_unit,unit_contract_version=unit_contract_version_value,
      unit_contract_digest=unit_contract_digest_value,location_key=effective_location,
      destination_location_key=effective_destination,lot_code=effective_lot,
      adjustment_direction=effective_adjustment,review_state=effective_review,
      source_execution_revision=execution_record.revision,
      source_execution_digest=rtrim(execution_record.canonical_digest),
      source_assignment_revision=assignment_record.revision,
      source_assignment_digest=rtrim(assignment_record.canonical_digest),
      revision=after_revision_value,canonical_digest=after_digest_value,last_event_id=event_id_value,
      last_recorded_by_user_id=actor_user_id_value,last_action_code=action_value,last_reason=reason_value,
      last_transaction_id=txid_current()::BIGINT,updated_at=transaction_timestamp()
    WHERE organization_id=organization_id_value AND id=actual_movement_id;
  END IF;

  SELECT public.canonical_material_projection(movement) INTO snapshot_value
    FROM public.canonical_material_movements movement
   WHERE movement.organization_id=organization_id_value AND movement.id=actual_movement_id;
  INSERT INTO public.canonical_material_events(
    id,organization_id,movement_id,execution_id,assignment_id,actor_user_id,
    performer_profile_id,auth_session_id,action_code,reason,before_revision,after_revision,
    before_digest,after_digest,source_execution_revision,source_execution_digest,
    source_assignment_revision,source_assignment_digest,request_digest,idempotency_key_hash,
    request_correlation_id)
  VALUES(event_id_value,organization_id_value,actual_movement_id,execution_id_value,
    execution_record.assignment_id,actor_user_id_value,performer_profile_id_value,
    auth_session_id_value,action_value,reason_value,before_revision_value,after_revision_value,
    before_digest_value,after_digest_value,execution_record.revision,
    rtrim(execution_record.canonical_digest),assignment_record.revision,
    rtrim(assignment_record.canonical_digest),request_digest_value,idempotency_hash_value,
    request_correlation_id_value);
  INSERT INTO public.canonical_material_revisions(
    organization_id,movement_id,event_id,revision,snapshot,snapshot_digest,actor_user_id,
    performer_profile_id,action_code,reason)
  VALUES(organization_id_value,actual_movement_id,event_id_value,after_revision_value,snapshot_value,
    after_digest_value,actor_user_id_value,performer_profile_id_value,action_value,reason_value);
  INSERT INTO public.canonical_material_audit_events(
    organization_id,movement_id,event_id,execution_id,actor_user_id,performer_profile_id,
    action_code,reason,before_revision,after_revision,before_digest,after_digest,
    authority_evidence,request_digest,request_correlation_id)
  VALUES(organization_id_value,actual_movement_id,event_id_value,execution_id_value,
    actor_user_id_value,performer_profile_id_value,action_value,reason_value,before_revision_value,
    after_revision_value,before_digest_value,after_digest_value,jsonb_build_object(
      'assignmentId',execution_record.assignment_id,'assignmentRevision',assignment_record.revision,
      'assignmentDigest',rtrim(assignment_record.canonical_digest),
      'executionRevision',execution_record.revision,'executionDigest',rtrim(execution_record.canonical_digest),
      'actorProfileId',actor_profile_id,'performedByProfileId',performer_profile_id_value,
      'role',actor_access_role_value,'balanceDisposition',balance_issue),
    request_digest_value,request_correlation_id_value);
  response_body_value:=jsonb_build_object('success',TRUE,'requestId',request_correlation_id_value,
    'data',jsonb_build_object(
    'executionId',execution_id_value,'material',snapshot_value,
    'balanceDisposition',balance_issue,'stockKnown',FALSE,
    'interpretation','Recorded material movement and usage evidence only; not physical stock existence, stock value, cost, procurement, pricing, invoice, payment, or profitability authority.'));
  INSERT INTO public.canonical_material_idempotency(
    organization_id,actor_user_id,idempotency_key_hash,request_digest,action_code,
    execution_id,movement_id,event_id,response_status,response_body)
  VALUES(organization_id_value,actor_user_id_value,idempotency_hash_value,request_digest_value,
    action_value,execution_id_value,actual_movement_id,event_id_value,200,response_body_value);
  RETURN jsonb_build_object('status',200,'body',response_body_value,'replayed',FALSE);
END $function$;

CREATE OR REPLACE FUNCTION public.canonical_material_inventory_read(
  organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
  auth_session_id_value UUID, execution_id_value UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE
  authority JSONB; actor_profile_id UUID;
  execution_record public.canonical_field_executions%ROWTYPE;
  assignment_record public.canonical_schedule_assignments%ROWTYPE;
  movements JSONB; balances JSONB; total_rows BIGINT;
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
    RAISE EXCEPTION 'Canonical material reads require a bounded snapshot'
      USING ERRCODE='25001',CONSTRAINT='canonical_material_snapshot_required'; END IF;
  authority:=public.canonical_field_execution_actor_authority(
    organization_id_value,actor_user_id_value,actor_access_role_value,
    auth_session_id_value,NULL,FALSE);
  actor_profile_id:=(authority->>'profileId')::UUID;
  SELECT execution.* INTO execution_record FROM public.canonical_field_executions execution
    JOIN public.canonical_appointments appointment
      ON appointment.organization_id=execution.organization_id
     AND appointment.id=execution.appointment_id
     AND appointment.operation_id=execution.operation_id
     AND appointment.graph_id=execution.graph_id
     AND appointment.opportunity_id=execution.opportunity_id
    JOIN public.canonical_transcripts transcript
      ON transcript.organization_id=execution.organization_id
     AND transcript.operation_id=execution.operation_id AND transcript.graph_id=execution.graph_id
   WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value
     AND lower(btrim(appointment.status)) NOT IN ('cancelled','completed')
     AND public.canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice');
  IF NOT FOUND THEN RAISE EXCEPTION 'Field execution not found'
    USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found'; END IF;
  SELECT * INTO assignment_record FROM public.canonical_schedule_assignments assignment
   WHERE assignment.organization_id=organization_id_value AND assignment.id=execution_record.assignment_id;
  IF NOT FOUND OR assignment_record.target_state<>'assigned'
    OR assignment_record.dispatch_state<>'dispatched'
    OR lower(btrim(assignment_record.appointment_status)) IN ('cancelled','completed')
    OR actor_access_role_value NOT IN ('owner','admin','member')
    OR (actor_access_role_value='member' AND NOT public.canonical_field_execution_actor_in_scope(
      organization_id_value,actor_access_role_value,actor_profile_id,assignment_record)) THEN
    RAISE EXCEPTION 'Field execution not found'
      USING ERRCODE='P0002',CONSTRAINT='canonical_field_execution_not_found'; END IF;

  SELECT count(*) INTO total_rows FROM public.canonical_material_movements movement
   WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
     AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id);
  SELECT COALESCE(jsonb_agg(public.canonical_material_projection(row_value)
      ORDER BY row_value.observed_at DESC,row_value.id),'[]'::JSONB)
    INTO movements FROM (SELECT * FROM public.canonical_material_movements movement
      WHERE movement.organization_id=organization_id_value AND movement.execution_id=execution_id_value
        AND (actor_access_role_value IN ('owner','admin') OR movement.performer_profile_id=actor_profile_id)
      ORDER BY movement.observed_at DESC,movement.id LIMIT 200) row_value;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'itemKey',summary.item_key,'unitCode',summary.unit_code,'locationKey',summary.location_key,
      'lotCode',summary.lot_code,'recordedMovementBalance',CASE WHEN summary.balance<0 THEN NULL
        ELSE trim(trailing '.' FROM trim(trailing '0' FROM summary.balance::TEXT)) END,
      'needsReview',summary.balance<0,'stockKnown',FALSE,'conversionApplied',FALSE)
      ORDER BY summary.item_key,summary.unit_code,summary.location_key,summary.lot_code),'[]'::JSONB)
    INTO balances FROM (
      SELECT effect.item_key,effect.unit_code,effect.location_key,effect.lot_code,sum(effect.delta) AS balance
      FROM (
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
      ) effect GROUP BY effect.item_key,effect.unit_code,effect.location_key,effect.lot_code
      ORDER BY effect.item_key,effect.unit_code,effect.location_key,effect.lot_code LIMIT 200
    ) summary;
  RETURN jsonb_build_object('success',TRUE,'data',jsonb_build_object(
    'executionId',execution_id_value,'movements',movements,'totalMovementCount',total_rows,
    'truncated',total_rows>200,'balances',balances,'balanceScope','visible execution evidence only',
    'stockKnown',FALSE,'unitContract',jsonb_build_object(
      'version','m23-material-unit-v1',
      'digest','8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba',
      'quantity','positive decimal string with at most 12 integer digits and scale 6',
      'conversionPolicy','none'),
    'interpretation','Recorded material movement and usage evidence only; balances are bounded projections from visible accepted or pending evidence, not physical stock existence, stock value, cost, procurement, pricing, invoice, payment, or profitability authority.'));
END $function$;

REVOKE ALL ON FUNCTION public.canonical_material_text_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_key_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_quantity_text_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_signed_quantity(TEXT,TEXT,NUMERIC,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_movement_digest(UUID,UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,BIGINT,TEXT,BIGINT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_projection(public.canonical_material_movements) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_immutable_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_guard_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_validate_complete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_balance_issue(UUID,UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_request_digest(UUID,UUID,UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,BIGINT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_inventory_mutate(UUID,UUID,TEXT,UUID,TEXT,UUID,TEXT,UUID,
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,BIGINT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_inventory_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
