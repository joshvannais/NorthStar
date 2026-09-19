'use strict';

const journey = require('../../src/learning/demoLearningJourney');

function base() { return { seed: 'a'.repeat(64), createdAt: '2026-09-18T12:00:00.000Z' }; }
function step(state, action) {
  const details = { path: 'unit-' + action };
  if (action === 'prepare') details.summaryIds = journey.center(state, 1).outcomeServices[0].summaries.slice(0, 5).map(value => value.summaryId);
  return journey.apply(state, { learningAction: { action, details } });
}

describe('Mission 25 Part 14B fictional learning journey contract', () => {
  test('requires explicit permissions and walks the complete advisory journey', () => {
    let state = base();
    expect(journey.project(state, 1).demoJourneyStage).toBe('first_use');
    expect(() => step(state, 'prepare')).toThrow('Allow both fictional record uses');
    state = step(state, 'grant_graph'); state = step(state, 'grant_proposal');
    expect(journey.project(state, 3).demoJourneyStage).toBe('ready');
    for (const action of ['prepare', 'preview', 'save', 'adoption_preview', 'adopt', 'rollback']) state = step(state, action);
    const result = journey.project(state, 9);
    expect(result.demoJourneyStage).toBe('rolled_back');
    expect(result.planning.current).toEqual([]);
    expect(result.planning.history).toHaveLength(1);
    expect(result.planning.history[0].lineage.planningValueInEffect).toBe(false);
  });

  test('fails closed on malformed, out-of-order and unsupported state', () => {
    expect(() => journey.validate({ version: journey.VERSION, graphAllowed: true, proposalAllowed: false, phase: 'adopted', sequence: 1 })).toThrow('unavailable');
    expect(() => journey.normalizeAction({ action: 'invent_paid_record', details: { path: 'invalid' } })).toThrow('supported fictional');
    let state = step(step(base(), 'grant_graph'), 'grant_proposal');
    expect(() => step(state, 'adopt')).toThrow('Review the current fictional planning value');
    const ids = journey.center(state, 1).outcomeServices[0].summaries.map(value => value.summaryId);
    expect(() => journey.apply(state, { learningAction: { action: 'prepare', details: { path: 'four-jobs', summaryIds: ids.slice(0, 4) } } })).toThrow('supported fictional');
    for (const count of [6, 7, 8]) expect(() => journey.apply(state, { learningAction: { action: 'prepare', details: { path: count + '-jobs', summaryIds: ids.slice(0, count) } } })).toThrow('supported fictional');
    expect(() => journey.apply(state, { learningAction: { action: 'prepare', details: { path: 'duplicate-job', summaryIds: [ids[0], ids[1], ids[2], ids[3], ids[3]] } } })).toThrow('supported fictional');
    expect(() => journey.apply(state, { learningAction: { action: 'prepare', details: { path: 'foreign-job', summaryIds: [...ids.slice(0, 4), '99999999-9999-4999-8999-999999999999'] } } })).toThrow('selection changed');
  });

  test('projects bounded recognizable labels and explicit unavailable dimensions', () => {
    let state = step(step(base(), 'grant_graph'), 'grant_proposal'); state = step(state, 'prepare'); state = step(state, 'preview'); state = step(state, 'save');
    const model = journey.project(state, 6), rendered = JSON.stringify({ center: journey.center(state, 6), model });
    expect(model.registry.current.preview.cohortSize).toBe(5);
    expect(model.registry.current.preview.areas[0].measures[0].metric).toMatchObject({ sampleSize: 5, cohortSize: 5, coveragePercent: '100.00' });
    expect(model.registry.current.preview.areas.filter(value => value.status === 'unavailable')).toHaveLength(3);
    expect(rendered).not.toMatch(/@|\+?\d{3}[-.) ]\d{3}[-. ]\d{4}|\[object Object\]/i);
    expect(rendered).toContain('Demo Customer 1');
  });
});
