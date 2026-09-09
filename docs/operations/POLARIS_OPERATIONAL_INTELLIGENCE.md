# Mission 23 Part 10 requirements freeze

Writer candidate based on `6b48d375c58f2bfd44bed83bdf5e920c89c9edf5`.
One bounded package; the canonical authority requires no sub-slices.

- Minimized summaries of authorized durable operational evidence.
- Missing-input and conflict detection without invented facts.
- Plan-versus-actual explanations preserving incompatible units and unknowns.
- Advisory human next actions, never capabilities or operational writes.
- Exact source revisions/digests, rule version, generation time, expiry,
  audience, uncertainty, confidence basis, and explicit missing inputs.
- Current tenant, individual role, direct/current-crew record scope,
  provenance, freshness, fail-closed reads, and inert stored text.
- One coherent Polaris hierarchy with progressive disclosure; desktop/mobile,
  light/dark, keyboard, reduced motion, screen-reader semantics, Chrome and
  actual Playwright WebKit evidence.
- Preserve accepted Missions 20-23. No Mission 24 pricing, Mission 25 learning,
  Mission 26 predictions, Mission 28 automation, Mission 29 governance,
  production/provider/credential/legal configuration, or live provider calls.

Canonical sources: the complete `docs/roadmap/MISSION_23_OPERATIONS.md`,
`docs/operations/*.md`, and `docs/M23_MY_WORK_PROFILE.md` at the exact base.
No repository or applicable ancestor AGENTS.md exists.

External authority: `C:\Users\joshv\Documents\Codex\2026-08-29\pre-m23-fix-inventory`.
Rehashed SHA-256:

- `serialized-package-plan.md`: `9abe80623032c22f70ec24332666560afbc50e91e6368cc17ddb27795fd7c4cd`
- `backlog-matrix.md`: `48d3fce6f03a026185bceb4e0c87165c3192597fef30fab7c86ff9a1e97d6175`
- `acceptance-gates.md`: `747aab5dfa7d1e235c0690aa7b1c3be36717a03f70d21555c73d771790a387db`

Writer evidence is not independent approval, founder personal visual approval,
production acceptance, physical Safari/devices, or manual assistive technology.

## Implemented boundary

The single package adds `GET /api/v1/field-executions/:executionId/intelligence`
and one shared, collapsed-by-default Polaris panel in existing worker work detail
and owner/admin completion review. No additional intelligence dashboard, browser
authority, operational write, provider integration, or model request is added.
The endpoint accepts no query overrides. The server derives tenant, individual
account, role, and session from the existing authenticated request.

`intelligenceRepository.js` owns a short repeatable-read PostgreSQL snapshot.
It acquires the retained supporting-authority and execution locks before the
snapshot, calls the guarded completion entry first, then the guarded labor,
material, progress, field-evidence, and equipment entries. Their existing role,
current assignment/crew, positive production-source and subscription checks
remain controlling. The narrow schedule join runs only after those entries
authorize the exact execution and pins its current assignment and appointment.
The existing material entry uses a row fence, so the transaction cannot be
declared SQL READ ONLY; the new projection performs no persistent data writes.
Statement, lock, idle-transaction and transaction deadlines are bounded, and
cleanup releases session locks and discards a broken connection.

`intelligence.js` is a deterministic, versioned rule projection. The canonical
authority permits a model OR rule version; this implementation uses
`m23-operational-review-rules-v1`. Only minimized structured facts are projected.
Stored descriptions, notes, customer identifiers, transcript content, provider
instructions and URLs never become generated prose, prompts, HTML or actions.
Each source set carries exact record IDs, revisions and digests, total/visible
counts, truncation, and a source-set digest. The envelope pins execution and
assignment, a hashed authorized audience, generation time, five-minute expiry,
rule/schema versions, snapshot digest and limited confidence basis.

Missing requirements are not inferred from missing records. A bounded history
is explicitly incomplete. Assignment revision drift, scheduling review inputs,
expired proposals, unreviewed labor, open timers, pending/disputed progress,
unresolved issues, material review and incompatible quantity bases remain
human-review conflicts. Counts are recorded evidence, not physical verification.

Plan-versus-actual explanations display the schedule window and reviewed closed
labor independently: elapsed schedule time is not planned person-hours, so no
overrun, productivity, payroll or price is inferred. Only reviewed measured
current progress leaves from a complete source history expose their own exact
quantity/target/unit; different units and targets are never converted or summed.
No planned labor/material baseline, estimate, learning outcome or forecast is
invented. Worker labor/material scope remains personal to the current assigned
worker; owner/admin scope remains the retained authorized execution scope.

Recommendations are inert human next steps. `advisory`, `humanReviewRequired`,
`providerUsed: false` and empty `capabilities` are mandatory. The client validates
the closed schema and uses text nodes. It has no recommendation execution links
or mutation path. It clears prior advice on failure, expiry, source rerender,
hidden-page transition and page exit; refresh always reauthorizes on the server.
Responses are private/no-store. A five-minute snapshot is not a lease to act:
all actual work actions remain subject to their existing fresh server gates.

## Schema, recovery and validation

No migration is added or modified, and no new table, grant, helper privilege,
dependency, provider setting or configuration is introduced. The exact base's
53 migration blobs through 055 remain unchanged. Fresh disposable databases run
the actual production migration runner; restart/upgrade reconciliation of an
already-current database must leave the migration ledger unchanged. There is no
Part 10 DDL interruption or backfill step to test. Removing the additive endpoint
and panel restores the prior application behavior without a schema downgrade;
this describes recoverability and does not authorize a production rollback.

The browser fixture's optional scheduling mode uses actual mounted preview and
human-approval APIs before dispatch. Acknowledged scheduling uncertainty remains
`needs_review`; the fixture does not bypass it to manufacture progress. Other
mounted tests use the established isolated source fixture and exercise actual
progress recording/review, exact leaf pins, revoked membership, cross-tenant and
forged-role denial, source privilege boundaries, concurrent read determinism,
and fresh/restart migration reconciliation. Unit tests cover hostile text,
malformed envelopes, stale assignment/proposals, incompatible quantities,
bounded histories, labor review and browser capability rejection.

Chrome and actual Playwright WebKit exercise both roles, light/dark, desktop,
tablet, 430/390/375/320px mobile and reflow viewports, keyboard disclosure and
refresh, reduced motion, accessible control names, one panel, no clipping,
denied/offline clearing and no provider or operational mutation attempts.
Hostile-title narrow-screen cases are separate. Full-page screenshots are the
authoritative layout evidence; locator screenshots can scroll under the retained
fixed application header and are only detail crops. Reflow viewports do not
prove native OS zoom. Accessible semantics/keyboard checks do not prove manual
screen-reader operation or WCAG certification.

The sealed external handoff records exact final Git identities, migration
checksums, executed commands, results, historical/base-comparison failures and
unavailable evidence. Earlier failed fixture/selector/line-ending attempts are
retained and distinguished from final evidence. Historical roadmap and old-tail
ratification assertions are not rewritten for this package. Independent audit,
CI, physical Safari/devices, manual assistive technology, provider/private data,
production rollout/health and the user's own final visual verdict remain separate
gates; a draft writer PR claims none of them.
