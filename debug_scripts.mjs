#!/usr/bin/env node
let js = '';
process.stdin.on('data', d => js += d);
process.stdin.on('end', () => {
  const extracts = [];
  let pos = 0;
  while (true) {
    const s = js.indexOf('<script', pos);
    if (s === -1) break;
    const close = js.indexOf('>', s);
    const e = js.indexOf('</script>', s);
    if (close === -1 || e === -1) break;
    const tag = js.substring(s, close + 1);
    const content = js.substring(close + 1, e);
    const isExternal = tag.includes('src=');
    console.log(`Script at ${s} (${isExternal ? 'EXTERNAL' : 'INLINE'}, ${content.length} chars): ${tag.substring(0,80)}`);
    extracts.push({tag, content, isExternal});
    pos = e + 9;
  }
  
  // Try parsing each inline script
  for (const sc of extracts) {
    if (sc.isExternal) {
      console.log('  Skip external');
      continue;
    }
    if (!sc.content.trim()) {
      console.log('  Empty');
      continue;
    }
    try {
      new Function(sc.content);
      console.log('  SYNTAX OK');
    } catch (e) {
      console.log(`  ERROR: ${e.message.substring(0, 100)}`);
      const m = e.message.match(/position (\d+)/);
      if (m) {
        const p = parseInt(m[1]);
        const start = Math.max(0, p - 40);
        const end = Math.min(sc.content.length, p + 40);
        console.log(`  Context: ${sc.content.substring(start, end)}`);
      }
    }
  }
});
