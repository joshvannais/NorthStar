'use strict';

const crypto = require('crypto');
const { stableValue } = require('../services/businessProfileAdapter');

// These are fictional company configurations built from reviewed tree-care
// operating patterns. They are demo inputs, not market quotes or credentials.
const SOURCE_NOTES = Object.freeze([
  Object.freeze({
    id: 'osha-tree-care-equipment',
    publisher: 'U.S. Occupational Safety and Health Administration',
    url: 'https://www.osha.gov/tree-care/sbrefa',
    reviewedOn: '2026-09-15',
    use: 'Tree-care equipment and distinct climbing and ground-support duties.',
  }),
  Object.freeze({
    id: 'isa-certified-tree-climber',
    publisher: 'International Society of Arboriculture',
    url: 'https://www.isa-arbor.com/Credentials/Types-of-Credentials/ISA-Certified-Tree-Climber',
    reviewedOn: '2026-09-15',
    use: 'Climbing is represented as a specific workforce qualification.',
  }),
  Object.freeze({
    id: 'avant-tree-care',
    publisher: 'Avant Tecno USA',
    url: 'https://avanttecno.com/us/applications/tree-care/',
    reviewedOn: '2026-09-15',
    use: 'Optional compact articulated loader and tree-care attachment configuration.',
  }),
  Object.freeze({
    id: 'bls-tree-worker-wage',
    publisher: 'U.S. Bureau of Labor Statistics',
    url: 'https://www.bls.gov/ooh/building-and-grounds-cleaning/grounds-maintenance-workers.htm',
    reviewedOn: '2026-09-15',
    use: 'Broad national wage comparison; fictional loaded rates remain company inputs.',
  }),
  Object.freeze({
    id: 'husqvarna-550xp-mark-ii',
    publisher: 'Husqvarna',
    url: 'https://www.husqvarna.com/us/chainsaws/550xp-mark-ii/',
    reviewedOn: '2026-09-15',
    use: 'Representative professional chainsaw identity and manufacturer-published product capability.',
  }),
]);

const COMMON_INVENTORY = Object.freeze([
  machine('husqvarna_550xp', 'Husqvarna 550 XP Mark II chainsaw', 'cutting_tool', { hourlyOperatingCost: 7 }),
  machine('ground_saw_kit', 'Ground saw and hand-tool kit', 'manual_tools', { hourlyOperatingCost: 4 }),
  machine('rigging_ppe_kit', 'Ropes, rigging, climbing gear and PPE', 'rigging_tools', { hourlyOperatingCost: 6 }),
]);

const OPERATIONS = Object.freeze({
  removal: Object.freeze({
    label: 'Tree removal', material: 'Rigging consumables, site protection and cleanup supplies',
    laborTask: 'Site setup, controlled removal, processing and cleanup', workerHours: 24,
    materialCost: 145, mobilization: 165, basePrice: 2850, overhead: 310,
    equipmentRole: 'material_handler', equipmentTask: 'Controlled tree removal and material handling',
  }),
  pruning: Object.freeze({
    label: 'Tree trimming and pruning', material: 'Rigging consumables and cleanup supplies',
    laborTask: 'Crown access, specified pruning, lowering and cleanup', workerHours: 14,
    materialCost: 75, mobilization: 135, basePrice: 1480, overhead: 185,
    equipmentRole: 'canopy_access', equipmentTask: 'Canopy access and branch handling',
  }),
  stump: Object.freeze({
    label: 'Stump grinding', material: 'Backfill and site-protection allowance',
    laborTask: 'Utility review, stump grinding and surface cleanup', workerHours: 6,
    materialCost: 65, mobilization: 115, basePrice: 725, overhead: 95,
    equipmentRole: 'stump_grinder', equipmentTask: 'Stump grinding',
  }),
  storm: Object.freeze({
    label: 'Storm-damage assessment', material: 'Assessment marking and temporary site protection',
    laborTask: 'Hazard assessment, access review and response planning', workerHours: 4,
    materialCost: 35, mobilization: 145, basePrice: 495, overhead: 70,
    equipmentRole: 'assessment', equipmentTask: 'Remote and ground-level tree assessment',
  }),
  hauling: Object.freeze({
    label: 'Tree debris hauling', material: 'Load securement and cleanup supplies',
    laborTask: 'Load, transport, unload and final cleanup', workerHours: 8,
    materialCost: 45, mobilization: 175, basePrice: 980, overhead: 130,
    equipmentRole: 'material_handler', equipmentTask: 'Debris loading and material handling',
  }),
  visit: Object.freeze({
    label: 'Tree estimate visit', material: 'Assessment marking supplies',
    laborTask: 'Onsite tree, access and scope assessment', workerHours: 2,
    materialCost: 15, mobilization: 65, basePrice: 185, overhead: 30,
    equipmentRole: 'assessment', equipmentTask: 'Tree and access assessment',
  }),
});

