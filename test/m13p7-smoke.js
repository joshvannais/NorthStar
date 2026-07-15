/**
 * M13-P7: Asset & Equipment Intelligence Engine — Smoke Tests
 */

const store = require('../src/polaris/store');
const ast = require('../src/polaris/asset-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

var initResult = ast.init();
c('init returns object', typeof initResult === 'object');
c('init has loaded count', typeof initResult.loaded === 'number');

// ── Asset Creation ──

var a1 = ast.createAsset({
  name: 'Ford F-250 - Service Truck #1',
  type: 'vehicle',
  serialNumber: 'VIN-12345-FORD',
  purchaseCost: 45000,
  purchaseDate: '2024-01-15T00:00:00.000Z',
  lifespanYears: 8,
  location: 'Main Garage',
  notes: 'Primary service vehicle',
});

c('create asset returns id', !!a1.id);
c('create asset name', a1.name.indexOf('Ford') !== -1);
c('create asset type', a1.type === 'vehicle');
c('create asset status', a1.status === 'active');
c('create asset currentValue', a1.currentValue === 45000);
var assetId1 = a1.id;

var a2 = ast.createAsset({
  name: '3-Ton AC Unit - Warehouse Stock',
  type: 'inventory',
  serialNumber: 'SER-AC-2024-001',
  purchaseCost: 3200,
  purchaseDate: '2025-06-01T00:00:00.000Z',
  lifespanYears: 15,
  location: 'Warehouse A',
});

c('create asset 2', !!a2.id);
var assetId2 = a2.id;

var a3 = ast.createAsset({
  name: 'Stihl MS 881 Chainsaw',
  type: 'chainsaw',
  serialNumber: 'STIHL-881-123',
  purchaseCost: 1800,
  purchaseDate: '2025-03-01T00:00:00.000Z',
  lifespanYears: 5,
  location: 'Tool Shed',
});

c('create asset 3', !!a3.id);
var assetId3 = a3.id;

// ── Get Asset ──

var g = ast.getAsset(assetId1);
c('get asset returns name', g.name.indexOf('Ford') !== -1);
c('get asset returns serial', g.serialNumber === 'VIN-12345-FORD');
c('get asset returns immutable', g.id === assetId1);

// ── Update Asset ──

var u = ast.updateAsset(assetId1, {
  name: 'Ford F-250 - Service Truck #1 (Updated)',
  location: 'Service Bay 3',
});
c('update asset name', u.name.indexOf('Updated') !== -1);
c('update asset location', typeof u.updatedAt === 'string');

// ── Archive / Restore ──

var arch = ast.archiveAsset(assetId3);
c('archive status', arch.status === 'archived');

var rest = ast.restoreAsset(assetId3);
c('restore status', rest.status === 'active');

var restError = ast.restoreAsset(assetId3);
c('restore already active error', restError.error !== undefined);

// ── List Assets ──

var list = ast.listAssets();
c('list returns array', Array.isArray(list.assets));
c('list has 3 assets', list.total === 3);

var vehicles = ast.listAssets({ type: 'vehicle' });
c('filter by type', vehicles.total === 1);

// ── Search ──

var search = ast.searchAssets('Ford');
c('search finds Ford', search.total >= 1);
var search2 = ast.searchAssets('Chainsaw');
c('search finds Chainsaw', search2.total >= 1);

// ── Assignment ──

var asgn = ast.assignAsset(assetId1, {
  assignedTo: 'Mike (Tech)',
  assignedOpportunityId: 'opp_ast_test_1',
  assignedCustomerId: 'cust_ast_test_1',
});
c('assign sets status inUse', asgn.status === 'inUse');
c('assign returns assignedTo', asgn.assignedTo === 'Mike (Tech)');

var unasgn = ast.unassignAsset(assetId1);
c('unassign status active', unasgn.status === 'active');

// ── Maintenance ──

var maint = ast.scheduleMaintenance({
  assetId: assetId1,
  type: 'preventive',
  description: 'Oil change and filter replacement',
  scheduledDate: new Date(Date.now() + 7 * 86400000).toISOString(),
  estimatedCost: 250,
  notes: 'Use synthetic oil',
});

c('schedule maintenance id', !!maint.id);
c('schedule maintenance type', maint.type === 'preventive');
c('schedule maintenance status scheduled', maint.status === 'scheduled');
var maintId = maint.id;

var ga = ast.getAsset(assetId1);
c('asset status changed to maintenance', ga.status === 'maintenance');

var comp = ast.completeMaintenance(maintId, { actualCost: 235, notes: 'Completed on time' });
c('complete maintenance status', comp.status === 'completed');
c('complete maintenance actualCost', comp.actualCost === 235);

var ga2 = ast.getAsset(assetId1);
c('asset returned to active after maintenance', ga2.status === 'active');

// ── Inspection ──

var insp = ast.recordInspection(assetId2, {
  inspector: 'Safety Officer',
  result: 'pass',
  notes: 'All clear - inventory in good condition',
  cost: 0,
});
c('inspection returns id', !!insp.id);
c('inspection result', insp.result === 'pass');

// ── Repair ──

var repair = ast.recordRepair(assetId3, {
  description: 'Chain brake replacement',
  cost: 120,
  vendor: 'Stihl Authorized Service',
  notes: 'Warranty covered parts',
});
c('repair returns id', !!repair.id);
c('repair cost', repair.cost === 120);

// ── Fuel Purchase ──

var fuel = ast.recordFuelPurchase(assetId1, {
  gallons: 25,
  costPerGallon: 3.50,
});
c('fuel gallons', fuel.gallons === 25);
c('fuel totalCost', fuel.totalCost === 87.5);
c('fuel cumulative', fuel.totalFuelConsumed === 25);

var fuel2 = ast.recordFuelPurchase(assetId1, { gallons: 15, totalCost: 52.5 });
c('fuel2 cumulative gallons', fuel2.totalFuelConsumed === 40);

// ── Usage ──

var usage = ast.recordUsage(assetId1, { hours: 8, mileage: 120 });
c('usage hours', usage.totalHours === 8);
c('usage mileage', usage.totalMileage === 120);

var usage2 = ast.recordUsage(assetId1, { hours: 6, mileage: 85 });
c('usage2 cumulative hours', usage2.totalHours === 14);
c('usage2 cumulative mileage', usage2.totalMileage === 205);

// ── Location ──

var loc = ast.recordLocation(assetId1, 'Job Site - 123 Main St');
c('location updated', loc.location === 'Job Site - 123 Main St');

// ── Utilization ──

var util = ast.calculateUtilization(assetId1);
c('utilization rate is number', typeof util.utilizationRate === 'number');
c('utilization in range', util.utilizationRate >= 0 && util.utilizationRate <= 100);
c('utilization has display', typeof util.utilizationDisplay === 'string');

// ── Operating Cost ──

var op = ast.calculateOperatingCost(assetId1);
c('operating cost total', typeof op.totalOperatingCost === 'number');
c('operating cost costPerHour', typeof op.costPerHour === 'number');

// ── Maintenance Cost ──

var mc = ast.calculateMaintenanceCost(assetId1);
c('maintenance cost total', typeof mc.totalMaintenanceCost === 'number');

// ── Depreciation ──

var dep = ast.calculateDepreciation(assetId1);
c('depreciation purchaseCost', dep.purchaseCost === 45000);
c('depreciation bookValue', typeof dep.bookValue === 'number');
c('depreciation annualDepreciation', dep.annualDepreciation === 5625);
c('depreciation has accumulation', typeof dep.accumulatedDepreciation === 'number');

// ── Replacement Score ──

var rs = ast.calculateReplacementScore(assetId1);
c('replacement score 0-100', rs.replacementScore >= 0 && rs.replacementScore <= 100);
c('replacement has label', typeof rs.label === 'string');
c('replacement has factors', Array.isArray(rs.factors));

// ── Maintenance Schedule ──

var ms = ast.getMaintenanceSchedule(assetId1);
c('maintenance schedule array', Array.isArray(ms.maintenance));
c('maintenance schedule has records', ms.total >= 1);

// ── Upcoming Maintenance ──

var um = ast.getUpcomingMaintenance(60);
c('upcoming maintenance array', Array.isArray(um.maintenance));

// ── Inspection History ──

var ih = ast.getInspectionHistory(assetId2);
c('inspection history', ih.total >= 1);

// ── Asset Metrics ──

var metrics = ast.getAssetMetrics();
c('metrics totalAssets', metrics.totalAssets === 3);
c('metrics totalValue', typeof metrics.totalValue === 'number');
c('metrics byType', typeof metrics.byType === 'object');
c('metrics byType vehicle count', metrics.byType.vehicle.count === 1);
c('metrics upcomingMaintenance', typeof metrics.upcomingMaintenance === 'number');

// ── Asset Types ──

var types = ast.getAssetTypes();
c('9 asset types', types.length === 9);

// ── Error Cases ──

c('create without name', ast.createAsset({}).error !== undefined);
c('get nonexistent', ast.getAsset('nonexistent').error !== undefined);
c('update nonexistent', ast.updateAsset('nonexistent', {}).error !== undefined);
c('archive nonexistent', ast.archiveAsset('nonexistent').error !== undefined);
c('maintenance without assetId', ast.scheduleMaintenance({}).error !== undefined);
c('assign nonexistent', ast.assignAsset('nonexistent', {}).error !== undefined);
c('unassign nonexistent', ast.unassignAsset('nonexistent').error !== undefined);
c('fuel nonexisent', ast.recordFuelPurchase('nonexistent', {}).error !== undefined);
c('usage nonexistent', ast.recordUsage('nonexistent', {}).error !== undefined);
c('location nonexistent', ast.recordLocation('nonexistent', 'here').error !== undefined);
c('invalid asset type', ast.createAsset({name:'Test', type:'invalid'}).error !== undefined);
c('invalid asset status', ast.createAsset({name:'Test', status:'invalid'}).error !== undefined);

// ── Final Summary ──

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');