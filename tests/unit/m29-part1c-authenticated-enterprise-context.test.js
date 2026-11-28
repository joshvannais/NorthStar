'use strict';

const { CONTRACT, EnterpriseContextError, validatePrincipal, projectContext, resolveSelection } = require('../../src/enterprise/context');
const id = n => '91000000-0000-4000-8000-' + String(n).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
const principal = () => ({ actorUserId: id(1), sessionId: id(2), organizationId: id(3) });
const row = () => ({
  actor_user_id: id(1), session_id: id(2), organization_id: id(3), user_organization_id: id(3),
  membership_id: id(4), session_status: 'active', membership_status: 'active', user_status: 'active',
  membership_revoked_at: null, session_revoked_at: null, role: 'owner',
  access_expires_at: '2026-11-28T14:00:00.000Z', refresh_expires_at: '2026-12-01T14:00:00.000Z',
  observed_at: '2026-11-28T13:00:00.000Z', profile_id: id(5), version_label: 'org-profile-v1',
  normalized_profile_hash: 'a'.repeat(64), csrf_token_hash: 'b'.repeat(64),
  actor_version: '2026-11-28T12:00:00.123456Z', membership_version: '2026-11-28T12:00:00.123456Z',
  session_created_version: '2026-11-28T12:00:00.123456Z', access_version: '2026-11-28T14:00:00.000000Z',
  refresh_version: '2026-12-01T14:00:00.000000Z', raw_profile: { headquarters: { additionalOffices: [{ id: 'Office.East', name: 'East' }] } },
});
const selection = context => ({ contract: CONTRACT, binding: context.binding, location: clone(context.locations[0].reference) });
function denied(work, code) {
  let error;
  try { work(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(EnterpriseContextError);
  expect(error.code).toBe(code);
  expect(error.message).not.toMatch(/91000000|Office\.East|SQL/);
}

describe('Mission 29 Part 1C current server-owned context projections', () => {
  test('projects only the exact current actor/company membership and pinned legacy references', () => {
    const source = row(), before = clone(source), context = projectContext(source, principal());
    expect(source).toEqual(before);
    expect(context).toMatchObject({ contract: CONTRACT, actor: { id: id(1), role: 'owner' }, company: { organizationId: id(3) }, selectedLocation: null });
    expect(context.binding).toMatch(/^[0-9a-f]{64}$/);
    expect(context.locations.map(item => item.reference.locationKey)).toEqual(['headquarters', 'Office.East']);
    expect(context.locations.every(item => item.reference.kind === 'legacy_location_reference')).toBe(true);
    expect(context).not.toHaveProperty('sessionId');
    expect(context).not.toHaveProperty('permissions');
    expect(context).not.toHaveProperty('enterpriseGroupId');
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.locations[0].reference.profilePin)).toBe(true);
    source.raw_profile.headquarters.additionalOffices[0].id = 'Changed';
    expect(context.locations[1].reference.locationKey).toBe('Office.East');
  });

  test('preserves a single headquarters as an explicit choice without defaulting a selection', () => {
    const context = projectContext({ ...row(), raw_profile: {} }, principal());
    expect(context.locations).toHaveLength(1);
    expect(context.selectedLocation).toBeNull();
    expect(resolveSelection(context, selection(context)).selectedLocation.reference.locationKey).toBe('headquarters');
  });

  test.each(['owner', 'admin', 'member', 'viewer'])('retains the current fixed role without a premium context gate: %s', role => {
    expect(projectContext({ ...row(), role }, principal()).actor.role).toBe(role);
  });

  for (const field of Object.keys(principal())) {
    test.each(['missing', null, undefined, '*', id(1).toUpperCase(), 0])('requires an exact current principal ' + field + ': %p', value => {
      const input = principal(); if (value === 'missing') delete input[field]; else input[field] = value;
      // The fixture UUID has no letters; use a noncanonical uppercase UUID explicitly.
      if (value === id(1).toUpperCase()) input[field] = 'AAAAAAAA-0000-4000-8000-000000000001';
      denied(() => validatePrincipal(input), 'enterprise_session_required');
    });
  }

  test('does not invoke principal getters or accept inherited/extra grants', () => {
    let reads = 0; const input = principal();
    Object.defineProperty(input, 'sessionId', { enumerable: true, get() { reads++; return id(2); } });
    denied(() => validatePrincipal(input), 'enterprise_session_required');
    expect(reads).toBe(0);
    denied(() => validatePrincipal({ ...principal(), permissions: ['owner'] }), 'enterprise_session_required');
  });

  test.each([
    ['actor_user_id', id(9)], ['session_id', id(9)], ['organization_id', id(9)], ['user_organization_id', id(9)],
    ['membership_id', null], ['session_status', 'revoked'], ['membership_status', 'revoked'], ['user_status', 'suspended'],
    ['membership_revoked_at', '2026-11-28'], ['session_revoked_at', '2026-11-28'], ['role', 'super_admin'],
    ['access_expires_at', '2026-11-28T13:00:00.000Z'], ['access_expires_at', null], ['refresh_expires_at', '2026-11-28T12:59:59.999Z'],
    ['observed_at', 'invalid'], ['observed_at', null], ['observed_at', undefined], ['observed_at', 0], ['observed_at', true],
    ['actor_version', undefined], ['membership_version', null], ['session_created_version', 'now'],
    ['access_version', null], ['refresh_version', null], ['csrf_token_hash', null],
  ])('denies mismatched/inactive/incomplete source authority %s: %p', (key, value) => {
    denied(() => projectContext({ ...row(), [key]: value }, principal()), 'enterprise_membership_required');
  });

  test.each([
    { profile_id: null }, { version_label: 'org-profile-v0' }, { normalized_profile_hash: 'not-a-hash' },
    { raw_profile: null }, { raw_profile: [] }, { raw_profile: { headquarters: { additionalOffices: null } } },
    { raw_profile: { headquarters: { additionalOffices: [{ name: 'Missing ID' }] } } },
    { raw_profile: { headquarters: { additionalOffices: [{ id: 'headquarters' }] } } },
    { raw_profile: { headquarters: { additionalOffices: [{ id: 'Office.East' }, { id: 'office.east' }] } } },
  ])('reports unavailable malformed/ambiguous current profile without inventing a location: %p', change => {
    denied(() => projectContext({ ...row(), ...change }, principal()), 'enterprise_location_source_unavailable');
  });

  test('binds both simultaneous sessions and preserves exact microsecond membership revisions', () => {
    const first = projectContext(row(), principal());
    const second = projectContext({ ...row(), session_id: id(8) }, { ...principal(), sessionId: id(8) });
    expect(first.binding).not.toBe(second.binding);
    const changed = projectContext({ ...row(), membership_version: '2026-11-28T12:00:00.123457Z' }, principal());
    expect(changed.binding).not.toBe(first.binding);
    denied(() => resolveSelection(second, selection(first)), 'enterprise_context_changed');
    denied(() => resolveSelection(changed, selection(first)), 'enterprise_context_changed');
  });

  test('binds profile and actual source keys without treating observation time as a reusable grant', () => {
    const first = projectContext(row(), principal());
    const later = projectContext({ ...row(), observed_at: '2026-11-28T13:00:01.000Z' }, principal());
    expect(later.binding).toBe(first.binding);
    expect(later.observedAt).not.toBe(first.observedAt);
    expect(projectContext({ ...row(), raw_profile: {} }, principal()).binding).not.toBe(first.binding);
    expect(projectContext({ ...row(), normalized_profile_hash: 'c'.repeat(64) }, principal()).binding).not.toBe(first.binding);
  });

  test('bounds source metadata independently of plan limits', () => {
    const offices = Array.from({ length: 1000 }, (_, index) => ({ id: 'Office-' + index }));
    denied(() => projectContext({ ...row(), raw_profile: { headquarters: { additionalOffices: offices } } }, principal()), 'enterprise_location_source_unavailable');
  });
});