function machine(key, name, role, options = {}) {
  return Object.freeze({
    key, name, role, ownership: options.ownership || 'owned', financed: options.financed === true,
    monthlyPayment: options.financed ? options.monthlyPayment : null,
    qualifyingJobsPerMonth: options.financed ? options.qualifyingJobsPerMonth : null,
    hourlyOperatingCost: options.hourlyOperatingCost,
    transportCostPerJob: options.transportCostPerJob || 0,
    attachments: Object.freeze((options.attachments || []).slice()),
  });
}

const PROFILES = Object.freeze([
  Object.freeze({
    key: 'climber_led_compact', label: 'Climber-led residential tree crew', serviceRadiusMiles: 24,
    crew: Object.freeze({ people: 3, hasQualifiedClimber: true, skills: Object.freeze(['qualified tree climbing', 'rigging', 'chainsaw operation', 'ground support', 'aerial rescue planning']) }),
    vehicles: Object.freeze(['Chip truck', 'Equipment trailer']),
    disposal: Object.freeze({ includedLoads: 1, destination: 'Recorded regional green-waste facility', chipReuseAvailable: true }),
    equipment: Object.freeze([
      machine('tracked_chipper', 'Tracked brush chipper', 'material_handler', { financed: true, monthlyPayment: 1280, qualifyingJobsPerMonth: 8, hourlyOperatingCost: 34, transportCostPerJob: 45 }),
      machine('compact_stump_grinder', 'Compact stump grinder', 'stump_grinder', { financed: true, monthlyPayment: 760, qualifyingJobsPerMonth: 6, hourlyOperatingCost: 26, transportCostPerJob: 35 }),
      machine('climbing_system', 'Climbing and rigging system', 'canopy_access', { hourlyOperatingCost: 18 }),
      machine('assessment_kit', 'Tree assessment kit', 'assessment', { hourlyOperatingCost: 5 }),
    ]),
  }),
  Object.freeze({
    key: 'bucket_chipper', label: 'Bucket-truck pruning and removal company', serviceRadiusMiles: 34,
    crew: Object.freeze({ people: 4, hasQualifiedClimber: false, skills: Object.freeze(['aerial-lift operation', 'rigging', 'chainsaw operation', 'traffic and ground control']) }),
    vehicles: Object.freeze(['Forestry bucket truck', 'Chip truck', 'Equipment trailer']),
    disposal: Object.freeze({ includedLoads: 2, destination: 'Recorded regional wood-recycling facility', chipReuseAvailable: true }),
    equipment: Object.freeze([
      machine('bucket_truck', 'Forestry bucket truck', 'canopy_access', { financed: true, monthlyPayment: 2850, qualifyingJobsPerMonth: 10, hourlyOperatingCost: 52, transportCostPerJob: 70 }),
      machine('tow_chipper', 'Tow-behind brush chipper', 'material_handler', { financed: true, monthlyPayment: 1180, qualifyingJobsPerMonth: 8, hourlyOperatingCost: 31, transportCostPerJob: 40 }),
      machine('stump_grinder', 'Self-propelled stump grinder', 'stump_grinder', { financed: true, monthlyPayment: 940, qualifyingJobsPerMonth: 6, hourlyOperatingCost: 29, transportCostPerJob: 35 }),
      machine('assessment_kit', 'Tree assessment kit', 'assessment', { hourlyOperatingCost: 5 }),
    ]),
  }),
  Object.freeze({
    key: 'avant_residential', label: 'Compact-access tree and material-handling company', serviceRadiusMiles: 28,
    crew: Object.freeze({ people: 4, hasQualifiedClimber: true, skills: Object.freeze(['qualified tree climbing', 'rigging', 'compact-loader operation', 'chainsaw operation', 'ground support']) }),
    vehicles: Object.freeze(['Chip truck', 'Compact-loader trailer', 'Crew pickup']),
    disposal: Object.freeze({ includedLoads: 2, destination: 'Recorded compost and wood-recycling facility', chipReuseAvailable: true }),
    equipment: Object.freeze([
      machine('avant_loader', 'Avant articulated compact loader', 'material_handler', { financed: true, monthlyPayment: 1720, qualifyingJobsPerMonth: 9, hourlyOperatingCost: 30, transportCostPerJob: 55, attachments: ['Heavy-duty log grapple', 'Mulch bucket'] }),
      machine('tow_chipper', 'Tow-behind brush chipper', 'material_handler', { financed: true, monthlyPayment: 1240, qualifyingJobsPerMonth: 8, hourlyOperatingCost: 32, transportCostPerJob: 40 }),
      machine('climbing_system', 'Climbing and rigging system', 'canopy_access', { hourlyOperatingCost: 18 }),
      machine('stump_grinder', 'Stump grinder', 'stump_grinder', { financed: true, monthlyPayment: 880, qualifyingJobsPerMonth: 6, hourlyOperatingCost: 28, transportCostPerJob: 35 }),
      machine('assessment_kit', 'Tree assessment kit', 'assessment', { hourlyOperatingCost: 5 }),
    ]),
  }),
  Object.freeze({
    key: 'stump_debris_specialist', label: 'Stump and tree-debris specialist', serviceRadiusMiles: 20,
    crew: Object.freeze({ people: 2, hasQualifiedClimber: false, skills: Object.freeze(['stump-grinder operation', 'compact-loader operation', 'load securement', 'site cleanup']) }),
    vehicles: Object.freeze(['Dump trailer', 'Crew pickup']),
    disposal: Object.freeze({ includedLoads: 1, destination: 'Recorded green-waste transfer facility', chipReuseAvailable: false }),
    equipment: Object.freeze([
      machine('stump_grinder', 'Tracked stump grinder', 'stump_grinder', { financed: true, monthlyPayment: 1320, qualifyingJobsPerMonth: 8, hourlyOperatingCost: 38, transportCostPerJob: 45 }),
      machine('mini_skid', 'Mini skid steer with grapple', 'material_handler', { financed: true, monthlyPayment: 980, qualifyingJobsPerMonth: 8, hourlyOperatingCost: 27, transportCostPerJob: 40 }),
      machine('compact_lift', 'Compact tracked lift', 'canopy_access', { ownership: 'rented', hourlyOperatingCost: 0, transportCostPerJob: 425 }),
      machine('assessment_kit', 'Tree assessment kit', 'assessment', { hourlyOperatingCost: 5 }),
    ]),
  }),
  Object.freeze({
    key: 'compact_lift_pruning', label: 'Compact-lift pruning company', serviceRadiusMiles: 26,
    crew: Object.freeze({ people: 3, hasQualifiedClimber: false, skills: Object.freeze(['compact-lift operation', 'pruning', 'chainsaw operation', 'ground support']) }),
    vehicles: Object.freeze(['Chip truck', 'Equipment trailer']),
    disposal: Object.freeze({ includedLoads: 1, destination: 'Recorded municipal green-waste facility', chipReuseAvailable: true }),
    equipment: Object.freeze([
      machine('compact_lift', 'Compact tracked aerial lift', 'canopy_access', { financed: true, monthlyPayment: 1980, qualifyingJobsPerMonth: 9, hourlyOperatingCost: 36, transportCostPerJob: 55 }),
      machine('tow_chipper', 'Tow-behind brush chipper', 'material_handler', { financed: true, monthlyPayment: 1020, qualifyingJobsPerMonth: 8, hourlyOperatingCost: 30, transportCostPerJob: 40 }),
      machine('stump_grinder', 'Compact stump grinder', 'stump_grinder', { ownership: 'rented', hourlyOperatingCost: 0, transportCostPerJob: 325 }),
      machine('assessment_kit', 'Tree assessment kit', 'assessment', { hourlyOperatingCost: 5 }),
    ]),
  }),
  Object.freeze({
    key: 'full_service_crane', label: 'Full-service technical removal company', serviceRadiusMiles: 42,
    crew: Object.freeze({ people: 5, hasQualifiedClimber: true, skills: Object.freeze(['qualified tree climbing', 'rigging', 'aerial-lift operation', 'crane coordination', 'chainsaw operation', 'ground support']) }),
    vehicles: Object.freeze(['Forestry bucket truck', 'Chip truck', 'Log truck', 'Crew pickup']),
    disposal: Object.freeze({ includedLoads: 3, destination: 'Recorded log yard and green-waste facility', chipReuseAvailable: true }),
    equipment: Object.freeze([
      machine('bucket_truck', 'Forestry bucket truck', 'canopy_access', { financed: true, monthlyPayment: 3100, qualifyingJobsPerMonth: 10, hourlyOperatingCost: 55, transportCostPerJob: 75 }),
      machine('loader', 'Compact articulated loader with grapple', 'material_handler', { financed: true, monthlyPayment: 1650, qualifyingJobsPerMonth: 9, hourlyOperatingCost: 31, transportCostPerJob: 55 }),
      machine('whole_tree_chipper', 'Whole-tree chipper', 'material_handler', { financed: true, monthlyPayment: 2450, qualifyingJobsPerMonth: 10, hourlyOperatingCost: 48, transportCostPerJob: 65 }),
      machine('stump_grinder', 'Tracked stump grinder', 'stump_grinder', { financed: true, monthlyPayment: 1380, qualifyingJobsPerMonth: 7, hourlyOperatingCost: 39, transportCostPerJob: 45 }),
      machine('assessment_kit', 'Tree assessment kit', 'assessment', { hourlyOperatingCost: 5 }),
    ]),
  }),
]);

