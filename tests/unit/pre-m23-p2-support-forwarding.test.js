'use strict';

const { TransactionalEmail } = require('../../src/email/transactional');
const { SupportCaseOutboxWorker, configuredRecipient } = require('../../src/support/outbox');

describe('Pre-Mission-23 P2 provider-neutral support forwarding', () => {
  test('accepts only an explicit valid configured support authority', () => {
    expect(configuredRecipient(undefined)).toBeNull();
    expect(configuredRecipient('not-an-address')).toBeNull();
    expect(configuredRecipient('Configured.Support@example.com')).toBe('configured.support@example.com');
  });

  test('keeps the case durable and marks forwarding unavailable without a configured provider boundary', async () => {
    const repository = {
      markForwardingUnavailable: jest.fn().mockResolvedValue(1),
      claimForwardingJobs: jest.fn(),
    };
    const worker = new SupportCaseOutboxWorker({ repository, transactionalEmail: null, supportRecipient: null });
    await expect(worker.drainOnce()).resolves.toEqual({ claimed: 0, delivered: 0, unavailable: 1 });
    expect(repository.markForwardingUnavailable).toHaveBeenCalledWith(10);
    expect(repository.claimForwardingJobs).not.toHaveBeenCalled();
  });

  test('uses the injected transactional boundary with escaped hostile report content and stable delivery identity', async () => {
    const sent = [];
    const transactional = new TransactionalEmail({
      adapter: { send: async (message, context) => { sent.push({ message, context }); return { accepted: true }; } },
      publicOrigin: 'http://127.0.0.1:4321',
      from: 'notifications@example.com',
      production: false,
    });
    const job = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      case_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      claim_token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      attempt_count: 1,
      case_number: 'NS-BUG-BBBBBBBBBBBB4BBB8BBBBBBBBBBBBBBB',
      title: '<img src=x onerror=alert(1)>',
      description: '<script>globalThis.compromised=true</script>',
      created_at: '2026-08-30T12:00:00.000Z',
    };
    const repository = {
      claimForwardingJobs: jest.fn().mockResolvedValue([job]),
      renewForwardingLease: jest.fn().mockResolvedValue(true),
      finalizeForwarding: jest.fn().mockResolvedValue({ state: 'delivered' }),
    };
    const worker = new SupportCaseOutboxWorker({
      repository,
      transactionalEmail: transactional,
      supportRecipient: 'configured.support@example.com',
    });

    await expect(worker.drainOnce()).resolves.toEqual({ claimed: 1, delivered: 1, unavailable: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].message.to).toBe('configured.support@example.com');
    expect(sent[0].message.html).toContain('&lt;script&gt;globalThis.compromised=true&lt;/script&gt;');
    expect(sent[0].message.html).not.toContain('<script>');
    expect(sent[0].message.text).toContain('untrusted evidence');
    expect(sent[0].message.text).toContain('--- BEGIN UNTRUSTED CUSTOMER REPORT ---');
    expect(sent[0].context.idempotencyKey).toMatch(/^northstar-b1-support-case-[0-9a-f]{64}$/);
    expect(repository.finalizeForwarding).toHaveBeenCalledWith(expect.objectContaining({ delivered: true }));
  });

  test('records retry state after an intercepted provider failure without losing the case', async () => {
    const job = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      case_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      claim_token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      attempt_count: 2,
      case_number: 'NS-BUG-BBBBBBBBBBBB4BBB8BBBBBBBBBBBBBBB',
      title: 'Retry forwarding', description: 'Provider is intercepted.',
      created_at: '2026-08-30T12:00:00.000Z',
    };
    const repository = {
      claimForwardingJobs: jest.fn().mockResolvedValue([job]),
      renewForwardingLease: jest.fn().mockResolvedValue(true),
      finalizeForwarding: jest.fn().mockResolvedValue({ state: 'retry' }),
    };
    const transactionalEmail = {
      supportCase: jest.fn().mockRejectedValue(Object.assign(new Error('intercepted'), { category: 'provider_unavailable' })),
    };
    const worker = new SupportCaseOutboxWorker({
      repository, transactionalEmail, supportRecipient: 'configured.support@example.com',
    });

    await expect(worker.drainOnce()).resolves.toEqual({ claimed: 1, delivered: 0, unavailable: 0 });
    expect(repository.finalizeForwarding).toHaveBeenCalledWith(expect.objectContaining({
      delivered: false, errorCategory: 'provider_unavailable',
    }));
  });
});
