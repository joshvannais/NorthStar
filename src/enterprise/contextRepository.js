'use strict';

const db = require('../db');
const { EnterpriseContextError, validatePrincipal, projectContext, resolveSelection } = require('./context');

class EnterpriseContextRepository {
  constructor(pool) { this.pool = pool || null; }

  async read(principal, selection) {
    validatePrincipal(principal);
    const pool = this.pool || (db.isAvailable() ? db.getPool() : null);
    if (!pool) throw new EnterpriseContextError(503, 'enterprise_context_unavailable');
    let client;
    try {
      client = await pool.connect();
      // One coherent, read-only MVCC snapshot. Revocations committed before this
      // snapshot deny; later changes are seen by the next request. This does not
      // reserve access, cancel work, or grant operations beyond this read.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await client.query(
        `SELECT session.id AS session_id, session.organization_id, session.status AS session_status,
                session.access_expires_at, session.refresh_expires_at, session.csrf_token_hash,
                session.revoked_at AS session_revoked_at,
                actor.id AS actor_user_id, actor.organization_id AS user_organization_id,
                actor.status AS user_status, membership.id AS membership_id,
                membership.role, membership.status AS membership_status,
                membership.revoked_at AS membership_revoked_at,
                to_char(actor.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS actor_version,
                to_char(membership.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS membership_version,
                to_char(session.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS session_created_version,
                to_char(session.access_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS access_version,
                to_char(session.refresh_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS refresh_version,
                profile.id AS profile_id, profile.version_label, profile.normalized_profile_hash, profile.raw_profile,
                clock_timestamp() AS observed_at
           FROM public.auth_sessions session
           JOIN public.users actor ON actor.id = session.user_id
           JOIN public.organization_memberships membership
             ON membership.id = session.membership_id AND membership.user_id = actor.id
            AND membership.organization_id = session.organization_id
           JOIN public.organizations company ON company.id = session.organization_id
           LEFT JOIN public.canonical_business_profiles profile
             ON profile.organization_id = company.id AND profile.is_active = TRUE
          WHERE session.id = $1 AND session.user_id = $2 AND session.organization_id = $3`,
        [principal.sessionId, principal.actorUserId, principal.organizationId]
      );
      if (result.rows.length !== 1) throw new EnterpriseContextError(403, 'enterprise_membership_required');
      const context = projectContext(result.rows[0], principal);
      const value = selection === undefined ? context : resolveSelection(context, selection);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { if (client) await client.query('ROLLBACK'); } catch (_rollbackError) { /* Preserve the first failure. */ }
      if (error instanceof EnterpriseContextError) throw error;
      throw new EnterpriseContextError(503, 'enterprise_context_unavailable');
    } finally {
      if (client) client.release();
    }
  }
}

module.exports = { EnterpriseContextRepository };
