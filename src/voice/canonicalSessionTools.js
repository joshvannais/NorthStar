'use strict';

const { authorityError } = require('../services/organizationAuthority');
const { stableValue } = require('../services/businessProfileAdapter');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function strictFinancialState(source, key, maximum) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) {
    return Object.freeze({ status: 'not_configured', value: null });
  }
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      (maximum !== undefined && value > maximum)) {
    return Object.freeze({ status: 'unavailable', value: null });
  }
  return Object.freeze({ status: 'configured', value });
}

function minimumJobPriceState(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const canonicalPricing = source.canonicalPricing && typeof source.canonicalPricing === 'object' &&
    !Array.isArray(source.canonicalPricing) ? source.canonicalPricing : null;
  return strictFinancialState(canonicalPricing, 'minimumJobPrice');
}

function money(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function hoursAnswer(hours) {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) {
    return 'Business hours are not configured in the pinned Business Profile. A team member must confirm availability.';
  }
  const configured = Object.keys(hours).sort().filter(function (day) {
    const entry = hours[day];
    return entry && typeof entry === 'object' && typeof entry.open === 'string' &&
      entry.open.trim() && typeof entry.close === 'string' && entry.close.trim();
  }).map(function (day) {
    return day + ' ' + hours[day].open.trim() + '-' + hours[day].close.trim();
  });
  return configured.length
    ? 'The pinned Business Profile lists these hours: ' + configured.join(', ') + '. Availability still requires confirmation.'
    : 'Business hours are not configured in the pinned Business Profile. A team member must confirm availability.';
}

function buildFaq(profile, authority, input) {
  const question = input && typeof input.question === 'string' ? input.question.trim().toLowerCase() : '';
  const pricing = minimumJobPriceState(profile);
  let answer;
  let topic = 'unmatched';
  if (!question) {
    answer = 'Please clarify the question. The answer must come from the pinned Business Profile.';
  } else if (/\b(cost|price|pricing|minimum|estimate|quote|rate)\b/.test(question)) {
    topic = 'pricing';
    answer = pricing.status === 'configured'
      ? 'The pinned Business Profile minimum job price is $' + money(pricing.value) + '. This is not a quote; exact pricing requires a written canonical estimate.'
      : (pricing.status === 'not_configured'
        ? 'Minimum job pricing is not configured in the pinned Business Profile. Do not quote a minimum; provide a written canonical estimate.'
        : 'Minimum job pricing is unavailable because the pinned Business Profile value is invalid. Do not quote a minimum; provide a written canonical estimate.');
  } else if (/\b(hours|open|close|availability)\b/.test(question)) {
    topic = 'hours';
    answer = hoursAnswer(profile.hours);
  } else if (/\b(company|business|name|who are you)\b/.test(question)) {
    topic = 'company';
    const companyName = profile.company && typeof profile.company.name === 'string' && profile.company.name.trim()
      ? profile.company.name.trim() : null;
    answer = companyName
      ? 'The pinned Business Profile identifies the company as ' + companyName + '.'
      : 'The company name is not configured in the pinned Business Profile.';
  } else {
    answer = 'That answer is not configured in the pinned Business Profile. A team member must follow up.';
  }
  return deepFreeze({
    answer,
    topic,
    matched: topic !== 'unmatched',
    minimumJobPrice: pricing,
    authority,
  });
}

const FAQ_DEFINITION = deepFreeze({
  type: 'function',
  function: {
    name: 'getFAQ',
    description: 'Answer only from this voice session pinned Business Profile. Pricing is unavailable unless canonical minimumJobPrice is explicitly configured.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The customer question to answer from pinned profile data.' },
      },
      required: ['question'],
    },
  },
});

function createSessionScopedCanonicalTools(input) {
  const source = input || {};
  const organizationId = String(source.organizationId || '').trim();
  const voiceSessionId = String(source.voiceSessionId || '').trim();
  const profile = source.profile;
  if (!organizationId || !voiceSessionId || !profile || !profile.id || !profile.versionLabel || !profile.profileHash) {
    throw authorityError('VOICE_TOOL_AUTHORITY_REQUIRED', 'Pinned voice-tool authority is required.', 503);
  }
  const rawProfile = deepFreeze(stableValue(profile.rawProfile || {}));
  const authority = deepFreeze({
    organizationId,
    voiceSessionId,
    profileId: String(profile.id),
    profileVersion: String(profile.versionLabel),
    profileHash: String(profile.profileHash),
    source: 'canonical_business_profiles',
  });

  function requireScope(context) {
    if (!context || String(context.organizationId || '') !== organizationId ||
        String(context.voiceSessionId || '') !== voiceSessionId) {
      throw authorityError('VOICE_TOOL_SCOPE_MISMATCH', 'Voice-tool execution is outside the pinned organization session.', 403);
    }
  }

  const handlers = deepFreeze({
    getFAQ(args, context) {
      requireScope(context);
      return buildFaq(rawProfile, authority, args);
    },
  });
  const definitions = deepFreeze([FAQ_DEFINITION]);
  return deepFreeze({
    authority,
    definitions,
    handlers,
    execute(name, args, context) {
      requireScope(context);
      if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
        throw authorityError('VOICE_TOOL_UNAVAILABLE', 'The requested voice tool is not available for this session.', 404);
      }
      return handlers[name](args || {}, context);
    },
  });
}

module.exports = {
  createSessionScopedCanonicalTools,
  minimumJobPriceState,
};
