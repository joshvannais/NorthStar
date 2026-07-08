/**
 * Business Models — Standardized shared data models
 * Every page uses these exact model definitions
 */
window.Models = (function() {

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function Lead(data) {
    data = data || {};
    this.id = data.id || uid();
    this.caller = data.caller || data.customerName || 'Unknown';
    this.phone = data.phone || data.phoneNumber || '';
    this.address = data.address || '';
    this.service = data.service || data.serviceRequested || '';
    this.description = data.description || '';
    this.status = data.status || 'new';
    this.avgPrice = data.avgPrice || data.estimatedPrice || data.price || 0;
    this.time = data.time || data.receivedAt || new Date().toISOString();
    this.transcript = data.transcript || '';
    this.breakdown = data.breakdown || [];
    this.source = data.source || 'simulator';
    this.outcome = data.outcome || '';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  function Customer(data) {
    data = data || {};
    this.id = data.id || uid();
    this.name = data.name || '';
    this.phone = data.phone || '';
    this.address = data.address || '';
    this.email = data.email || '';
    this.notes = data.notes || '';
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  function Estimate(data) {
    data = data || {};
    this.id = data.id || uid();
    this.leadId = data.leadId || '';
    this.customerId = data.customerId || '';
    this.items = data.items || [];
    this.total = data.total || 0;
    this.status = data.status || 'draft';
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  function Appointment(data) {
    data = data || {};
    this.id = data.id || uid();
    this.leadId = data.leadId || '';
    this.customerId = data.customerId || '';
    this.dateTime = data.dateTime || '';
    this.duration = data.duration || 60;
    this.notes = data.notes || '';
    this.status = data.status || 'scheduled';
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  function Job(data) {
    data = data || {};
    this.id = data.id || uid();
    this.leadId = data.leadId || '';
    this.customerId = data.customerId || '';
    this.estimateId = data.estimateId || '';
    this.scheduledDate = data.scheduledDate || '';
    this.completedDate = data.completedDate || '';
    this.status = data.status || 'pending';
    this.notes = data.notes || '';
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  function Invoice(data) {
    data = data || {};
    this.id = data.id || uid();
    this.jobId = data.jobId || '';
    this.customerId = data.customerId || '';
    this.amount = data.amount || 0;
    this.status = data.status || 'pending';
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  return { Lead, Customer, Estimate, Appointment, Job, Invoice, uid };
})();
