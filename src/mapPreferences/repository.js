'use strict';

const db = require('../db');
const { MapPreferenceError, projectMapPreferences } = require('./contract');

class MapPreferencePersistenceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'MapPreferencePersistenceError';
    this.cause = cause;
  }
}

function preferenceValues(document) {
  return [
    document.providers.google_maps.enabled,
    document.providers.google_maps.visible,
    document.providers.apple_maps.enabled,
    document.providers.apple_maps.visible,
    document.providers.waze.enabled,
    document.providers.waze.visible,
    document.defaultProvider,
  ];
}

function sameDocument(row, document) {
  return row.google_maps_enabled === document.providers.google_maps.enabled &&
    row.google_maps_visible === document.providers.google_maps.visible &&
    row.apple_maps_enabled === document.providers.apple_maps.enabled &&
    row.apple_maps_visible === document.providers.apple_maps.visible &&
    row.waze_enabled === document.providers.waze.enabled &&
    row.waze_visible === document.providers.waze.visible &&
    row.default_provider === document.defaultProvider;
}

function conflict() {
  return new MapPreferenceError(
    409,
    'MAP_PREFERENCES_VERSION_CONFLICT',
    'Map preferences changed; reload and try again.'
  );
}

function permission() {
  return new MapPreferenceError(
    403,
    'MAP_PREFERENCES_PERMISSION_REQUIRED',
    'Active map preference authority is unavailable.'
  );
}

class MapPreferencesRepository {
  constructor(pool, options = {}) {
    this.explicitPool = Boolean(pool);
    this.pool = pool || db.getPool();
    this.projector = typeof options.projector === 'function'
      ? options.projector
      : projectMapPreferences;
  }

  requirePool() {
    if (!this.pool || (!this.explicitPool && !db.isAvailable())) {
      throw new MapPreferencePersistenceError('PostgreSQL map preference authority is unavailable');
    }
    return this.pool;
  }

