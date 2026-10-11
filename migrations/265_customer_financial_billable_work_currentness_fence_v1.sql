-- Mission 27 Part 3B correction: database-owned currentness serialization for
-- the exact Mission 23 rows joined into billable-work context.  The reader
-- takes the tenant row lock and this per-work lock shared.  Every actual source
-- mutation takes the same work identity exclusively before its source row can
-- change.  No source meaning, write authority, grant, or financial action is
-- added by this migration.

CREATE FUNCTION public.canonical_customer_financial_billable_work_reader_fence_v1(
 p_organization_id UUID,
 p_execution_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF p_organization_id IS NULL OR p_execution_id IS NULL THEN
  RAISE EXCEPTION 'Billable-work reader identity unavailable'
   USING ERRCODE='42501',
    CONSTRAINT='canonical_customer_financial_billable_work_reader_identity';
 END IF;
 -- Take the released material authority lock first, then lock tenant and
 -- execution rows before the shared work fence. Actual
 -- labor/material writers lock the execution row before their source trigger;
 -- matching that order prevents a reader/writer deadlock while keeping every
 -- other source writer serialized by the advisory fence below.
 PERFORM pg_advisory_xact_lock_shared(230004,4);
 PERFORM 1 FROM public.organizations
  WHERE id=p_organization_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Billable-work tenant unavailable'
   USING ERRCODE='42501',
    CONSTRAINT='canonical_customer_financial_billable_work_tenant_unavailable';
 END IF;
 PERFORM 1 FROM public.canonical_field_executions
  WHERE organization_id=p_organization_id AND id=p_execution_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Billable-work execution unavailable'
   USING ERRCODE='42501',
    CONSTRAINT='canonical_customer_financial_billable_work_execution_unavailable';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(
  230007,hashtext(p_organization_id::text||':'||p_execution_id::text));
 RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_customer_financial_billable_work_execution_fence_v1()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 org UUID;
 work UUID;
BEGIN
 IF TG_OP='DELETE' THEN
  org:=OLD.organization_id;
  work:=OLD.id;
 ELSE
  org:=NEW.organization_id;
  work:=NEW.id;
 END IF;
 IF TG_OP='UPDATE' AND
    (OLD.organization_id IS DISTINCT FROM NEW.organization_id OR
     OLD.id IS DISTINCT FROM NEW.id) THEN
  RAISE EXCEPTION 'Billable-work source identity is immutable'
   USING ERRCODE='23514',
    CONSTRAINT='canonical_customer_financial_billable_work_source_identity_immutable';
 END IF;
 IF org IS NULL OR work IS NULL THEN
  RAISE EXCEPTION 'Billable-work source identity unavailable'
   USING ERRCODE='23514',
    CONSTRAINT='canonical_customer_financial_billable_work_source_identity';
 END IF;
 -- Tenant first, work second is the shared lock order with Part 3B and the
 -- released Mission 24/schedule tenant fences.  A shared tenant row lock does
 -- not serialize unrelated jobs in one tenant.
 PERFORM 1 FROM public.organizations WHERE id=org FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Billable-work tenant unavailable'
   USING ERRCODE='42501',
    CONSTRAINT='canonical_customer_financial_billable_work_tenant_unavailable';
 END IF;
 PERFORM pg_advisory_xact_lock(230007,hashtext(org::text||':'||work::text));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 org UUID;
 work UUID;
BEGIN
 IF TG_OP='DELETE' THEN
  org:=OLD.organization_id;
  work:=OLD.execution_id;
 ELSE
  org:=NEW.organization_id;
  work:=NEW.execution_id;
 END IF;
 IF TG_OP='UPDATE' AND
    (OLD.organization_id IS DISTINCT FROM NEW.organization_id OR
     OLD.execution_id IS DISTINCT FROM NEW.execution_id) THEN
  RAISE EXCEPTION 'Billable-work source identity is immutable'
   USING ERRCODE='23514',
    CONSTRAINT='canonical_customer_financial_billable_work_source_identity_immutable';
 END IF;
 IF org IS NULL OR work IS NULL THEN
  RAISE EXCEPTION 'Billable-work source identity unavailable'
   USING ERRCODE='23514',
    CONSTRAINT='canonical_customer_financial_billable_work_source_identity';
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=org FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Billable-work tenant unavailable'
   USING ERRCODE='42501',
    CONSTRAINT='canonical_customer_financial_billable_work_tenant_unavailable';
 END IF;
 PERFORM pg_advisory_xact_lock(230007,hashtext(org::text||':'||work::text));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER canonical_billable_work_fence_execution_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_field_executions
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_execution_fence_v1();
CREATE TRIGGER canonical_billable_work_fence_completion_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_completion_records
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1();
CREATE TRIGGER canonical_billable_work_fence_labor_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_labor_intervals
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1();
CREATE TRIGGER canonical_billable_work_fence_materials_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_material_movements
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1();
CREATE TRIGGER canonical_billable_work_fence_progress_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_progress_records
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1();
CREATE TRIGGER canonical_billable_work_fence_field_evidence_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_field_evidence_records
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1();
CREATE TRIGGER canonical_billable_work_fence_equipment_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_equipment_events
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1();
CREATE TRIGGER canonical_billable_work_fence_handoff_v1
 BEFORE INSERT OR UPDATE OR DELETE ON public.canonical_handoff_receipts
 FOR EACH ROW EXECUTE FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1();

REVOKE ALL ON FUNCTION public.canonical_customer_financial_billable_work_source_fence_v1()
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billable_work_execution_fence_v1()
 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_customer_financial_billable_work_reader_fence_v1(UUID,UUID)
 FROM PUBLIC;
