/**
 * M19.5 Phase C — Evidence-Safe Extraction
 *
 * Implements the owner-ratified v1.0 Polaris Fact Model
 * (docs/architecture/M19.5_PHASE_B_FACT_MODEL_SPEC.md).
 *
 * Responsibilities:
 *   1. Transcript normalization — one internal TranscriptTurn representation
 *      shared by Retell transcripts, simulation transcripts, stored session
 *      transcripts, and permanent regression fixtures.
 *   2. Strict speaker isolation — direct customer facts may ONLY originate
 *      from customer turns. Agent speech never produces customer evidence.
 *   3. Typed PolarisFact production — every fact carries a typed normalized
 *      value, status, extraction confidence, and turn-bounded evidence.
 *   4. Fact status invariants — only validated, customer-sourced `collected`
 *      facts count toward qualification or influence estimates.
 *   5. Legacy compatibility — buildPolarisLegacyFromFacts() derives the
 *      existing estimatingVariables / missingInformation / completeness
 *      fields FROM the typed facts (no parallel legacy pipeline).
 *
 * Explicitly out of scope (Phases D–F): entity model (TreeGroup/Tree),
 * contact/actionability architecture, next-steps generator, pricing changes.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════════════════════════════
// Industry qualification profiles (data-driven framework — moved unchanged
// from src/routes/demo.js; 'Concrete' added for the golden fixture coverage)
// ═══════════════════════════════════════════════════════════════════════════
const QUALIFICATION_PROFILES = {
  'Roofing': [
    { name: 'Damage Type',         keywords: ['storm damage', 'leak', 'missing shingle', 'hail', 'wind damage', 'hole', 'sagging'], unit: null },
    { name: 'Roof Area',           keywords: ['square foot', 'sq ft', 'sqft', 'roof size', 'how many square', 'section', 'slope'], unit: 'sq ft' },
    { name: 'Roof Age',            keywords: ['year old', 'years old', 'old roof', 'age', 'how old', 'original roof'], unit: 'years' },
    { name: 'Damage Extent',       keywords: ['shingle', 'gutter', 'flashing', 'valley', 'vent', 'skylight', 'chimney'], unit: null },
  ],
  'HVAC': [
    { name: 'Home Square Footage', keywords: ['square foot', 'sq ft', 'sqft', 'home size', 'house size', 'square footage'], unit: 'sq ft' },
    { name: 'System Age',          keywords: ['year old', 'years old', 'old unit', 'age', 'how old', 'installed'], unit: 'years' },
    { name: 'Service Type',        keywords: ['repair', 'replace', 'fix', 'new unit', 'new system', 'install', 'maintenance', 'tune-up'], unit: null },
    { name: 'Current Symptoms',    keywords: ['not working', 'broken', 'noise', 'leaking', 'not cooling', 'not heating', 'strange sound', 'warm air', 'no air'], unit: null },
    { name: 'Unit Information',    keywords: ['central air', 'window unit', 'heat pump', 'furnace', 'model', 'brand', 'ton', 'seer', 'serial'], unit: null },
  ],
  'Plumbing': [
    { name: 'Issue Type',          keywords: ['burst', 'leak', 'clog', 'dripping', 'running', 'broken pipe', 'water pressure', 'backup'], unit: null },
    { name: 'Location',            keywords: ['kitchen', 'bathroom', 'basement', 'outside', 'sink', 'toilet', 'shower', 'water heater', 'main line'], unit: null },
    { name: 'Urgency Indicator',   keywords: ['emergency', 'urgent', 'flooding', 'water damage', 'immediate', 'pouring'], unit: null },
    { name: 'Fixture Age',         keywords: ['year old', 'years old', 'old', 'original', 'age'], unit: 'years' },
  ],
  'Electrical': [
    { name: 'Issue Type',          keywords: ['outage', 'spark', 'flicker', 'breaker', 'outlet', 'switch', 'wiring', 'trip', 'power loss'], unit: null },
    { name: 'Location',            keywords: ['kitchen', 'bathroom', 'basement', 'outside', 'garage', 'room', 'circuit'], unit: null },
    { name: 'Property Age',        keywords: ['year old', 'years old', 'old house', 'age', 'how old', 'original wiring'], unit: 'years' },
    { name: 'Scope',               keywords: ['rewire', 'install', 'upgrade', 'panel', 'new', 'addition', 'remodel'], unit: null },
  ],
  'Painting': [
    { name: 'Area Type',           keywords: ['interior', 'exterior', 'inside', 'outside', 'room', 'wall', 'ceiling', 'trim', 'cabinet'], unit: null },
    { name: 'Square Footage',      keywords: ['square foot', 'sq ft', 'sqft', 'room size', 'house size', 'how big'], unit: 'sq ft' },
    { name: 'Room Count',          keywords: ['room', 'bedroom', 'floor', 'story', 'level'], unit: 'rooms' },
    { name: 'Prep Work Required',  keywords: ['patch', 'repair', 'spackle', 'sanding', 'priming', 'texture', 'wallpaper', 'lead paint'], unit: null },
  ],
  'Tree Service': [
    { name: 'Tree Height',         keywords: ['foot', 'feet', 'ft', 'tall', 'height', 'high', 'story'], unit: 'ft' },
    { name: 'Trunk Size',          keywords: ['diameter', 'inch', 'thick', 'trunk', 'width'], unit: 'inches' },
    { name: 'Location Difficulty', keywords: ['near', 'near house', 'close to', 'power line', 'fence', 'building', 'structure', 'garage', 'over', 'leaning'], unit: null },
    { name: 'Stump Removal',       keywords: ['stump', 'stump grind', 'stump removal', 'take the stump', 'remove stump'], unit: null },
  ],
  'Window Tinting': [
    { name: 'Window Count',        keywords: ['window', 'door', 'panel', 'how many'], unit: 'windows' },
    { name: 'Glass Type',          keywords: ['residential', 'commercial', 'auto', 'home', 'office', 'car', 'truck'], unit: null },
    { name: 'Tint Preference',     keywords: ['dark', 'light', 'shade', 'uv', 'privacy', 'heat', 'reflect', 'film', 'ceramic'], unit: null },
  ],
  // Added in Phase C for the concrete-driveway golden fixture (M19.5)
  'Concrete': [
    { name: 'Project Type',           keywords: ['driveway', 'patio', 'sidewalk', 'walkway', 'slab', 'foundation', 'steps'], unit: null },
    { name: 'Area',                   keywords: ['square foot', 'square feet', 'sq ft', 'sqft', 'how big', 'size'], unit: 'sq ft' },
    { name: 'Existing Slab Removal',  keywords: ['demolition', 'demolish', 'tear out', 'tear-out', 'rip out', 'break up', 'existing slab', 'remove the old', 'old concrete'], unit: null },
    { name: 'Reinforcement',          keywords: ['rebar', 'wire mesh', 'reinforcement', 'reinforced', 'fiber mesh'], unit: null },
    { name: 'Finish Type',            keywords: ['stamped', 'decorative', 'broom finish', 'exposed aggregate', 'smooth finish', 'colored', 'stained'], unit: null },
  ],
};

// ── Service detection keywords (moved unchanged from demo.js; Concrete added) ──
const SERVICE_KEYWORDS = {
  'Tree Service': [
    { service: 'Tree Removal',           keywords: ['remov', 'take down', 'cut down', 'fell', 'stump'] },
    { service: 'Tree Trimming',          keywords: ['trim', 'prune', 'cut back', 'thin', 'shape'] },
    { service: 'Emergency Tree Service', keywords: ['emergency', 'storm damage', 'fallen', 'hazard', 'dangerous'] },
    { service: 'Stump Grinding',         keywords: ['stump grind', 'stump removal', 'grind'] },
  ],
  'HVAC': [
    { service: 'HVAC Repair',            keywords: ['repair', 'fix', 'not working', 'broken', 'issue', 'problem'] },
    { service: 'HVAC Replacement',       keywords: ['replace', 'new unit', 'new system', 'upgrade', 'install'] },
    { service: 'HVAC Maintenance',       keywords: ['maintenance', 'tune-up', 'tune up', 'check-up', 'inspection', 'service'] },
  ],
  'Plumbing': [
    { service: 'Emergency Plumbing',     keywords: ['emergency', 'burst', 'flood', 'urgent', 'pouring'] },
    { service: 'Plumbing Repair',        keywords: ['repair', 'fix', 'leak', 'drip', 'clog', 'broken'] },
    { service: 'Plumbing Installation',  keywords: ['install', 'new', 'replace', 'upgrade'] },
  ],
  'Roofing': [
    { service: 'Roof Repair',            keywords: ['repair', 'fix', 'patch', 'leak'] },
    { service: 'Roof Replacement',       keywords: ['replace', 'new roof', 're-roof', 'tear off'] },
    { service: 'Emergency Roofing',      keywords: ['emergency', 'storm', 'leak', 'urgent'] },
  ],
  'Painting': [
    { service: 'Interior Painting',      keywords: ['interior', 'inside', 'room', 'wall', 'ceiling'] },
    { service: 'Exterior Painting',      keywords: ['exterior', 'outside', 'siding', 'trim'] },
  ],
  'Concrete': [
    { service: 'Concrete Driveway Demolition and Replacement', keywords: ['demolition', 'demolish', 'tear out', 'tear-out', 'rip out'] },
    { service: 'Concrete Driveway Replacement',                keywords: ['new driveway', 'replace my driveway', 'redo the driveway', 'driveway replacement'] },
    { service: 'Concrete Installation',                        keywords: ['pour', 'install', 'new patio', 'new sidewalk'] },
    { service: 'Concrete Repair',                              keywords: ['crack', 'repair', 'fix'] },
  ],
};

// ── Urgency / difficulty keyword lists (moved unchanged from demo.js) ──
const URGENT_WORDS = ['urgent', 'emergency', 'asap', 'quick', 'immediately', 'hurry', 'soon', 'leak', 'flood', 'broken', 'burst', 'dangerous', 'hazard', 'safety', 'storm', 'damage'];
const DIFFICULTY_WORDS = ['near house', 'near', 'close to', 'difficult', 'tight', 'backyard', 'fence', 'power line', 'over', 'structure', 'building', 'garage', 'leaning toward', 'leaning'];

// Explicit urgency *statements* (used for the typed urgency fact; the broader
// URGENT_WORDS list still drives the legacy urgency score, customer-only)
const URGENCY_STATE_WORDS = ['emergency', 'urgent', 'as soon as possible', 'asap', 'immediately', 'right away'];

// ═══════════════════════════════════════════════════════════════════════════
// 1. Transcript normalization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize any supported transcript shape into TranscriptTurn[]:
 *   { turnId, speaker: 'customer'|'agent'|'system'|'unknown',
 *     utterance, timestamp, source: 'retell'|'simulation' }
 *
 * Accepted input line shapes:
 *   - Retell transcript_object entries: { role: 'user'|'assistant'|'agent', content|words }
 *   - Stored session lines:             { speaker: 'ai'|'agent'|'customer', text }
 *   - Simulation messages:              { from: 'You'|'Customer', text }
 *   - Fixture turns:                    { turnId, speaker, utterance|text }
 *
 * Turns are NEVER flattened into one global string. Original order, full
 * utterance, speaker identity, and a stable turnId are preserved.
 */
