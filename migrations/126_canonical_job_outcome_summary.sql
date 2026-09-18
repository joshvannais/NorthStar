-- Mission 25 Part 13C: complete per-job summaries over one exact current outcome graph.
-- Values remain source-specific. Missing and overlapping evidence is never inferred or resolved here.

CREATE FUNCTION public.canonical_job_outcome_summary_domains_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT value='["equipment","financial","labor","materials","scope","travel"]'::jsonb
$$;

CREATE FUNCTION public.canonical_job_outcome_summary_claim_slot(kind_value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE kind_value
  WHEN 'native_labor' THEN 'labor_work' WHEN 'imported_labor' THEN 'labor_work'
  WHEN 'imported_travel' THEN 'travel_route'
  WHEN 'native_equipment' THEN 'equipment_use' WHEN 'imported_asset' THEN 'equipment_use'
  WHEN 'native_material' THEN 'material_quantity' WHEN 'imported_material_quantity' THEN 'material_quantity'
  WHEN 'imported_material_cost' THEN 'material_cost'
  WHEN 'external_project' THEN 'scope_delivery' WHEN 'external_financial' THEN 'financial_actuals'
  ELSE NULL END
$$;

CREATE FUNCTION public.canonical_job_outcome_summary_source(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,node_value JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind_value TEXT:=node_value->>'nodeKind';locator JSONB:=node_value->'locator';result JSONB;current_value JSONB;details JSONB;slot_value TEXT;
BEGIN
 IF public.canonical_job_outcome_graph_node_manifest_valid(node_value) IS NOT TRUE THEN RAISE EXCEPTION 'Job outcome source details invalid' USING ERRCODE='22023';END IF;
 slot_value:=public.canonical_job_outcome_summary_claim_slot(kind_value);
 IF slot_value IS NULL THEN RAISE EXCEPTION 'Job outcome source cannot be summarized' USING ERRCODE='22023';END IF;
 CASE kind_value
  WHEN 'native_labor' THEN result:=public.canonical_labor_outcome_read(org,actor,role_value,session_value,estimate_value);
  WHEN 'imported_labor' THEN result:=public.canonical_imported_labor_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value);
  WHEN 'imported_travel' THEN result:=public.canonical_imported_travel_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value);
  WHEN 'native_equipment' THEN result:=public.canonical_native_equipment_utilization_read(org,actor,role_value,session_value,estimate_value);
  WHEN 'imported_asset' THEN result:=public.canonical_imported_asset_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value);
  WHEN 'native_material' THEN result:=public.canonical_native_material_outcome_read(org,actor,role_value,session_value,estimate_value,(locator->>'executionId')::uuid);
  WHEN 'imported_material_quantity' THEN result:=public.canonical_imported_material_quantity_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value);
  WHEN 'imported_material_cost' THEN result:=public.canonical_imported_material_cost_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value);
  WHEN 'external_project' THEN result:=public.canonical_external_project_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value,locator->>'projectReference');
  WHEN 'external_financial' THEN result:=public.canonical_external_financial_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value);
 END CASE;
 current_value:=result->'current';
 IF current_value IS NULL OR current_value='null'::jsonb OR current_value->>'id' IS DISTINCT FROM node_value->>'observationId' OR current_value->>'estimateId' IS DISTINCT FROM estimate_value::text OR current_value->>'revision' IS DISTINCT FROM node_value->>'observationRevision' OR current_value->>'digest' IS DISTINCT FROM node_value->>'observationDigest' OR current_value->>'sourceDigest' IS DISTINCT FROM node_value->>'sourceDigest' OR current_value->'fresh' IS DISTINCT FROM 'true'::jsonb OR current_value->'hiddenByConsent'='true'::jsonb THEN
  RAISE EXCEPTION 'Current job outcome source required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_source_unavailable';
 END IF;
 details:=CASE kind_value
  WHEN 'native_labor' THEN jsonb_build_object('plannedWorkerHours',current_value->'plannedWorkerHours','recordedWorkerHours',current_value->'recordedWorkerHoursExcludingBreaks','varianceWorkerHours',current_value->'varianceWorkerHours','variancePercent',current_value->'variancePercent','advisoryCode',current_value->'advisoryCode','advisoryMessage',current_value->'advisoryMessage')
  WHEN 'imported_labor' THEN jsonb_build_object('plannedWorkerHours',current_value->'plannedWorkerHours','recordedWorkerHours',current_value->'recordedWorkerHours','varianceWorkerHours',current_value->'varianceWorkerHours','variancePercent',current_value->'variancePercent','advisoryCode',current_value->'advisoryCode','advisoryMessage',current_value->'advisoryMessage')
  WHEN 'imported_travel' THEN current_value->'metrics'
  WHEN 'native_equipment' THEN jsonb_build_object('plannedHours',current_value->'plannedHours','recordedCheckoutHours',current_value->'recordedCheckoutHours','varianceHours',current_value->'varianceHours','variancePercent',current_value->'variancePercent','advisoryCode',current_value->'advisoryCode','advisoryMessage',current_value->'advisoryMessage')
  WHEN 'imported_asset' THEN current_value->'metrics'
  WHEN 'native_material' THEN current_value->'result'
  WHEN 'imported_material_quantity' THEN current_value->'result'
  WHEN 'imported_material_cost' THEN current_value->'result'
  WHEN 'external_project' THEN current_value->'outcomes'
  WHEN 'external_financial' THEN current_value->'outcomes' END;
 IF details IS NULL OR jsonb_typeof(details)<>'object' THEN RAISE EXCEPTION 'Current job outcome details unavailable' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_source_unavailable';END IF;
 RETURN jsonb_build_object('nodeKind',kind_value,'domain',node_value->>'domain','claimSlot',slot_value,'observationId',node_value->>'observationId','observationRevision',(node_value->>'observationRevision')::bigint,'observationDigest',node_value->>'observationDigest','sourceDigest',node_value->>'sourceDigest','details',details);
