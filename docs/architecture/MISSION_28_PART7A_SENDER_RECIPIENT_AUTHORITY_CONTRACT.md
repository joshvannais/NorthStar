# Mission 28 Part 7A — exact sender and recipient identity authority

Part 7A records immutable, tenant-private identity evidence for one exact Part 6A action unit. It resolves the tenant sender to the current accepted canonical business profile and resolves an ordered recipient set from exact current customer, reviewed billing-contact, lead/opportunity, or active staff records. It never accepts a free-form address, fuzzy match, partial identifier, candidate-normalized contact, or cross-customer alias.

## Exact source boundary

The sender is the tenant business identity: `organization_onboarding` must be complete and point to the exact active `canonical_business_profiles` version and digest named by the request. This is not a provider sender address, phone number, credential, or channel capability.

Each recipient has one closed class and exact source:

- `customer` binds one exact same-tenant `canonical_customers` row.
- `authorized_billing_contact` binds the latest reviewed Mission 27 billing identity for exactly one canonical customer. The review must still match that customer's current digest and update time. A contact from one customer cannot be reused for another.
- `lead_or_prospect` binds one exact same-tenant canonical opportunity and its exact canonical customer. It does not turn lead status into permission to contact.
- `staff_member` binds one exact active user and same-subject active membership in the tenant, including the fixed membership role.

Unsupported external collection/legal/credit recipients, unreviewed contacts, inactive staff, ambiguous identities and duplicate contact identities fail closed. Raw contact values are read only to derive an exact identity digest over the source-owned email and phone values inside the transaction. Recipient class, record and customer context are deliberately excluded from that contact digest, so exact contact reuse across classes or customers collides and is denied. Part 7A persists no name, email, phone, address, message content, token or provider identifier.

## Transaction and replay boundary

The resolution binds one existing immutable Part 6A transaction and action unit. The canonical ordered recipient-set digest must equal that unit's precommitted `recipientSetDigest`. Every mutable source row is locked during resolution. Mission 27 billing-contact lineage uses its existing customer advisory lock so a correction cannot race the latest-review decision.

The owner-only PostgreSQL function accepts canonical text plus a separately trusted resolution and requires exact equality. Exact replay of the same resolution ID and canonical request returns historical evidence before later mutable-source revalidation. A conflicting resolution ID, cloned material under a new ID, reordered set, duplicate identity, cross-tenant record or changed source digest is denied with zero residue.

## Authority deliberately not granted

Identity membership is not permission, consent, channel preference, opt-in, quiet-hour clearance, content approval, provider availability, send authority, delivery, reply, outcome, accounting or money evidence. Parts 7B–7D and later slices remain required. Migration 281 adds forced-RLS immutable evidence tables and an owner-only function with no PUBLIC or runtime execute grant. It mounts no route, UI, scheduler, publisher, worker, provider adapter or callback and sends nothing.

Independent acceptance, PR, merge, deployment, mounted runtime use, private-production resolution, consent/legal/provider review, provider sandbox/live evidence, real recipients/messages, external effects, money, hosted load/SLA, physical Safari/devices, manual assistive technology and founder visual approval remain unavailable and unclaimed.
