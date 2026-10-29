'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART7B_COMMUNICATION_PERMISSION_CONTRACT.md');
const MIGRATION = path.join(ROOT, 'migrations/282_canonical_automation_communication_permission_v1.sql');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();

const exactKeys = (value, expected) => {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string') || expected.some(key => !keys.includes(key))) throw new Error('shape');
};
function assertPlainData(value, seen = new Set()) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('scalar');
    return;
  }
  if (types.isProxy(value) || typeof value !== 'object' || seen.has(value)) throw new Error('plain');
  seen.add(value);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw new Error('prototype');
  if (array && Object.keys(value).length !== value.length) throw new Error('sparse');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('descriptor');
    assertPlainData(descriptor.value, seen);
  }
  seen.delete(value);
}

const VERSION_KEYS = ['schemaVersion', 'tenantId', 'permissionId', 'version', 'recipientBinding', 'channelId', 'preferenceState', 'permissionState', 'basisState', 'basisEvidenceDigest', 'jurisdictionState', 'ageRestrictionState', 'quietHoursState', 'suppressionState', 'previousVersionDigest', 'permissionDigest', 'actorBinding', 'reviewedAt', 'requestDigest'];
const RECIPIENT_KEYS = ['senderRecipientResolutionId', 'recipientIndex', 'recipientClass', 'recipientRecordId', 'parentCustomerId', 'membershipId', 'role', 'sourceDigest', 'contactIdentityDigest'];
const ACTOR_KEYS = ['actorId', 'sessionId', 'membershipId', 'membershipRole'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const states = contract.versionedPermission;
function expectedSuppression(value) {
  if (value.permissionState === 'do_not_contact') return 'suppressed_do_not_contact';
  if (value.permissionState === 'opted_out') return 'suppressed_opt_out';
  if (value.permissionState === 'conflicting' || value.basisState === 'conflicting_evidence') return 'suppressed_conflicting';
  if (value.preferenceState === 'blocked') return 'suppressed_preference';
  if (value.jurisdictionState === 'restricted') return 'suppressed_jurisdiction';
  if (value.ageRestrictionState === 'restricted') return 'suppressed_age';
  if (value.quietHoursState === 'restricted') return 'suppressed_quiet_hours';
  if (value.recipientBinding.recipientClass === 'staff_member' && value.channelId === 'in_app_passive' && value.permissionState === 'internal_membership_current' && value.basisState === 'authenticated_tenant_membership' && ['allowed', 'preferred'].includes(value.preferenceState) && value.jurisdictionState === 'not_applicable_internal' && value.ageRestrictionState === 'not_applicable_internal' && value.quietHoursState === 'not_applicable_internal_passive') return 'clear_internal_passive';
  return 'unavailable';
}
function validateVersion(value) {
  assertPlainData(value); exactKeys(value, VERSION_KEYS); exactKeys(value.recipientBinding, RECIPIENT_KEYS); exactKeys(value.actorBinding, ACTOR_KEYS);
  if (value.schemaVersion !== 'mission28.communication-permission-version.v1' || !states.permissionStates.includes(value.permissionState) || !states.preferenceStates.includes(value.preferenceState) || !states.basisStates.includes(value.basisState) || !states.jurisdictionStates.includes(value.jurisdictionState) || !states.ageRestrictionStates.includes(value.ageRestrictionState) || !states.quietHoursStates.includes(value.quietHoursState) || !states.suppressionStates.includes(value.suppressionState)) throw new Error('enum');
  const basis = { unknown: 'none_unknown', reported_opt_in_unverified: 'owner_reviewed_reported_basis_unverified', opted_out: 'recipient_opt_out', do_not_contact: 'recipient_do_not_contact', internal_membership_current: 'authenticated_tenant_membership' };
  if (basis[value.permissionState] && basis[value.permissionState] !== value.basisState) throw new Error('basis');
  if ((value.permissionState === 'conflicting') !== (value.basisState === 'conflicting_evidence')) throw new Error('conflict-basis');
  if (value.suppressionState !== expectedSuppression(value)) throw new Error('suppression');
  if (value.channelId === 'in_app_passive' && value.recipientBinding.recipientClass !== 'staff_member') throw new Error('internal-recipient');
  if (value.channelId !== 'in_app_passive' && value.permissionState === 'internal_membership_current') throw new Error('external-internal');
  if ((value.recipientBinding.recipientClass !== 'staff_member' || value.channelId !== 'in_app_passive') &&
      (value.jurisdictionState === 'not_applicable_internal' || value.ageRestrictionState === 'not_applicable_internal' || value.quietHoursState === 'not_applicable_internal_passive')) throw new Error('internal-applicability');
  if (![value.tenantId, value.permissionId, value.recipientBinding.senderRecipientResolutionId, value.recipientBinding.recipientRecordId, value.actorBinding.actorId, value.actorBinding.sessionId, value.actorBinding.membershipId].every(identifier => typeof identifier === 'string' && UUID.test(identifier))) throw new Error('identity');
  if (![value.recipientBinding.sourceDigest, value.recipientBinding.contactIdentityDigest, value.basisEvidenceDigest, value.permissionDigest, value.requestDigest].every(digest => typeof digest === 'string' && DIGEST.test(digest))) throw new Error('digest');
  if (!Number.isSafeInteger(value.version) || value.version < 1 || !Number.isSafeInteger(value.recipientBinding.recipientIndex) || value.recipientBinding.recipientIndex < 0 || value.recipientBinding.recipientIndex > 15) throw new Error('number');
  const isStaff = value.recipientBinding.recipientClass === 'staff_member';
  if (isStaff !== (value.recipientBinding.parentCustomerId === null && UUID.test(value.recipientBinding.membershipId || '') && ['owner', 'member'].includes(value.recipientBinding.role))) throw new Error('recipient-subject');
  if (!isStaff && !(UUID.test(value.recipientBinding.parentCustomerId || '') && value.recipientBinding.membershipId === null && value.recipientBinding.role === null)) throw new Error('recipient-subject');
  if (value.actorBinding.membershipRole !== 'owner') throw new Error('actor');
  return true;
}
const uuid = suffix => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const sha = digit => `sha256:${digit.repeat(64)}`;
const fixture = () => ({
  schemaVersion: 'mission28.communication-permission-version.v1', tenantId: uuid(28), permissionId: uuid(700), version: 1,
  recipientBinding: { senderRecipientResolutionId: uuid(701), recipientIndex: 0, recipientClass: 'staff_member', recipientRecordId: uuid(702), parentCustomerId: null, membershipId: uuid(703), role: 'member', sourceDigest: sha('1'), contactIdentityDigest: sha('2') },
  channelId: 'in_app_passive', preferenceState: 'allowed', permissionState: 'internal_membership_current', basisState: 'authenticated_tenant_membership', basisEvidenceDigest: sha('3'), jurisdictionState: 'not_applicable_internal', ageRestrictionState: 'not_applicable_internal', quietHoursState: 'not_applicable_internal_passive', suppressionState: 'clear_internal_passive', previousVersionDigest: null, permissionDigest: sha('4'), actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: 'owner' }, reviewedAt: '2026-10-28T12:00:00.000000Z', requestDigest: sha('5')
});

