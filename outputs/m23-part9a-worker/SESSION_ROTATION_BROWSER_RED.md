# Part 9A session-rotation browser red

- Browser: installed Chrome, headless through the repository Playwright runtime
- Command: `node tests/browser/m23-part9a-worker-operational-experience.js --browser=chrome`
- Exit: `1`
- Reproduced failure: after a mounted mutation received an authenticated `401`, the experience entered `restricted` state but retained the prior customer/job presentation (`restricted view retained Kitchen sink repair`).
- Failed evidence SHA-256: `32df058d395cbfa234343e0118ed490bb239bfa53ecad9a400b9eeec0deaa095`
- Failed evidence bytes: `166192`
- External/provider calls: zero; all API authority was locally intercepted.

This red control also establishes same-browser-context tab isolation and back/forward authority reload before the session-expiry failure. The production correction must remove prior tenant/customer/work text, device-local drafts, and mutation controls when the current session is rejected.
