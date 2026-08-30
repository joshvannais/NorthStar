# Pre-Mission 23 P2 writer requirement matrix

Scope: `PUB-01..PUB-20` only, based exactly on released P1 main `f4c1092e0b99f14be79ef4866fc208e523032ce5`.

P2 changes presentation, navigation, and conservative public copy. It does not create plan allowances, Enterprise eligibility, a support-ticket backend, provider connectivity, new legal terms, or production authority.

| ID | Writer implementation and verification |
|---|---|
| PUB-01 | The unavailable Browser Web Call card is horizontally and vertically centered, fully opaque, and uses the approved body/display typography hierarchy at desktop, mobile, and 320px reflow. |
| PUB-02 | Plan names, prices, cadence, and notes use the P1 display/numeric/body tokens rather than page-local font families. |
| PUB-03 | Each published price card states that included features and usage limits are not yet published. The six source-backed NorthStar outcomes are explained separately and are not assigned to a plan. |
| PUB-04 | Enterprise is an unpriced contact path for larger-team, higher-volume, multi-location, or custom discussions. The UI explicitly withholds eligibility thresholds, price, included usage, and overage terms. |
| PUB-05 | The comparison lists each of the six outcomes already published at the exact base once, while every plan allocation remains explicitly unpublished. |
| PUB-06 | Connected Context, Accountable Action, and Outcome Learning use the approved display token with no inherited numeric-price styling. |
| PUB-07 | “Queued Monthly List Pricing” is replaced by “Published Monthly List Pricing”; supporting copy distinguishes the three published prices from unpublished inclusions and commercial terms. |
| PUB-08 | The redundant top demo banner is removed. The header begins at the true top and the demo CTA remains available in the navigation and hero. |
| PUB-09 | The homepage hero is explicitly fully opaque with no filter. Light/dark and 320/390 mobile evidence verifies no cloudy parent presentation. |
| PUB-10 | The working account-free dashboard is the primary CTA, trial is secondary, and the Browser Web Call form remains hidden unless its existing readiness endpoint says it is available. |
| PUB-11 | Homepage and FAQ use one explicit readiness vocabulary: available now, account-free demo, requires setup, coming soon, and awaiting approval. No static copy claims a live provider connection. |
| PUB-12 | FAQ “On this page” destinations are shared-theme button controls with visible keyboard focus and responsive stacking. |
| PUB-13 | FAQ coverage expands to onboarding, demo data, privacy/control, human approval, accessibility, pricing, integrations, maps, and support without adding plan/provider/legal facts. |
| PUB-14 | Contact provides a labeled Report-a-bug/support email preparation flow with title, description, reply address, and a local draft reference. The UI states that the reference is not a received case and that screenshots must be attached in the email application. A durable support case/history remains unavailable without an authorized support backend. |
| PUB-15 | Sign-in includes a direct, clearly labeled account-free demo path. |
| PUB-16 | Forgot-password includes the common footer and a non-enumerating, provider-dependent delivery expectation. |
| PUB-17 | Privacy gains keyboard contents/navigation only. The existing exact-base retention period and provider-category sentences are preserved verbatim; P2 adds no attorney-dependent facts. |
| PUB-18 | Pricing, Terms, Refunds, Legal, Privacy, and common footers are visually reconciled. P2 preserves exact-base substantive legal copy and removes unsupported trust-badge presentation. |
| PUB-19 | Signup continues to request only business name, name, email, password, and confirmation; phone/service-area details are deferred to setup. |
| PUB-20 | All public links target `/demo`; the existing server-owned `/demo-dashboard` 301 to `/demo` is asserted by mounted route tests. |

## Truth boundaries

- Published prices remain exactly Starter `$149/month`, Growth `$299/month`, and Complete `$499/month`.
- No plan allocation, allowance, Enterprise threshold/price, annual term, provider readiness, certification, SLA, retention period, or legal entitlement is introduced.
- The exact-base 14-day-trial, retention, provider-category, billing, refund, and service-description statements are carried forward without substantive expansion.
- A prepared `mailto:` draft is not an automatic send, a received support case, a provider delivery result, or an authenticated support history.

## Evidence boundaries

- Ordinary screenshots and hostile/security screenshots are generated into separate roots with SHA-256 manifests.
- Chrome and Playwright WebKit are automated browser evidence; WebKit is not physical Safari.
- Hosted CI, physical iPhone/iPad/Android, provider delivery, credentials, private production data/logs, and user visual approval remain unavailable in the writer lane.
