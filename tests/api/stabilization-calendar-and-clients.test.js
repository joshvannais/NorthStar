'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const vm = require('vm');

const previousDataDir = process.env.NORTHSTAR_DATA_DIR;
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-calendar-test-'));
process.env.NORTHSTAR_DATA_DIR = tempDataDir;
fs.writeFileSync(path.join(tempDataDir, 'events.json'), JSON.stringify([
  { id: 'event-org-a', title: 'Organization A Custom Event', date: '2026-08-04', organizationId: 'org-a', ownerUserId: 'owner-a' },
  { id: 'event-org-b', title: 'Organization B Secret Event', date: '2026-08-05', organizationId: 'org-b', ownerUserId: 'owner-b' },
  { id: 'event-unowned', title: 'Unowned Historical Secret', date: '2026-08-06' },
], null, 2));

jest.mock('../../src/db', function () {
  return {
    isAvailable: jest.fn(function () { return true; }),
    query: jest.fn(function (sql, params) {
      if (/FROM users WHERE id/.test(String(sql))) {
        const id = params[0];
        return Promise.resolve({ rows: [{
          id: id,
          organization_id: id === 'owner-b' ? 'org-b' : 'org-a',
          role: id === 'viewer-a' ? 'viewer' : id === 'member-a' ? 'member' : 'owner',
          status: 'active',
        }] });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
});

jest.mock('../../src/leads/store', function () {
  return {
    getAllLeads: jest.fn(function () {
      return [
        {
          id: 'real-calendar-lead',
          customerName: 'Durable Calendar Customer',
          callOutcome: 'appointment-set',
          preferred_time: '2026-08-01T09:00:00',
          organizationId: 'org-a',
        },
        {
          id: 'other-calendar-lead',
          customerName: 'Other Tenant Durable Customer',
          callOutcome: 'appointment-set',
          preferred_time: '2026-08-01T09:30:00',
          organizationId: 'org-b',
        },
        {
          id: 'unowned-calendar-lead',
          customerName: 'Unowned Historical Customer',
          callOutcome: 'appointment-set',
          preferred_time: '2026-08-01T09:45:00',
        },
        {
          id: 'owned-calendar-lead',
          customerName: 'Owned Session Appointment',
          callOutcome: 'appointment-set',
          preferred_time: '2026-08-02T10:00:00',
          recordScope: 'simulation',
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
        },
        {
          id: 'foreign-calendar-lead',
          customerName: 'Foreign Session Appointment',
          callOutcome: 'appointment-set',
          preferred_time: '2026-08-03T11:00:00',
          recordScope: 'simulation',
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-b',
          organizationId: 'org-b',
        },
      ];
    }),
  };
});

const dashboardRoutes = require('../../src/routes/dashboard');
const { generateToken } = require('../../src/auth/middleware');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1', dashboardRoutes);
  return instance;
}

const ownerToken = generateToken({ id: 'owner-a', email: 'owner-a@test.local', name: 'Owner A' });
const otherToken = generateToken({ id: 'owner-b', email: 'owner-b@test.local', name: 'Owner B' });
const viewerToken = generateToken({ id: 'viewer-a', role: 'owner' });
const memberToken = generateToken({ id: 'member-a', role: 'owner' });

function auth(testRequest, token) {
  return testRequest.set('Authorization', 'Bearer ' + (token || ownerToken));
}

describe('calendar session propagation and visibility', function () {
  afterAll(function () {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.NORTHSTAR_DATA_DIR;
    else process.env.NORTHSTAR_DATA_DIR = previousDataDir;
  });

  test('list, detail, and ICS require auth and retain real records while isolating simulations', async function () {
    const instance = app();
    expect((await request(instance).get('/api/v1/calendar/events?sessionId=session-a')).status).toBe(401);

    const owned = await auth(request(instance).get('/api/v1/calendar/events?sessionId=session-a'));
    expect(owned.status).toBe(200);
    const ownedIds = owned.body.events.map(function (event) { return event.id; });
    expect(ownedIds).toContain('lead-real-calendar-lead');
    expect(ownedIds).toContain('lead-owned-calendar-lead');
    expect(ownedIds).toContain('event-org-a');
    expect(ownedIds).not.toContain('lead-foreign-calendar-lead');
    expect(ownedIds).not.toContain('lead-other-calendar-lead');
    expect(ownedIds).not.toContain('lead-unowned-calendar-lead');
    expect(ownedIds).not.toContain('event-org-b');
    expect(ownedIds).not.toContain('event-unowned');

    const wrongOwner = await auth(
      request(instance).get('/api/v1/calendar/events?sessionId=session-a'),
      otherToken
    );
    const otherIds = wrongOwner.body.events.map(function (event) { return event.id; });
    expect(otherIds).toContain('lead-other-calendar-lead');
    expect(otherIds).toContain('lead-foreign-calendar-lead');
    expect(otherIds).toContain('event-org-b');
    expect(otherIds).not.toContain('lead-real-calendar-lead');
    expect(otherIds).not.toContain('lead-owned-calendar-lead');
    expect(otherIds).not.toContain('event-unowned');

    const detail = await auth(
      request(instance).get('/api/v1/calendar/events/lead-owned-calendar-lead?sessionId=session-a')
    );
    expect(detail.status).toBe(200);
    expect(detail.body.event.title).toBe('Owned Session Appointment');

    const hiddenDetail = await auth(
      request(instance).get('/api/v1/calendar/events/lead-foreign-calendar-lead?sessionId=session-a')
    );
    expect(hiddenDetail.status).toBe(404);

    const ics = await auth(request(instance).get('/api/v1/calendar/export/ics?sessionId=session-a'));
    expect(ics.status).toBe(200);
    expect(ics.text).toContain('SUMMARY:Owned Session Appointment');
    expect(ics.text).toContain('SUMMARY:Durable Calendar Customer');
    expect(ics.text).toContain('SUMMARY:Organization A Custom Event');
    expect(ics.text).not.toContain('Foreign Session Appointment');
    expect(ics.text).not.toContain('Organization B Secret Event');
    expect(ics.text).not.toContain('Unowned Historical Secret');
  });

  test('other-tenant, unowned, and nonexistent custom event IDs are indistinguishable and immutable', async function () {
    const instance = app();
    const paths = ['event-org-b', 'event-unowned', 'event-does-not-exist'];
    for (const id of paths) {
      const detail = await auth(request(instance).get('/api/v1/calendar/events/' + id + '?sessionId=session-a'));
      const update = await auth(request(instance).put('/api/v1/calendar/events/' + id + '?sessionId=session-a')
        .send({ title: 'Unauthorized overwrite' }));
      const remove = await auth(request(instance).delete('/api/v1/calendar/events/' + id + '?sessionId=session-a'));
      expect({ status: detail.status, body: detail.body }).toEqual({ status: 404, body: { error: 'Event not found' } });
      expect({ status: update.status, body: update.body }).toEqual({ status: 404, body: { error: 'Event not found' } });
      expect({ status: remove.status, body: remove.body }).toEqual({ status: 404, body: { error: 'Event not found' } });
    }
    const stored = JSON.parse(fs.readFileSync(path.join(tempDataDir, 'events.json'), 'utf8'));
    expect(stored.find(function (event) { return event.id === 'event-org-b'; }).title)
      .toBe('Organization B Secret Event');
    expect(stored.find(function (event) { return event.id === 'event-unowned'; }).title)
      .toBe('Unowned Historical Secret');
  });

  test('Calendar mutations enforce the persisted organization role', async function () {
    const instance = app();
    const viewerList = await auth(
      request(instance).get('/api/v1/calendar/events?sessionId=session-a'),
      viewerToken
    );
    const viewerCreate = await auth(
      request(instance).post('/api/v1/calendar/events?sessionId=session-a')
        .send({ title: 'Viewer Event', date: '2026-08-20' }),
      viewerToken
    );
    expect(viewerList.status).toBe(200);
    expect(viewerCreate.status).toBe(403);

    const memberCreate = await auth(
      request(instance).post('/api/v1/calendar/events?sessionId=session-a')
        .send({ title: 'Member Event', date: '2026-08-20' }),
      memberToken
    );
    expect(memberCreate.status).toBe(201);
    expect(memberCreate.body.event.organizationId).toBe('org-a');
    const eventId = memberCreate.body.event.id;

    const memberUpdate = await auth(
      request(instance).put('/api/v1/calendar/events/' + eventId + '?sessionId=session-a')
        .send({ title: 'Member Event Updated' }),
      memberToken
    );
    const memberDelete = await auth(
      request(instance).delete('/api/v1/calendar/events/' + eventId + '?sessionId=session-a'),
      memberToken
    );
    expect(memberUpdate.status).toBe(200);
    expect(memberDelete.status).toBe(403);

    const viewerUpdate = await auth(
      request(instance).put('/api/v1/calendar/events/' + eventId + '?sessionId=session-a')
        .send({ title: 'Viewer overwrite' }),
      viewerToken
    );
    const viewerDelete = await auth(
      request(instance).delete('/api/v1/calendar/events/' + eventId + '?sessionId=session-a'),
      viewerToken
    );
    expect(viewerUpdate.status).toBe(403);
    expect(viewerDelete.status).toBe(403);
  });
});

describe('browser request propagation', function () {
  async function runAppStore(sessionId, storage, serverLeads) {
    const code = fs.readFileSync(path.join(__dirname, '../../public/js/app-store.js'), 'utf8');
    const bus = { emit: jest.fn(), on: jest.fn() };
    const window = {
      EventBus: bus,
      NorthStarDemoSession: { id: sessionId },
      SIM_SESSION_ID: sessionId,
      Models: {
        Lead: function (data) { Object.assign(this, data); },
      },
    };
    const context = {
      window: window,
      sessionStorage: {
        getItem: function (key) { return storage.has(key) ? storage.get(key) : null; },
        setItem: function (key, value) { storage.set(key, value); },
        removeItem: function (key) { storage.delete(key); },
      },
      localStorage: { getItem: function () { return null; }, setItem: function () {} },
      API: {
        getLeads: function () { return Promise.resolve({ items: serverLeads }); },
      },
      Map: Map,
      Date: Date,
      Math: Math,
      Object: Object,
      Array: Array,
      Promise: Promise,
      JSON: JSON,
      String: String,
      Boolean: Boolean,
    };
    vm.runInNewContext(code, context);
    await new Promise(function (resolve) { setImmediate(resolve); });
    return window;
  }

  test('AppStore may hold server records but Calendar supplements only the active simulation partition', async function () {
    const storage = new Map();
    storage.set('northstar_calls', JSON.stringify([
      { id: 'legacy-stale', source: 'simulation', simulationSessionId: 'old-session', outcome: 'appointment-set' },
    ]));
    storage.set('northstar_calls:session-a', JSON.stringify({
      version: 2,
      sessionId: 'session-a',
      leads: [{
        id: 'session-a-lead',
        caller: 'Active Session Appointment',
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
        outcome: 'appointment-set',
        appointment_date: '2026-08-10',
      }],
    }));
    const window = await runAppStore('session-a', storage, [
      { id: 'tenant-real', caller: 'Tenant Appointment', outcome: 'appointment-set', appointment_date: '2026-08-11' },
      {
        id: 'session-b-lead',
        caller: 'Wrong Session Appointment',
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-b',
        outcome: 'appointment-set',
        appointment_date: '2026-08-12',
      },
    ]);
    expect(window.AppStore.getLeads().map(function (lead) { return lead.id; }).sort())
      .toEqual(['session-a-lead', 'tenant-real']);
    expect(storage.has('northstar_calls')).toBe(false);

    const calendarCode = fs.readFileSync(path.join(__dirname, '../../public/js/calendar-engine.js'), 'utf8');
    const start = calendarCode.indexOf('window.syncCalendarFromAppStore = function()');
    const end = calendarCode.indexOf('window.refreshCalendar = async function()');
    vm.runInNewContext(calendarCode.slice(start, end), {
      window: window,
      calState: {
        getLiveLeads: function () { return window.AppStore.getLeads(); },
        _formatDate: function () { return '2026-08-01'; },
      },
      Date: Date,
      Set: Set,
      Boolean: Boolean,
      parseFloat: parseFloat,
    });
    expect(window.syncCalendarFromAppStore().map(function (event) { return event.leadId; }).sort())
      .toEqual(['session-a-lead']);
  });

  test('reload rotation cannot resurrect the prior session cache', async function () {
    const storage = new Map();
    storage.set('northstar_calls:session-a', JSON.stringify({
      version: 2,
      sessionId: 'session-a',
      leads: [{
        id: 'old-session-lead',
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
      }],
    }));
    const window = await runAppStore('session-b', storage, [
      { id: 'tenant-real', caller: 'Tenant Lead' },
      {
        id: 'old-server-session',
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
      },
    ]);
    expect(window.AppStore.getLeads().map(function (lead) { return lead.id; }))
      .toEqual(['tenant-real']);
  });

  test('calendar adapter appends the active session and sends authorization', async function () {
    const code = fs.readFileSync(path.join(__dirname, '../../public/js/calendar-engine.js'), 'utf8');
    const start = code.indexOf('class CalendarData');
    const end = code.indexOf('// CalendarModal');
    const requests = [];
    const window = {
      NorthStarDemoSession: {
        appendToUrl: function (url) { return url + '?sessionId=session-a'; },
      },
    };
    const context = {
      window: window,
      localStorage: { getItem: function () { return 'test-token'; } },
      fetch: function (url, options) {
        requests.push({ url: url, options: options });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () { return Promise.resolve({ events: [] }); },
        });
      },
      console: console,
      Object: Object,
      JSON: JSON,
      encodeURIComponent: encodeURIComponent,
    };
    vm.runInNewContext(
      code.slice(start, end) + '\nwindow.CalendarDataForTest = CalendarData;',
      context
    );
    const adapter = new window.CalendarDataForTest();
    await adapter.fetchEvents();
    expect(requests[0].url).toBe('/api/v1/calendar/events?sessionId=session-a');
    expect(requests[0].options.headers.Authorization).toBe('Bearer test-token');
  });

  test('lead detail uses the shared authenticated and session-scoped bridge', async function () {
    const requests = [];
    function Xhr() {
      requests.push(this);
      this.headers = {};
      this.status = 200;
      this.responseText = JSON.stringify({ success: true, data: { customerId: 'lead-a' } });
    }
    Xhr.prototype.open = function (method, url) {
      this.method = method;
      this.url = url;
    };
    Xhr.prototype.setRequestHeader = function (name, value) {
      this.headers[name] = value;
    };
    Xhr.prototype.send = function () {
      this.onload();
    };

    const window = {
      NorthStarDemoSession: {
        appendToUrl: function (url) { return url + '?sessionId=session-a'; },
      },
    };
    const bridgeCode = fs.readFileSync(path.join(__dirname, '../../public/js/polaris-m13-bridge.js'), 'utf8');
    vm.runInNewContext(bridgeCode, {
      window: window,
      XMLHttpRequest: Xhr,
      localStorage: { getItem: function () { return 'test-token'; } },
      Promise: Promise,
      JSON: JSON,
      encodeURIComponent: encodeURIComponent,
    });

    const response = await window.PolarisM13Bridge.fetchLeadIntelligence('lead-a');
    expect(response).toEqual({ success: true, data: { customerId: 'lead-a' } });
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe('/api/v1/leads/lead-a/intelligence?sessionId=session-a');
    expect(requests[0].headers.Authorization).toBe('Bearer test-token');

    const leadHtml = fs.readFileSync(path.join(__dirname, '../../public/dashboard/lead.html'), 'utf8');
    const leadController = fs.readFileSync(path.join(__dirname, '../../public/js/lead-detail.js'), 'utf8');
    expect(leadHtml).toContain('<script src="/js/lead-detail.js"></script>');
    expect(leadHtml).not.toContain('<script src="/js/polaris-m13-bridge.js"></script>');
    expect(leadController).toContain('window.API.getLead(leadId)');
    expect(leadController).not.toContain('window.AppStore');
    expect(leadController).not.toContain('AppStore.getLead');
    expect(leadController).not.toContain('PolarisM13Bridge');
  });

  test('initial lead-detail API request carries the active session and preserves a server 404', async function () {
    const apiCode = fs.readFileSync(path.join(__dirname, '../../public/js/api.js'), 'utf8');
    const requests = [];
    const window = {
      location: { port: '', href: 'https://northstar.test/dashboard/lead?id=lead-a' },
      NorthStarDemoSession: { id: 'session-a' },
    };
    const context = {
      window: window,
      localStorage: { getItem: function () { return 'test-token'; } },
      document: { getElementById: function () { return null; } },
      fetch: function (url, options) {
        requests.push({ url: url, options: options });
        return Promise.resolve({
          ok: false,
          status: 404,
          json: function () {
            return Promise.resolve({ error: { code: 'not_found', message: 'Lead not found.' } });
          },
        });
      },
      URL: URL,
      Promise: Promise,
      Error: Error,
      JSON: JSON,
      encodeURIComponent: encodeURIComponent,
      setTimeout: setTimeout,
    };
    vm.runInNewContext(apiCode + '\nwindow.APIForTest = API;', context);
    await expect(window.APIForTest.getLead('lead-a')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    expect(requests[0].url).toBe('/api/leads/lead-a?sessionId=session-a');
  });
});
