-- Mission 26 Part 11C: authenticated run-wide currentness and immutable
-- lifecycle evidence. Part 11B receipts remain immutable. Part 11D handoff and
-- every operational action remain outside this migration.

CREATE TABLE public.canonical_forecast_run_dependencies_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL,
 run_id UUID NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN(
  'retell_future_origin_v2','mission24_estimate_decision_snapshot')),
 source_id UUID NOT NULL,
 source_snapshot_digest CHAR(64) NOT NULL CHECK(source_snapshot_digest~'^[0-9a-f]{64}$'),
 algorithm_key TEXT NOT NULL,
 algorithm_version TEXT NOT NULL,
 algorithm_definition_digest CHAR(64) NOT NULL CHECK(algorithm_definition_digest~'^[0-9a-f]{64}$'),
 implementation_digest CHAR(64) NOT NULL CHECK(implementation_digest~'^[0-9a-f]{64}$'),
 build_digest CHAR(64) NOT NULL CHECK(build_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,run_id),
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_runs_v1(organization_id,id) ON DELETE RESTRICT,
 CHECK(rtrim(canonical_digest)=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',organization_id,'runId',run_id,'sourceKind',source_kind,
  'sourceId',source_id,'sourceSnapshotDigest',rtrim(source_snapshot_digest),
  'algorithmKey',algorithm_key,'algorithmVersion',algorithm_version,
  'algorithmDefinitionDigest',rtrim(algorithm_definition_digest),
  'implementationDigest',rtrim(implementation_digest),'buildDigest',rtrim(build_digest))))
);

INSERT INTO public.canonical_forecast_run_dependencies_v1(
 organization_id,run_id,source_kind,source_id,source_snapshot_digest,
 algorithm_key,algorithm_version,algorithm_definition_digest,
 implementation_digest,build_digest,canonical_digest)
SELECT run.organization_id,run.id,'retell_future_origin_v2',run.origin_id,
 run.source_snapshot_digest,run.algorithm_key,run.algorithm_version,
 run.algorithm_definition_digest,run.implementation_digest,run.build_digest,
 public.canonical_completion_digest(jsonb_build_object(
  'organizationId',run.organization_id,'runId',run.id,
  'sourceKind','retell_future_origin_v2','sourceId',run.origin_id,
  'sourceSnapshotDigest',rtrim(run.source_snapshot_digest),
  'algorithmKey',run.algorithm_key,'algorithmVersion',run.algorithm_version,
  'algorithmDefinitionDigest',rtrim(run.algorithm_definition_digest),
  'implementationDigest',rtrim(run.implementation_digest),
  'buildDigest',rtrim(run.build_digest)))
FROM public.canonical_forecast_runs_v1 run;

CREATE FUNCTION public.canonical_forecast_run_dependency_v1_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO public.canonical_forecast_run_dependencies_v1(
  organization_id,run_id,source_kind,source_id,source_snapshot_digest,
  algorithm_key,algorithm_version,algorithm_definition_digest,
  implementation_digest,build_digest,canonical_digest)
 VALUES(NEW.organization_id,NEW.id,'retell_future_origin_v2',NEW.origin_id,
  NEW.source_snapshot_digest,NEW.algorithm_key,NEW.algorithm_version,
  NEW.algorithm_definition_digest,NEW.implementation_digest,NEW.build_digest,
  public.canonical_completion_digest(jsonb_build_object(
   'organizationId',NEW.organization_id,'runId',NEW.id,
   'sourceKind','retell_future_origin_v2','sourceId',NEW.origin_id,
   'sourceSnapshotDigest',rtrim(NEW.source_snapshot_digest),
   'algorithmKey',NEW.algorithm_key,'algorithmVersion',NEW.algorithm_version,
   'algorithmDefinitionDigest',rtrim(NEW.algorithm_definition_digest),
   'implementationDigest',rtrim(NEW.implementation_digest),
   'buildDigest',rtrim(NEW.build_digest))));
 RETURN NEW;
END $$;

CREATE TRIGGER canonical_forecast_run_dependency_v1_capture
 AFTER INSERT ON public.canonical_forecast_runs_v1
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_run_dependency_v1_capture();
CREATE TRIGGER canonical_forecast_run_dependencies_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_run_dependencies_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

