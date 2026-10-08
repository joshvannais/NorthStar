-- Mission 26 Part 9C: tenant-private named adverse/base/favorable variations
-- over the exact current Part 6B open-pipeline source. These are explicit
-- owner-reviewed conversion-weight assumptions, not probabilities, statistical
-- percentiles, earned revenue, collected cash, or automatic commercial action.

CREATE TABLE public.canonical_forecast_named_scenario_reviews_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('approve','revoke')),
 cutoff_at TIMESTAMPTZ,
 horizon_starts_at TIMESTAMPTZ,
 horizon_ends_at TIMESTAMPTZ,
 time_zone TEXT,
 currency CHAR(3),
 profile_id UUID,
 profile_version BIGINT,
 profile_hash CHAR(64),
 profile_anchor_id UUID,
 pipeline_policy_id UUID,
 pipeline_policy_revision INTEGER,
 pipeline_policy_digest CHAR(64),
 pipeline_source_digest CHAR(64),
 source_members JSONB,
 assumptions JSONB,
 assumption_digest CHAR(64),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reviewed_at TIMESTAMPTZ NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,revision),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_named_scenario_reviews_v1(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,pipeline_policy_id)
  REFERENCES public.canonical_forecast_pipeline_scenario_policy_reviews(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((action='revoke' AND num_nonnulls(cutoff_at,horizon_starts_at,horizon_ends_at,
   time_zone,currency,profile_id,profile_version,profile_hash,profile_anchor_id,
   pipeline_policy_id,pipeline_policy_revision,pipeline_policy_digest,
   pipeline_source_digest,source_members,assumptions,assumption_digest)=0) OR
  (action='approve' AND num_nulls(cutoff_at,horizon_starts_at,horizon_ends_at,
   time_zone,currency,profile_id,profile_version,profile_hash,profile_anchor_id,
   pipeline_policy_id,pipeline_policy_revision,pipeline_policy_digest,
   pipeline_source_digest,source_members,assumptions,assumption_digest)=0 AND
   horizon_starts_at>cutoff_at AND horizon_ends_at>horizon_starts_at AND
   currency~'^[A-Z]{3}$' AND profile_version>0 AND
   profile_hash~'^[0-9a-f]{64}$' AND pipeline_policy_revision>0 AND
   pipeline_policy_digest~'^[0-9a-f]{64}$' AND
   pipeline_source_digest~'^[0-9a-f]{64}$' AND
   assumption_digest~'^[0-9a-f]{64}$' AND
   jsonb_typeof(source_members)='array' AND jsonb_array_length(source_members)<=256 AND
   jsonb_typeof(assumptions)='array' AND jsonb_array_length(assumptions)<=256))
);
CREATE INDEX canonical_forecast_named_scenario_reviews_v1_recent
 ON public.canonical_forecast_named_scenario_reviews_v1(
  organization_id,revision DESC,id DESC);
CREATE TRIGGER canonical_forecast_named_scenario_reviews_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_named_scenario_reviews_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_pipeline_scenario_immutable();

CREATE FUNCTION public.canonical_forecast_named_scenario_v1_amount(value_micro NUMERIC)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF value_micro IS NULL OR value_micro<>trunc(value_micro) OR value_micro<0 OR
    value_micro>255999999999997440000 THEN
  RAISE EXCEPTION 'Named scenario amount invalid' USING ERRCODE='22023';
 END IF;
 RETURN to_char(value_micro/1000000,
  'FM999999999999999999999999990.000000');
END $$;

-- This is the Part 6B sum-cents-times-ppm arithmetic with a different explicit
-- weight for each member. It rounds once, after the complete bounded sum.
CREATE FUNCTION public.canonical_forecast_named_scenario_v1_value(
 members JSONB,assumption_values JSONB,scenario_name TEXT,category_value TEXT)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE member JSONB;assumption JSONB;price_text TEXT;price_cents NUMERIC;
 weight_value INTEGER;weighted_sum NUMERIC:=0;
 maximum_product CONSTANT NUMERIC:=25599999999999744000000;