function profileIndex(seed) {
  const digest = crypto.createHash('sha256').update('northstar-tree-profile\0' + String(seed), 'utf8').digest();
  return digest.readUInt32BE(0) % PROFILES.length;
}

function create(seed) {
  const base = PROFILES[profileIndex(seed)];
  const labor = {
    groundWorkerLoadedHourlyCost: 39 + profileIndex(seed + ':ground') * 2,
    climberLoadedHourlyCost: base.crew.hasQualifiedClimber ? 54 + profileIndex(seed + ':climber') * 2 : null,
    crewLeadLoadedHourlyCost: 49 + profileIndex(seed + ':lead') * 2,
  };
  const monthly = {
    targetJobs: 18 + profileIndex(seed + ':jobs') * 3,
    fixedOverhead: 6200 + profileIndex(seed + ':overhead') * 650,
    revenueTarget: 42000 + profileIndex(seed + ':revenue') * 5000,
  };
  return stableValue({
    version: 'simulated-tree-business-profile-v1',
    key: base.key,
    label: base.label,
    industry: 'Residential tree service',
    services: Object.entries(OPERATIONS).map(([key, value]) => ({ key, label: value.label })),
    serviceRadiusMiles: base.serviceRadiusMiles,
    workforce: { ...base.crew, labor },
    vehicles: base.vehicles,
    equipment: base.equipment,
    inventory: COMMON_INVENTORY,
    disposal: base.disposal,
    monthly,
    financingPolicy: {
      method: 'qualifying_job_share',
      explanation: 'Each financed machine payment is distributed across its recorded qualifying jobs for the month. A single job is never charged the full monthly payment unless the profile explicitly expects one qualifying job.',
    },
    operations: OPERATIONS,
    research: { reviewedOn: '2026-09-15', sources: SOURCE_NOTES },
    simulated: true,
  });
}

