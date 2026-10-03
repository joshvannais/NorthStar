-- Mission 26 Part 4C: purpose-fixed demand-to-schedule research authority.
-- The three products below stay separate: a current backlog fact, a Retell-only
-- seasonal research origin, and a same-population first-booking count origin.
-- No function in this migration issues a production forecast or takes action.

CREATE TABLE public.canonical_forecast_demand_schedule_epochs_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose IN ('seasonal_inbound','pipeline_first_booking')),
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 installed_at TIMESTAMPTZ NOT NULL,
 profile_anchor_id UUID NOT NULL,
 profile_activation_at TIMESTAMPTZ NOT NULL,
 profile_source_order BIGINT NOT NULL CHECK(profile_source_order>=0),
 business_profile_id UUID NOT NULL,
 business_profile_version BIGINT NOT NULL CHECK(business_profile_version>0),
 business_profile_hash CHAR(64) NOT NULL CHECK(business_profile_hash~'^[0-9a-f]{64}$'),
 time_zone TEXT NOT NULL,
 consent_id UUID,
 consent_digest CHAR(64),
 consent_activated_at TIMESTAMPTZ,
 integration_ownership_id UUID,
 integration_agent_id TEXT,
 integration_activated_at TIMESTAMPTZ,
 integration_updated_at TIMESTAMPTZ,
 source_generation JSONB NOT NULL CHECK(jsonb_typeof(source_generation)='object' AND octet_length(source_generation::text)<=16384),
 epoch_digest CHAR(64) NOT NULL CHECK(epoch_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,purpose,id),
 UNIQUE(organization_id,purpose,revision),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,profile_anchor_id)
  REFERENCES public.canonical_forecast_profile_effective_anchors(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_demand_schedule_epochs_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((purpose='seasonal_inbound' AND consent_id IS NOT NULL AND consent_digest IS NOT NULL
   AND consent_activated_at IS NOT NULL AND integration_ownership_id IS NOT NULL
   AND integration_agent_id IS NOT NULL AND integration_activated_at IS NOT NULL
   AND integration_updated_at IS NOT NULL) OR
  (purpose='pipeline_first_booking' AND consent_id IS NULL AND consent_digest IS NULL
   AND consent_activated_at IS NULL AND integration_ownership_id IS NULL
   AND integration_agent_id IS NULL AND integration_activated_at IS NULL
   AND integration_updated_at IS NULL))
);

CREATE TABLE public.canonical_forecast_demand_schedule_methods_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 purpose TEXT NOT NULL UNIQUE CHECK(purpose IN ('seasonal_inbound','pipeline_first_booking')),
 target_key TEXT NOT NULL,
 target_version TEXT NOT NULL,
 calculation_version TEXT NOT NULL,
 definition JSONB NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=32768),
 method_digest CHAR(64) NOT NULL CHECK(method_digest~'^[0-9a-f]{64}$')
);

INSERT INTO public.canonical_forecast_demand_schedule_methods_v1(
 purpose,target_key,target_version,calculation_version,definition,method_digest)
SELECT value->>'purpose',value->>'targetKey','v1',value->>'calculationVersion',value,
 public.canonical_completion_digest(value)
FROM jsonb_array_elements(jsonb_build_array(
 jsonb_build_object('purpose','seasonal_inbound','targetKey','demand.inbound_leads',
  'calculationVersion','m26-seasonal-two-cycle-open-minute-v1','trainingMonths',24,
  'recordingCloseLagDays',7,'horizon','next_tenant_local_month','scope','retell_only_tenant_all',
  'rule','two annual cycles must repeat above, below, or exact-neutral direction'),
 jsonb_build_object('purpose','pipeline_first_booking',
  'targetKey','demand.pipeline_first_accepted_bookings','calculationVersion','m26-pipeline-first-booking-pooled-v1',
  'trainingWindows',2,'trainingWindowElapsedDays',30,'horizonElapsedDays',30,
  'unit','first_accepted_bookings','upperBoundary','exclusive','scope','northstar_eligible_unbooked_opportunities'))
) value;

CREATE TABLE public.canonical_forecast_demand_schedule_method_reviews_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 purpose TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID,
 method_id UUID NOT NULL REFERENCES public.canonical_forecast_demand_schedule_methods_v1(id) ON DELETE RESTRICT,
 method_digest CHAR(64) NOT NULL CHECK(method_digest~'^[0-9a-f]{64}$'),
 action TEXT NOT NULL CHECK(action IN ('approve','reject')),
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000 AND octet_length(reason)<=4000),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 review_digest CHAR(64) NOT NULL CHECK(review_digest~'^[0-9a-f]{64}$'),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,purpose,id),
 UNIQUE(organization_id,purpose,revision),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,previous_id)
  REFERENCES public.canonical_forecast_demand_schedule_method_reviews_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_forecast_demand_schedule_backlog_facts_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 backlog_snapshot_id UUID NOT NULL,
 backlog_snapshot_digest CHAR(64) NOT NULL CHECK(backlog_snapshot_digest~'^[0-9a-f]{64}$'),
 backlog_source_digest CHAR(64) NOT NULL CHECK(backlog_source_digest~'^[0-9a-f]{64}$'),
 fact JSONB NOT NULL CHECK(jsonb_typeof(fact)='object' AND octet_length(fact::text)<=32768),
 fact_digest CHAR(64) NOT NULL CHECK(fact_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,backlog_snapshot_id)
  REFERENCES public.canonical_forecast_current_backlog_snapshots(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_forecast_seasonal_origins_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 as_of TIMESTAMPTZ NOT NULL,local_horizon_start DATE NOT NULL,
 horizon_starts_at TIMESTAMPTZ NOT NULL,horizon_ends_at TIMESTAMPTZ NOT NULL,
 epoch_id UUID NOT NULL,method_review_id UUID NOT NULL,
 evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=262144),
 evidence_digest CHAR(64) NOT NULL CHECK(evidence_digest~'^[0-9a-f]{64}$'),
 private_output JSONB NOT NULL CHECK(jsonb_typeof(private_output)='object' AND octet_length(private_output::text)<=16384),
 output_digest CHAR(64) NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_forecast_seasonal_evaluations_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 origin_id UUID NOT NULL,revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 outcome_evidence JSONB NOT NULL CHECK(jsonb_typeof(outcome_evidence)='object' AND octet_length(outcome_evidence::text)<=262144),
 outcome_digest CHAR(64) NOT NULL CHECK(outcome_digest~'^[0-9a-f]{64}$'),
 private_metrics JSONB NOT NULL CHECK(jsonb_typeof(private_metrics)='object' AND octet_length(private_metrics::text)<=16384),
 metrics_digest CHAR(64) NOT NULL CHECK(metrics_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 evaluated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,origin_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_seasonal_origins_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_seasonal_evaluations_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_forecast_pipeline_origins_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 as_of TIMESTAMPTZ NOT NULL,prediction_cutoff_at TIMESTAMPTZ NOT NULL,horizon_ends_at TIMESTAMPTZ NOT NULL,
 epoch_id UUID NOT NULL,method_review_id UUID NOT NULL,
 evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=262144),
 evidence_digest CHAR(64) NOT NULL CHECK(evidence_digest~'^[0-9a-f]{64}$'),
 private_output JSONB NOT NULL CHECK(jsonb_typeof(private_output)='object' AND octet_length(private_output::text)<=16384),
 output_digest CHAR(64) NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.canonical_forecast_pipeline_evaluations_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 origin_id UUID NOT NULL,revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 outcome_evidence JSONB NOT NULL CHECK(jsonb_typeof(outcome_evidence)='object' AND octet_length(outcome_evidence::text)<=262144),
 outcome_digest CHAR(64) NOT NULL CHECK(outcome_digest~'^[0-9a-f]{64}$'),
 private_metrics JSONB NOT NULL CHECK(jsonb_typeof(private_metrics)='object' AND octet_length(private_metrics::text)<=16384),
 metrics_digest CHAR(64) NOT NULL CHECK(metrics_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 evaluated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),canonical_digest CHAR(64) NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,origin_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_pipeline_origins_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_pipeline_evaluations_v1(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

-- Prospective source visibility owned by this slice. These tables intentionally
-- start empty at installation; triggers observe only source rows committed after
-- migration 222. Historical migration 206 activations are never backfilled.
CREATE TABLE public.canonical_forecast_pipeline_eligibility_visibility_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_event_id UUID NOT NULL,source_order BIGINT NOT NULL,operation_id UUID NOT NULL,
 opportunity_id UUID NOT NULL,source_visible_at TIMESTAMPTZ NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,source_digest CHAR(64) NOT NULL,
 observation_digest CHAR(64) NOT NULL CHECK(observation_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,source_event_id),UNIQUE(organization_id,source_order),
 UNIQUE(organization_id,opportunity_id)
);
CREATE INDEX canonical_forecast_pipeline_eligibility_visibility_v1_window
 ON public.canonical_forecast_pipeline_eligibility_visibility_v1(
  organization_id,observed_at,source_order);

CREATE TABLE public.canonical_forecast_pipeline_booking_visibility_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_event_id UUID NOT NULL,source_order BIGINT NOT NULL,opportunity_id UUID NOT NULL,
 assignment_id UUID NOT NULL,appointment_id UUID NOT NULL,source_occurred_at TIMESTAMPTZ NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,source_digest CHAR(64) NOT NULL,
 observation_digest CHAR(64) NOT NULL CHECK(observation_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,source_event_id),UNIQUE(organization_id,source_order)
);
CREATE INDEX canonical_forecast_pipeline_booking_visibility_v1_window
 ON public.canonical_forecast_pipeline_booking_visibility_v1(
  organization_id,opportunity_id,observed_at,source_order);
CREATE INDEX canonical_forecast_pipeline_booking_visibility_v1_occurrence
 ON public.canonical_forecast_pipeline_booking_visibility_v1(
  organization_id,opportunity_id,source_occurred_at,source_order);

CREATE TABLE public.canonical_forecast_seasonal_certification_visibility_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 certification_id UUID NOT NULL,local_month_start DATE NOT NULL,revision INTEGER NOT NULL,
 action TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL,certification_digest CHAR(64) NOT NULL,
 observation_digest CHAR(64) NOT NULL CHECK(observation_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,certification_id),
 UNIQUE(organization_id,local_month_start,revision)
);

-- Prospective observation of the exact Retell call population is separate from
-- an immutable month snapshot.  This closes the late-arrival boundary: a call
-- that is canonically recorded after a snapshot but occurred inside that month
-- changes the month generation, while calls outside the pinned month do not.
CREATE SEQUENCE public.canonical_forecast_seasonal_call_visibility_order_v1;
CREATE TABLE public.canonical_forecast_seasonal_call_visibility_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_order BIGINT NOT NULL DEFAULT nextval(
  'public.canonical_forecast_seasonal_call_visibility_order_v1'),
 operation_id UUID NOT NULL,transcript_id UUID NOT NULL,opportunity_id UUID NOT NULL,
 source_occurred_at TIMESTAMPTZ NOT NULL,source_recorded_at TIMESTAMPTZ NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL,source_digest CHAR(64) NOT NULL
  CHECK(source_digest~'^[0-9a-f]{64}$'),
 observation_digest CHAR(64) NOT NULL CHECK(observation_digest~'^[0-9a-f]{64}$'),
 PRIMARY KEY(organization_id,transcript_id),UNIQUE(source_order),
 UNIQUE(organization_id,operation_id)
);
CREATE INDEX canonical_forecast_seasonal_call_visibility_v1_window
 ON public.canonical_forecast_seasonal_call_visibility_v1(
  organization_id,source_occurred_at,source_order);

-- This owner-only disposable-database clock is never granted to the runtime.
-- Production leaves the singleton empty and therefore uses clock_timestamp().
CREATE TABLE public.canonical_forecast_demand_schedule_test_clock_v1 (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 instant TIMESTAMPTZ NOT NULL
);
CREATE TABLE public.canonical_forecast_demand_schedule_source_test_clock_v1 (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 instant TIMESTAMPTZ NOT NULL
);

CREATE TRIGGER canonical_forecast_demand_schedule_epochs_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_demand_schedule_epochs_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_demand_schedule_methods_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_demand_schedule_methods_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_demand_schedule_method_reviews_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_demand_schedule_method_reviews_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_demand_schedule_backlog_facts_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_demand_schedule_backlog_facts_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_seasonal_origins_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_seasonal_origins_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_seasonal_evaluations_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_seasonal_evaluations_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_pipeline_origins_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_pipeline_origins_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_pipeline_evaluations_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_pipeline_evaluations_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_pipeline_eligibility_visibility_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_pipeline_eligibility_visibility_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_pipeline_booking_visibility_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_pipeline_booking_visibility_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_seasonal_certification_visibility_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_seasonal_certification_visibility_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();
CREATE TRIGGER canonical_forecast_seasonal_call_visibility_v1_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_seasonal_call_visibility_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_transition_v2_immutable();

CREATE FUNCTION public.canonical_forecast_demand_schedule_clock_v1()
RETURNS TIMESTAMPTZ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
AS $$ SELECT COALESCE((SELECT instant FROM public.canonical_forecast_demand_schedule_test_clock_v1
                       WHERE singleton),clock_timestamp()) $$;

