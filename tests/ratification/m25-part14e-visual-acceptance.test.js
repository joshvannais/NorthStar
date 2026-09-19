'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = value => fs.readFileSync(path.join(root, value), 'utf8');

describe('Mission 25 Part 14E visual and accessibility acceptance', () => {
  test('freezes the exact rendered acceptance slice without changing backend authority', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    expect(roadmap).toContain('## Part 14 Slice E candidate — mission-wide accessibility and responsive review');
    expect(roadmap).toContain('360 by 800 dark');
    expect(roadmap).toContain('Physical Safari, physical phones and tablets, manual assistive-technology results and the founder visual verdict remain explicitly unavailable');
  });

  test('provides keyboard, reflow, theme and preference safeguards in plain rendered markup', () => {
    const html = read('public/dashboard/learning-center.html');
    const page = read('public/js/learning-center-page.js');
    const css = read('public/css/learning-center.css');
    expect(html).toContain('class="learning-skip" href="#learningMain"');
    expect(html).toContain('tabindex="-1" aria-busy="true"');
    expect(html).toContain('m25-mission-visual-correction-20260918');
    expect(page).toContain("wrap.tabIndex = 0; wrap.setAttribute('role', 'region')");
    expect(page).toContain("wrap.setAttribute('aria-label', 'Reference review table')");
    expect(page).toContain("tr.children[cellIndex].dataset.label = label");
    expect(page).toContain("selectedLabel.textContent = select.value ? 'Selected company record: '");
    expect(css).toContain('.learning-table td:last-child{display:block}');
    expect(css).toContain('.learning-selected-target{color:var(--theme-text);display:block');
    for (const value of ['textarea:focus-visible', 'a:focus-visible', '@media(prefers-reduced-motion:reduce)', '@media(forced-colors:active)', 'env(safe-area-inset-left)', '.learning-actions>.btn{width:100%}', '.learning-table td::before', 'content:attr(data-label)']) expect(css).toContain(value);
    expect(html).not.toMatch(/(?:Request ID|Database schema|Internal state|Idempotency key)/i);
  });

  test('keeps one explicit five-layout paid matrix and the accepted five-layout isolated demo matrix', () => {
    const paid = read('tests/browser/m25-part14e-paid-learning-center.js');
    const demo = read('tests/browser/m25-part14b-demo-learning.js');
    for (const value of ['phone-narrow-dark', 'phone-light', 'tablet-portrait-dark', 'tablet-landscape-light', 'desktop-dark']) {
      expect(paid).toContain(value);
      expect(demo).toContain(value);
    }
    for (const value of ['reducedMotion:\'reduce\'', 'unlabeledControls', 'scrollY', 'externalRequests', 'pageErrors']) expect(paid).toContain(value);
    for (const value of ['permission, cohort selection, evidence review, save, adoption, removal, reload and reset', 'outsideRequests', 'pageErrors']) expect(demo).toContain(value);
  });

  test('proves long-prefix target choices remain visibly distinguishable on both phone widths and engines', () => {
    const probe = read('tests/browser/m25-part14e-reference-visibility.js');
    for (const value of ['Arborist Crew Lead · Regional North', 'Arborist Crew Lead · Regional South', "['chrome','webkit']", 'for(const width of [360,390])', 'assert.notEqual(northPixels,southPixels', 'ledger.mutations.at(-1).targetId', 'northPreview.isVisible()', 'southPreview.isVisible()']) expect(probe).toContain(value);
  });
});
