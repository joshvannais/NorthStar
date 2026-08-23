'use strict';

const {
  adaptBusinessProfile,
  sha256: businessProfileHash,
} = require('../../src/services/businessProfileAdapter');
const {
  GENERATION_REASON,
  GENERATOR_VERSION,
  KnowledgeGenerationError,
  generateInitialKnowledgeDrafts,
} = require('../../src/knowledge/generator');

const ORG = 'a1000000-0000-4000-8000-000000000001';
const OWNER = 'a2000000-0000-4000-8000-000000000001';

function rawProfile() {
  return {
    industry: 'tree-service',
    businessDescription: 'Residential and commercial tree care.',
    company: {
      name: 'Example Tree Care',
      dba: 'Example Trees',
      email: 'office@example.test',
      phone: '+15550100100',
      website: 'https://example.test',
      timeZone: 'America/New_York',
      currency: 'USD',
    },
    headquarters: {
      street: '100 Example Way', city: 'Example', state: 'PA', zip: '17000', country: 'US',
    },
    serviceArea: { maxRadiusMiles: 40, maxTravelMinutes: 55, primaryTerritory: 'Example County' },
    hours: {
      monday: { open: '08:00', close: '17:00' },
      saturday: { emergency: true },
    },
    routing: { dispatchFrom: 'headquarters', trafficEnabled: true, useLiveTraffic: true },
    scheduling: { maxJobsPerDay: 4, travelBuffer: 15, workDayLength: 8, preferredDispatchStrategy: 'efficiency' },
    crew: {
      defaultCrewSize: 2,
      averageHourlyRate: 41,
      overtimeMultiplier: 1.5,
      travelPay: 20,
      minimumBillableHours: 1,
    },
    vehicles: { averageFuelCost: 3.5, hourlyVehicleCost: 14, maintenanceReserve: 5 },
    services: [{
      id: 'tree-removal',
      name: 'Tree removal',
      description: 'Removal after verified scope review.',
      active: true,
      crewSize: 3,
      avgHours: 5,
    }],
    canonicalPricing: {
      customerMarkupPercent: 35,
      taxRatePercent: 6,
      minimumJobPrice: 250,
      desiredGrossMarginPercent: 40,
    },
    canonicalCosts: { overheadPercent: 12, travelCostPerMile: 0.72 },
    policies: { weather: 'Unsafe weather requires rescheduling.' },
    faq: ['An authorized scheduler confirms availability.'],
    companyValues: ['Safety before speed.'],
    emergencyPolicy: 'Escalate immediate hazards to an authorized person.',
    workforce: {
      policies: [{
        id: 'ppe-required',
        name: 'PPE required',
        description: 'Use the required protective equipment.',
        enabled: true,
      }],
    },
    voiceAssistant: {
      name: 'NorthStar',
      style: 'Clear and concise',
      greeting: 'Thank you for calling Example Tree Care.',
      personality: 'professional',
      conversationStyle: 'consultative',
    },
  };
}

function profileAuthority(raw = rawProfile(), versionNumber = 3) {
  const versionLabel = `org-profile-v${versionNumber}`;
  const normalized = adaptBusinessProfile(raw, versionLabel);
  return {
    id: 'a3000000-0000-4000-8000-000000000001',
    organizationId: ORG,
    versionNumber,
    versionLabel,
    profileHash: normalized.hash,
    rawProfile: raw,
    normalizedProfile: normalized,
  };
}

function authorities(overrides = {}) {
  return {
    profile: profileAuthority(),
    workforce: {
      skills: [{
        id: 'a4000000-0000-4000-8000-000000000001',
        skillKey: 'climber',
        name: 'Climber',
        description: 'Qualified climbing capability.',
        serviceId: 'tree-removal',
      }],
      crews: [{
        id: 'a5000000-0000-4000-8000-000000000001',
        crewKey: 'crew-a',
        name: 'Crew A',
        homeLocationId: 'headquarters',
      }],
      crewMembers: [{
        crewId: 'a5000000-0000-4000-8000-000000000001',
        profileId: 'a6000000-0000-4000-8000-000000000001',
        crewRole: 'lead',
      }],
    },
    assets: {
      items: [{
        id: 'a7000000-0000-4000-8000-000000000001',
        category: 'equipment',
        name: 'Tracked chipper',
        internalReference: 'EQ-100',
        manufacturer: 'Example',
        model: 'Chipper 10',
        modelYear: 2025,
        configuration: 'Standard',
        homeLocationId: 'headquarters',
        catalogueState: 'active',
        version: 2,
      }],
      capabilities: [{
        assetId: 'a7000000-0000-4000-8000-000000000001',
        serviceId: 'tree-removal',
      }],
    },
    ...overrides,
  };
}

function generate(authorityBundle = authorities()) {
  return generateInitialKnowledgeDrafts({
    organizationId: ORG,
    actorUserId: OWNER,
    authorities: authorityBundle,
  });
}

function byKey(result, canonicalKey) {
  return result.drafts.find(draft => draft.canonicalKey === canonicalKey);
}

