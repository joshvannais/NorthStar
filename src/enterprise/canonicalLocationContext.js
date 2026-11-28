'use strict';

const crypto = require('node:crypto');
const { normalizeIdentity } = require('./identityContract');
const { EnterpriseContextError } = require('./context');
const { CANONICAL_CONTEXT, own, pin } = require('./locationContract');
const changed = () => { throw new EnterpriseContextError(409, 'enterprise_canonical_location_unavailable'); };

function requestedLocation(input, organizationId) {
  try {
    const data = own(input, ['contract', 'binding', 'location']);
    const location = own(data.location, ['reference', 'pin']);
    const reference = normalizeIdentity(location.reference);
    if (data.contract !== CANONICAL_CONTEXT || typeof data.binding !== 'string' || data.binding.length !== 64 || !/^[0-9a-f]{64}$/.test(data.binding) ||
        reference.kind !== 'location_identity' || reference.organizationId !== organizationId) return changed();
    return { data, reference, pin: pin(location.pin) };
  } catch (_error) { return changed(); }
}

function projectCanonicalContext(context, catalogue) {
  try {
    if (!catalogue || !Array.isArray(catalogue.locations) || catalogue.locations.length > 1000 || !Number.isSafeInteger(catalogue.total) ||
        catalogue.total < catalogue.locations.length || typeof catalogue.truncated !== 'boolean' ||
        catalogue.truncated !== (catalogue.total > catalogue.locations.length) || Reflect.ownKeys(catalogue.locations).length !== catalogue.locations.length + 1 ||
        Array.from({ length: catalogue.locations.length }, (_, index) => Object.getOwnPropertyDescriptor(catalogue.locations, String(index)))
          .some(descriptor => !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) throw new Error('invalid source');
    const seen = new Set();
    const locations = catalogue.locations.map(row => {
      const locationPin = pin(row.pin);
      const reference = normalizeIdentity({ kind: 'location_identity', organizationId: context.company.organizationId,
        id: row.locationId, provenance: { declarationId: locationPin.id, declaredByActorId: row.actorUserId, declaredAt: row.recordedAt } });
      if (seen.has(reference.id) || typeof row.name !== 'string' || !row.name) throw new Error('invalid source');
      seen.add(reference.id);
      const binding = crypto.createHash('sha256').update(JSON.stringify([CANONICAL_CONTEXT, context.binding, reference.id, locationPin])).digest('hex');
      return Object.freeze({ label: row.name, reference, pin: locationPin, binding });
    });
    return Object.freeze({ contract: CANONICAL_CONTEXT, locations: Object.freeze(locations),
      total: catalogue.total, truncated: catalogue.truncated, selectedLocation: null });
  } catch (_error) { throw new EnterpriseContextError(503, 'enterprise_canonical_source_unavailable'); }
}

function resolveCanonicalContext(context, catalogue, input) {
  const requested = requestedLocation(input, context.company.organizationId);
  const canonical = projectCanonicalContext(context, catalogue);
  const selected = canonical.locations.find(row => row.reference.id === requested.reference.id);
  if (!selected || selected.binding !== requested.data.binding || JSON.stringify(selected.pin) !== JSON.stringify(requested.pin)) return changed();
  // Caller provenance is not an authority source. Return the current stored revision.
  return Object.freeze({ ...context, canonicalContext: Object.freeze({ ...canonical, selectedLocation: selected }) });
}

module.exports = { requestedLocation, projectCanonicalContext, resolveCanonicalContext };
