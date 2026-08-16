'use strict';

const crypto = require('crypto');
const {
  BASIC_STORAGE,
  HomepageWebCallService,
  MAX_TRANSCRIPT_TURNS,
  calculateHomepagePolaris,
  normalizeTranscript,
  verifiedPurgeReceipt,
  verifyPurgeToken,
} = require('../../src/services/homepageWebCall');

function readySettings(overrides = {}) {
  return Object.assign({
    enabled: true,
    legalApproved: true,
    providerApproved: true,
    webhookIsolationApproved: true,
  }, overrides);
}

function fakeRetell(overrides = {}) {
  return Object.assign({
    getAgent: jest.fn(async () => ({
      agent_id: 'agent_homepage',
      version: 7,
      data_storage_setting: 'basic_attributes_only',
      data_storage_retention_days: 1,
    })),
    createWebCall: jest.fn(async () => ({
      call_id: 'call_homepage_001',
      call_type: 'web_call',
      agent_id: 'agent_homepage',
      agent_version: 7,
      access_token: 'temporary-browser-token',
      data_storage_setting: 'basic_attributes_only',
    })),
    stopCall: jest.fn(async () => null),
    deleteCall: jest.fn(async () => null),
    getCall: jest.fn(async () => {
      const error = new Error('not found');
      error.code = 'RETELL_CALL_NOT_FOUND';
      throw error;
    }),
  }, overrides);
}

