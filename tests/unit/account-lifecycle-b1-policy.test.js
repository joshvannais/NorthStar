'use strict';

const { projectSubscription, canMutateInternal, canPerformExternal } = require('../../src/accounts/subscriptionPolicy');
const { validatedProductionConfiguration } = require('../../src/email/transactional');

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
        showTrialBanner: false, upgradeAvailable: true,
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
      expect(canMutateInternal(projection)).toBe(false);
      expect(canPerformExternal(projection)).toBe(false);
    }
  );

  test('active is banner-free but cannot be fabricated from contradictory or missing input', () => {
    expect(projectSubscription({ subscription_status: 'active', server_now: '2026-08-01T00:00:00Z' }))
      .toEqual(expect.objectContaining({ state: 'active', readOnly: false, showTrialBanner: false }));
    for (const authority of [null, {}, { subscription_status: 'bogus', server_now: '2026-08-01T00:00:00Z' }, {
      subscription_status: 'trialing', trial_started_at: 'invalid',
      trial_ends_at: '2026-08-15T00:00:00Z', server_now: '2026-08-01T00:00:00Z',
    }]) {
      expect(projectSubscription(authority)).toEqual(expect.objectContaining({
        state: 'unavailable', readOnly: true, safe: false,
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
  });

  test('production email capability requires complete SMTP and canonical HTTPS origin without a boolean', () => {
    const valid = {
      PUBLIC_ORIGIN: 'https://app.example.test', SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587', SMTP_USER: 'smtp-user', SMTP_PASS: 'private-secret',
      TRANSACTIONAL_EMAIL_FROM: 'security@example.test', ACCOUNT_SIGNUP_ENABLED: 'false',
    };
    expect(validatedProductionConfiguration(valid)).toEqual(expect.objectContaining({
      origin: 'https://app.example.test', secure: false, from: 'security@example.test',
    }));
    for (const mutation of [
      { PUBLIC_ORIGIN: 'http://app.example.test' },
      { PUBLIC_ORIGIN: 'https://app.example.test/path' },
      { SMTP_PASS: '' }, { SMTP_PORT: '25' }, { SMTP_HOST: 'smtp.example.test\r\nBcc:x@example.test' },
      { TRANSACTIONAL_EMAIL_FROM: 'security@example.test\r\nBcc:x@example.test' },
    ]) {
      expect(validatedProductionConfiguration({ ...valid, ...mutation })).toBeNull();
    }
    expect(validatedProductionConfiguration({ ACCOUNT_SIGNUP_ENABLED: 'true' })).toBeNull();
  });
});
