-- Mission 26 Part 4A: explicit, tenant-private permission to reuse Retell call
-- receipts for demand forecasting. This does not establish caller consent,
-- provider completeness, retention, reviewed leads, or a usable forecast.

CREATE TABLE public.canonical_forecast_retell_source_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 purpose_key TEXT NOT NULL CHECK(purpose_key='forecast_demand_source'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 source_scope JSONB NOT NULL CHECK(source_scope='["retell.inbound_calls"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m26-retell-demand-source-consent-v1'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,1000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,purpose_key,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_retell_source_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);
CREATE TRIGGER canonical_forecast_retell_source_consents_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_retell_source_consents
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_forecast_retell_source_consent_projection(
 value public.canonical_forecast_retell_source_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'purposeKey',value.purpose_key,
  'revision',value.revision,'previousId',value.previous_id,'action',value.action,
  'sourceScope',value.source_scope,'consentVersion',value.consent_version,
  'reason',value.reason,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at,
  'boundary','Company permission does not establish caller consent, provider coverage or retention.')
$$;

CREATE FUNCTION public.canonical_forecast_retell_source_consent_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_forecast_retell_source_consents%ROWTYPE;
 history JSONB;total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast source consent access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
  JOIN public.organization_onboarding onboarding
    ON onboarding.organization_id=subscription.organization_id
  WHERE subscription.organization_id=org AND onboarding.status='complete'
    AND (subscription.status='active' OR
      (subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
        AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days'
        AND subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_retell_source_consents
  WHERE organization_id=org AND purpose_key='forecast_demand_source' ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_forecast_retell_source_consents
  WHERE organization_id=org AND purpose_key='forecast_demand_source';
 SELECT COALESCE(jsonb_agg(public.canonical_forecast_retell_source_consent_projection(item)
   ORDER BY revision DESC),'[]'::jsonb) INTO history
  FROM (SELECT * FROM public.canonical_forecast_retell_source_consents
   WHERE organization_id=org AND purpose_key='forecast_demand_source'
   ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NULL THEN NULL
   ELSE public.canonical_forecast_retell_source_consent_projection(current_row) END,
  'active',COALESCE(current_row.action='grant',FALSE),
  'history',history,'total',total,'truncated',total>20,
  'boundary','Company permission alone never authorizes a call-derived forecast.');
END $$;

CREATE FUNCTION public.canonical_forecast_retell_source_consent_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_row public.canonical_forecast_retell_source_consents%ROWTYPE;
 replay public.canonical_forecast_retell_source_consents%ROWTYPE;
 inserted public.canonical_forecast_retell_source_consents%ROWTYPE;
 key_hash TEXT;request_hash TEXT;next_revision BIGINT;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 IF role_value IS NULL OR role_value<>'owner' THEN
  RAISE EXCEPTION 'Only the owner can change forecast source permission' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions subscription
  JOIN public.organization_onboarding onboarding
    ON onboarding.organization_id=subscription.organization_id
  WHERE subscription.organization_id=org AND onboarding.status='complete'
    AND (subscription.status='active' OR
      (subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
        AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days'
        AND subscription.trial_ends_at>clock_timestamp())) FOR SHARE OF subscription;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   octet_length(body::text)>4096 OR
   public.canonical_field_evidence_object_keys_exact(body,ARRAY[
     'action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
   body->>'action' NOT IN ('grant','revoke') OR
   jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR
   (body->>'expectedRevision'~'^(0|[1-9][0-9]{0,3}|10000)$') IS NOT TRUE OR
   jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR
   (body->>'expectedDigest'='none' OR body->>'expectedDigest'~'^[0-9a-f]{64}$') IS NOT TRUE OR
   jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR
   public.canonical_learning_text_valid(body->>'reason',1000) IS NOT TRUE OR
   body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR
   body->>'confirmationVersion' IS DISTINCT FROM 'm26-retell-demand-source-consent-v1'
 THEN RAISE EXCEPTION 'Forecast source permission request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-demand-source-consent-request-v1','organizationId',org,
  'actorUserId',actor,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':forecast-retell-source-consent',0));
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO replay FROM public.canonical_forecast_retell_source_consents
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF replay.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Forecast source permission key conflict' USING ERRCODE='23505';END IF;
  SELECT * INTO current_row FROM public.canonical_forecast_retell_source_consents
   WHERE organization_id=org AND purpose_key='forecast_demand_source'
   ORDER BY revision DESC LIMIT 1;
  RETURN jsonb_build_object('consent',public.canonical_forecast_retell_source_consent_projection(replay),
   'replayed',TRUE,'current',replay.id=current_row.id,
   'active',replay.id=current_row.id AND replay.action='grant');
 END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_retell_source_consents
  WHERE organization_id=org AND purpose_key='forecast_demand_source'
  ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint IS DISTINCT FROM COALESCE(current_row.revision,0) OR
   body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Forecast source permission changed' USING ERRCODE='40001';END IF;
 IF (body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant')) OR
    (body->>'action'='grant' AND current_row.action='grant') THEN
  RAISE EXCEPTION 'Forecast source permission action invalid' USING ERRCODE='22023';END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 IF next_revision>10000 THEN RAISE EXCEPTION 'Forecast source permission history limit reached' USING ERRCODE='54000';END IF;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-demand-source-consent-v1','organizationId',org,
  'purposeKey','forecast_demand_source','revision',next_revision,
  'previousId',current_row.id,'action',body->>'action',
  'sourceScope','["retell.inbound_calls"]'::jsonb,'actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,
  'reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_forecast_retell_source_consents(
  organization_id,purpose_key,revision,previous_id,action,source_scope,
  consent_version,actor_user_id,membership_id,auth_session_id,reason,
  request_key_hash,request_digest,canonical_digest)
 VALUES(org,'forecast_demand_source',next_revision,current_row.id,body->>'action',
  '["retell.inbound_calls"]'::jsonb,'m26-retell-demand-source-consent-v1',
  actor,(authority->>'membershipId')::uuid,session_value,body->>'reason',
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_forecast_retell_source_consent_projection(inserted),
  'replayed',FALSE,'current',TRUE,'active',inserted.action='grant');
END $$;

-- Bind every newly captured source receipt to the exact company permission
-- period. Historical receipts remain null-bound and cannot be revived by a
-- later grant. This permission is still insufficient to issue a forecast.
ALTER TABLE public.canonical_forecast_retell_call_snapshots
 ADD COLUMN source_consent_id UUID,
 ADD COLUMN source_consent_digest CHAR(64),
 ADD CONSTRAINT canonical_forecast_retell_snapshot_consent_pair CHECK
  ((source_consent_id IS NULL)=(source_consent_digest IS NULL)),
 ADD CONSTRAINT canonical_forecast_retell_snapshot_consent_fk
  FOREIGN KEY(organization_id,source_consent_id)
  REFERENCES public.canonical_forecast_retell_source_consents(organization_id,id) ON DELETE RESTRICT;

CREATE FUNCTION public.canonical_forecast_retell_source_permission_current(
 org UUID,consent_value UUID,digest_value TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT consent_value IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.canonical_forecast_retell_source_consents consent
  WHERE consent.organization_id=org AND consent.id=consent_value
    AND consent.action='grant' AND rtrim(consent.canonical_digest)=digest_value
    AND consent.id=(SELECT current_consent.id
      FROM public.canonical_forecast_retell_source_consents current_consent
      WHERE current_consent.organization_id=org AND
        current_consent.purpose_key='forecast_demand_source'
      ORDER BY revision DESC LIMIT 1))
$$;

CREATE FUNCTION public.canonical_forecast_retell_snapshot_consent_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_forecast_retell_source_consents%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_retell_source_consents
  WHERE organization_id=NEW.organization_id AND purpose_key='forecast_demand_source'
  ORDER BY revision DESC LIMIT 1;
 IF current_row.id IS NULL OR current_row.action<>'grant' OR
   current_row.created_at>NEW.as_of THEN
  RAISE EXCEPTION 'Forecast call source permission unavailable' USING ERRCODE='42501';END IF;
 NEW.source_consent_id:=current_row.id;
 NEW.source_consent_digest:=current_row.canonical_digest;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_retell_00_snapshot_consent_guard
 BEFORE INSERT ON public.canonical_forecast_retell_call_snapshots
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_retell_snapshot_consent_guard();

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_snapshot_projection(
 value public.canonical_forecast_retell_call_snapshots)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN public.canonical_forecast_retell_source_permission_current(
   value.organization_id,value.source_consent_id,rtrim(value.source_consent_digest))
 THEN jsonb_build_object('id',value.id,'version','m26-as-of-source-manifest-v1',
  'organizationId',value.organization_id,
  'asOf',public.canonical_forecast_utc_instant(value.as_of),
  'capturedAt',public.canonical_forecast_utc_instant(value.created_at),
  'purposeKey',value.purpose_key,'targetKey',value.target_key,
  'sources',value.source_manifest,'sourceCount',jsonb_array_length(value.source_manifest),
  'sourceSnapshotDigest',rtrim(value.snapshot_digest),
  'sourceConsentId',value.source_consent_id,
  'sourceConsentDigest',rtrim(value.source_consent_digest),
  'identityBoundary','Retell call receipts are not distinct reviewed lead identities or complete provider coverage.')
 ELSE jsonb_build_object('id',value.id,'stale',TRUE,'refreshRequired',TRUE,
  'sources','[]'::jsonb,'reason','Company permission to use this call source is no longer current.') END
$$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_snapshot_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_retell_call_snapshots%ROWTYPE;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast source access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
  JOIN public.organization_onboarding onboarding
    ON onboarding.organization_id=subscription.organization_id
  WHERE subscription.organization_id=org AND onboarding.status='complete'
    AND (subscription.status='active' OR
      (subscription.status='trialing' AND subscription.trial_started_at IS NOT NULL
        AND subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days'
        AND subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Current forecast access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 IF NOT public.canonical_forecast_retell_source_permission_current(
   org,selected.source_consent_id,rtrim(selected.source_consent_digest)) THEN
  RETURN jsonb_build_object('id',selected.id,'stale',TRUE,'refreshRequired',TRUE,
   'sources','[]'::jsonb,'reason','Company permission to use this call source is no longer current.');
 END IF;
 IF selected.source_manifest IS DISTINCT FROM
   public.canonical_forecast_retell_call_pins(org,selected.as_of) THEN
  RETURN jsonb_build_object('id',selected.id,'stale',TRUE,'refreshRequired',TRUE,
   'sourceSnapshotDigest',rtrim(selected.snapshot_digest),'sources','[]'::jsonb,
   'reason','The recorded call source changed. Capture a new receipt before using it.');
 END IF;
 RETURN public.canonical_forecast_retell_call_snapshot_projection(selected)||
   jsonb_build_object('stale',FALSE,'refreshRequired',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_review_source(
 org UUID,snapshot_value UUID,transcript_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_retell_call_snapshots%ROWTYPE;source_value JSONB;
BEGIN
 SELECT * INTO saved FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND id=snapshot_value;
 IF saved.id IS NULL OR NOT public.canonical_forecast_retell_source_permission_current(
   org,saved.source_consent_id,rtrim(saved.source_consent_digest)) OR
   saved.source_manifest IS DISTINCT FROM
   public.canonical_forecast_retell_call_pins(org,saved.as_of) THEN RETURN NULL;END IF;
 SELECT item INTO source_value FROM jsonb_array_elements(saved.source_manifest)item
  WHERE item->>'sourceKind'='retell_call' AND item->>'sourceId'=transcript_value::text
    AND item->>'state'='active';
 RETURN source_value;
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_retell_source_consents FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_source_consent_projection(public.canonical_forecast_retell_source_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_source_consent_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_source_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_source_permission_current(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_retell_snapshot_consent_guard() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_source_consent_read(UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_retell_source_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,JSONB) TO northstar_app_runtime;
END IF;END $$;
