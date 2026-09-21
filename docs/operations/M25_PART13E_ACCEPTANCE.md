# Mission 25 Part 13E acceptance evidence

## Frozen scope

**Canonical title:** Versioned proposal registry and owner-readable impact preview.

The immutable base is `5ea498ea696234e4aa0a422851107b0fe5ff3e80`, the independently accepted Part 13D head. Migration `128_canonical_job_outcome_proposal_registry.sql` adds an immutable, per-service registry over exact current Part 13D proposals and a deterministic owner-readable impact preview.

Every saved revision pins the current proposal permission period, exact proposal canonical and source digests, exact preview and preview digest, prior registry revision, calculation version, actor authority and request identity. Relative multiplier advice and connected-financial reference percentages stay distinct. Absolute company values and current scope advice remain explicitly unavailable.

Part 13F adoption, Part 13G lifecycle propagation and Part 13H rendered experience remain outside this slice. Mission 27 remains the authority for native financial truth. Saving a registry revision changes no operational, planning or financial authority.

## Executable evidence

- Fresh disposable PostgreSQL 17 applied migrations 001–128 and passed the mounted Part 13 A–E matrix: 15 suites and 48 tests.
- Focused contract, ratification and mounted Part 13E API evidence passed: 3 suites and 10 tests.
- Mounted evidence covers deterministic impact generation, concurrent replay, registry revision history, stale replay rejection, source and target staleness, permission revocation and non-revival, tenant and role isolation, direct-table invariants, immutability and entry-only runtime authority.
- The PostgreSQL pricing parity program passed all 21 cases after migration 128.
- The mounted connected-financial outcome program passed all nine material cases after migration 128.
- `git diff --check` and Node syntax checks passed before handoff.

## Evidence boundaries

No provider connection, credential, private production record, production deployment, physical device or manual assistive-technology review is claimed. No rendered path changes in this slice, so browser screenshots and responsive visual review are not applicable. API messages are reviewed for plain business language.
