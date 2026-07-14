/**
 * Polaris Capacity Forecasting — Schedule & Capacity Intelligence
 *
 * CAPACITY IS A CONSUMER OF POLARIS, NOT A SEPARATE ENGINE.
 *
 * This module does NOT create independent estimation logic.
 * It derives forecasts from the unified PolarisEstimate object
 * produced by PolarisEngine (duration, crew, travel, pricing).
 *
 * Questions answered:
 *   - Can this job fit into today's schedule?
 *   - What crew should perform this work?
 *   - What is the earliest available appointment?
 *   - Which technician or crew is best suited?
 *   - Will accepting this job reduce profitability?
 *   - Will accepting this job create scheduling conflicts?
 *   - How much unused capacity exists today, this week, this month?
 *   - What projected revenue remains available before reaching capacity?
 *
 * Architectural rules (owner-ratified):
 *   - PolarisEngine is the orchestration layer
 *   - PolarisEstimate is the single source of truth
 *   - No duplicate business logic
 *   - No frontend estimation logic
 *   - Backward compatible
 *   - Existing modules unchanged
 */

const store = require('./store');

// ── Default Operating Hours ──
const DEFAULT_HOURS = {
  start: 7,     // 7:00 AM
  end: 17,      // 5:00 PM
  lunchStart: 12,
  lunchEnd: 13,
  daysPerWeek: 5,
  maxParallelJobsPerCrew: 1,
};

// ── Capacity Thresholds ──
const CAPACITY_THRESHOLDS = {
  critical: 0.90,     // >90% booked → critical
  warning: 0.75,      // >75% booked → warning
  healthy: 0.50,      // >50% booked → healthy
  available: 0.0,     // <50% → ample available
};

// ── Day Weights (for seasonal capacity adjustment) ──
const DAY_WEIGHTS = {
  monday: 1.0,
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.0,
  friday: 1.0,
  saturday: 0.6,
  sunday: 0.3,
};

/**
 * Main entry: Get full capacity forecast for a given date range.
 * Consumes the unified PolarisEstimate and existing schedule data.
 *
 * @param {object} config - Capacity forecasting configuration
 * @param {string} config.startDate - ISO date string for range start
 * @param {string} [config.endDate] - ISO date string for range end (defaults to startDate + 30 days)
 * @param {object[]} [config.schedule] - Existing scheduled jobs (each with startTime, endTime, crewId, etc.)
 * @param {object[]} [config.crews] - Available crew definitions
 * @param {number} [config.operatingHoursStart] - e.g. 7 for 7am
 * @param {number} [config.operatingHoursEnd] - e.g. 17 for 5pm
 * @returns {object} Capacity forecast
 */
