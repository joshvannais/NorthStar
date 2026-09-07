# Mission 23 Part 9A mixed-snapshot browser red evidence

Captured before adding the mounted work-page snapshot fence.

Command:

`node tests/browser/m23-part9a-worker-operational-experience.js --browser=chrome`

Installed Chrome `152.0.7977.82` executed the mounted production page. The
ordinary desktop/mobile/theme cases passed through the new checklist retry
exercise: the intercepted production contract accepted both requests, and the
same body and idempotency key were retained across a deliberate HTTP 503 with
`Retry-After: 1` before one confirmed refresh.

The run then failed at the intended negative control because a Today snapshot
at execution revision 3/digest `b...b` was combined with an execution read at
revision 4/digest `f...f`, yet the page reported `ready` instead of `stale`.
This proves the page did not yet reject a mixed server snapshot.

Generated red ledger: `outputs/m23-part9a-worker/chrome/evidence.json`, SHA-256
`a2d82155b5b37cb10d1adea8bbbc284d1d6aabbef8d8aef2a4b81c60e8e60bb8`.
No provider or external call was made.