describe('Homepage browser Web Call service', () => {
  const secret = 'homepage-test-secret-'.padEnd(64, 'x');
  const provider = { apiKey: 'test-only-key', agentId: 'agent_homepage' };
  const fixedNow = new Date('2026-08-16T12:00:00.000Z');

  test('every source, legal, provider, privacy, and purge gate fails closed', () => {
    const unavailable = new HomepageWebCallService({
      settings: readySettings({ legalApproved: false }),
      provider,
      secret,
    }).availability();
    expect(unavailable).toEqual(expect.objectContaining({
      available: false,
      state: 'approval_or_configuration_required',
      storageRequirement: BASIC_STORAGE,
      retentionRequirementDays: 1,
    }));
    expect(unavailable.missing).toContain('attorney_approval');

    const missingProvider = new HomepageWebCallService({
      settings: readySettings(),
      provider: {},
      secret: 'short',
    }).availability();
    expect(missingProvider.missing).toEqual(expect.arrayContaining(['provider_configuration', 'purge_authority']));
  });

  test('create verifies the existing agent, passes only generic variables, and returns signed temporary authority', async () => {
    const retell = fakeRetell();
    const service = new HomepageWebCallService({
      retellClient: retell,
      settings: readySettings(),
      provider,
      secret,
      now: () => fixedNow,
      randomBytes: () => Buffer.alloc(16, 7),
    });
    const result = await service.create('Roofing');
    expect(retell.getAgent).toHaveBeenCalledWith('agent_homepage');
    expect(retell.createWebCall).toHaveBeenCalledWith('agent_homepage', expect.objectContaining({
      northstar_demo_mode: 'homepage_browser_web_call',
      northstar_demo_industry: 'Roofing',
      northstar_demo_consent_phrase: 'I consent to this AI demo and temporary recording',
    }), 7);
    const variables = retell.createWebCall.mock.calls[0][1];
    expect(Object.keys(variables).sort()).toEqual([
      'northstar_demo_consent_phrase',
      'northstar_demo_disclosure',
      'northstar_demo_industry',
      'northstar_demo_mode',
      'northstar_demo_webhook_contract',
      'northstar_demo_sensitive_data_rule',
    ].sort());
    expect(variables).not.toHaveProperty('business_name');
    expect(variables).not.toHaveProperty('customer_name');
    expect(variables).not.toHaveProperty('phone_number');
    expect(variables).not.toHaveProperty('address');
    expect(variables).not.toHaveProperty('email');
    expect(result).toEqual(expect.objectContaining({
      callId: 'call_homepage_001',
      accessToken: 'temporary-browser-token',
      storage: 'basic_attributes_only',
      retentionDays: 1,
      verbalConsentPhrase: 'I consent to this AI demo and temporary recording',
      purgeToken: expect.any(String),
    }));
    expect(verifyPurgeToken(result.purgeToken, result.callId, secret, fixedNow)).toEqual(expect.objectContaining({
      version: 1,
      callId: result.callId,
    }));
    expect(service.verifyCallAuthority(result.callId, result.purgeToken)).toEqual(expect.objectContaining({
      version: 1,
      callId: result.callId,
      expiresAt: fixedNow.getTime() + (15 * 60 * 1000),
      capabilityHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  test('purge capability identity is stable per signed token and distinct across tokens', async () => {
    let nonce = 0;
    const service = new HomepageWebCallService({
      retellClient: fakeRetell(),
      settings: readySettings(),
      provider,
      secret,
      now: () => fixedNow,
      randomBytes: () => Buffer.alloc(16, ++nonce),
    });
    const first = await service.create('HVAC');
    const second = await service.create('HVAC');
    const firstAuthority = service.verifyCallAuthority(first.callId, first.purgeToken);
    expect(service.verifyCallAuthority(first.callId, first.purgeToken).capabilityHash)
      .toBe(firstAuthority.capabilityHash);
    expect(service.verifyCallAuthority(second.callId, second.purgeToken).capabilityHash)
      .not.toBe(firstAuthority.capabilityHash);
    expect(firstAuthority.capabilityHash).not.toContain(first.callId);
    expect(verifiedPurgeReceipt()).toEqual({
      providerDeletionVerified: true,
      northstarPurged: true,
      retainedContent: false,
    });
  });

  test('create rejects and never starts when the provider privacy contract differs', async () => {
    const retell = fakeRetell({
      getAgent: jest.fn(async () => ({
        data_storage_setting: 'everything',
        data_storage_retention_days: 30,
      })),
    });
    const service = new HomepageWebCallService({ retellClient: retell, settings: readySettings(), provider, secret });
    await expect(service.create('Roofing')).rejects.toMatchObject({
      status: 503,
      code: 'homepage_provider_privacy_gate_failed',
    });
    expect(retell.createWebCall).not.toHaveBeenCalled();
  });

  test('create pins the inspected agent version and verifies deletion when the created contract differs', async () => {
    const retell = fakeRetell({
      createWebCall: jest.fn(async () => ({
        call_id: 'call_homepage_001',
        call_type: 'web_call',
        agent_id: 'agent_homepage',
        agent_version: 8,
        access_token: 'temporary-browser-token',
        data_storage_setting: 'basic_attributes_only',
      })),
    });
    const service = new HomepageWebCallService({ retellClient: retell, settings: readySettings(), provider, secret });
    await expect(service.create('Roofing')).rejects.toMatchObject({
      status: 503,
      code: 'homepage_provider_creation_contract_failed',
    });
    expect(retell.createWebCall).toHaveBeenCalledWith('agent_homepage', expect.any(Object), 7);
    expect(retell.stopCall).toHaveBeenCalledWith('call_homepage_001');
    expect(retell.deleteCall).toHaveBeenCalledWith('call_homepage_001');
    expect(retell.getCall).toHaveBeenCalledWith('call_homepage_001');
  });

  test('create fails closed when an invalid created call cannot be verified absent', async () => {
    const retell = fakeRetell({
      createWebCall: jest.fn(async () => ({
        call_id: 'call_homepage_001',
        call_type: 'web_call',
        agent_id: 'agent_homepage',
        agent_version: 8,
        access_token: 'temporary-browser-token',
        data_storage_setting: 'basic_attributes_only',
      })),
      getCall: jest.fn(async () => ({ call_id: 'call_homepage_001' })),
    });
    const service = new HomepageWebCallService({
      retellClient: retell,
      settings: readySettings(),
      provider,
      secret,
      wait: async () => undefined,
    });
    await expect(service.create('Roofing')).rejects.toMatchObject({
      status: 503,
      code: 'homepage_provider_cleanup_unverified',
    });
  });

  test('canonical Polaris uses consented temporary turns without returning transcript or contact data', () => {
    const result = calculateHomepagePolaris('Roofing', [
      { speaker: 'customer', text: 'I need a roof replacement for a 2000 square foot roof.' },
      { speaker: 'agent', text: 'How old is the roof?' },
      { speaker: 'customer', text: 'It is twenty years old.' },
    ], 45);
    expect(result).toEqual(expect.objectContaining({
      contract: 'NorthStarHomepageCanonicalPolaris/v1',
      persistence: 'browser-memory-only',
      pricing: expect.objectContaining({ status: 'calculated', customerFacingPrice: 9000 }),
      qualification: expect.objectContaining({ preferredPricingVariableCaptured: true }),
      provenance: expect.objectContaining({
        calculationVersion: expect.any(String),
        normalizedInputFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    }));
    expect(JSON.stringify(result)).not.toMatch(/transcript|customerName|phone|address|email/i);
  });

  test('canonical Polaris strips raw emergency evidence from the browser-memory result', () => {
    const result = calculateHomepagePolaris('Electrical', [
      { speaker: 'customer', text: 'There are sparks right now at 25 Private Street and I need 4 outlets replaced.' },
    ], 20);
    expect(result.risk).toEqual({ emergency: true, signal: 'electrical sparking' });
    expect(result.risk).not.toHaveProperty('evidence');
    expect(result.risk).not.toHaveProperty('evidenceTurnId');
    expect(JSON.stringify(result)).not.toContain('25 Private Street');
  });

  test('transcript bounds reject oversized or invalid turns', () => {
    expect(() => normalizeTranscript([])).toThrow(/missing or too large/i);
    expect(() => normalizeTranscript(Array.from({ length: MAX_TRANSCRIPT_TURNS + 1 }, () => ({
      speaker: 'customer', text: 'bounded',
    })))).toThrow(/missing or too large/i);
    expect(() => normalizeTranscript([{ speaker: 'unknown', text: 'bad' }])).toThrow(/invalid turn/i);
  });

  test('purge stops, deletes, verifies provider absence, and returns no-retention receipt', async () => {
    const retell = fakeRetell();
    const service = new HomepageWebCallService({
      retellClient: retell,
      settings: readySettings(),
      provider,
      secret,
      now: () => fixedNow,
      randomBytes: () => crypto.randomBytes(16),
      wait: async () => undefined,
    });
    const created = await service.create('HVAC');
    await expect(service.purge(created.callId, created.purgeToken)).resolves.toEqual({
      providerDeletionVerified: true,
      northstarPurged: true,
      retainedContent: false,
    });
    expect(retell.stopCall).toHaveBeenCalledWith(created.callId);
    expect(retell.deleteCall).toHaveBeenCalledWith(created.callId);
    expect(retell.getCall).toHaveBeenCalledWith(created.callId);
  });

  test('purge fails closed when provider absence cannot be verified', async () => {
    const retell = fakeRetell({ getCall: jest.fn(async () => ({ call_id: 'call_homepage_001' })) });
    const service = new HomepageWebCallService({
      retellClient: retell,
      settings: readySettings(),
      provider,
      secret,
      now: () => fixedNow,
      randomBytes: () => Buffer.alloc(16, 9),
      wait: async () => undefined,
    });
    const created = await service.create('Electrical');
    await expect(service.purge(created.callId, created.purgeToken)).rejects.toMatchObject({
      status: 503,
      code: 'homepage_provider_deletion_unverified',
    });
  });
});
