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
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2));
  } catch(e) {
    console.warn('[Leads] Failed to save leads file:', e.message);
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
  saveLeads(leads);
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
  leads[idx] = { ...leads[idx], ...updates, updatedAt: new Date().toISOString() };
  saveLeads(leads);
  return leads[idx];
}

function removeLead(id) {
  const idx = leads.findIndex(l => l.id === id);
  if (idx === -1) return;
  const removed = leads.splice(idx, 1)[0];
  saveLeads(leads);
  return removed;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { addLead, getAllLeads, getLead, updateLead, removeLead };
