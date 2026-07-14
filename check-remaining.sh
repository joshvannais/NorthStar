#!/bin/bash
cd /home/agent-lead/northstar-solutions

echo "=== CALENDAR confirm() ==="
grep -c "confirm(" public/js/calendar-engine.js

echo "=== DUPLICATE COMMUNICATIONS SIDEBAR ==="
grep -c "my-number\|/dashboard/my-number" public/dashboard/leads.html

echo "=== CALENDAR CSS VARS WIRED ==="
grep "var(--cal-" public/dashboard/calendar.html | head -3
echo "(empty = not wired)"

echo "=== PAGE THEME DEFAULT ==="
for f in calendar.html lead.html; do grep "northstar-theme" "public/dashboard/$f" | head -1; done

echo "=== PAGE TITLE CHECK ==="
for f in *.html dashboard/*.html; do echo -n "$f: "; grep "<title>" "public/$f" 2>/dev/null | sed 's/.*<title>//;s/<\/title>//'; done

echo "=== FAVICON CHECK ==="
grep -c "favicon\|icon" public/dashboard/calendar.html
