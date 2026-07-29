-- Mission 19 Part 3 - explicit canonical tax persistence.
-- Existing immutable estimates are not recalculated or backfilled.

BEGIN;

ALTER TABLE canonical_estimates
  ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS tax_not_calculated_reason VARCHAR(100),
  ADD COLUMN IF NOT EXISTS total_including_tax NUMERIC(14,2);

ALTER TABLE canonical_estimates
  DROP CONSTRAINT IF EXISTS canonical_estimates_tax_rate_check;
ALTER TABLE canonical_estimates
  ADD CONSTRAINT canonical_estimates_tax_rate_check CHECK (
    tax_rate_percent IS NULL OR (tax_rate_percent >= 0 AND tax_rate_percent <= 100)
  );

ALTER TABLE canonical_estimates
  DROP CONSTRAINT IF EXISTS canonical_estimates_tax_amount_check;
ALTER TABLE canonical_estimates
  ADD CONSTRAINT canonical_estimates_tax_amount_check CHECK (
    tax_amount IS NULL OR tax_amount >= 0
  );

ALTER TABLE canonical_estimates
  DROP CONSTRAINT IF EXISTS canonical_estimates_total_with_tax_check;
ALTER TABLE canonical_estimates
  ADD CONSTRAINT canonical_estimates_total_with_tax_check CHECK (
    total_including_tax IS NULL OR total_including_tax >= 0
  );

COMMIT;
