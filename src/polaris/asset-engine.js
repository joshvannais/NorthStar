/**
 * Polaris Asset & Equipment Intelligence Engine
 *
 * Tracks equipment, vehicles, tools, inventory assets, maintenance schedules,
 * inspections, utilization, depreciation, and job assignments.
 *
 * Ownership Boundary:
 *   - Asset lifecycle (create, update, archive, restore)
 *   - Asset assignment to crews, jobs, customers
 *   - Maintenance scheduling and completion
 *   - Inspection and repair records
 *   - Fuel and usage tracking
 *   - Utilization calculations
 *   - Operating and maintenance cost analysis
 *   - Depreciation and replacement scoring
 *   - Asset health metrics
 *
 * NOT customer management, communication history, opportunity management,
 * workflow management, financial management, learning, validation, or UI.
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence) — file-backed storage
 *   - communications-engine.js (activity recording)
 *   - workflow-engine.js (task creation for maintenance)
 *   - opportunity-engine.js (opportunity context)
 *   - customer-engine.js (customer context)
 *   - financial-engine.js (cost context)
 *   - engine.js (recommendations + learning)
 */

const store = require('./store');

// ── Asset Type Constants ──
const ASSET_TYPES = Object.freeze({
  equipment:   { id: 'equipment',   displayName: 'Equipment',   icon: 'tool' },
  vehicle:     { id: 'vehicle',     displayName: 'Vehicle',     icon: 'truck' },
  trailer:     { id: 'trailer',     displayName: 'Trailer',     icon: 'package' },
  chainsaw:    { id: 'chainsaw',    displayName: 'Chainsaw',    icon: 'zap' },
  lift:        { id: 'lift',        displayName: 'Lift',        icon: 'arrow-up' },
  climbingGear: { id: 'climbingGear', displayName: 'Climbing Gear', icon: 'anchor' },
  inventory:   { id: 'inventory',   displayName: 'Inventory',   icon: 'package' },
  tool:        { id: 'tool',        displayName: 'Tool',        icon: 'wrench' },
  other:       { id: 'other',       displayName: 'Other',       icon: 'box' },
});

const VALID_ASSET_TYPES = new Set(Object.keys(ASSET_TYPES));

// ── Asset Status Constants ──
const ASSET_STATUSES = Object.freeze({
  active:       { id: 'active',       displayName: 'Active' },
  inUse:        { id: 'inUse',        displayName: 'In Use' },
  maintenance:  { id: 'maintenance',  displayName: 'Under Maintenance' },
  outOfService: { id: 'outOfService', displayName: 'Out of Service' },
  retired:      { id: 'retired',      displayName: 'Retired' },
  archived:     { id: 'archived',     displayName: 'Archived' },
});

const VALID_ASSET_STATUSES = new Set(Object.keys(ASSET_STATUSES));

// ── Maintenance Type Constants ──
const MAINTENANCE_TYPES = Object.freeze({
  preventive: { id: 'preventive', displayName: 'Preventive' },
  corrective: { id: 'corrective', displayName: 'Corrective' },
  inspection: { id: 'inspection', displayName: 'Inspection' },
  repair:     { id: 'repair',     displayName: 'Repair' },
  scheduled:  { id: 'scheduled',  displayName: 'Scheduled' },
});

const VALID_MAINTENANCE_TYPES = new Set(Object.keys(MAINTENANCE_TYPES));

// ── In-memory stores ──
const _assets = {};
const _maintenanceRecords = {};
var _idCounter = 0;

function _genId() {
  _idCounter++;
  return 'ast_' + Date.now() + '_' + _idCounter;
}

function _now() {
  return new Date().toISOString();
}

// ── Persistence ──

function _persistAsset(asset) {
  try {
    store.addRecommendation({
      type: 'asset',
      assetType: 'asset',
      assetId: asset.id,
      data: asset,
      timestamp: asset.updatedAt,
    });
  } catch (e) {}
}

function _persistMaintenance(record) {
  try {
    store.addRecommendation({
      type: 'asset',
      assetType: 'maintenance',
      assetId: record.assetId,
      data: record,
      timestamp: record.createdAt,
    });
  } catch (e) {}
}

