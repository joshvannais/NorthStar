-- Mission 21 Part 3 correction - reciprocal canonical audit graph authority.
-- Additive only. Existing workflow rows already require audit evidence; this migration
-- also requires every immutable audit event to identify one exact authorized graph.

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
      'version_published'
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_audit_graph_matches(
  target_audit_id UUID
)
RETURNS BOOLEAN AS $$
  SELECT COALESCE((
    SELECT CASE audit_event.action
      WHEN 'entry_draft_created' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_entries entry
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = entry.organization_id
           AND version.entry_id = entry.id
         WHERE audit_event.organization_id = entry.organization_id
           AND audit_event.entry_id = entry.id
           AND audit_event.version_id = version.id
           AND version.version_number = 1
           AND version.parent_version_id IS NULL
           AND entry.created_by_user_id = audit_event.actor_user_id
           AND version.created_by_user_id = audit_event.actor_user_id
           AND version.reason = audit_event.reason
           AND entry.created_at = version.created_at
           AND version.created_at = audit_event.created_at
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'versionNumber', version.version_number
           )
           AND EXISTS (
             SELECT 1
               FROM public.canonical_knowledge_provenance provenance
              WHERE provenance.organization_id = version.organization_id
                AND provenance.version_id = version.id
           )
      )
      WHEN 'review_submitted' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_review_events review_event
          JOIN public.canonical_knowledge_review_snapshots snapshot
            ON snapshot.organization_id = review_event.organization_id
           AND snapshot.entry_id = review_event.entry_id
           AND snapshot.version_id = review_event.version_id
           AND snapshot.id = review_event.snapshot_id
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = review_event.organization_id
           AND version.entry_id = review_event.entry_id
           AND version.id = review_event.version_id
         WHERE audit_event.organization_id = review_event.organization_id
           AND audit_event.entry_id = review_event.entry_id
           AND audit_event.version_id = review_event.version_id
           AND review_event.event_sequence = 1
           AND review_event.action = 'review_submitted'
           AND review_event.actor_user_id = audit_event.actor_user_id
           AND snapshot.submitted_by_user_id = audit_event.actor_user_id
           AND review_event.reason = audit_event.reason
           AND snapshot.reason = audit_event.reason
           AND review_event.created_at = audit_event.created_at
           AND snapshot.created_at = audit_event.created_at
           AND rtrim(review_event.version_digest) = rtrim(version.canonical_digest)
           AND rtrim(snapshot.version_digest) = rtrim(version.canonical_digest)
           AND review_event.details = jsonb_build_object(
             'diffDigest', rtrim(snapshot.diff_digest),
             'reviewRequirement', version.review_requirement
           )
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'diffDigest', rtrim(snapshot.diff_digest),
             'reviewEventId', review_event.id::text,
             'reviewRequirement', version.review_requirement,
             'snapshotId', snapshot.id::text
           )
      )
      WHEN 'changes_requested' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_review_events review_event
          JOIN public.canonical_knowledge_review_events submission
            ON submission.organization_id = review_event.organization_id
           AND submission.entry_id = review_event.entry_id
           AND submission.version_id = review_event.version_id
           AND submission.snapshot_id = review_event.snapshot_id
           AND submission.event_sequence = 1
           AND submission.action = 'review_submitted'
          JOIN public.canonical_knowledge_review_snapshots snapshot
            ON snapshot.organization_id = review_event.organization_id
           AND snapshot.entry_id = review_event.entry_id
           AND snapshot.version_id = review_event.version_id
           AND snapshot.id = review_event.snapshot_id
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = review_event.organization_id
           AND version.entry_id = review_event.entry_id
           AND version.id = review_event.version_id
         WHERE audit_event.organization_id = review_event.organization_id
           AND audit_event.entry_id = review_event.entry_id
           AND audit_event.version_id = review_event.version_id
           AND review_event.event_sequence = 2
           AND review_event.action = 'changes_requested'
           AND review_event.actor_user_id = audit_event.actor_user_id
           AND review_event.reason = audit_event.reason
           AND review_event.created_at = audit_event.created_at
           AND rtrim(review_event.version_digest) = rtrim(version.canonical_digest)
           AND submission.actor_user_id = snapshot.submitted_by_user_id
           AND submission.reason = snapshot.reason
           AND submission.created_at = snapshot.created_at
           AND submission.created_at <= review_event.created_at
           AND rtrim(submission.version_digest) = rtrim(snapshot.version_digest)
           AND submission.details = jsonb_build_object(
             'diffDigest', rtrim(snapshot.diff_digest),
             'reviewRequirement', version.review_requirement
           )
           AND review_event.details = jsonb_build_object(
             'priorReviewEventId', submission.id::text
           )
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'priorReviewEventId', submission.id::text,
             'reviewEventId', review_event.id::text,
             'snapshotId', snapshot.id::text
           )
      )
      WHEN 'standard_approved' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_review_events review_event
          JOIN public.canonical_knowledge_review_events submission
            ON submission.organization_id = review_event.organization_id
           AND submission.entry_id = review_event.entry_id
           AND submission.version_id = review_event.version_id
           AND submission.snapshot_id = review_event.snapshot_id
           AND submission.event_sequence = 1
           AND submission.action = 'review_submitted'
          JOIN public.canonical_knowledge_review_snapshots snapshot
            ON snapshot.organization_id = review_event.organization_id
           AND snapshot.entry_id = review_event.entry_id
           AND snapshot.version_id = review_event.version_id
           AND snapshot.id = review_event.snapshot_id
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = review_event.organization_id
           AND version.entry_id = review_event.entry_id
           AND version.id = review_event.version_id
         WHERE audit_event.organization_id = review_event.organization_id
           AND audit_event.entry_id = review_event.entry_id
           AND audit_event.version_id = review_event.version_id
           AND version.review_requirement = 'standard'
           AND review_event.event_sequence = 2
           AND review_event.action = 'standard_approved'
           AND review_event.actor_user_id = audit_event.actor_user_id
           AND review_event.reason = audit_event.reason
           AND review_event.created_at = audit_event.created_at
           AND rtrim(review_event.version_digest) = rtrim(version.canonical_digest)
           AND submission.actor_user_id = snapshot.submitted_by_user_id
           AND submission.reason = snapshot.reason
           AND submission.created_at = snapshot.created_at
           AND submission.created_at <= review_event.created_at
           AND rtrim(submission.version_digest) = rtrim(snapshot.version_digest)
           AND submission.details = jsonb_build_object(
             'diffDigest', rtrim(snapshot.diff_digest),
             'reviewRequirement', version.review_requirement
           )
           AND review_event.details = jsonb_build_object(
             'priorReviewEventId', submission.id::text,
             'reviewRequirement', version.review_requirement
           )
           AND version.document->'content'->>'state' IS DISTINCT FROM 'needs_review'
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'priorReviewEventId', submission.id::text,
             'reviewEventId', review_event.id::text,
             'reviewRequirement', version.review_requirement,
             'snapshotId', snapshot.id::text
           )
      )
      WHEN 'high_risk_approved' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_review_events review_event
          JOIN public.canonical_knowledge_review_events submission
            ON submission.organization_id = review_event.organization_id
           AND submission.entry_id = review_event.entry_id
           AND submission.version_id = review_event.version_id
           AND submission.snapshot_id = review_event.snapshot_id
           AND submission.event_sequence = 1
           AND submission.action = 'review_submitted'
          JOIN public.canonical_knowledge_review_snapshots snapshot
            ON snapshot.organization_id = review_event.organization_id
           AND snapshot.entry_id = review_event.entry_id
           AND snapshot.version_id = review_event.version_id
           AND snapshot.id = review_event.snapshot_id
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = review_event.organization_id
           AND version.entry_id = review_event.entry_id
           AND version.id = review_event.version_id
         WHERE audit_event.organization_id = review_event.organization_id
           AND audit_event.entry_id = review_event.entry_id
           AND audit_event.version_id = review_event.version_id
           AND version.review_requirement = 'high_risk'
           AND review_event.event_sequence = 2
           AND review_event.action = 'high_risk_approved'
           AND review_event.actor_user_id = audit_event.actor_user_id
           AND review_event.reason = audit_event.reason
           AND review_event.created_at = audit_event.created_at
           AND rtrim(review_event.version_digest) = rtrim(version.canonical_digest)
           AND submission.actor_user_id = snapshot.submitted_by_user_id
           AND submission.reason = snapshot.reason
           AND submission.created_at = snapshot.created_at
           AND submission.created_at <= review_event.created_at
           AND rtrim(submission.version_digest) = rtrim(snapshot.version_digest)
           AND submission.details = jsonb_build_object(
             'diffDigest', rtrim(snapshot.diff_digest),
             'reviewRequirement', version.review_requirement
           )
           AND review_event.details = jsonb_build_object(
             'priorReviewEventId', submission.id::text,
             'reviewRequirement', version.review_requirement
           )
           AND version.document->'content'->>'state' IS DISTINCT FROM 'needs_review'
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'priorReviewEventId', submission.id::text,
             'reviewEventId', review_event.id::text,
             'reviewRequirement', version.review_requirement,
             'snapshotId', snapshot.id::text
           )
      )
      WHEN 'attorney_gated_approved' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_review_events review_event
          JOIN public.canonical_knowledge_review_events submission
            ON submission.organization_id = review_event.organization_id
           AND submission.entry_id = review_event.entry_id
           AND submission.version_id = review_event.version_id
           AND submission.snapshot_id = review_event.snapshot_id
           AND submission.event_sequence = 1
           AND submission.action = 'review_submitted'
          JOIN public.canonical_knowledge_review_snapshots snapshot
            ON snapshot.organization_id = review_event.organization_id
           AND snapshot.entry_id = review_event.entry_id
           AND snapshot.version_id = review_event.version_id
           AND snapshot.id = review_event.snapshot_id
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = review_event.organization_id
           AND version.entry_id = review_event.entry_id
           AND version.id = review_event.version_id
          JOIN public.canonical_knowledge_attorney_review_evidence evidence
            ON evidence.organization_id = review_event.organization_id
           AND evidence.entry_id = review_event.entry_id
           AND evidence.version_id = review_event.version_id
           AND evidence.snapshot_id = review_event.snapshot_id
           AND evidence.id::text = review_event.details->>'attorneyEvidenceId'
         WHERE audit_event.organization_id = review_event.organization_id
           AND audit_event.entry_id = review_event.entry_id
           AND audit_event.version_id = review_event.version_id
           AND version.review_requirement = 'attorney_gated'
           AND review_event.event_sequence = 2
           AND review_event.action = 'attorney_gated_approved'
           AND review_event.actor_user_id = audit_event.actor_user_id
           AND review_event.reason = audit_event.reason
           AND review_event.created_at = audit_event.created_at
           AND evidence.recorded_by_user_id = review_event.actor_user_id
           AND evidence.recorded_at >= review_event.created_at
           AND rtrim(review_event.version_digest) = rtrim(version.canonical_digest)
           AND submission.actor_user_id = snapshot.submitted_by_user_id
           AND submission.reason = snapshot.reason
           AND submission.created_at = snapshot.created_at
           AND submission.created_at <= review_event.created_at
           AND rtrim(submission.version_digest) = rtrim(snapshot.version_digest)
           AND submission.details = jsonb_build_object(
             'diffDigest', rtrim(snapshot.diff_digest),
             'reviewRequirement', version.review_requirement
           )
           AND review_event.details = jsonb_build_object(
             'attorneyEvidenceId', evidence.id::text,
             'priorReviewEventId', submission.id::text,
             'reviewRequirement', version.review_requirement
           )
           AND version.document->'content'->>'state' IS DISTINCT FROM 'needs_review'
           AND audit_event.details = jsonb_build_object(
             'attorneyEvidenceId', evidence.id::text,
             'canonicalDigest', rtrim(version.canonical_digest),
             'priorReviewEventId', submission.id::text,
             'reviewEventId', review_event.id::text,
             'reviewRequirement', version.review_requirement,
             'snapshotId', snapshot.id::text
           )
      )
      WHEN 'attorney_review_evidence_recorded' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_attorney_review_evidence evidence
          JOIN public.canonical_knowledge_review_snapshots snapshot
            ON snapshot.organization_id = evidence.organization_id
           AND snapshot.entry_id = evidence.entry_id
           AND snapshot.version_id = evidence.version_id
           AND snapshot.id = evidence.snapshot_id
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = evidence.organization_id
           AND version.entry_id = evidence.entry_id
           AND version.id = evidence.version_id
          JOIN public.canonical_knowledge_review_events approval
            ON approval.organization_id = evidence.organization_id
           AND approval.entry_id = evidence.entry_id
           AND approval.version_id = evidence.version_id
           AND approval.snapshot_id = evidence.snapshot_id
           AND approval.event_sequence = 2
           AND approval.action = 'attorney_gated_approved'
          JOIN public.canonical_knowledge_review_events submission
            ON submission.organization_id = approval.organization_id
           AND submission.entry_id = approval.entry_id
           AND submission.version_id = approval.version_id
           AND submission.snapshot_id = approval.snapshot_id
           AND submission.event_sequence = 1
           AND submission.action = 'review_submitted'
         WHERE audit_event.organization_id = evidence.organization_id
           AND audit_event.entry_id = evidence.entry_id
           AND audit_event.version_id = evidence.version_id
           AND evidence.recorded_by_user_id = audit_event.actor_user_id
           AND approval.actor_user_id = audit_event.actor_user_id
           AND approval.reason = audit_event.reason
           AND approval.created_at = audit_event.created_at
           AND evidence.recorded_at >= audit_event.created_at
           AND version.review_requirement = 'attorney_gated'
           AND rtrim(approval.version_digest) = rtrim(version.canonical_digest)
           AND rtrim(snapshot.version_digest) = rtrim(version.canonical_digest)
           AND submission.actor_user_id = snapshot.submitted_by_user_id
           AND submission.reason = snapshot.reason
           AND submission.created_at = snapshot.created_at
           AND submission.created_at <= approval.created_at
           AND rtrim(submission.version_digest) = rtrim(snapshot.version_digest)
           AND submission.details = jsonb_build_object(
             'diffDigest', rtrim(snapshot.diff_digest),
             'reviewRequirement', version.review_requirement
           )
           AND approval.details = jsonb_build_object(
             'attorneyEvidenceId', evidence.id::text,
             'priorReviewEventId', submission.id::text,
             'reviewRequirement', version.review_requirement
           )
           AND audit_event.details = jsonb_build_object(
             'attorneyEvidenceId', evidence.id::text,
             'evidenceDigest', rtrim(evidence.evidence_digest),
             'snapshotId', snapshot.id::text
           )
      )
      WHEN 'version_published' THEN EXISTS (
        SELECT 1
          FROM public.canonical_knowledge_publications publication
          JOIN public.canonical_knowledge_versions version
            ON version.organization_id = publication.organization_id
           AND version.entry_id = publication.entry_id
           AND version.id = publication.version_id
          JOIN public.canonical_knowledge_review_events approval
            ON approval.organization_id = publication.organization_id
           AND approval.entry_id = publication.entry_id
           AND approval.version_id = publication.version_id
           AND approval.id = publication.review_event_id
         WHERE audit_event.organization_id = publication.organization_id
           AND audit_event.entry_id = publication.entry_id
           AND audit_event.version_id = publication.version_id
           AND publication.published_by_user_id = audit_event.actor_user_id
           AND publication.reason = audit_event.reason
           AND publication.published_at = audit_event.created_at
           AND rtrim(publication.canonical_digest) = rtrim(version.canonical_digest)
           AND rtrim(approval.version_digest) = rtrim(version.canonical_digest)
           AND approval.created_at <= publication.published_at
           AND approval.action = CASE version.review_requirement
             WHEN 'standard' THEN 'standard_approved'
             WHEN 'high_risk' THEN 'high_risk_approved'
             WHEN 'attorney_gated' THEN 'attorney_gated_approved'
             ELSE NULL
           END
           AND audit_event.details = jsonb_build_object(
             'canonicalDigest', rtrim(version.canonical_digest),
             'publicationId', publication.id::text,
             'publicationNumber', publication.publication_number,
             'reviewEventId', approval.id::text
           )
      )
      ELSE FALSE
    END
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.id = target_audit_id
  ), FALSE);
