'use strict';

const { emailAddress } = require('../email/transactional');
const safeLogger = require('../observability/safeLogger');
const { SupportCaseRepository } = require('./repository');

function safeCategory(error) {
  const value = error && (error.category || error.code);
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : 'delivery_failed';
}

function configuredRecipient(value) {
  if (typeof value !== 'string' || !value) return null;
  try { return emailAddress(value, 'support recipient'); } catch (_error) { return null; }
}

class SupportCaseOutboxWorker {
  constructor(options = {}) {
    this.repository = options.repository || new SupportCaseRepository();
    this.transactionalEmail = options.transactionalEmail || null;
    this.supportRecipient = configuredRecipient(options.supportRecipient);
    this.intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs >= 100 && options.intervalMs <= 60000
      ? options.intervalMs : 1000;
    this.unavailableIntervalMs = Number.isInteger(options.unavailableIntervalMs) &&
      options.unavailableIntervalMs >= 10000 && options.unavailableIntervalMs <= 3600000
      ? options.unavailableIntervalMs : 60000;
    this.batchSize = Number.isInteger(options.batchSize) && options.batchSize >= 1 && options.batchSize <= 25
      ? options.batchSize : 10;
    this.leaseSeconds = Number.isInteger(options.leaseSeconds) && options.leaseSeconds >= 5 && options.leaseSeconds <= 300
      ? options.leaseSeconds : 30;
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  hasDeliveryCapability() {
    return Boolean(this.supportRecipient && this.transactionalEmail &&
      typeof this.transactionalEmail.supportCase === 'function');
  }

  async deliver(job) {
    const renewed = await this.repository.renewForwardingLease({
      id: job.id, claimToken: job.claim_token, leaseSeconds: this.leaseSeconds,
    });
    if (!renewed) return false;
    try {
      await this.transactionalEmail.supportCase(this.supportRecipient, {
        id: job.case_id,
        reference: job.case_number,
        title: job.title,
        description: job.description,
        submittedAt: job.created_at,
      }, { deliveryId: job.id, requestId: `support-outbox-${job.id}` });
      const finalized = await this.repository.finalizeForwarding({
        id: job.id, claimToken: job.claim_token, attemptCount: job.attempt_count, delivered: true,
      });
      return Boolean(finalized && finalized.state === 'delivered');
    } catch (error) {
      const category = safeCategory(error);
      safeLogger.warn('support', 'forwarding_failed', { attempt: job.attempt_count, category });
      await this.repository.finalizeForwarding({
        id: job.id, claimToken: job.claim_token, attemptCount: job.attempt_count,
        delivered: false, errorCategory: category,
      });
      return false;
    }
  }

  async drainOnce() {
    if (!this.hasDeliveryCapability()) {
      const unavailable = await this.repository.markForwardingUnavailable(this.batchSize);
      return { claimed: 0, delivered: 0, unavailable };
    }
    const jobs = await this.repository.claimForwardingJobs({
      batchSize: this.batchSize, leaseSeconds: this.leaseSeconds,
    });
    let delivered = 0;
    for (const job of jobs) if (await this.deliver(job)) delivered += 1;
    return { claimed: jobs.length, delivered, unavailable: 0 };
  }

  async tick() {
    if (this.running || this.stopped) return false;
    this.running = true;
    try { await this.drainOnce(); } catch (_error) { safeLogger.warn('support', 'forwarding_tick_failed'); }
    finally { this.running = false; }
    return true;
  }

  start() {
    if (this.timer || this.stopped) return false;
    const interval = this.hasDeliveryCapability() ? this.intervalMs : this.unavailableIntervalMs;
    this.timer = setInterval(() => { void this.tick(); }, interval);
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

module.exports = { SupportCaseOutboxWorker, configuredRecipient, safeCategory };
