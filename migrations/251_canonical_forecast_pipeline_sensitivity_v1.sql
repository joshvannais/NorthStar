-- Mission 26 Part 9D: one-estimate forward and reverse sensitivity over the
-- exact current Part 9C named-scenario source. Weights remain explicit
-- assumptions. This issues no probability, revenue, recommendation, or action.

CREATE FUNCTION public.canonical_forecast_pipeline_sensitivity_v1_signed_amount(
 value_micro NUMERIC)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE absolute_value NUMERIC;
BEGIN
 IF value_micro IS NULL OR value_micro<>trunc(value_micro) OR
    abs(value_micro)>255999999999997440000 THEN
  RAISE EXCEPTION 'Pipeline sensitivity amount invalid' USING ERRCODE='22023';
 END IF;
 absolute_value:=abs(value_micro);
 RETURN (CASE WHEN value_micro<0 THEN '-' ELSE '' END)||to_char(
  absolute_value/1000000,'FM999999999999999999999999990.000000');
END $$;

-- Replace only the selected estimate's authenticated base assumption, then
-- delegate to Part 9C's Part 6B-compatible sum-cents-times-ppm arithmetic.
CREATE FUNCTION public.canonical_forecast_pipeline_sensitivity_v1_value(
 members JSONB,assumptions JSONB,estimate_value UUID,weight_value INTEGER,
 category_value TEXT)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE changed JSONB;matched INTEGER;
