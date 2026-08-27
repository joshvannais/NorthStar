# Startup, restart, migration, and cleanup evidence

- Fresh role-separated production startup used PostgreSQL `18.4` with `UTC`.
- First start applied all `33` repository migrations; restart applied `0`.
- Migration 035 applied exactly once and ledger/source SHA-256 both equal
  `96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`.
- Both credential-free `/api/health` requests returned `200`, with PostgreSQL and
  canonical persistence healthy and zero stderr bytes.
- Runtime role was non-superuser and could create neither databases nor objects
  in `public`.
- Provider credentials were explicitly omitted.
- The fresh startup database and roles were removed by the harness. The shared
  disposable writer PostgreSQL service was stopped after the terminal corpus.

No migration was added or edited. Migrations 001–035 remain protected; there is
no migration 036.
