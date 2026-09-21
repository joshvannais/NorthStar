'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = value => fs.readFileSync(path.join(root, value), 'utf8');

describe('Mission 25 Part 14B resettable fictional demo acceptance', () => {
  test('freezes the exact second Part 14 acceptance slice and its isolation boundary', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const evidence = read('docs/evidence/MISSION_25_PART14B_ACCEPTANCE.md');
    expect(roadmap).toContain('| B | Complete resettable fictional demo journey with strict paid/demo isolation. |');
    expect(roadmap).toContain('## Part 14 Slice B candidate — complete resettable fictional demo journey');
    expect(evidence.toLowerCase()).toContain('complete resettable fictional demo journey with strict paid/demo isolation');
    expect(evidence).toContain('No provider, credential, private production, merge, deployment or release action is part of this candidate.');
  });

  test('mounts the full server-backed journey and removes the sample-only shortcut', () => {
    const route = read('src/routes/demo.js');
    const repository = read('src/commandCenter/demoRepository.js');
    const journey = read('src/learning/demoLearningJourney.js');
    const browser = read('public/js/learning-center-page.js');
    const migration = read('migrations/133_demo_learning_journey.sql');
    for (const endpoint of ["router.get('/learning-center'", "router.post('/learning-center/actions'", "router.post('/learning-center/reset'"]) expect(route).toContain(endpoint);
    expect(repository).toContain("operation === 'learning_step'");
    expect(migration).toContain("'learning_step'");
    for (const action of ['grant_graph', 'grant_proposal', 'prepare', 'preview', 'save', 'adoption_preview', 'adopt', 'rollback']) expect(journey).toContain(action);
    expect(journey).toContain('selectedSummaryIds');
    expect(journey).toContain('details.summaryIds.length !== 5');
    expect(browser).toContain("details.summaryIds = body.summaryIds");
    expect(browser).toContain("global.fetch('/api/demo/learning-center' + path");
    expect(browser).toContain("return demoRequest('/actions'");
    expect(browser).not.toContain('function jobOutcomeDemo()');
  });

  test('requires session isolation, stale-write protection and exact paid-state nonmutation evidence', () => {
    const mounted = read('tests/api/m25-part14b-demo-learning.test.js');
    const visual = read('tests/browser/m25-part14b-demo-learning.js');
    for (const proof of ['firstCookie).not.toBe(secondCookie', 'expectedRevision', 'paidStateDigest', "demo_command_center_sessions","demo_command_center_mutations", 'foreign.status).toBe(403)', "code: '23514'"]) expect(mounted).toContain(proof);
    for (const proof of ['width: 360, height: 800', 'width: 390, height: 844', 'width: 768, height: 1024', 'width: 1024, height: 768', 'width: 1440, height: 900', 'pageErrors', 'outsideRequests', 'scrollY), 0', 'Reset fictional journey']) expect(visual).toContain(proof);
  });
});
