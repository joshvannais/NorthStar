'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../../src/config');
const retell = require('../../src/retell/client');

const EXACT_PROMPT_VARIABLES = [
  'assistant_name',
  'company_name',
  'industry',
  'owner_name',
  'business_description',
  'website',
  'business_email',
  'business_phone',
  'business_hours',
  'emergency_policy',
  'service_area',
  'services',
  'pricing_rules',
  'scheduling_rules',
  'faq',
  'policies',
  'company_values',
  'voice_style',
  'custom_prompt',
  'northstar_greeting',
].sort();

function persistedProfile(overrides) {
  return {
    company: {
      name: 'Pinned Voice Company',
      industry: 'fencing',
      ownerName: 'Pinned Owner',
      description: 'Persisted canonical fencing profile.',
      website: 'https://pinned.example.test',
      email: 'voice@pinned.example.test',
      phone: '+15555550110',
    },
    hours: { monday: { open: '08:00', close: '17:00' } },
    emergencyPolicy: 'Emergency requests require human confirmation.',
    serviceArea: { counties: ['Pinned County'] },
    services: [{ id: 'fence', name: 'Fence installation' }],
    canonicalPricing: {
      minimumJobPrice: 0,
      emergencyMultiplier: 0,
      travelCustomerChargePerMile: 0,
      taxRatePercent: 0,
    },
    scheduling: { maxJobsPerDay: 0, leadTimeHours: 0 },
    faq: ['Estimates require site review.'],
    policies: { warranty: 'Written terms control.' },
    companyValues: ['Accuracy', 'Safety'],
    customPrompt: 'Use only verified persisted facts.',
    retell: {
      assistantName: 'Pinned Assistant',
      voiceStyle: 'direct and calm',
      greetingTemplate: 'Thank you for calling Pinned Voice Company.',
    },
    ...(overrides || {}),
  };
}

