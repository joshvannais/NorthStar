-- Mission 28 Part 6E: owner-only delivery control evidence and database guards.
-- No worker, queue, provider, recipient, message, callback or effect authority is
-- granted. Existing Part 6A-6D rows remain immutable and are never rewritten.

CREATE TABLE public.canonical_automation_delivery_control_heads_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 target_kind TEXT NOT NULL CHECK(target_kind IN('tenant','policy_version','action_schedule')),
 target_key TEXT NOT NULL CHECK(octet_length(target_key) BETWEEN 36 AND 80),
 policy_id UUID,
 policy_version INTEGER CHECK(policy_version IS NULL OR policy_version BETWEEN 1 AND 2147483647),
 policy_digest TEXT CHECK(policy_digest IS NULL OR policy_digest~'^sha256:[0-9a-f]{64}$'),
 schedule_id UUID,
 transaction_id UUID,
 run_id UUID,
 unit_id UUID,
 outbox_id UUID,
 receipt_id UUID,
 unit_digest TEXT CHECK(unit_digest IS NULL OR unit_digest~'^sha256:[0-9a-f]{64}$'),
 provider_request_identity TEXT CHECK(provider_request_identity IS NULL OR provider_request_identity~'^m28:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 provider_request_digest TEXT CHECK(provider_request_digest IS NULL OR provider_request_digest~'^sha256:[0-9a-f]{64}$'),
 control_state TEXT NOT NULL CHECK(control_state IN(
  'paused','revoked_terminal','superseded_terminal','draining','drained','active_resumed',
  'cancelled_terminal','expired_terminal','dead_lettered_terminal',
  'reviewed_retry_new_action_required','bulk_stopped_terminal')),
 execution_phase TEXT NOT NULL CHECK(execution_phase IN(
  'scope','queued','leased','uncertain','permanent_stop_no_effect','permanent_stop_effect_or_unknown')),
 control_sequence INTEGER NOT NULL CHECK(control_sequence BETWEEN 1 AND 64),
 queued_count INTEGER NOT NULL CHECK(queued_count BETWEEN 0 AND 32),
 leased_count INTEGER NOT NULL CHECK(leased_count BETWEEN 0 AND 32),
 uncertain_count INTEGER NOT NULL CHECK(uncertain_count BETWEEN 0 AND 32),
 permanent_stop_count INTEGER NOT NULL CHECK(permanent_stop_count BETWEEN 0 AND 32),
 in_flight_unavailable_count INTEGER NOT NULL CHECK(in_flight_unavailable_count=0),
 completed_unavailable_count INTEGER NOT NULL CHECK(completed_unavailable_count=0),
 last_control_id UUID NOT NULL,
 last_decision_digest TEXT NOT NULL CHECK(last_decision_digest~'^sha256:[0-9a-f]{64}$'),
 updated_at TIMESTAMPTZ(6) NOT NULL,
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,target_kind,target_key),
 UNIQUE(organization_id,last_control_id),
 CHECK(queued_count+leased_count+uncertain_count+permanent_stop_count<=32),
 CHECK((target_kind='tenant' AND target_key=organization_id::text AND policy_id IS NULL AND policy_version IS NULL
         AND policy_digest IS NULL AND schedule_id IS NULL AND transaction_id IS NULL AND run_id IS NULL
         AND unit_id IS NULL AND outbox_id IS NULL AND receipt_id IS NULL AND unit_digest IS NULL
         AND provider_request_identity IS NULL AND provider_request_digest IS NULL AND execution_phase='scope')
    OR (target_kind='policy_version' AND target_key=policy_id::text||':'||policy_version::text
         AND policy_id IS NOT NULL AND policy_version IS NOT NULL AND policy_digest IS NOT NULL
         AND schedule_id IS NULL AND transaction_id IS NULL AND run_id IS NULL AND unit_id IS NULL
         AND outbox_id IS NULL AND receipt_id IS NULL AND unit_digest IS NULL
         AND provider_request_identity IS NULL AND provider_request_digest IS NULL AND execution_phase='scope')
    OR (target_kind='action_schedule' AND target_key=schedule_id::text AND policy_id IS NOT NULL
         AND policy_version IS NOT NULL AND policy_digest IS NOT NULL AND schedule_id IS NOT NULL
         AND transaction_id IS NOT NULL AND run_id IS NOT NULL AND unit_id IS NOT NULL AND outbox_id IS NOT NULL
         AND receipt_id IS NOT NULL AND unit_digest IS NOT NULL AND provider_request_identity IS NOT NULL
         AND provider_request_digest IS NOT NULL AND execution_phase<>'scope'))
);

