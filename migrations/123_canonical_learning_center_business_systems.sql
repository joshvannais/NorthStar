-- Mission 25 Part 12K: bounded Learning Center inventory for reviewed business-system evidence.
-- This projection exposes tenant-private source and service availability only. It does not connect
-- to providers or change customers, jobs, estimates, projects, financial records, or company policy.

ALTER FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID)
 RENAME TO canonical_learning_center_part11_read;

CREATE FUNCTION public.canonical_learning_center_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base JSONB; business_rows JSONB; business_total BIGINT; combined JSONB;
BEGIN
 base:=public.canonical_learning_center_part11_read(org,actor,role_value,session_value);

 WITH source_keys AS (
  SELECT 'crm_field_service'::text source_kind,source_key FROM public.canonical_external_crm_field_service_import_consents WHERE organization_id=org
  UNION SELECT 'crm_field_service',source_key FROM public.canonical_external_crm_field_service_import_runs WHERE organization_id=org
  UNION SELECT 'crm_field_service',source_key FROM public.canonical_external_crm_field_service_import_records WHERE organization_id=org
  UNION SELECT 'project_change_order',source_key FROM public.canonical_external_project_change_order_import_consents WHERE organization_id=org
  UNION SELECT 'project_change_order',source_key FROM public.canonical_external_project_change_order_import_runs WHERE organization_id=org
  UNION SELECT 'project_change_order',source_key FROM public.canonical_external_project_change_order_import_records WHERE organization_id=org
  UNION SELECT 'communication',source_key FROM public.canonical_external_communication_import_consents WHERE organization_id=org
  UNION SELECT 'communication',source_key FROM public.canonical_external_communication_import_runs WHERE organization_id=org
  UNION SELECT 'communication',source_key FROM public.canonical_external_communication_import_records WHERE organization_id=org
  UNION SELECT 'financial',source_key FROM public.canonical_external_financial_import_consents WHERE organization_id=org
  UNION SELECT 'financial',source_key FROM public.canonical_external_financial_import_runs WHERE organization_id=org
  UNION SELECT 'financial',source_key FROM public.canonical_external_financial_import_records WHERE organization_id=org
  UNION SELECT source_class,source_key FROM public.canonical_external_business_reference_matches WHERE organization_id=org
  UNION SELECT 'crm_field_service',crm_source_key FROM public.canonical_external_customer_outcome_consents WHERE organization_id=org
  UNION SELECT 'communication',communication_source_key FROM public.canonical_external_customer_outcome_consents WHERE organization_id=org
  UNION SELECT 'crm_field_service',crm_source_key FROM public.canonical_external_customer_outcome_observations WHERE organization_id=org
  UNION SELECT 'communication',communication_source_key FROM public.canonical_external_customer_outcome_observations WHERE organization_id=org
  UNION SELECT 'project_change_order',source_key FROM public.canonical_external_project_outcome_consents WHERE organization_id=org
  UNION SELECT 'project_change_order',source_key FROM public.canonical_external_project_outcome_observations WHERE organization_id=org
  UNION SELECT 'financial',source_key FROM public.canonical_external_financial_outcome_consents WHERE organization_id=org
  UNION SELECT 'financial',source_key FROM public.canonical_external_financial_outcome_observations WHERE organization_id=org
  UNION SELECT CASE calibration_kind WHEN 'customer' THEN 'crm_field_service' WHEN 'project' THEN 'project_change_order' ELSE 'financial' END,source_key FROM public.canonical_external_business_calibration_consents WHERE organization_id=org
  UNION SELECT 'communication',secondary_source_key FROM public.canonical_external_business_calibration_consents WHERE organization_id=org AND calibration_kind='customer'
  UNION SELECT CASE calibration_kind WHEN 'customer' THEN 'crm_field_service' WHEN 'project' THEN 'project_change_order' ELSE 'financial' END,source_key FROM public.canonical_external_business_calibration_proposals WHERE organization_id=org
  UNION SELECT 'communication',secondary_source_key FROM public.canonical_external_business_calibration_proposals WHERE organization_id=org AND calibration_kind='customer'
  UNION SELECT source_class,source_key FROM public.canonical_external_business_adapter_revisions WHERE organization_id=org
  UNION SELECT source_class,source_key FROM public.canonical_external_business_retention_revisions WHERE organization_id=org
  UNION SELECT source_class,source_key FROM public.canonical_external_business_deletion_revisions WHERE organization_id=org
  UNION SELECT source_class,source_key FROM public.canonical_external_business_hold_revisions WHERE organization_id=org
 ), active_sources AS (
  SELECT 'crm_field_service'::text source_kind,source_key,id FROM (SELECT DISTINCT ON(source_key) source_key,id,action FROM public.canonical_external_crm_field_service_import_consents WHERE organization_id=org ORDER BY source_key,revision DESC,id DESC)x WHERE action='grant'
  UNION ALL SELECT 'project_change_order',source_key,id FROM (SELECT DISTINCT ON(source_key) source_key,id,action FROM public.canonical_external_project_change_order_import_consents WHERE organization_id=org ORDER BY source_key,revision DESC,id DESC)x WHERE action='grant'
  UNION ALL SELECT 'communication',source_key,id FROM (SELECT DISTINCT ON(source_key) source_key,id,action FROM public.canonical_external_communication_import_consents WHERE organization_id=org ORDER BY source_key,revision DESC,id DESC)x WHERE action='grant'
  UNION ALL SELECT 'financial',source_key,id FROM (SELECT DISTINCT ON(source_key) source_key,id,action FROM public.canonical_external_financial_import_consents WHERE organization_id=org ORDER BY source_key,revision DESC,id DESC)x WHERE action='grant'
 ), customer_permissions AS (
  SELECT crm_source_key,communication_source_key,id,crm_source_consent_id,communication_source_consent_id FROM (SELECT DISTINCT ON(crm_source_key,communication_source_key) crm_source_key,communication_source_key,id,action,crm_source_consent_id,communication_source_consent_id FROM public.canonical_external_customer_outcome_consents WHERE organization_id=org ORDER BY crm_source_key,communication_source_key,revision DESC,id DESC)x WHERE action='grant'
 ), project_permissions AS (
  SELECT source_key,id,source_consent_id FROM (SELECT DISTINCT ON(source_key) source_key,id,action,source_consent_id FROM public.canonical_external_project_outcome_consents WHERE organization_id=org ORDER BY source_key,revision DESC,id DESC)x WHERE action='grant'
 ), financial_permissions AS (
  SELECT source_key,id,source_consent_id FROM (SELECT DISTINCT ON(source_key) source_key,id,action,source_consent_id FROM public.canonical_external_financial_outcome_consents WHERE organization_id=org ORDER BY source_key,revision DESC,id DESC)x WHERE action='grant'
 ), service_keys AS (
  SELECT 'crm_field_service'::text source_kind,o.crm_source_key source_key,lower(btrim(p.service_type)) service_key FROM public.canonical_external_customer_outcome_observations o JOIN customer_permissions permission ON permission.crm_source_key=o.crm_source_key AND permission.communication_source_key=o.communication_source_key AND permission.id=o.consent_id JOIN active_sources crm ON crm.source_kind='crm_field_service' AND crm.source_key=o.crm_source_key AND crm.id=permission.crm_source_consent_id JOIN active_sources communication ON communication.source_kind='communication' AND communication.source_key=o.communication_source_key AND communication.id=permission.communication_source_consent_id JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE o.organization_id=org
  UNION SELECT 'communication',o.communication_source_key,lower(btrim(p.service_type)) FROM public.canonical_external_customer_outcome_observations o JOIN customer_permissions permission ON permission.crm_source_key=o.crm_source_key AND permission.communication_source_key=o.communication_source_key AND permission.id=o.consent_id JOIN active_sources crm ON crm.source_kind='crm_field_service' AND crm.source_key=o.crm_source_key AND crm.id=permission.crm_source_consent_id JOIN active_sources communication ON communication.source_kind='communication' AND communication.source_key=o.communication_source_key AND communication.id=permission.communication_source_consent_id JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE o.organization_id=org
  UNION SELECT 'project_change_order',o.source_key,lower(btrim(p.service_type)) FROM public.canonical_external_project_outcome_observations o JOIN project_permissions permission ON permission.source_key=o.source_key AND permission.id=o.consent_id JOIN active_sources source ON source.source_kind='project_change_order' AND source.source_key=o.source_key AND source.id=permission.source_consent_id JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE o.organization_id=org
  UNION SELECT 'financial',o.source_key,lower(btrim(p.service_type)) FROM public.canonical_external_financial_outcome_observations o JOIN financial_permissions permission ON permission.source_key=o.source_key AND permission.id=o.consent_id JOIN active_sources source ON source.source_kind='financial' AND source.source_key=o.source_key AND source.id=permission.source_consent_id JOIN public.canonical_estimates e ON e.organization_id=org AND e.id=o.estimate_id JOIN public.canonical_opportunities p ON p.organization_id=org AND p.id=e.opportunity_id WHERE o.organization_id=org
 ), service_distinct AS (
  SELECT DISTINCT source_kind,source_key,service_key FROM service_keys WHERE service_key~'^[a-z0-9][a-z0-9._-]{1,63}$'
 ), service_counts AS (
  SELECT source_kind,source_key,count(*) total FROM service_distinct GROUP BY source_kind,source_key
 ), selected_services AS (
  SELECT source_kind,source_key,jsonb_agg(service_key ORDER BY service_key) services FROM (SELECT *,row_number() OVER(PARTITION BY source_kind,source_key ORDER BY service_key) ordinal FROM service_distinct) values_limited WHERE ordinal<=50 GROUP BY source_kind,source_key
 ), rows AS (
  SELECT k.source_kind,k.source_key,COALESCE(s.services,'[]'::jsonb) service_keys,COALESCE(c.total,0) service_total FROM source_keys k LEFT JOIN selected_services s USING(source_kind,source_key) LEFT JOIN service_counts c USING(source_kind,source_key)
 ) SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('sourceKind',source_kind,'sourceKey',source_key,'serviceKeys',service_keys,'serviceTotal',service_total,'servicesTruncated',service_total>50) ORDER BY source_kind,source_key),'[]'::jsonb) INTO business_total,business_rows FROM rows;

 SELECT COALESCE(jsonb_agg(value ORDER BY value->>'sourceKind',value->>'sourceKey'),'[]'::jsonb) INTO combined FROM (SELECT value FROM jsonb_array_elements(COALESCE(base->'sources','[]'::jsonb)||business_rows) value ORDER BY value->>'sourceKind',value->>'sourceKey' LIMIT 100) selected;
 RETURN (base-'version'-'sources'-'sourceTotal'-'sourcesTruncated'-'learningBoundary')||jsonb_build_object('version','m25-learning-center-v5','sources',combined,'sourceTotal',(base->>'sourceTotal')::bigint+business_total,'sourcesTruncated',(base->>'sourceTotal')::bigint+business_total>100,'learningBoundary','Learning remains advisory. NorthStar does not automatically change customers, leads, appointments, estimates, projects, jobs, change orders, invoices, payments, accounting records, prices, material plans, inventory, purchases, equipment plans, routes, schedules, payroll, company records or business policy.');
END $$;

REVOKE ALL ON FUNCTION public.canonical_learning_center_part11_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
