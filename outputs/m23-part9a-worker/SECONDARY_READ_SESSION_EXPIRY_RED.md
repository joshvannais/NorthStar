# Mission 23 Part 9A secondary-read session-expiry red evidence

Captured before fail-closing the mounted work page when any authoritative
secondary read reports that the session or assignment scope is no longer
current.

Command:

`node tests/browser/m23-part9a-worker-operational-experience.js --browser=chrome`

The authentic mounted Chrome run first loaded the current Today projection and
execution pointer, then returned HTTP 401 `SESSION_NOT_CURRENT` from the labor
read while the other bounded reads were in flight. The page incorrectly
reported `partial-file` instead of clearing the prior tenant presentation and
entering `restricted`.

Exact failure:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'partial-file'
- 'restricted'
```

Generated red ledger:
`outputs/m23-part9a-worker/chrome/secondary-read-session-expiry-red.json`

- bytes: `220979`
- SHA-256: `5882753b1bd27180f9d7cac753934f254b1192638b12f6fb1f4f2870726524b3`
- provider or external calls: zero

This is a scope-required session-rotation and mixed-read fail-closed defect. It
does not authorize provider, production, or cross-slice work.
