# Mission 22 Part 6 visual impact and follow-up ledger

## Deliberate Part 6 customer-visible changes

- New paid, signed-in `/dashboard/today` destination and shared-navigation item.
- Employee-minimized Today navigation shows only Today; it does not enumerate
  broad operator surfaces even when the signed-in person has owner/dispatcher
  authority elsewhere.
- The broad paid Quick Start is deliberately not applicable on Today because
  its setup checklist links Command Center, Business Profile, Settings, and
  Integrations. Existing Quick Start behavior is unchanged on broad paid and
  demo surfaces; Today does not render its button/dialog or load its assets.
- Mobile-first Today page title, read-only/reload controls, personal-scope note,
  schedule cards, assignment/dispatch/review badges, minimum customer/location
  facts, and native instructions/route/current-crew disclosures.
- Truthful loading, empty, error, offline, stale, restricted, and ready states;
  prior cards are removed on every non-ready state.
- Command Center-faithful shared typography, width/gutters, section rhythm,
  cards, borders/radii/shadows, gold/purple/neutral palette, header/footer,
  focus, light/dark, reduced motion, touch, zoom, and reflow behavior.

## Exact shared-component impact

- `public/js/command-center-contract.js`: separates the paid ten-route contract
  from the unchanged nine-route demo contract and classifies Today as paid only.
- `src/auth/permissions.js` and `src/commandCenter/workspace.js`: project the
  new paid destination through existing server-owned role visibility while
  leaving demo workspace navigation unchanged.
- `public/js/nav-component.js`: adds the matching label/icon and reduces Today
  itself to the Today-only employee-safe destination.
- Existing Command Center, Calendar, leads, communications, team, Business
  Profile, settings, integrations, and Polaris pages receive only the new
  server-approved Today destination in their paid navigation; their page layout
  and content are unchanged. Demo pages receive no Today destination.

## Unrelated existing inconsistencies

No unrelated visual inconsistency was changed during the bounded Part 6 writer
review. The committed screenshot package pairs Today and Command Center by
browser/viewport/theme so the user can make the separate active visual verdict.
Any issue first identified during that user review should enter a later bounded
visual correction lane rather than expanding this PR.
