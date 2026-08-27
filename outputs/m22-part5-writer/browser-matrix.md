# Part 5 browser matrix

| Engine | Viewport/theme | Input and paths | Result |
| --- | --- | --- | --- |
| Installed Chrome 151.0.7922.173 | 1280x900, light | Keyboard focus/Enter; visible assign, schedule, dispatch, reassign, reschedule, unassign; visible drag and resize preview entry; Command Center assign; stale/offline/hard-conflict; 400% reflow | 10 previews, 7 approvals, revision 1→8, 0 PATCH, 0 external calls |
| Actual Playwright WebKit 26.5 | 1280x900, dark | Keyboard; six Calendar actions; visible drag/resize preview entry; Command Center; 400% reflow | 7 previews, 7 approvals, revision 1→8, 0 PATCH, 0 external calls |
| Installed Chrome 151.0.7922.173 | 390x844, dark, touch, DPR2 | Touch; six Calendar actions; visible resize/touch preview; Command Center; 400% reflow | 7 previews, 7 approvals, revision 1→8, 0 PATCH, 0 external calls |
| Actual Playwright WebKit 26.5 | 390x844, light, touch, DPR2 | Touch; six Calendar actions; visible resize/touch preview; Command Center; stale/offline/hard-conflict; 400% reflow | 10 previews, 7 approvals, revision 1→8, 0 PATCH, 0 external calls |

All success mutations traversed the real mounted Part 4 preview and approval
routes and durable PostgreSQL state. Network interception was limited to three
bounded error-presentation cases and did not establish mutation authority.
Hostile stored markup remained inert. Keyboard focus, Escape/cancel, focus
restore, aria-live status, touch targets, light/dark state, and horizontal
reflow were checked. WebKit is not physical Safari.