CREATE TABLE public.canonical_automation_delivery_control_events_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 control_id UUID NOT NULL,
 target_kind TEXT NOT NULL,
 target_key TEXT NOT NULL,
 control_sequence INTEGER NOT NULL CHECK(control_sequence BETWEEN 1 AND 64),
 operation TEXT NOT NULL CHECK(operation IN(
  'pause_scope','revoke_policy','supersede_policy','drain_scope','resume_scope','cancel_action',
  'expire_action','dead_letter_action','owner_reviewed_retry','bulk_stop')),
 policy_id UUID,
 policy_version INTEGER,
 policy_digest TEXT,
 schedule_id UUID,
 transaction_id UUID,
 run_id UUID,
 unit_id UUID,
 outbox_id UUID,
 receipt_id UUID,
 unit_digest TEXT,
 provider_request_identity TEXT,
 provider_request_digest TEXT,
 actor_id UUID NOT NULL,
 session_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 membership_role TEXT NOT NULL CHECK(membership_role IN('owner','admin')),
 requested_at TIMESTAMPTZ(6) NOT NULL,
 successor_policy_id UUID,
 successor_policy_version INTEGER,
 successor_policy_digest TEXT,
 review_id UUID,
 review_digest TEXT,
 review_outcome TEXT,
 reviewed_at TIMESTAMPTZ(6),
 prior_control_state TEXT NOT NULL,
 resulting_control_state TEXT NOT NULL,
 execution_phase TEXT NOT NULL,
 queued_count INTEGER NOT NULL,
 leased_count INTEGER NOT NULL,
 uncertain_count INTEGER NOT NULL,
 permanent_stop_count INTEGER NOT NULL,
 in_flight_unavailable_count INTEGER NOT NULL CHECK(in_flight_unavailable_count=0),
 completed_unavailable_count INTEGER NOT NULL CHECK(completed_unavailable_count=0),
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 decision_digest TEXT NOT NULL CHECK(decision_digest~'^sha256:[0-9a-f]{64}$'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 32768),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 PRIMARY KEY(organization_id,control_id),
 UNIQUE(organization_id,target_kind,target_key,control_sequence),
 UNIQUE(organization_id,request_digest),
 UNIQUE(organization_id,decision_digest),
 FOREIGN KEY(organization_id,target_kind,target_key)
  REFERENCES public.canonical_automation_delivery_control_heads_v1(organization_id,target_kind,target_key)
  DEFERRABLE INITIALLY DEFERRED,
 CHECK(retention_class='decision_history'),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'controlId' IS NOT DISTINCT FROM control_id::text),
 CHECK(document->>'operation' IS NOT DISTINCT FROM operation),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest),
 CHECK((review_id IS NULL AND review_digest IS NULL AND review_outcome IS NULL AND reviewed_at IS NULL)
    OR (review_id IS NOT NULL AND review_digest~'^sha256:[0-9a-f]{64}$'
        AND review_outcome IN('no_effect_terminal','effect_or_unknown_unresolved','new_action_required_no_reuse')
        AND reviewed_at IS NOT NULL)),
 CHECK((successor_policy_id IS NULL AND successor_policy_version IS NULL AND successor_policy_digest IS NULL)
    OR (successor_policy_id IS NOT NULL AND successor_policy_version BETWEEN 1 AND 2147483647
        AND successor_policy_digest~'^sha256:[0-9a-f]{64}$'))
);

CREATE INDEX canonical_automation_delivery_control_events_v1_target_order
 ON public.canonical_automation_delivery_control_events_v1(organization_id,target_kind,target_key,control_sequence);
CREATE INDEX canonical_automation_delivery_control_heads_v1_policy
 ON public.canonical_automation_delivery_control_heads_v1(organization_id,policy_id,policy_version)
 WHERE policy_id IS NOT NULL;

CREATE TRIGGER canonical_automation_delivery_control_events_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_delivery_control_events_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_delivery_control_heads_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_control_heads_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_control_events_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_delivery_control_events_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_delivery_control_heads_v1_owner_only
 ON public.canonical_automation_delivery_control_heads_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_control_heads_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_control_heads_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));
CREATE POLICY canonical_automation_delivery_control_events_v1_owner_only
 ON public.canonical_automation_delivery_control_events_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_control_events_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_delivery_control_events_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_part6e_lock_and_assert_allowed_v1(
 org UUID, policy_value UUID, version_value BIGINT, schedule_value UUID, activity TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE blocked TEXT; policy_key TEXT;
BEGIN
 IF activity NOT IN('new_schedule','new_lease','new_retry_classification','record_reconciliation') THEN
  RAISE EXCEPTION 'Mission 28 delivery control activity invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:tenant',0));
 policy_key:=policy_value::text||':'||version_value::text;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:policy:'||policy_key,0));
 IF schedule_value IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:action:'||schedule_value::text,0));
 END IF;
 IF activity='record_reconciliation' THEN RETURN; END IF;
 SELECT control_state INTO blocked FROM public.canonical_automation_delivery_control_heads_v1
  WHERE organization_id=org AND target_kind='tenant' AND target_key=org::text;
 IF blocked IS NOT NULL AND blocked<>'active_resumed' THEN
  RAISE EXCEPTION 'Mission 28 tenant delivery control blocks new authority' USING ERRCODE='42501'; END IF;
 SELECT control_state INTO blocked FROM public.canonical_automation_delivery_control_heads_v1
  WHERE organization_id=org AND target_kind='policy_version' AND target_key=policy_key;
 IF blocked IS NOT NULL AND blocked<>'active_resumed' THEN
  RAISE EXCEPTION 'Mission 28 policy delivery control blocks new authority' USING ERRCODE='42501'; END IF;
 IF schedule_value IS NOT NULL THEN
  SELECT control_state INTO blocked FROM public.canonical_automation_delivery_control_heads_v1
   WHERE organization_id=org AND target_kind='action_schedule' AND target_key=schedule_value::text;
  IF blocked IS NOT NULL THEN
   RAISE EXCEPTION 'Mission 28 action delivery control blocks new authority' USING ERRCODE='42501'; END IF;
 END IF;
