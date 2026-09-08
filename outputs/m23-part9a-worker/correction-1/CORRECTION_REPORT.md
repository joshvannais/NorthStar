# Part 9A functional correction handoff

Writer verification only. Independent re-review remains required on the final
published head; this report is not an audit approval or release decision.

## Provenance and exact scope

- Same writer task: `019fcfdb-02f5-76d2-8b24-e6af82135a12`.
- Same branch: `review/m23-part9a-worker-operational-experience`; draft PR #176.
- Exact base/main: `b84f51b1220b74fc71da0ce07ed3958b9c678d58`.
- Audited starting head: `c22de9d053b65814fd59ae471e97d9eea01e3da3`.
- Tests-first commit: `292d413dc3b51e8878a98e2633bc81037398a8e8`, parent exact audited head.
- Implementation commit: `d46672d076fd5aac6b0d7e11ef7e345c39f06049`, parent exact tests-first commit;
  tree `f9ae31832063dbf4719ffda1e8ce70e4ba32c5e3`.
- Same independent auditor: `01a07eca-d97f-7bf2-9436-c4168f5ef2e8`, terminal
  `CHANGES_REQUIRED`, P0/P1/P2/P3 = 0/0/3/0 at the starting head.
- Sole finding authority: report SHA-256
  `de9670c8b424771b643a3bcb38f08c55b5219bdc39adc4a4cedf46c48eaf5f92`,
  findings `a91e668139517c161067eeb6720eb1899cdf2e8f1798ce0bbee4938e272836b9`,
  manifest `75e5e6581549245bc27c70849bf62c22a0381964a652086be1f1bb597bd2a820`.

Only `public/js/work-page.js` and the existing
`public/js/field-execution-client.js` coordinator change production behavior.
Other changes are narrowly related browser/unit/PostgreSQL tests and additive
correction evidence. There is no deletion, rename, route unmount, backend,
migration, CSS/layout, public-page, dependency, provider or configuration change
in this correction range. This report's evidence-only commit does not change
the tested implementation. Final head/tree/parent/ref identity is in the PR body
and the separate publication ledger.

## Three functional findings addressed by the writer

1. F1: Preserve each evidence page's total, returned, truncated and nextCursor
   metadata; require a bounded complete history before automatic selection.
   Missing/inconsistent pages and more than 20 current pins of any kind block
   preparation visibly rather than substituting an empty or silently sliced
   list. Re-read before confirmation and submission; changed evidence requires
   another review, with live status and focus retained at the selection.
   Backend explicit selected/empty lists, global gates and owner approval are
   unchanged. A genuinely complete empty history remains valid.
2. F2: Validate complete predecessor chains and select only current leaf pins.
   Superseded inspection observations are excluded before applying per-kind
   limits. The ordinary database regression records an inspection, applies an
   authorized observation correction, reads the current history, then submits
   a proposal successfully using only the successor. Checklist-instance
   semantics and backend completion rules are unchanged.
3. F3: Require a live exclusive browser Web Lock for a random per-tab owner
   before restoring drafts or persisted retry keys. A copied/opener-created
   storage snapshot obtains another owner and clears only its own copied
   worker namespaces. Same-tab reload and back/forward reclaim the released
   owner. Unsupported/unavailable storage ownership disables persisted restore
   truthfully; it does not adopt a copied namespace. Existing scope pruning,
   pending controls, volatile retry behavior and server idempotency remain.

## Red and green evidence

All final correction fixtures use ordinary synthetic field text. Provider/API
traffic is intercepted; no exploit or offensive test campaign was run.

- Tests-first red: 21 missing-helper unit contracts and eight mounted functional
  failures, preserved in `RED_EVIDENCE.md` and the external artifacts.
- After correcting the fixture-only issues described below, a read-only browser
  rerun served the two exact production JS blobs from the audited Git head:
  **8 failures / 16 checks**, with zero external requests or page errors. The
  same-tab reload/back-forward controls and six layout checks pass there.
- Corrected mounted Chrome **16/16** and actual Playwright WebKit **16/16**:
  unavailable/partial/over-limit evidence, pagination, current inspection pins,
  changed-selection focus/announcement, same-tab recovery, opener and copied
  draft/retry-key isolation, 1440/390/320 in both themes.
- Benign adaptation of the existing mounted matrix: Chrome **38/38**, WebKit
  **38/38**, including ordinary flow, capability/lifecycle/privacy states,
  keyboard/focus/semantics and labeled 200%/400% device-metrics-equivalent
  reflow. Both have zero page errors and zero external requests. Chrome is
  installed version `152.0.7977.82`; Playwright WebKit is `26.5`, not Safari.
