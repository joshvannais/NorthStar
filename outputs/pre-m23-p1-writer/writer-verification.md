# Pre-Mission 23 P1 writer verification

## Source and topology gates

- Immutable base: `b0cb136b78b6741566556c59b26d9e0e4fdd3cc1`
- Base tree: `9456330673d7308ff3c47c7bcff821ebc12df71b`
- Branch: `pre-m23/p1-design-system-employee`
- Full-history isolated sparse checkout was required only because historical root filenames are invalid on Windows; protected source paths are present and the checkout began clean at the exact base.
- No migration, dependency, server authority, provider, credential or production configuration change belongs to this package.

## Writer checks

- `npm test -- --runInBand tests/ratification/m19-universal-navigation-authority.test.js tests/unit/post-m22-visual-corrections.test.js tests/unit/pre-m23-p1-design-system.test.js tests/unit/m22-part6-mobile-today.test.js tests/ratification/command-center-parity-prelude.test.js`
  - 5 suites / 52 tests passed.
- `node --check tests/browser/pre-m23-p1-visual-foundation.js`
  - passed.
- Chrome mounted visual matrix:
  - 14 ordinary screenshots.
  - 2 separately stored hostile/security screenshots.
  - desktop and 320/375/390/430 mobile widths, both themes.
  - no horizontal overflow; true-top/sticky header, one-line identity, footer links, real Sign Out, current theme labeling and inert hostile rendering asserted.
- `git diff --check`
  - required before freeze; CRLF conversion warnings are informational on this Windows checkout.

## Known inherited failure, not changed by P1

On a fresh disposable PostgreSQL 17/UTC authority, the inherited Mission 22 approval browser/integration path fails before P1 visual assertions because the runtime role cannot execute `canonical_schedule_part4_approval_request_digest` from `canonical_schedule_validate_human_approval_completion()`. The failure exists at the exact base and is outside the P1 design/Today visual scope. It remains unavailable rather than passing.

PostgreSQL 18 identity, hosted CI, physical Safari/devices, provider credentials/calls, private production logs/rows and production acceptance are unavailable in the writer lane. A fresh independent exact-head audit and separate user visual approval remain required.
