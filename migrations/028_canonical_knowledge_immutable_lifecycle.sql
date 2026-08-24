-- Mission 21 Part 4 - immutable knowledge lifecycle authority.
-- Additive only. Later versions, tombstones, and rollback-as-new-version remain
-- drafts until the existing Part 3 review and publication workflow approves them.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_versions version
     WHERE version.version_number <> 1
        OR version.parent_version_id IS NOT NULL
        OR version.document->'content'->>'state' = 'tombstoned'
  ) THEN
    RAISE EXCEPTION 'Canonical knowledge lifecycle preflight failed: unexpected pre-Part-4 version history'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_lifecycle_existing_history_invalid';
  END IF;
END;
$$;

ALTER TABLE public.canonical_knowledge_versions
  ADD COLUMN lifecycle_action VARCHAR(24) NOT NULL DEFAULT 'initial',
  ADD COLUMN rollback_target_version_id UUID,
  ADD CONSTRAINT canonical_knowledge_versions_rollback_target_fk
    FOREIGN KEY (organization_id, entry_id, rollback_target_version_id)
    REFERENCES public.canonical_knowledge_versions(organization_id, entry_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT canonical_knowledge_versions_lifecycle_check CHECK (
    (
      version_number = 1
      AND lifecycle_action = 'initial'
      AND parent_version_id IS NULL
      AND rollback_target_version_id IS NULL
    ) OR (
      version_number > 1
      AND lifecycle_action IN ('revision', 'tombstone', 'rollback')
      AND parent_version_id IS NOT NULL
      AND (
        (lifecycle_action IN ('revision', 'tombstone') AND rollback_target_version_id IS NULL)
        OR (lifecycle_action = 'rollback' AND rollback_target_version_id IS NOT NULL)
      )
    )
  );

CREATE INDEX canonical_knowledge_versions_lifecycle_history
  ON public.canonical_knowledge_versions(
    organization_id, entry_id, lifecycle_action, version_number DESC, id
  );

ALTER TABLE public.canonical_knowledge_audit_events
  DROP CONSTRAINT canonical_knowledge_audit_events_canonical_action_check;

ALTER TABLE public.canonical_knowledge_audit_events
  ADD CONSTRAINT canonical_knowledge_audit_events_canonical_action_check CHECK (
    version_id IS NOT NULL
    AND action IN (
      'entry_draft_created',
      'review_submitted',
      'changes_requested',
      'standard_approved',
      'high_risk_approved',
      'attorney_gated_approved',
      'attorney_review_evidence_recorded',
      'version_published',
      'version_revised',
      'version_tombstoned',
      'version_rollback_created'
    )
  ) NOT VALID;

ALTER TABLE public.canonical_knowledge_audit_events
  VALIDATE CONSTRAINT canonical_knowledge_audit_events_canonical_action_check;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_set_database_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'canonical_knowledge_versions' THEN
      NEW.created_at := transaction_timestamp();
    WHEN 'canonical_knowledge_review_snapshots' THEN
      NEW.created_at := transaction_timestamp();
    WHEN 'canonical_knowledge_review_events' THEN
      NEW.created_at := transaction_timestamp();
    WHEN 'canonical_knowledge_audit_events' THEN
      NEW.created_at := transaction_timestamp();
    WHEN 'canonical_knowledge_publications' THEN
      NEW.published_at := transaction_timestamp();
    ELSE
      RAISE EXCEPTION 'Unsupported canonical knowledge timestamp target: %', TG_TABLE_NAME
        USING ERRCODE = '55000';
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_lock_entry_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1
    FROM public.canonical_knowledge_entries entry
   WHERE entry.organization_id = NEW.organization_id
     AND entry.id = NEW.entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical knowledge entry does not exist'
      USING ERRCODE = '23503',
            CONSTRAINT = 'canonical_knowledge_entry_lock_required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_provenance_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.organization_id = NEW.organization_id
       AND audit_event.version_id = NEW.version_id
  ) THEN
    RAISE EXCEPTION 'Canonical knowledge provenance is sealed by its audit graph'
      USING ERRCODE = '55000',
            CONSTRAINT = 'canonical_knowledge_provenance_sealed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_provenance provenance
     WHERE provenance.organization_id = NEW.organization_id
       AND provenance.version_id = NEW.version_id
       AND provenance.source_type = NEW.source_type
       AND provenance.source_record_id = NEW.source_record_id
       AND provenance.source_version = NEW.source_version
       AND rtrim(provenance.source_digest) = rtrim(NEW.source_digest)
       AND provenance.json_pointer = NEW.json_pointer
  ) THEN
    RAISE EXCEPTION 'Canonical knowledge provenance source identity is duplicated'
      USING ERRCODE = '23505',
            CONSTRAINT = 'canonical_knowledge_provenance_source_identity_unique';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_version_lifecycle()
