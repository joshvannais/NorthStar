-- Mission24 human decisions. Additive: calculated estimates and old history remain immutable.
CREATE TABLE public.canonical_estimate_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 estimate_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('approve','withdraw')),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 actor_name TEXT NOT NULL,
 source_pins JSONB NOT NULL,
 scope_summary TEXT,
 price_before_tax TEXT,
 currency TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='estimate-quote-preparation-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,estimate_id,id),
 UNIQUE(organization_id,estimate_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,estimate_id) REFERENCES public.canonical_estimates(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,estimate_id,previous_id) REFERENCES public.canonical_estimate_decisions(organization_id,estimate_id,id),
 CHECK((action='approve' AND scope_summary IS NOT NULL AND price_before_tax IS NOT NULL AND length(scope_summary) BETWEEN 1 AND 4000 AND price_before_tax~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$') OR
       (action='withdraw' AND scope_summary IS NULL AND price_before_tax IS NULL AND previous_id IS NOT NULL))
);
CREATE FUNCTION public.canonical_estimate_decision_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Decision history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_estimate_decision_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_estimate_decisions FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_estimate_decision_immutable();

CREATE FUNCTION public.canonical_estimate_decision_source(org UUID,estimate UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('estimateId',e.id,'graphId',e.graph_id,'customerId',p.customer_id,
  'operationId',e.operation_id,'opportunityId',e.opportunity_id,'snapshotId',p.id,
  'snapshotDigest',rtrim(p.snapshot_digest),'calculationVersion',e.calculation_version,
  'normalizedInputFingerprint',rtrim(e.normalized_input_fingerprint),'businessProfileId',e.business_profile_id,
  'businessProfileVersion',e.business_profile_version,'businessProfileHash',rtrim(e.business_profile_hash),
  'supportingFactIds',p.supporting_fact_ids)
 FROM public.canonical_estimates e JOIN public.canonical_polaris_snapshots p ON p.organization_id=e.organization_id AND p.estimate_id=e.id
 JOIN public.canonical_operations o ON o.organization_id=e.organization_id AND o.id=e.operation_id AND o.state='completed'
 WHERE e.organization_id=org AND e.id=estimate AND e.snapshot_digest=p.snapshot_digest;
$$;
CREATE FUNCTION public.canonical_estimate_decision_projection(d public.canonical_estimate_decisions) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'revision',d.revision,'digest',d.digest,'previousId',d.previous_id,'action',d.action,
 'actorName',d.actor_name,'createdAt',d.created_at,'sourcePins',d.source_pins,'scopeSummary',d.scope_summary,
 'priceBeforeTax',d.price_before_tax,'currency',d.currency,'reason',d.reason,'confirmationVersion',d.confirmation_version);
