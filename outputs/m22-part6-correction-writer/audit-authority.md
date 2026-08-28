# Mission 22 Part 6 independent audit authority

The correction is bounded to the independent exact-head audit under
`outputs/m22-part6-7bccaeb-independent-audit` outside this branch checkout.

- report SHA-256:
  `dc97d0498ccc5d6243404ef3cee612f3ac9bbacf25fd6f9629a94a3c927baf2b`
- findings SHA-256:
  `dff85e489c172628c6e07fadcb03eb22f10095c85506e22d0665ee1b5bc8d6bc`
- coverage SHA-256:
  `d267547376400e756829d77cd2136eb424d47dc5551574e2abceb5c989fb7cba`
- verdict SHA-256:
  `f79da520efa5a5137fc4242348234d5c3d981cf9d366e6fb9f0b2d5b859f793b`
- source/sink SHA-256:
  `0f2f9febd443bd04d4e16763144d12cc822799486667a34abdc9561dbf829f66`
- audit manifest SHA-256:
  `04c9c5eaffe96ec7d96b40b8fb7d088472555bdb5d24a620b47d96d18cae1e29`
  with 36/36 rows verified.

Verdict: `CHANGES_REQUIRED`, `P0 0 / P1 1 / P2 3 / P3 0`, for exactly
M22-P6-AUD-001 through 004. The writer does not self-audit or convert its green
tests into approval; a different fresh exact-head auditor is required.
