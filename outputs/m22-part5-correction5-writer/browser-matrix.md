# Browser and accessibility matrix

| Engine/profile | Workflow | Correction-5 evidence |
| --- | --- | --- |
| Chrome 151 desktop/light | 14 previews; 11 approvals; revision 12 | uppercase UUID search 1; 207 unique targets/9 pages; real DB mutation -> 409 restart |
| Chrome 151 mobile/dark | 13 previews; 10 approvals; revision 11 | uppercase UUID search 1; 207 unique targets/9 pages; real DB mutation -> 409 restart |
| WebKit 26.5 desktop/dark | 14 previews; 11 approvals; revision 12 | uppercase UUID search 1; 207 unique targets/9 pages; real DB mutation -> 409 restart |
| WebKit 26.5 mobile/light | 13 previews; 10 approvals; revision 11 | uppercase UUID search 1; 207 unique targets/9 pages; real DB mutation -> 409 restart |

Every matrix used real visible Calendar search and real Command Center paging.
The server dataset was mutated after page one; Next returned the real typed 409,
the dialog visibly discarded the stale selector/cursor, and a new visible search
completed traversal. Uppercase UUID search visibly selected the exact lowercase
durable target. Initial target metadata remained truthful at 200 shown of 207.

The existing hard-conflict/no-override, warning acknowledgement, stale/offline
preview, durable-approved refresh-failure, tenant New York/browser Los Angeles
time, drag/resize, read-only subscription, employee denial, hostile DOM,
keyboard/touch/focus/aria-live, 390 px/400% reflow, light/dark, and loading/error/
success/reload gates remained green. External provider calls and direct browser
PATCH attempts were zero.

Screenshots were inspected separately. User visual approval remains unclaimed;
actual Playwright WebKit is not physical Safari.
