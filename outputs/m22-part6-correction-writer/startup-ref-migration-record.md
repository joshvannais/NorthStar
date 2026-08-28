# Mission 22 Part 6 correction startup, reference, and migration record

The correction adds no schema authority. Base-to-implementation migration path
count is zero; migration 036 does not exist. Migration 035 source SHA-256 is
`96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`.
The terminal protected-migration ledger and exact remote identities are frozen
again after the evidence commits and push.

The role-separated PostgreSQL `18.4` UTC startup/restart harness passed:

- 33 repository migrations on the fresh database;
- migration 035 applied exactly once with the source checksum above;
- zero migrations on restart;
- first and second credential-free `/api/health` requests returned 200 with
  PostgreSQL and canonical persistence healthy;
- runtime role could create neither a database nor objects in `public`;
- first and second startup stderr were zero bytes;
- all provider credentials were omitted.

The terminal superseding full locally available corpus used the same exact
workspace-contained server with data checksums on and its ratified
`max_connections=100` identity. The startup/restart result is frozen in
`raw/startup-restart-e72792d.json`; its stderr is zero bytes.

The first wrapper invocation without the explicit disposable admin URL stopped
before application execution and remains preserved as intermediate evidence.
The terminal run used only the isolated PostgreSQL 18.4 fixture already in this
writer workspace. It is not a production migration, deployment, or provider
claim.
