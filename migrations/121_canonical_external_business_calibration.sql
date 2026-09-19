-- Mission 25 Part 12I: source-specific customer, project and financial calibration.
-- This authority is descriptive and advisory only. It never changes operational records.

CREATE TABLE public.canonical_external_business_calibration_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 calibration_kind TEXT NOT NULL CHECK(calibration_kind IN ('customer','project','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 secondary_source_key TEXT NOT NULL CHECK((calibration_kind='customer' AND secondary_source_key~'^[a-z0-9][a-z0-9._-]{1,63}$') OR (calibration_kind<>'customer' AND secondary_source_key='')),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 outcome_consent_id UUID, outcome_consent_revision BIGINT, outcome_consent_digest TEXT,
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-business-calibration-consent-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,calibration_kind,source_key,secondary_source_key,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,calibration_kind,source_key,secondary_source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 FOREIGN KEY(organization_id,calibration_kind,source_key,secondary_source_key,previous_id)
  REFERENCES public.canonical_external_business_calibration_consents(organization_id,calibration_kind,source_key,secondary_source_key,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((action='grant' AND outcome_consent_id IS NOT NULL AND outcome_consent_revision BETWEEN 1 AND 10000 AND outcome_consent_digest~'^[0-9a-f]{64}$')
   OR (action='revoke' AND outcome_consent_id IS NULL AND outcome_consent_revision IS NULL AND outcome_consent_digest IS NULL))
);

CREATE TABLE public.canonical_external_business_calibration_proposals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id),
 calibration_kind TEXT NOT NULL CHECK(calibration_kind IN ('customer','project','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 secondary_source_key TEXT NOT NULL CHECK((calibration_kind='customer' AND secondary_source_key~'^[a-z0-9][a-z0-9._-]{1,63}$') OR (calibration_kind<>'customer' AND secondary_source_key='')),
 service_key TEXT NOT NULL CHECK(service_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 consent_id UUID NOT NULL, consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000), consent_digest TEXT NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 outcome_consent_id UUID NOT NULL, outcome_consent_revision BIGINT NOT NULL CHECK(outcome_consent_revision BETWEEN 1 AND 10000), outcome_consent_digest TEXT NOT NULL CHECK(outcome_consent_digest~'^[0-9a-f]{64}$'),
 sample_manifest JSONB NOT NULL CHECK(jsonb_typeof(sample_manifest)='object'), sample_digest TEXT NOT NULL CHECK(sample_digest~'^[0-9a-f]{64}$'),
 sample_size INTEGER NOT NULL CHECK(sample_size BETWEEN 5 AND 100), stale_excluded_count INTEGER NOT NULL CHECK(stale_excluded_count BETWEEN 0 AND 10000),
 metrics JSONB NOT NULL, eligible_metric_count INTEGER NOT NULL CHECK(eligible_metric_count BETWEEN 1 AND 4),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)), confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-business-calibration-proposal-v1'),
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-external-business-calibration-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,calibration_kind,source_key,secondary_source_key,service_key,revision),
 UNIQUE(organization_id,calibration_kind,source_key,secondary_source_key,service_key,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,calibration_kind,source_key,secondary_source_key,service_key,sample_digest,consent_id),
 FOREIGN KEY(organization_id,calibration_kind,source_key,secondary_source_key,consent_id)
  REFERENCES public.canonical_external_business_calibration_consents(organization_id,calibration_kind,source_key,secondary_source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 FOREIGN KEY(organization_id,calibration_kind,source_key,secondary_source_key,service_key,previous_id)
  REFERENCES public.canonical_external_business_calibration_proposals(organization_id,calibration_kind,source_key,secondary_source_key,service_key,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE INDEX canonical_external_business_calibration_current_idx ON public.canonical_external_business_calibration_proposals
 (organization_id,calibration_kind,source_key,secondary_source_key,service_key,revision DESC);
CREATE TRIGGER canonical_external_business_calibration_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_business_calibration_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_business_calibration_proposals_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_business_calibration_proposals FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_external_business_calibration_outcome_consent_basis(org UUID,kind_value TEXT,source_value TEXT,secondary_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item RECORD; source_current JSONB; second_current JSONB;
BEGIN
 IF kind_value='customer' THEN
  SELECT * INTO item FROM public.canonical_external_customer_outcome_consents WHERE organization_id=org AND crm_source_key=source_value AND communication_source_key=secondary_value ORDER BY revision DESC LIMIT 1;
  source_current:=public.canonical_external_business_source_consent_basis(org,'crm_field_service',source_value);
  second_current:=public.canonical_external_business_source_consent_basis(org,'communication',secondary_value);
  IF item.id IS NULL OR item.action<>'grant' OR source_current IS NULL OR second_current IS NULL
   OR item.crm_source_consent_id<>(source_current->>'id')::uuid OR rtrim(item.crm_source_consent_digest)<>source_current->>'digest'
   OR item.communication_source_consent_id<>(second_current->>'id')::uuid OR rtrim(item.communication_source_consent_digest)<>second_current->>'digest' THEN RETURN NULL; END IF;
 ELSIF kind_value='project' THEN
  SELECT * INTO item FROM public.canonical_external_project_outcome_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
  source_current:=public.canonical_external_business_source_consent_basis(org,'project_change_order',source_value);
  IF item.id IS NULL OR item.action<>'grant' OR source_current IS NULL OR item.source_consent_id<>(source_current->>'id')::uuid OR rtrim(item.source_consent_digest)<>source_current->>'digest' THEN RETURN NULL; END IF;
 ELSIF kind_value='financial' THEN
  SELECT * INTO item FROM public.canonical_external_financial_outcome_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
  source_current:=public.canonical_external_business_source_consent_basis(org,'financial',source_value);
  IF item.id IS NULL OR item.action<>'grant' OR source_current IS NULL OR item.source_consent_id<>(source_current->>'id')::uuid OR rtrim(item.source_consent_digest)<>source_current->>'digest' THEN RETURN NULL; END IF;
 ELSE RETURN NULL; END IF;
 RETURN jsonb_build_object('id',item.id,'revision',item.revision,'digest',rtrim(item.canonical_digest));
END $$;

CREATE FUNCTION public.canonical_external_business_calibration_metric_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(value)='object' AND public.canonical_field_evidence_object_keys_exact(value,
  ARRAY['status','label','metricType','sampleSize','unit','currency','median','lowerQuartile','upperQuartile','distribution','mostCommonValue','mostCommonCount','advisoryAvailable','advisoryMessage','unavailableReason'])
 AND value->>'status' IN ('compared','unavailable') AND jsonb_typeof(value->'label')='string'
 AND value->>'metricType' IN ('numeric','categorical') AND jsonb_typeof(value->'sampleSize')='number'
 AND value->>'label' IN ('Lead outcome','Appointment outcome','Issued estimate outcome','Customer response','Contract change','Change-order value','Project duration','Project delivery state','Recorded revenue','Recorded collections','Recorded realized cost','Recorded margin')
 AND (value->'unit'='null'::jsonb OR value->>'unit' IN ('currency amount','seconds','percent'))
 AND (value->'currency'='null'::jsonb OR (jsonb_typeof(value->'currency')='string' AND value->>'currency'~'^[A-Z]{3}$'))
 AND (value->>'sampleSize')~'^(0|[1-9][0-9]{0,2})$' AND (value->>'sampleSize')::int BETWEEN 0 AND 100
 AND jsonb_typeof(value->'advisoryAvailable')='boolean'
 AND ((value->>'status'='unavailable' AND value->'median'='null'::jsonb AND value->'lowerQuartile'='null'::jsonb
   AND value->'upperQuartile'='null'::jsonb AND value->'distribution'='null'::jsonb AND value->'mostCommonValue'='null'::jsonb
   AND value->'mostCommonCount'='null'::jsonb AND value->'advisoryAvailable'='false'::jsonb AND value->'advisoryMessage'='null'::jsonb
   AND jsonb_typeof(value->'unavailableReason')='string' AND public.canonical_learning_text_valid(value->>'unavailableReason',500))
 OR (value->>'status'='compared' AND (value->>'sampleSize')::int BETWEEN 5 AND 100 AND value->'unavailableReason'='null'::jsonb
   AND ((value->>'metricType'='numeric' AND jsonb_typeof(value->'median')='string' AND value->>'median'~'^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,6})?$'
     AND jsonb_typeof(value->'lowerQuartile')='string' AND jsonb_typeof(value->'upperQuartile')='string'
     AND value->'distribution'='null'::jsonb AND value->'mostCommonValue'='null'::jsonb AND value->'mostCommonCount'='null'::jsonb)
    OR (value->>'metricType'='categorical' AND value->'median'='null'::jsonb AND value->'lowerQuartile'='null'::jsonb AND value->'upperQuartile'='null'::jsonb
     AND jsonb_typeof(value->'distribution')='object' AND (value->'mostCommonValue'='null'::jsonb OR jsonb_typeof(value->'mostCommonValue')='string') AND jsonb_typeof(value->'mostCommonCount')='number'))
   AND (value->>'metricType'='numeric' OR (value->'advisoryAvailable'='true'::jsonb AND jsonb_typeof(value->'mostCommonValue')='string') OR (value->'advisoryAvailable'='false'::jsonb AND value->'mostCommonValue'='null'::jsonb))
   AND ((value->'advisoryAvailable'='true'::jsonb AND jsonb_typeof(value->'advisoryMessage')='string' AND public.canonical_learning_text_valid(value->>'advisoryMessage',500))
    OR (value->'advisoryAvailable'='false'::jsonb AND value->'advisoryMessage'='null'::jsonb)))),FALSE) $$;

CREATE FUNCTION public.canonical_external_business_calibration_metrics_valid(kind_value TEXT,value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(value)='object'
 AND ((kind_value='customer' AND public.canonical_field_evidence_object_keys_exact(value,ARRAY['lead','appointment','issuedEstimate','customerResponse']))
   OR (kind_value='project' AND public.canonical_field_evidence_object_keys_exact(value,ARRAY['contractChange','changeOrderValue','deliveryDuration','deliveryState']))
   OR (kind_value='financial' AND public.canonical_field_evidence_object_keys_exact(value,ARRAY['revenue','collection','realizedCost','margin'])))
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(value) item WHERE public.canonical_external_business_calibration_metric_valid(item.value) IS NOT TRUE),FALSE) $$;
ALTER TABLE public.canonical_external_business_calibration_proposals ADD CONSTRAINT canonical_external_business_calibration_metrics_check
 CHECK(public.canonical_external_business_calibration_metrics_valid(calibration_kind,metrics));

CREATE FUNCTION public.canonical_external_business_calibration_consent_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_external_business_calibration_consents%ROWTYPE; outcome_current JSONB; expected TEXT;
BEGIN
 IF NEW.revision>1 THEN SELECT * INTO prior FROM public.canonical_external_business_calibration_consents WHERE organization_id=NEW.organization_id AND calibration_kind=NEW.calibration_kind AND source_key=NEW.source_key AND secondary_source_key=NEW.secondary_source_key AND id=NEW.previous_id;
  IF prior.id IS NULL OR prior.revision+1<>NEW.revision THEN RAISE EXCEPTION 'Business calibration permission revision invalid' USING ERRCODE='23514'; END IF; END IF;
 IF NEW.action='grant' THEN outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(NEW.organization_id,NEW.calibration_kind,NEW.source_key,NEW.secondary_source_key);
  IF outcome_current IS NULL OR NEW.outcome_consent_id<>(outcome_current->>'id')::uuid OR NEW.outcome_consent_revision<>(outcome_current->>'revision')::bigint OR rtrim(NEW.outcome_consent_digest)<>outcome_current->>'digest' THEN RAISE EXCEPTION 'Business calibration outcome permission invalid' USING ERRCODE='23514'; END IF; END IF;
 expected:=public.canonical_completion_digest(jsonb_build_object('organizationId',NEW.organization_id,'kind',NEW.calibration_kind,'sourceKey',NEW.source_key,'secondarySourceKey',NEW.secondary_source_key,'revision',NEW.revision,'previousId',NEW.previous_id,'action',NEW.action,'outcomeConsent',CASE WHEN NEW.action='grant' THEN jsonb_build_object('id',NEW.outcome_consent_id,'revision',NEW.outcome_consent_revision,'digest',rtrim(NEW.outcome_consent_digest)) ELSE NULL END,'actorUserId',NEW.actor_user_id,'reason',NEW.reason,'confirmationVersion',NEW.confirmation_version,'requestDigest',rtrim(NEW.request_digest)));
 IF rtrim(NEW.canonical_digest)<>expected THEN RAISE EXCEPTION 'Business calibration permission digest invalid' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER canonical_external_business_calibration_consent_guard BEFORE INSERT ON public.canonical_external_business_calibration_consents FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_calibration_consent_guard();

CREATE FUNCTION public.canonical_external_business_calibration_consent_projection(value public.canonical_external_business_calibration_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'kind',value.calibration_kind,'sourceKey',value.source_key,
  'secondarySourceKey',CASE WHEN value.secondary_source_key='' THEN NULL ELSE value.secondary_source_key END,
  'revision',value.revision,'previousId',value.previous_id,'action',value.action,
  'outcomeConsent',CASE WHEN value.outcome_consent_id IS NULL THEN NULL ELSE jsonb_build_object('id',value.outcome_consent_id,'revision',value.outcome_consent_revision,'digest',rtrim(value.outcome_consent_digest)) END,
  'reason',value.reason,'confirmationVersion',value.confirmation_version,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at) $$;

CREATE FUNCTION public.canonical_external_business_calibration_consent_read(org UUID,actor UUID,role_value TEXT,session_value UUID,kind_value TEXT,source_value TEXT,secondary_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_external_business_calibration_consents%ROWTYPE; outcome_current JSONB; history JSONB; total BIGINT; active_value BOOLEAN;
BEGIN
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Business calibration is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 secondary_value:=COALESCE(secondary_value,'');
 IF kind_value NOT IN ('customer','project','financial') OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$'
  OR ((kind_value='customer') IS DISTINCT FROM (secondary_value~'^[a-z0-9][a-z0-9._-]{1,63}$')) THEN RAISE EXCEPTION 'Business calibration source invalid' USING ERRCODE='22023'; END IF;
 outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(org,kind_value,source_value,secondary_value);
 SELECT * INTO current_row FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value ORDER BY revision DESC LIMIT 1;
 active_value:=current_row.id IS NOT NULL AND current_row.action='grant' AND outcome_current IS NOT NULL
  AND current_row.outcome_consent_id=(outcome_current->>'id')::uuid AND rtrim(current_row.outcome_consent_digest)=outcome_current->>'digest';
 SELECT count(*) INTO total FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value;
 SELECT COALESCE(jsonb_agg(public.canonical_external_business_calibration_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value ORDER BY revision DESC LIMIT 20)item;
 RETURN jsonb_build_object('kind',kind_value,'sourceKey',source_value,'secondarySourceKey',NULLIF(secondary_value,''),'active',active_value,
  'current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_external_business_calibration_consent_projection(current_row) END,
  'history',history,'total',total,'truncated',total>20,'blockedReason',CASE WHEN active_value THEN NULL WHEN outcome_current IS NULL THEN 'Current outcome learning permission is required.' WHEN current_row.action='grant' THEN 'Calibration permission must be renewed for the current outcome learning period.' ELSE 'Calibration permission is not active.' END);
END $$;

CREATE FUNCTION public.canonical_external_business_calibration_consent_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,kind_value TEXT,source_value TEXT,secondary_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_external_business_calibration_consents%ROWTYPE; replay_row public.canonical_external_business_calibration_consents%ROWTYPE; inserted public.canonical_external_business_calibration_consents%ROWTYPE; outcome_current JSONB; key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT; active_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Business calibration is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); secondary_value:=COALESCE(secondary_value,'');
 IF kind_value NOT IN ('customer','project','financial') OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR ((kind_value='customer') IS DISTINCT FROM (secondary_value~'^[a-z0-9][a-z0-9._-]{1,63}$'))
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192 OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision')<>'number' OR body->>'expectedRevision'!~'^(0|[1-9][0-9]{0,4})$'
  OR jsonb_typeof(body->'expectedDigest')<>'string' OR (body->>'expectedDigest'<>'none' AND body->>'expectedDigest'!~'^[0-9a-f]{64}$')
  OR (((body->>'expectedRevision')::bigint=0) IS DISTINCT FROM (body->>'expectedDigest'='none')) OR body->'confirmed'<>'true'::jsonb
  OR body->>'confirmationVersion'<>'m25-external-business-calibration-consent-v1' OR jsonb_typeof(body->'reason')<>'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Business calibration permission details are invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'kind',kind_value,'sourceKey',source_value,'secondarySourceKey',secondary_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-business-calibration-consent:'||kind_value||':'||source_value||':'||secondary_value,0));
 SELECT * INTO replay_row FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Business calibration permission key conflict' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object('consent',public.canonical_external_business_calibration_consent_projection(replay_row),'replayed',TRUE); END IF;
 outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(org,kind_value,source_value,secondary_value);
 SELECT * INTO current_row FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN RAISE EXCEPTION 'Business calibration permission changed' USING ERRCODE='40001'; END IF;
 active_value:=current_row.id IS NOT NULL AND current_row.action='grant' AND outcome_current IS NOT NULL AND current_row.outcome_consent_id=(outcome_current->>'id')::uuid AND rtrim(current_row.outcome_consent_digest)=outcome_current->>'digest';
 IF body->>'action'='grant' AND outcome_current IS NULL THEN RAISE EXCEPTION 'Current outcome learning permission is required' USING ERRCODE='P0002',CONSTRAINT='external_business_calibration_outcome_consent_unavailable'; END IF;
 IF body->>'action'='grant' AND active_value THEN RAISE EXCEPTION 'Business calibration permission is already active' USING ERRCODE='22023'; END IF;
 IF body->>'action'='revoke' AND NOT active_value THEN RAISE EXCEPTION 'No active business calibration permission' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'kind',kind_value,'sourceKey',source_value,'secondarySourceKey',secondary_value,'revision',next_revision,'previousId',current_row.id,'action',body->>'action','outcomeConsent',CASE WHEN body->>'action'='grant' THEN outcome_current ELSE NULL END,'actorUserId',actor,'reason',body->>'reason','confirmationVersion',body->>'confirmationVersion','requestDigest',request_hash));
 INSERT INTO public.canonical_external_business_calibration_consents(organization_id,calibration_kind,source_key,secondary_source_key,revision,previous_id,action,outcome_consent_id,outcome_consent_revision,outcome_consent_digest,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,kind_value,source_value,secondary_value,next_revision,current_row.id,body->>'action',CASE WHEN body->>'action'='grant' THEN (outcome_current->>'id')::uuid END,CASE WHEN body->>'action'='grant' THEN (outcome_current->>'revision')::bigint END,CASE WHEN body->>'action'='grant' THEN outcome_current->>'digest' END,actor,(authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,body->>'confirmationVersion',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_external_business_calibration_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_business_calibration_numeric_metric(observations JSONB,path_value TEXT,label_value TEXT,unit_value TEXT,currency_path TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n INTEGER; currencies INTEGER; currency_value TEXT; med NUMERIC; lo NUMERIC; hi NUMERIC;
BEGIN
 WITH eligible AS(SELECT (item#>>string_to_array(path_value,'.'))::numeric value,
  CASE WHEN currency_path='' THEN NULL ELSE item#>>string_to_array(currency_path,'.') END currency
  FROM jsonb_array_elements(observations)item WHERE item#>>string_to_array(path_value,'.') IS NOT NULL)
 SELECT count(*)::int,count(DISTINCT currency)::int,min(currency),round(percentile_cont(.5)WITHIN GROUP(ORDER BY value)::numeric,6),round(percentile_cont(.25)WITHIN GROUP(ORDER BY value)::numeric,6),round(percentile_cont(.75)WITHIN GROUP(ORDER BY value)::numeric,6)
 INTO n,currencies,currency_value,med,lo,hi FROM eligible;
 IF n<5 OR (currency_path<>'' AND currencies<>1) THEN RETURN jsonb_build_object('status','unavailable','label',label_value,'metricType','numeric','sampleSize',n,'unit',unit_value,'currency',NULL,'median',NULL,'lowerQuartile',NULL,'upperQuartile',NULL,'distribution',NULL,'mostCommonValue',NULL,'mostCommonCount',NULL,'advisoryAvailable',FALSE,'advisoryMessage',NULL,'unavailableReason',CASE WHEN n<5 THEN 'At least five current outcomes with this comparable dimension are required.' ELSE 'Current outcomes use more than one currency. Currency conversion is not inferred.' END); END IF;
 RETURN jsonb_build_object('status','compared','label',label_value,'metricType','numeric','sampleSize',n,'unit',unit_value,'currency',currency_value,'median',med::text,'lowerQuartile',lo::text,'upperQuartile',hi::text,'distribution',NULL,'mostCommonValue',NULL,'mostCommonCount',NULL,'advisoryAvailable',TRUE,'advisoryMessage','This is the median and middle half of the current reviewed same-service sample.','unavailableReason',NULL);
END $$;

CREATE FUNCTION public.canonical_external_business_calibration_categorical_metric(observations JSONB,path_value TEXT,label_value TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n INTEGER; distribution_value JSONB; mode_value TEXT; mode_count INTEGER; mode_ties INTEGER;
BEGIN
 WITH eligible AS(SELECT item#>>string_to_array(path_value,'.') value FROM jsonb_array_elements(observations)item WHERE item#>>string_to_array(path_value,'.') IS NOT NULL),counts AS(SELECT value,count(*)::int count FROM eligible GROUP BY value),ranked AS(SELECT *,dense_rank()OVER(ORDER BY count DESC) rank FROM counts)
 SELECT (SELECT count(*)::int FROM eligible),COALESCE((SELECT jsonb_object_agg(value,count ORDER BY value) FROM counts),'{}'::jsonb),(SELECT min(value) FROM ranked WHERE rank=1),(SELECT max(count) FROM counts),(SELECT count(*)::int FROM ranked WHERE rank=1)
 INTO n,distribution_value,mode_value,mode_count,mode_ties;
 IF n<5 THEN RETURN jsonb_build_object('status','unavailable','label',label_value,'metricType','categorical','sampleSize',n,'unit',NULL,'currency',NULL,'median',NULL,'lowerQuartile',NULL,'upperQuartile',NULL,'distribution',NULL,'mostCommonValue',NULL,'mostCommonCount',NULL,'advisoryAvailable',FALSE,'advisoryMessage',NULL,'unavailableReason','At least five current outcomes with this comparable dimension are required.'); END IF;
 RETURN jsonb_build_object('status','compared','label',label_value,'metricType','categorical','sampleSize',n,'unit',NULL,'currency',NULL,'median',NULL,'lowerQuartile',NULL,'upperQuartile',NULL,'distribution',distribution_value,'mostCommonValue',CASE WHEN mode_ties=1 THEN mode_value ELSE NULL END,'mostCommonCount',mode_count,'advisoryAvailable',mode_ties=1,'advisoryMessage',CASE WHEN mode_ties=1 THEN 'This was the most frequently recorded value in the current reviewed same-service sample.' ELSE NULL END,'unavailableReason',NULL);
END $$;

CREATE FUNCTION public.canonical_external_business_calibration_basis(org UUID,kind_value TEXT,source_value TEXT,secondary_value TEXT,service_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE outcome_current JSONB; item RECORD; basis_value JSONB; observations JSONB:='[]'::jsonb; candidate_total INTEGER:=0; fresh_total INTEGER:=0; metrics_value JSONB; eligible_count INTEGER; manifest JSONB;
BEGIN
 secondary_value:=COALESCE(secondary_value,''); outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(org,kind_value,source_value,secondary_value);
 IF outcome_current IS NULL THEN RAISE EXCEPTION 'Current outcome learning permission is required' USING ERRCODE='P0002',CONSTRAINT='external_business_calibration_outcome_consent_unavailable'; END IF;
 IF service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'Business calibration service invalid' USING ERRCODE='22023'; END IF;
 IF kind_value='customer' THEN
  SELECT count(*) INTO candidate_total FROM (SELECT DISTINCT ON(estimate_id,crm_estimate_reference,communication_estimate_reference)o.* FROM public.canonical_external_customer_outcome_observations o WHERE organization_id=org AND crm_source_key=source_value AND communication_source_key=secondary_value ORDER BY estimate_id,crm_estimate_reference,communication_estimate_reference,revision DESC,id DESC)o JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE lower(btrim(p.service_type))=service_value;
  IF candidate_total>10000 THEN RAISE EXCEPTION 'Business calibration sample is too broad' USING ERRCODE='P0002',CONSTRAINT='external_business_calibration_scope_too_broad'; END IF;
  FOR item IN SELECT o.* FROM (SELECT DISTINCT ON(estimate_id,crm_estimate_reference,communication_estimate_reference)x.* FROM public.canonical_external_customer_outcome_observations x WHERE organization_id=org AND crm_source_key=source_value AND communication_source_key=secondary_value ORDER BY estimate_id,crm_estimate_reference,communication_estimate_reference,revision DESC,id DESC)o JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE lower(btrim(p.service_type))=service_value ORDER BY o.estimate_id,o.crm_estimate_reference,o.communication_estimate_reference LOOP
   basis_value:=public.canonical_external_customer_outcome_basis(org,source_value,secondary_value,item.estimate_id,item.crm_estimate_reference,item.communication_estimate_reference);
   IF basis_value IS NULL OR item.consent_id<>(outcome_current->>'id')::uuid OR rtrim(item.source_digest)<>basis_value->>'sourceDigest' THEN CONTINUE; END IF;
   fresh_total:=fresh_total+1; IF fresh_total<=100 THEN observations:=observations||jsonb_build_array(jsonb_build_object('observationId',item.id,'estimateId',item.estimate_id,'crmEstimateReference',item.crm_estimate_reference,'communicationEstimateReference',item.communication_estimate_reference,'revision',item.revision,'digest',rtrim(item.canonical_digest),'sourceDigest',rtrim(item.source_digest),'outcomes',item.outcomes)); END IF;
  END LOOP;
  metrics_value:=jsonb_build_object('lead',public.canonical_external_business_calibration_categorical_metric(observations,'outcomes.lead.value','Lead outcome'),'appointment',public.canonical_external_business_calibration_categorical_metric(observations,'outcomes.appointment.value','Appointment outcome'),'issuedEstimate',public.canonical_external_business_calibration_categorical_metric(observations,'outcomes.issuedEstimate.value','Issued estimate outcome'),'customerResponse',public.canonical_external_business_calibration_categorical_metric(observations,'outcomes.customerResponse.value','Customer response'));
 ELSIF kind_value='project' THEN
  SELECT count(*) INTO candidate_total FROM (SELECT DISTINCT ON(estimate_id,project_reference)o.* FROM public.canonical_external_project_outcome_observations o WHERE organization_id=org AND source_key=source_value ORDER BY estimate_id,project_reference,revision DESC,id DESC)o JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE lower(btrim(p.service_type))=service_value;
  IF candidate_total>10000 THEN RAISE EXCEPTION 'Business calibration sample is too broad' USING ERRCODE='P0002',CONSTRAINT='external_business_calibration_scope_too_broad'; END IF;
  FOR item IN SELECT o.* FROM (SELECT DISTINCT ON(estimate_id,project_reference)x.* FROM public.canonical_external_project_outcome_observations x WHERE organization_id=org AND source_key=source_value ORDER BY estimate_id,project_reference,revision DESC,id DESC)o JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE lower(btrim(p.service_type))=service_value ORDER BY o.estimate_id,o.project_reference LOOP
   basis_value:=public.canonical_external_project_outcome_basis(org,source_value,item.estimate_id,item.project_reference);
   IF basis_value IS NULL OR item.consent_id<>(outcome_current->>'id')::uuid OR rtrim(item.source_digest)<>basis_value->>'sourceDigest' THEN CONTINUE; END IF;
   fresh_total:=fresh_total+1; IF fresh_total<=100 THEN observations:=observations||jsonb_build_array(jsonb_build_object('observationId',item.id,'estimateId',item.estimate_id,'projectReference',item.project_reference,'revision',item.revision,'digest',rtrim(item.canonical_digest),'sourceDigest',rtrim(item.source_digest),'outcomes',item.outcomes)); END IF;
  END LOOP;
  metrics_value:=jsonb_build_object('contractChange',public.canonical_external_business_calibration_numeric_metric(observations,'outcomes.scope.contractChange.amount','Contract change','currency amount','outcomes.scope.contractChange.currency'),'changeOrderValue',public.canonical_external_business_calibration_numeric_metric(observations,'outcomes.changeOrders.signedValue.amount','Change-order value','currency amount','outcomes.changeOrders.signedValue.currency'),'deliveryDuration',public.canonical_external_business_calibration_numeric_metric(observations,'outcomes.projectDelivery.durationSeconds','Project duration','seconds',''),'deliveryState',public.canonical_external_business_calibration_categorical_metric(observations,'outcomes.projectDelivery.state','Project delivery state'));
 ELSE
  SELECT count(*) INTO candidate_total FROM (SELECT DISTINCT ON(estimate_id)o.* FROM public.canonical_external_financial_outcome_observations o WHERE organization_id=org AND source_key=source_value ORDER BY estimate_id,revision DESC,id DESC)o JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE lower(btrim(p.service_type))=service_value;
  IF candidate_total>10000 THEN RAISE EXCEPTION 'Business calibration sample is too broad' USING ERRCODE='P0002',CONSTRAINT='external_business_calibration_scope_too_broad'; END IF;
  FOR item IN SELECT o.* FROM (SELECT DISTINCT ON(estimate_id)x.* FROM public.canonical_external_financial_outcome_observations x WHERE organization_id=org AND source_key=source_value ORDER BY estimate_id,revision DESC,id DESC)o JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE lower(btrim(p.service_type))=service_value ORDER BY o.estimate_id LOOP
   basis_value:=public.canonical_external_financial_outcome_basis(org,source_value,item.estimate_id);
   IF basis_value IS NULL OR item.consent_id<>(outcome_current->>'id')::uuid OR rtrim(item.source_digest)<>basis_value->>'sourceDigest' THEN CONTINUE; END IF;
   fresh_total:=fresh_total+1; IF fresh_total<=100 THEN observations:=observations||jsonb_build_array(jsonb_build_object('observationId',item.id,'estimateId',item.estimate_id,'revision',item.revision,'digest',rtrim(item.canonical_digest),'sourceDigest',rtrim(item.source_digest),'outcomes',item.outcomes)); END IF;
  END LOOP;
  metrics_value:=jsonb_build_object('revenue',public.canonical_external_business_calibration_numeric_metric(observations,'outcomes.revenue.amount','Recorded revenue','currency amount','outcomes.revenue.currency'),'collection',public.canonical_external_business_calibration_numeric_metric(observations,'outcomes.collection.amount','Recorded collections','currency amount','outcomes.collection.currency'),'realizedCost',public.canonical_external_business_calibration_numeric_metric(observations,'outcomes.realizedCost.amount','Recorded realized cost','currency amount','outcomes.realizedCost.currency'),'margin',public.canonical_external_business_calibration_numeric_metric(observations,'outcomes.margin.percent','Recorded margin','percent',''));
 END IF;
 IF fresh_total<5 THEN RAISE EXCEPTION 'At least five current same-service outcomes are required' USING ERRCODE='P0002',CONSTRAINT='external_business_calibration_sample_insufficient'; END IF;
 SELECT count(*)::int INTO eligible_count FROM jsonb_each(metrics_value)m WHERE m.value->>'status'='compared';
 IF eligible_count=0 THEN RAISE EXCEPTION 'No comparable calibration dimension has five outcomes' USING ERRCODE='P0002',CONSTRAINT='external_business_calibration_dimension_sample_insufficient'; END IF;
 manifest:=jsonb_build_object('kind',kind_value,'sourceKey',source_value,'secondarySourceKey',NULLIF(secondary_value,''),'serviceKey',service_value,'outcomeConsent',outcome_current,'observations',observations);
 RETURN jsonb_build_object('sampleManifest',manifest,'sampleDigest',public.canonical_completion_digest(manifest),'sampleSize',jsonb_array_length(observations),'staleExcludedCount',candidate_total-fresh_total,'metrics',metrics_value,'eligibleMetricCount',eligible_count,
  'evidenceBoundary','Each dimension uses five to 100 current reviewed same-service outcomes from this exact source and learning period. Every outcome has equal weight. Missing values, mixed currencies and incompatible evidence remain unavailable; no currency or unit conversion is inferred.',
  'adoptionBoundary','These summaries support review only. No customer, lead, appointment, estimate, project, job, invoice, payment, price, schedule or company policy was changed.');
END $$;

CREATE FUNCTION public.canonical_external_business_calibration_projection(value public.canonical_external_business_calibration_proposals)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'kind',value.calibration_kind,'sourceKey',value.source_key,'secondarySourceKey',NULLIF(value.secondary_source_key,''),'serviceKey',value.service_key,'revision',value.revision,'previousId',value.previous_id,
  'consent',jsonb_build_object('id',value.consent_id,'revision',value.consent_revision,'digest',rtrim(value.consent_digest)),'outcomeConsent',jsonb_build_object('id',value.outcome_consent_id,'revision',value.outcome_consent_revision,'digest',rtrim(value.outcome_consent_digest)),
  'sampleManifest',value.sample_manifest,'sampleDigest',rtrim(value.sample_digest),'sampleSize',value.sample_size,'staleExcludedCount',value.stale_excluded_count,'metrics',value.metrics,'eligibleMetricCount',value.eligible_metric_count,'reason',value.reason,'confirmationVersion',value.confirmation_version,'calculationVersion',value.calculation_version,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at) $$;

CREATE FUNCTION public.canonical_external_business_calibration_hidden_projection(value public.canonical_external_business_calibration_proposals)
RETURNS JSONB LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'kind',value.calibration_kind,'serviceKey',value.service_key,'revision',value.revision,
  'fresh',FALSE,'hiddenByConsent',TRUE,'advisoryAvailable',FALSE,'refreshRequired',TRUE,'sampleManifest',NULL,'metrics',NULL,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at) $$;

CREATE FUNCTION public.canonical_external_business_calibration_proposal_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_business_calibration_consents%ROWTYPE; prior public.canonical_external_business_calibration_proposals%ROWTYPE; outcome_current JSONB; basis JSONB; expected TEXT;
BEGIN
 SELECT * INTO consent_row FROM public.canonical_external_business_calibration_consents WHERE organization_id=NEW.organization_id AND calibration_kind=NEW.calibration_kind AND source_key=NEW.source_key AND secondary_source_key=NEW.secondary_source_key AND id=NEW.consent_id;
 outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(NEW.organization_id,NEW.calibration_kind,NEW.source_key,NEW.secondary_source_key);
 IF consent_row.id IS NULL OR consent_row.action<>'grant' OR consent_row.revision<>NEW.consent_revision OR rtrim(consent_row.canonical_digest)<>rtrim(NEW.consent_digest) OR outcome_current IS NULL OR NEW.outcome_consent_id<>(outcome_current->>'id')::uuid OR NEW.outcome_consent_revision<>(outcome_current->>'revision')::bigint OR rtrim(NEW.outcome_consent_digest)<>outcome_current->>'digest' OR consent_row.outcome_consent_id<>NEW.outcome_consent_id OR rtrim(consent_row.outcome_consent_digest)<>rtrim(NEW.outcome_consent_digest) THEN RAISE EXCEPTION 'Business calibration proposal permission invalid' USING ERRCODE='23514'; END IF;
 IF NEW.revision>1 THEN SELECT * INTO prior FROM public.canonical_external_business_calibration_proposals WHERE organization_id=NEW.organization_id AND calibration_kind=NEW.calibration_kind AND source_key=NEW.source_key AND secondary_source_key=NEW.secondary_source_key AND service_key=NEW.service_key AND id=NEW.previous_id;
  IF prior.id IS NULL OR prior.revision+1<>NEW.revision THEN RAISE EXCEPTION 'Business calibration proposal revision invalid' USING ERRCODE='23514'; END IF; END IF;
 basis:=public.canonical_external_business_calibration_basis(NEW.organization_id,NEW.calibration_kind,NEW.source_key,NEW.secondary_source_key,NEW.service_key);
 IF NEW.sample_manifest<>basis->'sampleManifest' OR rtrim(NEW.sample_digest)<>basis->>'sampleDigest' OR NEW.sample_size<>(basis->>'sampleSize')::int OR NEW.stale_excluded_count<>(basis->>'staleExcludedCount')::int OR NEW.metrics<>basis->'metrics' OR NEW.eligible_metric_count<>(basis->>'eligibleMetricCount')::int THEN RAISE EXCEPTION 'Business calibration proposal evidence changed' USING ERRCODE='23514'; END IF;
 expected:=public.canonical_completion_digest(jsonb_build_object('organizationId',NEW.organization_id,'kind',NEW.calibration_kind,'sourceKey',NEW.source_key,'secondarySourceKey',NEW.secondary_source_key,'serviceKey',NEW.service_key,'revision',NEW.revision,'previousId',NEW.previous_id,'consentId',NEW.consent_id,'consentDigest',rtrim(NEW.consent_digest),'sampleDigest',rtrim(NEW.sample_digest),'metrics',NEW.metrics,'actorUserId',NEW.actor_user_id,'reason',NEW.reason,'confirmationVersion',NEW.confirmation_version,'calculationVersion',NEW.calculation_version,'requestDigest',rtrim(NEW.request_digest)));
 IF rtrim(NEW.canonical_digest)<>expected THEN RAISE EXCEPTION 'Business calibration proposal digest invalid' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER canonical_external_business_calibration_proposal_guard BEFORE INSERT ON public.canonical_external_business_calibration_proposals FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_calibration_proposal_guard();

CREATE FUNCTION public.canonical_external_business_calibration_propose(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,kind_value TEXT,source_value TEXT,secondary_value TEXT,service_value TEXT,expected_consent_revision BIGINT,expected_consent_digest TEXT,reason_value TEXT,confirmed_value BOOLEAN,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_external_business_calibration_consents%ROWTYPE; replay_row public.canonical_external_business_calibration_proposals%ROWTYPE; current_row public.canonical_external_business_calibration_proposals%ROWTYPE; inserted public.canonical_external_business_calibration_proposals%ROWTYPE; basis JSONB; outcome_current JSONB; key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Business calibration is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE); secondary_value:=COALESCE(secondary_value,'');
 IF key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR expected_consent_revision NOT BETWEEN 1 AND 10000 OR expected_consent_digest!~'^[0-9a-f]{64}$' OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS NOT TRUE OR confirmation_value<>'m25-external-business-calibration-proposal-v1' THEN RAISE EXCEPTION 'Business calibration proposal details are invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'kind',kind_value,'sourceKey',source_value,'secondarySourceKey',secondary_value,'serviceKey',service_value,'expectedConsentRevision',expected_consent_revision,'expectedConsentDigest',expected_consent_digest,'reason',reason_value,'confirmationVersion',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-business-calibration-proposal:'||kind_value||':'||source_value||':'||secondary_value||':'||service_value,0));
 SELECT * INTO replay_row FROM public.canonical_external_business_calibration_proposals WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Business calibration request key conflict' USING ERRCODE='23505'; END IF;
  SELECT * INTO consent_row FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value ORDER BY revision DESC LIMIT 1;
  outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(org,kind_value,source_value,secondary_value);
  IF consent_row.id IS NULL OR consent_row.action<>'grant' OR consent_row.id<>replay_row.consent_id OR outcome_current IS NULL OR consent_row.outcome_consent_id<>(outcome_current->>'id')::uuid OR rtrim(consent_row.outcome_consent_digest)<>outcome_current->>'digest' THEN RETURN jsonb_build_object('proposal',public.canonical_external_business_calibration_hidden_projection(replay_row),'replayed',TRUE); END IF;
  BEGIN basis:=public.canonical_external_business_calibration_basis(org,kind_value,source_value,secondary_value,service_value); EXCEPTION WHEN OTHERS THEN basis:=NULL; END;
  RETURN jsonb_build_object('proposal',public.canonical_external_business_calibration_projection(replay_row)||jsonb_build_object('fresh',COALESCE(rtrim(replay_row.sample_digest)=basis->>'sampleDigest',FALSE),'hiddenByConsent',FALSE,'refreshRequired',NOT COALESCE(rtrim(replay_row.sample_digest)=basis->>'sampleDigest',FALSE)),'replayed',TRUE);
 END IF;
 SELECT * INTO consent_row FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(org,kind_value,source_value,secondary_value);
 IF consent_row.id IS NULL OR consent_row.action<>'grant' OR consent_row.revision<>expected_consent_revision OR rtrim(consent_row.canonical_digest)<>expected_consent_digest OR outcome_current IS NULL OR consent_row.outcome_consent_id<>(outcome_current->>'id')::uuid OR rtrim(consent_row.outcome_consent_digest)<>outcome_current->>'digest' THEN RAISE EXCEPTION 'Current business calibration permission is required' USING ERRCODE='40001'; END IF;
 basis:=public.canonical_external_business_calibration_basis(org,kind_value,source_value,secondary_value,service_value);
 SELECT * INTO current_row FROM public.canonical_external_business_calibration_proposals WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value AND service_key=service_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF current_row.id IS NOT NULL AND current_row.consent_id=consent_row.id AND rtrim(current_row.sample_digest)=basis->>'sampleDigest' THEN RAISE EXCEPTION 'Current business calibration is already recorded' USING ERRCODE='22023',CONSTRAINT='external_business_calibration_already_current'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'kind',kind_value,'sourceKey',source_value,'secondarySourceKey',secondary_value,'serviceKey',service_value,'revision',next_revision,'previousId',current_row.id,'consentId',consent_row.id,'consentDigest',rtrim(consent_row.canonical_digest),'sampleDigest',basis->>'sampleDigest','metrics',basis->'metrics','actorUserId',actor,'reason',reason_value,'confirmationVersion',confirmation_value,'calculationVersion','m25-external-business-calibration-v1','requestDigest',request_hash));
 INSERT INTO public.canonical_external_business_calibration_proposals(organization_id,calibration_kind,source_key,secondary_source_key,service_key,revision,previous_id,consent_id,consent_revision,consent_digest,outcome_consent_id,outcome_consent_revision,outcome_consent_digest,sample_manifest,sample_digest,sample_size,stale_excluded_count,metrics,eligible_metric_count,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,calculation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,kind_value,source_value,secondary_value,service_value,next_revision,current_row.id,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),(outcome_current->>'id')::uuid,(outcome_current->>'revision')::bigint,outcome_current->>'digest',basis->'sampleManifest',basis->>'sampleDigest',(basis->>'sampleSize')::int,(basis->>'staleExcludedCount')::int,basis->'metrics',(basis->>'eligibleMetricCount')::int,actor,(authority->>'membershipId')::uuid,session_value,reason_value,TRUE,confirmation_value,'m25-external-business-calibration-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('proposal',public.canonical_external_business_calibration_projection(inserted)||jsonb_build_object('fresh',TRUE,'evidenceBoundary',basis->>'evidenceBoundary','adoptionBoundary',basis->>'adoptionBoundary'),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_external_business_calibration_read(org UUID,actor UUID,role_value TEXT,session_value UUID,kind_value TEXT,source_value TEXT,secondary_value TEXT,service_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_business_calibration_consents%ROWTYPE; current_row public.canonical_external_business_calibration_proposals%ROWTYPE; outcome_current JSONB; basis JSONB; visible_value BOOLEAN:=FALSE; fresh_value BOOLEAN:=FALSE;
BEGIN
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Business calibration is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE); secondary_value:=COALESCE(secondary_value,'');
 SELECT * INTO consent_row FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value ORDER BY revision DESC LIMIT 1;
 outcome_current:=public.canonical_external_business_calibration_outcome_consent_basis(org,kind_value,source_value,secondary_value);
 visible_value:=consent_row.id IS NOT NULL AND consent_row.action='grant' AND outcome_current IS NOT NULL AND consent_row.outcome_consent_id=(outcome_current->>'id')::uuid AND rtrim(consent_row.outcome_consent_digest)=outcome_current->>'digest';
 IF visible_value THEN SELECT * INTO current_row FROM public.canonical_external_business_calibration_proposals WHERE organization_id=org AND calibration_kind=kind_value AND source_key=source_value AND secondary_source_key=secondary_value AND service_key=service_value AND consent_id=consent_row.id ORDER BY revision DESC LIMIT 1; END IF;
 IF current_row.id IS NOT NULL THEN BEGIN basis:=public.canonical_external_business_calibration_basis(org,kind_value,source_value,secondary_value,service_value); fresh_value:=rtrim(current_row.sample_digest)=basis->>'sampleDigest'; EXCEPTION WHEN OTHERS THEN fresh_value:=FALSE; END; END IF;
 RETURN jsonb_build_object('kind',kind_value,'sourceKey',source_value,'secondarySourceKey',NULLIF(secondary_value,''),'serviceKey',service_value,'permissionActive',visible_value,'current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_external_business_calibration_projection(current_row)||jsonb_build_object('fresh',fresh_value) END,
  'evidenceBoundary','Each dimension requires five current comparable outcomes from the exact source and learning period. Missing or incompatible dimensions remain unavailable.','adoptionBoundary','Calibration is advice for owner review. It does not change operational records.');
END $$;

DO $acl$ DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE); BEGIN
 REVOKE ALL ON TABLE public.canonical_external_business_calibration_consents,public.canonical_external_business_calibration_proposals FROM PUBLIC;
 REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
 IF runtime_role IS NOT NULL AND btrim(runtime_role)<>'' THEN
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_external_business_calibration_consents,public.canonical_external_business_calibration_proposals FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_external_business_calibration_consent_read(uuid,uuid,text,uuid,text,text,text) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_external_business_calibration_consent_mutate(uuid,uuid,text,uuid,text,text,text,text,text,jsonb) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_external_business_calibration_propose(uuid,uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,boolean,text) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_external_business_calibration_read(uuid,uuid,text,uuid,text,text,text,text) TO %I',runtime_role);
 END IF;
END $acl$;

REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_outcome_consent_basis(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_numeric_metric(JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_categorical_metric(JSONB,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_basis(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_projection(public.canonical_external_business_calibration_proposals) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_hidden_projection(public.canonical_external_business_calibration_proposals) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_consent_projection(public.canonical_external_business_calibration_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_metric_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_metrics_valid(TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_consent_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_calibration_proposal_guard() FROM PUBLIC;