CREATE FUNCTION public.canonical_forecast_demand_schedule_test_clock_v1_set(value TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior TIMESTAMPTZ;
BEGIN
 IF current_setting('northstar.m26_part4c_disposable_clock',TRUE) IS DISTINCT FROM 'enabled' OR
    NOT pg_has_role(session_user,'pg_database_owner','MEMBER') OR value IS NULL THEN
  RAISE EXCEPTION 'Disposable Part 4C clock is restricted' USING ERRCODE='42501';END IF;
 SELECT instant INTO prior FROM public.canonical_forecast_demand_schedule_test_clock_v1 WHERE singleton;
 IF prior IS NOT NULL AND value<prior THEN
  RAISE EXCEPTION 'Disposable Part 4C clock cannot move backward' USING ERRCODE='22023';END IF;
 INSERT INTO public.canonical_forecast_demand_schedule_test_clock_v1(singleton,instant)
 VALUES(TRUE,value) ON CONFLICT(singleton) DO UPDATE SET instant=EXCLUDED.instant;
END $$;

CREATE FUNCTION public.canonical_forecast_demand_schedule_source_test_clock_v1_set(value TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_setting('northstar.m26_part4c_disposable_clock',TRUE) IS DISTINCT FROM 'enabled' OR
    NOT pg_has_role(session_user,'pg_database_owner','MEMBER') THEN
  RAISE EXCEPTION 'Disposable Part 4C source clock is restricted' USING ERRCODE='42501';END IF;
 IF value IS NULL THEN
  DELETE FROM public.canonical_forecast_demand_schedule_source_test_clock_v1 WHERE singleton;
  RETURN;
 END IF;
 INSERT INTO public.canonical_forecast_demand_schedule_source_test_clock_v1(singleton,instant)
 VALUES(TRUE,value) ON CONFLICT(singleton) DO UPDATE SET instant=EXCLUDED.instant;
END $$;

-- The disposable clock must reach the authoritative timestamps used by the
-- genuine migration 206 eligibility and migration 203 booking writers. These
-- triggers change only those source timestamps while the owner-created test
-- clock singleton exists. Production leaves it empty, so the old writers keep
-- their supplied wall-clock values and all other source semantics unchanged.
CREATE FUNCTION public.canonical_forecast_demand_schedule_source_clock_v1_apply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE test_instant TIMESTAMPTZ;
BEGIN
 SELECT COALESCE(
  (SELECT instant FROM public.canonical_forecast_demand_schedule_source_test_clock_v1
   WHERE singleton),
  (SELECT instant FROM public.canonical_forecast_demand_schedule_test_clock_v1
   WHERE singleton)) INTO test_instant;
 IF test_instant IS NULL THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='canonical_operations' THEN
  IF OLD.state IS DISTINCT FROM 'completed' AND NEW.state='completed' THEN
   NEW.completed_at:=test_instant;
  END IF;
 ELSE
  NEW.approved_at:=test_instant;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER b_canonical_forecast_demand_schedule_operation_test_clock_v1
 BEFORE UPDATE OF state ON public.canonical_operations
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_demand_schedule_source_clock_v1_apply();
CREATE TRIGGER canonical_forecast_demand_schedule_approval_test_clock_v1
 BEFORE INSERT ON public.canonical_schedule_approvals
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_demand_schedule_source_clock_v1_apply();
CREATE TRIGGER canonical_forecast_demand_schedule_human_approval_test_clock_v1
 BEFORE INSERT ON public.canonical_schedule_human_approvals
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_demand_schedule_source_clock_v1_apply();

-- Part 4C clock-aware migration 220 adapters preserve production behavior while allowing
-- the guarded disposable owner clock to prove a genuinely prospective lifecycle.
-- The profile applicability readers and month attestation writer also use this clock only
-- when the database owner has explicitly enabled the disposable-test GUC. In production
-- the helper continues to return clock_timestamp(), preserving migrations 151/169/220.
CREATE OR REPLACE FUNCTION public.canonical_forecast_profile_month_attestation_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 month_value DATE,action_value TEXT,profile_value UUID,profile_hash_value TEXT,
 expected_revision INTEGER,expected_digest TEXT,reason_value TEXT,
 confirmed_value BOOLEAN,confirmation_version TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; old public.canonical_forecast_profile_month_attestations%ROWTYPE;
 current_row public.canonical_forecast_profile_month_attestations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
 inserted public.canonical_forecast_profile_month_attestations%ROWTYPE;
 key_hash TEXT; body_hash TEXT; current_local_date DATE; month_end DATE;
 raw_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast calendar access restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    month_value IS NULL OR month_value<DATE '2000-01-01' OR
    month_value>=DATE '2100-12-01' OR extract(day FROM month_value)<>1 OR
    action_value IS NULL OR action_value NOT IN ('confirm','revoke') OR
    profile_value IS NULL OR profile_hash_value IS NULL OR
    profile_hash_value!~'^[0-9a-f]{64}$' OR
    expected_revision IS NULL OR expected_revision<0 OR expected_revision>=1000 OR
    (expected_revision=0 AND expected_digest IS NOT NULL) OR
    (expected_revision>0 AND (expected_digest IS NULL OR expected_digest!~'^[0-9a-f]{64}$')) OR
    reason_value IS NULL OR length(btrim(reason_value)) NOT BETWEEN 1 AND 1000 OR
    octet_length(reason_value)>4000 OR confirmed_value IS DISTINCT FROM TRUE OR
    confirmation_version IS DISTINCT FROM 'forecast-calendar-review-v1' THEN
  RAISE EXCEPTION 'Forecast calendar request invalid' USING ERRCODE='22023';END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 body_hash:=public.canonical_completion_digest(jsonb_build_object(
  'month',month_value,'action',action_value,'profile',profile_value,
  'profileHash',profile_hash_value,'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'reason',btrim(reason_value),
  'confirmed',confirmed_value,'confirmationVersion',confirmation_version));
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:profile-month:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Forecast calendar busy' USING ERRCODE='55P03';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO old FROM public.canonical_forecast_profile_month_attestations
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>body_hash THEN
   RAISE EXCEPTION 'Forecast calendar request key conflict' USING ERRCODE='23505';END IF;
  SELECT * INTO profile_row FROM public.canonical_business_profiles
   WHERE organization_id=org AND id=old.business_profile_id;
  RETURN jsonb_build_object('id',old.id,'revision',old.revision,
   'digest',rtrim(old.digest),'action',old.action,'replayed',TRUE,
   'profilePinVerified',old.action='confirm' AND profile_row.id IS NOT NULL AND
     profile_row.version_number=old.business_profile_version AND
     rtrim(profile_row.normalized_profile_hash)=rtrim(old.business_profile_hash) AND
     public.canonical_completion_digest(profile_row.raw_profile)=rtrim(old.raw_profile_digest));
 END IF;
 SELECT * INTO current_row FROM public.canonical_forecast_profile_month_attestations
  WHERE organization_id=org AND local_start_date=month_value
  ORDER BY revision DESC LIMIT 1;
 IF COALESCE(current_row.revision,0)<>expected_revision OR
    (expected_revision>0 AND rtrim(current_row.digest)<>expected_digest) OR
    (action_value='revoke' AND (current_row.id IS NULL OR current_row.action='revoke')) THEN
  RAISE EXCEPTION 'Forecast calendar changed' USING ERRCODE='40001';END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=profile_value FOR SHARE;
 IF profile_row.id IS NULL OR
    (action_value='confirm' AND
      rtrim(profile_row.normalized_profile_hash)<>profile_hash_value) OR
    (action_value='revoke' AND (current_row.business_profile_id<>profile_value OR
      rtrim(current_row.business_profile_hash)<>profile_hash_value)) THEN
  RAISE EXCEPTION 'Business Profile changed' USING ERRCODE='40001';END IF;
 IF action_value='confirm' THEN
  IF profile_row.calendar_authority IS DISTINCT FROM jsonb_build_object(
       'hours',profile_row.raw_profile->'hours',
       'timeZone',profile_row.raw_profile#>'{company,timeZone}') THEN
   RAISE EXCEPTION 'Business Profile calendar authority changed' USING ERRCODE='40001';END IF;
  IF profile_row.raw_profile->'company'->>'timeZone' IS NULL OR
     NOT EXISTS(SELECT 1 FROM pg_timezone_names
       WHERE name=profile_row.raw_profile->'company'->>'timeZone') THEN
   RAISE EXCEPTION 'Business time zone unavailable' USING ERRCODE='22023';END IF;
  month_end:=(month_value+INTERVAL '1 month')::date;
  current_local_date:=(public.canonical_forecast_demand_schedule_clock_v1() AT TIME ZONE
    (profile_row.raw_profile->'company'->>'timeZone'))::date;
  IF current_local_date IS NULL OR month_end>current_local_date THEN
   RAISE EXCEPTION 'The local month is not complete' USING ERRCODE='22023';END IF;
 END IF;
 raw_digest:=CASE WHEN action_value='revoke' THEN rtrim(current_row.raw_profile_digest)
  ELSE public.canonical_completion_digest(profile_row.raw_profile) END;
 INSERT INTO public.canonical_forecast_profile_month_attestations(
  organization_id,local_start_date,revision,previous_id,action,
  business_profile_id,business_profile_version,business_profile_hash,raw_profile_digest,
  actor_user_id,membership_id,auth_session_id,reason,digest,
  request_key_hash,request_digest)
 VALUES(org,month_value,expected_revision+1,current_row.id,action_value,
  profile_row.id,CASE WHEN action_value='revoke' THEN current_row.business_profile_version
    ELSE profile_row.version_number END,profile_hash_value,raw_digest,
  actor,(authority->>'membershipId')::uuid,session_value,btrim(reason_value),
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,
   'localStartDate',month_value,'revision',expected_revision+1,
   'previousDigest',expected_digest,'action',action_value,
   'businessProfileId',profile_row.id,'businessProfileVersion',
   CASE WHEN action_value='revoke' THEN current_row.business_profile_version
    ELSE profile_row.version_number END,
   'businessProfileHash',profile_hash_value,'rawProfileDigest',raw_digest,
   'actorUserId',actor,
   'reason',btrim(reason_value))),key_hash,body_hash)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('id',inserted.id,'revision',inserted.revision,
  'digest',rtrim(inserted.digest),'action',inserted.action,'replayed',FALSE,
  'profilePinVerified',action_value='confirm');
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_profile_effective_window(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 anchor_value UUID,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 activation public.canonical_forecast_profile_effective_activations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Forecast profile window requires READ COMMITTED' USING ERRCODE='25001';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org::text,0)) THEN
  RAISE EXCEPTION 'Forecast profile source busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 SELECT * INTO activation FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 IF anchor_row.id IS NULL OR activation.anchor_id IS NULL OR starts_at IS NULL OR
    ends_at IS NULL OR starts_at>=ends_at OR activation.observed_at>=starts_at OR
    ends_at>public.canonical_forecast_demand_schedule_clock_v1() THEN
  RETURN jsonb_build_object('state','profile_effective_window_unavailable',
   'reason','prospective_elapsed_period_unverified','historicalCalendarVerified',FALSE,'forecastIssued',FALSE);END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=anchor_row.business_profile_id;
 IF profile_row.id IS NULL OR profile_row.version_number<>anchor_row.business_profile_version OR
    profile_row.normalized_profile_hash<>anchor_row.business_profile_hash OR
    public.canonical_completion_digest(profile_row.raw_profile)<>anchor_row.raw_profile_digest OR
    EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events event
     WHERE event.organization_id=org AND event.source_order>anchor_row.source_order
      AND event.observed_at<ends_at LIMIT 1) THEN
  RETURN jsonb_build_object('state','profile_effective_window_unavailable',
   'reason','profile_changed_during_period','historicalCalendarVerified',FALSE,'forecastIssued',FALSE);END IF;
 RETURN jsonb_build_object('state','profile_effective_window_verified',
  'anchorId',anchor_value,'businessProfileId',anchor_row.business_profile_id,
  'businessProfileVersion',anchor_row.business_profile_version,
  'businessProfileHash',rtrim(anchor_row.business_profile_hash),
  'startsAt',public.canonical_forecast_utc_instant(starts_at),
  'endsAt',public.canonical_forecast_utc_instant(ends_at),
  'scope','prospective_northstar_business_profile','historicalCalendarVerified',TRUE,
  'observationCoverageVerified',FALSE,'forecastIssued',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_period_evidence_v2(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 snapshot_value UUID,month_value DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot JSONB;reviews JSONB;profile JSONB;profile_raw JSONB;
 zone TEXT;starts_at TIMESTAMPTZ;ends_at TIMESTAMPTZ;
 sources JSONB;review_items JSONB;source_item JSONB;review_item JSONB;
 lead_count INTEGER;source_manifest_digest TEXT;review_manifest_digest TEXT;
 active_count INTEGER;integration_ownership_id UUID;agent_id TEXT;scan_inputs JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR snapshot_value IS NULL OR
    month_value IS NULL OR extract(day FROM month_value)<>1 OR
    month_value<DATE '2000-01-01' OR month_value>=DATE '2100-12-01' THEN
  RAISE EXCEPTION 'Retell period evidence request invalid' USING ERRCODE='22023';
 END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,NULL,FALSE);
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Retell period evidence access restricted' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:retell-period-v2:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Retell period evidence busy' USING ERRCODE='55P03';
 END IF;
 profile:=public.canonical_forecast_profile_month_guarded_source(
  org,actor,role_value,session_value,month_value);
 IF profile->>'state'<>'owner_claim_only' THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','profile_month_unavailable');
 END IF;
 profile_raw:=profile->'rawProfile'; zone:=profile_raw#>>'{company,timeZone}';
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','profile_time_zone_unavailable');
 END IF;
 starts_at:=month_value::timestamp AT TIME ZONE zone;
 ends_at:=(month_value+INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 IF ends_at>public.canonical_forecast_demand_schedule_clock_v1() THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','period_not_complete');
 END IF;
 snapshot:=public.canonical_forecast_retell_call_snapshot_read(
  org,actor,role_value,session_value,snapshot_value);
 reviews:=public.canonical_forecast_retell_call_reviews_read(
  org,actor,role_value,session_value,snapshot_value);
 IF snapshot IS NULL OR snapshot->>'stale' IS DISTINCT FROM 'false' OR
     reviews IS NULL OR reviews->>'stale' IS DISTINCT FROM 'false' THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','source_unavailable');
 END IF;
 IF snapshot->>'windowVersion' IS DISTINCT FROM 'm26-retell-period-source-window-v2' OR
    snapshot->>'localMonthStart' IS DISTINCT FROM month_value::text OR
    snapshot->>'sourceWindowStartsAt' IS DISTINCT FROM
      public.canonical_forecast_utc_instant(starts_at) OR
    snapshot->>'sourceWindowEndsAt' IS DISTINCT FROM
      public.canonical_forecast_utc_instant(ends_at) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','period_snapshot_window_mismatch');
 END IF;
 IF (snapshot->>'capturedAt')::timestamptz<ends_at THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','source_cutoff_too_early');
 END IF;
 SELECT count(*),min(id::text)::uuid,min(external_integration_id)
 INTO active_count,integration_ownership_id,agent_id
 FROM public.canonical_integration_ownership
 WHERE organization_id=org AND provider='retell' AND status='active';
 IF active_count<>1 OR integration_ownership_id IS NULL OR agent_id IS NULL THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','integration_ownership_unavailable');
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'sources') item
   WHERE item->>'eventAt' IS NULL) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','unknown_call_occurrence');
 END IF;
 SELECT COALESCE(jsonb_agg(item ORDER BY item->>'sourceId'),'[]'::jsonb)
 INTO sources FROM jsonb_array_elements(snapshot->'sources') item
 WHERE (item->>'eventAt')::timestamptz>=starts_at
   AND (item->>'eventAt')::timestamptz<ends_at;
 IF jsonb_array_length(sources)>1000 THEN
  RETURN jsonb_build_object('state','retell_period_unavailable','reason','period_limit_exceeded');
 END IF;
 scan_inputs:=public.canonical_forecast_retell_scan_inputs_read(
  org,actor,role_value,session_value,snapshot_value,starts_at,ends_at);
 IF scan_inputs->>'state' IS DISTINCT FROM 'ready_for_diagnostic' OR
    scan_inputs->>'agentId' IS DISTINCT FROM agent_id OR
    scan_inputs->>'sourceSnapshotDigest' IS DISTINCT FROM snapshot->>'sourceSnapshotDigest' OR
    jsonb_array_length(scan_inputs->'canonicalCallDigests')<>jsonb_array_length(sources) THEN
  RETURN jsonb_build_object('state','retell_period_unavailable',
   'reason','provider_scan_identity_unavailable');
 END IF;
 review_items:='[]'::jsonb;
 FOR source_item IN SELECT value FROM jsonb_array_elements(sources) value LOOP
  SELECT value INTO review_item FROM jsonb_array_elements(reviews->'calls') value
   WHERE value->>'callSourceId'=source_item->>'sourceId';
  IF review_item IS NULL OR review_item->>'status'<>'reviewed' OR
     review_item->>'reviewDigest' IS NULL OR review_item->>'reviewedAt' IS NULL THEN
   RETURN jsonb_build_object('state','retell_period_unavailable',
    'reason','period_reviews_incomplete');
  END IF;
  review_items:=review_items||jsonb_build_array(jsonb_build_object(
   'callSourceId',review_item->>'callSourceId','disposition',review_item->>'disposition',
   'anchorCallSourceId',review_item->>'anchorCallSourceId',
   'reviewRevision',(review_item->>'reviewRevision')::integer,
   'reviewDigest',review_item->>'reviewDigest','reviewedAt',review_item->>'reviewedAt'));
 END LOOP;
 SELECT count(*) INTO lead_count FROM jsonb_array_elements(review_items) item
  WHERE item->>'disposition'='new_lead';
 source_manifest_digest:=public.canonical_completion_digest(sources);
 review_manifest_digest:=public.canonical_completion_digest(review_items);
 RETURN jsonb_build_object(
  'state','retell_period_ready_for_certification',
  'version','m26-retell-complete-period-v2','organizationId',org,
  'scope','retell_only_tenant_all','targetKey','demand.inbound_leads',
  'targetVersion','v1','localMonthStart',month_value,'timeZone',zone,
  'startsAt',public.canonical_forecast_utc_instant(starts_at),
  'endsAt',public.canonical_forecast_utc_instant(ends_at),
  'profileAttestationId',profile->>'attestationId',
  'profileAttestationRevision',(profile->>'attestationRevision')::integer,
  'profileAttestationDigest',profile->>'attestationDigest',
  'businessProfileId',profile->>'businessProfileId',
  'businessProfileVersion',profile->>'businessProfileVersion',
  'businessProfileHash',profile->>'businessProfileHash',
  'integrationOwnershipId',integration_ownership_id,'agentId',agent_id,
  'providerCallDigestSetDigest',
    public.canonical_completion_digest(scan_inputs->'canonicalCallDigests'),
  'snapshotId',snapshot_value,'snapshotDigest',snapshot->>'sourceSnapshotDigest',
  'snapshotCapturedAt',snapshot->>'capturedAt','sourceCount',jsonb_array_length(sources),
  'sourceManifestDigest',source_manifest_digest,
  'reviewManifestDigest',review_manifest_digest,'reviewedDistinctLeadCount',lead_count,
  'callerConsentAttested',FALSE,'providerCoverageAttested',FALSE,
  'retentionAttested',FALSE,'providerIndependentVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'serviceMixAvailable',FALSE,
  'areaForecastAvailable',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_call_snapshot_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual_role TEXT;expected_request TEXT;expected_sources JSONB;
BEGIN
 IF NEW.created_at<>NEW.as_of OR NEW.as_of>public.canonical_forecast_demand_schedule_clock_v1() THEN
  RAISE EXCEPTION 'Retell source or cutoff changed' USING ERRCODE='23514';END IF;
 IF NEW.source_window_starts_at IS NULL THEN
  IF current_setting('transaction_isolation')<>'serializable' THEN
   RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001';END IF;
  expected_sources:=public.canonical_forecast_retell_call_pins(NEW.organization_id,NEW.as_of);
  expected_request:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-as-of-snapshot-request-v1','organizationId',NEW.organization_id,
   'actorUserId',NEW.actor_user_id,'purposeKey',NEW.purpose_key,'targetKey',NEW.target_key));
 ELSE
  IF current_setting('transaction_isolation')<>'read committed' OR
     NEW.source_window_ends_at>NEW.as_of THEN
   RAISE EXCEPTION 'Retell period source request invalid' USING ERRCODE='25001';END IF;
  expected_sources:=public.canonical_forecast_retell_call_window_pins(
   NEW.organization_id,NEW.as_of,NEW.source_window_starts_at,NEW.source_window_ends_at);
  expected_request:=public.canonical_completion_digest(jsonb_build_object(
   'version','m26-retell-period-snapshot-request-v2','organizationId',NEW.organization_id,
   'actorUserId',NEW.actor_user_id,'purposeKey',NEW.purpose_key,'targetKey',NEW.target_key,
   'localMonthStart',NEW.source_window_local_month,
   'startsAt',public.canonical_forecast_utc_instant(NEW.source_window_starts_at),
   'endsAt',public.canonical_forecast_utc_instant(NEW.source_window_ends_at)));
 END IF;
 IF NEW.source_manifest IS DISTINCT FROM expected_sources THEN
  RAISE EXCEPTION 'Retell source or cutoff changed' USING ERRCODE='23514';END IF;
 SELECT role INTO actual_role FROM public.organization_memberships
  WHERE organization_id=NEW.organization_id AND id=NEW.membership_id
   AND user_id=NEW.actor_user_id AND status='active';
 IF actual_role IS NULL OR actual_role NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Forecast source access restricted' USING ERRCODE='42501';END IF;
 PERFORM public.canonical_field_execution_actor_authority(
  NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,NULL,FALSE);
 IF rtrim(NEW.request_digest)<>expected_request THEN
  RAISE EXCEPTION 'Retell source request changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_period_snapshot_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 month_value DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_retell_call_snapshots%ROWTYPE;
 inserted public.canonical_forecast_retell_call_snapshots%ROWTYPE;
 profile JSONB;zone TEXT;starts_at TIMESTAMPTZ;ends_at TIMESTAMPTZ;
 key_hash TEXT;request_hash TEXT;cutoff TIMESTAMPTZ;pins JSONB;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
    role_value IS NULL OR role_value NOT IN ('owner','admin') OR
    key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
    month_value IS NULL OR extract(day FROM month_value)<>1 OR
    month_value<DATE '2000-01-01' OR month_value>=DATE '2100-12-01' THEN
  RAISE EXCEPTION 'Retell period snapshot request invalid' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 profile:=public.canonical_forecast_profile_month_guarded_source(
  org,actor,role_value,session_value,month_value);
 IF profile->>'state'<>'owner_claim_only' THEN
  RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
   'reason','profile_month_unavailable','replayed',FALSE);END IF;
 zone:=profile#>>'{rawProfile,company,timeZone}';
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
  RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
   'reason','profile_time_zone_unavailable','replayed',FALSE);END IF;
 starts_at:=month_value::timestamp AT TIME ZONE zone;
 ends_at:=(month_value+INTERVAL '1 month')::timestamp AT TIME ZONE zone;
 IF ends_at>public.canonical_forecast_demand_schedule_clock_v1() THEN
  RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
   'reason','period_not_complete','replayed',FALSE);END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:retell-period-snapshot-v2:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Retell period snapshot busy' USING ERRCODE='55P03';END IF;
 LOCK TABLE public.canonical_operations,public.canonical_transcripts,
  public.canonical_communications,public.canonical_opportunities,
  public.canonical_voice_sessions,public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents IN SHARE MODE;
 cutoff:=public.canonical_forecast_demand_schedule_clock_v1();
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-period-snapshot-request-v2','organizationId',org,
  'actorUserId',actor,'purposeKey','forecast_demand_source','targetKey','retell.inbound_calls',
  'localMonthStart',month_value,'startsAt',public.canonical_forecast_utc_instant(starts_at),
  'endsAt',public.canonical_forecast_utc_instant(ends_at)));
 SELECT * INTO old FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Retell period snapshot request key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_retell_source_permission_current(
    org,old.source_consent_id,rtrim(old.source_consent_digest)) THEN
   RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
    'reason','source_permission_changed_refresh_required','replayed',TRUE);END IF;
  IF old.source_manifest IS DISTINCT FROM public.canonical_forecast_retell_call_window_pins(
    org,old.as_of,old.source_window_starts_at,old.source_window_ends_at) THEN
   RETURN jsonb_build_object('state','retell_period_snapshot_unavailable',
    'reason','source_changed_refresh_required','replayed',TRUE);END IF;
  RETURN jsonb_build_object('state','retell_period_snapshot_saved','snapshot',
   public.canonical_forecast_retell_call_snapshot_projection(old),'replayed',TRUE);
 END IF;
 pins:=public.canonical_forecast_retell_call_window_pins(org,cutoff,starts_at,ends_at);
 IF jsonb_array_length(pins)>1000 OR octet_length(pins::text)>262144 THEN
  RAISE EXCEPTION 'Retell period source exceeds bounded snapshot size' USING ERRCODE='54000';END IF;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-as-of-source-manifest-v1','organizationId',org,
  'asOf',public.canonical_forecast_utc_instant(cutoff),
  'purposeKey','forecast_demand_source','targetKey','retell.inbound_calls','sources',pins));
 INSERT INTO public.canonical_forecast_retell_call_snapshots(
  organization_id,as_of,purpose_key,target_key,source_manifest,snapshot_digest,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,created_at,
  source_window_starts_at,source_window_ends_at,source_window_local_month)
 VALUES(org,cutoff,'forecast_demand_source','retell.inbound_calls',pins,digest_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,cutoff,
  starts_at,ends_at,month_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','retell_period_snapshot_saved','snapshot',
  public.canonical_forecast_retell_call_snapshot_projection(inserted),'replayed',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.canonical_forecast_retell_period_certification_v2_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 action_value TEXT,snapshot_value UUID,month_value DATE,expected_revision INTEGER,
 expected_digest TEXT,evidence_digest_value TEXT,provider_scan_count_value INTEGER,
 provider_scan_digest_value TEXT,provider_scan_evidence_value JSONB,
 caller_consent_value BOOLEAN,
 provider_coverage_value BOOLEAN,retention_value BOOLEAN,reason_value TEXT,
 confirmation_version TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;evidence_value JSONB;prior public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 replay public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 key_hash TEXT;request_value JSONB;request_hash TEXT;new_id UUID:=gen_random_uuid();
 new_revision INTEGER;canonical_hash TEXT;scan_inputs JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value IS DISTINCT FROM 'owner' OR
     action_value NOT IN ('certify','revoke') OR key_value IS NULL OR length(key_value) NOT BETWEEN 8 AND 200 OR
     expected_revision NOT BETWEEN 0 AND 10000 OR
     expected_digest IS NULL OR evidence_digest_value<>repeat('0',64) OR
     provider_scan_digest_value<>repeat('0',64) OR
     provider_scan_count_value NOT BETWEEN 0 AND 1000 OR reason_value IS NULL OR
     jsonb_typeof(provider_scan_evidence_value) IS DISTINCT FROM 'object' OR
     octet_length(provider_scan_evidence_value::text)>131072 OR
     length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR octet_length(reason_value)>4000 OR
     (action_value='certify' AND (caller_consent_value IS DISTINCT FROM TRUE OR
       provider_coverage_value IS DISTINCT FROM TRUE OR
       retention_value IS DISTINCT FROM TRUE)) OR
     confirmation_version IS DISTINCT FROM 'm26-retell-period-certification-v2' THEN
   RAISE EXCEPTION 'Retell period certification request invalid' USING ERRCODE='22023';
  END IF;
  IF action_value='revoke' AND (provider_scan_count_value<>0 OR
     provider_scan_digest_value<>repeat('0',64) OR provider_scan_evidence_value<>'{}'::jsonb OR
     caller_consent_value OR
     provider_coverage_value OR retention_value) THEN
   RAISE EXCEPTION 'Retell period certification request invalid' USING ERRCODE='22023';
  END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 LOCK TABLE public.canonical_operations,public.canonical_transcripts,
  public.canonical_communications,public.canonical_opportunities,
  public.canonical_voice_sessions,public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents,
  public.canonical_forecast_retell_call_reviews,
  public.canonical_business_profiles,
  public.canonical_forecast_profile_month_attestations,
  public.canonical_forecast_retell_period_certifications_v2 IN SHARE MODE;
 -- The actor-authority helper deliberately does not lock the subscription row.
 -- Acquire it only after the ordered source locks so a subscription mutation that
 -- commits while this request waits is observed, while a later mutation cannot
 -- race any replay, refusal, or append below.
 PERFORM 1 FROM public.subscriptions
  WHERE organization_id=org FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501';
 END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
   'm26:retell-period-v2:'||org::text||':'||month_value::text,0)) THEN
  RAISE EXCEPTION 'Retell period certification busy' USING ERRCODE='55P03';
 END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_value:=jsonb_build_object('action',action_value,'snapshotId',snapshot_value,
  'month',month_value,'expectedRevision',expected_revision,'expectedDigest',expected_digest,
  'evidenceDigest',evidence_digest_value,'providerScanCount',provider_scan_count_value,
  'providerScanDigest',provider_scan_digest_value,
  'providerScanEvidence',provider_scan_evidence_value,'callerConsent',caller_consent_value,
  'providerCoverage',provider_coverage_value,'retention',retention_value,
  'reason',reason_value,'confirmationVersion',confirmation_version);
 request_hash:=public.canonical_completion_digest(request_value);
 SELECT * INTO replay FROM public.canonical_forecast_retell_period_certifications_v2
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF replay.request_digest<>request_hash THEN
   RAISE EXCEPTION 'Retell period certification request key conflict' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('state',CASE WHEN replay.action='certify' THEN
   'retell_period_certified' ELSE 'retell_period_revoked' END,'id',replay.id,
   'revision',replay.revision,'digest',rtrim(replay.canonical_digest),'replayed',TRUE);
 END IF;
 SELECT * INTO prior FROM public.canonical_forecast_retell_period_certifications_v2
  WHERE organization_id=org AND local_month_start=month_value ORDER BY revision DESC LIMIT 1;
 IF COALESCE(prior.revision,0)<>expected_revision OR
    (CASE WHEN prior.id IS NULL THEN expected_digest<>'none'
      ELSE rtrim(prior.canonical_digest)<>expected_digest END) THEN
  RAISE EXCEPTION 'Retell period certification changed' USING ERRCODE='40001';
 END IF;
 IF action_value='revoke' THEN
  IF prior.id IS NULL OR prior.action<>'certify' THEN
   RAISE EXCEPTION 'Retell period certification request invalid' USING ERRCODE='22023';
  END IF;
  evidence_digest_value:=rtrim(prior.evidence_digest);
  provider_scan_count_value:=prior.provider_scan_count;
  provider_scan_digest_value:=rtrim(prior.provider_scan_digest);
  provider_scan_evidence_value:=prior.provider_scan_evidence;
  evidence_value:=prior.evidence;
  IF snapshot_value<>prior.snapshot_id THEN
   RAISE EXCEPTION 'Retell period certification changed' USING ERRCODE='40001';
  END IF;
 ELSE
  IF caller_consent_value IS DISTINCT FROM TRUE OR provider_coverage_value IS DISTINCT FROM TRUE OR
     retention_value IS DISTINCT FROM TRUE THEN
   RAISE EXCEPTION 'Retell period certification confirmation required' USING ERRCODE='22023';
  END IF;
  evidence_value:=public.canonical_forecast_retell_period_evidence_v2(
   org,actor,role_value,session_value,snapshot_value,month_value);
  evidence_digest_value:=public.canonical_completion_digest(evidence_value);
  IF evidence_value->>'state' IS DISTINCT FROM 'retell_period_ready_for_certification' OR
     (evidence_value->>'sourceCount')::integer<>provider_scan_count_value THEN
   RAISE EXCEPTION 'Retell period evidence changed' USING ERRCODE='40001';
  END IF;
  scan_inputs:=public.canonical_forecast_retell_scan_inputs_read(
   org,actor,role_value,session_value,snapshot_value,
   (evidence_value->>'startsAt')::timestamptz,(evidence_value->>'endsAt')::timestamptz);
  IF NOT public.canonical_field_evidence_object_keys_exact(provider_scan_evidence_value,
       ARRAY['version','organizationId','snapshotId','localMonthStart','startsAt','endsAt',
       'integrationOwnershipId','agentId','canonicalCallDigests','callCount',
       'sourceSnapshotDigest','scannedAt']) OR
     provider_scan_evidence_value->>'version'<>'m26-retell-provider-scan-v2' OR
     provider_scan_evidence_value->>'organizationId'<>org::text OR
     provider_scan_evidence_value->>'snapshotId'<>snapshot_value::text OR
     provider_scan_evidence_value->>'localMonthStart'<>month_value::text OR
     provider_scan_evidence_value->>'startsAt'<>evidence_value->>'startsAt' OR
     provider_scan_evidence_value->>'endsAt'<>evidence_value->>'endsAt' OR
     provider_scan_evidence_value->>'integrationOwnershipId'<>
       evidence_value->>'integrationOwnershipId' OR
     provider_scan_evidence_value->>'agentId'<>evidence_value->>'agentId' OR
     jsonb_typeof(provider_scan_evidence_value->'canonicalCallDigests')<>'array' OR
     provider_scan_evidence_value->'canonicalCallDigests'<>scan_inputs->'canonicalCallDigests' OR
     jsonb_typeof(provider_scan_evidence_value->'callCount')<>'number' OR
     provider_scan_evidence_value->>'callCount'!~'^(0|[1-9][0-9]{0,3})$' OR
     (provider_scan_evidence_value->>'callCount')::integer<>provider_scan_count_value OR
     provider_scan_evidence_value->>'sourceSnapshotDigest'<>evidence_value->>'snapshotDigest' OR
     NOT public.canonical_progress_instant_valid(provider_scan_evidence_value->>'scannedAt') THEN
   RAISE EXCEPTION 'Retell period evidence changed' USING ERRCODE='40001';
  END IF;
  IF
     (provider_scan_evidence_value->>'scannedAt')::timestamptz<
       (evidence_value->>'endsAt')::timestamptz OR
     (provider_scan_evidence_value->>'scannedAt')::timestamptz<public.canonical_forecast_demand_schedule_clock_v1()-INTERVAL '15 minutes' OR
     (provider_scan_evidence_value->>'scannedAt')::timestamptz>public.canonical_forecast_demand_schedule_clock_v1()+INTERVAL '5 seconds' THEN
   RAISE EXCEPTION 'Retell period evidence changed' USING ERRCODE='40001';
  END IF;
  provider_scan_digest_value:=public.canonical_completion_digest(provider_scan_evidence_value);
 END IF;
 new_revision:=COALESCE(prior.revision,0)+1;
 canonical_hash:=public.canonical_completion_digest(jsonb_build_object(
  'id',new_id,'organizationId',org,'month',month_value,'revision',new_revision,
  'previousId',prior.id,'action',action_value,'snapshotId',snapshot_value,
  'evidenceDigest',evidence_digest_value,'providerScanCount',provider_scan_count_value,
  'providerScanDigest',provider_scan_digest_value,'callerConsent',caller_consent_value,
  'providerCoverage',provider_coverage_value,'retention',retention_value,
  'actorUserId',actor,'membershipId',authority->>'membershipId','reason',reason_value));
 INSERT INTO public.canonical_forecast_retell_period_certifications_v2(
  id,organization_id,local_month_start,revision,previous_id,action,snapshot_id,
  evidence,evidence_digest,provider_scan_count,provider_scan_digest,
  provider_scan_evidence,
  caller_consent_attested,provider_coverage_attested,retention_attested,reason,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,month_value,new_revision,prior.id,action_value,snapshot_value,
  evidence_value,evidence_digest_value,provider_scan_count_value,provider_scan_digest_value,
  provider_scan_evidence_value,
  caller_consent_value,provider_coverage_value,retention_value,reason_value,
  actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state',CASE WHEN action_value='certify' THEN
  'retell_period_certified' ELSE 'retell_period_revoked' END,'id',new_id,
  'revision',new_revision,'digest',canonical_hash,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_seasonal_call_visibility_v1_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_row RECORD;observed TIMESTAMPTZ;order_value BIGINT;
 source_hash TEXT;observation_hash TEXT;
BEGIN
 IF OLD.state IS NOT DISTINCT FROM 'completed' OR NEW.state<>'completed' THEN RETURN NEW;END IF;
 SELECT transcript.id transcript_id,opportunity.id opportunity_id,
  transcript.occurred_at,NEW.completed_at recorded_at
 INTO source_row
 FROM public.canonical_transcripts transcript
 JOIN public.canonical_communications communication
  ON communication.organization_id=transcript.organization_id
  AND communication.operation_id=transcript.operation_id
  AND communication.graph_id=transcript.graph_id
  AND communication.transcript_id=transcript.id
 JOIN public.canonical_opportunities opportunity
  ON opportunity.organization_id=transcript.organization_id
  AND opportunity.operation_id=transcript.operation_id
  AND opportunity.graph_id=transcript.graph_id
 JOIN public.canonical_voice_sessions voice_session
  ON voice_session.organization_id=transcript.organization_id
  AND voice_session.canonical_operation_id=transcript.operation_id
  AND voice_session.provider='retell'
  AND voice_session.provider_session_id=transcript.external_call_id
  AND voice_session.status='completed' AND voice_session.direction='inbound'
  AND voice_session.metadata->>'retellPayloadDirection'='inbound'
 WHERE transcript.organization_id=NEW.organization_id AND transcript.operation_id=NEW.id
  AND transcript.graph_id=NEW.graph_id AND transcript.source='retell'
  AND transcript.external_call_id IS NOT NULL AND communication.channel='voice_call';
 IF NOT FOUND THEN RETURN NEW;END IF;
 observed:=public.canonical_forecast_demand_schedule_clock_v1();
 order_value:=nextval('public.canonical_forecast_seasonal_call_visibility_order_v1');
 source_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-retell-call-source-v1','organizationId',NEW.organization_id,
  'transcriptId',source_row.transcript_id,'opportunityId',source_row.opportunity_id,
  'callIdentityDigest',encode(sha256(convert_to((SELECT external_call_id
    FROM public.canonical_transcripts WHERE organization_id=NEW.organization_id
     AND id=source_row.transcript_id),'UTF8')),'hex'),
  'sourceVersion',(SELECT source_version FROM public.canonical_transcripts
    WHERE organization_id=NEW.organization_id AND id=source_row.transcript_id),
  'recordedAt',public.canonical_forecast_utc_instant(source_row.recorded_at),
  'eventAt',public.canonical_forecast_utc_instant(source_row.occurred_at)));
 observation_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-seasonal-call-visibility-v1','organizationId',NEW.organization_id,
  'sourceOrder',order_value,'operationId',NEW.id,'transcriptId',source_row.transcript_id,
  'sourceDigest',source_hash,'observedAt',public.canonical_forecast_utc_instant(observed)));
 INSERT INTO public.canonical_forecast_seasonal_call_visibility_v1(
  organization_id,source_order,operation_id,transcript_id,opportunity_id,
  source_occurred_at,source_recorded_at,observed_at,source_digest,observation_digest)
 VALUES(NEW.organization_id,order_value,NEW.id,source_row.transcript_id,
  source_row.opportunity_id,source_row.occurred_at,source_row.recorded_at,observed,
  source_hash,observation_hash);
 RETURN NEW;