function getCapacityForecast(config) {
  if (!config || !config.startDate) {
    return { error: 'startDate is required' };
  }

  const startDate = new Date(config.startDate);
  const endDate = config.endDate ? new Date(config.endDate) : _addDays(startDate, 30);
  const schedule = config.schedule || [];
  const crews = config.crews || [];
  const opsStart = config.operatingHoursStart || DEFAULT_HOURS.start;
  const opsEnd = config.operatingHoursEnd || DEFAULT_HOURS.end;
  const opsHoursPerDay = opsEnd - opsStart;

  // ── Step 1: Calculate daily capacity windows ──
  const dailyCapacity = _calculateDailyCapacity(startDate, endDate, opsStart, opsEnd, crews);

  // ── Step 2: Calculate booked hours per day ──
  const bookedHours = _calculateBookedHours(schedule, startDate, endDate);

  // ── Step 3: Calculate unused capacity per day ──
  const unusedCapacity = _calculateUnusedCapacity(dailyCapacity, bookedHours);

  // ── Step 4: Aggregate by period ──
  const today = _normalizeDate(new Date());
  const todayStr = today.toISOString().split('T')[0];
  const todayCapacity = unusedCapacity.find(d => d.date === todayStr) || { date: todayStr, availableHours: opsHoursPerDay * Math.max(1, crews.length), usedHours: 0, utilization: 0 };
  const thisWeek = _aggregateByWeek(unusedCapacity, startDate, endDate, today);
  const thisMonth = _aggregateByMonth(unusedCapacity);

  // ── Step 5: Calculate remaining revenue capacity ──
  const remainingRevenue = _calculateRemainingRevenue(unusedCapacity, schedule, crews);

  // ── Step 6: Generate insights ──
  const insights = _generateCapacityInsights(todayCapacity, thisWeek, thisMonth, unusedCapacity, dailyCapacity);

  // ── Step 7: Recommendations ──
  const recommendations = _generateCapacityRecommendations(todayCapacity, thisWeek, thisMonth, unusedCapacity, insights);

  return {
    forecastPeriod: {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
      totalDays: _daysBetween(startDate, endDate),
    },

    // Per-day breakdown
    dailyBreakdown: unusedCapacity.map(d => ({
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      isWeekend: d.isWeekend,
      availableHours: parseFloat(d.availableHours.toFixed(1)),
      bookedHours: parseFloat(d.bookedHours.toFixed(1)),
      usedHours: parseFloat(d.usedHours.toFixed(1)),
      utilization: parseFloat((d.utilization * 100).toFixed(1)),
      status: _getCapacityStatus(d.utilization),
    })),

    // Aggregated views
    today: {
      date: todayStr,
      status: _getCapacityStatus(todayCapacity.utilization),
      availableHours: parseFloat(todayCapacity.availableHours.toFixed(1)),
      bookedHours: parseFloat(todayCapacity.bookedHours.toFixed(1)),
      usedHours: parseFloat(todayCapacity.usedHours.toFixed(1)),
      utilization: parseFloat((todayCapacity.utilization * 100).toFixed(1)),
    },

    thisWeek: {
      totalAvailableHours: parseFloat(thisWeek.availableHours.toFixed(1)),
      totalBookedHours: parseFloat(thisWeek.bookedHours.toFixed(1)),
      totalUsedHours: parseFloat(thisWeek.usedHours.toFixed(1)),
      averageUtilization: parseFloat((thisWeek.utilization * 100).toFixed(1)),
      status: _getCapacityStatus(thisWeek.utilization),
      daysRemaining: thisWeek.daysRemaining,
    },

    thisMonth: {
      totalAvailableHours: parseFloat(thisMonth.availableHours.toFixed(1)),
      totalBookedHours: parseFloat(thisMonth.bookedHours.toFixed(1)),
      totalUsedHours: parseFloat(thisMonth.usedHours.toFixed(1)),
      averageUtilization: parseFloat((thisMonth.utilization * 100).toFixed(1)),
      status: _getCapacityStatus(thisMonth.utilization),
      daysRemaining: thisMonth.daysRemaining,
    },

    // Revenue capacity
    remainingRevenueCapacity: {
      thisWeek: remainingRevenue.thisWeek,
      thisMonth: remainingRevenue.thisMonth,
      projectedDailyRevenue: remainingRevenue.projectedDailyRevenue,
      reasoning: remainingRevenue.reasoning,
    },

    // Insights & recommendations
    insights: insights.map(i => ({
      type: i.type,
      severity: i.severity,
      message: i.message,
      actionable: i.actionable,
    })),

    recommendations: recommendations.map(r => ({
      priority: r.priority,
      action: r.action,
      reason: r.reason,
      impact: r.impact,
    })),

    predictionVersion: 'v1',
  };
}

/**
 * Check if a proposed job can fit into the existing schedule.
 * Consumes the PolarisEstimate (duration, crew, travel) to determine fit.
 *
 * @param {object} job - Proposed job with PolarisEstimate fields
 * @param {object} [job.estimatedDurationHours] - From PolarisEstimate
 * @param {object} [job.crewSize] - Recommended crew size
 * @param {object} [job.travelMinutes] - Travel time
 * @param {object} [job.serviceType] - Type of service
 * @param {object} [job.preferredDate] - Desired date
 * @param {object} [job.preferredTime] - Desired time
 * @param {object[]} schedule - Existing scheduled jobs
 * @param {object[]} crews - Available crews
 * @returns {object} Schedule fit analysis
 */
function canFitInSchedule(job, schedule, crews) {
  if (!job) return { error: 'job is required' };

  const durationHours = job.estimatedDurationHours || 2;
  const travelMinutes = job.travelMinutes || 30;
  const crewSize = job.crewSize || 2;
  const preferredDate = job.preferredDate || null;
  const preferredTime = job.preferredTime || null;

  // Total time block needed (duration + travel buffer + buffer)
  const totalBlockHours = durationHours + (travelMinutes / 60) + 0.5; // +0.5h buffer

  // Find available crews
  const availableCrews = (crews && crews.length > 0) ? crews : [{ id: 'default', size: 3, skills: ['general'] }];

  // Find suitable crews
  const suitableCrews = availableCrews.filter(c => (c.size || 3) >= crewSize);

  // Check each suitable crew for availability
  const crewAvailability = suitableCrews.map(crew => {
    const crewSchedule = schedule.filter(s => s.crewId === crew.id);
    const availableSlots = _findAvailableSlots(crewSchedule, totalBlockHours, preferredDate, preferredTime);
    return {
      crewId: crew.id,
      crewSize: crew.size || 3,
      availableSlots: availableSlots.map(s => ({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        durationHours: s.durationHours,
      })),
      bestSlot: availableSlots.length > 0 ? availableSlots[0] : null,
      hasAvailability: availableSlots.length > 0,
    };
  });

  const anyAvailable = crewAvailability.some(c => c.hasAvailability);
  const bestFit = crewAvailability
    .filter(c => c.hasAvailability)
    .sort((a, b) => (a.bestSlot?.durationHours || 0) - (b.bestSlot?.durationHours || 0))[0] || null;

  return {
    canFit: anyAvailable,
    bestFit: bestFit ? {
      crewId: bestFit.crewId,
      date: bestFit.bestSlot.date,
      startTime: bestFit.bestSlot.startTime,
      endTime: bestFit.bestSlot.endTime,
    } : null,
    crewAvailability: crewAvailability.map(c => ({
      crewId: c.crewId,
      hasAvailability: c.hasAvailability,
      availableSlots: c.availableSlots.length,
    })),
    requiredBlock: {
      durationHours,
      travelMinutes,
      totalBlockHours,
      crewSizeNeeded: crewSize,
    },
    reasoning: anyAvailable
      ? `Job requires ${totalBlockHours}h block with ${crewSize}-person crew. ${bestFit ? `Available on ${bestFit.bestSlot.date} at ${bestFit.bestSlot.startTime} with crew ${bestFit.crewId}.` : 'Slot available.'}`
      : `No available slot found for ${totalBlockHours}h block with ${crewSize}-person crew. Consider rescheduling or expanding crew availability.`,
  };
}

