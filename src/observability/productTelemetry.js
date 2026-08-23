'use strict';

const EVENT_CLASSES = new Set([
  'cta_click',
  'dead_click',
  'demo_completion',
  'page_exit',
  'page_view',
  'signup_abandonment',
]);
const SURFACES = new Set(['public', 'demo', 'paid']);
const ROUTE_CLASSES = new Set([
  'home', 'faq', 'contact', 'pricing', 'login', 'signup', 'forgot_password',
  'privacy', 'terms', 'refunds', 'legal', 'demo_command_center', 'demo_polaris',
  'demo_leads', 'demo_communications', 'demo_calendar', 'demo_business_profile',
  'demo_settings', 'demo_integrations', 'paid_command_center', 'paid_polaris',
  'paid_leads', 'paid_communications', 'paid_calendar', 'paid_business_profile',
  'paid_settings', 'paid_integrations', 'other_public',
]);
const ACTIONS = new Set([
  'none', 'homepage_explore_demo', 'homepage_start_trial', 'signup_submit',
  'demo_simulate_lead', 'demo_reset', 'demo_exit',
]);
const ELAPSED_BUCKETS = new Set(['under_15s', '15s_to_60s', '1m_to_5m', 'over_5m']);
const aggregate = new Map();

function exactKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 5 && keys.join('|') === 'action|elapsedBucket|event|routeClass|surface';
}

function sanitizeProductEvent(value) {
  if (!exactKeys(value)) return null;
  if (!EVENT_CLASSES.has(value.event) || !SURFACES.has(value.surface) ||
      !ROUTE_CLASSES.has(value.routeClass) || !ACTIONS.has(value.action) ||
      !ELAPSED_BUCKETS.has(value.elapsedBucket)) return null;
  return Object.freeze({
    event: value.event,
    surface: value.surface,
    routeClass: value.routeClass,
    action: value.action,
    elapsedBucket: value.elapsedBucket,
  });
}

function recordProductEvent(value) {
  const safe = sanitizeProductEvent(value);
  if (!safe) return null;
  const key = [safe.event, safe.surface, safe.routeClass, safe.action, safe.elapsedBucket].join(':');
  const count = (aggregate.get(key) || 0) + 1;
  aggregate.set(key, count);
  console.info({
    component: 'product_telemetry',
    event: 'aggregate_updated',
    eventClass: safe.event,
    surface: safe.surface,
    routeClass: safe.routeClass,
    action: safe.action,
    elapsedBucket: safe.elapsedBucket,
    count,
  });
  return safe;
}

function resetForTests() {
  aggregate.clear();
}

module.exports = { recordProductEvent, resetForTests, sanitizeProductEvent };