END $$;
CREATE TRIGGER z_canonical_forecast_seasonal_call_visibility_v1_capture
 AFTER UPDATE OF state ON public.canonical_operations
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_seasonal_call_visibility_v1_capture();

CREATE FUNCTION public.canonical_forecast_seasonal_call_generation_v1(
 org UUID,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sources JSONB;source_count INTEGER;high_water BIGINT;
BEGIN
 IF starts_at IS NULL OR ends_at IS NULL OR ends_at<=starts_at OR
    ends_at-starts_at>INTERVAL '35 days' THEN
  RAISE EXCEPTION 'Seasonal call generation window invalid' USING ERRCODE='22023';END IF;
 WITH bounded AS MATERIALIZED (
  SELECT visibility.* FROM public.canonical_forecast_seasonal_call_visibility_v1 visibility
  WHERE visibility.organization_id=org AND visibility.source_occurred_at>=starts_at
   AND visibility.source_occurred_at<ends_at
  ORDER BY visibility.transcript_id LIMIT 1001)
 SELECT count(*)::integer,COALESCE(max(source_order),0),COALESCE(jsonb_agg(
  jsonb_build_object('sourceKind','retell_call','sourceId',transcript_id,
   'revision',1,'digest',rtrim(source_digest),
   'recordedAt',public.canonical_forecast_utc_instant(source_recorded_at),
   'eventAt',public.canonical_forecast_utc_instant(source_occurred_at),
   'state','active')
  ORDER BY transcript_id),'[]'::jsonb)
 INTO source_count,high_water,sources FROM bounded;
 IF source_count>1000 OR octet_length(sources::text)>262144 THEN
  RAISE EXCEPTION 'Seasonal call generation exceeds bounded size' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('version','m26-seasonal-call-generation-v1',
  'sourceCount',source_count,'sourceHighWaterOrder',high_water,
  'sourceManifestDigest',public.canonical_completion_digest(sources));
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_eligibility_visibility_v1_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE observed TIMESTAMPTZ;digest_value TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||NEW.organization_id,0));
 observed:=public.canonical_forecast_demand_schedule_clock_v1();
 digest_value:=public.canonical_completion_digest(jsonb_build_object('version','m26-pipeline-eligibility-visibility-v1','organizationId',NEW.organization_id,'sourceEventId',NEW.id,'sourceOrder',NEW.source_order,'opportunityId',NEW.opportunity_id,'sourceDigest',rtrim(NEW.source_digest),'observedAt',public.canonical_forecast_utc_instant(observed)));
 INSERT INTO public.canonical_forecast_pipeline_eligibility_visibility_v1(
  organization_id,source_event_id,source_order,operation_id,opportunity_id,
  source_visible_at,observed_at,source_digest,observation_digest)
 VALUES(NEW.organization_id,NEW.id,NEW.source_order,NEW.operation_id,NEW.opportunity_id,
  NEW.visible_at,observed,NEW.source_digest,digest_value);
 RETURN NEW;
