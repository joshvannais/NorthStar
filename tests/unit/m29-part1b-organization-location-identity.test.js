'use strict';

const {
  CONTRACT, LIMITS, normalizeIdentity, normalizeRelationship, normalizeIdentityGraph, matchLegacyLocationSnapshot,
} = require('../../src/enterprise/identityContract');

const id = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
const provenance = () => ({ declarationId: id(90), declaredByActorId: id(91), declaredAt: '2026-11-28T12:00:00.000Z' });
const group = () => ({ kind: 'enterprise_group_identity', id: id(1), provenance: provenance() });
const company = () => ({ kind: 'company_reference', organizationId: id(2), provenance: provenance() });
const location = () => ({ kind: 'location_identity', organizationId: id(2), id: id(3), provenance: provenance() });
const pin = () => ({ id: id(80), version: 'org-profile-v7', hash: 'a'.repeat(64) });
const legacy = () => ({
  kind: 'legacy_location_reference', organizationId: id(2), locationKey: 'Office.East:HQ-01',
  profilePin: pin(), provenance: provenance(),
});
const association = () => ({ kind: 'enterprise_company_association', id: id(11), enterpriseGroupId: id(1), organizationId: id(2), provenance: provenance() });
const locationLink = () => ({ kind: 'company_location_reference', id: id(12), organizationId: id(2), locationId: id(3), provenance: provenance() });
const graph = () => ({ contract: CONTRACT, identities: [group(), company(), location()], relationships: [association(), locationLink()] });
const snapshot = () => ({ organizationId: id(2), profilePin: pin(), locationKeys: ['headquarters', 'Office.East:HQ-01'] });