function _recordActivity(customerId, action, description, metadata) {
  try {
    var comms = require('./communications-engine');
    comms.recordCommunication({
      customerId: customerId || 'internal',
      type: 'internal',
      direction: 'outbound',
      subject: 'Asset: ' + action,
      content: description,
      status: 'completed',
      author: 'System',
      metadata: metadata || {},
    });
  } catch (e) {}
}

// ── Validation ──

function _validateAssetType(type) {
  if (!VALID_ASSET_TYPES.has(type)) return { valid: false, error: 'Invalid asset type: "' + type + '". Allowed: ' + Array.from(VALID_ASSET_TYPES).join(', ') };
  return { valid: true };
}

function _validateAssetStatus(status) {
  if (!VALID_ASSET_STATUSES.has(status)) return { valid: false, error: 'Invalid asset status: "' + status + '". Allowed: ' + Array.from(VALID_ASSET_STATUSES).join(', ') };
  return { valid: true };
}

function _validateMaintenanceType(type) {
  if (!VALID_MAINTENANCE_TYPES.has(type)) return { valid: false, error: 'Invalid maintenance type: "' + type + '". Allowed: ' + Array.from(VALID_MAINTENANCE_TYPES).join(', ') };
  return { valid: true };
}

// ── Init ──

/**
 * Initialize the Asset Engine — load existing records from the store.
 * @returns {object} { loaded: number }
 */
function init() {
  var loaded = 0;
  try {
    var recs = store.getAllRecommendations() || [];
    recs.forEach(function (r) {
      if (r && r.type === 'asset' && r.data && r.data.id) {
        if (r.assetType === 'asset') _assets[r.data.id] = r.data;
        else if (r.assetType === 'maintenance') _maintenanceRecords[r.data.id] = r.data;
        loaded++;
      }
    });
  } catch (e) {}
  return { loaded: loaded };
}

// ── Asset CRUD ──

/**
 * Create a new asset.
 *
 * @param {object} data - Asset data
 * @param {string} data.name - Asset name (required)
 * @param {string} [data.type='equipment'] - Asset type
 * @param {string} [data.serialNumber] - Serial number
 * @param {number} [data.purchaseCost=0] - Purchase cost
 * @param {string} [data.purchaseDate] - Purchase date (ISO)
 * @param {number} [data.currentValue] - Current value (auto-calculated if not set)
 * @param {number} [data.lifespanYears=5] - Useful life in years
 * @param {string} [data.status='active'] - Asset status
 * @param {string} [data.assignedTo] - Currently assigned to (crew/owner)
 * @param {string} [data.assignedWorkflowId] - Workflow task ID
 * @param {string} [data.assignedOpportunityId] - Opportunity ID
 * @param {string} [data.assignedCustomerId] - Customer ID
 * @param {string} [data.location] - Current location
 * @param {string} [data.notes] - Notes
 * @param {object} [data.metadata] - Additional metadata
 * @returns {object} Created asset
 */
function createAsset(data) {
  if (!data || !data.name) return { error: 'Asset name is required' };

  var type = data.type || 'equipment';
  var typeCheck = _validateAssetType(type);
  if (!typeCheck.valid) return { error: typeCheck.error };

  var status = data.status || 'active';
  var statusCheck = _validateAssetStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  var id = _genId();
  var now = _now();
  var purchaseCost = (typeof data.purchaseCost === 'number' && data.purchaseCost >= 0) ? data.purchaseCost : 0;
  var lifespanYears = data.lifespanYears || 5;
  var currentValue = data.currentValue !== undefined ? data.currentValue : purchaseCost;

  var asset = {
    id: id,
    name: data.name,
    type: type,
    typeDisplayName: ASSET_TYPES[type].displayName,
    serialNumber: data.serialNumber || null,
    purchaseCost: purchaseCost,
    purchaseDate: data.purchaseDate || null,
    currentValue: currentValue,
    lifespanYears: lifespanYears,
    status: status,
    statusDisplayName: ASSET_STATUSES[status].displayName,
    assignedTo: data.assignedTo || null,
    assignedWorkflowId: data.assignedWorkflowId || null,
    assignedOpportunityId: data.assignedOpportunityId || null,
    assignedCustomerId: data.assignedCustomerId || null,
    location: data.location || null,
    notes: data.notes || null,
    metadata: data.metadata ? Object.assign({}, data.metadata) : {},
    totalHours: 0,
    totalMileage: 0,
    totalFuelConsumed: 0,
    totalFuelCost: 0,
    totalRepairCost: 0,
    totalMaintenanceCost: 0,
    totalOperatingCost: 0,
    lastMaintenanceDate: null,
    lastInspectionDate: null,
    createdAt: now,
    updatedAt: now,
  };

  _assets[id] = asset;
  _persistAsset(asset);

  _recordActivity(null, 'Asset Created: ' + data.name,
    'Asset "' + data.name + '" (' + ASSET_TYPES[type].displayName + ') created',
    { assetId: id, type: type, purchaseCost: purchaseCost });

  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    typeDisplayName: asset.typeDisplayName,
    status: asset.status,
    currentValue: asset.currentValue,
    createdAt: asset.createdAt,
  };
}

