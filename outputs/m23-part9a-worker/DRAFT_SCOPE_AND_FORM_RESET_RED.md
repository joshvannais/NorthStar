# Part 9A stale-draft and conditional-form red evidence

Frozen tests-first head before these controls: `f05a02d5a616889042dc921c77e75235beab015d`.

## Access-role draft scope

Command:

`npm test -- --runInBand tests/integration/m22-part6-mobile-today-postgres.test.js`

Disposable authority: PostgreSQL 18.4 on loopback port `55629`, expected data directory `C:\Users\joshv\Documents\Codex\2026-09-07\m23-part9-pg18\data`, with the existing UTF-8, `C`/`C`, UTC, checksums-on cluster identity gate.

Result: `1` suite ran; `8` tests passed and the new role-rotation test failed. The same active membership, user, session, workforce profile, and tenant produced the identical `scopeDigest` before and after a durable `member` to `admin` role change. This reproduced the missing role dimension in device-local draft isolation. The test restored the membership to `member` in `finally`.

A focused rerun of the existing crew-revocation case also failed at the new scope assertion: removing the worker's durable crew membership changed mounted records but left the `scopeDigest` identical. The control additionally requires a remove-and-readd cycle to produce a new scope so a previously invalidated draft cannot silently reappear.

## Conditional form reset

Command:

`node tests/browser/m23-part9a-worker-operational-experience.js --browser=chrome`

Result: failed at the new material-form reset control because `locationKey` remained required after `Discard draft` reset the movement kind from `transferred` to `consumed` (`'' !== null`). The companion equipment reset and execution-revision draft controls are in the same tests-first change and remain required after this first failure is corrected.

The execution-revision control also requires stale draft and idempotency storage keys to be removed, rather than merely becoming unreachable, so repeated authoritative changes remain bounded within the tab.

Failure evidence JSON SHA-256: `8bde4575cdc459a1914a20c488e285ccf791a7ce76b7049b481a772b59eb84db`.

No production implementation was changed for either red run. No provider or external call was made.
