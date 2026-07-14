#!/bin/bash
# Phase 3 remaining fixes
cd /home/agent-lead/northstar-solutions

# 1. Add favicon to all pages (after <title> tag)
for f in public/dashboard.html public/dashboard/*.html; do
  sed -i 's|<title>\(.*\)</title>|<title>\1</title>\n  <link rel="icon" type="image/png" href="/assets/favicon.png">|' "$f"
  echo "Added favicon to $f"
done

# 2. Remove "My Number" from sidebar nav (the duplicate Communications entry)
# Pattern: the line with href="/dashboard/my-number" in sidebar-nav
for f in public/dashboard.html public/dashboard/communications.html public/dashboard/leads.html public/dashboard/calendar.html public/dashboard/lead.html public/dashboard/settings.html public/dashboard/ai-settings.html public/dashboard/business-profile.html public/dashboard/integrations.html public/dashboard/my-number.html; do
  sed -i '/href="\/dashboard\/my-number"/d' "$f"
  echo "Removed My Number sidebar from $f"
done

# 3. Standardize Polaris badge to "LIVE" in calendar.html
sed -i 's/✦ DAY ANALYSIS/LIVE/g' public/dashboard/calendar.html
echo "Standardized Polaris badge in calendar.html"

# 4. Add dark mode CSS to my-number.html
echo "" >> public/dashboard/my-number.html
echo '<style>' >> public/dashboard/my-number.html
echo '[data-theme="dark"] .page-header h1 { color: var(--neutral-800); }' >> public/dashboard/my-number.html
echo '[data-theme="dark"] .page-header p { color: var(--neutral-500); }' >> public/dashboard/my-number.html
echo '</style>' >> public/dashboard/my-number.html
echo "Added dark mode CSS to my-number.html"

echo "=== DONE ==="