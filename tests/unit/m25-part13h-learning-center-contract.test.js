'use strict';
const contract = require('../../public/js/learning-center-contract');
const base = { version:'m25-learning-center-v6', authority:'tenant_private_postgresql', evaluatedAt:'2026-09-18T12:00:00.000Z', sources:[], sourceTotal:0, sourcesTruncated:false, nativeLabor:{}, nativeEquipment:{}, nativeMaterial:{}, learningBoundary:'Learning remains advisory.', outcomeServiceKeys:['tree-service'], outcomeServiceTotal:1, outcomeServicesTruncated:false };

describe('Mission 25 Part 13H browser contract', () => {
  test('accepts only bounded unique service labels', () => {
    expect(contract.center(base)).toBe(base);
    expect(() => contract.center({ ...base, outcomeServiceKeys:['tree-service','tree-service'], outcomeServiceTotal:2 })).toThrow('Learning Center response is invalid.');
    expect(() => contract.center({ ...base, outcomeServiceKeys:['Tree Service'] })).toThrow('Learning Center response is invalid.');
    expect(() => contract.center({ ...base, outcomeServiceTotal:0 })).toThrow('Learning Center response is invalid.');
  });
});
