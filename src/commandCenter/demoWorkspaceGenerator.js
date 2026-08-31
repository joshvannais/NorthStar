'use strict';

const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');
const { sha256, stableValue } = require('../services/businessProfileAdapter');

const FIXTURE_CONTRACT = 'northstar_seeded_fictional_demo_workspace_v1';
const SEED_CONTRACT = 'northstar_demo_workspace_seed_v1';
const FIXTURE_NAMESPACE = '4c298d45-b8ec-4df4-9f4b-34aa21ed9d63';
const RESERVED_EMAIL = /^[a-z0-9.-]+@example\.com$/;
const RESERVED_PHONE = /^\([2-9][0-9]{2}\) 555-01[0-9]{2}$/;
const SYNTHETIC_PERSON = / (?:Demo|Example|Fixture|Sample)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const REGIONS = Object.freeze([
  Object.freeze({
    key: 'atlantic-example', city: 'Example Falls', state: 'NC', postalCode: '00000',
    timeZone: 'America/New_York', areaCode: '919', center: Object.freeze({ latitude: 35.6500, longitude: -78.7000 }),
    zones: Object.freeze(['North Example Zone', 'Central Example Zone', 'South Example Zone']),
  }),
  Object.freeze({
    key: 'midwest-example', city: 'Example Prairie', state: 'IL', postalCode: '00000',
    timeZone: 'America/Chicago', areaCode: '312', center: Object.freeze({ latitude: 41.8500, longitude: -87.7000 }),
    zones: Object.freeze(['Lake Example Zone', 'Central Example Zone', 'Prairie Example Zone']),
  }),
  Object.freeze({
    key: 'mountain-example', city: 'Example Mesa', state: 'CO', postalCode: '00000',
    timeZone: 'America/Denver', areaCode: '303', center: Object.freeze({ latitude: 39.7000, longitude: -104.9500 }),
    zones: Object.freeze(['Foothill Example Zone', 'Central Example Zone', 'Mesa Example Zone']),
  }),
  Object.freeze({
    key: 'pacific-example', city: 'Example Harbor', state: 'WA', postalCode: '00000',
    timeZone: 'America/Los_Angeles', areaCode: '206', center: Object.freeze({ latitude: 47.6000, longitude: -122.3000 }),
    zones: Object.freeze(['Harbor Example Zone', 'Central Example Zone', 'Evergreen Example Zone']),
  }),
]);

const INDUSTRIES = Object.freeze([
  'Residential home services',
  'Whole-home repair and improvement',
  'Residential property maintenance',
  'Multi-trade home service contracting',
]);

const BRAND_FIRST = Object.freeze(['Beacon', 'Cedar', 'Compass', 'Lantern', 'Northwind', 'Oakline', 'Silverleaf', 'Truefield']);
const BRAND_SECOND = Object.freeze(['Arc', 'Bridge', 'Grove', 'Harbor', 'Meadow', 'Ridge', 'Vale', 'Way']);
const TEAM_FIRST = Object.freeze(['Avery', 'Cameron', 'Casey', 'Drew', 'Jordan', 'Morgan', 'Riley', 'Taylor']);
const SYNTHETIC_LAST = Object.freeze(['Demo', 'Example', 'Fixture', 'Sample']);
const STREET_NAMES = Object.freeze(['Demo Way', 'Example Lane', 'Fixture Court', 'Sample Loop']);

