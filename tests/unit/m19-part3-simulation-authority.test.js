'use strict';

const pipeline = require('../../src/routes/simulation/pipeline');

describe('Mission 19 Part 3 simulation financial authority', () => {
  test('simulation facts are nonfinancial until canonical orchestration supplies the estimate', () => {
    const transcript = pipeline.withDeterministicSeed('simulation-authority', () => {
      const scenario = pipeline.generateScenario('fence', 'Canonical Customer');
      return pipeline.generateTranscript(scenario);
    });
    const pricingQuestion = transcript.findIndex(turn => turn.speaker === 'customer' && /ballpark price/i.test(turn.text));
    expect(pricingQuestion).toBeGreaterThan(-1);
    expect(transcript[pricingQuestion + 1]).toEqual({
      speaker: 'ai',
      text: 'I have the details needed to prepare an estimate. Our estimator will review them and provide the written estimate before any work begins.',
    });
    expect(transcript.filter(turn => turn.speaker === 'ai').map(turn => turn.text).join('\n')).not.toMatch(/\$|price range|typically looking in the range/i);
  });

  test('the simulation pipeline exposes no pricing calculator or pricing catalog', () => {
    expect(pipeline.calculatePricing).toBeUndefined();
    expect(pipeline.CATALOG).toBeUndefined();
  });
});
