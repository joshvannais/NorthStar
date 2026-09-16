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

  test('command center prioritizes five recent leads and uses the shared action style', () => {
    const html = source('public/demo-dashboard.html');
    const css = source('public/css/demo-dashboard.css');
    const scheduling = source('public/css/scheduling-approval.css');
    const page = source('public/js/command-center-page.js');
    expect(html.indexOf('id="commandCenterKpis"')).toBeLessThan(html.indexOf('id="commandCenterLeadsTitle"'));
    expect(html.indexOf('id="commandCenterLeadsTitle"')).toBeLessThan(html.indexOf('id="commandCenterScheduling"'));
    expect(html).toContain('class="btn btn-primary demo-coach-action"');
    expect(css).toMatch(/\.demo-table-wrap \{[^}]*max-height: 326px;[^}]*overflow: auto;/s);
    expect(css).toMatch(/\.command-center-mobile-leads \{[^}]*max-height: 434px;[^}]*overflow-y:auto;/s);
    expect(scheduling).toMatch(/\.m22-overview-list \{[^}]*max-height: 1036px;[^}]*overflow-y:auto;/s);
    expect(page).toContain('var visible = graphs;');
  });

  test('reload returns to the top and scope details omit internal assessment prompts', () => {
    const runtime=source('public/js/demo-runtime.js');
    const detail=source('public/js/customer-detail.js');
    expect(runtime).toContain('reloadToTopRequested=true');
    expect(runtime).toContain("global.scrollTo({top:0,left:0,behavior:'auto'})");
    expect(detail).toContain("'assessmentQuestions'");
    expect(detail).toContain('scopeKeys.slice(0,12)');
    expect(detail).toContain("letter.toUpperCase()");
    expect(detail).toContain("approximateHeightFeet:'Approximate height'");
    expect(detail).toContain("nearStructure:'Near a structure'");
    expect(detail).toContain("approximateHeightFeet:'ft'");
    expect(detail).toContain("key==='equipmentReference'&&scope.equipmentName");
    expect(detail).toContain('seenScopeValues[value]');
  });

  test('estimate action opens a downloadable draft before commercial approval', () => {
    const preview=source('public/js/customer-estimate-preview.js');
    const demoRoute=source('src/routes/demo.js');
    const paidRoute=source('src/routes/canonicalPolaris.js');
    expect(preview).toContain("'View Draft Estimate'");
    expect(preview).toContain("section.dataset.state=ready?'ready':'draft'");
    expect(preview).not.toContain('section.hidden=!ready');
    expect(demoRoute).toContain('createCustomerEstimateDisplay');
    expect(paidRoute).toContain('createCustomerEstimateDisplay');
  });

  test('Polaris estimate builder stays current and exposes the complete resource plan', () => {
    const prepared=source('public/js/prepared-estimate.js');
    expect(prepared).toContain("'Polaris Estimate Builder'");
    expect(prepared).toContain("'View Draft Estimate'");
    expect(prepared).toContain("'Equipment And Tools'");
    expect(prepared).toContain("'Vehicles, Travel And Logistics'");
    expect(prepared).toContain("options.refresh();");
    expect(prepared).not.toContain('This draft review expired. Refresh before calculating again.');
    expect(prepared).not.toContain("'Review Prepared Estimate'");
  });

  test('Business Profile separates industry tool inventory from vehicles and machinery', () => {
    const profile=source('public/dashboard/business-profile.html');
    const equipment=source('public/js/equipment.js');
    expect(profile).toContain('data-section="inventory"');
    expect(profile).toContain('Industry Tool Inventory');
    expect(profile).toContain('Husqvarna 550 XP Mark II chainsaw');
    expect(equipment).toContain("asset.category==='tool'");
    expect(equipment).toContain("asset.category!=='tool'");
  });
});
