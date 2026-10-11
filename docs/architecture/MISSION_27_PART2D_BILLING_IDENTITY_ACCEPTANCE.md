# Mission 27 Part 2D — billing-identity journey acceptance

Status: implementation candidate. This document records the exact Part 2D boundary; it does not accept the candidate, open Part 3, or claim production or live-money evidence.

## Mounted paid journey

Part 2D mounts the released Parts 2A–2B billing-identity engines at `/api/v1/customer-financial/billing-identities/:customerId`. A current paid owner or administrator may read one current canonical customer source, establish its immutable unreviewed billing-party origin, review its contact, service address, billing address, purchase-order reference and customer reference, and read the current review plus append-only correction lineage.

The server resolves the exact `customer_financial.billing_identity.review` capability, grant revision, `customer_financial.billing_identity` purpose, and `mission27.launch.v1` policy from the current session, tenant, membership, role, subscription and customer. The browser supplies none of those authority values. Zero or multiple current matching grants fail closed. The existing Part 2A and 2B effect functions recheck the exact grant, entitlement, source and request evidence at mutation time.

Loading, denial, mutation, conflict and recovery clear contact, address, reference, receipt and history values before rendering another state. Source correction makes the prior review unavailable for document use until another explicit human review records a new immutable receipt. The journey creates no customer, invoice, payment, provider action, message, schedule, dispatch, work record, estimate, proposal, signature, learning observation or Mission 32 calculation.

## Isolated fictional demo journey

The same Settings surface mounts an account-free fictional journey at `/api/demo/customer-financial/billing-identities/:customerId`. Its source is one deterministic fictional demo graph. Its origin, review and correction records use exact fictional identities, source digests, timestamps, review digests and revisions and persist only inside the existing isolated demo workspace. Reset creates the established fresh fictional workspace and removes its practice billing history. Paid endpoints, paid rows, customer data, credentials and providers are never consulted.

The demo explicitly labels itself fictional and account-free. A fictional source correction invalidates document use until another review. Replay, stale revision, stale source, malformed input, foreign identity and conflicting mutation remain value-free. The projection reports zero invoice mutations, payment mutations, provider calls and customer creation.

## Shared interface acceptance

The shared Settings page provides the same review vocabulary for paid and demo modes with distinct authority labels. It supports keyboard and touch interaction, responsive phone/tablet/desktop layouts, light and dark themes, reduced motion and forced colors. Successful reset restores focus to the visible reset control. Generation fencing prevents delayed reads or failed mutations from repopulating cleared private values.

Part 2D proves only billing identity and whole-Part-2 mounted acceptance. Part 2C exact money and numbering remain independent authority and are not exposed here. Mission 24 remains estimate, approved-price, proposal, option, signature and commercial authority; Mission 22 scheduling and dispatch; Mission 23 work evidence; Mission 25 tenant-private learning; and Mission 32 the later deep calculator through the shared canonical record.

## Evidence and unavailable boundaries

Candidate evidence includes static authority ratification, focused unit regressions, fresh disposable PostgreSQL through migration 263, paid route issue/read/correction/currentness/role/tenant/privacy tests, deterministic isolated-demo mutation/reset/restart proof, and rendered Chrome and Playwright WebKit interaction across the required five layouts and themes. Independent whole-head audit, PR, deployment and production health remain later gates.

No live-money validation was run, simulated, fabricated or claimed. It remains deferred until the first real paying customer. Live provider and private-production behavior, natural customer history, accounting or receiving adapters, hosted CI, production load/SLA, physical Safari or devices, manual assistive-technology review, disaster restore, professional legal/tax/accounting/security opinions, and founder visual approval remain unavailable.
