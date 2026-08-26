'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');
const schedulingTime = require('../../public/js/scheduling-time-contract');

const EVALUATION_VERSION = 1;
const MAXIMUM_RESULT_ENTRIES = 256;
const WEEKDAYS = Object.freeze(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function milliseconds(value) {
  return new Date(value).getTime();
}

function dateAtOffset(date, days) {
  const parts = date.split('-').map(Number);
  const value = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return value.toISOString().slice(0, 10);
}

function timeAtSecond(secondOfDay) {
  const hour = Math.floor(secondOfDay / 3600);
  const minute = Math.floor((secondOfDay % 3600) / 60);
  const second = secondOfDay % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function firstInstantForLocalDate(date, timeZone) {
  const midnight = schedulingTime.resolveWallTime(date, '00:00:00', timeZone);
  if (midnight.candidates.length) return midnight.candidates[0].epochMilliseconds;
  for (let minute = 1; minute < 1440; minute += 1) {
    const resolved = schedulingTime.resolveWallTime(date, timeAtSecond(minute * 60), timeZone);
    if (!resolved.candidates.length) continue;
    for (let second = (minute - 1) * 60 + 1; second <= minute * 60; second += 1) {
      const exact = schedulingTime.resolveWallTime(date, timeAtSecond(second), timeZone);
      if (exact.candidates.length) return exact.candidates[0].epochMilliseconds;
    }
  }
  return null;
}

function localDayBounds(date, timeZone) {
  const start = firstInstantForLocalDate(date, timeZone);
  if (start === null) return null;
  for (let offset = 1; offset <= 7; offset += 1) {
    const end = firstInstantForLocalDate(dateAtOffset(date, offset), timeZone);
    if (end !== null && end > start) return { date, start, end };
  }
  return null;
}

function applicableWorkloadDays(start, end, timeZone) {
  const first = schedulingTime.formatInstant(new Date(start), timeZone).date;
  const last = schedulingTime.formatInstant(new Date(end - 1), timeZone).date;
  const days = [];
  let date = first;
  for (let guard = 0; date <= last && guard < 32; guard += 1) {
    const bounds = localDayBounds(date, timeZone);
    if (!bounds) return { days, incomplete: true };
    days.push(bounds);
    date = dateAtOffset(date, 1);
  }
  return { days, incomplete: date <= last };
}

function weekday(date) {
  const parts = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
}

function overlap(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function covers(start, end, rawIntervals) {
  const intervals = rawIntervals
    .map(interval => ({ start: milliseconds(interval.start), end: milliseconds(interval.end) }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = start;
  for (const interval of intervals) {
    if (interval.end <= cursor) continue;
    if (interval.start > cursor) return false;
    cursor = Math.max(cursor, interval.end);
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

function boundedNumber(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value : null;
}

function canonicalLocation(rawProfile, rawLocationId) {
  if (typeof rawLocationId !== 'string' || !STABLE_ID.test(rawLocationId)) return null;
  const candidates = ['headquarters'];
  const offices = rawProfile && rawProfile.headquarters && Array.isArray(rawProfile.headquarters.additionalOffices)
    ? rawProfile.headquarters.additionalOffices : [];
  for (const office of offices) {
    if (office && typeof office.id === 'string' && STABLE_ID.test(office.id)) candidates.push(office.id);
  }
  const matches = candidates.filter(value => value.toLowerCase() === rawLocationId.toLowerCase());
  return matches.length === 1 ? matches[0] : null;
}

function resolveWindow(date, open, close, timeZone) {
  if (typeof open !== 'string' || typeof close !== 'string') return { status: 'unknown', windows: [] };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close)) {
    return { status: 'unknown', windows: [] };
  }
  const endDate = close <= open ? dateAtOffset(date, 1) : date;
  let start;
  let end;
  try {
    start = schedulingTime.resolveWallTime(date, open, timeZone);
    end = schedulingTime.resolveWallTime(endDate, close, timeZone);
  } catch (_error) {
    return { status: 'unknown', windows: [] };
  }
  if (start.status !== 'unique' || end.status !== 'unique') return { status: 'ambiguous', windows: [] };
  const startMs = start.candidates[0].epochMilliseconds;
  const endMs = end.candidates[0].epochMilliseconds;
  if (endMs <= startMs) return { status: 'unknown', windows: [] };
  return { status: 'known', windows: [{ start: startMs, end: endMs }] };
}

function hoursForDate(rawProfile, date, timeZone) {
  const hours = rawProfile && rawProfile.hours;
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return { status: 'unknown', windows: [] };
  const holidays = Array.isArray(hours.holidays) ? hours.holidays.filter(value => value && value.date === date) : [];
  if (holidays.length > 1) return { status: 'unknown', windows: [] };
  if (holidays.length === 1) {
    const holiday = holidays[0];
    if (holiday.closed === true) return { status: 'closed', windows: [] };
    if (holiday.closed !== false) return { status: 'unknown', windows: [] };
    return resolveWindow(date, holiday.open, holiday.close, timeZone);
  }
  const day = hours[weekday(date)];
  if (!day || typeof day !== 'object' || Array.isArray(day)) return { status: 'unknown', windows: [] };
  if (!day.open && !day.close) return { status: 'closed', windows: [] };
  const base = resolveWindow(date, day.open, day.close, timeZone);
  if (base.status !== 'known' || !day.lunch) return base;
  const lunch = /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/.exec(day.lunch);
  if (!lunch) return { status: 'unknown', windows: [] };
  const lunchWindow = resolveWindow(date, lunch[1], lunch[3], timeZone);
  if (lunchWindow.status !== 'known') return lunchWindow;
  const work = base.windows[0];
  const pause = lunchWindow.windows[0];
  if (pause.start < work.start || pause.end > work.end || pause.end <= pause.start) {
    return { status: 'unknown', windows: [] };
  }
  return {
    status: 'known',
    windows: [
      ...(pause.start > work.start ? [{ start: work.start, end: pause.start }] : []),
      ...(pause.end < work.end ? [{ start: pause.end, end: work.end }] : []),
    ],
  };
}

function workingHoursCoverage(rawProfile, start, end, timeZone) {
  const first = schedulingTime.formatInstant(new Date(start), timeZone).date;
  const last = schedulingTime.formatInstant(new Date(end - 1), timeZone).date;
  const windows = [];
  const unknownDates = [];
  let date = dateAtOffset(first, -1);
  let guard = 0;
  while (date <= last && guard < 35) {
    const resolved = hoursForDate(rawProfile, date, timeZone);
    if (resolved.status === 'unknown' || resolved.status === 'ambiguous') unknownDates.push(date);
    windows.push(...resolved.windows);
    date = dateAtOffset(date, 1);
    guard += 1;
  }
  return { covered: covers(start, end, windows), unknownDates: Array.from(new Set(unknownDates)).sort() };
}

function entry(code, details) {
  return stableValue({ code, ...(details || {}) });
}

function stableEntries(values) {
  const byDigest = new Map();
  for (const value of values) byDigest.set(sha256(value), stableValue(value));
  return Array.from(byDigest.values()).sort(function (left, right) {
    return left.code.localeCompare(right.code) || JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

function candidateProfiles(candidate) {
  if (!candidate || candidate.exists !== true) return [];
  return candidate.kind === 'profile' ? candidate.members.slice(0, 1) : candidate.members;
}

function evaluateAvailability(member, start, end, hard, review) {
  const authority = member.availability;
  if (!authority || authority.malformed === true) {
    review.push(entry('availability_authority_missing', { profileId: member.profileId }));
    return;
  }
  const coverageStart = milliseconds(authority.coverageStart);
  const coverageEnd = milliseconds(authority.coverageEnd);
  if (!Number.isFinite(coverageStart) || !Number.isFinite(coverageEnd) || coverageStart > start || coverageEnd < end) {
    review.push(entry('availability_authority_stale', { profileId: member.profileId }));
    return;
  }
  const unavailable = authority.intervals.filter(interval => interval.kind === 'unavailable');
  if (unavailable.some(interval => overlap(start, end, milliseconds(interval.start), milliseconds(interval.end)))) {
    hard.push(entry('declared_unavailable', { profileId: member.profileId }));
    return;
  }
  const available = authority.intervals.filter(interval => interval.kind === 'available');
  if (!covers(start, end, available)) {
    review.push(entry('declared_availability_incomplete', { profileId: member.profileId }));
  }
}

function evaluateConflictEvidence(input) {
  const proposal = input.proposal;
  const start = milliseconds(proposal.scheduledStart);
  const end = milliseconds(proposal.scheduledEnd);
  const hard = [];
  const warnings = [];
  const review = [];
  const candidate = input.candidate;

  if (proposal.target.kind === 'unassigned') {
    review.push(entry('target_unassigned'));
  } else if (!candidate || candidate.exists !== true) {
    hard.push(entry('target_unavailable'));
  } else {
    const members = candidateProfiles(candidate);
    if (candidate.kind === 'crew' && members.length === 0) {
      review.push(entry('crew_membership_incomplete', { crewId: candidate.targetId }));
    }
    if (candidate.membersTruncated === true) {
      review.push(entry('crew_membership_bounded', { crewId: candidate.targetId }));
    }
    for (const member of members) {
      if (member.membershipStatus !== 'active' || member.userStatus !== 'active') {
        hard.push(entry(candidate.kind === 'crew' ? 'inactive_crew_member' : 'inactive_target', {
          profileId: member.profileId,
        }));
      }
    }

    const serviceId = input.appointment && input.appointment.serviceId;
    const serviceKnown = typeof serviceId === 'string' && STABLE_ID.test(serviceId) && input.skillAuthorityKnown === true;
    if (candidate.skillEvidenceTruncated === true) {
      review.push(entry('required_skill_authority_bounded'));
    } else if (!serviceKnown) {
      review.push(entry('required_skill_authority_missing'));
    } else if (!members.some(member => Array.isArray(member.serviceIds) &&
        member.serviceIds.some(value => typeof value === 'string' && value.toLowerCase() === serviceId.toLowerCase()))) {
      hard.push(entry('required_skill_mismatch', { serviceId }));
    }

    const requiredLocation = canonicalLocation(input.businessProfile, input.appointment && input.appointment.locationId);
    if (!requiredLocation) {
      review.push(entry('location_scope_authority_missing'));
    } else if (!candidate.locationId) {
      review.push(entry('target_location_scope_missing'));
    } else if (candidate.locationId.toLowerCase() !== requiredLocation.toLowerCase()) {
      hard.push(entry('location_scope_mismatch', { requiredLocationId: requiredLocation }));
    }

    const working = workingHoursCoverage(input.businessProfile, start, end, proposal.timeZone);
    if (!working.covered) {
      if (working.unknownDates.length) {
        review.push(entry('working_hours_authority_incomplete', { dates: working.unknownDates.slice(0, 32) }));
      } else {
        // Current Business Profile hours are operating policy. Mission 22 treats
        // them as an explainable warning until an accepted authority explicitly
        // marks the policy hard; the present profile contract has no such flag.
        warnings.push(entry('outside_working_hours'));
      }
    }

    if (candidate.availabilityEvidenceTruncated === true) {
      review.push(entry('availability_authority_bounded'));
    } else {
      for (const member of members) evaluateAvailability(member, start, end, hard, review);
    }

    const memberIds = new Set(members.map(member => member.profileId));
    const schedules = Array.isArray(input.schedules) ? input.schedules : [];
    for (const schedule of schedules) {
      const shared = (schedule.profileIds || []).filter(profileId => memberIds.has(profileId)).sort();
      if (!shared.length) continue;
      const scheduleStart = milliseconds(schedule.scheduledStart);
      const scheduleEnd = milliseconds(schedule.scheduledEnd);
      if (overlap(start, end, scheduleStart, scheduleEnd)) {
        for (const profileId of shared) {
          if (schedule.approved === true) {
            hard.push(entry('approved_schedule_overlap', { assignmentId: schedule.assignmentId, profileId }));
          } else {
            review.push(entry('overlap_authority_unapproved', { assignmentId: schedule.assignmentId, profileId }));
          }
        }
      }
    }

    const approvedOverlapSchedules = schedules.filter(schedule => schedule.approved === true);

    const scheduling = input.businessProfile && input.businessProfile.scheduling || {};
    const appointmentBuffer = boundedNumber(scheduling.appointmentBuffer, 0, 1440);
    const travelBuffer = boundedNumber(scheduling.travelBuffer, 0, 1440);
    const bufferMinutes = Math.max(appointmentBuffer || 0, travelBuffer || 0);
    if (bufferMinutes > 0) {
      const buffer = bufferMinutes * 60000;
      for (const schedule of approvedOverlapSchedules) {
        const shared = (schedule.profileIds || []).filter(profileId => memberIds.has(profileId)).sort();
        if (!shared.length) continue;
        const scheduleStart = milliseconds(schedule.scheduledStart);
        const scheduleEnd = milliseconds(schedule.scheduledEnd);
        if (!overlap(start, end, scheduleStart, scheduleEnd) &&
            overlap(start - buffer, end + buffer, scheduleStart, scheduleEnd)) {
          warnings.push(entry('schedule_buffer_threshold', {
            assignmentId: schedule.assignmentId,
            bufferMinutes,
            profileIds: shared,
          }));
        }
      }
    }

    const workloadSchedules = Array.isArray(input.workloadSchedules) ? input.workloadSchedules : schedules;
    const workloadDays = applicableWorkloadDays(start, end, proposal.timeZone);
    if (input.workloadSetTruncated === true) review.push(entry('workload_evidence_bounded'));
    if (input.workloadAuthorityMissing === true || workloadDays.incomplete) {
      review.push(entry('workload_authority_incomplete'));
    }
    const maxJobs = boundedNumber(scheduling.maxJobsPerDay, 1, 1000);
    const workDayLength = boundedNumber(scheduling.workDayLength, 0.25, 24);
    for (const member of members) {
      for (const day of workloadDays.days) {
        const memberSchedules = workloadSchedules.filter(function (schedule) {
          if (!(schedule.profileIds || []).includes(member.profileId)) return false;
          const scheduleStart = milliseconds(schedule.scheduledStart);
          const scheduleEnd = milliseconds(schedule.scheduledEnd);
          return Number.isFinite(scheduleStart) && Number.isFinite(scheduleEnd) &&
            overlap(day.start, day.end, scheduleStart, scheduleEnd);
        });
        const unapproved = memberSchedules.filter(schedule => schedule.approved !== true);
        for (const schedule of unapproved) {
          review.push(entry('workload_authority_unapproved', {
            assignmentId: schedule.assignmentId,
            localDate: day.date,
            profileId: member.profileId,
          }));
        }
        const approved = memberSchedules.filter(schedule => schedule.approved === true);
        if (maxJobs !== null && approved.length + 1 > maxJobs) {
          warnings.push(entry('max_jobs_per_day_threshold', {
            localDate: day.date,
            profileId: member.profileId,
            proposedJobs: approved.length + 1,
            threshold: maxJobs,
          }));
        }
        if (workDayLength !== null) {
          const proposedMinutes = Math.max(0, Math.min(end, day.end) - Math.max(start, day.start)) / 60000;
          const minutes = proposedMinutes + approved.reduce(function (total, schedule) {
            const scheduleStart = milliseconds(schedule.scheduledStart);
            const scheduleEnd = milliseconds(schedule.scheduledEnd);
            return total + Math.max(0, Math.min(scheduleEnd, day.end) - Math.max(scheduleStart, day.start)) / 60000;
          }, 0);
          if (minutes > workDayLength * 60) {
            warnings.push(entry('workday_length_threshold', {
              localDate: day.date,
              profileId: member.profileId,
              proposedMinutes: Math.round(minutes),
              thresholdMinutes: Math.round(workDayLength * 60),
            }));
          }
        }
      }
    }
    const maxCrewSize = boundedNumber(input.businessProfile && input.businessProfile.crew &&
      input.businessProfile.crew.maxCrewSize, 1, 1000);
    if (candidate.kind === 'crew' && maxCrewSize !== null && members.length > maxCrewSize) {
      warnings.push(entry('crew_size_threshold', {
        proposedSize: members.length,
        threshold: maxCrewSize,
      }));
    }
  }

  if (input.scheduleSetTruncated === true) review.push(entry('schedule_evidence_bounded'));
  const allHardConflicts = stableEntries(hard);
  const allWarnings = stableEntries(warnings);
  let allReviewReasons = stableEntries(review);
  if (allHardConflicts.length > MAXIMUM_RESULT_ENTRIES ||
      allWarnings.length > MAXIMUM_RESULT_ENTRIES ||
      allReviewReasons.length > MAXIMUM_RESULT_ENTRIES) {
    allReviewReasons = stableEntries(allReviewReasons.concat([entry('conflict_evidence_bounded', {
      hardConflictCount: allHardConflicts.length,
      reviewReasonCount: allReviewReasons.length,
      warningCount: allWarnings.length,
    })]));
  }
  const hardConflicts = allHardConflicts.slice(0, MAXIMUM_RESULT_ENTRIES);
  const warningEntries = allWarnings.slice(0, MAXIMUM_RESULT_ENTRIES);
  const reviewReasons = allReviewReasons.slice(0, MAXIMUM_RESULT_ENTRIES);
  const status = hardConflicts.length ? 'hard_conflict'
    : reviewReasons.length ? 'needs_review'
      : warningEntries.length ? 'warning' : 'clear';
  return Object.freeze({
    version: EVALUATION_VERSION,
    status,
    hardConflicts: Object.freeze(hardConflicts),
    warnings: Object.freeze(warningEntries),
    needsReview: reviewReasons.length > 0,
    reviewReasons: Object.freeze(reviewReasons),
  });
}

module.exports = {
  EVALUATION_VERSION,
  MAXIMUM_RESULT_ENTRIES,
  evaluateConflictEvidence,
  workingHoursCoverage,
};
