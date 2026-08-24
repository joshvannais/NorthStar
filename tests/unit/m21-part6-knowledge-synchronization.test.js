'use strict';

const fs = require('fs');
const path = require('path');
const {
  digestCanonical,
  normalizeClaimOptions,
  normalizeSyncTargetInput,
  normalizeTransportResult,
  retryDelaySeconds,
  targetConfigurationDocument,
} = require('../../src/knowledge/synchronization');
const {
  KnowledgeSynchronizationWorker,
  safeFailureCategory,
} = require('../../src/knowledge/synchronizationWorker');
const repositoryModule = require('../../src/knowledge/synchronizationRepository');

const ROOT = path.resolve(__dirname, '../..');
const ORG = 'd6100000-0000-4000-8000-000000000001';
const ACTOR = 'e6100000-0000-4000-8000-000000000001';

function target(overrides = {}) {
  return {
    organizationId: ORG,
    actorUserId: ACTOR,
    providerKey: 'Mounted.Provider-One',
    consumer: 'voice_runtime',
    audience: 'customer',
    capabilities: ['services', 'identity'],
    maximumEntries: 8,
    maximumBytes: 32768,
    staleAfterSeconds: 3600,
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    id: 'f6100000-0000-4000-8000-000000000001',
    organizationId: ORG,
    targetId: 'f6100000-0000-4000-8000-000000000002',
    targetRevision: 1,
    targetSequence: 1,
    providerKey: 'mounted.provider-one',
    consumer: 'voice_runtime',
    audience: 'customer',
    capabilities: ['identity', 'services'],
    sourcePins: Object.freeze([Object.freeze({
      canonicalDigest: 'a'.repeat(64),
      entryId: 'f6100000-0000-4000-8000-000000000003',
      publicationId: 'f6100000-0000-4000-8000-000000000004',
      publicationNumber: 1,
      versionId: 'f6100000-0000-4000-8000-000000000005',
      versionNumber: 1,
    })]),
    projection: Object.freeze({ contract: 'NorthStarKnowledgeProjection/v1' }),
    canonicalProjection: '{"contract":"NorthStarKnowledgeProjection/v1"}',
    projectionDigest: 'b'.repeat(64),
    idempotencyKey: 'c'.repeat(64),
    claimToken: 'f6100000-0000-4000-8000-000000000006',
    ...overrides,
  };
}

