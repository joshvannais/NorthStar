'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = value => fs.readFileSync(path.join(ROOT, value), 'utf8');

describe('Mission 27 Part 3D immutable handoff and revision history', () => {
  const migration = read('migrations/267_customer_financial_part3_handoff_history_v1.sql');

  test('closes reviewed billable work with one nonfinancial immutable receipt', () => {
    expect(migration).toContain('canonical_customer_financial_billable_handoff_receipts_v1');
    expect(migration).toContain("'m27-billable-handoff-receipt-v1'");
    expect(migration).toContain("'mission27.part4.invoice_draft_source.v1'");
    expect(migration).toContain("WITH ORDINALITY item(value,ordinal)");
    expect(migration).toContain("'requestBindingDigest',item.value->'requestBindingDigest'");
    expect(migration).toContain("'billableHandoffAuthorized',TRUE");
    expect(migration).toContain("'invoiceAuthorized',FALSE");
    expect(migration).toContain("'financialActionAuthorized',FALSE");
    expect(migration).toContain("'providerCallCount',0,'receiverMutationCount',0");
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE OR TRUNCATE ON public\.canonical_customer_financial_billable_handoff_receipts_v1/);
    expect(migration).toContain("'handoff_receipt_unavailable'");
  });

  test('preserves one source original and every accepted human revision', () => {
    expect(migration).toContain('canonical_customer_financial_estimate_journey_revisions_v1');
    expect(migration).toContain("CHECK(revision_class IN('source_original','human_revision'))");
    expect(migration).toContain("'m24-source-original-history-v1'");
    expect(migration).toContain("'m27-polaris-human-revision-v1'");
    expect(migration).toContain('AFTER INSERT OR UPDATE ON public.canonical_customer_financial_estimate_journey_drafts_v1');
    expect(migration).toContain("'revision_history_unavailable'");
    expect(migration).toContain("'sourceOriginal'");
    expect(migration).toContain("'humanRevisions'");
    expect(migration).toContain("'historyDigest'");
    expect(migration).toContain('history_chain_digest CHAR(64)');
    expect(migration).toContain("'revokedEvidence'");
    expect(migration).toContain("'currentAtHistoryCapture'");
    expect(migration).toContain("revision_class='human_revision'");
    expect(migration).toContain('ALTER COLUMN history_chain_digest SET NOT NULL');
  });

  test('bounds every private history response with deterministic cursor pagination', () => {
    const repository = read('src/customerFinancial/polarisQuoteJourneyRepository.js');
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    expect(migration).toContain('limit_value NOT BETWEEN 1 AND 20');
    expect(migration).toContain('revision<COALESCE(before_revision,current_revision+1)');
    expect(migration).toMatch(/ORDER BY revision DESC\s+LIMIT human_limit/);
    expect(migration).toContain('include_source:=page_upper<=limit_value-1');
    expect(migration).toContain('returned_records>limit_value OR returned_records>20');
    expect(migration).toContain("'returnedRecords',returned_records");
    expect(migration).toContain("'totalRecords',current_revision+1");
    expect(migration).toContain("'order','revision_desc'");
    expect(migration).toContain("'nextCursor',next_cursor");
    expect(migration).toContain("'hasEarlier',next_cursor IS NOT NULL");
    expect(migration).toContain("'hasLatest',before_revision IS NOT NULL");
    expect(migration).not.toContain("'snapshot',snapshot");
    expect(migration).not.toContain('SELECT count(*)::int,min(revision),max(revision)');
    expect(repository).toContain('function checkedHistoryPage(raw = {})');
    expect(repository).toContain('Number.isSafeInteger(limit) || limit < 1 || limit > 20');
    expect(repository).toContain('Number.isSafeInteger(beforeRevision) || beforeRevision < 1');
    expect(route).toContain("!['historyLimit','historyBefore'].includes(key)");
    expect(route).toContain("typeof req.query.historyLimit === 'object'");
  });

  test('keeps unavailable learning and calculator execution explicitly inert', () => {
    expect(migration).toContain("'mission25.tenant_edit_observation.v1'");
    expect(migration).toContain("'learning_permission_unavailable'");
    expect(migration).toContain("'published',FALSE");
    expect(migration).toContain("'automaticApplication',FALSE");
    expect(migration).toContain("'polaris.estimate_studio.adapter.v1'");
    expect(migration).toContain("'compatibleSchemaVersion',1");
    expect(migration).toContain("'mayCreateParallelEstimate',FALSE");
    expect(migration).toContain("'mayDuplicateAcceptedMath',FALSE");
    expect(migration).toContain("'receiverExecutionAvailable',FALSE");
    expect(migration).toContain("'learningWriteCount',0");
  });

  test('runtime authority exposes only the existing guarded entries', () => {
    const authority = read('src/customerFinancial/databaseAuthority.js');
    const db = read('src/db.js');
    expect(authority).toContain("'canonical_customer_financial_billable_handoff_receipts_v1'");
    expect(authority).toContain("'canonical_customer_financial_estimate_journey_revisions_v1'");
    expect(db).toContain('canonical_customer_financial_billable_review_v1_ensure_handoff_receipt(uuid,uuid,text)');
    expect(db).toContain('canonical_customer_financial_estimate_journey_v1_history(uuid,uuid,jsonb,jsonb,integer,bigint)');
    expect(db).toContain('canonical_customer_financial_estimate_journey_v1_append_revision()');
    const entries = authority.slice(authority.indexOf('const ENTRIES'), authority.indexOf('const TABLES'));
    expect(entries).not.toContain('ensure_handoff_receipt');
    expect(entries).not.toContain('append_revision');
    expect(entries).not.toContain('canonical_customer_financial_estimate_journey_v1_history');
  });

  test('mounted editor renders bounded history without enabling receivers', () => {
    const browser = read('public/js/polaris-quote-journey.js');
    expect(browser).toContain("label='Revision history · '+totalRecords+' total records ('");
    expect(browser).toContain('returnedRecords>limit||returnedRecords>20');
    expect(browser).toContain('Number(pagination.returnedRecords)!==returnedRecords');
    expect(browser).toContain('(pagination.hasEarlier!==true&&pagination.nextCursor!==null)');
    expect(browser).toContain('Number(history.currentRevision)!==totalHuman');
    expect(browser).toContain("'Show earlier revisions'");
    expect(browser).toContain("'Show latest revisions'");
    expect(browser).toContain('requestToken !== requestGeneration');
    expect(browser).toContain('function currentnessIdentity(value)');
    expect(browser).toContain('currentnessIdentity(value)!==mountedIdentity');
    expect(browser).toContain('witness.historyChainDigest!==history.historyDigest');
    expect(browser).toContain('Mission 25 learning remains unavailable');
    expect(browser).toContain('Calculator execution remains unavailable.');
    expect(browser).not.toContain('learningObservation.publish');
    expect(browser).not.toContain('/mission32');
  });

  test('governing records preserve the released Part 3 chain before the Part 4A candidate', () => {
    const roadmap = read('docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md');
    const ledger = read('docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md');
    expect(roadmap).toContain('Parts 3A–3D were released through PRs #486–#489');
    expect(ledger).toContain('PR #486');
    expect(ledger).toContain('PR #487');
    expect(ledger).toContain('PR #488');
    expect(ledger).toContain('PR #489');
    expect(ledger).toContain('| 3D | [Immutable handoff and revision history]');
    expect(ledger).toMatch(/\| 3D \|[^\n]+\| Released \|/);
    expect(ledger).toContain('| 4A | [Immutable invoice-draft origin and customer-safe lines]');
  });
});
