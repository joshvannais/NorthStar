#!/usr/bin/env python3
with open('public/dashboard/calls.html', 'r') as f:
    content = f.read()

# Find the problematic area
idx = content.find('chat-msg')
if idx < 0:
    print("No chat-msg found!")
    exit(1)

# Find the end of this line
end_idx = content.find('\\n', idx)
if end_idx < 0:
    end_idx = idx + 500

# Extract the relevant portion
snippet = content[idx-50:min(idx+300, len(content))]
print("Current code around chat-msg:")
print(snippet[:400])
print("---")

# Find the broken part - everything from chat-msg rendering to the final </div></div></div>';
old_start = content.find("+c.transcript.split")
if old_start < 0:
    print("transcript.split not found!")
    exit(1)

# Find the end of the entire html+= string (the last </div></div></div>');
old_end = content.find("</div></div></div>';", old_start)
if old_end < 0:
    old_end = old_start + 1000

old_text = content[old_start:old_end+22]
print(f"Replacing {len(old_text)} chars starting at {old_start}")

# New clean rendering
new_text = """+function(){try{return c.transcript.split("\\n").map(function(l){if(l.startsWith("AI:"))return '<div class=\\"chat-msg chat-ai\\"><strong>AI</strong> '+l.substring(3)+'</div>';if(l.startsWith("Customer:"))return '<div class=\\"chat-msg chat-customer\\"><strong>You</strong> '+l.substring(9)+'</div>';return '<div class=\\"chat-msg\\">'+l+'</div>';}).join("");}catch(e){return c.transcript;}}()+'</div><div class="call-actions"><button onclick="showToast(\\'Sent SMS to \\'+c.phone+\\'\\')">Send SMS</button><button onclick="showToast(\\'Email sent\\')">Send Email</button></div></div></div>'"""

content = content.replace(old_text, new_text)
with open('public/dashboard/calls.html', 'w') as f:
    f.write(content)
print("Fixed!")
