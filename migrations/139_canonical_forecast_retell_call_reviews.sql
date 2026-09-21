-- Mission 26 Part 4A: forecast-only review of a pinned Retell call.
-- This is not a canonical customer/lead merge, a coverage certificate or a forecast.

CREATE TABLE public.canonical_forecast_retell_call_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL,
 transcript_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 snapshot_id UUID NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 disposition TEXT NOT NULL CHECK(disposition IN ('new_lead','repeat_lead','not_lead','unresolved')),
 anchor_transcript_id UUID,
 anchor_review_id UUID,
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,transcript_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,transcript_id,id),
 FOREIGN KEY(organization_id,transcript_id) REFERENCES public.canonical_transcripts(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,snapshot_id) REFERENCES public.canonical_forecast_retell_call_snapshots(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,transcript_id,previous_id)
  REFERENCES public.canonical_forecast_retell_call_reviews(organization_id,transcript_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,anchor_transcript_id,anchor_review_id)
  REFERENCES public.canonical_forecast_retell_call_reviews(organization_id,transcript_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((disposition='new_lead' AND anchor_transcript_id=transcript_id AND anchor_review_id IS NULL) OR
       (disposition='repeat_lead' AND anchor_transcript_id IS NOT NULL AND anchor_transcript_id<>transcript_id
         AND anchor_review_id IS NOT NULL) OR
       (disposition IN ('not_lead','unresolved') AND anchor_transcript_id IS NULL AND anchor_review_id IS NULL))
);
CREATE INDEX canonical_forecast_retell_call_reviews_current_idx
 ON public.canonical_forecast_retell_call_reviews(organization_id,transcript_id,revision DESC);

CREATE FUNCTION public.canonical_forecast_retell_call_review_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Call review history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_retell_call_reviews_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_retell_call_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_retell_call_review_immutable();

