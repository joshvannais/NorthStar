-- Mission 26 Part 5A: prospective, tenant-private workload and base-capacity
-- research authority. Additive only; migrations 001-223 and their routes keep
-- their existing contracts. No schedule, dispatch, estimate, employment or
-- commercial action is performed by this authority.

-- M23's deferred completeness checks run at COMMIT, after the guarded runtime
-- entry has written its immutable parent and event rows.  The runtime role is
-- intentionally denied direct table/helper access, so the original
-- security-invoker validators could not complete a legitimate runtime write.
-- Run only the deferred integrity checks with the migration owner's existing
-- privileges; the owning M23 entry functions and all of their authorization,
-- chronology and immutable-row guards remain unchanged.
ALTER FUNCTION public.canonical_field_execution_validate_complete() SECURITY DEFINER;
ALTER FUNCTION public.canonical_labor_validate_complete() SECURITY DEFINER;
ALTER FUNCTION public.canonical_completion_validate_complete() SECURITY DEFINER;

CREATE TABLE public.canonical_forecast_workload_capacity_test_clock_v1 (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 instant_value TIMESTAMPTZ NOT NULL
);

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_clock()
RETURNS TIMESTAMPTZ LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value TIMESTAMPTZ;
BEGIN
 SELECT instant_value INTO value
 FROM public.canonical_forecast_workload_capacity_test_clock_v1 WHERE singleton;
 RETURN COALESCE(value,clock_timestamp());
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_test_clock_set(value TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_setting('northstar.m26_part5a_disposable_clock',TRUE)<>'enabled'
    OR current_user=NULLIF(current_setting('northstar.runtime_role',TRUE),'') THEN
  RAISE EXCEPTION 'Disposable workload clock unavailable' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.canonical_forecast_workload_capacity_test_clock_v1(singleton,instant_value)
 VALUES(TRUE,value) ON CONFLICT(singleton) DO UPDATE SET instant_value=EXCLUDED.instant_value;
END $$;

-- Disposable acceptance databases need genuine chronological owner actions on
-- the owning M23 completion path.  Production has no clock row, and runtime is
-- denied both the table and setter, so ordinary deployments retain the owning
-- source's transaction timestamp.  This trigger never updates existing rows.
CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_completion_clock()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value TIMESTAMPTZ;
BEGIN
 SELECT instant_value INTO value
 FROM public.canonical_forecast_workload_capacity_test_clock_v1 WHERE singleton;
 IF FOUND THEN NEW.decided_at:=value;END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER z_m26_p5a_disposable_completion_clock
BEFORE INSERT ON public.canonical_completion_records FOR EACH ROW
EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_completion_clock();

-- The same disposable-only chronology must reach the owning M22 approval
-- occurrence, otherwise an action performed after a frozen future origin can
-- look older than that origin merely because the fixture clock and the host
-- clock differ. Production has no clock row, so both writers retain their
-- existing transaction timestamps outside an explicitly enabled disposable
-- database. Existing approval rows are never changed.
CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_schedule_clock()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value TIMESTAMPTZ;
BEGIN
 SELECT instant_value INTO value
 FROM public.canonical_forecast_workload_capacity_test_clock_v1 WHERE singleton;
 IF FOUND THEN NEW.approved_at:=value;END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER z_m26_p5a_disposable_schedule_approval_clock
BEFORE INSERT ON public.canonical_schedule_approvals FOR EACH ROW
EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_schedule_clock();

CREATE TRIGGER z_m26_p5a_disposable_human_approval_clock
BEFORE INSERT ON public.canonical_schedule_human_approvals FOR EACH ROW
EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_schedule_clock();

-- Migration203 compares an approval occurrence with the immutable schedule
-- revision observation that emitted the booking event. In disposable
-- chronological evidence both must use the same guarded clock without making
-- the canonical occurrence look older than its observation. Production has
-- no clock row and therefore retains the original revision timestamp.
CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_schedule_revision_clock()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value TIMESTAMPTZ;
BEGIN
 SELECT instant_value INTO value
 FROM public.canonical_forecast_workload_capacity_test_clock_v1 WHERE singleton;
 IF FOUND THEN NEW.created_at:=value-INTERVAL '1 microsecond';END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER z_m26_p5a_disposable_schedule_revision_clock
BEFORE INSERT ON public.canonical_schedule_assignment_revisions FOR EACH ROW
EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_schedule_revision_clock();

-- The mounted prospective lifecycle creates the owning M24 person-plan review
-- through its guarded route.  Give that immutable receipt the same private
-- disposable observation clock as the schedule and completion authorities so
-- a later wall-clock origin can prove that the two ended windows really had a
-- contemporaneous reviewed basis.  With no private clock row production keeps
-- the owning authority's native clock_timestamp() value.
CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_person_plan_clock()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value TIMESTAMPTZ;
BEGIN
 SELECT instant_value INTO value
 FROM public.canonical_forecast_workload_capacity_test_clock_v1 WHERE singleton;
 IF FOUND THEN NEW.created_at:=value;END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER z_m26_p5a_disposable_person_plan_clock
BEFORE INSERT ON public.canonical_forecast_current_backlog_person_plan_reviews FOR EACH ROW
EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_person_plan_clock();

CREATE SEQUENCE public.canonical_forecast_workload_capacity_source_order_v1;

CREATE TABLE public.canonical_forecast_workload_capacity_crew_events_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 source_order BIGINT NOT NULL DEFAULT nextval('public.canonical_forecast_workload_capacity_source_order_v1'),
 crew_id UUID NOT NULL,profile_id UUID NOT NULL,present BOOLEAN NOT NULL,
 crew_role TEXT,source_created_at TIMESTAMPTZ,observed_at TIMESTAMPTZ NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN('epoch_baseline','writer_insert','writer_update','writer_delete')),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,source_order),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);

-- Preserve when the owning Mission 22 writer made an immutable declared-
-- availability revision visible to Part 5A without changing that source row's
-- own created_at/idempotency contract.  The observation clock is private and
-- disposable-only; production observes the real source transaction time.
CREATE TABLE public.canonical_forecast_workload_capacity_availability_events_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 source_order BIGINT NOT NULL DEFAULT nextval('public.canonical_forecast_workload_capacity_source_order_v1'),
 availability_id UUID NOT NULL,revision_id UUID NOT NULL,workforce_profile_id UUID NOT NULL,
 revision BIGINT NOT NULL CHECK(revision>0),source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 source_created_at TIMESTAMPTZ NOT NULL,observed_at TIMESTAMPTZ NOT NULL,
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,source_order),UNIQUE(organization_id,revision_id),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,revision_id)
  REFERENCES public.canonical_workforce_availability_revisions(organization_id,id) ON DELETE RESTRICT
);

-- Preserve the exact Mission 23 human profile/certification generation that
-- became visible to Part 5A.  The source event remains owned and immutable in
-- canonical_work_profile_events; this private observation ledger supplies the
-- prospective source order needed for half-open historical reconstruction.
CREATE TABLE public.canonical_forecast_workload_capacity_profile_events_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 source_order BIGINT NOT NULL DEFAULT nextval('public.canonical_forecast_workload_capacity_source_order_v1'),
 profile_id UUID NOT NULL,event_id UUID NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 action TEXT NOT NULL,status TEXT NOT NULL,verified_certification_ids JSONB NOT NULL,
 source_request_digest TEXT NOT NULL CHECK(source_request_digest~'^[0-9a-f]{64}$'),
 source_created_at TIMESTAMPTZ NOT NULL,observed_at TIMESTAMPTZ NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN('epoch_baseline','writer_insert')),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
  UNIQUE(organization_id,source_order),UNIQUE(organization_id,event_id),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);

-- Exact append-only per-profile source observations prevent an operational-role,
-- membership or account change followed by a value-level revert from making
-- an older human qualification review current again.  They also preserve the
-- population that actually applied at an already-ended evidence boundary;
-- current roster rows are never used to rewrite that historical population.
CREATE TABLE public.canonical_forecast_workload_capacity_role_generations_v1 (
 organization_id UUID NOT NULL,profile_id UUID NOT NULL,generation BIGINT NOT NULL CHECK(generation>0),
 source_order BIGINT NOT NULL,source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 observed_at TIMESTAMPTZ NOT NULL,present BOOLEAN NOT NULL,
 membership_id UUID NOT NULL,user_id UUID NOT NULL,
 operational_role TEXT NOT NULL CHECK(operational_role IN('owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other')),
 membership_role TEXT NOT NULL,membership_status TEXT NOT NULL,account_status TEXT NOT NULL,
 profile_updated_at TIMESTAMPTZ NOT NULL,membership_updated_at TIMESTAMPTZ NOT NULL,
 account_updated_at TIMESTAMPTZ NOT NULL,source_table TEXT NOT NULL,source_operation TEXT NOT NULL,
 PRIMARY KEY(organization_id,profile_id,generation),
 UNIQUE(organization_id,source_order),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);

WITH source_rows AS MATERIALIZED (
 SELECT profile.organization_id,profile.id profile_id,
  nextval('public.canonical_forecast_workload_capacity_source_order_v1') source_order,
  public.canonical_completion_digest(to_jsonb(profile)) profile_digest,
  public.canonical_completion_digest(to_jsonb(membership)) membership_digest,
  public.canonical_completion_digest(to_jsonb(account)) account_digest,
  profile.membership_id,account.id user_id,profile.operational_role,
  membership.role membership_role,membership.status membership_status,account.status account_status,
  profile.updated_at profile_updated_at,membership.updated_at membership_updated_at,
  account.updated_at account_updated_at
 FROM public.workforce_profiles profile
 JOIN public.organization_memberships membership
  ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
 JOIN public.users account
  ON account.organization_id=profile.organization_id AND account.id=membership.user_id
) INSERT INTO public.canonical_forecast_workload_capacity_role_generations_v1(
 organization_id,profile_id,generation,source_order,source_digest,observed_at,present,
 membership_id,user_id,operational_role,membership_role,membership_status,account_status,
 profile_updated_at,membership_updated_at,account_updated_at,source_table,source_operation)
SELECT organization_id,profile_id,1,source_order,
 public.canonical_completion_digest(jsonb_build_object('organizationId',organization_id,
  'profileId',profile_id,'sourceKind','installation_baseline','sourceOrder',source_order,
  'profileDigest',profile_digest,'membershipDigest',membership_digest,'accountDigest',account_digest,
  'operationalRole',operational_role,'membershipRole',membership_role,
  'membershipStatus',membership_status,'accountStatus',account_status)),
 clock_timestamp(),TRUE,membership_id,user_id,operational_role,membership_role,membership_status,
 account_status,profile_updated_at,membership_updated_at,account_updated_at,
 'installation','baseline' FROM source_rows;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_source_fence()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE org UUID;instant_value TIMESTAMPTZ;role_value TEXT;created_value TIMESTAMPTZ;
 profile_value UUID;order_value BIGINT;row_digest TEXT;generation_value BIGINT;snapshot RECORD;
