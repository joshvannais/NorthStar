-- Mission 25 Part 10 Slice A: tenant-private native vehicle/equipment utilization outcomes.
-- Recorded checkout duration is compared with adopted equipment-plan hours. It is not engine-on time,
-- productive time, operating cost, maintenance cost, or an automatic estimate/policy mutation.

CREATE TABLE public.canonical_equipment_learning_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose='native_equipment_checkout_variance_v1'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["canonical_completion_records","canonical_equipment_asset_versions","canonical_equipment_cost_plans","canonical_equipment_events","canonical_equipment_plans","canonical_estimate_revisions","canonical_estimates","canonical_field_executions","tenant_assets"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-native-equipment-utilization-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,purpose,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_equipment_learning_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);
CREATE TRIGGER canonical_equipment_learning_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_equipment_learning_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_equipment_learning_consent_projection(value public.canonical_equipment_learning_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'purpose',value.purpose,'revision',value.revision,
  'previousId',value.previous_id,'action',value.action,'sourceScope',value.source_scope,
  'consentVersion',value.consent_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_equipment_learning_consent_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_equipment_learning_consents%ROWTYPE; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Equipment learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO current_row FROM public.canonical_equipment_learning_consents
  WHERE organization_id=org AND purpose='native_equipment_checkout_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_equipment_learning_consents
  WHERE organization_id=org AND purpose='native_equipment_checkout_variance_v1';
 SELECT COALESCE(jsonb_agg(public.canonical_equipment_learning_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_equipment_learning_consents WHERE organization_id=org
   AND purpose='native_equipment_checkout_variance_v1' ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_equipment_learning_consent_projection(current_row) END,
  'active',COALESCE(current_row.action='grant',FALSE),'history',history,'total',total,'truncated',total>20);
END $$;

CREATE FUNCTION public.canonical_equipment_learning_consent_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_equipment_learning_consents%ROWTYPE;
 old public.canonical_equipment_learning_consents%ROWTYPE; inserted public.canonical_equipment_learning_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; digest_value TEXT;
 scope_value JSONB:='["canonical_completion_records","canonical_equipment_asset_versions","canonical_equipment_cost_plans","canonical_equipment_events","canonical_equipment_plans","canonical_estimate_revisions","canonical_estimates","canonical_field_executions","tenant_assets"]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Equipment learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string'
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-native-equipment-utilization-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Equipment learning consent input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':native-equipment-learning-consent',0));
 SELECT * INTO old FROM public.canonical_equipment_learning_consents
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'Equipment learning consent key conflict' USING ERRCODE='23505'; END IF;
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('consent',public.canonical_equipment_learning_consent_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_equipment_learning_consents WHERE organization_id=org
  AND purpose='native_equipment_checkout_variance_v1' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Equipment learning consent changed' USING ERRCODE='40001',CONSTRAINT='equipment_learning_consent_stale'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN
  RAISE EXCEPTION 'No active equipment learning consent' USING ERRCODE='22023'; END IF;
 IF body->>'action'='grant' AND current_row.action='grant' THEN
  RAISE EXCEPTION 'Equipment learning consent is already active' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'purpose','native_equipment_checkout_variance_v1',
  'revision',next_revision,'previousId',current_row.id,'action',body->>'action','actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,
  'consentVersion','m25-native-equipment-utilization-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_equipment_learning_consents(organization_id,purpose,revision,previous_id,action,
  actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,'native_equipment_checkout_variance_v1',next_revision,current_row.id,body->>'action',actor,
  (authority->>'membershipId')::uuid,session_value,scope_value,'m25-native-equipment-utilization-consent-v1',body->>'reason',
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_equipment_learning_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_native_equipment_utilization_basis(org UUID,estimate UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE estimate_row public.canonical_estimates%ROWTYPE; revision_row public.canonical_estimate_revisions%ROWTYPE;
 cost_row public.canonical_equipment_cost_plans%ROWTYPE; plan_row public.canonical_equipment_plans%ROWTYPE;
 execution_row public.canonical_field_executions%ROWTYPE; completion_row public.canonical_completion_records%ROWTYPE;
 cost_line JSONB; plan_line JSONB; evidence_line JSONB; event_row public.canonical_equipment_events%ROWTYPE;
 asset_row public.tenant_assets%ROWTYPE; asset_pin public.canonical_equipment_asset_versions%ROWTYPE;
 line_events JSONB; lines_value JSONB:='[]'::jsonb; source_value JSONB; seen_assets UUID[]:=ARRAY[]::uuid[];
 asset_value UUID; checkout_at TIMESTAMPTZ; observed_at TIMESTAMPTZ; planned NUMERIC; recorded NUMERIC;
 planned_total NUMERIC:=0; recorded_total NUMERIC:=0; seconds_value NUMERIC; pair_count INTEGER; variance NUMERIC; variance_percent NUMERIC;
 code TEXT; message TEXT; event_count INTEGER:=0;
BEGIN
 SELECT * INTO estimate_row FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO revision_row FROM public.canonical_estimate_revisions WHERE organization_id=org
  AND estimate_id=estimate AND equipment_cost_plan_id IS NOT NULL ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted equipment plan is required' USING ERRCODE='P0002',CONSTRAINT='native_equipment_plan_unavailable'; END IF;
 SELECT * INTO cost_row FROM public.canonical_equipment_cost_plans WHERE organization_id=org AND estimate_id=estimate
  AND id=revision_row.equipment_cost_plan_id AND action='save';
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted equipment plan is required' USING ERRCODE='P0002',CONSTRAINT='native_equipment_plan_unavailable'; END IF;
 SELECT * INTO plan_row FROM public.canonical_equipment_plans WHERE organization_id=org AND estimate_id=estimate
  AND id=(cost_row.inputs#>>'{equipmentBasis,planId}')::uuid AND revision=(cost_row.inputs#>>'{equipmentBasis,revision}')::bigint
  AND digest=cost_row.inputs#>>'{equipmentBasis,digest}' AND action='save';
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted equipment plan is required' USING ERRCODE='P0002',CONSTRAINT='native_equipment_plan_unavailable'; END IF;
 SELECT * INTO execution_row FROM public.canonical_field_executions WHERE organization_id=org
  AND opportunity_id=estimate_row.opportunity_id ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND OR execution_row.lifecycle_state<>'completed' THEN
  RAISE EXCEPTION 'Completed work is required' USING ERRCODE='P0002',CONSTRAINT='native_equipment_completion_unavailable'; END IF;
 SELECT * INTO completion_row FROM public.canonical_completion_records WHERE organization_id=org
  AND execution_id=execution_row.id AND lifecycle_after='completed' ORDER BY decided_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completed work is required' USING ERRCODE='P0002',CONSTRAINT='native_equipment_completion_unavailable'; END IF;

 FOR cost_line IN SELECT value FROM jsonb_array_elements(cost_row.inputs->'lines') LOOP
  IF cost_line->'plannedHours' IS NULL OR cost_line->'plannedHours'='null'::jsonb THEN CONTINUE; END IF;
  planned:=(cost_line->>'plannedHours')::numeric;
  IF planned<=0 THEN CONTINUE; END IF;
  SELECT value INTO plan_line FROM jsonb_array_elements(plan_row.inputs->'lines') WHERE value->>'lineId'=cost_line->>'lineId';
   SELECT value INTO evidence_line FROM jsonb_array_elements(plan_row.evidence->'assets') WHERE value->>'id'=plan_line->>'assetId';
   IF plan_line IS NULL OR plan_line->>'assetId' IS NULL OR evidence_line->>'id' IS DISTINCT FROM plan_line->>'assetId' THEN
   RAISE EXCEPTION 'Reviewed native asset is required for every planned equipment line'
    USING ERRCODE='P0002',CONSTRAINT='native_equipment_asset_unavailable'; END IF;
  asset_value:=(plan_line->>'assetId')::uuid;
  IF asset_value=ANY(seen_assets) THEN RAISE EXCEPTION 'One native asset cannot represent multiple planned equipment lines'
    USING ERRCODE='P0002',CONSTRAINT='native_equipment_asset_duplicated'; END IF;
  seen_assets:=array_append(seen_assets,asset_value);
  SELECT * INTO asset_row FROM public.tenant_assets WHERE organization_id=org AND id=asset_value;
  SELECT * INTO asset_pin FROM public.canonical_equipment_asset_versions WHERE organization_id=org AND asset_id=asset_value
    AND asset_version=(evidence_line->>'version')::integer AND asset_digest=evidence_line->>'assetDigest';
  IF asset_row.id IS NULL OR asset_row.catalogue_state<>'active' OR asset_pin.asset_id IS NULL OR asset_pin.review_state<>'reviewed'
   OR asset_row.version<>asset_pin.asset_version OR public.equipment_digest(to_jsonb(asset_row))<>asset_pin.asset_digest THEN
   RAISE EXCEPTION 'Reviewed native asset changed' USING ERRCODE='P0002',CONSTRAINT='native_equipment_asset_unavailable'; END IF;
  checkout_at:=NULL; seconds_value:=0; pair_count:=0; line_events:='[]'::jsonb;
  FOR event_row IN SELECT event_value.* FROM public.canonical_equipment_events event_value
   WHERE event_value.organization_id=org AND event_value.execution_id=execution_row.id AND event_value.asset_id=asset_value
    AND NOT EXISTS(SELECT 1 FROM public.canonical_equipment_events newer WHERE newer.organization_id=event_value.organization_id
      AND newer.supersedes_id=event_value.id)
   ORDER BY (event_value.document->>'observedAt')::timestamptz,event_value.revision,event_value.id
  LOOP
   IF event_row.asset_version<>asset_pin.asset_version OR event_row.asset_digest<>asset_pin.asset_digest THEN
    RAISE EXCEPTION 'Recorded asset version does not match the adopted plan'
     USING ERRCODE='P0002',CONSTRAINT='native_equipment_asset_unavailable'; END IF;
   observed_at:=(event_row.document->>'observedAt')::timestamptz;
   IF event_row.document->>'kind'='check_out' THEN
    IF checkout_at IS NOT NULL THEN RAISE EXCEPTION 'Equipment checkout records overlap'
     USING ERRCODE='P0002',CONSTRAINT='native_equipment_utilization_incomplete'; END IF;
    checkout_at:=observed_at;
   ELSIF event_row.document->>'kind' IN ('use','check_in') AND checkout_at IS NULL THEN
    RAISE EXCEPTION 'Equipment utilization records are incomplete'
     USING ERRCODE='P0002',CONSTRAINT='native_equipment_utilization_incomplete';
   ELSIF event_row.document->>'kind'='check_in' THEN
    IF observed_at<=checkout_at THEN RAISE EXCEPTION 'Equipment checkout duration is invalid'
     USING ERRCODE='P0002',CONSTRAINT='native_equipment_utilization_incomplete'; END IF;
    seconds_value:=seconds_value+extract(epoch FROM observed_at-checkout_at);pair_count:=pair_count+1;checkout_at:=NULL;
   END IF;
   IF event_row.document->>'kind' IN ('check_out','use','check_in') THEN
    event_count:=event_count+1;
    IF event_count>500 THEN RAISE EXCEPTION 'Equipment utilization evidence limit reached'
     USING ERRCODE='54000',CONSTRAINT='native_equipment_evidence_limit'; END IF;
    line_events:=line_events||jsonb_build_array(jsonb_build_object('id',event_row.id,'rootId',event_row.root_id,
     'supersedesId',event_row.supersedes_id,'revision',event_row.revision,'digest',event_row.digest,
     'kind',event_row.document->>'kind','observedAt',event_row.document->>'observedAt',
     'assetVersion',event_row.asset_version,'assetDigest',event_row.asset_digest));
   END IF;
  END LOOP;
  IF checkout_at IS NOT NULL OR pair_count=0 OR seconds_value<=0 THEN
   RAISE EXCEPTION 'Complete equipment check-out and check-in records are required'
    USING ERRCODE='P0002',CONSTRAINT='native_equipment_utilization_incomplete'; END IF;
  recorded:=round(seconds_value/3600,4);variance:=round(recorded-planned,4);variance_percent:=round((variance/planned)*100,2);
  IF abs(variance_percent)<=5 THEN code:='within_expected_range';message:='Recorded checkout hours were within 5% of planned equipment hours.';
  ELSIF variance_percent>0 THEN code:='actual_above_plan';message:='Recorded checkout hours were higher than planned equipment hours.';
  ELSE code:='actual_below_plan';message:='Recorded checkout hours were lower than planned equipment hours.';END IF;
  planned_total:=planned_total+planned;recorded_total:=recorded_total+recorded;
  lines_value:=lines_value||jsonb_build_array(jsonb_build_object('lineId',cost_line->>'lineId','task',plan_line->>'task',
   'asset',jsonb_build_object('id',asset_row.id,'name',asset_row.name,'category',asset_row.category,
     'version',asset_pin.asset_version,'digest',asset_pin.asset_digest),
   'plannedHours',planned::text,'recordedCheckoutHours',recorded::text,'varianceHours',variance::text,
   'variancePercent',variance_percent::text,'advisoryCode',code,'advisoryMessage',message,
   'checkoutPairs',pair_count,'events',line_events));
 END LOOP;
 IF jsonb_array_length(lines_value)=0 THEN RAISE EXCEPTION 'Planned native equipment hours are required'
  USING ERRCODE='P0002',CONSTRAINT='native_equipment_plan_unavailable'; END IF;
 variance:=round(recorded_total-planned_total,4);variance_percent:=round((variance/planned_total)*100,2);
 IF abs(variance_percent)<=5 THEN code:='within_expected_range';message:='Recorded checkout hours were within 5% of planned equipment hours.';
 ELSIF variance_percent>0 THEN code:='actual_above_plan';message:='Recorded checkout hours were higher than planned equipment hours.';
 ELSE code:='actual_below_plan';message:='Recorded checkout hours were lower than planned equipment hours.';END IF;
 source_value:=jsonb_build_object(
  'estimate',jsonb_build_object('id',estimate_row.id,'digest',rtrim(estimate_row.snapshot_digest)),
  'estimateRevision',jsonb_build_object('id',revision_row.id,'revision',revision_row.revision,'digest',revision_row.digest),
  'equipmentPlan',jsonb_build_object('id',plan_row.id,'revision',plan_row.revision,'digest',plan_row.digest),
  'equipmentCostPlan',jsonb_build_object('id',cost_row.id,'revision',cost_row.revision,'digest',cost_row.digest),
  'execution',jsonb_build_object('id',execution_row.id,'revision',execution_row.revision,'digest',rtrim(execution_row.canonical_digest)),
  'completion',jsonb_build_object('id',completion_row.id,'revision',completion_row.revision,'digest',rtrim(completion_row.canonical_digest)),
  'lines',lines_value);
 RETURN jsonb_build_object('sourceManifest',source_value,'sourceDigest',public.canonical_completion_digest(source_value),
  'plannedHours',round(planned_total,4)::text,'recordedCheckoutHours',round(recorded_total,4)::text,
  'varianceHours',variance::text,'variancePercent',variance_percent::text,'advisoryCode',code,'advisoryMessage',message,
  'scopeNote','Recorded checkout hours measure complete NorthStar check-out to check-in intervals for the exact adopted assets. They do not prove engine-on time, productive use, fuel burn, operating cost, maintenance cost or condition.',
  'adoptionBoundary','Review this evidence before changing future equipment assumptions. No estimate, price, schedule, asset record, cost allocation or business policy was changed.');
END $$;

CREATE TABLE public.canonical_native_equipment_utilization_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 estimate_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 consent_id UUID NOT NULL, consent_revision BIGINT NOT NULL, consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='object' AND octet_length(source_manifest::text)<=262144),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 planned_hours NUMERIC(14,4) NOT NULL CHECK(planned_hours>0), recorded_checkout_hours NUMERIC(14,4) NOT NULL CHECK(recorded_checkout_hours>0),
 variance_hours NUMERIC(14,4) NOT NULL, variance_percent NUMERIC(12,2) NOT NULL,
 advisory_code TEXT NOT NULL CHECK(advisory_code IN ('within_expected_range','actual_above_plan','actual_below_plan')),
 advisory_message TEXT NOT NULL CHECK(public.canonical_learning_text_valid(advisory_message,500)),
 scope_note TEXT NOT NULL CHECK(public.canonical_learning_text_valid(scope_note,1000)),
 adoption_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(adoption_boundary,1000)),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)), confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-native-equipment-utilization-observation-v1'),
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-native-equipment-utilization-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,estimate_id,revision), UNIQUE(organization_id,estimate_id,source_digest,consent_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_native_equipment_utilization_observations(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,consent_id) REFERENCES public.canonical_equipment_learning_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(public.canonical_field_evidence_object_keys_exact(source_manifest,
  ARRAY['estimate','estimateRevision','equipmentPlan','equipmentCostPlan','execution','completion','lines'])),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(source_manifest)),
 CHECK(recorded_checkout_hours-planned_hours=variance_hours),
 CHECK(variance_percent=round((variance_hours/planned_hours)*100,2)),
 CHECK(advisory_code=CASE WHEN abs(variance_percent)<=5 THEN 'within_expected_range'
  WHEN variance_percent>0 THEN 'actual_above_plan' ELSE 'actual_below_plan' END)
);
CREATE TRIGGER canonical_native_equipment_utilization_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_native_equipment_utilization_observations FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_native_equipment_utilization_projection(value public.canonical_native_equipment_utilization_observations)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'estimateId',value.estimate_id,'revision',value.revision,'previousId',value.previous_id,
  'consentId',value.consent_id,'consentRevision',value.consent_revision,'consentDigest',rtrim(value.consent_digest),
  'sourceManifest',value.source_manifest,'sourceDigest',rtrim(value.source_digest),'plannedHours',value.planned_hours::text,
  'recordedCheckoutHours',value.recorded_checkout_hours::text,'varianceHours',value.variance_hours::text,
  'variancePercent',value.variance_percent::text,'advisoryCode',value.advisory_code,'advisoryMessage',value.advisory_message,
  'scopeNote',value.scope_note,'adoptionBoundary',value.adoption_boundary,'reason',value.reason,'confirmed',value.confirmed,
  'confirmationVersion',value.confirmation_version,'calculationVersion',value.calculation_version,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_native_equipment_utilization_observe(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,estimate UUID,expected_consent_revision BIGINT,expected_consent_digest TEXT,
 reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_equipment_learning_consents%ROWTYPE;
 current_row public.canonical_native_equipment_utilization_observations%ROWTYPE;
 old public.canonical_native_equipment_utilization_observations%ROWTYPE;
 inserted public.canonical_native_equipment_utilization_observations%ROWTYPE; basis JSONB;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Equipment learning review is restricted' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR expected_consent_revision NOT BETWEEN 1 AND 10000
  OR expected_consent_digest!~'^[0-9a-f]{64}$' OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE
  OR confirmed_value IS DISTINCT FROM TRUE OR confirmation_version_value<>'m25-native-equipment-utilization-observation-v1' THEN
  RAISE EXCEPTION 'Equipment utilization observation input invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':native-equipment-utilization:'||estimate::text,0));
 SELECT * INTO consent_row FROM public.canonical_equipment_learning_consents WHERE organization_id=org
  AND purpose='native_equipment_checkout_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF NOT FOUND OR consent_row.action<>'grant' OR consent_row.revision<>expected_consent_revision
  OR rtrim(consent_row.canonical_digest)<>expected_consent_digest THEN
  RAISE EXCEPTION 'Equipment learning consent changed' USING ERRCODE='40001',CONSTRAINT='equipment_learning_consent_stale'; END IF;
 basis:=public.canonical_native_equipment_utilization_basis(org,estimate);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'estimateId',estimate,
  'consentId',consent_row.id,'consentRevision',expected_consent_revision,'consentDigest',expected_consent_digest,
  'sourceDigest',basis->>'sourceDigest','reason',reason_value,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value));
 SELECT * INTO old FROM public.canonical_native_equipment_utilization_observations
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'Equipment learning key conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('observation',public.canonical_native_equipment_utilization_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_native_equipment_utilization_observations
  WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF current_row.id IS NOT NULL AND rtrim(current_row.source_digest)=basis->>'sourceDigest' AND current_row.consent_id=consent_row.id THEN
  RAISE EXCEPTION 'Current equipment utilization is already observed' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'estimateId',estimate,'revision',next_revision,
  'previousId',current_row.id,'consentId',consent_row.id,'consentRevision',consent_row.revision,
  'consentDigest',rtrim(consent_row.canonical_digest),'sourceDigest',basis->>'sourceDigest','plannedHours',basis->>'plannedHours',
  'recordedCheckoutHours',basis->>'recordedCheckoutHours','varianceHours',basis->>'varianceHours','variancePercent',basis->>'variancePercent',
  'advisoryCode',basis->>'advisoryCode','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,
  'confirmed',confirmed_value,'reason',reason_value,'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_native_equipment_utilization_observations(organization_id,estimate_id,revision,previous_id,
  consent_id,consent_revision,consent_digest,source_manifest,source_digest,planned_hours,recorded_checkout_hours,
  variance_hours,variance_percent,advisory_code,advisory_message,scope_note,adoption_boundary,
  actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,calculation_version,
  request_key_hash,request_digest,canonical_digest)
 VALUES(org,estimate,next_revision,current_row.id,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),
  basis->'sourceManifest',basis->>'sourceDigest',(basis->>'plannedHours')::numeric,(basis->>'recordedCheckoutHours')::numeric,
  (basis->>'varianceHours')::numeric,(basis->>'variancePercent')::numeric,basis->>'advisoryCode',basis->>'advisoryMessage',
  basis->>'scopeNote',basis->>'adoptionBoundary',actor,(authority->>'membershipId')::uuid,session_value,reason_value,
  confirmed_value,confirmation_version_value,'m25-native-equipment-utilization-v1',key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('observation',public.canonical_native_equipment_utilization_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_native_equipment_utilization_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_equipment_learning_consents%ROWTYPE;
 current_row public.canonical_native_equipment_utilization_observations%ROWTYPE; basis JSONB; fresh BOOLEAN; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Equipment learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO consent_row FROM public.canonical_equipment_learning_consents WHERE organization_id=org
  AND purpose='native_equipment_checkout_variance_v1' ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR consent_row.action<>'grant' THEN RETURN jsonb_build_object('activeConsent',FALSE,'current',NULL,
  'history','[]'::jsonb,'total',0,'truncated',FALSE,'blockedReason','Equipment utilization learning consent is not active.'); END IF;
 SELECT * INTO current_row FROM public.canonical_native_equipment_utilization_observations WHERE organization_id=org
  AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('activeConsent',TRUE,'consent',public.canonical_equipment_learning_consent_projection(consent_row),
  'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'refreshRequired',TRUE); END IF;
 BEGIN basis:=public.canonical_native_equipment_utilization_basis(org,estimate);
  fresh:=rtrim(current_row.source_digest)=basis->>'sourceDigest' AND current_row.consent_id=consent_row.id;
 EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;fresh:=FALSE; END;
 SELECT count(*) INTO total FROM public.canonical_native_equipment_utilization_observations WHERE organization_id=org AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(public.canonical_native_equipment_utilization_projection(item)||jsonb_build_object(
   'fresh',rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id,
   'advisoryAvailable',rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id,
   'advisoryCode',CASE WHEN rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id THEN item.advisory_code ELSE NULL END,
   'advisoryMessage',CASE WHEN rtrim(item.source_digest)=COALESCE(basis->>'sourceDigest','') AND item.consent_id=consent_row.id THEN item.advisory_message ELSE NULL END)
   ORDER BY revision DESC),'[]'::jsonb) INTO history
  FROM (SELECT * FROM public.canonical_native_equipment_utilization_observations WHERE organization_id=org
   AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('activeConsent',TRUE,'consent',public.canonical_equipment_learning_consent_projection(consent_row),
  'current',public.canonical_native_equipment_utilization_projection(current_row)||jsonb_build_object('fresh',fresh,
   'advisoryAvailable',fresh,'advisoryCode',CASE WHEN fresh THEN current_row.advisory_code ELSE NULL END,
   'advisoryMessage',CASE WHEN fresh THEN current_row.advisory_message ELSE NULL END),
  'history',history,'total',total,'truncated',total>20,'refreshRequired',NOT fresh);
END $$;

REVOKE ALL ON TABLE public.canonical_equipment_learning_consents,public.canonical_native_equipment_utilization_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_learning_consent_projection(public.canonical_equipment_learning_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_equipment_utilization_basis(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_equipment_utilization_projection(public.canonical_native_equipment_utilization_observations) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_learning_consent_read(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_equipment_learning_consent_mutate(uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_equipment_utilization_observe(uuid,uuid,text,uuid,text,text,uuid,bigint,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_equipment_utilization_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
