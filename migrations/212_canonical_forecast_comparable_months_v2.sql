-- Mission 26 Part 2B: target-complete, purpose-fixed comparable local-month
-- evidence for the scoped NorthStar M24 approved-estimate decision source.
-- It reuses migration 211's exact post-installation coverage epoch, the
-- prospective Business Profile authority, and migration 173's post-commit
-- witness. It never claims provider, off-platform, whole-business, or
-- geographic observation coverage.

-- The capture reads only two indexed month ranges and stops after the first
-- 1,001 candidate rows. The INCLUDE columns keep source identity available
-- without an unbounded tenant-history sort.
CREATE INDEX canonical_forecast_price_decision_orders_tenant_time_idx
 ON public.canonical_forecast_price_decision_orders(
  organization_id,ordered_at,source_order)
 INCLUDE(estimate_id,decision_id);

CREATE TABLE public.canonical_forecast_comparable_month_v2_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 profile_anchor_id UUID NOT NULL,
 time_zone TEXT NOT NULL CHECK(length(time_zone) BETWEEN 1 AND 255),
 first_local_start_date DATE NOT NULL,
 first_local_end_date DATE NOT NULL,
 first_starts_at TIMESTAMPTZ NOT NULL,
 first_ends_at TIMESTAMPTZ NOT NULL,
 first_elapsed_minutes INTEGER NOT NULL CHECK(first_elapsed_minutes>0),
 first_open_minutes INTEGER NOT NULL CHECK(first_open_minutes>=0),
 second_local_start_date DATE NOT NULL,
 second_local_end_date DATE NOT NULL,
 second_starts_at TIMESTAMPTZ NOT NULL,
 second_ends_at TIMESTAMPTZ NOT NULL,
 second_elapsed_minutes INTEGER NOT NULL CHECK(second_elapsed_minutes>0),
 second_open_minutes INTEGER NOT NULL CHECK(second_open_minutes>=0),
 calendar_digest CHAR(64) NOT NULL CHECK(calendar_digest~'^[0-9a-f]{64}$'),
 windows_digest CHAR(64) NOT NULL CHECK(windows_digest~'^[0-9a-f]{64}$'),
 coverage_starts_at TIMESTAMPTZ NOT NULL,
 coverage_start_order BIGINT NOT NULL CHECK(coverage_start_order>=0),
 high_water_order BIGINT NOT NULL CHECK(high_water_order>=coverage_start_order),
 profile_source_order BIGINT NOT NULL CHECK(profile_source_order>=0),
 source_manifest JSONB NOT NULL CHECK(jsonb_typeof(source_manifest)='array' AND
   jsonb_array_length(source_manifest)<=1000 AND octet_length(source_manifest::text)<=262144),
 first_event_count INTEGER NOT NULL CHECK(first_event_count BETWEEN 0 AND 1000),
 second_event_count INTEGER NOT NULL CHECK(second_event_count BETWEEN 0 AND 1000),
 digest_nonce UUID NOT NULL,
 receipt_digest CHAR(64) NOT NULL CHECK(receipt_digest~'^[0-9a-f]{64}$'),
 actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL,
 request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest CHAR(64) NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL,
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,actor_user_id,request_key_hash),
 FOREIGN KEY(organization_id,profile_anchor_id)
  REFERENCES public.canonical_forecast_profile_effective_anchors(organization_id,id)
  ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id)
  REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id)
  REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK(first_local_start_date<first_local_end_date AND
   first_local_end_date<=second_local_start_date AND
   second_local_start_date<second_local_end_date),
 CHECK(first_starts_at<first_ends_at AND first_ends_at<=second_starts_at AND
   second_starts_at<second_ends_at),
 CHECK(first_event_count+second_event_count=jsonb_array_length(source_manifest)),
 CHECK(rtrim(receipt_digest)=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-comparable-approved-estimate-months-v2',
  'organizationId',organization_id,'profileAnchorId',profile_anchor_id,
  'timeZone',time_zone,
  'firstLocalStartDate',first_local_start_date::text,
  'firstLocalEndDate',first_local_end_date::text,
  'firstStartsAt',public.canonical_forecast_utc_instant(first_starts_at),
  'firstEndsAt',public.canonical_forecast_utc_instant(first_ends_at),
  'firstElapsedMinutes',first_elapsed_minutes,'firstOpenMinutes',first_open_minutes,
  'secondLocalStartDate',second_local_start_date::text,
  'secondLocalEndDate',second_local_end_date::text,
  'secondStartsAt',public.canonical_forecast_utc_instant(second_starts_at),
  'secondEndsAt',public.canonical_forecast_utc_instant(second_ends_at),
  'secondElapsedMinutes',second_elapsed_minutes,'secondOpenMinutes',second_open_minutes,
  'calendarDigest',rtrim(calendar_digest),'windowsDigest',rtrim(windows_digest),
  'coverageStartsAt',public.canonical_forecast_utc_instant(coverage_starts_at),
  'coverageStartOrder',coverage_start_order,'highWaterOrder',high_water_order,
  'profileSourceOrder',profile_source_order,'digestNonce',digest_nonce,
  'sourceManifest',source_manifest,'firstEventCount',first_event_count,
  'secondEventCount',second_event_count,
  'capturedAt',public.canonical_forecast_utc_instant(captured_at))))
);
CREATE INDEX canonical_forecast_comparable_month_v2_recent_idx
 ON public.canonical_forecast_comparable_month_v2_receipts(
  organization_id,captured_at DESC,id);

