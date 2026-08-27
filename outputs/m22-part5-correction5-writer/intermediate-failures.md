# Intermediate failures

The following reds were preserved and resolved during this writer turn:

- The first sandboxed `pg_ctl` start failed at the Windows restricted-token
  boundary. The exact task-scoped disposable cluster was started through the
  authorized elevated path; no unrelated cluster or process was touched.
- The first browser command lacked the exact disposable PostgreSQL identity
  environment and stopped before product execution. The established directory,
  port, and run ID were supplied; all four matrices then passed.
- Historical fixtures still expected a request-supplied `subscriptionMutable`
  boolean to override current durable subscription state, and one fake-auth
  mount omitted the exact durable session UUID. The fixtures were corrected to
  mount current DB/session authority. The isolated transcript test passed, then
  the complete historical gate passed `106/106`.
- The first broad corpus attempt inherited `max_connections=120` while mounted
  account suites require exactly 100. It was stopped after preserving the
  identity red. The next restart had 100 but PostgreSQL's default
  `listen_addresses=localhost`, which the loopback-only identity gate correctly
  rejected. The final exact disposable identity was PostgreSQL 18.4 / UTC /
  checksums on / max connections 100 / listen address 127.0.0.1; the corpus then
  reached its expected terminal truth.

No final Part 5 product failure remains in the mounted, affected, historical,
browser, or startup gates. Exactly 24 account-migration cases remain unavailable
because four disposable URL groups are absent; this is neither passing nor a
Part 5 product red.