CREATE TABLE public.canonical_forecast_run_currentness_events_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL,
 run_id UUID NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000),
 predecessor_event_id UUID,
 predecessor_event_digest CHAR(64),
 state TEXT NOT NULL CHECK(state IN('unchanged_candidate','stale','unavailable')),
 reason TEXT NOT NULL CHECK(reason~'^[a-z][a-z0-9_]{0,79}$'),
 reasons JSONB NOT NULL CHECK(jsonb_typeof(reasons)='array' AND jsonb_array_length(reasons) BETWEEN 1 AND 4),
 source_kind TEXT NOT NULL,
 source_status TEXT NOT NULL CHECK(source_status IN(
  'current','changed','revoked','deleted','retention_expired','unknown','unsupported')),
 captured_source_digest CHAR(64) NOT NULL CHECK(captured_source_digest~'^[0-9a-f]{64}$'),
 current_source_digest CHAR(64),
 algorithm_status TEXT NOT NULL CHECK(algorithm_status IN(
  'current','replaced','withdrawn','unknown')),
 captured_algorithm_identity JSONB NOT NULL CHECK(jsonb_typeof(captured_algorithm_identity)='object'),
 current_algorithm_identity JSONB,
 actor_user_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 currentness_digest CHAR(64) NOT NULL CHECK(currentness_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,run_id,sequence),
 FOREIGN KEY(organization_id,run_id)
  REFERENCES public.canonical_forecast_runs_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(predecessor_event_id)
  REFERENCES public.canonical_forecast_run_currentness_events_v1(id) ON DELETE RESTRICT,
 CHECK((sequence=1 AND predecessor_event_id IS NULL AND predecessor_event_digest IS NULL) OR
       (sequence>1 AND predecessor_event_id IS NOT NULL AND
        predecessor_event_digest~'^[0-9a-f]{64}$')),
 CHECK(current_source_digest IS NULL OR current_source_digest~'^[0-9a-f]{64}$'),
 CHECK(current_algorithm_identity IS NULL OR jsonb_typeof(current_algorithm_identity)='object'),
 CHECK(rtrim(canonical_digest)=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',organization_id,'runId',run_id,'sequence',sequence,
  'predecessorEventId',predecessor_event_id,
  'predecessorEventDigest',rtrim(predecessor_event_digest),'state',state,
  'reason',reason,'reasons',reasons,'sourceKind',source_kind,
  'sourceStatus',source_status,'capturedSourceDigest',rtrim(captured_source_digest),
  'currentSourceDigest',rtrim(current_source_digest),'algorithmStatus',algorithm_status,
  'capturedAlgorithmIdentity',captured_algorithm_identity,
  'currentAlgorithmIdentity',current_algorithm_identity,
  'currentnessDigest',rtrim(currentness_digest))))
);
CREATE INDEX canonical_forecast_run_currentness_events_v1_digest
 ON public.canonical_forecast_run_currentness_events_v1(
  organization_id,run_id,currentness_digest);
CREATE TRIGGER canonical_forecast_run_currentness_events_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_run_currentness_events_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_flow_origin_immutable();

ALTER FUNCTION public.canonical_forecast_run_v1_compare(
 UUID,UUID,TEXT,UUID,UUID,UUID) RENAME TO canonical_forecast_run_v1_compare_11b_raw;
ALTER FUNCTION public.canonical_forecast_run_v1_controlled_rerun(
 UUID,UUID,TEXT,UUID,TEXT,UUID) RENAME TO canonical_forecast_run_v1_controlled_rerun_11b_raw;

CREATE FUNCTION public.canonical_forecast_run_currentness_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_runs_v1%ROWTYPE;
 dependency public.canonical_forecast_run_dependencies_v1%ROWTYPE;
 registry public.canonical_forecast_deterministic_baseline_algorithms_v1%ROWTYPE;
 calculator public.canonical_forecast_run_calculators_v1%ROWTYPE;
 settings_value public.canonical_forecast_settings_revisions_v1%ROWTYPE;
 prior public.canonical_forecast_run_currentness_events_v1%ROWTYPE;
 state_value TEXT;reason_value TEXT;reasons_value JSONB;source_status_value TEXT;
 algorithm_status_value TEXT;current_source_digest_value TEXT;
 current_algorithm_value JSONB;captured_algorithm_value JSONB;projection JSONB;
 projection_digest TEXT;event_digest TEXT;installed_calculator_digest TEXT;
 inserted_event UUID;
