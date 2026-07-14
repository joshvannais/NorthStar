/**
 * Polaris Data Model — Production Schema Definitions
 *
 * This module defines the canonical data structures for Polaris intelligence.
 * Every completed job, estimate, and learning metric conforms to these schemas.
 *
 * PostgreSQL-ready: each schema maps to a CREATE TABLE statement.
 * File-storage compatible: each schema maps to a JSON file entry.
 */

/**
 * Completed Job — the core unit of Polaris learning.
 * Every finished appointment becomes a CompletedJob record.
 * Fields are grouped by concern: identification, timing, crew, financial, analysis.
 */
const CompletedJobSchema = {
  table: 'polaris_completed_jobs',
  fields: {
    // ── Identification ──
    id:            { type: 'UUID', required: true, description: 'Unique job identifier' },
    leadId:        { type: 'UUID', description: 'Source lead ID' },
    customerId:    { type: 'UUID', description: 'Customer profile ID' },
    customerName:  { type: 'VARCHAR(255)', description: 'Customer name at time of job' },
    serviceType:   { type: 'VARCHAR(100)', required: true, description: 'e.g. HVAC Repair, Plumbing' },
    jobCategory:   { type: 'VARCHAR(100)', description: 'e.g. Residential, Commercial, Emergency' },
    leadSource:    { type: 'VARCHAR(50)', description: 'e.g. Phone Call, Website, Referral' },

    // ── Scheduling & Timing ──
    appointmentDate:      { type: 'DATE', required: true, description: 'Scheduled appointment date' },
    scheduledStartTime:   { type: 'TIME', description: 'Time appointment was scheduled to start' },
    scheduledEndTime:     { type: 'TIME', description: 'Time appointment was scheduled to end' },
    estimatedDuration:    { type: 'DECIMAL(5,2)', description: 'Estimated duration in hours' },
    actualStartTime:      { type: 'TIME', description: 'Actual time work began' },
    actualEndTime:        { type: 'TIME', description: 'Actual time work completed' },
    actualDuration:       { type: 'DECIMAL(5,2)', description: 'Actual duration in hours' },
    durationVariance:     { type: 'DECIMAL(5,2)', description: 'actualDuration - estimatedDuration' },

    // ── Crew & Resources ──
    crewId:       { type: 'VARCHAR(50)', description: 'Assigned crew identifier' },
    crewSize:     { type: 'INTEGER', description: 'Number of crew members' },
    technicianId: { type: 'VARCHAR(50)', description: 'Primary technician' },
    equipmentUsed: { type: 'JSONB', description: 'Array of equipment names/IDs used' },
    vehicleId:    { type: 'VARCHAR(50)', description: 'Assigned vehicle' },

    // ── Financial ──
    estimatedRevenue: { type: 'DECIMAL(10,2)', description: 'Estimated revenue before job' },
    actualRevenue:    { type: 'DECIMAL(10,2)', description: 'Actual revenue collected' },
    materialsCost:    { type: 'DECIMAL(10,2)', description: 'Cost of materials used' },
    laborCost:        { type: 'DECIMAL(10,2)', description: 'Cost of labor' },
    totalCost:        { type: 'DECIMAL(10,2)', description: 'Total cost (materials + labor + overhead)' },
    profitMargin:     { type: 'DECIMAL(5,2)', description: 'Profit margin percentage' },

    // ── Travel & Logistics ──
    travelDistance: { type: 'DECIMAL(8,2)', description: 'Miles traveled to job site' },
    travelTime:     { type: 'DECIMAL(5,2)', description: 'Travel time in hours' },
    travelCost:     { type: 'DECIMAL(8,2)', description: 'Estimated travel cost' },

    // ── Environment ──
    weather: { type: 'JSONB', description: 'Weather conditions at job time (temp, conditions, etc.)' },

    // ── Metadata ──
    notes:           { type: 'TEXT', description: 'Free-text job notes' },
    completionStatus: { type: 'VARCHAR(50)', default: 'completed', description: 'completed, partial, cancelled, rescheduled' },
    createdAt:       { type: 'TIMESTAMP', default: 'NOW()' },
    updatedAt:       { type: 'TIMESTAMP', default: 'NOW()' },
  },

  // PostgreSQL DDL for future migration
  createTable: `
    CREATE TABLE IF NOT EXISTS polaris_completed_jobs (
      id UUID PRIMARY KEY,
      lead_id UUID,
      customer_id UUID,
      customer_name VARCHAR(255),
      service_type VARCHAR(100) NOT NULL,
      job_category VARCHAR(100),
      lead_source VARCHAR(50),
      appointment_date DATE NOT NULL,
      scheduled_start_time TIME,
      scheduled_end_time TIME,
      estimated_duration DECIMAL(5,2),
      actual_start_time TIME,
      actual_end_time TIME,
      actual_duration DECIMAL(5,2),
      duration_variance DECIMAL(5,2),
      crew_id VARCHAR(50),
      crew_size INTEGER,
      technician_id VARCHAR(50),
      equipment_used JSONB,
      vehicle_id VARCHAR(50),
      estimated_revenue DECIMAL(10,2),
      actual_revenue DECIMAL(10,2),
      materials_cost DECIMAL(10,2),
      labor_cost DECIMAL(10,2),
      total_cost DECIMAL(10,2),
      profit_margin DECIMAL(5,2),
      travel_distance DECIMAL(8,2),
      travel_time DECIMAL(5,2),
      weather JSONB,
      notes TEXT,
      completion_status VARCHAR(50) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `,
  indexes: [
    'CREATE INDEX idx_polaris_jobs_service ON polaris_completed_jobs(service_type);',
    'CREATE INDEX idx_polaris_jobs_date ON polaris_completed_jobs(appointment_date);',
    'CREATE INDEX idx_polaris_jobs_crew ON polaris_completed_jobs(crew_id);',
    'CREATE INDEX idx_polaris_jobs_status ON polaris_completed_jobs(completion_status);',
  ]
};

