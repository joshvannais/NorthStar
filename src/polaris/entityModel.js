/**
 * entityModel.js — M19.5 Phase D: Tree Service Entity Model
 *
 * Builds tree-group and entity structure from Phase C typed PolarisFact[].
 * All inputs must come from Phase C factExtraction. No parallel parser.
 */
'use strict';

// ── Entity Types ──

/**
 * @typedef {Object} TreeEntity
 * @property {string} entityId - Unique entity identifier
 * @property {string} scope - "job" | "site" | "treeGroup" | "tree"
 * @property {Object} attributes - Entity-specific attributes
 * @property {string[]} factIds - References to PolarisFact IDs
 * @property {Object} [evidence] - Evidence summary
 */

/**
 * @typedef {Object} TreeGroup
 * @property {string} groupId
 * @property {number} quantity - Number of trees in this group
 * @property {string} [species]
 * @property {Object} sharedAttributes - Shared height, trunk, condition, etc.
 * @property {Object[]} hazards - Hazards associated with the group
 * @property {string[]} factIds - Referenced fact IDs
 * @property {Object} evidence
 */

/**
 * @typedef {Object} EstimateAdjustment
 * @property {string} factor - Adjustment factor name
 * @property {string} effect - Direction of effect: "increase" | "decrease" | "widen" | "unresolved"
 * @property {string} reason - Human-readable explanation
 * @property {string[]} sourceFactIds - Which facts triggered this
 * @property {string} eligibilityStatus - "eligible" | "ineligible"
 * @property {string} [exclusionReason] - Why excluded if ineligible
 */

// ── Entity Scope Classification ──

const SITE_LEVEL_VARIABLES = new Set([
  'Location Difficulty', 'Access Restrictions', 'Equipment Access',
  'Stump Removal', 'Stump Grinding', 'Debris Removal', 'Cleanup',
  'Front Yard', 'Backyard', 'Gate Width', 'Slope', 'Crane Access',
  'Bucket Truck Access', 'Rigging Complexity', 'Debris Removal Preference',
  'Wood Removal Preference'
]);

const JOB_LEVEL_VARIABLES = new Set([
  'requested_service', 'requested_service_secondary', 'urgency',
  'customer_name', 'customer_phone', 'service_address', 'existing_slab',
  'Existing Slab Removal'
]);

const TREE_VARIABLES = new Set([
  'Tree Height', 'Tree Quantity', 'quantity', 'Trunk Size', 'Condition',
  'Dead', 'Dying', 'Lean Direction', 'Broken Limbs', 'Storm Damage',
  'Species'
]);

const HAZARD_KEYWORDS = [
  'near house', 'leaning toward', 'near power lines', 'near driveway',
  'near road', 'over structures', 'immediate failure', 'near neighbor',
  'over garage', 'over roof', 'near building', 'hazard', 'dangerous',
  'risk', 'threatening', 'about to fall', 'cracked', 'split'
];

// ── Entity Builder ──

/**
 * Classify a fact's scope based on its variable name.
 */
function classifyFactScope(variable) {
  if (JOB_LEVEL_VARIABLES.has(variable)) return 'job';
  if (SITE_LEVEL_VARIABLES.has(variable)) return 'site';
  if (TREE_VARIABLES.has(variable)) return 'tree';
  return 'customer';
}

/**
 * Detect if a customer utterance contains hazard language.
 * Returns the hazard description or null.
 */
function detectHazard(utterance) {
  if (!utterance) return null;
  const lower = utterance.toLowerCase();
  for (const keyword of HAZARD_KEYWORDS) {
    if (lower.includes(keyword)) {
      // Find the sentence containing the keyword
      const sentences = lower.split(/[.!?]+/);
      for (const sentence of sentences) {
        if (sentence.includes(keyword)) {
          return sentence.trim();
        }
      }
      return keyword;
    }
  }
  return null;
}

/**
 * Extract species name from a customer utterance.
 */
