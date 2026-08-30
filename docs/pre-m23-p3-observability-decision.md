# Pre-Mission-23 P3 observability decision proposal

Status: approval required; telemetry must remain inactive unless a separate privacy decision records explicit consent.

This is a decision proposal, not legal advice and not an approval. NorthStar currently recognizes only a closed, aggregate interaction envelope. P3 changes the browser client to fail closed unless `northstar_telemetry_consent_v1` is exactly `granted`; no shipped NorthStar UI writes that value. Global Privacy Control or Do Not Track still stops collection even if that value exists.

## Proposed event dictionary

| Event | Allowed purpose | Allowed fields |
|---|---|---|
| `page_view` | Count visits to a route class | `surface`, `routeClass`, `action=none`, `elapsedBucket` |
| `cta_click` | Count a named, allowlisted product action | `surface`, `routeClass`, allowlisted `action`, `elapsedBucket` |
| `demo_completion` | Count completion of the local demo lead scenario | `surface=demo`, `routeClass`, `action=demo_simulate_lead`, `elapsedBucket` |
| `signup_abandonment` | Count a started but unsubmitted signup form | `surface=public`, `routeClass=signup`, `action=none`, `elapsedBucket` |
| `dead_click` | Count a named allowlisted control that did not emit its completion signal within the bounded interval | `surface`, `routeClass`, allowlisted `action`, `elapsedBucket` |
| `page_exit` | Count a route-class exit | `surface`, `routeClass`, `action=none`, `elapsedBucket` |

Every envelope must have exactly those five enumerated fields. No URL query, fragment, referrer, account, organization, session, persistent identifier, IP-derived field, user agent, device fingerprint, precise timestamp, or free text is admitted. No customer, employee, message, transcript, job, address, phone, email, or free-text content may enter telemetry. Demo/customer content is excluded even when it appears in a clicked control.

## Decisions still required before activation

1. Consent model and copy: approve a clear, freely given choice before any non-essential collection; define withdrawal and whether paid workspaces require an organization-admin policy in addition to the individual choice.
2. Geographic/legal applicability: obtain qualified legal review for every supported market. The implementation must not infer that one jurisdiction's rule is universal or sufficient.
3. Retention decision required: approve an exact aggregate-retention period, deletion schedule, backup/log disposition, and whether zero durable retention is preferable. “Keep indefinitely” is not proposed.
4. Access and purpose: name the roles allowed to read aggregates, prohibit customer/employee evaluation from this dataset, and prohibit advertising, sale, sharing, enrichment, or provider forwarding without a new decision.
5. Processor and transport: approve the destination and contract before enabling any third-party analytics provider. The current provider-neutral same-origin boundary does not prove provider readiness.
6. Rights and notices: reconcile Privacy/Terms/account notices, consent withdrawal, deletion/access handling, and Global Privacy Control behavior.
7. Test mode: approve only intercepted or local-loopback assertions until the policy and production transport are separately accepted.

## Source basis for the approval gate

- [NIST Privacy Framework](https://www.nist.gov/privacy-framework) treats privacy as enterprise risk management across the data lifecycle. The Framework defines processing to include collection, retention, logging, transmission, and disposal; that is why retention and transport cannot be left implicit.
- [California Attorney General Global Privacy Control guidance](https://www.oag.ca.gov/privacy/ccpa/gpc) says covered businesses must honor GPC as a valid request to stop sale or sharing. NorthStar therefore keeps GPC as a fail-closed signal and does not treat a stored choice as overriding it.
- [UK ICO cookies and similar technologies guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/) says non-essential device access requires clear information and actively given consent. NorthStar therefore does not activate analytics merely because a person continued browsing.

These sources support conservative engineering gates; they do not determine NorthStar's final legal obligations. Qualified counsel and an explicit product-owner decision remain required.

## P3 disposition

The five-field sanitizer, allowlists, GPC/DNT handling, bounded pending-exit queue, and local/intercepted tests remain available for review. Browser activation is off by default. OBS-01 remains gated until the decisions above are approved; no provider call or production telemetry mutation is authorized by P3.
