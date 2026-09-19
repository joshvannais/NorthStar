CREATE TABLE public.canonical_job_outcome_graph_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-job-outcome-graph-consent-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_job_outcome_graph_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE FUNCTION public.canonical_job_outcome_graph_locator_valid(kind_value TEXT,value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(value)='object' AND octet_length(value::text)<=2048 AND CASE kind_value
  WHEN 'native_labor' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY[]::text[])
  WHEN 'imported_labor' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['sourceKey']) AND jsonb_typeof(value->'sourceKey')='string' AND value->>'sourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
  WHEN 'imported_travel' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['sourceKey']) AND jsonb_typeof(value->'sourceKey')='string' AND value->>'sourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
  WHEN 'native_equipment' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY[]::text[])
  WHEN 'imported_asset' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['sourceKey']) AND jsonb_typeof(value->'sourceKey')='string' AND value->>'sourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
  WHEN 'native_material' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['executionId']) AND jsonb_typeof(value->'executionId')='string' AND value->>'executionId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  WHEN 'imported_material_quantity' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['sourceKey']) AND jsonb_typeof(value->'sourceKey')='string' AND value->>'sourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
  WHEN 'imported_material_cost' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['sourceKey']) AND jsonb_typeof(value->'sourceKey')='string' AND value->>'sourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
  WHEN 'external_customer' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['crmSourceKey','communicationSourceKey','crmEstimateReference','communicationEstimateReference'])
   AND jsonb_typeof(value->'crmSourceKey')='string' AND value->>'crmSourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
   AND jsonb_typeof(value->'communicationSourceKey')='string' AND value->>'communicationSourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
   AND jsonb_typeof(value->'crmEstimateReference')='string' AND length(value->>'crmEstimateReference') BETWEEN 1 AND 128 AND value->>'crmEstimateReference'~'^[!-~]+$'
   AND jsonb_typeof(value->'communicationEstimateReference')='string' AND value->>'communicationEstimateReference'~'^ref_[0-9a-f]{64}$'
  WHEN 'external_project' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['sourceKey','projectReference'])
   AND jsonb_typeof(value->'sourceKey')='string' AND value->>'sourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
   AND jsonb_typeof(value->'projectReference')='string' AND length(value->>'projectReference') BETWEEN 1 AND 128 AND value->>'projectReference'~'^[!-~]+$'
  WHEN 'external_financial' THEN public.canonical_field_evidence_object_keys_exact(value,ARRAY['sourceKey']) AND jsonb_typeof(value->'sourceKey')='string' AND value->>'sourceKey'~'^[a-z0-9][a-z0-9._-]{1,63}$'
  ELSE FALSE END
$$;

CREATE FUNCTION public.canonical_job_outcome_graph_node_input_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(value)='object' AND public.canonical_field_evidence_object_keys_exact(value,ARRAY['nodeKind','observationId','locator'])
  AND jsonb_typeof(value->'nodeKind')='string' AND value->>'nodeKind' IN ('native_labor','imported_labor','imported_travel','native_equipment','imported_asset','native_material','imported_material_quantity','imported_material_cost','external_customer','external_project','external_financial')
  AND jsonb_typeof(value->'observationId')='string' AND value->>'observationId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND public.canonical_job_outcome_graph_locator_valid(value->>'nodeKind',value->'locator')
$$;

CREATE FUNCTION public.canonical_job_outcome_graph_node_manifest_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_typeof(value)='object' AND public.canonical_field_evidence_object_keys_exact(value,ARRAY['nodeKind','domain','observationId','observationRevision','observationDigest','sourceDigest','locator'])
  AND public.canonical_job_outcome_graph_node_input_valid(jsonb_build_object('nodeKind',value->'nodeKind','observationId',value->'observationId','locator',value->'locator'))
  AND jsonb_typeof(value->'domain')='string' AND value->>'domain'=CASE value->>'nodeKind'
   WHEN 'native_labor' THEN 'labor' WHEN 'imported_labor' THEN 'labor' WHEN 'imported_travel' THEN 'travel'
   WHEN 'native_equipment' THEN 'equipment' WHEN 'imported_asset' THEN 'equipment'
   WHEN 'native_material' THEN 'materials' WHEN 'imported_material_quantity' THEN 'materials' WHEN 'imported_material_cost' THEN 'materials'
   WHEN 'external_customer' THEN 'customer' WHEN 'external_project' THEN 'scope' WHEN 'external_financial' THEN 'financial' END
  AND jsonb_typeof(value->'observationRevision')='number' AND value->>'observationRevision'~'^[1-9][0-9]{0,3}$|^10000$'
  AND jsonb_typeof(value->'observationDigest')='string' AND value->>'observationDigest'~'^[0-9a-f]{64}$'
  AND jsonb_typeof(value->'sourceDigest')='string' AND value->>'sourceDigest'~'^[0-9a-f]{64}$'
