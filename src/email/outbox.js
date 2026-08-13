'use strict';

const { AccountRepository } = require('../accounts/repository');

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_HOUSEKEEPING_INTERVAL_MS = 60000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_SECONDS = 30;

function safeCategory(error) {
  if (error && typeof error.category === 'string' && /^[a-z0-9_]{1,64}$/.test(error.category)) {
    return error.category;
  }
  if (error && typeof error.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code)) {
    return error.code;
  }
  return 'delivery_failed';
}

function safeDiagnostic(job, category) {
  return {
    jobId: job && typeof job.id === 'string' ? job.id : 'unavailable',
    purpose: job && ['email_verification', 'password_reset'].includes(job.purpose)
      ? job.purpose : 'unavailable',
    attempt: Number.isInteger(job && job.attempt_count) ? job.attempt_count : null,
    category,
  };
}

class AccountEmailOutboxWorker {
  constructor(options = {}) {
    this.repository = options.repository || new AccountRepository();
    this.transactionalEmail = options.transactionalEmail || null;
    this.intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs >= 100 && options.intervalMs <= 60000
      ? options.intervalMs : DEFAULT_INTERVAL_MS;
    this.housekeepingIntervalMs = Number.isInteger(options.housekeepingIntervalMs) &&
      options.housekeepingIntervalMs >= 10000 && options.housekeepingIntervalMs <= 3600000
      ? options.housekeepingIntervalMs : DEFAULT_HOUSEKEEPING_INTERVAL_MS;
    this.batchSize = Number.isInteger(options.batchSize) && options.batchSize >= 1 && options.batchSize <= 25
      ? options.batchSize : DEFAULT_BATCH_SIZE;
    this.leaseSeconds = Number.isInteger(options.leaseSeconds) && options.leaseSeconds >= 5 && options.leaseSeconds <= 300
      ? options.leaseSeconds : DEFAULT_LEASE_SECONDS;
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  deliveryMethod(purpose) {
    if (!this.transactionalEmail) return null;
    if (purpose === 'email_verification' && typeof this.transactionalEmail.verification === 'function') {
      return this.transactionalEmail.verification.bind(this.transactionalEmail);
    }
    if (purpose === 'password_reset' && typeof this.transactionalEmail.passwordReset === 'function') {
      return this.transactionalEmail.passwordReset.bind(this.transactionalEmail);
    }
    return null;
  }

  hasDeliveryCapability() {
    return Boolean(this.deliveryMethod('email_verification') && this.deliveryMethod('password_reset'));
  }

  async deliver(job) {
    const method = this.deliveryMethod(job.purpose);
    if (!method) return { configurationUnavailable: true };
    const renewed = await this.repository.renewAccountEmailJobLease({
      id: job.id,
      claimToken: job.claim_token,
      leaseSeconds: Math.max(this.leaseSeconds, DEFAULT_LEASE_SECONDS),
    });
    if (!renewed) return { delivered: false, ownershipLost: true };
    try {
      await method(job.recipient, job.raw_token, {
        deliveryId: job.id,
        requestId: `outbox-${job.id}`,
      });
      const finalized = await this.repository.finalizeAccountEmailJob({
        id: job.id,
        claimToken: job.claim_token,
        delivered: true,
      });
      return { delivered: Boolean(finalized) };
    } catch (error) {
      const category = safeCategory(error);
      console.warn('[Auth] Account email outbox delivery failed:', safeDiagnostic(job, category));
      const finalized = await this.repository.finalizeAccountEmailJob({
        id: job.id,
        claimToken: job.claim_token,
        delivered: false,
        errorCategory: category,
      });
      return { delivered: false, state: finalized && finalized.state, category };
    }
  }

  async drainOnce() {
    if (!this.hasDeliveryCapability()) {
      await this.repository.expireAccountEmailJobs({ batchSize: this.batchSize });
      return { claimed: 0, delivered: 0, configurationUnavailable: true };
    }
    let claimed = 0;
    let delivered = 0;
    for (let index = 0; index < this.batchSize; index += 1) {
      const job = (await this.repository.claimAccountEmailJobs({
        batchSize: 1,
        leaseSeconds: this.leaseSeconds,
      }))[0];
      if (!job) break;
      claimed += 1;
      const result = await this.deliver(job);
      if (result.delivered) delivered += 1;
    }
    return { claimed, delivered, configurationUnavailable: false };
  }

  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (_error) {
      console.warn('[Auth] Account email outbox unavailable:', { event: 'outbox_tick_failed' });
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer || this.stopped) return false;
    const timerIntervalMs = this.hasDeliveryCapability() ? this.intervalMs : this.housekeepingIntervalMs;
    this.timer = setInterval(() => { void this.tick(); }, timerIntervalMs);
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
  AccountEmailOutboxWorker,
  DEFAULT_BATCH_SIZE,
  DEFAULT_HOUSEKEEPING_INTERVAL_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_LEASE_SECONDS,
  safeCategory,
};
