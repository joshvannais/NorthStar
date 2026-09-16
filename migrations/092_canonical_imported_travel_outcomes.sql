-- Mission 25 Part 9C: tenant-private imported travel outcome observations.
-- Commensurate dimensions are compared independently. Missing or incompatible evidence remains unavailable.

CREATE FUNCTION public.canonical_imported_travel_metric_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE planned NUMERIC;actual NUMERIC;variance NUMERIC;pct NUMERIC;
BEGIN
 IF jsonb_typeof(v)<>'object' OR COALESCE(v->>'status','') NOT IN ('compared','unavailable') THEN RETURN FALSE;END IF;
 IF v->>'status'='unavailable' THEN RETURN public.canonical_field_evidence_object_keys_exact(v,ARRAY['status','unit','planned','actual','variance','variancePercent','advisoryCode','advisoryMessage','unavailableReason']) AND v->'unit'='null'::jsonb AND v->'planned'='null'::jsonb AND v->'actual'='null'::jsonb AND v->'variance'='null'::jsonb AND v->'variancePercent'='null'::jsonb AND v->'advisoryCode'='null'::jsonb AND v->'advisoryMessage'='null'::jsonb AND public.canonical_learning_text_valid(v->>'unavailableReason',500);END IF;
 IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['status','unit','planned','actual','variance','variancePercent','advisoryCode','advisoryMessage','unavailableReason']) IS NOT TRUE OR v->'unavailableReason'<>'null'::jsonb OR COALESCE(v->>'unit','') NOT IN ('vehicle_min','mi','us_gal','kwh','USD','CAD','EUR') OR COALESCE(v->>'advisoryCode','') NOT IN ('within_expected_range','actual_above_plan','actual_below_plan') OR public.canonical_learning_text_valid(v->>'advisoryMessage',500) IS NOT TRUE THEN RETURN FALSE;END IF;
 BEGIN planned:=(v->>'planned')::numeric;actual:=(v->>'actual')::numeric;variance:=(v->>'variance')::numeric;pct:=(v->>'variancePercent')::numeric;EXCEPTION WHEN others THEN RETURN FALSE;END;
 RETURN planned>0 AND actual>=0 AND variance=round(actual-planned,6) AND pct=round((variance/planned)*100,2) AND v->>'advisoryCode'=CASE WHEN abs(pct)<=5 THEN 'within_expected_range' WHEN pct>0 THEN 'actual_above_plan' ELSE 'actual_below_plan' END;
