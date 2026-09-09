-- M23-01: append-only employee claims, organization review and separate availability.
-- No role, assignment, schedule, certification provider or file-storage authority.
CREATE TABLE public.canonical_work_profile_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('profile','availability')),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000001),
  previous_id UUID,
  action TEXT NOT NULL CHECK (action IN ('submit','approve','reject','revoke','availability')),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked','available','limited','unavailable','not_shared')),
  document JSONB NOT NULL CHECK (jsonb_typeof(document)='object' AND octet_length(document::text)<=32768),
  verified_certification_ids JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(verified_certification_ids)='array'),
  reason TEXT NOT NULL DEFAULT '' CHECK (octet_length(reason)<=4000),
  actor_user_id UUID NOT NULL,
  actor_access_role TEXT NOT NULL,
  auth_session_id UUID NOT NULL,
  request_key UUID NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,profile_id,stream,revision),
  UNIQUE (organization_id,actor_user_id,request_key),
  FOREIGN KEY (organization_id,profile_id) REFERENCES public.workforce_profiles(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,previous_id) REFERENCES public.canonical_work_profile_events(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_work_profile_history ON public.canonical_work_profile_events(organization_id,profile_id,created_at DESC,id DESC);

CREATE FUNCTION public.canonical_work_profile_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'Work profile provenance is append-only' USING ERRCODE='42501';
END $function$;
CREATE TRIGGER canonical_work_profile_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
ON public.canonical_work_profile_events FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_work_profile_immutable();

CREATE FUNCTION public.canonical_work_profile_text(value JSONB, maximum INTEGER, required BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $function$
  SELECT COALESCE(jsonb_typeof(value)='string' AND length(value#>>'{}')<=maximum
    AND octet_length(value#>>'{}')<=maximum*4
    AND (NOT required OR length(btrim(value#>>'{}'))>0)
    AND (value#>>'{}')!~'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]',FALSE);
$function$;

CREATE FUNCTION public.canonical_work_profile_validate(body JSONB) RETURNS VOID
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE action_value TEXT:=body->>'action'; item JSONB; doc JSONB; expiration DATE;
BEGIN
  IF body IS NULL OR jsonb_typeof(body)<>'object' OR octet_length(body::text)>32768
     OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
     OR (body->>'expectedRevision')!~'^[0-9]{1,7}$'
     OR (body->>'expectedRevision')::integer>1000000 THEN
    RAISE EXCEPTION 'Invalid work profile input' USING ERRCODE='22023';
  END IF;
  IF action_value='submit' THEN
    doc:=body->'profile';
    IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','profile']) IS NOT TRUE
       OR public.canonical_field_evidence_object_keys_exact(doc,ARRAY['title','summary','skills','certifications']) IS NOT TRUE
       OR NOT public.canonical_work_profile_text(doc->'title',120,TRUE)
       OR NOT public.canonical_work_profile_text(doc->'summary',2000,FALSE)
       OR jsonb_typeof(doc->'skills') IS DISTINCT FROM 'array'
       OR jsonb_typeof(doc->'certifications') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid profile claims' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(doc->'skills')>20 OR jsonb_array_length(doc->'certifications')>12 THEN
      RAISE EXCEPTION 'Too many profile claims' USING ERRCODE='22023';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(doc->'skills') LOOP
      IF NOT public.canonical_work_profile_text(item,120,TRUE) THEN
        RAISE EXCEPTION 'Invalid capability' USING ERRCODE='22023';
      END IF;
    END LOOP;
    IF (SELECT count(*)<>count(DISTINCT lower(btrim(value#>>'{}'))) FROM jsonb_array_elements(doc->'skills'))
      OR (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(doc->'certifications')) THEN
      RAISE EXCEPTION 'Duplicate profile claims' USING ERRCODE='22023';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(doc->'certifications') LOOP
      IF public.canonical_field_evidence_object_keys_exact(item,ARRAY['id','name','issuer','expiresOn','documentReference']) IS NOT TRUE
         OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
         OR (item->>'id')!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
         OR NOT public.canonical_work_profile_text(item->'name',120,TRUE)
         OR NOT public.canonical_work_profile_text(item->'issuer',120,TRUE)
         OR (item->'documentReference'<>'null'::jsonb AND
           (jsonb_typeof(item->'documentReference') IS DISTINCT FROM 'string'
            OR (item->>'documentReference')!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')) THEN
        RAISE EXCEPTION 'Invalid certification reference' USING ERRCODE='22023';
      END IF;
      IF item->'expiresOn'<>'null'::jsonb THEN
        IF jsonb_typeof(item->'expiresOn') IS DISTINCT FROM 'string'
          OR (item->>'expiresOn')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION 'Invalid certification expiry' USING ERRCODE='22023';
        END IF;
        BEGIN expiration:=(item->>'expiresOn')::date;
        EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid certification expiry' USING ERRCODE='22023'; END;
      END IF;
    END LOOP;
  ELSIF action_value='availability' THEN
    doc:=body->'availability';
    IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','availability']) IS NOT TRUE
       OR public.canonical_field_evidence_object_keys_exact(doc,ARRAY['status','note','until']) IS NOT TRUE
       OR COALESCE(doc->>'status','') NOT IN ('available','limited','unavailable','not_shared')
       OR NOT public.canonical_work_profile_text(doc->'note',500,FALSE) THEN
      RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023';
    END IF;
    IF doc->>'status'='not_shared' THEN
      IF doc->'until'<>'null'::jsonb OR doc->>'note'<>'' THEN
        RAISE EXCEPTION 'Invalid cleared availability' USING ERRCODE='22023';
      END IF;
    ELSIF jsonb_typeof(doc->'until') IS DISTINCT FROM 'string'
       OR (doc->>'until')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
      RAISE EXCEPTION 'Invalid availability end time' USING ERRCODE='22023';
    END IF;
  ELSIF action_value IN ('approve','reject','revoke') THEN
    IF public.canonical_field_evidence_object_keys_exact(body,CASE WHEN action_value='approve'
      THEN ARRAY['action','expectedRevision','reason','verifiedCertificationIds']
      ELSE ARRAY['action','expectedRevision','reason'] END) IS NOT TRUE
      OR NOT public.canonical_work_profile_text(body->'reason',1000,TRUE) THEN
      RAISE EXCEPTION 'A reasoned review is required' USING ERRCODE='22023';
    END IF;
    IF action_value='approve' THEN
      IF jsonb_typeof(body->'verifiedCertificationIds') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Invalid verification selection' USING ERRCODE='22023';
      END IF;
      IF jsonb_array_length(body->'verifiedCertificationIds')>12
        OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(body->'verifiedCertificationIds')) THEN
        RAISE EXCEPTION 'Invalid verification selection' USING ERRCODE='22023';
      END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(body->'verifiedCertificationIds') LOOP
        IF jsonb_typeof(item)<>'string' OR (item#>>'{}')!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' THEN
          RAISE EXCEPTION 'Invalid verification selection' USING ERRCODE='22023';
        END IF;
      END LOOP;
    END IF;
  ELSE RAISE EXCEPTION 'Unknown profile action' USING ERRCODE='22023';
  END IF;
END $function$;

CREATE FUNCTION public.canonical_work_profile_read(
  org UUID, actor_id UUID, access_role TEXT, session_id UUID, target UUID, history_offset INTEGER
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE actor JSONB; person RECORD; latest public.canonical_work_profile_events%ROWTYPE;
  available public.canonical_work_profile_events%ROWTYPE; history JSONB; total BIGINT; mutable BOOLEAN; assigned JSONB;
BEGIN
  IF access_role IS NULL OR access_role NOT IN ('owner','admin','member','viewer') THEN
    RAISE EXCEPTION 'Current role required' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable')
    OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION 'Read snapshot required' USING ERRCODE='25000';
  END IF;
  actor:=public.canonical_field_execution_actor_authority(org,actor_id,access_role,session_id,NULL,FALSE);
  IF target IS NULL THEN target:=(actor->>'profileId')::uuid;
  ELSIF access_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Owner or administrator review required' USING ERRCODE='42501';
  END IF;
  IF history_offset IS NULL OR history_offset NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'Invalid history page' USING ERRCODE='22023';
  END IF;
  SELECT profile.id,profile.operational_role,account.name,membership.role,membership.status,account.status AS account_status
    INTO person FROM public.workforce_profiles profile
    JOIN public.organization_memberships membership ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
    JOIN public.users account ON account.organization_id=membership.organization_id AND account.id=membership.user_id
   WHERE profile.organization_id=org AND profile.id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO latest FROM public.canonical_work_profile_events WHERE organization_id=org AND profile_id=target AND stream='profile' ORDER BY revision DESC LIMIT 1;
  SELECT * INTO available FROM public.canonical_work_profile_events WHERE organization_id=org AND profile_id=target AND stream='availability' ORDER BY revision DESC LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',skill.id,'name',skill.name) ORDER BY skill.name),'[]'::jsonb)
    INTO assigned FROM public.workforce_profile_skills relation
    JOIN public.workforce_skills skill ON skill.organization_id=relation.organization_id AND skill.id=relation.skill_id
   WHERE relation.organization_id=org AND relation.profile_id=target;
  SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.created_at DESC,event.id DESC),'[]'::jsonb)
    INTO history FROM (
      SELECT e.id,e.stream,e.revision,e.previous_id,e.action,e.status,e.document,
        e.verified_certification_ids AS "verifiedCertificationIds",e.reason,e.created_at,
        account.name AS "actorName",e.actor_access_role AS "actorAccessRole"
      FROM public.canonical_work_profile_events e JOIN public.users account ON account.organization_id=e.organization_id AND account.id=e.actor_user_id
      WHERE e.organization_id=org AND e.profile_id=target ORDER BY e.created_at DESC,e.id DESC LIMIT 25 OFFSET history_offset
    ) event;
  SELECT count(*) INTO total FROM public.canonical_work_profile_events WHERE organization_id=org AND profile_id=target;
  SELECT COALESCE((onboarding.status='complete' OR EXISTS(SELECT 1 FROM public.canonical_business_profiles b WHERE b.organization_id=org AND b.is_active))
    AND (subscription.status='active' OR (subscription.status='trialing' AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days' AND subscription.trial_ends_at>clock_timestamp())),FALSE)
    INTO mutable FROM public.organization_onboarding onboarding LEFT JOIN public.subscriptions subscription ON subscription.organization_id=onboarding.organization_id
    WHERE onboarding.organization_id=org LIMIT 1;
  RETURN jsonb_build_object('contractVersion','m23-work-profile-v1','serverNow',clock_timestamp(),
    'person',jsonb_build_object('id',person.id,'name',person.name,'operationalRole',person.operational_role,'accessRole',person.role,'membershipStatus',person.status,'accountStatus',person.account_status,'assignedSkills',assigned),
    'profile',jsonb_build_object('revision',COALESCE(latest.revision,0),'status',COALESCE(latest.status,'empty'),
      'document',latest.document,'reason',COALESCE(latest.reason,''),'verifiedCertificationIds',COALESCE(latest.verified_certification_ids,'[]'::jsonb),'updatedAt',latest.created_at),
    'availability',jsonb_build_object('revision',COALESCE(available.revision,0),'status',
      CASE WHEN person.status<>'active' OR person.account_status<>'active' THEN 'not_shared'
        WHEN available.document->>'until' IS NOT NULL AND (available.document->>'until')::timestamptz<=clock_timestamp() THEN 'expired'
        ELSE COALESCE(available.status,'not_shared') END,'document',available.document,'updatedAt',available.created_at),
    'permissions',jsonb_build_object('canSubmit',COALESCE(mutable,FALSE) AND access_role='member' AND target=(actor->>'profileId')::uuid,
      'canReview',COALESCE(mutable,FALSE) AND access_role IN ('owner','admin') AND target<>(actor->>'profileId')::uuid AND person.status='active' AND person.account_status='active',
      'readOnlyReason',CASE WHEN NOT COALESCE(mutable,FALSE) THEN 'subscription_or_onboarding_read_only' WHEN access_role='viewer' THEN 'viewer_read_only' ELSE NULL END),
    'history',history,'historyOffset',history_offset,'historyTotal',total,'nextHistoryOffset',CASE WHEN history_offset+25<total THEN history_offset+25 ELSE NULL END);
END $function$;

CREATE FUNCTION public.canonical_work_profile_directory(org UUID, actor_id UUID, access_role TEXT, session_id UUID, after_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE result JSONB;
BEGIN
  IF access_role IS NULL OR access_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Review authority required' USING ERRCODE='42501';
  END IF;
  PERFORM public.canonical_field_execution_actor_authority(org,actor_id,access_role,session_id,NULL,FALSE);
  IF access_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Review authority required' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(person) ORDER BY person.id),'[]'::jsonb) INTO result FROM (
    SELECT p.id,u.name,p.operational_role AS "operationalRole",m.status AS "membershipStatus",
      COALESCE(e.status,'empty') AS status,COALESCE(e.revision,0) AS revision
    FROM public.workforce_profiles p
    JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
    JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
    LEFT JOIN LATERAL (SELECT status,revision FROM public.canonical_work_profile_events e WHERE e.organization_id=org AND e.profile_id=p.id AND e.stream='profile' ORDER BY revision DESC LIMIT 1) e ON TRUE
    WHERE p.organization_id=org AND m.role IN ('member','viewer') AND (after_id IS NULL OR p.id>after_id)
    ORDER BY p.id LIMIT 51
  ) person;
  RETURN jsonb_build_object('contractVersion','m23-work-profile-directory-v1','records',CASE WHEN jsonb_array_length(result)>50 THEN result-50 ELSE result END,
    'nextAfter',CASE WHEN jsonb_array_length(result)>50 THEN result->49->>'id' ELSE NULL END);
END $function$;

CREATE FUNCTION public.canonical_work_profile_mutate(
  org UUID, actor_id UUID, access_role TEXT, session_id UUID, csrf TEXT, target UUID, request_id UUID, body JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE actor JSONB; person RECORD; previous public.canonical_work_profile_events%ROWTYPE;
  existing public.canonical_work_profile_events%ROWTYPE; inserted public.canonical_work_profile_events%ROWTYPE;
  stream_value TEXT; action_value TEXT:=body->>'action'; status_value TEXT; doc JSONB; verified JSONB:='[]';
  digest_value TEXT; selected JSONB; until_value TIMESTAMPTZ; cert JSONB;
BEGIN
  IF org IS NULL OR actor_id IS NULL OR session_id IS NULL OR request_id IS NULL
     OR access_role IS NULL OR access_role NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'Profile authority required' USING ERRCODE='42501';
  END IF;
  actor:=public.canonical_field_execution_actor_authority(org,actor_id,access_role,session_id,csrf,TRUE);
  IF target IS NULL THEN target:=(actor->>'profileId')::uuid; END IF;
  -- Profile/membership IDs need not equal user IDs for invited employees.
  -- Both employee and reviewer acquire the same resolved-subject mutex.
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||target::text,5501));
  SELECT m.status,m.role,u.status AS account_status INTO person FROM public.workforce_profiles p
    JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
    JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
    WHERE p.organization_id=org AND p.id=target FOR SHARE OF p,m,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found' USING ERRCODE='P0002'; END IF;
  IF person.status<>'active' OR person.account_status<>'active' THEN
    RAISE EXCEPTION 'Profile membership is not current' USING ERRCODE='42501';
  END IF;
  IF action_value IN ('submit','availability') THEN
    IF access_role<>'member' OR target<>(actor->>'profileId')::uuid THEN
      RAISE EXCEPTION 'Only your own employee claims may be edited' USING ERRCODE='42501';
    END IF;
  ELSIF access_role NOT IN ('owner','admin') OR target=(actor->>'profileId')::uuid THEN
    RAISE EXCEPTION 'Independent owner or administrator review required' USING ERRCODE='42501';
  END IF;
  PERFORM public.canonical_work_profile_validate(body);
  digest_value:=encode(sha256(convert_to(jsonb_build_object('target',target,'body',body)::text,'UTF8')),'hex');
  SELECT * INTO existing FROM public.canonical_work_profile_events WHERE organization_id=org AND actor_user_id=actor_id AND request_key=request_id;
  IF FOUND THEN
    IF existing.request_digest<>digest_value THEN RAISE EXCEPTION 'Retry identity conflict' USING ERRCODE='40001'; END IF;
    RETURN jsonb_build_object('id',existing.id,'revision',existing.revision,'stream',existing.stream,'replayed',TRUE);
  END IF;
  stream_value:=CASE WHEN action_value='availability' THEN 'availability' ELSE 'profile' END;
  SELECT * INTO previous FROM public.canonical_work_profile_events WHERE organization_id=org AND profile_id=target AND stream=stream_value ORDER BY revision DESC LIMIT 1;
  IF COALESCE(previous.revision,0)<>(body->>'expectedRevision')::integer THEN
    RAISE EXCEPTION 'Profile changed; reload before deciding' USING ERRCODE='40001';
  END IF;
  IF action_value='submit' THEN status_value:='pending'; doc:=body->'profile';
  ELSIF action_value='availability' THEN
    doc:=body->'availability'; status_value:=doc->>'status';
    IF status_value<>'not_shared' THEN
      BEGIN until_value:=(doc->>'until')::timestamptz;
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid availability end time' USING ERRCODE='22023'; END;
      IF until_value<=clock_timestamp() OR until_value>clock_timestamp()+INTERVAL '7 days' THEN
        RAISE EXCEPTION 'Availability must end within seven days' USING ERRCODE='22023';
      END IF;
    END IF;
  ELSE
    IF (action_value IN ('approve','reject') AND previous.status IS DISTINCT FROM 'pending')
       OR (action_value='revoke' AND previous.status IS DISTINCT FROM 'approved') THEN
      RAISE EXCEPTION 'Review transition is no longer available' USING ERRCODE='40001';
    END IF;
    doc:=previous.document;
    status_value:=CASE action_value WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'revoked' END;
    IF action_value='approve' THEN
      verified:=body->'verifiedCertificationIds';
      FOR selected IN SELECT value FROM jsonb_array_elements(verified) LOOP
        SELECT value INTO cert FROM jsonb_array_elements(doc->'certifications') WHERE value->>'id'=selected#>>'{}';
        IF NOT FOUND OR cert->'documentReference'='null'::jsonb
           OR (cert->>'expiresOn' IS NOT NULL AND (cert->>'expiresOn')::date<(clock_timestamp() AT TIME ZONE 'UTC')::date) THEN
          RAISE EXCEPTION 'Certification evidence is missing or expired' USING ERRCODE='22023';
        END IF;
      END LOOP;
    END IF;
  END IF;
  INSERT INTO public.canonical_work_profile_events(organization_id,profile_id,stream,revision,previous_id,action,status,document,
    verified_certification_ids,reason,actor_user_id,actor_access_role,auth_session_id,request_key,request_digest)
  VALUES(org,target,stream_value,COALESCE(previous.revision,0)+1,previous.id,action_value,status_value,doc,
    verified,COALESCE(body->>'reason',''),actor_id,access_role,session_id,request_id,digest_value) RETURNING * INTO inserted;
  RETURN jsonb_build_object('id',inserted.id,'revision',inserted.revision,'stream',inserted.stream,'replayed',FALSE);
END $function$;

REVOKE ALL ON TABLE public.canonical_work_profile_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_work_profile_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_work_profile_text(jsonb,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_work_profile_validate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_work_profile_read(uuid,uuid,text,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_work_profile_directory(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_work_profile_mutate(uuid,uuid,text,uuid,text,uuid,uuid,jsonb) FROM PUBLIC;
