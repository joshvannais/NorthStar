# Mission 23 Part 9A material-transfer form red evidence

Captured before correcting conditional material fields on the mounted work
page.

Command:

`node tests/browser/m23-part9a-worker-operational-experience.js --browser=chrome`

Installed Chrome `152.0.7977.82` dynamically completed and validated the
production lifecycle, checklist create/retry/respond, timer start/stop, and
manual-time contracts. The run then selected `transferred` in the mounted
material form and failed because the source and destination controls remained
optional (`required` was absent). That allowed a partially specified transfer
to reach confirmation even though the authoritative material contract rejects
one-sided location evidence.

Generated red ledger: `outputs/m23-part9a-worker/chrome/evidence.json`, SHA-256
`31cc79ca744ae9c96634c1321d077668577ad0e3d754d76a3ab3e0877756eb5e`.
No provider or external call was made.