END $$;
CREATE TRIGGER z_canonical_forecast_pipeline_eligibility_visibility_v1_capture
 AFTER INSERT ON public.canonical_forecast_opportunity_eligibility_events
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_pipeline_eligibility_visibility_v1_capture();

CREATE FUNCTION public.canonical_forecast_pipeline_booking_visibility_v1_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE opportunity_value UUID;observed TIMESTAMPTZ;digest_value TEXT;
BEGIN
 IF NEW.transition_kind<>'accepted_booking' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||NEW.organization_id,0));
 SELECT opportunity_id INTO opportunity_value FROM public.canonical_appointments
 WHERE organization_id=NEW.organization_id AND id=NEW.appointment_id;
 IF opportunity_value IS NULL THEN RETURN NEW;END IF;
 observed:=public.canonical_forecast_demand_schedule_clock_v1();
 digest_value:=public.canonical_completion_digest(jsonb_build_object('version','m26-pipeline-booking-visibility-v1','organizationId',NEW.organization_id,'sourceEventId',NEW.id,'sourceOrder',NEW.source_order,'opportunityId',opportunity_value,'sourceDigest',rtrim(NEW.event_digest),'observedAt',public.canonical_forecast_utc_instant(observed)));
 INSERT INTO public.canonical_forecast_pipeline_booking_visibility_v1(
  organization_id,source_event_id,source_order,opportunity_id,assignment_id,
  appointment_id,source_occurred_at,observed_at,source_digest,observation_digest)
 VALUES(NEW.organization_id,NEW.id,NEW.source_order,opportunity_value,NEW.assignment_id,
  NEW.appointment_id,NEW.occurred_at,observed,NEW.event_digest,digest_value);
 RETURN NEW;
END $$;
CREATE TRIGGER z_canonical_forecast_pipeline_booking_visibility_v1_capture
 AFTER INSERT ON public.canonical_forecast_schedule_booking_events
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_pipeline_booking_visibility_v1_capture();

CREATE FUNCTION public.canonical_forecast_seasonal_certification_visibility_v1_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE observed TIMESTAMPTZ;digest_value TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:retell-period-v2:'||NEW.organization_id||':'||NEW.local_month_start,0));
 observed:=public.canonical_forecast_demand_schedule_clock_v1();
 digest_value:=public.canonical_completion_digest(jsonb_build_object('version','m26-seasonal-certification-visibility-v1','organizationId',NEW.organization_id,'certificationId',NEW.id,'month',NEW.local_month_start,'revision',NEW.revision,'action',NEW.action,'certificationDigest',rtrim(NEW.canonical_digest),'observedAt',public.canonical_forecast_utc_instant(observed)));
 INSERT INTO public.canonical_forecast_seasonal_certification_visibility_v1(
  organization_id,certification_id,local_month_start,revision,action,observed_at,
  certification_digest,observation_digest)
 VALUES(NEW.organization_id,NEW.id,NEW.local_month_start,NEW.revision,NEW.action,observed,
  NEW.canonical_digest,digest_value);
 RETURN NEW;
END $$;
CREATE TRIGGER z_canonical_forecast_seasonal_certification_visibility_v1_capture
 AFTER INSERT ON public.canonical_forecast_retell_period_certifications_v2
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_seasonal_certification_visibility_v1_capture();

