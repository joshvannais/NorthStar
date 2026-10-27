'use strict';

const fs = require('node:fs');
const path = require('node:path');
const authority = require('../../src/customerFinancial/mission27Part14Authority');

const ROOT = path.resolve(__dirname, '../..');
const docs = Object.freeze(Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
  .map(([name, entry]) => [name, fs.readFileSync(path.join(ROOT, entry.path), 'utf8')])));
const ledger = docs.ledger;
const readiness = docs.releaseReadiness14G;

function row(id) {
  const matches = ledger.split(/\r?\n/).filter(line => line.startsWith(`| ${id} |`));
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe('Mission 27 Part 14G final source-linked release ledger', () => {
  test('binds the exact accepted source, independent audit and production release identities', () => {
    expect(authority.validate({...docs})).toEqual(expect.objectContaining({
      contractVersion:'m27-part14g-final-ledger-v1',
      acceptedPart14EHead:'a40be2435c3aa720cb2d179b10adc00530bd794e',
      acceptedPart14FHead:'6f7a8939b6eb8d58bd20e2eff7500c9a5a01a9b0',
      releasedPart14GSourceHead:'e8f57fc820b1c302b7a18a3ee61606a62712ca1d',
      currentSlice:'14G', currentStatus:'production_deployed_provider_disabled', laterSlices:[],
      migrationLatest:272, migration273Present:false,
    }));
    expect(authority.PART14E_ACCEPTANCE).toEqual(expect.objectContaining({
      tree:'af9831f8ebda83eecbdd2a4ce8717fc8e6576e86',
      releasePr:'PR #547', releaseMain:'e376a8f111b09d8d699c38243034ac1b6972006b',
      includedInCumulativeRelease:true, deployed:true, released:true,
      founderVisualVerdict:false,
    }));
    expect(authority.PART14F_ACCEPTANCE).toEqual(expect.objectContaining({
      tree:'ead3dc3b463d1ae48aa606b19a51fbf8ea06e30c',
      auditReportSha256:'c0b917d5c948419c415282a9c0ca117e2a9a11ed24382da45f00cd4848f8ede0',
      auditSummarySha256:'186e600d64b6382f8574d57d1809cf82951f45b280bcbef95c635425a8cc6ba6',
      sourceManifestSha256:'f5a1f1745422b2082dd0eea4da4a2782e729dbe214c86047331d95d695ef2c10',
      artifactManifestSha256:'fc1152a4d33d4736c22fe44c4bc669c6b9076efe818bd1f6ef59a811f36466b8',
      sourceArchiveSha256:'49011b560be16b75cf8266e85481d9d69d6a7e30d71f20e51f0215a4c0b6cc4a',
      p0:0, p1:0, p2:0, p3:0,
      includedInCumulativeRelease:true, deployed:true, released:true,
    }));
    expect(authority.PART14G_RELEASE).toEqual(expect.objectContaining({
      sourceHead:'e8f57fc820b1c302b7a18a3ee61606a62712ca1d',
      tree:'74eb868298d307afbfadac0330cc32815335dd01',
      pr:'PR #547', mergedAt:'2026-10-27T01:59:09Z',
      main:'e376a8f111b09d8d699c38243034ac1b6972006b',
      deployment:'7071c54c-8996-40bc-8285-40a4901b8353',
      deploymentState:'success_running',
      image:'sha256:0709afab6fb728f2e6ebc2007ceef461b3b0a34fbe9105f2cf440148b505946b',
      p0:0, p1:0, p2:0, p3:0, node:'22.23.3',
      syntaxPassed:1999, syntaxTotal:1999,
      nonLauncherSuitesPassed:65, nonLauncherTestsPassed:553,
      productionLauncherPassed:105, productionLauncherIntentionalSkips:3,
      postgresSuitesPassed:4, postgresTestsPassed:18,
      browserEngineLayoutChecksPassed:30,
      productionMigrationReadOnlyTransaction:true,
      productionMigrationTotal:268, migrationLatest:272, migration273Present:false,
      startupCompositionReady:true, healthRootDemoHttp200:true,
      demoNavigationClicksVerified:true, zeroNonReadRequests:true, zeroPageErrors:true,
      paidDashboardAuthBoundary:'/login', expectedReadOnlyUnauthorized:true,
      cloudflareAnalyticsCspBlockIsPlatformNoise:true,
      backupDashboardRecord:'2026-10-26 09:03 America/New_York',
      backupSizeMb:216, restoreVerified:false,
      namedVerdict:'production_deployed_provider_disabled',
      providerSandboxAccepted:false, livePaymentAccepted:false, missionComplete:false,
      physicalSafariDevicesVerified:false, manualAssistiveTechnologyVerified:false,
      hostedLoadSlaVerified:false, privateProductionProviderVerified:false,
      founderVisualVerdict:false,
    }));
  });

  test('records the exact reviewed merge, sole deployment, health and migration evidence', () => {
    expect(authority.PART14B_ACCEPTANCE).toEqual(expect.objectContaining({
      head:'dcfde9c363f733f910fc11c3f1c7ad0f9ad078e9',
      tree:'4d7c7adb19afffcf46e798098e8212d6f90a7a7f',
      main:'5b99fa56a30c6c7ededcefb50d96d9272e41a8f0', pr:'PR #546',
      deployment:'7ab284a4-34a9-4a22-96c7-cffc5f36355f',
      image:'sha256:51be9509ba6715b39f12d9415fbcde6ec968d15157c10656e24439a33727086c',
      deploymentState:'success', startupHealthy:true, healthRootDemoHttp200:true,
      productionMigrationTotal:268, migrationLatest:272, migration273Present:false,
      released:true,
    }));
    expect(readiness).toContain('PR #547 merged normally at `2026-10-27T01:59:09Z`');
    expect(readiness).toContain('`7071c54c-8996-40bc-8285-40a4901b8353`, SUCCESS/RUNNING');
    expect(readiness).toContain('total 268, migration 272 latest and no migration 273 or drift');
    expect(readiness).toContain('`/api/health`, `/`, and `/demo/` returned HTTP 200');
    const gates = [...readiness.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1]));
    expect(gates).toEqual([1,2,3,4,5,6]);
    for (const required of [
      'exact source merged by PR #547',
      'Exactly one automatic application deployment',
      'production migration ledger was inspected read-only',
      'Startup composition reported ready',
      'Production-safe Chrome desktop and phone interaction',
      'Provider, recipient, accounting-receiver and money effects remained disabled',
    ]) expect(readiness).toContain(required);
    expect(row('14G')).toContain('Production deployed / provider disabled');
    expect(row('14G')).toContain('verified pre-migration backup dashboard record');
    expect(row('14G')).toContain('sole automatic deployment `7071c54c-8996-40bc-8285-40a4901b8353` SUCCESS/RUNNING');
  });

  test('advances only the earned production verdict and preserves unavailable boundaries', () => {
    expect(row('14G')).toContain('Production deployed / provider disabled');
    expect(ledger.split(/\r?\n/).find(value => value.startsWith('| Full local |')))
      .toContain('Achieved as prerequisite to the production verdict');
    expect(ledger.split(/\r?\n/).find(value => value.startsWith('| Production deployed / provider disabled |')))
      .toContain('**Achieved**');
    for (const verdict of ['Provider-sandbox accepted','Live-payment accepted','Mission complete']) {
      const line = ledger.split(/\r?\n/).find(value => value.startsWith(`| ${verdict} |`));
      expect(line).toMatch(/\| Not achieved \|$/);
    }
    for (const unavailable of [
      'Physical Safari and physical devices', 'manual assistive-technology testing',
      'hosted production load and SLA evidence', 'private-production tenant behavior',
      'provider sandbox/account/capability/credential/event evidence',
      'disaster-restore execution', 'first-paying-customer live-money validation',
      'founder visual approval',
    ]) expect(readiness).toContain(unavailable);
    expect(readiness).toContain('did not create or restore a backup, open or merge a pull request, deploy or mutate Railway');
  });

  test.each([
    ['backup', 'This packet did not create, download, inspect contents of or restore it', 'The backup was restored and fully verified'],
    ['deployment', 'reached SUCCESS/RUNNING', 'remained queued and undeployed'],
    ['founder', 'do not grant the founder visual verdict', 'grant the founder visual verdict'],
    ['live money', 'remain unavailable', 'are accepted and available'],
    ['verdict', 'The highest earned verdict is `Production deployed / provider disabled`', 'Every named verdict is achieved'],
  ])('whole-document authority rejects false %s readiness', (_name, from, to) => {
    expect(readiness).toContain(from);
    expect(() => authority.validate({...docs,
      releaseReadiness14G:readiness.replace(from, to),
    })).toThrow('Mission 27 Part 14 authority ratification invalid');
  });

  test('preserves migration 272 as latest with no migration 273', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
