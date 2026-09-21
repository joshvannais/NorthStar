-- Mission 25 Part 12E: explicit reviewed reconciliation for external business-system evidence.
-- Reconciliation is immutable lineage only. It never changes an imported record or a NorthStar
-- customer, job, estimate, execution, project, change order, invoice, payment or accounting record.

CREATE TABLE public.canonical_external_business_reference_matches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id),
 source_class TEXT NOT NULL CHECK(source_class IN ('crm_field_service','project_change_order','communication','financial')),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'),
 consent_id UUID NOT NULL,
 consent_revision BIGINT NOT NULL CHECK(consent_revision BETWEEN 1 AND 10000),
 consent_digest TEXT NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 reference_kind TEXT NOT NULL CHECK(reference_kind IN ('customer','job','estimate','execution','project','change_order','invoice','payment','collection','accounting_entry')),
 external_reference TEXT NOT NULL CHECK(length(external_reference) BETWEEN 1 AND 128 AND external_reference~'^[!-~]+$'),
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 action TEXT NOT NULL CHECK(action IN ('link','unlink')),
 target_kind TEXT,
 target_id UUID,
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='array'),
 source_digest TEXT NOT NULL CHECK(source_digest='unavailable' OR source_digest~'^[0-9a-f]{64}$'),
 target_manifest JSONB NOT NULL CHECK(jsonb_typeof(target_manifest)='array'),
 target_digest TEXT NOT NULL CHECK(target_digest='unavailable' OR target_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(public.canonical_learning_text_valid(reason,2000)),
 confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-business-reference-match-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_class,source_key,consent_id,reference_kind,external_reference,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,source_class,source_key,consent_id,reference_kind,external_reference,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id),
 FOREIGN KEY(organization_id,source_class,source_key,consent_id,reference_kind,external_reference,previous_id)
  REFERENCES public.canonical_external_business_reference_matches(organization_id,source_class,source_key,consent_id,reference_kind,external_reference,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(
  (source_class='crm_field_service' AND reference_kind IN ('customer','job','estimate')) OR
  (source_class='project_change_order' AND reference_kind IN ('customer','job','estimate','project','change_order')) OR
  (source_class='communication' AND reference_kind IN ('customer','job','estimate','project')) OR
  (source_class='financial' AND reference_kind IN ('customer','job','estimate','execution','project','change_order','invoice','payment','collection','accounting_entry'))
 ),
 CHECK((source_class NOT IN ('communication','financial')) OR external_reference~'^ref_[0-9a-f]{64}$'),
 CHECK(
  (action='unlink' AND target_kind IS NULL AND target_id IS NULL AND target_manifest='[]'::jsonb AND target_digest='unavailable') OR
  (action='link' AND source_digest<>'unavailable' AND target_digest<>'unavailable' AND target_id IS NOT NULL AND
   ((reference_kind='customer' AND target_kind='customer') OR
    (reference_kind='execution' AND target_kind='execution') OR
    (reference_kind IN ('job','estimate','project','change_order','invoice','payment','collection','accounting_entry') AND target_kind='estimate')))
 )
);
CREATE INDEX canonical_external_business_reference_matches_current_idx ON public.canonical_external_business_reference_matches(organization_id,source_class,source_key,consent_id,reference_kind,external_reference,revision DESC);

CREATE FUNCTION public.canonical_external_business_reconciliation_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'External business reconciliation history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_external_business_reference_matches_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_business_reference_matches FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_business_reconciliation_immutable();

