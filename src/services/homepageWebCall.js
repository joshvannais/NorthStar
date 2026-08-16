'use strict';

const crypto = require('crypto');
const config = require('../config');
const retellClient = require('../retell/client');
const { sha256 } = require('./businessProfileAdapter');
const { CALCULATION_VERSION, calculateCanonicalPolaris } = require('./canonicalPolarisCalculation');
const { QUALIFICATION_PROFILES, extractPolarisFactsWithEntities } = require('../polaris/factExtraction');

const BASIC_STORAGE = 'basic_attributes_only';
const REQUIRED_RETENTION_DAYS = 1;
const TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const MAX_TRANSCRIPT_TURNS = 48;
const MAX_TURN_BYTES = 600;
const MAX_TRANSCRIPT_BYTES = 16 * 1024;
const CONSENT_PHRASE = 'I consent to this AI demo and temporary recording';
const DISCLOSURE_COPY = 'This is a NorthStar AI demonstration. Microphone audio is processed and recorded temporarily for this call. Do not share sensitive information. Say I consent to this AI demo and temporary recording to continue, or hang up to withdraw.';
const HOMEPAGE_WEBHOOK_CONTRACT = 'homepage-ephemeral-web-call-v1';

const INDUSTRY_PROFILE = Object.freeze({
  Roofing: Object.freeze({ key: 'roofing', label: 'Roofing', variable: 'Roof Area', unitLabel: 'square feet', unitRate: 4.5 }),
  HVAC: Object.freeze({ key: 'hvac', label: 'HVAC', variable: 'Home Square Footage', unitLabel: 'square feet', unitRate: 0.18 }),
  Plumbing: Object.freeze({ key: 'plumbing', label: 'Plumbing', variable: 'Fixture Count', unitLabel: 'fixtures', unitRate: 110 }),
  Electrical: Object.freeze({ key: 'electrical', label: 'Electrical', variable: 'Device Count', unitLabel: 'devices', unitRate: 95 }),
  Painting: Object.freeze({ key: 'painting', label: 'Painting', variable: 'Square Footage', unitLabel: 'square feet', unitRate: 2.25 }),
  'Tree Service': Object.freeze({ key: 'tree-service', label: 'Tree Service', variable: 'Tree Height', unitLabel: 'feet', unitRate: 22 }),
  'Window Tinting': Object.freeze({ key: 'window-tinting', label: 'Window Tinting', variable: 'Window Count', unitLabel: 'windows', unitRate: 120 }),
  Concrete: Object.freeze({ key: 'concrete', label: 'Concrete', variable: 'Area', unitLabel: 'square feet', unitRate: 10 }),
});

class HomepageWebCallError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HomepageWebCallError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new HomepageWebCallError(status, code, message);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function boundedSecret(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32 ? value : null;
}

function safeCallId(value) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > 160 || !/^[A-Za-z0-9_-]+$/.test(result)) {
    fail(400, 'homepage_call_identifier_invalid', 'The temporary call identifier is invalid.');
  }
  return result;
}

function safeIndustry(value) {
  const industry = typeof value === 'string' ? value.trim() : '';
  if (!Object.prototype.hasOwnProperty.call(INDUSTRY_PROFILE, industry)) {
    fail(422, 'homepage_industry_invalid', 'Choose a supported home-service industry.');
  }
  return industry;
}

function timingEqual(first, second) {
  const left = Buffer.from(String(first));
  const right = Buffer.from(String(second));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signPurgeToken(callId, secret, now, randomBytes) {
  const key = boundedSecret(secret);
  if (!key) fail(503, 'homepage_purge_authority_unavailable', 'The temporary-call purge authority is unavailable.');
  const payload = base64url(JSON.stringify({
    version: 1,
    callId: safeCallId(callId),
    expiresAt: now.getTime() + TOKEN_LIFETIME_MS,
    nonce: randomBytes(16).toString('base64url'),
  }));
  const signature = crypto.createHmac('sha256', key)
    .update('northstar:homepage-retell-purge:v1\0' + payload, 'utf8')
    .digest('base64url');
  return payload + '.' + signature;
}

function verifyPurgeToken(token, expectedCallId, secret, now) {
  const key = boundedSecret(secret);
  if (!key) fail(503, 'homepage_purge_authority_unavailable', 'The temporary-call purge authority is unavailable.');
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    fail(403, 'homepage_purge_token_invalid', 'The temporary-call purge authorization is invalid.');
  }
  const expected = crypto.createHmac('sha256', key)
    .update('northstar:homepage-retell-purge:v1\0' + parts[0], 'utf8')
    .digest('base64url');
  if (!timingEqual(parts[1], expected)) {
    fail(403, 'homepage_purge_token_invalid', 'The temporary-call purge authorization is invalid.');
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_error) {
    fail(403, 'homepage_purge_token_invalid', 'The temporary-call purge authorization is invalid.');
  }
  if (!payload || payload.version !== 1 || payload.callId !== safeCallId(expectedCallId) ||
      !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < now.getTime() ||
      typeof payload.nonce !== 'string' || payload.nonce.length < 16) {
    fail(403, 'homepage_purge_token_invalid', 'The temporary-call purge authorization is invalid or expired.');
  }
  return payload;
}