function denied(operation, reason) {
  let error;
  try { operation(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe('ENTERPRISE_IDENTITY_INVALID');
  expect(error.message).toBe('Enterprise identity contract is invalid.');
  if (reason) expect(error.reason).toBe(reason);
}

describe('Mission29 Part1B immutable typed identity contracts', () => {
  test.each([group, company, location, legacy])('preserves an explicit typed identity and declaration without mutating input: %p', build => {
    const input = build(), before = clone(input), result = normalizeIdentity(input);
    expect(result).toEqual(before);
    expect(input).toEqual(before);
    expect(result).not.toBe(input);
    expect(result.provenance).not.toBe(input.provenance);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.provenance)).toBe(true);
    expect(() => { result.provenance.declarationId = id(700); }).toThrow(TypeError);
    input.provenance.declarationId = id(701);
    expect(result.provenance.declarationId).toBe(id(90));
  });

  test('a company reference retains the existing organization ID; no replacement company ID is allocated', () => {
    const result = normalizeIdentity(company());
    expect(Object.keys(result)).toEqual(['kind', 'organizationId', 'provenance']);
    expect(result.organizationId).toBe(id(2));
  });

  test('type namespaces distinguish explicitly declared records even when UUID text is equal', () => {
    const value = graph();
    value.identities[0].id = id(2);
    value.relationships[0].enterpriseGroupId = id(2);
    const result = normalizeIdentityGraph(value);
    expect(result.identities).toHaveLength(3);
    expect(result.identities.filter(row => row.kind === 'enterprise_group_identity')[0].id).toBe(id(2));
    expect(result.identities.filter(row => row.kind === 'company_reference')[0].organizationId).toBe(id(2));
  });

  test('an entity of a different type with the same UUID cannot satisfy an unknown group reference', () => {
    const value = graph();
    value.identities = [company()];
    value.relationships = [{ ...association(), enterpriseGroupId: id(2) }];
    denied(() => normalizeIdentityGraph(value), 'unknown_reference');
  });

  test.each(['', ' ', ' 00000000-0000-4000-8000-000000000001', id(1) + '\n', '{' + id(1) + '}', id(0xab).toUpperCase(), 0, false, null, undefined, new String(id(1))])('rejects noncanonical identifiers without coercion: %p', value => {
    denied(() => normalizeIdentity({ ...group(), id: value }), 'identifier');
  });

  test.each(['enterprise', 'organization', 'company', 'location', 'franchise', 'region', 'Enterprise_Group_Identity', '', null, undefined])('rejects unknown identity kinds: %p', kind => {
    denied(() => normalizeIdentity({ ...group(), kind }), 'kind');
  });

  test.each(['permissions', 'role', 'legalOwnership', 'membership', 'grants', 'actorSession', 'canonicalLocationId'])('rejects authority/adoption fields outside the closed identity grammar: %s', key => {
    denied(() => normalizeIdentity({ ...legacy(), [key]: true }), 'shape');
  });

  const shapes = [
    ['group', group, normalizeIdentity], ['company', company, normalizeIdentity],
    ['location', location, normalizeIdentity], ['legacy', legacy, normalizeIdentity],
    ['association', association, normalizeRelationship], ['location-link', locationLink, normalizeRelationship],
  ];
  for (const [label, build, normalize] of shapes) {
    for (const key of Object.keys(build())) {
      test.each(['missing', null, undefined])('denies ' + label + '.' + key + ' with %p rather than supplying authority defaults', mode => {
        const input = build();
        if (mode === 'missing') delete input[key]; else input[key] = mode;
        denied(() => normalize(input));
      });
    }
  }

  for (const key of Object.keys(provenance())) {
    test.each(['missing', null, undefined])('denies incomplete provenance ' + key + ': %p', mode => {
      const input = group();
      if (mode === 'missing') delete input.provenance[key]; else input.provenance[key] = mode;
      denied(() => normalizeIdentity(input));
    });
  }

  test.each(['2026-02-30T12:00:00.000Z', '2026-11-28T12:00:00Z', '2026-11-28T12:00:00.000+00:00', '2026-11-28', 0, new Date('2026-11-28T12:00:00.000Z')])('denies ambiguous/noncanonical declaration time: %p', declaredAt => {
    denied(() => normalizeIdentity({ ...group(), provenance: { ...provenance(), declaredAt } }), 'timestamp');
  });

  test('a declaration timestamp is metadata and does not masquerade as a currentness or authorization check', () => {
    const result = normalizeIdentity({ ...group(), provenance: { ...provenance(), declaredAt: '1970-01-01T00:00:00.000Z' } });
    expect(result.provenance.declaredAt).toBe('1970-01-01T00:00:00.000Z');
    expect(result).not.toHaveProperty('authorized');
    expect(result).not.toHaveProperty('current');
  });

  test('rejects a getter without invoking it', () => {
    let reads = 0;
    const input = group();
    Object.defineProperty(input, 'provenance', { enumerable: true, get() { reads += 1; return provenance(); } });
    denied(() => normalizeIdentity(input), 'shape');
    expect(reads).toBe(0);
  });

  test('rejects nested provenance getters and unrecognized assurance claims without invoking or accepting them', () => {
    let reads = 0;
    const input = group();
    Object.defineProperty(input.provenance, 'declaredAt', { enumerable: true, get() { reads += 1; return provenance().declaredAt; } });
    denied(() => normalizeIdentity(input), 'shape');
    expect(reads).toBe(0);
    denied(() => normalizeIdentity({ ...group(), provenance: { ...provenance(), authorized: true } }), 'shape');
    denied(() => normalizeRelationship({ ...association(), permissions: ['owner'] }), 'shape');
  });

  test('rejects inherited, symbol and hidden fields; accepts own null-prototype data by copying it', () => {
    const inherited = Object.assign(Object.create({ grant: 'owner' }), group());
    denied(() => normalizeIdentity(inherited), 'shape');
    denied(() => normalizeIdentity({ ...group(), [Symbol('grant')]: true }), 'shape');
    const hidden = group(); Object.defineProperty(hidden, 'grant', { value: true });
    denied(() => normalizeIdentity(hidden), 'shape');
    expect(normalizeIdentity(Object.assign(Object.create(null), group()))).toEqual(group());
  });
});

