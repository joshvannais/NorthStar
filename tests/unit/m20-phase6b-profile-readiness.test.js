'use strict';

const {
  adaptBusinessProfile,
  validateRawBusinessProfile,
} = require('../../src/services/businessProfileAdapter');
const {
  applyProfileReadinessChanges,
  PROFILE_READINESS_SCHEMA_VERSION,
  REGISTRY,
  parseProfileReadinessWrite,
  projectProfileReadiness,
  stableHash,
  transitionCompatibleProfileReadiness,
} = require('../../src/services/profileReadiness');

const REVIEWED_AT = new Date('2026-08-09T16:00:00.000Z');
const IDS = [
  'company_identity',
  'business_locale',
  'active_services',
  'business_contact',
  'business_context',
  'operating_origin',
  'service_area',
  'weekly_hours',
  'customer_guidance',
  'financial_configuration',
  'voice_configuration',
];

function configuredProfile() {
  return {
    updatedAt: 'caller-authored-not-a-review-date',
    company: {
      name: '  NorthStar Tree Care 🧭  ',
      email: 'office@example.test',
      phone: '',
      timeZone: 'America/New_York',
      currency: 'USD',
    },
    industry: 'Tree care',
    businessDescription: 'Safe residential and commercial work.',
    headquarters: {
      street: '10 Main Street', city: 'Asheville', state: 'NC', zip: '28801', country: 'US',
      latitude: 35.5951, longitude: -82.5515,
      additionalOffices: [
        { id: 'office-west', name: 'West', street: '20 West St', city: 'Canton', state: 'NC', zip: '28716', country: 'US' },
      ],
    },
    routing: { dispatchFrom: 'headquarters' },
    serviceArea: { maxRadiusMiles: 75, maxTravelMinutes: null, primaryTerritory: '', polygon: [] },
    hours: { monday: { open: '08:00', close: '17:00' }, holidays: [] },
    services: [{ id: 'tree-removal', name: 'Tree Removal', active: true }],
    emergencyPolicy: 'Storm response\r\nTreat <img src=x onerror=never()> as text.',
    customPrompt: '',
    faq: ['Do you handle permits?\r\nYes.'],
    companyValues: ['Safety'],
    policies: { cleanup: 'Leave the site clean.' },
    canonicalPricing: { customerMarkupPercent: 0 },
    canonicalCosts: {},
    crew: {},
    vehicles: {},
    voiceAssistant: {
      name: 'NorthStar Guide',
      greeting: 'Hello <svg onload=never()>',
      personality: 'professional',
    },
    integrations: { retell: { enabled: true, status: 'connected' } },
  };
}

function reviewAll(profile) {
  return applyProfileReadinessChanges(profile, IDS.map(function (itemId) {
    return { itemId, action: 'review' };
  }), REVIEWED_AT);
}

function withLegacyReview(profile, itemId, source) {
  const stored = JSON.parse(JSON.stringify(profile));
  stored.profileReadiness = {
    schemaVersion: PROFILE_READINESS_SCHEMA_VERSION,
    items: {
      [itemId]: {
        applicability: 'applicable',
        lastReviewedAt: REVIEWED_AT.toISOString(),
        reviewedValueHash: stableHash(itemId, source),
      },
    },
  };
  return stored;
}

