-- Mission 25 Part 13H: bounded service and current-summary discovery for completed-job review.
-- Opaque summary identities are submission values. Only safe company job labels are presentation text.

ALTER FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID)
 RENAME TO canonical_learning_center_part12_read;

CREATE FUNCTION public.canonical_learning_center_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base JSONB;service_rows JSONB;service_keys JSONB;service_total BIGINT;
BEGIN
 base:=public.canonical_learning_center_part12_read(org,actor,role_value,session_value);
 WITH current_graph_consent AS MATERIALIZED (
  SELECT * FROM public.canonical_job_outcome_graph_consents
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1
 ), latest AS MATERIALIZED (
  SELECT DISTINCT ON (saved.estimate_id)
   saved summary_record,saved.id,saved.estimate_id,lower(btrim(opportunity.service_type)) service_key,
   estimate.created_at estimate_created_at,
   public.canonical_learning_target_label_text(customer.name,180) customer_label,
   public.canonical_learning_target_label_text(opportunity.service_type,120) service_label,
   public.canonical_learning_target_label_text(opportunity.job_scope->>'jobTitle',180) job_label
  FROM public.canonical_job_outcome_summaries saved
  JOIN current_graph_consent consent ON consent.action='grant' AND consent.id=saved.consent_id
  JOIN public.canonical_estimates estimate ON estimate.organization_id=saved.organization_id AND estimate.id=saved.estimate_id
  JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=estimate.organization_id AND opportunity.id=estimate.opportunity_id
  JOIN public.canonical_customers customer ON customer.organization_id=opportunity.organization_id AND customer.id=opportunity.customer_id
  WHERE saved.organization_id=org
  ORDER BY saved.estimate_id,saved.revision DESC,saved.id DESC
 ), projected AS MATERIALIZED (
  SELECT latest.*,public.canonical_job_outcome_summary_projection(latest.summary_record,actor,role_value,session_value) projection
  FROM latest WHERE service_key~'^[a-z0-9][a-z0-9._-]{1,63}$'
 ), eligible AS MATERIALIZED (
  SELECT *,concat_ws(' · ',customer_label,COALESCE(service_label,job_label),
   CASE WHEN job_label IS NOT NULL AND lower(job_label) IS DISTINCT FROM lower(service_label) THEN job_label END) base_source
  FROM projected
  WHERE projection->'fresh'='true'::jsonb AND projection->'summary' IS NOT NULL
   AND customer_label IS NOT NULL AND COALESCE(service_label,job_label) IS NOT NULL
 ), rendered AS MATERIALIZED (
  SELECT *,public.canonical_learning_target_label_compose(base_source,NULL,240) base_label FROM eligible
 ), counted AS MATERIALIZED (
  SELECT *,count(*) OVER(PARTITION BY service_key,base_label) base_total FROM rendered WHERE base_label IS NOT NULL
 ), candidates AS MATERIALIZED (
  SELECT *,CASE WHEN base_total=1 THEN base_label ELSE public.canonical_learning_target_label_compose(
   base_source,to_char(estimate_created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI "UTC"'),240) END display_label
  FROM counted
 ), visible AS MATERIALIZED (
  SELECT *,count(*) OVER(PARTITION BY service_key,display_label) label_total FROM candidates WHERE display_label IS NOT NULL
 ), selectable AS MATERIALIZED (
  SELECT * FROM visible WHERE label_total=1
 ), all_services AS MATERIALIZED (
  SELECT service_key FROM eligible
  UNION SELECT service_key FROM public.canonical_job_outcome_cross_job_proposals WHERE organization_id=org
  UNION SELECT service_key FROM public.canonical_job_outcome_proposal_registry_versions WHERE organization_id=org
  UNION SELECT service_key FROM public.canonical_job_outcome_planning_value_versions WHERE organization_id=org
 ), valid_services AS MATERIALIZED (
  SELECT DISTINCT service_key FROM all_services WHERE service_key~'^[a-z0-9][a-z0-9._-]{1,63}$'
 ), bounded_services AS MATERIALIZED (
  SELECT service_key FROM valid_services ORDER BY service_key LIMIT 50
 ), payload AS (
  SELECT service.service_key,
   (SELECT count(*) FROM eligible item WHERE item.service_key=service.service_key) eligible_total,
   (SELECT count(*) FROM selectable item WHERE item.service_key=service.service_key) selectable_total,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('summaryId',item.id,'displayLabel',item.display_label)
    ORDER BY item.estimate_created_at DESC,item.id DESC)
    FROM (SELECT * FROM selectable current_item WHERE current_item.service_key=service.service_key
      ORDER BY current_item.estimate_created_at DESC,current_item.id DESC LIMIT 100) item),'[]'::jsonb) summaries
  FROM bounded_services service
 )
 SELECT (SELECT count(*) FROM valid_services),
  COALESCE(jsonb_agg(jsonb_build_object(
   'serviceKey',service_key,'eligibleSummaryTotal',eligible_total,'selectableSummaryTotal',selectable_total,
   'ambiguousSummaryTotal',eligible_total-selectable_total,'summaries',summaries,
   'summariesTruncated',selectable_total>100)
   ORDER BY service_key),'[]'::jsonb),
  COALESCE(jsonb_agg(to_jsonb(service_key) ORDER BY service_key),'[]'::jsonb)
 INTO service_total,service_rows,service_keys FROM payload;
 RETURN (base-'version')||jsonb_build_object(
  'version','m25-learning-center-v6','outcomeServiceKeys',service_keys,
  'outcomeServiceTotal',service_total,'outcomeServicesTruncated',service_total>50,
  'outcomeServices',service_rows);
END $$;

REVOKE ALL ON FUNCTION public.canonical_learning_center_part12_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON FUNCTION public.canonical_learning_center_part12_read(UUID,UUID,TEXT,UUID) FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF;END $$;