function normalizeTranscript(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TRANSCRIPT_TURNS) {
    fail(422, 'homepage_transcript_invalid', 'The temporary transcript is missing or too large.');
  }
  let totalBytes = 0;
  const turns = value.map(function (turn, index) {
    const speaker = turn && (turn.speaker === 'agent' || turn.speaker === 'ai') ? 'agent'
      : (turn && (turn.speaker === 'customer' || turn.speaker === 'user') ? 'customer' : null);
    const text = turn && typeof turn.text === 'string' ? turn.text.trim() : '';
    const bytes = Buffer.byteLength(text, 'utf8');
    if (!speaker || !text || bytes > MAX_TURN_BYTES) {
      fail(422, 'homepage_transcript_invalid', 'The temporary transcript contains an invalid turn.');
    }
    totalBytes += bytes;
    return { turnId: 'homepage-turn-' + (index + 1), speaker, text };
  });
  if (totalBytes > MAX_TRANSCRIPT_BYTES) {
    fail(422, 'homepage_transcript_invalid', 'The temporary transcript is too large.');
  }
  return turns;
}

function publicBusinessProfile(industry) {
  const definition = INDUSTRY_PROFILE[industry];
  return {
    version: 'homepage-fictional-profile-v1',
    company: { name: 'NorthStar Fictional Demo Contractor', currency: 'USD' },
    crew: { defaultCrewSize: 2, averageHourlyRate: 42, overtimeMultiplier: 1.5 },
    canonicalPricing: {
      customerMarkupPercent: 0,
      travelCustomerChargePerMile: 0,
      emergencyMultiplier: 1.25,
      taxRatePercent: 0,
      defaultRangePercent: 15,
    },
    canonicalCosts: {
      overheadPercent: 20,
      travelCostPerMile: 0,
      materialCostByService: {},
      equipmentCostByReference: {},
    },
    services: [{
      id: definition.key,
      name: definition.label + ' fictional demo service',
      crewSize: 2,
      canonicalPricing: {
        requiredScope: ['quantity'],
        rangePercent: 15,
        lineItems: [{
          code: 'fictional-demo-quantity',
          label: 'Fictional profile quantity',
          category: 'serviceCharge',
          type: 'perUnit',
          quantityField: 'quantity',
          unitRate: definition.unitRate,
        }],
      },
    }],
  };
}

function eligibleFacts(extraction, industry) {
  const allowed = new Set((QUALIFICATION_PROFILES[industry] || []).map(function (item) { return item.name; }));
  return (extraction.facts || []).filter(function (fact) {
    return allowed.has(fact.variable) && fact.status === 'collected' && fact.normalizedValue !== null;
  }).map(function (fact, index) {
    return {
      id: 'homepage-fact-' + (index + 1),
      variable: fact.variable,
      status: 'collected',
      normalizedValue: fact.normalizedValue,
      displayValue: fact.displayValue === undefined ? String(fact.normalizedValue) : String(fact.displayValue),
      extractionConfidence: Number(fact.extractionConfidence) || 0,
      evidenceTurnId: fact.evidence && fact.evidence.turnId ? String(fact.evidence.turnId) : null,
    };
  });
}

