# Pre-Mission 23 P7 accessibility and interaction acceptance

This ledger defines Package 7 verification. It is implementation evidence, not
founder visual approval and not an independent audit verdict.

## Acceptance records

- **ACC-01 — Headings and landmarks.** Every reachable route must expose one
  meaningful `h1`, logical heading order, and named navigation, main, and
  footer landmarks where those landmarks are present.
- **ACC-02 — Control names.** Every clickable or editable control must have an
  associated visible label or an exact action-specific programmatic name.
- **ACC-03 — Modal focus.** Dialogs, drawers, disclosures, and the mobile menu
  must contain keyboard focus while open, close with Escape, name their close
  action, and restore focus to the opener.
- **ACC-04 — Perceivable states.** Text and interactive states must meet the
  accepted contrast thresholds in light and dark themes. Meaning cannot depend
  on color alone, and disabled text must remain readable.
- **ACC-05 — Disabled explanations.** A disabled action must expose a nearby
  and programmatically associated reason that explains why it is unavailable
  and what condition unlocks it.
- **ACC-06 — Keyboard and screen-reader semantics.** Complete workflows must be
  operable without a pointer, preserve a meaningful focus sequence, and announce
  status and error changes through appropriate live semantics.
- **ACC-07 — Physical-device boundary.** Physical iPhone, iPad, and Android
  interaction evidence remains unavailable until it is genuinely obtained.
  Playwright WebKit is not physical Safari and cannot satisfy that gate.

## Presentation invariant

Reachable customer-facing surfaces use professional prose and native cards.
They must not expose raw JSON, JSON Schema, source code, code fences, stack
traces, internal identifiers or digests, provider bodies, or internal error codes.
Polaris loading, empty, denied, error, and success states must remain intentional
and understandable rather than presenting a blank or contextless chat.

## Customer identity interaction contract

Customer identity is contextual rather than a shortcut to Polaris. A customer
name, row, or card opened from Leads must retain the Leads route and present the
job inquiry, relevant customer facts, and lead actions in the customer-detail
drawer. The same interaction from Communications must retain the Communications
route and present the customer's information plus the complete available
conversation history. Polaris is available only through a separately labelled
action. Both contexts must support pointer and keyboard opening, Escape close,
focus containment, and focus restoration to the exact row or card that opened
the drawer. Tenant-scoped content is rendered as text rather than executable
markup.

## Required matrix

The frozen writer handoff must include the signed requirement-to-evidence matrix,
ordinary and separately labelled hostile/security evidence, exact browser/runtime
identity, test results, limitations, and immutable evidence hashes. Hosted CI,
private authenticated production, physical devices, legal/compliance review, and
founder visual approval remain unavailable unless separately and genuinely obtained.