describe('Mission 19 Part 3 Retell Conversation Flow Agent contract', () => {
  test('maps the exact global prompt variables from the pinned profile without caller overrides', () => {
    expect([...retell.PROMPT_VARIABLE_KEYS].sort()).toEqual(EXACT_PROMPT_VARIABLES);
    const variables = retell.mapExecutiveContextToVariables({
      businessProfile: persistedProfile(),
      customer: { lead: { name: 'Confidential Caller', phone: '+15555550999' } },
      canonicalAuthority: { id: 'profile-secret', hash: 'hash-secret' },
    }, {
      service: 'Caller Controlled Service',
      caller: 'Caller Controlled Name',
    });
    expect(Object.keys(variables).sort()).toEqual(EXACT_PROMPT_VARIABLES);
    expect(variables).toMatchObject({
      assistant_name: 'Pinned Assistant',
      company_name: 'Pinned Voice Company',
      industry: 'fencing',
      owner_name: 'Pinned Owner',
      business_description: 'Persisted canonical fencing profile.',
      website: 'https://pinned.example.test',
      business_email: 'voice@pinned.example.test',
      business_phone: '+15555550110',
      business_hours: JSON.stringify({ monday: { open: '08:00', close: '17:00' } }),
      emergency_policy: 'Emergency requests require human confirmation.',
      service_area: JSON.stringify({ counties: ['Pinned County'] }),
      services: JSON.stringify([{ id: 'fence', name: 'Fence installation' }]),
      scheduling_rules: JSON.stringify({ maxJobsPerDay: 0, leadTimeHours: 0 }),
      faq: JSON.stringify(['Estimates require site review.']),
      policies: JSON.stringify({ warranty: 'Written terms control.' }),
      company_values: JSON.stringify(['Accuracy', 'Safety']),
      voice_style: 'direct and calm',
      custom_prompt: 'Use only verified persisted facts.',
      northstar_greeting: 'Thank you for calling Pinned Voice Company.',
    });
    expect(variables.pricing_rules).toContain('minimum_job_price=0 (configured)');
    expect(variables.pricing_rules).toContain('tax_rate=0 (configured)');
    expect(JSON.stringify(variables)).not.toMatch(/Confidential Caller|Caller Controlled|profile-secret|hash-secret/);
    expect(Object.values(variables).every((value) => typeof value === 'string')).toBe(true);
  });

  test('missing and malformed profile fields stay explicit without invented prompt defaults', () => {
    const missing = retell.mapExecutiveContextToVariables({ businessProfile: { company: {}, canonicalPricing: {} } });
    expect(Object.keys(missing).sort()).toEqual(EXACT_PROMPT_VARIABLES);
    for (const key of EXACT_PROMPT_VARIABLES.filter((key) => key !== 'pricing_rules')) {
      expect(missing[key]).toBe('not_configured');
    }
    expect(missing.pricing_rules).toContain('minimum_job_price=not_configured (not_configured)');
    expect(missing.pricing_rules).not.toMatch(/150|1\.5|0\.58|tax_rate=7/);

    const malformed = retell.mapExecutiveContextToVariables({
      businessProfile: {
        company: { name: Symbol('invalid') },
        services: () => [],
        canonicalPricing: {
          minimumJobPrice: '150',
          emergencyMultiplier: -1,
          travelCustomerChargePerMile: null,
          taxRatePercent: 101,
        },
      },
    });
    expect(malformed.company_name).toBe('unavailable');
    expect(malformed.services).toBe('unavailable');
    expect(malformed.pricing_rules).toContain('minimum_job_price=unavailable (unavailable)');
    expect(malformed.pricing_rules).toContain('tax_rate=unavailable (unavailable)');
  });

  test('intercepted outbound payload contains no tool, MCP, callback, file, or caller authority', async () => {
    const originalKey = config.retell.apiKey;
    const originalFetch = global.fetch;
    try {
      config.retell.apiKey = 'intercepted-test-key';
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ call_id: 'intercepted-provider-call', call_status: 'registered' }),
      }));
      await retell.createCall('+15555550101', 'persisted-agent-id', {
        fromNumber: '+15555550102',
        executiveContext: { businessProfile: persistedProfile() },
        service: 'Hostile caller service',
        caller: 'Hostile caller name',
        webhookUrl: 'https://hostile.example.test/callback',
        toolDefinitions: [{ function: { name: 'getFAQ' } }],
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(Object.keys(payload).sort()).toEqual([
        'agent_id', 'from_number', 'retell_llm_dynamic_variables', 'to_number',
      ]);
      expect(Object.keys(payload.retell_llm_dynamic_variables).sort()).toEqual(EXACT_PROMPT_VARIABLES);
      expect(payload.retell_llm_dynamic_variables.pricing_rules).toContain('minimum_job_price=0 (configured)');
      expect(JSON.stringify(payload)).not.toMatch(/getFAQ|retell_llm_tools|mcp|callback|Hostile caller|businessProfile\.json|dataLoader/);
    } finally {
      global.fetch = originalFetch;
      config.retell.apiKey = originalKey;
    }
  });

  test('canonical startup and mounted provider client have no phantom tool dependency', () => {
    const root = path.resolve(__dirname, '..', '..');
    const probe = [
      "require('./src/services/canonicalVoiceSessionCreation')",
      "const loaded=Object.keys(require.cache).map(p=>p.replace(/\\\\/g,'/'))",
      "const blocked=loaded.filter(p=>p.endsWith('/src/voice/toolRegistry.js')||p.endsWith('/src/voice/canonicalSessionTools.js')||p.endsWith('/src/services/businessProfile.js'))",
      'process.stdout.write(JSON.stringify(blocked))',
    ].join(';');
    const output = execFileSync(process.execPath, ['-e', probe], { cwd: root, encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(output)).toEqual([]);
    expect(fs.existsSync(path.join(root, 'src', 'voice', 'canonicalSessionTools.js'))).toBe(false);
    const clientSource = fs.readFileSync(path.join(root, 'src', 'retell', 'client.js'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(root, 'src', 'services', 'canonicalVoiceSessionCreation.js'), 'utf8');
    expect(clientSource).not.toMatch(/retell_llm_tools|createAgentWithTools|webhook_url/);
    expect(serviceSource).not.toMatch(/getFAQ|canonicalSessionTools|sessionTools|toolDefinitions/);
  });
});
