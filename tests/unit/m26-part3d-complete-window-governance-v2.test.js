const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('Mission 26 Part 3D target-complete governance v2 contract', () => {
  const migration = read('migrations/218_canonical_forecast_complete_window_governance_v2.sql');
  const routes = read('src/routes/forecastPriceHistory.js');
  const database = read('src/db.js');

  test('binds the accepted complete evaluation and tenant measurement', () => {
    expect(migration).toContain('canonical_forecast_complete_window_evaluation_v2_read');
    expect(migration).toContain('canonical_forecast_complete_window_measurement_v2');
    expect(migration).toContain("measurement->'measurement'->>'organizationId' IS DISTINCT FROM org::text");
    expect(migration).toContain("'evaluationDigest',saved.evidence_digest");
    expect(migration).toContain("'measurementDigest',measurement->'measurement'->>'digest'");
    expect(migration).toContain("'originInventoryDigest',saved.evidence->>'originInventoryDigest'");
  });

  test('server selects the same-origin population without caller manifests', () => {
    expect(migration).toContain('canonical_forecast_price_flow_matched_population(\n  org,actor,role_value,session_value,TRUE)');
    expect(migration).toContain('expected_base_ids IS DISTINCT FROM observed_base_ids');
    expect(migration).toContain("(population->>'candidateMissingCount')::integer<>0");
    expect(migration).toContain("(population->>'candidateDuplicateCount')::integer<>0");
    expect(migration).toContain("(population->>'orphanCandidateCount')::integer<>0");
    expect(migration).toContain("'m26:price-flow-actual:'||org::text||':'||run_value::text");
    expect(migration.match(/canonical_forecast_price_flow_matched_population\(/g))
      .toHaveLength(2);
    expect(migration).toContain('candidate_paired_count IS DISTINCT FROM candidate_pair_count');
    expect(migration).toContain('candidate_partial_count<>0 OR candidate_missing_actual_count<>0');
    expect(migration).toContain('candidate_revoked_count<>0 OR candidate_unavailable_count<>0');
    expect(routes).not.toContain('body.origins');
    expect(routes).not.toContain('body.measurement');
  });

  test('pins deterministic dependency identity and leaves statistical methods unavailable', () => {
    expect(migration).toContain('canonical_forecast_price_flow_method_closure_digest()');
    expect(migration).toContain("'methodDependencyClosureDigest',registration.dependency_closure_digest");
    expect(migration).toContain("statistical_method->>'state'<>'method_unavailable'");
    expect(migration).toContain("'statisticalMethodState',statistical_method->>'state'");
  });

  test('persists append-only human promotion and rollback decisions', () => {
    expect(migration).toContain('canonical_forecast_complete_window_governance_selections_v2');
    expect(migration).toContain('canonical_forecast_complete_window_governance_methods_v2');
    expect(migration).toContain('m26_complete_window_deterministic_closure_v2');
    expect(migration).toContain("action TEXT NOT NULL CHECK(action IN ('promote','rollback'))");
    expect(migration).toContain("IF COALESCE(latest.revision,0)<>expected_revision THEN");
    expect(migration).toContain("latest.action<>'promote' OR reverses_value<>latest.id");
    expect(migration).toContain('governance review already selected');
    expect(migration).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE');
  });

  test('keeps every selection outside production and numeric serving', () => {
    expect(migration).toContain("'internalExperimentOnly',TRUE");
    expect(migration).toContain("'productionPromotionEligible',FALSE");
    expect(migration).toContain("'realForecastEligible',FALSE");
    expect(migration).toContain("'paidNumericServing',FALSE");
    expect(migration).toContain("'forecastServingEnabled',FALSE");
  });

  test('mounts paid guarded review and selection entries only', () => {
    expect(routes).toContain("router.post('/complete-price-flow-governance-reviews-v2'");
    expect(routes).toContain("router.get('/complete-price-flow-governance-reviews-v2/:reviewId'");
    expect(routes).toContain("router.post('/complete-price-flow-governance-selections-v2'");
    expect(routes).toContain("router.get('/complete-price-flow-governance-selections-v2'");
    expect(routes).toContain("requirePermission('forecast', 'update')");
    expect(routes).toContain("req.get('X-CSRF-Token')");
    expect(routes).toContain("req.get('Idempotency-Key')");
  });

  test('keeps tables and evidence helper private to the runtime role', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE\n public.canonical_forecast_complete_window_governance_methods_v2');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_governance_evidence_v2');
    expect(database).toContain("REVOKE ALL PRIVILEGES ON TABLE public.canonical_forecast_complete_window_governance_reviews_v2");
    expect(database).toContain("REVOKE ALL ON FUNCTION public.canonical_forecast_complete_window_governance_evidence_v2");
  });

  test('requires migration 218 under the reviewed startup lane', () => {
    expect(database).toContain("REVIEWED_MIGRATION_TIMEOUT_FILES.add('218_canonical_forecast_complete_window_governance_v2.sql')");
    expect(database).toContain('Required complete-window governance v2 authority is missing');
    expect(database).toContain('Required complete-window governance v2 immutability is missing');
  });
});
