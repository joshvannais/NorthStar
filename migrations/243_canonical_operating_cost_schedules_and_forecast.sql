-- Mission 26 original Part 7D. Immutable owner-recorded schedules pin the
-- active profile, exact assets, and server-derived Mission 24 allocation refs.

CREATE TABLE public.canonical_operating_cost_schedule_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000), previous_id UUID,
 action TEXT NOT NULL CHECK(action IN('replace','revoke')),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=1048576),
 authority JSONB NOT NULL CHECK(jsonb_typeof(authority)='object' AND octet_length(authority::text)<=1048576),
 actor_user_id UUID NOT NULL,membership_id UUID NOT NULL,auth_session_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='operating-cost-schedule-snapshot-v1'),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'),created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(organization_id,revision),UNIQUE(organization_id,actor_user_id,request_key_hash),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,previous_id) REFERENCES public.canonical_operating_cost_schedule_revisions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_user_id,auth_session_id) REFERENCES public.auth_sessions(organization_id,user_id,id) ON DELETE RESTRICT,
 CHECK((revision=1 AND previous_id IS NULL) OR (revision>1 AND previous_id IS NOT NULL)));

CREATE FUNCTION public.canonical_operating_cost_schedule_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Operating-cost schedule history is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER canonical_operating_cost_schedule_immutable BEFORE UPDATE OR DELETE
ON public.canonical_operating_cost_schedule_revisions FOR EACH ROW
EXECUTE FUNCTION public.canonical_operating_cost_schedule_immutable();