/**
 * Polaris Estimate — historical estimate records.
 * Used to compare estimated vs actual outcomes.
 */
const EstimateSchema = {
  table: 'polaris_estimates',
  fields: {
    id:            { type: 'UUID', required: true },
    leadId:        { type: 'UUID', description: 'Source lead' },
    serviceType:   { type: 'VARCHAR(100)', required: true },
    difficulty:    { type: 'VARCHAR(20)' },
    region:        { type: 'VARCHAR(50)' },
    estimatedHours:  { type: 'DECIMAL(5,2)' },
    hourlyRate:      { type: 'DECIMAL(8,2)' },
    laborCost:       { type: 'DECIMAL(10,2)' },
    materialsCost:   { type: 'DECIMAL(10,2)' },
    equipmentCost:   { type: 'DECIMAL(10,2)' },
    totalEstimated:  { type: 'DECIMAL(10,2)' },
    confidence:      { type: 'INTEGER' },
    confidenceLabel: { type: 'VARCHAR(20)' },
    variables:       { type: 'JSONB', description: 'All variables used in estimation' },
    actualTotal:     { type: 'DECIMAL(10,2)', description: 'Actual total (set when job completes)' },
    variance:        { type: 'DECIMAL(10,2)', description: 'actualTotal - totalEstimated' },
    createdAt:       { type: 'TIMESTAMP', default: 'NOW()' },
  },
  createTable: `
    CREATE TABLE IF NOT EXISTS polaris_estimates (
      id UUID PRIMARY KEY,
      lead_id UUID,
      service_type VARCHAR(100) NOT NULL,
      difficulty VARCHAR(20),
      region VARCHAR(50),
      estimated_hours DECIMAL(5,2),
      hourly_rate DECIMAL(8,2),
      labor_cost DECIMAL(10,2),
      materials_cost DECIMAL(10,2),
      equipment_cost DECIMAL(10,2),
      total_estimated DECIMAL(10,2),
      confidence INTEGER,
      confidence_label VARCHAR(20),
      variables JSONB,
      actual_total DECIMAL(10,2),
      variance DECIMAL(10,2),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `,
};

/**
 * Learning Metrics — tracked over time to measure prediction accuracy.
 */
