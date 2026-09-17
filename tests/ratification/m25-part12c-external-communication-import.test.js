'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');

describe('Mission 25 Part 12 Slice C communication imports', () => {
  const migration = read('migrations/115_canonical_external_communication_import_authority.sql');
  test('stages three distinct evidence classes with exact relationship lineage', () => {
    for (const value of ["record_type IN ('communication','delivery','satisfaction')",'communication_reference',
      'customer_reference','lead_reference','job_reference','appointment_reference','estimate_reference','project_reference',
      "'reconciliationStatus',CASE WHEN v.state='active' THEN 'unmatched'",'historical_backfill','continuous_update']) {
      expect(migration).toContain(value);
    }
  });
  test('does not turn intent or delivery into satisfaction', () => {
    for (const value of ['intent_claim','delivery_state','satisfaction_claim',
      "'customer_explicit','human_reviewed','provider_classified'",
      "'explicit_customer_feedback','human_reviewed_explicit_feedback'", "record_type='satisfaction'"]) {
      expect(migration).toContain(value);
    }
    expect(migration).not.toContain('automated_sentiment');
  });
  test('uses one content-free token representation in Node and PostgreSQL', () => {
    const contract = read('src/learning/externalCommunicationImportContract.js');
    expect(contract).toContain("const OPAQUE_REFERENCE = /^ref_[0-9a-f]{64}$/");
    expect(contract).toContain("const OPAQUE_CURSOR = /^cur_[0-9a-f]{64}$/");
    expect(migration).toContain("external_record_id~'^ref_[0-9a-f]{64}$'");
    expect(migration).toContain("communication_reference~'^ref_[0-9a-f]{64}$'");
    expect(migration).toContain("cursor_after~'^cur_[0-9a-f]{64}$'");
    expect(migration).not.toContain("length(p.value#>>'{}') BETWEEN 1 AND 128");
  });
  test('preserves consent, immutable source history, and current-period masking', () => {
    for (const value of ['canonical_external_communication_import_consents','canonical_external_communication_import_runs',
      'canonical_external_communication_import_records','request_key_hash','previous_id',"state IN ('active','tombstone')",
      'run.consent_id=consent_row.id','canonical_field_execution_actor_authority']) expect(migration).toContain(value);
  });
  test('withholds storage and helpers while granting only guarded entries', () => {
    const db = read('src/db.js');
    for (const value of ['REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_communication_import_consents',
      'REVOKE ALL ON FUNCTION public.canonical_external_communication_record_projection',
      'GRANT EXECUTE ON FUNCTION public.canonical_external_communication_import_batch',
      'external_communication_import_helpers_withheld']) expect(db).toContain(value);
  });
  test('mounts owner routes without adding a rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const value of ["'/external-communication-sources/:sourceKey/consent'", "'/external-communication-sources/:sourceKey/batches'",
      "'/external-communication-sources/:sourceKey'", 'communicationImportContract.normalizeBatch']) expect(routes).toContain(value);
    for (const rendered of ['public/js/learning-center-page.js','public/dashboard/learning-center.html','public/css/learning-center.css']) {
      expect(read(rendered)).not.toContain('external-communication-sources');
    }
  });
  test('does not retain message content, infer later outcomes, or mutate operations', () => {
    for (const forbidden of ['message_body','messageBody','subject','transcript','sentiment_score','revenue_observation','margin_observation']) {
      expect(migration).not.toContain(forbidden);
    }
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:customers|opportunities|appointments|canonical_estimates|invoices|payments|canonical_field_executions)\b/);
  });
});
