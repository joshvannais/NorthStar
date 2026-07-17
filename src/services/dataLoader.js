/**
 * Data Loader Module — Shared Data Loading with Caching
 *
 * Extracted from src/context/business.js (M16.5 remediation).
 * Provides a single, cached data-loading function consumed by all modules.
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');

// Cache loaded data to avoid re-reading on every request
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

function loadData() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

  const data = {};

  // Leads
  try {
    data.leads = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'leads.json'), 'utf8'));
  } catch (e) {
    data.leads = [];
  }

  // Customers
  try {
    data.customers = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'customers.json'), 'utf8'));
  } catch (e) {
    data.customers = [];
  }

  // Events
  try {
    data.events = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'events.json'), 'utf8'));
  } catch (e) {
    data.events = [];
  }

  // Estimates
  try {
    data.estimates = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-estimates.json'), 'utf8'));
  } catch (e) {
    data.estimates = [];
  }

  // Jobs
  try {
    data.jobs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-jobs.json'), 'utf8'));
  } catch (e) {
    data.jobs = [];
  }

  // Metrics
  try {
    data.metrics = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-metrics.json'), 'utf8'));
  } catch (e) {
    data.metrics = {};
  }

  // Recommendations
  try {
    data.recommendations = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-recommendations.json'), 'utf8'));
  } catch (e) {
    data.recommendations = [];
  }

  // Crews
  try {
    data.crews = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'polaris-crews.json'), 'utf8'));
  } catch (e) {
    data.crews = [];
  }

  _cache = data;
  _cacheTime = now;
  return data;
}

module.exports = { loadData, CACHE_TTL_MS };