$$;

CREATE FUNCTION public.canonical_job_outcome_graph_manifest_valid(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB; item_count INTEGER; identity_count INTEGER; domain_count INTEGER;
BEGIN
 IF jsonb_typeof(value)<>'array' OR octet_length(value::text)>1048576 THEN RETURN FALSE; END IF;
 SELECT count(*),count(DISTINCT ((x->>'nodeKind')||':'||(x->>'observationId'))),count(DISTINCT (x->>'domain'))
 INTO item_count,identity_count,domain_count FROM jsonb_array_elements(value)x;
 IF item_count NOT BETWEEN 2 AND 100 OR identity_count<>item_count OR domain_count<2 THEN RETURN FALSE; END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(value)x LOOP
  IF public.canonical_job_outcome_graph_node_manifest_valid(item) IS NOT TRUE THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
END $$;

CREATE TABLE public.canonical_job_outcome_graphs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 estimate_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 consent_id UUID NOT NULL, consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),
 consent_digest CHAR(64) NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 target_manifest JSONB NOT NULL CHECK(jsonb_typeof(target_manifest)='array' AND octet_length(target_manifest::text)<=131072),
 target_digest CHAR(64) NOT NULL CHECK(target_digest~'^[0-9a-f]{64}$'),
 node_manifest JSONB NOT NULL CHECK(public.canonical_job_outcome_graph_manifest_valid(node_manifest)),
 source_digest CHAR(64) NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL, membership_id UUID NOT NULL, auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)), confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-job-outcome-graph-v1'),
 graph_version TEXT NOT NULL CHECK(graph_version='m25-cross-source-job-outcome-graph-v1'),
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
 UNIQUE(organization_id,estimate_id,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_job_outcome_graphs(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,consent_id) REFERENCES public.canonical_job_outcome_graph_consents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(rtrim(source_digest)=public.canonical_completion_digest(jsonb_build_object('targetDigest',rtrim(target_digest),'nodes',node_manifest)))
);
CREATE INDEX canonical_job_outcome_graphs_current_idx ON public.canonical_job_outcome_graphs(organization_id,estimate_id,revision DESC);

CREATE FUNCTION public.canonical_job_outcome_graph_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Job outcome history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_job_outcome_graph_consents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_job_outcome_graph_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_job_outcome_graph_immutable();
CREATE TRIGGER canonical_job_outcome_graphs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_job_outcome_graphs FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_job_outcome_graph_immutable();

CREATE FUNCTION public.canonical_job_outcome_graph_consent_projection(value public.canonical_job_outcome_graph_consents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'revision',value.revision,'previousId',value.previous_id,'action',value.action,
  'active',value.action='grant','reason',value.reason,'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at,
  'learningBoundary','Reviewing outcomes together does not change a customer, job, estimate, schedule, price, financial record or company policy.')
$$;

