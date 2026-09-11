# Mission 24 Part 2 Slice 3 — demo scheduling parity follow-up

This incremental package enables time-only scheduling and rescheduling of an existing demo appointment. It does not complete Part 2. The seven-slice Part 2 plan and all remaining assignment, dispatch, appointment creation and provider work remain separate.

## Shared operation and isolated persistence

The existing Calendar and Command Center scheduling dialog uses the same time contract, explicit preview, conflict evaluator and recommendation evaluator in paid and demo views. Missing start/end times are blank, not invented defaults. A user must enter both. Actual unassigned staffing is retained; neither a display name nor a synthetic conversation establishes availability.

Demo writes go only to the demo route and existing token-bound session. Migration 060 adds two operation names to the demo mutation CHECK. The session's bounded JSON ledger stores immutable previews and confirmations; original synthetic graphs, transcripts, estimate decisions, material plans and estimate revisions are not rewritten. Legacy nonterminal work labels normalize to the scheduling contract's `preferred` status while retaining `originalStatus`; terminal statuses remain terminal. This time-only family cannot change status, assignment or dispatch.

Preview admission locks the current session and binds the selected appointment revision/digest, source workspace revision, generation, time zone and real shared evaluator results. It advances the workspace revision. Confirmation binds that resulting revision and the exact preview and acknowledgments. An intervening mutation requires another review. Fifteen-minute expiry and current session expiry are checked after waits and before completion; exact retries retain the captured request identity and receipt. Existing session expiry, 24-operation limit and isolated reset behavior remain in force. Reset deliberately clears this simulated history with the rest of that user's demo; no automatic reset occurs.

The effective read projection overlays the saved appointment on workspace graphs, canonical items, Calendar and Command Center. Original start/status remain explicitly historical fields. The paid scheduling repositories, functions and privileges are unchanged. No real customer is contacted and no job or appointment is duplicated.

## Rollout and recovery boundary

060 takes an ACCESS EXCLUSIVE lock on `demo_command_center_mutations` while replacing and validating its operation CHECK. Startup applies the existing tighter-of-inherited 5-second lock and 20-second statement caps across the migration transaction, advisory lock and grants; failure rolls back and does not authorize retries without reconciliation. All 57 prior migration identities must remain unchanged.

The source-controlled recovery build changes only `src/commandCenter/demoSchedulingPolicy.js` to `mutationsEnabled:false`. Saved current schedules and history remain readable while preview/confirmation return a clear pause response; other previously released operations retain their own existing policies. Forward resume restores the reviewed source flag after the cause is understood. Do not roll back to a build that ignores the schedule ledger and presents original times as current. Application pause is not a physical database restore, nor proof of backup integrity. Production 060 release, backup and rollout disposition are separately reviewed after independent audit; no previous migration risk waiver is inherited.

## Rendered and acceptance scope

Affected surfaces are ordinary demo Calendar creation of scheduled work from an existing record, overview Schedule/Reschedule, event editing and Command Center scheduling actions; the shared dialog is also a paid regression surface. Review empty, pending, unavailable, expired, stale, warning acknowledgment, success, reload and paused states. Labels and evidence explanations use business language; exact IDs/digests stay internal. Preserve current customer cards, CAPELLA, transcripts and selected estimate review.

Required evidence covers actual mounted saved/replayed/concurrent operations and read alignment, session/preview expiry after ordinary waits, populated upgrade and timeout rollback, apply-once/zero-op, actual source-derived pause and forward resume, and Chrome/WebKit desktop/mobile themes with explicit confirmation and keyboard focus. Test results and exact tested-source provenance belong in the sealed handoff; this document does not claim those gates already passed.
