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
    regex: /\b(?:flood|flooding|room is filling with water|water is (?:rising|pouring)|water keeps (?:rising|pouring))\b/i,
  },
  {
    signal: 'uncontrolled leak',
    regex: /\b(?:uncontrolled leak|gushing|burst pipe|pipe (?:has )?burst|active leak|(?:i |we )?(?:can't|cannot|couldn't|could not) (?:get (?:it|the leak) to stop|stop (?:it|the leak))|leak(?:ing)? (?:and )?(?:i |we )?(?:can't|cannot|couldn't|could not) (?:get it to )?stop)\b/i,
  },
  {
    signal: 'electrical sparking',
    regex: /\b(?:sparking|throwing sparks|seeing sparks)\b/i,
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

const NON_CURRENT = /\b(?:stopped|resolved|already fixed|fixed now|repaired|under control|shut (?:it|the (?:water|valve)) off|no longer|used to|previously|last (?:week|month|year)|yesterday(?: only)?|can wait|tomorrow is fine|next day is fine|slow (?:drip|leak)|minor (?:drip|leak)|seeping|has not returned|hasn't returned)\b/i;
const LOCAL_NEGATION = /\b(?:no|not|nothing|isn't|aren't|wasn't|weren't|is not|are not|was not|were not|without)\b[^,.;!?]*$/i;

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
    .map(function (value) {
      return value.trim().replace(/^,+|,+$/g, '').trim();
    })
    .filter(Boolean);
}

function isDenied(clause, match) {
  const before = clause.slice(0, match.index);
  return LOCAL_NEGATION.test(before) || NON_CURRENT.test(clause);
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
      for (const pattern of HAZARD_PATTERNS) {
        const match = clause.match(pattern.regex);
        if (match && !isDenied(clause, match)) {
          return {
            isEmergency: true,
            signal: pattern.signal,
            evidence: clause,
          };
        }
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