describe('Mission29 Part1B explicit non-authorizing relationship graphs', () => {
  test('validates the actual typed graph, preserves provenance, deterministically sorts copies and freezes all output', () => {
    const input = graph(), before = clone(input), result = normalizeIdentityGraph(input);
    const reversed = clone(input); reversed.identities.reverse(); reversed.relationships.reverse();
    expect(normalizeIdentityGraph(reversed)).toEqual(result);
    expect(input).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.identities)).toBe(true);
    expect(Object.isFrozen(result.relationships)).toBe(true);
    expect(result.identities.every(row => Object.isFrozen(row) && Object.isFrozen(row.provenance))).toBe(true);
    expect(result.relationships.every(row => Object.isFrozen(row) && Object.isFrozen(row.provenance))).toBe(true);
    expect(() => { result.identities.push(company()); }).toThrow(TypeError);
    expect(() => { result.relationships[0].organizationId = id(4); }).toThrow(TypeError);
    expect(result).not.toHaveProperty('permissions');
    expect(result).not.toHaveProperty('memberships');
  });

  test('accepts an explicitly empty graph without adopting any existing company or office', () => {
    expect(normalizeIdentityGraph({ contract: CONTRACT, identities: [], relationships: [] }))
      .toEqual({ contract: CONTRACT, identities: [], relationships: [] });
  });

  test('round-trips declared contract data through JSON without a hidden cache, allocator or implicit relationship', () => {
    const first = normalizeIdentityGraph(graph());
    expect(normalizeIdentityGraph(JSON.parse(JSON.stringify(first)))).toEqual(first);
    const unlinked = { contract: CONTRACT, identities: [group(), company()], relationships: [] };
    expect(normalizeIdentityGraph(unlinked).relationships).toEqual([]);
  });

  test('a syntactically valid nil identifier is a literal reference, never an unknown-target wildcard', () => {
    const value = graph();
    value.relationships[0].enterpriseGroupId = '00000000-0000-0000-0000-000000000000';
    denied(() => normalizeIdentityGraph(value), 'unknown_reference');
  });

  test.each(['contract', 'identities', 'relationships'])('requires explicit graph field %s', key => {
    for (const mode of ['missing', null, undefined]) {
      const input = graph();
      if (mode === 'missing') delete input[key]; else input[key] = mode;
      denied(() => normalizeIdentityGraph(input));
    }
  });

  test.each([null, undefined, false, [], 'graph'])('rejects nonrecord graph values: %p', value => denied(() => normalizeIdentityGraph(value), 'shape'));
  test('rejects unknown graph versions and extra authorization fields', () => {
    denied(() => normalizeIdentityGraph({ ...graph(), contract: 'northstar.enterprise.identity.v2' }), 'contract');
    denied(() => normalizeIdentityGraph({ ...graph(), access: true }), 'shape');
  });

  test.each([group, company, location, legacy])('rejects duplicate typed identities even when both copies are identical: %p', build => {
    const value = graph();
    if (build === legacy) value.identities.push(build());
    value.identities.push(build());
    denied(() => normalizeIdentityGraph(value), 'duplicate_identity');
  });

  test('rejects conflicting provenance for the same identity instead of merging it', () => {
    const value = graph(); value.identities.push({ ...company(), provenance: { ...provenance(), declarationId: id(92) } });
    denied(() => normalizeIdentityGraph(value), 'duplicate_identity');
  });

  test('requires a known company reference for scoped location and legacy records', () => {
    for (const build of [location, legacy]) {
      const value = { contract: CONTRACT, identities: [build()], relationships: [] };
      denied(() => normalizeIdentityGraph(value), 'unknown_reference');
    }
  });

  test('does not infer a company-location edge from a location identity', () => {
    const value = graph(); value.relationships = [association()];
    denied(() => normalizeIdentityGraph(value), 'missing_relationship');
  });

  test.each([
    value => { value.relationships[0].enterpriseGroupId = id(99); },
    value => { value.relationships[0].organizationId = id(99); },
    value => { value.relationships[1].locationId = id(99); },
    value => { value.relationships[1].organizationId = id(99); },
  ])('denies every unknown relationship endpoint: %p', change => {
    const value = graph(); change(value); denied(() => normalizeIdentityGraph(value), 'unknown_reference');
  });

  test('does not resolve a foreign-company location by bare UUID even when that company is also declared', () => {
    const value = graph(); value.identities.push({ ...company(), organizationId: id(4) });
    value.relationships[1].organizationId = id(4);
    denied(() => normalizeIdentityGraph(value), 'unknown_reference');
  });

  test('same UUID under distinct explicit company scopes remains two distinct locations with their own edges', () => {
    const value = graph();
    value.identities.push({ ...company(), organizationId: id(4) }, { ...location(), organizationId: id(4) });
    value.relationships.push({ ...locationLink(), id: id(14), organizationId: id(4) });
    const result = normalizeIdentityGraph(value);
    expect(result.identities.filter(row => row.kind === 'location_identity')).toHaveLength(2);
    expect(result.relationships.filter(row => row.kind === 'company_location_reference')).toHaveLength(2);
  });

  test('rejects duplicate relationship IDs across kinds', () => {
    const value = graph(); value.relationships[1].id = value.relationships[0].id;
    denied(() => normalizeIdentityGraph(value), 'duplicate_relationship');
  });

  test.each([0, 1])('rejects repeated endpoint pair with a different declaration ID: %s', index => {
    const value = graph(); value.relationships.push({ ...value.relationships[index], id: id(99) });
    denied(() => normalizeIdentityGraph(value), 'duplicate_relationship');
  });

  test.each(['parent_company', 'franchise_member', 'region_member', 'ownership', 'access_grant'])('rejects unapproved relationship vocabulary: %s', kind => {
    denied(() => normalizeRelationship({ ...association(), kind }), 'kind');
  });

  test('a legacy office reference does not satisfy a canonical location edge or allocate a new identity', () => {
    const value = graph(); value.identities = [company(), { ...legacy(), locationKey: id(3) }];
    value.relationships = [locationLink()];
    denied(() => normalizeIdentityGraph(value), 'unknown_reference');
    expect(normalizeIdentityGraph({ contract: CONTRACT, identities: [company(), legacy()], relationships: [] }).identities)
      .toHaveLength(2);
  });

  test('rejects sparse arrays, accessor elements and attached authority fields', () => {
    denied(() => normalizeIdentityGraph({ ...graph(), identities: new Array(1) }), 'shape');
    const accessor = [group()]; let reads = 0;
    Object.defineProperty(accessor, '0', { enumerable: true, get() { reads += 1; return group(); } });
    denied(() => normalizeIdentityGraph({ ...graph(), identities: accessor }), 'shape');
    expect(reads).toBe(0);
    const attached = []; attached.grant = 'owner';
    denied(() => normalizeIdentityGraph({ ...graph(), relationships: attached }), 'shape');
  });

  test('bounds input batches independently from product plan or account allowances', () => {
    const identities = Array.from({ length: LIMITS.identities }, (_, n) => ({ ...group(), id: id(1000 + n) }));
    expect(normalizeIdentityGraph({ contract: CONTRACT, identities, relationships: [] }).identities).toHaveLength(LIMITS.identities);
    denied(() => normalizeIdentityGraph({ contract: CONTRACT, identities: [...identities, group()], relationships: [] }), 'limit');
    denied(() => normalizeIdentityGraph({ ...graph(), relationships: Array.from({ length: LIMITS.relationships + 1 }, association) }), 'limit');
    expect(Object.isFrozen(LIMITS)).toBe(true);
  });
});

