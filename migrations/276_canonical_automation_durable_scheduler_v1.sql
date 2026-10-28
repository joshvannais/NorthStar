-- Mission 28 Part 6B: durable, tenant-private schedule evidence for one
-- accepted Part 6A action unit. This migration mounts no timer, publisher,
-- consumer, worker, lease, provider, recipient or external-effect path.

CREATE TABLE public.canonical_automation_action_schedules_v1 (
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 schedule_id UUID NOT NULL,
 transaction_id UUID NOT NULL,
 run_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 outbox_id UUID NOT NULL,
 unit_digest TEXT NOT NULL CHECK(unit_digest~'^sha256:[0-9a-f]{64}$'),
 policy_id UUID NOT NULL,
 policy_version BIGINT NOT NULL CHECK(policy_version BETWEEN 1 AND 9007199254740991),
 policy_digest TEXT NOT NULL CHECK(policy_digest~'^sha256:[0-9a-f]{64}$'),
 source_set_digest TEXT NOT NULL CHECK(source_set_digest~'^sha256:[0-9a-f]{64}$'),
 tenant_time_zone TEXT NOT NULL CHECK(octet_length(tenant_time_zone) BETWEEN 3 AND 64),
 local_date DATE NOT NULL,
 local_time TIME(0) NOT NULL,
 utc_instant TIMESTAMPTZ(6) NOT NULL,
 fold_resolution TEXT NOT NULL CHECK(fold_resolution IN('not_ambiguous','earlier','later')),
 calendar_id UUID NOT NULL,
 calendar_version BIGINT NOT NULL CHECK(calendar_version BETWEEN 1 AND 9007199254740991),
 calendar_digest TEXT NOT NULL CHECK(calendar_digest~'^sha256:[0-9a-f]{64}$'),
 schedule_binding_digest TEXT NOT NULL CHECK(schedule_binding_digest~'^sha256:[0-9a-f]{64}$'),
 expires_at TIMESTAMPTZ(6) NOT NULL,
 request_digest TEXT NOT NULL CHECK(request_digest~'^sha256:[0-9a-f]{64}$'),
 state TEXT NOT NULL CHECK(state='scheduled_unpublished'),
 canonical_text TEXT NOT NULL CHECK(octet_length(canonical_text) BETWEEN 2 AND 65536),
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 retention_class TEXT NOT NULL REFERENCES public.canonical_automation_retention_classes_v1(retention_class),
 trusted_clock_contract TEXT NOT NULL CHECK(trusted_clock_contract='postgresql_statement_timestamp_v1'),
 recorded_time_zone TEXT NOT NULL CHECK(recorded_time_zone='UTC'),
 recorded_at TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY(organization_id,schedule_id),
 UNIQUE(organization_id,unit_id),
 UNIQUE(organization_id,outbox_id),
 UNIQUE(organization_id,request_digest),
 FOREIGN KEY(organization_id,transaction_id)
  REFERENCES public.canonical_automation_action_transactions_v1(organization_id,transaction_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id)
  REFERENCES public.canonical_automation_action_units_v1(organization_id,unit_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,outbox_id)
  REFERENCES public.canonical_automation_action_outbox_v1(organization_id,outbox_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,policy_id,policy_version)
  REFERENCES public.canonical_automation_policy_versions_v1(organization_id,policy_id,version) ON DELETE RESTRICT,
 CHECK(retention_class='decision_history'),
 CHECK(document->>'tenantId' IS NOT DISTINCT FROM organization_id::text),
 CHECK(document->>'scheduleId' IS NOT DISTINCT FROM schedule_id::text),
 CHECK(document->>'transactionId' IS NOT DISTINCT FROM transaction_id::text),
 CHECK(document->>'runId' IS NOT DISTINCT FROM run_id::text),
 CHECK(document#>>'{unitBinding,unitId}' IS NOT DISTINCT FROM unit_id::text),
 CHECK(document#>>'{unitBinding,outboxId}' IS NOT DISTINCT FROM outbox_id::text),
 CHECK(document#>>'{unitBinding,unitDigest}' IS NOT DISTINCT FROM unit_digest),
 CHECK(document#>>'{policyBinding,policyId}' IS NOT DISTINCT FROM policy_id::text),
 CHECK((document#>>'{policyBinding,policyVersion}')::bigint IS NOT DISTINCT FROM policy_version),
 CHECK(document#>>'{policyBinding,policyDigest}' IS NOT DISTINCT FROM policy_digest),
 CHECK(document#>>'{sourceBinding,sourceSetDigest}' IS NOT DISTINCT FROM source_set_digest),
 CHECK(document#>>'{localSchedule,tenantTimeZone}' IS NOT DISTINCT FROM tenant_time_zone),
 CHECK(document#>>'{localSchedule,localDate}' IS NOT DISTINCT FROM to_char(local_date,'YYYY-MM-DD')),
 CHECK(document#>>'{localSchedule,localTime}' IS NOT DISTINCT FROM to_char(local_time,'HH24:MI:SS')),
 CHECK(document#>>'{localSchedule,utcInstant}' IS NOT DISTINCT FROM public.canonical_automation_utc_v1(utc_instant)),
 CHECK(document#>>'{localSchedule,foldResolution}' IS NOT DISTINCT FROM fold_resolution),
 CHECK(document#>>'{calendarBinding,calendarId}' IS NOT DISTINCT FROM calendar_id::text),
 CHECK((document#>>'{calendarBinding,calendarVersion}')::bigint IS NOT DISTINCT FROM calendar_version),
 CHECK(document#>>'{calendarBinding,calendarDigest}' IS NOT DISTINCT FROM calendar_digest),
 CHECK(document#>>'{calendarBinding,calendarState}' IS NOT DISTINCT FROM 'exact_current'),
 CHECK(document#>>'{calendarBinding,tenantTimeZone}' IS NOT DISTINCT FROM tenant_time_zone),
 CHECK(document#>>'{expirationBinding,expiresAt}' IS NOT DISTINCT FROM public.canonical_automation_utc_v1(expires_at)),
 CHECK(document#>>'{trustedClockBinding,contract}' IS NOT DISTINCT FROM trusted_clock_contract),
 CHECK(document->>'scheduleBindingDigest' IS NOT DISTINCT FROM schedule_binding_digest),
 CHECK(document->>'requestDigest' IS NOT DISTINCT FROM request_digest)
);

CREATE INDEX canonical_automation_action_schedules_v1_due
 ON public.canonical_automation_action_schedules_v1(organization_id,utc_instant,schedule_id)
 WHERE state='scheduled_unpublished';
CREATE INDEX canonical_automation_action_schedules_v1_run
 ON public.canonical_automation_action_schedules_v1(organization_id,run_id,recorded_at,schedule_id);

CREATE TRIGGER canonical_automation_action_schedules_v1_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_automation_action_schedules_v1
 FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_automation_immutable_v1();

ALTER TABLE public.canonical_automation_action_schedules_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_automation_action_schedules_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_automation_action_schedules_v1_tenant_owner_only
 ON public.canonical_automation_action_schedules_v1
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_schedules_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class
   WHERE oid='public.canonical_automation_action_schedules_v1'::regclass))
  AND organization_id::text=NULLIF(pg_catalog.current_setting('northstar.automation_tenant_id',TRUE),''));

CREATE FUNCTION public.canonical_automation_store_action_schedule_v1(
 canonical_text_value TEXT, trusted_resolution JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE
 doc JSONB; org UUID; schedule_value UUID; transaction_value UUID; run_value UUID; unit_value UUID; outbox_value UUID;
 policy_value UUID; policy_version_value BIGINT; calendar_value UUID; calendar_version_value BIGINT;
 request_digest_value TEXT; calendar_digest_value TEXT; schedule_digest_value TEXT; trusted_expected JSONB;
 local_date_value DATE; local_time_value TIME(0); local_timestamp_value TIMESTAMP(0);
 utc_value TIMESTAMPTZ(6); expires_value TIMESTAMPTZ(6); recorded_value TIMESTAMPTZ(6);
 zone_value TEXT; fold_value TEXT; match_count INTEGER; earlier_match TIMESTAMPTZ(6); later_match TIMESTAMPTZ(6);
 local_day INTEGER; local_minute INTEGER; window_item RECORD; holiday_item RECORD;
 previous_day INTEGER; previous_start INTEGER; previous_end INTEGER; item_day INTEGER; item_start INTEGER; item_end INTEGER;
 previous_holiday DATE; latest_policy_state TEXT; latest_snapshot_id UUID; snapshot_item RECORD;
 source_index INTEGER; snapshot_count INTEGER;
 stored public.canonical_automation_action_schedules_v1%ROWTYPE;
 transaction_row public.canonical_automation_action_transactions_v1%ROWTYPE;
 unit_row public.canonical_automation_action_units_v1%ROWTYPE;
 outbox_row public.canonical_automation_action_outbox_v1%ROWTYPE;
BEGIN
 IF canonical_text_value IS NULL OR octet_length(canonical_text_value) NOT BETWEEN 2 AND 65536 THEN
  RAISE EXCEPTION 'Mission 28 action schedule bounds invalid' USING ERRCODE='22023'; END IF;
 doc:=public.canonical_automation_document_v1(canonical_text_value);
 IF public.canonical_automation_part4b_keys_exact_v1(doc,ARRAY['schemaVersion','tenantId','scheduleId','transactionId','runId',
  'unitBinding','policyBinding','sourceBinding','localSchedule','calendarBinding','expirationBinding','trustedClockBinding',
  'scheduleBindingDigest','requestDigest']) IS DISTINCT FROM TRUE OR
  doc->>'schemaVersion' IS DISTINCT FROM 'mission28.action-schedule.request.v1' OR
  COALESCE(doc->>'tenantId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'scheduleId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'transactionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'runId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
  COALESCE(doc->>'scheduleBindingDigest','')!~'^sha256:[0-9a-f]{64}$' OR
  COALESCE(doc->>'requestDigest','')!~'^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Mission 28 action schedule shape invalid' USING ERRCODE='22023'; END IF;
 IF public.canonical_automation_part4b_keys_exact_v1(doc->'unitBinding',ARRAY['unitId','outboxId','unitDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'policyBinding',ARRAY['policyId','policyVersion','policyDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'sourceBinding',ARRAY['sourceSetDigest']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'localSchedule',ARRAY['tenantTimeZone','localDate','localTime','utcInstant','foldResolution']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'calendarBinding',ARRAY['calendarId','calendarVersion','calendarDigest','calendarState','tenantTimeZone','allowedWeeklyWindows','quietWeeklyWindows','holidayDates']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'expirationBinding',ARRAY['expiresAt']) IS DISTINCT FROM TRUE OR
    public.canonical_automation_part4b_keys_exact_v1(doc->'trustedClockBinding',ARRAY['contract']) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'Mission 28 action schedule binding shape invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc#>>'{unitBinding,unitId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{unitBinding,outboxId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    COALESCE(doc#>>'{unitBinding,unitDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{policyBinding,policyId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{policyBinding,policyVersion}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{policyBinding,policyVersion}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{policyBinding,policyDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{sourceBinding,sourceSetDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    COALESCE(doc#>>'{calendarBinding,calendarId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    jsonb_typeof(doc#>'{calendarBinding,calendarVersion}') IS DISTINCT FROM 'number' OR
    COALESCE(doc#>>'{calendarBinding,calendarVersion}','')!~'^[1-9][0-9]*$' OR
    COALESCE(doc#>>'{calendarBinding,calendarDigest}','')!~'^sha256:[0-9a-f]{64}$' OR
    doc#>>'{calendarBinding,calendarState}' IS DISTINCT FROM 'exact_current' OR
    jsonb_typeof(doc#>'{calendarBinding,allowedWeeklyWindows}') IS DISTINCT FROM 'array' OR
    jsonb_typeof(doc#>'{calendarBinding,quietWeeklyWindows}') IS DISTINCT FROM 'array' OR
    jsonb_typeof(doc#>'{calendarBinding,holidayDates}') IS DISTINCT FROM 'array' OR
    doc#>>'{trustedClockBinding,contract}' IS DISTINCT FROM 'postgresql_statement_timestamp_v1' THEN
  RAISE EXCEPTION 'Mission 28 schedule identity or calendar invalid' USING ERRCODE='22023'; END IF;
 IF COALESCE(doc#>>'{localSchedule,tenantTimeZone}','')!~'^(UTC|[A-Za-z]+(?:[_-][A-Za-z]+)*(?:/[A-Za-z]+(?:[_-][A-Za-z]+)*)+)$' OR
    octet_length(doc#>>'{localSchedule,tenantTimeZone}') NOT BETWEEN 3 AND 64 OR
    doc#>>'{calendarBinding,tenantTimeZone}' IS DISTINCT FROM doc#>>'{localSchedule,tenantTimeZone}' OR
    COALESCE(doc#>>'{localSchedule,localDate}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
    COALESCE(doc#>>'{localSchedule,localTime}','')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$' OR
    COALESCE(doc#>>'{localSchedule,utcInstant}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc#>>'{expirationBinding,expiresAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR
    COALESCE(doc#>>'{localSchedule,foldResolution}','') NOT IN('not_ambiguous','earlier','later') THEN
  RAISE EXCEPTION 'Mission 28 schedule time material invalid' USING ERRCODE='22023'; END IF;

 org:=(doc->>'tenantId')::uuid; schedule_value:=(doc->>'scheduleId')::uuid;
 transaction_value:=(doc->>'transactionId')::uuid; run_value:=(doc->>'runId')::uuid;
 unit_value:=(doc#>>'{unitBinding,unitId}')::uuid; outbox_value:=(doc#>>'{unitBinding,outboxId}')::uuid;
 policy_value:=(doc#>>'{policyBinding,policyId}')::uuid; policy_version_value:=(doc#>>'{policyBinding,policyVersion}')::bigint;
 calendar_value:=(doc#>>'{calendarBinding,calendarId}')::uuid; calendar_version_value:=(doc#>>'{calendarBinding,calendarVersion}')::bigint;
 calendar_digest_value:=public.canonical_automation_digest_v1('mission28.business-calendar.v1'||chr(10),jsonb_build_object(
  'tenantId',doc->>'tenantId','calendarId',doc#>>'{calendarBinding,calendarId}',
  'calendarVersion',doc#>'{calendarBinding,calendarVersion}','calendarState',doc#>>'{calendarBinding,calendarState}',
  'tenantTimeZone',doc#>>'{calendarBinding,tenantTimeZone}','allowedWeeklyWindows',doc#>'{calendarBinding,allowedWeeklyWindows}',
  'quietWeeklyWindows',doc#>'{calendarBinding,quietWeeklyWindows}','holidayDates',doc#>'{calendarBinding,holidayDates}'));
 IF calendar_digest_value IS DISTINCT FROM doc#>>'{calendarBinding,calendarDigest}' THEN
  RAISE EXCEPTION 'Mission 28 business calendar digest invalid' USING ERRCODE='22023'; END IF;
 schedule_digest_value:=public.canonical_automation_digest_v1('mission28.action-schedule-binding.v1'||chr(10),jsonb_build_object(
  'tenantId',doc->>'tenantId','transactionId',doc->>'transactionId','runId',doc->>'runId',
  'unitBinding',doc->'unitBinding','policyBinding',doc->'policyBinding','sourceBinding',doc->'sourceBinding',
  'localSchedule',doc->'localSchedule','calendarBinding',doc->'calendarBinding',
  'expirationBinding',doc->'expirationBinding','trustedClockBinding',doc->'trustedClockBinding'));
 IF schedule_digest_value IS DISTINCT FROM doc->>'scheduleBindingDigest' THEN
  RAISE EXCEPTION 'Mission 28 schedule binding digest invalid' USING ERRCODE='22023'; END IF;
 request_digest_value:=public.canonical_automation_digest_v1('mission28.action-schedule.request.v1'||chr(10),doc-'requestDigest');
 IF request_digest_value IS DISTINCT FROM doc->>'requestDigest' THEN
  RAISE EXCEPTION 'Mission 28 schedule request digest invalid' USING ERRCODE='22023'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-action-schedule:'||schedule_value::text,0));
 PERFORM public.canonical_automation_enter_tenant_v1(org);
 SELECT * INTO stored FROM public.canonical_automation_action_schedules_v1
  WHERE organization_id=org AND schedule_id=schedule_value;
 IF stored.schedule_id IS NOT NULL THEN
  IF stored.request_digest IS DISTINCT FROM request_digest_value OR stored.canonical_text IS DISTINCT FROM canonical_text_value THEN
   RAISE EXCEPTION 'Mission 28 conflicting action schedule identity' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('state','scheduled_unpublished','replayed',TRUE,'scheduleId',schedule_value,
   'unitId',stored.unit_id,'utcInstant',public.canonical_automation_utc_v1(stored.utc_instant),
   'requestDigest',stored.request_digest,'recordedAt',public.canonical_automation_utc_v1(stored.recorded_at));
 END IF;

 trusted_expected:=jsonb_build_object('tenantId',doc->>'tenantId','transactionId',doc->>'transactionId','runId',doc->>'runId',
  'unitBinding',doc->'unitBinding','policyBinding',doc->'policyBinding','sourceBinding',doc->'sourceBinding',
  'localSchedule',doc->'localSchedule','calendarBinding',doc->'calendarBinding','expirationBinding',doc->'expirationBinding',
  'trustedClockBinding',doc->'trustedClockBinding','scheduleBindingDigest',doc->>'scheduleBindingDigest');
 IF public.canonical_automation_part4b_keys_exact_v1(trusted_resolution,ARRAY['tenantId','transactionId','runId','unitBinding',
   'policyBinding','sourceBinding','localSchedule','calendarBinding','expirationBinding','trustedClockBinding','scheduleBindingDigest']) IS DISTINCT FROM TRUE OR
    trusted_resolution IS DISTINCT FROM trusted_expected THEN
  RAISE EXCEPTION 'Mission 28 separately trusted schedule resolution mismatch' USING ERRCODE='42501'; END IF;

 zone_value:=doc#>>'{localSchedule,tenantTimeZone}'; fold_value:=doc#>>'{localSchedule,foldResolution}';
 IF zone_value LIKE 'US/%' OR zone_value LIKE 'Etc/%' OR zone_value LIKE 'posix/%' OR zone_value LIKE 'right/%' OR
    zone_value IN('GMT','GMT0','Greenwich','Universal','Zulu') OR
    NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone_value) THEN
  RAISE EXCEPTION 'Mission 28 exact canonical tenant time zone unavailable' USING ERRCODE='42501'; END IF;
 BEGIN
  local_date_value:=(doc#>>'{localSchedule,localDate}')::date;
  local_time_value:=(doc#>>'{localSchedule,localTime}')::time(0);
  utc_value:=(doc#>>'{localSchedule,utcInstant}')::timestamptz(6);
  expires_value:=(doc#>>'{expirationBinding,expiresAt}')::timestamptz(6);
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Mission 28 schedule timestamp invalid' USING ERRCODE='22023';
 END;
 IF to_char(local_date_value,'YYYY-MM-DD') IS DISTINCT FROM doc#>>'{localSchedule,localDate}' OR
    to_char(local_time_value,'HH24:MI:SS') IS DISTINCT FROM doc#>>'{localSchedule,localTime}' OR
    public.canonical_automation_utc_v1(utc_value) IS DISTINCT FROM doc#>>'{localSchedule,utcInstant}' OR
    public.canonical_automation_utc_v1(expires_value) IS DISTINCT FROM doc#>>'{expirationBinding,expiresAt}' THEN
  RAISE EXCEPTION 'Mission 28 schedule timestamp canonicalization invalid' USING ERRCODE='22023'; END IF;
 local_timestamp_value:=local_date_value+local_time_value;
 SELECT count(*)::integer,min(candidate),max(candidate) INTO match_count,earlier_match,later_match
 FROM generate_series(utc_value-INTERVAL '24 hours',utc_value+INTERVAL '24 hours',INTERVAL '1 minute') candidate
 WHERE candidate AT TIME ZONE zone_value=local_timestamp_value;
 IF match_count=0 OR match_count>2 OR
    (match_count=1 AND (fold_value IS DISTINCT FROM 'not_ambiguous' OR utc_value IS DISTINCT FROM earlier_match)) OR
    (match_count=2 AND ((fold_value='earlier' AND utc_value IS DISTINCT FROM earlier_match) OR
      (fold_value='later' AND utc_value IS DISTINCT FROM later_match) OR fold_value='not_ambiguous')) THEN
  RAISE EXCEPTION 'Mission 28 daylight-saving schedule resolution invalid' USING ERRCODE='22023'; END IF;

 IF jsonb_array_length(doc#>'{calendarBinding,allowedWeeklyWindows}') NOT BETWEEN 1 AND 32 OR
    jsonb_array_length(doc#>'{calendarBinding,quietWeeklyWindows}') NOT BETWEEN 0 AND 32 OR
    jsonb_array_length(doc#>'{calendarBinding,holidayDates}') NOT BETWEEN 0 AND 64 THEN
  RAISE EXCEPTION 'Mission 28 business calendar bounds invalid' USING ERRCODE='22023'; END IF;
 previous_day:=NULL; previous_start:=NULL; previous_end:=NULL;
 FOR window_item IN SELECT value,ordinality FROM jsonb_array_elements(doc#>'{calendarBinding,allowedWeeklyWindows}') WITH ORDINALITY LOOP
  IF public.canonical_automation_part4b_keys_exact_v1(window_item.value,ARRAY['dayId','startMinuteInclusive','endMinuteExclusive']) IS DISTINCT FROM TRUE OR
     jsonb_typeof(window_item.value->'dayId') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'startMinuteInclusive') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'endMinuteExclusive') IS DISTINCT FROM 'number' OR
     COALESCE(window_item.value->>'dayId','')!~'^[1-7]$' OR
     COALESCE(window_item.value->>'startMinuteInclusive','')!~'^(0|[1-9][0-9]{0,3})$' OR
     COALESCE(window_item.value->>'endMinuteExclusive','')!~'^[1-9][0-9]{0,3}$' THEN
   RAISE EXCEPTION 'Mission 28 allowed business window shape invalid' USING ERRCODE='22023'; END IF;
  item_day:=(window_item.value->>'dayId')::integer; item_start:=(window_item.value->>'startMinuteInclusive')::integer;
  item_end:=(window_item.value->>'endMinuteExclusive')::integer;
  IF item_start>=item_end OR item_end>1440 OR
     (previous_day IS NOT NULL AND (item_day<previous_day OR (item_day=previous_day AND item_start<previous_end))) THEN
   RAISE EXCEPTION 'Mission 28 allowed business window order invalid' USING ERRCODE='22023'; END IF;
  previous_day:=item_day; previous_start:=item_start; previous_end:=item_end;
 END LOOP;
 previous_day:=NULL; previous_start:=NULL; previous_end:=NULL;
 FOR window_item IN SELECT value,ordinality FROM jsonb_array_elements(doc#>'{calendarBinding,quietWeeklyWindows}') WITH ORDINALITY LOOP
  IF public.canonical_automation_part4b_keys_exact_v1(window_item.value,ARRAY['dayId','startMinuteInclusive','endMinuteExclusive']) IS DISTINCT FROM TRUE OR
     jsonb_typeof(window_item.value->'dayId') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'startMinuteInclusive') IS DISTINCT FROM 'number' OR
     jsonb_typeof(window_item.value->'endMinuteExclusive') IS DISTINCT FROM 'number' OR
     COALESCE(window_item.value->>'dayId','')!~'^[1-7]$' OR
     COALESCE(window_item.value->>'startMinuteInclusive','')!~'^(0|[1-9][0-9]{0,3})$' OR
     COALESCE(window_item.value->>'endMinuteExclusive','')!~'^[1-9][0-9]{0,3}$' THEN
   RAISE EXCEPTION 'Mission 28 quiet window shape invalid' USING ERRCODE='22023'; END IF;
  item_day:=(window_item.value->>'dayId')::integer; item_start:=(window_item.value->>'startMinuteInclusive')::integer;
  item_end:=(window_item.value->>'endMinuteExclusive')::integer;
  IF item_start>=item_end OR item_end>1440 OR
     (previous_day IS NOT NULL AND (item_day<previous_day OR (item_day=previous_day AND item_start<previous_end))) THEN
   RAISE EXCEPTION 'Mission 28 quiet window order invalid' USING ERRCODE='22023'; END IF;
  previous_day:=item_day; previous_start:=item_start; previous_end:=item_end;
 END LOOP;
 previous_holiday:=NULL;
 FOR holiday_item IN SELECT value,ordinality FROM jsonb_array_elements(doc#>'{calendarBinding,holidayDates}') WITH ORDINALITY LOOP
  IF jsonb_typeof(holiday_item.value) IS DISTINCT FROM 'string' OR
     COALESCE(holiday_item.value#>>'{}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Mission 28 holiday date shape invalid' USING ERRCODE='22023'; END IF;
  BEGIN local_date_value:=(holiday_item.value#>>'{}')::date;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Mission 28 holiday date invalid' USING ERRCODE='22023'; END;
  IF to_char(local_date_value,'YYYY-MM-DD') IS DISTINCT FROM holiday_item.value#>>'{}' OR
     (previous_holiday IS NOT NULL AND local_date_value<=previous_holiday) THEN
   RAISE EXCEPTION 'Mission 28 holiday date order invalid' USING ERRCODE='22023'; END IF;
  previous_holiday:=local_date_value;
 END LOOP;
 local_date_value:=(doc#>>'{localSchedule,localDate}')::date;
 local_day:=extract(isodow FROM local_date_value)::integer;
 local_minute:=extract(hour FROM local_time_value)::integer*60+extract(minute FROM local_time_value)::integer;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(doc#>'{calendarBinding,allowedWeeklyWindows}') value
    WHERE (value->>'dayId')::integer=local_day AND local_minute>=(value->>'startMinuteInclusive')::integer
      AND local_minute<(value->>'endMinuteExclusive')::integer) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(doc#>'{calendarBinding,quietWeeklyWindows}') value
    WHERE (value->>'dayId')::integer=local_day AND local_minute>=(value->>'startMinuteInclusive')::integer
      AND local_minute<(value->>'endMinuteExclusive')::integer) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements_text(doc#>'{calendarBinding,holidayDates}') value
      WHERE value=to_char(local_date_value,'YYYY-MM-DD')) THEN
  RAISE EXCEPTION 'Mission 28 schedule blocked by business calendar' USING ERRCODE='42501'; END IF;

 recorded_value:=public.canonical_automation_clock_v1();
 IF utc_value<=recorded_value OR utc_value>recorded_value+INTERVAL '366 days' OR
    expires_value<=utc_value OR expires_value>recorded_value+INTERVAL '367 days' THEN
  RAISE EXCEPTION 'Mission 28 schedule expiration or trusted-clock bound invalid' USING ERRCODE='42501'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-action-unit-schedule:'||unit_value::text,0));
 SELECT * INTO transaction_row FROM public.canonical_automation_action_transactions_v1
  WHERE organization_id=org AND transaction_id=transaction_value AND run_id=run_value
   AND policy_id=policy_value AND policy_version=policy_version_value
   AND policy_digest=doc#>>'{policyBinding,policyDigest}' AND source_set_digest=doc#>>'{sourceBinding,sourceSetDigest}';
 SELECT * INTO unit_row FROM public.canonical_automation_action_units_v1
  WHERE organization_id=org AND unit_id=unit_value AND transaction_id=transaction_value AND run_id=run_value
   AND unit_digest=doc#>>'{unitBinding,unitDigest}' AND state='committed_unpublished';
 SELECT * INTO outbox_row FROM public.canonical_automation_action_outbox_v1
  WHERE organization_id=org AND outbox_id=outbox_value AND transaction_id=transaction_value AND unit_id=unit_value
   AND unit_digest=doc#>>'{unitBinding,unitDigest}' AND state='committed_unpublished'
   AND queue_publication_id IS NULL AND queue_published_at IS NULL AND claim_id IS NULL AND lease_expires_at IS NULL;
 IF transaction_row.transaction_id IS NULL OR unit_row.unit_id IS NULL OR outbox_row.outbox_id IS NULL THEN
  RAISE EXCEPTION 'Mission 28 exact Part 6A action authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.canonical_automation_action_schedules_v1
   WHERE organization_id=org AND (unit_id=unit_value OR outbox_id=outbox_value)) THEN
  RAISE EXCEPTION 'Mission 28 action unit already scheduled' USING ERRCODE='23505'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-lifecycle-policy:'||policy_value::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.canonical_automation_policy_versions_v1
   WHERE organization_id=org AND policy_id=policy_value AND version=policy_version_value
    AND canonical_digest=doc#>>'{policyBinding,policyDigest}' AND expires_at>recorded_value) THEN
  RAISE EXCEPTION 'Mission 28 exact current policy unavailable for scheduling' USING ERRCODE='42501'; END IF;
 SELECT to_state INTO latest_policy_state FROM public.canonical_automation_lifecycle_events_v1
  WHERE organization_id=org AND policy_id=policy_value AND policy_version=policy_version_value
  ORDER BY lifecycle_sequence DESC LIMIT 1;
 IF latest_policy_state IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'Mission 28 active policy unavailable for scheduling' USING ERRCODE='42501'; END IF;
 snapshot_count:=jsonb_array_length(transaction_row.document#>'{sourceBinding,snapshotIds}');
 FOR source_index IN 0..snapshot_count-1 LOOP
  SELECT * INTO snapshot_item FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org
    AND snapshot_id=(transaction_row.document#>>ARRAY['sourceBinding','snapshotIds',source_index::text])::uuid
    AND snapshot_digest=transaction_row.document#>>ARRAY['sourceBinding','snapshotDigests',source_index::text];
  IF snapshot_item.snapshot_id IS NULL OR snapshot_item.document#>>'{currentness,availability}' IS DISTINCT FROM 'available_exact_current' THEN
   RAISE EXCEPTION 'Mission 28 exact current source unavailable for scheduling' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':m28-source-lineage:'||snapshot_item.trigger_id||':'||
   snapshot_item.record_identity_digest||':'||snapshot_item.event_kind,0));
  SELECT snapshot_id INTO latest_snapshot_id FROM public.canonical_automation_trigger_snapshots_v1
   WHERE organization_id=org AND trigger_id=snapshot_item.trigger_id
    AND record_identity_digest=snapshot_item.record_identity_digest AND event_kind=snapshot_item.event_kind
   ORDER BY lineage_sequence DESC LIMIT 1;
  IF latest_snapshot_id IS DISTINCT FROM snapshot_item.snapshot_id THEN
   RAISE EXCEPTION 'Mission 28 source snapshot is not latest scheduling head' USING ERRCODE='42501'; END IF;
 END LOOP;

 INSERT INTO public.canonical_automation_action_schedules_v1 VALUES(
  org,schedule_value,transaction_value,run_value,unit_value,outbox_value,doc#>>'{unitBinding,unitDigest}',
  policy_value,policy_version_value,doc#>>'{policyBinding,policyDigest}',doc#>>'{sourceBinding,sourceSetDigest}',
  zone_value,(doc#>>'{localSchedule,localDate}')::date,(doc#>>'{localSchedule,localTime}')::time(0),utc_value,fold_value,
  calendar_value,calendar_version_value,calendar_digest_value,schedule_digest_value,expires_value,request_digest_value,
  'scheduled_unpublished',canonical_text_value,doc,'decision_history','postgresql_statement_timestamp_v1','UTC',recorded_value);
 RETURN jsonb_build_object('state','scheduled_unpublished','replayed',FALSE,'scheduleId',schedule_value,'unitId',unit_value,
  'utcInstant',public.canonical_automation_utc_v1(utc_value),'requestDigest',request_digest_value,
  'recordedAt',public.canonical_automation_utc_v1(recorded_value));
END $$;

REVOKE ALL ON TABLE public.canonical_automation_action_schedules_v1 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_automation_store_action_schedule_v1(TEXT,JSONB) FROM PUBLIC;
