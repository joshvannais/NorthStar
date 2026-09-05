# Migration 043 frozen identity

The forward-only Mission 23 Part 4 audit-correction migration is frozen at its
first source commit. Later documentation-only evidence commits must preserve
this Git object byte-for-byte.

- Path: `migrations/043_canonical_material_inventory_audit_corrections.sql`
- Source commit: `d6fc5fa5aaa66906e40413e912b0881a7e50f2c4`
- Source tree: `c9cb884eb5dd4980a08fa9e5e714ac925137c046`
- Git blob: `90379f78425cbe476ab8406e2bed33c6c575d16a`
- Bytes: `16,936`
- Runner-compatible SHA-256: `9f9d43d1d631953203a0d45accdfc757f3ce005a81cd4915c06bf2c3fd6ec228`

Migration 042 remains unchanged at blob
`8adb615f30626fe940ab7e444727184fed5bfe9b`, 70,623 bytes, SHA-256
`5efac96a5c275f58e56b117cdae135d4f16ce4847cccdbab8de580b5a3c1d6c4`.
Migrations 001–041 are likewise unchanged by this correction.

The existing bounded production-history receipt predates migration 043. It
does not prove 043 compatibility, application, or release. A new SELECT-only
production-history check against this exact frozen source remains required
before release; independent audit remains required before merge.
