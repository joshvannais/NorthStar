# Startup and immutable reference evidence

## Start reference

- Base/live main: `e20facc5937dc0581c9194ddf70b331b49de5188`.
- Branch: `mission22/part5-owner-dispatcher-ux`.
- Independently audited parent: `0a06ec5dccd4edc8b62ed89888b439cdcad874d4`.
- Parent tree: `d7fcc3025c0182b232d3787a058cedc477cd77c0`.
- PR #148 was OPEN/DRAFT/CLEAN/MERGEABLE with generated merge ref beginning
  `80650f6`; hosted checks were empty.
- No Part 5 writer/auditor/test overlap existed at correction start.

## Startup/restart

- Fresh role-separated production startup on PostgreSQL 18.4 UTC applied all
  33 repository migrations; same-database restart applied zero.
- Migration 035 applied exactly once. Source and ledger SHA-256:
  `96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`.
- Both credential-free `/api/health` requests returned 200 with PostgreSQL and
  canonical persistence healthy; both stderr streams were zero bytes.
- Runtime role was non-superuser and could create neither databases nor objects
  in `public`.
- Provider credentials were omitted. The disposable startup database, roles,
  server processes, and temporary data directory were removed.

The exact correction head/tree/parent and remote PR topology are frozen by the
terminal handoff after the one normal commit/push. A commit cannot contain its
own SHA; this artifact pins the immutable parent and protected identities.