BEGIN
 PERFORM set_config('lock_timeout','2000ms',TRUE);
 PERFORM set_config('statement_timeout','8000ms',TRUE);
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF run_value IS NULL THEN RETURN jsonb_build_object(
  'version','m26-forecast-run-currentness-v1','state','unavailable',
  'reason','run_not_found','reasons',jsonb_build_array('run_not_found'),
  'runId',NULL,'runDigest',NULL,'adviceDisplayAuthorized',FALSE,
  'digest',public.canonical_completion_digest(jsonb_build_object(
   'version','m26-forecast-run-currentness-v1','state','unavailable',
   'reason','run_not_found','reasons',jsonb_build_array('run_not_found'),
   'runId',NULL,'runDigest',NULL,'adviceDisplayAuthorized',FALSE)));END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||run_value::text,256));
 SELECT * INTO saved FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org AND id=run_value FOR SHARE NOWAIT;
 IF saved.id IS NULL THEN RETURN jsonb_build_object(
  'version','m26-forecast-run-currentness-v1','state','unavailable',
  'reason','run_not_found','reasons',jsonb_build_array('run_not_found'),
  'runId',NULL,'runDigest',NULL,'adviceDisplayAuthorized',FALSE,
  'digest',public.canonical_completion_digest(jsonb_build_object(
   'version','m26-forecast-run-currentness-v1','state','unavailable',
   'reason','run_not_found','reasons',jsonb_build_array('run_not_found'),
   'runId',NULL,'runDigest',NULL,'adviceDisplayAuthorized',FALSE)));END IF;
 SELECT * INTO dependency FROM public.canonical_forecast_run_dependencies_v1
  WHERE organization_id=org AND run_id=saved.id FOR SHARE NOWAIT;
 SELECT * INTO settings_value FROM public.canonical_forecast_settings_revisions_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 captured_algorithm_value:=jsonb_build_object(
  'key',saved.algorithm_key,'version',saved.algorithm_version,
  'definitionDigest',rtrim(saved.algorithm_definition_digest),
  'implementationDigest',rtrim(saved.implementation_digest),
  'buildDigest',rtrim(saved.build_digest));

 IF dependency.id IS NULL OR
    rtrim(dependency.canonical_digest)<>public.canonical_completion_digest(jsonb_build_object(
     'organizationId',saved.organization_id,'runId',saved.id,
     'sourceKind',dependency.source_kind,'sourceId',dependency.source_id,
     'sourceSnapshotDigest',rtrim(dependency.source_snapshot_digest),
     'algorithmKey',dependency.algorithm_key,'algorithmVersion',dependency.algorithm_version,
     'algorithmDefinitionDigest',rtrim(dependency.algorithm_definition_digest),
     'implementationDigest',rtrim(dependency.implementation_digest),
     'buildDigest',rtrim(dependency.build_digest))) THEN
  source_status_value:='unknown';algorithm_status_value:='unknown';
  state_value:='unavailable';reason_value:='dependency_index_unavailable';
  reasons_value:=jsonb_build_array('source_unknown','algorithm_unknown');
 ELSIF settings_value.id IS NULL OR settings_value.revision<>saved.settings_revision OR
       rtrim(settings_value.canonical_digest)<>rtrim(saved.settings_digest) THEN
  source_status_value:='unknown';algorithm_status_value:='unknown';
  state_value:='unavailable';reason_value:='settings_not_current';
  reasons_value:=jsonb_build_array('settings_not_current');
 ELSE
  SELECT * INTO registry FROM public.canonical_forecast_deterministic_baseline_algorithms_v1
   WHERE algorithm_key=saved.algorithm_key AND algorithm_version=saved.algorithm_version;
  SELECT * INTO calculator FROM public.canonical_forecast_run_calculators_v1
   WHERE calculator_key='demand.inbound_leads.monthly_mean' AND
    calculator_version='m26-run-calculator-v1';
  installed_calculator_digest:=encode(sha256(convert_to(pg_get_functiondef(
   'public.canonical_forecast_run_v1_calculate(jsonb)'::regprocedure),'UTF8')),'hex');
  IF registry.algorithm_key IS NULL OR calculator.calculator_key IS NULL OR
     rtrim(registry.definition_digest)<>rtrim(saved.algorithm_definition_digest) OR
     rtrim(registry.implementation_digest)<>rtrim(saved.implementation_digest) OR
     rtrim(calculator.implementation_digest)<>rtrim(saved.build_digest) OR
     rtrim(calculator.implementation_digest)<>installed_calculator_digest THEN
   algorithm_status_value:='unknown';current_algorithm_value:=NULL;
  ELSE
   algorithm_status_value:='current';current_algorithm_value:=captured_algorithm_value;
  END IF;
  -- Part 11B currently stores Retell future origins. Mission 24's authenticated
  -- estimate-decision currentness reader is the only accepted source lifecycle
  -- authority. Until a Retell adapter exists, no caller flag may assert current.
  IF dependency.source_kind='retell_future_origin_v2' THEN
   source_status_value:='unsupported';current_source_digest_value:=NULL;
  ELSE
   source_status_value:='unknown';current_source_digest_value:=NULL;
  END IF;
  IF source_status_value='unsupported' THEN
   state_value:='unavailable';reason_value:='unsupported_source_currentness';
   reasons_value:=CASE WHEN algorithm_status_value='current'
    THEN jsonb_build_array('source_unknown')
    ELSE jsonb_build_array('source_unknown','algorithm_unknown') END;
  ELSIF source_status_value<>'current' THEN
   state_value:='unavailable';reason_value:='source_currentness_unknown';
   reasons_value:=CASE WHEN algorithm_status_value='current'
    THEN jsonb_build_array('source_unknown')
    ELSE jsonb_build_array('source_unknown','algorithm_unknown') END;
  ELSIF algorithm_status_value<>'current' THEN
   state_value:='unavailable';reason_value:='algorithm_unknown';
   reasons_value:=jsonb_build_array('algorithm_unknown');
  ELSE
   state_value:='unchanged_candidate';reason_value:='unchanged_candidate';
   reasons_value:=jsonb_build_array('unchanged_candidate');
  END IF;
 END IF;
 projection:=jsonb_build_object(
  'version','m26-forecast-run-currentness-v1','state',state_value,
  'reason',reason_value,'reasons',reasons_value,
  'runId',CASE WHEN state_value='unavailable' THEN NULL ELSE saved.id END,
  'runDigest',CASE WHEN state_value='unavailable' THEN NULL ELSE rtrim(saved.canonical_digest) END,
  'adviceDisplayAuthorized',FALSE);
 projection_digest:=public.canonical_completion_digest(projection);
 projection:=projection||jsonb_build_object('digest',projection_digest);

 SELECT * INTO prior FROM public.canonical_forecast_run_currentness_events_v1
  WHERE organization_id=org AND run_id=saved.id ORDER BY sequence DESC LIMIT 1;
 IF prior.id IS NULL OR rtrim(prior.currentness_digest)<>projection_digest THEN
  event_digest:=public.canonical_completion_digest(jsonb_build_object(
   'organizationId',org,'runId',saved.id,'sequence',coalesce(prior.sequence,0)+1,
   'predecessorEventId',prior.id,'predecessorEventDigest',rtrim(prior.canonical_digest),
   'state',state_value,'reason',reason_value,'reasons',reasons_value,
   'sourceKind',coalesce(dependency.source_kind,'unknown'),
   'sourceStatus',source_status_value,
   'capturedSourceDigest',rtrim(saved.source_snapshot_digest),
   'currentSourceDigest',current_source_digest_value,
   'algorithmStatus',algorithm_status_value,
   'capturedAlgorithmIdentity',captured_algorithm_value,
   'currentAlgorithmIdentity',current_algorithm_value,
   'currentnessDigest',projection_digest));
  INSERT INTO public.canonical_forecast_run_currentness_events_v1(
   organization_id,run_id,sequence,predecessor_event_id,predecessor_event_digest,
   state,reason,reasons,source_kind,source_status,captured_source_digest,
   current_source_digest,algorithm_status,captured_algorithm_identity,
   current_algorithm_identity,actor_user_id,auth_session_id,currentness_digest,
   canonical_digest)
  VALUES(org,saved.id,coalesce(prior.sequence,0)+1,prior.id,prior.canonical_digest,
   state_value,reason_value,reasons_value,coalesce(dependency.source_kind,'unknown'),
   source_status_value,saved.source_snapshot_digest,current_source_digest_value,
   algorithm_status_value,captured_algorithm_value,current_algorithm_value,
   actor,session_value,projection_digest,event_digest) RETURNING id INTO inserted_event;
  INSERT INTO public.audit_logs(organization_id,user_id,action,entity_type,entity_id,details)
  VALUES(org,actor,'forecast_run_currentness_recorded','forecast_run',saved.id::text,
   jsonb_build_object('eventId',inserted_event,'state',state_value,
    'reason',reason_value,'currentnessDigest',projection_digest,
    'adviceDisplayAuthorized',FALSE));
 END IF;
 RETURN projection;