CREATE FUNCTION public.canonical_forecast_retell_call_review_source(org UUID,snapshot_value UUID,transcript_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_retell_call_snapshots%ROWTYPE;source_value JSONB;
BEGIN
 SELECT * INTO saved FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF saved.id IS NULL OR saved.source_manifest IS DISTINCT FROM
   public.canonical_forecast_retell_call_pins(org,saved.as_of) THEN RETURN NULL;END IF;
 SELECT item INTO source_value FROM jsonb_array_elements(saved.source_manifest)item
  WHERE item->>'sourceKind'='retell_call' AND item->>'sourceId'=transcript_value::text
    AND item->>'state'='active';
 RETURN source_value;
END $$;

CREATE FUNCTION public.canonical_forecast_retell_call_review_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_value JSONB;anchor_source JSONB;
 previous_row public.canonical_forecast_retell_call_reviews%ROWTYPE;
 anchor_row public.canonical_forecast_retell_call_reviews%ROWTYPE;actual_role TEXT;expected TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 source_value:=public.canonical_forecast_retell_call_review_source(NEW.organization_id,NEW.snapshot_id,NEW.transcript_id);
 IF source_value IS NULL OR source_value->>'digest' IS DISTINCT FROM NEW.source_digest THEN
  RAISE EXCEPTION 'Call source changed' USING ERRCODE='23514';END IF;
 SELECT role INTO actual_role FROM public.organization_memberships
  WHERE organization_id=NEW.organization_id AND id=NEW.membership_id
    AND user_id=NEW.actor_user_id AND status='active';
 IF actual_role NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Call review access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,NULL,FALSE);
 IF NEW.revision>1 THEN
  SELECT * INTO previous_row FROM public.canonical_forecast_retell_call_reviews
   WHERE organization_id=NEW.organization_id AND transcript_id=NEW.transcript_id AND id=NEW.previous_id;
  IF previous_row.id IS NULL OR previous_row.revision+1<>NEW.revision THEN
   RAISE EXCEPTION 'Call review revision invalid' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.disposition='repeat_lead' THEN
  SELECT * INTO anchor_row FROM public.canonical_forecast_retell_call_reviews
   WHERE organization_id=NEW.organization_id AND transcript_id=NEW.anchor_transcript_id
     AND id=NEW.anchor_review_id AND disposition='new_lead';
  anchor_source:=public.canonical_forecast_retell_call_review_source(
    NEW.organization_id,NEW.snapshot_id,NEW.anchor_transcript_id);
  IF anchor_row.id IS NULL OR anchor_row.id IS DISTINCT FROM (
    SELECT id FROM public.canonical_forecast_retell_call_reviews
    WHERE organization_id=NEW.organization_id AND transcript_id=NEW.anchor_transcript_id
    ORDER BY revision DESC LIMIT 1) OR
    anchor_source IS NULL OR anchor_row.source_digest IS DISTINCT FROM anchor_source->>'digest' OR
    anchor_source->>'eventAt' IS NULL OR source_value->>'eventAt' IS NULL OR
    anchor_source->>'eventAt'>source_value->>'eventAt' THEN
   RAISE EXCEPTION 'Lead anchor changed' USING ERRCODE='23514';END IF;
 END IF;
 expected:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-call-review-v1','organizationId',NEW.organization_id,
  'transcriptId',NEW.transcript_id,'revision',NEW.revision,'previousId',NEW.previous_id,
  'snapshotId',NEW.snapshot_id,'sourceDigest',NEW.source_digest,
  'disposition',NEW.disposition,'anchorTranscriptId',NEW.anchor_transcript_id,
  'anchorReviewId',NEW.anchor_review_id,'actorUserId',NEW.actor_user_id,
  'membershipId',NEW.membership_id,'authSessionId',NEW.auth_session_id,
  'reason',NEW.reason,'requestDigest',NEW.request_digest));
 IF NEW.canonical_digest<>expected THEN
  RAISE EXCEPTION 'Call review digest invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_retell_call_reviews_guard
 BEFORE INSERT ON public.canonical_forecast_retell_call_reviews
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_retell_call_review_guard();