RETURNS TRIGGER AS $$
DECLARE
  latest_version public.canonical_knowledge_versions%ROWTYPE;
  rollback_version public.canonical_knowledge_versions%ROWTYPE;
BEGIN
  PERFORM public.canonical_knowledge_require_workflow_actor(
    NEW.organization_id, NEW.created_by_user_id
  );
  SELECT version.*
    INTO latest_version
    FROM public.canonical_knowledge_versions version
   WHERE version.organization_id = NEW.organization_id
     AND version.entry_id = NEW.entry_id
   ORDER BY version.version_number DESC
   LIMIT 1
   FOR SHARE;

  IF NEW.version_number = 1 THEN
    IF latest_version.id IS NOT NULL
       OR NEW.lifecycle_action <> 'initial'
       OR NEW.parent_version_id IS NOT NULL
       OR NEW.rollback_target_version_id IS NOT NULL
       OR NEW.document->'content'->>'state' = 'tombstoned' THEN
      RAISE EXCEPTION 'Initial knowledge version lifecycle is invalid'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_version_initial_lifecycle';
    END IF;
    RETURN NEW;
  END IF;

  IF latest_version.id IS NULL
     OR NEW.parent_version_id IS DISTINCT FROM latest_version.id THEN
    RAISE EXCEPTION 'Knowledge version parent is not the exact latest version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_version_latest_parent';
  END IF;
  IF NEW.version_number <> latest_version.version_number + 1 THEN
    RAISE EXCEPTION 'Knowledge version number does not continue its exact parent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_version_parent_sequence';
  END IF;

  IF NEW.lifecycle_action = 'revision' THEN
    IF latest_version.lifecycle_action = 'tombstone' THEN
      RAISE EXCEPTION 'A tombstoned entry must be restored by rollback'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_revision_after_tombstone';
    END IF;
    IF rtrim(NEW.canonical_digest) = rtrim(latest_version.canonical_digest) THEN
      RAISE EXCEPTION 'Knowledge revision must change the canonical document'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_revision_no_change';
    END IF;
    IF NEW.document->'content'->>'state' = 'tombstoned' THEN
      RAISE EXCEPTION 'Tombstoned content requires the tombstone lifecycle action'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_revision_tombstone_state';
    END IF;
  ELSIF NEW.lifecycle_action = 'tombstone' THEN
    IF latest_version.lifecycle_action = 'tombstone' THEN
      RAISE EXCEPTION 'The latest knowledge version is already a tombstone'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_tombstone_duplicate';
    END IF;
    IF rtrim(NEW.canonical_digest) = rtrim(latest_version.canonical_digest) THEN
      RAISE EXCEPTION 'Knowledge tombstone must change the canonical document'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_tombstone_no_change';
    END IF;
    IF NEW.content_origin <> 'human'
       OR NEW.label IS DISTINCT FROM latest_version.label
       OR NEW.sensitivity IS DISTINCT FROM latest_version.sensitivity
       OR NEW.review_requirement IS DISTINCT FROM latest_version.review_requirement
       OR NEW.applicability IS DISTINCT FROM latest_version.applicability
       OR NEW.document->'content' IS DISTINCT FROM jsonb_build_object('state', 'tombstoned') THEN
      RAISE EXCEPTION 'Knowledge tombstone is not the exact deterministic tombstone document'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_tombstone_document';
    END IF;
  ELSIF NEW.lifecycle_action = 'rollback' THEN
    SELECT version.*
      INTO rollback_version
      FROM public.canonical_knowledge_versions version
     WHERE version.organization_id = NEW.organization_id
       AND version.entry_id = NEW.entry_id
       AND version.id = NEW.rollback_target_version_id
     FOR SHARE;
    IF rollback_version.id IS NULL
       OR rollback_version.version_number >= latest_version.version_number
       OR rollback_version.lifecycle_action = 'tombstone' THEN
      RAISE EXCEPTION 'Rollback target must be an earlier non-tombstone version'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_rollback_target';
    END IF;
    IF rtrim(rollback_version.canonical_digest) = rtrim(latest_version.canonical_digest) THEN
      RAISE EXCEPTION 'Knowledge rollback must change the canonical document'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_rollback_no_change';
    END IF;
    IF NEW.schema_version IS DISTINCT FROM rollback_version.schema_version
       OR NEW.content_origin IS DISTINCT FROM rollback_version.content_origin
       OR NEW.label IS DISTINCT FROM rollback_version.label
       OR NEW.sensitivity IS DISTINCT FROM rollback_version.sensitivity
       OR NEW.review_requirement IS DISTINCT FROM rollback_version.review_requirement
       OR NEW.applicability IS DISTINCT FROM rollback_version.applicability
       OR NEW.document IS DISTINCT FROM rollback_version.document
       OR NEW.canonical_document IS DISTINCT FROM rollback_version.canonical_document
       OR rtrim(NEW.canonical_digest) IS DISTINCT FROM rtrim(rollback_version.canonical_digest) THEN
      RAISE EXCEPTION 'Rollback version must exactly copy its selected target document'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_rollback_exact_copy';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported knowledge lifecycle action: %', NEW.lifecycle_action
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_version_lifecycle_action';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE TRIGGER canonical_knowledge_00_entry_lock
  BEFORE INSERT ON public.canonical_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_lock_entry_on_insert();

