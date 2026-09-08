'use strict';
const crypto = require('node:crypto');
const client = require('../../public/js/field-execution-client');
const executionId = 'e1600000-0000-4000-8000-000000000001';
const id = n => `c2600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (n, prior, kind = 'observation') => ({ id: id(n), rootId: prior ? prior.rootId : id(n), previousRecordId: prior ? prior.id : null, revision: prior ? prior.revision + 1 : 1, digest: n.toString(16).padStart(64, '0'), executionId, type: kind, document: { kind, observationClass: 'inspection', resultType: 'pass' } });
const page = (data, total = data.length, nextCursor = null) => ({ success: true, data, total, returned: data.length, truncated: nextCursor !== null, nextCursor });
const collect = (first, next = jest.fn()) => client.collectEvidence(first, next, executionId);

describe('Part 9A completion selection is complete, current and bounded', () => {
  test('genuine complete empty evidence remains an explicit valid empty selection', async () => {
    const snapshot = await collect(page([]));
    expect(snapshot.complete).toBe(true);
    expect(client.completionRequirements(snapshot)).toEqual({ checklists: [], inspections: [], files: [] });
  });
  test('retains pagination authority and every current pin across pages', async () => {
    const next = jest.fn().mockResolvedValue(page([record(2)], 2));
    const snapshot = await collect(page([record(1)], 2, 'next-page'), next);
    expect(next).toHaveBeenCalledWith('next-page');
    expect(snapshot.pages).toHaveLength(2);
    expect(snapshot.pages[0]).toMatchObject({ truncated: true, nextCursor: 'next-page', returned: 1, total: 2 });
    expect(snapshot).toMatchObject({ complete: true, truncated: false, nextCursor: null, total: 2, returned: 2 });
    expect(client.completionRequirements(snapshot).inspections.map(p => p.id)).toEqual([id(1), id(2)]);
  });
  test('page failure preserves the partial records and unresolved cursor but cannot select', async () => {
    const snapshot = await collect(page([record(1)], 2, 'next-page'), jest.fn().mockRejectedValue(new Error('Ordinary temporary unavailability')));
    expect(snapshot).toMatchObject({ complete: false, truncated: true, nextCursor: 'next-page', returned: 1, total: 2 });
    expect(() => client.completionRequirements(snapshot)).toThrow('WORK_EVIDENCE_INCOMPLETE');
  });
  test.each([401, 403])('pagination authorization status %s propagates to the existing scope purge', async status => {
    await expect(collect(page([record(1)], 2, 'next-page'), jest.fn().mockRejectedValue(Object.assign(new Error('Access changed'), { status })))).rejects.toMatchObject({ status });
  });
  test.each([
    ['missing envelope', { success: true, data: [] }],
    ['wrong total', { ...page([record(1)]), total: 2 }],
    ['wrong count', { ...page([record(1)]), returned: 0 }],
    ['cursor without truncation', { ...page([]), nextCursor: 'next-page' }],
    ['other selected execution', page([{ ...record(1), executionId: id(99) }])],
    ['duplicate record', page([record(1), record(1)])]
  ])('%s is not a complete selection', async (_name, input) => {
    const snapshot = await collect(input);
    expect(snapshot.complete).toBe(false);
    expect(() => client.completionRequirements(snapshot)).toThrow();
  });
  test('a repeating cursor stops a bounded read without silently dropping history', async () => {
    const next = jest.fn().mockResolvedValue(page([record(2)], 3, 'same-cursor'));
    const snapshot = await collect(page([record(1)], 3, 'same-cursor'), next);
    expect(snapshot.complete).toBe(false); expect(next).toHaveBeenCalledTimes(1);
  });
  test.each(['checklist', 'observation', 'file'])('more than 20 current %s records is unavailable, never sliced', async kind => {
    const snapshot = await collect(page(Array.from({ length: 21 }, (_, i) => record(i + 1, null, kind))));
    expect(snapshot.complete).toBe(true);
    expect(() => client.completionRequirements(snapshot)).toThrow('WORK_EVIDENCE_SELECTION_LIMIT');
  });
  test('inspection history chooses the current successor before applying the per-kind bound', async () => {
    const history = [record(1)]; for(let i = 2; i <= 25; i++) history.push(record(i, history.at(-1)));
    const snapshot = await collect(page(history.reverse()));
    expect(client.completionRequirements(snapshot).inspections).toEqual([{ id: id(25), revision: 25, digest: (25).toString(16).padStart(64, '0') }]);
  });
  test('an incomplete predecessor chain cannot be described as current', async () => {
    const snapshot = await collect(page([record(2, record(1))]));
    expect(() => client.completionRequirements(snapshot)).toThrow('WORK_EVIDENCE_CURRENTNESS_UNAVAILABLE');
  });
});

function storage(copy = []) { const entries = new Map(copy); return { get length() { return entries.size; }, key: n => Array.from(entries.keys())[n], getItem: k => entries.get(k) || null, setItem: (k, v) => entries.set(k, String(v)), removeItem: k => entries.delete(k), copy: () => [...entries] }; }
function locks() { const owned = new Set(); return { request: async (name, _options, callback) => { if (owned.has(name)) return callback(null); owned.add(name); try { return await callback({ name }); } finally { owned.delete(name); } } }; }
const windowFor = (sessionStorage, lockManager, navigation = 'navigate') => ({ sessionStorage, crypto, navigator: { locks: lockManager }, performance: { getEntriesByType: () => [{ type: navigation }] } });
describe('Part 9A tab ownership isolates persistent drafts and retry keys', () => {
  test('copied storage cannot acquire the original live owner even when navigation claims reload', async () => {
    const manager = locks(), original = storage();
    const first = await client.claimTabStorage(windowFor(original, manager));
    original.setItem('northstar-work-draft:' + first.owner + ':note', 'Ordinary draft');
    original.setItem('northstar-work-draft:' + first.owner + ':note:idempotency', 'retry-identity');
    const duplicate = storage(original.copy());
    const second = await client.claimTabStorage(windowFor(duplicate, manager, 'reload'));
    expect(second.owner).not.toBe(first.owner);
    expect(duplicate.copy().some(([k]) => k.startsWith('northstar-work-draft:'))).toBe(false);
    expect(original.copy().filter(([k]) => k.startsWith('northstar-work-draft:'))).toHaveLength(2);
    first.release(); second.release();
  });
  test('same-tab reload reclaims the released owner and preserves both namespaces', async () => {
    const manager = locks(), saved = storage(); const first = await client.claimTabStorage(windowFor(saved, manager));
    saved.setItem('northstar-work-draft:' + first.owner + ':note', 'Ordinary draft');
    first.release(); await Promise.resolve();
    const reloaded = await client.claimTabStorage(windowFor(saved, manager, 'reload'));
    expect(reloaded.owner).toBe(first.owner); expect(saved.getItem('northstar-work-draft:' + first.owner + ':note')).toBe('Ordinary draft'); reloaded.release();
  });
  test('fresh navigation cannot inherit stored ownership after the original tab closes', async () => {
    const manager = locks(), saved = storage(); const first = await client.claimTabStorage(windowFor(saved, manager)); first.release(); await Promise.resolve();
    const next = await client.claimTabStorage(windowFor(storage(saved.copy()), manager)); expect(next.owner).not.toBe(first.owner); next.release();
  });
  test('unavailable lock support does not restore copied persistent state', async () => {
    const saved = storage([['northstar-work-draft:copied:note', 'Ordinary draft']]);
    const claimed = await client.claimTabStorage(windowFor(saved, undefined));
    expect(claimed.persistent).toBe(false); expect(saved.copy().some(([k]) => k.startsWith('northstar-work-draft:'))).toBe(false); claimed.release();
  });
});