-- PostgreSQL's direct AT TIME ZONE conversion chooses one instant for a
-- repeated wall clock. Enumerate the offsets surrounding the requested wall
-- clock and return an instant only when exactly one candidate round-trips.
-- This matches scheduling-time-contract.resolveWallTime's unique-only rule.
CREATE FUNCTION public.canonical_forecast_comparable_month_v2_unique_instant(
 tz TEXT,wall_value TIMESTAMP WITHOUT TIME ZONE)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 WITH observed_offsets AS (
  SELECT DISTINCT
   (probe AT TIME ZONE tz)-(probe AT TIME ZONE 'UTC') utc_offset
  FROM generate_series(
   (wall_value AT TIME ZONE 'UTC')-INTERVAL '48 hours',
   (wall_value AT TIME ZONE 'UTC')+INTERVAL '48 hours',
   INTERVAL '3 hours') probe
 ), candidates AS (
  SELECT DISTINCT (wall_value-utc_offset) AT TIME ZONE 'UTC' instant
  FROM observed_offsets
  WHERE ((wall_value-utc_offset) AT TIME ZONE 'UTC') AT TIME ZONE tz=wall_value
 ), resolved AS (
  SELECT count(*) candidate_count,min(instant) instant FROM candidates
 )
 SELECT CASE WHEN candidate_count=1 THEN instant ELSE NULL END FROM resolved
$$;

