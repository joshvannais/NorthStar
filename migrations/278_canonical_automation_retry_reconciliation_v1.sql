-- Mission 28 Part 6D: owner-only retry and reconciliation authority. This
-- migration records bounded no-effect decisions. It mounts no scheduler,
-- worker, queue, provider, recipient, callback, message or effect path.

CREATE TABLE public.canonical_automation_delivery_retry_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 schedule_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 receipt_id UUID NOT NULL,
 provider_request_identity TEXT NOT NULL CHECK(provider_request_identity~'^m28:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 provider_request_digest TEXT NOT NULL CHECK(provider_request_digest~'^sha256:[0-9a-f]{64}$'),
 idempotency_receipt_digest TEXT NOT NULL CHECK(idempotency_receipt_digest~'^sha256:[0-9a-f]{64}$'),
 retry_policy_digest TEXT NOT NULL CHECK(retry_policy_digest~'^sha256:[0-9a-f]{64}$'),
 attempt_ceiling INTEGER NOT NULL CHECK(attempt_ceiling BETWEEN 1 AND 8),
 last_decision_sequence INTEGER NOT NULL CHECK(last_decision_sequence BETWEEN 1 AND 64),
 last_attempt_ordinal INTEGER NOT NULL CHECK(last_attempt_ordinal BETWEEN 1 AND 8),
 state TEXT NOT NULL CHECK(state IN(
  'retry_scheduled_no_effect','reconciliation_required_no_resend','permanent_stop_terminal',
  'permanent_stop_attempt_ceiling','permanent_stop_effect_confirmed','permanent_stop_unknown_or_unsafe')),
 pending_observation_id UUID,
 pending_observation_digest TEXT CHECK(pending_observation_digest IS NULL OR pending_observation_digest~'^sha256:[0-9a-f]{64}$'),
 pending_observation_kind TEXT,
 pending_attempt_lease_id UUID,
 pending_attempt_fence_token BIGINT CHECK(pending_attempt_fence_token IS NULL OR pending_attempt_fence_token BETWEEN 1 AND 9007199254740991),
 next_attempt_at TIMESTAMPTZ(6),
 last_decision_id UUID NOT NULL,
 last_decision_digest TEXT NOT NULL CHECK(last_decision_digest~'^sha256:[0-9a-f]{64}$'),
 updated_at TIMESTAMPTZ(6) NOT NULL,
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,schedule_id),
 UNIQUE(organization_id,last_decision_id),
 FOREIGN KEY(organization_id,schedule_id)
  REFERENCES public.canonical_automation_action_schedules_v1(organization_id,schedule_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,receipt_id)
  REFERENCES public.canonical_automation_provider_request_receipts_v1(organization_id,receipt_id) ON DELETE RESTRICT,
 CHECK((state='retry_scheduled_no_effect' AND next_attempt_at IS NOT NULL AND pending_observation_id IS NULL
         AND pending_observation_digest IS NULL AND pending_observation_kind IS NULL
         AND pending_attempt_lease_id IS NULL AND pending_attempt_fence_token IS NULL)
    OR (state='reconciliation_required_no_resend' AND next_attempt_at IS NULL AND pending_observation_id IS NOT NULL
         AND pending_observation_digest IS NOT NULL
         AND pending_observation_kind IN('provider_timeout_uncertain','provider_acknowledgement_uncertain')
         AND pending_attempt_lease_id IS NOT NULL AND pending_attempt_fence_token IS NOT NULL)
    OR (state LIKE 'permanent_stop_%' AND next_attempt_at IS NULL AND pending_observation_id IS NULL
         AND pending_observation_digest IS NULL AND pending_observation_kind IS NULL
         AND pending_attempt_lease_id IS NULL AND pending_attempt_fence_token IS NULL))
);

