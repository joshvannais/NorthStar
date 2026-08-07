'use strict';

const db = require('../db');

class AssetCataloguePersistenceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AssetCataloguePersistenceError';
    this.cause = cause;
  }
}

function catalogueError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

class AssetCatalogueRepository {
  constructor(pool) {
    this.explicitPool = Boolean(pool);
    this.pool = pool || db.getPool();
  }

  requirePool() {
    if (!this.pool || (!this.explicitPool && !db.isAvailable())) {
      throw new AssetCataloguePersistenceError('PostgreSQL asset catalogue authority is unavailable');
    }
    return this.pool;
  }

  async transaction(work, readOnly = false) {
    const client = await this.requirePool().connect();
    try {
      await client.query(readOnly
        ? 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
        : 'BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* Preserve original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async lockOrganization(client, organizationId) {
    const result = await client.query(
      'SELECT id FROM organizations WHERE id = $1 FOR UPDATE',
      [organizationId]
    );
    if (result.rows.length !== 1) {
      throw catalogueError(404, 'organization_not_found', 'Organization not found');
    }
  }

  async requireActor(client, organizationId, actorUserId) {
    const result = await client.query(
      `SELECT id, role, status
         FROM organization_memberships
        WHERE organization_id = $1 AND user_id = $2
        FOR SHARE`,
      [organizationId, actorUserId]
    );
    const actor = result.rows[0];
    if (!actor || actor.status !== 'active' || !['owner', 'admin'].includes(actor.role)) {
      throw catalogueError(403, 'asset_catalogue_permission_required', 'Asset catalogue permission is unavailable');
    }
    return actor;
  }

  async profileReferences(client, organizationId) {
    const result = await client.query(
      `SELECT id, version_label, normalized_profile_hash, raw_profile
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [organizationId]
    );
    if (result.rows.length !== 1) {
      throw catalogueError(409, 'business_profile_required', 'An active Business Profile is required');
    }
    const row = result.rows[0];
    const raw = row.raw_profile && typeof row.raw_profile === 'object' ? row.raw_profile : {};
    const locations = [{ id: 'headquarters', name: 'Headquarters' }];
    const offices = raw.headquarters && Array.isArray(raw.headquarters.additionalOffices)
      ? raw.headquarters.additionalOffices : [];
    for (const office of offices) {
      if (office && typeof office.id === 'string') {
        locations.push({
          id: office.id,
          name: typeof office.name === 'string' && office.name ? office.name : office.id,
        });
      }
    }
    const services = Array.isArray(raw.services) ? raw.services.reduce((items, service) => {
      if (service && typeof service.id === 'string') {
        items.push({
          id: service.id,
          name: typeof service.name === 'string' && service.name ? service.name : service.id,
        });
      }
      return items;
    }, []) : [];
    return {
      id: row.id,
      version: row.version_label,
      hash: row.normalized_profile_hash,
      locations,
      services,
    };
  }

  canonicalReference(items, requestedId, invalidCode, ambiguousCode, label) {
    if (requestedId === null) return null;
    const folded = requestedId.toLowerCase();
    const matches = items.filter(item => item.id.toLowerCase() === folded);
    if (matches.length === 0) {
      throw catalogueError(400, invalidCode, `Asset ${label} is not in the active Business Profile`);
    }
    if (matches.length !== 1) {
      throw catalogueError(409, ambiguousCode, `Asset ${label} is ambiguous in the active Business Profile`);
    }
    return matches[0].id;
  }

  canonicalLocation(references, locationId) {
    return this.canonicalReference(
      references.locations,
      locationId,
      'invalid_asset_location',
      'ambiguous_asset_location',
      'location'
    );
  }

  canonicalServices(references, requestedIds) {
    return requestedIds.map(serviceId => this.canonicalReference(
      references.services,
      serviceId,
      'invalid_asset_service',
      'ambiguous_asset_service',
      'service'
    ));
  }

  async requireRestorableReferences(client, organizationId, assetId, homeLocationId) {
    const references = await this.profileReferences(client, organizationId);
    const serviceResult = await client.query(
      `SELECT service_id FROM tenant_asset_service_capabilities
        WHERE organization_id = $1 AND asset_id = $2
        ORDER BY lower(service_id), service_id`,
      [organizationId, assetId]
    );
    try {
      this.canonicalLocation(references, homeLocationId);
      this.canonicalServices(references, serviceResult.rows.map(row => row.service_id));
    } catch (error) {
      if (error && [
        'invalid_asset_location', 'ambiguous_asset_location',
        'invalid_asset_service', 'ambiguous_asset_service',
      ].includes(error.code)) {
        throw catalogueError(
          409,
          'asset_catalogue_reference_conflict',
          'Asset Business Profile references changed; update the archived asset before restoring'
        );
      }
      throw error;
    }
  }

  project(row, services) {
    return {
      id: row.id,
      category: row.category,
      name: row.name,
      internalReference: row.internal_reference,
      manufacturer: row.manufacturer,
      model: row.model,
      modelYear: row.model_year === null ? null : Number(row.model_year),
      configuration: row.configuration,
      serialNumber: row.serial_number,
      vin: row.vin,
      homeLocationId: row.home_location_id,
      serviceIds: services || [],
      catalogueState: row.catalogue_state,
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    };
  }

  async readAsset(client, organizationId, assetId) {
    const [assetResult, serviceResult] = await Promise.all([
      client.query(
        `SELECT id, category, name, internal_reference, manufacturer, model, model_year,
                configuration, serial_number, vin, home_location_id, catalogue_state,
                version, created_at, updated_at, archived_at
           FROM tenant_assets
          WHERE organization_id = $1 AND id = $2`,
        [organizationId, assetId]
      ),
      client.query(
        `SELECT service_id FROM tenant_asset_service_capabilities
          WHERE organization_id = $1 AND asset_id = $2
          ORDER BY lower(service_id), service_id`,
        [organizationId, assetId]
      ),
    ]);
    if (assetResult.rows.length !== 1) {
      throw catalogueError(404, 'asset_catalogue_item_not_found', 'Asset catalogue item not found');
    }
    return this.project(assetResult.rows[0], serviceResult.rows.map(row => row.service_id));
  }

  async replaceServices(client, input) {
    await client.query(
      `DELETE FROM tenant_asset_service_capabilities
        WHERE organization_id = $1 AND asset_id = $2`,
      [input.organizationId, input.assetId]
    );
    for (const serviceId of input.serviceIds) {
      await client.query(
        `INSERT INTO tenant_asset_service_capabilities
          (organization_id, asset_id, service_id, created_by_user_id)
         VALUES ($1,$2,$3,$4)`,
        [input.organizationId, input.assetId, serviceId, input.actorUserId]
      );
    }
  }

  async insertAudit(client, input) {
    await client.query(
      `INSERT INTO tenant_asset_audit_events
        (organization_id, actor_user_id, action, subject_id, details)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [input.organizationId, input.actorUserId, input.action, input.assetId,
        JSON.stringify(input.details || {})]
    );
  }

  async snapshot(organizationId) {
    return this.transaction(async client => {
      const references = await this.profileReferences(client, organizationId);
      const [assetResult, serviceResult] = await Promise.all([
        client.query(
          `SELECT id, category, name, internal_reference, manufacturer, model, model_year,
                  configuration, serial_number, vin, home_location_id, catalogue_state,
                  version, created_at, updated_at, archived_at
             FROM tenant_assets
            WHERE organization_id = $1
            ORDER BY CASE catalogue_state WHEN 'active' THEN 0 ELSE 1 END, lower(name), id`,
          [organizationId]
        ),
        client.query(
          `SELECT asset_id, service_id FROM tenant_asset_service_capabilities
            WHERE organization_id = $1
            ORDER BY asset_id, lower(service_id), service_id`,
          [organizationId]
        ),
      ]);
      const servicesByAsset = new Map();
      for (const relation of serviceResult.rows) {
        if (!servicesByAsset.has(relation.asset_id)) servicesByAsset.set(relation.asset_id, []);
        servicesByAsset.get(relation.asset_id).push(relation.service_id);
      }
      return {
        assets: assetResult.rows.map(row => this.project(row, servicesByAsset.get(row.id) || [])),
        locations: references.locations,
        services: references.services,
        businessProfile: { id: references.id, version: references.version, hash: references.hash },
      };
    }, true);
  }

  async create(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId);
      const references = await this.profileReferences(client, input.organizationId);
      const homeLocationId = this.canonicalLocation(references, input.homeLocationId);
      const canonicalServices = this.canonicalServices(references, input.serviceIds);
      await client.query(
        `INSERT INTO tenant_assets
          (id, organization_id, category, name, internal_reference, manufacturer, model,
           model_year, configuration, serial_number, vin, home_location_id,
           created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [input.assetId, input.organizationId, input.category, input.name,
          input.internalReference, input.manufacturer, input.model, input.modelYear,
          input.configuration, input.serialNumber, input.vin, homeLocationId, input.actorUserId]
      );
      await this.replaceServices(client, { ...input, serviceIds: canonicalServices });
      await this.insertAudit(client, {
        ...input,
        action: 'asset_created',
        details: { category: input.category, version: 1 },
      });
      return this.readAsset(client, input.organizationId, input.assetId);
    });
  }

  async update(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId);
      const references = await this.profileReferences(client, input.organizationId);
      const existing = await client.query(
        `SELECT id, version FROM tenant_assets
          WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [input.organizationId, input.assetId]
      );
      if (existing.rows.length !== 1) {
        throw catalogueError(404, 'asset_catalogue_item_not_found', 'Asset catalogue item not found');
      }
      if (Number(existing.rows[0].version) !== input.version) {
        throw catalogueError(409, 'asset_catalogue_version_conflict', 'Asset catalogue item changed; reload and try again');
      }
      const homeLocationId = this.canonicalLocation(references, input.homeLocationId);
      const canonicalServices = this.canonicalServices(references, input.serviceIds);
      await client.query(
        `UPDATE tenant_assets
            SET category = $3, name = $4, internal_reference = $5, manufacturer = $6,
                model = $7, model_year = $8, configuration = $9, serial_number = $10,
                vin = $11, home_location_id = $12, updated_by_user_id = $13,
                updated_at = NOW(), version = version + 1
          WHERE organization_id = $1 AND id = $2`,
        [input.organizationId, input.assetId, input.category, input.name,
          input.internalReference, input.manufacturer, input.model, input.modelYear,
          input.configuration, input.serialNumber, input.vin, homeLocationId, input.actorUserId]
      );
      await this.replaceServices(client, { ...input, serviceIds: canonicalServices });
      await this.insertAudit(client, {
        ...input,
        action: 'asset_updated',
        details: { fromVersion: input.version, toVersion: input.version + 1 },
      });
      return this.readAsset(client, input.organizationId, input.assetId);
    });
  }

  async setCatalogueState(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId);
      const existing = await client.query(
        `SELECT id, version, catalogue_state, home_location_id FROM tenant_assets
          WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [input.organizationId, input.assetId]
      );
      if (existing.rows.length !== 1) {
        throw catalogueError(404, 'asset_catalogue_item_not_found', 'Asset catalogue item not found');
      }
      const row = existing.rows[0];
      if (Number(row.version) !== input.version) {
        throw catalogueError(409, 'asset_catalogue_version_conflict', 'Asset catalogue item changed; reload and try again');
      }
      if (row.catalogue_state === input.catalogueState) {
        throw catalogueError(409, 'asset_catalogue_state_conflict', 'Asset catalogue state is already current');
      }
      const archived = input.catalogueState === 'archived';
      if (!archived) {
        await this.requireRestorableReferences(
          client,
          input.organizationId,
          input.assetId,
          row.home_location_id
        );
      }
      await client.query(
        `UPDATE tenant_assets
            SET catalogue_state = $3,
                archived_by_user_id = CASE WHEN $4 THEN $5::uuid ELSE NULL END,
                archived_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
                updated_by_user_id = $5, updated_at = NOW(), version = version + 1
          WHERE organization_id = $1 AND id = $2`,
        [input.organizationId, input.assetId, input.catalogueState, archived, input.actorUserId]
      );
      await this.insertAudit(client, {
        ...input,
        action: archived ? 'asset_archived' : 'asset_restored',
        details: {
          fromState: row.catalogue_state,
          toState: input.catalogueState,
          fromVersion: input.version,
          toVersion: input.version + 1,
        },
      });
      return this.readAsset(client, input.organizationId, input.assetId);
    });
  }
}

module.exports = {
  AssetCataloguePersistenceError,
  AssetCatalogueRepository,
  catalogueError,
};
