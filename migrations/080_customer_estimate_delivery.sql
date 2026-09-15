-- Mission 24 Part 8 Slice 3: expiring customer links and immutable response evidence.
CREATE TABLE public.canonical_customer_estimate_delivery_links(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,estimate_id UUID NOT NULL,version_id UUID NOT NULL,
 token_hash TEXT NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,version_id) REFERENCES public.canonical_customer_estimate_versions(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
CREATE INDEX canonical_customer_estimate_delivery_history ON public.canonical_customer_estimate_delivery_links(organization_id,estimate_id,created_at DESC);

CREATE TABLE public.canonical_customer_estimate_delivery_events(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,estimate_id UUID NOT NULL,version_id UUID NOT NULL,link_id UUID NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('revoked','accepted','question')),body JSONB NOT NULL,actor_user_id UUID,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(link_id,kind,request_key_hash),FOREIGN KEY(organization_id,estimate_id,link_id) REFERENCES public.canonical_customer_estimate_delivery_links(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,version_id) REFERENCES public.canonical_customer_estimate_versions(organization_id,estimate_id,id),
 CHECK(octet_length(body::text)<=16384),CHECK((kind='revoked' AND actor_user_id IS NOT NULL) OR (kind<>'revoked' AND actor_user_id IS NULL))
);
CREATE INDEX canonical_customer_estimate_delivery_events_history ON public.canonical_customer_estimate_delivery_events(link_id,created_at,id);

CREATE TABLE public.demo_customer_estimate_delivery_links(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,source_token_hash TEXT NOT NULL CHECK(source_token_hash~'^[a-f0-9]{64}$'),estimate_id TEXT NOT NULL,version_id TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),document JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 UNIQUE(source_token_hash,request_key_hash),UNIQUE(source_token_hash,estimate_id,id),CHECK(document->>'contract'='NorthStarCustomerEstimatePreview/v1'),CHECK(document->>'state'='issued'),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);
CREATE INDEX demo_customer_estimate_delivery_history ON public.demo_customer_estimate_delivery_links(source_token_hash,estimate_id,created_at DESC);
CREATE TABLE public.demo_customer_estimate_delivery_events(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),link_id UUID NOT NULL REFERENCES public.demo_customer_estimate_delivery_links(id),kind TEXT NOT NULL CHECK(kind IN('revoked','accepted','question')),
 body JSONB NOT NULL,request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(link_id,kind,request_key_hash),CHECK(octet_length(body::text)<=16384)
);
CREATE INDEX demo_customer_estimate_delivery_events_history ON public.demo_customer_estimate_delivery_events(link_id,created_at,id);

CREATE FUNCTION public.customer_estimate_delivery_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$BEGIN RAISE EXCEPTION 'Customer estimate delivery evidence is immutable' USING ERRCODE='23514';END$$;
CREATE TRIGGER canonical_customer_estimate_delivery_links_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_estimate_delivery_links FOR EACH STATEMENT EXECUTE FUNCTION public.customer_estimate_delivery_immutable();
CREATE TRIGGER canonical_customer_estimate_delivery_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_estimate_delivery_events FOR EACH STATEMENT EXECUTE FUNCTION public.customer_estimate_delivery_immutable();
CREATE TRIGGER demo_customer_estimate_delivery_links_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.demo_customer_estimate_delivery_links FOR EACH STATEMENT EXECUTE FUNCTION public.customer_estimate_delivery_immutable();
CREATE TRIGGER demo_customer_estimate_delivery_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.demo_customer_estimate_delivery_events FOR EACH STATEMENT EXECUTE FUNCTION public.customer_estimate_delivery_immutable();