function calculateHomepagePolaris(industryValue, transcriptValue, callDurationSeconds) {
  const industry = safeIndustry(industryValue);
  const transcript = normalizeTranscript(transcriptValue);
  const extraction = extractPolarisFactsWithEntities(transcript, industry, 'retell');
  const facts = eligibleFacts(extraction, industry);
  const definition = INDUSTRY_PROFILE[industry];
  const quantityFact = facts.find(function (fact) {
    return fact.variable === definition.variable && typeof fact.normalizedValue === 'number' &&
      Number.isFinite(fact.normalizedValue) && fact.normalizedValue > 0;
  }) || null;
  const profile = publicBusinessProfile(industry);
  const profileHash = sha256(profile);
  const calculation = calculateCanonicalPolaris({
    organizationId: '00000000-0000-4000-8000-000000000101',
    customerId: '00000000-0000-4000-8000-000000000102',
    opportunityId: '00000000-0000-4000-8000-000000000103',
    calculationVersion: CALCULATION_VERSION,
    service: {
      key: definition.key,
      scope: quantityFact ? { quantity: quantityFact.normalizedValue, unitLabel: definition.unitLabel } : {},
    },
    transcript,
    facts,
    businessProfile: profile,
    businessProfileAuthority: {
      id: '00000000-0000-4000-8000-000000000104',
      versionLabel: profile.version,
      profileHash,
    },
    callDurationSeconds: Number.isFinite(Number(callDurationSeconds))
      ? Math.max(0, Math.min(600, Math.round(Number(callDurationSeconds)))) : null,
  });

  return {
    contract: 'NorthStarHomepageCanonicalPolaris/v1',
    persistence: 'browser-memory-only',
    profile: {
      kind: 'fictional-demo-business-profile',
      version: profile.version,
      hash: profileHash,
      pricingNotice: 'Illustrative output from a fictional demo Business Profile; not a quote.',
    },
    service: calculation.service,
    pricing: {
      status: calculation.customerFacingPrice === null ? 'not_calculated' : 'calculated',
      customerFacingPrice: calculation.customerFacingPrice,
      preliminaryRange: calculation.preliminaryRange,
      tax: calculation.tax,
      totalIncludingTax: calculation.totalIncludingTax,
      notCalculated: calculation.notCalculated,
    },
    confidence: calculation.confidence,
    risk: {
      emergency: Boolean(calculation.risk && calculation.risk.emergency),
      signal: calculation.risk && calculation.risk.signal ? String(calculation.risk.signal) : null,
    },
    recommendedActions: calculation.recommendedActions,
    facts: facts.map(function (fact) {
      return {
        variable: fact.variable,
        displayValue: fact.displayValue,
        extractionConfidence: fact.extractionConfidence,
      };
    }),
    qualification: {
      captured: facts.length,
      expected: (QUALIFICATION_PROFILES[industry] || []).length,
      preferredPricingVariable: definition.variable,
      preferredPricingVariableCaptured: Boolean(quantityFact),
    },
    provenance: {
      calculationVersion: calculation.calculationVersion,
      normalizedInputFingerprint: calculation.normalizedInputFingerprint,
      businessProfileInputHash: calculation.businessProfileInputHash,
    },
  };
}

class HomepageWebCallService {
  constructor(options = {}) {
    this.retell = options.retellClient || retellClient;
    this.settings = options.settings || config.homepageWebCall || {};
    this.provider = options.provider || config.retell || {};
    this.secret = options.secret === undefined ? config.auth.accessSecret : options.secret;
    this.now = options.now || function () { return new Date(); };
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.wait = options.wait || function (milliseconds) {
      return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
    };
  }

  availability() {
    const missing = [];
    if (this.settings.enabled !== true) missing.push('source_enablement');
    if (this.settings.legalApproved !== true) missing.push('attorney_approval');
    if (this.settings.providerApproved !== true) missing.push('provider_approval');
    if (this.settings.webhookIsolationApproved !== true) missing.push('webhook_isolation_approval');
    if (!this.provider.apiKey || !this.provider.agentId) missing.push('provider_configuration');
    if (!boundedSecret(this.secret)) missing.push('purge_authority');
    return {
      available: missing.length === 0,
      state: missing.length ? 'approval_or_configuration_required' : 'ready',
      missing,
      storageRequirement: BASIC_STORAGE,
      retentionRequirementDays: REQUIRED_RETENTION_DAYS,
      disclosureVersion: 'attorney-gated-draft-v1',
    };
  }

  requireAvailable() {
    const status = this.availability();
    if (!status.available) {
      fail(503, 'homepage_web_call_unavailable', 'The browser Web Call is not yet available. Final legal and provider approval is required.');
    }
    return status;
  }

