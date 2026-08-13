'use strict';

const crypto = require('crypto');
const credentials = require('../auth/credentials');
const { AccountRepository } = require('../accounts/repository');
const { workforceInvitationEnvelope } = require('../email/transactional');
const safeLogger = require('../observability/safeLogger');
const {
  actionToken,
  hashPassword,
  normalizeEmail,
  tokenHash,
} = require('../accounts/service');
const { WorkforcePersistenceError, WorkforceRepository } = require('./repository');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const INVITATION_ACCESS_ROLES = new Set(['admin', 'member', 'viewer']);
const MUTABLE_ACCESS_ROLES = new Set(['admin', 'member', 'viewer']);
const OPERATIONAL_ROLES = new Set([
  'owner', 'administrator', 'dispatcher', 'estimator', 'crew_lead',
  'technician', 'accounting', 'employee', 'other',
]);
const MEMBERSHIP_STATUSES = new Set(['active', 'suspended', 'revoked']);

class WorkforceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'WorkforceError';
    this.status = status;
    this.code = code;
  }
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkforceError(400, code, 'Workforce request is invalid');
  }
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.has(key))) {
    throw new WorkforceError(400, code, 'Workforce request contains an unsupported field');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > 65536) throw new WorkforceError(400, code, 'Workforce request is too large');
  return value;
}

function rawText(value, maximumBytes, code, label, required = true, maximumCharacters = Infinity) {
  if (typeof value !== 'string') throw new WorkforceError(400, code, `${label} must be text`);
  if ((required && !value.trim()) || Buffer.byteLength(value, 'utf8') > maximumBytes ||
      Array.from(value).length > maximumCharacters ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new WorkforceError(400, code, `${label} is invalid`);
  }
  return value;
}

function optionalRawText(value, maximumBytes, code, label) {
  if (value === undefined || value === null) return '';
  return rawText(value, maximumBytes, code, label, false);
}

function nullableStableId(value, code, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !STABLE_KEY_PATTERN.test(value)) {
    throw new WorkforceError(400, code, `${label} is invalid`);
  }
  return value;
}

function stableKey(value, code, label) {
  if (typeof value !== 'string' || !STABLE_KEY_PATTERN.test(value)) {
    throw new WorkforceError(400, code, `${label} is invalid`);
  }
  return value.toLowerCase();
}

function uuid(value, code, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new WorkforceError(400, code, `${label} is invalid`);
  }
  return value.toLowerCase();
}

function uniqueUuidArray(value, code, label, maximum = 100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new WorkforceError(400, code, `${label} is invalid`);
  }
  const ids = value.map(item => uuid(item, code, label));
  if (new Set(ids).size !== ids.length) throw new WorkforceError(400, code, `${label} contains a duplicate`);
  return ids;
}

function operationalRole(value) {
  if (typeof value !== 'string' || !OPERATIONAL_ROLES.has(value)) {
    throw new WorkforceError(400, 'invalid_operational_role', 'Operational role is invalid');
  }
  return value;
}

function accessRole(value, allowedRoles = MUTABLE_ACCESS_ROLES) {
  if (typeof value !== 'string' || !allowedRoles.has(value)) {
    throw new WorkforceError(400, 'invalid_access_role', 'Access role is invalid');
  }
  return value;
}

function safeDeliveryFailure(error, requestId) {
  safeLogger.warn('email', 'notification_send_failed', {
    category: error && error.provider === 'resend' ? error.category : 'delivery_failed',
    requestId,
    statusCode: error && error.provider === 'resend' ? error.httpStatus : undefined,
  });
}

class WorkforceService {
  constructor(repository, options = {}) {
    this.repository = repository || new WorkforceRepository();
    this.accountRepository = options.accountRepository || new AccountRepository();
    this.transactionalEmail = options.transactionalEmail || null;
  }

  async consumeLimit(eventType, value, options) {
    const key = credentials.rateLimitKey(eventType, value || 'unknown');
    const state = await this.accountRepository.consumeRateLimit(eventType, key, options);
    if (!state.allowed) throw new WorkforceError(429, 'rate_limited', 'Too many requests. Try again later.');
  }

  async snapshot(organizationId, role) {
    return this.repository.snapshot(organizationId, role === 'owner');
  }

