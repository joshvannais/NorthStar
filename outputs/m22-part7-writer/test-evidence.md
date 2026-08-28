# Mission 22 Part 7 test evidence

## PostgreSQL and mounted HTTP

| Matrix | Result | Durable artifact |
| --- | --- | --- |
| Focused Part 7 final | 1 suite, 3/3 tests passed | `raw/focused-part7-upgrade-rerun.json` |
| Parts 1–7 combined | 6 suites, 72/72 tests passed | `raw/parts1-7-combined.json` |
| Full Jest, unfiltered | 153/155 suites; 2,136/2,161 tests passed | `raw/full-jest-unfiltered.json` |
| Full Jest, only account-migration-010 excluded | 153/154 suites; 2,136/2,137 tests passed | `raw/full-jest-available.json` |
| Email outbox isolated | 1 suite, 14/14 tests passed in 69.418 s | `raw/email-outbox-isolated.json` |
| Fresh startup/restart | pass; two health 200s; zero second-start migrations | `raw/startup-restart.json` |

The mounted tests used PostgreSQL 18.4 with UTC and `max_connections=100`,
separate migration/runtime roles, real production route modules, real cookie
sessions and CSRF, and disposable tenant identities. Provider credentials were
omitted. All disposable application databases/roles created by the harnesses
were removed in `finally` cleanup.

The exact full-corpus red and unavailable cases are retained in
`intermediate-failures.md`; neither is rewritten as passing.

## Part 7 browsers

| Matrix | Browser truth | Result |
| --- | --- | --- |
| desktop 1280x900, light | installed Chrome 151.0.7922.175 | passed |
| mobile 390x844, dark | installed Chrome 151.0.7922.175 | passed |
| desktop 1280x900, dark | Playwright WebKit 26.5 | passed |
| mobile 390x844, light | Playwright WebKit 26.5 | passed |

Each matrix mounted the application on disposable PostgreSQL and retained four
screenshots: Calendar revision 7, Command Center reference revision 7,
employee Today after reschedule/dispatch revocation, and employee Today after
crew-membership removal. The trace ledgers contain 82–87 same-origin requests,
zero external requests, zero provider calls, zero page errors, and prove the
employee surface did not request broad `/api/auth/me`, workforce, or Business
Profile data. Command Center remains the primary visual-theme reference.

The matrix also checked actual focus, keyboard activation, pointer/touch input,
reduced motion, viewport geometry/no overhang, literal hostile bytes, and
cross-surface revision/digest parity. WebKit is not physical Safari. These are
security/acceptance images, not the separately accepted Part 6 employee package
and not user visual approval.

## Existing browser compatibility

- Part 5 owner/dispatcher UX: all four Chrome/WebKit desktop/mobile matrices
  passed; 14 previews, 11 approvals, final revision 12, high-cardinality target
  and Command Center pagination, drag/resize, role/session/subscription,
  hostile DOM, and 200%/400% reflow remained green.
- Part 6 employee Today: all four Chrome/WebKit desktop/mobile light/dark
  matrices passed with strict endpoint inventory, zero mutation/external
  requests, and zero browser errors.

The Part 5 fixture originally assumed `now + 2 days` was always inside the
Calendar's current rendered week. Near a week boundary it timed out before the
event was visible. The bounded correction reads the visible week and activates
the real Previous Week/Next Week control before continuing; no product behavior
or authority changed.

## Migration/startup identity

- protected migration files: 33 files numbered 001–035 with historical gaps
- protected migration diff from base: zero
- first startup applied migrations: 33
- second startup applied migrations: 0
- migration 035 database count: 1
- migration 035 source/database checksum:
  `96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`
- health: two credential-free HTTP 200 responses
- PostgreSQL: 18.4, UTC
- runtime role: no database CREATE and no public-schema CREATE
- stderr: zero bytes on both starts

`migrations-001-035.sha256` records each working-byte SHA-256 and Git blob ID;
every head blob equals the Part 7 base blob.
