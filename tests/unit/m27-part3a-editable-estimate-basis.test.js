'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const adapter = require('../../src/customerFinancial/editableEstimateBasis');
const grants = require('../../src/customerFinancial/estimateCapabilityGrantIssuer');

const id = () => crypto.randomUUID();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function raw() {
  const currency = 'USD';
  return { state: 'current_mission24_commercial_lineage',
    version: 'm27-mission24-commercial-editable-basis-v1', sourceCurrent: true,
    capturedAt: '2026-10-11T12:00:00.000000Z', providerCallCount: 0, receiverMutationCount: 0,
    authority: { organizationId: id(), actorUserId: id(), actorAccessRole: 'owner',
      authSessionId: id(), membershipId: id(), capability: grants.CAPABILITY,
      capabilityGrantId: id(), capabilityGrantRevision: 1,
      businessPurpose: grants.BUSINESS_PURPOSE, policyVersion: grants.POLICY_VERSION,
      policyDigest: grants.POLICY_DIGEST },
    identity: { estimateId: id(), customerId: id(), opportunityId: id(), graphId: id(),
      operationId: id(), bookingReviewId: id(), appointmentId: id(), scheduleApprovalId: id(),
      acceptanceId: id(), issuedVersionId: id() },
    commercial: { currency, approvedPriceBeforeTax: '10971.42', decisionId: id(),
      decisionRevision: 2, decisionDigest: digest('decision'), termsId: id(), termsRevision: 3,
      termsDigest: digest('terms'), commercialApprovalId: id(),
      commercialApprovalDigest: digest('approval'), issuedRevision: 4,
      issuedDigest: digest('issued'), documentDigest: digest('document'),
      issuedAt: '2026-10-10T10:00:00.000Z', acceptedAt: '2026-10-10T11:00:00.000Z',
      acceptanceDigest: digest('acceptance') },
    source: { estimateSnapshotDigest: digest('snapshot'), calculationVersion: 'fence-v1',
      normalizedInputFingerprint: digest('input'), bookingReviewOrder: 1,
      businessProfileId: id(), businessProfileVersion: 'org-profile-v1',
      businessProfileDigest: digest('profile'),
      reviewedAt: '2026-10-10T12:00:00.000Z' },
    booking: { scheduleAssignmentId: id(), revision: 6, digest: digest('schedule'),
      state: 'scheduled', appointmentStatus: 'scheduled',
      scheduledStart: '2026-10-20T14:00:00.000Z', scheduledEnd: '2026-10-20T16:00:00.000Z' },
    customerSafeDocument: { work: { title: 'Fence installation', scope: 'Install cedar fence.' },
      currency, charges: [{ label: 'Fence installation', kind: 'charge', amount: '10971.42' }],
      adjustments: [], taxes: [], subtotal: '10971.42', tax: '0.00', total: '10971.42',
      payments: [], reference: 'EST-1234567890' } };
}

