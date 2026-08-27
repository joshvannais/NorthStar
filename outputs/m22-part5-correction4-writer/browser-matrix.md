# Browser and accessibility matrix

| Engine/profile | Workflow | Bounded target evidence |
| --- | --- | --- |
| Chrome 151 desktop/light | 14 previews; 11 approvals; revision 12 | 200/207 initial; 3 search matches; 9 pages |
| Chrome 151 mobile/dark | 13 previews; 10 approvals; revision 11 | 200/207 initial; 3 search matches; 9 pages |
| WebKit 26.5 desktop/dark | 14 previews; 11 approvals; revision 12 | 200/207 initial; 3 search matches; 9 pages |
| WebKit 26.5 mobile/light | 13 previews; 10 approvals; revision 11 | 200/207 initial; 3 search matches; 9 pages |

Every matrix uses real visible Calendar search to select the initially omitted
worker and real visible Command Center paging to select the initially omitted
crew. It also covers a visible empty search, an aborted/offline lookup and retry,
duplicate hostile labels with kind/UUID distinction, the final-page message,
explicit preview and approval, employee alias denial, read-only subscription,
tenant New York/browser Los Angeles time, hard conflict/no override, warning
acknowledgement, stale/offline preview, refresh-failure recovery, safe hostile
DOM, and zero direct PATCH/provider calls.

Mobile matrices retain 390 px and 400% reflow, 44 px controls, keyboard/touch
operation, focus/ARIA live status, light/dark, and bounded Calendar/Command Center
geometry. Screenshots were inspected separately. User visual approval remains
unclaimed; WebKit is not physical Safari.
