'use strict';
const https = require('node:https'), dns = require('node:dns').promises, net = require('node:net');
const { publicContext, approvedUrl } = require('./taxSourceAcquisition');
function unavailable(message) { throw Object.assign(new Error(message), { code: 'TAX_SOURCE_UNAVAILABLE' }); }
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Source retrieval was interrupted.')); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) ||
      (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
  }
  // Public global unicast only; exclude documentation, transition and mapped
  // address ranges rather than trying to reach local/link-local IPv6 addresses.
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^(2001:(?:db8|0|10|20):|2002:)/i.test(address);
}
function createTaxSourceTransport({ documents, allowedOrigins, lookup = dns.lookup, request = https.request, timeoutMs = 8000 }) {
  if (typeof documents !== 'function' || !(allowedOrigins instanceof Set) || !allowedOrigins.size || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) throw new TypeError('A reviewed public source registry is required.');
  async function fetchDocument(value, signal, redirects = 0) {
    const url = new URL(approvedUrl(value, allowedOrigins));
    if (url.port && url.port !== '443') unavailable('The public source port is unsupported.');
    const addresses = await abortable(lookup(url.hostname, { all: true, verbatim: true }), signal);
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) unavailable('The source does not resolve to an allowed public network.');
    const pinned = addresses[0];
    if (signal?.aborted) unavailable('Source retrieval was interrupted.');
    return new Promise((resolve, reject) => {
      const req = request(url, { method: 'GET', signal, timeout: timeoutMs,
        headers: { Accept: 'text/plain,text/html,application/json', 'User-Agent': 'NorthStar-Source-Review/1' },
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode)) {
          res.resume();
          if (redirects >= 2 || typeof res.headers.location !== 'string') return reject(new Error('Source redirect limit reached.'));
          let next; try { next = approvedUrl(new URL(res.headers.location, url).href, allowedOrigins); } catch (e) { return reject(e); }
          fetchDocument(next, signal, redirects + 1).then(resolve, reject); return;
        }
        if (res.statusCode !== 200 || !/^(text\/(plain|html)|application\/json)(?:;|$)/i.test(res.headers['content-type'] || '')) {
          res.resume(); reject(new Error('The source returned unsupported content.')); return;
        }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
          res.resume(); reject(new Error('Compressed source responses are unsupported.')); return;
        }
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > 32768) { req.destroy(new Error('Source response exceeds the review limit.')); } else chunks.push(chunk); });
        res.on('end', () => { if (size <= 32768) resolve({ url: url.href, content: Buffer.concat(chunks).toString('utf8') }); });
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Source retrieval timed out.'))); req.on('error', reject); req.end();
    });
  }
  return { async acquire(input, { signal } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
    try {
    const context = publicContext(input), selected = documents(context);
    if (!Array.isArray(selected) || selected.length > 8) unavailable('The reviewed source list is unavailable.');
    const results = [];
    for (const source of selected) {
      // The registry is independently reviewed configuration, not model/user URLs.
      const fetched = await fetchDocument(source.url, controller.signal);
      results.push({ ...fetched, effectiveOn: source.effectiveOn ?? null, endsOn: source.endsOn ?? null,
        coverage: source.coverage || '', exclusions: source.exclusions || '' });
    }
    return results;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  } };
}
module.exports = { publicAddress, createTaxSourceTransport };