END $$;

CREATE FUNCTION public.canonical_forecast_run_currentness_v1_latest(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE run_value UUID;
BEGIN
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT id INTO run_value FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org ORDER BY created_at DESC,id DESC LIMIT 1;
 RETURN public.canonical_forecast_run_currentness_v1_read(
  org,actor,role_value,session_value,run_value);
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_current_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE decision JSONB;
BEGIN
 decision:=public.canonical_forecast_run_currentness_v1_read(
  org,actor,role_value,session_value,run_value);
 IF decision->>'state'='unchanged_candidate' THEN
  RETURN public.canonical_forecast_run_v1_read(
   org,actor,role_value,session_value,run_value);
 END IF;
 RETURN jsonb_build_object('state','unavailable','reason',decision->>'reason','runs',NULL);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_run_v1_list(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item public.canonical_forecast_runs_v1%ROWTYPE;decision JSONB;
 projection JSONB;items JSONB:='[]'::jsonb;
BEGIN
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 FOR item IN SELECT * FROM public.canonical_forecast_runs_v1
  WHERE organization_id=org ORDER BY created_at DESC,id DESC LIMIT 20 LOOP
  decision:=public.canonical_forecast_run_currentness_v1_read(
   org,actor,role_value,session_value,item.id);
  IF decision->>'state'<>'unchanged_candidate' THEN
   RETURN jsonb_build_object('state','unavailable','reason',decision->>'reason','runs',NULL);
  END IF;
  projection:=public.canonical_forecast_run_v1_current_read(
   org,actor,role_value,session_value,item.id);
  IF projection->>'state'<>'current' THEN RETURN jsonb_build_object(
   'state','unavailable','reason',projection->>'reason','runs',NULL);END IF;
  items:=items||jsonb_build_array(projection);
 END LOOP;
 RETURN jsonb_build_object('state','current','runs',items);
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_compare(
 org UUID,actor UUID,role_value TEXT,session_value UUID,left_id UUID,right_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE left_decision JSONB;right_decision JSONB;
BEGIN
 IF left_id IS NULL OR right_id IS NULL OR left_id=right_id THEN
  RAISE EXCEPTION 'Forecast comparison invalid' USING ERRCODE='22023';END IF;
 left_decision:=public.canonical_forecast_run_currentness_v1_read(
  org,actor,role_value,session_value,left_id);
 right_decision:=public.canonical_forecast_run_currentness_v1_read(
  org,actor,role_value,session_value,right_id);
 IF left_decision->>'state'<>'unchanged_candidate' OR
    right_decision->>'state'<>'unchanged_candidate' THEN
  RETURN jsonb_build_object('state','unavailable','reason',CASE
   WHEN left_decision->>'state'<>'unchanged_candidate' THEN left_decision->>'reason'
   ELSE right_decision->>'reason' END,'comparison',NULL);
 END IF;
 RETURN public.canonical_forecast_run_v1_compare_11b_raw(
  org,actor,role_value,session_value,left_id,right_id);
END $$;

CREATE FUNCTION public.canonical_forecast_run_v1_controlled_rerun(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,run_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE decision JSONB;
BEGIN
 PERFORM public.canonical_forecast_run_v1_paid_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 decision:=public.canonical_forecast_run_currentness_v1_read(
  org,actor,role_value,session_value,run_value);
 IF decision->>'state'='unchanged_candidate' THEN
  RETURN public.canonical_forecast_run_v1_controlled_rerun_11b_raw(
   org,actor,role_value,session_value,csrf,run_value);
 END IF;
 RETURN jsonb_build_object('state','unavailable','reason',decision->>'reason',
  'runId',NULL,'comparison',NULL);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_run_dependencies_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_run_currentness_events_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_dependency_v1_capture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_compare_11b_raw(
 UUID,UUID,TEXT,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_controlled_rerun_11b_raw(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_currentness_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_currentness_v1_latest(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_current_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_compare(
 UUID,UUID,TEXT,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_controlled_rerun(
 UUID,UUID,TEXT,UUID,TEXT,UUID) FROM PUBLIC;

DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' THEN
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_run_dependencies_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON TABLE public.canonical_forecast_run_currentness_events_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_run_dependency_v1_capture() FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_read(uuid,uuid,text,uuid,uuid) FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_compare_11b_raw(uuid,uuid,text,uuid,uuid,uuid) FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_run_v1_controlled_rerun_11b_raw(uuid,uuid,text,uuid,text,uuid) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_currentness_v1_latest(uuid,uuid,text,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_current_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_compare(uuid,uuid,text,uuid,uuid,uuid) TO %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_run_v1_controlled_rerun(uuid,uuid,text,uuid,text,uuid) TO %I',runtime_role);
 END IF;
END $$;
