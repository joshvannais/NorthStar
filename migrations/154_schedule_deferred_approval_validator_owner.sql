-- The Mission 22 approval completion check is a deferred constraint trigger.
-- Its invocation happens at commit under the runtime role, after the trusted
-- mutation function has returned. The validator reads private schedule tables
-- and calls a private request-digest helper whose direct runtime EXECUTE is
-- deliberately revoked. Run this read-only validator with its migration-owner
-- authority, as the other trusted schedule triggers do. Keep its fixed
-- search_path and the existing direct EXECUTE revocation unchanged.
ALTER FUNCTION public.canonical_schedule_validate_human_approval_completion()
  SECURITY DEFINER;
