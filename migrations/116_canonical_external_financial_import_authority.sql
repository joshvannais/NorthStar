-- Mission 25 Part 12D: provider-neutral, tenant-private financial evidence.
-- This stages normalized evidence only. It does not call providers, reconcile opaque references,
-- calculate an outcome, or change customers, leads, jobs, appointments, estimates, invoices,
-- payments, dispatch, schedules, costs, provider state or company policy.
-- Every external ID/reference is the exact shared ref_<64 lowercase hex> representation of a
-- source-scoped, non-reversible adapter token. Import cursors use cur_<64 lowercase hex>.
-- Raw provider identifiers, contact details, names and message-like content fail closed.
-- This evidence is not a native invoice, payment, collection or accounting record. Native
-- NorthStar billing and accounting records remain unavailable until Mission 27.

CREATE TABLE public.canonical_external_financial_import_consents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id),
 source_key TEXT NOT NULL CHECK(source_key~'^[a-z0-9][a-z0-9._-]{1,63}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 previous_id UUID, action TEXT NOT NULL CHECK(action IN ('grant','revoke')), actor_user_id UUID NOT NULL,
 membership_id UUID NOT NULL, auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id),
 source_scope JSONB NOT NULL CHECK(source_scope='["external_financial_normalized_v1"]'::jsonb),
 consent_version TEXT NOT NULL CHECK(consent_version='m25-external-financial-import-consent-v1'), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'), request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'),
 canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_key,revision), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,source_key,previous_id) REFERENCES public.canonical_external_financial_import_consents(organization_id,source_key,id)
);

CREATE TABLE public.canonical_external_financial_import_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id), source_key TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('historical_backfill','continuous_update')), sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000), previous_run_id UUID,
 consent_id UUID NOT NULL, consent_revision BIGINT NOT NULL, consent_digest TEXT NOT NULL CHECK(consent_digest~'^[0-9a-f]{64}$'),
 schema_version TEXT NOT NULL CHECK(schema_version='m25-external-financial-evidence-v1'),
 cursor_before TEXT CHECK(cursor_before IS NULL OR cursor_before~'^cur_[0-9a-f]{64}$'),
 cursor_after TEXT CHECK(cursor_after IS NULL OR cursor_after~'^cur_[0-9a-f]{64}$'), complete BOOLEAN NOT NULL,
 record_count INTEGER NOT NULL CHECK(record_count BETWEEN 1 AND 100), inserted_count INTEGER NOT NULL, corrected_count INTEGER NOT NULL,
 duplicate_count INTEGER NOT NULL, tombstoned_count INTEGER NOT NULL, actor_user_id UUID NOT NULL, membership_id UUID NOT NULL,
 auth_session_id UUID NOT NULL REFERENCES public.auth_sessions(id), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000), confirmed BOOLEAN NOT NULL CHECK(confirmed),
 confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-external-financial-import-batch-v1'), request_key_hash TEXT NOT NULL CHECK(request_key_hash~'^[0-9a-f]{64}$'),
 request_digest TEXT NOT NULL CHECK(request_digest~'^[0-9a-f]{64}$'), canonical_digest TEXT NOT NULL CHECK(canonical_digest~'^[0-9a-f]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_key,mode,sequence), UNIQUE(organization_id,actor_user_id,request_key_hash), UNIQUE(organization_id,source_key,id), UNIQUE(organization_id,source_key,consent_id,id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES public.organization_memberships(organization_id,id),
 FOREIGN KEY(organization_id,source_key,consent_id) REFERENCES public.canonical_external_financial_import_consents(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,previous_run_id) REFERENCES public.canonical_external_financial_import_runs(organization_id,source_key,id),
 CHECK(inserted_count>=0 AND corrected_count>=0 AND duplicate_count>=0 AND tombstoned_count>=0
  AND inserted_count+corrected_count+duplicate_count+tombstoned_count=record_count),
 CHECK((mode='continuous_update' AND complete=FALSE AND cursor_after IS NOT NULL) OR (mode='historical_backfill' AND ((complete AND cursor_after IS NULL) OR (NOT complete AND cursor_after IS NOT NULL))))
);
CREATE INDEX canonical_external_financial_run_period_idx ON public.canonical_external_financial_import_runs(organization_id,source_key,consent_id,mode,sequence DESC);

-- Freeze the PostgreSQL 17 time-zone catalog available when this unreleased authority is
-- installed. The guarded import checks the same catalog, and the foreign key below prevents
-- migration-owner/direct-table writes from bypassing that validation.
CREATE TABLE public.canonical_external_financial_time_zones (
 name TEXT PRIMARY KEY CHECK(name~'^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$')
);
INSERT INTO public.canonical_external_financial_time_zones(name)
SELECT DISTINCT name FROM pg_catalog.pg_timezone_names
WHERE name~'^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$';