  async verifyProviderDeletion(callId) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.retell.getCall(callId);
      } catch (error) {
        if (error && error.code === 'RETELL_CALL_NOT_FOUND') return true;
        throw error;
      }
      if (attempt < 3) await this.wait(150 * Math.pow(2, attempt));
    }
    fail(503, 'homepage_provider_deletion_unverified', 'Deletion could not be verified. Results remain hidden; retry deletion.');
  }

  async deleteAndVerify(callId) {
    try {
      await this.retell.stopCall(callId);
    } catch (error) {
      if (!error || !['RETELL_CALL_NOT_STOPPABLE', 'RETELL_CALL_NOT_FOUND'].includes(error.code)) throw error;
    }
    try {
      await this.retell.deleteCall(callId);
    } catch (error) {
      if (!error || error.code !== 'RETELL_CALL_NOT_FOUND') throw error;
    }
    return this.verifyProviderDeletion(callId);
  }

  async deleteUnverifiedCreation(callId) {
    return this.deleteAndVerify(callId);
  }

  async create(industryValue) {
    this.requireAvailable();
    const industry = safeIndustry(industryValue);
    const agent = await this.retell.getAgent(this.provider.agentId);
    if (!agent || agent.data_storage_setting !== BASIC_STORAGE ||
        agent.data_storage_retention_days !== REQUIRED_RETENTION_DAYS ||
        !Number.isSafeInteger(agent.version) || agent.version < 0) {
      fail(503, 'homepage_provider_privacy_gate_failed', 'The browser Web Call is unavailable because its provider privacy gate is not satisfied.');
    }
    const result = await this.retell.createWebCall(this.provider.agentId, {
      northstar_demo_mode: 'homepage_browser_web_call',
      northstar_demo_industry: industry,
      northstar_demo_disclosure: DISCLOSURE_COPY,
      northstar_demo_consent_phrase: CONSENT_PHRASE,
      northstar_demo_webhook_contract: HOMEPAGE_WEBHOOK_CONTRACT,
      northstar_demo_sensitive_data_rule: 'Do not request or repeat sensitive personal, financial, medical, credential, or account information.',
    }, agent.version);
    const callId = safeCallId(result && result.call_id);
    if (!result || result.call_type !== 'web_call' || typeof result.access_token !== 'string' ||
        !result.access_token || result.agent_id !== this.provider.agentId ||
        result.agent_version !== agent.version || result.data_storage_setting !== BASIC_STORAGE) {
      try {
        await this.deleteUnverifiedCreation(callId);
      } catch (_cleanupError) {
        fail(503, 'homepage_provider_cleanup_unverified', 'The Web Call contract failed and provider deletion could not be verified. No result is available.');
      }
      fail(503, 'homepage_provider_creation_contract_failed', 'The browser Web Call could not satisfy its provider privacy contract.');
    }
    return {
      callId,
      accessToken: result.access_token,
      purgeToken: signPurgeToken(callId, this.secret, this.now(), this.randomBytes),
      storage: BASIC_STORAGE,
      retentionDays: REQUIRED_RETENTION_DAYS,
      verbalConsentPhrase: CONSENT_PHRASE,
    };
  }

  verifyCallAuthority(callId, purgeToken) {
    return verifyPurgeToken(purgeToken, callId, this.secret, this.now());
  }

  projectPolaris(callId, purgeToken, industry, transcript, callDurationSeconds) {
    this.verifyCallAuthority(callId, purgeToken);
    return calculateHomepagePolaris(industry, transcript, callDurationSeconds);
  }

  async purge(callIdValue, purgeToken) {
    const callId = safeCallId(callIdValue);
    this.verifyCallAuthority(callId, purgeToken);
    await this.deleteAndVerify(callId);
    return {
      providerDeletionVerified: true,
      northstarPurged: true,
      retainedContent: false,
    };
  }
}

module.exports = {
  BASIC_STORAGE,
  CONSENT_PHRASE,
  DISCLOSURE_COPY,
  HOMEPAGE_WEBHOOK_CONTRACT,
  HomepageWebCallError,
  HomepageWebCallService,
  INDUSTRY_PROFILE,
  MAX_TRANSCRIPT_BYTES,
  MAX_TRANSCRIPT_TURNS,
  REQUIRED_RETENTION_DAYS,
  TOKEN_LIFETIME_MS,
  calculateHomepagePolaris,
  normalizeTranscript,
  signPurgeToken,
  verifyPurgeToken,
};
