#!/usr/bin/env python3
with open('public/dashboard/calls.html', 'r') as f:
    content = f.read()

# Fix 1: Change "<strong>You</strong>" to "<strong>'+c.caller.split(" ")[0]+'</strong>"
# The current string has: <strong>You</strong>
# We need: <strong>'+c.caller.split(" ")[0]+'</strong>
old1 = '<strong>You</strong>'
new1 = '<strong>\'+c.caller.split(" ")[0]+\'</strong>'

if old1 in content:
    content = content.replace(old1, new1)
    print("Fixed 1: Changed <strong>You</strong> to customer first name")
else:
    print("Fix 1: Pattern not found, trying inverted...")
    # The file might use \" for escaping
    if content.find('strong>You') >= 0:
        print("Found 'strong>You' somewhere")

# Fix 2: Change duration to 1-2 minutes (60-120 seconds)
old2 = 'const durSec=Math.floor(Math.random()*(600-180)+180);'
new2 = 'const durSec=Math.floor(Math.random()*(120-60)+60);'

if old2 in content:
    content = content.replace(old2, new2)
    print("Fixed 2: Duration changed to 1-2 minutes")
else:
    print(f"Fix 2: Pattern not found, checking...")
    for line in content.split('\n'):
        if 'durSec' in line:
            print(f"  Found: {line.strip()}")

with open('public/dashboard/calls.html', 'w') as f:
    f.write(content)

print("Done")
