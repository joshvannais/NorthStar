# Mission 25 Part 12A candidate evidence

## Frozen authority

- Base: `97a08a9733a3f7f0fb19465f418a58a927c2158d`
- Scope: provider-neutral CRM and field-service import authority only
- Migration: `113_canonical_external_crm_field_service_import_authority.sql`
- No rendered page was required or changed.

## Executable evidence

- Seven focused contract, ratification and Mission 23-25 compatibility suites passed: 45 tests total. They cover exact fields, record classes, unknown/unmatched states, bounded pages, strict tombstones, mounted routes, storage withholding and excluded finance/provider fields.
- Fresh disposable PostgreSQL 17 applied migrations 001 through 113 in each mounted API run and mounted the production learning router.
- The API scenario covers owner access, member/viewer denial, other-tenant isolation, five-class import, exact-key concurrent replay, correction, same-version conflict, tombstone minimization, cursor checks, consent pin rejection, revocation, regrant non-revival, immutable storage, migration checksum and zero operating-record mutation.
- Performance evidence covers cold and repeated 100-record pages, 1/50/100 scaling, eight IANA zones and full rollback of a page containing an invalid zone. Under concurrent test load the cold 100-record page completed in 239.97 ms; the other measured pages ranged from 56.50 to 111.52 ms. The unchanged database statement timeout is five seconds and every page remained below the two-second acceptance ceiling.
- The mounted accepted Part 11 external-material import API passed after migration 113. Focused Mission 23 execution-link and Mission 24 estimate/customer-estimate tests also passed.

A legacy Mission 23 ratification test that computes its own diff from an older hard-coded base was not used as candidate evidence: it sees accepted rendered files already present in the immutable Part 11 base and fails its historical “no public changes” assertion. The Slice 12A diff from `97a08a9733a3f7f0fb19465f418a58a927c2158d` contains no rendered file.

## Unavailable evidence

No provider connection, provider credential, private production account, production data, production migration, deployment, physical-device review or manual assistive-technology review is claimed. Native NorthStar invoice and payment authority remains unavailable until Mission 27. Provider-specific adapters, reconciliation, observations, calibration, lifecycle cleanup and rendered Learning Center behavior remain later Part 12 slices.
