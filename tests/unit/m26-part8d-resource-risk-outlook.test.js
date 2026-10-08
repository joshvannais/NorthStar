'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function api() {
  const context = { window: {}, console, Date, Number, Promise, Set, BigInt, Reflect };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
    '../../public/js/command-center-resource-risk-outlook.js'), 'utf8'), context);
  return context.window.NorthStarResourceRiskOutlook;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function paidBundle() {
  const value = clone(api().demoBundle());
  value.material.fictional = false; value.asset.fictional = false; value.route.fictional = false;
  return value;
}
const PAID_AUTHORITY = Object.freeze({ tenantId: 'tenant-paid-example', role: 'owner',
  mode: 'paid', fictional: false });
const DEMO_AUTHORITY = Object.freeze({ tenantId: 'tenant-demo-example', role: 'viewer',
  mode: 'demo', fictional: true });

function unavailable(value, reason) {
  const result = clone(value); result.state = 'unavailable'; result.reason = reason;
  result.sources = null; Object.keys(result.sourceCoverage).forEach(key => {
    if (!['state', 'completeAsOf', 'hasMore', 'reason'].includes(key)) result.sourceCoverage[key] = null;
  });
  Object.assign(result.sourceCoverage, { state: 'unavailable', completeAsOf: false,
    hasMore: null, reason });
  Object.keys(result.evidence).forEach(key => { result.evidence[key] = false; });
  result.learnedOutcomes = { state: 'unavailable', applicableValueCount: null,
    applied: false, reason };
  result.run.sourceDigest = null; result.run.digest = null;
  Object.keys(result).filter(key => /ForecastIssued$/.test(key) || key === 'forecastIssued')
    .forEach(key => { result[key] = false; });
  if (result.version === 'm26-material-demand-risk-forecast-v1') {
    result.demand = { state: 'unavailable', groupCount: null, componentCount: null,
      groups: null, reason };
  } else if (result.version === 'm26-asset-utilization-risk-forecast-v1') {
    result.assets = null; result.utilization = { state: 'unavailable', assetCount: null,
      useCount: null, claimedOperatingHours: null, operatingTimeVerified: false,
      checkoutDurationUsed: false, reason };
  } else {
    result.routes = null; result.declaredRouteLoad = { state: 'unavailable', routeLineCount: null,
      tripLegs: null, vehicleLegs: null, declaredVehicleMiles: null,
      declaredVehicleKilometres: null, reason };
    ['verifiedRoadMileage', 'routeTiming', 'fuelEnergy', 'logisticsCapacityRisk'].forEach(key => {
      result[key] = { state: 'unavailable', value: null, unit: null, reason };
    });
  }
  return result;
}

