-- Mission 26 Part 4D: safe read-only prerequisite projection for the paid
-- demand research workspace. This does not create consent, epochs, reviews,
-- origins, evaluations, forecasts or commercial actions.

CREATE FUNCTION public.canonical_forecast_demand_ui_prerequisites_v1_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;anchor_id UUID;anchor_state TEXT:='unavailable';
 seasonal_method public.canonical_forecast_demand_schedule_methods_v1%ROWTYPE;
 pipeline_method public.canonical_forecast_demand_schedule_methods_v1%ROWTYPE;
 seasonal_review public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;
 pipeline_review public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;
 seasonal_epoch public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 pipeline_epoch public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 seasonal_epoch_state TEXT:='missing';pipeline_epoch_state TEXT:='missing';
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Demand research prerequisite read restricted' USING ERRCODE='42501';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);

 -- Keep the same deterministic fence order as the owning writers. A final
 -- access check follows every potentially blocking fence and table lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-method:'||org||':seasonal_inbound',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-method:'||org||':pipeline_first_booking',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-epoch:'||org||':seasonal_inbound',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-epoch:'||org||':pipeline_first_booking',0));
 LOCK TABLE public.canonical_forecast_profile_effective_anchors,
  public.canonical_forecast_profile_effective_activations,
  public.canonical_forecast_profile_change_events,
  public.canonical_business_profiles,
  public.canonical_forecast_demand_schedule_methods_v1,
  public.canonical_forecast_demand_schedule_method_reviews_v1,
  public.canonical_forecast_demand_schedule_epochs_v1 IN SHARE MODE;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);

 SELECT anchor.id INTO anchor_id
 FROM public.canonical_forecast_profile_effective_anchors anchor
 JOIN public.canonical_forecast_profile_effective_activations activation
  ON activation.organization_id=anchor.organization_id AND activation.anchor_id=anchor.id
 JOIN public.canonical_business_profiles profile
  ON profile.organization_id=anchor.organization_id
  AND profile.id=anchor.business_profile_id AND profile.is_active
 WHERE anchor.organization_id=org
  AND profile.version_number=anchor.business_profile_version
  AND profile.normalized_profile_hash=anchor.business_profile_hash
  AND public.canonical_completion_digest(profile.raw_profile)=anchor.raw_profile_digest
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events event
   WHERE event.organization_id=org AND event.source_order>anchor.source_order)
 ORDER BY anchor.source_order DESC,activation.observed_at DESC LIMIT 1;
 IF anchor_id IS NOT NULL THEN anchor_state:='current';END IF;

 SELECT * INTO seasonal_method FROM public.canonical_forecast_demand_schedule_methods_v1
  WHERE purpose='seasonal_inbound';
 SELECT * INTO pipeline_method FROM public.canonical_forecast_demand_schedule_methods_v1
  WHERE purpose='pipeline_first_booking';
 SELECT * INTO seasonal_review FROM public.canonical_forecast_demand_schedule_method_reviews_v1
  WHERE organization_id=org AND purpose='seasonal_inbound' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO pipeline_review FROM public.canonical_forecast_demand_schedule_method_reviews_v1
  WHERE organization_id=org AND purpose='pipeline_first_booking' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO seasonal_epoch FROM public.canonical_forecast_demand_schedule_epochs_v1
  WHERE organization_id=org AND purpose='seasonal_inbound' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO pipeline_epoch FROM public.canonical_forecast_demand_schedule_epochs_v1
  WHERE organization_id=org AND purpose='pipeline_first_booking' ORDER BY revision DESC LIMIT 1;
 IF seasonal_epoch.id IS NOT NULL THEN seasonal_epoch_state:=CASE WHEN
  public.canonical_forecast_demand_schedule_epoch_current_v1(org,seasonal_epoch)
  THEN 'current' ELSE 'stale' END;END IF;
 IF pipeline_epoch.id IS NOT NULL THEN pipeline_epoch_state:=CASE WHEN
  public.canonical_forecast_demand_schedule_epoch_current_v1(org,pipeline_epoch)
  THEN 'current' ELSE 'stale' END;END IF;
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);

 RETURN jsonb_build_object(
  'state','demand_ui_prerequisites_current',
  'profile',jsonb_build_object('state',anchor_state,'anchorId',anchor_id),
  'seasonal',jsonb_build_object(
   'purpose','seasonal_inbound','targetKey',seasonal_method.target_key,
   'targetVersion',seasonal_method.target_version,
   'calculationVersion',seasonal_method.calculation_version,
   'method',jsonb_build_object(
    'expectedRevision',COALESCE(seasonal_review.revision,0),
    'expectedDigest',COALESCE(rtrim(seasonal_review.review_digest),'none'),
    'action',seasonal_review.action,
    'approved',COALESCE(seasonal_review.action='approve',FALSE)),
   'epoch',jsonb_build_object('state',seasonal_epoch_state,'id',seasonal_epoch.id,
    'revision',seasonal_epoch.revision,'installedAt',CASE WHEN seasonal_epoch.id IS NULL
      THEN NULL ELSE public.canonical_forecast_utc_instant(seasonal_epoch.installed_at) END)),
  'pipeline',jsonb_build_object(
   'purpose','pipeline_first_booking','targetKey',pipeline_method.target_key,
   'targetVersion',pipeline_method.target_version,
   'calculationVersion',pipeline_method.calculation_version,
   'method',jsonb_build_object(
    'expectedRevision',COALESCE(pipeline_review.revision,0),
    'expectedDigest',COALESCE(rtrim(pipeline_review.review_digest),'none'),
    'action',pipeline_review.action,
    'approved',COALESCE(pipeline_review.action='approve',FALSE)),
   'epoch',jsonb_build_object('state',pipeline_epoch_state,'id',pipeline_epoch.id,
    'revision',pipeline_epoch.revision,'installedAt',CASE WHEN pipeline_epoch.id IS NULL
      THEN NULL ELSE public.canonical_forecast_utc_instant(pipeline_epoch.installed_at) END)),
  'researchOnly',TRUE,'automaticActionTaken',FALSE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_demand_ui_prerequisites_v1_read(
 UUID,UUID,TEXT,UUID) FROM PUBLIC;

DO $$DECLARE runtime_role TEXT:=current_setting('app.runtime_role',TRUE);BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' AND
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format(
   'GRANT EXECUTE ON FUNCTION public.canonical_forecast_demand_ui_prerequisites_v1_read(uuid,uuid,text,uuid) TO %I',
   runtime_role);
 END IF;
END $$;
