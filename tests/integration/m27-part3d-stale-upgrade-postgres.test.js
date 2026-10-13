'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const quoteContract = require('../../src/customerFinancial/polarisQuoteJourney');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');
const { issueEstimateJourneyGrant, PURPOSE } =
  require('../../src/customerFinancial/estimateJourneyGrantIssuer');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrations = path.join(__dirname, '../../migrations');

function migrationsThrough266() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m27-p3d-266-'));
  for (const name of fs.readdirSync(migrations)) {
    const number = Number(/^([0-9]+)_/.exec(name)?.[1]);
    if (name.endsWith('.sql') && Number.isInteger(number) && number <= 266) {
      fs.copyFileSync(path.join(migrations, name), path.join(directory, name));
    }
  }
  return directory;
}

realPostgres('Mission 27 Part 3D retained-stale rolling upgrade', () => {
  let f; let legacyMigrations;

  beforeAll(async () => {
    for (const key of ['OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY',
      'STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    legacyMigrations = migrationsThrough266();
    f = await createEstimateReviewFixture({ singleRoleMigrations: true,
      migrationsDirectory: legacyMigrations, additionalCompleteEstimates: 0 });
  }, 180000);

  afterAll(async () => {
    try { if (f) await f.cleanup(); }
    finally { if (legacyMigrations) fs.rmSync(legacyMigrations, { recursive: true, force: true }); }
  }, 180000);

  test('revoked accepted source remains immutable history while migration267 and the full through270 chain succeed value-free', async () => {
    const actor = f.actors.owner; const estimate = f.estimateGraphs[0].ids.estimate;
    const root = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(root + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(root + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);
    expect((await request(f.app).post('/api/v1/forecast/price-history/ordered-snapshots')
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({})).status).toBe(201);
    expect((await request(f.app).post('/api/v1/forecast/price-history/ordered-anchor/activate')
      .set(actor.session.headers).send({})).status).toBe(200);
    let review = (await get('/review')).body.data;
    const pricing = pricingFixture(review.pricingPlans.serviceKey);
    pricing.lines[0].amount = '15000.00';
    expect((await post('/pricing-plans', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricing, currency: review.currency, reason: 'Synthetic stale-upgrade pricing source.',
      confirmed: true, confirmationVersion: review.pricingPlans.contract,
      evidenceDigest: review.pricingPlans.sources.digest })).status).toBe(201);
    review = (await get('/review')).body.data;
    const terms = review.commercialTerms; const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = { serviceOperation: 'fence_installation', propertyUse: 'residential',
      workContext: 'new_construction', customerExemption: 'none', evidenceRef: {
        serviceOperation: 'Reviewed scope', propertyUse: 'Recorded property',
        workContext: 'Reviewed scope', customerExemption: 'Customer statement' } };
    inputs.transactionDate = terms.sources.asOfDate; inputs.taxGroups = [group(['installation'])];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, { legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn,
      legalEndsOn: null, reviewedOn: terms.sources.asOfDate,
      reviewValidThrough: terms.sources.asOfDate });
    delete inputs.taxGroups[0].source.effectiveOn; delete inputs.taxGroups[0].source.endsOn;
    expect((await post('/commercial-terms', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs, currency: review.currency,
      reason: 'Synthetic stale-upgrade commercial terms.', confirmed: true,
      confirmationVersion: terms.contract, evidenceDigest: terms.sources.digest })).status).toBe(201);
    review = (await get('/review')).body.data;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(review.commercialTerms.current),
      evidenceDigest: review.commercialTerms.sources.digest,
      expectedDecisionRevision: review.commercialTerms.decisionBasis.revision,
      expectedDecisionDigest: review.commercialTerms.decisionBasis.digest,
      scopeSummary: 'Install the retained stale-upgrade fence.',
      reason: 'Synthetic stale-upgrade approved commercial scope.', confirmed: true,
      confirmationVersion: review.commercialTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true } })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Synthetic stale-upgrade issued estimate.', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1' });
    expect(issued.status).toBe(201);
    const link = await post('/customer-estimate-links', { versionId: issued.body.data.receipt.id,
      expiresInDays: 14, confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1' });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    expect((await request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID()).send({ customerName: 'Taylor Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);

    const grant = await issueEstimateJourneyGrant(f.ownerPool, { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole }, estimate, 'customer_financial.estimate.edit_draft');
    const source = (await f.ownerPool.query(
      'SELECT public.canonical_customer_financial_estimate_journey_v1_source_proposal($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, estimate])).rows[0].value;
    expect(source.sourceCurrent).toBe(true);
    let draft = quoteContract.normalizeDraft({ options: [{ id: 'retained_option', name: 'Retained option',
      scope: 'Retain the accepted source as historical evidence.', validityDays: 14,
      assumptions: ['Existing grade remains serviceable.'], lines: [{ id: 'retained_line',
        description: 'Retained fence work', quantity: '1', unit: 'job', price: {
          version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
          minorUnits: '50000', decimal: '500.00', exactZero: false } }] }] }, {
      estimateId: estimate, customerId: source.customerId, sourceDigest: 'a'.repeat(64),
      sourceRevisionDigest: 'b'.repeat(64), sourceProposalDigest: source.sourceProposalDigest,
      sourceProposalRevisionDigest: source.sourceProposalRevisionDigest });
    async function save(expectedRevision, reason) {
      return (await f.ownerPool.query(`SELECT public.canonical_customer_financial_estimate_journey_v1_save_draft(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) value`,
      [f.org,actor.actorUserId,actor.actorAccessRole,actor.authSessionId,actor.csrfToken,estimate,
        grant.grantId,grant.revision,'customer_financial.estimate.edit_draft',
        PURPOSE['customer_financial.estimate.edit_draft'],'mission27.launch.v1',crypto.randomUUID(),
        expectedRevision,JSON.stringify(draft),reason,'m27-polaris-quote-journey-v1'])).rows[0].value;
    }
    expect((await save(0, 'Owner retained the first exact historical revision.')).draft.revision).toBe(1);
    const priorOption = draft.options[0];
    draft = quoteContract.normalizeDraft({ options: [{ id: priorOption.id, name: priorOption.name,
      scope: 'Retain the corrected accepted source as historical evidence.',
      validityDays: priorOption.validityDays,
      assumptions: priorOption.assumptions.map(value => value.text || value),
      lines: priorOption.lines.map(line => ({ id: line.id, description: line.description,
        quantity: line.quantity, unit: line.unit, price: line.price })) }] }, draft);
    expect((await save(1, 'Owner retained the second exact historical revision.')).draft.revision).toBe(2);
    const acceptedLink = (await f.ownerPool.query(`SELECT event.link_id
      FROM canonical_customer_estimate_delivery_events event
      WHERE event.organization_id=$1 AND event.estimate_id=$2 AND event.kind='accepted'
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1`, [f.org, estimate])).rows[0].link_id;
    expect((await request(f.app)
      .post(`/api/v1/canonical/estimates/${estimate}/customer-estimate-links/${acceptedLink}/revoke`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({})).status).toBe(201);
    const currentAfterRevoke = (await f.ownerPool.query(
      'SELECT public.canonical_customer_financial_estimate_journey_v1_source_proposal($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, estimate])).rows[0].value;
    expect(currentAfterRevoke).toBeNull();
    expect((await f.ownerPool.query(`SELECT revision FROM canonical_customer_financial_estimate_journey_drafts_v1
      WHERE organization_id=$1 AND estimate_id=$2`, [f.org, estimate])).rows[0].revision).toBe('2');

    await expect(f.db.runMigrations({ pool: f.ownerPool, migrationsDirectory: migrations }))
      .resolves.toBe(true);
    expect((await f.ownerPool.query('SELECT filename FROM _migrations ORDER BY id DESC LIMIT 1')).rows[0].filename)
      .toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    const retained = await f.ownerPool.query(`SELECT revision,revision_class,rtrim(history_chain_digest) chain,
      snapshot#>>'{currentAtHistoryCapture}' current_at_capture,snapshot#>>'{revokedEvidence,id}' revoked_id
      FROM canonical_customer_financial_estimate_journey_revisions_v1
      WHERE organization_id=$1 AND estimate_id=$2 ORDER BY revision`, [f.org, estimate]);
    expect(retained.rows.map(row => Number(row.revision))).toEqual([0,1,2]);
    expect(retained.rows[0]).toMatchObject({ revision_class: 'source_original',
      current_at_capture: 'false' });
    expect(retained.rows[0].revoked_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(retained.rows.every(row => /^[0-9a-f]{64}$/.test(row.chain))).toBe(true);
    const stale = await request(f.app)
      .get(`/api/v1/customer-financial/editable-estimates/${estimate}/quote-journey`)
      .set(actor.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'unavailable',
      reason: 'source_currentness_unavailable', value: null });
    expect(JSON.stringify(stale.body.data)).not.toMatch(/50000|Retain the corrected|historyDigest|revoked_id/);
    await expect(f.ownerPool.query(`UPDATE canonical_customer_financial_estimate_journey_revisions_v1
      SET reason=reason WHERE organization_id=$1`, [f.org])).rejects.toMatchObject({ code: '55000' });
    await f.db.close();
    await expect(f.db.initDatabase()).resolves.toBe(true);
    expect((await f.ownerPool.query(`SELECT count(*)::int total FROM canonical_customer_financial_estimate_journey_revisions_v1
      WHERE organization_id=$1 AND estimate_id=$2`, [f.org, estimate])).rows[0].total).toBe(3);
  }, 240000);
});