- Fresh PostgreSQL-backed focused Jest: **6/6 suites, 57/57 tests**, no skips.
  This includes the 21 new helper tests, 5 worker contract tests, 12 Today unit
  tests, 10 mounted Today/PostgreSQL tests, migration-053 regression, and 8
  unchanged calculator-hosting checks.
- Selected existing completion suite: **2/2** ordinary database tests passed,
  covering explicit checklist gates and the new corrected-inspection flow.
  The other eight cases were not selected in this bounded correction run;
  they are not represented as passing.

PostgreSQL was freshly initialized in the correction evidence directory:
18.4, UTF8, C/C locale, UTC, checksums on, 127.0.0.1:55629 only. The initial and
final database/role sets are identical; test databases and roles were removed,
the cluster stopped, and the port returned no response. The stopped cluster is
retained as local synthetic evidence, not published. A clean allowlisted child
environment inherited no provider credentials. Loopback socket/fetch guards
recorded 74 local connections and zero non-loopback attempts/connections.

Screenshots were inspected for the corrected completion state at desktop,
390 and 320 in light/dark coverage. This is writer inspection, not the user's
separate visual verdict or a manual assistive-technology/Safari/device claim.

## Preserved preparation limitations

The initial red theme initializer accessed about:blank and was confined to HTTP
documents before the next run. Later visual inspection found that the first
focused fixture sanitizer replaced a full legacy test string but left its
shortened header fragment. Those preliminary artifacts are retained but are
not the authoritative benign-only evidence. The final fixture replaces every
markup-bearing synthetic string and asserts that none reaches rendering; the
read-only benign baseline reproduces the same eight functional defects.

The first broad benign matrix stopped after a note because its old interceptor
reused the checklist-response UUID for that new record. Complete-history
validation correctly rejected the duplicate. The test fixture now gives the
distinct note a distinct UUID, matching durable authority; production
validation was not relaxed. The failed run remains preserved. A focused
selection-change check also preserved a red focus-loss result before focus
restoration was implemented.

## Exact artifact anchors

Non-overwriting external root:
`C:/Users/joshv/Documents/Codex/2026-09-07/m23-part9a-corrections-c22de9d/`.

| Artifact | SHA-256 |
| --- | --- |
| `benign-baseline-chrome/results.json` | `11586116857e0bd29148f519b0487aaa5c2184c9aa286485f12f9bf0744ff948` |
| `benign-final-chrome/results.json` | `11e98abfd957c028d33f0eb6a9d7ce00afa42b3531edb9961e3616eeeb66fa74` |
| `benign-final-webkit/results.json` | `35cdc1195e6436d0630652f27277995ffba40bff13ccadf4b81b043d8a05183d` |
| `mounted-final-chrome/evidence.json` | `cae4b06608867616d9066f2c092974c680065a7ebcde01339c4fc9265afbc196` |
| `mounted-final-webkit/evidence.json` | `58b84b8f59210e7606845319d84cf067d4424fcb6671c6fb44cfa459ef209c99` |
| `postgres-validation/validation-report.json` | `deb585bb90a5fc9e30e9ec1a0c94630ccabc4cfdeeac0082b36bb7612148391f` |
| `postgres-validation/focused-corrections.json` | `db74cecbee08a4d3adb092bcbe090c016dd5fa9ab6ed60c4fee881ff390dec11` |
| `postgres-validation/inspection-correction.json` | `7b3cd838993feea8b2065c712dfe9cfd72739fe5e727923fd82154a23d6a327a` |

## Protected and unavailable gates

Migration 053 remains blob `7428c905405d73c7a01ea376d4e4510ecc66d2ff`,
10,934 bytes, SHA-256
`67cb4dd2a45074944e4dc3f2e4c8ac9fd958b4158e99e58b84371bce921f0753`.
All migrations, backend authority, accepted calculator, other protected paths,
and historical receipts are unchanged by this correction. Frozen PRs #66/#80/#81
and retained Part 8 refs remain exact.

The prior full Jest corpus remains **199/213 suites passed, 6,780 tests passed,
77 failed, one archived 9ec skipped**, with the 14 non-green suites documented
in the original writer receipt. It was not rerun or represented as green here.
Hosted CI, physical Safari/devices/zoom, manual assistive technology, founder
visual approval, provider/canary/private-production and legal evidence remain
unavailable or unclaimed. Production migration history/UTC, automatic apply and
later-start zero-op, backup/restore/recovery and release gates remain pending.

No ready transition, main merge, deployment, production check, provider call,
secret inspection, new writer/auditor, or later slice occurred. The writer
stops after normal publication for the same auditor's exact-head re-review.
