# Mission 22 Part 7 source-to-sink and threat ledger

| Threat/source | Authoritative sink/check | Mounted outcome |
| --- | --- | --- |
| Forged organization/appointment/body/header | cookie session tenant + repository organization predicate | cross-tenant reads/mutations rejected; no authority delta |
| Missing/forged CSRF | mounted mutation route middleware | rejected before preview/approval |
| Employee/viewer mutation | current member role/scope check | rejected; employee Today remains read-only |
| Inactive dispatcher/member | current session/member/role check | rejected against current database truth |
| Subscription changed after preview | approval transaction rechecks mutable subscription | stale authority rejected |
| Target/crew membership changed after preview | repeatable current-authority digest/revision and target eligibility | stale approval rejected |
| Preview replay as capability | preview token plus current human approval contract | preview alone changes no assignment |
| Recommendation body smuggling | server-owned candidate/evidence digest and mutation schema | recommendation grants no mutation; extra fields rejected |
| Route evidence absent/spoofed | provider-neutral durable evidence digest | absent is `needs_review`; no live travel/provider claim |
| Hard conflict | approval transaction recomputes current conflict authority | no override path |
| Idempotency replay/collision | durable key/request/response digest | exact replay stable; collision rejected |
| Concurrent same-revision approvals | row/advisory locks and revision/digest predicate | one winner, stale loser, no write skew |
| Reassign/reschedule after dispatch | canonical routine | dispatch atomically revoked |
| Direct SQL ordinary runtime role | revoked table DML + trusted fixed-search-path routines | protected approval/audit/idempotency/history writes rejected |
| Hostile stored labels/addresses/instructions/explanations | JSON serialization then DOM text nodes/textContent | raw bytes preserved, rendered inert, no page execution |
| Crew-member access revocation | current active crew membership joined at read | prior job immediately absent from employee response |
| Broad employee enumeration | employee-specific `/api/v1/today` projection/request inventory | no other workers, financials, settings, broad history, or owner Polaris cost data |
| Demo/paid crossover | separate tenant/session/demo authority | paid appointment absent from demo response |
| Provider transport | no provider credentials and browser/server request capture | zero external/provider calls |

The trace captures all-public-table counts before and after each accepted,
rejected, replayed, and revoked step. This makes rollback/no-delta assertions
inspectable rather than inferred from response status alone.

The optional Codex Security diff infrastructure was not retried because
`CODEX_SECURITY_CONFIG_PATH` is unset and the prior optional invocation failed.
This does not replace the required fresh independent manual source-to-sink audit.
