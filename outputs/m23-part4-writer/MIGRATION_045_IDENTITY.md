# Migration 045 frozen identity

The forward-only Mission 23 Part 4 rolling-upgrade correction is frozen at its
first source commit. Migrations 001–044 remain byte-for-byte unchanged.

- Source commit: `e3912055f48d263acd2f43c572f05431fefdf80e`
- Source tree: `865820d32fca9364ce4ec2fc350bdf6a5b1c23b6`
- Path: `migrations/045_canonical_material_authority_upgrade_fence.sql`
- Git blob: `e54f935d6a6648479226005ff7a45e7278527d52`
- Raw bytes: `2,050`
- Canonical runner bytes: `2,050`
- Raw and canonical SHA-256:
  `24b8249c0b686b497e5251516f9a7663947ee6ac491fe9d132fb3b8bc020e9ee`

Protected predecessor migration 044 remains Git blob
`1cf68d95f77e717ebb34c1d50c05cceb658bd135`, 3,995 bytes, SHA-256
`8d4c895fb06d5b0dc49ee968ad64d777efa9d1b861094f00571170e4d6e6b32d`.

Migration 045 closes the rolling-upgrade interval in which a writer could have
entered through the old migration 043 trigger before migration 044 installed
the steady-state fence. It acquires all eleven supporting-authority table locks
through a bounded NOWAIT retry, takes the established exclusive advisory lock,
and advances the fence in the same migration transaction. An old writer must
finish before the locks can be acquired; a new writer cannot enter while those
locks are held.

The repository runner additionally bounds this frozen migration to a 5,000 ms
lock timeout and a 20,000 ms statement timeout, preserving tighter operator
settings. Success restores the original settings; failure rolls back all locks,
fence and ledger changes. The SQL file itself is unchanged.

The bounded production-history receipt at
`a568b08c9ffc7dd353864fffe2f2d07f2c5cb1ee` predates migrations 043–045. It
does not establish compatibility, application, or release for this frozen
source set. A credential-silent SELECT-only production-history preflight for
the exact final candidate, fresh independent audit, and all release evidence
remain required.
