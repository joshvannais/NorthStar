# Mission 22 Part 7 browser and visual ledger

The retained browser evidence is a security/record-parity package for Part 7.
It deliberately contains hostile literal fixture text, so it is not a polished
customer screenshot handoff. User visual approval is a separate, unclaimed
verdict.

| Matrix | Calendar | Command Center | Employee Today | Revoked membership |
| --- | --- | --- | --- | --- |
| Chrome desktop light | exact revision 7 | primary theme reference | crew reschedule + dispatch revoked | prior job absent |
| Chrome mobile dark | exact revision 7 | responsive parity | crew reschedule + dispatch revoked | prior job absent |
| WebKit desktop dark | exact revision 7 | primary theme reference | crew reschedule + dispatch revoked | prior job absent |
| WebKit mobile light | exact revision 7 | responsive parity | crew reschedule + dispatch revoked | prior job absent |

There are 16 PNGs and four JSON trace ledgers under `browser/`.
`browser-hashes.sha256` covers all 20 files. Each trace names viewport, theme,
browser/version, tested implementation revision/tree, exact assignment
revision/digest, request inventory, expected surfaces, external/provider calls,
and crew-membership revocation result.

Visible assertions:

- existing NorthStar typography, card rhythm, palette, borders, navigation,
  footer and responsive structure are reused;
- Command Center is the strongest visual reference and Today retains its
  employee-minimized information hierarchy;
- no horizontal overhang or clipped primary controls at 1280x900 or 390x844;
- status meaning is not color-only; focus and touch paths are exercised;
- stored hostile job/customer/worker/instruction bytes render as literal text
  and never execute;
- employee Today with an active crew assignment shows only permitted essentials;
- after durable crew-membership removal, that appointment is absent.

Actual Playwright WebKit 26.5 is labeled WebKit, not physical Safari. Physical
Safari/devices were unavailable. No screenshot was copied to OneDrive by this
writer; the previously verified Part 6 package and exact OneDrive path remain
separate roadmap facts.
