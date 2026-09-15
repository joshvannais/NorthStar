-- Mission 24 acceptance correction: the immutable demo-estimate issue operation
-- is longer than the original bounded demo ledger's VARCHAR(16) field.
ALTER TABLE public.demo_command_center_mutations
  ALTER COLUMN operation TYPE VARCHAR(32);
