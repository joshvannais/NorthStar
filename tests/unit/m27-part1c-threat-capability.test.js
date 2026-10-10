'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const contract = () => read('docs/architecture/MISSION_27_PART1C_THREAT_AND_CAPABILITY_MATRIX.md');

function files(directory, suffix = '.js') {
  return fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })
    .flatMap(entry => {
      const relative = path.join(directory, entry.name);
      return entry.isDirectory() ? files(relative, suffix) : [relative];
    })
    .filter(relative => relative.endsWith(suffix));
}

describe('Mission 27 Slice 1C threat and action-capability contract', () => {
  test('reconciles released Slice 1C and preserves the frozen 64-slice sequence', () => {
    const roadmap = read('docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md');
    const ledger = read('docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md');
    const oneA = read('docs/architecture/MISSION_27_PART1A_AUTHORITY_CONTRACT.md');
    const oneB = read('docs/architecture/MISSION_27_PART1B_SOURCE_INVENTORY.md');

    for (const text of [roadmap, ledger, contract()]) {
      expect(text).toContain('54a31eb4f31a0118d8153aefc7a04bd356dd7f70');
      expect(text).toContain('204b40793b72c412a47632af54c323437fe8a40e');
      expect(text).toContain('444c7436-80ab-4a90-9aee-e0f7bcee58ee');
    }
    expect(oneB).toContain('afa98228b97cc1ad2b9f9aea76c7859f9a432765');
    expect(ledger).toContain('| Q1 authority and inventory | 1A–1B |');
    expect(ledger).toContain('| Released through 1B |');
    expect(ledger).toContain('| Q2 threat and launch contract | 1C–1D |');
    expect(ledger).toContain('1C released; 1D candidate pending audit/release');
    expect(ledger).toContain('| 1C | Threat model and action-capability/recent-auth/dual-control matrix | Complete');
    expect(oneA).toContain('The original sequence remains fourteen parts and sixty-four slices');
    expect(oneA).toContain('Slices 1A–1C are released. Slice 1D owns the launch matrix');
  });

  test('covers every original and additive Slice 1C threat family', () => {
    const text = contract();
    for (const marker of [
      'Tenant crossing and insecure direct-object reference',
      'Amount, currency, tax, discount, fee, allocation and total tampering',
      'Replay, changed reuse, duplicate invoice/charge/refund and lost acknowledgement',
      'Confused-deputy action',
      'Customer-link theft, enumeration and recipient confusion',
      'Webhook forgery, replay, reordering and endpoint confusion',
      'Settlement mismatch, partial allocation, double counting and missing-as-zero',
      'Refund abuse, write-off abuse and collection coercion',
      'Provider compromise, account/mode substitution and capability drift',
      'Deletion, retention, legal hold and recovery abuse',
      'Source spoofing',
      'Malicious files, polyglots and decompression/resource exhaustion',
      'Hidden instruction content and extraction prompt injection',
      'Stale extraction, corrected/deleted/revoked/retention-lost source',
      'Unsafe image metadata',
      'Unauthorized edits, options, signatures and accepted-to-work conversion',
      'Revision loss, rollback, fork, cross-run mixing and concurrent overwrite',
      'Cross-tenant learning and unreviewed self-application',
      'Adapter confusion, downgrade and parallel estimate/math',
      'Demo/paid, subscription/customer-financial and external/native confusion',
      'Communication, receiver and operational side effects',
    ]) expect(text).toContain(`| ${marker} |`);
  });

  test('defines an explicit action matrix without treating roles as capabilities', () => {
    const text = contract();
    for (const capability of [
      'customer_financial.source.review',
      'customer_financial.estimate.edit_draft',
      'customer_financial.estimate.edit_options',
      'customer_financial.estimate.request_signature',
      'customer_financial.estimate.review_signature',
      'customer_financial.estimate.request_work_handoff',
      'customer_financial.billing_identity.review',
      'customer_financial.billable_work.review',
      'customer_financial.invoice.edit_draft',
      'customer_financial.invoice.approve',
      'customer_financial.invoice.issue',
      'customer_financial.invoice.send',
      'customer_financial.invoice.correct',
      'customer_financial.invoice.void',
      'customer_financial.provider.connect',
      'customer_financial.payment.initiate',
      'customer_financial.payment.record_offline',
      'customer_financial.payment.reconcile',
      'customer_financial.refund.issue',
      'customer_financial.write_off.record',
      'customer_financial.collection.action',
      'customer_financial.accounting.export',
      'customer_financial.accounting.reconcile',
      'customer_financial.record.delete',
      'customer_financial.record.recover',
    ]) expect(text).toContain(`\`${capability}\``);

    expect(text).toContain('A role is context, never the grant.');
    expect(text).toContain('one exact action phase (`request`, `approve` or `execute`)');
    expect(text).toContain('permission to request never implies permission to approve or execute');
    expect(text).toContain('There is no emergency, owner, administrator, provider, support or direct-database bypass.');
    expect(text).toContain('A solo tenant that cannot supply a required independent approver receives `dual_control_unavailable` and no effect.');
  });

  test('freezes session assurance, recent-auth, MFA, self-approval and dual-control semantics', () => {
    const text = contract();
    for (const level of [
      '`current_session`', '`recent_auth`', '`recent_auth_mfa`',
      '`scoped_customer_session`', '`authenticated_provider_event`',
    ]) expect(text).toContain(`| ${level} |`);
    expect(text).toContain('Session creation or `last_used_at` is not proof of recent authentication.');
    expect(text).toContain('requires a different current approver');
    expect(text).toContain('two different current humans');
    expect(text).toContain('no actor may approve their own request');
    expect(text).toContain('missing bounds or conditions deny the action');
    expect(text).toContain('no money-bearing capability is available');
  });

  test('requires exact replay, currentness, direct-table denial and minimized immutable reasons', () => {
    const text = contract();
    for (const marker of [
      'Exact replay returns the original receipt',
      'changed reuse conflicts',
      'in-flight duplicates serialize',
      'uncertain result is recovered by receipt lookup',
      'checked again in the effect transaction',
      'Direct-table denial',
      'bounded nonblank human reason',
      'cannot be silently defaulted, inherited from another action or reused across request digests',
      'capability/grant revision',
      'request digest',
      'before/after digests',
      'excludes secrets, raw payment instruments, private transcripts, source images',
    ]) expect(text).toContain(marker);
    expect(text).toContain('The first failed prerequisite produces a stable named denial or value-free unavailable state');
    expect(text).toContain('does not silently select an older convenient source');
    expect(text).toContain('Zero is never a default');
  });

  test('keeps Mission 24, 22, 23, 25 and 32 authority separate', () => {
    const text = contract();
    expect(text).toContain('Mission 24 owns estimate, option, approved-price, proposal, signature and customer-acceptance authority');
    expect(text).toContain('Mission 22 owns scheduling and dispatch');
    expect(text).toContain('Mission 23 owns work evidence');
    expect(text).toContain('Mission 25 owns tenant-private learning');
    expect(text).toContain('Mission 32 later owns specialized field calculations through the shared versioned record');
    expect(text).toContain('creates no booking, schedule, dispatch or execution row');
    expect(text).toContain('Mission 32 receives no commercial, work, billing or action capability');
  });

  test('grants no runtime authority and links launch choices to Slice 1D', () => {
    const migrationNames = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql'))
      .sort();
    expect(migrationNames.at(-1)).toBe('259_demo_forecast_journey.sql');
    expect(migrationNames.some(name => /^260_/.test(name))).toBe(false);

    const runtime = files('src').map(read).join('\n');
    expect(runtime).not.toContain('customer_financial.');
    expect(runtime).not.toMatch(/MISSION_27_PART1C_THREAT_AND_CAPABILITY_MATRIX/);

    const permissions = read('src/auth/permissions.js');
    expect(permissions).toContain("'billing': ['read']");
    expect(permissions).not.toContain('customer_financial');
    const middleware = read('src/auth/middleware.js');
    expect(middleware).not.toMatch(/authenticated_at|last_authenticated|recent_auth|mfa/i);

    const text = contract();
    expect(text).toContain('grants no runtime capability');
    expect(text).toContain('Slice 1D owns launch choices');
    expect(text).toContain('numeric amount thresholds');
    expect(text).toContain('adds no migration 260');
    expect(text).toContain('no runtime module, permission, capability grant, route, API, schema, database privilege');
  });
});
