'use strict';

const {
  KnowledgeSynchronizationRepository,
} = require('./synchronizationRepository');
const {
  normalizeDiagnosticCategory,
  normalizeTransportResult,
} = require('./synchronization');

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_SECONDS = 30;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 10000;

function boundedInteger(value, minimum, maximum, fallback) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function safeFailureCategory(error) {
  if (error && error.code === 'knowledge_sync_projection_integrity_failure') {
    return 'integrity_failure';
  }
  if (error && error.code === 'knowledge_sync_malformed_response') return 'malformed_response';
  if (error && error.code === 'knowledge_sync_transport_timeout') return 'transport_timeout';
  if (error && typeof error.category === 'string') {
    return normalizeDiagnosticCategory(error.category);
  }
  return 'provider_failure';
}

function timeoutPromise(milliseconds, controller) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      const error = new Error('Provider-neutral synchronization transport timed out');
      error.code = 'knowledge_sync_transport_timeout';
      reject(error);
    }, milliseconds);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

class KnowledgeSynchronizationWorker {
  constructor(options = {}) {
    this.repository = options.repository || (
      options.pool ? new KnowledgeSynchronizationRepository(options.pool) : null
    );
    if (!this.repository) {
      throw new TypeError('Knowledge synchronization worker requires a mounted repository or pool');
    }
    this.transports = options.transports instanceof Map
      ? new Map(options.transports)
      : new Map(Object.entries(options.transports || {}));
    this.intervalMs = boundedInteger(options.intervalMs, 100, 60000, DEFAULT_INTERVAL_MS);
    this.batchSize = boundedInteger(options.batchSize, 1, 25, DEFAULT_BATCH_SIZE);
    this.leaseSeconds = boundedInteger(options.leaseSeconds, 5, 300, DEFAULT_LEASE_SECONDS);
    this.transportTimeoutMs = boundedInteger(
      options.transportTimeoutMs,
      100,
      30000,
      DEFAULT_TRANSPORT_TIMEOUT_MS
    );
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  transportFor(providerKey) {
    const transport = this.transports.get(providerKey);
    return transport && typeof transport.applyProjection === 'function' ? transport : null;
  }

  async deliver(job) {
    const transport = this.transportFor(job.providerKey);
    if (!transport) {
      return this.repository.finalizeJob({
        organizationId: job.organizationId,
        id: job.id,
        claimToken: job.claimToken,
        accepted: false,
        diagnosticCategory: 'provider_unavailable',
      });
    }
    const renewed = await this.repository.renewLease({
      organizationId: job.organizationId,
      id: job.id,
      claimToken: job.claimToken,
      leaseSeconds: Math.max(
        this.leaseSeconds,
        Math.ceil(this.transportTimeoutMs / 1000) + 5
      ),
    });
    if (!renewed) return { ownershipLost: true };

    let verified;
    try {
      verified = await this.repository.verifyJobProjection({
        organizationId: job.organizationId,
        id: job.id,
        claimToken: job.claimToken,
      });
    } catch (error) {
      return this.repository.finalizeJob({
        organizationId: job.organizationId,
        id: job.id,
        claimToken: job.claimToken,
        accepted: false,
        diagnosticCategory: safeFailureCategory(error),
      });
    }
    if (!verified) return { ownershipLost: true };

    const controller = new AbortController();
    const request = Object.freeze({
      audience: verified.audience,
      canonicalProjection: verified.canonicalProjection,
      capabilities: Object.freeze([...verified.capabilities]),
      consumer: verified.consumer,
      idempotencyKey: verified.idempotencyKey,
      organizationId: verified.organizationId,
      projection: verified.projection,
      projectionDigest: verified.projectionDigest,
      providerKey: verified.providerKey,
      sourcePins: Object.freeze(verified.sourcePins.map(pin => Object.freeze({ ...pin }))),
      targetId: verified.targetId,
      targetRevision: verified.targetRevision,
      targetSequence: verified.targetSequence,
    });
    try {
      const result = normalizeTransportResult(await Promise.race([
        Promise.resolve().then(() => transport.applyProjection(request, {
          signal: controller.signal,
        })),
        timeoutPromise(this.transportTimeoutMs, controller),
      ]));
      controller.abort();
      return this.repository.finalizeJob({
        organizationId: job.organizationId,
        id: job.id,
        claimToken: job.claimToken,
        accepted: result.accepted,
        observedProjectionDigest: result.observedProjectionDigest,
        diagnosticCategory: result.diagnosticCategory,
      });
    } catch (error) {
      controller.abort();
      return this.repository.finalizeJob({
        organizationId: job.organizationId,
        id: job.id,
        claimToken: job.claimToken,
        accepted: false,
        diagnosticCategory: safeFailureCategory(error),
      });
    }
  }

  async drainOnce() {
    const expired = await this.repository.recoverExpiredJobs({ batchSize: this.batchSize });
    const stale = await this.repository.reconcileStaleTargets({ batchSize: this.batchSize });
    let claimed = 0;
    let succeeded = 0;
    let ownershipLost = 0;
    for (let index = 0; index < this.batchSize; index += 1) {
      const job = (await this.repository.claimJobs({
        batchSize: 1,
        leaseSeconds: this.leaseSeconds,
      }))[0];
      if (!job) break;
      claimed += 1;
      const result = await this.deliver(job);
      if (result && result.exactSuccess) succeeded += 1;
      if (result && result.ownershipLost) ownershipLost += 1;
    }
    return { claimed, expired, ownershipLost, stale, succeeded };
  }

  async tick() {
    if (this.running || this.stopped) return false;
    this.running = true;
    try {
      await this.drainOnce();
    } finally {
      this.running = false;
    }
    return true;
  }

  start() {
    if (this.timer || this.stopped) return false;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.tick();
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_INTERVAL_MS,
  DEFAULT_LEASE_SECONDS,
  DEFAULT_TRANSPORT_TIMEOUT_MS,
  KnowledgeSynchronizationWorker,
  safeFailureCategory,
};