-- Derive one exact local calendar month from the pinned Business Profile.
-- Open minutes use the same opening-local-date rule as the application.
CREATE FUNCTION public.canonical_forecast_comparable_month_v2_window(
 org UUID,anchor_value UUID,local_start DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 profile_row public.canonical_business_profiles%ROWTYPE;
 tz TEXT;hours JSONB;local_end DATE;starts_at TIMESTAMPTZ;ends_at TIMESTAMPTZ;
 day_value JSONB;holiday_values JSONB;holiday_count INTEGER;day_name TEXT;
 open_value TEXT;close_value TEXT;lunch_value TEXT;lunch_match TEXT[];
 open_time TIME;close_time TIME;lunch_start TIME;lunch_end TIME;
 open_at TIMESTAMPTZ;close_at TIMESTAMPTZ;lunch_starts_at TIMESTAMPTZ;
 lunch_ends_at TIMESTAMPTZ;close_date DATE;total_minutes BIGINT:=0;day_date DATE;
 elapsed BIGINT;
BEGIN
 IF local_start IS NULL OR extract(day FROM local_start)<>1 OR
   extract(year FROM local_start) NOT BETWEEN 2000 AND 2100 THEN
  RAISE EXCEPTION 'Comparable-month local start is invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 IF anchor_row.id IS NULL THEN RETURN jsonb_build_object('state','unavailable');END IF;
 SELECT * INTO profile_row FROM public.canonical_business_profiles
  WHERE organization_id=org AND id=anchor_row.business_profile_id;
 IF profile_row.id IS NULL OR
   profile_row.version_number<>anchor_row.business_profile_version OR
   profile_row.normalized_profile_hash<>anchor_row.business_profile_hash OR
   public.canonical_completion_digest(profile_row.raw_profile)<>anchor_row.raw_profile_digest OR
   profile_row.calendar_authority IS DISTINCT FROM jsonb_build_object(
    'hours',profile_row.raw_profile->'hours',
    'timeZone',profile_row.raw_profile->'company'->'timeZone') THEN
  RETURN jsonb_build_object('state','unavailable');
 END IF;
 tz:=profile_row.calendar_authority->>'timeZone';
 hours:=profile_row.calendar_authority->'hours';
 IF tz IS NULL OR hours IS NULL OR jsonb_typeof(hours)<>'object' OR
   NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN
  RETURN jsonb_build_object('state','unavailable');
 END IF;
 local_end:=(local_start+INTERVAL '1 month')::date;
 starts_at:=public.canonical_forecast_comparable_month_v2_unique_instant(
  tz,local_start::timestamp);
 ends_at:=public.canonical_forecast_comparable_month_v2_unique_instant(
  tz,local_end::timestamp);
 IF starts_at IS NULL OR ends_at IS NULL OR ends_at<=starts_at THEN
  RETURN jsonb_build_object('state','unavailable');
 END IF;
 FOR day_date IN SELECT value::date FROM generate_series(
   local_start::timestamp,(local_end-1)::timestamp,INTERVAL '1 day') value LOOP
  SELECT count(*)::integer,COALESCE(jsonb_agg(item),'[]'::jsonb)
   INTO holiday_count,holiday_values
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(hours->'holidays')='array'
    THEN hours->'holidays' ELSE '[]'::jsonb END) item
   WHERE item->>'date'=day_date::text;
  IF holiday_count>1 THEN RETURN jsonb_build_object('state','unavailable');END IF;
  IF holiday_count=1 THEN day_value:=holiday_values->0;
  ELSE
   day_name:=(ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
    [extract(dow FROM day_date)::integer+1];
   day_value:=hours->day_name;
  END IF;
  IF day_value IS NULL OR jsonb_typeof(day_value)<>'object' THEN
   RETURN jsonb_build_object('state','unavailable');
  END IF;
  IF holiday_count=1 AND day_value->'closed'='true'::jsonb THEN CONTINUE;END IF;
  open_value:=day_value->>'open';close_value:=day_value->>'close';
  IF COALESCE(open_value,'')='' AND COALESCE(close_value,'')='' THEN CONTINUE;END IF;
  IF open_value IS NULL OR close_value IS NULL OR
   open_value!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR
   close_value!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN
   RETURN jsonb_build_object('state','unavailable');
  END IF;
  open_time:=open_value::time;close_time:=close_value::time;
  close_date:=CASE WHEN close_time<=open_time THEN day_date+1 ELSE day_date END;
   open_at:=public.canonical_forecast_comparable_month_v2_unique_instant(
    tz,day_date+open_time);
   close_at:=public.canonical_forecast_comparable_month_v2_unique_instant(
    tz,close_date+close_time);
   IF open_at IS NULL OR close_at IS NULL OR close_at<=open_at THEN
   RETURN jsonb_build_object('state','unavailable');
  END IF;
  total_minutes:=total_minutes+extract(epoch FROM close_at-open_at)::bigint/60;
  lunch_value:=day_value->>'lunch';
  IF COALESCE(lunch_value,'')<>'' THEN
   lunch_match:=regexp_match(lunch_value,
    '^((?:[01][0-9]|2[0-3]):[0-5][0-9])-((?:[01][0-9]|2[0-3]):[0-5][0-9])$');
   IF lunch_match IS NULL THEN RETURN jsonb_build_object('state','unavailable');END IF;
   lunch_start:=lunch_match[1]::time;lunch_end:=lunch_match[2]::time;
    lunch_starts_at:=public.canonical_forecast_comparable_month_v2_unique_instant(
     tz,day_date+lunch_start);
    lunch_ends_at:=public.canonical_forecast_comparable_month_v2_unique_instant(
     tz,(CASE WHEN lunch_end<=lunch_start THEN day_date+1 ELSE day_date END)+lunch_end);
    IF lunch_starts_at IS NULL OR lunch_ends_at IS NULL OR
      lunch_starts_at<open_at OR lunch_ends_at>close_at OR
     lunch_ends_at<=lunch_starts_at THEN
    RETURN jsonb_build_object('state','unavailable');
   END IF;
   total_minutes:=total_minutes-extract(epoch FROM lunch_ends_at-lunch_starts_at)::bigint/60;
  END IF;
 END LOOP;
 elapsed:=extract(epoch FROM ends_at-starts_at)::bigint/60;
 IF elapsed<=0 OR total_minutes<0 OR total_minutes>2147483647 THEN
  RETURN jsonb_build_object('state','unavailable');END IF;
 RETURN jsonb_build_object('state','complete','timeZone',tz,
  'localStartDate',local_start::text,'localEndDate',local_end::text,
  'startsAt',public.canonical_forecast_utc_instant(starts_at),
  'endsAt',public.canonical_forecast_utc_instant(ends_at),
  'elapsedMinutes',elapsed,'openMinutes',total_minutes,
  'calendarDigest',public.canonical_completion_digest(hours));
END $$;

CREATE FUNCTION public.canonical_forecast_comparable_month_v2_windows_digest(
 org UUID,anchor_value UUID,first_window JSONB,second_window JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT encode(sha256(convert_to(concat_ws('|',
  'm26-comparable-month-windows-v2',org::text,anchor_value::text,
  first_window->>'timeZone',first_window->>'localStartDate',
  (extract(epoch FROM (first_window->>'startsAt')::timestamptz)*1000)::bigint::text,
  (extract(epoch FROM (first_window->>'endsAt')::timestamptz)*1000)::bigint::text,
  first_window->>'elapsedMinutes',first_window->>'openMinutes',
  second_window->>'localStartDate',
  (extract(epoch FROM (second_window->>'startsAt')::timestamptz)*1000)::bigint::text,
  (extract(epoch FROM (second_window->>'endsAt')::timestamptz)*1000)::bigint::text,
  second_window->>'elapsedMinutes',second_window->>'openMinutes'),'UTF8')),'hex')
$$;

-- Return bounded events only when every source row has an observation that
-- proves the writer committed no later than that row's month cutoff.
CREATE FUNCTION public.canonical_forecast_comparable_month_v2_events(
 org UUID,first_start TIMESTAMPTZ,first_end TIMESTAMPTZ,
 second_start TIMESTAMPTZ,second_end TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 WITH candidate AS (
  (SELECT source.estimate_id,source.decision_id,source.source_order,source.ordered_at,
    'first'::text period_key,first_end period_end
   FROM public.canonical_forecast_price_decision_orders source
   WHERE source.organization_id=org AND source.ordered_at>=first_start
    AND source.ordered_at<first_end
   ORDER BY source.ordered_at,source.source_order LIMIT 1001)
  UNION ALL
  (SELECT source.estimate_id,source.decision_id,source.source_order,source.ordered_at,
    'second'::text period_key,second_end period_end
   FROM public.canonical_forecast_price_decision_orders source
   WHERE source.organization_id=org AND source.ordered_at>=second_start
    AND source.ordered_at<second_end
   ORDER BY source.ordered_at,source.source_order LIMIT 1001)
 ), bounded AS (
  SELECT * FROM candidate ORDER BY source_order LIMIT 1001
 ), resolved AS (
  SELECT bounded.*,decision.revision,decision.action,decision.digest,
   observation.observed_at commit_observed_at
  FROM bounded
  JOIN public.canonical_estimate_decisions decision
   ON decision.organization_id=org AND decision.estimate_id=bounded.estimate_id
    AND decision.id=bounded.decision_id
  LEFT JOIN public.canonical_forecast_price_decision_commit_observations observation
   ON observation.organization_id=org AND observation.decision_id=bounded.decision_id
 ), summary AS (
  SELECT count(*)::integer candidate_count,
   count(*) FILTER(WHERE commit_observed_at IS NULL OR commit_observed_at>=period_end)::integer
    uncertain_count,
   COALESCE(jsonb_agg(jsonb_build_object(
    'estimateId',estimate_id,'decisionId',decision_id,'revision',revision,
    'action',action,'digest',rtrim(digest),'sourceOrder',source_order,
    'sourceObservedAt',public.canonical_forecast_utc_instant(ordered_at),
    'commitObservedAt',public.canonical_forecast_utc_instant(commit_observed_at),
    'period',period_key) ORDER BY source_order)
    FILTER(WHERE commit_observed_at IS NOT NULL AND commit_observed_at<period_end),'[]'::jsonb)
    events
  FROM resolved
 )
 SELECT jsonb_build_object('state',CASE
   WHEN candidate_count>1000 THEN 'too_large'
   WHEN uncertain_count>0 THEN 'commit_cutoff_unavailable'
   ELSE 'complete' END,'events',CASE WHEN candidate_count<=1000 AND uncertain_count=0
    THEN events ELSE '[]'::jsonb END)
 FROM summary
$$;

CREATE FUNCTION public.canonical_forecast_comparable_month_v2_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Comparable-month receipts are immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER canonical_forecast_comparable_month_v2_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON public.canonical_forecast_comparable_month_v2_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_forecast_comparable_month_v2_immutable();

CREATE FUNCTION public.canonical_forecast_comparable_month_v2_projection(
 value public.canonical_forecast_comparable_month_v2_receipts)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object(
  'id',value.id,'version','m26-comparable-approved-estimate-months-v2',
  'organizationId',value.organization_id,'profileAnchorId',value.profile_anchor_id,
  'timeZone',value.time_zone,
  'firstLocalStartDate',value.first_local_start_date::text,
  'firstLocalEndDate',value.first_local_end_date::text,
  'firstStartsAt',public.canonical_forecast_utc_instant(value.first_starts_at),
  'firstEndsAt',public.canonical_forecast_utc_instant(value.first_ends_at),
  'firstElapsedMinutes',value.first_elapsed_minutes,
  'firstOpenMinutes',value.first_open_minutes,
  'secondLocalStartDate',value.second_local_start_date::text,
  'secondLocalEndDate',value.second_local_end_date::text,
  'secondStartsAt',public.canonical_forecast_utc_instant(value.second_starts_at),
  'secondEndsAt',public.canonical_forecast_utc_instant(value.second_ends_at),
  'secondElapsedMinutes',value.second_elapsed_minutes,
  'secondOpenMinutes',value.second_open_minutes,
  'openMinutesBasis','opening_local_date','windowsDigest',rtrim(value.windows_digest),
  'capturedAt',public.canonical_forecast_utc_instant(value.captured_at),
  'sourceScope','northstar_m24_approved_estimate_decisions',
  'targetKey','pipeline.approved_estimates','sourceEvents',value.source_manifest,
  'sourceEventCount',jsonb_array_length(value.source_manifest),
  'firstEventCount',value.first_event_count,'secondEventCount',value.second_event_count,
  'sourceSnapshotDigest',rtrim(value.receipt_digest),
  'coverage',jsonb_build_object('state','complete','scope','northstar_m24_decision_ledger',
   'startsAt',public.canonical_forecast_utc_instant(value.coverage_starts_at),
   'providerCoverageVerified',FALSE,'wholeBusinessCoverageVerified',FALSE,
   'areaObservationCoverageVerified',FALSE))
$$;

CREATE FUNCTION public.canonical_forecast_comparable_month_v2_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE epoch public.canonical_forecast_approved_estimate_v2_epochs%ROWTYPE;
 anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 activation public.canonical_forecast_profile_effective_activations%ROWTYPE;
 current_order BIGINT;current_profile_order BIGINT;event_result JSONB;
 actual_role TEXT;first_proof JSONB;second_proof JSONB;expected_request TEXT;
 first_window JSONB;second_window JSONB;expected_windows_digest TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   NEW.captured_at>clock_timestamp() OR NEW.second_ends_at>NEW.captured_at THEN
  RAISE EXCEPTION 'Comparable-month receipt cutoff changed' USING ERRCODE='23514';END IF;
 first_window:=public.canonical_forecast_comparable_month_v2_window(
  NEW.organization_id,NEW.profile_anchor_id,NEW.first_local_start_date);
 second_window:=public.canonical_forecast_comparable_month_v2_window(
  NEW.organization_id,NEW.profile_anchor_id,NEW.second_local_start_date);
 expected_windows_digest:=public.canonical_forecast_comparable_month_v2_windows_digest(
  NEW.organization_id,NEW.profile_anchor_id,first_window,second_window);
 IF first_window->>'state'<>'complete' OR second_window->>'state'<>'complete' OR
   first_window->>'timeZone'<>second_window->>'timeZone' OR
   NEW.time_zone<>first_window->>'timeZone' OR
   NEW.first_local_end_date<>(first_window->>'localEndDate')::date OR
   NEW.first_starts_at<>(first_window->>'startsAt')::timestamptz OR
   NEW.first_ends_at<>(first_window->>'endsAt')::timestamptz OR
   NEW.first_elapsed_minutes<>(first_window->>'elapsedMinutes')::integer OR
   NEW.first_open_minutes<>(first_window->>'openMinutes')::integer OR
   NEW.second_local_end_date<>(second_window->>'localEndDate')::date OR
   NEW.second_starts_at<>(second_window->>'startsAt')::timestamptz OR
   NEW.second_ends_at<>(second_window->>'endsAt')::timestamptz OR
   NEW.second_elapsed_minutes<>(second_window->>'elapsedMinutes')::integer OR
   NEW.second_open_minutes<>(second_window->>'openMinutes')::integer OR
   rtrim(NEW.calendar_digest)<>first_window->>'calendarDigest' OR
   first_window->>'calendarDigest'<>second_window->>'calendarDigest' OR
   rtrim(NEW.windows_digest)<>expected_windows_digest THEN
  RAISE EXCEPTION 'Comparable-month window authority changed' USING ERRCODE='23514';END IF;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=NEW.organization_id;
 SELECT high_water_order INTO current_order
  FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=NEW.organization_id AND ordering_complete;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=NEW.organization_id AND id=NEW.profile_anchor_id;
 SELECT * INTO activation FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=NEW.organization_id AND anchor_id=NEW.profile_anchor_id;
 SELECT COALESCE(MAX(source_order),0) INTO current_profile_order
  FROM public.canonical_forecast_profile_change_events
  WHERE organization_id=NEW.organization_id;
 event_result:=public.canonical_forecast_comparable_month_v2_events(
  NEW.organization_id,NEW.first_starts_at,NEW.first_ends_at,
  NEW.second_starts_at,NEW.second_ends_at);
 SELECT role INTO actual_role FROM public.organization_memberships
  WHERE organization_id=NEW.organization_id AND id=NEW.membership_id
   AND user_id=NEW.actor_user_id AND status='active';
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,NULL,FALSE);
 first_proof:=public.canonical_forecast_profile_effective_window(
  NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,
  NEW.profile_anchor_id,NEW.first_starts_at,NEW.first_ends_at);
 second_proof:=public.canonical_forecast_profile_effective_window(
  NEW.organization_id,NEW.actor_user_id,actual_role,NEW.auth_session_id,
  NEW.profile_anchor_id,NEW.second_starts_at,NEW.second_ends_at);
 IF epoch.coverage_state IS DISTINCT FROM 'complete' OR
   epoch.coverage_starts_at>=NEW.first_starts_at OR
   epoch.coverage_starts_at IS DISTINCT FROM NEW.coverage_starts_at OR
   epoch.coverage_start_order IS DISTINCT FROM NEW.coverage_start_order OR
   public.canonical_forecast_approved_estimate_v2_gap(
    NEW.organization_id,epoch.coverage_starts_at) OR
   current_order IS DISTINCT FROM NEW.high_water_order OR
   anchor_row.id IS NULL OR activation.anchor_id IS NULL OR
   activation.observed_at>=NEW.first_starts_at OR
   anchor_row.source_order IS DISTINCT FROM NEW.profile_source_order OR
   current_profile_order IS DISTINCT FROM NEW.profile_source_order OR
   first_proof->>'state'<>'profile_effective_window_verified' OR
   second_proof->>'state'<>'profile_effective_window_verified' OR
   event_result->>'state'<>'complete' OR
   event_result->'events' IS DISTINCT FROM NEW.source_manifest THEN
  RAISE EXCEPTION 'Comparable-month coverage is unavailable' USING ERRCODE='23514';END IF;
 expected_request:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-comparable-approved-estimate-months-request-v2',
  'organizationId',NEW.organization_id,'actorUserId',NEW.actor_user_id,
  'profileAnchorId',NEW.profile_anchor_id,
  'firstLocalStartDate',NEW.first_local_start_date::text,
  'secondLocalStartDate',NEW.second_local_start_date::text,
  'windowsDigest',rtrim(NEW.windows_digest),'areaScope','tenant_all'));
 IF rtrim(NEW.request_digest)<>expected_request THEN
  RAISE EXCEPTION 'Comparable-month request changed' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_forecast_comparable_month_v2_guard
 BEFORE INSERT ON public.canonical_forecast_comparable_month_v2_receipts
 FOR EACH ROW EXECUTE FUNCTION public.canonical_forecast_comparable_month_v2_guard();

