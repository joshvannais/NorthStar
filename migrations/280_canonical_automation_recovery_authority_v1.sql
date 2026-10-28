-- Mission 28 Part 6F: owner-only restart, outage and restore recovery
-- assessment evidence. This migration never mutates Parts 6A-6E authority,
-- mounts no worker/provider/callback path and grants no resend or effect authority.

CREATE TABLE public.canonical_automation_recovery_assessments_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 recovery_id UUID NOT NULL,
 recovery_kind TEXT NOT NULL CHECK(recovery_kind IN(
  'process_restart','migration_restart','worker_crash','database_outage','provider_outage',
  'partial_callback','deployment_restore','disaster_restore')),
 incident_id UUID NOT NULL,
 incident_digest TEXT NOT NULL CHECK(incident_digest~'^sha256:[0-9a-f]{64}$'),
 evidence_state TEXT NOT NULL CHECK(evidence_state IN(
  'post_restart_database_available','post_migration_database_available','worker_unavailable_database_available',
  'database_recovered_observation_only','provider_unavailable','callback_partial_or_unverified',
  'deployment_database_available','restore_drill_unavailable')),
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 policy_id UUID NOT NULL,
 policy_version BIGINT NOT NULL CHECK(policy_version BETWEEN 1 AND 9007199254740991),
 policy_digest TEXT NOT NULL CHECK(policy_digest~'^sha256:[0-9a-f]{64}$'),
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 unit_count INTEGER NOT NULL CHECK(unit_count BETWEEN 1 AND 32),
 actor_id UUID NOT NULL,
 session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 membership_role TEXT NOT NULL CHECK(membership_role IN('owner','admin')),
 requested_at TIMESTAMPTZ(6) NOT NULL,
 source_issue_count INTEGER NOT NULL CHECK(source_issue_count BETWEEN 0 AND 32),
 unscheduled_count INTEGER NOT NULL CHECK(unscheduled_count BETWEEN 0 AND 32),
 queued_count INTEGER NOT NULL CHECK(queued_count BETWEEN 0 AND 32),
 active_lease_count INTEGER NOT NULL CHECK(active_lease_count BETWEEN 0 AND 32),
 expired_lease_count INTEGER NOT NULL CHECK(expired_lease_count BETWEEN 0 AND 32),
 retry_scheduled_count INTEGER NOT NULL CHECK(retry_scheduled_count BETWEEN 0 AND 32),
 uncertain_count INTEGER NOT NULL CHECK(uncertain_count BETWEEN 0 AND 32),
 permanent_stop_count INTEGER NOT NULL CHECK(permanent_stop_count BETWEEN 0 AND 32),
 controlled_count INTEGER NOT NULL CHECK(controlled_count BETWEEN 0 AND 32),
 result_state TEXT NOT NULL CHECK(result_state IN(
  'bounded_history_verified_no_effect','wait_for_active_lease_no_effect',
  'reconciliation_required_no_resend','blocked_source_not_latest_exact_current',
  'disaster_restore_evidence_gap_no_authority')),
 material_digest TEXT NOT NULL CHECK(material_digest~'^sha256:[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 assessment_digest TEXT NOT NULL CHECK(assessment_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,recovery_id),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,material_digest),
 UNIQUE(organization_id,assessment_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,policy_id,policy_version)
  REFERENCES public.canonical_automation_policy_versions_v1(organization_id,policy_id,version) ON DELETE RESTRICT,
 CHECK(retention_class='decision_history'),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'recoveryId' IS NOT DISTINCT FROM recovery_id::text),
 CHECK(document->>'recoveryKind' IS NOT DISTINCT FROM recovery_kind),
 CHECK(document#>>'{transactionBinding,transactionId}' IS NOT DISTINCT FROM transaction_id::text),
 CHECK(document#>>'{transactionBinding,runId}' IS NOT DISTINCT FROM run_id::text),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest),
 CHECK(unscheduled_count+queued_count+active_lease_count+expired_lease_count+retry_scheduled_count+
       uncertain_count+permanent_stop_count+controlled_count=unit_count)
);

CREATE TABLE public.canonical_automation_recovery_items_v1 (
 organization_id UUID NOT NULL,
 recovery_id UUID NOT NULL,
 unit_index INTEGER NOT NULL CHECK(unit_index BETWEEN 0 AND 31),
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 unit_digest TEXT NOT NULL CHECK(unit_digest~'^sha256:[0-9a-f]{64}$'),
 schedule_id UUID,
 lease_id UUID,
 fence_token BIGINT CHECK(fence_token IS NULL OR fence_token BETWEEN 1 AND 9007199254740991),
 lease_expires_at TIMESTAMPTZ(6),
 receipt_id UUID,
 provider_request_identity TEXT CHECK(provider_request_identity IS NULL OR provider_request_identity~'^m28:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 provider_request_digest TEXT CHECK(provider_request_digest IS NULL OR provider_request_digest~'^sha256:[0-9a-f]{64}$'),
 retry_decision_id UUID,
 retry_decision_digest TEXT CHECK(retry_decision_digest IS NULL OR retry_decision_digest~'^sha256:[0-9a-f]{64}$'),
 control_id UUID,
 control_decision_digest TEXT CHECK(control_decision_digest IS NULL OR control_decision_digest~'^sha256:[0-9a-f]{64}$'),
 source_state TEXT NOT NULL CHECK(source_state IN('latest_exact_current','stale_or_unavailable')),
 item_state TEXT NOT NULL CHECK(item_state IN(
  'committed_unpublished_unscheduled','queued_unpublished_preserved','active_lease_wait_no_effect',
  'expired_lease_reclaim_requires_new_fence','retry_schedule_preserved_no_effect',
  'provider_identity_reserved_reconciliation_required_no_resend','reconciliation_required_no_resend',
  'permanent_stop_preserved','control_preserved_no_new_work')),
 history_digest TEXT NOT NULL CHECK(history_digest~'^sha256:[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,recovery_id,unit_index),
 UNIQUE(organization_id,recovery_id,unit_id),
 FOREIGN KEY(organization_id,recovery_id)
  REFERENCES public.canonical_automation_recovery_assessments_v1(organization_id,recovery_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,schedule_id)
  REFERENCES public.canonical_automation_action_schedules_v1(organization_id,schedule_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,receipt_id)
  REFERENCES public.canonical_automation_provider_request_receipts_v1(organization_id,receipt_id) ON DELETE RESTRICT,
 CHECK(retention_class='decision_history'),
 CHECK((schedule_id IS NULL AND item_state IN('committed_unpublished_unscheduled','control_preserved_no_new_work')
         AND lease_id IS NULL AND fence_token IS NULL AND lease_expires_at IS NULL
         AND receipt_id IS NULL AND provider_request_identity IS NULL AND provider_request_digest IS NULL
         AND retry_decision_id IS NULL AND retry_decision_digest IS NULL
         AND ((item_state='committed_unpublished_unscheduled' AND control_id IS NULL AND control_decision_digest IS NULL)
           OR (item_state='control_preserved_no_new_work' AND control_id IS NOT NULL AND control_decision_digest IS NOT NULL)))
    OR (schedule_id IS NOT NULL AND item_state<>'committed_unpublished_unscheduled')),
 CHECK((lease_id IS NULL AND fence_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_id IS NOT NULL AND fence_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK((receipt_id IS NULL AND provider_request_identity IS NULL AND provider_request_digest IS NULL)
    OR (receipt_id IS NOT NULL AND provider_request_identity IS NOT NULL AND provider_request_digest IS NOT NULL)),
 CHECK((retry_decision_id IS NULL AND retry_decision_digest IS NULL)
    OR (retry_decision_id IS NOT NULL AND retry_decision_digest IS NOT NULL)),
 CHECK((control_id IS NULL AND control_decision_digest IS NULL)
    OR (control_id IS NOT NULL AND control_decision_digest IS NOT NULL))
);

CREATE INDEX canonical_automation_recovery_assessments_v1_run
 ON public.canonical_automation_recovery_assessments_v1(organization_id,run_id,recorded_at,recovery_id);
CREATE INDEX canonical_automation_recovery_items_v1_schedule
 ON public.canonical_automation_recovery_items_v1(organization_id,schedule_id,recovery_id)
 WHERE schedule_id IS NOT NULL;

CREATE TRIGGER canonical_automation_recovery_assessments_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_recovery_assessments_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();
CREATE TRIGGER canonical_automation_recovery_items_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_recovery_items_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_recovery_assessments_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_recovery_assessments_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_recovery_items_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_recovery_items_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_recovery_assessments_v1_owner_only
 ON public.canonical_automation_recovery_assessments_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_recovery_assessments_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_recovery_assessments_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_recovery_items_v1_owner_only
 ON public.canonical_automation_recovery_items_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_recovery_items_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_recovery_items_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_record_recovery_assessment_v1(
 canonical_text_value TEXT, trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 doc JSONB; org UUID; recovery_value UUID; recovery_kind_value TEXT; incident_value UUID;
 transaction_value UUID; run_value UUID; policy_value UUID; policy_version_value BIGINT; unit_count_value INTEGER;
 actor_value UUID; session_value UUID; membership_value UUID; actor_role TEXT; requested_value TIMESTAMPTZ(6);
 recorded_value TIMESTAMPTZ(6); request_digest_value TEXT; material_digest_value TEXT; assessment_digest_value TEXT;
 evidence_state_value TEXT; source_state_value TEXT:='latest_exact_current'; source_issue_value INTEGER:=0;
 unscheduled_value INTEGER:=0; queued_value INTEGER:=0; active_lease_value INTEGER:=0; expired_lease_value INTEGER:=0;
 retry_value INTEGER:=0; uncertain_value INTEGER:=0; stopped_value INTEGER:=0; controlled_value INTEGER:=0;
 result_state_value TEXT; snapshot_count INTEGER; source_index INTEGER; latest_snapshot_id UUID;
 transaction_row public.canonical_automation_action_transactions_v1%ROWTYPE;
 stored public.canonical_automation_recovery_assessments_v1%ROWTYPE;
 unit_row RECORD; schedule_row public.canonical_automation_action_schedules_v1%ROWTYPE;
 lease_head public.canonical_automation_delivery_lease_heads_v1%ROWTYPE;
 lease_event public.canonical_automation_delivery_lease_events_v1%ROWTYPE;
 receipt_row public.canonical_automation_provider_request_receipts_v1%ROWTYPE;
 retry_head public.canonical_automation_delivery_retry_heads_v1%ROWTYPE;
 retry_event public.canonical_automation_delivery_retry_events_v1%ROWTYPE;
 control_head public.canonical_automation_delivery_control_heads_v1%ROWTYPE;
 control_event public.canonical_automation_delivery_control_events_v1%ROWTYPE;
 snapshot_item RECORD; item_state_value TEXT; history_digest_value TEXT; items JSONB:='[]'::jsonb; item JSONB;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN
  RAISE EXCEPTION 'Mission 28 recovery assessment bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','recoveryId','recoveryKind','incidentBinding','transactionBinding','actorBinding','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.delivery-recovery-assessment.v1' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'incidentBinding',ARRAY['incidentId','incidentDigest','evidenceState']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'transactionBinding',ARRAY['transactionId','runId','policyId','policyVersion','policyDigest','sourceSetDigest','unitCount']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole','requestedAt']) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 recovery assessment shape invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'recoveryId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'recoveryKind','') NOT IN('process_restart','migration_restart','worker_crash','database_outage','provider_outage','partial_callback','deployment_restore','disaster_restore') OR
    COALESCE(doc#>>'{incidentBinding,incidentId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{incidentBinding,incidentDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{transactionBinding,transactionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{transactionBinding,runId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{transactionBinding,policyId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{transactionBinding,policyVersion}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{transactionBinding,policyVersion}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{transactionBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{transactionBinding,sourceSetDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    jsonb_typeof(doc#>'{transactionBinding,unitCount}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{transactionBinding,unitCount}','')!~'^(?:[1-9]|[12][0-9]|3[0-2])$' OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipRole}','') NOT IN('owner','admin') OR
    COALESCE(doc#>>'{actorBinding,requestedAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 recovery assessment primitive invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid; recovery_value:=(doc->>'recoveryId')::uuid; recovery_kind_value:=doc->>'recoveryKind';
 incident_value:=(doc#>>'{incidentBinding,incidentId}')::uuid; evidence_state_value:=doc#>>'{incidentBinding,evidenceState}';
 transaction_value:=(doc#>>'{transactionBinding,transactionId}')::uuid; run_value:=(doc#>>'{transactionBinding,runId}')::uuid;
 policy_value:=(doc#>>'{transactionBinding,policyId}')::uuid; policy_version_value:=(doc#>>'{transactionBinding,policyVersion}')::bigint;
 unit_count_value:=(doc#>>'{transactionBinding,unitCount}')::integer; actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;
 session_value:=(doc#>>'{actorBinding,sessionId}')::uuid; membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;
 requested_value:=(doc#>>'{actorBinding,requestedAt}')::timestamptz;
 IF evidence_state_value IS DISTINCT FROM (CASE recovery_kind_value
   WHEN 'process_restart' THEN 'post_restart_database_available'
   WHEN 'migration_restart' THEN 'post_migration_database_available'
   WHEN 'worker_crash' THEN 'worker_unavailable_database_available'
   WHEN 'database_outage' THEN 'database_recovered_observation_only'
   WHEN 'provider_outage' THEN 'provider_unavailable'
   WHEN 'partial_callback' THEN 'callback_partial_or_unverified'
   WHEN 'deployment_restore' THEN 'deployment_database_available'
   WHEN 'disaster_restore' THEN 'restore_drill_unavailable' END) THEN
  RAISE EXCEPTION 'Mission 28 recovery incident evidence mismatch' USING ERRCODE='22023'; END IF;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-recovery-assessment.v1'||chr(10),doc-'requestDigest'::text);
 material_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-recovery-material.v1'||chr(10),doc-'recoveryId'::text-'requestDigest'::text);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR
    trusted_resolution IS DISTINCT FROM doc-'schemaVersion'::text-'recoveryId'::text-'requestDigest'::text THEN
  RAISE EXCEPTION 'Mission 28 recovery digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-recovery-id:'||recovery_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_recovery_assessments_v1
  WHERE organization_id=org AND recovery_id=recovery_value;
 IF stored.recovery_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 recovery identity conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('recoveryId',stored.recovery_id,'resultState',stored.result_state,
   'unitCount',stored.unit_count,'assessmentDigest',stored.assessment_digest,'replayed',TRUE);
 END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF requested_value>recorded_value OR requested_value<recorded_value-INTERVAL '30 seconds' THEN
  RAISE EXCEPTION 'Mission 28 recovery request time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role INTO actor_role
 FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id
  AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.id=session_value AND session.organization_id=org AND session.user_id=actor_value
  AND session.membership_id=membership_value AND session.status='active' AND session.revoked_at IS NULL
  AND session.access_expires_at>recorded_value AND membership.status='active' AND membership.revoked_at IS NULL
  AND account.status='active';
 IF actor_role IS NULL OR actor_role IS DISTINCT FROM doc#>>'{actorBinding,membershipRole}' OR
    (recovery_kind_value='disaster_restore' AND actor_role<>'owner') THEN
  RAISE EXCEPTION 'Mission 28 recovery actor unavailable' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy_value::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:tenant',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:policy:'||policy_value::text||':'||policy_version_value::text,0));
 SELECT * INTO transaction_row FROM public.canonical_automation_action_transactions_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value
   AND policy_id=policy_value AND policy_version=policy_version_value
   AND policy_digest=doc#>>'{transactionBinding,policyDigest}'
   AND source_set_digest=doc#>>'{transactionBinding,sourceSetDigest}' AND unit_count=unit_count_value;
 IF transaction_row.transaction_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 exact recovery transaction unavailable' USING ERRCODE='42501'; END IF;

 -- Part 6B-E serialize every schedule/lease/retry/control mutation behind the
 -- lifecycle lock and then the exact action-control lock.  Acquire the same
 -- complete ordered action-lock set before source-lineage locks so recovery
 -- cannot observe a run assembled across concurrent authority changes.
 FOR schedule_row IN SELECT s.*
  FROM public.canonical_automation_action_schedules_v1 s
  JOIN public.canonical_automation_action_units_v1 u
   ON u.organization_id=s.organization_id AND u.unit_id=s.unit_id
  WHERE s.organization_id=org AND s.transaction_id=transaction_value AND s.run_id=run_value
  ORDER BY s.schedule_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:action:'||schedule_row.schedule_id::text,0));
 END LOOP;

 snapshot_count:=jsonb_array_length(transaction_row.document#>'{sourceBinding,snapshotIds}');
 FOR source_index IN 0..snapshot_count-1 LOOP
  SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org
    AND snapshot_id=(transaction_row.document#>>ARRAY['sourceBinding','snapshotIds',source_index::text])::uuid
    AND snapshot_digest=transaction_row.document#>>ARRAY['sourceBinding','snapshotDigests',source_index::text];
  IF snapshot_item.snapshot_id IS NULL THEN
   RAISE EXCEPTION 'Mission 28 recovery source history unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-lineage:'||snapshot_item.trigger_id||':'||
   snapshot_item.record_identity_digest||':'||snapshot_item.event_kind,0));
  SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id
    AND record_identity_digest=snapshot_item.record_identity_digest AND event_kind=snapshot_item.event_kind
   ORDER BY lineage_sequence DESC LIMIT 1;
  IF latest_snapshot_id IS DISTINCT FROM snapshot_item.snapshot_id OR
     snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
   source_state_value:='stale_or_unavailable'; source_issue_value:=source_issue_value+1;
  END IF;
 END LOOP;

 FOR unit_row IN SELECT u.*,o.outbox_id FROM public.canonical_automation_action_units_v1 u
  JOIN public.canonical_automation_action_outbox_v1 o ON o.organization_id=u.organization_id AND o.unit_id=u.unit_id
  WHERE u.organization_id=org AND u.transaction_id=transaction_value ORDER BY u.unit_index LOOP
  schedule_row:=NULL; lease_head:=NULL; lease_event:=NULL; receipt_row:=NULL;
  retry_head:=NULL; retry_event:=NULL; control_head:=NULL; control_event:=NULL;
  SELECT * INTO schedule_row FROM public.canonical_automation_action_schedules_v1
   WHERE organization_id=org AND unit_id=unit_row.unit_id AND transaction_id=transaction_value AND run_id=run_value
    AND outbox_id=unit_row.outbox_id AND unit_digest=unit_row.unit_digest AND policy_id=policy_value
    AND policy_version=policy_version_value AND policy_digest=doc#>>'{transactionBinding,policyDigest}'
    AND source_set_digest=doc#>>'{transactionBinding,sourceSetDigest}';
  IF schedule_row.schedule_id IS NULL THEN
   SELECT * INTO control_head FROM public.canonical_automation_delivery_control_heads_v1
    WHERE organization_id=org AND control_state<>'active_resumed' AND
     ((target_kind='policy_version' AND policy_id=policy_value AND policy_version=policy_version_value) OR
      target_kind='tenant')
    ORDER BY CASE target_kind WHEN 'policy_version' THEN 1 ELSE 2 END LIMIT 1;
   IF control_head.last_control_id IS NOT NULL THEN
    SELECT * INTO control_event FROM public.canonical_automation_delivery_control_events_v1
     WHERE organization_id=org AND control_id=control_head.last_control_id
      AND decision_digest=control_head.last_decision_digest AND target_kind=control_head.target_kind
      AND target_key=control_head.target_key AND control_sequence=control_head.control_sequence
      AND policy_id IS NOT DISTINCT FROM control_head.policy_id
      AND policy_version IS NOT DISTINCT FROM control_head.policy_version
      AND policy_digest IS NOT DISTINCT FROM control_head.policy_digest
      AND schedule_id IS NOT DISTINCT FROM control_head.schedule_id
      AND transaction_id IS NOT DISTINCT FROM control_head.transaction_id
      AND run_id IS NOT DISTINCT FROM control_head.run_id
      AND unit_id IS NOT DISTINCT FROM control_head.unit_id
      AND outbox_id IS NOT DISTINCT FROM control_head.outbox_id
      AND receipt_id IS NOT DISTINCT FROM control_head.receipt_id
      AND unit_digest IS NOT DISTINCT FROM control_head.unit_digest
      AND provider_request_identity IS NOT DISTINCT FROM control_head.provider_request_identity
      AND provider_request_digest IS NOT DISTINCT FROM control_head.provider_request_digest
      AND resulting_control_state=control_head.control_state AND execution_phase=control_head.execution_phase
      AND queued_count=control_head.queued_count AND leased_count=control_head.leased_count
      AND uncertain_count=control_head.uncertain_count AND permanent_stop_count=control_head.permanent_stop_count
      AND in_flight_unavailable_count=control_head.in_flight_unavailable_count
      AND completed_unavailable_count=control_head.completed_unavailable_count
      AND recorded_at=control_head.updated_at AND trusted_clock_contract=control_head.trusted_clock_contract
      AND recorded_time_zone=control_head.recorded_time_zone;
    IF control_event.control_id IS NULL THEN RAISE EXCEPTION 'Mission 28 orphan control authority detected' USING ERRCODE='42501'; END IF;
    item_state_value:='control_preserved_no_new_work'; controlled_value:=controlled_value+1;
   ELSE
    item_state_value:='committed_unpublished_unscheduled'; unscheduled_value:=unscheduled_value+1;
   END IF;
  ELSE
   SELECT * INTO lease_head FROM public.canonical_automation_delivery_lease_heads_v1
    WHERE organization_id=org AND schedule_id=schedule_row.schedule_id;
   IF lease_head.lease_id IS NOT NULL THEN
    SELECT * INTO lease_event FROM public.canonical_automation_delivery_lease_events_v1
     WHERE organization_id=org AND schedule_id=schedule_row.schedule_id AND lease_id=lease_head.lease_id
      AND fence_token=lease_head.current_fence_token AND transaction_id=lease_head.transaction_id AND run_id=lease_head.run_id
      AND unit_id=unit_row.unit_id AND outbox_id=unit_row.outbox_id
      AND unit_id=lease_head.unit_id AND outbox_id=lease_head.outbox_id
      AND worker_identity_digest=lease_head.worker_identity_digest
      AND transaction_id=transaction_value AND run_id=run_value
      AND lease_acquired_at=lease_head.lease_acquired_at AND lease_expires_at=lease_head.lease_expires_at
      AND trusted_clock_contract=lease_head.trusted_clock_contract AND recorded_time_zone=lease_head.recorded_time_zone;
    IF lease_event.lease_id IS NULL THEN RAISE EXCEPTION 'Mission 28 orphan lease authority detected' USING ERRCODE='42501'; END IF;
   END IF;
   SELECT * INTO receipt_row FROM public.canonical_automation_provider_request_receipts_v1
    WHERE organization_id=org AND schedule_id=schedule_row.schedule_id AND transaction_id=transaction_value
     AND run_id=run_value AND unit_id=unit_row.unit_id AND outbox_id=unit_row.outbox_id;
   IF receipt_row.receipt_id IS NOT NULL AND (lease_event.lease_id IS NULL OR receipt_row.lease_id IS DISTINCT FROM lease_event.lease_id
      OR receipt_row.fence_token IS DISTINCT FROM lease_event.fence_token) THEN
    RAISE EXCEPTION 'Mission 28 orphan provider identity authority detected' USING ERRCODE='42501'; END IF;
   SELECT * INTO retry_head FROM public.canonical_automation_delivery_retry_heads_v1
    WHERE organization_id=org AND schedule_id=schedule_row.schedule_id;
   IF retry_head.schedule_id IS NOT NULL THEN
    SELECT * INTO retry_event FROM public.canonical_automation_delivery_retry_events_v1
     WHERE organization_id=org AND decision_id=retry_head.last_decision_id
      AND decision_digest=retry_head.last_decision_digest AND schedule_id=retry_head.schedule_id
      AND retry_head.schedule_id=schedule_row.schedule_id
      AND transaction_id=transaction_value AND run_id=run_value AND unit_id=unit_row.unit_id
      AND outbox_id=unit_row.outbox_id AND receipt_id=receipt_row.receipt_id
      AND transaction_id=retry_head.transaction_id AND run_id=retry_head.run_id
      AND unit_id=retry_head.unit_id AND outbox_id=retry_head.outbox_id AND receipt_id=retry_head.receipt_id
      AND provider_request_identity=retry_head.provider_request_identity
      AND provider_request_digest=retry_head.provider_request_digest
      AND idempotency_receipt_digest=retry_head.idempotency_receipt_digest
      AND retry_policy_digest=retry_head.retry_policy_digest AND attempt_ceiling=retry_head.attempt_ceiling
      AND decision_sequence=retry_head.last_decision_sequence AND attempt_ordinal=retry_head.last_attempt_ordinal
      AND state=retry_head.state AND next_attempt_at IS NOT DISTINCT FROM retry_head.next_attempt_at
      AND observation_id IS NOT DISTINCT FROM CASE WHEN retry_head.state='reconciliation_required_no_resend' THEN retry_head.pending_observation_id ELSE observation_id END
      AND (retry_head.state<>'reconciliation_required_no_resend' OR
       (observation_digest=retry_head.pending_observation_digest AND observation_kind=retry_head.pending_observation_kind
        AND attempt_lease_id=retry_head.pending_attempt_lease_id AND attempt_fence_token=retry_head.pending_attempt_fence_token))
      AND recorded_at=retry_head.updated_at AND trusted_clock_contract=retry_head.trusted_clock_contract
      AND recorded_time_zone=retry_head.recorded_time_zone;
    IF retry_event.decision_id IS NULL THEN RAISE EXCEPTION 'Mission 28 orphan retry authority detected' USING ERRCODE='42501'; END IF;
   END IF;
   SELECT * INTO control_head FROM public.canonical_automation_delivery_control_heads_v1
    WHERE organization_id=org AND control_state<>'active_resumed' AND
     ((target_kind='action_schedule' AND schedule_id=schedule_row.schedule_id) OR
      (target_kind='policy_version' AND policy_id=policy_value AND policy_version=policy_version_value) OR
      target_kind='tenant')
    ORDER BY CASE target_kind WHEN 'action_schedule' THEN 1 WHEN 'policy_version' THEN 2 ELSE 3 END LIMIT 1;
   IF control_head.last_control_id IS NOT NULL THEN
    SELECT * INTO control_event FROM public.canonical_automation_delivery_control_events_v1
     WHERE organization_id=org AND control_id=control_head.last_control_id
      AND decision_digest=control_head.last_decision_digest AND target_kind=control_head.target_kind
      AND target_key=control_head.target_key AND control_sequence=control_head.control_sequence
      AND policy_id IS NOT DISTINCT FROM control_head.policy_id
      AND policy_version IS NOT DISTINCT FROM control_head.policy_version
      AND policy_digest IS NOT DISTINCT FROM control_head.policy_digest
      AND schedule_id IS NOT DISTINCT FROM control_head.schedule_id
      AND transaction_id IS NOT DISTINCT FROM control_head.transaction_id
      AND run_id IS NOT DISTINCT FROM control_head.run_id
      AND unit_id IS NOT DISTINCT FROM control_head.unit_id
      AND outbox_id IS NOT DISTINCT FROM control_head.outbox_id
      AND receipt_id IS NOT DISTINCT FROM control_head.receipt_id
      AND unit_digest IS NOT DISTINCT FROM control_head.unit_digest
      AND provider_request_identity IS NOT DISTINCT FROM control_head.provider_request_identity
      AND provider_request_digest IS NOT DISTINCT FROM control_head.provider_request_digest
      AND resulting_control_state=control_head.control_state AND execution_phase=control_head.execution_phase
      AND queued_count=control_head.queued_count AND leased_count=control_head.leased_count
      AND uncertain_count=control_head.uncertain_count AND permanent_stop_count=control_head.permanent_stop_count
      AND in_flight_unavailable_count=control_head.in_flight_unavailable_count
      AND completed_unavailable_count=control_head.completed_unavailable_count
      AND recorded_at=control_head.updated_at AND trusted_clock_contract=control_head.trusted_clock_contract
      AND recorded_time_zone=control_head.recorded_time_zone;
    IF control_event.control_id IS NULL THEN RAISE EXCEPTION 'Mission 28 orphan control authority detected' USING ERRCODE='42501'; END IF;
   END IF;
   IF control_head.last_control_id IS NOT NULL THEN item_state_value:='control_preserved_no_new_work'; controlled_value:=controlled_value+1;
   ELSIF retry_head.state='reconciliation_required_no_resend' THEN item_state_value:='reconciliation_required_no_resend'; uncertain_value:=uncertain_value+1;
   ELSIF retry_head.state LIKE 'permanent_stop_%' THEN item_state_value:='permanent_stop_preserved'; stopped_value:=stopped_value+1;
   ELSIF retry_head.state='retry_scheduled_no_effect' THEN item_state_value:='retry_schedule_preserved_no_effect'; retry_value:=retry_value+1;
   ELSIF receipt_row.receipt_id IS NOT NULL THEN item_state_value:='provider_identity_reserved_reconciliation_required_no_resend'; uncertain_value:=uncertain_value+1;
   ELSIF lease_head.lease_id IS NOT NULL AND lease_head.lease_expires_at>recorded_value THEN item_state_value:='active_lease_wait_no_effect'; active_lease_value:=active_lease_value+1;
   ELSIF lease_head.lease_id IS NOT NULL THEN item_state_value:='expired_lease_reclaim_requires_new_fence'; expired_lease_value:=expired_lease_value+1;
   ELSE item_state_value:='queued_unpublished_preserved'; queued_value:=queued_value+1; END IF;
  END IF;
  history_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-recovery-item.v1'||chr(10),jsonb_build_object(
   'unitIndex',unit_row.unit_index,'unitId',unit_row.unit_id::text,'outboxId',unit_row.outbox_id::text,
   'unitDigest',unit_row.unit_digest,'scheduleId',schedule_row.schedule_id::text,'leaseId',lease_head.lease_id::text,
   'fenceToken',lease_head.current_fence_token,'receiptId',receipt_row.receipt_id::text,
   'retryDecisionId',retry_head.last_decision_id::text,'controlId',control_head.last_control_id::text,
   'sourceState',source_state_value,'itemState',item_state_value));
  item:=jsonb_build_object('unitIndex',unit_row.unit_index,'unitId',unit_row.unit_id::text,'outboxId',unit_row.outbox_id::text,
   'unitDigest',unit_row.unit_digest,'scheduleId',schedule_row.schedule_id::text,'leaseId',lease_head.lease_id::text,
   'fenceToken',lease_head.current_fence_token,'leaseExpiresAt',public.canonical_automation_utc_v1(lease_head.lease_expires_at),
   'receiptId',receipt_row.receipt_id::text,'providerRequestIdentity',receipt_row.provider_request_identity,
   'providerRequestDigest',receipt_row.provider_request_digest,'retryDecisionId',retry_head.last_decision_id::text,
   'retryDecisionDigest',retry_head.last_decision_digest,'controlId',control_head.last_control_id::text,
   'controlDecisionDigest',control_head.last_decision_digest,'sourceState',source_state_value,
   'itemState',item_state_value,'historyDigest',history_digest_value);
  items:=items||jsonb_build_array(item);
 END LOOP;
 IF jsonb_array_length(items) IS DISTINCT FROM unit_count_value THEN
  RAISE EXCEPTION 'Mission 28 complete run history unavailable' USING ERRCODE='42501'; END IF;

 IF recovery_kind_value='disaster_restore' THEN result_state_value:='disaster_restore_evidence_gap_no_authority';
 ELSIF source_issue_value>0 THEN result_state_value:='blocked_source_not_latest_exact_current';
 ELSIF recovery_kind_value IN('provider_outage','partial_callback') OR uncertain_value>0 THEN
  result_state_value:='reconciliation_required_no_resend';
 ELSIF active_lease_value>0 THEN result_state_value:='wait_for_active_lease_no_effect';
 ELSE result_state_value:='bounded_history_verified_no_effect'; END IF;
 assessment_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-recovery-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org::text,'recoveryId',recovery_value::text,'recoveryKind',recovery_kind_value,'incidentId',incident_value::text,
  'transactionId',transaction_value::text,'runId',run_value::text,'sourceState',source_state_value,'resultState',result_state_value,
  'materialDigest',material_digest_value,'items',items));

 INSERT INTO public.canonical_automation_recovery_assessments_v1 VALUES(
  org,recovery_value,recovery_kind_value,incident_value,doc#>>'{incidentBinding,incidentDigest}',evidence_state_value,
  transaction_value,run_value,policy_value,policy_version_value,doc#>>'{transactionBinding,policyDigest}',
  doc#>>'{transactionBinding,sourceSetDigest}',unit_count_value,actor_value,session_value,membership_value,
  doc#>>'{actorBinding,membershipRole}',requested_value,source_issue_value,unscheduled_value,queued_value,active_lease_value,
  expired_lease_value,retry_value,uncertain_value,stopped_value,controlled_value,result_state_value,material_digest_value,
  request_digest_value,assessment_digest_value,canonical_text_value,doc,recorded_value,'decision_history',
  'postgresql_statement_timestamp_v1','UTC');
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  INSERT INTO public.canonical_automation_recovery_items_v1 VALUES(
   org,recovery_value,(item->>'unitIndex')::integer,(item->>'unitId')::uuid,(item->>'outboxId')::uuid,item->>'unitDigest',
   NULLIF(item->>'scheduleId','')::uuid,NULLIF(item->>'leaseId','')::uuid,NULLIF(item->>'fenceToken','')::bigint,
   NULLIF(item->>'leaseExpiresAt','')::timestamptz,NULLIF(item->>'receiptId','')::uuid,
   NULLIF(item->>'providerRequestIdentity',''),NULLIF(item->>'providerRequestDigest',''),
   NULLIF(item->>'retryDecisionId','')::uuid,NULLIF(item->>'retryDecisionDigest',''),
   NULLIF(item->>'controlId','')::uuid,NULLIF(item->>'controlDecisionDigest',''),item->>'sourceState',item->>'itemState',
   item->>'historyDigest',recorded_value,'decision_history','postgresql_statement_timestamp_v1','UTC');
 END LOOP;
 RETURN jsonb_build_object('recoveryId',recovery_value,'resultState',result_state_value,'unitCount',unit_count_value,
  'assessmentDigest',assessment_digest_value,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_recovery_assessments_v1,
 public.canonical_automation_recovery_items_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_record_recovery_assessment_v1(TEXT,JSONB) FROM PUBLIC;
