'use strict';

const { projectSubscription, canMutateInternal, canPerformExternal } = require('../../src/accounts/subscriptionPolicy');
const { TransactionalEmail, validatedProductionConfiguration } = require('../../src/email/transactional');

function trialAt(serverNow) {
  return projectSubscription({
    subscription_status: 'trialing',
    trial_started_at: '2026-08-01T12:00:00.000Z',
    trial_ends_at: '2026-08-15T12:00:00.000Z',
    server_now: serverNow,
    organizationId: 'forged-browser-org',
    remainingDays: 999,
    paid: true,
  });
}

describe('Account Lifecycle PR B1 shared subscription policy', () => {
  test.each([
    ['2026-08-01T12:00:00.000Z', 14, false],
    ['2026-08-08T12:00:00.000Z', 7, false],
    ['2026-08-12T12:00:00.000Z', 3, false],
    ['2026-08-14T12:00:00.000Z', 1, false],
    ['2026-08-15T00:00:00.000Z', 1, true],
    ['2026-08-15T11:59:59.999Z', 1, true],
  ])('uses the injected server timestamp %s for UTC presentation', (now, days, endsToday) => {
    expect(trialAt(now)).toEqual(expect.objectContaining({
      state: 'trialing', daysRemaining: days, endsToday,
      readOnly: false, showTrialBanner: true, safe: true,
    }));
  });

  test('the exact expiration instant and later time are read-only', () => {
    for (const now of ['2026-08-15T12:00:00.000Z', '2026-08-16T00:00:00.000Z']) {
      const projection = trialAt(now);
      expect(projection).toEqual(expect.objectContaining({
        state: 'expired', daysRemaining: 0, readOnly: true,
        showTrialBanner: false, upgradeAvailable: false,
      }));
      expect(canMutateInternal(projection)).toBe(false);
      expect(canPerformExternal(projection)).toBe(false);
    }
  });

  test.each(['past_due', 'canceled', 'expired'])(
    '%s is fail-closed read-only for PR B2 compatibility',
    state => {
      const projection = projectSubscription({ subscription_status: state, server_now: '2026-08-01T00:00:00Z' });
      expect(projection.readOnly).toBe(true);
      expect(projection.upgradeAvailable).toBe(false);
      expect(canMutateInternal(projection)).toBe(false);
      expect(canPerformExternal(projection)).toBe(false);
    }
  );

  test('active is banner-free but cannot be fabricated from contradictory or missing input', () => {
    expect(projectSubscription({
      subscription_status: 'active',
      server_now: '2026-08-01T00:00:00Z',
      billing_authority_verified: true,
      billing_plan_key: 'starter',
      stripe_customer_id: 'cus_b1_policy',
      stripe_subscription_id: 'sub_b1_policy',
      current_period_start: '2026-07-31T00:00:00Z',
      current_period_end: '2026-08-31T00:00:00Z',
    }))
      .toEqual(expect.objectContaining({
        state: 'active', readOnly: false, showTrialBanner: false, upgradeAvailable: false,
      }));
    for (const authority of [null, {},
      { subscription_status: 'active', server_now: '2026-08-01T00:00:00Z' },
      { subscription_status: 'bogus', server_now: '2026-08-01T00:00:00Z' }, {
      subscription_status: 'trialing', trial_started_at: 'invalid',
      trial_ends_at: '2026-08-15T00:00:00Z', server_now: '2026-08-01T00:00:00Z',
    }]) {
      expect(projectSubscription(authority)).toEqual(expect.objectContaining({
        state: 'unavailable', readOnly: true, safe: false, upgradeAvailable: false,
      }));
    }
  });

  test('pending permits only explicitly designated low-risk account mutations', () => {
    const pending = projectSubscription({
      subscription_status: 'pending_verification', server_now: '2026-08-01T00:00:00Z',
    });
    expect(canMutateInternal(pending)).toBe(false);
    expect(canMutateInternal(pending, { allowPending: true })).toBe(true);
    expect(canPerformExternal(pending)).toBe(false);
    expect(pending.upgradeAvailable).toBe(false);
  });

  test('production email capability requires Resend and rejects SMTP-only authority', () => {
    const valid = {
      PUBLIC_ORIGIN: 'https://www.northstar-os.ai',
      RESEND_API_KEY: 're_test_only_account_lifecycle_policy',
      TRANSACTIONAL_EMAIL_FROM: 'notifications@northstar-os.ai', ACCOUNT_SIGNUP_ENABLED: 'false',
    };
    expect(validatedProductionConfiguration(valid)).toEqual(expect.objectContaining({
      origin: 'https://www.northstar-os.ai', from: 'notifications@northstar-os.ai',
    }));
    for (const RESEND_API_KEY of [
      'future-format-opaque-key',
      'opaque.key:segment/with+punctuation=value',
    ]) {
      expect(validatedProductionConfiguration({ ...valid, RESEND_API_KEY })).toEqual(expect.objectContaining({
        apiKey: RESEND_API_KEY,
      }));
    }
    const retiredSmtpHosts = [
      '.', '..', '.smtp.example.test', 'smtp.example.test.', 'smtp..example.test',
      '-smtp.example.test', 'smtp-.example.test', `smtp.${'a'.repeat(64)}.test`,
      `${Array.from({ length: 43 }, () => 'aaaaa').join('.')}.test`,
      ' smtp.example.test', 'smtp.example.test ', 'https://smtp.example.test',
      'smtp.example.test:587', 'user@smtp.example.test', 'smtp.example.test/path',
      'smtp\\example.test', 'smtp\r.example.test', 'smtp\n.example.test',
      'smtp\0.example.test', `smtp${String.fromCharCode(31)}.example.test`,
      `smtp${String.fromCharCode(127)}.example.test`, 'smtp.exÃ¤mple.test',
      'localhost', '', ['smtp.example.test'], { host: 'smtp.example.test' },
    ];
    for (const SMTP_HOST of retiredSmtpHosts) {
      expect(validatedProductionConfiguration({ ...valid, SMTP_HOST })).not.toBeNull();
    }
    for (const mutation of [
      { PUBLIC_ORIGIN: 'http://www.northstar-os.ai' },
      { PUBLIC_ORIGIN: 'https://northstar-os.ai' },
      { PUBLIC_ORIGIN: 'https://www.northstar-os.ai/path' },
      { RESEND_API_KEY: '' },
      { RESEND_API_KEY: 're_invalid key' },
      { RESEND_API_KEY: 're_invalid\tkey' },
      { RESEND_API_KEY: `opaque${String.fromCharCode(127)}key` },
      { RESEND_API_KEY: 'opaque-é' },
      { RESEND_API_KEY: 'a'.repeat(4097) },
      { TRANSACTIONAL_EMAIL_FROM: '' },
      { TRANSACTIONAL_EMAIL_FROM: 'notifications@northstar-os.ai\r\nBcc:x@example.test' },
      { TRANSACTIONAL_EMAIL_FROM: 'NorthStar Notifications <notifications@northstar-os.ai>' },
      { TRANSACTIONAL_EMAIL_FROM: 'one@northstar-os.ai,two@northstar-os.ai' },
    ]) {
      expect(validatedProductionConfiguration({ ...valid, ...mutation })).toBeNull();
    }
    expect(validatedProductionConfiguration({
      PUBLIC_ORIGIN: 'https://www.northstar-os.ai',
      TRANSACTIONAL_EMAIL_FROM: 'notifications@northstar-os.ai',
      SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'user', SMTP_PASS: 'pass',
    })).toBeNull();
    expect(validatedProductionConfiguration({ ACCOUNT_SIGNUP_ENABLED: 'true' })).toBeNull();
  });

  test('transactional messages use one source-owned structured sender without changing contents or links', async () => {
    const messages = [];
    const email = new TransactionalEmail({
      adapter: { async send(message) { messages.push(message); return { accepted: true }; } },
      publicOrigin: 'https://app.example.test',
      from: 'notifications@northstar-os.ai',
      fromName: 'Attacker Controlled',
      production: true,
    });

    await email.verification('owner@example.test', 'verification-token', {
      deliveryId: '11111111-2222-4333-8444-555555555555', requestId: 'request-verification',
    });
    await email.passwordReset('owner@example.test', 'reset-token', {
      deliveryId: '99999999-8888-4777-8666-555555555555', requestId: 'request-reset',
    });

    expect(messages).toEqual([
      {
        from: { name: 'NorthStar Notifications', address: 'notifications@northstar-os.ai' },
        to: 'owner@example.test',
        subject: 'Verify your NorthStar email',
        text: 'Verify your email within 24 hours: https://app.example.test/verify-email?token=verification-token\n\nYour 14-day trial begins only after verification.',
        html: '<p>Verify your email within 24 hours: <a href="https://app.example.test/verify-email?token=verification-token">Verify your email</a></p><p>Your 14-day trial begins only after verification.</p>',
      },
      {
        from: { name: 'NorthStar Notifications', address: 'notifications@northstar-os.ai' },
        to: 'owner@example.test',
        subject: 'Reset your NorthStar password',
        text: 'Reset your password within 30 minutes: https://app.example.test/reset-password?token=reset-token\n\nIf you did not request this, no action is required.',
        html: '<p>Reset your password within 30 minutes: <a href="https://app.example.test/reset-password?token=reset-token">Reset your password</a></p><p>If you did not request this, no action is required.</p>',
      },
    ]);
    expect(messages.every(message => !Object.hasOwn(message, 'replyTo'))).toBe(true);
  });
});
