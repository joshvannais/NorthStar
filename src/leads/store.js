/**
 * Lead store — in-memory with optional Google Sheets persistence.
 * This is the central place all leads are saved.
 */

const leads = [];

function addLead(lead) {
  const entry = {
    id: generateId(),
    ...lead,
    receivedAt: new Date().toISOString(),
    status: 'new',
  };
  leads.push(entry);
  return entry;
}

function getAllLeads() {
  return [...leads];
}

function getLead(id) {
  return leads.find(l => l.id === id) || null;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { addLead, getAllLeads, getLead };