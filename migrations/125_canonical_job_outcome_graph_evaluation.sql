CREATE FUNCTION public.canonical_job_outcome_graph_required_domains_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(value)='array' AND jsonb_array_length(value) BETWEEN 1 AND 7
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value)x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN ('labor','travel','equipment','materials','customer','scope','financial'))
  AND (SELECT count(*)=count(DISTINCT x#>>'{}') FROM jsonb_array_elements(value)x)
  AND value=(SELECT jsonb_agg(x ORDER BY x#>>'{}') FROM jsonb_array_elements(value)x)
$$;

CREATE FUNCTION public.canonical_job_outcome_graph_evaluate_manifest(nodes JSONB,required_domains JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE domain_value TEXT; domain_nodes JSONB; domain_count INTEGER; required_value BOOLEAN; conflict_items JSONB:='[]'::jsonb;
 result_domains JSONB:='[]'::jsonb; conflict_count INTEGER:=0; missing_count INTEGER:=0; covered_required INTEGER:=0;
 slot_value TEXT; slot_count INTEGER; slot_kinds JSONB;
BEGIN
 IF public.canonical_job_outcome_graph_manifest_valid(nodes) IS NOT TRUE OR public.canonical_job_outcome_graph_required_domains_valid(required_domains) IS NOT TRUE THEN
  RAISE EXCEPTION 'Job outcome evaluation details invalid' USING ERRCODE='22023';
 END IF;
 FOR domain_value IN SELECT unnest(ARRAY['labor','travel','equipment','materials','customer','scope','financial']) LOOP
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'nodeKind',x->>'observationId'),'[]'::jsonb),count(*) INTO domain_nodes,domain_count FROM jsonb_array_elements(nodes)x WHERE x->>'domain'=domain_value;
  required_value:=required_domains ? domain_value;
  FOR slot_value,slot_count,slot_kinds IN
   SELECT slot,count(*),jsonb_agg(DISTINCT kind ORDER BY kind) FROM(
    SELECT CASE x->>'nodeKind'
     WHEN 'native_labor' THEN 'labor_work' WHEN 'imported_labor' THEN 'labor_work'
     WHEN 'imported_travel' THEN 'travel_route'
     WHEN 'native_equipment' THEN 'equipment_use' WHEN 'imported_asset' THEN 'equipment_use'
     WHEN 'native_material' THEN 'material_quantity' WHEN 'imported_material_quantity' THEN 'material_quantity'
     WHEN 'imported_material_cost' THEN 'material_cost'
     WHEN 'external_customer' THEN 'customer_response'
     WHEN 'external_project' THEN 'scope_delivery'
     WHEN 'external_financial' THEN 'financial_actuals' END slot,x->>'nodeKind' kind
    FROM jsonb_array_elements(domain_nodes)x)s GROUP BY slot HAVING count(*)>1 ORDER BY slot
  LOOP
   conflict_items:=conflict_items||jsonb_build_array(jsonb_build_object('domain',domain_value,'claimSlot',slot_value,'nodeCount',slot_count,'nodeKinds',slot_kinds,'status','needs_review','message','More than one current source covers this part of the job. Review the sources before relying on it.'));
   conflict_count:=conflict_count+1;
  END LOOP;
  IF required_value AND domain_count=0 THEN missing_count:=missing_count+1;
  ELSIF required_value AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(conflict_items)c WHERE c->>'domain'=domain_value) THEN covered_required:=covered_required+1;
  END IF;
  result_domains:=result_domains||jsonb_build_array(jsonb_build_object(
   'domain',domain_value,'required',required_value,'nodeCount',domain_count,
   'nodeKinds',COALESCE((SELECT jsonb_agg(DISTINCT x->>'nodeKind' ORDER BY x->>'nodeKind') FROM jsonb_array_elements(domain_nodes)x),'[]'::jsonb),
   'status',CASE WHEN domain_count=0 AND required_value THEN 'missing' WHEN domain_count=0 THEN 'not_required' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(conflict_items)c WHERE c->>'domain'=domain_value) THEN 'needs_review' ELSE 'covered' END,
   'message',CASE WHEN domain_count=0 AND required_value THEN 'This required job outcome has no current evidence.' WHEN domain_count=0 THEN 'This outcome was not required for this review.' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(conflict_items)c WHERE c->>'domain'=domain_value) THEN 'Current sources overlap and need review.' ELSE 'Current evidence covers this part of the job.' END));
 END LOOP;
 RETURN jsonb_build_object(
  'freshness',jsonb_build_object('status','current','message','The connected evidence is current for this review.'),
  'completeness',jsonb_build_object('status',CASE WHEN missing_count=0 AND conflict_count=0 THEN 'complete' ELSE 'needs_attention' END,'complete',missing_count=0 AND conflict_count=0,'requiredDomainCount',jsonb_array_length(required_domains),'coveredRequiredDomainCount',covered_required,'missingRequiredDomainCount',missing_count,'message',CASE WHEN missing_count=0 AND conflict_count=0 THEN 'Every outcome required for this review has current, non-overlapping evidence.' ELSE 'Required evidence is missing or overlapping sources need review.' END),
  'coverage',jsonb_build_object('nodeCount',jsonb_array_length(nodes),'coveredDomainCount',(SELECT count(DISTINCT x->>'domain') FROM jsonb_array_elements(nodes)x),'requiredDomains',required_domains,'domains',result_domains),
  'conflicts',jsonb_build_object('status',CASE WHEN conflict_count=0 THEN 'clear' ELSE 'needs_review' END,'count',conflict_count,'items',conflict_items,'message',CASE WHEN conflict_count=0 THEN 'No overlapping evidence was found in this graph.' ELSE 'Overlapping current sources need owner review. No source was chosen automatically.' END),
  'evaluationBoundary','This review checks evidence coverage and overlap only. It does not compare outcome values, decide which source is correct or change company records.') ;
