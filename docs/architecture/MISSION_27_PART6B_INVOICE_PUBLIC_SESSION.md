# Mission 27 Part 6B — invoice public-session token boundary

## Frozen scope

Part 6B owns a high-entropy, expiring and revocable bearer token stored only as
a hash. A token may bind one exact issued invoice version to one minimized
customer session. Public lookup must resist enumeration and rate abuse, expose
no secret through a referrer, log, cookie or browser storage, load no third-party
content, and use private `no-store` caching. Possession of the token is a bearer
capability; it does not prove the natural person or reviewed recipient identity.
Part 6C separately owns customer view/download and protected customer mutations.

Released Part 6A is intentionally value-free because there is no immutable
invoice issue receipt, issued document version or customer-safe document. A
draft, Part 5 lifecycle projection, fictional demo, caller-supplied digest or
random secret cannot substitute for that authority. Part 6B therefore cannot
truthfully generate a token, persist a hash, assign an expiry, create a customer
session, bind an issued version, mount a public lookup/download route or write a
revocation record.

## Exact-current readiness projection

The internal paid owner/administrator read re-enters the released Part 6A
repository. That path reconstructs and revalidates the complete exact-current
Part 5 chain before returning the strict value-free Part 6A document contract.
Part 6B strictly validates that contract, discards it, and returns
`m27-invoice-public-session-v1` with state `unavailable`, reason
`issued_invoice_unavailable` and a null value.

The response names every unfulfilled requirement: exact issued document,
server-generated high-entropy secret, hash-only storage, bounded expiration,
exact issued-version binding, minimized customer session and revocation
authority. It states that no token, hash, public route, rate-limit surface,
session, expiry, version binding, revocation, download or customer mutation was
created. It contains the explicit bearer-identity limitation and no customer,
work, amount, currency, document number, due date, digest, receipt, token, cost,
margin, staff or provider value.

The account-free demo rebuilds and validates the fictional Part 6A boundary
from one demo-workspace revision and returns the same minimized value-free
contract with `mode=demo` and `fictional=true`. It cannot query paid data, mint
a real or fictional bearer secret, or fall back to a provider.

## Acceptance evidence and deferred work

Part 6B acceptance requires strict contract/repository/route evidence and real
mounted paid/demo reads against fresh PostgreSQL 17 through migration 272. The
campaign covers deterministic replay, owner/admin and tenant isolation, exact
source currentness, private `no-store` caching, no cookie, no public or mutation
route, stale-source denial and zero database residue. No migration 273 is
required because no token or session may exist.

There is no public or customer-rendered surface to exercise while the issued
document prerequisite is unavailable, so Part 6B creates no browser or visual
claim. Parts 6C–6D remain unstarted. Private production, legal/accounting/tax
opinions, external providers and receivers, live money, hosted CI, physical
Safari/devices, disaster restore and founder visual approval remain unavailable
unless independently evidenced.