/**
 * Get earliest available appointment for a proposed job.
 *
 * @param {object} job - Proposed job with PolarisEstimate fields
 * @param {object[]} schedule - Existing schedule
 * @param {object[]} crews - Available crews
 * @returns {object} Earliest appointment recommendation
 */
function getEarliestAppointment(job, schedule, crews) {
  if (!job) return { error: 'job is required' };

  const durationHours = job.estimatedDurationHours || 2;
  const travelMinutes = job.travelMinutes || 30;
  const totalBlockHours = durationHours + (travelMinutes / 60) + 0.5;

  const availableCrews = crews.length > 0 ? crews : [{ id: 'default', size: 3, skills: ['general'] }];

  let earliestSlot = null;
  let earliestCrew = null;

  // Look ahead 14 days
  const lookAheadDays = 14;
  const today = _normalizeDate(new Date());

  for (let day = 0; day <= lookAheadDays; day++) {
    const date = _addDays(today, day);
    const dateStr = date.toISOString().split('T')[0];
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    // Skip weekends if not operating
    if (dayName === 'saturday' || dayName === 'sunday') {
      if (dayName === 'saturday' && DEFAULT_HOURS.daysPerWeek < 6) continue;
      if (dayName === 'sunday' && DEFAULT_HOURS.daysPerWeek < 7) continue;
    }

    for (const crew of availableCrews) {
      const crewSchedule = schedule.filter(s =>
        s.crewId === crew.id &&
        s.date === dateStr
      );

      const slots = _findAvailableSlotsForDate(crewSchedule, dateStr, totalBlockHours);
      if (slots.length > 0) {
        earliestSlot = slots[0];
        earliestCrew = crew;
        break;
      }
    }

    if (earliestSlot) break;
  }

  return {
    hasAvailability: earliestSlot !== null,
    earliestDate: earliestSlot ? earliestSlot.date : null,
    earliestTime: earliestSlot ? earliestSlot.startTime : null,
    recommendedCrew: earliestCrew ? {
      id: earliestCrew.id,
      name: earliestCrew.name || earliestCrew.id,
      size: earliestCrew.size || 3,
    } : null,
    totalBlockHours,
    lookAheadDays,
    reasoning: earliestSlot
      ? `Earliest available: ${earliestSlot.date} at ${earliestSlot.startTime} with crew ${earliestCrew?.id || 'default'} (${totalBlockHours}h block).`
      : `No availability within next ${lookAheadDays} days for a ${totalBlockHours}h block. Consider expanding crew or hours.`,
  };
}

/**
 * Get best crew fit for a job based on skill match, availability, and efficiency.
 *
 * @param {object} job - Proposed job with serviceType, crewRequirements
 * @param {object[]} crews - Available crews with skills, certifications, efficiency metrics
 * @returns {object} Best crew recommendation
 */