describe('Mission29 Part1B legacy location snapshot compatibility', () => {
  test.each(['headquarters', 'Office.East:HQ-01', 'MiXeD.Legacy_Key-9'])('preserves the exact existing location key and profile pin: %s', locationKey => {
    const ref = { ...legacy(), locationKey }, basis = { ...snapshot(), locationKeys: ['headquarters', locationKey].filter((v, n, all) => all.indexOf(v) === n) };
    const result = matchLegacyLocationSnapshot(ref, basis);
    expect(result.locationKey).toBe(locationKey);
    expect(result.profilePin).toEqual(pin());
    expect(Object.isFrozen(result.profilePin)).toBe(true);
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('locationId');
    expect(result).not.toHaveProperty('canonicalLocationId');
  });

  test('requires exact company scope and every pinned profile field', () => {
    denied(() => matchLegacyLocationSnapshot(legacy(), { ...snapshot(), organizationId: id(4) }), 'scope_mismatch');
    for (const [key, value] of [['id', id(81)], ['version', 'org-profile-v8'], ['hash', 'b'.repeat(64)]]) {
      denied(() => matchLegacyLocationSnapshot(legacy(), { ...snapshot(), profilePin: { ...pin(), [key]: value } }), 'profile_mismatch');
    }
  });

  test('does not case-fold or trim an unknown legacy key into an existing identity', () => {
    denied(() => matchLegacyLocationSnapshot({ ...legacy(), locationKey: 'office.east:hq-01' }, snapshot()), 'unknown_reference');
    denied(() => matchLegacyLocationSnapshot({ ...legacy(), locationKey: 'Office.East:HQ-01 ' }, snapshot()), 'legacy_key');
    denied(() => matchLegacyLocationSnapshot(legacy(), { ...snapshot(), locationKeys: ['headquarters'] }), 'unknown_reference');
  });

  test.each([
    { locationKeys: ['headquarters', 'headquarters'] },
    { locationKeys: ['Office.East:HQ-01', 'office.east:hq-01'] },
  ])('denies duplicate or case-ambiguous source keys: %p', ({ locationKeys }) => {
    denied(() => matchLegacyLocationSnapshot(legacy(), { ...snapshot(), locationKeys }), 'ambiguous_legacy_reference');
  });

  test('requires the legacy reference type and accepts no automatic mapping directive', () => {
    denied(() => matchLegacyLocationSnapshot(location(), snapshot()), 'kind');
    denied(() => normalizeIdentity({ ...legacy(), canonicalLocationId: id(3) }), 'shape');
  });

  for (const key of Object.keys(pin())) {
    test.each(['missing', null, undefined])('denies incomplete legacy profile pin ' + key + ': %p', mode => {
      const input = legacy();
      if (mode === 'missing') delete input.profilePin[key]; else input.profilePin[key] = mode;
      denied(() => normalizeIdentity(input));
    });
  }

  test.each(['org-profile-v0', 'org-profile-v01', 'org-profile-v-1', 'ORG-PROFILE-v1', 'org-profile-v1 '])('rejects malformed profile versions: %s', version => {
    denied(() => normalizeIdentity({ ...legacy(), profilePin: { ...pin(), version } }), 'profile_pin');
  });

  test('retains a large profile version as exact text and does not round a historical pin through Number', () => {
    const version = 'org-profile-v9223372036854775807';
    expect(normalizeIdentity({ ...legacy(), profilePin: { ...pin(), version } }).profilePin.version).toBe(version);
  });

  test.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 0, null, undefined])('requires the exact canonical profile digest: %p', hash => {
    denied(() => normalizeIdentity({ ...legacy(), profilePin: { ...pin(), hash } }), 'profile_pin');
  });

  test('a profile pin cannot carry a claim of trusted currentness or an access grant', () => {
    denied(() => normalizeIdentity({ ...legacy(), profilePin: { ...pin(), current: true } }), 'shape');
  });

  test.each(['', ' ', '../office', '/office', 'x'.repeat(65), null, undefined, 0])('rejects malformed legacy location keys: %p', locationKey => {
    denied(() => normalizeIdentity({ ...legacy(), locationKey }), 'legacy_key');
  });

  test.each(['organizationId', 'profilePin', 'locationKeys'])('does not default an incomplete legacy snapshot field %s', key => {
    for (const mode of ['missing', null, undefined]) {
      const input = snapshot();
      if (mode === 'missing') delete input[key]; else input[key] = mode;
      denied(() => matchLegacyLocationSnapshot(legacy(), input));
    }
  });

  test('validates supplied snapshot equality only, without claiming durable existence, recency or authorization', () => {
    const ref = { ...legacy(), provenance: { ...provenance(), declaredAt: '1970-01-01T00:00:00.000Z' } };
    const result = matchLegacyLocationSnapshot(ref, snapshot());
    expect(result.provenance.declaredAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.keys(result)).toEqual(['kind', 'organizationId', 'locationKey', 'profilePin', 'provenance']);
  });
});