CREATE FUNCTION public.canonical_forecast_demand_schedule_child_key_v1(parent_key TEXT,discriminator TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT 'm26p4c-'||encode(sha256(convert_to(parent_key||chr(31)||discriminator,'UTF8')),'hex')
$$;

CREATE FUNCTION public.canonical_forecast_seasonal_signal_v1(
 cycle1_leads NUMERIC,cycle1_minutes NUMERIC,cycle2_leads NUMERIC,cycle2_minutes NUMERIC,
 first_target_leads NUMERIC,first_target_minutes NUMERIC,
 second_target_leads NUMERIC,second_target_minutes NUMERIC,horizon_minutes NUMERIC)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_rate NUMERIC;second_rate NUMERIC;first_baseline NUMERIC;
 second_baseline NUMERIC;direction TEXT;point_value NUMERIC;
BEGIN
 IF cycle1_leads<0 OR cycle2_leads<0 OR first_target_leads<0 OR second_target_leads<0 OR
  cycle1_minutes<=0 OR cycle2_minutes<=0 OR first_target_minutes<=0 OR
  second_target_minutes<=0 OR horizon_minutes<=0 THEN
  RAISE EXCEPTION 'Seasonal signal inputs invalid' USING ERRCODE='22023';END IF;
 first_rate:=first_target_leads/first_target_minutes;
 second_rate:=second_target_leads/second_target_minutes;
 first_baseline:=cycle1_leads/cycle1_minutes;
 second_baseline:=cycle2_leads/cycle2_minutes;
 IF cycle1_leads=0 AND cycle2_leads=0 THEN
  direction:='authenticated_complete_zero_no_signal';point_value:=NULL;
 ELSIF first_rate>first_baseline AND second_rate>second_baseline THEN
  direction:='repeated_high';point_value:=round(((first_rate+second_rate)/2)*horizon_minutes,6);
 ELSIF first_rate<first_baseline AND second_rate<second_baseline THEN
  direction:='repeated_low';point_value:=round(((first_rate+second_rate)/2)*horizon_minutes,6);
 ELSIF first_rate=first_baseline AND second_rate=second_baseline THEN
  direction:='repeated_neutral';point_value:=round(((first_rate+second_rate)/2)*horizon_minutes,6);
 ELSE direction:='inconclusive';point_value:=NULL;END IF;
 RETURN jsonb_build_object('direction',direction,'point',point_value,
  'empiricallyCalibrated',FALSE,'statisticalSignificanceAvailable',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_demand_schedule_method_review_v1_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,purpose_value TEXT,
 action_value TEXT,expected_revision INTEGER,expected_digest TEXT,reason_value TEXT,confirmation_version TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;method_row public.canonical_forecast_demand_schedule_methods_v1%ROWTYPE;
 prior public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;replay public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;
 key_hash TEXT;request_hash TEXT;review_hash TEXT;new_id UUID:=gen_random_uuid();new_revision INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value NOT IN ('owner','admin') OR
  purpose_value NOT IN ('seasonal_inbound','pipeline_first_booking') OR action_value NOT IN ('approve','reject') OR
  expected_revision NOT BETWEEN 0 AND 10000 OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
  expected_digest IS NULL OR
  (expected_revision=0 AND expected_digest IS DISTINCT FROM 'none') OR
  (expected_revision>0 AND expected_digest!~'^[0-9a-f]{64}$') OR
  length(btrim(reason_value)) NOT BETWEEN 10 AND 1000 OR
  confirmation_version IS DISTINCT FROM 'm26-demand-schedule-method-review-v1' THEN
  RAISE EXCEPTION 'Demand schedule method review invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-method:'||org||':'||purpose_value,0));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO method_row FROM public.canonical_forecast_demand_schedule_methods_v1 WHERE purpose=purpose_value;
 SELECT * INTO prior FROM public.canonical_forecast_demand_schedule_method_reviews_v1 WHERE organization_id=org AND purpose=purpose_value ORDER BY revision DESC LIMIT 1;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('purpose',purpose_value,'action',action_value,'expectedRevision',expected_revision,'expectedDigest',expected_digest,'reason',btrim(reason_value)));
 SELECT * INTO replay FROM public.canonical_forecast_demand_schedule_method_reviews_v1 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Demand schedule method review key conflict' USING ERRCODE='23505';END IF;
  authority:=public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','demand_schedule_method_review_recorded','id',replay.id,'purpose',replay.purpose,'revision',replay.revision,'action',replay.action,'digest',rtrim(replay.review_digest),'replayed',TRUE);
 END IF;
 IF COALESCE(prior.revision,0) IS DISTINCT FROM expected_revision OR
  (prior.id IS NULL AND expected_digest IS DISTINCT FROM 'none') OR
  (prior.id IS NOT NULL AND rtrim(prior.review_digest) IS DISTINCT FROM expected_digest) THEN
  RAISE EXCEPTION 'Demand schedule method review changed' USING ERRCODE='40001';END IF;
 new_revision:=COALESCE(prior.revision,0)+1;
 review_hash:=public.canonical_completion_digest(jsonb_build_object('id',new_id,'organizationId',org,'purpose',purpose_value,'revision',new_revision,'previousId',prior.id,'methodId',method_row.id,'methodDigest',rtrim(method_row.method_digest),'action',action_value,'reason',btrim(reason_value),'actorUserId',actor));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_demand_schedule_method_reviews_v1(organization_id,id,purpose,revision,previous_id,method_id,method_digest,action,reason,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,review_digest)
 VALUES(org,new_id,purpose_value,new_revision,prior.id,method_row.id,method_row.method_digest,action_value,btrim(reason_value),actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,review_hash);
 RETURN jsonb_build_object('state','demand_schedule_method_review_recorded','id',new_id,'purpose',purpose_value,'revision',new_revision,'action',action_value,'digest',review_hash,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_seasonal_training_v1(
 org UUID,actor UUID,role_value TEXT,session_value UUID,horizon_month DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch_row public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 method_row public.canonical_forecast_demand_schedule_methods_v1%ROWTYPE;review_row public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;consent_row public.canonical_forecast_retell_source_consents%ROWTYPE;
 cert public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 snapshot_row public.canonical_forecast_retell_call_snapshots%ROWTYPE;
 cert_visibility public.canonical_forecast_seasonal_certification_visibility_v1%ROWTYPE;
 evidence_value JSONB;window_value JSONB;profile_proof JSONB;call_generation JSONB;
 periods JSONB:='[]'::jsonb;month_value DATE;expected_horizon DATE;zone TEXT;ordinal_value INTEGER;
 cycle1_leads NUMERIC:=0;cycle2_leads NUMERIC:=0;cycle1_minutes NUMERIC:=0;cycle2_minutes NUMERIC:=0;
 first_target_leads NUMERIC;second_target_leads NUMERIC;first_target_minutes NUMERIC;second_target_minutes NUMERIC;
 horizon_window JSONB;signal_value JSONB;direction TEXT;seasonal_point NUMERIC;
 integration_count INTEGER;integration_id UUID;agent_id TEXT;
 integration_created TIMESTAMPTZ;integration_updated TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR horizon_month IS NULL OR extract(day FROM horizon_month)<>1 THEN RAISE EXCEPTION 'Seasonal training request invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Seasonal training restricted' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:demand-schedule-epoch:'||org||':seasonal_inbound',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:demand-schedule-method:'||org||':seasonal_inbound',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':forecast-retell-source-consent',0));
 LOCK TABLE public.canonical_operations,public.canonical_transcripts,
  public.canonical_communications,public.canonical_opportunities,
  public.canonical_voice_sessions,public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents,
  public.canonical_forecast_retell_call_reviews,public.canonical_business_profiles,
  public.canonical_forecast_profile_month_attestations,
  public.canonical_forecast_retell_period_certifications_v2 IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:seasonal-origin-v1:'||org,0));
 SELECT * INTO epoch_row FROM public.canonical_forecast_demand_schedule_epochs_v1 WHERE organization_id=org AND purpose='seasonal_inbound' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO method_row FROM public.canonical_forecast_demand_schedule_methods_v1 WHERE purpose='seasonal_inbound';
 SELECT * INTO review_row FROM public.canonical_forecast_demand_schedule_method_reviews_v1 WHERE organization_id=org AND purpose='seasonal_inbound' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO profile_row FROM public.canonical_business_profiles WHERE organization_id=org AND id=epoch_row.business_profile_id AND is_active;
 SELECT * INTO consent_row FROM public.canonical_forecast_retell_source_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT count(*),min(id::text)::uuid,min(external_integration_id),min(created_at),min(updated_at)
 INTO integration_count,integration_id,agent_id,integration_created,integration_updated
 FROM public.canonical_integration_ownership WHERE organization_id=org AND provider='retell' AND status='active';
 IF epoch_row.id IS NULL OR review_row.id IS NULL OR review_row.action<>'approve' OR review_row.method_id<>method_row.id OR review_row.method_digest<>method_row.method_digest OR profile_row.id IS NULL OR profile_row.version_number<>epoch_row.business_profile_version OR profile_row.normalized_profile_hash<>epoch_row.business_profile_hash OR EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events WHERE organization_id=org AND source_order>epoch_row.profile_source_order) OR consent_row.id IS DISTINCT FROM epoch_row.consent_id OR consent_row.action<>'grant' OR consent_row.canonical_digest IS DISTINCT FROM epoch_row.consent_digest OR integration_count<>1 OR integration_id IS DISTINCT FROM epoch_row.integration_ownership_id OR agent_id IS DISTINCT FROM epoch_row.integration_agent_id THEN
  RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','epoch_profile_source_or_review_not_current','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 zone:=epoch_row.time_zone;
 expected_horizon:=date_trunc('month',(public.canonical_forecast_demand_schedule_clock_v1() AT TIME ZONE zone)+INTERVAL '1 month')::date;
 IF horizon_month<>expected_horizon THEN RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','horizon_not_next_local_month','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 IF GREATEST(epoch_row.installed_at,epoch_row.profile_activation_at,
      epoch_row.consent_activated_at,epoch_row.integration_activated_at)>=
    ((horizon_month-INTERVAL '25 months')::date::timestamp AT TIME ZONE zone) OR
    integration_created IS DISTINCT FROM epoch_row.integration_activated_at OR
    integration_updated IS DISTINCT FROM epoch_row.integration_updated_at
 THEN RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','prospective_epoch_too_late_or_source_changed','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 FOR ordinal_value IN 1..24 LOOP
  month_value:=(horizon_month-((26-ordinal_value)||' months')::interval)::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('m26:retell-period-v2:'||org||':'||month_value,0));
  SELECT * INTO cert FROM public.canonical_forecast_retell_period_certifications_v2 WHERE organization_id=org AND local_month_start=month_value ORDER BY revision DESC LIMIT 1;
  SELECT * INTO snapshot_row FROM public.canonical_forecast_retell_call_snapshots
   WHERE organization_id=org AND id=cert.snapshot_id;
  SELECT * INTO cert_visibility FROM public.canonical_forecast_seasonal_certification_visibility_v1
   WHERE organization_id=org AND certification_id=cert.id;
  IF cert.id IS NULL OR cert.action<>'certify' THEN RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','complete_24_month_inventory_missing','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
  evidence_value:=public.canonical_forecast_retell_period_evidence_v2(org,actor,role_value,session_value,cert.snapshot_id,month_value);
  window_value:=public.canonical_forecast_comparable_month_v2_window(org,epoch_row.profile_anchor_id,month_value);
  profile_proof:=public.canonical_forecast_profile_effective_window(org,actor,role_value,session_value,epoch_row.profile_anchor_id,(window_value->>'startsAt')::timestamptz,(window_value->>'endsAt')::timestamptz);
  call_generation:=public.canonical_forecast_seasonal_call_generation_v1(
   org,(window_value->>'startsAt')::timestamptz,(window_value->>'endsAt')::timestamptz);
  IF evidence_value->>'state'<>'retell_period_ready_for_certification' OR public.canonical_completion_digest(evidence_value)<>rtrim(cert.evidence_digest) OR window_value->>'state'<>'complete' OR profile_proof->>'state'<>'profile_effective_window_verified' OR (window_value->>'openMinutes')::bigint<=0 OR cert_visibility.certification_id IS NULL OR cert_visibility.certification_digest<>cert.canonical_digest OR cert_visibility.observed_at<((window_value->>'endsAt')::timestamptz+INTERVAL '7 days') OR cert_visibility.observed_at<=epoch_row.installed_at OR evidence_value->>'businessProfileId'<>epoch_row.business_profile_id::text OR evidence_value->>'businessProfileVersion'<>epoch_row.business_profile_version::text OR evidence_value->>'businessProfileHash'<>rtrim(epoch_row.business_profile_hash) OR evidence_value->>'integrationOwnershipId'<>epoch_row.integration_ownership_id::text OR evidence_value->>'agentId'<>epoch_row.integration_agent_id OR snapshot_row.id IS NULL OR (call_generation->>'sourceCount')::integer<>jsonb_array_length(snapshot_row.source_manifest) OR call_generation->>'sourceManifestDigest'<>public.canonical_completion_digest(snapshot_row.source_manifest) THEN RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','certified_month_stale_incomplete_or_before_close','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
  periods:=periods||jsonb_build_array(jsonb_build_object('ordinal',ordinal_value,'month',month_value,'certificationId',cert.id,'certificationRevision',cert.revision,'certificationDigest',rtrim(cert.canonical_digest),'evidenceDigest',rtrim(cert.evidence_digest),'snapshotId',cert.snapshot_id,'sourceObservationCount',(call_generation->>'sourceCount')::integer,'sourceObservationHighWaterOrder',(call_generation->>'sourceHighWaterOrder')::bigint,'sourceObservationDigest',call_generation->>'sourceManifestDigest','leadCount',(evidence_value->>'reviewedDistinctLeadCount')::integer,'elapsedMinutes',(window_value->>'elapsedMinutes')::integer,'openMinutes',(window_value->>'openMinutes')::integer,'calendarDigest',window_value->>'calendarDigest'));
  IF ordinal_value<=12 THEN cycle1_leads:=cycle1_leads+(evidence_value->>'reviewedDistinctLeadCount')::integer;cycle1_minutes:=cycle1_minutes+(window_value->>'openMinutes')::integer;ELSE cycle2_leads:=cycle2_leads+(evidence_value->>'reviewedDistinctLeadCount')::integer;cycle2_minutes:=cycle2_minutes+(window_value->>'openMinutes')::integer;END IF;
  IF extract(month FROM month_value)=extract(month FROM horizon_month) THEN IF ordinal_value<=12 THEN first_target_leads:=(evidence_value->>'reviewedDistinctLeadCount')::integer;first_target_minutes:=(window_value->>'openMinutes')::integer;ELSE second_target_leads:=(evidence_value->>'reviewedDistinctLeadCount')::integer;second_target_minutes:=(window_value->>'openMinutes')::integer;END IF;END IF;
 END LOOP;
 IF jsonb_array_length(periods)<>24 OR cycle1_minutes<=0 OR cycle2_minutes<=0 OR first_target_minutes<=0 OR second_target_minutes<=0 THEN RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','seasonal_denominator_unavailable','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 horizon_window:=public.canonical_forecast_comparable_month_v2_window(org,epoch_row.profile_anchor_id,horizon_month);
 IF horizon_window->>'state'<>'complete' OR (horizon_window->>'openMinutes')::bigint<=0 THEN RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','horizon_calendar_unavailable','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 signal_value:=public.canonical_forecast_seasonal_signal_v1(cycle1_leads,cycle1_minutes,
  cycle2_leads,cycle2_minutes,first_target_leads,first_target_minutes,
  second_target_leads,second_target_minutes,(horizon_window->>'openMinutes')::numeric);
 direction:=signal_value->>'direction';seasonal_point:=(signal_value->>'point')::numeric;
 IF direction='inconclusive' THEN RETURN jsonb_build_object('state','seasonal_origin_unavailable','reason','seasonal_signal_inconclusive','researchOnly',TRUE,'amountWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 RETURN jsonb_build_object('state','seasonal_training_current','version','m26-seasonal-training-v1','organizationId',org,'targetKey','demand.inbound_leads','targetVersion','v1','scope','retell_only_tenant_all','epochId',epoch_row.id,'epochDigest',rtrim(epoch_row.epoch_digest),'profileAnchorId',epoch_row.profile_anchor_id,'businessProfileId',epoch_row.business_profile_id,'businessProfileVersion',epoch_row.business_profile_version,'businessProfileHash',rtrim(epoch_row.business_profile_hash),'timeZone',zone,'methodId',method_row.id,'methodDigest',rtrim(method_row.method_digest),'methodReviewId',review_row.id,'methodReviewRevision',review_row.revision,'methodReviewDigest',rtrim(review_row.review_digest),'calculationVersion',method_row.calculation_version,'recordingCloseLagDays',7,'periodCount',24,'periods',periods,'periodInventoryDigest',public.canonical_completion_digest(periods),'horizonMonth',horizon_month,'horizonStartsAt',horizon_window->>'startsAt','horizonEndsAt',horizon_window->>'endsAt','horizonOpenMinutes',(horizon_window->>'openMinutes')::integer,'seasonalDirection',direction,'privatePoint',seasonal_point,'uncertaintyState','unavailable_not_empirically_calibrated','sourceCoverageScope','certified_post_epoch_retell_only','providerIndependentVerified',FALSE,'wholeBusinessCoverageVerified',FALSE,'researchOnly',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_seasonal_origin_v1_capture(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,horizon_month DATE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;training JSONB;prior public.canonical_forecast_seasonal_origins_v1%ROWTYPE;new_id UUID:=gen_random_uuid();key_hash TEXT;request_hash TEXT;evidence_hash TEXT;output_value JSONB;output_hash TEXT;canonical_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value NOT IN ('owner','admin') OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Seasonal origin request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('version','m26-seasonal-origin-v1','horizonMonth',horizon_month));
 SELECT * INTO prior FROM public.canonical_forecast_seasonal_origins_v1 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_hash THEN RAISE EXCEPTION 'Seasonal origin key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_seasonal_input_current_v1(org,actor,role_value,session_value,prior) THEN
   PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
   RETURN jsonb_build_object('state','seasonal_origin_stale','id',prior.id,'refreshRequired',TRUE,'researchOnly',TRUE,'amountWithheld',TRUE,'outputDigestWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
  PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','seasonal_origin_saved','id',prior.id,'localHorizonStart',prior.local_horizon_start,'replayed',TRUE,'researchOnly',TRUE,'amountWithheld',TRUE,'outputDigestWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 training:=public.canonical_forecast_seasonal_training_v1(org,actor,role_value,session_value,horizon_month);
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF training->>'state'<>'seasonal_training_current' THEN RETURN training;END IF;
 evidence_hash:=public.canonical_completion_digest(training-'privatePoint');output_value:=jsonb_build_object('version','m26-seasonal-private-output-v1','targetKey','demand.inbound_leads','point',training->'privatePoint','direction',training->>'seasonalDirection','uncertaintyState',training->>'uncertaintyState','researchOnly',TRUE,'realForecastEligible',FALSE);output_hash:=public.canonical_completion_digest(output_value);canonical_hash:=public.canonical_completion_digest(jsonb_build_object('id',new_id,'organizationId',org,'evidenceDigest',evidence_hash,'outputDigest',output_hash,'actorUserId',actor));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_seasonal_origins_v1(id,organization_id,as_of,local_horizon_start,horizon_starts_at,horizon_ends_at,epoch_id,method_review_id,evidence,evidence_digest,private_output,output_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,public.canonical_forecast_demand_schedule_clock_v1(),horizon_month,(training->>'horizonStartsAt')::timestamptz,(training->>'horizonEndsAt')::timestamptz,(training->>'epochId')::uuid,(training->>'methodReviewId')::uuid,training-'privatePoint',evidence_hash,output_value,output_hash,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state','seasonal_origin_saved','id',new_id,'localHorizonStart',horizon_month,'seasonalSignalState',training->>'seasonalDirection','replayed',FALSE,'researchOnly',TRUE,'amountWithheld',TRUE,'outputDigestWithheld',TRUE,'sourceCoverageComplete',TRUE,'sourceCoverageScope','certified_post_epoch_retell_only','providerIndependentVerified',FALSE,'wholeBusinessCoverageVerified',FALSE,'realForecastEligible',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_seasonal_input_current_v1(
 org UUID,actor UUID,role_value TEXT,session_value UUID,
 saved public.canonical_forecast_seasonal_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB;cert public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 evidence_value JSONB;review_row public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;
 epoch_row public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;integration_count INTEGER;
 integration_id UUID;agent_id TEXT;integration_created TIMESTAMPTZ;
 integration_updated TIMESTAMPTZ;window_value JSONB;call_generation JSONB;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:demand-schedule-epoch:'||org||':seasonal_inbound',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:demand-schedule-method:'||org||':seasonal_inbound',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));
 LOCK TABLE public.canonical_operations,public.canonical_transcripts,
  public.canonical_communications,public.canonical_opportunities,
  public.canonical_voice_sessions,public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents,
  public.canonical_forecast_retell_call_reviews,public.canonical_business_profiles,
  public.canonical_forecast_profile_month_attestations,
  public.canonical_forecast_retell_period_certifications_v2 IN SHARE MODE;
 SELECT * INTO epoch_row FROM public.canonical_forecast_demand_schedule_epochs_v1
  WHERE organization_id=org AND purpose='seasonal_inbound'
  ORDER BY revision DESC LIMIT 1;
 SELECT * INTO review_row FROM public.canonical_forecast_demand_schedule_method_reviews_v1 WHERE organization_id=org AND purpose='seasonal_inbound' ORDER BY revision DESC LIMIT 1;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=epoch_row.business_profile_id AND is_active;
 SELECT count(*),min(id::text)::uuid,min(external_integration_id),min(created_at),min(updated_at)
 INTO integration_count,integration_id,agent_id,integration_created,integration_updated
 FROM public.canonical_integration_ownership
 WHERE organization_id=org AND provider='retell' AND status='active';
 IF epoch_row.id IS DISTINCT FROM saved.epoch_id OR
    review_row.id IS DISTINCT FROM saved.method_review_id OR
    review_row.action<>'approve' OR profile_row.id IS NULL OR
    profile_row.version_number<>epoch_row.business_profile_version OR
    profile_row.normalized_profile_hash<>epoch_row.business_profile_hash OR
    EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events
      WHERE organization_id=org AND source_order>epoch_row.profile_source_order) OR
    NOT public.canonical_forecast_retell_source_permission_current(
      org,epoch_row.consent_id,rtrim(epoch_row.consent_digest)) OR
    integration_count<>1 OR integration_id IS DISTINCT FROM epoch_row.integration_ownership_id OR
    agent_id IS DISTINCT FROM epoch_row.integration_agent_id OR
    integration_created IS DISTINCT FROM epoch_row.integration_activated_at OR
    integration_updated IS DISTINCT FROM epoch_row.integration_updated_at
 THEN RETURN FALSE;END IF;
 IF jsonb_array_length(saved.evidence->'periods')<>24 THEN RETURN FALSE;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(saved.evidence->'periods') value LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(
   'm26:retell-period-v2:'||org||':'||(item->>'month'),0));
  SELECT * INTO cert FROM public.canonical_forecast_retell_period_certifications_v2
   WHERE organization_id=org AND local_month_start=(item->>'month')::date
   ORDER BY revision DESC LIMIT 1;
  IF cert.id IS DISTINCT FROM (item->>'certificationId')::uuid OR
     cert.revision<>(item->>'certificationRevision')::integer OR
     rtrim(cert.canonical_digest)<>item->>'certificationDigest' OR
     rtrim(cert.evidence_digest)<>item->>'evidenceDigest' OR
     cert.snapshot_id IS DISTINCT FROM (item->>'snapshotId')::uuid OR cert.action<>'certify'
  THEN RETURN FALSE;END IF;
  evidence_value:=public.canonical_forecast_retell_period_evidence_v2(
   org,actor,role_value,session_value,cert.snapshot_id,(item->>'month')::date);
  window_value:=public.canonical_forecast_comparable_month_v2_window(
   org,epoch_row.profile_anchor_id,(item->>'month')::date);
  call_generation:=public.canonical_forecast_seasonal_call_generation_v1(
   org,(window_value->>'startsAt')::timestamptz,(window_value->>'endsAt')::timestamptz);
  IF evidence_value->>'state'<>'retell_period_ready_for_certification' OR
     public.canonical_completion_digest(evidence_value)<>rtrim(cert.evidence_digest) OR
     evidence_value->>'businessProfileId'<>epoch_row.business_profile_id::text OR
     evidence_value->>'businessProfileVersion'<>epoch_row.business_profile_version::text OR
     evidence_value->>'businessProfileHash'<>rtrim(epoch_row.business_profile_hash) OR
     evidence_value->>'integrationOwnershipId'<>epoch_row.integration_ownership_id::text OR
     evidence_value->>'agentId'<>epoch_row.integration_agent_id OR
     (call_generation->>'sourceCount')::integer IS DISTINCT FROM
       (item->>'sourceObservationCount')::integer OR
     (call_generation->>'sourceHighWaterOrder')::bigint IS DISTINCT FROM
       (item->>'sourceObservationHighWaterOrder')::bigint OR
     call_generation->>'sourceManifestDigest' IS DISTINCT FROM
       item->>'sourceObservationDigest'
  THEN RETURN FALSE;END IF;
 END LOOP;
 RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_forecast_seasonal_origin_v1_read(org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_seasonal_origins_v1%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR origin_value IS NULL THEN RAISE EXCEPTION 'Seasonal origin read invalid' USING ERRCODE='22023';END IF;PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Seasonal origin read restricted' USING ERRCODE='42501';END IF;SELECT * INTO saved FROM public.canonical_forecast_seasonal_origins_v1 WHERE organization_id=org AND id=origin_value;IF saved.id IS NULL THEN RETURN NULL;END IF;
 IF NOT public.canonical_forecast_seasonal_input_current_v1(org,actor,role_value,session_value,saved) THEN PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);RETURN jsonb_build_object('state','seasonal_origin_stale','id',saved.id,'refreshRequired',TRUE,'researchOnly',TRUE,'amountWithheld',TRUE,'outputDigestWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','seasonal_origin_current','id',saved.id,'localHorizonStart',saved.local_horizon_start,'horizonStartsAt',public.canonical_forecast_utc_instant(saved.horizon_starts_at),'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),'targetKey','demand.inbound_leads','targetVersion','v1','scope','retell_only_tenant_all','seasonalSignalState',saved.private_output->>'direction','sourceCoverageComplete',TRUE,'sourceCoverageScope','certified_post_epoch_retell_only','providerIndependentVerified',FALSE,'wholeBusinessCoverageVerified',FALSE,'uncertaintyState','unavailable_not_empirically_calibrated','researchOnly',TRUE,'amountWithheld',TRUE,'outputDigestWithheld',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_demand_schedule_epoch_current_v1(
 org UUID,saved public.canonical_forecast_demand_schedule_epochs_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE latest public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 activation_row public.canonical_forecast_profile_effective_activations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
 integration_count INTEGER;integration_id UUID;agent_id TEXT;
 integration_created TIMESTAMPTZ;integration_updated TIMESTAMPTZ;
BEGIN
 SELECT * INTO latest FROM public.canonical_forecast_demand_schedule_epochs_v1
 WHERE organization_id=org AND purpose=saved.purpose ORDER BY revision DESC LIMIT 1;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
 WHERE organization_id=org AND id=saved.profile_anchor_id;
 SELECT * INTO activation_row FROM public.canonical_forecast_profile_effective_activations
 WHERE organization_id=org AND anchor_id=saved.profile_anchor_id;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
 WHERE organization_id=org AND id=saved.business_profile_id AND is_active;
 IF latest.id IS DISTINCT FROM saved.id OR anchor_row.id IS NULL OR
    activation_row.anchor_id IS NULL OR profile_row.id IS NULL OR
    anchor_row.source_order<>saved.profile_source_order OR
    anchor_row.business_profile_id<>saved.business_profile_id OR
    anchor_row.business_profile_version<>saved.business_profile_version OR
    anchor_row.business_profile_hash<>saved.business_profile_hash OR
    activation_row.observed_at<>saved.profile_activation_at OR
    profile_row.version_number<>saved.business_profile_version OR
    profile_row.normalized_profile_hash<>saved.business_profile_hash OR
    public.canonical_completion_digest(profile_row.raw_profile)<>anchor_row.raw_profile_digest OR
    EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events
      WHERE organization_id=org AND source_order>saved.profile_source_order)
 THEN RETURN FALSE;END IF;
 IF saved.purpose='seasonal_inbound' THEN
  IF NOT public.canonical_forecast_retell_source_permission_current(
       org,saved.consent_id,rtrim(saved.consent_digest)) THEN RETURN FALSE;END IF;
  SELECT count(*),min(id::text)::uuid,min(external_integration_id),
   min(created_at),min(updated_at)
  INTO integration_count,integration_id,agent_id,integration_created,integration_updated
  FROM public.canonical_integration_ownership
  WHERE organization_id=org AND provider='retell' AND status='active';
  IF integration_count<>1 OR integration_id IS DISTINCT FROM saved.integration_ownership_id OR
     agent_id IS DISTINCT FROM saved.integration_agent_id OR
     integration_created IS DISTINCT FROM saved.integration_activated_at OR
     integration_updated IS DISTINCT FROM saved.integration_updated_at
  THEN RETURN FALSE;END IF;
 END IF;
 RETURN TRUE;
END $$;

