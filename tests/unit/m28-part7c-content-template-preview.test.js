'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');
const canonical = require('../../src/automation/canonicalJson');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART7C_CONTENT_TEMPLATE_PREVIEW_CONTRACT.md');
const MIGRATION = path.join(ROOT, 'migrations/283_canonical_automation_content_template_preview_v1.sql');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const digestLf = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase();
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

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
    if (array && key === 'length') continue;
    if (typeof key !== 'string') throw new Error('symbol');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) throw new Error('descriptor');
    assertPlainData(descriptor.value, seen);
  }
  seen.delete(value);
}
function exactKeys(value, expected) {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) throw new Error('shape');
}

const PREVIEW_KEYS = contract.previewEnvelope.exactFields;
const TEMPLATE_KEYS = contract.previewEnvelope.templateBindingExactFields;
const VARIABLE_KEYS = contract.previewEnvelope.variableBindingExactFields;
const ACTOR_KEYS = contract.previewEnvelope.actorBindingExactFields;
const UUID = new RegExp(contract.identityGrammar.uuidPattern);
const DIGEST = new RegExp(contract.identityGrammar.digestPattern);
const UTC = new RegExp(contract.identityGrammar.utcInstantPattern);

function templateDefinition(entry) {
  return {
    contentTemplateId: entry.contentTemplateId, contentTemplateVersion: entry.contentTemplateVersion,
    actionTemplateId: entry.actionTemplateId, actionTemplateDigest: entry.actionTemplateDigest,
    actionFamilyId: entry.actionFamilyId, localeId: entry.localeId, languageId: entry.languageId,
    contentFormat: entry.contentFormat, wordingOrigin: entry.wordingOrigin,
    variableSchema: entry.variableSchema, titlePattern: entry.titlePattern, bodyPattern: entry.bodyPattern,
    linkSelectionPolicy: entry.linkSelectionPolicy, attachmentSelectionPolicy: entry.attachmentSelectionPolicy,
    customerSafeRule: entry.customerSafeRule
  };
}
function trusted(value) {
  return Object.fromEntries(['tenantId', 'transactionId', 'unitId', 'senderRecipientResolutionId', 'permissionResolutionId', 'templateBinding', 'variableBindings', 'localeId', 'languageId', 'linkSelections', 'attachmentSelections', 'actorBinding', 'previewedAt'].map(key => [key, copy(value[key])]));
}
function preview(entry = contract.approvedTemplateCatalog[0]) {
  const value = {
    schemaVersion: 'mission28.content-preview.v1', tenantId: uuid(28), contentPreviewId: uuid(900001),
    transactionId: uuid(600001), unitId: uuid(600002), senderRecipientResolutionId: uuid(700001), permissionResolutionId: uuid(800001),
    templateBinding: {
      contentTemplateId: entry.contentTemplateId, contentTemplateVersion: entry.contentTemplateVersion,
      contentTemplateDigest: entry.contentTemplateDigest, actionTemplateId: entry.actionTemplateId,
      actionTemplateDigest: entry.actionTemplateDigest, actionFamilyId: entry.actionFamilyId,
      contentFormat: entry.contentFormat, wordingOrigin: entry.wordingOrigin, customerSafeRule: entry.customerSafeRule
    },
    variableBindings: [{ name: 'actionLabel', valueId: entry.variableSchema[0].allowedValueId, valueDigest: entry.variableValueDigest }],
    localeId: entry.localeId, languageId: entry.languageId, linkSelections: [], attachmentSelections: [],
    actorBinding: { actorId: uuid(10), sessionId: uuid(11), membershipId: uuid(10), membershipRole: 'owner' },
    previewedAt: '2026-10-28T12:00:00.000000Z', requestDigest: ''
  };
  value.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function project(value, separatelyTrusted = trusted(value), serverResolved = separatelyTrusted, materialIndex = null) {
  assertPlainData(value); assertPlainData(separatelyTrusted); assertPlainData(serverResolved); exactKeys(value, PREVIEW_KEYS);
  exactKeys(value.templateBinding, TEMPLATE_KEYS); exactKeys(value.variableBindings[0], VARIABLE_KEYS); exactKeys(value.actorBinding, ACTOR_KEYS);
  if (value.schemaVersion !== 'mission28.content-preview.v1' || ![value.tenantId, value.contentPreviewId, value.transactionId, value.unitId, value.senderRecipientResolutionId, value.permissionResolutionId, value.actorBinding.actorId, value.actorBinding.sessionId, value.actorBinding.membershipId].every(item => UUID.test(item))) throw new Error('identity');
  if (value.actorBinding.membershipRole !== 'owner' || !UTC.test(value.previewedAt) || value.localeId !== 'en-US' || value.languageId !== 'en') throw new Error('binding');
  if (!Array.isArray(value.variableBindings) || value.variableBindings.length !== 1 || value.linkSelections.length !== 0 || value.attachmentSelections.length !== 0) throw new Error('bounds');
  const entry = contract.approvedTemplateCatalog.find(item => item.contentTemplateId === value.templateBinding.contentTemplateId);
  if (!entry) throw new Error('catalog');
  const expectedBinding = {
    contentTemplateId: entry.contentTemplateId, contentTemplateVersion: entry.contentTemplateVersion,
    contentTemplateDigest: entry.contentTemplateDigest, actionTemplateId: entry.actionTemplateId,
    actionTemplateDigest: entry.actionTemplateDigest, actionFamilyId: entry.actionFamilyId,
    contentFormat: entry.contentFormat, wordingOrigin: entry.wordingOrigin, customerSafeRule: entry.customerSafeRule
  };
  if (canonical.canonicalize(value.templateBinding) !== canonical.canonicalize(expectedBinding) ||
      canonical.canonicalize(value.variableBindings[0]) !== canonical.canonicalize({ name: 'actionLabel', valueId: entry.variableSchema[0].allowedValueId, valueDigest: entry.variableValueDigest })) throw new Error('catalog binding');
  if (canonical.digest('mission28.content-template.v1\n', templateDefinition(entry)) !== entry.contentTemplateDigest ||
      canonical.digest('mission28.content-variable.v1\n', { name: 'actionLabel', valueId: entry.variableSchema[0].allowedValueId }) !== entry.variableValueDigest) throw new Error('catalog digest');
  if (canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))) !== value.requestDigest) throw new Error('request digest');
  if (canonical.canonicalize(separatelyTrusted) !== canonical.canonicalize(serverResolved) ||
      canonical.canonicalize(trusted(value)) !== canonical.canonicalize(serverResolved)) throw new Error('trusted resolution');
  const materialDigest = canonical.digest('mission28.content-preview-material.v1\n', serverResolved);
  if (materialIndex) {
    const priorIdentity = materialIndex.get(materialDigest);
    if (priorIdentity && priorIdentity !== value.contentPreviewId) throw new Error('material replay');
    materialIndex.set(materialDigest, value.contentPreviewId);
  }
  const label = entry.variableSchema[0].allowedValueId.replaceAll('_', ' ');
  const titleText = entry.titlePattern.replace('{{actionLabel}}', label);
  const bodyText = entry.bodyPattern.replace('{{actionLabel}}', label);
  if (/[<>&\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(titleText + bodyText)) throw new Error('unsafe output');
  return { titleText, bodyText, messageCreated: false, effectCreated: false };
}

