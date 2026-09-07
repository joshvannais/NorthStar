-- Mission 23 Part 8 correction: require canonical production transcript
-- provenance before exposing completion history. Migration 049 is immutable;
-- this forward-only replacement narrows only the completion read boundary.

CREATE OR REPLACE FUNCTION public.canonical_completion_read(
 organization_id_value UUID, actor_user_id_value UUID, actor_access_role_value TEXT,
 auth_session_id_value UUID, execution_id_value UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authority JSONB; actor_profile_id UUID; execution_record public.canonical_field_executions%ROWTYPE;
 total_records BIGINT; records_value JSONB; active_proposal public.canonical_completion_records%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
  RAISE EXCEPTION 'Completion reads require a bounded snapshot'
   USING ERRCODE='25001',CONSTRAINT='canonical_completion_snapshot_required'; END IF;
 PERFORM public.canonical_completion_work_lock(organization_id_value,execution_id_value,FALSE);
 authority:=public.canonical_field_execution_actor_authority(organization_id_value,actor_user_id_value,
  actor_access_role_value,auth_session_id_value,NULL,FALSE);
 actor_profile_id:=(authority->>'profileId')::uuid;
 SELECT execution.* INTO execution_record FROM public.canonical_field_executions execution
  JOIN public.canonical_transcripts transcript ON transcript.organization_id=execution.organization_id
   AND transcript.operation_id=execution.operation_id AND transcript.graph_id=execution.graph_id
  WHERE execution.organization_id=organization_id_value AND execution.id=execution_id_value
   AND public.canonical_labor_transcript_source_normalized(transcript.source) IN ('lead','retell','voice');
 IF NOT FOUND OR NOT public.canonical_field_execution_replay_authorized(organization_id_value,
   actor_access_role_value,actor_profile_id,execution_id_value,NULL) THEN
  RAISE EXCEPTION 'Completion authority not found'
   USING ERRCODE='P0002',CONSTRAINT='canonical_completion_not_found'; END IF;
 SELECT count(*) INTO total_records FROM public.canonical_completion_records record
  WHERE record.organization_id=organization_id_value AND record.execution_id=execution_id_value;
 SELECT COALESCE(jsonb_agg(public.canonical_completion_projection(record)
   ORDER BY record.decided_at DESC,record.id DESC),'[]'::jsonb)
 INTO records_value FROM (SELECT * FROM public.canonical_completion_records item
  WHERE item.organization_id=organization_id_value AND item.execution_id=execution_id_value
  ORDER BY item.decided_at DESC,item.id DESC LIMIT 200) record;
 IF execution_record.lifecycle_state='completion_pending' THEN
  SELECT * INTO active_proposal FROM public.canonical_completion_records proposal
   WHERE proposal.organization_id=organization_id_value AND proposal.execution_id=execution_id_value
    AND proposal.record_kind='proposal' AND proposal.resulting_execution_revision=execution_record.revision
    AND rtrim(proposal.resulting_execution_digest)=rtrim(execution_record.canonical_digest)
    AND NOT EXISTS(SELECT 1 FROM public.canonical_completion_records resolution
      WHERE resolution.organization_id=organization_id_value AND resolution.related_proposal_id=proposal.id
        AND resolution.record_kind IN ('approval','withdrawal','cancellation'))
   ORDER BY proposal.decided_at DESC,proposal.id DESC LIMIT 1;
 END IF;
 RETURN jsonb_build_object('success',TRUE,'data',jsonb_build_object(
  'execution',public.canonical_field_execution_projection(execution_record),
  'activeProposal',CASE WHEN active_proposal.id IS NULL THEN NULL ELSE
    public.canonical_completion_projection(active_proposal)||jsonb_build_object(
      'expired',active_proposal.expires_at<=transaction_timestamp()) END,
  'records',records_value,'totalRecordCount',total_records,'truncated',total_records>200,
  'authority','postgresql','completionInferred',FALSE,
  'interpretation','Explicit completion and reopening authority only; no schedule, customer acceptance, invoice, payment, warranty, regulatory or professional conclusion.'));
END $$;

REVOKE ALL ON FUNCTION public.canonical_completion_read(UUID,UUID,TEXT,UUID,UUID) FROM PUBLIC;
