'use strict';

const db = require('../db');

class WorkforcePersistenceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'WorkforcePersistenceError';
    this.cause = cause;
  }
}

function workforceError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function rows(result) {
  return result && Array.isArray(result.rows) ? result.rows : [];
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class WorkforceRepository {
  constructor(pool) {
    this.explicitPool = Boolean(pool);
    this.pool = pool || db.getPool();
  }

  requirePool() {
    if (!this.pool || (!this.explicitPool && !db.isAvailable())) {
      throw new WorkforcePersistenceError('PostgreSQL workforce authority is unavailable');
    }
    return this.pool;
  }

  async transaction(work) {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* Preserve the original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async lockOrganization(client, organizationId) {
    const result = await client.query(
      'SELECT id, name FROM organizations WHERE id = $1 FOR UPDATE',
      [organizationId]
    );
    if (result.rows.length !== 1) throw workforceError(404, 'organization_not_found', 'Organization not found');
    return result.rows[0];
  }

  async requireActor(client, organizationId, userId, roles) {
    const result = await client.query(
      `SELECT id, role, status
         FROM organization_memberships
        WHERE organization_id = $1 AND user_id = $2
        FOR SHARE`,
      [organizationId, userId]
    );
    const actor = result.rows[0];
    if (!actor || actor.status !== 'active' || !roles.includes(actor.role)) {
      throw workforceError(403, 'workforce_permission_required', 'Workforce permission is unavailable');
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
      throw workforceError(409, 'business_profile_required', 'An active Business Profile is required');
    }
    const row = result.rows[0];
    const raw = row.raw_profile && typeof row.raw_profile === 'object' ? row.raw_profile : {};
    const locations = [{ id: 'headquarters', name: 'Headquarters' }];
    const offices = raw.headquarters && Array.isArray(raw.headquarters.additionalOffices)
      ? raw.headquarters.additionalOffices : [];
    for (const office of offices) {
      if (!office || typeof office.id !== 'string') continue;
      locations.push({ id: office.id, name: typeof office.name === 'string' && office.name ? office.name : office.id });
    }
    const services = Array.isArray(raw.services) ? raw.services.reduce((resultList, service) => {
      if (service && typeof service.id === 'string') {
        resultList.push({ id: service.id, name: typeof service.name === 'string' && service.name ? service.name : service.id });
      }
      return resultList;
    }, []) : [];
    return {
      id: row.id,
      version: row.version_label,
      hash: row.normalized_profile_hash,
      locations,
      services,
      locationIds: new Set(locations.map(location => location.id.toLowerCase())),
      serviceIds: new Set(services.map(service => service.id.toLowerCase())),
      policies: clone(raw.workforce && Array.isArray(raw.workforce.policies) ? raw.workforce.policies : []),
    };
  }

  validateLocation(references, locationId) {
    if (locationId !== null && !references.locationIds.has(locationId.toLowerCase())) {
      throw workforceError(400, 'invalid_workforce_location', 'Workforce location is not in the active Business Profile');
    }
  }

  validateService(references, serviceId) {
    if (serviceId !== null && !references.serviceIds.has(serviceId.toLowerCase())) {
      throw workforceError(400, 'invalid_workforce_service', 'Workforce service is not in the active Business Profile');
    }
  }

  async insertAudit(client, input) {
    await client.query(
      `INSERT INTO workforce_audit_events
        (organization_id, actor_user_id, action, subject_type, subject_id, details)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [input.organizationId, input.actorUserId, input.action, input.subjectType,
        input.subjectId, JSON.stringify(input.details || {})]
    );
  }

  async snapshot(organizationId) {
    const pool = this.requirePool();
    const [memberResult, skillResult, profileSkillResult, crewResult, crewMemberResult, profileResult] = await Promise.all([
      pool.query(
        `SELECT profile.id AS profile_id,
                membership.id AS membership_id,
                membership.role AS access_role,
                membership.status AS membership_status,
                account.id AS user_id,
                account.name,
                account.email,
                account.phone,
                account.status AS user_status,
                profile.operational_role,
                profile.home_location_id,
                profile.created_at,
                profile.updated_at
           FROM workforce_profiles profile
           JOIN organization_memberships membership
             ON membership.organization_id = profile.organization_id
            AND membership.id = profile.membership_id
           JOIN users account
             ON account.organization_id = membership.organization_id
            AND account.id = membership.user_id
          WHERE profile.organization_id = $1
          ORDER BY lower(account.name), profile.id`,
        [organizationId]
      ),
      pool.query(
        `SELECT id, skill_key, name, description, service_id, created_at, updated_at
           FROM workforce_skills
          WHERE organization_id = $1
          ORDER BY lower(name), id`,
        [organizationId]
      ),
      pool.query(
        `SELECT profile_id, skill_id
           FROM workforce_profile_skills
          WHERE organization_id = $1
          ORDER BY profile_id, skill_id`,
        [organizationId]
      ),
      pool.query(
        `SELECT id, crew_key, name, home_location_id, created_at, updated_at
           FROM workforce_crews
          WHERE organization_id = $1
          ORDER BY lower(name), id`,
        [organizationId]
      ),
      pool.query(
        `SELECT crew_id, profile_id, crew_role
           FROM workforce_crew_members
          WHERE organization_id = $1
          ORDER BY crew_id, crew_role, profile_id`,
        [organizationId]
      ),
      pool.query(
        `SELECT id, version_label, normalized_profile_hash, raw_profile
           FROM canonical_business_profiles
          WHERE organization_id = $1 AND is_active = TRUE`,
        [organizationId]
      ),
    ]);

    if (profileResult.rows.length !== 1) {
      throw workforceError(409, 'business_profile_required', 'An active Business Profile is required');
    }
    const raw = profileResult.rows[0].raw_profile || {};
    const locations = [{ id: 'headquarters', name: 'Headquarters' }];
    const offices = raw.headquarters && Array.isArray(raw.headquarters.additionalOffices)
      ? raw.headquarters.additionalOffices : [];
    for (const office of offices) {
      if (office && typeof office.id === 'string') {
        locations.push({ id: office.id, name: typeof office.name === 'string' && office.name ? office.name : office.id });
      }
    }
    const services = Array.isArray(raw.services) ? raw.services.reduce((list, service) => {
      if (service && typeof service.id === 'string') {
        list.push({ id: service.id, name: typeof service.name === 'string' && service.name ? service.name : service.id });
      }
      return list;
    }, []) : [];
    const skillsByProfile = new Map();
    for (const relation of profileSkillResult.rows) {
      if (!skillsByProfile.has(relation.profile_id)) skillsByProfile.set(relation.profile_id, []);
      skillsByProfile.get(relation.profile_id).push(relation.skill_id);
    }
    const crewsByProfile = new Map();
    for (const relation of crewMemberResult.rows) {
      if (!crewsByProfile.has(relation.profile_id)) crewsByProfile.set(relation.profile_id, []);
      crewsByProfile.get(relation.profile_id).push({ id: relation.crew_id, role: relation.crew_role });
    }
    const membersByCrew = new Map();
    for (const relation of crewMemberResult.rows) {
      if (!membersByCrew.has(relation.crew_id)) membersByCrew.set(relation.crew_id, []);
      membersByCrew.get(relation.crew_id).push({ profileId: relation.profile_id, role: relation.crew_role });
    }
    return {
      members: memberResult.rows.map(member => ({
        profileId: member.profile_id,
        membershipId: member.membership_id,
        userId: member.user_id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        userStatus: member.user_status,
        accessRole: member.access_role,
        membershipStatus: member.membership_status,
        operationalRole: member.operational_role,
        homeLocationId: member.home_location_id,
        skillIds: skillsByProfile.get(member.profile_id) || [],
        crews: crewsByProfile.get(member.profile_id) || [],
        createdAt: member.created_at,
        updatedAt: member.updated_at,
      })),
      skills: skillResult.rows.map(skill => ({
        id: skill.id,
        key: skill.skill_key,
        name: skill.name,
        description: skill.description,
        serviceId: skill.service_id,
        createdAt: skill.created_at,
        updatedAt: skill.updated_at,
      })),
      crews: crewResult.rows.map(crew => ({
        id: crew.id,
        key: crew.crew_key,
        name: crew.name,
        homeLocationId: crew.home_location_id,
        members: membersByCrew.get(crew.id) || [],
        createdAt: crew.created_at,
        updatedAt: crew.updated_at,
      })),
      locations,
      services,
      policies: clone(raw.workforce && Array.isArray(raw.workforce.policies) ? raw.workforce.policies : []),
      businessProfile: {
        id: profileResult.rows[0].id,
        version: profileResult.rows[0].version_label,
        hash: profileResult.rows[0].normalized_profile_hash,
      },
    };
  }

  async createInvitation(input) {
    return this.transaction(async client => {
      const organization = await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner']);
      const references = await this.profileReferences(client, input.organizationId);
      this.validateLocation(references, input.homeLocationId);
      if (input.skillIds.length) {
        const skills = await client.query(
          `SELECT id FROM workforce_skills
            WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
          [input.organizationId, input.skillIds]
        );
        if (skills.rows.length !== input.skillIds.length) {
          throw workforceError(400, 'invalid_workforce_skill', 'A selected skill is unavailable');
        }
      }
      await client.query(
        `INSERT INTO users
          (id, organization_id, name, email, email_normalized, password_hash, phone, role, status)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'pending_verification')`,
        [input.userId, input.organizationId, input.name, input.email, input.passwordHash,
          input.phone, input.accessRole]
      );
      await client.query(
        `INSERT INTO organization_memberships
          (id, organization_id, user_id, role, status)
         VALUES ($1,$2,$3,$4,'invited')`,
        [input.membershipId, input.organizationId, input.userId, input.accessRole]
      );
      const profile = await client.query(
        `UPDATE workforce_profiles
            SET operational_role = $3,
                home_location_id = $4,
                created_by_user_id = $5,
                updated_by_user_id = $5,
                updated_at = NOW()
          WHERE organization_id = $1 AND membership_id = $2 AND id = $2
          RETURNING id`,
        [input.organizationId, input.membershipId, input.operationalRole,
          input.homeLocationId, input.actorUserId]
      );
      if (profile.rows.length !== 1 || profile.rows[0].id !== input.profileId) {
        throw new Error('Workforce invitation profile authority was not created');
      }
      for (const skillId of input.skillIds) {
        await client.query(
          `INSERT INTO workforce_profile_skills
            (organization_id, profile_id, skill_id, created_by_user_id)
           VALUES ($1,$2,$3,$4)`,
          [input.organizationId, input.profileId, skillId, input.actorUserId]
        );
      }
      await client.query(
        `INSERT INTO account_action_tokens
          (id, user_id, organization_id, purpose, token_hash, expires_at)
         VALUES ($1,$2,$3,'membership_invitation',$4,NOW() + INTERVAL '72 hours')`,
        [input.tokenId, input.userId, input.organizationId, input.tokenHash]
      );
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'member_invited',
        subjectType: 'membership',
        subjectId: input.membershipId,
        details: { accessRole: input.accessRole, operationalRole: input.operationalRole },
      });
      return {
        organizationName: organization.name,
        userId: input.userId,
        membershipId: input.membershipId,
        profileId: input.profileId,
        name: input.name,
        email: input.email,
      };
    });
  }

  async replaceInvitation(input) {
    return this.transaction(async client => {
      const organization = await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner']);
      const target = await client.query(
        `SELECT membership.id AS membership_id, account.id AS user_id, account.name, account.email,
                account.status AS user_status, membership.status AS membership_status
           FROM organization_memberships membership
           JOIN users account ON account.id = membership.user_id
          WHERE membership.organization_id = $1 AND membership.id = $2
          FOR UPDATE OF membership, account`,
        [input.organizationId, input.membershipId]
      );
      const row = target.rows[0];
      if (!row || row.membership_status !== 'invited' || row.user_status !== 'pending_verification') {
        throw workforceError(409, 'invitation_not_pending', 'The workforce invitation is not pending');
      }
      const prior = await client.query(
        `SELECT id FROM account_action_tokens
          WHERE user_id = $1 AND purpose = 'membership_invitation'
            AND consumed_at IS NULL AND revoked_at IS NULL
          FOR UPDATE`,
        [row.user_id]
      );
      await client.query(
        `UPDATE account_action_tokens
            SET revoked_at = NOW(), superseded_by_token_id = $2
          WHERE user_id = $1 AND purpose = 'membership_invitation'
            AND consumed_at IS NULL AND revoked_at IS NULL`,
        [row.user_id, input.tokenId]
      );
      await client.query(
        `INSERT INTO account_action_tokens
          (id, user_id, organization_id, purpose, token_hash, expires_at)
         VALUES ($1,$2,$3,'membership_invitation',$4,NOW() + INTERVAL '72 hours')`,
        [input.tokenId, row.user_id, input.organizationId, input.tokenHash]
      );
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'invitation_resent',
        subjectType: 'membership',
        subjectId: row.membership_id,
        details: { superseded: prior.rows.length },
      });
      return {
        organizationName: organization.name,
        membershipId: row.membership_id,
        userId: row.user_id,
        name: row.name,
        email: row.email,
        superseded: prior.rows.length,
      };
    });
  }

  async acceptInvitation(input) {
    return this.transaction(async client => {
      const result = await client.query(
        `SELECT token.id AS token_id, token.user_id, token.organization_id,
                token.expires_at > NOW() AS token_valid,
                account.status AS user_status,
                membership.id AS membership_id,
                membership.status AS membership_status
           FROM account_action_tokens token
           JOIN users account
             ON account.id = token.user_id AND account.organization_id = token.organization_id
           JOIN organization_memberships membership
             ON membership.user_id = token.user_id AND membership.organization_id = token.organization_id
          WHERE token.token_hash = $1
            AND token.consumed_at IS NULL
            AND token.revoked_at IS NULL
          FOR UPDATE OF token, account, membership`,
        [input.tokenHash]
      );
      const row = result.rows[0];
      if (!row || row.token_valid !== true || row.user_status !== 'pending_verification' ||
          row.membership_status !== 'invited') return null;
      await client.query(
        `UPDATE users
            SET password_hash = $2, status = 'active', updated_at = NOW()
          WHERE id = $1`,
        [row.user_id, input.passwordHash]
      );
      await client.query(
        `UPDATE organization_memberships
            SET status = 'active', updated_at = NOW()
          WHERE id = $1 AND status = 'invited'`,
        [row.membership_id]
      );
      await client.query(
        `UPDATE account_action_tokens
            SET consumed_at = NOW()
          WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [row.token_id]
      );
      await this.insertAudit(client, {
        organizationId: row.organization_id,
        actorUserId: row.user_id,
        action: 'invitation_accepted',
        subjectType: 'membership',
        subjectId: row.membership_id,
        details: {},
      });
      return { userId: row.user_id, organizationId: row.organization_id, membershipId: row.membership_id };
    });
  }

  async updateMemberAccess(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner']);
      const target = await client.query(
        `SELECT membership.id, membership.user_id, membership.role, membership.status,
                account.status AS user_status
           FROM organization_memberships membership
           JOIN users account ON account.id = membership.user_id
          WHERE membership.organization_id = $1 AND membership.id = $2
          FOR UPDATE OF membership, account`,
        [input.organizationId, input.membershipId]
      );
      const row = target.rows[0];
      if (!row) throw workforceError(404, 'workforce_member_not_found', 'Workforce member not found');
      if (row.role === 'owner' || row.user_id === input.actorUserId) {
        throw workforceError(409, 'owner_access_immutable', 'Owner access cannot be changed here');
      }
      if (row.status === 'revoked') {
        throw workforceError(409, 'membership_revoked', 'A revoked membership cannot be restored');
      }
      if (row.status === 'invited' && input.membershipStatus !== 'invited' && input.membershipStatus !== 'revoked') {
        throw workforceError(409, 'invitation_acceptance_required', 'Invited access must be accepted by the invited person');
      }
      if (row.status !== 'invited' && input.membershipStatus === 'invited') {
        throw workforceError(409, 'invalid_membership_transition', 'An existing membership cannot become an invitation');
      }
      const accessRole = input.accessRole || row.role;
      const membershipStatus = input.membershipStatus || row.status;
      const userStatus = membershipStatus === 'active' ? 'active'
        : membershipStatus === 'suspended' ? 'suspended'
          : membershipStatus === 'revoked' ? 'disabled' : 'pending_verification';
      if (accessRole === row.role && membershipStatus === row.status) {
        return {
          membershipId: row.id,
          accessRole,
          membershipStatus,
          userStatus: row.user_status,
          changed: false,
        };
      }
      await client.query(
        `UPDATE organization_memberships
            SET role = $2::varchar,
                status = $3::varchar,
                revoked_at = CASE WHEN $3::varchar = 'revoked' THEN NOW() ELSE NULL END,
                updated_at = NOW()
          WHERE id = $1`,
        [row.id, accessRole, membershipStatus]
      );
      await client.query(
        `UPDATE users SET role = $2, status = $3, updated_at = NOW() WHERE id = $1`,
        [row.user_id, accessRole, userStatus]
      );
      await client.query(
        `UPDATE auth_sessions
            SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'workforce_access_changed'
          WHERE user_id = $1 AND status = 'active'`,
        [row.user_id]
      );
      await client.query(
        `UPDATE auth_refresh_tokens token
            SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'workforce_access_changed'
           FROM auth_sessions session
          WHERE token.session_id = session.id AND session.user_id = $1 AND token.status = 'active'`,
        [row.user_id]
      );
      if (membershipStatus === 'revoked') {
        await client.query(
          `UPDATE account_action_tokens
              SET revoked_at = NOW()
            WHERE user_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
          [row.user_id]
        );
      }
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'member_access_updated',
        subjectType: 'membership',
        subjectId: row.id,
        details: {
          fromRole: row.role,
          toRole: accessRole,
          fromStatus: row.status,
          toStatus: membershipStatus,
        },
      });
      return { membershipId: row.id, accessRole, membershipStatus, userStatus, changed: true };
    });
  }

  async updateMemberProfile(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      this.validateLocation(references, input.homeLocationId);
      const profileResult = await client.query(
        `SELECT id FROM workforce_profiles
          WHERE organization_id = $1 AND id = $2
          FOR UPDATE`,
        [input.organizationId, input.profileId]
      );
      if (profileResult.rows.length !== 1) throw workforceError(404, 'workforce_member_not_found', 'Workforce member not found');
      if (input.skillIds.length) {
        const skills = await client.query(
          `SELECT id FROM workforce_skills
            WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
          [input.organizationId, input.skillIds]
        );
        if (skills.rows.length !== input.skillIds.length) {
          throw workforceError(400, 'invalid_workforce_skill', 'A selected skill is unavailable');
        }
      }
      await client.query(
        `UPDATE workforce_profiles
            SET operational_role = $3, home_location_id = $4,
                updated_by_user_id = $5, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2`,
        [input.organizationId, input.profileId, input.operationalRole,
          input.homeLocationId, input.actorUserId]
      );
      await client.query(
        `DELETE FROM workforce_profile_skills
          WHERE organization_id = $1 AND profile_id = $2
            AND NOT (skill_id = ANY($3::uuid[]))`,
        [input.organizationId, input.profileId, input.skillIds]
      );
      for (const skillId of input.skillIds) {
        await client.query(
          `INSERT INTO workforce_profile_skills
            (organization_id, profile_id, skill_id, created_by_user_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (organization_id, profile_id, skill_id) DO NOTHING`,
          [input.organizationId, input.profileId, skillId, input.actorUserId]
        );
      }
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'member_profile_updated',
        subjectType: 'profile',
        subjectId: input.profileId,
        details: { operationalRole: input.operationalRole, homeLocationId: input.homeLocationId, skillIds: input.skillIds },
      });
      return { profileId: input.profileId };
    });
  }

  async createSkill(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      this.validateService(references, input.serviceId);
      const result = await client.query(
        `INSERT INTO workforce_skills
          (id, organization_id, skill_key, name, description, service_id,
           created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         RETURNING id`,
        [input.skillId, input.organizationId, input.key, input.name,
          input.description, input.serviceId, input.actorUserId]
      );
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'skill_created',
        subjectType: 'skill',
        subjectId: result.rows[0].id,
        details: { key: input.key, serviceId: input.serviceId },
      });
      return { id: result.rows[0].id };
    });
  }

  async updateSkill(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      this.validateService(references, input.serviceId);
      const result = await client.query(
        `UPDATE workforce_skills
            SET name = $3, description = $4, service_id = $5,
                updated_by_user_id = $6, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2
          RETURNING id, skill_key`,
        [input.organizationId, input.skillId, input.name, input.description,
          input.serviceId, input.actorUserId]
      );
      if (result.rows.length !== 1) throw workforceError(404, 'workforce_skill_not_found', 'Workforce skill not found');
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'skill_updated',
        subjectType: 'skill',
        subjectId: input.skillId,
        details: { key: result.rows[0].skill_key, serviceId: input.serviceId },
      });
      return { id: input.skillId };
    });
  }

  async replaceCrewMembers(client, input) {
    if (input.members.length) {
      const profiles = await client.query(
        `SELECT id FROM workforce_profiles
          WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [input.organizationId, input.members.map(member => member.profileId)]
      );
      if (profiles.rows.length !== input.members.length) {
        throw workforceError(400, 'invalid_workforce_member', 'A selected crew member is unavailable');
      }
    }
    await client.query(
      `DELETE FROM workforce_crew_members
        WHERE organization_id = $1 AND crew_id = $2`,
      [input.organizationId, input.crewId]
    );
    for (const member of input.members) {
      await client.query(
        `INSERT INTO workforce_crew_members
          (organization_id, crew_id, profile_id, crew_role, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [input.organizationId, input.crewId, member.profileId, member.role, input.actorUserId]
      );
    }
  }

  async createCrew(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      this.validateLocation(references, input.homeLocationId);
      await client.query(
        `INSERT INTO workforce_crews
          (id, organization_id, crew_key, name, home_location_id,
           created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [input.crewId, input.organizationId, input.key, input.name,
          input.homeLocationId, input.actorUserId]
      );
      await this.replaceCrewMembers(client, input);
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'crew_created',
        subjectType: 'crew',
        subjectId: input.crewId,
        details: { key: input.key, homeLocationId: input.homeLocationId, members: input.members },
      });
      return { id: input.crewId };
    });
  }

  async updateCrew(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      this.validateLocation(references, input.homeLocationId);
      const result = await client.query(
        `UPDATE workforce_crews
            SET name = $3, home_location_id = $4,
                updated_by_user_id = $5, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2
          RETURNING id, crew_key`,
        [input.organizationId, input.crewId, input.name, input.homeLocationId, input.actorUserId]
      );
      if (result.rows.length !== 1) throw workforceError(404, 'workforce_crew_not_found', 'Workforce crew not found');
      await this.replaceCrewMembers(client, input);
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'crew_updated',
        subjectType: 'crew',
        subjectId: input.crewId,
        details: { key: result.rows[0].crew_key, homeLocationId: input.homeLocationId, members: input.members },
      });
      return { id: input.crewId };
    });
  }
}

module.exports = {
  WorkforcePersistenceError,
  WorkforceRepository,
  workforceError,
};
