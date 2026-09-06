-- Mission 23 Part 7: operational progress, blockers, exceptions and field change facts.
-- Additive to 001-047. No completion/reopening, rendered UI, Polaris, storage,
-- scheduling, commercial approval, customer contact or authority to continue.

CREATE FUNCTION public.canonical_progress_text_valid(value TEXT, maximum INTEGER DEFAULT 1000)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cp INTEGER;
BEGIN
 IF value IS NULL OR value='' OR value<>regexp_replace(value,'^[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$','','g') OR value<>normalize(value,NFC) OR char_length(value)>maximum OR octet_length(value)>maximum*4
 OR value~'[<>]' OR value~*'(https?://|data:|javascript:|www\.)' THEN RETURN FALSE; END IF;
 FOR cp IN SELECT ascii(c) FROM regexp_split_to_table(value,'') c LOOP
  IF cp BETWEEN 0 AND 31 OR cp BETWEEN 127 AND 159 OR cp IN(173,847,1564,6158,10240,12644,65440,65533) OR cp BETWEEN 4447 AND 4448 OR cp BETWEEN 6068 AND 6069 OR cp BETWEEN 55296 AND 57343 OR cp BETWEEN 8203 AND 8207 OR cp BETWEEN 8232 AND 8238
  OR cp BETWEEN 8288 AND 8303 OR cp=65279 OR cp BETWEEN 65529 AND 65532 OR cp BETWEEN 917504 AND 917631 THEN RETURN FALSE; END IF;
 END LOOP; RETURN TRUE;
