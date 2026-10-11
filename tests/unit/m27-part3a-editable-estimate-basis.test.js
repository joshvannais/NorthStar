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
      unitPrice: null, amount: { decimal: '10971.42', minorUnits: '1097142', exactZero: false } });
    expect(value.options[0].lines[0].missingEvidence).toEqual([
      'quantity_unavailable','unit_unavailable','unit_price_unavailable']);
    expect(value.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(value)).not.toContain('undefined');
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
    'source_currentness_unavailable','commercial_lineage_unavailable'])(
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