function normalizeTranscript(lines, source) {
  if (!Array.isArray(lines)) return [];
  const defaultSource = source === 'simulation' ? 'simulation' : 'retell';
  return lines.map(function(l, i) {
    if (!l || typeof l !== 'object') {
      return { turnId: 'turn-' + i, speaker: 'unknown', utterance: String(l == null ? '' : l), timestamp: null, source: defaultSource };
    }
    const role = String(l.role || '').toLowerCase();
    const sp = String(l.speaker || '').toLowerCase();
    const from = String(l.from || '').toLowerCase();
    let speaker = 'unknown';
    if (role === 'user') speaker = 'customer';
    else if (role === 'assistant' || role === 'agent') speaker = 'agent';
    else if (sp === 'customer' || sp === 'user') speaker = 'customer';
    else if (sp === 'ai' || sp === 'agent' || sp === 'assistant') speaker = 'agent';
    else if (sp === 'system') speaker = 'system';
    else if (from === 'you') speaker = 'agent';
    else if (from === 'customer') speaker = 'customer';
    const text = l.utterance != null ? l.utterance : (l.text != null ? l.text : (l.content != null ? l.content : (l.words != null ? l.words : '')));
    return {
      turnId: l.turnId || ('turn-' + i),
      speaker: speaker,
      utterance: String(text),
      timestamp: l.timestamp || null,
      source: (l.source === 'simulation' || l.source === 'retell') ? l.source : defaultSource,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Sentence + number utilities (turn-local, never whole-transcript)
// ═══════════════════════════════════════════════════════════════════════════

/** Split an utterance into contiguous sentence substrings (text preserved). */
function splitSentences(text) {
  if (!text) return [];
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .filter(function(s) { return s.trim().length > 0; });
}

const SMALL_NUMS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/** "one hundred and twenty" / "one-hundred-and-twenty" → 120 */
function wordsToNumber(phrase) {
  if (!phrase) return null;
  const tokens = String(phrase).toLowerCase().split(/[\s-]+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'and') continue;
    if (Object.prototype.hasOwnProperty.call(SMALL_NUMS, t)) {
      current += SMALL_NUMS[t];
      sawNumber = true;
    } else if (t === 'hundred') {
      current = (current === 0 ? 1 : current) * 100;
      sawNumber = true;
    } else if (t === 'thousand') {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      sawNumber = true;
    } else {
      return null; // non-number token — not a spelled number phrase
    }
  }
  return sawNumber ? total + current : null;
}

const NUM_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const SPELLED_NUM = NUM_WORD + '(?:[\\s-]+(?:and[\\s-]+)?' + NUM_WORD + ')*';
const DIGIT_NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
const NUM = '(' + DIGIT_NUM + '|' + SPELLED_NUM + ')';

/** Parse a matched number string (digits or words) to a number. */
function parseNumberToken(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (/^\d/.test(s)) {
    const n = parseFloat(s.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  return wordsToNumber(s);
}

const APPROX_RE = /\b(about|approximately|around|roughly|nearly|almost|closer to|close to|over|at least)\s*$/i;
const HEDGE_RE = /\b(maybe|possibly|perhaps|i think|i guess|i'm not sure|im not sure|not sure|unsure|no idea|don't know|dont know|can't remember|cant remember|not certain|something like that)\b/i;
const NEGATION_RE = /\b(not|no|never|isn't|isnt|aren't|arent|don't|dont|doesn't|doesnt|didn't|didnt|won't|wont|wouldn't|wouldnt|none|nothing|without)\b/i;
const CORRECTION_RE = /\b(actually|i was wrong|i meant|meant to say|correction|scratch that|make that|my mistake|sorry|let me correct)\b/i;

const COUNTABLE_NOUNS = {
  trees: 'trees', tree: 'trees', pines: 'trees', pine: 'trees', oaks: 'trees', oak: 'trees',
  maples: 'trees', maple: 'trees', cedars: 'trees', cedar: 'trees', evergreens: 'trees',
  stumps: 'stumps', stump: 'stumps',
  rooms: 'rooms', room: 'rooms', bedrooms: 'rooms', bedroom: 'rooms',
  windows: 'windows', window: 'windows', doors: 'windows', door: 'windows', panels: 'windows', panel: 'windows',
  units: 'units', unit: 'units', systems: 'units', system: 'units',
};

/** True if the sentence contains hedging/uncertainty language or is a question. */
function isHedged(sentence) {
  if (!sentence) return false;
  if (HEDGE_RE.test(sentence)) return true;
  return /\?\s*$/.test(sentence.trim());
}

/** True if a negation word appears shortly before position idx in the sentence. */
function isNegatedAt(sentence, idx) {
  const before = sentence.substring(Math.max(0, idx - 30), idx);
  return NEGATION_RE.test(before);
}

/**
 * Constrained typed parser for one sentence (turn-local context).
 * Returns mentions: { kind: 'measurement'|'quantity'|'age', unit, value,
 *                     span, index, approx, noun }
 *
 * Handles the required production cases, e.g.:
 *   "four 120-foot trees"                    → quantity 4 trees, height 120 ft
 *   "four one-hundred-and-twenty-foot pines" → quantity 4, height 120 ft
 *   "two trees are 80 feet and one is about 110 feet" → 80 ft and 110 ft
 *   "a 24-inch trunk on a 90-foot tree"      → 24 in and 90 ft
 *   "about 2,000 square feet"                → 2000 sqft
 *   "12 rooms"                               → quantity 12 rooms
 *   "a ten-year-old AC system"               → age 10 yr
 *
 * Never attaches a quantity number to a measurement unit: consumed spans are
 * tracked so "four" in "four 120-foot trees" cannot become "4 ft".
 */
function parseNumericMentions(sentence) {
  if (!sentence) return [];
  const mentions = [];
  const consumed = []; // [start, end) ranges already claimed by a mention

  function overlaps(start, end) {
    return consumed.some(function(r) { return start < r[1] && end > r[0]; });
  }
  function claim(start, end) { consumed.push([start, end]); }
  function approxBefore(start) {
    return APPROX_RE.test(sentence.substring(Math.max(0, start - 20), start));
  }
  function run(re, handler) {
    let m;
    while ((m = re.exec(sentence)) !== null) {
      handler(m);
      if (m.index === re.lastIndex) re.lastIndex++; // safety
    }
  }
  function addMention(kind, unit, numStr, matchIndex, matchText, noun) {
    const value = parseNumberToken(numStr);
    if (value === null) return;
    const start = matchIndex;
    const end = matchIndex + matchText.length;
    if (overlaps(start, end)) return;
    claim(start, end);
    mentions.push({
      kind: kind,
      unit: unit,
      value: value,
      span: matchText,
      index: start,
      approx: approxBefore(start),
      noun: noun || null,
    });
  }

  // 0. Explicit ranges ("80 to 100 feet") — ambiguous, no single value.
  run(new RegExp('\\b' + NUM + '\\s+to\\s+' + NUM + '\\s*(?:feet|foot|ft)\\b', 'gi'), function(m) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (overlaps(start, end)) return;
    claim(start, end);
    mentions.push({ kind: 'measurement', unit: 'ft', value: null, span: m[0], index: start, approx: true, noun: null, range: true });
  });

  // 1. Ages: "ten-year-old", "10 year old", "10 years old"
  run(new RegExp('\\b' + NUM + '[\\s-]+years?[\\s-]+old\\b', 'gi'), function(m) {
    addMention('age', 'yr', m[1], m.index, m[0], null);
  });

  // 2. Square footage: "2,000 square feet", "550 sq ft", "two thousand square feet"
  run(new RegExp('\\b' + NUM + '[\\s-]*(?:square[\\s-]*(?:feet|foot)|sq\\.?[\\s-]*ft\\.?|sqft)\\b', 'gi'), function(m) {
    addMention('measurement', 'sqft', m[1], m.index, m[0], null);
  });

  // 3. Adjectival feet: "120-foot trees", "one-hundred-and-twenty-foot pines"
  run(new RegExp('\\b' + NUM + '[\\s-](?:foot|ft)\\b(?![\\s-]+old)', 'gi'), function(m) {
    const after = sentence.substring(m.index + m[0].length).match(/^\s+([a-z-]+)/i);
    addMention('measurement', 'ft', m[1], m.index, m[0], after ? after[1].toLowerCase() : null);
  });

  // 4. Postfix feet: "120 feet tall", "80 feet", "sixty feet high"
  run(new RegExp('\\b' + NUM + '\\s*(?:feet|foot|ft)\\b(?:\\s+(?:tall|high|long|wide|up))?', 'gi'), function(m) {
    addMention('measurement', 'ft', m[1], m.index, m[0], null);
  });

  // 5. Inches: "24-inch trunk", "24 inches", "twenty-four inch diameter"
  run(new RegExp('\\b' + NUM + '[\\s-]*(?:inches|inch|in\\.)\\b', 'gi'), function(m) {
    const after = sentence.substring(m.index + m[0].length).match(/^\s+([a-z-]+)/i);
    addMention('measurement', 'in', m[1], m.index, m[0], after ? after[1].toLowerCase() : null);
  });

  // 6. Quantities: "four 120-foot trees", "four trees", "12 rooms".
  //    The number itself must be unconsumed; intermediate adjectives (which
  //    may themselves be consumed measurement spans like "120-foot") are
  //    allowed as modifiers of the counted noun.
  run(new RegExp('\\b' + NUM + '\\s+((?:[a-z0-9,-]+\\s+){0,3}?)([a-z]+)\\b', 'gi'), function(m) {
    const numStr = m[1];
    const noun = (m[3] || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(COUNTABLE_NOUNS, noun)) return;
    const numStart = m.index;
    const numEnd = m.index + numStr.length;
    if (overlaps(numStart, numEnd)) return; // number already used as a measurement
    const value = parseNumberToken(numStr);
    if (value === null) return;
    claim(numStart, numEnd);
    mentions.push({
      kind: 'quantity',
      unit: COUNTABLE_NOUNS[noun],
      value: value,
      span: m[0],
      index: numStart,
      approx: approxBefore(numStart),
      noun: COUNTABLE_NOUNS[noun],
    });
  });

  mentions.sort(function(a, b) { return a.index - b.index; });
  return mentions;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Typed PolarisFact production
// ═══════════════════════════════════════════════════════════════════════════

function nowIso() { return new Date().toISOString(); }

function makeEvidence(turn, sentence, exactSpan) {
  return {
    speaker: turn ? turn.speaker : 'system',
    turnId: turn ? turn.turnId : null,
    utterance: turn ? turn.utterance : null,
    exactSpan: exactSpan != null ? exactSpan : (sentence != null ? sentence : null),
    timestamp: turn ? turn.timestamp : null,
    transcriptSource: turn ? turn.source : 'retell',
  };
}

function makeFact(o) {
  const ts = nowIso();
  return {
    id: uuidv4(),
    entityType: o.entityType || 'job',
    entityId: o.entityId || 'job-0',
    variable: o.variable,
    valueType: o.valueType,
    status: o.status,
    normalizedValue: o.normalizedValue !== undefined ? o.normalizedValue : null,
    displayValue: o.displayValue != null ? o.displayValue : null,
    unit: o.unit != null ? o.unit : null,
    extractionConfidence: o.extractionConfidence != null ? o.extractionConfidence : 0,
    evidence: o.evidence || {
      speaker: 'system', turnId: null, utterance: null, exactSpan: null,
      timestamp: null, transcriptSource: 'retell',
    },
    provenance: o.provenance || '',
    extractionMethod: o.extractionMethod || 'direct_extraction',
    conflicts: o.conflicts ? o.conflicts.slice() : [],
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Enforce `collected` invariants. A fact may only remain `collected` when:
 *   - normalizedValue is non-null,
 *   - evidence.speaker === 'customer',
 *   - a complete evidence utterance and exact span are retained,
 *   - the exact span actually appears in the cited utterance.
 * Anything else is downgraded to mentioned_unresolved (customer evidence) or
 * inferred (non-customer evidence).
 */
function enforceCollectedInvariants(fact) {
  if (fact.status !== 'collected') return fact;
  const ev = fact.evidence || {};
  const valid = fact.normalizedValue !== null &&
    ev.speaker === 'customer' &&
    typeof ev.utterance === 'string' && ev.utterance.length > 0 &&
    typeof ev.exactSpan === 'string' && ev.exactSpan.length > 0 &&
    ev.utterance.indexOf(ev.exactSpan) !== -1;
  if (valid) return fact;
  if (ev.speaker === 'customer') {
    fact.status = 'mentioned_unresolved';
    fact.normalizedValue = null;
    fact.provenance = (fact.provenance ? fact.provenance + ' — ' : '') + 'downgraded: failed collected validation';
  } else {
    fact.status = 'inferred';
    fact.provenance = (fact.provenance ? fact.provenance + ' — ' : '') + 'downgraded: non-customer evidence can never be collected';
  }
  fact.updatedAt = nowIso();
  return fact;
}

const UNIT_LABEL = { ft: 'ft', in: 'in', sqft: 'sq ft', yr: 'yr' };

function measurementDisplay(value, unit, approx) {
  const label = UNIT_LABEL[unit] || unit || '';
  const base = value + (label ? ' ' + label : '');
  return approx ? 'Approximately ' + base : base;
}

/** Map a parsed numeric mention to an industry profile variable name. */
function mapMentionToVariable(mention, profile) {
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    if (!v.unit) continue;
    if (v.unit === 'ft' && mention.kind === 'measurement' && mention.unit === 'ft') return v.name;
    if (v.unit === 'inches' && mention.kind === 'measurement' && mention.unit === 'in') return v.name;
    if (v.unit === 'sq ft' && mention.kind === 'measurement' && mention.unit === 'sqft') return v.name;
    if (v.unit === 'years' && mention.kind === 'age') return v.name;
    if (v.unit === 'rooms' && mention.kind === 'quantity' && mention.unit === 'rooms') return v.name;
    if (v.unit === 'windows' && mention.kind === 'quantity' && mention.unit === 'windows') return v.name;
  }
  return null;
}

function valuesCloseEnough(a, b) {
  if (a === b) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return true;
  return Math.abs(a - b) / denom <= 0.1;
}

/**
 * Reconcile multiple value mentions of the same variable (owner Decision 3):
 *   - hedged mention                        → mentioned_unresolved
 *   - repeated compatible values            → first evidence kept
 *   - multiple values in the SAME turn      → multiple collected facts
 *                                             (different assets; entity
 *                                             association is Phase D)
 *   - later turn + explicit correction      → resolve to the corrected value,
 *                                             earlier evidence preserved on a
 *                                             superseded (unresolved) record
 *   - later turn, incompatible, no explicit → ALL candidates conflicting,
 *     correction                              cross-linked, none counted
 */
function reconcileValueMentions(varName, recs, opts) {
  const out = [];
  const accepted = []; // { rec, fact }
  const valueType = opts.valueType;
  const unit = opts.unit;

  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];

    if (r.mention.range || r.hedged) {
      out.push(makeFact({
        entityType: opts.entityType || 'job',
        variable: varName,
        valueType: valueType,
        status: 'mentioned_unresolved',
        normalizedValue: null,
        displayValue: null,
        unit: unit,
        extractionConfidence: 0.4,
        evidence: makeEvidence(r.turn, r.sentence, r.mention.span),
        provenance: 'Customer mentioned ' + varName + ' but the value was uncertain ("' + r.mention.span + '")',
        extractionMethod: 'direct_extraction',
      }));
      continue;
    }

    const fact = makeFact({
      entityType: opts.entityType || 'job',
      variable: varName,
      valueType: valueType,
      status: 'collected',
      normalizedValue: r.mention.value,
      displayValue: opts.display(r.mention),
      unit: unit,
      extractionConfidence: r.mention.approx ? 0.75 : (/^\d/.test(r.mention.span) ? 0.95 : 0.9),
      evidence: makeEvidence(r.turn, r.sentence, r.mention.span),
      provenance: 'Directly stated by customer in ' + r.turn.turnId,
      extractionMethod: 'direct_extraction',
    });

    // Compatible with an already-accepted value → reinforcing statement.
    const dup = accepted.find(function(a) {
      return a.fact.status === 'collected' && valuesCloseEnough(a.fact.normalizedValue, fact.normalizedValue);
    });
    if (dup) continue;

    if (accepted.length === 0) {
      accepted.push({ rec: r, fact: fact });
      out.push(fact);
      continue;
    }

    // Multiple distinct values inside the same turn → multiple assets
    // described together (e.g. "two trees are 80 feet and one is 110 feet").
    const sameTurn = accepted.some(function(a) { return a.rec.turn.turnId === r.turn.turnId; });
    if (sameTurn) {
      accepted.push({ rec: r, fact: fact });
      out.push(fact);
      continue;
    }

    // Later turn, different value.
    if (CORRECTION_RE.test(r.sentence) || CORRECTION_RE.test(r.turn.utterance)) {
      // Explicit correction: resolve to the corrected value; preserve the
      // earlier evidence turn on the superseded record (owner Decision 3).
      for (let a = 0; a < accepted.length; a++) {
        const prior = accepted[a].fact;
        if (prior.status !== 'collected') continue;
        prior.status = 'mentioned_unresolved';
        prior.displayValue = (prior.displayValue || '') + ' (superseded by explicit customer correction)';
        prior.normalizedValue = null;
        prior.provenance = 'Superseded by explicit customer correction in ' + r.turn.turnId + '; original evidence preserved';
        prior.updatedAt = nowIso();
      }
      fact.provenance = 'Customer explicitly corrected an earlier statement (' +
        accepted.map(function(a) { return a.rec.turn.turnId; }).join(', ') + ')';
      accepted.length = 0;
      accepted.push({ rec: r, fact: fact });
      out.push(fact);
      continue;
    }

    // No explicit correction → conflicting. Preserve every candidate.
    out.push(fact);
    accepted.push({ rec: r, fact: fact });
    const collectedCands = accepted.filter(function(a) { return a.fact.status === 'collected' || a.fact.status === 'conflicting'; });
    for (let a = 0; a < collectedCands.length; a++) {
      const f = collectedCands[a].fact;
      f.status = 'conflicting';
      f.conflicts = collectedCands
        .filter(function(b) { return b.fact.id !== f.id; })
        .map(function(b) { return b.fact.id; });
      f.updatedAt = nowIso();
    }
  }

  return out.map(enforceCollectedInvariants);
}

// ── Contact fact patterns (typed facts only — ContactRecord is Phase E) ──
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const NAME_RE = /\b(?:my name is|my name's|this is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/;
const ADDRESS_RE = /\b\d{1,6}\s+(?:[A-Z][A-Za-z']+\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir|Terrace|Trail)\b\.?/;

function extractContactFacts(customerTurns) {
  const facts = [];
  let phoneDone = false, nameDone = false, addressDone = false;
  for (let i = 0; i < customerTurns.length; i++) {
    const turn = customerTurns[i];
    const sentences = splitSentences(turn.utterance);
    for (let s = 0; s < sentences.length; s++) {
      const sentence = sentences[s];
      if (!phoneDone) {
        const m = sentence.match(PHONE_RE);
        if (m) {
          const digits = m[0].replace(/\D/g, '');
          const normalized = digits.length === 10 ? '+1' + digits : '+' + digits;
          facts.push(makeFact({
            entityType: 'customer', entityId: 'customer-0',
            variable: 'customer_phone', valueType: 'phone', status: 'collected',
            normalizedValue: normalized, displayValue: m[0], unit: null,
            extractionConfidence: 0.95,
            evidence: makeEvidence(turn, sentence, m[0]),
            provenance: 'Phone number stated by customer in ' + turn.turnId,
          }));
          phoneDone = true;
        }
      }
      if (!nameDone) {
        const m = sentence.match(NAME_RE);
        if (m) {
          facts.push(makeFact({
            entityType: 'customer', entityId: 'customer-0',
            variable: 'customer_name', valueType: 'free_text', status: 'collected',
            normalizedValue: m[1], displayValue: m[1], unit: null,
            extractionConfidence: 0.9,
            evidence: makeEvidence(turn, sentence, m[0]),
            provenance: 'Name stated by customer in ' + turn.turnId,
          }));
          nameDone = true;
        }
      }
      if (!addressDone) {
        const m = sentence.match(ADDRESS_RE);
        if (m) {
          facts.push(makeFact({
            entityType: 'customer', entityId: 'customer-0',
            variable: 'service_address', valueType: 'address', status: 'collected',
            normalizedValue: m[0].replace(/\.$/, ''), displayValue: m[0].replace(/\.$/, ''), unit: null,
            extractionConfidence: 0.9,
            evidence: makeEvidence(turn, sentence, m[0]),
            provenance: 'Service address stated by customer in ' + turn.turnId,
          }));
          addressDone = true;
        }
      }
    }
  }
  return facts.map(enforceCollectedInvariants);
}

/**
 * Extract typed PolarisFacts from normalized turns.
 * Only customer turns may produce direct customer facts (strict speaker
 * isolation). Agent, system, and unknown speakers are never evidence for
 * requested service, urgency, intent, measurements, quantities, job scope,
 * property facts, qualification, or estimate adjustments.
 *
 * Returns { facts: PolarisFact[], meta: {...} } where meta carries the
 * customer-only signals the intelligence layer needs (urgency hit count,
 * difficulty quote, detected services).
 */
function extractPolarisFacts(turns, industry) {
  const profile = QUALIFICATION_PROFILES[industry] || [];
  const allTurns = Array.isArray(turns) ? turns : [];
  const customerTurns = allTurns.filter(function(t) { return t.speaker === 'customer'; });
  const facts = [];
  const meta = {
    serviceDetected: [],
    serviceQuote: null,
    serviceEvidenceTurnId: null,
    urgencyHits: 0,
    urgencyNegated: false,
    urgencyQuote: null,
    difficultyFound: false,
    difficultyQuote: null,
  };

  // ── Pass 1: numeric mentions per customer turn/sentence ──
  const mentionsByVar = {};
  const quantityRecs = [];
  for (let i = 0; i < customerTurns.length; i++) {
    const turn = customerTurns[i];
    const sentences = splitSentences(turn.utterance);
    for (let s = 0; s < sentences.length; s++) {
      const sentence = sentences[s];
      const hedged = isHedged(sentence);
      const mentions = parseNumericMentions(sentence);
      for (let k = 0; k < mentions.length; k++) {
        const mention = mentions[k];
        const rec = { mention: mention, turn: turn, sentence: sentence, hedged: hedged };
        const varName = mapMentionToVariable(mention, profile);
        if (varName) {
          if (!mentionsByVar[varName]) mentionsByVar[varName] = [];
          mentionsByVar[varName].push(rec);
        } else if (mention.kind === 'quantity') {
          quantityRecs.push(rec);
        }
      }
    }
  }

  // ── Pass 2: typed facts for profile variables with numeric values ──
  const varHasFacts = {};
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    const recs = mentionsByVar[v.name];
    if (!recs || recs.length === 0) continue;
    const valueType = v.unit === 'years' ? 'age' : (v.unit === 'rooms' || v.unit === 'windows' ? 'quantity' : 'measurement');
    const unit = v.unit === 'sq ft' ? 'sqft' : (v.unit === 'inches' ? 'in' : (v.unit === 'years' ? 'yr' : v.unit));
    const produced = reconcileValueMentions(v.name, recs, {
      valueType: valueType,
      unit: unit,
      display: function(m) {
        if (valueType === 'age') return m.value + ' years old';
        if (valueType === 'quantity') return m.value + ' ' + (m.noun || unit);
        return measurementDisplay(m.value, unit, m.approx);
      },
    });
    for (let p = 0; p < produced.length; p++) facts.push(produced[p]);
    varHasFacts[v.name] = true;
  }

  // ── Pass 3: keyword engagement for variables without numeric values ──
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    if (varHasFacts[v.name]) continue;
    let best = null; // { turn, sentence, keyword, idx, negated, hedged, rank }
    for (let t = 0; t < customerTurns.length; t++) {
      const turn = customerTurns[t];
      const sentences = splitSentences(turn.utterance);
      for (let s = 0; s < sentences.length; s++) {
        const sentence = sentences[s];
        const lc = sentence.toLowerCase();
        for (let k = 0; k < v.keywords.length; k++) {
          const idx = lc.indexOf(v.keywords[k]);
          if (idx === -1) continue;
          const hedged = isHedged(sentence);
          const negated = isNegatedAt(sentence, idx);
          const rank = hedged ? 2 : (negated ? 1 : 0); // prefer plain positive
          if (!best || rank < best.rank) {
            best = { turn: turn, sentence: sentence, keyword: v.keywords[k], idx: idx, negated: negated, hedged: hedged, rank: rank };
          }
        }
      }
    }
    if (!best) {
      facts.push(makeFact({
        variable: v.name,
        valueType: v.unit ? 'measurement' : 'category',
        status: 'missing',
        normalizedValue: null,
        displayValue: null,
        unit: v.unit === 'sq ft' ? 'sqft' : (v.unit === 'inches' ? 'in' : (v.unit === 'years' ? 'yr' : v.unit)) || null,
        extractionConfidence: 0,
        evidence: { speaker: 'system', turnId: null, utterance: null, exactSpan: null, timestamp: null, transcriptSource: 'retell' },
        provenance: 'Variable was not mentioned in any customer turn',
        extractionMethod: 'system_inference',
      }));
      continue;
    }
    const exactSpan = best.sentence.substr(best.idx, best.keyword.length);
    if (v.unit || best.hedged) {
      // Numeric variable mentioned without a usable value, or hedged mention.
      facts.push(makeFact({
        variable: v.name,
        valueType: v.unit ? 'measurement' : 'category',
        status: 'mentioned_unresolved',
        normalizedValue: null,
        displayValue: null,
        unit: v.unit === 'sq ft' ? 'sqft' : (v.unit === 'inches' ? 'in' : (v.unit === 'years' ? 'yr' : v.unit)) || null,
        extractionConfidence: 0.4,
        evidence: makeEvidence(best.turn, best.sentence, exactSpan),
        provenance: 'Customer mentioned ' + v.name + ' but no usable value was extracted',
      }));
    } else if (best.negated) {
      facts.push(enforceCollectedInvariants(makeFact({
        variable: v.name,
        valueType: 'boolean',
        status: 'collected',
        normalizedValue: false,
        displayValue: 'No',
        unit: null,
        extractionConfidence: 0.85,
        evidence: makeEvidence(best.turn, best.sentence, exactSpan),
        provenance: 'Customer explicitly declined/negated ' + v.name + ' in ' + best.turn.turnId,
      })));
    } else {
      facts.push(enforceCollectedInvariants(makeFact({
        variable: v.name,
        valueType: 'category',
        status: 'collected',
        normalizedValue: best.keyword,
        displayValue: exactSpan,
        unit: null,
        extractionConfidence: 0.85,
        evidence: makeEvidence(best.turn, best.sentence, exactSpan),
        provenance: 'Customer stated ' + v.name + ' ("' + best.keyword + '") in ' + best.turn.turnId,
      })));
    }
  }

  // ── Pass 4: generic quantity facts (e.g. tree counts) ──
  if (quantityRecs.length > 0) {
    const produced = reconcileValueMentions('quantity', quantityRecs, {
      valueType: 'quantity',
      unit: quantityRecs[0].mention.noun || null,
      display: function(m) { return m.value + ' ' + (m.noun || 'items'); },
    });
    for (let p = 0; p < produced.length; p++) facts.push(produced[p]);
  }

  // ── Pass 5: requested service (customer speech ONLY) ──
  const services = SERVICE_KEYWORDS[industry] || [];
  for (let sv = 0; sv < services.length; sv++) {
    const entry = services[sv];
    let match = null;
    for (let t = 0; t < customerTurns.length && !match; t++) {
      const turn = customerTurns[t];
      const sentences = splitSentences(turn.utterance);
      for (let s = 0; s < sentences.length && !match; s++) {
        const sentence = sentences[s];
        const lc = sentence.toLowerCase();
        for (let k = 0; k < entry.keywords.length; k++) {
          const idx = lc.indexOf(entry.keywords[k]);
          if (idx === -1) continue;
          if (isNegatedAt(sentence, idx)) continue; // "not an emergency" ≠ emergency service
          match = { turn: turn, sentence: sentence, keyword: entry.keywords[k], idx: idx };
          break;
        }
      }
    }
    if (match) {
      const isPrimary = meta.serviceDetected.length === 0;
      meta.serviceDetected.push(entry.service);
      if (isPrimary) {
        meta.serviceQuote = match.sentence.trim();
        meta.serviceEvidenceTurnId = match.turn.turnId;
      }
      facts.push(enforceCollectedInvariants(makeFact({
        variable: isPrimary ? 'requested_service' : 'requested_service_secondary',
        valueType: 'category',
        status: 'collected',
        normalizedValue: entry.service,
        displayValue: entry.service,
        unit: null,
        extractionConfidence: 0.9,
        evidence: makeEvidence(match.turn, match.sentence, match.sentence.substr(match.idx, match.keyword.length)),
        provenance: 'Requested service detected from customer statement in ' + match.turn.turnId,
      })));
    }
  }
  if (meta.serviceDetected.length === 0) {
    facts.push(makeFact({
      variable: 'requested_service',
      valueType: 'category',
      status: 'inferred',
      normalizedValue: null,
      displayValue: null,
      unit: null,
      extractionConfidence: 0.3,
      evidence: { speaker: 'system', turnId: null, utterance: null, exactSpan: null, timestamp: null, transcriptSource: 'retell' },
      provenance: 'No specific service stated by customer — industry default applies',
      extractionMethod: 'system_inference',
    }));
  }

  // ── Pass 6: urgency (customer statements ONLY — agent questions are not evidence) ──
  let urgencyPositive = null; // { turn, sentence, word }
  let urgencyNegative = null;
  const urgentHitWords = new Set();
  for (let t = 0; t < customerTurns.length; t++) {
    const turn = customerTurns[t];
    const sentences = splitSentences(turn.utterance);
    for (let s = 0; s < sentences.length; s++) {
      const sentence = sentences[s];
      const lc = sentence.toLowerCase();
      if (/\?\s*$/.test(sentence.trim())) continue; // questions are not statements
      for (let w = 0; w < URGENT_WORDS.length; w++) {
        const idx = lc.indexOf(URGENT_WORDS[w]);
        if (idx === -1) continue;
        if (isNegatedAt(sentence, idx)) {
          if (!urgencyNegative && URGENCY_STATE_WORDS.indexOf(URGENT_WORDS[w]) !== -1) {
            urgencyNegative = { turn: turn, sentence: sentence, word: URGENT_WORDS[w] };
          }
          continue;
        }
        urgentHitWords.add(URGENT_WORDS[w]);
        if (!urgencyPositive && URGENCY_STATE_WORDS.indexOf(URGENT_WORDS[w]) !== -1) {
          urgencyPositive = { turn: turn, sentence: sentence, word: URGENT_WORDS[w] };
        }
      }
    }
  }
  meta.urgencyHits = urgentHitWords.size;
  if (urgencyPositive) {
    meta.urgencyQuote = urgencyPositive.sentence.trim();
    facts.push(enforceCollectedInvariants(makeFact({
      variable: 'urgency',
      valueType: 'category',
      status: 'collected',
      normalizedValue: 'high',
      displayValue: 'High urgency',
      unit: null,
      extractionConfidence: 0.9,
      evidence: makeEvidence(urgencyPositive.turn, urgencyPositive.sentence, urgencyPositive.sentence),
      provenance: 'Customer stated urgency ("' + urgencyPositive.word + '") in ' + urgencyPositive.turn.turnId,
    })));
  } else if (urgencyNegative) {
    meta.urgencyNegated = true;
    facts.push(enforceCollectedInvariants(makeFact({
      variable: 'urgency',
      valueType: 'category',
      status: 'collected',
      normalizedValue: 'standard',
      displayValue: 'Not an emergency (customer-stated)',
      unit: null,
      extractionConfidence: 0.9,
      evidence: makeEvidence(urgencyNegative.turn, urgencyNegative.sentence, urgencyNegative.sentence),
      provenance: 'Customer explicitly stated this is not an emergency in ' + urgencyNegative.turn.turnId,
    })));
  } else {
    facts.push(makeFact({
      variable: 'urgency',
      valueType: 'category',
      status: 'missing',
      normalizedValue: null,
      displayValue: null,
      unit: null,
      extractionConfidence: 0,
      evidence: { speaker: 'system', turnId: null, utterance: null, exactSpan: null, timestamp: null, transcriptSource: 'retell' },
      provenance: 'Urgency was not stated by the customer',
      extractionMethod: 'system_inference',
    }));
  }

  // ── Pass 7: access difficulty (customer statements ONLY) ──
  for (let t = 0; t < customerTurns.length && !meta.difficultyFound; t++) {
    const turn = customerTurns[t];
    const sentences = splitSentences(turn.utterance);
    for (let s = 0; s < sentences.length; s++) {
      const sentence = sentences[s];
      const lc = sentence.toLowerCase();
      for (let w = 0; w < DIFFICULTY_WORDS.length; w++) {
        const idx = lc.indexOf(DIFFICULTY_WORDS[w]);
        if (idx === -1) continue;
        if (isNegatedAt(sentence, idx)) continue;
        meta.difficultyFound = true;
        meta.difficultyQuote = sentence.trim();
        facts.push(enforceCollectedInvariants(makeFact({
          variable: 'access_difficulty',
          valueType: 'category',
          status: 'collected',
          normalizedValue: DIFFICULTY_WORDS[w],
          displayValue: sentence.substr(idx, DIFFICULTY_WORDS[w].length),
          unit: null,
          extractionConfidence: 0.85,
          evidence: makeEvidence(turn, sentence, sentence.substr(idx, DIFFICULTY_WORDS[w].length)),
          provenance: 'Access difficulty stated by customer in ' + turn.turnId,
        })));
        break;
      }
      if (meta.difficultyFound) break;
    }
  }

  // ── Pass 8: contact facts (typed facts only — ContactRecord is Phase E) ──
  const contactFacts = extractContactFacts(customerTurns);
  for (let c = 0; c < contactFacts.length; c++) facts.push(contactFacts[c]);

  return { facts: facts, meta: meta };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Legacy compatibility layer
// ═══════════════════════════════════════════════════════════════════════════

/** True when a fact is an eligible, customer-sourced collected fact. */
function isEligibleCollected(f) {
  return f.status === 'collected' &&
    f.normalizedValue !== null &&
    f.evidence && f.evidence.speaker === 'customer';
}

const LEGACY_UNIT = { sqft: 'sq ft', in: 'inches', yr: 'years', ft: 'ft' };

/**
 * Derive the existing compatibility fields from typed facts:
 *   { qualification: { variables, collected, missing, completeness,
 *                      totalVariables }, extractedValues }
 *
 * Mapping rules (Phase B §7/§10):
 *   - only eligible collected facts count toward completeness
 *   - mentioned_unresolved / conflicting / inferred / missing do NOT count
 *   - missingInformation includes every non-collected profile variable
 */
function buildPolarisLegacyFromFacts(facts, industry) {
  const profile = QUALIFICATION_PROFILES[industry] || [];
  const variables = [];
  const collectedNames = [];
  const missingNames = [];
  const extractedValues = {};

  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    const vFacts = (facts || []).filter(function(f) { return f.variable === v.name; });
    const collected = vFacts.filter(isEligibleCollected);

    if (collected.length > 0) {
      collectedNames.push(v.name);
      let value = null, unit = v.unit || null, display = null;
      const numeric = collected.filter(function(f) { return typeof f.normalizedValue === 'number'; });
      if (numeric.length > 0) {
        const legacyUnit = LEGACY_UNIT[collected[0].unit] || v.unit || collected[0].unit || '';
        const values = numeric.map(function(f) { return f.normalizedValue; });
        const maxVal = Math.max.apply(null, values);
        value = maxVal.toLocaleString('en-US') + (legacyUnit ? ' ' + legacyUnit : '');
        display = values.length > 1
          ? values.map(function(x) { return x.toLocaleString('en-US'); }).join(', ') + (legacyUnit ? ' ' + legacyUnit : '')
          : value;
        unit = legacyUnit || null;
        extractedValues[v.name] = value;
      } else {
        value = String(collected[0].displayValue != null ? collected[0].displayValue : collected[0].normalizedValue);
        display = value;
        unit = null;
      }
      variables.push({
        variable: v.name,
        value: value,
        unit: unit,
        display: display,
        sourceQuote: collected[0].evidence.exactSpan || collected[0].evidence.utterance || null,
        confidence: Math.max.apply(null, collected.map(function(f) { return f.extractionConfidence; })),
        status: 'collected',
      });
      continue;
    }

    // Not collected → contributes to legacy missingInformation.
    missingNames.push(v.name);
    let status = 'missing';
    if (vFacts.some(function(f) { return f.status === 'conflicting'; })) status = 'conflicting';
    else if (vFacts.some(function(f) { return f.status === 'mentioned_unresolved'; })) status = 'mentioned_unresolved';
    const evidenced = vFacts.find(function(f) { return f.evidence && f.evidence.speaker === 'customer' && f.evidence.exactSpan; });
    variables.push({
      variable: v.name,
      value: null,
      unit: v.unit || null,
      display: null,
      sourceQuote: evidenced ? evidenced.evidence.exactSpan : null,
      confidence: 0,
      status: status,
    });
  }

  const total = profile.length;
  const completeness = total > 0 ? Math.round((collectedNames.length / total) * 100) : 0;
  return {
    qualification: {
      variables: variables,
      collected: collectedNames,
      missing: missingNames,
      completeness: completeness,
      totalVariables: total,
    },
    extractedValues: extractedValues,
  };
}

/**
 * Turn-bounded evidence lookup (replaces character-window extractSourceQuote):
 * returns the complete customer sentence containing the keyword, or null.
 * Never slices arbitrary character windows or crosses speaker boundaries.
 */
function findCustomerSentence(turns, keyword) {
  if (!keyword) return null;
  const kw = String(keyword).toLowerCase();
  const list = Array.isArray(turns) ? turns : [];
  for (let t = 0; t < list.length; t++) {
    const turn = list[t];
    if (turn.speaker !== 'customer') continue;
    const sentences = splitSentences(turn.utterance);
    for (let s = 0; s < sentences.length; s++) {
      if (sentences[s].toLowerCase().indexOf(kw) !== -1) return sentences[s].trim();
    }
  }
  return null;
}

module.exports = {
  // Data (single source of truth — demo.js imports these)
  QUALIFICATION_PROFILES,
  SERVICE_KEYWORDS,
  URGENT_WORDS,
  DIFFICULTY_WORDS,
  // Normalization
  normalizeTranscript,
  // Extraction
  extractPolarisFacts,
  // Compatibility
  buildPolarisLegacyFromFacts,
  findCustomerSentence,
  isEligibleCollected,
  // Parser internals (exported for unit tests)
  splitSentences,
  wordsToNumber,
  parseNumberToken,
  parseNumericMentions,
  isHedged,
  isNegatedAt,
};