  parseInvitation(input) {
    const body = exactObject(input, new Set([
      'name', 'email', 'phone', 'accessRole', 'operationalRole', 'homeLocationId', 'skillIds',
    ]), 'invalid_workforce_invitation');
    const phone = optionalRawText(body.phone || '', 50, 'invalid_workforce_invitation', 'Phone');
    if (phone && !/^[+\d\s().-]+$/.test(phone)) {
      throw new WorkforceError(400, 'invalid_workforce_invitation', 'Phone is invalid');
    }
    const name = rawText(body.name, 480, 'invalid_workforce_invitation', 'Name', true, 120);
    const email = normalizeEmail(body.email);
    try {
      workforceInvitationEnvelope(email, { name });
    } catch (_error) {
      throw new WorkforceError(
        400,
        'invalid_workforce_invitation',
        'Invitation name or email is invalid'
      );
    }
    return {
      name,
      email,
      phone,
      accessRole: accessRole(body.accessRole, INVITATION_ACCESS_ROLES),
      operationalRole: operationalRole(body.operationalRole),
      homeLocationId: nullableStableId(body.homeLocationId, 'invalid_workforce_invitation', 'Home location'),
      skillIds: uniqueUuidArray(body.skillIds, 'invalid_workforce_invitation', 'Skill selection'),
    };
  }

  async invite(input, context) {
    if (!this.transactionalEmail || typeof this.transactionalEmail.invitation !== 'function') {
      throw new WorkforceError(503, 'invitation_delivery_unavailable', 'Workforce invitation delivery is unavailable');
    }
    await this.consumeLimit('workforce_invite_ip', context.requestIp, {
      limit: 20, windowSeconds: 3600, blockSeconds: 3600,
    });
    const parsed = this.parseInvitation(input);
    const invitation = actionToken();
    try {
      const created = await this.repository.createInvitation({
        ...parsed,
        invitationId: invitation.id,
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        tokenHash: invitation.tokenHash,
      });
      try {
        await this.transactionalEmail.invitation(
          created.email,
          invitation.rawToken,
          { deliveryId: invitation.id, requestId: context.requestId },
          { name: created.name, organizationName: created.organizationName }
        );
      } catch (error) {
        safeDeliveryFailure(error, context.requestId);
        throw new WorkforceError(
          503,
          'invitation_delivery_failed',
          'Invitation created, but delivery failed. Use resend after delivery is available.'
        );
      }
      return { ...created, delivery: 'accepted' };
    } catch (error) {
      if (error && error.code === '23505') {
        throw new WorkforceError(409, 'workforce_identity_conflict', 'A workforce identity already exists');
      }
      throw error;
    }
  }

  async resendInvitation(invitationId, context) {
    if (!this.transactionalEmail || typeof this.transactionalEmail.invitation !== 'function') {
      throw new WorkforceError(503, 'invitation_delivery_unavailable', 'Workforce invitation delivery is unavailable');
    }
    await this.consumeLimit('workforce_invite_ip', context.requestIp, {
      limit: 20, windowSeconds: 3600, blockSeconds: 3600,
    });
    const invitation = actionToken();
    const pending = await this.repository.replaceInvitation({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      invitationId: uuid(invitationId, 'invalid_workforce_invitation', 'Invitation'),
      tokenHash: invitation.tokenHash,
    });
    try {
      await this.transactionalEmail.invitation(
        pending.email,
        invitation.rawToken,
        { deliveryId: invitation.id, requestId: context.requestId },
        { name: pending.name, organizationName: pending.organizationName }
      );
    } catch (error) {
      safeDeliveryFailure(error, context.requestId);
      throw new WorkforceError(503, 'invitation_delivery_failed', 'Invitation delivery failed. Try again later.');
    }
    return { invitationId: pending.invitationId, delivery: 'accepted' };
  }

