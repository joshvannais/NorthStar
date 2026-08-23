-- Mission 21 Part 3 - exact-version review, approval, and publication authority.
-- Additive only. This migration does not create routes, UI, provider mappings,
-- provider calls, synchronization, tool authority, or legal conclusions.

CREATE TABLE canonical_knowledge_review_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL,
  version_id UUID NOT NULL,
  base_version_id UUID,
  version_digest CHAR(64) NOT NULL,
  diff JSONB NOT NULL,
  canonical_diff TEXT NOT NULL,
  diff_digest CHAR(64) NOT NULL,
  submitted_by_user_id UUID NOT NULL,
  reason VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_review_snapshots_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_review_snapshots_version_unique
    UNIQUE (organization_id, entry_id, version_id),
  CONSTRAINT canonical_knowledge_review_snapshots_event_identity
    UNIQUE (organization_id, entry_id, version_id, id),
  CONSTRAINT canonical_knowledge_review_snapshots_version_fk
    FOREIGN KEY (organization_id, entry_id, version_id)
    REFERENCES canonical_knowledge_versions(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_review_snapshots_base_fk
    FOREIGN KEY (organization_id, entry_id, base_version_id)
    REFERENCES canonical_knowledge_versions(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_review_snapshots_actor_fk
    FOREIGN KEY (organization_id, submitted_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_review_snapshots_base_check CHECK (
    base_version_id IS NULL OR base_version_id <> version_id
  ),
  CONSTRAINT canonical_knowledge_review_snapshots_version_digest_check CHECK (
    version_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_review_snapshots_diff_check CHECK ((
    jsonb_typeof(diff) = 'object'
    AND diff->>'schemaVersion' = '1'
    AND jsonb_typeof(diff->'operations') = 'array'
    AND jsonb_array_length(diff->'operations') BETWEEN 1 AND 512
    AND octet_length(diff::text) <= 65536
  ) IS TRUE),
  CONSTRAINT canonical_knowledge_review_snapshots_canonical_check CHECK ((
    octet_length(canonical_diff) <= 65536
    AND canonical_diff::jsonb = diff
    AND canonical_diff = public.canonical_knowledge_render_jsonb(diff)
  ) IS TRUE),
  CONSTRAINT canonical_knowledge_review_snapshots_diff_digest_check CHECK ((
    diff_digest ~ '^[0-9a-f]{64}$'
    AND encode(sha256(convert_to(canonical_diff, 'UTF8')), 'hex') = diff_digest
  ) IS TRUE),
  CONSTRAINT canonical_knowledge_review_snapshots_reason_check CHECK (
    length(reason) BETWEEN 1 AND 500
    AND length(btrim(reason)) >= 1
    AND octet_length(reason) <= 2000
    AND reason !~ '[[:cntrl:]]'
  )
);

CREATE INDEX canonical_knowledge_review_snapshots_entry_time
  ON canonical_knowledge_review_snapshots(organization_id, entry_id, created_at DESC, id);

CREATE TABLE canonical_knowledge_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL,
  version_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  event_sequence INTEGER NOT NULL,
  actor_user_id UUID NOT NULL,
  action VARCHAR(32) NOT NULL,
  version_digest CHAR(64) NOT NULL,
  reason VARCHAR(2000) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_review_events_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_review_events_version_identity
    UNIQUE (organization_id, entry_id, version_id, id),
  CONSTRAINT canonical_knowledge_review_events_sequence_unique
    UNIQUE (organization_id, entry_id, version_id, event_sequence),
  CONSTRAINT canonical_knowledge_review_events_version_fk
    FOREIGN KEY (organization_id, entry_id, version_id)
    REFERENCES canonical_knowledge_versions(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_review_events_snapshot_fk
    FOREIGN KEY (organization_id, entry_id, version_id, snapshot_id)
    REFERENCES canonical_knowledge_review_snapshots(
      organization_id, entry_id, version_id, id
    ) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_review_events_actor_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_review_events_sequence_check CHECK (event_sequence >= 1),
  CONSTRAINT canonical_knowledge_review_events_action_check CHECK (
    action IN (
      'review_submitted', 'changes_requested', 'standard_approved',
      'high_risk_approved', 'attorney_gated_approved'
    )
  ),
  CONSTRAINT canonical_knowledge_review_events_digest_check CHECK (
    version_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_review_events_reason_check CHECK (
    length(reason) BETWEEN 1 AND 500
    AND length(btrim(reason)) >= 1
    AND octet_length(reason) <= 2000
    AND reason !~ '[[:cntrl:]]'
  ),
  CONSTRAINT canonical_knowledge_review_events_details_check CHECK (
    jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 8192
  )
);

CREATE INDEX canonical_knowledge_review_events_entry_state
  ON canonical_knowledge_review_events(
    organization_id, entry_id, version_id, event_sequence DESC, id
  );

CREATE TABLE canonical_knowledge_attorney_review_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL,
  version_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  recorded_by_user_id UUID NOT NULL,
  review_reference VARCHAR(512) NOT NULL,
  evidence_digest CHAR(64) NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_attorney_evidence_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_attorney_evidence_version_unique
    UNIQUE (organization_id, entry_id, version_id),
  CONSTRAINT canonical_knowledge_attorney_evidence_version_fk
    FOREIGN KEY (organization_id, entry_id, version_id)
    REFERENCES canonical_knowledge_versions(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_attorney_evidence_snapshot_fk
    FOREIGN KEY (organization_id, entry_id, version_id, snapshot_id)
    REFERENCES canonical_knowledge_review_snapshots(
      organization_id, entry_id, version_id, id
    ) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_attorney_evidence_actor_fk
    FOREIGN KEY (organization_id, recorded_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_attorney_evidence_reference_check CHECK (
    length(review_reference) BETWEEN 1 AND 128
    AND length(btrim(review_reference)) >= 1
    AND octet_length(review_reference) <= 512
    AND review_reference !~ '[[:cntrl:]]'
  ),
  CONSTRAINT canonical_knowledge_attorney_evidence_digest_check CHECK (
    evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_attorney_evidence_time_check CHECK (
    reviewed_at <= recorded_at + INTERVAL '5 minutes'
  )
);

CREATE INDEX canonical_knowledge_attorney_evidence_entry_time
  ON canonical_knowledge_attorney_review_evidence(
    organization_id, entry_id, reviewed_at DESC, id
  );

CREATE TABLE canonical_knowledge_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_id UUID NOT NULL,
  version_id UUID NOT NULL,
  publication_number INTEGER NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  review_event_id UUID NOT NULL,
  previous_publication_id UUID,
  published_by_user_id UUID NOT NULL,
  reason VARCHAR(2000) NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_knowledge_publications_tenant_identity
    UNIQUE (organization_id, id),
  CONSTRAINT canonical_knowledge_publications_entry_identity
    UNIQUE (organization_id, entry_id, id),
  CONSTRAINT canonical_knowledge_publications_number_unique
    UNIQUE (organization_id, entry_id, publication_number),
  CONSTRAINT canonical_knowledge_publications_version_unique
    UNIQUE (organization_id, entry_id, version_id),
  CONSTRAINT canonical_knowledge_publications_version_fk
    FOREIGN KEY (organization_id, entry_id, version_id)
    REFERENCES canonical_knowledge_versions(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_publications_review_fk
    FOREIGN KEY (organization_id, entry_id, version_id, review_event_id)
    REFERENCES canonical_knowledge_review_events(
      organization_id, entry_id, version_id, id
    ) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_publications_previous_fk
    FOREIGN KEY (organization_id, entry_id, previous_publication_id)
    REFERENCES canonical_knowledge_publications(organization_id, entry_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_publications_actor_fk
    FOREIGN KEY (organization_id, published_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_knowledge_publications_number_check CHECK (publication_number >= 1),
  CONSTRAINT canonical_knowledge_publications_digest_check CHECK (
    canonical_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT canonical_knowledge_publications_previous_check CHECK (
    previous_publication_id IS NULL OR previous_publication_id <> id
  ),
  CONSTRAINT canonical_knowledge_publications_reason_check CHECK (
    length(reason) BETWEEN 1 AND 500
    AND length(btrim(reason)) >= 1
    AND octet_length(reason) <= 2000
    AND reason !~ '[[:cntrl:]]'
  )
);

CREATE INDEX canonical_knowledge_publications_current
  ON canonical_knowledge_publications(
    organization_id, entry_id, publication_number DESC, id
  );

CREATE OR REPLACE FUNCTION public.canonical_knowledge_escape_json_pointer(input TEXT)
RETURNS TEXT AS $$
  SELECT replace(replace(input, '~', '~0'), '/', '~1');
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_normalize_jsonb(input JSONB)
RETURNS JSONB AS $$
DECLARE
  normalized JSONB;
BEGIN
  CASE jsonb_typeof(input)
    WHEN 'string' THEN
      RETURN to_jsonb(normalize(input #>> '{}', NFC));
    WHEN 'array' THEN
      SELECT COALESCE(
               jsonb_agg(
                 public.canonical_knowledge_normalize_jsonb(item.value)
                 ORDER BY item.ordinality
               ),
               '[]'::jsonb
             )
        INTO normalized
        FROM jsonb_array_elements(input) WITH ORDINALITY AS item(value, ordinality);
      RETURN normalized;
    WHEN 'object' THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(input) AS source_key(key)
         GROUP BY normalize(key, NFC)
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'Canonical knowledge JSON contains colliding normalized keys'
          USING ERRCODE = '22023';
      END IF;
      SELECT COALESCE(
               jsonb_object_agg(
                 normalize(item.key, NFC),
                 public.canonical_knowledge_normalize_jsonb(item.value)
                 ORDER BY normalize(item.key, NFC) COLLATE "C"
               ),
               '{}'::jsonb
             )
        INTO normalized
        FROM jsonb_each(input) AS item(key, value);
      RETURN normalized;
    ELSE
      RETURN input;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_diff_operations(
  base_value JSONB,
  target_value JSONB,
  pointer_path TEXT,
  has_base BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
  operations JSONB := '[]'::jsonb;
  item_key TEXT;
  item_path TEXT;
BEGIN
  target_value := public.canonical_knowledge_normalize_jsonb(target_value);
  IF has_base THEN
    base_value := public.canonical_knowledge_normalize_jsonb(base_value);
  END IF;
  IF NOT has_base THEN
    RETURN jsonb_build_array(
      jsonb_build_object('op', 'add', 'path', pointer_path, 'value', target_value)
    );
  END IF;
  IF base_value = target_value THEN RETURN operations; END IF;
  IF jsonb_typeof(base_value) = 'object' AND jsonb_typeof(target_value) = 'object' THEN
    FOR item_key IN
      SELECT key
        FROM jsonb_object_keys(base_value) AS source_key(key)
       WHERE NOT (target_value ? key)
       ORDER BY key COLLATE "C"
    LOOP
      item_path := pointer_path || '/' || public.canonical_knowledge_escape_json_pointer(item_key);
      operations := operations || jsonb_build_array(
        jsonb_build_object('op', 'remove', 'path', item_path)
      );
    END LOOP;
    FOR item_key IN
      SELECT key
        FROM jsonb_object_keys(target_value) AS target_key(key)
       ORDER BY key COLLATE "C"
    LOOP
      item_path := pointer_path || '/' || public.canonical_knowledge_escape_json_pointer(item_key);
      IF NOT (base_value ? item_key) THEN
        operations := operations || jsonb_build_array(
          jsonb_build_object('op', 'add', 'path', item_path, 'value', target_value->item_key)
        );
      ELSE
        operations := operations || public.canonical_knowledge_diff_operations(
          base_value->item_key, target_value->item_key, item_path, TRUE
        );
      END IF;
    END LOOP;
    RETURN operations;
  END IF;
  RETURN jsonb_build_array(
    jsonb_build_object('op', 'replace', 'path', pointer_path, 'value', target_value)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_workflow_actor(
  target_organization_id UUID,
  target_user_id UUID
)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_memberships membership
     WHERE membership.organization_id = target_organization_id
       AND membership.user_id = target_user_id
       AND membership.status = 'active'
       AND membership.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Knowledge workflow requires an active owner or administrator membership'
      USING ERRCODE = '42501';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_review_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  target_digest TEXT;
  target_number INTEGER;
  target_document JSONB;
  base_document JSONB;
  expected_diff JSONB;
  published_version_id UUID;
BEGIN
  PERFORM public.canonical_knowledge_require_workflow_actor(
    NEW.organization_id, NEW.submitted_by_user_id
  );
  SELECT rtrim(version.canonical_digest), version.version_number, version.document
    INTO target_digest, target_number, target_document
    FROM public.canonical_knowledge_versions version
   WHERE version.organization_id = NEW.organization_id
     AND version.entry_id = NEW.entry_id
     AND version.id = NEW.version_id
   FOR SHARE;
  IF target_digest IS NULL OR target_digest <> rtrim(NEW.version_digest) THEN
    RAISE EXCEPTION 'Review snapshot digest does not identify the exact version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_snapshot_version_match';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_versions newer
     WHERE newer.organization_id = NEW.organization_id
       AND newer.entry_id = NEW.entry_id
       AND newer.version_number > target_number
  ) THEN
    RAISE EXCEPTION 'Review snapshot targets a stale knowledge version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_snapshot_latest_version';
  END IF;
  SELECT publication.version_id
    INTO published_version_id
    FROM public.canonical_knowledge_publications publication
   WHERE publication.organization_id = NEW.organization_id
     AND publication.entry_id = NEW.entry_id
   ORDER BY publication.publication_number DESC
   LIMIT 1;
  IF published_version_id IS DISTINCT FROM NEW.base_version_id THEN
    RAISE EXCEPTION 'Review diff base does not match the current publication'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_snapshot_publication_base';
  END IF;
  IF NEW.base_version_id IS NULL THEN
    expected_diff := jsonb_build_object(
      'operations', public.canonical_knowledge_diff_operations(
        NULL, target_document, '', FALSE
      ),
      'schemaVersion', 1
    );
  ELSE
    SELECT version.document
      INTO base_document
      FROM public.canonical_knowledge_versions version
     WHERE version.organization_id = NEW.organization_id
       AND version.entry_id = NEW.entry_id
       AND version.id = NEW.base_version_id;
    expected_diff := jsonb_build_object(
      'operations', public.canonical_knowledge_diff_operations(
        base_document, target_document, '', TRUE
      ),
      'schemaVersion', 1
    );
  END IF;
  IF expected_diff IS DISTINCT FROM NEW.diff THEN
    RAISE EXCEPTION 'Review diff does not match the exact base and target documents'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_snapshot_exact_diff';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_attorney_evidence()
RETURNS TRIGGER AS $$
DECLARE
  target_requirement TEXT;
  target_number INTEGER;
BEGIN
  PERFORM public.canonical_knowledge_require_workflow_actor(
    NEW.organization_id, NEW.recorded_by_user_id
  );
  SELECT version.review_requirement, version.version_number
    INTO target_requirement, target_number
    FROM public.canonical_knowledge_versions version
   WHERE version.organization_id = NEW.organization_id
     AND version.entry_id = NEW.entry_id
     AND version.id = NEW.version_id
   FOR SHARE;
  IF target_requirement IS DISTINCT FROM 'attorney_gated' THEN
    RAISE EXCEPTION 'Attorney evidence may bind only an attorney-gated version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_attorney_evidence_requirement';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_versions newer
     WHERE newer.organization_id = NEW.organization_id
       AND newer.entry_id = NEW.entry_id
       AND newer.version_number > target_number
  ) THEN
    RAISE EXCEPTION 'Attorney evidence targets a stale knowledge version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_attorney_evidence_latest_version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_review_event()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_digest TEXT;
  target_requirement TEXT;
  target_document JSONB;
  target_number INTEGER;
  previous_action TEXT;
  previous_sequence INTEGER;
  expected_action TEXT;
BEGIN
  PERFORM public.canonical_knowledge_require_workflow_actor(
    NEW.organization_id, NEW.actor_user_id
  );
  SELECT rtrim(snapshot.version_digest), version.review_requirement,
         version.document, version.version_number
    INTO snapshot_digest, target_requirement, target_document, target_number
    FROM public.canonical_knowledge_review_snapshots snapshot
    JOIN public.canonical_knowledge_versions version
      ON version.organization_id = snapshot.organization_id
     AND version.entry_id = snapshot.entry_id
     AND version.id = snapshot.version_id
   WHERE snapshot.organization_id = NEW.organization_id
     AND snapshot.entry_id = NEW.entry_id
     AND snapshot.version_id = NEW.version_id
     AND snapshot.id = NEW.snapshot_id
   FOR SHARE OF snapshot, version;
  IF snapshot_digest IS NULL OR snapshot_digest <> rtrim(NEW.version_digest) THEN
    RAISE EXCEPTION 'Review event digest does not match its exact snapshot'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_event_snapshot_match';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_versions newer
     WHERE newer.organization_id = NEW.organization_id
       AND newer.entry_id = NEW.entry_id
       AND newer.version_number > target_number
  ) THEN
    RAISE EXCEPTION 'Review event targets a stale knowledge version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_event_latest_version';
  END IF;
  SELECT event.action, event.event_sequence
    INTO previous_action, previous_sequence
    FROM public.canonical_knowledge_review_events event
   WHERE event.organization_id = NEW.organization_id
     AND event.entry_id = NEW.entry_id
     AND event.version_id = NEW.version_id
   ORDER BY event.event_sequence DESC
   LIMIT 1
   FOR SHARE;
  IF previous_sequence IS NULL THEN
    IF NEW.event_sequence <> 1 OR NEW.action <> 'review_submitted' THEN
      RAISE EXCEPTION 'The first review event must submit the exact version'
        USING ERRCODE = '23514',
              CONSTRAINT = 'canonical_knowledge_review_event_initial_state';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.event_sequence <> previous_sequence + 1 OR previous_action <> 'review_submitted' THEN
    RAISE EXCEPTION 'Review event is stale or follows a terminal decision'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_event_state_transition';
  END IF;
  IF NEW.action = 'changes_requested' THEN RETURN NEW; END IF;
  expected_action := CASE target_requirement
    WHEN 'standard' THEN 'standard_approved'
    WHEN 'high_risk' THEN 'high_risk_approved'
    WHEN 'attorney_gated' THEN 'attorney_gated_approved'
    ELSE NULL
  END;
  IF NEW.action IS DISTINCT FROM expected_action THEN
    RAISE EXCEPTION 'Approval action does not satisfy the version review requirement'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_event_approval_class';
  END IF;
  IF target_document->'content'->>'state' = 'needs_review' THEN
    RAISE EXCEPTION 'Knowledge with unresolved evidence cannot be approved'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_event_unresolved';
  END IF;
  IF expected_action = 'attorney_gated_approved' AND NOT EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_attorney_review_evidence evidence
     WHERE evidence.organization_id = NEW.organization_id
       AND evidence.entry_id = NEW.entry_id
       AND evidence.version_id = NEW.version_id
       AND evidence.snapshot_id = NEW.snapshot_id
       AND NEW.details->>'attorneyEvidenceId' = evidence.id::text
  ) THEN
    RAISE EXCEPTION 'Attorney-gated approval requires exact external review evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_event_attorney_evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_validate_publication()
RETURNS TRIGGER AS $$
DECLARE
  target_digest TEXT;
  target_requirement TEXT;
  target_document JSONB;
  target_number INTEGER;
  approval_action TEXT;
  approval_digest TEXT;
  approval_snapshot_id UUID;
  latest_review_event_id UUID;
  latest_publication_id UUID;
  latest_publication_number INTEGER;
  latest_published_version_id UUID;
  review_base_version_id UUID;
  expected_action TEXT;
BEGIN
  PERFORM public.canonical_knowledge_require_workflow_actor(
    NEW.organization_id, NEW.published_by_user_id
  );
  SELECT rtrim(version.canonical_digest), version.review_requirement,
         version.document, version.version_number
    INTO target_digest, target_requirement, target_document, target_number
    FROM public.canonical_knowledge_versions version
   WHERE version.organization_id = NEW.organization_id
     AND version.entry_id = NEW.entry_id
     AND version.id = NEW.version_id
   FOR SHARE;
  IF target_digest IS NULL OR target_digest <> rtrim(NEW.canonical_digest) THEN
    RAISE EXCEPTION 'Publication digest does not identify the exact version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_publication_version_match';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_versions newer
     WHERE newer.organization_id = NEW.organization_id
       AND newer.entry_id = NEW.entry_id
       AND newer.version_number > target_number
  ) THEN
    RAISE EXCEPTION 'Publication targets a stale knowledge version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_publication_latest_version';
  END IF;
  SELECT event.action, rtrim(event.version_digest), event.snapshot_id
    INTO approval_action, approval_digest, approval_snapshot_id
    FROM public.canonical_knowledge_review_events event
   WHERE event.organization_id = NEW.organization_id
     AND event.entry_id = NEW.entry_id
     AND event.version_id = NEW.version_id
     AND event.id = NEW.review_event_id;
  SELECT event.id
    INTO latest_review_event_id
    FROM public.canonical_knowledge_review_events event
   WHERE event.organization_id = NEW.organization_id
     AND event.entry_id = NEW.entry_id
     AND event.version_id = NEW.version_id
   ORDER BY event.event_sequence DESC
   LIMIT 1;
  expected_action := CASE target_requirement
    WHEN 'standard' THEN 'standard_approved'
    WHEN 'high_risk' THEN 'high_risk_approved'
    WHEN 'attorney_gated' THEN 'attorney_gated_approved'
    ELSE NULL
  END;
  IF approval_action IS DISTINCT FROM expected_action
     OR approval_digest IS DISTINCT FROM target_digest
     OR latest_review_event_id IS DISTINCT FROM NEW.review_event_id THEN
    RAISE EXCEPTION 'Publication requires the latest exact approval event'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_publication_approval_match';
  END IF;
  IF target_document->'content'->>'state' = 'needs_review' THEN
    RAISE EXCEPTION 'Knowledge with unresolved evidence cannot be published'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_publication_unresolved';
  END IF;
  SELECT publication.id, publication.publication_number, publication.version_id
    INTO latest_publication_id, latest_publication_number, latest_published_version_id
    FROM public.canonical_knowledge_publications publication
   WHERE publication.organization_id = NEW.organization_id
     AND publication.entry_id = NEW.entry_id
   ORDER BY publication.publication_number DESC
   LIMIT 1;
  IF NEW.publication_number <> COALESCE(latest_publication_number, 0) + 1
     OR NEW.previous_publication_id IS DISTINCT FROM latest_publication_id THEN
    RAISE EXCEPTION 'Publication sequence is stale'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_publication_sequence';
  END IF;
  SELECT snapshot.base_version_id
    INTO review_base_version_id
    FROM public.canonical_knowledge_review_snapshots snapshot
   WHERE snapshot.organization_id = NEW.organization_id
     AND snapshot.entry_id = NEW.entry_id
     AND snapshot.version_id = NEW.version_id
     AND snapshot.id = approval_snapshot_id;
  IF review_base_version_id IS DISTINCT FROM latest_published_version_id THEN
    RAISE EXCEPTION 'Publication changed after the reviewed diff was created'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_publication_review_base';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_review_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.organization_id = NEW.organization_id
       AND audit_event.entry_id = NEW.entry_id
       AND audit_event.version_id = NEW.version_id
       AND audit_event.actor_user_id = NEW.actor_user_id
       AND audit_event.action = NEW.action
       AND audit_event.reason = NEW.reason
       AND audit_event.details->>'reviewEventId' = NEW.id::text
       AND audit_event.details->>'snapshotId' = NEW.snapshot_id::text
       AND audit_event.details->>'canonicalDigest' = rtrim(NEW.version_digest)
  ) THEN
    RAISE EXCEPTION 'Review event requires exact audit evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_review_event_audit_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_attorney_evidence_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.organization_id = NEW.organization_id
       AND audit_event.entry_id = NEW.entry_id
       AND audit_event.version_id = NEW.version_id
       AND audit_event.actor_user_id = NEW.recorded_by_user_id
       AND audit_event.action = 'attorney_review_evidence_recorded'
       AND audit_event.details->>'attorneyEvidenceId' = NEW.id::text
       AND audit_event.details->>'evidenceDigest' = rtrim(NEW.evidence_digest)
  ) THEN
    RAISE EXCEPTION 'Attorney-review evidence requires exact audit evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_attorney_evidence_audit_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_publication_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.organization_id = NEW.organization_id
       AND audit_event.entry_id = NEW.entry_id
       AND audit_event.version_id = NEW.version_id
       AND audit_event.actor_user_id = NEW.published_by_user_id
       AND audit_event.action = 'version_published'
       AND audit_event.reason = NEW.reason
       AND audit_event.details->>'publicationId' = NEW.id::text
       AND audit_event.details->>'reviewEventId' = NEW.review_event_id::text
       AND audit_event.details->>'canonicalDigest' = rtrim(NEW.canonical_digest)
       AND audit_event.details->>'publicationNumber' = NEW.publication_number::text
  ) THEN
    RAISE EXCEPTION 'Publication requires exact audit evidence'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_publication_audit_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE TRIGGER canonical_knowledge_review_snapshots_validate
  BEFORE INSERT ON canonical_knowledge_review_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_review_snapshot();

CREATE TRIGGER canonical_knowledge_attorney_evidence_validate
  BEFORE INSERT ON canonical_knowledge_attorney_review_evidence
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_attorney_evidence();

CREATE TRIGGER canonical_knowledge_review_events_validate
  BEFORE INSERT ON canonical_knowledge_review_events
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_review_event();

CREATE TRIGGER canonical_knowledge_publications_validate
  BEFORE INSERT ON canonical_knowledge_publications
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_validate_publication();

CREATE CONSTRAINT TRIGGER canonical_knowledge_review_event_audit_required
  AFTER INSERT ON canonical_knowledge_review_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_review_audit();

CREATE CONSTRAINT TRIGGER canonical_knowledge_attorney_evidence_audit_required
  AFTER INSERT ON canonical_knowledge_attorney_review_evidence
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_attorney_evidence_audit();

CREATE CONSTRAINT TRIGGER canonical_knowledge_publication_audit_required
  AFTER INSERT ON canonical_knowledge_publications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_publication_audit();

CREATE TRIGGER canonical_knowledge_review_snapshots_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_review_snapshots
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();

CREATE TRIGGER canonical_knowledge_review_events_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_review_events
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();

CREATE TRIGGER canonical_knowledge_attorney_evidence_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_attorney_review_evidence
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();

CREATE TRIGGER canonical_knowledge_publications_immutable
  BEFORE UPDATE OR DELETE ON canonical_knowledge_publications
  FOR EACH ROW EXECUTE FUNCTION canonical_knowledge_reject_mutation();