END $$;

CREATE FUNCTION public.canonical_job_outcome_summary_compose(org UUID,actor UUID,role_value TEXT,session_value UUID,graph_value public.canonical_job_outcome_graphs,evaluation_value public.canonical_job_outcome_graph_evaluations)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE domain_value TEXT;domain_review JSONB;sources JSONB;node_value JSONB;domains_value JSONB:='[]'::jsonb;status_value TEXT;message_value TEXT;source_count INTEGER:=0;
BEGIN
 IF graph_value.id IS NULL OR evaluation_value.id IS NULL OR evaluation_value.graph_id<>graph_value.id OR evaluation_value.graph_revision<>graph_value.revision OR rtrim(evaluation_value.graph_digest)<>rtrim(graph_value.canonical_digest) OR rtrim(evaluation_value.graph_source_digest)<>rtrim(graph_value.source_digest) OR public.canonical_job_outcome_summary_domains_valid(evaluation_value.required_domains) IS NOT TRUE THEN
  RAISE EXCEPTION 'Current complete job outcome review required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_evaluation_unavailable';END IF;
 FOR domain_value IN SELECT unnest(ARRAY['labor','travel','equipment','materials','scope','financial']) LOOP
  SELECT x INTO domain_review FROM jsonb_array_elements(evaluation_value.evaluation->'coverage'->'domains')x WHERE x->>'domain'=domain_value;
  IF domain_review IS NULL OR domain_review->'required' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Complete job outcome review required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_evaluation_unavailable';END IF;
  sources:='[]'::jsonb;
  FOR node_value IN SELECT x FROM jsonb_array_elements(graph_value.node_manifest)x WHERE x->>'domain'=domain_value ORDER BY x->>'nodeKind',x->>'observationId' LOOP
   sources:=sources||jsonb_build_array(public.canonical_job_outcome_summary_source(org,actor,role_value,session_value,graph_value.estimate_id,node_value));source_count:=source_count+1;
  END LOOP;
  status_value:=CASE domain_review->>'status' WHEN 'covered' THEN 'recorded' WHEN 'needs_review' THEN 'needs_review' ELSE 'unavailable' END;
  message_value:=CASE status_value WHEN 'recorded' THEN 'Current evidence is recorded for this part of the job.' WHEN 'needs_review' THEN 'More than one current source covers this part of the job. Review them before relying on the result.' ELSE CASE domain_value WHEN 'financial' THEN 'No current reviewed financial outcome is available for this job.' ELSE 'No current reviewed outcome is available for this part of the job.' END END;
  domains_value:=domains_value||jsonb_build_array(jsonb_build_object('domain',domain_value,'status',status_value,'message',message_value,'sources',sources));
 END LOOP;
 RETURN jsonb_build_object('version','m25-job-outcome-summary-v1','status',evaluation_value.evaluation->'completeness'->>'status','sourceCount',source_count,'domains',domains_value,'summaryBoundary','This summary keeps each source separate. It does not choose between overlapping sources, convert values or change company records.','nativeFinancialBoundary','NorthStar invoice, payment, collection and accounting records remain unavailable until Mission 27.');