CREATE TABLE public.canonical_external_financial_import_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES public.organizations(id), source_key TEXT NOT NULL,
 external_record_id TEXT NOT NULL CHECK(external_record_id~'^ref_[0-9a-f]{64}$'), revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),
 previous_id UUID, consent_id UUID NOT NULL, external_version BIGINT NOT NULL CHECK(external_version BETWEEN 1 AND 1000000000), state TEXT NOT NULL CHECK(state IN ('active','tombstone')),
 record_type TEXT, customer_reference TEXT, job_reference TEXT, estimate_reference TEXT, execution_reference TEXT,
 project_reference TEXT, change_order_reference TEXT, invoice_reference TEXT, payment_reference TEXT,
 collection_reference TEXT, accounting_reference TEXT, record_state TEXT, amount_claim JSONB,
 occurred_at TIMESTAMPTZ, time_zone TEXT,
 evidence_class TEXT, provider_evidence_digest TEXT, source_updated_at TIMESTAMPTZ NOT NULL,
 source_digest TEXT NOT NULL CHECK(source_digest~'^[0-9a-f]{64}$'), import_run_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,source_key,consent_id,external_record_id,revision), UNIQUE(organization_id,source_key,consent_id,external_record_id,external_version),
 UNIQUE(organization_id,source_key,id), UNIQUE(organization_id,source_key,consent_id,id),
 FOREIGN KEY(organization_id,source_key,consent_id,previous_id) REFERENCES public.canonical_external_financial_import_records(organization_id,source_key,consent_id,id),
 FOREIGN KEY(organization_id,source_key,consent_id) REFERENCES public.canonical_external_financial_import_consents(organization_id,source_key,id),
 FOREIGN KEY(organization_id,source_key,consent_id,import_run_id) REFERENCES public.canonical_external_financial_import_runs(organization_id,source_key,consent_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(time_zone) REFERENCES public.canonical_external_financial_time_zones(name),
 CHECK((state='tombstone' AND record_type IS NULL AND customer_reference IS NULL AND job_reference IS NULL
  AND estimate_reference IS NULL AND execution_reference IS NULL AND project_reference IS NULL
  AND change_order_reference IS NULL AND invoice_reference IS NULL AND payment_reference IS NULL
  AND collection_reference IS NULL AND accounting_reference IS NULL AND record_state IS NULL
  AND amount_claim IS NULL AND occurred_at IS NULL AND time_zone IS NULL
  AND evidence_class IS NULL AND provider_evidence_digest IS NULL)
 OR (state='active' AND record_type IS NOT NULL AND record_type IN ('invoice','payment','collection','accounting_entry')
  AND record_state IS NOT NULL AND amount_claim IS NOT NULL
  AND occurred_at IS NOT NULL AND source_updated_at>=occurred_at AND time_zone IS NOT NULL
  AND evidence_class IS NOT NULL AND evidence_class IN ('provider_recorded','documented','owner_confirmed')
  AND provider_evidence_digest IS NOT NULL AND provider_evidence_digest~'^[0-9a-f]{64}$')),
 CHECK((customer_reference IS NULL OR customer_reference~'^ref_[0-9a-f]{64}$')
  AND (job_reference IS NULL OR job_reference~'^ref_[0-9a-f]{64}$')
  AND (estimate_reference IS NULL OR estimate_reference~'^ref_[0-9a-f]{64}$')
  AND (execution_reference IS NULL OR execution_reference~'^ref_[0-9a-f]{64}$')
  AND (project_reference IS NULL OR project_reference~'^ref_[0-9a-f]{64}$')
  AND (change_order_reference IS NULL OR change_order_reference~'^ref_[0-9a-f]{64}$')
  AND (invoice_reference IS NULL OR invoice_reference~'^ref_[0-9a-f]{64}$')
  AND (payment_reference IS NULL OR payment_reference~'^ref_[0-9a-f]{64}$')
  AND (collection_reference IS NULL OR collection_reference~'^ref_[0-9a-f]{64}$')
  AND (accounting_reference IS NULL OR accounting_reference~'^ref_[0-9a-f]{64}$')),
 CHECK(state='tombstone' OR
  (record_type='invoice' AND invoice_reference IS NOT NULL AND payment_reference IS NULL
   AND collection_reference IS NULL AND accounting_reference IS NULL
   AND record_state IN ('draft','issued','partially_paid','paid','overdue','voided','written_off','unknown')) OR
  (record_type='payment' AND payment_reference IS NOT NULL AND collection_reference IS NULL
   AND accounting_reference IS NULL
   AND record_state IN ('pending','authorized','succeeded','failed','refunded','partially_refunded','canceled','unknown')) OR
  (record_type='collection' AND collection_reference IS NOT NULL AND accounting_reference IS NULL
   AND record_state IN ('open','in_progress','promised','settled','closed','failed','written_off','unknown')) OR
  (record_type='accounting_entry' AND accounting_reference IS NOT NULL AND collection_reference IS NULL
   AND record_state IN ('draft','posted','reversed','voided','unknown'))),
 CHECK(state='tombstone' OR (amount_claim IS NOT NULL AND jsonb_typeof(amount_claim)='object'
  AND amount_claim?&ARRAY['status','amount','currency','basis']
  AND amount_claim-ARRAY['status','amount','currency','basis']='{}'::jsonb
  AND jsonb_typeof(amount_claim->'status')='string' AND (
   (amount_claim->>'status'='unavailable' AND amount_claim->'amount'='null'::jsonb
    AND amount_claim->'currency'='null'::jsonb AND amount_claim->'basis'='null'::jsonb) OR
   (amount_claim->>'status'='recorded' AND jsonb_typeof(amount_claim->'amount')='string'
    AND amount_claim->>'amount'~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
    AND jsonb_typeof(amount_claim->'currency')='string' AND amount_claim->>'currency'~'^[A-Z]{3}$'
    AND jsonb_typeof(amount_claim->'basis')='string' AND (
     (record_type='invoice' AND amount_claim->>'basis' IN ('invoice_total','invoice_balance')) OR
     (record_type='payment' AND amount_claim->>'basis' IN ('payment_received','refund_issued')) OR
     (record_type='collection' AND amount_claim->>'basis' IN ('amount_collected','outstanding_balance','write_off')) OR
     (record_type='accounting_entry' AND amount_claim->>'basis' IN ('revenue','direct_cost','overhead_cost','other_income','other_cost','unknown')))))))
);

