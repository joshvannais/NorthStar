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

describe('Mission 27 Part 14G release readiness', () => {
  test('binds the accepted local heads and exact independent Part 14F evidence', () => {
    expect(authority.validate({...docs})).toEqual(expect.objectContaining({
      contractVersion:'m27-part14g-release-readiness-v1',
      acceptedPart14EHead:'a40be2435c3aa720cb2d179b10adc00530bd794e',
      acceptedPart14FHead:'6f7a8939b6eb8d58bd20e2eff7500c9a5a01a9b0',
      currentSlice:'14G', currentStatus:'readiness_candidate', laterSlices:[],
      migrationLatest:272, migration273Present:false,
    }));
    expect(authority.PART14E_ACCEPTANCE).toEqual(expect.objectContaining({
      tree:'af9831f8ebda83eecbdd2a4ce8717fc8e6576e86',
      merged:false, deployed:false, released:false, founderVisualVerdict:false,
    }));
    expect(authority.PART14F_ACCEPTANCE).toEqual(expect.objectContaining({
      tree:'ead3dc3b463d1ae48aa606b19a51fbf8ea06e30c',
      auditReportSha256:'c0b917d5c948419c415282a9c0ca117e2a9a11ed24382da45f00cd4848f8ede0',
      auditSummarySha256:'186e600d64b6382f8574d57d1809cf82951f45b280bcbef95c635425a8cc6ba6',
      sourceManifestSha256:'f5a1f1745422b2082dd0eea4da4a2782e729dbe214c86047331d95d695ef2c10',
      artifactManifestSha256:'fc1152a4d33d4736c22fe44c4bc669c6b9076efe818bd1f6ef59a811f36466b8',
      sourceArchiveSha256:'49011b560be16b75cf8266e85481d9d69d6a7e30d71f20e51f0215a4c0b6cc4a',
      p0:0, p1:0, p2:0, p3:0, merged:false, deployed:false, released:false,
    }));
  });

  test('keeps the strict queue and every release action open', () => {
    expect(authority.PART14B_ACCEPTANCE).toEqual(expect.objectContaining({
      head:'dcfde9c363f733f910fc11c3f1c7ad0f9ad078e9',
      tree:'4d7c7adb19afffcf46e798098e8212d6f90a7a7f',
      main:'5b99fa56a30c6c7ededcefb50d96d9272e41a8f0', pr:'PR #546',
      deploymentState:'post_merge_deployment_health_unavailable', released:false,
    }));
    expect(readiness).toContain('No post-merge automatic deployment or health evidence was supplied');
    expect(readiness).toContain('Parts 14C-14F retain their exact accepted source identities');
    const gates = [...readiness.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1]));
    expect(gates).toEqual([1,2,3,4,5,6,7,8,9]);
    for (const required of [
      'Require one automatic Railway deployment',
      'Local reconciliation is complete',
      'Backup gate evidence is recorded',
      'one normal reviewed pull request',
      'exactly one automatic Railway application deployment',
      'verify the complete migration ledger and checksums',
      'production-safe rendered verification',
      "founder's separate page-by-page visual verdict",
      'final source-linked acceptance ledger',
    ]) expect(readiness).toContain(required);
    expect(row('14G')).toContain('Current reconciled readiness candidate; unreleased');
    expect(row('14G')).toContain('verified pre-migration backup dashboard record');
    expect(row('14G')).toContain('no restore, PR, merge, deployment, production verification');
  });

  test('advances no named verdict and preserves every unavailable boundary', () => {
    for (const verdict of [
      'Full local', 'Production deployed / provider disabled', 'Provider-sandbox accepted',
      'Live-payment accepted', 'Mission complete',
    ]) {
      const line = ledger.split(/\r?\n/).find(value => value.startsWith(`| ${verdict} |`));
      expect(line).toBeDefined();
      expect(line).toMatch(/\| Not achieved \|$/);
      expect(readiness).toContain(`\`${verdict}\``);
    }
    for (const unavailable of [
      'Physical Safari and physical devices', 'manual assistive-technology testing',
      'hosted production load and SLA evidence', 'private-production tenant behavior',
      'provider sandbox/account/capability/credential/event evidence',
      'disaster-restore execution', 'first-paying-customer live-money validation',
      'founder visual approval',
    ]) expect(readiness).toContain(unavailable);
    expect(readiness).toContain('No restore, PR, merge, deployment, Railway mutation');
  });

  test.each([
    ['backup', 'This packet did not create, download, inspect contents of or restore it', 'The backup was restored and fully verified'],
    ['deployment', 'No post-merge automatic deployment or health evidence was supplied', 'Deployment and health succeeded'],
    ['founder', 'cannot grant it', 'granted the founder verdict'],
    ['live money', 'remain unavailable', 'are accepted and available'],
    ['verdict', 'remain not achieved', 'are all achieved'],
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