CREATE FUNCTION public.canonical_job_outcome_graph_resolve_node(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,node_value JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind_value TEXT:=node_value->>'nodeKind'; locator JSONB:=node_value->'locator'; result JSONB; current_value JSONB; domain_value TEXT;
BEGIN
 IF public.canonical_job_outcome_graph_node_input_valid(node_value) IS NOT TRUE THEN RAISE EXCEPTION 'Job outcome source details invalid' USING ERRCODE='22023'; END IF;
 CASE kind_value
  WHEN 'native_labor' THEN result:=public.canonical_labor_outcome_read(org,actor,role_value,session_value,estimate_value); domain_value:='labor';
  WHEN 'imported_labor' THEN result:=public.canonical_imported_labor_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value); domain_value:='labor';
  WHEN 'imported_travel' THEN result:=public.canonical_imported_travel_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value); domain_value:='travel';
  WHEN 'native_equipment' THEN result:=public.canonical_native_equipment_utilization_read(org,actor,role_value,session_value,estimate_value); domain_value:='equipment';
  WHEN 'imported_asset' THEN result:=public.canonical_imported_asset_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value); domain_value:='equipment';
  WHEN 'native_material' THEN result:=public.canonical_native_material_outcome_read(org,actor,role_value,session_value,estimate_value,(locator->>'executionId')::uuid); domain_value:='materials';
  WHEN 'imported_material_quantity' THEN result:=public.canonical_imported_material_quantity_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value); domain_value:='materials';
  WHEN 'imported_material_cost' THEN result:=public.canonical_imported_material_cost_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value); domain_value:='materials';
  WHEN 'external_customer' THEN result:=public.canonical_external_customer_outcome_read(org,actor,role_value,session_value,locator->>'crmSourceKey',locator->>'communicationSourceKey',estimate_value,locator->>'crmEstimateReference',locator->>'communicationEstimateReference'); domain_value:='customer';
  WHEN 'external_project' THEN result:=public.canonical_external_project_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value,locator->>'projectReference'); domain_value:='scope';
  WHEN 'external_financial' THEN result:=public.canonical_external_financial_outcome_read(org,actor,role_value,session_value,locator->>'sourceKey',estimate_value); domain_value:='financial';
  ELSE RAISE EXCEPTION 'Job outcome source is unsupported' USING ERRCODE='22023';
 END CASE;
 current_value:=result->'current';
 IF current_value IS NULL OR current_value='null'::jsonb OR current_value->>'id' IS DISTINCT FROM node_value->>'observationId'
  OR current_value->'fresh' IS DISTINCT FROM 'true'::jsonb OR current_value->'hiddenByConsent'='true'::jsonb
  OR current_value->>'estimateId' IS DISTINCT FROM estimate_value::text
  OR current_value->>'revision' IS NULL OR current_value->>'digest'!~'^[0-9a-f]{64}$' OR current_value->>'sourceDigest'!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Current job outcome source required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_graph_node_unavailable';
 END IF;
 RETURN jsonb_build_object('nodeKind',kind_value,'domain',domain_value,'observationId',current_value->>'id',
  'observationRevision',(current_value->>'revision')::bigint,'observationDigest',current_value->>'digest',
  'sourceDigest',current_value->>'sourceDigest','locator',locator);
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_resolve_nodes(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID,nodes_value JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB; resolved JSONB:='[]'::jsonb; item_count INTEGER; identity_count INTEGER; domain_count INTEGER;
BEGIN
 IF jsonb_typeof(nodes_value)<>'array' OR jsonb_array_length(nodes_value) NOT BETWEEN 2 AND 100 OR octet_length(nodes_value::text)>262144 THEN
  RAISE EXCEPTION 'Job outcome sources invalid' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(nodes_value)x LOOP
  resolved:=resolved||jsonb_build_array(public.canonical_job_outcome_graph_resolve_node(org,actor,role_value,session_value,estimate_value,item));
 END LOOP;
 SELECT count(*),count(DISTINCT ((x->>'nodeKind')||':'||(x->>'observationId'))),count(DISTINCT (x->>'domain')) INTO item_count,identity_count,domain_count FROM jsonb_array_elements(resolved)x;
 IF identity_count<>item_count OR domain_count<2 THEN RAISE EXCEPTION 'Two distinct current outcome sources are required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_graph_sources_incomplete'; END IF;
 SELECT jsonb_agg(x ORDER BY x->>'nodeKind',x->>'observationId',x->'locator') INTO resolved FROM jsonb_array_elements(resolved)x;
 RETURN resolved;
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_consent_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.canonical_job_outcome_graph_consents%ROWTYPE; current_row public.canonical_job_outcome_graph_consents%ROWTYPE; role_value TEXT; expected TEXT;
BEGIN
 SELECT role INTO role_value FROM public.organization_memberships WHERE organization_id=NEW.organization_id AND id=NEW.membership_id AND user_id=NEW.actor_user_id AND status='active';
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Job outcome permission authority invalid' USING ERRCODE='23514'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(NEW.organization_id,NEW.actor_user_id,role_value,NEW.auth_session_id,NULL,FALSE);
 SELECT * INTO current_row FROM public.canonical_job_outcome_graph_consents WHERE organization_id=NEW.organization_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision=1 THEN
  IF current_row.id IS NOT NULL OR NEW.previous_id IS NOT NULL OR NEW.action<>'grant' THEN RAISE EXCEPTION 'Job outcome permission revision invalid' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO prior FROM public.canonical_job_outcome_graph_consents WHERE organization_id=NEW.organization_id AND id=NEW.previous_id;
  IF prior.id IS NULL OR current_row.id IS DISTINCT FROM prior.id OR prior.revision+1<>NEW.revision OR prior.action=NEW.action THEN RAISE EXCEPTION 'Job outcome permission revision invalid' USING ERRCODE='23514'; END IF;
 END IF;
 expected:=public.canonical_completion_digest(jsonb_build_object('organizationId',NEW.organization_id,'revision',NEW.revision,'previousId',NEW.previous_id,'action',NEW.action,'actorUserId',NEW.actor_user_id,'membershipId',NEW.membership_id,'authSessionId',NEW.auth_session_id,'reason',NEW.reason,'confirmationVersion',NEW.confirmation_version,'requestDigest',rtrim(NEW.request_digest)));
 IF rtrim(NEW.canonical_digest)<>expected THEN RAISE EXCEPTION 'Job outcome permission digest invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_job_outcome_graph_consent_guard BEFORE INSERT ON public.canonical_job_outcome_graph_consents FOR EACH ROW EXECUTE FUNCTION public.canonical_job_outcome_graph_consent_guard();

CREATE FUNCTION public.canonical_job_outcome_graph_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_value public.canonical_job_outcome_graph_consents%ROWTYPE; prior public.canonical_job_outcome_graphs%ROWTYPE; role_value TEXT; target_value JSONB; resolved JSONB; expected_source TEXT; expected TEXT; input_nodes JSONB;
BEGIN
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=NEW.organization_id ORDER BY revision DESC LIMIT 1;
 IF consent_value.id IS NULL OR consent_value.id<>NEW.consent_id OR consent_value.action<>'grant' OR consent_value.revision<>NEW.consent_revision OR rtrim(consent_value.canonical_digest)<>rtrim(NEW.consent_digest) THEN RAISE EXCEPTION 'Job outcome graph permission invalid' USING ERRCODE='23514'; END IF;
 SELECT role INTO role_value FROM public.organization_memberships WHERE organization_id=NEW.organization_id AND id=NEW.membership_id AND user_id=NEW.actor_user_id AND status='active';
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Job outcome graph authority invalid' USING ERRCODE='23514'; END IF;
 target_value:=public.canonical_external_business_reference_target_basis(NEW.organization_id,'estimate',NEW.estimate_id);
 IF target_value IS NULL OR target_value->'manifest'<>NEW.target_manifest OR target_value->>'digest'<>rtrim(NEW.target_digest) THEN RAISE EXCEPTION 'Job outcome target lineage invalid' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('nodeKind',x->'nodeKind','observationId',x->'observationId','locator',x->'locator') ORDER BY x->>'nodeKind',x->>'observationId',x->'locator') INTO input_nodes FROM jsonb_array_elements(NEW.node_manifest)x;
 resolved:=public.canonical_job_outcome_graph_resolve_nodes(NEW.organization_id,NEW.actor_user_id,role_value,NEW.auth_session_id,NEW.estimate_id,input_nodes);
 IF resolved<>NEW.node_manifest THEN RAISE EXCEPTION 'Job outcome source lineage invalid' USING ERRCODE='23514'; END IF;
 expected_source:=public.canonical_completion_digest(jsonb_build_object('targetDigest',rtrim(NEW.target_digest),'nodes',NEW.node_manifest));
 IF rtrim(NEW.source_digest)<>expected_source THEN RAISE EXCEPTION 'Job outcome source digest invalid' USING ERRCODE='23514'; END IF;
 IF NEW.revision>1 THEN SELECT * INTO prior FROM public.canonical_job_outcome_graphs WHERE organization_id=NEW.organization_id AND estimate_id=NEW.estimate_id AND id=NEW.previous_id;
  IF prior.id IS NULL OR prior.revision+1<>NEW.revision THEN RAISE EXCEPTION 'Job outcome graph revision invalid' USING ERRCODE='23514'; END IF; END IF;
 expected:=public.canonical_completion_digest(jsonb_build_object('organizationId',NEW.organization_id,'estimateId',NEW.estimate_id,'revision',NEW.revision,'previousId',NEW.previous_id,'consentId',NEW.consent_id,'consentRevision',NEW.consent_revision,'consentDigest',rtrim(NEW.consent_digest),'targetDigest',rtrim(NEW.target_digest),'nodeManifest',NEW.node_manifest,'sourceDigest',rtrim(NEW.source_digest),'actorUserId',NEW.actor_user_id,'membershipId',NEW.membership_id,'authSessionId',NEW.auth_session_id,'reason',NEW.reason,'confirmationVersion',NEW.confirmation_version,'graphVersion',NEW.graph_version,'requestDigest',rtrim(NEW.request_digest)));
 IF rtrim(NEW.canonical_digest)<>expected THEN RAISE EXCEPTION 'Job outcome graph digest invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_job_outcome_graph_guard BEFORE INSERT ON public.canonical_job_outcome_graphs FOR EACH ROW EXECUTE FUNCTION public.canonical_job_outcome_graph_guard();

