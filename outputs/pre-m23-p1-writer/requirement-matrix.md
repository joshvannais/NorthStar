# Pre-Mission 23 P1 writer requirement matrix

Scope: `DS-01..DS-12` and `EMP-01..EMP-10` only.

This package is an additive design-system and employee/Today foundation. It does not claim that later route-specific P2-P7 product requirements are complete.

| ID | Writer implementation and verification |
|---|---|
| DS-01 | Shared typography, spacing, radius, rail, card, control, header and footer tokens are centralized in `site-professionalism.css`; all shipped HTML routes link the shared stylesheet. |
| DS-02 | Named pricing, truth-band, KPI and metric selectors inherit the approved system stack and tabular numeric treatment rather than page-local display faces. |
| DS-03 | Command Center, Leads, Communications, Calendar and Polaris title selectors share one responsive title token. |
| DS-04 | Shared public and dashboard rails use one centered maximum width and responsive gutter system. |
| DS-05 | Shared cards and panels use common border, radius, padding and vertical-rhythm tokens. |
| DS-06 | Today has one true-top sticky header with an isolated background and no content overlap; shared dashboard header offsets remain explicit. |
| DS-07 | Eligible public and dashboard pages retain the common centered footer and policy links; static route coverage verifies all shipped HTML. |
| DS-08 | Sign Out is a real themed button, not a navigation link; shared control sizing and focus treatment apply to compact employee controls. |
| DS-09 | The theme control announces the current theme and next action, retains sun/moon cues, keyboard behavior and persisted state. |
| DS-10 | Light and dark matrices exercise every P1 employee correction plus representative public/demo shell routes. |
| DS-11 | Today is exercised at 320, 375, 390 and 430 CSS pixels without horizontal overflow; layout-critical emoji were replaced with stable SVG/CSS icons. |
| DS-12 | The former global capitalization transform was removed; user-facing labels are written explicitly in approved sentence/title case. |
| EMP-01 | Employee job/status cards reflow into bounded single-column mobile content without horizontal clipping. |
| EMP-02 | Unavailable/access-changed copy and Reload use an explicit tokenized gap. |
| EMP-03 | Accordion dividers are structural borders and cannot cross body text. |
| EMP-04 | Owner/dispatcher appointment definitions no longer repeat the group count. |
| EMP-05 | Missing recorded-time state is not emitted as repeated placeholder rows; one record is rendered per actual item. |
| EMP-06 | Identity, Read-only View and Reload Today form one compact responsive action hierarchy with matched typography. |
| EMP-07 | Hostile job, customer, crew, location, instruction and identifier fixture data is projected through DOM text nodes; identifiers are converted to stable hashes and hostile evidence is isolated from ordinary evidence. |
| EMP-08 | Ordinary employee identity remains one line at the top-right; overflow is bounded with ellipsis and the full accessible label remains available. |
| EMP-09 | Today unavailable/access-changed/revoked presentation has one centered state, explanation and Reload action without stale schedule content. |
| EMP-10 | Operational instructions, route evidence and crew disclosures share one card/accordion hierarchy and reflow long content. |

## Evidence boundaries

- The ordinary and hostile/security screenshot packages are separate and independently hashed.
- Mounted browser evidence uses production server/modules plus a disposable PostgreSQL authority. The Today API response is intercepted only to provide an explicit ordinary or hostile UI fixture; this is visual and rendering evidence, not backend scheduling-authority proof.
- Playwright Chrome is browser evidence. Playwright WebKit, physical Safari/devices, hosted CI, provider calls, credentials and private production data are not claimed.
- The exact base has a pre-existing PostgreSQL function-execution privilege failure in the Mission 22 schedule-approval fixture. P1 changes no migration, scheduling-authority or approval code and does not weaken that boundary to make the inherited test pass.
