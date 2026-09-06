# Mission 23 Part 8 writer ledger

Status: implementation writer candidate only. Stop after one exact draft-PR
handoff for a different fresh independent read-only auditor.

## Preflight and provenance

The canonical executor task was confirmed readable before action. The complete
Mission 23 roadmap, Parts 1–7 authority/source/migrations/tests, supplied Part 7
release state, and applicable workspace instructions were read. No repository
or WSL ancestor `AGENTS.md` was present.

Remote `main`, local base, and the requested immutable base all matched
`fce4000f22c08f5f74712d37439286a4c601b1a7`, the normal merge of PR #171.
Full-history object verification passed. No Part 8 branch, pull request,
migration 049, competing visible writer, or duplicate task existed at preflight.
The saved `C:\Dev\NorthStar` checkout was not edited.

One isolated full-history WSL checkout:
`/tmp/northstar-m23p8-01a077a6`. One branch:
`review/m23-part8-completion-reopening`. No amend, rebase, reset, force-push,
squash, merge, deployment, branch deletion, or history rewrite is authorized.

## Bounded implementation

Allowed scope is one additive migration, a completion contract/repository/grant
module, two mounted field-execution routes, the existing raw-body matcher and
startup runtime-grant extension, focused/mounted/migration/ratification tests,
Mission 23 status reconciliation, and non-overwriting writer evidence.

Implemented actions are proposal, approval, withdrawal, explicit cancellation,
reopening, explicit resume-after-reopen, and append-only annotation correction.
The gate snapshot covers exact required checklist/inspection/file pins and
deterministic labor/material/progress/field-evidence/equipment commitments. The
authority preserves exact actor, session, tenant, assignment, execution, audit,
idempotency, serializable concurrency, and immutable-history boundaries.

Unchanged: every released migration 001–048; rendered UI/browser assets and
design system; provider integrations/configuration; dependency/lock manifests;
CI/deployment workflows; scheduling, quote, invoice, payment, customer contact,
and Mission 24+ authority. Part 9 retains all operational presentation work.

## Reproduction environment

- Node.js 24.19.0 from the bundled Codex runtime.
- Existing dependency inventory from the saved NorthStar package; nothing was
  downloaded and no manifest or lockfile changed.
- Disposable PostgreSQL 18.4, UTF8, UTC, locale `C`, checksums enabled,
  loopback-only port 55499, with distinct non-superuser owner/runtime roles.
- Data directory:
  `C:/Users/joshv/.codex/visualizations/2026/09/06/01a077a6-2efb-7453-ad53-7b1a52051db5/pg18-m23p8`.

An initial provisional PostgreSQL 17 cluster showed the released migration
runner's unsupported restart behavior and, at deferred commit, the reason that
the repository's mounted suites require 18.x. An existing local PostgreSQL 18.4
distribution was then used. No software or provider access was downloaded.
Only results from the required 18.4 runtime are acceptance evidence.

## Evidence boundary

All tests and migration lifecycle runs are local writer evidence. They do not
approve this implementation or prove production state. The exact migration
identity is in `MIGRATION_IDENTITY.md`, requirements in
`REQUIREMENT_TO_EVIDENCE.md`, results in `TEST_RESULTS.md`, and exclusions in
`UNAVAILABLE_EVIDENCE.md`.
