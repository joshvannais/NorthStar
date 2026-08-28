# Mission 22 Part 6 correction browser and theme ledger

Eight fresh matrices passed against implementation commit
`e72792da9edbee3b051fd34f14cd810324870e8b` and tree
`2a6d9a61557dadd2bb3f5593fc6c202ec30995f4`:

- installed Chrome `151.0.7922.175`: desktop/mobile, light/dark;
- actual Playwright WebKit `26.5`: desktop/mobile, light/dark.

Every matrix captured 12 images and eight Today responses, for 96 screenshots
total. Chrome recorded 54 inspectable same-origin response entries per matrix;
WebKit recorded 50. The employee network destination set was identical in all
eight and contained only the Today document/API, `theme.js`, `today-shell.js`,
`today-page.js`, the existing shared/Today style sheets, and the logo. There
were zero `/api/auth/me` or telemetry destinations, external/provider calls,
worker mutation requests, or browser errors. Each matrix exercised the real
visible logout control and durable session revocation in its active desktop or
mobile shell. The logout proof also inventories the exact real logout JSON and
every public-login navigation request/response, rejects private fixture bytes,
and confirms that the revoked session leaves no cached work card.

The package freezes direct employee, current active crew, unassigned/no-work,
scheduled-not-dispatched, dispatched route/instructions, unavailable/needs
review, crew removal, revoked access, loading, network error, offline, stale,
desktop/mobile light/dark, and paired Command Center reference states. It also
exercises keyboard, touch, focus, 320/375/390 narrow widths, desktop/tablet
widths, 200%/400% zoom, and reflow. Today retains Command Center typography,
page-title, gutter, card, palette, badge, state, header/sidebar, footer, and
theme conventions without exposing broad operator navigation or Quick Start.

The corrected aggregate has 96 rows. Fifty-six non-ready/empty Today rows state
that private work is absent or cleared and make zero false private-field
visibility claims. Thirty-two synthetic loading/error/offline/stale rows name
their exact Playwright interception and state that it is not durable authority.
All eight matrices selected and recorded the real `America/Anchorage` tenant
timezone for the current wall-clock run; the selector is separately exercised
across representative UTC hours and DST boundaries.

The same corrected 107-file package is committed both under the dedicated
correction evidence root and at the original authoritative
`outputs/m22-part6-writer/employee-only-screenshots` path, replacing the false
old manifests rather than leaving two contradictory packages. Human visual
approval remains separate and unclaimed. WebKit is not physical Safari.