BEGIN
 org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
 -- Source writers already hold their table RowExclusive lock before a row
 -- trigger runs. Captures take SHARE locks first and this same tenant fence
 -- second, so the common order drains writers without lock inversion.
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:workload-capacity-source:'||org,0));
 IF TG_TABLE_NAME IN('workforce_profiles','organization_memberships','users') THEN
  instant_value:=public.canonical_forecast_workload_capacity_v1_clock();
  row_digest:=public.canonical_completion_digest(CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END);
  FOR profile_value IN
   SELECT profile.id FROM public.workforce_profiles profile
   WHERE profile.organization_id=org AND (
    (TG_TABLE_NAME='workforce_profiles' AND profile.id=
      CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END) OR
    (TG_TABLE_NAME='organization_memberships' AND profile.membership_id=
      CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END) OR
    (TG_TABLE_NAME='users' AND EXISTS(SELECT 1 FROM public.organization_memberships membership
      WHERE membership.organization_id=org AND membership.id=profile.membership_id
       AND membership.user_id=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END)))
   UNION ALL
   SELECT OLD.id WHERE TG_TABLE_NAME='workforce_profiles' AND TG_OP='DELETE'
  LOOP
   SELECT profile.membership_id,account.id user_id,profile.operational_role,
    membership.role membership_role,membership.status membership_status,account.status account_status,
    profile.updated_at profile_updated_at,membership.updated_at membership_updated_at,
    account.updated_at account_updated_at
   INTO snapshot
   FROM public.workforce_profiles profile
   JOIN public.organization_memberships membership
    ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
   JOIN public.users account
    ON account.organization_id=profile.organization_id AND account.id=membership.user_id
   WHERE profile.organization_id=org AND profile.id=profile_value;
   IF NOT FOUND AND TG_TABLE_NAME='workforce_profiles' AND TG_OP='DELETE' THEN
    SELECT OLD.membership_id,account.id,OLD.operational_role,membership.role,membership.status,
     account.status,OLD.updated_at,membership.updated_at,account.updated_at INTO snapshot
    FROM public.organization_memberships membership JOIN public.users account
     ON account.organization_id=membership.organization_id AND account.id=membership.user_id
    WHERE membership.organization_id=org AND membership.id=OLD.membership_id;
   END IF;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce source observation unavailable' USING ERRCODE='23514';
   END IF;
   order_value:=nextval('public.canonical_forecast_workload_capacity_source_order_v1');
   SELECT COALESCE(max(value.generation),0)+1 INTO generation_value
   FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
   WHERE value.organization_id=org AND value.profile_id=profile_value;
   INSERT INTO public.canonical_forecast_workload_capacity_role_generations_v1(
    organization_id,profile_id,generation,source_order,source_digest,observed_at,present,
    membership_id,user_id,operational_role,membership_role,membership_status,account_status,
    profile_updated_at,membership_updated_at,account_updated_at,source_table,source_operation)
   VALUES(org,profile_value,generation_value,order_value,
    public.canonical_completion_digest(jsonb_build_object('organizationId',org,
     'profileId',profile_value,'sourceTable',TG_TABLE_NAME,'operation',TG_OP,
     'sourceOrder',order_value,'sourceRowDigest',row_digest,
     'operationalRole',snapshot.operational_role,'membershipRole',snapshot.membership_role,
     'membershipStatus',snapshot.membership_status,'accountStatus',snapshot.account_status)),
    instant_value,TG_OP<>'DELETE',snapshot.membership_id,snapshot.user_id,snapshot.operational_role,
    snapshot.membership_role,snapshot.membership_status,snapshot.account_status,
    snapshot.profile_updated_at,snapshot.membership_updated_at,snapshot.account_updated_at,
    TG_TABLE_NAME,TG_OP);
  END LOOP;
 END IF;
 IF TG_TABLE_NAME='workforce_crew_members' THEN
  instant_value:=public.canonical_forecast_workload_capacity_v1_clock();
  role_value:=CASE WHEN TG_OP='DELETE' THEN OLD.crew_role ELSE NEW.crew_role END;
  created_value:=CASE WHEN TG_OP='DELETE' THEN OLD.created_at ELSE NEW.created_at END;
  INSERT INTO public.canonical_forecast_workload_capacity_crew_events_v1(
   organization_id,crew_id,profile_id,present,crew_role,source_created_at,observed_at,source_kind,digest)
  VALUES(org,CASE WHEN TG_OP='DELETE' THEN OLD.crew_id ELSE NEW.crew_id END,
   CASE WHEN TG_OP='DELETE' THEN OLD.profile_id ELSE NEW.profile_id END,TG_OP<>'DELETE',
   role_value,created_value,instant_value,
   CASE TG_OP WHEN 'INSERT' THEN 'writer_insert' WHEN 'UPDATE' THEN 'writer_update' ELSE 'writer_delete' END,
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,'operation',TG_OP,
    'crewId',CASE WHEN TG_OP='DELETE' THEN OLD.crew_id ELSE NEW.crew_id END,
    'profileId',CASE WHEN TG_OP='DELETE' THEN OLD.profile_id ELSE NEW.profile_id END,
    'role',role_value,'sourceCreatedAt',public.canonical_forecast_utc_instant(created_value),
     'observedAt',public.canonical_forecast_utc_instant(instant_value))));
 END IF;
 IF TG_TABLE_NAME='canonical_workforce_availability_revisions' AND TG_OP='INSERT' THEN
  instant_value:=public.canonical_forecast_workload_capacity_v1_clock();
  order_value:=nextval('public.canonical_forecast_workload_capacity_source_order_v1');
  INSERT INTO public.canonical_forecast_workload_capacity_availability_events_v1(
   organization_id,source_order,availability_id,revision_id,workforce_profile_id,revision,
   source_digest,source_created_at,observed_at,digest)
  VALUES(org,order_value,NEW.availability_id,NEW.id,NEW.workforce_profile_id,NEW.revision,
   rtrim(NEW.canonical_digest),NEW.created_at,instant_value,
   public.canonical_completion_digest(jsonb_build_object('organizationId',org,
    'availabilityId',NEW.availability_id,'revisionId',NEW.id,'profileId',NEW.workforce_profile_id,
    'revision',NEW.revision,'sourceDigest',rtrim(NEW.canonical_digest),'sourceOrder',order_value,
    'sourceCreatedAt',public.canonical_forecast_utc_instant(NEW.created_at),
    'observedAt',public.canonical_forecast_utc_instant(instant_value))));
 END IF;
 IF TG_TABLE_NAME='canonical_work_profile_events' AND TG_OP='INSERT' THEN
  IF NEW.stream='profile' THEN
   instant_value:=public.canonical_forecast_workload_capacity_v1_clock();
   order_value:=nextval('public.canonical_forecast_workload_capacity_source_order_v1');
   INSERT INTO public.canonical_forecast_workload_capacity_profile_events_v1(
    organization_id,source_order,profile_id,event_id,revision,action,status,
    verified_certification_ids,source_request_digest,source_created_at,observed_at,source_kind,digest)
   VALUES(org,order_value,NEW.profile_id,NEW.id,NEW.revision,NEW.action,NEW.status,
    NEW.verified_certification_ids,rtrim(NEW.request_digest),NEW.created_at,instant_value,'writer_insert',
    public.canonical_completion_digest(jsonb_build_object('organizationId',org,
     'profileId',NEW.profile_id,'eventId',NEW.id,'revision',NEW.revision,
     'action',NEW.action,'status',NEW.status,'verifiedCertificationIds',NEW.verified_certification_ids,
     'sourceRequestDigest',rtrim(NEW.request_digest),'sourceOrder',order_value,
     'sourceCreatedAt',public.canonical_forecast_utc_instant(NEW.created_at),
     'observedAt',public.canonical_forecast_utc_instant(instant_value))));
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DO $$DECLARE item RECORD;BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('organization_memberships','z_m26_p5a_fence_memberships'),
  ('users','z_m26_p5a_fence_users'),
  ('workforce_profiles','z_m26_p5a_fence_profiles'),
  ('workforce_crew_members','z_m26_p5a_fence_crew_members'),
  ('canonical_work_profile_events','z_m26_p5a_fence_work_profiles'),
  ('canonical_workforce_availability_authorities','z_m26_p5a_fence_availability_authorities'),
  ('canonical_workforce_availability_revisions','z_m26_p5a_fence_availability_revisions'),
  ('canonical_workforce_availability_intervals','z_m26_p5a_fence_availability_intervals'),
  ('canonical_schedule_assignments','z_m26_p5a_fence_schedule_assignments'),
  ('canonical_schedule_approvals','z_m26_p5a_fence_schedule_approvals'),
  ('canonical_schedule_human_approvals','z_m26_p5a_fence_human_approvals'),
  ('canonical_schedule_assignment_revisions','z_m26_p5a_fence_assignment_revisions'),
  ('canonical_field_execution_events','z_m26_p5a_fence_execution_events'),
  ('canonical_completion_records','z_m26_p5a_fence_completions'),
  ('canonical_labor_intervals','z_m26_p5a_fence_labor_intervals'),
  ('canonical_labor_events','z_m26_p5a_fence_labor_events'),
  ('canonical_forecast_schedule_booking_events','z_m26_p5a_fence_booking_events'),
  ('canonical_forecast_current_backlog_booking_positions','z_m26_p5a_fence_booking_positions'),
  ('canonical_estimates','z_m26_p5a_fence_estimates'),
  ('canonical_estimate_decisions','z_m26_p5a_fence_estimate_decisions'),
  ('canonical_labor_plans','z_m26_p5a_fence_labor_plans'),
  ('canonical_estimate_revisions','z_m26_p5a_fence_estimate_revisions'),
  ('canonical_forecast_estimate_source_fences','z_m26_p5a_fence_estimate_source_fences'),
  ('canonical_forecast_current_backlog_person_plan_reviews','z_m26_p5a_fence_person_plan_reviews')
 ) AS value(table_name,trigger_name) LOOP
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_source_fence()',
    item.trigger_name,item.table_name);
  END LOOP;
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_lock_sources(org UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 -- One real transaction fence covers every source writer used below. SHARE
 -- locks drain in-flight RowExclusive writers and prevent new changes until
 -- the caller commits. All Part 5A functions acquire this exact order.
 LOCK TABLE public.organization_memberships,public.users,public.workforce_profiles,
  public.canonical_forecast_workload_capacity_role_generations_v1,
  public.canonical_forecast_workload_capacity_profile_events_v1,
  public.workforce_crew_members,public.canonical_work_profile_events,
 public.canonical_workforce_availability_authorities,
  public.canonical_workforce_availability_revisions,
  public.canonical_forecast_workload_capacity_availability_events_v1,
  public.canonical_workforce_availability_intervals,
  public.canonical_schedule_assignments,public.canonical_schedule_approvals,
  public.canonical_schedule_human_approvals,public.canonical_schedule_assignment_revisions,
  public.canonical_field_executions,public.canonical_field_execution_events,
  public.canonical_field_execution_revisions,
  public.canonical_completion_records,public.canonical_labor_intervals,
  public.canonical_labor_events,
  public.canonical_forecast_schedule_booking_events,
  public.canonical_forecast_current_backlog_booking_positions,
  public.canonical_estimates,public.canonical_estimate_decisions,
  public.canonical_labor_plans,public.canonical_estimate_revisions,
  public.canonical_forecast_estimate_source_fences,
  public.canonical_forecast_current_backlog_person_plan_reviews
  IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:workload-capacity-source:'||org,0));
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_access(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,write_required BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;subscription_status TEXT;trial_started TIMESTAMPTZ;trial_ends TIMESTAMPTZ;
BEGIN
 IF role_value NOT IN ('owner','admin') THEN
 RAISE EXCEPTION 'Current paid owner or admin required' USING ERRCODE='42501';
 END IF;
 -- M22/M23 supporting-authority writers, including subscription and schedule
 -- writers, acquire the released material fence before changing their rows.
 -- Take the same fence before the subscription row so a queued revocation can
 -- never invert with an explicit unschedule that later writes M22 authority.
 IF write_required THEN PERFORM pg_advisory_xact_lock(230004,4);
 ELSE PERFORM pg_advisory_xact_lock_shared(230004,4);END IF;
 -- Subscription is explicitly locked; the inherited actor helper intentionally
 -- does not lock its lateral subscription row.
 SELECT status,trial_started_at,trial_ends_at INTO subscription_status,trial_started,trial_ends
 FROM public.subscriptions WHERE organization_id=org LIMIT 1 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription authority unavailable' USING ERRCODE='42501';END IF;
 authority:=public.canonical_field_execution_actor_authority(
  org,actor,role_value,session_value,csrf,write_required);
 IF NOT (subscription_status='active' OR (subscription_status='trialing'
   AND trial_started IS NOT NULL AND trial_ends=trial_started+INTERVAL '14 days'
   AND trial_ends>clock_timestamp())) THEN
  RAISE EXCEPTION 'Paid subscription required' USING ERRCODE='42501';
 END IF;
 RETURN authority;
END $$;

-- Every entry acquires the locking authority above before it can wait on a
-- source fence. Revalidation after the wait must not request the same row
-- locks again: a queued revocation would otherwise sit ahead of the repeated
-- SHARE request while waiting for the SHARE lock already held by this
-- transaction. This private helper rereads the exact actor/subscription state
-- under those retained locks and therefore both closes the post-wait check and
-- avoids a lock-queue self-deadlock.
CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_access_recheck(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,write_required BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority RECORD;evaluated_at TIMESTAMPTZ;
BEGIN
 IF role_value NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Current paid owner or admin required' USING ERRCODE='42501';END IF;
 SELECT membership.id membership_id,membership.role,membership.status membership_status,
  account.status account_status,profile.id profile_id,profile.operational_role,
  session.id session_id,session.status session_status,session.access_expires_at,
  session.csrf_token_hash,subscription.status subscription_status,
  subscription.trial_started_at,subscription.trial_ends_at,onboarding.status onboarding_status
 INTO authority
 FROM public.organization_memberships membership
 JOIN public.users account ON account.organization_id=membership.organization_id
  AND account.id=membership.user_id
 JOIN public.workforce_profiles profile ON profile.organization_id=membership.organization_id
  AND profile.membership_id=membership.id
 JOIN public.auth_sessions session ON session.organization_id=membership.organization_id
  AND session.membership_id=membership.id AND session.user_id=membership.user_id
  AND session.id=session_value
 LEFT JOIN LATERAL (SELECT value.status,value.trial_started_at,value.trial_ends_at
  FROM public.subscriptions value WHERE value.organization_id=membership.organization_id LIMIT 1)
  subscription ON TRUE
 JOIN public.organization_onboarding onboarding ON onboarding.organization_id=membership.organization_id
 WHERE membership.organization_id=org AND membership.user_id=actor;
 evaluated_at:=clock_timestamp();
 IF NOT FOUND OR authority.membership_status<>'active' OR authority.account_status<>'active'
  OR authority.role<>role_value OR authority.session_status<>'active'
  OR authority.access_expires_at<=evaluated_at OR authority.onboarding_status<>'complete'
  OR NOT (authority.subscription_status='active' OR (authority.subscription_status='trialing'
   AND authority.trial_started_at IS NOT NULL
   AND authority.trial_ends_at=authority.trial_started_at+INTERVAL '14 days'
   AND authority.trial_ends_at>evaluated_at))
  OR (write_required AND (csrf IS NULL OR octet_length(csrf) NOT BETWEEN 32 AND 512
   OR encode(sha256(convert_to(csrf,'UTF8')),'hex')<>rtrim(authority.csrf_token_hash))) THEN
  RAISE EXCEPTION 'Current workload research authority is unavailable' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('membershipId',authority.membership_id,'profileId',authority.profile_id,
  'operationalRole',authority.operational_role,'sessionId',authority.session_id);
END $$;

-- The accepted M22 human-preview surface can assign, schedule, reschedule and
-- dispatch, but deliberately cannot return an assigned appointment to the
-- unscheduled queue. Part 5A needs that existing owning state to be reachable
-- before it can truthfully model scheduled and unscheduled workload. This
-- narrowly scoped, explicit owner/admin action writes the same immutable M22
-- approval/revision/audit/idempotency authority; it never changes assignment
-- target, appointment status, estimates, dispatches or work execution.
CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_backlog_unschedule(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 appointment_value UUID,expected_revision BIGINT,expected_digest TEXT,reason_value TEXT,
 confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;assignment_value public.canonical_schedule_assignments%ROWTYPE;
 appointment_record public.canonical_appointments%ROWTYPE;approval_value public.canonical_schedule_approvals%ROWTYPE;
 replay_value public.canonical_schedule_idempotency%ROWTYPE;profile_value public.canonical_business_profiles%ROWTYPE;
 key_hash TEXT;request_hash TEXT;after_digest TEXT;dispatch_value TEXT;reasons_value JSONB;
 submitted_value JSONB;timezone_value JSONB;response_value JSONB;approved_instant TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'
  OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR expected_revision<1
  OR expected_digest!~'^[0-9a-f]{64}$' OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR confirmation_value<>'m26-workload-capacity-unschedule-v1' THEN
  RAISE EXCEPTION 'Invalid explicit unschedule request' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','explicit_unschedule',
  'appointmentId',appointment_value,'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'reason',reason_value,'confirmationVersion',confirmation_value));
 SELECT * INTO replay_value FROM public.canonical_schedule_idempotency value
  WHERE value.organization_id=org AND value.actor_user_id=actor AND value.idempotency_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay_value.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Explicit unschedule key conflict' USING ERRCODE='23505';END IF;
  SELECT * INTO assignment_value FROM public.canonical_schedule_assignments value
   WHERE value.organization_id=org AND value.id=replay_value.assignment_id FOR SHARE;
  IF NOT FOUND OR assignment_value.appointment_id<>appointment_value OR
    assignment_value.schedule_state<>'unscheduled' OR
    assignment_value.revision<>expected_revision+1 OR
    replay_value.response_body#>>'{data,id}'<>appointment_value::text OR
    replay_value.response_body#>>'{data,scheduleAuthority,digest}'<>
      rtrim(assignment_value.canonical_digest) OR
    replay_value.response_body#>>'{data,scheduleAuthority,revision}'<>
      assignment_value.revision::text THEN
   RAISE EXCEPTION 'Explicit unschedule result changed' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','workload_capacity_backlog_unscheduled',
   'appointmentId',appointment_value,'assignmentId',assignment_value.id,
   'assignmentRevision',assignment_value.revision,
   'assignmentDigest',rtrim(assignment_value.canonical_digest),
   'scheduleState','unscheduled','dispatchState',assignment_value.dispatch_state,
   'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
   'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',TRUE);
 END IF;
 SELECT * INTO assignment_value FROM public.canonical_schedule_assignments value
  WHERE value.organization_id=org AND value.appointment_id=appointment_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE='P0002';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 IF assignment_value.revision<>expected_revision OR rtrim(assignment_value.canonical_digest)<>expected_digest THEN
  RAISE EXCEPTION 'Explicit unschedule source changed' USING ERRCODE='40001';END IF;
 IF assignment_value.target_state<>'assigned' OR assignment_value.schedule_state<>'scheduled'
   OR assignment_value.scheduled_start IS NULL OR assignment_value.scheduled_end IS NULL THEN
  RAISE EXCEPTION 'Scheduled assigned backlog required' USING ERRCODE='22023';END IF;
 SELECT appointment.* INTO appointment_record FROM public.canonical_appointments appointment
  WHERE appointment.organization_id=org AND appointment.id=appointment_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Appointment not found' USING ERRCODE='P0002';END IF;
 SELECT profile.* INTO profile_value FROM public.canonical_business_profiles profile
  JOIN public.organization_onboarding onboarding
   ON onboarding.organization_id=profile.organization_id
   AND onboarding.active_business_profile_id=profile.id
  WHERE profile.organization_id=org AND profile.is_active=TRUE FOR SHARE OF profile;
 IF NOT FOUND OR profile_value.raw_profile#>>'{company,timeZone}' IS NULL THEN
  RAISE EXCEPTION 'Current time-zone authority unavailable' USING ERRCODE='22023';END IF;
 dispatch_value:=CASE WHEN assignment_value.dispatch_state='dispatched' THEN 'revoked'
  ELSE assignment_value.dispatch_state END;
 reasons_value:=jsonb_build_array('conflict_evaluation_not_available');
 after_digest:=public.canonical_schedule_assignment_digest(assignment_value.target_state,
  assignment_value.workforce_profile_id,assignment_value.workforce_crew_id,'unscheduled',dispatch_value,
  NULL,NULL,assignment_value.appointment_status,TRUE,reasons_value);
 submitted_value:=jsonb_build_object('startProvided',TRUE,'endProvided',TRUE,
  'scheduledStart',NULL,'scheduledEnd',NULL);
 timezone_value:=jsonb_build_object('profileId',profile_value.id,'profileVersion',profile_value.version_number,
  'profileHash',rtrim(profile_value.normalized_profile_hash),
  'timeZone',profile_value.raw_profile#>>'{company,timeZone}');
 INSERT INTO public.canonical_schedule_approvals(
  organization_id,assignment_id,appointment_id,actor_user_id,actor_access_role,auth_session_id,
  expected_revision,expected_digest,applied_revision,applied_digest,request_digest,idempotency_key_hash,
  action_code,reason,approved_scheduled_start,approved_scheduled_end,approved_appointment_status,
  resulting_schedule_state,resulting_dispatch_state,resulting_needs_review,resulting_review_reasons,
  time_evidence_version,submitted_schedule,time_zone_authority,time_evidence_digest)
 VALUES(org,assignment_value.id,appointment_value,actor,role_value,session_value,
  expected_revision,expected_digest,expected_revision+1,after_digest,request_hash,key_hash,
  'calendar_edit',reason_value,NULL,NULL,assignment_value.appointment_status,'unscheduled',dispatch_value,
  TRUE,reasons_value,2,submitted_value,timezone_value,
  public.canonical_schedule_time_evidence_digest(2::smallint,submitted_value,timezone_value))
 RETURNING * INTO approval_value;
 approved_instant:=approval_value.approved_at;
 UPDATE public.canonical_schedule_assignments SET schedule_state='unscheduled',dispatch_state=dispatch_value,
  scheduled_start=NULL,scheduled_end=NULL,needs_review=TRUE,review_reasons=reasons_value,
  revision=expected_revision+1,canonical_digest=after_digest,last_approval_id=approval_value.id,
  last_human_approval_id=NULL,last_actor_user_id=actor,last_action_code='calendar_edit',
  last_reason=reason_value,updated_at=approved_instant
  WHERE organization_id=org AND id=assignment_value.id;
 INSERT INTO public.canonical_schedule_assignment_revisions(
  organization_id,assignment_id,revision,workforce_profile_id,workforce_crew_id,target_state,
  schedule_state,dispatch_state,scheduled_start,scheduled_end,appointment_status,needs_review,
  review_reasons,canonical_digest,source_kind,approval_id,actor_user_id,action_code,reason,
  request_digest,source_snapshot)
 VALUES(org,assignment_value.id,expected_revision+1,assignment_value.workforce_profile_id,
  assignment_value.workforce_crew_id,assignment_value.target_state,'unscheduled',dispatch_value,NULL,NULL,
  assignment_value.appointment_status,TRUE,reasons_value,after_digest,'human_approved',approval_value.id,
  actor,'calendar_edit',reason_value,request_hash,jsonb_build_object('appointmentId',appointment_value,
   'explicitPart5AAction',TRUE,'confirmationVersion',confirmation_value,'timeEvidenceVersion',2,
   'submittedSchedule',submitted_value,
   'timeZoneAuthority',timezone_value,'timeEvidenceDigest',rtrim(approval_value.time_evidence_digest)));
 UPDATE public.canonical_appointments SET scheduled_start=NULL,scheduled_end=NULL,updated_at=approved_instant
  WHERE organization_id=org AND id=appointment_value;
 INSERT INTO public.canonical_schedule_audit_events(organization_id,assignment_id,approval_id,
  actor_user_id,action_code,reason,before_revision,after_revision,before_digest,after_digest,details)
 VALUES(org,assignment_value.id,approval_value.id,actor,'calendar_edit',reason_value,expected_revision,
  expected_revision+1,expected_digest,after_digest,jsonb_build_object('appointmentId',appointment_value,
   'scheduleState','unscheduled','dispatchState',dispatch_value,'needsReview',TRUE,
   'reviewReasons',reasons_value,'explicitPart5AAction',TRUE,'timeEvidenceVersion',2,
   'submittedSchedule',submitted_value,'timeZoneAuthority',timezone_value,
   'timeEvidenceDigest',rtrim(approval_value.time_evidence_digest)));
 response_value:=jsonb_build_object('state','workload_capacity_backlog_unscheduled',
  'appointmentId',appointment_value,'assignmentId',assignment_value.id,
  'assignmentRevision',expected_revision+1,'assignmentDigest',after_digest,
  'scheduleState','unscheduled','dispatchState',dispatch_value,'researchOnly',TRUE,
  'forecastIssued',FALSE,'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,
  'automaticActionTaken',FALSE,'replayed',FALSE);
 INSERT INTO public.canonical_schedule_idempotency(organization_id,actor_user_id,idempotency_key_hash,
  request_digest,assignment_id,approval_id,response_status,response_body)
 VALUES(org,actor,key_hash,request_hash,assignment_value.id,approval_value.id,200,
  jsonb_build_object('success',TRUE,'data',jsonb_build_object('id',appointment_value,
   'scheduleAuthority',jsonb_build_object('revision',expected_revision+1,'digest',after_digest))));
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN response_value;
END $$;

CREATE TABLE public.canonical_forecast_workload_capacity_methods_v1 (
 target_key TEXT PRIMARY KEY,
 target_version TEXT NOT NULL CHECK(target_version='v1'),
 unit TEXT NOT NULL CHECK(unit='person_hours'),
 horizon_seconds INTEGER NOT NULL CHECK(horizon_seconds=2592000),
 calculation_version TEXT NOT NULL,
 definition_digest TEXT NOT NULL CHECK(definition_digest~'^[0-9a-f]{64}$'),
 definition JSONB NOT NULL CHECK(jsonb_typeof(definition)='object')
);

INSERT INTO public.canonical_forecast_workload_capacity_methods_v1
 (target_key,target_version,unit,horizon_seconds,calculation_version,definition_digest,definition)
SELECT target,'v1','person_hours',2592000,calculation,
 encode(sha256(convert_to(definition::text,'UTF8')),'hex'),definition
FROM (VALUES
 ('workload.accepted_person_hours.v1','m26-workload-accepted-hours-two-window-mean-v1',
  jsonb_build_object('kind','event_flow','window','half_open_30_elapsed_days',
   'method','mean_two_complete_prior_windows','acceptedClosedNonoverlapOnly',TRUE)),
 ('workload.end_backlog_hours.v1','m26-workload-end-backlog-persistence-v1',
  jsonb_build_object('kind','end_stock','window','exclusive_horizon_boundary',
   'method','reviewed_cutoff_stock_persistence','scheduledAndUnscheduledSeparate',TRUE)),
 ('capacity.available_role_hours.v1','m26-base-role-capacity-declared-v1',
  jsonb_build_object('kind','base_capacity_flow','window','half_open_30_elapsed_days',
   'method','reviewed_qualified_declared_availability_minus_commitments',
   'jobSpecificConstraintsExcluded',TRUE))
) value(target,calculation,definition);

CREATE TABLE public.canonical_forecast_workload_capacity_epochs_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 installed_at TIMESTAMPTZ NOT NULL,source_counts JSONB NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m26-workload-capacity-epoch-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_workload_capacity_epochs_v1(organization_id,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK(jsonb_typeof(source_counts)='object')
);

CREATE TABLE public.canonical_forecast_workload_capacity_reviews_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 review_kind TEXT NOT NULL CHECK(review_kind IN('method','remaining_work','role_qualification','availability_basis','capacity_role_scope')),
 target_key TEXT NOT NULL REFERENCES public.canonical_forecast_workload_capacity_methods_v1(target_key),
 subject_id UUID,operational_role TEXT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 action TEXT NOT NULL CHECK(action IN('approve','reject','withdraw')),
 remaining_person_minutes BIGINT CHECK(remaining_person_minutes BETWEEN 0 AND 100000000),
 source_identity JSONB NOT NULL CHECK(jsonb_typeof(source_identity)='object' AND octet_length(source_identity::text)<=131072),
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m26-workload-capacity-review-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 decided_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,review_kind,target_key,subject_id,operational_role,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_workload_capacity_reviews_v1(organization_id,id),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)),
 CHECK((review_kind='method' AND subject_id IS NULL AND operational_role IS NULL AND remaining_person_minutes IS NULL)
  OR (review_kind='remaining_work' AND subject_id IS NOT NULL AND operational_role IS NULL AND remaining_person_minutes IS NOT NULL)
  OR (review_kind='role_qualification' AND subject_id IS NOT NULL AND operational_role IS NOT NULL AND remaining_person_minutes IS NULL)
  OR (review_kind='availability_basis' AND subject_id IS NOT NULL AND operational_role IS NULL AND remaining_person_minutes IS NULL)
  OR (review_kind='capacity_role_scope' AND subject_id IS NULL AND operational_role IS NOT NULL AND remaining_person_minutes IS NULL))
);
CREATE UNIQUE INDEX canonical_forecast_workload_capacity_method_revision_v1
 ON public.canonical_forecast_workload_capacity_reviews_v1(organization_id,target_key,revision)
 WHERE review_kind='method';
CREATE UNIQUE INDEX canonical_forecast_workload_capacity_remaining_revision_v1
 ON public.canonical_forecast_workload_capacity_reviews_v1(organization_id,subject_id,revision)
 WHERE review_kind='remaining_work';
CREATE UNIQUE INDEX canonical_forecast_workload_capacity_role_revision_v1
 ON public.canonical_forecast_workload_capacity_reviews_v1(organization_id,subject_id,operational_role,revision)
 WHERE review_kind='role_qualification';
CREATE UNIQUE INDEX canonical_forecast_workload_capacity_availability_revision_v1
 ON public.canonical_forecast_workload_capacity_reviews_v1(organization_id,subject_id,revision)
 WHERE review_kind='availability_basis';
CREATE UNIQUE INDEX canonical_forecast_workload_capacity_role_scope_revision_v1
 ON public.canonical_forecast_workload_capacity_reviews_v1(organization_id,target_key,revision)
 WHERE review_kind='capacity_role_scope';

CREATE TABLE public.canonical_forecast_workload_capacity_windows_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 window_start TIMESTAMPTZ NOT NULL,window_end TIMESTAMPTZ NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 capacity_role TEXT NOT NULL CHECK(capacity_role IN('owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other')),
 epoch_id UUID NOT NULL,source_counts JSONB NOT NULL,evidence JSONB NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 finalized_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,window_start,window_end,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id),
 FOREIGN KEY(organization_id,epoch_id) REFERENCES public.canonical_forecast_workload_capacity_epochs_v1(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_forecast_workload_capacity_windows_v1(organization_id,id),
 CHECK(window_end>window_start AND window_end-window_start=INTERVAL '30 days'),
 CHECK(jsonb_typeof(source_counts)='object' AND jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=262144),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE TABLE public.canonical_forecast_workload_capacity_origins_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,
 prediction_cutoff_at TIMESTAMPTZ NOT NULL,horizon_ends_at TIMESTAMPTZ NOT NULL,
 capacity_role TEXT NOT NULL CHECK(capacity_role IN('owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other')),
 epoch_id UUID NOT NULL,method_review_ids JSONB NOT NULL,training_window_ids JSONB NOT NULL,
 input_evidence JSONB NOT NULL,private_results JSONB NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'),
 output_digest TEXT NOT NULL CHECK(output_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id),
 FOREIGN KEY(organization_id,epoch_id) REFERENCES public.canonical_forecast_workload_capacity_epochs_v1(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id),
 CHECK(horizon_ends_at-prediction_cutoff_at=INTERVAL '30 days'),
 CHECK(jsonb_typeof(method_review_ids)='array' AND jsonb_array_length(method_review_ids)=3),
 CHECK(jsonb_typeof(training_window_ids)='array' AND jsonb_array_length(training_window_ids)=2),
 CHECK(jsonb_typeof(input_evidence)='object' AND jsonb_typeof(private_results)='object'
  AND octet_length(input_evidence::text)<=262144)
);

