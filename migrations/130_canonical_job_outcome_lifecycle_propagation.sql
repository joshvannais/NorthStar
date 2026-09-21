-- Mission 25 Part 13G: propagate lifecycle changes into adopted planning-value review state.
-- The owner-adopted value remains immutable and in effect until a later owner action.

CREATE FUNCTION public.canonical_job_outcome_planning_value_lineage(value public.canonical_job_outcome_planning_value_versions,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_value public.canonical_job_outcome_planning_value_versions%ROWTYPE;source_registry public.canonical_job_outcome_proposal_registry_versions%ROWTYPE;current_registry public.canonical_job_outcome_proposal_registry_versions%ROWTYPE;current_permission public.canonical_job_outcome_proposal_consents%ROWTYPE;selection JSONB;status_value TEXT;message_value TEXT;review_value BOOLEAN:=FALSE;in_effect_value BOOLEAN:=FALSE;source_current_value BOOLEAN:=FALSE;lineage_digest_value TEXT;
BEGIN
 IF role_value IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Planning changes require the current owner' USING ERRCODE='42501';END IF;PERFORM public.canonical_field_execution_actor_authority(value.organization_id,actor,role_value,session_value,NULL,FALSE);
 SELECT * INTO current_value FROM public.canonical_job_outcome_planning_value_versions WHERE organization_id=value.organization_id AND service_key=value.service_key AND planning_area=value.planning_area AND metric_key=value.metric_key AND basis=value.basis ORDER BY revision DESC,id DESC LIMIT 1;
 IF current_value.id IS DISTINCT FROM value.id THEN status_value:='planning_value_superseded';message_value:='A later owner planning decision replaced this history entry.';
 ELSIF value.value_state='unset' THEN status_value:='not_set';message_value:='This service planning value is not set.';
 ELSE
  in_effect_value:=TRUE;
  SELECT * INTO source_registry FROM public.canonical_job_outcome_proposal_registry_versions WHERE organization_id=value.organization_id AND id=value.source_registry_id;
  SELECT * INTO current_permission FROM public.canonical_job_outcome_proposal_consents WHERE organization_id=value.organization_id ORDER BY revision DESC,id DESC LIMIT 1;
  IF source_registry.id IS NULL OR rtrim(source_registry.canonical_digest) IS DISTINCT FROM rtrim(value.source_registry_digest) OR rtrim(source_registry.preview_digest) IS DISTINCT FROM rtrim(value.source_preview_digest) THEN status_value:='lineage_unavailable';message_value:='The saved source record is unavailable. The adopted value remains in place for owner review.';review_value:=TRUE;
  ELSIF current_permission.id IS NULL OR current_permission.action<>'grant' THEN status_value:='permission_revoked';message_value:='Permission for this learning source was removed. The adopted value remains in place for owner review.';review_value:=TRUE;
  ELSIF source_registry.proposal_consent_id<>current_permission.id THEN status_value:='permission_replaced';message_value:='A new permission period began. Earlier learning does not become current again, and the adopted value remains in place for owner review.';review_value:=TRUE;
  ELSE
   SELECT * INTO current_registry FROM public.canonical_job_outcome_proposal_registry_versions WHERE organization_id=value.organization_id AND service_key=value.service_key AND proposal_consent_id=current_permission.id ORDER BY revision DESC,id DESC LIMIT 1;
   IF current_registry.id IS DISTINCT FROM source_registry.id THEN status_value:='proposal_superseded';message_value:='A newer saved proposal is available. The adopted value remains in place until the owner chooses another action.';review_value:=TRUE;
   ELSE
    BEGIN
     selection:=public.canonical_job_outcome_planning_selection(value.organization_id,actor,role_value,session_value,value.service_key,value.source_registry_id,rtrim(value.source_registry_digest),rtrim(value.source_preview_digest),value.planning_area,value.metric_key,value.basis);
     IF selection->>'selectionDigest'=rtrim(value.source_selection_digest) AND (selection->>'multiplier')::numeric=value.multiplier THEN status_value:='current';message_value:='This owner-adopted service planning value is current.';source_current_value:=TRUE;
     ELSE status_value:='evidence_changed_or_unavailable';message_value:='Connected evidence was corrected, removed or is no longer available. The adopted value remains in place for owner review.';review_value:=TRUE;END IF;
    EXCEPTION WHEN SQLSTATE 'P0002' OR SQLSTATE '22023' OR SQLSTATE '40001' THEN status_value:='evidence_changed_or_unavailable';message_value:='Connected evidence was corrected, removed or is no longer available. The adopted value remains in place for owner review.';review_value:=TRUE;END;
   END IF;
  END IF;
 END IF;
 lineage_digest_value:=public.canonical_completion_digest(jsonb_build_object('planningValueId',value.id,'planningValueDigest',rtrim(value.canonical_digest),'currentPlanningValueId',current_value.id,'currentPlanningValueDigest',rtrim(current_value.canonical_digest),'sourceRegistryId',value.source_registry_id,'sourceRegistryDigest',rtrim(value.source_registry_digest),'currentPermissionId',current_permission.id,'currentPermissionRevision',current_permission.revision,'currentPermissionDigest',rtrim(current_permission.canonical_digest),'currentPermissionAction',current_permission.action,'currentRegistryId',current_registry.id,'currentRegistryRevision',current_registry.revision,'currentRegistryDigest',rtrim(current_registry.canonical_digest),'status',status_value));
 RETURN jsonb_build_object('status',status_value,'message',message_value,'requiresOwnerReview',review_value,'planningValueInEffect',in_effect_value,'sourceCurrent',source_current_value,'digest',lineage_digest_value,'changeBoundary','Source corrections, removals, permission changes and newer proposals can require review. Only an explicit owner adoption or rollback changes the planning value.');
END $$;

CREATE OR REPLACE FUNCTION public.canonical_job_outcome_planning_value_projection(value public.canonical_job_outcome_planning_value_versions,actor UUID,role_value TEXT,session_value UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE lineage JSONB;
BEGIN
 lineage:=public.canonical_job_outcome_planning_value_lineage(value,actor,role_value,session_value);
 RETURN jsonb_build_object('id',value.id,'serviceKey',value.service_key,'planningArea',value.planning_area,'metricKey',value.metric_key,'basis',value.basis,'revision',value.revision,'previousId',value.previous_id,'action',value.action,'state',value.value_state,'multiplier',CASE WHEN value.value_state='active' THEN value.multiplier::text ELSE NULL END,'sourceFresh',lineage->'sourceCurrent','sourceNeedsReview',lineage->'requiresOwnerReview','lineage',lineage,'rollbackToId',value.rollback_to_id,'effectiveDigest',rtrim(value.effective_digest),'digest',rtrim(value.canonical_digest),'reason',value.reason,'createdAt',value.created_at,'statusMessage',lineage->>'message','operatingBoundary','This planning value does not rewrite an existing estimate, price, schedule, job or financial record.');
END $$;

REVOKE ALL ON FUNCTION public.canonical_job_outcome_planning_value_lineage(public.canonical_job_outcome_planning_value_versions,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.canonical_job_outcome_planning_value_projection(public.canonical_job_outcome_planning_value_versions,UUID,TEXT,UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 REVOKE ALL ON FUNCTION public.canonical_job_outcome_planning_value_lineage(public.canonical_job_outcome_planning_value_versions,UUID,TEXT,UUID) FROM northstar_app_runtime;
 REVOKE ALL ON FUNCTION public.canonical_job_outcome_planning_value_projection(public.canonical_job_outcome_planning_value_versions,UUID,TEXT,UUID) FROM northstar_app_runtime;
END IF;END $$;