function getBestCrewForJob(job, crews) {
  if (!job || !crews || crews.length === 0) {
    return { error: 'job and crews are required' };
  }

  const serviceType = job.serviceType || 'General';
  const requiredSkills = job.requiredSkills || [];
  const requiredCerts = job.requiredCertifications || [];
  const crewSize = job.crewSize || 2;

  const scoredCrews = crews.map(crew => {
    let score = 0;
    const reasons = [];

    // Skill match (0-40 points)
    const crewSkills = crew.skills || [];
    const matchingSkills = requiredSkills.filter(s => crewSkills.includes(s));
    const skillScore = requiredSkills.length > 0
      ? (matchingSkills.length / requiredSkills.length) * 40
      : 20; // Partial credit if no specific skills required
    score += skillScore;
    if (matchingSkills.length > 0) reasons.push(`${matchingSkills.length}/${requiredSkills.length} skills match`);

    // Certification match (0-25 points)
    const crewCerts = crew.certifications || [];
    const matchingCerts = requiredCerts.filter(c => crewCerts.includes(c));
    const certScore = requiredCerts.length > 0
      ? (matchingCerts.length / requiredCerts.length) * 25
      : 15;
    score += certScore;
    if (matchingCerts.length > 0) reasons.push(`${matchingCerts.length}/${requiredCerts.length} certifications match`);

    // Crew size adequacy (0-20 points)
    const crewMaxSize = crew.size || 3;
    if (crewMaxSize >= crewSize) {
      score += 20;
      reasons.push('Crew size adequate');
    } else {
      score += 5;
      reasons.push(`Crew size ${crewMaxSize} < needed ${crewSize}`);
    }

    // Efficiency (0-15 points)
    const efficiency = crew.efficiency || 1.0;
    const efficiencyScore = Math.max(0, 15 * (1 - (efficiency - 0.7)));
    score += efficiencyScore;
    if (efficiency < 1.0) reasons.push(`Efficient crew (${Math.round((1 - efficiency) * 100)}% faster)`);

    return {
      crewId: crew.id,
      crewName: crew.name || crew.id,
      crewSize: crew.size || 3,
      score: Math.round(score),
      reasoning: reasons.join('; '),
    };
  });

  // Sort by score descending
  scoredCrews.sort((a, b) => b.score - a.score);

  const best = scoredCrews[0];

  return {
    bestCrew: best,
    allScored: scoredCrews,
    reasoning: `Best crew: ${best.crewName} (score: ${best.score}/100). ${best.reasoning}.`,
    recommendation: best.score >= 60
      ? 'recommended'
      : best.score >= 40
        ? 'acceptable'
        : 'not_recommended',
  };
}

/**
 * Check if accepting a proposed job would reduce profitability.
 * Consumes the PolarisEstimate to evaluate financial impact.
 *
 * @param {object} job - Proposed job with price, estimatedCost, etc.
 * @param {object[]} schedule - Existing schedule with revenue/cost data
 * @returns {object} Profitability impact analysis
 */
function checkProfitabilityImpact(job, schedule) {
  if (!job) return { error: 'job is required' };

  const jobRevenue = job.estimatedPrice || 0;
  const jobCost = (job.laborCost || 0) + (job.travelCost || 0) + (job.materialCost || 0);
  const jobMargin = jobRevenue > 0 ? ((jobRevenue - jobCost) / jobRevenue) * 100 : 0;

  // Calculate average margin of existing jobs
  const jobsWithData = (schedule || []).filter(s => s.estimatedPrice > 0);
  const avgMargin = jobsWithData.length > 0
    ? jobsWithData.reduce((sum, s) => {
        const cost = (s.laborCost || 0) + (s.travelCost || 0) + (s.materialCost || 0);
        const margin = s.estimatedPrice > 0 ? ((s.estimatedPrice - cost) / s.estimatedPrice) * 100 : 0;
        return sum + margin;
      }, 0) / jobsWithData.length
    : 35; // Industry average default

  const marginDelta = parseFloat((jobMargin - avgMargin).toFixed(1));
  const isProfitable = jobMargin > 0;
  const isAboveAverage = marginDelta > 0;

  // Revenue displacement check
  const potentialDisplacement = jobsWithData.length > 0
    ? parseFloat((avgMargin - jobMargin).toFixed(1))
    : 0;

  return {
    jobMargin: parseFloat(jobMargin.toFixed(1)),
    averageMargin: parseFloat(avgMargin.toFixed(1)),
    marginDelta,
    isProfitable,
    isAboveAverage,
    revenueDisplacement: potentialDisplacement > 0 ? potentialDisplacement : 0,
    reasoning: isProfitable
      ? isAboveAverage
        ? `Job margin ${jobMargin.toFixed(1)}% exceeds average (${avgMargin.toFixed(1)}%) — profitable addition.`
        : `Job margin ${jobMargin.toFixed(1)}% is below average (${avgMargin.toFixed(1)}%) but still profitable.`
      : `Job margin ${jobMargin.toFixed(1)}% is negative — not profitable.`,
    recommendation: isProfitable
      ? (isAboveAverage ? 'accept' : 'accept_with_review')
      : 'reject',
  };
}

/**
 * Check for scheduling conflicts given a proposed job and existing schedule.
 *
 * @param {object} job - Proposed job with date, time, duration, crewId
 * @param {object[]} schedule - Existing schedule
 * @returns {object} Conflict analysis
 */