CREATE FUNCTION public.canonical_external_financial_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Financial evidence history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER canonical_external_financial_consent_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_financial_import_consents FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_financial_immutable();
CREATE TRIGGER canonical_external_financial_run_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_financial_import_runs FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_financial_immutable();
CREATE TRIGGER canonical_external_financial_record_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_financial_import_records FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_financial_immutable();
CREATE TRIGGER canonical_external_financial_time_zone_immutable BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.canonical_external_financial_time_zones FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_external_financial_immutable();

CREATE FUNCTION public.canonical_external_financial_consent_projection(v public.canonical_external_financial_import_consents) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',v.id,'sourceKey',v.source_key,'revision',v.revision,'previousId',v.previous_id,'action',v.action,'sourceScope',v.source_scope,'consentVersion',v.consent_version,'reason',v.reason,'digest',rtrim(v.canonical_digest),'createdAt',v.created_at) $$;
CREATE FUNCTION public.canonical_external_financial_run_projection(v public.canonical_external_financial_import_runs) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',v.id,'sourceKey',v.source_key,'mode',v.mode,'sequence',v.sequence,'previousRunId',v.previous_run_id,'consentId',v.consent_id,'consentRevision',v.consent_revision,'consentDigest',rtrim(v.consent_digest),'schemaVersion',v.schema_version,'cursorBefore',v.cursor_before,'cursorAfter',v.cursor_after,'complete',v.complete,'recordCount',v.record_count,'insertedCount',v.inserted_count,'correctedCount',v.corrected_count,'duplicateCount',v.duplicate_count,'tombstonedCount',v.tombstoned_count,'digest',rtrim(v.canonical_digest),'createdAt',v.created_at) $$;
CREATE FUNCTION public.canonical_external_financial_record_projection(v public.canonical_external_financial_import_records) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',v.id,'externalRecordId',v.external_record_id,'revision',v.revision,'previousId',v.previous_id,'consentId',v.consent_id,
  'externalVersion',v.external_version,'state',v.state,'recordType',v.record_type,'customerReference',v.customer_reference,
  'jobReference',v.job_reference,'estimateReference',v.estimate_reference,'executionReference',v.execution_reference,
  'projectReference',v.project_reference,'changeOrderReference',v.change_order_reference,'invoiceReference',v.invoice_reference,
  'paymentReference',v.payment_reference,'collectionReference',v.collection_reference,'accountingReference',v.accounting_reference,
  'recordState',v.record_state,'amountClaim',v.amount_claim,'occurredAt',v.occurred_at,
  'timeZone',v.time_zone,'evidenceClass',v.evidence_class,'reconciliationStatus',CASE WHEN v.state='active' THEN 'unmatched' ELSE 'unavailable' END,
  'providerEvidenceDigest',v.provider_evidence_digest,'sourceUpdatedAt',v.source_updated_at,'sourceDigest',rtrim(v.source_digest),
  'importRunId',v.import_run_id,'createdAt',v.created_at) $$;

