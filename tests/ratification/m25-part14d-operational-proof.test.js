'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tableInventory = require('../helpers/m25-part14a-table-inventory');

describe('Mission 25 Part 14D authority', () => {
  test('freezes the bounded operational proof without changing a rendered path or accepted migration', () => {
    const roadmap = fs.readFileSync(path.join(__dirname, '../../docs/roadmap/MISSION_25_OUTCOME_LEARNING.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(__dirname, '../../docs/evidence/MISSION_25_PART14D_ACCEPTANCE.md'), 'utf8');
    expect(roadmap).toContain('## Part 14 Slice D candidate — bounds, performance, concurrency, failure recovery and operational observability proof');
    expect(roadmap).toContain('one through 100 records');
    expect(evidence).toContain('No rendered path changed');
    expect(evidence).toContain('Physical-device and private-production evidence remain unavailable');
    expect(tableInventory.operationalTableArea('tenant_assets')).toBe('assets');
    expect(tableInventory.operationalTableArea('canonical_external_labor_import_runs')).toBe('externalSourceAuthority');
    expect(tableInventory.operationalTableArea('canonical_native_material_outcome_observations')).toBe('sourceEvidence');
  });
});