CREATE FUNCTION public.customer_estimate_delivery_link_projection(link_row public.canonical_customer_estimate_delivery_links) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',link_row.id,'versionId',link_row.version_id,'versionRevision',v.revision,'createdAt',link_row.created_at,'expiresAt',link_row.expires_at,
  'status',CASE WHEN revoked.id IS NOT NULL THEN 'revoked' WHEN link_row.expires_at<=clock_timestamp() THEN 'expired' WHEN accepted.id IS NOT NULL THEN 'accepted' ELSE 'active' END,
  'accepted',CASE WHEN accepted.id IS NOT NULL THEN jsonb_build_object('customerName',accepted.body->>'customerName','createdAt',accepted.created_at) END,
  'questionCount',(SELECT count(*) FROM public.canonical_customer_estimate_delivery_events q WHERE q.link_id=link_row.id AND q.kind='question'),
  'questions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'customerName',q.body->>'customerName','replyTo',q.body->>'replyTo','message',q.body->>'message','createdAt',q.created_at) ORDER BY q.created_at DESC) FROM public.canonical_customer_estimate_delivery_events q WHERE q.link_id=link_row.id AND q.kind='question'),'[]'::jsonb),'digest',link_row.digest)
 FROM public.canonical_customer_estimate_versions v
 LEFT JOIN LATERAL(SELECT e.* FROM public.canonical_customer_estimate_delivery_events e WHERE e.link_id=link_row.id AND e.kind='revoked' ORDER BY e.created_at LIMIT 1)revoked ON TRUE
 LEFT JOIN LATERAL(SELECT e.* FROM public.canonical_customer_estimate_delivery_events e WHERE e.link_id=link_row.id AND e.kind='accepted' ORDER BY e.created_at LIMIT 1)accepted ON TRUE
 WHERE v.organization_id=link_row.organization_id AND v.estimate_id=link_row.estimate_id AND v.id=link_row.version_id
$$;

CREATE FUNCTION public.canonical_customer_estimate_delivery_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows_value JSONB;total_value BIGINT;
BEGIN
 IF current_setting('transaction_isolation') NOT IN('repeatable read','serializable') OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Protected estimate delivery read required' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_estimate_decision_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 SELECT count(*) INTO total_value FROM public.canonical_customer_estimate_delivery_links WHERE organization_id=org AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(public.customer_estimate_delivery_link_projection(x) ORDER BY created_at DESC),'[]'::jsonb) INTO rows_value FROM(SELECT * FROM public.canonical_customer_estimate_delivery_links WHERE organization_id=org AND estimate_id=estimate ORDER BY created_at DESC LIMIT 50)x;
 RETURN jsonb_build_object('links',rows_value,'total',total_value,'truncated',total_value>50);
END$$;

CREATE FUNCTION public.canonical_customer_estimate_delivery_create(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,version UUID,token_value TEXT,expiry TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_customer_estimate_delivery_links%ROWTYPE;inserted public.canonical_customer_estimate_delivery_links%ROWTYPE;key_hash TEXT;request_hash TEXT;
BEGIN
 authority:=public.canonical_commercial_lock(org,actor,role_value,session_value,estimate,csrf);
 IF role_value NOT IN('owner','admin') OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR token_value!~'^[a-f0-9]{64}$' OR expiry<=clock_timestamp()+interval '15 minutes' OR expiry>clock_timestamp()+interval '30 days' THEN RAISE EXCEPTION 'Estimate link input invalid' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_customer_estimate_versions v WHERE v.organization_id=org AND v.estimate_id=estimate AND v.id=version) THEN RAISE EXCEPTION 'Issued estimate unavailable' USING ERRCODE='P0002';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'version',version,'tokenHash',token_value,'expiresAt',expiry));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':estimate-delivery:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_customer_estimate_delivery_links WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Estimate link attempt changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('link',public.customer_estimate_delivery_link_projection(old),'replayed',TRUE);END IF;
 INSERT INTO public.canonical_customer_estimate_delivery_links(organization_id,estimate_id,version_id,token_hash,actor_user_id,membership_id,auth_session_id,expires_at,request_key_hash,request_digest,digest)
 VALUES(org,estimate,version,token_value,actor,(authority->>'membershipId')::uuid,session_value,expiry,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('organization',org,'estimate',estimate,'version',version,'tokenHash',token_value,'expiresAt',expiry,'actor',actor))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('link',public.customer_estimate_delivery_link_projection(inserted),'replayed',FALSE);
END$$;

