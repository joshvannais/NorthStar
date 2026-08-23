'use strict';

const fs = require('fs');
const path = require('path');
const { prepareBusinessProfileForWrite } = require('../../src/services/businessProfileAdapter');
const { mapExecutiveContextToVariables, PROMPT_VARIABLE_KEYS } = require('../../src/retell/client');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const RAW_RULE_TEXT = '  If the caller asks for <transfer>\r\nkeep e\u0301 and markup literal.  ';
const LEGACY = Object.freeze({
  assistantName: 'Legacy assistant',
  brandName: 'Legacy brand',
  voiceStyle: 'Legacy voice style',
  brandVoice: 'Legacy brand voice',
  greetingTemplate: 'Legacy greeting',
});
const ROOT = path.resolve(__dirname, '..', '..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function validVoice() {
  return {
    name: '  NorthStar Guide <literal> 🧭  ',
    style: '  Calm, precise, and concise.\r\nPreserve these bytes.  ',
    greeting: '  Welcome to <NorthStar> e\u0301.  ',
    personality: 'consultative',
    conversationStyle: 'warm',
    escalationRules: {
      rules: [
        { id: 'urgent-first', enabled: true, when: RAW_RULE_TEXT, action: 'transfer_if_available', fallbackAction: 'request_callback' },
        { id: 'message-second', enabled: false, when: '  Otherwise take a message.  ', action: 'take_message', fallbackAction: 'take_message' },
      ],
    },
  };
}

function profile(voice) {
  const resolvedVoice = arguments.length === 0 ? validVoice() : voice;
  return {
    ...canonicalFenceProfile({ companyName: 'Phase 3A Company' }),
    retell: { ...LEGACY },
    ...(resolvedVoice === undefined ? {} : { voiceAssistant: resolvedVoice }),
  };
}

function invalid(mutate) {
  const source = profile();
  mutate(source);
  return prepareBusinessProfileForWrite(source);
}

