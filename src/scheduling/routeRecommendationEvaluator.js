'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');

const RECOMMENDATION_VERSION = 1;
const GEODESIC_VERSION = 'haversine_sphere_v1';
const EARTH_RADIUS_METERS = 6371008.8;
const MAXIMUM_CONFLICT_DETAILS_PER_BUCKET = 16;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function entry(code, details) {
  return stableValue({ code, ...(details || {}) });
}

function lexicalCompare(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function stableEntries(values) {
  const byDigest = new Map();
  for (const value of values) byDigest.set(sha256(value), stableValue(value));
  return Array.from(byDigest.values()).sort(function (left, right) {
    return lexicalCompare(left.code, right.code) || lexicalCompare(JSON.stringify(left), JSON.stringify(right));
  });
}

function finiteCoordinate(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value : null;
}

function normalizedCoordinate(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) return null;
  const latitude = finiteCoordinate(location.latitude, -90, 90);
  const longitude = finiteCoordinate(location.longitude, -180, 180);
  if (latitude === null || longitude === null) return null;
  return Object.freeze({ latitude, longitude });
}

function locationAuthority(rawProfile) {
  const locations = [];
  const headquarters = rawProfile && rawProfile.headquarters;
  if (headquarters && typeof headquarters === 'object' && !Array.isArray(headquarters)) {
    locations.push({ id: 'headquarters', location: headquarters });
    const offices = Array.isArray(headquarters.additionalOffices) ? headquarters.additionalOffices : [];
    for (const office of offices) {
      if (office && typeof office.id === 'string' && STABLE_ID.test(office.id)) {
        locations.push({ id: office.id, location: office });
      }
    }
  }
  return locations;
}

function resolveLocation(rawProfile, rawId) {
  if (typeof rawId !== 'string' || !STABLE_ID.test(rawId)) return null;
  const matches = locationAuthority(rawProfile)
    .filter(candidate => candidate.id.toLowerCase() === rawId.toLowerCase());
  if (matches.length !== 1) return null;
  const coordinates = normalizedCoordinate(matches[0].location);
  return Object.freeze({
    id: matches[0].id,
    coordinates,
    coordinateDigest: coordinates ? sha256(coordinates) : null,
  });
}

function radians(value) {
  return value * Math.PI / 180;
}

function geodesicDistance(origin, destination) {
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const destinationLatitude = radians(destination.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const angular = 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a)));
  const meters = EARTH_RADIUS_METERS * angular;
  return Object.freeze({
    distanceMeters: Number(meters.toFixed(3)),
    distanceKilometers: Number((meters / 1000).toFixed(6)),
    distanceMiles: Number((meters / 1609.344).toFixed(6)),
  });
}

function routeImplication(input) {
  const review = [];
  const origin = resolveLocation(input.businessProfile, input.originLocationId);
  const destination = resolveLocation(input.businessProfile, input.destinationLocationId);
  if (!input.originLocationId) review.push(entry('candidate_origin_location_missing'));
  else if (!origin) review.push(entry('candidate_origin_location_authority_unavailable'));
  else if (!origin.coordinates) review.push(entry('candidate_origin_coordinates_unavailable', { locationId: origin.id }));
  if (!input.destinationLocationId) review.push(entry('appointment_destination_location_missing'));
  else if (!destination) review.push(entry('appointment_destination_location_authority_unavailable'));
  else if (!destination.coordinates) review.push(entry('appointment_destination_coordinates_unavailable', { locationId: destination.id }));
  review.push(entry('driving_route_evidence_unavailable'));
  const geodesic = origin && origin.coordinates && destination && destination.coordinates
    ? geodesicDistance(origin.coordinates, destination.coordinates) : null;
  const canonicalOrigin = origin ? {
    locationId: origin.id,
    coordinateDigest: origin.coordinateDigest,
  } : { locationId: null, coordinateDigest: null };
  const canonicalDestination = destination ? {
    locationId: destination.id,
    coordinateDigest: destination.coordinateDigest,
  } : { locationId: null, coordinateDigest: null };
  const route = {
    status: 'needs_review',
    providerNeutral: true,
    providerCalls: 0,
    origin: canonicalOrigin,
    destination: canonicalDestination,
    geodesic: geodesic ? {
      status: 'available',
      method: GEODESIC_VERSION,
      label: 'Geodesic straight-line distance; not driving distance or travel time.',
      ...geodesic,
    } : {
      status: 'unavailable',
      method: GEODESIC_VERSION,
      label: 'Geodesic straight-line distance unavailable; no distance or travel time was inferred.',
      distanceMeters: null,
      distanceKilometers: null,
      distanceMiles: null,
    },
    driving: {
      status: 'unavailable',
      distanceMiles: null,
      durationMinutes: null,
      reason: 'No authorized current durable provider-neutral driving-route evidence exists.',
    },
    needsReview: true,
    reviewReasons: stableEntries(review),
  };
  return Object.freeze({ ...stableValue(route), digest: sha256(route) });
}

function summarizeConflict(result) {
  const source = result || {};
  const buckets = {
    hardConflicts: Array.isArray(source.hardConflicts) ? source.hardConflicts : [],
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
    reviewReasons: Array.isArray(source.reviewReasons) ? source.reviewReasons : [],
  };
  const truncated = Object.values(buckets).some(values => values.length > MAXIMUM_CONFLICT_DETAILS_PER_BUCKET);
  const canonical = {
    version: Number(source.version) || 0,
    status: typeof source.status === 'string' ? source.status : 'needs_review',
    needsReview: source.needsReview === true || truncated,
    hardConflictCount: buckets.hardConflicts.length,
    warningCount: buckets.warnings.length,
    reviewReasonCount: buckets.reviewReasons.length,
    hardConflicts: buckets.hardConflicts.slice(0, MAXIMUM_CONFLICT_DETAILS_PER_BUCKET),
    warnings: buckets.warnings.slice(0, MAXIMUM_CONFLICT_DETAILS_PER_BUCKET),
    reviewReasons: buckets.reviewReasons.slice(0, MAXIMUM_CONFLICT_DETAILS_PER_BUCKET),
    detailsTruncated: truncated,
    fullEvidenceDigest: sha256({
      hardConflicts: buckets.hardConflicts,
      warnings: buckets.warnings,
      reviewReasons: buckets.reviewReasons,
      status: source.status,
      version: source.version,
    }),
  };
  return Object.freeze(stableValue(canonical));
}

