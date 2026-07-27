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

  test('audit SQL matches the migrated schema and canonical reads cannot use acceleration caches', () => {
    const audit = source('src/audit/client.js');
    const cache = source('src/cache/client.js');
    const canonicalRoute = source('src/routes/canonicalPolaris.js');
    const canonicalGraph = source('src/services/canonicalGraphService.js');

    expect(audit).toMatch(/INSERT INTO audit_logs\s*\(organization_id, user_id, action, entity_type, entity_id, details, ip_address, created_at\)/);
    expect(audit).not.toMatch(/CREATE\s+(?:TABLE|INDEX)/i);
    expect(audit).not.toMatch(/INSERT INTO audit_logs[\s\S]{0,300}\bactor_id\b/i);
    expect(cache).not.toMatch(/require\(['"]redis['"]\)/);
    expect(cache).not.toContain('REDIS_URL');
    expect(cache).toContain('PostgreSQL is always authoritative');
    expect(cache).toMatch(/async function setCanonical[\s\S]*return false;/);
    expect(cache).toMatch(/async function wrapCanonical[\s\S]*return fetchFn\(\);/);
    expect(canonicalRoute).not.toContain('wrapCanonical');
    expect(canonicalGraph).not.toContain('wrapCanonical');
  });

  test('mounted legacy authority is retired and canonical voice authority is PostgreSQL scoped', () => {
    const server = source('src/server.js');
    const retirement = source('src/routes/legacyAuthorityRetirement.js');
    const voiceRoute = source('src/routes/voice.js');
    const voiceAuthority = source('src/services/voiceSessionAuthority.js');

    expect(server).not.toContain("require('./routes/polaris')");
    expect(server).not.toContain("require('./routes/polaris-engines')");
    expect(server).not.toContain("require('./routes/publicApi')");
    expect(server).toContain("require('./routes/legacyAuthorityRetirement')");
    expect(retirement).toContain("code: 'LEGACY_AUTHORITY_RETIRED'");
    expect(retirement).toContain("router.get('/polaris/status', retired)");
    expect(voiceRoute).toContain("requirePermission('calls', 'read')");
    expect(voiceRoute).toContain("requirePermission('calls', 'update')");
    expect(voiceAuthority).toContain('canonical_voice_sessions');
    expect(voiceAuthority).toContain('canonical_voice_session_events');
    expect(voiceAuthority).toContain('const runtimeHandles = new Map()');
    expect(voiceAuthority).toContain("'VOICE_RUNTIME_UNAVAILABLE'");
  });

  test('voice profiles and tax values are pinned canonical inputs rather than request inventions', () => {
    const retell = source('src/services/canonicalRetellIngestion.js');
    const graph = source('src/services/canonicalGraphService.js');
    const calculator = source('src/services/canonicalPolarisCalculation.js');
    const simulator = source('public/js/simulator.js');
    const scenarioCatalog = source('src/routes/simulation/scenario-catalog.js');
    const simulationPipeline = source('src/routes/simulation/pipeline.js');
    const voiceMigration = source('migrations/006_canonical_voice_sessions.sql');
    const taxMigration = source('migrations/007_canonical_tax_authority.sql');
    const providerIdentityMigration = source('migrations/009_canonical_voice_provider_identity.sql');

    expect(retell).toContain('voiceSession = await voiceSessions.createSession(pool, {');
    expect(retell).toContain("findSessionByProviderIdentity(pool, 'retell', callId)");
    expect(retell).toContain('businessProfileAuthorityId: voiceSession && voiceSession.profile.id');
    expect(retell).toContain('businessProfileAuthorityVersion: voiceSession && voiceSession.profile.version');
    expect(retell).toContain('businessProfileAuthorityHash: voiceSession && voiceSession.profile.hash');
    expect(graph).toContain('const authority = request.businessProfileAuthorityId');
    expect(graph).toContain('await getBusinessProfileById(resolvedPool, request.organizationId, request.businessProfileAuthorityId)');
    expect(graph).toContain('request.businessProfileAuthority = authority');
    expect(calculator).toContain("'tax_configuration_unavailable'");
    expect(calculator).toContain('totalIncludingTax');
    expect(calculator).not.toContain("require('../routes/simulation/");
    expect(calculator).not.toContain('definition.pricing');
    expect(fs.existsSync(path.join(ROOT, 'src/routes/simulation/service-catalog.js'))).toBe(false);
    expect(simulationPipeline).toContain("require('./scenario-catalog')");
    expect(simulationPipeline).not.toMatch(/\.pricing\b|calculatePricing|service-catalog/);
    expect(scenarioCatalog).not.toMatch(/\b(?:unitRate|unitRates|fixedPrice|avgPrice|calculate)\s*:/);
    expect(simulator).not.toMatch(/function\s+calcPrice\s*\(|function\s+calcBreakdown\s*\(/);
    expect(source('src/routes/demo.js')).toContain("require('../services/demoVoiceLifecycle')");
    expect(source('src/routes/demo.js')).not.toMatch(/INDUSTRY_DEFAULTS|demoSessions|function\s+polarisEstimate|polarisEstimate\s*\(/);
    expect(voiceMigration).toContain('CREATE TABLE IF NOT EXISTS canonical_voice_sessions');
    expect(voiceMigration).toContain('CREATE TABLE IF NOT EXISTS canonical_voice_session_events');
    expect(taxMigration).toContain('tax_rate_percent');
    expect(taxMigration).toContain('tax_not_calculated_reason');
    expect(taxMigration).toContain('total_including_tax');
    expect(providerIdentityMigration).toContain('provider_session_id');
    expect(providerIdentityMigration).toContain('canonical_voice_sessions_provider_identity');
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
      'tests/api/m19-part3-remediation-mounted-postgres.test.js',
      'tests/integration/m19-part3-voice-sessions-postgres.test.js',
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

  test('deployment inventory discloses route, canary, rollback, CI, and production boundaries', () => {
    const deployment = source('docs/m19-part3-canonical-authority-deployment.md');
    expect(deployment).toContain('## Mounted legacy route disposition');
    expect(deployment).toContain('LEGACY_AUTHORITY_READ_ONLY');
    expect(deployment).toContain('LEGACY_AUTHORITY_RETIRED');
    expect(deployment).toContain('## Canary and observability checks');
    expect(deployment).toContain('## Rollback and stop criteria');
    expect(deployment).toContain('CI is unavailable, not passing');
    expect(deployment).toContain('has not changed Railway, production data, production');
    expect(deployment).toContain('or PR #66');
  });

  test('durable suites retain every mandatory real-runtime ratification gate', () => {
    const graphSuite = source('tests/integration/m19-part3-canonical-graph-postgres.test.js');
    const apiSuite = source('tests/api/m19-part3-canonical-api-postgres.test.js');
    const auditSuite = source('tests/integration/m19-part3-audit-postgres.test.js');
    const voiceSuite = source('tests/integration/m19-part3-voice-sessions-postgres.test.js');
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
    expect(voiceSuite).toContain('identical provider IDs remain isolated by organization');
    expect(voiceSuite).toContain('profile pinned when the session was created');
    expect(browserSuite).toContain('all seven surfaces share one graph');
    expect(browserSuite).toContain("selected === 'chrome' || selected === 'webkit'");
  });
});