  async transaction(work) {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // Preserve the authoritative operation failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async membership(client, organizationId, userId, allowedRoles) {
    const result = await client.query(
      `SELECT role, status
         FROM organization_memberships
        WHERE organization_id = $1 AND user_id = $2
        FOR SHARE`,
      [organizationId, userId]
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active' || !allowedRoles.includes(row.role)) throw permission();
    return row;
  }

  async read(organizationId, userId) {
    try {
      const result = await this.requirePool().query(
        `SELECT organization_preferences.*,
                user_preferences.mode AS user_mode,
                user_preferences.google_maps_enabled AS user_google_maps_enabled,
                user_preferences.google_maps_visible AS user_google_maps_visible,
                user_preferences.apple_maps_enabled AS user_apple_maps_enabled,
                user_preferences.apple_maps_visible AS user_apple_maps_visible,
                user_preferences.waze_enabled AS user_waze_enabled,
                user_preferences.waze_visible AS user_waze_visible,
                user_preferences.default_provider AS user_default_provider,
                user_preferences.version AS user_version,
                user_preferences.updated_by_user_id AS user_updated_by_user_id,
                user_preferences.created_at AS user_created_at,
                user_preferences.updated_at AS user_updated_at
           FROM organization_map_preferences organization_preferences
           LEFT JOIN user_map_preferences user_preferences
             ON user_preferences.organization_id = organization_preferences.organization_id
            AND user_preferences.user_id = $2
          WHERE organization_preferences.organization_id = $1`,
        [organizationId, userId]
      );
      if (result.rows.length !== 1) {
        throw new MapPreferencePersistenceError('Canonical organization map preference row is unavailable');
      }
      const row = result.rows[0];
      const user = row.user_mode === null ? null : {
        mode: row.user_mode,
        google_maps_enabled: row.user_google_maps_enabled,
        google_maps_visible: row.user_google_maps_visible,
        apple_maps_enabled: row.user_apple_maps_enabled,
        apple_maps_visible: row.user_apple_maps_visible,
        waze_enabled: row.user_waze_enabled,
        waze_visible: row.user_waze_visible,
        default_provider: row.user_default_provider,
        version: row.user_version,
        updated_by_user_id: row.user_updated_by_user_id,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at,
      };
      return { organization: row, user };
    } catch (error) {
      if (error instanceof MapPreferenceError || error instanceof MapPreferencePersistenceError) throw error;
      throw new MapPreferencePersistenceError('PostgreSQL map preference read failed', error);
    }
  }

  async updateOrganization(input) {
    try {
      return await this.transaction(async client => {
        const membership = await this.membership(
          client,
          input.organizationId,
          input.actorUserId,
          ['owner', 'admin']
        );
        const current = await client.query(
          `SELECT * FROM organization_map_preferences
            WHERE organization_id = $1
            FOR UPDATE`,
          [input.organizationId]
        );
        const row = current.rows[0];
        if (!row) throw new MapPreferencePersistenceError('Canonical organization map preference row is unavailable');
        if (Number(row.version) !== input.expectedVersion) throw conflict();
        const changed = !sameDocument(row, input.preferences);
        let organization = row;
        if (changed) {
          const values = preferenceValues(input.preferences);
          const updated = await client.query(
            `UPDATE organization_map_preferences
                SET google_maps_enabled = $2,
                    google_maps_visible = $3,
                    apple_maps_enabled = $4,
                    apple_maps_visible = $5,
                    waze_enabled = $6,
                    waze_visible = $7,
                    default_provider = $8,
                    version = version + 1,
                    authority_source = 'user',
                    updated_by_user_id = $9,
                    updated_at = NOW()
              WHERE organization_id = $1 AND version = $10
              RETURNING *`,
            [input.organizationId, ...values, input.actorUserId, input.expectedVersion]
          );
          if (updated.rowCount !== 1) throw conflict();
          organization = updated.rows[0];
        }
        const user = await client.query(
          `SELECT * FROM user_map_preferences
            WHERE organization_id = $1 AND user_id = $2
            FOR SHARE`,
          [input.organizationId, input.actorUserId]
        );
        const data = await this.projector({
          organization,
          user: user.rows[0] || null,
          role: membership.role,
        });
        return { changed, data };
      });
    } catch (error) {
      if (error instanceof MapPreferenceError || error instanceof MapPreferencePersistenceError) throw error;
      throw new MapPreferencePersistenceError('PostgreSQL organization map preference write failed', error);
    }
  }

  async updateUser(input) {
    try {
      return await this.transaction(async client => {
        const membership = await this.membership(
          client,
          input.organizationId,
          input.actorUserId,
          ['owner', 'admin', 'member', 'viewer']
        );
        const authority = await client.query(
          'SELECT * FROM organization_map_preferences WHERE organization_id = $1 FOR SHARE',
          [input.organizationId]
        );
        if (authority.rows.length !== 1) {
          throw new MapPreferencePersistenceError('Canonical organization map preference row is unavailable');
        }
        const current = await client.query(
          `SELECT * FROM user_map_preferences
            WHERE organization_id = $1 AND user_id = $2
            FOR UPDATE`,
          [input.organizationId, input.actorUserId]
        );
        const row = current.rows[0];
        let changed = false;
        let user = row || null;
        if (!row) {
          if (input.expectedVersion !== 0) throw conflict();
          if (input.mode === 'override') {
            const values = preferenceValues(input.preferences);
            const inserted = await client.query(
              `INSERT INTO user_map_preferences (
                 organization_id, user_id, mode,
                 google_maps_enabled, google_maps_visible,
                 apple_maps_enabled, apple_maps_visible,
                 waze_enabled, waze_visible, default_provider,
                 updated_by_user_id
               ) VALUES ($1,$2,'override',$3,$4,$5,$6,$7,$8,$9,$2)
               ON CONFLICT (organization_id, user_id) DO NOTHING
               RETURNING *`,
              [input.organizationId, input.actorUserId, ...values]
            );
            if (inserted.rowCount !== 1) throw conflict();
            changed = true;
            user = inserted.rows[0];
          }
        } else {
          if (Number(row.version) !== input.expectedVersion) throw conflict();
          const noOp = input.mode === 'inherit'
            ? row.mode === 'inherit'
            : row.mode === 'override' && sameDocument(row, input.preferences);
          if (!noOp) {
            const values = input.mode === 'override'
              ? preferenceValues(input.preferences)
              : [null, null, null, null, null, null, null];
            const updated = await client.query(
              `UPDATE user_map_preferences
                  SET mode = $3,
                      google_maps_enabled = $4,
                      google_maps_visible = $5,
                      apple_maps_enabled = $6,
                      apple_maps_visible = $7,
                      waze_enabled = $8,
                      waze_visible = $9,
                      default_provider = $10,
                      version = version + 1,
                      updated_by_user_id = $2,
                      updated_at = NOW()
                WHERE organization_id = $1 AND user_id = $2 AND version = $11
                RETURNING *`,
              [input.organizationId, input.actorUserId, input.mode, ...values, input.expectedVersion]
            );
            if (updated.rowCount !== 1) throw conflict();
            changed = true;
            user = updated.rows[0];
          }
        }
        const data = await this.projector({
          organization: authority.rows[0],
          user,
          role: membership.role,
        });
        return { changed, data };
      });
    } catch (error) {
      if (error instanceof MapPreferenceError || error instanceof MapPreferencePersistenceError) throw error;
      throw new MapPreferencePersistenceError('PostgreSQL user map preference write failed', error);
    }
  }
}

module.exports = { MapPreferencePersistenceError, MapPreferencesRepository };