CREATE FUNCTION public.canonical_external_financial_import_consent_read(org UUID,actor UUID,role_value TEXT,session_value UUID,source_value TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_row public.canonical_external_financial_import_consents%ROWTYPE; history JSONB; total BIGINT;
BEGIN IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External financial evidence restricted' USING ERRCODE='42501'; END IF;
 PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External financial source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO current_row FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 SELECT count(*) INTO total FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value;
 SELECT COALESCE(jsonb_agg(public.canonical_external_financial_consent_projection(x) ORDER BY revision DESC),'[]'::jsonb) INTO history FROM (SELECT * FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 20)x;
 RETURN jsonb_build_object('sourceKey',source_value,'current',CASE WHEN current_row.id IS NULL THEN NULL ELSE public.canonical_external_financial_consent_projection(current_row) END,'history',history,'total',total,'truncated',total>20); END $$;

CREATE FUNCTION public.canonical_external_financial_import_consent_mutate(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; current_row public.canonical_external_financial_import_consents%ROWTYPE; replay public.canonical_external_financial_import_consents%ROWTYPE; inserted public.canonical_external_financial_import_consents%ROWTYPE; key_hash TEXT; request_hash TEXT; digest_value TEXT; next_revision BIGINT;
BEGIN IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External financial evidence restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>8192
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['action','expectedRevision','expectedDigest','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR body->>'action' IS NULL OR body->>'action' NOT IN ('grant','revoke')
  OR jsonb_typeof(body->'expectedRevision') IS DISTINCT FROM 'number' OR (body->>'expectedRevision')!~'^(0|[1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedDigest') IS DISTINCT FROM 'string' OR body->>'expectedDigest'!~'^(none|[0-9a-f]{64})$' OR (((body->>'expectedRevision')::bigint=0)<>(body->>'expectedDigest'='none'))
  OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(body->'confirmationVersion') IS DISTINCT FROM 'string' OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-financial-import-consent-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE THEN RAISE EXCEPTION 'External financial consent invalid' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-financial-import:'||source_value,0));
 SELECT * INTO current_row FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 SELECT * INTO replay FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Financial consent key conflict' USING ERRCODE='23505'; END IF;
  IF current_row.id IS DISTINCT FROM replay.id THEN RAISE EXCEPTION 'Financial consent changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_consent_replay'; END IF;
  RETURN jsonb_build_object('consent',public.canonical_external_financial_consent_projection(replay),'replayed',TRUE);
 END IF;
 IF (body->>'expectedRevision')::bigint<>COALESCE(current_row.revision,0) OR body->>'expectedDigest' IS DISTINCT FROM COALESCE(rtrim(current_row.canonical_digest),'none') THEN RAISE EXCEPTION 'Financial consent changed' USING ERRCODE='40001'; END IF;
 IF body->>'action'='revoke' AND (current_row.id IS NULL OR current_row.action<>'grant') OR body->>'action'='grant' AND current_row.action='grant' THEN RAISE EXCEPTION 'Financial consent action invalid' USING ERRCODE='22023'; END IF;
next_revision:=COALESCE(current_row.revision,0)+1;digest_value:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'revision',next_revision,'previousId',current_row.id,'action',body->>'action','actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'sourceScope','["external_financial_normalized_v1"]'::jsonb,'consentVersion','m25-external-financial-import-consent-v1','reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_financial_import_consents(organization_id,source_key,revision,previous_id,action,actor_user_id,membership_id,auth_session_id,source_scope,consent_version,reason,request_key_hash,request_digest,canonical_digest)
 VALUES(org,source_value,next_revision,current_row.id,body->>'action',actor,(authority->>'membershipId')::uuid,session_value,'["external_financial_normalized_v1"]'::jsonb,'m25-external-financial-import-consent-v1',body->>'reason',key_hash,request_hash,digest_value) RETURNING * INTO inserted;
 RETURN jsonb_build_object('consent',public.canonical_external_financial_consent_projection(inserted),'replayed',FALSE); END $$;

CREATE FUNCTION public.canonical_external_financial_import_batch(org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,key_value TEXT,source_value TEXT,body JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; consent_row public.canonical_external_financial_import_consents%ROWTYPE; previous_run public.canonical_external_financial_import_runs%ROWTYPE; replay public.canonical_external_financial_import_runs%ROWTYPE; inserted_run public.canonical_external_financial_import_runs%ROWTYPE; existing public.canonical_external_financial_import_records%ROWTYPE; current_row public.canonical_external_financial_import_records%ROWTYPE;
 item JSONB; key_hash TEXT; request_hash TEXT; source_hash TEXT; run_hash TEXT; run_id UUID:=gen_random_uuid(); next_sequence BIGINT; next_revision BIGINT; record_count INTEGER; inserted_count INTEGER:=0; corrected_count INTEGER:=0; duplicate_count INTEGER:=0; tombstoned_count INTEGER:=0; occurred TIMESTAMPTZ; updated TIMESTAMPTZ; state_value TEXT; external_id TEXT; external_version_value BIGINT;
BEGIN IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable required' USING ERRCODE='25001'; END IF;
 IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External financial evidence restricted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=org FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE='42501'; END IF;
 authority:=public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,csrf,TRUE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' OR key_value IS NULL OR key_value!~'^[A-Za-z0-9._:-]{16,128}$' OR octet_length(body::text)>524288
  OR public.canonical_field_evidence_object_keys_exact(body,ARRAY['schemaVersion','mode','expectedConsentRevision','expectedConsentDigest','cursorBefore','cursorAfter','complete','records','reason','confirmed','confirmationVersion']) IS NOT TRUE
  OR jsonb_typeof(body->'schemaVersion') IS DISTINCT FROM 'string' OR body->>'schemaVersion' IS DISTINCT FROM 'm25-external-financial-evidence-v1'
  OR jsonb_typeof(body->'mode') IS DISTINCT FROM 'string' OR body->>'mode' IS NULL OR body->>'mode' NOT IN ('historical_backfill','continuous_update')
  OR jsonb_typeof(body->'expectedConsentRevision') IS DISTINCT FROM 'number' OR (body->>'expectedConsentRevision')!~'^([1-9][0-9]{0,3}|10000)$'
  OR jsonb_typeof(body->'expectedConsentDigest') IS DISTINCT FROM 'string' OR body->>'expectedConsentDigest'!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(body->'complete') IS DISTINCT FROM 'boolean' OR jsonb_typeof(body->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'records') NOT BETWEEN 1 AND 100 OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_typeof(body->'confirmationVersion') IS DISTINCT FROM 'string' OR body->>'confirmationVersion' IS DISTINCT FROM 'm25-external-financial-import-batch-v1'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR public.canonical_learning_text_valid(body->>'reason',2000) IS NOT TRUE
  OR (body->'cursorBefore'<>'null'::jsonb AND (jsonb_typeof(body->'cursorBefore')<>'string' OR body->>'cursorBefore'!~'^cur_[0-9a-f]{64}$'))
  OR (body->'cursorAfter'<>'null'::jsonb AND (jsonb_typeof(body->'cursorAfter')<>'string' OR body->>'cursorAfter'!~'^cur_[0-9a-f]{64}$'))
  OR (body->>'mode'='continuous_update' AND ((body->>'complete')::boolean OR body->'cursorAfter'='null'::jsonb))
  OR (body->>'mode'='historical_backfill' AND (((body->>'complete')::boolean AND body->'cursorAfter'<>'null'::jsonb) OR (NOT (body->>'complete')::boolean AND body->'cursorAfter'='null'::jsonb))) THEN RAISE EXCEPTION 'External financial batch invalid' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM (SELECT x->>'externalRecordId' FROM jsonb_array_elements(body->'records')x GROUP BY x->>'externalRecordId')u)<>jsonb_array_length(body->'records') THEN RAISE EXCEPTION 'Duplicate financial identity' USING ERRCODE='22023'; END IF;
 key_hash:=encode(sha256(convert_to(key_value,'UTF8')),'hex');request_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'actorUserId',actor,'sourceKey',source_value,'body',body));
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':external-financial-import:'||source_value,0));
 SELECT * INTO consent_row FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 SELECT * INTO replay FROM public.canonical_external_financial_import_runs WHERE organization_id=org AND actor_user_id=actor AND request_key_hash=key_hash;
 IF FOUND THEN
  IF rtrim(replay.request_digest)<>request_hash THEN RAISE EXCEPTION 'Financial batch key conflict' USING ERRCODE='23505'; END IF;
  IF consent_row.id IS NULL OR consent_row.action IS DISTINCT FROM 'grant' OR replay.consent_id IS DISTINCT FROM consent_row.id OR replay.consent_revision IS DISTINCT FROM consent_row.revision OR rtrim(replay.consent_digest) IS DISTINCT FROM rtrim(consent_row.canonical_digest) THEN RAISE EXCEPTION 'Financial consent changed' USING ERRCODE='40001',CONSTRAINT='external_business_retired_import_replay'; END IF;
  RETURN jsonb_build_object('run',public.canonical_external_financial_run_projection(replay),'replayed',TRUE);
 END IF;
 IF consent_row.id IS NULL OR consent_row.action IS DISTINCT FROM 'grant' OR consent_row.revision IS DISTINCT FROM (body->>'expectedConsentRevision')::bigint OR rtrim(consent_row.canonical_digest) IS DISTINCT FROM body->>'expectedConsentDigest' THEN RAISE EXCEPTION 'Financial consent changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(
  SELECT 1 FROM (
   SELECT DISTINCT item_value->>'timeZone' AS name
   FROM jsonb_array_elements(body->'records') AS record(item_value)
   WHERE item_value->>'state'='active'
  ) requested_zone
  LEFT JOIN pg_catalog.pg_timezone_names known_zone ON known_zone.name=requested_zone.name
  WHERE requested_zone.name IS NULL OR known_zone.name IS NULL
 ) THEN RAISE EXCEPTION 'External financial time zone invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous_run FROM public.canonical_external_financial_import_runs WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id AND mode=body->>'mode' ORDER BY sequence DESC LIMIT 1 FOR UPDATE;
 IF previous_run.id IS NULL AND body->'cursorBefore'<>'null'::jsonb OR previous_run.id IS NOT NULL AND previous_run.cursor_after IS DISTINCT FROM body->>'cursorBefore' THEN RAISE EXCEPTION 'Financial cursor changed' USING ERRCODE='40001'; END IF;
 IF previous_run.mode='historical_backfill' AND previous_run.complete THEN RAISE EXCEPTION 'Financial backfill complete' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.canonical_external_financial_import_runs WHERE organization_id=org AND source_key=source_value AND mode=body->>'mode';record_count:=jsonb_array_length(body->'records');
 FOR item IN SELECT value FROM jsonb_array_elements(body->'records') LOOP
  IF public.canonical_field_evidence_object_keys_exact(item,ARRAY['externalRecordId','externalVersion','state','recordType','customerReference','jobReference','estimateReference','executionReference','projectReference','changeOrderReference','invoiceReference','paymentReference','collectionReference','accountingReference','recordState','amountClaim','occurredAt','timeZone','evidenceClass','providerEvidenceDigest','sourceUpdatedAt']) IS NOT TRUE
   OR jsonb_typeof(item->'externalRecordId') IS DISTINCT FROM 'string' OR item->>'externalRecordId'!~'^ref_[0-9a-f]{64}$'
   OR jsonb_typeof(item->'externalVersion') IS DISTINCT FROM 'number' OR (item->>'externalVersion')!~'^([1-9][0-9]{0,8}|1000000000)$'
   OR jsonb_typeof(item->'state') IS DISTINCT FROM 'string' OR item->>'state' IS NULL OR item->>'state' NOT IN ('active','tombstone')
   OR jsonb_typeof(item->'sourceUpdatedAt') IS DISTINCT FROM 'string' OR item->>'sourceUpdatedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR NOT pg_input_is_valid(item->>'sourceUpdatedAt','timestamp with time zone') THEN RAISE EXCEPTION 'External financial record invalid' USING ERRCODE='22023'; END IF;
  external_id:=item->>'externalRecordId';external_version_value:=(item->>'externalVersion')::bigint;state_value:=item->>'state';updated:=(item->>'sourceUpdatedAt')::timestamptz;
  IF updated>clock_timestamp()+INTERVAL '5 minutes' THEN RAISE EXCEPTION 'Financial source time invalid' USING ERRCODE='22023'; END IF;
  IF state_value='tombstone' THEN
   IF EXISTS(SELECT 1 FROM jsonb_each(item) p WHERE p.key NOT IN ('externalRecordId','externalVersion','state','sourceUpdatedAt') AND p.value<>'null'::jsonb) THEN RAISE EXCEPTION 'Financial tombstone retained details' USING ERRCODE='22023'; END IF; occurred:=NULL;
  ELSE
   IF jsonb_typeof(item->'recordType') IS DISTINCT FROM 'string' OR item->>'recordType' NOT IN ('invoice','payment','collection','accounting_entry')
    OR EXISTS(SELECT 1 FROM jsonb_each(item) p WHERE p.key IN ('customerReference','jobReference','estimateReference','executionReference','projectReference','changeOrderReference','invoiceReference','paymentReference','collectionReference','accountingReference') AND NOT(p.value='null'::jsonb OR (jsonb_typeof(p.value)='string' AND (p.value#>>'{}')~'^ref_[0-9a-f]{64}$')))
    OR jsonb_typeof(item->'recordState') IS DISTINCT FROM 'string'
    OR item->>'occurredAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR NOT pg_input_is_valid(item->>'occurredAt','timestamp with time zone')
    OR jsonb_typeof(item->'timeZone') IS DISTINCT FROM 'string' OR item->>'timeZone'!~'^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'
    OR jsonb_typeof(item->'evidenceClass') IS DISTINCT FROM 'string' OR item->>'evidenceClass' NOT IN ('provider_recorded','documented','owner_confirmed')
    OR jsonb_typeof(item->'providerEvidenceDigest') IS DISTINCT FROM 'string' OR item->>'providerEvidenceDigest'!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'External financial record invalid' USING ERRCODE='22023'; END IF;
   occurred:=(item->>'occurredAt')::timestamptz;
   IF occurred>updated THEN RAISE EXCEPTION 'Financial event time invalid' USING ERRCODE='22023'; END IF;
   IF (item->>'recordType'='invoice' AND (item->'invoiceReference'='null'::jsonb OR item->'paymentReference'<>'null'::jsonb OR item->'collectionReference'<>'null'::jsonb OR item->'accountingReference'<>'null'::jsonb OR item->>'recordState' NOT IN ('draft','issued','partially_paid','paid','overdue','voided','written_off','unknown')))
    OR (item->>'recordType'='payment' AND (item->'paymentReference'='null'::jsonb OR item->'collectionReference'<>'null'::jsonb OR item->'accountingReference'<>'null'::jsonb OR item->>'recordState' NOT IN ('pending','authorized','succeeded','failed','refunded','partially_refunded','canceled','unknown')))
    OR (item->>'recordType'='collection' AND (item->'collectionReference'='null'::jsonb OR item->'accountingReference'<>'null'::jsonb OR item->>'recordState' NOT IN ('open','in_progress','promised','settled','closed','failed','written_off','unknown')))
    OR (item->>'recordType'='accounting_entry' AND (item->'accountingReference'='null'::jsonb OR item->'collectionReference'<>'null'::jsonb OR item->>'recordState' NOT IN ('draft','posted','reversed','voided','unknown'))) THEN RAISE EXCEPTION 'Financial references do not match record type' USING ERRCODE='22023'; END IF;
   IF item->'amountClaim'='null'::jsonb OR jsonb_typeof(item->'amountClaim')<>'object'
    OR public.canonical_field_evidence_object_keys_exact(item->'amountClaim',ARRAY['status','amount','currency','basis']) IS NOT TRUE
    OR jsonb_typeof(item->'amountClaim'->'status')<>'string' OR item->'amountClaim'->>'status' NOT IN ('recorded','unavailable')
    OR (item->'amountClaim'->>'status'='unavailable' AND (item->'amountClaim'->'amount'<>'null'::jsonb OR item->'amountClaim'->'currency'<>'null'::jsonb OR item->'amountClaim'->'basis'<>'null'::jsonb))
    OR (item->'amountClaim'->>'status'='recorded' AND (jsonb_typeof(item->'amountClaim'->'amount')<>'string' OR item->'amountClaim'->>'amount'!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
     OR jsonb_typeof(item->'amountClaim'->'currency')<>'string' OR item->'amountClaim'->>'currency'!~'^[A-Z]{3}$' OR jsonb_typeof(item->'amountClaim'->'basis')<>'string'
     OR (item->>'recordType'='invoice' AND item->'amountClaim'->>'basis' NOT IN ('invoice_total','invoice_balance'))
     OR (item->>'recordType'='payment' AND item->'amountClaim'->>'basis' NOT IN ('payment_received','refund_issued'))
     OR (item->>'recordType'='collection' AND item->'amountClaim'->>'basis' NOT IN ('amount_collected','outstanding_balance','write_off'))
     OR (item->>'recordType'='accounting_entry' AND item->'amountClaim'->>'basis' NOT IN ('revenue','direct_cost','overhead_cost','other_income','other_cost','unknown')))) THEN RAISE EXCEPTION 'Financial amount evidence invalid' USING ERRCODE='22023'; END IF;
  END IF;
  source_hash:=public.canonical_completion_digest(jsonb_build_object('organizationId',org,'sourceKey',source_value,'consentId',consent_row.id,'externalRecordId',external_id,'externalVersion',external_version_value,'state',state_value,'payload',item));
  SELECT * INTO existing FROM public.canonical_external_financial_import_records WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id AND external_record_id=external_id AND external_version=external_version_value;
  IF FOUND THEN IF rtrim(existing.source_digest)<>source_hash THEN RAISE EXCEPTION 'Financial record conflict' USING ERRCODE='40001',CONSTRAINT='financial_import_record_conflict'; END IF; duplicate_count:=duplicate_count+1;CONTINUE; END IF;
  SELECT * INTO current_row FROM public.canonical_external_financial_import_records WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id AND external_record_id=external_id ORDER BY revision DESC LIMIT 1 FOR UPDATE;
  IF current_row.id IS NOT NULL AND external_version_value<=current_row.external_version THEN RAISE EXCEPTION 'Financial record version conflict' USING ERRCODE='40001',CONSTRAINT='financial_import_record_conflict'; END IF;
  next_revision:=COALESCE(current_row.revision,0)+1;
  INSERT INTO public.canonical_external_financial_import_records(organization_id,source_key,external_record_id,revision,previous_id,consent_id,external_version,state,record_type,customer_reference,job_reference,estimate_reference,execution_reference,project_reference,change_order_reference,invoice_reference,payment_reference,collection_reference,accounting_reference,record_state,amount_claim,occurred_at,time_zone,evidence_class,provider_evidence_digest,source_updated_at,source_digest,import_run_id)
  VALUES(org,source_value,external_id,next_revision,current_row.id,consent_row.id,external_version_value,state_value,CASE WHEN state_value='active' THEN item->>'recordType' END,CASE WHEN state_value='active' THEN item->>'customerReference' END,CASE WHEN state_value='active' THEN item->>'jobReference' END,CASE WHEN state_value='active' THEN item->>'estimateReference' END,CASE WHEN state_value='active' THEN item->>'executionReference' END,CASE WHEN state_value='active' THEN item->>'projectReference' END,CASE WHEN state_value='active' THEN item->>'changeOrderReference' END,CASE WHEN state_value='active' THEN item->>'invoiceReference' END,CASE WHEN state_value='active' THEN item->>'paymentReference' END,CASE WHEN state_value='active' THEN item->>'collectionReference' END,CASE WHEN state_value='active' THEN item->>'accountingReference' END,CASE WHEN state_value='active' THEN item->>'recordState' END,CASE WHEN state_value='active' AND item->'amountClaim'<>'null'::jsonb THEN item->'amountClaim' END,occurred,CASE WHEN state_value='active' THEN item->>'timeZone' END,CASE WHEN state_value='active' THEN item->>'evidenceClass' END,CASE WHEN state_value='active' THEN item->>'providerEvidenceDigest' END,updated,source_hash,run_id);
  IF state_value='tombstone' THEN tombstoned_count:=tombstoned_count+1; ELSIF current_row.id IS NULL THEN inserted_count:=inserted_count+1; ELSE corrected_count:=corrected_count+1; END IF;
 END LOOP;
 run_hash:=public.canonical_completion_digest(jsonb_build_object('id',run_id,'organizationId',org,'sourceKey',source_value,'mode',body->>'mode','sequence',next_sequence,'previousRunId',previous_run.id,'consentId',consent_row.id,'consentRevision',consent_row.revision,'consentDigest',rtrim(consent_row.canonical_digest),'schemaVersion','m25-external-financial-evidence-v1','cursorBefore',body->>'cursorBefore','cursorAfter',body->>'cursorAfter','complete',(body->>'complete')::boolean,'recordCount',record_count,'insertedCount',inserted_count,'correctedCount',corrected_count,'duplicateCount',duplicate_count,'tombstonedCount',tombstoned_count,'actorUserId',actor,'membershipId',(authority->>'membershipId')::uuid,'authSessionId',session_value,'reason',body->>'reason','requestDigest',request_hash));
 INSERT INTO public.canonical_external_financial_import_runs(id,organization_id,source_key,mode,sequence,previous_run_id,consent_id,consent_revision,consent_digest,schema_version,cursor_before,cursor_after,complete,record_count,inserted_count,corrected_count,duplicate_count,tombstoned_count,actor_user_id,membership_id,auth_session_id,reason,confirmed,confirmation_version,request_key_hash,request_digest,canonical_digest)
 VALUES(run_id,org,source_value,body->>'mode',next_sequence,previous_run.id,consent_row.id,consent_row.revision,rtrim(consent_row.canonical_digest),'m25-external-financial-evidence-v1',body->>'cursorBefore',body->>'cursorAfter',(body->>'complete')::boolean,record_count,inserted_count,corrected_count,duplicate_count,tombstoned_count,actor,(authority->>'membershipId')::uuid,session_value,body->>'reason',TRUE,'m25-external-financial-import-batch-v1',key_hash,request_hash,run_hash) RETURNING * INTO inserted_run;
 RETURN jsonb_build_object('run',public.canonical_external_financial_run_projection(inserted_run),'replayed',FALSE); END $$;

CREATE FUNCTION public.canonical_external_financial_import_read(org UUID,actor UUID,role_value TEXT,session_value UUID,source_value TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consent_row public.canonical_external_financial_import_consents%ROWTYPE;runs JSONB;records JSONB;run_total BIGINT;record_total BIGINT;latest_source TIMESTAMPTZ;
BEGIN IF role_value IS NULL OR role_value NOT IN ('owner','admin') THEN RAISE EXCEPTION 'External financial evidence restricted' USING ERRCODE='42501'; END IF;PERFORM public.canonical_field_execution_actor_authority(org,actor,role_value,session_value,NULL,FALSE);
 IF source_value IS NULL OR source_value!~'^[a-z0-9][a-z0-9._-]{1,63}$' THEN RAISE EXCEPTION 'External financial source invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO consent_row FROM public.canonical_external_financial_import_consents WHERE organization_id=org AND source_key=source_value ORDER BY revision DESC LIMIT 1;
 IF consent_row.id IS NULL OR consent_row.action<>'grant' THEN RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',FALSE,'runs','[]'::jsonb,'runTotal',0,'runsTruncated',FALSE,'currentRecords','[]'::jsonb,'recordTotal',0,'recordsTruncated',FALSE,'latestSourceUpdatedAt',NULL,'nativeAuthorityBoundary','This evidence does not create NorthStar invoices, payments, collections, or accounting records.','consumptionBoundary','No external financial evidence is available while source permission is inactive.'); END IF;
 SELECT count(*) INTO run_total FROM public.canonical_external_financial_import_runs WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id;
 SELECT COALESCE(jsonb_agg(public.canonical_external_financial_run_projection(x) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO runs FROM (SELECT * FROM public.canonical_external_financial_import_runs WHERE organization_id=org AND source_key=source_value AND consent_id=consent_row.id ORDER BY created_at DESC,id DESC LIMIT 20)x;
 WITH current_records AS(SELECT DISTINCT ON(r.external_record_id) r.* FROM public.canonical_external_financial_import_records r JOIN public.canonical_external_financial_import_runs run ON run.organization_id=r.organization_id AND run.source_key=r.source_key AND run.id=r.import_run_id WHERE r.organization_id=org AND r.source_key=source_value AND run.consent_id=consent_row.id ORDER BY r.external_record_id,r.revision DESC) SELECT count(*),max(source_updated_at) INTO record_total,latest_source FROM current_records;
 WITH current_records AS(SELECT DISTINCT ON(r.external_record_id) r.* FROM public.canonical_external_financial_import_records r JOIN public.canonical_external_financial_import_runs run ON run.organization_id=r.organization_id AND run.source_key=r.source_key AND run.id=r.import_run_id WHERE r.organization_id=org AND r.source_key=source_value AND run.consent_id=consent_row.id ORDER BY r.external_record_id,r.revision DESC),selected AS(SELECT * FROM current_records ORDER BY external_record_id LIMIT 100) SELECT COALESCE(jsonb_agg(public.canonical_external_financial_record_projection(x) ORDER BY external_record_id),'[]'::jsonb) INTO records FROM selected x;
 RETURN jsonb_build_object('sourceKey',source_value,'activeConsent',TRUE,'consent',public.canonical_external_financial_consent_projection(consent_row),'runs',runs,'runTotal',run_total,'runsTruncated',run_total>20,'currentRecords',records,'recordTotal',record_total,'recordsTruncated',record_total>100,'latestSourceUpdatedAt',latest_source,'nativeAuthorityBoundary','This evidence does not create NorthStar invoices, payments, collections, or accounting records.','consumptionBoundary','Staged financial evidence cannot change customers, leads, jobs, appointments, estimates, dispatch, schedules, invoices, payments, provider records or company policy. Every record remains unmatched until it is separately reviewed.'); END $$;

REVOKE ALL ON TABLE public.canonical_external_financial_import_consents,public.canonical_external_financial_import_runs,public.canonical_external_financial_import_records,public.canonical_external_financial_time_zones FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_consent_projection(public.canonical_external_financial_import_consents) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_run_projection(public.canonical_external_financial_import_runs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_record_projection(public.canonical_external_financial_import_records) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_import_consent_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_import_consent_mutate(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_import_batch(UUID,UUID,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_external_financial_import_read(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