  async revokeInvitation(invitationId, context) {
    return this.repository.revokeInvitation({
      invitationId: uuid(invitationId, 'invalid_workforce_invitation', 'Invitation'),
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
  }

  async acceptInvitation(input, context) {
    const body = exactObject(input, new Set(['token', 'password']), 'invalid_invitation_acceptance');
    await this.consumeLimit('workforce_accept_ip', context.requestIp, {
      limit: 12, windowSeconds: 3600, blockSeconds: 3600,
    });
    const result = await this.repository.acceptInvitation({
      tokenHash: tokenHash(body.token),
      passwordHash: await hashPassword(body.password),
      userId: crypto.randomUUID(),
      membershipId: crypto.randomUUID(),
    });
    if (!result || result.outcome !== 'accepted') {
      throw new WorkforceError(400, 'invitation_invalid', 'The workforce invitation is invalid or expired');
    }
    const { outcome: _outcome, ...accepted } = result;
    return accepted;
  }

  async updateAccess(membershipId, input, context) {
    const body = exactObject(input, new Set(['accessRole', 'membershipStatus']), 'invalid_workforce_access');
    if (!Object.prototype.hasOwnProperty.call(body, 'accessRole') &&
        !Object.prototype.hasOwnProperty.call(body, 'membershipStatus')) {
      throw new WorkforceError(400, 'invalid_workforce_access', 'An access change is required');
    }
    let role = null;
    let status = null;
    if (Object.prototype.hasOwnProperty.call(body, 'accessRole')) role = accessRole(body.accessRole);
    if (Object.prototype.hasOwnProperty.call(body, 'membershipStatus')) {
      if (typeof body.membershipStatus !== 'string' || !MEMBERSHIP_STATUSES.has(body.membershipStatus)) {
        throw new WorkforceError(400, 'invalid_membership_status', 'Membership status is invalid');
      }
      status = body.membershipStatus;
    }
    return this.repository.updateMemberAccess({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      membershipId: uuid(membershipId, 'invalid_workforce_member', 'Membership'),
      accessRole: role,
      membershipStatus: status,
    });
  }

  async updateProfile(profileId, input, context) {
    const body = exactObject(input, new Set(['operationalRole', 'homeLocationId', 'skillIds']), 'invalid_workforce_profile');
    return this.repository.updateMemberProfile({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      profileId: uuid(profileId, 'invalid_workforce_member', 'Workforce profile'),
      operationalRole: operationalRole(body.operationalRole),
      homeLocationId: nullableStableId(body.homeLocationId, 'invalid_workforce_profile', 'Home location'),
      skillIds: uniqueUuidArray(body.skillIds, 'invalid_workforce_profile', 'Skill selection'),
    });
  }

  parseSkill(input, requireKey) {
    const allowed = new Set(['name', 'description', 'serviceId']);
    if (requireKey) allowed.add('key');
    const body = exactObject(input, allowed, 'invalid_workforce_skill');
    return {
      key: requireKey ? stableKey(body.key, 'invalid_workforce_skill', 'Skill key') : null,
      name: rawText(body.name, 480, 'invalid_workforce_skill', 'Skill name', true, 120),
      description: optionalRawText(body.description || '', 4096, 'invalid_workforce_skill', 'Skill description'),
      serviceId: nullableStableId(body.serviceId, 'invalid_workforce_skill', 'Service reference'),
    };
  }

  async createSkill(input, context) {
    const parsed = this.parseSkill(input, true);
    try {
      return await this.repository.createSkill({
        ...parsed,
        skillId: crypto.randomUUID(),
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new WorkforceError(409, 'workforce_skill_conflict', 'Workforce skill key or name already exists');
      }
      throw error;
    }
  }

  async updateSkill(skillId, input, context) {
    const parsed = this.parseSkill(input, false);
    try {
      return await this.repository.updateSkill({
        ...parsed,
        skillId: uuid(skillId, 'invalid_workforce_skill', 'Skill'),
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new WorkforceError(409, 'workforce_skill_conflict', 'Workforce skill name already exists');
      }
      throw error;
    }
  }

  parseCrew(input, requireKey) {
    const allowed = new Set(['name', 'homeLocationId', 'members']);
    if (requireKey) allowed.add('key');
    const body = exactObject(input, allowed, 'invalid_workforce_crew');
    if (!Array.isArray(body.members) || body.members.length > 100) {
      throw new WorkforceError(400, 'invalid_workforce_crew', 'Crew members are invalid');
    }
    const seen = new Set();
    let leads = 0;
    const members = body.members.map(member => {
      exactObject(member, new Set(['profileId', 'role']), 'invalid_workforce_crew');
      const profileId = uuid(member.profileId, 'invalid_workforce_crew', 'Crew member');
      if (seen.has(profileId)) throw new WorkforceError(400, 'invalid_workforce_crew', 'Crew contains a duplicate member');
      seen.add(profileId);
      if (!['lead', 'member'].includes(member.role)) {
        throw new WorkforceError(400, 'invalid_workforce_crew', 'Crew role is invalid');
      }
      if (member.role === 'lead') leads += 1;
      return { profileId, role: member.role };
    });
    if (leads > 1) throw new WorkforceError(400, 'invalid_workforce_crew', 'Crew can have at most one lead');
    return {
      key: requireKey ? stableKey(body.key, 'invalid_workforce_crew', 'Crew key') : null,
      name: rawText(body.name, 480, 'invalid_workforce_crew', 'Crew name', true, 120),
      homeLocationId: nullableStableId(body.homeLocationId, 'invalid_workforce_crew', 'Crew location'),
      members,
    };
  }

  async createCrew(input, context) {
    const parsed = this.parseCrew(input, true);
    try {
      return await this.repository.createCrew({
        ...parsed,
        crewId: crypto.randomUUID(),
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new WorkforceError(409, 'workforce_crew_conflict', 'Workforce crew key or name already exists');
      }
      throw error;
    }
  }

  async updateCrew(crewId, input, context) {
    const parsed = this.parseCrew(input, false);
    try {
      return await this.repository.updateCrew({
        ...parsed,
        crewId: uuid(crewId, 'invalid_workforce_crew', 'Crew'),
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new WorkforceError(409, 'workforce_crew_conflict', 'Workforce crew name already exists');
      }
      throw error;
    }
  }
}

module.exports = {
  ACCESS_ROLES: INVITATION_ACCESS_ROLES,
  MUTABLE_ACCESS_ROLES,
  OPERATIONAL_ROLES,
  WorkforceError,
  WorkforcePersistenceError,
  WorkforceService,
  rawText,
};
