# Mission 27 Part 14B — resettable fictional demo financial journey

Status: implementation candidate. Independent whole-head acceptance, merge, deployment, provider evidence, live-money evidence, and founder visual approval are not accepted.

## Authority

Part 14B mounts one account-free fictional journey over the released demo Part 12 bundle and the same Parts 5–12 production contracts used by the paid customer-financial surface. It does not create a second invoice, payment, receivable, collection, accounting, or reporting engine. The browser receives the exact released Part 12 bundle together with a strict Part 14B projection.

The projection covers, in order, exact-current approved estimate selection, billable handoff, invoice draft review, fictional issue and delivery, disabled provider session, fictional provider event and settlement evidence, fictional receipt, correction/refund/dispute, receivable and collection projection, accounting handoff, downstream reporting, offline cash received, and offline check received with clearance unknown. Every state is synthetic evidence only. A fictional stage never supplies human, provider, bank, customer, accounting, or production truth.

## Isolation and reset contract

- One opaque demo cookie identifies one PostgreSQL-backed demo session, tenant namespace, seed, generation, revision, and current record set.
- The Part 14B route is account-free and demo-only. It imports no paid repository and cannot fall through to a paid route.
- The repository establishes one database-backed linearization point for the complete read. A session-scoped shared transaction lock and authoritative session-row lock cover session authority, exact record selection, every source read, strict Part 12 and Part 14B projection, final currentness reread, response serialization, and completion of the supported HTTP response. Demo mutations use the matching exclusive session lock, so reset either follows the completed revision or causes a fail-closed stale/currentness result; a detached JavaScript record is never the final authority. Locks are scoped to the exact opaque session and do not block an independent demo session. The former Part 14B compatibility repository is a frozen empty module. Only a zero-argument repository bound to the module-captured production pool capability can execute the Part 14B operation; injected/custom repositories, proxy wrappers, detached methods and caller-supplied token, record, transaction, source-loader, currentness or serialization capabilities fail before request or source access. Exact production sources are independently reread before and after projection.
- Returned identities are digest-bound. Raw tenant, session, provider-account, credential, customer, recipient, or bank identity is not exposed by the Part 14B projection.
- Reset requires the exact current revision and a scoped idempotency key. A successful reset increments revision and generation, restores the canonical three-graph seed, removes user-created demo mutations, clears the simulation count, and reissues the deterministic baseline only inside the same demo session.
- Duplicate reset replays the first result. Stale, reordered, cross-session, guessed-record, malformed, or concurrent requests fail closed.
- Offline cash remains `offline_received`. A received check remains `check_clearance_unknown`; the disabled clearance transition remains `check_clearance_authority_unavailable`.
- Partial and multi-invoice provider payments remain disabled. Provider mode stays test-only and the tenant live flag remains off.

## HTTP and browser boundary

`GET /api/demo/customer-financial/invoice-drafts/:estimateId/part14b-acceptance` is the only Part 14B read. The early boundary recognizes every nonempty single-segment value that the case-insensitive Express parameter route can match, including malformed, encoded, Unicode and overlong values and the router-compatible optional trailing slash. Unsupported methods are rejected with a fixed private/no-store 405 and `Allow: GET` before CORS, parsing, session lookup, or repository entry. Invalid identifiers, any query marker, framed GET bodies, and content metadata are rejected with one fixed private/no-store 400 before parsing or session access. Neither early envelope reflects input nor emits a request identifier or widened CORS method set.

The invoice disclosure applies a descriptor-first recursive data-only gate to the complete response graph, including every embedded Part 5–12 source and acceptance object, before reading even the outer contract version, retaining state, invoking an existing per-part validator, or touching DOM or storage. Every object and array node has exact own keys, ordinary prototypes, enumerable writable data descriptors, dense ordering, primitive types, formats, enum values, revisions and digest/currentness bindings; accessors, symbols, `toJSON`, custom prototypes, wrappers/proxies where the supported runtime can identify them without hooks, coercible/exotic values, unknown keys, and identity or privacy-bearing poison fail closed. It then validates each complete released Part 5–12 contract, the complete ordered Part 14B contract, and every cross-part identity, amount, currency, version, digest, revision and currentness binding, and renders only the independently sanitized copy. Missing, reordered, renamed, leaked, malformed, contradictory, noncurrent, or nonzero-effect fields clear the complete invoice/Parts 5–12/Part 14B DOM and state before bounded fictional recovery. Paid rendering continues to use the paid Part 12 endpoint. Demo reset invalidates the mounted revision and remounts only the new current fictional record.

## Explicit zero-effect boundary

Part 14B performs zero provider calls or mutations, receiver mutations, outbound messages, accounting mutations, downstream mutations, paid-repository reads, production-database mutations, or live-money movements. It creates no issued invoice, customer token, delivery receipt, provider event, settlement, bank clearance, accounting acknowledgement, or external record.

## Acceptance boundary

Focused contract, repository, HTTP, PostgreSQL, and mounted browser evidence may establish the local resettable fictional journey and paid/demo isolation. It cannot establish an immutable production invoice, real recipient delivery, provider sandbox account or callback, bank settlement or check clearance, accounting receiver acceptance, production performance, physical-device evidence, first-paying-customer live-money validation, independent whole-head acceptance, or founder visual approval. Part 14E retains the mission-wide five-layout visual matrix.
