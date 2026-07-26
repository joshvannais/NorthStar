'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Mission 19 Part 3 ratification and legacy-authority containment', () => {
  test('canonical creation has PostgreSQL transaction authority and no file or legacy-store writer', () => {
    const graph = source('src/services/canonicalGraphService.js');
    const repository = source('src/persistence/v2/repository.js');
    const route = source('src/routes/simulations.js');
    const canonicalSources = [graph, repository, route].join('\n');

    expect(graph).toContain('repository.withTransaction');
    expect(route).toContain('ingestSimulation(db.getPool(), graphRequest)');
    expect(canonicalSources).not.toMatch(/require\(['"](?:fs|\.\.\/leads\/store|\.\.\/polaris\/store)['"]\)/);
    expect(canonicalSources).not.toMatch(/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|unlink)\s*\(/);
    expect(canonicalSources).not.toMatch(/(?:^|['"`])data[\\/]/m);
  });

  test('browser storage is identity metadata only and never a business projection authority', () => {
    const canonicalClient = source('public/js/canonical-intelligence.js');
    const appStore = source('public/js/app-store.js');
    const browserAuthority = canonicalClient + '\n' + appStore;

    const storageKeys = [];
    for (const expression of [
      /(?:localStorage|sessionStorage)\s*,\s*['"]([^'"]+)['"]/g,
      /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g,
    ]) {
      for (const match of browserAuthority.matchAll(expression)) storageKeys.push(match[1]);
    }
    expect(new Set(storageKeys)).toEqual(new Set([
      'northstarSessionOwner', 'northstarSessionId', 'token', 'user', 'northstar-theme',
    ]));
    expect(appStore.match(/localStorage\.setItem/g) || []).toHaveLength(1);
    expect(appStore).toContain("localStorage.setItem('northstar-theme', value)");
    expect(appStore).not.toMatch(/sessionStorage\.(?:getItem|setItem|removeItem)/);
    expect(canonicalClient).toContain("safeStorage(global.localStorage, 'token')");
    expect(canonicalClient).toContain("safeStorage(global.localStorage, 'user')");
    expect(canonicalClient).toContain("safeStorage(global.sessionStorage, 'northstarSessionId')");
  });

  test('audit SQL matches the migrated schema and cache code has no Redis requirement', () => {
    const audit = source('src/audit/client.js');
    const cache = source('src/cache/client.js');

    expect(audit).toMatch(/INSERT INTO audit_logs\s*\(organization_id, user_id, action, entity_type, entity_id, details, ip_address, created_at\)/);
    expect(audit).not.toMatch(/CREATE\s+(?:TABLE|INDEX)/i);
    expect(audit).not.toMatch(/INSERT INTO audit_logs[\s\S]{0,300}\bactor_id\b/i);
    expect(cache).not.toMatch(/require\(['"]redis['"]\)/);
    expect(cache).not.toContain('REDIS_URL');
    expect(cache).toContain('PostgreSQL is always authoritative');
  });

  test('every real PostgreSQL suite owns a run, suite, worker, and process isolated database', () => {
    const helper = source('tests/helpers/m19-part3-postgres-database.js');
    expect(helper).toContain('M19_TEST_RUN_ID');
    expect(helper).toContain('JEST_WORKER_ID');
    expect(helper).toContain('process.pid');
    expect(helper).toContain("parsed.hostname !== '127.0.0.1'");
    expect(helper).toContain('port === 5432');
    expect(helper).toContain('M19_EXPECTED_PG_DATA_DIR');
    expect(helper).toContain('DROP DATABASE');

    for (const suite of [
      'tests/integration/m19-part3-audit-postgres.test.js',
      'tests/integration/m19-part3-persistence-v2-postgres.test.js',
      'tests/integration/m19-part3-canonical-graph-postgres.test.js',
      'tests/api/m19-part3-canonical-api-postgres.test.js',
      'tests/api/polaris.test.js',
    ]) {
      expect(source(suite)).toContain('createSuiteDatabase');
    }
  });

  test('every ratified page declares canonical server projections', () => {
    const pages = [
      'public/dashboard/lead.html',
      'public/dashboard/leads.html',
      'public/dashboard/communications.html',
      'public/dashboard/calendar.html',
      'public/dashboard/command-center.html',
      'public/dashboard/polaris.html',
      'public/dashboard/executive-brief.html',
    ];
    for (const page of pages) {
      const html = source(page);
      expect(html).toContain('meta name="northstar-canonical-surfaces"');
      expect(html).toContain('/js/canonical-intelligence.js');
    }
  });

  test('durable suites retain every mandatory real-runtime ratification gate', () => {
    const graphSuite = source('tests/integration/m19-part3-canonical-graph-postgres.test.js');
    const apiSuite = source('tests/api/m19-part3-canonical-api-postgres.test.js');
    const auditSuite = source('tests/integration/m19-part3-audit-postgres.test.js');
    const browserSuite = source('tests/browser/m19-part3-cross-page-matrix.js');

    for (const gate of [
      '32 concurrent requests across two Node processes',
      'restart after claim',
      'restart after commit',
      'failure after %s rolls back every graph artifact',
      'expired lease has exactly one takeover owner',
    ]) expect(graphSuite).toContain(gate);
    expect(apiSuite).toContain('m19-part3-fence-001');
    expect(apiSuite).toContain('organization, user, and session matrix fails closed');
    expect(auditSuite).toContain('without actor_id assumptions');
    expect(browserSuite).toContain('all seven surfaces share one graph');
    expect(browserSuite).toContain("selected === 'chrome' || selected === 'webkit'");
  });
});