/**
 * Update an asset.
 *
 * @param {string} id - Asset ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated asset
 */
function updateAsset(id, updates) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };
  if (!updates) return { error: 'Updates object is required' };

  var now = _now();

  if (updates.name !== undefined) asset.name = updates.name;
  if (updates.serialNumber !== undefined) asset.serialNumber = updates.serialNumber;
  if (updates.location !== undefined) asset.location = updates.location;
  if (updates.notes !== undefined) asset.notes = updates.notes;
  if (updates.purchaseCost !== undefined) asset.purchaseCost = updates.purchaseCost;
  if (updates.currentValue !== undefined) asset.currentValue = updates.currentValue;
  if (updates.purchaseDate !== undefined) asset.purchaseDate = updates.purchaseDate;
  if (updates.lifespanYears !== undefined) asset.lifespanYears = updates.lifespanYears;

  if (updates.type !== undefined) {
    var typeCheck = _validateAssetType(updates.type);
    if (!typeCheck.valid) return { error: typeCheck.error };
    asset.type = updates.type;
    asset.typeDisplayName = ASSET_TYPES[updates.type].displayName;
  }

  if (updates.status !== undefined) {
    var statusCheck = _validateAssetStatus(updates.status);
    if (!statusCheck.valid) return { error: statusCheck.error };
    asset.status = updates.status;
    asset.statusDisplayName = ASSET_STATUSES[updates.status].displayName;
  }

  if (updates.metadata) asset.metadata = Object.assign(asset.metadata, updates.metadata);

  asset.updatedAt = now;
  _persistAsset(asset);

  return { id: asset.id, name: asset.name, status: asset.status, updatedAt: asset.updatedAt };
}

/**
 * Archive an asset.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function archiveAsset(id) {
  return updateAsset(id, { status: 'archived' });
}

/**
 * Restore an archived asset.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function restoreAsset(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };
  if (asset.status !== 'archived') return { error: 'Asset is not archived' };
  return updateAsset(id, { status: 'active' });
}

/**
 * Get a single asset.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function getAsset(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };
  return Object.assign({}, asset);
}

/**
 * List assets with optional filters.
 * @param {object} [filters]
 * @returns {object} { assets, total }
 */
function listAssets(filters) {
  var results = [];
  Object.keys(_assets).forEach(function (k) {
    var a = _assets[k];
    if (filters) {
      if (filters.type && a.type !== filters.type) return;
      if (filters.status && a.status !== filters.status) return;
      if (filters.assignedTo && a.assignedTo !== filters.assignedTo) return;
      if (filters.assignedCustomerId && a.assignedCustomerId !== filters.assignedCustomerId) return;
      if (filters.assignedOpportunityId && a.assignedOpportunityId !== filters.assignedOpportunityId) return;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (a.name.toLowerCase().indexOf(q) === -1 && (a.serialNumber || '').toLowerCase().indexOf(q) === -1) return;
      }
    }
    if (a.status === 'archived' && !filters) return;
    results.push(a);
  });
  results.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) results = results.slice(0, filters.limit);
  return { assets: results.map(function (a) { return Object.assign({}, a); }), total: total };
}

/**
 * Search assets by keyword.
 * @param {string} query
 * @param {object} [filters]
 * @returns {object}
 */
