'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Mission 26 Part 3C complete-window measurement v2 authority', () => {
  const migration = read('migrations/215_canonical_forecast_complete_window_measurement_v2.sql');
  const correction = read('migrations/216_canonical_forecast_complete_window_measurement_drift_gate.sql');
  const tenantCorrection = read('migrations/217_canonical_forecast_complete_window_measurement_tenant_identity.sql');
  const routes = read('src/routes/forecastPriceHistory.js');
  const database = read('src/db.js');

  test('measures only an authenticated current Part 3B receipt', () => {
    expect(migration).toContain('canonical_forecast_complete_window_evaluation_v2_read');
    expect(migration).toContain('canonical_forecast_complete_window_evaluations_v2');
    expect(migration).toContain("'m26-complete-window-measurement-v2'");
    expect(migration).toContain("'evaluationDigest',saved.evidence_digest");
    expect(migration).toContain("'originInventoryDigest'");
    expect(migration).not.toMatch(/expected_origins\s+JSONB|threshold_value|caller_manifest/i);
  });

  test('keeps arithmetic descriptive and every unsupported verdict unavailable', () => {
    for (const value of ["'descriptive_only'", "'point_only_target'",
      "'point_only_no_nominal_interval'", "'empiricalDriftVerdictAvailable',FALSE",
      "'realAccuracyAvailable',FALSE", "'calibrationAvailable',FALSE",
      "'realForecastEligible',FALSE", "'unsavedOriginCoverageVerified',FALSE"]) {
      expect(migration).toContain(value);
    }
    expect(migration).toContain("'supported_source_descriptive_only'");
    expect(migration).toContain("'no_matching_forecast_context'");
    expect(migration).toContain("'definitionVersion'");
    expect(migration).toContain("'sourceApplicability'");
    expect(migration).toContain("'algorithmVersion'");
    expect(migration).toContain("'dataRecency'");
    expect(migration).toContain("'excludedConditions'");
    expect(migration).toContain("'observationLag'");
    expect(migration).toContain('canonical_forecast_price_flow_event_diversity');
  });

  test('mounts only the entry function and makes startup depend on it', () => {
    expect(routes).toContain("'/complete-price-flow-evaluations-v2/:evaluationId/measurement'");
    expect(routes).toContain('canonical_forecast_complete_window_measurement_v2');
    expect(database).toContain("to_regprocedure('public.canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)') IS NULL");
    expect(database).toContain("GRANT EXECUTE ON FUNCTION public.canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)");
    expect(database).toContain("REVIEWED_MIGRATION_TIMEOUT_FILES.add('215_canonical_forecast_complete_window_measurement_v2.sql')");
    expect(database).toContain("REVIEWED_MIGRATION_TIMEOUT_FILES.add('216_canonical_forecast_complete_window_measurement_drift_gate.sql')");
    expect(database).toContain("REVIEWED_MIGRATION_TIMEOUT_FILES.add('217_canonical_forecast_complete_window_measurement_tenant_identity.sql')");
  });

  test('withholds drift actions whenever the cohort is sample-ineligible', () => {
    expect(correction).toContain('CREATE OR REPLACE FUNCTION public.canonical_forecast_complete_window_measurement_v2');
    expect(correction).toContain('WHEN sample_reason IS NULL AND reference_count=30 AND later_count=30');
    expect(correction).toContain("WHEN sample_reason IS NOT NULL THEN jsonb_build_object(");
    expect(correction).toContain("'state','unavailable','reason',sample_reason");
    expect(correction).toContain("'reviewAction',CASE WHEN later_abs/later_count>reference_abs/reference_count");
  });

  test('digests the authenticated tenant identity into every measurement', () => {
    expect(tenantCorrection).toContain(
      'CREATE OR REPLACE FUNCTION public.canonical_forecast_complete_window_measurement_v2');
    expect(tenantCorrection).toContain("'organizationId',org");
    expect(tenantCorrection).toContain(
      "result:=unsigned||jsonb_build_object('digest',public.canonical_completion_digest(unsigned))");
  });
});
