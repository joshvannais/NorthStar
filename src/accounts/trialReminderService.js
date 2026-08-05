'use strict';

const {
  TrialReminderRepository,
  recipientHash,
  safeCode,
} = require('./trialReminderRepository');
const { normalizeTransactionalRecipient } = require('../email/transactional');

function providerFailureCode(error) {
  if (error && error.provider === 'resend') return safeCode(error.code, 'delivery_failed');
  return 'delivery_failed';
}

class TrialReminderService {
  constructor(repository, options = {}) {
    this.repository = repository || new TrialReminderRepository();
    this.transactionalEmail = options.transactionalEmail || null;
  }

  requireDelivery() {
    if (!this.transactionalEmail || typeof this.transactionalEmail.trialEndingReminder !== 'function') {
      throw new Error('Trial reminder delivery is unavailable');
    }
  }

  async runOnce(options = {}) {
    this.requireDelivery();
    const limit = Number.isInteger(options.limit) && options.limit > 0 && options.limit <= 100
      ? options.limit
      : 25;
    const reconciliation = await this.repository.reconcileAuthorities(normalizeTransactionalRecipient);
    const summary = {
      scheduled: reconciliation.scheduled,
      canceled: reconciliation.canceled,
      claimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
    };

    for (let index = 0; index < limit; index += 1) {
      const claim = await this.repository.claimNext();
      if (!claim) break;
      summary.claimed += 1;
      let authority = await this.repository.validateLease(claim.id, claim.lease_token);
      let recipient = null;
      try {
        recipient = authority ? normalizeTransactionalRecipient(authority.notification_email) : null;
      } catch (_error) {
        recipient = null;
      }
      if (!authority || !recipient || authority.active_verified_owner_count !== 1 ||
          recipientHash(recipient) !== authority.recipient_sha256) {
        await this.repository.cancelLease(
          claim.id,
          claim.lease_token,
          !authority ? 'subscription_authority_changed' :
            (!recipient ? 'destination_invalid' :
              (authority.active_verified_owner_count !== 1 ? 'owner_authority_invalid' : 'destination_changed'))
        );
        summary.canceled += 1;
        continue;
      }

      try {
        const delivery = await this.transactionalEmail.trialEndingReminder(
          recipient,
          authority.threshold_days,
          { deliveryId: claim.id, requestId: `trial-reminder-${claim.id}` }
        );
        const providerMessageId = delivery && delivery.providerMessageId;
        if (!await this.repository.markSent(claim.id, claim.lease_token, providerMessageId)) {
          throw new Error('Trial reminder completion authority was lost');
        }
        summary.sent += 1;
      } catch (error) {
        const outcome = await this.repository.markFailure(
          claim.id,
          claim.lease_token,
          providerFailureCode(error)
        );
        if (outcome && outcome.status === 'pending') summary.retried += 1;
        else summary.failed += 1;
      }
    }
    return Object.freeze(summary);
  }
}

module.exports = { TrialReminderService, providerFailureCode };