function checkSchedulingConflicts(job, schedule) {
  if (!job) return { error: 'job is required' };

  const jobDate = job.date || job.preferredDate;
  const jobStart = job.time || job.preferredTime;
  const jobDuration = job.estimatedDurationHours || 2;
  const jobTravel = job.travelMinutes || 30;
  const jobCrewId = job.crewId || null;

  if (!jobDate) return { error: 'job date is required for conflict check' };

  const totalBlock = jobDuration + (jobTravel / 60) + 0.5;

  // Find overlapping jobs
  const scheduleArray = Array.isArray(schedule) ? schedule : (schedule ? [schedule] : []);
  const sameDayJobs = scheduleArray.filter(s => s.date === jobDate);
  const conflicts = [];

  for (const existing of sameDayJobs) {
    const existingStart = existing.startTime || existing.time || '00:00';
    const existingDuration = existing.estimatedDurationHours || 2;
    const existingEnd = _addTime(existingStart, existingDuration);

    // Check crew conflict
    if (jobCrewId && existing.crewId === jobCrewId) {
      const jobStartObj = _timeToMinutes(jobStart || '00:00');
      const jobEndObj = _timeToMinutes(_addTime(jobStart || '00:00', totalBlock));
      const existingStartObj = _timeToMinutes(existingStart);
      const existingEndObj = _timeToMinutes(existingEnd);

      if (jobStartObj < existingEndObj && jobEndObj > existingStartObj) {
        conflicts.push({
          type: 'crew_overlap',
          severity: 'critical',
          description: `Crew ${jobCrewId} is already booked ${existingStart}-${existingEnd}`,
          conflictingJob: existing.id || 'unknown',
        });
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    totalJobsOnDate: sameDayJobs.length,
    reasoning: conflicts.length > 0
      ? `${conflicts.length} conflict(s) found: ${conflicts.map(c => c.description).join('; ')}`
      : 'No scheduling conflicts detected.',
  };
}

/**
 * Get unused capacity for a specific period.
 *
 * @param {object[]} schedule - Existing schedule
 * @param {string} startDate - ISO date
 * @param {string} [endDate] - ISO date (defaults to +7 days)
 * @param {object[]} [crews] - Available crews
 * @returns {object} Unused capacity analysis
 */
function getUnusedCapacity(schedule, startDate, endDate, crews) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : _addDays(start, 7);
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  const forecast = getCapacityForecast({
    startDate: startStr,
    endDate: endStr,
    schedule: schedule || [],
    crews: crews || [],
  });

  const totalAvailable = forecast.dailyBreakdown.reduce((s, d) => s + d.availableHours, 0);
  const totalUsed = forecast.dailyBreakdown.reduce((s, d) => s + d.usedHours, 0);
  const totalUnused = totalAvailable - totalUsed;

  // Find best days for new bookings
  const bestDays = [...forecast.dailyBreakdown]
    .filter(d => d.utilization < 50)
    .sort((a, b) => a.utilization - b.utilization)
    .slice(0, 3)
    .map(d => ({
      date: d.date,
      availableHours: d.availableHours - d.bookedHours,
      utilization: d.utilization,
    }));

  return {
    totalAvailableHours: parseFloat(totalAvailable.toFixed(1)),
    totalUsedHours: parseFloat(totalUsed.toFixed(1)),
    unusedHours: parseFloat(totalUnused.toFixed(1)),
    utilizationPercent: parseFloat(((totalUsed / totalAvailable) * 100).toFixed(1)),
    averageDailyUnused: parseFloat((totalUnused / forecast.dailyBreakdown.length).toFixed(1)),
    bestDaysForNewBookings: bestDays,
    period: { start: startStr, end: endStr },
    reasoning: `${totalUnused.toFixed(1)} unused hours across ${forecast.dailyBreakdown.length} days. ${bestDays.length > 0 ? `Best days: ${bestDays.map(d => d.date).join(', ')}.` : 'No low-utilization days found.'}`,
  };
}

/**
 * Get the projected revenue remaining before reaching capacity.
 *
 * @param {object[]} schedule - Existing schedule with revenue data
 * @param {string} dateRange - Date range config
 * @returns {object} Revenue capacity analysis
 */
function getRemainingRevenueCapacity(schedule, dateRange, crews) {
  const startDate = dateRange?.startDate || new Date().toISOString().split('T')[0];
  const endDate = dateRange?.endDate || _addDays(new Date(startDate), 30).toISOString().split('T')[0];

  const forecast = getCapacityForecast({
    startDate,
    endDate,
    schedule: schedule || [],
    crews: crews || [],
  });

  // Calculate average revenue per booked hour from existing jobs
  const jobsWithRevenue = (schedule || []).filter(s => s.estimatedPrice > 0 && s.estimatedDurationHours > 0);
  const avgRevenuePerHour = jobsWithRevenue.length > 0
    ? jobsWithRevenue.reduce((s, j) => s + j.estimatedPrice / j.estimatedDurationHours, 0) / jobsWithRevenue.length
    : 250; // Default: $250/hr

  // Remaining revenue capacity
  const remainingHours = forecast.remainingRevenueCapacity.thisMonth.remainingHours || 0;
  const remainingRevenue = remainingHours * avgRevenuePerHour;

  return {
    remainingHours: parseFloat(remainingHours.toFixed(1)),
    averageRevenuePerHour: parseFloat(avgRevenuePerHour.toFixed(2)),
    projectedRemainingRevenue: parseFloat(remainingRevenue.toFixed(2)),
    utilization: forecast.thisMonth.averageUtilization,
    status: forecast.thisMonth.status,
    reasoning: `${remainingHours.toFixed(1)} remaining hours at $${avgRevenuePerHour.toFixed(2)}/hr = $${remainingRevenue.toFixed(2)} projected remaining revenue.`,
  };
}

// ── Internal: Capacity Calculations ──

function _calculateDailyCapacity(startDate, endDate, opsStart, opsEnd, crews) {
  const days = [];
  const current = new Date(startDate);
  const crewCount = Math.max(1, crews.length);

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const dayName = current.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const isWeekend = dayName === 'saturday' || dayName === 'sunday';

    const dayWeight = DAY_WEIGHTS[dayName] || 1.0;
    const opsHours = (opsEnd - opsStart) * dayWeight;
    const totalAvailableHours = opsHours * crewCount * DEFAULT_HOURS.maxParallelJobsPerCrew;

    days.push({
      date: dateStr,
      dayOfWeek: dayName,
      isWeekend,
      weight: dayWeight,
      operatingHours: opsHours,
      totalAvailableHours,
    });

    current.setDate(current.getDate() + 1);
  }

  return days;
}