END $$;

CREATE TABLE public.canonical_job_outcome_graph_evaluations(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 graph_id UUID NOT NULL,graph_revision BIGINT NOT NULL CHECK(graph_revision BETWEEN 1 AND 10000),graph_digest CHAR(64) NOT NULL CHECK(graph_digest~'^[0-9a-f]{64}$'),graph_source_digest CHAR(64) NOT NULL CHECK(graph_source_digest~'^[0-9a-f]{64}$'),
 consent_id UUID NOT NULL,consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 required_domains JSONB NOT NULL CHECK(public.canonical_job_outcome_graph_required_domains_valid(required_domains)),evaluation JSONB NOT NULL,
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),calculation_version TEXT NOT NULL CHECK(calculation_version='m25-job-outcome-graph-evaluation-v1'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-job-outcome-graph-evaluation-v1'),request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,estimate_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,graph_id) REFERENCES public.canonical_job_outcome_graphs(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,consent_id) REFERENCES public.canonical_job_outcome_graph_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_job_outcome_graph_evaluations(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(jsonb_build_object('graphDigest',rtrim(graph_digest),'graphSourceDigest',rtrim(graph_source_digest),'requiredDomains',required_domains)))
);
-- The evaluation equality is enforced by the guarded insert trigger because PostgreSQL checks cannot query the pinned graph.
CREATE INDEX canonical_job_outcome_graph_evaluations_current_idx ON public.canonical_job_outcome_graph_evaluations(organization_id,estimate_id,revision DESC);

CREATE TRIGGER canonical_job_outcome_graph_evaluations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_job_outcome_graph_evaluations FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_job_outcome_graph_immutable();

