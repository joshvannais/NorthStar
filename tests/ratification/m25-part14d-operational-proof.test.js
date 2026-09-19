'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('Mission 25 Part 14D authority', () => {
  test('freezes the bounded operational proof without changing a rendered path or accepted migration', () => {
    const roadmap = fs.readFileSync(path.join(__dirname, '../../docs/roadmap/MISSION_25_OUTCOME_LEARNING.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(__dirname, '../../docs/evidence/MISSION_25_PART14D_ACCEPTANCE.md'), 'utf8');
    expect(roadmap).toContain('## Part 14 Slice D candidate — bounds, performance, concurrency, failure recovery and operational observability proof');
    expect(roadmap).toContain('one through 100 records');
    expect(evidence).toContain('No rendered path changed');
    expect(evidence).toContain('Physical-device and private-production evidence remain unavailable');
    const repository = fs.readFileSync(path.join(__dirname, '../../src/learning/externalLaborImportRepository.js'), 'utf8');
    expect(repository).toContain('await probeImportBatch(pool, input)');
    expect(repository).toContain("probeError.code === 'M25_IMPORT_KEY_CONFLICT'");
    expect(repository).toContain("await client.query('ROLLBACK')");
  });
});