class Element {
  constructor() {
    this.textContent = ''; this.dataset = {}; this.children = []; this.attributes = {};
    this.style = {}; this.hidden = false; this.className = '';
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
}
function renderedText(node) {
  return [node.textContent].concat(node.children.map(renderedText)).filter(Boolean).join(' ');
}

const ids = ['commandCenterResourceOutlook', 'commandCenterResourceState',
  'commandCenterResourceExplanation', 'commandCenterResourceBoundary',
  'commandCenterResourceStatus', 'commandCenterResourceGraphBars',
  'commandCenterResourceGraphDescription', 'commandCenterResourceMaterialState',
  'commandCenterResourceAuthority',
  'commandCenterResourceMaterialValue', 'commandCenterResourceMaterialContext',
  'commandCenterResourceMaterialDetails', 'commandCenterResourceAssetState',
  'commandCenterResourceAssetValue', 'commandCenterResourceAssetContext',
  'commandCenterResourceAssetDetails', 'commandCenterResourceRouteState',
  'commandCenterResourceRouteValue', 'commandCenterResourceRouteContext',
  'commandCenterResourceRouteDetails'];

function documentFixture() {
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { elements, document: { getElementById: id => elements[id],
    createElement: () => new Element() } };
}

function response(data, ok = true) {
  return { ok, json: async () => ok ? { success: true, data } :
    { success: false, error: { message: 'unavailable' } } };
}

describe('Mission 26 original Part 8D compact resource-risk outlook', () => {
  test('accepts only exact released Part 8A-C positions and fails closed per metric', () => {
    const browser = api(); const bundle = browser.demoBundle();
    expect(browser.validateMaterial(bundle.material)).not.toBeNull();
    expect(browser.validateAsset(bundle.asset)).not.toBeNull();
    expect(browser.validateRoute(bundle.route)).not.toBeNull();

    const extra = clone(bundle.material); extra.privateJob = 'hidden';
    expect(browser.validateMaterial(extra)).toBeNull();
    const stock = clone(bundle.material); stock.stockoutRisk =
      { state: 'current', risk: 'low', shortageQuantity: '0', reason: null };
    expect(browser.validateMaterial(stock)).toBeNull();
    const mixed = clone(bundle.material);
    mixed.demand.groups[1].unit = 'hours';
    expect(browser.validateMaterial(mixed)).toBeNull();
    const duplicate = clone(bundle.material);
    duplicate.demand.groups[1].components[0].lineId =
      duplicate.demand.groups[0].components[0].lineId;
    expect(browser.validateMaterial(duplicate)).toBeNull();
    const longMaterial = clone(bundle.material);
    longMaterial.sources[0].job.plannedWindow.endsAt = '2026-10-18T17:00:00.000Z';
    longMaterial.demand.groups.forEach(group => {
      group.plannedWindow.endsAt = '2026-10-18T17:00:00.000Z';
    });
    expect(browser.validateMaterial(longMaterial)).not.toBeNull();

    const checkout = clone(bundle.asset); checkout.assets[0].plannedUtilization.checkoutDurationUsed = true;
    expect(browser.validateAsset(checkout)).toBeNull();
    const serviceDate = clone(bundle.asset);
    serviceDate.assets[0].serviceInterval.verifiedServiceDate = '2026-10-10';
    expect(browser.validateAsset(serviceDate)).toBeNull();
    const meterCorrection = clone(bundle.asset);
    meterCorrection.assets[0].meter.reading = '101';
    expect(browser.validateAsset(meterCorrection)).toBeNull();
    const maintenance = clone(bundle.asset); maintenance.maintenanceDueForecastIssued = true;
    expect(browser.validateAsset(maintenance)).toBeNull();
    const longAsset = clone(bundle.asset);
    longAsset.sources[0].job.plannedWindow.endsAt = '2026-10-18T17:00:00.000Z';
    longAsset.assets[0].plannedUtilization.uses[0].plannedWindow.endsAt =
      '2026-10-18T17:00:00.000Z';
    expect(browser.validateAsset(longAsset)).not.toBeNull();

    const mileage = clone(bundle.route);
    mileage.verifiedRoadMileage = { state: 'current', value: '40', unit: 'mi', reason: null };
    expect(browser.validateRoute(mileage)).toBeNull();
    const fuel = clone(bundle.route); fuel.fuelEnergyForecastIssued = true;
    expect(browser.validateRoute(fuel)).toBeNull();
    const capacity = clone(bundle.route); capacity.automaticActionAuthorized = true;
    expect(browser.validateRoute(capacity)).toBeNull();
    const distance = clone(bundle.route);
    distance.routes[0].declaredDistance.totalVehicleLegDistance = '41';
    expect(browser.validateRoute(distance)).toBeNull();
    const longRoute = clone(bundle.route);
    longRoute.sources[0].job.plannedWindow.endsAt = '2026-10-18T17:00:00.000Z';
    expect(browser.validateRoute(longRoute)).not.toBeNull();
  });

  test('renders each authenticated unavailable reason with exact coverage and evidence', async () => {
    const browser = api(); const bundle = paidBundle(); const fixture = documentFixture();
    const values = [
      unavailable(bundle.material, 'current_adopted_material_composition_unavailable'),
      unavailable(bundle.asset, 'current_adopted_equipment_composition_unavailable'),
      unavailable(bundle.route, 'current_adopted_travel_composition_unavailable'),
    ];
    let index = 0;
    const controller = browser.create({ mode: 'paid', document: fixture.document,
      fetcher: async () => response(values[index++]) });
    await controller.workspaceReady(PAID_AUTHORITY);
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Unavailable');
    expect(fixture.elements.commandCenterResourceMaterialContext.textContent)
      .toContain('current_adopted_material_composition_unavailable');
    expect(fixture.elements.commandCenterResourceAssetContext.textContent)
      .toContain('current_adopted_equipment_composition_unavailable');
    expect(fixture.elements.commandCenterResourceRouteContext.textContent)
      .toContain('current_adopted_travel_composition_unavailable');
    ['Material', 'Asset', 'Route'].forEach(name => {
      const text = renderedText(fixture.elements['commandCenterResource' + name + 'Details']);
      expect(text).toMatch(/Coverage state unavailable/i);
      expect(text).toMatch(/Coverage complete As Of No/i);
      expect(text).toMatch(/Coverage has More Unavailable/i);
      expect(text).toMatch(/Evidence currentness Verified No/i);
      expect(text).toMatch(/Calculation source Digest Unavailable/i);
    });
  });

  test('shares one paid renderer, clears stale values while loading, fails one domain closed, and recovers', async () => {
    const browser = api(); const bundle = paidBundle(); const fixture = documentFixture();
    fixture.elements.commandCenterResourceMaterialValue.textContent = 'private stale material';
    fixture.elements.commandCenterResourceAssetValue.textContent = 'private stale asset';
    fixture.elements.commandCenterResourceRouteValue.textContent = 'private stale route';
    let calls = [];
    let pendingResolvers = [];
    const controller = browser.create({ mode: 'paid', document: fixture.document,
      fetcher: url => { calls.push(url); return new Promise(resolve => pendingResolvers.push(resolve)); } });
    fixture.elements.commandCenterResourceAuthority.textContent = 'private stale tenant';
    const pending = controller.workspaceReady(PAID_AUTHORITY);
    expect(fixture.elements.commandCenterResourceMaterialValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterResourceAssetValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterResourceRouteValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterResourceGraphBars.children).toHaveLength(0);
    expect(renderedText(fixture.elements.commandCenterResourceAuthority)).not.toContain('private stale tenant');
    expect(calls).toEqual(['/api/v1/forecast/material-demand-risk/current',
      '/api/v1/forecast/asset-utilization-risk/current',
      '/api/v1/forecast/route-load-risk/current']);
    pendingResolvers[0](response(bundle.material)); pendingResolvers[1](response(bundle.asset));
    pendingResolvers[2](response(bundle.route)); await pending;
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Current');
    expect(fixture.elements.commandCenterResourceMaterialValue.textContent).toBe('2 material groups');
    expect(fixture.elements.commandCenterResourceAssetValue.textContent).toBe('1 asset · 2 claimed h');
    expect(fixture.elements.commandCenterResourceRouteValue.textContent).toBe('1 route line');
    expect(fixture.elements.commandCenterResourceGraphBars.children).toHaveLength(3);
    expect(fixture.elements.commandCenterResourceGraphDescription.textContent)
      .toMatch(/Separate record counts; no combined resource total/);
    const materialEvidence = renderedText(fixture.elements.commandCenterResourceMaterialDetails);
    const assetEvidence = renderedText(fixture.elements.commandCenterResourceAssetDetails);
    const routeEvidence = renderedText(fixture.elements.commandCenterResourceRouteDetails);
    expect(materialEvidence).toMatch(/Authenticated tenant tenant-paid-example/);
    expect(materialEvidence).toMatch(/Authenticated role owner/);
    expect(materialEvidence).toContain(bundle.material.sources[0].job.assignmentId);
    expect(materialEvidence).toContain(bundle.material.sources[0].job.bookingConfirmationId);
    expect(materialEvidence).toMatch(/Coverage complete As Of Yes/i);
    expect(materialEvidence).toMatch(/Coverage has More No/i);
    expect(materialEvidence).toContain(bundle.material.sources[0].composition.id);
    expect(materialEvidence).toContain(bundle.material.sources[0].composition.digest);
    expect(materialEvidence).toContain(bundle.material.sources[0].materialPlan.id);
    expect(materialEvidence).toContain(bundle.material.demand.groups[0].components[0].lineId);
    expect(materialEvidence).toMatch(/Business time zone America\/New_York/i);
    expect(assetEvidence).toContain(bundle.asset.sources[0].equipmentPlan.id);
    expect(assetEvidence).toContain(bundle.asset.sources[0].readinessPlan.evidenceDigest);
    expect(assetEvidence).toContain(bundle.asset.assets[0].meter.eventDigest);
    expect(assetEvidence).toMatch(/Meter correction Applied No/i);
    expect(assetEvidence).toMatch(/Claimed operating hours exact unit hours/i);
    expect(routeEvidence).toContain(bundle.route.sources[0].travelPlan.sourceDigest);
    expect(routeEvidence).toContain(bundle.route.routes[0].tripId);
    expect(routeEvidence).toContain(bundle.route.routes[0].route.originDigest);
    expect(routeEvidence).toMatch(/Movement reason movement_class_unavailable/i);
    expect(routeEvidence).toMatch(/Resource reason resource_identity_unavailable/i);
    expect(routeEvidence).toMatch(/Declared distance unit mi/i);

    pendingResolvers = []; calls = [];
    const partial = controller.workspaceReady(PAID_AUTHORITY);
    const unavailableAsset = unavailable(bundle.asset, 'current_adopted_equipment_composition_unavailable');
    pendingResolvers[0](response(bundle.material)); pendingResolvers[1](response(unavailableAsset));
    pendingResolvers[2](response(bundle.route)); await partial;
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Partial');
    expect(fixture.elements.commandCenterResourceAssetValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterResourceMaterialValue.textContent).toBe('2 material groups');
    expect(fixture.elements.commandCenterResourceGraphBars.children).toHaveLength(2);
    expect(fixture.elements.commandCenterResourceAssetContext.textContent)
      .toContain('current_adopted_equipment_composition_unavailable');
    expect(renderedText(fixture.elements.commandCenterResourceAssetDetails))
      .toMatch(/Coverage complete As Of No/i);
    expect(renderedText(fixture.elements.commandCenterResourceAssetDetails))
      .toMatch(/Evidence currentness Verified No/i);

    pendingResolvers = [];
    const corrected = clone(bundle.material);
    corrected.sources[0].materialPlan.digest = 'f'.repeat(64);
    const recovered = controller.workspaceReady(PAID_AUTHORITY);
    pendingResolvers[0](response(corrected)); pendingResolvers[1](response(bundle.asset));
    pendingResolvers[2](response(bundle.route)); await recovered;
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Current');
    expect(fixture.elements.commandCenterResourceAssetValue.textContent).toBe('1 asset · 2 claimed h');
    expect(renderedText(fixture.elements.commandCenterResourceMaterialDetails)).toContain('f'.repeat(64));
    expect(renderedText(fixture.elements.commandCenterResourceMaterialDetails)).not.toContain('c'.repeat(64));
  });

  test('keeps fictional demo isolated, preserves zero versus absent, and clears on withdrawal', async () => {
    const browser = api(); const fixture = documentFixture(); let calls = 0;
    const controller = browser.create({ mode: 'demo', document: fixture.document,
      fetcher: () => { calls += 1; throw new Error('demo must not call paid routes'); } });
    await controller.workspaceReady(DEMO_AUTHORITY);
    expect(calls).toBe(0);
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Fictional example');
    expect(renderedText(fixture.elements.commandCenterResourceMaterialDetails)).toContain('110 ft');
    expect(renderedText(fixture.elements.commandCenterResourceMaterialDetails)).toContain('24 ea');
    expect(renderedText(fixture.elements.commandCenterResourceRouteDetails))
      .toContain('40 mi declared vehicle-leg distance');
    expect(fixture.elements.commandCenterResourceRouteContext.textContent)
      .toMatch(/not verified road mileage/);

    controller.workspaceUnavailable();
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Workspace unavailable');
    expect(fixture.elements.commandCenterResourceMaterialValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterResourceAssetValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterResourceRouteValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterResourceGraphBars.children).toHaveLength(0);
    expect(renderedText(fixture.elements.commandCenterResourceAuthority))
      .toMatch(/authenticated tenant and role context is unavailable/i);
    await controller.workspaceReady(DEMO_AUTHORITY);
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Fictional example');

    await controller.workspaceReady(null);
    expect(fixture.elements.commandCenterResourceState.textContent).toBe('Workspace unavailable');
    expect(fixture.elements.commandCenterResourceGraphBars.children).toHaveLength(0);

    const zero = browser.demoBundle();
    zero.material.demand.groups = []; zero.material.demand.groupCount = 0;
    zero.material.demand.componentCount = 0; zero.material.sourceCoverage.componentLineCount = 0;
    expect(browser.validateMaterial(zero.material)).not.toBeNull();
    const absent = clone(zero.material); absent.demand.groupCount = null;
    expect(browser.validateMaterial(absent)).toBeNull();
  });

  test('mounts the compact accessible outlook beside Demand outlook in the existing shell', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/demo-dashboard.html'), 'utf8');
    const demand = html.indexOf('id="commandCenterDemandOutlook"');
    const resource = html.indexOf('id="commandCenterResourceOutlook"');
    expect(resource).toBeGreaterThan(demand);
    expect(html).toMatch(/id="commandCenterResourceStatus"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/);
    expect(html).toContain('aria-labelledby="commandCenterResourceGraphTitle commandCenterResourceGraphDescription"');
    expect(html).toContain('id="commandCenterResourceAuthority"');
    expect(html).toContain('/js/command-center-resource-risk-outlook.js?v=m26-part8d-20261008');
    const page = fs.readFileSync(path.resolve(__dirname, '../../public/js/command-center-page.js'), 'utf8');
    expect(page).toContain('NorthStarResourceRiskOutlook.create');
    expect(page).toContain('resourceRiskOutlook.workspaceUnavailable()');
    expect(page).toContain('renderResourceRiskOutlook();');
    expect(page).toContain('resourceRiskOutlook.workspaceReady(refreshed)');
  });
});
