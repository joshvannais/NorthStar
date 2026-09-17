# Mission 25 Part 11G acceptance evidence

## Frozen authority

- Base: `410c7c5ddaf73a6962c0f2d44e64fb6d1b5a1ff3`, independently accepted Part 11F.
- Scope: provider-neutral lifecycle, historical and continuous checkpoints, retention, deletion, legal/audit holds, and bounded source cleanup only.
- Excluded: Part 11H Learning Center, provider credentials, live providers, operational writes, production and release mutations.

## Implemented authority

- Migration `111_canonical_external_material_import_operations.sql` adds immutable adapter, retention, deletion, hold and cleanup chains.
- Deletion revokes source consent in the same serializable transaction and blocks grant until explicit cancellation.
- Cleanup is owner/administrator only, one to 100 records, cursor resumable, idempotent and detail minimizing.
- One tenant-and-source lifecycle gate orders hold, retention, deletion and cleanup transactions; stale waiters retry with current authority.
- Current legal or audit holds are rechecked immediately before evidence selection and block cleanup while allowing source permission to be revoked.
- Runtime access is limited to guarded entry functions; protected tables and helpers remain unreadable.

## Evidence boundary

Fresh disposable PostgreSQL, mounted API/adversarial, A-F compatibility and focused regression results are recorded with the committed candidate. No provider, private production data, deployment, physical-device review or Part 11H rendered acceptance is claimed.

## Legal-hold race correction evidence

- Fresh PostgreSQL 17 applied migrations 001–111 and passed ten mounted Slice G cases. The cases cover hold-first and cleanup-first ordering, release versus cleanup, retention and deletion changes, replay/conflict, cursor reset, 100+1 batching, consent non-revival, tenant/ACL isolation and immutable authority.
- All mounted Part 11A–F exercises passed against the corrected migration. The Part 11B performance exercise remained below its two-second evidence ceiling: cold 100 records 119.70 ms; 1/50/100 records 31.90/44.71/53.84 ms; repeated 100-record pages 55.06/61.97 ms.
- Fourteen Part 11A–G contract and ratification suites passed with 48 assertions. Four related Mission 23/24 material, plan, adoption and cost-composition suites passed with 132 assertions.
