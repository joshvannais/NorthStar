-- Mission 25 Part 9D: tenant-private multi-job imported travel calibration proposals.
-- Robust summaries remain advisory and never mutate estimates, plans, rates, schedules or policy.

CREATE TABLE public.canonical_external_travel_calibration_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 purpose TEXT NOT NULL CHECK(purpose='imported_travel_calibration_v1'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 outcome_consent_id UUID NOT NULL,
 outcome_consent_revision BIGINT NOT NULL CHECK(outcome_consent_revision BETWEEN 1 AND 10000),
 outcome_consent_digest CHAR(64) NOT NULL CHECK(outcome_consent_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["canonical_external_travel_outcome_observations"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-imported-travel-calibration-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,purpose,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_travel_calibration_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,outcome_consent_id)
  REFERENCES public.canonical_external_travel_import_learning_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE FUNCTION public.canonical_imported_travel_calibration_metric_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_field_evidence_object_keys_exact(value,ARRAY['status','label','unit','sampleSize',
  'medianActualToPlannedRatio','lowerQuartileRatio','upperQuartileRatio','proposedMultiplier','advisoryCode',
  'advisoryMessage','unavailableReason']) AND value->>'status' IN ('compared','unavailable')
  AND jsonb_typeof(value->'label')='string' AND public.canonical_learning_text_valid(value->>'label',100)
  AND jsonb_typeof(value->'sampleSize')='number' AND (value->>'sampleSize')~'^(0|[1-9][0-9]{0,2})$'
  AND (value->>'sampleSize')::integer BETWEEN 0 AND 100
  AND CASE WHEN value->>'status'='compared' THEN
   (value->>'sampleSize')::integer BETWEEN 5 AND 100 AND jsonb_typeof(value->'unit')='string'
   AND value->>'unit'~'^[A-Za-z][A-Za-z0-9._-]{0,15}$'
   AND jsonb_typeof(value->'medianActualToPlannedRatio')='string'
   AND value->>'medianActualToPlannedRatio'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
   AND jsonb_typeof(value->'lowerQuartileRatio')='string'
   AND value->>'lowerQuartileRatio'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
   AND jsonb_typeof(value->'upperQuartileRatio')='string'
   AND value->>'upperQuartileRatio'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
   AND jsonb_typeof(value->'proposedMultiplier')='string'
   AND value->>'proposedMultiplier'=value->>'medianActualToPlannedRatio'
   AND (value->>'upperQuartileRatio')::numeric >= (value->>'lowerQuartileRatio')::numeric
   AND value->>'advisoryCode' IN ('keep_current_assumption','increase_planned_amount','decrease_planned_amount')
   AND jsonb_typeof(value->'advisoryMessage')='string'
   AND public.canonical_learning_text_valid(value->>'advisoryMessage',1000)
   AND value->'unavailableReason'='null'::jsonb
   AND value->>'advisoryCode'=CASE WHEN (value->>'medianActualToPlannedRatio')::numeric BETWEEN 0.95 AND 1.05
    THEN 'keep_current_assumption' WHEN (value->>'medianActualToPlannedRatio')::numeric>1.05
    THEN 'increase_planned_amount' ELSE 'decrease_planned_amount' END
  ELSE value->'unit'='null'::jsonb AND value->'medianActualToPlannedRatio'='null'::jsonb
   AND value->'lowerQuartileRatio'='null'::jsonb AND value->'upperQuartileRatio'='null'::jsonb
   AND value->'proposedMultiplier'='null'::jsonb AND value->'advisoryCode'='null'::jsonb
   AND value->'advisoryMessage'='null'::jsonb AND jsonb_typeof(value->'unavailableReason')='string'
   AND public.canonical_learning_text_valid(value->>'unavailableReason',1000) END
$$;

CREATE FUNCTION public.canonical_imported_travel_calibration_metrics_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_field_evidence_object_keys_exact(value,ARRAY['routeDuration','distance','fuelQuantity','fuelCost'])
  AND public.canonical_imported_travel_calibration_metric_valid(value->'routeDuration')
  AND public.canonical_imported_travel_calibration_metric_valid(value->'distance')
  AND public.canonical_imported_travel_calibration_metric_valid(value->'fuelQuantity')
  AND public.canonical_imported_travel_calibration_metric_valid(value->'fuelCost')
$$;

CREATE FUNCTION public.canonical_imported_travel_calibration_eligible_count(value JSONB)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (CASE WHEN value#>>'{routeDuration,status}'='compared' THEN 1 ELSE 0 END
  + CASE WHEN value#>>'{distance,status}'='compared' THEN 1 ELSE 0 END
  + CASE WHEN value#>>'{fuelQuantity,status}'='compared' THEN 1 ELSE 0 END
  + CASE WHEN value#>>'{fuelCost,status}'='compared' THEN 1 ELSE 0 END)::integer
$$;

CREATE TABLE public.canonical_external_travel_calibration_proposals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 service_key TEXT NOT NULL CHECK(service_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 consent_id UUID NOT NULL,
 consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),
 consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 sample_manifest JSONB NOT NULL CHECK(jsonb_typeof(sample_manifest)='object' AND octet_length(sample_manifest::text)<=1048576),
 sample_digest CHAR(64) NOT NULL CHECK(sample_digest~'^[0-9a-f]{64}$'),
 sample_size INTEGER NOT NULL CHECK(sample_size BETWEEN 5 AND 100),
 stale_excluded_count INTEGER NOT NULL CHECK(stale_excluded_count BETWEEN 0 AND 1000000),
 metrics JSONB NOT NULL CHECK(jsonb_typeof(metrics)='object'),
 eligible_metric_count INTEGER NOT NULL CHECK(eligible_metric_count BETWEEN 1 AND 4),
 evidence_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(evidence_boundary,1500)),
 adoption_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(adoption_boundary,1000)),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-imported-travel-calibration-proposal-v1'),
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-imported-travel-median-calibration-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,service_key,revision),
 UNIQUE(organization_id,source_key,service_key,sample_digest,consent_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_travel_calibration_proposals(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,consent_id)
  REFERENCES public.canonical_external_travel_calibration_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(rtrim(sample_digest)=public.canonical_completion_digest(sample_manifest)),
 CHECK(public.canonical_imported_travel_calibration_metrics_valid(metrics)),
 CHECK(eligible_metric_count=public.canonical_imported_travel_calibration_eligible_count(metrics))
);