describe('Mission 20 Phase 3A provider-neutral AI configuration contract', () => {
  test('preserves every authorized raw value, ordered stable rule, and legacy byte', () => {
    const source = profile();
    const prepared = prepareBusinessProfileForWrite(source);

    expect(prepared.errors).toEqual([]);
    expect(prepared.profile.voiceAssistant).toEqual(validVoice());
    expect(prepared.profile.voiceAssistant.escalationRules.rules.map(rule => rule.id)).toEqual([
      'urgent-first', 'message-second',
    ]);
    expect(prepared.profile.voiceAssistant.escalationRules.rules[0].when).toBe(RAW_RULE_TEXT);
    expect(prepared.profile.retell).toEqual(LEGACY);
  });

  test.each([
    ['voice container', value => { value.voiceAssistant = []; }, 'voiceAssistant must be an object'],
    ['voice unknown field', value => { value.voiceAssistant.providerId = 'forbidden'; }, 'providerId is not a supported voice assistant field'],
    ['personality blank', value => { value.voiceAssistant.personality = ''; }, 'voiceAssistant.personality must be'],
    ['personality enum', value => { value.voiceAssistant.personality = 'salesy'; }, 'voiceAssistant.personality must be'],
    ['conversation enum', value => { value.voiceAssistant.conversationStyle = 'imitate-human'; }, 'voiceAssistant.conversationStyle must be'],
    ['rules container', value => { value.voiceAssistant.escalationRules = []; }, 'voiceAssistant.escalationRules must be an object'],
    ['rules unknown field', value => { value.voiceAssistant.escalationRules.provider = 'retell'; }, 'provider is not a supported escalation rules field'],
    ['rules array required', value => { delete value.voiceAssistant.escalationRules.rules; }, 'voiceAssistant.escalationRules.rules must be an array'],
    ['rules maximum', value => { value.voiceAssistant.escalationRules.rules = new Array(21).fill(null).map((_, index) => ({ id: `rule-${index}`, enabled: true, when: 'condition', action: 'take_message', fallbackAction: 'take_message' })); }, 'at most 20 entries'],
    ['rule container', value => { value.voiceAssistant.escalationRules.rules[0] = 'rule'; }, 'rules[0] must be an object'],
    ['rule unknown field', value => { value.voiceAssistant.escalationRules.rules[0].destination = '+15550000000'; }, 'destination is not a supported escalation rule field'],
    ['rule id required', value => { delete value.voiceAssistant.escalationRules.rules[0].id; }, '.id must be a stable identifier'],
    ['rule id invalid', value => { value.voiceAssistant.escalationRules.rules[0].id = 'bad id'; }, '.id must be a stable identifier'],
    ['rule id duplicate', value => { value.voiceAssistant.escalationRules.rules[1].id = 'URGENT-FIRST'; }, 'duplicate id URGENT-FIRST'],
    ['rule enabled', value => { value.voiceAssistant.escalationRules.rules[0].enabled = 'yes'; }, '.enabled must be a boolean'],
    ['rule when missing', value => { delete value.voiceAssistant.escalationRules.rules[0].when; }, '.when must be non-blank text'],
    ['rule when blank', value => { value.voiceAssistant.escalationRules.rules[0].when = ' \r\n '; }, '.when must be non-blank text'],
    ['rule when characters', value => { value.voiceAssistant.escalationRules.rules[0].when = 'x'.repeat(513); }, 'at most 512 characters and 2048 UTF-8 bytes'],
    ['rule when bytes', value => { value.voiceAssistant.escalationRules.rules[0].when = '🧭'.repeat(513); }, 'at most 512 characters and 2048 UTF-8 bytes'],
    ['rule action required', value => { delete value.voiceAssistant.escalationRules.rules[0].action; }, '.action must be take_message'],
    ['rule action enum', value => { value.voiceAssistant.escalationRules.rules[0].action = 'dispatch_crew'; }, '.action must be take_message'],
    ['rule fallback required', value => { delete value.voiceAssistant.escalationRules.rules[0].fallbackAction; }, '.fallbackAction must be take_message'],
    ['rule fallback enum', value => { value.voiceAssistant.escalationRules.rules[0].fallbackAction = 'transfer_if_available'; }, '.fallbackAction must be take_message'],
  ])('rejects %s before persistence', (_label, mutate, expected) => {
    const prepared = invalid(mutate);
    expect(prepared.profile).toBeNull();
    expect(prepared.errors.join('\n')).toContain(expected);
  });

  test('accepts every authorized action and fallback without normalizing rule order or text', () => {
    const actions = ['take_message', 'request_callback', 'transfer_if_available'];
    const fallbacks = ['take_message', 'request_callback'];
    for (const action of actions) {
      for (const fallbackAction of fallbacks) {
        const voice = validVoice();
        voice.escalationRules.rules = [{ id: `${action}-${fallbackAction}`, enabled: false, when: RAW_RULE_TEXT, action, fallbackAction }];
        const prepared = prepareBusinessProfileForWrite(profile(voice));
        expect(prepared.errors).toEqual([]);
        expect(prepared.profile.voiceAssistant.escalationRules.rules[0]).toEqual(voice.escalationRules.rules[0]);
      }
    }
  });

  test('distinguishes absence, explicit neutral authority, and optional fields', () => {
    const absent = profile(undefined);
    const absentPrepared = prepareBusinessProfileForWrite(absent);
    expect(absentPrepared.errors).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(absentPrepared.profile, 'voiceAssistant')).toBe(false);

    const explicit = prepareBusinessProfileForWrite(profile({}));
    expect(explicit.errors).toEqual([]);
    expect(explicit.profile.voiceAssistant).toEqual({});

    const basics = prepareBusinessProfileForWrite(profile({ name: 'Name', style: 'Style', greeting: 'Greeting' }));
    expect(basics.errors).toEqual([]);
    expect(basics.profile.voiceAssistant).toEqual({ name: 'Name', style: 'Style', greeting: 'Greeting' });
  });

  test('keeps the exact existing provider variable contract and excludes new policy fields', () => {
    const variables = mapExecutiveContextToVariables({ businessProfile: profile() });
    expect(Object.keys(variables)).toEqual(PROMPT_VARIABLE_KEYS);
    expect(variables).toMatchObject({
      assistant_name: validVoice().name.trim(),
      voice_style: validVoice().style.trim(),
      northstar_greeting: validVoice().greeting.trim(),
    });
    const serialized = JSON.stringify(variables);
    expect(serialized).not.toContain('consultative');
    expect(serialized).not.toContain('urgent-first');
    expect(serialized).not.toContain(RAW_RULE_TEXT.trim());
  });

  test('uses legacy fallback only when neutral authority is absent', () => {
    expect(mapExecutiveContextToVariables({ businessProfile: profile(undefined) })).toMatchObject({
      assistant_name: LEGACY.assistantName,
      voice_style: LEGACY.voiceStyle,
      northstar_greeting: LEGACY.greetingTemplate,
    });
    for (const neutral of [{}, { personality: 'professional' }]) {
      expect(mapExecutiveContextToVariables({ businessProfile: profile(neutral) })).toMatchObject({
        assistant_name: 'not_configured', voice_style: 'not_configured', northstar_greeting: 'not_configured',
      });
    }
  });

  test('the mounted UI has one canonical editor, literal preview, and gateway-only secondary surfaces', () => {
    const businessProfile = source('public/dashboard/business-profile.html');
    const settings = source('public/dashboard/settings.html');

    expect(businessProfile).toContain("profileRequest('/api/v1/business-profile/voiceAssistant'");
    expect(businessProfile).toMatch(/JSON\.stringify\(\{ expectedVersion: expectedVersion, value: value \}\)/);
    expect(businessProfile).toMatch(/function collectProfile\(\)[\s\S]*return p;/);
    const collectStart = businessProfile.indexOf('function collectProfile()');
    const collectEnd = businessProfile.indexOf('function getVal(', collectStart);
    const collectProfile = businessProfile.slice(collectStart, collectEnd);
    expect(collectProfile).not.toMatch(/p\.voiceAssistant\s*=/);
    expect(businessProfile).toMatch(/function updateVoiceCountersAndPreview\(\)[\s\S]*preview\.textContent = greeting/);
    expect(businessProfile).toMatch(/function insertSavedCompanyName\(\)[\s\S]*setRangeText\(companyName/);
    expect(businessProfile).toMatch(/function renderVoiceAssistant\(profile\)[\s\S]*hasOwn\(profile, 'voiceAssistant'\)/);
    expect(businessProfile).not.toMatch(/recording disclosure|AI identity/i);

    expect(settings).toContain('id="ai-settings"');
    expect(settings).toContain('<h2>AI Settings</h2>');
    expect(settings).toContain('/dashboard/business-profile?section=retell#voice-assistant-configuration');
    expect(settings).not.toMatch(/id=["']greeting["']|Rachel \(|1 voice/);
    expect(settings).toMatch(/const settings = writableSettings\(settingsState\);/);
    expect(settings).not.toMatch(/const fields = \[[^\]]*'greeting'/);
  });
});
