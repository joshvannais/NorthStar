'use strict';

const CUSTOMER_SPEAKERS = new Set(['customer', 'caller', 'client', 'homeowner', 'user']);

const SIGNALS = Object.freeze([
  { signal: 'explicit emergency', regex: /\bemergency\b/i },
  { signal: 'active flooding', regex: /\b(?:flood|flooded|flooding|water (?:is|keeps) (?:rising|pouring)|filling with water)\b/i },
  { signal: 'uncontrolled leak', regex: /\b(?:uncontrolled leak|gushing|burst pipe|pipe (?:has )?burst|active leak|leak(?:ed|ing)?|can't stop (?:it|the leak)|cannot stop (?:it|the leak))\b/i },
  { signal: 'electrical sparking', regex: /\b(?:spark|sparks|sparked|sparking|throwing sparks|seeing sparks)\b/i },
  { signal: 'burning or smoke', regex: /\b(?:fire|burning smell|smell(?:s|ing)? (?:like |something )?burning|smoke|smoking)\b/i },
  { signal: 'immediate danger', regex: /\b(?:immediate danger|danger right now|unsafe right now|someone (?:is|could be) in danger)\b/i },
]);

const NEGATION = /\b(?:no|not|never|nothing|without|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|hasn't|hasnt|haven't|havent|cannot|can't|cant|couldn't|couldnt)\b/gi;
const NON_CURRENT = /\b(?:stopped|resolved|fixed|repaired|under control|shut (?:it|the (?:water|valve)) off|no longer|used to|previously|last (?:week|month|year)|yesterday|can wait|slow (?:drip|leak)|minor (?:drip|leak)|has not returned|hasn't returned|floor is drying|fine now)\b/i;
const PAST_PREFIX = /\b(?:there (?:was|were)|was|were|had been|used to|previously|reported|said|told (?:us|me|them)|asked (?:whether|if))\b/i;
const CURRENT = /\b(?:right now|currently|still|keeps?|again|back|returned)\b/i;

function normalizeSpeaker(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isCustomerSpeaker(value) {
  return CUSTOMER_SPEAKERS.has(normalizeSpeaker(value));
}

function splitClauses(text) {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .split(/[.!?;]+|\b(?:but|however|although|yet)\b/i)
    .map(function (clause) { return clause.trim().replace(/^,+|,+$/g, '').trim(); })
    .filter(Boolean);
}

function countNegations(text) {
  const matches = String(text || '').match(NEGATION);
  NEGATION.lastIndex = 0;
  return matches ? matches.length : 0;
}

function mentionDecision(before, mentionText, after) {
  const context = before + mentionText + after;
  const negated = countNegations(before) % 2 === 1;
  const currentRecurrence = CURRENT.test(context) && !/\b(?:has not|hasn't|never)\s+returned\b/i.test(context);
  const historical = !currentRecurrence && (NON_CURRENT.test(context) || PAST_PREFIX.test(before));
  return { negated, historical };
}

function allMentions(clause) {
  const mentions = [];
  SIGNALS.forEach(function (entry) {
    const flags = entry.regex.flags.includes('g') ? entry.regex.flags : entry.regex.flags + 'g';
    const regex = new RegExp(entry.regex.source, flags);
    let match;
    while ((match = regex.exec(clause)) !== null) {
      mentions.push({ signal: entry.signal, index: match.index, text: match[0], end: match.index + match[0].length });
      if (!match[0].length) regex.lastIndex += 1;
    }
  });
  return mentions.sort(function (left, right) { return left.index - right.index || right.end - left.end; })
    .filter(function (mention, index, ordered) { return index === 0 || mention.index >= ordered[index - 1].end; });
}

/**
 * Detect current affirmative emergency evidence. Only customer turns are
 * eligible, and negation/history is evaluated within the containing clause.
 *
 * @param {Array<{speaker?: string, text?: string, utterance?: string, turnId?: string}>} transcript
 * @returns {{isEmergency: boolean, signal: string|null, evidence: string|null, turnId: string|null}}
 */
function detectEmergencyEvidence(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  for (const turn of turns) {
    if (!turn || !isCustomerSpeaker(turn.speaker)) continue;
    const text = typeof turn.text === 'string' ? turn.text : turn.utterance;
    if (typeof text !== 'string') continue;
    for (const clause of splitClauses(text)) {
      const mentions = allMentions(clause);
      for (let index = 0; index < mentions.length; index += 1) {
        const mention = mentions[index];
        const previous = index > 0 ? mentions[index - 1] : null;
        const next = index + 1 < mentions.length ? mentions[index + 1] : null;
        const before = clause.slice(previous ? previous.end : 0, mention.index);
        const after = clause.slice(mention.end, next ? next.index : clause.length);
        const decision = mentionDecision(before, mention.text, after);
        if (!decision.negated && !decision.historical) {
          return {
            isEmergency: true,
            signal: mention.signal,
            evidence: clause,
            turnId: turn.turnId || null,
          };
        }
      }
    }
  }
  return { isEmergency: false, signal: null, evidence: null, turnId: null };
}

module.exports = {
  detectEmergencyEvidence,
  isCustomerSpeaker,
  normalizeSpeaker,
  splitClauses,
};
