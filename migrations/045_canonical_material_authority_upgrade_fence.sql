-- Mission 23 Part 4 rolling-upgrade correction. Migrations 042-044 remain
-- byte-for-byte frozen. Drain every supporting-authority writer that could
-- have entered through the pre-fence migration 043 trigger, then establish one
-- fence revision under the complete table/advisory exclusion boundary.

DO $migration$
DECLARE
  attempt INTEGER:=0;
BEGIN
  -- NOWAIT attempts avoid a lock-order deadlock with a multi-table authority
  -- transaction. A failed attempt is rolled back to this subtransaction before
  -- the bounded retry. Exhaustion fails the migration without a partial effect.
  LOOP
    attempt:=attempt+1;
    BEGIN
      LOCK TABLE
        public.auth_sessions,
        public.subscriptions,
        public.organization_onboarding,
        public.users,
        public.organization_memberships,
        public.workforce_profiles,
        public.workforce_crew_members,
        public.canonical_transcripts,
        public.canonical_appointments,
        public.canonical_schedule_assignments,
        public.canonical_field_executions
      IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt>=200 THEN
        RAISE EXCEPTION 'Canonical material authority upgrade quiescence unavailable'
          USING ERRCODE='55P03',CONSTRAINT='canonical_material_authority_upgrade_busy';
      END IF;
      PERFORM pg_catalog.pg_sleep(0.05);
    END;
  END LOOP;

  -- No old or new authority writer can remain or enter while all eleven table
  -- locks are held. The advisory lock preserves the steady-state ordering and
  -- this committed revision covers any writer that completed through 043.
  PERFORM pg_catalog.pg_advisory_xact_lock(230004,4);
  UPDATE public.canonical_material_authority_fence
     SET revision=revision+1,updated_at=transaction_timestamp()
   WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical material authority fence is unavailable'
      USING ERRCODE='40001',CONSTRAINT='canonical_material_authority_changed';
  END IF;
END
$migration$;