CREATE FUNCTION public.canonical_forecast_comparable_month_v2_capture(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,
 anchor_value UUID,first_local_start DATE,second_local_start DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB;old public.canonical_forecast_comparable_month_v2_receipts%ROWTYPE;
 inserted public.canonical_forecast_comparable_month_v2_receipts%ROWTYPE;
 epoch public.canonical_forecast_approved_estimate_v2_epochs%ROWTYPE;
 anchor_row public.canonical_forecast_profile_effective_anchors%ROWTYPE;
 activation public.canonical_forecast_profile_effective_activations%ROWTYPE;
 key_hash TEXT;request_hash TEXT;event_result JSONB;events JSONB;last_order BIGINT;
 profile_order BIGINT;first_count INTEGER;second_count INTEGER;
 captured TIMESTAMPTZ;nonce UUID;digest_value TEXT;source_current BOOLEAN;
 first_proof JSONB;second_proof JSONB;first_window JSONB;second_window JSONB;
 windows_digest_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR
   first_local_start IS NULL OR second_local_start IS NULL OR
   extract(day FROM first_local_start)<>1 OR extract(day FROM second_local_start)<>1 OR
   first_local_start>=second_local_start THEN
  RAISE EXCEPTION 'Comparable-month request invalid' USING ERRCODE='22023';END IF;
 authority:=public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,csrf,TRUE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Comparable-month source is busy' USING ERRCODE='55P03';END IF;
 first_window:=public.canonical_forecast_comparable_month_v2_window(
  org,anchor_value,first_local_start);
 second_window:=public.canonical_forecast_comparable_month_v2_window(
  org,anchor_value,second_local_start);
 IF first_window->>'state'<>'complete' OR second_window->>'state'<>'complete' OR
   first_window->>'timeZone'<>second_window->>'timeZone' OR
   (first_window->>'endsAt')::timestamptz>(second_window->>'startsAt')::timestamptz OR
   (second_window->>'endsAt')::timestamptz>clock_timestamp() THEN
  RETURN jsonb_build_object('state','unavailable','reason','window_authority_unavailable',
   'receipt',NULL,'replayed',FALSE);END IF;
 windows_digest_value:=public.canonical_forecast_comparable_month_v2_windows_digest(
  org,anchor_value,first_window,second_window);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-comparable-approved-estimate-months-request-v2',
  'organizationId',org,'actorUserId',actor,'profileAnchorId',anchor_value,
  'firstLocalStartDate',first_local_start::text,
  'secondLocalStartDate',second_local_start::text,
  'windowsDigest',windows_digest_value,'areaScope','tenant_all'));
 SELECT * INTO old FROM public.canonical_forecast_comparable_month_v2_receipts
  WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF old.id IS NOT NULL THEN
  IF rtrim(old.request_digest)<>request_hash THEN
   RAISE EXCEPTION 'Comparable-month request key conflict' USING ERRCODE='23505';END IF;
  SELECT high_water_order INTO last_order
   FROM public.canonical_forecast_approved_estimate_v2_states
   WHERE organization_id=org AND ordering_complete;
  SELECT COALESCE(MAX(source_order),0) INTO profile_order
   FROM public.canonical_forecast_profile_change_events WHERE organization_id=org;
  source_current:=last_order=old.high_water_order AND profile_order=old.profile_source_order AND
   NOT public.canonical_forecast_approved_estimate_v2_gap(org,old.coverage_starts_at);
  PERFORM public.canonical_forecast_approved_estimate_v2_access(
   org,actor,role_value,session_value,csrf,TRUE);
  RETURN jsonb_build_object('state','complete','receipt',
   public.canonical_forecast_comparable_month_v2_projection(old),
   'replayed',TRUE,'sourceCurrent',source_current);
 END IF;
 SELECT * INTO epoch FROM public.canonical_forecast_approved_estimate_v2_epochs
  WHERE organization_id=org;
 IF epoch.organization_id IS NULL OR epoch.coverage_state<>'complete' OR
   epoch.coverage_starts_at>=(first_window->>'startsAt')::timestamptz THEN
  RETURN jsonb_build_object('state','unavailable','reason','coverage_epoch_ineligible',
   'receipt',NULL,'replayed',FALSE);END IF;
 IF public.canonical_forecast_approved_estimate_v2_gap(org,epoch.coverage_starts_at) THEN
  RETURN jsonb_build_object('state','unavailable','reason','source_order_gap',
   'receipt',NULL,'replayed',FALSE);END IF;
 SELECT high_water_order INTO last_order
  FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=org AND ordering_complete;
 IF last_order IS NULL OR last_order>9007199254740991 THEN
  RAISE EXCEPTION 'Comparable-month source order exceeds safe size' USING ERRCODE='54000';END IF;
 SELECT * INTO anchor_row FROM public.canonical_forecast_profile_effective_anchors
  WHERE organization_id=org AND id=anchor_value;
 SELECT * INTO activation FROM public.canonical_forecast_profile_effective_activations
  WHERE organization_id=org AND anchor_id=anchor_value;
 SELECT COALESCE(MAX(source_order),0) INTO profile_order
  FROM public.canonical_forecast_profile_change_events WHERE organization_id=org;
 IF anchor_row.id IS NULL OR activation.anchor_id IS NULL OR
   activation.observed_at>=(first_window->>'startsAt')::timestamptz OR
   anchor_row.source_order<>profile_order THEN
  RETURN jsonb_build_object('state','unavailable','reason','profile_epoch_ineligible',
   'receipt',NULL,'replayed',FALSE);END IF;
 first_proof:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,anchor_value,
  (first_window->>'startsAt')::timestamptz,(first_window->>'endsAt')::timestamptz);
 second_proof:=public.canonical_forecast_profile_effective_window(
  org,actor,role_value,session_value,anchor_value,
  (second_window->>'startsAt')::timestamptz,(second_window->>'endsAt')::timestamptz);
 IF first_proof->>'state'<>'profile_effective_window_verified' OR
   second_proof->>'state'<>'profile_effective_window_verified' THEN
  RETURN jsonb_build_object('state','unavailable','reason','profile_period_unverified',
   'receipt',NULL,'replayed',FALSE);END IF;
 event_result:=public.canonical_forecast_comparable_month_v2_events(org,
  (first_window->>'startsAt')::timestamptz,(first_window->>'endsAt')::timestamptz,
  (second_window->>'startsAt')::timestamptz,(second_window->>'endsAt')::timestamptz);
 IF event_result->>'state'='too_large' THEN
  RAISE EXCEPTION 'Comparable-month cohort exceeds bounded source size' USING ERRCODE='54000';
 ELSIF event_result->>'state'<>'complete' THEN
  RETURN jsonb_build_object('state','unavailable','reason','commit_cutoff_unavailable',
   'receipt',NULL,'replayed',FALSE);END IF;
 events:=event_result->'events';
 IF jsonb_array_length(events)>1000 OR octet_length(events::text)>262144 THEN
  RAISE EXCEPTION 'Comparable-month cohort exceeds bounded source size' USING ERRCODE='54000';END IF;
 SELECT count(*) FILTER(WHERE item->>'period'='first'),
  count(*) FILTER(WHERE item->>'period'='second')
 INTO first_count,second_count FROM jsonb_array_elements(events) item;
 captured:=clock_timestamp();nonce:=gen_random_uuid();
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','m26-comparable-approved-estimate-months-v2',
  'organizationId',org,'profileAnchorId',anchor_value,
  'timeZone',first_window->>'timeZone',
  'firstLocalStartDate',first_window->>'localStartDate',
  'firstLocalEndDate',first_window->>'localEndDate',
  'firstStartsAt',first_window->>'startsAt','firstEndsAt',first_window->>'endsAt',
  'firstElapsedMinutes',(first_window->>'elapsedMinutes')::integer,
  'firstOpenMinutes',(first_window->>'openMinutes')::integer,
  'secondLocalStartDate',second_window->>'localStartDate',
  'secondLocalEndDate',second_window->>'localEndDate',
  'secondStartsAt',second_window->>'startsAt','secondEndsAt',second_window->>'endsAt',
  'secondElapsedMinutes',(second_window->>'elapsedMinutes')::integer,
  'secondOpenMinutes',(second_window->>'openMinutes')::integer,
  'calendarDigest',first_window->>'calendarDigest','windowsDigest',windows_digest_value,
  'coverageStartsAt',public.canonical_forecast_utc_instant(epoch.coverage_starts_at),
  'coverageStartOrder',epoch.coverage_start_order,'highWaterOrder',last_order,
  'profileSourceOrder',profile_order,'digestNonce',nonce,'sourceManifest',events,
  'firstEventCount',first_count,'secondEventCount',second_count,
  'capturedAt',public.canonical_forecast_utc_instant(captured)));
 authority:=public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,csrf,TRUE);
 INSERT INTO public.canonical_forecast_comparable_month_v2_receipts(
  organization_id,profile_anchor_id,time_zone,
  first_local_start_date,first_local_end_date,first_starts_at,first_ends_at,
  first_elapsed_minutes,first_open_minutes,
  second_local_start_date,second_local_end_date,second_starts_at,second_ends_at,
  second_elapsed_minutes,second_open_minutes,calendar_digest,windows_digest,
  coverage_starts_at,coverage_start_order,high_water_order,profile_source_order,
  source_manifest,first_event_count,second_event_count,digest_nonce,receipt_digest,
  actor_user_id,membership_id,auth_session_id,request_key_hash,request_digest,captured_at)
 VALUES(org,anchor_value,first_window->>'timeZone',first_local_start,
  (first_window->>'localEndDate')::date,(first_window->>'startsAt')::timestamptz,
  (first_window->>'endsAt')::timestamptz,(first_window->>'elapsedMinutes')::integer,
  (first_window->>'openMinutes')::integer,second_local_start,
  (second_window->>'localEndDate')::date,(second_window->>'startsAt')::timestamptz,
  (second_window->>'endsAt')::timestamptz,(second_window->>'elapsedMinutes')::integer,
  (second_window->>'openMinutes')::integer,first_window->>'calendarDigest',
  windows_digest_value,epoch.coverage_starts_at,epoch.coverage_start_order,last_order,
  profile_order,events,first_count,second_count,nonce,digest_value,actor,
  (authority->>'membershipId')::uuid,session_value,key_hash,request_hash,captured)
 RETURNING * INTO inserted;
 RETURN jsonb_build_object('state','complete','receipt',
  public.canonical_forecast_comparable_month_v2_projection(inserted),
  'replayed',FALSE,'sourceCurrent',TRUE);