CREATE FUNCTION public.canonical_operating_cost_mission24_manifest(org UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE refs JSONB;digest_value TEXT;
BEGIN
 WITH equipment AS(SELECT DISTINCT ON(estimate_id)* FROM public.canonical_equipment_cost_plans
  WHERE organization_id=org ORDER BY estimate_id,revision DESC,id DESC),
 pricing AS(SELECT DISTINCT ON(estimate_id)* FROM public.canonical_pricing_plans
  WHERE organization_id=org ORDER BY estimate_id,revision DESC,id DESC),items AS(
  SELECT 'equipment:'||p.id::text||':'||(l->>'lineId') key_value,jsonb_build_object(
   'referenceKey','equipment:'||p.id::text||':'||(l->>'lineId'),'kind','equipment_pool',
   'planId',p.id,'planRevision',p.revision,'planDigest',rtrim(p.digest),'estimateId',p.estimate_id,
   'lineId',l->>'lineId','method',l->>'method','includedCategories',l#>'{allocation,includedCategories}',
   'currency',p.currency,'overlapResolved',TRUE)value FROM equipment p
   CROSS JOIN LATERAL jsonb_array_elements(p.inputs->'lines')l
   WHERE p.action='save' AND l->>'method' IN('economic_recovery','financing_cash')
  UNION ALL SELECT 'overhead:'||p.id::text,jsonb_build_object(
   'referenceKey','overhead:'||p.id::text,'kind','overhead_allocation','planId',p.id,
   'planRevision',p.revision,'planDigest',rtrim(p.digest),'estimateId',p.estimate_id,'lineId',NULL,
   'method',p.inputs#>>'{overhead,method}','includedCategories',COALESCE(p.inputs#>'{overhead,coverage,included}','[]'::jsonb),
   'currency',p.currency,'overlapResolved',COALESCE((p.result#>>'{overhead,overlapResolved}')::boolean,FALSE))
   FROM pricing p WHERE p.action='save' AND p.inputs#>>'{overhead,method}' IS DISTINCT FROM 'unknown')
 SELECT COALESCE(jsonb_agg(value ORDER BY key_value),'[]'::jsonb)INTO refs FROM items;
 digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'version','mission24-operating-cost-reference-manifest-v1','references',refs));
 RETURN jsonb_build_object('version','mission24-operating-cost-reference-manifest-v1','digest',digest_value,'references',refs);
END $$;

CREATE FUNCTION public.canonical_operating_cost_snapshot_mutate(
 org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,body JSONB)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;old public.canonical_operating_cost_schedule_revisions%ROWTYPE;
 replay public.canonical_operating_cost_schedule_revisions%ROWTYPE;inserted public.canonical_operating_cost_schedule_revisions%ROWTYPE;
 profile public.canonical_business_profiles%ROWTYPE;asset public.tenant_assets%ROWTYPE;s JSONB;
 key_hash TEXT;request_hash TEXT;digest_value TEXT;next_revision BIGINT;manifest JSONB;reconciliation JSONB;
 pins JSONB:='[]'::jsonb;seen UUID[]:='{}';captured TIMESTAMPTZ;zone TEXT;currency TEXT;source_auth JSONB;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable'THEN RAISE EXCEPTION'Serializable required'USING ERRCODE='25001';END IF;
 IF role_value NOT IN('owner','admin')OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$'
 OR public.canonical_operating_cost_snapshot_valid(body)IS NOT TRUE THEN RAISE EXCEPTION'Operating-cost input invalid'USING ERRCODE='22023';END IF;
 auth:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 PERFORM 1 FROM public.organizations WHERE id=org FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION'Organization unavailable'USING ERRCODE='42501';END IF;
 LOCK TABLE public.canonical_equipment_cost_plans,public.canonical_pricing_plans IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-cost-schedules:'||org::text,0));
 auth:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');
 request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'body',body));
 SELECT * INTO replay FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF replay.id IS NOT NULL THEN IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION'Request body changed'USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('revision',replay.revision,'digest',rtrim(replay.canonical_digest),'action',replay.action,'replayed',TRUE);END IF;
 SELECT * INTO old FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF COALESCE(old.revision,0)<>(body->>'expectedRevision')::bigint OR COALESCE(rtrim(old.canonical_digest),'none')<>body->>'expectedDigest'
 THEN RAISE EXCEPTION'Operating-cost schedules changed'USING ERRCODE='40001';END IF;
 IF body->>'action'='revoke'AND old.id IS NULL THEN RAISE EXCEPTION'Nothing to revoke'USING ERRCODE='22023';END IF;
 captured:=public.canonical_forecast_workload_capacity_v1_clock();
 SELECT p.* INTO profile FROM public.canonical_business_profiles p JOIN public.organization_onboarding o
  ON o.organization_id=p.organization_id AND o.active_business_profile_id=p.id AND o.status='complete'
  WHERE p.organization_id=org AND p.is_active FOR SHARE OF p,o;
 zone:=profile.raw_profile#>>'{company,timeZone}';currency:=profile.raw_profile#>>'{company,currency}';
 IF profile.id IS NULL OR zone IS NULL OR currency!~'^[A-Z]{3}$'OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
 THEN RAISE EXCEPTION'Reporting profile unavailable'USING ERRCODE='40001';END IF;
 manifest:=public.canonical_operating_cost_mission24_manifest(org);
 IF body->>'action'='replace'THEN
  IF body->>'currency'IS DISTINCT FROM currency OR(body#>>'{coverage,recordedThrough}')::timestamptz>captured
  OR(body->>'effectiveOn')::date>(body#>>'{coverage,endsOn}')::date THEN RAISE EXCEPTION'Dates or currency invalid'USING ERRCODE='22023';END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(body->'schedules')ORDER BY value->>'scheduleKey'LOOP
   IF(s#>>'{sourceAttestation,attestedAt}')::timestamptz>captured THEN RAISE EXCEPTION'Future attestation invalid'USING ERRCODE='22023';END IF;
   IF s->>'kind'='financed_asset_obligation'AND NOT((s->>'assetId')::uuid=ANY(seen))THEN
    SELECT * INTO asset FROM public.tenant_assets a WHERE a.organization_id=org AND a.id=(s->>'assetId')::uuid FOR SHARE;
    IF asset.id IS NULL OR asset.catalogue_state<>'active'THEN RAISE EXCEPTION'Asset unavailable'USING ERRCODE='22023';END IF;
    seen:=array_append(seen,asset.id);pins:=pins||jsonb_build_array(jsonb_build_object('id',asset.id,'version',asset.version,
     'catalogueState',asset.catalogue_state,'updatedAt',public.canonical_forecast_utc_instant(asset.updated_at)));END IF;
  END LOOP;reconciliation:=public.canonical_operating_cost_reconcile(org,body,manifest);
 ELSE pins:=COALESCE(old.authority->'assets','[]'::jsonb);reconciliation:=COALESCE(old.authority->'mission24','null'::jsonb);END IF;
 source_auth:=jsonb_build_object('version','operating-cost-source-authority-v1','profile',jsonb_build_object(
  'id',profile.id,'version',profile.version_number,'digest',rtrim(profile.normalized_profile_hash),'timeZone',zone,'currency',currency),
  'assets',pins,'mission24',reconciliation);
 next_revision:=COALESCE(old.revision,0)+1;digest_value:=public.canonical_completion_digest(jsonb_build_object(
  'organizationId',org,'revision',next_revision,'previousId',old.id,'action',body->>'action',
  'payload',body-'expectedRevision'-'expectedDigest'-'reason'-'confirmed'-'confirmationVersion','authority',source_auth,
  'actorUserId',actor,'membershipId',(auth->>'membershipId')::uuid,'authSessionId',session_value,'reason',body->>'reason',
  'requestDigest',request_hash,'createdAt',captured));
 INSERT INTO public.canonical_operating_cost_schedule_revisions(organization_id,revision,previous_id,action,payload,authority,
  actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest,created_at)
 VALUES(org,next_revision,old.id,body->>'action',body-'expectedRevision'-'expectedDigest'-'reason'-'confirmed'-'confirmationVersion',source_auth,
  actor,(auth->>'membershipId')::uuid,session_value,body->>'reason',TRUE,'operating-cost-schedule-snapshot-v1',key_hash,request_hash,digest_value,captured)
 RETURNING * INTO inserted;RETURN jsonb_build_object('revision',inserted.revision,'digest',rtrim(inserted.canonical_digest),'action',inserted.action,'replayed',FALSE);
END $$;

CREATE FUNCTION public.canonical_operating_cost_reference_basis_read(org UUID,actor UUID,role_value TEXT,session_value UUID)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;
BEGIN IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION'Read committed required'USING ERRCODE='25001';END IF;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 IF role_value NOT IN('owner','admin')THEN RAISE EXCEPTION'References restricted'USING ERRCODE='42501';END IF;
 LOCK TABLE public.canonical_equipment_cost_plans,public.canonical_pricing_plans IN SHARE MODE;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 RETURN public.canonical_operating_cost_mission24_manifest(org);END $$;

CREATE FUNCTION public.canonical_operating_cost_source_projection(v public.canonical_operating_cost_schedule_revisions)RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$SELECT CASE WHEN v.id IS NULL THEN
 jsonb_build_object('state','absent','revision',0,'digest','none','action',NULL,'createdAt',NULL,'snapshot',NULL)
 ELSE jsonb_build_object('state',CASE WHEN v.action='replace'THEN'current'ELSE'revoked'END,'revision',v.revision,
 'digest',rtrim(v.canonical_digest),'action',v.action,'createdAt',public.canonical_forecast_utc_instant(v.created_at),'snapshot',v.payload)END$$;

CREATE FUNCTION public.canonical_operating_cost_snapshot_read(org UUID,actor UUID,role_value TEXT,session_value UUID)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;v public.canonical_operating_cost_schedule_revisions%ROWTYPE;
BEGIN IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION'Read committed required'USING ERRCODE='25001';END IF;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);IF role_value NOT IN('owner','admin')THEN RAISE EXCEPTION'Source restricted'USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-cost-schedules:'||org::text,0));auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO v FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 RETURN public.canonical_operating_cost_source_projection(v);END $$;

CREATE FUNCTION public.canonical_operating_cost_snapshot_read_as_of(org UUID,actor UUID,role_value TEXT,session_value UUID,cutoff TIMESTAMPTZ)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;v public.canonical_operating_cost_schedule_revisions%ROWTYPE;
BEGIN IF current_setting('transaction_isolation')<>'read committed'OR cutoff IS NULL OR cutoff>public.canonical_forecast_workload_capacity_v1_clock()
 THEN RAISE EXCEPTION'Historical cutoff invalid'USING ERRCODE='22023';END IF;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);IF role_value NOT IN('owner','admin')THEN RAISE EXCEPTION'Source restricted'USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org AND created_at<=cutoff ORDER BY created_at DESC,revision DESC LIMIT 1;
 RETURN public.canonical_operating_cost_source_projection(v);END $$;

CREATE FUNCTION public.canonical_operating_cost_snapshot_valid(body JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s JSONB;d JSONB;c JSONB;a JSONB;p JSONB;v JSONB;coverage JSONB;
 keys TEXT[]:='{}';dates TEXT[];categories TEXT[];refs TEXT[]:='{}';kind TEXT;currency TEXT;
BEGIN
 IF public.canonical_field_evidence_object_keys_exact(body,ARRAY['expectedRevision','expectedDigest','action','currency','effectiveOn','coverage','schedules','allocationPolicy','reason','confirmed','confirmationVersion'])IS NOT TRUE
 OR jsonb_typeof(body->'expectedRevision')<>'number' OR body->>'expectedRevision'!~'^(0|[1-9][0-9]{0,3}|10000)$'
 OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$' OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none'))
 OR body->>'action' NOT IN('replace','revoke') OR public.canonical_learning_text_valid(body->>'reason',2000)IS NOT TRUE
 OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR body->>'confirmationVersion'<>'operating-cost-schedule-snapshot-v1' THEN RETURN FALSE;END IF;
 IF body->>'action'='revoke' THEN RETURN body->'currency'='null'::jsonb AND body->'effectiveOn'='null'::jsonb
  AND body->'coverage'='null'::jsonb AND body->'allocationPolicy'='null'::jsonb AND body->'schedules'='[]'::jsonb;END IF;
 currency:=body->>'currency';coverage:=body->'coverage';p:=body->'allocationPolicy';
 IF currency!~'^[A-Z]{3}$' OR public.canonical_pricing_day(body->'effectiveOn')IS NOT TRUE
 OR jsonb_typeof(body->'schedules')<>'array' OR jsonb_array_length(body->'schedules')>100
 OR public.canonical_field_evidence_object_keys_exact(coverage,ARRAY['startsOn','endsOn','recordedThrough','complete'])IS NOT TRUE
 OR public.canonical_pricing_day(coverage->'startsOn')IS NOT TRUE OR public.canonical_pricing_day(coverage->'endsOn')IS NOT TRUE
 OR coverage->>'endsOn'<coverage->>'startsOn' OR coverage->'complete'IS DISTINCT FROM'true'::jsonb
 OR coverage->>'recordedThrough'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
 OR public.canonical_field_evidence_object_keys_exact(p,ARRAY['expectedMission24Digest','decisions','reason'])IS NOT TRUE
 OR p->>'expectedMission24Digest'!~'^[0-9a-f]{64}$' OR jsonb_typeof(p->'decisions')<>'array'
 OR jsonb_array_length(p->'decisions')>500 OR public.canonical_learning_text_valid(p->>'reason',1000)IS NOT TRUE THEN RETURN FALSE;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(body->'schedules')LOOP
  IF public.canonical_field_evidence_object_keys_exact(s,ARRAY['scheduleKey','kind','assetId','amount','currency','dueDates','recurrenceEnd','includedCategories','sourceAttestation'])IS NOT TRUE
  OR s->>'scheduleKey'!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR s->>'scheduleKey'=ANY(keys)
  OR s->>'kind' NOT IN('overhead_expense','financed_asset_obligation') OR s->>'amount'!~'^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'
  OR s->>'currency'IS DISTINCT FROM currency OR jsonb_typeof(s->'dueDates')<>'array' OR jsonb_array_length(s->'dueDates')NOT BETWEEN 1 AND 120
  OR public.canonical_pricing_day(s->'recurrenceEnd')IS NOT TRUE OR jsonb_typeof(s->'includedCategories')<>'array'
  OR jsonb_array_length(s->'includedCategories')NOT BETWEEN 1 AND 12 THEN RETURN FALSE;END IF;
  keys:=array_append(keys,s->>'scheduleKey');kind:=s->>'kind';
  IF(kind='overhead_expense' AND s->'assetId'<>'null'::jsonb)OR(kind='financed_asset_obligation' AND
   COALESCE(s->>'assetId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')THEN RETURN FALSE;END IF;
  dates:='{}';FOR d IN SELECT value FROM jsonb_array_elements(s->'dueDates')LOOP
   IF public.canonical_field_evidence_object_keys_exact(d,ARRAY['dueOn','paymentStatus'])IS NOT TRUE
   OR public.canonical_pricing_day(d->'dueOn')IS NOT TRUE OR d->>'paymentStatus'NOT IN('scheduled','owner_marked_satisfied','canceled')
   OR d->>'dueOn'=ANY(dates) OR d->>'dueOn'>s->>'recurrenceEnd' OR d->>'dueOn'<coverage->>'startsOn' OR d->>'dueOn'>coverage->>'endsOn' THEN RETURN FALSE;END IF;
   dates:=array_append(dates,d->>'dueOn');END LOOP;
  categories:='{}';FOR c IN SELECT value FROM jsonb_array_elements(s->'includedCategories')LOOP
   IF jsonb_typeof(c)<>'string' OR c#>>'{}'=ANY(categories) OR c#>>'{}'NOT IN('rent','utilities','insurance','tax','administration','maintenance','interest','principal','debt_service','other')THEN RETURN FALSE;END IF;
   categories:=array_append(categories,c#>>'{}');END LOOP;
  IF kind='overhead_expense' AND('principal'=ANY(categories)OR'interest'=ANY(categories)OR'debt_service'=ANY(categories))
   OR kind='financed_asset_obligation' AND NOT('debt_service'=ANY(categories))THEN RETURN FALSE;END IF;
  a:=s->'sourceAttestation';IF public.canonical_field_evidence_object_keys_exact(a,ARRAY['kind','reference','documentDigest','attestedAt'])IS NOT TRUE
   OR a->>'kind'NOT IN('owner_attested','source_document') OR public.canonical_learning_text_valid(a->>'reference',500)IS NOT TRUE
   OR a->>'attestedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
   OR(a->>'kind'='owner_attested' AND a->'documentDigest'<>'null'::jsonb)OR(a->>'kind'='source_document' AND COALESCE(a->>'documentDigest','')!~'^[0-9a-f]{64}$')THEN RETURN FALSE;END IF;
 END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(p->'decisions')LOOP
  IF public.canonical_field_evidence_object_keys_exact(v,ARRAY['referenceKey','treatment','scheduleKey','reason'])IS NOT TRUE
  OR length(COALESCE(v->>'referenceKey',''))NOT BETWEEN 1 AND 300 OR v->>'referenceKey'=ANY(refs)
  OR v->>'treatment'NOT IN('economic_recovery_not_cash','job_overhead_allocation_not_cash','separate_cash_commitment','not_same_obligation')
  OR(v->'scheduleKey'<>'null'::jsonb AND NOT(v->>'scheduleKey'=ANY(keys)))OR public.canonical_learning_text_valid(v->>'reason',500)IS NOT TRUE THEN RETURN FALSE;END IF;
  refs:=array_append(refs,v->>'referenceKey');END LOOP;RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;END $$;

CREATE FUNCTION public.canonical_operating_cost_reconcile(org UUID,payload JSONB,manifest JSONB)RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r JSONB;d JSONB;s JSONB;decisions JSONB:=payload#>'{allocationPolicy,decisions}';
BEGIN
 IF payload#>>'{allocationPolicy,expectedMission24Digest}'IS DISTINCT FROM manifest->>'digest' THEN RAISE EXCEPTION'Mission 24 operating-cost references changed'USING ERRCODE='40001';END IF;
 IF jsonb_array_length(decisions)<>jsonb_array_length(manifest->'references')THEN RAISE EXCEPTION'Mission 24 reconciliation incomplete'USING ERRCODE='22023';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(manifest->'references')LOOP
 SELECT value INTO d FROM jsonb_array_elements(decisions)WHERE value->>'referenceKey'=r->>'referenceKey';
 IF d IS NULL THEN RAISE EXCEPTION'Mission 24 reference unreconciled'USING ERRCODE='22023';END IF;
  IF COALESCE((r->>'overlapResolved')::boolean,FALSE)IS NOT TRUE THEN
   RAISE EXCEPTION'Mission 24 overlap remains unresolved'USING ERRCODE='22023';END IF;
  IF r->>'kind'='equipment_pool'AND r->>'method'='economic_recovery'THEN
   IF d->>'treatment'<>'economic_recovery_not_cash'OR d->'scheduleKey'<>'null'::jsonb THEN RAISE EXCEPTION'Economic recovery is not cash'USING ERRCODE='22023';END IF;
  ELSIF r->>'kind'='equipment_pool'AND r->>'method'='financing_cash'THEN
   IF d->>'treatment'='separate_cash_commitment'THEN SELECT value INTO s FROM jsonb_array_elements(payload->'schedules')WHERE value->>'scheduleKey'=d->>'scheduleKey';
    IF s IS NULL OR s->>'kind'<>'financed_asset_obligation'THEN RAISE EXCEPTION'Exact financed schedule required'USING ERRCODE='22023';END IF;
   ELSIF d->>'treatment'<>'not_same_obligation'OR d->'scheduleKey'<>'null'::jsonb THEN RAISE EXCEPTION'Financing treatment invalid'USING ERRCODE='22023';END IF;
  ELSE
   IF d->>'treatment'='separate_cash_commitment'THEN SELECT value INTO s FROM jsonb_array_elements(payload->'schedules')WHERE value->>'scheduleKey'=d->>'scheduleKey';
    IF s IS NULL OR s->>'kind'<>'overhead_expense'THEN RAISE EXCEPTION'Exact overhead schedule required'USING ERRCODE='22023';END IF;
   ELSIF d->>'treatment'<>'job_overhead_allocation_not_cash'OR d->'scheduleKey'<>'null'::jsonb THEN RAISE EXCEPTION'Overhead treatment invalid'USING ERRCODE='22023';END IF;
  END IF;END LOOP;
 RETURN jsonb_build_object('version','operating-cost-mission24-reconciliation-v1','manifest',manifest,'decisions',decisions,
  'digest',public.canonical_completion_digest(jsonb_build_object('manifest',manifest,'decisions',decisions)));
END $$;

CREATE FUNCTION public.canonical_forecast_overhead_cash_v1_unavailable(reason_value TEXT,cutoff TIMESTAMPTZ,
 zone TEXT,mode_value TEXT,source_revision BIGINT,source_digest TEXT,source_recorded TIMESTAMPTZ)RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE start_day DATE:=(cutoff AT TIME ZONE COALESCE(zone,'UTC'))::date;end_day DATE:=start_day+30;
BEGIN RETURN jsonb_build_object('version','m26-overhead-cash-forecast-v1','state','unavailable','reason',reason_value,
 'fictional',FALSE,'checkedAt',public.canonical_forecast_utc_instant(cutoff),'currency',NULL,
 'basis',jsonb_build_object('mode',mode_value,'cutoff',public.canonical_forecast_utc_instant(cutoff),'sourceRevision',source_revision,
  'sourceDigest',source_digest,'sourceRecordedAt',CASE WHEN source_recorded IS NULL THEN NULL ELSE public.canonical_forecast_utc_instant(source_recorded)END),
 'horizon',jsonb_build_object('kind','local_calendar_days','timeZone',zone,'startsOn',start_day::text,'endsOnExclusive',end_day::text,'days',30),
 'scope',jsonb_build_object('label','Next 30 local calendar dates in the complete owner-recorded schedule source',
  'sourceCoverageVerified',FALSE,'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
 'overhead',jsonb_build_object('state','unavailable','amount',NULL,'dueCount',NULL,'scheduleCount',NULL,'reason',reason_value),
 'financedAssetCash',jsonb_build_object('state','unavailable','amount',NULL,'dueCount',NULL,'obligationCount',NULL,
  'ownerMarkedSatisfiedCount',NULL,'canceledCount',NULL,'reason',reason_value),
 'evidence',jsonb_build_object('ownerRecordedSchedules',FALSE,'exactAmounts',FALSE,'exactDueDates',FALSE,
  'recurrenceEndRecorded',FALSE,'sourceAttested',FALSE,'currentRevision',FALSE,'completeAsOf',FALSE,
  'overlapReconciled',FALSE,'actualPaymentVerified',FALSE,'learnedAdjustmentApplied',FALSE),
 'allocation',jsonb_build_object('state','unavailable','basis','server_reconciled_m24_reference_manifest',
  'jobCostAllocationIncluded',FALSE,'economicDepreciationIncluded',FALSE,'actualPaymentClaimed',FALSE,'reason',reason_value),
 'forecastIssued',FALSE,'completeOperatingCostForecastIssued',FALSE,'calibratedRangeIssued',FALSE,
 'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);END $$;

CREATE FUNCTION public.canonical_forecast_overhead_cash_v1_evaluate(org UUID,cutoff TIMESTAMPTZ,mode_value TEXT,require_current BOOLEAN)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE profile public.canonical_business_profiles%ROWTYPE;source public.canonical_operating_cost_schedule_revisions%ROWTYPE;
 zone TEXT;currency TEXT;start_day DATE;end_day DATE;s JSONB;d JSONB;pin JSONB;manifest JSONB;profile_pin JSONB;
 overhead NUMERIC:=0;financed NUMERIC:=0;amount NUMERIC;overhead_due INTEGER:=0;financed_due INTEGER:=0;
 overhead_schedules INTEGER:=0;obligations INTEGER:=0;satisfied INTEGER:=0;canceled INTEGER:=0;due_day DATE;
BEGIN
 IF mode_value NOT IN('current','as_of')THEN RAISE EXCEPTION'Forecast mode invalid'USING ERRCODE='22023';END IF;
 IF require_current THEN
  PERFORM 1 FROM public.organizations WHERE id=org FOR SHARE;
  LOCK TABLE public.canonical_equipment_cost_plans,public.canonical_pricing_plans IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended('m26:operating-cost-schedules:'||org::text,0));
  SELECT * INTO source FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org ORDER BY revision DESC LIMIT 1;
 ELSE SELECT * INTO source FROM public.canonical_operating_cost_schedule_revisions WHERE organization_id=org AND created_at<=cutoff ORDER BY created_at DESC,revision DESC LIMIT 1;END IF;
 IF source.id IS NULL THEN RETURN public.canonical_forecast_overhead_cash_v1_unavailable('owner_recorded_schedule_coverage_unavailable',cutoff,NULL,mode_value,NULL,NULL,NULL);END IF;
 profile_pin:=source.authority->'profile';zone:=profile_pin->>'timeZone';currency:=profile_pin->>'currency';
 IF zone IS NULL OR currency!~'^[A-Z]{3}$'OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)THEN
  RETURN public.canonical_forecast_overhead_cash_v1_unavailable('reporting_profile_unavailable',cutoff,NULL,mode_value,source.revision,rtrim(source.canonical_digest),source.created_at);END IF;
 start_day:=(cutoff AT TIME ZONE zone)::date;end_day:=start_day+30;
 IF require_current THEN
  SELECT p.* INTO profile FROM public.canonical_business_profiles p JOIN public.organization_onboarding o
   ON o.organization_id=p.organization_id AND o.active_business_profile_id=p.id AND o.status='complete'
   WHERE p.organization_id=org AND p.is_active FOR SHARE OF p,o;
  IF profile.id IS NULL OR profile.id::text IS DISTINCT FROM profile_pin->>'id'OR profile.version_number<>(profile_pin->>'version')::bigint
   OR rtrim(profile.normalized_profile_hash)IS DISTINCT FROM profile_pin->>'digest'OR profile.raw_profile#>>'{company,timeZone}'IS DISTINCT FROM zone
   OR profile.raw_profile#>>'{company,currency}'IS DISTINCT FROM currency THEN
   RETURN public.canonical_forecast_overhead_cash_v1_unavailable('schedule_source_currentness_unavailable',cutoff,zone,mode_value,source.revision,rtrim(source.canonical_digest),source.created_at);END IF;
  FOR pin IN SELECT value FROM jsonb_array_elements(source.authority->'assets')ORDER BY value->>'id'LOOP
   PERFORM 1 FROM public.tenant_assets a WHERE a.organization_id=org AND a.id=(pin->>'id')::uuid
    AND a.version=(pin->>'version')::integer AND a.catalogue_state='active'AND a.catalogue_state=pin->>'catalogueState'FOR SHARE;
   IF NOT FOUND THEN RETURN public.canonical_forecast_overhead_cash_v1_unavailable('schedule_source_currentness_unavailable',cutoff,zone,mode_value,source.revision,rtrim(source.canonical_digest),source.created_at);END IF;END LOOP;
  manifest:=public.canonical_operating_cost_mission24_manifest(org);
  IF manifest->>'digest'IS DISTINCT FROM source.authority#>>'{mission24,manifest,digest}'THEN
   RETURN public.canonical_forecast_overhead_cash_v1_unavailable('schedule_source_currentness_unavailable',cutoff,zone,mode_value,source.revision,rtrim(source.canonical_digest),source.created_at);END IF;
 END IF;
 IF source.action<>'replace'THEN RETURN public.canonical_forecast_overhead_cash_v1_unavailable('owner_recorded_schedule_coverage_unavailable',cutoff,zone,mode_value,source.revision,rtrim(source.canonical_digest),source.created_at);END IF;
 IF source.payload->>'currency'IS DISTINCT FROM currency THEN RETURN public.canonical_forecast_overhead_cash_v1_unavailable('schedule_currency_conflict',cutoff,zone,mode_value,source.revision,rtrim(source.canonical_digest),source.created_at);END IF;
 IF source.payload#>>'{coverage,complete}'<>'true'OR(source.payload#>>'{coverage,startsOn}')::date>start_day
 OR(source.payload#>>'{coverage,endsOn}')::date<end_day-1 OR(source.payload#>>'{coverage,recordedThrough}')::timestamptz>source.created_at
 OR((source.payload#>>'{coverage,recordedThrough}')::timestamptz AT TIME ZONE zone)::date<start_day
 OR source.authority#>>'{mission24,version}'<>'operating-cost-mission24-reconciliation-v1'
 OR source.authority#>>'{mission24,digest}'IS NULL THEN RETURN public.canonical_forecast_overhead_cash_v1_unavailable('owner_recorded_schedule_coverage_stale',cutoff,zone,mode_value,source.revision,rtrim(source.canonical_digest),source.created_at);END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(source.payload->'schedules')LOOP
  amount:=round((s->>'amount')::numeric*100);IF s->>'kind'='overhead_expense'THEN overhead_schedules:=overhead_schedules+1;ELSE obligations:=obligations+1;END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(s->'dueDates')LOOP due_day:=(d->>'dueOn')::date;
   IF due_day>=start_day AND due_day<end_day THEN
    IF d->>'paymentStatus'='scheduled'THEN IF s->>'kind'='overhead_expense'THEN overhead:=overhead+amount;overhead_due:=overhead_due+1;
     ELSE financed:=financed+amount;financed_due:=financed_due+1;END IF;
    ELSIF s->>'kind'='financed_asset_obligation'AND d->>'paymentStatus'='owner_marked_satisfied'THEN satisfied:=satisfied+1;
    ELSIF s->>'kind'='financed_asset_obligation'AND d->>'paymentStatus'='canceled'THEN canceled:=canceled+1;END IF;END IF;END LOOP;END LOOP;
 RETURN jsonb_build_object('version','m26-overhead-cash-forecast-v1','state','current','reason',NULL,'fictional',FALSE,
  'checkedAt',public.canonical_forecast_utc_instant(cutoff),'currency',currency,'basis',jsonb_build_object('mode',mode_value,
   'cutoff',public.canonical_forecast_utc_instant(cutoff),'sourceRevision',source.revision,'sourceDigest',rtrim(source.canonical_digest),'sourceRecordedAt',public.canonical_forecast_utc_instant(source.created_at)),
  'horizon',jsonb_build_object('kind','local_calendar_days','timeZone',zone,'startsOn',start_day::text,'endsOnExclusive',end_day::text,'days',30),
  'scope',jsonb_build_object('label','Next 30 local calendar dates in the complete owner-recorded schedule source','sourceCoverageVerified',TRUE,'wholeBusinessCoverageVerified',FALSE,'offPlatformCoverageVerified',FALSE),
  'overhead',jsonb_build_object('state','current','amount',public.canonical_pricing_decimal(overhead),'dueCount',overhead_due,'scheduleCount',overhead_schedules,'reason',NULL),
  'financedAssetCash',jsonb_build_object('state','current','amount',public.canonical_pricing_decimal(financed),'dueCount',financed_due,'obligationCount',obligations,'ownerMarkedSatisfiedCount',satisfied,'canceledCount',canceled,'reason',NULL),
  'evidence',jsonb_build_object('ownerRecordedSchedules',TRUE,'exactAmounts',TRUE,'exactDueDates',TRUE,'recurrenceEndRecorded',TRUE,'sourceAttested',TRUE,'currentRevision',require_current,'completeAsOf',TRUE,'overlapReconciled',TRUE,'actualPaymentVerified',FALSE,'learnedAdjustmentApplied',FALSE),
  'allocation',jsonb_build_object('state','reconciled','basis','server_reconciled_m24_reference_manifest','jobCostAllocationIncluded',FALSE,'economicDepreciationIncluded',FALSE,'actualPaymentClaimed',FALSE,'reason','dated_cash_commitments_kept_separate_from_bound_m24_job_cost_and_economic_recovery'),
  'forecastIssued',TRUE,'completeOperatingCostForecastIssued',FALSE,'calibratedRangeIssued',FALSE,'probabilityIssued',FALSE,'automaticActionAuthorized',FALSE);
END $$;

CREATE FUNCTION public.canonical_forecast_overhead_cash_v1_current(org UUID,actor UUID,role_value TEXT,session_value UUID)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;cutoff TIMESTAMPTZ;result JSONB;BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION'Read committed required'USING ERRCODE='25001';END IF;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);cutoff:=public.canonical_forecast_workload_capacity_v1_clock();
 result:=public.canonical_forecast_overhead_cash_v1_evaluate(org,cutoff,'current',TRUE);
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);RETURN result;END $$;

CREATE FUNCTION public.canonical_forecast_overhead_cash_v1_as_of(org UUID,actor UUID,role_value TEXT,session_value UUID,cutoff TIMESTAMPTZ)RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB;result JSONB;BEGIN
 IF current_setting('transaction_isolation')<>'read committed'OR cutoff IS NULL OR cutoff>public.canonical_forecast_workload_capacity_v1_clock()
 THEN RAISE EXCEPTION'Historical cutoff invalid'USING ERRCODE='22023';END IF;
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);
 result:=public.canonical_forecast_overhead_cash_v1_evaluate(org,cutoff,'as_of',FALSE);
 auth:=public.canonical_forecast_booking_ordered_access(org,actor,role_value,session_value,NULL,FALSE);RETURN result;END $$;

REVOKE ALL ON TABLE public.canonical_operating_cost_schedule_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_schedule_immutable()FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_mission24_manifest(UUID)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_snapshot_valid(JSONB)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_reconcile(UUID,JSONB,JSONB)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_snapshot_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,JSONB)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_reference_basis_read(UUID,UUID,TEXT,UUID)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_source_projection(public.canonical_operating_cost_schedule_revisions)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_snapshot_read(UUID,UUID,TEXT,UUID)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_operating_cost_snapshot_read_as_of(UUID,UUID,TEXT,UUID,TIMESTAMPTZ)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_overhead_cash_v1_unavailable(TEXT,TIMESTAMPTZ,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_overhead_cash_v1_evaluate(UUID,TIMESTAMPTZ,TEXT,BOOLEAN)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_overhead_cash_v1_current(UUID,UUID,TEXT,UUID)FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_forecast_overhead_cash_v1_as_of(UUID,UUID,TEXT,UUID,TIMESTAMPTZ)FROM PUBLIC;
DO $$DECLARE runtime_role TEXT:=current_setting('northstar.runtime_role',TRUE);BEGIN IF runtime_role IS NOT NULL AND runtime_role<>''THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_operating_cost_snapshot_mutate(uuid,uuid,text,uuid,text,text,jsonb) TO %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_operating_cost_reference_basis_read(uuid,uuid,text,uuid) TO %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_operating_cost_snapshot_read(uuid,uuid,text,uuid) TO %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_operating_cost_snapshot_read_as_of(uuid,uuid,text,uuid,timestamptz) TO %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_overhead_cash_v1_current(uuid,uuid,text,uuid) TO %I',runtime_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.canonical_forecast_overhead_cash_v1_as_of(uuid,uuid,text,uuid,timestamptz) TO %I',runtime_role);
END IF;END $$;