CREATE FUNCTION public.canonical_forecast_demand_schedule_epoch_v1_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,purpose_value TEXT,profile_anchor_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;activation_row public.canonical_forecast_profile_effective_activations%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;consent_row public.canonical_forecast_retell_source_consents%ROWTYPE;
 integration_id UUID;agent_id TEXT;integration_count INTEGER;integration_created TIMESTAMPTZ;
 integration_updated TIMESTAMPTZ;generation JSONB;digest_value TEXT;key_hash TEXT;request_hash TEXT;
 replay public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 current_epoch public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 new_id UUID:=gen_random_uuid();installed TIMESTAMPTZ;new_revision INTEGER;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value NOT IN ('owner','admin') OR purpose_value NOT IN ('seasonal_inbound','pipeline_first_booking') OR profile_anchor_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Demand schedule epoch invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:demand-schedule-epoch:'||org||':'||purpose_value,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':forecast-retell-source-consent',0));
 LOCK TABLE public.canonical_integration_ownership,
  public.canonical_forecast_retell_source_consents IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:retell-period-v2:'||org||':epoch',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||org,0));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('purpose',purpose_value,'profileAnchorId',profile_anchor_value));
 SELECT * INTO replay FROM public.canonical_forecast_demand_schedule_epochs_v1 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Demand schedule epoch key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_demand_schedule_epoch_current_v1(org,replay) THEN
   authority:=public.canonical_forecast_booking_ordered_access(
    org,actor,role_value,session_value,csrf,TRUE);
   RETURN jsonb_build_object('state','demand_schedule_epoch_stale','id',replay.id,
    'purpose',replay.purpose,'refreshRequired',TRUE,'replayed',TRUE);END IF;
  authority:=public.canonical_forecast_booking_ordered_access(
   org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','demand_schedule_epoch_recorded','id',replay.id,'purpose',replay.purpose,'installedAt',public.canonical_forecast_utc_instant(replay.installed_at),'digest',rtrim(replay.epoch_digest),'replayed',TRUE);END IF;
 SELECT * INTO current_epoch FROM public.canonical_forecast_demand_schedule_epochs_v1
  WHERE organization_id=org AND purpose=purpose_value ORDER BY revision DESC LIMIT 1;
 new_revision:=COALESCE(current_epoch.revision,0)+1;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors WHERE organization_id=org AND id=profile_anchor_value;
 SELECT * INTO activation_row FROM public.canonical_forecast_profile_effective_activations WHERE organization_id=org AND anchor_id=profile_anchor_value;
 SELECT * INTO profile_row FROM public.canonical_business_profiles WHERE organization_id=org AND id=anchor_row.business_profile_id AND is_active;
 IF anchor_row.id IS NULL OR activation_row.anchor_id IS NULL OR profile_row.id IS NULL OR profile_row.version_number<>anchor_row.business_profile_version OR profile_row.normalized_profile_hash<>anchor_row.business_profile_hash OR public.canonical_completion_digest(profile_row.raw_profile)<>anchor_row.raw_profile_digest OR EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events WHERE organization_id=org AND source_order>anchor_row.source_order) THEN RETURN jsonb_build_object('state','demand_schedule_epoch_unavailable','reason','prospective_profile_unavailable');END IF;
 installed:=public.canonical_forecast_demand_schedule_clock_v1();
 IF activation_row.observed_at>=installed THEN RETURN jsonb_build_object('state','demand_schedule_epoch_unavailable','reason','profile_activation_not_committed');END IF;
 IF purpose_value='seasonal_inbound' THEN
  SELECT * INTO consent_row FROM public.canonical_forecast_retell_source_consents WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
  SELECT count(*),min(id::text)::uuid,min(external_integration_id),min(created_at),min(updated_at)
  INTO integration_count,integration_id,agent_id,integration_created,integration_updated
  FROM public.canonical_integration_ownership WHERE organization_id=org AND provider='retell' AND status='active';
  IF consent_row.id IS NULL OR consent_row.action<>'grant' OR
     consent_row.created_at>=installed OR integration_count<>1 OR integration_id IS NULL OR
     agent_id IS NULL OR integration_created>=installed OR integration_updated>=installed
  THEN RETURN jsonb_build_object('state','demand_schedule_epoch_unavailable','reason','retell_source_activation_unavailable');END IF;
 END IF;
 generation:=jsonb_build_object('version','m26-demand-schedule-epoch-generation-v2','profileSourceOrder',anchor_row.source_order,'opportunityVisibilityOrder',COALESCE((SELECT max(source_order) FROM public.canonical_forecast_pipeline_eligibility_visibility_v1 WHERE organization_id=org),0),'scheduleVisibilityOrder',COALESCE((SELECT max(source_order) FROM public.canonical_forecast_pipeline_booking_visibility_v1 WHERE organization_id=org),0),'prospectiveCoverageStartedAt',public.canonical_forecast_utc_instant(installed));
 digest_value:=public.canonical_completion_digest(jsonb_build_object('id',new_id,'organizationId',org,'purpose',purpose_value,'revision',new_revision,'previousId',current_epoch.id,'installedAt',public.canonical_forecast_utc_instant(installed),'profileAnchorId',profile_anchor_value,'profileActivatedAt',public.canonical_forecast_utc_instant(activation_row.observed_at),'sourceGeneration',generation,'consentId',consent_row.id,'consentActivatedAt',public.canonical_forecast_utc_instant(consent_row.created_at),'integrationId',integration_id,'integrationActivatedAt',public.canonical_forecast_utc_instant(integration_created),'integrationUpdatedAt',public.canonical_forecast_utc_instant(integration_updated)));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_demand_schedule_epochs_v1(organization_id,purpose,id,revision,previous_id,installed_at,profile_anchor_id,profile_activation_at,profile_source_order,business_profile_id,business_profile_version,business_profile_hash,time_zone,consent_id,consent_digest,consent_activated_at,integration_ownership_id,integration_agent_id,integration_activated_at,integration_updated_at,source_generation,epoch_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest)
 VALUES(org,purpose_value,new_id,new_revision,current_epoch.id,installed,profile_anchor_value,activation_row.observed_at,anchor_row.source_order,anchor_row.business_profile_id,anchor_row.business_profile_version,anchor_row.business_profile_hash,profile_row.raw_profile#>>'{company,timeZone}',consent_row.id,consent_row.canonical_digest,consent_row.created_at,integration_id,agent_id,integration_created,integration_updated,generation,digest_value,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash);
 RETURN jsonb_build_object('state','demand_schedule_epoch_recorded','id',new_id,'purpose',purpose_value,'revision',new_revision,'installedAt',public.canonical_forecast_utc_instant(installed),'digest',digest_value,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_demand_schedule_backlog_v1_capture(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;captured JSONB;snapshot JSONB;prior public.canonical_forecast_demand_schedule_backlog_facts_v1%ROWTYPE;snapshot_row public.canonical_forecast_current_backlog_snapshots%ROWTYPE;new_id UUID:=gen_random_uuid();key_hash TEXT;request_hash TEXT;fact_value JSONB;fact_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR role_value NOT IN ('owner','admin') OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Backlog fact request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('version','m26-demand-schedule-backlog-fact-v1'));
 SELECT * INTO prior FROM public.canonical_forecast_demand_schedule_backlog_facts_v1 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_hash THEN RAISE EXCEPTION 'Backlog fact key conflict' USING ERRCODE='23505';END IF;
  SELECT * INTO snapshot_row FROM public.canonical_forecast_current_backlog_snapshots WHERE organization_id=org AND id=prior.backlog_snapshot_id;
  IF snapshot_row.id IS NULL OR public.canonical_forecast_current_backlog_snapshot_stale(snapshot_row) THEN
   PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
   RETURN jsonb_build_object('state','backlog_fact_stale','id',prior.id,'refreshRequired',TRUE,'knownSubsetOnly',TRUE,'wholeBusinessCoverageVerified',FALSE,'researchOnly',TRUE,'forecastIssued',FALSE);END IF;
  PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','backlog_fact_saved','id',prior.id,'backlogSnapshotId',prior.backlog_snapshot_id,'factDigest',rtrim(prior.fact_digest),'replayed',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE);END IF;
 captured:=public.canonical_forecast_current_backlog_snapshot_capture_v2(org,actor,role_value,session_value,csrf,public.canonical_forecast_demand_schedule_child_key_v1(key_value,'backlog'));
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 snapshot:=captured->'snapshot';
 IF snapshot IS NULL OR snapshot->>'sourceAuthenticated'<>'true' OR snapshot->>'snapshotDigest' IS NULL OR snapshot->>'sourceDigest' IS NULL THEN RETURN jsonb_build_object('state','backlog_fact_unavailable','reason','current_backlog_unavailable','researchOnly',TRUE,'forecastIssued',FALSE);END IF;
 fact_value:=jsonb_build_object('version','m26-demand-schedule-backlog-fact-v1','targetKey','demand.current_backlog_position.v1','backlogSnapshotId',snapshot->>'id','capturedAt',snapshot->>'capturedAt','state',snapshot->>'state','knownBacklogCount',(snapshot->>'knownBacklogCount')::integer,'plannedPersonMinutes',snapshot->>'plannedPersonMinutes','backlogHoursState',snapshot->>'backlogHoursState','backlogHoursReason',snapshot->>'backlogHoursReason','knownSubsetOnly',TRUE,'wholeBusinessCoverageVerified',FALSE);
 fact_hash:=public.canonical_completion_digest(fact_value);
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_demand_schedule_backlog_facts_v1(id,organization_id,backlog_snapshot_id,backlog_snapshot_digest,backlog_source_digest,fact,fact_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest)
 VALUES(new_id,org,(snapshot->>'id')::uuid,snapshot->>'snapshotDigest',snapshot->>'sourceDigest',fact_value,fact_hash,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash);
 RETURN jsonb_build_object('state','backlog_fact_saved','id',new_id,'backlogSnapshotId',snapshot->>'id','factDigest',fact_hash,'replayed',FALSE,'knownSubsetOnly',TRUE,'wholeBusinessCoverageVerified',FALSE,'researchOnly',TRUE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_demand_schedule_backlog_v1_read(org UUID,actor UUID,role_value TEXT,session_value UUID,fact_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_demand_schedule_backlog_facts_v1%ROWTYPE;current_value JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR fact_value IS NULL THEN RAISE EXCEPTION 'Backlog fact read invalid' USING ERRCODE='22023';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Backlog fact read restricted' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM public.canonical_forecast_demand_schedule_backlog_facts_v1 WHERE organization_id=org AND id=fact_value;IF saved.id IS NULL THEN RETURN NULL;END IF;
 current_value:=public.canonical_forecast_current_backlog_snapshot_read_v2(org,actor,role_value,session_value,saved.backlog_snapshot_id);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF current_value->>'sourceAuthenticated'<>'true' OR current_value->>'snapshotDigest'<>rtrim(saved.backlog_snapshot_digest) OR current_value->>'sourceDigest'<>rtrim(saved.backlog_source_digest) THEN RETURN jsonb_build_object('state','backlog_fact_stale','id',saved.id,'refreshRequired',TRUE,'knownSubsetOnly',TRUE,'wholeBusinessCoverageVerified',FALSE,'researchOnly',TRUE,'forecastIssued',FALSE);END IF;
 RETURN jsonb_build_object('state','backlog_fact_current','id',saved.id,'backlogSnapshotId',saved.backlog_snapshot_id,'factDigest',rtrim(saved.fact_digest),'knownSubsetOnly',TRUE,'wholeBusinessCoverageVerified',FALSE,'researchOnly',TRUE,'forecastIssued',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_seasonal_evaluation_v1_capture(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;saved public.canonical_forecast_seasonal_origins_v1%ROWTYPE;epoch_row public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 cert public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;current_evidence JSONB;prior public.canonical_forecast_seasonal_evaluations_v1%ROWTYPE;replay public.canonical_forecast_seasonal_evaluations_v1%ROWTYPE;
 cert_visibility public.canonical_forecast_seasonal_certification_visibility_v1%ROWTYPE;
 snapshot_row public.canonical_forecast_retell_call_snapshots%ROWTYPE;
 call_generation JSONB;
 new_id UUID:=gen_random_uuid();new_revision INTEGER;key_hash TEXT;request_hash TEXT;evidence_value JSONB;evidence_hash TEXT;metrics JSONB;metrics_hash TEXT;canonical_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value NOT IN ('owner','admin') OR origin_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Seasonal evaluation request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);PERFORM pg_advisory_xact_lock(hashtextextended('m26:seasonal-evaluation-v1:'||org||':'||origin_value,0));
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO saved FROM public.canonical_forecast_seasonal_origins_v1 WHERE organization_id=org AND id=origin_value;IF saved.id IS NULL THEN RETURN NULL;END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 IF public.canonical_forecast_demand_schedule_clock_v1()<saved.horizon_ends_at+INTERVAL '7 days' THEN RETURN jsonb_build_object('state','seasonal_evaluation_unavailable','reason','horizon_close_lag_not_elapsed','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 IF NOT public.canonical_forecast_seasonal_input_current_v1(org,actor,role_value,session_value,saved) THEN PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);RETURN jsonb_build_object('state','seasonal_evaluation_unavailable','reason','origin_input_stale','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO epoch_row FROM public.canonical_forecast_demand_schedule_epochs_v1 WHERE organization_id=org AND purpose='seasonal_inbound' AND id=saved.epoch_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:retell-period-v2:'||org||':'||saved.local_horizon_start,0));
 SELECT * INTO cert FROM public.canonical_forecast_retell_period_certifications_v2 WHERE organization_id=org AND local_month_start=saved.local_horizon_start ORDER BY revision DESC LIMIT 1;
 SELECT * INTO snapshot_row FROM public.canonical_forecast_retell_call_snapshots
  WHERE organization_id=org AND id=cert.snapshot_id;
 SELECT * INTO cert_visibility FROM public.canonical_forecast_seasonal_certification_visibility_v1 WHERE organization_id=org AND certification_id=cert.id;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 IF cert.id IS NULL OR cert.action<>'certify' OR cert_visibility.certification_id IS NULL OR cert_visibility.observed_at<saved.horizon_ends_at+INTERVAL '7 days' THEN RETURN jsonb_build_object('state','seasonal_evaluation_unavailable','reason','complete_horizon_certification_missing','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 current_evidence:=public.canonical_forecast_retell_period_evidence_v2(org,actor,role_value,session_value,cert.snapshot_id,saved.local_horizon_start);
 call_generation:=public.canonical_forecast_seasonal_call_generation_v1(
  org,saved.horizon_starts_at,saved.horizon_ends_at);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 IF current_evidence->>'state'<>'retell_period_ready_for_certification' OR public.canonical_completion_digest(current_evidence)<>rtrim(cert.evidence_digest) OR current_evidence->>'businessProfileId'<>epoch_row.business_profile_id::text OR current_evidence->>'integrationOwnershipId'<>epoch_row.integration_ownership_id::text OR snapshot_row.id IS NULL OR (call_generation->>'sourceCount')::integer<>jsonb_array_length(snapshot_row.source_manifest) OR call_generation->>'sourceManifestDigest'<>public.canonical_completion_digest(snapshot_row.source_manifest) THEN RETURN jsonb_build_object('state','seasonal_evaluation_unavailable','reason','horizon_outcome_stale_or_incomplete','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('version','m26-seasonal-evaluation-v1','originId',origin_value));
 SELECT * INTO replay FROM public.canonical_forecast_seasonal_evaluations_v1 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Seasonal evaluation key conflict' USING ERRCODE='23505';END IF;PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);IF replay.outcome_evidence#>>'{certification,digest}'<>rtrim(cert.canonical_digest) THEN RETURN jsonb_build_object('state','seasonal_evaluation_unavailable','reason','prior_evaluation_stale_new_request_required','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;RETURN jsonb_build_object('state','seasonal_evaluation_saved','id',replay.id,'originId',origin_value,'revision',replay.revision,'replayed',TRUE,'researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 SELECT * INTO prior FROM public.canonical_forecast_seasonal_evaluations_v1 WHERE organization_id=org AND origin_id=origin_value ORDER BY revision DESC LIMIT 1;new_revision:=COALESCE(prior.revision,0)+1;
 evidence_value:=jsonb_build_object('version','m26-seasonal-evaluation-evidence-v1','originId',origin_value,'horizonMonth',saved.local_horizon_start,'certification',jsonb_build_object('id',cert.id,'revision',cert.revision,'digest',rtrim(cert.canonical_digest),'evidenceDigest',rtrim(cert.evidence_digest),'snapshotId',cert.snapshot_id),'sourceObservationGeneration',call_generation,'actualLeadCount',(current_evidence->>'reviewedDistinctLeadCount')::integer,'evaluatedAfterCloseLag',TRUE);
 metrics:=jsonb_build_object('version','m26-seasonal-private-metrics-v1','predictedPoint',saved.private_output->'point','actualLeadCount',(current_evidence->>'reviewedDistinctLeadCount')::integer,'absoluteError',CASE WHEN saved.private_output->'point'='null'::jsonb THEN NULL ELSE abs((saved.private_output->>'point')::numeric-(current_evidence->>'reviewedDistinctLeadCount')::numeric) END,'empiricallyCalibrated',FALSE);
 evidence_hash:=public.canonical_completion_digest(evidence_value);metrics_hash:=public.canonical_completion_digest(metrics);canonical_hash:=public.canonical_completion_digest(jsonb_build_object('id',new_id,'originId',origin_value,'revision',new_revision,'previousId',prior.id,'outcomeDigest',evidence_hash,'metricsDigest',metrics_hash));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_seasonal_evaluations_v1(id,organization_id,origin_id,revision,previous_id,outcome_evidence,outcome_digest,private_metrics,metrics_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,origin_value,new_revision,prior.id,evidence_value,evidence_hash,metrics,metrics_hash,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state','seasonal_evaluation_saved','id',new_id,'originId',origin_value,'revision',new_revision,'replayed',FALSE,'researchOnly',TRUE,'metricsWithheld',TRUE,'calibrationClaimed',FALSE,'driftVerdictIssued',FALSE,'automaticActionTaken',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_seasonal_evaluation_v1_read(org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_seasonal_evaluations_v1%ROWTYPE;
 origin_row public.canonical_forecast_seasonal_origins_v1%ROWTYPE;
 cert public.canonical_forecast_retell_period_certifications_v2%ROWTYPE;
 input_current BOOLEAN;call_generation JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR evaluation_value IS NULL THEN RAISE EXCEPTION 'Seasonal evaluation read invalid' USING ERRCODE='22023';END IF;PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Seasonal evaluation read restricted' USING ERRCODE='42501';END IF;SELECT * INTO saved FROM public.canonical_forecast_seasonal_evaluations_v1 WHERE organization_id=org AND id=evaluation_value;IF saved.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO origin_row FROM public.canonical_forecast_seasonal_origins_v1
  WHERE organization_id=org AND id=saved.origin_id;
 input_current:=origin_row.id IS NOT NULL AND
  public.canonical_forecast_seasonal_input_current_v1(
   org,actor,role_value,session_value,origin_row);
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT input_current THEN RETURN jsonb_build_object('state','seasonal_evaluation_stale',
  'id',saved.id,'originId',saved.origin_id,'refreshRequired',TRUE,'researchOnly',TRUE,
  'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:retell-period-v2:'||org||':'||(saved.outcome_evidence->>'horizonMonth'),0));
 SELECT * INTO cert FROM public.canonical_forecast_retell_period_certifications_v2 WHERE organization_id=org AND local_month_start=(saved.outcome_evidence->>'horizonMonth')::date ORDER BY revision DESC LIMIT 1;
 call_generation:=public.canonical_forecast_seasonal_call_generation_v1(
  org,origin_row.horizon_starts_at,origin_row.horizon_ends_at);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF cert.id IS NULL OR cert.action<>'certify' OR
    rtrim(cert.canonical_digest)<>saved.outcome_evidence#>>'{certification,digest}' OR
    call_generation IS DISTINCT FROM saved.outcome_evidence->'sourceObservationGeneration' THEN
  RETURN jsonb_build_object('state','seasonal_evaluation_stale','id',saved.id,
   'originId',saved.origin_id,'refreshRequired',TRUE,'researchOnly',TRUE,
   'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE);END IF;
 RETURN jsonb_build_object('state','seasonal_evaluation_current','id',saved.id,'originId',saved.origin_id,'revision',saved.revision,'evaluatedAt',public.canonical_forecast_utc_instant(saved.evaluated_at),'researchOnly',TRUE,'metricsWithheld',TRUE,'calibrationClaimed',FALSE,'driftVerdictIssued',FALSE,'automaticActionTaken',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

-- Exact, purpose-fixed exclusive-upper-boundary booking cohorts. Unlike the
-- legacy descriptive v1 cohort, this helper never persists a caller-selected
-- window and cannot be executed by the runtime role.
CREATE FUNCTION public.canonical_forecast_pipeline_cohort_v1(org UUID,coverage_started_at TIMESTAMPTZ,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE members JSONB;eligible INTEGER;booked INTEGER;
BEGIN
 IF coverage_started_at IS NULL OR starts_at IS NULL OR ends_at IS NULL OR
    starts_at<=coverage_started_at OR ends_at<=starts_at OR
    ends_at-starts_at<>INTERVAL '720 hours' THEN
  RAISE EXCEPTION 'Pipeline cohort window invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps WHERE organization_id=org AND uncertain_from_at<=ends_at) THEN RETURN jsonb_build_object('state','unavailable','reason','schedule_lineage_gap');END IF;
 WITH candidates AS MATERIALIZED (
  SELECT DISTINCT ON (opportunity_id) source_event_id,source_order,source_digest,
   observation_digest,opportunity_id,source_visible_at,observed_at
  FROM public.canonical_forecast_pipeline_eligibility_visibility_v1
  WHERE organization_id=org AND source_visible_at>coverage_started_at AND
   source_visible_at<=starts_at AND observed_at>coverage_started_at AND observed_at<=starts_at
  ORDER BY opportunity_id,source_visible_at,observed_at,source_order
  ), eligible_candidates AS MATERIALIZED (
   SELECT c.* FROM candidates c WHERE NOT EXISTS(
    SELECT 1 FROM public.canonical_forecast_pipeline_booking_visibility_v1 e
    WHERE e.organization_id=org AND e.opportunity_id=c.opportunity_id
     AND e.source_occurred_at<=starts_at AND e.observed_at>coverage_started_at)
  ), bounded AS (SELECT * FROM eligible_candidates ORDER BY opportunity_id LIMIT 501), cohort AS (
  SELECT c.*,accepted.source_event_id accepted_event_id,
   accepted.assignment_id accepted_assignment_id,
   accepted.appointment_id accepted_appointment_id,
   accepted.source_order accepted_source_order,accepted.source_occurred_at accepted_at,
   accepted.observed_at accepted_observed_at,
   accepted.source_digest accepted_event_digest
  FROM bounded c LEFT JOIN LATERAL(
   SELECT e.* FROM public.canonical_forecast_pipeline_booking_visibility_v1 e
   WHERE e.organization_id=org AND e.opportunity_id=c.opportunity_id
    AND e.source_occurred_at>starts_at AND e.source_occurred_at<ends_at
    AND e.observed_at>coverage_started_at
   ORDER BY e.source_occurred_at,e.source_order LIMIT 1) accepted ON TRUE
 ) SELECT count(*)::integer,count(accepted_event_id)::integer,
 COALESCE(jsonb_agg(jsonb_build_object('opportunitySourceEventId',source_event_id,
 'opportunitySourceOrder',source_order,'opportunitySourceDigest',rtrim(source_digest),
 'opportunityObservationDigest',rtrim(observation_digest),'opportunityId',opportunity_id,
 'eligibleAt',public.canonical_forecast_utc_instant(source_visible_at),
 'eligibilityObservedAt',public.canonical_forecast_utc_instant(observed_at),
 'acceptedEventId',accepted_event_id,'acceptedAssignmentId',accepted_assignment_id,
 'acceptedAppointmentId',accepted_appointment_id,'acceptedSourceOrder',accepted_source_order,
 'acceptedAt',public.canonical_forecast_utc_instant(accepted_at),
 'acceptedObservedAt',public.canonical_forecast_utc_instant(accepted_observed_at),
 'acceptedEventDigest',CASE WHEN accepted_event_digest IS NULL THEN NULL ELSE rtrim(accepted_event_digest) END)
 ORDER BY opportunity_id),'[]'::jsonb) INTO eligible,booked,members FROM cohort;
 IF eligible>500 OR octet_length(members::text)>262144 THEN RAISE EXCEPTION 'Pipeline cohort exceeds bounded size' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('state','complete','startsAt',public.canonical_forecast_utc_instant(starts_at),'endsAt',public.canonical_forecast_utc_instant(ends_at),'eligibleCount',eligible,'firstBookedCount',booked,'members',members,'digest',public.canonical_completion_digest(jsonb_build_object('organizationId',org,'startsAt',public.canonical_forecast_utc_instant(starts_at),'endsAt',public.canonical_forecast_utc_instant(ends_at),'members',members)));
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_risk_v1(org UUID,coverage_started_at TIMESTAMPTZ,cutoff_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE members JSONB;eligible INTEGER;
BEGIN
 IF coverage_started_at IS NULL OR cutoff_at IS NULL OR cutoff_at<=coverage_started_at THEN RAISE EXCEPTION 'Pipeline risk cutoff invalid' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps WHERE organization_id=org AND uncertain_from_at<=cutoff_at) THEN RETURN jsonb_build_object('state','unavailable','reason','schedule_lineage_gap');END IF;
 WITH candidates AS MATERIALIZED (SELECT DISTINCT ON (opportunity_id)
  source_event_id,source_order,source_digest,observation_digest,opportunity_id,
  source_visible_at,observed_at
  FROM public.canonical_forecast_pipeline_eligibility_visibility_v1
  WHERE organization_id=org AND source_visible_at>coverage_started_at AND
   source_visible_at<=cutoff_at AND observed_at>coverage_started_at AND observed_at<=cutoff_at
  ORDER BY opportunity_id,source_visible_at,observed_at,source_order),
 eligible_candidates AS MATERIALIZED (SELECT c.* FROM candidates c WHERE NOT EXISTS(
   SELECT 1 FROM public.canonical_forecast_pipeline_booking_visibility_v1 e
   WHERE e.organization_id=org AND e.opportunity_id=c.opportunity_id
    AND e.source_occurred_at<=cutoff_at AND e.observed_at>coverage_started_at)),
 bounded AS (SELECT * FROM eligible_candidates ORDER BY opportunity_id LIMIT 501),
 cohort AS (SELECT c.* FROM bounded c)
 SELECT count(*)::integer,COALESCE(jsonb_agg(jsonb_build_object(
  'opportunitySourceEventId',source_event_id,'opportunitySourceOrder',source_order,
 'opportunitySourceDigest',rtrim(source_digest),
 'opportunityObservationDigest',rtrim(observation_digest),'opportunityId',opportunity_id,
 'eligibleAt',public.canonical_forecast_utc_instant(source_visible_at),
 'eligibilityObservedAt',public.canonical_forecast_utc_instant(observed_at))
 ORDER BY opportunity_id),'[]'::jsonb)
 INTO eligible,members FROM cohort;
 IF eligible>500 OR octet_length(members::text)>262144 THEN RAISE EXCEPTION 'Pipeline risk exceeds bounded size' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('state','complete','cutoffAt',public.canonical_forecast_utc_instant(cutoff_at),'eligibleCount',eligible,'members',members,'digest',public.canonical_completion_digest(jsonb_build_object('organizationId',org,'cutoffAt',public.canonical_forecast_utc_instant(cutoff_at),'members',members)));
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_origin_v1_capture(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_row public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;method_row public.canonical_forecast_demand_schedule_methods_v1%ROWTYPE;review_row public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;
 prior public.canonical_forecast_pipeline_origins_v1%ROWTYPE;cutoff TIMESTAMPTZ;horizon TIMESTAMPTZ;first_window JSONB;second_window JSONB;current_risk JSONB;first_profile JSONB;second_profile JSONB;
 key_hash TEXT;request_hash TEXT;evidence_value JSONB;evidence_hash TEXT;output_value JSONB;output_hash TEXT;canonical_hash TEXT;new_id UUID:=gen_random_uuid();historical_eligible BIGINT;historical_booked BIGINT;current_eligible BIGINT;expected_count NUMERIC;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value NOT IN ('owner','admin') OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Pipeline origin request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-epoch:'||org||':pipeline_first_booking',0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-method:'||org||':pipeline_first_booking',0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||org,0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||org,0));
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('version','m26-pipeline-first-booking-origin-v1'));
 SELECT * INTO prior FROM public.canonical_forecast_pipeline_origins_v1 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF prior.id IS NOT NULL THEN
  IF rtrim(prior.request_digest)<>request_hash THEN RAISE EXCEPTION 'Pipeline origin key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_pipeline_origin_input_current_v1(org,prior) THEN
   PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
   RETURN jsonb_build_object('state','pipeline_origin_stale','id',prior.id,'refreshRequired',TRUE,'researchOnly',TRUE,'countWithheld',TRUE,'outputDigestWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
  PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','pipeline_origin_saved','id',prior.id,'predictionCutoffAt',public.canonical_forecast_utc_instant(prior.prediction_cutoff_at),'horizonEndsAt',public.canonical_forecast_utc_instant(prior.horizon_ends_at),'replayed',TRUE,'researchOnly',TRUE,'countWithheld',TRUE,'outputDigestWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 SELECT * INTO epoch_row FROM public.canonical_forecast_demand_schedule_epochs_v1 WHERE organization_id=org AND purpose='pipeline_first_booking' ORDER BY revision DESC LIMIT 1;SELECT * INTO method_row FROM public.canonical_forecast_demand_schedule_methods_v1 WHERE purpose='pipeline_first_booking';SELECT * INTO review_row FROM public.canonical_forecast_demand_schedule_method_reviews_v1 WHERE organization_id=org AND purpose='pipeline_first_booking' ORDER BY revision DESC LIMIT 1;
 cutoff:=public.canonical_forecast_demand_schedule_clock_v1();horizon:=cutoff+INTERVAL '720 hours';
 IF epoch_row.id IS NULL OR epoch_row.installed_at>=cutoff-INTERVAL '1440 hours' OR review_row.id IS NULL OR review_row.action<>'approve' OR review_row.method_id<>method_row.id OR review_row.method_digest<>method_row.method_digest OR EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events WHERE organization_id=org AND source_order>epoch_row.profile_source_order) THEN RETURN jsonb_build_object('state','pipeline_origin_unavailable','reason','prospective_epoch_profile_or_review_unavailable','researchOnly',TRUE,'countWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 first_profile:=public.canonical_forecast_profile_effective_window(org,actor,role_value,session_value,epoch_row.profile_anchor_id,cutoff-INTERVAL '1440 hours',cutoff-INTERVAL '720 hours');second_profile:=public.canonical_forecast_profile_effective_window(org,actor,role_value,session_value,epoch_row.profile_anchor_id,cutoff-INTERVAL '720 hours',cutoff);
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF first_profile->>'state'<>'profile_effective_window_verified' OR second_profile->>'state'<>'profile_effective_window_verified' THEN RETURN jsonb_build_object('state','pipeline_origin_unavailable','reason','prospective_profile_window_unavailable','researchOnly',TRUE,'countWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 first_window:=public.canonical_forecast_pipeline_cohort_v1(org,epoch_row.installed_at,cutoff-INTERVAL '1440 hours',cutoff-INTERVAL '720 hours');second_window:=public.canonical_forecast_pipeline_cohort_v1(org,epoch_row.installed_at,cutoff-INTERVAL '720 hours',cutoff);current_risk:=public.canonical_forecast_pipeline_risk_v1(org,epoch_row.installed_at,cutoff);
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF first_window->>'state'<>'complete' OR second_window->>'state'<>'complete' OR current_risk->>'state'<>'complete' THEN RETURN jsonb_build_object('state','pipeline_origin_unavailable','reason','complete_same_population_windows_unavailable','researchOnly',TRUE,'countWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 historical_eligible:=(first_window->>'eligibleCount')::bigint+(second_window->>'eligibleCount')::bigint;historical_booked:=(first_window->>'firstBookedCount')::bigint+(second_window->>'firstBookedCount')::bigint;current_eligible:=(current_risk->>'eligibleCount')::bigint;
 IF historical_eligible+current_eligible>500 OR
     octet_length(jsonb_build_object('trainingWindows',jsonb_build_array(first_window,second_window),'currentRisk',current_risk)::text)>262144 THEN
  RAISE EXCEPTION 'Pipeline complete population exceeds aggregate bounded size' USING ERRCODE='54000';END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF current_eligible=0 THEN expected_count:=0;ELSIF historical_eligible=0 THEN RETURN jsonb_build_object('state','pipeline_origin_unavailable','reason','historical_denominator_zero','researchOnly',TRUE,'countWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);ELSE expected_count:=round(current_eligible::numeric*historical_booked::numeric/historical_eligible::numeric,6);END IF;
 evidence_value:=jsonb_build_object('version','m26-pipeline-first-booking-evidence-v1','targetKey','demand.pipeline_first_accepted_bookings','targetVersion','v1','unit','first_accepted_bookings','predictionCutoffAt',public.canonical_forecast_utc_instant(cutoff),'horizonEndsAt',public.canonical_forecast_utc_instant(horizon),'upperBoundary','exclusive','epochId',epoch_row.id,'epochDigest',rtrim(epoch_row.epoch_digest),'profileAnchorId',epoch_row.profile_anchor_id,'businessProfileId',epoch_row.business_profile_id,'businessProfileVersion',epoch_row.business_profile_version,'businessProfileHash',rtrim(epoch_row.business_profile_hash),'timeZone',epoch_row.time_zone,'methodId',method_row.id,'methodDigest',rtrim(method_row.method_digest),'methodReviewId',review_row.id,'methodReviewRevision',review_row.revision,'methodReviewDigest',rtrim(review_row.review_digest),'calculationVersion',method_row.calculation_version,'trainingWindows',jsonb_build_array(first_window,second_window),'currentRisk',current_risk,'sourceCoverageScope','post_epoch_northstar_eligible_opportunities_only','postCutoffEntrantsExcluded',TRUE,'cancellationDoesNotEraseFirstBooking',TRUE,'retellCouplingAvailable',FALSE);
 output_value:=jsonb_build_object('version','m26-pipeline-first-booking-private-output-v1','expectedCount',expected_count,'currentEligibleCount',current_eligible,'historicalEligibleCount',historical_eligible,'historicalFirstBookedCount',historical_booked,'uncertaintyState','unavailable_not_empirically_calibrated','researchOnly',TRUE,'realForecastEligible',FALSE);
 evidence_hash:=public.canonical_completion_digest(evidence_value);output_hash:=public.canonical_completion_digest(output_value);canonical_hash:=public.canonical_completion_digest(jsonb_build_object('id',new_id,'organizationId',org,'evidenceDigest',evidence_hash,'outputDigest',output_hash,'actorUserId',actor));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_pipeline_origins_v1(id,organization_id,as_of,prediction_cutoff_at,horizon_ends_at,epoch_id,method_review_id,evidence,evidence_digest,private_output,output_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,cutoff,cutoff,horizon,epoch_row.id,review_row.id,evidence_value,evidence_hash,output_value,output_hash,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state','pipeline_origin_saved','id',new_id,'predictionCutoffAt',public.canonical_forecast_utc_instant(cutoff),'horizonEndsAt',public.canonical_forecast_utc_instant(horizon),'targetKey','demand.pipeline_first_accepted_bookings','targetVersion','v1','unit','first_accepted_bookings','replayed',FALSE,'sourceCoverageComplete',TRUE,'sourceCoverageScope','post_epoch_northstar_eligible_opportunities_only','retellCouplingAvailable',FALSE,'researchOnly',TRUE,'countWithheld',TRUE,'outputDigestWithheld',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_origin_input_current_v1(org UUID,saved public.canonical_forecast_pipeline_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_window JSONB;second_window JSONB;current_risk JSONB;
 latest_review public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;
 epoch_row public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:demand-schedule-epoch:'||org||':pipeline_first_booking',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'm26:demand-schedule-method:'||org||':pipeline_first_booking',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||org,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||org,0));
 SELECT * INTO latest_review FROM public.canonical_forecast_demand_schedule_method_reviews_v1
  WHERE organization_id=org AND purpose='pipeline_first_booking'
  ORDER BY revision DESC LIMIT 1;
 SELECT * INTO epoch_row FROM public.canonical_forecast_demand_schedule_epochs_v1
  WHERE organization_id=org AND purpose='pipeline_first_booking'
  ORDER BY revision DESC LIMIT 1;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=epoch_row.business_profile_id AND is_active;
 IF epoch_row.id IS DISTINCT FROM saved.epoch_id OR
    latest_review.id IS DISTINCT FROM saved.method_review_id OR
    latest_review.action<>'approve' OR profile_row.id IS NULL OR
    profile_row.version_number<>epoch_row.business_profile_version OR
    profile_row.normalized_profile_hash<>epoch_row.business_profile_hash OR
    EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events
      WHERE organization_id=org AND source_order>epoch_row.profile_source_order)
 THEN RETURN FALSE;END IF;
 first_window:=public.canonical_forecast_pipeline_cohort_v1(org,epoch_row.installed_at,saved.prediction_cutoff_at-INTERVAL '1440 hours',saved.prediction_cutoff_at-INTERVAL '720 hours');second_window:=public.canonical_forecast_pipeline_cohort_v1(org,epoch_row.installed_at,saved.prediction_cutoff_at-INTERVAL '720 hours',saved.prediction_cutoff_at);current_risk:=public.canonical_forecast_pipeline_risk_v1(org,epoch_row.installed_at,saved.prediction_cutoff_at);
 RETURN first_window->>'digest'=saved.evidence#>>'{trainingWindows,0,digest}' AND second_window->>'digest'=saved.evidence#>>'{trainingWindows,1,digest}' AND current_risk->>'digest'=saved.evidence#>>'{currentRisk,digest}';
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_origin_v1_read(org UUID,actor UUID,role_value TEXT,session_value UUID,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_pipeline_origins_v1%ROWTYPE;latest_review public.canonical_forecast_demand_schedule_method_reviews_v1%ROWTYPE;epoch_row public.canonical_forecast_demand_schedule_epochs_v1%ROWTYPE;input_current BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR origin_value IS NULL THEN RAISE EXCEPTION 'Pipeline origin read invalid' USING ERRCODE='22023';END IF;PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Pipeline origin read restricted' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM public.canonical_forecast_pipeline_origins_v1 WHERE organization_id=org AND id=origin_value;IF saved.id IS NULL THEN RETURN NULL;END IF;SELECT * INTO latest_review FROM public.canonical_forecast_demand_schedule_method_reviews_v1 WHERE organization_id=org AND purpose='pipeline_first_booking' ORDER BY revision DESC LIMIT 1;SELECT * INTO epoch_row FROM public.canonical_forecast_demand_schedule_epochs_v1 WHERE organization_id=org AND purpose='pipeline_first_booking' AND id=saved.epoch_id;
 input_current:=public.canonical_forecast_pipeline_origin_input_current_v1(org,saved);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF latest_review.id IS DISTINCT FROM saved.method_review_id OR latest_review.action<>'approve' OR EXISTS(SELECT 1 FROM public.canonical_forecast_profile_change_events WHERE organization_id=org AND source_order>epoch_row.profile_source_order) OR NOT input_current THEN RETURN jsonb_build_object('state','pipeline_origin_stale','id',saved.id,'refreshRequired',TRUE,'researchOnly',TRUE,'countWithheld',TRUE,'outputDigestWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 RETURN jsonb_build_object('state','pipeline_origin_current','id',saved.id,'predictionCutoffAt',public.canonical_forecast_utc_instant(saved.prediction_cutoff_at),'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),'targetKey','demand.pipeline_first_accepted_bookings','targetVersion','v1','unit','first_accepted_bookings','sourceCoverageComplete',TRUE,'sourceCoverageScope','post_epoch_northstar_eligible_opportunities_only','postCutoffEntrantsExcluded',TRUE,'cancellationDoesNotEraseFirstBooking',TRUE,'retellCouplingAvailable',FALSE,'uncertaintyState','unavailable_not_empirically_calibrated','researchOnly',TRUE,'countWithheld',TRUE,'outputDigestWithheld',TRUE,'realForecastEligible',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_outcome_v1(org UUID,saved public.canonical_forecast_pipeline_origins_v1)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipts JSONB;actual_count INTEGER;member_count INTEGER;source_high_water BIGINT;
BEGIN
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps WHERE organization_id=org AND uncertain_from_at<=saved.horizon_ends_at) THEN RETURN jsonb_build_object('state','unavailable','reason','schedule_lineage_gap');END IF;
 SELECT count(*) INTO member_count FROM jsonb_array_elements(saved.evidence#>'{currentRisk,members}');
 WITH members AS (SELECT (value->>'opportunityId')::uuid opportunity_id
  FROM jsonb_array_elements(saved.evidence#>'{currentRisk,members}') value)
 SELECT COALESCE(max(observation.source_order),0) INTO source_high_water
 FROM public.canonical_forecast_pipeline_booking_visibility_v1 observation
 JOIN members member ON member.opportunity_id=observation.opportunity_id
 WHERE observation.organization_id=org
  AND observation.source_occurred_at>saved.prediction_cutoff_at
  AND observation.source_occurred_at<saved.horizon_ends_at;
 WITH members AS (SELECT (value->>'opportunityId')::uuid opportunity_id FROM jsonb_array_elements(saved.evidence#>'{currentRisk,members}') value),outcomes AS (
  SELECT member.opportunity_id,accepted.source_event_id accepted_event_id,
   accepted.assignment_id,accepted.appointment_id,accepted.source_order,
   accepted.source_occurred_at,accepted.observed_at,accepted.source_digest,
   accepted.observation_digest
  FROM members member LEFT JOIN LATERAL(
   SELECT event_value.* FROM public.canonical_forecast_pipeline_booking_visibility_v1 event_value
  WHERE event_value.organization_id=org AND event_value.opportunity_id=member.opportunity_id
    AND event_value.source_occurred_at>saved.prediction_cutoff_at
    AND event_value.source_occurred_at<saved.horizon_ends_at
   ORDER BY event_value.source_occurred_at,event_value.source_order LIMIT 1) accepted ON TRUE)
 SELECT count(accepted_event_id)::integer,COALESCE(jsonb_agg(jsonb_build_object(
  'opportunityId',opportunity_id,'acceptedEventId',accepted_event_id,
  'assignmentId',assignment_id,'appointmentId',appointment_id,'sourceOrder',source_order,
  'sourceOccurredAt',public.canonical_forecast_utc_instant(source_occurred_at),
  'observedAt',public.canonical_forecast_utc_instant(observed_at),
  'eventDigest',CASE WHEN source_digest IS NULL THEN NULL ELSE rtrim(source_digest) END,
  'observationDigest',CASE WHEN observation_digest IS NULL THEN NULL ELSE rtrim(observation_digest) END)
  ORDER BY opportunity_id),'[]'::jsonb) INTO actual_count,receipts FROM outcomes;
 IF jsonb_array_length(receipts)<>member_count OR octet_length(receipts::text)>262144 THEN RAISE EXCEPTION 'Pipeline outcome exceeds bounded size' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('state','complete','memberCount',member_count,
  'actualFirstBookedCount',actual_count,'outcomeSourceHighWaterOrder',source_high_water,
  'outcomeCompletedThrough',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
  'receipts',receipts,'digest',public.canonical_completion_digest(jsonb_build_object(
   'originId',saved.id,'predictionCutoffAt',public.canonical_forecast_utc_instant(saved.prediction_cutoff_at),
   'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),
   'outcomeSourceHighWaterOrder',source_high_water,'receipts',receipts)));
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_evaluation_v1_capture(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;saved public.canonical_forecast_pipeline_origins_v1%ROWTYPE;outcome JSONB;prior public.canonical_forecast_pipeline_evaluations_v1%ROWTYPE;replay public.canonical_forecast_pipeline_evaluations_v1%ROWTYPE;
 new_id UUID:=gen_random_uuid();new_revision INTEGER;key_hash TEXT;request_hash TEXT;evidence_value JSONB;evidence_hash TEXT;metrics JSONB;metrics_hash TEXT;canonical_hash TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR role_value NOT IN ('owner','admin') OR origin_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN RAISE EXCEPTION 'Pipeline evaluation request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-epoch:'||org||':pipeline_first_booking',0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-method:'||org||':pipeline_first_booking',0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||org,0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||org,0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:pipeline-evaluation-v1:'||org||':'||origin_value,0));
 SELECT * INTO saved FROM public.canonical_forecast_pipeline_origins_v1 WHERE organization_id=org AND id=origin_value;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 IF saved.id IS NULL THEN RETURN NULL;END IF;
 IF public.canonical_forecast_demand_schedule_clock_v1()<saved.horizon_ends_at THEN RETURN jsonb_build_object('state','pipeline_evaluation_unavailable','reason','horizon_not_ended','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 IF NOT public.canonical_forecast_pipeline_origin_input_current_v1(org,saved) THEN PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);RETURN jsonb_build_object('state','pipeline_evaluation_unavailable','reason','origin_input_stale','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 outcome:=public.canonical_forecast_pipeline_outcome_v1(org,saved);
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);
 IF outcome->>'state'<>'complete' THEN RETURN jsonb_build_object('state','pipeline_evaluation_unavailable','reason','complete_outcome_unavailable','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('version','m26-pipeline-evaluation-v1','originId',origin_value));SELECT * INTO replay FROM public.canonical_forecast_pipeline_evaluations_v1 WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Pipeline evaluation key conflict' USING ERRCODE='23505';END IF;PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,csrf,TRUE);IF replay.outcome_evidence->>'outcomeDigest'<>outcome->>'digest' THEN RETURN jsonb_build_object('state','pipeline_evaluation_unavailable','reason','prior_evaluation_stale_new_request_required','researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;RETURN jsonb_build_object('state','pipeline_evaluation_saved','id',replay.id,'originId',origin_value,'revision',replay.revision,'replayed',TRUE,'researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 SELECT * INTO prior FROM public.canonical_forecast_pipeline_evaluations_v1 WHERE organization_id=org AND origin_id=origin_value ORDER BY revision DESC LIMIT 1;new_revision:=COALESCE(prior.revision,0)+1;
 evidence_value:=jsonb_build_object('version','m26-pipeline-evaluation-evidence-v1','originId',origin_value,'predictionCutoffAt',public.canonical_forecast_utc_instant(saved.prediction_cutoff_at),'horizonEndsAt',public.canonical_forecast_utc_instant(saved.horizon_ends_at),'upperBoundary','exclusive','outcomeDigest',outcome->>'digest','outcomeSourceHighWaterOrder',(outcome->>'outcomeSourceHighWaterOrder')::bigint,'outcomeCompletedThrough',outcome->>'outcomeCompletedThrough','memberCount',(outcome->>'memberCount')::integer,'actualFirstBookedCount',(outcome->>'actualFirstBookedCount')::integer,'receipts',outcome->'receipts');metrics:=jsonb_build_object('version','m26-pipeline-private-metrics-v1','predictedCount',saved.private_output->'expectedCount','actualFirstBookedCount',(outcome->>'actualFirstBookedCount')::integer,'absoluteError',abs((saved.private_output->>'expectedCount')::numeric-(outcome->>'actualFirstBookedCount')::numeric),'empiricallyCalibrated',FALSE);
 evidence_hash:=public.canonical_completion_digest(evidence_value);metrics_hash:=public.canonical_completion_digest(metrics);canonical_hash:=public.canonical_completion_digest(jsonb_build_object('id',new_id,'originId',origin_value,'revision',new_revision,'previousId',prior.id,'outcomeDigest',evidence_hash,'metricsDigest',metrics_hash));
 authority:=public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_pipeline_evaluations_v1(id,organization_id,origin_id,revision,previous_id,outcome_evidence,outcome_digest,private_metrics,metrics_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,canonical_digest)
 VALUES(new_id,org,origin_value,new_revision,prior.id,evidence_value,evidence_hash,metrics,metrics_hash,actor,(authority->>'membershipId')::uuid,session_value,key_hash,request_hash,canonical_hash);
 RETURN jsonb_build_object('state','pipeline_evaluation_saved','id',new_id,'originId',origin_value,'revision',new_revision,'replayed',FALSE,'researchOnly',TRUE,'metricsWithheld',TRUE,'calibrationClaimed',FALSE,'driftVerdictIssued',FALSE,'automaticActionTaken',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_pipeline_evaluation_v1_read(org UUID,actor UUID,role_value TEXT,session_value UUID,evaluation_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.canonical_forecast_pipeline_evaluations_v1%ROWTYPE;origin_row public.canonical_forecast_pipeline_origins_v1%ROWTYPE;outcome JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR evaluation_value IS NULL THEN RAISE EXCEPTION 'Pipeline evaluation read invalid' USING ERRCODE='22023';END IF;PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);IF role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Pipeline evaluation read restricted' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-epoch:'||org||':pipeline_first_booking',0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:demand-schedule-method:'||org||':pipeline_first_booking',0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:profile-effective-source:'||org,0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:opportunity-eligibility:'||org,0));PERFORM pg_advisory_xact_lock(hashtextextended('m26:schedule-booking-events:'||org,0));
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO saved FROM public.canonical_forecast_pipeline_evaluations_v1 WHERE organization_id=org AND id=evaluation_value;IF saved.id IS NULL THEN RETURN NULL;END IF;SELECT * INTO origin_row FROM public.canonical_forecast_pipeline_origins_v1 WHERE organization_id=org AND id=saved.origin_id;
 outcome:=public.canonical_forecast_pipeline_outcome_v1(org,origin_row);IF NOT public.canonical_forecast_pipeline_origin_input_current_v1(org,origin_row) OR outcome->>'state'<>'complete' OR outcome->>'digest'<>saved.outcome_evidence->>'outcomeDigest' THEN PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);RETURN jsonb_build_object('state','pipeline_evaluation_stale','id',saved.id,'originId',saved.origin_id,'refreshRequired',TRUE,'researchOnly',TRUE,'metricsWithheld',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);END IF;
 PERFORM public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','pipeline_evaluation_current','id',saved.id,'originId',saved.origin_id,'revision',saved.revision,'evaluatedAt',public.canonical_forecast_utc_instant(saved.evaluated_at),'researchOnly',TRUE,'metricsWithheld',TRUE,'calibrationClaimed',FALSE,'driftVerdictIssued',FALSE,'automaticActionTaken',FALSE,'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_demand_schedule_epochs_v1,public.canonical_forecast_demand_schedule_methods_v1,public.canonical_forecast_demand_schedule_method_reviews_v1,public.canonical_forecast_demand_schedule_backlog_facts_v1,public.canonical_forecast_seasonal_origins_v1,public.canonical_forecast_seasonal_evaluations_v1,public.canonical_forecast_pipeline_origins_v1,public.canonical_forecast_pipeline_evaluations_v1,public.canonical_forecast_pipeline_eligibility_visibility_v1,public.canonical_forecast_pipeline_booking_visibility_v1,public.canonical_forecast_seasonal_certification_visibility_v1,public.canonical_forecast_seasonal_call_visibility_v1,public.canonical_forecast_demand_schedule_test_clock_v1,public.canonical_forecast_demand_schedule_source_test_clock_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_demand_schedule_clock_v1(),public.canonical_forecast_demand_schedule_test_clock_v1_set(TIMESTAMPTZ),public.canonical_forecast_demand_schedule_source_test_clock_v1_set(TIMESTAMPTZ),public.canonical_forecast_demand_schedule_source_clock_v1_apply(),public.canonical_forecast_pipeline_eligibility_visibility_v1_capture(),public.canonical_forecast_pipeline_booking_visibility_v1_capture(),public.canonical_forecast_seasonal_certification_visibility_v1_capture(),public.canonical_forecast_seasonal_call_visibility_v1_capture(),public.canonical_forecast_seasonal_call_generation_v1(UUID,TIMESTAMPTZ,TIMESTAMPTZ),public.canonical_forecast_demand_schedule_child_key_v1(TEXT,TEXT),public.canonical_forecast_seasonal_signal_v1(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC),public.canonical_forecast_seasonal_training_v1(UUID,UUID,TEXT,UUID,DATE),public.canonical_forecast_seasonal_input_current_v1(UUID,UUID,TEXT,UUID,public.canonical_forecast_seasonal_origins_v1),public.canonical_forecast_demand_schedule_epoch_current_v1(UUID,public.canonical_forecast_demand_schedule_epochs_v1),public.canonical_forecast_pipeline_cohort_v1(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ),public.canonical_forecast_pipeline_risk_v1(UUID,TIMESTAMPTZ,TIMESTAMPTZ),public.canonical_forecast_pipeline_origin_input_current_v1(UUID,public.canonical_forecast_pipeline_origins_v1),public.canonical_forecast_pipeline_outcome_v1(UUID,public.canonical_forecast_pipeline_origins_v1) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_demand_schedule_method_review_v1_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT),public.canonical_forecast_demand_schedule_epoch_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,UUID),public.canonical_forecast_demand_schedule_backlog_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT),public.canonical_forecast_demand_schedule_backlog_v1_read(UUID,UUID,TEXT,UUID,UUID),public.canonical_forecast_seasonal_origin_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT,DATE),public.canonical_forecast_seasonal_origin_v1_read(UUID,UUID,TEXT,UUID,UUID),public.canonical_forecast_seasonal_evaluation_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID),public.canonical_forecast_seasonal_evaluation_v1_read(UUID,UUID,TEXT,UUID,UUID),public.canonical_forecast_pipeline_origin_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT),public.canonical_forecast_pipeline_origin_v1_read(UUID,UUID,TEXT,UUID,UUID),public.canonical_forecast_pipeline_evaluation_v1_capture(UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID),public.canonical_forecast_pipeline_evaluation_v1_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;

DO $acl$ DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_demand_schedule_epochs_v1,public.canonical_forecast_demand_schedule_methods_v1,public.canonical_forecast_demand_schedule_method_reviews_v1,public.canonical_forecast_demand_schedule_backlog_facts_v1,public.canonical_forecast_seasonal_origins_v1,public.canonical_forecast_seasonal_evaluations_v1,public.canonical_forecast_pipeline_origins_v1,public.canonical_forecast_pipeline_evaluations_v1,public.canonical_forecast_pipeline_eligibility_visibility_v1,public.canonical_forecast_pipeline_booking_visibility_v1,public.canonical_forecast_seasonal_certification_visibility_v1,public.canonical_forecast_seasonal_call_visibility_v1,public.canonical_forecast_demand_schedule_test_clock_v1,public.canonical_forecast_demand_schedule_source_test_clock_v1 FROM %I',runtime_role);
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.canonical_forecast_demand_schedule_clock_v1(),public.canonical_forecast_demand_schedule_test_clock_v1_set(timestamptz),public.canonical_forecast_demand_schedule_source_test_clock_v1_set(timestamptz),public.canonical_forecast_demand_schedule_source_clock_v1_apply(),public.canonical_forecast_pipeline_eligibility_visibility_v1_capture(),public.canonical_forecast_pipeline_booking_visibility_v1_capture(),public.canonical_forecast_seasonal_certification_visibility_v1_capture(),public.canonical_forecast_seasonal_call_visibility_v1_capture(),public.canonical_forecast_seasonal_call_generation_v1(uuid,timestamptz,timestamptz),public.canonical_forecast_demand_schedule_child_key_v1(text,text),public.canonical_forecast_seasonal_signal_v1(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric),public.canonical_forecast_seasonal_training_v1(uuid,uuid,text,uuid,date),public.canonical_forecast_seasonal_input_current_v1(uuid,uuid,text,uuid,public.canonical_forecast_seasonal_origins_v1),public.canonical_forecast_demand_schedule_epoch_current_v1(uuid,public.canonical_forecast_demand_schedule_epochs_v1),public.canonical_forecast_pipeline_cohort_v1(uuid,timestamptz,timestamptz,timestamptz),public.canonical_forecast_pipeline_risk_v1(uuid,timestamptz,timestamptz),public.canonical_forecast_pipeline_origin_input_current_v1(uuid,public.canonical_forecast_pipeline_origins_v1),public.canonical_forecast_pipeline_outcome_v1(uuid,public.canonical_forecast_pipeline_origins_v1) FROM %I',runtime_role);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_demand_schedule_method_review_v1_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text,text),public.canonical_forecast_demand_schedule_epoch_v1_capture(uuid,uuid,text,uuid,text,text,text,uuid),public.canonical_forecast_demand_schedule_backlog_v1_capture(uuid,uuid,text,uuid,text,text),public.canonical_forecast_demand_schedule_backlog_v1_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_seasonal_origin_v1_capture(uuid,uuid,text,uuid,text,text,date),public.canonical_forecast_seasonal_origin_v1_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_seasonal_evaluation_v1_capture(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_seasonal_evaluation_v1_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_pipeline_origin_v1_capture(uuid,uuid,text,uuid,text,text),public.canonical_forecast_pipeline_origin_v1_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_pipeline_evaluation_v1_capture(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_pipeline_evaluation_v1_read(uuid,uuid,text,uuid,uuid) TO %I',runtime_role);
 END IF;
END $acl$;