CREATE FUNCTION public.canonical_customer_estimate_delivery_revoke(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,link_value UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE link_row public.canonical_customer_estimate_delivery_links%ROWTYPE;old public.canonical_customer_estimate_delivery_events%ROWTYPE;inserted public.canonical_customer_estimate_delivery_events%ROWTYPE;key_hash TEXT;request_hash TEXT;body_value JSONB;
BEGIN
 PERFORM public.canonical_commercial_lock(org,actor,role_value,session_value,estimate,csrf);IF role_value NOT IN('owner','admin') OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Estimate link revoke input invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO link_row FROM public.canonical_customer_estimate_delivery_links WHERE organization_id=org AND estimate_id=estimate AND id=link_value FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Estimate link unavailable' USING ERRCODE='P0002';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');body_value:=jsonb_build_object('reason','Owner revoked customer access');request_hash:=public.canonical_completion_digest(jsonb_build_object('link',link_value,'body',body_value));
 SELECT * INTO old FROM public.canonical_customer_estimate_delivery_events WHERE link_id=link_value AND kind='revoked' AND request_key_hash=key_hash;IF FOUND THEN IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Revoke attempt changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('link',public.customer_estimate_delivery_link_projection(link_row),'replayed',TRUE);END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_customer_estimate_delivery_events WHERE link_id=link_value AND kind='revoked') THEN RETURN jsonb_build_object('link',public.customer_estimate_delivery_link_projection(link_row),'replayed',TRUE);END IF;
 INSERT INTO public.canonical_customer_estimate_delivery_events(organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,request_key_hash,request_digest,digest)VALUES(org,estimate,link_row.version_id,link_value,'revoked',body_value,actor,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('link',link_value,'kind','revoked','actor',actor)))RETURNING * INTO inserted;
 RETURN jsonb_build_object('link',public.customer_estimate_delivery_link_projection(link_row),'replayed',FALSE);
END$$;

CREATE FUNCTION public.demo_customer_estimate_delivery_create(source_token TEXT,tenant UUID,estimate TEXT,version TEXT,document_value JSONB,key_hash TEXT,request_hash TEXT,token_value TEXT,expiry TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE session_row public.demo_command_center_sessions%ROWTYPE;old public.demo_customer_estimate_delivery_links%ROWTYPE;inserted public.demo_customer_estimate_delivery_links%ROWTYPE;found_document JSONB;
BEGIN
 IF source_token!~'^[a-f0-9]{64}$' OR key_hash!~'^[a-f0-9]{64}$' OR request_hash!~'^[a-f0-9]{64}$' OR token_value!~'^[a-f0-9]{64}$' OR expiry<=clock_timestamp()+interval '15 minutes' OR expiry>clock_timestamp()+interval '24 hours' THEN RAISE EXCEPTION 'Demo estimate link input invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO session_row FROM public.demo_command_center_sessions WHERE token_hash=source_token AND tenant_id=tenant AND expires_at>clock_timestamp() FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Demo session unavailable' USING ERRCODE='P0002';END IF;
 SELECT item INTO found_document FROM jsonb_array_elements(COALESCE(session_row.state->'customerEstimateVersions'->estimate,'[]'::jsonb)) item WHERE item->>'id'=version LIMIT 1;
 IF found_document IS NULL OR found_document->'document' IS DISTINCT FROM document_value OR document_value->>'state'<>'issued' THEN RAISE EXCEPTION 'Issued demo estimate changed' USING ERRCODE='40001';END IF;
 SELECT * INTO old FROM public.demo_customer_estimate_delivery_links WHERE source_token_hash=source_token AND request_key_hash=key_hash;IF FOUND THEN IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Demo estimate link attempt changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('link',jsonb_build_object('id',old.id,'versionId',old.version_id,'createdAt',old.created_at,'expiresAt',old.expires_at,'status',CASE WHEN EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events e WHERE e.link_id=old.id AND e.kind='revoked') THEN 'revoked' WHEN old.expires_at<=clock_timestamp() THEN 'expired' WHEN EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events e WHERE e.link_id=old.id AND e.kind='accepted') THEN 'accepted' ELSE 'active' END),'replayed',TRUE);END IF;
 INSERT INTO public.demo_customer_estimate_delivery_links(tenant_id,source_token_hash,estimate_id,version_id,token_hash,document,expires_at,request_key_hash,request_digest,digest)VALUES(tenant,source_token,estimate,version,token_value,document_value,expiry,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('tenant',tenant,'estimate',estimate,'version',version,'tokenHash',token_value,'expiresAt',expiry)))RETURNING * INTO inserted;
 RETURN jsonb_build_object('link',jsonb_build_object('id',inserted.id,'versionId',inserted.version_id,'createdAt',inserted.created_at,'expiresAt',inserted.expires_at,'status','active'),'replayed',FALSE);
