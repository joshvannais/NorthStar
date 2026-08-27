'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { canMutateInternal, projectSubscription } = require('../accounts/subscriptionPolicy');

const MAXIMUM_DIRECTORY_ENTRIES = 100;
const TARGET_DIRECTORY_PAGE_SIZE = 25;
const TARGET_DIRECTORY_VERSION = 'm22-part5-target-directory-v1';
const TARGET_DIRECTORY_ENDPOINT = '/api/v1/canonical/operator-targets';
const MAXIMUM_TARGET_QUERY_CHARACTERS = 100;
const MAXIMUM_TARGET_QUERY_BYTES = 400;
const MAXIMUM_TARGET_CURSOR_BYTES = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_INPUT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    authSessionId: req && req.authSession && req.authSession.id || null,
    onboardingComplete: Boolean(req && req.user && req.user.onboardingStatus === 'complete'),
    subscriptionMutable: Boolean(req && canMutateInternal(req.subscriptionAuthority)),
  };
}

function invalidTargetRequest(message, code = 'INVALID_OPERATOR_TARGET_QUERY') {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  error.statusCode = 400;
  return error;
}

function canonicalTargetQuery(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw invalidTargetRequest('The target search query is invalid.');
  const normalized = value.normalize('NFC').trim();
  if (normalized.length > MAXIMUM_TARGET_QUERY_CHARACTERS ||
      Buffer.byteLength(normalized, 'utf8') > MAXIMUM_TARGET_QUERY_BYTES ||
      /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw invalidTargetRequest('The target search query is invalid.');
  }
  return UUID_INPUT.test(normalized) ? normalized.toLowerCase() : normalized;
}

function canonicalCursorPayload(payload) {
  return {
    version: 2,
    operation: 'm22_operator_target_directory',
    organizationId: payload.organizationId,
    query: payload.query,
    datasetDigest: payload.datasetDigest,
    kindRank: payload.kindRank,
    id: payload.id,
  };
}

function encodeOperatorTargetCursor(payload) {
  return Buffer.from(JSON.stringify(canonicalCursorPayload(payload)), 'utf8').toString('base64url');
}

function decodeOperatorTargetCursor(raw, authority) {
  if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw, 'utf8') > MAXIMUM_TARGET_CURSOR_BYTES ||
      !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw invalidTargetRequest('The target directory cursor is invalid.', 'INVALID_OPERATOR_TARGET_CURSOR');
  }
  let bytes;
  let source;
  let parsed;
  try {
    bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error('noncanonical base64url');
    source = bytes.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(bytes)) throw new Error('invalid UTF-8');
    parsed = JSON.parse(source);
  } catch (_error) {
    throw invalidTargetRequest('The target directory cursor is invalid.', 'INVALID_OPERATOR_TARGET_CURSOR');
  }
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
  const expectedKeys = ['version', 'operation', 'organizationId', 'query', 'datasetDigest', 'kindRank', 'id'];
  const canonical = parsed && canonicalCursorPayload(parsed);
  if (!canonical || keys.length !== expectedKeys.length || expectedKeys.some((key, index) => keys[index] !== key) ||
      JSON.stringify(canonical) !== source || parsed.version !== 2 ||
      parsed.operation !== 'm22_operator_target_directory' || parsed.organizationId !== authority.organizationId ||
      parsed.query !== authority.query || typeof parsed.datasetDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(parsed.datasetDigest) || ![1, 2].includes(parsed.kindRank) ||
      parsed.id !== String(parsed.id || '').toLowerCase() ||
      !UUID.test(String(parsed.id || ''))) {
    throw invalidTargetRequest('The target directory cursor is invalid.', 'INVALID_OPERATOR_TARGET_CURSOR');
  }
  return Object.freeze(canonical);
}

function parseOperatorTargetRequest(query, organizationId) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || !UUID.test(String(organizationId || '').toLowerCase())) {
    throw invalidTargetRequest('The target directory request is invalid.');
  }
  const keys = Object.keys(query);
  if (keys.some(key => key !== 'query' && key !== 'cursor')) {
    throw invalidTargetRequest('The target directory request is invalid.');
  }
  const search = canonicalTargetQuery(query.query);
  const cursor = query.cursor === undefined || query.cursor === null || query.cursor === ''
    ? null : decodeOperatorTargetCursor(query.cursor, { organizationId, query: search });
  return Object.freeze({ query: search, cursor, rawCursor: cursor ? query.cursor : null });
}

