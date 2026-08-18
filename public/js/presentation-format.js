(function (global) {
  'use strict';

  var INTERNAL_KEY = /(^|_)(id|ids|uuid|digest|hash|version|contract|source|signature|token|key)$/i;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var LONG_HEX = /^[0-9a-f]{24,}$/i;
  var LABELS = Object.freeze({
    callerIntent: 'Caller intent',
    customerContext: 'Customer context',
    schedulingConstraint: 'Scheduling constraint',
    conversationOutcome: 'Conversation outcome',
    businessContext: 'Business context',
    customerFacingPrice: 'Customer price',
    estimatedProductionDurationHours: 'Estimated duration',
    laborHours: 'Labor hours',
    laborCharge: 'Labor charge',
    materialsCharge: 'Materials charge',
    equipmentCharge: 'Equipment charge',
    knownDirectMaterialCost: 'Recorded material cost',
    knownInternalLaborCost: 'Recorded labor cost',
    knownEquipmentCost: 'Recorded equipment cost',
    grossMarginPercent: 'Gross margin',
    netMarginPercent: 'Net margin',
    missingInformation: 'Missing information',
    recommendedActions: 'Recommended actions',
  });

  function isRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function snakeKey(value) {
    return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
  }

  function isInternalKey(value) {
    var key = snakeKey(value);
    if (!key) return true;
    if (INTERNAL_KEY.test(key)) return true;
    return /(^|_)(canonical|calculation|projection|snapshot|read_model)_(id|ids|digest|hash|version|contract|source|key)$/.test(key);
  }

  function isInternalIdentifier(value) {
    if (typeof value !== 'string') return false;
    var text = value.trim();
    return UUID.test(text) || LONG_HEX.test(text);
  }

  function hasCycle(value, ancestors) {
    if (!Array.isArray(value) && !isRecord(value)) return false;
    var stack = ancestors || [];
    if (stack.indexOf(value) >= 0) return true;
    var next = stack.concat([value]);
    var entries = Array.isArray(value) ? value : Object.keys(value).map(function (key) { return value[key]; });
    return entries.some(function (entry) { return hasCycle(entry, next); });
  }

  function label(value) {
    if (LABELS[value]) return LABELS[value];
    var text = String(value || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Detail';
  }

  function naturalText(value) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!text || isInternalIdentifier(text)) return '';
    if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(text)) {
      text = text.replace(/[_-]+/g, ' ').toLowerCase();
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return text;
  }

  function formatNumber(value, key) {
    var normalized = snakeKey(key);
    if (/(price|pricing|cost|charge|revenue|profit|subtotal|total|tax|overhead|amount|estimate)/.test(normalized)) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 2,
      }).format(value);
    }
    if (/(percent|percentage|margin|confidence|probability|score)/.test(normalized)) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value) + '%';
    }
    if (/(hours|duration_hours)/.test(normalized)) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value) + ' hours';
    }
    if (/(seconds|duration_seconds)/.test(normalized)) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value) + ' seconds';
    }
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }

  function describe(value, options, depth, ancestors) {
    var settings = options || {};
    var fallback = Object.prototype.hasOwnProperty.call(settings, 'fallback')
      ? settings.fallback
      : 'Unavailable because the required input has not been recorded.';
    var key = settings.key || '';
    var level = depth || 0;
    var stack = ancestors || [];
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return Number.isFinite(value) ? formatNumber(value, key) : fallback;
    if (typeof value === 'string') return naturalText(value) || fallback;
    if (Array.isArray(value)) {
      if (stack.indexOf(value) >= 0) return fallback;
      var arrayStack = stack.concat([value]);
      var items = value.slice(0, settings.maxItems || 8).map(function (item) {
        return describe(item, { fallback: '', key: key, maxItems: settings.maxItems }, level + 1, arrayStack);
      }).filter(Boolean);
      return items.length ? items.join('; ') : fallback;
    }
    if (!isRecord(value) || level > 3) return fallback;
    if (stack.indexOf(value) >= 0) return fallback;
    var recordStack = stack.concat([value]);
    var parts = Object.keys(value).filter(function (field) {
      return !isInternalKey(field) && value[field] !== null && value[field] !== undefined && value[field] !== '';
    }).slice(0, settings.maxItems || 10).map(function (field) {
      var childKey = key ? key + '_' + field : field;
      var text = describe(value[field], { fallback: '', key: childKey, maxItems: settings.maxItems }, level + 1, recordStack);
      return text ? label(field) + ': ' + text : '';
    }).filter(Boolean);
    return parts.length ? parts.join('; ') : fallback;
  }

  function rows(value, options) {
    if (!isRecord(value)) return [];
    var settings = options || {};
    return Object.keys(value).filter(function (field) {
      return !isInternalKey(field);
    }).map(function (field) {
      var text = describe(value[field], {
        fallback: settings.includeUnavailable ? 'Unavailable because this input has not been recorded.' : '',
        key: field,
        maxItems: settings.maxItems,
      });
      return text ? { key: field, label: label(field), value: text } : null;
    }).filter(Boolean);
  }

  function unavailable(subject) {
    return (subject || 'This value') + ' is unavailable because the required role-authorized input has not been recorded.';
  }

  global.NorthStarPresentationFormat = Object.freeze({
    describe: describe,
    hasCycle: hasCycle,
    isInternalIdentifier: isInternalIdentifier,
    isInternalKey: isInternalKey,
    isRecord: isRecord,
    label: label,
    naturalText: naturalText,
    rows: rows,
    unavailable: unavailable,
  });
})(window);