function _calculateBookedHours(schedule, startDate, endDate) {
  const booked = {};

  (schedule || []).forEach(job => {
    const jobDate = job.date || job.scheduledDate;
    if (!jobDate) return;

    const jobDateObj = new Date(jobDate);
    if (jobDateObj < startDate || jobDateObj > endDate) return;

    const duration = job.estimatedDurationHours || 2;
    const travel = job.travelMinutes || 0;
    const totalHours = duration + (travel / 60);

    if (!booked[jobDate]) {
      booked[jobDate] = 0;
    }
    booked[jobDate] += totalHours;
  });

  return booked;
}

function _calculateUnusedCapacity(dailyCapacity, bookedHours) {
  return dailyCapacity.map(day => {
    const booked = bookedHours[day.date] || 0;
    const usedHours = Math.min(booked, day.totalAvailableHours);
    const availableHours = day.totalAvailableHours;
    const utilization = availableHours > 0 ? usedHours / availableHours : 0;

    return {
      date: day.date,
      dayOfWeek: day.dayOfWeek,
      isWeekend: day.isWeekend,
      availableHours,
      bookedHours: booked,
      usedHours,
      utilization,
    };
  });
}

function _aggregateByWeek(unusedCapacity, startDate, endDate, today) {
  const weekDays = unusedCapacity.filter(d => {
    const date = new Date(d.date);
    const weekStart = _getWeekStart(today);
    const weekEnd = _addDays(weekStart, 7);
    return date >= weekStart && date < weekEnd;
  });

  const totalAvailable = weekDays.reduce((s, d) => s + d.availableHours, 0);
  const totalBooked = weekDays.reduce((s, d) => s + d.bookedHours, 0);
  const totalUsed = weekDays.reduce((s, d) => s + d.usedHours, 0);
  const utilization = totalAvailable > 0 ? totalUsed / totalAvailable : 0;

  // Calculate remaining days in the week
  const todayDate = _normalizeDate(today);
  const weekEndDate = _getWeekEnd(today);
  const daysRemaining = Math.max(0, Math.ceil((weekEndDate - todayDate) / (1000 * 60 * 60 * 24)));

  return { availableHours: totalAvailable, bookedHours: totalBooked, usedHours: totalUsed, utilization, daysRemaining };
}

function _aggregateByMonth(unusedCapacity) {
  const totalAvailable = unusedCapacity.reduce((s, d) => s + d.availableHours, 0);
  const totalBooked = unusedCapacity.reduce((s, d) => s + d.bookedHours, 0);
  const totalUsed = unusedCapacity.reduce((s, d) => s + d.usedHours, 0);
  const utilization = totalAvailable > 0 ? totalUsed / totalAvailable : 0;

  // Count remaining days in the month
  const today = new Date();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysRemaining = Math.max(0, Math.ceil((lastDayOfMonth - today) / (1000 * 60 * 60 * 24)));

  return { availableHours: totalAvailable, bookedHours: totalBooked, usedHours: totalUsed, utilization, daysRemaining };
}

function _calculateRemainingRevenue(unusedCapacity, schedule, crews) {
  const totalHours = unusedCapacity.reduce((s, d) => s + d.availableHours, 0);
  const usedHours = unusedCapacity.reduce((s, d) => s + d.usedHours, 0);
  const remainingHours = totalHours - usedHours;

  // Calculate average revenue per hour
  const jobsWithRevenue = (schedule || []).filter(s => s.estimatedPrice > 0);
  const avgRevenuePerHour = jobsWithRevenue.length > 0
    ? jobsWithRevenue.reduce((s, j) => s + (j.estimatedPrice / (j.estimatedDurationHours || 2)), 0) / jobsWithRevenue.length
    : 250;

  // Weekly vs monthly
  const weekHours = unusedCapacity.filter(d => {
    const date = new Date(d.date);
    const weekStart = _getWeekStart(new Date());
    const weekEnd = _addDays(weekStart, 7);
    return date >= weekStart && date < weekEnd;
  }).reduce((s, d) => s + (d.availableHours - d.usedHours), 0);

  const monthHours = remainingHours;

  return {
    thisWeek: {
      remainingHours: parseFloat(weekHours.toFixed(1)),
      projectedRevenue: parseFloat((weekHours * avgRevenuePerHour).toFixed(2)),
    },
    thisMonth: {
      remainingHours: parseFloat(monthHours.toFixed(1)),
      projectedRevenue: parseFloat((monthHours * avgRevenuePerHour).toFixed(2)),
    },
    projectedDailyRevenue: parseFloat(avgRevenuePerHour.toFixed(2)),
    reasoning: `${monthHours.toFixed(1)} remaining hours at $${avgRevenuePerHour.toFixed(2)}/hr average.`,
  };
}

