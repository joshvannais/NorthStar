# Owner demo return links

The two shared hosts must load command-center-contract.js before demo-runtime.js so its existing link rewriting knows canonical paid/demo destinations. No permission is granted by a link. Paid headers use canonical /dashboard; demo headers map to /demo.

| Host / link | Paid destination | Demo destination |
|---|---|---|
| Operations brand | /dashboard | /demo |
| Operations Command Center | /dashboard | /demo |
| Completion brand | /dashboard | /demo |
| Completion Back to Operational Overview | /dashboard/operations | /demo/operations |
| Operations selected-work Completion Review And History | /dashboard/completion-review with execution selection | /demo/completion-review with same selection |
| Operations overview Review completion | /dashboard/completion-review with execution selection | /demo/completion-review with same selection |

The last two dynamic links already choose the correct mode in owner-work.js and operations-page.js; no change to their identity or action semantics. Each host's skip link remains an in-page anchor. Shared public footer links remain public site links. Completion history rendering creates no additional return/header links.

Regression checks cover dependency order and every static header destination, with actual browser navigation and successful required destination reads asserted after the final click. Browser checks are read-only; preexisting completed fixtures are created locally and labeled separately from fresh demo sessions. Prior public work mutations and completed history evidence must not be repeated merely to verify these links.

Fresh direct Operations entry also exposed parallel session issuance: owner list/overview requests ran before the shared initial workspace request established its cookie. The three owner GET adapters now await the existing shared loadWorkspace promise before fetching. This neither creates a saved operation nor invents a cookie; failed workspace loading rejects the read. Paid paths, native credential behavior, current server expiry/identity checks and mutation logic remain unchanged. Tests retain the initial detail404 failure, then verify direct fresh entry and completed return paths with exact read paths/statuses and no browser writes.
