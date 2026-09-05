'use strict';

const crypto = require('crypto');
const { Readable } = require('stream');
const {
  AD_HOC_TEMPLATE_DIGEST,
  AD_HOC_TEMPLATE_VERSION,
  normalizeEvidenceAction,
  normalizeFileHeaders,
  normalizeReadQuery,
} = require('../../src/fieldEvidence/contract');
const {
  createAuthorizedRetrieval,
  createUnavailableStorage,
  ingestFileEvidence,
} = require('../../src/fieldEvidence/fileStorage');

const IDS = Object.freeze({
  organizationId: 'a1000000-0000-4000-8000-000000000001',
  actorUserId: 'a2000000-0000-4000-8000-000000000001',
  authSessionId: 'a3000000-0000-4000-8000-000000000001',
  executionId: 'a4000000-0000-4000-8000-000000000001',
  performerProfileId: 'a5000000-0000-4000-8000-000000000001',
});
const digest = character => character.repeat(64);
const baseBody = action => ({ action, performerProfileId: IDS.performerProfileId,
  expectedExecutionRevision: 2, expectedExecutionDigest: digest('a'),
  expectedAssignmentRevision: 4, expectedAssignmentDigest: digest('b'),
  reason: 'Attributable field evidence test.' });
const input = body => ({ ...IDS, actorAccessRole: 'member', idempotencyKey: crypto.randomUUID(), body });

