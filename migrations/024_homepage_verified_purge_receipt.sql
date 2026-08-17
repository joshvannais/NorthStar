-- A verified homepage purge may authorize at most one short-lived Polaris
-- projection. The existing keyed capability row remains the sole durable
-- authority; no call identifier, raw token, transcript, or result is stored.
ALTER TABLE homepage_demo_purge_operations
  ADD COLUMN projection_permitted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE homepage_demo_purge_operations
  DROP CONSTRAINT homepage_demo_purge_operations_state_check;

ALTER TABLE homepage_demo_purge_operations
  ADD CONSTRAINT homepage_demo_purge_operations_state_check
    CHECK (state IN ('in_progress', 'verified', 'consumed'));

ALTER TABLE homepage_demo_purge_operations
  DROP CONSTRAINT homepage_demo_purge_operations_lifecycle_check;

ALTER TABLE homepage_demo_purge_operations
  ADD CONSTRAINT homepage_demo_purge_operations_lifecycle_check
    CHECK (
      (state = 'in_progress' AND lease_expires_at IS NOT NULL AND verified_at IS NULL) OR
      (state IN ('verified', 'consumed') AND lease_expires_at IS NULL AND verified_at IS NOT NULL)
    );

ALTER TABLE homepage_demo_purge_operations
  ADD CONSTRAINT homepage_demo_purge_operations_consumed_projection_check
    CHECK (state <> 'consumed' OR projection_permitted = TRUE);

COMMENT ON COLUMN homepage_demo_purge_operations.projection_permitted IS
  'Monotonic deletion-time permission for one receipt-gated, browser-memory-only Polaris projection; never stores call or transcript content.';
