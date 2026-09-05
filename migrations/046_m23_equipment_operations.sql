-- Mission 23 Part 5. Additive only; 001-045 remain immutable.
-- Universal research is NorthStar-controlled. No seed research or live import.
CREATE FUNCTION public.equipment_digest(value JSONB) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT encode(sha256(convert_to(public.canonical_knowledge_render_jsonb(value),'UTF8')),'hex')
$$;

CREATE FUNCTION public.equipment_text(value TEXT, maximum INTEGER DEFAULT 1000) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value IS NOT NULL AND value=normalize(value,NFC) AND value=btrim(value)
 AND length(value)<=maximum AND octet_length(value)<=maximum*4
 AND (value='' OR public.canonical_material_text_valid(value))
$$;

CREATE FUNCTION public.equipment_keys(value JSONB, allowed TEXT[], required TEXT[]) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value IS NOT NULL AND jsonb_typeof(value)='object'
 AND octet_length(value::text)<=32768
 AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT k=ANY(allowed))
 AND value ?& required
$$;

CREATE FUNCTION public.equipment_identity(fields JSONB) RETURNS JSONB
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_object_agg(k,COALESCE(fields->k,'"unknown"'::jsonb))
 FROM unnest(ARRAY['manufacturer','model','modelYear','series','engine','configuration']) k
$$;

CREATE FUNCTION public.equipment_types(value JSONB, expected JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(bool_and(COALESCE(jsonb_typeof(value->key)=ANY(string_to_array(kind,',')),FALSE)),FALSE)
 FROM jsonb_each_text(expected) AS types(key,kind)
$$;

CREATE TABLE public.canonical_equipment_universal_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 configuration_digest TEXT NOT NULL CHECK(configuration_digest ~ '^[a-f0-9]{64}$'),
 version INTEGER NOT NULL CHECK(version>0),
 document JSONB NOT NULL,
 digest TEXT NOT NULL CHECK(digest=public.equipment_digest(document)),
 predecessor_id UUID REFERENCES public.canonical_equipment_universal_versions(id) ON DELETE RESTRICT,
 imported_by TEXT NOT NULL,
 reviewer_reference TEXT NOT NULL CHECK(public.equipment_text(reviewer_reference,240) AND reviewer_reference<>''),
 review_evidence_digest TEXT NOT NULL CHECK(review_evidence_digest ~ '^[a-f0-9]{64}$'),
 reason TEXT NOT NULL CHECK(public.equipment_text(reason,500) AND reason<>''),
 imported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(configuration_digest,version), UNIQUE(id,digest)
);

CREATE TABLE public.canonical_equipment_drafts (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 actor_user_id UUID NOT NULL,
 session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision>0),
 document JSONB NOT NULL,
 digest TEXT NOT NULL CHECK(digest=public.equipment_digest(document)),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+INTERVAL '24 hours'),
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_equipment_receipts (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL,
 session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 key_hash TEXT NOT NULL,
 request_digest TEXT NOT NULL,
 action TEXT NOT NULL,
 subject_id UUID NOT NULL,
 response JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,actor_user_id,session_id,key_hash),
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 CHECK(key_hash ~ '^[a-f0-9]{64}$' AND request_digest ~ '^[a-f0-9]{64}$')
);