CREATE FUNCTION public.canonical_external_business_source_consent_basis(org UUID,class_value TEXT,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB;
BEGIN
 IF class_value='crm_field_service' THEN
  SELECT jsonb_build_object('id',id,'revision',revision,'digest',rtrim(canonical_digest)) INTO result FROM public.canonical_external_crm_field_service_import_consents WHERE organization_id=org AND source_key=source_value AND action='grant' AND id=(SELECT id FROM public.canonical_external_crm_field_service_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1);
 ELSIF class_value='project_change_order' THEN
  SELECT jsonb_build_object('id',id,'revision',revision,'digest',rtrim(canonical_digest)) INTO result FROM public.canonical_external_project_change_order_import_consents WHERE organization_id=org AND source_key=source_value AND action='grant' AND id=(SELECT id FROM public.canonical_external_project_change_order_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1);
 ELSIF class_value='communication' THEN
  SELECT jsonb_build_object('id',id,'revision',revision,'digest',rtrim(canonical_digest)) INTO result FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value AND action='grant' AND id=(SELECT id FROM public.canonical_external_communication_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1);
 ELSIF class_value='financial' THEN
  SELECT jsonb_build_object('id',id,'revision',revision,'digest',rtrim(canonical_digest)) INTO result FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value AND action='grant' AND id=(SELECT id FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1);
 ELSE RETURN NULL; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.canonical_external_business_source_references(org UUID,class_value TEXT,source_value TEXT)
RETURNS TABLE(consent_id UUID,consent_revision BIGINT,consent_digest TEXT,reference_kind TEXT,external_reference TEXT,record_count BIGINT,manifest JSONB,source_digest TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_basis JSONB;
BEGIN
 consent_basis:=public.canonical_external_business_source_consent_basis(org,class_value,source_value);
 IF consent_basis IS NULL THEN RETURN; END IF;
 IF class_value='crm_field_service' THEN
  RETURN QUERY WITH current_records AS (
   SELECT DISTINCT ON(r.external_record_id)r.* FROM public.canonical_external_crm_field_service_import_records r
   WHERE r.organization_id=org AND r.source_key=source_value AND r.consent_id=(consent_basis->>'id')::uuid ORDER BY r.external_record_id,r.revision DESC
  ), expanded AS (
   SELECT r.external_record_id,r.revision,r.external_version,r.source_digest record_digest,v.kind,v.reference FROM current_records r
   CROSS JOIN LATERAL(VALUES('customer'::text,r.customer_reference),('job',r.job_reference),('estimate',r.estimate_reference))v(kind,reference)
   WHERE r.state='active' AND v.reference IS NOT NULL
  ), grouped AS (
   SELECT kind,reference,count(*) total,jsonb_agg(jsonb_build_object('externalRecordId',external_record_id,'revision',revision,'externalVersion',external_version,'sourceDigest',rtrim(record_digest))ORDER BY external_record_id) records FROM expanded GROUP BY kind,reference
  ) SELECT (consent_basis->>'id')::uuid,(consent_basis->>'revision')::bigint,consent_basis->>'digest',kind,reference,total,records,
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'consentId',consent_basis->>'id','referenceKind',kind,'externalReference',reference,'records',records)) FROM grouped WHERE total<=1000;
 ELSIF class_value='project_change_order' THEN
  RETURN QUERY WITH current_records AS (
   SELECT DISTINCT ON(r.external_record_id)r.* FROM public.canonical_external_project_change_order_import_records r
   WHERE r.organization_id=org AND r.source_key=source_value AND r.consent_id=(consent_basis->>'id')::uuid ORDER BY r.external_record_id,r.revision DESC
  ), expanded AS (
   SELECT r.external_record_id,r.revision,r.external_version,r.source_digest record_digest,v.kind,v.reference FROM current_records r
   CROSS JOIN LATERAL(VALUES('customer'::text,r.customer_reference),('job',r.job_reference),('estimate',r.estimate_reference),('project',r.project_reference),('change_order',r.change_order_reference))v(kind,reference)
   WHERE r.state='active' AND v.reference IS NOT NULL
  ), grouped AS (
   SELECT kind,reference,count(*) total,jsonb_agg(jsonb_build_object('externalRecordId',external_record_id,'revision',revision,'externalVersion',external_version,'sourceDigest',rtrim(record_digest))ORDER BY external_record_id) records FROM expanded GROUP BY kind,reference
  ) SELECT (consent_basis->>'id')::uuid,(consent_basis->>'revision')::bigint,consent_basis->>'digest',kind,reference,total,records,
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'consentId',consent_basis->>'id','referenceKind',kind,'externalReference',reference,'records',records)) FROM grouped WHERE total<=1000;
 ELSIF class_value='communication' THEN
  RETURN QUERY WITH current_records AS (
   SELECT DISTINCT ON(r.external_record_id)r.* FROM public.canonical_external_communication_import_records r
   WHERE r.organization_id=org AND r.source_key=source_value AND r.consent_id=(consent_basis->>'id')::uuid ORDER BY r.external_record_id,r.revision DESC
  ), expanded AS (
   SELECT r.external_record_id,r.revision,r.external_version,r.source_digest record_digest,v.kind,v.reference FROM current_records r
   CROSS JOIN LATERAL(VALUES('customer'::text,r.customer_reference),('job',r.job_reference),('estimate',r.estimate_reference),('project',r.project_reference))v(kind,reference)
   WHERE r.state='active' AND v.reference IS NOT NULL
  ), grouped AS (
   SELECT kind,reference,count(*) total,jsonb_agg(jsonb_build_object('externalRecordId',external_record_id,'revision',revision,'externalVersion',external_version,'sourceDigest',rtrim(record_digest))ORDER BY external_record_id) records FROM expanded GROUP BY kind,reference
  ) SELECT (consent_basis->>'id')::uuid,(consent_basis->>'revision')::bigint,consent_basis->>'digest',kind,reference,total,records,
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'consentId',consent_basis->>'id','referenceKind',kind,'externalReference',reference,'records',records)) FROM grouped WHERE total<=1000;
 ELSIF class_value='financial' THEN
  RETURN QUERY WITH current_records AS (
   SELECT DISTINCT ON(r.external_record_id)r.* FROM public.canonical_external_financial_import_records r
   WHERE r.organization_id=org AND r.source_key=source_value AND r.consent_id=(consent_basis->>'id')::uuid ORDER BY r.external_record_id,r.revision DESC
  ), expanded AS (
   SELECT r.external_record_id,r.revision,r.external_version,r.source_digest record_digest,v.kind,v.reference FROM current_records r
   CROSS JOIN LATERAL(VALUES('customer'::text,r.customer_reference),('job',r.job_reference),('estimate',r.estimate_reference),('execution',r.execution_reference),('project',r.project_reference),('change_order',r.change_order_reference),('invoice',r.invoice_reference),('payment',r.payment_reference),('collection',r.collection_reference),('accounting_entry',r.accounting_reference))v(kind,reference)
   WHERE r.state='active' AND v.reference IS NOT NULL
  ), grouped AS (
   SELECT kind,reference,count(*) total,jsonb_agg(jsonb_build_object('externalRecordId',external_record_id,'revision',revision,'externalVersion',external_version,'sourceDigest',rtrim(record_digest))ORDER BY external_record_id) records FROM expanded GROUP BY kind,reference
  ) SELECT (consent_basis->>'id')::uuid,(consent_basis->>'revision')::bigint,consent_basis->>'digest',kind,reference,total,records,
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'consentId',consent_basis->>'id','referenceKind',kind,'externalReference',reference,'records',records)) FROM grouped WHERE total<=1000;
 END IF;