END $$;

CREATE FUNCTION public.canonical_job_outcome_summary_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB;source_item JSONB;domains_seen JSONB;count_value INTEGER:=0;
BEGIN
 IF jsonb_typeof(value)<>'object' OR octet_length(value::text)>1048576 OR public.canonical_field_evidence_object_keys_exact(value,ARRAY['version','status','sourceCount','domains','summaryBoundary','nativeFinancialBoundary']) IS NOT TRUE OR value->>'version'<>'m25-job-outcome-summary-v1' OR value->>'status' NOT IN('complete','needs_attention') OR jsonb_typeof(value->'sourceCount')<>'number' OR value->>'sourceCount'!~'^(0|[1-9][0-9]{0,2})$' OR (value->>'sourceCount')::integer>100 OR jsonb_typeof(value->'domains')<>'array' OR jsonb_array_length(value->'domains')<>6 OR public.canonical_learning_text_valid(value->>'summaryBoundary',500) IS NOT TRUE OR public.canonical_learning_text_valid(value->>'nativeFinancialBoundary',500) IS NOT TRUE THEN RETURN FALSE;END IF;
 SELECT jsonb_agg(x->'domain') INTO domains_seen FROM jsonb_array_elements(value->'domains')x;
 IF domains_seen<>'["labor","travel","equipment","materials","scope","financial"]'::jsonb THEN RETURN FALSE;END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(value->'domains')x LOOP
  IF public.canonical_field_evidence_object_keys_exact(item,ARRAY['domain','status','message','sources']) IS NOT TRUE OR item->>'status' NOT IN('recorded','unavailable','needs_review') OR public.canonical_learning_text_valid(item->>'message',500) IS NOT TRUE OR jsonb_typeof(item->'sources')<>'array' THEN RETURN FALSE;END IF;
  FOR source_item IN SELECT x FROM jsonb_array_elements(item->'sources')x LOOP
   IF public.canonical_field_evidence_object_keys_exact(source_item,ARRAY['nodeKind','domain','claimSlot','observationId','observationRevision','observationDigest','sourceDigest','details']) IS NOT TRUE OR source_item->>'domain'<>item->>'domain' OR public.canonical_job_outcome_summary_claim_slot(source_item->>'nodeKind') IS DISTINCT FROM source_item->>'claimSlot' OR source_item->>'observationId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR source_item->>'observationRevision'!~'^[1-9][0-9]{0,3}$|^10000$' OR source_item->>'observationDigest'!~'^[0-9a-f]{64}$' OR source_item->>'sourceDigest'!~'^[0-9a-f]{64}$' OR jsonb_typeof(source_item->'details')<>'object' THEN RETURN FALSE;END IF;count_value:=count_value+1;
  END LOOP;
 END LOOP;
 RETURN count_value=(value->>'sourceCount')::integer;
END $$;

CREATE TABLE public.canonical_job_outcome_summaries(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 graph_id UUID NOT NULL,graph_revision BIGINT NOT NULL CHECK(graph_revision BETWEEN 1 AND 10000),graph_digest CHAR(64) NOT NULL CHECK(graph_digest~'^[0-9a-f]{64}$'),graph_source_digest CHAR(64) NOT NULL CHECK(graph_source_digest~'^[0-9a-f]{64}$'),
 evaluation_id UUID NOT NULL,evaluation_revision BIGINT NOT NULL CHECK(evaluation_revision BETWEEN 1 AND 10000),evaluation_digest CHAR(64) NOT NULL CHECK(evaluation_digest~'^[0-9a-f]{64}$'),evaluation_source_digest CHAR(64) NOT NULL CHECK(evaluation_source_digest~'^[0-9a-f]{64}$'),
 consent_id UUID NOT NULL,consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 summary JSONB NOT NULL CHECK(public.canonical_job_outcome_summary_valid(summary)),source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),calculation_version TEXT NOT NULL CHECK(calculation_version='m25-job-outcome-summary-v1'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),confirmed BOOLEAN NOT NULL CHECK(confirmed),confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-job-outcome-summary-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,estimate_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,graph_id) REFERENCES public.canonical_job_outcome_graphs(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,evaluation_id) REFERENCES public.canonical_job_outcome_graph_evaluations(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,consent_id) REFERENCES public.canonical_job_outcome_graph_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_job_outcome_summaries(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL)OR(revision>1 AND previous_id IS NOT NULL)),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(jsonb_build_object('graphDigest',rtrim(graph_digest),'graphSourceDigest',rtrim(graph_source_digest),'evaluationDigest',rtrim(evaluation_digest),'evaluationSourceDigest',rtrim(evaluation_source_digest),'summary',summary)))
);
CREATE INDEX canonical_job_outcome_summaries_current_idx ON public.canonical_job_outcome_summaries(organization_id,estimate_id,revision DESC);
CREATE TRIGGER canonical_job_outcome_summaries_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_job_outcome_summaries FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_job_outcome_graph_immutable();

