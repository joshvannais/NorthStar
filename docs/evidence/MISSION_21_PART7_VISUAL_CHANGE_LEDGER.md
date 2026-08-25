# Mission 21 Part 7 visual change ledger

## Scope and evidence boundary

Part 7 adds Knowledge Management inside the existing Settings and Business Profile experiences. It does not add a sidebar destination. The paid experience reads authenticated tenant authority; the account-free demo renders a separate, read-only simulated preview with explicit demo language. Screenshots below were captured from the mounted application with actual Chrome 151.0.7922.173 and Playwright WebKit 26.5. Playwright WebKit is not physical Safari, and physical-device validation remains unavailable.

Evidence root (outside the repository):

`C:\Users\joshv\Documents\Codex\2026-08-05\read-and-follow-northstar-monitor-handoff\pr142-correction-evidence-20260825T142323Z\browser`

## Visible changes

| Existing surface | Visible addition or change | Captured states | Responsive treatment |
| --- | --- | --- | --- |
| Settings, beneath AI Settings | Knowledge heading and explanation; authority/loading/error/read-only status; category, workflow, sensitivity, source, and applicability filters; truthful authorized/matching counts; deterministic Load more continuation; item list; detail tabs; exact immutable identifiers and digests; approval/publication evidence; readable canonical content; source-correction link; owner/admin actions | Paid main list/detail, provenance and deterministic comparison, lifecycle history, tombstone confirmation, stale-write error, narrow list with more than 200 authorized entries and a post-boundary filter; demo synchronization and read-only preview | Two-column browser becomes a single column below 760px; filter grid and actions wrap; identifiers and canonical content break safely; no horizontal overhang at 390px |
| Business Profile, new Knowledge tab | The same tenant-backed Knowledge Management experience embedded beside the authoritative source editor; correction links return to the relevant Business Profile source section | Paid dark comparison detail, paid narrow read-only member, demo main list/detail | Business Profile navigation remains keyboard-operable; cards, tabs, detail fields, and actions stack at 390px |
| Item detail | Overview, Changes & provenance, Lifecycle history, and Synchronization tabs; non-color-only status words; exact version/publication/configuration truth | Draft, approved, published, drifted, suspended, stale conflict, and no-permission/read-only explanations | Tabs wrap; definition rows collapse; long immutable values wrap rather than overflow |
| Mutating workflows | Review, request changes, approve, publish, revise, tombstone, rollback-as-new-version, retry, and reconcile controls shown only when eligible; every confirmation displays its captured item/entry/version or target pins; high-risk external-evidence warning and inputs | Accessible tombstone confirmation, stale expected-version failure, and delayed-response/no-retarget behavior | Native modal dialog supplies focus containment and Escape/close; focus is restored; actions have full descriptive labels and wrap on narrow screens |
| Synchronization | Current/in-sync, pending/stale, drifted, retrying, dead, suspended, and reconciliation-needed labels when canonical state supports them; exact target/version/configuration pins | Paid drift reconciliation and demo current/drifted/suspended read-only preview | Target details use wrapping definition rows and retain state text without relying on color |

Both surfaces retain the existing global header/sidebar/footer conventions. The floating Quick Start affordance remains reachable and does not cover Knowledge Management controls. Light and dark themes use the existing application tokens, and motion is disabled under `prefers-reduced-motion: reduce`.

## Screenshot manifest

All hashes are SHA-256. The Chrome and WebKit files capture the same scenario and viewport for engine comparison.

| Scenario | Chrome SHA-256 | WebKit SHA-256 |
| --- | --- | --- |
| `settings-desktop-light-main` | `66d13c124e660b876d1fe5b9f3c3848fbc81a481bb469cc3c3ac70555cdc2055` | `5a41f4a1b95ee75059653bc2040b3cee1ba50113dcb34ff6f59d4068476d7cca` |
| `settings-desktop-light-diff-provenance` | `a5a392e573e007f9591063bfb449e50b4ac49136d822719b72e74d3dd31104a0` | `c1b87798c3fd30ba93f9dbdd56cdcb1d102e83de3b0d447c9bb00f170941056c` |
| `settings-desktop-light-lifecycle` | `8b4acde66df1dbe7e8bd994911df37544aae0945cb4ec94ec34055cdc24644f9` | `c0c5c9fbcf84ae8f859c4a4d2f7f6b4ac1e67e9f5a0df208e5aeb9a80f2a21a2` |
| `settings-desktop-light-tombstone-confirmation` | `851810867b7b7d6124b04850137bd9f123c3b8b404f73c9bfbbd2ca4b4b16804` | `11de364899980c2b8c1ebb778bdf2cffb4b5ec88abe95513632d4f890315647c` |
| `settings-desktop-light-stale-error` | `3428ceb63aa5b5dc8395b5007313f501bde059b2d1a199f1a2ab011f5fbe47ac` | `e93aaec7da4324a0a466b71000001495d1a30dd8a352c785c1d452f9aa156be0` |
| `business-profile-desktop-dark-diff` | `7a9881594ddf195347ea298633eb79e560223406a21fdd8a30b1643a650b5de5` | `f1728aa3d0f34d82ba2115250eb72ce4a6209d9e4b404ea53536fa4586060184` |
| `business-profile-mobile-dark-readonly` | `f8006e6faff276101cf237a772c37c0fc5e9ecd835acb2b437f541593cae73f0` | `f1def43198288991377bb8c49d293918aa2a336a83ce3f20e5097d064ffe24d6` |
| `settings-mobile-light-main` | `2f44b472e4d5f92bd800d1e05df21b3e0055bf3ab465c2d7754d8031b299240c` | `db2ce4294a1f7134b7e5e6426d4ec19fea0d8355ffffe2ed0a3edce9a210ecab` |
| `demo-settings-mobile-dark-sync-readonly` | `c6d16b7f7a059e28290205936c7cfd355e7ef324c684144134e3922bd8a7b24d` | `94cc3f556f98e74f8d78d162fb1c6dd589c0dab4c0b0d1c57766efb2727846f6` |
| `demo-business-profile-desktop-light-main` | `37581078223c86bc4017c477b5b2552a0d8de7f9c33315c42478cac804399763` | `42b0c7b0085b02badfb11bbb79e074f2976c72b6ba31788289ad8be55b2d2628` |

The filenames are prefixed with `chrome-` or `webkit-` and stored in their corresponding engine subdirectory. Screenshot review confirmed both existing surfaces, both themes, desktop and 390px narrow layouts, paid/demo separation, main/detail/diff/history/synchronization, a confirmation dialog, a stale-write error, a member read-only state, and truthful continuation behavior with more than 200 authorized items. Immediate user visual approval was explicitly waived; these artifacts are preserved for later review.