function _getCapacityStatus(utilization) {
  if (utilization >= CAPACITY_THRESHOLDS.critical) return 'critical';
  if (utilization >= CAPACITY_THRESHOLDS.warning) return 'warning';
  if (utilization >= CAPACITY_THRESHOLDS.healthy) return 'healthy';
  return 'available';
}

function _generateCapacityInsights(today, thisWeek, thisMonth, unusedCapacity, dailyCapacity) {
  const insights = [];

  // Today's status
  if (today.utilization >= 90) {
    insights.push({ type: 'capacity', severity: 'critical', message: 'Today is nearly fully booked.', actionable: true });
  } else if (today.utilization >= 75) {
    insights.push({ type: 'capacity', severity: 'warning', message: 'Today has limited availability remaining.', actionable: true });
  } else if (today.utilization <= 25) {
    insights.push({ type: 'opportunity', severity: 'info', message: 'Today has ample open slots — consider promotions.', actionable: false });
  }

  // Weekly trend
  if (thisWeek.utilization >= 90) {
    insights.push({ type: 'capacity', severity: 'critical', message: 'This week is nearly fully booked — consider overtime or subcontractors.', actionable: true });
  } else if (thisWeek.utilization <= 40) {
    insights.push({ type: 'opportunity', severity: 'info', message: `This week has ${thisWeek.daysRemaining} days with ${thisWeek.availableHours - thisWeek.usedHours}h available capacity.`, actionable: false });
  }

  // Monthly trend
  if (thisMonth.utilization >= 85) {
    insights.push({ type: 'capacity', severity: 'warning', message: `Monthly capacity nearing limit (${thisMonth.averageUtilization}%). Consider expanding hours or crew.`, actionable: true });
  } else if (thisMonth.utilization <= 30) {
    insights.push({ type: 'opportunity', severity: 'info', message: `Significant monthly capacity remaining (${thisMonth.averageUtilization}% utilized).`, actionable: false });
  }

  // Low-utilization days
  const lowUtilDays = unusedCapacity.filter(d => d.utilization < 0.25 && !d.isWeekend);
  if (lowUtilDays.length >= 3) {
    insights.push({
      type: 'opportunity',
      severity: 'info',
      message: `${lowUtilDays.length} low-utilization days found (${lowUtilDays.map(d => d.date).join(', ')}).`,
      actionable: true,
    });
  }

  // Peak days
  const highUtilDays = unusedCapacity.filter(d => d.utilization >= 0.85);
  if (highUtilDays.length >= 2) {
    insights.push({
      type: 'capacity',
      severity: 'warning',
      message: `${highUtilDays.length} days at or near capacity.`,
      actionable: true,
    });
  }

  return insights;
}

function _generateCapacityRecommendations(today, thisWeek, thisMonth, unusedCapacity, insights) {
  const recommendations = [];

  // Critical capacity
  const criticalInsights = insights.filter(i => i.severity === 'critical');
  if (criticalInsights.length > 0) {
    recommendations.push({
      priority: 'high',
      action: 'Review scheduling priorities',
      reason: 'Critical capacity threshold reached',
      impact: 'Prevents overbooking and scheduling conflicts',
    });
  }

  // Low utilization
  if (thisWeek.utilization < 0.5) {
    recommendations.push({
      priority: 'medium',
      action: 'Promote open slots for this week',
      reason: `Only ${thisWeek.averageUtilization}% of weekly capacity utilized`,
      impact: 'Potential revenue recovery of $X,XXX',
    });
  }

  // Best days for new bookings
  const bestDays = unusedCapacity
    .filter(d => d.utilization < 0.5 && !d.isWeekend)
    .sort((a, b) => a.utilization - b.utilization)
    .slice(0, 3);

  if (bestDays.length > 0) {
    recommendations.push({
      priority: 'medium',
      action: `Prioritize new bookings on ${bestDays.map(d => d.date).join(', ')}`,
      reason: 'These days have the most available capacity',
      impact: 'Better schedule balance and crew utilization',
    });
  }

  // Monthly capacity management
  if (thisMonth.utilization > 0.80) {
    recommendations.push({
      priority: 'high',
      action: 'Consider adding crew or extending operating hours',
      reason: `Monthly capacity at ${thisMonth.averageUtilization}%`,
      impact: 'Enables additional revenue without overbooking',
    });
  }

  return recommendations;
}

