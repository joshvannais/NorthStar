(function (root, factory) {
  'use strict';
  var contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  if (root) root.NorthStarAutomationCenter = contract;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var VERSION = 'mission28.automation-center.v1';
  var SOURCE_LABELS = Object.freeze({
    mission20_business_contact_preferences: 'Customer contact preferences',
    mission21_knowledge_reference: 'Approved company knowledge',
    mission22_appointment_dispatch: 'Appointments and dispatch',
    mission23_work_execution: 'Work progress and completion',
    mission24_estimate_quote: 'Estimates and quotes',
    mission25_26_advisory: 'Reviewed planning advice',
    mission27_financial_collection: 'Invoices and collection review',
  });
  var ACTION_LABELS = Object.freeze({
    internal_read_digest_task: 'Prepare owner work',
    owner_approval_request: 'Request owner approval',
    customer_communication: 'Prepare customer communication',
    secure_document_delivery: 'Prepare secure document delivery',
    financial_reminder: 'Prepare a financial reminder',
    collection_escalation: 'Prepare collection review',
  });
  var RECIPIENT_LABELS = Object.freeze({
    tenant_owner: 'Company owner',
    tenant_admin: 'Company administrator',
    assigned_staff: 'Assigned team member',
    exact_customer_record: 'Customer on the exact record',
  });
  var CHANNEL_LABELS = Object.freeze({
    in_app_passive: 'NorthStar inbox',
    email: 'Email',
    sms: 'Text message',
    secure_link: 'Secure link',
    native_handoff: 'Manual device handoff',
  });
  var TIMING_LABELS = Object.freeze({
    review_now: 'After owner review',
    business_hours: 'During company business hours',
    quiet_hours_respected: 'Outside quiet hours',
  });
  var TEMPLATES = Object.freeze([
    Object.freeze({
      id: 'owner-work-review',
      name: 'Owner work review',
      description: 'Prepare a private NorthStar task when an exact current company record needs attention.',
      sourceClassId: 'mission23_work_execution',
      actionFamily: 'internal_read_digest_task',
      recipientClass: 'tenant_owner',
      channelId: 'in_app_passive',
      timing: 'review_now',
    }),
    Object.freeze({
      id: 'estimate-follow-up-review',
      name: 'Estimate follow-up review',
      description: 'Preview a follow-up for an exact current approved estimate without sending it.',
      sourceClassId: 'mission24_estimate_quote',
      actionFamily: 'customer_communication',
      recipientClass: 'exact_customer_record',
      channelId: 'email',
      timing: 'quiet_hours_respected',
    }),
    Object.freeze({
      id: 'appointment-update-review',
      name: 'Appointment update review',
      description: 'Preview an appointment update only after schedule and contact authority are current.',
      sourceClassId: 'mission22_appointment_dispatch',
      actionFamily: 'customer_communication',
      recipientClass: 'exact_customer_record',
      channelId: 'sms',
      timing: 'business_hours',
    }),
    Object.freeze({
      id: 'invoice-reminder-review',
      name: 'Invoice reminder review',
      description: 'Preview a bounded invoice reminder while payment, dispute, contact, and stop checks remain required.',
      sourceClassId: 'mission27_financial_collection',
      actionFamily: 'financial_reminder',
      recipientClass: 'exact_customer_record',
      channelId: 'email',
      timing: 'quiet_hours_respected',
    }),
  ]);
  var TEMPLATE_BY_ID = Object.freeze(TEMPLATES.reduce(function (result, template) {
    result[template.id] = template;
    return result;
  }, Object.create(null)));
  var PREVIEW_KEYS = Object.freeze([
    'templateId', 'name', 'sourceClassId', 'actionFamily', 'recipientClass', 'channelId', 'timing', 'dailyLimit'
  ]);

  function plainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function exactKeys(value, keys) {
    if (!plainObject(value)) return false;
    var actual = Object.keys(value).sort();
    var expected = keys.slice().sort();
    return actual.length === expected.length && actual.every(function (key, index) { return key === expected[index]; });
  }
  function enumValue(value, values, label) {
    if (typeof value !== 'string' || values.indexOf(value) < 0) throw new Error(label + ' is unavailable.');
    return value;
  }
  function boundedName(value) {
    if (typeof value !== 'string') throw new Error('Enter a name for this setup.');
    var normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length < 3 || normalized.length > 80 || /[<>\u0000-\u001f]/.test(normalized)) {
      throw new Error('Use a name between 3 and 80 plain characters.');
    }
    return normalized;
  }
  function normalizePreviewInput(value) {
    if (!exactKeys(value, PREVIEW_KEYS)) throw new Error('The setup fields changed. Review the setup again.');
    var template = value.templateId === 'custom' ? null : TEMPLATE_BY_ID[value.templateId];
    if (!template && value.templateId !== 'custom') throw new Error('Choose a current setup template.');
    var normalized = {
      templateId: value.templateId,
      name: boundedName(value.name),
      sourceClassId: enumValue(value.sourceClassId, Object.keys(SOURCE_LABELS), 'Source'),
      actionFamily: enumValue(value.actionFamily, Object.keys(ACTION_LABELS), 'Action'),
      recipientClass: enumValue(value.recipientClass, Object.keys(RECIPIENT_LABELS), 'Recipient'),
      channelId: enumValue(value.channelId, Object.keys(CHANNEL_LABELS), 'Channel'),
      timing: enumValue(value.timing, Object.keys(TIMING_LABELS), 'Timing'),
      dailyLimit: value.dailyLimit,
    };
    if (!Number.isSafeInteger(normalized.dailyLimit) || normalized.dailyLimit < 1 || normalized.dailyLimit > 25) {
      throw new Error('Daily limit must be a whole number from 1 through 25.');
    }
    if (template && ['sourceClassId', 'actionFamily', 'recipientClass', 'channelId', 'timing'].some(function (key) {
      return normalized[key] !== template[key];
    })) throw new Error('The selected template changed. Choose it again.');
    if (normalized.channelId === 'in_app_passive' && normalized.recipientClass === 'exact_customer_record') {
      throw new Error('The NorthStar inbox is for your company team, not a customer recipient.');
    }
    if (normalized.channelId !== 'in_app_passive' && normalized.recipientClass !== 'exact_customer_record') {
      throw new Error('External channels require the exact customer on the current source record.');
    }
    if (normalized.actionFamily === 'internal_read_digest_task' && normalized.channelId !== 'in_app_passive') {
      throw new Error('Owner work stays inside the NorthStar inbox.');
    }
    return Object.freeze(normalized);
  }
  function buildPreview(value) {
    var input = normalizePreviewInput(value);
    var external = input.channelId !== 'in_app_passive';
    return Object.freeze({
      version: VERSION,
      name: input.name,
      summary: ACTION_LABELS[input.actionFamily] + ' from ' + SOURCE_LABELS[input.sourceClassId].toLowerCase() + '.',
      source: SOURCE_LABELS[input.sourceClassId],
      action: ACTION_LABELS[input.actionFamily],
      recipient: RECIPIENT_LABELS[input.recipientClass],
      channel: CHANNEL_LABELS[input.channelId],
      timing: TIMING_LABELS[input.timing],
      limit: 'At most ' + input.dailyLimit + (input.dailyLimit === 1 ? ' item' : ' items') + ' per day',
      stopConditions: Object.freeze([
        'A company-wide or policy stop is active',
        'The source, recipient, permission, channel, or limit is not current',
        'A reply, opt-out, manual action, correction, payment, dispute, or uncertain prior attempt changes the decision',
      ]),
      approval: external ? 'Exact current owner authority is required before any external effect.' : 'Current company authority is checked again before owner work is created.',
      availability: external ? 'preview_only_external_channel_unavailable' : 'preview_only_no_activation',
      previewOnly: true,
      saved: false,
      activated: false,
      queued: false,
      recipientContacted: false,
      providerAttemptCreated: false,
      externalEffectCreated: false,
      financialEffectCreated: false,
      moneyEffectCreated: false,
    });
  }
  function validateSnapshot(value) {
    var keys = ['version', 'status', 'counts', 'policies', 'runs', 'approvals', 'timeline', 'ownerWork', 'limits', 'channels', 'stopControl', 'templates', 'capabilities', 'unavailableEvidence', 'evaluatedAt'];
    var countKeys = ['policies', 'activePolicies', 'pausedPolicies', 'unavailablePolicies', 'activeRuns', 'pausedRuns', 'failedRuns', 'approvals', 'ownerWork'];
    var numericCountKeys = countKeys.slice(0, 7);
    if (!exactKeys(value, keys) || value.version !== VERSION || !plainObject(value.status) || !plainObject(value.counts) ||
        !Array.isArray(value.policies) || !Array.isArray(value.runs) || value.approvals !== null ||
        !Array.isArray(value.timeline) || !Array.isArray(value.ownerWork) || !plainObject(value.limits) ||
        !Array.isArray(value.channels) || !plainObject(value.stopControl) || !Array.isArray(value.templates) ||
        !Array.isArray(value.capabilities) || !Array.isArray(value.unavailableEvidence) ||
        typeof value.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(value.evaluatedAt))) {
      throw new Error('The Automation Center response is unavailable.');
    }
    if (!exactKeys(value.counts, countKeys) || value.counts.approvals !== null || value.counts.ownerWork !== null ||
        numericCountKeys.some(function (key) {
          return !Number.isInteger(value.counts[key]) || value.counts[key] < 0;
        }) || value.ownerWork.some(function (item) {
          return !plainObject(item) || item.state !== 'historical_status_unavailable' || typeof item.statusLabel !== 'string';
        })) throw new Error('The Automation Center attention status is unavailable.');
    if (value.templates.length !== TEMPLATES.length || value.templates.some(function (template, index) {
      return !template || template.id !== TEMPLATES[index].id;
    })) throw new Error('The Automation Center templates changed.');
    return value;
  }

  return Object.freeze({
    ACTION_LABELS: ACTION_LABELS,
    CHANNEL_LABELS: CHANNEL_LABELS,
    PREVIEW_KEYS: PREVIEW_KEYS,
    RECIPIENT_LABELS: RECIPIENT_LABELS,
    SOURCE_LABELS: SOURCE_LABELS,
    TEMPLATES: TEMPLATES,
    TIMING_LABELS: TIMING_LABELS,
    VERSION: VERSION,
    buildPreview: buildPreview,
    normalizePreviewInput: normalizePreviewInput,
    validateSnapshot: validateSnapshot,
  });
});
