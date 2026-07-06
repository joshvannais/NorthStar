#!/usr/bin/env python3
with open('public/dashboard/calls.html', 'r') as f:
    content = f.read()

# The broken transcript rendering - replace it with a cleaner approach
old = """'+c.transcript.split("\\n").map(function(l){if(l.startsWith("AI:"))return '<div class="chat-msg chat-ai"><strong>AI</strong> '+l.substring(3)+'</div>';if(l.startsWith("Customer:"))return '<div class="chat-msg chat-customer"><strong>You</strong> '+l.substring(9)+'</div>';return '<div class="chat-msg">'+l+'</div>';}).join("")+'</div>'<div class="call-actions">"""

new = """'+c.transcript.split("\\n").map(function(l){if(l.startsWith("AI:"))return '<div class=\\"chat-msg chat-ai\\"><strong>AI</strong> '+l.substring(3)+'</div>';if(l.startsWith("Customer:"))return '<div class=\\"chat-msg chat-customer\\"><strong>You</strong> '+l.substring(9)+'</div>';return '<div class=\\"chat-msg\\">'+l+'</div>';}).join("")+'</div><div class="call-actions">"""

if old in content:
    content = content.replace(old, new)
    with open('public/dashboard/calls.html', 'w') as f:
        f.write(content)
    print("FIXED: replaced broken transcript rendering")
else:
    print("Pattern not found - searching for partial match...")
    # Find what's actually there
    idx = content.find('<div class="call-actions">')
    if idx > 0:
        print(f"Found call-actions at {idx}")
        print(f"Before it: {content[idx-100:idx]}")
