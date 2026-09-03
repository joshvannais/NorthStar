'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildContextResponse,
} = require('../../src/polaris/assistantContract');
const trustedPresentation = require('../../public/js/polaris-trusted-presentation');
const browserCard = require('../../public/js/polaris-native-card');

const ORG = 'a1000000-0000-4000-8000-000000000001';
const USER = 'a2000000-0000-4000-8000-000000000001';
const LEAD = 'a3000000-0000-4000-8000-000000000001';
const CUSTOMER = 'a4000000-0000-4000-8000-000000000001';
const GRAPH = 'a5000000-0000-4000-8000-000000000001';
const SNAPSHOT = 'a6000000-0000-4000-8000-000000000001';
const FACT = 'a7000000-0000-4000-8000-000000000001';
const REQUEST = 'a8000000-0000-4000-8000-000000000001';
const MESSAGE = 'a9000000-0000-4000-8000-000000000001';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function authority() {
  return { organizationId: ORG, userId: USER, role: 'owner' };
}

function selected() {
  return { kind: 'lead', id: LEAD };
}

function canonicalItem() {
  return {
    ids: {
      graph: GRAPH,
      customer: CUSTOMER,
      opportunity: LEAD,
      appointment: null,
      polarisSnapshot: SNAPSHOT,
    },
    customer: { name: 'Canonical customer' },
    opportunity: { serviceType: 'HVAC', scope: 'Inspect the system.' },
    estimate: { customerPrice: null },
    appointment: { scheduledStart: null },
    facts: [
      {
        id: FACT,
        variable: 'return_air',
        status: 'accepted',
        normalizedValue: '74 F',
        evidenceText: 'Return air measured 74 F.',
        confidence: 0.8,
      },
      {
        id: 'a7000000-0000-4000-8000-000000000002',
        variable: 'supply_air',
        status: 'accepted',
        normalizedValue: '56 F',
        evidenceText: 'Supply air measured 56 F.',
        confidence: 0.6,
      },
    ],
    snapshot: { notCalculated: ['margin', 'tax'] },
    snapshotDigest: 'a'.repeat(64),
    projectionDigest: 'b'.repeat(64),
    calculationVersion: 'binding-test-v1',
    readModelVersion: 'm22-part1-read-v1',
  };
}

function canonicalResponse() {
  return clone(buildContextResponse(canonicalItem(), selected(), authority(), REQUEST));
}

function secondCard(first) {
  const result = clone(first);
  result.authority.graphId = 'a5000000-0000-4000-8000-000000000002';
  result.authority.snapshotId = 'a6000000-0000-4000-8000-000000000002';
  result.authority.snapshotDigest = 'c'.repeat(64);
  result.authority.projectionDigest = 'd'.repeat(64);
  result.evidence[0].id = 'a7000000-0000-4000-8000-000000000003';
  result.evidence[0].source.id = result.evidence[0].id;
  result.evidence[0].confidence = 0.5;
  result.unknowns = result.unknowns.slice().reverse();
  return result;
}

function withCards(cards, intent = 'canonical_overview') {
  const response = canonicalResponse();
  const projected = trustedPresentation.projectTrustedDisplay(cards, response.selected, intent);
  response.cards = clone(projected.cards);
  response.answer = clone(projected.answer);
  return response;
}

function wireResponse(canonical, source = 'openai') {
  const response = clone(canonical);
  response.requestId = MESSAGE;
  response.responseId = 'e'.repeat(64);
  response.source = source;
  response.provider = source === 'openai'
    ? { state: 'configured', requestsSent: 1 }
    : { state: 'unconfigured', requestsSent: 0 };
  return response;
}

function reproject(response, intent = 'canonical_overview') {
  const projected = trustedPresentation.projectTrustedDisplay(response.cards, response.selected, intent);
  response.cards = clone(projected.cards);
  response.answer = clone(projected.answer);
  return response;
}

