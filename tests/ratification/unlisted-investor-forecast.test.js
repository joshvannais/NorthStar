'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../src/server');

const ROOT = path.resolve(__dirname, '../..');
const HOSTED_RELATIVE = 'public/unlisted/investor-forecast.html';
const HOSTED_PATH = path.join(ROOT, HOSTED_RELATIVE);
const EVIDENCE_PATH = path.join(
  ROOT,
  'outputs/unlisted-investor-forecast-monthly-layout-writer/IMPLEMENTATION_EVIDENCE.md'
);
const SOURCE_BYTES = 4022457;
const SOURCE_SHA256 = 'b395c52c594f89d2eea9e26fe848da4dd2a9e6e125f81b859d398c0eb3c96e3a';
const SOURCE_ENGINE_SCRIPT_BYTES = 456566;
const SOURCE_ENGINE_SCRIPT_SHA256 = 'd0915a1dbfbedbc82b8e9d613f2c00fd86f8e0535864d4be2d5fb48b4cc5d53c';
const SOURCE_WORKER_TEMPLATE_BYTES = 609556;
const SOURCE_WORKER_TEMPLATE_SHA256 = '068e47956832ede7a66830fa4690bb9b34f0423b894b364ff07b9662e408715a';
const HOSTED_BYTES = 4023971;
const HOSTED_SHA256 = 'c7207560deb15cf1c86c569187a9e0e9c0761249bd6d83b68d0fe1ee18a2c7db';
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
  test('hosted document preserves the exact canonical engine and worker while declaring its narrow layout delta', () => {
    const hosted = fs.readFileSync(HOSTED_PATH);
    expect(hosted.length).toBe(HOSTED_BYTES);
    expect(sha256(hosted)).toBe(HOSTED_SHA256);
    const metaOffset = hosted.indexOf(HOSTING_META);
    expect(metaOffset).toBeGreaterThan(-1);
    expect(hosted.indexOf(HOSTING_META, metaOffset + 1)).toBe(-1);

    const source = hosted.toString('utf8');
    const scripts = Array.from(source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi), match => match[1]);
    const workerTemplate = source.match(/<template id="monteCarloWorkerSource">([\s\S]*?)<\/template>/i)?.[1];
    expect(scripts).toHaveLength(2);
    expect(Buffer.byteLength(scripts[0])).toBe(SOURCE_ENGINE_SCRIPT_BYTES);
    expect(sha256(scripts[0])).toBe(SOURCE_ENGINE_SCRIPT_SHA256);
    expect(Buffer.byteLength(workerTemplate)).toBe(SOURCE_WORKER_TEMPLATE_BYTES);
    expect(sha256(workerTemplate)).toBe(SOURCE_WORKER_TEMPLATE_SHA256);
    expect(source).toContain('<title>Northstar Investment Calculator</title>');
    expect(source).toContain('<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">');
    expect(source).toContain('id="forecastMonths" inputmode="numeric" value="120"');
    expect(source).toContain('id="annualRows"');
    expect(source).toContain('id="monthlyRows"');
    expect(source).not.toContain('id="monthlyYearGroups"');
    expect({ sourceBytes: SOURCE_BYTES, sourceSha256: SOURCE_SHA256 }).toEqual({
      sourceBytes: 4022457,
      sourceSha256: 'b395c52c594f89d2eea9e26fe848da4dd2a9e6e125f81b859d398c0eb3c96e3a',
    });
  });

  test('writer evidence records exact source and hosted provenance without overstating approval', () => {
    const evidence = fs.readFileSync(EVIDENCE_PATH, 'utf8');
    expect(evidence).toContain('4,022,457');
    expect(evidence).toContain(SOURCE_SHA256);
    expect(evidence).toContain('4,023,971');
    expect(evidence).toContain(HOSTED_SHA256);
    expect(evidence).toContain(SOURCE_ENGINE_SCRIPT_SHA256);
    expect(evidence).toContain(SOURCE_WORKER_TEMPLATE_SHA256);
    expect(evidence).toContain('Automated checks do not create investor approval');
    expect(evidence).toContain('fresh independent audit remains required.');
  });

  test('monthly projection is the open first result section with one bounded accessible Month 1–120 table', () => {
    const source = fs.readFileSync(HOSTED_PATH, 'utf8');
    const overviewIndex = source.indexOf('<section class="panel" aria-labelledby="results-title">');
    const monthlyIndex = source.indexOf('<section class="panel monthly-projection-panel"');
    const annualIndex = source.indexOf('<details class="panel advanced" id="annualDetails">');
    const exploreIndex = source.indexOf('<details class="panel advanced details-hub" id="exploreDetails">');
    expect(overviewIndex).toBeGreaterThan(-1);
    expect(monthlyIndex).toBeGreaterThan(overviewIndex);
    expect(annualIndex).toBeGreaterThan(monthlyIndex);
    expect(exploreIndex).toBeGreaterThan(annualIndex);
    expect(source).toMatch(/id="fundingWarning"[^>]*><\/div>\s*<\/section>\s*<section class="panel monthly-projection-panel"/);
    expect(source).toContain('id="monthlyProjectionScroll" role="region"');
    expect(source).toContain('aria-labelledby="monthlyProjectionTitle"');
    expect(source).toContain('aria-describedby="monthlyProjectionHelp" tabindex="0"');
    expect(source).toContain('height: calc(var(--monthly-header-height) + (12 * var(--monthly-row-height)) + 2px);');
    expect(source).toContain('.monthly-table thead { position: sticky; top: 0; z-index: 3; }');
    expect(source).toContain('overscroll-behavior: contain;');
    expect(source).toContain('-webkit-overflow-scrolling: touch;');
    expect(source).toContain("$('#monthlyRows').innerHTML = state.driver.rows.map((row) =>");
    expect(source).toContain('data-month="${row.month}"');
    expect(source).not.toMatch(/<details[^>]+id="monthlyDetails"/);
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
