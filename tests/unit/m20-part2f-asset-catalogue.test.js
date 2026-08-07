'use strict';

const { hasPermission } = require('../../src/auth/permissions');
const {
  ASSET_CATEGORIES,
  AssetCatalogueService,
} = require('../../src/assets/service');
const { AssetCatalogueRepository } = require('../../src/assets/repository');

function service(repository = {}) {
  return new AssetCatalogueService(repository);
}

function validAsset(overrides = {}) {
  return {
    category: 'equipment',
    name: '  Mini <Excavator> ☃  ',
    internalReference: '  EQ-42 <A&B>  ',
    manufacturer: '  Acme é  ',
    model: '  X-200 <script>data-only()</script>  ',
    modelYear: 2024,
    configuration: '\n  Cab + thumb </textarea><svg onload=never()> 🧰  \n',
    serialNumber: '  SERIAL-<img src=x>  ',
    vin: '  VIN-🌌-RAW  ',
    homeLocationId: 'office-north',
    serviceIds: ['Fence-Repair', 'Drain:Clear'],
    ...overrides,
  };
}

describe('Mission 20 Part 2F tenant asset catalogue contract', () => {
  test('accepted identity text and Business Profile references preserve caller bytes', () => {
    const input = validAsset();
    expect(service().parseAsset(input, false)).toEqual(input);
    expect(Array.from(ASSET_CATEGORIES).sort()).toEqual([
      'attachment', 'equipment', 'other', 'tool', 'trailer', 'vehicle',
    ]);
  });

  test('updates require a positive exact version without changing the identity envelope', () => {
    const input = validAsset({ version: 7 });
    expect(service().parseAsset(input, true)).toEqual(input);
    expect(() => service().parseAsset(validAsset({ version: 0 }), true))
      .toThrow(expect.objectContaining({ status: 400, code: 'invalid_asset_catalogue_item' }));
    expect(() => service().parseAsset(validAsset(), true))
      .toThrow(expect.objectContaining({ status: 400, code: 'invalid_asset_catalogue_item' }));
    expect(() => service().parseAsset(validAsset({ version: 1.5 }), true))
      .toThrow(expect.objectContaining({ status: 400, code: 'invalid_asset_catalogue_item' }));
  });

  test.each([
    'assignmentId', 'assignedCrewId', 'currentLocationId', 'availability', 'hours', 'mileage',
    'condition', 'maintenance', 'faults', 'downtime', 'telematics', 'providerMappings',
    'syncState', 'purchaseCost', 'currentValue', 'operatingCost', 'jobId', 'attachments',
  ])('operational/provider field %s is outside Mission 20 and fails closed', field => {
    expect(() => service().parseAsset(validAsset({ [field]: 'forbidden' }), false))
      .toThrow(expect.objectContaining({ status: 400, code: 'invalid_asset_catalogue_item' }));
  });

  test('category, year, duplicate references, controls, and byte limits fail closed', () => {
    expect(() => service().parseAsset(validAsset({ category: 'inventory' }), false))
      .toThrow(expect.objectContaining({ code: 'invalid_asset_category' }));
    expect(() => service().parseAsset(validAsset({ modelYear: 1799 }), false))
      .toThrow(expect.objectContaining({ code: 'invalid_asset_catalogue_item' }));
    expect(() => service().parseAsset(validAsset({ modelYear: 3001 }), false))
      .toThrow(expect.objectContaining({ code: 'invalid_asset_catalogue_item' }));
    expect(() => service().parseAsset(validAsset({ name: 'bad\u0000name' }), false))
      .toThrow(expect.objectContaining({ code: 'invalid_asset_catalogue_item' }));
    expect(() => service().parseAsset(validAsset({ configuration: '🧰'.repeat(1025) }), false))
      .toThrow(expect.objectContaining({ code: 'invalid_asset_catalogue_item' }));
    expect(() => service().parseAsset(validAsset({ serviceIds: ['Fence', 'fEnCe'] }), false))
      .toThrow(expect.objectContaining({ code: 'invalid_asset_catalogue_item' }));
  });

  test('catalogue lifecycle accepts only active/archive transitions with a version', () => {
    expect(service().parseCatalogueState({ version: 2, catalogueState: 'archived' }))
      .toEqual({ version: 2, catalogueState: 'archived' });
    expect(service().parseCatalogueState({ version: 3, catalogueState: 'active' }))
      .toEqual({ version: 3, catalogueState: 'active' });
    expect(() => service().parseCatalogueState({ version: 2, catalogueState: 'available' }))
      .toThrow(expect.objectContaining({ status: 400, code: 'invalid_asset_catalogue_state' }));
    expect(() => service().parseCatalogueState({ version: 2, catalogueState: 'archived', reason: 'extra' }))
      .toThrow(expect.objectContaining({ status: 400, code: 'invalid_asset_catalogue_state' }));
  });

  test('Business Profile references resolve to exact canonical casing and ambiguity fails closed', () => {
    const repository = new AssetCatalogueRepository({});
    const references = {
      locations: [{ id: 'headquarters' }, { id: 'Office-North' }],
      services: [{ id: 'Fence-Repair' }, { id: 'Drain:Clear' }],
    };
    expect(repository.canonicalLocation(references, 'OFFICE-NORTH')).toBe('Office-North');
    expect(repository.canonicalServices(references, ['fence-repair', 'DRAIN:CLEAR']))
      .toEqual(['Fence-Repair', 'Drain:Clear']);
    expect(() => repository.canonicalLocation({
      ...references,
      locations: [{ id: 'Office-North' }, { id: 'office-north' }],
    }, 'OFFICE-NORTH')).toThrow(expect.objectContaining({
      status: 409, code: 'ambiguous_asset_location',
    }));
    expect(() => repository.canonicalServices({
      ...references,
      services: [{ id: 'Fence-Repair' }, { id: 'fence-repair' }],
    }, ['FENCE-REPAIR'])).toThrow(expect.objectContaining({
      status: 409, code: 'ambiguous_asset_service',
    }));
  });

  test('owner and admin manage identities while member and viewer are read-only', () => {
    for (const role of ['owner', 'admin']) {
      expect(hasPermission(role, 'assets', 'read')).toBe(true);
      expect(hasPermission(role, 'assets', 'create')).toBe(true);
      expect(hasPermission(role, 'assets', 'update')).toBe(true);
      expect(hasPermission(role, 'assets', 'delete')).toBe(false);
    }
    for (const role of ['member', 'viewer']) {
      expect(hasPermission(role, 'assets', 'read')).toBe(true);
      expect(hasPermission(role, 'assets', 'create')).toBe(false);
      expect(hasPermission(role, 'assets', 'update')).toBe(false);
      expect(hasPermission(role, 'assets', 'delete')).toBe(false);
    }
  });
});
