# Part 4 test-fixture correction evidence

All counted mounted runs used production modules and one disposable PostgreSQL
18.4 server configured for UTC with data checksums, loopback networking, and a
non-default port. Each Jest invocation created and removed its own suite
database and role-separated fixtures.

Raw artifacts are retained locally at workspace-root
`outputs/m22-part4-test-fixture-correction-writer/tests` and are not exported to
the public branch. `raw-evidence-hashes.sha256` pins every raw artifact below.

## Green results

| Artifact | Suites | Tests | Result |
| --- | ---: | ---: | --- |
| `named-boundary-01.json` | 1/1 | 1 selected passed | green |
| `named-boundary-02.json` | 1/1 | 1 selected passed | green |
| `named-boundary-03.json` | 1/1 | 1 selected passed | green |
| `part4-full-normal-01.json` | 1/1 | 14/14 | green |
| `part4-full-normal-02.json` | 1/1 | 14/14 | green |
| `part4-full-normal-03.json` | 1/1 | 14/14 | green |
| `mounted-parts1-4.json` | 4/4 | 57/57 | green |
| `full-available-jest.json` | 149/149 | 2,081/2,081 | green |

The Parts 1-4 split remained 10 Part 1, 20 Part 2, 13 Part 3, and 14 Part 4.
The full available corpus ran in-band for 560.405 seconds.

## PostgreSQL identity and cleanup

- `postgres-identity.txt`: PostgreSQL 18.4, timezone UTC, checksums on.
- `pg-controldata-postflight.txt`: cluster state `shut down`, checksum
  version 1.
- `postgres-shutdown.txt`: `pg_isready` exit 2/no response and no
  `postmaster.pid`.
- `postgresql-log.zip`: lossless archive of the exact server log. A
  verification extraction matched the raw log SHA-256
  `36c8999118a9e7aec16cfff2a61b61c076e91b14ec48a41714810aa2e7ac283d`.
- The validated temporary data directory was removed after capture.

## Preserved intermediate results

- `named-boundary-01-real.json`: a selector mistake anchored only the test
  title and excluded Jest's enclosing suite name, so 0 tests ran and 14 were
  pending. It is not counted as green.
- `part4-full-random-seed-2204.json`: 13/14; the repaired exact-boundary
  test passed, while a separate pre-existing shared-fixture authority test
  received 409 before its expected preview. It remains non-green and was not
  rerun into a fabricated pass.

## Startup boundary

No startup/restart rerun was performed: the delta has zero runtime, migration,
package, lock, or configuration bytes. The exact input-head independent audit
already recorded PostgreSQL 18.4 fresh/restart, health 200 twice, migration 035
once/restart none, and exact checksum. Its immutable artifact hashes are pinned
in `auditor-artifact-hashes.txt`.
