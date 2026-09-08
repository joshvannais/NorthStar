'use strict';

const { overviewError, validateOverviewResponse } = require('./overviewContract');

function mapped(error) {
  if (error && error.code === '42501') return overviewError(403, 'OPERATIONAL_OVERVIEW_RESTRICTED');
  if (error && error.code === '40001') return overviewError(409, 'OPERATIONAL_OVERVIEW_CHANGED');
  if (error && error.code === '22023') return overviewError();
  return overviewError(503, 'OPERATIONAL_OVERVIEW_UNAVAILABLE');
}

async function readOperationalOverview(pool, input) {
  if (!pool || typeof pool.connect !== 'function') throw overviewError(503, 'OPERATIONAL_OVERVIEW_UNAVAILABLE');
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
    await client.query('SET LOCAL search_path = pg_catalog, public, pg_temp');
    // Only the canonical entry may discover tenant-wide execution authority.
    // If the separately authorized routine is absent, this read fails closed.
    const result = await client.query(
      `SELECT public.canonical_operational_overview_read(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::integer,$7::jsonb
      ) AS result`,
      [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId,
        input.state, input.limit, input.cursor === null ? null : JSON.stringify(input.cursor)]
    );
    const data = validateOverviewResponse(result.rows[0] && result.rows[0].result, input.actorAccessRole, input);
    await client.query('COMMIT');
    return data;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error && error.code === 'OPERATIONAL_OVERVIEW_UNAVAILABLE') throw error;
    throw mapped(error);
  } finally {
    if (client) client.release();
  }
}

module.exports = { readOperationalOverview };
