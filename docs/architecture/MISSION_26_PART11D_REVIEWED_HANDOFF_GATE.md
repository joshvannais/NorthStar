# Mission 26 Part 11D — reviewed handoff gate

Status: architecture-only gate. There is no saved, authenticated forecast run or Mission 26 handoff endpoint, and this document does not approve a receiving action. Final Part 11D and Part 11 acceptance remain open.

## Ownership

A forecast can recommend a next move, but Mission 26 owns only the advice and its review history. It cannot mutate another mission's records, apply commercial policy, dispatch a worker, reserve equipment, issue an estimate or invoice, or send a message. The proposed destination is the owning mission's workflow when available:

| Destination | What the receiver would decide |
| --- | --- |
| Mission 20 | A subscription, entitlement or account-policy change, only under that mission's authority. |
| Mission 22 | Schedule, staffing, equipment or dispatch changes. |
| Mission 24 | Estimate assumptions, scope or price. Sealed Mission 24 contracts remain authoritative. |
| Mission 27 | Invoice, payment or other authorized financial workflow once its authority exists. |
| Mission 28 | An approved communication or reminder once its authority exists. |
| Mission 32 | Field Estimate Studio or execution-planning review when that future workflow exists. |

Mission 23 execution or Mission 25 learning evidence is not an indirect write destination for a forecast recommendation. The receiver's own authority controls whether a proposed change is available, safe and applicable. A future mission not yet mounted cannot be made real by creating a Mission 26 link.

## Proposed handoff contract

An eventual proposal should pin the authorized tenant and reviewing actor; the saved run ID and digest; target, horizon, output and currentness revision; recommendation type; the receiving mission and specific supported workflow; the exact record identity and expected receiving revision when applicable; the evidence, uncertainty, missing information and tradeoff shown to the reviewer; and creation/expiry times. It should remain a *proposal*, never an executable command. It must not embed raw transcripts, wages, customer contact details, provider payloads or cross-tenant source rows in a general-purpose handoff packet. If the forecast run becomes stale, superseded, revoked or deleted, an unused proposal must be withdrawn or require fresh review. A completed receiving action retains its own audit history and is not retroactively undone by deleting a forecast.

The authorized owner or administrator can explicitly dismiss or request a handoff. A click on a forecast card or record link is navigation, not consent or approval. Before presenting any action, NorthStar must recheck the current session, forecast permission, source purpose, run validity and scope. The receiving workflow then independently rechecks its own tenant, role, record scope, eligibility, source facts and exact revision; it uses its existing CSRF and idempotency rules for any mutation. A current forecast does not prove that a future schedule slot, supplier price, employee qualification, equipment assignment or customer permission exists. Rejected, expired and already-consumed proposals must not replay. A handoff cannot convert a deterministic scenario into a calibrated probability or replace a human's commercial judgment.

## UX and recovery

The owner-facing sequence is: see the recommendation and why it matters; inspect evidence and uncertainty; choose whether to open the receiving workflow; review its current facts and proposed change there; then make the owning mission's authorized decision. The interface should explain what changed between the forecast and the receiving record. If a link or receiving workflow is unavailable, show an actionable unavailable state and preserve the forecast as advice only. Never fall back to an automatic action or a dead link. On mobile, the handoff should carry only the minimal safe context needed to reopen the receiving record; reloading the page must not repeat a mutation.

Paid and fictional demo handoffs must remain isolated. A demo may simulate a review only inside its resettable workspace and must label the receiving result fictional. It cannot reach a paid action endpoint, send a real communication, assign a real employee or train a paid tenant model.

## Acceptance boundary

Final acceptance requires an authenticated saved run and valid Part 11C currentness; a bounded, auditable proposal and review record; real receiving-workflow adapters owned by each participating mission; denial and stale-revision tests; replay, concurrency, expiry and recovery tests; no mutation on navigation or proposal creation; customer-safe and private-data checks; paid/demo isolation; rendered plain-language and mobile review; and independent exact-head security and authority review. No CI, provider, private-production, physical-device or founder visual evidence is implied by this gate.
