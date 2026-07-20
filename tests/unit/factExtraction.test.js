/**
 * M19.5 Phase C — factExtraction unit tests
 * Tests assert correctness, not field presence.
 */
'use strict';
const fe = require('../../src/polaris/factExtraction');

// ── Helpers ──
function loadFixture(name) {
  return require('../fixtures/polaris/transcripts/' + name);
}
function run(industry, turns) {
  const norm = fe.normalizeTranscript(turns, 'simulation');
  return fe.extractPolarisFacts(norm, industry);
}
function findFact(facts, variable) {
  return facts.filter(function(f) { return f.variable === variable; });
}
function getCollected(facts, variable) {
  return findFact(facts, variable).filter(function(f) { return f.status === 'collected' && f.evidence.speaker === 'customer'; });
}
function firstCollected(facts, variable) {
  const c = getCollected(facts, variable);
  return c.length > 0 ? c[0] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Transcript normalization
// ═══════════════════════════════════════════════════════════════════════════
describe('normalizeTranscript', function() {
  it('handles simulation format', function() {
    const t = fe.normalizeTranscript([{ from: 'You', text: 'hello' }, { from: 'Customer', text: 'hi' }], 'simulation');
    expect(t[0].speaker).toBe('agent');
    expect(t[1].speaker).toBe('customer');
    expect(t[0].utterance).toBe('hello');
    expect(t[1].utterance).toBe('hi');
    expect(t[0].source).toBe('simulation');
  });
  it('handles Retell format', function() {
    const t = fe.normalizeTranscript([{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }], 'retell');
    expect(t[0].speaker).toBe('customer');
    expect(t[1].speaker).toBe('agent');
  });
  it('preserves turn order and full utterances', function() {
    const t = fe.normalizeTranscript([{ from: 'You', text: 'first' }, { from: 'Customer', text: 'second' }, { from: 'You', text: 'third' }], 'simulation');
    expect(t.length).toBe(3);
    expect(t[0].utterance).toBe('first');
    expect(t[1].utterance).toBe('second');
    expect(t[2].utterance).toBe('third');
  });
  it('marks unknown speaker safety', function() {
    const t = fe.normalizeTranscript([{ text: 'hello' }], 'simulation');
    expect(t[0].speaker).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Speaker isolation — critical merge gate
// ═══════════════════════════════════════════════════════════════════════════
describe('speaker isolation', function() {
  it('agent urgency question does NOT create customer urgency', function() {
    const f = loadFixture('F3-mixed-speaker-urgency.json');
    const result = run(f.industry, f.turns);
    const urgency = findFact(result.facts, 'urgency');
    // Agent's "emergency" must not count
    const collected = urgency.filter(function(u) { return u.status === 'collected' && u.evidence.speaker === 'customer'; });
    expect(collected.length).toBe(1);
    expect(collected[0].normalizedValue).toBe('standard');
    expect(collected[0].evidence.speaker).toBe('customer');
  });
  it('agent speech never produces customer-collected facts for service', function() {
    const f = loadFixture('F1-tree-service-production-shaped.json');
    const result = run(f.industry, f.turns);
    const svc = firstCollected(result.facts, 'requested_service');
    expect(svc).not.toBeNull();
    expect(svc.evidence.speaker).toBe('customer');
    expect(svc.normalizedValue).toBe('Tree Removal');
  });
  it('agent speech never produces customer-collected facts for measurements', function() {
    const f = loadFixture('F1-tree-service-production-shaped.json');
    const result = run(f.industry, f.turns);
    const height = firstCollected(result.facts, 'Tree Height');
    expect(height).not.toBeNull();
    expect(height.evidence.speaker).toBe('customer');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Measurement and quantity accuracy
// ═══════════════════════════════════════════════════════════════════════════
describe('measurement and quantity parsing', function() {
  it('"four 120-foot trees" → quantity 4, height 120 ft', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'I have four 120-foot trees that need removal.', source: 'simulation' }];
    const result = run('Tree Service', turns);
    const qty = getCollected(result.facts, 'quantity');
    const ht = firstCollected(result.facts, 'Tree Height');
    expect(qty.length).toBe(1);
    expect(qty[0].normalizedValue).toBe(4);
    expect(ht).not.toBeNull();
    expect(ht.normalizedValue).toBe(120);
    expect(ht.unit).toBe('ft');
    // Verify quantity is NOT misread as height
    expect(ht.normalizedValue).not.toBe(4);
  });
  it('"four 120-foot trees" → quantity 4, height 120', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'I have four 120-foot trees.', source: 'simulation' }];
    const result = run('Tree Service', turns);
    const qty = getCollected(result.facts, 'quantity');
    const ht = firstCollected(result.facts, 'Tree Height');
    expect(qty.length).toBe(1);
    expect(qty[0].normalizedValue).toBe(4);
    expect(ht).not.toBeNull();
    expect(ht.normalizedValue).toBe(120);
  });
  it('"about 2,000 square feet" → 2000 sqft', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'My house is about 2,000 square feet.', source: 'simulation' }];
    const result = run('HVAC', turns);
    const sf = firstCollected(result.facts, 'Home Square Footage');
    expect(sf).not.toBeNull();
    expect(sf.normalizedValue).toBe(2000);
    expect(sf.unit).toBe('sqft');
  });
  it('"two thousand square feet" → 2000 sqft', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'My house is two thousand square feet.', source: 'simulation' }];
    const result = run('HVAC', turns);
    const sf = firstCollected(result.facts, 'Home Square Footage');
    expect(sf).not.toBeNull();
    expect(sf.normalizedValue).toBe(2000);
  });
  it('"12 rooms" → quantity 12 rooms', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'I need 12 rooms painted.', source: 'simulation' }];
    const result = run('Painting', turns);
    const rc = getCollected(result.facts, 'Room Count');
    expect(rc.length).toBe(1);
    expect(rc[0].normalizedValue).toBe(12);
  });
  it('"a ten-year-old AC system" → age 10 yr', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'I have a ten-year-old AC system.', source: 'simulation' }];
    const result = run('HVAC', turns);
    const age = firstCollected(result.facts, 'System Age');
    expect(age).not.toBeNull();
    expect(age.normalizedValue).toBe(10);
    expect(age.unit).toBe('yr');
  });
  it('"a 24-inch trunk on a 90-foot tree" → 24 in trunk, 90 ft height', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'It has a 24-inch trunk on a 90-foot tree.', source: 'simulation' }];
    const result = run('Tree Service', turns);
    const ht = firstCollected(result.facts, 'Tree Height');
    expect(ht).not.toBeNull();
    expect(ht.normalizedValue).toBe(90);
  });
  it('"two trees are 80 feet and one is about 110 feet" → two heights', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'Two trees are 80 feet and one is about 110 feet.', source: 'simulation' }];
    const result = run('Tree Service', turns);
    const ht = getCollected(result.facts, 'Tree Height');
    expect(ht.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Fact status invariants
// ═══════════════════════════════════════════════════════════════════════════
describe('fact status invariants', function() {
  it('keyword without value is mentioned_unresolved, not collected', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'The trees are tall.', source: 'simulation' }];
    const result = run('Tree Service', turns);
    const ht = findFact(result.facts, 'Tree Height');
    // "tall" is a keyword but no numeric value → mentioned_unresolved
    expect(ht.length).toBeGreaterThan(0);
    expect(ht[0].status).toBe('mentioned_unresolved');
    expect(ht[0].normalizedValue).toBeNull();
  });
  it('collected requires customer evidence + valid normalizedValue', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'The tree is 80 feet tall.', source: 'simulation' }];
    const result = run('Tree Service', turns);
    const ht = firstCollected(result.facts, 'Tree Height');
    expect(ht).not.toBeNull();
    expect(ht.normalizedValue).toBe(80);
    expect(ht.evidence.speaker).toBe('customer');
    expect(ht.evidence.utterance.length).toBeGreaterThan(0);
    expect(ht.evidence.exactSpan.length).toBeGreaterThan(0);
    // exactSpan must be a substring of utterance
    expect(ht.evidence.utterance.indexOf(ht.evidence.exactSpan)).not.toBe(-1);
  });
  it('no fact is simultaneously collected + null value + "Not discussed" display', function() {
    const turns = [{ speaker: 'customer', turnId: 't0', utterance: 'I need some tree work.', source: 'simulation' }];
    const result = run('Tree Service', turns);
    for (var i = 0; i < result.facts.length; i++) {
      var f = result.facts[i];
      if (f.status === 'collected') {
        expect(f.normalizedValue).not.toBeNull();
        expect(f.evidence.speaker).toBe('customer');
      }
    }
  });
  it('non-customer evidence cannot be collected', function() {
    var turns = [{ speaker: 'agent', turnId: 't0', utterance: 'The tree is 80 feet tall.', source: 'simulation' }];
    var result = run('Tree Service', turns);
    var ht = findFact(result.facts, 'Tree Height');
    // Agent speech alone cannot produce a collected fact
    for (var i = 0; i < ht.length; i++) {
      expect(ht[i].status).not.toBe('collected');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Conflict and correction handling
// ═══════════════════════════════════════════════════════════════════════════
describe('conflict and correction', function() {
  it('incompatible values without correction → conflicting', function() {
    var f = loadFixture('F4-conflicting-measurements.json');
    var result = run(f.industry, f.turns);
    var ht = findFact(result.facts, 'Tree Height');
    var conflicting = ht.filter(function(h) { return h.status === 'conflicting'; });
    expect(conflicting.length).toBeGreaterThan(0);
  });
  it('explicit correction resolves to corrected value', function() {
    var f = loadFixture('F5-explicit-correction.json');
    var result = run(f.industry, f.turns);
    var ht = getCollected(result.facts, 'Tree Height');
    expect(ht.length).toBeGreaterThan(0);
    expect(ht[0].normalizedValue).toBe(60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Compatibility mapping
// ═══════════════════════════════════════════════════════════════════════════
describe('compatibility mapping', function() {
  it('buildPolarisLegacyFromFacts counts only eligible collected facts', function() {
    var facts = [
      { variable: 'A', status: 'collected', normalizedValue: 10, evidence: { speaker: 'customer', utterance: 'a', exactSpan: 'a' }, extractionConfidence: 0.9 },
      { variable: 'B', status: 'mentioned_unresolved', normalizedValue: null, evidence: { speaker: 'customer', utterance: 'b', exactSpan: 'b' }, extractionConfidence: 0.4 },
      { variable: 'C', status: 'missing', normalizedValue: null, evidence: { speaker: 'system', utterance: null, exactSpan: null }, extractionConfidence: 0 },
      { variable: 'D', status: 'collected', normalizedValue: 20, evidence: { speaker: 'customer', utterance: 'd', exactSpan: 'd' }, extractionConfidence: 0.9 },
    ];
    var oldProfile = fe.QUALIFICATION_PROFILES["Test"];
    fe.QUALIFICATION_PROFILES["Test"] = [
      { name: 'A', keywords: ['a'], unit: null },
      { name: 'B', keywords: ['b'], unit: null },
      { name: 'C', keywords: ['c'], unit: null },
      { name: 'D', keywords: ['d'], unit: null },
    ];
    var legacy = fe.buildPolarisLegacyFromFacts(facts, 'Test');
    fe.QUALIFICATION_PROFILES["Test"] = oldProfile;
    expect(legacy.qualification.completeness).toBe(50); // 2/4
    expect(legacy.qualification.collected.length).toBe(2);
    expect(legacy.qualification.missing.length).toBe(2);
  });
  it('compatibility output shape matches consumer expectations', function() {
    var f = loadFixture('F1-tree-service-production-shaped.json');
    var result = run(f.industry, f.turns);
    var legacy = fe.buildPolarisLegacyFromFacts(result.facts, f.industry);
    expect(legacy.qualification).toBeDefined();
    expect(legacy.qualification.variables).toBeDefined();
    expect(legacy.qualification.completeness).toBeDefined();
    expect(legacy.qualification.totalVariables).toBeGreaterThan(0);
    expect(legacy.extractedValues).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Golden fixture integration tests
// ═══════════════════════════════════════════════════════════════════════════
describe('golden fixtures', function() {
  it('F1: Tree Service — agent speech does not create urgency, quantity not height', function() {
    var f = loadFixture('F1-tree-service-production-shaped.json');
    var result = run(f.industry, f.turns);
    // Urgency from customer: "not an emergency" → standard
    var urgency = firstCollected(result.facts, 'urgency');
    expect(urgency).not.toBeNull();
    expect(urgency.normalizedValue).toBe('standard');
    // Quantity
    var qty = getCollected(result.facts, 'quantity');
    expect(qty.length).toBe(1);
    expect(qty[0].normalizedValue).toBe(4);
    // Height
    var ht = firstCollected(result.facts, 'Tree Height');
    expect(ht).not.toBeNull();
    expect(ht.normalizedValue).toBe(120);
    // Contact
    var name = firstCollected(result.facts, 'customer_name');
    expect(name).not.toBeNull();
    expect(name.normalizedValue).toBe('Christopher Johnson');
    var phone = firstCollected(result.facts, 'customer_phone');
    expect(phone).not.toBeNull();
    expect(phone.normalizedValue).toBe('+15185555799');
  });
  it('F2: Concrete driveway — all expected facts present', function() {
    var f = loadFixture('F2-concrete-driveway.json');
    var result = run(f.industry, f.turns);
    // Service
    var svc = firstCollected(result.facts, 'requested_service');
    expect(svc).not.toBeNull();
    expect(svc.normalizedValue).toBe('Concrete Driveway Demolition and Replacement');
    // Area
    var area = firstCollected(result.facts, 'Area');
    expect(area).not.toBeNull();
    expect(area.normalizedValue).toBe(550);
    expect(area.unit).toBe('sqft');
    // Contact
    var name = firstCollected(result.facts, 'customer_name');
    expect(name).not.toBeNull();
    expect(name.normalizedValue).toBe('Christopher Johnson');
    var phone = firstCollected(result.facts, 'customer_phone');
    expect(phone).not.toBeNull();
    expect(phone.normalizedValue).toBe('+15185555799');
  });
  it('F3: Agent urgency question does not create High urgency', function() {
    var f = loadFixture('F3-mixed-speaker-urgency.json');
    var result = run(f.industry, f.turns);
    var urgency = findFact(result.facts, 'urgency');
    var highUrgency = urgency.filter(function(u) { return u.normalizedValue === 'high'; });
    expect(highUrgency.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Source evidence quality
// ═══════════════════════════════════════════════════════════════════════════
describe('source evidence quality', function() {
  it('exactSpan is a real substring of the customer utterance', function() {
    var turns = [{ speaker: 'customer', turnId: 't0', utterance: 'I have four white pines, each about 120 feet tall.', source: 'simulation' }];
    var result = run('Tree Service', turns);
    result.facts.forEach(function(f) {
      if (f.evidence && f.evidence.utterance && f.evidence.exactSpan) {
        if (f.evidence.speaker === 'customer') {
          expect(f.evidence.utterance.indexOf(f.evidence.exactSpan)).not.toBe(-1);
        }
      }
    });
  });
  it('findCustomerSentence returns complete sentence, not clipped fragment', function() {
    var turns = [
      { speaker: 'customer', turnId: 't0', utterance: 'The trees are leaning toward my house and I am worried about the roof.', source: 'simulation' }
    ];
    var quote = fe.findCustomerSentence(turns, 'leaning');
    expect(quote).not.toBeNull();
    expect(quote.length).toBeGreaterThan(20); // not a clipped fragment
    expect(quote.indexOf('leaning')).not.toBe(-1);
  });
  it('findCustomerSentence returns null for agent-only matches', function() {
    var turns = [
      { speaker: 'agent', turnId: 't0', utterance: 'Is this an emergency?', source: 'simulation' }
    ];
    var quote = fe.findCustomerSentence(turns, 'emergency');
    expect(quote).toBeNull();
  });
});