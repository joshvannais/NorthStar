'use strict';

// Internal M26 Part 5B bridge. The M22-guarded current source supplies company
// hours; this does not convert those hours into worker or resource capacity.
const { sha256 } = require('../services/businessProfileAdapter');
const { readDeclaredAvailabilitySnapshot } = require('./declaredAvailabilitySnapshot');
const { VERSION, summarizeOperatingWindows } = require('./operatingWindowPosition');

function unavailable(organizationId, reason) {
  return Object.freeze({ version: VERSION, organizationId, state: 'unavailable', reason,
    sourceSnapshotDigest: null, operatingIntervals: null,
    companyOperatingMinutes: null, sourceAuthenticated: false,
    temporalCutoffVerified: false, workerAvailabilityVerified: false,
    resourceConstraintsChecked: false, forecastIssued: false });
}

async function readGuardedOperatingWindowPosition(pool, input) {
  const source = await readDeclaredAvailabilitySnapshot(pool, input);
  if (source.state !== 'source_snapshot') return unavailable(input.organizationId, source.reason);
  const basis = source.basis;
  if (source.sourceAuthenticated !== true || !basis ||
      basis.organizationId !== input.organizationId ||
      basis.horizon?.startsAt !== input.horizon.startsAt ||
      basis.horizon?.endsAt !== input.horizon.endsAt ||
      basis.businessProfile?.timeZone !== input.expectedTimeZone ||
      sha256(basis) !== source.sourceSnapshotDigest) {
    return unavailable(input.organizationId, 'source_snapshot_unresolved');
  }
  const position = summarizeOperatingWindows({ version: VERSION,
    organizationId: basis.organizationId,
    sourceSnapshotDigest: source.sourceSnapshotDigest,
    horizon: basis.horizon, timeZone: basis.businessProfile.timeZone,
    hours: basis.businessProfile.hours });
  return Object.freeze({ ...position, sourceAuthenticated: true,
    temporalCutoffVerified: false, resourceConstraintsChecked: false });
}

module.exports = { readGuardedOperatingWindowPosition };
