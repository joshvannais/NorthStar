-- Mission 25 Part 10H correction: tenant-private, recognizable reconciliation labels.
-- Opaque target identities remain submission values and never become presentation text.

CREATE FUNCTION public.canonical_learning_target_label_text(value TEXT, maximum INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 WITH candidate AS (
  SELECT regexp_replace(btrim(value),'[[:space:]]+',' ','g') normalized
 ) SELECT CASE
  WHEN maximum NOT BETWEEN 1 AND 240 OR normalized='' OR normalized~'[[:cntrl:]]'
    OR normalized~*'object[[:space:]_-]*object'
    OR normalized~*'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    OR normalized~*'(^|[^0-9a-f])[0-9a-f]{32,}([^0-9a-f]|$)'
    OR normalized~'(^|[^0-9])([+]1[ .-]?)?[(]?[0-9]{3}[)]?[ .-][0-9]{3}[ .-][0-9]{4}([^0-9]|$)'
    OR normalized~'(^|[^0-9])[0-9]{10,15}([^0-9]|$)'
    OR normalized~*'(digest|checksum|hash)[[:space:]:=_-]+[[:alnum:]/+_-]{16,}'
    OR normalized~*'(request|record|database)[[:space:]_-]*(id|identifier)[[:space:]:=#_-]+[[:alnum:]._:-]{6,}'
    OR normalized LIKE '%@%' OR char_length(normalized)>maximum THEN NULL
  ELSE normalized
 END FROM candidate
$$;

CREATE FUNCTION public.canonical_learning_target_label_compose(prefix_value TEXT,discriminator_value TEXT,maximum INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH parts AS (
  SELECT NULLIF(btrim(prefix_value),'') prefix_label,NULLIF(btrim(discriminator_value),'') discriminator_label
 ), bounded AS (
  SELECT prefix_label,discriminator_label,
   CASE WHEN discriminator_label IS NULL THEN NULL ELSE right(discriminator_label,LEAST(char_length(discriminator_label),96)) END discriminator_tail
  FROM parts
 ) SELECT CASE
  WHEN maximum NOT BETWEEN 1 AND 240 OR prefix_label IS NULL THEN NULL
  WHEN discriminator_label IS NULL THEN left(prefix_label,maximum)
  WHEN char_length(prefix_label)+3+char_length(discriminator_label)<=maximum THEN prefix_label||' · '||discriminator_label
  WHEN maximum<=3+char_length(discriminator_tail) THEN NULL
  ELSE rtrim(left(prefix_label,maximum-3-char_length(discriminator_tail)))||' · '||discriminator_tail
 END FROM bounded
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
   public.canonical_learning_target_label_text(u.name,220) display_name,
   public.canonical_learning_target_label_text(initcap(replace(p.operational_role,'_',' ')),64) role_label,
   public.canonical_learning_target_label_text(p.home_location_id,240) location_label
  FROM public.workforce_profiles p
  JOIN public.organization_memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id
  JOIN public.users u ON u.organization_id=m.organization_id AND u.id=m.user_id
  WHERE p.organization_id=org AND m.status='active'
 ), based AS (
  SELECT *,display_name||' · '||role_label base_source,
   public.canonical_learning_target_label_compose(display_name||' · '||role_label,NULL,240) base_label
  FROM raw WHERE display_name IS NOT NULL AND role_label IS NOT NULL
 ), counted AS (
  SELECT *,count(*) OVER(PARTITION BY lower(base_label)) base_total FROM based WHERE base_label IS NOT NULL
 ), candidates AS (
  SELECT *,CASE WHEN base_total=1 THEN base_label WHEN location_label IS NOT NULL THEN
   public.canonical_learning_target_label_compose(base_source,location_label,240) END display_label FROM counted
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
   public.canonical_learning_target_label_text(c.name,220) customer_label,
   public.canonical_learning_target_label_text(o.service_type,180) service_label,
   public.canonical_learning_target_label_text(o.job_scope->>'jobTitle',220) job_label
  FROM public.canonical_estimates e
  JOIN public.canonical_opportunities o ON o.organization_id=e.organization_id AND o.id=e.opportunity_id
  JOIN public.canonical_customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id
  WHERE e.organization_id=org
 ), based AS (
  SELECT *,concat_ws(' · ',customer_label,COALESCE(service_label,job_label),
    CASE WHEN job_label IS NOT NULL AND lower(job_label) IS DISTINCT FROM lower(service_label) THEN job_label END) base_source
  FROM raw WHERE customer_label IS NOT NULL AND COALESCE(service_label,job_label) IS NOT NULL
 ), rendered AS (
  SELECT *,public.canonical_learning_target_label_compose(base_source,NULL,240) base_label FROM based
 ), counted AS (
  SELECT *,count(*) OVER(PARTITION BY lower(base_label)) base_total FROM rendered WHERE base_label IS NOT NULL
 ), candidates AS (
  SELECT *,CASE WHEN base_total=1 THEN base_label ELSE
   public.canonical_learning_target_label_compose(base_source,
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
   public.canonical_learning_target_label_text(a.name,220) name_label,
   public.canonical_learning_target_label_text(concat_ws(' ',NULLIF(btrim(a.manufacturer),''),NULLIF(btrim(a.model),'')),180) specification_label,
   public.canonical_learning_target_label_text(a.internal_reference,240) reference_label,
   a.model_year
  FROM public.tenant_assets a
  JOIN public.canonical_equipment_asset_versions v
   ON v.organization_id=a.organization_id AND v.asset_id=a.id AND v.asset_version=a.version
  WHERE a.organization_id=org AND a.category IN ('vehicle','equipment') AND a.catalogue_state='active'
   AND v.review_state='reviewed' AND v.asset_digest=public.equipment_digest(to_jsonb(a))
 ), based AS (
  SELECT *,concat_ws(' · ',name_label,specification_label) base_source
  FROM raw WHERE name_label IS NOT NULL
 ), rendered AS (
  SELECT *,public.canonical_learning_target_label_compose(base_source,NULL,240) base_label FROM based
 ), counted AS (
  SELECT *,count(*) OVER(PARTITION BY category,lower(base_label)) base_total FROM rendered WHERE base_label IS NOT NULL
 ), candidates AS (
  SELECT *,CASE WHEN base_total=1 THEN base_label WHEN reference_label IS NOT NULL
   THEN public.canonical_learning_target_label_compose(base_source,concat_ws(' · ',reference_label,model_year::text),240) END display_label FROM counted
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
REVOKE ALL ON FUNCTION public.canonical_learning_target_label_compose(TEXT,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_learning_reconciliation_target_labels_read(UUID,UUID,TEXT,UUID) FROM PUBLIC;
