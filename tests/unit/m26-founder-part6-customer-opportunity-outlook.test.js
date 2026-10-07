'use strict';

const express = require('express');
const request = require('supertest');
const {
  createForecastCustomerOpportunityOutlookRouter,
  sanitizeOutlook,
} = require('../../src/routes/forecastCustomerOpportunityOutlook');

function outlook(overrides = {}) {
  return Object.assign({
    version: 'm26-customer-opportunity-outlook-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-06T12:00:00.000Z',
    scope: { label: 'Current NorthStar-recorded customer and reviewed opportunity records',
      wholeBusinessCoverageVerified: false, providerCoverageVerified: false,
      offPlatformCoverageVerified: false },
    customers: { count: 10, returningCount: 2 },
    opportunities: { count: 8, reviewedCount: 7, unreviewedCount: 1 },
    qualification: { open: 2, qualified: 4, unqualified: 1, closed: 0 },
    estimateRequests: { open: 3, requested: 3, withdrawn: 0, closed: 1,
      unreviewed: 1, qualifiedNeedsReview: 2 },
    recommendedAction: { key: 'estimate_review', label: 'Review estimate requests',
      href: '/dashboard/leads' },
    probabilityCalibrated: false, forecastIssued: false, automaticActionAuthorized: false,
  }, overrides);
}

describe('Mission 26 founder Part 6 customer and opportunity contract', () => {
  test('accepts only internally consistent aggregate current-state evidence', () => {
    expect(sanitizeOutlook(outlook())).toEqual(outlook());
    expect(sanitizeOutlook({ ...outlook(), customerIds: ['private'] })).toBeNull();
    expect(sanitizeOutlook(outlook({ opportunities: {
      count: 8, reviewedCount: 8, unreviewedCount: 1,
    } }))).toBeNull();
    expect(sanitizeOutlook(outlook({ qualification: {
      open: 2, qualified: 5, unqualified: 1, closed: 0,
    } }))).toBeNull();
    expect(sanitizeOutlook(outlook({ recommendedAction: {
      key: 'lead_review', label: 'Review open leads', href: '/dashboard/leads',
    } }))).toBeNull();
    expect(sanitizeOutlook(outlook({ probabilityCalibrated: true }))).toBeNull();
    expect(sanitizeOutlook(outlook({ checkedAt: '2026-02-31T12:00:00.000Z' }))).toBeNull();
  });

  test('supports complete zero without converting missing evidence into a prediction', () => {
    const zero = outlook({
      customers: { count: 0, returningCount: 0 },
      opportunities: { count: 0, reviewedCount: 0, unreviewedCount: 0 },
      qualification: { open: 0, qualified: 0, unqualified: 0, closed: 0 },
      estimateRequests: { open: 0, requested: 0, withdrawn: 0, closed: 0,
        unreviewed: 0, qualifiedNeedsReview: 0 },
      recommendedAction: { key: 'customer_review', label: 'Review customers',
        href: '/dashboard/leads' },
    });
    expect(sanitizeOutlook(zero)).toEqual(zero);
  });

  test('keeps missing estimate-request review evidence visible in the next action', () => {
    const missingRequestReview = outlook({
      customers: { count: 1, returningCount: 0 },
      opportunities: { count: 1, reviewedCount: 1, unreviewedCount: 0 },
      qualification: { open: 0, qualified: 1, unqualified: 0, closed: 0 },
      estimateRequests: { open: 0, requested: 0, withdrawn: 0, closed: 0,
        unreviewed: 1, qualifiedNeedsReview: 0 },
      recommendedAction: { key: 'estimate_review', label: 'Review estimate requests',
        href: '/dashboard/leads' },
    });
    expect(sanitizeOutlook(missingRequestReview)).toEqual(missingRequestReview);
    expect(sanitizeOutlook({ ...missingRequestReview, recommendedAction: {
      key: 'customer_review', label: 'Review customers', href: '/dashboard/leads',
    } })).toBeNull();
  });

  test('serves one private tenant-scoped GET and fails closed on corrupt output', async () => {
    const calls = [];
    let projection = outlook();
    const client = {
      query: jest.fn(async (sql, parameters) => {
        calls.push({ sql, parameters });
        if (/canonical_forecast_customer_opportunity_outlook_current/.test(sql)) {
          return { rows: [{ value: projection }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const app = express();
    app.use('/outlook', createForecastCustomerOpportunityOutlookRouter({
      poolProvider: () => ({ connect: async () => client }),
      auth: (req, _res, next) => {
        req.tenantContext = { organizationId: '10000000-0000-4000-8000-000000000001',
          userId: '10000000-0000-4000-8000-000000000002' };
        req.userRole = 'owner';
        req.authSession = { id: '10000000-0000-4000-8000-000000000003' };
        next();
      },
      permission: (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(),
    }));
    const current = await request(app).get('/outlook/current');
    expect(current.status).toBe(200);
    expect(current.headers['cache-control']).toBe('private, no-store');
    expect(calls.find(call => call.parameters).parameters).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002', 'owner',
      '10000000-0000-4000-8000-000000000003',
    ]);
    projection = { ...outlook(), opportunityIds: ['private'] };
    calls.length = 0;
    expect((await request(app).get('/outlook/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/outlook/current?customer=private')).status).toBe(400);
  });
});