BEGIN
 IF jsonb_typeof(members)<>'array' OR jsonb_typeof(assumptions)<>'array' OR
    estimate_value IS NULL OR weight_value NOT BETWEEN 0 AND 1000000 OR
    category_value NOT IN ('preliminary_estimate','approved_unbooked') THEN
  RAISE EXCEPTION 'Pipeline sensitivity arithmetic input invalid' USING ERRCODE='22023';
 END IF;
 SELECT count(*)::integer,
  jsonb_agg(CASE WHEN value->>'estimateId'=estimate_value::text
    THEN jsonb_set(value,'{variations,base,weightPpm}',to_jsonb(weight_value),FALSE)
    ELSE value END ORDER BY value->>'estimateId')
 INTO matched,changed
 FROM jsonb_array_elements(assumptions) value
 WHERE jsonb_typeof(value)='object';
 SELECT count(*)::integer INTO matched FROM jsonb_array_elements(assumptions) value
  WHERE value->>'estimateId'=estimate_value::text;
 IF matched<>1 OR changed IS NULL THEN
  RAISE EXCEPTION 'Pipeline sensitivity selected estimate invalid' USING ERRCODE='23514';
 END IF;
 RETURN public.canonical_forecast_named_scenario_v1_value(
  members,changed,'base',category_value);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
 reason_value TEXT,checked_at_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RETURN jsonb_build_object(
  'version','m26-pipeline-sensitivity-v1','state','unavailable',
  'reason',reason_value,
  'checkedAt',public.canonical_forecast_utc_instant(checked_at_value),
  'asOf',NULL,'horizon',NULL,'currency',NULL,'scenario',NULL,
  'selectedEstimate',NULL,'target',NULL,'constraint',NULL,
  'forward',NULL,'reverse',NULL,
  'digests',jsonb_build_object('input',NULL,'output',NULL,'source',NULL,
    'assumptions',NULL,'review',NULL,'currentness',NULL),
  'currentness',jsonb_build_object('scenarioCurrent',FALSE,'sourceCurrent',FALSE,
    'assumptionsCurrent',FALSE,'policyCurrent',FALSE,'profileCurrent',FALSE,
    'refreshRequired',TRUE,'correctionOrRevocationApplied',TRUE),
  'sourceAuthenticated',FALSE,'assumptionSourcesAuthenticated',FALSE,
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'percentilesIssued',FALSE,'targetIsWhatIfThreshold',TRUE,
  'earnedRevenueMeasured',FALSE,'cashMeasured',FALSE,
  'recommendationIssued',FALSE,'researchOnly',TRUE,
  'realForecastEligible',FALSE,'analysisIssued',FALSE,
  'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_sensitivity_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,request_value JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value JSONB;scenario_value JSONB;estimate_value_json JSONB;
 forward_value JSONB;reverse_value JSONB;target_value JSONB;constraint_value JSONB;
 saved public.canonical_forecast_named_scenario_reviews_v1%ROWTYPE;
 policy public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 selected_assumption JSONB;selected_member JSONB;selected_id UUID;category_value TEXT;
 proposed_weight INTEGER;lower_weight INTEGER;base_weight INTEGER;upper_weight INTEGER;
 target_micro NUMERIC;baseline_category NUMERIC;proposed_category NUMERIC;
 baseline_selected NUMERIC;proposed_selected NUMERIC;maximum_category NUMERIC;
 attained_category NUMERIC;attained_selected NUMERIC;low_value INTEGER;high_value INTEGER;
 midpoint INTEGER;now_value TIMESTAMPTZ;input_digest TEXT;output_digest TEXT;
 target_definition_digest TEXT;constraint_definition_digest TEXT;
 target_provenance_digest TEXT;result_value JSONB;reverse_result JSONB;
 binding_value JSONB;forward_binding JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Pipeline sensitivity access restricted' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(request_value)<>'object' OR
    (SELECT count(*) FROM jsonb_object_keys(request_value))<>6 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(request_value) key_name
      WHERE key_name NOT IN ('version','scenario','estimate','forward','reverse','purpose')) OR
    request_value->>'version'<>'m26-pipeline-sensitivity-request-v1' OR
    request_value->>'purpose'<>'bounded_open_pipeline_what_if' OR
    jsonb_typeof(request_value->'scenario')<>'object' OR
    jsonb_typeof(request_value->'estimate')<>'object' OR
    jsonb_typeof(request_value->'forward')<>'object' OR
    jsonb_typeof(request_value->'reverse')<>'object' OR
    jsonb_typeof(request_value#>'{reverse,target}')<>'object' OR
    jsonb_typeof(request_value#>'{reverse,constraint}')<>'object' THEN
  RAISE EXCEPTION 'Pipeline sensitivity request invalid' USING ERRCODE='22023';
 END IF;
 scenario_value:=request_value->'scenario';estimate_value_json:=request_value->'estimate';
 forward_value:=request_value->'forward';reverse_value:=request_value->'reverse';
 target_value:=reverse_value->'target';constraint_value:=reverse_value->'constraint';
 IF (SELECT count(*) FROM jsonb_object_keys(scenario_value))<>8 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(scenario_value) key_name WHERE key_name NOT IN
      ('reviewId','reviewRevision','reviewDigest','sourceSnapshotDigest','assumptionDigest',
       'currentnessDigest','asOf','horizon')) OR
    (SELECT count(*) FROM jsonb_object_keys(estimate_value_json))<>9 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(estimate_value_json) key_name WHERE key_name NOT IN
      ('id','snapshotDigest','category','decisionId','decisionRevision','decisionDigest',
       'issuedVersionId','issuedVersionRevision','issuedDocumentDigest')) OR
    (SELECT count(*) FROM jsonb_object_keys(forward_value))<>1 OR
    NOT (forward_value ? 'proposedWeightPpm') OR
    (SELECT count(*) FROM jsonb_object_keys(reverse_value))<>2 OR
    (SELECT count(*) FROM jsonb_object_keys(target_value))<>3 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(target_value) key_name
      WHERE key_name NOT IN ('kind','category','minimumAmount')) OR
    (SELECT count(*) FROM jsonb_object_keys(constraint_value))<>1 OR
    NOT (constraint_value ? 'kind') OR
    scenario_value->>'reviewId'!~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    scenario_value->>'reviewRevision'!~'^([1-9][0-9]{0,3}|10000)$' OR
    scenario_value->>'reviewDigest'!~'^[0-9a-f]{64}$' OR
    scenario_value->>'sourceSnapshotDigest'!~'^[0-9a-f]{64}$' OR
    scenario_value->>'assumptionDigest'!~'^[0-9a-f]{64}$' OR
    scenario_value->>'currentnessDigest'!~'^[0-9a-f]{64}$' OR
    scenario_value->>'asOf'!~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    jsonb_typeof(scenario_value->'horizon')<>'object' OR
    estimate_value_json->>'id'!~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    estimate_value_json->>'snapshotDigest'!~'^[0-9a-f]{64}$' OR
    estimate_value_json->>'category' NOT IN ('preliminary_estimate','approved_unbooked') OR
    jsonb_typeof(forward_value->'proposedWeightPpm')<>'number' OR
    forward_value->>'proposedWeightPpm'!~'^(0|[1-9][0-9]{0,6})$' OR
    (forward_value->>'proposedWeightPpm')::numeric<>trunc(
      (forward_value->>'proposedWeightPpm')::numeric) OR
    (forward_value->>'proposedWeightPpm')::numeric NOT BETWEEN 0 AND 1000000 OR
    target_value->>'kind'!~'^[a-z][a-z0-9_]{1,79}$' OR
    target_value->>'category'!~'^[a-z][a-z0-9_]{1,79}$' OR
    target_value->>'minimumAmount'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{6}$' OR
    constraint_value->>'kind'!~'^[a-z][a-z0-9_]{1,79}$' THEN
  RAISE EXCEPTION 'Pipeline sensitivity request invalid' USING ERRCODE='22023';
 END IF;
 selected_id:=(estimate_value_json->>'id')::uuid;
 proposed_weight:=(forward_value->>'proposedWeightPpm')::integer;
 target_micro:=replace(target_value->>'minimumAmount','.','')::numeric;

 current_value:=public.canonical_forecast_named_scenario_v1_current(
  org,actor,role_value,session_value);
 now_value:=(current_value->>'checkedAt')::timestamptz;
 IF current_value->>'state'<>'current' THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   COALESCE(current_value->>'reason','named_scenario_unavailable'),now_value);
 END IF;
 IF target_value->>'kind'<>'minimum_category_total' THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'unsupported_target_kind',now_value);END IF;
 IF constraint_value->>'kind'<>'selected_estimate_conversion_weight' THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'unsupported_constraint_kind',now_value);END IF;
 IF target_value->>'category' NOT IN ('preliminary_estimate','approved_unbooked') THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'unsupported_target_category',now_value);END IF;
 IF scenario_value->>'reviewId'<>current_value#>>'{scenarioReview,id}' OR
    (scenario_value->>'reviewRevision')::integer<>
      (current_value#>>'{scenarioReview,revision}')::integer OR
    scenario_value->>'reviewDigest'<>current_value#>>'{digests,review}' OR
    scenario_value->>'sourceSnapshotDigest'<>current_value#>>'{digests,source}' OR
    scenario_value->>'assumptionDigest'<>current_value#>>'{digests,assumptions}' OR
    scenario_value->>'currentnessDigest'<>current_value#>>'{digests,currentness}' OR
    scenario_value->>'asOf'<>current_value->>'asOf' OR
    scenario_value->'horizon' IS DISTINCT FROM current_value->'horizon' THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'scenario_identity_changed',now_value);END IF;

 SELECT value INTO selected_assumption FROM jsonb_array_elements(
  current_value->'assumptions') value WHERE value->>'estimateId'=selected_id::text;
 IF selected_assumption IS NULL OR
    estimate_value_json->>'snapshotDigest'<>
      selected_assumption->>'estimateSnapshotDigest' OR
    estimate_value_json->>'category'<>selected_assumption->>'category' OR
    target_value->>'category'<>selected_assumption->>'category' OR
    estimate_value_json->>'decisionId' IS DISTINCT FROM
      selected_assumption#>>'{applicability,decisionId}' OR
    estimate_value_json->>'decisionRevision' IS DISTINCT FROM
      selected_assumption#>>'{applicability,decisionRevision}' OR
    estimate_value_json->>'decisionDigest' IS DISTINCT FROM
      selected_assumption#>>'{applicability,decisionDigest}' OR
    estimate_value_json->>'issuedVersionId' IS DISTINCT FROM
      selected_assumption#>>'{applicability,issuedVersionId}' OR
    estimate_value_json->>'issuedVersionRevision' IS DISTINCT FROM
      selected_assumption#>>'{applicability,issuedVersionRevision}' OR
    estimate_value_json->>'issuedDocumentDigest' IS DISTINCT FROM
      selected_assumption#>>'{applicability,issuedDocumentDigest}' THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'estimate_identity_changed',now_value);END IF;
 category_value:=selected_assumption->>'category';
 SELECT * INTO saved FROM public.canonical_forecast_named_scenario_reviews_v1
  WHERE organization_id=org AND id=(scenario_value->>'reviewId')::uuid;
 SELECT value INTO selected_member FROM jsonb_array_elements(saved.source_members) value
  WHERE value->>'estimateId'=selected_id::text;
 IF saved.id IS NULL OR selected_member IS NULL OR
    selected_member->>'estimateSnapshotDigest'<>
      selected_assumption->>'estimateSnapshotDigest' OR
    selected_member->>'category'<>category_value OR
    selected_member->>'decisionId' IS DISTINCT FROM
      selected_assumption#>>'{applicability,decisionId}' OR
    selected_member->>'issuedVersionId' IS DISTINCT FROM
      selected_assumption#>>'{applicability,issuedVersionId}' THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'estimate_identity_changed',now_value);END IF;
 SELECT * INTO policy FROM public.canonical_forecast_pipeline_scenario_policy_reviews
  WHERE organization_id=org AND id=saved.pipeline_policy_id;
 IF category_value='preliminary_estimate' THEN
  lower_weight:=policy.preliminary_lower_ppm;base_weight:=policy.preliminary_central_ppm;
  upper_weight:=policy.preliminary_upper_ppm;
 ELSE
  lower_weight:=policy.approved_lower_ppm;base_weight:=policy.approved_central_ppm;
  upper_weight:=policy.approved_upper_ppm;
 END IF;
 IF policy.id IS NULL OR policy.action<>'approve' OR lower_weight IS NULL OR
    base_weight IS NULL OR upper_weight IS NULL OR lower_weight<0 OR
    lower_weight>base_weight OR base_weight>upper_weight OR upper_weight>1000000 OR
    (selected_assumption#>>'{variations,base,weightPpm}')::integer<>base_weight OR
    selected_assumption#>>'{variations,base,source,kind}'<>
      'owner_approved_scenario_assumption' OR
    selected_assumption#>>'{variations,base,source,digest}'!~'^[0-9a-f]{64}$' THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'authenticated_weight_bounds_invalid',now_value);END IF;
 IF proposed_weight<lower_weight OR proposed_weight>upper_weight THEN
  RETURN public.canonical_forecast_pipeline_sensitivity_v1_unavailable(
   'proposed_weight_outside_authenticated_bounds',now_value);END IF;

 baseline_category:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'base',category_value);
 proposed_category:=public.canonical_forecast_pipeline_sensitivity_v1_value(
  saved.source_members,saved.assumptions,selected_id,proposed_weight,category_value);
 baseline_selected:=public.canonical_forecast_named_scenario_v1_value(
  jsonb_build_array(selected_member),jsonb_build_array(selected_assumption),
  'base',category_value);
 proposed_selected:=public.canonical_forecast_pipeline_sensitivity_v1_value(
  jsonb_build_array(selected_member),jsonb_build_array(selected_assumption),
  selected_id,proposed_weight,category_value);
 maximum_category:=public.canonical_forecast_pipeline_sensitivity_v1_value(
  saved.source_members,saved.assumptions,selected_id,upper_weight,category_value);

 IF proposed_weight=lower_weight THEN
  forward_binding:=jsonb_build_object('kind','selected_weight_lower_bound',
    'weightPpm',lower_weight);
 ELSIF proposed_weight=upper_weight THEN
  forward_binding:=jsonb_build_object('kind','selected_weight_upper_bound',
    'weightPpm',upper_weight);
 ELSE forward_binding:=NULL;END IF;
 IF maximum_category<target_micro THEN
  binding_value:=jsonb_build_object('kind','selected_weight_upper_bound',
    'weightPpm',upper_weight);
  reverse_result:=jsonb_build_object('state','impossible',
    'reason','target_exceeds_selected_weight_bound','requiredWeightPpm',NULL,
    'selectedEstimateAmount',NULL,'categoryTotal',NULL,
    'bindingConstraint',binding_value);
 ELSE
  low_value:=lower_weight;high_value:=upper_weight;
  WHILE low_value<high_value LOOP
   midpoint:=(low_value+high_value)/2;
   attained_category:=public.canonical_forecast_pipeline_sensitivity_v1_value(
    saved.source_members,saved.assumptions,selected_id,midpoint,category_value);
   IF attained_category>=target_micro THEN high_value:=midpoint;
   ELSE low_value:=midpoint+1;END IF;
  END LOOP;
  attained_category:=public.canonical_forecast_pipeline_sensitivity_v1_value(
   saved.source_members,saved.assumptions,selected_id,low_value,category_value);
  attained_selected:=public.canonical_forecast_pipeline_sensitivity_v1_value(
   jsonb_build_array(selected_member),jsonb_build_array(selected_assumption),
   selected_id,low_value,category_value);
  binding_value:=CASE WHEN low_value=lower_weight THEN
    jsonb_build_object('kind','selected_weight_lower_bound','weightPpm',lower_weight)
   WHEN low_value=upper_weight THEN
    jsonb_build_object('kind','selected_weight_upper_bound','weightPpm',upper_weight)
   ELSE NULL END;
  reverse_result:=jsonb_build_object('state','assumption_only','reason',NULL,
    'requiredWeightPpm',low_value,
    'selectedEstimateAmount',
      public.canonical_forecast_named_scenario_v1_amount(attained_selected),
    'categoryTotal',jsonb_build_object(
      'minimumAmount',target_value->>'minimumAmount',
      'attainedAmount',public.canonical_forecast_named_scenario_v1_amount(attained_category),
      'changeFromBaselineAmount',
        public.canonical_forecast_pipeline_sensitivity_v1_signed_amount(
          attained_category-baseline_category)),
    'bindingConstraint',binding_value);
 END IF;

 target_definition_digest:=public.canonical_completion_digest(jsonb_build_object(
  'key','pipeline.minimum_category_total','version','v1','unit','currency_amount'));
 constraint_definition_digest:=public.canonical_completion_digest(jsonb_build_object(
  'key','pipeline.selected_estimate_conversion_weight','version','v1','unit','ppm'));
 target_provenance_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-sensitivity-target-v1','organizationId',org,
  'actorUserId',actor,'scenarioReviewDigest',scenario_value->>'reviewDigest',
  'target',target_value));
 input_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-sensitivity-input-v1','organizationId',org,
  'request',request_value,'baseAssumptionSourceDigest',
    selected_assumption#>>'{variations,base,source,digest}',
  'policyDigest',rtrim(policy.policy_digest)));
 result_value:=jsonb_build_object(
  'version','m26-pipeline-sensitivity-v1','state','assumption_only','reason',NULL,
  'checkedAt',current_value->>'checkedAt','asOf',current_value->>'asOf',
  'horizon',current_value->'horizon','currency',current_value->>'currency',
  'scenario',jsonb_build_object(
    'reviewId',scenario_value->>'reviewId',
    'reviewRevision',(scenario_value->>'reviewRevision')::integer,
    'reviewDigest',scenario_value->>'reviewDigest',
    'sourceSnapshotDigest',scenario_value->>'sourceSnapshotDigest',
    'assumptionDigest',scenario_value->>'assumptionDigest',
    'currentnessDigest',scenario_value->>'currentnessDigest'),
  'selectedEstimate',jsonb_build_object('id',selected_id,
    'snapshotDigest',selected_assumption->>'estimateSnapshotDigest',
    'category',category_value,
    'decision',jsonb_build_object('id',selected_assumption#>>'{applicability,decisionId}',
      'revision',selected_assumption#>'{applicability,decisionRevision}',
      'digest',selected_assumption#>>'{applicability,decisionDigest}'),
    'issuedVersion',jsonb_build_object(
      'id',selected_assumption#>>'{applicability,issuedVersionId}',
      'revision',selected_assumption#>'{applicability,issuedVersionRevision}',
      'digest',selected_assumption#>>'{applicability,issuedDocumentDigest}'),
    'priceBeforeTax',selected_assumption->>'priceBeforeTax',
    'currency',selected_assumption->>'currency',
    'baseAssumption',selected_assumption#>'{variations,base}'),
  'target',jsonb_build_object('kind','minimum_category_total','category',category_value,
    'minimumAmount',target_value->>'minimumAmount',
    'definition',jsonb_build_object('key','pipeline.minimum_category_total',
      'version','v1','digest',target_definition_digest),
    'provenance',jsonb_build_object('kind','authorized_user_input',
      'actorUserId',actor,'digest',target_provenance_digest),
    'interpretation','user_selected_what_if_threshold'),
  'constraint',jsonb_build_object('kind','selected_estimate_conversion_weight',
    'bounds',jsonb_build_object('lowerPpm',lower_weight,'basePpm',base_weight,
      'upperPpm',upper_weight),
    'definition',jsonb_build_object('key','pipeline.selected_estimate_conversion_weight',
      'version','v1','digest',constraint_definition_digest),
    'provenance',jsonb_build_object('kind','owner_approved_pipeline_policy',
      'id',policy.id,'revision',policy.revision,'digest',rtrim(policy.policy_digest))),
  'forward',jsonb_build_object('state','assumption_only','reason',NULL,
    'changedAssumption',jsonb_build_object('field','conversion_weight_ppm',
      'fromWeightPpm',base_weight,'toWeightPpm',proposed_weight),
    'selectedEstimate',jsonb_build_object(
      'baselineAmount',public.canonical_forecast_named_scenario_v1_amount(baseline_selected),
      'proposedAmount',public.canonical_forecast_named_scenario_v1_amount(proposed_selected),
      'changeAmount',public.canonical_forecast_pipeline_sensitivity_v1_signed_amount(
        proposed_selected-baseline_selected)),
    'categoryTotal',jsonb_build_object(
      'baselineAmount',public.canonical_forecast_named_scenario_v1_amount(baseline_category),
      'proposedAmount',public.canonical_forecast_named_scenario_v1_amount(proposed_category),
      'changeAmount',public.canonical_forecast_pipeline_sensitivity_v1_signed_amount(
        proposed_category-baseline_category)),
    'bindingConstraint',forward_binding),
  'reverse',reverse_result,
  'digests',jsonb_build_object('input',input_digest,'output',NULL,
    'source',scenario_value->>'sourceSnapshotDigest',
    'assumptions',scenario_value->>'assumptionDigest',
    'review',scenario_value->>'reviewDigest',
    'currentness',scenario_value->>'currentnessDigest'),
  'currentness',jsonb_build_object('scenarioCurrent',TRUE,'sourceCurrent',TRUE,
    'assumptionsCurrent',TRUE,'policyCurrent',TRUE,'profileCurrent',TRUE,
    'refreshRequired',FALSE,'correctionOrRevocationApplied',FALSE),
  'sourceAuthenticated',TRUE,'assumptionSourcesAuthenticated',TRUE,
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'percentilesIssued',FALSE,'targetIsWhatIfThreshold',TRUE,
  'earnedRevenueMeasured',FALSE,'cashMeasured',FALSE,
  'recommendationIssued',FALSE,'researchOnly',TRUE,
  'realForecastEligible',FALSE,'analysisIssued',TRUE,
  'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 output_digest:=public.canonical_completion_digest(
  result_value-'checkedAt'-'digests');
 result_value:=jsonb_set(result_value,'{digests,output}',to_jsonb(output_digest),FALSE);
 RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION
 public.canonical_forecast_pipeline_sensitivity_v1_signed_amount(NUMERIC),
 public.canonical_forecast_pipeline_sensitivity_v1_value(JSONB,JSONB,UUID,INTEGER,TEXT),
 public.canonical_forecast_pipeline_sensitivity_v1_unavailable(TEXT,TIMESTAMPTZ),
 public.canonical_forecast_pipeline_sensitivity_v1_read(UUID,UUID,TEXT,UUID,JSONB)
 FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_pipeline_sensitivity_v1_signed_amount(numeric),public.canonical_forecast_pipeline_sensitivity_v1_value(jsonb,jsonb,uuid,integer,text),public.canonical_forecast_pipeline_sensitivity_v1_unavailable(text,timestamptz) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_pipeline_sensitivity_v1_read(uuid,uuid,text,uuid,jsonb) TO %I',runtime_role);
 END IF;
END $$;