CREATE FUNCTION public.canonical_job_outcome_summary_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE graph_value public.canonical_job_outcome_graphs%ROWTYPE;evaluation_value public.canonical_job_outcome_graph_evaluations%ROWTYPE;consent_value public.canonical_job_outcome_graph_consents%ROWTYPE;prior public.canonical_job_outcome_summaries%ROWTYPE;role_value TEXT;expected_summary JSONB;expected_source TEXT;expected TEXT;
BEGIN
 SELECT * INTO graph_value FROM public.canonical_job_outcome_graphs WHERE organization_id=NEW.organization_id AND id=NEW.graph_id;SELECT * INTO evaluation_value FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=NEW.organization_id AND id=NEW.evaluation_id;SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=NEW.organization_id ORDER BY revision DESC LIMIT 1;
 IF graph_value.id IS NULL OR evaluation_value.id IS NULL OR graph_value.estimate_id<>NEW.estimate_id OR evaluation_value.estimate_id<>NEW.estimate_id OR evaluation_value.graph_id<>graph_value.id OR graph_value.revision<>NEW.graph_revision OR rtrim(graph_value.canonical_digest)<>rtrim(NEW.graph_digest) OR rtrim(graph_value.source_digest)<>rtrim(NEW.graph_source_digest) OR evaluation_value.revision<>NEW.evaluation_revision OR rtrim(evaluation_value.canonical_digest)<>rtrim(NEW.evaluation_digest) OR rtrim(evaluation_value.source_digest)<>rtrim(NEW.evaluation_source_digest) OR graph_value.consent_id<>NEW.consent_id OR evaluation_value.consent_id<>NEW.consent_id OR consent_value.id<>NEW.consent_id OR consent_value.action<>'grant' OR consent_value.revision<>NEW.consent_revision OR rtrim(consent_value.canonical_digest)<>rtrim(NEW.consent_digest) THEN RAISE EXCEPTION 'Job outcome summary lineage invalid' USING ERRCODE='23514';END IF;
 SELECT role INTO role_value FROM public.organization_memberships WHERE organization_id=NEW.organization_id AND id=NEW.membership_id AND user_id=NEW.actor_user_id AND status='active';IF role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Job outcome summary authority invalid' USING ERRCODE='23514';END IF;
 IF (public.canonical_job_outcome_graph_projection(graph_value,NEW.actor_user_id,role_value,NEW.auth_session_id)->'fresh') IS DISTINCT FROM 'true'::jsonb OR (public.canonical_job_outcome_graph_evaluation_projection(evaluation_value,NEW.actor_user_id,role_value,NEW.auth_session_id)->'fresh') IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Current job outcome review required' USING ERRCODE='23514';END IF;
 expected_summary:=public.canonical_job_outcome_summary_compose(NEW.organization_id,NEW.actor_user_id,role_value,NEW.auth_session_id,graph_value,evaluation_value);IF NEW.summary IS DISTINCT FROM expected_summary THEN RAISE EXCEPTION 'Job outcome summary invalid' USING ERRCODE='23514';END IF;
 expected_source:=public.canonical_completion_digest(jsonb_build_object('graphDigest',rtrim(NEW.graph_digest),'graphSourceDigest',rtrim(NEW.graph_source_digest),'evaluationDigest',rtrim(NEW.evaluation_digest),'evaluationSourceDigest',rtrim(NEW.evaluation_source_digest),'summary',NEW.summary));IF rtrim(NEW.source_digest)<>expected_source THEN RAISE EXCEPTION 'Job outcome summary source invalid' USING ERRCODE='23514';END IF;
 IF NEW.revision>1 THEN SELECT * INTO prior FROM public.canonical_job_outcome_summaries WHERE organization_id=NEW.organization_id AND estimate_id=NEW.estimate_id AND id=NEW.previous_id;IF prior.id IS NULL OR prior.revision+1<>NEW.revision THEN RAISE EXCEPTION 'Job outcome summary revision invalid' USING ERRCODE='23514';END IF;END IF;
 expected:=public.canonical_completion_digest(jsonb_build_object('organizationId',NEW.organization_id,'estimateId',NEW.estimate_id,'revision',NEW.revision,'previousId',NEW.previous_id,'graphId',NEW.graph_id,'graphRevision',NEW.graph_revision,'graphDigest',rtrim(NEW.graph_digest),'graphSourceDigest',rtrim(NEW.graph_source_digest),'evaluationId',NEW.evaluation_id,'evaluationRevision',NEW.evaluation_revision,'evaluationDigest',rtrim(NEW.evaluation_digest),'evaluationSourceDigest',rtrim(NEW.evaluation_source_digest),'consentId',NEW.consent_id,'consentRevision',NEW.consent_revision,'consentDigest',rtrim(NEW.consent_digest),'summary',NEW.summary,'sourceDigest',rtrim(NEW.source_digest),'calculationVersion',NEW.calculation_version,'actorUserId',NEW.actor_user_id,'membershipId',NEW.membership_id,'authSessionId',NEW.auth_session_id,'reason',NEW.reason,'confirmationVersion',NEW.confirmation_version,'requestDigest',rtrim(NEW.request_digest)));IF rtrim(NEW.canonical_digest)<>expected THEN RAISE EXCEPTION 'Job outcome summary digest invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_job_outcome_summary_guard BEFORE INSERT ON public.canonical_job_outcome_summaries FOR EACH ROW EXECUTE FUNCTION public.canonical_job_outcome_summary_guard();

