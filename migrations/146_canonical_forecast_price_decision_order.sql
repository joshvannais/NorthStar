-- Mission 26 source-order prerequisite for NorthStar-approved price history.
-- Existing Mission 24 decisions remain immutable and unsequenced. This sidecar
-- assigns an order only to decisions inserted after this trigger is installed.
-- An order is not a forecast or proof of off-platform business coverage.

CREATE SEQUENCE public.canonical_forecast_price_decision_order_sequence AS BIGINT;

CREATE TABLE public.canonical_forecast_price_decision_orders (
 organization_id UUID NOT NULL,
 estimate_id UUID NOT NULL,
 decision_id UUID NOT NULL,
 source_order BIGINT NOT NULL CHECK(source_order>0),
 ordered_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,decision_id),
 UNIQUE(organization_id,source_order),
 FOREIGN KEY(organization_id,estimate_id,decision_id)
  REFERENCES public.canonical_estimate_decisions(organization_id,estimate_id,id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_price_decision_orders_tenant_order_idx
 ON public.canonical_forecast_price_decision_orders(organization_id,source_order DESC);

CREATE FUNCTION public.canonical_forecast_price_decision_order_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast price-decision order is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_price_decision_order_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_price_decision_orders
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_price_decision_order_immutable();

CREATE FUNCTION public.canonical_forecast_price_decision_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The transaction-scoped tenant lock is held through the Mission 24 writer's
 -- commit. A later same-tenant insert cannot receive an order first; another
 -- tenant does not wait on this tenant's lock. Sequence gaps after rollback
 -- are intentional and must never be interpreted as missing decisions.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||NEW.organization_id::text,0));
 INSERT INTO public.canonical_forecast_price_decision_orders(
  organization_id,estimate_id,decision_id,source_order,ordered_at)
 VALUES(NEW.organization_id,NEW.estimate_id,NEW.id,
  nextval('public.canonical_forecast_price_decision_order_sequence'),clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_price_decision_order_insert
 AFTER INSERT ON public.canonical_estimate_decisions
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_price_decision_order_insert();

REVOKE ALL ON SEQUENCE public.canonical_forecast_price_decision_order_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_price_decision_orders FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_decision_order_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_price_decision_order_insert() FROM PUBLIC;
