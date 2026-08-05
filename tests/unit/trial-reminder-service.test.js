'use strict';

const crypto = require('crypto');
const { TransactionalEmail } = require('../../src/email/transactional');
const { TrialReminderService } = require('../../src/accounts/trialReminderService');
const { recipientHash } = require('../../src/accounts/trialReminderRepository');
const { requireReleaseOrder } = require('../../scripts/run-trial-reminders');

const DELIVERY_ID = 'a7c27d61-6b29-4d5b-9503-f51ac5988a27';

function captureEmail() {
  const calls = [];
  const email = new TransactionalEmail({
    adapter: {
      async send(message, context) {
        calls.push({ message, context });
        return { accepted: true, providerMessageId: 'capture_message_1' };
      },
    },
    publicOrigin: 'https://northstar.example.test',
    from: 'notifications@northstar.example.test',
    production: false,
  });
  return { calls, email };
}

describe('trial reminder transactional boundary', () => {
  test.each([7, 3, 1])('builds bounded canonical content for %i days', async days => {
    const { calls, email } = captureEmail();
    const result = await email.trialEndingReminder('Owner@Example.Test', days, {
      deliveryId: DELIVERY_ID,
      requestId: 'trial-reminder-unit',
    });
    expect(result).toEqual({ delivered: true, providerMessageId: 'capture_message_1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].message.to).toBe('owner@example.test');
    expect(calls[0].message.text).toContain(`scheduled ${days}-day reminder`);
    expect(calls[0].message.text).toContain('https://northstar.example.test/login');
    expect(calls[0].message.html).toContain('https://northstar.example.test/login');
    expect(JSON.stringify(calls[0])).not.toMatch(/stripe|payment|price|invoice|refund|tax/i);
    expect(calls[0].context.idempotencyKey).toMatch(/^northstar-b1-trial-ending-reminder-[0-9a-f]{64}$/);
  });

  test('rejects an unsupported threshold before provider action', async () => {
    const { calls, email } = captureEmail();
    expect(() => email.trialEndingReminder('owner@example.test', 2, {
      deliveryId: DELIVERY_ID,
    })).toThrow('threshold');
    expect(calls).toHaveLength(0);
  });

  test('cancels invalid authority without a provider call', async () => {
    const repository = {
      reconcileAuthorities: jest.fn(async () => ({ scheduled: 0, canceled: 0 })),
      claimNext: jest.fn()
        .mockResolvedValueOnce({ id: DELIVERY_ID, lease_token: crypto.randomUUID() })
        .mockResolvedValueOnce(null),
      validateLease: jest.fn(async () => null),
      cancelLease: jest.fn(async () => true),
    };
    const delivery = { trialEndingReminder: jest.fn() };
    const summary = await new TrialReminderService(repository, { transactionalEmail: delivery }).runOnce();
    expect(summary.canceled).toBe(1);
    expect(repository.cancelLease).toHaveBeenCalledWith(DELIVERY_ID, expect.any(String), 'subscription_authority_changed');
    expect(delivery.trialEndingReminder).not.toHaveBeenCalled();
  });

  test('uses the durable row ID for delivery and records acceptance', async () => {
    const lease = crypto.randomUUID();
    const recipient = 'owner@example.test';
    const repository = {
      reconcileAuthorities: jest.fn(async () => ({ scheduled: 3, canceled: 0 })),
      claimNext: jest.fn().mockResolvedValueOnce({ id: DELIVERY_ID, lease_token: lease }).mockResolvedValueOnce(null),
      validateLease: jest.fn(async () => ({
        id: DELIVERY_ID,
        threshold_days: 3,
        notification_email: recipient,
        recipient_sha256: recipientHash(recipient),
        active_verified_owner_count: 1,
      })),
      markSent: jest.fn(async () => true),
      markFailure: jest.fn(),
    };
    const delivery = {
      trialEndingReminder: jest.fn(async (_recipient, _days, context) => ({
        delivered: true,
        providerMessageId: context.deliveryId,
      })),
    };
    const summary = await new TrialReminderService(repository, { transactionalEmail: delivery }).runOnce();
    expect(summary.sent).toBe(1);
    expect(delivery.trialEndingReminder).toHaveBeenCalledWith(recipient, 3, {
      deliveryId: DELIVERY_ID,
      requestId: `trial-reminder-${DELIVERY_ID}`,
    });
    expect(repository.markSent).toHaveBeenCalledWith(DELIVERY_ID, lease, DELIVERY_ID);
  });

  test('records only a bounded provider failure code', async () => {
    const lease = crypto.randomUUID();
    const recipient = 'owner@example.test';
    const repository = {
      reconcileAuthorities: jest.fn(async () => ({ scheduled: 0, canceled: 0 })),
      claimNext: jest.fn().mockResolvedValueOnce({ id: DELIVERY_ID, lease_token: lease }).mockResolvedValueOnce(null),
      validateLease: jest.fn(async () => ({
        threshold_days: 7,
        notification_email: recipient,
        recipient_sha256: recipientHash(recipient),
        active_verified_owner_count: 1,
      })),
      markFailure: jest.fn(async () => ({ status: 'pending' })),
    };
    const error = Object.assign(new Error('raw recipient owner@example.test and provider body'), {
      provider: 'resend', code: 'resend_provider_unavailable',
    });
    const delivery = { trialEndingReminder: jest.fn(async () => { throw error; }) };
    const summary = await new TrialReminderService(repository, { transactionalEmail: delivery }).runOnce();
    expect(summary.retried).toBe(1);
    expect(repository.markFailure).toHaveBeenCalledWith(DELIVERY_ID, lease, 'resend_provider_unavailable');
  });

  test('production CLI fails closed unless the exact reviewed migration 013 is applied', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ checksum: '216052cc8072e826531ca5d3f1d49ce3304838eb733ab45440caf402f0f08cd5' }],
      });
    await expect(requireReleaseOrder({ query })).rejects.toThrow('requires reviewed migration 013');
    await expect(requireReleaseOrder({ query })).resolves.toBeUndefined();
  });
});
