-- Mission 25 Part 11F: tenant-private multi-job imported material and purchasing calibration proposals.
-- Robust summaries remain advisory and never mutate estimates, plans, rates, schedules or policy.

CREATE TABLE public.canonical_external_material_calibration_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 purpose TEXT NOT NULL CHECK(purpose='imported_material_calibration_v1'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 quantity_consent_id UUID NOT NULL,
 quantity_consent_revision BIGINT NOT NULL CHECK(quantity_consent_revision BETWEEN 1 AND 10000),
 quantity_consent_digest CHAR(64) NOT NULL CHECK(quantity_consent_digest~'^[0-9a-f]{64}$'),
 cost_consent_id UUID NOT NULL,
 cost_consent_revision BIGINT NOT NULL CHECK(cost_consent_revision BETWEEN 1 AND 10000),
 cost_consent_digest CHAR(64) NOT NULL CHECK(cost_consent_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["canonical_external_material_cost_observations", "canonical_external_material_quantity_observations"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-imported-material-calibration-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,purpose,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_material_calibration_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,quantity_consent_id)
  REFERENCES public.canonical_external_material_outcome_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,cost_consent_id)
  REFERENCES public.canonical_external_material_cost_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE FUNCTION public.canonical_imported_material_calibration_metric_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_field_evidence_object_keys_exact(value,ARRAY['status','label','basis','sampleSize','advisoryAvailable',
  'medianActualToPlannedRatio','lowerQuartileRatio','upperQuartileRatio','proposedMultiplier','advisoryCode',
  'advisoryMessage','unavailableReason']) AND value->>'status' IN ('compared','unavailable')
  AND jsonb_typeof(value->'label')='string' AND public.canonical_learning_text_valid(value->>'label',100)
  AND jsonb_typeof(value->'sampleSize')='number' AND (value->>'sampleSize')~'^(0|[1-9][0-9]{0,2})$'
  AND (value->>'sampleSize')::integer BETWEEN 0 AND 100
  AND jsonb_typeof(value->'advisoryAvailable')='boolean'
  AND CASE WHEN value->>'status'='compared' THEN
   (value->>'sampleSize')::integer BETWEEN 5 AND 100 AND jsonb_typeof(value->'basis')='string'
   AND public.canonical_learning_text_valid(value->>'basis',200)
   AND jsonb_typeof(value->'medianActualToPlannedRatio')='string'
   AND value->>'medianActualToPlannedRatio'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
   AND jsonb_typeof(value->'lowerQuartileRatio')='string'
   AND value->>'lowerQuartileRatio'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
   AND jsonb_typeof(value->'upperQuartileRatio')='string'
   AND value->>'upperQuartileRatio'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
   AND (value->>'upperQuartileRatio')::numeric >= (value->>'lowerQuartileRatio')::numeric
   AND CASE WHEN value->'advisoryAvailable'='true'::jsonb THEN
    (value->>'medianActualToPlannedRatio')::numeric BETWEEN 0.25 AND 4.00
    AND jsonb_typeof(value->'proposedMultiplier')='string'
    AND value->>'proposedMultiplier'=value->>'medianActualToPlannedRatio'
    AND value->>'advisoryCode' IN ('keep_current_assumption','increase_planned_amount','decrease_planned_amount')
    AND jsonb_typeof(value->'advisoryMessage')='string'
    AND public.canonical_learning_text_valid(value->>'advisoryMessage',1000)
    AND value->'unavailableReason'='null'::jsonb
    AND value->>'advisoryCode'=CASE WHEN (value->>'medianActualToPlannedRatio')::numeric BETWEEN 0.95 AND 1.05
     THEN 'keep_current_assumption' WHEN (value->>'medianActualToPlannedRatio')::numeric>1.05
     THEN 'increase_planned_amount' ELSE 'decrease_planned_amount' END
   ELSE ((value->>'medianActualToPlannedRatio')::numeric<0.25 OR (value->>'medianActualToPlannedRatio')::numeric>4.00)
    AND value->'proposedMultiplier'='null'::jsonb AND value->'advisoryCode'='null'::jsonb
    AND value->'advisoryMessage'='null'::jsonb AND jsonb_typeof(value->'unavailableReason')='string'
    AND public.canonical_learning_text_valid(value->>'unavailableReason',1000) END
  ELSE value->'advisoryAvailable'='false'::jsonb AND value->'basis'='null'::jsonb AND value->'medianActualToPlannedRatio'='null'::jsonb
   AND value->'lowerQuartileRatio'='null'::jsonb AND value->'upperQuartileRatio'='null'::jsonb
   AND value->'proposedMultiplier'='null'::jsonb AND value->'advisoryCode'='null'::jsonb
   AND value->'advisoryMessage'='null'::jsonb AND jsonb_typeof(value->'unavailableReason')='string'
   AND public.canonical_learning_text_valid(value->>'unavailableReason',1000) END
$$;

CREATE FUNCTION public.canonical_imported_material_calibration_metrics_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_field_evidence_object_keys_exact(value,ARRAY['totalUse','waste','unitCost','purchaseQuantity','purchaseCost'])
  AND public.canonical_imported_material_calibration_metric_valid(value->'totalUse')
  AND public.canonical_imported_material_calibration_metric_valid(value->'waste')
  AND public.canonical_imported_material_calibration_metric_valid(value->'unitCost')
  AND public.canonical_imported_material_calibration_metric_valid(value->'purchaseQuantity')
  AND public.canonical_imported_material_calibration_metric_valid(value->'purchaseCost')
$$;

CREATE FUNCTION public.canonical_imported_material_calibration_eligible_count(value JSONB)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT (CASE WHEN value#>'{totalUse,advisoryAvailable}'='true'::jsonb THEN 1 ELSE 0 END
  + CASE WHEN value#>'{waste,advisoryAvailable}'='true'::jsonb THEN 1 ELSE 0 END
  + CASE WHEN value#>'{unitCost,advisoryAvailable}'='true'::jsonb THEN 1 ELSE 0 END
  + CASE WHEN value#>'{purchaseQuantity,advisoryAvailable}'='true'::jsonb THEN 1 ELSE 0 END
  + CASE WHEN value#>'{purchaseCost,advisoryAvailable}'='true'::jsonb THEN 1 ELSE 0 END)::integer
$$;

CREATE TABLE public.canonical_external_material_calibration_proposals (
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
 eligible_metric_count INTEGER NOT NULL CHECK(eligible_metric_count BETWEEN 0 AND 5),
 evidence_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(evidence_boundary,1500)),
 adoption_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(adoption_boundary,1000)),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-imported-material-calibration-proposal-v1'),
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-imported-material-median-calibration-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,source_key,service_key,revision),
 UNIQUE(organization_id,source_key,service_key,sample_digest,consent_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_id)
  REFERENCES public.canonical_external_material_calibration_proposals(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_key,consent_id)
  REFERENCES public.canonical_external_material_calibration_consents(organization_id,source_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(rtrim(sample_digest)=public.canonical_completion_digest(sample_manifest)),
 CHECK(public.canonical_imported_material_calibration_metrics_valid(metrics)),
 CHECK(eligible_metric_count=public.canonical_imported_material_calibration_eligible_count(metrics))
);

