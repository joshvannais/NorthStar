-- Mission 26 Part 11A: immutable owner-reviewed forecast preferences.
-- A preference cannot establish source coverage, algorithm promotion or
-- permission to issue a forecast.

CREATE TABLE public.canonical_forecast_settings_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),
 effective_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 normalized JSONB NOT NULL,
 canonical_json TEXT NOT NULL CHECK(octet_length(canonical_json)<=16384),
 digest CHAR(64) NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 supersedes_digest CHAR(64),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(normalized=(canonical_json::jsonb||jsonb_build_object('digest',rtrim(digest)))),
 CHECK(rtrim(digest)=encode(sha256(convert_to(canonical_json,'UTF8')),'hex')),
 CHECK(normalized->>'organizationId'=organization_id::text),
 CHECK((normalized->>'revision')::integer=revision),
 CHECK(normalized->'source'->>'actorUserId'=actor_user_id::text),
 CHECK(normalized->'source'->>'kind'='owner_reviewed'),
 CHECK(normalized->>'version'='m26-forecast-settings-v1'),
 CHECK(normalized->'source'->>'supersedesDigest'=rtrim(supersedes_digest))
);

CREATE FUNCTION public.canonical_forecast_settings_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast settings history is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER canonical_forecast_settings_revisions_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_settings_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_settings_immutable();

CREATE FUNCTION public.canonical_forecast_settings_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,request_hash TEXT,expected_revision INTEGER,
 expected_digest TEXT,canonical_value TEXT,normalized_value JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; old public.canonical_forecast_settings_revisions%ROWTYPE;
 current_row public.canonical_forecast_settings_revisions%ROWTYPE;
 inserted public.canonical_forecast_settings_revisions%ROWTYPE;
 key_hash TEXT; next_revision INTEGER; supplied_digest TEXT; effective_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast settings access restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   request_hash IS NULL OR request_hash!~'^[0-9a-f]{64}$' OR
   expected_revision IS NULL OR expected_revision<0 OR expected_revision>=1000000000 OR
   (expected_revision=0 AND expected_digest IS NOT NULL) OR
   (expected_revision>0 AND (expected_digest IS NULL OR expected_digest!~'^[0-9a-f]{64}$')) OR
   canonical_value IS NULL OR octet_length(canonical_value)>16384 OR
   normalized_value IS NULL OR jsonb_typeof(normalized_value)<>'object' THEN
  RAISE EXCEPTION 'Forecast settings request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:forecast-settings:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast settings busy' USING ERRCODE='55P03';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_forecast_settings_revisions
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Forecast settings request key conflict' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('settings',old.normalized,'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_settings_revisions
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF COALESCE(current_row.revision,0)<>expected_revision OR
   (expected_revision>0 AND rtrim(current_row.digest)<>expected_digest) THEN
  RAISE EXCEPTION 'Forecast settings changed' USING ERRCODE='40001';END IF;
 next_revision:=expected_revision+1;
 supplied_digest:=normalized_value->>'digest';
 IF supplied_digest IS NULL OR supplied_digest!~'^[0-9a-f]{64}$' OR
   supplied_digest<>encode(sha256(convert_to(canonical_value,'UTF8')),'hex') OR
   normalized_value<>(canonical_value::jsonb||jsonb_build_object('digest',supplied_digest)) OR
   normalized_value->>'version'<>'m26-forecast-settings-v1' OR
   normalized_value->>'organizationId'<>org::text OR
   (normalized_value->>'revision')::integer<>next_revision OR
   normalized_value->'source'->>'kind'<>'owner_reviewed' OR
   normalized_value->'source'->>'actorUserId'<>actor::text OR
   normalized_value->'source'->>'supersedesDigest' IS DISTINCT FROM expected_digest OR
   normalized_value->'settings'->>'actionPolicy'<>'review_required' OR
   jsonb_typeof(normalized_value->'settings'->'enabled')<>'boolean' OR
   normalized_value->'settings'->>'enabled'<>'false' OR
   jsonb_typeof(normalized_value->'settings'->'targets')<>'array' OR
   jsonb_typeof(normalized_value->'settings'->'horizons')<>'array' OR
   jsonb_array_length(normalized_value->'settings'->'targets')<>0 OR
   jsonb_array_length(normalized_value->'settings'->'horizons')<>0 OR
   normalized_value->'settings'->>'scenarioDisplay'<>'withhold' OR
   normalized_value->'settings'->>'comparisonDisplay'<>'none' OR
   normalized_value->'settings'->>'alertDelivery'<>'off' THEN
  RAISE EXCEPTION 'Forecast settings payload invalid' USING ERRCODE='22023';END IF;
 BEGIN effective_value:=(normalized_value->>'effectiveAt')::timestamptz;
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Forecast settings time invalid' USING ERRCODE='22023';END;
 IF normalized_value<>jsonb_build_object(
   'version','m26-forecast-settings-v1','organizationId',org,
   'revision',next_revision,'effectiveAt',normalized_value->>'effectiveAt',
   'source',jsonb_build_object('kind','owner_reviewed','actorUserId',actor,
     'supersedesDigest',expected_digest),
   'settings',jsonb_build_object('enabled',FALSE,'targets','[]'::jsonb,
     'horizons','[]'::jsonb,'scenarioDisplay','withhold',
     'comparisonDisplay','none','alertDelivery','off',
     'actionPolicy','review_required'),
   'digest',supplied_digest) THEN
  RAISE EXCEPTION 'Forecast settings payload invalid' USING ERRCODE='22023';END IF;
 IF effective_value<clock_timestamp()-INTERVAL '5 minutes' OR
   effective_value>clock_timestamp()+INTERVAL '1 minute' THEN
  RAISE EXCEPTION 'Forecast settings time invalid' USING ERRCODE='22023';END IF;
 INSERT INTO public.canonical_forecast_settings_revisions(
  organization_id,revision,effective_at,actor_user_id,membership_id,
  auth_session_id,normalized,canonical_json,digest,supersedes_digest,
  request_key_hash,request_digest)
 VALUES(org,next_revision,effective_value,actor,(authority->>'membershipId')::uuid,
  session_value,normalized_value,canonical_value,supplied_digest,expected_digest,
  key_hash,request_hash) RETURNING * INTO inserted;
 RETURN jsonb_build_object('settings',inserted.normalized,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_settings_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_settings_revisions%ROWTYPE;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast settings access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO selected FROM public.canonical_forecast_settings_revisions
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 RETURN selected.normalized;
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_settings_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_read(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_settings_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB)
  TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_settings_read(
  UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF;END $$;
