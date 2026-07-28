'use strict';

const crypto = require('crypto');
const retell = require('../retell/client');
const { createSessionScopedCanonicalTools } = require('../voice/canonicalSessionTools');
const {
  authorityError,
  getActiveBusinessProfile,
  getBusinessProfileById,
  getOrganizationIntegration,
  getProvisionedDemoOrganization,
} = require('./organizationAuthority');
const voiceSessions = require('./voiceSessionAuthority');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function persistedContext(profile) {
  return deepFreeze({
    businessProfile: JSON.parse(JSON.stringify(profile.rawProfile)),
    canonicalAuthority: {
      id: profile.id,
      version: profile.versionLabel,
      hash: profile.profileHash,
    },
  });
}

function boundedText(value, maximum, fallback) {
  const selected = typeof value === 'string' ? value.trim() : '';
  return (selected || fallback || '').slice(0, maximum);
}

function validatePhone(value) {
  const phoneNumber = boundedText(value, 64, '');
  if (phoneNumber.replace(/\D/g, '').length < 10) {
    throw authorityError('INVALID_PHONE', 'A valid phoneNumber with area code is required.', 400);
  }
  return phoneNumber;
}

async function recordFailure(pool, input, error) {
  await voiceSessions.appendEvent(pool, {
    organizationId: input.organizationId,
    externalSessionId: input.externalSessionId,
    eventType: 'provider_creation_failed',
    payload: {
      code: error && error.code ? String(error.code) : 'VOICE_PROVIDER_CREATION_FAILED',
      providerSessionId: input.providerSessionId || null,
    },
    status: 'failed',
  });
}

async function createCanonicalVoiceCall(options) {
  const source = options || {};
  const pool = source.pool;
  const organizationId = String(source.organizationId || '').trim();
  const phoneNumber = validatePhone(source.phoneNumber);
  const requestedService = boundedText(source.service, 120, 'General');
  const requestedCaller = boundedText(source.caller, 160, 'Outbound Call');
  const [integration, profile] = await Promise.all([
    getOrganizationIntegration(pool, organizationId, 'retell'),
    getActiveBusinessProfile(pool, organizationId),
  ]);
  const provisionalSessionId = source.externalSessionId || ('pending-' + crypto.randomUUID());
  const fromNumber = boundedText(integration.metadata && integration.metadata.fromNumber, 64,
    source.fromNumber || '');
  const canonicalSession = await voiceSessions.createSession(pool, {
    organizationId,
    externalSessionId: provisionalSessionId,
    provider: 'retell',
    integrationOwnershipId: integration.id,
    profileId: profile.id,
    profileVersion: profile.versionLabel,
    profileHash: profile.profileHash,
    direction: 'outbound',
    fromNumber,
    toNumber: phoneNumber,
    metadata: {
      source: boundedText(source.source, 80, 'canonical-voice'),
      requestedService,
      requestedCaller,
      lifecycle: 'provider_creation_pending',
    },
  });
  await voiceSessions.appendEvent(pool, {
    organizationId,
    externalSessionId: provisionalSessionId,
    eventType: 'provider_creation_requested',
    payload: { direction: 'outbound' },
  });
  const sessionTools = createSessionScopedCanonicalTools({
    organizationId,
    voiceSessionId: canonicalSession.id,
    profile,
  });

  let providerSessionId = null;
  let currentSessionId = provisionalSessionId;
  try {
    const createProviderCall = source.createProviderCall || retell.createCall;
    const result = await createProviderCall(phoneNumber, integration.external_integration_id, {
      service: requestedService,
      caller: requestedCaller,
      fromNumber,
      executiveContext: persistedContext(profile),
      toolDefinitions: sessionTools.definitions,
      sessionTools,
    });
    providerSessionId = result && (result.call_id || result.callId);
    const session = source.preserveExternalSessionId
      ? await voiceSessions.attachProviderIdentity(pool, {
        organizationId,
        externalSessionId: provisionalSessionId,
        providerSessionId,
      })
      : await voiceSessions.assignProviderIdentity(pool, {
        organizationId,
        externalSessionId: provisionalSessionId,
        providerSessionId,
      });
    currentSessionId = source.preserveExternalSessionId ? provisionalSessionId : providerSessionId;
    const started = await voiceSessions.appendEvent(pool, {
      organizationId,
      externalSessionId: currentSessionId,
      eventType: 'call_started',
      payload: { direction: 'outbound', providerSessionId },
      status: 'active',
    });
    return { result, session: started.session || session, profile, integration, tools: sessionTools };
  } catch (error) {
    await recordFailure(pool, {
      organizationId,
      externalSessionId: currentSessionId,
      providerSessionId,
    }, error);
    error.canonicalSessionId = currentSessionId;
    throw error;
  }
}

async function getPinnedVoiceSessionTools(options) {
  const source = options || {};
  const session = await voiceSessions.getSession(source.pool, source.organizationId, source.externalSessionId);
  const profile = await getBusinessProfileById(source.pool, source.organizationId, session.profile.id);
  if (profile.versionLabel !== session.profile.version || profile.profileHash !== session.profile.hash) {
    throw authorityError('VOICE_PROFILE_PROVENANCE_MISMATCH', 'Pinned voice-session profile provenance is inconsistent.', 409);
  }
  return createSessionScopedCanonicalTools({
    organizationId: source.organizationId,
    voiceSessionId: session.id,
    profile,
  });
}

async function createProvisionedDemoVoiceCall(options) {
  const source = options || {};
  let demo;
  try {
    demo = await getProvisionedDemoOrganization(source.pool, source.configuredOrganizationId);
    return await createCanonicalVoiceCall({
      ...source,
      organizationId: demo.organizationId,
      source: 'public-demo',
      externalSessionId: 'demo-' + crypto.randomUUID(),
      preserveExternalSessionId: true,
    });
  } catch (error) {
    if (!demo || ['CANONICAL_BUSINESS_PROFILE_REQUIRED', 'INTEGRATION_OWNERSHIP_UNKNOWN',
      'CANONICAL_PERSISTENCE_UNAVAILABLE'].includes(error && error.code)) {
      throw authorityError('DEMO_UNAVAILABLE', 'The public demo is not provisioned.', 503);
    }
    throw error;
  }
}

module.exports = {
  createCanonicalVoiceCall,
  createProvisionedDemoVoiceCall,
  getPinnedVoiceSessionTools,
  persistedContext,
  validatePhone,
};
