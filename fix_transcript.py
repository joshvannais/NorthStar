#!/usr/bin/env python3
with open('public/dashboard/calls.html', 'r') as f:
    content = f.read()

old = "<div class=\"call-detail-label\">Transcript</div><div class=\"call-transcript\">'+c.transcript+'</div>"
new = "<div class=\"call-detail-label\">Transcript</div><div class=\"call-transcript\">'+c.transcript.split(\"\\n\").map(function(l){if(l.startsWith(\"AI:\"))return '<div class=\"chat-msg chat-ai\"><strong>AI</strong> '+l.substring(3)+'</div>';if(l.startsWith(\"Customer:\"))return '<div class=\"chat-msg chat-customer\"><strong>You</strong> '+l.substring(9)+'</div>';return '<div class=\"chat-msg\">'+l+'</div>';}).join(\"\")+'</div>'"

if old in content:
    content = content.replace(old, new)
    with open('public/dashboard/calls.html', 'w') as f:
        f.write(content)
    print("replaced successfully")
else:
    print("pattern not found")