CREATE FUNCTION public.canonical_forecast_retell_call_review_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 snapshot_value UUID,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_row public.canonical_forecast_retell_call_reviews%ROWTYPE;
 replay public.canonical_forecast_retell_call_reviews%ROWTYPE;
 inserted public.canonical_forecast_retell_call_reviews%ROWTYPE;
 anchor_row public.canonical_forecast_retell_call_reviews%ROWTYPE;
 source_value JSONB;anchor_source JSONB;key_hash TEXT;request_hash TEXT;digest_value TEXT;
 transcript_value UUID;anchor_value UUID;anchor_review_value UUID;next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 IF role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Call review access restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   public.canonical_field_evidence_object_keys_exact(body,ARRAY[
     'transcriptId','expectedSourceDigest','expectedRevision','expectedDigest',
     'disposition','anchorTranscriptId','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
   (body->>'transcriptId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') IS NOT TRUE OR
   (body->>'expectedSourceDigest'~'^[0-9a-f]{64}$') IS NOT TRUE OR
   (body->>'expectedRevision'~'^(0|[1-9][0-9]{0,3}|10000)$') IS NOT TRUE OR
   (body->>'expectedDigest'='none' OR body->>'expectedDigest'~'^[0-9a-f]{64}$') IS NOT TRUE OR
   body->>'disposition' NOT IN ('new_lead','repeat_lead','not_lead','unresolved') OR
   public.canonical_learning_text_valid(body->>'reason',1000) IS NOT TRUE OR
   body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR
   body->>'confirmationVersion'<>'m26-retell-call-review-v1' OR
   (body->>'disposition'='repeat_lead' AND
      (body->>'anchorTranscriptId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') IS NOT TRUE) OR
   (body->>'disposition'<>'repeat_lead' AND body->'anchorTranscriptId'<>'null'::jsonb)
 THEN RAISE EXCEPTION 'Call review request invalid' USING ERRCODE='22023';END IF;
 transcript_value:=(body->>'transcriptId')::uuid;
 anchor_value:=CASE WHEN body->>'disposition'='new_lead' THEN transcript_value
  WHEN body->>'disposition'='repeat_lead' THEN (body->>'anchorTranscriptId')::uuid ELSE NULL END;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-call-review-request-v1','organizationId',org,
  'actorUserId',actor,'snapshotId',snapshot_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':retell-call-review',0));
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO replay FROM public.canonical_forecast_retell_call_reviews
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF replay.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Call review key conflict' USING ERRCODE='23505';END IF;
  source_value:=public.canonical_forecast_retell_call_review_source(org,replay.snapshot_id,replay.transcript_id);
  IF replay.disposition='repeat_lead' THEN
   SELECT * INTO anchor_row FROM public.canonical_forecast_retell_call_reviews
    WHERE organization_id=org AND transcript_id=replay.anchor_transcript_id
    ORDER BY revision DESC LIMIT 1;
   anchor_source:=public.canonical_forecast_retell_call_review_source(
    org,replay.snapshot_id,replay.anchor_transcript_id);
  END IF;
  RETURN jsonb_build_object('id',replay.id,'revision',replay.revision,
   'digest',replay.canonical_digest,'replayed',TRUE,
   'status',CASE WHEN source_value IS NULL OR source_value->>'digest' IS DISTINCT FROM replay.source_digest
     OR (replay.disposition='repeat_lead' AND (anchor_row.id IS DISTINCT FROM replay.anchor_review_id
       OR anchor_source IS NULL OR anchor_row.source_digest IS DISTINCT FROM anchor_source->>'digest'))
     THEN 'stale' ELSE 'recorded' END);
 END IF;
 source_value:=public.canonical_forecast_retell_call_review_source(org,snapshot_value,transcript_value);
 IF source_value IS NULL OR source_value->>'digest' IS DISTINCT FROM body->>'expectedSourceDigest' THEN
  RAISE EXCEPTION 'Call source changed' USING ERRCODE='40001';END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_retell_call_reviews
  WHERE organization_id=org AND transcript_id=transcript_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint IS DISTINCT FROM COALESCE(current_row.revision,0) OR
   body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.canonical_digest,'none') THEN
  RAISE EXCEPTION 'Call review changed' USING ERRCODE='40001';END IF;
 IF body->>'disposition'='repeat_lead' THEN
  SELECT * INTO anchor_row FROM public.canonical_forecast_retell_call_reviews
   WHERE organization_id=org AND transcript_id=anchor_value ORDER BY revision DESC LIMIT 1;
  anchor_source:=public.canonical_forecast_retell_call_review_source(org,snapshot_value,anchor_value);
  IF anchor_row.id IS NULL OR anchor_row.disposition<>'new_lead' OR anchor_source IS NULL OR
    anchor_row.source_digest IS DISTINCT FROM anchor_source->>'digest' OR
    anchor_source->>'eventAt' IS NULL OR source_value->>'eventAt' IS NULL OR
    anchor_source->>'eventAt'>source_value->>'eventAt' THEN
   RAISE EXCEPTION 'Lead anchor unavailable' USING ERRCODE='40001';END IF;
  anchor_review_value:=anchor_row.id;
 END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Call review history limit reached' USING ERRCODE='54000';END IF;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-call-review-v1','organizationId',org,
  'transcriptId',transcript_value,'revision',next_revision,'previousId',current_row.id,
  'snapshotId',snapshot_value,'sourceDigest',source_value->>'digest',
  'disposition',body->>'disposition','anchorTranscriptId',anchor_value,
  'anchorReviewId',anchor_review_value,'actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,
  'reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_forecast_retell_call_reviews(
  organization_id,transcript_id,revision,previous_id,snapshot_id,source_digest,
  disposition,anchor_transcript_id,anchor_review_id,actor_user_id,membership_id,
  auth_session_id,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,transcript_value,next_revision,current_row.id,snapshot_value,source_value->>'digest',
  body->>'disposition',anchor_value,anchor_review_value,actor,(authority->>'membershipId')::uuid,
  session_value,body->>'reason',key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('id',inserted.id,'revision',inserted.revision,
  'digest',inserted.canonical_digest,'replayed',FALSE,'status','recorded');
