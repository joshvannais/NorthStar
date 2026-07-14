/**
 * Polaris Store — Persistent Storage Layer
 *
 * File-backed storage for Polaris data. Designed so the same interface
 * can be swapped to PostgreSQL when the database is available, using
 * the field mappings defined in data-model.js.
 *
 * Data files reside in data/ and are loaded on first access.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// ── Storage file paths ──
const STORES = {
  jobs:       path.join(DATA_DIR, 'polaris-jobs.json'),
  estimates:  path.join(DATA_DIR, 'polaris-estimates.json'),
  metrics:    path.join(DATA_DIR, 'polaris-metrics.json'),
  crews:      path.join(DATA_DIR, 'polaris-crews.json'),
  recommendations: path.join(DATA_DIR, 'polaris-recommendations.json'),
};

// ── In-memory caches ──
const _data = {};

/**
 * Generate a short unique ID (for environments without UUID support).
 */
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Load a store from disk, or initialize as empty array.
 */
function _load(storeName) {
  if (_data[storeName]) return _data[storeName];
  const filePath = STORES[storeName];
  if (!filePath) throw new Error(`Unknown Polaris store: ${storeName}`);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      _data[storeName] = JSON.parse(raw);
      console.log(`[PolarisStore] Loaded ${storeName}: ${_data[storeName].length} records`);
    } else {
      _data[storeName] = [];
      _save(storeName);
      console.log(`[PolarisStore] Initialized ${storeName} (empty)`);
    }
  } catch (err) {
    console.warn(`[PolarisStore] Error loading ${storeName}:`, err.message);
    _data[storeName] = [];
  }
  return _data[storeName];
}

/**
 * Persist a store to disk.
 */
function _save(storeName) {
  const filePath = STORES[storeName];
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(_data[storeName] || [], null, 2), 'utf8');
  } catch (err) {
    console.warn(`[PolarisStore] Error saving ${storeName}:`, err.message);
  }
}

// ── Public API ──

function init() {
  _load('jobs');
  _load('estimates');
  _load('metrics');
  _load('crews');
  _load('recommendations');
  console.log('[PolarisStore] All stores initialized');
}

// ── Jobs ──

function getAllJobs() {
  return _load('jobs');
}

function getJob(id) {
  return _load('jobs').find(j => j.id === id) || null;
}

function addJob(jobData) {
  const store = _load('jobs');
  const job = {
    id: generateId(),
    ...jobData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.push(job);
  _save('jobs');
  return job;
}

function updateJob(id, updates) {
  const store = _load('jobs');
  const idx = store.findIndex(j => j.id === id);
  if (idx === -1) return null;
  store[idx] = { ...store[idx], ...updates, updatedAt: new Date().toISOString() };
  _save('jobs');
  return store[idx];
}

// ── Estimates ──

function getAllEstimates() {
  return _load('estimates');
}

function addEstimate(estimateData) {
  const store = _load('estimates');
  const entry = {
    id: generateId(),
    ...estimateData,
    createdAt: new Date().toISOString(),
  };
  store.push(entry);
  _save('estimates');
  return entry;
}

function updateEstimate(id, updates) {
  const store = _load('estimates');
  const idx = store.findIndex(e => e.id === id);
  if (idx === -1) return null;
  store[idx] = { ...store[idx], ...updates };
  _save('estimates');
  return store[idx];
}

// ── Learning Metrics ──

function getAllMetrics() {
  return _load('metrics');
}

function addMetric(metricData) {
  const store = _load('metrics');
  const entry = {
    id: generateId(),
    ...metricData,
    computedAt: new Date().toISOString(),
  };
  store.push(entry);
  _save('metrics');
  return entry;
}

function getMetricsByType(type) {
  return _load('metrics').filter(m => m.metricType === type);
}

// ── Crews ──

function getAllCrews() {
  return _load('crews');
}

function addCrew(crewData) {
  const store = _load('crews');
  const crew = {
    id: generateId(),
    name: '',
    size: 1,
    skills: [],
    status: 'active',
    ...crewData,
    createdAt: new Date().toISOString(),
  };
  store.push(crew);
  _save('crews');
  return crew;
}

// ── Recommendations ──

function getAllRecommendations() {
  return _load('recommendations');
}

function addRecommendation(recData) {
  const store = _load('recommendations');
  const rec = {
    id: generateId(),
    priority: 'medium',
    resolved: false,
    ...recData,
    createdAt: new Date().toISOString(),
  };
  store.push(rec);
  _save('recommendations');
  return rec;
}

function getUnresolvedRecommendations() {
  return _load('recommendations').filter(r => !r.resolved);
}

function resolveRecommendation(id) {
  const store = _load('recommendations');
  const idx = store.findIndex(r => r.id === id);
  if (idx === -1) return null;
  store[idx].resolved = true;
  _save('recommendations');
  return store[idx];
}

module.exports = {
  init,
  // Jobs
  getAllJobs,
  getJob,
  addJob,
  updateJob,
  // Estimates
  getAllEstimates,
  addEstimate,
  updateEstimate,
  // Metrics
  getAllMetrics,
  addMetric,
  getMetricsByType,
  // Crews
  getAllCrews,
  addCrew,
  // Recommendations
  getAllRecommendations,
  addRecommendation,
  getUnresolvedRecommendations,
  resolveRecommendation,
  // Utility
  generateId,
};