function _findAvailableSlots(crewSchedule, blockHours, preferredDate, preferredTime) {
  // Group schedule by date
  const scheduleByDate = {};
  (crewSchedule || []).forEach(job => {
    const date = job.date || job.scheduledDate;
    if (!date) return;
    if (!scheduleByDate[date]) scheduleByDate[date] = [];
    scheduleByDate[date].push(job);
  });

  // Look ahead 14 days
  const today = _normalizeDate(new Date());
  const slots = [];

  for (let day = 0; day <= 14; day++) {
    const date = _addDays(today, day);
    const dateStr = date.toISOString().split('T')[0];
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    // Skip weekends
    if (dayName === 'saturday' || dayName === 'sunday') continue;

    // If preferred date specified and it's not this date, skip
    if (preferredDate && dateStr !== preferredDate) continue;

    const dayJobs = scheduleByDate[dateStr] || [];
    const daySlots = _findAvailableSlotsForDate(dayJobs, dateStr, blockHours);

    // If preferred time specified, filter to that time
    if (preferredTime && daySlots.length > 0) {
      const preferredStart = _timeToMinutes(preferredTime);
      const matchingSlot = daySlots.find(s => {
        const slotStart = _timeToMinutes(s.startTime);
        return Math.abs(slotStart - preferredStart) <= 30; // within 30 min
      });
      if (matchingSlot) {
        slots.push(matchingSlot);
        break;
      }
    } else if (daySlots.length > 0) {
      // Take the earliest slot on this day
      slots.push(daySlots[0]);
      break;
    }
  }

  return slots;
}

function _findAvailableSlotsForDate(dayJobs, dateStr, blockHours) {
  const opsStart = DEFAULT_HOURS.start * 60; // Minutes from midnight
  const opsEnd = DEFAULT_HOURS.end * 60;
  const lunchStart = DEFAULT_HOURS.lunchStart * 60;
  const lunchEnd = DEFAULT_HOURS.lunchEnd * 60;
  const blockMinutes = blockHours * 60;

  // Build occupied intervals
  const occupied = [];
  (dayJobs || []).forEach(job => {
    const startTime = job.startTime || job.time || '08:00';
    const duration = (job.estimatedDurationHours || 2) * 60;
    const start = _timeToMinutes(startTime);

    // Add travel buffer (15 min before, 15 min after)
    occupied.push({ start: Math.max(opsStart, start - 15), end: Math.min(opsEnd, start + duration + 15) });
  });

  // Sort occupied intervals
  occupied.sort((a, b) => a.start - b.start);

  // Merge overlapping intervals
  const merged = [];
  for (const interval of occupied) {
    if (merged.length === 0) {
      merged.push({ ...interval });
    } else {
      const last = merged[merged.length - 1];
      if (interval.start <= last.end) {
        last.end = Math.max(last.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    }
  }

  // Split operating day into two segments: before lunch, after lunch
  const segments = [
    { start: opsStart, end: lunchStart, name: 'morning' },
    { start: lunchEnd, end: opsEnd, name: 'afternoon' },
  ];

  const slots = [];

  for (const segment of segments) {
    let cursor = segment.start;

    for (const interval of merged) {
      // Only consider intervals that overlap this segment
      if (interval.end <= segment.start || interval.start >= segment.end) continue;

      const effectiveStart = Math.max(cursor, interval.start);
      const gap = effectiveStart - cursor;

      if (gap >= blockMinutes) {
        slots.push({
          date: dateStr,
          startTime: _minutesToTime(cursor),
          endTime: _minutesToTime(cursor + blockMinutes),
          durationHours: blockHours,
          segment: segment.name,
        });
      }

      cursor = Math.max(cursor, interval.end);
    }

    // Check remaining after the last interval in this segment
    if (cursor < segment.end) {
      const gap = segment.end - cursor;
      if (gap >= blockMinutes) {
        slots.push({
          date: dateStr,
          startTime: _minutesToTime(cursor),
          endTime: _minutesToTime(cursor + blockMinutes),
          durationHours: blockHours,
          segment: segment.name,
        });
      }
    }
  }

  return slots;
}

// ── Internal: Date/Time Helpers ──

function _normalizeDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function _addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function _daysBetween(start, end) {
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

function _getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function _getWeekEnd(date) {
  const start = _getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

function _timeToMinutes(timeStr) {
  if (!timeStr) return 480; // default 8:00
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function _minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function _addTime(timeStr, hours) {
  const minutes = _timeToMinutes(timeStr) + hours * 60;
  return _minutesToTime(minutes);
}

module.exports = {
  getCapacityForecast,
  canFitInSchedule,
  getEarliestAppointment,
  getBestCrewForJob,
  checkProfitabilityImpact,
  checkSchedulingConflicts,
  getUnusedCapacity,
  getRemainingRevenueCapacity,
};