# Mission 25 Part 12J candidate evidence

- Exact base: `0d901e96af34725ad5d6442d65d90b2d791bc3ba`.
- Migration `122_canonical_external_business_source_operations.sql` adds immutable provider-neutral adapter, retention, deletion, hold and cleanup authority for all four accepted Part 12 source classes.
- Migration 122 runs inside the reviewed transaction timeout lane: a normal database receives a 5-second lock cap and 20-second statement cap, while tighter inherited operator limits remain tighter.
- Fresh disposable PostgreSQL 17 applies migrations 001 through 122 with separate migration and runtime roles. Runtime receives only six guarded entries and no table or helper access.
- The mounted production learning router verifies deletion-triggered source-permission revocation, permission and import blocking while deletion is active, active-hold blocking, deletion cancellation plus a new empty permission period, and no revival of earlier source detail across CRM/field-service, project/change-order, communication and financial evidence.
- Exact grant, import and connection retries succeed during the same current period. Source revocation or deletion retires those results, and deletion cancellation plus a new permission period does not make them visible again. Direct runtime entry calls and direct-table deletion guards enforce the same rule for all four source classes.
- The mounted journey verifies the 100-plus-1 cleanup boundary, exact cursor continuation, current same-key replay, retired lifecycle and cleanup replay rejection, retention cleanup, both legal-hold/cleanup lock orderings, tenant isolation, owner/administrator authority, member denial, immutable history and no operational mutation.
- Focused contract and ratification tests cover exact source classes and request shapes, bounded retention and cleanup, shared lifecycle serialization, direct table and helper denial, plain API messages and the no-rendered-path boundary. Accepted Part 12A-I contract regressions remain passing.

No provider connection, provider credential, private production account, native NorthStar financial authority, production migration, deployment, Part 12K Learning Center, physical-device review, manual assistive-technology review or founder visual verdict is claimed.
