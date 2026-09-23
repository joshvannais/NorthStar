-- Mission 26 Part 6A: commit-ordered observation of new Mission 22 human
-- schedule approvals. Existing approvals are deliberately not backfilled.
-- An order is source evidence, not proof of a first accepted booking, a
-- reviewed estimate link, or booked-work value.

CREATE SEQUENCE public.canonical_forecast_booking_approval_order_sequence AS BIGINT;

CREATE TABLE public.canonical_forecast_booking_approval_orders (
 organization_id UUID NOT NULL,
 appointment_id UUID NOT NULL,
 approval_id UUID NOT NULL,
 source_order BIGINT NOT NULL CHECK(source_order>0),
 observed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(organization_id,approval_id),
 UNIQUE(organization_id,source_order),
 FOREIGN KEY(organization_id,approval_id)
  REFERENCES public.canonical_schedule_human_approvals(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,appointment_id)
  REFERENCES public.canonical_appointments(organization_id,id)
  ON DELETE RESTRICT
);
CREATE INDEX canonical_forecast_booking_approval_orders_tenant_order_idx
 ON public.canonical_forecast_booking_approval_orders(organization_id,source_order DESC);

CREATE FUNCTION public.canonical_forecast_booking_approval_order_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Forecast booking-approval order is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_forecast_booking_approval_order_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_booking_approval_orders
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_booking_approval_order_immutable();

CREATE FUNCTION public.canonical_forecast_booking_approval_order_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- The tenant lock is held through the Mission 22 writer's commit. A later
 -- same-tenant insert cannot get an order first. Rollback sequence gaps are
 -- expected and never imply an omitted approval.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:booking-approval-order:'||NEW.organization_id::text,0));
 INSERT INTO public.canonical_forecast_booking_approval_orders(
  organization_id,appointment_id,approval_id,source_order,observed_at)
 VALUES(NEW.organization_id,NEW.appointment_id,NEW.id,
  nextval('public.canonical_forecast_booking_approval_order_sequence'),
  clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_booking_approval_order_insert
 AFTER INSERT ON public.canonical_schedule_human_approvals
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_booking_approval_order_insert();

REVOKE ALL ON SEQUENCE public.canonical_forecast_booking_approval_order_sequence FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_forecast_booking_approval_orders FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_approval_order_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_booking_approval_order_insert() FROM PUBLIC;
