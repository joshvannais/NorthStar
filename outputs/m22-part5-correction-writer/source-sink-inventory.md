# Correction source-to-sink inventory

| Source | Boundary and authority | Sink / disposition |
|---|---|---|
| Current HTTP tenant/user/session | Production auth plus `loadSchedulingOperatorDirectory`; active owner/admin or active operational dispatcher required for broad reads | Gate precedes canonical broad query and response construction on every collection, surface, compatibility, legacy, graph, snapshot, and detail alias |
| Subscription/onboarding state | Existing account policy only affects `canMutate`; current actor/member/user/role still governs `canRead` | Read-only Calendar/Command Center render safe canonical truth and disable actions; Part 4 apply rechecks and denies mutation |
| PostgreSQL graph pages | Organization/session filter, strict bounded query filters, exact microsecond UTC plus operation UUID keyset, limit 100 | Complete server scan is capped at 1,000; response rows remain max 100 with truthful total/shown/truncated/cursors |
| Current schedule assignment | Same repeatable-read read-only transaction; identity verification and `FOR SHARE` for every row | One current revision/digest/target/schedule/dispatch state feeds categories, counts, Calendar, and Command Center |
| PostgreSQL clock and business profile | One server clock plus current tenant IANA profile in overview transaction | Due/overdue/at-risk classification and every visible/accessible time label; browser local zone is never authority |
| Calendar drag/move | Visible native drag plus shared elapsed-duration proposal; no PATCH | Shared Part 4 preview dialog; exact tenant-time start/end; no mutation before explicit approval |
| Keyboard/touch/resize/action buttons | Visible accessible controls only | Same shared preview and approval routes; no internal-only mutation function |
| Part 4 preview response | Exact current action, revision/digest, conflicts/warnings/review reasons, expiry, evidence | DOM nodes and `textContent`; exact warning/review digest acknowledgements; hard conflicts disable approval |
| Part 4 apply response | Exact durable schedule revision/digest, approval ID, local idempotency key | Refresh must observe the exact pair before close; otherwise durable-applied stale state with refresh/reload only |
| Customer/job/worker/crew/reason/warning hostile bytes | Bounded server payloads; no provider lookup | Shared approval and Command Center additions use DOM creation/`textContent`; changed Calendar markup uses established escaping helpers; browser poison remains inert |
| Demo session | Existing isolated demo authority and explicit non-authoritative read-only presentation | Never queries or mutates paid tenant data; no provider or production call |

Manual review also traced all changed fetches. Mutation requests are only Part 4
`mutation-previews` and `mutation-approvals`; no direct scheduling PATCH remains
reachable. Optional security scanning was not retried because
`CODEX_SECURITY_CONFIG_PATH` is unset; this manual review is not represented as
scanner evidence.
