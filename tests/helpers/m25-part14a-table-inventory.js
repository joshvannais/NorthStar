'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)`;
const TABLE_DECLARATION = new RegExp(
  String.raw`CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER})?)\s*\(`,
  'gi'
);
const IDENTIFIER_PART = new RegExp(IDENTIFIER, 'g');

function normalizeIdentifier(raw) {
  if (raw.startsWith('"')) return raw.slice(1, -1).replace(/""/g, '"');
  return raw.toLowerCase();
}

function parseTableDeclarations(sql, source) {
  const declarations = [];
  for (const match of String(sql).matchAll(TABLE_DECLARATION)) {
    const parts = match[1].match(IDENTIFIER_PART) || [];
    const normalized = parts.map(normalizeIdentifier);
    const schema = normalized.length === 2 ? normalized[0] : 'public';
    if (schema !== 'public') continue;
    declarations.push({
      name: normalized.at(-1),
      source,
      line: String(sql).slice(0, match.index).split(/\r?\n/).length,
    });
  }
  return declarations;
}

function migrationTableDeclarations(migrationsDirectory) {
  const declarations = [];
  for (const filename of fs.readdirSync(migrationsDirectory).filter(value => value.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8');
    declarations.push(...parseTableDeclarations(sql, filename));
  }
  return declarations;
}

function duplicateEvidence(declarations) {
  const byName = new Map();
  for (const declaration of declarations) {
    const values = byName.get(declaration.name) || [];
    values.push({source: declaration.source, line: declaration.line});
    byName.set(declaration.name, values);
  }
  return [...byName.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([name, sources]) => ({name, sources}))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function assertUniqueMigrationTableDeclarations(declarations) {
  const duplicates = duplicateEvidence(declarations);
  if (duplicates.length) {
    throw new Error(`Duplicate migration table declarations: ${JSON.stringify(duplicates)}`);
  }
  return declarations;
}

function assertUniqueTableNames(names) {
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort();
  if (duplicates.length) throw new Error(`Duplicate migration inventory names: ${JSON.stringify(duplicates)}`);
  return names;
}

function migrationTableInventory(migrationsDirectory) {
  return assertUniqueMigrationTableDeclarations(migrationTableDeclarations(migrationsDirectory))
    .map(value => value.name)
    .sort();
}

function operationalTableArea(name) {
  if (name.startsWith('canonical_external_')) return 'externalSourceAuthority';
  if (name === 'canonical_business_profiles') return 'companyState';
  if (/^(?:canonical_customers|canonical_customer_identities|canonical_opportunities|canonical_estimates|canonical_estimate_|canonical_customer_estimate_|canonical_pricing_|canonical_commercial_|canonical_tax_|canonical_travel_(?:plans|fences)$)/.test(name)) return 'customerAndPlans';
  if (/^(?:canonical_appointments|canonical_schedule_|canonical_workforce_availability_)/.test(name)) return 'schedule';
  if (/^(?:canonical_operations|canonical_field_|canonical_labor_|canonical_material_|canonical_progress_|canonical_completion_|canonical_handoff_)/.test(name)) return 'jobAndExecution';
  if (/^(?:tenant_assets$|tenant_asset_|canonical_equipment_)/.test(name)) return 'assets';
  if (/^(?:canonical_facts|canonical_transcripts|canonical_communications|canonical_polaris_snapshots|canonical_native_[a-z0-9_]+)$/.test(name)) return 'sourceEvidence';
  if (/^(?:subscriptions|invoices)$/.test(name)) return 'financial';
  if (/^(?:integration_credentials|phone_numbers|webhooks|webhook_deliveries|retell_webhook_replay_claims|canonical_integration_ownership|canonical_voice_|canonical_call_provider_|polaris_provider_)/.test(name)) return 'provider';
  return null;
}

module.exports = {
  assertUniqueMigrationTableDeclarations,
  assertUniqueTableNames,
  duplicateEvidence,
  migrationTableDeclarations,
  migrationTableInventory,
  normalizeIdentifier,
  operationalTableArea,
  parseTableDeclarations,
};