$$ LANGUAGE sql STABLE STRICT
   SET search_path = pg_catalog;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE NOT public.canonical_knowledge_audit_graph_matches(audit_event.id)
  ) THEN
    RAISE EXCEPTION 'Canonical knowledge audit graph preflight failed: existing evidence does not match an exact workflow graph'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_audit_existing_graph_invalid';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.action = 'entry_draft_created'
     GROUP BY audit_event.organization_id, audit_event.version_id
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.action IN (
       'review_submitted', 'changes_requested', 'standard_approved',
       'high_risk_approved', 'attorney_gated_approved'
     )
     GROUP BY audit_event.organization_id, audit_event.details->>'reviewEventId'
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.action = 'attorney_review_evidence_recorded'
     GROUP BY audit_event.organization_id, audit_event.details->>'attorneyEvidenceId'
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
      FROM public.canonical_knowledge_audit_events audit_event
     WHERE audit_event.action = 'version_published'
     GROUP BY audit_event.organization_id, audit_event.details->>'publicationId'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Canonical knowledge audit graph preflight failed: existing evidence contains duplicate graph anchors'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_audit_existing_anchor_duplicate';
  END IF;
END;
$$;

CREATE UNIQUE INDEX canonical_knowledge_audit_entry_draft_source_unique
  ON public.canonical_knowledge_audit_events(organization_id, version_id)
  WHERE action = 'entry_draft_created';

