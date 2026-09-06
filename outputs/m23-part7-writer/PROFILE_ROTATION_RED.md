# Part 7 profile-rotation correction — preserved red

Rejected candidate: `252b3606c67ea7434c9c8dcc67d369f6a313b252`, existing
branch `review/m23-part7-progress-issues`, draft PR #171. Main remains
`6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9`.

The independent audit's one P2 is a same-tenant workflow failure, not an
attacker-benefiting exploit: retirement of historical Business Profile pins
strands inherited reviews and issue lifecycle transitions. Its sealed verdict
SHA-256 is `35f7c41010e20051d2558d3f2ec628bce963eeca6d810e1a703756a3631da5dc`.

Before changing runtime/migration code, these new tests used the production
Business Profile writer to rotate versions, both retaining UTC and changing to
America/New_York. Production signed-cookie HTTP requests reproduced six 403s:
two owner-review cases and four assigned-worker blocker/exception cases.
The ordinary mounted create control and two strict-contract controls passed.

Command (existing explicit synthetic loopback runner; no inherited credentials):

```text
node --check tests/integration/m23-part7-progress-postgres.test.js
node --check tests/unit/m23-part7-progress.test.js
node outputs/m23-part7-writer/run-tests.js rotation-red tests/integration/m23-part7-progress-postgres.test.js tests/unit/m23-part7-progress.test.js --testNamePattern="profile rotation|replacement profile|mounted production router"
```

Syntax: pass. Tests: **6 failed, 3 passed, 86 untargeted/skipped**, 2 suites,
9.715 seconds. The six failures are expected HTTP 201 vs observed HTTP 403,
not fixture/setup errors. The fixture's initial version label was made a valid
production `org-profile-v1` label so the real versioned writer is exercised.

Raw non-overwritten `rotation-red-results.json` SHA-256:
`d23794053d7befbb694aff35f8d74f51f54ecf00209fd7720b2ec715b4da03b9`.
PostgreSQL 18.4, loopback 55483, UTF-8, UTC, checksums on, separate nonprivileged
owner/runtime roles; synthetic databases and roles cleaned by fixture teardown.
No release, production, provider, UI, or independent approval is claimed.
