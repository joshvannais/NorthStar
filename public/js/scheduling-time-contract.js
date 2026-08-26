(function (root, factory) {
  'use strict';
  var contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  if (root) root.NorthStarSchedulingTime = contract;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var TIME = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/;
  var RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
  var FORMATTERS = Object.create(null);

  function SchedulingTimeError(code, message) {
    this.name = 'SchedulingTimeError';
    this.code = code;
    this.message = message;
    if (Error.captureStackTrace) Error.captureStackTrace(this, SchedulingTimeError);
  }
  SchedulingTimeError.prototype = Object.create(Error.prototype);
  SchedulingTimeError.prototype.constructor = SchedulingTimeError;

  function fail(code, message) {
    throw new SchedulingTimeError(code, message);
  }

  function integer(value) {
    return Number.parseInt(value, 10);
  }

  function validCalendarFields(fields) {
    var value = new Date(Date.UTC(
      fields.year, fields.month - 1, fields.day,
      fields.hour, fields.minute, fields.second, fields.millisecond || 0
    ));
    return value.getUTCFullYear() === fields.year && value.getUTCMonth() + 1 === fields.month &&
      value.getUTCDate() === fields.day && value.getUTCHours() === fields.hour &&
      value.getUTCMinutes() === fields.minute && value.getUTCSeconds() === fields.second &&
      value.getUTCMilliseconds() === (fields.millisecond || 0);
  }

  function parseWallClock(date, time) {
    var dateMatch = DATE.exec(String(date || ''));
    var timeMatch = TIME.exec(String(time || ''));
    if (!dateMatch || !timeMatch) fail('INVALID_WALL_CLOCK', 'Date and time must be exact calendar wall-clock values.');
    var fraction = timeMatch[4] ? timeMatch[4].slice(1) : '';
    var fields = {
      year: integer(dateMatch[1]),
      month: integer(dateMatch[2]),
      day: integer(dateMatch[3]),
      hour: integer(timeMatch[1]),
      minute: integer(timeMatch[2]),
      second: timeMatch[3] ? integer(timeMatch[3]) : 0,
      millisecond: fraction ? integer((fraction + '000').slice(0, 3)) : 0,
    };
    if (!validCalendarFields(fields)) fail('INVALID_WALL_CLOCK', 'Date and time do not identify a real calendar wall clock.');
    fields.date = dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
    fields.time = timeMatch[1] + ':' + timeMatch[2] + ':' + String(fields.second).padStart(2, '0');
    fields.fraction = fraction ? '.' + fraction : '';
    return fields;
  }

  function parseRfc3339(value) {
    if (typeof value !== 'string' || value !== value.trim() || value.length < 20 || value.length > 40) {
      fail('INVALID_RFC3339', 'Timestamp must be an exact RFC3339 value with an explicit UTC offset.');
    }
    var match = RFC3339.exec(value);
    if (!match) fail('INVALID_RFC3339', 'Timestamp must be an exact RFC3339 value with an explicit UTC offset.');
    var fraction = match[7] ? match[7].slice(1) : '';
    var offsetHour = match[8] === 'Z' ? 0 : integer(match[10]);
    var offsetMinute = match[8] === 'Z' ? 0 : integer(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      fail('INVALID_RFC3339', 'Timestamp UTC offset is outside the RFC3339 range.');
    }
    var offsetMinutes = match[8] === 'Z' ? 0 : (match[9] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
    var fields = {
      year: integer(match[1]), month: integer(match[2]), day: integer(match[3]),
      hour: integer(match[4]), minute: integer(match[5]), second: integer(match[6]),
      millisecond: fraction ? integer((fraction + '000').slice(0, 3)) : 0,
    };
    if (!validCalendarFields(fields)) fail('INVALID_RFC3339', 'Timestamp does not identify a real calendar wall clock.');
    var epochMilliseconds = Date.UTC(
      fields.year, fields.month - 1, fields.day, fields.hour, fields.minute,
      fields.second, fields.millisecond
    ) - offsetMinutes * 60000;
    if (!Number.isFinite(epochMilliseconds)) fail('INVALID_RFC3339', 'Timestamp is outside the supported range.');
    return Object.freeze({
      raw: value,
      fields: Object.freeze(fields),
      offsetMinutes: offsetMinutes,
      offset: offsetText(offsetMinutes),
      instant: new Date(epochMilliseconds).toISOString(),
      epochMilliseconds: epochMilliseconds,
    });
  }

  function isValidTimeZone(value) {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 255) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function formatter(timeZone) {
    if (!isValidTimeZone(timeZone)) fail('INVALID_TIME_ZONE', 'A current authoritative IANA time zone is required.');
    if (!FORMATTERS[timeZone]) {
      FORMATTERS[timeZone] = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
        timeZone: timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
      });
    }
    return FORMATTERS[timeZone];
  }

  function zonedFields(epochMilliseconds, timeZone) {
    var fields = {};
    formatter(timeZone).formatToParts(new Date(epochMilliseconds)).forEach(function (part) {
      if (part.type !== 'literal') fields[part.type] = part.value;
    });
    var hour = integer(fields.hour);
    if (hour === 24) hour = 0;
    return {
      year: integer(fields.year), month: integer(fields.month), day: integer(fields.day),
      hour: hour, minute: integer(fields.minute), second: integer(fields.second), millisecond: 0,
    };
  }

  function wallEpoch(fields) {
    return Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.millisecond || 0);
  }

  function offsetAt(epochMilliseconds, timeZone) {
    var wholeSecond = Math.floor(epochMilliseconds / 1000) * 1000;
    return Math.round((wallEpoch(zonedFields(wholeSecond, timeZone)) - wholeSecond) / 60000);
  }

  function sameWall(left, right) {
    return left.year === right.year && left.month === right.month && left.day === right.day &&
      left.hour === right.hour && left.minute === right.minute && left.second === right.second;
  }

  function offsetText(minutes) {
    var sign = minutes < 0 ? '-' : '+';
    var absolute = Math.abs(minutes);
    return sign + String(Math.floor(absolute / 60)).padStart(2, '0') + ':' + String(absolute % 60).padStart(2, '0');
  }

  function rfc3339ForWall(fields, offsetMinutes) {
    return fields.date + 'T' + fields.time + fields.fraction + offsetText(offsetMinutes);
  }

  function resolveWallTime(date, time, timeZone) {
    var desired = parseWallClock(date, time);
    if (!isValidTimeZone(timeZone)) fail('INVALID_TIME_ZONE', 'A current authoritative IANA time zone is required.');
    var desiredEpoch = wallEpoch(desired);
    var offsets = Object.create(null);
    for (var deltaHours = -48; deltaHours <= 48; deltaHours += 3) {
      var observed = offsetAt(desiredEpoch + deltaHours * 3600000, timeZone);
      offsets[String(observed)] = observed;
    }
    var candidates = [];
    Object.keys(offsets).forEach(function (key) {
      var offsetMinutes = offsets[key];
      var epochMilliseconds = desiredEpoch - offsetMinutes * 60000;
      if (offsetAt(epochMilliseconds, timeZone) !== offsetMinutes ||
          !sameWall(zonedFields(epochMilliseconds, timeZone), desired)) return;
      candidates.push({
        epochMilliseconds: epochMilliseconds,
        instant: new Date(epochMilliseconds).toISOString(),
        offsetMinutes: offsetMinutes,
        offset: offsetText(offsetMinutes),
        rfc3339: rfc3339ForWall(desired, offsetMinutes),
      });
    });
    candidates.sort(function (left, right) { return left.epochMilliseconds - right.epochMilliseconds; });
    candidates = candidates.filter(function (candidate, index) {
      return index === 0 || candidate.epochMilliseconds !== candidates[index - 1].epochMilliseconds;
    }).map(function (candidate, index) {
      return Object.freeze(Object.assign({}, candidate, {
        occurrence: candidates.length === 1 ? 'unique' : index === 0 ? 'first' : 'second',
      }));
    });
    return Object.freeze({
      date: desired.date,
      time: desired.time.slice(0, 5),
      timeZone: timeZone,
      status: candidates.length === 0 ? 'gap' : candidates.length === 1 ? 'unique' : 'ambiguous',
      candidates: Object.freeze(candidates),
    });
  }

  function validateRfc3339InZone(value, timeZone) {
    var parsed = parseRfc3339(value);
    if (!isValidTimeZone(timeZone)) fail('INVALID_TIME_ZONE', 'A current authoritative IANA time zone is required.');
    var actual = zonedFields(parsed.epochMilliseconds, timeZone);
    if (!sameWall(actual, parsed.fields) || offsetAt(parsed.epochMilliseconds, timeZone) !== parsed.offsetMinutes) {
      fail('ZONE_OFFSET_MISMATCH', 'Timestamp wall clock and UTC offset do not agree with the current IANA time zone.');
    }
    return parsed;
  }

  function formatInstant(value, timeZone) {
    var parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(parsed.getTime())) fail('INVALID_INSTANT', 'Schedule instant is invalid.');
    var fields = zonedFields(parsed.getTime(), timeZone);
    var date = String(fields.year).padStart(4, '0') + '-' + String(fields.month).padStart(2, '0') + '-' + String(fields.day).padStart(2, '0');
    var time = String(fields.hour).padStart(2, '0') + ':' + String(fields.minute).padStart(2, '0');
    var offset = offsetAt(parsed.getTime(), timeZone);
    return Object.freeze({
      date: date,
      time: time,
      second: String(fields.second).padStart(2, '0'),
      offsetMinutes: offset,
      offset: offsetText(offset),
      rfc3339: date + 'T' + time + ':' + String(fields.second).padStart(2, '0') + offsetText(offset),
      timeZone: timeZone,
    });
  }

  return Object.freeze({
    SchedulingTimeError: SchedulingTimeError,
    formatInstant: formatInstant,
    isValidTimeZone: isValidTimeZone,
    parseRfc3339: parseRfc3339,
    parseWallClock: parseWallClock,
    resolveWallTime: resolveWallTime,
    validateRfc3339InZone: validateRfc3339InZone,
  });
});
