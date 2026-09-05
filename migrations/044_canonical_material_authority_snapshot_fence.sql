-- Mission 23 Part 4 terminal audit correction. Migrations 042 and 043 remain
-- byte-for-byte frozen. The advisory lock still orders legitimate repository
-- work; this transactional MVCC fence additionally proves that an entry
-- transaction did not retain a supporting-authority snapshot from before a
-- writer acquired and released the exclusive side of that lock.

CREATE TABLE public.canonical_material_authority_fence (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9223372036854775806),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp()
);

INSERT INTO public.canonical_material_authority_fence(singleton,revision)
VALUES (TRUE,1);

CREATE OR REPLACE FUNCTION public.canonical_material_supporting_authority_write_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(230004,4);
  UPDATE public.canonical_material_authority_fence
     SET revision=revision+1,updated_at=transaction_timestamp()
   WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical material authority fence is unavailable'
      USING ERRCODE='40001',CONSTRAINT='canonical_material_authority_changed';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.canonical_material_supporting_authority_read_lock()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $function$
DECLARE fence_revision BIGINT;
BEGIN
  -- A transaction that already changed a supporting authority must not use
  -- PostgreSQL's same-backend advisory-lock reentrancy to enter material
  -- evidence before that authority transaction commits.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks held
     WHERE held.locktype='advisory' AND held.pid=pg_catalog.pg_backend_pid()
       AND held.database=(SELECT oid FROM pg_catalog.pg_database
                           WHERE datname=pg_catalog.current_database())
       AND held.classid=230004 AND held.objid=4 AND held.objsubid=2
       AND held.mode='ExclusiveLock' AND held.granted
  ) THEN
    RAISE EXCEPTION 'Canonical material authority changed in this transaction'
      USING ERRCODE='40001',CONSTRAINT='canonical_material_authority_changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks held
     WHERE held.locktype='advisory' AND held.pid=pg_catalog.pg_backend_pid()
       AND held.database=(SELECT oid FROM pg_catalog.pg_database
                           WHERE datname=pg_catalog.current_database())
       AND held.classid=230004 AND held.objid=4 AND held.objsubid=2
       AND held.mode='ShareLock' AND held.granted
  ) THEN
    RAISE EXCEPTION 'Canonical material authority serialization is required'
      USING ERRCODE='40001',CONSTRAINT='canonical_material_authority_changed';
  END IF;

  -- In REPEATABLE READ/SERIALIZABLE, PostgreSQL rejects this row lock when the
  -- visible fence version was replaced by a committed authority writer after
  -- the caller's snapshot. That is the database-enforced lock/snapshot proof.
  BEGIN
    SELECT revision INTO STRICT fence_revision
      FROM public.canonical_material_authority_fence
     WHERE singleton
     FOR SHARE;
  EXCEPTION
    WHEN serialization_failure THEN
      RAISE EXCEPTION 'Canonical material authority changed before snapshot validation'
        USING ERRCODE='40001',CONSTRAINT='canonical_material_authority_changed';
    WHEN no_data_found OR too_many_rows THEN
      RAISE EXCEPTION 'Canonical material authority fence is unavailable'
        USING ERRCODE='40001',CONSTRAINT='canonical_material_authority_changed';
  END;
END $function$;

REVOKE ALL ON TABLE public.canonical_material_authority_fence FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_supporting_authority_read_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_material_supporting_authority_write_lock() FROM PUBLIC;