BEGIN
 IF jsonb_typeof(members)<>'array' OR jsonb_typeof(assumption_values)<>'array' OR
   jsonb_array_length(members)>256 OR
   jsonb_array_length(members)<>jsonb_array_length(assumption_values) OR
   scenario_name NOT IN ('adverse','base','favorable') OR
   (category_value IS NOT NULL AND
    category_value NOT IN ('preliminary_estimate','approved_unbooked')) THEN
  RAISE EXCEPTION 'Named scenario arithmetic input invalid' USING ERRCODE='22023';
 END IF;
 FOR member IN SELECT value FROM jsonb_array_elements(members) value LOOP
  IF category_value IS NOT NULL AND member->>'category'<>category_value THEN CONTINUE;END IF;
  SELECT value INTO assumption FROM jsonb_array_elements(assumption_values) value
   WHERE value->>'estimateId'=member->>'estimateId';
  IF assumption IS NULL OR assumption->>'category' IS DISTINCT FROM member->>'category' OR
    assumption->>'estimateSnapshotDigest' IS DISTINCT FROM
      member->>'estimateSnapshotDigest' OR
    assumption#>>'{applicability,decisionId}' IS DISTINCT FROM member->>'decisionId' OR
    assumption#>>'{applicability,issuedVersionId}' IS DISTINCT FROM
      member->>'issuedVersionId' THEN
   RAISE EXCEPTION 'Named scenario member identity invalid' USING ERRCODE='23514';
  END IF;
  price_text:=member->>'priceBeforeTax';
  IF price_text IS NULL OR price_text!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR
    assumption->>'priceBeforeTax' IS DISTINCT FROM price_text OR
    assumption->>'currency' IS DISTINCT FROM member->>'currency' OR
    jsonb_typeof(assumption#>ARRAY['variations',scenario_name,'weightPpm'])<>'number' OR
    assumption#>>ARRAY['variations',scenario_name,'weightPpm']!~
      '^(0|[1-9][0-9]{0,6})$' THEN
   RAISE EXCEPTION 'Named scenario value invalid' USING ERRCODE='23514';
  END IF;
  weight_value:=(assumption#>>ARRAY['variations',scenario_name,'weightPpm'])::integer;
  IF weight_value NOT BETWEEN 0 AND 1000000 THEN
   RAISE EXCEPTION 'Named scenario weight invalid' USING ERRCODE='23514';END IF;
  price_cents:=replace(price_text,'.','')::numeric;
  weighted_sum:=weighted_sum+(price_cents*weight_value);
  IF weighted_sum>maximum_product THEN
   RAISE EXCEPTION 'Named scenario value exceeds bound' USING ERRCODE='54000';END IF;
 END LOOP;
 RETURN trunc((weighted_sum+50)/100);
END $$;

CREATE FUNCTION public.canonical_forecast_named_scenario_v1_unavailable(
 reason_value TEXT,checked_at_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scenarios JSONB;
BEGIN
 scenarios:=jsonb_build_object(
  'adverse',jsonb_build_object('state','unavailable','reason',reason_value,
   'preliminaryEstimate',NULL,'approvedUnbooked',NULL,'total',NULL),
  'base',jsonb_build_object('state','unavailable','reason',reason_value,
   'preliminaryEstimate',NULL,'approvedUnbooked',NULL,'total',NULL),
  'favorable',jsonb_build_object('state','unavailable','reason',reason_value,
   'preliminaryEstimate',NULL,'approvedUnbooked',NULL,'total',NULL));
 RETURN jsonb_build_object(
  'version','m26-named-pipeline-scenario-v1','state','unavailable',
  'reason',reason_value,'checkedAt',public.canonical_forecast_utc_instant(checked_at_value),
  'asOf',NULL,'horizon',NULL,'currency',NULL,
  'target',jsonb_build_object('key','pipeline.open_value_scenario','version','v1'),
  'sourceSnapshot',NULL,'scenarioReview',NULL,'scenarios',scenarios,
  'assumptions','[]'::jsonb,
  'digests',jsonb_build_object('source',NULL,'assumptions',NULL,'output',NULL,
   'review',NULL,'currentness',NULL),
  'currentness',jsonb_build_object('reviewCurrent',FALSE,'sourceCurrent',FALSE,
   'policyCurrent',FALSE,'profileCurrent',FALSE,'refreshRequired',TRUE,
   'correctionOrRevocationApplied',reason_value IN
     ('scenario_review_revoked','scenario_source_changed','scenario_policy_changed',
      'business_profile_changed')),
  'sourceAuthenticated',FALSE,'assumptionSourcesAuthenticated',FALSE,
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'percentilesIssued',FALSE,'earnedRevenueMeasured',FALSE,'cashMeasured',FALSE,
  'researchOnly',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_named_scenario_v1_review_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,expected_revision_value INTEGER,expected_digest_value TEXT,
 assumptions_value JSONB,reason_value TEXT,confirmed_value BOOLEAN,version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;current_row public.canonical_forecast_named_scenario_reviews_v1%ROWTYPE;
 replay public.canonical_forecast_named_scenario_reviews_v1%ROWTYPE;
 inserted public.canonical_forecast_named_scenario_reviews_v1%ROWTYPE;
 policy public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 method_row public.canonical_forecast_pipeline_scenario_method_registration%ROWTYPE;
 profile JSONB;profile_row public.canonical_business_profiles%ROWTYPE;sources JSONB;
 now_value TIMESTAMPTZ;horizon_start TIMESTAMPTZ;horizon_end TIMESTAMPTZ;
 request_assumptions JSONB;normalized JSONB:='[]'::jsonb;
 item JSONB;member JSONB;variations JSONB;variation JSONB;scenario_name TEXT;
 estimate_id_value UUID;category_value TEXT;baseline_weight INTEGER;
 adverse_weight INTEGER;base_weight INTEGER;favorable_weight INTEGER;
 source_digest_value TEXT;assumption_digest_value TEXT;policy_digest_value TEXT;
 key_hash TEXT;request_hash TEXT;canonical_value TEXT;next_revision INTEGER;
 member_count INTEGER;assumption_count INTEGER;current_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   role_value NOT IN ('owner','admin') OR
   key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   action_value NOT IN ('approve','revoke') OR
   expected_revision_value IS NULL OR expected_revision_value NOT BETWEEN 0 AND 9999 OR
   expected_digest_value IS NULL OR
   reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
   octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE OR
   version_value IS DISTINCT FROM 'named-pipeline-scenario-review-v1' OR
   (action_value='approve' AND (jsonb_typeof(assumptions_value)<>'array' OR
     jsonb_array_length(assumptions_value)>256)) OR
   (action_value='revoke' AND assumptions_value IS NOT NULL) THEN
  RAISE EXCEPTION 'Named scenario review input invalid' USING ERRCODE='22023';END IF;
 IF action_value='approve' THEN
  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'estimateId'),'[]'::jsonb)
   INTO request_assumptions FROM jsonb_array_elements(assumptions_value) value;
 ELSE request_assumptions:=NULL;END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version',version_value,'organizationId',org,'actorUserId',actor,
  'action',action_value,'expectedRevision',expected_revision_value,
  'expectedDigest',expected_digest_value,'assumptions',request_assumptions,
  'reason',btrim(reason_value),'confirmed',confirmed_value));
 SELECT * INTO replay FROM public.canonical_forecast_named_scenario_reviews_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Named scenario review request reused' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('state','named_scenario_review_saved','reason',NULL,
   'reviewId',replay.id,'revision',replay.revision,'action',replay.action,
   'digest',rtrim(replay.canonical_digest),'replayed',TRUE,'valuesWithheld',TRUE,
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-policy:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:named-pipeline-scenario:'||org::text,0)) THEN
  RAISE EXCEPTION 'Named scenario review is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_named_scenario_reviews_v1
  WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
 current_digest:=CASE WHEN current_row.id IS NULL THEN 'none'
  ELSE rtrim(current_row.canonical_digest) END;
 IF COALESCE(current_row.revision,0)<>expected_revision_value OR
    current_digest<>expected_digest_value THEN
  RAISE EXCEPTION 'Named scenario review changed' USING ERRCODE='40001';END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 now_value:=public.canonical_forecast_pipeline_scenario_clock();
 IF action_value='revoke' THEN
  canonical_value:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-named-scenario-review-record-v1','organizationId',org,
   'revision',next_revision,'previousId',current_row.id,'action','revoke',
   'actorUserId',actor,'membershipId',authority->>'membershipId',
   'reviewedAt',public.canonical_forecast_utc_instant(now_value),
   'reason',btrim(reason_value)));
  INSERT INTO public.canonical_forecast_named_scenario_reviews_v1(
   organization_id,revision,previous_id,action,actor_user_id,membership_id,
   auth_session_id,reviewed_at,reason,request_key_hash,request_digest,canonical_digest)
  VALUES(org,next_revision,current_row.id,'revoke',actor,
   (authority->>'membershipId')::uuid,session_value,now_value,btrim(reason_value),
   key_hash,request_hash,canonical_value) RETURNING * INTO inserted;
  RETURN jsonb_build_object('state','named_scenario_review_saved','reason',NULL,
   'reviewId',inserted.id,'revision',inserted.revision,'action',inserted.action,
   'digest',rtrim(inserted.canonical_digest),'replayed',FALSE,'valuesWithheld',TRUE,
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
 END IF;
 SELECT * INTO method_row FROM public.canonical_forecast_pipeline_scenario_method_registration
  WHERE version='m26_pipeline_open_value_scenario_bounded_v1';
 IF method_row.version IS NULL OR rtrim(method_row.dependency_closure_digest)<>
    public.canonical_forecast_pipeline_scenario_method_closure_digest() THEN
  RAISE EXCEPTION 'Named scenario dependency changed' USING ERRCODE='40001';END IF;
 SELECT * INTO policy FROM public.canonical_forecast_pipeline_scenario_policy_reviews
  WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
 policy_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-scenario-policy-v1','organizationId',policy.organization_id,
  'revision',policy.revision,'previousId',policy.previous_id,'action',policy.action,
  'methodVersion',policy.method_version,
  'methodClosureDigest',rtrim(policy.method_closure_digest),
  'preliminaryWeightsPpm',CASE WHEN policy.action='approve' THEN jsonb_build_object(
   'lower',policy.preliminary_lower_ppm,'central',policy.preliminary_central_ppm,
   'upper',policy.preliminary_upper_ppm) ELSE NULL END,
  'approvedWeightsPpm',CASE WHEN policy.action='approve' THEN jsonb_build_object(
   'lower',policy.approved_lower_ppm,'central',policy.approved_central_ppm,
   'upper',policy.approved_upper_ppm) ELSE NULL END,
  'reason',btrim(policy.reason)));
 IF policy.id IS NULL OR policy.action<>'approve' OR
   policy.method_version<>method_row.version OR
   rtrim(policy.method_closure_digest)<>rtrim(method_row.dependency_closure_digest) OR
   policy_digest_value IS DISTINCT FROM rtrim(policy.policy_digest) THEN
  RETURN jsonb_build_object('state','named_scenario_review_unavailable',
   'reason','approved_scenario_policy_unavailable','reviewId',NULL,'revision',NULL,
   'action',NULL,'digest',NULL,'replayed',FALSE,'valuesWithheld',TRUE,
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);END IF;
 profile:=public.canonical_forecast_transition_profile_v2(org);
 IF profile IS NULL THEN
  RETURN jsonb_build_object('state','named_scenario_review_unavailable',
   'reason','business_profile_unavailable','reviewId',NULL,'revision',NULL,
   'action',NULL,'digest',NULL,'replayed',FALSE,'valuesWithheld',TRUE,
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=(profile->>'id')::uuid;
 IF profile_row.id IS NULL OR profile_row.raw_profile#>>'{company,currency}'!~'^[A-Z]{3}$' THEN
  RETURN jsonb_build_object('state','named_scenario_review_unavailable',
   'reason','currency_authority_unavailable','reviewId',NULL,'revision',NULL,
   'action',NULL,'digest',NULL,'replayed',FALSE,'valuesWithheld',TRUE,
   'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);END IF;
 sources:=public.canonical_forecast_pipeline_scenario_sources(
  org,actor,role_value,session_value,profile_row.raw_profile#>>'{company,currency}',now_value);
 IF sources->>'state'<>'current_pipeline_scenario_sources' OR
    sources->'sourceCoverageComplete' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('state','named_scenario_review_unavailable',
   'reason',COALESCE(sources->>'reason','pipeline_sources_unavailable'),
   'reviewId',NULL,'revision',NULL,'action',NULL,'digest',NULL,'replayed',FALSE,
   'valuesWithheld',TRUE,'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);END IF;
 member_count:=jsonb_array_length(sources->'members');
 assumption_count:=jsonb_array_length(request_assumptions);
 IF assumption_count<>member_count THEN
  RAISE EXCEPTION 'Named scenario coverage incomplete' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(request_assumptions) value
  ORDER BY value->>'estimateId' LOOP
  IF jsonb_typeof(item)<>'object' OR
    (SELECT count(*) FROM jsonb_object_keys(item))<>4 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(item) key_name
      WHERE key_name NOT IN ('estimateId','estimateSnapshotDigest','category','variations')) OR
    item->>'estimateId'!~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    item->>'estimateSnapshotDigest'!~'^[0-9a-f]{64}$' OR
    item->>'category' NOT IN ('preliminary_estimate','approved_unbooked') OR
    jsonb_typeof(item->'variations')<>'object' OR
    (SELECT count(*) FROM jsonb_object_keys(item->'variations'))<>3 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(item->'variations') key_name
      WHERE key_name NOT IN ('adverse','base','favorable')) THEN
   RAISE EXCEPTION 'Named scenario assumption invalid' USING ERRCODE='22023';END IF;
  estimate_id_value:=(item->>'estimateId')::uuid;
  SELECT value INTO member FROM jsonb_array_elements(sources->'members') value
   WHERE value->>'estimateId'=estimate_id_value::text;
  IF member IS NULL OR member->>'estimateSnapshotDigest' IS DISTINCT FROM
      item->>'estimateSnapshotDigest' OR member->>'category' IS DISTINCT FROM
      item->>'category' OR EXISTS(SELECT 1 FROM jsonb_array_elements(normalized) value
       WHERE value->>'estimateId'=estimate_id_value::text) THEN
   RAISE EXCEPTION 'Named scenario assumption identity invalid' USING ERRCODE='22023';END IF;
  category_value:=member->>'category';
  baseline_weight:=CASE category_value WHEN 'preliminary_estimate'
    THEN policy.preliminary_central_ppm ELSE policy.approved_central_ppm END;
  variations:='{}'::jsonb;
  FOREACH scenario_name IN ARRAY ARRAY['adverse','base','favorable'] LOOP
   variation:=item->'variations'->scenario_name;
   IF jsonb_typeof(variation)<>'object' OR
     (SELECT count(*) FROM jsonb_object_keys(variation))<>2 OR
     EXISTS(SELECT 1 FROM jsonb_object_keys(variation) key_name
       WHERE key_name NOT IN ('weightPpm','reason')) OR
     jsonb_typeof(variation->'weightPpm')<>'number' OR
     variation->>'weightPpm'!~'^(0|[1-9][0-9]{0,6})$' OR
     (variation->>'weightPpm')::integer NOT BETWEEN 0 AND 1000000 OR
     jsonb_typeof(variation->'reason')<>'string' OR
     length(btrim(variation->>'reason')) NOT BETWEEN 10 AND 1000 OR
     octet_length(variation->>'reason')>4000 THEN
    RAISE EXCEPTION 'Named scenario variation invalid' USING ERRCODE='22023';END IF;
   source_digest_value:=public.canonical_completion_digest(jsonb_build_object(
    'version','m26-named-scenario-assumption-source-v1','organizationId',org,
    'estimateId',estimate_id_value,'estimateSnapshotDigest',member->>'estimateSnapshotDigest',
    'category',category_value,'scenario',scenario_name,
    'fromWeightPpm',baseline_weight,'toWeightPpm',(variation->>'weightPpm')::integer,
    'reason',btrim(variation->>'reason'),'authorUserId',actor,
    'membershipId',authority->>'membershipId','reviewRevision',next_revision,
    'recordedAt',public.canonical_forecast_utc_instant(now_value),
    'pipelineSourceDigest',sources->>'sourceDigest'));
   variations:=variations||jsonb_build_object(scenario_name,jsonb_build_object(
    'weightPpm',(variation->>'weightPpm')::integer,
    'changedAssumption',jsonb_build_object('field','conversion_weight_ppm',
      'fromWeightPpm',baseline_weight,'toWeightPpm',(variation->>'weightPpm')::integer),
    'reason',btrim(variation->>'reason'),
    'author',jsonb_build_object('userId',actor,'membershipId',authority->>'membershipId'),
    'source',jsonb_build_object('kind','owner_approved_scenario_assumption',
      'digest',source_digest_value),
    'recordedAt',public.canonical_forecast_utc_instant(now_value),
    'applicability',jsonb_build_object('targetKey','pipeline.open_value_scenario',
      'targetVersion','v1','estimateId',estimate_id_value,'category',category_value,
      'estimateSnapshotDigest',member->>'estimateSnapshotDigest',
      'decisionId',member->>'decisionId','decisionRevision',member->'decisionRevision',
      'decisionDigest',member->>'decisionDigest',
      'issuedVersionId',member->>'issuedVersionId',
      'issuedVersionRevision',member->'issuedVersionRevision',
      'issuedDocumentDigest',member->>'issuedDocumentDigest',
      'priceBeforeTax',member->>'priceBeforeTax','currency',member->>'currency',
      'horizonRuleVersion','next-complete-tenant-local-month-v1'),
    'revision',next_revision));
  END LOOP;
  adverse_weight:=(variations#>>'{adverse,weightPpm}')::integer;
  base_weight:=(variations#>>'{base,weightPpm}')::integer;
  favorable_weight:=(variations#>>'{favorable,weightPpm}')::integer;
  IF adverse_weight>base_weight OR base_weight>favorable_weight OR
     base_weight<>baseline_weight THEN
   RAISE EXCEPTION 'Named scenario order or base invalid' USING ERRCODE='22023';END IF;
  normalized:=normalized||jsonb_build_array(jsonb_build_object(
   'estimateId',estimate_id_value,'estimateSnapshotDigest',member->>'estimateSnapshotDigest',
   'category',category_value,'priceBeforeTax',member->>'priceBeforeTax',
   'currency',member->>'currency',
   'applicability',variations#>'{base,applicability}','variations',variations));
 END LOOP;
 assumption_digest_value:=public.canonical_completion_digest(normalized);
 horizon_start:=(date_trunc('month',now_value AT TIME ZONE (profile->>'timeZone'))+
  INTERVAL '1 month') AT TIME ZONE (profile->>'timeZone');
 horizon_end:=(date_trunc('month',now_value AT TIME ZONE (profile->>'timeZone'))+
  INTERVAL '2 months') AT TIME ZONE (profile->>'timeZone');
 IF horizon_start<=now_value OR horizon_end<=horizon_start THEN
  RAISE EXCEPTION 'Named scenario future horizon invalid' USING ERRCODE='23514';END IF;
 canonical_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-named-scenario-review-record-v1','organizationId',org,
  'revision',next_revision,'previousId',current_row.id,'action','approve',
  'cutoffAt',public.canonical_forecast_utc_instant(now_value),
  'horizonStartsAt',public.canonical_forecast_utc_instant(horizon_start),
  'horizonEndsAt',public.canonical_forecast_utc_instant(horizon_end),
  'timeZone',profile->>'timeZone','currency',sources->>'currency',
  'profileId',profile->>'id','profileVersion',profile->'version',
  'profileHash',profile->>'hash','profileAnchorId',profile->>'anchorId',
  'pipelinePolicyId',policy.id,'pipelinePolicyRevision',policy.revision,
  'pipelinePolicyDigest',rtrim(policy.policy_digest),
  'pipelineSourceDigest',sources->>'sourceDigest','sourceMembers',sources->'members',
  'assumptions',normalized,'assumptionDigest',assumption_digest_value,
  'actorUserId',actor,'membershipId',authority->>'membershipId',
  'reviewedAt',public.canonical_forecast_utc_instant(now_value),
  'reason',btrim(reason_value)));
 INSERT INTO public.canonical_forecast_named_scenario_reviews_v1(
  organization_id,revision,previous_id,action,cutoff_at,horizon_starts_at,
  horizon_ends_at,time_zone,currency,profile_id,profile_version,profile_hash,
  profile_anchor_id,pipeline_policy_id,pipeline_policy_revision,pipeline_policy_digest,
  pipeline_source_digest,source_members,assumptions,assumption_digest,actor_user_id,
  membership_id,auth_session_id,reviewed_at,reason,request_key_hash,request_digest,
  canonical_digest)
 VALUES(org,next_revision,current_row.id,'approve',now_value,horizon_start,horizon_end,
  profile->>'timeZone',sources->>'currency',(profile->>'id')::uuid,
  (profile->>'version')::bigint,profile->>'hash',(profile->>'anchorId')::uuid,
  policy.id,policy.revision,policy.policy_digest,sources->>'sourceDigest',
  sources->'members',normalized,assumption_digest_value,actor,
  (authority->>'membershipId')::uuid,session_value,now_value,btrim(reason_value),
  key_hash,request_hash,canonical_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','named_scenario_review_saved','reason',NULL,
  'reviewId',inserted.id,'revision',inserted.revision,'action',inserted.action,
  'digest',rtrim(inserted.canonical_digest),'replayed',FALSE,'valuesWithheld',TRUE,
  'forecastIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_named_scenario_v1_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_named_scenario_reviews_v1%ROWTYPE;
 policy public.canonical_forecast_pipeline_scenario_policy_reviews%ROWTYPE;
 profile JSONB;profile_row public.canonical_business_profiles%ROWTYPE;sources JSONB;
 now_value TIMESTAMPTZ;policy_digest_value TEXT;review_digest_value TEXT;
 scenarios JSONB;result_value JSONB;output_digest_value TEXT;currentness_digest TEXT;
 adverse_pre NUMERIC;adverse_app NUMERIC;adverse_total NUMERIC;
 base_pre NUMERIC;base_app NUMERIC;base_total NUMERIC;
 favorable_pre NUMERIC;favorable_app NUMERIC;favorable_total NUMERIC;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Named scenario access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:commercial-booking-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:price-decision-order:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:opportunity-eligibility:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:schedule-booking-events:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:pipeline-scenario-policy:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:named-pipeline-scenario:'||org::text,0)) THEN
  RAISE EXCEPTION 'Named scenario is busy' USING ERRCODE='55P03';END IF;
 now_value:=public.canonical_forecast_pipeline_scenario_clock();
 SELECT * INTO saved FROM public.canonical_forecast_named_scenario_reviews_v1
  WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
 IF saved.id IS NULL THEN RETURN public.canonical_forecast_named_scenario_v1_unavailable(
   'no_current_scenario_review',now_value);END IF;
 IF saved.action='revoke' THEN RETURN public.canonical_forecast_named_scenario_v1_unavailable(
   'scenario_review_revoked',now_value);END IF;
 review_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-named-scenario-review-record-v1','organizationId',saved.organization_id,
  'revision',saved.revision,'previousId',saved.previous_id,'action',saved.action,
  'cutoffAt',public.canonical_forecast_utc_instant(saved.cutoff_at),
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'timeZone',saved.time_zone,'currency',saved.currency,'profileId',saved.profile_id,
  'profileVersion',saved.profile_version,'profileHash',rtrim(saved.profile_hash),
  'profileAnchorId',saved.profile_anchor_id,'pipelinePolicyId',saved.pipeline_policy_id,
  'pipelinePolicyRevision',saved.pipeline_policy_revision,
  'pipelinePolicyDigest',rtrim(saved.pipeline_policy_digest),
  'pipelineSourceDigest',rtrim(saved.pipeline_source_digest),
  'sourceMembers',saved.source_members,'assumptions',saved.assumptions,
  'assumptionDigest',rtrim(saved.assumption_digest),'actorUserId',saved.actor_user_id,
  'membershipId',saved.membership_id,
  'reviewedAt',public.canonical_forecast_utc_instant(saved.reviewed_at),
  'reason',btrim(saved.reason)));
 IF review_digest_value IS DISTINCT FROM rtrim(saved.canonical_digest) OR
    public.canonical_completion_digest(saved.assumptions) IS DISTINCT FROM
      rtrim(saved.assumption_digest) THEN
  RAISE EXCEPTION 'Named scenario review integrity invalid' USING ERRCODE='23514';END IF;
 IF now_value<saved.reviewed_at THEN RETURN
  public.canonical_forecast_named_scenario_v1_unavailable('clock_reversal',now_value);END IF;
 IF now_value>=saved.horizon_starts_at THEN RETURN
  public.canonical_forecast_named_scenario_v1_unavailable('scenario_window_elapsed',now_value);END IF;
 profile:=public.canonical_forecast_transition_profile_v2(org);
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=(profile->>'id')::uuid;
 IF profile IS NULL OR profile_row.id IS NULL OR profile->>'id'<>saved.profile_id::text OR
    (profile->>'version')::bigint<>saved.profile_version OR
    profile->>'hash'<>rtrim(saved.profile_hash) OR
    profile->>'anchorId'<>saved.profile_anchor_id::text OR
    profile->>'timeZone'<>saved.time_zone OR
    profile_row.raw_profile#>>'{company,currency}'<>saved.currency THEN
  RETURN public.canonical_forecast_named_scenario_v1_unavailable(
   'business_profile_changed',now_value);END IF;
 SELECT * INTO policy FROM public.canonical_forecast_pipeline_scenario_policy_reviews
  WHERE organization_id=org ORDER BY revision DESC,id DESC LIMIT 1;
 policy_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-pipeline-scenario-policy-v1','organizationId',policy.organization_id,
  'revision',policy.revision,'previousId',policy.previous_id,'action',policy.action,
  'methodVersion',policy.method_version,
  'methodClosureDigest',rtrim(policy.method_closure_digest),
  'preliminaryWeightsPpm',CASE WHEN policy.action='approve' THEN jsonb_build_object(
   'lower',policy.preliminary_lower_ppm,'central',policy.preliminary_central_ppm,
   'upper',policy.preliminary_upper_ppm) ELSE NULL END,
  'approvedWeightsPpm',CASE WHEN policy.action='approve' THEN jsonb_build_object(
   'lower',policy.approved_lower_ppm,'central',policy.approved_central_ppm,
   'upper',policy.approved_upper_ppm) ELSE NULL END,
  'reason',btrim(policy.reason)));
 IF policy.id IS NULL OR policy.id<>saved.pipeline_policy_id OR
    policy.revision<>saved.pipeline_policy_revision OR policy.action<>'approve' OR
    policy_digest_value IS DISTINCT FROM rtrim(saved.pipeline_policy_digest) OR
    rtrim(policy.policy_digest)<>rtrim(saved.pipeline_policy_digest) OR
    rtrim(policy.method_closure_digest)<>
      public.canonical_forecast_pipeline_scenario_method_closure_digest() THEN
  RETURN public.canonical_forecast_named_scenario_v1_unavailable(
   'scenario_policy_changed',now_value);END IF;
 sources:=public.canonical_forecast_pipeline_scenario_sources(
  org,actor,role_value,session_value,saved.currency,saved.cutoff_at);
 IF sources->>'state'<>'current_pipeline_scenario_sources' OR
    sources->'sourceCoverageComplete' IS DISTINCT FROM 'true'::jsonb OR
    sources->>'sourceDigest'<>rtrim(saved.pipeline_source_digest) OR
    sources->'members' IS DISTINCT FROM saved.source_members THEN
  RETURN public.canonical_forecast_named_scenario_v1_unavailable(
   'scenario_source_changed',now_value);END IF;
 adverse_pre:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'adverse','preliminary_estimate');
 adverse_app:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'adverse','approved_unbooked');
 adverse_total:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'adverse',NULL);
 base_pre:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'base','preliminary_estimate');
 base_app:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'base','approved_unbooked');
 base_total:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'base',NULL);
 favorable_pre:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'favorable','preliminary_estimate');
 favorable_app:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'favorable','approved_unbooked');
 favorable_total:=public.canonical_forecast_named_scenario_v1_value(
  saved.source_members,saved.assumptions,'favorable',NULL);
 IF adverse_total>base_total OR base_total>favorable_total THEN
  RAISE EXCEPTION 'Named scenario ordering invalid' USING ERRCODE='23514';END IF;
 scenarios:=jsonb_build_object(
  'adverse',jsonb_build_object('state','assumption_only','reason',NULL,
   'preliminaryEstimate',public.canonical_forecast_named_scenario_v1_amount(adverse_pre),
   'approvedUnbooked',public.canonical_forecast_named_scenario_v1_amount(adverse_app),
   'total',public.canonical_forecast_named_scenario_v1_amount(adverse_total)),
  'base',jsonb_build_object('state','assumption_only','reason',NULL,
   'preliminaryEstimate',public.canonical_forecast_named_scenario_v1_amount(base_pre),
   'approvedUnbooked',public.canonical_forecast_named_scenario_v1_amount(base_app),
   'total',public.canonical_forecast_named_scenario_v1_amount(base_total)),
  'favorable',jsonb_build_object('state','assumption_only','reason',NULL,
   'preliminaryEstimate',public.canonical_forecast_named_scenario_v1_amount(favorable_pre),
   'approvedUnbooked',public.canonical_forecast_named_scenario_v1_amount(favorable_app),
   'total',public.canonical_forecast_named_scenario_v1_amount(favorable_total)));
 output_digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-named-pipeline-scenario-output-v1','organizationId',org,
  'asOf',public.canonical_forecast_utc_instant(saved.cutoff_at),
  'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'timeZone',saved.time_zone,'currency',saved.currency,'scenarios',scenarios,
  'sourceDigest',rtrim(saved.pipeline_source_digest),
  'assumptionDigest',rtrim(saved.assumption_digest),
  'reviewDigest',rtrim(saved.canonical_digest)));
 currentness_digest:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-named-pipeline-scenario-currentness-v1','organizationId',org,
  'reviewDigest',rtrim(saved.canonical_digest),
  'sourceDigest',rtrim(saved.pipeline_source_digest),
  'policyDigest',rtrim(saved.pipeline_policy_digest),'profileHash',rtrim(saved.profile_hash)));
 result_value:=jsonb_build_object(
  'version','m26-named-pipeline-scenario-v1','state','current','reason',NULL,
  'checkedAt',public.canonical_forecast_utc_instant(now_value),
  'asOf',public.canonical_forecast_utc_instant(saved.cutoff_at),
  'horizon',jsonb_build_object(
    'startsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),
    'endsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
    'upperBoundary','exclusive','timeZone',saved.time_zone),
  'currency',saved.currency,
  'target',jsonb_build_object('key','pipeline.open_value_scenario','version','v1'),
  'sourceSnapshot',jsonb_build_object('state','complete_as_of','digest',
    rtrim(saved.pipeline_source_digest),'profile',jsonb_build_object(
      'id',saved.profile_id,'version',saved.profile_version,
      'hash',rtrim(saved.profile_hash),'anchorId',saved.profile_anchor_id,
      'timeZone',saved.time_zone),'pipelinePolicy',jsonb_build_object(
      'id',saved.pipeline_policy_id,'revision',saved.pipeline_policy_revision,
      'digest',rtrim(saved.pipeline_policy_digest)),
    'statuses',sources->'statuses','estimateHighWaterOrder',sources->'estimateHighWaterOrder',
    'pipelineEpochId',sources->>'pipelineEpochId',
    'pipelineEpochDigest',sources->>'pipelineEpochDigest',
    'openRiskDigest',sources->>'openRiskDigest',
    'integratedCommercialSourceDigest',sources->>'integratedCommercialSourceDigest',
    'completeAsOf',TRUE,'hasMore',FALSE),
  'scenarioReview',jsonb_build_object('id',saved.id,'revision',saved.revision,
    'authorUserId',saved.actor_user_id,'membershipId',saved.membership_id,
    'recordedAt',public.canonical_forecast_utc_instant(saved.reviewed_at),
    'digest',rtrim(saved.canonical_digest)),
  'scenarios',scenarios,'assumptions',saved.assumptions,
  'digests',jsonb_build_object('source',rtrim(saved.pipeline_source_digest),
    'assumptions',rtrim(saved.assumption_digest),'output',output_digest_value,
    'review',rtrim(saved.canonical_digest),'currentness',currentness_digest),
  'currentness',jsonb_build_object('reviewCurrent',TRUE,'sourceCurrent',TRUE,
    'policyCurrent',TRUE,'profileCurrent',TRUE,'refreshRequired',FALSE,
    'correctionOrRevocationApplied',FALSE),
  'sourceAuthenticated',TRUE,'assumptionSourcesAuthenticated',TRUE,
  'weightsAreScenarioAssumptions',TRUE,'probabilityCalibrated',FALSE,
  'percentilesIssued',FALSE,'earnedRevenueMeasured',FALSE,'cashMeasured',FALSE,
  'researchOnly',TRUE,'realForecastEligible',FALSE,'forecastIssued',TRUE,
  'paidNumericServing',FALSE,'automaticActionAuthorized',FALSE);
 RETURN result_value;
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_named_scenario_reviews_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_named_scenario_v1_amount(NUMERIC),
 public.canonical_forecast_named_scenario_v1_value(JSONB,JSONB,TEXT,TEXT),
 public.canonical_forecast_named_scenario_v1_unavailable(TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_named_scenario_v1_review_mutate(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,JSONB,TEXT,BOOLEAN,TEXT),
 public.canonical_forecast_named_scenario_v1_current(UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_named_scenario_reviews_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_named_scenario_v1_amount(numeric),public.canonical_forecast_named_scenario_v1_value(jsonb,jsonb,text,text),public.canonical_forecast_named_scenario_v1_unavailable(text,timestamptz) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_named_scenario_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,integer,text,jsonb,text,boolean,text),public.canonical_forecast_named_scenario_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
 END IF;
END $$;
