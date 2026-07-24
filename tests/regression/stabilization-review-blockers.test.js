'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pipeline = require('../../src/routes/simulation/pipeline');
const canonicalPolaris = require('../../src/services/canonicalPolaris');
const demoScope = require('../../src/services/demoRecordScope');

describe('independent-review stabilization blockers', function () {
  describe('affirmative emergency evidence', function () {
    function actionFor(customerText, aiText) {
      const transcript = [
        { speaker: 'ai', text: aiText || 'Is this an emergency or is anything sparking?' },
        { speaker: 'customer', text: customerText },
      ];
      const evidence = pipeline.detectEmergencyEvidence(transcript);
      return {
        evidence: evidence,
        action: pipeline.selectAction(transcript, 'Review Customer', { urgency: 'emergency' }, evidence),
      };
    }

    test.each([
      'Not an emergency. It is a slow drip and can wait until tomorrow.',
      'There is no burning smell or smoke, just a breaker that tripped.',
      'It was flooding yesterday but stopped after I shut the valve.',
      'The old pipe used to leak, but it was already fixed.',
      'The sink has a slow leak. Tomorrow is fine.',
      'The outlet sparked last week and has already been fixed.',
      'There is no present danger and nothing is sparking.',
    ])('does not dispatch on negated, resolved, or history-only evidence: %s', function (statement) {
      const result = actionFor(statement);
      expect(result.evidence).toEqual({ isEmergency: false, signal: null, evidence: null });
      expect(result.action.action).not.toBe('Dispatch immediately');
    });

    test.each([
      ['Water is rising and the room is flooding right now.', 'active flooding'],
      ['The pipe burst and it is gushing everywhere.', 'uncontrolled leak'],
      ['There is an uncontrolled leak right now.', 'uncontrolled leak'],
      ["We can't stop the leak.", 'uncontrolled leak'],
      ['We cannot stop the leak.', 'uncontrolled leak'],
      ['The outlet is sparking when I touch the switch.', 'electrical sparking'],
      ['I smell something burning and there is smoke.', 'burning or smoke'],
      ['This is unsafe right now and someone could be in danger.', 'immediate danger'],
    ])('dispatches only on supported current customer evidence: %s', function (statement, signal) {
      const result = actionFor(statement, 'Please describe the problem.');
      expect(result.evidence).toMatchObject({
        isEmergency: true,
        signal: signal,
        evidence: statement.replace(/[.!?]+$/, ''),
      });
      expect(result.action).toMatchObject({ action: 'Dispatch immediately', priority: 'critical' });
    });

    test.each([
      ['CUSTOMER', 'The sink is not leaking, but the outlet is sparking right now.', 'electrical sparking'],
      ['Caller', 'There is no smoke; however, I smell something burning now.', 'burning or smoke'],
      ['CLIENT', 'The old leak is resolved, yet a pipe burst and water is gushing everywhere.', 'uncontrolled leak'],
      ['HomeOwner', 'It was flooding yesterday, but water is rising in the room right now.', 'active flooding'],
    ])('normalizes customer aliases and evaluates mixed clauses independently', function (speaker, statement, signal) {
      const transcript = [
        { speaker: 'AI', text: 'Is this an emergency or is anything sparking?' },
        { speaker: speaker, text: statement },
      ];
      expect(pipeline.detectEmergencyEvidence(transcript)).toMatchObject({
        isEmergency: true,
        signal: signal,
      });
    });

    test.each([
      ["The outlet isn't sparking."],
      ['The outlet isn’t sparking.'],
      ["The basement isn't flooding."],
      ['The basement isn’t flooding.'],
      ["The outlets aren't sparking."],
      ["The outlet wasn't sparking."],
      ["The basement wasn't flooding."],
      ["The outlets weren't sparking."],
      ['It was sparking yesterday but was repaired.'],
      ['This is not an emergency.'],
      ['It is a slow drip and next-day scheduling is fine.'],
    ])('handles local contractions and historical or slow conditions: %s', function (statement) {
      expect(actionFor(statement).evidence).toEqual({
        isEmergency: false,
        signal: null,
        evidence: null,
      });
    });

    test.each(['customer', 'Customer', 'CUSTOMER'])(
      'preserves exact affirmative clause for %s speaker labels',
      function (speaker) {
        const transcript = [
          { speaker: 'agent', text: 'Emergency, smoke, flooding, sparking, leak, and danger?' },
          { speaker: speaker, text: 'No smoke, but the outlet is sparking right now.' },
        ];
        expect(pipeline.detectEmergencyEvidence(transcript)).toEqual({
          isEmergency: true,
          signal: 'electrical sparking',
          evidence: 'the outlet is sparking right now',
        });
      }
    );

    test('resolved contrast clause does not suppress a current flooding clause', function () {
      expect(pipeline.detectEmergencyEvidence([
        { speaker: 'customer', text: 'The leak stopped briefly, but the basement is flooding again.' },
      ])).toEqual({
        isEmergency: true,
        signal: 'active flooding',
        evidence: 'the basement is flooding again',
      });
    });

    test.each(['AI', 'agent', 'assistant', 'system'])(
      'never treats a %s prompt as customer evidence',
      function (speaker) {
        expect(pipeline.detectEmergencyEvidence([
          { speaker: speaker, text: 'This is an emergency: the outlet is sparking and the room is flooding.' },
          { speaker: 'customer', text: 'No present danger. Tomorrow is fine.' },
        ])).toEqual({ isEmergency: false, signal: null, evidence: null });
      }
    );

    test('canonical pricing uses the same evidence decision instead of urgency keywords', function () {
      function build(emergencyEvidence) {
        return canonicalPolaris.build({
          serviceKey: 'concrete',
          classification: { service: 'Concrete', confidence: 'high', alternatives: [] },
          scope: {
            jobType: 'install',
            squareFeet: 400,
            finish: 'broom finish',
            existingRemoval: false,
            access: 'truck access',
            urgency: 'emergency',
          },
          evidence: {
            jobType: 'Customer requested installation.',
            squareFeet: 'Customer stated 400 square feet.',
            finish: 'Customer requested broom finish.',
          },
          missingInformation: [],
          pricing: {
            total: 1000,
            breakdown: [{ label: 'Concrete installation', amount: 1000 }],
            range: { low: 900, high: 1100 },
          },
          confidence: { score: 90, explanation: 'Fixture scope is supported.' },
          recommendedAction: { action: 'Review and schedule', priority: 'medium' },
          emergencyEvidence: emergencyEvidence,
          businessProfile: { financial: { markup: 1.2, emergencyMarkup: 1.5 } },
        });
      }

      const negative = build({ isEmergency: false });
      expect(negative.urgency).toBe('not established');
      expect(negative.pricingBreakdown.map(function (item) { return item.category; }))
        .toEqual(['internalCost', 'markup']);
      expect(negative.customerFacingPrice).toBe(1200);

      const positive = build({ isEmergency: true });
      expect(positive.urgency).toBe('emergency');
      expect(positive.pricingBreakdown.map(function (item) { return item.category; }))
        .toEqual(['internalCost', 'markup', 'emergencyAdjustment']);
      expect(positive.customerFacingPrice).toBe(1800);
    });
  });

  describe('legacy fixture safety', function () {
    beforeEach(function () { demoScope.resetLegacyIndexForTests(); });

    test('a real tenant record is never hidden by a simulation-like subject prefix', function () {
      const real = {
        id: 'comm-real-owner-entered',
        customerId: 'cust-real-owner-entered',
        subject: 'Simulated call from Real Tenant Customer',
        metadata: {},
      };
      expect(demoScope.getSessionId(real)).toBeNull();
      expect(demoScope.isSimulation(real)).toBe(false);
      expect(demoScope.canAccess(real, null)).toBe(true);
    });

    test('tenant access defaults deny for unowned and other-organization file records', function () {
      const access = {
        organizationId: 'org-a',
        userId: 'owner-a',
        sessionId: 'session-a',
        enforceOwner: true,
      };
      expect(demoScope.canAccessTenant(
        { id: 'tenant-a', organizationId: 'org-a', subject: 'Simulated call from a real customer' },
        access
      )).toBe(true);
      expect(demoScope.canAccessTenant({ id: 'unowned' }, access)).toBe(false);
      expect(demoScope.canAccessTenant({ id: 'tenant-b', organization_id: 'org-b' }, access)).toBe(false);
      expect(demoScope.canAccessTenant(
        {
          id: 'session-a',
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
        },
        access
      )).toBe(true);
      expect(demoScope.canAccessTenant(
        {
          id: 'wrong-session',
          source: 'simulation',
          simulationSessionId: 'session-b',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
        },
        access
      )).toBe(false);
    });

    test('the exact committed legacy fixtures remain narrowly classified', function () {
      const fixture = {
        id: 'comm_1784653727575_1',
        customerId: 'cust_1784653727574_1',
        subject: 'Simulated call from Sarah Thomas',
        metadata: {},
      };
      expect(demoScope.getSessionId(fixture)).toBe(demoScope.LEGACY_SESSION_ID);
      expect(demoScope.isSimulation(fixture)).toBe(true);
    });
  });

  describe('browser tab session lifecycle', function () {
    function run(navigationType, storage, name, opener) {
      const code = fs.readFileSync(path.join(__dirname, '../../public/js/demo-session.js'), 'utf8');
      const window = {
        name: name || '',
        opener: opener || null,
        performance: {
          getEntriesByType: function (type) {
            return type === 'navigation' ? [{ type: navigationType }] : [];
          },
        },
        sessionStorage: {
          getItem: function (key) { return storage.has(key) ? storage.get(key) : null; },
          setItem: function (key, value) { storage.set(key, value); },
        },
      };
      vm.runInNewContext(code, {
        window: window,
        Date: Date,
        Math: Math,
        RegExp: RegExp,
        Boolean: Boolean,
        String: String,
        Object: Object,
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
      });
      return { api: window.NorthStarDemoSession, name: window.name };
    }

    test('same-tab and restored navigation persist, opener-created tab rotates, reload rotates', function () {
      const parentStorage = new Map();
      const parent = run('navigate', parentStorage, '', null);
      const navigation = run('navigate', parentStorage, parent.name, null);
      const restored = run('back_forward', parentStorage, navigation.name, null);
      expect(navigation.api.id).toBe(parent.api.id);
      expect(restored.api.id).toBe(parent.api.id);
      expect(restored.api.tabId).toBe(parent.api.tabId);

      const childStorage = new Map(parentStorage);
      const child = run('navigate', childStorage, '', {});
      expect(child.api.id).not.toBe(parent.api.id);
      expect(child.api.tabId).not.toBe(parent.api.tabId);

      const reloaded = run('reload', parentStorage, restored.name, null);
      expect(reloaded.api.id).not.toBe(parent.api.id);
      expect(reloaded.api.tabId).toBe(parent.api.tabId);
    });
  });
});