function equipmentFor(profile, operation) {
  const definition = OPERATIONS[operation] || OPERATIONS.visit;
  return profile.equipment.find(item => item.role === definition.equipmentRole) ||
    profile.equipment.find(item => item.role === 'assessment');
}

function perJobEquipmentCost(asset, plannedHours) {
  const paymentShare = asset.financed ? asset.monthlyPayment / asset.qualifyingJobsPerMonth : 0;
  return Number((paymentShare + asset.hourlyOperatingCost * plannedHours + asset.transportCostPerJob).toFixed(2));
}

function equipmentBundleFor(profile, operation) {
  const primary = equipmentFor(profile, operation);
  const rows = [primary];
  if (['removal', 'pruning', 'hauling'].includes(operation)) {
    const materialHandler = profile.equipment.find(item => item.role === 'material_handler');
    if (materialHandler && materialHandler.key !== primary.key) rows.push(materialHandler);
  }
  if (['removal', 'pruning'].includes(operation)) {
    const canopy = profile.equipment.find(item => item.role === 'canopy_access');
    if (canopy && canopy.key !== primary.key) rows.push(canopy);
  }
  const inventory = Array.isArray(profile.inventory) ? profile.inventory : COMMON_INVENTORY;
  if (operation !== 'visit') rows.push(...inventory.filter(item => item.role !== 'rigging_tools' || ['removal', 'pruning', 'storm'].includes(operation)));
  return stableValue(rows.filter((item, index, all) => item && all.findIndex(value => value.key === item.key) === index));
}