END $$;
CREATE FUNCTION public.canonical_imported_travel_metrics_valid(v JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT public.canonical_field_evidence_object_keys_exact(v,ARRAY['routeDuration','distance','fuelQuantity','fuelCost']) AND public.canonical_imported_travel_metric_valid(v->'routeDuration') AND public.canonical_imported_travel_metric_valid(v->'distance') AND public.canonical_imported_travel_metric_valid(v->'fuelQuantity') AND public.canonical_imported_travel_metric_valid(v->'fuelCost') $$;
CREATE TABLE public.canonical_external_travel_import_learning_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 purpose TEXT NOT NULL CHECK(purpose='imported_travel_variance_v1'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 source_consent_id UUID NOT NULL,
 source_consent_revision BIGINT NOT NULL CHECK(source_consent_revision BETWEEN 1 AND 10000),
 source_consent_digest CHAR(64) NOT NULL CHECK(source_consent_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["canonical_estimates","canonical_estimate_revisions","canonical_external_travel_import_records","canonical_external_travel_reference_matches","canonical_travel_plans"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-imported-travel-variance-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,purpose,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_travel_import_learning_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,source_consent_id)
  REFERENCES public.canonical_external_travel_import_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_imported_travel_learning_consent_projection(
 value public.canonical_external_travel_import_learning_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'purpose',value.purpose,'revision',value.revision,
  'previousId',value.previous_id,'action',value.action,'sourceConsent',jsonb_build_object('id',value.source_consent_id,
   'revision',value.source_consent_revision,'digest',rtrim(value.source_consent_digest)),
  'sourceScope',value.source_scope,'consentVersion',value.consent_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_imported_travel_learning_consent_read(org UUID,actor UUID,role_value TEXT,
 session_value UUID,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_travel_import_consents%ROWTYPE;
 current_row public.canonical_external_travel_import_learning_consents%ROWTYPE; history JSONB; total BIGINT; active_value BOOLEAN;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported travel learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External travel source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO current_row FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1;
 active_value:=source_consent.id IS NOT NULL AND source_consent.action='grant' AND current_row.id IS NOT NULL
  AND current_row.action='grant' AND current_row.source_consent_id=source_consent.id
  AND rtrim(current_row.source_consent_digest)=rtrim(source_consent.canonical_digest);
 SELECT count(*) INTO total FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1';
 SELECT COALESCE(jsonb_agg(public.canonical_imported_travel_learning_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
   AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'active',active_value,'current',CASE WHEN current_row.id IS NULL THEN NULL
  ELSE public.canonical_imported_travel_learning_consent_projection(current_row) END,'history',history,'total',total,
  'truncated',total>20,'blockedReason',CASE WHEN active_value THEN NULL WHEN source_consent.id IS NULL OR source_consent.action<>'grant'
   THEN 'External travel source consent is not active.' WHEN current_row.id IS NOT NULL AND current_row.action='grant'
   THEN 'Imported travel learning consent must be renewed for the current source consent.' ELSE 'Imported travel learning consent is not active.' END);
END $$;

CREATE FUNCTION public.canonical_imported_travel_learning_consent_mutate(org UUID,actor UUID,role_value TEXT,
 session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_consent public.canonical_external_travel_import_consents%ROWTYPE;
 current_row public.canonical_external_travel_import_learning_consents%ROWTYPE;
 replay_row public.canonical_external_travel_import_learning_consents%ROWTYPE;
 inserted public.canonical_external_travel_import_learning_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT; currently_active BOOLEAN;
 scope_value JSONB:='["canonical_estimates","canonical_estimate_revisions","canonical_external_travel_import_records","canonical_external_travel_reference_matches","canonical_travel_plans"]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported travel learning review is restricted' USING ERRCODE='42501'; END IF;
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
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-imported-travel-variance-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Imported travel learning consent input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-travel-learning-consent:'||source_value,0));
 SELECT * INTO replay_row FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported travel learning consent key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('consent',public.canonical_imported_travel_learning_consent_projection(replay_row),'replayed',TRUE);
 END IF;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF source_consent.id IS NULL THEN RAISE EXCEPTION 'External travel source consent unavailable' USING ERRCODE='40001',CONSTRAINT='imported_learning_source_consent_stale'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Imported travel learning consent changed' USING ERRCODE='40001',CONSTRAINT='imported_learning_consent_stale'; END IF;
 currently_active:=current_row.id IS NOT NULL AND current_row.action='grant' AND source_consent.action='grant'
  AND current_row.source_consent_id=source_consent.id AND rtrim(current_row.source_consent_digest)=rtrim(source_consent.canonical_digest);
 IF body->>'action'='grant' AND source_consent.action<>'grant' THEN
  RAISE EXCEPTION 'External travel source consent inactive' USING ERRCODE='40001',CONSTRAINT='imported_learning_source_consent_stale'; END IF;
 IF body->>'action'='grant' AND currently_active THEN RAISE EXCEPTION 'Imported travel learning consent is already active' USING ERRCODE='22023'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN
  RAISE EXCEPTION 'No imported learning consent' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'purpose','imported_travel_variance_v1','revision',next_revision,'previousId',current_row.id,
  'action',body->>'action','sourceConsentId',source_consent.id,'sourceConsentRevision',source_consent.revision,
  'sourceConsentDigest',rtrim(source_consent.canonical_digest),'actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,
  'consentVersion','m25-imported-travel-variance-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_travel_import_learning_consents(organization_id,source_key,purpose,revision,
  previous_id,action,source_consent_id,source_consent_revision,source_consent_digest,actor_user_id,membership_id,
  auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,'imported_travel_variance_v1',next_revision,current_row.id,body->>'action',
  source_consent.id,source_consent.revision,rtrim(source_consent.canonical_digest),actor,(authority->>'membershipId')::uuid,
  session_value,scope_value,'m25-imported-travel-variance-consent-v1',body->>'reason',key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_imported_travel_learning_consent_projection(inserted),'replayed',FALSE);
END $$;
CREATE TABLE public.canonical_external_travel_outcome_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), estimate_id UUID NOT NULL,
 external_job_reference TEXT NOT NULL CHECK(char_length(external_job_reference) BETWEEN 1 AND 128 AND external_job_reference~'^[!-~]+$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID, consent_id UUID NOT NULL,
 consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000), consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='object' AND octet_length(source_manifest::text)<=1048576),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'), metrics JSONB NOT NULL CHECK(jsonb_typeof(metrics)='object'),
 scope_note TEXT NOT NULL CHECK(public.canonical_learning_text_valid(scope_note,1000)), adoption_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(adoption_boundary,1000)),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL, reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed), confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-imported-travel-variance-observation-v1'),
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-imported-travel-variance-v1'), request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'), canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,estimate_id,external_job_reference,revision), UNIQUE(organization_id,source_key,estimate_id,external_job_reference,source_digest,consent_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,previous_id) REFERENCES public.canonical_external_travel_outcome_observations(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,consent_id) REFERENCES public.canonical_external_travel_import_learning_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(public.canonical_field_evidence_object_keys_exact(source_manifest,ARRAY['estimate','estimateRevision','travelPlan','sourceConsent','jobMatch','vehicleMatches','importedRecords'])),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(source_manifest)), CHECK(public.canonical_imported_travel_metrics_valid(metrics))
);