END $$;

CREATE FUNCTION public.canonical_forecast_comparable_month_v2_read(
 org UUID,actor UUID,role_value TEXT,session_value UUID,receipt_value UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.canonical_forecast_comparable_month_v2_receipts%ROWTYPE;
 last_order BIGINT;profile_order BIGINT;source_current BOOLEAN;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Comparable-month read requires READ COMMITTED' USING ERRCODE='25001';END IF;
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,NULL,FALSE);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:profile-effective-source:'||org::text,0)) OR
   NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:price-decision-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Comparable-month source is busy' USING ERRCODE='55P03';END IF;
 SELECT * INTO selected FROM public.canonical_forecast_comparable_month_v2_receipts
  WHERE organization_id=org AND id=receipt_value;
 IF selected.id IS NULL THEN RETURN NULL;END IF;
 SELECT high_water_order INTO last_order
  FROM public.canonical_forecast_approved_estimate_v2_states
  WHERE organization_id=org AND ordering_complete;
 SELECT COALESCE(MAX(source_order),0) INTO profile_order
  FROM public.canonical_forecast_profile_change_events WHERE organization_id=org;
 source_current:=last_order=selected.high_water_order AND
  profile_order=selected.profile_source_order AND
  NOT public.canonical_forecast_approved_estimate_v2_gap(org,selected.coverage_starts_at);
 PERFORM public.canonical_forecast_approved_estimate_v2_access(
  org,actor,role_value,session_value,NULL,FALSE);
 RETURN jsonb_build_object('state',CASE WHEN source_current THEN 'current' ELSE 'stale' END,
  'sourceCurrent',source_current,'receipt',
  public.canonical_forecast_comparable_month_v2_projection(selected),
  'eligibleForForecast',FALSE,'forecastIssued',FALSE);
END $$;

REVOKE ALL ON TABLE public.canonical_forecast_comparable_month_v2_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_unique_instant(
 TEXT,TIMESTAMP WITHOUT TIME ZONE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_window(
 UUID,UUID,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_windows_digest(
 UUID,UUID,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_events(
 UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_projection(
 public.canonical_forecast_comparable_month_v2_receipts) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_capture(
 UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,DATE,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_read(
 UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON TABLE public.canonical_forecast_comparable_month_v2_receipts
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_unique_instant(
  TEXT,TIMESTAMP WITHOUT TIME ZONE) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_window(
  UUID,UUID,DATE) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_windows_digest(
  UUID,UUID,JSONB,JSONB) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_events(
  UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_immutable()
  FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_projection(
  public.canonical_forecast_comparable_month_v2_receipts) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_forecast_comparable_month_v2_guard()
  FROM northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_comparable_month_v2_capture(
  UUID,UUID,TEXT,UUID,TEXT,TEXT,UUID,DATE,DATE) TO northstar_app_runtime;
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_comparable_month_v2_read(
  UUID,UUID,TEXT,UUID,UUID) TO northstar_app_runtime;
END IF;END $$;
