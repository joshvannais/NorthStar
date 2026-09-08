# Part 9A truthful-state browser red

- Browser: installed Chrome, mounted through the repository Playwright runtime.
- Command: `node tests/browser/m23-part9a-worker-operational-experience.js --browser=chrome`.
- Exit: `1`.
- Failed evidence SHA-256: `87d29dfa702f729c83b424faa410bc604477fb7894459c606042a957aba91f59`.
- Failed evidence bytes: `213195`.
- Reproduced failure: the absent-execution surface rendered its bounded initialize control, but the document remained in generic `ready` instead of the required truthful `empty` state.
- The same expanded mounted control adds dynamic partial-file, conflict, acknowledged-mutation/refresh-failure, and terminal read-only scenarios; execution stopped at the first deterministic state mismatch.
- External/provider calls: zero; all API boundaries were locally intercepted.

The correction must keep the useful execution sections available for `empty` and terminal `read-only` states while preserving truthful state announcements and no optimistic mutation authority.
