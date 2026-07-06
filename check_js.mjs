#!/usr/bin/env node
let js = '';
process.stdin.on('data', d => js += d);
process.stdin.on('end', () => {
  const scripts = [];
  let pos = 0;
  while (true) {
    const s = js.indexOf('<script>', pos);
    if (s === -1) break;
    const e = js.indexOf('</script>', s);
    if (e === -1) break;
    scripts.push(js.substring(s + 8, e));
    pos = e + 9;
  }
  console.log('Found', scripts.length, 'script blocks');
  
  // Parse each script block
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    if (s.includes('function')) {
      try {
        new Function(s);
        console.log(`Script ${i}: OK (${s.length} chars)`);
      } catch (e) {
        console.log(`Script ${i}: ERROR - ${e.message.substring(0, 150)}`);
        // Extract error context
        const m = e.message.match(/position (\d+)/);
        if (m) {
          const p = parseInt(m[1]);
          console.log('Context:', s.substring(Math.max(0,p-60), p+60));
        }
      }
    }
  }
});