CREATE TRIGGER canonical_external_travel_calibration_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_travel_calibration_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_travel_calibration_proposals_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_travel_calibration_proposals FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_imported_travel_calibration_consent_projection(
 value public.canonical_external_travel_calibration_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'purpose',value.purpose,'revision',value.revision,
  'previousId',value.previous_id,'action',value.action,'outcomeConsent',jsonb_build_object('id',value.outcome_consent_id,
   'revision',value.outcome_consent_revision,'digest',rtrim(value.outcome_consent_digest)),
  'sourceScope',value.source_scope,'consentVersion',value.consent_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_imported_travel_calibration_consent_read(org UUID,actor UUID,role_value TEXT,
 session_value UUID,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_travel_import_consents%ROWTYPE;
 outcome_consent public.canonical_external_travel_import_learning_consents%ROWTYPE;
 current_row public.canonical_external_travel_calibration_consents%ROWTYPE; history JSONB; total BIGINT; active_value BOOLEAN;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported calibration review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External travel source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO outcome_consent FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO current_row FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_calibration_v1' ORDER BY revision DESC LIMIT 1;
 active_value:=source_consent.id IS NOT NULL AND source_consent.action='grant' AND outcome_consent.id IS NOT NULL
  AND outcome_consent.action='grant' AND outcome_consent.source_consent_id=source_consent.id
  AND rtrim(outcome_consent.source_consent_digest)=rtrim(source_consent.canonical_digest) AND current_row.id IS NOT NULL
  AND current_row.action='grant' AND current_row.outcome_consent_id=outcome_consent.id
  AND rtrim(current_row.outcome_consent_digest)=rtrim(outcome_consent.canonical_digest);
 SELECT count(*) INTO total FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_calibration_v1';
 SELECT COALESCE(jsonb_agg(public.canonical_imported_travel_calibration_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
   AND source_key=source_value AND purpose='imported_travel_calibration_v1' ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'active',active_value,'current',CASE WHEN current_row.id IS NULL THEN NULL
  ELSE public.canonical_imported_travel_calibration_consent_projection(current_row) END,'history',history,'total',total,
  'truncated',total>20,'blockedReason',CASE WHEN active_value THEN NULL WHEN outcome_consent.id IS NULL OR outcome_consent.action<>'grant'
   THEN 'Imported travel outcome consent is not active.' WHEN current_row.id IS NOT NULL AND current_row.action='grant'
   THEN 'Calibration consent must be renewed for the current outcome consent.' ELSE 'Imported travel calibration consent is not active.' END);
END $$;

CREATE FUNCTION public.canonical_imported_travel_calibration_consent_mutate(org UUID,actor UUID,role_value TEXT,
 session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_consent public.canonical_external_travel_import_consents%ROWTYPE;
 outcome_consent public.canonical_external_travel_import_learning_consents%ROWTYPE;
 current_row public.canonical_external_travel_calibration_consents%ROWTYPE;
 replay_row public.canonical_external_travel_calibration_consents%ROWTYPE;
 inserted public.canonical_external_travel_calibration_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT; currently_active BOOLEAN;
 scope_value JSONB:='["canonical_external_travel_outcome_observations"]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported calibration review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string'
  OR (body->>'expectedDigest' IS DISTINCT FROM 'none' AND body->>'expectedDigest'!~'^[0-9a-f]{64}$')
  OR (((body->>'expectedRevision')::bigint=0) IS DISTINCT FROM (body->>'expectedDigest'='none'))
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-imported-travel-calibration-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Imported calibration consent input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-travel-calibration-consent:'||source_value,0));
 SELECT * INTO replay_row FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported calibration consent key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('consent',public.canonical_imported_travel_calibration_consent_projection(replay_row),'replayed',TRUE);
 END IF;
 SELECT * INTO outcome_consent FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO current_row FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_calibration_v1' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Imported travel calibration consent changed' USING ERRCODE='40001',CONSTRAINT='imported_travel_calibration_consent_stale'; END IF;
 currently_active:=current_row.id IS NOT NULL AND current_row.action='grant' AND outcome_consent.id IS NOT NULL
  AND outcome_consent.action='grant' AND current_row.outcome_consent_id=outcome_consent.id
  AND rtrim(current_row.outcome_consent_digest)=rtrim(outcome_consent.canonical_digest);
 IF body->>'action'='grant' AND (source_consent.id IS NULL OR source_consent.action<>'grant'
  OR outcome_consent.id IS NULL OR outcome_consent.action<>'grant' OR outcome_consent.source_consent_id<>source_consent.id
  OR rtrim(outcome_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)) THEN
  RAISE EXCEPTION 'Imported travel outcome consent inactive' USING ERRCODE='40001',CONSTRAINT='imported_travel_calibration_outcome_consent_stale'; END IF;
 IF body->>'action'='grant' AND currently_active THEN RAISE EXCEPTION 'Imported calibration consent is already active' USING ERRCODE='22023'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN
  RAISE EXCEPTION 'No imported calibration consent' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'purpose','imported_travel_calibration_v1','revision',next_revision,'previousId',current_row.id,
  'action',body->>'action','outcomeConsentId',outcome_consent.id,'outcomeConsentRevision',outcome_consent.revision,
  'outcomeConsentDigest',rtrim(outcome_consent.canonical_digest),'actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,
  'consentVersion','m25-imported-travel-calibration-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_travel_calibration_consents(organization_id,source_key,purpose,revision,previous_id,
  action,outcome_consent_id,outcome_consent_revision,outcome_consent_digest,actor_user_id,membership_id,auth_session_id,
  source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,'imported_travel_calibration_v1',next_revision,current_row.id,body->>'action',
  outcome_consent.id,outcome_consent.revision,rtrim(outcome_consent.canonical_digest),actor,(authority->>'membershipId')::uuid,
  session_value,scope_value,'m25-imported-travel-calibration-consent-v1',body->>'reason',key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_imported_travel_calibration_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_imported_travel_calibration_metric(observations JSONB,metric_key TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE label_value TEXT;sample_count INTEGER;unit_count INTEGER;unit_value TEXT;
 median_value NUMERIC;lower_value NUMERIC;upper_value NUMERIC;code_value TEXT;message_value TEXT;
BEGIN
 IF metric_key NOT IN ('routeDuration','distance','fuelQuantity','fuelCost') OR jsonb_typeof(observations)<>'array' THEN
  RAISE EXCEPTION 'Travel calibration metric input invalid' USING ERRCODE='22023'; END IF;
 label_value:=CASE metric_key WHEN 'routeDuration' THEN 'Route duration' WHEN 'distance' THEN 'Driving distance'
  WHEN 'fuelQuantity' THEN 'Fuel or energy quantity' ELSE 'Fuel cost' END;
 WITH eligible AS (SELECT item#>>ARRAY['metrics',metric_key,'unit'] unit,
   (item#>>ARRAY['metrics',metric_key,'actual'])::numeric/(item#>>ARRAY['metrics',metric_key,'planned'])::numeric ratio
  FROM jsonb_array_elements(observations)item WHERE item#>>ARRAY['metrics',metric_key,'status']='compared'
   AND (item#>>ARRAY['metrics',metric_key,'planned'])::numeric>0
   AND (item#>>ARRAY['metrics',metric_key,'actual'])::numeric>=0)
 SELECT count(*)::integer,count(DISTINCT unit)::integer,min(unit),
  round(percentile_cont(0.5) WITHIN GROUP(ORDER BY ratio)::numeric,4),
  round(percentile_cont(0.25) WITHIN GROUP(ORDER BY ratio)::numeric,4),
  round(percentile_cont(0.75) WITHIN GROUP(ORDER BY ratio)::numeric,4)
 INTO sample_count,unit_count,unit_value,median_value,lower_value,upper_value FROM eligible;
 IF sample_count<5 THEN RETURN jsonb_build_object('status','unavailable','label',label_value,'unit',NULL,
  'sampleSize',sample_count,'medianActualToPlannedRatio',NULL,'lowerQuartileRatio',NULL,'upperQuartileRatio',NULL,
  'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL,
  'unavailableReason','At least five current outcomes with this comparable dimension are required.'); END IF;
 IF unit_count<>1 THEN RETURN jsonb_build_object('status','unavailable','label',label_value,'unit',NULL,
  'sampleSize',sample_count,'medianActualToPlannedRatio',NULL,'lowerQuartileRatio',NULL,'upperQuartileRatio',NULL,
  'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL,
  'unavailableReason','Current outcomes use incompatible units or currencies for this dimension.'); END IF;
 code_value:=CASE WHEN median_value BETWEEN 0.95 AND 1.05 THEN 'keep_current_assumption'
  WHEN median_value>1.05 THEN 'increase_planned_amount' ELSE 'decrease_planned_amount' END;
 message_value:=CASE code_value WHEN 'keep_current_assumption' THEN 'The median actual-to-planned ratio is within 5% of the current assumption.'
  WHEN 'increase_planned_amount' THEN 'The median actual amount is higher than the adopted plans in this reviewed sample.'
  ELSE 'The median actual amount is lower than the adopted plans in this reviewed sample.' END;
 RETURN jsonb_build_object('status','compared','label',label_value,'unit',unit_value,'sampleSize',sample_count,
  'medianActualToPlannedRatio',median_value::text,'lowerQuartileRatio',lower_value::text,
  'upperQuartileRatio',upper_value::text,'proposedMultiplier',median_value::text,'advisoryCode',code_value,
  'advisoryMessage',message_value,'unavailableReason',NULL);
END $$;

CREATE FUNCTION public.canonical_imported_travel_calibration_basis(org UUID,source_value TEXT,service_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_travel_import_consents%ROWTYPE;
 outcome_consent public.canonical_external_travel_import_learning_consents%ROWTYPE;
 item RECORD;live_basis JSONB;observations JSONB:='[]'::jsonb;candidate_total INTEGER:=0;fresh_total INTEGER:=0;
 metrics_value JSONB;eligible_count INTEGER;manifest JSONB;digest_value TEXT;
BEGIN
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR service_value IS NULL
  OR service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'Imported travel calibration identity invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO outcome_consent FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR outcome_consent.id IS NULL OR outcome_consent.action<>'grant'
  OR outcome_consent.source_consent_id<>source_consent.id
  OR rtrim(outcome_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest) THEN
  RAISE EXCEPTION 'Current imported travel outcome consent is required'
   USING ERRCODE='P0002',CONSTRAINT='imported_travel_calibration_outcome_consent_unavailable'; END IF;
 WITH current_observations AS (SELECT DISTINCT ON(estimate_id,external_job_reference) observation.*
  FROM public.canonical_external_travel_outcome_observations observation
  WHERE observation.organization_id=org AND observation.source_key=source_value
  ORDER BY estimate_id,external_job_reference,revision DESC,id DESC)
 SELECT count(*) INTO candidate_total FROM current_observations observation
 JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=observation.estimate_id
 JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
 WHERE lower(btrim(opportunity.service_type))=service_value;
 IF candidate_total>10000 THEN RAISE EXCEPTION 'Imported travel calibration candidate set is too broad for bounded review'
  USING ERRCODE='P0002',CONSTRAINT='imported_travel_calibration_sample_scope_too_broad'; END IF;
 FOR item IN WITH current_observations AS (SELECT DISTINCT ON(estimate_id,external_job_reference) observation.*
   FROM public.canonical_external_travel_outcome_observations observation
   WHERE observation.organization_id=org AND observation.source_key=source_value
   ORDER BY estimate_id,external_job_reference,revision DESC,id DESC)
  SELECT observation.* FROM current_observations observation
  JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=observation.estimate_id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
  WHERE lower(btrim(opportunity.service_type))=service_value
  ORDER BY observation.estimate_id,observation.external_job_reference,observation.revision DESC,observation.id DESC
 LOOP
  BEGIN live_basis:=public.canonical_imported_travel_learning_basis(org,source_value,item.estimate_id,item.external_job_reference);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN CONTINUE; END;
  IF rtrim(item.source_digest)<>live_basis->>'sourceDigest' OR item.consent_id<>outcome_consent.id THEN CONTINUE; END IF;
  fresh_total:=fresh_total+1;
  IF fresh_total<=100 THEN observations:=observations||jsonb_build_array(jsonb_build_object('observationId',item.id,
   'estimateId',item.estimate_id,'externalJobReference',item.external_job_reference,'revision',item.revision,
   'digest',rtrim(item.canonical_digest),'sourceDigest',rtrim(item.source_digest),'metrics',item.metrics)); END IF;
 END LOOP;
 IF fresh_total<5 THEN RAISE EXCEPTION 'At least five current imported travel outcomes are required'
  USING ERRCODE='P0002',CONSTRAINT='imported_travel_calibration_sample_insufficient'; END IF;
 metrics_value:=jsonb_build_object('routeDuration',public.canonical_imported_travel_calibration_metric(observations,'routeDuration'),
  'distance',public.canonical_imported_travel_calibration_metric(observations,'distance'),
  'fuelQuantity',public.canonical_imported_travel_calibration_metric(observations,'fuelQuantity'),
  'fuelCost',public.canonical_imported_travel_calibration_metric(observations,'fuelCost'));
 eligible_count:=public.canonical_imported_travel_calibration_eligible_count(metrics_value);
 IF eligible_count=0 THEN RAISE EXCEPTION 'At least one travel dimension needs five comparable current outcomes'
  USING ERRCODE='P0002',CONSTRAINT='imported_travel_calibration_dimension_sample_insufficient'; END IF;
 manifest:=jsonb_build_object('sourceKey',source_value,'serviceKey',service_value,
  'sourceConsent',jsonb_build_object('id',source_consent.id,'revision',source_consent.revision,'digest',rtrim(source_consent.canonical_digest)),
  'outcomeConsent',jsonb_build_object('id',outcome_consent.id,'revision',outcome_consent.revision,'digest',rtrim(outcome_consent.canonical_digest)),
  'observations',observations);
 digest_value:=public.canonical_completion_digest(manifest);
 RETURN jsonb_build_object('sampleManifest',manifest,'sampleDigest',digest_value,'sampleSize',jsonb_array_length(observations),
  'staleExcludedCount',candidate_total-fresh_total,'metrics',metrics_value,'eligibleMetricCount',eligible_count,
  'evidenceBoundary','Each dimension uses the median and quartiles of five to 100 current reviewed same-service outcomes with one exact unit or currency. Unavailable and incompatible dimensions are excluded, not estimated.',
  'adoptionBoundary','Review the cited jobs before changing future travel assumptions. No estimate, route, schedule, reimbursement, payroll record, asset, price or business policy was changed.');
END $$;

CREATE FUNCTION public.canonical_imported_travel_calibration_masked_metrics(value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('routeDuration',(value->'routeDuration')||jsonb_build_object('proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL),
  'distance',(value->'distance')||jsonb_build_object('proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL),
  'fuelQuantity',(value->'fuelQuantity')||jsonb_build_object('proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL),
  'fuelCost',(value->'fuelCost')||jsonb_build_object('proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL))
$$;

CREATE FUNCTION public.canonical_imported_travel_calibration_projection(value public.canonical_external_travel_calibration_proposals)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'serviceKey',value.service_key,
  'revision',value.revision,'previousId',value.previous_id,'consent',jsonb_build_object('id',value.consent_id,
   'revision',value.consent_revision,'digest',rtrim(value.consent_digest)),'sampleManifest',value.sample_manifest,
  'sampleDigest',rtrim(value.sample_digest),'sampleSize',value.sample_size,'staleExcludedCount',value.stale_excluded_count,
  'metrics',value.metrics,'eligibleMetricCount',value.eligible_metric_count,'evidenceBoundary',value.evidence_boundary,
  'adoptionBoundary',value.adoption_boundary,'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,
  'calculationVersion',value.calculation_version,'reason',value.reason,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_imported_travel_calibration_propose(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,source_value TEXT,service_value TEXT,expected_consent_revision BIGINT,
 expected_consent_digest TEXT,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_external_travel_calibration_consents%ROWTYPE;
 source_consent public.canonical_external_travel_import_consents%ROWTYPE;
 outcome_consent public.canonical_external_travel_import_learning_consents%ROWTYPE;
 current_row public.canonical_external_travel_calibration_proposals%ROWTYPE;
 replay_row public.canonical_external_travel_calibration_proposals%ROWTYPE;
 inserted public.canonical_external_travel_calibration_proposals%ROWTYPE;
 basis JSONB; next_revision BIGINT; key_hash TEXT; request_hash TEXT; digest_value TEXT; replay_fresh BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported calibration review is restricted' USING ERRCODE='42501'; END IF;
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR service_value IS NULL
  OR service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR expected_consent_revision IS NULL OR expected_consent_revision NOT BETWEEN 1 AND 10000
  OR expected_consent_digest IS NULL OR expected_consent_digest!~'^[0-9a-f]{64}$'
  OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE
  OR confirmation_version_value IS DISTINCT FROM 'm25-imported-travel-calibration-proposal-v1' THEN
  RAISE EXCEPTION 'Imported calibration proposal input invalid' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-travel-calibration:'||source_value||':'||service_value,0));
 SELECT * INTO consent_row FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_calibration_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO outcome_consent FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant'
  OR outcome_consent.id IS NULL OR outcome_consent.action<>'grant'
  OR outcome_consent.source_consent_id<>source_consent.id
  OR rtrim(outcome_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR consent_row.outcome_consent_id<>outcome_consent.id
  OR rtrim(consent_row.outcome_consent_digest)<>rtrim(outcome_consent.canonical_digest)
  OR consent_row.revision<>expected_consent_revision
  OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM expected_consent_digest THEN
  RAISE EXCEPTION 'Active imported travel calibration consent changed' USING ERRCODE='40001',CONSTRAINT='imported_travel_calibration_consent_stale'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
   'sourceKey',source_value,'serviceKey',service_value,'consentRevision',expected_consent_revision,
   'consentDigest',expected_consent_digest,'reason',reason_value,'confirmed',confirmed_value,
   'confirmationVersion',confirmation_version_value));
 SELECT * INTO replay_row FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
   AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
   IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported calibration key conflict' USING ERRCODE='23505'; END IF;
   BEGIN basis:=public.canonical_imported_travel_calibration_basis(org,source_value,service_value);
    replay_fresh:=rtrim(replay_row.sample_digest)=basis->>'sampleDigest' AND replay_row.consent_id=consent_row.id;
   EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;replay_fresh:=FALSE; END;
   RETURN jsonb_build_object('proposal',public.canonical_imported_travel_calibration_projection(replay_row)||jsonb_build_object(
     'fresh',replay_fresh,'advisoryAvailable',replay_fresh,
     'metrics',CASE WHEN replay_fresh THEN replay_row.metrics
      ELSE public.canonical_imported_travel_calibration_masked_metrics(replay_row.metrics) END),
    'replayed',TRUE);
 END IF;
 basis:=public.canonical_imported_travel_calibration_basis(org,source_value,service_value);
 SELECT * INTO replay_row FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value AND sample_digest=(basis->>'sampleDigest')::char(64)
  AND consent_id=consent_row.id;
 IF FOUND THEN RAISE EXCEPTION 'The current imported travel calibration was already proposed'
  USING ERRCODE='22023',CONSTRAINT='imported_travel_calibration_already_current'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'serviceKey',service_value,'revision',next_revision,'previousId',current_row.id,'consentId',consent_row.id,
  'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),
   'sampleDigest',basis->>'sampleDigest','sampleSize',basis->>'sampleSize','staleExcludedCount',basis->>'staleExcludedCount',
   'metrics',basis->'metrics','eligibleMetricCount',basis->>'eligibleMetricCount','actorUserId',actor,'confirmed',confirmed_value,
  'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_travel_calibration_proposals(organization_id,source_key,service_key,revision,
  previous_id,consent_id,consent_revision,consent_digest,sample_manifest,sample_digest,sample_size,stale_excluded_count,
  metrics,eligible_metric_count,evidence_boundary,adoption_boundary,actor_user_id,membership_id,auth_session_id,
  reason,confirmed,confirmation_version,calculation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,service_value,next_revision,current_row.id,consent_row.id,consent_row.revision,
  rtrim(consent_row.canonical_digest),basis->'sampleManifest',basis->>'sampleDigest',(basis->>'sampleSize')::integer,
  (basis->>'staleExcludedCount')::integer,basis->'metrics',(basis->>'eligibleMetricCount')::integer,
  basis->>'evidenceBoundary',basis->>'adoptionBoundary',actor,(authority->>'membershipId')::uuid,session_value,
  reason_value,confirmed_value,confirmation_version_value,'m25-imported-travel-median-calibration-v1',
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('proposal',public.canonical_imported_travel_calibration_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_imported_travel_calibration_read(org UUID,actor UUID,role_value TEXT,session_value UUID,
 source_value TEXT,service_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_travel_calibration_consents%ROWTYPE;
 source_consent public.canonical_external_travel_import_consents%ROWTYPE;
 outcome_consent public.canonical_external_travel_import_learning_consents%ROWTYPE;
 current_row public.canonical_external_travel_calibration_proposals%ROWTYPE; basis JSONB; fresh BOOLEAN;
 history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported calibration review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR service_value IS NULL
  OR service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'Imported calibration identity invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO consent_row FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_calibration_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO outcome_consent FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant'
  OR outcome_consent.id IS NULL OR outcome_consent.action<>'grant'
  OR outcome_consent.source_consent_id<>source_consent.id
  OR rtrim(outcome_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR consent_row.outcome_consent_id<>outcome_consent.id
  OR rtrim(consent_row.outcome_consent_digest)<>rtrim(outcome_consent.canonical_digest) THEN
  RETURN jsonb_build_object('sourceKey',source_value,
  'serviceKey',service_value,'activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,
  'blockedReason','Current imported travel calibration consent is required.'); END IF;
 SELECT * INTO current_row FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('sourceKey',source_value,'serviceKey',service_value,'activeConsent',TRUE,
  'consent',public.canonical_imported_travel_calibration_consent_projection(consent_row),'current',NULL,'history','[]'::jsonb,
  'total',0,'truncated',FALSE,'refreshRequired',TRUE); END IF;
 BEGIN basis:=public.canonical_imported_travel_calibration_basis(org,source_value,service_value);
  fresh:=rtrim(current_row.sample_digest)=basis->>'sampleDigest' AND current_row.consent_id=consent_row.id;
 EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;fresh:=FALSE; END;
 SELECT count(*) INTO total FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value;
 SELECT COALESCE(jsonb_agg(public.canonical_imported_travel_calibration_projection(item)||jsonb_build_object(
  'fresh',rtrim(item.sample_digest)=COALESCE(basis->>'sampleDigest','') AND item.consent_id=consent_row.id,
  'advisoryAvailable',rtrim(item.sample_digest)=COALESCE(basis->>'sampleDigest','') AND item.consent_id=consent_row.id,
  'metrics',CASE WHEN rtrim(item.sample_digest)=COALESCE(basis->>'sampleDigest','') AND item.consent_id=consent_row.id
   THEN item.metrics ELSE public.canonical_imported_travel_calibration_masked_metrics(item.metrics) END)
  ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value ORDER BY created_at DESC,id DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'serviceKey',service_value,'activeConsent',TRUE,
  'consent',public.canonical_imported_travel_calibration_consent_projection(consent_row),
  'current',public.canonical_imported_travel_calibration_projection(current_row)||jsonb_build_object('fresh',fresh,
   'advisoryAvailable',fresh,'metrics',CASE WHEN fresh THEN current_row.metrics
    ELSE public.canonical_imported_travel_calibration_masked_metrics(current_row.metrics) END),
  'history',history,'total',total,'truncated',total>20,'refreshRequired',NOT fresh);
END $$;

REVOKE ALL ON TABLE public.canonical_external_travel_calibration_consents,
 public.canonical_external_travel_calibration_proposals FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_metric_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_metrics_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_eligible_count(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_consent_projection(public.canonical_external_travel_calibration_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_metric(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_basis(UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_masked_metrics(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_projection(public.canonical_external_travel_calibration_proposals) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_consent_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_propose(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_calibration_read(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
