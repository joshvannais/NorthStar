# Part 4 test-fixture correction ref inventory

## Frozen input

- Repository: `https://github.com/joshvannais/NorthStar.git`
- Base/live main: `76943b124d4978af5cb7eeaecf9fdfc46307ec6e`
- Branch: `mission22/part4-human-approval`
- PR: `#147` / `https://github.com/joshvannais/NorthStar/pull/147`
- Input head: `03ba43e30625278a72880c6ae4e0d4fd3ce7c98e`
- Input tree: `9f8135406345a87ba8d5ab37d258e5feef727fb8`
- Input parent: `25ca82837e0368425a7ed645d80addd18888e802`
- Input generated merge ref: `3b5a0008afd6032d78d0e149a28db63cd13d44ff`
- Input PR state: OPEN / DRAFT / CLEAN / MERGEABLE
- Input hosted checks: none (`[]`)
- Checkout: full history, clean, tracking exact input head before correction.

## Correction topology

The correction commit containing this inventory must have parent
`03ba43e30625278a72880c6ae4e0d4fd3ce7c98e`. Its exact head/tree and the newly
generated merge ref are frozen by the terminal GitHub postflight and supplied
to the different fresh auditor; a commit cannot embed its own content-derived
SHA in itself.

Relative to the input head, the product/test delta is exactly one tracked test
file with 15 insertions and 8 deletions. The remaining new paths are this
writer-evidence directory. Migrations 001-035, source, public UI, docs/roadmap,
package files, and lock files have zero delta.