END $$;

CREATE FUNCTION public.canonical_external_business_reference_target_basis(org UUID,kind_value TEXT,target_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE manifest JSONB;target_kind_value TEXT;total BIGINT;
BEGIN
 IF kind_value='customer' THEN
  target_kind_value:='customer';
  SELECT jsonb_build_array(jsonb_build_object('targetId',c.id,'operationId',c.operation_id,'graphId',c.graph_id,'updatedAt',c.updated_at)) INTO manifest FROM public.canonical_customers c WHERE c.organization_id=org AND c.id=target_value;
 ELSIF kind_value IN ('job','estimate','project','change_order','invoice','payment','collection','accounting_entry') THEN
  target_kind_value:='estimate';
  SELECT jsonb_build_array(jsonb_build_object('targetId',e.id,'operationId',e.operation_id,'graphId',e.graph_id,'opportunityId',e.opportunity_id,'snapshotDigest',rtrim(e.snapshot_digest),'opportunityUpdatedAt',o.updated_at,'customerUpdatedAt',c.updated_at)) INTO manifest
  FROM public.canonical_estimates e JOIN public.canonical_opportunities o ON o.organization_id=e.organization_id AND o.id=e.opportunity_id JOIN public.canonical_customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id
  WHERE e.organization_id=org AND e.id=target_value;
 ELSIF kind_value='execution' THEN
  target_kind_value:='execution';
  WITH candidates AS (
   SELECT x.id,x.revision,rtrim(x.canonical_digest) execution_digest,x.lifecycle_state,x.appointment_id,x.opportunity_id,o.updated_at opportunity_updated_at,c.updated_at customer_updated_at
   FROM public.canonical_field_executions x JOIN public.canonical_opportunities o ON o.organization_id=x.organization_id AND o.id=x.opportunity_id
   JOIN public.canonical_customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id
   WHERE x.organization_id=org AND x.id=target_value
  ) SELECT count(*),CASE WHEN count(*)=1 THEN jsonb_agg(jsonb_build_object('targetId',id,'revision',revision,'executionDigest',execution_digest,'lifecycleState',lifecycle_state,'appointmentId',appointment_id,'opportunityId',opportunity_id,'opportunityUpdatedAt',opportunity_updated_at,'customerUpdatedAt',customer_updated_at)) ELSE NULL END INTO total,manifest FROM candidates;
  IF total<>1 THEN RETURN NULL; END IF;
 ELSE RETURN NULL; END IF;
 IF manifest IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('targetKind',target_kind_value,'manifest',manifest,'digest',public.canonical_completion_digest(jsonb_build_object('organizationId',org,'targetKind',target_kind_value,'targetId',target_value,'records',manifest)));
END $$;

CREATE FUNCTION public.canonical_external_business_reconciliation_insert_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_basis JSONB;source_basis JSONB;target_basis JSONB;previous_row public.canonical_external_business_reference_matches%ROWTYPE;
BEGIN
 consent_basis:=public.canonical_external_business_source_consent_basis(NEW.organization_id,NEW.source_class,NEW.source_key);
 IF consent_basis IS NULL OR consent_basis->>'id' IS DISTINCT FROM NEW.consent_id::text OR (consent_basis->>'revision')::bigint IS DISTINCT FROM NEW.consent_revision OR consent_basis->>'digest' IS DISTINCT FROM rtrim(NEW.consent_digest) THEN RAISE EXCEPTION 'External source permission changed' USING ERRCODE='23514'; END IF;
 SELECT jsonb_build_object('manifest',s.manifest,'digest',s.source_digest) INTO source_basis FROM public.canonical_external_business_source_references(NEW.organization_id,NEW.source_class,NEW.source_key)s WHERE s.reference_kind=NEW.reference_kind AND s.external_reference=NEW.external_reference;
 IF COALESCE(source_basis->'manifest','[]'::jsonb) IS DISTINCT FROM NEW.source_manifest OR COALESCE(source_basis->>'digest','unavailable') IS DISTINCT FROM NEW.source_digest THEN RAISE EXCEPTION 'External business source lineage invalid' USING ERRCODE='23514'; END IF;
 IF NEW.action='link' THEN
  target_basis:=public.canonical_external_business_reference_target_basis(NEW.organization_id,NEW.reference_kind,NEW.target_id);
  IF target_basis IS NULL OR target_basis->>'targetKind' IS DISTINCT FROM NEW.target_kind OR target_basis->'manifest' IS DISTINCT FROM NEW.target_manifest OR target_basis->>'digest' IS DISTINCT FROM NEW.target_digest THEN RAISE EXCEPTION 'External business target lineage invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.revision>1 THEN
  SELECT * INTO previous_row FROM public.canonical_external_business_reference_matches WHERE organization_id=NEW.organization_id AND source_class=NEW.source_class AND source_key=NEW.source_key AND consent_id=NEW.consent_id AND reference_kind=NEW.reference_kind AND external_reference=NEW.external_reference AND id=NEW.previous_id;
  IF previous_row.id IS NULL OR previous_row.revision+1<>NEW.revision THEN RAISE EXCEPTION 'External business match revision invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_external_business_reference_matches_guard BEFORE INSERT ON public.canonical_external_business_reference_matches FOR EACH ROW EXECUTE FUNCTION public.canonical_external_business_reconciliation_insert_guard();

CREATE FUNCTION public.canonical_external_business_reference_match_projection(value public.canonical_external_business_reference_matches,current_source JSONB,current_target JSONB,current_consent JSONB)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',value.id,'sourceClass',value.source_class,'sourceKey',value.source_key,'referenceKind',value.reference_kind,'externalReference',value.external_reference,
  'revision',value.revision,'previousId',value.previous_id,'consentId',value.consent_id,'consentRevision',value.consent_revision,'consentDigest',rtrim(value.consent_digest),
  'action',value.action,'targetKind',value.target_kind,'targetId',value.target_id,'sourceManifest',value.source_manifest,'sourceDigest',value.source_digest,
  'targetManifest',value.target_manifest,'targetDigest',value.target_digest,'reason',value.reason,'confirmed',value.confirmed,'confirmationVersion',value.confirmation_version,
  'digest',rtrim(value.canonical_digest),'status',CASE WHEN value.action='unlink' THEN 'unmatched' WHEN current_consent IS NULL OR current_consent->>'id' IS DISTINCT FROM value.consent_id::text OR current_consent->>'digest' IS DISTINCT FROM rtrim(value.consent_digest)
   OR current_source IS NULL OR current_target IS NULL OR current_source->>'digest' IS DISTINCT FROM value.source_digest OR current_target->>'digest' IS DISTINCT FROM value.target_digest THEN 'stale' ELSE 'matched' END,'createdAt',value.created_at) $$;

