# Part 9A functional correction red evidence

Production baseline: `c22de9d053b65814fd59ae471e97d9eea01e3da3`.
This tests-first commit changes no production file.

Finding authority is the terminal independent audit by task
`01a07eca-d97f-7bf2-9436-c4168f5ef2e8`: exactly three functional P2 findings,
not confirmed security vulnerabilities. Report SHA-256
`de9670c8b424771b643a3bcb38f08c55b5219bdc39adc4a4cedf46c48eaf5f92`,
findings SHA-256 `a91e668139517c161067eeb6720eb1899cdf2e8f1798ce0bbee4938e272836b9`,
manifest SHA-256 `75e5e6581549245bc27c70849bf62c22a0381964a652086be1f1bb597bd2a820`.
All three were read in full and rehashed before correction work.

The mounted Chrome regression uses ordinary synthetic field text, production
HTML/scripts and production action normalizers, with every API intercepted.
It records eight failures out of fifteen cases:

- F1: unavailable evidence, unavailable next page, a 21-inspection bound,
  missing second-page pins, and evidence changing before confirmation.
- F2: an inspection predecessor remains selected alongside its correction.
- F3: both opener-created and explicitly copied-sessionStorage tabs restore
  the original draft and reuse the original persisted retry identity.

Same-tab reload and six desktop/mobile light/dark layout checks pass. There
are zero page errors and zero external requests in the validated red run.
No exploit, provider call, production access, or backend mutation occurred.

Artifacts under
`C:/Users/joshv/Documents/Codex/2026-09-07/m23-part9a-corrections-c22de9d/`:

- `red-chrome-validated/results.json`: SHA-256
  `88ae2e92d0f26ef3fab36a47849cdcc9b9e192e3c53f7eba0342b1b1d1166339`.
- `red-unit.json`: 21 red contract tests for the required shared production
  helpers, not yet implemented; SHA-256
  `2280ea2a6b1445531f4744d83aca3d533290c51b75b7fce2cc4ba65fee654f46`.
- Initial `red-chrome/results.json`: SHA-256
  `6a46ec388921bd76e067cb4ca3145fda3ab6e948265a81ea84a06193e4096edd`.
  It contains the same eight functional failures plus a test-only theme
  initializer error on about:blank. The initializer was confined to HTTP
  documents before the validated red run; no production behavior was changed.

The bounded correction may change only work-page.js and its existing browser
coordinator, focused tests, and new correction evidence. Migration053,
accepted backend authority, calculator and other protected paths remain
unchanged. Existing non-green and unavailable controls remain explicit.
