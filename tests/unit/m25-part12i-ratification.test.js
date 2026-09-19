'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('Mission 25 Part 12I authority ratification', () => {
  const migration = read('migrations/121_canonical_external_business_calibration.sql');
  test('defines separate customer, project and financial calibration with bounded samples', () => {
    expect(migration).toContain("calibration_kind IN ('customer','project','financial')");
    expect(migration).toContain('sample_size BETWEEN 5 AND 100');
    expect(migration).toContain('candidate_total>10000');
    expect(migration).toContain('fresh_total<=100');
    expect(migration).toContain('At least five current same-service outcomes are required');
  });
  test('pins exact current permissions and recomputes current evidence', () => {
    expect(migration).toContain('canonical_external_business_calibration_outcome_consent_basis');
    expect(migration).toContain('canonical_external_customer_outcome_basis');
    expect(migration).toContain('canonical_external_project_outcome_basis');
    expect(migration).toContain('canonical_external_financial_outcome_basis');
    expect(migration).toContain("item.consent_id<>(outcome_current->>'id')::uuid");
    expect(migration).toContain("rtrim(item.source_digest)<>basis_value->>'sourceDigest'");
  });
  test('keeps dimensions independent and refuses inferred conversions', () => {
    expect(migration).toContain("count(DISTINCT currency)::int");
    expect(migration).toContain('Currency conversion is not inferred.');
    expect(migration).toContain("m.value->>'status'='compared'");
    expect(migration).toContain('No customer, lead, appointment, estimate, project, job, invoice, payment, price, schedule or company policy was changed.');
  });
  test('uses immutable guarded tables and entry-only runtime access', () => {
    expect(migration).toContain('canonical_external_business_calibration_consents_immutable');
    expect(migration).toContain('canonical_external_business_calibration_proposal_guard');
    expect(migration).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.canonical_external_business_calibration_propose');
    expect(read('src/db.js')).toContain('external_business_calibration_helpers_withheld');
  });
  test('adds no rendered surface and keeps messages in plain business language', () => {
    const changedRuntime = ['src/learning/externalBusinessCalibrationContract.js','src/learning/externalBusinessCalibrationRepository.js','src/routes/learning.js','src/db.js'];
    expect(changedRuntime.some(file => file.startsWith('public/'))).toBe(false);
    const copy = ['src/learning/externalBusinessCalibrationContract.js','src/learning/externalBusinessCalibrationRepository.js'].map(read).join('\n');
    const messages = [...copy.matchAll(/(?:message:\s*|new Error\()'([^']+)'/g)].map(match => match[1]).join('\n');
    expect(messages).not.toMatch(/schema|idempotency|projection|digest|database revision/i);
    expect(messages).toContain('Business calibration details are invalid.');
  });
});