END$$;

CREATE FUNCTION public.demo_customer_estimate_delivery_read(source_token TEXT,tenant UUID,estimate TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows_value JSONB;total_value BIGINT;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.demo_command_center_sessions WHERE token_hash=source_token AND tenant_id=tenant AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Demo session unavailable' USING ERRCODE='P0002';END IF;
 SELECT count(*) INTO total_value FROM public.demo_customer_estimate_delivery_links WHERE source_token_hash=source_token AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'versionId',l.version_id,'createdAt',l.created_at,'expiresAt',l.expires_at,'status',CASE WHEN EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events e WHERE e.link_id=l.id AND e.kind='revoked') THEN 'revoked' WHEN l.expires_at<=clock_timestamp() THEN 'expired' WHEN EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events e WHERE e.link_id=l.id AND e.kind='accepted') THEN 'accepted' ELSE 'active' END,'accepted',(SELECT jsonb_build_object('customerName',e.body->>'customerName','createdAt',e.created_at) FROM public.demo_customer_estimate_delivery_events e WHERE e.link_id=l.id AND e.kind='accepted' ORDER BY e.created_at LIMIT 1),'questionCount',(SELECT count(*) FROM public.demo_customer_estimate_delivery_events e WHERE e.link_id=l.id AND e.kind='question'),'questions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'customerName',e.body->>'customerName','replyTo',e.body->>'replyTo','message',e.body->>'message','createdAt',e.created_at) ORDER BY e.created_at DESC)FROM public.demo_customer_estimate_delivery_events e WHERE e.link_id=l.id AND e.kind='question'),'[]'::jsonb))ORDER BY l.created_at DESC),'[]'::jsonb)INTO rows_value FROM(SELECT * FROM public.demo_customer_estimate_delivery_links WHERE source_token_hash=source_token AND estimate_id=estimate ORDER BY created_at DESC LIMIT 50)l;
 RETURN jsonb_build_object('links',rows_value,'total',total_value,'truncated',total_value>50);
END$$;