describe('Mission 23 Part 6 field evidence contract', () => {
  test('pins ad-hoc and exact published checklist versions without mutable template state', () => {
    const adHoc = normalizeEvidenceAction(input({ ...baseBody('create_checklist'), template: null,
      items: [{ key: 'arrival', prompt: 'Record the arrival observation.', required: true }] }));
    expect(adHoc.document).toMatchObject({ kind: 'checklist', adHocTemplateVersion: AD_HOC_TEMPLATE_VERSION,
      adHocTemplateDigest: AD_HOC_TEMPLATE_DIGEST });
    const published = normalizeEvidenceAction(input({ ...baseBody('create_checklist'), template: {
      entryId: crypto.randomUUID(), versionId: crypto.randomUUID(), versionNumber: 3,
      digest: digest('c'), publicationId: crypto.randomUUID(),
    }, items: [{ key: 'quality', prompt: 'Record the observed finish.', required: false }] }));
    expect(published.document.template.versionNumber).toBe(3);
    expect(Object.isFrozen(published.document.items[0])).toBe(true);
  });

  test.each(['observation', 'pass', 'fail', 'unavailable', 'needs_review'])('retains distinct %s semantics', resultType => {
    const normalized = normalizeEvidenceAction(input({ ...baseBody('record_observation'), observationClass: 'quality', resultType,
      observation: 'Observed condition recorded without a professional conclusion.', supportingEvidenceIds: [] }));
    expect(normalized.document).toMatchObject({ kind: 'observation', resultType, measurement: null,
      professionalConclusion: false });
  });

  test('requires an explicit bounded measurement value and unit', () => {
    const normalized = normalizeEvidenceAction(input({ ...baseBody('record_observation'), observationClass: 'inspection', resultType: 'measurement',
      observation: 'Measured surface width.', measurement: { value: '12.500', unit: 'ft' },
      supportingEvidenceIds: [] }));
    expect(normalized.document.measurement).toEqual({ value: '12.500', unit: 'ft' });
    expect(() => normalizeEvidenceAction(input({ ...baseBody('record_observation'), observationClass: 'inspection', resultType: 'measurement',
      observation: 'Missing measurement.', supportingEvidenceIds: [] }))).toThrow(/Measurement/);
  });

  test('rejects fields from a different action instead of accepting an ambiguous union contract', () => {
    expect(() => normalizeEvidenceAction(input({ ...baseBody('record_note'), note: 'Bounded note.', caption: null,
      resultType: 'pass' }))).toThrow(/do not belong/);
  });

  test.each(['<img src=x onerror=alert(1)>', 'https://customer.example/private',
    'safe\u202Egnp.exe', 'javascript:alert(1)'])('rejects active, URL, or Unicode-control text: %s', hostile => {
    expect(() => normalizeEvidenceAction(input({ ...baseBody('record_note'), note: hostile, caption: null }))).toThrow();
  });

  test('binds immutable item response and correction predecessor pins', () => {
    const checklistId = crypto.randomUUID();
    const response = normalizeEvidenceAction(input({ ...baseBody('respond_item'), checklistId,
      expectedChecklistRevision: 1, expectedChecklistDigest: digest('d'), itemKey: 'arrival',
      resultType: 'needs_review', observation: 'Access evidence is incomplete.',
      exception: 'Owner review is required.', supportingEvidenceIds: [] }));
    expect(response.subjectId).toBe(checklistId);
    const corrected = normalizeEvidenceAction(input({ ...baseBody('correct'), evidenceId: crypto.randomUUID(),
      expectedEvidenceRevision: 1, expectedEvidenceDigest: digest('e'), replacement: {
        kind: 'checklist_response', checklistId, itemKey: 'arrival', resultType: 'pass',
        observation: 'Access was observed after review.', measurement: null, exception: null,
        supportingEvidenceIds: [],
      } }));
    expect(corrected.document).toMatchObject({ kind: 'checklist_response', itemKey: 'arrival', resultType: 'pass' });
  });

  test('file header gate rejects active formats, signatures, and ungated sensitive media', () => {
    const headers = {
      'idempotency-key': crypto.randomUUID(), 'x-performer-profile-id': IDS.performerProfileId,
      'x-execution-revision': '2', 'x-execution-digest': digest('a'),
      'x-assignment-revision': '4', 'x-assignment-digest': digest('b'),
      'x-evidence-reason': 'Record bounded file evidence.', 'x-file-name': 'arrival.jpg',
      'content-type': 'image/jpeg', 'content-length': '20', 'x-privacy-flags': 'none',
      'x-retention-days': '30', 'x-content-sha256': digest('d'),
      'x-accessibility-state': 'described', 'x-accessibility-description': 'Photo of the recorded arrival condition.',
    };
    expect(normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, headers)).toMatchObject({ extension: 'jpg', retentionDays: 30 });
    expect(() => normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers, 'content-type': 'image/svg+xml', 'x-file-name': 'active.svg' })).toThrow();
    expect(() => normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers, 'x-privacy-flags': 'signature' })).toThrow();
    expect(() => normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers, 'x-privacy-flags': 'customer_property' })).toThrow();
    expect(normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers,
      'x-privacy-flags': 'faces,customer_property', 'x-privacy-policy-version': 'm23-private-media-v1',
      'x-privacy-policy-digest': digest('c'), 'x-consent-evidence-id': crypto.randomUUID(),
      'x-consent-evidence-digest': digest('d') })).toMatchObject({ privacyFlags: ['faces', 'customer_property'],
      privacy: { policyVersion: 'm23-private-media-v1' } });
    expect(() => normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers,
      'x-accessibility-state': undefined, 'x-accessibility-description': undefined })).toThrow(/accessibility/i);
    expect(normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers,
      'x-accessibility-state': 'unavailable', 'x-accessibility-description': undefined,
      'x-accessibility-unavailable-reason': 'A trustworthy description is not available.' })).toMatchObject({
      accessibility: { state: 'unavailable', description: null } });
    expect(normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers,
      'x-accessibility-state': 'needs_review', 'x-accessibility-description': undefined,
      'x-accessibility-unavailable-reason': 'An authorized reviewer must verify the description.' })).toMatchObject({
      accessibility: { state: 'needs_review', description: null } });
    expect(() => normalizeFileHeaders({ ...IDS, actorAccessRole: 'member' }, { ...headers,
      'x-accessibility-description': '<img onerror=alert(1)>' })).toThrow();
  });

  test('parses a dataset-bound opaque pagination cursor', () => {
    const cutoff = new Date(Date.now() - 1000); const lastTime = new Date(cutoff.getTime() - 1000);
    const data = { cutoff: cutoff.toISOString(), lastTime: lastTime.toISOString(), lastId: crypto.randomUUID() };
    expect(normalizeReadQuery({ limit: '20', cursor: Buffer.from(JSON.stringify(data)).toString('base64url') })).toEqual({ limit: 20, cursor: data });
    const future = { ...data, cutoff: new Date(Date.now() + 60000).toISOString() };
    expect(() => normalizeReadQuery({ limit: '20', cursor: Buffer.from(JSON.stringify(future)).toString('base64url') })).toThrow(/cursor/i);
  });
});

