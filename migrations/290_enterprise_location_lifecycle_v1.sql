-- Mission 29 Part 1D. Explicitly reviewed company-scoped location lifecycle.
-- No legacy office adoption, Business Profile rewrite, record transfer, or backfill.

CREATE FUNCTION public.canonical_enterprise_location_v1_keys(v JSONB, fields TEXT[])
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(v)='object' THEN
   COALESCE((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) AS t(k)),ARRAY[]::TEXT[])=
   COALESCE((SELECT array_agg(k ORDER BY k) FROM unnest(fields) AS t(k)),ARRAY[]::TEXT[])
 ELSE FALSE END
$$;

CREATE FUNCTION public.canonical_enterprise_location_v1_uuid(v TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(length(v)=36 AND v~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',FALSE)
$$;

CREATE FUNCTION public.canonical_enterprise_location_v1_text(v JSONB, maximum INTEGER, nullable BOOLEAN)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN v='null'::JSONB THEN nullable ELSE
   COALESCE(jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN 1 AND maximum
     AND octet_length(v#>>'{}')<=maximum*4 AND btrim(v#>>'{}')=v#>>'{}'
     AND (v#>>'{}')!~'[[:cntrl:]]',FALSE) END
$$;

CREATE FUNCTION public.canonical_enterprise_location_v1_pin(v JSONB, empty_allowed BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF public.canonical_enterprise_location_v1_keys(v,ARRAY['id','revision','digest']) IS NOT TRUE THEN RETURN FALSE; END IF;
 IF v->'revision'='0'::JSONB AND v->'id'='null'::JSONB AND v->'digest'='null'::JSONB THEN RETURN empty_allowed; END IF;
 RETURN COALESCE(jsonb_typeof(v->'id')='string' AND public.canonical_enterprise_location_v1_uuid(v->>'id')
   AND jsonb_typeof(v->'revision')='number' AND (v->>'revision')~'^[1-9][0-9]{0,9}$'
   AND (v->>'revision')::NUMERIC<=2147483647 AND jsonb_typeof(v->'digest')='string'
   AND length(v->>'digest')=64 AND (v->>'digest')~'^[0-9a-f]{64}$',FALSE);
END $$;

CREATE FUNCTION public.canonical_enterprise_location_v1_digest(v JSONB)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT encode(sha256(convert_to('northstar.enterprise.location-lifecycle.v1:'||v::TEXT,'UTF8')),'hex')
$$;

CREATE TABLE public.canonical_enterprise_location_revisions_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 location_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 organization_revision INTEGER NOT NULL CHECK(organization_revision>0),
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 previous_id UUID,
 previous_digest TEXT,
 action TEXT NOT NULL CHECK(action IN('create','activate','deactivate','rename','correct','relocate','transfer')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160 AND btrim(name)=name AND name!~'[[:cntrl:]]'),
 address TEXT CHECK(address IS NULL OR (length(address) BETWEEN 1 AND 500 AND btrim(address)=address AND address!~'[[:cntrl:]]')),
 state TEXT NOT NULL CHECK(state IN('inactive','active','transferred')),
 corrected_id UUID,
 transfer_location_id UUID,
 transfer_revision_id UUID,
 transfer_revision INTEGER,
 transfer_digest TEXT,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000 AND btrim(reason)=reason AND reason!~'[[:cntrl:]]'),
 request_key UUID NOT NULL,
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64 AND request_digest~'^[0-9a-f]{64}$'),
 request_document JSONB NOT NULL,
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64 AND review_digest~'^[0-9a-f]{64}$'),
 profile_pin JSONB NOT NULL,
 actor_user_id UUID NOT NULL,
 actor_session_id UUID NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,location_id,revision),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,location_id,id),
 UNIQUE(organization_id,request_key),
 UNIQUE(organization_id,organization_revision),
 FOREIGN KEY(organization_id,location_id,previous_id)
   REFERENCES public.canonical_enterprise_location_revisions_v1(organization_id,location_id,id),
 FOREIGN KEY(organization_id,location_id,corrected_id)
   REFERENCES public.canonical_enterprise_location_revisions_v1(organization_id,location_id,id),
 FOREIGN KEY(organization_id,transfer_location_id,transfer_revision_id)
   REFERENCES public.canonical_enterprise_location_revisions_v1(organization_id,location_id,id),
 CHECK((revision=1 AND action='create' AND previous_id IS NULL AND previous_digest IS NULL AND state='inactive')
    OR (revision>1 AND action<>'create' AND previous_id IS NOT NULL AND previous_digest IS NOT NULL AND length(previous_digest)=64 AND previous_digest~'^[0-9a-f]{64}$')),
 CHECK((action='correct')=(corrected_id IS NOT NULL)),
 CHECK((state='transferred' AND transfer_location_id IS NOT NULL AND transfer_location_id<>location_id
     AND transfer_revision_id IS NOT NULL AND transfer_revision IS NOT NULL AND transfer_digest IS NOT NULL
     AND transfer_revision>0 AND length(transfer_digest)=64 AND transfer_digest~'^[0-9a-f]{64}$')
    OR (state<>'transferred' AND transfer_location_id IS NULL AND transfer_revision_id IS NULL AND transfer_revision IS NULL AND transfer_digest IS NULL))
);

