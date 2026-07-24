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
    ])('does not dispatch on negated, resolved, or history-only evidence: %s', function (statement) {
      const result = actionFor(statement);
      expect(result.evidence).toEqual({ isEmergency: false, signal: null, evidence: null });
      expect(result.action.action).not.toBe('Dispatch immediately');
    });

    test.each([
      ['Water is rising and the room is flooding right now.', 'active flooding'],
      ['The pipe burst and it is gushing everywhere.', 'uncontrolled leak'],
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
