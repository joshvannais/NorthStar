-- Mission 25 Part 11 Slice A: tenant-private native planned-versus-used material outcomes.
-- Exact reviewed NorthStar consumption and waste evidence is compared with one adopted material plan.
-- No names are matched, units converted, stock inferred, costs valued, purchase/vendor facts created,
-- or estimate, job, inventory, price, schedule, payroll or business policy changed.

CREATE TABLE public.canonical_material_learning_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose='native_material_quantity_variance_v1'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 source_scope JSONB NOT NULL CHECK(source_scope='["canonical_completion_records","canonical_estimate_revisions","canonical_estimates","canonical_field_executions","canonical_material_movements","canonical_material_plans"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-native-material-outcome-consent-v1'),
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,purpose,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_material_learning_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);
CREATE TRIGGER canonical_material_learning_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_material_learning_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_material_learning_consent_projection(value public.canonical_material_learning_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'purpose',value.purpose,'revision',value.revision,'previousId',value.previous_id,
  'action',value.action,'sourceScope',value.source_scope,'consentVersion',value.consent_version,'reason',value.reason,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_material_learning_consent_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_material_learning_consents%ROWTYPE; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Material learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO current_row FROM public.canonical_material_learning_consents WHERE organization_id=org
  AND purpose='native_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_material_learning_consents WHERE organization_id=org AND purpose='native_material_quantity_variance_v1';
 SELECT COALESCE(jsonb_agg(public.canonical_material_learning_consent_projection(item) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_material_learning_consents WHERE organization_id=org
   AND purpose='native_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_material_learning_consent_projection(current_row) END,
  'active',COALESCE(current_row.action='grant',FALSE),'history',history,'total',total,'truncated',total>20);
END $$;

CREATE FUNCTION public.canonical_material_learning_consent_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_material_learning_consents%ROWTYPE;
 old public.canonical_material_learning_consents%ROWTYPE; inserted public.canonical_material_learning_consents%ROWTYPE;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; digest_value TEXT;
 scope_value JSONB:='["canonical_completion_records","canonical_estimate_revisions","canonical_estimates","canonical_field_executions","canonical_material_movements","canonical_material_plans"]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Material learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number'
  OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string'
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-native-material-outcome-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
 THEN RAISE EXCEPTION 'Material learning consent input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':native-material-learning-consent',0));
 SELECT * INTO old FROM public.canonical_material_learning_consents WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'Material learning consent key conflict' USING ERRCODE='23505'; END IF;
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('consent',public.canonical_material_learning_consent_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_material_learning_consents WHERE organization_id=org
  AND purpose='native_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0)
  OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN
  RAISE EXCEPTION 'Material learning consent changed' USING ERRCODE='40001',CONSTRAINT='material_learning_consent_stale'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') THEN RAISE EXCEPTION 'No active material learning consent' USING ERRCODE='22023'; END IF;
 IF body->>'action'='grant' AND current_row.action='grant' THEN RAISE EXCEPTION 'Material learning consent is already active' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'purpose','native_material_quantity_variance_v1',
  'revision',next_revision,'previousId',current_row.id,'action',body->>'action','actorUserId',actor,
  'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope',scope_value,
  'consentVersion','m25-native-material-outcome-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_material_learning_consents(organization_id,purpose,revision,previous_id,action,actor_user_id,
  membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,'native_material_quantity_variance_v1',next_revision,current_row.id,body->>'action',actor,
  (authority->>'membershipId')::uuid,session_value,scope_value,'m25-native-material-outcome-consent-v1',body->>'reason',key_hash,request_hash,digest_value)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_material_learning_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_native_material_bindings_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE entry JSONB; line_ids TEXT[]:=ARRAY[]::text[]; item_keys TEXT[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value) NOT BETWEEN 1 AND 20 THEN RETURN FALSE; END IF;
 FOR entry IN SELECT item FROM jsonb_array_elements(value) item LOOP
  IF public.canonical_field_evidence_object_keys_exact(entry,ARRAY['lineId','itemKey']) IS NOT TRUE
   OR jsonb_typeof(entry->'lineId') IS DISTINCT FROM 'string' OR (entry->>'lineId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR jsonb_typeof(entry->'itemKey') IS DISTINCT FROM 'string' OR public.canonical_material_key_valid(entry->>'itemKey') IS NOT TRUE
   OR entry->>'lineId'=ANY(line_ids) OR entry->>'itemKey'=ANY(item_keys) THEN RETURN FALSE; END IF;
  line_ids:=array_append(line_ids,entry->>'lineId'); item_keys:=array_append(item_keys,entry->>'itemKey');
 END LOOP;
 RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_native_material_outcome_basis(org UUID,estimate UUID,execution UUID,bindings JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE estimate_row public.canonical_estimates%ROWTYPE; revision_row public.canonical_estimate_revisions%ROWTYPE;
 plan_row public.canonical_material_plans%ROWTYPE; execution_row public.canonical_field_executions%ROWTYPE;
 completion_row public.canonical_completion_records%ROWTYPE; component JSONB; binding JSONB; plan_line JSONB;
 movement public.canonical_material_movements%ROWTYPE; movements JSONB; result_lines JSONB:='[]'::jsonb;
 source_lines JSONB:='[]'::jsonb; sorted_bindings JSONB; planned NUMERIC; consumed NUMERIC; wasted NUMERIC; used NUMERIC;
 variance NUMERIC; percent_value NUMERIC; plan_count INTEGER; binding_count INTEGER; movement_count INTEGER:=0;
 above_count INTEGER:=0; below_count INTEGER:=0; within_count INTEGER:=0; code TEXT; message TEXT;
BEGIN
 IF public.canonical_native_material_bindings_valid(bindings) IS NOT TRUE THEN RAISE EXCEPTION 'Material bindings invalid' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(jsonb_agg(value ORDER BY value->>'lineId'),'[]'::jsonb) INTO sorted_bindings FROM jsonb_array_elements(bindings) value;
 SELECT * INTO estimate_row FROM public.canonical_estimates WHERE organization_id=org AND id=estimate;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO revision_row FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Adopted material plan is required' USING ERRCODE='P0002',CONSTRAINT='native_material_plan_unavailable'; END IF;
 component:=public.canonical_estimate_revision_components(revision_row)->'material';
 IF component->>'kind' IS DISTINCT FROM 'plan' THEN RAISE EXCEPTION 'Adopted material plan is required' USING ERRCODE='P0002',CONSTRAINT='native_material_plan_unavailable'; END IF;
 SELECT * INTO plan_row FROM public.canonical_material_plans WHERE organization_id=org AND estimate_id=estimate
  AND id=(component->>'id')::uuid AND revision=(component->>'revision')::bigint AND digest=component->>'digest' AND action='save';
 IF NOT FOUND OR jsonb_typeof(plan_row.inputs->'lines') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Current multi-line material plan is required' USING ERRCODE='P0002',CONSTRAINT='native_material_plan_unavailable'; END IF;
 SELECT * INTO execution_row FROM public.canonical_field_executions WHERE organization_id=org AND id=execution AND opportunity_id=estimate_row.opportunity_id;
 IF NOT FOUND OR execution_row.lifecycle_state<>'completed' THEN
  RAISE EXCEPTION 'Completed selected job is required' USING ERRCODE='P0002',CONSTRAINT='native_material_completion_unavailable'; END IF;
 SELECT * INTO completion_row FROM public.canonical_completion_records WHERE organization_id=org AND execution_id=execution
  AND lifecycle_after='completed' AND resulting_execution_revision=execution_row.revision
  AND resulting_execution_digest=rtrim(execution_row.canonical_digest) ORDER BY decided_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current completion record is required' USING ERRCODE='P0002',CONSTRAINT='native_material_completion_unavailable'; END IF;
 plan_count:=jsonb_array_length(plan_row.inputs->'lines'); binding_count:=jsonb_array_length(sorted_bindings);
 IF plan_count<>binding_count OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan_row.inputs->'lines') line
   FULL JOIN jsonb_array_elements(sorted_bindings) bind ON bind->>'lineId'=line->>'lineId'
   WHERE line IS NULL OR bind IS NULL) THEN
  RAISE EXCEPTION 'Every planned line needs one exact item reference' USING ERRCODE='P0002',CONSTRAINT='native_material_binding_unavailable'; END IF;
 FOR binding IN SELECT value FROM jsonb_array_elements(sorted_bindings) value ORDER BY value->>'lineId' LOOP
  SELECT value INTO plan_line FROM jsonb_array_elements(plan_row.inputs->'lines') value WHERE value->>'lineId'=binding->>'lineId';
  IF plan_line IS NULL THEN RAISE EXCEPTION 'Material binding unavailable' USING ERRCODE='P0002',CONSTRAINT='native_material_binding_unavailable'; END IF;
  planned:=(plan_line->>'quantity')::numeric*(1+(plan_line->>'wastePercent')::numeric/100);
  planned:=(CASE WHEN plan_line->>'unit'='ea' THEN ceil(planned) ELSE ceil(planned*1000000)/1000000 END)::numeric(20,6);
  consumed:=0; wasted:=0; movements:='[]'::jsonb;
  FOR movement IN SELECT current_row.* FROM public.canonical_material_movements current_row
    WHERE current_row.organization_id=org AND current_row.execution_id=execution AND current_row.item_key=binding->>'itemKey'
    ORDER BY current_row.observed_at,current_row.id LOOP
   movement_count:=movement_count+1;
   IF movement_count>500 THEN RAISE EXCEPTION 'Material evidence limit reached' USING ERRCODE='54000'; END IF;
   IF movement.review_state IN ('unreviewed','needs_review') THEN RAISE EXCEPTION 'Material movement review required' USING ERRCODE='P0002',CONSTRAINT='native_material_review_required'; END IF;
   movements:=movements||jsonb_build_array(jsonb_build_object('id',movement.id,'revision',movement.revision,
    'digest',rtrim(movement.canonical_digest),'entryKind',movement.entry_kind,'reversalOfId',movement.reversal_of_id,
    'movementKind',movement.movement_kind,'itemKey',movement.item_key,'quantity',movement.quantity_text,
    'unit',movement.unit_code,'reviewState',movement.review_state,'observedAt',movement.observed_at));
   IF movement.review_state='accepted' AND movement.movement_kind IN ('consumed','waste') THEN
    IF movement.unit_code IS DISTINCT FROM plan_line->>'unit' THEN RAISE EXCEPTION 'Material units do not match' USING ERRCODE='P0002',CONSTRAINT='native_material_unit_mismatch'; END IF;
    IF movement.movement_kind='consumed' THEN consumed:=consumed+(CASE movement.entry_kind WHEN 'record' THEN movement.quantity ELSE -movement.quantity END);
    ELSE wasted:=wasted+(CASE movement.entry_kind WHEN 'record' THEN movement.quantity ELSE -movement.quantity END); END IF;
   END IF;
  END LOOP;
  IF consumed<0 OR wasted<0 OR NOT EXISTS(SELECT 1 FROM public.canonical_material_movements current_row
    WHERE current_row.organization_id=org AND current_row.execution_id=execution AND current_row.item_key=binding->>'itemKey'
      AND current_row.review_state='accepted' AND current_row.movement_kind IN ('consumed','waste')) THEN
   RAISE EXCEPTION 'Accepted material use is required' USING ERRCODE='P0002',CONSTRAINT='native_material_usage_unavailable'; END IF;
  used:=consumed+wasted; variance:=round(used-planned,6); percent_value:=round((variance/planned)*100,2);
  IF abs(percent_value)<=5 THEN code:='within_expected_range';message:='Recorded material use was within 5% of the planned quantity.';within_count:=within_count+1;
  ELSIF percent_value>0 THEN code:='actual_above_plan';message:='Recorded material use was higher than the planned quantity.';above_count:=above_count+1;
  ELSE code:='actual_below_plan';message:='Recorded material use was lower than the planned quantity.';below_count:=below_count+1;END IF;
  result_lines:=result_lines||jsonb_build_array(jsonb_build_object('lineId',binding->>'lineId','material',plan_line->>'material',
   'itemKey',binding->>'itemKey','unit',plan_line->>'unit','plannedQuantity',planned::text,'recordedConsumedQuantity',consumed::text,
   'recordedWasteQuantity',wasted::text,'recordedUsedQuantity',used::text,'varianceQuantity',variance::text,
   'variancePercent',percent_value::text,'advisoryCode',code,'advisoryMessage',message));
  source_lines:=source_lines||jsonb_build_array(jsonb_build_object('lineId',binding->>'lineId','plan',plan_line,
   'itemKey',binding->>'itemKey','movements',movements));
 END LOOP;
 IF above_count>0 AND below_count>0 THEN code:='mixed_variance';message:='Some recorded material quantities were above plan and others were below plan.';
 ELSIF above_count>0 THEN code:='some_above_plan';message:='At least one recorded material quantity was higher than planned.';
 ELSIF below_count>0 THEN code:='some_below_plan';message:='At least one recorded material quantity was lower than planned.';
 ELSE code:='all_within_expected_range';message:='All recorded material quantities were within 5% of plan.';END IF;
 component:=jsonb_build_object(
  'estimate',jsonb_build_object('id',estimate_row.id,'digest',rtrim(estimate_row.snapshot_digest)),
  'estimateRevision',jsonb_build_object('id',revision_row.id,'revision',revision_row.revision,'digest',revision_row.digest),
  'materialPlan',jsonb_build_object('id',plan_row.id,'revision',plan_row.revision,'digest',plan_row.digest,'calculationVersion',plan_row.calculation_version),
  'execution',jsonb_build_object('id',execution_row.id,'revision',execution_row.revision,'digest',rtrim(execution_row.canonical_digest)),
  'completion',jsonb_build_object('id',completion_row.id,'revision',completion_row.revision,'digest',rtrim(completion_row.canonical_digest)),
  'bindings',sorted_bindings,'lines',source_lines);
 RETURN jsonb_build_object('sourceManifest',component,'sourceDigest',public.canonical_completion_digest(component),
  'result',jsonb_build_object('lineCount',plan_count,'comparedLineCount',plan_count,'withinRangeCount',within_count,
   'abovePlanCount',above_count,'belowPlanCount',below_count,'advisoryCode',code,'advisoryMessage',message,'lines',result_lines),
  'scopeNote','Recorded use is accepted NorthStar consumption plus waste for exact item references and already matching units. Returns, transfers and adjustments do not establish use.',
  'adoptionBoundary','Review this evidence before changing future material assumptions. No estimate, price, job, inventory balance, purchase, vendor record or business policy was changed.');
END $$;

CREATE TABLE public.canonical_native_material_outcome_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 estimate_id UUID NOT NULL, execution_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 consent_id UUID NOT NULL, consent_revision BIGINT NOT NULL, consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='object' AND octet_length(source_manifest::text)<=524288),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 result JSONB NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=262144),
 advisory_code TEXT NOT NULL CHECK(advisory_code IN ('all_within_expected_range','some_above_plan','some_below_plan','mixed_variance')),
 advisory_message TEXT NOT NULL CHECK(public.canonical_learning_text_valid(advisory_message,500)),
 scope_note TEXT NOT NULL CHECK(public.canonical_learning_text_valid(scope_note,1000)),
 adoption_boundary TEXT NOT NULL CHECK(public.canonical_learning_text_valid(adoption_boundary,1000)),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)), confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-native-material-outcome-observation-v1'),
 calculation_version TEXT NOT NULL CHECK(calculation_version='m25-native-material-quantity-variance-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,estimate_id,execution_id,revision), UNIQUE(organization_id,estimate_id,execution_id,source_digest,consent_id),
 UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,execution_id) REFERENCES public.canonical_field_executions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_native_material_outcome_observations(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,consent_id) REFERENCES public.canonical_material_learning_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(public.canonical_field_evidence_object_keys_exact(source_manifest,ARRAY['estimate','estimateRevision','materialPlan','execution','completion','bindings','lines'])),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(source_manifest)),
 CHECK(result->>'advisoryCode'=advisory_code AND result->>'advisoryMessage'=advisory_message)
);
CREATE TRIGGER canonical_native_material_outcomes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_native_material_outcome_observations FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_learning_immutable();

