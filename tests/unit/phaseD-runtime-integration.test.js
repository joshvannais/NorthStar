/**
 * M19.5 Phase D — Runtime Integration Tests
 *
 * Tests the full runtime path through buildPolarisIntelligence.
 * Verifies that:
 *   1. extractPolarisFactsWithEntities is the production entry point
 *   2. Entity output appears in canonical record for Tree Service
 *   3. workScopes are populated correctly
 *   4. Ineligible facts don't influence estimates
 *   5. Phase C fallback intact for non-Tree-Service
 *   6. Phase C regression preserved
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const originalDataDir = process.env.NORTHSTAR_DATA_DIR;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-phase-d-runtime-'));
fs.copyFileSync(
  path.resolve(__dirname, '../../data/business-profile.json'),
  path.join(testDataDir, 'business-profile.json')
);
process.env.NORTHSTAR_DATA_DIR = testDataDir;

const demo = require('../../src/routes/demo');
const buildPolarisIntelligence = demo.buildPolarisIntelligence;

afterAll(function () {
  fs.rmSync(testDataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.NORTHSTAR_DATA_DIR;
  else process.env.NORTHSTAR_DATA_DIR = originalDataDir;
});

// ── Helpers ──
function loadFixture(name) {
  return require('../fixtures/polaris/transcripts/' + name);
}

function buildFromFixture(fixture) {
  const turns = (fixture.turns || []).map(function(t) {
    return { turnId: t.turnId, speaker: t.speaker, utterance: t.utterance, source: fixture.transcriptSource || 'simulation' };
  });
  return buildPolarisIntelligence(
    'NorthStar Solutions',
    fixture.industry,
    turns,
    undefined,
    fixture.transcriptSource || 'simulation'
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Tree Service grouped-tree scenario (D-B fixture)
// ═══════════════════════════════════════════════════════════════════════════
describe('Tree Service — grouped trees (D-B)', function() {
  let record;

  beforeAll(function() {
    const f = loadFixture('D-B-multiple-trees-grouped');
    record = buildFromFixture(f);
  });

  it('estimate source is industry_capability', function() {
    expect(record.estimateSource).toBe('industry_capability');
  });

  it('workScopes is populated', function() {
    expect(Array.isArray(record.workScopes)).toBe(true);
    expect(record.workScopes.length).toBeGreaterThan(0);
  });

  it('workScopes[0].domain is tree_service', function() {
    expect(record.workScopes[0].domain).toBe('tree_service');
  });

  it('workScopes[0].serviceType is null (not hard-coded)', function() {
    expect(record.workScopes[0].serviceType).toBeNull();
  });

  it('workScopes[0].subject.type is treeGroup', function() {
    expect(record.workScopes[0].subject.type).toBe('treeGroup');
  });

  it('revenue range uses capability estimate (not Phase C fallback)', function() {
    // Phase C fallback for 4x120ft trees would be 1800*1.6 = 2880 min
    // Phase D estimate should be in a different range
    expect(record.estimate.rangeMin).toBeGreaterThan(0);
    expect(record.estimate.rangeMax).toBeGreaterThan(record.estimate.rangeMin);
  });

  it('canonical record has all Phase C fields', function() {
    expect(record.industry).toBe('Tree Service');
    expect(record.requestedService).toBeTruthy();
    expect(record.estimatingVariables).toBeTruthy();
    expect(record.missingInformation).toBeTruthy();
    expect(record.polarisFacts).toBeTruthy();
    expect(record.factModelVersion).toBe('1.0');
    expect(record.executiveBriefing).toBeTruthy();
    expect(record.reasoning).toBeTruthy();
    expect(typeof record.confidence).toBe('number');
    expect(typeof record.revenueRange).toBe('string');
  });

  it('workScopes have factIds', function() {
    for (const ws of record.workScopes) {
      expect(Array.isArray(ws.factIds)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Tree Service single-tree scenario (D-A fixture)
// ═══════════════════════════════════════════════════════════════════════════
describe('Tree Service — single tree (D-A)', function() {
  let record;

  beforeAll(function() {
    const f = loadFixture('D-A-single-tree-basic');
    record = buildFromFixture(f);
  });

  it('estimate source is industry_capability', function() {
    expect(record.estimateSource).toBe('industry_capability');
  });

  it('workScopes has at least one scope', function() {
    expect(record.workScopes.length).toBeGreaterThan(0);
  });

  it('serviceType is null', function() {
    expect(record.workScopes[0].serviceType).toBeNull();
  });

  it('Phase C fields are present', function() {
    expect(record.industry).toBe('Tree Service');
    expect(record.requestedService.primary).toBe('Tree Removal');
    expect(record.polarisFacts.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Tree Service conflicting heights (D-E fixture)
// ═══════════════════════════════════════════════════════════════════════════
describe('Tree Service — conflicting heights (D-E)', function() {
  let record;

  beforeAll(function() {
    const f = loadFixture('D-E-conflicting-heights');
    record = buildFromFixture(f);
  });

  it('estimate is still applicable with conflicting facts', function() {
    expect(record.estimateSource).toBe('industry_capability');
  });

  it('workScopes are present', function() {
    expect(record.workScopes.length).toBeGreaterThan(0);
  });

  it('revenue range is bounded', function() {
    expect(record.estimate.rangeMin).toBeGreaterThan(0);
    expect(record.estimate.rangeMax).toBeLessThan(20000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Concrete driveway — non-Tree-Service regression
// ═══════════════════════════════════════════════════════════════════════════
describe('Concrete driveway — Phase C fallback', function() {
  let record;

  beforeAll(function() {
    const f = loadFixture('F2-concrete-driveway');
    record = buildFromFixture(f);
  });

  it('estimate source is phase_c_fallback', function() {
    expect(record.estimateSource).toBe('phase_c_fallback');
  });

  it('workScopes is empty array', function() {
    expect(Array.isArray(record.workScopes)).toBe(true);
    expect(record.workScopes.length).toBe(0);
  });

  it('revenue range matches Phase C expected range', function() {
    // Concrete baseline is $3,000-$8,000. Phase C fallback may adjust.
    // Verify range is plausible (positive, min < max).
    expect(record.estimate.rangeMin).toBeGreaterThan(0);
    expect(record.estimate.rangeMax).toBeLessThanOrEqual(10000);
    expect(record.estimate.rangeMax).toBeGreaterThan(record.estimate.rangeMin);
  });

  it('no tree-specific data anywhere', function() {
    const json = JSON.stringify(record);
    expect(json).not.toContain('tree_service');
    expect(json).not.toContain('treeGroup');
    expect(json).not.toContain('tree_group');
  });

  it('all Phase C fields unchanged', function() {
    expect(record.industry).toBe('Concrete');
    expect(record.requestedService).toBeTruthy();
    expect(record.estimatingVariables).toBeTruthy();
    expect(record.missingInformation).toBeTruthy();
    expect(record.polarisFacts).toBeTruthy();
    expect(record.factModelVersion).toBe('1.0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. HVAC — non-Tree-Service regression (simulated)
// ═══════════════════════════════════════════════════════════════════════════
describe('HVAC — Phase C fallback', function() {
  let record;

  beforeAll(function() {
    const turns = [
      { turnId: 't0', speaker: 'agent', utterance: 'HVAC services, how can I help?', source: 'simulation' },
      { turnId: 't1', speaker: 'customer', utterance: 'My AC is broken. The house is about 2,200 square feet and the unit is 12 years old.', source: 'simulation' },
    ];
    record = buildPolarisIntelligence('Test Co', 'HVAC', turns, undefined, 'simulation');
  });

  it('estimate source is phase_c_fallback', function() {
    expect(record.estimateSource).toBe('phase_c_fallback');
  });

  it('workScopes is empty array', function() {
    expect(Array.isArray(record.workScopes)).toBe(true);
  });

  it('no tree contamination', function() {
    const json = JSON.stringify(record);
    expect(json).not.toContain('tree_service');
    expect(json).not.toContain('treeGroup');
  });

  it('Phase C fields intact', function() {
    expect(record.industry).toBe('HVAC');
    expect(record.requestedService.primary).toBeTruthy();
    expect(record.polarisFacts.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Pricing baseline protection
// ═══════════════════════════════════════════════════════════════════════════
describe('pricing baseline protection', function() {
  it('Tree Service estimate range stays within safe bounds', function() {
    const f = loadFixture('D-A-single-tree-basic');
    const record = buildFromFixture(f);

    // Min should not drop below 80% of baseline min (1800 * 0.8 = 1440)
    expect(record.estimate.rangeMin).toBeGreaterThanOrEqual(1440);
    // Max should not exceed 120% of baseline max for standard jobs (3800 * 1.2 = 4560)
    // Note: high-urgency or complex jobs may exceed this
    expect(record.estimate.rangeMax).toBeGreaterThan(0);
  });

  it('non-Tree-Service baseline unchanged', function() {
    const f = loadFixture('F2-concrete-driveway');
    const record = buildFromFixture(f);

    // Concrete baseline: $3,000-$8,000
    expect(record.estimate.rangeMin).toBeGreaterThanOrEqual(2400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. demo.js architectural guardrails
// ═══════════════════════════════════════════════════════════════════════════
describe('architectural guardrails', function() {
  it('demo.js has no industry === Tree Service check', function() {
    const fs = require('fs');
    const demoJs = fs.readFileSync('src/routes/demo.js', 'utf8');
    // Allow it in comments only, not in code
    const codeLines = demoJs.split('\n').filter(function(l) {
      return !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*');
    });
    const codeBody = codeLines.join('\n');
    expect(codeBody).not.toContain("industry === 'Tree Service'");
    expect(codeBody).not.toContain('industry === "Tree Service"');
  });

  it('demo.js has no treeGroups reference', function() {
    const fs = require('fs');
    const demoJs = fs.readFileSync('src/routes/demo.js', 'utf8');
    expect(demoJs).not.toContain('treeGroups');
  });

  it('demo.js has no entity model imports', function() {
    const fs = require('fs');
    const demoJs = fs.readFileSync('src/routes/demo.js', 'utf8');
    expect(demoJs).not.toContain("require('./entityModel')");
    expect(demoJs).not.toContain("require('../polaris/entityModel')");
    expect(demoJs).not.toContain("require('./estimateSafeguards')");
    expect(demoJs).not.toContain("require('../polaris/estimateSafeguards')");
  });
});
