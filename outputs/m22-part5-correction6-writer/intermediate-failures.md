# Intermediate failures

The following reds were preserved and resolved during this writer turn:

- The first mounted Part 4 run produced four 503 failures because a real `pg`
  `PoolClient` exposes both `connect` and `release`; the composable helper
  initially mistook it for a pool and attempted to reconnect. Ownership now
  keys on `release`, and the exact client is reused without nested transaction.
- A valid retirement race fixture initially violated the established business-
  profile retirement check by omitting `retired_at`; the fixture now performs
  the same valid durable transition as production.
- Session deletion initially reused a session already referenced by immutable
  audit evidence. A dedicated disposable mounted session now proves deletion
  without attempting to rewrite audit history.
- Historical fake-auth fixtures omitted the exact session ID, causing 16/106
  failures. The fixtures now mount the same current session authority required
  by production; the complete historical gate passed `106/106`.
- The first full corpus had one additional remediation-outage red because the
  test monkeypatched `pool.query`, while corrected routes query their owned
  client. The fixture now injects only the promise-style route client while
  preserving callback-style authentication pool behavior. The isolated test
  passed, and the terminal corpus reached only the known 24 unavailable cases.
  Final process inventory found the leaf Jest process from the earlier timed-
  out attempt still waiting; its exact command identity was verified and only
  that leaf was stopped. Its parents exited normally, and the terminal task
  runtime inventory is zero.
- Final contract review briefly tried an explicit PostgreSQL `READ ONLY`
  declaration for the existing overview transaction. PostgreSQL correctly
  rejected its established `FOR SHARE` authority locks. The transient change
  was reverted; the transaction remains bounded, mutation-free, and
  repeatable-read. The first two post-review commands also used obsolete
  disposable identity variable names and stopped before product execution.
  The exact corrected mounted rerun then passed `28/28`.

No final Part 5 product failure remains in mounted, affected, historical,
browser, or startup gates. Exactly 24 account-migration cases remain unavailable
because four URL groups are absent; this is neither passing nor a Part 5 red.
