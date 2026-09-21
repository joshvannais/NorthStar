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

module.exports = {
  assertUniqueMigrationTableDeclarations,
  assertUniqueTableNames,
  duplicateEvidence,
  migrationTableDeclarations,
  migrationTableInventory,
  normalizeIdentifier,
  parseTableDeclarations,
};
