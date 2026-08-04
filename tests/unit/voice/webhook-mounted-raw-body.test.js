'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const mockIngestRetellPayload = jest.fn(async payload => ({
  status: 200,
  body: { received: true, event: payload.event, eventId: payload.event_id },
}));

jest.mock('../../../src/services/canonicalRetellIngestion', () => ({
  ingestRetellPayload: mockIngestRetellPayload,
}));

describe('mounted production voice webhook raw-byte authority', () => {
  const secret = 'synthetic-mounted-voice-secret';
  let priorSecret;
  let app;

  beforeAll(() => {
    priorSecret = process.env.RETELL_WEBHOOK_SECRET;
    process.env.RETELL_WEBHOOK_SECRET = secret;
    const voiceRoutes = require('../../../src/routes/voice');
    app = express();
    if (voiceRoutes.webhookRouter) app.use('/api/v1/voice', voiceRoutes.webhookRouter);
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/v1/voice', voiceRoutes);
  });

  afterAll(() => {
    if (priorSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
    else process.env.RETELL_WEBHOOK_SECRET = priorSecret;
  });

  test('accepts harmless JSON whitespace only when the signature covers the exact mounted bytes', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = Buffer.from(
      '{\n  "event": "ping",\n  "event_id": "voice_whitespace_exact",\n  "timestamp": ' + timestamp + '\n}\n',
      'utf8'
    );
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const accepted = await request(app)
      .post('/api/v1/voice/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Retell-Signature', signature)
      .set('X-Retell-Timestamp', timestamp)
      .send(rawBody.toString('utf8'));
    expect(accepted.status).toBe(200);
    expect(mockIngestRetellPayload).toHaveBeenCalledTimes(1);
    expect(mockIngestRetellPayload).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ping', event_id: 'voice_whitespace_exact' }),
      { ingestionSource: 'voice' }
    );

    const tampered = Buffer.concat([rawBody.subarray(0, rawBody.length - 1), Buffer.from(' \n')]);
    const rejected = await request(app)
      .post('/api/v1/voice/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Retell-Signature', signature)
      .set('X-Retell-Timestamp', timestamp)
      .send(tampered.toString('utf8'));
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe('INVALID_SIGNATURE');
    expect(mockIngestRetellPayload).toHaveBeenCalledTimes(1);
  });
});
