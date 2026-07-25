/**
 * Lead store — file-persisted with JSON storage.
 * Leads survive server restarts. Data stored in data/leads.json
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'leads.json');

function loadLeads() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch(e) {
    console.warn('[Leads] Failed to load leads file:', e.message);
  }
  return [];
}

function saveLeads(leads) {
  const dir = path.dirname(DATA_FILE);
  const tempFile = DATA_FILE + '.tmp-' + process.pid;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(leads, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
  } catch(e) {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (cleanupError) {}
    throw e;
  }
}

const leads = loadLeads();

function addLead(lead) {
  const entry = {
    id: generateId(),
    ...lead,
    receivedAt: lead.receivedAt || new Date().toISOString(),
    status: lead.status || 'new',
  };
  leads.push(entry);
  try {
    saveLeads(leads);
  } catch (error) {
    leads.pop();
    throw error;
  }
  return entry;
}

function getAllLeads() {
  return [...leads];
}

function getLead(id) {
  return leads.find(l => l.id === id) || null;
}

function updateLead(id, updates) {
  const idx = leads.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const previous = leads[idx];
  leads[idx] = { ...leads[idx], ...updates, updatedAt: new Date().toISOString() };
  try {
    saveLeads(leads);
  } catch (error) {
    leads[idx] = previous;
    throw error;
  }
  return leads[idx];
}

function removeLead(id) {
  const idx = leads.findIndex(l => l.id === id);
  if (idx === -1) return;
  const removed = leads.splice(idx, 1)[0];
  try {
    saveLeads(leads);
  } catch (error) {
    leads.splice(idx, 0, removed);
    throw error;
  }
  return removed;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { addLead, getAllLeads, getLead, updateLead, removeLead };