const SERVICE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'fence', label: 'Fence installation', estimate: 6800, jobType: 'replacement', scope: Object.freeze({ jobType: 'replace', linearFeet: 146, material: 'cedar', height: 6, gates: 2 }) }),
  Object.freeze({ key: 'roofing', label: 'Roof replacement', estimate: 14800, jobType: 'replacement', scope: Object.freeze({ jobType: 'replace', squares: 28, material: 'architectural', pitch: '6/12', stories: 2 }) }),
  Object.freeze({ key: 'hvac', label: 'HVAC service', estimate: 9600, jobType: 'replacement', scope: Object.freeze({ jobType: 'replace', systemType: 'heat pump', tonnage: 3, seer: 16, sqft: 2100 }) }),
  Object.freeze({ key: 'plumbing', label: 'Plumbing service', estimate: 2850, jobType: 'repair', scope: Object.freeze({ jobType: 'repair', fixture: 'water heater', leakSeverity: 'contained', waterShutoff: true }) }),
  Object.freeze({ key: 'electrical', label: 'Electrical service', estimate: 4250, jobType: 'upgrade', scope: Object.freeze({ jobType: 'upgrade', symptoms: 'panel capacity review', breakerBehavior: 'stable', safetyConcern: false }) }),
  Object.freeze({ key: 'concrete', label: 'Concrete installation', estimate: 11200, jobType: 'installation', scope: Object.freeze({ jobType: 'install', squareFeet: 720, finish: 'broom', existingRemoval: true, access: 'driveway access' }) }),
]);

function hashBytes(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

function normalizeDemoSeed(seed) {
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 512) {
    throw new Error('A bounded explicit demo workspace seed is required.');
  }
  return crypto.createHash('sha256')
    .update(SEED_CONTRACT + '\0', 'utf8')
    .update(seed, 'utf8')
    .digest('hex');
}

function seededGenerator(seedDigest) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  function fill() {
    const block = crypto.createHash('sha256')
      .update(SEED_CONTRACT + ':stream\0', 'utf8')
      .update(seedDigest, 'utf8')
      .update('\0' + String(counter), 'utf8')
      .digest();
    counter += 1;
    pool = Buffer.concat([pool, block]);
  }
  function uint32() {
    while (pool.length < 4) fill();
    const value = pool.readUInt32BE(0);
    pool = pool.subarray(4);
    return value;
  }
  return Object.freeze({
    integer(minimum, maximum) {
      if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
        throw new Error('Demo fixture integer bounds are invalid.');
      }
      return minimum + (uint32() % (maximum - minimum + 1));
    },
    pick(values) {
      if (!Array.isArray(values) || values.length === 0) throw new Error('Demo fixture choice is empty.');
      return values[uint32() % values.length];
    },
  });
}

function fixtureId(seedDigest, key) {
  return uuidv5(seedDigest + ':' + String(key), FIXTURE_NAMESPACE);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
}

function reservedPhone(region, ordinal) {
  const line = 100 + (Number(ordinal) % 100);
  return '(' + region.areaCode + ') 555-' + String(line).padStart(4, '0');
}

function deterministicAnchor(seedDigest) {
  const bytes = hashBytes('northstar-demo-anchor\0' + seedDigest);
  const dayOffset = bytes.readUInt16BE(0) % 365;
  return new Date(Date.UTC(2032, 0, 1 + dayOffset, 15, 0, 0, 0));
}

function coordinateAt(center, miles, angleRadians) {
  const latitudeDelta = (miles * Math.cos(angleRadians)) / 69;
  const longitudeScale = 69 * Math.max(0.2, Math.cos(center.latitude * Math.PI / 180));
  const longitudeDelta = (miles * Math.sin(angleRadians)) / longitudeScale;
  return {
    latitude: Number((center.latitude + latitudeDelta).toFixed(6)),
    longitude: Number((center.longitude + longitudeDelta).toFixed(6)),
  };
}

