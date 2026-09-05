'use strict';

const {
  canonicalBytes,
  reconcile,
  sourceMigrations,
} = require('../../scripts/inspect-production-migration-history');

describe('bounded read-only production migration-history inspector', () => {
  test('uses the runner-compatible canonical checksum bytes', () => {
    expect(canonicalBytes(Buffer.from('one\r\ntwo\r\n')).toString('utf8')).toBe('one\ntwo\n');
    expect(() => canonicalBytes(Buffer.from('one\r\ntwo\n'))).toThrow('mixed line endings');
    expect(() => canonicalBytes(Buffer.from('one\rtwo'))).toThrow('lone carriage return');
  });

  test('loads the additive repository migration set through field evidence 047 while preserving released checksums', () => {
    const sources = sourceMigrations();
    expect(sources).toHaveLength(45);
    expect(sources.find(source => source.filename === '042_canonical_material_inventory_evidence.sql'))
      .toEqual({
        filename: '042_canonical_material_inventory_evidence.sql',
        bytes: 70623,
        checksum: '5efac96a5c275f58e56b117cdae135d4f16ce4847cccdbab8de580b5a3c1d6c4',
      });
    expect(sources.find(source => source.filename === '043_canonical_material_inventory_audit_corrections.sql'))
      .toEqual({
      filename: '043_canonical_material_inventory_audit_corrections.sql',
      bytes: 16936,
      checksum: '9f9d43d1d631953203a0d45accdfc757f3ce005a81cd4915c06bf2c3fd6ec228',
    });
    expect(sources.find(source => source.filename === '044_canonical_material_authority_snapshot_fence.sql'))
      .toEqual({
      filename: '044_canonical_material_authority_snapshot_fence.sql',
      bytes: 3995,
      checksum: '8d4c895fb06d5b0dc49ee968ad64d777efa9d1b861094f00571170e4d6e6b32d',
    });
    expect(sources.find(source => source.filename === '045_canonical_material_authority_upgrade_fence.sql')).toEqual({
      filename: '045_canonical_material_authority_upgrade_fence.sql',
      bytes: 2050,
      checksum: '24b8249c0b686b497e5251516f9a7663947ee6ac491fe9d132fb3b8bc020e9ee',
    });
    expect(sources.at(-1)).toEqual({
      filename: '047_canonical_field_evidence_authority.sql',
      bytes: 94203,
      checksum: 'f54418be9a5972e2a529e999399dc0bac44a61cbf4070af0a8246d61e2cd6bf8',
    });
  });

  test('reports only bounded names and checksums needed for compatibility', () => {
    const sources = [
      { filename: '001_one.sql', bytes: 3, checksum: 'a'.repeat(64) },
      { filename: '002_two.sql', bytes: 4, checksum: 'b'.repeat(64) },
      { filename: '003_three.sql', bytes: 5, checksum: 'c'.repeat(64) },
    ];
    expect(reconcile(sources, [
      { filename: '001_one.sql', checksum: 'a'.repeat(64) },
      { filename: '002_two.sql', checksum: 'd'.repeat(64) },
      { filename: '999_missing.sql', checksum: 'e'.repeat(64) },
    ])).toEqual({
      appliedWithoutSource: ['999_missing.sql'],
      duplicateApplied: [],
      mismatches: [{
        filename: '002_two.sql',
        recordedChecksum: 'd'.repeat(64),
        sourceChecksum: 'b'.repeat(64),
      }],
      pendingMigrations: [{ filename: '003_three.sql', bytes: 5, checksum: 'c'.repeat(64) }],
    });
  });

  test('surfaces duplicate ledger filenames without exposing any row content', () => {
    const result = reconcile(
      [{ filename: '001_one.sql', bytes: 3, checksum: 'a'.repeat(64) }],
      [
        { filename: '001_one.sql', checksum: 'a'.repeat(64) },
        { filename: '001_one.sql', checksum: 'a'.repeat(64) },
      ]
    );
    expect(result.duplicateApplied).toEqual(['001_one.sql']);
    expect(Object.keys(result)).toEqual([
      'appliedWithoutSource', 'duplicateApplied', 'mismatches', 'pendingMigrations',
    ]);
  });
});
