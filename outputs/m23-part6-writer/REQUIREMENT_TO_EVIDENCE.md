# Mission 23 Part 6 requirement-to-evidence map

One writer, one unified candidate, exact released base
`dfc769520ea56fdb7fde44dda6fe0bd65202fcdb`. No Part 7 or later authority and no
rendered surface are included.

| Requirement | Implementation | Available evidence |
| --- | --- | --- |
| Version-pinned checklist instances and immutable item responses | Contract snapshots ad-hoc or exact published template/version/publication pins; 047 stores append-only instance and response revisions | Unit pin tests; mounted PostgreSQL create/replay/response/correction tests |
| Inspection and quality semantics | Explicit `inspection`, `quality`, or `field_observation` class and separate observation/measurement/pass/fail/unavailable/needs_review results; professional conclusion is always false | Six semantic unit cases and mounted measurement/correction test |
| Inert notes and captions | NFC, byte/code-point, control, markup and URL rejection in JavaScript and recursive PostgreSQL JSON validators | Hostile markup, URL and bidi-control unit tests; mounted direct-SQL validator cases |
| Exact execution authority and attribution | Tenant-composite FKs and exact execution/assignment revisions and digests bind actor, performer, session and database-owned decision time | Mounted tenant/role/session/stale/performer tests and ratification |
| Current authorization before mutation, replay or disclosure | Security-definer entry points recheck membership, session, subscription, onboarding, assignment, crew/performer, dispatch and non-demo transcript | Mounted revoked-session replay, wrong tenant/performer, stale assignment, read and retrieval cases |
| Immutable correction, event, audit and exact-once evidence | Append-only record roots/revisions, predecessor/supersession, events, audits, idempotency receipt, canonical digests and deferred completeness | Exact replay/mismatched replay, concurrent replay, forced-audit rollback, owner update/delete/truncate denial |
| Least privilege and transaction isolation | Four runtime entry points only; tables/helpers inaccessible; serializable mutations and disclosure audit; repeatable-read bounded reads | Runtime privilege enumeration and direct SQL denial; mounted isolation assertions |
| Secure tenant file authority | Opaque deterministic object IDs, JPEG/PNG/WebP extension/MIME/magic agreement, 10 MiB per file, 25 files and 100 MiB per execution, streaming, compression rejection and a 40-megapixel decompression-safety ceiling | Unit streaming, mismatch, polyglot, decompression-bomb, size and unavailable-provider cases; mounted count/byte SQL constraints |
| Quarantine, scanning, encryption and cleanup | Capability gate requires durable encrypted quarantine, malware scanning, metadata removal, retention cleanup, orphan cleanup and short-lived retrieval; DB registration follows provider release | Unit call-order, scan receipt, released-byte/digest, orphan cleanup and scanner-unavailable tests |
| Privacy and sensitive metadata | EXIF/geolocation removal required; faces/customer-property need exact policy and consent evidence; signatures rejected; policy/consent linked to same execution | File-header unit cases; mounted consent-link and released metadata validation |
| Authorized retrieval and access logging | Current authority and retention rechecked; immutable database-owned access event; HTTPS attachment-only octet-stream URL bounded to five minutes | Mounted authorized retrieval/expired-retention/access-log checks; unit provider-response validation |
| Additive migration and restart safety | Frozen 047; prior 44 migrations preserved; ordinary runner used | Ratification blob/byte checks and real interruption/rollback/retry/rerun/restart PostgreSQL test |
| Bounded mounted API only | Existing field-execution router adds one action route, one bounded snapshot route, raw upload and authorized retrieval | Mounted Supertest mutation/read/upload-unavailable checks; no `public/` or browser changes |
| Part 7–10 and downstream boundaries | Migration and modules expressly exclude lifecycle/progress/change/completion/UI/Polaris/financial/provider activation | Ratification scope assertions and changed-file inspection |

No unavailable evidence is counted as passing. See `UNAVAILABLE_EVIDENCE.md`.