CREATE TABLE public.canonical_forecast_workload_capacity_evaluations_v1 (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL,origin_id UUID NOT NULL,
 capacity_role TEXT NOT NULL CHECK(capacity_role IN('owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other')),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),previous_id UUID,
 outcome_window_id UUID NOT NULL,private_metrics JSONB NOT NULL,
 outcome_digest TEXT NOT NULL CHECK(outcome_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 evaluated_at TIMESTAMPTZ NOT NULL,digest TEXT NOT NULL CHECK(digest~'^[0-9a-f]{64}$'),
 UNIQUE(organization_id,id),UNIQUE(organization_id,origin_id,id),UNIQUE(organization_id,origin_id,revision),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id) REFERENCES public.organizations(id),
 FOREIGN KEY(organization_id,origin_id) REFERENCES public.canonical_forecast_workload_capacity_origins_v1(organization_id,id),
 FOREIGN KEY(organization_id,outcome_window_id) REFERENCES public.canonical_forecast_workload_capacity_windows_v1(organization_id,id),
 FOREIGN KEY(organization_id,actor_user_id) REFERENCES public.organization_memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,origin_id,previous_id) REFERENCES public.canonical_forecast_workload_capacity_evaluations_v1(organization_id,origin_id,id),
 CHECK(jsonb_typeof(private_metrics)='object' AND octet_length(private_metrics::text)<=131072),
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL))
);

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Workload research evidence is immutable' USING ERRCODE='23514';END $$;

DO $$DECLARE table_name TEXT;BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'canonical_forecast_workload_capacity_crew_events_v1',
  'canonical_forecast_workload_capacity_methods_v1',
  'canonical_forecast_workload_capacity_epochs_v1',
  'canonical_forecast_workload_capacity_reviews_v1',
  'canonical_forecast_workload_capacity_windows_v1',
  'canonical_forecast_workload_capacity_origins_v1',
  'canonical_forecast_workload_capacity_evaluations_v1'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_immutable()',table_name||'_immutable',table_name);
 END LOOP;
END $$;
CREATE TRIGGER z_m26_p5a_role_generations_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_workload_capacity_role_generations_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_immutable();
CREATE TRIGGER z_m26_p5a_availability_events_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_workload_capacity_availability_events_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_immutable();

