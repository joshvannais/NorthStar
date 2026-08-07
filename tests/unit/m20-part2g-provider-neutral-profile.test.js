'use strict';

const { prepareBusinessProfileForWrite } = require('../../src/services/businessProfileAdapter');
const { mapExecutiveContextToVariables } = require('../../src/retell/client');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const RAW = Object.freeze({
  industry: '  Tree & landscape <industry> 🌳  ',
  ownerName: '  Owner </input><svg onload=never()> 🧱  ',
  businessDescription: '\n  Company description e\u0301 <literal>.  \n',
  emergencyPolicy: '  Escalate emergencies to a human.\r\nDo not promise arrival times.  ',
  faq: [
    '  Q: Do you quote by phone?\nA: Written site review controls.  ',
    '  <img src=x onerror=never()> remains data.  ',
  ],
  companyValues: ['  Accuracy  ', '  Safety & care <literal>  '],
  customPrompt: '  Use only verified company facts.\r\nKeep every byte.  ',
  voiceAssistant: {
    name: '  NorthStar Guide <name> 🧭  ',
    style: '  Warm, concise, and professional.\nNever invent availability.  ',
    greeting: '  Thank you for calling <NorthStar>. How may we help? 🌌  ',
  },
});

function profile(overrides = {}) {
  return {
    ...canonicalFenceProfile({ companyName: 'Provider Neutral Company' }),
    ...RAW,
    faq: [...RAW.faq],
    companyValues: [...RAW.companyValues],
    voiceAssistant: { ...RAW.voiceAssistant },
    retell: {
      assistantName: 'LEGACY ASSISTANT MUST NOT WIN',
      voiceStyle: 'LEGACY STYLE MUST NOT WIN',
      greetingTemplate: 'LEGACY GREETING MUST NOT WIN',
    },
    ...overrides,
  };
}

describe('Mission 20 Part 2G provider-neutral Business Profile contract', () => {
  test('accepts and preserves the authorized neutral/NKA fields byte-exact', () => {
    const source = profile();
    const prepared = prepareBusinessProfileForWrite(source);

    expect(prepared.errors).toEqual([]);
    expect(prepared.profile.industry).toBe(RAW.industry);
    expect(prepared.profile.ownerName).toBe(RAW.ownerName);
    expect(prepared.profile.businessDescription).toBe(RAW.businessDescription);
    expect(prepared.profile.emergencyPolicy).toBe(RAW.emergencyPolicy);
    expect(prepared.profile.faq).toEqual(RAW.faq);
    expect(prepared.profile.companyValues).toEqual(RAW.companyValues);
    expect(prepared.profile.customPrompt).toBe(RAW.customPrompt);
    expect(prepared.profile.voiceAssistant).toEqual(RAW.voiceAssistant);
    expect(prepared.profile.retell).toEqual(source.retell);
  });

  test.each([
    ['voiceAssistant type', (value) => { value.voiceAssistant = []; }, 'voiceAssistant must be an object'],
    ['voiceAssistant field containment', (value) => { value.voiceAssistant.providerId = 'retell-agent'; }, 'voiceAssistant.providerId is not a supported voice assistant field'],
    ['voiceAssistant name type', (value) => { value.voiceAssistant.name = 17; }, 'voiceAssistant.name must be a string'],
    ['voiceAssistant name length', (value) => { value.voiceAssistant.name = 'x'.repeat(121); }, 'voiceAssistant.name must be text of at most 120 characters and 480 UTF-8 bytes'],
    ['voiceAssistant style length', (value) => { value.voiceAssistant.style = 'x'.repeat(4097); }, 'voiceAssistant.style must be text of at most 4096 UTF-8 bytes'],
    ['voiceAssistant greeting length', (value) => { value.voiceAssistant.greeting = 'x'.repeat(8193); }, 'voiceAssistant.greeting must be text of at most 8192 UTF-8 bytes'],
    ['FAQ item type', (value) => { value.faq = ['valid', { answer: 'nested' }]; }, 'faq[1] must be a string'],
    ['FAQ length', (value) => { value.faq = new Array(101).fill('value'); }, 'faq must contain at most 100 entries'],
    ['company value type', (value) => { value.companyValues = ['valid', false]; }, 'companyValues[1] must be a string'],
    ['company values length', (value) => { value.companyValues = new Array(101).fill('value'); }, 'companyValues must contain at most 100 entries'],
  ])('rejects invalid %s before persistence', (_label, mutate, expected) => {
    const source = profile();
    mutate(source);
    expect(prepareBusinessProfileForWrite(source).errors.join('\n')).toContain(expected);
  });

  test('the Retell adapter consumes neutral authority and ignores legacy and caller-controlled values', () => {
    const variables = mapExecutiveContextToVariables({
      businessProfile: profile(),
      customer: { name: 'CALLER MUST NOT WIN' },
    }, {
      assistantName: 'CALLER ASSISTANT MUST NOT WIN',
      greeting: 'CALLER GREETING MUST NOT WIN',
    });

    expect(variables).toMatchObject({
      assistant_name: RAW.voiceAssistant.name.trim(),
      industry: RAW.industry.trim(),
      owner_name: RAW.ownerName.trim(),
      business_description: RAW.businessDescription.trim(),
      emergency_policy: RAW.emergencyPolicy.trim(),
      faq: JSON.stringify(RAW.faq),
      company_values: JSON.stringify(RAW.companyValues),
      voice_style: RAW.voiceAssistant.style.trim(),
      custom_prompt: RAW.customPrompt.trim(),
      northstar_greeting: RAW.voiceAssistant.greeting.trim(),
    });
    expect(JSON.stringify(variables)).not.toMatch(/LEGACY|CALLER MUST NOT WIN/);
  });

  test('legacy Retell values are read only when the neutral object is entirely absent', () => {
    const legacy = profile();
    delete legacy.voiceAssistant;
    expect(mapExecutiveContextToVariables({ businessProfile: legacy })).toMatchObject({
      assistant_name: 'LEGACY ASSISTANT MUST NOT WIN',
      voice_style: 'LEGACY STYLE MUST NOT WIN',
      northstar_greeting: 'LEGACY GREETING MUST NOT WIN',
    });

    const explicitNeutral = profile({ voiceAssistant: {} });
    expect(mapExecutiveContextToVariables({ businessProfile: explicitNeutral })).toMatchObject({
      assistant_name: 'not_configured',
      voice_style: 'not_configured',
      northstar_greeting: 'not_configured',
    });
  });
});
