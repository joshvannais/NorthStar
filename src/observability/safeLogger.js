'use strict';

const COMPONENTS = new Set([
  'audit',
  'email',
  'google_calendar',
  'google_sheets',
  'http',
  'jobber',
  'observability',
  'retell',
  'smtp',
  'support',
  'twilio',
  'voice',
]);

const EVENTS = new Set([
  'anonymous_not_found_aggregation_failed',
  'anonymous_not_found_aggregation_unavailable',
  'audit_persistence_failed',
  'audit_schema_incompatible',
  'audit_schema_unavailable',
  'business_event_emitting',
  'business_event_handler_failed',
  'business_event_unhandled',
  'call_completion_completed',
  'call_completion_started',
  'client_initialization_failed',
  'client_unavailable',
  'create_call_attempts_exhausted',
  'create_call_failed',
  'create_call_not_retryable',
  'create_call_prepared',
  'create_call_retry_scheduled',
  'create_call_succeeded',
  'create_client_failed',
  'create_job_failed',
  'demo_housekeeping_failed',
  'disconnect_failed',
  'event_create_failed',
  'event_created',
  'event_handler_failed',
  'escalation_initiated',
  'escalation_resolved',
  'headers_create_failed',
  'headers_created',
  'forwarding_failed',
  'forwarding_tick_failed',
  'invalid_log_event',
  'intelligence_context_unavailable',
  'intelligence_context_updated',
  'intelligence_event_processing',
  'intelligence_guidance_generated',
  'intelligence_handlers_registered',
  'lead_appended',
  'notification_send_failed',
  'notification_sent',
  'outbox_delivery_failed',
  'outbox_tick_failed',
  'oauth_authorization_failed',
  'oauth_callback_failed',
  'provider_request_failed',
  'provider_unconfigured',
  'push_lead_failed',
  'recipient_unavailable',
  'request_completed',
  'request_failed',
  'request_network_failed',
  'request_started',
  'response_parse_failed',
  'response_received',
  'signature_missing',
  'signature_validation_failed',
  'signature_validation_unavailable',
  'timestamp_missing',
  'timestamp_outside_window',
  'tool_availability_stub_invoked',
  'tool_schedule_stub_invoked',
  'token_lookup_failed',
  'token_persistence_failed',
  'token_refresh_failed',
  'token_unavailable',
  'transcript_event_emit_failed',
  'transcript_handling_failed',
  'transcript_segments_processed',
  'webhook_event_completed',
  'webhook_event_received',
  'webhook_event_routing',
  'webhook_event_unsupported',
  'webhook_fatal_error',
  'voice_session_persisted',
  'voice_session_persistence_failed',
  'voice_session_persistence_unavailable',
]);

const METHOD_CLASSES = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER']);
const NUMBER_FIELDS = new Set([
  'attempt',
  'clockSkewMs',
  'durationMs',
  'errorCount',
  'handlerCount',
  'maxAttempts',
  'retryInMs',
  'segmentCount',
  'statusCode',
  'stepCount',
  'variableCount',
]);
const BOOLEAN_FIELDS = new Set(['configured', 'retryable', 'routed']);
const CATEGORIES = new Set([
  'delivery_failed',
  'invalid_message',
  'invalid_operation',
  'malformed_provider_response',
  'network_failure',
  'provider_access_rejected',
  'provider_conflict',
  'provider_rate_limited',
  'provider_redirect_rejected',
  'provider_rejection',
  'provider_request_rejected',
  'provider_unavailable',
  'timeout',
]);
const VOICE_EVENTS = new Set([
  'call_completed',
  'emergency_detected',
  'estimate_requested',
  'objection_detected',
  'pricing_question',
]);
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ownDataValue(source, key) {
  if (!source || typeof source !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return undefined;
  return descriptor.value;
}

function methodClass(method) {
  const normalized = typeof method === 'string' ? method.toUpperCase() : '';
  return METHOD_CLASSES.has(normalized) ? normalized : 'OTHER';
}

function safeFields(fields) {
  const output = {};
  const requestId = ownDataValue(fields, 'requestId');
  if (requestId !== undefined) {
    output.requestId = typeof requestId === 'string' && REQUEST_ID.test(requestId)
      ? requestId
      : 'unavailable';
  }
  const method = ownDataValue(fields, 'methodClass');
  if (method !== undefined) output.methodClass = methodClass(method);
  const category = ownDataValue(fields, 'category');
  if (CATEGORIES.has(category)) output.category = category;
  const voiceEvent = ownDataValue(fields, 'voiceEvent');
  if (VOICE_EVENTS.has(voiceEvent)) output.voiceEvent = voiceEvent;

  for (const key of NUMBER_FIELDS) {
    const value = ownDataValue(fields, key);
    if (Number.isSafeInteger(value) && value >= 0) output[key] = value;
  }
  for (const key of BOOLEAN_FIELDS) {
    const value = ownDataValue(fields, key);
    if (typeof value === 'boolean') output[key] = value;
  }
  return output;
}

function write(level, component, event, fields) {
  const known = COMPONENTS.has(component) && EVENTS.has(event);
  const record = {
    component: known ? component : 'observability',
    event: known ? event : 'invalid_log_event',
    ...safeFields(fields),
  };
  console[level](record);
  return record;
}

function info(component, event, fields) {
  return write('info', component, event, fields);
}

function warn(component, event, fields) {
  return write('warn', component, event, fields);
}

function error(component, event, fields) {
  return write('error', component, event, fields);
}

module.exports = { error, info, methodClass, warn };