describe('Mission 28 Part 7C approved content and no-effect preview contract', () => {
  test('binds exact released dependencies and Part 7B release evidence', () => {
    expect(contract.part7BRelease).toMatchObject({ acceptedSourceHead: '247dbf2f6ae3efa049820d735e65d7375f422205', acceptedTree: 'c2eee6032f9386bb12c97e6065705146baa71aff', pullRequest: 576, mergedMain: 'd1be2f177c3a098bc9c380543f2f5f8dfee1d2f3', deployment: 'b073e52b-d900-4599-afcc-ce3acbda2a07', deploymentState: 'SUCCESS_RUNNING', productionMigration: '282_exactly_once_no_283' });
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
    expect(contract.authority).toMatchObject({ part: '7C', state: 'implementation_candidate_only', recipientMessageExternalEffectUpstreamMutationAccountingOrMoneyGranted: false });
  });

  test('locks three exact approved static templates and independently recomputes every digest', () => {
    expect(contract.approvedTemplateCatalog).toHaveLength(3);
    for (const entry of contract.approvedTemplateCatalog) {
      expect(canonical.digest(contract.templateDigestNamespace, templateDefinition(entry))).toBe(entry.contentTemplateDigest);
      expect(canonical.digest(contract.variableDigestNamespace, { name: 'actionLabel', valueId: entry.variableSchema[0].allowedValueId })).toBe(entry.variableValueDigest);
      expect(entry).toMatchObject({ localeId: 'en-US', languageId: 'en', contentFormat: 'plain_text', wordingOrigin: 'approved_static_catalog', linkSelectionPolicy: 'none_current_launch', attachmentSelectionPolicy: 'none_current_launch' });
      expect(project(preview(entry))).toMatchObject({ messageCreated: false, effectCreated: false });
    }
  });

  test.each([
    ['unknown content template', value => { value.templateBinding.contentTemplateId = 'unknown'; }],
    ['changed template digest', value => { value.templateBinding.contentTemplateDigest = `sha256:${'9'.repeat(64)}`; }],
    ['string template version alias', value => { value.templateBinding.contentTemplateVersion = '1'; }],
    ['cross action template', value => { value.templateBinding.actionTemplateId = 'owner_approval_request_v1'; }],
    ['free-form variable', value => { value.variableBindings[0].valueId = '<script>customer@example.test {{prompt}}</script>'; }],
    ['AI wording origin', value => { value.templateBinding.wordingOrigin = 'ai_assisted_draft'; }],
    ['locale substitution', value => { value.localeId = 'en-us'; }],
    ['language substitution', value => { value.languageId = 'fr'; }],
    ['link selection', value => { value.linkSelections.push({ url: 'https://customer.example.test/token' }); }],
    ['attachment selection', value => { value.attachmentSelections.push({ documentId: uuid(99) }); }],
    ['candidate output', value => { value.titleText = 'invented offer'; }],
    ['cross tenant', value => { value.tenantId = uuid(29); }]
  ])('fails closed for %s after redigest rather than accepting matching candidate trust', (_name, mutate) => {
    const value = preview(); const serverResolved = trusted(value); mutate(value); value.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
    expect(() => project(value, trusted(value), serverResolved)).toThrow();
  });

  test('descriptor-first plain-data gate rejects accessors, symbols, prototypes, proxies, sparse arrays and toJSON without hooks', () => {
    for (const poison of [
      () => { const value = preview(); Object.defineProperty(value.templateBinding, 'actionTemplateId', { enumerable: true, get() { throw new Error('getter invoked'); } }); return value; },
      () => { const value = preview(); Object.defineProperty(value, 'hidden', { value: 1 }); return value; },
      () => { const value = preview(); value[Symbol('poison')] = true; return value; },
      () => { const value = preview(); Object.setPrototypeOf(value.templateBinding, { actionTemplateId: value.templateBinding.actionTemplateId }); return value; },
      () => new Proxy(preview(), { get() { throw new Error('proxy invoked'); } }),
      () => { const value = preview(); value.variableBindings = new Array(2); value.variableBindings[1] = copy(value.variableBindings[0]); return value; },
      () => { const value = preview(); Object.defineProperty(value, 'toJSON', { enumerable: false, value() { throw new Error('toJSON invoked'); } }); return value; }
    ]) expect(() => project(poison())).toThrow();
  });

  test('requires separately trusted exact material and rejects clone, alias and trust reuse', () => {
    const materialIndex = new Map();
    const first = preview(); expect(project(first, trusted(first), trusted(first), materialIndex).effectCreated).toBe(false);
    const second = preview(contract.approvedTemplateCatalog[1]); second.contentPreviewId = uuid(900002); second.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(second).filter(([key]) => key !== 'requestDigest')));
    expect(() => project(second, trusted(first))).toThrow(/trusted resolution/);
    const alias = copy(first); alias.contentPreviewId = uuid(900003); alias.requestDigest = canonical.digest('mission28.content-preview.v1\n', Object.fromEntries(Object.entries(alias).filter(([key]) => key !== 'requestDigest')));
    expect(() => project(alias, trusted(alias), trusted(alias), materialIndex)).toThrow(/material replay/);
  });

  test('migration is owner-only immutable forced-RLS no-effect storage and mounts no later authority', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const fragment of ['canonical_automation_content_previews_v1', 'canonical_automation_record_content_preview_v1', 'FORCE ROW LEVEL SECURITY', 'approved_static_catalog', 'clear_internal_passive_no_effect', 'REVOKE ALL ON FUNCTION', 'messageCreated', 'effectCreated']) expect(sql).toContain(fragment);
    for (const forbidden of ['router.', 'provider.send', 'messages.create', 'queue.publish', 'INSERT INTO public.canonical_automation_provider']) expect(sql).not.toContain(forbidden);
    expect(contract.runtimeBoundary).toMatchObject({ mountedRuntimeConsumer: false, part7DChannelProviderAuthority: false, part7EOrLaterLinkAttachmentReplyOutcomeAuthority: false });
    expect(contract.privacyAndEffects).toMatchObject({ persistedRawVariableOrContactValues: 0, persistedLinks: 0, persistedAttachments: 0, providerAttempts: 0, recipientMessages: 0, externalEffects: 0, moneyEffects: 0 });
  });

  test('roadmap and ledger record 7C released, 7D candidate-only, and every later slice planned', () => {
    const roadmap = fs.readFileSync(ROADMAP, 'utf8'); const ledger = fs.readFileSync(LEDGER, 'utf8'); const narrative = fs.readFileSync(CONTRACT_MD, 'utf8');
    expect(roadmap).toContain('Parts 1A–13D are released. Part 13E is the sole implementation candidate');
    expect(ledger).toContain('Parts 1A–13D are released. Part 13E is the sole implementation candidate');
    expect(ledger).toContain('Parts 14A–14G'); expect(narrative).toContain('AI-assisted wording remains a labeled unapproved draft boundary');
    expect(narrative).toContain('No route, UI, scheduler, publisher, consumer, worker, provider, callback, recipient/message, delivery, reply, outcome, or effect path is mounted.');
  });
});