END $$;
CREATE FUNCTION public.canonical_progress_json_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE child JSONB; name TEXT;
BEGIN
 IF value IS NULL OR octet_length(value::text)>16000 THEN RETURN FALSE; END IF;
 IF jsonb_typeof(value)='string' THEN RETURN public.canonical_progress_text_valid(value#>>'{}',1000); END IF;
 IF jsonb_typeof(value)='array' THEN FOR child IN SELECT v FROM jsonb_array_elements(value) v LOOP IF NOT public.canonical_progress_json_valid(child) THEN RETURN FALSE; END IF; END LOOP; END IF;
 IF jsonb_typeof(value)='object' THEN FOR name,child IN SELECT key,val FROM jsonb_each(value) e(key,val) LOOP
  IF NOT public.canonical_progress_text_valid(name,64) OR NOT public.canonical_progress_json_valid(child) THEN RETURN FALSE; END IF; END LOOP; END IF;
 RETURN TRUE;
END $$;
CREATE FUNCTION public.canonical_progress_pin_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (public.canonical_field_evidence_object_keys_exact(value,ARRAY['id','revision','digest'])
 AND public.canonical_field_evidence_uuid_valid(value->>'id') AND jsonb_typeof(value->'revision')='number'
 AND value->>'revision'~'^[1-9][0-9]{0,14}$' AND value->>'digest'~'^[0-9a-f]{64}$') IS TRUE
$$;
CREATE FUNCTION public.canonical_progress_pins_valid(value JSONB, required BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p JSONB;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
 IF jsonb_array_length(value)>20 OR required AND jsonb_array_length(value)=0 THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(value) v)<>jsonb_array_length(value) THEN RETURN FALSE; END IF;
 FOR p IN SELECT v FROM jsonb_array_elements(value) v LOOP IF NOT public.canonical_progress_pin_valid(p) THEN RETURN FALSE; END IF; END LOOP; RETURN TRUE;
END $$;
CREATE FUNCTION public.canonical_progress_instant_valid(value TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RETURN (value~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
 AND isfinite(value::timestamptz) AND value !~ 'T24:|:60([.]|Z|[+-])') IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION public.canonical_progress_resolution_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (value='null'::jsonb OR (public.canonical_field_evidence_object_keys_exact(value,ARRAY['description','observedAt','evidence'])
 AND public.canonical_progress_text_valid(value->>'description') AND public.canonical_progress_instant_valid(value->>'observedAt')
 AND public.canonical_progress_pins_valid(value->'evidence',TRUE))) IS TRUE
$$;
CREATE FUNCTION public.canonical_progress_full_document_valid(d JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fields TEXT[]:=ARRAY['kind','description','observedAt','timeZoneAuthority','evidence','contractVersion','reviewState']; z JSONB; q JSONB; m JSONB; valid BOOLEAN;
BEGIN
 IF public.canonical_progress_json_valid(d) IS NOT TRUE THEN RETURN FALSE; END IF;
 z:=d->'timeZoneAuthority';
 valid:= d->>'contractVersion'='m23-progress-facts-v1' AND d->>'reviewState' IN ('needs_review','owner_confirmed','worker_acknowledged','disputed')
 AND public.canonical_progress_text_valid(d->>'description') AND public.canonical_progress_instant_valid(d->>'observedAt')
 AND public.canonical_progress_pins_valid(d->'evidence')
 AND public.canonical_field_evidence_object_keys_exact(z,ARRAY['businessProfileId','version','hash','timeZone'])
 AND public.canonical_field_evidence_uuid_valid(z->>'businessProfileId') AND jsonb_typeof(z->'version')='number'
 AND z->>'version'~'^[1-9][0-9]{0,14}$' AND z->>'hash'~'^[0-9a-f]{64}$' AND public.canonical_progress_text_valid(z->>'timeZone',100);
 IF d->>'kind'='progress' THEN
  fields:=fields||ARRAY['workKey','quantity','milestone','uncertainty','uncertaintyReason'];q:=d->'quantity';m:=d->'milestone';
  valid:=valid AND d->>'workKey'~'^[a-z0-9][a-z0-9._:-]{0,63}$'
   AND d->>'uncertainty' IN ('measured','estimated','unknown')
   AND (d->'uncertaintyReason'='null'::jsonb OR public.canonical_progress_text_valid(d->>'uncertaintyReason'))
   AND (d->>'uncertainty'='measured' OR d->'uncertaintyReason'<>'null'::jsonb)
   AND NOT(q='null'::jsonb AND m='null'::jsonb)
   AND (d->>'uncertainty'<>'unknown' OR (q='null'::jsonb AND m->>'state'='unavailable'));
  IF q<>'null'::jsonb THEN
   IF (public.canonical_field_evidence_object_keys_exact(q,ARRAY['completed','total','unit','contractVersion'])
    AND jsonb_typeof(q->'completed')='string' AND jsonb_typeof(q->'total')='string'
    AND q->>'completed'~'^(0|[1-9][0-9]{0,8})([.][0-9]{1,6})?$' AND q->>'total'~'^(0|[1-9][0-9]{0,8})([.][0-9]{1,6})?$') IS NOT TRUE THEN RETURN FALSE; END IF;
   valid:=valid AND (q->>'total')::numeric>0 AND (q->>'completed')::numeric<=(q->>'total')::numeric
    AND q->>'unit' IN ('ea','m','m2','m3','ft','ft2','ft3','yd3','kg','lb','l','gal') AND q->>'contractVersion'='m23-progress-units-v1';
  END IF;
  IF m<>'null'::jsonb THEN valid:=valid AND public.canonical_field_evidence_object_keys_exact(m,ARRAY['key','state','checklist'])
   AND public.canonical_progress_text_valid(m->>'key',64) AND m->>'state' IN ('not_started','in_progress','done','unavailable')
   AND (m->'checklist'='null'::jsonb OR public.canonical_progress_pin_valid(m->'checklist')); END IF;
 ELSIF d->>'kind' IN ('blocker','exception') THEN
  fields:=fields||ARRAY['category','impact','severity','followUp','state','resolution'];
  valid:=valid AND d->>'category' IN ('access','weather','material','equipment','scope','quality','coordination','other')
   AND d->>'impact' IN ('prevents_work','constrains_work','no_current_constraint','unknown') AND d->>'severity' IN ('low','moderate','high','unknown')
   AND public.canonical_field_evidence_object_keys_exact(d->'followUp',ARRAY['profileId','action'])
   AND public.canonical_field_evidence_uuid_valid(d->'followUp'->>'profileId') AND public.canonical_progress_text_valid(d->'followUp'->>'action')
   AND d->>'state' IN ('open','investigating','awaiting_follow_up','resolved')
   AND public.canonical_progress_resolution_valid(d->'resolution') AND ((d->>'state'='resolved')=(d->'resolution'<>'null'::jsonb));
 ELSIF d->>'kind'='field_change' THEN
  fields:=fields||ARRAY['difference','initiator','affectedWork','scheduleImplications','resourceImplications'];
  valid:=valid AND d->>'difference' IN ('requested','observed') AND public.canonical_field_evidence_object_keys_exact(d->'initiator',ARRAY['source','description'])
   AND d->'initiator'->>'source' IN ('worker','owner','customer_reported','other_reported','unknown')
   AND public.canonical_progress_text_valid(d->'initiator'->>'description') AND public.canonical_progress_text_valid(d->>'affectedWork')
   AND public.canonical_progress_text_valid(d->>'scheduleImplications') AND public.canonical_progress_text_valid(d->>'resourceImplications');
 ELSE RETURN FALSE; END IF;
 RETURN (valid AND public.canonical_field_evidence_object_keys_exact(d,fields)) IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION public.canonical_progress_document_valid(action_value TEXT,d JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF public.canonical_progress_json_valid(d) IS NOT TRUE THEN RETURN FALSE; END IF;
 IF action_value='review' THEN RETURN (public.canonical_field_evidence_object_keys_exact(d,ARRAY['outcome']) AND d->>'outcome' IN ('owner_confirmed','worker_acknowledged','disputed','needs_review')) IS TRUE; END IF;
 IF action_value='issue_state' THEN RETURN (public.canonical_field_evidence_object_keys_exact(d,ARRAY['state','resolution'])
 AND d->>'state' IN ('open','investigating','awaiting_follow_up','resolved') AND public.canonical_progress_resolution_valid(d->'resolution')
 AND ((d->>'state'='resolved')=(d->'resolution'<>'null'::jsonb))) IS TRUE; END IF;
 RETURN (public.canonical_progress_full_document_valid(d) AND d->>'reviewState'='needs_review' AND CASE action_value
 WHEN 'record_progress' THEN d->>'kind'='progress' WHEN 'update_progress' THEN d->>'kind'='progress'
 WHEN 'record_blocker' THEN d->>'kind'='blocker' AND d->>'state'='open' WHEN 'record_exception' THEN d->>'kind'='exception' AND d->>'state'='open'
 WHEN 'record_change' THEN d->>'kind'='field_change' WHEN 'correct' THEN TRUE ELSE FALSE END) IS TRUE;
END $$;

CREATE TABLE public.canonical_progress_records (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL, assignment_id UUID NOT NULL, root_id UUID NOT NULL,
  previous_record_id UUID, evidence_type TEXT NOT NULL, revision BIGINT NOT NULL,
  document JSONB NOT NULL, canonical_digest CHAR(64) NOT NULL,
  business_profile_id UUID GENERATED ALWAYS AS ((document->'timeZoneAuthority'->>'businessProfileId')::uuid) STORED,
  follow_up_profile_id UUID GENERATED ALWAYS AS ((document->'followUp'->>'profileId')::uuid) STORED,
  observed_at TIMESTAMPTZ NOT NULL,
  recorded_by_user_id UUID NOT NULL, performed_by_profile_id UUID NOT NULL, auth_session_id UUID NOT NULL,
  source_execution_revision BIGINT NOT NULL, source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL, source_assignment_digest CHAR(64) NOT NULL,
  action_code TEXT NOT NULL, reason TEXT NOT NULL, request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(), decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_progress_records_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_progress_records_root_revision UNIQUE(organization_id,root_id,revision),
  CONSTRAINT canonical_progress_records_execution_fk FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_records_assignment_fk FOREIGN KEY(organization_id,assignment_id) REFERENCES public.canonical_schedule_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_profile_fk FOREIGN KEY(organization_id,business_profile_id) REFERENCES public.canonical_business_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_follow_up_fk FOREIGN KEY(organization_id,follow_up_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_records_root_fk FOREIGN KEY(organization_id,root_id) REFERENCES public.canonical_progress_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_progress_records_previous_fk FOREIGN KEY(organization_id,previous_record_id) REFERENCES public.canonical_progress_records(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_records_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_records_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_records_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_records_type_check CHECK(evidence_type IN ('progress','blocker','exception','field_change')),
  CONSTRAINT canonical_progress_records_revision_check CHECK(revision>=1 AND ((revision=1 AND previous_record_id IS NULL AND root_id=id) OR (revision>1 AND previous_record_id IS NOT NULL AND root_id<>id))),
  CONSTRAINT canonical_progress_records_digest_check CHECK(canonical_digest~'^[0-9a-f]{64}$' AND source_execution_digest~'^[0-9a-f]{64}$' AND source_assignment_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_progress_records_source_revision_check CHECK(source_execution_revision>=1 AND source_assignment_revision>=1),
  CONSTRAINT canonical_progress_records_document_check CHECK(evidence_type=document->>'kind' AND public.canonical_progress_full_document_valid(document)),
  CONSTRAINT canonical_progress_records_reason_check CHECK(public.canonical_field_execution_reason_valid(reason)),
  CONSTRAINT canonical_progress_records_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);
CREATE INDEX canonical_progress_records_execution_time ON public.canonical_progress_records(organization_id,execution_id,decided_at DESC,id DESC);
CREATE UNIQUE INDEX canonical_progress_predecessor_unique ON public.canonical_progress_records(organization_id,previous_record_id) WHERE previous_record_id IS NOT NULL;

CREATE FUNCTION public.canonical_progress_record_digest_valid(record_value public.canonical_progress_records)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT rtrim(record_value.canonical_digest)=encode(sha256(convert_to(jsonb_build_object(
   'action',record_value.action_code,'assignmentDigest',rtrim(record_value.source_assignment_digest),
   'assignmentRevision',record_value.source_assignment_revision,'document',record_value.document,
   'executionDigest',rtrim(record_value.source_execution_digest),'executionId',record_value.execution_id,
   'executionRevision',record_value.source_execution_revision,'performedBy',record_value.performed_by_profile_id,
   'previousRecordId',record_value.previous_record_id,'recordedBy',record_value.recorded_by_user_id,
   'revision',record_value.revision,'rootId',record_value.root_id)::text,'UTF8')),'hex')
$$;
ALTER TABLE public.canonical_progress_records ADD CONSTRAINT canonical_progress_records_canonical_digest_check CHECK(public.canonical_progress_record_digest_valid(canonical_progress_records));

CREATE TABLE public.canonical_progress_events (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL, record_id UUID NOT NULL, root_id UUID NOT NULL, action_code TEXT NOT NULL,
  before_revision BIGINT NOT NULL, after_revision BIGINT NOT NULL, before_digest CHAR(64), after_digest CHAR(64) NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL, request_digest CHAR(64) NOT NULL,
  recorded_by_user_id UUID NOT NULL, performed_by_profile_id UUID NOT NULL, auth_session_id UUID NOT NULL,
  request_correlation_id VARCHAR(128) NOT NULL, transaction_id BIGINT NOT NULL DEFAULT txid_current(), decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_progress_events_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_progress_events_record_unique UNIQUE(organization_id,record_id),
  CONSTRAINT canonical_progress_events_record_fk FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_progress_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_progress_events_root_fk FOREIGN KEY(organization_id,root_id) REFERENCES public.canonical_progress_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_progress_events_execution_fk FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_events_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_events_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_events_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_events_revision_check CHECK(before_revision>=0 AND after_revision=before_revision+1 AND ((before_revision=0 AND before_digest IS NULL) OR (before_revision>0 AND before_digest~'^[0-9a-f]{64}$'))),
  CONSTRAINT canonical_progress_events_digest_check CHECK(after_digest~'^[0-9a-f]{64}$' AND idempotency_key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_progress_events_action_check CHECK(action_code IN ('record_progress','update_progress','record_blocker','record_exception','record_change','issue_state','correct','review')),
  CONSTRAINT canonical_progress_events_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);

CREATE TABLE public.canonical_progress_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL, record_id UUID NOT NULL, event_id UUID NOT NULL, action_code TEXT NOT NULL,
  before_revision BIGINT NOT NULL, after_revision BIGINT NOT NULL, before_digest CHAR(64), after_digest CHAR(64) NOT NULL,
  recorded_by_user_id UUID NOT NULL, performed_by_profile_id UUID NOT NULL, auth_session_id UUID NOT NULL,
  source_execution_revision BIGINT NOT NULL, source_execution_digest CHAR(64) NOT NULL,
  source_assignment_revision BIGINT NOT NULL, source_assignment_digest CHAR(64) NOT NULL,
  reason TEXT NOT NULL, request_correlation_id VARCHAR(128) NOT NULL,
  transaction_id BIGINT NOT NULL DEFAULT txid_current(), decided_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT canonical_progress_audit_tenant_identity UNIQUE(organization_id,id),
  CONSTRAINT canonical_progress_audit_record_unique UNIQUE(organization_id,record_id),
  CONSTRAINT canonical_progress_audit_record_fk FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_progress_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_progress_audit_event_fk FOREIGN KEY(organization_id,event_id) REFERENCES public.canonical_progress_events(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_progress_audit_execution_fk FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_audit_recorder_fk FOREIGN KEY(organization_id,recorded_by_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_audit_performer_fk FOREIGN KEY(organization_id,performed_by_profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_audit_session_fk FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_audit_revision_check CHECK(before_revision>=0 AND after_revision=before_revision+1 AND source_execution_revision>=1 AND source_assignment_revision>=1 AND ((before_revision=0 AND before_digest IS NULL) OR (before_revision>0 AND before_digest~'^[0-9a-f]{64}$'))),
  CONSTRAINT canonical_progress_audit_digest_check CHECK(after_digest~'^[0-9a-f]{64}$' AND source_execution_digest~'^[0-9a-f]{64}$' AND source_assignment_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_progress_audit_action_check CHECK(action_code IN ('record_progress','update_progress','record_blocker','record_exception','record_change','issue_state','correct','review')),
  CONSTRAINT canonical_progress_audit_reason_check CHECK(public.canonical_field_execution_reason_valid(reason)),
  CONSTRAINT canonical_progress_audit_correlation_check CHECK(request_correlation_id~'^[ -~]{1,128}$')
);

CREATE TABLE public.canonical_progress_idempotency (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL, auth_session_id UUID NOT NULL, key_hash CHAR(64) NOT NULL,
  request_digest CHAR(64) NOT NULL, action_code TEXT NOT NULL, record_id UUID NOT NULL,
  response_status INTEGER NOT NULL, response_body JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(organization_id,actor_user_id,auth_session_id,key_hash),
  CONSTRAINT canonical_progress_idempotency_actor_fk FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_idempotency_session_fk FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
  CONSTRAINT canonical_progress_idempotency_record_fk FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_progress_records(organization_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT canonical_progress_idempotency_digest_check CHECK(key_hash~'^[0-9a-f]{64}$' AND request_digest~'^[0-9a-f]{64}$'),
  CONSTRAINT canonical_progress_idempotency_response_check CHECK(action_code IN ('record_progress','update_progress','record_blocker','record_exception','record_change','issue_state','correct','review') AND response_status=201 AND jsonb_typeof(response_body)='object')
);

CREATE TABLE public.canonical_progress_evidence_links (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 record_id UUID NOT NULL, evidence_id UUID NOT NULL, evidence_revision BIGINT NOT NULL CHECK(evidence_revision>=1), evidence_digest CHAR(64) NOT NULL CHECK(evidence_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,record_id,evidence_id),
 FOREIGN KEY(organization_id,record_id) REFERENCES public.canonical_progress_records(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,evidence_id) REFERENCES public.canonical_field_evidence_records(organization_id,id) ON DELETE RESTRICT
);
CREATE FUNCTION public.canonical_progress_links(d JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT d->'evidence' || CASE WHEN d->'resolution'<>'null'::jsonb THEN d->'resolution'->'evidence' ELSE '[]'::jsonb END
 || CASE WHEN d->'milestone'->'checklist'<>'null'::jsonb THEN jsonb_build_array(d->'milestone'->'checklist') ELSE '[]'::jsonb END
$$;
CREATE FUNCTION public.canonical_progress_bind_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO public.canonical_progress_evidence_links(organization_id,record_id,evidence_id,evidence_revision,evidence_digest)
 SELECT DISTINCT NEW.organization_id,NEW.id,(v->>'id')::uuid,(v->>'revision')::bigint,v->>'digest'
 FROM jsonb_array_elements(public.canonical_progress_links(NEW.document)) v;
 RETURN NULL;
END $$;
CREATE FUNCTION public.canonical_progress_link_valid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.canonical_progress_records r JOIN public.canonical_field_evidence_records e
 ON e.organization_id=r.organization_id AND e.execution_id=r.execution_id AND e.id=NEW.evidence_id
 WHERE r.organization_id=NEW.organization_id AND r.id=NEW.record_id AND e.revision=NEW.evidence_revision AND e.canonical_digest=NEW.evidence_digest
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.canonical_progress_links(r.document)) v
 WHERE v->>'id'=NEW.evidence_id::text AND (v->>'revision')::bigint=NEW.evidence_revision AND v->>'digest'=rtrim(NEW.evidence_digest))) THEN
 RAISE EXCEPTION 'Divergent evidence link' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_progress_bind_links AFTER INSERT ON public.canonical_progress_records FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_bind_links();
CREATE TRIGGER canonical_progress_link_valid BEFORE INSERT ON public.canonical_progress_evidence_links FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_link_valid();

CREATE FUNCTION public.canonical_progress_projection(record_value public.canonical_progress_records)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',record_value.id,'rootId',record_value.root_id,'previousRecordId',record_value.previous_record_id,
 'type',record_value.evidence_type,'revision',record_value.revision,'document',record_value.document,'digest',rtrim(record_value.canonical_digest),
 'executionId',record_value.execution_id,'assignmentId',record_value.assignment_id,'recordedByUserId',record_value.recorded_by_user_id,
 'performedByProfileId',record_value.performed_by_profile_id,'sourceExecutionRevision',record_value.source_execution_revision,
 'sourceExecutionDigest',rtrim(record_value.source_execution_digest),'sourceAssignmentRevision',record_value.source_assignment_revision,
 'sourceAssignmentDigest',rtrim(record_value.source_assignment_digest),'reason',record_value.reason,
 'observedAt',to_char(record_value.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'authorityBoundary',jsonb_build_object('commercialConsequences',FALSE,'authorizationToContinue',FALSE,'percentComplete',NULL,'executionLifecycleChanged',FALSE,'professionalConclusion',FALSE),
 'decidedAt',to_char(record_value.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

CREATE FUNCTION public.canonical_progress_immutable() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Canonical field evidence is immutable' USING ERRCODE='55000'; END $$;

CREATE FUNCTION public.canonical_progress_own_decision_time() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 NEW.transaction_id:=txid_current();
 IF TG_TABLE_NAME='canonical_progress_records' THEN
  NEW.observed_at:=(NEW.document->>'observedAt')::timestamptz;
  SELECT greatest(clock_timestamp(),COALESCE(max(decided_at)+INTERVAL '1 microsecond',clock_timestamp())) INTO NEW.decided_at
  FROM public.canonical_progress_records WHERE organization_id=NEW.organization_id AND execution_id=NEW.execution_id;
 ELSE SELECT decided_at INTO STRICT NEW.decided_at FROM public.canonical_progress_records WHERE organization_id=NEW.organization_id AND id=NEW.record_id; END IF;
 RETURN NEW; END $$;

CREATE FUNCTION public.canonical_progress_own_receipt_time() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN SELECT decided_at INTO STRICT NEW.created_at FROM public.canonical_progress_records WHERE organization_id=NEW.organization_id AND id=NEW.record_id; RETURN NEW; END $$;

CREATE FUNCTION public.canonical_progress_complete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.previous_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.canonical_progress_records p
   WHERE p.organization_id=NEW.organization_id AND p.id=NEW.previous_record_id AND p.root_id=NEW.root_id
   AND p.execution_id=NEW.execution_id AND p.assignment_id=NEW.assignment_id AND p.evidence_type=NEW.evidence_type
   AND p.performed_by_profile_id=NEW.performed_by_profile_id AND p.revision=NEW.revision-1) THEN
   RAISE EXCEPTION 'Invalid predecessor chain' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.canonical_progress_evidence_links WHERE organization_id=NEW.organization_id AND record_id=NEW.id)
 <> (SELECT count(DISTINCT v->>'id') FROM jsonb_array_elements(public.canonical_progress_links(NEW.document)) v)
 THEN RAISE EXCEPTION 'Incomplete evidence links' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_progress_events e WHERE e.organization_id=NEW.organization_id AND e.execution_id=NEW.execution_id AND e.record_id=NEW.id AND e.root_id=NEW.root_id AND e.action_code=NEW.action_code AND e.before_revision=NEW.revision-1 AND e.after_revision=NEW.revision AND e.before_digest IS NOT DISTINCT FROM CASE WHEN NEW.previous_record_id IS NULL THEN NULL ELSE (SELECT predecessor.canonical_digest FROM public.canonical_progress_records predecessor WHERE predecessor.organization_id=NEW.organization_id AND predecessor.id=NEW.previous_record_id) END AND rtrim(e.after_digest)=rtrim(NEW.canonical_digest) AND e.recorded_by_user_id=NEW.recorded_by_user_id AND e.performed_by_profile_id=NEW.performed_by_profile_id AND e.auth_session_id=NEW.auth_session_id AND e.request_correlation_id=NEW.request_correlation_id AND e.transaction_id=NEW.transaction_id AND e.decided_at=NEW.decided_at)
OR NOT EXISTS(SELECT 1 FROM public.canonical_progress_audit_events a WHERE a.organization_id=NEW.organization_id AND a.execution_id=NEW.execution_id AND a.record_id=NEW.id AND EXISTS(SELECT 1 FROM public.canonical_progress_events linked WHERE linked.organization_id=a.organization_id AND linked.id=a.event_id AND linked.record_id=a.record_id) AND a.action_code=NEW.action_code AND a.before_revision=NEW.revision-1 AND a.after_revision=NEW.revision AND a.before_digest IS NOT DISTINCT FROM CASE WHEN NEW.previous_record_id IS NULL THEN NULL ELSE (SELECT predecessor.canonical_digest FROM public.canonical_progress_records predecessor WHERE predecessor.organization_id=NEW.organization_id AND predecessor.id=NEW.previous_record_id) END AND rtrim(a.after_digest)=rtrim(NEW.canonical_digest) AND a.recorded_by_user_id=NEW.recorded_by_user_id AND a.performed_by_profile_id=NEW.performed_by_profile_id AND a.auth_session_id=NEW.auth_session_id AND a.source_execution_revision=NEW.source_execution_revision AND rtrim(a.source_execution_digest)=rtrim(NEW.source_execution_digest) AND a.source_assignment_revision=NEW.source_assignment_revision AND rtrim(a.source_assignment_digest)=rtrim(NEW.source_assignment_digest) AND a.reason=NEW.reason AND a.request_correlation_id=NEW.request_correlation_id AND a.transaction_id=NEW.transaction_id AND a.decided_at=NEW.decided_at)
 OR NOT EXISTS(SELECT 1 FROM public.canonical_progress_idempotency i JOIN public.canonical_progress_events e ON e.organization_id=i.organization_id AND e.record_id=i.record_id WHERE i.organization_id=NEW.organization_id AND i.actor_user_id=NEW.recorded_by_user_id AND i.auth_session_id=NEW.auth_session_id AND i.record_id=NEW.id AND i.action_code=NEW.action_code AND i.key_hash=e.idempotency_key_hash AND i.request_digest=e.request_digest AND i.response_status=201 AND i.response_body=jsonb_build_object('success',TRUE,'data',public.canonical_progress_projection(NEW)) AND i.created_at=NEW.decided_at) THEN
   RAISE EXCEPTION 'Field evidence transaction incomplete' USING ERRCODE='23514',CONSTRAINT='canonical_progress_incomplete';
 END IF;
 RETURN NULL;
END $$;


CREATE FUNCTION public.canonical_progress_work_lock(org UUID,execution_value UUID,write_value BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.canonical_material_supporting_authority_read_lock();
 IF NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=230007
 AND objid=(hashtext(org::text||':'||execution_value::text)::bigint & 4294967295)::oid AND objsubid=2
 AND mode=CASE WHEN write_value THEN 'ExclusiveLock' ELSE 'ShareLock' END AND granted) THEN
 RAISE EXCEPTION 'Ordered progress snapshot required' USING ERRCODE='40001',CONSTRAINT='canonical_progress_snapshot_stale'; END IF;
END $$;
CREATE FUNCTION public.canonical_progress_observation_authorized(org UUID,execution_value UUID,d JSONB,require_current_profile BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE z JSONB:=d->'timeZoneAuthority'; p JSONB; links JSONB:=d->'evidence'; raw TEXT:=d->>'observedAt'; tz TEXT:=z->>'timeZone'; t TIMESTAMPTZ;
BEGIN
 IF require_current_profile IS NULL THEN RETURN FALSE; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_business_profiles b WHERE b.organization_id=org AND b.id=(z->>'businessProfileId')::uuid
 AND b.version_number=(z->>'version')::bigint AND rtrim(b.normalized_profile_hash)=z->>'hash'
 AND (b.is_active OR NOT require_current_profile) AND b.raw_profile#>>'{company,timeZone}'=tz)
 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=tz) THEN RETURN FALSE; END IF;
 t:=raw::timestamptz;
 IF t>clock_timestamp()+INTERVAL '5 minutes' OR t AT TIME ZONE tz <> (regexp_replace(raw,'(Z|[+-][0-9]{2}:[0-9]{2})$',''))::timestamp THEN RETURN FALSE; END IF;
 IF d->'resolution'<>'null'::jsonb THEN
  raw:=d->'resolution'->>'observedAt';t:=raw::timestamptz;
  IF t<(d->>'observedAt')::timestamptz OR t>clock_timestamp()+INTERVAL '5 minutes'
  OR t AT TIME ZONE tz<>(regexp_replace(raw,'(Z|[+-][0-9]{2}:[0-9]{2})$',''))::timestamp THEN RETURN FALSE; END IF;
  links:=links||(d->'resolution'->'evidence');
 END IF;
 IF d->'milestone'->'checklist'<>'null'::jsonb THEN
  p:=d->'milestone'->'checklist';links:=links||jsonb_build_array(p);
  IF NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records e WHERE e.organization_id=org AND e.execution_id=execution_value
  AND e.id=(p->>'id')::uuid AND e.evidence_type IN ('checklist','checklist_response')) THEN RETURN FALSE; END IF;
 END IF;
 FOR p IN SELECT v FROM jsonb_array_elements(links) v LOOP
  IF NOT EXISTS(SELECT 1 FROM public.canonical_field_evidence_records e WHERE e.organization_id=org AND e.execution_id=execution_value
  AND e.id=(p->>'id')::uuid AND e.revision=(p->>'revision')::bigint AND rtrim(e.canonical_digest)=p->>'digest') THEN RETURN FALSE; END IF;
 END LOOP;
 IF d->>'kind' IN ('blocker','exception') AND NOT EXISTS(SELECT 1 FROM public.workforce_profiles p
 JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
 JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
 WHERE p.organization_id=org AND p.id=(d->'followUp'->>'profileId')::uuid AND m.status='active' AND u.status='active') THEN RETURN FALSE; END IF;
 RETURN TRUE;
END $$;
CREATE FUNCTION public.canonical_progress_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf_value TEXT,execution_value UUID,
 action_value TEXT,performer UUID,subject_value UUID,expected_subject_revision BIGINT,expected_subject_digest TEXT,
 expected_execution_revision BIGINT,expected_execution_digest TEXT,expected_assignment_revision BIGINT,expected_assignment_digest TEXT,
 document_value JSONB,idempotency_key TEXT,reason_value TEXT,correlation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; execution_record public.canonical_field_executions%ROWTYPE; assignment_record public.canonical_schedule_assignments%ROWTYPE;
 receipt public.canonical_progress_idempotency%ROWTYPE; subject_record public.canonical_progress_records%ROWTYPE;
 record_value public.canonical_progress_records%ROWTYPE; event_value UUID:=gen_random_uuid(); record_id UUID:=gen_random_uuid();
 key_hash_value TEXT; request_hash_value TEXT; record_digest TEXT; before_revision BIGINT:=0;before_digest TEXT:=NULL;root_value UUID;response JSONB;
 updating BOOLEAN:=action_value IN ('update_progress','issue_state','correct','review');
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR (action_value IN ('record_progress','update_progress','record_blocker','record_exception','record_change','issue_state','correct','review')) IS NOT TRUE
 OR idempotency_key IS NULL OR idempotency_key!~'^[!-~]{16,128}$' OR expected_execution_revision IS NULL OR expected_execution_digest IS NULL
 OR expected_assignment_revision IS NULL OR expected_assignment_digest IS NULL OR performer IS NULL OR org IS NULL OR actor IS NULL OR session_value IS NULL OR role_value IS NULL OR execution_value IS NULL
 OR expected_execution_revision<1 OR expected_assignment_revision<1 OR expected_execution_digest!~'^[0-9a-f]{64}$' OR expected_assignment_digest!~'^[0-9a-f]{64}$'
 OR (updating AND (subject_value IS NULL OR expected_subject_revision IS NULL OR expected_subject_digest IS NULL OR expected_subject_revision<1 OR expected_subject_digest!~'^[0-9a-f]{64}$'))
 OR (NOT updating AND (subject_value IS NOT NULL OR expected_subject_revision IS NOT NULL OR expected_subject_digest IS NOT NULL))
 OR public.canonical_progress_text_valid(reason_value) IS NOT TRUE OR correlation_value IS NULL OR correlation_value!~'^[ -~]{1,128}$'
 OR public.canonical_progress_document_valid(action_value,document_value) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid operational input' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_progress_work_lock(org,execution_value,TRUE);
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf_value,TRUE);
 SELECT * INTO execution_record FROM public.canonical_field_executions WHERE organization_id=org AND id=execution_value FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Work unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO assignment_record FROM public.canonical_schedule_assignments WHERE organization_id=org AND id=execution_record.assignment_id FOR SHARE;
 IF NOT FOUND OR public.canonical_field_execution_replay_authorized(org,role_value,(authority->>'profileId')::uuid,execution_value,NULL) IS NOT TRUE
 OR execution_record.lifecycle_state NOT IN ('in_progress','paused') OR assignment_record.schedule_state<>'scheduled' OR assignment_record.needs_review
 OR NOT EXISTS(SELECT 1 FROM public.canonical_transcripts t WHERE t.organization_id=org AND t.operation_id=execution_record.operation_id
 AND t.graph_id=execution_record.graph_id AND public.canonical_labor_transcript_source_normalized(t.source) IN ('lead','retell','voice'))
 THEN RAISE EXCEPTION 'Current work unavailable' USING ERRCODE='42501'; END IF;
 IF execution_record.revision<>expected_execution_revision OR rtrim(execution_record.canonical_digest)<>expected_execution_digest
 OR assignment_record.revision<>expected_assignment_revision OR rtrim(assignment_record.canonical_digest)<>expected_assignment_digest
 THEN RAISE EXCEPTION 'Source pins stale' USING ERRCODE='40001',CONSTRAINT='canonical_progress_source_stale'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workforce_profiles p JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
 JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id WHERE p.organization_id=org AND p.id=performer AND m.status='active' AND u.status='active'
 AND (assignment_record.workforce_profile_id=p.id OR EXISTS(SELECT 1 FROM public.workforce_crew_members cm WHERE cm.organization_id=org AND cm.crew_id=assignment_record.workforce_crew_id AND cm.profile_id=p.id)))
 OR role_value='member' AND performer<>(authority->>'profileId')::uuid THEN RAISE EXCEPTION 'Performer unavailable' USING ERRCODE='42501'; END IF;
 IF action_value='review' AND ((document_value->>'outcome'='owner_confirmed' AND role_value NOT IN ('owner','admin'))
 OR (document_value->>'outcome'='worker_acknowledged' AND performer<>(authority->>'profileId')::uuid))
 THEN RAISE EXCEPTION 'Review authority unavailable' USING ERRCODE='42501'; END IF;
 key_hash_value:=encode(sha256(convert_to(idempotency_key,'UTF8')),'hex');
 request_hash_value:=encode(sha256(convert_to(jsonb_build_object('organizationId',org,'actor',actor,'session',session_value,'execution',execution_value,'action',action_value,
 'performer',performer,'subject',subject_value,'subjectRevision',expected_subject_revision,'subjectDigest',expected_subject_digest,
 'executionRevision',expected_execution_revision,'executionDigest',expected_execution_digest,'assignmentRevision',expected_assignment_revision,
 'assignmentDigest',expected_assignment_digest,'document',document_value,'keyHash',key_hash_value,'reason',reason_value)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.canonical_progress_idempotency WHERE organization_id=org AND actor_user_id=actor AND auth_session_id=session_value AND key_hash=key_hash_value;
 IF FOUND THEN
  IF rtrim(receipt.request_digest)<>request_hash_value THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505',CONSTRAINT='canonical_progress_idempotency_conflict'; END IF;
  RETURN jsonb_build_object('status',receipt.response_status,'body',receipt.response_body,'replayed',TRUE);
 END IF;
 IF (SELECT count(*) FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value)>=2000 THEN RAISE EXCEPTION 'Operational fact bound reached' USING ERRCODE='54000'; END IF;
 IF updating THEN
  SELECT * INTO subject_record FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value AND id=subject_value FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Record unavailable' USING ERRCODE='42501'; END IF;
  IF subject_record.performed_by_profile_id<>performer THEN RAISE EXCEPTION 'Attribution cannot be replaced' USING ERRCODE='42501'; END IF;
  IF subject_record.revision<>expected_subject_revision OR rtrim(subject_record.canonical_digest)<>expected_subject_digest
  OR EXISTS(SELECT 1 FROM public.canonical_progress_records WHERE organization_id=org AND previous_record_id=subject_record.id)
  THEN RAISE EXCEPTION 'Predecessor stale' USING ERRCODE='40001',CONSTRAINT='canonical_progress_subject_stale'; END IF;
  root_value:=subject_record.root_id;before_revision:=subject_record.revision;before_digest:=rtrim(subject_record.canonical_digest);
  IF action_value='review' THEN document_value:=subject_record.document||jsonb_build_object('reviewState',document_value->>'outcome');
  ELSIF action_value='issue_state' THEN
   IF subject_record.evidence_type NOT IN ('blocker','exception') OR subject_record.document->>'state'=document_value->>'state'
   OR (subject_record.document->>'state'='resolved' AND document_value->>'state'<>'open') THEN RAISE EXCEPTION 'Invalid issue transition' USING ERRCODE='22023'; END IF;
   document_value:=subject_record.document||document_value||jsonb_build_object('reviewState','needs_review');
  ELSE
   IF document_value->>'kind'<>subject_record.evidence_type
   OR (subject_record.evidence_type='progress' AND document_value->>'workKey'<>subject_record.document->>'workKey')
   OR (subject_record.evidence_type IN ('blocker','exception') AND
     (document_value->'state'<>subject_record.document->'state' OR document_value->'resolution'<>subject_record.document->'resolution'))
   THEN RAISE EXCEPTION 'Correction cannot change fact identity or issue lifecycle' USING ERRCODE='22023'; END IF;
   IF action_value='update_progress' AND (subject_record.evidence_type<>'progress'
    OR (subject_record.document->'quantity'<>'null'::jsonb AND
      (document_value->'quantity'='null'::jsonb OR document_value->'quantity'->>'unit'<>subject_record.document->'quantity'->>'unit'
       OR document_value->'quantity'->>'total'<>subject_record.document->'quantity'->>'total'
       OR (document_value->'quantity'->>'completed')::numeric<(subject_record.document->'quantity'->>'completed')::numeric)))
   THEN RAISE EXCEPTION 'Changed measurement basis requires explicit correction' USING ERRCODE='22023'; END IF;
  END IF;
 ELSE root_value:=record_id;
  IF action_value='record_progress' AND EXISTS(SELECT 1 FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value
  AND evidence_type='progress' AND document->>'workKey'=document_value->>'workKey' AND performed_by_profile_id=performer)
  THEN RAISE EXCEPTION 'Progress work identity already exists; update exact predecessor' USING ERRCODE='40001',CONSTRAINT='canonical_progress_work_stale'; END IF;
 END IF;
 IF NOT public.canonical_progress_full_document_valid(document_value) THEN RAISE EXCEPTION 'Invalid canonical document' USING ERRCODE='22023'; END IF;
 -- Only these exact-predecessor actions inherit historical observation provenance.
 -- Retain its full profile pin and timezone (also for resolution instants); retirement
 -- is not revocation of current actor/work authority, already checked above.
 IF NOT public.canonical_progress_observation_authorized(org,execution_value,document_value,action_value NOT IN ('review','issue_state')) THEN RAISE EXCEPTION 'Observed source evidence unavailable' USING ERRCODE='42501'; END IF;
 record_digest:=encode(sha256(convert_to(jsonb_build_object('action',action_value,'assignmentDigest',expected_assignment_digest,'assignmentRevision',expected_assignment_revision,
 'document',document_value,'executionDigest',expected_execution_digest,'executionId',execution_value,'executionRevision',expected_execution_revision,
 'performedBy',performer,'previousRecordId',CASE WHEN updating THEN subject_record.id ELSE NULL END,'recordedBy',actor,'revision',before_revision+1,'rootId',root_value)::text,'UTF8')),'hex');
 INSERT INTO public.canonical_progress_records(id,organization_id,execution_id,assignment_id,root_id,previous_record_id,evidence_type,revision,document,canonical_digest,
 recorded_by_user_id,performed_by_profile_id,auth_session_id,source_execution_revision,source_execution_digest,source_assignment_revision,source_assignment_digest,action_code,reason,request_correlation_id)
 VALUES(record_id,org,execution_value,execution_record.assignment_id,root_value,CASE WHEN updating THEN subject_record.id ELSE NULL END,document_value->>'kind',before_revision+1,document_value,
 record_digest,actor,performer,session_value,expected_execution_revision,expected_execution_digest,expected_assignment_revision,expected_assignment_digest,action_value,reason_value,correlation_value) RETURNING * INTO record_value;
 INSERT INTO public.canonical_progress_events(id,organization_id,execution_id,record_id,root_id,action_code,before_revision,after_revision,before_digest,after_digest,idempotency_key_hash,request_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,request_correlation_id)
 VALUES(event_value,org,execution_value,record_id,root_value,action_value,before_revision,before_revision+1,before_digest,record_digest,key_hash_value,request_hash_value,actor,performer,session_value,correlation_value);
 INSERT INTO public.canonical_progress_audit_events(organization_id,execution_id,record_id,event_id,action_code,before_revision,after_revision,before_digest,after_digest,recorded_by_user_id,performed_by_profile_id,auth_session_id,source_execution_revision,source_execution_digest,source_assignment_revision,source_assignment_digest,reason,request_correlation_id)
 VALUES(org,execution_value,record_id,event_value,action_value,before_revision,before_revision+1,before_digest,record_digest,actor,performer,session_value,expected_execution_revision,expected_execution_digest,expected_assignment_revision,expected_assignment_digest,reason_value,correlation_value);
 response:=jsonb_build_object('success',TRUE,'data',public.canonical_progress_projection(record_value));
 INSERT INTO public.canonical_progress_idempotency(organization_id,actor_user_id,auth_session_id,key_hash,request_digest,action_code,record_id,response_status,response_body)
 VALUES(org,actor,session_value,key_hash_value,request_hash_value,action_value,record_id,201,response);
 RETURN jsonb_build_object('status',201,'body',response,'replayed',FALSE);
END $$;
CREATE FUNCTION public.canonical_progress_read(org UUID, actor UUID, role_value TEXT, session_value UUID, execution_value UUID, limit_value INTEGER, cutoff_value TIMESTAMPTZ, last_time TIMESTAMPTZ, last_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; cutoff TIMESTAMPTZ; records JSONB; returned INTEGER; more BOOLEAN; next_data JSONB; total_value INTEGER; summary_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR limit_value IS NULL OR limit_value NOT BETWEEN 1 AND 200 OR ((last_time IS NULL)<>(last_id IS NULL))
 OR (last_time IS NOT NULL AND cutoff_value IS NULL) OR cutoff_value>clock_timestamp()+INTERVAL '1 second' OR last_time>cutoff_value THEN RAISE EXCEPTION 'Invalid field evidence read' USING ERRCODE='22023'; END IF;
 PERFORM public.canonical_progress_work_lock(org,execution_value,FALSE);
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF NOT public.canonical_field_execution_replay_authorized(org,role_value,(authority->>'profileId')::uuid,execution_value,NULL) THEN RAISE EXCEPTION 'Read unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.subscriptions s JOIN public.organization_onboarding o ON o.organization_id=s.organization_id
 WHERE s.organization_id=org AND o.status='complete' AND (s.status='active' OR s.status='trialing' AND s.trial_ends_at=s.trial_started_at+INTERVAL '14 days' AND s.trial_ends_at>clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM public.canonical_field_executions e JOIN public.canonical_transcripts t ON t.organization_id=e.organization_id AND t.operation_id=e.operation_id AND t.graph_id=e.graph_id
 WHERE e.organization_id=org AND e.id=execution_value AND public.canonical_labor_transcript_source_normalized(t.source) IN ('lead','retell','voice'))
 THEN RAISE EXCEPTION 'Current read authority unavailable' USING ERRCODE='42501'; END IF;
 IF last_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value AND id=last_id AND decided_at=last_time AND decided_at<=cutoff_value)
 THEN RAISE EXCEPTION 'Cursor does not belong to this dataset' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(cutoff_value,max(decided_at),clock_timestamp()) INTO cutoff FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value;
 WITH selected AS (SELECT r.* FROM public.canonical_progress_records r WHERE r.organization_id=org AND r.execution_id=execution_value AND r.decided_at<=cutoff AND (last_time IS NULL OR (r.decided_at,r.id)<(last_time,last_id)) ORDER BY r.decided_at DESC,r.id DESC LIMIT limit_value+1), page AS (SELECT * FROM selected ORDER BY decided_at DESC,id DESC LIMIT limit_value)
 SELECT COALESCE(jsonb_agg(public.canonical_progress_projection(page) ORDER BY decided_at DESC,id DESC),'[]'::jsonb),count(*) INTO records,returned FROM page;
 SELECT EXISTS(SELECT 1 FROM public.canonical_progress_records r WHERE r.organization_id=org AND r.execution_id=execution_value AND r.decided_at<=cutoff AND (last_time IS NULL OR (r.decided_at,r.id)<(last_time,last_id)) OFFSET limit_value) INTO more;
 SELECT count(*) INTO total_value FROM public.canonical_progress_records r WHERE r.organization_id=org AND r.execution_id=execution_value AND r.decided_at<=cutoff;
 IF more AND returned>0 THEN SELECT jsonb_build_object('executionId',execution_value,'cutoff',to_char(cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lastTime',record->>'decidedAt','lastId',record->>'id') INTO next_data FROM jsonb_array_elements(records) WITH ORDINALITY item(record,ordinal) ORDER BY ordinal DESC LIMIT 1; END IF;
 WITH latest AS (SELECT DISTINCT ON(root_id) * FROM public.canonical_progress_records WHERE organization_id=org AND execution_id=execution_value AND decided_at<=cutoff ORDER BY root_id,revision DESC)
 SELECT jsonb_build_object('unresolvedIssues',count(*) FILTER(WHERE evidence_type IN ('blocker','exception') AND document->>'state'<>'resolved'),
 'pendingReviews',count(*) FILTER(WHERE document->>'reviewState'='needs_review'),'percentComplete',NULL,'completionInferred',FALSE) INTO summary_value FROM latest;
 RETURN jsonb_build_object('status',200,'body',jsonb_build_object('success',TRUE,'data',records,'summary',summary_value,'total',total_value,'returned',returned,'truncated',more,'nextCursorData',next_data),'replayed',FALSE);
END $$;


CREATE CONSTRAINT TRIGGER canonical_progress_complete AFTER INSERT ON public.canonical_progress_records
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_complete();
-- Extend the released authority fence to the newly pinned observation-zone source.
CREATE TRIGGER canonical_progress_profile_serialization BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_business_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_material_supporting_authority_write_lock();
CREATE TRIGGER canonical_progress_records_time BEFORE INSERT ON public.canonical_progress_records FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_own_decision_time();
CREATE TRIGGER canonical_progress_events_time BEFORE INSERT ON public.canonical_progress_events FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_own_decision_time();
CREATE TRIGGER canonical_progress_audit_time BEFORE INSERT ON public.canonical_progress_audit_events FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_own_decision_time();
CREATE TRIGGER canonical_progress_receipt_time BEFORE INSERT ON public.canonical_progress_idempotency FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_own_receipt_time();
DO $$
DECLARE name TEXT; routine RECORD;
BEGIN
 FOREACH name IN ARRAY ARRAY['canonical_progress_records','canonical_progress_events','canonical_progress_audit_events','canonical_progress_idempotency','canonical_progress_evidence_links'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.canonical_progress_immutable()',name||'_immutable',name);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_progress_immutable()',name||'_no_truncate',name);
 EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',name);
 END LOOP;
 FOR routine IN SELECT oid::regprocedure AS identity FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'canonical_progress_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',routine.identity);
 END LOOP;
END $$;
