'use strict';

const ENTRIES = new Set([
  'canonical_customer_financial_billing_identity_v1_candidate',
  'canonical_customer_financial_billing_identity_v1_read',
  'canonical_customer_financial_billing_identity_v1_establish',
  'canonical_customer_financial_billing_review_v1_candidate',
  'canonical_customer_financial_billing_review_v1_read',
  'canonical_customer_financial_billing_review_v1_history',
  'canonical_customer_financial_billing_review_v1_accept',
  'canonical_customer_financial_billing_journey_v1_authority',
  'canonical_customer_financial_numbering_v1_candidate',
  'canonical_customer_financial_numbering_v1_read',
  'canonical_customer_financial_numbering_v1_review',
  'canonical_customer_financial_editable_basis_v1_read',
  'canonical_customer_financial_billable_review_v1_read',
  'canonical_customer_financial_billable_review_v1_accept',
  'canonical_customer_financial_estimate_journey_v1_read',
  'canonical_customer_financial_estimate_journey_v1_save_draft',
  'canonical_customer_financial_invoice_draft_v1_read',
  'canonical_customer_financial_invoice_draft_v1_capture',
  'canonical_customer_financial_invoice_draft_revision_v1_read',
  'canonical_customer_financial_invoice_draft_revision_v1_save',
  'canonical_customer_financial_invoice_draft_components_v1_read',
]);
const TABLES = new Set([
  'canonical_customer_financial_billing_capability_grants_v1',
  'canonical_customer_financial_billing_capability_heads_v1',
  'canonical_customer_financial_billing_parties_v1',
  'canonical_customer_financial_billing_identity_snapshots_v1',
  'canonical_customer_financial_billing_identity_requests_v1',
  'canonical_customer_financial_billing_identity_reviews_v1',
  'canonical_customer_financial_billing_review_requests_v1',
  'canonical_customer_financial_numbering_capability_grants_v1',
  'canonical_customer_financial_numbering_capability_heads_v1',
  'canonical_customer_financial_numbering_policies_v1',
  'canonical_customer_financial_numbering_policy_requests_v1',
  'canonical_customer_financial_numbering_sequences_v1',
  'canonical_customer_financial_numbering_reservations_v1',
  'canonical_customer_financial_numbering_events_v1',
  'canonical_customer_financial_estimate_capability_grants_v1',
  'canonical_customer_financial_estimate_capability_heads_v1',
  'canonical_customer_financial_billable_review_grants_v1',
  'canonical_customer_financial_billable_review_grant_heads_v1',
  'canonical_customer_financial_billable_work_reviews_v1',
  'canonical_customer_financial_billable_review_requests_v1',
  'canonical_customer_financial_billable_handoff_receipts_v1',
  'canonical_customer_financial_estimate_journey_grants_v1',
  'canonical_customer_financial_estimate_journey_grant_heads_v1',
  'canonical_customer_financial_estimate_journey_drafts_v1',
  'canonical_customer_financial_estimate_journey_requests_v1',
  'canonical_customer_financial_estimate_journey_revisions_v1',
  'canonical_customer_financial_invoice_draft_grants_v1',
  'canonical_customer_financial_invoice_draft_grant_heads_v1',
  'canonical_customer_financial_invoice_draft_origins_v1',
  'canonical_customer_financial_invoice_draft_origin_requests_v1',
  'canonical_customer_financial_invoice_draft_revisions_v1',
  'canonical_customer_financial_invoice_draft_revision_requests_v1',
]);
const quote = value => '"' + value.replace(/"/g, '""') + '"';

async function grantAndVerify(client, runtimeRole) {
  const role = quote(runtimeRole);
  const tables = (await client.query(
    `SELECT oid,relname FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relkind='r'
        AND relname=ANY($1::text[])`, [Array.from(TABLES)]
  )).rows;
  for (const table of tables) {
    const identity = 'public.' + quote(table.relname);
    await client.query('REVOKE ALL ON TABLE ' + identity + ' FROM PUBLIC, ' + role);
    const allowed = (await client.query(
      "SELECT has_table_privilege($1,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",
      [runtimeRole, table.oid])).rows[0].allowed;
    if (allowed) throw new Error('Customer financial billing identity table authority not withheld');
  }
  const functions = (await client.query(
    `SELECT oid,proname,oid::regprocedure::text identity FROM pg_proc
      WHERE pronamespace='public'::regnamespace
        AND (proname LIKE 'canonical_customer_financial_billing_identity_v1_%'
          OR proname LIKE 'canonical_customer_financial_billing_review_v1_%'
          OR proname LIKE 'canonical_customer_financial_billing_journey_v1_%'
          OR proname LIKE 'canonical_customer_financial_numbering_v1_%'
          OR proname LIKE 'canonical_customer_financial_editable_basis_v1_%'
          OR proname LIKE 'canonical_customer_financial_billable_review_v1_%'
          OR proname LIKE 'canonical_customer_financial_estimate_journey_v1_%'
          OR proname LIKE 'canonical_customer_financial_invoice_draft_v1_%'
          OR proname LIKE 'canonical_customer_financial_invoice_draft_revision_v1_%'
          OR proname LIKE 'canonical_customer_financial_invoice_draft_components_v1_%')`
  )).rows;
  for (const entry of functions) {
    await client.query('REVOKE ALL ON FUNCTION ' + entry.identity + ' FROM PUBLIC, ' + role);
    if (ENTRIES.has(entry.proname)) {
      await client.query('GRANT EXECUTE ON FUNCTION ' + entry.identity + ' TO ' + role);
    }
    const allowed = (await client.query(
      "SELECT has_function_privilege($1,$2::oid,'EXECUTE') allowed",
      [runtimeRole, entry.oid])).rows[0].allowed;
    if (allowed !== ENTRIES.has(entry.proname)) {
      throw new Error('Customer financial function authority invalid');
    }
  }
  if (tables.length !== TABLES.size || tables.some(table => !TABLES.has(table.relname)) ||
      functions.filter(entry => ENTRIES.has(entry.proname)).length !== ENTRIES.size) {
    throw new Error('Customer financial authority incomplete');
  }
}

module.exports = { grantAndVerify, ENTRIES, TABLES };
