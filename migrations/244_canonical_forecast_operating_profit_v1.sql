-- Mission 26 original Part 7E: one source-authenticated M24 v3 composition per
-- booked job, a separate economic-expense policy, and a compact monthly
-- operating-cost/profit/margin forecast. Dated obligations remain cash only.

CREATE TABLE public.canonical_operating_profit_policy_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 action TEXT NOT NULL CHECK(action IN('replace','revoke')),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=262144),
 authority JSONB NOT NULL CHECK(jsonb_typeof(authority)='object'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(organization_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_operating_profit_policy_revisions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL)OR(revision>1 AND previous_id IS NOT NULL))
);

CREATE FUNCTION public.canonical_operating_profit_policy_immutable()RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION'Operating-profit policy history is immutable'USING ERRCODE='23514';END $$;
CREATE TRIGGER canonical_operating_profit_policy_immutable BEFORE UPDATE OR DELETE
ON public.canonical_operating_profit_policy_revisions FOR EACH ROW
EXECUTE FUNCTION public.canonical_operating_profit_policy_immutable();

CREATE FUNCTION public.canonical_operating_profit_policy_valid(body JSONB)RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE expense JSONB;scenario JSONB;source_value JSONB;coverage JSONB;keys TEXT[]:='{}';names TEXT[]:='{}';baseline_count INTEGER:=0;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(body,ARRAY[
  'expectedRevision','expectedDigest','action','currency','effectiveOn','coverage','expenses',
  'scenarios','schedulePin','overlapReview','reason','confirmed','confirmationVersion'])IS NOT TRUE
 OR jsonb_typeof(body->'expectedRevision')<>'number'OR body->>'expectedRevision'!~'^(0|[1-9][0-9]{0,3}|10000)$'
 OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$'OR(((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none'))
 OR body->>'action'NOT IN('replace','revoke')OR public.canonical_learning_text_valid(body->>'reason',2000)IS NOT TRUE
 OR body->'confirmed'IS DISTINCT FROM'true'::jsonb OR body->>'confirmationVersion'<>'operating-profit-policy-v1'
 THEN RETURN FALSE;END IF;
 IF body->>'action'='revoke'THEN RETURN body->'currency'='null'::jsonb AND body->'effectiveOn'='null'::jsonb
  AND body->'coverage'='null'::jsonb AND body->'expenses'='[]'::jsonb AND body->'scenarios'='[]'::jsonb
  AND body->'schedulePin'='null'::jsonb AND body->'overlapReview'='null'::jsonb;END IF;
 coverage:=body->'coverage';
 IF body->>'currency'!~'^[A-Z]{3}$'OR public.canonical_pricing_day(body->'effectiveOn')IS NOT TRUE
 OR public.canonical_field_evidence_object_keys_exact(coverage,ARRAY['startsOn','endsOn','recordedThrough','complete'])IS NOT TRUE
 OR public.canonical_pricing_day(coverage->'startsOn')IS NOT TRUE OR public.canonical_pricing_day(coverage->'endsOn')IS NOT TRUE
 OR coverage->>'endsOn'<coverage->>'startsOn'OR coverage->'complete'IS DISTINCT FROM'true'::jsonb
 OR coverage->>'recordedThrough'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
 OR jsonb_typeof(body->'expenses')<>'array'OR jsonb_array_length(body->'expenses')>120
 OR jsonb_typeof(body->'scenarios')<>'array'OR jsonb_array_length(body->'scenarios')NOT BETWEEN 2 AND 5
 OR public.canonical_field_evidence_object_keys_exact(body->'schedulePin',ARRAY['revision','digest'])IS NOT TRUE
 OR body#>>'{schedulePin,revision}'!~'^[1-9][0-9]{0,3}$|^10000$'OR body#>>'{schedulePin,digest}'!~'^[0-9a-f]{64}$'
 OR public.canonical_field_evidence_object_keys_exact(body->'overlapReview',ARRAY['status','reason'])IS NOT TRUE
 OR body#>>'{overlapReview,status}'<>'reconciled'OR public.canonical_learning_text_valid(body#>>'{overlapReview,reason}',1000)IS NOT TRUE
 THEN RETURN FALSE;END IF;
 FOR expense IN SELECT value FROM jsonb_array_elements(body->'expenses')LOOP
  source_value:=expense->'source';
  IF public.canonical_field_evidence_object_keys_exact(expense,ARRAY[
    'expenseKey','label','classification','amount','recognitionStartsOn','recognitionEndsOn','source'])IS NOT TRUE
   OR expense->>'expenseKey'!~'^[a-z0-9][a-z0-9._-]{1,63}$'OR expense->>'expenseKey'=ANY(keys)
   OR public.canonical_learning_text_valid(expense->>'label',160)IS NOT TRUE
   OR expense->>'classification'NOT IN('fixed_period','variable_period')
   OR expense->>'amount'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'
   OR public.canonical_pricing_day(expense->'recognitionStartsOn')IS NOT TRUE
   OR public.canonical_pricing_day(expense->'recognitionEndsOn')IS NOT TRUE
   OR expense->>'recognitionEndsOn'<expense->>'recognitionStartsOn'
   OR expense->>'recognitionStartsOn'<coverage->>'startsOn'OR expense->>'recognitionEndsOn'>coverage->>'endsOn'
   OR public.canonical_field_evidence_object_keys_exact(source_value,ARRAY['kind','reference','documentDigest','attestedAt'])IS NOT TRUE
   OR source_value->>'kind'NOT IN('owner_attested','source_document')
   OR public.canonical_learning_text_valid(source_value->>'reference',500)IS NOT TRUE
   OR source_value->>'attestedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
   OR(source_value->>'kind'='owner_attested'AND source_value->'documentDigest'<>'null'::jsonb)
   OR(source_value->>'kind'='source_document'AND COALESCE(source_value->>'documentDigest','')!~'^[0-9a-f]{64}$')
  THEN RETURN FALSE;END IF;keys:=array_append(keys,expense->>'expenseKey');
 END LOOP;
 FOR scenario IN SELECT value FROM jsonb_array_elements(body->'scenarios')LOOP
  IF public.canonical_field_evidence_object_keys_exact(scenario,ARRAY['key','label','operatingCostBasisPoints','reason'])IS NOT TRUE
   OR scenario->>'key'!~'^[a-z][a-z0-9_-]{1,47}$'OR scenario->>'key'=ANY(names)
   OR public.canonical_learning_text_valid(scenario->>'label',80)IS NOT TRUE
   OR scenario->>'operatingCostBasisPoints'!~'^[5-9][0-9]{3}$|^1[0-5][0-9]{3}$'
   OR public.canonical_learning_text_valid(scenario->>'reason',500)IS NOT TRUE THEN RETURN FALSE;END IF;
  IF scenario->>'key'='recorded_plan'AND(scenario->>'operatingCostBasisPoints')::integer=10000 THEN baseline_count:=baseline_count+1;END IF;
  names:=array_append(names,scenario->>'key');
 END LOOP;
 RETURN baseline_count=1;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_operating_profit_policy_projection(v public.canonical_operating_profit_policy_revisions)RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$SELECT CASE WHEN v.id IS NULL THEN
 jsonb_build_object('state','absent','revision',0,'digest','none','action',NULL,'createdAt',NULL,'policy',NULL)
 ELSE jsonb_build_object('state',CASE WHEN v.action='replace'THEN'current'ELSE'revoked'END,'revision',v.revision,
 'digest',rtrim(v.canonical_digest),'action',v.action,'createdAt',public.canonical_forecast_utc_instant(v.created_at),'policy',v.payload)END$$;