describe('Mission 20 Phase 6B Profile Readiness contract', () => {
  test('uses the exact ordered registry and only authorized categorical states', () => {
    expect(REGISTRY.map(function (item) { return item.id; })).toEqual(IDS);
    const projection = projectProfileReadiness({}, { version: null });
    expect(projection.schemaVersion).toBe(PROFILE_READINESS_SCHEMA_VERSION);
    expect(projection.itemOrder).toEqual(IDS);
    expect(projection.overallState).toBe('action_needed');
    expect(projection.canonicalAuthority).toEqual({ version: null });
    expect(projection.items.company_identity.state).toBe('missing');
    expect(projection.items.business_contact.state).toBe('recommended');
    expect(projection.items.operating_origin.canMarkNotApplicable).toBe(true);
    expect(new Set(Object.values(projection.items).map(function (item) { return item.state; })))
      .toEqual(new Set(['missing', 'recommended']));
    expect(JSON.stringify(projection)).not.toMatch(/percentage|score|points|integration.*status/i);
  });

  test('reviews all recognized sources, retains the server timestamp, and never decays with time', () => {
    const profile = configuredProfile();
    const initial = projectProfileReadiness(profile, { version: 'org-profile-v1' });
    expect(initial.overallState).toBe('review_needed');
    expect(Object.values(initial.items).every(function (item) { return item.state === 'needs_review'; })).toBe(true);

    const reviewedProfile = reviewAll(profile);
    const reviewed = projectProfileReadiness(reviewedProfile, { version: 'org-profile-v2' });
    expect(reviewed.overallState).toBe('ready_for_configured_uses');
    expect(Object.values(reviewed.items).every(function (item) { return item.state === 'reviewed'; })).toBe(true);
    expect(Object.values(reviewed.items).every(function (item) {
      return item.lastReviewedAt === REVIEWED_AT.toISOString();
    })).toBe(true);

    jest.useFakeTimers().setSystemTime(new Date('2046-08-09T16:00:00.000Z'));
    try {
      expect(projectProfileReadiness(reviewedProfile, { version: 'org-profile-v2' })).toEqual(reviewed);
    } finally {
      jest.useRealTimers();
    }
  });

  test('invalidates only recognized source paths and keeps integration state and legacy finance excluded', () => {
    const reviewedProfile = reviewAll(configuredProfile());
    const irrelevant = JSON.parse(JSON.stringify(reviewedProfile));
    irrelevant.updatedAt = 'another-caller-date';
    irrelevant.integrations.retell.status = 'disconnected';
    irrelevant.retell = { agentId: 'must-not-be-a-readiness-source' };
    irrelevant.financial = { markup: 99, taxRate: 80 };
    irrelevant.unknownSibling = 'not writable but irrelevant to the pure projection';
    const unchanged = projectProfileReadiness(irrelevant, { version: 'org-profile-v3' });
    expect(Object.values(unchanged.items).every(function (item) { return item.state === 'reviewed'; })).toBe(true);

    const trimEquivalent = JSON.parse(JSON.stringify(reviewedProfile));
    trimEquivalent.company.name = '\t' + trimEquivalent.company.name.trim() + '\r\n';
    expect(projectProfileReadiness(trimEquivalent, { version: 'org-profile-v3' }).items.company_identity.state)
      .toBe('reviewed');

    const changed = JSON.parse(JSON.stringify(reviewedProfile));
    changed.company.name = 'A materially different company name';
    const changedProjection = projectProfileReadiness(changed, { version: 'org-profile-v4' });
    expect(changedProjection.items.company_identity.state).toBe('needs_review');
    expect(changedProjection.items.business_locale.state).toBe('reviewed');
    expect(changedProjection.items.voice_configuration.state).toBe('reviewed');
    expect(changedProjection.overallState).toBe('review_needed');
  });

  test.each([
    {
      label: 'contact with an explicit blank phone',
      itemId: 'business_contact',
      mutate: profile => { profile.company.phone = ''; },
      legacySource: { email: 'office@example.test', phone: '' },
      legacyHash: '6d9a8f90dd134237dfddcdc2e08ceba58a8a2f4325d73527826b2bac6238f0ca',
    },
    {
      label: 'contact with a missing phone',
      itemId: 'business_contact',
      mutate: profile => { delete profile.company.phone; },
      legacySource: { email: 'office@example.test', phone: '' },
      legacyHash: '6d9a8f90dd134237dfddcdc2e08ceba58a8a2f4325d73527826b2bac6238f0ca',
    },
    {
      label: 'contact with a whitespace phone',
      itemId: 'business_contact',
      mutate: profile => { profile.company.phone = ' \t\r\n '; },
      legacySource: { email: 'office@example.test', phone: ' \t\r\n ' },
    },
    {
      label: 'contact with a nonempty invalid email sibling',
      itemId: 'business_contact',
      mutate: profile => {
        profile.company.email = 'not-an-email';
        profile.company.phone = '  +1 828 555 0100  ';
      },
      legacySource: { email: 'not-an-email', phone: '  +1 828 555 0100  ' },
      legacyHash: '4c7d0669382865bc37eac36fa57dd0c580288a85140bcc7c0b142bd4e508811e',
    },
    {
      label: 'context with an explicit blank description',
      itemId: 'business_context',
      mutate: profile => { profile.businessDescription = ''; },
      legacySource: { businessDescription: '', industry: 'Tree care' },
      legacyHash: '7cb5504bb1e00b3aa13f63d708ec6f9c8afbbf1073ad81943ea8ffa5b1ca0520',
    },
    {
      label: 'context with a missing description',
      itemId: 'business_context',
      mutate: profile => { delete profile.businessDescription; },
      legacySource: { businessDescription: '', industry: 'Tree care' },
      legacyHash: '7cb5504bb1e00b3aa13f63d708ec6f9c8afbbf1073ad81943ea8ffa5b1ca0520',
    },
    {
      label: 'context with a whitespace description',
      itemId: 'business_context',
      mutate: profile => { profile.businessDescription = '\t \r\n'; },
      legacySource: { businessDescription: '\t \r\n', industry: 'Tree care' },
    },
  ])('preserves an unchanged legacy-v1 review for $label', ({ itemId, mutate, legacySource, legacyHash }) => {
    const profile = configuredProfile();
    mutate(profile);
    const reviewed = withLegacyReview(profile, itemId, legacySource);
    if (legacyHash) {
      expect(reviewed.profileReadiness.items[itemId].reviewedValueHash).toBe(legacyHash);
    }
    expect(projectProfileReadiness(reviewed, { version: 'org-profile-v2' }).items[itemId])
      .toEqual(expect.objectContaining({
        sourceState: 'configured', state: 'reviewed', lastReviewedAt: REVIEWED_AT.toISOString(),
      }));
  });

  test('does not treat a changed qualifying value as a compatible legacy-v1 review', () => {
    const contact = withLegacyReview(configuredProfile(), 'business_contact', {
      email: 'office@example.test', phone: '',
    });
    contact.company.email = 'dispatch@example.test';
    expect(projectProfileReadiness(contact, { version: 'org-profile-v2' })
      .items.business_contact.state).toBe('needs_review');

    const context = configuredProfile();
    context.businessDescription = '';
    const contextReviewed = withLegacyReview(context, 'business_context', {
      businessDescription: '', industry: 'Tree care',
    });
    contextReviewed.industry = 'Landscaping';
    expect(projectProfileReadiness(contextReviewed, { version: 'org-profile-v2' })
      .items.business_context.state).toBe('needs_review');
  });

  test.each([
    {
      label: 'blank to whitespace contact sibling',
      itemId: 'business_contact',
      prepare: profile => { profile.company.phone = ''; },
      legacySource: { email: 'office@example.test', phone: '' },
      mutate: profile => { profile.company.phone = ' \t\r\n '; },
      canonicalSource: { email: 'office@example.test' },
    },
    {
      label: 'nonempty invalid contact sibling',
      itemId: 'business_contact',
      prepare: profile => {
        profile.company.email = 'not-an-email';
        profile.company.phone = '  +1 828 555 0100  ';
      },
      legacySource: { email: 'not-an-email', phone: '  +1 828 555 0100  ' },
      mutate: profile => {
        profile.company.email = 'still-not-an-email';
        profile.company.phone = '+1 828 555 0100';
      },
      canonicalSource: { phone: '+1 828 555 0100' },
    },
    {
      label: 'normalized qualifying contact formatting',
      itemId: 'business_contact',
      prepare: profile => {
        profile.company.email = ' office@example.test ';
        profile.company.phone = '';
      },
      legacySource: { email: ' office@example.test ', phone: '' },
      mutate: profile => { profile.company.email = 'office@example.test'; },
      canonicalSource: { email: 'office@example.test' },
    },
    {
      label: 'blank to whitespace context sibling',
      itemId: 'business_context',
      prepare: profile => { profile.businessDescription = ''; },
      legacySource: { businessDescription: '', industry: 'Tree care' },
      mutate: profile => { profile.businessDescription = '\t \r\n'; },
      canonicalSource: { industry: 'Tree care' },
    },
  ])('transitions only the legacy reviewed hash for a neutral writer change: $label', ({
    itemId, prepare, legacySource, mutate, canonicalSource,
  }) => {
    const source = configuredProfile();
    prepare(source);
    const active = withLegacyReview(source, itemId, legacySource);
    const candidate = JSON.parse(JSON.stringify(active));
    mutate(candidate);
    const beforeItem = JSON.parse(JSON.stringify(active.profileReadiness.items[itemId]));
    const transitioned = transitionCompatibleProfileReadiness(active, candidate);
    const expected = JSON.parse(JSON.stringify(candidate));
    expected.profileReadiness.items[itemId].reviewedValueHash = stableHash(itemId, canonicalSource);

    expect(transitioned).toEqual(expected);
    expect(transitioned.profileReadiness.items[itemId]).toEqual({
      ...beforeItem,
      reviewedValueHash: stableHash(itemId, canonicalSource),
    });
    expect(transitioned.profileReadiness.items[itemId].applicability).toBe(beforeItem.applicability);
    expect(transitioned.profileReadiness.items[itemId].lastReviewedAt).toBe(beforeItem.lastReviewedAt);
    expect(projectProfileReadiness(transitioned, { version: 'org-profile-v3' })
      .items[itemId].state).toBe('reviewed');

    const repeatedCandidate = JSON.parse(JSON.stringify(transitioned));
    const repeated = transitionCompatibleProfileReadiness(transitioned, repeatedCandidate);
    expect(repeated).toBe(repeatedCandidate);
    expect(repeated).toEqual(transitioned);
  });

  test('does not alter readiness metadata on projection, a no-op source write, or missing-to-blank legacy equivalence', () => {
    const profile = configuredProfile();
    delete profile.company.phone;
    const active = withLegacyReview(profile, 'business_contact', {
      email: 'office@example.test', phone: '',
    });
    const beforeRead = JSON.stringify(active);
    expect(projectProfileReadiness(active, { version: 'org-profile-v2' })
      .items.business_contact.state).toBe('reviewed');
    expect(JSON.stringify(active)).toBe(beforeRead);

    const noOp = JSON.parse(JSON.stringify(active));
    const noOpResult = transitionCompatibleProfileReadiness(active, noOp);
    expect(noOpResult).toBe(noOp);
    expect(noOpResult.profileReadiness).toEqual(active.profileReadiness);

    const explicitBlank = JSON.parse(JSON.stringify(active));
    explicitBlank.company.phone = '';
    const blankResult = transitionCompatibleProfileReadiness(active, explicitBlank);
    expect(blankResult).toBe(explicitBlank);
    expect(blankResult.profileReadiness).toEqual(active.profileReadiness);
    expect(projectProfileReadiness(blankResult, { version: 'org-profile-v3' })
      .items.business_contact.state).toBe('reviewed');
  });

  test.each([
    {
      label: 'invalid to valid contact sibling',
      itemId: 'business_contact',
      prepare: profile => {
        profile.company.email = 'not-an-email';
        profile.company.phone = '+1 828 555 0100';
      },
      legacySource: { email: 'not-an-email', phone: '+1 828 555 0100' },
      mutate: profile => { profile.company.email = 'dispatch@example.test'; },
    },
    {
      label: 'valid normalized contact value',
      itemId: 'business_contact',
      prepare: profile => { profile.company.phone = ''; },
      legacySource: { email: 'office@example.test', phone: '' },
      mutate: profile => { profile.company.email = 'dispatch@example.test'; },
    },
    {
      label: 'valid normalized context value',
      itemId: 'business_context',
      prepare: profile => { profile.businessDescription = ''; },
      legacySource: { businessDescription: '', industry: 'Tree care' },
      mutate: profile => { profile.industry = 'Landscaping'; },
    },
  ])('does not transition metadata for a changed qualifying source: $label', ({
    itemId, prepare, legacySource, mutate,
  }) => {
    const source = configuredProfile();
    prepare(source);
    const active = withLegacyReview(source, itemId, legacySource);
    const candidate = JSON.parse(JSON.stringify(active));
    mutate(candidate);
    const result = transitionCompatibleProfileReadiness(active, candidate);
    expect(result).toBe(candidate);
    expect(result.profileReadiness).toEqual(active.profileReadiness);
    expect(projectProfileReadiness(result, { version: 'org-profile-v3' })
      .items[itemId].state).toBe('needs_review');
  });

  test('hashes only qualifying normalized business contact values', () => {
    const profile = configuredProfile();
    profile.company.email = 'office@example.test';
    profile.company.phone = '';
    const reviewed = applyProfileReadinessChanges(profile, [
      { itemId: 'business_contact', action: 'review' },
    ], REVIEWED_AT);

    const blankSiblingChanged = JSON.parse(JSON.stringify(reviewed));
    blankSiblingChanged.company.phone = ' \t\r\n ';
    expect(projectProfileReadiness(blankSiblingChanged, { version: 'org-profile-v2' })
      .items.business_contact).toEqual(expect.objectContaining({
      sourceState: 'configured', state: 'reviewed', lastReviewedAt: REVIEWED_AT.toISOString(),
    }));

    const phoneAuthority = configuredProfile();
    phoneAuthority.company.email = 'not-an-email';
    phoneAuthority.company.phone = '  +1 828 555 0100  ';
    const phoneReviewed = applyProfileReadinessChanges(phoneAuthority, [
      { itemId: 'business_contact', action: 'review' },
    ], REVIEWED_AT);
    phoneReviewed.company.email = 'still-not-an-email';
    phoneReviewed.company.phone = '+1 828 555 0100';
    expect(projectProfileReadiness(phoneReviewed, { version: 'org-profile-v2' })
      .items.business_contact.state).toBe('reviewed');

  });

  test('hashes only qualifying normalized business context values', () => {
    const profile = configuredProfile();
    profile.industry = 'Tree care';
    profile.businessDescription = '';
    const reviewed = applyProfileReadinessChanges(profile, [
      { itemId: 'business_context', action: 'review' },
    ], REVIEWED_AT);

    const blankSiblingChanged = JSON.parse(JSON.stringify(reviewed));
    blankSiblingChanged.businessDescription = '\t \r\n';
    expect(projectProfileReadiness(blankSiblingChanged, { version: 'org-profile-v2' })
      .items.business_context).toEqual(expect.objectContaining({
      sourceState: 'configured', state: 'reviewed', lastReviewedAt: REVIEWED_AT.toISOString(),
    }));

    const trimEquivalent = JSON.parse(JSON.stringify(reviewed));
    trimEquivalent.industry = '  Tree care\r\n';
    expect(projectProfileReadiness(trimEquivalent, { version: 'org-profile-v2' })
      .items.business_context.state).toBe('reviewed');

  });

  test('invalidates changed qualifying normalized contact and context values', () => {
    const reviewed = applyProfileReadinessChanges(configuredProfile(), [
      { itemId: 'business_contact', action: 'review' },
      { itemId: 'business_context', action: 'review' },
    ], REVIEWED_AT);
    reviewed.company.email = 'dispatch@example.test';
    reviewed.industry = 'Landscaping';
    const projection = projectProfileReadiness(reviewed, { version: 'org-profile-v3' });
    for (const itemId of ['business_contact', 'business_context']) {
      expect(projection.items[itemId]).toEqual(expect.objectContaining({
        sourceState: 'configured', state: 'needs_review', lastReviewedAt: REVIEWED_AT.toISOString(),
      }));
    }
  });

  test('preserves Not applicable only while a supported item is structurally unconfigured', () => {
    const profile = configuredProfile();
    profile.routing.dispatchFrom = '';
    profile.serviceArea = { maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [] };
    profile.hours = { holidays: [] };
    delete profile.emergencyPolicy;
    profile.faq = [];
    profile.companyValues = [];
    profile.policies = {};
    profile.canonicalPricing = {};
    delete profile.voiceAssistant;
    const optionalIds = [
      'operating_origin', 'service_area', 'weekly_hours', 'customer_guidance',
      'financial_configuration', 'voice_configuration',
    ];
    const marked = applyProfileReadinessChanges(profile, optionalIds.map(function (itemId) {
      return { itemId, action: 'mark_not_applicable' };
    }), REVIEWED_AT);
    const markedProjection = projectProfileReadiness(marked, { version: 'org-profile-v2' });
    optionalIds.forEach(function (itemId) {
      expect(markedProjection.items[itemId].state).toBe('not_applicable');
    });

    marked.serviceArea.maxRadiusMiles = 10;
    marked.hours.tuesday = { open: '09:00', close: '15:00' };
    marked.emergencyPolicy = 'Call the on-duty owner.';
    marked.canonicalPricing.minimumJobPrice = 0;
    marked.voiceAssistant = { name: 'Guide' };
    marked.routing.dispatchFrom = 'headquarters';
    const configured = projectProfileReadiness(marked, { version: 'org-profile-v3' });
    optionalIds.forEach(function (itemId) {
      expect(configured.items[itemId].applicability).toBe('applicable');
      expect(configured.items[itemId].state).toBe('needs_review');
    });

    marked.routing.dispatchFrom = 'assigned-crew';
    const unavailable = projectProfileReadiness(marked, { version: 'org-profile-v4' });
    expect(unavailable.items.operating_origin.state).toBe('authority_unavailable');
    expect(function () {
      applyProfileReadinessChanges(marked, [
        { itemId: 'operating_origin', action: 'mark_not_applicable' },
      ], REVIEWED_AT);
    }).toThrow(/current configuration/i);
  });

  test('accepts mark_applicable only for an effective Not applicable item and never treats it as review', () => {
    const profile = configuredProfile();
    profile.serviceArea = { maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [] };
    const marked = applyProfileReadinessChanges(profile, [
      { itemId: 'service_area', action: 'mark_not_applicable' },
    ], REVIEWED_AT);
    expect(marked.profileReadiness.items.service_area).toEqual({
      applicability: 'not_applicable',
      lastReviewedAt: null,
      reviewedValueHash: null,
    });
    expect(projectProfileReadiness(marked, { version: 'org-profile-v2' }).items.service_area)
      .toEqual(expect.objectContaining({
        state: 'not_applicable', canMarkApplicable: true, canReview: false, lastReviewedAt: null,
      }));

    const configured = JSON.parse(JSON.stringify(marked));
    configured.serviceArea.maxRadiusMiles = 25;
    const auditorReproduction = projectProfileReadiness(configured, { version: 'org-profile-v3' })
      .items.service_area;
    expect(auditorReproduction).toEqual(expect.objectContaining({
      state: 'needs_review', applicability: 'applicable', canMarkApplicable: false, canReview: true,
    }));
    const beforeRejectedAction = JSON.parse(JSON.stringify(configured));
    expect(function () {
      applyProfileReadinessChanges(configured, [
        { itemId: 'service_area', action: 'mark_applicable' },
      ], new Date('2026-08-09T17:00:00.000Z'));
    }).toThrow(/only while its current state is Not applicable/i);
    expect(configured).toEqual(beforeRejectedAction);

    const cleared = applyProfileReadinessChanges(marked, [
      { itemId: 'service_area', action: 'mark_applicable' },
    ], new Date('invalid'));
    expect(cleared.profileReadiness.items.service_area).toEqual({
      applicability: 'applicable',
      lastReviewedAt: null,
      reviewedValueHash: null,
    });
    expect(projectProfileReadiness(cleared, { version: 'org-profile-v3' }).items.service_area)
      .toEqual(expect.objectContaining({
        state: 'missing', canMarkApplicable: false, canMarkNotApplicable: true,
        canReview: false, lastReviewedAt: null,
      }));
  });

  test('clears historical review provenance when a valid mark_applicable removes a Not applicable override', () => {
    const configured = configuredProfile();
    const reviewed = applyProfileReadinessChanges(configured, [
      { itemId: 'service_area', action: 'review' },
    ], REVIEWED_AT);
    const historical = reviewed.profileReadiness.items.service_area;
    expect(historical).toEqual({
      applicability: 'applicable',
      lastReviewedAt: REVIEWED_AT.toISOString(),
      reviewedValueHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const removed = JSON.parse(JSON.stringify(reviewed));
    removed.serviceArea = {
      maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [],
    };
    const markedNotApplicable = applyProfileReadinessChanges(removed, [
      { itemId: 'service_area', action: 'mark_not_applicable' },
    ], new Date('invalid'));
    expect(markedNotApplicable.profileReadiness.items.service_area).toEqual({
      applicability: 'not_applicable',
      lastReviewedAt: historical.lastReviewedAt,
      reviewedValueHash: historical.reviewedValueHash,
    });
    expect(projectProfileReadiness(markedNotApplicable, { version: 'org-profile-v3' })
      .items.service_area).toEqual(expect.objectContaining({
      state: 'not_applicable', canMarkApplicable: true, lastReviewedAt: historical.lastReviewedAt,
    }));

    const cleared = applyProfileReadinessChanges(markedNotApplicable, [
      { itemId: 'service_area', action: 'mark_applicable' },
    ], new Date('invalid'));
    expect(cleared.profileReadiness.items.service_area).toEqual({
      applicability: 'applicable', lastReviewedAt: null, reviewedValueHash: null,
    });
    expect(projectProfileReadiness(cleared, { version: 'org-profile-v4' }).items.service_area)
      .toEqual(expect.objectContaining({
        state: 'missing', canReview: false, canMarkApplicable: false, lastReviewedAt: null,
      }));

    const restored = JSON.parse(JSON.stringify(cleared));
    restored.serviceArea = JSON.parse(JSON.stringify(configured.serviceArea));
    expect(projectProfileReadiness(restored, { version: 'org-profile-v5' }).items.service_area)
      .toEqual(expect.objectContaining({
        state: 'needs_review', canReview: true, lastReviewedAt: null,
      }));

    const reviewedAgainAt = new Date('2026-08-10T16:00:00.000Z');
    const reviewedAgain = applyProfileReadinessChanges(restored, [
      { itemId: 'service_area', action: 'review' },
    ], reviewedAgainAt);
    expect(reviewedAgain.profileReadiness.items.service_area).toEqual({
      applicability: 'applicable',
      lastReviewedAt: reviewedAgainAt.toISOString(),
      reviewedValueHash: historical.reviewedValueHash,
    });
    expect(projectProfileReadiness(reviewedAgain, { version: 'org-profile-v6' }).items.service_area)
      .toEqual(expect.objectContaining({
        state: 'reviewed', canReview: false, lastReviewedAt: reviewedAgainAt.toISOString(),
      }));
  });

  test('allows operating-origin Not applicable only while dispatch origin is blank', () => {
    const profile = configuredProfile();
    profile.routing.dispatchFrom = '';
    profile.headquarters = { additionalOffices: [] };
    const marked = applyProfileReadinessChanges(profile, [
      { itemId: 'operating_origin', action: 'mark_not_applicable' },
    ], REVIEWED_AT);
    expect(projectProfileReadiness(marked, { version: 'org-profile-v2' }).items.operating_origin.state)
      .toBe('not_applicable');

    marked.routing.dispatchFrom = 'headquarters';
    let projection = projectProfileReadiness(marked, { version: 'org-profile-v3' });
    expect(projection.items.operating_origin.state).toBe('missing');
    expect(projection.items.operating_origin.applicability).toBe('applicable');
    expect(projection.items.operating_origin.canMarkNotApplicable).toBe(false);
    expect(function () {
      applyProfileReadinessChanges(marked, [
        { itemId: 'operating_origin', action: 'mark_not_applicable' },
      ], REVIEWED_AT);
    }).toThrow(/current configuration/i);

    marked.routing.dispatchFrom = 'nearest-office';
    projection = projectProfileReadiness(marked, { version: 'org-profile-v4' });
    expect(projection.items.operating_origin.state).toBe('missing');
    expect(projection.items.operating_origin.canMarkNotApplicable).toBe(false);
  });

  test('strictly rejects unknown properties, IDs, duplicate IDs, client metadata, and invalid actions', () => {
    const valid = {
      expectedVersion: 'org-profile-v7',
      changes: [{ itemId: 'company_identity', action: 'review' }],
    };
    expect(parseProfileReadinessWrite(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, reviewedAt: REVIEWED_AT.toISOString() },
      { expectedVersion: 7, changes: valid.changes },
      { expectedVersion: 'org-profile-v7', changes: [] },
      { expectedVersion: 'org-profile-v7', changes: [{ itemId: 'unknown', action: 'review' }] },
      { expectedVersion: 'org-profile-v7', changes: [
        { itemId: 'company_identity', action: 'review' },
        { itemId: 'company_identity', action: 'review' },
      ] },
      { expectedVersion: 'org-profile-v7', changes: [
        { itemId: 'company_identity', action: 'review', lastReviewedAt: REVIEWED_AT.toISOString() },
      ] },
      { expectedVersion: 'org-profile-v7', changes: [
        { itemId: 'company_identity', action: 'review', reviewedValueHash: 'a'.repeat(64) },
      ] },
      { expectedVersion: 'org-profile-v7', changes: [{ itemId: 'company_identity', action: 'complete' }] },
    ]) {
      expect(function () { parseProfileReadinessWrite(invalid); }).toThrow();
    }
    expect(function () {
      applyProfileReadinessChanges(configuredProfile(), [
        { itemId: 'company_identity', action: 'mark_not_applicable' },
      ], REVIEWED_AT);
    }).toThrow(/cannot be marked Not applicable/);
  });

  test('treats hostile Unicode and CRLF content as data without exposing raw values in the projection', () => {
    const profile = configuredProfile();
    const original = JSON.parse(JSON.stringify(profile));
    global.__profileReadinessXss = 0;
    const first = applyProfileReadinessChanges(profile, [
      { itemId: 'customer_guidance', action: 'review' },
      { itemId: 'voice_configuration', action: 'review' },
    ], REVIEWED_AT);
    const second = applyProfileReadinessChanges(profile, [
      { itemId: 'customer_guidance', action: 'review' },
      { itemId: 'voice_configuration', action: 'review' },
    ], REVIEWED_AT);
    expect(first).toEqual(second);
    expect(profile).toEqual(original);
    expect(global.__profileReadinessXss).toBe(0);
    const projection = projectProfileReadiness(first, { version: 'org-profile-v2' });
    expect(projection.items.customer_guidance.state).toBe('reviewed');
    expect(projection.items.voice_configuration.state).toBe('reviewed');
    expect(JSON.stringify(projection)).not.toContain('<img src=x onerror=never()>');
    expect(JSON.stringify(projection)).not.toContain('<svg onload=never()>');
    delete global.__profileReadinessXss;
  });

  test('uses one categorical result regardless of day, guidance, or service quantity', () => {
    const one = configuredProfile();
    const many = configuredProfile();
    many.services.push({ id: 'stump-grinding', name: 'Stump Grinding', active: true });
    many.faq.push('Second FAQ', 'Third FAQ');
    for (const day of ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
      many.hours[day] = { open: '08:00', close: '17:00' };
    }
    const oneProjection = projectProfileReadiness(one, { version: 'org-profile-v1' });
    const manyProjection = projectProfileReadiness(many, { version: 'org-profile-v1' });
    expect(oneProjection.items.active_services.state).toBe('needs_review');
    expect(manyProjection.items.active_services.state).toBe('needs_review');
    expect(oneProjection.items.weekly_hours.state).toBe('needs_review');
    expect(manyProjection.items.weekly_hours.state).toBe('needs_review');
    expect(oneProjection.items.customer_guidance.state).toBe('needs_review');
    expect(manyProjection.items.customer_guidance.state).toBe('needs_review');
    expect(oneProjection.overallState).toBe(manyProjection.overallState);
  });

  test('keeps stable-ID source hashes deterministic when keyed collections are reordered', () => {
    const profile = configuredProfile();
    profile.routing.dispatchFrom = 'nearest-office';
    profile.services.push({ id: 'stump-grinding', name: 'Stump Grinding', active: true });
    profile.headquarters.additionalOffices.push({
      id: 'office-east', name: 'East', latitude: 35.7, longitude: -82.4,
    });
    profile.voiceAssistant.escalationRules = { rules: [
      { id: 'safety', enabled: true, when: 'Safety concern', action: 'take_message' },
      { id: 'urgent', enabled: true, when: 'Urgent request', action: 'request_callback' },
    ] };
    const reviewed = reviewAll(profile);
    reviewed.services.reverse();
    reviewed.headquarters.additionalOffices.reverse();
    reviewed.voiceAssistant.escalationRules.rules.reverse();
    const projection = projectProfileReadiness(reviewed, { version: 'org-profile-v2' });
    for (const itemId of ['active_services', 'operating_origin', 'voice_configuration']) {
      expect(projection.items[itemId].state).toBe('reviewed');
    }
  });

  test('hashes only qualifying nearest-office sources and invalidates when that authority changes', () => {
    const profile = configuredProfile();
    profile.routing.dispatchFrom = 'nearest-office';
    profile.headquarters.additionalOffices.push({
      name: 'Nonqualifying draft', city: 'Nowhere', country: 'US',
    });
    expect(validateRawBusinessProfile(profile)).toEqual([]);
    const reviewed = applyProfileReadinessChanges(profile, [
      { itemId: 'operating_origin', action: 'review' },
    ], REVIEWED_AT);
    expect(projectProfileReadiness(reviewed, { version: 'org-profile-v2' }).items.operating_origin.state)
      .toBe('reviewed');

    const nonqualifyingChanged = JSON.parse(JSON.stringify(reviewed));
    nonqualifyingChanged.headquarters.additionalOffices[0].latitude = 36.5;
    nonqualifyingChanged.headquarters.additionalOffices[0].unrecognized = 'ignored sibling detail';
    nonqualifyingChanged.headquarters.additionalOffices[1].name = 'Changed nonqualifying draft';
    nonqualifyingChanged.headquarters.additionalOffices[1].city = 'Still nowhere';
    expect(validateRawBusinessProfile(nonqualifyingChanged)).toEqual([]);
    nonqualifyingChanged.headquarters.additionalOffices[1].unrecognized = '<img src=x onerror=never()>';
    expect(projectProfileReadiness(nonqualifyingChanged, { version: 'org-profile-v3' })
      .items.operating_origin).toEqual(expect.objectContaining({
      sourceState: 'configured', state: 'reviewed', lastReviewedAt: REVIEWED_AT.toISOString(),
    }));

    const qualifyingChanged = JSON.parse(JSON.stringify(nonqualifyingChanged));
    qualifyingChanged.headquarters.additionalOffices[0].street = '22 West Street';
    expect(projectProfileReadiness(qualifyingChanged, { version: 'org-profile-v4' })
      .items.operating_origin).toEqual(expect.objectContaining({
      sourceState: 'configured', state: 'needs_review', lastReviewedAt: REVIEWED_AT.toISOString(),
    }));
  });

  test('does not alter the normalized calculation input hash when only readiness metadata changes', () => {
    const profile = configuredProfile();
    const reviewed = reviewAll(profile);
    const before = adaptBusinessProfile(profile, 'org-profile-v9');
    const after = adaptBusinessProfile(reviewed, 'org-profile-v9');
    expect(after).toEqual(before);
    expect(after.hash).toBe(before.hash);
  });
});