$$;
CREATE FUNCTION public.canonical_estimate_decision_read(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history JSONB; total BIGINT; current_value JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF public.canonical_estimate_decision_source(org,estimate) IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate;
 SELECT public.canonical_estimate_decision_projection(d) INTO current_value FROM public.canonical_estimate_decisions d WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 SELECT COALESCE(jsonb_agg(public.canonical_estimate_decision_projection(d) ORDER BY revision DESC),'[]'::jsonb) INTO history
 FROM (SELECT * FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 20) d;
 RETURN jsonb_build_object('current',current_value,'history',history,'total',total,'truncated',total>20);
END $$;
CREATE FUNCTION public.canonical_estimate_decision_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,estimate UUID,csrf TEXT,key_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; source_value JSONB; old public.canonical_estimate_decisions%ROWTYPE; current_row public.canonical_estimate_decisions%ROWTYPE;
 inserted public.canonical_estimate_decisions%ROWTYPE; key_hash TEXT; request_hash TEXT; next_revision BIGINT; current_currency TEXT; actor_label TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Current owner or admin required' USING ERRCODE='42501'; END IF;
 -- Lock subscription eligibility as well as the audited actor helper's membership/account/session/onboarding rows.
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 -- The inherited helper uses a LEFT JOIN; this new mutation contract requires a present subscription row.
 IF NOT FOUND THEN RAISE EXCEPTION 'Current subscription authority unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT currency INTO current_currency FROM public.canonical_estimates WHERE organization_id=org AND id=estimate FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 source_value:=public.canonical_estimate_decision_source(org,estimate);
 IF source_value IS NULL THEN RAISE EXCEPTION 'Estimate unavailable' USING ERRCODE='P0002'; END IF;
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>32768 OR
  public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','sourcePins','scopeSummary','priceBeforeTax','currency','reason','confirmed','confirmationVersion']) IS NOT TRUE OR
  body->>'action' IS NULL OR body->>'action' NOT IN ('approve','withdraw') OR
  jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,4})$' OR
  body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'estimate-quote-preparation-v1' OR
  jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR length(btrim(body->>'reason')) NOT BETWEEN 1 AND 2000 OR
  body->>'currency' IS DISTINCT FROM current_currency THEN RAISE EXCEPTION 'Decision input invalid' USING ERRCODE='22023'; END IF;
 IF (body->>'action'='approve' AND (jsonb_typeof(body->'scopeSummary') IS DISTINCT FROM 'string' OR length(btrim(body->>'scopeSummary')) NOT BETWEEN 1 AND 4000 OR jsonb_typeof(body->'priceBeforeTax') IS DISTINCT FROM 'string' OR (body->>'priceBeforeTax')!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$')) OR
    (body->>'action'='withdraw' AND (body->'scopeSummary' IS DISTINCT FROM 'null'::jsonb OR body->'priceBeforeTax' IS DISTINCT FROM 'null'::jsonb)) THEN RAISE EXCEPTION 'Decision fields invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':'||actor::text||':estimate-decision:'||key_hash,0));
 SELECT * INTO old FROM public.canonical_estimate_decisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Decision key conflict' USING ERRCODE='23505'; END IF;
  -- A replay may have waited for the estimate or idempotency lock. Revalidate current expiry before returning it.
  PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('receipt',public.canonical_estimate_decision_projection(old),'replayed',TRUE);
 END IF;
 SELECT * INTO current_row FROM public.canonical_estimate_decisions WHERE organization_id=org AND estimate_id=estimate ORDER BY revision DESC LIMIT 1;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(current_row.digest,'none') OR body->'sourcePins' IS DISTINCT FROM source_value THEN
  RAISE EXCEPTION 'Decision or estimate changed' USING ERRCODE='40001',CONSTRAINT='estimate_decision_stale'; END IF;
 IF body->>'action'='withdraw' AND (current_row.id IS NULL OR current_row.action<>'approve') THEN RAISE EXCEPTION 'No current approval' USING ERRCODE='22023'; END IF;
 next_revision:=COALESCE(current_row.revision,0)+1; IF next_revision>10000 THEN RAISE EXCEPTION 'Decision limit' USING ERRCODE='54000'; END IF;
 -- Recheck expiry after any lock waits, before commit-side insertion.
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 SELECT name INTO actor_label FROM public.users WHERE organization_id=org AND id=actor;
 INSERT INTO public.canonical_estimate_decisions(organization_id,estimate_id,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,actor_name,source_pins,scope_summary,price_before_tax,currency,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,estimate,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,COALESCE(actor_label,'Company reviewer'),source_value,body->>'scopeSummary',body->>'priceBeforeTax',current_currency,btrim(body->>'reason'),'estimate-quote-preparation-v1',key_hash,request_hash,
 public.canonical_completion_digest(jsonb_build_object('estimate',estimate,'revision',next_revision,'previous',current_row.id,'actor',actor,'session',session_value,'body',body))) RETURNING * INTO inserted;
 RETURN jsonb_build_object('receipt',public.canonical_estimate_decision_projection(inserted),'replayed',FALSE);
END $$;
REVOKE ALL ON TABLE public.canonical_estimate_decisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_decision_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_decision_source(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_decision_projection(public.canonical_estimate_decisions) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_decision_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_estimate_decision_mutate(uuid,uuid,text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
-- Extend only the existing isolated demo operation vocabulary; old actions remain valid.
ALTER TABLE public.demo_command_center_mutations DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations ADD CONSTRAINT demo_command_center_mutations_operation_check CHECK(operation IN ('simulate_lead','reset','estimate_review'));
