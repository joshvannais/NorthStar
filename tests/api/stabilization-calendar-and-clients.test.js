'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const vm = require('vm');

jest.mock('../../src/db', function () {
  return {
    isAvailable: jest.fn(function () { return false; }),
    query: jest.fn(function () { return Promise.resolve({ rows: [] }); }),
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

function auth(testRequest, token) {
  return testRequest.set('Authorization', 'Bearer ' + (token || ownerToken));
}

describe('calendar session propagation and visibility', function () {
  test('list, detail, and ICS require auth and retain real records while isolating simulations', async function () {
    const instance = app();
    expect((await request(instance).get('/api/v1/calendar/events?sessionId=session-a')).status).toBe(401);

    const owned = await auth(request(instance).get('/api/v1/calendar/events?sessionId=session-a'));
    expect(owned.status).toBe(200);
    const ownedIds = owned.body.events.map(function (event) { return event.id; });
    expect(ownedIds).toContain('lead-real-calendar-lead');
    expect(ownedIds).toContain('lead-owned-calendar-lead');
    expect(ownedIds).not.toContain('lead-foreign-calendar-lead');

    const wrongOwner = await auth(
      request(instance).get('/api/v1/calendar/events?sessionId=session-a'),
      otherToken
    );
    const otherIds = wrongOwner.body.events.map(function (event) { return event.id; });
    expect(otherIds).toContain('lead-real-calendar-lead');
    expect(otherIds).toContain('lead-foreign-calendar-lead');
    expect(otherIds).not.toContain('lead-owned-calendar-lead');

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
    expect(ics.text).not.toContain('Foreign Session Appointment');
  });
});

describe('browser request propagation', function () {
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
        return Promise.resolve({ json: function () { return Promise.resolve({ events: [] }); } });
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
    expect(leadHtml).toContain('PolarisM13Bridge.fetchLeadIntelligence(leadId)');
    expect(leadHtml).not.toContain("fetch('/api/v1/leads/' + encodeURIComponent(leadId) + '/intelligence')");
  });
});
