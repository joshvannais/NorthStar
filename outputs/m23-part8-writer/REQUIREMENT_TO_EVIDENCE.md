# Mission 23 Part 8 requirement-to-evidence map

Writer evidence only; independent exact-head audit remains required.

| Requirement | Implementation evidence | Verification evidence |
| --- | --- | --- |
| No inferred completion | `src/completion/contract.js`; `canonical_completion_read` returns `completionInferred: false`; no appointment/progress trigger completes work | Unit extra-authority rejection; mounted real-checklist test proves Part 6 evidence leaves execution `in_progress` until an explicit proposal |
| Exact two-stage proposal/approval | Migration 049 proposal and approval branches; exact execution/assignment/proposal pins; owner/admin approval | Mounted checklist-gate flow and one-winner concurrent approval |
| Deterministic hard gates | `canonical_completion_gate_snapshot` commits required checklists, inspections, files and complete supporting-authority summary digests | Real unsatisfied/satisfied checklist test; approval recomputation; migration compile and direct-entry checks |
| Expiry and zero partial mutation | Database-owned proposal expiry, seven-day maximum, approval expiry check | Mounted expired proposal remains pending/readable and cannot approve |
| Idempotency and uncertain commit | Completion receipt plus collision check with lifecycle receipts; exact cached body after reauthorization | Exact replay, changed-key semantics in unit coverage, and synthetic lost-COMMIT acknowledgement recovery with one record/event/audit/receipt |
| Deterministic concurrency | Supporting fence, per-execution session lock, serializable writes, unique proposal resolution/reopening constraints | Concurrent distinct-key approvals produce exactly one success and one conflict |
| Immutable completion/correction history | Append-only records/events/audits/receipts, root/predecessor chain, deferred completeness triggers | Original approval bytes unchanged after revision-2 correction; direct update/delete/truncate denied |
| Explicit cancellation | `cancel_execution`, exact active proposal pin when pending, owner/admin gate | Withdrawal returns original state; explicit cancellation reaches `cancelled`; repeat conflicts; missing pending pin rejects |
| Reopening and controlled resume | Exact completion pin, reason/next action, one reopening winner, distinct `reopened` state and `resume_reopened` | Mounted approval/reopen flow; generic resume rejected; explicit resume returns `in_progress`; original approval remains completed |
| Tenant, actor, role and revocation isolation | Existing field-execution actor/scope authority is reloaded before mutation/read/replay | Member proposal/self-withdrawal, member approval denial, cross-tenant 404, revoked-session replay/read denial |
| Atomic audit and least privilege | Same-transaction completion and lifecycle evidence, deferred completeness; runtime gets exactly mutate/read | Synthetic audit trigger rolls back all rows/current state; runtime table/helper/DDL/role access denied; migration grant verification |
| Strict mounted HTTP boundary | Completion action path added to raw-body owner; closed contract and queryless read | Production router accepts exact request, returns private/no-store, rejects query authority and duplicate JSON keys |
| Migration safety | One additive 049; no released migration edits; runtime grants verified after migration | Interruption rollback, retry once, zero-op restart, valid constraints, no PUBLIC helper execution on PostgreSQL 18.4 |
| Scope containment | Authority doc and route/source diff contain no UI, provider, pricing, customer, schedule or downstream mutation | Protected-path/diff ratification and no dependency/lockfile change |
