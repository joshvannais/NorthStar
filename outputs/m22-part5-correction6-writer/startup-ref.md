# Startup and protected-reference evidence

- PostgreSQL `18.4`, timezone `UTC`, data checksums on, loopback-only, and
  `max_connections=100` for mounted and corpus evidence.
- First role-separated production start applied all `33` repository migrations;
  same-database restart applied `0`.
- Migration 035 applied exactly once; source/ledger SHA-256:
  `96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`.
- Both credential-free `/api/health` requests returned `200`; PostgreSQL and
  canonical persistence were healthy; stderr was zero bytes.
- Restricted runtime role could create neither databases nor objects in
  `public`.
- Provider credentials were omitted.

Migrations 001–035 are byte-for-byte unchanged from the frozen parent and
migration 036 does not exist.
