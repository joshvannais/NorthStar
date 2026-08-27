# Part 4 correction immutable ref and scope inventory

## Preflight

- Repository: `https://github.com/joshvannais/NorthStar.git`.
- Checkout: `work/m22-part4-writer-index`, isolated, full-history, index-first,
  clean at correction start.
- Branch: `mission22/part4-human-approval`.
- Base/live main: `76943b124d4978af5cb7eeaecf9fdfc46307ec6e`.
- Audited correction parent: `25ca82837e0368425a7ed645d80addd18888e802`.
- Audited parent tree: `9e167522b7b54bf5332063d657155e13a5bc2bad`.
- Audited parent parent: `76943b124d4978af5cb7eeaecf9fdfc46307ec6e`.
- Audited generated merge ref: `484fcc0df883de62101698449abd1f94454437ec`.
- PR #147: OPEN / DRAFT / CLEAN / MERGEABLE; hosted checks `[]`.
- Auditor and prior writer terminal; no competing writer/auditor/process.
- Audited migration 035 SHA-256:
  `64898a637bc1ba3959edbdfdf32f06fb04d2ca4a4a8e0399792c8508a2de86d7`.

## Correction scope before evidence artifacts

- `docs/roadmap/MISSION_22_SCHEDULING_AND_DISPATCH.md`
- `migrations/035_schedule_human_preview_approval.sql`
- `src/db.js`
- `src/scheduling/approvalRepository.js`
- `tests/integration/m22-part4-human-approval-postgres.test.js`

Migrations 001-034 have zero changed paths from immutable base. Current
migration 035 SHA-256:
`47b2b9e729e7ad89ce1dd55c2d88dfc25a52d0e720f171476a9552654b671cdb`.

The final commit/head/tree/merge-ref and remote PR readback are reported in the
terminal handoff after the commit and push; they are not predicted inside a
tracked artifact whose bytes contribute to that commit.
