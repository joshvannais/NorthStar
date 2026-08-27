# Mission 22 Part 5 correction writer report

## State

This is writer evidence for the narrow correction of `M22-P5-001` through
`M22-P5-007` on draft PR #148. The independently audited parent is
`0a06ec5dccd4edc8b62ed89888b439cdcad874d4`; live/base main remains
`e20facc5937dc0581c9194ddf70b331b49de5188`. A different fresh exact-head
auditor must decide the terminal verdict. This writer did not self-approve,
mark ready, merge, deploy, restart Railway, access production, call a provider,
or begin Part 6/7.

## Outcome

All seven validated findings have bounded source, mounted PostgreSQL, and real
browser corrections. The product changes keep one canonical Parts 1–4 server
authority: broad reads require a current active owner/admin/dispatcher;
operator read access is independent of subscription mutation eligibility;
overview counts are complete and bounded while rows are paged; every overview
row is rebuilt in one repeatable-read PostgreSQL snapshot; tenant IANA time is
used in both views; moves preserve elapsed duration; and a durable approval
whose refresh fails stays visibly applied-but-stale with no reapply control.

An intermediate mounted rerun exposed an additional defect within finding 002:
JavaScript millisecond conversion lost PostgreSQL keyset microseconds and could
omit one row. The cursor now carries the exact six-digit UTC PostgreSQL ordering
instant privately with the operation UUID. No public record field or migration
was added.

## Terminal writer evidence

- Mounted Parts 1–4 plus Part 5 corrections: 4/4 suites, 61/61 tests.
- Affected Parts 1–5/unit/static/professionalism: 8/8 suites, 91/91 tests.
- Mounted Command Center parity: 7/7.
- Corrected historical canonical API: 29/29; input contract: 73/73; navigation
  and transcript mounted compatibility are green.
- Locally available full Jest: 150/151 suites and 2,089/2,113 tests green. The
  sole non-pass is exactly 24 account-migration cases whose four required
  disposable URLs are absent; it is unavailable, not passing.
- Installed Chrome 151 and actual Playwright WebKit 26.5: four green
  desktop/mobile, light/dark matrices using visible controls. Across the four:
  54 preview attempts, 42 durable approvals, zero direct PATCHes, zero external
  or provider calls.
- Fresh role-separated PostgreSQL 18.4 UTC: 33 migrations on first start, zero
  on restart, migration 035 once with exact source/ledger checksum, two
  credential-free health 200s, zero stderr, restricted runtime role.

No migration 036 was needed. Migrations 001–035 remain protected and migration
035 SHA-256 remains
`96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`.

See `finding-closure.md`, `source-sink-inventory.md`, `test-evidence.md`,
`browser-accessibility.md`, `screenshot-ledger.md`, `startup-ref.md`,
`intermediate-failures.md`, `unavailable-evidence.md`, and `hashes.sha256`.
