# Intermediate failures

The following reds were preserved and corrected during this writer turn:

- The first mounted assertion expected the unnormalized query text `ZZZ `;
  production correctly returned canonical `ZZZ`. The assertion was corrected.
- A focused mounted preview used the wrong historical fixture/action. A dedicated
  target-discovery appointment was added; the complete mounted workflow passed.
- The deactivated-target assertion expected `M22_PREVIEW_DIVERGED`; the existing
  authority correctly returned `M22_EVIDENCE_STALE`. The assertion now preserves
  that established contract.
- The first Chrome desktop flow assumed an omitted dispatcher remained in the
  initial 100 profiles. The test was corrected to use the real visible search.
- A later Command Center offline flow had the same stale assumption and was
  corrected to use visible search before preview.

No final product failure remains in the mounted/affected/historical/browser
gates. The repository corpus retains exactly the expected 24 unavailable account-
migration cases because required disposable URLs are absent; this is neither a
Part 5 product red nor a pass.