CREATE TRIGGER canonical_knowledge_versions_database_timestamp
  BEFORE INSERT ON public.canonical_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_set_database_timestamp();

CREATE TRIGGER canonical_knowledge_versions_validate_lifecycle
  BEFORE INSERT ON public.canonical_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_version_lifecycle();

CREATE TRIGGER canonical_knowledge_00_entry_lock
  BEFORE INSERT ON public.canonical_knowledge_review_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_lock_entry_on_insert();

CREATE TRIGGER canonical_knowledge_00_entry_lock
  BEFORE INSERT ON public.canonical_knowledge_review_events
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_lock_entry_on_insert();

CREATE TRIGGER canonical_knowledge_00_entry_lock
  BEFORE INSERT ON public.canonical_knowledge_attorney_review_evidence
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_lock_entry_on_insert();

CREATE TRIGGER canonical_knowledge_00_entry_lock
  BEFORE INSERT ON public.canonical_knowledge_publications
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_lock_entry_on_insert();

CREATE TRIGGER canonical_knowledge_provenance_validate_insert
  BEFORE INSERT ON public.canonical_knowledge_provenance
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_provenance_insert();

CREATE OR REPLACE FUNCTION public.canonical_knowledge_lifecycle_audit_graph_matches(
  target_audit_id UUID
)
RETURNS BOOLEAN AS $$
  SELECT COALESCE((
    SELECT CASE audit_event.action
      WHEN 'version_revised' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_versions version
          JOIN public.canonical_knowledge_versions parent
            ON parent.organization_id = version.organization_id
           AND parent.entry_id = version.entry_id
           AND parent.id = version.parent_version_id
         WHERE audit_event.organization_id = version.organization_id
           AND audit_event.entry_id = version.entry_id
           AND audit_event.version_id = version.id
           AND version.lifecycle_action = 'revision'
           AND version.version_number = parent.version_number + 1
           AND version.created_by_user_id = audit_event.actor_user_id
           AND version.reason = audit_event.reason
           AND version.created_at = audit_event.created_at
           AND rtrim(version.canonical_digest) <> rtrim(parent.canonical_digest)
           AND version.document->'content'->>'state' IS DISTINCT FROM 'tombstoned'
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'parentVersionId', parent.id::text,
             'versionNumber', version.version_number
           )
            AND EXISTS (
             SELECT 1
               FROM public.canonical_knowledge_provenance provenance
              WHERE provenance.organization_id = version.organization_id
                AND provenance.version_id = version.id
                AND provenance.ordinal = 1
                AND provenance.source_type = 'system_generation'
                AND provenance.source_record_id = parent.id::text
                AND provenance.source_version = parent.version_number::text
                AND rtrim(provenance.source_digest) = rtrim(parent.canonical_digest)
                AND provenance.json_pointer = ''
           )
           AND EXISTS (
             SELECT 1
               FROM public.canonical_knowledge_provenance provenance
               WHERE provenance.organization_id = version.organization_id
                 AND provenance.version_id = version.id
                 AND provenance.ordinal > 1
                 AND (
                   provenance.source_type IS DISTINCT FROM 'system_generation'
                   OR provenance.source_record_id IS DISTINCT FROM parent.id::text
                   OR provenance.source_version IS DISTINCT FROM parent.version_number::text
                   OR rtrim(provenance.source_digest) IS DISTINCT FROM
                      rtrim(parent.canonical_digest)
                   OR provenance.json_pointer IS DISTINCT FROM ''
                 )
            )
      )
      WHEN 'version_tombstoned' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_versions version
          JOIN public.canonical_knowledge_versions parent
            ON parent.organization_id = version.organization_id
           AND parent.entry_id = version.entry_id
           AND parent.id = version.parent_version_id
         WHERE audit_event.organization_id = version.organization_id
           AND audit_event.entry_id = version.entry_id
           AND audit_event.version_id = version.id
           AND version.lifecycle_action = 'tombstone'
           AND version.version_number = parent.version_number + 1
           AND version.created_by_user_id = audit_event.actor_user_id
           AND version.reason = audit_event.reason
           AND version.created_at = audit_event.created_at
           AND version.content_origin = 'human'
           AND version.document->'content' = jsonb_build_object('state', 'tombstoned')
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'parentVersionId', parent.id::text,
             'tombstone', true,
             'versionNumber', version.version_number
           )
           AND 1 = (
             SELECT count(*)
               FROM public.canonical_knowledge_provenance provenance
              WHERE provenance.organization_id = version.organization_id
                AND provenance.version_id = version.id
           )
           AND EXISTS (
             SELECT 1
               FROM public.canonical_knowledge_provenance provenance
              WHERE provenance.organization_id = version.organization_id
                AND provenance.version_id = version.id
                AND provenance.ordinal = 1
                AND provenance.source_type = 'system_generation'
                AND provenance.source_record_id = parent.id::text
                AND provenance.source_version = parent.version_number::text
                AND rtrim(provenance.source_digest) = rtrim(parent.canonical_digest)
                AND provenance.json_pointer = ''
           )
      )
      WHEN 'version_rollback_created' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_versions version
          JOIN public.canonical_knowledge_versions parent
            ON parent.organization_id = version.organization_id
           AND parent.entry_id = version.entry_id
           AND parent.id = version.parent_version_id
          JOIN public.canonical_knowledge_versions rollback_target
            ON rollback_target.organization_id = version.organization_id
           AND rollback_target.entry_id = version.entry_id
           AND rollback_target.id = version.rollback_target_version_id
         WHERE audit_event.organization_id = version.organization_id
           AND audit_event.entry_id = version.entry_id
           AND audit_event.version_id = version.id
           AND version.lifecycle_action = 'rollback'
           AND version.version_number = parent.version_number + 1
           AND rollback_target.version_number < parent.version_number
           AND rollback_target.lifecycle_action <> 'tombstone'
           AND version.created_by_user_id = audit_event.actor_user_id
           AND version.reason = audit_event.reason
           AND version.created_at = audit_event.created_at
           AND version.document = rollback_target.document
           AND version.canonical_document = rollback_target.canonical_document
           AND rtrim(version.canonical_digest) = rtrim(rollback_target.canonical_digest)
           AND rtrim(version.canonical_digest) <> rtrim(parent.canonical_digest)
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'parentVersionId', parent.id::text,
             'rollbackTargetVersionId', rollback_target.id::text,
             'versionNumber', version.version_number
           )
           AND 2 = (
             SELECT count(*)
               FROM public.canonical_knowledge_provenance provenance
              WHERE provenance.organization_id = version.organization_id
                AND provenance.version_id = version.id
           )
           AND EXISTS (
             SELECT 1
               FROM public.canonical_knowledge_provenance provenance
              WHERE provenance.organization_id = version.organization_id
                AND provenance.version_id = version.id
                AND provenance.ordinal = 1
                AND provenance.source_type = 'system_generation'
                AND provenance.source_record_id = parent.id::text
                AND provenance.source_version = parent.version_number::text
                AND rtrim(provenance.source_digest) = rtrim(parent.canonical_digest)
                AND provenance.json_pointer = ''
           )
           AND EXISTS (
             SELECT 1
               FROM public.canonical_knowledge_provenance provenance
              WHERE provenance.organization_id = version.organization_id
                AND provenance.version_id = version.id
                AND provenance.ordinal = 2
                AND provenance.source_type = 'system_generation'
                AND provenance.source_record_id = rollback_target.id::text
                AND provenance.source_version = rollback_target.version_number::text
                AND rtrim(provenance.source_digest) = rtrim(rollback_target.canonical_digest)
                AND provenance.json_pointer = ''
           )
      )
      ELSE FALSE
    END
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.id = target_audit_id
  ), FALSE);