describe('Mission 29 Part 1C explicit location selection requests', () => {
  test('validates an explicit source pin and returns fresh server provenance rather than supplied metadata', () => {
    const context = projectContext(row(), principal()), input = selection(context);
    input.location.provenance.declaredByActorId = id(999);
    const result = resolveSelection(context, input);
    expect(result.selectedLocation).toBe(context.locations[0]);
    expect(result.selectedLocation.reference.provenance.declaredByActorId).toBe(id(1));
    expect(context.selectedLocation).toBeNull();
  });
  for (const field of ['contract', 'binding', 'location']) {
    test.each(['missing', null, undefined])('denies omitted or incomplete selection ' + field + ': %p', value => {
      const context = projectContext(row(), principal()), input = selection(context);
      if (value === 'missing') delete input[field]; else input[field] = value;
      denied(() => resolveSelection(context, input), field === 'location' && value !== 'missing' ? 'enterprise_location_unavailable' : 'enterprise_selection_invalid');
    });
  }
  test.each([
    ref => { ref.organizationId = id(8); }, ref => { ref.locationKey = '*'; },
    ref => { ref.locationKey = 'office.east'; }, ref => { ref.profilePin.version = 'org-profile-v2'; },
    ref => { ref.profilePin.id = id(8); }, ref => { ref.profilePin.hash = 'c'.repeat(64); },
    ref => { ref.kind = 'location_identity'; }, ref => { ref.grants = ['owner']; },
    ref => { delete ref.organizationId; }, ref => { ref.profilePin = null; },
  ])('denies forged/foreign/stale/adoption reference input: %p', change => {
    const context = projectContext(row(), principal()), input = selection(context); change(input.location);
    denied(() => resolveSelection(context, input), 'enterprise_location_unavailable');
  });
  test('rejects alternate contracts, extra scope fields and malformed bindings', () => {
    const context = projectContext(row(), principal());
    for (const change of [{ contract: 'v2' }, { binding: '*' }, { organizationId: id(8) }]) {
      denied(() => resolveSelection(context, { ...selection(context), ...change }), 'enterprise_selection_invalid');
    }
  });

  test('rejects hidden, inherited, symbol and getter selection fields without invoking getters', () => {
    const context = projectContext(row(), principal()); let reads = 0;
    const accessor = selection(context);
    Object.defineProperty(accessor, 'location', { enumerable: true, get() { reads++; return context.locations[0].reference; } });
    const hidden = selection(context); Object.defineProperty(hidden, 'location', { enumerable: false });
    for (const input of [accessor, hidden, Object.assign(Object.create({ grants: true }), selection(context)), { ...selection(context), [Symbol('grant')]: true }]) {
      denied(() => resolveSelection(context, input), 'enterprise_selection_invalid');
    }
    expect(reads).toBe(0);
  });
});