CREATE TABLE public.canonical_equipment_draft_history (
 organization_id UUID NOT NULL,
 draft_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 document JSONB NOT NULL,
 digest TEXT NOT NULL CHECK(digest=public.equipment_digest(document)),
 actor_user_id UUID NOT NULL,
 session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 action TEXT NOT NULL,
 request_digest TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,draft_id,revision),
 FOREIGN KEY(organization_id,draft_id) REFERENCES public.canonical_equipment_drafts(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_equipment_asset_versions (
 organization_id UUID NOT NULL,
 asset_id UUID NOT NULL,
 asset_version INTEGER NOT NULL CHECK(asset_version>0),
 asset_snapshot JSONB NOT NULL,
 asset_digest TEXT NOT NULL CHECK(asset_digest=public.equipment_digest(asset_snapshot)),
 private_configuration JSONB NOT NULL,
 knowledge_version_id UUID,
 knowledge_digest TEXT,
 category_label TEXT NOT NULL CHECK(public.equipment_text(category_label,80) AND category_label<>''),
 review_state TEXT NOT NULL CHECK(review_state IN ('reviewed','needs_review')),
 draft_id UUID NOT NULL,
 draft_revision INTEGER NOT NULL,
 actor_user_id UUID NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,asset_id,asset_version),
 UNIQUE(organization_id,asset_id,asset_version,asset_digest),
 FOREIGN KEY(organization_id,asset_id) REFERENCES public.tenant_assets(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(knowledge_version_id,knowledge_digest) REFERENCES public.canonical_equipment_universal_versions(id,digest) MATCH FULL ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,draft_id,draft_revision) REFERENCES public.canonical_equipment_draft_history(organization_id,draft_id,revision) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_equipment_ledgers (
 organization_id UUID NOT NULL,
 asset_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 state JSONB NOT NULL,
 digest TEXT NOT NULL CHECK(digest=public.equipment_digest(state)),
 PRIMARY KEY(organization_id,asset_id),
 FOREIGN KEY(organization_id,asset_id) REFERENCES public.tenant_assets(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_equipment_events (
 organization_id UUID NOT NULL,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 asset_id UUID NOT NULL,
 asset_version INTEGER NOT NULL,
 asset_digest TEXT NOT NULL,
 knowledge_version_id UUID NOT NULL,
 knowledge_digest TEXT NOT NULL,
 execution_id UUID NOT NULL,
 assignment_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,
 performer_profile_id UUID NOT NULL,
 session_id UUID NOT NULL REFERENCES public.auth_sessions(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL,
 root_id UUID NOT NULL,
 supersedes_id UUID,
 document JSONB NOT NULL,
 digest TEXT NOT NULL CHECK(digest=public.equipment_digest(document)),
 state JSONB NOT NULL,
 state_digest TEXT NOT NULL CHECK(state_digest=public.equipment_digest(state)),
 request_digest TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,asset_id,revision), UNIQUE(organization_id,supersedes_id),
 FOREIGN KEY(organization_id,asset_id,asset_version,asset_digest) REFERENCES public.canonical_equipment_asset_versions(organization_id,asset_id,asset_version,asset_digest) ON DELETE RESTRICT,
 FOREIGN KEY(knowledge_version_id,knowledge_digest) REFERENCES public.canonical_equipment_universal_versions(id,digest) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,assignment_id) REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,performer_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,root_id) REFERENCES public.canonical_equipment_events(organization_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(organization_id,supersedes_id) REFERENCES public.canonical_equipment_events(organization_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION public.equipment_immutable() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 RAISE EXCEPTION 'Equipment evidence is append-only' USING ERRCODE='42501';
END $$;

CREATE FUNCTION public.equipment_operation_mutate(org UUID, actor UUID, role_value TEXT, session_value UUID, csrf TEXT,
 execution_value UUID, key_value TEXT, input JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a JSONB; execution_record public.canonical_field_executions%ROWTYPE;
 assignment_record public.canonical_schedule_assignments%ROWTYPE; asset_record public.tenant_assets%ROWTYPE;
 pin public.canonical_equipment_asset_versions%ROWTYPE; ledger public.canonical_equipment_ledgers%ROWTYPE;
 previous public.canonical_equipment_events%ROWTYPE; receipt public.canonical_equipment_receipts%ROWTYPE;
 event_value UUID:=gen_random_uuid(); root_value UUID; supersedes_value UUID; performer UUID;
 asset_value UUID; research JSONB; request_hash TEXT; key_hash_value TEXT; result JSONB; item RECORD;
 state_value JSONB; readings JSONB:='{}'; meter JSONB; held_execution TEXT; held_operator TEXT; downtime BOOLEAN:=FALSE;
 has_fault BOOLEAN:=FALSE; count_value INTEGER:=0; action_value TEXT; kind_value TEXT; observed TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value IS NULL OR key_value !~ '^[!-~]{16,128}$'
 OR NOT public.equipment_keys(input,ARRAY['action','assetId','assetVersion','assetDigest','knowledgeVersionId','knowledgeDigest',
 'expectedExecutionRevision','expectedExecutionDigest','expectedAssignmentRevision','expectedAssignmentDigest','expectedAssetRevision','expectedAssetDigest',
 'performerProfileId','kind','observedAt','meterKey','reading','unit','description','reason','correctsEventId'],
 ARRAY['action','assetId','assetVersion','assetDigest','knowledgeVersionId','knowledgeDigest','expectedExecutionRevision','expectedExecutionDigest',
 'expectedAssignmentRevision','expectedAssignmentDigest','expectedAssetRevision','expectedAssetDigest','performerProfileId','kind','observedAt','meterKey','reading','unit','description','reason','correctsEventId']) THEN
 RAISE EXCEPTION 'Invalid equipment operation' USING ERRCODE='22023'; END IF;
 IF NOT public.equipment_types(input,'{"action":"string","assetId":"string","assetVersion":"number","assetDigest":"string","knowledgeVersionId":"string","knowledgeDigest":"string","expectedExecutionRevision":"number","expectedExecutionDigest":"string","expectedAssignmentRevision":"number","expectedAssignmentDigest":"string","expectedAssetRevision":"number","expectedAssetDigest":"string,null","performerProfileId":"string","kind":"string","observedAt":"string","meterKey":"string,null","reading":"string,null","unit":"string,null","description":"string","reason":"string","correctsEventId":"string,null"}') THEN
 RAISE EXCEPTION 'Invalid equipment value types' USING ERRCODE='22023'; END IF;
 a:=public.equipment_actor(org,actor,role_value,session_value,csrf,TRUE,FALSE);
 action_value:=input->>'action'; kind_value:=input->>'kind'; asset_value:=(input->>'assetId')::uuid;
 performer:=(input->>'performerProfileId')::uuid; observed:=(input->>'observedAt')::timestamptz;
 IF action_value NOT IN ('record','correct') OR kind_value NOT IN ('check_out','use','check_in','reading','condition','fault','downtime_start','downtime_end','maintenance','meter_reset')
 OR asset_value IS NULL OR performer IS NULL OR observed IS NULL OR NOT isfinite(observed)
 OR observed>clock_timestamp()+INTERVAL '5 minutes' OR observed<clock_timestamp()-INTERVAL '366 days'
 OR NOT public.equipment_text(input->>'description',1000) OR NOT public.equipment_text(input->>'reason',500) OR input->>'reason'=''
 OR input->>'expectedExecutionRevision' IS NULL OR input->>'expectedExecutionDigest' IS NULL
 OR input->>'expectedAssignmentRevision' IS NULL OR input->>'expectedAssignmentDigest' IS NULL
 OR input->>'assetVersion' IS NULL OR input->>'assetDigest' IS NULL OR input->>'knowledgeVersionId' IS NULL OR input->>'knowledgeDigest' IS NULL
 OR input->>'expectedAssetRevision' IS NULL OR (input->>'expectedAssetRevision')::integer<0
 OR ((input->>'expectedAssetRevision')::integer=0 AND input->'expectedAssetDigest'<>'null'::jsonb)
 OR ((input->>'expectedAssetRevision')::integer>0 AND input->>'expectedAssetDigest' IS NULL) THEN
 RAISE EXCEPTION 'Invalid equipment evidence' USING ERRCODE='22023'; END IF;
 IF input->>'reading' IS NOT NULL THEN
 IF input->>'reading' !~ '^(0|[1-9][0-9]{0,9})([.][0-9]{1,3})?$' OR input->>'unit' NOT IN ('hours','km','mi','percent','litres','gallons','count')
 OR NOT public.equipment_text(input->>'meterKey',80) OR input->>'meterKey'='' OR (input->>'unit'='percent' AND (input->>'reading')::numeric>100) THEN
 RAISE EXCEPTION 'Invalid equipment reading' USING ERRCODE='22023'; END IF;
 ELSIF input->>'unit' IS NOT NULL OR input->>'meterKey' IS NOT NULL OR kind_value IN ('reading','meter_reset') THEN
 RAISE EXCEPTION 'Reading and unit required' USING ERRCODE='22023'; END IF;
 IF (action_value='correct' OR kind_value='meter_reset') AND role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Equipment review authority required' USING ERRCODE='42501'; END IF;
 IF action_value='record' AND input->>'correctsEventId' IS NOT NULL OR action_value='correct' AND input->>'correctsEventId' IS NULL THEN
 RAISE EXCEPTION 'Exact correction predecessor required' USING ERRCODE='22023'; END IF;
 SELECT * INTO execution_record FROM public.canonical_field_executions WHERE organization_id=org AND id=execution_value FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Execution unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO assignment_record FROM public.canonical_schedule_assignments WHERE organization_id=org AND id=execution_record.assignment_id FOR SHARE;
 IF NOT FOUND OR NOT public.canonical_field_execution_replay_authorized(org,role_value,(a->>'profileId')::uuid,execution_value,NULL)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_transcripts WHERE organization_id=org AND operation_id=execution_record.operation_id AND graph_id=execution_record.graph_id
 AND public.canonical_labor_transcript_source_normalized(source) IN ('lead','retell','voice')) THEN RAISE EXCEPTION 'Current execution scope unavailable' USING ERRCODE='42501'; END IF;
 IF assignment_record.needs_review OR assignment_record.schedule_state<>'scheduled' THEN RAISE EXCEPTION 'Assignment needs review' USING ERRCODE='40001'; END IF;
 IF action_value='record' AND execution_record.lifecycle_state<>'in_progress' THEN RAISE EXCEPTION 'Equipment recording requires in-progress execution' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles p JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
 JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
 WHERE p.organization_id=org AND p.id=performer AND m.status='active' AND u.status='active')
 OR (role_value='member' AND performer<>(a->>'profileId')::uuid) THEN RAISE EXCEPTION 'Performer unavailable' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE(assignment_record.workforce_profile_id=performer OR
 (assignment_record.workforce_crew_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.workforce_crew_members cm
 WHERE cm.organization_id=org AND cm.crew_id=assignment_record.workforce_crew_id AND cm.profile_id=performer)),FALSE) THEN
 RAISE EXCEPTION 'Performer is outside current assignment' USING ERRCODE='42501'; END IF;
 SELECT * INTO asset_record FROM public.tenant_assets WHERE organization_id=org AND id=asset_value FOR SHARE;
 IF NOT FOUND OR asset_record.catalogue_state<>'active' THEN RAISE EXCEPTION 'Asset unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO pin FROM public.canonical_equipment_asset_versions WHERE organization_id=org AND asset_id=asset_value AND asset_version=asset_record.version;
 IF NOT FOUND OR pin.asset_digest<>public.equipment_digest(to_jsonb(asset_record)) OR pin.review_state<>'reviewed' THEN RAISE EXCEPTION 'Asset needs review' USING ERRCODE='40001'; END IF;
 research:=public.equipment_research(pin.private_configuration);
 IF research->>'state'<>'reviewed' OR (research->>'versionId')::uuid<>pin.knowledge_version_id OR research->>'digest'<>pin.knowledge_digest THEN
 RAISE EXCEPTION 'Research needs review' USING ERRCODE='40001'; END IF;
 IF execution_record.revision<>(input->>'expectedExecutionRevision')::bigint OR rtrim(execution_record.canonical_digest)<>input->>'expectedExecutionDigest'
 OR assignment_record.revision<>(input->>'expectedAssignmentRevision')::bigint OR rtrim(assignment_record.canonical_digest)<>input->>'expectedAssignmentDigest'
 OR pin.asset_version<>(input->>'assetVersion')::integer OR pin.asset_digest<>input->>'assetDigest'
 OR pin.knowledge_version_id<>(input->>'knowledgeVersionId')::uuid OR pin.knowledge_digest<>input->>'knowledgeDigest' THEN
 RAISE EXCEPTION 'Equipment source pins changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':equipment:'||asset_value::text,0));
 request_hash:=public.equipment_digest(jsonb_build_object('execution',execution_value,'input',input));
 key_hash_value:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||actor::text||session_value::text||key_hash_value,0));
 SELECT * INTO receipt FROM public.canonical_equipment_receipts WHERE organization_id=org AND actor_user_id=actor AND session_id=session_value AND key_hash=key_hash_value;
 IF FOUND THEN
 IF receipt.request_digest<>request_hash THEN RAISE EXCEPTION 'Equipment idempotency conflict' USING ERRCODE='23505'; END IF;
 RETURN receipt.response||jsonb_build_object('replayed',TRUE); END IF;
 IF execution_record.revision<>(input->>'expectedExecutionRevision')::bigint OR rtrim(execution_record.canonical_digest)<>input->>'expectedExecutionDigest'
 OR assignment_record.revision<>(input->>'expectedAssignmentRevision')::bigint OR rtrim(assignment_record.canonical_digest)<>input->>'expectedAssignmentDigest'
 OR pin.asset_version<>(input->>'assetVersion')::integer OR pin.asset_digest<>input->>'assetDigest'
 OR pin.knowledge_version_id<>(input->>'knowledgeVersionId')::uuid OR pin.knowledge_digest<>input->>'knowledgeDigest' THEN
 RAISE EXCEPTION 'Equipment source pins changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO ledger FROM public.canonical_equipment_ledgers WHERE organization_id=org AND asset_id=asset_value FOR UPDATE;
 IF COALESCE(ledger.revision,0)<>(input->>'expectedAssetRevision')::integer OR ledger.digest IS DISTINCT FROM input->>'expectedAssetDigest' THEN
 RAISE EXCEPTION 'Equipment ledger changed' USING ERRCODE='40001'; END IF;
 IF COALESCE(ledger.revision,0)>=10000 THEN RAISE EXCEPTION 'Equipment evidence limit reached' USING ERRCODE='54000'; END IF;
 root_value:=event_value; supersedes_value:=NULL;
 IF action_value='correct' THEN
 SELECT * INTO previous FROM public.canonical_equipment_events WHERE organization_id=org AND id=(input->>'correctsEventId')::uuid
 AND asset_id=asset_value AND execution_id=execution_value;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.canonical_equipment_events WHERE organization_id=org AND supersedes_id=previous.id) THEN
 RAISE EXCEPTION 'Correction predecessor changed' USING ERRCODE='40001'; END IF;
 root_value:=previous.root_id; supersedes_value:=previous.id;
 END IF;
 -- Fold effective evidence in original recording order. Correction replaces one
 -- fact at its original place and must preserve the complete ledger invariants.
 FOR item IN
 SELECT x.document,x.execution_id,x.performer_profile_id,x.ordinal FROM (
 SELECT e.document,e.execution_id,e.performer_profile_id,r.revision AS ordinal
 FROM public.canonical_equipment_events e JOIN public.canonical_equipment_events r ON r.organization_id=e.organization_id AND r.id=e.root_id
 WHERE e.organization_id=org AND e.asset_id=asset_value AND e.id IS DISTINCT FROM supersedes_value
 AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events s WHERE s.organization_id=org AND s.supersedes_id=e.id)
 UNION ALL SELECT input,execution_value,performer,COALESCE((SELECT revision FROM public.canonical_equipment_events WHERE organization_id=org AND id=root_value),COALESCE(ledger.revision,0)+1)
 ) x ORDER BY x.ordinal LOOP
 count_value:=count_value+1;
 IF item.document->>'kind'='check_out' THEN
 IF held_execution IS NOT NULL OR downtime THEN RAISE EXCEPTION 'Asset checkout conflicts with recorded state' USING ERRCODE='40001'; END IF;
 held_execution:=item.execution_id::text; held_operator:=item.performer_profile_id::text;
 ELSIF item.document->>'kind' IN ('use','check_in') THEN
 IF held_execution IS DISTINCT FROM item.execution_id::text OR held_operator IS DISTINCT FROM item.performer_profile_id::text OR (downtime AND item.document->>'kind'='use') THEN
 RAISE EXCEPTION 'Asset must be checked out to this operator and execution' USING ERRCODE='40001'; END IF;
 IF item.document->>'kind'='check_in' THEN held_execution:=NULL; held_operator:=NULL; END IF;
 ELSIF item.document->>'kind'='downtime_start' THEN
 IF downtime THEN RAISE EXCEPTION 'Downtime already open' USING ERRCODE='40001'; END IF; downtime:=TRUE;
 ELSIF item.document->>'kind'='downtime_end' THEN
 IF NOT downtime THEN RAISE EXCEPTION 'No recorded downtime to end' USING ERRCODE='40001'; END IF; downtime:=FALSE;
 ELSIF item.document->>'kind'='fault' THEN has_fault:=TRUE;
 END IF;
 IF item.document->>'reading' IS NOT NULL THEN
 meter:=readings->(item.document->>'meterKey');
 IF meter IS NOT NULL AND (meter->>'unit'<>item.document->>'unit' OR
 ((item.document->>'unit') IN ('hours','km','mi','count') AND (item.document->>'reading')::numeric<(meter->>'reading')::numeric))
 AND item.document->>'kind'<>'meter_reset' THEN RAISE EXCEPTION 'Meter needs explicit reset or correction' USING ERRCODE='40001'; END IF;
 readings:=readings||jsonb_build_object(item.document->>'meterKey',jsonb_build_object('reading',item.document->>'reading','unit',item.document->>'unit'));
 IF (SELECT count(*) FROM jsonb_object_keys(readings))>64 THEN RAISE EXCEPTION 'Equipment meter bound reached' USING ERRCODE='54000'; END IF;
 END IF;
 END LOOP;
 state_value:=jsonb_build_object('revision',COALESCE(ledger.revision,0)+1,'effectiveFactCount',count_value,'checkedOutExecution',held_execution,'operator',held_operator,
 'downtime',downtime,'recordedFault',has_fault,'readings',readings,'availability',CASE WHEN downtime THEN 'recorded_unavailable' WHEN has_fault THEN 'needs_review' WHEN held_execution IS NOT NULL THEN 'in_use' ELSE 'unknown' END);
 IF octet_length(state_value::text)>32768 THEN RAISE EXCEPTION 'Equipment state bound reached' USING ERRCODE='54000'; END IF;
 INSERT INTO public.canonical_equipment_ledgers(organization_id,asset_id,revision,state,digest)
 VALUES(org,asset_value,COALESCE(ledger.revision,0)+1,state_value,public.equipment_digest(state_value))
 ON CONFLICT(organization_id,asset_id) DO UPDATE SET revision=EXCLUDED.revision,state=EXCLUDED.state,digest=EXCLUDED.digest;
 INSERT INTO public.canonical_equipment_events(organization_id,id,asset_id,asset_version,asset_digest,knowledge_version_id,knowledge_digest,execution_id,assignment_id,
 actor_user_id,performer_profile_id,session_id,revision,root_id,supersedes_id,document,digest,state,state_digest,request_digest)
 VALUES(org,event_value,asset_value,pin.asset_version,pin.asset_digest,pin.knowledge_version_id,pin.knowledge_digest,execution_value,assignment_record.id,actor,performer,session_value,
 COALESCE(ledger.revision,0)+1,root_value,supersedes_value,input,public.equipment_digest(input),state_value,public.equipment_digest(state_value),request_hash);
 result:=jsonb_build_object('data',jsonb_build_object('eventId',event_value,'revision',COALESCE(ledger.revision,0)+1,'digest',public.equipment_digest(state_value),
 'availability',state_value->>'availability','advisoryOnly',TRUE),'replayed',FALSE);
 INSERT INTO public.canonical_equipment_receipts(organization_id,actor_user_id,session_id,key_hash,request_digest,action,subject_id,response)
 VALUES(org,actor,session_value,key_hash_value,request_hash,'operation',event_value,result);
 RETURN result;