function expected(backing) {
  return {
    requestId: MESSAGE,
    selected: selected(),
    authority: authority(),
    messageResponse: true,
    canonicalBacking: backing,
  };
}

function assertRejected(mutator, canonical = canonicalResponse()) {
  const backing = typeof browserCard.captureCanonicalBacking === 'function'
    ? browserCard.captureCanonicalBacking(canonical, {
      selected: selected(), authority: authority(), source: 'canonical_local',
    })
    : clone(canonical);
  const response = wireResponse(canonical);
  mutator(response);
  expect(() => browserCard.validateAssistantResponse(response, expected(backing)))
    .toThrow('Unsupported Polaris structured contract.');
}

describe('P6 browser immutable canonical-backing relation', () => {
  test('paid page retains and invalidates one selected-record canonical backing across message and account epochs', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboard', 'polaris.html'), 'utf8');
    expect(html).toMatch(/var\s+activeCanonicalBacking\s*=\s*null/);
    expect(html).toMatch(/var\s+activeAccountAuthority\s*=\s*null/);
    expect(html).toMatch(/var\s+contextGeneration\s*=\s*0/);
    expect(html).toMatch(/captureCanonicalBacking\s*\(/);
    expect(html).toMatch(/canonicalBacking:\s*messageBacking/);
    expect(html).toMatch(/messageResponse:\s*true/);
    expect(html).toMatch(/window\.addEventListener\('popstate',\s*renderSelectedContext\)/);
    expect(html).toMatch(/event\.persisted[\s\S]{0,200}renderSelectedContext\(\)/);
  });

  test('captures a detached deeply immutable already-validated canonical projection', () => {
    const canonical = canonicalResponse();
    expect(typeof browserCard.captureCanonicalBacking).toBe('function');
    const backing = browserCard.captureCanonicalBacking(canonical, {
      selected: selected(), authority: authority(), source: 'canonical_local',
    });
    expect(backing).not.toBe(canonical);
    expect(backing.cards).not.toBe(canonical.cards);
    expect(Object.isFrozen(backing)).toBe(true);
    expect(Object.isFrozen(backing.cards)).toBe(true);
    expect(Object.isFrozen(backing.cards[0].authority)).toBe(true);
    expect(Object.isFrozen(backing.cards[0].evidence[0].source)).toBe(true);
    canonical.cards[0].confidence.value = 0.01;
    expect(backing.cards[0].confidence.value).toBe(0.7);
  });

  test.each([
    ['confidence value', response => { response.cards[0].confidence.value = 0.01; }],
    ['confidence level', response => { response.cards[0].confidence.level = 'low'; }],
    ['snapshot digest', response => { response.cards[0].authority.snapshotDigest = 'f'.repeat(64); }],
    ['projection digest', response => { response.cards[0].authority.projectionDigest = 'f'.repeat(64); }],
    ['graph id', response => { response.cards[0].authority.graphId = 'b5000000-0000-4000-8000-000000000001'; }],
    ['snapshot id', response => { response.cards[0].authority.snapshotId = 'b6000000-0000-4000-8000-000000000001'; }],
    ['calculation version', response => { response.cards[0].authority.calculationVersion = 'forged-v2'; }],
    ['read-model version', response => { response.cards[0].authority.readModelVersion = 'forged-v2'; }],
    ['evidence id', response => { response.cards[0].evidence[0].id = 'unauthorized-reference'; }],
    ['evidence source id', response => { response.cards[0].evidence[0].source.id = 'unauthorized-reference'; }],
    ['evidence source kind', response => { response.cards[0].evidence[0].source.kind = 'deterministic_demo'; }],
    ['evidence untrusted marker', response => { response.cards[0].evidence[0].untrustedText = false; }],
    ['evidence confidence with locally reprojected display', response => {
      response.cards[0].evidence[0].confidence = 0.25;
      reproject(response);
    }],
    ['unknown code with locally reprojected display', response => {
      response.cards[0].unknowns[2].code = 'not_calculated_99';
      reproject(response);
    }],
    ['response authority organization', response => { response.authority.organizationId = 'b1000000-0000-4000-8000-000000000001'; }],
    ['response authority user', response => { response.authority.userId = 'b2000000-0000-4000-8000-000000000001'; }],
    ['response authority role', response => { response.authority.role = 'admin'; }],
    ['advisory marker', response => { response.cards[0].advisoryOnly = false; }],
    ['canonical-mutation marker', response => { response.cards[0].canonicalMutationAllowed = true; }],
  ])('rejects a candidate-derived forged %s against independent backing', (_label, mutate) => {
    assertRejected(mutate);
  });

  test('rejects evidence and unknown ordering changes even after fixed copy is regenerated from the candidate', () => {
    assertRejected(response => {
      response.cards[0].evidence.reverse();
      response.cards[0].unknowns.reverse();
      reproject(response);
    });
  });

  test('rejects card order and cardinality changes against a positive multi-card backing', () => {
    const one = canonicalResponse().cards[0];
    const canonical = withCards([one, secondCard(one)]);
    assertRejected(response => {
      response.cards.reverse();
      reproject(response);
    }, canonical);
    assertRejected(response => {
      response.cards.pop();
      reproject(response);
    }, canonical);
  });

  test('rejects forged counts, request identity, message source, provider accounting, and response identity', () => {
    assertRejected(response => { response.answer.evidenceCount += 1; });
    assertRejected(response => { response.requestId = REQUEST; });
    assertRejected(response => {
      response.source = 'canonical_local';
      response.provider = { state: 'unconfigured', requestsSent: 0 };
    });
    assertRejected(response => { response.provider.requestsSent = 0; });
    assertRejected(response => { response.responseId = 'not-a-digest'; });
  });

  test('rejects extra, missing, accessor, symbol, foreign-prototype, sparse, and oversized nested values', () => {
    assertRejected(response => { response.cards[0].authority.extra = true; });
    assertRejected(response => { delete response.cards[0].authority.snapshotDigest; });
    assertRejected(response => {
      Object.defineProperty(response.cards[0].confidence, 'value', {
        enumerable: true, get: () => 0.7,
      });
    });
    assertRejected(response => { response.cards[0].evidence[0][Symbol('forged')] = true; });
    assertRejected(response => { Object.setPrototypeOf(response.cards[0].authority, { forged: true }); });
    assertRejected(response => { delete response.cards[0].evidence[0]; });
    assertRejected(response => {
      response.cards[0].unknowns = Array.from({ length: 13 }, () => clone(response.cards[0].unknowns[0]));
    });
  });

  test('accepts an exact openai or interceptor wire response backed by multi-card canonical authority', () => {
    const one = canonicalResponse().cards[0];
    const canonical = withCards([one, secondCard(one)], 'business_operations_reference');
    const backing = browserCard.captureCanonicalBacking(canonical, {
      selected: selected(), authority: authority(), source: 'canonical_local',
    });
    for (const source of ['openai', 'interceptor']) {
      const response = wireResponse(canonical, source);
      expect(browserCard.validateAssistantResponse(response, expected(backing))).toBe(response);
    }
  });

  test('accepts exact empty and unknown canonical projections without inventing relations', () => {
    const canonical = canonicalResponse();
    canonical.selected = null;
    canonical.cards = [];
    canonical.answer = clone(trustedPresentation.projectTrustedDisplay([], null, 'unknowns_review').answer);
    const backing = browserCard.captureCanonicalBacking(canonical, {
      selected: null, authority: authority(), source: 'canonical_local',
    });
    const response = wireResponse(canonical, 'interceptor');
    expect(browserCard.validateAssistantResponse(response, {
      requestId: MESSAGE,
      selected: null,
      authority: authority(),
      messageResponse: true,
      canonicalBacking: backing,
    })).toBe(response);
  });
});