CREATE TRIGGER z_m26_p5a_profile_events_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_forecast_workload_capacity_profile_events_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_workload_capacity_v1_immutable();

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_labor_evidence(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows_value JSONB;count_value BIGINT;minutes_value NUMERIC;
BEGIN
 SELECT count(*),COALESCE(sum(EXTRACT(EPOCH FROM
   (LEAST(interval_value.observed_end,end_value)-GREATEST(interval_value.observed_start,start_value)))/60),0),
  COALESCE(jsonb_agg(jsonb_build_object('id',interval_value.id,'revision',interval_value.revision,
   'digest',rtrim(interval_value.canonical_digest),'start',public.canonical_forecast_utc_instant(interval_value.observed_start),
   'end',public.canonical_forecast_utc_instant(interval_value.observed_end)) ORDER BY interval_value.id),'[]'::jsonb)
 INTO count_value,minutes_value,rows_value
 FROM public.canonical_labor_intervals interval_value
 WHERE interval_value.organization_id=org AND interval_value.review_state='accepted'
  AND interval_value.observed_end IS NOT NULL AND interval_value.observed_start<end_value
  AND interval_value.observed_end>start_value;
 IF count_value>1000 OR octet_length(rows_value::text)>131072 THEN
  RAISE EXCEPTION 'Labor evidence exceeds bound' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('count',count_value,'personMinutes',round(minutes_value,6),'rows',rows_value);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_backlog_evidence(
 org UUID,cutoff_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows_value JSONB;count_value BIGINT;census_count BIGINT;
 scheduled_minutes BIGINT;unscheduled_minutes BIGINT;
BEGIN
 WITH accepted AS MATERIALIZED (
  SELECT DISTINCT event_value.assignment_id,event_value.appointment_id
  FROM public.canonical_forecast_schedule_booking_events event_value
  WHERE event_value.organization_id=org
   AND event_value.transition_kind='accepted_booking' AND event_value.occurred_at<cutoff_value
 ), latest_event AS MATERIALIZED (
  SELECT DISTINCT ON (event_value.assignment_id) event_value.*
  FROM public.canonical_forecast_schedule_booking_events event_value
  JOIN accepted USING(assignment_id,appointment_id)
  WHERE event_value.organization_id=org AND event_value.occurred_at<cutoff_value
  ORDER BY event_value.assignment_id,event_value.occurred_at DESC,event_value.source_order DESC
 ), census AS MATERIALIZED (
  SELECT latest_event.* FROM latest_event WHERE latest_event.appointment_status<>'cancelled'
 ) SELECT count(*) INTO census_count FROM census;
 IF census_count>500 THEN RAISE EXCEPTION 'Backlog evidence exceeds bound' USING ERRCODE='54000';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_schedule_booking_lineage_gaps gap_value
   WHERE gap_value.organization_id=org AND gap_value.uncertain_from_at<cutoff_value) THEN
  RAISE EXCEPTION 'Backlog booking lineage incomplete' USING ERRCODE='22023';END IF;

 WITH accepted AS MATERIALIZED (
  SELECT DISTINCT event_value.assignment_id,event_value.appointment_id
  FROM public.canonical_forecast_schedule_booking_events event_value
  WHERE event_value.organization_id=org
   AND event_value.transition_kind='accepted_booking' AND event_value.occurred_at<cutoff_value
 ), latest_event AS MATERIALIZED (
  SELECT DISTINCT ON (event_value.assignment_id) event_value.*
  FROM public.canonical_forecast_schedule_booking_events event_value
  JOIN accepted USING(assignment_id,appointment_id)
  WHERE event_value.organization_id=org AND event_value.occurred_at<cutoff_value
  ORDER BY event_value.assignment_id,event_value.occurred_at DESC,event_value.source_order DESC
 ), census AS MATERIALIZED (
  SELECT latest_event.* FROM latest_event WHERE latest_event.appointment_status<>'cancelled'
 ), completion AS MATERIALIZED (
  SELECT census.*,completion_value.lifecycle_after completion_state,
   completion_value.id completion_id,rtrim(completion_value.canonical_digest) completion_digest
  FROM census LEFT JOIN LATERAL (
   SELECT value.* FROM public.canonical_completion_records value
   WHERE value.organization_id=org AND value.assignment_id=census.assignment_id
    AND value.decided_at<cutoff_value AND value.record_kind<>'proposal'
   ORDER BY value.decided_at DESC,value.id DESC LIMIT 1
  ) completion_value ON TRUE
 ), enriched AS MATERIALIZED (
  SELECT completion.*,plan_value.id plan_review_id,plan_value.revision plan_revision,
   plan_value.digest plan_digest,plan_value.action plan_action,
   plan_value.estimate_id,plan_value.estimate_decision_id,plan_value.estimate_decision_revision,
   plan_value.estimate_decision_digest,plan_value.labor_plan_id,plan_value.labor_plan_revision,
   plan_value.labor_plan_digest,plan_value.source_generation,
   remaining.id remaining_review_id,remaining.revision remaining_revision,
   remaining.action remaining_action,remaining.remaining_person_minutes,remaining.digest remaining_digest
  FROM completion
  LEFT JOIN LATERAL (
   SELECT value.* FROM public.canonical_forecast_current_backlog_person_plan_reviews value
   WHERE value.organization_id=org AND value.appointment_id=completion.appointment_id
    AND value.created_at<cutoff_value ORDER BY value.revision DESC LIMIT 1
  ) plan_value ON TRUE
  LEFT JOIN LATERAL (
   SELECT value.* FROM public.canonical_forecast_workload_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind='remaining_work'
    AND value.subject_id=completion.appointment_id AND value.decided_at<cutoff_value
   ORDER BY value.revision DESC LIMIT 1
  ) remaining ON TRUE
 ), validated AS MATERIALIZED (
  SELECT enriched.*,CASE WHEN completion_state='completed' THEN 0
   ELSE remaining_person_minutes END effective_minutes
  FROM enriched
  LEFT JOIN public.canonical_estimates estimate_value
   ON estimate_value.organization_id=org AND estimate_value.id=enriched.estimate_id
  LEFT JOIN public.canonical_estimate_decisions decision_value
   ON decision_value.organization_id=org AND decision_value.id=enriched.estimate_decision_id
  LEFT JOIN public.canonical_labor_plans labor_value
   ON labor_value.organization_id=org AND labor_value.id=enriched.labor_plan_id
  LEFT JOIN public.canonical_forecast_estimate_source_fences fence_value
   ON fence_value.organization_id=org AND fence_value.estimate_id=enriched.estimate_id
  WHERE enriched.completion_state='completed' OR (
   enriched.plan_review_id IS NOT NULL AND enriched.plan_action='approve'
   AND estimate_value.opportunity_id=(SELECT assignment_value.opportunity_id
    FROM public.canonical_schedule_assignments assignment_value
    WHERE assignment_value.organization_id=org AND assignment_value.id=enriched.assignment_id)
   AND decision_value.revision=enriched.estimate_decision_revision
   AND rtrim(decision_value.digest)=rtrim(enriched.estimate_decision_digest)
   AND decision_value.source_pins=public.canonical_estimate_decision_source(org,enriched.estimate_id)
   AND decision_value.action='approve'
   AND decision_value.id=(SELECT current_decision.id FROM public.canonical_estimate_decisions current_decision
    WHERE current_decision.organization_id=org AND current_decision.estimate_id=enriched.estimate_id
    ORDER BY current_decision.revision DESC LIMIT 1)
   AND labor_value.revision=enriched.labor_plan_revision
   AND rtrim(labor_value.digest)=rtrim(enriched.labor_plan_digest)
   AND labor_value.source_pins=public.canonical_estimate_decision_source(org,enriched.estimate_id)
   AND labor_value.action='save'
   AND labor_value.expected_decision_revision=decision_value.revision
   AND rtrim(labor_value.expected_decision_digest)=rtrim(decision_value.digest)
   AND labor_value.id=(SELECT current_plan.id FROM public.canonical_labor_plans current_plan
    WHERE current_plan.organization_id=org AND current_plan.estimate_id=enriched.estimate_id
    ORDER BY current_plan.revision DESC LIMIT 1)
   AND fence_value.generation=enriched.source_generation
   AND enriched.remaining_review_id IS NOT NULL AND enriched.remaining_action='approve')
 )
 SELECT count(*),COALESCE(sum(effective_minutes) FILTER(WHERE schedule_state='scheduled'),0),
  COALESCE(sum(effective_minutes) FILTER(WHERE schedule_state='unscheduled'),0),
  COALESCE(jsonb_agg(jsonb_build_object('appointmentId',appointment_id,'assignmentId',assignment_id,
   'bookingEventId',id,'bookingSourceOrder',source_order,'bookingEventDigest',rtrim(event_digest),
   'planReviewId',plan_review_id,'planDigest',rtrim(plan_digest),'scheduleState',schedule_state,
   'assignmentRevision',source_revision,'assignmentDigest',rtrim(source_digest),
   'completionId',completion_id,'completionDigest',completion_digest,
   'remainingReviewId',remaining_review_id,'remainingRevision',remaining_revision,
   'remainingDigest',remaining_digest,'personMinutes',effective_minutes)
   ORDER BY appointment_id),'[]'::jsonb)
 INTO count_value,scheduled_minutes,unscheduled_minutes,rows_value FROM validated;
 IF count_value<>census_count THEN
  RAISE EXCEPTION 'Complete approved-work person-hour basis unavailable' USING ERRCODE='22023',
   DETAIL=format('census=%s validated=%s cutoff=%s',census_count,count_value,cutoff_value);END IF;
 IF octet_length(rows_value::text)>131072 THEN
  RAISE EXCEPTION 'Backlog evidence exceeds bound' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('count',count_value,'scheduledPersonMinutes',scheduled_minutes,
  'unscheduledPersonMinutes',unscheduled_minutes,'rows',rows_value,
  'postCutoffCorrections',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',value.id,
    'rootId',value.root_id,'digest',rtrim(value.canonical_digest)) ORDER BY value.id)
   FROM public.canonical_completion_records value
   WHERE value.organization_id=org AND value.record_kind='correction' AND value.decided_at>=cutoff_value
    AND EXISTS(SELECT 1 FROM public.canonical_completion_records root_value
     WHERE root_value.organization_id=org AND root_value.id=value.root_id
      AND root_value.decided_at<cutoff_value)),'[]'::jsonb));
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_review_source(
 org UUID,kind_value TEXT,target_value TEXT,subject_value UUID,role_name TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE profile_value public.workforce_profiles%ROWTYPE;
 profile_event public.canonical_work_profile_events%ROWTYPE;
 profile_generation public.canonical_forecast_workload_capacity_profile_events_v1%ROWTYPE;
 membership_value public.organization_memberships%ROWTYPE;
 account_value public.users%ROWTYPE;
 role_generation public.canonical_forecast_workload_capacity_role_generations_v1%ROWTYPE;
 availability_value public.canonical_workforce_availability_authorities%ROWTYPE;
 availability_revision public.canonical_workforce_availability_revisions%ROWTYPE;
 plan_value public.canonical_forecast_current_backlog_person_plan_reviews%ROWTYPE;
 assignment_value public.canonical_schedule_assignments%ROWTYPE;
 completion_value public.canonical_completion_records%ROWTYPE;
 method_value public.canonical_forecast_workload_capacity_methods_v1%ROWTYPE;
BEGIN
 IF kind_value='method' THEN
  SELECT * INTO method_value FROM public.canonical_forecast_workload_capacity_methods_v1 WHERE target_key=target_value;
  IF NOT FOUND THEN RAISE EXCEPTION 'Method unavailable' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('target',method_value.target_key,'version',method_value.target_version,
   'unit',method_value.unit,'horizonSeconds',method_value.horizon_seconds,
   'calculationVersion',method_value.calculation_version,'definitionDigest',method_value.definition_digest);
 ELSIF kind_value='capacity_role_scope' THEN
  SELECT * INTO method_value FROM public.canonical_forecast_workload_capacity_methods_v1
   WHERE target_key='capacity.available_role_hours.v1';
  IF NOT FOUND OR role_name NOT IN('owner','administrator','dispatcher','estimator','crew_lead','technician','accounting','employee','other') THEN
   RAISE EXCEPTION 'Declared capacity role unavailable' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('target',method_value.target_key,'version',method_value.target_version,
   'calculationVersion',method_value.calculation_version,'definitionDigest',method_value.definition_digest,
   'declaredRole',role_name,'scopeVersion','m26-base-capacity-declared-role-v1');
 ELSIF kind_value='remaining_work' THEN
  SELECT * INTO plan_value FROM public.canonical_forecast_current_backlog_person_plan_reviews
   WHERE organization_id=org AND appointment_id=subject_value ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND OR plan_value.action<>'approve'
    OR public.canonical_forecast_backlog_person_plan_stale(plan_value) THEN
   RAISE EXCEPTION 'Current approved person plan unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO assignment_value FROM public.canonical_schedule_assignments
   WHERE organization_id=org AND id=plan_value.assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved assignment unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO completion_value FROM public.canonical_completion_records
   WHERE organization_id=org AND assignment_id=plan_value.assignment_id AND record_kind<>'proposal'
   ORDER BY decided_at DESC,id DESC LIMIT 1;
  RETURN jsonb_build_object('appointmentId',plan_value.appointment_id,'personPlanId',plan_value.id,
   'personPlanRevision',plan_value.revision,'personPlanDigest',rtrim(plan_value.digest),
   'estimateId',plan_value.estimate_id,'estimateDecisionId',plan_value.estimate_decision_id,
   'estimateDecisionRevision',plan_value.estimate_decision_revision,
   'estimateDecisionDigest',rtrim(plan_value.estimate_decision_digest),
   'laborPlanId',plan_value.labor_plan_id,'laborPlanRevision',plan_value.labor_plan_revision,
   'laborPlanDigest',rtrim(plan_value.labor_plan_digest),'sourceGeneration',plan_value.source_generation,
   'plannedPersonMinutes',plan_value.planned_person_minutes,'assignmentId',assignment_value.id,
   'assignmentRevision',assignment_value.revision,'assignmentDigest',rtrim(assignment_value.canonical_digest),
   'completionId',completion_value.id,'completionDigest',rtrim(completion_value.canonical_digest),
   'completionState',completion_value.lifecycle_after);
ELSIF kind_value='role_qualification' THEN
 SELECT * INTO profile_value FROM public.workforce_profiles WHERE organization_id=org AND id=subject_value;
 IF NOT FOUND OR profile_value.operational_role<>role_name THEN
   RAISE EXCEPTION 'Operational role changed' USING ERRCODE='22023';END IF;
 SELECT * INTO membership_value FROM public.organization_memberships
  WHERE organization_id=org AND id=profile_value.membership_id;
 SELECT * INTO account_value FROM public.users
  WHERE organization_id=org AND id=membership_value.user_id;
 IF membership_value.status<>'active' OR account_value.status<>'active' THEN
  RAISE EXCEPTION 'Active workforce authority unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO role_generation
 FROM public.canonical_forecast_workload_capacity_role_generations_v1
 WHERE organization_id=org AND profile_id=subject_value
 ORDER BY generation DESC LIMIT 1;
 IF NOT FOUND OR NOT role_generation.present OR role_generation.operational_role<>role_name
   OR role_generation.membership_id<>membership_value.id OR role_generation.user_id<>account_value.id
   OR role_generation.membership_role<>membership_value.role
   OR role_generation.membership_status<>membership_value.status
   OR role_generation.account_status<>account_value.status THEN
  RAISE EXCEPTION 'Operational role source generation unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO profile_event FROM public.canonical_work_profile_events
  WHERE organization_id=org AND profile_id=subject_value AND stream='profile'
  ORDER BY revision DESC LIMIT 1;
 IF membership_value.role='member' AND (NOT FOUND OR profile_event.status<>'approved'
   OR profile_event.action<>'approve' OR jsonb_array_length(profile_event.verified_certification_ids)=0) THEN
  RAISE EXCEPTION 'Approved work profile and reviewed certifications required' USING ERRCODE='22023';END IF;
 IF membership_value.role='member' THEN
  SELECT * INTO profile_generation
  FROM public.canonical_forecast_workload_capacity_profile_events_v1
  WHERE organization_id=org AND event_id=profile_event.id;
  IF NOT FOUND OR profile_generation.action<>'approve' OR profile_generation.status<>'approved'
    OR profile_generation.revision<>profile_event.revision
    OR profile_generation.source_request_digest<>rtrim(profile_event.request_digest)
    OR profile_generation.verified_certification_ids<>profile_event.verified_certification_ids THEN
   RAISE EXCEPTION 'Approved work profile source generation unavailable' USING ERRCODE='22023';END IF;
 END IF;
 RETURN jsonb_build_object('profileId',profile_value.id,'operationalRole',profile_value.operational_role,
   'roleSourceGeneration',role_generation.generation,'roleSourceOrder',role_generation.source_order,
   'roleSourceDigest',role_generation.source_digest,
   'profileUpdatedAt',public.canonical_forecast_utc_instant(profile_value.updated_at),
   'membershipId',membership_value.id,'membershipRole',membership_value.role,
   'membershipStatus',membership_value.status,
   'membershipUpdatedAt',public.canonical_forecast_utc_instant(membership_value.updated_at),
   'accountId',account_value.id,'accountStatus',account_value.status,
   'accountUpdatedAt',public.canonical_forecast_utc_instant(account_value.updated_at),
   'm23SelfProfileEligible',membership_value.role='member',
   'profileReviewId',CASE WHEN membership_value.role='member' THEN profile_event.id ELSE NULL END,
   'profileReviewRevision',CASE WHEN membership_value.role='member' THEN profile_event.revision ELSE NULL END,
   'profileReviewDigest',CASE WHEN membership_value.role='member' THEN profile_event.request_digest ELSE NULL END,
   'profileEventSourceOrder',CASE WHEN membership_value.role='member' THEN profile_generation.source_order ELSE NULL END,
   'profileEventDigest',CASE WHEN membership_value.role='member' THEN profile_generation.digest ELSE NULL END,
   'verifiedCertificationIds',CASE WHEN membership_value.role='member'
    THEN profile_event.verified_certification_ids ELSE '[]'::jsonb END,
   'qualificationScope',CASE WHEN membership_value.role='member'
    THEN 'owner_reviewed_m23_profile_and_operational_role'
    ELSE 'owner_reviewed_internal_operational_role_only' END,
   'independentCredentialVerified',FALSE,'providerCertificationVerified',FALSE);
 ELSIF kind_value='availability_basis' THEN
  SELECT * INTO availability_value FROM public.canonical_workforce_availability_authorities
   WHERE organization_id=org AND workforce_profile_id=subject_value;
  IF NOT FOUND THEN RAISE EXCEPTION 'Declared availability unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO availability_revision FROM public.canonical_workforce_availability_revisions
   WHERE organization_id=org AND availability_id=availability_value.id ORDER BY revision DESC LIMIT 1;
  RETURN jsonb_build_object('profileId',subject_value,'availabilityId',availability_value.id,
   'revisionId',availability_revision.id,'revision',availability_revision.revision,
   'digest',rtrim(availability_revision.canonical_digest),'coverageStart',
   public.canonical_forecast_utc_instant(availability_revision.coverage_start),'coverageEnd',
   public.canonical_forecast_utc_instant(availability_revision.coverage_end),
   'intervals',availability_revision.intervals,'declaredAvailabilityOnly',TRUE,'realizedAttendanceVerified',FALSE);
 END IF;
 RAISE EXCEPTION 'Review kind unavailable' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_capacity_calculation(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,as_of_value TIMESTAMPTZ,role_name TEXT)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 WITH roster AS (
  SELECT DISTINCT ON (value.profile_id) value.*
  FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
  WHERE value.organization_id=org AND value.observed_at<=start_value
  ORDER BY value.profile_id,value.source_order DESC
 ), role_review AS (
  SELECT DISTINCT ON (value.subject_id,value.operational_role) value.*
  FROM public.canonical_forecast_workload_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='role_qualification'
   AND value.decided_at<=start_value
 ORDER BY value.subject_id,value.operational_role,value.revision DESC
 ), profile_event AS (
  SELECT DISTINCT ON (value.profile_id) value.*
  FROM public.canonical_forecast_workload_capacity_profile_events_v1 value
  WHERE value.organization_id=org AND value.observed_at<=start_value
  ORDER BY value.profile_id,value.source_order DESC
 ), census AS (
  SELECT roster.profile_id,roster.operational_role,roster.generation role_source_generation,
   roster.source_order role_source_order,roster.source_digest role_event_digest,
   roster.membership_id,roster.user_id,roster.membership_role,
   roster.membership_status,roster.account_status,
   role_review.id role_review_id,
   role_review.action role_action,role_review.digest role_review_digest,
   role_review.source_identity role_source,role_review.source_digest role_source_digest,
   profile_event.event_id profile_event_id,profile_event.revision profile_event_revision,
   profile_event.action profile_event_action,profile_event.status profile_event_status,
   profile_event.verified_certification_ids profile_verified_certification_ids,
   profile_event.source_request_digest profile_request_digest,
   profile_event.source_order profile_event_source_order,profile_event.digest profile_event_digest
  FROM roster
  LEFT JOIN role_review ON role_review.subject_id=roster.profile_id
   AND role_review.operational_role=roster.operational_role
  LEFT JOIN profile_event ON profile_event.profile_id=roster.profile_id
  WHERE roster.present AND roster.membership_status='active' AND roster.account_status='active'
 ), classified AS (
  SELECT census.*,CASE WHEN role_review_id IS NULL OR role_action<>'approve' THEN FALSE
   WHEN membership_role='member' THEN
    (census.role_source->>'roleSourceGeneration')::bigint=census.role_source_generation
    AND (census.role_source->>'roleSourceOrder')::bigint=census.role_source_order
    AND census.role_source->>'roleSourceDigest'=census.role_event_digest
    AND census.role_source->>'operationalRole'=census.operational_role
    AND (census.role_source->>'membershipId')::uuid=census.membership_id
    AND (census.role_source->>'accountId')::uuid=census.user_id
    AND census.role_source->>'membershipRole'=census.membership_role
    AND census.role_source->>'membershipStatus'=census.membership_status
    AND census.role_source->>'accountStatus'=census.account_status
    AND census.role_source->>'qualificationScope'='owner_reviewed_m23_profile_and_operational_role'
    AND (census.role_source->>'profileReviewId')::uuid=census.profile_event_id
    AND (census.role_source->>'profileReviewRevision')::integer=census.profile_event_revision
    AND census.role_source->>'profileReviewDigest'=census.profile_request_digest
    AND (census.role_source->>'profileEventSourceOrder')::bigint=census.profile_event_source_order
    AND census.role_source->>'profileEventDigest'=census.profile_event_digest
    AND census.profile_event_action='approve' AND census.profile_event_status='approved'
    AND census.role_source->'verifiedCertificationIds'=census.profile_verified_certification_ids
   ELSE
    (census.role_source->>'roleSourceGeneration')::bigint=census.role_source_generation
    AND (census.role_source->>'roleSourceOrder')::bigint=census.role_source_order
    AND census.role_source->>'roleSourceDigest'=census.role_event_digest
    AND census.role_source->>'operationalRole'=census.operational_role
    AND (census.role_source->>'membershipId')::uuid=census.membership_id
    AND (census.role_source->>'accountId')::uuid=census.user_id
    AND census.role_source->>'membershipRole'=census.membership_role
    AND census.role_source->>'membershipStatus'=census.membership_status
    AND census.role_source->>'accountStatus'=census.account_status
    AND census.role_source->>'qualificationScope'='owner_reviewed_internal_operational_role_only'
    AND census.role_source->>'profileReviewId' IS NULL END classification_current
  FROM census
 ), availability_review AS (
  SELECT DISTINCT ON (value.subject_id) value.*
  FROM public.canonical_forecast_workload_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='availability_basis'
   AND value.decided_at<=start_value
  ORDER BY value.subject_id,value.revision DESC
 ), target_population AS (
  SELECT classified.*,availability_review.id availability_review_id,
   availability_review.action availability_action,availability_review.digest availability_review_digest,
   availability_review.source_identity availability_source
  FROM classified LEFT JOIN availability_review ON availability_review.subject_id=classified.profile_id
  WHERE classified.operational_role=role_name
 ), qualified AS (
  SELECT target_population.*,
   (availability_source->>'availabilityId')::uuid availability_id,
   (availability_source->>'revision')::bigint availability_revision,
   availability_source->>'digest' availability_digest,
   availability_source->'intervals' availability_intervals,
   (availability_review_id IS NOT NULL AND availability_action='approve'
    AND availability_revision_source.id=(availability_source->>'revisionId')::uuid
    AND availability_revision_source.revision=(availability_source->>'revision')::bigint
    AND rtrim(availability_revision_source.canonical_digest)=availability_source->>'digest'
    AND availability_revision_source.intervals=availability_source->'intervals'
    AND (availability_source->>'coverageStart')::timestamptz<=start_value
    AND (availability_source->>'coverageEnd')::timestamptz>=end_value) availability_current
  FROM target_population LEFT JOIN public.canonical_workforce_availability_revisions availability_revision_source
   ON availability_revision_source.organization_id=org
    AND availability_revision_source.id=(target_population.availability_source->>'revisionId')::uuid
 ), declared AS (
  SELECT qualified.*,
   GREATEST(COALESCE(sum(EXTRACT(EPOCH FROM(LEAST((interval_value->>'end')::timestamptz,end_value)-
    GREATEST((interval_value->>'start')::timestamptz,start_value)))/60)
    FILTER(WHERE interval_value->>'kind'='available'),0)
   -COALESCE(sum(EXTRACT(EPOCH FROM(LEAST((interval_value->>'end')::timestamptz,end_value)-
    GREATEST((interval_value->>'start')::timestamptz,start_value)))/60)
    FILTER(WHERE interval_value->>'kind'='unavailable'),0),0) declared_minutes
  FROM qualified LEFT JOIN LATERAL jsonb_array_elements(qualified.availability_intervals) interval_value ON TRUE
  WHERE interval_value IS NULL OR ((interval_value->>'start')::timestamptz<end_value
   AND (interval_value->>'end')::timestamptz>start_value)
  GROUP BY qualified.profile_id,qualified.operational_role,qualified.role_source_generation,
   qualified.role_source_order,qualified.role_event_digest,qualified.membership_id,qualified.user_id,
   qualified.membership_role,qualified.membership_status,qualified.account_status,
   qualified.role_review_id,qualified.role_action,
   qualified.role_review_digest,qualified.role_source,qualified.role_source_digest,
   qualified.profile_event_id,qualified.profile_event_revision,qualified.profile_event_action,
   qualified.profile_event_status,qualified.profile_verified_certification_ids,
   qualified.profile_request_digest,qualified.profile_event_source_order,qualified.profile_event_digest,
   qualified.classification_current,
   qualified.availability_review_id,qualified.availability_action,
   qualified.availability_review_digest,qualified.availability_source,qualified.availability_id,
   qualified.availability_revision,qualified.availability_digest,qualified.availability_intervals,
   qualified.availability_current
 ), decision AS (
  SELECT revision_value.*,COALESCE(human_value.approved_at,approval_value.approved_at) decision_at
  FROM public.canonical_schedule_assignment_revisions revision_value
  LEFT JOIN public.canonical_schedule_human_approvals human_value
   ON human_value.organization_id=revision_value.organization_id AND human_value.id=revision_value.human_approval_id
  LEFT JOIN public.canonical_schedule_approvals approval_value
   ON approval_value.organization_id=revision_value.organization_id AND approval_value.id=revision_value.approval_id
  WHERE revision_value.organization_id=org
 ), current_decision AS (
  SELECT DISTINCT ON (assignment_id) * FROM decision
  WHERE decision_at IS NOT NULL AND decision_at<=as_of_value AND decision_at<end_value
  ORDER BY assignment_id,decision_at DESC,revision DESC
 ), commitment_members AS (
  SELECT assignment.assignment_id,assignment.canonical_digest assignment_digest,assignment.decision_at,
   COALESCE(assignment.workforce_profile_id,member.profile_id) profile_id,
   GREATEST(assignment.scheduled_start,start_value) starts_at,LEAST(assignment.scheduled_end,end_value) ends_at
  FROM current_decision assignment
  LEFT JOIN LATERAL (SELECT latest.* FROM (SELECT DISTINCT ON (crew_id,profile_id) *
   FROM public.canonical_forecast_workload_capacity_crew_events_v1 event_value
   WHERE event_value.organization_id=org AND event_value.crew_id=assignment.workforce_crew_id
    AND event_value.observed_at<=assignment.decision_at
   ORDER BY crew_id,profile_id,source_order DESC) latest WHERE latest.present) member ON TRUE
  WHERE assignment.schedule_state='scheduled' AND assignment.target_state='assigned'
   AND CASE WHEN NOT assignment.needs_review THEN TRUE
    WHEN jsonb_typeof(assignment.review_reasons)<>'array' OR jsonb_array_length(assignment.review_reasons)=0 THEN FALSE
    ELSE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(assignment.review_reasons) reason_value
      WHERE jsonb_typeof(reason_value)<>'object' OR COALESCE(reason_value->>'code','')
       NOT IN('location_scope_authority_missing','required_skill_authority_missing')) END
   AND assignment.scheduled_start<end_value AND assignment.scheduled_end>start_value
 ), commitment_overlap AS (
  SELECT EXISTS(SELECT 1 FROM commitment_members left_value JOIN commitment_members right_value
   ON right_value.profile_id=left_value.profile_id AND right_value.assignment_id>left_value.assignment_id
    AND right_value.starts_at<left_value.ends_at AND right_value.ends_at>left_value.starts_at) overlap
 ), commitments AS (
  SELECT profile_id,COALESCE(sum(EXTRACT(EPOCH FROM(ends_at-starts_at))/60),0) commitment_minutes,
   jsonb_agg(jsonb_build_object('assignmentId',assignment_id,'digest',rtrim(assignment_digest),
    'start',public.canonical_forecast_utc_instant(starts_at),'end',public.canonical_forecast_utc_instant(ends_at))
    ORDER BY starts_at,assignment_id) commitment_rows FROM commitment_members GROUP BY profile_id
 ), selected AS (
  SELECT declared.*,COALESCE(commitments.commitment_minutes,0) commitment_minutes,
   COALESCE(commitments.commitment_rows,'[]'::jsonb) commitment_rows,
   GREATEST(declared.declared_minutes-COALESCE(commitments.commitment_minutes,0),0) available_minutes
  FROM declared LEFT JOIN commitments USING(profile_id)
 )
 SELECT jsonb_build_object('censusCount',(SELECT count(*) FROM classified),
  'classificationComplete',COALESCE((SELECT bool_and(classification_current) FROM classified),TRUE),
  'targetCount',(SELECT count(*) FROM target_population),
  'availabilityComplete',COALESCE((SELECT bool_and(classification_current AND availability_current) FROM qualified),TRUE),
  'count',count(*),'minutes',COALESCE(sum(available_minutes),0),'overlap',(SELECT overlap FROM commitment_overlap),
  'rows',COALESCE(jsonb_agg(jsonb_build_object('profileId',profile_id,'role',operational_role,
   'roleSourceGeneration',role_source_generation,'roleSourceOrder',role_source_order,
   'roleSourceDigest',role_event_digest,
   'roleReviewId',role_review_id,'roleReviewDigest',role_review_digest,
   'profileEventId',profile_event_id,'profileEventRevision',profile_event_revision,
   'profileEventSourceOrder',profile_event_source_order,'profileEventDigest',profile_event_digest,
   'availabilityReviewId',availability_review_id,'availabilityReviewDigest',availability_review_digest,
   'availabilityId',availability_id,'availabilityRevision',availability_revision,
   'availabilityDigest',availability_digest,'declaredMinutes',round(declared_minutes,6),
   'commitmentMinutes',round(commitment_minutes,6),'availableMinutes',round(available_minutes,6),
   'commitments',commitment_rows) ORDER BY profile_id),'[]'::jsonb)) FROM selected