CREATE FUNCTION public.canonical_job_outcome_graph_consent_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_job_outcome_graph_consents%ROWTYPE; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Job outcome review restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO current_row FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org;
 SELECT COALESCE(jsonb_agg(public.canonical_job_outcome_graph_consent_projection(x) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 20)x;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_job_outcome_graph_consent_projection(current_row)END,'history',history,'total',total,'truncated',total>20,'purpose','Review current job outcomes together','consumptionBoundary','Permission covers this company''s job outcome review only. It does not apply any recommendation or change company records.');
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_consent_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_job_outcome_graph_consents%ROWTYPE; replay public.canonical_job_outcome_graph_consents%ROWTYPE; inserted public.canonical_job_outcome_graph_consents%ROWTYPE; key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Job outcome review restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192 OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR body->>'action' NOT IN ('grant','revoke') OR jsonb_typeof(body->'expectedRevision')<>'number' OR body->>'expectedRevision'!~'^(0|[1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest')<>'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$' OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none'))
  OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion'<>'m25-job-outcome-graph-consent-v1' THEN
  RAISE EXCEPTION 'Job outcome permission details invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-graph-consent',0));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'body',body));
 SELECT * INTO replay FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN SELECT * INTO current_row FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Job outcome permission key conflict' USING ERRCODE='23505'; END IF;
  IF current_row.id<>replay.id THEN RAISE EXCEPTION 'Job outcome permission changed' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('consent',public.canonical_job_outcome_graph_consent_projection(replay),'replayed',TRUE); END IF;
 SELECT * INTO current_row FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF COALESCE(current_row.revision,0)<>(body->>'expectedRevision')::bigint OR COALESCE(rtrim(current_row.canonical_digest),'none')<>body->>'expectedDigest' THEN RAISE EXCEPTION 'Job outcome permission changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='grant' AND current_row.action='grant' OR body->>'action'='revoke' AND(current_row.id IS NULL OR current_row.action<>'grant') THEN RAISE EXCEPTION 'Job outcome permission action invalid' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'revision',next_revision,'previousId',current_row.id,'action',body->>'action','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'reason',body->>'reason','confirmationVersion',body->>'confirmationVersion','requestDigest',request_hash));
 INSERT INTO public.canonical_job_outcome_graph_consents(organization_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,body->>'confirmationVersion',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_job_outcome_graph_consent_projection(inserted),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_projection(value public.canonical_job_outcome_graphs,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target_value JSONB; resolved JSONB; input_nodes JSONB; fresh_value BOOLEAN:=FALSE;
BEGIN
 BEGIN
  target_value:=public.canonical_external_business_reference_target_basis(value.organization_id,'estimate',value.estimate_id);
  SELECT jsonb_agg(jsonb_build_object('nodeKind',x->'nodeKind','observationId',x->'observationId','locator',x->'locator') ORDER BY x->>'nodeKind',x->>'observationId',x->'locator') INTO input_nodes FROM jsonb_array_elements(value.node_manifest)x;
  resolved:=public.canonical_job_outcome_graph_resolve_nodes(value.organization_id,actor,role_value,session_value,value.estimate_id,input_nodes);
  fresh_value:=target_value IS NOT NULL AND target_value->>'digest'=rtrim(value.target_digest) AND resolved=value.node_manifest;
 EXCEPTION WHEN SQLSTATE 'P0002' OR SQLSTATE '22023' THEN fresh_value:=FALSE; END;
 RETURN jsonb_build_object('id',value.id,'estimateId',value.estimate_id,'revision',value.revision,'previousId',value.previous_id,
  'nodeCount',jsonb_array_length(value.node_manifest),'domains',(SELECT jsonb_agg(domain ORDER BY domain) FROM(SELECT DISTINCT x->>'domain' domain FROM jsonb_array_elements(value.node_manifest)x)s),
  'nodes',CASE WHEN fresh_value THEN value.node_manifest ELSE '[]'::jsonb END,'fresh',fresh_value,'available',fresh_value,'needsRefresh',NOT fresh_value,
  'digest',rtrim(value.canonical_digest),'createdAt',value.created_at,
  'statusMessage',CASE WHEN fresh_value THEN 'Current job outcomes are connected for review.' ELSE 'Job outcome evidence changed or permission is no longer current. Refresh before using this graph.' END,
  'adoptionBoundary','This graph records evidence connections only. It does not change company records or apply a recommendation.');
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_build(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,estimate_value UUID,expected_consent_revision BIGINT,expected_consent_digest TEXT,nodes_value JSONB,reason_value TEXT,confirmed_value BOOLEAN,confirmation_version_value TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_value public.canonical_job_outcome_graph_consents%ROWTYPE; current_row public.canonical_job_outcome_graphs%ROWTYPE; replay public.canonical_job_outcome_graphs%ROWTYPE; inserted public.canonical_job_outcome_graphs%ROWTYPE; target_value JSONB; resolved JSONB; key_hash TEXT; request_hash TEXT; source_digest_value TEXT; digest_value TEXT; next_revision BIGINT; replay_projection JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Job outcome review restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR estimate_value IS NULL OR expected_consent_revision NOT BETWEEN 1 AND 10000 OR expected_consent_digest!~'^[0-9a-f]{64}$'
  OR public.canonical_learning_text_valid(reason_value,2000) IS NOT TRUE OR confirmed_value IS DISTINCT FROM TRUE OR confirmation_version_value<>'m25-job-outcome-graph-v1' THEN RAISE EXCEPTION 'Job outcome graph details invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-graph-consent',0)); PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':job-outcome-graph:'||estimate_value::text,0));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex'); request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'estimateId',estimate_value,'expectedConsentRevision',expected_consent_revision,'expectedConsentDigest',expected_consent_digest,'nodes',nodes_value,'reason',reason_value,'confirmed',confirmed_value,'confirmationVersion',confirmation_version_value));
 SELECT * INTO replay FROM public.canonical_job_outcome_graphs WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Job outcome graph key conflict' USING ERRCODE='23505'; END IF;
  SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
  IF consent_value.id IS NULL OR consent_value.action<>'grant' OR replay.consent_id<>consent_value.id THEN RAISE EXCEPTION 'Current job outcome permission required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_graph_consent_unavailable'; END IF;
  replay_projection:=public.canonical_job_outcome_graph_projection(replay,actor,role_value,session_value);
  IF replay_projection->'fresh' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Job outcome evidence changed' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('graph',replay_projection,'replayed',TRUE);
 END IF;
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR SHARE;
 IF consent_value.id IS NULL OR consent_value.action<>'grant' THEN RAISE EXCEPTION 'Current job outcome permission required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_graph_consent_unavailable'; END IF;
 IF consent_value.revision<>expected_consent_revision OR rtrim(consent_value.canonical_digest)<>expected_consent_digest THEN RAISE EXCEPTION 'Job outcome permission changed' USING ERRCODE='40001'; END IF;
 target_value:=public.canonical_external_business_reference_target_basis(org,'estimate',estimate_value); IF target_value IS NULL THEN RAISE EXCEPTION 'Current job record required' USING ERRCODE='P0002',CONSTRAINT='job_outcome_graph_target_unavailable'; END IF;
 resolved:=public.canonical_job_outcome_graph_resolve_nodes(org,actor,role_value,session_value,estimate_value,nodes_value);
 source_digest_value:=public.canonical_completion_digest(jsonb_build_object('targetDigest',target_value->>'digest','nodes',resolved));
 SELECT * INTO current_row FROM public.canonical_job_outcome_graphs WHERE organization_id=org AND estimate_id=estimate_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF current_row.id IS NOT NULL AND current_row.consent_id=consent_value.id AND rtrim(current_row.source_digest)=source_digest_value THEN RAISE EXCEPTION 'Current job outcome graph already recorded' USING ERRCODE='22023',CONSTRAINT='job_outcome_graph_already_current'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'estimateId',estimate_value,'revision',next_revision,'previousId',current_row.id,'consentId',consent_value.id,'consentRevision',consent_value.revision,'consentDigest',rtrim(consent_value.canonical_digest),'targetDigest',target_value->>'digest','nodeManifest',resolved,'sourceDigest',source_digest_value,'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'reason',reason_value,'confirmationVersion',confirmation_version_value,'graphVersion','m25-cross-source-job-outcome-graph-v1','requestDigest',request_hash));
 INSERT INTO public.canonical_job_outcome_graphs(organization_id,estimate_id,revision,previous_id,consent_id,consent_revision,consent_digest,target_manifest,target_digest,node_manifest,source_digest,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,graph_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,estimate_value,next_revision,current_row.id,consent_value.id,consent_value.revision,rtrim(consent_value.canonical_digest),target_value->'manifest',target_value->>'digest',resolved,source_digest_value,actor,(authority->>'membershipId')::uuid,session_value,reason_value,TRUE,confirmation_version_value,'m25-cross-source-job-outcome-graph-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('graph',public.canonical_job_outcome_graph_projection(inserted,actor,role_value,session_value),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_job_outcome_graph_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_value public.canonical_job_outcome_graph_consents%ROWTYPE; current_row public.canonical_job_outcome_graphs%ROWTYPE; history JSONB; total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Job outcome review restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM 1 FROM public.canonical_estimates WHERE organization_id=org AND id=estimate_value; IF NOT FOUND THEN RAISE EXCEPTION 'Job record unavailable' USING ERRCODE='P0002',CONSTRAINT='job_outcome_graph_target_unavailable'; END IF;
 SELECT * INTO consent_value FROM public.canonical_job_outcome_graph_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF consent_value.id IS NULL OR consent_value.action<>'grant' THEN RETURN jsonb_build_object('activeConsent',FALSE,'current',NULL,'history','[]'::jsonb,'total',0,'truncated',FALSE,'statusMessage','Permission is required before job outcomes can be reviewed together.','adoptionBoundary','No company record or recommendation was changed.'); END IF;
 SELECT * INTO current_row FROM public.canonical_job_outcome_graphs WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_job_outcome_graphs WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id;
 SELECT COALESCE(jsonb_agg(public.canonical_job_outcome_graph_projection(x,actor,role_value,session_value) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_job_outcome_graphs WHERE organization_id=org AND estimate_id=estimate_value AND consent_id=consent_value.id ORDER BY revision DESC LIMIT 20)x;
 RETURN jsonb_build_object('activeConsent',TRUE,'consent',public.canonical_job_outcome_graph_consent_projection(consent_value),'current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_job_outcome_graph_projection(current_row,actor,role_value,session_value)END,'history',history,'total',total,'truncated',total>20,'statusMessage',CASE WHEN current_row.id IS NULL THEN 'Choose current job outcomes to connect for review.' ELSE 'Job outcomes are ready to review.' END,'adoptionBoundary','The saved connections record evidence only. Applying advice remains a separate owner action.');
END $$;

REVOKE ALL ON TABLE public.canonical_job_outcome_graph_consents,public.canonical_job_outcome_graphs FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_locator_valid(TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_node_input_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_node_manifest_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_manifest_valid(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_consent_projection(public.canonical_job_outcome_graph_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_resolve_node(UUID,UUID,TEXT,UUID,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_resolve_nodes(UUID,UUID,TEXT,UUID,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_consent_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_consent_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_projection(public.canonical_job_outcome_graphs,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_build(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,BIGINT,TEXT,JSONB,TEXT,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_graph_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_graph_consent_read(UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_graph_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,JSONB) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_graph_build(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,BIGINT,TEXT,JSONB,TEXT,BOOLEAN,TEXT) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_job_outcome_graph_read(UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF; END $$;
