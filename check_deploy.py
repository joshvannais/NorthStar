#!/usr/bin/env python3
import sys, re
html = sys.stdin.read()
match = re.search(r'function genTranscript\(', html)
if match:
    start = match.start()
    depth = 0
    brace_start = -1
    for i in range(start, len(html)):
        if html[i] == '{':
            depth += 1
            if brace_start == -1:
                brace_start = i
        elif html[i] == '}':
            depth -= 1
            if depth == 0:
                end = i
                break
    fn = html[start:end+1]
    print(f'Length: {len(fn)}')
    # Find the join call
    join_idx = fn.rfind('.join(')
    if join_idx > 0:
        print(f'Last join at offset {join_idx}: {fn[join_idx:join_idx+20]}')
    # Check for the chat-msg rendering
    if 'chat-msg' in html:
        print('chat-msg rendering present')
    
    # Now extract renderCalls
    rc = re.search(r'function renderCalls\(', html)
    if rc:
        start2 = rc.start()
        depth = 0
        bs = -1
        for i in range(start2, len(html)):
            if html[i] == '{':
                depth += 1
                if bs == -1:
                    bs = i
            elif html[i] == '}':
                depth -= 1
                if depth == 0:
                    end2 = i
                    break
        rc_fn = html[start2:end2+1]
        print(f'renderCalls length: {len(rc_fn)}')
        # Check for outcomeMap
        if 'outcomeMap' in rc_fn:
            print('outcomeMap present')
        # Check for status === "answered"  
        if 'status===\"answered\"' in rc_fn:
            print('upStats uses answered status')
else:
    print('genTranscript not found')
