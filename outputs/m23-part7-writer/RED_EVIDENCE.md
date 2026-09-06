# Part 7 tests-first red evidence

Exact released base: 6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9.
Before any implementation, the two new focused suites failed: 10/10 mounted
cases failed, and the unit suite could not load the absent progress contract.
Mounted production POST /:executionId/progress-actions returned 404 instead of
201; duplicate-key input returned 404 instead of 400; PostgreSQL authority was
absent (42P01), not present and permission-denied (42501).

Initial environment setup failure: copied Linux dependency inventory omitted
the installed Windows optional resolver binding; copied the same installed
binding from the preceding independent audit checkout. No package/lock change.
The first red JSON write failed because its output directory did not exist.
The same tests are rerun unchanged into red-results.json before implementation.

Command: node node_modules/jest/bin/jest.js --runInBand --silent
tests/unit/m23-part7-progress.test.js
tests/integration/m23-part7-progress-postgres.test.js --json
--outputFile=outputs/m23-part7-writer/red-results.json

Disposable PostgreSQL 18.4 only, 127.0.0.1:55483; production/provider calls absent.
