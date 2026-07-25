'use strict';

const CUSTOMER_ROLES = new Set([
  'customer',
  'caller',
  'client',
  'homeowner',
  'user',
]);

const HAZARD_PATTERNS = [
  {
    signal: 'active flooding',
    regex: /\b(?:flood|flooded|flooding|(?:basement|room|floor|garage|crawl ?space) (?:is |keeps? )?filling(?: with water)?|water is (?:rising|pouring)|water keeps (?:rising|pouring))\b/i,
  },
  {
    signal: 'uncontrolled leak',
    regex: /\b(?:uncontrolled leak|gushing|burst pipe|pipe (?:has )?burst|active leak|leak|leaked|leaking|(?:i |we )?(?:can't|cannot|couldn't|could not) (?:get (?:it|the leak) to stop|stop (?:it|the leak))|leak(?:ing)? (?:and )?(?:i |we )?(?:can't|cannot|couldn't|could not) (?:get it to )?stop)\b/i,
  },
  {
    signal: 'electrical sparking',
    regex: /\b(?:spark|sparks|sparked|sparking|throwing sparks|seeing sparks)\b/i,
  },
  {
    signal: 'burning or smoke',
    regex: /\b(?:there (?:is|'s) (?:a )?fire|burning smell|smell(?:s|ing)? (?:like |something )?burning|smoke|smoking)\b/i,
  },
  {
    signal: 'immediate danger',
    regex: /\b(?:immediate danger|danger right now|unsafe right now|someone (?:is|could be) in danger)\b/i,
  },
];

const NEGATION = /\b(?:no|not|never|nothing|without|isn't|aren't|wasn't|weren't|hasn't|haven't|cannot|can't|couldn't)\b/gi;
const NON_CURRENT = /\b(?:stopped|resolved|(?:already |was |were |has been |have been |had been |got )?fixed|repaired|before (?:the )?repair|under control|shut (?:it|the (?:water|valve)) off|no longer|used to|previously|last (?:week|month|year)|yesterday(?: only)?|can wait|tomorrow(?:'s|\s+is) fine|next[- ]day (?:scheduling )?is fine|slow (?:drip|leak)|minor (?:drip|leak)|seeping|has not returned|hasn't returned|floor is drying|is fine now|it is fine now|no problem remains)\b/i;
const HISTORICAL_PREFIX = /\b(?:there (?:was|were)|was|were|had been|used to|previously)\b/i;
const REPORTED_OR_PAST_PREFIX = /\b(?:asked (?:whether|if)|wondered (?:whether|if)|said (?:that )?|reported (?:that )?|told (?:us|me|them) (?:that )?|had)\b/i;
const CURRENT_RECURRENCE = /\b(?:right now|currently|still|keeps?|again|back|returned)\b/i;
const INDEPENDENT_AND_SUBJECT = /\band\b(?=\s+(?:(?:the|a|an|i|we|there|it|this|that|my|our|your|old|water|basement|outlet|pipe|breaker|panel|room|floor|nothing)\b|no\b))/i;
const SUBJECT_START = /\b(?:(?:the|a|an|my|our|your|that|no)\s+(?:old\s+)?(?:water|basement|outlet|pipe|breaker|panel|room|floor|garage|crawl ?space|technician|electrician)|i|we|there|it|this|nothing|water|basement|outlet|pipe|breaker|panel|room|floor|garage|crawl ?space|technician|electrician)\b/gi;
const INDEPENDENT_CONNECTOR = /\b(?:and|or)\b(?=\s+(?:the|i|we|there|it|this|that|my|our|your|old|nothing)\b)/i;

function normalizeSpeakerRole(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isCustomerSpeaker(value) {
  return CUSTOMER_ROLES.has(normalizeSpeakerRole(value));
}

function splitClauses(text) {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .split(/[.!?;]+|\b(?:but|however|although|yet)\b/i)
    .reduce(function (parts, value) {
      return parts.concat(String(value || '').split(INDEPENDENT_AND_SUBJECT));
    }, [])
    .map(function (value) {
      return value.trim().replace(/^,+|,+$/g, '').trim();
    })
    .filter(Boolean);
}

function allHazardMentions(clause) {
  const mentions = [];
  HAZARD_PATTERNS.forEach(function (pattern) {
    const flags = pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g';
    const regex = new RegExp(pattern.regex.source, flags);
    let match;
    while ((match = regex.exec(clause)) !== null) {
      mentions.push({
        signal: pattern.signal,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  });
  return mentions.sort(function (a, b) {
    return a.start - b.start || b.end - a.end;
  }).filter(function (mention, index, ordered) {
    return index === 0 || mention.start >= ordered[index - 1].end;
  });
}

function afterLastIndependentSubject(text) {
  SUBJECT_START.lastIndex = 0;
  let lastIndex = -1;
  let match;
  while ((match = SUBJECT_START.exec(text)) !== null) {
    const prefix = text.slice(0, match.index);
    if (/\b(?:that|whether|if)\s*$/i.test(prefix)) continue;
    lastIndex = match.index;
  }
  SUBJECT_START.lastIndex = 0;
  return lastIndex >= 0 ? text.slice(lastIndex) : text;
}

function beforeIndependentSubject(text) {
  const connector = text.match(INDEPENDENT_CONNECTOR);
  const connectorIndex = connector ? connector.index : text.length;
  SUBJECT_START.lastIndex = 0;
  let match;
  while ((match = SUBJECT_START.exec(text)) !== null) {
    const prefix = text.slice(0, match.index);
    if (/\b(?:that|whether|if)\s*$/i.test(prefix)) continue;
    SUBJECT_START.lastIndex = 0;
    return text.slice(0, Math.min(match.index, connectorIndex));
  }
  SUBJECT_START.lastIndex = 0;
  return text.slice(0, connectorIndex);
}

function negationCount(text) {
  const matches = String(text || '').match(NEGATION);
  NEGATION.lastIndex = 0;
  return matches ? matches.length : 0;
}

function hasCurrentRecurrence(text) {
  if (!CURRENT_RECURRENCE.test(text)) return false;
  return !/\b(?:has not|hasn't|had not|never)\s+returned\b/i.test(text);
}

function analyzeMentions(clause) {
  const mentions = allHazardMentions(clause);
  const decisions = [];
  mentions.forEach(function (mention, index) {
    const previous = index > 0 ? mentions[index - 1] : null;
    const next = index + 1 < mentions.length ? mentions[index + 1] : null;
    const rawBefore = clause.slice(previous ? previous.end : 0, mention.start);
    const rawAfter = clause.slice(mention.end, next ? next.start : clause.length);
    const localBefore = afterLastIndependentSubject(rawBefore);
    const localAfter = beforeIndependentSubject(rawAfter);
    const localContext = localBefore + mention.text + localAfter;
    const explicitNegations = negationCount(localBefore);
    const priorDecision = decisions[index - 1];
    const coordinated = Boolean(
      previous &&
      priorDecision &&
      priorDecision.negated &&
      /^\s*(?:,\s*)?(?:(?:and|or)\s*)?$/i.test(rawBefore)
    );
    const negated = explicitNegations % 2 === 1 || (explicitNegations === 0 && coordinated);
    const historical = !hasCurrentRecurrence(localContext) &&
      (NON_CURRENT.test(localContext) ||
        HISTORICAL_PREFIX.test(localBefore) ||
        REPORTED_OR_PAST_PREFIX.test(localBefore));
    decisions.push({
      mention,
      negated,
      historical,
      affirmativeCurrent: !negated && !historical,
    });
  });
  return decisions;
}

/**
 * Returns current, affirmative, clause-local emergency evidence from a
 * customer transcript turn. Non-customer and unknown roles default closed.
 */
function detectEmergencyEvidence(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  for (const turn of turns) {
    if (!turn || !isCustomerSpeaker(turn.speaker) || typeof turn.text !== 'string') continue;
    const clauses = splitClauses(turn.text);
    for (const clause of clauses) {
      const affirmative = analyzeMentions(clause).find(function (decision) {
        return decision.affirmativeCurrent;
      });
      if (affirmative) {
        return {
          isEmergency: true,
          signal: affirmative.mention.signal,
          evidence: clause,
        };
      }
    }
  }
  return {
    isEmergency: false,
    signal: null,
    evidence: null,
  };
}

module.exports = {
  detectEmergencyEvidence,
  isCustomerSpeaker,
  normalizeSpeakerRole,
};