CREATE FUNCTION public.demo_customer_estimate_delivery_revoke(source_token TEXT,tenant UUID,estimate TEXT,link_value UUID,key_hash TEXT,request_hash TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE link_row public.demo_customer_estimate_delivery_links%ROWTYPE;body_value JSONB:=jsonb_build_object('reason','Demo reviewer revoked customer access');
BEGIN
 IF key_hash!~'^[a-f0-9]{64}$' OR request_hash!~'^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.demo_command_center_sessions WHERE token_hash=source_token AND tenant_id=tenant AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Demo estimate link revoke invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO link_row FROM public.demo_customer_estimate_delivery_links WHERE source_token_hash=source_token AND estimate_id=estimate AND id=link_value;IF NOT FOUND THEN RAISE EXCEPTION 'Demo estimate link unavailable' USING ERRCODE='P0002';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events WHERE link_id=link_value AND kind='revoked') THEN INSERT INTO public.demo_customer_estimate_delivery_events(link_id,kind,body,request_key_hash,request_digest,digest)VALUES(link_value,'revoked',body_value,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('link',link_value,'kind','revoked')));END IF;
 RETURN public.demo_customer_estimate_delivery_read(source_token,tenant,estimate);
END$$;

CREATE FUNCTION public.customer_estimate_delivery_public_read(token_value TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE link_row public.canonical_customer_estimate_delivery_links%ROWTYPE;demo_row public.demo_customer_estimate_delivery_links%ROWTYPE;document_value JSONB;accepted public.canonical_customer_estimate_delivery_events%ROWTYPE;demo_accepted public.demo_customer_estimate_delivery_events%ROWTYPE;
BEGIN
 IF token_value!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO link_row FROM public.canonical_customer_estimate_delivery_links WHERE token_hash=token_value;
 IF FOUND THEN
  IF link_row.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM public.canonical_customer_estimate_delivery_events WHERE link_id=link_row.id AND kind='revoked') THEN RAISE EXCEPTION 'Estimate link unavailable' USING ERRCODE='P0001';END IF;
  SELECT document INTO document_value FROM public.canonical_customer_estimate_versions WHERE organization_id=link_row.organization_id AND estimate_id=link_row.estimate_id AND id=link_row.version_id;
  SELECT * INTO accepted FROM public.canonical_customer_estimate_delivery_events WHERE link_id=link_row.id AND kind='accepted' ORDER BY created_at LIMIT 1;
  RETURN jsonb_build_object('mode','paid','linkId',link_row.id,'versionId',link_row.version_id,'document',document_value,'expiresAt',link_row.expires_at,'accepted',CASE WHEN accepted.id IS NOT NULL THEN jsonb_build_object('customerName',accepted.body->>'customerName','createdAt',accepted.created_at) END);
 END IF;
 SELECT * INTO demo_row FROM public.demo_customer_estimate_delivery_links WHERE token_hash=token_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 IF demo_row.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events WHERE link_id=demo_row.id AND kind='revoked') THEN RAISE EXCEPTION 'Estimate link unavailable' USING ERRCODE='P0001';END IF;
 SELECT * INTO demo_accepted FROM public.demo_customer_estimate_delivery_events WHERE link_id=demo_row.id AND kind='accepted' ORDER BY created_at LIMIT 1;
 RETURN jsonb_build_object('mode','demo','linkId',demo_row.id,'versionId',demo_row.version_id,'document',demo_row.document,'expiresAt',demo_row.expires_at,'accepted',CASE WHEN demo_accepted.id IS NOT NULL THEN jsonb_build_object('customerName',demo_accepted.body->>'customerName','createdAt',demo_accepted.created_at) END);
END$$;