$$ LANGUAGE sql STABLE STRICT
   SET search_path = pg_catalog;

CREATE UNIQUE INDEX canonical_knowledge_audit_lifecycle_source_unique
  ON public.canonical_knowledge_audit_events(organization_id, version_id)
  WHERE action IN (
    'version_revised', 'version_tombstoned', 'version_rollback_created'
  );

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_audit_graph()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (
    public.canonical_knowledge_audit_graph_matches(NEW.id)
    OR public.canonical_knowledge_lifecycle_audit_graph_matches(NEW.id)
  ) THEN
    RAISE EXCEPTION 'Canonical knowledge audit event requires one exact workflow graph'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_audit_event_graph_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_version_evidence()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_provenance provenance
     WHERE provenance.organization_id = NEW.organization_id
       AND provenance.version_id = NEW.id
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.organization_id = NEW.organization_id
       AND audit_event.entry_id = NEW.entry_id
       AND audit_event.version_id = NEW.id
       AND audit_event.actor_user_id = NEW.created_by_user_id
       AND audit_event.reason = NEW.reason
       AND audit_event.created_at = NEW.created_at
       AND (
         (
           NEW.lifecycle_action = 'initial'
           AND audit_event.action = 'entry_draft_created'
           AND public.canonical_knowledge_audit_graph_matches(audit_event.id)
         ) OR (
           NEW.lifecycle_action IN ('revision', 'tombstone', 'rollback')
           AND audit_event.action = CASE NEW.lifecycle_action
             WHEN 'revision' THEN 'version_revised'
             WHEN 'tombstone' THEN 'version_tombstoned'
             WHEN 'rollback' THEN 'version_rollback_created'
           END
           AND public.canonical_knowledge_lifecycle_audit_graph_matches(audit_event.id)
         )
       )
  ) THEN
    RAISE EXCEPTION 'Canonical knowledge version requires provenance and audit evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_versions_evidence_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;