function extractSpecies(utterance) {
  if (!utterance) return null;
  const lower = utterance.toLowerCase();
  const species = ['pine', 'oak', 'maple', 'cedar', 'spruce', 'fir', 'birch',
    'walnut', 'cherry', 'apple', 'pear', 'dogwood', 'magnolia', 'palm',
    'cypress', 'hemlock', 'redwood', 'sequoia', 'aspen', 'poplar',
    'cottonwood', 'willow', 'elm', 'beech', 'hickory', 'pecan', 'mesquite',
    'acacia', 'eucalyptus', 'sycamore', 'ash', 'linden', 'locust',
    'basswood', 'catalpa', 'tulip', 'gum', 'sweetgum', 'blackwood',
    'ironbark', 'jarrah', 'karri', 'bloodwood', 'rosewood', 'teak'];
  for (const s of species) {
    if (lower.includes(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return null;
}

/**
 * Build tree groups from a set of typed PolarisFacts.
 * Returns { treeGroups: TreeGroup[], siteFacts: Object[], jobEntity: Object }
 */
function buildTreeServiceEntity(facts) {
  const treeGroups = [];
  const siteFacts = [];
  let jobEntity = { requestedService: null, urgency: null };

  // Separate facts by scope
  const treeFacts = [];
  const customerTurns = [];

  for (const fact of facts) {
    const scope = classifyFactScope(fact.variable);
    if (scope === 'job') {
      if (fact.variable === 'requested_service' && fact.status === 'collected') {
        jobEntity.requestedService = fact.normalizedValue;
      }
      if (fact.variable === 'urgency' && fact.status === 'collected') {
        jobEntity.urgency = fact.normalizedValue;
      }
    } else if (scope === 'site') {
      if (fact.status === 'collected') {
        siteFacts.push({
          variable: fact.variable,
          value: fact.normalizedValue,
          status: fact.status,
          evidence: fact.evidence,
          factId: fact.factId || (fact.variable + '_' + fact.evidence.turnId)
        });
      }
    } else if (scope === 'tree') {
      treeFacts.push(fact);
    }
    // Collect customer utterances for hazard detection
    if (fact.evidence && fact.evidence.speaker === 'customer' && fact.evidence.utterance) {
      customerTurns.push({
        turnId: fact.evidence.turnId,
        utterance: fact.evidence.utterance
      });
    }
  }

  // Build tree groups from treeFacts
  // Strategy: group by turn proximity and species references
  const turnsWithTreeFacts = new Map();

  for (const fact of treeFacts) {
    const turnId = fact.evidence.turnId;
    if (!turnId) continue;
    if (!turnsWithTreeFacts.has(turnId)) {
      turnsWithTreeFacts.set(turnId, {
        turnId: turnId,
        utterance: fact.evidence.utterance,
        facts: []
      });
    }
    turnsWithTreeFacts.get(turnId).facts.push(fact);
  }

  // Process each turn into tree groups
  for (const [turnId, turnData] of turnsWithTreeFacts) {
    const utterance = turnData.utterance || '';
    const lower = utterance.toLowerCase();

    // Extract quantity from turn facts or utterance
    let quantity = null;
    let species = extractSpecies(utterance);
    let heights = [];
    let trunkSizes = [];
    let hazards = [];

    // Detect hazards from utterance
    const hazardText = detectHazard(utterance);
    if (hazardText) {
      hazards.push({ description: hazardText, source: 'customer', turnId: turnId });
    }

    for (const fact of turnData.facts) {
      if (fact.status !== 'collected' && fact.status !== 'mentioned_unresolved') continue;

      if (fact.variable === 'quantity' && fact.status === 'collected') {
        quantity = fact.normalizedValue;
      }
      if (fact.variable === 'Tree Height' && fact.status === 'collected') {
        heights.push({ value: fact.normalizedValue, unit: fact.unit || 'ft' });
      }
      if (fact.variable === 'Trunk Size' && fact.status === 'collected') {
        trunkSizes.push({ value: fact.normalizedValue, unit: fact.unit || 'in' });
      }
    }

    // Check for explicit quantity words in utterance (allow adjectives between number and noun)
    if (quantity === null) {
      const qtyMatch = lower.match(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:\w+\s+){0,2}(?:trees?|pines?|oaks?|maples?|elms?)\b/);
      if (qtyMatch) {
        const wordMap = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
        quantity = wordMap[qtyMatch[1]];
      }
    }

    // Detect "near X" and "leaning" patterns
    const nearMatch = lower.match(/\bnear\s+(?:the\s+)?([a-z\s]+?)(?:\s+and\s+|\.|$)/i);
    const leanMatch = lower.match(/\bleaning\s+(?:toward|towards|over|into)\s+(?:the\s+)?([a-z\s]+?)(?:\s+and\s+|\.|$)/i);
    // Also detect compound hazards: "leaning directly over", "leaning toward"
    const leanOverMatch = lower.match(/\bleaning\s+(?:directly\s+)?(?:toward|towards|over|into)\s+(?:the\s+)?([a-z\s]+?)(?:\s+and\s+|\.\s*|$)/i);
    if (leanOverMatch) {
      const desc = 'Leaning over ' + leanOverMatch[1].trim();
      // Check if already added
      if (!hazards.some(function(h) { return h.description === desc; })) {
        hazards.push({ description: desc, source: 'customer', turnId: turnId });
      }
    }
    if (leanMatch) {
      hazards.push({
        description: 'Leaning toward ' + leanMatch[1].trim(),
        source: 'customer',
        turnId: turnId
      });
    }

    // Create group
    const group = {
      groupId: 'group-' + turnId,
      quantity: quantity || 1,
      species: species || null,
      sharedAttributes: {},
      hazards: hazards,
      factIds: turnData.facts.map(function(f) { return f.factId || (f.variable + '_' + turnId); }),
      evidence: {
        turnId: turnId,
        utterance: utterance,
        facts: turnData.facts.map(function(f) { return { variable: f.variable, value: f.normalizedValue, status: f.status }; })
      }
    };

    if (heights.length > 0) {
      group.sharedAttributes.height = heights[0];
    }
    if (trunkSizes.length > 0) {
      group.sharedAttributes.trunkSize = trunkSizes[0];
    }

    treeGroups.push(group);
  }

  // Post-process: split groups by species when a single turn contains multiple species
  // (handles "two 80-foot pines and one 110-foot oak" in the same utterance)
  const splitGroups = [];
  for (const group of treeGroups) {
    const utterance = (group.evidence && group.evidence.utterance || '').toLowerCase();
    const species = ['pine', 'oak', 'maple', 'cedar', 'spruce', 'fir', 'elm', 'birch', 'walnut', 'cherry', 'palm', 'cypress', 'willow', 'beech', 'hickory', 'ash', 'poplar', 'magnolia', 'dogwood'];
    const foundSpecies = [];
    for (const s of species) {
      const re = new RegExp('\\b' + s + '\\w*\\b', 'i');
      if (re.test(utterance)) {
        foundSpecies.push(s.charAt(0).toUpperCase() + s.slice(1));
      }
    }

    // If multiple species found in same turn, split into separate groups
    if (foundSpecies.length > 1) {
      for (const sp of foundSpecies) {
        const splitGroup = JSON.parse(JSON.stringify(group));
        splitGroup.groupId = group.groupId + '-' + sp.toLowerCase();
        splitGroup.species = sp;
        // Estimate per-species quantity from utterance
        const spLower = sp.toLowerCase();
        const qtyRe = new RegExp('\\b(two|three|four|five|six|seven|eight|nine|ten)\\s+(?:\\w+\\s+){0,2}' + spLower + '\\w*\\b', 'i');
        const qtyMatch = utterance.match(qtyRe);
        if (qtyMatch) {
          const wordMap = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
          splitGroup.quantity = wordMap[qtyMatch[1]] || 1;
        }
        // Extract per-species height
        const htRe = new RegExp('(\\d+)[\\s-]*(?:foot|ft)\\s+(?:\\w+\\s+){0,2}' + spLower + '\\w*', 'i');
        const htMatch = utterance.match(htRe);
        if (htMatch) {
          splitGroup.sharedAttributes.height = { value: parseInt(htMatch[1], 10), unit: 'ft' };
        }
        splitGroups.push(splitGroup);
      }
    } else {
      splitGroups.push(group);
    }
  }

  // Merge groups that are from the same turn and have the same species
  // (handles case where multiple facts from same turn create separate groups)
  const mergedGroups = [];
  const seen = new Set();

  for (let i = 0; i < splitGroups.length; i++) {
    if (seen.has(i)) continue;
    const base = splitGroups[i];
    const merged = {
      groupId: base.groupId,
      quantity: base.quantity,
      species: base.species,
      sharedAttributes: Object.assign({}, base.sharedAttributes),
      hazards: base.hazards.slice(),
      factIds: base.factIds.slice(),
      evidence: Object.assign({}, base.evidence)
    };

    for (let j = i + 1; j < treeGroups.length; j++) {
      const other = treeGroups[j];
      // Merge if same turn or same species
      if (base.evidence.turnId === other.evidence.turnId || (base.species && base.species === other.species)) {
        merged.quantity = Math.max(merged.quantity, other.quantity);
        if (other.species && !merged.species) merged.species = other.species;
        if (other.sharedAttributes.height && !merged.sharedAttributes.height) {
          merged.sharedAttributes.height = other.sharedAttributes.height;
        }
        if (other.sharedAttributes.trunkSize && !merged.sharedAttributes.trunkSize) {
          merged.sharedAttributes.trunkSize = other.sharedAttributes.trunkSize;
        }
        merged.hazards = merged.hazards.concat(other.hazards);
        merged.factIds = merged.factIds.concat(other.factIds);
        seen.add(j);
      }
    }
    mergedGroups.push(merged);
  }

  // If no tree groups were created but there are customer facts, create a default group
  if (mergedGroups.length === 0 && treeFacts.length > 0) {
    mergedGroups.push({
      groupId: 'group-default',
      quantity: 1,
      species: null,
      sharedAttributes: {},
      hazards: [],
      factIds: treeFacts.map(function(f) { return f.factId || (f.variable + '_default'); }),
      evidence: { turnId: null, utterance: null, facts: [] }
    });
  }

  return {
    treeGroups: mergedGroups,
    siteFacts: siteFacts,
    jobEntity: jobEntity,
    customerTurns: customerTurns
  };
}

/**
 * Compute total job quantity from tree groups.
 */
function computeJobQuantity(entity) {
  let total = 0;
  for (const group of entity.treeGroups) {
    total += (group.quantity || 1);
  }
  return total;
}

module.exports = {
  buildTreeServiceEntity,
  computeJobQuantity,
  classifyFactScope,
  detectHazard,
  extractSpecies,
  SITE_LEVEL_VARIABLES,
  JOB_LEVEL_VARIABLES,
  TREE_VARIABLES,
  HAZARD_KEYWORDS
};