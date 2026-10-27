-- Mission 28 Part 4B: exact tenant-private trigger observations and append-only
-- correction lineage.  This migration mounts no route, resolver, evaluator,
-- scheduler, worker, provider, recipient, external effect, mutation or money
-- authority.  The storage entry point remains revoked from application roles.

CREATE FUNCTION public.canonical_automation_part4b_keys_exact_v1(value JSONB,expected TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(value)='object'
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) keys(key))
      IS NOT DISTINCT FROM
      (SELECT array_agg(item ORDER BY item) FROM unnest(expected) items(item)),FALSE)
$$;

CREATE FUNCTION public.canonical_automation_part4b_utc_v1(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parsed TIMESTAMPTZ;
BEGIN
 IF value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RETURN FALSE; END IF;
 BEGIN parsed:=value::timestamptz; EXCEPTION WHEN OTHERS THEN RETURN FALSE; END;
 RETURN public.canonical_automation_utc_v1(parsed)=value;
END $$;

CREATE FUNCTION public.canonical_automation_part4b_pin_values_v1(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(value)='object' AND NOT EXISTS(
  SELECT 1 FROM jsonb_each(value) entry(key,member)
   WHERE octet_length(key)>128 OR jsonb_typeof(member) NOT IN('string','number','boolean')
      OR (jsonb_typeof(member)='string' AND (octet_length(member#>>'{}') NOT BETWEEN 1 AND 8192))
 ),FALSE)
$$;

CREATE TABLE public.canonical_automation_trigger_catalog_v1 (
 trigger_id TEXT PRIMARY KEY,
 source_class_id TEXT NOT NULL,
 owner_mission TEXT NOT NULL,
 fact_kind TEXT NOT NULL,
 record_identity_keys TEXT[] NOT NULL,
 currentness_pin_keys TEXT[] NOT NULL,
 version_pin TEXT NULL,
 revision_pin TEXT NULL,
 canonical_digest_pin TEXT NOT NULL,
 source_digest_pin TEXT NOT NULL,
 event_kinds JSONB NOT NULL CHECK(jsonb_typeof(event_kinds)='object'),
 part4a_catalog_sha256 TEXT NOT NULL CHECK(part4a_catalog_sha256='5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT statement_timestamp(),
 CHECK(cardinality(record_identity_keys)>=2),
 CHECK(record_identity_keys[1]='tenantId'),
 CHECK(cardinality(currentness_pin_keys)>=3),
 CHECK('eventKind'=ANY(currentness_pin_keys) AND 'eventTime'=ANY(currentness_pin_keys)),
 CHECK((version_pin IS NULL)<>(revision_pin IS NULL)),
 CHECK(canonical_digest_pin=ANY(currentness_pin_keys)),
 CHECK(source_digest_pin=ANY(currentness_pin_keys)),
 CHECK(version_pin IS NULL OR version_pin=ANY(currentness_pin_keys)),
 CHECK(revision_pin IS NULL OR revision_pin=ANY(currentness_pin_keys))
);

INSERT INTO public.canonical_automation_trigger_catalog_v1(
 trigger_id,source_class_id,owner_mission,fact_kind,record_identity_keys,currentness_pin_keys,
 version_pin,revision_pin,canonical_digest_pin,source_digest_pin,event_kinds,part4a_catalog_sha256)
VALUES
('m20.lead_contact_state','mission20_business_contact_preferences','Mission 20','lead_contact_state',
 ARRAY['tenantId','canonicalGraphId','customerId','opportunityId'],ARRAY['sourceType','sourceVersion','projectionDigest','opportunityStatus','eventKind','eventTime'],
 'sourceVersion',NULL,'projectionDigest','projectionDigest',
 '{"transcript_occurred":{"sourceField":"timestamps.transcriptOccurredAt","sourceStateSelector":"ids.transcript=present"},"communication_occurred":{"sourceField":"timestamps.communicationOccurredAt","sourceStateSelector":"ids.communication=present"},"opportunity_state_changed":{"sourceField":"timestamps.opportunityUpdatedAt","sourceStateSelector":"metadata.opportunityStatus=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m20.communication_preference_state','mission20_business_contact_preferences','Mission 20','tenant_communication_preference_state',
 ARRAY['tenantId','accountPreferenceAuthority'],ARRAY['preferenceVersion','preferenceDigest_or_exact_projection','eventKind','eventTime'],
 'preferenceVersion',NULL,'preferenceDigest_or_exact_projection','preferenceDigest_or_exact_projection',
 '{"preferences_updated":{"sourceField":"preferenceVersion","sourceStateSelector":"exact_preference_projection=present"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m21.reviewed_knowledge_version','mission21_knowledge_reference','Mission 21','reviewed_published_knowledge_version',
 ARRAY['tenantId','knowledgeEntryId','knowledgeVersionId'],ARRAY['knowledgeVersionId','versionNumber','canonicalDigest','publicationId','eventKind','eventTime'],
 'versionNumber',NULL,'canonicalDigest','canonicalDigest',
 '{"knowledge_version_published":{"sourceField":"publishedAt","sourceStateSelector":"publicationId_and_reviewed_version=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m22.appointment_state','mission22_appointment_dispatch','Mission 22','appointment_schedule_state',
 ARRAY['tenantId','appointmentId'],ARRAY['revision','digest','status','scheduledStart','scheduledEnd','timeZone','eventKind','eventTime'],
 NULL,'revision','digest','digest',
 '{"appointment_state_changed":{"sourceField":"appointment.updated_at","sourceStateSelector":"revision_digest_and_status=exact"},"appointment_schedule_effective":{"sourceField":"appointment.scheduled_start","sourceStateSelector":"status=scheduled_and_scheduled_start=present"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m22.assignment_dispatch_state','mission22_appointment_dispatch','Mission 22','assignment_dispatch_state',
 ARRAY['tenantId','appointmentId','assignmentId'],ARRAY['assignmentRevision','assignmentDigest','appointmentStatus','eventKind','eventTime'],
 NULL,'assignmentRevision','assignmentDigest','assignmentDigest',
 '{"assignment_state_changed":{"sourceField":"appointment.scheduleAuthority.updatedAt","sourceStateSelector":"assignment_revision_digest_and_state=exact"},"assignment_schedule_effective":{"sourceField":"appointment.scheduleAuthority.scheduledStart","sourceStateSelector":"appointment_status=scheduled_and_scheduled_start=present"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m23.work_progress_state','mission23_work_execution','Mission 23','reviewed_work_progress_state',
 ARRAY['tenantId','executionId','progressRecordId'],ARRAY['executionRevision','executionDigest','progressRevision','progressDigest','eventKind','eventTime'],
 NULL,'progressRevision','progressDigest','executionDigest',
 '{"progress_observed":{"sourceField":"progressRecord.observedAt","sourceStateSelector":"progress_record_revision_digest_and_review_state=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m23.work_completion_reopening_state','mission23_work_execution','Mission 23','work_completion_or_reopening_state',
 ARRAY['tenantId','executionId','assignmentId'],ARRAY['executionRevision','executionDigest','assignmentRevision','assignmentDigest','lifecycleState','eventKind','eventTime'],
 NULL,'executionRevision','executionDigest','assignmentDigest',
 '{"completion_approved":{"sourceField":"completionRecord.decidedAt","sourceStateSelector":"completionRecord.action=approve_completion"},"work_reopened":{"sourceField":"completionRecord.decidedAt","sourceStateSelector":"completionRecord.action=reopen_execution"},"work_cancelled":{"sourceField":"completionRecord.decidedAt","sourceStateSelector":"completionRecord.action=cancel_execution"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m24.commercial_revision_state','mission24_estimate_quote','Mission 24','approved_commercial_revision_state',
 ARRAY['tenantId','estimateId','commercialDecisionId'],ARRAY['termsRevision','termsDigest','decisionRevision','decisionDigest','sourceDigest','eventKind','eventTime'],
 NULL,'decisionRevision','decisionDigest','sourceDigest',
 '{"commercial_decision_approved":{"sourceField":"commercialDecision.createdAt","sourceStateSelector":"commercialDecision.action=approve"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m24.issued_quote_version','mission24_estimate_quote','Mission 24','issued_customer_quote_version',
 ARRAY['tenantId','estimateId','issuedVersionId'],ARRAY['issuedVersionId','revision','documentDigest','approvalPinDigest','eventKind','eventTime'],
 NULL,'revision','documentDigest','approvalPinDigest',
 '{"quote_version_issued":{"sourceField":"issuedVersion.createdAt","sourceStateSelector":"issuedVersion.state=issued"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m24.customer_quote_response_state','mission24_estimate_quote','Mission 24','customer_quote_response_or_expiry_state',
 ARRAY['tenantId','estimateId','issuedVersionId','deliveryLinkId'],ARRAY['issuedVersionId','deliveryLinkId','responseRevision','responseDigest','state','eventKind','eventTime'],
 NULL,'responseRevision','responseDigest','responseDigest',
 '{"customer_accepted":{"sourceField":"deliveryEvent.createdAt","sourceStateSelector":"deliveryEvent.kind=accepted"},"customer_questioned":{"sourceField":"deliveryEvent.createdAt","sourceStateSelector":"deliveryEvent.kind=question"},"delivery_link_revoked":{"sourceField":"deliveryEvent.createdAt","sourceStateSelector":"deliveryEvent.kind=revoked"},"delivery_link_expired":{"sourceField":"deliveryLink.expiresAt","sourceStateSelector":"deliveryLink.state=expired"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m25.current_reviewed_outcome_summary','mission25_26_advisory','Mission 25','current_reviewed_job_outcome_summary',
 ARRAY['tenantId','estimateId','summaryId'],ARRAY['revision','digest','sourceDigest','evaluationRevision','evaluationDigest','fresh','eventKind','eventTime'],
 NULL,'revision','digest','sourceDigest',
 '{"reviewed_summary_created":{"sourceField":"summary.createdAt","sourceStateSelector":"summary.revision_digest_and_fresh=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m25.current_reviewed_recommendation','mission25_26_advisory','Mission 25','current_reviewed_learning_recommendation',
 ARRAY['tenantId','serviceKey','proposalId'],ARRAY['revision','digest','consentRevision','consentDigest','sourceSummarySetDigest','eventKind','eventTime'],
 NULL,'revision','digest','sourceSummarySetDigest',
 '{"reviewed_recommendation_created":{"sourceField":"proposal.createdAt","sourceStateSelector":"proposal.revision_digest_and_fresh=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m26.reviewed_advisory_handoff','mission25_26_advisory','Mission 26','reviewed_forecast_advisory_handoff',
 ARRAY['tenantId','forecastRunId','handoffId'],ARRAY['runDigest','outputDigest','currentnessRevision','currentnessDigest','handoffRevision','handoffDigest','eventKind','eventTime'],
 NULL,'handoffRevision','handoffDigest','currentnessDigest',
 '{"handoff_created":{"sourceField":"handoff.createdAt","sourceStateSelector":"handoff.revision=1"},"handoff_review_event_recorded":{"sourceField":"handoff.history.recordedAt","sourceStateSelector":"history.action=requested|dismissed|consumed|withdrawn"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m27.invoice_lifecycle_state','mission27_financial_collection','Mission 27','exact_current_invoice_draft_lifecycle_state',
 ARRAY['tenantId','estimateId','invoiceDraftOriginId'],ARRAY['invoiceDraftRevision','invoiceDraftDigest','invoiceDraftState','sourceCurrent','eventKind','eventTime'],
 NULL,'invoiceDraftRevision','invoiceDraftDigest','invoiceDraftDigest',
 '{"invoice_draft_revision_updated":{"sourceField":"invoiceDraft.updatedAt","sourceStateSelector":"invoiceDraft.state=current_and_revision_digest=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m27.receivable_due_aging_state','mission27_financial_collection','Mission 27','exact_current_receivable_due_aging_state',
 ARRAY['tenantId','issuedInvoiceId','receivableProjectionId'],ARRAY['issuedInvoiceVersionDigest','projectionRevision','projectionDigest','currency','collectibleBalanceMinorUnits','dueState','agingBucket','eventKind','eventTime'],
 NULL,'projectionRevision','projectionDigest','issuedInvoiceVersionDigest',
 '{"receivable_due_boundary":{"sourceField":"receivable.issuedDueDate","sourceStateSelector":"due_state_balance_currency_revision_and_digest=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m27.payment_receipt_settlement_state','mission27_financial_collection','Mission 27','exact_current_payment_receipt_settlement_state',
 ARRAY['tenantId','issuedInvoiceId','paymentId','allocationId'],ARRAY['paymentRevision','paymentDigest','receiptDigest','allocationDigest','settlementState','providerOccurrenceSequence_or_offlineRevision','eventKind','eventTime'],
 NULL,'paymentRevision','paymentDigest','receiptDigest',
 '{"provider_event_occurred":{"sourceField":"providerEvent.providerOccurredAt","sourceStateSelector":"provider_event_identity_and_sequence=exact"},"payment_outcome_occurred":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"payment_outcome_revision_digest_and_state=exact"},"offline_payment_outcome_occurred":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"offline_outcome_revision_digest_and_state=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m27.refund_dispute_correction_state','mission27_financial_collection','Mission 27','exact_current_refund_dispute_correction_state',
 ARRAY['tenantId','issuedInvoiceId','financialCorrectionId'],ARRAY['issuedInvoiceVersionDigest','correctionRevision','correctionDigest','refundOrDisputeState','projectionDigest','eventKind','eventTime'],
 NULL,'correctionRevision','correctionDigest','issuedInvoiceVersionDigest',
 '{"invoice_correction_recorded":{"sourceField":"correction.recorded_at","sourceStateSelector":"correction_sequence_revision_and_digest=exact"},"refund_or_dispute_outcome_occurred":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"refund_or_dispute_outcome_revision_digest_and_state=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m27.offline_payment_state','mission27_financial_collection','Mission 27','exact_current_offline_cash_or_check_state',
 ARRAY['tenantId','issuedInvoiceId','offlineReceiptId'],ARRAY['offlineRevision','offlineDigest','offlineState','allocationDigest','eventKind','eventTime'],
 NULL,'offlineRevision','offlineDigest','allocationDigest',
 '{"cash_received":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"offlineState=offline_received_and_tender=cash"},"check_received":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"offlineState=check_clearance_unknown"},"check_cleared":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"offlineState=check_cleared_and_authenticated_bank_clearance=exact"},"check_returned":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"offlineState=check_returned"},"offline_reversed":{"sourceField":"paymentOutcome.outcomeOccurredAt","sourceStateSelector":"offlineState=offline_reversed"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19'),
('m27.reviewed_collection_handoff','mission27_financial_collection','Mission 27','exact_current_reviewed_collection_handoff',
 ARRAY['tenantId','issuedInvoiceId','collectionReviewId','handoffRequestId'],ARRAY['issuedInvoiceVersionDigest','reviewRevision','reviewDigest','requestRevision','requestDigest','receivableProjectionDigest','eventKind','eventTime'],
 NULL,'requestRevision','requestDigest','receivableProjectionDigest',
 '{"collection_handoff_requested":{"sourceField":"reviewedHandoff.requestedAt","sourceStateSelector":"request_revision_digest_and_receivable_projection=exact"}}','5BEAD010F14661C061DD0AD4B649946DF0FFDF43CF649ADE9A2CB98F29270F19');

CREATE TABLE public.canonical_automation_trigger_snapshots_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 snapshot_id UUID NOT NULL,
 trigger_id TEXT NOT NULL REFERENCES public.canonical_automation_trigger_catalog_v1(trigger_id) ON DELETE RESTRICT,
 source_class_id TEXT NOT NULL,
 record_identity_digest TEXT NOT NULL CHECK(record_identity_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^sha256:[0-9a-f]{64}$'),
 source_digest TEXT NOT NULL CHECK(source_digest~'^sha256:[0-9a-f]{64}$'),
 event_kind TEXT NOT NULL,
 event_time TIMESTAMPTZ(6) NOT NULL,
 currentness_pins_digest TEXT NOT NULL CHECK(currentness_pins_digest~'^sha256:[0-9a-f]{64}$'),
 provenance_kind TEXT NOT NULL CHECK(provenance_kind IN('actor','authenticated_event')),
 provenance_digest TEXT NOT NULL CHECK(provenance_digest~'^sha256:[0-9a-f]{64}$'),
 lineage_kind TEXT NOT NULL CHECK(lineage_kind IN('original','correction')),
 lineage_sequence BIGINT NOT NULL CHECK(lineage_sequence BETWEEN 1 AND 9007199254740991),
 predecessor_snapshot_id UUID NULL,
 predecessor_snapshot_digest TEXT NULL CHECK(predecessor_snapshot_digest IS NULL OR predecessor_snapshot_digest~'^sha256:[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 snapshot_digest TEXT NOT NULL CHECK(snapshot_digest~'^sha256:[0-9a-f]{64}$'),
 request_text TEXT NOT NULL CHECK(octet_length(request_text) BETWEEN 2 AND 65536),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 observed_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,snapshot_id),
 UNIQUE(organization_id,trigger_id,record_identity_digest,event_kind,lineage_sequence),
 UNIQUE(organization_id,snapshot_digest),
 FOREIGN KEY(organization_id,predecessor_snapshot_id)
  REFERENCES public.canonical_automation_trigger_snapshots_v1(organization_id,snapshot_id) ON DELETE RESTRICT,
 CHECK(retention_class='source_snapshot_history'),
 CHECK((lineage_kind='original' AND lineage_sequence=1 AND predecessor_snapshot_id IS NULL AND predecessor_snapshot_digest IS NULL)
    OR (lineage_kind='correction' AND lineage_sequence>1 AND predecessor_snapshot_id IS NOT NULL AND predecessor_snapshot_digest IS NOT NULL)),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'snapshotId' IS NOT DISTINCT FROM snapshot_id::text),
 CHECK(document->>'triggerId' IS NOT DISTINCT FROM trigger_id),
 CHECK(document->>'sourceClassId' IS NOT DISTINCT FROM source_class_id),
 CHECK(document->>'recordIdentityDigest' IS NOT DISTINCT FROM record_identity_digest),
 CHECK(document->>'canonicalDigest' IS NOT DISTINCT FROM canonical_digest),
 CHECK(document->>'sourceDigest' IS NOT DISTINCT FROM source_digest),
 CHECK(document#>>'{eventBinding,eventKind}' IS NOT DISTINCT FROM event_kind),
 CHECK(document#>>'{eventBinding,eventTime}' IS NOT DISTINCT FROM public.canonical_automation_utc_v1(event_time)),
 CHECK(document#>>'{currentness,pinsDigest}' IS NOT DISTINCT FROM currentness_pins_digest),
 CHECK(document#>>'{provenance,kind}' IS NOT DISTINCT FROM provenance_kind),
 CHECK(document#>>'{provenance,provenanceDigest}' IS NOT DISTINCT FROM provenance_digest),
 CHECK(document#>>'{lineage,kind}' IS NOT DISTINCT FROM lineage_kind),
 CHECK(jsonb_typeof(document#>'{lineage,sequence}') IS NOT DISTINCT FROM 'number'
  AND (document#>>'{lineage,sequence}')~'^(0|[1-9][0-9]*)$'
  AND (document#>>'{lineage,sequence}')::bigint IS NOT DISTINCT FROM lineage_sequence),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest),
 CHECK(document->>'snapshotDigest' IS NOT DISTINCT FROM snapshot_digest),
 CHECK(document->>'observedAt' IS NOT DISTINCT FROM public.canonical_automation_utc_v1(observed_at))
);

CREATE INDEX canonical_automation_trigger_snapshots_v1_record_lineage
 ON public.canonical_automation_trigger_snapshots_v1(
  organization_id,trigger_id,record_identity_digest,event_kind,lineage_sequence
 );
CREATE INDEX canonical_automation_trigger_snapshots_v1_event_time
 ON public.canonical_automation_trigger_snapshots_v1(organization_id,trigger_id,event_kind,event_time);
CREATE INDEX canonical_automation_trigger_snapshots_v1_observed
 ON public.canonical_automation_trigger_snapshots_v1(organization_id,observed_at);

CREATE TRIGGER canonical_automation_trigger_catalog_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_trigger_catalog_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_trigger_snapshots_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_trigger_snapshots_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_trigger_snapshots_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_trigger_snapshots_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_trigger_snapshots_v1_tenant_owner_only
 ON public.canonical_automation_trigger_snapshots_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_trigger_snapshots_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_trigger_snapshots_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_store_trigger_snapshot_v1(
 canonical_text_value TEXT,trusted_provenance_value JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE doc JSONB; org UUID; snapshot_value UUID; catalog RECORD; event_spec JSONB; event_kind_value TEXT;
 event_time_value TIMESTAMPTZ; request_digest_value TEXT; record_digest_value TEXT; pins_digest_value TEXT;
 provenance_digest_value TEXT; canonical_digest_value TEXT; source_digest_value TEXT; now_value TIMESTAMPTZ;
 stored RECORD; predecessor RECORD; snapshot_base JSONB; snapshot_doc JSONB; snapshot_digest_value TEXT;
 lineage_sequence_value BIGINT; lineage_kind_value TEXT;
 actor_value UUID; session_value UUID; membership_value UUID; revision_value BIGINT; version_value TEXT;
BEGIN
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','snapshotId','triggerId',
  'sourceClassId','ownerMission','factKind','recordIdentity','recordIdentityDigest','sourceVersion','canonicalDigest',
  'sourceDigest','eventBinding','currentness','provenance','lineage','requestDigest']) IS DISTINCT FROM TRUE OR
  jsonb_typeof(doc->'schemaVersion') IS DISTINCT FROM 'string' OR
  doc->>'schemaVersion' IS DISTINCT FROM 'mission28.source-snapshot.request.v1' OR
  jsonb_typeof(doc->'tenantId') IS DISTINCT FROM 'string' OR jsonb_typeof(doc->'snapshotId') IS DISTINCT FROM 'string' OR
  jsonb_typeof(doc->'triggerId') IS DISTINCT FROM 'string' OR jsonb_typeof(doc->'sourceClassId') IS DISTINCT FROM 'string' OR
  jsonb_typeof(doc->'ownerMission') IS DISTINCT FROM 'string' OR jsonb_typeof(doc->'factKind') IS DISTINCT FROM 'string' OR
  jsonb_typeof(doc->'recordIdentityDigest') IS DISTINCT FROM 'string' OR
  jsonb_typeof(doc->'canonicalDigest') IS DISTINCT FROM 'string' OR jsonb_typeof(doc->'sourceDigest') IS DISTINCT FROM 'string' OR
  jsonb_typeof(doc->'requestDigest') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Mission 28 source snapshot fields invalid' USING ERRCODE='22023'; END IF;
 BEGIN org:=(doc->>'tenantId')::uuid; snapshot_value:=(doc->>'snapshotId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Mission 28 source snapshot identity invalid' USING ERRCODE='22023'; END;
 SELECT * INTO catalog FROM public.canonical_automation_trigger_catalog_v1 WHERE trigger_id=doc->>'triggerId';
 IF catalog.trigger_id IS NULL OR doc->>'sourceClassId' IS DISTINCT FROM catalog.source_class_id OR
    doc->>'ownerMission' IS DISTINCT FROM catalog.owner_mission OR doc->>'factKind' IS DISTINCT FROM catalog.fact_kind THEN
  RAISE EXCEPTION 'Mission 28 trigger authority invalid' USING ERRCODE='22023'; END IF;

 IF public.canonical_automation_part4b_keys_exact_v1(doc->'recordIdentity',catalog.record_identity_keys) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 source record identity shape invalid' USING ERRCODE='22023'; END IF;
 IF doc#>>'{recordIdentity,tenantId}' IS DISTINCT FROM org::text OR EXISTS(
  SELECT 1 FROM jsonb_each(doc->'recordIdentity') entry(key,value)
   WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR octet_length(value#>>'{}') NOT BETWEEN 1 AND 256) THEN
  RAISE EXCEPTION 'Mission 28 source record identity invalid' USING ERRCODE='22023'; END IF;
 record_digest_value:=public.canonical_automation_digest_v1('mission28.source-record-identity.v1'||chr(10),doc->'recordIdentity');
 IF doc->>'recordIdentityDigest' IS DISTINCT FROM record_digest_value THEN
  RAISE EXCEPTION 'Mission 28 source record identity digest invalid' USING ERRCODE='22023'; END IF;

 IF public.canonical_automation_part4b_keys_exact_v1(doc->'sourceVersion',ARRAY['kind','version','revision']) IS DISTINCT FROM TRUE OR
    jsonb_typeof(doc#>'{sourceVersion,kind}') IS DISTINCT FROM 'string' OR
    COALESCE(jsonb_typeof(doc#>'{sourceVersion,version}'),'') NOT IN('string','null') OR
    COALESCE(jsonb_typeof(doc#>'{sourceVersion,revision}'),'') NOT IN('number','null') THEN
  RAISE EXCEPTION 'Mission 28 source version shape invalid' USING ERRCODE='22023'; END IF;
 IF doc#>>'{sourceVersion,kind}'='version' THEN
  IF jsonb_typeof(doc#>'{sourceVersion,version}') IS DISTINCT FROM 'string' OR doc#>'{sourceVersion,revision}' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'Mission 28 source version invalid' USING ERRCODE='22023'; END IF;
 ELSIF doc#>>'{sourceVersion,kind}'='revision' THEN
  IF doc#>'{sourceVersion,version}' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(doc#>'{sourceVersion,revision}') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION 'Mission 28 source revision invalid' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Mission 28 source version kind invalid' USING ERRCODE='22023'; END IF;
 version_value:=doc#>>'{sourceVersion,version}';
 IF version_value IS NOT NULL AND octet_length(version_value) NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'Mission 28 source version value invalid' USING ERRCODE='22023'; END IF;
 IF doc#>'{sourceVersion,revision}' IS DISTINCT FROM 'null'::jsonb THEN
  IF octet_length((doc#>'{sourceVersion,revision}')::text)>16 OR
     (doc#>'{sourceVersion,revision}')::text!~'^(0|[1-9][0-9]*)$' THEN
   RAISE EXCEPTION 'Mission 28 source revision value invalid' USING ERRCODE='22023'; END IF;
  revision_value:=(doc#>>'{sourceVersion,revision}')::bigint;
  IF revision_value NOT BETWEEN 1 AND 9007199254740991 THEN
   RAISE EXCEPTION 'Mission 28 source revision range invalid' USING ERRCODE='22023'; END IF;
 END IF;

 IF (catalog.version_pin IS NOT NULL AND (doc#>>'{sourceVersion,kind}' IS DISTINCT FROM 'version' OR
     doc#>'{sourceVersion,revision}' IS DISTINCT FROM 'null'::jsonb)) OR
    (catalog.revision_pin IS NOT NULL AND (doc#>>'{sourceVersion,kind}' IS DISTINCT FROM 'revision' OR
     doc#>'{sourceVersion,version}' IS DISTINCT FROM 'null'::jsonb)) THEN
  RAISE EXCEPTION 'Mission 28 source version authority invalid' USING ERRCODE='22023'; END IF;

 IF public.canonical_automation_part4b_keys_exact_v1(doc->'eventBinding',ARRAY['eventKind','eventTime','sourceField','sourceStateSelector']) IS DISTINCT FROM TRUE OR
    jsonb_typeof(doc#>'{eventBinding,eventKind}') IS DISTINCT FROM 'string' OR
    jsonb_typeof(doc#>'{eventBinding,eventTime}') IS DISTINCT FROM 'string' OR
    jsonb_typeof(doc#>'{eventBinding,sourceField}') IS DISTINCT FROM 'string' OR
    jsonb_typeof(doc#>'{eventBinding,sourceStateSelector}') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Mission 28 event binding shape invalid' USING ERRCODE='22023'; END IF;
 event_kind_value:=doc#>>'{eventBinding,eventKind}'; event_spec:=catalog.event_kinds->event_kind_value;
 IF jsonb_typeof(event_spec) IS DISTINCT FROM 'object' OR
    doc#>>'{eventBinding,sourceField}' IS DISTINCT FROM event_spec->>'sourceField' OR
    doc#>>'{eventBinding,sourceStateSelector}' IS DISTINCT FROM event_spec->>'sourceStateSelector' OR
    NOT public.canonical_automation_part4b_utc_v1(doc#>>'{eventBinding,eventTime}') THEN
  RAISE EXCEPTION 'Mission 28 event binding authority invalid' USING ERRCODE='22023'; END IF;
 event_time_value:=(doc#>>'{eventBinding,eventTime}')::timestamptz;

 IF public.canonical_automation_part4b_keys_exact_v1(doc->'currentness',ARRAY['availability','pins','pinsDigest']) IS DISTINCT FROM TRUE OR
    jsonb_typeof(doc#>'{currentness,availability}') IS DISTINCT FROM 'string' OR
    doc#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' OR
    jsonb_typeof(doc#>'{currentness,pinsDigest}') IS DISTINCT FROM 'string' OR
    public.canonical_automation_part4b_keys_exact_v1(doc#>'{currentness,pins}',catalog.currentness_pin_keys) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_pin_values_v1(doc#>'{currentness,pins}') IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 source currentness invalid' USING ERRCODE='22023'; END IF;
 IF doc#>>'{currentness,pins,eventKind}' IS DISTINCT FROM event_kind_value OR
    doc#>>'{currentness,pins,eventTime}' IS DISTINCT FROM doc#>>'{eventBinding,eventTime}' THEN
  RAISE EXCEPTION 'Mission 28 event currentness invalid' USING ERRCODE='22023'; END IF;
 pins_digest_value:=public.canonical_automation_digest_v1('mission28.source-currentness-pins.v1'||chr(10),doc#>'{currentness,pins}');
 canonical_digest_value:=doc->>'canonicalDigest'; source_digest_value:=doc->>'sourceDigest';
 IF doc#>>'{currentness,pinsDigest}' IS DISTINCT FROM pins_digest_value OR
    COALESCE(canonical_digest_value,'')!~'^sha256:[0-9a-f]{64}$' OR COALESCE(source_digest_value,'')!~'^sha256:[0-9a-f]{64}$' OR
    doc#>>ARRAY['currentness','pins',catalog.canonical_digest_pin] IS DISTINCT FROM canonical_digest_value OR
    doc#>>ARRAY['currentness','pins',catalog.source_digest_pin] IS DISTINCT FROM source_digest_value OR
    (catalog.version_pin IS NOT NULL AND doc#>>ARRAY['currentness','pins',catalog.version_pin] IS DISTINCT FROM version_value) OR
    (catalog.revision_pin IS NOT NULL AND (jsonb_typeof(doc#>ARRAY['currentness','pins',catalog.revision_pin]) IS DISTINCT FROM 'number' OR
      octet_length(doc#>>ARRAY['currentness','pins',catalog.revision_pin])>16 OR
      COALESCE(doc#>>ARRAY['currentness','pins',catalog.revision_pin],'')!~'^(0|[1-9][0-9]*)$' OR
      (doc#>>ARRAY['currentness','pins',catalog.revision_pin])::bigint IS DISTINCT FROM revision_value)) THEN
  RAISE EXCEPTION 'Mission 28 source currentness binding invalid' USING ERRCODE='22023'; END IF;

 IF public.canonical_automation_part4b_keys_exact_v1(doc->'provenance',ARRAY['kind','tenantId','actorId','sessionId','membershipId',
    'authenticatedEventId','authenticatedEventAuthority','authenticatedEventDigest','provenanceDigest']) IS DISTINCT FROM TRUE OR
    jsonb_typeof(doc#>'{provenance,kind}') IS DISTINCT FROM 'string' OR
    jsonb_typeof(doc#>'{provenance,tenantId}') IS DISTINCT FROM 'string' OR
    doc#>>'{provenance,tenantId}' IS DISTINCT FROM org::text OR
    jsonb_typeof(doc#>'{provenance,provenanceDigest}') IS DISTINCT FROM 'string' OR
    trusted_provenance_value IS DISTINCT FROM doc->'provenance' THEN
  RAISE EXCEPTION 'Mission 28 source provenance shape invalid' USING ERRCODE='22023'; END IF;
 provenance_digest_value:=public.canonical_automation_digest_v1(
  'mission28.source-provenance.v1'||chr(10),
  (doc->'provenance')-'provenanceDigest'::text
 );
 IF doc#>>'{provenance,provenanceDigest}' IS DISTINCT FROM provenance_digest_value THEN
  RAISE EXCEPTION 'Mission 28 source provenance digest invalid' USING ERRCODE='22023'; END IF;
 IF doc#>>'{provenance,kind}'='actor' THEN
  IF COALESCE(jsonb_typeof(doc#>'{provenance,actorId}'),'') IS DISTINCT FROM 'string' OR
     COALESCE(jsonb_typeof(doc#>'{provenance,sessionId}'),'') IS DISTINCT FROM 'string' OR
     COALESCE(jsonb_typeof(doc#>'{provenance,membershipId}'),'') IS DISTINCT FROM 'string' OR
     doc#>'{provenance,authenticatedEventId}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{provenance,authenticatedEventAuthority}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{provenance,authenticatedEventDigest}' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'Mission 28 actor provenance invalid' USING ERRCODE='22023'; END IF;
  BEGIN actor_value:=(doc#>>'{provenance,actorId}')::uuid; session_value:=(doc#>>'{provenance,sessionId}')::uuid;
   membership_value:=(doc#>>'{provenance,membershipId}')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'Mission 28 actor provenance identity invalid' USING ERRCODE='22023'; END;
 ELSIF doc#>>'{provenance,kind}'='authenticated_event' THEN
  IF doc#>'{provenance,actorId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{provenance,sessionId}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{provenance,membershipId}' IS DISTINCT FROM 'null'::jsonb OR
     jsonb_typeof(doc#>'{provenance,authenticatedEventId}') IS DISTINCT FROM 'string' OR
     jsonb_typeof(doc#>'{provenance,authenticatedEventAuthority}') IS DISTINCT FROM 'string' OR
     doc#>>'{provenance,authenticatedEventAuthority}' IS DISTINCT FROM 'server_resolved_upstream_authenticated_event_v1' OR
     COALESCE(doc#>>'{provenance,authenticatedEventId}','')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR
     jsonb_typeof(doc#>'{provenance,authenticatedEventDigest}') IS DISTINCT FROM 'string' OR
     COALESCE(doc#>>'{provenance,authenticatedEventDigest}','')!~'^sha256:[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Mission 28 authenticated event provenance invalid' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Mission 28 source provenance kind invalid' USING ERRCODE='22023'; END IF;

 IF public.canonical_automation_part4b_keys_exact_v1(doc->'lineage',ARRAY['kind','sequence','predecessorSnapshotId','predecessorSnapshotDigest']) IS DISTINCT FROM TRUE OR
    jsonb_typeof(doc#>'{lineage,kind}') IS DISTINCT FROM 'string' OR jsonb_typeof(doc#>'{lineage,sequence}') IS DISTINCT FROM 'number' OR
    octet_length((doc#>'{lineage,sequence}')::text)>16 OR (doc#>'{lineage,sequence}')::text!~'^(0|[1-9][0-9]*)$' OR
    COALESCE(jsonb_typeof(doc#>'{lineage,predecessorSnapshotId}'),'') NOT IN('string','null') OR
    COALESCE(jsonb_typeof(doc#>'{lineage,predecessorSnapshotDigest}'),'') NOT IN('string','null') THEN
  RAISE EXCEPTION 'Mission 28 correction lineage shape invalid' USING ERRCODE='22023'; END IF;
 lineage_kind_value:=doc#>>'{lineage,kind}'; lineage_sequence_value:=(doc#>>'{lineage,sequence}')::bigint;
 IF lineage_sequence_value NOT BETWEEN 1 AND 9007199254740991 OR
    (lineage_kind_value='original' AND (lineage_sequence_value IS DISTINCT FROM 1 OR
      doc#>'{lineage,predecessorSnapshotId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{lineage,predecessorSnapshotDigest}' IS DISTINCT FROM 'null'::jsonb)) OR
    (lineage_kind_value='correction' AND (lineage_sequence_value<=1 OR jsonb_typeof(doc#>'{lineage,predecessorSnapshotId}') IS DISTINCT FROM 'string' OR
      jsonb_typeof(doc#>'{lineage,predecessorSnapshotDigest}') IS DISTINCT FROM 'string' OR
      COALESCE(doc#>>'{lineage,predecessorSnapshotDigest}','')!~'^sha256:[0-9a-f]{64}$')) OR
    COALESCE(lineage_kind_value,'') NOT IN('original','correction') THEN
  RAISE EXCEPTION 'Mission 28 correction lineage invalid' USING ERRCODE='22023'; END IF;
 request_digest_value:=public.canonical_automation_digest_v1(
  'mission28.source-snapshot.request.v1'||chr(10),
  doc-'requestDigest'::text
 );
 IF doc->>'requestDigest' IS DISTINCT FROM request_digest_value THEN
  RAISE EXCEPTION 'Mission 28 source snapshot request digest invalid' USING ERRCODE='22023'; END IF;

 now_value:=public.canonical_automation_enter_tenant_v1(org);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-lineage:'||catalog.trigger_id||':'||record_digest_value||':'||event_kind_value,0));
 SELECT * INTO stored FROM public.canonical_automation_trigger_snapshots_v1
  WHERE organization_id=org AND snapshot_id=snapshot_value FOR SHARE;
 IF stored.snapshot_id IS NOT NULL THEN
  IF stored.request_digest=request_digest_value AND stored.request_text=canonical_text_value AND stored.provenance_digest=provenance_digest_value THEN
   RETURN jsonb_build_object('state','stored','replayed',TRUE,'snapshotId',snapshot_value,
    'snapshotDigest',stored.snapshot_digest,'observedAt',public.canonical_automation_utc_v1(stored.observed_at)); END IF;
  RAISE EXCEPTION 'Mission 28 source snapshot identity conflict' USING ERRCODE='23505';
 END IF;

 IF doc#>>'{provenance,kind}'='actor' AND NOT EXISTS(
  SELECT 1 FROM public.auth_sessions session
   JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id
    AND membership.id=session.membership_id AND membership.user_id=session.user_id
   JOIN public.users account ON account.organization_id=session.organization_id
    AND account.id=session.user_id
  WHERE session.id=session_value AND session.organization_id=org AND session.user_id=actor_value
   AND session.membership_id=membership_value AND session.status='active' AND session.revoked_at IS NULL
   AND session.access_expires_at>now_value AND membership.status='active' AND membership.revoked_at IS NULL
   AND account.status='active') THEN
  RAISE EXCEPTION 'Mission 28 actor session provenance unavailable' USING ERRCODE='42501'; END IF;

 IF lineage_kind_value='correction' THEN
  BEGIN
   SELECT * INTO predecessor FROM public.canonical_automation_trigger_snapshots_v1
    WHERE organization_id=org AND snapshot_id=(doc#>>'{lineage,predecessorSnapshotId}')::uuid FOR SHARE;
  EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'Mission 28 correction predecessor identity invalid' USING ERRCODE='22023'; END;
  IF predecessor.snapshot_id IS NULL OR predecessor.snapshot_digest IS DISTINCT FROM doc#>>'{lineage,predecessorSnapshotDigest}' OR
     predecessor.trigger_id IS DISTINCT FROM catalog.trigger_id OR predecessor.record_identity_digest IS DISTINCT FROM record_digest_value OR
     predecessor.event_kind IS DISTINCT FROM event_kind_value OR predecessor.lineage_sequence+1 IS DISTINCT FROM lineage_sequence_value OR
     (predecessor.document->'sourceVersion' IS NOT DISTINCT FROM doc->'sourceVersion' AND
      predecessor.canonical_digest IS NOT DISTINCT FROM canonical_digest_value AND predecessor.source_digest IS NOT DISTINCT FROM source_digest_value AND
      predecessor.currentness_pins_digest IS NOT DISTINCT FROM pins_digest_value) THEN
   RAISE EXCEPTION 'Mission 28 correction predecessor invalid' USING ERRCODE='40001'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND trigger_id=catalog.trigger_id AND record_identity_digest=record_digest_value
    AND event_kind=event_kind_value) THEN
   RAISE EXCEPTION 'Mission 28 duplicate original source lineage denied' USING ERRCODE='23505'; END IF;
 END IF;

 snapshot_base:=(doc-'requestDigest'::text)||jsonb_build_object('schemaVersion','mission28.source-snapshot.v1',
  'requestDigest',request_digest_value,'observedAt',public.canonical_automation_utc_v1(now_value));
 snapshot_digest_value:=public.canonical_automation_digest_v1('mission28.source-snapshot.v1'||chr(10),snapshot_base);
 snapshot_doc:=snapshot_base||jsonb_build_object('snapshotDigest',snapshot_digest_value);
 INSERT INTO public.canonical_automation_trigger_snapshots_v1 VALUES(
  org,snapshot_value,catalog.trigger_id,catalog.source_class_id,record_digest_value,canonical_digest_value,source_digest_value,
  event_kind_value,event_time_value,pins_digest_value,doc#>>'{provenance,kind}',provenance_digest_value,lineage_kind_value,
  lineage_sequence_value,CASE WHEN lineage_kind_value='correction' THEN (doc#>>'{lineage,predecessorSnapshotId}')::uuid ELSE NULL END,
  doc#>>'{lineage,predecessorSnapshotDigest}',request_digest_value,snapshot_digest_value,canonical_text_value,
  public.canonical_automation_json_v1(snapshot_doc),snapshot_doc,'source_snapshot_history',
  'postgresql_statement_timestamp_v1','UTC',now_value);
 RETURN jsonb_build_object('state','stored','replayed',FALSE,'snapshotId',snapshot_value,
  'snapshotDigest',snapshot_digest_value,'observedAt',public.canonical_automation_utc_v1(now_value));
END $$;

REVOKE ALL ON TABLE public.canonical_automation_trigger_catalog_v1,
 public.canonical_automation_trigger_snapshots_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_part4b_keys_exact_v1(JSONB,TEXT[]),
 public.canonical_automation_part4b_utc_v1(TEXT),public.canonical_automation_part4b_pin_values_v1(JSONB),
 public.canonical_automation_store_trigger_snapshot_v1(TEXT,JSONB) FROM PUBLIC;
