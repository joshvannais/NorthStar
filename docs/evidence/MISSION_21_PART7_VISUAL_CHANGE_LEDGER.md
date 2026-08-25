# Mission 21 Part 7 visual change ledger

## Scope and evidence boundary

Part 7 adds Knowledge Management inside the existing Settings and Business Profile experiences. It does not add a sidebar destination. The paid experience reads authenticated tenant authority; the account-free demo renders a separate, read-only simulated preview with explicit demo language. Screenshots below were captured from the mounted application with actual Chrome 151.0.7922.173 and Playwright WebKit 26.5. Playwright WebKit is not physical Safari, and physical-device validation remains unavailable.

Evidence root (outside the repository):

`C:\Users\joshv\Documents\Codex\2026-08-05\read-and-follow-northstar-monitor-handoff\mission21-part7-evidence`

## Visible changes

| Existing surface | Visible addition or change | Captured states | Responsive treatment |
| --- | --- | --- | --- |
| Settings, beneath AI Settings | Knowledge heading and explanation; authority/loading/error/read-only status; category, workflow, sensitivity, source, and applicability filters; workflow counts; item list; detail tabs; exact immutable identifiers and digests; approval/publication evidence; readable canonical content; source-correction link; owner/admin actions | Paid main list/detail, provenance and deterministic comparison, lifecycle history, tombstone confirmation, stale-write error, narrow main; demo synchronization and read-only preview | Two-column browser becomes a single column below 760px; filter grid and actions wrap; identifiers and canonical content break safely; no horizontal overhang at 390px |
| Business Profile, new Knowledge tab | The same tenant-backed Knowledge Management experience embedded beside the authoritative source editor; correction links return to the relevant Business Profile source section | Paid dark comparison detail, paid narrow read-only member, demo main list/detail | Business Profile navigation remains keyboard-operable; cards, tabs, detail fields, and actions stack at 390px |
| Item detail | Overview, Changes & provenance, Lifecycle history, and Synchronization tabs; non-color-only status words; exact version/publication/configuration truth | Draft, approved, published, drifted, suspended, stale conflict, and no-permission/read-only explanations | Tabs wrap; definition rows collapse; long immutable values wrap rather than overflow |
| Mutating workflows | Review, approve, publish, revise, tombstone, rollback-as-new-version, retry, and reconcile controls shown only when eligible; high-risk external-evidence warning and inputs | Accessible tombstone confirmation and stale expected-version failure | Native modal dialog supplies focus containment and Escape/close; focus is restored; actions have full descriptive labels and wrap on narrow screens |
| Synchronization | Current/in-sync, pending/stale, drifted, retrying, dead, suspended, and reconciliation-needed labels when canonical state supports them; exact target/version/configuration pins | Paid drift reconciliation and demo current/drifted/suspended read-only preview | Target details use wrapping definition rows and retain state text without relying on color |

Both surfaces retain the existing global header/sidebar/footer conventions. The floating Quick Start affordance remains reachable and does not cover Knowledge Management controls. Light and dark themes use the existing application tokens, and motion is disabled under `prefers-reduced-motion: reduce`.

## Screenshot manifest

All hashes are SHA-256. The Chrome and WebKit files capture the same scenario and viewport for engine comparison.

| Scenario | Chrome SHA-256 | WebKit SHA-256 |
| --- | --- | --- |
| `settings-desktop-light-main` | `f66e70ed018cf766ada7e8eea4f59a483146ecb73903c8ffd1c4d7aa4cc28f36` | `f1379b5f495352242da29788db8cbf21287095bdf182c6d09beb41b0da375273` |
| `settings-desktop-light-diff-provenance` | `7b725d0c5d7d147c9e9300c9dfa7c9641538402a8338f23853c5e7524bdd8971` | `d2c9172b7ff6568b5fbfab2b212d477281d6cc476619459c2c68ed1fbf1460e4` |
| `settings-desktop-light-lifecycle` | `e4288efef9cfe3ae085990e6e9e051427115d85a07744f7eddb3a22920fe7961` | `77f4d3c7fc31a4c82464b765b9d622a99b2552ce85e1a5867dd48e1eddf00bd7` |
| `settings-desktop-light-tombstone-confirmation` | `8156de1e82d2f2e15a1c66f14173b5a00401de25cee1d8eb8f73ee9699dac394` | `5dd2a55ec9afbe5e6cfdede75bbd9f3c8b31e0db85fa2e81f84a781a0fa4bb16` |
| `settings-desktop-light-stale-error` | `2feed49ece6215eaeb658fbb0d36658e2da6e2b9b03251cfce26a3cfe1db2951` | `116c9e73866069aaac3409d057928c536b627c9a75befac935dc32fecdb27194` |
| `business-profile-desktop-dark-diff` | `1e4aec842292a27aab4dc6d8eb339d4f4a48f08ab96166ece0e4edc2941ace62` | `372aa4c1059ec575cdc5019a7c83dbbc698a43ab820b081d8bc8f8886441b74b` |
| `business-profile-mobile-dark-readonly` | `8fefb47f13eac89a96f263e6c359a9c50ef01b45fde9a8ae40ade48aa5abb65c` | `bee03557c3cfe3545b57db0c4407e33511c760b26cb16a1ea6c5005873835846` |
| `settings-mobile-light-main` | `2d843ed824e4631c0e53f948cb342c70ed54be3845416389acdd5adfdfe6de4e` | `1d9e6a6b1161f7fa824005d60dee2da2b701dbfe37e9d449579498d9740fddc5` |
| `demo-settings-mobile-dark-sync-readonly` | `0d92295c48cbbe397490510eafa5842f9bb86c7007906ab000e382a36ae85c48` | `bbe821d2e44e53301138818527cd82f21b59e08a88a60d376753bd238bed2e94` |
| `demo-business-profile-desktop-light-main` | `aff8f0a13743a09e746b7164b06aa1c38a493c3cbbf1910d3b58d72fe078cd08` | `621ecbc678ad5e53d5111295cd5726a525598a36f7a71e28aef944197de6e32b` |

The filenames are prefixed with `chrome-` or `webkit-` and stored directly in the evidence root. Screenshot review confirmed both existing surfaces, both themes, desktop and 390px narrow layouts, paid/demo separation, main/detail/diff/history/synchronization, a confirmation dialog, a stale-write error, and a member read-only state. Immediate user visual approval was explicitly waived; these artifacts are preserved for later review.
