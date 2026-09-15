'use strict';

const fs = require('fs');
const path = require('path');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
}

describe('customer card clarity corrections', () => {
  test('actions scroll normally and transcript is a first-level customer-card section', () => {
    const css = source('public/css/site-professionalism.css');
    const detail = source('public/js/customer-detail.js');
    expect(css).toMatch(/#cdCustomerDrawer \.drawer-primary-actions \{ position:static;/);
    expect(detail).toContain("content.prepend(actionSection,estimateHub,$('cdTranscriptDisclosure'),polarisSection");
    expect(detail).toContain("activityTitle.textContent='Activity & Customer History'");
  });

  test('owner work updates no longer ask for an internal reason', () => {
    const work = source('public/js/owner-work.js');
    expect(work).not.toContain("field(fields,'reason','Reason For This Update'");
    expect(work).toContain("savedReasons={initialize:'Open the assigned work record.'");
  });

  test('coach and workspace cards project changing workspace facts', () => {
    const page = source('public/js/command-center-page.js');
    const html = source('public/demo-dashboard.html');
    const css = source('public/css/demo-dashboard.css');
    expect(page).toContain("var ranked = graphs.slice().sort");
    expect(page).toContain("commandCenterPulseAttention");
    expect(html).toContain('id="commandCenterWorkspacePulse"');
    expect(css).toMatch(/\.demo-coach-panel>h2, \.demo-status-panel h2 \{ margin: 0 0 20px;/);
  });
});
