-- Part 8 Slice 2: immutable owner-issued customer estimate versions. Delivery and response are later authorities.
CREATE TABLE public.canonical_customer_estimate_versions(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,commercial_approval_id UUID NOT NULL,terms_id UUID NOT NULL,decision_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),actor_name TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),approval_pin JSONB NOT NULL,document JSONB NOT NULL,document_digest TEXT NOT NULL CHECK(document_digest~'^[a-f0-9]{64}$'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[a-f0-9]{64}$'),request_digest TEXT NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),digest TEXT NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,estimate_id,id),UNIQUE(organization_id,estimate_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,estimate_id,commercial_approval_id),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_customer_estimate_versions(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,commercial_approval_id) REFERENCES public.canonical_commercial_approvals(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,terms_id) REFERENCES public.canonical_commercial_terms(organization_id,estimate_id,id),
 FOREIGN KEY(organization_id,estimate_id,decision_id) REFERENCES public.canonical_estimate_decisions(organization_id,estimate_id,id),
 CHECK(approval_pin->>'id'=commercial_approval_id::text),CHECK(document->>'contract'='NorthStarCustomerEstimatePreview/v1'),CHECK(document->>'state'='issued')
);
CREATE INDEX canonical_customer_estimate_versions_history ON public.canonical_customer_estimate_versions(organization_id,estimate_id,revision DESC);

CREATE FUNCTION public.canonical_customer_estimate_version_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Issued estimate history is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER canonical_customer_estimate_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_customer_estimate_versions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_customer_estimate_version_immutable();