function validateInput(pool, input) {
  if (!pool || typeof pool.query !== 'function' || !input || !input.organizationId ||
      !input.actorUserId || !input.actorAccessRole || !input.authSessionId) {
    const error = new Error('Scheduling operator authority is unavailable.');
    error.code = 'M22_OPERATOR_AUTHORITY_UNAVAILABLE';
    error.status = 503;
    error.statusCode = 503;
    throw error;
  }
}

async function withReadSnapshot(pool, input, operation) {
  validateInput(pool, input);
  // pg PoolClient exposes both connect() and release(). A caller that already
  // owns the transaction must therefore be identified by release(), otherwise
  // invoking connect() would attempt to reconnect the live client and split the
  // authority/data boundary we are composing.
  if (typeof pool.connect !== 'function' || typeof pool.release === 'function') return operation(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function currentOperator(pool, input) {
  validateInput(pool, input);
  const actor = await pool.query(
    `SELECT profile.id AS profile_id, profile.operational_role,
            membership.id AS membership_id, membership.role AS access_role,
            membership.status AS membership_status, account.status AS user_status,
            session.id AS session_id, session.user_id AS session_user_id,
            session.organization_id AS session_organization_id,
            session.membership_id AS session_membership_id,
            session.status AS session_status, session.access_expires_at,
            CASE WHEN active_profile.id IS NOT NULL THEN 'complete' ELSE onboarding.status END AS onboarding_status,
            subscription.status AS subscription_status,
            subscription.trial_started_at, subscription.trial_ends_at,
            clock_timestamp() AS server_now
       FROM public.organization_memberships membership
       JOIN public.users account
         ON account.organization_id=membership.organization_id AND account.id=membership.user_id
       LEFT JOIN public.workforce_profiles profile
         ON profile.organization_id=membership.organization_id AND profile.membership_id=membership.id
       LEFT JOIN public.auth_sessions session ON session.id=$4::uuid
       JOIN public.organization_onboarding onboarding
         ON onboarding.organization_id=membership.organization_id
       LEFT JOIN public.canonical_business_profiles active_profile
         ON active_profile.organization_id=membership.organization_id AND active_profile.is_active=TRUE
       LEFT JOIN LATERAL (
         SELECT current_subscription.status,current_subscription.trial_started_at,current_subscription.trial_ends_at
           FROM public.subscriptions current_subscription
          WHERE current_subscription.organization_id=membership.organization_id
          LIMIT 1
       ) subscription ON TRUE
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND ($3::uuid IS NULL OR membership.id=$3::uuid)`,
    [input.organizationId, input.actorUserId, input.membershipId, input.authSessionId]
  );
  return actor.rowCount === 1 ? actor.rows[0] : null;
}

function noncurrentSession() {
  const error = new Error('The signed-in scheduling session is no longer current.');
  error.code = 'M22_OPERATOR_SESSION_NOT_CURRENT';
  error.status = 401;
  error.statusCode = 401;
  return error;
}

function operatorAuthority(input, current) {
  if (current) {
    const sessionCurrent = current.session_id === input.authSessionId &&
      current.session_user_id === input.actorUserId &&
      current.session_organization_id === input.organizationId &&
      current.session_membership_id === current.membership_id && current.session_status === 'active' &&
      current.access_expires_at && new Date(current.access_expires_at).getTime() > new Date(current.server_now).getTime();
    if (!sessionCurrent) throw noncurrentSession();
  }
  const active = Boolean(current && current.membership_status === 'active' && current.user_status === 'active');
  const authorityChanged = Boolean(current && current.access_role !== input.actorAccessRole);
  const canRead = active && !authorityChanged && (current.access_role === 'owner' || current.access_role === 'admin' ||
    (current.access_role === 'member' && current.operational_role === 'dispatcher'));
  const currentOnboardingComplete = Boolean(current && current.onboarding_status === 'complete');
  const currentSubscriptionMutable = Boolean(current && canMutateInternal(projectSubscription(current)));
  const canMutate = canRead && currentOnboardingComplete && currentSubscriptionMutable;
  return Object.freeze({
    canRead,
    canMutate,
    reason: !canRead ? (!active ? 'operator_inactive' : authorityChanged ? 'operator_authority_changed' : 'operator_role_required')
      : canMutate ? null : !currentOnboardingComplete ? 'onboarding_incomplete' : 'subscription_read_only',
    actor: {
      profileId: current && current.profile_id || null,
      accessRole: current && current.access_role || null,
      operationalRole: current && current.operational_role || null,
    },
  });
}

async function loadSchedulingOperatorDirectoryFromSnapshot(pool, input) {
  const current = await currentOperator(pool, input);
  const authority = operatorAuthority(input, current);
  if (!authority.canRead) {
    const unavailable = {
      ...authority,
      targets: [],
      truncated: false,
      discovery: null,
    };
    return Object.freeze({ ...unavailable, digest: sha256(stableValue(unavailable)) });
  }

  const profiles = await pool.query(
    `SELECT profile.id, account.name, profile.operational_role, membership.role AS access_role,
            COUNT(*) OVER()::int AS total_count
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
              FILTER (WHERE account.id IS NOT NULL),'[]'::jsonb) AS members,
            COUNT(*) OVER()::int AS total_count
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
      HAVING COUNT(account.id) > 0
      ORDER BY crew.name COLLATE "C",crew.id
      LIMIT ${MAXIMUM_DIRECTORY_ENTRIES + 1}`,
    [input.organizationId]
  );
  const profileTotal = profiles.rows.length ? Number(profiles.rows[0].total_count) : 0;
  const crewTotal = crews.rows.length ? Number(crews.rows[0].total_count) : 0;
  const profileShown = Math.min(profiles.rows.length, MAXIMUM_DIRECTORY_ENTRIES);
  const crewShown = Math.min(crews.rows.length, MAXIMUM_DIRECTORY_ENTRIES);
  const truncated = profileTotal > profileShown || crewTotal > crewShown;
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
    ...authority,
    discovery: {
      version: TARGET_DIRECTORY_VERSION,
      endpoint: TARGET_DIRECTORY_ENDPOINT,
      pageSize: TARGET_DIRECTORY_PAGE_SIZE,
      shown: profileShown + crewShown,
      total: profileTotal + crewTotal,
      truncated,
      counts: {
        profiles: { shown: profileShown, total: profileTotal },
        crews: { shown: crewShown, total: crewTotal },
      },
    },
    targets,
    truncated,
  };
  return Object.freeze({ ...directory, digest: sha256(stableValue(directory)) });
}

async function loadSchedulingOperatorDirectory(pool, input) {
  return withReadSnapshot(pool, input, client => loadSchedulingOperatorDirectoryFromSnapshot(client, input));
}

async function withBroadSchedulingReadSnapshot(pool, input, operation, options = {}) {
  if (typeof operation !== 'function') throw new Error('Broad scheduling read operation is required.');
  const operatorDirectory = typeof options.operatorDirectory === 'function'
    ? options.operatorDirectory : loadSchedulingOperatorDirectoryFromSnapshot;
  return withReadSnapshot(pool, input, async client => {
    const schedulingOperator = await operatorDirectory(client, input);
    if (!schedulingOperator || schedulingOperator.canRead !== true) {
      const denial = options.denial || {};
      const error = new Error(denial.message ||
        'Broad canonical customer and scheduling data is limited to current owners, admins, and active dispatchers.');
      error.code = denial.code || 'M22_BROAD_SCHEDULING_READ_FORBIDDEN';
      error.status = 403;
      error.statusCode = 403;
      throw error;
    }
    return operation(client, schedulingOperator);
  });
}

async function loadSchedulingOperatorTargetPageFromSnapshot(pool, input) {
  const current = await currentOperator(pool, input);
  const authority = operatorAuthority(input, current);
  if (!authority.canRead) {
    const unavailable = {
      version: TARGET_DIRECTORY_VERSION,
      ...authority,
      query: input.query || '',
      targets: [],
      page: { size: TARGET_DIRECTORY_PAGE_SIZE, shown: 0, total: 0, cursor: null, nextCursor: null, truncated: false },
    };
    return Object.freeze({ ...unavailable, digest: sha256(stableValue(unavailable)) });
  }
  const query = canonicalTargetQuery(input.query);
  const cursor = input.cursor || null;
  if (cursor && (cursor.organizationId !== input.organizationId || cursor.query !== query)) {
    throw invalidTargetRequest('The target directory cursor is invalid.', 'INVALID_OPERATOR_TARGET_CURSOR');
  }
  const result = await pool.query(
    `WITH target_candidates AS MATERIALIZED (
       SELECT 1::int AS kind_rank, 'profile'::text AS kind, profile.id,
              account.name::text AS label, profile.operational_role,
              membership.role::text AS access_role
         FROM public.workforce_profiles profile
         JOIN public.organization_memberships membership
           ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
         JOIN public.users account
           ON account.organization_id=membership.organization_id AND account.id=membership.user_id
        WHERE profile.organization_id=$1 AND membership.status='active' AND account.status='active'
       UNION ALL
       SELECT 2::int AS kind_rank, 'crew'::text AS kind, crew.id,
              crew.name::text AS label, NULL::text AS operational_role, NULL::text AS access_role
         FROM public.workforce_crews crew
        WHERE crew.organization_id=$1 AND EXISTS (
          SELECT 1
            FROM public.workforce_crew_members relation
            JOIN public.workforce_profiles profile
              ON profile.organization_id=relation.organization_id AND profile.id=relation.profile_id
            JOIN public.organization_memberships membership
              ON membership.organization_id=profile.organization_id AND membership.id=profile.membership_id
            JOIN public.users account
              ON account.organization_id=membership.organization_id AND account.id=membership.user_id
           WHERE relation.organization_id=crew.organization_id AND relation.crew_id=crew.id
             AND membership.status='active' AND account.status='active'
        )
     ), filtered AS MATERIALIZED (
       SELECT * FROM target_candidates
        WHERE $2::text='' OR LEFT(LOWER(label),CHAR_LENGTH($2::text))=LOWER($2::text) OR id::text=$2::text
     ), dataset AS MATERIALIZED (
       SELECT COUNT(*)::int AS total_count,
              COALESCE(pg_catalog.bit_xor(pg_catalog.hashtextextended(kind_rank::text || ':' || id::text,0)),0)::text AS hash_a,
              COALESCE(pg_catalog.bit_xor(pg_catalog.hashtextextended(kind_rank::text || ':' || id::text,7046029254386353131)),0)::text AS hash_b
         FROM filtered
     )
     SELECT page.kind_rank,page.kind,page.id,page.label,page.operational_role,page.access_role,
            dataset.total_count,dataset.hash_a,dataset.hash_b
       FROM dataset
       LEFT JOIN LATERAL (
         SELECT filtered.*
           FROM filtered
          WHERE $3::int IS NULL OR (kind_rank,id) > ($3::int,$4::uuid)
          ORDER BY kind_rank,id
          LIMIT ${TARGET_DIRECTORY_PAGE_SIZE + 1}
       ) page ON TRUE`,
    [input.organizationId, query, cursor && cursor.kindRank, cursor && cursor.id]
  );
  const total = result.rows.length ? Number(result.rows[0].total_count) : 0;
  const datasetDigest = sha256(stableValue({
    version: 1,
    organizationId: input.organizationId,
    query,
    total,
    hashA: result.rows.length ? result.rows[0].hash_a : '0',
    hashB: result.rows.length ? result.rows[0].hash_b : '0',
  }));
  if (cursor && cursor.datasetDigest !== datasetDigest) {
    const stale = new Error('The current target directory changed. Restart this bounded search.');
    stale.code = 'M22_OPERATOR_TARGET_DIRECTORY_STALE';
    stale.status = 409;
    stale.statusCode = 409;
    throw stale;
  }
  const resultRows = result.rows.filter(row => row.id);
  const pageRows = resultRows.slice(0, TARGET_DIRECTORY_PAGE_SIZE);
  const hasMore = resultRows.length > TARGET_DIRECTORY_PAGE_SIZE;
  const nextCursor = hasMore && pageRows.length ? encodeOperatorTargetCursor({
    organizationId: input.organizationId,
    query,
    datasetDigest,
    kindRank: Number(pageRows[pageRows.length - 1].kind_rank),
    id: pageRows[pageRows.length - 1].id,
  }) : null;
  const page = {
    size: TARGET_DIRECTORY_PAGE_SIZE,
    shown: pageRows.length,
    total,
    cursor: input.rawCursor || null,
    nextCursor,
    datasetDigest,
    truncated: total !== pageRows.length,
  };
  const targetPage = {
    version: TARGET_DIRECTORY_VERSION,
    ...authority,
    query,
    targets: pageRows.map(row => ({
      kind: row.kind,
      id: row.id,
      label: text(row.label) || (row.kind === 'crew' ? 'Unnamed crew' : 'Unnamed worker'),
      operationalRole: row.operational_role,
      accessRole: row.access_role,
      members: [],
    })),
    page,
  };
  return Object.freeze({ ...targetPage, digest: sha256(stableValue(targetPage)) });
}

async function loadSchedulingOperatorTargetPage(pool, input) {
  return withReadSnapshot(pool, input, client => loadSchedulingOperatorTargetPageFromSnapshot(client, input));
}

module.exports = {
  MAXIMUM_DIRECTORY_ENTRIES,
  TARGET_DIRECTORY_ENDPOINT,
  TARGET_DIRECTORY_PAGE_SIZE,
  TARGET_DIRECTORY_VERSION,
  actorInput,
  canonicalTargetQuery,
  decodeOperatorTargetCursor,
  encodeOperatorTargetCursor,
  loadSchedulingOperatorDirectory,
  loadSchedulingOperatorTargetPage,
  parseOperatorTargetRequest,
  withBroadSchedulingReadSnapshot,
};
