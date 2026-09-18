-- Mission 25 Part 13H: bounded service discovery for the owner-facing completed-job review.
-- This projection lists service labels only. It does not expose graph identifiers or change planning values.

ALTER FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID)
 RENAME TO canonical_learning_center_part12_read;

CREATE FUNCTION public.canonical_learning_center_read(org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base JSONB; service_rows JSONB; service_total BIGINT;
BEGIN
 base:=public.canonical_learning_center_part12_read(org,actor,role_value,session_value);
 WITH services AS (
  SELECT service_key FROM public.canonical_job_outcome_cross_job_proposals WHERE organization_id=org
  UNION SELECT service_key FROM public.canonical_job_outcome_proposal_registry_versions WHERE organization_id=org
  UNION SELECT service_key FROM public.canonical_job_outcome_planning_value_versions WHERE organization_id=org
 ), valid AS (
  SELECT DISTINCT service_key FROM services WHERE service_key~'^[a-z0-9][a-z0-9._-]{1,63}$'
 )
 SELECT count(*),COALESCE((SELECT jsonb_agg(service_key ORDER BY service_key) FROM (SELECT service_key FROM valid ORDER BY service_key LIMIT 50) bounded),'[]'::jsonb)
 INTO service_total,service_rows FROM valid;
 RETURN (base-'version')||jsonb_build_object('version','m25-learning-center-v6','outcomeServiceKeys',service_rows,'outcomeServiceTotal',service_total,'outcomeServicesTruncated',service_total>50);
END $$;

REVOKE ALL ON FUNCTION public.canonical_learning_center_part12_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON FUNCTION public.canonical_learning_center_part12_read(UUID,UUID,TEXT,UUID) FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_learning_center_read(UUID,UUID,TEXT,UUID) TO northstar_app_runtime;
END IF;END $$;
