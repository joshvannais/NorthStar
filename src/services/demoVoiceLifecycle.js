'use strict';

const { authorityError, getProvisionedDemoOrganization } = require('./organizationAuthority');
const voiceSessions = require('./voiceSessionAuthority');

const DEMO_ID = /^demo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEMO_AGE_MS = 24 * 60 * 60 * 1000;

function notFound() {
  return authorityError('DEMO_SESSION_NOT_FOUND', 'Demo session not found.', 404);
}

async function getDemoSession(pool, configuredOrganizationId, externalSessionId) {
  if (!DEMO_ID.test(String(externalSessionId || ''))) throw notFound();
  const demo = await getProvisionedDemoOrganization(pool, configuredOrganizationId);
  let session;
  try {
    session = await voiceSessions.getSession(pool, demo.organizationId, externalSessionId);
  } catch (error) {
    if (error && error.code === 'VOICE_SESSION_NOT_FOUND') throw notFound();
    throw error;
  }
  if (!session.metadata || session.metadata.source !== 'public-demo') throw notFound();
  if (!session.startedAt || Date.now() - new Date(session.startedAt).getTime() > MAX_DEMO_AGE_MS) {
    throw notFound();
  }
  return { organizationId: demo.organizationId, session };
}

async function snapshotForSession(pool, authority) {
  if (!authority.session.canonicalOperationId) return null;
  const result = await pool.query(
    `SELECT o.result_status, o.result_body, ps.snapshot, ps.snapshot_digest,
            ps.business_profile_id, ps.business_profile_version, ps.business_profile_hash
       FROM canonical_operations o
       JOIN canonical_polaris_snapshots ps
         ON ps.organization_id = o.organization_id AND ps.operation_id = o.id
      WHERE o.organization_id = $1 AND o.id = $2 AND o.state = 'completed'`,
    [authority.organizationId, authority.session.canonicalOperationId]
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];
  return {
    operationId: authority.session.canonicalOperationId,
    snapshot: row.snapshot,
    snapshotDigest: row.snapshot_digest,
    businessProfile: {
      id: row.business_profile_id,
      version: row.business_profile_version,
      hash: row.business_profile_hash,
    },
  };
}

function transcriptFromTimeline(entries) {
  const lines = [];
  for (const entry of entries) {
    const payload = entry.payload || {};
    const turns = Array.isArray(payload.transcript) ? payload.transcript
      : (Array.isArray(payload.lines) ? payload.lines : []);
    for (const turn of turns) {
      const text = turn && (turn.text || turn.words || turn.content);
      if (!text) continue;
      lines.push({
        speaker: turn.speaker || turn.role || 'customer',
        text: String(text),
      });
    }
  }
  return lines;
}

async function readDemoLifecycle(pool, configuredOrganizationId, externalSessionId) {
  const authority = await getDemoSession(pool, configuredOrganizationId, externalSessionId);
  const [entries, canonical] = await Promise.all([
    voiceSessions.timeline(pool, authority.organizationId, authority.session.externalSessionId),
    snapshotForSession(pool, authority),
  ]);
  const terminal = ['completed', 'cancelled', 'failed'].includes(authority.session.status);
  const ready = authority.session.status === 'completed' && Boolean(canonical);
  return {
    ...authority,
    entries,
    transcript: transcriptFromTimeline(entries),
    estimate: ready
      ? { status: 'ready', ...canonical }
      : { status: terminal ? 'unavailable' : 'not_ready', snapshot: null },
    lifecycle: ready ? 'completed' : (terminal ? authority.session.status : 'pending'),
  };
}

module.exports = {
  MAX_DEMO_AGE_MS,
  getDemoSession,
  readDemoLifecycle,
  snapshotForSession,
  transcriptFromTimeline,
};
