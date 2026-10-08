-- Mission 26 Part 11A: immutable, owner-reviewed forecast settings.
-- A setting is preference only.  It does not issue a forecast or establish
-- source completeness, algorithm promotion, calibration, or outcome finality.

CREATE TABLE public.canonical_forecast_settings_revisions_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),
 effective_at TIMESTAMPTZ NOT NULL,
 actor_user_id UUID NOT NULL,
 actor_access_role TEXT NOT NULL CHECK(actor_access_role IN('owner','admin')),
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 normalized JSONB NOT NULL,
 canonical_json TEXT NOT NULL CHECK(octet_length(canonical_json) BETWEEN 2 AND 16384),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 supersedes_digest CHAR(64),
 request_key_digest CHAR(64) NOT NULL CHECK(request_key_digest~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_digest),
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(normalized=(canonical_json::jsonb||jsonb_build_object('digest',rtrim(canonical_digest)))),
 CHECK(rtrim(canonical_digest)=encode(sha256(convert_to(canonical_json,'UTF8')),'hex')),
 CHECK(normalized->>'organizationId'=organization_id::text),
 CHECK((normalized->>'revision')::integer=revision),
 CHECK(normalized->'source'->>'actorUserId'=actor_user_id::text),
 CHECK(normalized->'source'->>'kind'='owner_reviewed'),
 CHECK(normalized->>'version'='m26-forecast-settings-v1'),
 CHECK((revision=1 AND supersedes_digest IS NULL AND
        normalized->'source'->'supersedesDigest'='null'::jsonb) OR
       (revision>1 AND supersedes_digest IS NOT NULL AND
        normalized->'source'->>'supersedesDigest'=rtrim(supersedes_digest)))
);

CREATE FUNCTION public.canonical_forecast_settings_v1_immutable()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Forecast settings history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER canonical_forecast_settings_revisions_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_settings_revisions_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_settings_v1_immutable();

CREATE FUNCTION public.canonical_forecast_settings_v1_authority()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE registry public.canonical_forecast_deterministic_baseline_algorithms_v1%ROWTYPE;
 expected JSONB; installed TEXT; available BOOLEAN:=FALSE;
BEGIN
 expected:=jsonb_build_object(
  'key','retell_three_complete_month_mean',
  'version','m26-retell-three-month-mean-v2',
  'target',jsonb_build_object('key','demand.inbound_leads','definitionVersion','v1'),
  'sourceScope','retell_only_tenant_all','kind','deterministic',
  'method','arithmetic_mean_comparable_prior_periods',
  'parameters',jsonb_build_object('minimumPeriods',3,'decimalScale',6,
    'rounding','half_up','observationOrder','local_month_start_ascending'),
  'horizonGrain','business_local_month','unit','count',
  'outputContractVersion','m26-forecast-output-v1',
  'probabilityPolicy','unavailable','rangePolicy','unavailable',
  'trainingReceiptDigest',NULL);
 SELECT * INTO registry
 FROM public.canonical_forecast_deterministic_baseline_algorithms_v1
 WHERE algorithm_key='retell_three_complete_month_mean'
   AND algorithm_version='m26-retell-three-month-mean-v2';
 IF registry.algorithm_key IS NOT NULL THEN
  installed:=encode(sha256(convert_to(pg_get_functiondef(
   'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)'::regprocedure),
   'UTF8')),'hex');
  available:=registry.definition IS NOT DISTINCT FROM expected AND
   rtrim(registry.definition_digest)=public.canonical_completion_digest(registry.definition) AND
   registry.implementation_identity=
    'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)' AND
   rtrim(registry.implementation_digest)=installed;
 END IF;
 RETURN jsonb_build_object(
  'version','m26-forecast-settings-authority-v1',
  'targets',CASE WHEN available THEN jsonb_build_array(jsonb_build_object(
    'key','demand.inbound_leads','label','Inbound leads',
    'definitionVersion','v1','unit','count','sourceScope','retell_only_tenant_all',
    'algorithmKey','retell_three_complete_month_mean',
    'algorithmVersion','m26-retell-three-month-mean-v2',
    'algorithmDefinitionDigest',rtrim(registry.definition_digest),
    'implementationDigest',rtrim(registry.implementation_digest),
    'supportedGrains',jsonb_build_array('month')))
   ELSE '[]'::jsonb END,
  'limits',jsonb_build_object('targets',24,'horizons',12,'periodsPerHorizon',100),
  'preferenceProves',jsonb_build_object(
    'sourceAuthority',FALSE,'targetRegistration',FALSE,'algorithmPromotion',FALSE,
    'intervalCalibration',FALSE,'actualFinality',FALSE,'issuanceEligibility',FALSE),
  'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_settings_v1_source_current(org UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE((SELECT
   consent.action='grant' AND
   consent.source_scope='["retell.inbound_calls"]'::jsonb AND
   consent.consent_version='m26-retell-demand-source-consent-v1'
  FROM public.canonical_forecast_retell_source_consents consent
  WHERE consent.organization_id=org AND consent.purpose_key='forecast_demand_source'
  ORDER BY consent.revision DESC LIMIT 1),FALSE)
