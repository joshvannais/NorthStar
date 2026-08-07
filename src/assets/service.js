'use strict';

const crypto = require('crypto');
const { AssetCatalogueRepository } = require('./repository');

const ASSET_CATEGORIES = new Set([
  'vehicle', 'equipment', 'tool', 'trailer', 'attachment', 'other',
]);
const CATALOGUE_STATES = new Set(['active', 'archived']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

class AssetCatalogueError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AssetCatalogueError';
    this.status = status;
    this.code = code;
  }
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssetCatalogueError(400, code, 'Asset catalogue request is invalid');
  }
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new AssetCatalogueError(400, code, 'Asset catalogue request contains an unsupported field');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > 65536) {
    throw new AssetCatalogueError(400, code, 'Asset catalogue request is too large');
  }
  return value;
}

function rawText(value, maximumBytes, maximumCharacters, label, required) {
  if (typeof value !== 'string' || CONTROL_PATTERN.test(value) ||
      Buffer.byteLength(value, 'utf8') > maximumBytes || Array.from(value).length > maximumCharacters ||
      (required && !value.trim())) {
    throw new AssetCatalogueError(400, 'invalid_asset_catalogue_item', `${label} is invalid`);
  }
  return value;
}

function optionalRawText(value, maximumBytes, maximumCharacters, label) {
  if (value === undefined || value === null) return '';
  return rawText(value, maximumBytes, maximumCharacters, label, false);
}

function stableId(value, label, nullable) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !STABLE_ID_PATTERN.test(value)) {
    throw new AssetCatalogueError(400, 'invalid_asset_catalogue_item', `${label} is invalid`);
  }
  return value;
}

function positiveVersion(value, code) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    throw new AssetCatalogueError(400, code, 'Asset catalogue version is invalid');
  }
  return value;
}

function assetId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new AssetCatalogueError(400, 'invalid_asset_catalogue_item', 'Asset identity is invalid');
  }
  return value.toLowerCase();
}

function serviceIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new AssetCatalogueError(400, 'invalid_asset_catalogue_item', 'Service capabilities are invalid');
  }
  const result = value.map(item => stableId(item, 'Service capability', false));
  const folded = result.map(item => item.toLowerCase());
  if (new Set(folded).size !== folded.length) {
    throw new AssetCatalogueError(400, 'invalid_asset_catalogue_item', 'Service capabilities contain a duplicate');
  }
  return result;
}

class AssetCatalogueService {
  constructor(repository) {
    this.repository = repository || new AssetCatalogueRepository();
  }

  parseAsset(input, requireVersion) {
    const allowed = new Set([
      'category', 'name', 'internalReference', 'manufacturer', 'model', 'modelYear',
      'configuration', 'serialNumber', 'vin', 'homeLocationId', 'serviceIds',
    ]);
    if (requireVersion) allowed.add('version');
    const body = exactObject(input, allowed, 'invalid_asset_catalogue_item');
    if (typeof body.category !== 'string' || !ASSET_CATEGORIES.has(body.category)) {
      throw new AssetCatalogueError(400, 'invalid_asset_category', 'Asset category is invalid');
    }
    let modelYear = null;
    if (body.modelYear !== undefined && body.modelYear !== null && body.modelYear !== '') {
      if (!Number.isInteger(body.modelYear) || body.modelYear < 1800 || body.modelYear > 3000) {
        throw new AssetCatalogueError(400, 'invalid_asset_catalogue_item', 'Model year is invalid');
      }
      modelYear = body.modelYear;
    }
    const parsed = {
      category: body.category,
      name: rawText(body.name, 480, 120, 'Asset name', true),
      internalReference: optionalRawText(body.internalReference, 480, 120, 'Internal reference'),
      manufacturer: optionalRawText(body.manufacturer, 480, 120, 'Manufacturer'),
      model: optionalRawText(body.model, 480, 120, 'Model'),
      modelYear,
      configuration: optionalRawText(body.configuration, 4096, 1024, 'Configuration'),
      serialNumber: optionalRawText(body.serialNumber, 480, 120, 'Serial number'),
      vin: optionalRawText(body.vin, 480, 120, 'VIN'),
      homeLocationId: stableId(body.homeLocationId, 'Home location', true),
      serviceIds: serviceIds(body.serviceIds),
    };
    if (requireVersion) parsed.version = positiveVersion(body.version, 'invalid_asset_catalogue_item');
    return parsed;
  }

  parseCatalogueState(input) {
    const body = exactObject(
      input,
      new Set(['version', 'catalogueState']),
      'invalid_asset_catalogue_state'
    );
    if (typeof body.catalogueState !== 'string' || !CATALOGUE_STATES.has(body.catalogueState)) {
      throw new AssetCatalogueError(400, 'invalid_asset_catalogue_state', 'Asset catalogue state is invalid');
    }
    return {
      version: positiveVersion(body.version, 'invalid_asset_catalogue_state'),
      catalogueState: body.catalogueState,
    };
  }

  async snapshot(organizationId, role) {
    const snapshot = await this.repository.snapshot(organizationId);
    return {
      authority: 'postgresql',
      canManage: role === 'owner' || role === 'admin',
      ...snapshot,
    };
  }

  async create(input, context) {
    try {
      return await this.repository.create({
        ...this.parseAsset(input, false),
        assetId: crypto.randomUUID(),
        ...context,
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new AssetCatalogueError(409, 'asset_catalogue_identity_conflict', 'Asset identity already exists');
      }
      throw error;
    }
  }

  async update(id, input, context) {
    try {
      return await this.repository.update({
        ...this.parseAsset(input, true),
        assetId: assetId(id),
        ...context,
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new AssetCatalogueError(409, 'asset_catalogue_identity_conflict', 'Asset identity already exists');
      }
      throw error;
    }
  }

  async setCatalogueState(id, input, context) {
    return this.repository.setCatalogueState({
      ...this.parseCatalogueState(input),
      assetId: assetId(id),
      ...context,
    });
  }
}

module.exports = {
  ASSET_CATEGORIES,
  AssetCatalogueError,
  AssetCatalogueService,
};
