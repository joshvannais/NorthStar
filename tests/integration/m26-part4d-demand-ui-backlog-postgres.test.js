'use strict';

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { openPaidResearchBrowser } = require('../helpers/m26-part4d-paid-browser');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 4D mounted current-backlog UI journey', () => {
  let fixture;
  let ui;

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    await fixture.createExecution({ approvedScheduling: true, stopAfterScheduling: true,
      title: 'Part 4D bounded backlog proof' });
  }, 120000);

  afterAll(async () => {
    if (ui) await ui.close();
    if (fixture) await fixture.cleanup();
  }, 120000);

  test('captures and reads one real tenant-private backlog fact through the shared dashboard',
    async () => {
      ui = await openPaidResearchBrowser(fixture);
      await ui.page.locator('#commandCenterBacklogCapture').click();
      await ui.page.locator('#commandCenterBacklogState')
        .getByText(/Bounded current fact|Planned time unavailable|Bounded partial fact/).waitFor();
      const id = await ui.page.locator('#commandCenterBacklogReceipt').inputValue();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const capture = [...ui.responses].reverse().find(item => item.method === 'POST' &&
        item.url.endsWith('/api/v1/forecast/demand-to-schedule/backlog-facts'));
      expect(capture).toBeDefined();
      expect(capture.status).toBe(201);
      expect(capture.body.data).toMatchObject({ id, state: 'backlog_fact_saved',
        knownSubsetOnly: true, wholeBusinessCoverageVerified: false,
        researchOnly: true, forecastIssued: false });
      expect(JSON.stringify(capture.body.data)).not.toMatch(
        /predictedPoint|expectedCount|probability|outputDigest|private/i);

      await ui.page.locator('#commandCenterBacklogRead').click();
      await ui.page.locator('#commandCenterBacklogState')
        .getByText(/Bounded current fact|Planned time unavailable|Bounded partial fact/).waitFor();
      const read = [...ui.responses].reverse().find(item => item.method === 'GET' &&
        item.url.endsWith(`/api/v1/forecast/demand-to-schedule/backlog-facts/${id}`));
      expect(read).toBeDefined();
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({ id, state: 'backlog_fact_current',
        knownSubsetOnly: true, wholeBusinessCoverageVerified: false,
        researchOnly: true, forecastIssued: false });
      expect(JSON.stringify(read.body.data)).not.toMatch(
        /predictedPoint|expectedCount|probability|outputDigest|private/i);
    }, 120000);
});
