-- Mission 25 Part 10H correction: tenant-private, recognizable reconciliation labels.
-- Opaque target identities remain submission values and never become presentation text.

CREATE FUNCTION public.canonical_learning_target_label_text(value TEXT, maximum INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE
  WHEN maximum NOT BETWEEN 1 AND 240 THEN NULL
  WHEN btrim(value)='' OR value~'[[:cntrl:]]' OR lower(value)='[object object]'
    OR value~*'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    OR value LIKE '%@%' OR btrim(value)~'^[+()0-9 .-]{7,}$' THEN NULL
  ELSE left(regexp_replace(btrim(value),'[[:space:]]+',' ','g'),maximum)
 END
$$;

CREATE FUNCTION public.canonical_learning_reconciliation_target_labels_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE worker_rows JSONB;job_rows JSONB;vehicle_rows JSONB;equipment_rows JSONB;
 worker_unavailable BIGINT;job_unavailable BIGINT;vehicle_unavailable BIGINT;equipment_unavailable BIGINT;
BEGIN
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Learning reconciliation labels are restricted' USING ERRCODE='42501';
 END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);

 WITH raw AS (
  SELECT p.id target_id,
   public.canonical_learning_target_label_text(u.name,120) display_name,
   public.canonical_learning_target_label_text(initcap(replace(p.operational_role,'_',' ')),64) role_label,
   public.canonical_learning_target_label_text(p.home_location_id,64) location_label
  FROM public.workforce_profiles p
  JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
  JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
  WHERE p.organization_id=org AND m.status='active'
 ), based AS (
  SELECT *,left(display_name||' · '||role_label,210) base_label,
   count(*) OVER(PARTITION BY lower(display_name),lower(role_label)) base_total
  FROM raw WHERE display_name IS NOT NULL AND role_label IS NOT NULL
 ), candidates AS (
  SELECT *,CASE WHEN base_total=1 THEN base_label WHEN location_label IS NOT NULL
   THEN left(base_label||' · '||location_label,240) END display_label FROM based
 ), visible AS (
  SELECT *,count(*) OVER(PARTITION BY lower(display_label)) label_total FROM candidates WHERE display_label IS NOT NULL
 ), selected AS (
  SELECT * FROM visible WHERE label_total=1 ORDER BY lower(display_label),target_id LIMIT 100
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId',target_id,'displayLabel',display_label)
    ORDER BY lower(display_label),target_id),'[]'::jsonb),
   (SELECT count(*) FROM raw)-(SELECT count(*) FROM selected)
 INTO worker_rows,worker_unavailable FROM selected;

 WITH raw AS (
  SELECT e.id target_id,e.created_at,
   public.canonical_learning_target_label_text(c.name,120) customer_label,
   public.canonical_learning_target_label_text(o.service_type,100) service_label,
   public.canonical_learning_target_label_text(o.job_scope->>'jobTitle',120) job_label
  FROM public.canonical_estimates e
  JOIN public.canonical_opportunities o ON o.organization_id=e.organization_id AND o.id=e.opportunity_id
  JOIN public.canonical_customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id
  WHERE e.organization_id=org
 ), based AS (
  SELECT *,left(concat_ws(' · ',customer_label,COALESCE(service_label,job_label),
    CASE WHEN job_label IS NOT NULL AND lower(job_label) IS DISTINCT FROM lower(service_label) THEN job_label END),210) base_label
  FROM raw WHERE customer_label IS NOT NULL AND COALESCE(service_label,job_label) IS NOT NULL
 ), counted AS (
  SELECT *,count(*) OVER(PARTITION BY lower(base_label)) base_total FROM based
 ), candidates AS (
  SELECT *,CASE WHEN base_total=1 THEN base_label ELSE left(base_label||' · '||
   to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI "UTC"'),240) END display_label FROM counted
 ), visible AS (
  SELECT *,count(*) OVER(PARTITION BY lower(display_label)) label_total FROM candidates
 ), selected AS (
  SELECT * FROM visible WHERE label_total=1 ORDER BY created_at DESC,target_id DESC LIMIT 100
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('targetId',target_id,'displayLabel',display_label)
    ORDER BY created_at DESC,target_id DESC),'[]'::jsonb),
   (SELECT count(*) FROM raw)-(SELECT count(*) FROM selected)
 INTO job_rows,job_unavailable FROM selected;

 WITH raw AS (
  SELECT a.id target_id,a.category,
   public.canonical_learning_target_label_text(a.name,120) name_label,
   public.canonical_learning_target_label_text(concat_ws(' ',NULLIF(btrim(a.manufacturer),''),NULLIF(btrim(a.model),'')),120) specification_label,
   public.canonical_learning_target_label_text(a.internal_reference,80) reference_label,
   a.model_year
  FROM public.tenant_assets a
  JOIN public.canonical_equipment_asset_versions v
   ON v.organization_id=a.organization_id AND v.asset_id=a.id AND v.asset_version=a.version
  WHERE a.organization_id=org AND a.category IN ('vehicle','equipment') AND a.catalogue_state='active'
   AND v.review_state='reviewed' AND v.asset_digest=public.equipment_digest(to_jsonb(a))
 ), based AS (
  SELECT *,left(concat_ws(' · ',name_label,specification_label),190) base_label
  FROM raw WHERE name_label IS NOT NULL
 ), counted AS (
  SELECT *,count(*) OVER(PARTITION BY category,lower(base_label)) base_total FROM based
 ), candidates AS (
  SELECT *,CASE WHEN base_total=1 THEN base_label WHEN reference_label IS NOT NULL
   THEN left(concat_ws(' · ',base_label,reference_label,model_year::text),240) END display_label FROM counted
 ), visible AS (
  SELECT *,count(*) OVER(PARTITION BY category,lower(display_label)) label_total FROM candidates WHERE display_label IS NOT NULL
 ), selected AS (
  SELECT * FROM visible WHERE label_total=1 ORDER BY category,lower(display_label),target_id LIMIT 200
 ) SELECT
   COALESCE(jsonb_agg(jsonb_build_object('targetId',target_id,'displayLabel',display_label)
    ORDER BY lower(display_label),target_id) FILTER(WHERE category='vehicle'),'[]'::jsonb),
   COALESCE(jsonb_agg(jsonb_build_object('targetId',target_id,'displayLabel',display_label)
    ORDER BY lower(display_label),target_id) FILTER(WHERE category='equipment'),'[]'::jsonb),
   (SELECT count(*) FROM raw WHERE category='vehicle')-(SELECT count(*) FROM selected WHERE category='vehicle'),
   (SELECT count(*) FROM raw WHERE category='equipment')-(SELECT count(*) FROM selected WHERE category='equipment')
 INTO vehicle_rows,equipment_rows,vehicle_unavailable,equipment_unavailable FROM selected;

 RETURN jsonb_build_object('workerTargets',worker_rows,'workerUnavailableTotal',worker_unavailable,
  'jobTargets',job_rows,'jobUnavailableTotal',job_unavailable,
  'vehicleTargets',vehicle_rows,'vehicleUnavailableTotal',vehicle_unavailable,
  'equipmentTargets',equipment_rows,'equipmentUnavailableTotal',equipment_unavailable,
  'presentationBoundary','Only bounded company labels are shown. Opaque target identities remain submission values. Ambiguous targets require clearer company data.');
END $$;

REVOKE ALL ON FUNCTION public.canonical_learning_target_label_text(TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_reconciliation_target_labels_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
