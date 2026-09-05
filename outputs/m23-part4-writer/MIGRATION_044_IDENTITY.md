# Migration 044 frozen identity

The forward-only Mission 23 Part 4 terminal audit correction is frozen at its
first source commit. Migrations 001–043 remain byte-for-byte unchanged.

- Source commit: `f8bbf55080af2a3e617124f12ee658fd544a46f0`
- Source tree: `01e9e3edc00053e496c8379d05afde2be831154c`
- Path: `migrations/044_canonical_material_authority_snapshot_fence.sql`
- Git blob: `1cf68d95f77e717ebb34c1d50c05cceb658bd135`
- Raw bytes: `3,995`
- Canonical runner bytes: `3,995`
- Raw and canonical SHA-256:
  `8d4c895fb06d5b0dc49ee968ad64d777efa9d1b861094f00571170e4d6e6b32d`

Protected predecessor migration 043 remains Git blob
`90379f78425cbe476ab8406e2bed33c6c575d16a`, 16,936 bytes, SHA-256
`9f9d43d1d631953203a0d45accdfc757f3ce005a81cd4915c06bf2c3fd6ec228`.

Migration 044 adds the database-enforced supporting-authority snapshot fence.
Every existing authority-writer trigger advances a singleton MVCC row while
holding the exclusive advisory lock. A material entry must already hold the
shared counterpart and then lock that row. PostgreSQL rejects a
repeatable-read or serializable caller whose fixed snapshot predates a
committed fence replacement, so material mutation, replay, and read fail closed
rather than reusing stale authorization state. The runtime role has no direct
fence-table privilege.

The bounded production-history receipt at
`a568b08c9ffc7dd353864fffe2f2d07f2c5cb1ee` predates migrations 043 and 044. It
does not establish compatibility, application, or release for this frozen
source set. A credential-silent SELECT-only production-history preflight for
the exact final candidate, fresh independent audit, and all release evidence
remain required.
