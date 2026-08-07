'use strict';

const AUTHORITY = 'canonical_integration_ownership';
const PROVIDERS = Object.freeze(['retell', 'voice']);
const PROVIDER_SET = new Set(PROVIDERS);
const PERSISTENCE_MESSAGE = 'Canonical PostgreSQL persistence is unavailable.';

function statusError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function invalidProjection() {
  return statusError(
    'INTEGRATION_STATUS_INVALID',
    'Canonical integration status is invalid.',
    503
  );
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw statusError('CANONICAL_PERSISTENCE_UNAVAILABLE', PERSISTENCE_MESSAGE, 503);
  }
  return pool;
}

function requireOrganizationId(organizationId) {
  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    throw statusError(
      'INTEGRATION_STATUS_TENANT_REQUIRED',
      'Active organization membership is required.',
      403
    );
  }
  return organizationId;
}

function projectRows(rows) {
  if (!Array.isArray(rows)) throw invalidProjection();

  const totals = new Map(PROVIDERS.map(provider => [provider, { active: 0, inactive: 0 }]));
  const observed = new Set();

  for (const row of rows) {
    if (!row || !PROVIDER_SET.has(row.provider) || !['active', 'inactive'].includes(row.status)) {
      throw invalidProjection();
    }
    const count = Number(row.record_count);
    const key = `${row.provider}:${row.status}`;
    if (!Number.isSafeInteger(count) || count < 1 || observed.has(key)) {
      throw invalidProjection();
    }
    observed.add(key);
    totals.get(row.provider)[row.status] = count;
  }

  return Object.freeze(PROVIDERS.map(provider => {
    const counts = totals.get(provider);
    let status = 'not_provisioned';
    if (counts.active > 1) status = 'ambiguous';
    else if (counts.active === 1) status = 'active';
    else if (counts.inactive > 0) status = 'inactive';
    return Object.freeze({ provider, status });
  }));
}

async function readCanonicalIntegrationStatuses(pool, organizationId) {
  const tenantId = requireOrganizationId(organizationId);
  let result;
  try {
    result = await requirePool(pool).query(
      `SELECT provider, status, COUNT(*)::integer AS record_count
         FROM canonical_integration_ownership
        WHERE organization_id = $1
        GROUP BY provider, status
        ORDER BY provider, status`,
      [tenantId]
    );
  } catch (error) {
    if (error && Number.isInteger(error.status) && typeof error.code === 'string') throw error;
    throw statusError('CANONICAL_PERSISTENCE_UNAVAILABLE', PERSISTENCE_MESSAGE, 503);
  }

  const projection = {
    authority: AUTHORITY,
    connectors: projectRows(result && result.rows),
  };
  return Object.freeze(projection);
}

module.exports = {
  AUTHORITY,
  PROVIDERS,
  readCanonicalIntegrationStatuses,
};
