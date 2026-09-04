'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../src/server');

const ROOT = path.resolve(__dirname, '../..');
const HOSTED_RELATIVE = 'public/unlisted/investor-forecast.html';
const HOSTED_PATH = path.join(ROOT, HOSTED_RELATIVE);
const SOURCE_BYTES = 4022457;
const SOURCE_SHA256 = 'b395c52c594f89d2eea9e26fe848da4dd2a9e6e125f81b859d398c0eb3c96e3a';
const HOSTING_META = Buffer.from('  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">\n');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

describe('unlisted investor forecast hosting contract', () => {
  test('hosted document is the byte-exact canonical source plus one non-visible robots meta line', () => {
    const hosted = fs.readFileSync(HOSTED_PATH);
    const metaOffset = hosted.indexOf(HOSTING_META);
    expect(metaOffset).toBeGreaterThan(-1);
    expect(hosted.indexOf(HOSTING_META, metaOffset + 1)).toBe(-1);

    const recoveredSource = Buffer.concat([
      hosted.subarray(0, metaOffset),
      hosted.subarray(metaOffset + HOSTING_META.length),
    ]);
    expect(recoveredSource.length).toBe(SOURCE_BYTES);
    expect(sha256(recoveredSource)).toBe(SOURCE_SHA256);

    const source = hosted.toString('utf8');
    expect(source).toContain('<title>Northstar Investment Calculator</title>');
    expect(source).toContain('<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">');
    expect(source).toContain('id="forecastMonths" inputmode="numeric" value="120"');
    expect(source).toContain('id="annualRows"');
    expect(source).toContain('id="monthlyYearGroups"');
  });

  test('the self-contained document has no browser network or external asset dependency', () => {
    const source = fs.readFileSync(HOSTED_PATH, 'utf8');
    expect(source).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
    expect(source).not.toMatch(/<link\b[^>]*\b(?:href|rel)\s*=\s*["'][^"']+["']/i);
    expect(source).not.toMatch(/<(?:iframe|frame|object|embed|base)\b/i);
    expect(source).not.toMatch(/<form\b[^>]*\baction\s*=/i);
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
    expect(source).not.toMatch(/navigator\.sendBeacon\s*\(/);
    expect(source).toContain("new Worker(");
    expect(source).toContain("new Blob(");
    expect(source).toContain('src="data:image/png;base64,');
  });

  test('exact GET and HEAD are public but receive a route-specific noindex and deny-by-default policy', async () => {
    const expectedRobots = 'noindex, nofollow, noarchive, nosnippet';
    for (const method of ['get', 'head']) {
      const response = await request(app)[method]('/investor/forecast').expect(200);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.headers['x-robots-tag']).toBe(expectedRobots);
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, no-transform');
      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'unsafe-inline' blob:");
      expect(csp).toContain("style-src 'unsafe-inline'");
      expect(csp).toContain('img-src data:');
      expect(csp).toContain('worker-src blob:');
      expect(csp).toContain("connect-src 'none'");
      expect(csp).toContain("frame-src 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      if (method === 'get') {
        expect(response.text).toContain('<title>Northstar Investment Calculator</title>');
      } else {
        expect(response.text).toBeUndefined();
      }
    }

    const httpsResponse = await request(app)
      .get('/investor/forecast')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    expect(httpsResponse.headers['strict-transport-security'])
      .toBe('max-age=31536000; includeSubDomains; preload');
  });

  test('no-transform is isolated to the exact calculator route', async () => {
    for (const siblingRoute of ['/', '/faq']) {
      const response = await request(app).get(siblingRoute).expect(200);
      expect(response.headers['cache-control'] || '').not.toMatch(/(?:^|,\s*)no-transform(?:,|$)/);
    }
  });

  test('the exact route is not broadened into a directory or alternate URL', async () => {
    await request(app).get('/investor').expect(404);
    await request(app).get('/investor/').expect(404);
    await request(app).get('/investor/forecast/').expect(404);
    await request(app).get('/investor/forecast.html').expect(404);
    await request(app).get('/unlisted/investor-forecast.html').expect(404);
    await request(app).get('/unlisted/').expect(404);
  });

  test('public discovery surfaces do not advertise or disallow the direct-link route', async () => {
    const publicFiles = walkFiles(path.join(ROOT, 'public')).filter(file => file !== HOSTED_PATH);
    for (const file of publicFiles) {
      if (!/\.(?:html?|js|css|json|xml|txt|webmanifest)$/i.test(file)) continue;
      expect(fs.readFileSync(file, 'utf8')).not.toContain('/investor/forecast');
    }

    const serverSource = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
    const pagesBlock = serverSource.match(/const pages = \{([\s\S]*?)\n\};/)?.[1] || '';
    expect(pagesBlock).not.toContain('/investor/forecast');

    for (const endpoint of ['/robots.txt', '/sitemap.xml']) {
      const response = await request(app).get(endpoint);
      expect([200, 404]).toContain(response.status);
      expect(response.text || '').not.toContain('/investor/forecast');
      expect(response.text || '').not.toMatch(/Disallow:\s*\/investor/i);
    }
  });
});