function conflictTier(conflict) {
  if (conflict.hardConflictCount > 0 || conflict.status === 'hard_conflict') return 3;
  if (conflict.needsReview || conflict.status === 'needs_review') return 2;
  if (conflict.warningCount > 0 || conflict.status === 'warning') return 1;
  return 0;
}

function compareCandidate(left, right) {
  return left._score.conflictTier - right._score.conflictTier ||
    left._score.routeTier - right._score.routeTier ||
    left._score.distanceMeters - right._score.distanceMeters ||
    lexicalCompare(left.candidate.kind, right.candidate.kind) ||
    lexicalCompare(left.candidate.id, right.candidate.id);
}

function evaluateRecommendationCandidates(input) {
  const evaluated = input.candidates.map(function (source) {
    const conflicts = summarizeConflict(source.conflicts);
    const route = routeImplication({
      businessProfile: input.businessProfile,
      originLocationId: source.homeLocationId,
      destinationLocationId: input.destinationLocationId,
    });
    const uncertainty = route.reviewReasons.slice();
    if (conflicts.needsReview) uncertainty.push(entry('conflict_authority_needs_review'));
    if (conflicts.detailsTruncated) uncertainty.push(entry('conflict_explanations_bounded'));
    if (input.globalEvidenceIncomplete) uncertainty.push(entry('recommendation_evidence_incomplete'));
    const hard = conflicts.hardConflictCount > 0 || conflicts.status === 'hard_conflict';
    const eligibility = hard ? 'ineligible'
      : (conflicts.needsReview || route.needsReview || input.globalEvidenceIncomplete) ? 'needs_review' : 'eligible';
    const reasons = [entry('candidate_conflict_status', { status: conflicts.status })];
    if (route.geodesic.status === 'available') {
      reasons.push(entry('geodesic_distance_available', { distanceMeters: route.geodesic.distanceMeters }));
    } else {
      reasons.push(entry('geodesic_distance_unavailable'));
    }
    const candidate = stableValue({
      kind: source.kind,
      id: source.id,
      label: source.label,
    });
    const authority = stableValue(source.authority);
    const evidenceDigest = sha256({ authority, candidate, conflicts, route });
    return {
      candidate,
      authorityPins: authority,
      eligibility,
      conflicts,
      route,
      reasons: stableEntries(reasons),
      uncertainty: stableEntries(uncertainty),
      evidenceDigest,
      _score: {
        conflictTier: conflictTier(conflicts),
        routeTier: route.geodesic.status === 'available' ? 0 : 1,
        distanceMeters: route.geodesic.status === 'available' ? route.geodesic.distanceMeters : Number.MAX_SAFE_INTEGER,
      },
    };
  });
  evaluated.sort(compareCandidate);
  const candidates = evaluated.map(function (candidate, index) {
    const { _score, ...visible } = candidate;
    return Object.freeze(stableValue({
      ...visible,
      rank: index + 1,
      rankBasis: {
        conflictTier: _score.conflictTier,
        geodesicDistanceMeters: _score.distanceMeters === Number.MAX_SAFE_INTEGER ? null : _score.distanceMeters,
        routeTier: _score.routeTier,
      },
    }));
  });
  const recommended = candidates.find(candidate => candidate.eligibility !== 'ineligible') || null;
  const globalReviewReasons = [];
  if (input.candidateSetTruncated) globalReviewReasons.push(entry('candidate_set_bounded'));
  if (input.globalEvidenceIncomplete) globalReviewReasons.push(entry('recommendation_evidence_incomplete'));
  if (!candidates.length) globalReviewReasons.push(entry('candidate_set_empty'));
  if (!recommended && candidates.length) globalReviewReasons.push(entry('all_candidates_hard_conflict'));
  if (recommended && recommended.eligibility === 'needs_review') {
    globalReviewReasons.push(entry('recommended_candidate_needs_review'));
  }
  const reviewReasons = stableEntries(globalReviewReasons);
  return Object.freeze({
    recommendationVersion: RECOMMENDATION_VERSION,
    status: reviewReasons.length ? 'needs_review' : 'recommended',
    candidateSetTruncated: input.candidateSetTruncated === true,
    rankingComplete: input.candidateSetTruncated !== true && input.globalEvidenceIncomplete !== true,
    recommendedCandidate: recommended ? {
      kind: recommended.candidate.kind,
      id: recommended.candidate.id,
      rank: recommended.rank,
      evidenceDigest: recommended.evidenceDigest,
      requiresHumanReview: recommended.eligibility !== 'eligible',
    } : null,
    alternatives: Object.freeze(candidates),
    needsReview: reviewReasons.length > 0,
    reviewReasons: Object.freeze(reviewReasons),
    persisted: false,
    grantsMutation: false,
  });
}

module.exports = {
  EARTH_RADIUS_METERS,
  GEODESIC_VERSION,
  MAXIMUM_CONFLICT_DETAILS_PER_BUCKET,
  RECOMMENDATION_VERSION,
  evaluateRecommendationCandidates,
  geodesicDistance,
  resolveLocation,
  routeImplication,
  summarizeConflict,
};