$$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_capacity_evidence(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,as_of_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows_value JSONB;count_value BIGINT;census_count BIGINT;minutes_value NUMERIC;
 bad_commitment BOOLEAN;summary_json JSONB;role_scope public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 epoch_value public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
BEGIN
 SELECT * INTO epoch_value FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workload coverage epoch unavailable' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
    WHERE value.organization_id=org
     AND value.source_order>COALESCE((epoch_value.source_counts->>'roleGenerationOrder')::bigint,0)
     AND value.observed_at>start_value AND value.observed_at<end_value)
 OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_profile_events_v1 value
    WHERE value.organization_id=org
     AND value.source_order>COALESCE((epoch_value.source_counts->>'profileEventOrder')::bigint,0)
     AND value.observed_at>start_value AND value.observed_at<end_value)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 value
    WHERE value.organization_id=org
     AND value.review_kind IN('role_qualification','availability_basis','capacity_role_scope')
     AND value.decided_at>start_value AND value.decided_at<end_value)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_availability_events_v1 value
    WHERE value.organization_id=org
     AND value.source_order>COALESCE((epoch_value.source_counts->>'availabilityEventOrder')::bigint,0)
     AND value.observed_at>start_value AND value.observed_at<end_value)
  OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_crew_events_v1 value
    WHERE value.organization_id=org
     AND value.source_order>COALESCE((epoch_value.source_counts->>'crewGenerationOrder')::bigint,0)
     AND value.observed_at>start_value AND value.observed_at<end_value)
  OR EXISTS(SELECT 1 FROM public.canonical_schedule_approvals value
    WHERE value.organization_id=org AND value.approved_at>start_value AND value.approved_at<end_value)
  OR EXISTS(SELECT 1 FROM public.canonical_schedule_human_approvals value
    WHERE value.organization_id=org AND value.approved_at>start_value AND value.approved_at<end_value) THEN
  RAISE EXCEPTION 'Capacity eligibility or commitment changed inside window' USING ERRCODE='22023';
 END IF;
 SELECT * INTO role_scope FROM public.canonical_forecast_workload_capacity_reviews_v1 value
 WHERE value.organization_id=org AND value.review_kind='capacity_role_scope'
  AND value.target_key='capacity.available_role_hours.v1' AND value.decided_at<=start_value
 ORDER BY value.revision DESC LIMIT 1;
 IF NOT FOUND OR role_scope.action<>'approve' OR role_scope.source_digest<>
   public.canonical_completion_digest(public.canonical_forecast_workload_capacity_v1_review_source(
    org,'capacity_role_scope','capacity.available_role_hours.v1',NULL,role_scope.operational_role)) THEN
  RAISE EXCEPTION 'Declared capacity role unavailable' USING ERRCODE='22023';END IF;
 WITH decision AS (
  SELECT revision_value.*,COALESCE(human_value.approved_at,approval_value.approved_at) decision_at
  FROM public.canonical_schedule_assignment_revisions revision_value
  LEFT JOIN public.canonical_schedule_human_approvals human_value
   ON human_value.organization_id=revision_value.organization_id AND human_value.id=revision_value.human_approval_id
  LEFT JOIN public.canonical_schedule_approvals approval_value
   ON approval_value.organization_id=revision_value.organization_id AND approval_value.id=revision_value.approval_id
  WHERE revision_value.organization_id=org
 ), current_decision AS (
  SELECT DISTINCT ON (assignment_id) * FROM decision
  WHERE decision_at IS NOT NULL AND decision_at<=as_of_value AND decision_at<end_value
  ORDER BY assignment_id,decision_at DESC,revision DESC
 ) SELECT EXISTS(SELECT 1 FROM current_decision value
  WHERE value.schedule_state='scheduled' AND value.scheduled_start<end_value AND value.scheduled_end>start_value
   AND (value.target_state<>'assigned' OR ((value.workforce_profile_id IS NULL)::integer+
        (value.workforce_crew_id IS NULL)::integer)<>1
    OR NOT CASE WHEN NOT value.needs_review THEN TRUE
      WHEN jsonb_typeof(value.review_reasons)<>'array' OR jsonb_array_length(value.review_reasons)=0 THEN FALSE
      ELSE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value.review_reasons) reason_value
       WHERE jsonb_typeof(reason_value)<>'object' OR COALESCE(reason_value->>'code','')
        NOT IN('location_scope_authority_missing','required_skill_authority_missing')) END
    OR (value.workforce_crew_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM
      (SELECT DISTINCT ON (crew_id,profile_id) * FROM public.canonical_forecast_workload_capacity_crew_events_v1 event_value
       WHERE event_value.organization_id=org AND event_value.crew_id=value.workforce_crew_id
        AND event_value.observed_at<=value.decision_at
       ORDER BY crew_id,profile_id,observed_at DESC,source_order DESC) member WHERE member.present)))) INTO bad_commitment;
 IF bad_commitment THEN RAISE EXCEPTION 'Commitment population incomplete' USING ERRCODE='22023';END IF;
 summary_json:=public.canonical_forecast_workload_capacity_v1_capacity_calculation(
  org,start_value,end_value,as_of_value,role_scope.operational_role);
 census_count:=(summary_json->>'censusCount')::bigint;count_value:=(summary_json->>'count')::bigint;
 minutes_value:=(summary_json->>'minutes')::numeric;rows_value:=summary_json->'rows';
 IF census_count>100 OR count_value>100 THEN RAISE EXCEPTION 'Capacity evidence exceeds bound' USING ERRCODE='54000';END IF;
 IF NOT (summary_json->>'classificationComplete')::boolean THEN
  RAISE EXCEPTION 'Active workforce role classification incomplete' USING ERRCODE='22023';END IF;
 IF NOT (summary_json->>'availabilityComplete')::boolean THEN
  RAISE EXCEPTION 'Declared-role availability evidence incomplete' USING ERRCODE='22023';END IF;
 IF COALESCE((summary_json->>'overlap')::boolean,FALSE) THEN
  RAISE EXCEPTION 'Overlapping commitments unavailable' USING ERRCODE='22023';END IF;
 IF octet_length(rows_value::text)>131072 THEN RAISE EXCEPTION 'Capacity evidence exceeds bound' USING ERRCODE='54000';END IF;
 RETURN jsonb_build_object('declaredRole',role_scope.operational_role,'roleScopeReviewId',role_scope.id,
  'roleScopeRevision',role_scope.revision,'roleScopeDigest',rtrim(role_scope.digest),
  'censusCount',census_count,'count',count_value,'availablePersonMinutes',round(minutes_value,6),'rows',rows_value,
  'declaredAvailabilityOnly',TRUE,'realizedAttendanceVerified',FALSE,'jobSpecificConstraintCompositionAvailable',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_capacity_evidence(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.canonical_forecast_workload_capacity_v1_capacity_evidence(
  org,start_value,end_value,public.canonical_forecast_workload_capacity_v1_clock())
$$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_window_evidence(
 org UUID,start_value TIMESTAMPTZ,end_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value JSONB;
BEGIN
 value:=jsonb_build_object(
  'labor',public.canonical_forecast_workload_capacity_v1_labor_evidence(org,start_value,end_value),
  'backlog',public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,end_value),
   'capacity',public.canonical_forecast_workload_capacity_v1_capacity_evidence(org,start_value,end_value,end_value));
 RETURN value||jsonb_build_object('digest',public.canonical_completion_digest(value));
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_source_counts(org UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'labor',(SELECT count(*) FROM public.canonical_labor_intervals WHERE organization_id=org),
  'completion',(SELECT count(*) FROM public.canonical_completion_records WHERE organization_id=org),
  'schedule',(SELECT count(*) FROM public.canonical_schedule_assignment_revisions WHERE organization_id=org),
  'availability',(SELECT count(*) FROM public.canonical_workforce_availability_revisions WHERE organization_id=org),
  'availabilityEvents',(SELECT count(*) FROM public.canonical_forecast_workload_capacity_availability_events_v1
   WHERE organization_id=org),
  'profileEvents',(SELECT count(*) FROM public.canonical_forecast_workload_capacity_profile_events_v1
   WHERE organization_id=org),
  'workProfile',(SELECT count(*) FROM public.canonical_work_profile_events WHERE organization_id=org),
  'crewMembership',(SELECT count(*) FROM public.workforce_crew_members WHERE organization_id=org),
  'crewEvents',(SELECT count(*) FROM public.canonical_forecast_workload_capacity_crew_events_v1 WHERE organization_id=org),
  'roleGenerations',(SELECT count(*) FROM public.canonical_forecast_workload_capacity_role_generations_v1
    WHERE organization_id=org),
  'personPlan',(SELECT count(*) FROM public.canonical_forecast_current_backlog_person_plan_reviews WHERE organization_id=org))
$$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_epoch_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 current_value public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 inserted public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 key_hash TEXT;request_hash TEXT;counts JSONB;now_value TIMESTAMPTZ;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR length(reason_value) NOT BETWEEN 10 AND 1000 OR confirmation_value<>'m26-workload-capacity-epoch-v1' THEN
  RAISE EXCEPTION 'Invalid workload epoch request' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','epoch','reason',reason_value,'confirmation',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:workload-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Workload key conflict' USING ERRCODE='23505';END IF;
  IF EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_epochs_v1 newer
    WHERE newer.organization_id=org AND newer.revision>old.revision) THEN
   RAISE EXCEPTION 'Workload epoch superseded' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','workload_capacity_epoch_recorded','id',old.id,'revision',old.revision,
   'installedAt',public.canonical_forecast_utc_instant(old.installed_at),'digest',rtrim(old.digest),'replayed',TRUE);
 END IF;
 SELECT * INTO current_value FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 INSERT INTO public.canonical_forecast_workload_capacity_crew_events_v1(
  organization_id,crew_id,profile_id,present,crew_role,source_created_at,observed_at,source_kind,digest)
 SELECT org,member.crew_id,member.profile_id,TRUE,member.crew_role,member.created_at,now_value,'epoch_baseline',
 public.canonical_completion_digest(jsonb_build_object('organizationId',org,'operation','epoch_baseline',
   'crewId',member.crew_id,'profileId',member.profile_id,'role',member.crew_role,
   'sourceCreatedAt',public.canonical_forecast_utc_instant(member.created_at),
   'observedAt',public.canonical_forecast_utc_instant(now_value)))
 FROM public.workforce_crew_members member WHERE member.organization_id=org;
 -- Pre-installation M23 events receive one prospective epoch observation.  If
 -- the ordinary writer trigger already observed an event, its immutable
 -- generation wins and the baseline insert is a no-op.
 INSERT INTO public.canonical_forecast_workload_capacity_profile_events_v1(
  organization_id,source_order,profile_id,event_id,revision,action,status,
  verified_certification_ids,source_request_digest,source_created_at,observed_at,source_kind,digest)
 SELECT org,nextval('public.canonical_forecast_workload_capacity_source_order_v1'),source.profile_id,
  source.id,source.revision,source.action,source.status,source.verified_certification_ids,
  rtrim(source.request_digest),source.created_at,now_value,'epoch_baseline',
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,
   'profileId',source.profile_id,'eventId',source.id,'revision',source.revision,
   'action',source.action,'status',source.status,'verifiedCertificationIds',source.verified_certification_ids,
   'sourceRequestDigest',rtrim(source.request_digest),'sourceKind','epoch_baseline',
   'sourceCreatedAt',public.canonical_forecast_utc_instant(source.created_at),
   'observedAt',public.canonical_forecast_utc_instant(now_value)))
 FROM (SELECT DISTINCT ON (value.profile_id) value.*
  FROM public.canonical_work_profile_events value
  WHERE value.organization_id=org AND value.stream='profile'
  ORDER BY value.profile_id,value.revision DESC) source
 ON CONFLICT(organization_id,event_id) DO NOTHING;
 -- The explicitly authorized prospective epoch freezes the then-current
 -- assignable workforce as the first supported as-of roster. This event is
 -- append-only; later source changes create later events and cannot rewrite it.
 WITH snapshot AS MATERIALIZED (
  SELECT profile.id profile_id,profile.membership_id,account.id user_id,
   profile.operational_role,membership.role membership_role,
   membership.status membership_status,account.status account_status,
   profile.updated_at profile_updated_at,membership.updated_at membership_updated_at,
   account.updated_at account_updated_at,
   COALESCE((SELECT max(value.generation) FROM public.canonical_forecast_workload_capacity_role_generations_v1 value
    WHERE value.organization_id=org AND value.profile_id=profile.id),0)+1 generation,
   nextval('public.canonical_forecast_workload_capacity_source_order_v1') source_order
  FROM public.workforce_profiles profile
  JOIN public.organization_memberships membership
   ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
  JOIN public.users account
   ON account.organization_id=profile.organization_id AND account.id=membership.user_id
  WHERE profile.organization_id=org
 ) INSERT INTO public.canonical_forecast_workload_capacity_role_generations_v1(
  organization_id,profile_id,generation,source_order,source_digest,observed_at,present,
  membership_id,user_id,operational_role,membership_role,membership_status,account_status,
  profile_updated_at,membership_updated_at,account_updated_at,source_table,source_operation)
 SELECT org,profile_id,generation,source_order,
  public.canonical_completion_digest(jsonb_build_object('organizationId',org,'profileId',profile_id,
   'sourceTable','epoch','operation','baseline','sourceOrder',source_order,
   'operationalRole',operational_role,'membershipRole',membership_role,
   'membershipStatus',membership_status,'accountStatus',account_status)),now_value,TRUE,
  membership_id,user_id,operational_role,membership_role,membership_status,account_status,
  profile_updated_at,membership_updated_at,account_updated_at,'epoch','baseline' FROM snapshot;
 counts:=public.canonical_forecast_workload_capacity_v1_source_counts(org)||jsonb_build_object(
  'crewGenerationOrder',COALESCE((SELECT max(source_order)
    FROM public.canonical_forecast_workload_capacity_crew_events_v1 WHERE organization_id=org),0),
  'roleGenerationOrder',COALESCE((SELECT max(source_order)
    FROM public.canonical_forecast_workload_capacity_role_generations_v1 WHERE organization_id=org),0),
  'profileEventOrder',COALESCE((SELECT max(source_order)
    FROM public.canonical_forecast_workload_capacity_profile_events_v1 WHERE organization_id=org),0),
  'availabilityEventOrder',COALESCE((SELECT max(source_order)
    FROM public.canonical_forecast_workload_capacity_availability_events_v1 WHERE organization_id=org),0));
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'revision',COALESCE(current_value.revision,0)+1,
  'installedAt',public.canonical_forecast_utc_instant(now_value),'sourceCounts',counts));
 INSERT INTO public.canonical_forecast_workload_capacity_epochs_v1(
  organization_id,revision,previous_id,installed_at,source_counts,source_digest,actor_user_id,
  auth_session_id,reason,confirmation_version,request_key_hash,request_digest,digest)
 VALUES(org,COALESCE(current_value.revision,0)+1,current_value.id,now_value,counts,
  public.canonical_completion_digest(counts),actor,session_value,reason_value,confirmation_value,
  key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','workload_capacity_epoch_recorded','id',inserted.id,'revision',inserted.revision,
  'installedAt',public.canonical_forecast_utc_instant(inserted.installed_at),'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_review_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 kind_value TEXT,target_value TEXT,subject_value UUID,role_name TEXT,action_value TEXT,
 expected_revision INTEGER,expected_digest TEXT,remaining_value BIGINT,reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 current_value public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 inserted public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 source_value JSONB;source_hash TEXT;key_hash TEXT;request_hash TEXT;scope_key BIGINT;digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR kind_value NOT IN('method','remaining_work','role_qualification','availability_basis','capacity_role_scope')
  OR target_value NOT IN('workload.accepted_person_hours.v1','workload.end_backlog_hours.v1','capacity.available_role_hours.v1')
  OR action_value NOT IN('approve','reject','withdraw') OR expected_revision<0
  OR expected_digest IS NULL OR (expected_digest<>'none' AND expected_digest!~'^[0-9a-f]{64}$')
  OR ((expected_revision=0)<>(expected_digest='none')) OR length(reason_value) NOT BETWEEN 10 AND 1000
  OR confirmation_value<>'m26-workload-capacity-review-v1'
  OR (kind_value='method' AND (subject_value IS NOT NULL OR role_name IS NOT NULL OR remaining_value IS NOT NULL))
  OR (kind_value='remaining_work' AND (target_value<>'workload.end_backlog_hours.v1' OR subject_value IS NULL OR role_name IS NOT NULL OR remaining_value IS NULL))
  OR (kind_value='role_qualification' AND (target_value<>'capacity.available_role_hours.v1' OR subject_value IS NULL OR role_name IS NULL OR remaining_value IS NOT NULL))
  OR (kind_value='availability_basis' AND (target_value<>'capacity.available_role_hours.v1' OR subject_value IS NULL OR role_name IS NOT NULL OR remaining_value IS NOT NULL))
  OR (kind_value='capacity_role_scope' AND (target_value<>'capacity.available_role_hours.v1' OR subject_value IS NOT NULL OR role_name IS NULL OR remaining_value IS NOT NULL)) THEN
  RAISE EXCEPTION 'Invalid workload review request' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 source_value:=public.canonical_forecast_workload_capacity_v1_review_source(org,kind_value,target_value,subject_value,role_name);
 source_hash:=public.canonical_completion_digest(source_value);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind',kind_value,'target',target_value,
  'subjectId',subject_value,'role',role_name,'action',action_value,'expectedRevision',expected_revision,
  'expectedDigest',expected_digest,'remainingPersonMinutes',remaining_value,'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:workload-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_workload_capacity_reviews_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Workload key conflict' USING ERRCODE='23505';END IF;
  IF old.source_digest<>source_hash THEN RAISE EXCEPTION 'Reviewed source changed' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','workload_capacity_review_recorded','id',old.id,'kind',old.review_kind,
   'target',old.target_key,'subjectId',old.subject_id,'role',old.operational_role,'action',old.action,
   'revision',old.revision,'digest',rtrim(old.digest),'replayed',TRUE);
 END IF;
 SELECT * INTO current_value FROM public.canonical_forecast_workload_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind=kind_value AND value.target_key=target_value
   AND value.subject_id IS NOT DISTINCT FROM subject_value AND value.operational_role IS NOT DISTINCT FROM role_name
  ORDER BY value.revision DESC LIMIT 1;
 IF kind_value='capacity_role_scope' THEN
  SELECT * INTO current_value FROM public.canonical_forecast_workload_capacity_reviews_v1 value
   WHERE value.organization_id=org AND value.review_kind=kind_value AND value.target_key=target_value
   ORDER BY value.revision DESC LIMIT 1;
 END IF;
 IF COALESCE(current_value.revision,0)<>expected_revision OR
  COALESCE(rtrim(current_value.digest),'none')<>expected_digest THEN
  RAISE EXCEPTION 'Workload review changed' USING ERRCODE='40001';END IF;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('kind',kind_value,'target',target_value,
  'subjectId',subject_value,'role',role_name,'revision',expected_revision+1,'action',action_value,
  'remainingPersonMinutes',remaining_value,'sourceDigest',source_hash));
 INSERT INTO public.canonical_forecast_workload_capacity_reviews_v1(
  organization_id,review_kind,target_key,subject_id,operational_role,revision,previous_id,action,
  remaining_person_minutes,source_identity,source_digest,actor_user_id,auth_session_id,reason,
  confirmation_version,request_key_hash,request_digest,decided_at,digest)
 VALUES(org,kind_value,target_value,subject_value,role_name,expected_revision+1,current_value.id,action_value,
  remaining_value,source_value,source_hash,actor,session_value,reason_value,confirmation_value,key_hash,
  request_hash,public.canonical_forecast_workload_capacity_v1_clock(),digest_value) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','workload_capacity_review_recorded','id',inserted.id,'kind',inserted.review_kind,
  'target',inserted.target_key,'subjectId',inserted.subject_id,'role',inserted.operational_role,'action',inserted.action,
  'revision',inserted.revision,'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_window_current(
 org UUID,value public.canonical_forecast_workload_capacity_windows_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE evidence_value JSONB;current_epoch_id UUID;