describe('Mission 21 Part 2 deterministic knowledge generation', () => {
  test('generates seven bounded review drafts with stable ordering, bytes, digests and provenance', () => {
    const first = generate();
    const reordered = authorities({
      workforce: {
        crewMembers: authorities().workforce.crewMembers.slice().reverse(),
        crews: authorities().workforce.crews.slice().reverse(),
        skills: authorities().workforce.skills.slice().reverse(),
      },
      assets: {
        capabilities: authorities().assets.capabilities.slice().reverse(),
        items: authorities().assets.items.slice().reverse(),
      },
    });
    const second = generate(reordered);

    expect(first.authority.generatorVersion).toBe(GENERATOR_VERSION);
    expect(first.drafts.map(draft => draft.canonicalKey)).toEqual([
      'organization.availability',
      'organization.customer-guidance',
      'organization.financial-constraints',
      'organization.identity',
      'organization.operational-capabilities',
      'organization.services',
      'organization.voice-guidance',
    ]);
    expect(second.drafts.map(draft => draft.canonicalDocument))
      .toEqual(first.drafts.map(draft => draft.canonicalDocument));
    expect(second.drafts.map(draft => draft.canonicalDigest))
      .toEqual(first.drafts.map(draft => draft.canonicalDigest));
    for (const draft of first.drafts) {
      expect(draft.origin).toBe('generated');
      expect(draft.reason).toBe(GENERATION_REASON);
      expect(draft.document.content.generation.generatorVersion).toBe(GENERATOR_VERSION);
      expect(draft.provenance[0].sourceType).toBe('system_generation');
      expect(draft.canonicalDocument).not.toContain('retell');
      expect(draft.canonicalDocument).not.toContain('providerTransport');
    }
  });

  test('does not promote normalized defaults when raw facts are missing', () => {
    const raw = {};
    const result = generate(authorities({
      profile: profileAuthority(raw, 1),
      workforce: { skills: [], crews: [], crewMembers: [] },
      assets: { items: [], capabilities: [] },
    }));
    const identity = byKey(result, 'organization.identity').document.content;
    expect(identity.state).toBe('needs_review');
    expect(identity.facts.company).not.toHaveProperty('name');
    expect(identity.facts.company).not.toHaveProperty('currency');
    expect(identity.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_authoritative_fact', path: '/rawProfile/company/name' }),
    ]));
    const availability = byKey(result, 'organization.availability').document.content;
    expect(availability.facts.hours).toEqual({});
    expect(availability.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_authoritative_section', path: '/rawProfile/hours' }),
    ]));
  });

  test('turns a same-version raw/normalized disagreement into needs review and omits the disputed fact', () => {
    const profile = profileAuthority();
    const normalized = JSON.parse(JSON.stringify(profile.normalizedProfile));
    normalized.currency = 'CAD';
    delete normalized.hash;
    const nextHash = businessProfileHash(normalized);
    normalized.hash = nextHash;
    profile.normalizedProfile = normalized;
    profile.profileHash = nextHash;

    const result = generate(authorities({ profile }));
    const content = byKey(result, 'organization.identity').document.content;
    expect(content.state).toBe('needs_review');
    expect(content.facts.company).not.toHaveProperty('currency');
    expect(content.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'conflicting_authoritative_fact',
        path: '/rawProfile/company/currency',
      }),
    ]));
  });

  test('detects orphaned normalized capability references without inventing a service', () => {
    const bundle = authorities();
    bundle.workforce.skills[0].serviceId = 'stump-grinding';
    bundle.assets.capabilities[0].serviceId = 'crane-service';
    const content = byKey(generate(bundle), 'organization.operational-capabilities').document.content;
    expect(content.state).toBe('needs_review');
    expect(content.needsReview.filter(item => item.code === 'orphaned_authority_reference')).toHaveLength(2);
    expect(content.facts.skills[0].serviceId).toBe('stump-grinding');
    expect(byKey(generate(bundle), 'organization.services').document.content.facts.services)
      .toHaveLength(1);
  });

  test('rejects corrupted profile evidence, duplicate normalized identities and tenant mismatches', () => {
    const corrupted = profileAuthority();
    corrupted.profileHash = '0'.repeat(64);
    expect(() => generate(authorities({ profile: corrupted }))).toThrow(expect.objectContaining({
      code: 'knowledge_profile_digest_mismatch',
    }));

    const duplicate = authorities();
    duplicate.workforce.skills.push({ ...duplicate.workforce.skills[0] });
    expect(() => generate(duplicate)).toThrow(expect.objectContaining({
      code: 'knowledge_source_conflict',
    }));

    expect(() => generateInitialKnowledgeDrafts({
      organizationId: 'a1000000-0000-4000-8000-000000000002',
      actorUserId: OWNER,
      authorities: authorities(),
    })).toThrow(expect.objectContaining({
      code: 'knowledge_generation_tenant_mismatch',
    }));
  });

  test('fails closed when selected authoritative content cannot fit a bounded knowledge document', () => {
    const raw = rawProfile();
    raw.policies = {
      first: 'a'.repeat(15000),
      second: 'b'.repeat(15000),
      third: 'c'.repeat(15000),
      fourth: 'd'.repeat(15000),
      fifth: 'e'.repeat(15000),
    };
    expect(() => generate(authorities({ profile: profileAuthority(raw) }))).toThrow(expect.objectContaining({
      code: 'knowledge_document_too_large',
    }));
  });

  test('uses a specific generation error type for source-integrity failures', () => {
    const profile = profileAuthority();
    profile.normalizedProfile = {
      ...JSON.parse(JSON.stringify(profile.normalizedProfile)),
      hash: 'f'.repeat(64),
    };
    expect(() => generate(authorities({ profile }))).toThrow(KnowledgeGenerationError);
  });
});
