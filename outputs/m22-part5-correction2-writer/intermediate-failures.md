# Preserved intermediate failures

1. The initial uppercase-UUID unit fixture contained only digits in the UUID
   portion being uppercased. The fixture was corrected to include letters; the
   parser itself was unchanged and the terminal cursor suite passed 21/21.
2. Disposable PostgreSQL initialization was denied under the restricted token.
   The already-authorized elevated initialization succeeded without changing
   provenance.
3. An initial `pg_ctl` listen-address quoting form was invalid. The bounded
   launch syntax was corrected and PostgreSQL 18.4 UTC identity passed.
4. The first mounted Jest invocation omitted required disposable-server identity
   variables. They were supplied and the same focused tests passed.
5. One Parts 1–5 run passed 68/68 but Jest exited after it could not write JSON
   because the raw evidence directory did not yet exist. The directory was added
   and the same 68/68 suite reran terminally with JSON.
6. The initial full corpus returned 149/152 suites and 2,107/2,134 tests. Twenty-
   four were the known absent account-migration URLs; three exposed that a newly
   signed-up pending owner was incorrectly blocked from generic canonical status.
   The endpoint was narrowed to omit broad count data for nonoperators while
   preserving generic status, and the terminal corpus reached 151/152 and
   2,110/2,134.
7. The first focused compatibility rerun expected a suspended dispatcher to
   receive generic status, but production authentication correctly denied the
   inactive membership before the handler. The test expectation was restored to
   `403`; the terminal mounted authority suite passed 18/18.
8. The first unprivileged shutdown attempt could not signal the disposable
   PostgreSQL process. The authorized stop succeeded; no test database was
   treated as still running.

No intermediate red was discarded or represented as a pass.
