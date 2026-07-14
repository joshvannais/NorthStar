#!/bin/bash
# NorthStar RC-1 Certification Script
BASE="http://localhost:3001"
cd /home/agent-lead/northstar-solutions

echo "=============================================="
echo "  NORTHSTAR RC-1 CERTIFICATION REPORT"
echo "  $(date)"
echo "=============================================="
echo ""

# === PAGE LOAD TESTS ===
echo "--- PAGE LOAD TESTS ---"
PAGES=(
  "/dashboard"
  "/dashboard/communications"
  "/dashboard/leads"
  "/dashboard/lead"
  "/dashboard/calendar"
  "/dashboard/settings"
  "/dashboard/ai-settings"
  "/dashboard/business-profile"
  "/dashboard/integrations"
  "/dashboard/my-number"
)
FAIL=0
for page in "${PAGES[@]}"; do
  CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE$page" 2>/dev/null)
  SIZE=$(curl -so /dev/null -w "%{size_download}" "$BASE$page" 2>/dev/null)
  if [ "$CODE" = "200" ]; then
    echo "  ✅ $page → $CODE ($SIZE bytes)"
  else
    echo "  ❌ $page → $CODE"
    FAIL=$((FAIL+1))
  fi
done

# === STATIC FILE TESTS ===
echo ""
echo "--- STATIC ASSETS ---"
for file in /css/style.css /js/theme.js /js/app-store.js /js/polaris-engine.js /js/analytics-engine.js /js/communications-engine.js /js/event-bus.js /js/notification-service.js; do
  CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE$file" 2>/dev/null)
  SIZE=$(curl -so /dev/null -w "%{size_download}" "$BASE$file" 2>/dev/null)
  if [ "$CODE" = "200" ]; then
    echo "  ✅ $file → $CODE ($SIZE bytes)"
  else
    echo "  ❌ $file → $CODE"
  fi
done

# === API ENDPOINT TESTS ===
echo ""
echo "--- API ENDPOINTS ---"
ENDPOINTS=(
  "/api/v1/polaris/estimate"
  "/api/v1/polaris/analyze"
  "/api/v1/polaris/recommendations"
  "/api/v1/polaris/learn"
)
for ep in "${ENDPOINTS[@]}"; do
  CODE=$(curl -so /dev/null -w "%{http_code}" -X POST "$BASE$ep" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
  echo "  POST $ep → $CODE"
done

# === CONSOLE ERROR CHECK (via browser) ===
echo ""
echo "--- PAGE CONTENT VERIFICATION ---"
echo "  Checking for JS files referenced in pages..."
for f in public/dashboard.html public/dashboard/communications.html public/dashboard/leads.html public/dashboard/calendar.html public/dashboard/lead.html; do
  echo -n "  $f: "
  grep -oP 'src="/js/\K[^"]+' "$f" 2>/dev/null | while read js; do
    if [ ! -f "public/js/$js" ]; then echo -n "MISSING:$js "; fi
  done
  echo "JS references checked"
done

# === FAVICON CHECK ===
echo ""
echo "--- FAVICON CHECK ---"
for f in public/dashboard.html public/dashboard/communications.html public/dashboard/leads.html public/dashboard/calendar.html public/dashboard/lead.html public/dashboard/settings.html public/dashboard/ai-settings.html public/dashboard/business-profile.html public/dashboard/integrations.html public/dashboard/my-number.html; do
  HAS=$(grep -c "favicon" "$f" 2>/dev/null)
  echo "  $f: $HAS favicon ref(s)"
done

# === SKIP LINK CHECK ===
echo ""
echo "--- SKIP LINK CHECK ---"
for f in public/dashboard.html public/dashboard/communications.html public/dashboard/leads.html public/dashboard/calendar.html public/dashboard/lead.html public/dashboard/settings.html public/dashboard/ai-settings.html public/dashboard/business-profile.html public/dashboard/integrations.html public/dashboard/my-number.html; do
  HAS=$(grep -c "skip-link" "$f" 2>/dev/null)
  echo "  $f: $HAS skip link(s)"
done

# === THEME CHECK ===
echo ""
echo "--- THEME DEFAULT CHECK ---"
for f in public/dashboard/calendar.html public/dashboard/lead.html; do
  THEME=$(grep "northstar-theme" "$f" 2>/dev/null)
  echo "  $f: $THEME"
done

# === PAGE TITLE CHECK ===
echo ""
echo "--- PAGE TITLE CHECK ---"
for f in public/dashboard*.html public/dashboard/*.html; do
  TITLE=$(grep "<title>" "$f" 2>/dev/null | sed 's/.*<title>//;s/<\/title>//')
  echo "  $(basename $f): '$TITLE'"
done

# === SUMMARY ===
echo ""
echo "=============================================="
echo "  CERTIFICATION SUMMARY"
echo "=============================================="
echo "  Pages tested: ${#PAGES[@]}"
echo "  Page failures: $FAIL"
echo "  Git HEAD: $(git log --oneline -1)"
echo "=============================================="