describe('Mission 27 Part 3A editable estimate basis', () => {
  test('projects exact current Mission 24 lineage without inventing fields or provider evidence', () => {
    const value = adapter.project(raw());
    expect(value).toMatchObject({ contractVersion: 'm27-polaris-editable-estimate-v1',
      mode: 'paid_tenant', providerCallCount: 0, receiverMutationCount: 0,
      browserArithmeticUsed: false,
      mission32Adapter: { version: 'polaris.estimate_studio.adapter.v1', available: false,
        mayCreateParallelEstimate: false, mayDuplicateAcceptedMath: false },
      intakeSources: { phone: { state: 'unavailable', value: null },
        photo: { state: 'unavailable', value: null },
        extraction: { state: 'unavailable', value: null } } });
    expect(value.options).toHaveLength(1);
    expect(value.options[0].lines[0]).toMatchObject({ quantity: null, unit: null,
      unitPrice: null, arithmeticRole: 'additive_pre_tax_component',
      amount: { decimal: '10971.42', minorUnits: '1097142', exactZero: false } });
    expect(value.options[0].lines[0].missingEvidence).toEqual([
      'quantity_unavailable','unit_unavailable','unit_price_unavailable']);
    expect(value.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(value.sourceEvidence).toMatchObject({
      receipt: { graphId: expect.any(String), operationId: expect.any(String),
        estimateSnapshotDigest: digest('snapshot'), calculationVersion: 'fence-v1',
        normalizedInputFingerprint: digest('input'), bookingReviewOrder: 1,
        provenanceIdentity: expect.stringMatching(/^provenance_[a-f0-9]{32}$/),
        provenanceDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      configuration: { state: 'available', identity: expect.any(String),
        version: 'org-profile-v1', digest: digest('profile') },
      typedFields: { state: 'unavailable',
        reason: 'source_typed_fields_not_exposed_by_mission24_contract', value: null },
      optionValidity: { state: 'accepted_current', valid: true },
    });
    expect(value.inputs).toEqual([expect.objectContaining({
      key: 'mission24.normalized_estimate_input', valueType: 'digest',
      value: digest('input'), sourceVersion: 'fence-v1', sourceDigest: digest('snapshot'),
    })]);
    expect(JSON.stringify(value)).not.toContain('undefined');
  });

  test('reconciles additive accepted charges while preserving adjustments, tax, and payments as non-additive evidence', () => {
    const source = raw();
    source.commercial.approvedPriceBeforeTax = '1475.00';
    source.customerSafeDocument = { ...source.customerSafeDocument,
      charges: [{ label: 'Tree removal', kind: 'charge', amount: '1400.00' },
        { label: 'Permit', kind: 'fee', amount: '75.00' }],
      adjustments: [{ label: 'Scheduling adjustment', amount: '-50.00' }],
      taxes: [{ label: 'Connecticut tax', amount: '93.66' }],
      payments: [{ label: 'Deposit', kind: 'deposit', amount: '400.00' }],
      subtotal: '1475.00', tax: '93.66', total: '1568.66' };
    const value = adapter.project(source); const option = value.options[0];
    expect(option.lines.map(line => line.amount.minorUnits)).toEqual(['140000','7500']);
    expect(option.pricingEvidence).toMatchObject({
      additiveLineTotal: { minorUnits: '147500', decimal: '1475.00' },
      totals: { beforeTax: { minorUnits: '147500' }, tax: { minorUnits: '9366' },
        afterTax: { minorUnits: '156866' } },
      reconciliation: { additiveLineTotalMatchesAcceptedBeforeTax: true,
        acceptedBeforeTaxPlusTaxMatchesAfterTax: true,
        adjustmentsAreInformational: true, taxesAreNonAdditive: true },
    });
    expect(option.pricingEvidence.adjustments[0]).toMatchObject({
      arithmeticRole: 'adjustment_non_additive', amount: { minorUnits: '-5000' } });
    expect(option.pricingEvidence.taxes[0]).toMatchObject({
      arithmeticRole: 'tax_non_additive', amount: { minorUnits: '9366' } });
    expect(option.pricingEvidence.paymentSchedule[0]).toMatchObject({
      arithmeticRole: 'payment_schedule_non_additive', amount: { minorUnits: '40000' } });
    expect(option.lines).toHaveLength(2);
  });

  test('preserves exact zero and signed evidence and rejects range, precision, and reconciliation errors', () => {
    const source = raw();
    source.commercial.approvedPriceBeforeTax = '0.00';
    source.customerSafeDocument = { ...source.customerSafeDocument,
      charges: [{ label: 'No-charge accepted scope', kind: 'charge', amount: '0.00' }],
      adjustments: [{ label: 'Recorded correction', amount: '-281.48' }],
      taxes: [{ label: 'Zero tax', amount: '0.00' }], subtotal: '0.00', tax: '0.00', total: '0.00' };
    expect(adapter.project(source).options[0]).toMatchObject({
      totalBeforeTax: { exactZero: true, minorUnits: '0' },
      pricingEvidence: { adjustments: [{ amount: { decimal: '-281.48' } }],
        taxes: [{ amount: { exactZero: true } }] } });
    source.customerSafeDocument.charges[0].amount = '0.001';
    expect(() => adapter.project(source)).toThrow('no more than two fractional digits');
    source.customerSafeDocument.charges[0].amount = '90071992547409.92';
    expect(() => adapter.project(source)).toThrow('exact application range');
    source.customerSafeDocument.charges[0].amount = '0.00';
    source.customerSafeDocument.total = '0.01';
    expect(() => adapter.project(source)).toThrow('do not reconcile');
  });

  test('binds digest and provenance to distinct exact graph, operation, snapshot, build, input, and review evidence', () => {
    const firstRaw = raw(); const secondRaw = structuredClone(firstRaw);
    secondRaw.identity.graphId = id(); secondRaw.identity.operationId = id();
    secondRaw.source.estimateSnapshotDigest = digest('snapshot-2');
    secondRaw.source.normalizedInputFingerprint = digest('input-2');
    secondRaw.source.calculationVersion = 'fence-v2';
    secondRaw.source.bookingReviewOrder = 2;
    secondRaw.source.reviewedAt = '2026-10-10T12:01:00.000Z';
    const first = adapter.project(firstRaw); const second = adapter.project(secondRaw);
    expect(second.digest).not.toBe(first.digest);
    expect(second.sourceEvidence.receipt.provenanceDigest)
      .not.toBe(first.sourceEvidence.receipt.provenanceDigest);
    expect(second.provenance[0].sourceIdentity).not.toBe(first.provenance[0].sourceIdentity);
    expect(second.sourceEvidence.receipt).toMatchObject({ graphId: secondRaw.identity.graphId,
      operationId: secondRaw.identity.operationId,
      estimateSnapshotDigest: digest('snapshot-2'), calculationVersion: 'fence-v2',
      normalizedInputFingerprint: digest('input-2'), bookingReviewOrder: 2 });
    secondRaw.source.reviewedAt = null;
    expect(() => adapter.project(secondRaw)).toThrow('source invalid');
  });

  test('keeps exact zero distinct from unavailable and rejects malformed money', () => {
    expect(adapter.exactMoney('0.00','USD')).toEqual({ version: 'm27-exact-money-v1',
      currency: 'USD', minorUnitExponent: 2, minorUnits: '0', decimal: '0.00', exactZero: true });
    expect(adapter.exactMoney('0','USD').decimal).toBe('0.00');
    expect(adapter.exactMoney('-281.4','USD')).toMatchObject({
      minorUnits: '-28140', decimal: '-281.40', exactZero: false });
    expect(() => adapter.exactMoney('10.001','USD')).toThrow('no more than two fractional digits');
    expect(() => adapter.exactMoney('1.00','CAD')).toThrow('Only exact USD is supported');
  });

  test.each(['current_booking_review_unavailable','current_booking_review_ambiguous',
    'source_currentness_unavailable','commercial_lineage_unavailable',
    'source_configuration_unavailable'])(
    'returns named value-free %s', reason => {
      expect(adapter.unavailable({ state: 'unavailable', reason, value: null,
        sourceCurrent: false, providerCallCount: 0, receiverMutationCount: 0 }))
        .toMatchObject({ state: 'unavailable', reason, value: null,
          phoneSourceValue: null, photoSourceValue: null, extractionValue: null });
    });

  test('ratifies the exact released policy and migration boundary', () => {
    expect(grants.classify('owner')).toMatchObject({ capability: grants.CAPABILITY,
      businessPurpose: grants.BUSINESS_PURPOSE, policyVersion: 'mission27.launch.v1',
      policyDigest: grants.POLICY_DIGEST, templateVersion: 'm27.owner.v1' });
    expect(grants.classify('admin').templateVersion).toBe('m27.admin.v1');
    expect(() => grants.classify('member')).toThrow('restricted');
    const sql = fs.readFileSync(path.join(__dirname,'../../migrations/264_customer_financial_editable_estimate_basis_v1.sql'),'utf8');
    const migrationNames = fs.readdirSync(path.join(__dirname,'../../migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrationNames.at(-1)).toBe('264_customer_financial_editable_estimate_basis_v1.sql');
    expect(migrationNames.filter(name => /^264_/.test(name))).toHaveLength(1);
    expect(sql).toContain("capability='customer_financial.estimate.edit_draft'");
    expect(sql).toContain("business_purpose='customer_financial.editable_estimate_basis'");
    expect(sql).toContain("policy_version='mission27.launch.v1'");
    expect(sql).toContain('canonical_forecast_commercial_review_currentness');
    expect(sql).toContain('canonical_customer_financial_billing_identity_v1_entitlement(org,TRUE)');
    expect(sql).toContain("':editable-estimate-capability-scope:'");
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('current_user=pg_catalog.pg_get_userbyid');
    expect(sql).not.toContain("current_setting('northstar.customer_financial_estimate_organization_id'");
    expect(sql).not.toContain("set_config('northstar.customer_financial_estimate_organization_id'");
    expect(sql).toContain('canonical_customer_financial_editable_basis_v1_issue_grant');
    expect(sql).toContain('Editable estimate capability identity cannot change');
    expect(sql).toContain('pg_try_advisory_xact_lock');
    expect(sql).toContain('FROM public.organizations WHERE id=org FOR SHARE');
    expect(sql).toContain('FOR SHARE OF review,estimate,opportunity,issued,terms,approval,decision,acceptance,assignment');
    expect(sql).toContain("'providerCallCount',0,'receiverMutationCount',0");
    expect(sql).toContain("'value',NULL,'sourceCurrent',FALSE");
    expect(sql).not.toContain('INSERT INTO public.canonical_estimates');
    expect(sql).not.toContain('UPDATE public.canonical_schedule_assignments');
    const database = fs.readFileSync(path.join(__dirname,'../../src/db.js'),'utf8');
    expect(database).toContain("relation.relname NOT LIKE 'canonical_customer_financial_estimate_%'");
    expect(database).toContain('AS customer_financial_editable_estimate_private');
    expect(database).toContain('!runtimePrivileges.customer_financial_editable_estimate_private');
    const architecture = fs.readFileSync(path.join(__dirname,
      '../../docs/architecture/MISSION_27_PART3A_EDITABLE_ESTIMATE_BASIS.md'),'utf8');
    expect(architecture).toContain('Status: implementation candidate.');
    expect(architecture).toContain('Part 3C still owns human edits');
    expect(architecture).toContain('makes zero provider calls');
    expect(architecture).toContain('Live-money validation remains deferred');
  });
});
