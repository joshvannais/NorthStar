# Mission 22 Part 6 correction test evidence

## M22-P6-FINAL-001 evidence-only correction

The latest visual-evidence implementation is commit
`b51f467f1dbf222a11b9ac6f0238a8a3ff5f2d34` / tree
`89de0e967290bc36e7572c4ee0abe508b13ed023`. It changes only browser-test and
evidence aggregation helpers; production authority, UI, and migrations are
unchanged.

- Focused mounted Part 6 production modules: 2/2 suites, 16/16 tests.
- Installed Chrome `151.0.7922.175` and actual Playwright WebKit `26.5`: all
  eight desktop/mobile light/dark matrices passed and captured 96 authoritative
  employee-package screenshots from realistic fixtures.
- The employee package contains 32 ready Today rows with realistic
  technician/crew/customer/job/instruction values, 56 non-ready or empty rows,
  and 32 synthetic rows with exact transport provenance. It contains zero
  hostile fixture markers.
- A separate, non-customer-facing security package contains eight screenshots,
  one per matrix, proving hostile stored bytes reached the real API/DOM as
  literal text with zero injected image elements and no compromise flag.
- Each matrix used real disposable PostgreSQL cookie-session, tenant, member,
  workforce, and crew authority; recorded nine Today responses; and observed
  zero provider/external calls, worker mutations, or browser errors.

Raw terminal evidence uses the `realistic-b51f467-*` filenames under `raw/`.
The older compatibility, full-corpus, and startup/restart results below remain
historical evidence for implementation commit `e72792d`; they were not rerun or
relabeled for this evidence-only correction. The final independent audit at
`3ddd332` preserved its unrelated full-corpus result of 2,132/2,133 tests as
red; writer evidence does not convert it to passing.

## Historical first-correction gates

All terminal correction gates below exercised implementation commit
`e72792da9edbee3b051fd34f14cd810324870e8b` / tree
`2a6d9a61557dadd2bb3f5593fc6c202ec30995f4`.

- Focused mounted Part 6 production modules: 2/2 suites, 15/15 tests.
- Explicit Parts 1–6 compatibility: 13/13 suites, 172/172 tests.
- Full locally available corpus: 153/153 suites, 2,133/2,133 tests on
  PostgreSQL 18.4 UTC, data checksums on, `max_connections=100`.
- Installed Chrome 151.0.7922.175 and actual Playwright WebKit 26.5: all eight
  desktop/mobile light/dark matrices passed, 96 screenshots total.
- Browser matrices: strict signed-in employee destination allowlist; every
  inspectable signed-in response; exact mounted logout JSON; every observed
  logout/public-login redirect request matched by one response; durable session
  revocation; no cached private cards; zero external/provider calls; zero worker
  mutation requests; zero browser errors.
- Screenshot aggregate: 8 matrices, 96 rows, 107 package files; 56 non-ready or
  empty rows with zero private-field visibility claims; 32/32 synthetic rows
  identify their exact Playwright transport provenance and disclaim durable
  authority.
- Fresh startup/restart: 33 migrations once, migration 035 exact checksum once,
  zero migrations on restart, two credential-free health 200 responses,
  restricted runtime role, zero provider credentials, zero stderr.

Raw terminal evidence uses the `e72792d` or `max100-e72792d` filenames under
`raw/`. The earlier red diagnostics and the first wrong-identity full run remain
preserved and are not relabeled passing.

The 24 tests in `account-migration-010-postgres.test.js` require four absent
`ACCOUNT_MIGRATION_*` disposable URLs. They remain unavailable, not fabricated
and not passing. Optional Codex Security infrastructure, hosted checks,
physical Safari/devices, provider readiness, production data, deployment, and
user visual approval remain unavailable or outside this writer's authority.
