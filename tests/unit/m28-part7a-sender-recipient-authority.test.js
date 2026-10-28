'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: { isProxy } } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT = require('../../docs/architecture/MISSION_28_PART7A_SENDER_RECIPIENT_AUTHORITY_CONTRACT.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));

function normalizedLfSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n?/g, '\n')).digest('hex').toUpperCase();
}
function plain(value, seen = new Set()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object' || isProxy(value) || seen.has(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string')) throw new Error('plain');
  seen.add(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) throw new Error('array');
    for (const item of value) plain(item, seen);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(descriptors).some(key => key === 'toJSON' || !descriptors[key].enumerable || !('value' in descriptors[key]))) throw new Error('object');
    for (const descriptor of Object.values(descriptors)) plain(descriptor.value, seen);
  }
}
function exact(value, fields, label) {
  if (!value || Object.keys(value).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) throw new Error(`${label} shape`);
}
function trusted(value) {
  return { tenantId: value.tenantId, transactionId: value.transactionId, unitId: value.unitId, senderBinding: copy(value.senderBinding), recipients: copy(value.recipients), actorBinding: copy(value.actorBinding) };
}
function reseal(value) {
  const body = copy(value); delete body.requestDigest;
  value.requestDigest = canonical.digest(CONTRACT.resolutionEnvelope.requestDigestNamespace, body);
  return value;
}
function recipient(index, recipientClass, record, parent = null, membership = null, role = null) {
  return { recipientIndex: index, recipientClass, recipientRecordId: record, parentCustomerId: parent,
    membershipId: membership, role, sourceDigest: hash(`source-${index}`), contactIdentityDigest: hash(`contact-${index}`) };
}
function fixture(suffix = 1) {
  return reseal({
    schemaVersion: CONTRACT.resolutionEnvelope.schemaVersion, tenantId: uuid(28), resolutionId: uuid(700000 + suffix),
    transactionId: uuid(710000 + suffix), unitId: uuid(720000 + suffix),
    senderBinding: { senderClass: 'tenant_business_profile', businessProfileId: uuid(20), businessProfileVersion: 3, businessProfileDigest: hash('profile') },
    recipients: [
      recipient(0, 'customer', uuid(100), uuid(100)),
      recipient(1, 'authorized_billing_contact', uuid(101), uuid(100)),
      recipient(2, 'lead_or_prospect', uuid(102), uuid(103)),
      recipient(3, 'staff_member', uuid(10), null, uuid(10), 'admin'),
    ],
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: 'admin', requestedAt: '2026-10-28T12:00:00.000000Z' },
    requestDigest: '',
  });
}
function validate(value, resolution, actionUnitRecipientSetDigest = null) {
  plain(value); plain(resolution);
  exact(value, CONTRACT.resolutionEnvelope.exactFields, 'root');
  exact(value.senderBinding, CONTRACT.resolutionEnvelope.senderBindingExactFields, 'sender');
  exact(value.actorBinding, CONTRACT.resolutionEnvelope.actorBindingExactFields, 'actor');
  if (value.schemaVersion !== CONTRACT.resolutionEnvelope.schemaVersion || ![value.tenantId, value.resolutionId, value.transactionId, value.unitId].every(item => UUID.test(item))) throw new Error('identity');
  if (value.senderBinding.senderClass !== 'tenant_business_profile' || !UUID.test(value.senderBinding.businessProfileId) || !Number.isSafeInteger(value.senderBinding.businessProfileVersion) || value.senderBinding.businessProfileVersion < 1 || !DIGEST.test(value.senderBinding.businessProfileDigest)) throw new Error('sender');
  if (![value.actorBinding.actorId, value.actorBinding.sessionId, value.actorBinding.membershipId].every(item => UUID.test(item)) || !['owner', 'admin'].includes(value.actorBinding.membershipRole) || !TIME.test(value.actorBinding.requestedAt)) throw new Error('actor');
  if (!Array.isArray(value.recipients) || value.recipients.length < 1 || value.recipients.length > CONTRACT.resolutionEnvelope.maximumRecipients) throw new Error('recipients');
  const identities = new Set(); const contacts = new Set();
  value.recipients.forEach((item, index) => {
    exact(item, CONTRACT.resolutionEnvelope.recipientExactFields, 'recipient');
    if (item.recipientIndex !== index || !Number.isSafeInteger(index) || !CONTRACT.recipientClasses.some(candidate => candidate.id === item.recipientClass) || !UUID.test(item.recipientRecordId) || !DIGEST.test(item.sourceDigest) || !DIGEST.test(item.contactIdentityDigest)) throw new Error('recipient');
    if (item.recipientClass === 'customer' && (item.parentCustomerId !== item.recipientRecordId || item.membershipId !== null || item.role !== null)) throw new Error('customer binding');
    if (['authorized_billing_contact', 'lead_or_prospect'].includes(item.recipientClass) && (!UUID.test(item.parentCustomerId || '') || item.membershipId !== null || item.role !== null)) throw new Error('customer child binding');
    if (item.recipientClass === 'staff_member' && (item.parentCustomerId !== null || !UUID.test(item.membershipId || '') || !['owner', 'admin', 'member', 'viewer'].includes(item.role))) throw new Error('staff binding');
    const identity = `${item.recipientClass}:${item.recipientRecordId}`; if (identities.has(identity) || contacts.has(item.contactIdentityDigest)) throw new Error('duplicate'); identities.add(identity); contacts.add(item.contactIdentityDigest);
  });
  if (!DIGEST.test(value.requestDigest) || reseal(copy(value)).requestDigest !== value.requestDigest) throw new Error('digest');
  if (canonical.canonicalize(resolution) !== canonical.canonicalize(trusted(value))) throw new Error('trusted resolution');
  const recipientSetDigest = canonical.digest(CONTRACT.resolutionEnvelope.recipientSetDigestNamespace, value.recipients);
  if (actionUnitRecipientSetDigest !== null && actionUnitRecipientSetDigest !== recipientSetDigest) throw new Error('action unit recipient set');
  return recipientSetDigest;
}
class Store {
  constructor() { this.ids = new Map(); this.material = new Set(); }
  apply(value, resolution, actionUnitRecipientSetDigest) {
    const setDigest = validate(value, resolution, actionUnitRecipientSetDigest);
    const prior = this.ids.get(value.resolutionId);
    if (prior) { if (prior.requestDigest !== value.requestDigest || canonical.canonicalize(prior) !== canonical.canonicalize(value)) throw new Error('identity conflict'); return { replayed: true, recipientSetDigest: setDigest }; }
    const materialValue = copy(value); delete materialValue.resolutionId; delete materialValue.requestDigest;
    const material = canonical.digest('mission28.sender-recipient-material.v1\n', materialValue);
    if (this.material.has(material)) throw new Error('material replay');
    this.ids.set(value.resolutionId, copy(value)); this.material.add(material); return { replayed: false, recipientSetDigest: setDigest };
  }
}

