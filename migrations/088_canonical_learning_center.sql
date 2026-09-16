-- Mission 25 Part 7: owner-facing Learning Center source inventory.
-- This read model enumerates tenant-private learning sources without exposing the protected source tables.

CREATE FUNCTION public.canonical_learning_center_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_rows JSONB; source_total BIGINT; native_consent JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Learning Center is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 native_consent:=public.canonical_learning_consent_read(org,actor,role_value,session_value);
 WITH source_keys AS (
  SELECT source_key FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_runs WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_records WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_reference_matches WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_calibration_consents WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_calibration_proposals WHERE organization_id=org
 ) SELECT count(*) INTO source_total FROM source_keys;
 WITH source_keys AS (
  SELECT source_key FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_runs WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_records WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_reference_matches WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_calibration_consents WHERE organization_id=org
  UNION SELECT source_key FROM public.canonical_external_labor_calibration_proposals WHERE organization_id=org
 ), selected AS (SELECT source_key FROM source_keys ORDER BY source_key LIMIT 100), service_keys AS (
  SELECT observation.source_key,lower(btrim(opportunity.service_type)) service_key
  FROM (SELECT DISTINCT ON (organization_id,source_key,estimate_id,external_job_reference) *
    FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
    ORDER BY organization_id,source_key,estimate_id,external_job_reference,revision DESC,id DESC) observation
  JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=observation.estimate_id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
  UNION SELECT source_key,service_key FROM public.canonical_external_labor_calibration_proposals WHERE organization_id=org
 ), service_counts AS (
  SELECT source_key,count(*) total FROM (SELECT DISTINCT source_key,service_key FROM service_keys) value GROUP BY source_key
 ), selected_services AS (
  SELECT source_key,COALESCE(jsonb_agg(service_key ORDER BY service_key),'[]'::jsonb) services FROM (
   SELECT source_key,service_key,row_number() OVER(PARTITION BY source_key ORDER BY service_key) ordinal
   FROM (SELECT DISTINCT source_key,service_key FROM service_keys) value
  ) limited WHERE ordinal<=50 GROUP BY source_key
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceKey',selected.source_key,
   'serviceKeys',COALESCE(selected_services.services,'[]'::jsonb),
   'serviceTotal',COALESCE(service_counts.total,0),
   'servicesTruncated',COALESCE(service_counts.total,0)>50) ORDER BY selected.source_key),'[]'::jsonb)
 INTO source_rows FROM selected LEFT JOIN service_counts USING(source_key) LEFT JOIN selected_services USING(source_key);
 RETURN jsonb_build_object('version','m25-learning-center-v1','authority','tenant_private_postgresql',
  'evaluatedAt',transaction_timestamp(),'nativeLabor',native_consent,'sources',source_rows,
  'sourceTotal',source_total,'sourcesTruncated',source_total>100,
  'learningBoundary','Learning remains advisory. NorthStar does not automatically change estimates, rates, schedules, payroll, worker profiles or business policy.');
END $$;

REVOKE ALL ON FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