function vehiclePlanFor(profile, operation) {
  const vehicles = Array.isArray(profile.vehicles) ? profile.vehicles : [];
  if (operation === 'visit' || operation === 'storm') return stableValue(vehicles.slice(0, 1));
  return stableValue(vehicles);
}

function scenarioFactors(seed, operation) {
  const digest = crypto.createHash('sha256').update('northstar-tree-scope\0' + String(seed), 'utf8').digest();
  const pick = (offset, values) => values[digest[offset] % values.length];
  const factors = {
    treeCount: 1 + digest[0] % (operation === 'hauling' ? 4 : operation === 'visit' ? 2 : 3),
    sizeClass: pick(1, ['small', 'medium', 'large', 'very large']),
    accessClass: pick(2, ['open yard access', 'moderate backyard access', 'restricted access']),
    conditionClass: pick(3, ['routine condition', 'declining or damaged', 'high-risk condition']),
    disposalChoice: pick(4, ['leave usable wood', 'chip branches onsite', 'haul all debris']),
    nearStructure: digest[5] % 3 !== 0,
  };
  if (['removal', 'pruning', 'storm'].includes(operation)) factors.approximateHeightFeet = pick(6, [25, 35, 45, 60, 75, 90]);
  if (operation === 'stump') factors.stumpDiameterInches = pick(7, [14, 20, 28, 36, 48, 60]);
  if (operation === 'hauling') factors.debrisLoads = pick(8, [1, 2, 3, 4]);
  if (operation === 'visit') {
    factors.sizeClass = 'not yet assessed';
    factors.conditionClass = 'requires onsite assessment';
    factors.disposalChoice = 'not selected';
  }
  return stableValue(factors);
}

module.exports = { OPERATIONS, PROFILES, SOURCE_NOTES, COMMON_INVENTORY, create, equipmentFor, equipmentBundleFor, vehiclePlanFor, perJobEquipmentCost, scenarioFactors };
