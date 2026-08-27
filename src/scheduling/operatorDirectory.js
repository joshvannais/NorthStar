'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { canMutateInternal } = require('../accounts/subscriptionPolicy');

const MAXIMUM_DIRECTORY_ENTRIES = 100;

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

function actorInput(req) {
  const authority = req && req.accountAuthority || {};
  const tenant = req && req.tenantContext || {};
  return {
    organizationId: tenant.organizationId,
    actorUserId: tenant.userId,
    actorAccessRole: req && req.userRole,
    membershipId: authority.membership_id || null,
    onboardingComplete: Boolean(req && req.user && req.user.onboardingStatus === 'complete'),
    subscriptionMutable: Boolean(req && canMutateInternal(req.subscriptionAuthority)),
  };
}

async function loadSchedulingOperatorDirectory(pool, input) {
  if (!pool || typeof pool.query !== 'function' || !input || !input.organizationId ||
      !input.actorUserId || !input.actorAccessRole) {
    const error = new Error('Scheduling operator authority is unavailable.');
    error.code = 'M22_OPERATOR_AUTHORITY_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  const actor = await pool.query(
    `SELECT profile.id AS profile_id, profile.operational_role,
            membership.id AS membership_id, membership.status AS membership_status,
            account.status AS user_status
       FROM public.organization_memberships membership
       JOIN public.users account
         ON account.organization_id=membership.organization_id AND account.id=membership.user_id
       LEFT JOIN public.workforce_profiles profile
         ON profile.organization_id=membership.organization_id AND profile.membership_id=membership.id
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND ($3::uuid IS NULL OR membership.id=$3::uuid)`,
    [input.organizationId, input.actorUserId, input.membershipId]
  );
  const current = actor.rowCount === 1 ? actor.rows[0] : null;
  const active = Boolean(current && current.membership_status === 'active' && current.user_status === 'active');
  const roleCapable = active && (input.actorAccessRole === 'owner' || input.actorAccessRole === 'admin' ||
    (input.actorAccessRole === 'member' && current.operational_role === 'dispatcher'));
  const canMutate = roleCapable && input.onboardingComplete === true && input.subscriptionMutable === true;
  if (!canMutate) {
    const unavailable = {
      canMutate: false,
      reason: !active ? 'operator_inactive' : !roleCapable ? 'operator_role_required'
        : input.onboardingComplete !== true ? 'onboarding_incomplete' : 'subscription_read_only',
      actor: {
        profileId: current && current.profile_id || null,
        accessRole: input.actorAccessRole,
        operationalRole: current && current.operational_role || null,
      },
      targets: [],
      truncated: false,
    };
    return Object.freeze({ ...unavailable, digest: sha256(stableValue(unavailable)) });
  }

  const profiles = await pool.query(
    `SELECT profile.id, account.name, profile.operational_role, membership.role AS access_role
       FROM public.workforce_profiles profile
       JOIN public.organization_memberships membership
         ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
       JOIN public.users account
         ON account.organization_id=membership.organization_id AND account.id=membership.user_id
      WHERE profile.organization_id=$1 AND membership.status='active' AND account.status='active'
      ORDER BY account.name COLLATE "C", profile.id
      LIMIT ${MAXIMUM_DIRECTORY_ENTRIES + 1}`,
    [input.organizationId]
  );
  const crews = await pool.query(
    `SELECT crew.id, crew.name,
            COALESCE(jsonb_agg(jsonb_build_object('profileId',profile.id,'name',account.name)
              ORDER BY account.name COLLATE "C",profile.id)
              FILTER (WHERE account.id IS NOT NULL),'[]'::jsonb) AS members
       FROM public.workforce_crews crew
       LEFT JOIN public.workforce_crew_members relation
         ON relation.organization_id=crew.organization_id AND relation.crew_id=crew.id
       LEFT JOIN public.workforce_profiles profile
         ON profile.organization_id=relation.organization_id AND profile.id=relation.profile_id
       LEFT JOIN public.organization_memberships membership
         ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
        AND membership.status='active'
       LEFT JOIN public.users account
         ON account.organization_id=membership.organization_id AND account.id=membership.user_id
        AND account.status='active'
      WHERE crew.organization_id=$1
      GROUP BY crew.id,crew.name
      ORDER BY crew.name COLLATE "C",crew.id
      LIMIT ${MAXIMUM_DIRECTORY_ENTRIES + 1}`,
    [input.organizationId]
  );
  const truncated = profiles.rows.length > MAXIMUM_DIRECTORY_ENTRIES || crews.rows.length > MAXIMUM_DIRECTORY_ENTRIES;
  const targets = [
    { kind: 'unassigned', id: null, label: 'Unassigned', operationalRole: null, accessRole: null, members: [] },
    ...profiles.rows.slice(0, MAXIMUM_DIRECTORY_ENTRIES).map(row => ({
      kind: 'profile', id: row.id, label: text(row.name) || 'Unnamed worker',
      operationalRole: row.operational_role, accessRole: row.access_role, members: [],
    })),
    ...crews.rows.slice(0, MAXIMUM_DIRECTORY_ENTRIES).map(row => ({
      kind: 'crew', id: row.id, label: text(row.name) || 'Unnamed crew',
      operationalRole: null, accessRole: null,
      members: (Array.isArray(row.members) ? row.members : []).slice(0, MAXIMUM_DIRECTORY_ENTRIES).map(member => ({
        profileId: member.profileId, name: text(member.name) || 'Unnamed worker',
      })),
    })),
  ];
  const directory = {
    canMutate: true,
    reason: null,
    actor: {
      profileId: current.profile_id || null,
      accessRole: input.actorAccessRole,
      operationalRole: current.operational_role || null,
    },
    targets,
    truncated,
  };
  return Object.freeze({ ...directory, digest: sha256(stableValue(directory)) });
}

module.exports = {
  MAXIMUM_DIRECTORY_ENTRIES,
  actorInput,
  loadSchedulingOperatorDirectory,
};