CREATE FUNCTION public.canonical_job_outcome_graph_evaluation_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE graph_value public.canonical_job_outcome_graphs%ROWTYPE;current_graph public.canonical_job_outcome_graphs%ROWTYPE;consent_value public.canonical_job_outcome_graph_consents%ROWTYPE;prior public.canonical_job_outcome_graph_evaluations%ROWTYPE;role_value TEXT;expected_evaluation JSONB;expected_source TEXT;expected TEXT;
BEGIN
 SELECT * INTO graph_value FROM public.canonical_job_outcome_graphs WHERE organization_id=NEW.organization_id AND id=NEW.graph_id;
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=NEW.organization_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO current_graph FROM public.canonical_job_outcome_graphs WHERE organization_id=NEW.organization_id AND estimate_id=NEW.estimate_id AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1;
 IF graph_value.id IS NULL OR current_graph.id IS DISTINCT FROM graph_value.id OR graph_value.estimate_id<>NEW.estimate_id OR graph_value.revision<>NEW.graph_revision OR rtrim(graph_value.canonical_digest)<>rtrim(NEW.graph_digest) OR rtrim(graph_value.source_digest)<>rtrim(NEW.graph_source_digest) OR graph_value.consent_id<>NEW.consent_id OR consent_value.id<>NEW.consent_id OR consent_value.action<>'grant' OR consent_value.revision<>NEW.consent_revision OR rtrim(consent_value.canonical_digest)<>rtrim(NEW.consent_digest) THEN RAISE EXCEPTION 'Job outcome evaluation lineage invalid' USING ERRCODE='23514';END IF;
 SELECT role INTO role_value FROM public.organization_memberships WHERE organization_id=NEW.organization_id AND id=NEW.membership_id AND user_id=NEW.actor_user_id AND status='active';
 IF role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Job outcome evaluation authority invalid' USING ERRCODE='23514';END IF;
 IF (public.canonical_job_outcome_graph_projection(graph_value,NEW.actor_user_id,role_value,NEW.auth_session_id)->'fresh') IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Current job outcome graph required' USING ERRCODE='23514';END IF;
 expected_evaluation:=public.canonical_job_outcome_graph_evaluate_manifest(graph_value.node_manifest,NEW.required_domains);IF NEW.evaluation<>expected_evaluation THEN RAISE EXCEPTION 'Job outcome evaluation invalid' USING ERRCODE='23514';END IF;
 expected_source:=public.canonical_completion_digest(jsonb_build_object('graphDigest',rtrim(NEW.graph_digest),'graphSourceDigest',rtrim(NEW.graph_source_digest),'requiredDomains',NEW.required_domains));IF rtrim(NEW.source_digest)<>expected_source THEN RAISE EXCEPTION 'Job outcome evaluation source invalid' USING ERRCODE='23514';END IF;
 IF NEW.revision>1 THEN SELECT * INTO prior FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=NEW.organization_id AND estimate_id=NEW.estimate_id AND id=NEW.previous_id;IF prior.id IS NULL OR prior.revision+1<>NEW.revision THEN RAISE EXCEPTION 'Job outcome evaluation revision invalid' USING ERRCODE='23514';END IF;END IF;
 expected:=public.canonical_completion_digest(jsonb_build_object('organizationId',NEW.organization_id,'estimateId',NEW.estimate_id,'revision',NEW.revision,'previousId',NEW.previous_id,'graphId',NEW.graph_id,'graphRevision',NEW.graph_revision,'graphDigest',rtrim(NEW.graph_digest),'graphSourceDigest',rtrim(NEW.graph_source_digest),'consentId',NEW.consent_id,'consentRevision',NEW.consent_revision,'consentDigest',rtrim(NEW.consent_digest),'requiredDomains',NEW.required_domains,'evaluation',NEW.evaluation,'sourceDigest',rtrim(NEW.source_digest),'calculationVersion',NEW.calculation_version,'actorUserId',NEW.actor_user_id,'membershipId',NEW.membership_id,'authSessionId',NEW.auth_session_id,'reason',NEW.reason,'confirmationVersion',NEW.confirmation_version,'requestDigest',rtrim(NEW.request_digest)));IF rtrim(NEW.canonical_digest)<>expected THEN RAISE EXCEPTION 'Job outcome evaluation digest invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_job_outcome_graph_evaluation_guard BEFORE INSERT ON public.canonical_job_outcome_graph_evaluations FOR EACH ROW EXECUTE FUNCTION public.canonical_job_outcome_graph_evaluation_guard();