CREATE FUNCTION public.canonical_customer_estimate_version_projection(v public.canonical_customer_estimate_versions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',v.id,'revision',v.revision,'previousId',v.previous_id,'actorName',v.actor_name,'reason',v.reason,'approvalPin',v.approval_pin,'document',v.document,'documentDigest',v.document_digest,'digest',v.digest,'createdAt',v.created_at)
$$;

CREATE FUNCTION public.canonical_customer_estimate_version_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_customer_estimate_versions%ROWTYPE;history JSONB;total_value BIGINT;
BEGIN
 IF current_setting('transaction_isolation') NOT IN('repeatable read','serializable') OR role_value IS NULL OR role_value NOT IN('owner','admin') THEN RAISE EXCEPTION 'Protected issued estimate read required' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_estimate_decision_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO current_row FROM public.canonical_customer_estimate_versions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total_value FROM public.canonical_customer_estimate_versions WHERE organization_id=org AND estimate_id=estimate;
 SELECT COALESCE(jsonb_agg(public.canonical_customer_estimate_version_projection(x) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM(SELECT * FROM public.canonical_customer_estimate_versions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 50)x;
 RETURN jsonb_build_object('current',CASE WHEN current_row.id IS NOT NULL THEN public.canonical_customer_estimate_version_projection(current_row) END,'history',history,'total',total_value,'truncated',total_value>50);
END $$;

CREATE FUNCTION public.canonical_customer_estimate_version_issue(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body_value JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;sources JSONB;terms_row public.canonical_commercial_terms%ROWTYPE;approval_row public.canonical_commercial_approvals%ROWTYPE;current_state JSONB;current_row public.canonical_customer_estimate_versions%ROWTYPE;old public.canonical_customer_estimate_versions%ROWTYPE;inserted public.canonical_customer_estimate_versions%ROWTYPE;key_hash TEXT;request_hash TEXT;document_hash TEXT;next_revision BIGINT;actor_label TEXT;
BEGIN
 authority:=public.canonical_commercial_lock(org,actor,role_value,session_value,estimate,csrf);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body_value::text)>131072 OR public.canonical_field_evidence_object_keys_exact(body_value,ARRAY['reason','confirmed','confirmationVersion','approvalPin','document']) IS NOT TRUE OR body_value->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body_value->>'confirmationVersion' IS DISTINCT FROM 'customer-estimate-issue-v1' OR public.canonical_pricing_text(body_value->'reason',1000) IS NOT TRUE OR jsonb_typeof(body_value->'approvalPin') IS DISTINCT FROM 'object' OR public.canonical_field_evidence_object_keys_exact(body_value->'approvalPin',ARRAY['id','digest']) IS NOT TRUE OR (body_value#>>'{approvalPin,id}')!~'^[0-9a-f-]{36}$' OR (body_value#>>'{approvalPin,digest}')!~'^[a-f0-9]{64}$' OR jsonb_typeof(body_value->'document') IS DISTINCT FROM 'object' OR body_value#>>'{document,contract}' IS DISTINCT FROM 'NorthStarCustomerEstimatePreview/v1' OR body_value#>>'{document,state}' IS DISTINCT FROM 'issued' THEN RAISE EXCEPTION 'Issued estimate input invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body_value));document_hash:=public.canonical_completion_digest(body_value->'document');
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':customer-estimate-version:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_customer_estimate_versions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Issued estimate attempt changed' USING ERRCODE='23505';END IF;PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);RETURN jsonb_build_object('receipt',public.canonical_customer_estimate_version_projection(old),'replayed',TRUE);END IF;
 SELECT * INTO terms_row FROM public.canonical_commercial_terms WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT * INTO approval_row FROM public.canonical_commercial_approvals WHERE organization_id=org AND estimate_id=estimate ORDER BY created_at DESC,id DESC LIMIT 1;
 IF terms_row.id IS NULL OR approval_row.id IS NULL OR approval_row.terms_id<>terms_row.id OR body_value->'approvalPin' IS DISTINCT FROM jsonb_build_object('id',approval_row.id,'digest',approval_row.digest) THEN RAISE EXCEPTION 'Current commercial approval changed' USING ERRCODE='40001';END IF;
 sources:=public.canonical_commercial_sources(org,actor,role_value,session_value,estimate,NULL);current_state:=public.canonical_commercial_current(public.canonical_commercial_projection(terms_row),sources,public.canonical_commercial_binding_projection(approval_row));
 IF current_state->'current' IS DISTINCT FROM 'true'::jsonb OR current_state->'linkedApproval' IS DISTINCT FROM 'true'::jsonb OR body_value#>>'{document,work,scope}' IS DISTINCT FROM approval_row.body->>'scopeSummary' OR body_value#>>'{document,currency}' IS DISTINCT FROM terms_row.result->>'currency' OR body_value#>>'{document,subtotal}' IS DISTINCT FROM terms_row.result->>'netBeforeTax' OR body_value#>>'{document,tax}' IS DISTINCT FROM terms_row.result->>'tax' OR body_value#>>'{document,total}' IS DISTINCT FROM terms_row.result->>'total' THEN RAISE EXCEPTION 'Approved customer estimate changed' USING ERRCODE='40001';END IF;
 SELECT * INTO old FROM public.canonical_customer_estimate_versions WHERE organization_id=org AND estimate_id=estimate AND commercial_approval_id=approval_row.id;
 IF FOUND THEN PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);RETURN jsonb_build_object('receipt',public.canonical_customer_estimate_version_projection(old),'replayed',TRUE);END IF;
 SELECT * INTO current_row FROM public.canonical_customer_estimate_versions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;next_revision:=COALESCE(current_row.revision,0)+1;IF next_revision>10000 THEN RAISE EXCEPTION 'Issued estimate history limit' USING ERRCODE='54000';END IF;
 PERFORM public.canonical_travel_write_authority(org,actor,role_value,session_value,csrf);SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_customer_estimate_versions(organization_id,estimate_id,revision,previous_id,commercial_approval_id,terms_id,decision_id,actor_user_id,membership_id,auth_session_id,actor_name,reason,approval_pin,document,document_digest,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,approval_row.id,approval_row.terms_id,approval_row.decision_id,actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),btrim(body_value->>'reason'),body_value->'approvalPin',body_value->'document',document_hash,key_hash,request_hash,public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'approval',approval_row.id,'documentDigest',document_hash,'actor',actor,'session',session_value))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_customer_estimate_version_projection(inserted),'replayed',FALSE);
END $$;

ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN('customer_estimate_issue','proposal_adopt','simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan','equipment_cost','equipment_ready','travel_plan','pricing_plan','pricing_policy','commercial_terms','commercial_ok','tax_profile'));
