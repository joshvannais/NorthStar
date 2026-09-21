-- Mission 25 Part 11H: paid-tenant Learning Center inventory for labor, travel, asset and material sources.
-- The read model stays bounded, tenant private and advisory.

CREATE OR REPLACE FUNCTION public.canonical_learning_center_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_rows JSONB; source_total BIGINT; native_labor JSONB; native_equipment JSONB; native_material JSONB;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Learning Center is restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 native_labor:=public.canonical_learning_consent_read(org,actor,role_value,session_value);
 native_equipment:=public.canonical_equipment_learning_consent_read(org,actor,role_value,session_value);
 native_material:=public.canonical_material_learning_consent_read(org,actor,role_value,session_value);

 WITH source_keys AS (
  SELECT 'labor'::text source_kind,source_key FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_runs WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_records WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_reference_matches WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_calibration_consents WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_calibration_proposals WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_runs WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_records WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_reference_matches WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_import_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_import_runs WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_import_records WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_reference_matches WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_outcome_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_outcome_observations WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_health_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_health_observations WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_calibration_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_calibration_proposals WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_import_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_import_runs WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_import_records WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_reference_matches WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_outcome_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_quantity_observations WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_cost_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_cost_observations WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
 ) SELECT count(*) INTO source_total FROM source_keys;

 WITH source_keys AS (
  SELECT 'labor'::text source_kind,source_key FROM public.canonical_external_labor_import_consents WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_runs WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_records WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_reference_matches WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_learning_consents WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_import_outcome_observations WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_calibration_consents WHERE organization_id=org
  UNION SELECT 'labor',source_key FROM public.canonical_external_labor_calibration_proposals WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_consents WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_runs WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_records WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_reference_matches WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_import_learning_consents WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_outcome_observations WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_calibration_consents WHERE organization_id=org
  UNION SELECT 'travel',source_key FROM public.canonical_external_travel_calibration_proposals WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_import_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_import_runs WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_import_records WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_reference_matches WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_outcome_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_outcome_observations WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_health_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_health_observations WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_calibration_consents WHERE organization_id=org
  UNION SELECT 'asset',source_key FROM public.canonical_external_asset_calibration_proposals WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_import_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_import_runs WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_import_records WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_reference_matches WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_outcome_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_quantity_observations WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_cost_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_cost_observations WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_calibration_consents WHERE organization_id=org
  UNION SELECT 'material',source_key FROM public.canonical_external_material_calibration_proposals WHERE organization_id=org
 ), selected AS (
  SELECT source_kind,source_key FROM source_keys ORDER BY source_kind,source_key LIMIT 100
 ), service_keys AS (
  SELECT 'labor'::text source_kind,observation.source_key,lower(btrim(opportunity.service_type)) service_key
  FROM (SELECT DISTINCT ON (observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference) observation.*
    FROM public.canonical_external_labor_import_outcome_observations observation
    JOIN selected ON selected.source_kind='labor' AND selected.source_key=observation.source_key
    WHERE observation.organization_id=org
    ORDER BY observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference,
      observation.revision DESC,observation.id DESC) observation
  JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=observation.estimate_id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
  UNION SELECT 'labor',proposal.source_key,proposal.service_key
    FROM public.canonical_external_labor_calibration_proposals proposal
    JOIN selected ON selected.source_kind='labor' AND selected.source_key=proposal.source_key
    WHERE proposal.organization_id=org
  UNION SELECT 'travel',observation.source_key,lower(btrim(opportunity.service_type))
  FROM (SELECT DISTINCT ON (observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference) observation.*
    FROM public.canonical_external_travel_outcome_observations observation
    JOIN selected ON selected.source_kind='travel' AND selected.source_key=observation.source_key
    WHERE observation.organization_id=org
    ORDER BY observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference,
      observation.revision DESC,observation.id DESC) observation
  JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=observation.estimate_id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
  UNION SELECT 'travel',proposal.source_key,proposal.service_key
    FROM public.canonical_external_travel_calibration_proposals proposal
    JOIN selected ON selected.source_kind='travel' AND selected.source_key=proposal.source_key
    WHERE proposal.organization_id=org
  UNION SELECT 'asset',observation.source_key,lower(btrim(opportunity.service_type))
  FROM (SELECT DISTINCT ON (observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference) observation.*
    FROM public.canonical_external_asset_outcome_observations observation
    JOIN selected ON selected.source_kind='asset' AND selected.source_key=observation.source_key
    WHERE observation.organization_id=org
    ORDER BY observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference,
      observation.revision DESC,observation.id DESC) observation
  JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=observation.estimate_id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
  UNION SELECT 'asset',proposal.source_key,proposal.service_key
    FROM public.canonical_external_asset_calibration_proposals proposal
    JOIN selected ON selected.source_kind='asset' AND selected.source_key=proposal.source_key
    WHERE proposal.organization_id=org
  UNION SELECT 'material',observation.source_key,lower(btrim(opportunity.service_type))
  FROM (SELECT DISTINCT ON (observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference) observation.*
    FROM public.canonical_external_material_quantity_observations observation
    JOIN selected ON selected.source_kind='material' AND selected.source_key=observation.source_key
    WHERE observation.organization_id=org
    ORDER BY observation.organization_id,observation.source_key,observation.estimate_id,observation.external_job_reference,
      observation.revision DESC,observation.id DESC) observation
  JOIN public.canonical_estimates estimate ON estimate.organization_id=org AND estimate.id=observation.estimate_id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=org AND opportunity.id=estimate.opportunity_id
  UNION SELECT 'material',proposal.source_key,proposal.service_key
    FROM public.canonical_external_material_calibration_proposals proposal
    JOIN selected ON selected.source_kind='material' AND selected.source_key=proposal.source_key
    WHERE proposal.organization_id=org
 ), service_counts AS (
  SELECT source_kind,source_key,count(*) total
  FROM (SELECT DISTINCT source_kind,source_key,service_key FROM service_keys) value GROUP BY source_kind,source_key
 ), selected_services AS (
  SELECT source_kind,source_key,COALESCE(jsonb_agg(service_key ORDER BY service_key),'[]'::jsonb) services FROM (
   SELECT source_kind,source_key,service_key,row_number() OVER(PARTITION BY source_kind,source_key ORDER BY service_key) ordinal
   FROM (SELECT DISTINCT source_kind,source_key,service_key FROM service_keys) value
  ) limited WHERE ordinal<=50 GROUP BY source_kind,source_key
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceKind',selected.source_kind,'sourceKey',selected.source_key,
   'serviceKeys',COALESCE(selected_services.services,'[]'::jsonb),
   'serviceTotal',COALESCE(service_counts.total,0),
   'servicesTruncated',COALESCE(service_counts.total,0)>50)
   ORDER BY selected.source_kind,selected.source_key),'[]'::jsonb)
 INTO source_rows FROM selected
 LEFT JOIN service_counts USING(source_kind,source_key)
 LEFT JOIN selected_services USING(source_kind,source_key);

 RETURN jsonb_build_object('version','m25-learning-center-v4','authority','tenant_private_postgresql',
  'evaluatedAt',transaction_timestamp(),'nativeLabor',native_labor,'nativeEquipment',native_equipment,'nativeMaterial',native_material,'sources',source_rows,
  'sourceTotal',source_total,'sourcesTruncated',source_total>100,
  'learningBoundary','Learning remains advisory. NorthStar does not automatically change estimates, rates, material plans, inventory, purchases, vendor records, equipment plans, costs, maintenance plans, routes, schedules, payroll, worker, vehicle or equipment profiles, or business policy.');
END $$;

REVOKE ALL ON FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
