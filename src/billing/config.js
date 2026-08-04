'use strict';

const CANONICAL_ORIGIN = 'https://www.northstar-os.ai';
const STRIPE_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';
const CHECKOUT_REDIRECT_URL_MAX_LENGTH = 2048;

const PLANS = Object.freeze({
  starter: Object.freeze({ name: 'Starter', monthlyAmountCents: 9900, environmentKey: 'STRIPE_PRICE_STARTER' }),
  professional: Object.freeze({ name: 'Professional', monthlyAmountCents: 19900, environmentKey: 'STRIPE_PRICE_PROFESSIONAL' }),
  enterprise: Object.freeze({ name: 'Enterprise', monthlyAmountCents: 29900, environmentKey: 'STRIPE_PRICE_ENTERPRISE' }),
});

function visible(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value.trim() === value && !/[\u0000-\u0020\u007f-\uffff]/.test(value);
}

function providerId(value, prefix) {
  return visible(value, 255) && new RegExp('^' + prefix + '[A-Za-z0-9_]+$').test(value);
}

function validOrigin(value, allowLoopback) {
  if (value === CANONICAL_ORIGIN) return true;
  if (!allowLoopback || typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === '::1');
  } catch (_error) {
    return false;
  }
}

function safeCheckoutRedirectUrl(value) {
  if (typeof value !== 'string' || value.length === 0 ||
      value.length > CHECKOUT_REDIRECT_URL_MAX_LENGTH) return null;
  let parsed;
  try { parsed = new URL(value); } catch (_error) { return null; }
  if (parsed.origin !== STRIPE_CHECKOUT_ORIGIN || parsed.protocol !== 'https:' ||
      parsed.hostname !== 'checkout.stripe.com' || parsed.username || parsed.password ||
      parsed.href !== value) return null;
  return value;
}

function buildBillingConfiguration(environment, options = {}) {
  const source = environment && typeof environment === 'object' ? environment : {};
  if (!validOrigin(source.PUBLIC_ORIGIN, options.allowLoopback === true) ||
      !visible(source.STRIPE_SECRET_KEY, 4096) ||
      !visible(source.STRIPE_WEBHOOK_SECRET, 1024) ||
      !visible(source.STRIPE_API_VERSION, 64) ||
      !/^\d{4}-\d{2}-\d{2}\.[a-z]+$/.test(source.STRIPE_API_VERSION) ||
      !providerId(source.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID, 'pmc_') ||
      !providerId(source.STRIPE_BILLING_PORTAL_CONFIGURATION_ID, 'bpc_') ||
      source.STRIPE_AUTOMATIC_TAX_ENABLED !== 'true' ||
      source.STRIPE_TAX_ID_COLLECTION_ENABLED !== 'true') return null;

  const configuredPlans = {};
  const priceIds = new Set();
  for (const [key, plan] of Object.entries(PLANS)) {
    const priceId = source[plan.environmentKey];
    if (!providerId(priceId, 'price_') || priceIds.has(priceId)) return null;
    priceIds.add(priceId);
    configuredPlans[key] = Object.freeze({
      key,
      name: plan.name,
      monthlyAmountCents: plan.monthlyAmountCents,
      priceId,
    });
  }

  const configuration = {
    provider: 'stripe',
    publicOrigin: source.PUBLIC_ORIGIN,
    apiVersion: source.STRIPE_API_VERSION,
    paymentMethodConfigurationId: source.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID,
    billingPortalConfigurationId: source.STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
    automaticTaxEnabled: true,
    taxIdCollectionEnabled: true,
    plans: Object.freeze(configuredPlans),
  };
  Object.defineProperties(configuration, {
    secretKey: { value: source.STRIPE_SECRET_KEY, enumerable: false, writable: false },
    webhookSecret: { value: source.STRIPE_WEBHOOK_SECRET, enumerable: false, writable: false },
  });
  return Object.freeze(configuration);
}

module.exports = {
  CANONICAL_ORIGIN,
  CHECKOUT_REDIRECT_URL_MAX_LENGTH,
  PLANS,
  buildBillingConfiguration,
  safeCheckoutRedirectUrl,
};