END $$;

CREATE FUNCTION public.canonical_forecast_retell_call_reviews_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt JSONB;pin JSONB;latest public.canonical_forecast_retell_call_reviews%ROWTYPE;
 anchor_row public.canonical_forecast_retell_call_reviews%ROWTYPE;
 items JSONB:='[]'::jsonb;state_value TEXT;reviewed_count INTEGER:=0;
BEGIN
 receipt:=public.canonical_forecast_retell_call_snapshot_read(org,actor,role_value,session_value,snapshot_value);
 IF receipt IS NULL THEN RETURN NULL;END IF;
 IF receipt->>'stale'='true' THEN
  RETURN jsonb_build_object('snapshotId',snapshot_value,'stale',TRUE,'calls','[]'::jsonb,
   'reason','The recorded call source changed. Capture a new receipt before reviewing calls.');
 END IF;
 FOR pin IN SELECT value FROM jsonb_array_elements(receipt->'sources') value LOOP
  SELECT * INTO latest FROM public.canonical_forecast_retell_call_reviews
   WHERE organization_id=org AND transcript_id=(pin->>'sourceId')::uuid
   ORDER BY revision DESC LIMIT 1;
  state_value:='unresolved';
  IF latest.id IS NOT NULL AND latest.source_digest=pin->>'digest' AND
    latest.disposition<>'unresolved' THEN
   state_value:='reviewed';
   IF latest.disposition='repeat_lead' THEN
    SELECT * INTO anchor_row FROM public.canonical_forecast_retell_call_reviews
     WHERE organization_id=org AND transcript_id=latest.anchor_transcript_id
     ORDER BY revision DESC LIMIT 1;
    IF anchor_row.id IS DISTINCT FROM latest.anchor_review_id OR
       anchor_row.source_digest IS DISTINCT FROM (
         SELECT x->>'digest' FROM jsonb_array_elements(receipt->'sources')x
          WHERE x->>'sourceId'=latest.anchor_transcript_id::text) THEN state_value:='unresolved';END IF;
   END IF;
  END IF;
  IF state_value='reviewed' THEN reviewed_count:=reviewed_count+1;END IF;
  items:=items||jsonb_build_array(jsonb_build_object('callSourceId',pin->>'sourceId',
   'status',state_value,'disposition',CASE WHEN state_value='reviewed' THEN latest.disposition ELSE NULL END,
   'anchorCallSourceId',CASE WHEN state_value='reviewed' THEN latest.anchor_transcript_id ELSE NULL END,
   'reviewRevision',CASE WHEN latest.id IS NULL THEN 0 ELSE latest.revision END,
   'reviewDigest',CASE WHEN latest.id IS NULL THEN NULL ELSE latest.canonical_digest END));
 END LOOP;
 RETURN jsonb_build_object('snapshotId',snapshot_value,'stale',FALSE,
  'sourceSnapshotDigest',receipt->>'sourceSnapshotDigest','callCount',jsonb_array_length(items),
  'reviewedCount',reviewed_count,'unresolvedCount',jsonb_array_length(items)-reviewed_count,
  'calls',items,'boundary','Call dispositions are review evidence, not certified provider coverage or a lead forecast.');
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_retell_call_reviews FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_review_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_review_source(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_review_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_review_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_call_reviews_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_call_review_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,JSONB) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_call_reviews_read(UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