CREATE INDEX canonical_enterprise_location_revisions_v1_latest
 ON public.canonical_enterprise_location_revisions_v1(organization_id,location_id,revision DESC);

CREATE FUNCTION public.canonical_enterprise_location_v1_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Location history is immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER canonical_enterprise_location_revisions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_enterprise_location_revisions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_enterprise_location_v1_immutable();

ALTER TABLE public.canonical_enterprise_location_revisions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_enterprise_location_revisions_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_enterprise_location_revisions_v1_tenant
 ON public.canonical_enterprise_location_revisions_v1
 USING(organization_id::TEXT=current_setting('northstar.enterprise_company_id',TRUE))
 WITH CHECK(organization_id::TEXT=current_setting('northstar.enterprise_company_id',TRUE));

CREATE FUNCTION public.canonical_enterprise_location_v1_authority(
 org UUID, actor UUID, role_value TEXT, session_value UUID, csrf TEXT, mutation_required BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a RECORD; moment TIMESTAMPTZ; source JSONB; basis JSONB; write_intent BOOLEAN:=mutation_required OR csrf IS NOT NULL;
BEGIN
 IF org IS NULL OR actor IS NULL OR session_value IS NULL OR role_value IS NULL OR mutation_required IS NULL THEN
  RAISE EXCEPTION 'Current location authority unavailable' USING ERRCODE='42501'; END IF;
 IF mutation_required THEN
  PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);
  -- A profile replaced while this SERIALIZABLE request waited must force a
  -- fresh transaction snapshot, rather than validating its retired old row.
  PERFORM 1 FROM public.canonical_business_profiles WHERE organization_id=org AND is_active=TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current location profile unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT u.id,u.organization_id,u.status AS user_status,u.updated_at AS actor_updated,
   m.id AS membership_id,m.role,m.status AS membership_status,m.revoked_at AS membership_revoked,m.updated_at AS membership_updated,
   s.id AS session_id,s.status AS session_status,s.revoked_at AS session_revoked,s.created_at AS session_created,
   s.access_expires_at,s.refresh_expires_at,s.csrf_token_hash,o.status AS onboarding_status,
   subscription.status AS subscription_status,subscription.trial_started_at,subscription.trial_ends_at,
   p.id AS profile_id,p.version_label,p.normalized_profile_hash
 INTO a
 FROM public.auth_sessions s
 JOIN public.users u ON u.id=s.user_id AND u.organization_id=s.organization_id
 JOIN public.organization_memberships m ON m.id=s.membership_id AND m.organization_id=s.organization_id AND m.user_id=u.id
 JOIN public.organizations company ON company.id=s.organization_id
 JOIN public.organization_onboarding o ON o.organization_id=company.id
 LEFT JOIN public.canonical_business_profiles p ON p.organization_id=company.id AND p.is_active=TRUE
 LEFT JOIN LATERAL(SELECT status,trial_started_at,trial_ends_at FROM public.subscriptions WHERE organization_id=company.id LIMIT 1) subscription ON TRUE
 WHERE s.id=session_value AND s.user_id=actor AND s.organization_id=org;
 moment:=clock_timestamp();
 IF NOT FOUND OR (a.user_status='active' AND a.membership_status='active' AND a.membership_revoked IS NULL
    AND a.session_status='active' AND a.session_revoked IS NULL AND a.access_expires_at>moment AND a.refresh_expires_at>moment
    AND a.role=role_value AND role_value IN('owner','admin','member','viewer')) IS NOT TRUE THEN
  RAISE EXCEPTION 'Current location authority unavailable' USING ERRCODE='42501'; END IF;
 IF write_intent AND ((role_value IN('owner','admin') AND a.onboarding_status='complete'
    AND length(csrf) BETWEEN 32 AND 512 AND encode(sha256(convert_to(csrf,'UTF8')),'hex')=rtrim(a.csrf_token_hash)
    AND (a.subscription_status='active' OR (a.subscription_status='trialing' AND a.trial_started_at IS NOT NULL
      AND a.trial_ends_at=a.trial_started_at+INTERVAL '14 days' AND a.trial_ends_at>moment))) IS NOT TRUE) THEN
  RAISE EXCEPTION 'Current location write authority unavailable' USING ERRCODE='42501'; END IF;
 IF a.profile_id IS NULL THEN RAISE EXCEPTION 'Current location profile unavailable' USING ERRCODE='55000'; END IF;
 source:=jsonb_build_object('id',a.profile_id,'version',a.version_label,'hash',rtrim(a.normalized_profile_hash));
 basis:=jsonb_build_array(org,actor,role_value,session_value,a.membership_id,
   to_char(a.actor_updated AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   to_char(a.membership_updated AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   to_char(a.session_created AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   to_char(a.access_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   to_char(a.refresh_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),rtrim(a.csrf_token_hash),source);
 PERFORM set_config('northstar.enterprise_company_id',org::TEXT,TRUE);
 RETURN jsonb_build_object('profilePin',source,'binding',public.canonical_enterprise_location_v1_digest(basis));
END $$;

CREATE FUNCTION public.canonical_enterprise_location_v1_projection(r public.canonical_enterprise_location_revisions_v1)
RETURNS JSONB LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('locationId',r.location_id,'pin',jsonb_build_object('id',r.id,'revision',r.revision,'digest',r.digest),
  'previous',CASE WHEN r.previous_id IS NULL THEN NULL ELSE jsonb_build_object('id',r.previous_id,'revision',r.revision-1,'digest',r.previous_digest)END,
  'organizationRevision',r.organization_revision,'action',r.action,'name',r.name,'address',r.address,'state',r.state,'reason',r.reason,
  'correctedRevisionId',r.corrected_id,
  'transferTarget',CASE WHEN r.transfer_location_id IS NULL THEN NULL ELSE jsonb_build_object('locationId',r.transfer_location_id,
    'id',r.transfer_revision_id,'revision',r.transfer_revision,'digest',r.transfer_digest)END,
  'profilePin',r.profile_pin,'actorUserId',r.actor_user_id,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

CREATE FUNCTION public.canonical_enterprise_location_v1_plan(org UUID, authority JSONB, body JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_enterprise_location_revisions_v1%ROWTYPE;
 target_row public.canonical_enterprise_location_revisions_v1%ROWTYPE;
 corrected_row public.canonical_enterprise_location_revisions_v1%ROWTYPE;
 location_value UUID; action_value TEXT; change JSONB; previous JSONB; transfer_value JSONB;
 name_value TEXT; address_value TEXT; state_value TEXT; corrected_value UUID; review_value TEXT;
BEGIN
 IF (public.canonical_enterprise_location_v1_keys(body,ARRAY['contract','action','locationId','expected','change','reason','profilePin'])
   AND body->'contract'=to_jsonb('northstar.enterprise.location-lifecycle.v1'::TEXT)
   AND jsonb_typeof(body->'action')='string' AND body->>'action' IN('create','activate','deactivate','rename','correct','relocate','transfer')
   AND jsonb_typeof(body->'locationId')='string' AND public.canonical_enterprise_location_v1_uuid(body->>'locationId')
   AND public.canonical_enterprise_location_v1_pin(body->'expected',body->>'action'='create')
   AND public.canonical_enterprise_location_v1_text(body->'reason',2000,FALSE)
   AND public.canonical_enterprise_location_v1_keys(body->'profilePin',ARRAY['id','version','hash'])) IS NOT TRUE THEN
  RAISE EXCEPTION 'Location review entries invalid' USING ERRCODE='22023'; END IF;
 IF body->'profilePin' IS DISTINCT FROM authority->'profilePin' THEN
  RAISE EXCEPTION 'Location review source changed' USING ERRCODE='40001'; END IF;
 location_value:=(body->>'locationId')::UUID; action_value:=body->>'action'; change:=body->'change';
 SELECT * INTO current_row FROM public.canonical_enterprise_location_revisions_v1
  WHERE organization_id=org AND location_id=location_value ORDER BY revision DESC LIMIT 1;
 previous:=CASE WHEN current_row.id IS NULL THEN jsonb_build_object('id',NULL,'revision',0,'digest',NULL)
   ELSE jsonb_build_object('id',current_row.id,'revision',current_row.revision,'digest',current_row.digest)END;
 IF body->'expected' IS DISTINCT FROM previous THEN
  RAISE EXCEPTION 'Location review head changed' USING ERRCODE='40001'; END IF;
 IF current_row.id IS NULL AND action_value<>'create' THEN RAISE EXCEPTION 'Location unavailable' USING ERRCODE='P0002'; END IF;
 IF current_row.id IS NOT NULL AND action_value='create' THEN RAISE EXCEPTION 'Location identity already exists' USING ERRCODE='40001'; END IF;
 IF current_row.state='transferred' THEN RAISE EXCEPTION 'Transferred location is terminal' USING ERRCODE='22023'; END IF;
 IF current_row.revision=2147483647 THEN RAISE EXCEPTION 'Location history bound reached' USING ERRCODE='54000'; END IF;
 name_value:=current_row.name; address_value:=current_row.address; state_value:=current_row.state;
 transfer_value:=CASE WHEN current_row.transfer_location_id IS NULL THEN NULL ELSE jsonb_build_object(
  'locationId',current_row.transfer_location_id,'id',current_row.transfer_revision_id,
  'revision',current_row.transfer_revision,'digest',current_row.transfer_digest)END;
 IF action_value='create' THEN
  IF (public.canonical_enterprise_location_v1_keys(change,ARRAY['name','address'])
    AND public.canonical_enterprise_location_v1_text(change->'name',160,FALSE)
    AND public.canonical_enterprise_location_v1_text(change->'address',500,TRUE)) IS NOT TRUE THEN
   RAISE EXCEPTION 'Location creation entries invalid' USING ERRCODE='22023'; END IF;
  name_value:=change->>'name'; address_value:=change->>'address'; state_value:='inactive';
 ELSIF action_value IN('activate','deactivate') THEN
  IF public.canonical_enterprise_location_v1_keys(change,ARRAY[]::TEXT[]) IS NOT TRUE
    OR state_value IS DISTINCT FROM (CASE WHEN action_value='activate' THEN 'inactive' ELSE 'active' END) THEN
   RAISE EXCEPTION 'Location state transition unavailable' USING ERRCODE='22023'; END IF;
  state_value:=CASE WHEN action_value='activate' THEN 'active' ELSE 'inactive' END;
 ELSIF action_value='rename' THEN
  IF (public.canonical_enterprise_location_v1_keys(change,ARRAY['name'])
    AND public.canonical_enterprise_location_v1_text(change->'name',160,FALSE)
    AND change->>'name' IS DISTINCT FROM name_value) IS NOT TRUE THEN
   RAISE EXCEPTION 'Location naming entries invalid' USING ERRCODE='22023'; END IF;
  name_value:=change->>'name';
 ELSIF action_value='relocate' THEN
  IF (public.canonical_enterprise_location_v1_keys(change,ARRAY['address'])
    AND public.canonical_enterprise_location_v1_text(change->'address',500,FALSE)
    AND change->>'address' IS DISTINCT FROM address_value AND state_value IN('inactive','active')) IS NOT TRUE THEN
   RAISE EXCEPTION 'Location relocation unavailable' USING ERRCODE='22023'; END IF;
  address_value:=change->>'address';
 ELSIF action_value='correct' THEN
  IF (public.canonical_enterprise_location_v1_keys(change,ARRAY['name','address','correctedRevision'])
    AND public.canonical_enterprise_location_v1_text(change->'name',160,FALSE)
    AND public.canonical_enterprise_location_v1_text(change->'address',500,TRUE)
    AND public.canonical_enterprise_location_v1_pin(change->'correctedRevision',FALSE)) IS NOT TRUE THEN
   RAISE EXCEPTION 'Location correction entries invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO corrected_row FROM public.canonical_enterprise_location_revisions_v1
   WHERE organization_id=org AND location_id=location_value AND id=(change#>>'{correctedRevision,id}')::UUID;
  IF corrected_row.id IS NULL OR change->'correctedRevision' IS DISTINCT FROM
     jsonb_build_object('id',corrected_row.id,'revision',corrected_row.revision,'digest',corrected_row.digest) THEN
   RAISE EXCEPTION 'Location correction target unavailable' USING ERRCODE='40001'; END IF;
  name_value:=change->>'name'; address_value:=change->>'address'; corrected_value:=corrected_row.id;
 ELSIF action_value='transfer' THEN
  IF (public.canonical_enterprise_location_v1_keys(change,ARRAY['target'])
    AND public.canonical_enterprise_location_v1_keys(change->'target',ARRAY['locationId','pin'])
    AND jsonb_typeof(change#>'{target,locationId}')='string'
    AND public.canonical_enterprise_location_v1_uuid(change#>>'{target,locationId}')
    AND (change#>>'{target,locationId}')::UUID<>location_value
    AND public.canonical_enterprise_location_v1_pin(change#>'{target,pin}',FALSE)
    AND state_value IN('inactive','active')) IS NOT TRUE THEN
   RAISE EXCEPTION 'Location transfer entries invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO target_row FROM public.canonical_enterprise_location_revisions_v1
   WHERE organization_id=org AND location_id=(change#>>'{target,locationId}')::UUID ORDER BY revision DESC LIMIT 1;
  IF target_row.id IS NULL OR target_row.state<>'active' OR change#>'{target,pin}' IS DISTINCT FROM
    jsonb_build_object('id',target_row.id,'revision',target_row.revision,'digest',target_row.digest) THEN
   RAISE EXCEPTION 'Location transfer target changed' USING ERRCODE='40001'; END IF;
  state_value:='transferred'; transfer_value:=jsonb_build_object('locationId',target_row.location_id,
    'id',target_row.id,'revision',target_row.revision,'digest',target_row.digest);
 END IF;
 review_value:=public.canonical_enterprise_location_v1_digest(jsonb_build_object(
  'body',body,'authority',authority->'binding','previous',previous,'transferTarget',transfer_value));
 RETURN jsonb_build_object('locationId',location_value,'action',action_value,'previous',previous,
  'name',name_value,'address',address_value,'state',state_value,'correctedRevisionId',corrected_value,
  'transferTarget',transfer_value,'profilePin',authority->'profilePin','reviewDigest',review_value);
END $$;

CREATE FUNCTION public.canonical_enterprise_location_v1_read(
 org UUID, actor UUID, role_value TEXT, session_value UUID, location_value UUID, mode_value TEXT, before_revision INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; result JSONB; total BIGINT; next_value INTEGER;
BEGIN
 authority:=public.canonical_enterprise_location_v1_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF mode_value IS NULL OR mode_value NOT IN('context','catalogue','history') OR
   (mode_value<>'context' AND role_value NOT IN('owner','admin')) THEN
  RAISE EXCEPTION 'Location read authority unavailable' USING ERRCODE='42501'; END IF;
 IF mode_value='history' THEN
  IF location_value IS NULL OR (before_revision IS NOT NULL AND before_revision<=0) THEN
   RAISE EXCEPTION 'Location history scope invalid' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO total FROM public.canonical_enterprise_location_revisions_v1
   WHERE organization_id=org AND location_id=location_value;
  IF total=0 THEN RAISE EXCEPTION 'Location unavailable' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(jsonb_agg(public.canonical_enterprise_location_v1_projection(r) ORDER BY r.revision DESC),'[]'::JSONB),min(r.revision)
   INTO result,next_value FROM(SELECT * FROM public.canonical_enterprise_location_revisions_v1
    WHERE organization_id=org AND location_id=location_value AND (before_revision IS NULL OR revision<before_revision)
    ORDER BY revision DESC LIMIT 100)r;
  RETURN jsonb_build_object('history',result,'total',total,'nextBeforeRevision',CASE WHEN next_value>1 THEN next_value ELSE NULL END);
 END IF;
 IF before_revision IS NOT NULL THEN RAISE EXCEPTION 'Location cursor invalid' USING ERRCODE='22023'; END IF;
 WITH heads AS(SELECT DISTINCT ON(location_id) * FROM public.canonical_enterprise_location_revisions_v1
   WHERE organization_id=org AND (location_value IS NULL OR location_id=location_value) ORDER BY location_id,revision DESC)
 SELECT count(*) INTO total FROM heads WHERE mode_value<>'context' OR state='active';
 WITH heads AS(SELECT DISTINCT ON(location_id) * FROM public.canonical_enterprise_location_revisions_v1
   WHERE organization_id=org AND (location_value IS NULL OR location_id=location_value) ORDER BY location_id,revision DESC)
 SELECT COALESCE(jsonb_agg(CASE WHEN mode_value='context' THEN jsonb_build_object(
    'locationId',r.location_id,'pin',jsonb_build_object('id',r.id,'revision',r.revision,'digest',r.digest),
    'name',r.name,'actorUserId',r.actor_user_id,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   ELSE public.canonical_enterprise_location_v1_projection(r)END ORDER BY r.location_id),'[]'::JSONB)
 INTO result FROM(SELECT * FROM heads WHERE mode_value<>'context' OR state='active' ORDER BY location_id LIMIT 1000)r;
 RETURN jsonb_build_object('locations',result,'total',total,'truncated',total>1000);
END $$;

CREATE FUNCTION public.canonical_enterprise_location_v1_preview(
 org UUID, actor UUID, role_value TEXT, session_value UUID, csrf TEXT, body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; plan JSONB;
BEGIN
 IF csrf IS NULL THEN RAISE EXCEPTION 'Location review authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_enterprise_location_v1_authority(org,actor,role_value,session_value,csrf,FALSE);
 plan:=public.canonical_enterprise_location_v1_plan(org,authority,body);
 RETURN jsonb_build_object('contract','northstar.enterprise.location-review.v1','plan',plan,
  'review',jsonb_build_object('contract','northstar.enterprise.location-review.v1','digest',plan->'reviewDigest','confirmed',FALSE),
  'boundary','This administrative location transition moves no historical jobs, customers, workforce, financial ownership or permissions.');
END $$;

CREATE FUNCTION public.canonical_enterprise_location_v1_commit(
 org UUID, actor UUID, role_value TEXT, session_value UUID, csrf TEXT, request_value UUID, body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; old_row public.canonical_enterprise_location_revisions_v1%ROWTYPE;
 new_row public.canonical_enterprise_location_revisions_v1%ROWTYPE;
 core JSONB; plan JSONB; request_hash TEXT; next_revision INTEGER; organization_revision_value INTEGER;
 moment TIMESTAMPTZ; new_id UUID; row_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR request_value IS NULL OR csrf IS NULL THEN
  RAISE EXCEPTION 'Location transaction authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_enterprise_location_v1_authority(org,actor,role_value,session_value,csrf,FALSE);
 IF (public.canonical_enterprise_location_v1_keys(body,ARRAY['contract','action','locationId','expected','change','reason','profilePin','review'])
   AND public.canonical_enterprise_location_v1_keys(body->'review',ARRAY['contract','digest','confirmed'])
   AND body#>'{review,contract}'=to_jsonb('northstar.enterprise.location-review.v1'::TEXT)
   AND body#>'{review,confirmed}'='true'::JSONB AND jsonb_typeof(body#>'{review,digest}')='string'
   AND length(body#>>'{review,digest}')=64 AND (body#>>'{review,digest}')~'^[0-9a-f]{64}$') IS NOT TRUE THEN
  RAISE EXCEPTION 'Explicit location review confirmation required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('northstar.enterprise.location:'||org::TEXT,0));
 PERFORM 1 FROM public.organizations WHERE id=org FOR UPDATE;
 authority:=public.canonical_enterprise_location_v1_authority(org,actor,role_value,session_value,csrf,TRUE);
 request_hash:=public.canonical_enterprise_location_v1_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'request',body));
 SELECT * INTO old_row FROM public.canonical_enterprise_location_revisions_v1 WHERE organization_id=org AND request_key=request_value;
 IF old_row.id IS NOT NULL THEN
  IF old_row.request_digest<>request_hash OR old_row.actor_user_id<>actor THEN
   RAISE EXCEPTION 'Location request key already used' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('replayed',TRUE,'receipt',public.canonical_enterprise_location_v1_projection(old_row));
 END IF;
 core:=body-'review'; plan:=public.canonical_enterprise_location_v1_plan(org,authority,core);
 IF body#>>'{review,digest}' IS DISTINCT FROM plan->>'reviewDigest' THEN
  RAISE EXCEPTION 'Location review changed' USING ERRCODE='40001'; END IF;
 -- The advisory fence does not refresh a SERIALIZABLE snapshot. An append
 -- committed while waiting must collide here and trigger full rollback/retry,
 -- including when it changed a different location used as a transfer target.
 SELECT COALESCE(max(organization_revision),0) INTO organization_revision_value
  FROM public.canonical_enterprise_location_revisions_v1 WHERE organization_id=org;
 IF organization_revision_value=2147483647 THEN RAISE EXCEPTION 'Company location history bound reached' USING ERRCODE='54000'; END IF;
 organization_revision_value:=organization_revision_value+1;
 next_revision:=(plan#>>'{previous,revision}')::INTEGER+1; moment:=clock_timestamp(); new_id:=gen_random_uuid();
 row_hash:=public.canonical_enterprise_location_v1_digest(jsonb_build_object('organizationId',org,'id',new_id,
  'revision',next_revision,'organizationRevision',organization_revision_value,'plan',plan,'requestDigest',request_hash,'actorUserId',actor,'sessionId',session_value,
  'recordedAt',to_char(moment AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 INSERT INTO public.canonical_enterprise_location_revisions_v1(
  organization_id,location_id,revision,organization_revision,id,previous_id,previous_digest,action,name,address,state,corrected_id,
  transfer_location_id,transfer_revision_id,transfer_revision,transfer_digest,reason,request_key,request_digest,request_document,
  review_digest,profile_pin,actor_user_id,actor_session_id,recorded_at,digest)
 VALUES(org,(plan->>'locationId')::UUID,next_revision,organization_revision_value,new_id,(plan#>>'{previous,id}')::UUID,plan#>>'{previous,digest}',
  plan->>'action',plan->>'name',plan->>'address',plan->>'state',(plan->>'correctedRevisionId')::UUID,
  (plan#>>'{transferTarget,locationId}')::UUID,(plan#>>'{transferTarget,id}')::UUID,
  (plan#>>'{transferTarget,revision}')::INTEGER,plan#>>'{transferTarget,digest}',core->>'reason',request_value,request_hash,body,
  plan->>'reviewDigest',plan->'profilePin',actor,session_value,moment,row_hash) RETURNING * INTO new_row;
 -- The locked canonical account/subscription gate is checked again before return.
 PERFORM public.canonical_enterprise_location_v1_authority(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('replayed',FALSE,'receipt',public.canonical_enterprise_location_v1_projection(new_row));
END $$;

REVOKE ALL ON TABLE public.canonical_enterprise_location_revisions_v1 FROM PUBLIC;
DO $revoke$
DECLARE f RECORD; runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);
BEGIN
 FOR f IN SELECT oid::regprocedure AS identity FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname LIKE 'canonical_enterprise_location_v1_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.identity);
  IF runtime_role IS NOT NULL AND runtime_role<>'' THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.identity,runtime_role); END IF;
 END LOOP;
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_enterprise_location_revisions_v1 FROM %I',runtime_role);
 END IF;
END $revoke$;
