-- Mission 28 Part 6C: owner-only delivery coordination evidence.  This
-- migration establishes tenant leases, monotonic fencing, deterministic
-- transaction ordering and one stable provider-request identity reservation.
-- It grants no worker, queue, provider, recipient, message or effect path.

CREATE TABLE public.canonical_automation_delivery_lease_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 schedule_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 current_fence_token BIGINT NOT NULL CHECK(current_fence_token BETWEEN 1 AND 9007199254740991),
 lease_id UUID NOT NULL,
 worker_identity_digest TEXT NOT NULL CHECK(worker_identity_digest~'^sha256:[0-9a-f]{64}$'),
 lease_acquired_at TIMESTAMPTZ(6) NOT NULL,
 lease_expires_at TIMESTAMPTZ(6) NOT NULL,
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,schedule_id),
 UNIQUE(organization_id,lease_id),
 FOREIGN KEY(organization_id,schedule_id)
  REFERENCES public.canonical_automation_action_schedules_v1(organization_id,schedule_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 CHECK(lease_expires_at>lease_acquired_at)
);

CREATE TABLE public.canonical_automation_delivery_lease_events_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 lease_request_id UUID NOT NULL,
 schedule_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 unit_index INTEGER NOT NULL CHECK(unit_index BETWEEN 0 AND 31),
 unit_count INTEGER NOT NULL CHECK(unit_count BETWEEN 1 AND 32),
 lease_id UUID NOT NULL,
 fence_token BIGINT NOT NULL CHECK(fence_token BETWEEN 1 AND 9007199254740991),
 worker_id UUID NOT NULL,
 process_id UUID NOT NULL,
 deployment_id UUID NOT NULL,
 region_id TEXT NOT NULL CHECK(region_id~'^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$'),
 worker_identity_digest TEXT NOT NULL CHECK(worker_identity_digest~'^sha256:[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 lease_acquired_at TIMESTAMPTZ(6) NOT NULL,
 lease_expires_at TIMESTAMPTZ(6) NOT NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,lease_request_id),
 UNIQUE(organization_id,lease_id),
 UNIQUE(organization_id,lease_id,fence_token),
 UNIQUE(organization_id,schedule_id,fence_token),
 UNIQUE(organization_id,request_digest),
 FOREIGN KEY(organization_id,schedule_id)
  REFERENCES public.canonical_automation_action_schedules_v1(organization_id,schedule_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 CHECK(retention_class='decision_history'),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'leaseRequestId' IS NOT DISTINCT FROM lease_request_id::text),
 CHECK(document#>>'{scheduleBinding,scheduleId}' IS NOT DISTINCT FROM schedule_id::text),
 CHECK(document#>>'{scheduleBinding,transactionId}' IS NOT DISTINCT FROM transaction_id::text),
 CHECK(document#>>'{scheduleBinding,runId}' IS NOT DISTINCT FROM run_id::text),
 CHECK(document#>>'{scheduleBinding,unitId}' IS NOT DISTINCT FROM unit_id::text),
 CHECK(document#>>'{scheduleBinding,outboxId}' IS NOT DISTINCT FROM outbox_id::text),
 CHECK(document#>>'{leaseBinding,leaseId}' IS NOT DISTINCT FROM lease_id::text),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest),
 CHECK(lease_expires_at>lease_acquired_at)
);

CREATE TABLE public.canonical_automation_provider_request_receipts_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 receipt_id UUID NOT NULL,
 schedule_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 lease_id UUID NOT NULL,
 fence_token BIGINT NOT NULL CHECK(fence_token BETWEEN 1 AND 9007199254740991),
 provider_request_identity TEXT NOT NULL CHECK(provider_request_identity~'^m28:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 provider_request_digest TEXT NOT NULL CHECK(provider_request_digest~'^sha256:[0-9a-f]{64}$'),
 idempotency_receipt_digest TEXT NOT NULL CHECK(idempotency_receipt_digest~'^sha256:[0-9a-f]{64}$'),
 state TEXT NOT NULL CHECK(state='identity_reserved_no_provider_attempt_or_ack'),
 reserved_at TIMESTAMPTZ(6) NOT NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,receipt_id),
 UNIQUE(organization_id,schedule_id),
 UNIQUE(organization_id,unit_id),
 UNIQUE(organization_id,provider_request_identity),
 UNIQUE(organization_id,provider_request_digest),
 UNIQUE(organization_id,idempotency_receipt_digest),
 FOREIGN KEY(organization_id,schedule_id)
  REFERENCES public.canonical_automation_action_schedules_v1(organization_id,schedule_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,lease_id,fence_token)
  REFERENCES public.canonical_automation_delivery_lease_events_v1(organization_id,lease_id,fence_token) ON DELETE RESTRICT,
 CHECK(receipt_id=schedule_id),
 CHECK(retention_class='decision_history')
);

CREATE INDEX canonical_automation_delivery_lease_events_v1_transaction_order
 ON public.canonical_automation_delivery_lease_events_v1(organization_id,transaction_id,unit_index,fence_token);
CREATE INDEX canonical_automation_delivery_lease_heads_v1_expiry
 ON public.canonical_automation_delivery_lease_heads_v1(organization_id,lease_expires_at,schedule_id);

CREATE TRIGGER canonical_automation_delivery_lease_events_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_delivery_lease_events_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_provider_request_receipts_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_provider_request_receipts_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_delivery_lease_heads_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_lease_heads_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_lease_events_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_lease_events_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_provider_request_receipts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_provider_request_receipts_v1 FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_automation_delivery_lease_heads_v1_tenant_owner_only
 ON public.canonical_automation_delivery_lease_heads_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_lease_heads_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_lease_heads_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_delivery_lease_events_v1_tenant_owner_only
 ON public.canonical_automation_delivery_lease_events_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_lease_events_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_lease_events_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_provider_request_receipts_v1_tenant_owner_only
 ON public.canonical_automation_provider_request_receipts_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_provider_request_receipts_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_provider_request_receipts_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_claim_scheduled_action_v1(
 canonical_text_value TEXT, trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 doc JSONB; org UUID; lease_request_value UUID; schedule_value UUID; transaction_value UUID; run_value UUID;
 unit_value UUID; outbox_value UUID; lease_value UUID; worker_value UUID; process_value UUID; deployment_value UUID;
 expected_fence BIGINT; next_fence BIGINT; duration_seconds INTEGER; recorded_value TIMESTAMPTZ(6); expires_value TIMESTAMPTZ(6);
 request_digest_value TEXT; worker_digest_value TEXT; unit_index_value INTEGER; unit_count_value INTEGER;
 schedule_row public.canonical_automation_action_schedules_v1%ROWTYPE;
 transaction_row public.canonical_automation_action_transactions_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 outbox_row public.canonical_automation_action_outbox_v1%ROWTYPE;
 stored public.canonical_automation_delivery_lease_events_v1%ROWTYPE;
 head public.canonical_automation_delivery_lease_heads_v1%ROWTYPE;
 trusted_expected JSONB; snapshot_item RECORD; latest_snapshot_id UUID; source_index INTEGER; snapshot_count INTEGER;
 latest_policy_state TEXT;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN
  RAISE EXCEPTION 'Mission 28 lease request bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','leaseRequestId','scheduleBinding','workerBinding','leaseBinding','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.delivery-lease.request.v1' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'scheduleBinding',ARRAY['scheduleId','transactionId','runId','unitId','outboxId','unitDigest','scheduleBindingDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'workerBinding',ARRAY['workerId','processId','deploymentId','regionId','workerIdentityDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'leaseBinding',ARRAY['leaseId','expectedPriorFenceToken','durationSeconds']) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 lease request shape invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'leaseRequestId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'scheduleBinding') WHERE jsonb_typeof(value) IS DISTINCT FROM 'string') OR
    EXISTS(SELECT 1 FROM jsonb_each(doc->'workerBinding') WHERE jsonb_typeof(value) IS DISTINCT FROM 'string') OR
    COALESCE(doc#>>'{scheduleBinding,scheduleId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{scheduleBinding,transactionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{scheduleBinding,runId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{scheduleBinding,unitId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{scheduleBinding,outboxId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{scheduleBinding,unitDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{scheduleBinding,scheduleBindingDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{workerBinding,workerId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{workerBinding,processId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{workerBinding,deploymentId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{workerBinding,regionId}','')!~'^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$' OR
    COALESCE(doc#>>'{workerBinding,workerIdentityDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{leaseBinding,leaseId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{leaseBinding,expectedPriorFenceToken}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{leaseBinding,expectedPriorFenceToken}','')!~'^(0|[1-9][0-9]*)$' OR
    jsonb_typeof(doc#>'{leaseBinding,durationSeconds}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{leaseBinding,durationSeconds}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 lease identity invalid' USING ERRCODE='22023'; END IF;
 duration_seconds:=(doc#>>'{leaseBinding,durationSeconds}')::integer;
 expected_fence:=(doc#>>'{leaseBinding,expectedPriorFenceToken}')::bigint;
 IF duration_seconds NOT BETWEEN 5 AND 300 OR expected_fence>9007199254740990 THEN
  RAISE EXCEPTION 'Mission 28 lease bound invalid' USING ERRCODE='22023'; END IF;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-lease.request.v1'||chr(10),doc-'requestDigest'::text);
 worker_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-worker.v1'||chr(10),(doc->'workerBinding')-'workerIdentityDigest'::text);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR worker_digest_value IS DISTINCT FROM doc#>>'{workerBinding,workerIdentityDigest}' THEN
  RAISE EXCEPTION 'Mission 28 lease digest invalid' USING ERRCODE='22023'; END IF;
 org:=(doc->>'tenantId')::uuid; lease_request_value:=(doc->>'leaseRequestId')::uuid;
 schedule_value:=(doc#>>'{scheduleBinding,scheduleId}')::uuid; transaction_value:=(doc#>>'{scheduleBinding,transactionId}')::uuid;
 run_value:=(doc#>>'{scheduleBinding,runId}')::uuid; unit_value:=(doc#>>'{scheduleBinding,unitId}')::uuid;
 outbox_value:=(doc#>>'{scheduleBinding,outboxId}')::uuid; lease_value:=(doc#>>'{leaseBinding,leaseId}')::uuid;
 worker_value:=(doc#>>'{workerBinding,workerId}')::uuid; process_value:=(doc#>>'{workerBinding,processId}')::uuid;
 deployment_value:=(doc#>>'{workerBinding,deploymentId}')::uuid;
 trusted_expected:=jsonb_build_object('tenantId',doc->>'tenantId','scheduleBinding',doc->'scheduleBinding','workerBinding',doc->'workerBinding');
 IF public.canonical_automation_part4b_keys_exact_v1(trusted_resolution,ARRAY['tenantId','scheduleBinding','workerBinding']) IS DISTINCT FROM TRUE OR
    trusted_resolution IS DISTINCT FROM trusted_expected THEN
  RAISE EXCEPTION 'Mission 28 separately trusted lease resolution mismatch' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-delivery-lease-request:'||lease_request_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_delivery_lease_events_v1
  WHERE organization_id=org AND lease_request_id=lease_request_value;
 IF stored.lease_request_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 conflicting lease request identity' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('state','lease_acquired_no_effect','replayed',TRUE,'scheduleId',stored.schedule_id,
   'leaseId',stored.lease_id,'fenceToken',stored.fence_token,'leaseExpiresAt',public.canonical_automation_utc_v1(stored.lease_expires_at),
   'requestDigest',stored.request_digest);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-delivery-transaction:'||transaction_value::text,0));
 SELECT * INTO schedule_row FROM public.canonical_automation_action_schedules_v1
  WHERE organization_id=org AND schedule_id=schedule_value AND transaction_id=transaction_value AND run_id=run_value
   AND unit_id=unit_value AND outbox_id=outbox_value AND unit_digest=doc#>>'{scheduleBinding,unitDigest}'
   AND schedule_binding_digest=doc#>>'{scheduleBinding,scheduleBindingDigest}' AND state='scheduled_unpublished';
 SELECT * INTO transaction_row FROM public.canonical_automation_action_transactions_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value;
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value AND unit_id=unit_value
   AND unit_digest=doc#>>'{scheduleBinding,unitDigest}' AND state='committed_unpublished';
 SELECT * INTO outbox_row FROM public.canonical_automation_action_outbox_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND unit_id=unit_value AND outbox_id=outbox_value
   AND unit_digest=doc#>>'{scheduleBinding,unitDigest}' AND state='committed_unpublished'
   AND queue_publication_id IS NULL AND queue_published_at IS NULL AND claim_id IS NULL AND lease_expires_at IS NULL;
 IF schedule_row.schedule_id IS NULL OR transaction_row.transaction_id IS NULL OR unit_row.unit_id IS NULL OR outbox_row.outbox_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 exact scheduled action unavailable' USING ERRCODE='42501'; END IF;
 unit_index_value:=unit_row.unit_index; unit_count_value:=transaction_row.unit_count;
 IF (SELECT count(*) FROM public.canonical_automation_action_schedules_v1 s
      JOIN public.canonical_automation_action_units_v1 u ON u.organization_id=s.organization_id AND u.unit_id=s.unit_id
      WHERE s.organization_id=org AND s.transaction_id=transaction_value AND u.transaction_id=transaction_value)
      IS DISTINCT FROM unit_count_value::bigint OR
    EXISTS(SELECT 1 FROM public.canonical_automation_action_units_v1 u
      WHERE u.organization_id=org AND u.transaction_id=transaction_value AND u.unit_index<unit_index_value
       AND NOT EXISTS(SELECT 1 FROM public.canonical_automation_delivery_lease_events_v1 e
        WHERE e.organization_id=org AND e.transaction_id=transaction_value AND e.unit_id=u.unit_id)) THEN
  RAISE EXCEPTION 'Mission 28 deterministic fan-out order unavailable' USING ERRCODE='42501'; END IF;
 recorded_value:=public.canonical_automation_clock_v1();
 IF schedule_row.utc_instant>recorded_value OR schedule_row.expires_at<=recorded_value THEN
  RAISE EXCEPTION 'Mission 28 schedule is not currently claimable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||schedule_row.policy_id::text,0));
 SELECT to_state INTO latest_policy_state FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND policy_id=schedule_row.policy_id AND policy_version=schedule_row.policy_version
  ORDER BY lifecycle_sequence DESC LIMIT 1;
 IF latest_policy_state IS DISTINCT FROM 'active' OR NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
    WHERE organization_id=org AND policy_id=schedule_row.policy_id AND version=schedule_row.policy_version
     AND canonical_digest=schedule_row.policy_digest AND expires_at>recorded_value) THEN
  RAISE EXCEPTION 'Mission 28 current policy unavailable for claim' USING ERRCODE='42501'; END IF;
 snapshot_count:=jsonb_array_length(transaction_row.document#>'{sourceBinding,snapshotIds}');
 FOR source_index IN 0..snapshot_count-1 LOOP
  SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND snapshot_id=(transaction_row.document#>>ARRAY['sourceBinding','snapshotIds',source_index::text])::uuid
    AND snapshot_digest=transaction_row.document#>>ARRAY['sourceBinding','snapshotDigests',source_index::text];
  IF snapshot_item.snapshot_id IS NULL OR snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
   RAISE EXCEPTION 'Mission 28 current source unavailable for claim' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-lineage:'||snapshot_item.trigger_id||':'||
   snapshot_item.record_identity_digest||':'||snapshot_item.event_kind,0));
  SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id
    AND record_identity_digest=snapshot_item.record_identity_digest AND event_kind=snapshot_item.event_kind
   ORDER BY lineage_sequence DESC LIMIT 1;
  IF latest_snapshot_id IS DISTINCT FROM snapshot_item.snapshot_id THEN
   RAISE EXCEPTION 'Mission 28 source snapshot is not latest claim head' USING ERRCODE='42501'; END IF;
 END LOOP;
 SELECT * INTO head FROM public.canonical_automation_delivery_lease_heads_v1
  WHERE organization_id=org AND schedule_id=schedule_value FOR UPDATE;
 IF head.schedule_id IS NULL THEN
  IF expected_fence IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Mission 28 initial fence mismatch' USING ERRCODE='40001'; END IF;
  next_fence:=1;
 ELSE
  IF expected_fence IS DISTINCT FROM head.current_fence_token OR head.lease_expires_at>recorded_value THEN
   RAISE EXCEPTION 'Mission 28 active or stale fence rejected' USING ERRCODE='40001'; END IF;
  next_fence:=head.current_fence_token+1;
 END IF;
 expires_value:=recorded_value+make_interval(secs=>duration_seconds);
 INSERT INTO public.canonical_automation_delivery_lease_events_v1 VALUES(
  org,lease_request_value,schedule_value,transaction_value,run_value,unit_value,outbox_value,unit_index_value,unit_count_value,
  lease_value,next_fence,worker_value,process_value,deployment_value,doc#>>'{workerBinding,regionId}',worker_digest_value,
  request_digest_value,canonical_text_value,doc,recorded_value,expires_value,'decision_history',
  'postgresql_statement_timestamp_v1','UTC');
 INSERT INTO public.canonical_automation_delivery_lease_heads_v1 VALUES(
  org,schedule_value,transaction_value,run_value,unit_value,outbox_value,next_fence,lease_value,worker_digest_value,
  recorded_value,expires_value,'postgresql_statement_timestamp_v1','UTC')
 ON CONFLICT(organization_id,schedule_id) DO UPDATE SET
  current_fence_token=EXCLUDED.current_fence_token,lease_id=EXCLUDED.lease_id,
  worker_identity_digest=EXCLUDED.worker_identity_digest,lease_acquired_at=EXCLUDED.lease_acquired_at,
  lease_expires_at=EXCLUDED.lease_expires_at;
 RETURN jsonb_build_object('state','lease_acquired_no_effect','replayed',FALSE,'scheduleId',schedule_value,
  'leaseId',lease_value,'fenceToken',next_fence,'leaseExpiresAt',public.canonical_automation_utc_v1(expires_value),
  'requestDigest',request_digest_value);
END $$;

CREATE FUNCTION public.canonical_automation_reserve_provider_request_identity_v1(
 tenant_value UUID, schedule_value UUID, lease_value UUID, fence_value BIGINT)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 schedule_row public.canonical_automation_action_schedules_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 head public.canonical_automation_delivery_lease_heads_v1%ROWTYPE;
 receipt public.canonical_automation_provider_request_receipts_v1%ROWTYPE;
 provider_identity TEXT; provider_digest TEXT; receipt_digest TEXT; recorded_value TIMESTAMPTZ(6);
BEGIN
 IF tenant_value IS NULL OR schedule_value IS NULL OR lease_value IS NULL OR fence_value NOT BETWEEN 1 AND 9007199254740991 THEN
  RAISE EXCEPTION 'Mission 28 provider request reservation shape invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant_value::text||':m28-provider-request:'||schedule_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(tenant_value);
 SELECT * INTO schedule_row FROM public.canonical_automation_action_schedules_v1
  WHERE organization_id=tenant_value AND schedule_id=schedule_value AND state='scheduled_unpublished';
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=tenant_value AND unit_id=schedule_row.unit_id AND transaction_id=schedule_row.transaction_id
   AND run_id=schedule_row.run_id AND unit_digest=schedule_row.unit_digest AND state='committed_unpublished';
 SELECT * INTO head FROM public.canonical_automation_delivery_lease_heads_v1
  WHERE organization_id=tenant_value AND schedule_id=schedule_value FOR UPDATE;
 recorded_value:=public.canonical_automation_clock_v1();
 IF schedule_row.schedule_id IS NULL OR unit_row.unit_id IS NULL OR head.schedule_id IS NULL OR
    head.lease_id IS DISTINCT FROM lease_value OR head.current_fence_token IS DISTINCT FROM fence_value OR
    head.lease_expires_at<=recorded_value OR schedule_row.expires_at<=recorded_value THEN
  RAISE EXCEPTION 'Mission 28 current fenced lease unavailable for provider identity' USING ERRCODE='40001'; END IF;
 SELECT * INTO receipt FROM public.canonical_automation_provider_request_receipts_v1
  WHERE organization_id=tenant_value AND schedule_id=schedule_value;
 IF receipt.receipt_id IS NOT NULL THEN
  RETURN jsonb_build_object('state',receipt.state,'replayed',TRUE,'receiptId',receipt.receipt_id,
   'providerRequestIdentity',receipt.provider_request_identity,'providerRequestDigest',receipt.provider_request_digest,
   'idempotencyReceiptDigest',receipt.idempotency_receipt_digest,'reservedAt',public.canonical_automation_utc_v1(receipt.reserved_at));
 END IF;
 provider_identity:='m28:'||unit_row.unit_id::text;
 provider_digest:=public.canonical_automation_digest_v1('mission28.provider-request-identity.v1'||chr(10),jsonb_build_object(
  'tenantId',tenant_value::text,'scheduleId',schedule_row.schedule_id::text,'transactionId',schedule_row.transaction_id::text,
  'runId',schedule_row.run_id::text,'unitId',unit_row.unit_id::text,'outboxId',schedule_row.outbox_id::text,
  'unitDigest',unit_row.unit_digest,'materialDigest',unit_row.material_digest,
  'idempotencyKeyDigest',unit_row.idempotency_key_digest,'providerMode',unit_row.provider_mode,
  'providerRequestIdentity',provider_identity));
 receipt_digest:=public.canonical_automation_digest_v1('mission28.idempotency-receipt.v1'||chr(10),jsonb_build_object(
  'tenantId',tenant_value::text,'scheduleId',schedule_row.schedule_id::text,'providerRequestIdentity',provider_identity,
  'providerRequestDigest',provider_digest,'idempotencyKeyDigest',unit_row.idempotency_key_digest));
 INSERT INTO public.canonical_automation_provider_request_receipts_v1 VALUES(
  tenant_value,schedule_value,schedule_value,schedule_row.transaction_id,schedule_row.run_id,unit_row.unit_id,
  schedule_row.outbox_id,lease_value,fence_value,provider_identity,provider_digest,receipt_digest,
  'identity_reserved_no_provider_attempt_or_ack',recorded_value,'decision_history','postgresql_statement_timestamp_v1','UTC');
 RETURN jsonb_build_object('state','identity_reserved_no_provider_attempt_or_ack','replayed',FALSE,'receiptId',schedule_value,
  'providerRequestIdentity',provider_identity,'providerRequestDigest',provider_digest,
  'idempotencyReceiptDigest',receipt_digest,'reservedAt',public.canonical_automation_utc_v1(recorded_value));
END $$;

REVOKE ALL ON TABLE public.canonical_automation_delivery_lease_heads_v1,
 public.canonical_automation_delivery_lease_events_v1,
 public.canonical_automation_provider_request_receipts_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_claim_scheduled_action_v1(TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_reserve_provider_request_identity_v1(UUID,UUID,UUID,BIGINT) FROM PUBLIC;
