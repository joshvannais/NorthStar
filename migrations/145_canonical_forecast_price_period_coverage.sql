-- Mission 26 Part 6A: source-owned start of provisional NorthStar-approved-price
-- ledger observation. This is not a source-completeness or forecast proof.
CREATE TABLE public.canonical_forecast_price_period_anchors (
 organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
 first_snapshot_id UUID NOT NULL,
 coverage_starts_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(organization_id,first_snapshot_id)
  REFERENCES public.canonical_forecast_price_event_snapshots(organization_id,id) ON DELETE RESTRICT,
 CHECK(coverage_starts_at=created_at)
);

CREATE FUNCTION public.canonical_forecast_price_period_anchor_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast price-period anchors are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_price_period_anchor_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_period_anchors
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_period_anchor_immutable();

CREATE FUNCTION public.canonical_forecast_price_period_anchor_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The parent snapshot insert already enforces serializable, current paid
 -- owner/admin session and CSRF authority. The first post-release capture
 -- wins; old snapshots are deliberately not backfilled.
 INSERT INTO public.canonical_forecast_price_period_anchors(
  organization_id,first_snapshot_id,coverage_starts_at,created_at)
 VALUES(NEW.organization_id,NEW.id,NEW.as_of,NEW.as_of)
 ON CONFLICT(organization_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_price_period_anchor_capture
 AFTER INSERT ON public.canonical_forecast_price_event_snapshots
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_price_period_anchor_capture();

CREATE FUNCTION public.canonical_forecast_price_period_anchor_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,snapshot_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved JSONB;anchor public.canonical_forecast_price_period_anchors%ROWTYPE;
BEGIN
 saved:=public.canonical_forecast_price_event_snapshot_read(
  org,actor,role_value,session_value,snapshot_value);
 IF saved IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO anchor FROM public.canonical_forecast_price_period_anchors
  WHERE organization_id=org AND coverage_starts_at<=(saved->>'asOf')::timestamptz;
 IF anchor.organization_id IS NULL THEN
  RETURN jsonb_build_object('state','unavailable','reason','period_before_source_anchor',
   'snapshotId',snapshot_value,'sourceSnapshotDigest',saved->>'sourceSnapshotDigest',
   'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','source_period_anchor',
  'scope','northstar_m24_approved_price_decisions',
  'coverageStartsAt',public.canonical_forecast_utc_instant(anchor.coverage_starts_at),
  'firstSnapshotId',anchor.first_snapshot_id,
  'snapshotId',snapshot_value,'sourceSnapshotDigest',saved->>'sourceSnapshotDigest',
  'wholeBusinessCoverageVerified',FALSE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_price_period_anchors FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_period_anchor_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_period_anchor_capture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_period_anchor_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_price_period_anchor_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