function searchAssets(query, filters) {
  return listAssets(Object.assign({}, filters || {}, { search: query }));
}

// ── Assignment ──

/**
 * Assign an asset to a crew, workflow, opportunity, or customer.
 * @param {string} id - Asset ID
 * @param {object} assignment - { assignedTo, assignedWorkflowId, assignedOpportunityId, assignedCustomerId }
 * @returns {object}
 */
function assignAsset(id, assignment) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };
  if (!assignment) return { error: 'Assignment data is required' };

  var now = _now();
  if (assignment.assignedTo !== undefined) asset.assignedTo = assignment.assignedTo;
  if (assignment.assignedWorkflowId !== undefined) asset.assignedWorkflowId = assignment.assignedWorkflowId;
  if (assignment.assignedOpportunityId !== undefined) asset.assignedOpportunityId = assignment.assignedOpportunityId;
  if (assignment.assignedCustomerId !== undefined) asset.assignedCustomerId = assignment.assignedCustomerId;
  asset.status = 'inUse';
  asset.statusDisplayName = ASSET_STATUSES.inUse.displayName;
  asset.updatedAt = now;
  _persistAsset(asset);

  _recordActivity(asset.assignedCustomerId, 'Asset Assigned: ' + asset.name,
    'Asset "' + asset.name + '" assigned to ' + (asset.assignedTo || 'unknown'),
    { assetId: id, assignedTo: asset.assignedTo });

  return { id: asset.id, name: asset.name, assignedTo: asset.assignedTo, status: 'inUse' };
}

/**
 * Unassign an asset.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function unassignAsset(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };

  var now = _now();
  asset.assignedTo = null;
  asset.assignedWorkflowId = null;
  asset.assignedOpportunityId = null;
  asset.assignedCustomerId = null;
  asset.status = 'active';
  asset.statusDisplayName = ASSET_STATUSES.active.displayName;
  asset.updatedAt = now;
  _persistAsset(asset);

  return { id: asset.id, name: asset.name, status: 'active' };
}

// ── Maintenance ──

/**
 * Schedule maintenance for an asset.
 * @param {object} data - { assetId, type, scheduledDate, description, estimatedCost, notes }
 * @returns {object}
 */