CREATE FUNCTION public.canonical_job_outcome_summary_projection(value public.canonical_job_outcome_summaries,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE graph_value public.canonical_job_outcome_graphs%ROWTYPE;current_graph public.canonical_job_outcome_graphs%ROWTYPE;evaluation_value public.canonical_job_outcome_graph_evaluations%ROWTYPE;current_evaluation public.canonical_job_outcome_graph_evaluations%ROWTYPE;consent_value public.canonical_job_outcome_graph_consents%ROWTYPE;fresh_value BOOLEAN:=FALSE;current_summary JSONB;
BEGIN
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=value.organization_id ORDER BY revision DESC LIMIT 1;SELECT * INTO graph_value FROM public.canonical_job_outcome_graphs WHERE organization_id=value.organization_id AND id=value.graph_id;SELECT * INTO current_graph FROM public.canonical_job_outcome_graphs WHERE organization_id=value.organization_id AND estimate_id=value.estimate_id AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1;SELECT * INTO evaluation_value FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=value.organization_id AND id=value.evaluation_id;SELECT * INTO current_evaluation FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=value.organization_id AND estimate_id=value.estimate_id AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1;
 IF consent_value.id=value.consent_id AND consent_value.action='grant' AND current_graph.id=graph_value.id AND current_evaluation.id=evaluation_value.id AND (public.canonical_job_outcome_graph_projection(graph_value,actor,role_value,session_value)->'fresh')='true'::jsonb AND (public.canonical_job_outcome_graph_evaluation_projection(evaluation_value,actor,role_value,session_value)->'fresh')='true'::jsonb THEN
  BEGIN current_summary:=public.canonical_job_outcome_summary_compose(value.organization_id,actor,role_value,session_value,graph_value,evaluation_value);fresh_value:=current_summary=value.summary;EXCEPTION WHEN SQLSTATE 'P0002' THEN fresh_value:=FALSE;END;
 END IF;
 RETURN jsonb_build_object('id',value.id,'estimateId',value.estimate_id,'revision',value.revision,'previousId',value.previous_id,'graphId',value.graph_id,'graphRevision',value.graph_revision,'evaluationId',value.evaluation_id,'evaluationRevision',value.evaluation_revision,'summary',CASE WHEN fresh_value THEN value.summary ELSE NULL END,'fresh',fresh_value,'available',fresh_value,'needsRefresh',NOT fresh_value,'digest',rtrim(value.canonical_digest),'createdAt',value.created_at,'statusMessage',CASE WHEN fresh_value THEN 'The current job outcome summary is ready for review.' ELSE 'Connected evidence or permission changed. Prepare the summary again.' END,'adoptionBoundary','This summary does not change an estimate, price, schedule, job, financial record or company setting.');
END $$;

CREATE FUNCTION public.canonical_job_outcome_summary_build(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,estimate_value UUID,expected_evaluation_revision BIGINT,expected_evaluation_digest TEXT,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;consent_value public.canonical_job_outcome_graph_consents%ROWTYPE;graph_value public.canonical_job_outcome_graphs%ROWTYPE;evaluation_value public.canonical_job_outcome_graph_evaluations%ROWTYPE;current_row public.canonical_job_outcome_summaries%ROWTYPE;replay public.canonical_job_outcome_summaries%ROWTYPE;inserted public.canonical_job_outcome_summaries%ROWTYPE;summary_value JSONB;key_hash TEXT;request_hash TEXT;source_digest_value TEXT;digest_value TEXT;next_revision BIGINT;replay_projection JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;IF role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Job outcome summary restricted' USING ERRCODE='42501';END IF;PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR estimate_value IS NULL OR expected_evaluation_revision NOT BETWEEN 1 AND 10000 OR expected_evaluation_digest!~'^[0-9a-f]{64}$' OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE OR confirmation_version_value<>'m25-job-outcome-summary-v1' THEN RAISE EXCEPTION 'Job outcome summary details invalid' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-graph-consent',0));PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-graph:'||estimate_value::text,0));PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-evaluation:'||estimate_value::text,0));PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-summary:'||estimate_value::text,0));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'estimateId',estimate_value,'expectedEvaluationRevision',expected_evaluation_revision,'expectedEvaluationDigest',expected_evaluation_digest,'reason',reason_value,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value));
 SELECT * INTO replay FROM public.canonical_job_outcome_summaries WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Job outcome summary key conflict' USING ERRCODE='23505';END IF;SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;IF consent_value.id IS NULL OR consent_value.action<>'grant' OR replay.consent_id<>consent_value.id THEN RAISE EXCEPTION 'Current job outcome permission required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_consent_unavailable';END IF;replay_projection:=public.canonical_job_outcome_summary_projection(replay,actor,role_value,session_value);IF replay_projection->'fresh' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Connected job outcomes changed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('summary',replay_projection,'replayed',TRUE);END IF;
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR SHARE;IF consent_value.id IS NULL OR consent_value.action<>'grant' THEN RAISE EXCEPTION 'Current job outcome permission required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_consent_unavailable';END IF;
 SELECT * INTO graph_value FROM public.canonical_job_outcome_graphs WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1 FOR SHARE;SELECT * INTO evaluation_value FROM public.canonical_job_outcome_graph_evaluations WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF graph_value.id IS NULL OR evaluation_value.id IS NULL OR evaluation_value.graph_id<>graph_value.id THEN RAISE EXCEPTION 'Current complete job outcome review required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_evaluation_unavailable';END IF;
 IF evaluation_value.revision<>expected_evaluation_revision OR rtrim(evaluation_value.canonical_digest)<>expected_evaluation_digest THEN RAISE EXCEPTION 'Job outcome review changed' USING ERRCODE='40001';END IF;
 IF (public.canonical_job_outcome_graph_projection(graph_value,actor,role_value,session_value)->'fresh') IS DISTINCT FROM 'true'::jsonb OR (public.canonical_job_outcome_graph_evaluation_projection(evaluation_value,actor,role_value,session_value)->'fresh') IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Current complete job outcome review required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_evaluation_unavailable';END IF;
 summary_value:=public.canonical_job_outcome_summary_compose(org,actor,role_value,session_value,graph_value,evaluation_value);source_digest_value:=public.canonical_completion_digest(jsonb_build_object('graphDigest',rtrim(graph_value.canonical_digest),'graphSourceDigest',rtrim(graph_value.source_digest),'evaluationDigest',rtrim(evaluation_value.canonical_digest),'evaluationSourceDigest',rtrim(evaluation_value.source_digest),'summary',summary_value));
 SELECT * INTO current_row FROM public.canonical_job_outcome_summaries WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;IF current_row.id IS NOT NULL AND current_row.consent_id=consent_value.id AND rtrim(current_row.source_digest)=source_digest_value THEN RAISE EXCEPTION 'Current job outcome summary already recorded' USING ERRCODE='22023',CONSTRAINT='job_outcome_summary_already_current';END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'estimateId',estimate_value,'revision',next_revision,'previousId',current_row.id,'graphId',graph_value.id,'graphRevision',graph_value.revision,'graphDigest',rtrim(graph_value.canonical_digest),'graphSourceDigest',rtrim(graph_value.source_digest),'evaluationId',evaluation_value.id,'evaluationRevision',evaluation_value.revision,'evaluationDigest',rtrim(evaluation_value.canonical_digest),'evaluationSourceDigest',rtrim(evaluation_value.source_digest),'consentId',consent_value.id,'consentRevision',consent_value.revision,'consentDigest',rtrim(consent_value.canonical_digest),'summary',summary_value,'sourceDigest',source_digest_value,'calculationVersion','m25-job-outcome-summary-v1','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'reason',reason_value,'confirmationVersion',confirmation_version_value,'requestDigest',request_hash));
 INSERT INTO public.canonical_job_outcome_summaries(organization_id,estimate_id,revision,previous_id,graph_id,graph_revision,graph_digest,graph_source_digest,evaluation_id,evaluation_revision,evaluation_digest,evaluation_source_digest,consent_id,consent_revision,consent_digest,summary,source_digest,calculation_version,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)VALUES(org,estimate_value,next_revision,current_row.id,graph_value.id,graph_value.revision,rtrim(graph_value.canonical_digest),rtrim(graph_value.source_digest),evaluation_value.id,evaluation_value.revision,rtrim(evaluation_value.canonical_digest),rtrim(evaluation_value.source_digest),consent_value.id,consent_value.revision,rtrim(consent_value.canonical_digest),summary_value,source_digest_value,'m25-job-outcome-summary-v1',actor,(authority->>'membershipId')::uuid,session_value,reason_value,TRUE,confirmation_version_value,key_hash,request_hash,digest_value)RETURNING * INTO inserted;
 RETURN jsonb_build_object('summary',public.canonical_job_outcome_summary_projection(inserted,actor,role_value,session_value),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_job_outcome_summary_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_value public.canonical_job_outcome_graph_consents%ROWTYPE;current_row public.canonical_job_outcome_summaries%ROWTYPE;history JSONB;total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Job outcome summary restricted' USING ERRCODE='42501';END IF;PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);PERFORM 1 FROM public.canonical_estimates WHERE organization_id=org AND id=estimate_value;IF NOT FOUND THEN RAISE EXCEPTION 'Job record unavailable' USING ERRCODE='P0002',CONSTRAINT='job_outcome_summary_target_unavailable';END IF;
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;IF consent_value.id IS NULL OR consent_value.action<>'grant' THEN RETURN jsonb_build_object('activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'statusMessage','Permission is required before a job outcome summary can be prepared.','adoptionBoundary','No company record or recommendation was changed.');END IF;
 SELECT * INTO current_row FROM public.canonical_job_outcome_summaries WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1;SELECT count(*) INTO total FROM public.canonical_job_outcome_summaries WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id;SELECT COALESCE(jsonb_agg(public.canonical_job_outcome_summary_projection(x,actor,role_value,session_value)ORDER BY revision DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_job_outcome_summaries WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 20)x;
 RETURN jsonb_build_object('activeConsent',TRUE,'current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_job_outcome_summary_projection(current_row,actor,role_value,session_value)END,'history',history,'total',total,'truncated',total>20,'statusMessage',CASE WHEN current_row.id IS NULL THEN 'Prepare a summary from the current connected job outcomes.' ELSE 'Job outcome summary is available.' END,'adoptionBoundary','This summary is advisory and changes no company record.');
END $$;

REVOKE ALL ON TABLE public.canonical_job_outcome_summaries FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_domains_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_claim_slot(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_source(UUID,UUID,TEXT,UUID,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_compose(UUID,UUID,TEXT,UUID,public.canonical_job_outcome_graphs,public.canonical_job_outcome_graph_evaluations) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_projection(public.canonical_job_outcome_summaries,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_build(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_summary_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_summary_build(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,BIGINT,TEXT,TEXT,BOOLEAN,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_summary_read(UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