describe('Mission 28 Part 7A exact sender and recipient authority', () => {
  test('freezes exact source-linked authority and preserves later-slice and no-effect boundaries', () => {
    expect(CONTRACT.authority).toEqual(expect.objectContaining({ mission: 28, part: '7A', state: 'implementation_candidate_only', messageProviderRecipientContactOrEffectAuthorityGranted: false }));
    expect(CONTRACT.recipientClasses.map(item => item.id)).toEqual(['customer', 'authorized_billing_contact', 'lead_or_prospect', 'staff_member']);
    expect(CONTRACT.unsupportedRecipients).toEqual(expect.arrayContaining(['free_form_email_phone_or_address', 'fuzzy_name_or_contact_match', 'cross_customer_contact_reuse']));
    expect(CONTRACT.resolutionEnvelope.contactIdentityDigestMaterial).toContain('without_recipient_class_record_or_customer_context');
    expect(CONTRACT.storageContract.runtimeExecuteGranted).toBe(false);
    expect(CONTRACT.laterSliceBoundary.part7B).toContain('not_implemented');
    for (const input of CONTRACT.frozenInputs) expect(normalizedLfSha256(input.path)).toBe(input.normalizedLfSha256);
  });

  test('accepts the closed ordered classes and exact separately trusted material', () => {
    const value = fixture(); const setDigest = canonical.digest(CONTRACT.resolutionEnvelope.recipientSetDigestNamespace, value.recipients);
    expect(validate(value, trusted(value), setDigest)).toBe(setDigest);
  });

  test('rejects unsupported, free-form, reordered, duplicate and cross-customer recipient widening', () => {
    const mutations = [
      value => { value.recipients[0].recipientClass = 'collection_agency_legal_credit_or_other_external'; },
      value => { value.recipients[0].email = 'customer@example.test'; },
      value => { [value.recipients[0], value.recipients[1]] = [value.recipients[1], value.recipients[0]]; },
      value => { value.recipients[1].contactIdentityDigest = value.recipients[0].contactIdentityDigest; },
      value => { value.recipients[1].parentCustomerId = uuid(999); },
      value => { value.recipients[2].parentCustomerId = null; },
      value => { value.recipients[3].membershipId = uuid(999); },
      value => { value.recipients[3].role = 'super_admin'; },
    ];
    for (const mutate of mutations) { const attack = fixture(); mutate(attack); reseal(attack); expect(() => validate(attack, trusted(fixture()))).toThrow(); }
  });

  test('rejects malformed primitives, source substitutions and action-unit digest mismatch', () => {
    const canonicalValue = fixture(); const mutations = [
      value => { value.senderBinding.businessProfileId = 'profile'; }, value => { value.senderBinding.businessProfileVersion = 0; },
      value => { value.recipients[0].sourceDigest = 'source'; }, value => { value.recipients[0].recipientIndex = 1; },
      value => { value.actorBinding.actorId = ''; }, value => { value.actorBinding.requestedAt = 'later'; }, value => { value.extra = true; },
    ];
    for (const mutate of mutations) { const attack = copy(canonicalValue); mutate(attack); reseal(attack); expect(() => validate(attack, trusted(canonicalValue))).toThrow(); }
    expect(() => validate(canonicalValue, trusted(canonicalValue), hash('wrong-set'))).toThrow('action unit recipient set');
  });

  test('rejects hostile data before hooks and accepts no caller-created trust', () => {
    const value = fixture(); let getterCalls = 0; const accessor = copy(value);
    Object.defineProperty(accessor.recipients[0], 'sourceDigest', { enumerable: true, get() { getterCalls += 1; return value.recipients[0].sourceDigest; } });
    expect(() => validate(accessor, trusted(value))).toThrow('object'); expect(getterCalls).toBe(0);
    let proxyTraps = 0; const proxy = new Proxy(copy(value), { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); }, get(target, key, receiver) { proxyTraps += 1; return Reflect.get(target, key, receiver); } });
    expect(() => validate(proxy, trusted(value))).toThrow('plain'); expect(proxyTraps).toBe(0);
    const symbol = copy(value); symbol[Symbol('hidden')] = true; expect(() => validate(symbol, trusted(value))).toThrow('plain');
    const toJSON = copy(value); Object.defineProperty(toJSON.senderBinding, 'toJSON', { enumerable: false, value() { throw new Error('must not run'); } }); expect(() => validate(toJSON, trusted(value))).toThrow('object');
  });

  test('validates before replay or coalescing and denies clone reuse under a new identity', () => {
    const store = new Store(); const value = fixture(8); const setDigest = canonical.digest(CONTRACT.resolutionEnvelope.recipientSetDigestNamespace, value.recipients);
    expect(store.apply(value, trusted(value), setDigest).replayed).toBe(false); expect(store.apply(copy(value), trusted(value), setDigest).replayed).toBe(true);
    const malformed = copy(value); malformed.extra = true; expect(() => store.apply(malformed, trusted(value), setDigest)).toThrow('root shape');
    const clone = copy(value); clone.resolutionId = uuid(799999); reseal(clone); expect(() => store.apply(clone, trusted(clone), setDigest)).toThrow('material replay');
  });

  test('migration binds all source families, forced RLS, immutability and no runtime/effect grant', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/281_canonical_automation_sender_recipient_authority_v1.sql'), 'utf8');
    for (const token of ['canonical_automation_sender_recipient_resolutions_v1', 'canonical_automation_recipient_authority_items_v1', 'canonical_automation_record_sender_recipient_resolution_v1', 'canonical_business_profiles', 'canonical_customers', 'canonical_customer_financial_billing_identity_reviews_v1', 'canonical_opportunities', 'organization_memberships', 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', ':billing-identity-customer:']) expect(sql).toContain(token);
    for (const forbidden of ['GRANT EXECUTE', 'fetch(', 'axios', 'twilio', 'retell', "state='sent'", "state='delivered'", 'UPDATE public.canonical_', 'DELETE FROM public.canonical_']) expect(sql).not.toContain(forbidden);
    expect((sql.match(/CREATE TABLE public\.canonical_automation_(sender_recipient|recipient_authority)/g) || [])).toHaveLength(2);
  });

  test('records Part 6F released, Part 7A released, only Part 7B candidate, migration282/no283 and Part 7C+ planned', () => {
    for (const relative of ['docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md', 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md']) {
      const document = fs.readFileSync(path.join(ROOT, relative), 'utf8'); expect(document).toContain('Parts 1A–7A released; Part 7B implementation candidate only.'); expect(document).toContain('Parts 7C–14G remain planned and unimplemented.'); expect(document).toContain('020491c14f54f8a849f87ea197cdff462a930f6a');
    }
    const ledger = fs.readFileSync(path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md'), 'utf8');
    expect(ledger).toContain('| 26 | 6F | Restart/migration/outage/restore and orphan-authority recovery | **Released** |');
    expect(ledger).toContain('| 27 | 7A | Exact sender and recipient authority | **Released** |');
    expect(ledger).toContain('through additive `282_canonical_automation_communication_permission_v1.sql` with no 283');
  });
});
