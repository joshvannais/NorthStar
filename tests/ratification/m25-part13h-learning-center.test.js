'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../..');
const read = value => fs.readFileSync(path.join(root,value),'utf8');

describe('Mission 25 Part 13H acceptance contract', () => {
  test('keeps service discovery bounded and the prior projection helper private', () => {
    const migration = read('migrations/131_canonical_learning_center_job_outcomes.sql'), db = read('src/db.js');
    expect(migration).toContain("LIMIT 50"); expect(migration).toContain("'version','m25-learning-center-v6'");
    expect(migration).toContain('canonical_learning_center_part12_read'); expect(migration).toContain('outcomeServicesTruncated'); expect(migration).toContain('canonical_job_outcome_summaries');
    expect(db).toContain("'131_canonical_learning_center_job_outcomes.sql'"); expect(db).toContain('learning_center_job_outcome_acl');
  });

  test('renders a plain owner review with explicit adoption and rollback decisions', () => {
    const html = read('public/dashboard/learning-center.html'), page = read('public/js/learning-center-page.js'), css = read('public/css/learning-center.css');
    for (const phrase of ['Review planning suggestions','Completed job learning','Service to review']) expect(html).toContain(phrase);
    for (const phrase of ['Select comparable completed jobs','Prepare suggestion','Sample coverage','Lower quartile','Upper quartile','Interquartile range','Uncertainty','Value boundary','Decision boundary','Review for adoption','Adopt planning value','Review rollback','Remove planning value','Earlier suggestions do not become current again','Your evidence review remains available']) expect(page).toContain(phrase);
    expect(page).toContain("label.htmlFor = reasonId"); expect(page).toContain("if (!isOwner()) return null");
    expect(page).toContain('global.scrollTo(0, 0)'); expect(css).toContain(':focus-visible'); expect(css).toContain('@media(max-width:560px)');
    expect(`${html}\n${page}`).not.toMatch(/node\([^\n]+['"](?:UUID|Request ID|Database schema|Internal state)['"]/i);
  });
});