END $$;

DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['canonical_equipment_universal_versions','canonical_equipment_receipts',
 'canonical_equipment_draft_history','canonical_equipment_asset_versions','canonical_equipment_events'] LOOP
 EXECUTE format('CREATE TRIGGER equipment_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.equipment_immutable()',t);
 END LOOP;
END $$;

-- Reuse the released supporting-authority snapshot fence. Existing asset writes
-- and reviewed universal imports now participate; no old migration is changed.
CREATE TRIGGER equipment_asset_authority BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tenant_assets
FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_material_supporting_authority_write_lock();
CREATE TRIGGER equipment_universal_authority BEFORE INSERT ON public.canonical_equipment_universal_versions
FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_material_supporting_authority_write_lock();

CREATE FUNCTION public.equipment_import_reviewed(document_value JSONB, expected_predecessor UUID,
 reviewer_reference_value TEXT, review_evidence_digest_value TEXT, reason_value TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE identity_value JSONB; configuration_hash TEXT; latest public.canonical_equipment_universal_versions%ROWTYPE;
 result public.canonical_equipment_universal_versions%ROWTYPE; item JSONB; field TEXT; n INTEGER:=0;
BEGIN
 -- Authenticated database owner is the bounded NorthStar-controlled offline
 -- import principal. No tenant role, GUC or SECURITY DEFINER caller can grant it.
 IF session_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN
 RAISE EXCEPTION 'NorthStar reviewed import authority required' USING ERRCODE='42501'; END IF;
 IF NOT public.equipment_keys(document_value,ARRAY['schemaVersion','identity','category','categoryLabel','specifications','sources','confidence','reviewedAt','freshUntil','state'],
 ARRAY['schemaVersion','identity','category','categoryLabel','specifications','sources','confidence','reviewedAt','freshUntil','state'])
 OR document_value->>'schemaVersion'<>'1' OR document_value->>'state' NOT IN ('approved','conflict','revoked')
 OR document_value->>'confidence' NOT IN ('high','medium','low')
 OR document_value->>'category' NOT IN ('vehicle','equipment','tool','trailer','attachment','other')
 OR NOT public.equipment_text(document_value->>'categoryLabel',80) OR document_value->>'categoryLabel'=''
 OR NOT public.equipment_types(document_value,'{"schemaVersion":"number","identity":"object","category":"string","categoryLabel":"string","specifications":"array","sources":"array","confidence":"string","reviewedAt":"string","freshUntil":"string","state":"string"}')
 THEN RAISE EXCEPTION 'Invalid reviewed equipment research' USING ERRCODE='22023'; END IF;
 identity_value:=document_value->'identity';
 IF NOT public.equipment_keys(identity_value,ARRAY['manufacturer','model','modelYear','series','engine','configuration'],ARRAY['manufacturer','model','modelYear','series','engine','configuration']) THEN
 RAISE EXCEPTION 'Exact configuration required' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['manufacturer','model','modelYear','series','engine','configuration'] LOOP
 IF jsonb_typeof(identity_value->field)<>'string' OR NOT public.equipment_text(identity_value->>field,500)
 OR lower(identity_value->>field) IN ('','unknown','truck','trailer','equipment','machine','machinery','vehicle') THEN
 RAISE EXCEPTION 'Exact configuration required' USING ERRCODE='22023'; END IF; END LOOP;
 IF identity_value->>'modelYear' !~ '^(18|19|20|21|22|23|24|25|26|27|28|29|30)[0-9]{2}$'
 OR NOT isfinite((document_value->>'reviewedAt')::timestamptz) OR NOT isfinite((document_value->>'freshUntil')::timestamptz)
 OR (document_value->>'reviewedAt')::timestamptz>clock_timestamp()
 OR (document_value->>'freshUntil')::timestamptz<=(document_value->>'reviewedAt')::timestamptz
 OR (document_value->>'freshUntil')::timestamptz>(document_value->>'reviewedAt')::timestamptz+INTERVAL '366 days'
 OR jsonb_typeof(document_value->'sources')<>'array' OR jsonb_array_length(document_value->'sources') NOT BETWEEN 1 AND 12
 OR jsonb_typeof(document_value->'specifications')<>'array' OR jsonb_array_length(document_value->'specifications')>48 THEN
 RAISE EXCEPTION 'Invalid research provenance' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(document_value->'sources') LOOP
 n:=n+1;
 IF NOT public.equipment_keys(item,ARRAY['url','title','publisher','sourceVersion','documentDigest','accessedAt'],ARRAY['url','title','publisher','sourceVersion','documentDigest','accessedAt'])
 OR NOT public.equipment_types(item,'{"url":"string","title":"string","publisher":"string","sourceVersion":"string","documentDigest":"string","accessedAt":"string"}')
 OR item->>'url' !~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/[^?#[:space:]@]*$'
 OR NOT public.equipment_text(item->>'url',1500) OR NOT public.equipment_text(item->>'title',240)
 OR NOT public.equipment_text(item->>'publisher',160) OR NOT public.equipment_text(item->>'sourceVersion',120)
 OR item->>'documentDigest' !~ '^[0-9a-f]{64}$'
 OR item->>'title'='' OR item->>'publisher'='' OR item->>'sourceVersion'=''
 OR NOT isfinite((item->>'accessedAt')::timestamptz)
 OR (item->>'accessedAt')::timestamptz>(document_value->>'reviewedAt')::timestamptz
 OR (item->>'accessedAt')::timestamptz>clock_timestamp() THEN
 RAISE EXCEPTION 'Invalid research source' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(document_value->'specifications') LOOP
 IF NOT public.equipment_keys(item,ARRAY['name','value','unit','sourceOrdinal'],ARRAY['name','value','unit','sourceOrdinal'])
 OR NOT public.equipment_types(item,'{"name":"string","value":"string","unit":"string","sourceOrdinal":"number"}')
 OR NOT public.equipment_text(item->>'name',120) OR NOT public.equipment_text(item->>'value',240)
 OR item->>'name'='' OR item->>'value'=''
 OR NOT public.equipment_text(item->>'unit',80) OR item->>'sourceOrdinal' !~ '^[1-9][0-9]?$' OR (item->>'sourceOrdinal')::integer NOT BETWEEN 1 AND n THEN
 RAISE EXCEPTION 'Invalid cited specification' USING ERRCODE='22023'; END IF;
 END LOOP;
 configuration_hash:=public.equipment_digest(identity_value);
 PERFORM pg_advisory_xact_lock(hashtextextended('equipment-import:'||configuration_hash,0));
 SELECT * INTO latest FROM public.canonical_equipment_universal_versions WHERE configuration_digest=configuration_hash ORDER BY version DESC LIMIT 1;
 IF latest.id IS DISTINCT FROM expected_predecessor THEN RAISE EXCEPTION 'Research predecessor changed' USING ERRCODE='40001'; END IF;
 INSERT INTO public.canonical_equipment_universal_versions(configuration_digest,version,document,digest,predecessor_id,imported_by,reviewer_reference,review_evidence_digest,reason)
 VALUES(configuration_hash,COALESCE(latest.version,0)+1,document_value,public.equipment_digest(document_value),expected_predecessor,session_user,reviewer_reference_value,review_evidence_digest_value,reason_value)
 RETURNING * INTO result;
 RETURN jsonb_build_object('id',result.id,'version',result.version,'digest',result.digest);
END $$;

CREATE FUNCTION public.equipment_research(fields JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE found_version public.canonical_equipment_universal_versions%ROWTYPE;
BEGIN
 SELECT * INTO found_version FROM public.canonical_equipment_universal_versions
 WHERE configuration_digest=public.equipment_digest(public.equipment_identity(fields)) ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','needs_review','reason','missing_or_configuration_different','versionId',NULL,'digest',NULL,'category','other','categoryLabel','Needs review'); END IF;
 -- An actual tenant attachment inventory is private and never imported. A
 -- matching base vehicle alone cannot establish the attachment configuration.
 -- Only an explicitly cited public configuration assertion can cover it.
 IF fields->>'attachments' IS DISTINCT FROM 'none' AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(found_version.document->'specifications') specification
 WHERE specification->>'name'='reviewed_attachment_configuration' AND specification->>'value'=fields->>'attachments') THEN
 RETURN jsonb_build_object('state','needs_review','reason','attachment_configuration_unreviewed','versionId',NULL,'digest',NULL,'category','other','categoryLabel','Needs review'); END IF;
 RETURN jsonb_build_object('state',CASE WHEN found_version.document->>'state'='approved'
 AND found_version.document->>'confidence' IN ('high','medium')
 AND (found_version.document->>'freshUntil')::timestamptz>statement_timestamp() THEN 'reviewed' ELSE 'needs_review' END,
 'reason',CASE WHEN found_version.document->>'state'<>'approved' THEN found_version.document->>'state'
 WHEN (found_version.document->>'freshUntil')::timestamptz<=statement_timestamp() THEN 'stale'
 WHEN found_version.document->>'confidence'='low' THEN 'low_confidence' ELSE 'exact_reviewed_sources' END,
 'versionId',found_version.id,'version',found_version.version,'digest',found_version.digest,
 'category',found_version.document->>'category','categoryLabel',found_version.document->>'categoryLabel',
 'sources',found_version.document->'sources','confidence',found_version.document->>'confidence',
 'freshUntil',found_version.document->>'freshUntil','specifications',found_version.document->'specifications');
END $$;

CREATE FUNCTION public.equipment_actor(org UUID, actor UUID, role_value TEXT, session_value UUID, csrf TEXT, mutation BOOLEAN, manager BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE a JSONB; BEGIN
 PERFORM public.canonical_material_supporting_authority_read_lock();
 a:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,mutation);
 IF manager AND a->>'accessRole' NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Equipment management is unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_demo_authority WHERE organization_id=org) THEN
 RAISE EXCEPTION 'Paid equipment authority required' USING ERRCODE='42501'; END IF;
 RETURN a;
END $$;

CREATE FUNCTION public.equipment_draft_projection(row_value public.canonical_equipment_drafts) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',row_value.id,'revision',row_value.revision,'digest',row_value.digest,
 'expiresAt',row_value.expires_at,'document',row_value.document)
