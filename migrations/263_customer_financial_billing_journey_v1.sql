-- Mission 27 Part 2D: server-resolved authority for the mounted paid
-- billing-identity journey. The browser never selects a capability grant.

-- Admit only the Part 2D fictional billing-identity operation to the existing
-- isolated demo mutation ledger. Unknown operations remain denied by the
-- closed operation set.
ALTER TABLE public.demo_command_center_mutations
  DROP CONSTRAINT demo_command_center_mutations_operation_check;

ALTER TABLE public.demo_command_center_mutations
  ADD CONSTRAINT demo_command_center_mutations_operation_check
  CHECK (operation IN (
    'customer_estimate_issue','proposal_adopt','simulate_lead','reset','learning_step',
    'forecast_journey','billing_identity','estimate_review','material_plan','estimate_adopt',
    'schedule_preview','schedule_approve','work_action','labor_plan','equipment_plan',
    'equipment_cost','equipment_ready','travel_plan','pricing_plan','pricing_policy',
    'commercial_terms','commercial_ok','tax_profile'
  ));

CREATE FUNCTION public.canonical_customer_financial_billing_journey_v1_authority(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,write_value BOOLEAN,
 customer_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;
 selected_grant public.canonical_customer_financial_billing_capability_grants_v1%ROWTYPE;
 candidate_grant public.canonical_customer_financial_billing_capability_grants_v1%ROWTYPE;
 candidate_count INTEGER:=0;
BEGIN
 IF org IS NULL OR actor IS NULL OR session_value IS NULL OR customer_id_value IS NULL OR
    role_value IS NULL OR role_value NOT IN('owner','admin') THEN
  RAISE EXCEPTION 'Billing identity journey access restricted'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_billing_journey_unauthorized';
 END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,write_value);
 IF NOT public.canonical_customer_financial_billing_identity_v1_entitlement(org,FALSE) THEN
  RAISE EXCEPTION 'Current billing identity journey access unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_billing_journey_unauthorized';
 END IF;
 FOR candidate_grant IN
  SELECT grant_value.*
  FROM public.canonical_customer_financial_billing_capability_grants_v1 grant_value
  JOIN public.canonical_customer_financial_billing_capability_heads_v1 head_value
   ON head_value.organization_id=grant_value.organization_id
   AND head_value.capability_grant_id=grant_value.id
   AND head_value.latest_revision=grant_value.revision
  WHERE grant_value.organization_id=org AND grant_value.actor_user_id=actor
   AND grant_value.membership_id=(authority->>'membershipId')::uuid
   AND grant_value.customer_id=customer_id_value
   AND grant_value.capability='customer_financial.billing_identity.review'
   AND grant_value.business_purpose='customer_financial.billing_identity'
   AND grant_value.policy_version='mission27.launch.v1'
   AND grant_value.template_version=CASE role_value WHEN 'owner' THEN 'm27.owner.v1' ELSE 'm27.admin.v1' END
   AND grant_value.active=TRUE AND grant_value.issued_at<=clock_timestamp()
   AND grant_value.valid_from<=clock_timestamp() AND grant_value.expires_at>clock_timestamp()
  ORDER BY grant_value.id
  FOR SHARE OF grant_value,head_value
 LOOP
  candidate_count:=candidate_count+1;
  selected_grant:=candidate_grant;
 END LOOP;
 IF candidate_count<>1 OR selected_grant.id IS NULL THEN
  RAISE EXCEPTION 'Current billing identity journey capability unavailable'
   USING ERRCODE='42501',CONSTRAINT='canonical_customer_financial_billing_identity_capability_unavailable';
 END IF;
 RETURN jsonb_build_object(
  'organizationId',org,'actorUserId',actor,'actorAccessRole',role_value,
  'authSessionId',session_value,'capabilityGrantId',selected_grant.id,
  'capabilityGrantRevision',selected_grant.revision,
  'businessPurpose',selected_grant.business_purpose,
  'policyVersion',selected_grant.policy_version);
END $$;

REVOKE ALL ON FUNCTION public.canonical_customer_financial_billing_journey_v1_authority(
 UUID,UUID,TEXT,UUID,TEXT,BOOLEAN,UUID) FROM PUBLIC;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_customer_financial_billing_journey_v1_authority(
  UUID,UUID,TEXT,UUID,TEXT,BOOLEAN,UUID) TO northstar_app_runtime;
END IF;END $$;
