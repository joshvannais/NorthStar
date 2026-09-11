-- Demo-only operation admission. Immutable schedule history stays in private
-- session state; no paid scheduling grant or table is changed.
ALTER TABLE public.demo_command_center_mutations
  DROP CONSTRAINT demo_command_center_mutations_operation_check;
ALTER TABLE public.demo_command_center_mutations
  ADD CONSTRAINT demo_command_center_mutations_operation_check
  CHECK (operation IN ('simulate_lead','reset','estimate_review','material_plan','estimate_adopt','schedule_preview','schedule_approve'));