CREATE UNIQUE INDEX canonical_knowledge_audit_review_event_source_unique
  ON public.canonical_knowledge_audit_events(
    organization_id, (details->>'reviewEventId')
  ) WHERE action IN (
    'review_submitted', 'changes_requested', 'standard_approved',
    'high_risk_approved', 'attorney_gated_approved'
  );

CREATE UNIQUE INDEX canonical_knowledge_audit_attorney_evidence_source_unique
  ON public.canonical_knowledge_audit_events(
    organization_id, (details->>'attorneyEvidenceId')
  ) WHERE action = 'attorney_review_evidence_recorded';

CREATE UNIQUE INDEX canonical_knowledge_audit_publication_source_unique
  ON public.canonical_knowledge_audit_events(
    organization_id, (details->>'publicationId')
  ) WHERE action = 'version_published';

ALTER TABLE public.canonical_knowledge_audit_events
  VALIDATE CONSTRAINT canonical_knowledge_audit_events_canonical_action_check;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_audit_actor()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1
    FROM public.organization_memberships membership
   WHERE membership.organization_id = NEW.organization_id
     AND membership.user_id = NEW.actor_user_id
     AND membership.status = 'active'
     AND membership.role IN ('owner', 'admin')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical knowledge audit requires an active owner or administrator membership'
      USING ERRCODE = '42501',
            CONSTRAINT = 'canonical_knowledge_audit_actor_authorized';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE
   SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION public.canonical_knowledge_require_audit_graph()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.canonical_knowledge_audit_graph_matches(NEW.id) THEN
    RAISE EXCEPTION 'Canonical knowledge audit event requires one exact workflow graph'
      USING ERRCODE = '23514',
            CONSTRAINT = 'canonical_knowledge_audit_event_graph_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog;

CREATE TRIGGER canonical_knowledge_audit_events_authorize_actor
  BEFORE INSERT ON public.canonical_knowledge_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_audit_actor();

CREATE CONSTRAINT TRIGGER canonical_knowledge_audit_event_graph_required
  AFTER INSERT ON public.canonical_knowledge_audit_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.canonical_knowledge_require_audit_graph();