describe('Mission 28 Part 7B communication permission and suppression authority', () => {
  test('binds the exact released Part 7A baseline and frozen prerequisite hashes', () => {
    expect(contract.authority.baselineCommit).toBe('5cf2946de60576f5a0eb801cd8886597947264d4');
    expect(contract.authority.part7ARelease).toMatchObject({ acceptedSourceHead: '675ddc5ed0985b4c4d0d122f9299dce8abee46ac', pullRequest: 575, deployment: '3a64444e-1094-41c0-9d45-7c5375af74a8', auditVerdict: 'P0=P1=P2=P3=0' });
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test('has closed version vocabularies and deterministic reducing-state precedence', () => {
    expect(contract.suppressionPrecedence).toEqual(['suppressed_do_not_contact', 'suppressed_opt_out', 'suppressed_conflicting', 'suppressed_preference', 'suppressed_jurisdiction', 'suppressed_age', 'suppressed_quiet_hours', 'unavailable', 'clear_internal_passive']);
    expect(validateVersion(fixture())).toBe(true);
    const cases = [
      ['do_not_contact', 'recipient_do_not_contact', 'suppressed_do_not_contact'],
      ['opted_out', 'recipient_opt_out', 'suppressed_opt_out'],
      ['conflicting', 'conflicting_evidence', 'suppressed_conflicting'],
      ['unknown', 'none_unknown', 'unavailable'],
      ['reported_opt_in_unverified', 'owner_reviewed_reported_basis_unverified', 'unavailable']
    ];
    for (const [permissionState, basisState, suppressionState] of cases) {
      const value = fixture(); value.channelId = 'email'; value.recipientBinding.recipientClass = 'customer'; value.recipientBinding.parentCustomerId = value.recipientBinding.recipientRecordId; value.recipientBinding.membershipId = null; value.recipientBinding.role = null; value.preferenceState = 'allowed'; value.permissionState = permissionState; value.basisState = basisState; value.jurisdictionState = 'unknown'; value.ageRestrictionState = 'unknown'; value.quietHoursState = 'unknown'; value.suppressionState = suppressionState;
      expect(validateVersion(value)).toBe(true);
    }
  });

  test('never promotes reported opt-in, owner review, legacy preference or billing document use into external authority', () => {
    expect(contract.versionedPermission.externalOptInRule).toContain('remains_unavailable');
    for (const denial of ['reported_opt_in_or_owner_review_treated_as_accepted_external_consent_or_legal_basis', 'legacy_notification_preference_or_destination_treated_as_customer_permission', 'billing_document_use_authority_treated_as_general_communication_consent']) expect(contract.deniedCombinations).toContain(denial);
    expect(contract.privacyAndEffects).toMatchObject({ providerAttempts: 0, recipientMessages: 0, externalEffects: 0, upstreamMutations: 0, accountingMutations: 0, moneyEffects: 0 });
  });

  test('rejects contradictory state combinations, external internal-membership reuse, unknown fields and missing fields', () => {
    const attacks = [];
    let value = fixture(); value.suppressionState = 'unavailable'; attacks.push(value);
    value = fixture(); value.permissionState = 'opted_out'; value.basisState = 'none_unknown'; value.suppressionState = 'suppressed_opt_out'; attacks.push(value);
    value = fixture(); value.channelId = 'email'; attacks.push(value);
    value = fixture(); value.recipientBinding.recipientClass = 'customer'; value.recipientBinding.parentCustomerId = value.recipientBinding.recipientRecordId; value.recipientBinding.membershipId = null; value.recipientBinding.role = null; attacks.push(value);
    value = fixture(); value.channelId = 'email'; value.recipientBinding.recipientClass = 'customer'; value.recipientBinding.parentCustomerId = value.recipientBinding.recipientRecordId; value.recipientBinding.membershipId = null; value.recipientBinding.role = null; value.permissionState = 'unknown'; value.basisState = 'none_unknown'; value.suppressionState = 'unavailable'; attacks.push(value);
    value = fixture(); value.channelId = 'email'; value.recipientBinding.recipientClass = 'customer'; value.recipientBinding.parentCustomerId = value.recipientBinding.recipientRecordId; value.recipientBinding.membershipId = null; value.recipientBinding.role = null; value.permissionState = 'conflicting'; value.basisState = 'none_unknown'; value.suppressionState = 'suppressed_conflicting'; attacks.push(value);
    value = fixture(); value.unexpected = true; attacks.push(value);
    value = fixture(); delete value.requestDigest; attacks.push(value);
    value = fixture(); value.actorBinding.actorId = '00000000-0000-0000-0000-000000000010'; attacks.push(value);
    value = fixture(); value.recipientBinding.sourceDigest = 'not-a-digest'; attacks.push(value);
    for (const attack of attacks) expect(() => validateVersion(attack)).toThrow();
  });

  test('rejects non-plain, accessor, symbol, sparse and proxy values before reading candidate leaves', () => {
    const getter = jest.fn(() => 'owner'); const accessor = fixture(); Object.defineProperty(accessor.actorBinding, 'membershipRole', { enumerable: true, get: getter });
    expect(() => validateVersion(accessor)).toThrow('descriptor'); expect(getter).not.toHaveBeenCalled();
    const symbol = fixture(); symbol.recipientBinding[Symbol('hidden')] = true; expect(() => validateVersion(symbol)).toThrow('symbol');
    const custom = fixture(); Object.setPrototypeOf(custom.recipientBinding, { widened: true }); expect(() => validateVersion(custom)).toThrow('prototype');
    const proxy = new Proxy(fixture(), {}); expect(() => validateVersion(proxy)).toThrow('plain');
    const sparse = fixture(); sparse.recipientBinding = Object.assign([], { 1: 'gap' }); expect(() => validateVersion(sparse)).toThrow();
  });

  test('migration 282 is forced-RLS, immutable, owner-only, source-current and no-effect', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const table of ['communication_permission_subjects', 'communication_permission_versions', 'communication_permission_resolutions', 'permission_resolution_items']) {
      expect(sql).toContain(`canonical_automation_${table}_v1`);
    }
    expect((sql.match(/FORCE ROW LEVEL SECURITY/g) || [])).toHaveLength(4);
    expect((sql.match(/canonical_automation_immutable_v1\(\)/g) || [])).toHaveLength(4);
    expect(sql).toContain('canonical_automation_part7b_recipient_current_v1');
    expect((sql.match(/FOR SHARE OF session,membership,account/g) || [])).toHaveLength(2);
    expect((sql.match(/:m28-communication-permission:/g) || []).length).toBeGreaterThanOrEqual(2);
    const resolutionSql = sql.slice(sql.indexOf('CREATE FUNCTION public.canonical_automation_record_communication_permission_resolution_v1'));
    expect(resolutionSql.indexOf(":m28-communication-permission:'||(binding->>'permissionId')")).toBeLessThan(resolutionSql.indexOf('canonical_automation_part7b_recipient_current_v1(org,sender_resolution_value,0)'));
    expect(sql).not.toContain('providerAttempts');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.canonical_automation_record_communication_permission_version_v1/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.canonical_automation_record_communication_permission_resolution_v1/);
  });

  test('records Parts 7A-7C released, only Part 7D candidate, migration284/no285 and Part 7E+ planned', () => {
    for (const document of [fs.readFileSync(ROADMAP, 'utf8'), fs.readFileSync(LEDGER, 'utf8')]) {
      expect(document).toContain('Parts 1A–11B are released. Part 11C is the sole implementation candidate.');
      expect(document).toContain('Parts 11D–14G remain planned and unimplemented.');
      expect(document).toContain('3a64444e-1094-41c0-9d45-7c5375af74a8');
    }
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    expect(ledger).toContain('| 27 | 7A | Exact sender and recipient authority | **Released** |');
    expect(ledger).toContain('| 28 | 7B | Communication permission, preference, consent basis and suppression | **Released** |');
    expect(ledger).toContain('| 29 | 7C | Approved templates, bounded variables and AI-draft boundary | **Released** |');
    expect(ledger).toContain('| 30 | 7D | Provider-neutral email/SMS and truthful native handoff | **Released** |');
    const names = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3)));
    expect(names).toHaveLength(283); expect(names.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql'); expect(names.some(name => name.startsWith('288_'))).toBe(false);
  });

  test('keeps Part 7C+ and every provider, message, effect, money, legal and founder boundary unavailable', () => {
    expect(contract.runtimeBoundary).toMatchObject({ mountedRuntimeConsumer: false, part7CContentAuthority: false, part7DChannelProviderAuthority: false, part7EOrLaterAuthority: false });
    expect(contract.unavailableEvidence.join(' ')).toMatch(/real recipients messages/);
    const md = fs.readFileSync(CONTRACT_MD, 'utf8');
    expect(md).toContain('never a name, email, phone, address, message, token, provider identifier, or contact value');
    expect(md).toContain('This slice grants none of them');
  });
});
