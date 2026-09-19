'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('Mission 25 Part 12 Slice K Learning Center', () => {
  test('projects all four business-system source classes through one bounded tenant-private read model', () => {
    const migration = read('migrations/123_canonical_learning_center_business_systems.sql');
    for (const value of ['crm_field_service','project_change_order','communication','financial']) expect(migration).toContain(`'${value}'`);
    for (const table of ['canonical_external_business_reference_matches','canonical_external_customer_outcome_observations',
      'canonical_external_project_outcome_observations','canonical_external_financial_outcome_observations',
      'canonical_external_business_calibration_proposals','canonical_external_business_hold_revisions']) expect(migration).toContain(table);
    expect(migration).toContain("'version','m25-learning-center-v5'");
    expect(migration).toContain('LIMIT 100'); expect(migration).toContain('ordinal<=50');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:canonical_customers|canonical_estimates|canonical_opportunities|canonical_jobs)/);
  });

  test('mounts source, review, outcome, calibration and lifecycle controls without provider access', () => {
    const page = read('public/js/learning-center-page.js');
    for (const value of ['/external-business-sources/','/external-customer-outcome-sources/','/external-project-outcome-sources/',
      '/external-financial-outcome-sources/','/external-business-calibration/','m25-external-business-reference-match-v1',
      'm25-external-business-calibration-proposal-v1']) expect(page).toContain(value);
    expect(page).toContain("isBusinessKind() ? 'file_import' : 'csv'");
    expect(page).toContain('if (candidates.length === 1) return candidates[0]');
    expect(page).toContain('Choose the exact CRM and customer communication sources');
    expect(page).not.toMatch(/access[ _-]?token|client[ _-]?secret|provider[ _-]?password|credential implementation/i);
  });

  test('keeps each learned business measure separate and visibly unavailable when evidence is incomplete', () => {
    const page = read('public/js/learning-center-page.js');
    for (const value of ['Lead outcome','Appointment outcome','Issued estimate outcome','Customer response','Contract change',
      'Change-order value','Project duration','Project delivery state','Recorded revenue','Recorded collections','Recorded realized cost','Recorded margin']) expect(page).toContain(value);
    expect(page).toContain("status: 'unavailable', label: 'Customer response'");
    expect(page).toContain('Unavailable measures remain unavailable');
    expect(page).toContain('saving a suggestion does not apply it');
  });

  test('preserves plain-language, accessible, responsive and isolated-demo behavior', () => {
    const html = read('public/dashboard/learning-center.html'), page = read('public/js/learning-center-page.js'), css = read('public/css/learning-center.css');
    for (const value of ['CRM and field service','Projects and change orders','Customer communications','External financial records']) expect(html + page).toContain(value);
    expect(page).toContain("authority: 'isolated_demo_postgresql'"); expect(page).toContain("sourceTotal: 8");
    expect(html).toContain('aria-live="polite"'); expect(css).toContain(':focus-visible'); expect(css).toContain('@media(max-width:560px)');
    expect(html + page).not.toMatch(/Human approval reason|Reason For This Update|<textarea/i);
  });
});