CREATE TABLE public.canonical_automation_delivery_retry_events_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 decision_id UUID NOT NULL,
 decision_sequence INTEGER NOT NULL CHECK(decision_sequence BETWEEN 1 AND 64),
 decision_kind TEXT NOT NULL CHECK(decision_kind IN('classify_attempt','record_reconciliation')),
 schedule_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 receipt_id UUID NOT NULL,
 provider_request_identity TEXT NOT NULL CHECK(provider_request_identity~'^m28:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 provider_request_digest TEXT NOT NULL CHECK(provider_request_digest~'^sha256:[0-9a-f]{64}$'),
 idempotency_receipt_digest TEXT NOT NULL CHECK(idempotency_receipt_digest~'^sha256:[0-9a-f]{64}$'),
 decision_lease_id UUID NOT NULL,
 decision_fence_token BIGINT NOT NULL CHECK(decision_fence_token BETWEEN 1 AND 9007199254740991),
 attempt_ordinal INTEGER NOT NULL CHECK(attempt_ordinal BETWEEN 1 AND 8),
 attempt_lease_id UUID NOT NULL,
 attempt_fence_token BIGINT NOT NULL CHECK(attempt_fence_token BETWEEN 1 AND 9007199254740991),
 observation_id UUID NOT NULL,
 observation_kind TEXT NOT NULL CHECK(observation_kind IN(
  'provider_retryable_definite_no_acceptance','provider_rate_limited_definite_no_acceptance',
  'provider_terminal_rejection','provider_timeout_uncertain','provider_acknowledgement_uncertain',
  'unknown_or_unsafe_outcome')),
 observation_digest TEXT NOT NULL CHECK(observation_digest~'^sha256:[0-9a-f]{64}$'),
 observation_occurred_at TIMESTAMPTZ(6) NOT NULL,
 retry_after_seconds INTEGER CHECK(retry_after_seconds IS NULL OR retry_after_seconds BETWEEN 1 AND 3600),
 provider_timeout_seconds INTEGER CHECK(provider_timeout_seconds IS NULL OR provider_timeout_seconds BETWEEN 1 AND 120),
 reconciliation_state TEXT NOT NULL CHECK(reconciliation_state IN(
  'not_performed','no_effect_confirmed','effect_confirmed','unknown_or_unsafe')),
 reconciliation_evidence_id UUID,
 reconciliation_evidence_digest TEXT CHECK(reconciliation_evidence_digest IS NULL OR reconciliation_evidence_digest~'^sha256:[0-9a-f]{64}$'),
 reconciliation_observed_at TIMESTAMPTZ(6),
 classification TEXT NOT NULL CHECK(classification IN(
  'retryable','terminal','uncertain','unsafe','reconciled_no_effect','reconciled_effect','reconciled_unknown_or_unsafe')),
 attempt_ceiling INTEGER NOT NULL CHECK(attempt_ceiling BETWEEN 1 AND 8),
 base_delay_seconds INTEGER NOT NULL CHECK(base_delay_seconds BETWEEN 1 AND 900),
 maximum_delay_seconds INTEGER NOT NULL CHECK(maximum_delay_seconds BETWEEN 1 AND 3600),
 maximum_retry_after_seconds INTEGER NOT NULL CHECK(maximum_retry_after_seconds BETWEEN 1 AND 3600),
 maximum_jitter_seconds INTEGER NOT NULL CHECK(maximum_jitter_seconds BETWEEN 0 AND 60),
 retry_policy_digest TEXT NOT NULL CHECK(retry_policy_digest~'^sha256:[0-9a-f]{64}$'),
 backoff_seconds INTEGER,
 jitter_seconds INTEGER,
 next_attempt_at TIMESTAMPTZ(6),
 state TEXT NOT NULL CHECK(state IN(
  'retry_scheduled_no_effect','reconciliation_required_no_resend','permanent_stop_terminal',
  'permanent_stop_attempt_ceiling','permanent_stop_effect_confirmed','permanent_stop_unknown_or_unsafe')),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 decision_digest TEXT NOT NULL CHECK(decision_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,decision_id),
 UNIQUE(organization_id,schedule_id,decision_sequence),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,decision_digest),
 FOREIGN KEY(organization_id,schedule_id)
  REFERENCES public.canonical_automation_action_schedules_v1(organization_id,schedule_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,receipt_id)
  REFERENCES public.canonical_automation_provider_request_receipts_v1(organization_id,receipt_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,decision_lease_id,decision_fence_token)
  REFERENCES public.canonical_automation_delivery_lease_events_v1(organization_id,lease_id,fence_token) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,attempt_lease_id,attempt_fence_token)
  REFERENCES public.canonical_automation_delivery_lease_events_v1(organization_id,lease_id,fence_token) ON DELETE RESTRICT,
 CHECK(retention_class='decision_history'),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'decisionId' IS NOT DISTINCT FROM decision_id::text),
 CHECK(document->>'decisionKind' IS NOT DISTINCT FROM decision_kind),
 CHECK(document#>>'{actionBinding,scheduleId}' IS NOT DISTINCT FROM schedule_id::text),
 CHECK(document#>>'{actionBinding,providerRequestIdentity}' IS NOT DISTINCT FROM provider_request_identity),
 CHECK(document#>>'{leaseBinding,leaseId}' IS NOT DISTINCT FROM decision_lease_id::text),
 CHECK(document#>>'{attemptObservation,attemptLeaseId}' IS NOT DISTINCT FROM attempt_lease_id::text),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest),
 CHECK(maximum_retry_after_seconds<=maximum_delay_seconds),
 CHECK((state='retry_scheduled_no_effect' AND backoff_seconds IS NOT NULL AND jitter_seconds IS NOT NULL
         AND next_attempt_at IS NOT NULL AND backoff_seconds BETWEEN 1 AND maximum_delay_seconds
         AND jitter_seconds BETWEEN 0 AND maximum_jitter_seconds)
    OR (state<>'retry_scheduled_no_effect' AND backoff_seconds IS NULL AND jitter_seconds IS NULL AND next_attempt_at IS NULL)),
 CHECK((reconciliation_state='not_performed' AND reconciliation_evidence_id IS NULL
         AND reconciliation_evidence_digest IS NULL AND reconciliation_observed_at IS NULL)
    OR (reconciliation_state<>'not_performed' AND reconciliation_evidence_id IS NOT NULL
         AND reconciliation_evidence_digest IS NOT NULL AND reconciliation_observed_at IS NOT NULL))
);

CREATE INDEX canonical_automation_delivery_retry_events_v1_schedule_order
 ON public.canonical_automation_delivery_retry_events_v1(organization_id,schedule_id,decision_sequence);
CREATE UNIQUE INDEX canonical_automation_delivery_retry_events_v1_observation_id
 ON public.canonical_automation_delivery_retry_events_v1(organization_id,observation_id)
 WHERE decision_kind='classify_attempt';
CREATE UNIQUE INDEX canonical_automation_delivery_retry_events_v1_observation_digest
 ON public.canonical_automation_delivery_retry_events_v1(organization_id,observation_digest)
 WHERE decision_kind='classify_attempt';
CREATE UNIQUE INDEX canonical_automation_delivery_retry_events_v1_reconciliation_id
 ON public.canonical_automation_delivery_retry_events_v1(organization_id,reconciliation_evidence_id)
 WHERE reconciliation_evidence_id IS NOT NULL;
CREATE UNIQUE INDEX canonical_automation_delivery_retry_events_v1_reconciliation_digest
 ON public.canonical_automation_delivery_retry_events_v1(organization_id,reconciliation_evidence_digest)
 WHERE reconciliation_evidence_digest IS NOT NULL;
CREATE INDEX canonical_automation_delivery_retry_heads_v1_due
 ON public.canonical_automation_delivery_retry_heads_v1(organization_id,next_attempt_at,schedule_id)
 WHERE state='retry_scheduled_no_effect';

CREATE TRIGGER canonical_automation_delivery_retry_events_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_delivery_retry_events_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_delivery_retry_heads_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_retry_heads_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_retry_events_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_retry_events_v1 FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_automation_delivery_retry_heads_v1_tenant_owner_only
 ON public.canonical_automation_delivery_retry_heads_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_retry_heads_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_retry_heads_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_delivery_retry_events_v1_tenant_owner_only
 ON public.canonical_automation_delivery_retry_events_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_retry_events_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_retry_events_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_record_retry_decision_v1(
 canonical_text_value TEXT, trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 doc JSONB; org UUID; decision_value UUID; schedule_value UUID; transaction_value UUID; run_value UUID;
 unit_value UUID; outbox_value UUID; receipt_value UUID; decision_lease_value UUID; attempt_lease_value UUID;
 decision_fence BIGINT; attempt_fence BIGINT; attempt_value INTEGER; attempt_ceiling_value INTEGER;
 base_delay INTEGER; maximum_delay INTEGER; maximum_retry_after INTEGER; maximum_jitter INTEGER;
 retry_after INTEGER; timeout_seconds INTEGER; decision_sequence_value INTEGER; backoff_value INTEGER;
 jitter_window INTEGER; jitter_value INTEGER; total_delay INTEGER; recorded_value TIMESTAMPTZ(6);
 observation_time TIMESTAMPTZ(6); reconciliation_time TIMESTAMPTZ(6); next_attempt_value TIMESTAMPTZ(6);
 request_digest_value TEXT; policy_digest_value TEXT; observation_digest_value TEXT; decision_digest_value TEXT; classification_value TEXT; state_value TEXT;
 trusted_expected JSONB; latest_policy_state TEXT; snapshot_item RECORD; latest_snapshot_id UUID;
 source_index INTEGER; snapshot_count INTEGER;
 schedule_row public.canonical_automation_action_schedules_v1%ROWTYPE;
 transaction_row public.canonical_automation_action_transactions_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 outbox_row public.canonical_automation_action_outbox_v1%ROWTYPE;
 receipt_row public.canonical_automation_provider_request_receipts_v1%ROWTYPE;
 lease_head public.canonical_automation_delivery_lease_heads_v1%ROWTYPE;
 attempt_lease public.canonical_automation_delivery_lease_events_v1%ROWTYPE;
 retry_head public.canonical_automation_delivery_retry_heads_v1%ROWTYPE;
 stored public.canonical_automation_delivery_retry_events_v1%ROWTYPE;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN
  RAISE EXCEPTION 'Mission 28 retry decision bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','decisionId','decisionKind','actionBinding','leaseBinding','retryPolicy','attemptObservation','reconciliation','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.delivery-retry-decision.v1' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actionBinding',ARRAY['scheduleId','transactionId','runId','unitId','outboxId','receiptId','unitDigest','providerRequestIdentity','providerRequestDigest','idempotencyReceiptDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'leaseBinding',ARRAY['leaseId','fenceToken']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'retryPolicy',ARRAY['attemptCeiling','baseDelaySeconds','maximumDelaySeconds','maximumRetryAfterSeconds','maximumJitterSeconds','retryPolicyDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'attemptObservation',ARRAY['observationId','observationKind','observationDigest','attemptOrdinal','attemptLeaseId','attemptFenceToken','occurredAt','retryAfterSeconds','providerTimeoutSeconds']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'reconciliation',ARRAY['state','evidenceId','evidenceDigest','observedAt']) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 retry decision shape invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc->>'decisionKind','') NOT IN('classify_attempt','record_reconciliation') OR
    COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'decisionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'actionBinding') WHERE jsonb_typeof(value) IS DISTINCT FROM 'string') OR
    COALESCE(doc#>>'{actionBinding,scheduleId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actionBinding,transactionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actionBinding,runId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actionBinding,unitId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actionBinding,outboxId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actionBinding,receiptId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actionBinding,unitDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{actionBinding,providerRequestIdentity}','')!~'^m28:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actionBinding,providerRequestDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{actionBinding,idempotencyReceiptDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{leaseBinding,leaseId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{leaseBinding,fenceToken}') IS DISTINCT FROM 'number' OR COALESCE(doc#>>'{leaseBinding,fenceToken}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{retryPolicy,retryPolicyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    EXISTS(SELECT 1 FROM jsonb_each((doc->'retryPolicy')-'retryPolicyDigest'::text)
      WHERE jsonb_typeof(value) IS DISTINCT FROM 'number' OR value#>>'{}'!~'^(0|[1-9][0-9]*)$') OR
    COALESCE(doc#>>'{attemptObservation,observationId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{attemptObservation,observationKind}','') NOT IN('provider_retryable_definite_no_acceptance','provider_rate_limited_definite_no_acceptance','provider_terminal_rejection','provider_timeout_uncertain','provider_acknowledgement_uncertain','unknown_or_unsafe_outcome') OR
    COALESCE(doc#>>'{attemptObservation,observationDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    jsonb_typeof(doc#>'{attemptObservation,attemptOrdinal}') IS DISTINCT FROM 'number' OR COALESCE(doc#>>'{attemptObservation,attemptOrdinal}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{attemptObservation,attemptLeaseId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{attemptObservation,attemptFenceToken}') IS DISTINCT FROM 'number' OR COALESCE(doc#>>'{attemptObservation,attemptFenceToken}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{attemptObservation,occurredAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc#>>'{reconciliation,state}','') NOT IN('not_performed','no_effect_confirmed','effect_confirmed','unknown_or_unsafe') OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 retry identity invalid' USING ERRCODE='22023'; END IF;

 attempt_ceiling_value:=(doc#>>'{retryPolicy,attemptCeiling}')::integer;
 base_delay:=(doc#>>'{retryPolicy,baseDelaySeconds}')::integer;
 maximum_delay:=(doc#>>'{retryPolicy,maximumDelaySeconds}')::integer;
 maximum_retry_after:=(doc#>>'{retryPolicy,maximumRetryAfterSeconds}')::integer;
 maximum_jitter:=(doc#>>'{retryPolicy,maximumJitterSeconds}')::integer;
 attempt_value:=(doc#>>'{attemptObservation,attemptOrdinal}')::integer;
 decision_fence:=(doc#>>'{leaseBinding,fenceToken}')::bigint;
 attempt_fence:=(doc#>>'{attemptObservation,attemptFenceToken}')::bigint;
 IF attempt_ceiling_value NOT BETWEEN 1 AND 8 OR attempt_value NOT BETWEEN 1 AND 8 OR
    base_delay NOT BETWEEN 1 AND 900 OR maximum_delay NOT BETWEEN base_delay AND 3600 OR
    maximum_retry_after NOT BETWEEN 1 AND maximum_delay OR maximum_jitter NOT BETWEEN 0 AND 60 OR
    decision_fence>9007199254740991 OR attempt_fence>9007199254740991 THEN
  RAISE EXCEPTION 'Mission 28 retry policy bound invalid' USING ERRCODE='22023'; END IF;

 IF doc#>'{attemptObservation,retryAfterSeconds}' IS DISTINCT FROM 'null'::jsonb THEN
  IF jsonb_typeof(doc#>'{attemptObservation,retryAfterSeconds}') IS DISTINCT FROM 'number' OR
     COALESCE(doc#>>'{attemptObservation,retryAfterSeconds}','')!~'^[1-9][0-9]*$' THEN
   RAISE EXCEPTION 'Mission 28 Retry-After invalid' USING ERRCODE='22023'; END IF;
  retry_after:=(doc#>>'{attemptObservation,retryAfterSeconds}')::integer;
 END IF;
 IF doc#>'{attemptObservation,providerTimeoutSeconds}' IS DISTINCT FROM 'null'::jsonb THEN
  IF jsonb_typeof(doc#>'{attemptObservation,providerTimeoutSeconds}') IS DISTINCT FROM 'number' OR
     COALESCE(doc#>>'{attemptObservation,providerTimeoutSeconds}','')!~'^[1-9][0-9]*$' THEN
   RAISE EXCEPTION 'Mission 28 provider timeout invalid' USING ERRCODE='22023'; END IF;
  timeout_seconds:=(doc#>>'{attemptObservation,providerTimeoutSeconds}')::integer;
 END IF;
 IF (retry_after IS NOT NULL AND (doc#>>'{attemptObservation,observationKind}' NOT IN('provider_retryable_definite_no_acceptance','provider_rate_limited_definite_no_acceptance') OR retry_after>maximum_retry_after)) OR
    (doc#>>'{attemptObservation,observationKind}'='provider_rate_limited_definite_no_acceptance' AND retry_after IS NULL) OR
    (doc#>>'{attemptObservation,observationKind}'='provider_timeout_uncertain' AND (timeout_seconds IS NULL OR timeout_seconds NOT BETWEEN 1 AND 120)) OR
    (doc#>>'{attemptObservation,observationKind}'<>'provider_timeout_uncertain' AND timeout_seconds IS NOT NULL) THEN
  RAISE EXCEPTION 'Mission 28 retry observation bound invalid' USING ERRCODE='22023'; END IF;
 IF (doc#>>'{reconciliation,state}'='not_performed' AND
      (doc#>'{reconciliation,evidenceId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{reconciliation,evidenceDigest}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{reconciliation,observedAt}' IS DISTINCT FROM 'null'::jsonb)) OR
    (doc#>>'{reconciliation,state}'<>'not_performed' AND
      (COALESCE(doc#>>'{reconciliation,evidenceId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
       COALESCE(doc#>>'{reconciliation,evidenceDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
       COALESCE(doc#>>'{reconciliation,observedAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$')) THEN
  RAISE EXCEPTION 'Mission 28 reconciliation evidence invalid' USING ERRCODE='22023'; END IF;
 IF (doc->>'decisionKind'='classify_attempt' AND doc#>>'{reconciliation,state}'<>'not_performed') OR
    (doc->>'decisionKind'='record_reconciliation' AND doc#>>'{reconciliation,state}'='not_performed') THEN
  RAISE EXCEPTION 'Mission 28 decision/reconciliation composition invalid' USING ERRCODE='22023'; END IF;

 observation_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-attempt-observation.v1'||chr(10),(doc->'attemptObservation')-'observationDigest'::text);
 policy_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-retry-policy.v1'||chr(10),(doc->'retryPolicy')-'retryPolicyDigest'::text);
 request_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-retry-decision.v1'||chr(10),doc-'requestDigest'::text);
 IF observation_digest_value IS DISTINCT FROM doc#>>'{attemptObservation,observationDigest}' OR
    policy_digest_value IS DISTINCT FROM doc#>>'{retryPolicy,retryPolicyDigest}' OR request_digest_value IS DISTINCT FROM doc->>'requestDigest' THEN
  RAISE EXCEPTION 'Mission 28 retry digest invalid' USING ERRCODE='22023'; END IF;
 trusted_expected:=doc-'schemaVersion'::text-'decisionId'::text-'requestDigest'::text;
 IF public.canonical_automation_part4b_keys_exact_v1(trusted_resolution,ARRAY['tenantId','decisionKind','actionBinding','leaseBinding','retryPolicy','attemptObservation','reconciliation']) IS DISTINCT FROM TRUE OR
    trusted_resolution IS DISTINCT FROM trusted_expected THEN
  RAISE EXCEPTION 'Mission 28 separately trusted retry resolution mismatch' USING ERRCODE='42501'; END IF;

 org:=(doc->>'tenantId')::uuid; decision_value:=(doc->>'decisionId')::uuid;
 schedule_value:=(doc#>>'{actionBinding,scheduleId}')::uuid; transaction_value:=(doc#>>'{actionBinding,transactionId}')::uuid;
 run_value:=(doc#>>'{actionBinding,runId}')::uuid; unit_value:=(doc#>>'{actionBinding,unitId}')::uuid;
 outbox_value:=(doc#>>'{actionBinding,outboxId}')::uuid; receipt_value:=(doc#>>'{actionBinding,receiptId}')::uuid;
 decision_lease_value:=(doc#>>'{leaseBinding,leaseId}')::uuid; attempt_lease_value:=(doc#>>'{attemptObservation,attemptLeaseId}')::uuid;
 observation_time:=(doc#>>'{attemptObservation,occurredAt}')::timestamptz;
 IF doc#>>'{reconciliation,state}'<>'not_performed' THEN reconciliation_time:=(doc#>>'{reconciliation,observedAt}')::timestamptz; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-retry-decision:'||decision_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_delivery_retry_events_v1
  WHERE organization_id=org AND decision_id=decision_value;
 IF stored.decision_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 conflicting retry decision identity' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('state',stored.state,'replayed',TRUE,'decisionId',stored.decision_id,
   'decisionSequence',stored.decision_sequence,'attemptOrdinal',stored.attempt_ordinal,
   'providerRequestIdentity',stored.provider_request_identity,'backoffSeconds',stored.backoff_seconds,
   'jitterSeconds',stored.jitter_seconds,'nextAttemptAt',CASE WHEN stored.next_attempt_at IS NULL THEN NULL ELSE public.canonical_automation_utc_v1(stored.next_attempt_at) END,
   'decisionDigest',stored.decision_digest);
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-delivery-retry:'||schedule_value::text,0));
 SELECT * INTO schedule_row FROM public.canonical_automation_action_schedules_v1
  WHERE organization_id=org AND schedule_id=schedule_value AND transaction_id=transaction_value AND run_id=run_value
   AND unit_id=unit_value AND outbox_id=outbox_value AND unit_digest=doc#>>'{actionBinding,unitDigest}' AND state='scheduled_unpublished';
 SELECT * INTO transaction_row FROM public.canonical_automation_action_transactions_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value;
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value AND unit_id=unit_value
   AND unit_digest=doc#>>'{actionBinding,unitDigest}' AND state='committed_unpublished';
 SELECT * INTO outbox_row FROM public.canonical_automation_action_outbox_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND unit_id=unit_value AND outbox_id=outbox_value
   AND unit_digest=doc#>>'{actionBinding,unitDigest}' AND state='committed_unpublished'
   AND queue_publication_id IS NULL AND queue_published_at IS NULL AND claim_id IS NULL AND lease_expires_at IS NULL;
 SELECT * INTO receipt_row FROM public.canonical_automation_provider_request_receipts_v1
  WHERE organization_id=org AND receipt_id=receipt_value AND schedule_id=schedule_value AND transaction_id=transaction_value
   AND run_id=run_value AND unit_id=unit_value AND outbox_id=outbox_value
   AND provider_request_identity=doc#>>'{actionBinding,providerRequestIdentity}'
   AND provider_request_digest=doc#>>'{actionBinding,providerRequestDigest}'
   AND idempotency_receipt_digest=doc#>>'{actionBinding,idempotencyReceiptDigest}'
   AND state='identity_reserved_no_provider_attempt_or_ack';
 SELECT * INTO lease_head FROM public.canonical_automation_delivery_lease_heads_v1
  WHERE organization_id=org AND schedule_id=schedule_value FOR UPDATE;
 SELECT * INTO attempt_lease FROM public.canonical_automation_delivery_lease_events_v1
  WHERE organization_id=org AND schedule_id=schedule_value AND lease_id=attempt_lease_value AND fence_token=attempt_fence;
 recorded_value:=public.canonical_automation_clock_v1();
 IF schedule_row.schedule_id IS NULL OR transaction_row.transaction_id IS NULL OR unit_row.unit_id IS NULL OR
    outbox_row.outbox_id IS NULL OR receipt_row.receipt_id IS NULL OR lease_head.schedule_id IS NULL OR
    lease_head.lease_id IS DISTINCT FROM decision_lease_value OR lease_head.current_fence_token IS DISTINCT FROM decision_fence OR
    lease_head.lease_expires_at<=recorded_value OR schedule_row.expires_at<=recorded_value OR attempt_lease.lease_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 exact current retry authority unavailable' USING ERRCODE='42501'; END IF;
 IF observation_time<attempt_lease.lease_acquired_at OR observation_time>attempt_lease.lease_expires_at OR observation_time>recorded_value OR
    (reconciliation_time IS NOT NULL AND (reconciliation_time<observation_time OR reconciliation_time>recorded_value)) THEN
  RAISE EXCEPTION 'Mission 28 retry evidence time invalid' USING ERRCODE='22023'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||schedule_row.policy_id::text,0));
 SELECT to_state INTO latest_policy_state FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND policy_id=schedule_row.policy_id AND policy_version=schedule_row.policy_version
  ORDER BY lifecycle_sequence DESC LIMIT 1;
 IF latest_policy_state IS DISTINCT FROM 'active' OR NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
    WHERE organization_id=org AND policy_id=schedule_row.policy_id AND version=schedule_row.policy_version
     AND canonical_digest=schedule_row.policy_digest AND expires_at>recorded_value) THEN
  RAISE EXCEPTION 'Mission 28 current retry policy unavailable' USING ERRCODE='42501'; END IF;
 snapshot_count:=jsonb_array_length(transaction_row.document#>'{sourceBinding,snapshotIds}');
 FOR source_index IN 0..snapshot_count-1 LOOP
  SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND snapshot_id=(transaction_row.document#>>ARRAY['sourceBinding','snapshotIds',source_index::text])::uuid
    AND snapshot_digest=transaction_row.document#>>ARRAY['sourceBinding','snapshotDigests',source_index::text];
  IF snapshot_item.snapshot_id IS NULL OR snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
   RAISE EXCEPTION 'Mission 28 current retry source unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-lineage:'||snapshot_item.trigger_id||':'||
   snapshot_item.record_identity_digest||':'||snapshot_item.event_kind,0));
  SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id
    AND record_identity_digest=snapshot_item.record_identity_digest AND event_kind=snapshot_item.event_kind
   ORDER BY lineage_sequence DESC LIMIT 1;
  IF latest_snapshot_id IS DISTINCT FROM snapshot_item.snapshot_id THEN
   RAISE EXCEPTION 'Mission 28 source snapshot is not latest retry head' USING ERRCODE='42501'; END IF;
 END LOOP;

 SELECT * INTO retry_head FROM public.canonical_automation_delivery_retry_heads_v1
  WHERE organization_id=org AND schedule_id=schedule_value FOR UPDATE;
 IF retry_head.schedule_id IS NOT NULL AND (retry_head.transaction_id IS DISTINCT FROM transaction_value OR
    retry_head.run_id IS DISTINCT FROM run_value OR retry_head.unit_id IS DISTINCT FROM unit_value OR
    retry_head.outbox_id IS DISTINCT FROM outbox_value OR retry_head.receipt_id IS DISTINCT FROM receipt_value OR
    retry_head.provider_request_identity IS DISTINCT FROM receipt_row.provider_request_identity OR
    retry_head.provider_request_digest IS DISTINCT FROM receipt_row.provider_request_digest OR
    retry_head.idempotency_receipt_digest IS DISTINCT FROM receipt_row.idempotency_receipt_digest OR
    retry_head.retry_policy_digest IS DISTINCT FROM policy_digest_value OR retry_head.attempt_ceiling IS DISTINCT FROM attempt_ceiling_value) THEN
  RAISE EXCEPTION 'Mission 28 retry action or policy retarget rejected' USING ERRCODE='42501'; END IF;

 IF doc->>'decisionKind'='classify_attempt' THEN
  IF attempt_lease_value IS DISTINCT FROM decision_lease_value OR attempt_fence IS DISTINCT FROM decision_fence THEN
   RAISE EXCEPTION 'Mission 28 new observation must use current lease' USING ERRCODE='42501'; END IF;
  IF retry_head.schedule_id IS NULL THEN
   IF attempt_value IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Mission 28 initial attempt ordinal invalid' USING ERRCODE='22023'; END IF;
   decision_sequence_value:=1;
  ELSE
   IF retry_head.state IS DISTINCT FROM 'retry_scheduled_no_effect' OR retry_head.next_attempt_at>recorded_value OR
      attempt_value IS DISTINCT FROM retry_head.last_attempt_ordinal+1 THEN
    RAISE EXCEPTION 'Mission 28 retry sequence or due time unavailable' USING ERRCODE='42501'; END IF;
   decision_sequence_value:=retry_head.last_decision_sequence+1;
  END IF;
  IF doc#>>'{attemptObservation,observationKind}' IN('provider_retryable_definite_no_acceptance','provider_rate_limited_definite_no_acceptance') THEN
   classification_value:='retryable';
   IF attempt_value>=attempt_ceiling_value THEN state_value:='permanent_stop_attempt_ceiling';
   ELSE state_value:='retry_scheduled_no_effect'; END IF;
  ELSIF doc#>>'{attemptObservation,observationKind}'='provider_terminal_rejection' THEN
   classification_value:='terminal'; state_value:='permanent_stop_terminal';
  ELSIF doc#>>'{attemptObservation,observationKind}' IN('provider_timeout_uncertain','provider_acknowledgement_uncertain') THEN
   classification_value:='uncertain'; state_value:='reconciliation_required_no_resend';
  ELSE classification_value:='unsafe'; state_value:='permanent_stop_unknown_or_unsafe'; END IF;
 ELSE
  IF retry_head.schedule_id IS NULL OR retry_head.state IS DISTINCT FROM 'reconciliation_required_no_resend' OR
     attempt_value IS DISTINCT FROM retry_head.last_attempt_ordinal OR
     (doc#>>'{attemptObservation,observationId}')::uuid IS DISTINCT FROM retry_head.pending_observation_id OR
     doc#>>'{attemptObservation,observationDigest}' IS DISTINCT FROM retry_head.pending_observation_digest OR
     doc#>>'{attemptObservation,observationKind}' IS DISTINCT FROM retry_head.pending_observation_kind OR
     attempt_lease_value IS DISTINCT FROM retry_head.pending_attempt_lease_id OR attempt_fence IS DISTINCT FROM retry_head.pending_attempt_fence_token THEN
   RAISE EXCEPTION 'Mission 28 exact pending reconciliation unavailable' USING ERRCODE='42501'; END IF;
  decision_sequence_value:=retry_head.last_decision_sequence+1;
  IF doc#>>'{reconciliation,state}'='no_effect_confirmed' THEN
   classification_value:='reconciled_no_effect';
   IF attempt_value>=attempt_ceiling_value THEN state_value:='permanent_stop_attempt_ceiling';
   ELSE state_value:='retry_scheduled_no_effect'; END IF;
  ELSIF doc#>>'{reconciliation,state}'='effect_confirmed' THEN
   classification_value:='reconciled_effect'; state_value:='permanent_stop_effect_confirmed';
  ELSE classification_value:='reconciled_unknown_or_unsafe'; state_value:='permanent_stop_unknown_or_unsafe'; END IF;
 END IF;
 IF decision_sequence_value>64 THEN RAISE EXCEPTION 'Mission 28 retry decision ceiling reached' USING ERRCODE='54000'; END IF;

 IF state_value='retry_scheduled_no_effect' THEN
  backoff_value:=LEAST(maximum_delay,base_delay*(1<<(attempt_value-1)));
  backoff_value:=GREATEST(backoff_value,COALESCE(retry_after,0));
  jitter_window:=LEAST(maximum_jitter,maximum_delay-backoff_value);
  IF jitter_window>0 THEN
   jitter_value:=mod((('x'||substr(receipt_row.provider_request_digest,8,8))::bit(32)::bigint)+attempt_value,jitter_window+1);
  ELSE jitter_value:=0; END IF;
  total_delay:=backoff_value+jitter_value;
  next_attempt_value:=recorded_value+make_interval(secs=>total_delay);
 END IF;
 decision_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-retry-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org::text,'decisionId',decision_value::text,'decisionSequence',decision_sequence_value,
  'requestDigest',request_digest_value,'classification',classification_value,'state',state_value,
  'backoffSeconds',backoff_value,'jitterSeconds',jitter_value,
  'nextAttemptAt',CASE WHEN next_attempt_value IS NULL THEN NULL ELSE public.canonical_automation_utc_v1(next_attempt_value) END));

 INSERT INTO public.canonical_automation_delivery_retry_events_v1 VALUES(
  org,decision_value,decision_sequence_value,doc->>'decisionKind',schedule_value,transaction_value,run_value,unit_value,outbox_value,
  receipt_value,receipt_row.provider_request_identity,receipt_row.provider_request_digest,receipt_row.idempotency_receipt_digest,
  decision_lease_value,decision_fence,attempt_value,attempt_lease_value,attempt_fence,
  (doc#>>'{attemptObservation,observationId}')::uuid,doc#>>'{attemptObservation,observationKind}',
  doc#>>'{attemptObservation,observationDigest}',observation_time,retry_after,timeout_seconds,doc#>>'{reconciliation,state}',
  CASE WHEN doc#>'{reconciliation,evidenceId}'='null'::jsonb THEN NULL ELSE (doc#>>'{reconciliation,evidenceId}')::uuid END,
  NULLIF(doc#>>'{reconciliation,evidenceDigest}',''),reconciliation_time,classification_value,attempt_ceiling_value,base_delay,
  maximum_delay,maximum_retry_after,maximum_jitter,policy_digest_value,backoff_value,jitter_value,next_attempt_value,state_value,
  request_digest_value,decision_digest_value,canonical_text_value,doc,recorded_value,'decision_history',
  'postgresql_statement_timestamp_v1','UTC');

 INSERT INTO public.canonical_automation_delivery_retry_heads_v1 VALUES(
  org,schedule_value,transaction_value,run_value,unit_value,outbox_value,receipt_value,receipt_row.provider_request_identity,
  receipt_row.provider_request_digest,receipt_row.idempotency_receipt_digest,policy_digest_value,attempt_ceiling_value,
  decision_sequence_value,attempt_value,state_value,
  CASE WHEN state_value='reconciliation_required_no_resend' THEN (doc#>>'{attemptObservation,observationId}')::uuid ELSE NULL END,
  CASE WHEN state_value='reconciliation_required_no_resend' THEN doc#>>'{attemptObservation,observationDigest}' ELSE NULL END,
  CASE WHEN state_value='reconciliation_required_no_resend' THEN doc#>>'{attemptObservation,observationKind}' ELSE NULL END,
  CASE WHEN state_value='reconciliation_required_no_resend' THEN attempt_lease_value ELSE NULL END,
  CASE WHEN state_value='reconciliation_required_no_resend' THEN attempt_fence ELSE NULL END,
  next_attempt_value,decision_value,decision_digest_value,recorded_value,'postgresql_statement_timestamp_v1','UTC')
 ON CONFLICT(organization_id,schedule_id) DO UPDATE SET
  last_decision_sequence=EXCLUDED.last_decision_sequence,last_attempt_ordinal=EXCLUDED.last_attempt_ordinal,
  state=EXCLUDED.state,pending_observation_id=EXCLUDED.pending_observation_id,
  pending_observation_digest=EXCLUDED.pending_observation_digest,pending_observation_kind=EXCLUDED.pending_observation_kind,
  pending_attempt_lease_id=EXCLUDED.pending_attempt_lease_id,pending_attempt_fence_token=EXCLUDED.pending_attempt_fence_token,
  next_attempt_at=EXCLUDED.next_attempt_at,last_decision_id=EXCLUDED.last_decision_id,
  last_decision_digest=EXCLUDED.last_decision_digest,updated_at=EXCLUDED.updated_at;

 RETURN jsonb_build_object('state',state_value,'replayed',FALSE,'decisionId',decision_value,
  'decisionSequence',decision_sequence_value,'attemptOrdinal',attempt_value,
  'providerRequestIdentity',receipt_row.provider_request_identity,'backoffSeconds',backoff_value,
  'jitterSeconds',jitter_value,'nextAttemptAt',CASE WHEN next_attempt_value IS NULL THEN NULL ELSE public.canonical_automation_utc_v1(next_attempt_value) END,
  'decisionDigest',decision_digest_value);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_delivery_retry_heads_v1,
 public.canonical_automation_delivery_retry_events_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_retry_decision_v1(TEXT,JSONB) FROM PUBLIC;