CREATE FUNCTION public.canonical_native_material_outcome_projection(value public.canonical_native_material_outcome_observations)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'estimateId',value.estimate_id,'executionId',value.execution_id,'revision',value.revision,
  'previousId',value.previous_id,'consentId',value.consent_id,'consentRevision',value.consent_revision,
  'consentDigest',rtrim(value.consent_digest),'sourceManifest',value.source_manifest,'sourceDigest',rtrim(value.source_digest),
  'result',value.result,'advisoryCode',value.advisory_code,'advisoryMessage',value.advisory_message,'scopeNote',value.scope_note,
  'adoptionBoundary',value.adoption_boundary,'reason',value.reason,'confirmed',value.confirmed,
  'confirmationVersion',value.confirmation_version,'calculationVersion',value.calculation_version,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at)
$$;

CREATE FUNCTION public.canonical_native_material_outcome_observe(org UUID,actor UUID,role_value TEXT,session_value UUID,
 csrf TEXT,key_value TEXT,estimate UUID,execution UUID,expected_consent_revision BIGINT,expected_consent_digest TEXT,
 bindings JSONB,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_material_learning_consents%ROWTYPE;
 current_row public.canonical_native_material_outcome_observations%ROWTYPE; old public.canonical_native_material_outcome_observations%ROWTYPE;
 inserted public.canonical_native_material_outcome_observations%ROWTYPE; basis JSONB;
 key_hash TEXT; request_hash TEXT; next_revision BIGINT; digest_value TEXT; replay_fresh BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Material learning review is restricted' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR expected_consent_revision IS NULL OR expected_consent_revision NOT BETWEEN 1 AND 10000
  OR expected_consent_digest IS NULL OR expected_consent_digest!~'^[0-9a-f]{64}$' OR public.canonical_native_material_bindings_valid(bindings) IS NOT TRUE
  OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE
  OR confirmation_version_value IS DISTINCT FROM 'm25-native-material-outcome-observation-v1' THEN
  RAISE EXCEPTION 'Material outcome input invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'estimateId',estimate,
  'executionId',execution,'consentRevision',expected_consent_revision,'consentDigest',expected_consent_digest,'bindings',bindings,
  'reason',reason_value,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':native-material-outcome:'||estimate::text||':'||execution::text,0));
 SELECT * INTO old FROM public.canonical_native_material_outcome_observations WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(old.request_digest)<>request_hash THEN RAISE EXCEPTION 'Material learning key conflict' USING ERRCODE='23505'; END IF;
  SELECT * INTO consent_row FROM public.canonical_material_learning_consents WHERE organization_id=org
   AND purpose='native_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1;
  replay_fresh:=FALSE;
  IF FOUND AND consent_row.action='grant' AND consent_row.id=old.consent_id THEN
   BEGIN basis:=public.canonical_native_material_outcome_basis(org,estimate,execution,old.source_manifest->'bindings');
    replay_fresh:=rtrim(old.source_digest)=basis->>'sourceDigest'; EXCEPTION WHEN SQLSTATE 'P0002' THEN replay_fresh:=FALSE; END;
  END IF;
  IF consent_row.id IS NULL OR consent_row.action<>'grant' OR consent_row.id<>old.consent_id THEN
   RETURN jsonb_build_object('observation',jsonb_build_object('id',old.id,'estimateId',old.estimate_id,'executionId',old.execution_id,
    'revision',old.revision,'digest',rtrim(old.canonical_digest),'createdAt',old.created_at,'fresh',FALSE,'advisoryAvailable',FALSE,
    'advisoryCode',NULL,'advisoryMessage',NULL,'hiddenByConsent',TRUE),'replayed',TRUE);
  END IF;
  RETURN jsonb_build_object('observation',public.canonical_native_material_outcome_projection(old)||jsonb_build_object(
   'fresh',replay_fresh,'advisoryAvailable',replay_fresh,'advisoryCode',CASE WHEN replay_fresh THEN old.advisory_code ELSE NULL END,
   'advisoryMessage',CASE WHEN replay_fresh THEN old.advisory_message ELSE NULL END),'replayed',TRUE);
 END IF;
 SELECT * INTO consent_row FROM public.canonical_material_learning_consents WHERE organization_id=org
  AND purpose='native_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF NOT FOUND OR consent_row.action<>'grant' OR consent_row.revision IS DISTINCT FROM expected_consent_revision
  OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM expected_consent_digest THEN
  RAISE EXCEPTION 'Material learning consent changed' USING ERRCODE='40001',CONSTRAINT='material_learning_consent_stale'; END IF;
 basis:=public.canonical_native_material_outcome_basis(org,estimate,execution,bindings);
 SELECT * INTO current_row FROM public.canonical_native_material_outcome_observations WHERE organization_id=org
  AND estimate_id=estimate AND execution_id=execution ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF current_row.id IS NOT NULL AND rtrim(current_row.source_digest)=basis->>'sourceDigest' AND current_row.consent_id=consent_row.id THEN
  RAISE EXCEPTION 'Current material outcome is already observed' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'estimateId',estimate,'executionId',execution,
  'revision',next_revision,'previousId',current_row.id,'consentId',consent_row.id,'consentRevision',consent_row.revision,
  'consentDigest',rtrim(consent_row.canonical_digest),'sourceDigest',basis->>'sourceDigest','result',basis->'result',
  'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'confirmed',confirmed_value,'reason',reason_value,
  'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_native_material_outcome_observations(organization_id,estimate_id,execution_id,revision,previous_id,
  consent_id,consent_revision,consent_digest,source_manifest,source_digest,result,advisory_code,advisory_message,scope_note,
  adoption_boundary,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,calculation_version,
  request_key_hash,request_digest,canonical_digest)
 VALUES(org,estimate,execution,next_revision,current_row.id,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),
  basis->'sourceManifest',basis->>'sourceDigest',basis->'result',basis#>>'{result,advisoryCode}',basis#>>'{result,advisoryMessage}',
  basis->>'scopeNote',basis->>'adoptionBoundary',actor,(authority->>'membershipId')::uuid,session_value,reason_value,confirmed_value,
  confirmation_version_value,'m25-native-material-quantity-variance-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('observation',public.canonical_native_material_outcome_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_native_material_outcome_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,execution UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_material_learning_consents%ROWTYPE; current_row public.canonical_native_material_outcome_observations%ROWTYPE;
 basis JSONB; fresh BOOLEAN; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Material learning review is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO consent_row FROM public.canonical_material_learning_consents WHERE organization_id=org
  AND purpose='native_material_quantity_variance_v1' ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR consent_row.action<>'grant' THEN RETURN jsonb_build_object('activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,
  'total',0,'truncated',FALSE,'blockedReason','Material outcome learning consent is not active.'); END IF;
 SELECT * INTO current_row FROM public.canonical_native_material_outcome_observations WHERE organization_id=org
  AND estimate_id=estimate AND execution_id=execution AND consent_id=consent_row.id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('activeConsent',TRUE,'consent',public.canonical_material_learning_consent_projection(consent_row),
  'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'refreshRequired',TRUE); END IF;
 BEGIN basis:=public.canonical_native_material_outcome_basis(org,estimate,execution,current_row.source_manifest->'bindings');
  fresh:=rtrim(current_row.source_digest)=basis->>'sourceDigest'; EXCEPTION WHEN SQLSTATE 'P0002' THEN basis:=NULL;fresh:=FALSE; END;
 SELECT count(*) INTO total FROM public.canonical_native_material_outcome_observations WHERE organization_id=org
  AND estimate_id=estimate AND execution_id=execution AND consent_id=consent_row.id;
 SELECT COALESCE(jsonb_agg(public.canonical_native_material_outcome_projection(item)||jsonb_build_object(
   'fresh',item.id=current_row.id AND fresh,'advisoryAvailable',item.id=current_row.id AND fresh,
   'advisoryCode',CASE WHEN item.id=current_row.id AND fresh THEN item.advisory_code ELSE NULL END,
   'advisoryMessage',CASE WHEN item.id=current_row.id AND fresh THEN item.advisory_message ELSE NULL END) ORDER BY revision DESC),'[]'::jsonb)
  INTO history FROM (SELECT * FROM public.canonical_native_material_outcome_observations WHERE organization_id=org
   AND estimate_id=estimate AND execution_id=execution AND consent_id=consent_row.id ORDER BY revision DESC LIMIT 20) item;
 RETURN jsonb_build_object('activeConsent',TRUE,'consent',public.canonical_material_learning_consent_projection(consent_row),
  'current',public.canonical_native_material_outcome_projection(current_row)||jsonb_build_object('fresh',fresh,'advisoryAvailable',fresh,
   'advisoryCode',CASE WHEN fresh THEN current_row.advisory_code ELSE NULL END,
   'advisoryMessage',CASE WHEN fresh THEN current_row.advisory_message ELSE NULL END),
  'history',history,'total',total,'truncated',total>20,'refreshRequired',NOT fresh);
END $$;

REVOKE ALL ON TABLE public.canonical_material_learning_consents,public.canonical_native_material_outcome_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_learning_consent_projection(public.canonical_material_learning_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_material_bindings_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_material_outcome_basis(uuid,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_material_outcome_projection(public.canonical_native_material_outcome_observations) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_learning_consent_read(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_learning_consent_mutate(uuid,uuid,text,uuid,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_material_outcome_observe(uuid,uuid,text,uuid,text,text,uuid,uuid,bigint,text,jsonb,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_native_material_outcome_read(uuid,uuid,text,uuid,uuid,uuid) FROM PUBLIC;