CREATE TRIGGER canonical_external_travel_learning_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_travel_import_learning_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_travel_outcomes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_travel_outcome_observations FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_imported_travel_metric(planned NUMERIC,actual NUMERIC,unit_value TEXT,label_value TEXT,unavailable_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE variance NUMERIC;pct NUMERIC;code TEXT;message TEXT;
BEGIN
 IF unavailable_reason IS NOT NULL OR planned IS NULL OR actual IS NULL OR planned<=0 THEN
  RETURN jsonb_build_object('status','unavailable','unit',NULL,'planned',NULL,'actual',NULL,'variance',NULL,'variancePercent',NULL,'advisoryCode',NULL,'advisoryMessage',NULL,'unavailableReason',COALESCE(unavailable_reason,label_value||' cannot be compared from the current evidence.'));
 END IF;
 variance:=round(actual-planned,6);pct:=round((variance/planned)*100,2);
 code:=CASE WHEN abs(pct)<=5 THEN 'within_expected_range' WHEN pct>0 THEN 'actual_above_plan' ELSE 'actual_below_plan' END;
 message:=CASE code WHEN 'within_expected_range' THEN label_value||' was within 5% of the adopted travel plan.' WHEN 'actual_above_plan' THEN label_value||' was higher than the adopted travel plan.' ELSE label_value||' was lower than the adopted travel plan.' END;
 RETURN jsonb_build_object('status','compared','unit',unit_value,'planned',planned::text,'actual',actual::text,'variance',variance::text,'variancePercent',pct::text,'advisoryCode',code,'advisoryMessage',message,'unavailableReason',NULL);
END $$;

CREATE FUNCTION public.canonical_imported_travel_learning_basis(org UUID,source_value TEXT,estimate UUID,job_reference_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE estimate_row public.canonical_estimates%ROWTYPE;revision_row public.canonical_estimate_revisions%ROWTYPE;plan_row public.canonical_travel_plans%ROWTYPE;
 source_consent public.canonical_external_travel_import_consents%ROWTYPE;job_match public.canonical_external_travel_reference_matches%ROWTYPE;
 job_source JSONB;job_target JSONB;vehicle_matches JSONB;imported_records JSONB;record_total BIGINT;invalid_matches BIGINT;overlap_total BIGINT;
 actual_minutes NUMERIC;actual_miles NUMERIC;actual_fuel NUMERIC;actual_fuel_class TEXT;actual_cost NUMERIC;actual_currency TEXT;
 missing_distance BIGINT;missing_fuel BIGINT;missing_cost BIGINT;fuel_class_count BIGINT;currency_count BIGINT;
 planned_minutes NUMERIC:=0;planned_miles NUMERIC:=0;planned_fuel NUMERIC:=0;planned_cost NUMERIC:=0;planned_fuel_class TEXT;trip JSONB;v JSONB;
 legs NUMERIC;vehicle_legs NUMERIC;distance NUMERIC;used NUMERIC;all_distance BOOLEAN:=TRUE;all_consumption BOOLEAN:=TRUE;all_cost BOOLEAN:=TRUE;
 metrics JSONB;source_manifest JSONB;source_digest_value TEXT;vehicle_currency TEXT;current_fuel_class TEXT;
BEGIN
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR job_reference_value IS NULL OR char_length(job_reference_value) NOT BETWEEN 1 AND 128 OR job_reference_value!~'^[!-~]+$' THEN RAISE EXCEPTION 'Imported travel source identity invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO estimate_row FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;
 IF estimate_row.id IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002',CONSTRAINT='imported_travel_estimate_unavailable';END IF;
 SELECT * INTO revision_row FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF revision_row.id IS NULL OR revision_row.travel_plan_id IS NULL THEN RAISE EXCEPTION 'Adopted travel plan unavailable' USING ERRCODE='P0002',CONSTRAINT='imported_travel_plan_unavailable';END IF;
 SELECT * INTO plan_row FROM public.canonical_travel_plans WHERE organization_id=org AND estimate_id=estimate AND id=revision_row.travel_plan_id AND action='save';
 IF plan_row.id IS NULL THEN RAISE EXCEPTION 'Adopted travel plan unavailable' USING ERRCODE='P0002',CONSTRAINT='imported_travel_plan_unavailable';END IF;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' THEN RAISE EXCEPTION 'Travel source consent unavailable' USING ERRCODE='P0002',CONSTRAINT='imported_travel_source_consent_unavailable';END IF;
 SELECT * INTO job_match FROM public.canonical_external_travel_reference_matches WHERE organization_id=org AND source_key=source_value AND reference_kind='job' AND external_reference=job_reference_value ORDER BY revision DESC LIMIT 1;
 job_source:=public.canonical_external_travel_reference_source_basis(org,source_value,'job',job_reference_value);job_target:=public.canonical_external_travel_reference_target_basis(org,'job',estimate);
 IF job_match.id IS NULL OR job_match.action<>'link' OR job_match.target_id<>estimate OR job_match.consent_id<>source_consent.id OR job_source IS NULL OR job_target IS NULL OR job_match.source_digest<>job_source->>'digest' OR job_match.target_digest<>job_target->>'digest' THEN RAISE EXCEPTION 'Current reviewed job match required' USING ERRCODE='P0002',CONSTRAINT='imported_travel_job_match_unavailable';END IF;
 WITH current_records AS(SELECT DISTINCT ON(external_record_id)* FROM public.canonical_external_travel_import_records WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC), selected AS(SELECT * FROM current_records WHERE state='active' AND job_reference=job_reference_value ORDER BY external_record_id LIMIT 1001)
 SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('externalRecordId',external_record_id,'revision',revision,'externalVersion',external_version,'sourceDigest',rtrim(source_digest),'vehicleReference',vehicle_reference,'routeStartedAt',route_started_at,'routeEndedAt',route_ended_at,'distance',CASE WHEN distance_value IS NULL THEN NULL ELSE jsonb_build_object('value',distance_value,'unit',distance_unit,'basis',distance_basis) END,'fuel',CASE WHEN fuel_quantity IS NULL THEN NULL ELSE jsonb_build_object('quantity',fuel_quantity,'unit',fuel_unit,'costAmount',fuel_cost_amount,'currency',fuel_currency,'basis',fuel_basis) END) ORDER BY external_record_id),'[]'::jsonb),round(sum(extract(epoch FROM route_ended_at-route_started_at))/60,6),round(sum(CASE distance_unit WHEN 'mi' THEN distance_value WHEN 'km' THEN distance_value/1.609344 END),6),count(*) FILTER(WHERE distance_value IS NULL),count(*) FILTER(WHERE fuel_quantity IS NULL),count(*) FILTER(WHERE fuel_cost_amount IS NULL),count(DISTINCT CASE WHEN fuel_unit IN ('us_gal','litre') THEN 'liquid' ELSE fuel_unit END),count(DISTINCT fuel_currency),max(CASE WHEN fuel_unit IN ('us_gal','litre') THEN 'liquid' ELSE fuel_unit END),round(sum(CASE fuel_unit WHEN 'us_gal' THEN fuel_quantity WHEN 'litre' THEN fuel_quantity/3.785411784 WHEN 'kwh' THEN fuel_quantity END),6),round(sum(fuel_cost_amount),6),max(fuel_currency)
 INTO record_total,imported_records,actual_minutes,actual_miles,missing_distance,missing_fuel,missing_cost,fuel_class_count,currency_count,actual_fuel_class,actual_fuel,actual_cost,actual_currency FROM selected;
 IF record_total=0 OR record_total>1000 THEN RAISE EXCEPTION 'Current imported travel records unavailable' USING ERRCODE='P0002',CONSTRAINT='imported_travel_records_unavailable';END IF;
 WITH current_records AS(SELECT DISTINCT ON(external_record_id)* FROM public.canonical_external_travel_import_records WHERE organization_id=org AND source_key=source_value ORDER BY external_record_id,revision DESC),selected AS(SELECT * FROM current_records WHERE state='active' AND job_reference=job_reference_value)
 SELECT count(*) INTO overlap_total FROM selected a JOIN selected b ON a.external_record_id<b.external_record_id AND a.vehicle_reference=b.vehicle_reference AND tstzrange(a.route_started_at,a.route_ended_at,'[)')&&tstzrange(b.route_started_at,b.route_ended_at,'[)');
 IF overlap_total>0 THEN RAISE EXCEPTION 'Imported travel intervals overlap for one vehicle' USING ERRCODE='P0002',CONSTRAINT='imported_travel_records_overlap';END IF;
 WITH refs AS(SELECT DISTINCT value->>'vehicleReference' ref FROM jsonb_array_elements(imported_records)), matched AS(SELECT refs.ref,m.*,public.canonical_external_travel_reference_source_basis(org,source_value,'vehicle',refs.ref) source_basis,public.canonical_external_travel_reference_target_basis(org,'vehicle',m.target_id) target_basis FROM refs LEFT JOIN LATERAL(SELECT * FROM public.canonical_external_travel_reference_matches x WHERE x.organization_id=org AND x.source_key=source_value AND x.reference_kind='vehicle' AND x.external_reference=refs.ref ORDER BY revision DESC LIMIT 1)m ON TRUE)
 SELECT count(*) FILTER(WHERE id IS NULL OR action<>'link' OR consent_id<>source_consent.id OR source_basis IS NULL OR target_basis IS NULL OR source_digest<>source_basis->>'digest' OR target_digest<>target_basis->>'digest'),COALESCE(jsonb_agg(jsonb_build_object('id',id,'externalVehicleReference',ref,'targetId',target_id,'revision',revision,'digest',rtrim(canonical_digest),'sourceDigest',source_digest,'targetDigest',target_digest) ORDER BY ref),'[]'::jsonb) INTO invalid_matches,vehicle_matches FROM matched;
 IF invalid_matches>0 THEN RAISE EXCEPTION 'Current reviewed vehicle matches required' USING ERRCODE='P0002',CONSTRAINT='imported_travel_vehicle_match_unavailable';END IF;
 FOR trip IN SELECT value FROM jsonb_array_elements(plan_row.inputs->'trips') LOOP
  legs:=(trip->>'trips')::numeric*CASE WHEN trip->'returnIncluded'='true'::jsonb THEN 2 ELSE 1 END;vehicle_legs:=legs*(trip->>'vehicles')::numeric;
  IF trip#>>'{time,value}' IS NULL THEN planned_minutes:=NULL;ELSIF planned_minutes IS NOT NULL THEN planned_minutes:=planned_minutes+(trip#>>'{time,value}')::numeric*CASE WHEN trip#>>'{time,unit}'='hour' THEN 60 ELSE 1 END*vehicle_legs;END IF;
  IF trip#>>'{distance,value}' IS NULL OR trip#>>'{distance,basis}'='straight_line' THEN all_distance:=FALSE;ELSIF all_distance THEN planned_miles:=planned_miles+(trip#>>'{distance,value}')::numeric*CASE WHEN trip#>>'{distance,unit}'='km' THEN 1/1.609344 ELSE 1 END*vehicle_legs;END IF;
  v:=trip->'vehicle';IF v->>'method'<>'consumption' THEN all_consumption:=FALSE;all_cost:=FALSE;CONTINUE;END IF;
  current_fuel_class:=CASE WHEN v->>'unit' IN ('us_gal','l') THEN 'liquid' ELSE 'kwh' END;
  IF planned_fuel_class IS NULL THEN planned_fuel_class:=current_fuel_class;ELSIF planned_fuel_class<>current_fuel_class THEN all_consumption:=FALSE;END IF;
  used:=NULL;
  IF v->>'basis'='efficiency' AND trip#>>'{distance,value}' IS NOT NULL AND trip#>>'{distance,basis}'<>'straight_line' THEN IF v->>'unit'='us_gal' THEN used:=(trip#>>'{distance,value}')::numeric*vehicle_legs/((v#>>'{efficiency,value}')::numeric*CASE WHEN trip#>>'{distance,unit}'='km' THEN 1.609344 ELSE 1 END);ELSE used:=(trip#>>'{distance,value}')::numeric*(v#>>'{efficiency,value}')::numeric*vehicle_legs*CASE WHEN trip#>>'{distance,unit}'='mi' THEN 1.609344 ELSE 1 END/100;END IF;
  ELSIF v->>'basis' IN ('whole_job','per_vehicle_leg') AND v->>'quantity' IS NOT NULL THEN used:=(v->>'quantity')::numeric*CASE WHEN v->>'basis'='whole_job' THEN 1 ELSE vehicle_legs END;END IF;
  IF used IS NULL THEN all_consumption:=FALSE;all_cost:=FALSE;ELSE planned_fuel:=planned_fuel+used*CASE WHEN v->>'unit'='l' THEN 1/3.785411784 ELSE 1 END;IF v->>'price' IS NULL THEN all_cost:=FALSE;ELSE planned_cost:=planned_cost+used*(v->>'price')::numeric;END IF;END IF;
 END LOOP;
 IF NOT all_distance THEN planned_miles:=NULL;END IF;IF missing_distance>0 THEN actual_miles:=NULL;END IF;
 IF NOT all_consumption OR fuel_class_count<>1 OR missing_fuel>0 OR planned_fuel_class IS DISTINCT FROM actual_fuel_class THEN planned_fuel:=NULL;actual_fuel:=NULL;END IF;
 vehicle_currency:=plan_row.currency;IF NOT all_cost OR missing_cost>0 OR currency_count<>1 OR actual_currency IS DISTINCT FROM vehicle_currency THEN planned_cost:=NULL;actual_cost:=NULL;END IF;
 metrics:=jsonb_build_object(
  'routeDuration',public.canonical_imported_travel_metric(planned_minutes,actual_minutes,'vehicle_min','Vehicle travel time',CASE WHEN planned_minutes IS NULL THEN 'The adopted plan lacks complete route duration.' END),
  'distance',public.canonical_imported_travel_metric(planned_miles,actual_miles,'mi','Driving distance',CASE WHEN planned_miles IS NULL THEN 'The adopted plan lacks comparable driving distance.' WHEN actual_miles IS NULL THEN 'Every current route record needs measured distance.' END),
  'fuelQuantity',public.canonical_imported_travel_metric(planned_fuel,actual_fuel,CASE WHEN planned_fuel_class='kwh' THEN 'kwh' ELSE 'us_gal' END,'Fuel or energy use',CASE WHEN planned_fuel IS NULL THEN 'Planned and actual fuel or energy units are incomplete or incompatible.' END),
  'fuelCost',public.canonical_imported_travel_metric(planned_cost,actual_cost,vehicle_currency,'Fuel cost',CASE WHEN planned_cost IS NULL THEN 'Every route needs an explicit fuel cost in the adopted plan currency.' END));
 source_manifest:=jsonb_build_object('estimate',jsonb_build_object('id',estimate_row.id,'digest',rtrim(estimate_row.snapshot_digest)),'estimateRevision',jsonb_build_object('id',revision_row.id,'revision',revision_row.revision,'digest',revision_row.digest),'travelPlan',jsonb_build_object('id',plan_row.id,'revision',plan_row.revision,'digest',plan_row.digest),'sourceConsent',jsonb_build_object('id',source_consent.id,'revision',source_consent.revision,'digest',rtrim(source_consent.canonical_digest)),'jobMatch',jsonb_build_object('id',job_match.id,'revision',job_match.revision,'digest',rtrim(job_match.canonical_digest),'externalJobReference',job_reference_value,'estimateId',job_match.target_id),'vehicleMatches',vehicle_matches,'importedRecords',imported_records);
 source_digest_value:=public.canonical_completion_digest(source_manifest);
 RETURN jsonb_build_object('sourceManifest',source_manifest,'sourceDigest',source_digest_value,'metrics',metrics,'scopeNote','Each travel dimension is compared only when the adopted plan and current imported records use compatible, complete evidence. Route intervals are vehicle minutes; distance is normalized to miles; liquid fuel is normalized to US gallons.','adoptionBoundary','Review these observations before changing future travel assumptions. No estimate, route, schedule, reimbursement, payroll, asset or policy was changed.');