describe('Mission 21 Part 6 synchronization contract', () => {
  test('normalizes one complete provider-neutral target and derives a deterministic config digest', () => {
    const normalized = normalizeSyncTargetInput(target());
    expect(normalized).toMatchObject({
      providerKey: 'mounted.provider-one',
      consumer: 'voice_runtime',
      audience: 'customer',
      capabilities: ['identity', 'services'],
      maximumEntries: 8,
      maximumBytes: 32768,
      staleAfterSeconds: 3600,
      status: 'active',
      targetRevision: 1,
    });
    expect(normalized.configurationDigest).toBe(
      digestCanonical(targetConfigurationDocument(normalized))
    );
    expect(normalizeSyncTargetInput({
      ...target(),
      capabilities: ['identity', 'services'],
      providerKey: 'mounted.provider-one',
    })).toEqual(normalized);
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  test('fails closed on unsafe provider identity, non-external consumers, partial audiences, and bounds', () => {
    for (const input of [
      target({ providerKey: 'https://provider.invalid/token?secret=x' }),
      target({ consumer: 'northstar_search' }),
      target({ audience: 'internal' }),
      target({ capabilities: ['financial_constraints'] }),
      target({ staleAfterSeconds: 299 }),
      target({ maximumBytes: 999999 }),
    ]) expect(() => normalizeSyncTargetInput(input)).toThrow();
    expect(() => normalizeClaimOptions({ batchSize: 26 })).toThrow('outside its allowed bounds');
  });

  test('accepts only a bounded acknowledgement and exact SHA-256 observation identity', () => {
    expect(normalizeTransportResult({
      accepted: true,
      observedProjectionDigest: 'A'.repeat(64),
    })).toEqual({
      accepted: true,
      diagnosticCategory: null,
      observedProjectionDigest: 'a'.repeat(64),
    });
    expect(normalizeTransportResult({
      accepted: false,
      diagnosticCategory: 'Provider_Unavailable',
    })).toEqual({
      accepted: false,
      diagnosticCategory: 'provider_unavailable',
      observedProjectionDigest: null,
    });
    expect(() => normalizeTransportResult({
      accepted: true,
      observedProjectionDigest: 'not-a-digest',
    })).toThrow('digest is malformed');
    expect(() => normalizeTransportResult({
      accepted: true,
      observedProjectionDigest: 'a'.repeat(64),
      providerPayload: '<secret>',
    })).toThrow('malformed acknowledgement');
  });

  test('uses bounded deterministic retry delays and redacted diagnostic categories', () => {
    expect([1, 2, 3, 4, 5].map(retryDelaySeconds)).toEqual([15, 60, 300, 900, 900]);
    const hostile = new Error('secret customer payload');
    hostile.category = 'provider_unavailable';
    expect(safeFailureCategory(hostile)).toBe('provider_unavailable');
    hostile.category = 'secret@example.test <script>alert(1)</script>';
    expect(safeFailureCategory(hostile)).toBe('provider_failure');
  });

  test('exports backend authorities without mounting a route, provider SDK, or server worker', () => {
    expect(repositoryModule.KnowledgeSynchronizationRepository).toEqual(expect.any(Function));
    expect(repositoryModule.enqueuePublicationSynchronization).toEqual(expect.any(Function));
    const routeSources = fs.readdirSync(path.join(ROOT, 'src/routes'))
      .filter(name => name.endsWith('.js'))
      .map(name => fs.readFileSync(path.join(ROOT, 'src/routes', name), 'utf8'))
      .join('\n');
    expect(routeSources).not.toMatch(/KnowledgeSynchronization|configureTarget|claimJobs/);
    expect(fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8'))
      .not.toMatch(/KnowledgeSynchronizationWorker/);
    expect(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
      .not.toMatch(/retell.*sync|provider.*sync/i);
  });
});
describe('Mission 21 Part 6 intercepted provider-neutral worker', () => {
  test('renews the exact lease and submits one immutable projection with a stable idempotency key', async () => {
    const queued = job();
    const calls = [];
    const finalized = [];
    const mockRepository = {
      async recoverExpiredJobs() { return 0; },
      async reconcileStaleTargets() { return 0; },
      async claimJobs() { return calls.length === 0 ? [queued] : []; },
      async renewLease(input) { calls.push({ renew: input }); return queued; },
      async finalizeJob(input) { finalized.push(input); return { exactSuccess: true }; },
    };
    const providerCalls = [];
    const worker = new KnowledgeSynchronizationWorker({
      repository: mockRepository,
      transports: {
        'mounted.provider-one': {
          async applyProjection(request, context) {
            providerCalls.push({ request, context });
            expect(context.signal).toBeInstanceOf(AbortSignal);
            expect(Object.isFrozen(request)).toBe(true);
            return { accepted: true, observedProjectionDigest: queued.projectionDigest };
          },
        },
      },
      batchSize: 1,
    });
    await expect(worker.drainOnce()).resolves.toEqual({
      claimed: 1, expired: 0, ownershipLost: 0, stale: 0, succeeded: 1,
    });
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].request).toMatchObject({
      idempotencyKey: queued.idempotencyKey,
      canonicalProjection: queued.canonicalProjection,
      projectionDigest: queued.projectionDigest,
      targetSequence: 1,
    });
    expect(finalized).toEqual([expect.objectContaining({
      accepted: true,
      observedProjectionDigest: queued.projectionDigest,
      claimToken: queued.claimToken,
    })]);
  });

  test('turns malformed, failed, and unavailable transports into categories without retaining messages', async () => {
    for (const fixture of [
      {
        transports: {},
        expected: 'provider_unavailable',
      },
      {
        transports: { 'mounted.provider-one': {
          async applyProjection() {
            return { accepted: true, observedProjectionDigest: 'a'.repeat(64), secret: 'leak' };
          },
        } },
        expected: 'malformed_response',
      },
      {
        transports: { 'mounted.provider-one': {
          async applyProjection() {
            const error = new Error('customer@example.test private body');
            error.category = 'provider_busy';
            throw error;
          },
        } },
        expected: 'provider_busy',
      },
    ]) {
      const queued = job();
      const finalized = [];
      const mockRepository = {
        async renewLease() { return queued; },
        async finalizeJob(input) { finalized.push(input); return { exactSuccess: false }; },
      };
      const worker = new KnowledgeSynchronizationWorker({
        repository: mockRepository,
        transports: fixture.transports,
      });
      await worker.deliver(queued);
      expect(finalized).toEqual([expect.objectContaining({
        accepted: false,
        diagnosticCategory: fixture.expected,
      })]);
      expect(JSON.stringify(finalized)).not.toContain('customer@example.test');
      expect(JSON.stringify(finalized)).not.toContain('private body');
      expect(JSON.stringify(finalized)).not.toContain('leak');
    }
  });
});
