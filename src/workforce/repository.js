'use strict';

const db = require('../db');
const { workforceInvitationEnvelope } = require('../email/transactional');

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
      policies: clone(raw.workforce && Array.isArray(raw.workforce.policies) ? raw.workforce.policies : []),
    };
  }

  canonicalReference(items, requestedId, invalidCode, ambiguousCode, label) {
    if (requestedId === null) return null;
    const matches = items.filter(item => item.id.toLowerCase() === requestedId.toLowerCase());
    if (matches.length === 0) {
      throw workforceError(400, invalidCode, `Workforce ${label} is not in the active Business Profile`);
    }
    if (matches.length !== 1) {
      throw workforceError(409, ambiguousCode, `Workforce ${label} is ambiguous in the active Business Profile`);
    }
    return matches[0].id;
  }

  canonicalLocation(references, locationId) {
    return this.canonicalReference(
      references.locations, locationId,
      'invalid_workforce_location', 'ambiguous_workforce_location', 'location'
    );
  }

  canonicalService(references, serviceId) {
    return this.canonicalReference(
      references.services, serviceId,
      'invalid_workforce_service', 'ambiguous_workforce_service', 'service'
    );
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

  async snapshot(organizationId, includeInvitations = false) {
    const pool = this.requirePool();
    const [memberResult, skillResult, profileSkillResult, crewResult, crewMemberResult, profileResult,
      invitationResult, invitationSkillResult] = await Promise.all([
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
      includeInvitations ? pool.query(
        `SELECT id, name, email, phone, access_role, operational_role, home_location_id,
                CASE WHEN token_expires_at <= NOW() THEN 'expired' ELSE status END AS invitation_status,
                token_expires_at, delivery_generation, created_at, updated_at
           FROM workforce_invitations
          WHERE organization_id = $1 AND status = 'pending'
          ORDER BY lower(name), id`,
        [organizationId]
      ) : Promise.resolve({ rows: [] }),
      includeInvitations ? pool.query(
        `SELECT relation.invitation_id, relation.skill_id
           FROM workforce_invitation_skills relation
           JOIN workforce_invitations invitation
             ON invitation.organization_id = relation.organization_id
            AND invitation.id = relation.invitation_id
          WHERE relation.organization_id = $1 AND invitation.status = 'pending'
          ORDER BY relation.invitation_id, relation.skill_id`,
        [organizationId]
      ) : Promise.resolve({ rows: [] }),
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
    const skillsByInvitation = new Map();
    for (const relation of invitationSkillResult.rows) {
      if (!skillsByInvitation.has(relation.invitation_id)) skillsByInvitation.set(relation.invitation_id, []);
      skillsByInvitation.get(relation.invitation_id).push(relation.skill_id);
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
      invitations: invitationResult.rows.map(invitation => ({
        invitationId: invitation.id,
        name: invitation.name,
        email: invitation.email,
        phone: invitation.phone,
        accessRole: invitation.access_role,
        operationalRole: invitation.operational_role,
        homeLocationId: invitation.home_location_id,
        skillIds: skillsByInvitation.get(invitation.id) || [],
        status: invitation.invitation_status,
        expiresAt: invitation.token_expires_at,
        deliveryGeneration: invitation.delivery_generation,
        createdAt: invitation.created_at,
        updatedAt: invitation.updated_at,
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
      try {
        workforceInvitationEnvelope(input.email, {
          name: input.name,
          organizationName: organization.name,
        });
      } catch (_error) {
        throw workforceError(
          409,
          'invitation_delivery_incompatible',
          'Organization invitation identity is incompatible with delivery'
        );
      }
      const references = await this.profileReferences(client, input.organizationId);
      const homeLocationId = this.canonicalLocation(references, input.homeLocationId);
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
      const existingTenantAccount = await client.query(
        `SELECT id FROM users
          WHERE organization_id = $1 AND email_normalized = $2
          LIMIT 1`,
        [input.organizationId, input.email]
      );
      if (existingTenantAccount.rows.length) {
        throw workforceError(409, 'workforce_identity_conflict', 'A workforce identity already exists');
      }
      await client.query(
        `INSERT INTO workforce_invitations
          (id, organization_id, name, email, email_normalized, phone, access_role,
           operational_role, home_location_id, token_hash, token_expires_at,
           created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,NOW() + INTERVAL '72 hours',$10,$10)`,
        [input.invitationId, input.organizationId, input.name, input.email, input.phone,
          input.accessRole, input.operationalRole, homeLocationId, input.tokenHash, input.actorUserId]
      );
      for (const skillId of input.skillIds) {
        await client.query(
          `INSERT INTO workforce_invitation_skills
            (organization_id, invitation_id, skill_id, created_by_user_id)
           VALUES ($1,$2,$3,$4)`,
          [input.organizationId, input.invitationId, skillId, input.actorUserId]
        );
      }
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'invitation_created',
        subjectType: 'invitation',
        subjectId: input.invitationId,
        details: { accessRole: input.accessRole, operationalRole: input.operationalRole },
      });
      return {
        organizationName: organization.name,
        invitationId: input.invitationId,
        name: input.name,
        email: input.email,
        status: 'pending',
      };
    });
  }

  async replaceInvitation(input) {
    return this.transaction(async client => {
      const organization = await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner']);
      const target = await client.query(
        `SELECT id, name, email, delivery_generation
           FROM workforce_invitations
          WHERE organization_id = $1 AND id = $2 AND status = 'pending'
          FOR UPDATE`,
        [input.organizationId, input.invitationId]
      );
      const row = target.rows[0];
      if (!row) {
        throw workforceError(409, 'invitation_not_pending', 'The workforce invitation is not pending');
      }
      try {
        workforceInvitationEnvelope(row.email, {
          name: row.name,
          organizationName: organization.name,
        });
      } catch (_error) {
        throw workforceError(
          409,
          'invitation_delivery_incompatible',
          'Organization invitation identity is incompatible with delivery'
        );
      }
      await client.query(
        `UPDATE workforce_invitations
            SET token_hash = $3,
                token_expires_at = NOW() + INTERVAL '72 hours',
                delivery_generation = delivery_generation + 1,
                updated_by_user_id = $4,
                updated_at = NOW()
          WHERE organization_id = $1 AND id = $2 AND status = 'pending'`,
        [input.organizationId, input.invitationId, input.tokenHash, input.actorUserId]
      );
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'invitation_resent',
        subjectType: 'invitation',
        subjectId: row.id,
        details: { fromGeneration: row.delivery_generation, toGeneration: row.delivery_generation + 1 },
      });
      return {
        organizationName: organization.name,
        invitationId: row.id,
        name: row.name,
        email: row.email,
        deliveryGeneration: row.delivery_generation + 1,
      };
    });
  }

  async revokeInvitation(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner']);
      const revoked = await client.query(
        `UPDATE workforce_invitations
            SET status = 'revoked', revoked_at = NOW(), revoked_by_user_id = $3,
                updated_by_user_id = $3, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2 AND status = 'pending'
          RETURNING id`,
        [input.organizationId, input.invitationId, input.actorUserId]
      );
      if (revoked.rows.length !== 1) {
        throw workforceError(409, 'invitation_not_pending', 'The workforce invitation is not pending');
      }
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'invitation_revoked',
        subjectType: 'invitation',
        subjectId: input.invitationId,
        details: {},
      });
      return { invitationId: input.invitationId, status: 'revoked' };
    });
  }

  async acceptInvitation(input) {
    return this.transaction(async client => {
      const candidate = await client.query(
        `SELECT id, organization_id
           FROM workforce_invitations
          WHERE token_hash = $1 AND status = 'pending'`,
        [input.tokenHash]
      );
      if (candidate.rows.length !== 1) return null;
      await this.lockOrganization(client, candidate.rows[0].organization_id);
      const result = await client.query(
        `SELECT id, organization_id, name, email, phone, access_role, operational_role,
                home_location_id, created_by_user_id, token_expires_at > NOW() AS token_valid
           FROM workforce_invitations
          WHERE id = $1 AND organization_id = $2 AND token_hash = $3 AND status = 'pending'
          FOR UPDATE`,
        [candidate.rows[0].id, candidate.rows[0].organization_id, input.tokenHash]
      );
      const row = result.rows[0];
      if (!row || row.token_valid !== true) return null;
      const references = await this.profileReferences(client, row.organization_id);
      let homeLocationId;
      try {
        homeLocationId = this.canonicalLocation(references, row.home_location_id);
      } catch (error) {
        if (error && [400, 409].includes(error.status)) return { outcome: 'unavailable' };
        throw error;
      }
      const invitationSkills = await client.query(
        `SELECT relation.skill_id
           FROM workforce_invitation_skills relation
           JOIN workforce_skills skill
             ON skill.organization_id = relation.organization_id AND skill.id = relation.skill_id
          WHERE relation.organization_id = $1 AND relation.invitation_id = $2
          ORDER BY relation.skill_id`,
        [row.organization_id, row.id]
      );
      const account = await client.query(
        `INSERT INTO users
          (id, organization_id, name, email, email_normalized, password_hash, phone, role, status)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'active')
         ON CONFLICT (email_normalized) DO NOTHING
         RETURNING id`,
        [input.userId, row.organization_id, row.name, row.email, input.passwordHash,
          row.phone, row.access_role]
      );
      if (account.rows.length !== 1) return { outcome: 'unavailable' };
      await client.query(
        `INSERT INTO organization_memberships
          (id, organization_id, user_id, role, status)
         VALUES ($1,$2,$3,$4,'active')`,
        [input.membershipId, row.organization_id, input.userId, row.access_role]
      );
      const profile = await client.query(
        `UPDATE workforce_profiles
            SET operational_role = $3, home_location_id = $4,
                created_by_user_id = $5, updated_by_user_id = $5, updated_at = NOW()
          WHERE organization_id = $1 AND membership_id = $2 AND id = $2
          RETURNING id`,
        [row.organization_id, input.membershipId, row.operational_role,
          homeLocationId, row.created_by_user_id]
      );
      if (profile.rows.length !== 1) throw new Error('Accepted workforce profile authority was not created');
      for (const skill of invitationSkills.rows) {
        await client.query(
          `INSERT INTO workforce_profile_skills
            (organization_id, profile_id, skill_id, created_by_user_id)
           VALUES ($1,$2,$3,$4)`,
          [row.organization_id, input.membershipId, skill.skill_id, row.created_by_user_id]
        );
      }
      await client.query(
        `UPDATE workforce_invitations
            SET status = 'accepted', accepted_membership_id = $2, accepted_at = NOW(),
                updated_by_user_id = $3, updated_at = NOW()
          WHERE id = $1 AND status = 'pending'`,
        [row.id, input.membershipId, input.userId]
      );
      await this.insertAudit(client, {
        organizationId: row.organization_id,
        actorUserId: input.userId,
        action: 'invitation_accepted',
        subjectType: 'invitation',
        subjectId: row.id,
        details: { membershipId: input.membershipId },
      });
      return {
        outcome: 'accepted',
        userId: input.userId,
        organizationId: row.organization_id,
        membershipId: input.membershipId,
      };
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
      const accessRole = input.accessRole || row.role;
      const membershipStatus = input.membershipStatus || row.status;
      const userStatus = membershipStatus === 'active' ? 'active'
        : membershipStatus === 'suspended' ? 'suspended'
          : 'disabled';
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
      const homeLocationId = this.canonicalLocation(references, input.homeLocationId);
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
          homeLocationId, input.actorUserId]
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
        details: { operationalRole: input.operationalRole, homeLocationId, skillIds: input.skillIds },
      });
      return { profileId: input.profileId };
    });
  }

  async createSkill(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      const serviceId = this.canonicalService(references, input.serviceId);
      const result = await client.query(
        `INSERT INTO workforce_skills
          (id, organization_id, skill_key, name, description, service_id,
           created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         RETURNING id`,
        [input.skillId, input.organizationId, input.key, input.name,
          input.description, serviceId, input.actorUserId]
      );
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'skill_created',
        subjectType: 'skill',
        subjectId: result.rows[0].id,
        details: { key: input.key, serviceId },
      });
      return { id: result.rows[0].id };
    });
  }

  async updateSkill(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      const serviceId = this.canonicalService(references, input.serviceId);
      const result = await client.query(
        `UPDATE workforce_skills
            SET name = $3, description = $4, service_id = $5,
                updated_by_user_id = $6, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2
          RETURNING id, skill_key`,
        [input.organizationId, input.skillId, input.name, input.description,
          serviceId, input.actorUserId]
      );
      if (result.rows.length !== 1) throw workforceError(404, 'workforce_skill_not_found', 'Workforce skill not found');
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'skill_updated',
        subjectType: 'skill',
        subjectId: input.skillId,
        details: { key: result.rows[0].skill_key, serviceId },
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
      const homeLocationId = this.canonicalLocation(references, input.homeLocationId);
      await client.query(
        `INSERT INTO workforce_crews
          (id, organization_id, crew_key, name, home_location_id,
           created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [input.crewId, input.organizationId, input.key, input.name,
          homeLocationId, input.actorUserId]
      );
      await this.replaceCrewMembers(client, input);
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'crew_created',
        subjectType: 'crew',
        subjectId: input.crewId,
        details: { key: input.key, homeLocationId, members: input.members },
      });
      return { id: input.crewId };
    });
  }

  async updateCrew(input) {
    return this.transaction(async client => {
      await this.lockOrganization(client, input.organizationId);
      await this.requireActor(client, input.organizationId, input.actorUserId, ['owner', 'admin']);
      const references = await this.profileReferences(client, input.organizationId);
      const homeLocationId = this.canonicalLocation(references, input.homeLocationId);
      const result = await client.query(
        `UPDATE workforce_crews
            SET name = $3, home_location_id = $4,
                updated_by_user_id = $5, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2
          RETURNING id, crew_key`,
        [input.organizationId, input.crewId, input.name, homeLocationId, input.actorUserId]
      );
      if (result.rows.length !== 1) throw workforceError(404, 'workforce_crew_not_found', 'Workforce crew not found');
      await this.replaceCrewMembers(client, input);
      await this.insertAudit(client, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'crew_updated',
        subjectType: 'crew',
        subjectId: input.crewId,
        details: { key: result.rows[0].crew_key, homeLocationId, members: input.members },
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
