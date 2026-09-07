'use strict';
// Mechanical generation only: the inline engine is canonical. Rebuild its
// offline worker byte-for-byte and refresh generated content fingerprints.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.resolve(__dirname, '../public/unlisted/investor-forecast.html');
let html = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
if (scripts.length !== 2) throw new Error('Expected one engine and one UI script.');
const oldWorker = Buffer.from(html.match(/<template id="monteCarloWorkerSource">([\s\S]*?)<\/template>/)[1], 'base64').toString('utf8');
const handler = oldWorker.slice(oldWorker.indexOf('self.onmessage = function'));
if (!handler.startsWith('self.onmessage')) throw new Error('Worker handler not found.');
const worker = scripts[0] + '\n' + handler;
html = html.replace(/(<template id="monteCarloWorkerSource">)[\s\S]*?(<\/template>)/,
  (_, start, end) => start + Buffer.from(worker).toString('base64') + end);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
for (const [key, value] of Object.entries({ engine: scripts[0], ui: scripts[1], css: html.match(/<style>([\s\S]*?)<\/style>/)[1] })) {
  html = html.replace(new RegExp(`(<meta name="northstar-v33-${key}-sha256" content=")[^"]+`), `$1${sha(value)}`);
}
fs.writeFileSync(file, html);
const manifest = { source: 'public/unlisted/investor-forecast.html', baseCommit: 'a5bc90ddede95d0a88e6f857f8c75c9637dd8245',
  priorRevisionCommit: 'f14906687b2c45398073e5c195d90fd0569f4b22',
  baselineHtmlSha256: 'c7207560deb15cf1c86c569187a9e0e9c0761249bd6d83b68d0fe1ee18a2c7db',
  engineSha256: sha(scripts[0]), uiSha256: sha(scripts[1]), workerSha256: sha(worker), htmlSha256: sha(html), bytes: Buffer.byteLength(html) };
const out = path.resolve(__dirname,'../outputs/investor-revision');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest, null, 2));