CREATE TRIGGER canonical_external_material_calibration_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_material_calibration_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();
CREATE TRIGGER canonical_external_material_calibration_proposals_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_external_material_calibration_proposals FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_imported_material_calibration_consent_projection(
 value public.canonical_external_material_calibration_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'purpose',value.purpose,'revision',value.revision,
 'previousId',value.previous_id,'action',value.action,'quantityConsent',jsonb_build_object('id',value.quantity_consent_id,
   'revision',value.quantity_consent_revision,'digest',rtrim(value.quantity_consent_digest)),
  'costConsent',jsonb_build_object('id',value.cost_consent_id,
   'revision',value.cost_consent_revision,'digest',rtrim(value.cost_consent_digest)),
  'sourceScope',value.source_scope,'consentVersion',value.consent_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_imported_material_calibration_consent_read(org UUID,actor UUID,role_value TEXT,
 session_value UUID,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_material_import_consents%ROWTYPE;
 quantity_consent public.canonical_external_material_outcome_consents%ROWTYPE;
 cost_consent public.canonical_external_material_cost_consents%ROWTYPE;
 current_row public.canonical_external_material_calibration_consents%ROWTYPE; history JSONB; total BIGINT; active_value BOOLEAN;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported material calibration review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External material and purchasing source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO quantity_consent FROM public.canonical_external_material_outcome_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO cost_consent FROM public.canonical_external_material_cost_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_cost_vendor_availability_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO source_consent FROM public.canonical_external_material_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO current_row FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_calibration_v1' ORDER BY revision DESC LIMIT 1;
 active_value:=source_consent.id IS NOT NULL AND source_consent.action='grant' AND quantity_consent.id IS NOT NULL
  AND quantity_consent.action='grant' AND quantity_consent.source_consent_id=source_consent.id
  AND rtrim(quantity_consent.source_consent_digest)=rtrim(source_consent.canonical_digest)
  AND cost_consent.id IS NOT NULL AND cost_consent.action='grant' AND cost_consent.source_consent_id=source_consent.id
  AND rtrim(cost_consent.source_consent_digest)=rtrim(source_consent.canonical_digest) AND current_row.id IS NOT NULL
  AND current_row.action='grant' AND current_row.quantity_consent_id=quantity_consent.id
  AND rtrim(current_row.quantity_consent_digest)=rtrim(quantity_consent.canonical_digest)
  AND current_row.cost_consent_id=cost_consent.id AND rtrim(current_row.cost_consent_digest)=rtrim(cost_consent.canonical_digest);
 SELECT count(*) INTO total FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_calibration_v1';
 SELECT COALESCE(jsonb_agg(public.canonical_imported_material_calibration_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
   AND source_key=source_value AND purpose='imported_material_calibration_v1' ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'active',active_value,'current',CASE WHEN current_row.id IS NULL THEN NULL
  ELSE public.canonical_imported_material_calibration_consent_projection(current_row) END,'history',history,'total',total,
  'truncated',total>20,'blockedReason',CASE WHEN active_value THEN NULL
   WHEN quantity_consent.id IS NULL OR quantity_consent.action<>'grant' THEN 'Material quantity outcome consent is not active.'
   WHEN cost_consent.id IS NULL OR cost_consent.action<>'grant' THEN 'Material cost and purchasing outcome consent is not active.'
   WHEN current_row.id IS NOT NULL AND current_row.action='grant'
   THEN 'Calibration consent must be renewed for the current quantity and cost consent.' ELSE 'Material and purchasing calibration consent is not active.' END);
END $$;

CREATE FUNCTION public.canonical_imported_material_calibration_consent_mutate(org UUID,actor UUID,role_value TEXT,
 session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_consent public.canonical_external_material_import_consents%ROWTYPE;
 quantity_consent public.canonical_external_material_outcome_consents%ROWTYPE;
 cost_consent public.canonical_external_material_cost_consents%ROWTYPE;
 current_row public.canonical_external_material_calibration_consents%ROWTYPE;
 replay_row public.canonical_external_material_calibration_consents%ROWTYPE;
 inserted public.canonical_external_material_calibration_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT; currently_active BOOLEAN;
 scope_value JSONB:='["canonical_external_material_cost_observations", "canonical_external_material_quantity_observations"]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported material calibration review is restricted' USING ERRCODE='42501'; END IF;
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
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-imported-material-calibration-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Imported material calibration consent input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
  'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-material-calibration-consent:'||source_value,0));
 SELECT * INTO replay_row FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported material calibration consent key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('consent',public.canonical_imported_material_calibration_consent_projection(replay_row),'replayed',TRUE);
 END IF;
 SELECT * INTO quantity_consent FROM public.canonical_external_material_outcome_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO cost_consent FROM public.canonical_external_material_cost_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_cost_vendor_availability_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO source_consent FROM public.canonical_external_material_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO current_row FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_calibration_v1' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Material and purchasing calibration consent changed' USING ERRCODE='40001',CONSTRAINT='imported_material_calibration_consent_stale'; END IF;
 currently_active:=current_row.id IS NOT NULL AND current_row.action='grant' AND quantity_consent.id IS NOT NULL
  AND quantity_consent.action='grant' AND current_row.quantity_consent_id=quantity_consent.id
  AND rtrim(current_row.quantity_consent_digest)=rtrim(quantity_consent.canonical_digest)
  AND cost_consent.id IS NOT NULL AND cost_consent.action='grant' AND current_row.cost_consent_id=cost_consent.id
  AND rtrim(current_row.cost_consent_digest)=rtrim(cost_consent.canonical_digest);
 IF body->>'action'='grant' AND (source_consent.id IS NULL OR source_consent.action<>'grant'
  OR quantity_consent.id IS NULL OR quantity_consent.action<>'grant' OR quantity_consent.source_consent_id<>source_consent.id
  OR rtrim(quantity_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR cost_consent.id IS NULL OR cost_consent.action<>'grant' OR cost_consent.source_consent_id<>source_consent.id
  OR rtrim(cost_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)) THEN
  RAISE EXCEPTION 'Material and purchasing quantity and cost consent inactive' USING ERRCODE='40001',CONSTRAINT='imported_material_calibration_quantity_consent_stale'; END IF;
 IF body->>'action'='grant' AND currently_active THEN RAISE EXCEPTION 'Imported material calibration consent is already active' USING ERRCODE='22023'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN
  RAISE EXCEPTION 'No imported material calibration consent' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'purpose','imported_material_calibration_v1','revision',next_revision,'previousId',current_row.id,
  'action',body->>'action','quantityConsentId',quantity_consent.id,'quantityConsentRevision',quantity_consent.revision,
  'quantityConsentDigest',rtrim(quantity_consent.canonical_digest),'costConsentId',cost_consent.id,
  'costConsentRevision',cost_consent.revision,'costConsentDigest',rtrim(cost_consent.canonical_digest),'actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,
  'consentVersion','m25-imported-material-calibration-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_material_calibration_consents(organization_id,source_key,purpose,revision,previous_id,
  action,quantity_consent_id,quantity_consent_revision,quantity_consent_digest,
  cost_consent_id,cost_consent_revision,cost_consent_digest,actor_user_id,membership_id,auth_session_id,
  source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,'imported_material_calibration_v1',next_revision,current_row.id,body->>'action',
  quantity_consent.id,quantity_consent.revision,rtrim(quantity_consent.canonical_digest),
  cost_consent.id,cost_consent.revision,rtrim(cost_consent.canonical_digest),actor,(authority->>'membershipId')::uuid,
  session_value,scope_value,'m25-imported-material-calibration-consent-v1',body->>'reason',key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_imported_material_calibration_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_imported_material_calibration_job_metrics(quantity_result JSONB,quantity_plan JSONB,cost_result JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE line_count INTEGER;eligible_count INTEGER;ratio_value NUMERIC;basis_value TEXT;currency_count INTEGER;
 total_use JSONB;waste_value JSONB;unit_cost JSONB;purchase_quantity JSONB;purchase_cost JSONB;
BEGIN
 IF jsonb_typeof(quantity_result#>'{lines}')<>'array' OR jsonb_typeof(cost_result#>'{lines}')<>'array'
  OR jsonb_typeof(quantity_plan->'lines')<>'array' THEN
  RAISE EXCEPTION 'Material calibration observation input invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*)::integer,count(*)FILTER(WHERE line#>>'{totalQuantity,status}'='compared'
   AND (line->>'plannedQuantity')::numeric>0 AND (line#>>'{totalQuantity,quantity}')::numeric>=0)::integer,
  round((percentile_cont(0.5)WITHIN GROUP(ORDER BY (line#>>'{totalQuantity,quantity}')::numeric/(line->>'plannedQuantity')::numeric)
   FILTER(WHERE line#>>'{totalQuantity,status}'='compared' AND (line->>'plannedQuantity')::numeric>0))::numeric,6),
  'lines:'||count(*)::text||'|units:'||string_agg(DISTINCT line->>'plannedUnit',',' ORDER BY line->>'plannedUnit')
 INTO line_count,eligible_count,ratio_value,basis_value FROM jsonb_array_elements(quantity_result->'lines')line;
 total_use:=CASE WHEN line_count>0 AND eligible_count=line_count AND length(basis_value)<=200
  THEN jsonb_build_object('status','compared','ratio',ratio_value::text,'basis',basis_value,'unavailableReason',NULL)
  ELSE jsonb_build_object('status','unavailable','ratio',NULL,'basis',NULL,'unavailableReason','Every plan line needs compatible recorded consumption and waste before total material use can be calibrated.') END;
 WITH joined AS(SELECT result_line,plan_line,(result_line->>'plannedQuantity')::numeric-(plan_line->>'quantity')::numeric planned_waste
  FROM jsonb_array_elements(quantity_result->'lines')result_line
  JOIN jsonb_array_elements(quantity_plan->'lines')plan_line ON plan_line->>'lineId'=result_line->>'lineId')
 SELECT count(*)::integer,count(*)FILTER(WHERE planned_waste>0 AND result_line#>>'{waste,status}'='recorded'
   AND (result_line#>>'{waste,quantity}')::numeric>=0)::integer,
  round((percentile_cont(0.5)WITHIN GROUP(ORDER BY (result_line#>>'{waste,quantity}')::numeric/planned_waste)
   FILTER(WHERE planned_waste>0 AND result_line#>>'{waste,status}'='recorded'))::numeric,6),
  'lines:'||count(*)::text||'|units:'||string_agg(DISTINCT result_line->>'plannedUnit',',' ORDER BY result_line->>'plannedUnit')
 INTO line_count,eligible_count,ratio_value,basis_value FROM joined;
 waste_value:=CASE WHEN line_count>0 AND eligible_count=line_count AND length(basis_value)<=200
  THEN jsonb_build_object('status','compared','ratio',ratio_value::text,'basis',basis_value,'unavailableReason',NULL)
  ELSE jsonb_build_object('status','unavailable','ratio',NULL,'basis',NULL,'unavailableReason','Every plan line needs a positive planned waste amount and compatible recorded waste before waste can be calibrated.') END;
 SELECT count(*)::integer,count(*)FILTER(WHERE line#>>'{unitCost,status}'='compared'
   AND (line#>>'{unitCost,plannedUnitCost}')::numeric>0 AND (line#>>'{unitCost,recordedUnitCost}')::numeric>=0)::integer,
  round((percentile_cont(0.5)WITHIN GROUP(ORDER BY (line#>>'{unitCost,recordedUnitCost}')::numeric/(line#>>'{unitCost,plannedUnitCost}')::numeric)
   FILTER(WHERE line#>>'{unitCost,status}'='compared' AND (line#>>'{unitCost,plannedUnitCost}')::numeric>0))::numeric,6),
  count(DISTINCT line#>>'{unitCost,currency}')::integer,
  'currency:'||min(line#>>'{unitCost,currency}')||'|lines:'||count(*)::text||'|units:'||string_agg(DISTINCT line->>'plannedUnit',',' ORDER BY line->>'plannedUnit')
 INTO line_count,eligible_count,ratio_value,currency_count,basis_value FROM jsonb_array_elements(cost_result->'lines')line;
 unit_cost:=CASE WHEN line_count>0 AND eligible_count=line_count AND currency_count=1 AND length(basis_value)<=200
  THEN jsonb_build_object('status','compared','ratio',ratio_value::text,'basis',basis_value,'unavailableReason',NULL)
  ELSE jsonb_build_object('status','unavailable','ratio',NULL,'basis',NULL,'unavailableReason','Every plan line needs one compatible recorded unit cost in one exact currency before unit cost can be calibrated.') END;
 SELECT count(*)::integer,count(*)FILTER(WHERE line#>>'{purchasing,quantity,status}'='compared'
   AND (line#>>'{purchasing,quantity,plannedQuantity}')::numeric>0 AND (line#>>'{purchasing,quantity,recordedQuantity}')::numeric>=0)::integer,
  round((percentile_cont(0.5)WITHIN GROUP(ORDER BY (line#>>'{purchasing,quantity,recordedQuantity}')::numeric/(line#>>'{purchasing,quantity,plannedQuantity}')::numeric)
   FILTER(WHERE line#>>'{purchasing,quantity,status}'='compared' AND (line#>>'{purchasing,quantity,plannedQuantity}')::numeric>0))::numeric,6),
  'lines:'||count(*)::text||'|units:'||string_agg(DISTINCT line->>'plannedUnit',',' ORDER BY line->>'plannedUnit')
 INTO line_count,eligible_count,ratio_value,basis_value FROM jsonb_array_elements(cost_result->'lines')line;
 purchase_quantity:=CASE WHEN line_count>0 AND eligible_count=line_count AND length(basis_value)<=200
  THEN jsonb_build_object('status','compared','ratio',ratio_value::text,'basis',basis_value,'unavailableReason',NULL)
  ELSE jsonb_build_object('status','unavailable','ratio',NULL,'basis',NULL,'unavailableReason','Every plan line needs a compatible recorded purchase quantity before purchasing quantity can be calibrated.') END;
 SELECT count(*)::integer,count(*)FILTER(WHERE line#>>'{purchasing,lineTotal,status}'='recorded'
   AND (line->>'plannedQuantity')::numeric>0 AND (line#>>'{unitCost,plannedUnitCost}')::numeric>0
   AND (line#>>'{purchasing,lineTotal,amount}')::numeric>=0)::integer,
  round((percentile_cont(0.5)WITHIN GROUP(ORDER BY (line#>>'{purchasing,lineTotal,amount}')::numeric/
   ((line->>'plannedQuantity')::numeric*(line#>>'{unitCost,plannedUnitCost}')::numeric))
   FILTER(WHERE line#>>'{purchasing,lineTotal,status}'='recorded' AND (line->>'plannedQuantity')::numeric>0
    AND (line#>>'{unitCost,plannedUnitCost}')::numeric>0))::numeric,6),
  count(DISTINCT line#>>'{purchasing,lineTotal,currency}')::integer,
  'currency:'||min(line#>>'{purchasing,lineTotal,currency}')||'|lines:'||count(*)::text
 INTO line_count,eligible_count,ratio_value,currency_count,basis_value FROM jsonb_array_elements(cost_result->'lines')line;
 purchase_cost:=CASE WHEN line_count>0 AND eligible_count=line_count AND currency_count=1 AND length(basis_value)<=200
  THEN jsonb_build_object('status','compared','ratio',ratio_value::text,'basis',basis_value,'unavailableReason',NULL)
  ELSE jsonb_build_object('status','unavailable','ratio',NULL,'basis',NULL,'unavailableReason','Every plan line needs a compatible recorded purchase total and positive planned line cost in one exact currency before purchasing cost can be calibrated.') END;
 RETURN jsonb_build_object('totalUse',total_use,'waste',waste_value,'unitCost',unit_cost,
  'purchaseQuantity',purchase_quantity,'purchaseCost',purchase_cost);
END $$;

CREATE FUNCTION public.canonical_imported_material_calibration_metric(observations JSONB,metric_key TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE label_value TEXT;sample_count INTEGER;basis_count INTEGER;basis_value TEXT;
 median_value NUMERIC;lower_value NUMERIC;upper_value NUMERIC;code_value TEXT;message_value TEXT;
BEGIN
 IF metric_key NOT IN ('totalUse','waste','unitCost','purchaseQuantity','purchaseCost') OR jsonb_typeof(observations)<>'array' THEN
  RAISE EXCEPTION 'Material and purchasing calibration metric input invalid' USING ERRCODE='22023'; END IF;
 label_value:=CASE metric_key WHEN 'totalUse' THEN 'Total material use' WHEN 'waste' THEN 'Material waste'
  WHEN 'unitCost' THEN 'Material unit cost' WHEN 'purchaseQuantity' THEN 'Purchased quantity' ELSE 'Material purchase cost' END;
 WITH eligible AS(SELECT item#>>ARRAY['metrics',metric_key,'basis'] basis,
  (item#>>ARRAY['metrics',metric_key,'ratio'])::numeric ratio FROM jsonb_array_elements(observations)item
  WHERE item#>>ARRAY['metrics',metric_key,'status']='compared' AND (item#>>ARRAY['metrics',metric_key,'ratio'])::numeric>=0)
 SELECT count(*)::integer,count(DISTINCT basis)::integer,min(basis),
  round(percentile_cont(0.5)WITHIN GROUP(ORDER BY ratio)::numeric,4),
  round(percentile_cont(0.25)WITHIN GROUP(ORDER BY ratio)::numeric,4),
  round(percentile_cont(0.75)WITHIN GROUP(ORDER BY ratio)::numeric,4)
 INTO sample_count,basis_count,basis_value,median_value,lower_value,upper_value FROM eligible;
 IF sample_count<5 THEN RETURN jsonb_build_object('status','unavailable','label',label_value,'basis',NULL,
  'sampleSize',sample_count,'advisoryAvailable',FALSE,'medianActualToPlannedRatio',NULL,'lowerQuartileRatio',NULL,'upperQuartileRatio',NULL,
  'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL,
  'unavailableReason','At least five current outcomes with this comparable dimension are required.'); END IF;
 IF basis_count<>1 THEN RETURN jsonb_build_object('status','unavailable','label',label_value,'basis',NULL,
  'sampleSize',sample_count,'advisoryAvailable',FALSE,'medianActualToPlannedRatio',NULL,'lowerQuartileRatio',NULL,'upperQuartileRatio',NULL,
  'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL,
  'unavailableReason','Current outcomes use incompatible material units, plan shapes or currencies for this dimension.'); END IF;
 IF median_value<0.25 OR median_value>4.00 THEN RETURN jsonb_build_object('status','compared','label',label_value,
  'basis',basis_value,'sampleSize',sample_count,'advisoryAvailable',FALSE,'medianActualToPlannedRatio',median_value::text,
  'lowerQuartileRatio',lower_value::text,'upperQuartileRatio',upper_value::text,'proposedMultiplier',NULL,
  'advisoryCode',NULL,'advisoryMessage',NULL,'unavailableReason','The observed median is outside the 0.25 to 4.00 advisory multiplier range. Review the adopted baseline and source evidence before changing this assumption.'); END IF;
 code_value:=CASE WHEN median_value BETWEEN 0.95 AND 1.05 THEN 'keep_current_assumption'
  WHEN median_value>1.05 THEN 'increase_planned_amount' ELSE 'decrease_planned_amount' END;
 message_value:=CASE code_value WHEN 'keep_current_assumption' THEN 'The median actual-to-planned ratio is within 5% of the current assumption.'
  WHEN 'increase_planned_amount' THEN 'The median recorded amount is higher than the adopted plans in this reviewed sample.'
  ELSE 'The median recorded amount is lower than the adopted plans in this reviewed sample.' END;
 RETURN jsonb_build_object('status','compared','label',label_value,'basis',basis_value,'sampleSize',sample_count,
  'advisoryAvailable',TRUE,'medianActualToPlannedRatio',median_value::text,'lowerQuartileRatio',lower_value::text,
  'upperQuartileRatio',upper_value::text,'proposedMultiplier',median_value::text,'advisoryCode',code_value,
  'advisoryMessage',message_value,'unavailableReason',NULL);
END $$;

CREATE FUNCTION public.canonical_imported_material_calibration_basis(org UUID,source_value TEXT,service_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_consent public.canonical_external_material_import_consents%ROWTYPE;
 quantity_consent public.canonical_external_material_outcome_consents%ROWTYPE;
 cost_consent public.canonical_external_material_cost_consents%ROWTYPE;
 item RECORD;quantity_basis JSONB;cost_basis JSONB;observations JSONB:='[]'::jsonb;candidate_total INTEGER:=0;fresh_total INTEGER:=0;
 metrics_value JSONB;eligible_count INTEGER;manifest JSONB;digest_value TEXT;
BEGIN
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR service_value IS NULL
  OR service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'Material and purchasing calibration identity invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO source_consent FROM public.canonical_external_material_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT * INTO quantity_consent FROM public.canonical_external_material_outcome_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO cost_consent FROM public.canonical_external_material_cost_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_cost_vendor_availability_v1' ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR quantity_consent.id IS NULL OR quantity_consent.action<>'grant'
  OR quantity_consent.source_consent_id<>source_consent.id
  OR rtrim(quantity_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR cost_consent.id IS NULL OR cost_consent.action<>'grant' OR cost_consent.source_consent_id<>source_consent.id
  OR rtrim(cost_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest) THEN
  RAISE EXCEPTION 'Current material quantity and cost outcome consent is required'
   USING ERRCODE='P0002',CONSTRAINT='imported_material_calibration_quantity_consent_unavailable'; END IF;
 WITH current_quantity AS(SELECT DISTINCT ON(estimate_id) observation.* FROM public.canonical_external_material_quantity_observations observation
   WHERE observation.organization_id=org AND observation.source_key=source_value ORDER BY estimate_id,revision DESC,id DESC),
  current_cost AS(SELECT DISTINCT ON(estimate_id) observation.* FROM public.canonical_external_material_cost_observations observation
   WHERE observation.organization_id=org AND observation.source_key=source_value ORDER BY estimate_id,revision DESC,id DESC),
  candidate_ids AS(SELECT estimate_id FROM current_quantity UNION SELECT estimate_id FROM current_cost)
 SELECT count(*) INTO candidate_total FROM candidate_ids candidate
 JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=candidate.estimate_id
 JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
 WHERE lower(btrim(opportunity.service_type))=service_value;
 IF candidate_total>10000 THEN RAISE EXCEPTION 'Material and purchasing calibration candidate set is too broad for bounded review'
  USING ERRCODE='P0002',CONSTRAINT='imported_material_calibration_sample_scope_too_broad'; END IF;
 FOR item IN WITH current_quantity AS(SELECT DISTINCT ON(estimate_id) observation.* FROM public.canonical_external_material_quantity_observations observation
   WHERE observation.organization_id=org AND observation.source_key=source_value ORDER BY estimate_id,revision DESC,id DESC),
  current_cost AS(SELECT DISTINCT ON(estimate_id) observation.* FROM public.canonical_external_material_cost_observations observation
   WHERE observation.organization_id=org AND observation.source_key=source_value ORDER BY estimate_id,revision DESC,id DESC)
  SELECT quantity.id quantity_id,quantity.estimate_id,quantity.external_job_reference,quantity.revision quantity_revision,
   quantity.canonical_digest quantity_digest,quantity.source_digest quantity_source_digest,quantity.source_manifest quantity_manifest,
   quantity.result quantity_result,quantity.consent_id quantity_consent_id,plan.inputs quantity_plan_inputs,
   cost.id cost_id,cost.revision cost_revision,
   cost.canonical_digest cost_digest,cost.source_digest cost_source_digest,cost.source_manifest cost_manifest,
   cost.result cost_result,cost.consent_id cost_consent_id FROM current_quantity quantity JOIN current_cost cost
   ON cost.estimate_id=quantity.estimate_id AND cost.external_job_reference=quantity.external_job_reference
  JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=quantity.estimate_id
  JOIN public.canonical_material_plans plan ON plan.organization_id=org AND plan.estimate_id=quantity.estimate_id
   AND plan.id=(quantity.source_manifest#>>'{materialPlan,id}')::uuid
   AND plan.revision=(quantity.source_manifest#>>'{materialPlan,revision}')::bigint
   AND rtrim(plan.digest)=quantity.source_manifest#>>'{materialPlan,digest}'
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
  WHERE lower(btrim(opportunity.service_type))=service_value
  ORDER BY quantity.estimate_id
 LOOP
  BEGIN
   quantity_basis:=public.canonical_imported_material_outcome_basis(org,source_value,item.estimate_id,item.external_job_reference,item.quantity_manifest->'bindings');
   cost_basis:=public.canonical_imported_material_cost_basis(org,source_value,item.estimate_id,item.external_job_reference,item.cost_manifest->'bindings');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN CONTINUE; END;
  IF rtrim(item.quantity_source_digest)<>quantity_basis->>'sourceDigest' OR item.quantity_consent_id<>quantity_consent.id
   OR rtrim(item.cost_source_digest)<>cost_basis->>'sourceDigest' OR item.cost_consent_id<>cost_consent.id THEN CONTINUE; END IF;
  fresh_total:=fresh_total+1;
  IF fresh_total<=100 THEN observations:=observations||jsonb_build_array(jsonb_build_object('estimateId',item.estimate_id,
   'externalJobReference',item.external_job_reference,
   'quantityObservation',jsonb_build_object('id',item.quantity_id,'revision',item.quantity_revision,
    'digest',rtrim(item.quantity_digest),'sourceDigest',rtrim(item.quantity_source_digest)),
   'costObservation',jsonb_build_object('id',item.cost_id,'revision',item.cost_revision,
    'digest',rtrim(item.cost_digest),'sourceDigest',rtrim(item.cost_source_digest)),
   'metrics',public.canonical_imported_material_calibration_job_metrics(item.quantity_result,item.quantity_plan_inputs,item.cost_result))); END IF;
 END LOOP;
 IF fresh_total<5 THEN RAISE EXCEPTION 'At least five current material and purchasing outcomes are required'
  USING ERRCODE='P0002',CONSTRAINT='imported_material_calibration_sample_insufficient'; END IF;
 metrics_value:=jsonb_build_object('totalUse',public.canonical_imported_material_calibration_metric(observations,'totalUse'),
  'waste',public.canonical_imported_material_calibration_metric(observations,'waste'),
  'unitCost',public.canonical_imported_material_calibration_metric(observations,'unitCost'),
  'purchaseQuantity',public.canonical_imported_material_calibration_metric(observations,'purchaseQuantity'),
  'purchaseCost',public.canonical_imported_material_calibration_metric(observations,'purchaseCost'));
 eligible_count:=public.canonical_imported_material_calibration_eligible_count(metrics_value);
 manifest:=jsonb_build_object('sourceKey',source_value,'serviceKey',service_value,
  'sourceConsent',jsonb_build_object('id',source_consent.id,'revision',source_consent.revision,'digest',rtrim(source_consent.canonical_digest)),
  'quantityConsent',jsonb_build_object('id',quantity_consent.id,'revision',quantity_consent.revision,'digest',rtrim(quantity_consent.canonical_digest)),
  'costConsent',jsonb_build_object('id',cost_consent.id,'revision',cost_consent.revision,'digest',rtrim(cost_consent.canonical_digest)),
  'observations',observations);
 digest_value:=public.canonical_completion_digest(manifest);
 RETURN jsonb_build_object('sampleManifest',manifest,'sampleDigest',digest_value,'sampleSize',jsonb_array_length(observations),
  'staleExcludedCount',candidate_total-fresh_total,'metrics',metrics_value,'eligibleMetricCount',eligible_count,
  'evidenceBoundary','Total material use, waste, unit cost, purchased quantity and purchase cost are calibrated independently from five to 100 current reviewed same-service jobs. Every job has equal weight through a median of its complete comparable plan lines. Units, plan shape and currency must already match; no conversion or missing value is inferred. Raw median and quartile statistics are retained. A multiplier is offered only inside the inclusive 0.25 to 4.00 review range. Vendor lineage and recorded inventory balance are not calibrated because they do not establish a numeric future baseline or current availability.',
  'adoptionBoundary','Review the cited jobs before changing future material or purchasing assumptions. No estimate, price, material plan, job, purchase, vendor, inventory record, stock balance, reservation, schedule or business policy was changed.');
END $$;

CREATE FUNCTION public.canonical_imported_material_calibration_masked_metrics(value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('totalUse',(value->'totalUse')||jsonb_build_object('advisoryAvailable',FALSE,'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL),
  'waste',(value->'waste')||jsonb_build_object('advisoryAvailable',FALSE,'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL),
  'unitCost',(value->'unitCost')||jsonb_build_object('advisoryAvailable',FALSE,'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL),
  'purchaseQuantity',(value->'purchaseQuantity')||jsonb_build_object('advisoryAvailable',FALSE,'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL),
  'purchaseCost',(value->'purchaseCost')||jsonb_build_object('advisoryAvailable',FALSE,'proposedMultiplier',NULL,'advisoryCode',NULL,'advisoryMessage',NULL))
$$;

CREATE FUNCTION public.canonical_imported_material_calibration_projection(value public.canonical_external_material_calibration_proposals)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceKey',value.source_key,'serviceKey',value.service_key,
  'revision',value.revision,'previousId',value.previous_id,'consent',jsonb_build_object('id',value.consent_id,
   'revision',value.consent_revision,'digest',rtrim(value.consent_digest)),'sampleManifest',value.sample_manifest,
  'sampleDigest',rtrim(value.sample_digest),'sampleSize',value.sample_size,'staleExcludedCount',value.stale_excluded_count,
  'metrics',value.metrics,'eligibleMetricCount',value.eligible_metric_count,'evidenceBoundary',value.evidence_boundary,
  'adoptionBoundary',value.adoption_boundary,'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,
  'calculationVersion',value.calculation_version,'reason',value.reason,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_imported_material_calibration_hidden_projection(value public.canonical_external_material_calibration_proposals)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'serviceKey',value.service_key,'revision',value.revision,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at,'hiddenByConsent',TRUE,
  'fresh',FALSE,'advisoryAvailable',FALSE)
$$;

CREATE FUNCTION public.canonical_imported_material_calibration_propose(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,source_value TEXT,service_value TEXT,expected_consent_revision BIGINT,
 expected_consent_digest TEXT,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_external_material_calibration_consents%ROWTYPE;
 source_consent public.canonical_external_material_import_consents%ROWTYPE;
 quantity_consent public.canonical_external_material_outcome_consents%ROWTYPE;
 cost_consent public.canonical_external_material_cost_consents%ROWTYPE;
 current_row public.canonical_external_material_calibration_proposals%ROWTYPE;
 replay_row public.canonical_external_material_calibration_proposals%ROWTYPE;
 inserted public.canonical_external_material_calibration_proposals%ROWTYPE;
 basis JSONB; next_revision BIGINT; key_hash TEXT; request_hash TEXT; digest_value TEXT; replay_fresh BOOLEAN; active_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported material calibration review is restricted' USING ERRCODE='42501'; END IF;
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR service_value IS NULL
  OR service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR expected_consent_revision IS NULL OR expected_consent_revision NOT BETWEEN 1 AND 10000
  OR expected_consent_digest IS NULL OR expected_consent_digest!~'^[0-9a-f]{64}$'
  OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE
  OR confirmation_version_value IS DISTINCT FROM 'm25-imported-material-calibration-proposal-v1' THEN
  RAISE EXCEPTION 'Imported material calibration proposal input invalid' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,
   'sourceKey',source_value,'serviceKey',service_value,'consentRevision',expected_consent_revision,
   'consentDigest',expected_consent_digest,'reason',reason_value,'confirmed',confirmed_value,
   'confirmationVersion',confirmation_version_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':imported-material-calibration:'||source_value||':'||service_value,0));
 SELECT * INTO consent_row FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_calibration_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO quantity_consent FROM public.canonical_external_material_outcome_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO cost_consent FROM public.canonical_external_material_cost_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_cost_vendor_availability_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO source_consent FROM public.canonical_external_material_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR SHARE;
 SELECT * INTO replay_row FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
   AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
   IF rtrim(replay_row.request_digest)<>request_hash THEN RAISE EXCEPTION 'Imported material calibration key conflict' USING ERRCODE='23505'; END IF;
   active_value:=source_consent.id IS NOT NULL AND source_consent.action='grant' AND quantity_consent.id IS NOT NULL
    AND quantity_consent.action='grant' AND quantity_consent.source_consent_id=source_consent.id
    AND rtrim(quantity_consent.source_consent_digest)=rtrim(source_consent.canonical_digest)
    AND cost_consent.id IS NOT NULL AND cost_consent.action='grant' AND cost_consent.source_consent_id=source_consent.id
    AND rtrim(cost_consent.source_consent_digest)=rtrim(source_consent.canonical_digest)
    AND consent_row.id IS NOT NULL AND consent_row.action='grant' AND consent_row.quantity_consent_id=quantity_consent.id
    AND rtrim(consent_row.quantity_consent_digest)=rtrim(quantity_consent.canonical_digest)
    AND consent_row.cost_consent_id=cost_consent.id AND rtrim(consent_row.cost_consent_digest)=rtrim(cost_consent.canonical_digest)
    AND replay_row.consent_id=consent_row.id;
   IF NOT active_value THEN
    RETURN jsonb_build_object('proposal',public.canonical_imported_material_calibration_hidden_projection(replay_row),'replayed',TRUE);
   END IF;
   BEGIN basis:=public.canonical_imported_material_calibration_basis(org,source_value,service_value);
    replay_fresh:=rtrim(replay_row.sample_digest)=basis->>'sampleDigest' AND replay_row.consent_id=consent_row.id
     AND consent_row.action='grant';
   EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;replay_fresh:=FALSE; END;
   RETURN jsonb_build_object('proposal',public.canonical_imported_material_calibration_projection(replay_row)||jsonb_build_object(
     'fresh',replay_fresh,'advisoryAvailable',replay_fresh AND replay_row.eligible_metric_count>0,
     'metrics',CASE WHEN replay_fresh THEN replay_row.metrics
      ELSE public.canonical_imported_material_calibration_masked_metrics(replay_row.metrics) END),
    'replayed',TRUE);
 END IF;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant'
  OR quantity_consent.id IS NULL OR quantity_consent.action<>'grant'
  OR quantity_consent.source_consent_id<>source_consent.id
  OR rtrim(quantity_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR cost_consent.id IS NULL OR cost_consent.action<>'grant' OR cost_consent.source_consent_id<>source_consent.id
  OR rtrim(cost_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR consent_row.quantity_consent_id<>quantity_consent.id
  OR rtrim(consent_row.quantity_consent_digest)<>rtrim(quantity_consent.canonical_digest)
  OR consent_row.cost_consent_id<>cost_consent.id
  OR rtrim(consent_row.cost_consent_digest)<>rtrim(cost_consent.canonical_digest)
  OR consent_row.revision<>expected_consent_revision
  OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM expected_consent_digest THEN
  RAISE EXCEPTION 'Active material and purchasing calibration consent changed' USING ERRCODE='40001',CONSTRAINT='imported_material_calibration_consent_stale'; END IF;
 basis:=public.canonical_imported_material_calibration_basis(org,source_value,service_value);
 SELECT * INTO replay_row FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value AND sample_digest=(basis->>'sampleDigest')::char(64)
  AND consent_id=consent_row.id;
 IF FOUND THEN RAISE EXCEPTION 'The current material and purchasing calibration was already proposed'
  USING ERRCODE='22023',CONSTRAINT='imported_material_calibration_already_current'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,
  'serviceKey',service_value,'revision',next_revision,'previousId',current_row.id,'consentId',consent_row.id,
  'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),
   'sampleDigest',basis->>'sampleDigest','sampleSize',basis->>'sampleSize','staleExcludedCount',basis->>'staleExcludedCount',
   'metrics',basis->'metrics','eligibleMetricCount',basis->>'eligibleMetricCount','actorUserId',actor,'confirmed',confirmed_value,
  'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_external_material_calibration_proposals(organization_id,source_key,service_key,revision,
  previous_id,consent_id,consent_revision,consent_digest,sample_manifest,sample_digest,sample_size,stale_excluded_count,
  metrics,eligible_metric_count,evidence_boundary,adoption_boundary,actor_user_id,membership_id,auth_session_id,
  reason,confirmed,confirmation_version,calculation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,service_value,next_revision,current_row.id,consent_row.id,consent_row.revision,
  rtrim(consent_row.canonical_digest),basis->'sampleManifest',basis->>'sampleDigest',(basis->>'sampleSize')::integer,
  (basis->>'staleExcludedCount')::integer,basis->'metrics',(basis->>'eligibleMetricCount')::integer,
  basis->>'evidenceBoundary',basis->>'adoptionBoundary',actor,(authority->>'membershipId')::uuid,session_value,
  reason_value,confirmed_value,confirmation_version_value,'m25-imported-material-median-calibration-v1',
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('proposal',public.canonical_imported_material_calibration_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_imported_material_calibration_read(org UUID,actor UUID,role_value TEXT,session_value UUID,
 source_value TEXT,service_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_material_calibration_consents%ROWTYPE;
 source_consent public.canonical_external_material_import_consents%ROWTYPE;
 quantity_consent public.canonical_external_material_outcome_consents%ROWTYPE;
 cost_consent public.canonical_external_material_cost_consents%ROWTYPE;
 current_row public.canonical_external_material_calibration_proposals%ROWTYPE; basis JSONB; fresh BOOLEAN;
 history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Imported material calibration review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR service_value IS NULL
  OR service_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'Imported material calibration identity invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO consent_row FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_calibration_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO quantity_consent FROM public.canonical_external_material_outcome_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO cost_consent FROM public.canonical_external_material_cost_consents WHERE organization_id=org
  AND source_key=source_value AND purpose='imported_material_cost_vendor_availability_v1' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO source_consent FROM public.canonical_external_material_import_consents WHERE organization_id=org
  AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF source_consent.id IS NULL OR source_consent.action<>'grant' OR consent_row.id IS NULL OR consent_row.action<>'grant'
  OR quantity_consent.id IS NULL OR quantity_consent.action<>'grant'
  OR quantity_consent.source_consent_id<>source_consent.id
  OR rtrim(quantity_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR cost_consent.id IS NULL OR cost_consent.action<>'grant' OR cost_consent.source_consent_id<>source_consent.id
  OR rtrim(cost_consent.source_consent_digest)<>rtrim(source_consent.canonical_digest)
  OR consent_row.quantity_consent_id<>quantity_consent.id
  OR rtrim(consent_row.quantity_consent_digest)<>rtrim(quantity_consent.canonical_digest)
  OR consent_row.cost_consent_id<>cost_consent.id
  OR rtrim(consent_row.cost_consent_digest)<>rtrim(cost_consent.canonical_digest) THEN
  RETURN jsonb_build_object('sourceKey',source_value,
  'serviceKey',service_value,'activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,
  'blockedReason','Current material and purchasing calibration consent is required.'); END IF;
 SELECT * INTO current_row FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('sourceKey',source_value,'serviceKey',service_value,'activeConsent',TRUE,
  'consent',public.canonical_imported_material_calibration_consent_projection(consent_row),'current',NULL,'history','[]'::jsonb,
  'total',0,'truncated',FALSE,'refreshRequired',TRUE); END IF;
 BEGIN basis:=public.canonical_imported_material_calibration_basis(org,source_value,service_value);
  fresh:=rtrim(current_row.sample_digest)=basis->>'sampleDigest' AND current_row.consent_id=consent_row.id;
 EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;fresh:=FALSE; END;
 SELECT count(*) INTO total FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value;
 SELECT COALESCE(jsonb_agg(CASE WHEN item.consent_id<>consent_row.id
  THEN public.canonical_imported_material_calibration_hidden_projection(item)
  ELSE public.canonical_imported_material_calibration_projection(item)||jsonb_build_object(
   'fresh',rtrim(item.sample_digest)=COALESCE(basis->>'sampleDigest',''),
   'advisoryAvailable',rtrim(item.sample_digest)=COALESCE(basis->>'sampleDigest','') AND item.eligible_metric_count>0,
   'metrics',CASE WHEN rtrim(item.sample_digest)=COALESCE(basis->>'sampleDigest','') THEN item.metrics
    ELSE public.canonical_imported_material_calibration_masked_metrics(item.metrics) END) END
  ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
  AND source_key=source_value AND service_key=service_value ORDER BY created_at DESC,id DESC LIMIT 20) item;
 RETURN jsonb_build_object('sourceKey',source_value,'serviceKey',service_value,'activeConsent',TRUE,
  'consent',public.canonical_imported_material_calibration_consent_projection(consent_row),
  'current',CASE WHEN current_row.consent_id<>consent_row.id THEN public.canonical_imported_material_calibration_hidden_projection(current_row)
   ELSE public.canonical_imported_material_calibration_projection(current_row)||jsonb_build_object('fresh',fresh,
    'advisoryAvailable',fresh AND current_row.eligible_metric_count>0,'metrics',CASE WHEN fresh THEN current_row.metrics
     ELSE public.canonical_imported_material_calibration_masked_metrics(current_row.metrics) END) END,
  'history',history,'total',total,'truncated',total>20,'refreshRequired',NOT fresh);
END $$;

REVOKE ALL ON TABLE public.canonical_external_material_calibration_consents,
 public.canonical_external_material_calibration_proposals FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_metric_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_metrics_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_eligible_count(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_consent_projection(public.canonical_external_material_calibration_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_job_metrics(JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_metric(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_basis(UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_masked_metrics(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_projection(public.canonical_external_material_calibration_proposals) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_hidden_projection(public.canonical_external_material_calibration_proposals) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_consent_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_propose(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_imported_material_calibration_read(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
