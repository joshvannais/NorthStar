'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const ROOT = path.resolve(__dirname, '../..');
const BANNED_FILES = [
  'src/polaris/engine.js',
  'src/polaris/estimation.js',
  'src/polaris/financial-engine.js',
  'src/retell/webhook.js',
  'src/routes/polaris.js',
  'src/routes/polaris-engines.js',
  'src/routes/simulation/service-catalog.js',
];

function resolveLocal(fromFile, requestPath) {
  if (!requestPath.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), requestPath);
  for (const candidate of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function dependencyGraph(entry) {
  const visited = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const target = resolveLocal(file, match[1]);
      if (target && target.startsWith(path.join(ROOT, 'src'))) pending.push(target);
    }
  }
  return visited;
}

describe('production startup calculation authority', () => {
  test('static server dependency graph excludes every retired calculator and demo authority', () => {
    const graph = dependencyGraph(path.join(ROOT, 'src/server.js'));
    const relative = new Set(Array.from(graph, file => path.relative(ROOT, file).replace(/\\/g, '/')));
    for (const banned of BANNED_FILES) {
      expect(fs.existsSync(path.join(ROOT, banned))).toBe(false);
      expect(relative.has(banned)).toBe(false);
    }
    expect(Array.from(relative).filter(file => /^src\/polaris\/.*-engine\.js$/.test(file))).toEqual([]);
    const demo = fs.readFileSync(path.join(ROOT, 'src/routes/demo.js'), 'utf8');
    expect(demo).not.toMatch(/\b(?:INDUSTRY_DEFAULTS|demoSessions|buildPolarisIntelligence)\b|function\s+polarisEstimate|polarisEstimate\s*\(/);
    expect(demo).not.toMatch(/\b(?:labor|materials?|overhead|margin|tax|unitRate|calculatePricing)\b\s*[:=]/i);
    expect(demo).toContain("require('../services/demoVoiceLifecycle')");
  });

  test('normal server startup and representative mounted routes never load a retired calculator', async () => {
    const originalPort = process.env.PORT;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalDemoOrganizationId = process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
    delete process.env.DATABASE_URL;
    delete process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
    process.env.PORT = '0';
    jest.resetModules();
    let server;
    try {
      const normal = require('../../src/server');
      server = await normal.start();
      const mounted = request(server);
      expect((await mounted.get('/api/health')).status).toBe(200);
      expect((await mounted.get('/api/v1/polaris/status')).status).toBe(410);
      expect((await mounted.get('/api/v1/financial/metrics')).status).toBe(401);
      expect((await mounted.post('/api/v1/simulations/leads').send({ service: 'fence' })).status).toBe(401);
      expect((await mounted.get('/api/demo/status')).status).toBe(503);
      expect((await mounted.get('/api/v1/canonical/status')).status).toBe(401);

      const loaded = Object.keys(require.cache).map(file => path.relative(ROOT, file).replace(/\\/g, '/'));
      for (const banned of BANNED_FILES) expect(loaded).not.toContain(banned);
      expect(loaded.filter(file => /^src\/polaris\/.*-engine\.js$/.test(file))).toEqual([]);
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalDemoOrganizationId === undefined) delete process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
      else process.env.NORTHSTAR_DEMO_ORGANIZATION_ID = originalDemoOrganizationId;
    }
  }, 30000);
});