BEGIN
 SELECT id INTO current_epoch_id FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 -- An epoch is a prospective coverage boundary, not a resettable source
 -- counter.  Supersession permanently retires receipts pinned to an older
 -- boundary before evidence is recomputed with the newer baseline.
 IF current_epoch_id IS NULL OR value.epoch_id<>current_epoch_id THEN RETURN FALSE;END IF;
 evidence_value:=public.canonical_forecast_workload_capacity_v1_window_evidence(
  org,value.window_start,value.window_end);
 RETURN rtrim(value.source_digest)=evidence_value->>'digest';
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_window_finalize(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 start_value TIMESTAMPTZ,end_value TIMESTAMPTZ,reason_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_value public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 old public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 current_value public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 inserted public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 evidence_value JSONB;counts JSONB;key_hash TEXT;request_hash TEXT;digest_value TEXT;now_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
  OR end_value-start_value<>INTERVAL '30 days' OR length(reason_value) NOT BETWEEN 10 AND 1000 THEN
  RAISE EXCEPTION 'Invalid workload window' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','window','start',
  public.canonical_forecast_utc_instant(start_value),'end',public.canonical_forecast_utc_instant(end_value),'reason',reason_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:workload-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Workload key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_workload_capacity_v1_window_current(org,old) THEN
   RAISE EXCEPTION 'Finalized window changed' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','workload_capacity_window_finalized','id',old.id,
   'windowStart',public.canonical_forecast_utc_instant(old.window_start),
   'windowEnd',public.canonical_forecast_utc_instant(old.window_end),'capacityRole',old.capacity_role,
   'sourceCounts',old.source_counts,
   'digest',rtrim(old.digest),'replayed',TRUE);
 END IF;
 SELECT * INTO epoch_value FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR start_value<epoch_value.installed_at OR end_value>now_value THEN
  RAISE EXCEPTION 'Prospective ended window unavailable' USING ERRCODE='22023';END IF;
 evidence_value:=public.canonical_forecast_workload_capacity_v1_window_evidence(org,start_value,end_value);
 counts:=jsonb_build_object('labor',(evidence_value#>>'{labor,count}')::bigint,
  'backlog',(evidence_value#>>'{backlog,count}')::bigint,'capacity',(evidence_value#>>'{capacity,count}')::bigint);
 SELECT * INTO current_value FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND window_start=start_value AND window_end=end_value
  ORDER BY revision DESC LIMIT 1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,
  'windowStart',public.canonical_forecast_utc_instant(start_value),'windowEnd',public.canonical_forecast_utc_instant(end_value),
  'revision',COALESCE(current_value.revision,0)+1,'epochId',epoch_value.id,'sourceDigest',evidence_value->>'digest'));
  INSERT INTO public.canonical_forecast_workload_capacity_windows_v1(
   organization_id,window_start,window_end,revision,previous_id,capacity_role,epoch_id,source_counts,evidence,
  source_digest,actor_user_id,auth_session_id,reason,request_key_hash,request_digest,finalized_at,digest)
  VALUES(org,start_value,end_value,COALESCE(current_value.revision,0)+1,current_value.id,
   evidence_value#>>'{capacity,declaredRole}',epoch_value.id,
  counts,evidence_value,evidence_value->>'digest',actor,session_value,reason_value,key_hash,request_hash,now_value,digest_value)
 RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN jsonb_build_object('state','workload_capacity_window_finalized','id',inserted.id,
  'windowStart',public.canonical_forecast_utc_instant(inserted.window_start),
  'windowEnd',public.canonical_forecast_utc_instant(inserted.window_end),'capacityRole',inserted.capacity_role,
  'sourceCounts',inserted.source_counts,
  'digest',rtrim(inserted.digest),'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_origin_input(
 org UUID,cutoff_value TIMESTAMPTZ,horizon_value TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE backlog_value JSONB;capacity_value JSONB;value JSONB;
BEGIN
 backlog_value:=public.canonical_forecast_workload_capacity_v1_backlog_evidence(org,cutoff_value);
 capacity_value:=public.canonical_forecast_workload_capacity_v1_capacity_evidence(
  org,cutoff_value,horizon_value,cutoff_value);
 value:=jsonb_build_object('backlog',backlog_value,'capacity',capacity_value);
 RETURN value||jsonb_build_object('digest',public.canonical_completion_digest(value));
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_origin_current(
 org UUID,value public.canonical_forecast_workload_capacity_origins_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item JSONB;review_value public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 window_value public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 input_value JSONB;source_value JSONB;current_epoch_id UUID;
BEGIN
 SELECT id INTO current_epoch_id FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF current_epoch_id IS NULL OR value.epoch_id<>current_epoch_id THEN RETURN FALSE;END IF;
 FOR item IN SELECT jsonb_array_elements(value.method_review_ids) LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'id')::uuid;
  IF NOT FOUND OR review_value.action<>'approve' OR rtrim(review_value.digest)<>item->>'digest' OR
    EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 newer
     WHERE newer.organization_id=org AND newer.review_kind='method'
      AND newer.target_key=review_value.target_key AND newer.revision>review_value.revision) THEN RETURN FALSE;END IF;
 END LOOP;
 FOR item IN SELECT jsonb_array_elements(value.training_window_ids) LOOP
  SELECT * INTO window_value FROM public.canonical_forecast_workload_capacity_windows_v1
   WHERE organization_id=org AND id=(item->>'id')::uuid;
  IF NOT FOUND OR rtrim(window_value.digest)<>item->>'digest'
   OR NOT public.canonical_forecast_workload_capacity_v1_window_current(org,window_value)
   OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_windows_v1 newer
     WHERE newer.organization_id=org AND newer.window_start=window_value.window_start
      AND newer.window_end=window_value.window_end AND newer.revision>window_value.revision) THEN RETURN FALSE;END IF;
 END LOOP;
 input_value:=public.canonical_forecast_workload_capacity_v1_origin_input(
  org,value.prediction_cutoff_at,value.horizon_ends_at);
 IF input_value#>>'{capacity,declaredRole}'<>value.capacity_role OR
   input_value#>>'{capacity,roleScopeReviewId}' IS NULL OR EXISTS(
    SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 scope_value
    WHERE scope_value.organization_id=org AND scope_value.review_kind='capacity_role_scope'
     AND scope_value.target_key='capacity.available_role_hours.v1'
     AND scope_value.id<>(input_value#>>'{capacity,roleScopeReviewId}')::uuid
     AND scope_value.revision>(input_value#>>'{capacity,roleScopeRevision}')::integer) THEN RETURN FALSE;END IF;
 -- Backlog currentness is reconstructed at the immutable prediction cutoff.
 -- Ordinary completion/reopen/schedule progress after that cutoff is an
 -- authorized outcome, while a post-cutoff correction rooted in a pre-cutoff
 -- completion is included by backlog_evidence and changes the input digest.
 FOR item IN SELECT jsonb_array_elements(input_value#>'{capacity,rows}') LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'roleReviewId')::uuid;
  IF NOT FOUND OR review_value.action<>'approve' OR rtrim(review_value.digest)<>item->>'roleReviewDigest'
    OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 newer
      WHERE newer.organization_id=org AND newer.review_kind='role_qualification'
       AND newer.subject_id=review_value.subject_id AND newer.operational_role=review_value.operational_role
       AND newer.revision>review_value.revision AND newer.decided_at<=value.prediction_cutoff_at)
   THEN RETURN FALSE;END IF;
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND id=(item->>'availabilityReviewId')::uuid;
  IF NOT FOUND OR review_value.action<>'approve' OR rtrim(review_value.digest)<>item->>'availabilityReviewDigest'
    OR EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_reviews_v1 newer
      WHERE newer.organization_id=org AND newer.review_kind='availability_basis'
       AND newer.subject_id=review_value.subject_id AND newer.revision>review_value.revision
       AND newer.decided_at<=value.prediction_cutoff_at)
   THEN RETURN FALSE;END IF;
 END LOOP;
 RETURN input_value->>'digest'=value.input_evidence->>'digest';
EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_origin_projection(
 value public.canonical_forecast_workload_capacity_origins_v1,state_value TEXT,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',state_value,'id',value.id,'capacityRole',value.capacity_role,
  'predictionCutoffAt',public.canonical_forecast_utc_instant(value.prediction_cutoff_at),
  'horizonEndsAt',public.canonical_forecast_utc_instant(value.horizon_ends_at),
  'targets',jsonb_build_array('workload.accepted_person_hours.v1','workload.end_backlog_hours.v1',
   'capacity.available_role_hours.v1'),'refreshRequired',state_value='workload_capacity_origin_stale',
  'resultsWithheld',TRUE,'outputDigestsWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',replayed_value)
$$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_origin_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 reason_value TEXT,confirmation_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_value public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 old public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 inserted public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 method_value public.canonical_forecast_workload_capacity_methods_v1%ROWTYPE;
 review_value public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 current_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 inserted_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 first_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 second_window public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 method_ids JSONB:='[]'::jsonb;window_ids JSONB;input_value JSONB;results_value JSONB;
 key_hash TEXT;request_hash TEXT;source_hash TEXT;output_hash TEXT;digest_value TEXT;
 evidence_value JSONB;counts_value JSONB;window_key_hash TEXT;window_request_hash TEXT;
 window_digest TEXT;window_start_value TIMESTAMPTZ;window_end_value TIMESTAMPTZ;
 window_index INTEGER;
 cutoff_value TIMESTAMPTZ;horizon_value TIMESTAMPTZ;accepted_minutes NUMERIC;backlog_minutes NUMERIC;capacity_minutes NUMERIC;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
   OR length(reason_value) NOT BETWEEN 10 AND 900
   OR confirmation_value<>'m26-workload-capacity-origin-v1' THEN
  RAISE EXCEPTION 'Invalid workload origin request' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','origin',
  'reason',reason_value,'confirmationVersion',confirmation_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:workload-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Workload key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_workload_capacity_v1_origin_current(org,old) THEN
   RAISE EXCEPTION 'Saved workload origin stale' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_workload_capacity_v1_origin_projection(old,'workload_capacity_origin_saved',TRUE);
 END IF;
 -- The explicit origin action itself finalizes the exact two training windows
 -- atomically. The server issues cutoff only after all blocking source/access
 -- locks, so the future horizon never starts before a queued request resumes.
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(
  org,actor,role_value,session_value,csrf,TRUE);
 cutoff_value:=public.canonical_forecast_workload_capacity_v1_clock();
 horizon_value:=cutoff_value+INTERVAL '2592000 seconds';
 SELECT * INTO epoch_value FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR epoch_value.installed_at>cutoff_value-INTERVAL '5184000 seconds' THEN
  RAISE EXCEPTION 'Prospective workload history incomplete' USING ERRCODE='22023';END IF;
 FOR method_value IN SELECT * FROM public.canonical_forecast_workload_capacity_methods_v1 ORDER BY target_key LOOP
  SELECT * INTO review_value FROM public.canonical_forecast_workload_capacity_reviews_v1
   WHERE organization_id=org AND review_kind='method' AND target_key=method_value.target_key
   ORDER BY revision DESC LIMIT 1;
  IF NOT FOUND OR review_value.action<>'approve' OR
    review_value.source_digest<>public.canonical_completion_digest(public.canonical_forecast_workload_capacity_v1_review_source(
      org,'method',method_value.target_key,NULL,NULL)) THEN
   RAISE EXCEPTION 'Approved workload method unavailable' USING ERRCODE='22023';END IF;
  method_ids:=method_ids||jsonb_build_array(jsonb_build_object('id',review_value.id,
   'target',review_value.target_key,'revision',review_value.revision,'digest',rtrim(review_value.digest)));
 END LOOP;
 FOR window_index IN 1..2 LOOP
  window_start_value:=cutoff_value-((3-window_index)*INTERVAL '2592000 seconds');
  window_end_value:=window_start_value+INTERVAL '2592000 seconds';
  evidence_value:=public.canonical_forecast_workload_capacity_v1_window_evidence(
   org,window_start_value,window_end_value);
  counts_value:=jsonb_build_object('labor',(evidence_value#>>'{labor,count}')::bigint,
   'backlog',(evidence_value#>>'{backlog,count}')::bigint,
   'capacity',(evidence_value#>>'{capacity,count}')::bigint);
  SELECT * INTO current_window FROM public.canonical_forecast_workload_capacity_windows_v1
   WHERE organization_id=org AND window_start=window_start_value AND window_end=window_end_value
   ORDER BY revision DESC LIMIT 1;
  window_key_hash:=encode(sha256(convert_to(key_hash||':training-window:'||window_index::text,'UTF8')),'hex');
  window_request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','origin_training_window',
   'originRequestDigest',request_hash,'index',window_index,
   'start',public.canonical_forecast_utc_instant(window_start_value),
   'end',public.canonical_forecast_utc_instant(window_end_value)));
  window_digest:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,
   'windowStart',public.canonical_forecast_utc_instant(window_start_value),
   'windowEnd',public.canonical_forecast_utc_instant(window_end_value),
   'revision',COALESCE(current_window.revision,0)+1,'epochId',epoch_value.id,
   'sourceDigest',evidence_value->>'digest','originRequestDigest',request_hash));
  INSERT INTO public.canonical_forecast_workload_capacity_windows_v1(
   organization_id,window_start,window_end,revision,previous_id,capacity_role,epoch_id,
   source_counts,evidence,source_digest,actor_user_id,auth_session_id,reason,
   request_key_hash,request_digest,finalized_at,digest)
  VALUES(org,window_start_value,window_end_value,COALESCE(current_window.revision,0)+1,
   current_window.id,evidence_value#>>'{capacity,declaredRole}',epoch_value.id,counts_value,
   evidence_value,evidence_value->>'digest',actor,session_value,
   'Origin capture authorized this exact server-selected training window: '||reason_value,
   window_key_hash,window_request_hash,cutoff_value,window_digest)
  RETURNING * INTO inserted_window;
  IF window_index=1 THEN first_window:=inserted_window;ELSE second_window:=inserted_window;END IF;
 END LOOP;
 window_ids:=jsonb_build_array(jsonb_build_object('id',first_window.id,'digest',rtrim(first_window.digest)),
  jsonb_build_object('id',second_window.id,'digest',rtrim(second_window.digest)));
 input_value:=public.canonical_forecast_workload_capacity_v1_origin_input(org,cutoff_value,horizon_value);
 IF first_window.capacity_role<>second_window.capacity_role OR
   first_window.capacity_role<>input_value#>>'{capacity,declaredRole}' THEN
  RAISE EXCEPTION 'Declared capacity role changed' USING ERRCODE='40001';END IF;
 accepted_minutes:=((first_window.evidence#>>'{labor,personMinutes}')::numeric+
  (second_window.evidence#>>'{labor,personMinutes}')::numeric)/2;
 backlog_minutes:=(input_value#>>'{backlog,scheduledPersonMinutes}')::numeric+
  (input_value#>>'{backlog,unscheduledPersonMinutes}')::numeric;
 capacity_minutes:=(input_value#>>'{capacity,availablePersonMinutes}')::numeric;
 results_value:=jsonb_build_object(
  'workload.accepted_person_hours.v1',round(accepted_minutes/60,6),
  'workload.end_backlog_hours.v1',round(backlog_minutes/60,6),
  'capacity.available_role_hours.v1',round(capacity_minutes/60,6),
   'scheduledBacklogHours',round((input_value#>>'{backlog,scheduledPersonMinutes}')::numeric/60,6),
   'unscheduledBacklogHours',round((input_value#>>'{backlog,unscheduledPersonMinutes}')::numeric/60,6));
 IF octet_length(method_ids::text)+octet_length(window_ids::text)+
    octet_length(input_value::text)+octet_length(results_value::text)>262144 THEN
  RAISE EXCEPTION 'Workload origin evidence exceeds bound' USING ERRCODE='54000';END IF;
 source_hash:=public.canonical_completion_digest(jsonb_build_object('epoch',epoch_value.digest,'methods',method_ids,
  'training',window_ids,'inputDigest',input_value->>'digest'));
 output_hash:=public.canonical_completion_digest(results_value);
 digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'cutoff',
  public.canonical_forecast_utc_instant(cutoff_value),'horizon',public.canonical_forecast_utc_instant(horizon_value),
  'sourceDigest',source_hash,'outputDigest',output_hash));
 INSERT INTO public.canonical_forecast_workload_capacity_origins_v1(
  organization_id,prediction_cutoff_at,horizon_ends_at,capacity_role,epoch_id,method_review_ids,training_window_ids,
  input_evidence,private_results,source_digest,output_digest,actor_user_id,auth_session_id,
  request_key_hash,request_digest,digest)
 VALUES(org,cutoff_value,horizon_value,input_value#>>'{capacity,declaredRole}',epoch_value.id,method_ids,window_ids,input_value,results_value,
  source_hash,output_hash,actor,session_value,key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_workload_capacity_v1_origin_projection(inserted,'workload_capacity_origin_saved',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_origin_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=id_value;
 IF NOT FOUND THEN RETURN NULL;END IF;
 current_value:=public.canonical_forecast_workload_capacity_v1_origin_current(org,value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_workload_capacity_v1_origin_projection(value,
  CASE WHEN current_value THEN 'workload_capacity_origin_current' ELSE 'workload_capacity_origin_stale' END,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_evaluation_projection(
 value public.canonical_forecast_workload_capacity_evaluations_v1,state_value TEXT,replayed_value BOOLEAN)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('state',state_value,'id',value.id,'originId',value.origin_id,
  'capacityRole',value.capacity_role,
  'revision',value.revision,'evaluatedAt',public.canonical_forecast_utc_instant(value.evaluated_at),
  'targets',jsonb_build_array('workload.accepted_person_hours.v1','workload.end_backlog_hours.v1',
   'capacity.available_role_hours.v1'),'refreshRequired',state_value='workload_capacity_evaluation_stale',
  'metricsWithheld',TRUE,'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE,'replayed',replayed_value)
$$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_evaluation_current(
 org UUID,value public.canonical_forecast_workload_capacity_evaluations_v1)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE window_value public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 origin_value public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
BEGIN
 SELECT * INTO window_value FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND id=value.outcome_window_id;
 SELECT * INTO origin_value FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=value.origin_id;
 RETURN window_value.id IS NOT NULL AND origin_value.id IS NOT NULL
  AND rtrim(window_value.digest)=value.outcome_digest
  AND value.capacity_role=origin_value.capacity_role AND window_value.capacity_role=origin_value.capacity_role
  AND public.canonical_forecast_workload_capacity_v1_origin_current(org,origin_value)
  AND public.canonical_forecast_workload_capacity_v1_window_current(org,window_value)
  AND NOT EXISTS(SELECT 1 FROM public.canonical_forecast_workload_capacity_windows_v1 newer
   WHERE newer.organization_id=org AND newer.window_start=window_value.window_start
    AND newer.window_end=window_value.window_end AND newer.revision>window_value.revision);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_evaluation_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,origin_id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;origin_value public.canonical_forecast_workload_capacity_origins_v1%ROWTYPE;
 outcome_value public.canonical_forecast_workload_capacity_windows_v1%ROWTYPE;
 old public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 current_value public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 inserted public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;
 metrics_value JSONB;key_hash TEXT;request_hash TEXT;digest_value TEXT;now_value TIMESTAMPTZ;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' THEN
  RAISE EXCEPTION 'Invalid workload evaluation request' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 SELECT * INTO origin_value FROM public.canonical_forecast_workload_capacity_origins_v1
  WHERE organization_id=org AND id=origin_id_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workload evidence unavailable' USING ERRCODE='P0002';END IF;
 IF NOT public.canonical_forecast_workload_capacity_v1_origin_current(org,origin_value) THEN
  RAISE EXCEPTION 'Saved workload origin stale' USING ERRCODE='40001';END IF;
 now_value:=public.canonical_forecast_workload_capacity_v1_clock();
 IF now_value<origin_value.horizon_ends_at THEN
  RAISE EXCEPTION 'Workload outcome horizon incomplete' USING ERRCODE='22023';END IF;
 SELECT * INTO outcome_value FROM public.canonical_forecast_workload_capacity_windows_v1
  WHERE organization_id=org AND window_start=origin_value.prediction_cutoff_at
   AND window_end=origin_value.horizon_ends_at ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR NOT public.canonical_forecast_workload_capacity_v1_window_current(org,outcome_value) THEN
  RAISE EXCEPTION 'Complete workload outcome unavailable' USING ERRCODE='22023';END IF;
 metrics_value:=jsonb_build_object(
  'workload.accepted_person_hours.v1',jsonb_build_object('forecast',origin_value.private_results->'workload.accepted_person_hours.v1',
   'actual',round((outcome_value.evidence#>>'{labor,personMinutes}')::numeric/60,6)),
  'workload.end_backlog_hours.v1',jsonb_build_object('forecast',origin_value.private_results->'workload.end_backlog_hours.v1',
   'actual',round(((outcome_value.evidence#>>'{backlog,scheduledPersonMinutes}')::numeric+
    (outcome_value.evidence#>>'{backlog,unscheduledPersonMinutes}')::numeric)/60,6)),
  'capacity.available_role_hours.v1',jsonb_build_object('forecast',origin_value.private_results->'capacity.available_role_hours.v1',
   'actual',round((outcome_value.evidence#>>'{capacity,availablePersonMinutes}')::numeric/60,6)));
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('kind','evaluation','originId',origin_id_value));
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:workload-capacity-key:'||org||':'||actor||':'||key_hash,0));
 SELECT * INTO old FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF old.request_digest<>request_hash THEN RAISE EXCEPTION 'Workload key conflict' USING ERRCODE='23505';END IF;
  IF NOT public.canonical_forecast_workload_capacity_v1_evaluation_current(org,old) THEN
   RAISE EXCEPTION 'Saved workload evaluation stale' USING ERRCODE='40001';END IF;
  authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
  RETURN public.canonical_forecast_workload_capacity_v1_evaluation_projection(old,'workload_capacity_evaluation_saved',TRUE);
 END IF;
 SELECT * INTO current_value FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND origin_id=origin_id_value ORDER BY revision DESC LIMIT 1;
 digest_value:=public.canonical_completion_digest(jsonb_build_object('originId',origin_id_value,
  'revision',COALESCE(current_value.revision,0)+1,'outcomeDigest',rtrim(outcome_value.digest),
  'metricsDigest',public.canonical_completion_digest(metrics_value)));
 INSERT INTO public.canonical_forecast_workload_capacity_evaluations_v1(
  organization_id,origin_id,capacity_role,revision,previous_id,outcome_window_id,private_metrics,outcome_digest,
  actor_user_id,auth_session_id,request_key_hash,request_digest,evaluated_at,digest)
 VALUES(org,origin_id_value,origin_value.capacity_role,COALESCE(current_value.revision,0)+1,current_value.id,outcome_value.id,
  metrics_value,rtrim(outcome_value.digest),actor,session_value,key_hash,request_hash,now_value,digest_value)
 RETURNING * INTO inserted;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,csrf,TRUE);
 RETURN public.canonical_forecast_workload_capacity_v1_evaluation_projection(inserted,'workload_capacity_evaluation_saved',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_evaluation_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,origin_id_value UUID,id_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_workload_capacity_evaluations_v1%ROWTYPE;current_value BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_workload_capacity_evaluations_v1
  WHERE organization_id=org AND origin_id=origin_id_value AND id=id_value;
 IF NOT FOUND THEN RETURN NULL;END IF;
 current_value:=public.canonical_forecast_workload_capacity_v1_evaluation_current(org,value);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_forecast_workload_capacity_v1_evaluation_projection(value,
  CASE WHEN current_value THEN 'workload_capacity_evaluation_current' ELSE 'workload_capacity_evaluation_stale' END,FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_prerequisites(
 org UUID,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;epoch_value public.canonical_forecast_workload_capacity_epochs_v1%ROWTYPE;
 methods_value JSONB;remaining_count BIGINT;role_count BIGINT;availability_count BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Read committed required' USING ERRCODE='25001';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO epoch_value FROM public.canonical_forecast_workload_capacity_epochs_v1
  WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 SELECT jsonb_agg(jsonb_build_object('target',method_value.target_key,
   'expectedRevision',COALESCE(review_value.revision,0),'expectedDigest',COALESCE(rtrim(review_value.digest),'none'),
   'approved',COALESCE(review_value.action='approve',FALSE)) ORDER BY
   CASE method_value.target_key WHEN 'workload.accepted_person_hours.v1' THEN 1
    WHEN 'workload.end_backlog_hours.v1' THEN 2 ELSE 3 END)
 INTO methods_value FROM public.canonical_forecast_workload_capacity_methods_v1 method_value
 LEFT JOIN LATERAL (SELECT value.* FROM public.canonical_forecast_workload_capacity_reviews_v1 value
  WHERE value.organization_id=org AND value.review_kind='method' AND value.target_key=method_value.target_key
  ORDER BY value.revision DESC LIMIT 1) review_value ON TRUE;
 SELECT count(*) FILTER(WHERE review_kind='remaining_work' AND action='approve'),
  count(*) FILTER(WHERE review_kind='role_qualification' AND action='approve'),
  count(*) FILTER(WHERE review_kind='availability_basis' AND action='approve')
 INTO remaining_count,role_count,availability_count
 FROM (SELECT DISTINCT ON (review_kind,target_key,subject_id,operational_role) *
  FROM public.canonical_forecast_workload_capacity_reviews_v1 WHERE organization_id=org
  ORDER BY review_kind,target_key,subject_id,operational_role,revision DESC) current_reviews;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','workload_capacity_prerequisites_current','epoch',
  CASE WHEN epoch_value.id IS NULL THEN jsonb_build_object('state','missing','id',NULL,'revision',NULL,'digest',NULL,'installedAt',NULL)
   ELSE jsonb_build_object('state','current','id',epoch_value.id,'revision',epoch_value.revision,
    'digest',rtrim(epoch_value.digest),'installedAt',public.canonical_forecast_utc_instant(epoch_value.installed_at)) END,
  'methods',methods_value,'reviewCounts',jsonb_build_object('remainingWork',remaining_count,
   'roleQualification',role_count,'availabilityBasis',availability_count),
  'researchOnly',TRUE,'forecastIssued',FALSE,'paidNumericServing',FALSE,
  'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_workload_capacity_v1_review_current(
 org UUID,actor UUID,role_value TEXT,session_value UUID,kind_value TEXT,target_value TEXT,
 subject_value UUID,role_name TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;value public.canonical_forecast_workload_capacity_reviews_v1%ROWTYPE;
 source_value JSONB;source_current BOOLEAN:=FALSE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'
  OR kind_value NOT IN('method','remaining_work','role_qualification','availability_basis','capacity_role_scope')
  OR target_value NOT IN('workload.accepted_person_hours.v1','workload.end_backlog_hours.v1','capacity.available_role_hours.v1')
  OR (kind_value='method' AND (subject_value IS NOT NULL OR role_name IS NOT NULL))
  OR (kind_value='remaining_work' AND (target_value<>'workload.end_backlog_hours.v1' OR subject_value IS NULL OR role_name IS NOT NULL))
  OR (kind_value='role_qualification' AND (target_value<>'capacity.available_role_hours.v1' OR subject_value IS NULL OR role_name IS NULL))
  OR (kind_value='availability_basis' AND (target_value<>'capacity.available_role_hours.v1' OR subject_value IS NULL OR role_name IS NOT NULL))
  OR (kind_value='capacity_role_scope' AND (target_value<>'capacity.available_role_hours.v1' OR subject_value IS NOT NULL OR role_name IS NOT NULL)) THEN
  RAISE EXCEPTION 'Invalid workload review lookup' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access(org,actor,role_value,session_value,NULL,FALSE);
 PERFORM public.canonical_forecast_workload_capacity_v1_lock_sources(org);
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO value FROM public.canonical_forecast_workload_capacity_reviews_v1 item
 WHERE item.organization_id=org AND item.review_kind=kind_value AND item.target_key=target_value
  AND item.subject_id IS NOT DISTINCT FROM subject_value
  AND item.operational_role IS NOT DISTINCT FROM role_name
 ORDER BY item.revision DESC LIMIT 1;
 IF kind_value='capacity_role_scope' THEN
  SELECT * INTO value FROM public.canonical_forecast_workload_capacity_reviews_v1 item
   WHERE item.organization_id=org AND item.review_kind=kind_value AND item.target_key=target_value
   ORDER BY item.revision DESC LIMIT 1;
 END IF;
 IF FOUND THEN
  BEGIN
   source_value:=public.canonical_forecast_workload_capacity_v1_review_source(
    org,kind_value,target_value,subject_value,
    CASE WHEN kind_value='capacity_role_scope' THEN value.operational_role ELSE role_name END);
   source_current:=value.source_digest=public.canonical_completion_digest(source_value);
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '54000' THEN source_current:=FALSE;END;
 END IF;
 authority:=public.canonical_forecast_workload_capacity_v1_access_recheck(org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state','workload_capacity_review_current','kind',kind_value,
  'target',target_value,'subjectId',subject_value,'role',
   CASE WHEN kind_value='capacity_role_scope' THEN value.operational_role ELSE role_name END,
  'reviewId',CASE WHEN value.id IS NULL THEN NULL ELSE value.id END,
  'action',CASE WHEN value.id IS NULL THEN NULL ELSE value.action END,
  'expectedRevision',COALESCE(value.revision,0),'expectedDigest',COALESCE(rtrim(value.digest),'none'),
  'sourceCurrent',source_current,'researchOnly',TRUE,'forecastIssued',FALSE,
  'paidNumericServing',FALSE,'forecastServingEnabled',FALSE,'automaticActionTaken',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_workload_capacity_test_clock_v1,
 public.canonical_forecast_workload_capacity_crew_events_v1,
 public.canonical_forecast_workload_capacity_availability_events_v1,
 public.canonical_forecast_workload_capacity_profile_events_v1,
 public.canonical_forecast_workload_capacity_role_generations_v1,
 public.canonical_forecast_workload_capacity_methods_v1,
 public.canonical_forecast_workload_capacity_epochs_v1,
 public.canonical_forecast_workload_capacity_reviews_v1,
 public.canonical_forecast_workload_capacity_windows_v1,
 public.canonical_forecast_workload_capacity_origins_v1,
 public.canonical_forecast_workload_capacity_evaluations_v1 FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.canonical_forecast_workload_capacity_source_order_v1 FROM PUBLIC;

REVOKE ALL ON FUNCTION public.canonical_forecast_workload_capacity_v1_clock(),
 public.canonical_forecast_workload_capacity_v1_test_clock_set(timestamptz),
 public.canonical_forecast_workload_capacity_v1_completion_clock(),
 public.canonical_forecast_workload_capacity_v1_schedule_clock(),
 public.canonical_forecast_workload_capacity_v1_schedule_revision_clock(),
 public.canonical_forecast_workload_capacity_v1_person_plan_clock(),
 public.canonical_forecast_workload_capacity_v1_source_fence(),
 public.canonical_forecast_workload_capacity_v1_lock_sources(uuid),
 public.canonical_forecast_workload_capacity_v1_access(uuid,uuid,text,uuid,text,boolean),
 public.canonical_forecast_workload_capacity_v1_access_recheck(uuid,uuid,text,uuid,text,boolean),
 public.canonical_forecast_workload_capacity_v1_immutable(),
 public.canonical_forecast_workload_capacity_v1_labor_evidence(uuid,timestamptz,timestamptz),
 public.canonical_forecast_workload_capacity_v1_backlog_evidence(uuid,timestamptz),
 public.canonical_forecast_workload_capacity_v1_capacity_calculation(uuid,timestamptz,timestamptz,timestamptz,text),
 public.canonical_forecast_workload_capacity_v1_capacity_evidence(uuid,timestamptz,timestamptz,timestamptz),
 public.canonical_forecast_workload_capacity_v1_capacity_evidence(uuid,timestamptz,timestamptz),
 public.canonical_forecast_workload_capacity_v1_window_evidence(uuid,timestamptz,timestamptz),
 public.canonical_forecast_workload_capacity_v1_source_counts(uuid),
 public.canonical_forecast_workload_capacity_v1_review_source(uuid,text,text,uuid,text),
 public.canonical_forecast_workload_capacity_v1_window_current(uuid,public.canonical_forecast_workload_capacity_windows_v1),
 public.canonical_forecast_workload_capacity_v1_origin_input(uuid,timestamptz,timestamptz),
 public.canonical_forecast_workload_capacity_v1_origin_current(uuid,public.canonical_forecast_workload_capacity_origins_v1),
 public.canonical_forecast_workload_capacity_v1_origin_projection(public.canonical_forecast_workload_capacity_origins_v1,text,boolean),
 public.canonical_forecast_workload_capacity_v1_evaluation_projection(public.canonical_forecast_workload_capacity_evaluations_v1,text,boolean),
 public.canonical_forecast_workload_capacity_v1_evaluation_current(uuid,public.canonical_forecast_workload_capacity_evaluations_v1)
 FROM PUBLIC;

REVOKE ALL ON FUNCTION public.canonical_forecast_workload_capacity_v1_prerequisites(uuid,uuid,text,uuid),
 public.canonical_forecast_workload_capacity_v1_review_current(uuid,uuid,text,uuid,text,text,uuid,text),
 public.canonical_forecast_workload_capacity_v1_backlog_unschedule(uuid,uuid,text,uuid,text,text,uuid,bigint,text,text,text),
 public.canonical_forecast_workload_capacity_v1_epoch_capture(uuid,uuid,text,uuid,text,text,text,text),
 public.canonical_forecast_workload_capacity_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,uuid,text,text,integer,text,bigint,text,text),
 public.canonical_forecast_workload_capacity_v1_window_finalize(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz,text),
 public.canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text),
 public.canonical_forecast_workload_capacity_v1_origin_read(uuid,uuid,text,uuid,uuid),
 public.canonical_forecast_workload_capacity_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid),
 public.canonical_forecast_workload_capacity_v1_evaluation_read(uuid,uuid,text,uuid,uuid,uuid)
 FROM PUBLIC;

DO $$DECLARE runtime_role TEXT:=NULLIF(current_setting('northstar.runtime_role',TRUE),'');BEGIN
 IF runtime_role IS NOT NULL AND runtime_role<>'' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_workload_capacity_test_clock_v1,public.canonical_forecast_workload_capacity_crew_events_v1,public.canonical_forecast_workload_capacity_availability_events_v1,public.canonical_forecast_workload_capacity_profile_events_v1,public.canonical_forecast_workload_capacity_role_generations_v1,public.canonical_forecast_workload_capacity_methods_v1,public.canonical_forecast_workload_capacity_epochs_v1,public.canonical_forecast_workload_capacity_reviews_v1,public.canonical_forecast_workload_capacity_windows_v1,public.canonical_forecast_workload_capacity_origins_v1,public.canonical_forecast_workload_capacity_evaluations_v1 FROM %I',runtime_role);
  EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.canonical_forecast_workload_capacity_source_order_v1 FROM %I',runtime_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.canonical_forecast_workload_capacity_v1_clock(),public.canonical_forecast_workload_capacity_v1_test_clock_set(timestamptz),public.canonical_forecast_workload_capacity_v1_completion_clock(),public.canonical_forecast_workload_capacity_v1_schedule_clock(),public.canonical_forecast_workload_capacity_v1_schedule_revision_clock(),public.canonical_forecast_workload_capacity_v1_person_plan_clock(),public.canonical_forecast_workload_capacity_v1_source_fence(),public.canonical_forecast_workload_capacity_v1_lock_sources(uuid),public.canonical_forecast_workload_capacity_v1_access(uuid,uuid,text,uuid,text,boolean),public.canonical_forecast_workload_capacity_v1_access_recheck(uuid,uuid,text,uuid,text,boolean),public.canonical_forecast_workload_capacity_v1_immutable(),public.canonical_forecast_workload_capacity_v1_labor_evidence(uuid,timestamptz,timestamptz),public.canonical_forecast_workload_capacity_v1_backlog_evidence(uuid,timestamptz),public.canonical_forecast_workload_capacity_v1_capacity_calculation(uuid,timestamptz,timestamptz,timestamptz,text),public.canonical_forecast_workload_capacity_v1_capacity_evidence(uuid,timestamptz,timestamptz,timestamptz),public.canonical_forecast_workload_capacity_v1_capacity_evidence(uuid,timestamptz,timestamptz),public.canonical_forecast_workload_capacity_v1_window_evidence(uuid,timestamptz,timestamptz),public.canonical_forecast_workload_capacity_v1_source_counts(uuid),public.canonical_forecast_workload_capacity_v1_review_source(uuid,text,text,uuid,text),public.canonical_forecast_workload_capacity_v1_window_current(uuid,public.canonical_forecast_workload_capacity_windows_v1),public.canonical_forecast_workload_capacity_v1_origin_input(uuid,timestamptz,timestamptz),public.canonical_forecast_workload_capacity_v1_origin_current(uuid,public.canonical_forecast_workload_capacity_origins_v1),public.canonical_forecast_workload_capacity_v1_origin_projection(public.canonical_forecast_workload_capacity_origins_v1,text,boolean),public.canonical_forecast_workload_capacity_v1_evaluation_projection(public.canonical_forecast_workload_capacity_evaluations_v1,text,boolean),public.canonical_forecast_workload_capacity_v1_evaluation_current(uuid,public.canonical_forecast_workload_capacity_evaluations_v1) FROM %I',runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_workload_capacity_v1_prerequisites(uuid,uuid,text,uuid),public.canonical_forecast_workload_capacity_v1_review_current(uuid,uuid,text,uuid,text,text,uuid,text),public.canonical_forecast_workload_capacity_v1_backlog_unschedule(uuid,uuid,text,uuid,text,text,uuid,bigint,text,text,text),public.canonical_forecast_workload_capacity_v1_epoch_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_workload_capacity_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,text,uuid,text,text,integer,text,bigint,text,text),public.canonical_forecast_workload_capacity_v1_window_finalize(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz,text),public.canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text),public.canonical_forecast_workload_capacity_v1_origin_read(uuid,uuid,text,uuid,uuid),public.canonical_forecast_workload_capacity_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid),public.canonical_forecast_workload_capacity_v1_evaluation_read(uuid,uuid,text,uuid,uuid,uuid) TO %I',runtime_role);
 END IF;
END $$;