CREATE FUNCTION public.canonical_operating_profit_policy_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,body JSONB)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;old public.canonical_operating_profit_policy_revisions%ROWTYPE;
 replay public.canonical_operating_profit_policy_revisions%ROWTYPE;inserted public.canonical_operating_profit_policy_revisions%ROWTYPE;
 schedule_source public.canonical_operating_cost_schedule_revisions%ROWTYPE;profile public.canonical_business_profiles%ROWTYPE;
 key_hash TEXT;request_hash TEXT;digest_value TEXT;next_revision BIGINT;captured TIMESTAMPTZ;zone TEXT;currency_value TEXT;authority_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'THEN RAISE EXCEPTION'Serializable required'USING ERRCODE='25001';END IF;
 IF role_value NOT IN('owner','admin')OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
 OR public.canonical_operating_profit_policy_valid(body)IS NOT TRUE THEN RAISE EXCEPTION'Operating-profit policy invalid'USING ERRCODE='22023';END IF;
 auth:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM 1 FROM public.organizations WHERE id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION'Organization unavailable'USING ERRCODE='42501';END IF;
 LOCK TABLE public.canonical_equipment_cost_plans,public.canonical_pricing_plans,
  public.canonical_operating_cost_schedule_revisions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-cost-schedules:'||org::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-profit-policy:'||org::text,0));
 auth:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'body',body));
 SELECT * INTO replay FROM public.canonical_operating_profit_policy_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION'Request body changed'USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('revision',replay.revision,'digest',rtrim(replay.canonical_digest),'action',replay.action,'replayed',TRUE);END IF;
 SELECT * INTO old FROM public.canonical_operating_profit_policy_revisions WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF COALESCE(old.revision,0)<>(body->>'expectedRevision')::bigint OR COALESCE(rtrim(old.canonical_digest),'none')<>body->>'expectedDigest'
 THEN RAISE EXCEPTION'Operating-profit policy changed'USING ERRCODE='40001';END IF;
 IF body->>'action'='revoke'AND old.id IS NULL THEN RAISE EXCEPTION'Nothing to revoke'USING ERRCODE='22023';END IF;
 captured:=public.canonical_forecast_workload_capacity_v1_clock();
 SELECT p.* INTO profile FROM public.canonical_business_profiles p JOIN public.organization_onboarding o
  ON o.organization_id=p.organization_id AND o.active_business_profile_id=p.id AND o.status='complete'
  WHERE p.organization_id=org AND p.is_active FOR SHARE OF p,o;
 zone:=profile.raw_profile#>>'{company,timeZone}';currency_value:=profile.raw_profile#>>'{company,currency}';
 IF profile.id IS NULL OR zone IS NULL OR currency_value!~'^[A-Z]{3}$'OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
 THEN RAISE EXCEPTION'Reporting profile unavailable'USING ERRCODE='40001';END IF;
 IF body->>'action'='replace'THEN
  SELECT * INTO schedule_source FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org
   AND action='replace'AND(payload->>'effectiveOn')::date<=(captured AT TIME ZONE(authority#>>'{profile,timeZone}'))::date
   ORDER BY revision DESC LIMIT 1;
  IF schedule_source.id IS NULL OR schedule_source.revision<>(body#>>'{schedulePin,revision}')::bigint
   OR rtrim(schedule_source.canonical_digest)IS DISTINCT FROM body#>>'{schedulePin,digest}'
   OR body->>'currency'IS DISTINCT FROM currency_value OR(body#>>'{coverage,recordedThrough}')::timestamptz>captured
   OR(body->>'effectiveOn')::date>(body#>>'{coverage,endsOn}')::date
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(body->'expenses')e WHERE(e#>>'{source,attestedAt}')::timestamptz>captured)
  THEN RAISE EXCEPTION'Operating-profit source changed'USING ERRCODE='40001';END IF;
 END IF;
 authority_value:=jsonb_build_object('version','operating-profit-policy-authority-v1','profile',jsonb_build_object(
  'id',profile.id,'version',profile.version_number,'digest',rtrim(profile.normalized_profile_hash),'timeZone',zone,'currency',currency_value),
  'schedulePin',CASE WHEN body->>'action'='replace'THEN body->'schedulePin'ELSE old.authority->'schedulePin'END);
 next_revision:=COALESCE(old.revision,0)+1;digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'revision',next_revision,'previousId',old.id,'action',body->>'action',
  'payload',body-'expectedRevision'-'expectedDigest'-'reason'-'confirmed'-'confirmationVersion','authority',authority_value,
  'actorUserId',actor,'membershipId',(auth->>'membershipId')::uuid,'authSessionId',session_value,'reason',body->>'reason',
  'requestDigest',request_hash,'createdAt',captured));
 INSERT INTO public.canonical_operating_profit_policy_revisions(organization_id,revision,previous_id,action,payload,authority,
  actor_user_id,membership_id,auth_session_id,reason,request_key_hash,request_digest,canonical_digest,created_at)
 VALUES(org,next_revision,old.id,body->>'action',body-'expectedRevision'-'expectedDigest'-'reason'-'confirmed'-'confirmationVersion',authority_value,
  actor,(auth->>'membershipId')::uuid,session_value,body->>'reason',key_hash,request_hash,digest_value,captured)RETURNING * INTO inserted;
 RETURN jsonb_build_object('revision',inserted.revision,'digest',rtrim(inserted.canonical_digest),'action',inserted.action,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_operating_profit_policy_read(org UUID,actor UUID,role_value TEXT,session_value UUID,cutoff TIMESTAMPTZ DEFAULT NULL)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;v public.canonical_operating_profit_policy_revisions%ROWTYPE;at_value TIMESTAMPTZ:=COALESCE(cutoff,public.canonical_forecast_workload_capacity_v1_clock());
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'OR cutoff>public.canonical_forecast_workload_capacity_v1_clock()
 THEN RAISE EXCEPTION'Historical cutoff invalid'USING ERRCODE='22023';END IF;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN('owner','admin')THEN RAISE EXCEPTION'Policy restricted'USING ERRCODE='42501';END IF;
 IF cutoff IS NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-profit-policy:'||org::text,0));END IF;
 SELECT * INTO v FROM public.canonical_operating_profit_policy_revisions WHERE organization_id=org AND created_at<=at_value
  AND(action='revoke'OR(payload->>'effectiveOn')::date<=(at_value AT TIME ZONE(authority#>>'{profile,timeZone}'))::date)
  ORDER BY revision DESC LIMIT 1;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_operating_profit_policy_projection(v);
END $$;

CREATE FUNCTION public.canonical_forecast_signed_money(v NUMERIC)RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a NUMERIC:=abs(v);BEGIN IF v IS NULL OR v<>trunc(v)OR a>99999999999999999 THEN RAISE EXCEPTION'Forecast amount invalid'USING ERRCODE='22023';END IF;
 RETURN(CASE WHEN v<0 THEN'-'ELSE''END)||trunc(a/100)::text||'.'||lpad(trunc(mod(a,100))::text,2,'0');END $$;
CREATE FUNCTION public.canonical_forecast_margin(v NUMERIC,revenue NUMERIC)RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN IF revenue IS NULL OR revenue<=0 OR v IS NULL THEN RETURN NULL;END IF;RETURN to_char(round(v*10000/revenue)/100,'FM999999990.00');END $$;

CREATE FUNCTION public.canonical_forecast_operating_profit_v1_unavailable(reason_value TEXT,cutoff TIMESTAMPTZ,zone TEXT)RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE start_day DATE:=(cutoff AT TIME ZONE COALESCE(zone,'UTC'))::date;BEGIN RETURN jsonb_build_object(
 'version','m26-operating-profit-forecast-v1','state','unavailable','reason',reason_value,'fictional',FALSE,
 'checkedAt',public.canonical_forecast_utc_instant(cutoff),'currency',NULL,
 'horizon',jsonb_build_object('kind','next_30_elapsed_days_with_local_expense_dates','timeZone',zone,
  'startsAt',public.canonical_forecast_utc_instant(cutoff),'endsAt',public.canonical_forecast_utc_instant(cutoff+INTERVAL'2592000 seconds'),
  'startsOn',start_day::text,'endsOnExclusive',(start_day+30)::text),
 'scope',jsonb_build_object('label','Authenticated owner-confirmed scheduled backlog and recorded company operating expenses',
  'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
 'kpis',jsonb_build_object('operatingCost',NULL,'profitLow',NULL,'profitHigh',NULL,'marginLow',NULL,'marginHigh',NULL),
 'months','[]'::jsonb,'revenue',jsonb_build_object('target','approved_booked_price_before_tax','amount',NULL,
  'recognizedRevenueMeasured',FALSE,'earnedRevenueMeasured',FALSE,'invoicedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE),
 'costs',jsonb_build_object('directJobCost',NULL,'incrementalJobOverhead',NULL,'fixedPeriodExpense',NULL,
  'variablePeriodExpense',NULL,'operatingCost',NULL,'datedCashObligations',NULL,'actualPaymentMeasured',FALSE),
 'range',jsonb_build_object('kind','deterministic_named_scenarios','scenarios','[]'::jsonb,'calibrated',FALSE,'probability',FALSE),
 'evidence',jsonb_build_object('sourceAuthenticatedComposition',FALSE,'componentQuantitiesAndCostsVerified',FALSE,
  'duplicatePreventionVerified',FALSE,'approvedScheduleTiming',FALSE,'overlapReviewed',FALSE,'expenseCoverageVerified',FALSE,
  'currentnessVerified',FALSE,'m25AdjustmentApplied',FALSE,'externalEventClassified',FALSE,'scopeChangeClassified',FALSE),
 'run',jsonb_build_object('calculationVersion','m26-operating-profit-calculation-v1','digest',NULL),
 'forecastIssued',FALSE,'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);END $$;

CREATE FUNCTION public.canonical_forecast_operating_profit_v1_current(org UUID,actor UUID,role_value TEXT,session_value UUID)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;cutoff TIMESTAMPTZ;horizon TIMESTAMPTZ;profile public.canonical_business_profiles%ROWTYPE;
 zone TEXT;currency_value TEXT;start_day DATE;end_day DATE;labor_gate JSONB;material_gate JSONB;equipment_gate JSONB;cash_gate JSONB;
 policy public.canonical_operating_profit_policy_revisions%ROWTYPE;schedule_source public.canonical_operating_cost_schedule_revisions%ROWTYPE;
 position_count INTEGER;scheduled_count INTEGER:=0;candidate RECORD;booked RECORD;booking_state JSONB;
 revision_value public.canonical_estimate_revisions%ROWTYPE;adoption public.canonical_estimate_proposal_adoptions%ROWTYPE;
 pricing public.canonical_pricing_plans%ROWTYPE;basis JSONB;pricing_result JSONB;
 revenue_cents NUMERIC:=0;direct_cents NUMERIC:=0;job_overhead_cents NUMERIC:=0;fixed_cents NUMERIC:=0;variable_cents NUMERIC:=0;
 job_revenue NUMERIC;job_direct NUMERIC;job_overhead NUMERIC;total_seconds NUMERIC;piece_seconds NUMERIC;
 remaining_revenue NUMERIC;remaining_direct NUMERIC;remaining_overhead NUMERIC;piece_revenue NUMERIC;piece_direct NUMERIC;piece_overhead NUMERIC;
 piece_start TIMESTAMPTZ;piece_end TIMESTAMPTZ;boundary TIMESTAMPTZ;month_key TEXT;month_map JSONB:='{}'::jsonb;month_value JSONB;
 expense JSONB;expense_start DATE;expense_end DATE;overlap_start DATE;overlap_end DATE;month_start DATE;month_end DATE;
 total_days INTEGER;overlap_days INTEGER;expense_cents NUMERIC;piece_expense NUMERIC;
 scenario JSONB;scenario_items JSONB:='[]'::jsonb;months JSONB:='[]'::jsonb;bucket RECORD;
 month_revenue NUMERIC;month_direct NUMERIC;month_job_overhead NUMERIC;month_fixed NUMERIC;month_variable NUMERIC;month_cost NUMERIC;
 scenario_cost NUMERIC;scenario_profit NUMERIC;scenario_values JSONB;profit_min NUMERIC;profit_max NUMERIC;margin_min NUMERIC;margin_max NUMERIC;
 operating_cost NUMERIC;profit_value NUMERIC;all_scenarios JSONB:='[]'::jsonb;run_payload JSONB;run_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION'Read committed required'USING ERRCODE='25001';END IF;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 cutoff:=public.canonical_forecast_workload_capacity_v1_clock();horizon:=cutoff+INTERVAL'2592000 seconds';
 SELECT p.* INTO profile FROM public.canonical_business_profiles p JOIN public.organization_onboarding o
  ON o.organization_id=p.organization_id AND o.active_business_profile_id=p.id AND o.status='complete'
  WHERE p.organization_id=org AND p.is_active FOR SHARE OF p,o;
 zone:=profile.raw_profile#>>'{company,timeZone}';currency_value:=profile.raw_profile#>>'{company,currency}';
 IF profile.id IS NULL OR zone IS NULL OR currency_value!~'^[A-Z]{3}$'OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('reporting_profile_unavailable',cutoff,NULL);END IF;
 start_day:=(cutoff AT TIME ZONE zone)::date;end_day:=start_day+30;
 labor_gate:=public.canonical_forecast_labor_cost_v1_current(org,actor,role_value,session_value);
 material_gate:=public.canonical_forecast_material_cost_v1_current(org,actor,role_value,session_value);
 equipment_gate:=public.canonical_forecast_equipment_travel_cost_v1_current(org,actor,role_value,session_value);
 cash_gate:=public.canonical_forecast_overhead_cash_v1_current(org,actor,role_value,session_value);
 IF labor_gate->>'state'<>'current'OR material_gate->>'state'<>'current'OR equipment_gate->>'state'<>'current'
 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('current_composition_coverage_unavailable',cutoff,zone);END IF;
 IF cash_gate->>'state'<>'current'THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('dated_cash_source_unavailable',cutoff,zone);END IF;
 LOCK TABLE public.canonical_estimate_revisions,public.canonical_estimate_proposal_adoptions,public.canonical_pricing_plans,
  public.canonical_operating_profit_policy_revisions IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-profit-policy:'||org::text,0));
 SELECT * INTO policy FROM public.canonical_operating_profit_policy_revisions WHERE organization_id=org AND created_at<=cutoff
  AND(action='revoke'OR(payload->>'effectiveOn')::date<=start_day)ORDER BY revision DESC LIMIT 1;
 IF policy.id IS NULL OR policy.action<>'replace'THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('economic_expense_policy_unavailable',cutoff,zone);END IF;
 IF policy.authority#>>'{profile,id}'IS DISTINCT FROM profile.id::text OR(policy.authority#>>'{profile,version}')::bigint<>profile.version_number
  OR policy.authority#>>'{profile,digest}'IS DISTINCT FROM rtrim(profile.normalized_profile_hash)
  OR policy.payload->>'currency'IS DISTINCT FROM currency_value OR policy.payload#>>'{coverage,complete}'<>'true'
  OR(policy.payload#>>'{coverage,startsOn}')::date>start_day OR(policy.payload#>>'{coverage,endsOn}')::date<end_day-1
  OR(policy.payload#>>'{coverage,recordedThrough}')::timestamptz>policy.created_at
 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('economic_expense_policy_stale',cutoff,zone);END IF;
 SELECT * INTO schedule_source FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org AND created_at<=cutoff
  AND action='replace'AND(payload->>'effectiveOn')::date<=start_day ORDER BY revision DESC LIMIT 1;
 IF schedule_source.id IS NULL OR schedule_source.revision<>(policy.authority#>>'{schedulePin,revision}')::bigint
  OR rtrim(schedule_source.canonical_digest)IS DISTINCT FROM policy.authority#>>'{schedulePin,digest}'
  OR cash_gate#>>'{basis,sourceRevision}'IS DISTINCT FROM schedule_source.revision::text
  OR cash_gate#>>'{basis,sourceDigest}'IS DISTINCT FROM rtrim(schedule_source.canonical_digest)
 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('economic_expense_policy_stale',cutoff,zone);END IF;
 SELECT count(*)::integer INTO position_count FROM public.canonical_forecast_current_backlog_booking_positions
  WHERE organization_id=org AND active;IF position_count>500 THEN RAISE EXCEPTION'Booked cohort exceeds bound'USING ERRCODE='54000';END IF;
 FOR candidate IN SELECT position_value.appointment_id,assignment.scheduled_start,assignment.scheduled_end
  FROM public.canonical_forecast_current_backlog_booking_positions position_value JOIN public.canonical_schedule_assignments assignment
   ON assignment.organization_id=position_value.organization_id AND assignment.id=position_value.assignment_id
  WHERE position_value.organization_id=org AND position_value.active AND assignment.schedule_state='scheduled'
  ORDER BY position_value.appointment_id
 LOOP
  IF candidate.scheduled_start IS NULL OR candidate.scheduled_end IS NULL OR candidate.scheduled_end<=candidate.scheduled_start
   OR candidate.scheduled_start<cutoff OR candidate.scheduled_end>horizon THEN
   RETURN public.canonical_forecast_operating_profit_v1_unavailable('approved_timing_attribution_unavailable',cutoff,zone);END IF;
  SELECT latest.*,confirmation.id confirmation_id,version.estimate_id INTO booked
  FROM(SELECT review.* FROM public.canonical_forecast_commercial_booking_reviews review WHERE review.organization_id=org
   AND review.appointment_id=candidate.appointment_id ORDER BY review.review_order DESC,review.id DESC LIMIT 1)latest
  JOIN public.canonical_forecast_booked_work_confirmations confirmation ON confirmation.organization_id=latest.organization_id AND confirmation.review_id=latest.id
  JOIN public.canonical_customer_estimate_versions version ON version.organization_id=latest.organization_id AND version.id=latest.issued_version_id
  WHERE latest.action<>'booking_cancelled';
  IF booked.confirmation_id IS NULL THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('compatible_revenue_unavailable',cutoff,zone);END IF;
  booking_state:=public.canonical_forecast_booked_work_confirmation_currentness(org,actor,role_value,session_value,booked.confirmation_id);
  IF booking_state->>'state'<>'owner_confirmed_booked_work_current'OR booking_state->'bookedWorkVerified'IS DISTINCT FROM'true'::jsonb
   OR booking_state->>'currency'IS DISTINCT FROM currency_value OR booking_state->>'priceBeforeTax'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'
  THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('compatible_revenue_unavailable',cutoff,zone);END IF;
  SELECT * INTO revision_value FROM public.canonical_estimate_revisions WHERE organization_id=org AND estimate_id=booked.estimate_id ORDER BY revision DESC,id DESC LIMIT 1;
  SELECT * INTO adoption FROM public.canonical_estimate_proposal_adoptions WHERE organization_id=org AND estimate_id=booked.estimate_id ORDER BY revision DESC,id DESC LIMIT 1;
  IF revision_value.id IS NULL OR revision_value.calculation_version<>'estimate-cost-adoption-v3'OR adoption.id IS NULL
   OR adoption.child_id<>revision_value.id OR adoption.component_manifest IS DISTINCT FROM revision_value.component_manifest
   OR adoption.material_plan_id IS DISTINCT FROM revision_value.material_plan_id OR adoption.labor_plan_id IS DISTINCT FROM revision_value.labor_plan_id
   OR adoption.equipment_cost_plan_id IS DISTINCT FROM revision_value.equipment_cost_plan_id OR adoption.travel_plan_id IS DISTINCT FROM revision_value.travel_plan_id
  THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('source_authenticated_composition_unavailable',cutoff,zone);END IF;
  basis:=public.canonical_pricing_basis(org,booked.estimate_id,NULL);
  SELECT * INTO pricing FROM public.canonical_pricing_plans WHERE organization_id=org AND estimate_id=booked.estimate_id ORDER BY revision DESC,id DESC LIMIT 1;
  IF basis->>'directCosts'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'OR basis->'componentManifest'IS DISTINCT FROM revision_value.component_manifest
   OR basis->'coverage'IS DISTINCT FROM revision_value.coverage_assessment OR pricing.id IS NULL OR pricing.id IS DISTINCT FROM adoption.pricing_plan_id
   OR pricing.action<>'save' OR pricing.result IS DISTINCT FROM adoption.reviewed_result->'price'
   OR pricing.currency<>currency_value OR pricing.inputs#>>'{overhead,source,kind}'<>'owner_estimate'
  THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('source_authenticated_composition_unavailable',cutoff,zone);END IF;
  pricing_result:=public.canonical_pricing_calculate(pricing.inputs,pricing.currency,basis);
  IF pricing_result IS DISTINCT FROM pricing.result OR pricing_result#>>'{overhead,overlapResolved}'<>'true'
   OR booking_state->>'priceBeforeTax'IS DISTINCT FROM pricing_result->>'proposedBeforeTax'
   OR pricing_result#>>'{overhead,incremental}'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'
  THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('overhead_overlap_unavailable',cutoff,zone);END IF;
  job_revenue:=(booking_state->>'priceBeforeTax')::numeric*100;job_direct:=(basis->>'directCosts')::numeric*100;
  job_overhead:=(pricing_result#>>'{overhead,incremental}')::numeric*100;
  IF job_revenue<=0 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('nonzero_revenue_denominator_unavailable',cutoff,zone);END IF;
  total_seconds:=extract(epoch FROM(candidate.scheduled_end-candidate.scheduled_start));piece_start:=candidate.scheduled_start;
  remaining_revenue:=job_revenue;remaining_direct:=job_direct;remaining_overhead:=job_overhead;
  WHILE piece_start<candidate.scheduled_end LOOP
   boundary:=(date_trunc('month',piece_start AT TIME ZONE zone)+INTERVAL'1 month')AT TIME ZONE zone;
   piece_end:=least(candidate.scheduled_end,boundary);piece_seconds:=extract(epoch FROM(piece_end-piece_start));
   IF piece_end=candidate.scheduled_end THEN piece_revenue:=remaining_revenue;piece_direct:=remaining_direct;piece_overhead:=remaining_overhead;
   ELSE piece_revenue:=round(job_revenue*piece_seconds/total_seconds);piece_direct:=round(job_direct*piece_seconds/total_seconds);
    piece_overhead:=round(job_overhead*piece_seconds/total_seconds);END IF;
   remaining_revenue:=remaining_revenue-piece_revenue;remaining_direct:=remaining_direct-piece_direct;remaining_overhead:=remaining_overhead-piece_overhead;
   month_key:=to_char(piece_start AT TIME ZONE zone,'YYYY-MM');month_value:=COALESCE(month_map->month_key,'{}'::jsonb);
   month_value:=jsonb_build_object('revenue',COALESCE((month_value->>'revenue')::numeric,0)+piece_revenue,
    'direct',COALESCE((month_value->>'direct')::numeric,0)+piece_direct,'jobOverhead',COALESCE((month_value->>'jobOverhead')::numeric,0)+piece_overhead,
    'fixed',COALESCE((month_value->>'fixed')::numeric,0),'variable',COALESCE((month_value->>'variable')::numeric,0));
   month_map:=jsonb_set(month_map,ARRAY[month_key],month_value,TRUE);piece_start:=piece_end;
  END LOOP;
  revenue_cents:=revenue_cents+job_revenue;direct_cents:=direct_cents+job_direct;job_overhead_cents:=job_overhead_cents+job_overhead;scheduled_count:=scheduled_count+1;
 END LOOP;
 IF scheduled_count<>position_count THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('approved_timing_attribution_unavailable',cutoff,zone);END IF;
 IF scheduled_count<>(labor_gate#>>'{work,scheduledCount}')::integer OR scheduled_count<>(material_gate#>>'{work,scheduledCount}')::integer
  OR scheduled_count<>(equipment_gate#>>'{work,scheduledCount}')::integer
 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('composition_cohort_mismatch',cutoff,zone);END IF;
 FOR expense IN SELECT value FROM jsonb_array_elements(policy.payload->'expenses')LOOP
  expense_start:=(expense->>'recognitionStartsOn')::date;expense_end:=(expense->>'recognitionEndsOn')::date;
  expense_cents:=(expense->>'amount')::numeric*100;total_days:=expense_end-expense_start+1;
  month_start:=date_trunc('month',greatest(expense_start,start_day)::timestamp)::date;
  WHILE month_start<=least(expense_end,end_day-1)LOOP
   month_end:=(month_start+INTERVAL'1 month')::date-1;overlap_start:=greatest(expense_start,start_day,month_start);
   overlap_end:=least(expense_end,end_day-1,month_end);IF overlap_end>=overlap_start THEN overlap_days:=overlap_end-overlap_start+1;
    piece_expense:=round(expense_cents*overlap_days/total_days);month_key:=to_char(month_start,'YYYY-MM');month_value:=COALESCE(month_map->month_key,'{}'::jsonb);
    month_value:=jsonb_build_object('revenue',COALESCE((month_value->>'revenue')::numeric,0),'direct',COALESCE((month_value->>'direct')::numeric,0),
     'jobOverhead',COALESCE((month_value->>'jobOverhead')::numeric,0),
     'fixed',COALESCE((month_value->>'fixed')::numeric,0)+CASE WHEN expense->>'classification'='fixed_period'THEN piece_expense ELSE 0 END,
     'variable',COALESCE((month_value->>'variable')::numeric,0)+CASE WHEN expense->>'classification'='variable_period'THEN piece_expense ELSE 0 END);
    month_map:=jsonb_set(month_map,ARRAY[month_key],month_value,TRUE);
    IF expense->>'classification'='fixed_period'THEN fixed_cents:=fixed_cents+piece_expense;ELSE variable_cents:=variable_cents+piece_expense;END IF;
   END IF;month_start:=(month_start+INTERVAL'1 month')::date;
  END LOOP;
 END LOOP;
 FOR bucket IN SELECT key,value FROM jsonb_each(month_map)ORDER BY key LOOP
  month_revenue:=(bucket.value->>'revenue')::numeric;month_direct:=(bucket.value->>'direct')::numeric;
  month_job_overhead:=(bucket.value->>'jobOverhead')::numeric;month_fixed:=(bucket.value->>'fixed')::numeric;month_variable:=(bucket.value->>'variable')::numeric;
  month_cost:=month_direct+month_job_overhead+month_fixed+month_variable;scenario_values:='[]'::jsonb;profit_min:=NULL;profit_max:=NULL;margin_min:=NULL;margin_max:=NULL;
  IF month_revenue<=0 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('nonzero_revenue_denominator_unavailable',cutoff,zone);END IF;
  FOR scenario IN SELECT value FROM jsonb_array_elements(policy.payload->'scenarios')ORDER BY value->>'operatingCostBasisPoints',value->>'key'LOOP
   scenario_cost:=round(month_cost*(scenario->>'operatingCostBasisPoints')::numeric/10000);scenario_profit:=month_revenue-scenario_cost;
   scenario_values:=scenario_values||jsonb_build_array(jsonb_build_object('key',scenario->>'key','label',scenario->>'label',
    'operatingCost',public.canonical_pricing_decimal(scenario_cost),'profit',public.canonical_forecast_signed_money(scenario_profit),
    'margin',public.canonical_forecast_margin(scenario_profit,month_revenue),'assumption',jsonb_build_object('operatingCostBasisPoints',(scenario->>'operatingCostBasisPoints')::integer,'reason',scenario->>'reason')));
   profit_min:=least(COALESCE(profit_min,scenario_profit),scenario_profit);profit_max:=greatest(COALESCE(profit_max,scenario_profit),scenario_profit);
   margin_min:=least(COALESCE(margin_min,scenario_profit*10000/month_revenue),scenario_profit*10000/month_revenue);
   margin_max:=greatest(COALESCE(margin_max,scenario_profit*10000/month_revenue),scenario_profit*10000/month_revenue);
  END LOOP;
  months:=months||jsonb_build_array(jsonb_build_object('month',bucket.key,'revenue',public.canonical_pricing_decimal(month_revenue),
   'directJobCost',public.canonical_pricing_decimal(month_direct),'incrementalJobOverhead',public.canonical_pricing_decimal(month_job_overhead),
   'fixedPeriodExpense',public.canonical_pricing_decimal(month_fixed),'variablePeriodExpense',public.canonical_pricing_decimal(month_variable),
   'operatingCost',public.canonical_pricing_decimal(month_cost),'profitLow',public.canonical_forecast_signed_money(profit_min),
   'profitHigh',public.canonical_forecast_signed_money(profit_max),'marginLow',to_char(round(margin_min)/100,'FM999999990.00'),
   'marginHigh',to_char(round(margin_max)/100,'FM999999990.00'),'scenarios',scenario_values));
 END LOOP;
 operating_cost:=direct_cents+job_overhead_cents+fixed_cents+variable_cents;profit_min:=NULL;profit_max:=NULL;margin_min:=NULL;margin_max:=NULL;
 IF revenue_cents<=0 THEN RETURN public.canonical_forecast_operating_profit_v1_unavailable('nonzero_revenue_denominator_unavailable',cutoff,zone);END IF;
 FOR scenario IN SELECT value FROM jsonb_array_elements(policy.payload->'scenarios')ORDER BY value->>'operatingCostBasisPoints',value->>'key'LOOP
  scenario_cost:=round(operating_cost*(scenario->>'operatingCostBasisPoints')::numeric/10000);profit_value:=revenue_cents-scenario_cost;
  all_scenarios:=all_scenarios||jsonb_build_array(jsonb_build_object('key',scenario->>'key','label',scenario->>'label',
   'operatingCost',public.canonical_pricing_decimal(scenario_cost),'profit',public.canonical_forecast_signed_money(profit_value),
   'margin',public.canonical_forecast_margin(profit_value,revenue_cents),'assumption',jsonb_build_object('operatingCostBasisPoints',(scenario->>'operatingCostBasisPoints')::integer,'reason',scenario->>'reason')));
  profit_min:=least(COALESCE(profit_min,profit_value),profit_value);profit_max:=greatest(COALESCE(profit_max,profit_value),profit_value);
 margin_min:=least(COALESCE(margin_min,profit_value*10000/revenue_cents),profit_value*10000/revenue_cents);
 margin_max:=greatest(COALESCE(margin_max,profit_value*10000/revenue_cents),profit_value*10000/revenue_cents);
 END LOOP;
 run_payload:=jsonb_build_object('version','m26-operating-profit-calculation-v1','checkedAt',public.canonical_forecast_utc_instant(cutoff),
  'policyRevision',policy.revision,'policyDigest',rtrim(policy.canonical_digest),'scheduleRevision',schedule_source.revision,
  'scheduleDigest',rtrim(schedule_source.canonical_digest),'months',months,'scenarios',all_scenarios);run_digest:=public.canonical_completion_digest(run_payload);
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('version','m26-operating-profit-forecast-v1','state','current','reason',NULL,'fictional',FALSE,
  'checkedAt',public.canonical_forecast_utc_instant(cutoff),'currency',currency_value,
  'horizon',jsonb_build_object('kind','next_30_elapsed_days_with_local_expense_dates','timeZone',zone,
   'startsAt',public.canonical_forecast_utc_instant(cutoff),'endsAt',public.canonical_forecast_utc_instant(horizon),
   'startsOn',start_day::text,'endsOnExclusive',end_day::text),
  'scope',jsonb_build_object('label','Authenticated owner-confirmed scheduled backlog and recorded company operating expenses',
   'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'kpis',jsonb_build_object('operatingCost',public.canonical_pricing_decimal(operating_cost),'profitLow',public.canonical_forecast_signed_money(profit_min),
   'profitHigh',public.canonical_forecast_signed_money(profit_max),'marginLow',to_char(round(margin_min)/100,'FM999999990.00'),
   'marginHigh',to_char(round(margin_max)/100,'FM999999990.00')),
  'months',months,'revenue',jsonb_build_object('target','approved_booked_price_before_tax','amount',public.canonical_pricing_decimal(revenue_cents),
   'recognizedRevenueMeasured',FALSE,'earnedRevenueMeasured',FALSE,'invoicedRevenueMeasured',FALSE,'collectedCashMeasured',FALSE),
  'costs',jsonb_build_object('directJobCost',public.canonical_pricing_decimal(direct_cents),'incrementalJobOverhead',public.canonical_pricing_decimal(job_overhead_cents),
   'fixedPeriodExpense',public.canonical_pricing_decimal(fixed_cents),'variablePeriodExpense',public.canonical_pricing_decimal(variable_cents),
   'operatingCost',public.canonical_pricing_decimal(operating_cost),'datedCashObligations',public.canonical_pricing_decimal(
    ((cash_gate#>>'{overhead,amount}')::numeric+(cash_gate#>>'{financedAssetCash,amount}')::numeric)*100),'actualPaymentMeasured',FALSE),
  'range',jsonb_build_object('kind','deterministic_named_scenarios','scenarios',all_scenarios,'calibrated',FALSE,'probability',FALSE),
  'evidence',jsonb_build_object('sourceAuthenticatedComposition',TRUE,'componentQuantitiesAndCostsVerified',TRUE,'duplicatePreventionVerified',TRUE,
   'approvedScheduleTiming',TRUE,'overlapReviewed',TRUE,'expenseCoverageVerified',TRUE,'currentnessVerified',TRUE,'m25AdjustmentApplied',FALSE,
   'externalEventClassified',FALSE,'scopeChangeClassified',FALSE),
  'run',jsonb_build_object('calculationVersion','m26-operating-profit-calculation-v1','digest',run_digest),
  'forecastIssued',TRUE,'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_operating_profit_policy_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_profit_policy_immutable()FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_profit_policy_valid(JSONB)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_profit_policy_projection(public.canonical_operating_profit_policy_revisions)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_profit_policy_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,JSONB)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_profit_policy_read(UUID,UUID,TEXT,UUID,TIMESTAMPTZ)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_signed_money(NUMERIC)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_margin(NUMERIC,NUMERIC)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_operating_profit_v1_unavailable(TEXT,TIMESTAMPTZ,TEXT)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_operating_profit_v1_current(UUID,UUID,TEXT,UUID)FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN IF runtime_role IS NOT NULL AND runtime_role<>''THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_operating_profit_policy_mutate(uuid,uuid,text,uuid,text,text,jsonb) TO %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_operating_profit_policy_read(uuid,uuid,text,uuid,timestamptz) TO %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_operating_profit_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
END IF;END $$;