function scheduleMaintenance(data) {
  if (!data || !data.assetId) return { error: 'Asset ID is required' };
  var asset = _assets[data.assetId];
  if (!asset) return { error: 'Asset not found: ' + data.assetId };

  var type = data.type || 'preventive';
  var typeCheck = _validateMaintenanceType(type);
  if (!typeCheck.valid) return { error: typeCheck.error };

  var id = _genId();
  var now = _now();

  var record = {
    id: id,
    assetId: data.assetId,
    type: type,
    typeDisplayName: MAINTENANCE_TYPES[type].displayName,
    description: data.description || 'Maintenance',
    scheduledDate: data.scheduledDate || now,
    completedDate: null,
    estimatedCost: data.estimatedCost || 0,
    actualCost: 0,
    status: 'scheduled',
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  _maintenanceRecords[id] = record;
  _persistMaintenance(record);

  // Update asset status
  if (asset.status !== 'outOfService') {
    asset.status = 'maintenance';
    asset.statusDisplayName = ASSET_STATUSES.maintenance.displayName;
    asset.updatedAt = now;
    _persistAsset(asset);
  }

  _recordActivity(asset.assignedCustomerId, 'Maintenance Scheduled: ' + asset.name,
    MAINTENANCE_TYPES[type].displayName + ' maintenance scheduled for "' + asset.name + '"',
    { assetId: data.assetId, maintenanceId: id, type: type });

  return {
    id: record.id,
    assetId: record.assetId,
    type: record.type,
    typeDisplayName: record.typeDisplayName,
    scheduledDate: record.scheduledDate,
    status: record.status,
  };
}

/**
 * Complete maintenance.
 * @param {string} id - Maintenance record ID
 * @param {object} [data] - { actualCost, notes }
 * @returns {object}
 */
function completeMaintenance(id, data) {
  if (!id) return { error: 'Maintenance record ID is required' };
  var record = _maintenanceRecords[id];
  if (!record) return { error: 'Maintenance record not found: ' + id };

  var now = _now();
  record.status = 'completed';
  record.completedDate = now;
  record.actualCost = (data && data.actualCost) ? data.actualCost : 0;
  record.notes = (data && data.notes) ? data.notes : record.notes;
  record.updatedAt = now;
  _persistMaintenance(record);

  // Update asset costs and dates
  var asset = _assets[record.assetId];
  if (asset) {
    asset.totalMaintenanceCost = Math.round((asset.totalMaintenanceCost + record.actualCost) * 100) / 100;
    asset.totalOperatingCost = Math.round((asset.totalOperatingCost + record.actualCost) * 100) / 100;
    asset.lastMaintenanceDate = now;
    if (record.type === 'repair') asset.totalRepairCost = Math.round((asset.totalRepairCost + record.actualCost) * 100) / 100;

    // Return to active if not in another maintenance or out of service
    if (asset.status === 'maintenance') {
      asset.status = 'active';
      asset.statusDisplayName = ASSET_STATUSES.active.displayName;
    }
    asset.updatedAt = now;
    _persistAsset(asset);
  }

  return { id: record.id, assetId: record.assetId, status: 'completed', completedDate: now, actualCost: record.actualCost };
}

/**
 * Record an inspection.
 * @param {string} assetId - Asset ID
 * @param {object} data - { inspector, result, notes, cost }
 * @returns {object}
 */
function recordInspection(assetId, data) {
  if (!assetId) return { error: 'Asset ID is required' };
  if (!data) return { error: 'Inspection data is required' };

  var sched = scheduleMaintenance({
    assetId: assetId,
    type: 'inspection',
    description: data.description || 'Inspection',
    scheduledDate: _now(),
    estimatedCost: 0,
    notes: data.notes || null,
  });

  var complete = completeMaintenance(sched.id, { actualCost: data.cost || 0, notes: (data.notes || '') + ' | Inspector: ' + (data.inspector || 'N/A') + ' | Result: ' + (data.result || 'N/A') });

  var asset = _assets[assetId];
  if (asset) {
    asset.lastInspectionDate = _now();
    _persistAsset(asset);
  }

  return { id: sched.id, assetId: assetId, type: 'inspection', result: data.result || 'pass', inspector: data.inspector || null, completedAt: _now() };
}

/**
 * Record a repair.
 * @param {string} assetId - Asset ID
 * @param {object} data - { description, cost, vendor, notes }
 * @returns {object}
 */
function recordRepair(assetId, data) {
  if (!assetId) return { error: 'Asset ID is required' };
  if (!data) return { error: 'Repair data is required' };

  var sched = scheduleMaintenance({
    assetId: assetId,
    type: 'repair',
    description: data.description || 'Repair',
    scheduledDate: _now(),
    estimatedCost: data.cost || 0,
    notes: data.notes || null,
  });

  var complete = completeMaintenance(sched.id, { actualCost: data.cost || 0, notes: (data.notes || '') + ' | Vendor: ' + (data.vendor || 'N/A') });

  return { id: sched.id, assetId: assetId, type: 'repair', cost: data.cost || 0, vendor: data.vendor || null, completedAt: _now() };
}

/**
 * Record a fuel purchase.
 * @param {string} assetId - Asset ID
 * @param {object} data - { gallons, costPerGallon, totalCost }
 * @returns {object}
 */
function recordFuelPurchase(assetId, data) {
  if (!assetId) return { error: 'Asset ID is required' };
  var asset = _assets[assetId];
  if (!asset) return { error: 'Asset not found: ' + assetId };
  if (!data) return { error: 'Fuel data is required' };

  var gallons = data.gallons || 0;
  var totalCost = data.totalCost || (data.costPerGallon ? Math.round(gallons * data.costPerGallon * 100) / 100 : 0);

  asset.totalFuelConsumed = Math.round((asset.totalFuelConsumed + gallons) * 100) / 100;
  asset.totalFuelCost = Math.round((asset.totalFuelCost + totalCost) * 100) / 100;
  asset.totalOperatingCost = Math.round((asset.totalOperatingCost + totalCost) * 100) / 100;
  asset.updatedAt = _now();
  _persistAsset(asset);

  return { assetId: assetId, gallons: gallons, totalCost: totalCost, totalFuelConsumed: asset.totalFuelConsumed };
}

/**
 * Record usage (hours or mileage).
 * @param {string} assetId - Asset ID
 * @param {object} data - { hours, mileage }
 * @returns {object}
 */
function recordUsage(assetId, data) {
  if (!assetId) return { error: 'Asset ID is required' };
  var asset = _assets[assetId];
  if (!asset) return { error: 'Asset not found: ' + assetId };
  if (!data) return { error: 'Usage data is required' };

  if (data.hours) asset.totalHours = Math.round((asset.totalHours + data.hours) * 100) / 100;
  if (data.mileage) asset.totalMileage = Math.round((asset.totalMileage + data.mileage) * 100) / 100;
  asset.updatedAt = _now();
  _persistAsset(asset);

  return { assetId: assetId, totalHours: asset.totalHours, totalMileage: asset.totalMileage };
}

/**
 * Record a location update.
 * @param {string} assetId - Asset ID
 * @param {string} location - New location
 * @returns {object}
 */
function recordLocation(assetId, location) {
  if (!assetId) return { error: 'Asset ID is required' };
  if (!location) return { error: 'Location is required' };
  var asset = _assets[assetId];
  if (!asset) return { error: 'Asset not found: ' + assetId };

  asset.location = location;
  asset.updatedAt = _now();
  _persistAsset(asset);

  return { id: assetId, name: asset.name, location: location };
}

// ── Analytics ──

/**
 * Calculate utilization rate for an asset (0-100).
 * Based on hours used vs expected available hours.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function calculateUtilization(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };

  // Simplified: utilization based on total hours vs expected hours since purchase
  var daysSincePurchase = asset.purchaseDate ? Math.round((Date.now() - new Date(asset.purchaseDate).getTime()) / 86400000) : 1;
  if (daysSincePurchase < 1) daysSincePurchase = 1;
  var expectedHours = (daysSincePurchase / 365) * 2000; // 2000 hours per year
  var utilization = expectedHours > 0 ? Math.min(100, Math.round((asset.totalHours / expectedHours) * 100)) : 0;

  return {
    assetId: id,
    assetName: asset.name,
    totalHours: asset.totalHours,
    totalMileage: asset.totalMileage,
    daysSincePurchase: daysSincePurchase,
    expectedHours: Math.round(expectedHours),
    utilizationRate: utilization,
    utilizationDisplay: utilization + '%',
    status: asset.status,
  };
}

/**
 * Calculate total operating cost for an asset.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function calculateOperatingCost(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };

  return {
    assetId: id,
    assetName: asset.name,
    totalOperatingCost: asset.totalOperatingCost,
    totalFuelCost: asset.totalFuelCost,
    totalMaintenanceCost: asset.totalMaintenanceCost,
    totalRepairCost: asset.totalRepairCost,
    costPerHour: asset.totalHours > 0 ? Math.round((asset.totalOperatingCost / asset.totalHours) * 100) / 100 : 0,
    costPerMile: asset.totalMileage > 0 ? Math.round((asset.totalOperatingCost / asset.totalMileage) * 100) / 100 : 0,
  };
}

/**
 * Calculate maintenance cost for an asset.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function calculateMaintenanceCost(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };

  return {
    assetId: id,
    assetName: asset.name,
    totalMaintenanceCost: asset.totalMaintenanceCost,
    totalRepairCost: asset.totalRepairCost,
    maintenanceCount: Object.keys(_maintenanceRecords).filter(function (k) { return _maintenanceRecords[k].assetId === id && _maintenanceRecords[k].status === 'completed'; }).length,
    avgCostPerMaintenance: 0,
  };
}

/**
 * Calculate depreciation for an asset.
 * Uses straight-line depreciation.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function calculateDepreciation(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };

  var annualDepreciation = asset.lifespanYears > 0 ? Math.round((asset.purchaseCost / asset.lifespanYears) * 100) / 100 : 0;
  var ageYears = 0;
  if (asset.purchaseDate) {
    ageYears = (Date.now() - new Date(asset.purchaseDate).getTime()) / (365.25 * 86400000);
  }
  var accumulatedDepreciation = Math.round(Math.min(asset.purchaseCost, annualDepreciation * ageYears) * 100) / 100;
  var bookValue = Math.round(Math.max(0, asset.purchaseCost - accumulatedDepreciation) * 100) / 100;

  return {
    assetId: id,
    assetName: asset.name,
    purchaseCost: asset.purchaseCost,
    currentValue: asset.currentValue,
    bookValue: bookValue,
    lifespanYears: asset.lifespanYears,
    annualDepreciation: annualDepreciation,
    accumulatedDepreciation: accumulatedDepreciation,
    ageYears: Math.round(ageYears * 10) / 10,
    depreciationPercent: asset.purchaseCost > 0 ? Math.round((accumulatedDepreciation / asset.purchaseCost) * 100) : 0,
  };
}

/**
 * Calculate replacement score (0-100) for an asset.
 * Higher = more urgent replacement needed.
 * Factors: age, condition, maintenance cost, utilization.
 * @param {string} id - Asset ID
 * @returns {object}
 */
function calculateReplacementScore(id) {
  if (!id) return { error: 'Asset ID is required' };
  var asset = _assets[id];
  if (!asset) return { error: 'Asset not found: ' + id };

  var score = 0;
  var factors = [];

  // Age factor (0-35)
  var ageYears = 0;
  if (asset.purchaseDate) {
    ageYears = (Date.now() - new Date(asset.purchaseDate).getTime()) / (365.25 * 86400000);
  }
  var ageScore = Math.min(35, Math.round((ageYears / asset.lifespanYears) * 35));
  score += ageScore;
  factors.push({ factor: 'age', score: ageScore, detail: ageYears.toFixed(1) + ' years / ' + asset.lifespanYears + ' year lifespan' });

  // Maintenance cost factor (0-25)
  var maintenanceRatio = asset.purchaseCost > 0 ? asset.totalMaintenanceCost / asset.purchaseCost : 0;
  var maintScore = Math.min(25, Math.round(maintenanceRatio * 25 * 2));
  score += maintScore;
  factors.push({ factor: 'maintenance_cost', score: maintScore, detail: '$' + asset.totalMaintenanceCost + ' total vs $' + asset.purchaseCost + ' purchase' });

  // Current value factor (0-25)
  var valueRatio = asset.purchaseCost > 0 ? (asset.currentValue / asset.purchaseCost) : 1;
  var valueScore = Math.min(25, Math.round((1 - valueRatio) * 25));
  score += valueScore;
  factors.push({ factor: 'value_depreciation', score: valueScore, detail: 'Current value: $' + asset.currentValue + ' / Purchase: $' + asset.purchaseCost });

  // Status factor (0-15)
  var statusScore = 0;
  if (asset.status === 'outOfService') statusScore = 15;
  else if (asset.status === 'maintenance') statusScore = 10;
  score += statusScore;
  factors.push({ factor: 'status', score: statusScore, detail: 'Status: ' + asset.statusDisplayName });

  score = Math.min(100, score);
  var label = 'Good';
  if (score >= 70) label = 'Critical - Replace Soon';
  else if (score >= 50) label = 'Consider Replacement';
  else if (score >= 30) label = 'Monitor';

  return {
    assetId: id,
    assetName: asset.name,
    replacementScore: score,
    label: label,
    factors: factors,
    calculatedAt: _now(),
  };
}

/**
 * Get the maintenance schedule for an asset.
 * @param {string} assetId - Asset ID
 * @returns {object}
 */
function getMaintenanceSchedule(assetId) {
  if (!assetId) return { error: 'Asset ID is required' };
  var results = [];
  Object.keys(_maintenanceRecords).forEach(function (k) {
    var r = _maintenanceRecords[k];
    if (r.assetId === assetId) results.push(r);
  });
  results.sort(function (a, b) { return new Date(b.scheduledDate) - new Date(a.scheduledDate); });
  return { maintenance: results.map(function (r) { return Object.assign({}, r); }), total: results.length };
}

/**
 * Get upcoming maintenance (scheduled but not completed).
 * @param {number} [days=30] - Look ahead days
 * @returns {object}
 */
function getUpcomingMaintenance(days) {
  days = days || 30;
  var future = new Date(Date.now() + days * 86400000).toISOString();
  var results = [];
  Object.keys(_maintenanceRecords).forEach(function (k) {
    var r = _maintenanceRecords[k];
    if (r.status === 'scheduled' && r.scheduledDate <= future) {
      results.push(r);
    }
  });
  results.sort(function (a, b) { return new Date(a.scheduledDate) - new Date(b.scheduledDate); });
  return { maintenance: results.map(function (r) { return Object.assign({}, r); }), total: results.length };
}

/**
 * Get inspection history for an asset.
 * @param {string} assetId - Asset ID
 * @returns {object}
 */
function getInspectionHistory(assetId) {
  if (!assetId) return { error: 'Asset ID is required' };
  var results = [];
  Object.keys(_maintenanceRecords).forEach(function (k) {
    var r = _maintenanceRecords[k];
    if (r.assetId === assetId && r.type === 'inspection') results.push(r);
  });
  results.sort(function (a, b) { return new Date(b.scheduledDate) - new Date(a.scheduledDate); });
  return { inspections: results.map(function (r) { return Object.assign({}, r); }), total: results.length };
}

/**
 * Get comprehensive asset metrics.
 * @returns {object}
 */
function getAssetMetrics() {
  var all = listAssets();
  var active = listAssets({ status: 'active' });
  var inUse = listAssets({ status: 'inUse' });
  var inMaintenance = listAssets({ status: 'maintenance' });
  var outOfService = listAssets({ status: 'outOfService' });
  var retired = listAssets({ status: 'retired' });

  var totalValue = all.assets.reduce(function (s, a) { return s + a.currentValue; }, 0);
  var totalPurchaseCost = all.assets.reduce(function (s, a) { return s + a.purchaseCost; }, 0);

  var byType = {};
  Object.keys(ASSET_TYPES).forEach(function (k) {
    var typeAssets = listAssets({ type: k });
    byType[k] = {
      type: k,
      displayName: ASSET_TYPES[k].displayName,
      count: typeAssets.total,
      totalValue: typeAssets.assets.reduce(function (s, a) { return s + a.currentValue; }, 0),
    };
  });

  var upcomingMaint = getUpcomingMaintenance(30);

  return {
    totalAssets: all.total,
    activeAssets: active.total,
    inUseAssets: inUse.total,
    inMaintenance: inMaintenance.total,
    outOfService: outOfService.total,
    retiredAssets: retired.total,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPurchaseCost: Math.round(totalPurchaseCost * 100) / 100,
    upcomingMaintenance: upcomingMaint.total,
    byType: byType,
    calculatedAt: _now(),
  };
}

/**
 * Get all asset type definitions.
 * @returns {object[]}
 */
function getAssetTypes() {
  return Object.keys(ASSET_TYPES).map(function (k) {
    return { id: ASSET_TYPES[k].id, displayName: ASSET_TYPES[k].displayName, icon: ASSET_TYPES[k].icon };
  });
}

// ── Module Exports ──

module.exports = {
  init: init,
  createAsset: createAsset,
  updateAsset: updateAsset,
  archiveAsset: archiveAsset,
  restoreAsset: restoreAsset,
  assignAsset: assignAsset,
  unassignAsset: unassignAsset,
  scheduleMaintenance: scheduleMaintenance,
  completeMaintenance: completeMaintenance,
  recordInspection: recordInspection,
  recordRepair: recordRepair,
  recordFuelPurchase: recordFuelPurchase,
  recordUsage: recordUsage,
  recordLocation: recordLocation,
  getAsset: getAsset,
  listAssets: listAssets,
  searchAssets: searchAssets,
  calculateUtilization: calculateUtilization,
  calculateOperatingCost: calculateOperatingCost,
  calculateMaintenanceCost: calculateMaintenanceCost,
  calculateDepreciation: calculateDepreciation,
  calculateReplacementScore: calculateReplacementScore,
  getMaintenanceSchedule: getMaintenanceSchedule,
  getUpcomingMaintenance: getUpcomingMaintenance,
  getInspectionHistory: getInspectionHistory,
  getAssetMetrics: getAssetMetrics,
  getAssetTypes: getAssetTypes,
  ASSET_TYPES: ASSET_TYPES,
  ASSET_STATUSES: ASSET_STATUSES,
  MAINTENANCE_TYPES: MAINTENANCE_TYPES,
};