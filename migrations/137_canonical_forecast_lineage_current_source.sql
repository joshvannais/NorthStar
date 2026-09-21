-- Mission 26 Part 2D. A guarded, read-only current-source comparison input for
-- the first approved-estimate decision source. Historical receipts stay immutable.

CREATE FUNCTION public.canonical_forecast_estimate_decision_lineage_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved JSONB;cutoff TIMESTAMPTZ;pins JSONB;current_manifest JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
 -- Reuse Part 2A's current owner/admin, session, membership, onboarding,
 -- subscription, tenant and snapshot guards. No saved receipt bypasses them.
 saved:=public.canonical_forecast_source_snapshot_read(
   org,actor,role_value,session_value,snapshot_value);
 IF saved IS NULL THEN RETURN NULL;END IF;

 -- The authority read established this statement's MVCC visibility before
 -- minting the new cutoff. A concurrent later commit cannot leak into an
 -- earlier historical knowledge boundary.
 cutoff:=clock_timestamp();
 pins:=public.canonical_forecast_estimate_decision_pins(org,cutoff);
 IF jsonb_array_length(pins)>1000 OR octet_length(pins::text)>262144 THEN
  RAISE EXCEPTION 'Forecast source cohort exceeds bounded comparison size'
   USING ERRCODE='54000';
 END IF;
 current_manifest:=jsonb_build_object(
   'version','m26-as-of-source-manifest-v1',
   'organizationId',org,
   'asOf',public.canonical_forecast_utc_instant(cutoff),
   'capturedAt',public.canonical_forecast_utc_instant(cutoff),
   'purposeKey','forecast_pipeline',
   'targetKey','pipeline.approved_estimates',
   'sources',pins);
 RETURN jsonb_build_object(
   'captured',jsonb_build_object(
     'digest',saved->>'sourceSnapshotDigest',
     'manifest',jsonb_build_object(
       'version',saved->>'version',
       'organizationId',saved->>'organizationId',
       'asOf',saved->>'asOf','capturedAt',saved->>'capturedAt',
       'purposeKey',saved->>'purposeKey','targetKey',saved->>'targetKey',
       'sources',saved->'sources')),
   'current',jsonb_build_object(
     'digest',public.canonical_completion_digest(
       current_manifest-'capturedAt'),
     'manifest',current_manifest));
END $$;

REVOKE ALL ON FUNCTION public.canonical_forecast_estimate_decision_lineage_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_estimate_decision_lineage_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
