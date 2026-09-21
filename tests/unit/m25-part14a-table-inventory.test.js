'use strict';

const path = require('node:path');
const inventory = require('../helpers/m25-part14a-table-inventory');

describe('Mission 25 Part 14A migration table inventory', () => {
  test('retains exact source evidence for 273 unique current declarations', () => {
    const declarations = inventory.migrationTableDeclarations(path.join(__dirname, '../../migrations'));
    expect(declarations).toHaveLength(273);
    expect(inventory.assertUniqueMigrationTableDeclarations(declarations)).toBe(declarations);
    expect(inventory.migrationTableInventory(path.join(__dirname, '../../migrations'))).toHaveLength(273);
    expect(declarations.find(value => value.name === 'tenant_assets')).toEqual({
      name: 'tenant_assets', source: '016_tenant_asset_catalogue.sql', line: 6,
    });
  });

  test('rejects duplicate tenant_assets across equivalent unquoted and quoted names', () => {
    const declarations = inventory.parseTableDeclarations([
      'CREATE TABLE tenant_assets (id integer);',
      'CREATE TABLE PUBLIC.TENANT_ASSETS (id integer);',
      'CREATE TABLE "public"."tenant_assets" (id integer);',
    ].join('\n'), 'duplicate-assets.sql');
    expect(declarations.map(value => value.name)).toEqual(['tenant_assets', 'tenant_assets', 'tenant_assets']);
    expect(() => inventory.assertUniqueMigrationTableDeclarations(declarations)).toThrow(/tenant_assets.*duplicate-assets\.sql.*"line":1.*"line":2.*"line":3/);
  });

  test('reports every duplicated name and preserves case for quoted identifiers', () => {
    const declarations = inventory.parseTableDeclarations([
      'CREATE TABLE tenant_assets (id integer);',
      'CREATE TABLE "tenant_assets" (id integer);',
      'CREATE TABLE WEBHOOKS (id integer);',
      'CREATE TABLE public.webhooks (id integer);',
      'CREATE TABLE "public"."Tenant_Assets" (id integer);',
    ].join('\n'), 'multiple-duplicates.sql');
    expect(declarations.at(-1).name).toBe('Tenant_Assets');
    expect(inventory.duplicateEvidence(declarations).map(value => value.name)).toEqual(['tenant_assets', 'webhooks']);
    expect(() => inventory.assertUniqueMigrationTableDeclarations(declarations)).toThrow(/tenant_assets.*webhooks/);
    expect(() => inventory.assertUniqueTableNames(['tenant_assets', 'webhooks', 'tenant_assets', 'webhooks'])).toThrow(/tenant_assets.*webhooks/);
  });
});
