# Mission 22 Part 6 correction preserved intermediate failures

1. The independent exact-head audit at
   `7bccaeb41f1595237309888e5858e3afc7efc07d` froze
   `CHANGES_REQUIRED` with `P0 0 / P1 1 / P2 3 / P3 0`. Its report,
   findings, coverage, verdict, source/sink, and 36/36 artifact manifest hashes
   remain the authority for M22-P6-AUD-001 through 004; writer evidence is not
   substituted for that audit.
2. Front-loaded correction unit coverage was initially 4/10 green because the
   minimized Today shell, real-IANA fixture helper, and corresponding contracts
   did not yet exist. The focused contract reached 10/10 only after those
   boundaries were implemented.
3. The first combined static/ratification run was 1/2 suites and 14/15 tests
   green: the Git-tree reachability ledger correctly did not see the then
   untracked `public/js/today-shell.js`. After the implementation commit made
   the new script an immutable tree entry, the focused ratification passed 5/5.
4. An early Chrome diagnostic blocked while trying to read a no-body telemetry
   response. A bounded response-capture timeout made the failure explicit; the
   next run then rejected `/js/product-telemetry.js` as an unapproved employee
   destination. Today now suppresses that broad operator script while every
   non-Today surface retains existing theme/telemetry behavior.
5. The first real logout probe returned 403 because its disposable fixture had
   no durable refresh-token authority. The corrected fixture creates a separate
   real refresh-token row and cookie and proves the visible logout POST revokes
   the database session and clears prior work.
6. The first terminal-matrix invocation failed before application execution
   because `M19_TEST_RUN_ID` was omitted. The raw error is preserved as
   `raw/intermediate-browser-missing-run-id.stderr.log`; each terminal matrix
   used a distinct bounded disposable run identity.
7. The next desktop matrix timed out on logout because the harness selected the
   inert off-canvas mobile link instead of the visible desktop sidebar link.
   Raw output is preserved as `raw/intermediate-browser-inert-control.*`. The
   harness now addresses the exact active shell region and the rerun passed in
   both desktop and mobile matrices.
8. The first startup/restart wrapper invocation omitted the explicit disposable
   PostgreSQL admin URL and stopped before application execution. Its raw error
   is preserved as `raw/intermediate-startup-missing-admin.stderr.log`; the
   bounded rerun used the already-running PostgreSQL 18.4 UTC fixture.
9. A bypass-review experiment attempted to read the authenticated logout JSON
   body after the app's real redirect. Chrome correctly discarded the prior
   navigation resource before Playwright could read it, twice. Those raw errors
   are preserved as `raw/intermediate-browser-logout-body-race*`. The terminal
   proof keeps the product's navigation authentic: it checks the exact response
   status, real POST destination, durable session revocation, login redirect,
   and absence of cached work, while complete-body inventory remains on every
   actual response event in the signed-in Today page context.
10. The first recovered-writer logout response-inventory probe waited for a body
    from the public login page's intentionally bodyless `202 /api/telemetry`
    response and hit its explicit ten-second bound. The raw output is preserved
    as `raw/browser-aaeef4d-diagnostic.*`. The capture now records that known
    bodyless response as an empty body, matching the already established signed-
    in response inventory behavior; no endpoint or telemetry authority changed.
11. The next probe used Playwright's global `networkidle` heuristic after the
    real login navigation. The public telemetry client intentionally kept that
    heuristic non-idle until its 30-second bound even though all bounded route
    responses completed. Raw output is preserved as
    `raw/browser-bab01ff-diagnostic.*`. The terminal proof waits for the real
    login `load` event and the exact initial `202 /api/telemetry` response, then
    reconciles every observed request with one response; it does not redefine
    product network behavior or wait on an unrelated global heuristic.
12. The first recovered-writer full-corpus run used `max_connections=200` on
    the otherwise exact PostgreSQL 18.4 UTC cluster. Seven mounted suites
    correctly rejected that environment because their ratified production-
    parity identity requires `max_connections=100`; 146/153 suites and
    2,104/2,133 tests passed, with one additional concurrency test timing out
    under the failed run. Raw stdout/stderr are preserved as
    `raw/full-available-e72792d.*`. The exact cluster is restarted with its
    required 100-connection identity before the superseding complete run; no
    test expectation or production code is changed.
13. The first failed Chrome logout diagnostic left exactly one disposable
    browser database and its two role-separated test roles in this writer-owned
    PostgreSQL cluster. Their names, owner, zero connection count, and
    nonprivileged attributes were reverified before deletion. The exact database
    and two roles were removed; the cluster then reported zero non-template
    databases and zero non-system roles before the superseding full run.
14. The independent final audit at exact head
    `3ddd332a1c6cb50c86897783347d495700859e2b` froze `CHANGES_REQUIRED` with
    `P0 0 / P1 0 / P2 1 / P3 0`: all 32 ready employee-package screenshots
    visibly embedded the literal hostile XSS fixture, making the otherwise
    XSS-safe package unrealistic for customer-facing handoff. Report SHA-256:
    `8a969e0c02fd50fb92c2c0d4284622544cfca9d1c68052fd84647b8bc6a1193c`.
15. The first evidence-correction browser diagnostic was invoked without the
    required `M19_TEST_RUN_ID` and stopped before application execution.
16. The next diagnostic compared a JavaScript-decoded marker with its JSON-
    escaped transport representation. The proof now checks the raw response
    marker separately from exact DOM `textContent`.
17. An early realistic-fixture assertion read collapsed layout text before the
    ready card was expanded. It now asserts exact mounted API values and the
    state-appropriate DOM content.
18. The simulation-authority fixture intentionally canonicalizes all work onto
    one customer record. Two diagnostics therefore observed the last temporary
    customer value where separate per-job customers had been expected. The
    realistic fixture now uses one truthful Jamie Carter / 125 Maple Avenue
    customer projection consistently across all canonical work.

Items 15–18 were bounded interactive diagnostics and did not produce durable
raw files; their exact failure classes are preserved here rather than omitted
or relabeled. The superseding focused run and all eight matrices are frozen in
`raw/realistic-b51f467-*`.

None of these failures is relabeled as passing. Terminal results are recorded
separately, and a different fresh exact-head auditor remains mandatory.