CREATE FUNCTION public.canonical_external_business_reference_matches_read(org UUID,actor UUID,role_value TEXT,session_value UUID,class_value TEXT,source_value TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_basis JSONB;references_value JSONB;reference_total BIGINT;customer_targets JSONB;estimate_targets JSONB;execution_targets JSONB;customer_total BIGINT;estimate_total BIGINT;execution_total BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External business reference review restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF class_value NOT IN ('crm_field_service','project_change_order','communication','financial') OR source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External business source invalid' USING ERRCODE='22023'; END IF;
 consent_basis:=public.canonical_external_business_source_consent_basis(org,class_value,source_value);
 IF consent_basis IS NULL THEN RETURN jsonb_build_object('sourceClass',class_value,'sourceKey',source_value,'activeConsent',FALSE,'references','[]'::jsonb,'referenceTotal',0,'referencesTruncated',FALSE,'customerTargets','[]'::jsonb,'estimateTargets','[]'::jsonb,'executionTargets','[]'::jsonb,'consumptionBoundary','Reference review is unavailable while source permission is inactive.'); END IF;
 WITH basis AS MATERIALIZED(SELECT * FROM public.canonical_external_business_source_references(org,class_value,source_value)),latest AS(SELECT DISTINCT ON(reference_kind,external_reference)* FROM public.canonical_external_business_reference_matches WHERE organization_id=org AND source_class=class_value AND source_key=source_value AND consent_id=(consent_basis->>'id')::uuid ORDER BY reference_kind,external_reference,revision DESC),all_refs AS(SELECT reference_kind,external_reference FROM basis UNION SELECT reference_kind,external_reference FROM latest) SELECT count(*) INTO reference_total FROM all_refs;
 WITH basis AS MATERIALIZED(SELECT * FROM public.canonical_external_business_source_references(org,class_value,source_value)),latest AS(SELECT DISTINCT ON(reference_kind,external_reference)* FROM public.canonical_external_business_reference_matches WHERE organization_id=org AND source_class=class_value AND source_key=source_value AND consent_id=(consent_basis->>'id')::uuid ORDER BY reference_kind,external_reference,revision DESC),selected AS(SELECT * FROM(SELECT reference_kind,external_reference FROM basis UNION SELECT reference_kind,external_reference FROM latest)q ORDER BY reference_kind,external_reference LIMIT 100)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('referenceKind',r.reference_kind,'externalReference',r.external_reference,'sourceRecordCount',COALESCE(b.record_count,0),'sourceDigest',COALESCE(b.source_digest,'unavailable'),'match',CASE WHEN m.id IS NULL THEN NULL ELSE public.canonical_external_business_reference_match_projection(m,CASE WHEN b.source_digest IS NULL THEN NULL ELSE jsonb_build_object('digest',b.source_digest) END,t.value,consent_basis)END) ORDER BY r.reference_kind,r.external_reference),'[]'::jsonb) INTO references_value
 FROM selected r LEFT JOIN basis b ON b.reference_kind=r.reference_kind AND b.external_reference=r.external_reference LEFT JOIN latest m ON m.reference_kind=r.reference_kind AND m.external_reference=r.external_reference LEFT JOIN LATERAL(SELECT public.canonical_external_business_reference_target_basis(org,m.reference_kind,m.target_id)value)t ON m.target_id IS NOT NULL;
 SELECT count(*) INTO customer_total FROM public.canonical_customers WHERE organization_id=org;
 WITH raw AS(SELECT c.id,c.name,public.canonical_external_business_reference_target_basis(org,'customer',c.id)basis FROM public.canonical_customers c WHERE c.organization_id=org ORDER BY c.updated_at DESC,c.id DESC LIMIT 100) SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId',id,'label',public.canonical_learning_target_label_text(name,240),'digest',basis->>'digest')ORDER BY id),'[]'::jsonb) INTO customer_targets FROM raw WHERE basis IS NOT NULL;
 SELECT count(*) INTO estimate_total FROM public.canonical_estimates WHERE organization_id=org;
 WITH raw AS(SELECT e.id,public.canonical_external_business_reference_target_basis(org,'estimate',e.id)basis FROM public.canonical_estimates e WHERE e.organization_id=org ORDER BY e.created_at DESC,e.id DESC LIMIT 100) SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId',id,'digest',basis->>'digest')ORDER BY id),'[]'::jsonb) INTO estimate_targets FROM raw WHERE basis IS NOT NULL;
 SELECT count(*) INTO execution_total FROM public.canonical_field_executions WHERE organization_id=org;
 WITH raw AS(SELECT x.id,public.canonical_external_business_reference_target_basis(org,'execution',x.id)basis,
   public.canonical_learning_target_label_compose(concat_ws(' · ',public.canonical_learning_target_label_text(c.name,180),COALESCE(public.canonical_learning_target_label_text(o.service_type,140),public.canonical_learning_target_label_text(o.job_scope->>'jobTitle',140))),'Current work',240)label
   FROM public.canonical_field_executions x JOIN public.canonical_opportunities o ON o.organization_id=x.organization_id AND o.id=x.opportunity_id JOIN public.canonical_customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id
   WHERE x.organization_id=org ORDER BY x.updated_at DESC,x.id DESC LIMIT 100) SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId',id,'label',label,'digest',basis->>'digest')ORDER BY id),'[]'::jsonb) INTO execution_targets FROM raw WHERE basis IS NOT NULL AND label IS NOT NULL;
 RETURN jsonb_build_object('sourceClass',class_value,'sourceKey',source_value,'activeConsent',TRUE,'consent',consent_basis,'references',references_value,'referenceTotal',reference_total,'referencesTruncated',reference_total>100,
  'customerTargets',customer_targets,'customerTargetTotal',customer_total,'customerTargetsTruncated',customer_total>100,'estimateTargets',estimate_targets,'estimateTargetTotal',estimate_total,'estimateTargetsTruncated',estimate_total>100,
  'executionTargets',execution_targets,'executionTargetTotal',execution_total,'executionTargetsTruncated',execution_total>100,'targetRules',jsonb_build_object('customer','customer','job','estimate','estimate','estimate','execution','execution','project','estimate','change_order','estimate','invoice','estimate','payment','estimate','collection','estimate','accounting_entry','estimate'),
  'nativeFinancialBoundary','External financial references can be linked to their owning estimate. This does not create a NorthStar invoice, payment, collection or accounting record.',
  'consumptionBoundary','Only current reviewed links may support later tenant-private observations. No imported or NorthStar record is changed.');
