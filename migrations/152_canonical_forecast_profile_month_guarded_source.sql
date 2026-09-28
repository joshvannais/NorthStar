-- Mission 26 Parts 2B/6A: a locked, tenant-authorized read of an owner-reviewed
-- local-month profile claim for use alongside the ordered price source.
-- This is testimony about historical applicability, not calendar verification.

CREATE FUNCTION public.canonical_forecast_profile_month_guarded_source(
 org UUID,actor UUID,role_value TEXT,session_value UUID,month_value DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_profile_month_attestations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast calendar access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF month_value IS NULL OR month_value<DATE '2000-01-01' OR
    month_value>=DATE '2100-12-01' OR extract(day FROM month_value)<>1 THEN
  RAISE EXCEPTION 'Forecast calendar request invalid' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-month:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Forecast calendar busy' USING ERRCODE='55P03';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO selected FROM public.canonical_forecast_profile_month_attestations
  WHERE organization_id=org AND local_start_date=month_value
  ORDER BY revision DESC LIMIT 1;
 IF selected.id IS NULL THEN
  RETURN jsonb_build_object('state','no_reviewed_claim');END IF;
 IF selected.action='revoke' THEN
  RETURN jsonb_build_object('state','claim_revoked');END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=selected.business_profile_id FOR SHARE;
 IF profile_row.id IS NULL OR
    profile_row.version_number<>selected.business_profile_version OR
    rtrim(profile_row.normalized_profile_hash)<>rtrim(selected.business_profile_hash) OR
    public.canonical_completion_digest(profile_row.raw_profile)<>
      rtrim(selected.raw_profile_digest) THEN
  RETURN jsonb_build_object('state','profile_changed');END IF;
 RETURN jsonb_build_object('state','owner_claim_only',
  'attestationId',selected.id,'attestationRevision',selected.revision,
  'attestationDigest',rtrim(selected.digest),
  'attestationRecordedAt',public.canonical_forecast_utc_instant(selected.recorded_at),
  'businessProfileId',profile_row.id,
  'businessProfileVersion',profile_row.version_number,
  'businessProfileHash',rtrim(profile_row.normalized_profile_hash),
  'businessProfileLabel',profile_row.version_label,
  'rawProfile',profile_row.raw_profile);
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_profile_month_guarded_source(
 UUID,UUID,TEXT,UUID,DATE) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_profile_month_guarded_source(
  UUID,UUID,TEXT,UUID,DATE) TO northstar_app_runtime;
END IF;END $$;
