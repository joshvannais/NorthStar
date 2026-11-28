'use strict';

const contract = require('../../src/enterprise/locationContract');
const canonical = require('../../src/enterprise/canonicalLocationContext');
const id = n => 'a1000000-0000-4000-8000-' + String(n).padStart(12, '0');
const pin = () => ({ id: id(2), revision: 1, digest: 'a'.repeat(64) });
const source = () => ({ id: id(3), version: 'org-profile-v1', hash: 'b'.repeat(64) });
const clone = value => JSON.parse(JSON.stringify(value));
const draft = () => ({ contract: contract.CONTRACT, action: 'create', locationId: id(1),
  expected: { id: null, revision: 0, digest: null }, change: { name: 'Explicit site', address: null }, reason: 'An explicit reviewed creation', profilePin: source() });
const committed = () => ({ ...draft(), review: { contract: contract.REVIEW, digest: 'c'.repeat(64), confirmed: true } });
const context = () => ({ company: { organizationId: id(10) }, binding: 'd'.repeat(64) });
const catalogue = () => ({ locations: [{ locationId: id(1), pin: pin(), name: 'Current active site', actorUserId: id(11), recordedAt: '2026-11-28T14:00:00.000Z' }], total: 1, truncated: false });
function denied(work, status = 400) { let error; try { work(); } catch (caught) { error = caught; } expect(error).toBeInstanceOf(Error); expect(error.status).toBe(status); }

describe('Mission 29 Part 1D explicit lifecycle request contracts', () => {
  test('copies/freeze exact reviewed entries without allocating, adopting or mutating source', () => {
    const input = committed(), before = clone(input), result = contract.normalize(input, true);
    expect(result).toEqual(before); expect(input).toEqual(before); expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.expected)).toBe(true); expect(Object.isFrozen(result.change)).toBe(true);
    expect(Object.isFrozen(result.profilePin)).toBe(true); expect(Object.isFrozen(result.review)).toBe(true);
    expect(result).not.toHaveProperty('legacyLocationKey'); expect(result).not.toHaveProperty('permissions');
    expect(() => { result.change.name = 'Mutated'; }).toThrow(TypeError);
  });
  test.each([
    ['activate', {}], ['deactivate', {}], ['rename', { name: 'New reviewed name' }], ['relocate', { address: 'Declared new address' }],
    ['correct', { name: 'Corrected label', address: null, correctedRevision: pin() }], ['transfer', { target: { locationId: id(9), pin: pin() } }],
  ])('accepts the explicit %s grammar as a request, without pretending state is current', (action, change) => {
    const result = contract.normalize({ ...draft(), action, expected: pin(), change });
    expect(result.action).toBe(action); expect(result.expected).toEqual(pin()); expect(result.change).toEqual(change);
  });
  for (const key of Object.keys(committed())) {
    test.each(['missing', null, undefined])('denies incomplete committed field ' + key + ': %p', value => {
      const input = committed(); if (value === 'missing') delete input[key]; else input[key] = value;
      denied(() => contract.normalize(input, true));
    });
  }
  for (const nested of ['expected', 'profilePin', 'review']) for (const key of Object.keys(committed()[nested])) {
    test.each(['missing', null, undefined])('does not default ' + nested + '.' + key + ': %p', value => {
      // Empty creation pins intentionally require explicit null IDs/digests.
      const input = committed(); input.expected = pin();
      if (value === 'missing') delete input[nested][key]; else input[nested][key] = value;
      denied(() => contract.normalize(input, true));
    });
  }
  test.each(['owner', 'adopt', 'create-and-activate', 'delete', 'franchise-transfer', '', null, undefined])('rejects unsupported operation %p', action => {
    denied(() => contract.normalize({ ...draft(), action }));
  });
  test.each(['role', 'organizationId', 'grants', 'legacyOfficeId', 'oldJobIds', 'financialOwner', 'transferCompanyId'])('rejects an extra authority/adoption field: %s', key => {
    denied(() => contract.normalize({ ...draft(), [key]: id(9) }));
  });
  test.each(['', ' ', ' leading', 'trailing ', 'line\nbreak', 'x'.repeat(161), '\ud800'])('rejects malformed name %p', name => {
    denied(() => contract.normalize({ ...draft(), change: { name, address: null } }));
  });
  test('retains declared Unicode text and distinguishes null unknown address from missing/empty', () => {
    expect(contract.normalize({ ...draft(), change: { name: 'Site 🧭', address: null } }).change.name).toBe('Site 🧭');
    for (const change of [{ name: 'Site' }, { name: 'Site', address: '' }, { name: 'Site', address: undefined }]) denied(() => contract.normalize({ ...draft(), change }));
  });
  test.each([0, -1, 1.1, Number.MAX_SAFE_INTEGER, '1', null, undefined])('requires an exact supported positive revision: %p', revision => {
    denied(() => contract.pin({ ...pin(), revision }));
  });
  test.each(['', '*', id(1).toUpperCase(), id(1) + '\n', 0, false, null, undefined, new String(id(1))])('does not coerce an identity %p', locationId => {
    denied(() => contract.normalize({ ...draft(), locationId }));
  });
  test('requires the versioned explicit confirmation and never accepts a preview marker as a grant', () => {
    for (const review of [{ ...committed().review, confirmed: false }, { ...committed().review, confirmed: 'true' }, { ...committed().review, contract: 'v2' }]) {
      denied(() => contract.normalize({ ...draft(), review }, true));
    }
    denied(() => contract.normalize(committed()));
  });
  test('rejects inherited/symbol/hidden/getter fields without invoking their code', () => {
    let reads = 0; const getter = draft(); Object.defineProperty(getter, 'change', { enumerable: true, get() { reads++; return {}; } });
    const hidden = draft(); Object.defineProperty(hidden, 'reason', { enumerable: false });
    for (const value of [getter, hidden, Object.assign(Object.create({ granted: true }), draft()), { ...draft(), [Symbol('grant')]: true }]) denied(() => contract.normalize(value));
    expect(reads).toBe(0);
    expect(contract.normalize(Object.assign(Object.create(null), draft()))).toEqual(draft());
  });
});