END $$;

CREATE FUNCTION public.canonical_automation_part6e_guard_schedule_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.canonical_automation_part6e_lock_and_assert_allowed_v1(
  NEW.organization_id,NEW.policy_id,NEW.policy_version,NEW.schedule_id,'new_schedule');
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_automation_part6e_schedule_guard
 BEFORE INSERT ON public.canonical_automation_action_schedules_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_automation_part6e_guard_schedule_v1();

CREATE FUNCTION public.canonical_automation_part6e_guard_lease_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE schedule_row public.canonical_automation_action_schedules_v1%ROWTYPE;
BEGIN
 SELECT * INTO schedule_row FROM public.canonical_automation_action_schedules_v1
  WHERE organization_id=NEW.organization_id AND schedule_id=NEW.schedule_id;
 IF schedule_row.schedule_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 controlled schedule unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_automation_part6e_lock_and_assert_allowed_v1(
  NEW.organization_id,schedule_row.policy_id,schedule_row.policy_version,NEW.schedule_id,'new_lease');
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_automation_part6e_lease_guard
 BEFORE INSERT ON public.canonical_automation_delivery_lease_events_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_automation_part6e_guard_lease_v1();

CREATE FUNCTION public.canonical_automation_part6e_guard_retry_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE schedule_row public.canonical_automation_action_schedules_v1%ROWTYPE;
BEGIN
 SELECT * INTO schedule_row FROM public.canonical_automation_action_schedules_v1
  WHERE organization_id=NEW.organization_id AND schedule_id=NEW.schedule_id;
 IF schedule_row.schedule_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 controlled retry schedule unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_automation_part6e_lock_and_assert_allowed_v1(
  NEW.organization_id,schedule_row.policy_id,schedule_row.policy_version,NEW.schedule_id,
  CASE WHEN NEW.decision_kind='record_reconciliation' THEN 'record_reconciliation' ELSE 'new_retry_classification' END);
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_automation_part6e_retry_guard
 BEFORE INSERT ON public.canonical_automation_delivery_retry_events_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_automation_part6e_guard_retry_v1();

