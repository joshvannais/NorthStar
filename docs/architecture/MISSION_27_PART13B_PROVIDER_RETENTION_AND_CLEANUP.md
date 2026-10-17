# Mission 27 Part 13B — provider retention, deletion and cleanup readiness

## Authority

Part 13B implements the frozen provider-lifecycle authority for bounded
checkpoints, replay windows, retention, deletion requests, legal/audit/dispute
holds, resumable cleanup and minimized tombstones. It does not retain or delete
a record, receive a provider event, create a checkpoint, open or release a hold,
write a tombstone, call a provider, or move money. Parts 13C–13D retain outage,
recovery, observability, capacity, security, restore and whole-Part-13
acceptance.

The server consumes only the exact released Part 13A lifecycle-health contract.
That source in turn strictly revalidates the released Parts 7A, 7B and 8A
provider-disabled contracts. Part 13B reads Part 13A before and after every
projection; there is no cache, identity marker, caller-issued trust token or
fallback value. Any invalid or changing source fails closed.

## Private read boundary

`GET /api/v1/customer-financial/payment-provider/lifecycle-retention` is the
only Part 13B route. It requires a current paid tenant session and owner role.
It is private and `no-store`, accepts no query or request body, and returns no
tenant, actor, session, customer, provider-account, event, deletion-scope, hold,
checkpoint or secret identity. There is no demo or mutation route.

The exact case-insensitive path, with the router's optional trailing slash, has
one pre-parser method/body boundary. Unsupported methods return a fixed private
405 with `Allow: GET`; any framed GET body returns a fixed private 400. Both
occur before JSON parsing, authentication, throttling or repository access.
GET-only CORS is applied first without widening the method set.

## Value-free lifecycle contract

The immutable `m27-provider-lifecycle-retention-v1` projection keeps these
axes separate:

- bounded durable checkpoints and one-writer aggregate processing;
- provider-event replay windows, exact event/account/mode identity and
  replay-safe acknowledgement;
- raw quoted-job media, raw-event, public-session-tombstone, financial-record
  and immutable audit/idempotency retention periods, without copying raw
  transcripts into Mission 27;
- exact deletion scope, current hold state, immutable reason and two-person
  control;
- separate legal, audit, dispute and refund holds that fail closed when unknown;
- bounded resumable cleanup with its own checkpoint and attempt receipt; and
- a minimized non-sensitive tombstone distinct from the deleted record.

The frozen launch policy supplies the exact numeric periods and bounds. Its
legal, provider and security reviews remain unaccepted, so retention launch,
deletion, holds, cleanup and tombstone writes all remain unavailable. Unknown
hold state blocks destructive cleanup. No caller checkpoint, retention claim,
hold claim or deletion scope is accepted. No identity, payload, secret,
instrument or provider object is stored or returned, and every provider,
receiver, accounting, database and money effect counter is zero.

## Evidence boundary

Focused tests enumerate every semantic leaf, structural/source/digest witness,
joint forgery, strict Part 13A reread and concurrency case, owner-only source,
route equivalence and near miss, query/body/framing/method/CORS composition,
privacy and zero effects. Mounted evidence uses a disposable local PostgreSQL
17 database through migration 272 and proves session, role, subscription,
query, body and method denial, restart-equivalent stability, zero durable
retention/cleanup/tombstone residue, zero external transport and no migration
273.

Part 13B creates no rendered surface. Browser and founder visual acceptance are
therefore not applicable to this slice. Accepted retention policy, provider
event receipt, deletion/hold authority, private production, natural cleanup,
production performance, physical-device, disaster-restore and
first-paying-customer live-money evidence remain unavailable and unclaimed.