CREATE FUNCTION public.customer_estimate_delivery_public_mutate(token_value TEXT,kind_value TEXT,key_hash TEXT,request_hash TEXT,body_value JSONB,remote_hash TEXT,agent_hash TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE canonical_link public.canonical_customer_estimate_delivery_links%ROWTYPE;demo_link public.demo_customer_estimate_delivery_links%ROWTYPE;old_c public.canonical_customer_estimate_delivery_events%ROWTYPE;old_d public.demo_customer_estimate_delivery_events%ROWTYPE;inserted_id UUID;inserted_at TIMESTAMPTZ;event_body JSONB;question_count BIGINT;
BEGIN
 IF token_value!~'^[a-f0-9]{64}$' OR kind_value NOT IN('accepted','question') OR key_hash!~'^[a-f0-9]{64}$' OR request_hash!~'^[a-f0-9]{64}$' OR remote_hash!~'^[a-f0-9]{64}$' OR agent_hash!~'^[a-f0-9]{64}$' OR jsonb_typeof(body_value)<>'object' OR octet_length(body_value::text)>8192 THEN RAISE EXCEPTION 'Customer response invalid' USING ERRCODE='22023';END IF;
 IF kind_value='accepted' THEN
  IF public.canonical_field_evidence_object_keys_exact(body_value,ARRAY['customerName','confirmed','confirmationVersion']) IS NOT TRUE OR body_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body_value->>'confirmationVersion'<>'customer-estimate-accept-v1' OR length(btrim(body_value->>'customerName')) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Customer acceptance invalid' USING ERRCODE='22023';END IF;
 ELSE
  IF public.canonical_field_evidence_object_keys_exact(body_value,ARRAY['customerName','replyTo','message','confirmed','confirmationVersion']) IS NOT TRUE OR body_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body_value->>'confirmationVersion'<>'customer-estimate-question-v1' OR length(btrim(body_value->>'customerName')) NOT BETWEEN 2 AND 160 OR length(btrim(body_value->>'replyTo')) NOT BETWEEN 3 AND 254 OR length(btrim(body_value->>'message')) NOT BETWEEN 3 AND 4000 THEN RAISE EXCEPTION 'Customer question invalid' USING ERRCODE='22023';END IF;
 END IF;
 event_body:=body_value||jsonb_build_object('remoteAddressHash',remote_hash,'userAgentHash',agent_hash);
 SELECT * INTO canonical_link FROM public.canonical_customer_estimate_delivery_links WHERE token_hash=token_value FOR SHARE;
 IF FOUND THEN
  IF canonical_link.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM public.canonical_customer_estimate_delivery_events WHERE link_id=canonical_link.id AND kind='revoked') THEN RAISE EXCEPTION 'Estimate link unavailable' USING ERRCODE='P0001';END IF;
  SELECT * INTO old_c FROM public.canonical_customer_estimate_delivery_events WHERE link_id=canonical_link.id AND kind=kind_value AND request_key_hash=key_hash;IF FOUND THEN IF old_c.request_digest<>request_hash THEN RAISE EXCEPTION 'Customer response changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('eventId',old_c.id,'kind',old_c.kind,'createdAt',old_c.created_at,'replayed',TRUE);END IF;
  IF kind_value='accepted' AND EXISTS(SELECT 1 FROM public.canonical_customer_estimate_delivery_events WHERE link_id=canonical_link.id AND kind='accepted') THEN RAISE EXCEPTION 'Estimate already accepted' USING ERRCODE='23505';END IF;
  SELECT count(*) INTO question_count FROM public.canonical_customer_estimate_delivery_events WHERE link_id=canonical_link.id AND kind='question';IF kind_value='question' AND question_count>=20 THEN RAISE EXCEPTION 'Question capacity reached' USING ERRCODE='54000';END IF;
  INSERT INTO public.canonical_customer_estimate_delivery_events(organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,request_key_hash,request_digest,digest)VALUES(canonical_link.organization_id,canonical_link.estimate_id,canonical_link.version_id,canonical_link.id,kind_value,event_body,NULL,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('link',canonical_link.id,'version',canonical_link.version_id,'kind',kind_value,'body',event_body)))RETURNING id,created_at INTO inserted_id,inserted_at;
 ELSE
  SELECT * INTO demo_link FROM public.demo_customer_estimate_delivery_links WHERE token_hash=token_value FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
  IF demo_link.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events WHERE link_id=demo_link.id AND kind='revoked') THEN RAISE EXCEPTION 'Estimate link unavailable' USING ERRCODE='P0001';END IF;
  SELECT * INTO old_d FROM public.demo_customer_estimate_delivery_events WHERE link_id=demo_link.id AND kind=kind_value AND request_key_hash=key_hash;IF FOUND THEN IF old_d.request_digest<>request_hash THEN RAISE EXCEPTION 'Customer response changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('eventId',old_d.id,'kind',old_d.kind,'createdAt',old_d.created_at,'replayed',TRUE);END IF;
  IF kind_value='accepted' AND EXISTS(SELECT 1 FROM public.demo_customer_estimate_delivery_events WHERE link_id=demo_link.id AND kind='accepted') THEN RAISE EXCEPTION 'Estimate already accepted' USING ERRCODE='23505';END IF;
  SELECT count(*) INTO question_count FROM public.demo_customer_estimate_delivery_events WHERE link_id=demo_link.id AND kind='question';IF kind_value='question' AND question_count>=20 THEN RAISE EXCEPTION 'Question capacity reached' USING ERRCODE='54000';END IF;
  INSERT INTO public.demo_customer_estimate_delivery_events(link_id,kind,body,request_key_hash,request_digest,digest)VALUES(demo_link.id,kind_value,event_body,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('link',demo_link.id,'version',demo_link.version_id,'kind',kind_value,'body',event_body)))RETURNING id,created_at INTO inserted_id,inserted_at;
 END IF;
 RETURN jsonb_build_object('eventId',inserted_id,'kind',kind_value,'createdAt',inserted_at,'replayed',FALSE);
END$$;