function distanceMiles(first, second) {
  const radius = 3958.7613;
  const radians = value => Number(value) * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const latitudeA = radians(first.latitude);
  const latitudeB = radians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function customerForSeed(workspace, seed, ordinal) {
  if (!workspace || workspace.contract !== FIXTURE_CONTRACT) {
    throw new Error('The seeded demo workspace authority is required.');
  }
  const digest = normalizeDemoSeed(String(seed));
  const random = seededGenerator(digest);
  const first = TEAM_FIRST[(random.integer(0, TEAM_FIRST.length - 1) + ordinal) % TEAM_FIRST.length];
  const last = SYNTHETIC_LAST[(random.integer(0, SYNTHETIC_LAST.length - 1) + ordinal) % SYNTHETIC_LAST.length];
  const name = first + ' ' + last;
  const maximumTenths = Math.max(2, Math.floor(workspace.territory.radiusMiles * 8));
  const distance = random.integer(Math.max(1, Math.floor(workspace.territory.radiusMiles * 2)), maximumTenths) / 10;
  const angle = random.integer(0, 3599) / 10 * Math.PI / 180;
  const coordinates = coordinateAt(workspace.territory.center, distance, angle);
  const street = String(200 + random.integer(0, 699)) + ' ' + STREET_NAMES[(random.integer(0, STREET_NAMES.length - 1) + ordinal) % STREET_NAMES.length];
  const address = {
    street,
    city: workspace.territory.city,
    state: workspace.territory.state,
    postalCode: '00000',
    country: 'US',
    serviceZone: workspace.territory.zones[(random.integer(0, workspace.territory.zones.length - 1) + ordinal) % workspace.territory.zones.length],
    timeZone: workspace.territory.timeZone,
    coordinates,
    distanceMiles: Number(distanceMiles(workspace.territory.center, coordinates).toFixed(2)),
    withinServiceRadius: true,
    fictional: true,
  };
  address.formatted = [address.street, address.city, address.state + ' ' + address.postalCode].join(', ');
  return stableValue({
    id: fixtureId(digest, 'customer:' + String(ordinal)),
    name,
    email: slug(name) + '.' + String(ordinal + 1) + '@example.com',
    phone: reservedPhone({ areaCode: workspace.territory.areaCode }, 20 + ordinal + random.integer(0, 40)),
    address,
    fictional: true,
  });
}

function readiness() {
  return {
    state: 'needs_review',
    label: 'Review needed',
    guidance: 'Help Polaris understand your business. Polaris works best with a complete, accurate, and up-to-date Business Profile.',
    separation: 'Profile Readiness is separate from integration status and uses clear categories for recognized details.',
    items: [
      { label: 'Dispatch origin', state: 'reviewed' },
      { label: 'Service area', state: 'reviewed' },
      { label: 'Operating hours', state: 'reviewed' },
      { label: 'Customer guidance', state: 'needs_review' },
      { label: 'Financial configuration', state: 'needs_review' },
      { label: 'Voice assistant configuration', state: 'needs_review' },
    ],
  };
}

function createDemoWorkspaceFixture(input) {
  const value = typeof input === 'string' ? { seed: input } : input || {};
  const seedDigest = value.seedDigest === undefined
    ? normalizeDemoSeed(value.seed)
    : String(value.seedDigest);
  if (!/^[0-9a-f]{64}$/.test(seedDigest)) {
    throw new Error('A normalized demo workspace seed digest is invalid.');
  }
  const random = seededGenerator(seedDigest);
  const region = random.pick(REGIONS);
  const radiusMiles = random.integer(24, 42);
  const firstBrand = random.pick(BRAND_FIRST);
  const secondBrand = random.pick(BRAND_SECOND);
  const companyName = firstBrand + ' ' + secondBrand + ' Example Home Services';
  const companySlug = slug(firstBrand + '.' + secondBrand);
  const anchor = value.anchorTime === undefined ? deterministicAnchor(seedDigest) : new Date(value.anchorTime);
  if (!Number.isFinite(anchor.getTime())) throw new Error('Demo fixture anchor time is invalid.');
  const tenantId = fixtureId(seedDigest, 'tenant');
  const ownerIndex = random.integer(0, TEAM_FIRST.length - 1);
  const members = [
    { role: 'owner', accessRole: 'owner', operationalRole: 'Owner' },
    { role: 'dispatcher', accessRole: 'admin', operationalRole: 'Dispatcher' },
    { role: 'crew-lead', accessRole: 'member', operationalRole: 'Crew lead' },
    { role: 'technician', accessRole: 'member', operationalRole: 'Technician' },
  ].map(function (definition, index) {
    const first = TEAM_FIRST[(ownerIndex + index) % TEAM_FIRST.length];
    const last = SYNTHETIC_LAST[(random.integer(0, SYNTHETIC_LAST.length - 1) + index) % SYNTHETIC_LAST.length];
    const name = first + ' ' + last;
    return {
      id: fixtureId(seedDigest, 'member:' + definition.role),
      name,
      email: slug(name) + '@example.com',
      phone: reservedPhone(region, 2 + index),
      accessRole: definition.accessRole,
      operationalRole: definition.operationalRole,
      fictional: true,
    };
  });
  const company = {
    name: companyName,
    email: companySlug + '.office@example.com',
    phone: reservedPhone(region, 1),
    industry: random.pick(INDUSTRIES),
    description: 'Fictional whole-home service contractor created only for this isolated NorthStar demo.',
    timeZone: region.timeZone,
    serviceRadiusMiles: radiusMiles,
    ownerName: members[0].name,
    fictional: true,
  };
  const territory = {
    key: region.key,
    label: region.city + ' fictional service territory',
    city: region.city,
    state: region.state,
    postalCode: region.postalCode,
    country: 'US',
    timeZone: region.timeZone,
    areaCode: region.areaCode,
    radiusMiles,
    center: { ...region.center },
    zones: region.zones.slice(),
    headquarters: {
      street: '100 Example Service Way', city: region.city, state: region.state,
      postalCode: region.postalCode, country: 'US', timeZone: region.timeZone,
      coordinates: { ...region.center }, fictional: true,
      formatted: '100 Example Service Way, ' + region.city + ', ' + region.state + ' ' + region.postalCode,
    },
  };
  const services = SERVICE_DEFINITIONS.map(function (service) {
    return {
      id: fixtureId(seedDigest, 'service:' + service.key),
      key: service.key,
      label: service.label,
      estimate: service.estimate,
      industryCompatibility: 'residential_home_services',
    };
  });
  const baseWorkspace = {
    contract: FIXTURE_CONTRACT,
    tenant: { id: tenantId, name: companyName, businessProfileKey: 'seeded_fictional_workspace', fictional: true, isolated: true },
    company,
    territory,
    services,
    team: {
      mode: 'fictional_read_only',
      members,
      crews: [
        { id: fixtureId(seedDigest, 'crew:a'), name: 'Example Crew A', lead: members[2].name, leadMemberId: members[2].id, availability: 'Available tomorrow' },
        { id: fixtureId(seedDigest, 'crew:b'), name: 'Example Crew B', lead: members[3].name, leadMemberId: members[3].id, availability: 'Available this week' },
      ],
    },
  };
  const customers = Array.from({ length: 6 }, (_unused, index) => customerForSeed(baseWorkspace, seedDigest + ':initial:' + String(index), index));
  const serviceStart = random.integer(0, services.length - 1);
  const statuses = [
    { lead: 'hot', work: 'follow_up_due', offsetHours: 26 },
    { lead: 'booked', work: 'scheduled', offsetHours: 4 },
    { lead: 'qualified', work: 'estimate_ready', offsetHours: 50 },
  ];
  const jobs = statuses.map(function (status, index) {
    const definition = SERVICE_DEFINITIONS[(serviceStart + index) % SERVICE_DEFINITIONS.length];
    const customer = customers[index];
    const assigned = members[2 + (index % 2)];
    return {
      id: fixtureId(seedDigest, 'job:' + String(index)),
      customerId: customer.id,
      serviceKey: definition.key,
      serviceLabel: definition.label,
      jobType: definition.jobType,
      scope: stableValue(definition.scope),
      summary: definition.label + ' for a fictional customer in ' + customer.address.serviceZone + '.',
      estimatedValue: definition.estimate,
      confidence: 84 + index * 3,
      leadStatus: status.lead,
      workStatus: status.work,
      scheduledStart: new Date(anchor.getTime() + status.offsetHours * 60 * 60 * 1000).toISOString(),
      timeZone: region.timeZone,
      assignedMemberId: assigned.id,
      assignedTo: assigned.name,
    };
  });
  const businessProfile = stableValue({
    mode: 'fictional_read_only',
    businessKey: 'seeded_fictional_workspace',
    company: company.name,
    email: company.email,
    phone: company.phone,
    timeZone: company.timeZone,
    industry: company.industry,
    description: company.description,
    serviceArea: territory.label,
    serviceRadiusMiles: territory.radiusMiles,
    serviceZones: territory.zones,
    headquarters: territory.headquarters,
    services,
    crewCount: baseWorkspace.team.crews.length,
    pricingModel: 'Fictional recorded labor, material, travel, and review inputs',
    hours: 'Monday-Friday, 8:00 AM-5:00 PM',
    ownerName: company.ownerName,
    voiceAssistant: {
      name: 'NorthStar Office Manager',
      greeting: 'Thank you for calling ' + company.name + '. How can I help today?',
    },
    readiness: readiness(),
  });
  const fixture = stableValue({
    ...baseWorkspace,
    businessProfile,
    customers,
    jobs,
  });
  validateDemoWorkspaceFixture(fixture);
  return fixture;
}

function validateDemoWorkspaceFixture(fixture) {
  if (!fixture || fixture.contract !== FIXTURE_CONTRACT || !fixture.tenant || !fixture.company ||
      !fixture.territory || !fixture.team || !fixture.businessProfile || !Array.isArray(fixture.services) ||
      !Array.isArray(fixture.customers) || !Array.isArray(fixture.jobs)) {
    throw new Error('The fictional demo workspace fixture is malformed.');
  }
  const contacts = [fixture.company, ...fixture.team.members, ...fixture.customers];
  if (contacts.some(contact => !contact || contact.fictional !== true || !RESERVED_EMAIL.test(contact.email) ||
      !RESERVED_PHONE.test(contact.phone))) {
    throw new Error('The fictional demo workspace contains non-reserved contact data.');
  }
  if (!String(fixture.company.name || '').includes('Example') ||
      [...fixture.team.members, ...fixture.customers].some(person => !SYNTHETIC_PERSON.test(String(person.name || '')))) {
    throw new Error('The fictional demo workspace contains a non-synthetic identity.');
  }
  if (fixture.company.timeZone !== fixture.territory.timeZone ||
      fixture.businessProfile.timeZone !== fixture.territory.timeZone ||
      fixture.company.serviceRadiusMiles !== fixture.territory.radiusMiles) {
    throw new Error('The fictional demo workspace territory and time zone disagree.');
  }
  if (!INDUSTRIES.includes(fixture.company.industry) ||
      fixture.services.some(service => service.industryCompatibility !== 'residential_home_services')) {
    throw new Error('The fictional demo workspace industry and services disagree.');
  }
  const serviceKeys = new Set(fixture.services.map(service => service.key));
  const customerIds = new Set(fixture.customers.map(customer => customer.id));
  const memberIds = new Set(fixture.team.members.map(member => member.id));
  for (const customer of fixture.customers) {
    const address = customer.address;
    if (!address || address.fictional !== true || address.withinServiceRadius !== true ||
        address.postalCode !== '00000' ||
        !String(address.formatted).includes('Example') || address.timeZone !== fixture.territory.timeZone ||
        !fixture.territory.zones.includes(address.serviceZone) ||
        distanceMiles(fixture.territory.center, address.coordinates) > fixture.territory.radiusMiles) {
      throw new Error('A fictional demo customer falls outside the configured territory.');
    }
  }
  for (const job of fixture.jobs) {
    if (!serviceKeys.has(job.serviceKey) || !customerIds.has(job.customerId) ||
        !memberIds.has(job.assignedMemberId) || job.timeZone !== fixture.territory.timeZone ||
        !Number.isFinite(Date.parse(job.scheduledStart))) {
      throw new Error('A fictional demo job disagrees with the shared workspace authority.');
    }
  }
  return true;
}

function sameStableValue(first, second) {
  return JSON.stringify(stableValue(first)) === JSON.stringify(stableValue(second));
}

function validateLocationAgainstTerritory(location, territory) {
  if (!location || location.fictional !== true || location.withinServiceRadius !== true ||
      location.city !== territory.city || location.state !== territory.state ||
      location.postalCode !== '00000' || location.country !== territory.country ||
      location.timeZone !== territory.timeZone || !territory.zones.includes(location.serviceZone) ||
      !String(location.formatted || '').includes('Example') ||
      !location.coordinates || !Number.isFinite(Number(location.coordinates.latitude)) ||
      !Number.isFinite(Number(location.coordinates.longitude))) {
    throw new Error('A fictional demo graph location disagrees with its workspace territory.');
  }
  const calculatedDistance = Number(distanceMiles(territory.center, location.coordinates).toFixed(2));
  if (calculatedDistance > territory.radiusMiles ||
      Math.abs(calculatedDistance - Number(location.distanceMiles)) > 0.05) {
    throw new Error('A fictional demo graph location falls outside its workspace radius.');
  }
}

function validateReservedTextContacts(value) {
  const strings = [];
  (function collect(current) {
    if (typeof current === 'string') strings.push(current);
    else if (Array.isArray(current)) current.forEach(collect);
    else if (current && typeof current === 'object') Object.values(current).forEach(collect);
  })(value);
  const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  const phonePattern = /(?<![0-9a-z])(?:\+?1[\s.-]?)?(?:\([2-9][0-9]{2}\)|[2-9][0-9]{2})[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}(?![0-9a-z])/gi;
  for (const text of strings) {
    const emails = text.match(emailPattern) || [];
    if (emails.some(email => !RESERVED_EMAIL.test(email.toLowerCase()))) {
      throw new Error('A persisted fictional demo graph contains non-reserved contact text.');
    }
    const phones = text.match(phonePattern) || [];
    if (phones.some(phone => {
      const digits = phone.replace(/[^0-9]/g, '').replace(/^1(?=[2-9][0-9]{9}$)/, '');
      return digits.length !== 10 || digits.slice(3, 8) !== '55501';
    })) {
      throw new Error('A persisted fictional demo graph contains non-reserved phone text.');
    }
  }
}

function validateDemoGraphAgainstWorkspace(graph, workspace) {
  validateDemoWorkspaceFixture(workspace);
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) ||
      !graph.ids || !graph.source || graph.source.type !== 'account_free_demo' || graph.source.version !== 2 ||
      !graph.customer || graph.customer.fictional !== true || !graph.lead || !graph.work ||
      !graph.estimate || graph.estimate.fictional !== true || !graph.communication ||
      !graph.polaris || graph.polaris.fictional !== true || !graph.timestamps) {
    throw new Error('A persisted fictional demo graph is malformed.');
  }
  const expectedIds = {
    customer: graph.customer.id,
    lead: graph.lead.id,
    opportunity: graph.lead.id,
    work: graph.work.id,
    appointment: graph.work.id,
    communication: graph.communication.id,
    estimate: graph.estimate.id,
    polarisSnapshot: graph.polaris.id,
  };
  const expectedIdKeys = [
    'appointment', 'communication', 'customer', 'estimate', 'graph', 'lead',
    'operation', 'opportunity', 'polarisSnapshot', 'work',
  ];
  const distinctIds = [
    graph.ids.appointment, graph.ids.communication, graph.ids.customer, graph.ids.estimate,
    graph.ids.graph, graph.ids.lead, graph.ids.operation, graph.ids.polarisSnapshot,
  ];
  if (!sameStableValue(Object.keys(graph.ids).sort(), expectedIdKeys) ||
      distinctIds.some(value => !UUID.test(String(value || ''))) ||
      new Set(distinctIds).size !== distinctIds.length ||
      Object.entries(expectedIds).some(([key, value]) => !UUID.test(String(value || '')) || graph.ids[key] !== value)) {
    throw new Error('A persisted fictional demo graph has inconsistent object references.');
  }
  if (!SYNTHETIC_PERSON.test(String(graph.customer.name || '')) ||
      !RESERVED_EMAIL.test(String(graph.customer.email || '')) ||
      !RESERVED_PHONE.test(String(graph.customer.phone || ''))) {
    throw new Error('A persisted fictional demo graph contains non-reserved customer identity data.');
  }
  validateReservedTextContacts(graph);
  validateLocationAgainstTerritory(graph.customer.location, workspace.territory);
  if (graph.customer.address !== graph.customer.location.formatted) {
    throw new Error('A persisted fictional demo graph address disagrees with its location authority.');
  }
  const service = workspace.services.find(candidate => candidate.key === graph.lead.serviceType);
  if (!service || graph.lead.serviceLabel !== service.label ||
      !graph.polaris.snapshot || !graph.polaris.snapshot.service ||
      graph.polaris.snapshot.service.key !== service.key ||
      graph.polaris.snapshot.service.label !== service.label) {
    throw new Error('A persisted fictional demo graph service disagrees with its workspace catalogue.');
  }
  if (!sameStableValue(graph.businessProfile, workspace.businessProfile) ||
      graph.work.timeZone !== workspace.territory.timeZone ||
      !workspace.team.members.some(member => member.name === graph.work.assignedTo)) {
    throw new Error('A persisted fictional demo graph profile or assignment disagrees with its workspace.');
  }
  const scope = graph.polaris.snapshot.service.scope;
  if (!scope || Number(scope.serviceRadiusMiles) !== workspace.territory.radiusMiles ||
      Number(scope.customerDistanceMiles) !== Number(graph.customer.location.distanceMiles) ||
      (scope.phone !== undefined && scope.phone !== graph.customer.phone) ||
      (scope.email !== undefined && scope.email !== graph.customer.email) ||
      (scope.address !== undefined && scope.address !== graph.customer.address) ||
      (scope.customerName !== undefined && scope.customerName !== graph.customer.name) ||
      (scope.serviceZone !== undefined && scope.serviceZone !== graph.customer.location.serviceZone) ||
      (scope.timeZone !== undefined && scope.timeZone !== workspace.territory.timeZone) ||
      (graph.scenario && graph.scenario.selection && graph.scenario.selection.service !== service.key)) {
    throw new Error('A persisted fictional demo graph scope disagrees with its workspace references.');
  }
  const facts = new Map((Array.isArray(graph.polaris.facts) ? graph.polaris.facts : [])
    .map(fact => [fact && fact.variable, fact && fact.normalizedValue]));
  for (const [variable, expected] of [
    ['phone', graph.customer.phone],
    ['email', graph.customer.email],
    ['address', graph.customer.address],
    ['serviceRadiusMiles', workspace.territory.radiusMiles],
    ['customerDistanceMiles', graph.customer.location.distanceMiles],
  ]) {
    if (facts.has(variable) && !sameStableValue(facts.get(variable), expected)) {
      throw new Error('A persisted fictional demo graph fact disagrees with its workspace references.');
    }
  }
  if (typeof graph.polaris.snapshotDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(graph.polaris.snapshotDigest) ||
      sha256(graph.polaris.snapshot) !== graph.polaris.snapshotDigest) {
    throw new Error('A persisted fictional demo graph Polaris snapshot digest is invalid.');
  }
  const projection = { ...graph };
  delete projection.projectionDigest;
  if (!/^[0-9a-f]{64}$/.test(String(graph.projectionDigest || '')) ||
      sha256(projection) !== graph.projectionDigest) {
    throw new Error('A persisted fictional demo graph projection digest is invalid.');
  }
  return true;
}

module.exports = {
  FIXTURE_CONTRACT,
  SEED_CONTRACT,
  SERVICE_DEFINITIONS,
  createDemoWorkspaceFixture,
  customerForSeed,
  distanceMiles,
  normalizeDemoSeed,
  validateDemoGraphAgainstWorkspace,
  validateDemoWorkspaceFixture,
};
