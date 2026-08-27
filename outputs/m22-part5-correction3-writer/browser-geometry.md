# Browser, geometry, and accessibility evidence

| Engine/profile | Workflow | Geometry |
|---|---|---|
| Chrome 151 desktop/light | 14 previews; 11 approvals; revision 12 | desktop preserved |
| Chrome 151 mobile/dark | 13 previews; 10 approvals; revision 11 | 390 px and 400 percent pass |
| WebKit 26.5 desktop/dark | 14 previews; 11 approvals; revision 12 | desktop preserved |
| WebKit 26.5 mobile/light | 13 previews; 10 approvals; revision 11 | 390 px and 400 percent pass |

Both mobile engines report:

- document and Calendar main client/scroll width `390/390`;
- authority board client/scroll width `364/364` inside its 366 px border box;
- every record client/scroll width `322/322` and title/state/action content
  client/scroll width `294/294`;
- all visible controls within the board and viewport, enabled and pointer-
  operable, including Dispatch at x `161.796875–249.09375`;
- hostile durable title retained through `textContent`, safely wrapped with
  `overflow-wrap:anywhere`, and multi-line rather than clipped or truncated;
- the same values after 400 percent reflow; no document or Calendar horizontal
  overflow.

The matrices retain touch/keyboard operation, 44 px control height, focus/ARIA,
light/dark, Command Center Daily Brief reflow, tenant-IANA time, real hard
conflict/no override, warning acknowledgement, durable refresh-failure handling,
employee/read-only boundaries, 101+ pagination, hostile DOM safety, zero provider
calls, and zero direct PATCH. Screenshots were inspected separately; user visual
approval remains unclaimed. WebKit is not physical Safari.
