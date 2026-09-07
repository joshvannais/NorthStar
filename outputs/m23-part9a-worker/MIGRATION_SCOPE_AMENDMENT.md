# Mission 23 Part 9 Slice A migration scope amendment

Date: 2026-09-07 (America/New_York)

This is writer provenance, not implementation or independent audit approval.
It supplements, and does not rewrite, the original frozen Slice A receipt at:

`C:/Users/joshv/Documents/Codex/2026-08-05/read-and-follow-northstar-monitor-handoff/answer-artifacts/M23_PART9A_WORKER_OPERATIONAL_EXPERIENCE_SCOPE_FREEZE_2026-09-07.md`

Original receipt SHA-256:
`c0b1de17f0a6145f5cfec40de269a589f839b837a4c9fdd759e18e111656cddf`

## Explicit amendment

After the preserved PostgreSQL 18.4 runtime failure proved that Today could not
read `canonical_field_executions` and no existing entry function could resolve
an existing execution by appointment, the founder explicitly authorized one
narrow additive migration and its focused tests/audit.

The authorization permits only a tenant-, session-, and current-worker-scoped
read-only execution projection by appointment. The runtime role may receive
`EXECUTE` on that entry function only. It may not receive table `SELECT`, helper
execution, owner-pool access, or new mutation authority.

## Frozen implementation boundary

- Verify and use only the next unused migration identity after exact 052.
- Preserve migrations 001-052 byte-for-byte.
- Preserve Today as repeatable-read and read-only.
- Preserve direct/current-crew scope and fail closed after tenant, session,
  membership, role, assignment, crew, dispatch, or cancellation revocation.
- Permit a current worker to discover no execution, or the minimum existing
  execution identity/pins, including completed and reopened lifecycle states.
- Preserve non-demo/non-simulation provenance and existing server authorization.
- No other schema, lifecycle, provider, dependency, configuration, production,
  owner/admin operational view, cross-page integration, or later-part change.
- A later release still requires explicit migration compatibility, production
  history/UTC, backup, recovery/rollback, audit, merge, and deployment gates.

The previously recorded SQLSTATE `42501` is retained in `AUTHORITY_GAP.md` and
remains the authentic red control. No migration was applied to production and no
provider, secret, private-production, remote-branch, pull-request, merge, or
deployment action occurred while freezing this amendment.