describe('Mission 29 Part 1D versioned canonical selection is distinct from legacy references', () => {
  const selection = choice => ({ contract: contract.CANONICAL_CONTEXT, binding: choice.binding, location: { reference: choice.reference, pin: choice.pin } });
  test('projects a stored revision pin into a typed canonical identity without exposing history or granting operations', () => {
    const result = canonical.projectCanonicalContext(context(), catalogue()), choice = result.locations[0];
    expect(result.selectedLocation).toBeNull(); expect(choice.reference.kind).toBe('location_identity');
    expect(choice.reference.organizationId).toBe(id(10)); expect(choice.pin).toEqual(pin()); expect(choice.binding).toMatch(/^[0-9a-f]{64}$/);
    expect(choice).not.toHaveProperty('reason'); expect(choice).not.toHaveProperty('permissions'); expect(Object.isFrozen(choice.reference)).toBe(true);
    const input = clone(selection(choice)); input.location.reference.provenance.declaredByActorId = id(99);
    expect(canonical.resolveCanonicalContext(context(), catalogue(), input).canonicalContext.selectedLocation.reference.provenance.declaredByActorId).toBe(id(11));
  });
  test('binds the current session and exact immutable canonical revision, preserving old source immutability', () => {
    const original = catalogue(), before = clone(original), projected = canonical.projectCanonicalContext(context(), original), input = selection(projected.locations[0]);
    expect(original).toEqual(before);
    denied(() => canonical.resolveCanonicalContext({ ...context(), binding: 'e'.repeat(64) }, original, input), 409);
    denied(() => canonical.resolveCanonicalContext(context(), { ...original, locations: [{ ...original.locations[0], pin: { ...pin(), revision: 2 } }] }, input), 409);
    denied(() => canonical.resolveCanonicalContext(context(), { locations: [], total: 0, truncated: false }, input), 409);
  });
  test('accepts an explicitly empty or truthfully truncated source without choosing a default', () => {
    expect(canonical.projectCanonicalContext(context(), { locations: [], total: 0, truncated: false }).locations).toEqual([]);
    expect(canonical.projectCanonicalContext(context(), { ...catalogue(), total: 2, truncated: true }).truncated).toBe(true);
  });
  test.each([null, {}, { ...catalogue(), total: undefined }, { ...catalogue(), total: null }, { ...catalogue(), total: 0 },
    { ...catalogue(), total: 2 }, { ...catalogue(), truncated: true }, { ...catalogue(), locations: new Array(1) },
    { ...catalogue(), locations: [catalogue().locations[0], catalogue().locations[0]], total: 2 }])('denies missing/inconsistent/ambiguous source metadata: %p', value => {
    denied(() => canonical.projectCanonicalContext(context(), value), 503);
  });
  test('denies foreign scope, unsupported kind, malformed/omitted pin and old legacy contract', () => {
    const current = canonical.projectCanonicalContext(context(), catalogue()).locations[0];
    const changes = [value => { value.contract = 'northstar.enterprise.context.v1'; }, value => { value.location.reference.organizationId = id(99); },
      value => { value.location.reference.kind = 'legacy_location_reference'; }, value => { value.location.pin = null; },
      value => { delete value.location.pin; }, value => { value.binding = '*'; }, value => { value.role = 'owner'; }];
    for (const change of changes) { const input = selection(clone(current)); change(input); denied(() => canonical.resolveCanonicalContext(context(), catalogue(), input), 409); }
  });
});