END $$;

CREATE FUNCTION public.canonical_imported_travel_outcome_projection(value public.canonical_external_travel_outcome_observations)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'estimateId',value.estimate_id,'externalJobReference',value.external_job_reference,'revision',value.revision,'previousId',value.previous_id,'consent',jsonb_build_object('id',value.consent_id,'revision',value.consent_revision,'digest',rtrim(value.consent_digest)),'sourceManifest',value.source_manifest,'sourceDigest',rtrim(value.source_digest),'metrics',value.metrics,'scopeNote',value.scope_note,'adoptionBoundary',value.adoption_boundary,'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,'calculationVersion',value.calculation_version,'reason',value.reason,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at) $$;

CREATE FUNCTION public.canonical_imported_travel_outcome_observe(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,estimate UUID,job_reference TEXT,expected_consent_revision BIGINT,expected_consent_digest TEXT,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;source_consent public.canonical_external_travel_import_consents%ROWTYPE;consent_row public.canonical_external_travel_import_learning_consents%ROWTYPE;current_row public.canonical_external_travel_outcome_observations%ROWTYPE;replay_row public.canonical_external_travel_outcome_observations%ROWTYPE;inserted public.canonical_external_travel_outcome_observations%ROWTYPE;basis JSONB;next_revision BIGINT;key_hash TEXT;request_hash TEXT;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported travel learning review is restricted' USING ERRCODE='42501';END IF;
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR job_reference IS NULL OR char_length(job_reference) NOT BETWEEN 1 AND 128 OR job_reference!~'^[!-~]+$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR expected_consent_revision IS NULL OR expected_consent_revision NOT BETWEEN 1 AND 10000 OR expected_consent_digest IS NULL OR expected_consent_digest!~'^[0-9a-f]{64}$' OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE OR confirmation_version_value IS DISTINCT FROM 'm25-imported-travel-variance-observation-v1' THEN RAISE EXCEPTION 'Imported travel observation input invalid' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-travel-outcome:'||source_value||':'||estimate::text||':'||job_reference,0));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 SELECT * INTO replay_row FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceKey',source_value,'estimateId',estimate,'externalJobReference',job_reference,'consentRevision',expected_consent_revision,'consentDigest',expected_consent_digest,'reason',reason_value,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value,'sourceDigest',rtrim(replay_row.source_digest)));IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported travel observation key conflict' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('observation',public.canonical_imported_travel_outcome_projection(replay_row),'replayed',TRUE);END IF;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO consent_row FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant' OR consent_row.source_consent_id<>source_consent.id OR rtrim(consent_row.source_consent_digest)<>rtrim(source_consent.canonical_digest) OR consent_row.revision<>expected_consent_revision OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM expected_consent_digest THEN RAISE EXCEPTION 'Active imported travel learning consent changed' USING ERRCODE='40001',CONSTRAINT='imported_travel_learning_consent_stale';END IF;
 basis:=public.canonical_imported_travel_learning_basis(org,source_value,estimate,job_reference);
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceKey',source_value,'estimateId',estimate,'externalJobReference',job_reference,'consentRevision',expected_consent_revision,'consentDigest',expected_consent_digest,'reason',reason_value,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value,'sourceDigest',basis->>'sourceDigest'));
 SELECT * INTO replay_row FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org AND source_key=source_value AND estimate_id=estimate AND external_job_reference=job_reference AND source_digest=(basis->>'sourceDigest')::char(64) AND consent_id=consent_row.id;
 IF FOUND THEN RAISE EXCEPTION 'The current imported travel outcome was already observed' USING ERRCODE='22023',CONSTRAINT='imported_travel_outcome_already_current';END IF;
 SELECT * INTO current_row FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org AND source_key=source_value AND estimate_id=estimate AND external_job_reference=job_reference ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'estimateId',estimate,'externalJobReference',job_reference,'revision',next_revision,'previousId',current_row.id,'consentId',consent_row.id,'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),'sourceDigest',basis->>'sourceDigest','metrics',basis->'metrics','actorUserId',actor,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_travel_outcome_observations(organization_id,source_key,estimate_id,external_job_reference,revision,previous_id,consent_id,consent_revision,consent_digest,source_manifest,source_digest,metrics,scope_note,adoption_boundary,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,calculation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,estimate,job_reference,next_revision,current_row.id,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),basis->'sourceManifest',basis->>'sourceDigest',basis->'metrics',basis->>'scopeNote',basis->>'adoptionBoundary',actor,(authority->>'membershipId')::uuid,session_value,reason_value,confirmed_value,confirmation_version_value,'m25-imported-travel-variance-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('observation',public.canonical_imported_travel_outcome_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_imported_travel_outcome_read(org UUID,actor UUID,role_value TEXT,session_value UUID,source_value TEXT,estimate UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_travel_import_consents%ROWTYPE;consent_row public.canonical_external_travel_import_learning_consents%ROWTYPE;current_row public.canonical_external_travel_outcome_observations%ROWTYPE;basis JSONB;fresh BOOLEAN;history JSONB;total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported travel learning review is restricted' USING ERRCODE='42501';END IF;PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External travel source invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO source_consent FROM public.canonical_external_travel_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO consent_row FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org AND source_key=source_value AND purpose='imported_travel_variance_v1' ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant' OR consent_row.source_consent_id<>source_consent.id OR rtrim(consent_row.source_consent_digest)<>rtrim(source_consent.canonical_digest) THEN RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'blockedReason','Current source and imported travel learning consent are required.');END IF;
 SELECT * INTO current_row FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org AND source_key=source_value AND estimate_id=estimate ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,'consent',public.canonical_imported_travel_learning_consent_projection(consent_row),'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'refreshRequired',TRUE);END IF;
 BEGIN basis:=public.canonical_imported_travel_learning_basis(org,source_value,estimate,current_row.external_job_reference);fresh:=rtrim(current_row.source_digest)=basis->>'sourceDigest' AND current_row.consent_id=consent_row.id;EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;fresh:=FALSE;END;
 SELECT count(*) INTO total FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org AND source_key=source_value AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(public.canonical_imported_travel_outcome_projection(item)||jsonb_build_object('fresh',rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id,'advisoryAvailable',rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id,'metrics',CASE WHEN rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id THEN item.metrics ELSE jsonb_build_object('routeDuration',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Vehicle travel time','Refresh current evidence before using this observation.'),'distance',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Driving distance','Refresh current evidence before using this observation.'),'fuelQuantity',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Fuel or energy use','Refresh current evidence before using this observation.'),'fuelCost',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Fuel cost','Refresh current evidence before using this observation.')) END) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org AND source_key=source_value AND estimate_id=estimate ORDER BY created_at DESC,id DESC LIMIT 20)item;
 RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,'consent',public.canonical_imported_travel_learning_consent_projection(consent_row),'current',public.canonical_imported_travel_outcome_projection(current_row)||jsonb_build_object('fresh',fresh,'advisoryAvailable',fresh,'metrics',CASE WHEN fresh THEN current_row.metrics ELSE jsonb_build_object('routeDuration',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Vehicle travel time','Refresh current evidence before using this observation.'),'distance',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Driving distance','Refresh current evidence before using this observation.'),'fuelQuantity',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Fuel or energy use','Refresh current evidence before using this observation.'),'fuelCost',public.canonical_imported_travel_metric(NULL,NULL,NULL,'Fuel cost','Refresh current evidence before using this observation.')) END),'history',history,'total',total,'truncated',total>20,'refreshRequired',NOT fresh);
END $$;

REVOKE ALL ON TABLE public.canonical_external_travel_import_learning_consents,public.canonical_external_travel_outcome_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_metric_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_metrics_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_metric(NUMERIC,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_learning_consent_projection(public.canonical_external_travel_import_learning_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_learning_basis(UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_outcome_projection(public.canonical_external_travel_outcome_observations) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_learning_consent_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_learning_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_outcome_observe(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID,TEXT,BIGINT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_travel_outcome_read(UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
