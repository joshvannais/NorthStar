'use strict';

async function grantAndVerify(client, runtimeRole) {
  const table = await client.query("SELECT pg_catalog.to_regclass('public.canonical_external_labor_import_runs') IS NOT NULL present");
  if (!table.rows[0].present) return;
  if (!/^[A-Za-z_][A-Za-z0-9_$-]*$/.test(runtimeRole)) throw new Error('Runtime role identity is invalid');
  const identifier = '"' + runtimeRole.replace(/"/g, '""') + '"';
  await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_labor_import_consents,
    public.canonical_external_labor_import_runs, public.canonical_external_labor_import_records,
    public.canonical_external_labor_import_reference_matches,
    public.canonical_external_labor_import_learning_consents,
    public.canonical_external_labor_import_outcome_observations,
    public.canonical_external_labor_calibration_consents,
    public.canonical_external_labor_calibration_proposals FROM ${identifier}`);
  const helpers = [
    'public.canonical_external_labor_import_consent_projection(public.canonical_external_labor_import_consents)',
    'public.canonical_external_labor_import_run_projection(public.canonical_external_labor_import_runs)',
    'public.canonical_external_labor_import_record_projection(public.canonical_external_labor_import_records)',
    'public.canonical_external_labor_reference_source_basis(uuid,text,text,text)',
    'public.canonical_external_labor_reference_target_basis(uuid,text,uuid)',
    'public.canonical_external_labor_reference_match_projection(public.canonical_external_labor_import_reference_matches,jsonb,jsonb,jsonb)',
    'public.canonical_imported_labor_learning_consent_projection(public.canonical_external_labor_import_learning_consents)',
    'public.canonical_imported_labor_learning_basis(uuid,text,uuid,text)',
    'public.canonical_imported_labor_outcome_projection(public.canonical_external_labor_import_outcome_observations)',
    'public.canonical_imported_labor_calibration_consent_projection(public.canonical_external_labor_calibration_consents)',
    'public.canonical_imported_labor_calibration_basis(uuid,text,text)',
    'public.canonical_imported_labor_calibration_projection(public.canonical_external_labor_calibration_proposals)'
  ];
  const entries = [
    'public.canonical_external_labor_import_consent_read(uuid,uuid,text,uuid,text)',
    'public.canonical_external_labor_import_consent_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)',
    'public.canonical_external_labor_import_batch(uuid,uuid,text,uuid,text,text,text,jsonb)',
    'public.canonical_external_labor_import_read(uuid,uuid,text,uuid,text)',
    'public.canonical_external_labor_reference_matches_read(uuid,uuid,text,uuid,text)',
    'public.canonical_external_labor_reference_match_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)',
    'public.canonical_imported_labor_learning_consent_read(uuid,uuid,text,uuid,text)',
    'public.canonical_imported_labor_learning_consent_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)',
    'public.canonical_imported_labor_outcome_observe(uuid,uuid,text,uuid,text,text,text,uuid,text,bigint,text,text,boolean,text)',
    'public.canonical_imported_labor_outcome_read(uuid,uuid,text,uuid,text,uuid)',
    'public.canonical_imported_labor_calibration_consent_read(uuid,uuid,text,uuid,text)',
    'public.canonical_imported_labor_calibration_consent_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)',
    'public.canonical_imported_labor_calibration_propose(uuid,uuid,text,uuid,text,text,text,text,bigint,text,text,boolean,text)',
    'public.canonical_imported_labor_calibration_read(uuid,uuid,text,uuid,text,text)',
    'public.canonical_learning_center_read(uuid,uuid,text,uuid)'
  ];
  for (const signature of helpers) await client.query(`REVOKE ALL ON FUNCTION ${signature} FROM ${identifier}`);
  for (const signature of entries) await client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO ${identifier}`);
  const privileges = (await client.query(`SELECT
    NOT has_table_privilege($1,'public.canonical_external_labor_import_consents','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_consents','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_consents','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_consents','DELETE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_runs','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_runs','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_runs','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_runs','DELETE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_records','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_records','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_records','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_records','DELETE') tables_withheld,
    NOT has_table_privilege($1,'public.canonical_external_labor_import_reference_matches','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_reference_matches','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_reference_matches','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_reference_matches','DELETE') matches_withheld,
    NOT has_table_privilege($1,'public.canonical_external_labor_import_learning_consents','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_learning_consents','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_learning_consents','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_learning_consents','DELETE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_outcome_observations','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_outcome_observations','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_outcome_observations','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_import_outcome_observations','DELETE') imported_outcomes_withheld,
    NOT has_table_privilege($1,'public.canonical_external_labor_calibration_consents','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_calibration_consents','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_calibration_consents','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_calibration_consents','DELETE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_calibration_proposals','SELECT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_calibration_proposals','INSERT')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_calibration_proposals','UPDATE')
      AND NOT has_table_privilege($1,'public.canonical_external_labor_calibration_proposals','DELETE') calibration_withheld,
    NOT has_function_privilege($1,'public.canonical_external_labor_import_consent_projection(public.canonical_external_labor_import_consents)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_external_labor_import_run_projection(public.canonical_external_labor_import_runs)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_external_labor_import_record_projection(public.canonical_external_labor_import_records)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_external_labor_reference_source_basis(uuid,text,text,text)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_external_labor_reference_target_basis(uuid,text,uuid)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_external_labor_reference_match_projection(public.canonical_external_labor_import_reference_matches,jsonb,jsonb,jsonb)','EXECUTE') helpers_withheld,
    NOT has_function_privilege($1,'public.canonical_imported_labor_learning_consent_projection(public.canonical_external_labor_import_learning_consents)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_imported_labor_learning_basis(uuid,text,uuid,text)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_imported_labor_outcome_projection(public.canonical_external_labor_import_outcome_observations)','EXECUTE') imported_outcome_helpers_withheld,
    NOT has_function_privilege($1,'public.canonical_imported_labor_calibration_consent_projection(public.canonical_external_labor_calibration_consents)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_imported_labor_calibration_basis(uuid,text,text)','EXECUTE')
      AND NOT has_function_privilege($1,'public.canonical_imported_labor_calibration_projection(public.canonical_external_labor_calibration_proposals)','EXECUTE') calibration_helpers_withheld,
    has_function_privilege($1,'public.canonical_external_labor_import_consent_read(uuid,uuid,text,uuid,text)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_external_labor_import_consent_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_external_labor_import_batch(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_external_labor_import_read(uuid,uuid,text,uuid,text)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_external_labor_reference_matches_read(uuid,uuid,text,uuid,text)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_external_labor_reference_match_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') entries_allowed,
    has_function_privilege($1,'public.canonical_imported_labor_learning_consent_read(uuid,uuid,text,uuid,text)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_imported_labor_learning_consent_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_imported_labor_outcome_observe(uuid,uuid,text,uuid,text,text,text,uuid,text,bigint,text,text,boolean,text)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_imported_labor_outcome_read(uuid,uuid,text,uuid,text,uuid)','EXECUTE') imported_outcome_entries_allowed,
    has_function_privilege($1,'public.canonical_imported_labor_calibration_consent_read(uuid,uuid,text,uuid,text)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_imported_labor_calibration_consent_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_imported_labor_calibration_propose(uuid,uuid,text,uuid,text,text,text,text,bigint,text,text,boolean,text)','EXECUTE')
      AND has_function_privilege($1,'public.canonical_imported_labor_calibration_read(uuid,uuid,text,uuid,text,text)','EXECUTE') calibration_entries_allowed,
    has_function_privilege($1,'public.canonical_learning_center_read(uuid,uuid,text,uuid)','EXECUTE') learning_center_entry_allowed`,
    [runtimeRole])).rows[0];
  if (!privileges.tables_withheld || !privileges.matches_withheld || !privileges.imported_outcomes_withheld ||
      !privileges.helpers_withheld || !privileges.imported_outcome_helpers_withheld || !privileges.entries_allowed ||
      !privileges.imported_outcome_entries_allowed || !privileges.calibration_withheld ||
      !privileges.calibration_helpers_withheld || !privileges.calibration_entries_allowed ||
      !privileges.learning_center_entry_allowed) {
    throw new Error(`External labor import runtime privilege verification failed: ${JSON.stringify(privileges)}`);
  }
}

module.exports = { grantAndVerify };
