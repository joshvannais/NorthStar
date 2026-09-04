# Mission 23 Part 2 — Writer correction and test change log

| Stage | Finding | Correction | Verification |
| --- | --- | --- | --- |
| Pre-execution migration review | Initial control-character validation attempted to apply a regular expression to binary UTF-8 bytes. | Replaced it before migration execution with an explicit bounded byte loop while retaining NFC, character, and octet limits. | Fresh automatic migration 001–038 passed PostgreSQL 18.4. |
| First PostgreSQL adversarial run | The read entry point called a shared actor-authority query that always acquired `FOR SHARE`, which PostgreSQL correctly rejected inside a read-only transaction. | Mutation authority keeps row locks; read authority performs the same server-side validation without a locking clause. Read repository remains `REPEATABLE READ READ ONLY`. | First DB run: 7/10. Corrected rerun: 10/10. |
| First PostgreSQL adversarial run | PG18 does not expose `lc_collate` through `current_setting`, and the unsupported later-part action correctly mapped to input status 400 rather than the test's 503 expectation. | Read collation from `pg_database.datcollate`; corrected the expected validation status without changing runtime behavior. | Corrected DB rerun: 10/10. |
| Evidence ratification | Two string assertions did not tolerate the durable ledger's full migration path and Markdown line wrapping/case. | Assert the full path and semantic regular expressions. No production/runtime logic changed. | Focused ratification: 9/9; complete ratification: 314/314. |
| Final contract-to-schema review | Event session attribution originally used the globally unique session primary key rather than the root contract's required tenant-composite relationship. | Bound the event to the existing `(organization_id, recorded_by_user_id, auth_session_id)` session authority. | Focused/related: 99/99; full ratification: 314/314; broad unit: 5,281/5,281; PostgreSQL cross-contract: 41/41. |
| Final production-receipt ratification | An exact-string assertion did not tolerate the dated receipt wrapping `zero checksum mismatches` across a Markdown line. | Replaced only that assertion with a semantic whitespace-tolerant match; the production receipt and runtime were unchanged. | The same final focused, ratification, broad, and PostgreSQL gates passed. |

No correction modified protected migration 001–037. Migration 038 was committed
and frozen before its blob/hash receipt was created; later documentation/test
commits do not change its bytes.
