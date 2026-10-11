'use strict';

const fs = require('node:fs');
const path = require('node:path');
const money = require('../../src/customerFinancial/exactMoney');
const numbering = require('../../src/customerFinancial/numberingPolicyRepository');
const grantIssuer = require('../../src/customerFinancial/launchCapabilityGrantIssuer');

const ROOT = path.resolve(__dirname, '..', '..');
const read = value => fs.readFileSync(path.join(ROOT, value), 'utf8');

describe('Mission 27 Part 2C exact money and numbering contract', () => {
  test('normalizes exact USD without binary arithmetic and preserves zero', () => {
    expect(money.fromDecimal('10971.42')).toEqual({ version: 'm27-exact-money-v1',
      currency: 'USD', minorUnitExponent: 2, minorUnits: '1097142',
      decimal: '10971.42', exactZero: false });
    expect(money.fromMinorUnits('0')).toMatchObject({ minorUnits: '0', decimal: '0.00',
      exactZero: true });
    expect(money.fromDecimal('-281.4')).toMatchObject({ minorUnits: '-28140',
      decimal: '-281.40', exactZero: false });
    expect(money.add([money.fromDecimal('10.05'), money.fromDecimal('-0.05')]))
      .toMatchObject({ minorUnits: '1000', decimal: '10.00' });
  });

  test('rejects floats, excess precision, foreign currency and inconsistent evidence', () => {
    expect(() => money.fromMinorUnits(10)).toThrow('canonical base-10 integer string');
    expect(() => money.fromDecimal('1.001')).toThrow('no more than two fractional digits');
    expect(() => money.fromDecimal('1.00', 'CAD')).toThrow('Only exact USD is supported');
    expect(() => money.verify({ ...money.fromDecimal('1.00'), decimal: '1.01' }))
      .toThrow('Exact money evidence is invalid');
  });

  test('ratifies fixed owner-reviewed numbering and private lifecycle primitives', () => {
    const sql = read('migrations/262_customer_financial_exact_money_numbering_v1.sql');
    expect(sql).toContain("'invoice',jsonb_build_object('prefix','INV-','width',10");
    expect(sql).toContain("'credit',jsonb_build_object('prefix','CR-','width',10");
    expect(sql).toContain("'receipt',jsonb_build_object('prefix','RCT-','width',10");
    expect(sql).toContain("'reuseAllowed',FALSE,'gapsAllowed',TRUE,'yearResetAllowed',FALSE");
    expect(sql).toContain("capability='customer_financial.document_numbering.review'");
    expect(sql).not.toContain("capability='customer_financial.source.review'");
    expect(sql).toContain("reviewed_by_access_role='owner'");
    expect(sql).toMatch(/ON CONFLICT\(organization_id,document_class\) DO UPDATE[\s\S]*next_sequence=/);
    expect(sql).toContain("expected_state_value='issued' AND new_state_value<>'void'");
    expect(sql).toContain('canonical_customer_financial_numbering_v1_recover');
    expect(sql).toContain('canonical_customer_financial_numbering_v1_reservation_event_projection');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.canonical_customer_financial_numbering_v1_reservation_event_projection/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.canonical_customer_financial_numbering_v1_(?:reserve|transition|recover)/);
    expect(sql).not.toMatch(/INSERT INTO public\.canonical_(?:invoices|payments|estimates|appointments)/i);
    expect(numbering.CAPABILITY).toBe('customer_financial.document_numbering.review');
    expect(numbering.BUSINESS_PURPOSE).toBe('customer_financial.document_numbering');
    expect(numbering.POLICY_VERSION).toBe('mission27.document_numbering.v1');
    expect(numbering.POLICY_DIGEST).toBe(
      '2b98aa283e4b3ad464419c7f8cb964892fc2fe28cbc6b7afdbac94ddc194b041');
    expect(numbering.PREDECESSOR_POLICY_VERSION).toBe('mission27.launch.v1');
    expect(sql).toContain("action_mode TEXT NOT NULL CHECK(action_mode='single_control')");
    expect(sql).toContain("assurance TEXT NOT NULL CHECK(assurance='current_session')");
    expect(sql).toContain("policy_version='mission27.document_numbering.v1'");
    expect(sql).toContain("predecessor_policy_version='mission27.launch.v1'");
    const names = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('264_customer_financial_editable_estimate_basis_v1.sql');
    expect(names.filter(name => /^262_/.test(name))).toHaveLength(1);
  });

  test('requires conforming owner-template capability issuance and machine classification', () => {
    expect(grantIssuer.classifyNumberingReviewPolicy()).toEqual({
      capability: 'customer_financial.document_numbering.review',
      targetClass: 'tenant_document_numbering_policy',
      businessPurpose: 'customer_financial.document_numbering',
      policyVersion: 'mission27.document_numbering.v1',
      policyDigest: '2b98aa283e4b3ad464419c7f8cb964892fc2fe28cbc6b7afdbac94ddc194b041',
      templateVersion: 'm27.document_numbering.owner.v1',
      predecessorPolicyVersion: 'mission27.launch.v1',
      predecessorPolicyDigest: 'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a',
      actionMode: 'single_control', assurance: 'current_session',
    });
    const predecessor = JSON.parse(read('config/mission27-launch-contract.v1.json'));
    const policy = JSON.parse(read('config/mission27-document-numbering-policy.v1.json'));
    expect(predecessor.contractVersion).toBe('mission27.launch.v1');
    expect(predecessor.team.ownerDefaultCapabilities).toHaveLength(25);
    expect(Object.keys(predecessor.actionControl)).toHaveLength(25);
    expect(predecessor.team.ownerDefaultCapabilities).not.toContain(grantIssuer.CAPABILITY);
    expect(predecessor.actionControl).not.toHaveProperty(grantIssuer.CAPABILITY);
    expect(grantIssuer.canonicalDigest(predecessor)).toBe(grantIssuer.PREDECESSOR_POLICY_DIGEST);
    expect(grantIssuer.canonicalDigest(policy)).toBe(grantIssuer.POLICY_DIGEST);
    expect(read('src/customerFinancial/billingIdentityRepository.js'))
      .toContain("const POLICY_VERSION = 'mission27.launch.v1';");
    expect(read('src/customerFinancial/billingIdentityReviewRepository.js'))
      .toContain("const POLICY_VERSION = 'mission27.launch.v1';");
    const omittedTemplate = structuredClone(policy);
    omittedTemplate.template.capabilities = omittedTemplate.template.capabilities
      .filter(value => value !== grantIssuer.CAPABILITY);
    expect(() => grantIssuer.classifyNumberingReviewPolicy(omittedTemplate))
      .toThrow('Document numbering capability policy is unavailable');
    const omittedClassification = structuredClone(policy);
    delete omittedClassification.actionControl.capability;
    expect(() => grantIssuer.classifyNumberingReviewPolicy(omittedClassification))
      .toThrow('Document numbering capability policy is unavailable');
    const mismatchedAssurance = structuredClone(policy);
    mismatchedAssurance.actionControl.assurance = 'recent_auth';
    expect(() => grantIssuer.classifyNumberingReviewPolicy(mismatchedAssurance))
      .toThrow('Document numbering capability policy is unavailable');
    const widenedPredecessor = structuredClone(predecessor);
    widenedPredecessor.team.ownerDefaultCapabilities.push(grantIssuer.CAPABILITY);
    widenedPredecessor.actionControl[grantIssuer.CAPABILITY] = structuredClone(policy.actionControl);
    expect(() => grantIssuer.classifyNumberingReviewPolicy(policy, widenedPredecessor))
      .toThrow('Document numbering capability policy is unavailable');
    const substitutedPredecessor = structuredClone(predecessor);
    substitutedPredecessor.policyState = 'substituted';
    expect(() => grantIssuer.classifyNumberingReviewPolicy(policy, substitutedPredecessor))
      .toThrow('Document numbering capability policy is unavailable');
    const downgradedPolicy = structuredClone(policy);
    downgradedPolicy.policyVersion = 'mission27.launch.v1';
    expect(() => grantIssuer.classifyNumberingReviewPolicy(downgradedPolicy, predecessor))
      .toThrow('Document numbering capability policy is unavailable');
    const issuerSource = read('src/customerFinancial/launchCapabilityGrantIssuer.js');
    const integrationSource = read('tests/integration/m27-part2c-exact-money-numbering-postgres.test.js');
    expect(issuerSource).toContain('INSERT INTO canonical_customer_financial_numbering_capability_grants_v1');
    expect(integrationSource).toContain('grantIssuer.issueNumberingReviewGrant');
    expect(integrationSource).not.toContain(
      'INSERT INTO canonical_customer_financial_numbering_capability_grants_v1');
  });

  test('preserves the later-slice and external-effect boundaries', () => {
    const document = read('docs/architecture/MISSION_27_PART2C_EXACT_MONEY_AND_NUMBERING.md');
    expect(document).toContain('Part 5 remains the owner');
    expect(document).toContain('There is no mounted route or UI in this slice');
    expect(document).toContain('No invoice, credit note, receipt, payment, provider object');
    expect(document).toContain('deferred until the first real paying customer');
    const authority = read('src/customerFinancial/databaseAuthority.js');
    expect(authority).toContain("'canonical_customer_financial_numbering_v1_review'");
    expect(authority).not.toMatch(/ENTRIES[\s\S]*canonical_customer_financial_numbering_v1_reserve[\s\S]*\]\);/);
  });
});