const LearningMetricsSchema = {
  table: 'polaris_learning_metrics',
  fields: {
    id:              { type: 'UUID', required: true },
    metricType:      { type: 'VARCHAR(50)', required: true, description: 'duration_accuracy, revenue_accuracy, confidence_score' },
    serviceType:     { type: 'VARCHAR(100)', description: 'Specific service or null for aggregate' },
    sampleSize:      { type: 'INTEGER', description: 'Number of data points' },
    meanVariance:    { type: 'DECIMAL(10,4)', description: 'Average prediction error' },
    meanAbsoluteError: { type: 'DECIMAL(10,4)', description: 'Average absolute error' },
    accuracyPct:     { type: 'DECIMAL(5,2)', description: 'Accuracy percentage' },
    computedAt:      { type: 'TIMESTAMP', default: 'NOW()' },
  },
  createTable: `
    CREATE TABLE IF NOT EXISTS polaris_learning_metrics (
      id UUID PRIMARY KEY,
      metric_type VARCHAR(50) NOT NULL,
      service_type VARCHAR(100),
      sample_size INTEGER,
      mean_variance DECIMAL(10,4),
      mean_absolute_error DECIMAL(10,4),
      accuracy_pct DECIMAL(5,2),
      computed_at TIMESTAMP DEFAULT NOW()
    );
  `,
};

/**
 * Crew Schema — for future multi-crew support.
 */
const CrewSchema = {
  table: 'polaris_crews',
  fields: {
    id:           { type: 'UUID', required: true },
    name:         { type: 'VARCHAR(100)', required: true },
    size:         { type: 'INTEGER', default: 1 },
    skills:       { type: 'JSONB', description: 'Array of service types this crew can handle' },
    equipment:    { type: 'JSONB', description: 'Array of equipment assigned to this crew' },
    vehicleId:    { type: 'VARCHAR(50)' },
    status:       { type: 'VARCHAR(20)', default: 'active' },
    efficiency:   { type: 'DECIMAL(5,2)', description: 'Average duration variance (negative = faster than estimated)' },
    createdAt:    { type: 'TIMESTAMP', default: 'NOW()' },
  },
  createTable: `
    CREATE TABLE IF NOT EXISTS polaris_crews (
      id UUID PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      size INTEGER DEFAULT 1,
      skills JSONB,
      equipment JSONB,
      vehicle_id VARCHAR(50),
      status VARCHAR(20) DEFAULT 'active',
      efficiency DECIMAL(5,2),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `,
};

/**
 * Calendar Intelligence — scheduling analysis snapshots.
 * Prepared for future optimization but not yet populated.
 */
const CalendarIntelligenceSchema = {
  table: 'polaris_calendar_intelligence',
  fields: {
    id:               { type: 'UUID', required: true },
    date:             { type: 'DATE', required: true },
    totalAppointments:  { type: 'INTEGER' },
    totalDuration:      { type: 'DECIMAL(8,2)', description: 'Sum of all appointment durations in hours' },
    capacityUsed:       { type: 'DECIMAL(5,2)', description: 'Percentage of available hours used' },
    travelTimeTotal:    { type: 'DECIMAL(8,2)', description: 'Total travel time for all appointments' },
    gaps:               { type: 'JSONB', description: 'Identified scheduling gaps' },
    conflicts:          { type: 'JSONB', description: 'Overlapping appointments detected' },
    recommendations:    { type: 'JSONB', description: 'Suggested schedule optimizations' },
    createdAt:          { type: 'TIMESTAMP', default: 'NOW()' },
  },
};

/**
 * Recommendation Schema — each recommendation Polaris generates.
 */
const RecommendationSchema = {
  table: 'polaris_recommendations',
  fields: {
    id:            { type: 'UUID', required: true },
    type:          { type: 'VARCHAR(50)', required: true, description: 'follow_up, move_appointment, revenue_opportunity, capacity_warning, pipeline_bottleneck, lost_opportunity' },
    priority:      { type: 'VARCHAR(20)', description: 'high, medium, low' },
    title:         { type: 'VARCHAR(255)' },
    description:   { type: 'TEXT' },
    actionUrl:     { type: 'VARCHAR(500)', description: 'Link to take action' },
    sourceData:    { type: 'JSONB', description: 'Data that generated this recommendation' },
    resolved:      { type: 'BOOLEAN', default: false },
    createdAt:     { type: 'TIMESTAMP', default: 'NOW()' },
  },
};

module.exports = {
  CompletedJobSchema,
  EstimateSchema,
  LearningMetricsSchema,
  CrewSchema,
  CalendarIntelligenceSchema,
  RecommendationSchema,
};