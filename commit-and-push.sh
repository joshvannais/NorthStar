#!/bin/bash
cd /home/agent-frontend-engineer-2/NorthStar
git add -A
git commit -m "fix: off-canvas nav drawer + polaris page restore

- nav-component.js: true off-canvas drawer with position:fixed, translateX(-100%),
  transform transition, body scroll lock, overlay, close on Escape/nav click/overlay
- nav-component.js: inline critical CSS for drawer positioning
- polaris.html: restore app-layout workspace from previous commit
- command-center.html: remove leftover inline mobile nav fragments
- integrations.html: remove duplicate nav, add canonical nav component
- customer-detail.js: fetch canonical Polaris intelligence from API,
  remove hardcoded $500/30% fallbacks"
echo "Committed. Now pushing..."
git push origin fix/nav-drawer-polaris-card 2>&1
echo "Push done."
