# Part 5 writer test evidence

## Mounted PostgreSQL and API

- PostgreSQL: real 18.4 server, UTC, disposable loopback port 55631, explicit
  data-directory/port/run identity.
- Corrected combined Part 4 + Part 5 authority suite: `17/17` green. Coverage
  includes owner, active dispatcher, employee denial, subscription read-only,
  cross-tenant absence, hostile stored bytes, durable preview/approval actions,
  scheduled Part 2 overview, Calendar compatibility, and Command Center paid
  authorization.
- Mounted Command Center parity: `7/7` green.
- Focused unit/static/time ratification: `3` suites, `20/20` green.
- Post-CSS correction professionalism + Part 5 unit rerun: `2` suites,
  `15/15` green.

## Available corpus

- Terminal result: `150/151` suites and `2,088/2,112` tests green in
  `571.187s`.
- Sole non-pass: `tests/integration/account-migration-010-postgres.test.js`,
  exactly `24` cases, because four disposable `ACCOUNT_MIGRATION_*` URLs were
  not supplied. This evidence remains unavailable, not passing.
- Intermediate result before the CSS repair: `149/151` suites and
  `2,087/2,112` tests green. The one additional failure was the repository
  professionalism ratification rejecting five new `font-weight: 650`
  declarations. They were changed narrowly to approved weight 600; its focused
  rerun and the terminal corpus closed the regression.

## Browser and UI

- Installed Chrome `151.0.7922.173` desktop/light: final error-enabled matrix
  `10` preview attempts, `7` durable approvals, revision `1` to `8`, zero direct
  PATCHes, zero external/provider calls.
- Actual Playwright WebKit `26.5` desktop/dark: `7` previews, `7` approvals,
  revision `1` to `8`, zero PATCH/provider calls.
- Installed Chrome mobile/dark with touch: `7` previews, `7` approvals,
  revision `1` to `8`, zero PATCH/provider calls.
- Actual Playwright WebKit `26.5` mobile/light with touch: final error-enabled
  matrix `10` preview attempts, `7` approvals, revision `1` to `8`, zero direct
  PATCHes, zero external/provider calls.
- All four used real visible controls. Desktop used keyboard focus/Enter;
  mobile used touch. Visible drag and resize entry created the same preview
  dialog and was cancelled without mutation. All exercised 400% reflow and
  inert hostile stored markup. Twelve screenshots are listed separately.
- Chrome desktop and WebKit mobile additionally proved stale 409 retention with
  no approval control, offline failure with no approval control, and hard
  conflict with approval disabled/no override. Error interception was used only
  for presentation failure handling; durable mutation proof used real mounted
  server previews/approvals.
- The historical `m22-part1-calendar-authority.js` command now delegates to this
  replacement matrix; it can no longer ratify the retired direct-PATCH workflow.

## Startup/restart

- Fresh role-separated production startup on PostgreSQL `18.4`, UTC: first
  start applied `33` repository migrations including 035 once; second start
  applied `0`.
- Migration 035 source and ledger SHA-256 both:
  `96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`.
- Both credential-free `/api/health` requests returned `200` with PostgreSQL and
  canonical persistence healthy; both stderr streams were zero bytes.
- Runtime role could not create databases or objects in public. Disposable
  server processes, database, roles, and data directory were stopped/removed.

## Preserved intermediate failures

1. Initial fresh checkout had no local Jest; a bounded junction to the already
   terminal Part 4 dependency tree was used and is removed before handoff.
2. Initial PostgreSQL init/start under restricted token failed before product
   execution; the same approved disposable cluster was initialized normally.
3. First Command Center invocation omitted required disposable PostgreSQL
   identity variables and failed before product execution; exact rerun `7/7`.
4. Expanded mounted suite was `16/17` because a Part 5 fixture overlapped a
   later historical concurrency fixture; moving only the disposable fixture to
   2035 produced corrected `17/17`.
5. Browser harness corrections: missing fixture profile field, inappropriate
   `networkidle`, intentional Part 4 simulation-source exclusion, nested label
   locator, and after-success server-category navigation. Corrected matrices
   are reported above; none was reclassified as product success.
6. Final staged source review found that role-ineligible employees received no
   Part 5 overview but could still receive the preexisting broad Calendar
   compatibility items. The route now returns 403 before that payload; focused
   and complete mounted reruns are green.
7. The first post-fix corpus found the historical public-script reachability
   allowlist missing the deliberate shared approval UI asset. Only
   `public/js/scheduling-approval-ui.js` was added to that exact manifest.
