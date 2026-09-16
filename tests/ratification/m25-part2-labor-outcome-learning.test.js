'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const migration = read('migrations/083_canonical_labor_outcome_learning.sql');

describe('Mission 25 Part 2 labor outcome learning contract', () => {
  test('keeps consent and observation history immutable and tenant-bound', () => {
    for (const fragment of [
      'CREATE TABLE public.canonical_learning_purpose_consents',
      'CREATE TABLE public.canonical_labor_outcome_observations',
      'canonical_learning_consents_immutable', 'canonical_labor_outcomes_immutable',
      'FOREIGN KEY(organization_id,estimate_id)', 'FOREIGN KEY(organization_id,consent_id)',
      'FOREIGN KEY(organization_id,actor_user_id,auth_session_id)',
      'UNIQUE(organization_id,estimate_id,source_digest,consent_id)',
    ]) expect(migration).toContain(fragment);
  });

  test('uses one explicit purpose, complete lineage, current authority and no demo execution source', () => {
    expect(migration).toContain("purpose='labor_duration_variance_v1'");
    expect(migration).toContain('canonical_field_execution_actor_authority');
    for (const source of ['estimateRevision', 'laborPlan', 'execution', 'completion', 'laborIntervals']) {
      expect(migration).toContain(`'${source}'`);
    }
    // Field execution authority only admits paid-source transcripts; learning consumes that completed execution.
    const executionAuthority = read('migrations/038_canonical_field_execution_authority.sql');
    expect(executionAuthority).toContain("transcript.source NOT IN ('simulation','demo')");
  });

  test('keeps the result deterministic and advisory without mutating source missions', () => {
    for (const fragment of [
      "'within_expected_range'", "'actual_above_plan'", "'actual_below_plan'",
      'calculation_version', "'m25-labor-duration-variance-v1'",
      'No rate, estimate, schedule or policy was changed.',
      'source_digest', 'consent_digest', 'canonical_digest',
      "confirmation_version TEXT NOT NULL CHECK(confirmation_version='m25-labor-duration-observation-v1')",
      "confirmed BOOLEAN NOT NULL CHECK(confirmed)",
    ]) expect(migration).toContain(fragment);
    expect(migration).not.toMatch(/UPDATE public\.(?:canonical_estimates|canonical_labor_plans|canonical_schedule_assignments|canonical_business_profiles)/);
  });

  test('withholds tables and helpers and exposes only four guarded runtime entries', () => {
    const database = read('src/db.js');
    for (const entry of [
      'canonical_learning_consent_read', 'canonical_learning_consent_mutate',
      'canonical_labor_outcome_observe', 'canonical_labor_outcome_read',
    ]) expect(database).toContain(`GRANT EXECUTE ON FUNCTION public.${entry}`);
    expect(database).toContain('uuid,bigint,text,text,boolean,text)');
    expect(database).toContain('learning_tables_withheld');
    expect(database).toContain('learning_helpers_withheld');
    expect(migration).toContain('REVOKE ALL ON TABLE public.canonical_learning_purpose_consents,public.canonical_labor_outcome_observations FROM PUBLIC');
  });

  test('documents correction, revocation, adoption and remaining completion boundaries', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const inventory = read('docs/architecture/MISSION_25_LEARNING_SOURCE_INVENTORY.md');
    for (const fragment of ['Source corrections make the current advisory stale', 'Consent revocation immediately blocks',
      'does not train a model', 'remain required before Mission 25 completion']) expect(roadmap).toContain(fragment);
    for (const fragment of ['complete set of current Mission 23 labor intervals', 'No result is automatically adopted']) {
      expect(inventory).toContain(fragment);
    }
  });
});