END $$;

CREATE FUNCTION public.canonical_external_business_reference_match_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,class_value TEXT,source_value TEXT,body JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;consent_basis JSONB;current_row public.canonical_external_business_reference_matches%ROWTYPE;replay public.canonical_external_business_reference_matches%ROWTYPE;inserted public.canonical_external_business_reference_matches%ROWTYPE;source_basis JSONB;target_basis JSONB;key_hash TEXT;request_hash TEXT;digest_value TEXT;next_revision BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External business reference review restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF class_value NOT IN ('crm_field_service','project_change_order','communication','financial') OR source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>16384
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','referenceKind','externalReference','targetKind','targetId','expectedRevision','expectedDigest','expectedSourceDigest','expectedTargetDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR body->>'action' NOT IN ('link','unlink') OR jsonb_typeof(body->'referenceKind') IS DISTINCT FROM 'string' OR body->>'referenceKind' NOT IN ('customer','job','estimate','execution','project','change_order','invoice','payment','collection','accounting_entry')
  OR jsonb_typeof(body->'externalReference') IS DISTINCT FROM 'string' OR length(body->>'externalReference') NOT BETWEEN 1 AND 128 OR body->>'externalReference'!~'^[!-~]+$'
  OR (class_value IN ('communication','financial') AND body->>'externalReference'!~'^ref_[0-9a-f]{64}$')
  OR NOT ((class_value='crm_field_service' AND body->>'referenceKind' IN ('customer','job','estimate')) OR(class_value='project_change_order' AND body->>'referenceKind' IN ('customer','job','estimate','project','change_order')) OR(class_value='communication' AND body->>'referenceKind' IN ('customer','job','estimate','project')) OR(class_value='financial' AND body->>'referenceKind' IN ('customer','job','estimate','execution','project','change_order','invoice','payment','collection','accounting_entry')))
  OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,3}|10000)$' OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$' OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none'))
  OR jsonb_typeof(body->'expectedSourceDigest') IS DISTINCT FROM 'string' OR body->>'expectedSourceDigest'!~'^(unavailable|[0-9a-f]{64})$' OR jsonb_typeof(body->'expectedTargetDigest') IS DISTINCT FROM 'string' OR body->>'expectedTargetDigest'!~'^(unavailable|[0-9a-f]{64})$'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-business-reference-match-v1'
  OR (body->>'action'='link' AND (jsonb_typeof(body->'targetKind') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'targetId') IS DISTINCT FROM 'string' OR NOT pg_input_is_valid(body->>'targetId','uuid') OR body->>'expectedSourceDigest'='unavailable' OR body->>'expectedTargetDigest'='unavailable'
   OR NOT((body->>'referenceKind'='customer' AND body->>'targetKind'='customer')OR(body->>'referenceKind'='execution' AND body->>'targetKind'='execution')OR(body->>'referenceKind' IN ('job','estimate','project','change_order','invoice','payment','collection','accounting_entry')AND body->>'targetKind'='estimate'))))
  OR (body->>'action'='unlink' AND (body->'targetKind'<>'null'::jsonb OR body->'targetId'<>'null'::jsonb OR body->>'expectedTargetDigest'<>'unavailable')) THEN RAISE EXCEPTION 'External business reference match invalid' USING ERRCODE='22023'; END IF;
 IF class_value='crm_field_service' THEN PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-crm-field-service-import:'||source_value,0));
 ELSIF class_value='project_change_order' THEN PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-project-change-order-import:'||source_value,0));
 ELSIF class_value='communication' THEN PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-communication-import:'||source_value,0));
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-financial-import:'||source_value,0)); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-business-match:'||class_value||':'||source_value||':'||(body->>'referenceKind')||':'||(body->>'externalReference'),0));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceClass',class_value,'sourceKey',source_value,'body',body));
 SELECT * INTO replay FROM public.canonical_external_business_reference_matches WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'External business reference match key conflict' USING ERRCODE='23505'; END IF;
  consent_basis:=public.canonical_external_business_source_consent_basis(org,class_value,source_value);
  IF consent_basis IS NULL OR consent_basis->>'id' IS DISTINCT FROM replay.consent_id::text THEN RETURN jsonb_build_object('match',jsonb_build_object('revision',replay.revision,'status','unavailable','action',replay.action),'replayed',TRUE); END IF;
  SELECT jsonb_build_object('digest',s.source_digest) INTO source_basis FROM public.canonical_external_business_source_references(org,class_value,source_value)s WHERE s.reference_kind=replay.reference_kind AND s.external_reference=replay.external_reference;
  target_basis:=public.canonical_external_business_reference_target_basis(org,replay.reference_kind,replay.target_id);
  RETURN jsonb_build_object('match',public.canonical_external_business_reference_match_projection(replay,source_basis,target_basis,consent_basis),'replayed',TRUE);
 END IF;
 consent_basis:=public.canonical_external_business_source_consent_basis(org,class_value,source_value);IF consent_basis IS NULL THEN RAISE EXCEPTION 'External source permission changed' USING ERRCODE='40001',CONSTRAINT='business_match_source_changed';END IF;
 SELECT * INTO current_row FROM public.canonical_external_business_reference_matches WHERE organization_id=org AND source_class=class_value AND source_key=source_value AND consent_id=(consent_basis->>'id')::uuid AND reference_kind=body->>'referenceKind' AND external_reference=body->>'externalReference' ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF (body->>'expectedRevision')::bigint IS DISTINCT FROM COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN RAISE EXCEPTION 'External business reference match changed' USING ERRCODE='40001';END IF;
 SELECT jsonb_build_object('manifest',s.manifest,'digest',s.source_digest) INTO source_basis FROM public.canonical_external_business_source_references(org,class_value,source_value)s WHERE s.reference_kind=body->>'referenceKind' AND s.external_reference=body->>'externalReference';
 IF body->>'expectedSourceDigest' IS DISTINCT FROM COALESCE(source_basis->>'digest','unavailable') THEN RAISE EXCEPTION 'Imported business evidence changed' USING ERRCODE='40001',CONSTRAINT='business_match_source_changed';END IF;
 IF body->>'action'='link' THEN target_basis:=public.canonical_external_business_reference_target_basis(org,body->>'referenceKind',(body->>'targetId')::uuid);IF source_basis IS NULL OR target_basis IS NULL OR target_basis->>'targetKind' IS DISTINCT FROM body->>'targetKind' THEN RAISE EXCEPTION 'NorthStar target unavailable' USING ERRCODE='22023';END IF;IF body->>'expectedTargetDigest' IS DISTINCT FROM target_basis->>'digest' THEN RAISE EXCEPTION 'NorthStar record changed' USING ERRCODE='40001',CONSTRAINT='business_match_target_changed';END IF;
 ELSE target_basis:=NULL;IF current_row.id IS NULL OR current_row.action<>'link' THEN RAISE EXCEPTION 'External business unlink invalid' USING ERRCODE='22023';END IF;END IF;
 next_revision:=COALESCE(current_row.revision,0)+1;digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceClass',class_value,'sourceKey',source_value,'consentId',consent_basis->>'id','referenceKind',body->>'referenceKind','externalReference',body->>'externalReference','revision',next_revision,'previousId',current_row.id,'action',body->>'action','targetKind',body->>'targetKind','targetId',body->>'targetId','sourceDigest',COALESCE(source_basis->>'digest','unavailable'),'targetDigest',COALESCE(target_basis->>'digest','unavailable'),'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'reason',body->>'reason','confirmationVersion','m25-external-business-reference-match-v1','requestDigest',request_hash));
 INSERT INTO public.canonical_external_business_reference_matches(organization_id,source_class,source_key,consent_id,consent_revision,consent_digest,reference_kind,external_reference,revision,previous_id,action,target_kind,target_id,source_manifest,source_digest,target_manifest,target_digest,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(org,class_value,source_value,(consent_basis->>'id')::uuid,(consent_basis->>'revision')::bigint,consent_basis->>'digest',body->>'referenceKind',body->>'externalReference',next_revision,current_row.id,body->>'action',body->>'targetKind',(body->>'targetId')::uuid,COALESCE(source_basis->'manifest','[]'::jsonb),COALESCE(source_basis->>'digest','unavailable'),COALESCE(target_basis->'manifest','[]'::jsonb),COALESCE(target_basis->>'digest','unavailable'),actor,(authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,'m25-external-business-reference-match-v1',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('match',public.canonical_external_business_reference_match_projection(inserted,source_basis,target_basis,consent_basis),'replayed',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_external_business_reference_matches FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_reconciliation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_reconciliation_insert_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_source_consent_basis(UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_source_references(UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_reference_target_basis(UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_reference_match_projection(public.canonical_external_business_reference_matches,JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_reference_matches_read(UUID,UUID,TEXT,UUID,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_business_reference_match_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
