'use strict';

const crypto = require('crypto');
const {
  normalizeEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
} = require('../../src/accounts/service');

describe('Account Lifecycle PR A validation', () => {
  test('email normalization trims and lowercases without provider-specific rewriting', () => {
    expect(normalizeEmail('  First.Last+tag@GMAIL.com  ')).toBe('first.last+tag@gmail.com');
    expect(normalizeEmail('User.Name@Example.COM')).toBe('user.name@example.com');
  });

  test('email normalization rejects empty, malformed, and over-254 values', () => {
    expect(() => normalizeEmail('')).toThrow(/valid email/i);
    expect(() => normalizeEmail('not-an-email')).toThrow(/valid email/i);
    expect(() => normalizeEmail('a'.repeat(244) + '@example.test')).toThrow(/254/);
  });

  test('password policy accepts exactly 12 through 128 characters with no composition rule', () => {
    expect(validatePassword('a'.repeat(12))).toHaveLength(12);
    expect(validatePassword(' '.repeat(128))).toHaveLength(128);
    expect(() => validatePassword('a'.repeat(11))).toThrow(/12 through 128/);
    expect(() => validatePassword('a'.repeat(129))).toThrow(/12 through 128/);
  });

  test('password hashing covers the full input and upgrades legacy bcrypt hashes', async () => {
    const password = 'correct horse battery staple '.repeat(4).slice(0, 100);
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toEqual({ valid: true, needsUpgrade: false });
    expect((await verifyPassword(password.slice(0, 72), hash)).valid).toBe(false);

    const bcrypt = require('bcryptjs');
    const legacy = await bcrypt.hash('legacy password 123', 4);
    expect(await verifyPassword('legacy password 123', legacy)).toEqual({ valid: true, needsUpgrade: true });
  });

  test('production configuration exposes no environment-owned signup capability', () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      ACCOUNT_SIGNUP_ENABLED: process.env.ACCOUNT_SIGNUP_ENABLED,
      ACCOUNT_VERIFICATION_DELIVERY_READY: process.env.ACCOUNT_VERIFICATION_DELIVERY_READY,
      AUTH_ACCESS_SECRET: process.env.AUTH_ACCESS_SECRET,
    };
    process.env.NODE_ENV = 'production';
    process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
    process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'true';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    jest.resetModules();
    try {
      const config = require('../../src/config');
      expect(config.validateRuntime()).toBe(true);
      expect(config.auth).not.toHaveProperty('signupEnabled');
      expect(config.auth).not.toHaveProperty('verificationDeliveryReady');
    } finally {
      Object.entries(saved).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      });
      jest.resetModules();
    }
  });
});
