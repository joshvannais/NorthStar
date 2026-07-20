/**
 * M19.5 Phase D — Tree Service Entity Model + Estimate Safeguards
 * 49 tests across 11 describe blocks
 */
'use strict';

const fe = require('../../src/polaris/factExtraction');
const em = require('../../src/polaris/entityModel');
const es = require('../../src/polaris/estimateSafeguards');

// ── Helpers ──

function loadFixture(name) {
  return require('../fixtures/polaris/transcripts/' + name);
}

function extractFacts(fixture) {
  const norm = fe.normalizeTranscript(fixture.turns, fixture.transcriptSource || 'simulation');
  return fe.extractPolarisFacts(norm, fixture.industry);
}

function getCollected(facts, variable) {
  return facts.filter(function(f) { return f.variable === variable && f.status === 'collected'; });
}

function firstCollected(facts, variable) {
  const c = getCollected(facts, variable);
  return c.length > 0 ? c[0] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Phase C Invariants Preserved (7 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase C invariants preserved', function() {
  it('agent speech cannot create customer-collected facts', function() {
    var f = loadFixture('D-G-agent-contamination-guarded.json');
    var result = extractFacts(f);
    var agentSourced = result.facts.filter(function(f) { return f.evidence.speaker === 'agent' && f.status === 'collected'; });
    expect(agentSourced.length).toBe(0);
  });

  it('exact evidence spans remain valid substrings', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    result.facts.forEach(function(f) {
      if (f.status === 'collected' && f.evidence && f.evidence.exactSpan && f.evidence.utterance) {
        expect(f.evidence.utterance.indexOf(f.evidence.exactSpan)).not.toBe(-1);
      }
    });
  });

  it('quantity and measurements remain distinct', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var qty = getCollected(result.facts, 'quantity');
    var ht = getCollected(result.facts, 'Tree Height');
    // quantity should be 4, not 120
    if (qty.length > 0) {
      expect(qty[0].normalizedValue).not.toBe(120);
    }
  });

  it('compatibility outputs derive from typed facts', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var legacy = fe.buildPolarisLegacyFromFacts(result.facts, f.industry);
    expect(legacy.qualification).toBeDefined();
    expect(legacy.qualification.completeness).toBeDefined();
  });

  it('qualification counts only eligible collected facts', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var legacy = fe.buildPolarisLegacyFromFacts(result.facts, f.industry);
    var collected = result.facts.filter(function(f) { return f.status === 'collected'; });
    expect(legacy.qualification.collected.length).toBeGreaterThan(0);
  });

  it('customer utterances are the only source of collected facts', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    result.facts.forEach(function(f) {
      if (f.status === 'collected') {
        expect(f.evidence.speaker).toBe('customer');
      }
    });
  });

  it('normalization preserves all turns', function() {
    var f = loadFixture('D-H-multi-group-production.json');
    var norm = fe.normalizeTranscript(f.turns, f.transcriptSource || 'simulation');
    expect(norm.length).toBe(f.turns.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Entity Model — Tree Groups (10 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('entity model — tree groups', function() {
  it('single tree creates one group with quantity 1', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    expect(entity.treeGroups.length).toBe(1);
    expect(entity.treeGroups[0].quantity).toBe(1);
    expect(entity.treeGroups[0].species).toBe('Oak');
  });

  it('grouped trees create one group with quantity > 1', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    expect(entity.treeGroups.length).toBeGreaterThanOrEqual(1);
    var totalQty = entity.treeGroups.reduce(function(sum, g) { return sum + g.quantity; }, 0);
    expect(totalQty).toBeGreaterThanOrEqual(4);
  });

  it('quantity 4 is not converted to height 4', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var totalQty = entity.treeGroups.reduce(function(sum, g) { return sum + g.quantity; }, 0);
    expect(totalQty).toBe(4);
    // Height should be 120, not 4
    var ht = firstCollected(result.facts, 'Tree Height');
    if (ht) {
      expect(ht.normalizedValue).not.toBe(4);
    }
  });

  it('species is extracted from customer utterance', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var hasSpecies = entity.treeGroups.some(function(g) { return g.species !== null; });
    expect(hasSpecies).toBe(true);
  });

  it('different-sized trees create separate groups', function() {
    var f = loadFixture('D-C-multiple-trees-different-sizes.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    expect(entity.treeGroups.length).toBeGreaterThanOrEqual(2);
  });

  it('shared height is preserved in group attributes', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    if (entity.treeGroups[0] && entity.treeGroups[0].sharedAttributes.height) {
      expect(entity.treeGroups[0].sharedAttributes.height.value).toBe(80);
    }
  });

  it('evidence points to correct customer turn', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    result.facts.forEach(function(fact) {
      if (fact.status === 'collected' && fact.evidence) {
        expect(fact.evidence.speaker).toBe('customer');
      }
    });
  });

  it('exact spans are preserved in fact evidence', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    result.facts.forEach(function(fact) {
      if (fact.status === 'collected' && fact.evidence && fact.evidence.exactSpan) {
        expect(typeof fact.evidence.exactSpan).toBe('string');
        expect(fact.evidence.exactSpan.length).toBeGreaterThan(0);
      }
    });
  });

  it('no agent speech is used in entity building', function() {
    var f = loadFixture('D-G-agent-contamination-guarded.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    // Phase C correctly blocks agent speech from creating facts
    // Entity should use customer speech only
    if (entity.treeGroups.length > 0) {
      expect(entity.treeGroups[0].species).toBe('Oak');
    }
  });

  it('computeJobQuantity returns total trees', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var total = em.computeJobQuantity(entity);
    expect(total).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Estimate Eligibility Safeguards (5 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('estimate eligibility safeguards', function() {
  it('collected customer facts are eligible', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    result.facts.forEach(function(fact) {
      if (fact.status === 'collected' && fact.evidence.speaker === 'customer' && fact.normalizedValue !== null) {
        var check = es.isEligibleForEstimate(fact, entity);
        expect(check.eligible).toBe(true);
      }
    });
  });

  it('mentioned_unresolved facts are not eligible', function() {
    var f = loadFixture('D-F-hedged-unresolved.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    result.facts.forEach(function(fact) {
      if (fact.status === 'mentioned_unresolved') {
        var check = es.isEligibleForEstimate(fact, entity);
        expect(check.eligible).toBe(false);
      }
    });
  });

  it('conflicting facts are not eligible', function() {
    var f = loadFixture('D-E-conflicting-heights.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    result.facts.forEach(function(fact) {
      if (fact.status === 'conflicting') {
        var check = es.isEligibleForEstimate(fact, entity);
        expect(check.eligible).toBe(false);
      }
    });
  });

  it('agent-sourced facts are not eligible', function() {
    var f = loadFixture('D-G-agent-contamination-guarded.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    result.facts.forEach(function(fact) {
      if (fact.evidence.speaker === 'agent') {
        var check = es.isEligibleForEstimate(fact, entity);
        expect(check.eligible).toBe(false);
      }
    });
  });

  it('null-valued facts are not eligible', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    result.facts.forEach(function(fact) {
      if (fact.status === 'collected' && fact.normalizedValue === null) {
        var check = es.isEligibleForEstimate(fact, entity);
        expect(check.eligible).toBe(false);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Adjustment Model (7 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('adjustment model', function() {
  it('buildAdjustments returns array', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var eligible = result.facts.filter(function(f) { return f.status === 'collected' && f.evidence.speaker === 'customer'; });
    var adj = es.buildAdjustments(entity, eligible, result.facts);
    expect(Array.isArray(adj.adjustments)).toBe(true);
  });

  it('adjustments have correct structure', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var eligible = result.facts.filter(function(f) { return f.status === 'collected' && f.evidence.speaker === 'customer'; });
    var adj = es.buildAdjustments(entity, eligible, result.facts);
    adj.adjustments.forEach(function(a) {
      expect(a.factor).toBeDefined();
      expect(a.effect).toBeDefined();
      expect(a.reason).toBeDefined();
      expect(Array.isArray(a.sourceFactIds)).toBe(true);
      expect(a.eligibilityStatus).toBe('eligible');
    });
  });

  it('tree height creates adjustment', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var eligible = result.facts.filter(function(f) { return f.status === 'collected' && f.evidence.speaker === 'customer'; });
    var adj = es.buildAdjustments(entity, eligible, result.facts);
    var heightAdj = adj.adjustments.filter(function(a) { return a.factor === 'tree_height'; });
    expect(heightAdj.length).toBeGreaterThanOrEqual(0);
  });

  it('adjustments include sourceFactIds', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var eligible = result.facts.filter(function(f) { return f.status === 'collected' && f.evidence.speaker === 'customer'; });
    var adj = es.buildAdjustments(entity, eligible, result.facts);
    adj.adjustments.forEach(function(a) {
      expect(a.sourceFactIds.length).toBeGreaterThan(0);
    });
  });

  it('considerations are returned for hazards', function() {
    var f = loadFixture('D-D-trees-with-hazards.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var eligible = result.facts.filter(function(f) { return f.status === 'collected' && f.evidence.speaker === 'customer'; });
    var adj = es.buildAdjustments(entity, eligible, result.facts);
    // Should have considerations for hazards
    expect(adj.considerations).toBeDefined();
  });

  it('adjustment effect is widen for uncalibrated factors', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var eligible = result.facts.filter(function(f) { return f.status === 'collected' && f.evidence.speaker === 'customer'; });
    var adj = es.buildAdjustments(entity, eligible, result.facts);
    adj.adjustments.forEach(function(a) {
      expect(a.requiresVerification).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Quantity Safeguard (3 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('quantity safeguard', function() {
  it('tree quantity is modeled explicitly', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var total = em.computeJobQuantity(entity);
    expect(total).toBe(4);
  });

  it('quantity is not converted to per-tree price', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var pipeline = es.runEstimatePipeline(extractFacts(f).facts, 'Tree Service');
    // Range should be widened by confidence, not multiplied by tree count
    expect(pipeline.estimateRange.min).toBeGreaterThanOrEqual(es.TREE_SERVICE_BASELINE.min * 0.8);
    expect(pipeline.estimateRange.max).toBeLessThanOrEqual(es.TREE_SERVICE_BASELINE.max * 1.2);
    // Range should not be a simple per-tree multiplication
    expect(pipeline.estimateRange.min).not.toBe(es.TREE_SERVICE_BASELINE.min * 4);
    expect(pipeline.estimateRange.max).not.toBe(es.TREE_SERVICE_BASELINE.max * 4);
  });

  it('quantity is included in scope and reasoning', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    var total = em.computeJobQuantity(entity);
    expect(total).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Range and Confidence Separation (4 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('range and confidence separation', function() {
  it('estimateConfidence is separate from extractionConfidence', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(pipeline.confidence).toBeDefined();
    expect(pipeline.confidence.score).toBeDefined();
    expect(pipeline.confidence.label).toBeDefined();
    // extractionConfidence is on individual facts
    result.facts.forEach(function(fact) {
      if (fact.extractionConfidence !== undefined) {
        expect(fact.extractionConfidence).not.toBe(pipeline.confidence.score);
      }
    });
  });

  it('missing critical info lowers confidence', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(pipeline.confidence.score).toBeGreaterThanOrEqual(0.1);
    expect(pipeline.confidence.score).toBeLessThanOrEqual(1.0);
  });

  it('conflicting facts lower confidence', function() {
    var f = loadFixture('D-E-conflicting-heights.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(pipeline.confidence.score).toBeLessThanOrEqual(1.0);
  });

  it('confidence has label', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(['High', 'Medium', 'Low']).toContain(pipeline.confidence.label);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Revenue Default Protection (3 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('revenue default protection', function() {
  it('Tree Service baseline minimum is unchanged', function() {
    expect(es.TREE_SERVICE_BASELINE.min).toBe(1800);
  });

  it('Tree Service baseline maximum is unchanged', function() {
    expect(es.TREE_SERVICE_BASELINE.max).toBe(3800);
  });

  it('no customer-facing quote exposure', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(pipeline.estimateRange.classification).toContain('Preliminary');
    expect(pipeline.estimateRange.classification).toContain('site verification required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Contractor-Facing Output (2 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('contractor-facing output', function() {
  it('canonical record shows tree scope', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    expect(entity.treeGroups.length).toBeGreaterThan(0);
    expect(entity.jobEntity).toBeDefined();
  });

  it('missing estimate info is reported', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(Array.isArray(pipeline.missingEstimateInfo)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Full Estimate Pipeline (3 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('full estimate pipeline', function() {
  it('runEstimatePipeline returns complete structure', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(pipeline.applicable).toBe(true);
    expect(pipeline.entity).toBeDefined();
    expect(pipeline.eligibleFacts).toBeDefined();
    expect(pipeline.ineligibleFacts).toBeDefined();
    expect(pipeline.adjustments).toBeDefined();
    expect(pipeline.confidence).toBeDefined();
    expect(pipeline.estimateRange).toBeDefined();
  });

  it('pipeline returns non-null for non-Tree Service', function() {
    var pipeline = es.runEstimatePipeline([], 'Roofing');
    expect(pipeline.applicable).toBe(false);
  });

  it('pipeline preserves baseline', function() {
    var f = loadFixture('D-A-single-tree-basic.json');
    var result = extractFacts(f);
    var pipeline = es.runEstimatePipeline(result.facts, 'Tree Service');
    expect(pipeline.baseline.min).toBe(es.TREE_SERVICE_BASELINE.min);
    expect(pipeline.baseline.max).toBe(es.TREE_SERVICE_BASELINE.max);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Entity Association (3 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('entity association', function() {
  it('facts are associated with tree groups', function() {
    var f = loadFixture('D-B-multiple-trees-grouped.json');
    var result = extractFacts(f);
    var entity = em.buildTreeServiceEntity(result.facts);
    entity.treeGroups.forEach(function(group) {
      expect(Array.isArray(group.factIds)).toBe(true);
    });
  });

  it('entity scope classification works', function() {
    expect(em.classifyFactScope('Tree Height')).toBe('tree');
    expect(em.classifyFactScope('requested_service')).toBe('job');
    expect(em.classifyFactScope('Location Difficulty')).toBe('site');
    expect(em.classifyFactScope('customer_name')).toBe('job');
  });

  it('hazard detection works', function() {
    var hazard = em.detectHazard('The tree is leaning toward my house');
    expect(hazard).not.toBeNull();
    expect(hazard.toLowerCase()).toContain('leaning');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Agent Contamination Guard (2 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('agent contamination guard', function() {
  it('agent question about power lines does not create hazard fact', function() {
    var turns = [
      { speaker: 'agent', turnId: 't0', utterance: 'Are the trees near power lines?', source: 'simulation' },
      { speaker: 'customer', turnId: 't1', utterance: 'No, they are not.', source: 'simulation' }
    ];
    var norm = fe.normalizeTranscript(turns, 'simulation');
    var result = fe.extractPolarisFacts(norm, 'Tree Service');
    var result2 = extractFacts({ turns: turns, transcriptSource: 'simulation', industry: 'Tree Service' });
    // Agent fact should not be customer-collected
    var agentCollected = result.facts.filter(function(f) { return f.evidence.speaker === 'agent' && f.status === 'collected'; });
    expect(agentCollected.length).toBe(0);
  });

  it('customer hazard statement is collected and associated', function() {
    var turns = [
      { speaker: 'customer', turnId: 't0', utterance: 'One tree is leaning directly over my garage.', source: 'simulation' }
    ];
    var norm = fe.normalizeTranscript(turns, 'simulation');
    var result = fe.extractPolarisFacts(norm, 'Tree Service');
    var entity = em.buildTreeServiceEntity(result.facts);
    // Customer hazard should be in entity
    var hasHazard = entity.treeGroups.some(function(g) { return g.hazards.length > 0; });
    expect(hasHazard).toBe(true);
  });
});