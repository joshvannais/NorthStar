import os
import re

polaris_link = '''        <a href="/dashboard/polaris">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          <span>POLARIS</span>
        </a>'''

files = [
    'public/dashboard.html',
    'public/dashboard/lead.html',
    'public/dashboard/leads.html',
    'public/dashboard/communications.html',
    'public/dashboard/calendar.html',
    'public/dashboard/settings.html',
    'public/dashboard/my-number.html',
    'public/dashboard/integrations.html',
    'public/dashboard/ai-settings.html',
    'public/dashboard/business-profile.html',
]

for fp in files:
    if not os.path.exists(fp):
        print(f"SKIP: {fp}")
        continue
    
    with open(fp, 'r') as f:
        content = f.read()
    
    if 'dashboard/polaris' in content:
        print(f"SKIP: {fp} (already has polaris)")
        continue
    
    pattern = r'(<a href="/dashboard/settings">)'
    if re.search(pattern, content):
        new_content = re.sub(pattern, polaris_link + '\n' + r'\1', content, count=1)
        with open(fp, 'w') as f:
            f.write(new_content)
        print(f"OK: {fp}")
    else:
        print(f"NOT FOUND: {fp} (settings link not found)")