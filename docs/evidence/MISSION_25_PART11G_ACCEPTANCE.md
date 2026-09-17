# Mission 25 Part 11G acceptance evidence

## Frozen authority

- Base: `410c7c5ddaf73a6962c0f2d44e64fb6d1b5a1ff3`, independently accepted Part 11F.
- Scope: provider-neutral lifecycle, historical and continuous checkpoints, retention, deletion, legal/audit holds, and bounded source cleanup only.
- Excluded: Part 11H Learning Center, provider credentials, live providers, operational writes, production and release mutations.

## Implemented authority

- Migration `111_canonical_external_material_import_operations.sql` adds immutable adapter, retention, deletion, hold and cleanup chains.
- Deletion revokes source consent in the same serializable transaction and blocks grant until explicit cancellation.
- Cleanup is owner/administrator only, one to 100 records, cursor resumable, idempotent and detail minimizing.
- Current legal or audit holds block cleanup while allowing source permission to be revoked.
- Runtime access is limited to guarded entry functions; protected tables and helpers remain unreadable.

## Evidence boundary

Fresh disposable PostgreSQL, mounted API/adversarial, A-F compatibility and focused regression results are recorded with the committed candidate. No provider, private production data, deployment, physical-device review or Part 11H rendered acceptance is claimed.