CREATE FUNCTION public.canonical_automation_record_delivery_control_v1(
 canonical_text_value TEXT, trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 doc JSONB; org UUID; control_value UUID; operation_value TEXT; target_kind_value TEXT; target_key_value TEXT;
 policy_value UUID; policy_version_value INTEGER; schedule_value UUID; transaction_value UUID; run_value UUID;
 unit_value UUID; outbox_value UUID; receipt_value UUID; actor_value UUID; session_value UUID; membership_value UUID;
 successor_policy_value UUID; successor_version_value INTEGER; review_value UUID;
 requested_value TIMESTAMPTZ(6); reviewed_value TIMESTAMPTZ(6); recorded_value TIMESTAMPTZ(6);
 request_digest_value TEXT; decision_digest_value TEXT; prior_state TEXT; result_state TEXT; execution_phase_value TEXT;
 queued_value INTEGER:=0; leased_value INTEGER:=0; uncertain_value INTEGER:=0; stopped_value INTEGER:=0; scope_total INTEGER:=0;
 control_sequence_value INTEGER; latest_policy_state TEXT; latest_successor_state TEXT; latest_snapshot_id UUID;
 source_index INTEGER; snapshot_count INTEGER; schedule_item RECORD; snapshot_item RECORD;
 stored public.canonical_automation_delivery_control_events_v1%ROWTYPE;
 head public.canonical_automation_delivery_control_heads_v1%ROWTYPE;
 schedule_row public.canonical_automation_action_schedules_v1%ROWTYPE;
 receipt_row public.canonical_automation_provider_request_receipts_v1%ROWTYPE;
 lease_head public.canonical_automation_delivery_lease_heads_v1%ROWTYPE;
 retry_head public.canonical_automation_delivery_retry_heads_v1%ROWTYPE;
 actor_role TEXT; session_created TIMESTAMPTZ;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 32768 THEN
  RAISE EXCEPTION 'Mission 28 delivery control bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','controlId','operation','targetBinding','actorBinding','successorBinding','reviewBinding','requestDigest']) IS DISTINCT FROM TRUE OR
    doc->>'schemaVersion' IS DISTINCT FROM 'mission28.delivery-control-decision.v1' OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'targetBinding',ARRAY['targetKind','policyId','policyVersion','policyDigest','scheduleId','transactionId','runId','unitId','outboxId','receiptId','unitDigest','providerRequestIdentity','providerRequestDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'actorBinding',ARRAY['actorId','sessionId','membershipId','membershipRole','requestedAt']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'successorBinding',ARRAY['policyId','policyVersion','policyDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'reviewBinding',ARRAY['reviewId','reviewDigest','reviewOutcome','reviewedAt']) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 delivery control shape invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'controlId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc->>'operation','') NOT IN('pause_scope','revoke_policy','supersede_policy','drain_scope','resume_scope','cancel_action','expire_action','dead_letter_action','owner_reviewed_retry','bulk_stop') OR
    COALESCE(doc#>>'{targetBinding,targetKind}','') NOT IN('tenant','policy_version','action_schedule') OR
    COALESCE(doc#>>'{actorBinding,actorId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,sessionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{actorBinding,membershipRole}','') NOT IN('owner','admin') OR
    COALESCE(doc#>>'{actorBinding,requestedAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 delivery control primitive invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid; control_value:=(doc->>'controlId')::uuid; operation_value:=doc->>'operation';
 target_kind_value:=doc#>>'{targetBinding,targetKind}'; actor_value:=(doc#>>'{actorBinding,actorId}')::uuid;
 session_value:=(doc#>>'{actorBinding,sessionId}')::uuid; membership_value:=(doc#>>'{actorBinding,membershipId}')::uuid;
 requested_value:=(doc#>>'{actorBinding,requestedAt}')::timestamptz;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-control-decision.v1'||chr(10),doc-'requestDigest'::text);
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' OR
    trusted_resolution IS DISTINCT FROM doc-'schemaVersion'::text-'controlId'::text-'requestDigest'::text THEN
  RAISE EXCEPTION 'Mission 28 delivery control digest or trusted resolution invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control-id:'||control_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_delivery_control_events_v1
  WHERE organization_id=org AND control_id=control_value;
 IF stored.control_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 delivery control identity conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('controlId',stored.control_id,'state',stored.resulting_control_state,
   'executionPhase',stored.execution_phase,'controlSequence',stored.control_sequence,
   'decisionDigest',stored.decision_digest,'replayed',TRUE);
 END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF requested_value>recorded_value OR requested_value<recorded_value-INTERVAL '30 seconds' THEN
  RAISE EXCEPTION 'Mission 28 delivery control request time invalid' USING ERRCODE='22023'; END IF;
 SELECT membership.role,session.created_at INTO actor_role,session_created
 FROM public.auth_sessions session
 JOIN public.organization_memberships membership ON membership.organization_id=session.organization_id
  AND membership.id=session.membership_id AND membership.user_id=session.user_id
 JOIN public.users account ON account.organization_id=session.organization_id AND account.id=session.user_id
 WHERE session.id=session_value AND session.organization_id=org AND session.user_id=actor_value
  AND session.membership_id=membership_value AND session.status='active' AND session.revoked_at IS NULL
  AND session.access_expires_at>recorded_value AND membership.status='active' AND membership.revoked_at IS NULL
  AND account.status='active';
 IF actor_role IS NULL OR actor_role IS DISTINCT FROM doc#>>'{actorBinding,membershipRole}' OR
    (operation_value IN('revoke_policy','supersede_policy','resume_scope','dead_letter_action','owner_reviewed_retry') AND actor_role<>'owner') OR
    (operation_value IN('resume_scope','owner_reviewed_retry') AND session_created<recorded_value-INTERVAL '900 seconds') THEN
  RAISE EXCEPTION 'Mission 28 delivery control actor unavailable' USING ERRCODE='42501'; END IF;

 IF operation_value='supersede_policy' THEN
  IF COALESCE(doc#>>'{successorBinding,policyId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     jsonb_typeof(doc#>'{successorBinding,policyVersion}') IS DISTINCT FROM 'number' OR
     COALESCE(doc#>>'{successorBinding,policyVersion}','')!~'^[1-9][0-9]*$' OR
     COALESCE(doc#>>'{successorBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Mission 28 successor binding invalid' USING ERRCODE='22023'; END IF;
  successor_policy_value:=(doc#>>'{successorBinding,policyId}')::uuid;
  successor_version_value:=(doc#>>'{successorBinding,policyVersion}')::integer;
 ELSE
  IF doc#>'{successorBinding,policyId}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{successorBinding,policyVersion}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{successorBinding,policyDigest}' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'Mission 28 unexpected successor binding' USING ERRCODE='22023'; END IF;
 END IF;
 IF operation_value IN('dead_letter_action','owner_reviewed_retry') THEN
  IF COALESCE(doc#>>'{reviewBinding,reviewId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     COALESCE(doc#>>'{reviewBinding,reviewDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
     COALESCE(doc#>>'{reviewBinding,reviewOutcome}','') NOT IN('no_effect_terminal','effect_or_unknown_unresolved','new_action_required_no_reuse') OR
     COALESCE(doc#>>'{reviewBinding,reviewedAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
   RAISE EXCEPTION 'Mission 28 review binding invalid' USING ERRCODE='22023'; END IF;
  review_value:=(doc#>>'{reviewBinding,reviewId}')::uuid; reviewed_value:=(doc#>>'{reviewBinding,reviewedAt}')::timestamptz;
  IF reviewed_value>requested_value OR reviewed_value<requested_value-INTERVAL '900 seconds' THEN
   RAISE EXCEPTION 'Mission 28 review time invalid' USING ERRCODE='22023'; END IF;
 ELSE
  IF doc#>'{reviewBinding,reviewId}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{reviewBinding,reviewDigest}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{reviewBinding,reviewOutcome}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{reviewBinding,reviewedAt}' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'Mission 28 unexpected review binding' USING ERRCODE='22023'; END IF;
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:tenant',0));
 IF target_kind_value='tenant' THEN
  IF operation_value NOT IN('pause_scope','drain_scope','bulk_stop') OR
     doc#>'{targetBinding,policyId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,policyVersion}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{targetBinding,policyDigest}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,scheduleId}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{targetBinding,transactionId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,runId}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{targetBinding,unitId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,outboxId}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{targetBinding,receiptId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,unitDigest}' IS DISTINCT FROM 'null'::jsonb OR
     doc#>'{targetBinding,providerRequestIdentity}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,providerRequestDigest}' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'Mission 28 tenant control target invalid' USING ERRCODE='22023'; END IF;
  target_key_value:=org::text; execution_phase_value:='scope';
 ELSIF target_kind_value IN('policy_version','action_schedule') THEN
  IF COALESCE(doc#>>'{targetBinding,policyId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     jsonb_typeof(doc#>'{targetBinding,policyVersion}') IS DISTINCT FROM 'number' OR
     COALESCE(doc#>>'{targetBinding,policyVersion}','')!~'^[1-9][0-9]*$' OR
     COALESCE(doc#>>'{targetBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Mission 28 policy control target invalid' USING ERRCODE='22023'; END IF;
  policy_value:=(doc#>>'{targetBinding,policyId}')::uuid; policy_version_value:=(doc#>>'{targetBinding,policyVersion}')::integer;
  IF operation_value='supersede_policy' THEN
   IF policy_value::text<successor_policy_value::text THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy_value::text,0));
    PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||successor_policy_value::text,0));
   ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||successor_policy_value::text,0));
    PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy_value::text,0));
   END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy_value::text,0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:policy:'||policy_value::text||':'||policy_version_value::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1 WHERE organization_id=org AND policy_id=policy_value
     AND version=policy_version_value AND canonical_digest=doc#>>'{targetBinding,policyDigest}') THEN
   RAISE EXCEPTION 'Mission 28 exact policy control target unavailable' USING ERRCODE='42501'; END IF;
  IF target_kind_value='policy_version' THEN
   IF operation_value NOT IN('pause_scope','revoke_policy','supersede_policy','drain_scope','resume_scope','bulk_stop') OR
      doc#>'{targetBinding,scheduleId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,transactionId}' IS DISTINCT FROM 'null'::jsonb OR
      doc#>'{targetBinding,runId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,unitId}' IS DISTINCT FROM 'null'::jsonb OR
      doc#>'{targetBinding,outboxId}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,receiptId}' IS DISTINCT FROM 'null'::jsonb OR
      doc#>'{targetBinding,unitDigest}' IS DISTINCT FROM 'null'::jsonb OR doc#>'{targetBinding,providerRequestIdentity}' IS DISTINCT FROM 'null'::jsonb OR
      doc#>'{targetBinding,providerRequestDigest}' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Mission 28 policy control composition invalid' USING ERRCODE='22023'; END IF;
   target_key_value:=policy_value::text||':'||policy_version_value::text; execution_phase_value:='scope';
  ELSE
   IF operation_value NOT IN('cancel_action','expire_action','dead_letter_action','owner_reviewed_retry') OR
      COALESCE(doc#>>'{targetBinding,scheduleId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      COALESCE(doc#>>'{targetBinding,transactionId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      COALESCE(doc#>>'{targetBinding,runId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      COALESCE(doc#>>'{targetBinding,unitId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      COALESCE(doc#>>'{targetBinding,outboxId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      COALESCE(doc#>>'{targetBinding,receiptId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      COALESCE(doc#>>'{targetBinding,unitDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
      COALESCE(doc#>>'{targetBinding,providerRequestIdentity}','')!~'^m28:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
      COALESCE(doc#>>'{targetBinding,providerRequestDigest}','')!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Mission 28 action control target invalid' USING ERRCODE='22023'; END IF;
   schedule_value:=(doc#>>'{targetBinding,scheduleId}')::uuid; transaction_value:=(doc#>>'{targetBinding,transactionId}')::uuid;
   run_value:=(doc#>>'{targetBinding,runId}')::uuid; unit_value:=(doc#>>'{targetBinding,unitId}')::uuid;
   outbox_value:=(doc#>>'{targetBinding,outboxId}')::uuid; receipt_value:=(doc#>>'{targetBinding,receiptId}')::uuid;
   target_key_value:=schedule_value::text;
   PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-control:action:'||schedule_value::text,0));
   SELECT * INTO schedule_row FROM public.canonical_automation_action_schedules_v1 WHERE organization_id=org AND schedule_id=schedule_value
    AND transaction_id=transaction_value AND run_id=run_value AND unit_id=unit_value AND outbox_id=outbox_value
    AND unit_digest=doc#>>'{targetBinding,unitDigest}' AND policy_id=policy_value AND policy_version=policy_version_value
    AND policy_digest=doc#>>'{targetBinding,policyDigest}';
   SELECT * INTO receipt_row FROM public.canonical_automation_provider_request_receipts_v1 WHERE organization_id=org AND receipt_id=receipt_value
    AND schedule_id=schedule_value AND transaction_id=transaction_value AND run_id=run_value AND unit_id=unit_value AND outbox_id=outbox_value
    AND provider_request_identity=doc#>>'{targetBinding,providerRequestIdentity}' AND provider_request_digest=doc#>>'{targetBinding,providerRequestDigest}';
   IF schedule_row.schedule_id IS NULL OR receipt_row.receipt_id IS NULL THEN
    RAISE EXCEPTION 'Mission 28 exact action control target unavailable' USING ERRCODE='42501'; END IF;
   SELECT * INTO retry_head FROM public.canonical_automation_delivery_retry_heads_v1 WHERE organization_id=org AND schedule_id=schedule_value;
   SELECT * INTO lease_head FROM public.canonical_automation_delivery_lease_heads_v1 WHERE organization_id=org AND schedule_id=schedule_value;
   IF retry_head.state='reconciliation_required_no_resend' THEN execution_phase_value:='uncertain'; uncertain_value:=1;
   ELSIF retry_head.state='permanent_stop_attempt_ceiling' THEN execution_phase_value:='permanent_stop_no_effect'; stopped_value:=1;
   ELSIF retry_head.state LIKE 'permanent_stop_%' THEN execution_phase_value:='permanent_stop_effect_or_unknown'; stopped_value:=1;
   ELSIF lease_head.lease_id IS NOT NULL AND lease_head.lease_expires_at>recorded_value THEN execution_phase_value:='leased'; leased_value:=1;
   ELSE execution_phase_value:='queued'; queued_value:=1; END IF;
  END IF;
 ELSE RAISE EXCEPTION 'Mission 28 delivery control target kind invalid' USING ERRCODE='22023'; END IF;

 IF target_kind_value IN('tenant','policy_version') THEN
  FOR schedule_item IN SELECT schedule_id,policy_id,policy_version FROM public.canonical_automation_action_schedules_v1
   WHERE organization_id=org AND (target_kind_value='tenant' OR (policy_id=policy_value AND policy_version=policy_version_value))
  LOOP
   scope_total:=scope_total+1; IF scope_total>32 THEN RAISE EXCEPTION 'Mission 28 delivery control scope exceeds bound' USING ERRCODE='54000'; END IF;
   SELECT * INTO retry_head FROM public.canonical_automation_delivery_retry_heads_v1 WHERE organization_id=org AND schedule_id=schedule_item.schedule_id;
   SELECT * INTO lease_head FROM public.canonical_automation_delivery_lease_heads_v1 WHERE organization_id=org AND schedule_id=schedule_item.schedule_id;
   IF retry_head.state='reconciliation_required_no_resend' THEN uncertain_value:=uncertain_value+1;
   ELSIF retry_head.state LIKE 'permanent_stop_%' THEN stopped_value:=stopped_value+1;
   ELSIF lease_head.lease_id IS NOT NULL AND lease_head.lease_expires_at>recorded_value THEN leased_value:=leased_value+1;
   ELSE queued_value:=queued_value+1; END IF;
  END LOOP;
 END IF;

 SELECT * INTO head FROM public.canonical_automation_delivery_control_heads_v1
  WHERE organization_id=org AND target_kind=target_kind_value AND target_key=target_key_value FOR UPDATE;
 prior_state:=COALESCE(head.control_state,'normal'); control_sequence_value:=COALESCE(head.control_sequence,0)+1;
 IF control_sequence_value>64 THEN RAISE EXCEPTION 'Mission 28 delivery control sequence ceiling reached' USING ERRCODE='54000'; END IF;

 IF operation_value='pause_scope' THEN
  IF prior_state IN('revoked_terminal','superseded_terminal','bulk_stopped_terminal') THEN RAISE EXCEPTION 'Mission 28 terminal scope cannot pause' USING ERRCODE='42501'; END IF;
  result_state:='paused';
 ELSIF operation_value='drain_scope' THEN
  IF prior_state IN('revoked_terminal','superseded_terminal','bulk_stopped_terminal') THEN RAISE EXCEPTION 'Mission 28 terminal scope cannot drain' USING ERRCODE='42501'; END IF;
  result_state:=CASE WHEN leased_value+uncertain_value=0 THEN 'drained' ELSE 'draining' END;
 ELSIF operation_value='bulk_stop' THEN
  IF prior_state IN('revoked_terminal','superseded_terminal','bulk_stopped_terminal') THEN RAISE EXCEPTION 'Mission 28 terminal scope cannot bulk stop again' USING ERRCODE='42501'; END IF;
  result_state:='bulk_stopped_terminal';
 ELSIF operation_value='revoke_policy' THEN
  IF prior_state IN('revoked_terminal','superseded_terminal','bulk_stopped_terminal') THEN RAISE EXCEPTION 'Mission 28 terminal policy cannot revoke again' USING ERRCODE='42501'; END IF;
  result_state:='revoked_terminal';
 ELSIF operation_value='supersede_policy' THEN
  IF prior_state IN('revoked_terminal','superseded_terminal','bulk_stopped_terminal') THEN RAISE EXCEPTION 'Mission 28 terminal policy cannot supersede again' USING ERRCODE='42501'; END IF;
  IF successor_policy_value=policy_value AND successor_version_value=policy_version_value THEN RAISE EXCEPTION 'Mission 28 self supersession denied' USING ERRCODE='22023'; END IF;
  SELECT to_state INTO latest_successor_state FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=successor_policy_value AND policy_version=successor_version_value
   ORDER BY lifecycle_sequence DESC LIMIT 1;
  IF latest_successor_state IS DISTINCT FROM 'active' OR NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
    WHERE organization_id=org AND policy_id=successor_policy_value AND version=successor_version_value
     AND canonical_digest=doc#>>'{successorBinding,policyDigest}' AND expires_at>recorded_value) THEN
   RAISE EXCEPTION 'Mission 28 supersession successor unavailable' USING ERRCODE='42501'; END IF;
  result_state:='superseded_terminal';
 ELSIF operation_value='resume_scope' THEN
  IF prior_state NOT IN('paused','drained') OR leased_value+uncertain_value+stopped_value<>0 THEN
   RAISE EXCEPTION 'Mission 28 scope is not safely resumable' USING ERRCODE='42501'; END IF;
  SELECT to_state INTO latest_policy_state FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=policy_value AND policy_version=policy_version_value
   ORDER BY lifecycle_sequence DESC LIMIT 1;
  IF latest_policy_state IS DISTINCT FROM 'active' OR NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
    WHERE organization_id=org AND policy_id=policy_value AND version=policy_version_value
     AND canonical_digest=doc#>>'{targetBinding,policyDigest}' AND expires_at>recorded_value) THEN
   RAISE EXCEPTION 'Mission 28 resume policy unavailable' USING ERRCODE='42501'; END IF;
  FOR schedule_item IN SELECT document FROM public.canonical_automation_action_transactions_v1
   WHERE organization_id=org AND policy_id=policy_value AND policy_version=policy_version_value LOOP
   snapshot_count:=jsonb_array_length(schedule_item.document#>'{sourceBinding,snapshotIds}');
   FOR source_index IN 0..snapshot_count-1 LOOP
    SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
     WHERE organization_id=org AND snapshot_id=(schedule_item.document#>>ARRAY['sourceBinding','snapshotIds',source_index::text])::uuid
      AND snapshot_digest=schedule_item.document#>>ARRAY['sourceBinding','snapshotDigests',source_index::text];
    IF snapshot_item.snapshot_id IS NULL OR snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
     RAISE EXCEPTION 'Mission 28 resume source unavailable' USING ERRCODE='42501'; END IF;
    SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
     WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id AND record_identity_digest=snapshot_item.record_identity_digest
      AND event_kind=snapshot_item.event_kind ORDER BY lineage_sequence DESC LIMIT 1;
    IF latest_snapshot_id IS DISTINCT FROM snapshot_item.snapshot_id THEN RAISE EXCEPTION 'Mission 28 resume source stale' USING ERRCODE='42501'; END IF;
   END LOOP;
  END LOOP;
  result_state:='active_resumed';
 ELSIF operation_value='cancel_action' THEN
  IF prior_state<>'normal' OR execution_phase_value<>'queued' THEN RAISE EXCEPTION 'Mission 28 action is not cancellable' USING ERRCODE='42501'; END IF;
  result_state:='cancelled_terminal';
 ELSIF operation_value='expire_action' THEN
  IF prior_state<>'normal' OR execution_phase_value<>'queued' THEN
   RAISE EXCEPTION 'Mission 28 action phase is not safely expirable' USING ERRCODE='42501'; END IF;
  IF schedule_row.expires_at>recorded_value AND EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
    WHERE organization_id=org AND policy_id=policy_value AND version=policy_version_value AND expires_at>recorded_value) THEN
   RAISE EXCEPTION 'Mission 28 action is not expired' USING ERRCODE='42501'; END IF;
  result_state:='expired_terminal';
 ELSIF operation_value='dead_letter_action' THEN
  IF prior_state<>'normal' OR execution_phase_value NOT IN('uncertain','permanent_stop_no_effect','permanent_stop_effect_or_unknown') OR
     (execution_phase_value='permanent_stop_no_effect' AND doc#>>'{reviewBinding,reviewOutcome}'<>'no_effect_terminal') OR
     (execution_phase_value IN('uncertain','permanent_stop_effect_or_unknown') AND doc#>>'{reviewBinding,reviewOutcome}'<>'effect_or_unknown_unresolved') THEN
   RAISE EXCEPTION 'Mission 28 dead letter review mismatch' USING ERRCODE='42501'; END IF;
  result_state:='dead_lettered_terminal';
 ELSIF operation_value='owner_reviewed_retry' THEN
  IF prior_state<>'dead_lettered_terminal' OR head.execution_phase<>'permanent_stop_no_effect' OR
     doc#>>'{reviewBinding,reviewOutcome}'<>'new_action_required_no_reuse' THEN
   RAISE EXCEPTION 'Mission 28 reviewed retry remains unavailable' USING ERRCODE='42501'; END IF;
  SELECT to_state INTO latest_policy_state FROM public.canonical_automation_lifecycle_events_v1
   WHERE organization_id=org AND policy_id=policy_value AND policy_version=policy_version_value ORDER BY lifecycle_sequence DESC LIMIT 1;
  IF latest_policy_state IS DISTINCT FROM 'active' OR NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
    WHERE organization_id=org AND policy_id=policy_value AND version=policy_version_value
     AND canonical_digest=doc#>>'{targetBinding,policyDigest}' AND expires_at>recorded_value) THEN
   RAISE EXCEPTION 'Mission 28 reviewed retry policy unavailable' USING ERRCODE='42501'; END IF;
  SELECT document INTO schedule_item FROM public.canonical_automation_action_transactions_v1
   WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value
    AND policy_id=policy_value AND policy_version=policy_version_value;
  IF schedule_item.document IS NULL THEN RAISE EXCEPTION 'Mission 28 reviewed retry transaction unavailable' USING ERRCODE='42501'; END IF;
  snapshot_count:=jsonb_array_length(schedule_item.document#>'{sourceBinding,snapshotIds}');
  FOR source_index IN 0..snapshot_count-1 LOOP
   SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
    WHERE organization_id=org AND snapshot_id=(schedule_item.document#>>ARRAY['sourceBinding','snapshotIds',source_index::text])::uuid
     AND snapshot_digest=schedule_item.document#>>ARRAY['sourceBinding','snapshotDigests',source_index::text];
   IF snapshot_item.snapshot_id IS NULL OR snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
    RAISE EXCEPTION 'Mission 28 reviewed retry source unavailable' USING ERRCODE='42501'; END IF;
   SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
    WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id AND record_identity_digest=snapshot_item.record_identity_digest
     AND event_kind=snapshot_item.event_kind ORDER BY lineage_sequence DESC LIMIT 1;
   IF latest_snapshot_id IS DISTINCT FROM snapshot_item.snapshot_id THEN RAISE EXCEPTION 'Mission 28 reviewed retry source stale' USING ERRCODE='42501'; END IF;
  END LOOP;
  result_state:='reviewed_retry_new_action_required';
 ELSE RAISE EXCEPTION 'Mission 28 delivery control operation invalid' USING ERRCODE='22023'; END IF;

 decision_digest_value:=public.canonical_automation_digest_v1('mission28.delivery-control-evidence.v1'||chr(10),jsonb_build_object(
  'tenantId',org::text,'controlId',control_value::text,'targetKind',target_kind_value,'targetKey',target_key_value,
  'controlSequence',control_sequence_value,'operation',operation_value,'priorState',prior_state,'resultState',result_state,
  'executionPhase',execution_phase_value,'queuedCount',queued_value,'leasedCount',leased_value,
  'uncertainCount',uncertain_value,'permanentStopCount',stopped_value,'requestDigest',request_digest_value));

 INSERT INTO public.canonical_automation_delivery_control_heads_v1 VALUES(
  org,target_kind_value,target_key_value,policy_value,policy_version_value,NULLIF(doc#>>'{targetBinding,policyDigest}',''),
  schedule_value,transaction_value,run_value,unit_value,outbox_value,receipt_value,NULLIF(doc#>>'{targetBinding,unitDigest}',''),
  NULLIF(doc#>>'{targetBinding,providerRequestIdentity}',''),NULLIF(doc#>>'{targetBinding,providerRequestDigest}',''),
  result_state,execution_phase_value,control_sequence_value,queued_value,leased_value,uncertain_value,stopped_value,0,0,
  control_value,decision_digest_value,recorded_value,'postgresql_statement_timestamp_v1','UTC')
 ON CONFLICT(organization_id,target_kind,target_key) DO UPDATE SET
  control_state=EXCLUDED.control_state,execution_phase=EXCLUDED.execution_phase,control_sequence=EXCLUDED.control_sequence,
  queued_count=EXCLUDED.queued_count,leased_count=EXCLUDED.leased_count,uncertain_count=EXCLUDED.uncertain_count,
  permanent_stop_count=EXCLUDED.permanent_stop_count,last_control_id=EXCLUDED.last_control_id,
  last_decision_digest=EXCLUDED.last_decision_digest,updated_at=EXCLUDED.updated_at;

 INSERT INTO public.canonical_automation_delivery_control_events_v1 VALUES(
  org,control_value,target_kind_value,target_key_value,control_sequence_value,operation_value,policy_value,policy_version_value,
  NULLIF(doc#>>'{targetBinding,policyDigest}',''),schedule_value,transaction_value,run_value,unit_value,outbox_value,receipt_value,
  NULLIF(doc#>>'{targetBinding,unitDigest}',''),NULLIF(doc#>>'{targetBinding,providerRequestIdentity}',''),
  NULLIF(doc#>>'{targetBinding,providerRequestDigest}',''),actor_value,session_value,membership_value,actor_role,requested_value,
  successor_policy_value,successor_version_value,NULLIF(doc#>>'{successorBinding,policyDigest}',''),review_value,
  NULLIF(doc#>>'{reviewBinding,reviewDigest}',''),NULLIF(doc#>>'{reviewBinding,reviewOutcome}',''),reviewed_value,
  prior_state,result_state,execution_phase_value,queued_value,leased_value,uncertain_value,stopped_value,0,0,
  request_digest_value,decision_digest_value,canonical_text_value,doc,recorded_value,'decision_history','postgresql_statement_timestamp_v1','UTC');

 RETURN jsonb_build_object('controlId',control_value,'state',result_state,'executionPhase',execution_phase_value,
  'controlSequence',control_sequence_value,'queuedCount',queued_value,'leasedCount',leased_value,
  'uncertainCount',uncertain_value,'permanentStopCount',stopped_value,'decisionDigest',decision_digest_value,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_automation_delivery_control_heads_v1,
 public.canonical_automation_delivery_control_events_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_part6e_lock_and_assert_allowed_v1(UUID,UUID,BIGINT,UUID,TEXT),
 public.canonical_automation_record_delivery_control_v1(TEXT,JSONB) FROM PUBLIC;
