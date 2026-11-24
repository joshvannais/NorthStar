-- Mission 28 Part 14C: admit the single isolated Automation Center action
-- operation to the existing fictional demo mutation ledger. This changes no
-- paid authority and preserves every previously accepted closed member.

ALTER TABLE public.demo_command_center_mutations
  DROP CONSTRAINT demo_command_center_mutations_operation_check;

ALTER TABLE public.demo_command_center_mutations
  ADD CONSTRAINT demo_command_center_mutations_operation_check
  CHECK (operation IN (
    'customer_estimate_issue','proposal_adopt','simulate_lead','reset','learning_step',
    'forecast_journey','billing_identity','automation_action','estimate_review','material_plan',
    'estimate_adopt','schedule_preview','schedule_approve','work_action','labor_plan',
    'equipment_plan','equipment_cost','equipment_ready','travel_plan','pricing_plan',
    'pricing_policy','commercial_terms','commercial_ok','tax_profile'
  ));
