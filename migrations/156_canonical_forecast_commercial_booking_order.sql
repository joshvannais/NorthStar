-- Mission 26 Part 6A: one tenant-local commit order for newly observed
-- scheduling approvals and customer estimate responses. No historic backfill.
-- Customer acceptance is evidence of a particular issued estimate version;
-- it is not, by itself, proof of booked work or earned revenue.

CREATE SEQUENCE public.canonical_forecast_commercial_booking_order_sequence AS BIGINT;

CREATE TABLE public.canonical_forecast_commercial_booking_orders (
 organization_id UUID NOT NULL,
 source_order BIGINT NOT NULL CHECK(source_order>0),
 source_kind TEXT NOT NULL CHECK(source_kind IN
  ('schedule_approval','customer_estimate_acceptance','customer_estimate_link_revocation')),
 approval_id UUID,
 delivery_event_id UUID,
 observed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,source_order),
 UNIQUE(organization_id,approval_id),
 UNIQUE(organization_id,delivery_event_id),
 CHECK((source_kind='schedule_approval' AND approval_id IS NOT NULL AND delivery_event_id IS NULL)
    OR (source_kind<>'schedule_approval' AND approval_id IS NULL AND delivery_event_id IS NOT NULL)),
 FOREIGN KEY(organization_id,approval_id)
  REFERENCES public.canonical_schedule_human_approvals(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(delivery_event_id)
  REFERENCES public.canonical_customer_estimate_delivery_events(id) ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_commercial_booking_orders_tenant_recent
 ON public.canonical_forecast_commercial_booking_orders(organization_id,source_order DESC);

CREATE FUNCTION public.canonical_forecast_commercial_booking_order_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast commercial booking order is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_commercial_booking_orders_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_commercial_booking_orders
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_commercial_booking_order_immutable();

-- Both source writers take this same tenant lock before assigning an order.
-- The lock lasts through commit; a rolled-back sequence number is not a
-- missing event. Existing Mission 22 order/receipt locks remain intact.
CREATE OR REPLACE FUNCTION public.canonical_forecast_booking_approval_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||NEW.organization_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:booking-approval-order:'||NEW.organization_id::text,0));
 INSERT INTO public.canonical_forecast_booking_approval_orders(
  organization_id,appointment_id,approval_id,source_order,observed_at)
 VALUES(NEW.organization_id,NEW.appointment_id,NEW.id,
  nextval('public.canonical_forecast_booking_approval_order_sequence'),clock_timestamp());
 INSERT INTO public.canonical_forecast_commercial_booking_orders(
  organization_id,source_order,source_kind,approval_id,observed_at)
 VALUES(NEW.organization_id,
  nextval('public.canonical_forecast_commercial_booking_order_sequence'),
  'schedule_approval',NEW.id,clock_timestamp());
 RETURN NEW;
END $$;

CREATE FUNCTION public.canonical_forecast_customer_estimate_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.kind NOT IN ('accepted','revoked') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||NEW.organization_id::text,0));
 INSERT INTO public.canonical_forecast_commercial_booking_orders(
  organization_id,source_order,source_kind,delivery_event_id,observed_at)
 VALUES(NEW.organization_id,
  nextval('public.canonical_forecast_commercial_booking_order_sequence'),
  CASE NEW.kind WHEN 'accepted' THEN 'customer_estimate_acceptance'
   ELSE 'customer_estimate_link_revocation' END,NEW.id,clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_customer_estimate_order_insert
 AFTER INSERT ON public.canonical_customer_estimate_delivery_events
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_customer_estimate_order_insert();

REVOKE ALL ON SEQUENCE public.canonical_forecast_commercial_booking_order_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_commercial_booking_orders FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_commercial_booking_order_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_approval_order_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_customer_estimate_order_insert() FROM PUBLIC;