CREATE FUNCTION public.canonical_job_outcome_graph_evaluation_projection(value public.canonical_job_outcome_graph_evaluations,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE graph_value public.canonical_job_outcome_graphs%ROWTYPE;current_graph public.canonical_job_outcome_graphs%ROWTYPE;graph_projection JSONB;fresh_value BOOLEAN:=FALSE;
BEGIN
 SELECT * INTO graph_value FROM public.canonical_job_outcome_graphs WHERE organization_id=value.organization_id AND id=value.graph_id;
 SELECT * INTO current_graph FROM public.canonical_job_outcome_graphs WHERE organization_id=value.organization_id AND estimate_id=value.estimate_id AND consent_id=value.consent_id ORDER BY revision DESC LIMIT 1;
 IF graph_value.id IS NOT NULL THEN graph_projection:=public.canonical_job_outcome_graph_projection(graph_value,actor,role_value,session_value);fresh_value:=current_graph.id=graph_value.id AND graph_projection->'fresh'='true'::jsonb AND graph_value.revision=value.graph_revision AND rtrim(graph_value.canonical_digest)=rtrim(value.graph_digest) AND rtrim(graph_value.source_digest)=rtrim(value.graph_source_digest);END IF;
 RETURN jsonb_build_object('id',value.id,'estimateId',value.estimate_id,'revision',value.revision,'previousId',value.previous_id,'graphId',value.graph_id,'graphRevision',value.graph_revision,'requiredDomains',CASE WHEN fresh_value THEN value.required_domains ELSE '[]'::jsonb END,'evaluation',CASE WHEN fresh_value THEN value.evaluation ELSE NULL END,'fresh',fresh_value,'available',fresh_value,'needsRefresh',NOT fresh_value,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at,'statusMessage',CASE WHEN fresh_value THEN 'Evidence coverage is current for this job review.' ELSE 'Connected evidence changed or permission is no longer current. Run the review again.' END,'adoptionBoundary','This review does not choose a source, apply a recommendation or change company records.');
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_evaluation_build(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,estimate_value UUID,expected_graph_revision BIGINT,expected_graph_digest TEXT,required_domains_value JSONB,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;consent_value public.canonical_job_outcome_graph_consents%ROWTYPE;graph_value public.canonical_job_outcome_graphs%ROWTYPE;current_row public.canonical_job_outcome_graph_evaluations%ROWTYPE;replay public.canonical_job_outcome_graph_evaluations%ROWTYPE;inserted public.canonical_job_outcome_graph_evaluations%ROWTYPE;normalized_domains JSONB;evaluation_value JSONB;key_hash TEXT;request_hash TEXT;source_digest_value TEXT;digest_value TEXT;next_revision BIGINT;replay_projection JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 IF role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Job outcome evaluation restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR estimate_value IS NULL OR expected_graph_revision NOT BETWEEN 1 AND 10000 OR expected_graph_digest!~'^[0-9a-f]{64}$' OR public.canonical_job_outcome_graph_required_domains_valid(required_domains_value) IS NOT TRUE OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE OR confirmation_version_value<>'m25-job-outcome-graph-evaluation-v1' THEN RAISE EXCEPTION 'Job outcome evaluation details invalid' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(x ORDER BY x#>>'{}') INTO normalized_domains FROM jsonb_array_elements(required_domains_value)x;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-graph-consent',0));PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-graph:'||estimate_value::text,0));PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-evaluation:'||estimate_value::text,0));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'estimateId',estimate_value,'expectedGraphRevision',expected_graph_revision,'expectedGraphDigest',expected_graph_digest,'requiredDomains',normalized_domains,'reason',reason_value,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value));
 SELECT * INTO replay FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Job outcome evaluation key conflict' USING ERRCODE='23505';END IF;SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;IF consent_value.id IS NULL OR consent_value.action<>'grant' OR replay.consent_id<>consent_value.id THEN RAISE EXCEPTION 'Current job outcome permission required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_evaluation_consent_unavailable';END IF;replay_projection:=public.canonical_job_outcome_graph_evaluation_projection(replay,actor,role_value,session_value);IF replay_projection->'fresh' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Job outcome evidence changed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('evaluation',replay_projection,'replayed',TRUE);END IF;
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR SHARE;IF consent_value.id IS NULL OR consent_value.action<>'grant' THEN RAISE EXCEPTION 'Current job outcome permission required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_evaluation_consent_unavailable';END IF;
 SELECT * INTO graph_value FROM public.canonical_job_outcome_graphs WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1 FOR SHARE;IF graph_value.id IS NULL THEN RAISE EXCEPTION 'Current job outcome graph required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_evaluation_graph_unavailable';END IF;
 IF graph_value.revision<>expected_graph_revision OR rtrim(graph_value.canonical_digest)<>expected_graph_digest THEN RAISE EXCEPTION 'Job outcome graph changed' USING ERRCODE='40001';END IF;
 IF (public.canonical_job_outcome_graph_projection(graph_value,actor,role_value,session_value)->'fresh') IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Current job outcome graph required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_evaluation_graph_unavailable';END IF;
 evaluation_value:=public.canonical_job_outcome_graph_evaluate_manifest(graph_value.node_manifest,normalized_domains);source_digest_value:=public.canonical_completion_digest(jsonb_build_object('graphDigest',rtrim(graph_value.canonical_digest),'graphSourceDigest',rtrim(graph_value.source_digest),'requiredDomains',normalized_domains));
 SELECT * INTO current_row FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;IF current_row.id IS NOT NULL AND current_row.consent_id=consent_value.id AND rtrim(current_row.source_digest)=source_digest_value THEN RAISE EXCEPTION 'Current job outcome evaluation already recorded' USING ERRCODE='22023',CONSTRAINT='job_outcome_evaluation_already_current';END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'estimateId',estimate_value,'revision',next_revision,'previousId',current_row.id,'graphId',graph_value.id,'graphRevision',graph_value.revision,'graphDigest',rtrim(graph_value.canonical_digest),'graphSourceDigest',rtrim(graph_value.source_digest),'consentId',consent_value.id,'consentRevision',consent_value.revision,'consentDigest',rtrim(consent_value.canonical_digest),'requiredDomains',normalized_domains,'evaluation',evaluation_value,'sourceDigest',source_digest_value,'calculationVersion','m25-job-outcome-graph-evaluation-v1','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'reason',reason_value,'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_job_outcome_graph_evaluations(organization_id,estimate_id,revision,previous_id,graph_id,graph_revision,graph_digest,graph_source_digest,consent_id,consent_revision,consent_digest,required_domains,evaluation,source_digest,calculation_version,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)VALUES(org,estimate_value,next_revision,current_row.id,graph_value.id,graph_value.revision,rtrim(graph_value.canonical_digest),rtrim(graph_value.source_digest),consent_value.id,consent_value.revision,rtrim(consent_value.canonical_digest),normalized_domains,evaluation_value,source_digest_value,'m25-job-outcome-graph-evaluation-v1',actor,(authority->>'membershipId')::uuid,session_value,reason_value,TRUE,confirmation_version_value,key_hash,request_hash,digest_value)RETURNING * INTO inserted;
 RETURN jsonb_build_object('evaluation',public.canonical_job_outcome_graph_evaluation_projection(inserted,actor,role_value,session_value),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_evaluation_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_value public.canonical_job_outcome_graph_consents%ROWTYPE;current_row public.canonical_job_outcome_graph_evaluations%ROWTYPE;history JSONB;total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Job outcome evaluation restricted' USING ERRCODE='42501';END IF;PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);PERFORM 1 FROM public.canonical_estimates WHERE organization_id=org AND id=estimate_value;IF NOT FOUND THEN RAISE EXCEPTION 'Job record unavailable' USING ERRCODE='P0002',CONSTRAINT='job_outcome_evaluation_target_unavailable';END IF;
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;IF consent_value.id IS NULL OR consent_value.action<>'grant' THEN RETURN jsonb_build_object('activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'statusMessage','Permission is required before evidence coverage can be reviewed.','adoptionBoundary','No company record or recommendation was changed.');END IF;
 SELECT * INTO current_row FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1;SELECT count(*) INTO total FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id;SELECT COALESCE(jsonb_agg(public.canonical_job_outcome_graph_evaluation_projection(x,actor,role_value,session_value)ORDER BY revision DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 20)x;
 RETURN jsonb_build_object('activeConsent',TRUE,'current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_job_outcome_graph_evaluation_projection(current_row,actor,role_value,session_value)END,'history',history,'total',total,'truncated',total>20,'statusMessage',CASE WHEN current_row.id IS NULL THEN 'Run a coverage review for the current connected evidence.' ELSE 'Evidence coverage review is available.' END,'adoptionBoundary','This review is advisory and changes no company record.');
END $$;

REVOKE ALL ON TABLE public.canonical_job_outcome_graph_evaluations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_required_domains_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_evaluate_manifest(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_evaluation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_evaluation_projection(public.canonical_job_outcome_graph_evaluations,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_evaluation_build(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,BIGINT,TEXT,JSONB,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_evaluation_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_graph_evaluation_build(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,BIGINT,TEXT,JSONB,TEXT,BOOLEAN,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_graph_evaluation_read(UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
