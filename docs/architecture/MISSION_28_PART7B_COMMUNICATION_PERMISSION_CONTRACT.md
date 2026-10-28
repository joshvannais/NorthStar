# Mission 28 Part 7B — communication permission, preference, consent-basis, and suppression authority

Part 7B records append-only, tenant-private permission evidence for one exact Part 7A recipient identity and produces an immutable no-effect resolution for one exact Part 6A action unit. Every new version rederives the accepted Part 7A recipient source and contact digests under source-row locks. It stores identifiers, digests, closed states, and provenance only—never a name, email, phone, address, message, token, provider identifier, or contact value.

The current released Part 1D launch matrix accepts no external recipient, country/region, customer-consent basis, email/SMS channel, provider, or external effect. Therefore `reported_opt_in_unverified` and `owner_reviewed_reported_basis_unverified` are evidence, not consent or send authority. Legacy notification flags are tenant operational settings, not customer permission. Mission 27 billing-document use authority is not general communication consent. Only a current active staff membership using passive in-app state may resolve `clear_internal_passive_no_effect`; even that result cannot publish, notify, send, or create an effect.

## Version and suppression semantics

- One immutable permission subject binds tenant, exact Part 7A recipient class/record/parent/membership/contact digest, and channel. Exact contact reuse cannot create another class, customer, or permission lineage. A source-only correction requires a new exact Part 7A resolution and permission version; a changed contact identity requires a new exact Part 7A resolution and a new permission-subject lineage.
- Versions are contiguous and append-only, bind one exact previous-version digest, and are revalidated against the latest Part 7A source. Gaps, forks, stale source/contact material, aliases, clones, and replay conflicts fail closed.
- Do-not-contact outranks opt-out; opt-out outranks conflict; conflict outranks blocked preference, jurisdiction, age, and quiet-hour suppression; unavailable outranks clear. A lower-precedence state cannot erase a higher-precedence suppression.
- Unknown, mixed, unavailable, missing, or conflicting permission, preference, basis, jurisdiction, age, or quiet-hour evidence never becomes permission. Internal-only jurisdiction, age, and quiet-hour states cannot be attached to an external recipient or email/SMS channel. Quiet-hour state cannot reroute, delay into an unauthorized window, or authorize a fallback channel.
- Exact historical replay returns the existing no-effect record. Any changed canonical material under the same identity fails.

## Authority boundary

Migration 282 adds owner-only, forced-RLS, append-only permission subjects, versions, resolutions, and resolution items. Public execution is revoked and no route, UI, scheduler, publisher, queue consumer, worker, provider adapter, callback, recipient/message path, or effect consumer is mounted. Part 7C owns content; Part 7D owns channel/provider delivery; later slices own secure links, callbacks, replies, and opt-out ingestion. This slice grants none of them and makes no legal, privacy, regulatory, provider, deliverability, outcome, or founder-visual claim.