$$;

CREATE FUNCTION public.equipment_draft_mutate(org UUID, actor UUID, role_value TEXT, session_value UUID, csrf TEXT,
 draft_value UUID, key_value TEXT, input JSONB, suggested JSONB DEFAULT '{}', admission BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a JSONB; d public.canonical_equipment_drafts%ROWTYPE; receipt public.canonical_equipment_receipts%ROWTYPE;
 fields JSONB; doc JSONB; research JSONB; action_value TEXT; field TEXT; next_field TEXT; key_hash_value TEXT;
 request_hash TEXT; result JSONB; asset_value UUID; asset_record public.tenant_assets%ROWTYPE; snapshot JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value IS NULL OR key_value !~ '^[!-~]{16,128}$'
 OR input IS NULL THEN RAISE EXCEPTION 'Equipment request boundary required' USING ERRCODE='22023'; END IF;
 a:=public.equipment_actor(org,actor,role_value,session_value,csrf,TRUE,TRUE);
 action_value:=CASE WHEN draft_value IS NULL THEN 'create' ELSE input->>'action' END;
 IF admission IS NULL OR (admission AND draft_value IS NOT NULL) OR (draft_value IS NOT NULL AND suggested<>'{}') THEN RAISE EXCEPTION 'Invalid draft admission' USING ERRCODE='22023'; END IF;
 request_hash:=public.equipment_digest(jsonb_build_object('draft',draft_value,'input',input));
 key_hash_value:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':equipment-drafts',0));
 SELECT * INTO receipt FROM public.canonical_equipment_receipts
 WHERE organization_id=org AND actor_user_id=actor AND session_id=session_value AND key_hash=key_hash_value;
 IF FOUND THEN
 IF receipt.request_digest<>request_hash THEN RAISE EXCEPTION 'Equipment idempotency conflict' USING ERRCODE='23505'; END IF;
 SELECT * INTO d FROM public.canonical_equipment_drafts WHERE organization_id=org AND id=receipt.subject_id;
 IF d.actor_user_id<>actor OR d.session_id<>session_value OR d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Draft authority unavailable' USING ERRCODE='42501'; END IF;
 IF public.equipment_research(d.document->'identifiers') IS DISTINCT FROM d.document->'research' AND d.document->>'state'<>'cancelled' THEN
 RAISE EXCEPTION 'Research changed; review again' USING ERRCODE='40001'; END IF;
 IF d.document->>'state'='saved' THEN
 SELECT * INTO asset_record FROM public.tenant_assets WHERE organization_id=org AND id=(d.document->>'assetId')::uuid FOR SHARE;
 IF NOT FOUND OR asset_record.catalogue_state<>'active' OR asset_record.version<>(d.document->>'assetVersion')::integer THEN RAISE EXCEPTION 'Saved asset changed' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN receipt.response||jsonb_build_object('replayed',TRUE);
 END IF;
 IF action_value='create' THEN
 IF NOT public.equipment_keys(input,ARRAY['entryPath','message','identifiers','useContext','target'],ARRAY['entryPath','message','identifiers','useContext'])
 OR NOT public.equipment_types(input,'{"entryPath":"string","message":"string","identifiers":"object","useContext":"string"}')
 OR input->>'entryPath' NOT IN ('business_profile','polaris') OR NOT public.equipment_text(input->>'message',1500)
 OR NOT public.equipment_text(input->>'useContext',500) THEN RAISE EXCEPTION 'Invalid asset draft' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.canonical_equipment_drafts WHERE organization_id=org AND actor_user_id=actor AND expires_at>clock_timestamp() AND document->>'state' IN ('clarifying','review'))>=20 THEN
 RAISE EXCEPTION 'Too many current equipment drafts' USING ERRCODE='54000'; END IF;
 fields:=input->'identifiers';
 IF NOT public.equipment_keys(suggested,ARRAY['manufacturer','model','modelYear','series','engine','configuration'],ARRAY[]::text[]) THEN
 RAISE EXCEPTION 'Invalid literal identifier assistance' USING ERRCODE='22023'; END IF;
 FOR field IN SELECT jsonb_object_keys(suggested) LOOP
 IF jsonb_typeof(suggested->field)<>'string' OR suggested->>field='' OR position(suggested->>field IN input->>'message')=0 THEN
 RAISE EXCEPTION 'Identifier assistance must be literal user evidence' USING ERRCODE='22023'; END IF; END LOOP;
 fields:=suggested||fields;
 doc:=jsonb_build_object('entryPath',input->>'entryPath','message',input->>'message','useContext',input->>'useContext','identifiers',fields);
 IF input ? 'target' THEN
 IF NOT public.equipment_keys(input->'target',ARRAY['assetId','version','digest'],ARRAY['assetId','version','digest'])
 OR NOT public.equipment_types(input->'target','{"assetId":"string","version":"number","digest":"string"}') THEN RAISE EXCEPTION 'Exact asset review target required' USING ERRCODE='22023'; END IF;
 SELECT * INTO asset_record FROM public.tenant_assets WHERE organization_id=org AND id=(input->'target'->>'assetId')::uuid FOR SHARE;
 IF NOT FOUND OR asset_record.catalogue_state<>'active' THEN RAISE EXCEPTION 'Review target unavailable' USING ERRCODE='42501'; END IF;
 IF asset_record.version<>(input->'target'->>'version')::integer OR public.equipment_digest(to_jsonb(asset_record))<>input->'target'->>'digest' THEN RAISE EXCEPTION 'Review target changed' USING ERRCODE='40001'; END IF;
 doc:=doc||jsonb_build_object('target',input->'target');
 END IF;
 IF admission THEN RETURN jsonb_build_object('admitted',TRUE); END IF;
 ELSE
 IF NOT public.equipment_keys(input,ARRAY['action','expectedRevision','expectedDigest','answer','confirmation'],ARRAY['action','expectedRevision','expectedDigest'])
 OR NOT public.equipment_types(input,'{"action":"string","expectedRevision":"number","expectedDigest":"string"}')
 OR action_value NOT IN ('answer','confirm','cancel') OR input->>'expectedRevision' IS NULL OR input->>'expectedDigest' IS NULL THEN
 RAISE EXCEPTION 'Invalid draft action' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.canonical_equipment_drafts WHERE organization_id=org AND id=draft_value FOR UPDATE;
 IF NOT FOUND OR d.actor_user_id<>actor OR d.session_id<>session_value OR d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='42501'; END IF;
 IF d.revision<>(input->>'expectedRevision')::integer OR d.digest<>input->>'expectedDigest' THEN RAISE EXCEPTION 'Draft changed' USING ERRCODE='40001'; END IF;
 IF d.document->>'state' NOT IN ('clarifying','review') THEN RAISE EXCEPTION 'Draft is terminal' USING ERRCODE='40001'; END IF;
 doc:=d.document; fields:=doc->'identifiers';
 IF action_value='answer' THEN
 next_field:=doc->>'nextField';
 IF next_field IS NULL OR NOT public.equipment_text(input->>'answer',500) OR input->>'answer'='' OR input ? 'confirmation' THEN RAISE EXCEPTION 'Invalid clarification' USING ERRCODE='22023'; END IF;
 fields:=fields||jsonb_build_object(next_field,input->>'answer');
 ELSIF action_value='cancel' THEN
 IF input ? 'answer' OR input ? 'confirmation' THEN RAISE EXCEPTION 'Invalid cancellation' USING ERRCODE='22023'; END IF;
 doc:=doc||jsonb_build_object('state','cancelled');
 ELSIF input->>'confirmation' IS DISTINCT FROM 'save_reviewed_asset' OR input ? 'answer' OR doc->>'state'<>'review' THEN
 RAISE EXCEPTION 'Explicit reviewed confirmation required' USING ERRCODE='22023';
 END IF;
 END IF;
 IF NOT public.equipment_keys(fields,ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments','accessType'],ARRAY[]::text[]) THEN
 RAISE EXCEPTION 'Invalid identifiers' USING ERRCODE='22023'; END IF;
 next_field:=NULL;
 FOREACH field IN ARRAY ARRAY['manufacturer','model','modelYear','series','engine','configuration','attachments','accessType'] LOOP
 IF NOT fields ? field THEN IF next_field IS NULL THEN next_field:=field; END IF;
 ELSIF jsonb_typeof(fields->field)<>'string' OR NOT public.equipment_text(fields->>field,CASE WHEN field IN ('configuration','attachments') THEN 500 ELSE 120 END) OR fields->>field='' THEN
 RAISE EXCEPTION 'Invalid identifier value' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF fields ? 'modelYear' AND fields->>'modelYear'<>'unknown' AND fields->>'modelYear' !~ '^(18|19|20|21|22|23|24|25|26|27|28|29|30)[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid year' USING ERRCODE='22023'; END IF;
 IF fields ? 'accessType' AND fields->>'accessType' NOT IN ('owned','leased','rented','borrowed','unknown') THEN RAISE EXCEPTION 'Invalid access type' USING ERRCODE='22023'; END IF;
 IF action_value<>'cancel' THEN
 research:=public.equipment_research(fields);
 doc:=doc||jsonb_build_object('identifiers',fields,'nextField',next_field,'state',CASE WHEN next_field IS NULL THEN 'review' ELSE 'clarifying' END,'research',research);
 END IF;
 IF action_value='confirm' THEN
 IF next_field IS NOT NULL OR lower(fields->>'manufacturer') IN ('unknown','truck','trailer','equipment','machine','vehicle')
 OR lower(fields->>'model') IN ('unknown','truck','trailer','equipment','machine','vehicle') THEN RAISE EXCEPTION 'Exact manufacturer and model required' USING ERRCODE='22023'; END IF;
 IF research IS DISTINCT FROM d.document->'research' THEN RAISE EXCEPTION 'Research changed; review again' USING ERRCODE='40001'; END IF;
 IF doc ? 'target' THEN
 asset_value:=(doc->'target'->>'assetId')::uuid;
 SELECT * INTO asset_record FROM public.tenant_assets WHERE organization_id=org AND id=asset_value FOR UPDATE;
 IF NOT FOUND OR asset_record.catalogue_state<>'active' THEN RAISE EXCEPTION 'Review target unavailable' USING ERRCODE='42501'; END IF;
 IF asset_record.version<>(doc->'target'->>'version')::integer OR public.equipment_digest(to_jsonb(asset_record))<>doc->'target'->>'digest' THEN RAISE EXCEPTION 'Review target changed' USING ERRCODE='40001'; END IF;
 UPDATE public.tenant_assets SET category=CASE WHEN research->>'state'='reviewed' THEN research->>'category' ELSE 'other' END,
 name=left(concat_ws(' ',NULLIF(fields->>'modelYear','unknown'),fields->>'manufacturer',fields->>'model'),120),
 manufacturer=fields->>'manufacturer',model=fields->>'model',model_year=CASE WHEN fields->>'modelYear'='unknown' THEN NULL ELSE (fields->>'modelYear')::integer END,
 configuration=fields->>'configuration',updated_by_user_id=actor,updated_at=clock_timestamp(),version=version+1
 WHERE organization_id=org AND id=asset_value RETURNING * INTO asset_record;
 ELSE
 IF (SELECT count(*) FROM public.tenant_assets WHERE organization_id=org)>=500 THEN RAISE EXCEPTION 'Catalogue bound reached' USING ERRCODE='54000'; END IF;
 asset_value:=gen_random_uuid();
 INSERT INTO public.tenant_assets(id,organization_id,category,name,manufacturer,model,model_year,configuration,created_by_user_id,updated_by_user_id)
 VALUES(asset_value,org,CASE WHEN research->>'state'='reviewed' THEN research->>'category' ELSE 'other' END,
 left(concat_ws(' ',NULLIF(fields->>'modelYear','unknown'),fields->>'manufacturer',fields->>'model'),120),
 fields->>'manufacturer',fields->>'model',CASE WHEN fields->>'modelYear'='unknown' THEN NULL ELSE (fields->>'modelYear')::integer END,
 fields->>'configuration',actor,actor) RETURNING * INTO asset_record;
 END IF;
 snapshot:=to_jsonb(asset_record);
 INSERT INTO public.tenant_asset_audit_events(organization_id,actor_user_id,action,subject_id,details)
 VALUES(org,actor,CASE WHEN doc ? 'target' THEN 'asset_updated' ELSE 'asset_created' END,asset_value,jsonb_build_object('version',asset_record.version,'reviewedDraft',COALESCE(d.id,draft_value),'researchState',research->>'state'));
 doc:=doc||jsonb_build_object('state','saved','assetId',asset_value,'assetVersion',asset_record.version);
 END IF;
 IF action_value='create' THEN
 INSERT INTO public.canonical_equipment_drafts(organization_id,actor_user_id,session_id,revision,document,digest)
 VALUES(org,actor,session_value,1,doc,public.equipment_digest(doc)) RETURNING * INTO d;
 ELSE UPDATE public.canonical_equipment_drafts SET revision=revision+1,document=doc,digest=public.equipment_digest(doc)
 WHERE organization_id=org AND id=draft_value RETURNING * INTO d; END IF;
 INSERT INTO public.canonical_equipment_draft_history(organization_id,draft_id,revision,document,digest,actor_user_id,session_id,action,request_digest)
 VALUES(org,d.id,d.revision,d.document,d.digest,actor,session_value,action_value,request_hash);
 IF action_value='confirm' THEN
 INSERT INTO public.canonical_equipment_asset_versions(organization_id,asset_id,asset_version,asset_snapshot,asset_digest,private_configuration,knowledge_version_id,knowledge_digest,category_label,review_state,draft_id,draft_revision,actor_user_id)
 VALUES(org,asset_value,asset_record.version,snapshot,public.equipment_digest(snapshot),fields||jsonb_build_object('useContext',COALESCE(NULLIF(doc->>'useContext',''),doc->>'message')),
 (research->>'versionId')::uuid,research->>'digest',CASE WHEN research->>'state'='reviewed' THEN research->>'categoryLabel' ELSE 'Needs review' END,research->>'state',d.id,d.revision,actor);
 END IF;
 result:=jsonb_build_object('data',public.equipment_draft_projection(d),'replayed',FALSE);
 INSERT INTO public.canonical_equipment_receipts(organization_id,actor_user_id,session_id,key_hash,request_digest,action,subject_id,response)
 VALUES(org,actor,session_value,key_hash_value,request_hash,action_value,d.id,result);
 RETURN result;
END $$;

CREATE FUNCTION public.equipment_read(org UUID, actor UUID, role_value TEXT, session_value UUID, draft_value UUID, execution_value UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a JSONB; d public.canonical_equipment_drafts%ROWTYPE; result JSONB; total_value INTEGER; execution_record public.canonical_field_executions%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN RAISE EXCEPTION 'Equipment snapshot required' USING ERRCODE='22023'; END IF;
 a:=public.equipment_actor(org,actor,role_value,session_value,NULL,FALSE,draft_value IS NOT NULL);
 IF draft_value IS NOT NULL THEN
 SELECT * INTO d FROM public.canonical_equipment_drafts WHERE organization_id=org AND id=draft_value AND actor_user_id=actor AND session_id=session_value;
 IF NOT FOUND OR d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 IF d.document->>'state'<>'cancelled' AND public.equipment_research(d.document->'identifiers') IS DISTINCT FROM d.document->'research' THEN
 RAISE EXCEPTION 'Research changed; review again' USING ERRCODE='40001'; END IF;
 RETURN public.equipment_draft_projection(d);
 END IF;
 IF execution_value IS NOT NULL THEN
 SELECT * INTO execution_record FROM public.canonical_field_executions WHERE organization_id=org AND id=execution_value;
 IF NOT FOUND OR NOT public.canonical_field_execution_replay_authorized(org,role_value,(a->>'profileId')::uuid,execution_value,NULL)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_transcripts WHERE organization_id=org AND operation_id=execution_record.operation_id AND graph_id=execution_record.graph_id
 AND public.canonical_labor_transcript_source_normalized(source) IN ('lead','retell','voice')) THEN RAISE EXCEPTION 'Execution unavailable' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO total_value FROM public.canonical_equipment_events WHERE organization_id=org AND execution_id=execution_value;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'document',document,'digest',digest,'recordedAt',recorded_at,
 'recordedBy',actor_user_id,'performedBy',performer_profile_id,'rootId',root_id,'supersedesId',supersedes_id) ORDER BY revision DESC),'[]') INTO result
 FROM (SELECT * FROM public.canonical_equipment_events WHERE organization_id=org AND execution_id=execution_value ORDER BY revision DESC,id LIMIT 200) selected;
 RETURN jsonb_build_object('events',result,'total',total_value,'returned',jsonb_array_length(result),'truncated',total_value>jsonb_array_length(result));
 END IF;
 SELECT count(*) INTO total_value FROM public.tenant_assets WHERE organization_id=org;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',asset.id,'name',asset.name,'manufacturer',asset.manufacturer,'model',asset.model,'modelYear',asset.model_year,
 'catalogueState',asset.catalogue_state,'version',asset.version,'category',asset.category,
 'categoryLabel',CASE WHEN pin.asset_id IS NULL OR pin.review_state<>'reviewed' OR pin.asset_digest<>public.equipment_digest(to_jsonb(asset)) OR research.value->>'state'<>'reviewed'
 OR research.value->>'versionId' IS DISTINCT FROM pin.knowledge_version_id::text THEN 'Needs review' ELSE pin.category_label END,
 'reviewState',CASE WHEN pin.asset_id IS NOT NULL AND pin.review_state='reviewed' AND pin.asset_digest=public.equipment_digest(to_jsonb(asset)) AND research.value->>'state'='reviewed'
 AND research.value->>'versionId'=pin.knowledge_version_id::text THEN 'reviewed' ELSE 'needs_review' END,
 'assetDigest',public.equipment_digest(to_jsonb(asset)),'knowledgeVersionId',pin.knowledge_version_id,'knowledgeDigest',pin.knowledge_digest,
 'research',research.value,'privateConfiguration',pin.private_configuration,
 'operationRevision',COALESCE(ledger.revision,0),'operationDigest',ledger.digest,
 'availability',CASE WHEN pin.asset_id IS NULL OR pin.review_state<>'reviewed' OR pin.asset_digest<>public.equipment_digest(to_jsonb(asset))
 OR research.value->>'state' IS DISTINCT FROM 'reviewed' OR research.value->>'versionId' IS DISTINCT FROM pin.knowledge_version_id::text THEN 'needs_review' ELSE COALESCE(ledger.state->>'availability','unknown') END,
 'recordedAvailability',COALESCE(ledger.state->>'availability','unknown')) ORDER BY lower(asset.name),asset.id),'[]')
 INTO result FROM (SELECT * FROM public.tenant_assets WHERE organization_id=org ORDER BY lower(name),id LIMIT 500) asset
 LEFT JOIN public.canonical_equipment_asset_versions pin ON pin.organization_id=asset.organization_id AND pin.asset_id=asset.id AND pin.asset_version=asset.version
 LEFT JOIN public.canonical_equipment_ledgers ledger ON ledger.organization_id=asset.organization_id AND ledger.asset_id=asset.id
 LEFT JOIN LATERAL (SELECT public.equipment_research(pin.private_configuration) AS value WHERE pin.asset_id IS NOT NULL) research ON TRUE;
 RETURN jsonb_build_object('assets',result,'total',total_value,'returned',jsonb_array_length(result),'truncated',total_value>jsonb_array_length(result),
 'canManage',role_value IN ('owner','admin'),'authority','postgresql');