describe('Mission 23 Part 6 streaming file pipeline', () => {
  const capabilities = { available: true, durable: true, encryptionAtRest: true, quarantine: true,
    malwareScan: true, metadataStrip: true, decompressionSafety: true,
    retentionCleanup: true, orphanCleanup: true,
    shortLivedRetrieval: true, immutableObjectCreate: true, generationScopedCleanup: true,
    databaseFencedCleanup: true,
    version: 'fixture-v1', digest: digest('f') };
  function storage(overrides = {}) {
    const chunks = [];
    return { chunks, capabilities: () => capabilities,
      beginQuarantine: jest.fn(async () => ({ write: async chunk => chunks.push(Buffer.from(chunk)), finish: async () => {}, abort: async () => {} })),
      scanAndRelease: jest.fn(async request => ({ disposition: 'released_after_clean_scan', malwareDetected: false,
        exifPresent: false, geolocationPresent: false, decompressionSafe: true,
        decodedPixelCount: 12000000, scannerVersion: 'scanner-v1',
        storageGenerationId: request.storageGenerationId, storageObjectVersion: 'object-version-1',
        releasedObjectId: request.objectId, releasedMediaType: request.mediaType,
        releasedByteCount: request.byteCount, releasedContentDigest: request.contentDigest,
        scannerEvidenceDigest: digest('1'), metadataRemovalDigest: digest('2') })),
      deleteGeneration: jest.fn(async () => {}),
      createAuthorizedRetrieval: jest.fn(async request => ({ url: 'https://storage.example.test/object?token=short', expiresInSeconds: 300,
        objectId: request.objectId, contentDigest: request.contentDigest,
        storageGenerationId: request.storageGenerationId, storageObjectVersion: request.storageObjectVersion,
        contentDisposition: request.contentDisposition, mediaType: request.mediaType })),
      ...overrides };
  }
  function jpeg() { return Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x00,0x00,0xff,0xd9]); }
  function metadata(bytes) { return { ...IDS, actorAccessRole: 'member', performerProfileId: IDS.performerProfileId,
    expectedExecutionRevision: 2, expectedExecutionDigest: digest('a'), expectedAssignmentRevision: 4,
    expectedAssignmentDigest: digest('b'), idempotencyKey: crypto.randomUUID(), reason: 'Store evidence.',
    displayName: 'arrival.jpg', extension: 'jpg', contentType: 'image/jpeg', contentLength: bytes.length,
    expectedContentDigest: crypto.createHash('sha256').update(bytes).digest('hex'),
    privacyFlags: ['none'], privacy: null, retentionDays: 30,
    accessibility: { state: 'described', description: 'Photo of the recorded arrival condition.', reason: null } } }
  function reservation() { return { status: 200, replayed: false, body: { success: true, data: {
    reservationId: crypto.randomUUID(), storageGenerationId: crypto.randomUUID(), objectId: crypto.randomUUID(),
    claimToken: crypto.randomBytes(32).toString('hex'), cleanupCandidates: [],
  } } }; }
  function cleanupResolution(reserved) { return { status: 200, replayed: false, resolution: 'cleanup_authorized',
    cleanupCandidate: { cleanupClaimId: crypto.randomUUID(), storageGenerationId: reserved.body.data.storageGenerationId,
      objectId: reserved.body.data.objectId, cleanupToken: crypto.randomBytes(32).toString('hex') } }; }

  test('streams allowlisted bytes through quarantine, scan, metadata removal, encryption gate and one database mutation', async () => {
    const bytes = jpeg(); const provider = storage(); const authorizeUpload = jest.fn(async () => reservation());
    const mutate = jest.fn(async (_pool, value) => ({ status: 201, replayed: false, body: { success: true, data: { document: value.document } } }));
    const result = await ingestFileEvidence({ pool: {}, storage: provider, stream: Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]),
      metadata: metadata(bytes), csrfToken: 'x'.repeat(32), requestCorrelationId: 'file-test', mutate, authorizeUpload });
    expect(result.status).toBe(201); expect(Buffer.concat(provider.chunks)).toEqual(bytes); expect(mutate).toHaveBeenCalledTimes(1);
    expect(authorizeUpload).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][1].document).toMatchObject({ quarantineDisposition: 'released_after_clean_scan',
      encryptionAtRest: true, activeContentInline: false, malwareClearanceClaim: false,
      expectedContentDigest: crypto.createHash('sha256').update(bytes).digest('hex'),
      accessibility: { state: 'described' }, retentionDays: 30 });
    expect(provider.deleteGeneration).not.toHaveBeenCalled();
    expect(provider.beginQuarantine.mock.invocationCallOrder[0]).toBeGreaterThan(authorizeUpload.mock.invocationCallOrder[0]);
  });

  test.each([
    ['magic mismatch', Buffer.from('not-a-jpeg'), {}],
    ['polyglot active content', Buffer.concat([jpeg(), Buffer.from('<svg onload=alert(1)>')]), {}],
    ['scanner unavailable', jpeg(), { scanAndRelease: jest.fn(async () => ({ disposition: 'unavailable' })) }],
    ['decompression bomb', jpeg(), { scanAndRelease: jest.fn(async request => ({
      disposition: 'released_after_clean_scan', malwareDetected: false, exifPresent: false,
      geolocationPresent: false, decompressionSafe: false, decodedPixelCount: 90000000,
      scannerVersion: 'scanner-v1', storageGenerationId: request.storageGenerationId,
      storageObjectVersion: 'object-version-1', releasedObjectId: request.objectId,
      releasedMediaType: request.mediaType, releasedByteCount: request.byteCount,
      releasedContentDigest: request.contentDigest, scannerEvidenceDigest: digest('1'),
      metadataRemovalDigest: digest('2'),
    })) }],
  ])('fails closed and cleans orphan for %s', async (_label, bytes, overrides) => {
    const provider = storage(overrides); const mutate = jest.fn(); const reserved = reservation();
    const reconcileUpload = jest.fn(async () => cleanupResolution(reserved)); const confirmCleanup = jest.fn(async () => ({ status: 200 }));
    await expect(ingestFileEvidence({ pool: {}, storage: provider, stream: Readable.from([bytes]),
      metadata: metadata(bytes), csrfToken: 'x'.repeat(32), requestCorrelationId: 'file-fail', mutate,
      authorizeUpload: jest.fn(async () => reserved), reconcileUpload, confirmCleanup })).rejects.toBeDefined();
    expect(mutate).not.toHaveBeenCalled(); expect(provider.deleteGeneration).toHaveBeenCalledTimes(1);
    expect(confirmCleanup).toHaveBeenCalledTimes(1);
  });

  test('accepted replay and conflicting reservation failure happen before storage mutation', async () => {
    const bytes = jpeg(); const accepted = { status: 201, replayed: true, body: { success: true, data: { id: crypto.randomUUID() } } };
    const replayStorage = storage();
    await expect(ingestFileEvidence({ pool: {}, storage: replayStorage, stream: Readable.from([bytes]), metadata: metadata(bytes),
      csrfToken: 'x'.repeat(32), requestCorrelationId: 'replay', authorizeUpload: jest.fn(async () => accepted) })).resolves.toBe(accepted);
    expect(replayStorage.beginQuarantine).not.toHaveBeenCalled(); expect(replayStorage.deleteGeneration).not.toHaveBeenCalled();
    const conflictStorage = storage(); const conflict = Object.assign(new Error('conflict'), { constraint: 'canonical_field_evidence_idempotency_conflict' });
    await expect(ingestFileEvidence({ pool: {}, storage: conflictStorage, stream: Readable.from([bytes]), metadata: metadata(bytes),
      csrfToken: 'x'.repeat(32), requestCorrelationId: 'conflict', authorizeUpload: jest.fn(async () => { throw conflict; }) })).rejects.toBe(conflict);
    expect(conflictStorage.beginQuarantine).not.toHaveBeenCalled(); expect(conflictStorage.deleteGeneration).not.toHaveBeenCalled();
  });

  test('concurrent upload claims cannot overwrite or clean up the one accepted byte generation', async () => {
    const bytes = jpeg(); const provider = storage(); const reserved = reservation(); let claimed = false;
    const authorizeUpload = jest.fn(async () => {
      if (claimed) throw Object.assign(new Error('Upload already in progress'), { code: 'M23_FIELD_UPLOAD_IN_PROGRESS' });
      claimed = true; return reserved;
    });
    const sharedMetadata = metadata(bytes);
    const mutate = jest.fn(async (_pool, value) => ({ status: 201, replayed: false,
      body: { success: true, data: { document: value.document } } }));
    const options = () => ({ pool: {}, storage: provider, stream: Readable.from([bytes]), metadata: sharedMetadata,
      csrfToken: 'x'.repeat(32), requestCorrelationId: 'concurrent-generation', authorizeUpload, mutate });
    const settled = await Promise.allSettled([ingestFileEvidence(options()), ingestFileEvidence(options())]);
    expect(settled.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(value => value.status === 'rejected')).toHaveLength(1);
    expect(provider.beginQuarantine).toHaveBeenCalledTimes(1);
    expect(provider.deleteGeneration).not.toHaveBeenCalled();
    expect(Buffer.concat(provider.chunks)).toEqual(bytes);
  });

  test('lost COMMIT acknowledgement resolves accepted evidence without deleting its generation', async () => {
    const bytes = jpeg(); const provider = storage(); const reserved = reservation();
    const mutate = jest.fn(async () => { throw new Error('database unavailable'); });
    const accepted = { status: 201, replayed: true, resolution: 'accepted', body: { success: true,
      data: { document: { objectId: reserved.body.data.objectId } } } };
    await expect(ingestFileEvidence({ pool: {}, storage: provider, stream: Readable.from([bytes]), metadata: metadata(bytes),
      csrfToken: 'x'.repeat(32), requestCorrelationId: 'lost-commit-ack', authorizeUpload: jest.fn(async () => reserved), mutate,
      reconcileUpload: jest.fn(async () => accepted), confirmCleanup: jest.fn() })).resolves.toBe(accepted);
    expect(provider.deleteGeneration).not.toHaveBeenCalled();
  });

  test('unknown commit outcome retains bytes when fresh reconciliation is unavailable', async () => {
    const bytes = jpeg(); const provider = storage(); const reserved = reservation();
    await expect(ingestFileEvidence({ pool: {}, storage: provider, stream: Readable.from([bytes]), metadata: metadata(bytes),
      csrfToken: 'x'.repeat(32), requestCorrelationId: 'unknown-commit', authorizeUpload: jest.fn(async () => reserved),
      mutate: jest.fn(async () => { throw new Error('commit acknowledgement unavailable'); }),
      reconcileUpload: jest.fn(async () => { throw new Error('database unavailable'); }), confirmCleanup: jest.fn() })).rejects.toThrow(/commit acknowledgement/);
    expect(provider.deleteGeneration).not.toHaveBeenCalled();
  });

  test('expired takeover cleanup uses only database-issued generation claims before new storage mutation', async () => {
    const bytes = jpeg(); const provider = storage(); const reserved = reservation(); const priorReservation = reservation();
    const prior = cleanupResolution(priorReservation).cleanupCandidate;
    reserved.body.data.cleanupCandidates = [prior];
    const confirmCleanup = jest.fn(async () => ({ status: 200 }));
    const mutate = jest.fn(async (_pool, value) => ({ status: 201, replayed: false, body: { success: true, data: { document: value.document } } }));
    await ingestFileEvidence({ pool: {}, storage: provider, stream: Readable.from([bytes]), metadata: metadata(bytes),
      csrfToken: 'x'.repeat(32), requestCorrelationId: 'takeover-cleanup', authorizeUpload: jest.fn(async () => reserved), mutate, confirmCleanup });
    expect(provider.deleteGeneration).toHaveBeenCalledWith(expect.objectContaining({ cleanupClaimId: prior.cleanupClaimId,
      cleanupToken: prior.cleanupToken, storageGenerationId: prior.storageGenerationId, objectId: prior.objectId }));
    expect(confirmCleanup).toHaveBeenCalledWith({}, expect.objectContaining({ cleanupClaimId: prior.cleanupClaimId }));
    expect(provider.deleteGeneration.mock.invocationCallOrder[0]).toBeLessThan(provider.beginQuarantine.mock.invocationCallOrder[0]);
  });

  test('production default remains explicitly unavailable and retrieval is attachment-only for five minutes', async () => {
    expect(() => createUnavailableStorage().beginQuarantine()).toThrow(/not configured/);
    const provider = storage();
    await expect(createAuthorizedRetrieval(provider, { objectId: crypto.randomUUID(), organizationId: IDS.organizationId,
      executionId: IDS.executionId, storageGenerationId: crypto.randomUUID(), storageObjectVersion: 'object-version-1',
      contentDigest: digest('a'), accessibility: { state: 'unavailable', description: null, reason: 'No description is available.' } }))
      .resolves.toEqual(expect.objectContaining({ disposition: 'attachment', expiresInSeconds: 300,
        accessibility: expect.objectContaining({ state: 'unavailable' }) }));
  });
});