$$;

CREATE FUNCTION public.canonical_forecast_settings_v1_settings_valid(value JSONB,org UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE enabled BOOLEAN; authority JSONB; horizon JSONB;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(value,
    ARRAY['enabled','targets','horizons','scenarioDisplay','comparisonDisplay',
      'alertDelivery','actionPolicy']) IS NOT TRUE OR
    jsonb_typeof(value->'enabled')<>'boolean' OR
    jsonb_typeof(value->'targets')<>'array' OR
    jsonb_typeof(value->'horizons')<>'array' OR
    jsonb_array_length(value->'targets')>24 OR
    jsonb_array_length(value->'horizons')>12 OR
    value->>'scenarioDisplay' NOT IN('withhold','deterministic_when_eligible','calibrated_when_eligible') OR
    value->>'comparisonDisplay' NOT IN('none','prior','actual','prior_and_actual') OR
    value->>'alertDelivery' NOT IN('off','in_app_review_only') OR
    value->>'actionPolicy'<>'review_required' THEN RETURN FALSE;END IF;
 enabled:=(value->>'enabled')::boolean;
 IF NOT enabled THEN RETURN jsonb_array_length(value->'targets')=0 AND
   jsonb_array_length(value->'horizons')=0 AND value->>'scenarioDisplay'='withhold' AND
   value->>'comparisonDisplay'='none' AND value->>'alertDelivery'='off';END IF;
 -- The only current released target/algorithm authority is the Part 9A
 -- deterministic monthly demand baseline. Preferences remain narrower than
 -- the defensive contract limits until another authority is released.
 authority:=public.canonical_forecast_settings_v1_authority();
 IF jsonb_array_length(authority->'targets')<>1 OR
    public.canonical_forecast_settings_v1_source_current(org) IS NOT TRUE OR
    value->'targets'<>jsonb_build_array('demand.inbound_leads') OR
    jsonb_array_length(value->'horizons')<>1 THEN RETURN FALSE;END IF;
 horizon:=value->'horizons'->0;
 RETURN public.canonical_field_evidence_object_keys_exact(horizon,ARRAY['grain','periods']) IS TRUE AND
   horizon->>'grain'='month' AND jsonb_typeof(horizon->'periods')='number' AND
   horizon->>'periods'~'^[1-9][0-9]{0,2}$' AND (horizon->>'periods')::integer BETWEEN 1 AND 100;
END $$;

CREATE FUNCTION public.canonical_forecast_settings_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 authority JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'Forecast settings access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.subscriptions subscription
 JOIN public.organization_onboarding onboarding
  ON onboarding.organization_id=subscription.organization_id
 WHERE subscription.organization_id=org AND onboarding.status='complete'
  AND (subscription.status='active' OR (subscription.status='trialing' AND
   subscription.trial_started_at IS NOT NULL AND
   subscription.trial_ends_at=subscription.trial_started_at+INTERVAL '14 days' AND
   subscription.trial_ends_at>clock_timestamp()));
 IF NOT FOUND THEN RAISE EXCEPTION 'Forecast settings access unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_forecast_settings_v1_authority();
 SELECT * INTO selected FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF selected.id IS NULL THEN RETURN jsonb_build_object(
   'state','current','settings',NULL,'authority',authority);END IF;
 IF public.canonical_forecast_settings_v1_settings_valid(selected.normalized->'settings',org) IS NOT TRUE THEN
  RETURN jsonb_build_object('state','unavailable',
   'reason','selected_target_algorithm_or_source_authority_changed',
   'settings',NULL,'authority',authority);END IF;
 RETURN jsonb_build_object('state','current','settings',selected.normalized,
  'authority',authority);
END $$;

CREATE FUNCTION public.canonical_forecast_settings_v1_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
 key_value TEXT,request_hash TEXT,expected_revision INTEGER,
 expected_digest TEXT,canonical_value TEXT,normalized_value JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority_record JSONB; replay public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 current_row public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 inserted public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 authority_value JSONB; key_hash TEXT; supplied_digest TEXT; effective_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'Forecast settings access restricted' USING ERRCODE='42501';END IF;
 authority_record:=public.canonical_field_execution_actor_authority(
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
 -- Serialize a request-key replay before serializing the tenant revision.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:forecast-settings-request:'||org::text||':'||actor::text||':'||key_hash,0));
 -- Share the source-consent mutation lane so an enabled revision cannot be
 -- accepted across a concurrent permission revocation.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  org::text||':forecast-retell-source-consent',0));
 SELECT * INTO replay FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_digest=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Forecast settings request key conflict' USING ERRCODE='23505';END IF;
  IF public.canonical_forecast_settings_v1_settings_valid(replay.normalized->'settings',org) IS NOT TRUE THEN
   RETURN jsonb_build_object('state','unavailable',
    'reason','selected_target_algorithm_or_source_authority_changed',
    'settings',NULL,'authority',public.canonical_forecast_settings_v1_authority(),
    'replayed',TRUE);
  END IF;
  RETURN jsonb_build_object('state','current','settings',replay.normalized,
   'authority',public.canonical_forecast_settings_v1_authority(),'replayed',TRUE);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:forecast-settings:'||org::text,0));
 SELECT * INTO current_row FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF COALESCE(current_row.revision,0)<>expected_revision OR
    (expected_revision>0 AND rtrim(current_row.canonical_digest)<>expected_digest) THEN
  RAISE EXCEPTION 'Forecast settings changed' USING ERRCODE='40001';END IF;
 supplied_digest:=normalized_value->>'digest';
 IF supplied_digest IS NULL OR supplied_digest!~'^[0-9a-f]{64}$' OR
    normalized_value<>(canonical_value::jsonb||jsonb_build_object('digest',supplied_digest)) OR
    normalized_value->>'version'<>'m26-forecast-settings-v1' OR
    normalized_value->>'organizationId'<>org::text OR
    (normalized_value->>'revision')::integer<>expected_revision+1 OR
    normalized_value->'source'->>'kind'<>'owner_reviewed' OR
    normalized_value->'source'->>'actorUserId'<>actor::text OR
    normalized_value->'source'->'supersedesDigest' IS DISTINCT FROM
      (CASE WHEN expected_digest IS NULL THEN 'null'::jsonb
        ELSE to_jsonb(expected_digest) END) OR
    public.canonical_forecast_settings_v1_settings_valid(normalized_value->'settings',org) IS NOT TRUE THEN
  RAISE EXCEPTION 'Forecast settings payload invalid' USING ERRCODE='22023';END IF;
 BEGIN effective_value:=(normalized_value->>'effectiveAt')::timestamptz;
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Forecast settings time invalid' USING ERRCODE='22023';END;
 IF effective_value<clock_timestamp()-INTERVAL '5 minutes' OR
    effective_value>clock_timestamp()+INTERVAL '1 minute' THEN
  RAISE EXCEPTION 'Forecast settings time invalid' USING ERRCODE='22023';END IF;
 INSERT INTO public.canonical_forecast_settings_revisions_v1(
  organization_id,revision,effective_at,actor_user_id,actor_access_role,
  membership_id,auth_session_id,
  normalized,canonical_json,canonical_digest,supersedes_digest,
  request_key_digest,request_digest)
 VALUES(org,expected_revision+1,effective_value,actor,role_value,
  (authority_record->>'membershipId')::uuid,session_value,normalized_value,
  canonical_value,supplied_digest,expected_digest,key_hash,request_hash)
 RETURNING * INTO inserted;
 INSERT INTO public.audit_logs(organization_id,user_id,action,entity_type,entity_id,details)
 VALUES(org,actor,'forecast_settings_revision_accepted','forecast_settings',inserted.id::text,
  jsonb_build_object('revision',inserted.revision,'digest',rtrim(inserted.canonical_digest),
   'supersedesDigest',expected_digest,'actorAccessRole',inserted.actor_access_role,'enabled',
   (inserted.normalized#>>'{settings,enabled}')::boolean,
   'targetCount',jsonb_array_length(inserted.normalized#>'{settings,targets}'),
   'horizonCount',jsonb_array_length(inserted.normalized#>'{settings,horizons}')));
 authority_value:=public.canonical_forecast_settings_v1_authority();
 RETURN jsonb_build_object('state','current','settings',inserted.normalized,
  'authority',authority_value,'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_settings_revisions_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_v1_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_v1_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_v1_source_current(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_v1_settings_valid(JSONB,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_v1_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_settings_v1_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_settings_v1_read(uuid,uuid,text,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_settings_v1_capture(uuid,uuid,text,uuid,text,text,text,integer,text,text,jsonb) TO %I',runtime_role);
 END IF;
END $$;