END $$;

CREATE FUNCTION public.equipment_complete() RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='canonical_equipment_drafts' THEN
 IF NOT EXISTS(SELECT 1 FROM public.canonical_equipment_draft_history h WHERE h.organization_id=NEW.organization_id AND h.draft_id=NEW.id
 AND h.revision=NEW.revision AND h.document=NEW.document AND h.digest=NEW.digest AND h.actor_user_id=NEW.actor_user_id AND h.session_id=NEW.session_id
 AND EXISTS(SELECT 1 FROM public.canonical_equipment_receipts r WHERE r.organization_id=h.organization_id AND r.subject_id=h.draft_id
 AND r.request_digest=h.request_digest AND r.actor_user_id=h.actor_user_id AND r.session_id=h.session_id AND (r.response->'data'->>'revision')::integer=h.revision)) THEN
 RAISE EXCEPTION 'Draft audit evidence incomplete' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.canonical_equipment_draft_history WHERE organization_id=NEW.organization_id AND draft_id=NEW.id AND revision<=NEW.revision)<>NEW.revision THEN
 RAISE EXCEPTION 'Draft history gap' USING ERRCODE='23514'; END IF;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events e WHERE e.organization_id=NEW.organization_id AND e.asset_id=NEW.asset_id AND e.revision=NEW.revision
 AND e.state=NEW.state AND e.state_digest=NEW.digest
 AND EXISTS(SELECT 1 FROM public.canonical_equipment_receipts r WHERE r.organization_id=e.organization_id AND r.subject_id=e.id AND r.request_digest=e.request_digest
 AND r.actor_user_id=e.actor_user_id AND r.session_id=e.session_id AND r.action='operation')) THEN RAISE EXCEPTION 'Operation audit evidence incomplete' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.canonical_equipment_events WHERE organization_id=NEW.organization_id AND asset_id=NEW.asset_id AND revision<=NEW.revision)<>NEW.revision THEN
 RAISE EXCEPTION 'Operation history gap' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER equipment_draft_complete AFTER INSERT OR UPDATE ON public.canonical_equipment_drafts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.equipment_complete();
CREATE CONSTRAINT TRIGGER equipment_ledger_complete AFTER INSERT OR UPDATE ON public.canonical_equipment_ledgers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.equipment_complete();
CREATE TRIGGER equipment_draft_no_delete BEFORE DELETE OR TRUNCATE ON public.canonical_equipment_drafts FOR EACH STATEMENT EXECUTE FUNCTION public.equipment_immutable();
CREATE TRIGGER equipment_ledger_no_delete BEFORE DELETE OR TRUNCATE ON public.canonical_equipment_ledgers FOR EACH STATEMENT EXECUTE FUNCTION public.equipment_immutable();

DO $$ DECLARE t RECORD; BEGIN
 FOR t IN SELECT oid::regclass AS identity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'canonical_equipment_%' AND relkind='r' LOOP
 EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC',t.identity); END LOOP;
 FOR t IN SELECT oid::regprocedure AS identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'equipment_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',t.identity); END LOOP;
END $$;
