'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const {
  createSessionScopedCanonicalTools,
  minimumJobPriceState,
} = require('../../src/voice/canonicalSessionTools');

function profile(minimumJobPrice, options) {
  const canonicalPricing = {};
  if (minimumJobPrice !== undefined) canonicalPricing.minimumJobPrice = minimumJobPrice;
  return {
    id: (options && options.id) || '51000000-0000-0000-0000-000000000001',
    versionLabel: (options && options.version) || 'org-profile-v7',
    profileHash: (options && options.hash) || 'a'.repeat(64),
    rawProfile: {
      company: { name: (options && options.company) || 'Pinned Voice Company' },
      financial: { minimumJobPrice: 999 },
      canonicalPricing,
    },
  };
}

function tools(pinned, organizationId, voiceSessionId) {
  return createSessionScopedCanonicalTools({
    organizationId: organizationId || '52000000-0000-0000-0000-000000000001',
    voiceSessionId: voiceSessionId || '53000000-0000-0000-0000-000000000001',
    profile: pinned,
  });
}

function invoke(instance, question) {
  return instance.execute('getFAQ', { question }, {
    organizationId: instance.authority.organizationId,
    voiceSessionId: instance.authority.voiceSessionId,
  });
}

describe('Mission 19 Part 3 session-scoped canonical voice tools', () => {
  test('zero, positive, missing, and malformed minimum prices remain exact', () => {
    const zero = tools(profile(0));
    expect(minimumJobPriceState(profile(0).rawProfile)).toEqual({ status: 'configured', value: 0 });
    expect(invoke(zero, 'What is the minimum price?')).toMatchObject({
      answer: expect.stringContaining('$0'),
      minimumJobPrice: { status: 'configured', value: 0 },
      authority: zero.authority,
    });

    const positive = tools(profile(275));
    expect(invoke(positive, 'How much does it cost?')).toMatchObject({
      answer: expect.stringContaining('$275'),
      minimumJobPrice: { status: 'configured', value: 275 },
    });

    const missing = tools(profile(undefined));
    expect(invoke(missing, 'Can you quote a minimum?')).toMatchObject({
      answer: expect.stringContaining('not configured'),
      minimumJobPrice: { status: 'not_configured', value: null },
    });
    expect(invoke(missing, 'Can you quote a minimum?').answer).not.toContain('$999');

    const malformed = tools(profile('150'));
    expect(invoke(malformed, 'What is your pricing?')).toMatchObject({
      answer: expect.stringContaining('unavailable'),
      minimumJobPrice: { status: 'unavailable', value: null },
    });
    expect(invoke(malformed, 'What is your pricing?').answer).not.toContain('$150');
  });

  test('definitions and execution are immutable and scoped to one organization session', () => {
    const organizationA = tools(profile(25, { company: 'Organization A' }));
    const organizationB = tools(profile(425, {
      id: '51000000-0000-0000-0000-000000000002',
      version: 'org-profile-v3',
      hash: 'b'.repeat(64),
      company: 'Organization B',
    }), '52000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000002');
    expect(organizationA.definitions.map((item) => item.function.name)).toEqual(['getFAQ']);
    expect(organizationB.definitions.map((item) => item.function.name)).toEqual(['getFAQ']);
    expect(invoke(organizationA, 'minimum price').answer).toContain('$25');
    expect(invoke(organizationB, 'minimum price').answer).toContain('$425');
    let scopeError;
    try {
      organizationA.execute('getFAQ', { question: 'minimum price' }, {
        organizationId: organizationB.authority.organizationId,
        voiceSessionId: organizationA.authority.voiceSessionId,
      });
    } catch (error) {
      scopeError = error;
    }
    expect(scopeError).toMatchObject({ code: 'VOICE_TOOL_SCOPE_MISMATCH', status: 403 });
    expect(Object.isFrozen(organizationA)).toBe(true);
    expect(Object.isFrozen(organizationA.definitions)).toBe(true);
    expect(Object.isFrozen(organizationA.handlers)).toBe(true);
  });

  test('canonical voice module startup does not load file-backed Business Profile or legacy tool registry', () => {
    const root = path.resolve(__dirname, '..', '..');
    const probe = [
      "require('./src/services/canonicalVoiceSessionCreation')",
      "const loaded=Object.keys(require.cache).map(p=>p.replace(/\\\\/g,'/'))",
      "const blocked=loaded.filter(p=>p.endsWith('/src/voice/toolRegistry.js')||p.endsWith('/src/services/businessProfile.js'))",
      'process.stdout.write(JSON.stringify(blocked))',
    ].join(';');
    const output = execFileSync(process.execPath, ['-e', probe], { cwd: root, encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(output)).toEqual([]);
  });

  test('intercepted Retell payload carries only canonical variables and the pinned safe tool definition', async () => {
    const originalKey = process.env.RETELL_API_KEY;
    const originalFetch = global.fetch;
    try {
      process.env.RETELL_API_KEY = 'intercepted-test-key';
      jest.resetModules();
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ call_id: 'intercepted-provider-call', call_status: 'registered' }),
      }));
      const retell = require('../../src/retell/client');
      const pinned = profile(0);
      const sessionTools = tools(pinned);
      await retell.createCall('+15555550101', 'persisted-agent-id', {
        fromNumber: '+15555550102',
        executiveContext: { businessProfile: pinned.rawProfile },
        toolDefinitions: sessionTools.definitions,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(payload.retell_llm_dynamic_variables.minimum_job_price).toBe('0');
      expect(payload.retell_llm_dynamic_variables.minimum_job_price_status).toBe('configured');
      expect(payload.retell_llm_dynamic_variables.pricing_rules).toContain('minimum_job_price=0 (configured)');
      expect(payload.retell_llm_tools.map((item) => item.function.name)).toEqual(['getFAQ']);
      expect(JSON.stringify(payload.retell_llm_tools)).not.toMatch(/\b999\b|\b150\b|dataLoader|businessProfile\.json/);
    } finally {
      global.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.RETELL_API_KEY;
      else process.env.RETELL_API_KEY = originalKey;
      jest.resetModules();
    }
  });
});
